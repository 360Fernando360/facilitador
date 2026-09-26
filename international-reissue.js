(function exposeInternationalReissue(global) {
  const FIELD_LABELS = Object.freeze([
    ['fareDifference', 'Diferença de tarifa'],
    ['taxDifference', 'Diferença de taxa'],
    ['penalty', 'Multa'],
    ['trustFee', 'Fee confiança'],
    ['agencyDu', 'DU AGT'],
  ]);

  function roundMoney(value) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.round((number + Number.EPSILON) * 100) / 100 : 0;
  }

  function convert(value, rate, sourceCurrency) {
    const amount = Number(value);
    const exchangeRate = Number(rate);
    if (!Number.isFinite(amount) || !Number.isFinite(exchangeRate) || exchangeRate <= 0) return null;
    return sourceCurrency === 'USD'
      ? { usd: roundMoney(amount), brl: roundMoney(amount * exchangeRate) }
      : { usd: roundMoney(amount / exchangeRate), brl: roundMoney(amount) };
  }

  function totals(values) {
    return FIELD_LABELS.reduce((result, [key]) => ({
      usd: roundMoney(result.usd + Number(values[key]?.usd || 0)),
      brl: roundMoney(result.brl + Number(values[key]?.brl || 0)),
    }), { usd: 0, brl: 0 });
  }

  function formatAmount(value) {
    return Number(value || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function copyText(values, rate) {
    const total = totals(values);
    return [
      'VALOR POR PESSOA',
      `Câmbio: ${Number(rate).toLocaleString('pt-BR', { minimumFractionDigits: 4, maximumFractionDigits: 4 })}`,
      '',
      ...FIELD_LABELS.map(([key, label]) => `${label}: USD ${formatAmount(values[key]?.usd)} | BRL ${formatAmount(values[key]?.brl)}`),
      `TOTAL: USD ${formatAmount(total.usd)} | BRL ${formatAmount(total.brl)}`,
    ].join('\n');
  }

  global.InternationalReissue = Object.freeze({ FIELD_LABELS, convert, totals, copyText });
})(typeof window === 'undefined' ? globalThis : window);
