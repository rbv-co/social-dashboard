// ENTRAR COM A CONTA DA PESSOA.
//
// DECISÃO DO DONO: cada pessoa que senta na bancada entra com a conta dela. Não
// é burocracia — é o que faz `auth.uid()` chegar carimbado nas funções do banco,
// e é assim que se sabe QUEM gravou cada peça. Uma conta de programa gravaria
// tudo em nome de ninguém, e três meses depois, quando aparecesse uma bolsa com
// a etiqueta errada, não haveria a quem perguntar.
//
// A CHAVE QUE VAI DENTRO DESTE PROGRAMA É A PUBLICÁVEL (anon). Ela não abre nada
// sozinha: quem manda é o `if (is_vessel_admin())` de DENTRO de cada função do
// banco. ⚠️ A CHAVE SECRETA (service_role) NUNCA entra aqui — ela passa por cima
// de toda trava, e este programa roda num computador de bancada, compartilhado.
// O teste ao lado tem uma asserção que prova que a chave carregada é a `anon`.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const AQUI = dirname(fileURLToPath(import.meta.url))
const MODULO_DO_PAINEL = join(AQUI, '..', 'src', 'compartilhado', 'conectar-no-banco-de-dados.js')

// ── AS CREDENCIAIS SAEM DO PAINEL, POR TEXTO ───────────────────────────────
//
// ⚠️ POR QUE LER O ARQUIVO EM VEZ DE IMPORTAR: a última linha de
// `conectar-no-banco-de-dados.js` é `window.supabase.createClient(...)`. Ela roda
// na hora do import, e no Node não existe `window` — importar mataria o programa
// no arranque. Lendo o texto, a fonte continua sendo UMA só: no dia em que a
// chave for rotacionada no painel, ela chega aqui sozinha. Copiar os valores
// para cá criaria a segunda cópia, que é a que fica para trás.
export function lerCredenciaisDoTexto(texto) {
  const conteudo = String(texto ?? '')
  const pegar = (nome) => conteudo
    .match(new RegExp(`${nome}\\s*=\\s*['"\`]([^'"\`]+)['"\`]`))?.[1]
  const url = pegar('SUPABASE_URL')
  const chave = pegar('SUPABASE_ANON_KEY')
  if (!url || !chave) {
    throw new Error(
      'Não achei o endereço e a chave dentro de `src/compartilhado/conectar-no-banco-de-dados.js`. '
      + 'Se aquele arquivo mudou de forma, este programa precisa ser ajustado junto — '
      + 'e NÃO se resolve copiando a chave para cá.',
    )
  }
  return { url, chave }
}

export function credenciaisDoPainel(caminho = MODULO_DO_PAINEL) {
  let texto
  try {
    texto = readFileSync(caminho, 'utf8')
  } catch (erro) {
    throw new Error(
      `Não achei o arquivo do painel em ${caminho}. Este programa mora dentro da pasta do `
      + `projeto e lê as credenciais de lá. (${erro?.message || erro})`,
    )
  }
  return lerCredenciaisDoTexto(texto)
}

// ── AS FRASES DO LOGIN ─────────────────────────────────────────────────────
// O Supabase responde em inglês e em código de status; quem está na bancada
// precisa saber o que fazer. Nenhuma frase pode mandar "tentar de novo mais
// tarde" sem dizer o que aconteceu.
export function fraseDoLogin(erro) {
  const msg = String(erro?.message ?? '')
  if (/invalid login credentials/i.test(msg)) {
    return 'E-mail ou senha não conferem. É o mesmo e-mail e a mesma senha com que você entra '
      + 'na Central pelo navegador.'
  }
  if (/email not confirmed/i.test(msg)) {
    return 'Esta conta ainda não confirmou o e-mail. Abra a Central pelo navegador uma vez, '
      + 'ou peça a um administrador para liberar.'
  }
  if (/too many|rate limit/i.test(msg) || erro?.status === 429) {
    return 'Muitas tentativas seguidas. Espere alguns minutos e tente de novo — '
      + 'nada foi gravado nesse meio-tempo.'
  }
  if (/fetch failed|network|ENOTFOUND|ECONNREFUSED|getaddrinfo/i.test(msg)) {
    return 'Não consegui falar com o sistema: confira a internet deste computador. '
      + 'A senha está certa; o problema é a conexão.'
  }
  if (/user not found/i.test(msg)) {
    return 'Não existe conta com esse e-mail. Confira se digitou certo, '
      + 'ou peça a um administrador para criar a sua.'
  }
  return `Não consegui entrar (${msg || 'motivo desconhecido'}). `
    + 'Confira a internet e o e-mail digitado, e tente de novo.'
}

// ── A PORTA ────────────────────────────────────────────────────────────────
// `criarCliente` entra por injeção (é o `createClient` do @supabase/supabase-js)
// para que o teste consiga simular senha errada, internet caída, portão fechado
// e — o caso que mais importa — o banco que responde `ok: true` sem ter mudado
// linha nenhuma.
export function criarEntrada({ criarCliente, url, chave } = {}) {
  if (typeof criarCliente !== 'function') {
    throw new Error(
      'Sem a biblioteca do Supabase não dá para entrar. Abra o Prompt de Comando na pasta '
      + '`gravador` e rode `npm install`.',
    )
  }
  const credenciais = (url && chave) ? { url, chave } : credenciaisDoPainel()

  // ⚠️ `persistSession: false` DE PROPÓSITO. O computador da bancada é de todo
  // mundo. Sessão guardada em disco faria a pessoa seguinte gravar vinte
  // etiquetas em nome de quem trabalhou antes dela — e o único motivo de haver
  // login aqui é saber quem gravou cada peça.
  // `autoRefreshToken` fica ligado porque um turno de gravação passa da hora de
  // validade do token, e uma fila que morre no meio deixa etiquetas gravadas e
  // não registradas.
  const cliente = criarCliente(credenciais.url, credenciais.chave, {
    auth: { persistSession: false, autoRefreshToken: true, detectSessionInUrl: false },
  })

  let quem = null

  async function entrar(email, senha) {
    const eMail = String(email ?? '').trim()
    const aSenha = String(senha ?? '')
    // As duas conferências são ANTES da rede: mandar campo vazio para o servidor
    // volta como "Invalid login credentials", e a pessoa fica achando que errou
    // a senha quando na verdade não digitou o e-mail.
    if (!eMail) throw new Error('Digite o seu e-mail para entrar.')
    if (!aSenha) throw new Error('Digite a sua senha para entrar.')

    let resposta
    try {
      resposta = await cliente.auth.signInWithPassword({ email: eMail, password: aSenha })
    } catch (erro) {
      throw new Error(fraseDoLogin(erro))
    }
    if (resposta?.error || !resposta?.data?.user) {
      throw new Error(fraseDoLogin(resposta?.error))
    }
    quem = resposta.data.user
    return quem
  }

  // ⚠️ ENTRAR NÃO É TER PERMISSÃO. As funções da Vessel conferem
  // `is_vessel_admin()` por DENTRO e devolvem `{ ok: false, motivo:
  // 'sem_permissao' }` sem levantar erro nenhum — o `grant execute` deixa
  // qualquer pessoa logada CHAMAR, e o `if` de dentro é que barra. Descobrir
  // isso só na quinquagésima etiqueta seria gravar um lote inteiro que o sistema
  // não registrou.
  //
  // `vessel_alertas` é a sonda porque ela é SÓ LEITURA e passa exatamente pelo
  // mesmo portão. Nada é escrito para descobrir se a pessoa pode escrever.
  async function conferirAcesso() {
    if (!quem) return { ok: false, frase: 'Entre com a sua conta antes de começar.' }
    const { data, error } = await cliente.rpc('vessel_alertas')
    if (error) {
      return {
        ok: false,
        frase: `Não consegui conferir a sua permissão (${error.message}). `
          + 'Confira a internet deste computador antes de começar a gravar.',
      }
    }
    if (data?.ok === false) {
      return {
        ok: false,
        frase: 'A sua conta entrou, mas não tem permissão de Autenticidade — o sistema não vai '
          + 'registrar nada do que você gravar. Peça a chave "autenticidade" a um administrador '
          + 'ANTES de começar.',
      }
    }
    return { ok: true, frase: '' }
  }

  // MARCAR A PEÇA COMO GRAVADA. É esta função que entra em `gravarUmaPeca` como
  // `marcar`.
  //
  // ⚠️ E ELA CONFERE DEPOIS, EM VEZ DE ACREDITAR NO `ok`. O corpo de
  // `vessel_marcar_gravada` faz `update ... where codigo = ... and gravada_em is
  // null` e depois devolve `json_build_object('ok', true)` — SEM olhar quantas
  // linhas mudaram. Código que não existe, RLS no caminho, qualquer coisa que
  // faça o update pegar zero linha, e a resposta vem `ok: true` do mesmo jeito.
  // Andar a fila em cima desse `ok` deixaria a etiqueta gravada no mundo e a
  // peça pendente no sistema. Por isso a peça é lida de volta: quem diz que
  // ficou registrado é o dado, não a resposta.
  async function marcarGravada(peca) {
    if (!quem) {
      return {
        ok: false,
        motivo: 'sem_sessao',
        frase: 'ninguém está com a conta aberta neste programa. Entre com a sua conta.',
      }
    }
    const codigo = String(peca?.codigo ?? '').trim().toUpperCase()
    if (!codigo) return { ok: false, motivo: 'peca_nao_existe', frase: 'a peça está sem código.' }

    let resposta
    try {
      resposta = await cliente.rpc('vessel_marcar_gravada', { p_codigo: codigo })
    } catch (erro) {
      return { ok: false, motivo: 'rede', frase: `não consegui falar com o sistema (${erro?.message || erro}).` }
    }
    if (resposta?.error) {
      return { ok: false, motivo: 'rede', frase: `o sistema recusou (${resposta.error.message}).` }
    }
    if (resposta?.data?.ok === false) {
      // O motivo vai cru para quem chamou traduzir com `fraseDaRecusa`
      // (lotes.js): a frase é a MESMA que a pessoa lê no painel.
      return { ok: false, motivo: resposta.data.motivo, ...resposta.data }
    }

    // A CONFERÊNCIA.
    const { data, error } = await cliente
      .from('vessel_pecas')
      .select('codigo,gravada_em')
      .eq('codigo', codigo)
      .maybeSingle()
    if (error) {
      return {
        ok: false,
        motivo: 'nao_confirmou',
        frase: `mandei registrar, mas não consegui conferir se pegou (${error.message}). `
          + 'Não grave esta peça de novo antes de conferir no painel.',
      }
    }
    if (!data?.gravada_em) {
      return {
        ok: false,
        motivo: 'nao_confirmou',
        frase: 'o sistema respondeu que deu certo, mas a peça não ficou registrada como gravada. '
          + 'Não grave esta peça em outra etiqueta: confira no painel primeiro.',
      }
    }
    return { ok: true, gravada_em: data.gravada_em }
  }

  async function sair() {
    try { await cliente.auth.signOut() } finally { quem = null }
  }

  return {
    entrar,
    sair,
    conferirAcesso,
    marcarGravada,
    quemEsta: () => quem,
    cliente: () => cliente,
  }
}

// A BIBLIOTECA DE VERDADE, carregada só quando alguém vai mesmo falar com o
// banco — pela mesma razão de `leitor-de-mesa.js`: um import estático faria o
// programa inteiro morrer no arranque com um erro de módulo, que não diz a
// ninguém o que fazer.
export async function criarEntradaDeVerdade() {
  let supabase
  try {
    supabase = await import('@supabase/supabase-js')
  } catch (erro) {
    throw new Error(
      'A biblioteca do Supabase não está instalada neste computador. Abra o Prompt de Comando '
      + `na pasta \`gravador\` e rode \`npm install\`. (${erro?.message || erro})`,
    )
  }
  return criarEntrada({ criarCliente: supabase.createClient })
}
