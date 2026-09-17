import { calcularModoEntrarComo } from './modo-entrar-como.js'

export const SUPABASE_URL = 'https://kounqtdoioootxqegkij.supabase.co'
export const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtvdW5xdGRvaW9vb3R4cWVna2lqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkyMDMwMDUsImV4cCI6MjA5NDc3OTAwNX0.MVXa6jngjKXkH3eZ7as_j_k8Eb7lJKcFmO4kCKAnuHM'

// A sessao do Supabase mora no localStorage por padrao -- compartilhado entre
// TODAS as abas da mesma origem. A aba de "Entrar como" (tela-de-visao-como.vue)
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
export const sbClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY,
  _storageEspecial ? { auth: { storage: _storageEspecial } } : undefined)
