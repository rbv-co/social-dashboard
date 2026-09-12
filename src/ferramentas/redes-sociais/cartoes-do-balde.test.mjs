import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cartoesDoBalde, podeDarVeredito, chaveDeMeta, ehMetaDeTaxa } from './cartoes-do-balde.js';
import { CRITERIOS } from '../gestao-trafego/saude.js';
// ⚠️ A LISTA VEM DE ONDE ELA MORA, nunca copiada para cá. Copiada, um balde novo
// nasce fora de toda varredura deste arquivo e passa verde sem nunca ter sido
// olhado — foi o que quase aconteceu com Engajamento em 10/09/2026, quando cinco
// testes traziam a lista escrita à mão.
import { BALDES } from './baldes-do-painel.js';
const IDS = BALDES.map(b => b.id);

// Números REAIS de 30 dias, última captura de 17/08/2026.
const motoeasy = { investimento: 6211.97, alcance: 85367, impressoes: 428132, frequencia: 5.02, conversas: 580, cadastros: 2, seguidores: 0, interacoes: 0, curtidas: 0, compras: 0, visitas: 0 };

test('TODOS mostra os quatro universais', () => {
  const c = cartoesDoBalde('todos', motoeasy);
  assert.deepEqual(c.map(x => x.id), ['investimento', 'cpm', 'alcance', 'frequencia']);
  assert.equal(c[1].valor.toFixed(2), '14.51', 'custo por mil impressões');
  assert.equal(c[2].valor, 85367);
  assert.equal(c[3].valor, 5.02);
});

test('frequência tem semáforo no limiar 4 e NÃO tem meta editável', () => {
  const c = cartoesDoBalde('todos', motoeasy).find(x => x.id === 'frequencia');
  assert.equal(c.metaKey, null);
  assert.equal(c.semaforo(5.02), 'ruim');
  assert.equal(c.semaforo(2.21), 'bom');
});

test('⚠️ SEGUIDORES mostra DOIS cartões: investimento e custo por seguidor', () => {
  // Decisão do dono em 10/09/2026, no mesmo pedido que criou o balde de
  // Engajamento: "no balde seguidores você deixa somente o card de investimento
  // (padrão) e custo por seguidores". Custo por interação e por curtida mudaram de
  // balde junto com o dinheiro que os alimentava.
  const c = cartoesDoBalde('seguidores', { investimento: 2584.19, seguidores: 1268, interacoes: 9000, curtidas: 7000 });
  assert.deepEqual(c.map(x => x.id), ['investimento', 'cps']);
  assert.equal(c[1].valor.toFixed(2), '2.04');
});

test('⚠️ ENGAJAMENTO mede interação e curtida, e mostra o volume', () => {
  const c = cartoesDoBalde('engajamento', { investimento: 4091.92, interacoes: 22700, curtidas: 4350 });
  assert.deepEqual(c.map(x => x.id), ['investimento', 'cpi', 'cpl', 'interacoes']);
  assert.equal(c[1].valor.toFixed(2), '0.18');
  assert.equal(c[2].valor.toFixed(2), '0.94');
  assert.equal(c[3].valor, 22700);
});

test('⚠️ as metas do balde novo NASCEM VAZIAS, com chave própria', () => {
  // Nada a herdar: não existia meta de cpi/cpl gravada (conferido no banco em
  // 10/09/2026 — as 45 linhas de social_metas são cps, spend, followers e
  // interactions). Herdar a chave pelada aqui faria a meta de um balde virar
  // veredito sobre outro.
  assert.equal(chaveDeMeta('cpi', 'engajamento'), 'engajamento.cpi');
  assert.equal(chaveDeMeta('cpl', 'engajamento'), 'engajamento.cpl');
  assert.equal(chaveDeMeta('spend', 'engajamento'), 'engajamento.spend');
});

test('VENDAS mostra TRÊS cartões — inventar um quarto seria fingir informação', () => {
  const c = cartoesDoBalde('vendas', { investimento: 360, compras: 4 });
  assert.equal(c.length, 3);
  assert.deepEqual(c.map(x => x.id), ['investimento', 'custo_venda', 'compras']);
});

test('CONTATOS mede conversa e cadastro', () => {
  const c = cartoesDoBalde('contatos', { investimento: 5803.29, conversas: 580, cadastros: 2 });
  assert.deepEqual(c.map(x => x.id), ['investimento', 'custo_conversa', 'conversas', 'custo_cadastro']);
  assert.equal(c[1].valor.toFixed(2), '10.01');
});

test('SITE E ALCANCE mede visita e mil impressões', () => {
  const c = cartoesDoBalde('site', { investimento: 3049.60, visitas: 10000, impressoes: 600000 });
  assert.deepEqual(c.map(x => x.id), ['investimento', 'custo_visita', 'visitas', 'cpm']);
});

test('denominador zero vira "—", NUNCA R$ 0,00', () => {
  // Um 500 da API já virou R$ 0,00 no ar por 17 horas neste projeto.
  const c = cartoesDoBalde('contatos', { investimento: 500, conversas: 0, cadastros: 0 });
  assert.equal(c[1].valor, null);
  assert.equal(c[3].valor, null);
});

test('número que ainda não foi coletado (nulo) também vira "—"', () => {
  const c = cartoesDoBalde('contatos', { investimento: 500, conversas: null, cadastros: null });
  assert.equal(c[1].valor, null);
  assert.equal(c[2].valor, null, 'a QUANTIDADE também: 0 conversas e "não sei" são coisas diferentes');
});

test('balde desconhecido cai em Todos, e não numa tela vazia', () => {
  assert.deepEqual(cartoesDoBalde('bugiganga', motoeasy).map(x => x.id), cartoesDoBalde('todos', motoeasy).map(x => x.id));
});

// ── Guardas que a TELA depende, e que só o teste vê antes do dono ──

test('sem números nenhum, cada balde ainda devolve seus cartões — todos em "—"', () => {
  // A tela desenha os cartões ANTES de a consulta voltar, e no recorte vazio ela
  // nunca tem número. Devolver lista vazia aqui apagaria a seção 02 inteira.
  IDS.forEach((b) => {
    const c = cartoesDoBalde(b, undefined);
    // DOIS é o piso desde que Seguidores enxugou (investimento + custo por seguidor).
    assert.ok(c.length >= 2, b + ' devolveu cartão de menos');
    c.forEach(x => assert.equal(x.valor, null, b + '/' + x.id + ' inventou valor sem dado'));
  });
});

test('todo cartão de todo balde tem rótulo, explicação e formato conhecido', () => {
  // O rótulo é o que o dono lê; a explicação é o texto do selo de cálculo. Cartão
  // sem um dos dois chega na tela como caixa muda.
  const FORMATOS = ['dinheiro', 'inteiro', 'decimal'];
  IDS.forEach((b) => {
    cartoesDoBalde(b, motoeasy).forEach((x) => {
      assert.ok(x.id && x.rotulo, b + ': cartão sem id/rótulo');
      assert.ok(x.explicacao && x.explicacao.length > 10, b + '/' + x.id + ': sem explicação');
      assert.ok(FORMATOS.includes(x.formato), b + '/' + x.id + ': formato ' + x.formato);
      assert.ok(x.metaKey === null || typeof x.metaKey === 'string', b + '/' + x.id + ': metaKey estranho');
      assert.ok(x.semaforo === null || typeof x.semaforo === 'function', b + '/' + x.id + ': semáforo estranho');
    });
  });
});

test('quantidade e frequência ZERO são fato e aparecem como zero — só o nulo vira "—"', () => {
  // "Ninguém comprou" é resposta; "não perguntei" não é. Os dois não podem sair
  // iguais na tela.
  const c = cartoesDoBalde('vendas', { investimento: 360, compras: 0 });
  assert.equal(c[1].valor, null, 'custo por venda sem venda não é R$ 0');
  assert.equal(c[2].valor, 0, 'a quantidade de vendas É zero, e zero se mostra');
  const f = cartoesDoBalde('todos', { frequencia: null }).find(x => x.id === 'frequencia');
  assert.equal(f.valor, null);
  assert.equal(f.semaforo(null), null, 'sem número não se acende semáforo nenhum');
});

test('investimento nulo (recorte sem campanha) não vira R$ 0 em balde nenhum', () => {
  IDS.forEach((b) => {
    const inv = cartoesDoBalde(b, { investimento: null, conversas: 10, compras: 10, visitas: 10, impressoes: 1000, seguidores: 10, interacoes: 10, curtidas: 10 })[0];
    assert.equal(inv.id, 'investimento');
    assert.equal(inv.valor, null, b + ': investimento nulo virou número');
    // e sem dinheiro não existe custo: dividir null por 10 não pode dar 0.
    cartoesDoBalde(b, { investimento: null, conversas: 10, compras: 10, visitas: 10, impressoes: 1000, seguidores: 10, interacoes: 10, curtidas: 10 })
      .filter(x => x.formato === 'dinheiro' && x.id !== 'investimento')
      .forEach(x => assert.equal(x.valor, null, b + '/' + x.id + ': custo sem investimento'));
  });
});

test('as faixas da frequência são AS MESMAS da saúde da Gestão de Tráfego', () => {
  // Dois juízes discordando sobre a mesma campanha é defeito. saude.js é o que já
  // existia, então ele manda: importado, não copiado.
  const f = cartoesDoBalde('todos', motoeasy).find(x => x.id === 'frequencia');
  assert.equal(CRITERIOS.freqSatura, 4);
  assert.equal(CRITERIOS.freqAtencao, 3.5);
  assert.equal(f.semaforo(CRITERIOS.freqSatura), 'ruim');
  assert.equal(f.semaforo(CRITERIOS.freqAtencao), 'atencao');
  assert.equal(f.semaforo(3.6), 'atencao');
  assert.equal(f.semaforo(3.2), 'bom', 'entre 3 e 3,5 a saúde do GT ainda diz que está bom');
  assert.equal(f.semaforo(3.49), 'bom');
});

test('TODO custo de um balde divide O MESMO investimento — o que está no cartão de cima', () => {
  // Um número que não divide o número impresso acima dele é um número que
  // ninguém consegue conferir. Foi por isso que a Vessel mostrava R$ 7.802 de
  // investimento enquanto os custos dividiam R$ 461,52.
  const n = { investimento: 2584.19, seguidores: 1268, interacoes: 9000, curtidas: 7000, conversas: 100, cadastros: 10, compras: 4, visitas: 500, impressoes: 300000 };
  const denominadores = { seguidores: { cps: 1268 }, engajamento: { cpi: 9000, cpl: 7000 }, contatos: { custo_conversa: 100, custo_cadastro: 10 }, vendas: { custo_venda: 4 }, site: { custo_visita: 500, cpm: 300 }, todos: { cpm: 300 } };
  Object.keys(denominadores).forEach((balde) => {
    const c = cartoesDoBalde(balde, n);
    assert.equal(c[0].valor, 2584.19, balde);
    Object.keys(denominadores[balde]).forEach((id) => {
      const cartao = c.find(x => x.id === id);
      assert.equal(cartao.valor, c[0].valor / denominadores[balde][id], balde + '/' + id + ' não divide o investimento do cartão');
    });
  });
});

test('sem meta definida NÃO se dá veredito — nota contra meta 0 é conclusão sem prova', () => {
  // Uma meta chutada já fez o semáforo responder "de quem é essa conta?" em vez
  // de "essa campanha vai bem?". Cartão sem alvo mostra o número e cala a nota.
  const c = cartoesDoBalde('contatos', { investimento: 500, conversas: 50 }).find(x => x.id === 'custo_conversa');
  assert.equal(c.valor, 10);
  assert.equal(podeDarVeredito(c, 0), false, 'meta 0 não é meta');
  assert.equal(podeDarVeredito(c, null), false);
  assert.equal(podeDarVeredito(c, undefined), false);
  assert.equal(podeDarVeredito(c, NaN), false);
  assert.equal(podeDarVeredito(c, 12), true, 'com alvo de verdade, aí sim');
});

test('veredito também não sai sem número, nem em cartão que não tem meta', () => {
  const semNumero = cartoesDoBalde('contatos', { investimento: 500, conversas: null }).find(x => x.id === 'custo_conversa');
  assert.equal(podeDarVeredito(semNumero, 12), false, '"—" não recebe nota');
  const quantidade = cartoesDoBalde('todos', motoeasy).find(x => x.id === 'alcance');
  assert.equal(podeDarVeredito(quantidade, 12), false, 'cartão sem metaKey nunca tem barra');
  assert.equal(podeDarVeredito(null, 12), false);
});

// ── A CHAVE DA META (o que vai para social_metas.indicador) ──

test('a meta carrega o balde no nome', () => {
  assert.equal(chaveDeMeta('custo_conversa', 'contatos'), 'contatos.custo_conversa');
  assert.equal(chaveDeMeta('cpm', 'site'), 'site.cpm');
});

test('a meta de hoje continua valendo, sem prefixo, no balde Seguidores', () => {
  // A linha `cps` já gravada foi definida contra ESTE cartão — 14 delas no banco.
  assert.equal(chaveDeMeta('cps', 'seguidores'), 'cps');
  // ⚠️ cpi/cpl SAÍRAM da herança em 10/09/2026: os cartões mudaram para o balde de
  // Engajamento e a chave foi junto. Nada se perdeu — não havia nenhuma meta de
  // cpi/cpl gravada (conferido: as 45 linhas são cps, spend, followers, interactions).
  assert.equal(chaveDeMeta('cpi', 'engajamento'), 'engajamento.cpi');
  assert.equal(chaveDeMeta('cpl', 'engajamento'), 'engajamento.cpl');
});

test('o BUDGET de hoje vale para Todos, que é o número contra o qual foi definido', () => {
  assert.equal(chaveDeMeta('spend', 'todos'), 'spend');
});

test('o BUDGET dos demais baldes é PRÓPRIO e nasce sem valor', () => {
  // Uma meta de conta inteira contra o dinheiro de um balde compararia coisas
  // diferentes: a barrinha diria 8% batido no dia em que o dono gastou tudo o que
  // queria em seguidores.
  assert.equal(chaveDeMeta('spend', 'seguidores'), 'seguidores.spend');
  assert.equal(chaveDeMeta('spend', 'contatos'), 'contatos.spend');
  assert.equal(chaveDeMeta('spend', 'site'), 'site.spend');
  assert.equal(chaveDeMeta('spend', 'vendas'), 'vendas.spend');
});

test('a herança é do PAR indicador+balde: cps fora de Seguidores é meta nova', () => {
  // Se `cps` valesse sem prefixo em qualquer balde, a meta de custo por seguidor
  // do dono viraria alvo de um número que não é de seguidor nenhum.
  assert.equal(chaveDeMeta('cps', 'contatos'), 'contatos.cps');
  assert.equal(chaveDeMeta('cpl', 'todos'), 'todos.cpl');
  assert.equal(chaveDeMeta('spend', 'bugiganga'), 'bugiganga.spend');
});

test('nenhuma chave de meta se repete entre dois baldes', () => {
  // Duas telas gravando na MESMA linha de social_metas é como uma meta digitada
  // em Contatos reapareceria em Vendas. A varredura cobre todo cartão com meta.
  const dono = {};
  IDS.forEach((b) => {
    cartoesDoBalde(b, {}).filter(c => c.metaKey).forEach((c) => {
      const chave = chaveDeMeta(c.metaKey, b);
      assert.equal(dono[chave], undefined, chave + ' é usada por ' + dono[chave] + ' E por ' + b);
      dono[chave] = b;
    });
  });
  // E as chaves sem prefixo são exatamente as que já existem no banco.
  assert.deepEqual(Object.keys(dono).filter(k => !k.includes('.')).sort(), ['cps', 'spend']);
});

test('o cartão de investimento é sempre o primeiro, e é o único com meta de BUDGET', () => {
  // A tela usa applySpend() (budget, maior gasto = pior) só nele; os outros usam a
  // régua invertida de custo. Trocar a ordem trocaria as duas contas de lugar.
  IDS.forEach((b) => {
    const c = cartoesDoBalde(b, motoeasy);
    assert.equal(c[0].id, 'investimento', b);
    assert.equal(c[0].metaKey, 'spend', b);
    assert.equal(c.filter(x => x.metaKey === 'spend').length, 1, b);
  });
});

// ── TAXA × VOLUME: o que impede uma meta de custo de ser MULTIPLICADA ──
// Sem esta distinção, os R$ 12 por conversa digitados em 7D são copiados
// proporcionalmente para os outros períodos e viram R$ 51 na linha de 30D. É
// número GRAVADO em social_metas, não pixel — por isso tem teste.
test('meta de custo é taxa, com e sem o balde na frente da chave', () => {
  assert.equal(ehMetaDeTaxa('cps'), true, 'chave herdada, sem prefixo');
  assert.equal(ehMetaDeTaxa('contatos.custo_conversa'), true);
  assert.equal(ehMetaDeTaxa('site.custo_visita'), true);
  assert.equal(ehMetaDeTaxa('todos.cpm'), true);
  assert.equal(ehMetaDeTaxa('vendas.custo_venda'), true);
});

test('budget é VOLUME: 30 dias custam mais que 7, e a meta acompanha', () => {
  assert.equal(ehMetaDeTaxa('spend'), false);
  assert.equal(ehMetaDeTaxa('seguidores.spend'), false);
  assert.equal(ehMetaDeTaxa('followers'), false);
});

test('TODO cartão de custo de TODO balde é reconhecido como taxa pela chave que ele mesmo gera', () => {
  // Derivado das receitas, não repetido à mão: cartão de custo novo que nasça
  // fora da lista quebra AQUI, e não na conta do dono.
  const numeros = { investimento: 100, seguidores: 10, interacoes: 10, curtidas: 10, conversas: 10, cadastros: 10, compras: 10, visitas: 10, impressoes: 10000, alcance: 10, frequencia: 2 };
  for (const balde of IDS) {
    for (const cartao of cartoesDoBalde(balde, numeros)) {
      if (!cartao.metaKey || cartao.formato !== 'dinheiro' || cartao.id === 'investimento') continue;
      assert.equal(ehMetaDeTaxa(chaveDeMeta(cartao.metaKey, balde)), true, `${balde}.${cartao.id} tinha de ser taxa`);
    }
  }
});

test('chave desconhecida NÃO é taxa: na dúvida, o caminho antigo (volume) continua valendo', () => {
  assert.equal(ehMetaDeTaxa('inventada'), false);
  assert.equal(ehMetaDeTaxa('balde.inventada'), false);
  assert.equal(ehMetaDeTaxa(''), false);
});
