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
function dadosDoPrompt(...args) {
  // Uso antigo: dadosDoPrompt(user) — o `user` já veio de um montarMensagens
  // chamado à parte (alguns testes olham `system` também e não iam ganhar nada
  // repetindo a chamada aqui). Uso novo (Tarefa 5): dadosDoPrompt(camp, ins,
  // ads, conjuntos, regua, extra) — chama montarMensagens por dentro.
  const user = typeof args[0] === 'string' ? args[0] : montarMensagens(...args).user;
  return JSON.parse(user.slice(user.indexOf('{'), user.lastIndexOf('}') + 1));
}

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
//
// A Tarefa 5 (tendência) precisava de um ajudante que chamasse `montarMensagens`
// com os 6 argumentos e já devolvesse o JSON — o plano pedia um `dadosDoPrompt2`
// separado. Em vez de duplicar (dois nomes quase iguais para a mesma ideia),
// `dadosDoPrompt` virou variádico: string = comportamento de sempre (o `user`
// já pronto); qualquer outra coisa = os argumentos de `montarMensagens`, que
// ele chama por dentro. Nenhuma chamada antiga muda.
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

test('campanha de engajamento passa a ser medida por engajamento bruto (rodada de correção 1, 24/09/2026)', () => {
  // ATUALIZADO 24/09/2026: este teste documentava o PONTO PONDERADO como
  // régua de engajamento. A troca de régua (ver alvos.js, ALVOS.engajamento)
  // tirou o robô do ponto e pôs no `post_engagement` bruto que a Meta conta —
  // e `custoAtualDoAlvo` (coletor/budget-ia.mjs) perdeu o ramo que chamava
  // `calcularPonderada`: hoje ele só repassa pra `custoDoAlvo`, igual aos
  // demais baldes. Deixar o ramo e a régua discordando faria o robô julgar
  // engajamento por uma régua e a tela por outra.
  const camp = { id: '3', name: 'Engaja', objective: 'OUTCOME_ENGAGEMENT' };
  // 'post_engagement' é o que a Meta conta como engajamento bruto (sem pesar
  // por tipo de interação, ao contrário da ponderada) — R$ 50 / 200
  // engajamentos = R$ 0,25 por engajamento.
  const ins = { spend: '50', actions: [{ action_type: 'post_engagement', value: '200' }] };
  const { user } = montarMensagens(camp, ins, [], [], REGUA_TESTE);
  const d = dadosDoPrompt(user);
  assert.equal(d.regua.tipo_de_campanha, 'engajamento');
  assert.equal(d.regua.rotulo, 'Custo por engajamento');
  assert.equal(d.regua.custo_atual_reais, 0.25, 'custo por engajamento = 50 / 200 engajamentos');
});

test('campanha sem resultado na janela manda null, nunca zero', () => {
  const camp = { id: '4', name: 'Parada', objective: 'OUTCOME_LEADS' };
  const { user } = montarMensagens(camp, { spend: '800', actions: [] }, [], [], REGUA_TESTE);
  const d = dadosDoPrompt(user);
  assert.equal(d.regua.custo_atual_reais, null);
  assert.equal(d.regua.indice_contra_meta, null);
});

// ---------------------------------------------------------------------------
// A CEGUEIRA DO ANÚNCIO (24/09/2026): o mapa de `dados.anuncios` só levava
// gasto, CTR, CPC, impressões, alcance e frequência — nunca o RESULTADO. O
// Opus decidia pausar criativo de campanha de conversão olhando só CTR.
// (Reusa `montarMensagens` + `dadosDoPrompt(user)`, `INS_LEAD` e `REGUA_TESTE`
// já definidos acima — nada de segunda versão desses três.)
// ---------------------------------------------------------------------------

test('cada anúncio leva o resultado dele, não só CTR', () => {
  const camp = { id: '5', name: 'Captação', objective: 'OUTCOME_LEADS' };
  const ads = [{
    ad_id: 'a1', ad_name: 'Criativo A', spend: '200', ctr: '2', cpc: '1',
    impressions: '10000', reach: '8000', frequency: '1.25',
    actions: [{ action_type: 'lead', value: '10' }],
  }, {
    ad_id: 'a2', ad_name: 'Criativo B', spend: '300', ctr: '2.4', cpc: '1',
    impressions: '12000', reach: '9000', frequency: '1.33',
    actions: [],
  }];
  const { user } = montarMensagens(camp, INS_LEAD, ads, [], REGUA_TESTE);
  const d = dadosDoPrompt(user);
  assert.equal(d.anuncios[0].resultado, 10);
  assert.equal(d.anuncios[0].custo_por_resultado, 20, '200 / 10 leads');
  assert.equal(d.anuncios[1].resultado, null, 'sem lead na janela: null, não zero');
  assert.equal(d.anuncios[1].custo_por_resultado, null,
    'o criativo B tem CTR MAIOR e nenhum lead — é isso que o modelo precisa ver');
});

test('o balde usado no anúncio é o da CAMPANHA, nunca recalculado', () => {
  // A Meta OMITE um action_type quando a contagem é zero: um anúncio de campanha
  // de WhatsApp que não puxou conversa na janela fica idêntico a um de
  // engajamento puro. Recalcular por anúncio classificaria no mercado errado.
  //
  // ARMADILHA (rodada de correção 1): com `actions: []` no anúncio, os dois
  // caminhos convergem pra `resultado: null` — o certo (balde 'mensagens',
  // sem conversa na janela) E o errado (balde recalculado por `camp.objective`
  // = 'engajamento', cujo `alvo.resultado` é null POR DEFINIÇÃO em alvos.js,
  // o único balde sem métrica de quantidade). Um teste que não distingue os
  // dois passaria com o bug de volta. Por isso o anúncio abaixo tem uma
  // conversa de verdade: só o balde 'mensagens' sabe ler `conversas`;
  // 'engajamento' devolveria null de qualquer jeito.
  const camp = { id: '6', name: 'Zap', objective: 'OUTCOME_ENGAGEMENT' };
  const conjuntos = [{ id: 'c1', destination_type: 'WHATSAPP' }];
  const ads = [{
    ad_id: 'b1', ad_name: 'Puxou conversa', spend: '150',
    actions: [{ action_type: 'onsite_conversion.messaging_conversation_started_7d', value: '3' }],
  }];
  const { user } = montarMensagens(camp, { spend: '150', actions: [] }, ads, conjuntos, REGUA_TESTE);
  const d = dadosDoPrompt(user);
  assert.equal(d.regua.tipo_de_campanha, 'mensagens', 'o conjunto diz WhatsApp');
  assert.equal(d.anuncios[0].resultado, 3, 'balde mensagens lê conversas; engajamento não teria como');
  assert.equal(d.anuncios[0].custo_por_resultado, 50, '150 / 3 conversas');
});

// ---------------------------------------------------------------------------
// TENDÊNCIA E TEMPO NO AR (Tarefa 5, 24/09/2026): o robô mandava uma janela só
// — o modelo não tinha como dizer se a campanha estava melhorando ou piorando,
// e "o que mudou desde ontem" é exatamente o que se olha às 8h da manhã.
// ---------------------------------------------------------------------------

test('a janela anterior entra no prompt para o modelo ver o sentido', () => {
  const camp = { id: '7', name: 'Captação', objective: 'OUTCOME_LEADS' };
  const anterior = { spend: '1000', actions: [{ action_type: 'lead', value: '80' }] };
  const d = dadosDoPrompt(camp, INS_LEAD, [], [], REGUA_TESTE, { insAnterior: anterior });
  assert.equal(d.janela_anterior.custo_atual_reais, 12.5, '1000 / 80 na janela anterior');
  assert.equal(d.regua.custo_atual_reais, 25, 'e 25 agora: o custo DOBROU');
  assert.equal(d.janela_anterior.gasto, 1000);
});

test('sem janela anterior o campo é null e nada quebra', () => {
  const camp = { id: '8', name: 'Nova', objective: 'OUTCOME_LEADS' };
  const d = dadosDoPrompt(camp, INS_LEAD, [], [], REGUA_TESTE, {});
  assert.equal(d.janela_anterior, null);
});

test('campanha recém-subida vai marcada como em aprendizado', () => {
  const camp = { id: '9', name: 'Nova', objective: 'OUTCOME_LEADS' };
  const d = dadosDoPrompt(camp, INS_LEAD, [], [], REGUA_TESTE, { diasNoAr: 2 });
  assert.equal(d.dias_no_ar, 2);
  assert.equal(d.em_aprendizado, true, 'menos de 3 dias: a Meta ainda está aprendendo');
  const madura = dadosDoPrompt(camp, INS_LEAD, [], [], REGUA_TESTE, { diasNoAr: 30 });
  assert.equal(madura.em_aprendizado, false);
});

test('montarMensagens sem o 6o argumento não quebra (compatibilidade)', () => {
  const camp = { id: '10', name: 'Velha chamada', objective: 'OUTCOME_LEADS' };
  const d = dadosDoPrompt(camp, INS_LEAD, [], [], REGUA_TESTE);
  assert.equal(d.janela_anterior, null);
  assert.equal(d.dias_no_ar, null);
  assert.equal(d.em_aprendizado, false, 'sem dado de idade, não presume aprendizado');
  assert.equal(d.dias_da_janela, null, 'sem o dado, não inventa um número de dias');
});

test('engajamento também ganha custo na janela anterior (engajamento bruto, não null)', () => {
  // `janela_anterior.custo_atual_reais` usa a mesma função que calcula
  // `regua.custo_atual_reais` — por isso os dois campos têm o MESMO NOME: são
  // a mesma grandeza, e é o par que o modelo compara pra ver a tendência.
  // ATUALIZADO 24/09/2026: a grandeza deixou de ser o ponto ponderado e passou
  // a ser `custo_engajamento` (post_engagement bruto) — ver troca de régua em
  // alvos.js. A janela anterior de campanha de engajamento continua ganhando
  // custo (em vez de ficar em null), só que por essa métrica nova.
  const camp = { id: '11', name: 'Engaja', objective: 'OUTCOME_ENGAGEMENT' };
  const ins = { spend: '50', actions: [{ action_type: 'post_engagement', value: '200' }] };
  const anterior = { spend: '100', actions: [{ action_type: 'post_engagement', value: '200' }] };
  const d = dadosDoPrompt(camp, ins, [], [], REGUA_TESTE, { insAnterior: anterior });
  assert.equal(d.janela_anterior.custo_atual_reais, 0.5, '100 / 200 engajamentos na janela anterior');
});

// ---------------------------------------------------------------------------
// RODADA DE CORREÇÃO 1 (24/09/2026): três furos achados na leitura do prompt
// pelo próprio dono.
// ---------------------------------------------------------------------------

test('M1: dias_da_janela vai no JSON e o prompt não crava mais "7 dias"', () => {
  // A janela é since=hoje-7d até until=hoje: 8 dias INCLUSIVE, não 7. O exemplo
  // do prompt cravava "7 dias" e a justificativa herdava o número errado.
  const camp = { id: '12', name: 'Captação', objective: 'OUTCOME_LEADS' };
  const { system, user } = montarMensagens(camp, INS_LEAD, [], [], REGUA_TESTE, { diasJanela: 8 });
  const d = dadosDoPrompt(user);
  assert.equal(d.dias_da_janela, 8);
  assert.match(system, /dias_da_janela/, 'o prompt tem de citar o campo, não um número fixo');
  assert.ok(!/em 7 dias/.test(system), 'não pode sobrar o "7 dias" cravado no exemplo');
});

test('IMPORTANTE 1: aprendizado tem válvula também para "sem nenhum resultado", não só "acima da meta"', () => {
  // Campanha de 2 dias sem NENHUM resultado tem custo_atual_reais nulo — com
  // nulo não dá pra dizer "acima da meta". Só essa válvula, o prompt mandava
  // manter até campanha nova queimando dinheiro sem um lead sequer.
  const camp = { id: '13', name: 'Nova queimando', objective: 'OUTCOME_LEADS' };
  const { system } = montarMensagens(camp, { spend: '500', actions: [] }, [], [], REGUA_TESTE, { diasNoAr: 2 });
  assert.match(system, /acima da meta OU gastando sem nenhum resultado/,
    'a válvula de escape do aprendizado precisa cobrir também "sem resultado nenhum"');
});

test('IMPORTANTE 2: resultado nulo no anúncio não é lido como "não produziu nada"', () => {
  // ALVOS.engajamento.resultado é null POR DEFINIÇÃO (alvos.js) — todo anúncio
  // de campanha de engajamento chega com resultado: null, e a instrução antiga
  // ("CTR alto e nenhum resultado é candidato a pausar") lia esse null como
  // criativo ruim. O prompt agora manda julgar pelo custo_por_resultado.
  const camp = { id: '14', name: 'Engaja', objective: 'OUTCOME_ENGAGEMENT' };
  const { system } = montarMensagens(camp, {}, [], [], REGUA_TESTE);
  assert.match(system, /não conta resultado por unidade/);
  assert.match(system, /não leia isso como "o criativo não produziu nada"/);
  assert.match(system, /julgue o anúncio pelo `custo_por_resultado`/);
});
