// supabase/functions/_shared/nome-de-quem-deu.js
// "É PRESENTE?": a presenteada informa o nome de quem deu, e é ESTA regra que
// decide se a garantia é aprovada na hora ou fica na fila de gente.
//
// ⚠️ ELA APROVA SEM NINGUÉM OLHAR. Frouxa demais entrega a peça a quem não é
// dona; apertada demais joga cliente honesta na fila. Na dúvida, FILA.

const PARTICULAS = new Set(['de', 'da', 'do', 'das', 'dos', 'e']);

export function normalizarNome(texto) {
  return String(texto ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')  // tira acento
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function pedacos(nome) {
  return normalizarNome(nome).split(' ').filter((p) => p && !PARTICULAS.has(p));
}

/** Estrita: primeiro nome igual E último sobrenome igual. */
export function nomesBatem(digitado, doPedido) {
  const a = pedacos(digitado), b = pedacos(doPedido);
  if (a.length < 2 || b.length < 2) return false;
  return a[0] === b[0] && a[a.length - 1] === b[b.length - 1];
}

/** Distância de edição, limitada — só para sobrenome escrito errado. */
function distancia(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1,
                         d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return d[a.length][b.length];
}

/** O quanto a distância pode tolerar, dado o tamanho do MENOR sobrenome.
 *
 *  ⚠️ Correção de revisão (rodada 1): um limite fixo de 2 aprovava
 *  sobrenomes CURTOS e diferentes como se fossem erro de digitação —
 *  "Pina"/"Lima", "Neis"/"Reis", "Nelo"/"Melo", "Dip"/"Dias" são pessoas
 *  diferentes, não a mesma pessoa digitando errado. Num nome curto, 2 letras
 *  trocadas já é a metade da palavra — isso é outra pessoa, não um erro de
 *  digitação. O limite escala com o tamanho: nome curto exige igualdade
 *  exata, nome longo aceita mais erro. Esta função aprova garantia sem
 *  ninguém olhar; na dúvida, o limite fica mais apertado, não mais frouxo. */
function limiteDeDistancia(tamanho) {
  if (tamanho < 5) return 0;
  if (tamanho <= 7) return 1;
  return 2;
}

/** Frouxa: primeiro nome IGUAL e sobrenome quase igual (dentro do limite que
 *  escala com o tamanho — ver `limiteDeDistancia`). ⚠️ Só pode ser usada
 *  quando o pedido está marcado PRESENTE — a marca é a segunda prova que
 *  autoriza afrouxar o nome. */
export function nomesChegamPerto(digitado, doPedido) {
  const a = pedacos(digitado), b = pedacos(doPedido);
  if (a.length < 2 || b.length < 2) return false;
  if (a[0] !== b[0]) return false;
  const sobrenomeA = a[a.length - 1], sobrenomeB = b[b.length - 1];
  const limite = limiteDeDistancia(Math.min(sobrenomeA.length, sobrenomeB.length));
  return distancia(sobrenomeA, sobrenomeB) <= limite;
}
