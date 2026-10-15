import './customer-search.js';

const data = globalThis.CustomerSearchData;
const assert = (condition, message) => { if (!condition) throw new Error(message); };

assert(JSON.stringify(data.validateSearch('nome', ' Agência Azul ')) === JSON.stringify({ type: 'nome', value: 'Agência Azul' }), 'nome não foi normalizado');
assert(JSON.stringify(data.validateSearch('codigo', '00123')) === JSON.stringify({ type: 'codigo', value: '00123' }), 'Código Sica perdeu zeros');
assert(JSON.stringify(data.validateSearch('cnpj', '12.345.678/0001-90')) === JSON.stringify({ type: 'cnpj', value: '12345678000190' }), 'CNPJ não foi normalizado');
for (const invalid of [['nome', 'ab'], ['codigo', '12A'], ['cnpj', '123']]) {
  let failed = false;
  try { data.validateSearch(invalid[0], invalid[1]); } catch (_error) { failed = true; }
  assert(failed, `entrada inválida aceita: ${invalid.join(':')}`);
}

const calls = [];
const adapter = data.createApiAdapter({ functions: { invoke: async (name, options) => {
  calls.push({ name, body: options.body });
  return { data: { ok: true, customers: [{ id: '1', code: '001', legalName: 'Empresa A', active: true, branchCode: null, branchName: null, executiveName: null, executiveEmail: null }], total: 1, limit: 20, limitReached: false }, error: null };
} } });
const result = await adapter.search('codigo', '001');
assert(calls.length === 1 && calls[0].name === 'customer-search-proxy', 'Edge Function incorreta');
assert(Object.keys(calls[0].body).join(',') === 'type,value', 'frontend enviou campos adicionais');
assert(result.customers[0].legalName === 'Empresa A' && result.customers[0].active === true, 'resposta não foi normalizada');

const unknown = data.toCustomer({ code: '2', tradeName: 'Empresa B' });
assert(unknown.active === null, 'situação ausente foi interpretada como inativa');
assert(data.displayName(unknown) === 'Empresa B', 'fallback do nome principal falhou');

const source = await Deno.readTextFile('customer-search.js');
assert(!/DEMO_RECORDS|createDemoAdapter|dados fictícios/.test(source), 'fluxo demonstrativo ainda existe');
assert(!source.includes('.innerHTML'), 'interface interpreta conteúdo como HTML');
assert(source.includes('if (state.loading) return'), 'envios duplicados não estão bloqueados');
assert(source.includes('generation !== state.generation'), 'resposta antiga pode reaparecer');
assert(source.includes("functions.invoke('customer-search-proxy'"), 'frontend não usa a função intermediária');

const html = await Deno.readTextFile('index.html');
for (const marker of ['customerSearchType', 'Código Sica', 'CPF/CNPJ', 'customerSearchLimitNotice', 'customerSearchErrorMessage']) {
  assert(html.includes(marker), `controle ou estado ausente: ${marker}`);
}
assert(html.includes("window.CustomerSearch?.open(supabaseClient)"), 'cliente autenticado não foi entregue ao módulo');

console.log('Consulta de clientes no frontend: 17 verificações aprovadas.');
