import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  listarDias,
  somarGastoPorDia,
  somarSeguidoresPorDia,
  metaDiariaDeInvestimento,
  montarSerieDeInvestimento,
  montarSerieDeCustoPorSeguidor,
  montarSerieDeCustoPorResultado,
  diasComCusto,
  diasComInvestimentoEResultado,
  valeDesenharOGrafico,
} from './series-diarias-de-meta-ads.js';

const g = (captured_at, spend, campaign_id = '1') => ({ captured_at, spend, campaign_id });
const s = (data, novos, saiu = 0) => ({ data, novos, saiu });

test('listarDias devolve todos os dias da janela, inclusive as pontas', () => {
  assert.deepEqual(listarDias('2026-07-01', '2026-07-04'), ['2026-07-01', '2026-07-02', '2026-07-03', '2026-07-04']);
  assert.deepEqual(listarDias('2026-07-01', '2026-07-01'), ['2026-07-01']);
});

test('listarDias atravessa a virada do mês', () => {
  assert.deepEqual(listarDias('2026-06-29', '2026-07-02'), ['2026-06-29', '2026-06-30', '2026-07-01', '2026-07-02']);
});

test('listarDias devolve vazio para janela inválida', () => {
  assert.deepEqual(listarDias('2026-07-10', '2026-07-01'), []);
  assert.deepEqual(listarDias(null, '2026-07-01'), []);
  assert.deepEqual(listarDias('2026-07-01', undefined), []);
  assert.deepEqual(listarDias('nada', 'coisa'), []);
});

test('somarGastoPorDia soma as campanhas do mesmo dia', () => {
  const r = somarGastoPorDia([g('2026-07-01', '10.50'), g('2026-07-01', '4.50', '2'), g('2026-07-02', '3')]);
  assert.equal(r['2026-07-01'], 15);
  assert.equal(r['2026-07-02'], 3);
});

test('somarGastoPorDia trata spend nulo/lixo como zero, mas o dia continua coletado', () => {
  const r = somarGastoPorDia([g('2026-07-01', null), g('2026-07-02', 'abc')]);
  assert.equal(r['2026-07-01'], 0);
  assert.equal(r['2026-07-02'], 0);
});

test('somarSeguidoresPorDia devolve o líquido (seguiram − saíram)', () => {
  const r = somarSeguidoresPorDia([s('2026-07-01', 10, 3), s('2026-07-02', 2, 5)]);
  assert.equal(r['2026-07-01'], 7);
  assert.equal(r['2026-07-02'], -3);
});

test('meta diária = budget do período ÷ dias do período', () => {
  assert.equal(metaDiariaDeInvestimento(600, 30), 20);
  assert.equal(metaDiariaDeInvestimento(600, 1), 600);
});

test('meta diária é zero quando não há budget ou não há dias', () => {
  assert.equal(metaDiariaDeInvestimento(0, 30), 0);
  assert.equal(metaDiariaDeInvestimento(600, 0), 0);
  assert.equal(metaDiariaDeInvestimento(NaN, 30), 0);
  assert.equal(metaDiariaDeInvestimento(-10, 30), 0);
});

test('investimento: uma barra por dia da janela, com a meta diária', () => {
  const r = montarSerieDeInvestimento({
    inicio: '2026-07-01', fim: '2026-07-03',
    linhasDeGasto: [g('2026-07-01', '20'), g('2026-07-02', '30'), g('2026-07-03', '10')],
    budgetDoPeriodo: 90,
  });
  assert.equal(r.pontos.length, 3);
  assert.deepEqual(r.pontos.map((p) => p.valor), [20, 30, 10]);
  assert.equal(r.meta, 30);
  assert.equal(r.temDado, true);
});

test('investimento: perfil SEM nenhum dia (Mantova) não quebra e não mente', () => {
  const r = montarSerieDeInvestimento({ inicio: '2026-07-01', fim: '2026-07-03', linhasDeGasto: [], budgetDoPeriodo: 600 });
  assert.equal(r.temDado, false);
  assert.equal(r.pontos.length, 3);
  assert.ok(r.pontos.every((p) => p.semDado === true && p.valor === null && p.motivo === 'sem-coleta'));
});

test('investimento: aguenta linhasDeGasto ausente', () => {
  const r = montarSerieDeInvestimento({ inicio: '2026-07-01', fim: '2026-07-02' });
  assert.equal(r.temDado, false);
  assert.equal(r.pontos.length, 2);
});

test('investimento: dia faltando no meio (Vessel) vira buraco, não zero', () => {
  const r = montarSerieDeInvestimento({
    inicio: '2026-07-01', fim: '2026-07-03',
    linhasDeGasto: [g('2026-07-01', '20'), g('2026-07-03', '10')],
    budgetDoPeriodo: 60,
  });
  assert.equal(r.pontos[1].semDado, true);
  assert.equal(r.pontos[1].valor, null);
  assert.equal(r.pontos[1].motivo, 'sem-coleta');
  assert.equal(r.pontos[0].semDado, false);
  assert.equal(r.pontos[2].semDado, false);
});

test('investimento: dia coletado com gasto zero é dado real (barra zerada), não buraco', () => {
  const r = montarSerieDeInvestimento({
    inicio: '2026-07-01', fim: '2026-07-01',
    linhasDeGasto: [g('2026-07-01', '0')],
    budgetDoPeriodo: 30,
  });
  assert.equal(r.pontos[0].semDado, false);
  assert.equal(r.pontos[0].valor, 0);
});

test('investimento: captured_at com hora ainda cai no dia certo', () => {
  const r = montarSerieDeInvestimento({
    inicio: '2026-07-01', fim: '2026-07-01',
    linhasDeGasto: [{ captured_at: '2026-07-01T09:30:00', spend: '7' }],
    budgetDoPeriodo: 7,
  });
  assert.equal(r.pontos[0].valor, 7);
});

test('custo por seguidor: divide gasto do dia pelos novos do dia', () => {
  const r = montarSerieDeCustoPorSeguidor({
    inicio: '2026-07-01', fim: '2026-07-02',
    linhasDeGasto: [g('2026-07-01', '20'), g('2026-07-02', '30')],
    linhasDeSeguidores: [s('2026-07-01', 10), s('2026-07-02', 12, 2)],
    metaDeCustoPorSeguidor: 2,
  });
  assert.equal(r.pontos[0].valor, 2);
  assert.equal(r.pontos[1].valor, 3);
});

test('custo por seguidor: a meta NÃO é dividida pelos dias (já é R$ por seguidor)', () => {
  const r = montarSerieDeCustoPorSeguidor({
    inicio: '2026-07-01', fim: '2026-07-30',
    linhasDeGasto: [g('2026-07-01', '20')],
    linhasDeSeguidores: [s('2026-07-01', 10)],
    metaDeCustoPorSeguidor: 2,
  });
  assert.equal(r.meta, 2);
});

test('custo por seguidor: gasto > 0 com 0 novos seguidores não divide por zero', () => {
  const r = montarSerieDeCustoPorSeguidor({
    inicio: '2026-07-01', fim: '2026-07-01',
    linhasDeGasto: [g('2026-07-01', '20')],
    linhasDeSeguidores: [s('2026-07-01', 0)],
    metaDeCustoPorSeguidor: 2,
  });
  assert.equal(r.pontos[0].valor, null);
  assert.equal(r.pontos[0].semDado, true);
  assert.equal(r.pontos[0].motivo, 'sem-seguidor');
  assert.equal(r.temDado, false);
});

test('custo por seguidor: dia que perdeu seguidor (líquido negativo) fica sem dado', () => {
  const r = montarSerieDeCustoPorSeguidor({
    inicio: '2026-07-01', fim: '2026-07-01',
    linhasDeGasto: [g('2026-07-01', '20')],
    linhasDeSeguidores: [s('2026-07-01', 1, 5)],
    metaDeCustoPorSeguidor: 2,
  });
  assert.equal(r.pontos[0].valor, null);
  assert.equal(r.pontos[0].motivo, 'sem-seguidor');
});

test('custo por seguidor: dia sem coleta de gasto é buraco, não sem-seguidor', () => {
  const r = montarSerieDeCustoPorSeguidor({
    inicio: '2026-07-01', fim: '2026-07-02',
    linhasDeGasto: [g('2026-07-02', '10')],
    linhasDeSeguidores: [s('2026-07-01', 5), s('2026-07-02', 5)],
    metaDeCustoPorSeguidor: 2,
  });
  assert.equal(r.pontos[0].motivo, 'sem-coleta');
  assert.equal(r.pontos[1].valor, 2);
});

test('custo por seguidor: ganhou seguidor sem gastar = custo zero', () => {
  const r = montarSerieDeCustoPorSeguidor({
    inicio: '2026-07-01', fim: '2026-07-01',
    linhasDeGasto: [g('2026-07-01', '0')],
    linhasDeSeguidores: [s('2026-07-01', 8)],
    metaDeCustoPorSeguidor: 2,
  });
  assert.equal(r.pontos[0].valor, 0);
  assert.equal(r.pontos[0].semDado, false);
});

test('custo por seguidor: perfil sem nada não quebra', () => {
  const r = montarSerieDeCustoPorSeguidor({ inicio: '2026-07-01', fim: '2026-07-03' });
  assert.equal(r.temDado, false);
  assert.equal(r.pontos.length, 3);
  assert.equal(r.meta, 0);
});

test('período de 1 dia só (Hoje) gera exatamente 1 ponto nas duas séries', () => {
  const inv = montarSerieDeInvestimento({ inicio: '2026-07-16', fim: '2026-07-16', linhasDeGasto: [g('2026-07-16', '45')], budgetDoPeriodo: 45 });
  assert.equal(inv.pontos.length, 1);
  assert.equal(inv.meta, 45);
  const cps = montarSerieDeCustoPorSeguidor({ inicio: '2026-07-16', fim: '2026-07-16', linhasDeGasto: [g('2026-07-16', '45')], linhasDeSeguidores: [s('2026-07-16', 9)], metaDeCustoPorSeguidor: 3 });
  assert.equal(cps.pontos.length, 1);
  assert.equal(cps.pontos[0].valor, 5);
});

/* ── CUSTO POR RESULTADO (uma função para SETE indicadores) ──
   Conversa, cadastro, visita, venda, interação, curtida e mil impressões são a
   MESMA conta com denominador diferente. Sete cópias quase iguais viram sete
   verdades que divergem no primeiro conserto — por isso a função é uma só. */
const r = (captured_at, quantidade) => ({ captured_at, quantidade });

test('custo por resultado: divide o gasto do dia pelo resultado do dia', () => {
  const s1 = montarSerieDeCustoPorResultado({
    inicio: '2026-07-01', fim: '2026-07-02',
    linhasDeGasto: [g('2026-07-01', '20'), g('2026-07-02', '30')],
    linhasDeResultado: [r('2026-07-01', 4), r('2026-07-02', 3)],
    meta: 6,
  });
  assert.deepEqual(s1.pontos.map(p => p.valor), [5, 10]);
  assert.equal(s1.meta, 6);
  assert.equal(s1.temDado, true);
});

test('custo por resultado: soma as campanhas do mesmo dia antes de dividir', () => {
  const s1 = montarSerieDeCustoPorResultado({
    inicio: '2026-07-01', fim: '2026-07-01',
    linhasDeGasto: [g('2026-07-01', '20'), g('2026-07-01', '10', '2')],
    linhasDeResultado: [r('2026-07-01', 4), r('2026-07-01', 2)],
  });
  assert.equal(s1.pontos[0].valor, 5); // 30 ÷ 6
});

test('custo por resultado: a meta NÃO é dividida pelos dias (já é R$ por resultado)', () => {
  const s1 = montarSerieDeCustoPorResultado({
    inicio: '2026-07-01', fim: '2026-07-30',
    linhasDeGasto: [g('2026-07-01', '20')],
    linhasDeResultado: [r('2026-07-01', 4)],
    meta: 9,
  });
  assert.equal(s1.meta, 9);
});

test('custo por resultado: dia sem gasto coletado é buraco (sem-coleta), não sem-resultado', () => {
  const s1 = montarSerieDeCustoPorResultado({
    inicio: '2026-07-01', fim: '2026-07-02',
    linhasDeGasto: [g('2026-07-02', '10')],
    linhasDeResultado: [r('2026-07-01', 5), r('2026-07-02', 5)],
  });
  assert.equal(s1.pontos[0].motivo, 'sem-coleta');
  assert.equal(s1.pontos[1].valor, 2);
});

test('custo por resultado: gastou e não teve resultado nenhum = sem-resultado, nunca divisão por zero', () => {
  const s1 = montarSerieDeCustoPorResultado({
    inicio: '2026-07-01', fim: '2026-07-01',
    linhasDeGasto: [g('2026-07-01', '20')],
    linhasDeResultado: [r('2026-07-01', 0)],
  });
  assert.equal(s1.pontos[0].valor, null);
  assert.equal(s1.pontos[0].semDado, true);
  assert.equal(s1.pontos[0].motivo, 'sem-resultado');
  assert.equal(s1.temDado, false);
});

test('custo por resultado: NULO não é ZERO — coluna ainda não coletada fica sem-resultado', () => {
  // conversas/cadastros/compras/visitas nasceram sem default em 17/08/2026: a
  // linha antiga chega com null. Somar como 0 diria "nenhuma conversa" onde a
  // verdade é "ainda não foi coletado".
  const s1 = montarSerieDeCustoPorResultado({
    inicio: '2026-07-01', fim: '2026-07-01',
    linhasDeGasto: [g('2026-07-01', '20')],
    linhasDeResultado: [r('2026-07-01', null)],
  });
  assert.equal(s1.pontos[0].motivo, 'sem-resultado');
  assert.equal(s1.pontos[0].resultado, null);
});

test('custo por resultado: uma campanha com número e outra nula somam só a que tem número', () => {
  const s1 = montarSerieDeCustoPorResultado({
    inicio: '2026-07-01', fim: '2026-07-01',
    linhasDeGasto: [g('2026-07-01', '20')],
    linhasDeResultado: [r('2026-07-01', null), r('2026-07-01', 4)],
  });
  assert.equal(s1.pontos[0].valor, 5);
  assert.equal(s1.pontos[0].resultado, 4);
});

test('custo por resultado: teve resultado sem gastar = custo zero (é dado, não buraco)', () => {
  const s1 = montarSerieDeCustoPorResultado({
    inicio: '2026-07-01', fim: '2026-07-01',
    linhasDeGasto: [g('2026-07-01', '0')],
    linhasDeResultado: [r('2026-07-01', 3)],
  });
  assert.equal(s1.pontos[0].valor, 0);
  assert.equal(s1.pontos[0].semDado, false);
});

test('custo por resultado: mil impressões divide o denominador por mil', () => {
  const s1 = montarSerieDeCustoPorResultado({
    inicio: '2026-07-01', fim: '2026-07-01',
    linhasDeGasto: [g('2026-07-01', '30')],
    linhasDeResultado: [r('2026-07-01', 6000)],
    divisorDoResultado: 1000,
  });
  assert.equal(s1.pontos[0].valor, 5); // R$ 30 ÷ 6 mil impressões
});

test('custo por resultado: perfil sem nada (Mantova) não quebra e não mente', () => {
  const s1 = montarSerieDeCustoPorResultado({ inicio: '2026-07-01', fim: '2026-07-03' });
  assert.equal(s1.temDado, false);
  assert.equal(s1.pontos.length, 3);
  assert.equal(s1.meta, 0);
  assert.ok(s1.pontos.every(p => p.semDado === true && p.valor === null));
});

test('custo por resultado: meta lixo ou negativa vira 0 (sem linha de meta)', () => {
  const base = { inicio: '2026-07-01', fim: '2026-07-01', linhasDeGasto: [g('2026-07-01', '10')], linhasDeResultado: [r('2026-07-01', 2)] };
  assert.equal(montarSerieDeCustoPorResultado({ ...base, meta: -3 }).meta, 0);
  assert.equal(montarSerieDeCustoPorResultado({ ...base, meta: NaN }).meta, 0);
  assert.equal(montarSerieDeCustoPorResultado(base).meta, 0);
});

test('custo por resultado: captured_at com hora ainda cai no dia certo', () => {
  const s1 = montarSerieDeCustoPorResultado({
    inicio: '2026-07-01', fim: '2026-07-01',
    linhasDeGasto: [{ captured_at: '2026-07-01T09:30:00', spend: '7' }],
    linhasDeResultado: [{ captured_at: '2026-07-01T09:30:00', quantidade: 7 }],
  });
  assert.equal(s1.pontos[0].valor, 1);
});

/* ── A REGRA DO "TEM O QUE MOSTRAR": 2 DIAS, NUNCA 1 ──
   Um ponto não é uma linha: não mostra tendência nenhuma e ainda ocupa espaço
   fingindo que mostra. Abaixo de 2 dias com número, o gráfico não é desenhado. */
test('vale desenhar: dois dias com custo é o mínimo que vira gráfico', () => {
  const dois = montarSerieDeCustoPorResultado({
    inicio: '2026-07-01', fim: '2026-07-03',
    linhasDeGasto: [g('2026-07-01', '10'), g('2026-07-02', '10')],
    linhasDeResultado: [r('2026-07-01', 2), r('2026-07-02', 5)],
  });
  assert.equal(diasComCusto(dois), 2);
  assert.equal(valeDesenharOGrafico(dois), true);
});

test('vale desenhar: UM dia só com custo não vira gráfico', () => {
  const um = montarSerieDeCustoPorResultado({
    inicio: '2026-07-01', fim: '2026-07-30',
    linhasDeGasto: [g('2026-07-01', '10'), g('2026-07-02', '10')],
    linhasDeResultado: [r('2026-07-01', 2)], // só o dia 01 teve resultado
  });
  assert.equal(diasComCusto(um), 1);
  assert.equal(valeDesenharOGrafico(um), false);
});

test('vale desenhar: nenhum dia com custo não vira gráfico', () => {
  const zero = montarSerieDeCustoPorResultado({ inicio: '2026-07-01', fim: '2026-07-10' });
  assert.equal(diasComCusto(zero), 0);
  assert.equal(valeDesenharOGrafico(zero), false);
});

test('vale desenhar: série ausente ou estragada não quebra a tela', () => {
  assert.equal(valeDesenharOGrafico(null), false);
  assert.equal(valeDesenharOGrafico(undefined), false);
  assert.equal(valeDesenharOGrafico({}), false);
  assert.equal(diasComCusto(null), 0);
});

test('vale desenhar: dia com custo ZERO conta como dia com número', () => {
  // Custo zero é medida ("teve resultado sem gastar"), não ausência: ele é
  // DESENHADO como ponto quando o gráfico existe.
  const s1 = montarSerieDeCustoPorResultado({
    inicio: '2026-07-01', fim: '2026-07-02',
    linhasDeGasto: [g('2026-07-01', '0'), g('2026-07-02', '0')],
    linhasDeResultado: [r('2026-07-01', 3), r('2026-07-02', 3)],
  });
  assert.equal(diasComCusto(s1), 2);
});

/* ── DIA DE GRAÇA DESENHA, MAS NÃO AUTORIZA ──
   Dia com resultado e ZERO investimento é medida de verdade e vira ponto quando
   o gráfico existe. O que ele não pode é ser um dos dois dias que AUTORIZAM o
   gráfico: senão o gráfico inteiro pode ser feito de barras de R$ 0,00, que não
   dizem nada sobre custo nenhum. Medido: acontece pouco, mas acontece — 2 dias
   assim na Vessel e 1 na Motoeasy nos últimos 30 dias. */
test('autorizar: só conta o dia que teve investimento E resultado', () => {
  const s1 = montarSerieDeCustoPorResultado({
    inicio: '2026-07-01', fim: '2026-07-03',
    linhasDeGasto: [g('2026-07-01', '0'), g('2026-07-02', '0'), g('2026-07-03', '20')],
    linhasDeResultado: [r('2026-07-01', 3), r('2026-07-02', 3), r('2026-07-03', 4)],
  });
  assert.equal(diasComCusto(s1), 3);                    // três pontos desenháveis
  assert.equal(diasComInvestimentoEResultado(s1), 1);   // um só autoriza
});

test('autorizar: dois dias de graça NÃO viram gráfico', () => {
  const s1 = montarSerieDeCustoPorResultado({
    inicio: '2026-07-01', fim: '2026-07-02',
    linhasDeGasto: [g('2026-07-01', '0'), g('2026-07-02', '0')],
    linhasDeResultado: [r('2026-07-01', 3), r('2026-07-02', 3)],
  });
  assert.equal(valeDesenharOGrafico(s1, 2, { exigirInvestimento: true }), false);
});

test('autorizar: um dia pago + um de graça ainda não bastam', () => {
  const s1 = montarSerieDeCustoPorResultado({
    inicio: '2026-07-01', fim: '2026-07-02',
    linhasDeGasto: [g('2026-07-01', '20'), g('2026-07-02', '0')],
    linhasDeResultado: [r('2026-07-01', 4), r('2026-07-02', 3)],
  });
  assert.equal(valeDesenharOGrafico(s1, 2, { exigirInvestimento: true }), false);
});

test('autorizar: dois dias pagos bastam, e o dia de graça continua no desenho', () => {
  const s1 = montarSerieDeCustoPorResultado({
    inicio: '2026-07-01', fim: '2026-07-03',
    linhasDeGasto: [g('2026-07-01', '20'), g('2026-07-02', '0'), g('2026-07-03', '30')],
    linhasDeResultado: [r('2026-07-01', 4), r('2026-07-02', 3), r('2026-07-03', 3)],
  });
  assert.equal(valeDesenharOGrafico(s1, 2, { exigirInvestimento: true }), true);
  assert.equal(s1.pontos[1].valor, 0);
  assert.equal(s1.pontos[1].semDado, false);
});

test('autorizar: sem exigir investimento, a conta é a de sempre (é o padrão)', () => {
  // O gráfico de investimento e o de custo por seguidor seguem pelo caminho de
  // sempre, com mínimo 1 e sem esta exigência — mexer neles não estava em jogo.
  const s1 = montarSerieDeCustoPorResultado({
    inicio: '2026-07-01', fim: '2026-07-02',
    linhasDeGasto: [g('2026-07-01', '0'), g('2026-07-02', '0')],
    linhasDeResultado: [r('2026-07-01', 3), r('2026-07-02', 3)],
  });
  assert.equal(valeDesenharOGrafico(s1, 2), true);
  assert.equal(valeDesenharOGrafico(s1, 2, {}), true);
});

test('autorizar: série ausente ou estragada não quebra a contagem', () => {
  assert.equal(diasComInvestimentoEResultado(null), 0);
  assert.equal(diasComInvestimentoEResultado({}), 0);
  assert.equal(valeDesenharOGrafico(null, 2, { exigirInvestimento: true }), false);
});

test('vale desenhar: o mínimo é ajustável, mas o padrão é 2', () => {
  const um = montarSerieDeCustoPorResultado({
    inicio: '2026-07-01', fim: '2026-07-02',
    linhasDeGasto: [g('2026-07-01', '10')],
    linhasDeResultado: [r('2026-07-01', 2)],
  });
  assert.equal(valeDesenharOGrafico(um, 1), true);
  assert.equal(valeDesenharOGrafico(um), false);
});
