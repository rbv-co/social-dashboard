/* O CARTÃO DO CARRO na aba Gestão — o que ele mostra e o que ele oferece.
 *
 * Pedido do dono em 21/09/2026: *"o visual da frota não parece que é de um app
 * de frota, quero algo nível uber, 99"*. Ele entra pela Gestão, e escolheu
 * manter a ordem da tela como está — o que muda é a roupa do cartão.
 *
 * Três decisões moram aqui, e não no template, porque são REGRA e não enfeite:
 * qual palavra resume o estado, qual é a ação principal, e quais carros viram
 * cartão pequeno. Regra no template não tem teste.
 *
 * Todas as funções recebem o objeto de `estadoDoVeiculo()`. */

/**
 * O selo do canto: UMA palavra e o tom da casa.
 *
 * Por que uma palavra: o selo tinha a frase inteira ("Na rua com Cristian
 * Leonel") numa etiqueta estreita. Quem bate o olho quer a situação; quem está
 * com o carro é nome, e nome merece linha própria, onde cabe e não corta.
 *
 * Os tons são os da casa (`.selo-ok`, `-atencao`, `-info`, `-neutro`); nenhum
 * hex nasce aqui. OFICINA é `atencao` e não `erro`: carro em revisão não é
 * defeito, e vermelho num cartão que fica semanas na tela vira paisagem.
 */
export function seloDoVeiculo(e) {
  if (!e || !e.veiculo) return { texto: '', tom: 'neutro' };
  const s = e.veiculo.situacao;
  if (s === 'alienado') return { texto: 'FORA DA FROTA', tom: 'neutro' };
  if (s === 'em_manutencao') return { texto: 'OFICINA', tom: 'atencao' };
  if (s === 'inativo') return { texto: 'PARADO', tom: 'neutro' };
  if (e.naRua) return { texto: 'NA RUA', tom: 'atencao' };
  // Com responsável fixo NÃO é livre — a frase da tela já dizia isso desde
  // que "Livre, com Humberto" se contradisse sozinho. O selo diz igual.
  if (e.comQuem) return { texto: 'FIXO', tom: 'info' };
  if (e.reservadaPor || e.veiculo.reservada) return { texto: 'RESERVADO', tom: 'info' };
  return { texto: 'LIVRE', tom: 'ok' };
}

/**
 * A ação principal do cartão — a única que vira botão largo.
 *
 * O padrão da casa manda UMA ação principal por bloco: "duas competindo é o
 * mesmo que nenhuma". O cartão tinha três ou quatro botões do mesmo peso.
 * As outras não somem: continuam no cartão como botão comum.
 *
 * Nulo quando não há o que fazer — carro na oficina ou fora da frota não tem
 * ação principal, e botão largo apagado seria pior que botão nenhum.
 */
export function acaoPrincipalDoVeiculo(e, { podeEditar = false } = {}) {
  if (!e || !e.veiculo || !podeEditar) return null;
  if (e.naRua) return { chave: 'devolver', rotulo: 'Devolver' };
  if (e.veiculo.situacao !== 'ativo') return null;
  // CARRO QUE JÁ ESTÁ COM ALGUÉM não oferece "Registrar retirada" como ação
  // principal. Achei isto na primeira foto: o Bravo, fixo com o Humberto,
  // ganhou um botão largo convidando a retirar um carro que está na mão dele.
  // O botão continua existindo na linha de baixo — o que muda é o que a tela
  // EMPURRA. Com o carro na mão de alguém, o que se faz é passar ou recolher.
  if (e.comQuem) return { chave: 'passe', rotulo: 'Passar ou recolher' };
  // Só carro ATIVO e livre aceita retirada. Oferecer no carro parado criaria
  // viagem de um carro que a tela jura estar na garagem — é a mesma razão pela
  // qual "Registrar retirada" já nascia limitado ao ativo.
  return { chave: 'retirada', rotulo: 'Registrar retirada' };
}

/**
 * Quem vira cartão PEQUENO, no fim da lista.
 *
 * Decisão do dono, 21/09/2026: oficina e fora da frota "menores no fim". Eles
 * já caem no fim por `ordenarEstados()`; o que falta é ocupar menos tela.
 *
 * PARADO fica grande de propósito: ele não foi citado, e é um carro que volta a
 * circular — encolher esconderia justamente o que precisa de decisão.
 */
export function cartaoCompacto(e) {
  if (!e || !e.veiculo) return false;
  return e.veiculo.situacao === 'em_manutencao' || e.veiculo.situacao === 'alienado';
}
