import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return json({ error: 'Método não permitido.' }, 405)

  const authorization = request.headers.get('Authorization')
  const token = authorization?.replace(/^Bearer\s+/i, '')
  if (!token) return json({ error: 'Sessão não informada.' }, 401)

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  if (!supabaseUrl || !serviceRoleKey) return json({ error: 'Função não configurada.' }, 500)

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const { data: userData, error: userError } = await admin.auth.getUser(token)
  if (userError || !userData.user) return json({ error: 'Sessão inválida ou expirada.' }, 401)

  const { data: membership, error: membershipError } = await admin
    .from('organization_members')
    .select('organization_id,role')
    .eq('user_id', userData.user.id)
    .maybeSingle()

  if (membershipError) return json({ error: 'Não foi possível validar o administrador.' }, 500)
  if (!membership || membership.role !== 'admin') return json({ error: 'Apenas administradores podem convidar usuários.' }, 403)

  let payload: { fullName?: string; email?: string; role?: string }
  try {
    payload = await request.json()
  } catch {
    return json({ error: 'Dados inválidos.' }, 400)
  }

  const fullName = payload.fullName?.trim()
  const email = payload.email?.trim().toLowerCase()
  const role = ['admin', 'manager'].includes(payload.role ?? '') ? payload.role! : 'member'
  const redirectTo = 'https://360fernando360.github.io/facilitador/'
  if (!fullName || fullName.length < 2) return json({ error: 'Informe o nome completo.' }, 400)
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: 'Informe um e-mail válido.' }, 400)

  const { data: invitation, error: inviteError } = await admin.auth.admin.inviteUserByEmail(email, {
    data: { full_name: fullName },
    redirectTo,
  })

  if (inviteError) {
    const status = inviteError.status === 429 ? 429 : 400
    return json({ error: inviteError.code || inviteError.message }, status)
  }

  const invitedUser = invitation.user
  if (!invitedUser) return json({ error: 'O Supabase não retornou o usuário convidado.' }, 500)

  const { error: linkError } = await admin.from('organization_members').insert({
    organization_id: membership.organization_id,
    user_id: invitedUser.id,
    full_name: fullName,
    email,
    role,
  })

  if (linkError) {
    await admin.auth.admin.deleteUser(invitedUser.id)
    return json({ error: 'Não foi possível vincular o usuário à empresa.' }, 500)
  }

  return json({ ok: true, userId: invitedUser.id })
})
