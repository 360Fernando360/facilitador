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

  function copyHtml(values, rate) {
    const total = totals(values);
    const rows = [
      ...FIELD_LABELS.map(([key, label]) => ({
        label,
        usd: formatAmount(values[key]?.usd),
        brl: formatAmount(values[key]?.brl),
        total: false,
      })),
      { label: 'TOTAL', usd: formatAmount(total.usd), brl: formatAmount(total.brl), total: true },
    ];
    const cells = rows.map(({ label, usd, brl, total: isTotal }) => {
      const weight = isTotal ? 'font-weight:700;' : '';
      const border = isTotal ? 'border-top:1px solid #64748b;' : '';
      return `<tr><td style="padding:2px 14px 2px 0;${weight}${border}">${label}</td><td style="padding:2px 14px 2px 0;text-align:right;white-space:nowrap;${weight}${border}">USD&nbsp;${usd}</td><td style="padding:2px 0;text-align:right;white-space:nowrap;${weight}${border}">BRL&nbsp;${brl}</td></tr>`;
    }).join('');
    const formattedRate = Number(rate).toLocaleString('pt-BR', { minimumFractionDigits: 4, maximumFractionDigits: 4 });
    return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.35;color:#111827"><div>Câmbio: ${formattedRate}</div><div style="font-weight:700;margin:2px 0 12px">VALORES POR PESSOA</div><table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#111827"><tbody>${cells}</tbody></table></div>`;
  }

  global.InternationalReissue = Object.freeze({ FIELD_LABELS, convert, totals, copyText, copyHtml });
})(typeof window === 'undefined' ? globalThis : window);
