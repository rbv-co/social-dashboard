// Layout das linhas de texto que ficam SOB o arco do velocímetro pequeno (um por
// canal) da Gestão à Vista. Sem Vue/DOM — node-testável em velocimetro-gv.test.mjs.
//
// POR QUE ISTO EXISTE COMO MÓDULO
// -------------------------------
// A altura do `viewBox` do SVG era calculada card a card, sob medida para as
// linhas que aquele canal tinha. Como o SVG é `width:100%; height:auto`, viewBox
// diferente = card renderizado com altura diferente. Na prática davam três
// tamanhos na mesma fileira:
//
//   canal com meta ......................... 4 linhas -> 133
//   canal sem meta, mas com histórico ...... 1 linha  ->  96
//   canal sem meta e sem histórico ......... nenhuma  ->  62
//
// O card mais pobre saía com menos da METADE da altura do mais completo. Agora a
// tela mede a rodada inteira com `alturaComum()` e desenha todos os cards com
// esse mesmo valor: a sobra do card pobre vira respiro no RODAPÉ (escolha do
// dono, 20/08/2026), e as linhas continuam empilhando coladas no arco.
//
// O empilhamento (em vez de `y` fixo por linha) é de uma rodada anterior e
// continua valendo: com `y` fixo, o comparativo ficava cravado lá embaixo e
// abria um vão enorme no meio do card sem meta — que é o caso mais comum.

// Primeira linha logo abaixo do arco, que termina em y≈78.
export const Y_PRIMEIRA_LINHA = 86;
// Respiro depois da última linha.
export const RESPIRO_RODAPE = 10;
// Card sem linha nenhuma: só o arco, como sempre foi.
export const ALTURA_SO_ARCO = 62;

const MONO = 'IBM Plex Mono,ui-monospace,monospace';
const SANS = 'Sora,sans-serif';

// Monta as linhas que EXISTEM, na ordem de leitura. O `vao` de cada uma é a
// distância até a PRÓXIMA — os valores preservam o espaçamento de quando todas
// aparecem. Linha ausente não ocupa lugar.
export function montarLinhas({
  vendidoStr,
  metaStr,
  desvioStr,
  desvioCol,
  canalNm,
  deltaStr,
  deltaCol,
} = {}) {
  return [
    vendidoStr && { t: vendidoStr, tam: 15,  peso: 500, fonte: MONO, cor: 'var(--text)',              vao: 13 },
    metaStr    && { t: metaStr,    tam: 9,   peso: 400, fonte: SANS, cor: 'var(--muted)',             vao: 12 },
    desvioStr  && { t: desvioStr,  tam: 7.5, peso: 700, fonte: SANS, cor: desvioCol || 'var(--muted)', vao: 12 },
    canalNm    && { t: canalNm,    tam: 5.4, peso: 400, fonte: SANS, cor: 'var(--muted)',             vao: 12 },
    deltaStr   && { t: deltaStr,   tam: 7.5, peso: 700, fonte: SANS, cor: deltaCol || 'var(--muted)',  vao: 0  },
  ].filter(Boolean);
}

// Dá um `y` a cada linha e devolve a altura do viewBox.
//
// `alturaForcada` é a altura comum da rodada. Ela só ESTICA o card: um valor
// menor que a altura natural é ignorado, porque encolher cortaria texto.
export function posicionarLinhas(linhas, alturaForcada) {
  const lista = linhas || [];
  let y = Y_PRIMEIRA_LINHA;
  const posicionadas = lista.map((l) => {
    const comY = { ...l, y };
    y += l.vao;
    return comY;
  });
  const natural = lista.length ? y + RESPIRO_RODAPE : ALTURA_SO_ARCO;
  const altura = Math.max(natural, Number(alturaForcada) || 0);
  return { linhas: posicionadas, altura };
}

// A maior altura natural da rodada — é com ela que todos os cards desenham.
export function alturaComum(rodada) {
  const alturas = (rodada || []).map((linhas) => posicionarLinhas(linhas).altura);
  return alturas.length ? Math.max(...alturas) : ALTURA_SO_ARCO;
}
