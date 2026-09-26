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
assertEquals(copied.split('\n').slice(0, 3), ['Câmbio: 5,4321', 'VALOR POR PESSOA', ''], 'ordem do cabeçalho copiado');
for (const expected of ['VALOR POR PESSOA', 'Câmbio: 5,4321', 'Diferença de tarifa: USD 10,00 | BRL 54,32', 'TOTAL: USD 20,00 | BRL 108,64']) {
  if (!copied.includes(expected)) throw new Error(`texto de cópia sem: ${expected}`);
}

console.log('Testes da calculadora internacional: 7 cenários aprovados.');
