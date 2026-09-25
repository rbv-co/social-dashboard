import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ALVOS, alvoDoBalde, avaliarAlvo } from './alvos.js';

test('cada tipo de campanha tem alvo na unidade dele', () => {
  assert.equal(ALVOS.leads.metrica, 'custo_lead');
  assert.equal(ALVOS.mensagens.metrica, 'custo_conversa');
  assert.equal(ALVOS.vendas.metrica, 'cac');
  assert.equal(ALVOS.trafego.metrica, 'custo_visita');
  assert.equal(ALVOS.reconhecimento.metrica, 'cpm');
  // ATUALIZADO 24/09/2026: engajamento saiu da métrica ponderada e passou para
  // engajamento bruto (ver teste dedicado abaixo). Este assert documentava o
  // comportamento ANTERIOR — a régua mudou de propósito, não é bug.
  assert.equal(ALVOS.engajamento.metrica, 'custo_engajamento', 'engajamento usa a métrica de engajamento bruto');
});

test('engajamento passa a ser medido por engajamento bruto, não por ponto', () => {
  // TROCA DE RÉGUA (24/09/2026, decisão do dono depois da medição): a
  // [FLUXO SHOPPING] da Vessel tinha 11.323 engajamentos e 44 pontos —
  // julgada por ponto parecia catastrófica (662x a meta), por engajamento
  // pareceria ótima. Não há fator de conversão entre as duas (a razão
  // pontos/engajamento foi de 0 a 0,56 nas campanhas medidas), então a
  // ferramenta escolhe UMA das duas, e o dono escolheu engajamento bruto.
  assert.equal(ALVOS.engajamento.metrica, 'custo_engajamento');
  assert.equal(ALVOS.engajamento.resultado, 'engaj_pub',
    'sem quantidade, todo anúncio de engajamento chega ao robô sem resultado');
});

test('a meta nova mora numa chave própria, para a do ponto sobreviver', () => {
  assert.equal(ALVOS.engajamento.chaveMeta, 'engajamento_bruto',
    'a meta antiga (R$/ponto) fica em metas.engajamento, intacta, para a pausa ser reversível');
});

test('quem não declara chaveMeta usa o próprio nome do balde', () => {
  for (const [balde, a] of Object.entries(ALVOS)) {
    if (balde === 'engajamento') continue;
    assert.equal(a.chaveMeta ?? balde, balde, balde + ' não deveria ter chave de meta própria');
  }
});

test('todo alvo tem rótulo e unidade em português para a tela', () => {
  for (const [balde, a] of Object.entries(ALVOS)) {
    assert.ok(a.rotulo && a.rotulo.length > 3, balde + ' sem rótulo');
    assert.ok(a.unidade, balde + ' sem unidade');
    assert.ok(a.ajuda && a.ajuda.length > 10, balde + ' sem explicação');
  }
});

test('alvoDoBalde devolve null para balde sem alvo (nao inventa)', () => {
  assert.equal(alvoDoBalde('padrao'), null);
  assert.equal(alvoDoBalde('balde-que-nao-existe'), null);
  assert.equal(alvoDoBalde(undefined), null);
});

test('avaliarAlvo compara custo com meta e devolve a faixa', () => {
  const lim = { escalarForte: 0.8, dentroMeta: 1.0, manter: 1.3 };
  assert.equal(avaliarAlvo({ custo: 8, meta: 10, limiares: lim }).faixa, 'escalar-forte');
  assert.equal(avaliarAlvo({ custo: 10, meta: 10, limiares: lim }).faixa, 'dentro-da-meta');
  assert.equal(avaliarAlvo({ custo: 13, meta: 10, limiares: lim }).faixa, 'manter');
  assert.equal(avaliarAlvo({ custo: 14, meta: 10, limiares: lim }).faixa, 'otimizar');
  assert.equal(avaliarAlvo({ custo: 8, meta: 10, limiares: lim }).indice, 0.8);
});

test('sem custo ou sem meta e SEM-DADOS, nunca um palpite', () => {
  const lim = { escalarForte: 0.8, dentroMeta: 1.0, manter: 1.3 };
  assert.equal(avaliarAlvo({ custo: null, meta: 10, limiares: lim }).faixa, 'sem-dados');
  assert.equal(avaliarAlvo({ custo: 5, meta: 0, limiares: lim }).faixa, 'sem-dados');
  assert.equal(avaliarAlvo({ custo: 5, meta: null, limiares: lim }).faixa, 'sem-dados');
  assert.equal(avaliarAlvo({}).faixa, 'sem-dados');
  assert.equal(avaliarAlvo({ custo: null, meta: 10, limiares: lim }).indice, null);
});

test('custo zero e resultado valido (de graca), nao ausencia', () => {
  const lim = { escalarForte: 0.8, dentroMeta: 1.0, manter: 1.3 };
  const r = avaliarAlvo({ custo: 0, meta: 10, limiares: lim });
  assert.equal(r.indice, 0);
  assert.equal(r.faixa, 'escalar-forte');
});
