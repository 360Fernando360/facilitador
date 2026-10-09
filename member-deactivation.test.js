const tests = [];
const test = (name, operation) => tests.push({ name, operation });
const assert = (condition, message) => { if (!condition) throw new Error(message); };

const migration = await Deno.readTextFile('supabase/migrations/20261008120000_deactivate_organization_members.sql');
const schema = await Deno.readTextFile('supabase-schema.sql');
const hyperFunction = await Deno.readTextFile('supabase/functions/hyper-function/index.ts');
const vaultFunction = await Deno.readTextFile('supabase/functions/credential-vault/index.ts');
const frontend = await Deno.readTextFile('index.html');

test('mantém o modelo de uma única empresa por usuário', () => {
  assert(/unique\s*\(user_id\)/i.test(schema), 'A restrição UNIQUE(user_id) foi removida.');
});

test('migration incremental registra estado e metadados de desativação', () => {
  for (const field of ['is_active', 'deactivated_at', 'deactivated_by']) {
    assert(migration.includes(field), `A migration não contém ${field}.`);
  }
  assert(migration.includes('organization_members_active_state_check'), 'Falta a consistência do estado ativo/inativo.');
});

test('exclusões no Auth e no vínculo não apagam credenciais por cascata', () => {
  assert(/organization_members_user_id_fkey[\s\S]*?on delete restrict/i.test(migration), 'O usuário do Auth não está protegido por RESTRICT.');
  assert(/private_credentials_organization_id_user_id_fkey[\s\S]*?on delete restrict/i.test(migration), 'As credenciais não estão protegidas por RESTRICT.');
});

test('helpers e atividade exigem vínculo ativo', () => {
  for (const name of ['current_organization_ids', 'is_organization_admin', 'can_manage_organization', 'track_user_activity']) {
    const start = migration.indexOf(`function public.${name}`);
    assert(start >= 0, `Função ${name} ausente.`);
    assert(migration.slice(start, start + 1400).includes('is_active'), `Função ${name} não valida atividade.`);
  }
});

test('transição é serializada, idempotente e protege administradores', () => {
  assert(/from public\.organizations[\s\S]*?for update/i.test(migration), 'Falta o bloqueio de concorrência da organização.');
  assert(/target_active\s*=\s*new_active[\s\S]*?return/i.test(migration), 'Requisições repetidas não são idempotentes.');
  assert(migration.includes('actor_user_id = target_user_id'), 'Falta impedir a autodesativação.');
  assert(migration.includes('active_admin_count <= 1'), 'Falta impedir a desativação do último administrador.');
});

test('RPC administrativa não é acessível diretamente por authenticated', () => {
  assert(/revoke all on function public\.set_organization_member_active[\s\S]*?authenticated/i.test(migration), 'A permissão de authenticated não foi revogada.');
  assert(/grant execute on function public\.set_organization_member_active[\s\S]*?service_role/i.test(migration), 'A Edge Function não recebeu permissão explícita.');
});

test('Edge Functions recusam colaboradores inativos', () => {
  assert(hyperFunction.includes("select('organization_id,role,is_active')"), 'A função administrativa não lê o estado.');
  assert(hyperFunction.includes('!membership?.is_active'), 'A função administrativa não bloqueia inativos.');
  assert(vaultFunction.includes("select(\"organization_id,is_active\")"), 'O cofre não lê o estado.');
  assert(vaultFunction.includes('!membership?.is_active'), 'O cofre não bloqueia inativos.');
});

test('frontend bloqueia sessão inativa e permite reativação administrativa', () => {
  assert(frontend.includes('validateActiveMembership'), 'Falta revalidar o vínculo no frontend.');
  assert(frontend.includes('membershipValidationId=setInterval'), 'A sessão já autenticada não é revalidada periodicamente.');
  assert(frontend.includes("action:'set-active'"), 'Falta a ação administrativa de estado.');
  assert(frontend.includes("member.is_active?'Desativar':'Reativar'"), 'Faltam os controles de desativar/reativar.');
});

test('nenhuma auditoria adicional foi criada nesta versão', () => {
  assert(!/create\s+table[^;]*audit/i.test(migration), 'Foi criada tabela de auditoria fora do escopo.');
});

let failures = 0;
for (const { name, operation } of tests) {
  try {
    await operation();
    console.log(`OK  ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`ERRO  ${name}: ${error.message}`);
  }
}

if (failures) throw new Error(`${failures} teste(s) falharam.`);
console.log(`${tests.length} testes locais do contrato de desativação aprovados.`);
