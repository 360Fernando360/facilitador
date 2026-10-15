(function createQuotationBuilder(global) {
  'use strict';

  const PROFILE_FIELD_LABELS = Object.freeze({
    seat: 'Assento',
    carryOn: 'Bagagem de mão',
    checked: 'Bagagem despachada',
    change: 'Alteração',
    refund: 'Reembolso',
    noShow: 'No-show',
    openTicket: 'Deixar em aberto',
  });
  const state = {
    client: null,
    organizationId: null,
    userId: null,
    role: null,
    airlineCode: '',
    blocks: [],
    texts: [],
    loadingTexts: false,
    profileOrder: [],
    profileOrderId: null,
    loadingProfileOrder: false,
    savingProfileOrder: false,
    generation: 0,
    editingTextId: null,
  };
  const elements = {};

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function airlines() {
    return Array.isArray(global.INTERNATIONAL_FARES)
      ? global.INTERNATIONAL_FARES
      : typeof INTERNATIONAL_FARES !== 'undefined' ? INTERNATIONAL_FARES : [];
  }

  function profileText(company, profile) {
    const lines = Object.entries(profile?.fields || {})
      .filter(([key, value]) => PROFILE_FIELD_LABELS[key] && typeof value === 'string' && value.trim())
      .map(([key, value]) => `${PROFILE_FIELD_LABELS[key].toUpperCase()}: ${value}`);
    return [`${company.code} - ${company.name}`, `PERFIL: ${profile.name}`, '', ...lines].join('\n');
  }

  function composeQuotation(sourceText, blocks) {
    const orderedBlocks = [...(blocks || [])].sort((left, right) => {
      const priority = { text: 0, profile: 1 };
      return (priority[left?.type] ?? 2) - (priority[right?.type] ?? 2);
    });
    let output = '';
    for (const block of orderedBlocks) {
      const content = String(block?.content ?? '');
      if (!content) continue;
      if (output) output += output.endsWith('\n\n') ? '' : output.endsWith('\n') ? '\n' : '\n\n';
      output += content;
    }
    const source = String(sourceText ?? '');
    if (source) {
      if (output) output += output.endsWith('\n\n') ? '' : output.endsWith('\n') ? '\n' : '\n\n';
      output += source;
    }
    return output;
  }

  function canManage() {
    return state.role === 'admin' || state.role === 'manager';
  }

  function operationGeneration() {
    return state.generation;
  }

  function isCurrent(generation) {
    return generation === state.generation && Boolean(state.client && state.organizationId && state.userId);
  }

  function setMessage(message = '', type = '') {
    elements.message.textContent = message;
    elements.message.className = `quote-message ${type}`.trim();
  }

  function currentCompany() {
    return airlines().find((company) => company.code === state.airlineCode) || null;
  }

  function orderProfileEntries(profiles, profileOrder = []) {
    const occurrences = new Map();
    const entries = (profiles || []).map((profile, originalIndex) => {
      const occurrence = (occurrences.get(profile.name) || 0) + 1;
      occurrences.set(profile.name, occurrence);
      return { profile, originalIndex, key: `${encodeURIComponent(profile.name)}:${occurrence}` };
    });
    const positions = new Map(profileOrder.map((key, index) => [key, index]));
    return entries.sort((left, right) => {
      const leftPosition = positions.has(left.key) ? positions.get(left.key) : profileOrder.length + left.originalIndex;
      const rightPosition = positions.has(right.key) ? positions.get(right.key) : profileOrder.length + right.originalIndex;
      return leftPosition - rightPosition;
    });
  }

  function profileEntries(company = currentCompany()) {
    return orderProfileEntries(company?.profiles, state.profileOrder);
  }

  function fillAirlineSelect(select, preferredCode) {
    select.replaceChildren();
    airlines().forEach((company) => select.add(new Option(`${company.code} — ${company.name}`, company.code)));
    if (preferredCode && airlines().some((company) => company.code === preferredCode)) select.value = preferredCode;
  }

  function selectedBlockKey(type, id) {
    return `${type}:${state.airlineCode}:${id}`;
  }

  function hasBlock(key) {
    return state.blocks.some((block) => block.key === key);
  }

  function addBlock(block) {
    if (hasBlock(block.key)) return;
    state.blocks.push(Object.freeze({ ...block }));
    state.blocks.sort((left, right) => (left.type === 'text' ? 0 : 1) - (right.type === 'text' ? 0 : 1));
    renderAvailable();
    renderBlocks();
  }

  function updateBlock(index, content) {
    const block = state.blocks[index];
    if (!block) return;
    state.blocks[index] = Object.freeze({ ...block, content });
    renderPreview();
  }

  function removeBlock(index) {
    state.blocks.splice(index, 1);
    renderAvailable();
    renderBlocks();
  }

  function moveBlock(index, offset) {
    const target = index + offset;
    if (target < 0 || target >= state.blocks.length) return;
    if (state.blocks[index].type !== state.blocks[target].type) return;
    [state.blocks[index], state.blocks[target]] = [state.blocks[target], state.blocks[index]];
    renderBlocks();
  }

  function renderProfiles() {
    elements.profiles.replaceChildren();
    const company = currentCompany();
    if (!company?.profiles?.length) {
      elements.profiles.appendChild(element('div', 'quote-empty', 'Nenhum perfil disponível para esta companhia.'));
      return;
    }
    const entries = profileEntries(company);
    entries.forEach(({ profile, originalIndex, key: profileKey }, index) => {
      const key = selectedBlockKey('profile', profileKey);
      const row = element('div', 'quote-option');
      const info = element('div', 'quote-option-info');
      info.append(element('strong', '', profile.name), element('span', '', 'Informações destinadas ao cliente disponíveis no perfil.'));
      const actions = element('div', 'quote-option-actions');
      if (canManage()) {
        const up = element('button', 'quote-icon-button', '↑');
        up.type = 'button'; up.title = 'Subir perfil'; up.disabled = index === 0 || state.loadingProfileOrder || state.savingProfileOrder;
        up.addEventListener('click', () => moveProfile(index, -1));
        const down = element('button', 'quote-icon-button', '↓');
        down.type = 'button'; down.title = 'Descer perfil'; down.disabled = index === entries.length - 1 || state.loadingProfileOrder || state.savingProfileOrder;
        down.addEventListener('click', () => moveProfile(index, 1));
        actions.append(up, down);
      }
      const button = element('button', 'btn secondary', hasBlock(key) ? 'Incluído ✓' : '+ Incluir perfil');
      button.type = 'button';
      button.disabled = hasBlock(key);
      button.addEventListener('click', () => addBlock({
        key,
        type: 'profile',
        title: profile.name,
        content: profileText(company, profile),
        sourceIndex: originalIndex,
      }));
      actions.appendChild(button);
      row.append(info, actions);
      elements.profiles.appendChild(row);
    });
  }

  async function loadProfileOrder() {
    if (!state.client || !state.organizationId || !state.airlineCode) return;
    const generation = operationGeneration();
    state.loadingProfileOrder = true;
    renderProfiles();
    const { data, error } = await state.client
      .from('quote_profile_orders')
      .select('id,profile_keys')
      .eq('organization_id', state.organizationId)
      .eq('airline_code', state.airlineCode)
      .maybeSingle();
    if (!isCurrent(generation)) return;
    state.loadingProfileOrder = false;
    if (error) {
      state.profileOrder = [];
      state.profileOrderId = null;
      setMessage('Não foi possível carregar a ordem dos perfis. A ordem original foi mantida.', 'error');
    } else {
      state.profileOrder = Array.isArray(data?.profile_keys) ? data.profile_keys : [];
      state.profileOrderId = data?.id || null;
    }
    renderProfiles();
  }

  async function moveProfile(index, offset) {
    if (!canManage() || state.savingProfileOrder) return;
    const entries = profileEntries();
    const target = index + offset;
    if (target < 0 || target >= entries.length) return;
    const previousOrder = [...state.profileOrder];
    [entries[index], entries[target]] = [entries[target], entries[index]];
    state.profileOrder = entries.map((entry) => entry.key);
    state.savingProfileOrder = true;
    renderProfiles();
    setMessage('Salvando ordem dos perfis...');
    const generation = operationGeneration();
    const payload = { profile_keys: state.profileOrder, updated_by: state.userId };
    const result = state.profileOrderId
      ? await state.client.from('quote_profile_orders').update(payload).eq('id', state.profileOrderId).eq('organization_id', state.organizationId)
      : await state.client.from('quote_profile_orders').insert({
        ...payload,
        organization_id: state.organizationId,
        airline_code: state.airlineCode,
        created_by: state.userId,
      }).select('id').single();
    if (!isCurrent(generation)) return;
    state.savingProfileOrder = false;
    if (result.error) {
      state.profileOrder = previousOrder;
      setMessage('Não foi possível salvar a ordem dos perfis. A alteração foi desfeita.', 'error');
    } else {
      if (!state.profileOrderId) state.profileOrderId = result.data?.id || null;
      setMessage('Ordem dos perfis salva.', 'success');
    }
    renderProfiles();
  }

  function renderComplementaryTexts() {
    elements.texts.replaceChildren();
    if (state.loadingTexts) {
      elements.texts.appendChild(element('div', 'quote-loading', 'Carregando textos da companhia...'));
      return;
    }
    const active = state.texts.filter((item) => item.is_active && item.airline_code === state.airlineCode);
    if (!active.length) {
      elements.texts.appendChild(element('div', 'quote-empty', 'Nenhum texto complementar ativo para esta companhia.'));
      return;
    }
    active.forEach((item) => {
      const key = selectedBlockKey('text', item.id);
      const row = element('div', 'quote-option');
      const info = element('div', 'quote-option-info');
      info.append(element('strong', '', item.title), element('span', '', item.content.replace(/\s+/g, ' ').slice(0, 110)));
      const button = element('button', 'btn secondary', hasBlock(key) ? 'Incluído ✓' : '+ Incluir texto');
      button.type = 'button';
      button.disabled = hasBlock(key);
      button.addEventListener('click', () => addBlock({
        key,
        type: 'text',
        title: item.title,
        content: `${item.title.toLocaleUpperCase('pt-BR')}\n${item.content}`,
        sourceId: item.id,
      }));
      row.append(info, button);
      elements.texts.appendChild(row);
    });
  }

  function renderAvailable() {
    renderProfiles();
    renderComplementaryTexts();
  }

  function renderPreview() {
    const output = composeQuotation(elements.source.value, state.blocks);
    elements.output.textContent = output || 'Cole o texto original do GDS e inclua os blocos desejados.';
    elements.output.classList.toggle('quote-preview-placeholder', !output);
    elements.count.textContent = `${state.blocks.length} ${state.blocks.length === 1 ? 'bloco' : 'blocos'}`;
    elements.copy.disabled = !output;
  }

  function renderBlocks() {
    elements.blocks.replaceChildren();
    state.blocks.forEach((block, index) => {
      const card = element('article', 'quote-block');
      const head = element('div', 'quote-block-head');
      const title = element('div', 'quote-block-title');
      title.append(
        element('span', 'quote-block-type', block.type === 'profile' ? 'Perfil' : 'Texto'),
        document.createTextNode(block.title),
      );
      const actions = element('div', 'quote-block-actions');
      const up = element('button', 'quote-icon-button', '↑');
      up.type = 'button'; up.title = 'Mover para cima'; up.disabled = index === 0 || state.blocks[index - 1]?.type !== block.type;
      up.addEventListener('click', () => moveBlock(index, -1));
      const down = element('button', 'quote-icon-button', '↓');
      down.type = 'button'; down.title = 'Mover para baixo'; down.disabled = index === state.blocks.length - 1 || state.blocks[index + 1]?.type !== block.type;
      down.addEventListener('click', () => moveBlock(index, 1));
      const remove = element('button', 'quote-icon-button', 'Remover');
      remove.type = 'button'; remove.addEventListener('click', () => removeBlock(index));
      actions.append(up, down, remove);
      head.append(title, actions);
      const textarea = document.createElement('textarea');
      textarea.value = block.content;
      textarea.maxLength = 6000;
      textarea.setAttribute('aria-label', `Conteúdo do bloco ${block.title}`);
      textarea.addEventListener('input', () => updateBlock(index, textarea.value));
      card.append(head, textarea);
      elements.blocks.appendChild(card);
    });
    renderPreview();
  }

  async function loadTexts() {
    if (!state.client || !state.organizationId || !state.airlineCode) return;
    const generation = operationGeneration();
    state.loadingTexts = true;
    renderComplementaryTexts();
    setMessage('');
    let query = state.client
      .from('quote_complementary_texts')
      .select('id,airline_code,title,content,is_active,created_at,updated_at')
      .eq('organization_id', state.organizationId)
      .eq('airline_code', state.airlineCode)
      .order('title', { ascending: true });
    if (!canManage()) query = query.eq('is_active', true);
    const { data, error } = await query;
    if (!isCurrent(generation)) return;
    state.loadingTexts = false;
    if (error) {
      state.texts = [];
      elements.texts.replaceChildren(element('div', 'quote-error', 'Não foi possível carregar os textos complementares.'));
      setMessage('Falha ao carregar os textos. O conteúdo da cotação foi preservado.', 'error');
      renderManagerList();
      return;
    }
    state.texts = data || [];
    renderComplementaryTexts();
    renderManagerList();
  }

  async function changeAirline(event) {
    const nextCode = event.currentTarget.value;
    if (nextCode === state.airlineCode) return;
    if (state.blocks.length && !global.confirm('Trocar a companhia removerá os perfis e textos já incluídos. Continuar?')) {
      event.currentTarget.value = state.airlineCode;
      return;
    }
    state.generation++;
    state.airlineCode = nextCode;
    state.blocks = [];
    state.profileOrder = [];
    state.profileOrderId = null;
    state.loadingProfileOrder = false;
    state.savingProfileOrder = false;
    elements.managerAirline.value = nextCode;
    cancelManagerEdit();
    renderBlocks();
    renderAvailable();
    await Promise.all([loadTexts(), loadProfileOrder()]);
  }

  async function copyQuotation() {
    const text = composeQuotation(elements.source.value, state.blocks);
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setMessage('Cotação copiada.', 'success');
    } catch (_error) {
      setMessage('Não foi possível copiar automaticamente. Selecione a prévia e copie manualmente.', 'error');
    }
  }

  function clearQuotation() {
    const hasContent = Boolean(elements.source.value || state.blocks.length);
    if (hasContent && !global.confirm('Limpar o texto do GDS e todos os blocos incluídos?')) return;
    elements.source.value = '';
    elements.gds.value = '';
    state.blocks = [];
    renderAvailable();
    renderBlocks();
    setMessage('');
    elements.source.focus();
  }

  function managerPayload() {
    return {
      organization_id: state.organizationId,
      airline_code: elements.managerAirline.value,
      title: elements.managerTitle.value.trim(),
      content: elements.managerContent.value.trim(),
      is_active: elements.managerActive.checked,
      updated_by: state.userId,
    };
  }

  function setManagerFormBusy(busy) {
    elements.managerSave.disabled = busy;
    elements.managerSave.textContent = busy ? 'Salvando...' : 'Salvar texto';
  }

  function cancelManagerEdit() {
    state.editingTextId = null;
    if (!elements.managerForm) return;
    elements.managerForm.reset();
    elements.managerAirline.value = state.airlineCode || elements.airline.value;
    elements.managerActive.checked = true;
    elements.managerFormTitle.textContent = 'Novo texto complementar';
    elements.managerCancel.classList.add('hidden');
    elements.managerMessage.textContent = '';
  }

  async function saveManagerText(event) {
    event.preventDefault();
    if (!canManage() || !state.client) return;
    const payload = managerPayload();
    if (!payload.airline_code || !payload.title || !payload.content) return;
    const generation = operationGeneration();
    setManagerFormBusy(true);
    elements.managerMessage.textContent = '';
    let result;
    if (state.editingTextId) {
      result = await state.client.from('quote_complementary_texts').update(payload).eq('id', state.editingTextId).eq('organization_id', state.organizationId);
    } else {
      result = await state.client.from('quote_complementary_texts').insert({
        ...payload,
        created_by: state.userId,
      });
    }
    if (!isCurrent(generation)) return;
    setManagerFormBusy(false);
    if (result.error) {
      elements.managerMessage.textContent = 'Não foi possível salvar. O conteúdo preenchido foi preservado.';
      elements.managerMessage.className = 'quote-message error';
      return;
    }
    const savedAirline = payload.airline_code;
    cancelManagerEdit();
    elements.managerAirline.value = savedAirline;
    if (savedAirline === state.airlineCode) await loadTexts();
    else await loadManagerTexts(savedAirline);
    elements.managerMessage.textContent = 'Texto salvo.';
    elements.managerMessage.className = 'quote-message success';
  }

  function editManagerText(item) {
    state.editingTextId = item.id;
    elements.managerAirline.value = item.airline_code;
    elements.managerTitle.value = item.title;
    elements.managerContent.value = item.content;
    elements.managerActive.checked = item.is_active;
    elements.managerFormTitle.textContent = 'Editar texto complementar';
    elements.managerCancel.classList.remove('hidden');
    elements.managerTitle.focus();
  }

  async function toggleManagerText(item) {
    if (!canManage() || !state.client) return;
    const generation = operationGeneration();
    const { error } = await state.client
      .from('quote_complementary_texts')
      .update({ is_active: !item.is_active, updated_by: state.userId })
      .eq('id', item.id)
      .eq('organization_id', state.organizationId);
    if (!isCurrent(generation)) return;
    if (error) {
      elements.managerMessage.textContent = 'Não foi possível alterar a situação do texto.';
      elements.managerMessage.className = 'quote-message error';
      return;
    }
    if (item.airline_code === state.airlineCode) await loadTexts();
    else await loadManagerTexts(item.airline_code);
  }

  function renderManagerList() {
    if (!elements.managerList || !canManage()) return;
    elements.managerList.replaceChildren();
    const code = elements.managerAirline.value;
    const items = state.texts.filter((item) => item.airline_code === code);
    if (!items.length) {
      elements.managerList.appendChild(element('div', 'quote-empty', 'Nenhum texto cadastrado para esta companhia.'));
      return;
    }
    items.forEach((item) => {
      const row = element('article', 'quote-manager-item');
      const info = element('div');
      info.append(element('strong', '', item.title), element('p', '', item.content));
      info.appendChild(element('span', `quote-manager-status ${item.is_active ? '' : 'inactive'}`.trim(), item.is_active ? 'Ativo' : 'Inativo'));
      const actions = element('div', 'quote-manager-item-actions');
      const edit = element('button', 'btn secondary', 'Editar');
      edit.type = 'button'; edit.addEventListener('click', () => editManagerText(item));
      const toggle = element('button', 'btn secondary', item.is_active ? 'Desativar' : 'Ativar');
      toggle.type = 'button'; toggle.addEventListener('click', () => toggleManagerText(item));
      actions.append(edit, toggle);
      row.append(info, actions);
      elements.managerList.appendChild(row);
    });
  }

  async function loadManagerTexts(code) {
    if (!canManage() || !state.client) return;
    const generation = operationGeneration();
    elements.managerList.replaceChildren(element('div', 'quote-loading', 'Carregando textos...'));
    const { data, error } = await state.client
      .from('quote_complementary_texts')
      .select('id,airline_code,title,content,is_active,created_at,updated_at')
      .eq('organization_id', state.organizationId)
      .eq('airline_code', code)
      .order('title', { ascending: true });
    if (!isCurrent(generation)) return;
    if (error) {
      elements.managerList.replaceChildren(element('div', 'quote-error', 'Não foi possível carregar os textos.'));
      return;
    }
    if (code === state.airlineCode) state.texts = data || [];
    else {
      state.texts = [...state.texts.filter((item) => item.airline_code !== code), ...(data || [])];
    }
    renderManagerList();
    renderComplementaryTexts();
  }

  function showManager() {
    if (!canManage()) return;
    elements.builder.classList.add('hidden');
    elements.manager.classList.remove('hidden');
    elements.managerAirline.value = state.airlineCode;
    cancelManagerEdit();
    loadManagerTexts(state.airlineCode);
  }

  function hideManager() {
    elements.manager.classList.add('hidden');
    elements.builder.classList.remove('hidden');
    cancelManagerEdit();
  }

  function reset() {
    state.generation++;
    state.client = null;
    state.organizationId = null;
    state.userId = null;
    state.role = null;
    state.airlineCode = '';
    state.blocks = [];
    state.texts = [];
    state.loadingTexts = false;
    state.profileOrder = [];
    state.profileOrderId = null;
    state.loadingProfileOrder = false;
    state.savingProfileOrder = false;
    state.editingTextId = null;
    if (!elements.root) return;
    elements.source.value = '';
    elements.gds.value = '';
    elements.blocks.replaceChildren();
    elements.texts.replaceChildren();
    elements.profiles.replaceChildren();
    elements.output.textContent = 'Cole o texto original do GDS e inclua os blocos desejados.';
    elements.output.classList.add('quote-preview-placeholder');
    elements.manager.classList.add('hidden');
    elements.builder.classList.remove('hidden');
    setMessage('');
    cancelManagerEdit();
  }

  async function open(client, context) {
    if (!elements.root || !client || !context?.organizationId || !context?.userId) return;
    const changed = state.client !== client || state.organizationId !== context.organizationId || state.userId !== context.userId;
    state.client = client;
    state.organizationId = context.organizationId;
    state.userId = context.userId;
    state.role = context.role;
    elements.manage.classList.toggle('hidden', !canManage());
    if (changed) {
      state.generation++;
      state.blocks = [];
      state.texts = [];
      state.profileOrder = [];
      state.profileOrderId = null;
      state.airlineCode = elements.airline.value || airlines()[0]?.code || '';
      elements.source.value = '';
      elements.gds.value = '';
      elements.managerAirline.value = state.airlineCode;
      renderBlocks();
      renderAvailable();
      await Promise.all([loadTexts(), loadProfileOrder()]);
    }
  }

  function init() {
    const root = document.getElementById('quotationBuilder');
    if (!root) return;
    Object.assign(elements, {
      root,
      builder: document.getElementById('quotationBuilderWorkspace'),
      manager: document.getElementById('quotationManager'),
      manage: document.getElementById('quotationManageButton'),
      managerClose: document.getElementById('quotationManagerClose'),
      gds: document.getElementById('quotationGds'),
      airline: document.getElementById('quotationAirline'),
      source: document.getElementById('quotationSource'),
      profiles: document.getElementById('quotationProfiles'),
      texts: document.getElementById('quotationTexts'),
      output: document.getElementById('quotationPreview'),
      blocks: document.getElementById('quotationBlocks'),
      count: document.getElementById('quotationBlockCount'),
      copy: document.getElementById('quotationCopy'),
      clear: document.getElementById('quotationClear'),
      message: document.getElementById('quotationMessage'),
      managerForm: document.getElementById('quotationManagerForm'),
      managerFormTitle: document.getElementById('quotationManagerFormTitle'),
      managerAirline: document.getElementById('quotationManagerAirline'),
      managerTitle: document.getElementById('quotationManagerTitle'),
      managerContent: document.getElementById('quotationManagerContent'),
      managerActive: document.getElementById('quotationManagerActive'),
      managerSave: document.getElementById('quotationManagerSave'),
      managerCancel: document.getElementById('quotationManagerCancel'),
      managerMessage: document.getElementById('quotationManagerMessage'),
      managerList: document.getElementById('quotationManagerList'),
    });
    fillAirlineSelect(elements.airline);
    fillAirlineSelect(elements.managerAirline);
    state.airlineCode = elements.airline.value;
    elements.airline.addEventListener('change', changeAirline);
    elements.source.addEventListener('input', renderPreview);
    elements.copy.addEventListener('click', copyQuotation);
    elements.clear.addEventListener('click', clearQuotation);
    elements.manage.addEventListener('click', showManager);
    elements.managerClose.addEventListener('click', hideManager);
    elements.managerForm.addEventListener('submit', saveManagerText);
    elements.managerCancel.addEventListener('click', cancelManagerEdit);
    elements.managerAirline.addEventListener('change', (event) => {
      const code = event.currentTarget.value;
      cancelManagerEdit();
      elements.managerAirline.value = code;
      loadManagerTexts(code);
    });
    renderBlocks();
    renderAvailable();
  }

  global.QuotationBuilderCore = Object.freeze({ PROFILE_FIELD_LABELS, profileText, composeQuotation, orderProfileEntries });
  global.QuotationBuilder = Object.freeze({ init, open, reset });
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
    else init();
  }
})(typeof window === 'undefined' ? globalThis : window);

