(function exposeExchangeRates(global) {
  let latestUsd = null;

  function normalize(row) {
    const currency = String(row?.currency || '').toUpperCase();
    const rateSell = Number(row?.rate_sell);
    if (currency !== 'USD' || !Number.isFinite(rateSell) || rateSell <= 0 || !row?.reference_date || !row?.fetched_at) return null;
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
    latestUsd = normalize((data || [])[0]);
    return latestUsd;
  }

  function getUsd() {
    return latestUsd;
  }

  global.ExchangeRates = Object.freeze({ loadLatest, getUsd });
})(window);
