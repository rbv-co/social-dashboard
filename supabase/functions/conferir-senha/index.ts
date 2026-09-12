// Confere a senha de QUEM ESTÁ LOGADO e devolve só sim ou não.
//
// POR QUE ISTO EXISTE, e é a razão de ser uma Edge Function: o único jeito de
// conferir senha pelo cliente com Supabase é signInWithPassword — que é o que
// tela-de-login.vue:111 usa —, e ele TROCA A SESSÃO. Chamá-lo pra confirmar a
// senha no meio do checklist faria o app entrar de novo, com token novo e a
// ficha pela metade na tela.
//
// O USUÁRIO SAI DO TOKEN, NUNCA DO CORPO DO PEDIDO. Aceitar um e-mail vindo do
// cliente transformaria isto num oráculo pra testar senha de terceiros.
import { createClient } from 'jsr:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });

// Cinco erros seguidos bloqueiam por dez minutos. Sem isto a função é um jeito
// confortável de testar senhas — e ela responde rápido, o que é pior.
//
// LIMITAÇÃO CONHECIDA E ACEITA: isto vive em memória, e uma Edge Function sobe
// várias cópias em paralelo — cada uma com a própria contagem, zerada sempre
// que a cópia reinicia. Na prática o limite atrapalha um ataque, mas não o
// impede de verdade. O dono foi avisado e aceitou o furo; não é bug.
const LIMITE = 5;
const BLOQUEIO_MS = 10 * 60 * 1000;
const tentativas = new Map<string, { erros: number; ate: number }>();

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  // Tudo dentro de um try: se getUser ou signInWithPassword lançarem por erro
  // de infraestrutura (rede, projeto fora do ar) em vez de devolver um `error`
  // de retorno, a resposta ainda sai como JSON com CORS — nunca como uma
  // exceção crua, que o navegador mostraria como erro de CORS e esconderia a
  // causa real. E o caminho de exceção NUNCA devolve ok:true: falha em
  // conferir é assinatura recusada, não assinatura concedida por acidente.
  try {
    const auth = req.headers.get('Authorization') || '';
    if (!auth.startsWith('Bearer ')) return json({ ok: false, erro: 'sem_sessao' }, 401);

    const url = Deno.env.get('SUPABASE_URL')!;
    const anon = Deno.env.get('SUPABASE_ANON_KEY')!;

    // Quem é quem: cliente com o token de quem chamou, só pra descobrir o usuário.
    const comToken = createClient(url, anon, { global: { headers: { Authorization: auth } } });
    const { data: { user }, error: erroUser } = await comToken.auth.getUser();
    if (erroUser || !user?.email) return json({ ok: false, erro: 'sem_sessao' }, 401);

    const marca = tentativas.get(user.id);
    if (marca && marca.ate > Date.now()) {
      return json({ ok: false, erro: 'bloqueado', bloqueado_ate: new Date(marca.ate).toISOString() }, 429);
    }

    let senha = '';
    try { senha = String((await req.json())?.senha || ''); } catch { /* corpo inválido -> senha vazia */ }
    if (!senha) return json({ ok: false, erro: 'sem_senha' }, 400);

    // Cliente NOVO e isolado só pra esta conferência: o signIn aqui dentro cria
    // uma sessão que morre com a função e nunca chega ao navegador de ninguém.
    const isolado = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
    const { error } = await isolado.auth.signInWithPassword({ email: user.email, password: senha });

    if (error) {
      const erros = (marca?.erros || 0) + 1;
      tentativas.set(user.id, { erros, ate: erros >= LIMITE ? Date.now() + BLOQUEIO_MS : 0 });
      return json({ ok: false, erro: 'senha_incorreta', restam: Math.max(0, LIMITE - erros) });
    }

    tentativas.delete(user.id);
    // ⚠️ `scope: 'local'` NÃO É DETALHE — SEM ELE ESTA LINHA DERRUBA QUEM ACABOU
    // DE CONFERIR A SENHA. O `signOut()` do supabase-js é GLOBAL por padrão:
    // ele não encerra só este cliente isolado, ele REVOGA TODOS OS TOKENS
    // daquele usuário — inclusive o do navegador que está com a tela aberta e o
    // do programa da bancada, que loga com a mesma conta.
    //
    // O sintoma, relatado pelo dono em 04/09/2026: a primeira ação que pede
    // senha funciona, e a SEGUINTE diz "sessão expirou". A conferência de senha
    // estava derrubando a sessão de quem conferia — e a tela, que evita o
    // `signInWithPassword` justamente para não trocar a sessão, era traída aqui
    // dentro.
    //
    // Com `persistSession: false` a sessão isolada só existe na memória desta
    // função e morre com ela de qualquer jeito; `local` limpa essa memória sem
    // encostar nos tokens de ninguém.
    await isolado.auth.signOut({ scope: 'local' });
    return json({ ok: true });
  } catch (err: unknown) {
    // Erro de infraestrutura, não de senha errada: recusa a assinatura e conta
    // o porquê, em vez de deixar a exceção estourar sem CORS nem corpo JSON.
    const msg = err instanceof Error ? err.message : String(err);
    return json({ ok: false, erro: 'falha_interna', mensagem: msg }, 500);
  }
});
