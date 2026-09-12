import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { enderecoDeRetorno } from '../_shared/enderecos-do-app.js'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}


Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  try {
    // PARA ONDE O LINK DO E-MAIL LEVA.
    //
    // A Central atende em dois endereços enquanto muda de nome. O link do
    // convite e o da troca de senha têm de cair no endereço de onde o admin
    // clicou — senão quem for convidado a partir do endereço novo recebe um
    // e-mail que leva ao antigo. `enderecoDeRetorno` só aceita endereço da
    // nossa lista: um `Origin` forjado cai no padrão, nunca vira o link.
    //
    // ATENÇÃO: cada endereço daqui precisa estar TAMBÉM na lista do Supabase
    // (Authentication -> URL Configuration -> Redirect URLs). O que não estiver
    // lá é recusado e o e-mail sai apontando para a raiz do projeto.
    const destinoDoLink = enderecoDeRetorno(req.headers.get('Origin'))

    const anonClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: req.headers.get('Authorization')! } } }
    )

    const { data: { user }, error: authErr } = await anonClient.auth.getUser()
    if (authErr || !user) throw new Error('Não autenticado')

    const { data: profile } = await anonClient
      .from('profiles')
      .select('role, is_superadmin')
      .eq('id', user.id)
      .single()

    if (profile?.role !== 'admin') throw new Error('Apenas administradores podem realizar esta ação')

    const adminClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    )

    const body = await req.json()
    const { email, name, role, password, deleteUserId, resetPasswordUserId } = body

    // --- Trocar senha de qualquer usuário (SÓ superadmin) ---
    if (resetPasswordUserId) {
      if (!profile?.is_superadmin) throw new Error('Apenas superadmin pode trocar a senha de usuários')
      if (!password || password.length < 6) throw new Error('A senha precisa de no mínimo 6 caracteres')
      const { error: pwErr } = await adminClient.auth.admin.updateUserById(resetPasswordUserId, { password })
      if (pwErr) throw pwErr

      // SENHA POSTA POR OUTRA PESSOA É PROVISÓRIA, SEMPRE.
      //
      // Quem digitou a senha também sabe entrar na conta. A tela que cobra a
      // troca já existe (moldura-do-aplicativo.vue, em toda rota, sem botão de
      // fechar) e já lê esta coluna — só ninguém a marcava aqui. Sem isto, a
      // senha que o dono manda por mensagem vira a senha definitiva da pessoa.
      //
      // A marcação mora AQUI, e não na tela: em duas chamadas separadas, uma
      // falha entre elas deixaria a senha trocada SEM a cobrança, e o dono
      // acharia que cobrou.
      const { error: flagErr } = await adminClient.from('profiles')
        .update({ precisa_trocar_senha: true }).eq('id', resetPasswordUserId)
      if (flagErr) throw flagErr

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...cors, 'Content-Type': 'application/json' }
      })
    }

    // --- Excluir usuário ---
    if (deleteUserId) {
      if (deleteUserId === user.id) throw new Error('Não é possível excluir sua própria conta')
      await adminClient.from('profiles').delete().eq('id', deleteUserId)
      const { error: delErr } = await adminClient.auth.admin.deleteUser(deleteUserId)
      if (delErr) throw delErr
      return new Response(JSON.stringify({ success: true }), {
        headers: { ...cors, 'Content-Type': 'application/json' }
      })
    }

    // --- Convidar / criar usuário ---
    if (!email) throw new Error('Email obrigatório')

    const validRole = role === 'admin' ? 'admin' : 'viewer'

    if (password && password.length >= 6) {
      const { data: created, error: createErr } = await adminClient.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { name: name || '', role: validRole },
      })
      if (createErr) throw createErr

      await adminClient.from('profiles').upsert({
        id: created.user.id,
        email,
        name: name || '',
        role: validRole,
      })
    } else {
      const { data: invited, error: inviteErr } = await adminClient.auth.admin.inviteUserByEmail(email, {
        redirectTo: destinoDoLink,
        data: { name: name || '', role: validRole },
      })

      if (inviteErr) {
        if (inviteErr.message.toLowerCase().includes('already been registered') ||
            inviteErr.message.toLowerCase().includes('already registered')) {
          const { error: resetErr } = await adminClient.auth.resetPasswordForEmail(email, {
            redirectTo: destinoDoLink,
          })
          if (resetErr) throw resetErr
        } else {
          throw inviteErr
        }
      } else {
        await adminClient.from('profiles').upsert({
          id: invited.user.id,
          email,
          name: name || '',
          role: validRole,
        }, { onConflict: 'id', ignoreDuplicates: true })
      }
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...cors, 'Content-Type': 'application/json' }
    })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return new Response(JSON.stringify({ error: msg }), {
      status: 400,
      headers: { ...cors, 'Content-Type': 'application/json' }
    })
  }
})
