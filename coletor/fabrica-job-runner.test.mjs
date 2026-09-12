import { test } from 'node:test';
import assert from 'node:assert/strict';
import { estadoTerminalSubir, statusCampanhaGerar } from './fabrica-job-runner.mjs';

test('subir 100% -> concluido + fecha', () => {
  assert.deepEqual(estadoTerminalSubir({ pendentes: 0, adIds: ['a'] }), { status: 'concluido', fecha: true });
});
test('subir parcial (rate limit) -> erro + não fecha', () => {
  const r = estadoTerminalSubir({ pendentes: 3, adIds: ['a'] });
  assert.equal(r.status, 'erro'); assert.equal(r.fecha, false);
});
test('statusCampanhaGerar: sucesso->pronta, falha->erro', () => {
  assert.equal(statusCampanhaGerar(true), 'pronta');
  assert.equal(statusCampanhaGerar(false), 'erro');
});

// Subida multi-loja parcial (B4): a loja 1 criou campanha DE VERDADE na Meta e a loja 2 falhou.
// Não pode virar 'concluido' (o dono acharia que subiu tudo) nem fechar a rodada — e a mensagem
// tem que dizer QUAL loja ficou de fora, senão ele descobre no Gerenciador.
test('estadoTerminalSubir: alguma loja falhou -> erro nomeando a loja, sem fechar a rodada', () => {
  const r = estadoTerminalSubir({
    pendentes: 0,
    adIds: ['a1'],
    falhas: [{ loja: 'Shopping Dom Pedro', erro: '(#100) Invalid parameter' }],
    campanhas: [{ metaCampaignId: 'c1' }],
  });
  assert.equal(r.status, 'erro');
  assert.equal(r.fecha, false);
  assert.match(r.erro, /Shopping Dom Pedro/);
});

test('estadoTerminalSubir: falhas vazio segue concluído (retrocompat)', () => {
  assert.deepEqual(estadoTerminalSubir({ pendentes: 0, adIds: ['a'], falhas: [] }), { status: 'concluido', fecha: true });
});

// MEDIDO NO BANCO (B4, 12/08/2026): o job 66a8e030 (13/07 22:49) tem destino 'nova' com 1 loja,
// adIds:[], pendentes:0, falhas:null — e ficou `concluido`, sem erro, FECHANDO a rodada. É a
// primeira metade do relato do dono ("na primeira vez bugou e NÃO subiu campanha"): ele não bugou,
// ele publicou com zero criativos escolhidos e a tela deu parabéns.
test('estadoTerminalSubir: zero criativos escolhidos -> erro que manda voltar pro Curar, sem fechar', () => {
  const r = estadoTerminalSubir({ pendentes: 0, adIds: [], falhas: [], semCriativos: true });
  assert.equal(r.status, 'erro');
  assert.equal(r.fecha, false);
  assert.match(r.erro, /Curar/);
});

test('estadoTerminalSubir: semCriativos vence o rate limit (nada escolhido explica melhor)', () => {
  assert.equal(estadoTerminalSubir({ pendentes: 2, semCriativos: true }).fecha, false);
  assert.match(estadoTerminalSubir({ pendentes: 2, semCriativos: true }).erro, /Curar/);
});
