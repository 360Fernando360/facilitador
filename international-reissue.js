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

  function normalizeSabreText(text) {
    return String(text || '')
      .replace(/<\s*br\s*\/?\s*>/gi, '\n')
      .replace(/<\/(?:div|p|tr|td|th|li|section)>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;|&#160;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/\r/g, '')
      .replace(/[\u200b-\u200d\ufeff]/g, '')
      .replace(/[\t\u00a0]+/g, ' ')
      .replace(/[ ]{2,}/g, ' ')
      .trim();
  }

  function parseSabreNumber(value) {
    const raw = String(value || '').replace(/\s/g, '').replace(/^(?:BRL|R\$)/i, '');
    if (!raw || /^(?:N\/?A|-+)$/i.test(raw)) return null;
    let normalized = raw;
    if (raw.includes(',') && raw.includes('.')) {
      normalized = raw.lastIndexOf(',') > raw.lastIndexOf('.')
        ? raw.replace(/\./g, '').replace(',', '.')
        : raw.replace(/,/g, '');
    } else if (raw.includes(',')) {
      normalized = raw.replace(/\./g, '').replace(',', '.');
    }
    const number = Number(normalized);
    return Number.isFinite(number) ? roundMoney(number) : null;
  }

  function sabreValueAfterLabel(text, labelPattern) {
    const stop = '(?=Tarifa\\s+base|Tarifa\\s+equivalente|Tarifa\\s+total\\s+BRL|(?:Total\\s+)?d(?:a|as)\\s+(?:taxas|multa\\s+por\\s+altera(?:ç|c)[aã]o)|Valor\\s+d(?:a|o)\\s+multa\\s+por\\s+altera(?:ç|c)[aã]o|Total\\s+BRL|$)';
    const match = text.match(new RegExp(`${labelPattern}([\\s\\S]*?)${stop}`, 'i'));
    if (!match) return { present: false, value: null, raw: '' };
    const raw = match[1].trim();
    if (!raw || /^(?:N\/?A|-+)$/i.test(raw)) return { present: true, value: null, raw };
    const numbers = raw.match(/-?(?:BRL\s*|R\$\s*)?\d+(?:[.,]\d+)*/gi) || [];
    return { present: true, value: numbers.length ? parseSabreNumber(numbers[numbers.length - 1]) : null, raw };
  }

  function sameMoney(left, right) {
    return Math.abs(roundMoney(left) - roundMoney(right)) <= 0.01;
  }

  function sabreTaxSummaryValue(tax) {
    if (!tax.present) return null;
    const summary = tax.raw.split(/\n\s*[A-Z]{2}\s*(?=\n|$)/)[0];
    const numbers = summary.match(/-?(?:BRL\s*|R\$\s*)?\d+(?:[.,]\d+)*/gi) || [];
    return numbers.length ? parseSabreNumber(numbers[numbers.length - 1]) : null;
  }

  function parseSabreReissue(text) {
    const normalized = normalizeSabreText(text);
    if (!normalized) return { ok: false, reason: 'empty' };
    const currencyMatch = normalized.match(/Tarifa\s+base[\s:.-]*([A-Z]{3})\b/i);
    const fare = sabreValueAfterLabel(normalized, 'Tarifa\\s+equivalente');
    const tax = sabreValueAfterLabel(normalized, '(?:Total\\s+)?d(?:a|as)\\s+taxas');
    const taxSummaryValue = sabreTaxSummaryValue(tax);
    const penalty = sabreValueAfterLabel(normalized, '(?:Valor\\s+)?d(?:a|o)\\s+multa\\s+por\\s+altera(?:ç|c)[aã]o');
    const fareTotal = sabreValueAfterLabel(normalized, 'Tarifa\\s+total\\s+BRL');
    const total = sabreValueAfterLabel(normalized, '(?:^|\\n)\\s*Total\\s+BRL');
    const result = {
      ok: fare.value !== null || taxSummaryValue !== null || penalty.value !== null,
      currency: currencyMatch ? currencyMatch[1].toUpperCase() : null,
      fields: {
        fareDifference: { value: fare.value, status: fare.value === null ? 'pending' : 'identified' },
        taxDifference: { value: taxSummaryValue, status: taxSummaryValue === null ? 'pending' : 'identified' },
        penalty: { value: penalty.value, status: penalty.value === null ? 'pending' : 'identified' },
      },
      checks: { fareTotal: fareTotal.value, total: total.value },
    };
    if (!result.ok) return { ...result, reason: 'unrecognized' };

    const fareValue = result.fields.fareDifference.value;
    const penaltyValue = result.fields.penalty.value;
    const derivedTax = fareValue !== null && fareTotal.value !== null
      ? roundMoney(fareTotal.value - fareValue)
      : null;
    const totalWith = (taxValue) => fareValue !== null && taxValue !== null && total.value !== null
      ? roundMoney(fareValue + taxValue + (penaltyValue === null ? 0 : penaltyValue))
      : null;
    const explicitCloses = taxSummaryValue !== null && (total.value === null || sameMoney(totalWith(taxSummaryValue), total.value));
    const derivedCloses = derivedTax !== null && derivedTax >= 0
      && (total.value === null || sameMoney(totalWith(derivedTax), total.value));

    if (!explicitCloses && derivedCloses) {
      result.fields.taxDifference = { value: derivedTax, status: 'derived', note: 'Calculado pelos subtotais do Sabre' };
    } else if (!explicitCloses && total.value !== null) {
      result.fields.taxDifference = { value: null, status: 'pending' };
    }

    const finalTax = result.fields.taxDifference.value;
    const finalTotal = totalWith(finalTax);
    if (total.value !== null && finalTotal !== null && !sameMoney(finalTotal, total.value)) {
      result.fields.taxDifference = { value: null, status: 'pending' };
      result.checks.matches = false;
    } else {
      result.checks.matches = total.value === null || finalTotal === null ? null : true;
    }
    return result;
  }

  function passengerSummaryText(blocks) {
    const types = ['ADT', 'CHD', 'INF'].filter((type) => blocks[type]);
    const rate = types.map((type) => Number(blocks[type].rate)).find((value) => Number.isFinite(value) && value > 0);
    const rowsByType = Object.fromEntries(types.map((type) => {
      const block = blocks[type],total=block.total;
      const rows = [
        ...FIELD_LABELS.map(([key, label]) => ({ label, usd: formatAmount(block.values[key]?.usd), brl: formatAmount(block.values[key]?.brl) })),
        { label: 'TOTAL', usd: formatAmount(total.usd), brl: formatAmount(total.brl) },
      ];
      return [type, rows];
    }));
    const allRows=Object.values(rowsByType).flat();
    const labelWidth=Math.max(0,...allRows.map(({label})=>label.length));
    const usdWidth=Math.max(0,...allRows.map(({usd})=>usd.length));
    const brlWidth=Math.max(0,...allRows.map(({brl})=>brl.length));
    const summaries=types.map((type) => {
      return [
        `Valores por Passageiro ${type}`,
        ...rowsByType[type].map(({label,usd,brl})=>`${label.padEnd(labelWidth,'.')}: USD ${usd.padStart(usdWidth)} | BRL ${brl.padStart(brlWidth)}`),
      ].join('\n');
    }).join('\n\n');
    return rate ? `Câmbio: ${rate.toLocaleString('pt-BR',{minimumFractionDigits:4,maximumFractionDigits:4})}\n\n${summaries}` : summaries;
  }

  function passengerSummaryHtml(blocks) {
    const text = passengerSummaryText(blocks);
    const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return `<pre style="margin:0;font-family:Consolas,'Courier New',monospace;font-size:13px;line-height:1.5;white-space:pre;color:#111827">${escaped}</pre>`;
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
    const text = copyText(values, rate);
    const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return `<pre style="margin:0;font-family:Consolas,'Courier New',monospace;font-size:13px;line-height:1.5;white-space:pre;color:#111827">${escaped}</pre>`;
  }

  global.InternationalReissue = Object.freeze({ FIELD_LABELS, convert, totals, copyText, copyHtml, parseSabreReissue, passengerSummaryText, passengerSummaryHtml });
})(typeof window === 'undefined' ? globalThis : window);
