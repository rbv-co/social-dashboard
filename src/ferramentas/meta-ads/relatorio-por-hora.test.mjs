import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  custoPorLead, agruparPorDiaEHora, tipoDaCampanha, comResultado, semResultado,
  montarMensagemWpp, leadsWppNoDia, gastoWppNoDia, montarMensagemSeguidores, deltaDeSeguidoresPorHora, seguidoresNaHora,
  seguidoresTotalNaHora, seguidoresNoDia, visitasPerfilNaHora, gastoSeguidoresNoDia, visitasPerfilNoDia,
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

test('⚠️ montarMensagemWpp: lista as campanhas, depois Leads no período / Gasto / Custo por lead, com RÓTULO na frente de cada valor', () => {
  // Pedido de um colega no grupo, repassado pelo dono (12/09/2026): "mesmo
  // esquema" da Mensagem Seguidores — número nunca solto, sempre com rótulo.
  const campanhas = [
    { campaignId: 'c1', nome: '[CAMPANHA WPP] Criativo 1', tipo: 'wpp', gastoHora: 100, gastoAcumulado: 400, conversasHora: 4 },
    { campaignId: 'c2', nome: '[CAMPANHA WPP] Criativo 2', tipo: 'wpp', gastoHora: 50, gastoAcumulado: 120, conversasHora: 1 },
    { campaignId: 'c3', nome: 'Post do Instagram', tipo: 'outro', gastoHora: 999, gastoAcumulado: 999, conversasHora: 999 },
  ];
  const msg = montarMensagemWpp('2026-09-11', 23, campanhas);
  assert.match(msg, /^📊 Leads recebidos — 23h, 11\/09/);
  assert.match(msg, /\[CAMPANHA WPP\] Criativo 1 — 4 leads · Gasto no período: R\$\s?100,00 · Gasto total: R\$\s?400,00/);
  assert.match(msg, /\[CAMPANHA WPP\] Criativo 2 — 1 lead · Gasto no período: R\$\s?50,00 · Gasto total: R\$\s?120,00/);
  assert.doesNotMatch(msg, /Post do Instagram/, 'campanha fora do WPP vazou pra mensagem');
  // "Gasto total das campanhas" logo abaixo da lista (400+120, NÃO soma a
  // c3 que é 'outro') — antes do bloco "Leads no período".
  assert.match(msg, /Gasto total: R\$\s?120,00\nGasto total das campanhas: R\$\s?520,00\n\nLeads no período: 5\nGasto: R\$\s?150,00\nCusto por lead: R\$\s?30,00$/);
});

test('montarMensagemWpp: total zero não inventa custo por lead na mensagem', () => {
  const campanhas = [{ campaignId: 'c1', nome: '[CAMPANHA WPP] X', tipo: 'wpp', gastoHora: 40, gastoAcumulado: 90, conversasHora: 0 }];
  const msg = montarMensagemWpp('2026-09-11', 23, campanhas);
  assert.match(msg, /X — 0 leads · Gasto no período: R\$\s?40,00 · Gasto total: R\$\s?90,00/);
  assert.match(msg, /Gasto total das campanhas: R\$\s?90,00/, 'com uma campanha só, o total das campanhas é o dela mesma');
  assert.match(msg, /Leads no período: 0\nGasto: R\$\s?40,00$/);
  assert.doesNotMatch(msg, /Custo por lead/);
});

test('⚠️ montarMensagemWpp: com leadsHoje e gastoHoje, mostra as duas linhas do dia ao final, separadas por linha em branco', () => {
  const campanhas = [{ campaignId: 'c1', nome: '[CAMPANHA WPP] X', tipo: 'wpp', gastoHora: 40, conversasHora: 2 }];
  const msg = montarMensagemWpp('2026-09-11', 23, campanhas, 9, 210.5);
  assert.match(msg, /Custo por lead: R\$\s?20,00\n\nTotal de leads no dia: 9\nTotal de gasto no dia: R\$\s?210,50$/);
});

test('montarMensagemWpp: sem leadsHoje/gastoHoje (null/undefined), não mostra as linhas do dia', () => {
  const campanhas = [{ campaignId: 'c1', nome: '[CAMPANHA WPP] X', tipo: 'wpp', gastoHora: 40, conversasHora: 2 }];
  assert.doesNotMatch(montarMensagemWpp('2026-09-11', 23, campanhas), /Total de leads no dia|Total de gasto no dia/);
  assert.doesNotMatch(montarMensagemWpp('2026-09-11', 23, campanhas, null, null), /Total de leads no dia|Total de gasto no dia/);
});

test('montarMensagemWpp: só um dos dois totais do dia (o outro ainda indisponível)', () => {
  const campanhas = [{ campaignId: 'c1', nome: '[CAMPANHA WPP] X', tipo: 'wpp', gastoHora: 40, conversasHora: 2 }];
  const msg = montarMensagemWpp('2026-09-11', 23, campanhas, 9, null);
  assert.match(msg, /Total de leads no dia: 9$/);
  assert.doesNotMatch(msg, /Total de gasto no dia/);
});

test('leadsWppNoDia/gastoWppNoDia: somam só WPP, em todas as horas do dia', () => {
  const horas = [
    { campanhas: [
      { tipo: 'wpp', conversasHora: 2, gastoHora: 10 },
      { tipo: 'outro', conversasHora: 999, gastoHora: 999 },
    ] },
    { campanhas: [
      { tipo: 'wpp', conversasHora: 3, gastoHora: 15.5 },
      { tipo: 'seguidores', conversasHora: 0, gastoHora: 5 },
    ] },
  ];
  assert.equal(leadsWppNoDia(horas), 5);
  assert.equal(gastoWppNoDia(horas), 25.5);
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

test('⚠️ montarMensagemSeguidores: cabeçalhos INTERVALO/TOTAL, e as linhas do dia renomeadas + os três campos novos', () => {
  // "MELHORIA" (pedido do dono, 12/09/2026): renomeia "Total do dia"/"Total
  // da conta" (agora tem mais de um "total do dia" na mensagem) e acrescenta
  // Custo de seguidores dia / Total visitantes dia / Custo visitantes dia,
  // cada bloco com um cabeçalho ("INTERVALO"/"TOTAL").
  const msg = montarMensagemSeguidores('2026-09-12', 13, 17, 553, 5234, 45, 37.4, 145.9, 620);
  assert.match(
    msg,
    new RegExp(
      '^📊 Seguidores e visitas ao perfil — 13h, 12/09\\n\\n'
      + 'INTERVALO\\n'
      + 'Novos seguidores no período: \\+17\\n'
      + 'Visitas ao perfil da conta: 553\\n'
      + 'Investimento: R\\$\\s?37,40\\n'
      + 'Custo por visita ao perfil: R\\$\\s?0,07\\n'
      + 'Custo por seguidor: R\\$\\s?2,20\\n'
      + '\\n'
      + 'TOTAL\\n'
      + 'Total seguidores do dia: \\+45\\n'
      + 'Custo de seguidores dia: R\\$\\s?3,24\\n'
      + 'Total seguidores da conta: 5\\.234\\n'
      + 'Total visitantes dia: 620\\n'
      + 'Custo visitantes dia: R\\$\\s?0,24$',
    ),
  );
});

test('montarMensagemSeguidores: delta negativo (período e dia) aparece sem sinal de mais', () => {
  const msg = montarMensagemSeguidores('2026-09-12', 13, -3, null, 5000, -8);
  assert.match(msg, /Novos seguidores no período: -3/);
  assert.match(msg, /Total seguidores do dia: -8/);
});

test('montarMensagemSeguidores: visita ao perfil nunca leva sinal de mais (é atividade, não estoque)', () => {
  const msg = montarMensagemSeguidores('2026-09-12', 13, null, 8, null, null);
  assert.match(msg, /Visitas ao perfil da conta: 8/);
  assert.doesNotMatch(msg, /TOTAL|Total seguidores da conta/);
});

test('⚠️ montarMensagemSeguidores: primeira leitura da série — só total da conta, sem período nem dia', () => {
  const msg = montarMensagemSeguidores('2026-09-12', 13, null, null, 5000, null);
  assert.equal(msg, '📊 Seguidores e visitas ao perfil — 13h, 12/09\n\nTOTAL\nTotal seguidores da conta: 5.000');
});

test('montarMensagemSeguidores: seguidor sem visita ao perfil — só a parte de período fica sem a linha de visita', () => {
  const msg = montarMensagemSeguidores('2026-09-12', 13, 12, null, 5012, 30);
  assert.equal(
    msg,
    '📊 Seguidores e visitas ao perfil — 13h, 12/09\n\n'
    + 'INTERVALO\n'
    + 'Novos seguidores no período: +12\n'
    + '\n'
    + 'TOTAL\n'
    + 'Total seguidores do dia: +30\n'
    + 'Total seguidores da conta: 5.012',
  );
});

test('⚠️ montarMensagemSeguidores: com gasto do período, mostra investimento e os dois custos, na ordem certa', () => {
  const msg = montarMensagemSeguidores('2026-09-12', 13, 12, 156, 5012, 30, 37.4);
  assert.match(msg, /Novos seguidores no período: \+12\nVisitas ao perfil da conta: 156\nInvestimento: R\$\s?37,40\nCusto por visita ao perfil: R\$\s?0,24\nCusto por seguidor: R\$\s?3,12\n\nTOTAL/);
});

test('montarMensagemSeguidores: sem gasto do período (0 ou ausente), nenhuma linha de investimento do período', () => {
  const msg = montarMensagemSeguidores('2026-09-12', 13, 12, 156, 5012, 30, 0);
  assert.doesNotMatch(msg, /Investimento/);
  assert.doesNotMatch(msg, /Custo por visita ao perfil|Custo por seguidor:/);
});

test('⚠️ montarMensagemSeguidores: custo por seguidor (período) é null quando o delta é negativo ou zero', () => {
  const semSeguidorNovo = montarMensagemSeguidores('2026-09-12', 13, 0, 156, 5012, 30, 37.4);
  assert.doesNotMatch(semSeguidorNovo, /Custo por seguidor:/);
  assert.match(semSeguidorNovo, /Custo por visita ao perfil/, 'esse continua saindo, o gasto/visita não depende do delta de seguidor');

  const perdeuSeguidor = montarMensagemSeguidores('2026-09-12', 13, -2, 156, 5012, 30, 37.4);
  assert.doesNotMatch(perdeuSeguidor, /Custo por seguidor:/, 'delta negativo daria um "custo" sem sentido');
});

test('montarMensagemSeguidores: custo por visita (período) é null sem leitura de visita, mesmo com gasto', () => {
  const msg = montarMensagemSeguidores('2026-09-12', 13, 12, null, 5012, 30, 37.4);
  assert.match(msg, /Investimento: R\$\s?37,40/);
  assert.doesNotMatch(msg, /Custo por visita/);
});

test('⚠️ montarMensagemSeguidores: custo de seguidores/visitantes do DIA seguem a mesma regra do período (nunca dividir por <= 0)', () => {
  // Sem gasto do dia: nenhuma das duas linhas de custo do dia aparece, mas
  // os totais (que não dependem de gasto) continuam.
  const semGastoDia = montarMensagemSeguidores('2026-09-12', 13, 12, 156, 5012, 30, 37.4, 0, 620);
  assert.doesNotMatch(semGastoDia, /Custo de seguidores dia|Custo visitantes dia/);
  assert.match(semGastoDia, /Total seguidores do dia: \+30\nTotal seguidores da conta: 5\.012\nTotal visitantes dia: 620/);

  // Seguidores do dia <= 0: custo de seguidores do dia some, custo de
  // visitantes do dia continua (não depende do mesmo denominador).
  const seguidoresDiaZero = montarMensagemSeguidores('2026-09-12', 13, 12, 156, 5012, 0, 37.4, 145.9, 620);
  assert.doesNotMatch(seguidoresDiaZero, /Custo de seguidores dia/);
  assert.match(seguidoresDiaZero, /Custo visitantes dia/);
});

test('gastoSeguidoresNoDia: soma só o gasto das campanhas [+ SEGUIDORES], em todas as horas do dia', () => {
  const horas = [
    { campanhas: [{ tipo: 'seguidores', gastoHora: 10 }, { tipo: 'wpp', gastoHora: 999 }] },
    { campanhas: [{ tipo: 'seguidores', gastoHora: 5.4 }] },
  ];
  assert.equal(gastoSeguidoresNoDia(horas), 15.4);
});

test('visitasPerfilNoDia: soma as visitas de todas as horas do dia certo', () => {
  const linhas = [
    { dia: '2026-09-12', hora: 10, visitas_hora: 100 },
    { dia: '2026-09-12', hora: 11, visitas_hora: 128 },
    { dia: '2026-09-13', hora: 0, visitas_hora: 999 },
  ];
  assert.equal(visitasPerfilNoDia(linhas, '2026-09-12'), 228);
  assert.equal(visitasPerfilNoDia(linhas, '2026-09-14'), 0, 'dia sem nenhuma leitura soma 0, não é null (é soma, não delta)');
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
