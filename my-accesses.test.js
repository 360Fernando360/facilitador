const listeners = Symbol('listeners');

class FakeClassList {
  constructor() { this.values = new Set(); }
  add(...names) { names.forEach((name) => this.values.add(name)); }
  remove(...names) { names.forEach((name) => this.values.delete(name)); }
  contains(name) { return this.values.has(name); }
  toggle(name, force) {
    const enabled = force === undefined ? !this.contains(name) : Boolean(force);
    if (enabled) this.add(name); else this.remove(name);
    return enabled;
  }
}

class FakeElement {
  constructor(tagName = 'div') {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.classList = new FakeClassList();
    this.dataset = {};
    this.value = '';
    this.textContent = '';
    this.disabled = false;
    this.hidden = false;
    this.open = false;
    this.returnValue = '';
    this.type = '';
    this[listeners] = new Map();
  }
  set className(value) {
    this._className = value;
    this.classList = new FakeClassList();
    String(value).split(/\s+/).filter(Boolean).forEach((name) => this.classList.add(name));
  }
  get className() { return this._className || ''; }
  get innerText() { return [this.textContent, ...this.children.map((child) => child.innerText)].join(''); }
  append(...nodes) { nodes.forEach((node) => this.appendChild(node)); }
  appendChild(node) { this.children.push(node); return node; }
  replaceChildren(...nodes) { this.children = [...nodes]; }
  addEventListener(type, handler) {
    const handlers = this[listeners].get(type) || [];
    handlers.push(handler);
    this[listeners].set(type, handlers);
  }
  async dispatch(type, event = {}) {
    for (const handler of this[listeners].get(type) || []) await handler(event);
  }
  click() { return this.dispatch('click', { currentTarget: this, preventDefault() {} }); }
  querySelectorAll() { return []; }
  querySelector() { return null; }
  setAttribute(name, value) { this[name] = String(value); }
  reset() { this.value = ''; }
  reportValidity() { return true; }
  focus() {}
  select() {}
  getBoundingClientRect() { return { top: 0 }; }
  showModal() { this.open = true; }
  close() { if (!this.open) return; this.open = false; return this.dispatch('close'); }
}

const ids = [
  'accessNewButton', 'accessRefreshButton', 'accessSearch', 'accessStatus',
  'accessList', 'accessEmpty', 'accessFormDialog', 'accessForm',
  'accessFormTitle', 'accessCredentialId', 'accessTitle', 'accessPortalUrl',
  'accessAgencyId', 'accessUsername', 'accessPassword', 'accessNotes',
  'accessFormPasswordToggle', 'accessGeneratePassword', 'accessPasswordProfile',
  'accessFormMessage', 'accessSaveButton', 'accessDeleteDialog',
  'accessDeleteTitle',
];
const elements = new Map(ids.map((id) => [id, new FakeElement()]));
elements.get('accessFormDialog').querySelectorAll = () => [];

globalThis.window = {};
globalThis.document = {
  createElement: (name) => new FakeElement(name),
  getElementById: (id) => elements.get(id) || null,
  querySelectorAll: () => [],
};

const clipboardWrites = [];
Object.defineProperty(globalThis.navigator, 'clipboard', {
  configurable: true,
  value: { writeText: async (value) => { clipboardWrites.push(value); } },
});

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function clientWith(handler) {
  return { functions: { invoke: handler } };
}

function item(id, username = 'usuario') {
  return {
    id,
    title: `Acesso ${username}`,
    portalUrl: null,
    agencyId: '',
    username,
    hasNotes: false,
    sortOrder: 1024,
    updatedAt: new Date().toISOString(),
  };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function listText() { return elements.get('accessList').innerText; }
function firstRow() { return elements.get('accessList').children[0]; }
function secondRow() { return elements.get('accessList').children[1]; }
function passwordCopyButton() { return firstRow().children[4].children[2]; }
function passwordRevealButton() { return firstRow().children[4].children[3]; }
function editButton() { return firstRow().children[5].children[1]; }

const source = await Deno.readTextFile(new URL('./my-accesses.js', import.meta.url));
eval(source);
const accesses = window.MyAccesses;

const tests = [];
function test(name, operation) { tests.push({ name, operation }); }

test('logout durante list descarta a resposta antiga', async () => {
  const pending = deferred();
  const opening = accesses.open(clientWith(() => pending.promise), 'user-a');
  accesses.reset();
  pending.resolve({ data: { ok: true, items: [item('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'usuario-a')] }, error: null });
  await opening;
  assert(!listText().includes('usuario-a'), 'A lista antiga reapareceu após logout.');
});

test('entrada do usuário B invalida list do usuário A', async () => {
  const pendingA = deferred();
  const openingA = accesses.open(clientWith(() => pendingA.promise), 'user-a');
  const clientB = clientWith(async () => ({ data: { ok: true, items: [item('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'usuario-b')] }, error: null }));
  await accesses.open(clientB, 'user-b');
  pendingA.resolve({ data: { ok: true, items: [item('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'usuario-a')] }, error: null });
  await openingA;
  assert(listText().includes('usuario-b'), 'A lista do usuário B não permaneceu ativa.');
  assert(!listText().includes('usuario-a'), 'A resposta do usuário A substituiu a lista do usuário B.');
});

test('details atrasado não reabre modal nem expõe senha', async () => {
  const pendingDetails = deferred();
  const credential = item('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'usuario-a');
  const clientA = clientWith(async (_name, options) => {
    if (options.body.action === 'list') return { data: { ok: true, items: [credential] }, error: null };
    return pendingDetails.promise;
  });
  await accesses.open(clientA, 'user-a');
  const editing = editButton().click();
  accesses.reset();
  pendingDetails.resolve({ data: { ok: true, item: { ...credential, password: 'SEGREDO-A', notes: '' } }, error: null });
  await editing;
  assert(!elements.get('accessFormDialog').open, 'O modal antigo foi reaberto.');
  assert(elements.get('accessPassword').value !== 'SEGREDO-A', 'A senha antiga reapareceu no formulário.');
});

test('reveal e cópia pendentes não sobrevivem ao logout', async () => {
  const pendingReveal = deferred();
  const credential = item('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'usuario-a');
  const clientA = clientWith(async (_name, options) => {
    if (options.body.action === 'list') return { data: { ok: true, items: [credential] }, error: null };
    return pendingReveal.promise;
  });
  await accesses.open(clientA, 'user-a');
  clipboardWrites.length = 0;
  const copying = passwordCopyButton().click();
  accesses.reset();
  pendingReveal.resolve({ data: { ok: true, password: 'SEGREDO-A' }, error: null });
  await copying;
  assert(clipboardWrites.length === 0, 'Uma operação antiga escreveu na área de transferência.');
  assert(!listText().includes('SEGREDO-A'), 'A senha antiga reapareceu na interface.');
});

test('reveal visual atrasado é descartado após logout', async () => {
  const pendingReveal = deferred();
  const credential = item('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'usuario-a');
  const clientA = clientWith(async (_name, options) => {
    if (options.body.action === 'list') return { data: { ok: true, items: [credential] }, error: null };
    return pendingReveal.promise;
  });
  await accesses.open(clientA, 'user-a');
  const revealing = passwordRevealButton().click();
  accesses.reset();
  pendingReveal.resolve({ data: { ok: true, password: 'SEGREDO-A' }, error: null });
  await revealing;
  assert(!listText().includes('SEGREDO-A'), 'Uma revelação antiga reapareceu depois do logout.');
});

test('sair da página oculta imediatamente uma senha revelada', async () => {
  const credential = item('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'usuario-a');
  const clientA = clientWith(async (_name, options) => options.body.action === 'list'
    ? { data: { ok: true, items: [credential] }, error: null }
    : { data: { ok: true, password: 'SEGREDO-A' }, error: null });
  await accesses.open(clientA, 'user-a');
  await passwordRevealButton().click();
  assert(listText().includes('SEGREDO-A'), 'A senha não foi revelada para preparar o teste.');
  accesses.leave();
  assert(!listText().includes('SEGREDO-A'), 'A senha continuou na interface depois da navegação.');
});

test('token inválido é tratado sem exibir credenciais', async () => {
  const invalid = clientWith(async () => ({
    data: null,
    error: { message: 'Unauthorized', context: { json: async () => ({ error: 'Sessão inválida ou expirada.' }) } },
  }));
  await accesses.open(invalid, 'user-a');
  assert(elements.get('accessStatus').textContent.includes('Sessão inválida'), 'O erro de token não foi apresentado com segurança.');
  assert(!listText().includes('SEGREDO'), 'Dados sensíveis foram exibidos após token inválido.');
  accesses.reset();
});

test('falha de reordenação restaura a ordem anterior', async () => {
  const first = item('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'primeiro');
  const second = item('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'segundo');
  const client = clientWith(async (_name, options) => {
    if (options.body.action === 'list') return { data: { ok: true, items: [first, second] }, error: null };
    return { data: null, error: { message: 'Falha controlada' } };
  });
  await accesses.open(client, 'user-a');
  const moveSecondUp = secondRow().children[5].children[0].children[0];
  await moveSecondUp.click();
  assert(elements.get('accessList').children[0].innerText.includes('primeiro'), 'A ordem anterior não foi restaurada.');
  assert(elements.get('accessStatus').textContent.includes('Falha controlada'), 'A falha de reordenação não foi informada.');
});

test('reordenação repetida enquanto pendente não cria segunda requisição', async () => {
  const pendingOrder = deferred();
  let reorderCalls = 0;
  const first = item('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'primeiro');
  const second = item('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'segundo');
  const client = clientWith(async (_name, options) => {
    if (options.body.action === 'list') return { data: { ok: true, items: [first, second] }, error: null };
    reorderCalls += 1;
    return pendingOrder.promise;
  });
  await accesses.open(client, 'user-a');
  const moveSecondUp = secondRow().children[5].children[0].children[0];
  const firstMove = moveSecondUp.click();
  await moveSecondUp.click();
  assert(reorderCalls === 1, 'Uma segunda reordenação foi enviada enquanto a primeira estava pendente.');
  pendingOrder.resolve({ data: { ok: true }, error: null });
  await firstMove;
});

let failures = 0;
for (const { name, operation } of tests) {
  try {
    await operation();
    console.log(`OK  ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`ERRO  ${name}: ${error.message}`);
  } finally {
    accesses.reset();
  }
}

if (failures) throw new Error(`${failures} teste(s) falharam.`);
console.log(`${tests.length} testes de isolamento de sessão aprovados.`);
