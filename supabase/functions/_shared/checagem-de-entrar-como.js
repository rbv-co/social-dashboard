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
  // Logo depois do is_superadmin, ANTES de olhar o alvo: é característica de
  // quem pede, não de quem é o alvo. Desativar o super-admin não revoga o JWT
  // dele na hora (vale ~1h) — sem esta linha ele continuava entrando como
  // qualquer pessoa durante esse tempo.
  if (chamador.disabled) return 'Sua conta está desativada'
  if (String(chamador.id) === String(alvoId)) return 'Você já é você — não precisa entrar como si mesmo'
  if (!alvo) return 'Não encontrei essa pessoa'
  if (alvo.disabled) return 'Conta desativada — reative antes de entrar como ela'
  return null
}
