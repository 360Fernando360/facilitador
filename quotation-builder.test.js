const root = typeof Deno !== 'undefined' ? Deno.cwd() : '.';

await import(`file:///${root.replaceAll('\\', '/')}/quotation-builder.js`);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertEquals(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message}\nEsperado: ${JSON.stringify(expected)}\nRecebido: ${JSON.stringify(actual)}`);
  }
}

Deno.test('ordena texto complementar, perfil e por último preserva o GDS', () => {
  const source = '  LINHA 1  \nLINHA 2\n';
  const blocks = [
    { type: 'profile', content: 'PERFIL DE TARIFA\nBagagem: 1 peça' },
    { type: 'text', content: 'TEXTO COMPLEMENTAR\nApresente-se com antecedência.' },
  ];
  assertEquals(
    QuotationBuilderCore.composeQuotation(source, blocks),
    'TEXTO COMPLEMENTAR\nApresente-se com antecedência.\n\nPERFIL DE TARIFA\nBagagem: 1 peça\n\n  LINHA 1  \nLINHA 2\n',
    'A composição deve respeitar a ordem fixa e não normalizar o GDS.',
  );
});

Deno.test('converte somente os campos existentes do perfil tarifário', () => {
  const company = { code: 'ZZ', name: 'Companhia Sintética' };
  const profile = {
    name: 'Flexível',
    fields: { seat: 'Incluso', checked: '1 peça', refund: '', metadata: 'não exibir' },
  };
  const text = QuotationBuilderCore.profileText(company, profile);
  assert(text.includes('ZZ - Companhia Sintética'), 'Deve identificar a companhia selecionada.');
  assert(text.includes('PERFIL: Flexível'), 'Deve identificar o perfil selecionado.');
  assert(text.includes('ASSENTO: Incluso'), 'Deve converter o campo conhecido.');
  assert(text.includes('BAGAGEM DESPACHADA: 1 peça'), 'Deve converter o campo conhecido.');
  assert(!text.includes('REEMBOLSO:'), 'Não deve inventar valor para campo vazio.');
  assert(!text.includes('metadata'), 'Não deve expor metadados internos.');
});

Deno.test('frontend mantém perfil e texto complementar como fontes separadas', async () => {
  const js = await Deno.readTextFile(`${root}/quotation-builder.js`);
  const html = await Deno.readTextFile(`${root}/index.html`);
  assert(html.includes('<h3>Perfis de tarifa</h3>'), 'Falta a área própria de perfis.');
  assert(html.includes('<h3>Textos complementares</h3>'), 'Falta a área própria de textos.');
  assert(js.includes("selectedBlockKey('profile'"), 'Perfil deve usar um bloco próprio.');
  assert(js.includes("selectedBlockKey('text'"), 'Texto deve usar um bloco próprio.');
  assert(js.includes('if (hasBlock(block.key)) return'), 'Deve impedir a inclusão duplicada.');
  assert(js.includes('Texto complementar disponível para inclusão na cotação.'), 'O cartão deve usar uma descrição compacta.');
  assert(!js.includes("item.content.replace(/\\s+/g, ' ').slice(0, 110)"), 'O cartão não deve exibir um trecho do conteúdo cadastrado.');
  assert(js.includes('content: `${item.title.toLocaleUpperCase(\'pt-BR\')}\\n${item.content}`'), 'A inclusão deve preservar o conteúdo integral do texto.');
  assert(js.includes('navigator.clipboard.writeText(text)'), 'A cópia deve usar a composição da prévia.');
});

Deno.test('não persiste nem interpreta dados da cotação como HTML', async () => {
  const js = await Deno.readTextFile(`${root}/quotation-builder.js`);
  for (const forbidden of ['localStorage', 'sessionStorage', '.innerHTML', 'fetch(', 'console.']) {
    assert(!js.includes(forbidden), `quotation-builder.js não deve conter ${forbidden}`);
  }
  assert(js.includes('textContent = output'), 'A prévia deve ser renderizada como texto.');
  assert(js.includes('document.createTextNode(block.title)'), 'Títulos recebidos devem ser nós de texto.');
});

Deno.test('limpa dados ao encerrar sessão ou trocar de empresa', async () => {
  const js = await Deno.readTextFile(`${root}/quotation-builder.js`);
  const html = await Deno.readTextFile(`${root}/index.html`);
  assert(js.includes('state.generation++'), 'Operações antigas precisam ser invalidadas no reset.');
  assert(js.includes("elements.source.value = ''"), 'O texto do GDS precisa ser limpo.');
  assert(html.includes('window.QuotationBuilder?.reset()'), 'A sessão principal deve limpar o módulo.');
});

Deno.test('migration isola empresas e restringe gestão', async () => {
  const sql = await Deno.readTextFile(`${root}/supabase/migrations/20261014150000_create_quote_complementary_texts.sql`);
  assert(sql.includes('alter table public.quote_complementary_texts enable row level security'), 'RLS deve estar habilitada.');
  assert(sql.includes('organization_id in (select public.current_organization_ids())'), 'A leitura/escrita deve pertencer à empresa da sessão.');
  assert(sql.includes('public.can_manage_organization(organization_id)'), 'A gestão deve exigir administrador ou gestor.');
  assert(sql.includes('and (is_active or public.can_manage_organization(organization_id))'), 'Membros devem ver somente textos ativos.');
  assert(sql.includes('grant update (airline_code,title,content,is_active,updated_by)'), 'O update não pode permitir trocar empresa ou autoria.');
  assert(!/grant\s+delete/i.test(sql), 'Não deve existir permissão de exclusão física.');
  assert(!/create policy[\s\S]+for delete/i.test(sql), 'Não deve existir política de exclusão física.');
});

Deno.test('ordenação de perfis é persistente, isolada e restrita à gestão', async () => {
  const js = await Deno.readTextFile(`${root}/quotation-builder.js`);
  const sql = await Deno.readTextFile(`${root}/supabase/migrations/20261014160000_create_quote_profile_orders.sql`);
  assert(js.includes(".from('quote_profile_orders')"), 'A ordem deve ser carregada e salva no banco.');
  assert(js.includes('encodeURIComponent(profile.name)'), 'A chave deve suportar nomes e caracteres especiais.');
  assert(js.includes('occurrences.get(profile.name)'), 'Perfis com nomes repetidos precisam de chaves distintas.');
  assert(js.includes("state.role === 'admin' || state.role === 'manager'"), 'Somente administrador e gestor devem receber os controles.');
  assert(sql.includes('unique (organization_id,airline_code)'), 'Deve existir uma ordem independente por empresa e companhia.');
  assert(sql.includes('organization_id in (select public.current_organization_ids())'), 'A leitura deve preservar o isolamento entre empresas.');
  assert(sql.includes('public.can_manage_organization(organization_id)'), 'A escrita deve exigir administrador ou gestor.');
  assert(sql.includes('grant update (profile_keys,updated_by)'), 'Não deve ser possível trocar empresa ou companhia via update.');
  assert(!/grant\s+delete/i.test(sql), 'A configuração não deve conceder exclusão.');
});

Deno.test('ordena inclusive perfis com nomes repetidos sem alterar o cadastro original', () => {
  const profiles = [{ name: 'BASIC' }, { name: 'FLEX' }, { name: 'BASIC' }];
  const original = profiles.map((profile) => profile.name).join(',');
  const entries = QuotationBuilderCore.orderProfileEntries(profiles, []);
  assertEquals(new Set(entries.map((entry) => entry.key)).size, 3, 'Cada ocorrência deve possuir uma chave própria.');
  const reordered = QuotationBuilderCore.orderProfileEntries(profiles, [entries[2].key, entries[1].key, entries[0].key]);
  assertEquals(reordered.map((entry) => entry.originalIndex).join(','), '2,1,0', 'A preferência salva deve definir a exibição.');
  assertEquals(profiles.map((profile) => profile.name).join(','), original, 'O cadastro tarifário não pode ser modificado.');
});
