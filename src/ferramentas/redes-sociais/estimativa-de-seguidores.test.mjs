import { test } from 'node:test';
import assert from 'node:assert/strict';
import { barraDoDia, netPelaContagem, diaAnterior, diasSemPublicacao , totalPelasBarras } from './estimativa-de-seguidores.js';

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

/* ── O CARD É A SOMA DO GRÁFICO ─────────────────────────────────────────────
 *
 * Decisão do dono (09/09/2026), depois de uma tarde inteira de tentativas:
 * "o importante é o card de novos seguidores bater sempre com o gráfico diário".
 *
 * ⚠️ O QUE ESTAVA ERRADO NA ORIGEM: perseguir igualdade com o painel profissional.
 * Ele filtra OUTRO período — "últimos 7 dias" nele vai de 2 a 7, e "5 a 8" mostra
 * 4 a 7. Medido pelo dono no painel dele. Enquanto se tentava casar os dois, o
 * card e o gráfico da nossa tela divergiam entre si, que é o que a pessoa vê.
 *
 * Medido em 09/09/2026, "últimos 7 dias" na Vessel: as barras somavam 1593 e o
 * card mostrava 967 — a janela do card parava no dia 08 e deixava de fora os dois
 * maiores dias. Agora o card É a soma.
 */

test('o total do card sai da soma das barras', () => {
  const r = totalPelasBarras({ gained: [27, 20, 37, 183], lost: [0, 0, 0, 4], estimado: [false, false, false, false] })
  assert.equal(r.seguiu, 267)
  assert.equal(r.deixou, 4)
  assert.equal(r.total, 263)
  assert.equal(r.estimado, false)
})

test('⚠️ barra estimada guarda o LÍQUIDO, e o total continua certo', () => {
  /* Dia sem publicação vira uma barra só, com o saldo: positivo entra em `gained`,
   * negativo em `lost`. Somar os dois lados e subtrair dá o líquido certo — o que
   * NÃO dá para saber é quantos seguiram e quantos saíram nesse dia. */
  const r = totalPelasBarras({ gained: [385, 443], lost: [12, 0], estimado: [false, true] })
  assert.equal(r.total, 816, '385−12 + 443')
  assert.equal(r.estimado, true, 'e o total sai marcado')
})

test('dia negativo estimado desce o total', () => {
  const r = totalPelasBarras({ gained: [100, 0], lost: [0, 30], estimado: [false, true] })
  assert.equal(r.total, 70)
})

test('⚠️ gráfico vazio ou estragado devolve nulo, não zero', () => {
  /* Zero seria "não seguiu ninguém" — uma afirmação. A verdade é "não há gráfico",
   * e quem chama tem de manter o número que já estava. */
  for (const ruim of [null, undefined, {}, { gained: null }, { gained: [] }]) {
    assert.equal(totalPelasBarras(ruim), null)
  }
})

test('lost ausente não quebra a conta', () => {
  const r = totalPelasBarras({ gained: [10, 20] })
  assert.equal(r.total, 30)
  assert.equal(r.deixou, 0)
})
