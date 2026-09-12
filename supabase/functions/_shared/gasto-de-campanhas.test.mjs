import { test } from 'node:test';
import assert from 'node:assert/strict';
import { somarGasto, semRespostaDaMeta, podeBuscarProximaPagina } from './gasto-de-campanhas.js';

// Resposta real de act_X/insights com level=campaign: uma linha por campanha,
// `spend` em TEXTO. Id e valor da campanha 1 são os medidos de verdade na
// Vessel (R$ 461,52) — é o número citado no comentário de gasto-de-campanhas.js;
// id e valor ficam juntos, como em todo outro teste deste branch.
const resposta = { data: [
  { campaign_id: '120249301837840342', spend: '461.52' },
  { campaign_id: '120230000000000001', spend: '2254.02' },
  { campaign_id: '120230000000000002', spend: '168.90' },
] };

test('sem ids, soma tudo', () => {
  assert.equal(somarGasto(resposta, null).toFixed(2), '2884.44');
  assert.equal(somarGasto(resposta, []).toFixed(2), '2884.44');
});

test('com ids, soma só as escolhidas', () => {
  assert.equal(somarGasto(resposta, ['120249301837840342', '120230000000000002']).toFixed(2), '630.42');
});

test('id que não veio na resposta não inventa gasto', () => {
  assert.equal(somarGasto(resposta, ['999']), 0);
});

// Um id REAL de campanha da Meta tem 18 dígitos e não cabe inteiro num Number do
// JS (Number.MAX_SAFE_INTEGER tem 16) — escrevê-lo como literal numérico já perde
// precisão na hora em que o PRÓPRIO ARQUIVO DE TESTE é interpretado, antes de
// qualquer linha do módulo rodar. Por isso este caso usa um id curto e sintético
// só para provar a coerção Number→String; não é dado de produção.
test('id number bate com id text — o PostgREST devolve texto, a Meta também', () => {
  const respostaCurta = { data: [{ campaign_id: '12345', spend: '10.00' }] };
  assert.equal(somarGasto(respostaCurta, [12345]).toFixed(2), '10.00');
});

test('resposta vazia ou quebrada vira zero, nunca erro', () => {
  assert.equal(somarGasto({}, ['1']), 0);
  assert.equal(somarGasto(null, ['1']), 0);
  assert.equal(somarGasto({ data: [] }, null), 0);
  assert.equal(somarGasto({ data: [{ campaign_id: '1', spend: 'xis' }] }, null), 0);
});

// A edge não passa a resposta de uma página só pra somarGasto: quando level=campaign
// tem mais de 500 linhas, ela segue `paging.next` e ACUMULA tudo antes de chamar
// esta função (ver o loop em insights-ao-vivo/index.ts). Este teste simula esse
// acúmulo — duas "páginas" concatenadas num só array `data` — pra provar que a soma
// continua correta com linhas vindas de mais de uma chamada à Meta. O loop de
// paginação em si é Deno/fetch e não roda sob `node --test`; só a soma é coberta
// aqui, a paginação foi conferida por leitura do arquivo.
test('soma correta com linhas acumuladas de mais de uma página', () => {
  const pagina1 = [
    { campaign_id: '1', spend: '100.00' },
    { campaign_id: '2', spend: '50.25' },
  ];
  const pagina2 = [
    { campaign_id: '3', spend: '25.75' },
  ];
  const acumulado = { data: [...pagina1, ...pagina2] };
  assert.equal(somarGasto(acumulado, null).toFixed(2), '176.00');
  assert.equal(somarGasto(acumulado, ['1', '3']).toFixed(2), '125.75');
});

// ── "A META ENGASGOU" × "NÃO HOUVE GASTO" ──
// O desenho promete que, se a Meta falhar, a tela cai no coletado. Ela decide
// isso testando `investimento != null` — então um erro NÃO pode virar zero.
test('erro da Meta não é gasto zero: sem data, não há número a dar', () => {
  assert.equal(semRespostaDaMeta({ error: { message: 'Rate limit', code: 17 } }), true);
  assert.equal(semRespostaDaMeta({}), true, 'resposta sem data nenhuma');
  assert.equal(semRespostaDaMeta(null), true);
  assert.equal(semRespostaDaMeta({ data: null }), true);
});

test('data vazia É resposta: a Meta está dizendo "não gastou nessa janela"', () => {
  assert.equal(semRespostaDaMeta({ data: [] }), false);
  assert.equal(somarGasto({ data: [] }, ['1']), 0);
});

test('erro JUNTO com data ainda é erro — meia resposta não vira número', () => {
  assert.equal(semRespostaDaMeta({ error: { message: 'parcial' }, data: [{ campaign_id: '1', spend: '10' }] }), true);
});

// ── O LAÇO DE PAGINAÇÃO ──
test('página vazia com paging.next NÃO continua: é assim que a Graph faz laço infinito', () => {
  assert.equal(podeBuscarProximaPagina({ data: [], paging: { next: 'https://graph…' } }, 1, 20), false);
});

test('página cheia com paging.next continua, até o teto', () => {
  const cheia = { data: [{ campaign_id: '1', spend: '10' }], paging: { next: 'https://graph…' } };
  assert.equal(podeBuscarProximaPagina(cheia, 1, 20), true);
  assert.equal(podeBuscarProximaPagina(cheia, 19, 20), true);
  assert.equal(podeBuscarProximaPagina(cheia, 20, 20), false, 'teto alcançado');
  assert.equal(podeBuscarProximaPagina(cheia, 21, 20), false);
});

test('sem paging.next, acabou — o caminho normal das 126 campanhas em uma página só', () => {
  assert.equal(podeBuscarProximaPagina({ data: [{ campaign_id: '1', spend: '10' }] }, 1, 20), false);
  assert.equal(podeBuscarProximaPagina({ data: [{}], paging: {} }, 1, 20), false);
  assert.equal(podeBuscarProximaPagina(null, 1, 20), false);
});
