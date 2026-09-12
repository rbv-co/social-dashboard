import { test } from 'node:test';
import assert from 'node:assert/strict';
import { custoPorLead, agruparPorDiaEHora } from './relatorio-por-hora.js';

test('custoPorLead divide gasto por conversas', () => {
  assert.equal(custoPorLead(40, 2), 20);
});

test('custoPorLead é null sem conversa — nunca 0,00 enganoso', () => {
  assert.equal(custoPorLead(50, 0), null);
});

test('agruparPorDiaEHora: dias em ordem decrescente, horas em ordem crescente', () => {
  const linhas = [
    { dia: '2026-09-10', hora: 9, campaign_id: 'c1', gasto_hora: 10, conversas_hora: 1 },
    { dia: '2026-09-11', hora: 8, campaign_id: 'c1', gasto_hora: 20, conversas_hora: 2 },
    { dia: '2026-09-11', hora: 9, campaign_id: 'c1', gasto_hora: 5, conversas_hora: 0 },
  ];
  const out = agruparPorDiaEHora(linhas, { c1: 'Campanha A' });
  assert.deepEqual(out.map((d) => d.dia), ['2026-09-11', '2026-09-10']);
  assert.deepEqual(out[0].horas.map((h) => h.hora), [8, 9]);
});

test('agruparPorDiaEHora: campanha sem nome cai pro próprio id', () => {
  const linhas = [{ dia: '2026-09-11', hora: 8, campaign_id: 'c9', gasto_hora: 30, conversas_hora: 3 }];
  const out = agruparPorDiaEHora(linhas);
  const c = out[0].horas[0].campanhas[0];
  assert.equal(c.nome, 'c9');
  assert.equal(c.custoPorLead, 10);
});

test('agruparPorDiaEHora: campanha sem conversa naquela hora some da lista — só aparece quem converteu', () => {
  const linhas = [
    { dia: '2026-09-11', hora: 8, campaign_id: 'converteu', gasto_hora: 10, conversas_hora: 1 },
    { dia: '2026-09-11', hora: 8, campaign_id: 'nao-converteu', gasto_hora: 90, conversas_hora: 0 },
  ];
  const out = agruparPorDiaEHora(linhas);
  const h = out[0].horas[0];
  assert.deepEqual(h.campanhas.map((c) => c.campaignId), ['converteu']);
  // O total da hora continua contando o gasto de quem não apareceu na lista —
  // "quanto se gastou nessa hora" não pode ficar menor só porque a campanha
  // sem resultado foi escondida da lista.
  assert.equal(h.gastoTotal, 100);
});

test('agruparPorDiaEHora: subtotal de hora e de dia somam as campanhas', () => {
  const linhas = [
    { dia: '2026-09-11', hora: 8, campaign_id: 'c1', gasto_hora: 20, conversas_hora: 2 },
    { dia: '2026-09-11', hora: 8, campaign_id: 'c2', gasto_hora: 10, conversas_hora: 1 },
  ];
  const out = agruparPorDiaEHora(linhas);
  assert.equal(out[0].horas[0].gastoTotal, 30);
  assert.equal(out[0].horas[0].conversasTotal, 3);
  assert.equal(out[0].gastoTotal, 30);
});

test('agruparPorDiaEHora: campanhas de uma hora vêm ordenadas por gasto decrescente', () => {
  const linhas = [
    { dia: '2026-09-11', hora: 8, campaign_id: 'barata', gasto_hora: 5, conversas_hora: 1 },
    { dia: '2026-09-11', hora: 8, campaign_id: 'cara', gasto_hora: 50, conversas_hora: 1 },
  ];
  const out = agruparPorDiaEHora(linhas);
  assert.deepEqual(out[0].horas[0].campanhas.map((c) => c.campaignId), ['cara', 'barata']);
});
