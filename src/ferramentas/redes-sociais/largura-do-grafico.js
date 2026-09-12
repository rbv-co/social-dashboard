// QUANTO ESPAÇO UM GRÁFICO DE UM PONTO POR DIA PRECISA TER.
//
// O PROBLEMA QUE ISTO EXISTE PARA RESOLVER (medido a 375px, período de 30 dias,
// na tela /redes-sociais):
//
//   Investimento por dia ......... 19 números, 3 pares sobrepostos, −5px de folga
//   Custo por seguidor por dia ... 18 números, 8 pares sobrepostos, −5px de folga
//   Novos seguidores por dia ..... 32 rótulos, 2 pares sobrepostos
//
// Pares reais que se encavalavam: "R$ 17,34"×"R$ 11,35", "R$ 2,88"×"Meta máxima
// R$ 3,00", "15/8"×"16/8", "+22"×"Meta 69/dia".
//
// A CAUSA É FÍSICA, não de arrumação: o gráfico tinha 319px de largura e 30 dias
// para mostrar — ~10px por dia. "R$ 17,34" não cabe em 10px em fonte nenhuma.
// Diminuir a letra já tinha sido tentado (era 9px, o menor que se lê) e continuou
// sobrepondo. Não existe arrumação que caiba 30 valores em moeda em 319px.
//
// A SAÍDA: cada dia recebe no MÍNIMO 30px. Quando os dias cabem nesse mínimo,
// nada muda — o gráfico continua do tamanho do cartão, e 7 e 14 dias no celular
// e o computador inteiro ficam exatamente como estão hoje. Quando não cabem, o
// gráfico fica maior que o cartão e rola PARA O LADO dentro dele.
//
// POR QUE ESTE ARQUIVO É SEPARADO E PURO: a conta é a decisão inteira ("rola ou
// não rola, e com que largura"), e ela vale para os dois gráficos, que são
// desenhados de jeitos diferentes (um SVG esticado com rótulos em HTML, outro
// SVG uniforme com os rótulos dentro). Regra repetida em dois lugares é regra
// que vai divergir. Aqui ela se testa sem navegador, e a tela só obedece.

/** 30px por ponto: o menor espaço em que "R$ 17,34" ao lado de outro igual não
 *  se toca. Medido no aparelho, não estimado. */
export const MINIMO_POR_PONTO = 30;

/** Largura da faixa apagada da direita, que avisa que o gráfico continua para o
 *  lado. Sem esse aviso ninguém descobre que dá para arrastar. O mesmo 28 está
 *  no CSS da tela (`.grafico-que-rola.rolando::after`) — CSS não lê constante de
 *  JavaScript, então os dois andam juntos na mão. */
export const FAIXA_QUE_AVISA = 28;

/** Tira VAZIA na ENTRADA do trilho.
 *
 *  Os rótulos são CENTRADOS no ponto, e o primeiro ponto fica na beirada: metade
 *  do rótulo dele sobra para fora do desenho. Fora do desenho, dentro de uma
 *  caixa que rola, é lugar RECORTADO — medido a 375px, "R$ 17,34" do primeiro
 *  dia aparecia como "$ 17,34" e a primeira data como "/7". */
export const ESPACO_ANTES_DO_GRAFICO = 24;

/** Tira VAZIA na SAÍDA do trilho. Mesmo motivo da tira da entrada, mais um: é
 *  aqui que a faixa apagada vai cair. Por isso ela é maior que a faixa — assim a
 *  faixa nunca apaga o rótulo do último dia, que seria esconder o último dia
 *  para avisar que existem dias escondidos. */
export const ESPACO_DEPOIS_DO_GRAFICO = 48;

/** Largura de projeto dos dois gráficos (o `viewBox` de ambos nasceu com 400).
 *  Serve de rede quando o contêiner ainda não pôde ser medido. */
export const LARGURA_QUANDO_NAO_DA_PRA_MEDIR = 400;

function numeroPositivo(valor, quandoNaoDer) {
  const n = Number(valor);
  return Number.isFinite(n) && n > 0 ? n : quandoNaoDer;
}

/**
 * A conta do tamanho do gráfico.
 *
 * `pontos`            = quantos dias (ou barras) vão ser desenhados.
 * `larguraDisponivel` = o quanto o cartão dá de largura, em pixels de tela.
 * `minimoPorPonto`    = espaço mínimo por dia; 30px por padrão.
 *
 * Devolve:
 *   largura         → a largura de desenho do gráfico, em pixels.
 *   rola            → se ele ficou maior que o cartão e precisa rolar para o lado.
 *   larguraDaTrilha → a largura TOTAL do trilho: o desenho mais as duas tiras
 *                     vazias, que existem para nenhum rótulo de beirada ser
 *                     recortado nem apagado pela faixa de aviso.
 *   espacoPorPonto  → quanto cada dia ganhou de fato (serve para a tela decidir
 *                     se agora cabe número dentro da barra).
 */
export function larguraDoGrafico({ pontos, larguraDisponivel, minimoPorPonto = MINIMO_POR_PONTO } = {}) {
  // Contêiner com largura 0, negativa ou não numérica é contêiner que AINDA NÃO
  // FOI MEDIDO (desenho antes do layout, cartão escondido). Zero lido como "não
  // tem espaço" mandaria todo gráfico rolar — inclusive no computador, onde
  // espaço sobra. Nesses casos vale a largura de projeto.
  const disponivel = Math.ceil(numeroPositivo(larguraDisponivel, LARGURA_QUANDO_NAO_DA_PRA_MEDIR));
  const minimo = numeroPositivo(minimoPorPonto, MINIMO_POR_PONTO);
  const n = Math.floor(numeroPositivo(pontos, 0));

  // Sem ponto nenhum não há o que espremer: o gráfico fica do tamanho do cartão.
  if (n <= 0) return { largura: disponivel, rola: false, larguraDaTrilha: disponivel, espacoPorPonto: 0 };

  const necessaria = Math.ceil(n * minimo);
  // O máximo (e não o necessário puro) é o que impede uma semana de virar um toco
  // de 210px no meio de um cartão de 1200px.
  const largura = Math.max(disponivel, necessaria);
  const rola = necessaria > disponivel;
  return {
    largura,
    rola,
    larguraDaTrilha: rola ? largura + ESPACO_ANTES_DO_GRAFICO + ESPACO_DEPOIS_DO_GRAFICO : largura,
    espacoPorPonto: largura / n,
  };
}

/** Folga mínima entre dois rótulos vizinhos, em unidades do desenho. Encostar
 *  não vale: dois números colados se leem como um número só. */
export const FOLGA_ENTRE_ROTULOS = 6;

/**
 * Onde ancorar um rótulo para ele não sair do quadro.
 *
 * O DEFEITO QUE ISTO RESOLVE (medido a 375px, 30 dias, valores reais):
 * "R$ 92,86", o rótulo do PRIMEIRO dia, sobrava 12,3px para fora da caixa do
 * próprio SVG — e o mesmo espelhado no último dia. O rótulo é centrado no ponto,
 * e o primeiro ponto fica a 10 unidades da borda: metade de um rótulo de ~48
 * unidades não cabe em 10. Fora do desenho, dentro de uma caixa que rola, é
 * lugar que pode não ter como alcançar.
 *
 * `centro` = onde o ponto está · `largura` = quanto o texto mede de verdade
 * (medido no navegador, não estimado) · `quadro` = a largura do desenho.
 *
 * Devolve o `x` e a âncora para o `<text>`: encostado na borda quando não cabe
 * centrado, centrado quando cabe — quem já cabe não se mexe.
 */
export function ancoraDoRotulo({ centro, largura, quadro }) {
  const meia = (Number(largura) || 0) / 2;
  const c = Number(centro) || 0;
  const q = Number(quadro) || 0;
  if (c - meia < 0) return { x: 0, ancora: 'start' };
  // Rótulo maior que o quadro inteiro já caiu no caso de cima: começa no início,
  // porque o começo do número ("R$ 1...") é a parte que mais importa ler.
  if (c + meia > q) return { x: q, ancora: 'end' };
  return { x: c, ancora: 'middle' };
}

/**
 * Quais rótulos cabem sem se tocar.
 *
 * O DEFEITO QUE ISTO RESOLVE (medido a 375px, 30 dias, valores reais):
 * "R$ 20,41" × "R$ 26,40" sobrepostos. Nasce de três coisas juntas, e só das
 * três: um dia SEM DADO encurta a lista de dias com número e faz o passo do
 * rótulo cair no vizinho do último; o último dia é SEMPRE rotulado, esteja no
 * passo ou não, então dois rótulos ficam a um dia de distância; e os dois têm
 * altura parecida porque o dia mais caro do mês puxa a escala.
 *
 * POR QUE A CONTA OLHA OS DOIS EIXOS: só a distância horizontal não decide. Dois
 * rótulos vizinhos com alturas bem diferentes não se tocam, e derrubar um deles
 * seria perder número à toa. Quem manda é a caixa inteira.
 *
 * `candidatos` = [{ chave, caixa: { x0, x1, y0, y1 }, obrigatorio }], já na
 * ordem em que devem ser disputados dentro de cada grupo.
 *
 * Os obrigatórios (o último dia, o dia mais alto) passam na frente. Quando dois
 * obrigatórios se tocam entre si — o dia mais alto colado no último —, sobra o
 * primeiro da lista. Perder um número é ruim; dois números ilegíveis um por cima
 * do outro é pior, e a barra mais alta continua sendo visivelmente a mais alta.
 */
export function rotulosQueCabem(candidatos, folga = FOLGA_ENTRE_ROTULOS) {
  const lista = Array.isArray(candidatos) ? candidatos : [];
  const naFrente = lista.filter((c) => c && c.obrigatorio);
  const depois = lista.filter((c) => c && !c.obrigatorio);
  const mantidos = [];
  for (const c of naFrente.concat(depois)) {
    const cabe = mantidos.every((m) => !seTocam(c.caixa, m.caixa, folga));
    if (cabe) mantidos.push(c);
  }
  // De volta à ordem em que vieram: quem desenha espera a ordem do desenho, não
  // a ordem da disputa.
  return lista.filter((c) => mantidos.includes(c)).map((c) => c.chave);
}

function seTocam(a, b, folga) {
  if (!a || !b) return false;
  const cruzaNaHorizontal = a.x0 - folga < b.x1 && b.x0 - folga < a.x1;
  const cruzaNaVertical = a.y0 < b.y1 && b.y0 < a.y1;
  return cruzaNaHorizontal && cruzaNaVertical;
}

/* ── O SELO DA META, no canto de cima do gráfico ──────────────────────────── */

/** Largura média de um caractere do selo, MEDIDA no navegador (10/09/2026):
 *  "Meta máxima R$ 2,00" = 19 caracteres em 90,8px → 4,78px cada.
 *
 *  ⚠️ A conta antiga usava 4,4 "no corpo 8" — e o corpo NÃO é 8. O CSS é
 *  `max(9px, calc(8px * --escala-texto))`, e o piso de 9px é quem manda em escala
 *  1. A caixinha nascia curta e a palavra sangrava para fora dela: medido, o
 *  texto terminava 3,2px DEPOIS da borda direita, e ainda comia o respiro que
 *  deveria sobrar daquele lado. O dono viu na tela antes de qualquer teste pegar.
 *
 *  Este número é só o PLANO B: quem manda é a medida real do texto desenhado
 *  (`caixaDoSelo` recebe a caixa medida). Ele entra quando o SVG ainda não
 *  renderizou — cartão escondido, aba em segundo plano — e aí é melhor sobrar
 *  caixa do que faltar. Por isso 4,9 e não 4,78: erra para o lado que não corta. */
export const LARGURA_POR_LETRA_DO_SELO = 4.9;

/** Respiro entre a palavra e a borda da caixinha. Era 4 à esquerda e ZERO à
 *  direita (a conta não reservava o outro lado). Agora são os dois, e menores:
 *  o dono pediu a caixinha menor no mesmo pedido em que apontou o sangramento. */
export const RESPIRO_DO_SELO = 3;

/** O rótulo do selo, ABREVIADO — e só o do selo.
 *
 *  O dono pediu a caixinha menor, e a fonte não pode encolher: 9px é o piso de
 *  leitura desta tela (ver o comentário no topo deste arquivo, onde diminuir a
 *  letra já foi tentado e não resolveu). O que sobra é a palavra.
 *
 *  "Meta máx." é o MESMO vocabulário que o cartão logo acima já usa no canto
 *  ("META MÁX"), então não é corte, é a abreviação da casa. E nada se perde: a
 *  linha tracejada continua dizendo "Meta máxima: R$ 2,00" por extenso no toque
 *  longo — quem quiser a palavra inteira a tem.
 */
export function rotuloCurtoDoSelo(rotulo) {
  return String(rotulo || '')
    .replace(/\bmáxima\b/gi, 'máx.')
    .replace(/\bmínima\b/gi, 'mín.');
}

/** A caixinha do selo da meta, a partir da caixa REAL do texto já desenhado.
 *
 *  `caixaDoTexto` é o que `getBBox()` devolveu ({x0,x1,y0,y1}), ou `null` quando
 *  não deu para medir — aí vale o plano B, pelo número de letras.
 *
 *  Devolve sempre {x, y, largura, altura}, pronto para o <rect>. */
export function caixaDoSelo(caixaDoTexto, { texto = '', x = 0, y = 0, respiro = RESPIRO_DO_SELO } = {}) {
  if (caixaDoTexto && caixaDoTexto.x1 > caixaDoTexto.x0) {
    // ⚠️ NUNCA ACIMA DE ZERO. A caixa medida do texto começa em y ≈ 0,9, e tirar o
    // respiro dela punha a tarja em −0,56: meio pixel FORA do desenho. Hoje o SVG
    // não corta e ninguém vê, mas basta um `overflow:hidden` em qualquer pai para
    // a linha de cima sumir — e aí o defeito aparece longe daqui, sem pista.
    const topo = Math.max(0, caixaDoTexto.y0 - respiro / 2);
    return {
      x: caixaDoTexto.x0 - respiro,
      y: topo,
      largura: (caixaDoTexto.x1 - caixaDoTexto.x0) + respiro * 2,
      // A altura acompanha o topo que foi represado, senão a base subiria junto e
      // a caixinha ficaria apertada embaixo.
      altura: (caixaDoTexto.y1 + respiro / 2) - topo,
    };
  }
  return {
    x, y,
    largura: String(texto).length * LARGURA_POR_LETRA_DO_SELO + respiro * 2,
    altura: 11,
  };
}
