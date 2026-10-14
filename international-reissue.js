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
    const rows = [
      ...FIELD_LABELS.map(([key, label]) => ({
        label,
        usd: formatAmount(values[key]?.usd),
        brl: formatAmount(values[key]?.brl),
      })),
      { label: 'TOTAL', usd: formatAmount(total.usd), brl: formatAmount(total.brl) },
    ];
    const labelWidth = Math.max(...rows.map(({ label }) => label.length));
    const usdWidth = Math.max(...rows.map(({ usd }) => usd.length));
    const brlWidth = Math.max(...rows.map(({ brl }) => brl.length));
    const formattedRows = rows.map(({ label, usd, brl }) =>
      `${label.padEnd(labelWidth, '.')}: USD ${usd.padStart(usdWidth)} | BRL ${brl.padStart(brlWidth)}`
    );
    return [
      `Câmbio: ${Number(rate).toLocaleString('pt-BR', { minimumFractionDigits: 4, maximumFractionDigits: 4 })}`,
      'VALORES POR PESSOA',
      '',
      ...formattedRows,
    ].join('\n');
  }

  global.InternationalReissue = Object.freeze({ FIELD_LABELS, convert, totals, copyText });
})(typeof window === 'undefined' ? globalThis : window);
