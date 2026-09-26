import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizarRegua, metaDoBalde, reguaDaConta, mesclarMetasDaConta } from './regua.js';
import { PESOS_PADRAO, LIMIARES_PADRAO } from './ponderada.js';

test('linha vazia ou nula cai inteira no padrao', () => {
  assert.deepEqual(normalizarRegua(null).pesos, PESOS_PADRAO);
  assert.deepEqual(normalizarRegua(null).limiares, LIMIARES_PADRAO);
  assert.deepEqual(normalizarRegua(null).limiares_resultado, LIMIARES_PADRAO);
  assert.deepEqual(normalizarRegua(undefined).pesos, PESOS_PADRAO);
});

test('limiares_resultado (Seção 2) preenche so o que faltou, mantendo o que veio do banco', () => {
  const r = normalizarRegua({ limiares_resultado: { escalarForte: 0.9 } });
  assert.equal(r.limiares_resultado.escalarForte, 0.9, 'respeita o do banco');
  assert.equal(r.limiares_resultado.dentroMeta, 1.0, 'completa com o padrao');
  assert.equal(r.limiares_resultado.manter, 1.3, 'completa com o padrao');
});

test('limiares_resultado com valor invalido (texto, negativo, NaN) cai no padrao daquele campo', () => {
  const r = normalizarRegua({ limiares_resultado: { escalarForte: 'abc', dentroMeta: -1, manter: null } });
  assert.equal(r.limiares_resultado.escalarForte, 0.8);
  assert.equal(r.limiares_resultado.dentroMeta, 1.0);
  assert.equal(r.limiares_resultado.manter, 1.3);
});

test('os dois conjuntos de limiar sao INDEPENDENTES: mudar um nao mexe no outro', () => {
  const r = normalizarRegua({ limiares: { escalarForte: 0.8 }, limiares_resultado: { escalarForte: 0.9 } });
  assert.equal(r.limiares.escalarForte, 0.8, 'Seção 1 (ponto/interação) fica no dela');
  assert.equal(r.limiares_resultado.escalarForte, 0.9, 'Seção 2 (resultado) fica no dela, sem herdar da 1');
});

test('preenche so o que faltou, mantendo o que veio do banco', () => {
  const r = normalizarRegua({ pesos: { curtidas: 2 } });
  assert.equal(r.pesos.curtidas, 2, 'respeita o do banco');
  assert.equal(r.pesos.salvamentos, 30, 'completa com o padrao');
});

test('valor invalido (texto, negativo, NaN) cai no padrao daquele campo', () => {
  const r = normalizarRegua({ pesos: { curtidas: 'abc', comentarios: -5 }, limiares: { escalarForte: null } });
  assert.equal(r.pesos.curtidas, 1);
  assert.equal(r.pesos.comentarios, 10);
  assert.equal(r.limiares.escalarForte, 0.8);
});

test('metaDoBalde devolve a meta do PROPRIO balde, nunca a de outro', () => {
  // ATUALIZADO 24/09/2026: engajamento lê pela chave `engajamento_bruto` (ver
  // testes dedicados à troca de régua, abaixo) — aqui o que importa é só que
  // ele não pega emprestada a meta de trafego, nem o contrário.
  const r = normalizarRegua({ metas: { engajamento_bruto: 0.15, trafego: 0.25 } });
  assert.equal(metaDoBalde(r, 'engajamento'), 0.15);
  assert.equal(metaDoBalde(r, 'trafego'), 0.25);
  assert.equal(metaDoBalde(r, 'balde-que-nao-existe'), 0, 'balde sem meta propria devolve 0, nunca empresta de outro');
});

test('sem meta nenhuma devolve 0 (que o calculo trata como sem-dados)', () => {
  const r = normalizarRegua({ metas: {} });
  assert.equal(metaDoBalde(r, 'engajamento'), 0);
});

test('nao existe mais reserva em "padrao": cada balde tem sua propria unidade (I4 do review final, 2026-07-28)', () => {
  assert.equal(metaDoBalde({ metas: { padrao: 0.2 } }, 'vendas'), 0, 'padrao nao pode virar meta de vendas (unidades diferentes)');
  assert.equal(metaDoBalde({ metas: { padrao: 0.2 } }, 'leads'), 0);
  assert.equal(metaDoBalde({ metas: { padrao: 0.2 } }, 'reconhecimento'), 0);
});

test('metaDoBalde coerce string da meta solicitada pra number', () => {
  // engajamento lê por `engajamento_bruto` desde 24/09/2026 (chaveMeta) — a
  // chave do fixture mudou, o que o teste prova (coerção de tipo) não.
  const r = { metas: { engajamento_bruto: '5' } };
  const resultado = metaDoBalde(r, 'engajamento');
  assert.equal(typeof resultado, 'number', 'deve ser number, não string');
  assert.equal(resultado, 5, 'deve coercir "5" pro número 5');
});

test('metaDoBalde NAO usa "padrao" quando a meta solicitada nao existe (devolve 0)', () => {
  const r = { metas: { padrao: '10' } };
  const resultado = metaDoBalde(r, 'curtidas');
  assert.equal(typeof resultado, 'number', 'deve ser number, não string');
  assert.equal(resultado, 0, 'padrao nao serve de reserva; deve devolver 0');
});

test('metaDoBalde passa numero real direto e devolve como number', () => {
  // idem: chave `engajamento_bruto` desde a troca de régua de 24/09/2026.
  const r = { metas: { engajamento_bruto: 7.5 } };
  const resultado = metaDoBalde(r, 'engajamento');
  assert.equal(typeof resultado, 'number', 'deve ser number');
  assert.equal(resultado, 7.5, 'deve preservar o valor');
});

test('metaDoBalde sem nenhuma meta devolve 0 como number', () => {
  const r = { metas: {} };
  const resultado = metaDoBalde(r, 'engajamento');
  assert.equal(typeof resultado, 'number', 'deve ser number');
  assert.equal(resultado, 0, 'deve ser 0');
});

// ---------------------------------------------------------------------------
// METAS POR CONTA (2026-07-29). O que motivou: medido em 90 dias reais, o ponto
// de engajamento custa R$ 0,013 na Vessel e R$ 0,372 na Breno Vale. Com meta
// única, o veredito dizia mais sobre QUAL CONTA era do que sobre a campanha.
// ---------------------------------------------------------------------------

test('metas_por_conta: cada conta guarda a sua, e uma nao contamina a outra', () => {
  const r = normalizarRegua({ metas_por_conta: { 'conta-a': { engajamento: 0.33 }, 'conta-b': { engajamento: 0.012 } } });
  assert.equal(reguaDaConta(r, 'conta-a').metas.engajamento, 0.33);
  assert.equal(reguaDaConta(r, 'conta-b').metas.engajamento, 0.012);
});

test('conta SEM metas fica em branco — nao herda a meta de outra conta', () => {
  // A Mantova nao tem historico. Julga-la pelo preco que a Raissa paga seria
  // pior que nao julgar: 'sem-dados' e uma resposta honesta.
  const r = normalizarRegua({ metas_por_conta: { 'raissa': { engajamento: 0.071, trafego: 0.17 } } });
  assert.deepEqual(reguaDaConta(r, 'mantova').metas, {}, 'conta desconhecida nao herda nada');
  assert.equal(metaDoBalde(reguaDaConta(r, 'mantova'), 'engajamento'), 0, 'sem meta = 0 = sem-dados');
});

test('sem conta selecionada tambem fica em branco (nunca julga por engano)', () => {
  const r = normalizarRegua({ metas_por_conta: { 'raissa': { engajamento: 0.071 } } });
  for (const semConta of [null, undefined, '']) {
    assert.deepEqual(reguaDaConta(r, semConta).metas, {}, `${semConta} deveria ficar em branco`);
  }
});

test('a meta unica LEGADA nao vaza mais para o veredito de nenhuma conta', () => {
  // Antes de 2026-07-29 este campo governava as cinco contas. Ele continua
  // sendo guardado (historico), mas nao pode mais decidir cor nenhuma.
  // ATUALIZADO 24/09/2026: a meta da CONTA para engajamento também passou a
  // usar a chave `engajamento_bruto` (a antiga, por ponto, é a que fica em
  // `metas.engajamento` — ver troca de régua em alvos.js).
  const r = normalizarRegua({ metas: { engajamento: 0.15 }, metas_por_conta: { 'vessel': { engajamento_bruto: 0.012 } } });
  assert.equal(r.metas.engajamento, 0.15, 'segue guardado');
  assert.equal(metaDoBalde(reguaDaConta(r, 'vessel'), 'engajamento'), 0.012, 'quem manda e a meta da conta');
  assert.equal(metaDoBalde(reguaDaConta(r, 'outra'), 'engajamento'), 0, 'e a legada NAO serve de reserva');
});

test('pesos e limiares continuam GERAIS — peso e valor, nao preco', () => {
  const r = normalizarRegua({ pesos: { curtidas: 2 }, limiares: { escalarForte: 0.7 }, metas_por_conta: { 'a': {}, 'b': {} } });
  for (const conta of ['a', 'b', 'inexistente']) {
    assert.equal(reguaDaConta(r, conta).pesos.curtidas, 2);
    assert.equal(reguaDaConta(r, conta).limiares.escalarForte, 0.7);
  }
});

test('metas invalidas (texto, zero, negativo) somem do mapa da conta', () => {
  const r = normalizarRegua({ metas_por_conta: { 'a': { engajamento: 'abc', trafego: 0, leads: -5, mensagens: 24 } } });
  assert.deepEqual(reguaDaConta(r, 'a').metas, { mensagens: 24 }, 'so o valido sobrevive');
});

test('metas_por_conta ausente ou invalido nao quebra a leitura', () => {
  for (const linha of [null, {}, { metas_por_conta: null }]) {
    assert.deepEqual(normalizarRegua(linha).metas_por_conta, {});
    assert.deepEqual(reguaDaConta(normalizarRegua(linha), 'qualquer').metas, {});
  }
});

test('mesclar: salvar uma conta PRESERVA as metas das outras', () => {
  // O bug que este teste existe pra impedir: as cinco contas moram no mesmo
  // campo do banco. Gravar so o que esta na tela apagaria as outras quatro.
  const r = normalizarRegua({ metas_por_conta: { 'vessel': { engajamento: 0.012 }, 'raissa': { trafego: 0.17 } } });
  const novo = mesclarMetasDaConta(r, 'vessel', { engajamento: 0.02 });
  assert.equal(novo.vessel.engajamento, 0.02, 'troca a conta editada');
  assert.deepEqual(novo.raissa, { trafego: 0.17 }, 'e nao encosta na outra');
});

test('mesclar: conta nova entra sem apagar ninguem; sem conta nao muda nada', () => {
  const r = normalizarRegua({ metas_por_conta: { 'vessel': { engajamento: 0.012 } } });
  assert.deepEqual(mesclarMetasDaConta(r, 'nova', { leads: 20 }), { vessel: { engajamento: 0.012 }, nova: { leads: 20 } });
  assert.deepEqual(mesclarMetasDaConta(r, null, { leads: 20 }), { vessel: { engajamento: 0.012 } }, 'sem conta = no-op');
});

test('mesclar devolve copia — nao muta a regua carregada do banco', () => {
  const r = normalizarRegua({ metas_por_conta: { 'vessel': { engajamento: 0.012 } } });
  mesclarMetasDaConta(r, 'vessel', { engajamento: 99 });
  assert.equal(r.metas_por_conta.vessel.engajamento, 0.012, 'o objeto original segue intacto');
});

// ---------------------------------------------------------------------------
// TROCA DE RÉGUA DO ENGAJAMENTO (24/09/2026, ver alvos.js). metaDoBalde passa a
// resolver a CHAVE da meta pelo alvo (chaveMeta), não mais pelo nome do balde
// direto — só para engajamento, que agora lê `engajamento_bruto` em vez de
// `engajamento`, para a meta antiga (R$/ponto) sobreviver intacta.
// ---------------------------------------------------------------------------

test('metaDoBalde lê engajamento pela chave nova, não pela do ponto', () => {
  const r = normalizarRegua({ metas: { engajamento: 0.012, engajamento_bruto: 0.05 } });
  assert.equal(metaDoBalde(r, 'engajamento'), 0.05, 'vale a meta em R$/engajamento');
});

test('a meta antiga do ponto continua guardada, intacta', () => {
  const r = normalizarRegua({ metas: { engajamento: 0.012, engajamento_bruto: 0.05 } });
  assert.equal(r.metas.engajamento, 0.012,
    'apagar isto tornaria a pausa da ponderada irreversível');
});

test('sem a meta nova, engajamento não é julgado pela meta do ponto', () => {
  const r = normalizarRegua({ metas: { engajamento: 0.012 } });
  assert.equal(metaDoBalde(r, 'engajamento'), 0,
    'meta 0 devolve faixa sem-dados: número sem cor, que é o combinado');
});
