import { createClient } from 'npm:@supabase/supabase-js@2'
import { fetchLatestClosingRate, SUPPORTED_CURRENCIES } from '../_shared/ptax.ts'

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') return json({ error: 'Método não permitido.' }, 405)

  const expectedSecret = Deno.env.get('PTAX_UPDATE_SECRET') ?? ''
  const receivedSecret = request.headers.get('x-ptax-update-secret') ?? ''
  if (!expectedSecret || receivedSecret !== expectedSecret) return json({ error: 'Chamada não autorizada.' }, 401)

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  if (!supabaseUrl || !serviceRoleKey) return json({ error: 'Função não configurada.' }, 500)

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const results = await Promise.allSettled(
    SUPPORTED_CURRENCIES.map((currency) => fetchLatestClosingRate(currency)),
  )
  const rates = results.flatMap((result) => result.status === 'fulfilled' ? [result.value] : [])
  const failures = results.flatMap((result, index) => result.status === 'rejected'
    ? [{ currency: SUPPORTED_CURRENCIES[index], error: result.reason instanceof Error ? result.reason.message : String(result.reason) }]
    : [])

  if (rates.length) {
    const { error } = await admin.from('exchange_rates').upsert(rates, {
      onConflict: 'currency,reference_date',
    })
    if (error) {
      console.error('Falha ao armazenar cotações PTAX:', error.message)
      return json({ error: 'Não foi possível armazenar as cotações. Os valores anteriores foram preservados.' }, 500)
    }
  }

  if (failures.length) {
    console.error('Falha parcial ou total na atualização PTAX:', failures)
    return json({
      error: 'Uma ou mais cotações não puderam ser atualizadas. Os últimos valores válidos foram preservados.',
      updated: rates.map((rate) => rate.currency),
      failures,
    }, 502)
  }

  return json({
    ok: true,
    updated: rates.map((rate) => ({
      currency: rate.currency,
      rateSell: rate.rate_sell,
      referenceDate: rate.reference_date,
    })),
  })
})
