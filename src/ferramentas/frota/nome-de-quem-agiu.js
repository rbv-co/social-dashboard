/* O NOME DE QUEM PEDIU, DECIDIU OU ENCERROU UMA RESERVA.
 *
 * Esses três campos (`criada_por`, `decidida_por`, `encerrada_por`) guardam um
 * id de CONTA DE LOGIN, não de colaborador. Para virar nome, a tela procurava a
 * ficha de colaborador ligada àquela conta (`acessos_pessoas.profile_id`) — e,
 * quando não achava, escrevia só a data.
 *
 * O DEFEITO, medido em 18/08/2026: das 20 contas de login, **8 não têm ficha de
 * colaborador ligada**, e **duas delas são admin** — justamente quem decide
 * reserva. Hoje as 4 aparições do histórico têm nome por sorte: as duas pessoas
 * que agiram até agora têm ficha. Na primeira decisão de um dos outros, a linha
 * fica muda.
 *
 * A DECISÃO DO DONO (18/08): "sempre mostre um nome".
 *
 * A ESCADA, do melhor para o pior, e ela nunca inventa:
 *   1. o nome da ficha de colaborador (é o que o resto da tela mostra)
 *   2. o nome da conta de login
 *   3. o e-mail da conta — feio, mas identifica quem foi
 *   4. um rótulo honesto de que aquela conta não tem nome cadastrado
 *
 * ⚠️ O ID CRU NUNCA APARECE. Um UUID na tela não diz nada a ninguém e ainda
 *    parece defeito — quem vê pensa que a tela quebrou.
 *
 * ⚠️ SEM ATOR CONTINUA SENDO SILÊNCIO. Se ninguém decidiu ainda, devolve null e
 *    a tela escreve só a data. "Sempre mostre um nome" vale para quando existe
 *    alguém; inventar um ator que não houve seria pior que a data sozinha.
 *
 * PURO: sem rede, sem tela. */

const texto = (v) => (typeof v === 'string' ? v.trim() : '');

export const CONTA_SEM_NOME = 'Conta sem nome cadastrado';

export function nomeDeQuemAgiu(userId, pessoas, perfis) {
  const id = texto(userId) || (userId ? String(userId) : '');
  if (!id) return null;

  const ficha = (pessoas || []).find((p) => p && p.profile_id === id);
  const nomeDaFicha = texto(ficha && ficha.nome);
  if (nomeDaFicha) return nomeDaFicha;

  const perfil = (perfis || []).find((p) => p && p.id === id);
  const nomeDoPerfil = texto(perfil && perfil.name);
  if (nomeDoPerfil) return nomeDoPerfil;

  const email = texto(perfil && perfil.email);
  if (email) return email;

  return CONTA_SEM_NOME;
}
