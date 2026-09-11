/* O CELULAR COMO O BLING ACEITA.
 *
 * ⚠️ POR QUE ESTE ARQUIVO EXISTE: em 11/09/2026 quatro cadastros da lista de
 * espera nunca viraram contato no Bling. Medido: eram exatamente os quatro
 * cujo telefone começava com `+55`, e a taxa de sucesso deles era 0 de 4. Os
 * outros 30 entraram em qualquer formato — `19999990000`, `(19) 99999-0000`,
 * `19 9 99999-00`. O Bling responde 400 com "É necessário preencher
 * corretamente o campo Celular" e a linha fica presa, tentando de novo para
 * sempre com o mesmo número.
 *
 * A LP aceita 10 a 13 dígitos de propósito (gente digita com e sem o país), e
 * está certa: quem normaliza para o Bling é quem fala com o Bling.
 */

/** O DDI do Brasil. Só ele sai — número estrangeiro não é assunto daqui. */
const DDI_BRASIL = '55';

/**
 * Devolve o celular pronto para o Bling, ou `null` quando não dá para confiar.
 *
 * ⚠️ DEVOLVER `null` É MELHOR QUE DEVOLVER UM PALPITE. Número que não é
 * brasileiro, ou que ficou com contagem estranha depois de tirar o DDI, sai
 * daqui como nulo — o contato entra sem celular, que é recuperável, em vez de
 * entrar com um número errado, que ninguém descobre até ligar para a pessoa.
 */
export function celularParaOBling(bruto) {
  const so = String(bruto ?? '').replace(/\D/g, '');
  if (!so) return null;

  // 12 ou 13 dígitos começando em 55 é DDD+número com o país na frente.
  // 13 = 55 + DDD(2) + celular(9); 12 = 55 + DDD(2) + fixo(8).
  const semPais = (so.length === 12 || so.length === 13) && so.startsWith(DDI_BRASIL)
    ? so.slice(DDI_BRASIL.length)
    : so;

  // Sobrou o que o Brasil usa: 10 (fixo) ou 11 (celular) dígitos.
  if (semPais.length !== 10 && semPais.length !== 11) return null;

  // ⚠️ CELULAR BRASILEIRO TEM 9 NA TERCEIRA CASA — depois dos dois do DDD.
  // Sem esta linha, um número de fora com onze dígitos entra fingindo ser
  // daqui: `+1 415 555 0100` vira `14155550100`, que parece DDD 14 e passa.
  // O contato nasceria com o telefone de um estranho, e ninguém descobre até
  // alguém ligar.
  if (semPais.length === 11 && semPais[2] !== '9') return null;

  return semPais;
}
