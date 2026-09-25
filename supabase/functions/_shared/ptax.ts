export const PTAX_SOURCE = 'Banco Central do Brasil - PTAX'
export const SUPPORTED_CURRENCIES = ['USD', 'EUR', 'GBP', 'CAD'] as const

export type SupportedCurrency = typeof SUPPORTED_CURRENCIES[number]

export const CURRENCY_NAMES: Record<SupportedCurrency, string> = {
  USD: 'Dólar Americano',
  EUR: 'Euro',
  GBP: 'Libra Esterlina',
  CAD: 'Dólar Canadense',
}

export type PtaxApiRecord = {
  cotacaoVenda?: unknown
  dataHoraCotacao?: unknown
  tipoBoletim?: unknown
}

export type ExchangeRateRecord = {
  currency: SupportedCurrency
  currency_name: string
  rate_sell: number
  reference_date: string
  fetched_at: string
  source: typeof PTAX_SOURCE
}

const PTAX_ENDPOINT = 'https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata/CotacaoMoedaPeriodo(moeda=@moeda,dataInicial=@dataInicial,dataFinalCotacao=@dataFinalCotacao)'

export function formatPtaxDate(date: Date): string {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo',
    month: '2-digit',
    day: '2-digit',
    year: 'numeric',
  })
  return formatter.format(date).replaceAll('/', '-')
}

export function buildPtaxUrl(currency: SupportedCurrency, endDate = new Date(), lookbackDays = 45): string {
  const startDate = new Date(endDate.getTime())
  startDate.setUTCDate(startDate.getUTCDate() - lookbackDays)
  const parameters = new URLSearchParams({
    '@moeda': `'${currency}'`,
    '@dataInicial': `'${formatPtaxDate(startDate)}'`,
    '@dataFinalCotacao': `'${formatPtaxDate(endDate)}'`,
    '$format': 'json',
    '$select': 'cotacaoVenda,dataHoraCotacao,tipoBoletim',
  })
  return `${PTAX_ENDPOINT}?${parameters.toString()}`
}

function referenceDate(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!match) return null
  const [, year, month, day] = match
  const date = new Date(`${year}-${month}-${day}T12:00:00Z`)
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== `${year}-${month}-${day}`) return null
  return `${year}-${month}-${day}`
}

export function selectLatestClosingRate(
  currency: SupportedCurrency,
  records: PtaxApiRecord[],
  fetchedAt = new Date(),
): ExchangeRateRecord | null {
  const valid = records.flatMap((record) => {
    const rate = Number(record.cotacaoVenda)
    const date = referenceDate(record.dataHoraCotacao)
    const bulletin = typeof record.tipoBoletim === 'string' ? record.tipoBoletim.trim().toLocaleLowerCase('pt-BR') : ''
    if (bulletin !== 'fechamento' || !date || !Number.isFinite(rate) || rate <= 0) return []
    return [{ date, rate }]
  }).sort((left, right) => right.date.localeCompare(left.date))

  const latest = valid[0]
  if (!latest) return null
  return {
    currency,
    currency_name: CURRENCY_NAMES[currency],
    rate_sell: latest.rate,
    reference_date: latest.date,
    fetched_at: fetchedAt.toISOString(),
    source: PTAX_SOURCE,
  }
}

export async function fetchLatestClosingRate(
  currency: SupportedCurrency,
  options: { fetcher?: typeof fetch; now?: Date; lookbackDays?: number } = {},
): Promise<ExchangeRateRecord> {
  const fetcher = options.fetcher ?? fetch
  const now = options.now ?? new Date()
  const response = await fetcher(buildPtaxUrl(currency, now, options.lookbackDays ?? 45), {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(15000),
  })
  if (!response.ok) throw new Error(`BCB respondeu HTTP ${response.status} para ${currency}`)
  const payload = await response.json() as { value?: PtaxApiRecord[] }
  if (!Array.isArray(payload.value)) throw new Error(`Resposta inválida do BCB para ${currency}`)
  const rate = selectLatestClosingRate(currency, payload.value, now)
  if (!rate) throw new Error(`Nenhum fechamento válido encontrado para ${currency}`)
  return rate
}
