import { assertEquals, assertRejects, assertThrows } from "jsr:@std/assert";
import {
  authorizeCustomerAccess,
  CustomerSearchError,
  normalizeExternalResponse,
  requestExternalCustomers,
  validateSearch,
} from "./customer-search.ts";

Deno.test("valida nome, código e documento e envia somente um parâmetro", async () => {
  assertEquals(validateSearch({ type: "nome", value: "  Agência Azul  " }), { type: "nome", value: "Agência Azul" });
  assertEquals(validateSearch({ type: "codigo", value: "00123" }), { type: "codigo", value: "00123" });
  assertEquals(validateSearch({ type: "cnpj", value: "12.345.678/0001-90" }), { type: "cnpj", value: "12345678000190" });
  assertThrows(() => validateSearch({ type: "nome", value: "ab" }), CustomerSearchError);
  assertThrows(() => validateSearch({ type: "codigo", value: "12A" }), CustomerSearchError);
  assertThrows(() => validateSearch({ type: "cnpj", value: "123" }), CustomerSearchError);
  let calledUrl = "";
  await requestExternalCustomers({ endpoint: "https://example.test/clientes", apiKey: "secret", search: { type: "codigo", value: "00123" }, fetcher: (input) => {
    calledUrl = String(input); return Promise.resolve(new Response(JSON.stringify({ resultados: [], total: 0, limite: 20 }), { status: 200 }));
  } });
  const url = new URL(calledUrl);
  assertEquals([...url.searchParams.entries()], [["codigo", "00123"]]);
});

Deno.test("mapeia campos documentados e preserva situação desconhecida", () => {
  const result = normalizeExternalResponse({ resultados: [
    { codigo: 12345, razao_social: "Empresa A", nome_chave: "A", nome_fantasia: "Agência A", ativo: true, filial: { codigo: "SAO", nome: "São Paulo" }, executivo: { nome: "Executivo", email: "exec@example.test" } },
    { codigo: "2", razao_social: "Empresa B", ativo: false, filial: null, executivo: null },
    { codigo: "3", nome_fantasia: "Empresa C" },
  ], total: 3, limite: 20 });
  assertEquals(result.customers[0].executiveEmail, "exec@example.test");
  assertEquals(result.customers.map((item) => item.active), [true, false, null]);
  assertEquals(result.customers[1].branchName, null);
  assertEquals(result.limitReached, false);
  assertThrows(() => normalizeExternalResponse({ resultados: "inválido" }), CustomerSearchError);
});

Deno.test("autoriza membro ativo comum e rejeita acessos inválidos", () => {
  const allowed = new Set(["org-1"]);
  assertEquals(authorizeCustomerAccess({ authenticated: true, dailySessionValid: true, membership: { organization_id: "org-1", is_active: true }, allowedOrganizationIds: allowed }), "org-1");
  assertThrows(() => authorizeCustomerAccess({ authenticated: false, dailySessionValid: false, membership: null, allowedOrganizationIds: allowed }), CustomerSearchError);
  assertThrows(() => authorizeCustomerAccess({ authenticated: true, dailySessionValid: true, membership: { organization_id: "org-1", is_active: false }, allowedOrganizationIds: allowed }), CustomerSearchError);
  assertThrows(() => authorizeCustomerAccess({ authenticated: true, dailySessionValid: true, membership: { organization_id: "org-2", is_active: true }, allowedOrganizationIds: allowed }), CustomerSearchError);
});

Deno.test("trata lista vazia, credencial rejeitada e timeout", async () => {
  const empty = normalizeExternalResponse({ resultados: [], total: 0, limite: 20 });
  assertEquals(empty.customers, []);
  await assertRejects(() => requestExternalCustomers({ endpoint: "https://example.test", apiKey: "secret", search: { type: "nome", value: "Teste" }, fetcher: () => Promise.resolve(new Response("", { status: 401 })) }), CustomerSearchError, "não está autorizada");
  await assertRejects(() => requestExternalCustomers({ endpoint: "https://example.test", apiKey: "secret", search: { type: "nome", value: "Teste" }, timeoutMs: 1, fetcher: (_input, init) => new Promise((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")))) }), CustomerSearchError, "demorou para responder");
});
