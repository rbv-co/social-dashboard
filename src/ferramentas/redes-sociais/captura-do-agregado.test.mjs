import { test } from 'node:test';
import assert from 'node:assert/strict';
import { capturaDoAgregado, capturaEstaNaJanela, capturasDaJanela } from './captura-do-agregado.js';

// O CASO REAL QUE ORIGINOU ESTE MÓDULO (medido em produção, 17/08/2026):
// Breno Vale, período 7D (janela 10/08..17/08), tipo "Site e alcance". As
// campanhas desse tipo estão paradas desde junho, então a consulta — que só
// limita a data por cima — devolvia a captura de 08/06 como se fosse a semana.
const siteEAlcanceDoBrenoVale = [
  { campaign_id: '120210000000000001', captured_at: '2026-06-08', spend: '6.32', impressions: '488', clicks: '2', reach: '478' },
];
const janela7D = { inicio: '2026-08-10', fim: '2026-08-17' };

test('captura de 70 dias atrás NÃO vira a semana: nenhuma linha, e a data volta pro aviso', () => {
  const c = capturaDoAgregado(siteEAlcanceDoBrenoVale, janela7D);
  assert.equal(c.foraDaJanela, true);
  assert.deepEqual(c.linhas, [], 'sem linha não há soma — o cartão mostra "—"');
  assert.equal(c.data, '2026-06-08', 'a data continua vindo: é ela que a tela escreve no aviso');
});

test('captura de dentro da janela vale, e só ela — a anterior não entra na soma', () => {
  const linhas = [
    { campaign_id: '1', captured_at: '2026-08-17', spend: '100' },
    { campaign_id: '2', captured_at: '2026-08-17', spend: '50' },
    { campaign_id: '1', captured_at: '2026-08-16', spend: '90' },
  ];
  const c = capturaDoAgregado(linhas, janela7D);
  assert.equal(c.foraDaJanela, false);
  assert.equal(c.linhas.length, 2);
  assert.equal(c.linhas.reduce((s, r) => s + parseFloat(r.spend), 0), 150);
});

test('a captura do primeiro dia da janela ainda vale (a borda é inclusiva dos dois lados)', () => {
  assert.equal(capturaDoAgregado([{ captured_at: '2026-08-10' }], janela7D).foraDaJanela, false);
  assert.equal(capturaDoAgregado([{ captured_at: '2026-08-17' }], janela7D).foraDaJanela, false);
  assert.equal(capturaDoAgregado([{ captured_at: '2026-08-09' }], janela7D).foraDaJanela, true);
});

test('resposta vazia NÃO é captura velha: fora da janela fica falso e não há aviso a dar', () => {
  const c = capturaDoAgregado([], janela7D);
  assert.deepEqual(c, { data: null, foraDaJanela: false, linhas: [] });
});

test('entrada que não é lista (erro de leitura) devolve o mesmo vazio, sem quebrar', () => {
  assert.deepEqual(capturaDoAgregado(null, janela7D), { data: null, foraDaJanela: false, linhas: [] });
  assert.deepEqual(capturaDoAgregado(undefined, janela7D), { data: null, foraDaJanela: false, linhas: [] });
});

test('HOJE e 1D pedem um dia exato: janela de um dia só aceita aquele dia', () => {
  const umDia = { inicio: '2026-08-17', fim: '2026-08-17' };
  assert.equal(capturaEstaNaJanela('2026-08-17', umDia), true);
  assert.equal(capturaEstaNaJanela('2026-08-16', umDia), false);
  assert.equal(capturaEstaNaJanela('2026-08-18', umDia), false);
});

test('sem janela nenhuma, nada é recusado — o comportamento antigo continua alcançável', () => {
  assert.equal(capturaEstaNaJanela('2026-06-08', {}), true);
  assert.equal(capturaEstaNaJanela('2026-06-08', undefined), true);
});

test('data ausente nunca vale por si: sem data não há como provar que está na janela', () => {
  assert.equal(capturaEstaNaJanela(null, janela7D), false);
  assert.equal(capturaEstaNaJanela('', janela7D), false);
});

/* ── INTERVALO ESCOLHIDO: SOMA OS DIAS, NÃO ESCOLHE UM ──────────────────────
 *
 * ⚠️ OS CARTÕES DE META ADS NUNCA TIVERAM JANELA PERSONALIZADA. Eles liam
 * `period_days = closestStoredPeriod(dias)` — ou seja, arredondavam o intervalo
 * escolhido para a captura agregada de 1, 7, 14 ou 30 dias mais próxima, e
 * pegavam UMA captura. Escolher 5 a 9 (4 dias) caía na de 1 dia; vindo de "7
 * dias", caía na mesma de antes e os números não mudavam.
 *
 * O dono, em 09/09/2026: "periodo personalizado ta bugado, ele n tras o periodo
 * em questão, fica bugado mantendo o atual... aconteceu principalmente nos cards
 * do meta ads".
 *
 * Medido no mesmo dia: existe captura DIÁRIA (`period_days = 0`) cobrindo o
 * período, e somá-la dá R$ 14.948,60 de investimento entre 5 e 9 de setembro.
 */

test('soma todos os dias do intervalo, não só o mais recente', () => {
  const linhas = [
    { captured_at: '2026-09-09', campaign_id: 'a', spend: 10 },
    { captured_at: '2026-09-08', campaign_id: 'a', spend: 20 },
    { captured_at: '2026-09-08', campaign_id: 'b', spend: 5 },
    { captured_at: '2026-09-07', campaign_id: 'a', spend: 30 },
  ]
  const r = capturasDaJanela(linhas, { inicio: '2026-09-07', fim: '2026-09-09' })
  assert.equal(r.linhas.length, 4)
  assert.deepEqual(r.dias, ['2026-09-07', '2026-09-08', '2026-09-09'])
  assert.equal(r.foraDaJanela, false)
})

test('dia fora do intervalo fica de fora', () => {
  const linhas = [
    { captured_at: '2026-09-10', campaign_id: 'a', spend: 99 },
    { captured_at: '2026-09-08', campaign_id: 'a', spend: 20 },
    { captured_at: '2026-09-04', campaign_id: 'a', spend: 77 },
  ]
  const r = capturasDaJanela(linhas, { inicio: '2026-09-05', fim: '2026-09-09' })
  assert.deepEqual(r.linhas.map((l) => l.spend), [20])
  assert.deepEqual(r.dias, ['2026-09-08'])
})

test('⚠️ nenhum dia dentro do intervalo NÃO é "captura velha" — é vazio', () => {
  /* `capturaDoAgregado` marca `foraDaJanela` para avisar que a captura mais nova
   * é antiga demais. Aqui isso não existe: ou o dia está no intervalo, ou não é
   * desta janela. Marcar "fora" faria a tela escrever um aviso que não cabe. */
  const r = capturasDaJanela([{ captured_at: '2026-01-01', campaign_id: 'a', spend: 1 }],
    { inicio: '2026-09-05', fim: '2026-09-09' })
  assert.deepEqual(r.linhas, [])
  assert.deepEqual(r.dias, [])
  assert.equal(r.foraDaJanela, false)
})

test('aguenta lista vazia, nula e linha sem data', () => {
  for (const ruim of [null, undefined, [], [{ campaign_id: 'a' }]]) {
    const r = capturasDaJanela(ruim, { inicio: '2026-09-05', fim: '2026-09-09' })
    assert.deepEqual(r.linhas, [])
    assert.deepEqual(r.dias, [])
  }
})

test('janela incompleta não deixa passar tudo', () => {
  // Sem início ou sem fim não há intervalo — devolver tudo somaria meses.
  const linhas = [{ captured_at: '2026-09-08', campaign_id: 'a', spend: 20 }]
  assert.deepEqual(capturasDaJanela(linhas, { inicio: '2026-09-05' }).linhas, [])
  assert.deepEqual(capturasDaJanela(linhas, {}).linhas, [])
  assert.deepEqual(capturasDaJanela(linhas, null).linhas, [])
})
