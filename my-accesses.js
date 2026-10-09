(function createMyAccesses(global) {
  'use strict';

  const state = {
    client: null,
    userId: null,
    initialized: false,
    loading: false,
    reordering: false,
    items: [],
    query: '',
    draggedId: null,
    deleteId: null,
    revealed: new Map(),
    statusTimer: null,
    generation: 0,
  };
  const elements = {};

  class StaleOperationError extends Error {}

  function operationContext() {
    return {
      client: state.client,
      userId: state.userId,
      generation: state.generation,
    };
  }

  function isCurrentOperation(operation) {
    return Boolean(operation?.client) &&
      operation.client === state.client &&
      operation.userId === state.userId &&
      operation.generation === state.generation;
  }

  function requireCurrentOperation(operation) {
    if (!isCurrentOperation(operation)) throw new StaleOperationError();
  }

  function handleOperationError(error, handler) {
    if (!(error instanceof StaleOperationError)) handler(error);
  }

  function element(name, className, text) {
    const node = document.createElement(name);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function setStatus(message = '', type = '') {
    clearTimeout(state.statusTimer);
    elements.status.textContent = message;
    elements.status.className = `accesses-status ${type}`.trim();
    if (message && type !== 'error') state.statusTimer = setTimeout(() => setStatus(), 2600);
  }

  function setFormMessage(message = '') {
    elements.formMessage.textContent = message;
  }

  async function api(action, payload = {}, operation = operationContext()) {
    requireCurrentOperation(operation);
    const { data, error } = await operation.client.functions.invoke('credential-vault', { body: { action, ...payload } });
    requireCurrentOperation(operation);
    if (error) {
      let message = error.message || 'Não foi possível concluir a operação.';
      try {
        const details = await error.context?.json();
        requireCurrentOperation(operation);
        if (details?.error) message = details.error;
      } catch (_ignored) {
        // A resposta de erro nem sempre possui corpo JSON.
      }
      requireCurrentOperation(operation);
      throw new Error(message);
    }
    if (!data?.ok) throw new Error(data?.error || 'Não foi possível concluir a operação.');
    return data;
  }

  function clearRevealed() {
    state.revealed.forEach((entry) => clearTimeout(entry.timer));
    state.revealed.clear();
  }

  function clearForm() {
    elements.form.reset();
    elements.credentialId.value = '';
    elements.password.type = 'password';
    elements.formPasswordToggle.textContent = 'Mostrar';
    elements.formPasswordToggle.setAttribute('aria-label', 'Mostrar senha');
    elements.generatePassword.textContent = '🎲 Gerar senha segura';
    elements.passwordProfile.textContent = '';
    elements.saveButton.disabled = false;
    setFormMessage();
  }

  function closeForm() {
    if (elements.formDialog.open) elements.formDialog.close();
    clearForm();
  }

  function initialize() {
    if (state.initialized) return;
    Object.assign(elements, {
      newButton: document.getElementById('accessNewButton'),
      refreshButton: document.getElementById('accessRefreshButton'),
      search: document.getElementById('accessSearch'),
      status: document.getElementById('accessStatus'),
      list: document.getElementById('accessList'),
      empty: document.getElementById('accessEmpty'),
      formDialog: document.getElementById('accessFormDialog'),
      form: document.getElementById('accessForm'),
      formTitle: document.getElementById('accessFormTitle'),
      credentialId: document.getElementById('accessCredentialId'),
      title: document.getElementById('accessTitle'),
      portalUrl: document.getElementById('accessPortalUrl'),
      agencyId: document.getElementById('accessAgencyId'),
      username: document.getElementById('accessUsername'),
      password: document.getElementById('accessPassword'),
      notes: document.getElementById('accessNotes'),
      formPasswordToggle: document.getElementById('accessFormPasswordToggle'),
      generatePassword: document.getElementById('accessGeneratePassword'),
      passwordProfile: document.getElementById('accessPasswordProfile'),
      formMessage: document.getElementById('accessFormMessage'),
      saveButton: document.getElementById('accessSaveButton'),
      deleteDialog: document.getElementById('accessDeleteDialog'),
      deleteTitle: document.getElementById('accessDeleteTitle'),
    });

    elements.newButton.addEventListener('click', openNew);
    elements.refreshButton.addEventListener('click', () => load(true));
    elements.search.addEventListener('input', () => {
      state.query = elements.search.value.trim().toLocaleLowerCase('pt-BR');
      render();
    });
    elements.form.addEventListener('submit', saveCredential);
    elements.formDialog.querySelectorAll('[data-access-close]').forEach((button) => button.addEventListener('click', closeForm));
    elements.formDialog.addEventListener('close', clearForm);
    elements.formPasswordToggle.addEventListener('click', toggleFormPassword);
    elements.generatePassword.addEventListener('click', generateIntoForm);
    elements.password.addEventListener('input', updatePasswordProfile);
    elements.deleteDialog.addEventListener('close', () => {
      if (elements.deleteDialog.returnValue === 'confirm') deleteCredential();
    });
    state.initialized = true;
  }

  async function open(client, userId) {
    initialize();
    if (!client || !userId) {
      setStatus('Sessão indisponível.', 'error');
      return;
    }
    if (state.userId && state.userId !== userId) reset();
    state.client = client;
    state.userId = userId;
    await load(false);
  }

  async function load(force) {
    if (state.loading || (!force && state.items.length)) return;
    const operation = operationContext();
    state.loading = true;
    elements.refreshButton.disabled = true;
    setStatus('Carregando acessos...');
    try {
      const data = await api('list', {}, operation);
      requireCurrentOperation(operation);
      state.items = Array.isArray(data.items) ? data.items : [];
      render();
      setStatus(state.items.length ? 'Acessos atualizados.' : '');
    } catch (error) {
      handleOperationError(error, (currentError) => setStatus(currentError.message, 'error'));
    } finally {
      if (isCurrentOperation(operation)) {
        state.loading = false;
        elements.refreshButton.disabled = false;
      }
    }
  }

  function copyButton(label, valueProvider) {
    const button = element('button', 'accesses-mini-button', '📋');
    button.type = 'button';
    button.title = `Copiar ${label}`;
    button.setAttribute('aria-label', `Copiar ${label}`);
    button.addEventListener('click', async () => {
      const operation = operationContext();
      const original = button.textContent;
      button.disabled = true;
      try {
        const value = await valueProvider(operation);
        requireCurrentOperation(operation);
        await navigator.clipboard.writeText(value);
        requireCurrentOperation(operation);
        button.textContent = '✓';
        button.classList.add('accesses-copy-feedback');
        setStatus(`✓ ${label.charAt(0).toUpperCase() + label.slice(1)} ${label === 'senha' ? 'copiada' : 'copiado'}.`);
      } catch (error) {
        handleOperationError(error, (currentError) => setStatus(currentError.message || `Não foi possível copiar ${label}.`, 'error'));
      } finally {
        if (isCurrentOperation(operation)) {
          setTimeout(() => {
            if (!isCurrentOperation(operation)) return;
            button.textContent = original;
            button.classList.remove('accesses-copy-feedback');
            button.disabled = false;
          }, 1300);
        }
      }
    });
    return button;
  }

  function detailCell(className, label, value) {
    const container = element('div', `accesses-detail ${className}`);
    container.append(element('span', 'accesses-detail-label', `${label}:`), element('span', 'accesses-detail-value', value));
    return container;
  }

  function actionButton(text, label, handler) {
    const button = element('button', 'accesses-mini-button', text);
    button.type = 'button';
    button.title = label;
    button.setAttribute('aria-label', label);
    button.addEventListener('click', handler);
    return button;
  }

  function render() {
    elements.list.replaceChildren();
    const filtered = state.query
      ? state.items.filter((item) => item.title.toLocaleLowerCase('pt-BR').includes(state.query))
      : state.items;
    elements.empty.classList.toggle('hidden', filtered.length > 0);
    elements.empty.textContent = state.query ? 'Nenhum acesso encontrado.' : 'Nenhum acesso cadastrado.';
    filtered.forEach((item) => elements.list.appendChild(renderRow(item)));
  }

  function renderRow(item) {
    const row = element('div', 'accesses-row');
    row.dataset.id = item.id;

    const handle = element('button', 'accesses-handle', '☰');
    handle.type = 'button';
    handle.title = state.query ? 'Limpe a busca para reorganizar' : 'Arrastar para reorganizar';
    handle.setAttribute('aria-label', handle.title);
    handle.draggable = !state.query && !state.reordering;
    handle.disabled = Boolean(state.query) || state.reordering;
    handle.addEventListener('dragstart', (event) => {
      state.draggedId = item.id;
      row.classList.add('dragging');
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', item.id);
    });
    handle.addEventListener('dragend', () => {
      state.draggedId = null;
      document.querySelectorAll('.accesses-row').forEach((node) => node.classList.remove('dragging', 'drag-target'));
    });
    row.addEventListener('dragover', (event) => {
      if (!state.draggedId || state.query || state.draggedId === item.id) return;
      event.preventDefault();
      row.classList.add('drag-target');
    });
    row.addEventListener('dragleave', () => row.classList.remove('drag-target'));
    row.addEventListener('drop', (event) => {
      event.preventDefault();
      row.classList.remove('drag-target');
      if (state.draggedId && state.draggedId !== item.id) reorderByDrop(state.draggedId, item.id, event.clientY > row.getBoundingClientRect().top + row.offsetHeight / 2);
    });

    const name = element('div', 'accesses-name');
    const title = item.portalUrl ? element('a', '', `${item.title} ↗`) : element('strong', '', item.title);
    if (item.portalUrl) {
      title.href = item.portalUrl;
      title.target = '_blank';
      title.rel = 'noopener noreferrer';
    }
    name.appendChild(title);
    if (item.hasNotes) {
      const note = element('span', 'accesses-note-indicator', 'Possui observação');
      name.appendChild(note);
    }

    const agency = detailCell('accesses-agency', 'Agência', item.agencyId || '');
    if (item.agencyId) agency.appendChild(copyButton('agência', () => item.agencyId));
    else agency.hidden = true;

    const username = detailCell('accesses-username', 'Usuário', item.username);
    username.appendChild(copyButton('usuário', () => item.username));

    const password = element('div', 'accesses-detail accesses-password');
    password.appendChild(element('span', 'accesses-detail-label', 'Senha:'));
    const revealed = state.revealed.get(item.id);
    password.appendChild(element('span', `accesses-detail-value ${revealed ? '' : 'accesses-password-mask'}`.trim(), revealed?.value || '••••••••••'));
    password.appendChild(copyButton('senha', async (operation) => {
      const data = await api('reveal', { id: item.id }, operation);
      const value = data.password;
      if (typeof value !== 'string') throw new Error('Senha indisponível.');
      return value;
    }));
    password.appendChild(actionButton(revealed ? '🙈' : '👁', revealed ? 'Ocultar senha' : 'Mostrar senha', () => toggleReveal(item.id)));

    const actions = element('div', 'accesses-row-actions');
    const moves = element('div', 'accesses-move-actions');
    const index = state.items.findIndex((candidate) => candidate.id === item.id);
    const up = actionButton('↑', 'Mover para cima', () => moveItem(item.id, -1));
    const down = actionButton('↓', 'Mover para baixo', () => moveItem(item.id, 1));
    up.disabled = Boolean(state.query) || state.reordering || index <= 0;
    down.disabled = Boolean(state.query) || state.reordering || index < 0 || index >= state.items.length - 1;
    moves.append(up, down);
    actions.append(moves, actionButton('✏', 'Editar acesso', () => openEdit(item.id)), actionButton('🗑', 'Excluir acesso', () => confirmDelete(item)));
    row.append(handle, name, agency, username, password, actions);
    return row;
  }

  async function toggleReveal(id) {
    const current = state.revealed.get(id);
    if (current) {
      clearTimeout(current.timer);
      state.revealed.delete(id);
      render();
      return;
    }
    const operation = operationContext();
    try {
      const data = await api('reveal', { id }, operation);
      requireCurrentOperation(operation);
      const entry = { value: data.password, timer: null };
      entry.timer = setTimeout(() => {
        if (!isCurrentOperation(operation)) return;
        state.revealed.delete(id);
        render();
      }, 20000);
      state.revealed.set(id, entry);
      render();
    } catch (error) {
      handleOperationError(error, (currentError) => setStatus(currentError.message, 'error'));
    }
  }

  async function persistOrder(previous) {
    if (state.reordering) return;
    const operation = operationContext();
    state.reordering = true;
    render();
    try {
      await api('reorder', { ids: state.items.map((item) => item.id) }, operation);
      requireCurrentOperation(operation);
      setStatus('✓ Ordem salva.');
    } catch (error) {
      if (error instanceof StaleOperationError) return;
      state.items = previous;
      setStatus(error.message, 'error');
    } finally {
      if (isCurrentOperation(operation)) {
        state.reordering = false;
        render();
      }
    }
  }

  function reorderByDrop(sourceId, targetId, after) {
    if (state.reordering) return;
    const previous = [...state.items];
    const sourceIndex = state.items.findIndex((item) => item.id === sourceId);
    const targetIndex = state.items.findIndex((item) => item.id === targetId);
    if (sourceIndex < 0 || targetIndex < 0) return;
    const [moved] = state.items.splice(sourceIndex, 1);
    let insertion = state.items.findIndex((item) => item.id === targetId);
    if (after) insertion += 1;
    state.items.splice(insertion, 0, moved);
    return persistOrder(previous);
  }

  function moveItem(id, direction) {
    if (state.query || state.reordering) return;
    const index = state.items.findIndex((item) => item.id === id);
    const next = index + direction;
    if (index < 0 || next < 0 || next >= state.items.length) return;
    const previous = [...state.items];
    [state.items[index], state.items[next]] = [state.items[next], state.items[index]];
    return persistOrder(previous);
  }

  function openNew() {
    clearForm();
    elements.formTitle.textContent = 'Novo acesso';
    elements.saveButton.textContent = 'Salvar';
    elements.formDialog.showModal();
    elements.title.focus();
  }

  async function openEdit(id) {
    const operation = operationContext();
    setStatus('Carregando acesso...');
    try {
      const data = await api('details', { id }, operation);
      requireCurrentOperation(operation);
      const item = data.item;
      clearForm();
      elements.formTitle.textContent = 'Editar acesso';
      elements.saveButton.textContent = 'Salvar alterações';
      elements.credentialId.value = item.id;
      elements.title.value = item.title || '';
      elements.portalUrl.value = item.portalUrl || '';
      elements.agencyId.value = item.agencyId || '';
      elements.username.value = item.username || '';
      elements.password.value = item.password || '';
      elements.notes.value = item.notes || '';
      updatePasswordProfile();
      elements.formDialog.showModal();
      elements.title.focus();
      setStatus();
    } catch (error) {
      handleOperationError(error, (currentError) => setStatus(currentError.message, 'error'));
    }
  }

  function validatePortal() {
    const value = elements.portalUrl.value.trim();
    if (!value) return true;
    try {
      const url = new URL(value);
      return url.protocol === 'https:' && !url.username && !url.password;
    } catch {
      return false;
    }
  }

  async function saveCredential(event) {
    event.preventDefault();
    setFormMessage();
    if (!elements.form.reportValidity()) return;
    if (!validatePortal()) {
      setFormMessage('Informe um link HTTPS completo, sem usuário ou senha incorporados.');
      elements.portalUrl.focus();
      return;
    }
    const id = elements.credentialId.value;
    const payload = {
      title: elements.title.value,
      portalUrl: elements.portalUrl.value,
      agencyId: elements.agencyId.value,
      username: elements.username.value,
      password: elements.password.value,
      notes: elements.notes.value,
    };
    elements.saveButton.disabled = true;
    elements.saveButton.textContent = 'Salvando...';
    const operation = operationContext();
    try {
      await api(id ? 'update' : 'create', id ? { id, ...payload } : payload, operation);
      requireCurrentOperation(operation);
      closeForm();
      state.items = [];
      await load(true);
      setStatus(id ? '✓ Acesso atualizado.' : '✓ Acesso criado.');
    } catch (error) {
      handleOperationError(error, (currentError) => setFormMessage(currentError.message));
    } finally {
      if (isCurrentOperation(operation)) {
        elements.saveButton.disabled = false;
        elements.saveButton.textContent = id ? 'Salvar alterações' : 'Salvar';
      }
    }
  }

  function toggleFormPassword() {
    const show = elements.password.type === 'password';
    elements.password.type = show ? 'text' : 'password';
    elements.formPasswordToggle.textContent = show ? 'Ocultar' : 'Mostrar';
    elements.formPasswordToggle.setAttribute('aria-label', show ? 'Ocultar senha' : 'Mostrar senha');
  }

  function passwordProfile(value) {
    return {
      length: value.length || 16,
      upper: /[A-Z]/.test(value) || !value,
      lower: /[a-z]/.test(value) || !value,
      number: /[0-9]/.test(value) || !value,
      symbol: /[^A-Za-z0-9]/.test(value) || !value,
    };
  }

  function profileDescription(value) {
    if (!value) return '';
    const profile = passwordProfile(value);
    const groups = [];
    if (profile.upper) groups.push('maiúsculas');
    if (profile.lower) groups.push('minúsculas');
    if (profile.number) groups.push('números');
    if (profile.symbol) groups.push('símbolos');
    return `${profile.length} caracteres • ${groups.join(' • ')}`;
  }

  function secureIndex(length) {
    if (!Number.isSafeInteger(length) || length < 1 || length > 0x100000000) throw new Error('Conjunto de caracteres inválido.');
    const range = 0x100000000;
    const limit = range - (range % length);
    const values = new Uint32Array(1);
    do crypto.getRandomValues(values); while (values[0] >= limit);
    return values[0] % length;
  }

  function securePassword(previous) {
    const profile = passwordProfile(previous);
    const sets = [];
    if (profile.upper) sets.push('ABCDEFGHJKLMNPQRSTUVWXYZ');
    if (profile.lower) sets.push('abcdefghijkmnopqrstuvwxyz');
    if (profile.number) sets.push('23456789');
    if (profile.symbol) sets.push('!@#$%&*+-_=?.');
    const length = Math.max(profile.length, sets.length);
    const all = sets.join('');
    let generated;
    do {
      const characters = sets.map((set) => set[secureIndex(set.length)]);
      while (characters.length < length) characters.push(all[secureIndex(all.length)]);
      for (let index = characters.length - 1; index > 0; index -= 1) {
        const swap = secureIndex(index + 1);
        [characters[index], characters[swap]] = [characters[swap], characters[index]];
      }
      generated = characters.join('');
    } while (generated === previous);
    return generated;
  }

  function generateIntoForm() {
    elements.password.value = securePassword(elements.password.value);
    elements.password.type = 'text';
    elements.formPasswordToggle.textContent = 'Ocultar';
    elements.formPasswordToggle.setAttribute('aria-label', 'Ocultar senha');
    elements.generatePassword.textContent = '🎲 Gerar outra';
    updatePasswordProfile();
    elements.password.focus();
    elements.password.select();
  }

  function updatePasswordProfile() {
    elements.passwordProfile.textContent = profileDescription(elements.password.value);
  }

  function confirmDelete(item) {
    state.deleteId = item.id;
    elements.deleteTitle.textContent = `Excluir ${item.title}?`;
    elements.deleteDialog.returnValue = '';
    elements.deleteDialog.showModal();
  }

  async function deleteCredential() {
    const id = state.deleteId;
    state.deleteId = null;
    if (!id) return;
    const operation = operationContext();
    setStatus('Excluindo acesso...');
    try {
      await api('delete', { id }, operation);
      requireCurrentOperation(operation);
      const revealed = state.revealed.get(id);
      if (revealed) clearTimeout(revealed.timer);
      state.revealed.delete(id);
      state.items = state.items.filter((item) => item.id !== id);
      render();
      setStatus('✓ Acesso excluído.');
    } catch (error) {
      handleOperationError(error, (currentError) => setStatus(currentError.message, 'error'));
    }
  }

  function reset() {
    state.generation += 1;
    state.loading = false;
    state.reordering = false;
    if (!state.initialized) return;
    clearRevealed();
    clearTimeout(state.statusTimer);
    state.client = null;
    state.userId = null;
    state.items = [];
    state.query = '';
    state.draggedId = null;
    state.deleteId = null;
    elements.search.value = '';
    elements.list.replaceChildren();
    elements.empty.classList.remove('hidden');
    elements.refreshButton.disabled = false;
    setStatus();
    closeForm();
    if (elements.deleteDialog.open) elements.deleteDialog.close();
  }

  function leave() {
    if (!state.initialized) return;
    state.generation += 1;
    state.loading = false;
    state.reordering = false;
    state.items = [];
    state.draggedId = null;
    state.deleteId = null;
    clearRevealed();
    elements.list.replaceChildren();
    elements.empty.classList.remove('hidden');
    elements.refreshButton.disabled = false;
    closeForm();
    if (elements.deleteDialog.open) elements.deleteDialog.close();
  }

  global.MyAccesses = Object.freeze({ open, reset, leave });
})(window);
