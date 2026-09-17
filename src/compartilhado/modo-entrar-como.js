// SE ESTA ABA ESTA EM MODO "ENTRAR COMO OUTRO USUARIO" — decisao pura.
//
// Usado por conectar-no-banco-de-dados.js para escolher sessionStorage (esta
// aba) em vez de localStorage (compartilhado entre abas) — ver o motivo
// completo em docs/superpowers/specs/2026-09-17-entrar-como-usuario-design.md.
//
// Sem imports de proposito: puro, testavel no Node sem fingir `window`.
export function calcularModoEntrarComo(search) {
  const q = new URLSearchParams(String(search || '').replace(/^\?/, ''))
  return q.get('modo') === 'entrar-como'
}
