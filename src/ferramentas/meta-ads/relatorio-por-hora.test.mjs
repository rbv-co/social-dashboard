import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  custoPorLead, agruparPorDiaEHora, tipoDaCampanha, comResultado, semResultado, montarMensagemWpp,
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
