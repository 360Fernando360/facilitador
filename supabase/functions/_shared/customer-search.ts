export type SearchType = "nome" | "codigo" | "cnpj";

export type CustomerSearch = { type: SearchType; value: string };

export type Customer = {
  id: string;
  code: string | null;
  legalName: string | null;
  keyName: string | null;
  tradeName: string | null;
  active: boolean | null;
  branchCode: string | null;
  branchName: string | null;
  executiveName: string | null;
  executiveEmail: string | null;
};

export class CustomerSearchError extends Error {
  constructor(public code: string, message: string, public status = 400) {
    super(message);
  }
}

function textOrNull(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text || null;
}

export function validateSearch(input: unknown): CustomerSearch {
  if (!input || typeof input !== "object") {
    throw new CustomerSearchError("invalid_input", "Informe os dados da consulta.");
  }
  const body = input as Record<string, unknown>;
  const type = body.type;
  const rawValue = typeof body.value === "string" ? body.value.trim() : "";
  if (type !== "nome" && type !== "codigo" && type !== "cnpj") {
    throw new CustomerSearchError("invalid_type", "Selecione um tipo de consulta válido.");
  }
  if (!rawValue || rawValue.length > 120) {
    throw new CustomerSearchError("invalid_value", "Informe um valor válido para a consulta.");
  }
  if (type === "nome") {
    if (rawValue.length < 3) throw new CustomerSearchError("invalid_name", "Informe ao menos 3 caracteres do nome.");
    return { type, value: rawValue };
  }
  if (type === "codigo") {
    if (!/^\d+$/.test(rawValue)) throw new CustomerSearchError("invalid_code", "O Código Sica deve conter somente números.");
    return { type, value: rawValue };
  }
  if (!/^[\d.\-\/\s]+$/.test(rawValue)) {
    throw new CustomerSearchError("invalid_document", "O CPF/CNPJ deve conter somente números e pontuação.");
  }
  const digits = rawValue.replace(/\D/g, "");
  if (![11, 14].includes(digits.length)) {
    throw new CustomerSearchError("invalid_document", "Informe um CPF com 11 dígitos ou CNPJ com 14 dígitos.");
  }
  return { type, value: digits };
}

export function authorizeCustomerAccess(input: {
  authenticated: boolean;
  dailySessionValid: boolean;
  membership: { organization_id?: unknown; is_active?: unknown } | null;
  allowedOrganizationIds: Set<string>;
}): string {
  if (!input.authenticated) throw new CustomerSearchError("unauthenticated", "Sessão inválida ou expirada.", 401);
  if (!input.dailySessionValid) throw new CustomerSearchError("daily_session_expired", "A sessão diária terminou. Entre novamente.", 401);
  const organizationId = textOrNull(input.membership?.organization_id);
  if (!organizationId || input.membership?.is_active !== true) {
    throw new CustomerSearchError("inactive_membership", "Colaborador sem vínculo ativo.", 403);
  }
  if (!input.allowedOrganizationIds.size) {
    throw new CustomerSearchError("organization_configuration_missing", "A consulta de clientes ainda não foi habilitada para empresas.", 503);
  }
  if (!input.allowedOrganizationIds.has(organizationId)) {
    throw new CustomerSearchError("organization_not_allowed", "A consulta de clientes não está habilitada para esta empresa.", 403);
  }
  return organizationId;
}

export function parseAllowedOrganizationIds(value: string | undefined): Set<string> {
  return new Set((value || "").split(",").map((item) => item.trim()).filter(Boolean));
}

export function normalizeExternalResponse(payload: unknown): { customers: Customer[]; total: number; limit: number; limitReached: boolean } {
  if (!payload || typeof payload !== "object") {
    throw new CustomerSearchError("invalid_external_response", "O serviço de clientes retornou uma resposta inválida.", 502);
  }
  const body = payload as Record<string, unknown>;
  if (!Array.isArray(body.resultados)) {
    throw new CustomerSearchError("invalid_external_response", "O serviço de clientes retornou uma resposta inválida.", 502);
  }
  if (typeof body.total !== "number" || !Number.isFinite(body.total) || body.total < 0 || typeof body.limite !== "number" || !Number.isFinite(body.limite) || body.limite <= 0) {
    throw new CustomerSearchError("invalid_external_response", "O serviço de clientes retornou uma resposta inválida.", 502);
  }
  const total = body.total;
  const limit = body.limite;
  const customers = body.resultados.slice(0, limit).map((item, index) => {
    if (!item || typeof item !== "object") {
      throw new CustomerSearchError("invalid_external_response", "O serviço de clientes retornou uma resposta inválida.", 502);
    }
    const record = item as Record<string, unknown>;
    const branch = record.filial && typeof record.filial === "object" ? record.filial as Record<string, unknown> : {};
    const executive = record.executivo && typeof record.executivo === "object" ? record.executivo as Record<string, unknown> : {};
    const code = textOrNull(record.codigo);
    return {
      id: code || `resultado-${index + 1}`,
      code,
      legalName: textOrNull(record.razao_social),
      keyName: textOrNull(record.nome_chave),
      tradeName: textOrNull(record.nome_fantasia),
      active: typeof record.ativo === "boolean" ? record.ativo : null,
      branchCode: textOrNull(branch.codigo),
      branchName: textOrNull(branch.nome),
      executiveName: textOrNull(executive.nome),
      executiveEmail: textOrNull(executive.email),
    };
  });
  return { customers, total, limit, limitReached: customers.length >= limit };
}

export async function requestExternalCustomers(options: {
  endpoint: string;
  apiKey: string;
  search: CustomerSearch;
  fetcher?: typeof fetch;
  timeoutMs?: number;
}): Promise<ReturnType<typeof normalizeExternalResponse>> {
  const url = new URL(options.endpoint);
  url.searchParams.set(options.search.type, options.search.value);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 8000);
  try {
    let response: Response;
    try {
      response = await (options.fetcher ?? fetch)(url, {
        method: "GET",
        headers: { "x-api-key": options.apiKey, "Accept": "application/json" },
        signal: controller.signal,
      });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new CustomerSearchError("external_timeout", "O serviço de clientes demorou para responder. Tente novamente.", 504);
      }
      throw new CustomerSearchError("external_unavailable", "O serviço de clientes está temporariamente indisponível.", 502);
    }
    if (response.status === 401 || response.status === 403) {
      throw new CustomerSearchError("external_credentials_rejected", "A integração com o serviço de clientes não está autorizada.", 503);
    }
    if (!response.ok) throw new CustomerSearchError("external_unavailable", "O serviço de clientes está temporariamente indisponível.", 502);
    let payload: unknown;
    try { payload = await response.json(); }
    catch { throw new CustomerSearchError("invalid_external_response", "O serviço de clientes retornou uma resposta inválida.", 502); }
    return normalizeExternalResponse(payload);
  } finally {
    clearTimeout(timeout);
  }
}
