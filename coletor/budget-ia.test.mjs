import test from 'node:test';
import assert from 'node:assert/strict';
import { campanhaEmVeiculacao, montarMensagens, parsearSaida, diaDaSemanaBR, decidirEscopo, veiculouNaJanela, selecionarCampanhas } from './budget-ia.mjs';
import { normalizarRegua } from '../src/ferramentas/gestao-trafego/regua.js';

const AGORA = Date.parse('2026-07-02T12:00:00Z');

// Dias de referência (2026-07-13 é uma segunda-feira):
const SEGUNDA = Date.parse('2026-07-13T09:41:00Z');   // 06:41 BRT de segunda
const TERCA = Date.parse('2026-07-14T09:41:00Z');     // 06:41 BRT de terça
// Armadilha do fuso: 02:00 UTC de segunda ainda é DOMINGO 23:00 em Brasília.
const DOMINGO_A_NOITE_BRT = Date.parse('2026-07-13T02:00:00Z');
// Espelho da armadilha: 01:00 UTC de terça ainda é SEGUNDA 22:00 em Brasília.
const SEGUNDA_A_NOITE_BRT = Date.parse('2026-07-14T01:00:00Z');

test('diaDaSemanaBR: usa o fuso de Brasília, não o UTC do runner', () => {
  assert.equal(diaDaSemanaBR(SEGUNDA), 1);
  assert.equal(diaDaSemanaBR(TERCA), 2);
  assert.equal(diaDaSemanaBR(DOMINGO_A_NOITE_BRT), 0); // em UTC seria segunda (1)
  assert.equal(diaDaSemanaBR(SEGUNDA_A_NOITE_BRT), 1); // em UTC seria terça (2)
});

test('decidirEscopo: segunda → modo amplo', () => {
  assert.equal(decidirEscopo(SEGUNDA).modo, 'amplo');
});
test('decidirEscopo: terça → só ativas', () => {
  assert.equal(decidirEscopo(TERCA).modo, 'ativas');
});
test('decidirEscopo: domingo 23h BRT (segunda em UTC) → só ativas', () => {
  assert.equal(decidirEscopo(DOMINGO_A_NOITE_BRT).modo, 'ativas');
});
test('decidirEscopo: override respeitado (força amplo numa terça)', () => {
  const e = decidirEscopo(TERCA, 'amplo');
  assert.equal(e.modo, 'amplo');
  assert.match(e.motivo, /BUDGET_ESCOPO/);
});
test('decidirEscopo: override respeitado (força ativas numa segunda)', () => {
  assert.equal(decidirEscopo(SEGUNDA, 'ativas').modo, 'ativas');
});
test('decidirEscopo: override aceita espaço/maiúscula', () => {
  assert.equal(decidirEscopo(TERCA, '  AMPLO ').modo, 'amplo');
});
test('decidirEscopo: override inválido é ignorado (vale o calendário)', () => {
  assert.equal(decidirEscopo(TERCA, 'tudo').modo, 'ativas');
  assert.equal(decidirEscopo(SEGUNDA, 'tudo').modo, 'amplo');
  assert.equal(decidirEscopo(TERCA, '').modo, 'ativas');
  assert.equal(decidirEscopo(TERCA, undefined).modo, 'ativas');
});
// 'auto' é o default do input do workflow: não força nada, vale o dia da semana.
test('decidirEscopo: "auto" (default do workflow) deixa o calendário decidir', () => {
  assert.equal(decidirEscopo(TERCA, 'auto').modo, 'ativas');
  assert.equal(decidirEscopo(SEGUNDA, 'auto').modo, 'amplo');
});

test('veiculouNaJanela: gasto ou impressões > 0 = veiculou', () => {
  assert.equal(veiculouNaJanela({ spend: '12.30', impressions: '0' }), true);
  assert.equal(veiculouNaJanela({ spend: '0', impressions: '450' }), true);
  assert.equal(veiculouNaJanela({ spend: '0', impressions: '0' }), false);
  assert.equal(veiculouNaJanela({}), false);
  assert.equal(veiculouNaJanela(undefined), false);
});

// Cenário compartilhado: 1 ativa, 1 pausada que gastou na janela, 1 pausada parada.
const CAMPS = [
  { id: 'c_ativa', effective_status: 'ACTIVE' },
  { id: 'c_pausada_gastou', effective_status: 'PAUSED' },
  { id: 'c_pausada_parada', effective_status: 'PAUSED' },
  { id: 'c_encerrada_gastou', effective_status: 'ACTIVE', stop_time: '2026-07-10T00:00:00+0000' },
];
const INS = {
  c_ativa: { spend: '300', impressions: '9000' },
  c_pausada_gastou: { spend: '80', impressions: '2000' },
  c_pausada_parada: { spend: '0', impressions: '0' },
  c_encerrada_gastou: { spend: '55', impressions: '1200' },
};

test('selecionarCampanhas: modo ativas pega só quem veicula agora', () => {
  const r = selecionarCampanhas(CAMPS, INS, 'ativas', SEGUNDA).map((c) => c.id);
  assert.deepEqual(r, ['c_ativa']);
});
test('selecionarCampanhas: modo amplo inclui pausada/encerrada que veiculou na janela', () => {
  const r = selecionarCampanhas(CAMPS, INS, 'amplo', SEGUNDA).map((c) => c.id);
  assert.deepEqual(r, ['c_ativa', 'c_pausada_gastou', 'c_encerrada_gastou']);
});
test('selecionarCampanhas: modo amplo é superconjunto do modo ativas', () => {
  const ativas = selecionarCampanhas(CAMPS, INS, 'ativas', SEGUNDA).map((c) => c.id);
  const amplo = selecionarCampanhas(CAMPS, INS, 'amplo', SEGUNDA).map((c) => c.id);
  ativas.forEach((id) => assert.ok(amplo.includes(id), id + ' sumiu no modo amplo'));
});
test('selecionarCampanhas: ativa sem insight nenhum continua entrando (campanha que acabou de subir)', () => {
  const r = selecionarCampanhas([{ id: 'nova', effective_status: 'ACTIVE' }], {}, 'ativas', SEGUNDA);
  assert.equal(r.length, 1);
});
test('selecionarCampanhas: entrada vazia/inválida não quebra', () => {
  assert.deepEqual(selecionarCampanhas([], {}, 'amplo', SEGUNDA), []);
  assert.deepEqual(selecionarCampanhas(undefined, undefined, 'amplo', SEGUNDA), []);
});

test('campanhaEmVeiculacao: ACTIVE sem stop_time = veiculando', () => {
  assert.equal(campanhaEmVeiculacao({ effective_status: 'ACTIVE' }, AGORA), true);
});
test('campanhaEmVeiculacao: ACTIVE com stop_time futuro = veiculando', () => {
  assert.equal(campanhaEmVeiculacao({ effective_status: 'ACTIVE', stop_time: '2026-08-01T00:00:00+0000' }, AGORA), true);
});
test('campanhaEmVeiculacao: ACTIVE com stop_time passado = encerrada', () => {
  assert.equal(campanhaEmVeiculacao({ effective_status: 'ACTIVE', stop_time: '2026-06-01T00:00:00+0000' }, AGORA), false);
});
test('campanhaEmVeiculacao: PAUSED = fora', () => {
  assert.equal(campanhaEmVeiculacao({ effective_status: 'PAUSED' }, AGORA), false);
});

test('montarMensagens: inclui objetivo, budget e os anúncios no texto do usuário', () => {
  const { system, user } = montarMensagens(
    { name: 'C1', objective: 'OUTCOME_SALES', daily_budget: '5000' },
    { spend: '120', ctr: '1.5', purchase_roas: [{ value: '3.2' }] },
    [{ ad_id: 'ad_9', ad_name: 'Criativo A', ctr: '0.15', spend: '80' }]
  );
  assert.match(system, /JSON/);
  assert.match(system, /anuncios/);
  assert.match(system, /escalar/);
  assert.match(user, /OUTCOME_SALES/);
  assert.match(user, /5000/);
  assert.match(user, /ad_9/);
});

test('parsearSaida: JSON puro válido', () => {
  const o = parsearSaida('{"budget_sugerido_centavos":6000,"veredito":"escalar","justificativa":"ROAS bom","impacto_estimado":"+20% compras"}');
  assert.equal(o.budget_sugerido_centavos, 6000);
  assert.equal(o.veredito, 'escalar');
});
test('parsearSaida: JSON embutido em prosa', () => {
  const o = parsearSaida('Claro! Aqui vai:\n{"budget_sugerido_centavos":3000,"veredito":"reduzir","justificativa":"CPC alto","impacto_estimado":"gasto -25%"}\nEspero ter ajudado.');
  assert.equal(o.veredito, 'reduzir');
});
test('parsearSaida: veredito inválido = null', () => {
  assert.equal(parsearSaida('{"budget_sugerido_centavos":100,"veredito":"turbinar","justificativa":"x","impacto_estimado":"y"}'), null);
});
test('parsearSaida: campo faltando = null', () => {
  assert.equal(parsearSaida('{"veredito":"manter","justificativa":"x","impacto_estimado":"y"}'), null);
});
test('parsearSaida: lixo = null', () => {
  assert.equal(parsearSaida('sem json aqui'), null);
});
test('parsearSaida: anuncios válidos entram; inválidos são filtrados', () => {
  const o = parsearSaida('{"budget_sugerido_centavos":6000,"veredito":"manter","justificativa":"ok","impacto_estimado":"estável","anuncios":[{"ad_id":"ad_1","veredito":"pausar","justificativa":"CTR baixo"},{"ad_id":"ad_2","veredito":"turbinar","justificativa":"x"},{"veredito":"manter","justificativa":"sem id"}]}');
  assert.equal(o.anuncios.length, 1);
  assert.equal(o.anuncios[0].ad_id, 'ad_1');
  assert.equal(o.anuncios[0].veredito, 'pausar');
});
test('parsearSaida: sem anuncios = array vazio', () => {
  const o = parsearSaida('{"budget_sugerido_centavos":6000,"veredito":"escalar","justificativa":"ROAS bom","impacto_estimado":"+20% compras"}');
  assert.deepEqual(o.anuncios, []);
});

// ---------------------------------------------------------------------------
// O `user` e "prosa + JSON + prosa": nao da pra JSON.parse do primeiro '{' ate
// o fim. Pega da primeira chave ate a ultima.
const dadosDoPrompt = (user) => JSON.parse(user.slice(user.indexOf('{'), user.lastIndexOf('}') + 1));

// ORCAMENTO REAL NO PROMPT (2026-07-29). O robo lia so `camp.daily_budget`; em
// campanha ABO isso e nulo, entao o modelo recebia "sem orcamento" e calculava
// a sugestao em cima do zero. Casos abaixo sao as campanhas reais que erraram.
// ---------------------------------------------------------------------------

test('ABO: o prompt leva o orcamento dos CONJUNTOS, nao zero', () => {
  // "[ENGAJAMENTO] FEED | P1" da Vessel: R$ 90/dia em 3 conjuntos, campanha sem
  // orcamento proprio. O robo sugeriu R$ 70 chamando de "escalar".
  const { user } = montarMensagens(
    { name: 'FEED P1', objective: 'OUTCOME_ENGAGEMENT' },
    { spend: '400' },
    [],
    [
      { daily_budget: '3000', effective_status: 'ACTIVE' },
      { daily_budget: '3000', effective_status: 'ACTIVE' },
      { daily_budget: '3000', effective_status: 'ACTIVE' },
    ]
  );
  const dados = dadosDoPrompt(user);
  assert.equal(dados.orcamento.reais, 90, 'R$ 90, nao null nem 0');
  assert.equal(dados.orcamento.onde, 'ABO');
  assert.equal(dados.orcamento.conjuntos_somados, 3);
});

test('ABO: conjunto pausado nao entra, mas o configurado vai junto', () => {
  // "MODA & BOLSAS": R$ 290 configurados, R$ 230 no ar.
  const { user } = montarMensagens(
    { name: 'MODA & BOLSAS', objective: 'OUTCOME_TRAFFIC' }, {}, [],
    [
      { daily_budget: '20000', effective_status: 'ACTIVE' },
      { daily_budget: '3000', effective_status: 'ACTIVE' },
      { daily_budget: '6000', effective_status: 'PAUSED' },
    ]
  );
  const dados = dadosDoPrompt(user);
  assert.equal(dados.orcamento.reais, 230);
  assert.equal(dados.orcamento.configurado_centavos, 29000);
  assert.equal(dados.orcamento.conjuntos_pausados_ignorados, 1);
});

test('CBO segue funcionando: o orcamento e o da campanha', () => {
  const { user } = montarMensagens({ name: 'C', objective: 'OUTCOME_SALES', daily_budget: '5000' }, {}, [], []);
  const dados = dadosDoPrompt(user);
  assert.equal(dados.orcamento.reais, 50);
  assert.equal(dados.orcamento.onde, 'CBO');
});

test('sem conjuntos e sem orcamento na campanha: null, e o prompt manda MANTER', () => {
  // null nao e zero. O modelo precisa saber que NAO SABE, senao sugere em cima do vazio.
  const { system, user } = montarMensagens({ name: 'C', objective: 'OUTCOME_TRAFFIC' }, {}, [], []);
  const dados = dadosDoPrompt(user);
  assert.equal(dados.orcamento.reais, null);
  assert.match(system, /nulo você NÃO sabe o gasto atual/, 'a instrucao de calar precisa estar no prompt');
});

test('o prompt PROIBE chamar de escalar um numero menor que o atual', () => {
  // A regra que faltava: R$ 230 -> R$ 200 saia rotulado "escalar".
  const { system } = montarMensagens({ name: 'C', objective: 'OUTCOME_TRAFFIC' }, {}, [], []);
  assert.match(system, /MENOR que ele/);
  assert.match(system, /"reduzir", nunca "escalar"/);
});

test('montarMensagens sem o 4o argumento nao quebra (compatibilidade)', () => {
  const { user } = montarMensagens({ name: 'C', objective: 'X', daily_budget: '1000' }, {}, []);
  assert.match(user, /orcamento/);
});

test('o prompt PROIBE falar "do dono": quem le e a propria pessoa', () => {
  // A justificativa aparece na tela pra quem definiu a meta. "A meta do dono"
  // faz o texto falar dela em terceira pessoa (correcao pedida em 2026-07-29).
  const { system } = montarMensagens({ name: 'C', objective: 'OUTCOME_TRAFFIC' }, {}, [], []);
  assert.match(system, /NUNCA "a meta do dono"/);
  assert.ok(!/compare com a meta DELE/.test(system), 'a propria instrucao nao pode usar a forma que proibe');
});

// ---------------------------------------------------------------------------
// A CEGUEIRA (24/09/2026): o robô mandava ao Opus a META da conta e o custo
// atual NULO em toda campanha que não fosse de engajamento, enquanto o system
// prompt ordenava "cite esse número em reais e contra a meta".
// A chave é `metas` — metaDoBalde lê `regua.metas[balde]` (regua.js:109).
// `metas_resultado` NÃO existe: devolveria 0 e o índice viria null.
// (Reusa o `dadosDoPrompt(user)` já definido acima — dois helpers com o mesmo
// nome e assinaturas diferentes quebrariam o arquivo.)
// ---------------------------------------------------------------------------
const REGUA_TESTE = normalizarRegua({
  metas: { leads: 15, vendas: 80, trafego: 1.5, mensagens: 10, reconhecimento: 25 },
});

const INS_LEAD = {
  spend: '1000', impressions: '50000', clicks: '800', ctr: '1.6', cpc: '1.25',
  reach: '25000', frequency: '2',
  actions: [{ action_type: 'lead', value: '40' }],
};

test('campanha de LEAD leva o custo atual, não só a meta', () => {
  const camp = { id: '1', name: 'Captação', objective: 'OUTCOME_LEADS' };
  const { user } = montarMensagens(camp, INS_LEAD, [], [], REGUA_TESTE);
  const d = dadosDoPrompt(user);
  assert.equal(d.regua.custo_atual_reais, 25, 'custo por lead = 1000 / 40');
  assert.ok(d.regua.meta_reais > 0, 'a meta precisa continuar indo junto');
  assert.ok(Math.abs(d.regua.indice_contra_meta - 25 / 15) < 0.001,
    'índice = custo ÷ meta; 1,0 é exatamente na meta');
});

test('campanha de VENDAS também leva o custo atual', () => {
  const camp = { id: '2', name: 'Vendas', objective: 'OUTCOME_SALES' };
  const ins = { spend: '1000', actions: [{ action_type: 'purchase', value: '20' }] };
  const { user } = montarMensagens(camp, ins, [], [], REGUA_TESTE);
  const d = dadosDoPrompt(user);
  assert.equal(d.regua.custo_atual_reais, 50, 'CAC = 1000 / 20');
});

test('campanha de engajamento continua medida pelo ponto ponderado', () => {
  const camp = { id: '3', name: 'Engaja', objective: 'OUTCOME_ENGAGEMENT' };
  const ins = { spend: '100', actions: [{ action_type: 'post_engagement', value: '500' }] };
  const { user } = montarMensagens(camp, ins, [], [], REGUA_TESTE);
  const d = dadosDoPrompt(user);
  assert.equal(d.regua.tipo_de_campanha, 'engajamento');
  assert.equal(d.regua.rotulo, 'Custo por ponto');
});

test('campanha sem resultado na janela manda null, nunca zero', () => {
  const camp = { id: '4', name: 'Parada', objective: 'OUTCOME_LEADS' };
  const { user } = montarMensagens(camp, { spend: '800', actions: [] }, [], [], REGUA_TESTE);
  const d = dadosDoPrompt(user);
  assert.equal(d.regua.custo_atual_reais, null);
  assert.equal(d.regua.indice_contra_meta, null);
});
