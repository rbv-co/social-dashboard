import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  custoPorLead, agruparPorDiaEHora, tipoDaCampanha,
  montarMensagemWpp, leadsWppNoDia, gastoWppNoDia, montarMensagemSeguidores, deltaDeSeguidoresPorHora, seguidoresNaHora,
  seguidoresTotalNaHora, seguidoresNoDia,
} from './relatorio-por-hora.js';

// Cópia de src/ferramentas/meta-ads/relatorio-por-hora.test.mjs, só a parte
// que enviar-relatorio-hora usa (ver comentário no topo do módulo irmão).

test('custoPorLead é null sem conversa — nunca 0,00 enganoso', () => {
  assert.equal(custoPorLead(50, 0), null);
  assert.equal(custoPorLead(40, 2), 20);
});

test('tipoDaCampanha: reconhece os dois prefixos e cai em "outro" pro resto', () => {
  assert.equal(tipoDaCampanha('[CAMPANHA WPP] Criativo 1'), 'wpp');
  assert.equal(tipoDaCampanha('[+ SEGUIDORES] Reels 1'), 'seguidores');
  assert.equal(tipoDaCampanha('Post do Instagram: Vlog'), 'outro');
});

test('agruparPorDiaEHora: uma hora, uma conta — mesma forma que o Relatório por Hora usa', () => {
  const linhas = [
    { dia: '2026-09-12', hora: 13, campaign_id: 'c1', gasto_hora: 100, conversas_hora: 4 },
    { dia: '2026-09-12', hora: 13, campaign_id: 'c2', gasto_hora: 20, conversas_hora: 0 },
  ];
  const nomes = { c1: '[CAMPANHA WPP] X', c2: 'Post do Instagram' };
  const out = agruparPorDiaEHora(linhas, nomes);
  assert.equal(out.length, 1);
  assert.equal(out[0].horas.length, 1);
  assert.equal(out[0].horas[0].campanhas.length, 2);
});

test('montarMensagemWpp: null quando não há campanha WPP nessa hora', () => {
  const campanhas = [{ campaignId: 'c1', nome: 'Post do Instagram', tipo: 'outro', gastoHora: 10, conversasHora: 1 }];
  assert.equal(montarMensagemWpp('2026-09-12', 13, campanhas), null);
});

test('montarMensagemWpp: lista as campanhas, depois Leads no período / Gasto / Custo por lead / Total de leads no dia', () => {
  const campanhas = [
    { campaignId: 'c1', nome: '[CAMPANHA WPP] Criativo 1', tipo: 'wpp', gastoHora: 100, gastoAcumulado: 400, conversasHora: 4 },
    { campaignId: 'c2', nome: 'Post do Instagram', tipo: 'outro', gastoHora: 999, gastoAcumulado: 999, conversasHora: 999 },
  ];
  const msg = montarMensagemWpp('2026-09-12', 13, campanhas, 9, 145.9);
  assert.match(msg, /^📊 Leads recebidos — 13h, 12\/09/);
  assert.match(msg, /\[CAMPANHA WPP\] Criativo 1 — 4 leads · Gasto no período: R\$\s?100,00 · Gasto total: R\$\s?400,00/);
  assert.doesNotMatch(msg, /Post do Instagram/, 'campanha fora do WPP vazou pra mensagem');
  assert.match(msg, /Gasto total das campanhas: R\$\s?400,00\n\nLeads no período: 4\nGasto: R\$\s?100,00\nCusto por lead: R\$\s?25,00\n\nTotal de leads no dia: 9\nTotal de gasto no dia: R\$\s?145,90$/);
});

test('leadsWppNoDia/gastoWppNoDia: somam só WPP, em todas as horas do dia', () => {
  const horas = [
    { campanhas: [{ tipo: 'wpp', conversasHora: 4, gastoHora: 100 }] },
    { campanhas: [{ tipo: 'wpp', conversasHora: 5, gastoHora: 45.9 }, { tipo: 'outro', conversasHora: 999, gastoHora: 999 }] },
  ];
  assert.equal(leadsWppNoDia(horas), 9);
  assert.equal(gastoWppNoDia(horas), 145.9);
});

test('montarMensagemSeguidores: null quando nem o total de seguidores nem a visita ao perfil têm dado', () => {
  assert.equal(montarMensagemSeguidores('2026-09-12', 13, null, null, null, null), null);
});

test('⚠️ montarMensagemSeguidores: DUAS PARTES separadas — resultado do período primeiro, totais depois', () => {
  const msg = montarMensagemSeguidores('2026-09-12', 13, 17, 129, 1017, 45);
  assert.equal(
    msg,
    '📊 Seguidores e visitas ao perfil — 13h, 12/09\n\n'
    + 'Novos seguidores no período: +17\n'
    + 'Visitas ao perfil da conta: 129\n'
    + '\n'
    + 'Total do dia: +45\n'
    + 'Total da conta: 1.017',
  );
});

test('montarMensagemSeguidores: com gasto, mostra investimento e os dois custos', () => {
  const msg = montarMensagemSeguidores('2026-09-12', 13, 12, 156, 5012, 30, 37.4);
  assert.match(msg, /Investimento: R\$\s?37,40/);
  assert.match(msg, /Custo por visita ao perfil: R\$\s?0,24/);
  assert.match(msg, /Custo por seguidor: R\$\s?3,12/);
});

test('montarMensagemSeguidores: sem gasto, nenhuma linha de investimento', () => {
  const msg = montarMensagemSeguidores('2026-09-12', 13, 12, 156, 5012, 30, 0);
  assert.doesNotMatch(msg, /Investimento|Custo por/);
});

test('deltaDeSeguidoresPorHora + seguidoresNaHora/seguidoresTotalNaHora/seguidoresNoDia: acham a hora e o dia certos', () => {
  const deltas = deltaDeSeguidoresPorHora([
    { followers_count: 1000, lido_em: '2026-09-12T15:05:00Z' }, // 12h SP
    { followers_count: 1017, lido_em: '2026-09-12T16:05:00Z' }, // 13h SP: +17
  ]);
  assert.equal(seguidoresNaHora(deltas, '2026-09-12', 13), 17);
  assert.equal(seguidoresNaHora(deltas, '2026-09-12', 20), null, 'hora sem leitura nenhuma');
  assert.equal(seguidoresTotalNaHora(deltas, '2026-09-12', 12), 1000, 'primeira leitura: sem delta, mas com total');
  assert.equal(seguidoresTotalNaHora(deltas, '2026-09-12', 13), 1017);
  assert.equal(seguidoresNoDia(deltas, '2026-09-12'), 17, 'a primeira leitura do dia entra como 0 na soma');
});
