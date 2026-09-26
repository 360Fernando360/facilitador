import { createClient } from 'npm:@supabase/supabase-js@2'
import { fetchLatestClosingRate, getSaoPauloSchedule, type PtaxSlot } from '../_shared/ptax.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info, x-ptax-update-secret',
}

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return json({ error: 'Método não permitido.' }, 405)

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  if (!supabaseUrl || !serviceRoleKey) return json({ error: 'Função não configurada.' }, 500)

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const expectedSecret = Deno.env.get('PTAX_UPDATE_SECRET') ?? ''
  const receivedSecret = request.headers.get('x-ptax-update-secret') ?? ''
  const scheduledRequest = Boolean(expectedSecret && receivedSecret === expectedSecret)

  if (!scheduledRequest) {
    const accessToken = request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '') ?? ''
    const { data: userData, error: userError } = await admin.auth.getUser(accessToken)
    if (userError || !userData.user) return json({ error: 'Chamada não autorizada.' }, 401)
    const { data: membership } = await admin
      .from('organization_members')
      .select('user_id')
      .eq('user_id', userData.user.id)
      .maybeSingle()
    if (!membership) return json({ error: 'Usuário sem organização vinculada.' }, 403)
  }

  const schedule = getSaoPauloSchedule()
  let slot: PtaxSlot | null = schedule.slot
  if (scheduledRequest) {
    const body = await request.json().catch(() => ({})) as { slot?: unknown }
    if (body.slot === 'midnight' || body.slot === 'opening') slot = body.slot
  }
  if (!slot) return json({ ok: true, skipped: true, reason: 'Nenhuma consulta pendente neste horário.' })

  const trigger = scheduledRequest ? 'schedule' : 'startup'
  const { error: claimError } = await admin.from('exchange_rate_runs').insert({
    run_date: schedule.runDate,
    slot,
    status: 'running',
    trigger,
  })
  if (claimError?.code === '23505') {
    return json({ ok: true, skipped: true, reason: 'Esta janela diária já foi processada.', slot })
  }
  if (claimError) {
    console.error('Falha ao registrar execução PTAX:', claimError.message)
    return json({ error: 'Não foi possível controlar a execução da consulta.' }, 500)
  }

  try {
    const rate = await fetchLatestClosingRate()
    const { error: rateError } = await admin.from('exchange_rates').upsert(rate, {
      onConflict: 'currency,reference_date',
    })
    if (rateError) throw rateError

    const { error: completionError } = await admin
      .from('exchange_rate_runs')
      .update({ status: 'success', completed_at: new Date().toISOString(), error_message: null })
      .eq('run_date', schedule.runDate)
      .eq('slot', slot)
    if (completionError) console.error('Falha ao concluir registro PTAX:', completionError.message)

    return json({
      ok: true,
      slot,
      updated: {
        currency: rate.currency,
        rateSell: rate.rate_sell,
        referenceDate: rate.reference_date,
        fetchedAt: rate.fetched_at,
      },
    })
  } catch (error) {
    const message = errorMessage(error)
    await admin
      .from('exchange_rate_runs')
      .update({ status: 'failed', completed_at: new Date().toISOString(), error_message: message.slice(0, 500) })
      .eq('run_date', schedule.runDate)
      .eq('slot', slot)
    console.error(`Falha na consulta PTAX USD (${slot}):`, message)
    return json({
      error: 'A PTAX USD não pôde ser atualizada. A última taxa válida foi preservada.',
      slot,
    }, 502)
  }
})
