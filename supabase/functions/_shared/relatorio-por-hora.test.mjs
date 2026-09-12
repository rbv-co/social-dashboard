import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  custoPorLead, agruparPorDiaEHora, tipoDaCampanha,
  montarMensagemWpp, montarMensagemSeguidores, deltaDeSeguidoresPorHora, seguidoresNaHora, seguidoresTotalNaHora,
  seguidoresNoDia,
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

test('montarMensagemWpp: lista as campanhas WPP e termina com o consolidado', () => {
  const campanhas = [
    { campaignId: 'c1', nome: '[CAMPANHA WPP] Criativo 1', tipo: 'wpp', gastoHora: 100, conversasHora: 4 },
    { campaignId: 'c2', nome: 'Post do Instagram', tipo: 'outro', gastoHora: 999, conversasHora: 999 },
  ];
  const msg = montarMensagemWpp('2026-09-12', 13, campanhas);
  assert.match(msg, /^📊 Leads recebidos — 13h, 12\/09/);
  assert.match(msg, /\[CAMPANHA WPP\] Criativo 1 — 4 leads · R\$\s?100,00/);
  assert.doesNotMatch(msg, /Post do Instagram/, 'campanha fora do WPP vazou pra mensagem');
  assert.match(msg, /Total: 4 leads · R\$\s?100,00 investidos · R\$\s?25,00\/lead$/);
});

test('montarMensagemSeguidores: null quando nem o total de seguidores nem a visita ao perfil têm dado', () => {
  assert.equal(montarMensagemSeguidores('2026-09-12', 13, null, null, null, null), null);
});

test('montarMensagemSeguidores: período, dia, total de seguidores e visita ao perfil, tudo junto', () => {
  const msg = montarMensagemSeguidores('2026-09-12', 13, 17, 129, 1017, 45);
  assert.equal(
    msg,
    '📊 Seguidores e visitas ao perfil — 13h, 12/09\n\n'
    + 'Novos seguidores no período: +17\n'
    + 'Total do dia: +45\n'
    + 'Total da conta: 1.017\n'
    + 'Visitas ao perfil da conta: 129',
  );
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
