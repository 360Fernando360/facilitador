import './international-reissue.js';

const calculator = globalThis.InternationalReissue;

function assertEquals(actual, expected, message) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${message}: esperado ${JSON.stringify(expected)}, recebido ${JSON.stringify(actual)}`);
  }
}

assertEquals(calculator.convert(10, 5.4321, 'USD'), { usd: 10, brl: 54.32 }, 'conversão USD para BRL');
assertEquals(calculator.convert(54.32, 5.4321, 'BRL'), { usd: 10, brl: 54.32 }, 'conversão BRL para USD');
assertEquals(calculator.convert(10, 0, 'USD'), null, 'PTAX inválida');
assertEquals(calculator.convert('', 5.4321, 'USD'), { usd: 0, brl: 0 }, 'campo vazio');

const values = {
  fareDifference: { usd: 10, brl: 54.32 },
  taxDifference: { usd: 2, brl: 10.86 },
  penalty: { usd: 3, brl: 16.30 },
  trustFee: { usd: 4, brl: 21.73 },
  agencyDu: { usd: 1, brl: 5.43 },
};

assertEquals(calculator.totals(values), { usd: 20, brl: 108.64 }, 'totais nas duas moedas');

const copied = calculator.copyText(values, 5.4321);
assertEquals(copied.split('\n').slice(0, 3), ['Câmbio: 5,4321', 'VALORES POR PESSOA', ''], 'ordem do cabeçalho copiado');
for (const expected of ['VALORES POR PESSOA', 'Câmbio: 5,4321', 'Diferença de tarifa: USD 10,00 | BRL  54,32', 'TOTAL..............: USD 20,00 | BRL 108,64']) {
  if (!copied.includes(expected)) throw new Error(`texto de cópia sem: ${expected}`);
}

const varied = calculator.copyText({
  fareDifference: { usd: 0, brl: 12345.67 },
  taxDifference: { usd: 125.5, brl: 0 },
  penalty: { usd: 12345.67, brl: 125.5 },
  trustFee: { usd: 0, brl: 0 },
  agencyDu: { usd: 0, brl: 0 },
}, 5.0096);
const variedRows = varied.split('\n').slice(3);
assertEquals(variedRows[0], 'Diferença de tarifa: USD      0,00 | BRL 12.345,67', 'alinhamento com BRL longo');
assertEquals(variedRows[1], 'Diferença de taxa..: USD    125,50 | BRL      0,00', 'alinhamento com valor intermediário');
assertEquals(variedRows[2], 'Multa..............: USD 12.345,67 | BRL    125,50', 'alinhamento com USD longo');
const colonColumns = new Set(variedRows.map((line) => line.indexOf(':')));
const separatorColumns = new Set(variedRows.map((line) => line.indexOf('|')));
assertEquals([...colonColumns], [19], 'dois-pontos na mesma coluna');
assertEquals(separatorColumns.size, 1, 'separador na mesma coluna');

const copiedHtml = calculator.copyHtml(values, 5.4321);
for (const expected of ['<pre', 'font-family:Consolas', 'white-space:pre', 'Câmbio: 5,4321', 'VALORES POR PESSOA', 'Diferença de tarifa', 'USD 10,00', 'BRL  54,32', 'TOTAL']) {
  if (!copiedHtml.includes(expected)) throw new Error(`HTML de cópia sem: ${expected}`);
}
if (copiedHtml.includes('undefined')) throw new Error('HTML de cópia contém valor indefinido');

const sabreCase1 = calculator.parseSabreReissue(`
  Tarifa base USD
  Tarifa equivalente        163.86
  das taxas                  0.00
  Total BRL                  163.86
`);
assertEquals(sabreCase1.currency, 'USD', 'moeda original USD');
assertEquals(sabreCase1.fields.fareDifference, { value: 163.86, status: 'identified' }, 'tarifa do caso 1');
assertEquals(sabreCase1.fields.taxDifference, { value: 0, status: 'identified' }, 'zero explícito do caso 1');
assertEquals(sabreCase1.fields.penalty, { value: null, status: 'pending' }, 'multa ausente do caso 1');

const sabreCase2 = calculator.parseSabreReissue(`
  Tarifa base       USD
  Tarifa equivalente      546.21
  Total das taxas         4
  Tarifa total BRL        586.21
  Valor da multa por alteração   1086.95
  Total BRL               1673.16
`);
assertEquals(sabreCase2.fields.fareDifference.value, 546.21, 'tarifa do caso 2');
assertEquals(sabreCase2.fields.taxDifference, { value: 40, status: 'derived', note: 'Calculado pelos subtotais do Sabre' }, 'taxa recuperada do caso 2');
assertEquals(sabreCase2.fields.penalty.value, 1086.95, 'multa do caso 2');
assertEquals(sabreCase2.checks.matches, true, 'conferência do total do caso 2');

const sabreRealLayout = calculator.parseSabreReissue(`
  Reemitir Bilhete
  Reemissão Novo Reemissão (Reissue)
  Tarifa base USD
  2065.00
  2165.00
  10
  Tarifa equivalente
  10344.82
  546.21
  das taxas
  632.98
  671.52
  4
  US
  255.62
  AY
  61.16
  DU
  0.00
  40.00
  40.00
  Tarifa total BRL
  10977.80
  586.21
  da multa por alteração
  1086.95
  Total BRL
  RedefinirAtualizar
  1673.16
`);
assertEquals(sabreRealLayout.currency, 'USD', 'moeda no layout real do Sabre');
assertEquals(sabreRealLayout.fields.fareDifference.value, 546.21, 'tarifa no layout real do Sabre');
assertEquals(sabreRealLayout.fields.taxDifference, { value: 40, status: 'derived', note: 'Calculado pelos subtotais do Sabre' }, 'taxa truncada antes do detalhamento por código');
assertEquals(sabreRealLayout.fields.penalty.value, 1086.95, 'multa no layout real do Sabre');

const sabreTableLayout = calculator.parseSabreReissue(`
  Tarifa base USD 2065.00 2165.00 100.00
  Tarifa equivalente BRL 10344.82 546.21
  Total das taxas BRL 632.98 671.52 40.00
  Tarifa total BRL 10977.80 586.21
  Valor da multa por alteração 1086.95
  Código de taxa da multa
  Total BRL Redefinir Atualizar 1673.16
`);
assertEquals(sabreTableLayout.currency, 'USD', 'moeda no formato tabular do Sabre');
assertEquals(sabreTableLayout.fields.fareDifference.value, 546.21, 'tarifa no formato tabular do Sabre');
assertEquals(sabreTableLayout.fields.taxDifference.value, 40, 'taxa explícita no formato tabular do Sabre');
assertEquals(sabreTableLayout.fields.penalty.value, 1086.95, 'multa no formato tabular do Sabre');

const sabreHtmlLayout = calculator.parseSabreReissue('<table><tr><td>Tarifa base USD</td><td>2065.00</td><td>2165.00</td><td>100.00</td></tr><tr><td>Tarifa equivalente BRL</td><td>10344.82</td><td>546.21</td></tr><tr><td>Total das taxas BRL</td><td>632.98</td><td>671.52</td><td>40.00</td></tr><tr><td>Tarifa total BRL</td><td>10977.80</td><td>586.21</td></tr><tr><td>Valor da multa por alteração</td><td>1086.95</td></tr><tr><td>Total BRL</td><td>1673.16</td></tr></table>');
assertEquals([sabreHtmlLayout.fields.fareDifference.value,sabreHtmlLayout.fields.taxDifference.value,sabreHtmlLayout.fields.penalty.value],[546.21,40,1086.95],'valores no HTML tabular do Sabre');

const sabreEur = calculator.parseSabreReissue(`
  Tarifa base EUR
  Tarifa equivalente 546.21
  das taxas 4
  Tarifa total BRL 586.21
  da multa por alteração 1086.95
  Total BRL 1673.16
`);
assertEquals(sabreEur.currency, 'EUR', 'moeda original EUR');
assertEquals([sabreEur.fields.fareDifference.value, sabreEur.fields.taxDifference.value, sabreEur.fields.penalty.value], [546.21, 40, 1086.95], 'valores BRL independem da moeda original');

const ambiguousSabre = calculator.parseSabreReissue('Tarifa base USD\nTarifa equivalente 100.00\ndas taxas N/A\nTotal BRL 999.00');
assertEquals(ambiguousSabre.fields.taxDifference, { value: null, status: 'pending' }, 'divergência fica pendente');
assertEquals(calculator.parseSabreReissue('Tarifa base\nTarifa equivalente 10.00\ndas taxas 0.00\nTotal BRL 10.00').currency, null, 'moeda ausente permanece não identificada');
assertEquals(calculator.parseSabreReissue('   ').ok, false, 'leitura vazia falha sem valores');

const summary = calculator.passengerSummaryText({
  ADT: { values, total: calculator.totals(values), rate: 5.4321 },
  CHD: { values: { ...values, penalty: { usd: 0, brl: 0 } }, total: { usd: 17, brl: 92.34 }, rate: 5.4321 },
});
if(!summary.startsWith('Câmbio: 5,4321\n\n')) throw new Error('câmbio ausente no topo do resumo');
assertEquals((summary.match(/^Valores por Passageiro/gm) || []).length, 2, 'resumo ADT e CHD tem dois blocos');
if (!summary.includes('Valores por Passageiro ADT') || !summary.includes('Valores por Passageiro CHD') || summary.includes('Valores por Passageiro INF')) throw new Error('tipos incorretos no resumo');
if (!summary.includes('Fee confiança......: USD  4,00 | BRL  21,73') || !summary.includes('DU AGT.............: USD  1,00 | BRL   5,43') || !summary.includes('TOTAL..............: USD 20,00 | BRL 108,64')) throw new Error('campos obrigatórios em USD e BRL ausentes ou desalinhados no resumo');
const summaryRows=summary.split('\n').filter((line)=>line.includes('|'));
assertEquals([...new Set(summaryRows.map((line)=>line.indexOf(':')))], [19], 'rótulos alinhados no resumo');
assertEquals(new Set(summaryRows.map((line)=>line.indexOf('|'))).size, 1, 'colunas monetárias alinhadas no resumo');
const summaryHtml=calculator.passengerSummaryHtml({ADT:{values,total:calculator.totals(values)}});
for(const expected of ['<pre','font-family:Consolas','white-space:pre','Valores por Passageiro ADT','USD 10,00','BRL  54,32']) {
  if(!summaryHtml.includes(expected)) throw new Error(`HTML do resumo sem: ${expected}`);
}

console.log('Testes da calculadora internacional aprovados, incluindo importação Sabre e resumo por passageiro.');
