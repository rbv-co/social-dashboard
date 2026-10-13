// ⚠️ O SINAL DE DIAGNÓSTICO VIVE NA ABA, NÃO NO NAVEGADOR PARA SEMPRE.
// O roteador usa `createWebHistory`: ao navegar para a tela, o endereço é
// reescrito e a query `?diag=1` SOME. Foi o que aconteceu em 09/09/2026 — o dono
// abriu com `?diag=1`, chegou na tela e a linha técnica não estava lá. Por isso
// ele é lido no boot e guardado; o que muda é ONDE.
//
// ⚠️ ERA `localStorage` E FICOU PRESO. Ligado uma vez, a faixa vermelha voltava em
// todo carregamento, para sempre, e não havia como a pessoa desligar sem saber do
// `?diag=0` — o dono, em 10/09/2026: "no navegador ainda aparece aquela barrinha
// vermelha em cima". Instrumento que não sabe ir embora vira defeito.
//
// `sessionStorage` é a resposta certa: sobrevive à navegação DENTRO da aba, que é
// tudo o que o `?diag=1` precisava, e morre quando a aba fecha.
try {
  const _q = new URLSearchParams(window.location.search)
  if (_q.get('diag') === '1') sessionStorage.setItem('rbv_diag', '1')
  if (_q.get('diag') === '0') sessionStorage.removeItem('rbv_diag')
  // Faxina do que ficou preso na versão antiga. Uma linha, e some do navegador de
  // quem ligou o diagnóstico algum dia — sem precisar pedir nada a ninguém.
  localStorage.removeItem('rbv_diag')
} catch (e) {}

import './estilos/estilos-globais.css'
import { createApp } from 'vue'
import Moldura from './moldura-do-aplicativo.vue'
import { roteador } from './mapa-de-enderecos.js'
import { sbClient, emModoEntrarComo } from './compartilhado/conectar-no-banco-de-dados.js'
import { setSession, carregarPerfil, limparEstado, estado, abrirSessaoDaApi, retomarSessaoDaApi } from './compartilhado/controle-de-login-e-usuario.js'
import { areaNaApi, CHAVE_DO_TOKEN } from './compartilhado/api.js'
import { detectarFluxoDeSenha, lerSegredoDoLink } from './ferramentas/login/detectar-fluxo-de-senha.js'
import { vTravaRolagem } from './compartilhado/travar-rolagem-de-fundo.js'

async function iniciar() {
  // Guardado ANTES de qualquer await: o SDK consome e apaga o #access_token do
  // hash de forma assíncrona. Lido depois, o hash já sumiu e a detecção falha.
  window.__fluxoDeSenha = detectarFluxoDeSenha(location.hash, location.search)

  if (areaNaApi('conta')) await iniciarSessaoDaApi()
  else await iniciarSessaoDoSupabase()

  // Veio de link de reset/convite: a sessão existe, mas a pessoa PRECISA definir
  // a senha antes de usar o sistema — senão fica trancada quando a sessão
  // expirar. A guarda deixa /login passar mesmo com sessão, então o destino
  // gruda. O await é necessário: sem ele, a navegação inicial que o roteador
  // dispara ao ser instalado corre junto e pode ganhar, levando ao Início.
  if (window.__fluxoDeSenha) {
    await roteador.replace({ name: 'login' })
  }

  // A diretiva PRECISA ser registrada aqui. Ela era usada em 8 modais (moldura,
  // Patrimonio, Frota, Status do Claude, leitor de etiqueta, passeio guiado) e
  // NENHUM travava: o Vue avisava "Failed to resolve directive: trava-rolagem"
  // no console e seguia em frente, entao o defeito passava calado. Em <script
  // setup> uma diretiva so vale se for importada no proprio componente ou
  // registrada no app -- e aqui vale pra Central inteira, de uma vez.
  const app = createApp(Moldura)
  app.directive('trava-rolagem', vTravaRolagem)
  app.use(roteador).mount('#app')
}

// A SESSÃO PELA API EM GO (chave `conta`, Plano 7).
async function iniciarSessaoDaApi() {
  // O SEGREDO SAI DO ENDEREÇO ANTES DE QUALQUER AWAIT. O link de senha e o da
  // aba de "entrar como" trazem um token no hash; deixá-lo ali é deixá-lo no
  // histórico do navegador e em qualquer print da barra de endereço. O token
  // de senha fica só na memória, até o formulário usá-lo.
  const { tokenDeSenha, sessao } = lerSegredoDoLink(location.hash)
  if (tokenDeSenha || sessao) history.replaceState(null, '', location.pathname + location.search)
  window.__tokenDoLink = tokenDeSenha

  // Sessão no hash só vale na aba de "entrar como" (sessionStorage, isolada):
  // fora dela, ela iria para o localStorage e tomaria TODAS as abas do admin.
  if (sessao && emModoEntrarComo) await abrirSessaoDaApi(sessao)
  else await retomarSessaoDaApi()

  // ⚠️ O ROTEADOR DEVOLVIA O SEGREDO À BARRA. `createWebHistory` guarda o
  // endereço quando o módulo do roteador carrega — antes deste boot — e a
  // navegação inicial regrava esse endereço, hash incluído. O replaceState
  // acima não chega lá. Navegar agora para o endereço limpo faz a navegação
  // inicial não acontecer. (O link de senha não precisa: vai para o login
  // logo abaixo, sem hash.) Achado na prova do Plano 7, em 12/10/2026.
  if (sessao && !window.__fluxoDeSenha) await roteador.replace(location.pathname + location.search)

  // O papel do onAuthStateChange: outra aba entrou, saiu ou trocou de pessoa.
  // A aba de "entrar como" fica de fora — a sessão dela é da pessoa-alvo e não
  // segue o que o admin faz nas outras abas.
  if (emModoEntrarComo) return
  window.addEventListener('storage', async (e) => {
    if (e.key !== CHAVE_DO_TOKEN) return
    if (!e.newValue) { limparEstado(); return }
    setSession({ access_token: e.newValue, user: null })
    await carregarPerfil()
  })
}

async function iniciarSessaoDoSupabase() {
  // Recupera sessão salva (se houver) antes de montar, para que um usuário
  // já logado não seja redirecionado ao /login ao recarregar a página.
  const { data } = await sbClient.auth.getSession()
  if (data.session) {
    setSession(data.session)
    await carregarPerfil(data.session)
  }

  // Mantém o estado com o token SEMPRE fresco: o SDK renova o access_token
  // sozinho (~1h). Sem isso, estado.currentSession fica com o token do boot
  // (velho) e as chamadas REST autenticadas por token explícito (ex.: o
  // adFetch do admin) tomam 401 → listas de usuários/contas zeradas.
  //
  // O SDK dispara SIGNED_IN sozinho no visibilitychange, lendo a sessão do
  // localStorage. Se noutra aba alguém trocou de usuário, esta aba recebia a
  // sessão nova e mantinha role/permissions/is_superadmin do usuário ANTERIOR —
  // token de um, flags de outro. Por isso o perfil é recarregado junto.
  //
  // O "|| !estado.userId" cobre o outro caminho: se o getSession() do boot não
  // devolveu sessão (token vencido, renovação em curso), o carregarPerfil nunca
  // rodou — o usuário ficava logado com permissions = {} e a Central vazia.
  //
  // Só recarrega quando o usuário muda (ou quando ainda não há perfil): o
  // TOKEN_REFRESHED dispara a cada ~1h para o mesmo usuário e recarregar ali
  // seria requisição à toa.
  sbClient.auth.onAuthStateChange(async (evento, session) => {
    if (evento === 'SIGNED_OUT' || !session) {
      limparEstado()
      return
    }
    const mudouDeUsuario = estado.userId && session.user?.id !== estado.userId
    setSession(session)
    if (mudouDeUsuario || !estado.userId) {
      await carregarPerfil(session)
    }
  })
}

iniciar()
