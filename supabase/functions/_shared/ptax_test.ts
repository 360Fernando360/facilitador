import { assertEquals, assertRejects } from 'jsr:@std/assert@1'
import { buildPtaxUrl, fetchLatestClosingRate, selectLatestClosingRate } from './ptax.ts'

Deno.test('seleciona somente a venda do fechamento mais recente', () => {
  const result = selectLatestClosingRate('USD', [
    { cotacaoVenda: 5.9, dataHoraCotacao: '2026-09-25 10:00:00.000', tipoBoletim: 'Intermediário' },
    { cotacaoVenda: 5.2, dataHoraCotacao: '2026-09-24 13:10:00.000', tipoBoletim: 'Fechamento' },
    { cotacaoVenda: 5.3, dataHoraCotacao: '2026-09-23 13:10:00.000', tipoBoletim: 'Fechamento' },
  ], new Date('2026-09-25T21:00:00Z'))
  assertEquals(result?.rate_sell, 5.2)
  assertEquals(result?.reference_date, '2026-09-24')
})

Deno.test('aceita as quatro moedas suportadas', () => {
  for (const currency of ['USD', 'EUR', 'GBP', 'CAD'] as const) {
    const result = selectLatestClosingRate(currency, [
      { cotacaoVenda: 6.1234, dataHoraCotacao: '2026-09-24 13:10:00.000', tipoBoletim: 'Fechamento' },
    ])
    assertEquals(result?.currency, currency)
    assertEquals(result?.rate_sell, 6.1234)
  }
})

Deno.test('fim de semana usa o último fechamento encontrado no período', () => {
  const result = selectLatestClosingRate('EUR', [
    { cotacaoVenda: 6.4, dataHoraCotacao: '2026-09-18 13:10:00.000', tipoBoletim: 'Fechamento' },
  ], new Date('2026-09-20T21:00:00Z'))
  assertEquals(result?.reference_date, '2026-09-18')
})

Deno.test('rejeita zero, nulo e boletim parcial', () => {
  const result = selectLatestClosingRate('GBP', [
    { cotacaoVenda: 0, dataHoraCotacao: '2026-09-24 13:10:00.000', tipoBoletim: 'Fechamento' },
    { cotacaoVenda: null, dataHoraCotacao: '2026-09-24 13:10:00.000', tipoBoletim: 'Fechamento' },
    { cotacaoVenda: 9, dataHoraCotacao: '2026-09-24 12:00:00.000', tipoBoletim: 'Intermediário' },
  ])
  assertEquals(result, null)
})

Deno.test('consulta um período retroativo em vez de assumir o dia anterior', () => {
  const url = decodeURIComponent(buildPtaxUrl('CAD', new Date('2026-09-25T21:00:00Z'), 45))
  assertEquals(url.includes("@moeda='CAD'"), true)
  assertEquals(url.includes("@dataInicial='08-11-2026'"), true)
  assertEquals(url.includes("@dataFinalCotacao='09-25-2026'"), true)
})

Deno.test('falha da API é propagada sem criar cotação inventada', async () => {
  const fetcher = () => Promise.resolve(new Response('', { status: 503 }))
  await assertRejects(() => fetchLatestClosingRate('USD', { fetcher: fetcher as typeof fetch }))
})
