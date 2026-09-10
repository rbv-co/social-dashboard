import { test } from 'node:test';
import assert from 'node:assert/strict';
import { barraDoDia, netPelaContagem, diaAnterior, diasSemPublicacao , faltaNaJanela } from './estimativa-de-seguidores.js';

// TODOS os números abaixo são REAIS: contagem de seguidores do perfil Breno Vale
// gravada em daily_snapshots, e a resposta que a Graph API deu em 2026-08-06 para
// cada um desses dias. Nada aqui é inventado.
const contagemBreno = {
  '2026-08-01': 24362,
  '2026-08-02': 24345,
  '2026-08-03': 24349,
  '2026-08-04': 24352,
  '2026-08-05': 24351,
  '2026-08-06': 24351,
};

// 01 e 02/08: o Instagram publicou. 03 a 06/08: respondeu 200 sem número.
const serieBreno = [
  { label: '2026-08-01', seguiu: 25, deixou: 25, publicado: true },
  { label: '2026-08-02', seguiu: 14, deixou: 33, publicado: true },
  { label: '2026-08-03', seguiu: 0, deixou: 0, publicado: false },
  { label: '2026-08-04', seguiu: 0, deixou: 0, publicado: false },
  { label: '2026-08-05', seguiu: 0, deixou: 0, publicado: false },
  { label: '2026-08-06', seguiu: 0, deixou: 0, publicado: false },
];

test('dia publicado passa direto, com a quebra do Instagram', () => {
  const b = barraDoDia(serieBreno[1], contagemBreno);
  assert.deepEqual(b, { iso: '2026-08-02', g: 14, l: 33, net: false, est: false });
});

test('dia NÃO publicado vira estimativa pela contagem — e não zero', () => {
  // ESTE É O BUG. Antes esta barra saía 0/0 e parecia um dia em que ninguém
  // seguiu. A contagem foi de 24.345 para 24.349: quatro pessoas a mais.
  const b = barraDoDia(serieBreno[2], contagemBreno);
  assert.equal(b.g, 4);
  assert.equal(b.l, 0);
  assert.equal(b.est, true, 'tem que sair MARCADO como estimativa');
  assert.equal(b.net, true, 'barra única: não há quebra seguiu/saiu para mostrar');
});

test('dia estimado NEGATIVO desce em vermelho', () => {
  // 04/08 24.352 → 05/08 24.351: um a menos.
  const b = barraDoDia(serieBreno[4], contagemBreno);
  assert.equal(b.g, 0);
  assert.equal(b.l, 1);
  assert.equal(b.est, true);
});

test('estimativa de saldo zero continua marcada', () => {
  // 05→06/08 a contagem não mudou. O saldo É zero — mas segue sendo ESTIMATIVA,
  // não o zero que o Instagram publicou. A marca não pode sumir só porque o
  // número deu zero: seria voltar exatamente ao defeito original.
  const b = barraDoDia(serieBreno[5], contagemBreno);
  assert.equal(b.g, 0); assert.equal(b.l, 0);
  assert.equal(b.est, true);
});

test('a soma das estimativas bate com o movimento real da contagem', () => {
  // Prova de sanidade: 02/08 = 24.345 e 06/08 = 24.351, então o período fechou em
  // +6. A soma dos quatro dias estimados tem que dar exatamente isso — senão a
  // estimativa estaria inventando ou perdendo gente pelo caminho.
  const estimados = serieBreno.filter((d) => !d.publicado).map((d) => barraDoDia(d, contagemBreno));
  const saldo = estimados.reduce((a, b) => a + b.g - b.l, 0);
  assert.equal(saldo, contagemBreno['2026-08-06'] - contagemBreno['2026-08-02']);
  assert.equal(saldo, 6);
});

test('sem contagem para estimar, fica zero MARCADO — nunca zero mudo', () => {
  // Perfil novo, ou primeiro dia do histórico: não há dia anterior de onde tirar
  // a variação. Não se inventa número, mas também não se finge que é dado.
  const b = barraDoDia({ label: '2026-08-01', seguiu: 0, deixou: 0, publicado: false }, contagemBreno);
  assert.equal(b.est, true);
  assert.equal(b.g, 0);
});

test('hoje e ontem são pulados: quem cuida deles é a contagem AO VIVO', () => {
  // Estes dois já entram no gráfico por outro caminho, com o número ao vivo. Se
  // fossem estimados aqui também, a mesma data apareceria duas vezes — a segunda
  // com o valor do banco, mais velho.
  const b = barraDoDia(serieBreno[5], contagemBreno, ['2026-08-06', '2026-08-05']);
  assert.equal(b.est, false);
  assert.equal(b.net, false);
});

test('série de cache antigo (sem o campo `publicado`) NÃO vira estimativa', () => {
  // O cache da tela dura 3 minutos, e a Edge Function pode ainda não estar
  // atualizada. Nesses casos `publicado` chega `undefined` — e `undefined` não é
  // `false`. Tratar os dois igual estimaria o painel inteiro sem necessidade.
  const antigo = { label: '2026-08-03', seguiu: 12, deixou: 5 };
  const b = barraDoDia(antigo, contagemBreno);
  assert.equal(b.est, false);
  assert.equal(b.g, 12);
  assert.equal(b.l, 5);
});

test('a lista de dias sem publicação é a que a nota do gráfico mostra', () => {
  assert.deepEqual(diasSemPublicacao(serieBreno), ['2026-08-03', '2026-08-04', '2026-08-05', '2026-08-06']);
  assert.deepEqual(diasSemPublicacao(serieBreno, ['2026-08-06']), ['2026-08-03', '2026-08-04', '2026-08-05']);
});

test('a variação da contagem é a diferença para o dia anterior', () => {
  assert.equal(netPelaContagem(contagemBreno, '2026-08-02'), -17); // 24362 → 24345
  assert.equal(netPelaContagem(contagemBreno, '2026-08-03'), 4);
  assert.equal(netPelaContagem(contagemBreno, '2026-08-01'), null); // sem 31/07 no mapa
});

test('o dia anterior atravessa a virada do mês sem escorregar', () => {
  assert.equal(diaAnterior('2026-08-01'), '2026-07-31');
  assert.equal(diaAnterior('2026-03-01'), '2026-02-28');
  assert.equal(diaAnterior('2026-01-01'), '2025-12-31');
});

/* ── O DIA QUE A META NÃO PUBLICOU SOME DO AGREGADO ─────────────────────────
 *
 * Medido em 09/09/2026, na Vessel, contra a API ao vivo:
 *   janela [04/09, 08/09) → 951 seguiu, 31 saiu   (dias 04,05,06,07)
 *   janela [05/09, 09/09) → 907 seguiu, 24 saiu   (dias 05,06,07 — o 08 SOME)
 *
 * A segunda janela tem QUATRO dias e o dia 08 valeu ~443 líquidos, mas a Meta
 * simplesmente o omite do agregado: o total sai menor sem sinal nenhum. Pior, a
 * tela estampava "✓ confirmado pelo Instagram" nesse número.
 *
 * O dono (09/09/2026): "Dia 8 n pode ficar zerado".
 */

test('soma a estimativa dos dias sem bruto dentro da janela', () => {
  const contagem = { '2026-09-07': 15877, '2026-09-08': 16320 }
  const snaps = [
    { captured_at: '2026-09-05', gained: 183, lost: 4 },
    { captured_at: '2026-09-06', gained: 339, lost: 8 },
    { captured_at: '2026-09-07', gained: 385, lost: 12 },
    { captured_at: '2026-09-08', gained: 0, lost: 0 },   // a Meta não publicou
  ]
  const r = faltaNaJanela(snaps, contagem, '2026-09-05', '2026-09-08')
  assert.deepEqual(r.dias, ['2026-09-08'])
  assert.equal(r.estimativa, 443, '16320 − 15877')
})

test('janela inteira publicada não estima nada', () => {
  const snaps = [
    { captured_at: '2026-09-04', gained: 44, lost: 7 },
    { captured_at: '2026-09-05', gained: 183, lost: 4 },
  ]
  const r = faltaNaJanela(snaps, { '2026-09-04': 1, '2026-09-05': 2 }, '2026-09-04', '2026-09-05')
  assert.deepEqual(r.dias, [])
  assert.equal(r.estimativa, 0)
})

test('⚠️ dia sem bruto E sem base de contagem entra na lista, mas não inventa número', () => {
  /* Sem o dia anterior não há de onde estimar. O dia PRECISA continuar aparecendo
   * na lista — é o que faz o selo dizer "falta o dia X" em vez de "confirmado". */
  const snaps = [{ captured_at: '2026-09-08', gained: 0, lost: 0 }]
  const r = faltaNaJanela(snaps, {}, '2026-09-08', '2026-09-08')
  assert.deepEqual(r.dias, ['2026-09-08'])
  assert.equal(r.estimativa, 0)
})

test('dias fora da janela não contam', () => {
  const snaps = [
    { captured_at: '2026-09-03', gained: 0, lost: 0 },
    { captured_at: '2026-09-05', gained: 183, lost: 4 },
  ]
  const r = faltaNaJanela(snaps, { '2026-09-02': 10, '2026-09-03': 99 }, '2026-09-05', '2026-09-08')
  assert.deepEqual(r.dias, [])
  assert.equal(r.estimativa, 0)
})

test('aguenta lista vazia e nula', () => {
  assert.deepEqual(faltaNaJanela(null, null, '2026-09-05', '2026-09-08'), { dias: [], estimativa: 0 })
  assert.deepEqual(faltaNaJanela([], {}, '2026-09-05', '2026-09-08'), { dias: [], estimativa: 0 })
})
