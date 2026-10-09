import { createClient } from 'npm:@supabase/supabase-js@2'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

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
    .select('organization_id,role,is_active')
    .eq('user_id', userData.user.id)
    .maybeSingle()

  if (membershipError) return json({ error: 'Não foi possível validar o administrador.' }, 500)
  if (!membership?.is_active || membership.role !== 'admin') return json({ error: 'Apenas administradores ativos podem gerenciar usuários.' }, 403)

  let payload: { action?: string; fullName?: string; email?: string; role?: string; targetUserId?: string; isActive?: boolean }
  try {
    payload = await request.json()
  } catch {
    return json({ error: 'Dados inválidos.' }, 400)
  }

  const action = payload.action ?? 'invite'
  if (action === 'set-active') {
    if (!payload.targetUserId || !UUID_PATTERN.test(payload.targetUserId) || typeof payload.isActive !== 'boolean') {
      return json({ error: 'Colaborador ou situação inválida.' }, 400)
    }
    const { error: stateError } = await admin.rpc('set_organization_member_active', {
      actor_user_id: userData.user.id,
      target_organization_id: membership.organization_id,
      target_user_id: payload.targetUserId,
      new_active: payload.isActive,
    })
    if (stateError) {
      const safeMessage = /própria conta|último administrador ativo|Colaborador não encontrado/.test(stateError.message)
        ? stateError.message
        : 'Não foi possível alterar a situação do colaborador.'
      return json({ error: safeMessage }, 400)
    }
    return json({ ok: true })
  }

  if (action !== 'invite') return json({ error: 'Ação inválida.' }, 400)

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
    is_active: true,
  })

  if (linkError) {
    await admin.auth.admin.deleteUser(invitedUser.id)
    return json({ error: 'Não foi possível vincular o usuário à empresa.' }, 500)
  }

  return json({ ok: true, userId: invitedUser.id })
})
