const root = typeof Deno !== 'undefined' ? Deno.cwd() : '.';

await import(`file:///${root.replaceAll('\\', '/')}/international-fare-profiles.js`);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertEquals(actual, expected, message) {
  if (actual !== expected) throw new Error(`${message}\nEsperado: ${expected}\nRecebido: ${actual}`);
}

Deno.test('classifica perfis nas quatro categorias sem alterar os dados originais', () => {
  const { defaultCategory } = InternationalFareProfilesCore;
  assertEquals(defaultCategory('BASIC - BASIC ECONOMY'), 'economy', 'Basic deve iniciar em Econômica.');
  assertEquals(defaultCategory('PEC - PREMIUM ECONOMY'), 'premium', 'Premium Economy deve iniciar em Premium.');
  assertEquals(defaultCategory('FBUS - FLAGSHIP BUSINESS'), 'business', 'Business deve iniciar em Business.');
  assertEquals(defaultCategory('FFIR - FLAGSHIP FIRST'), 'first', 'First deve iniciar em Primeira.');
});

Deno.test('gera chaves estáveis inclusive para nomes duplicados', () => {
  const company = { profiles: [{ name: 'LIGHT' }, { name: 'LIGHT' }, { name: 'FULL' }] };
  const entries = InternationalFareProfilesCore.profileEntries(company);
  assertEquals(entries[0].key, 'LIGHT:1', 'Primeira ocorrência deve ser estável.');
  assertEquals(entries[1].key, 'LIGHT:2', 'Duplicata deve ter ocorrência própria.');
  assert(entries[0].profile === company.profiles[0], 'O perfil original deve ser preservado por referência.');
});

Deno.test('formata a data de revisão sem inventar datas ausentes', () => {
  const { formatDate } = InternationalFareProfilesCore;
  assertEquals(formatDate('2026-10-15'), 'Atualizado em: 15/10/2026', 'Deve exibir a data brasileira.');
  assertEquals(formatDate(null), 'Data de revisão não informada', 'Data ausente deve ser explicitada.');
});

Deno.test('integra somente a seção internacional e preserva cópia e regras', async () => {
  const html = await Deno.readTextFile(`${root}/index.html`);
  const js = await Deno.readTextFile(`${root}/international-fare-profiles.js`);
  assert(html.includes('id="internationalFareProfilesCard"'), 'Falta o contêiner isolado de Branded Fares.');
  assert(html.includes('international-fare-profiles.css'), 'Falta o estilo isolado.');
  assert(html.includes('international-fare-profiles.js'), 'Falta o módulo isolado.');
  assert(js.includes("navigator.clipboard.writeText(text)"), 'Copiar perfil deve continuar usando a área de transferência.');
  for (const field of ['seat', 'carryOn', 'checked', 'change', 'refund', 'noShow', 'openTicket']) {
    assert(js.includes(`${field}:`), `O campo ${field} deve continuar disponível.`);
  }
});

Deno.test('migração isola empresas e restringe reclassificação a administradores', async () => {
  const sql = await Deno.readTextFile(`${root}/supabase/migrations/20261029120000_international_fare_profile_categories.sql`);
  assert(sql.includes('enable row level security'), 'As tabelas devem usar RLS.');
  assert(sql.includes('organization_id in (select public.current_organization_ids())'), 'Os dados devem ser isolados por empresa.');
  assert(sql.includes('public.is_organization_admin(organization_id)'), 'Somente administradores podem reclassificar.');
  assert(sql.includes('members can report outdated international fares'), 'Membros devem poder reportar regras desatualizadas.');
});
