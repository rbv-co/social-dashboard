// QUANDO RECUSAR "ENTRAR COMO OUTRO USUARIO" — uma regra so, pura.
//
// PURO: sem rede, sem cliente Supabase. Quem chama (a Edge Function) ja
// buscou os perfis; aqui so decide, dado o que foi buscado.
//
// A ORDEM IMPORTA: cada recusa devolve a MENSAGEM que a pessoa le, entao a
// primeira que bater e a que ela ve — nao empilha "voce nao e superadmin E
// alem disso essa conta nao existe".
export function motivoDeRecusa({ chamador, alvoId, alvo }) {
  if (!chamador?.is_superadmin) return 'Apenas super-admin pode entrar como outro usuário'
  if (String(chamador.id) === String(alvoId)) return 'Você já é você — não precisa entrar como si mesmo'
  if (!alvo) return 'Não encontrei essa pessoa'
  if (alvo.disabled) return 'Conta desativada — reative antes de entrar como ela'
  return null
}
