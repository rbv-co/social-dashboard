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
 * O tom do FILETE do cartão (Onda 2b da cor, 23/09/2026): o MESMO do selo, na
 * régua `--situacao-*` da Central (classe `id-tom-<tom>`).
 *
 * Sai do selo, e não de uma regra própria, porque o filete e o selo moram no
 * mesmo cartão: se discordarem, a pessoa não sabe em qual acreditar. Era o que
 * acontecia antes — o filete dizia verde no carro FIXO (selo azul) e azul no
 * carro NA RUA (selo laranja).
 *   ok → viva (verde) · atencao → queda (laranja) · info → andamento (azul)
 *   neutro → parada (cinza)
 */
const TOM_DO_SELO = { ok: 'viva', atencao: 'queda', info: 'andamento', neutro: 'parada' };
export function tomDoCartao(e) {
  return TOM_DO_SELO[seloDoVeiculo(e).tom] || 'parada';
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
 * A linha embaixo do nome: o COMPLEMENTO do selo, nunca a repetição dele.
 *
 * Ela nasceu como `resumoDoEstado()`, que carregava a frase inteira ("Na rua
 * com Cristian Leonel") porque não havia selo. Com o selo, a frase passou a
 * dizer duas vezes a mesma coisa — o dono viu na primeira foto e pediu para
 * tirar: *"quero funcional, não carregado"*. A função antiga foi movida para
 * cá e encurtada, em vez de ganhar uma irmã: duas funções respondendo à mesma
 * pergunta divergem no primeiro ajuste.
 *
 * Vazio é resposta legítima — o template esconde a linha. Carro na oficina sem
 * local não tem o que acrescentar ao selo que já diz OFICINA.
 */
export function linhaDoCartao(e) {
  if (!e || !e.veiculo) return '';
  const onde = e.ondeEsta ? `Em ${e.ondeEsta}` : '';
  // Carro que não está circulando: o selo já disse o que ele é. Sobra o lugar.
  if (e.veiculo.situacao !== 'ativo') return onde;
  // Quem está com o carro vence, na rua ou em posse — é a mesma precedência
  // que `estadoDoVeiculo` usa, e o nome não se repete no selo (ele diz NA RUA
  // ou FIXO, nunca um nome de pessoa).
  if (e.comQuem) return `Com ${e.comQuem}`;
  if (e.reservadaPor) return `Para ${e.reservadaPor}`;
  // Sem responsável mas COM contato: responsável é quem responde pelo carro,
  // contato é a quem perguntar. O dono estranhou a Doblo justamente por as
  // duas coisas se confundirem, e a resposta continua sendo dizer as duas.
  if (e.veiculo.contato_nome) {
    return onde ? `${onde} · perguntar a ${e.veiculo.contato_nome}`
      : `Perguntar a ${e.veiculo.contato_nome}`;
  }
  return onde;
}

/**
 * Quem vira cartão PEQUENO, no fim da lista.
 *
 * Decisão do dono, 21/09/2026: oficina e fora da frota "menores no fim". Eles
 * já caem no fim por `ordenarEstados()`; o que falta é ocupar menos tela.
 *
 * PARADO entrou na segunda passada, olhando a foto: eu o tinha deixado grande
 * por ele não ter sido citado, e o dono fechou a regra — *"funcional, não
 * carregado"*. A regra ficou uma só e fácil de dizer: **carro que não está
 * circulando ocupa menos tela.** É a mesma linha que decide o esmaecido do
 * cartão, então as duas nunca discordam.
 */
export function cartaoCompacto(e) {
  if (!e || !e.veiculo) return false;
  return e.veiculo.situacao !== 'ativo';
}
