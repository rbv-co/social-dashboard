import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { motivoDeRecusa } from '../_shared/checagem-de-entrar-como.js'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  try {
    const anonClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: req.headers.get('Authorization')! } } }
    )

    const { data: { user }, error: authErr } = await anonClient.auth.getUser()
    if (authErr || !user) throw new Error('Não autenticado')

    const { data: chamador } = await anonClient
      .from('profiles')
      .select('id, is_superadmin, disabled')
      .eq('id', user.id)
      .single()

    const { alvoId } = await req.json()
    if (!alvoId) throw new Error('Faltou alvoId')

    const adminClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    )

    const { data: alvo } = await adminClient
      .from('profiles')
      .select('id, email, disabled')
      .eq('id', alvoId)
      .maybeSingle()

    const recusa = motivoDeRecusa({
      chamador: { id: user.id, is_superadmin: chamador?.is_superadmin, disabled: chamador?.disabled },
      alvoId,
      alvo,
    })
    if (recusa) throw new Error(recusa)

    // Auditoria PRIMEIRO, antes de qualquer sessão existir. A tela promete
    // "fica registrado quem entrou e quando" — se o insert falhar (RLS, coluna,
    // rede), abortamos aqui e nenhuma sessão chega a ser emitida. Na ordem
    // antiga (auditar depois do verifyOtp) uma falha de insert só virava
    // console.error e os tokens saíam mesmo assim: entrada sem registro.
    const { error: auditErr } = await adminClient.from('entradas_como_outro_usuario').insert({
      admin_id: user.id,
      admin_email: user.email,
      alvo_id: alvo.id,
      alvo_email: alvo.email,
    })
    if (auditErr) throw new Error('Não consegui registrar a auditoria: ' + auditErr.message)

    // Gera o link SEM enviar e-mail — generateLink so cria; quem manda e-mail
    // e outra chamada (inviteUserByEmail), que nao fazemos aqui.
    const { data: linkData, error: linkErr } = await adminClient.auth.admin.generateLink({
      type: 'magiclink',
      email: alvo.email,
    })
    if (linkErr) throw linkErr
    const tokenHash = linkData?.properties?.hashed_token
    if (!tokenHash) throw new Error('O Supabase não devolveu o token do link')

    // Troca o token por uma sessao real da pessoa-alvo. Isto e um endpoint
    // PUBLICO do GoTrue (verifyOtp) -- usa a chave anonima, nao a de servico.
    const verifyClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    )
    const { data: sessionData, error: verifyErr } = await verifyClient.auth.verifyOtp({
      token_hash: tokenHash,
      type: 'magiclink',
    })
    if (verifyErr || !sessionData.session) throw verifyErr || new Error('Não consegui gerar a sessão')

    return new Response(JSON.stringify({
      access_token: sessionData.session.access_token,
      refresh_token: sessionData.session.refresh_token,
      expires_in: sessionData.session.expires_in,
    }), { headers: { ...cors, 'Content-Type': 'application/json' } })
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message || String(e) }), {
      status: 400,
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }
})
