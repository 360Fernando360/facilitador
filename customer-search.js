(function createCustomerSearch(global) {
  'use strict';

  const SEARCH_CONFIG = Object.freeze({
    nome: Object.freeze({ label: 'Nome do cliente', placeholder: 'Digite ao menos 3 caracteres', help: 'Pesquisa por razão social, nome chave, nome fantasia ou nome da agência.' }),
    codigo: Object.freeze({ label: 'Código Sica', placeholder: 'Digite o código numérico', help: 'A consulta pelo Código Sica é exata.' }),
    cnpj: Object.freeze({ label: 'CPF/CNPJ', placeholder: 'Digite CPF ou CNPJ', help: 'Você pode informar o documento com ou sem pontuação.' }),
  });

  function textOrNull(value) {
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
    const text = typeof value === 'string' ? value.trim() : '';
    return text || null;
  }

  function toCustomer(record, index = 0) {
    const code = textOrNull(record?.code);
    return Object.freeze({
      id: textOrNull(record?.id) || code || `resultado-${index + 1}`,
      code,
      legalName: textOrNull(record?.legalName),
      keyName: textOrNull(record?.keyName),
      tradeName: textOrNull(record?.tradeName),
      active: typeof record?.active === 'boolean' ? record.active : null,
      branchCode: textOrNull(record?.branchCode),
      branchName: textOrNull(record?.branchName),
      executiveName: textOrNull(record?.executiveName),
      executiveEmail: textOrNull(record?.executiveEmail),
    });
  }

  function displayName(customer) {
    return customer.legalName || customer.tradeName || customer.keyName || customer.code || 'Cliente sem identificação';
  }

  function validateSearch(type, rawValue) {
    const value = String(rawValue || '').trim();
    if (!SEARCH_CONFIG[type]) throw new Error('Selecione um tipo de consulta válido.');
    if (!value || value.length > 120) throw new Error('Informe um valor válido para a consulta.');
    if (type === 'nome') {
      if (value.length < 3) throw new Error('Informe ao menos 3 caracteres do nome.');
      return { type, value };
    }
    if (type === 'codigo') {
      if (!/^\d+$/.test(value)) throw new Error('O Código Sica deve conter somente números.');
      return { type, value };
    }
    if (!/^[\d.\-\/\s]+$/.test(value)) throw new Error('O CPF/CNPJ deve conter somente números e pontuação.');
    const digits = value.replace(/\D/g, '');
    if (![11, 14].includes(digits.length)) throw new Error('Informe um CPF com 11 dígitos ou CNPJ com 14 dígitos.');
    return { type, value: digits };
  }

  async function functionErrorMessage(error) {
    let message = error?.message || 'Não foi possível concluir a consulta.';
    try {
      const details = await error?.context?.json();
      if (details?.error?.message) message = details.error.message;
      else if (typeof details?.error === 'string') message = details.error;
    } catch (_ignored) {}
    return message;
  }

  function createApiAdapter(client) {
    return Object.freeze({
      mode: 'api',
      async search(type, value) {
        if (!client?.functions?.invoke) throw new Error('Serviço de consulta indisponível. Entre novamente e tente outra vez.');
        const search = validateSearch(type, value);
        const { data, error } = await client.functions.invoke('customer-search-proxy', { body: search });
        if (error) throw new Error(await functionErrorMessage(error));
        if (!data?.ok || !Array.isArray(data.customers)) throw new Error('O serviço de clientes retornou uma resposta inválida.');
        return Object.freeze({
          customers: data.customers.map(toCustomer),
          total: Number.isFinite(data.total) ? data.total : data.customers.length,
          limit: Number.isFinite(data.limit) ? data.limit : 20,
          limitReached: data.limitReached === true,
        });
      },
    });
  }

  let adapter = null;
  const state = { loading: false, results: [], selected: null, generation: 0, limitReached: false };
  const elements = {};

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function setLoading(loading) {
    state.loading = loading;
    elements.type.disabled = loading;
    elements.input.disabled = loading;
    elements.submit.disabled = loading;
    elements.submit.textContent = loading ? 'Consultando...' : 'Buscar';
    elements.form.setAttribute('aria-busy', String(loading));
  }

  function setFormMessage(message, type = '') {
    elements.formMessage.textContent = message;
    elements.formMessage.className = `customer-search-message ${type}`.trim();
  }

  function showPanel(panel) {
    [elements.initial, elements.loading, elements.resultsPanel, elements.empty, elements.error, elements.detail]
      .forEach((item) => item.classList.toggle('hidden', item !== panel));
  }

  function renderInitial() {
    showPanel(elements.initial);
    elements.status.textContent = 'Informe os dados para consultar um cliente.';
  }

  function statusLabel(active) {
    return active === true ? 'Ativo' : active === false ? 'Inativo' : 'Situação não informada';
  }

  function renderResults(results) {
    elements.results.replaceChildren();
    results.forEach((customer) => {
      const button = element('button', 'customer-result');
      button.type = 'button';
      button.append(
        element('strong', '', displayName(customer)),
        element('span', '', `Código Sica: ${customer.code || 'Não informado'} · ${statusLabel(customer.active)}`),
      );
      button.addEventListener('click', () => selectCustomer(customer));
      elements.results.appendChild(button);
    });
    elements.resultCount.textContent = `${results.length} ${results.length === 1 ? 'resultado encontrado' : 'resultados encontrados'}`;
    elements.limitNotice.classList.toggle('hidden', !state.limitReached);
    elements.status.textContent = elements.resultCount.textContent;
    showPanel(elements.resultsPanel);
  }

  function detailRow(label, value) {
    const row = element('div', 'customer-detail-row');
    row.append(element('dt', '', label), element('dd', '', value || 'Não informado'));
    return row;
  }

  function selectCustomer(customer) {
    state.selected = customer;
    elements.detailName.textContent = displayName(customer);
    elements.detailFields.replaceChildren(
      detailRow('Código Sica', customer.code),
      detailRow('Razão social', customer.legalName),
      detailRow('Nome chave', customer.keyName),
      detailRow('Nome fantasia', customer.tradeName),
      detailRow('Situação do cliente', statusLabel(customer.active)),
      detailRow('Filial', [customer.branchCode, customer.branchName].filter(Boolean).join(' — ')),
      detailRow('Executivo responsável', customer.executiveName),
      detailRow('E-mail do executivo', customer.executiveEmail),
    );
    elements.status.textContent = `Ficha de ${displayName(customer)}.`;
    showPanel(elements.detail);
  }

  function resetResults() {
    state.generation++;
    state.results = [];
    state.selected = null;
    state.limitReached = false;
    elements.results.replaceChildren();
    elements.detailFields.replaceChildren();
    elements.limitNotice.classList.add('hidden');
    renderInitial();
  }

  function updateSearchType() {
    const config = SEARCH_CONFIG[elements.type.value] || SEARCH_CONFIG.nome;
    elements.inputLabel.textContent = config.label;
    elements.input.placeholder = config.placeholder;
    elements.help.textContent = config.help;
    elements.input.inputMode = elements.type.value === 'nome' ? 'search' : 'numeric';
    elements.input.value = '';
    setFormMessage('');
    resetResults();
    elements.input.focus();
  }

  async function search(event) {
    event?.preventDefault();
    if (state.loading) return;
    let validated;
    try {
      validated = validateSearch(elements.type.value, elements.input.value);
      setFormMessage('');
    } catch (error) {
      setFormMessage(error.message, 'error');
      elements.input.focus();
      return;
    }
    const generation = ++state.generation;
    state.results = [];
    state.selected = null;
    state.limitReached = false;
    elements.results.replaceChildren();
    setLoading(true);
    elements.status.textContent = 'Consultando clientes...';
    showPanel(elements.loading);
    try {
      if (!adapter) throw new Error('Serviço de consulta indisponível. Entre novamente e tente outra vez.');
      const result = await adapter.search(validated.type, validated.value);
      if (generation !== state.generation) return;
      state.results = result.customers;
      state.limitReached = result.limitReached;
      if (state.results.length) renderResults(state.results);
      else {
        elements.status.textContent = 'Nenhum cliente encontrado.';
        showPanel(elements.empty);
      }
    } catch (error) {
      if (generation !== state.generation) return;
      elements.errorMessage.textContent = error.message || 'Não foi possível concluir a consulta.';
      elements.status.textContent = elements.errorMessage.textContent;
      showPanel(elements.error);
    } finally {
      if (generation === state.generation) setLoading(false);
    }
  }

  function backToResults() {
    state.selected = null;
    if (state.results.length) renderResults(state.results);
    else renderInitial();
  }

  function clearSearch() {
    elements.input.value = '';
    setFormMessage('');
    resetResults();
    elements.input.focus();
  }

  function reset(options = {}) {
    state.generation++;
    state.results = [];
    state.selected = null;
    state.limitReached = false;
    adapter = null;
    if (!elements.form) return;
    setLoading(false);
    elements.form.reset();
    elements.type.value = 'nome';
    elements.inputLabel.textContent = SEARCH_CONFIG.nome.label;
    elements.input.placeholder = SEARCH_CONFIG.nome.placeholder;
    elements.input.inputMode = 'search';
    elements.help.textContent = SEARCH_CONFIG.nome.help;
    setFormMessage('');
    elements.results.replaceChildren();
    elements.detailFields.replaceChildren();
    elements.limitNotice.classList.add('hidden');
    renderInitial();
    if (options.focus) elements.input.focus();
  }

  function open(client) {
    if (!elements.form) return;
    adapter = createApiAdapter(client);
    if (!elements.input.value && !state.results.length && !state.selected) renderInitial();
    elements.input.focus();
  }

  function init() {
    const form = document.getElementById('customerSearchForm');
    if (!form) return;
    Object.assign(elements, {
      form,
      type: document.getElementById('customerSearchType'),
      inputLabel: document.getElementById('customerSearchLabel'),
      input: document.getElementById('customerSearchValue'),
      help: document.getElementById('customerSearchHelp'),
      formMessage: document.getElementById('customerSearchFormMessage'),
      submit: document.getElementById('customerSearchSubmit'),
      clear: document.getElementById('customerSearchClear'),
      status: document.getElementById('customerSearchStatus'),
      initial: document.getElementById('customerSearchInitial'),
      loading: document.getElementById('customerSearchLoading'),
      resultsPanel: document.getElementById('customerSearchResultsPanel'),
      results: document.getElementById('customerSearchResults'),
      resultCount: document.getElementById('customerSearchResultCount'),
      limitNotice: document.getElementById('customerSearchLimitNotice'),
      empty: document.getElementById('customerSearchEmpty'),
      error: document.getElementById('customerSearchError'),
      errorMessage: document.getElementById('customerSearchErrorMessage'),
      detail: document.getElementById('customerSearchDetail'),
      detailName: document.getElementById('customerSearchDetailName'),
      detailFields: document.getElementById('customerSearchDetailFields'),
      back: document.getElementById('customerSearchBack'),
    });
    form.addEventListener('submit', search);
    elements.type.addEventListener('change', updateSearchType);
    elements.clear.addEventListener('click', clearSearch);
    elements.back.addEventListener('click', backToResults);
    reset();
  }

  global.CustomerSearchData = Object.freeze({ SEARCH_CONFIG, toCustomer, displayName, validateSearch, createApiAdapter });
  global.CustomerSearch = Object.freeze({ init, open, reset });
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
    else init();
  }
})(typeof window === 'undefined' ? globalThis : window);
