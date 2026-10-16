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
for (const expected of ['<table', 'Câmbio: 5,4321', 'VALORES POR PESSOA', 'Diferença de tarifa', 'USD&nbsp;10,00', 'BRL&nbsp;54,32', 'TOTAL', 'font-weight:700']) {
  if (!copiedHtml.includes(expected)) throw new Error(`HTML de cópia sem: ${expected}`);
}
if (copiedHtml.includes('undefined')) throw new Error('HTML de cópia contém valor indefinido');

console.log('Testes da calculadora internacional: 22 cenários aprovados.');
