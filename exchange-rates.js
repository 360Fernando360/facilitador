(function exposeExchangeRates(global) {
  const supported = new Set(['USD', 'EUR', 'GBP', 'CAD']);
  const latest = new Map();

  function normalize(row) {
    const currency = String(row?.currency || '').toUpperCase();
    const rateSell = Number(row?.rate_sell);
    if (!supported.has(currency) || !Number.isFinite(rateSell) || rateSell <= 0 || !row?.reference_date) return null;
    return Object.freeze({
      currency,
      currencyName: row.currency_name,
      rateSell,
      referenceDate: row.reference_date,
      fetchedAt: row.fetched_at,
      source: row.source,
    });
  }

  async function loadLatest(supabaseClient) {
    const { data, error } = await supabaseClient.rpc('get_latest_exchange_rates');
    if (error) throw error;
    latest.clear();
    (data || []).map(normalize).filter(Boolean).forEach((rate) => latest.set(rate.currency, rate));
    return all();
  }

  function get(currency) {
    return latest.get(String(currency || '').toUpperCase()) || null;
  }

  function all() {
    return [...latest.values()];
  }

  global.ExchangeRates = Object.freeze({ loadLatest, get, all });
})(window);
