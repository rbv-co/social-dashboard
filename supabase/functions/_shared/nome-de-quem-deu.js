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

/** Frouxa: primeiro nome IGUAL e sobrenome quase igual (até 2 letras de
 *  diferença). ⚠️ Só pode ser usada quando o pedido está marcado PRESENTE —
 *  a marca é a segunda prova que autoriza afrouxar o nome. */
export function nomesChegamPerto(digitado, doPedido) {
  const a = pedacos(digitado), b = pedacos(doPedido);
  if (a.length < 2 || b.length < 2) return false;
  if (a[0] !== b[0]) return false;
  return distancia(a[a.length - 1], b[b.length - 1]) <= 2;
}
