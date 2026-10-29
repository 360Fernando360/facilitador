(function createInternationalFareProfiles(global) {
  'use strict';

  const FIELD_LABELS = Object.freeze({
    seat: 'Assento', carryOn: 'Bagagem de mão', checked: 'Bagagem despachada',
    change: 'Alteração', refund: 'Reembolso', noShow: 'No-show', openTicket: 'Deixar em aberto',
  });
  const CATEGORIES = Object.freeze([
    { id: 'economy', label: 'Classe Econômica', icon: '✈' },
    { id: 'premium', label: 'Premium', icon: '◈' },
    { id: 'business', label: 'Business', icon: '▣' },
    { id: 'first', label: 'Primeira', icon: '★' },
  ]);
  const state = {
    client: null, organizationId: null, userId: null, role: null, company: null,
    settings: new Map(), categoryVisibility: new Map(), selectedKey: '', managing: false,
    generation: 0, databaseAvailable: true,
  };
  const elements = {};

  function airlines() {
    return Array.isArray(global.INTERNATIONAL_FARES)
      ? global.INTERNATIONAL_FARES
      : typeof INTERNATIONAL_FARES !== 'undefined' ? INTERNATIONAL_FARES : [];
  }

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function canManage() { return state.role === 'admin'; }

  function normalizeName(value) {
    return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
  }

  function defaultCategory(profileName) {
    const name = normalizeName(profileName);
    if (/\bFIRST\b|PRIMEIRA/.test(name)) return 'first';
    if (/\bBUS(?:INESS)?\b|BUS[A-Z]|EXECUT|PREMIER ONE|CLASSE C/.test(name)) return 'business';
    if (/PREMIUM ECONOMY|PREMECO|AM PLUS|\bPREMIUM\b/.test(name)) return 'premium';
    return 'economy';
  }

  function profileAbbreviation(profileName) {
    const first = String(profileName || '').split(/\s+-\s+|\s+/)[0].replace(/[^A-Za-z0-9]/g, '');
    return first.slice(0, 6).toUpperCase() || 'PERFIL';
  }

  function profileEntries(company) {
    const occurrences = new Map();
    return (company?.profiles || []).map((profile, index) => {
      const occurrence = (occurrences.get(profile.name) || 0) + 1;
      occurrences.set(profile.name, occurrence);
      return { profile, index, key: `${encodeURIComponent(profile.name)}:${occurrence}` };
    });
  }

  function effectiveSetting(entry) {
    const saved = state.settings.get(entry.key);
    return {
      category: CATEGORIES.some((item) => item.id === saved?.category) ? saved.category : defaultCategory(entry.profile.name),
      ruleUpdatedOn: saved?.rule_updated_on || entry.profile.updatedAt || null,
    };
  }

  function formatDate(value) {
    if (!value) return 'Data de revisão não informada';
    const parts = String(value).slice(0, 10).split('-');
    return parts.length === 3 ? `Atualizado em: ${parts[2]}/${parts[1]}/${parts[0]}` : 'Data de revisão não informada';
  }

  function isMissingTable(error) {
    const message = [error?.message, error?.details, error?.hint].filter(Boolean).join(' ').toLowerCase();
    return ['42P01', 'PGRST205', 'PGRST204'].includes(error?.code) || message.includes('international_fare_');
  }

  function setStatus(message = '', type = '') {
    if (!elements.status) return;
    elements.status.textContent = message;
    elements.status.className = `international-fare-status ${type}`.trim();
  }

  function closeMenus(except) {
    document.querySelectorAll('.international-category-menu').forEach((menu) => {
      if (menu !== except) menu.classList.add('hidden');
    });
  }

  function categoryIsVisible(categoryId) {
    return state.categoryVisibility.get(categoryId) !== false;
  }

  function groupedEntries() {
    const groups = new Map(CATEGORIES.map((category) => [category.id, []]));
    profileEntries(state.company).forEach((entry) => groups.get(effectiveSetting(entry).category).push(entry));
    return groups;
  }

  function createAdminProfile(entry) {
    const wrapper = element('div', 'international-profile-admin');
    const button = createProfileButton(entry);
    const controls = element('div', 'international-profile-admin-controls');
    const select = element('select');
    select.setAttribute('aria-label', `Categoria de ${entry.profile.name}`);
    CATEGORIES.forEach((category) => select.add(new Option(category.label, category.id)));
    const setting = effectiveSetting(entry);
    select.value = setting.category;
    const date = element('input');
    date.type = 'date';
    date.value = setting.ruleUpdatedOn || '';
    date.setAttribute('aria-label', `Data de revisão de ${entry.profile.name}`);
    const save = element('button', 'btn secondary', 'Salvar');
    save.type = 'button';
    save.addEventListener('click', () => saveProfileSetting(entry, select.value, date.value, save));
    controls.append(select, date, save);
    wrapper.append(button, controls);
    return wrapper;
  }

  function createProfileButton(entry) {
    const button = element('button', `international-profile${state.selectedKey === entry.key ? ' active' : ''}`);
    button.type = 'button';
    button.dataset.profileKey = entry.key;
    const name = element('span', 'international-profile-name', entry.profile.name);
    const code = element('span', 'international-profile-code', profileAbbreviation(entry.profile.name));
    button.append(name, code);
    button.addEventListener('click', () => selectProfile(entry, button));
    return button;
  }

  function createCategoryMenu(category, entries) {
    const button = element('button', 'international-category-menu-button', '⋮');
    button.type = 'button';
    button.title = `Ações de ${category.label}`;
    button.setAttribute('aria-label', button.title);
    const menu = element('div', 'international-category-menu hidden');
    const visible = categoryIsVisible(category.id);
    const action = element('button', visible ? 'danger' : '', visible ? 'Ocultar categoria nesta companhia' : 'Restaurar categoria');
    action.type = 'button';
    action.disabled = visible && entries.length > 0;
    action.title = action.disabled ? 'Mova todos os perfis antes de ocultar esta categoria.' : '';
    action.addEventListener('click', () => saveCategoryVisibility(category.id, !visible, action));
    menu.append(action);
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      const willOpen = menu.classList.contains('hidden');
      closeMenus(menu);
      menu.classList.toggle('hidden', !willOpen);
    });
    return { button, menu };
  }

  function renderGroups() {
    if (!elements.profiles) return;
    const groups = groupedEntries();
    elements.profiles.replaceChildren();
    CATEGORIES.forEach((category) => {
      const entries = groups.get(category.id);
      const visible = categoryIsVisible(category.id);
      if (!state.managing && (!visible || !entries.length)) return;
      const group = element('section', `international-profile-group${visible ? '' : ' is-hidden-category'}`);
      group.dataset.category = category.id;
      const head = element('div', 'international-profile-group-head');
      head.append(element('span', 'international-profile-group-icon', category.icon), element('h3', '', category.label));
      head.append(element('span', 'international-profile-group-count', visible ? `${entries.length} perfil${entries.length === 1 ? '' : 'is'}` : 'oculta'));
      if (state.managing) {
        const controls = createCategoryMenu(category, entries);
        head.append(controls.button, controls.menu);
      }
      const list = element('div', 'international-profile-list');
      if (!entries.length) list.append(element('div', 'international-profile-empty', 'Nenhum perfil nesta categoria.'));
      else entries.forEach((entry) => list.append(state.managing ? createAdminProfile(entry) : createProfileButton(entry)));
      group.append(head, list);
      elements.profiles.append(group);
    });
    if (!elements.profiles.children.length) elements.profiles.append(element('div', 'international-empty', 'Nenhum perfil disponível para esta companhia.'));
  }

  function selectProfile(entry, button) {
    state.selectedKey = entry.key;
    document.querySelectorAll('#internationalProfiles .international-profile').forEach((item) => item.classList.remove('active'));
    button?.classList.add('active');
    const profile = entry.profile;
    const entries = Object.entries(profile.fields || {}).filter(([key, value]) => FIELD_LABELS[key] && value);
    const details = element('div', 'international-detail-grid');
    entries.forEach(([key, value]) => {
      const detail = element('div', 'international-detail');
      detail.append(element('strong', '', FIELD_LABELS[key]), element('span', typeof global.fareStatusClass === 'function' ? global.fareStatusClass(value) : '', value));
      details.append(detail);
    });
    const head = element('div', 'international-description-head');
    head.append(element('h3', '', profile.name));
    const actions = element('div', 'international-description-actions');
    actions.append(element('span', 'international-updated-badge', formatDate(effectiveSetting(entry).ruleUpdatedOn)));
    const copy = element('button', 'btn secondary', 'Copiar perfil');
    copy.type = 'button'; copy.addEventListener('click', copySelected);
    const report = element('button', 'btn secondary international-report-button', '⚠ Informar regra desatualizada');
    report.type = 'button'; report.addEventListener('click', () => reportOutdated(entry, report));
    actions.append(copy, report); head.append(actions);
    const copyText = [`${state.company.code} - ${state.company.name}`, `PERFIL: ${profile.name}`, '', ...entries.map(([key, value]) => `${FIELD_LABELS[key].toUpperCase()}: ${value}`)].join('\n');
    const hiddenCopy = element('pre', 'copy-output', copyText); hiddenCopy.id = 'internationalFareCopyText';
    hiddenCopy.hidden = true;
    elements.description.replaceChildren(head, details, hiddenCopy);
  }

  function selectFirstProfile() {
    const groups = groupedEntries();
    let entry = profileEntries(state.company).find((item) => item.key === state.selectedKey);
    if (entry && !categoryIsVisible(effectiveSetting(entry).category) && !state.managing) entry = null;
    if (!entry) {
      for (const category of CATEGORIES) {
        if (state.managing || categoryIsVisible(category.id)) {
          entry = groups.get(category.id)[0];
          if (entry) break;
        }
      }
    }
    if (!entry) {
      elements.description.innerHTML = '<div class="international-empty">Nenhum perfil disponível para esta companhia.</div>';
      return;
    }
    state.selectedKey = entry.key;
    const button = [...document.querySelectorAll('#internationalProfiles .international-profile')].find((item) => item.dataset.profileKey === entry.key);
    selectProfile(entry, button);
  }

  function render() {
    if (!state.company) return;
    elements.manage?.classList.toggle('hidden', !canManage());
    if (elements.manage) elements.manage.textContent = state.managing ? 'Concluir gestão' : '⚙ Gerenciar categorias';
    renderGroups();
    selectFirstProfile();
  }

  async function loadSettings() {
    const generation = ++state.generation;
    state.settings = new Map(); state.categoryVisibility = new Map(); state.databaseAvailable = true;
    if (!state.client || !state.organizationId || !state.company) { render(); return; }
    const [profilesResult, categoriesResult] = await Promise.all([
      state.client.from('international_fare_profile_settings').select('profile_key,category,rule_updated_on').eq('organization_id', state.organizationId).eq('airline_code', state.company.code),
      state.client.from('international_fare_category_settings').select('category,is_visible').eq('organization_id', state.organizationId).eq('airline_code', state.company.code),
    ]);
    if (generation !== state.generation) return;
    const error = profilesResult.error || categoriesResult.error;
    if (error) {
      state.databaseAvailable = !isMissingTable(error);
      setStatus(isMissingTable(error) ? 'Classificação padrão ativa. A persistência será habilitada após aplicar a migração.' : 'Não foi possível carregar as categorias salvas.', 'error');
      render(); return;
    }
    (profilesResult.data || []).forEach((item) => state.settings.set(item.profile_key, item));
    (categoriesResult.data || []).forEach((item) => state.categoryVisibility.set(item.category, item.is_visible));
    setStatus(''); render();
  }

  async function saveProfileSetting(entry, category, ruleUpdatedOn, button) {
    if (!canManage() || !state.client || !state.organizationId || !state.userId) return;
    button.disabled = true; button.textContent = 'Salvando...';
    if (!categoryIsVisible(category)) {
      const visibilityPayload = { organization_id: state.organizationId, airline_code: state.company.code, category, is_visible: true, updated_by: state.userId };
      const { error: visibilityError } = await state.client.from('international_fare_category_settings').upsert(visibilityPayload, { onConflict: 'organization_id,airline_code,category' });
      if (visibilityError) {
        button.disabled = false; button.textContent = 'Salvar';
        setStatus('Não foi possível restaurar a categoria de destino.', 'error'); return;
      }
      state.categoryVisibility.set(category, true);
    }
    const payload = { organization_id: state.organizationId, airline_code: state.company.code, profile_key: entry.key, profile_name: entry.profile.name, category, rule_updated_on: ruleUpdatedOn || null, updated_by: state.userId };
    const { data, error } = await state.client.from('international_fare_profile_settings').upsert(payload, { onConflict: 'organization_id,airline_code,profile_key' }).select('profile_key,category,rule_updated_on').single();
    button.disabled = false; button.textContent = 'Salvar';
    if (error) { setStatus('Não foi possível salvar a categoria.', 'error'); return; }
    state.settings.set(entry.key, data); setStatus('Perfil atualizado com sucesso.', 'success'); render();
  }

  async function saveCategoryVisibility(category, visible, button) {
    if (!canManage() || !state.client || !state.organizationId || !state.userId) return;
    button.disabled = true;
    const payload = { organization_id: state.organizationId, airline_code: state.company.code, category, is_visible: visible, updated_by: state.userId };
    const { error } = await state.client.from('international_fare_category_settings').upsert(payload, { onConflict: 'organization_id,airline_code,category' });
    if (error) { button.disabled = false; setStatus('Não foi possível atualizar a categoria.', 'error'); return; }
    state.categoryVisibility.set(category, visible); setStatus(visible ? 'Categoria restaurada.' : 'Categoria ocultada para esta companhia.', 'success'); render();
  }

  async function reportOutdated(entry, button) {
    if (!state.client || !state.organizationId || !state.userId) { alert('Não foi possível registrar o aviso nesta sessão.'); return; }
    button.disabled = true; button.textContent = 'Enviando...';
    const payload = { organization_id: state.organizationId, airline_code: state.company.code, profile_key: entry.key, profile_name: entry.profile.name, reported_by: state.userId };
    const { error } = await state.client.from('international_fare_outdated_reports').insert(payload);
    button.disabled = false; button.textContent = '⚠ Informar regra desatualizada';
    if (error) { setStatus('Não foi possível registrar o aviso.', 'error'); return; }
    setStatus('Obrigado. A regra foi sinalizada para revisão.', 'success');
  }

  async function copySelected() {
    const text = document.getElementById('internationalFareCopyText')?.textContent;
    if (!text) return;
    try { await navigator.clipboard.writeText(text); alert('Informações do perfil copiadas.'); }
    catch (_error) { alert('Não foi possível copiar automaticamente.'); }
  }

  function selectCompany(code) {
    state.company = airlines().find((company) => company.code === code) || null;
    state.selectedKey = '';
    if (!state.company) return;
    loadSettings();
  }

  function toggleManage() {
    if (!canManage()) return;
    state.managing = !state.managing;
    closeMenus(); render();
  }

  function init() {
    if (elements.root) return;
    Object.assign(elements, {
      root: document.getElementById('internationalFareProfilesCard'),
      profiles: document.getElementById('internationalProfiles'),
      description: document.getElementById('internationalFareDescription'),
      manage: document.getElementById('internationalFareManage'),
      status: document.getElementById('internationalFareStatus'),
    });
    if (!elements.root) return;
    elements.manage?.addEventListener('click', toggleManage);
    document.addEventListener('click', () => closeMenus());
  }

  function open(client, context) {
    init();
    state.client = client || null; state.organizationId = context?.organizationId || null;
    state.userId = context?.userId || null; state.role = context?.role || null;
    state.managing = false;
    const code = document.getElementById('internationalAirline')?.value;
    if (code) selectCompany(code); else render();
  }

  function reset() {
    state.generation++; state.client = null; state.organizationId = null; state.userId = null; state.role = null;
    state.settings = new Map(); state.categoryVisibility = new Map(); state.managing = false;
    setStatus('');
  }

  global.InternationalFareProfilesCore = Object.freeze({ CATEGORIES, defaultCategory, profileEntries, profileAbbreviation, formatDate });
  global.InternationalFareProfiles = Object.freeze({ init, open, reset, selectCompany, copySelected });
})(typeof window === 'undefined' ? globalThis : window);
