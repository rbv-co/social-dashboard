import test from 'node:test';
import assert from 'node:assert/strict';
import { campanhaEmVeiculacao, montarMensagens, parsearSaida, diaDaSemanaBR, decidirEscopo, veiculouNaJanela, selecionarCampanhas, custoAtualDoAlvo } from './budget-ia.mjs';
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

// CONJUNTOS DE FIXTURE (Onda C, Tarefa 3, 25/09/2026): desde que `baldeEfetivo`
// saiu do caminho do veredito, quem decide o mercado é `mercadoDaCampanha`, que
// olha o CONJUNTO — não basta mais `camp.objective` sozinho. Estes conjuntos
// simulam o que a Meta afirma em cada mercado usado pelos testes abaixo.
// `objective` não precisa vir aqui: `montarMensagens` herda o de `camp` (ver
// `comObjetivoHerdado` em budget-ia.mjs) — é o que desempata OFFSITE_CONVERSIONS
// entre 'lead' e 'site_venda' conforme o objetivo declarado da campanha.
const CONJ_OFFSITE = [{ id: 'cj1', destination_type: 'UNDEFINED', optimization_goal: 'OFFSITE_CONVERSIONS' }];
const CONJ_POST = [{ id: 'cj1', optimization_goal: 'POST_ENGAGEMENT' }];

test('campanha de LEAD leva o custo atual, não só a meta', () => {
  const camp = { id: '1', name: 'Captação', objective: 'OUTCOME_LEADS' };
  // ATUALIZADO 25/09/2026 (Onda C, Tarefa 3): antes bastava `objective:
  // OUTCOME_LEADS` com conjuntos=[] para cair no balde 'leads'. Hoje quem
  // decide é o CONJUNTO (destino UNDEFINED + otimização OFFSITE_CONVERSIONS),
  // com o objetivo como desempate — ver mercados.js.
  const { user } = montarMensagens(camp, INS_LEAD, [], CONJ_OFFSITE, REGUA_TESTE);
  const d = dadosDoPrompt(user);
  assert.equal(d.regua.custo_atual_reais, 25, 'custo por lead = 1000 / 40');
  assert.ok(d.regua.meta_reais > 0, 'a meta precisa continuar indo junto');
  assert.ok(Math.abs(d.regua.indice_contra_meta - 25 / 15) < 0.001,
    'índice = custo ÷ meta; 1,0 é exatamente na meta');
});

test('campanha de VENDAS também leva o custo atual', () => {
  const camp = { id: '2', name: 'Vendas', objective: 'OUTCOME_SALES' };
  const ins = { spend: '1000', actions: [{ action_type: 'purchase', value: '20' }] };
  // ATUALIZADO 25/09/2026 (Onda C, Tarefa 3): mesmo conjunto OFFSITE_CONVERSIONS
  // de cima — o objetivo (OUTCOME_SALES, herdado da campanha) é quem desempata
  // para 'site_venda' em vez de 'lead' (ver MERCADO_POR_OTIMIZACAO_E_OBJETIVO
  // em mercados.js).
  const { user } = montarMensagens(camp, ins, [], CONJ_OFFSITE, REGUA_TESTE);
  const d = dadosDoPrompt(user);
  assert.equal(d.regua.mercado, 'site_venda');
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
  //
  // ATUALIZADO 25/09/2026 (Onda C, Tarefa 3): `baldeEfetivo`/'engajamento'
  // saíram do caminho do veredito. O balde 'engajamento' nem existe mais em
  // ALVOS (ver alvos.js) — o mercado equivalente (post_engagement bruto,
  // otimização POST_ENGAGEMENT) agora se chama 'post', e é o CONJUNTO
  // (`CONJ_POST`), não o objetivo declarado, que decide isso.
  const camp = { id: '3', name: 'Engaja', objective: 'OUTCOME_ENGAGEMENT' };
  // 'post_engagement' é o que a Meta conta como engajamento bruto (sem pesar
  // por tipo de interação, ao contrário da ponderada) — R$ 50 / 200
  // engajamentos = R$ 0,25 por engajamento.
  const ins = { spend: '50', actions: [{ action_type: 'post_engagement', value: '200' }] };
  const { user } = montarMensagens(camp, ins, [], CONJ_POST, REGUA_TESTE);
  const d = dadosDoPrompt(user);
  assert.equal(d.regua.mercado, 'post');
  assert.equal(d.regua.rotulo, 'Custo por engajamento');
  assert.equal(d.regua.custo_atual_reais, 0.25, 'custo por engajamento = 50 / 200 engajamentos');
});

test('campanha sem resultado na janela manda null, nunca zero', () => {
  const camp = { id: '4', name: 'Parada', objective: 'OUTCOME_LEADS' };
  // ATUALIZADO 25/09/2026 (Onda C, Tarefa 3): com conjuntos=[] a campanha caía
  // em 'desconhecido' e o null saía pela ausência de mercado, não pela
  // ausência de resultado — o que este teste quer provar. Com `CONJ_OFFSITE`
  // (mercado 'lead' real, via o objetivo OUTCOME_LEADS) o null agora vem de
  // `_gtPerGasto` (zero lead na janela), que é o comportamento que importa
  // proteger (ver restrição "quantidade zero devolve null" no topo do arquivo).
  const { user } = montarMensagens(camp, { spend: '800', actions: [] }, [], CONJ_OFFSITE, REGUA_TESTE);
  const d = dadosDoPrompt(user);
  assert.equal(d.regua.mercado, 'lead');
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
  // ATUALIZADO 25/09/2026 (Onda C, Tarefa 3): `CONJ_OFFSITE` no lugar de `[]`
  // — sem conjunto a campanha caía em 'desconhecido' e todo `resultado`/
  // `custo_por_resultado` sairia null por FALTA DE MERCADO, não pelo motivo
  // que este teste quer provar (lead ausente na janela do anúncio B).
  const { user } = montarMensagens(camp, INS_LEAD, ads, CONJ_OFFSITE, REGUA_TESTE);
  const d = dadosDoPrompt(user);
  assert.equal(d.anuncios[0].resultado, 10);
  assert.equal(d.anuncios[0].custo_por_resultado, 20, '200 / 10 leads');
  assert.equal(d.anuncios[1].resultado, null, 'sem lead na janela: null, não zero');
  assert.equal(d.anuncios[1].custo_por_resultado, null,
    'o criativo B tem CTR MAIOR e nenhum lead — é isso que o modelo precisa ver');
});

test('o mercado usado no anúncio é o da CAMPANHA, nunca recalculado', () => {
  // A Meta OMITE um action_type quando a contagem é zero: um anúncio de campanha
  // de WhatsApp que não puxou conversa na janela fica idêntico a um de
  // engajamento puro. Recalcular por anúncio classificaria no mercado errado.
  //
  // ARMADILHA (rodada de correção 1): com `actions: []` no anúncio, os dois
  // caminhos convergem pra `resultado: null` — o certo (mercado 'conversa',
  // sem conversa na janela) E o errado (mercado recalculado por
  // `camp.objective` = engajamento/'post'). Um teste que não distingue os
  // dois passaria com o bug de volta. Por isso o anúncio abaixo tem uma
  // conversa de verdade: só o mercado 'conversa' sabe ler `conversas` a
  // partir dela.
  //
  // ATUALIZADO 24/09/2026: desde a troca de régua, `alvo.resultado` de
  // engajamento NÃO é mais null por definição (é `'engaj_pub'`, ver alvos.js)
  // — o `resultado` do anúncio errado continua null aqui pela razão de
  // sempre: a métrica de engajamento lê o action_type `post_engagement`, e
  // esta conversa de WhatsApp não é esse tipo de ação (é
  // `onsite_conversion.messaging_conversation_started_7d`).
  //
  // ATUALIZADO 25/09/2026 (Onda C, Tarefa 3): `baldeEfetivo` saiu do caminho
  // do veredito — quem decide o mercado da campanha (e, por descida, do
  // anúncio) é `mercadoDaCampanha`. O conjunto WHATSAPP decide sozinho pelo
  // DESTINO (nem precisa de `optimization_goal`, ver MERCADO_POR_DESTINO em
  // mercados.js), e o mercado se chama 'conversa' agora, não mais 'mensagens'
  // (que sobrevive só como `chaveMeta`, ver alvos.js).
  const camp = { id: '6', name: 'Zap', objective: 'OUTCOME_ENGAGEMENT' };
  const conjuntos = [{ id: 'c1', destination_type: 'WHATSAPP' }];
  const ads = [{
    ad_id: 'b1', ad_name: 'Puxou conversa', spend: '150',
    actions: [{ action_type: 'onsite_conversion.messaging_conversation_started_7d', value: '3' }],
  }];
  const { user } = montarMensagens(camp, { spend: '150', actions: [] }, ads, conjuntos, REGUA_TESTE);
  const d = dadosDoPrompt(user);
  assert.equal(d.regua.mercado, 'conversa', 'o conjunto diz WhatsApp');
  assert.equal(d.anuncios[0].resultado, 3, 'mercado conversa lê conversas; post não teria como');
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
  // ATUALIZADO 25/09/2026 (Onda C, Tarefa 3): `CONJ_OFFSITE` no lugar de `[]`
  // — sem conjunto, mercado 'desconhecido' zera os DOIS custos (atual e da
  // janela anterior) pela ausência de mercado, não pela tendência que este
  // teste quer provar.
  const d = dadosDoPrompt(camp, INS_LEAD, [], CONJ_OFFSITE, REGUA_TESTE, { insAnterior: anterior });
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
  //
  // ATUALIZADO 25/09/2026 (Onda C, Tarefa 3): `CONJ_POST` no lugar de `[]` —
  // hoje quem decide o mercado é o conjunto, e o mercado equivalente ao antigo
  // balde 'engajamento' se chama 'post' (ver mercados.js/alvos.js).
  const camp = { id: '11', name: 'Engaja', objective: 'OUTCOME_ENGAGEMENT' };
  const ins = { spend: '50', actions: [{ action_type: 'post_engagement', value: '200' }] };
  const anterior = { spend: '100', actions: [{ action_type: 'post_engagement', value: '200' }] };
  const d = dadosDoPrompt(camp, ins, [], CONJ_POST, REGUA_TESTE, { insAnterior: anterior });
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
  // ATUALIZADO 24/09/2026: este teste nasceu quando ALVOS.engajamento.resultado
  // era null POR DEFINIÇÃO — não é mais verdade (é 'engaj_pub', ver alvos.js).
  // Quem hoje chega sem `resultado` (nem `custo_por_resultado`) é o balde
  // 'padrao': campanha cujo objetivo a ferramenta não reconhece e que por
  // isso não tem alvo nenhum em alvos.js (ver baldes.js). A instrução antiga
  // ("CTR alto e nenhum resultado é candidato a pausar") lia esse null como
  // criativo ruim. O prompt manda julgar pelo custo_por_resultado — este
  // teste só confere que a instrução (texto estático do prompt) continua lá;
  // não depende de qual balde é usado abaixo.
  const camp = { id: '14', name: 'Engaja', objective: 'OUTCOME_ENGAGEMENT' };
  const { system } = montarMensagens(camp, {}, [], [], REGUA_TESTE);
  assert.match(system, /não conta resultado por unidade/);
  assert.match(system, /não leia isso como "o criativo não produziu nada"/);
  assert.match(system, /julgue o anúncio pelo `custo_por_resultado`/);
});

// ---------------------------------------------------------------------------
// TAREFA 5 (24/09/2026): objetivo declarado por interação. A TELA já julga
// campanha declarada pelo custo da interação (curtida/comentário/salvamento/
// compartilhamento); o robô ainda julgava pela régua do balde — os dois
// discordavam na mesma campanha, e é o robô quem escreve a justificativa que
// o dono lê na Fila. `metaDoBalde` já aceita a interação como "balde" (ela
// não está em ALVOS, então cai na chave literal — ver regua.js:109).
// ---------------------------------------------------------------------------

test('campanha com interação declarada é julgada por ela, não pelo balde', () => {
  const camp = { id: '20', name: 'Engaja', objective: 'OUTCOME_ENGAGEMENT' };
  const ins = { spend: '100', actions: [
    { action_type: 'post_engagement', value: '1000' },
    { action_type: 'onsite_conversion.post_save', value: '25' },
  ] };
  const regua = normalizarRegua({ metas: { engajamento_bruto: 0.05, salvamentos: 2 } });
  const d = dadosDoPrompt(camp, ins, [], [], regua, { interacaoDeclarada: 'salvamentos' });
  assert.equal(d.regua.custo_atual_reais, 4, 'custo por salvamento = 100 / 25');
  assert.equal(d.regua.meta_reais, 2, 'a meta da interação declarada, não a do balde');
  assert.ok(/salvamento/i.test(d.regua.rotulo));
});

test('sem declaração, engajamento segue pelo custo por engajamento', () => {
  const camp = { id: '21', name: 'Engaja', objective: 'OUTCOME_ENGAGEMENT' };
  const ins = { spend: '100', actions: [{ action_type: 'post_engagement', value: '1000' }] };
  const regua = normalizarRegua({ metas: { engajamento_bruto: 0.05 } });
  // ATUALIZADO 25/09/2026 (Onda C, Tarefa 3): `CONJ_POST` no lugar de `[]` —
  // sem conjunto, o mercado cai em 'desconhecido' e o custo por engajamento
  // some por falta de mercado, não pela ausência de declaração que este teste
  // quer provar.
  const d = dadosDoPrompt(camp, ins, [], CONJ_POST, regua, {});
  assert.equal(d.regua.custo_atual_reais, 0.1, '100 / 1000 engajamentos');
});

test('declaração inválida é ignorada, não derruba a análise', () => {
  const camp = { id: '22', name: 'Engaja', objective: 'OUTCOME_ENGAGEMENT' };
  const ins = { spend: '100', actions: [{ action_type: 'post_engagement', value: '1000' }] };
  const regua = normalizarRegua({ metas: { engajamento_bruto: 0.05 } });
  // ATUALIZADO 25/09/2026 (Onda C, Tarefa 3): mesmo motivo do teste acima.
  const d = dadosDoPrompt(camp, ins, [], CONJ_POST, regua, { interacaoDeclarada: 'xpto' });
  assert.equal(d.regua.custo_atual_reais, 0.1, 'cai de volta no custo por engajamento');
});

test('custoAtualDoAlvo: chamada de 3 argumentos (sem interação) continua funcionando', () => {
  const ins = { spend: '50', actions: [{ action_type: 'post_engagement', value: '200' }] };
  // ATUALIZADO 25/09/2026 (Onda C, Tarefa 3): 'engajamento' não é mais chave de
  // ALVOS (reindexado por mercado) — o equivalente hoje é 'post' (post_engagement
  // bruto, ver alvos.js/mercados.js). `custoAtualDoAlvo` recebe a chave de
  // `ALVOS` diretamente aqui (chamada de baixo nível, sem passar por
  // `mercadoDaCampanha`), então o teste precisa passar um mercado REAL.
  assert.equal(custoAtualDoAlvo('post', ins, normalizarRegua(null)), 0.25);
});

test('TRAVA: a janela anterior usa a MESMA interação declarada, não o balde padrão', () => {
  // Rodada de correção 1 (24/09/2026): se alguém remover o 4º argumento de
  // `custoAtualDoAlvo` na chamada da janela anterior (dentro de
  // `montarMensagens`, no campo `janela_anterior.custo_atual_reais`), a
  // tendência passaria a comparar "hoje por salvamento" com "ontem por
  // engajamento" — duas grandezas diferentes, sem nada quebrar e nenhum outro
  // teste reclamar — e o modelo escreveria uma frase de tendência confiante
  // em cima de números de mercados diferentes.
  // Fixture: a mesma interação (salvamentos) nas duas janelas, com volumes
  // BEM diferentes do que dá o cálculo por engajamento bruto, para o "por
  // salvamento" e o "por engajamento" não coincidirem por acidente:
  //   por salvamento (correto):     60 / 20  = 3
  //   por engajamento (regressão):  60 / 500 = 0.12
  const camp = { id: '23', name: 'Engaja', objective: 'OUTCOME_ENGAGEMENT' };
  const ins = { spend: '100', actions: [
    { action_type: 'post_engagement', value: '1000' },
    { action_type: 'onsite_conversion.post_save', value: '25' },
  ] };
  const anterior = { spend: '60', actions: [
    { action_type: 'post_engagement', value: '500' },
    { action_type: 'onsite_conversion.post_save', value: '20' },
  ] };
  const regua = normalizarRegua({ metas: { salvamentos: 2 } });
  const d = dadosDoPrompt(camp, ins, [], [], regua, { insAnterior: anterior, interacaoDeclarada: 'salvamentos' });
  assert.equal(d.janela_anterior.custo_atual_reais, 3,
    'custo por SALVAMENTO na janela anterior (60/20) — não por engajamento (60/500=0.12)');
});

test('custoAtualDoAlvo: quantidade zero na interação declarada devolve null, nunca 0', () => {
  // R$ 0,00 no prompt é lido como "de graça" e vira "escalar" — a mesma
  // guarda de custoDaInteracao (ausência ou zero de verdade) tem de valer
  // também passando pelo override do robô.
  const ins = { spend: '100', actions: [{ action_type: 'post_engagement', value: '1000' }] };
  const c = custoAtualDoAlvo('engajamento', ins, normalizarRegua(null), 'salvamentos');
  assert.equal(c, null, 'sem nenhum salvamento na janela, não pode virar custo zero nem o de engajamento');
});

// ---------------------------------------------------------------------------
// TAREFA 6 (Onda B) — custo por seguidor DA CONTA no prompt de campanha de
// seguidores. Nunca existiu teste pra este trecho antes (a muleta da Onda A
// só tinha `medida_indisponivel` fixo) — cobrindo agora que ele ganha o
// número de contexto.
// ---------------------------------------------------------------------------

test('campanha de seguidores confiável leva o custo por seguidor DA CONTA como contexto', () => {
  const camp = { id: '9', name: '[+ SEGUIDORES] Vessel', objective: 'OUTCOME_TRAFFIC' };
  const ins = { spend: '500', clicks: '1', impressions: '10000', ctr: '0.01', reach: '9000', frequency: '3' };
  const d = dadosDoPrompt(camp, ins, [], [], REGUA_TESTE, {
    diasJanela: 7,
    custoPorSeguidorConta: { valor: 1.6, confiavel: true, porque: 'x' },
  });
  assert.equal(d.regua.custo_por_seguidor_da_conta_reais, 1.6);
  assert.match(d.regua.medida_indisponivel, /não atribui/);
});

test('campanha de seguidores SEM dado confiável não leva número nenhum de contexto (null, não zero)', () => {
  const camp = { id: '9', name: '[+ SEGUIDORES] Vessel', objective: 'OUTCOME_TRAFFIC' };
  const ins = { spend: '500', clicks: '1', impressions: '10000' };
  const semDado = dadosDoPrompt(camp, ins, [], [], REGUA_TESTE, { diasJanela: 7 });
  assert.equal(semDado.regua.custo_por_seguidor_da_conta_reais, null);

  const poucoConfiavel = dadosDoPrompt(camp, ins, [], [], REGUA_TESTE, {
    diasJanela: 7,
    custoPorSeguidorConta: { valor: 200, confiavel: false, porque: 'amostra pequena' },
  });
  assert.equal(poucoConfiavel.regua.custo_por_seguidor_da_conta_reais, null,
    'confiavel:false nunca chega no prompt como número — amostra pequena não é "quase certo"');
});

test('campanha que NÃO é de seguidores nunca leva custo_por_seguidor_da_conta_reais, mesmo que extra venha preenchido', () => {
  const camp = { id: '9', name: 'Captação de Vendas', objective: 'OUTCOME_SALES' };
  const d = dadosDoPrompt(camp, INS_LEAD, [], [], REGUA_TESTE, {
    custoPorSeguidorConta: { valor: 1.6, confiavel: true, porque: 'x' },
  });
  assert.equal(d.regua.custo_por_seguidor_da_conta_reais, undefined,
    'campanha comum não usa o ramo de seguidores do regua — o campo nem existe');
});

test('o prompt manda usar o custo por seguidor da conta só como CONTEXTO, nunca como custo da campanha', () => {
  const camp = { id: '9', name: '[+ SEGUIDORES] Vessel', objective: 'OUTCOME_TRAFFIC' };
  const { system } = montarMensagens(camp, {}, [], [], REGUA_TESTE, {
    custoPorSeguidorConta: { valor: 1.6, confiavel: true, porque: 'x' },
  });
  assert.match(system, /custo_por_seguidor_da_conta_reais/);
  assert.match(system, /SÓ como contexto/);
  assert.match(system, /NUNCA como custo desta campanha/);
});

// ---------------------------------------------------------------------------
// APOSENTADORIA DA MULETA PARA MERCADO "perfil" (25/09/2026, Onda C, rodada de
// correção 1). A muleta nasceu porque `_GT_VISIT` lia `landing_page_view` como
// resíduo antes de `link_click` — no [SEGUIDORES][REMARKETING] da Raíssa isso
// dava R$ 247,45 (1455× a meta). A Tarefa 2 corrigiu a CAUSA (`_GT_VISIT_PERFIL
// = ['link_click']`, sem fallback): a mesma campanha, pelo mercado `perfil`,
// dá ~R$ 0,09 — a KPI de verdade que o dono pediu pra ver. A muleta agora só
// dispara quando o mercado NÃO é `perfil` (ver `semMedidaDeSeguidor`).
// ---------------------------------------------------------------------------

test('campanha de seguidores cujo mercado é "perfil" NÃO recebe medida_indisponivel — julga pelo custo real', () => {
  const camp = { id: '40', name: '[SEGUIDORES][REMARKETING]', objective: 'OUTCOME_TRAFFIC' };
  const conjuntos = [{ destination_type: 'INSTAGRAM_PROFILE', optimization_goal: 'PROFILE_VISIT' }];
  // Números do caso real (ver metricas.js): 283.84 / 3203 cliques ≈ 0,0886.
  const ins = { spend: '283.84', actions: [{ action_type: 'link_click', value: '3203' }] };
  const d = dadosDoPrompt(camp, ins, [], conjuntos, REGUA_TESTE, {});
  assert.equal(d.regua.mercado, 'perfil');
  assert.equal(d.regua.medida_indisponivel, undefined, 'perfil tem KPI real — a muleta não entra mais aqui');
  assert.ok(Math.abs(d.regua.custo_atual_reais - 0.0886) < 0.001, 'custo por visita ao perfil de verdade, não mais indisponível');
});

test('campanha de seguidores em "perfil" leva o custo por visita E o contexto da conta, lado a lado', () => {
  // As DUAS metades da decisão do dono de 25/09: "custo por visita ao perfil
  // (julgamento) + seguidor da conta (contexto)", nunca uma escondendo a outra.
  const camp = { id: '41', name: '[+ SEGUIDORES] Vessel', objective: 'OUTCOME_TRAFFIC' };
  const conjuntos = [{ destination_type: 'INSTAGRAM_PROFILE', optimization_goal: 'PROFILE_VISIT' }];
  const ins = { spend: '100', actions: [{ action_type: 'link_click', value: '20' }] };
  const d = dadosDoPrompt(camp, ins, [], conjuntos, REGUA_TESTE, {
    diasJanela: 7,
    custoPorSeguidorConta: { valor: 1.6, confiavel: true, porque: 'x' },
  });
  assert.equal(d.regua.mercado, 'perfil');
  assert.equal(d.regua.custo_atual_reais, 5, '100 / 20 visitas ao perfil — o julgamento');
  assert.equal(d.regua.custo_por_seguidor_da_conta_reais, 1.6, 'o contexto da conta continua indo junto');
});

test('campanha de seguidores SEM mercado perfil continua com a muleta (mercado desconhecido, sem sinal de conjunto)', () => {
  // O caso que a muleta ainda protege: sem destino/otimização reconhecidos, a
  // ferramenta não tem como medir nada — nem `perfil` nem qualquer outro.
  const camp = { id: '42', name: '[+ SEGUIDORES] Sem sinal', objective: 'OUTCOME_TRAFFIC' };
  const d = dadosDoPrompt(camp, { spend: '500', actions: [] }, [], [], REGUA_TESTE, {});
  assert.equal(d.regua.mercado, 'desconhecido');
  assert.match(d.regua.medida_indisponivel, /não atribui/);
  assert.equal(d.regua.custo_atual_reais, null);
});

test('o prompt instrui o modelo a JULGAR a campanha de seguidores em "perfil" pelo custo real, não a chamar de indisponível', () => {
  const camp = { id: '43', name: '[+ SEGUIDORES] Vessel', objective: 'OUTCOME_TRAFFIC' };
  const conjuntos = [{ destination_type: 'INSTAGRAM_PROFILE', optimization_goal: 'PROFILE_VISIT' }];
  const { system } = montarMensagens(camp, {}, [], conjuntos, REGUA_TESTE);
  assert.match(system, /regua\.mercado.*vier "perfil"/);
  assert.match(system, /JULGUE por ele/i);
  assert.match(system, /NUNCA diga que a medida está indisponível/);
});

// ---------------------------------------------------------------------------
// ONDA C, TAREFA 3 (25/09/2026): o robô julga por MERCADO — o que a campanha
// COMPRA de verdade, segundo os CONJUNTOS (ver mercados.js) — não mais pelo
// objetivo declarado (`baldeEfetivo` saiu do caminho do veredito). Medido em
// produção em 25/09: Motoeasy (OUTCOME_ENGAGEMENT + WhatsApp) é conversa;
// Mantova (mesmo objetivo + perfil) é visita ao perfil; o [FLUXO SHOPPING] da
// Vessel (mesmo objetivo + ON_VIDEO/THRUPLAY) é view. Três mercados, um
// rótulo de objetivo — é a razão de existir desta tarefa.
// ---------------------------------------------------------------------------

test('Motoeasy: OUTCOME_ENGAGEMENT + conjunto de WhatsApp vira mercado "conversa"', () => {
  const camp = { id: '30', name: '[IA] Motoeasy', objective: 'OUTCOME_ENGAGEMENT' };
  const conjuntos = [{ destination_type: 'WHATSAPP', optimization_goal: 'CONVERSATIONS' }];
  const ins = { spend: '100', actions: [{ action_type: 'onsite_conversion.messaging_conversation_started_7d', value: '10' }] };
  const d = dadosDoPrompt(camp, ins, [], conjuntos, REGUA_TESTE, {});
  assert.equal(d.regua.mercado, 'conversa');
  // ALVOS.conversa.rotulo é "Custo por lead" de propósito (ver alvos.js) —
  // não é erro de digitação, é o nome que o dono já calibrou para este mercado.
  assert.equal(d.regua.rotulo, 'Custo por lead');
  assert.equal(d.regua.custo_atual_reais, 10, '100 / 10 conversas');
  // O objetivo DECLARADO continua indo pro registro histórico, mesmo o mercado
  // sendo outra coisa — é o campo que o robô grava em gt_budget_analises.
  assert.equal(d.objetivo, 'OUTCOME_ENGAGEMENT');
});

test('Mantova: mesmo objetivo (OUTCOME_ENGAGEMENT) + conjunto de perfil vira mercado "perfil"', () => {
  const camp = { id: '31', name: '[IA] Mantova', objective: 'OUTCOME_ENGAGEMENT' };
  const conjuntos = [{ destination_type: 'INSTAGRAM_PROFILE', optimization_goal: 'PROFILE_VISIT' }];
  // Mercado `perfil` lê `link_click` (ver _GT_VISIT_PERFIL em metricas.js — a
  // correção da Raíssa: NUNCA landing_page_view, que aparece como resíduo).
  const ins = { spend: '100', actions: [{ action_type: 'link_click', value: '20' }] };
  const d = dadosDoPrompt(camp, ins, [], conjuntos, REGUA_TESTE, {});
  assert.equal(d.regua.mercado, 'perfil');
  assert.equal(d.regua.rotulo, 'Custo por visita ao perfil');
  assert.equal(d.regua.custo_atual_reais, 5, '100 / 20 visitas ao perfil');
});

test('[FLUXO SHOPPING]: mesmo objetivo (OUTCOME_ENGAGEMENT) + ON_VIDEO/THRUPLAY vira mercado "video"', () => {
  const camp = { id: '32', name: '[FLUXO SHOPPING]', objective: 'OUTCOME_ENGAGEMENT' };
  const conjuntos = [{ destination_type: 'ON_VIDEO', optimization_goal: 'THRUPLAY' }];
  const ins = { spend: '50', actions: [{ action_type: 'video_view', value: '500' }] };
  const d = dadosDoPrompt(camp, ins, [], conjuntos, REGUA_TESTE, {});
  assert.equal(d.regua.mercado, 'video');
  assert.equal(d.regua.rotulo, 'Custo por view');
  assert.equal(d.regua.custo_atual_reais, 0.1, '50 / 500 views — antes isto virava "reduzir" medido como engajamento');
});

test('mercado DESCONHECIDO: sem alvo, sem meta, sem custo — nunca inventa', () => {
  const camp = { id: '33', name: 'Sinal novo da Meta', objective: 'OUTCOME_TRAFFIC' };
  const conjuntos = [{ destination_type: 'XPTO', optimization_goal: 'XPTO' }];
  const d = dadosDoPrompt(camp, { spend: '900', actions: [] }, [], conjuntos, REGUA_TESTE, {});
  assert.equal(d.regua.mercado, 'desconhecido');
  assert.equal(d.regua.rotulo, null);
  assert.equal(d.regua.meta_reais, null);
  assert.equal(d.regua.custo_atual_reais, null);
  assert.equal(d.regua.indice_contra_meta, null);
});

test('o prompt instrui o modelo a julgar mercado desconhecido só pelos indicadores, nunca inventar', () => {
  const camp = { id: '33', name: 'Sinal novo da Meta', objective: 'OUTCOME_TRAFFIC' };
  const { system } = montarMensagens(camp, {}, [], [], REGUA_TESTE);
  assert.match(system, /regua\.mercado.*"desconhecido"/);
  assert.match(system, /não foi possível identificar o que esta campanha compra/);
  assert.match(system, /nunca invente um custo por resultado/);
});

test('campanha MISTA ([LEADS LOJA][mixconversão]): sem custo de campanha, com quebra por conjunto', () => {
  // O caso real: um conjunto de WhatsApp (conversa) e um de site (venda, via
  // pixel OFFSITE_CONVERSIONS + objetivo OUTCOME_SALES) na MESMA campanha, ao
  // mesmo tempo — ver mercadoDaCampanha em mercados.js.
  const camp = { id: '34', name: '[LEADS LOJA][mixconversão]', objective: 'OUTCOME_SALES' };
  const conjuntos = [
    { id: 'cj_zap', destination_type: 'WHATSAPP', optimization_goal: 'CONVERSATIONS', spend: '300',
      actions: [{ action_type: 'onsite_conversion.messaging_conversation_started_7d', value: '10' }] },
    { id: 'cj_site', destination_type: 'UNDEFINED', optimization_goal: 'OFFSITE_CONVERSIONS', spend: '700',
      actions: [{ action_type: 'purchase', value: '5' }] },
  ];
  const d = dadosDoPrompt(camp, { spend: '1000' }, [], conjuntos, REGUA_TESTE, {});
  assert.equal(d.regua.mercado, 'misto');
  // NUNCA soma gasto/resultado de mercados diferentes num custo de campanha.
  assert.equal(d.regua.custo_atual_reais, null);
  assert.equal(d.regua.meta_reais, null);
  assert.equal(d.regua.indice_contra_meta, null);
  assert.equal(d.regua.por_conjunto.length, 2);
  const porZap = d.regua.por_conjunto.find((c) => c.mercado === 'conversa');
  const porSite = d.regua.por_conjunto.find((c) => c.mercado === 'site_venda');
  assert.equal(porZap.gasto, 300);
  assert.equal(porZap.resultado, 10);
  assert.equal(porZap.custo_atual_reais, 30, '300 / 10 conversas');
  assert.equal(porZap.meta_reais, 10, 'chaveMeta mensagens da REGUA_TESTE');
  assert.equal(porSite.gasto, 700);
  assert.equal(porSite.resultado, 5);
  assert.equal(porSite.custo_atual_reais, 140, '700 / 5 compras');
  assert.equal(porSite.meta_reais, 80, 'chaveMeta vendas da REGUA_TESTE');
});

// ---------------------------------------------------------------------------
// ACHADO DA REVISÃO (Onda C, Tarefa 5, Passo 2, rodada de correção): antes
// desta correção, TODO anúncio de campanha mista saía com `resultado` e
// `custo_por_resultado` NULOS — mesmo pertencendo a um conjunto de mercado
// único e bem identificado — porque o mercado usado para o anúncio era o da
// CAMPANHA ('misto', sem entrada em ALVOS). A TELA já quebra por conjunto; o
// robô mandando null para todos os anúncios divergia dela. Este teste prova
// que cada anúncio agora usa o mercado do PRÓPRIO conjunto (via `adset_id`).
// ---------------------------------------------------------------------------
test('campanha mista: cada anúncio leva o mercado do CONJUNTO dele, não o "misto" da campanha', () => {
  const camp = { id: '34', name: '[LEADS LOJA][mixconversão]', objective: 'OUTCOME_SALES' };
  const conjuntos = [
    { id: 'cj_zap', destination_type: 'WHATSAPP', optimization_goal: 'CONVERSATIONS', spend: '300',
      actions: [{ action_type: 'onsite_conversion.messaging_conversation_started_7d', value: '10' }] },
    { id: 'cj_site', destination_type: 'UNDEFINED', optimization_goal: 'OFFSITE_CONVERSIONS', spend: '700',
      actions: [{ action_type: 'purchase', value: '5' }] },
  ];
  const ads = [
    { ad_id: 'a_zap', ad_name: 'Anúncio do WhatsApp', adset_id: 'cj_zap', spend: '150',
      actions: [{ action_type: 'onsite_conversion.messaging_conversation_started_7d', value: '5' }] },
    { ad_id: 'a_site', ad_name: 'Anúncio do site', adset_id: 'cj_site', spend: '350',
      actions: [{ action_type: 'purchase', value: '2' }] },
  ];
  const d = dadosDoPrompt(camp, { spend: '1000' }, ads, conjuntos, REGUA_TESTE, {});
  assert.equal(d.regua.mercado, 'misto');
  const zap = d.anuncios.find((a) => a.ad_id === 'a_zap');
  const site = d.anuncios.find((a) => a.ad_id === 'a_site');
  assert.equal(zap.resultado, 5, 'conjunto do WhatsApp: conversas, não null');
  assert.equal(zap.custo_por_resultado, 30, '150 / 5 conversas');
  assert.equal(site.resultado, 2, 'conjunto do site: compras, não null');
  assert.equal(site.custo_por_resultado, 175, '350 / 2 compras');
});

test('campanha mista: anúncio sem adset_id reconhecível fica sem resultado, nunca inventa', () => {
  const camp = { id: '34', name: '[LEADS LOJA][mixconversão]', objective: 'OUTCOME_SALES' };
  const conjuntos = [
    { id: 'cj_zap', destination_type: 'WHATSAPP', optimization_goal: 'CONVERSATIONS', spend: '300',
      actions: [{ action_type: 'onsite_conversion.messaging_conversation_started_7d', value: '10' }] },
    { id: 'cj_site', destination_type: 'UNDEFINED', optimization_goal: 'OFFSITE_CONVERSIONS', spend: '700',
      actions: [{ action_type: 'purchase', value: '5' }] },
  ];
  const ads = [{ ad_id: 'orfao', ad_name: 'Sem conjunto conhecido', spend: '10', actions: [] }];
  const d = dadosDoPrompt(camp, { spend: '1000' }, ads, conjuntos, REGUA_TESTE, {});
  assert.equal(d.anuncios[0].resultado, null);
  assert.equal(d.anuncios[0].custo_por_resultado, null);
});

test('o prompt instrui o modelo a julgar campanha mista conjunto a conjunto, sem inventar média', () => {
  const camp = { id: '34', name: '[LEADS LOJA][mixconversão]', objective: 'OUTCOME_SALES' };
  const conjuntos = [
    { destination_type: 'WHATSAPP', optimization_goal: 'CONVERSATIONS' },
    { destination_type: 'UNDEFINED', optimization_goal: 'OFFSITE_CONVERSIONS' },
  ];
  const { system } = montarMensagens(camp, {}, [], conjuntos, REGUA_TESTE);
  assert.match(system, /regua\.mercado.*"misto"/);
  assert.match(system, /regua\.por_conjunto/);
  assert.match(system, /NUNCA some gasto ou resultado entre mercados diferentes/);
  assert.match(system, /NUNCA invente uma média única/);
});

test('campanha mista com interação DECLARADA é julgada por ela, não pela quebra por conjunto', () => {
  // Uma declaração manual do dono (Tarefa 5) vence a mistura — mesma
  // precedência que já valia para mercado simples.
  const camp = { id: '35', name: '[LEADS LOJA][mixconversão]', objective: 'OUTCOME_SALES' };
  const conjuntos = [
    { destination_type: 'WHATSAPP', optimization_goal: 'CONVERSATIONS' },
    { destination_type: 'UNDEFINED', optimization_goal: 'OFFSITE_CONVERSIONS' },
  ];
  const regua = normalizarRegua({ metas: { salvamentos: 2 } });
  const ins = { spend: '100', actions: [{ action_type: 'onsite_conversion.post_save', value: '25' }] };
  const d = dadosDoPrompt(camp, ins, [], conjuntos, regua, { interacaoDeclarada: 'salvamentos' });
  assert.equal(d.regua.por_conjunto, undefined, 'com declaração, nem monta a quebra por conjunto');
  assert.equal(d.regua.custo_atual_reais, 4, '100 / 25 salvamentos, a declaração venceu a mistura');
});
