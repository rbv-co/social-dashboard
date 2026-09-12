import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  custoPorLead, agruparPorDiaEHora, tipoDaCampanha, comResultado, semResultado,
  montarMensagemWpp, montarMensagemSeguidores, deltaDeSeguidoresPorHora, seguidoresNaHora, seguidoresTotalNaHora,
  seguidoresNoDia, visitasPerfilNaHora,
} from './relatorio-por-hora.js';

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

test('agruparPorDiaEHora: NÃO filtra — todas as campanhas ficam na lista, quem recorta é a tela', () => {
  const linhas = [
    { dia: '2026-09-11', hora: 8, campaign_id: 'converteu', gasto_hora: 10, conversas_hora: 1 },
    { dia: '2026-09-11', hora: 8, campaign_id: 'nao-converteu', gasto_hora: 90, conversas_hora: 0 },
  ];
  const out = agruparPorDiaEHora(linhas);
  const h = out[0].horas[0];
  assert.deepEqual(h.campanhas.map((c) => c.campaignId).sort(), ['converteu', 'nao-converteu']);
  assert.equal(h.gastoTotal, 100);
});

test('comResultado/semResultado recortam a mesma lista sem se sobrepor', () => {
  const linhas = [
    { dia: '2026-09-11', hora: 8, campaign_id: 'converteu', gasto_hora: 10, conversas_hora: 1 },
    { dia: '2026-09-11', hora: 8, campaign_id: 'nao-converteu', gasto_hora: 90, conversas_hora: 0 },
  ];
  const campanhas = agruparPorDiaEHora(linhas)[0].horas[0].campanhas;
  assert.deepEqual(comResultado(campanhas).map((c) => c.campaignId), ['converteu']);
  assert.deepEqual(semResultado(campanhas).map((c) => c.campaignId), ['nao-converteu']);
});

test('comResultado/semResultado NUNCA devolvem campanha de seguidores — ela tem seção própria', () => {
  const linhas = [
    { dia: '2026-09-11', hora: 8, campaign_id: 'c1', gasto_hora: 10, conversas_hora: 1 },
  ];
  const campanhas = agruparPorDiaEHora(linhas, { c1: '[+ SEGUIDORES] Reels 1' })[0].horas[0].campanhas;
  assert.deepEqual(comResultado(campanhas), []);
  assert.deepEqual(semResultado(campanhas), []);
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

test('tipoDaCampanha: reconhece os dois prefixos e cai em "outro" pro resto', () => {
  assert.equal(tipoDaCampanha('[CAMPANHA WPP] Criativo 1'), 'wpp');
  assert.equal(tipoDaCampanha('[+ SEGUIDORES] Reels 1'), 'seguidores');
  assert.equal(tipoDaCampanha('Post do Instagram: Vlog'), 'outro');
  assert.equal(tipoDaCampanha('120250373182240342'), 'outro'); // id cru, sem nome mapeado
});

test('montarMensagemWpp: null quando não há campanha WPP nessa hora', () => {
  const campanhas = [{ campaignId: 'c1', nome: 'Post do Instagram', tipo: 'outro', gastoHora: 10, conversasHora: 1 }];
  assert.equal(montarMensagemWpp('2026-09-11', 23, campanhas), null);
});

test('montarMensagemWpp: lista as campanhas WPP e termina com o consolidado', () => {
  const campanhas = [
    { campaignId: 'c1', nome: '[CAMPANHA WPP] Criativo 1', tipo: 'wpp', gastoHora: 100, conversasHora: 4 },
    { campaignId: 'c2', nome: '[CAMPANHA WPP] Criativo 2', tipo: 'wpp', gastoHora: 50, conversasHora: 1 },
    { campaignId: 'c3', nome: 'Post do Instagram', tipo: 'outro', gastoHora: 999, conversasHora: 999 },
  ];
  const msg = montarMensagemWpp('2026-09-11', 23, campanhas);
  assert.match(msg, /^📊 Leads recebidos — 23h, 11\/09/);
  assert.match(msg, /\[CAMPANHA WPP\] Criativo 1 — 4 leads · R\$\s?100,00/);
  assert.match(msg, /\[CAMPANHA WPP\] Criativo 2 — 1 lead · R\$\s?50,00/);
  assert.doesNotMatch(msg, /Post do Instagram/, 'campanha fora do WPP vazou pra mensagem');
  assert.match(msg, /Total: 5 leads · R\$\s?150,00 investidos · R\$\s?30,00\/lead$/);
});

test('montarMensagemWpp: total zero não inventa custo por lead na mensagem', () => {
  const campanhas = [{ campaignId: 'c1', nome: '[CAMPANHA WPP] X', tipo: 'wpp', gastoHora: 40, conversasHora: 0 }];
  const msg = montarMensagemWpp('2026-09-11', 23, campanhas);
  assert.match(msg, /X — 0 leads/);
  assert.match(msg, /Total: 0 leads · R\$\s?40,00 investidos$/);
  assert.doesNotMatch(msg, /\/lead/);
});

test('deltaDeSeguidoresPorHora: primeira leitura da série vem com delta null, nunca 0 — mas COM total', () => {
  const leituras = [{ followers_count: 1000, lido_em: '2026-09-11T13:05:00Z' }];
  const out = deltaDeSeguidoresPorHora(leituras);
  assert.deepEqual(out, [{ dia: '2026-09-11', hora: 10, seguidoresDelta: null, seguidoresTotal: 1000 }]);
});

test('deltaDeSeguidoresPorHora: calcula o delta contra a leitura anterior, ganho e perda', () => {
  const leituras = [
    { followers_count: 1000, lido_em: '2026-09-11T13:05:00Z' }, // 10h SP
    { followers_count: 1005, lido_em: '2026-09-11T14:05:00Z' }, // 11h SP: +5
    { followers_count: 1002, lido_em: '2026-09-11T15:05:00Z' }, // 12h SP: -3
  ];
  const out = deltaDeSeguidoresPorHora(leituras);
  assert.deepEqual(out.map((o) => o.seguidoresDelta), [null, 5, -3]);
  assert.deepEqual(out.map((o) => o.hora), [10, 11, 12]);
});

test('deltaDeSeguidoresPorHora: duas leituras no mesmo bucket de hora — fica só a mais recente', () => {
  const leituras = [
    { followers_count: 1000, lido_em: '2026-09-11T13:05:00Z' }, // 10h SP
    { followers_count: 1003, lido_em: '2026-09-11T13:50:00Z' }, // mesma 10h SP, mais recente
    { followers_count: 1010, lido_em: '2026-09-11T14:05:00Z' }, // 11h SP
  ];
  const out = deltaDeSeguidoresPorHora(leituras);
  assert.equal(out.length, 2, 'as duas leituras da mesma hora viraram um bucket só');
  assert.equal(out[1].seguidoresDelta, 7, 'delta contra 1003 (a mais recente), não contra 1000');
});

test('deltaDeSeguidoresPorHora: atravessa a virada do dia sem resetar (seguidor não é gasto)', () => {
  const leituras = [
    { followers_count: 5000, lido_em: '2026-09-12T02:05:00Z' }, // 23h SP, 11/09
    { followers_count: 5008, lido_em: '2026-09-12T03:05:00Z' }, // 00h SP, 12/09
  ];
  const out = deltaDeSeguidoresPorHora(leituras);
  assert.deepEqual(out.map((o) => ({ dia: o.dia, hora: o.hora })), [
    { dia: '2026-09-11', hora: 23 },
    { dia: '2026-09-12', hora: 0 },
  ]);
  assert.equal(out[1].seguidoresDelta, 8);
});

test('seguidoresNaHora: acha a hora certa, e null quando não tem leitura', () => {
  const deltas = deltaDeSeguidoresPorHora([
    { followers_count: 1000, lido_em: '2026-09-11T13:05:00Z' },
    { followers_count: 1005, lido_em: '2026-09-11T14:05:00Z' },
  ]);
  assert.equal(seguidoresNaHora(deltas, '2026-09-11', 11), 5);
  assert.equal(seguidoresNaHora(deltas, '2026-09-11', 10), null, 'primeira leitura da série: null, não 0');
  assert.equal(seguidoresNaHora(deltas, '2026-09-11', 15), null, 'hora sem leitura nenhuma');
});

test('⚠️ seguidoresTotalNaHora: TEM total mesmo na primeira leitura, que não tem delta', () => {
  const deltas = deltaDeSeguidoresPorHora([
    { followers_count: 1000, lido_em: '2026-09-11T13:05:00Z' },
    { followers_count: 1005, lido_em: '2026-09-11T14:05:00Z' },
  ]);
  assert.equal(seguidoresTotalNaHora(deltas, '2026-09-11', 10), 1000, 'primeira leitura: sem delta, mas com total');
  assert.equal(seguidoresTotalNaHora(deltas, '2026-09-11', 11), 1005);
  assert.equal(seguidoresTotalNaHora(deltas, '2026-09-11', 15), null, 'hora sem leitura nenhuma');
});

test('montarMensagemSeguidores: null quando nem o total de seguidores nem a visita ao perfil têm dado', () => {
  assert.equal(montarMensagemSeguidores('2026-09-12', 0, null, null, null, null), null);
});

test('⚠️ montarMensagemSeguidores: DUAS PARTES separadas — resultado do período primeiro, totais depois', () => {
  const msg = montarMensagemSeguidores('2026-09-12', 13, 17, 553, 5234, 45);
  assert.equal(
    msg,
    '📊 Seguidores e visitas ao perfil — 13h, 12/09\n\n'
    + 'Novos seguidores no período: +17\n'
    + 'Visitas ao perfil da conta: 553\n'
    + '\n'
    + 'Total do dia: +45\n'
    + 'Total da conta: 5.234',
  );
});

test('montarMensagemSeguidores: delta negativo (período e dia) aparece sem sinal de mais', () => {
  const msg = montarMensagemSeguidores('2026-09-12', 13, -3, null, 5000, -8);
  assert.match(msg, /Novos seguidores no período: -3/);
  assert.match(msg, /Total do dia: -8/);
});

test('montarMensagemSeguidores: visita ao perfil nunca leva sinal de mais (é atividade, não estoque)', () => {
  const msg = montarMensagemSeguidores('2026-09-12', 13, null, 8, null, null);
  assert.match(msg, /Visitas ao perfil da conta: 8/);
  assert.doesNotMatch(msg, /Total da conta/);
});

test('⚠️ montarMensagemSeguidores: primeira leitura da série — só total da conta, sem período nem dia', () => {
  const msg = montarMensagemSeguidores('2026-09-12', 13, null, null, 5000, null);
  assert.equal(msg, '📊 Seguidores e visitas ao perfil — 13h, 12/09\n\nTotal da conta: 5.000');
});

test('montarMensagemSeguidores: seguidor sem visita ao perfil — só a parte de período fica sem a linha de visita', () => {
  const msg = montarMensagemSeguidores('2026-09-12', 13, 12, null, 5012, 30);
  assert.equal(
    msg,
    '📊 Seguidores e visitas ao perfil — 13h, 12/09\n\n'
    + 'Novos seguidores no período: +12\n'
    + '\n'
    + 'Total do dia: +30\n'
    + 'Total da conta: 5.012',
  );
});

test('⚠️ montarMensagemSeguidores: com gasto, mostra investimento e os dois custos, na ordem certa', () => {
  const msg = montarMensagemSeguidores('2026-09-12', 13, 12, 156, 5012, 30, 37.4);
  assert.match(msg, /Novos seguidores no período: \+12\nVisitas ao perfil da conta: 156\nInvestimento: R\$\s?37,40\nCusto por visita ao perfil: R\$\s?0,24\nCusto por seguidor: R\$\s?3,12\n\nTotal do dia/);
});

test('montarMensagemSeguidores: sem gasto (0 ou ausente), nenhuma linha de investimento', () => {
  const msg = montarMensagemSeguidores('2026-09-12', 13, 12, 156, 5012, 30, 0);
  assert.doesNotMatch(msg, /Investimento/);
  assert.doesNotMatch(msg, /Custo por/);
});

test('⚠️ montarMensagemSeguidores: custo por seguidor é null quando o delta é negativo ou zero (não divide por baixo de zero)', () => {
  const semSeguidorNovo = montarMensagemSeguidores('2026-09-12', 13, 0, 156, 5012, 30, 37.4);
  assert.doesNotMatch(semSeguidorNovo, /Custo por seguidor/);
  assert.match(semSeguidorNovo, /Custo por visita ao perfil/, 'esse continua saindo, o gasto/visita não depende do delta de seguidor');

  const perdeuSeguidor = montarMensagemSeguidores('2026-09-12', 13, -2, 156, 5012, 30, 37.4);
  assert.doesNotMatch(perdeuSeguidor, /Custo por seguidor/, 'delta negativo daria um "custo" sem sentido');
});

test('montarMensagemSeguidores: custo por visita é null sem leitura de visita, mesmo com gasto', () => {
  const msg = montarMensagemSeguidores('2026-09-12', 13, 12, null, 5012, 30, 37.4);
  assert.match(msg, /Investimento: R\$\s?37,40/);
  assert.doesNotMatch(msg, /Custo por visita/);
});

test('seguidoresNoDia: soma os deltas do dia inteiro, não só a hora', () => {
  const deltas = deltaDeSeguidoresPorHora([
    { followers_count: 1000, lido_em: '2026-09-12T13:05:00Z' }, // 10h SP
    { followers_count: 1005, lido_em: '2026-09-12T14:05:00Z' }, // 11h SP: +5
    { followers_count: 1003, lido_em: '2026-09-12T15:05:00Z' }, // 12h SP: -2
  ]);
  assert.equal(seguidoresNoDia(deltas, '2026-09-12'), 3, '5 - 2, a primeira leitura do dia entra como 0');
  assert.equal(seguidoresNoDia(deltas, '2026-09-13'), null, 'dia sem nenhuma leitura');
});

test('visitasPerfilNaHora: acha a hora certa, e null quando não tem leitura', () => {
  const linhas = [
    { dia: '2026-09-12', hora: 10, visitas_hora: 40 },
    { dia: '2026-09-12', hora: 11, visitas_hora: 12 },
  ];
  assert.equal(visitasPerfilNaHora(linhas, '2026-09-12', 11), 12);
  assert.equal(visitasPerfilNaHora(linhas, '2026-09-12', 15), null, 'hora sem leitura nenhuma');
});
