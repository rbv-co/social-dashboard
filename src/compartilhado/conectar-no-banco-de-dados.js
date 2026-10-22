import { calcularModoEntrarComo } from './modo-entrar-como.js'
import { areaNaApi } from './api.js'
import { opcoesDoSupabase } from './opcoes-do-supabase.js'
import { criarClienteDesligado } from './cliente-desligado.js'

// O SUPABASE FOI DESLIGADO (D+14, plano 08 do pos-virada): a Central fala so com a API em Go. Estas duas constantes
// ficam porque ~16 telas ainda as importam no ramo `areaNaApi(...) ? api : supabase` (ramo morto, o build da API
// liga todas as areas), mas SEM host nem chave de verdade: `.invalid` e um TLD reservado (RFC 2606), entao qualquer
// chamada que escape do ramo da API falha na hora em vez de chegar a um servidor. O createClient exige URL valida e
// chave nao vazia, por isso nao sao strings vazias. A chave anon antiga era publica, mas nao precisa mais estar no bundle.
export const SUPABASE_URL = 'https://supabase-desligado.invalid'
export const SUPABASE_ANON_KEY = 'supabase-desligado'

// A sessao do Supabase mora no localStorage por padrao -- compartilhado entre
// TODAS as abas da mesma origem. A aba de "Entrar como" (tela-de-admin.vue)
// nao pode escrever ali: sobrescreveria a sessao real do admin em qualquer
// outra aba que relesse o localStorage (um F5, por exemplo). Por isso ela usa
// sessionStorage, isolado por aba, que some sozinho quando a aba fecha.
//
// A marca em sessionStorage sobrevive a um F5 desta MESMA aba (a query
// `?modo=entrar-como` some da URL depois da primeira navegacao do router).
//
// try/catch: este arquivo e importado pelo teste de
// controle-de-login-e-usuario.test.mjs com um `window` minimo, sem
// `location`/`sessionStorage` de verdade.
function _storageDestaAba() {
  try {
    const jaMarcada = window.sessionStorage.getItem('modo_entrar_como') === '1'
    const ativo = jaMarcada || calcularModoEntrarComo(window.location.search)
    if (ativo) window.sessionStorage.setItem('modo_entrar_como', '1')
    return ativo ? window.sessionStorage : null
  } catch {
    return null
  }
}

const _storageEspecial = _storageDestaAba()
export const emModoEntrarComo = !!_storageEspecial
// O supabase-js saiu do index.html (plano 01-D, 22/10/2026): sem `window.supabase`, o cliente é o desligado, que
// responde sem sessão/erro e não faz rede. O build de demonstração ainda instala o dele (banco de mentira).
export const sbClient = window.supabase
  ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, opcoesDoSupabase(areaNaApi('conta'), _storageEspecial))
  : criarClienteDesligado()
