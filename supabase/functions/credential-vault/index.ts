import { createClient } from "npm:@supabase/supabase-js@2";
import {
  type CredentialField,
  decodeMasterKey,
  decryptCredential,
  encryptCredential,
  type EncryptedValue,
} from "../_shared/credential-crypto.ts";

const PRODUCTION_ORIGIN = "https://360fernando360.github.io";
// Somente a versão 1 é suportada. Uma nova versão deve adicionar sua própria
// variável de ambiente e um processo explícito de recifragem antes de ser usada.
const KEY_VERSION = 1;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

function credentialKey(version: number) {
  if (!Number.isInteger(version) || version !== KEY_VERSION) {
    throw new HttpError(500, "Versão da chave de credenciais não suportada.");
  }
  const value = Deno.env.get(`CREDENTIALS_MASTER_KEY_V${version}`) ?? "";
  if (!value) throw new HttpError(500, "Chave de credenciais não configurada.");
  try {
    return decodeMasterKey(value);
  } catch {
    throw new HttpError(500, "Chave de credenciais inválida.");
  }
}

function requestOriginAllowed(request: Request) {
  const origin = request.headers.get("Origin");
  if (!origin || origin === PRODUCTION_ORIGIN) return true;
  try {
    const url = new URL(origin);
    return ["localhost", "127.0.0.1"].includes(url.hostname) &&
      ["http:", "https:"].includes(url.protocol);
  } catch {
    return false;
  }
}

function responseHeaders(request: Request) {
  const origin = request.headers.get("Origin");
  const allowedOrigin = origin && requestOriginAllowed(request)
    ? origin
    : PRODUCTION_ORIGIN;
  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Cache-Control": "no-store",
    "Content-Type": "application/json",
    "Vary": "Origin",
  };
}

function json(request: Request, body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: responseHeaders(request),
  });
}

function requiredString(value: unknown, field: string, maxLength: number) {
  if (typeof value !== "string") throw new HttpError(400, `${field} inválido.`);
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) {
    throw new HttpError(400, `${field} inválido.`);
  }
  return normalized;
}

function requiredSecret(value: unknown, field: string, maxLength: number) {
  if (
    typeof value !== "string" || value.length < 1 || value.length > maxLength
  ) {
    throw new HttpError(400, `${field} inválida.`);
  }
  return value;
}

function optionalString(value: unknown, field: string, maxLength: number) {
  if (value === undefined || value === null || value === "") return "";
  if (typeof value !== "string" || value.length > maxLength) {
    throw new HttpError(400, `${field} inválido.`);
  }
  return value.trim();
}

function validCredentialId(value: unknown) {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    throw new HttpError(400, "Credencial inválida.");
  }
  return value;
}

function validPortalUrl(value: unknown) {
  const portalUrl = optionalString(value, "Link do portal", 2048);
  if (!portalUrl) return null;
  let parsed: URL;
  try {
    parsed = new URL(portalUrl);
  } catch {
    throw new HttpError(400, "Informe um link completo e válido.");
  }
  if (parsed.protocol !== "https:") {
    throw new HttpError(400, "O portal deve utilizar HTTPS.");
  }
  if (parsed.username || parsed.password) {
    throw new HttpError(400, "O link do portal não pode conter credenciais.");
  }
  return parsed.toString();
}

type Owner = { organizationId: string; userId: string };
type CredentialInput = {
  title: string;
  portalUrl: string | null;
  agencyId: string;
  username: string;
  password: string;
  notes: string;
};

function credentialInput(payload: Record<string, unknown>): CredentialInput {
  return {
    title: requiredString(payload.title, "Nome do acesso", 120),
    portalUrl: validPortalUrl(payload.portalUrl),
    agencyId: optionalString(payload.agencyId, "ID da Agência", 300),
    username: requiredString(payload.username, "ID do Usuário", 300),
    password: requiredSecret(payload.password, "Senha", 512),
    notes: optionalString(payload.notes, "Observação", 2000),
  };
}

function cryptoContext(
  owner: Owner,
  credentialId: string,
  field: CredentialField,
  keyVersion = KEY_VERSION,
) {
  return {
    organizationId: owner.organizationId,
    userId: owner.userId,
    credentialId,
    keyVersion,
    field,
  };
}

function encryptValue(
  value: string,
  owner: Owner,
  credentialId: string,
  field: CredentialField,
  key: Uint8Array,
) {
  return encryptCredential(
    value,
    cryptoContext(owner, credentialId, field),
    key,
  );
}

function encryptOptional(
  value: string,
  owner: Owner,
  credentialId: string,
  field: CredentialField,
  key: Uint8Array,
) {
  return value ? encryptValue(value, owner, credentialId, field, key) : null;
}

function decryptValue(
  row: Record<string, unknown>,
  owner: Owner,
  field: CredentialField,
) {
  const ciphertext = row[`${field}_ciphertext`];
  const nonce = row[`${field}_nonce`];
  if (typeof ciphertext !== "string" || typeof nonce !== "string") {
    throw new Error("Credencial criptografada inválida.");
  }
  const encrypted: EncryptedValue = { ciphertext, nonce };
  const keyVersion = Number(row.key_version);
  return decryptCredential(
    encrypted,
    cryptoContext(owner, String(row.id), field, keyVersion),
    credentialKey(keyVersion),
  );
}

function decryptOptional(
  row: Record<string, unknown>,
  owner: Owner,
  field: CredentialField,
) {
  if (!row[`${field}_ciphertext`]) return "";
  return decryptValue(row, owner, field);
}

Deno.serve(async (request) => {
  if (!requestOriginAllowed(request)) {
    return json(request, { error: "Origem não autorizada." }, 403);
  }
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: responseHeaders(request),
    });
  }
  if (request.method !== "POST") {
    return json(request, { error: "Método não permitido." }, 405);
  }

  try {
    const authorization = request.headers.get("Authorization");
    const accessToken = authorization?.replace(/^Bearer\s+/i, "") ?? "";
    if (!accessToken) throw new HttpError(401, "Sessão não informada.");

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    if (!supabaseUrl || !serviceRoleKey) {
      throw new HttpError(500, "Função não configurada.");
    }

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: userData, error: userError } = await admin.auth.getUser(
      accessToken,
    );
    if (userError || !userData.user) {
      throw new HttpError(401, "Sessão inválida ou expirada.");
    }

    const { data: membership, error: membershipError } = await admin
      .from("organization_members")
      .select("organization_id,is_active")
      .eq("user_id", userData.user.id)
      .maybeSingle();
    if (membershipError) {
      throw new HttpError(500, "Não foi possível validar o acesso.");
    }
    if (!membership?.is_active) {
      throw new HttpError(403, "Usuário sem empresa ativa.");
    }

    const owner: Owner = {
      organizationId: membership.organization_id,
      userId: userData.user.id,
    };
    const masterKey = credentialKey(KEY_VERSION);

    let payload: Record<string, unknown>;
    try {
      payload = await request.json();
    } catch {
      throw new HttpError(400, "Dados inválidos.");
    }
    const action = typeof payload.action === "string" ? payload.action : "";

    if (action === "list") {
      const { data, error } = await admin
        .from("private_credentials")
        .select(
          "id,title,portal_url,agency_ciphertext,agency_nonce,username_ciphertext,username_nonce,notes_ciphertext,key_version,sort_order,updated_at",
        )
        .eq("organization_id", owner.organizationId)
        .eq("user_id", owner.userId)
        .order("sort_order", { ascending: true })
        .order("id", { ascending: true });
      if (error) {
        throw new HttpError(500, "Não foi possível carregar os acessos.");
      }
      const items = await Promise.all((data ?? []).map(async (row) => ({
        id: row.id,
        title: row.title,
        portalUrl: row.portal_url,
        agencyId: await decryptOptional(row, owner, "agency"),
        username: await decryptValue(row, owner, "username"),
        hasNotes: Boolean(row.notes_ciphertext),
        sortOrder: Number(row.sort_order),
        updatedAt: row.updated_at,
      })));
      return json(request, { ok: true, items });
    }

    if (action === "create") {
      const input = credentialInput(payload);
      const credentialId = crypto.randomUUID();
      const [agency, username, password, notes] = await Promise.all([
        encryptOptional(
          input.agencyId,
          owner,
          credentialId,
          "agency",
          masterKey,
        ),
        encryptValue(
          input.username,
          owner,
          credentialId,
          "username",
          masterKey,
        ),
        encryptValue(
          input.password,
          owner,
          credentialId,
          "password",
          masterKey,
        ),
        encryptOptional(input.notes, owner, credentialId, "notes", masterKey),
      ]);
      const { data: last } = await admin
        .from("private_credentials")
        .select("sort_order")
        .eq("organization_id", owner.organizationId)
        .eq("user_id", owner.userId)
        .order("sort_order", { ascending: false })
        .limit(1)
        .maybeSingle();
      const sortOrder = Number(last?.sort_order ?? 0) + 1024;
      const { error } = await admin.from("private_credentials").insert({
        id: credentialId,
        organization_id: owner.organizationId,
        user_id: owner.userId,
        title: input.title,
        portal_url: input.portalUrl,
        agency_ciphertext: agency?.ciphertext ?? null,
        agency_nonce: agency?.nonce ?? null,
        username_ciphertext: username.ciphertext,
        username_nonce: username.nonce,
        password_ciphertext: password.ciphertext,
        password_nonce: password.nonce,
        notes_ciphertext: notes?.ciphertext ?? null,
        notes_nonce: notes?.nonce ?? null,
        key_version: KEY_VERSION,
        sort_order: sortOrder,
      });
      if (error) throw new HttpError(500, "Não foi possível salvar o acesso.");
      return json(request, { ok: true, id: credentialId }, 201);
    }

    if (
      action === "details" || action === "reveal" || action === "update" ||
      action === "delete"
    ) {
      const credentialId = validCredentialId(payload.id);
      const { data: row, error } = await admin
        .from("private_credentials")
        .select("*")
        .eq("id", credentialId)
        .eq("organization_id", owner.organizationId)
        .eq("user_id", owner.userId)
        .maybeSingle();
      if (error) {
        throw new HttpError(500, "Não foi possível consultar o acesso.");
      }
      if (!row) throw new HttpError(404, "Acesso não encontrado.");

      if (action === "reveal") {
        const password = await decryptValue(row, owner, "password");
        return json(request, { ok: true, password });
      }

      if (action === "details") {
        const [agencyId, username, password, notes] = await Promise.all([
          decryptOptional(row, owner, "agency"),
          decryptValue(row, owner, "username"),
          decryptValue(row, owner, "password"),
          decryptOptional(row, owner, "notes"),
        ]);
        return json(request, {
          ok: true,
          item: {
            id: row.id,
            title: row.title,
            portalUrl: row.portal_url,
            agencyId,
            username,
            password,
            notes,
          },
        });
      }

      if (action === "delete") {
        const { error: deleteError } = await admin
          .from("private_credentials")
          .delete()
          .eq("id", credentialId)
          .eq("organization_id", owner.organizationId)
          .eq("user_id", owner.userId);
        if (deleteError) {
          throw new HttpError(500, "Não foi possível excluir o acesso.");
        }
        return json(request, { ok: true });
      }

      const input = credentialInput(payload);
      const [agency, username, password, notes] = await Promise.all([
        encryptOptional(
          input.agencyId,
          owner,
          credentialId,
          "agency",
          masterKey,
        ),
        encryptValue(
          input.username,
          owner,
          credentialId,
          "username",
          masterKey,
        ),
        encryptValue(
          input.password,
          owner,
          credentialId,
          "password",
          masterKey,
        ),
        encryptOptional(input.notes, owner, credentialId, "notes", masterKey),
      ]);
      const { error: updateError } = await admin
        .from("private_credentials")
        .update({
          title: input.title,
          portal_url: input.portalUrl,
          agency_ciphertext: agency?.ciphertext ?? null,
          agency_nonce: agency?.nonce ?? null,
          username_ciphertext: username.ciphertext,
          username_nonce: username.nonce,
          password_ciphertext: password.ciphertext,
          password_nonce: password.nonce,
          notes_ciphertext: notes?.ciphertext ?? null,
          notes_nonce: notes?.nonce ?? null,
          key_version: KEY_VERSION,
        })
        .eq("id", credentialId)
        .eq("organization_id", owner.organizationId)
        .eq("user_id", owner.userId);
      if (updateError) {
        throw new HttpError(500, "Não foi possível atualizar o acesso.");
      }
      return json(request, { ok: true });
    }

    if (action === "reorder") {
      if (!Array.isArray(payload.ids) || payload.ids.length > 500) {
        throw new HttpError(400, "Ordem inválida.");
      }
      const ids = payload.ids.map(validCredentialId);
      if (new Set(ids).size !== ids.length) {
        throw new HttpError(400, "Ordem inválida.");
      }
      const { error } = await admin.rpc("reorder_private_credentials", {
        target_organization_id: owner.organizationId,
        target_user_id: owner.userId,
        credential_ids: ids,
      });
      if (error) {
        throw new HttpError(500, "Não foi possível salvar a nova ordem.");
      }
      return json(request, { ok: true });
    }

    throw new HttpError(400, "Ação inválida.");
  } catch (error) {
    if (error instanceof HttpError) {
      return json(request, { error: error.message }, error.status);
    }
    return json(
      request,
      { error: "Não foi possível concluir a operação." },
      500,
    );
  }
});
