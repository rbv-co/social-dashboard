/* O QUE A RESPOSTA DE `profiles` QUER DIZER.
 *
 * Existe por causa de um caso que a lista vazia esconde. Desde a migration 054,
 * quem está marcado "Desativado" em Administração não lê nem o próprio perfil —
 * é isso que fecha as 46 políticas que consultam `profiles` direto. O efeito
 * colateral é que a resposta chega VAZIA, exatamente igual à de quem nunca teve
 * perfil.
 *
 * E "sem perfil" é um caso real e legítimo: em 21/09/2026 duas contas de
 * verdade (Gabriel Alves e Marcio Franco) entram assim e recebem o Banco de
 * Arquivos pelo valor padrão. Tratar as duas como uma só tiraria o acesso deles
 * sem ninguém ter pedido, e diria "sua conta foi desativada" para quem não foi.
 *
 * Quem separa as duas é a função `minha_conta_esta_desativada()` do banco — a
 * única pergunta que a conta desativada ainda consegue responder sobre si.
 */

/**
 * @param corpo       o que veio de `profiles?id=eq.<eu>` (array) ou nulo
 * @param desativada  resposta de `minha_conta_esta_desativada()`
 * @returns {{tipo: 'perfil'|'desativada'|'sem-perfil', perfil: object|null}}
 */
export function lerPerfil(corpo, desativada = false) {
  const p = Array.isArray(corpo) ? corpo[0] : null;
  if (p) return { tipo: 'perfil', perfil: p };
  // A ordem importa: desativada vence "sem perfil", porque uma conta desativada
  // TEM perfil — ela só não pode mais lê-lo.
  if (desativada === true) return { tipo: 'desativada', perfil: null };
  return { tipo: 'sem-perfil', perfil: null };
}

/** Só vale a pena perguntar ao banco quando a resposta veio vazia. */
export function precisaPerguntarSeDesativou(corpo) {
  return !(Array.isArray(corpo) && corpo[0]);
}
