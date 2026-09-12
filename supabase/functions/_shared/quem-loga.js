// QUEM LOGA POR ESTA PESSOA — uma regra só, para as duas pontas.
//
// O PROBLEMA QUE ISTO RESOLVE (medido em produção em 2026-08-11):
// a mesma pergunta — "qual usuário do app é esta pessoa?" — era respondida de
// dois jeitos diferentes, e eles discordavam.
//
//   - A TELA (`meuId()` em tela-de-frota.vue) casava o e-mail do login com
//     `acessos_pessoas.email_corporativo`.
//   - O AVISO das 7h30 (`enviar-push-frota`) exigia `acessos_pessoas.profile_id`
//     e tinha um `if (!pessoa?.profile_id) continue;` — pulava CALADO.
//
// A Raissa Herculano caía no meio: e-mail batendo dos dois lados, `profile_id`
// nunca ligado. Ela usava a tela normalmente e o aviso nunca chegava nela. Não
// dava erro, não aparecia no quadro de cobrança, e ninguém tinha como descobrir.
//
// Duas respostas para a mesma pergunta é o defeito. A correção não é preencher
// o dado da Raissa — é as duas pontas passarem a perguntar aqui.
//
// A ORDEM IMPORTA: o elo (`profile_id`) vem primeiro porque é explícito, alguém
// apontou. O e-mail é o resgate para a ficha que ninguém ligou ainda. Um elo
// apontando para usuário que não existe mais não vira resposta: cai no e-mail.
//
// PURO: sem rede. Quem chama busca as listas e passa para cá.

/** Texto comparável: sem espaço em volta, sem caixa. Vazio vira nulo — duas
 *  ausências NÃO são a mesma pessoa, e comparar '' com '' casaria qualquer um
 *  com qualquer um. */
function chaveDeEmail(valor) {
  const t = String(valor == null ? '' : valor).trim().toLowerCase();
  return t || null;
}

/**
 * O id do usuário do app (`profiles.id`) que responde por esta pessoa.
 * Devolve nulo quando ela realmente não tem login — que é resposta legítima,
 * não falha.
 *
 * @param pessoa    linha de `acessos_pessoas` (usa `profile_id` e `email_corporativo`)
 * @param usuarios  linhas de `profiles` (usa `id` e `email`)
 */
export function loginDaPessoa(pessoa, usuarios) {
  if (!pessoa) return null;
  const lista = usuarios || [];

  // 1. O elo explícito, quando ele aponta pra alguém que ainda existe.
  if (pessoa.profile_id) {
    const achou = lista.find((u) => u && String(u.id) === String(pessoa.profile_id));
    if (achou) return String(achou.id);
    // Usuário removido e o elo ficou pendurado na ficha: não devolve o id
    // fantasma. Segue pro e-mail.
  }

  // 2. O e-mail corporativo — o resgate de quem tem login mas ficha não ligada.
  const email = chaveDeEmail(pessoa.email_corporativo);
  if (!email) return null;
  const porEmail = lista.find((u) => u && chaveDeEmail(u.email) === email);
  return porEmail ? String(porEmail.id) : null;
}

/**
 * O caminho inverso, que é o que a tela pergunta: quem está logado agora, qual
 * ficha de colaborador é a dele.
 *
 * Aceita o elo TAMBÉM — é o espelho do mesmo defeito: ficha ligada ao login mas
 * com o e-mail corporativo em branco não era achada pela tela.
 *
 * @param usuario  o usuário logado (usa `id` e `email`)
 * @param pessoas  linhas de `acessos_pessoas`
 */
export function pessoaDoUsuario(usuario, pessoas) {
  if (!usuario) return null;
  const lista = pessoas || [];

  if (usuario.id) {
    const porElo = lista.find((p) => p && p.profile_id && String(p.profile_id) === String(usuario.id));
    if (porElo) return porElo;
  }

  const email = chaveDeEmail(usuario.email);
  if (!email) return null;
  return lista.find((p) => p && chaveDeEmail(p.email_corporativo) === email) || null;
}

/**
 * Quem, desta lista, ficaria sem receber aviso nenhum — sem repetição.
 *
 * Existe porque o pior do defeito não era pular a pessoa, era pular CALADO.
 * Quem chama usa isto para dizer o nome de quem ficou de fora, em vez de
 * responder "0 enviados" com ar de sucesso.
 */
export function pessoasSemLogin(pessoas, usuarios) {
  const vistas = new Set();
  const fora = [];
  for (const p of pessoas || []) {
    if (!p || vistas.has(p.id)) continue;
    vistas.add(p.id);
    if (!loginDaPessoa(p, usuarios)) fora.push(p);
  }
  return fora;
}
