import { createClient } from "npm:@supabase/supabase-js@2";
import { hasValidDailySession } from "../_shared/daily-session.ts";
import {
  authorizeCustomerAccess,
  CustomerSearchError,
  parseAllowedOrganizationIds,
  requestExternalCustomers,
  validateSearch,
} from "../_shared/customer-search.ts";

const EXTERNAL_ENDPOINT = "https://etnqlxpngkrsqppjydwq.supabase.co/functions/v1/api-consulta-cliente";
const PRODUCTION_ORIGIN = "https://360fernando360.github.io";

function allowedOrigins(): Set<string> {
  return new Set([PRODUCTION_ORIGIN, ...(Deno.env.get("CUSTOMER_API_ALLOWED_ORIGINS") || "").split(",").map((item) => item.trim()).filter(Boolean)]);
}

function corsHeaders(origin: string | null): HeadersInit {
  const headers: Record<string, string> = {
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
  if (origin && allowedOrigins().has(origin)) headers["Access-Control-Allow-Origin"] = origin;
  return headers;
}

function json(origin: string | null, body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders(origin), "Content-Type": "application/json" } });
}

Deno.serve(async (request) => {
  const origin = request.headers.get("Origin");
  if (origin && !allowedOrigins().has(origin)) return json(origin, { error: { code: "origin_not_allowed", message: "Origem não autorizada." } }, 403);
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(origin) });
  if (request.method !== "POST") return json(origin, { error: { code: "method_not_allowed", message: "Método não permitido." } }, 405);

  try {
    const authorization = request.headers.get("Authorization");
    const accessToken = authorization?.replace(/^Bearer\s+/i, "") || "";
    if (!accessToken) throw new CustomerSearchError("unauthenticated", "Sessão não informada.", 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    const apiKey = Deno.env.get("CUSTOMER_API_KEY") || "";
    const organizationIds = parseAllowedOrganizationIds(Deno.env.get("CUSTOMER_API_ALLOWED_ORGANIZATION_IDS"));
    if (!supabaseUrl || !serviceRoleKey) throw new CustomerSearchError("server_not_configured", "Serviço de autorização indisponível.", 500);

    const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
    const { data: userData, error: userError } = await admin.auth.getUser(accessToken);
    const authenticated = !userError && Boolean(userData.user);
    const dailySessionValid = authenticated ? await hasValidDailySession(admin, accessToken, userData.user!.id) : false;
    const membershipResult = authenticated
      ? await admin.from("organization_members").select("organization_id,is_active").eq("user_id", userData.user!.id).maybeSingle()
      : { data: null, error: null };
    if (membershipResult.error) throw new CustomerSearchError("membership_lookup_failed", "Não foi possível validar o acesso.", 500);
    authorizeCustomerAccess({ authenticated, dailySessionValid, membership: membershipResult.data, allowedOrganizationIds: organizationIds });
    if (!apiKey) throw new CustomerSearchError("external_credentials_missing", "A integração com clientes ainda não foi configurada.", 503);

    let payload: unknown;
    try { payload = await request.json(); }
    catch { throw new CustomerSearchError("invalid_json", "Dados da consulta inválidos."); }
    const search = validateSearch(payload);
    const result = await requestExternalCustomers({ endpoint: EXTERNAL_ENDPOINT, apiKey, search });
    return json(origin, { ok: true, ...result });
  } catch (error) {
    const safeError = error instanceof CustomerSearchError
      ? error
      : new CustomerSearchError("unexpected_error", "Não foi possível concluir a consulta.", 500);
    return json(origin, { error: { code: safeError.code, message: safeError.message } }, safeError.status);
  }
});
