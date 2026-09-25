import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizarRegua, metaDoBalde, reguaDaConta, mesclarMetasDaConta, ponderadaLigada } from './regua.js';
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
  // ATUALIZADO 25/09/2026 (Onda C, reindex de ALVOS por MERCADO — ver
  // alvos.js): este teste ficou vermelho quando 'engajamento' e 'trafego'
  // deixaram de ser chave de ALVOS (viraram 'post' e 'site_trafego'). Índice
  // trocado, não lógica: o que o teste prova continua valendo — 'post' não
  // pega emprestada a meta de 'site_trafego', nem o contrário. 'post' lê por
  // 'engajamento_bruto' com o interruptor desligado (padrão, Tarefa 4).
  const r = normalizarRegua({ metas: { engajamento_bruto: 0.15, trafego: 0.25 } });
  assert.equal(metaDoBalde(r, 'post'), 0.15);
  assert.equal(metaDoBalde(r, 'site_trafego'), 0.25);
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
  // ATUALIZADO 25/09/2026: balde 'engajamento' virou mercado 'post' no reindex
  // (ver alvos.js) — a chave do balde no fixture mudou, o que o teste prova
  // (coerção de tipo) não. `r` cru (sem passar por normalizarRegua) prova de
  // quebra que `ponderadaLigada` não derruba nada quando a chave nem existe.
  const r = { metas: { engajamento_bruto: '5' } };
  const resultado = metaDoBalde(r, 'post');
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
  // ATUALIZADO 25/09/2026: idem ao teste acima — 'engajamento' virou 'post'.
  const r = { metas: { engajamento_bruto: 7.5 } };
  const resultado = metaDoBalde(r, 'post');
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
  // ATUALIZADO 25/09/2026: 'engajamento' era o BALDE; virou o mercado 'post'
  // no reindex de ALVOS (ver alvos.js) — só o índice de `metaDoBalde` mudou, o
  // campo do fixture (`metas.engajamento`, a meta antiga por ponto) continua
  // com o MESMO nome porque é uma chave de META, não de balde/mercado.
  const r = normalizarRegua({ metas: { engajamento: 0.15 }, metas_por_conta: { 'vessel': { engajamento_bruto: 0.012 } } });
  assert.equal(r.metas.engajamento, 0.15, 'segue guardado');
  assert.equal(metaDoBalde(reguaDaConta(r, 'vessel'), 'post'), 0.012, 'quem manda e a meta da conta');
  assert.equal(metaDoBalde(reguaDaConta(r, 'outra'), 'post'), 0, 'e a legada NAO serve de reserva');
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
//
// ATUALIZADO 25/09/2026 (Onda C, Tarefa 4): balde 'engajamento' virou o
// mercado 'post' no reindex de ALVOS — trocado nos três testes abaixo, índice
// só, a lógica que eles provam não mudou. Esta seção ganhou também os testes
// do INTERRUPTOR (ponderadaLigada): por padrão ele está desligado, e é essa a
// razão de 'post' ler `engajamento_bruto` aqui embaixo.
// ---------------------------------------------------------------------------

test('metaDoBalde lê engajamento pela chave nova, não pela do ponto', () => {
  const r = normalizarRegua({ metas: { engajamento: 0.012, engajamento_bruto: 0.05 } });
  assert.equal(metaDoBalde(r, 'post'), 0.05, 'vale a meta em R$/engajamento');
});

test('a meta antiga do ponto continua guardada, intacta', () => {
  const r = normalizarRegua({ metas: { engajamento: 0.012, engajamento_bruto: 0.05 } });
  assert.equal(r.metas.engajamento, 0.012,
    'apagar isto tornaria a pausa da ponderada irreversível');
});

test('sem a meta nova, engajamento não é julgado pela meta do ponto', () => {
  const r = normalizarRegua({ metas: { engajamento: 0.012 } });
  assert.equal(metaDoBalde(r, 'post'), 0,
    'meta 0 devolve faixa sem-dados: número sem cor, que é o combinado');
});

// ---------------------------------------------------------------------------
// O INTERRUPTOR DA PONDERADA (Onda C, Tarefa 4, 25/09/2026). `ponderadaLigada`
// é a FONTE ÚNICA — tela e robô leem daqui. Padrão DESLIGADA (decisão do dono,
// 24/09/2026). Ligar troca qual meta `metaDoBalde('post', ...)` consulta: da
// NOVA (R$/engajamento) pra ANTIGA (R$/ponto), sem apagar nenhuma das duas.
// ---------------------------------------------------------------------------

test('ponderadaLigada devolve false para regua vazia, nula ou sem a chave — nunca quebra', () => {
  assert.equal(ponderadaLigada(null), false);
  assert.equal(ponderadaLigada(undefined), false);
  assert.equal(ponderadaLigada({}), false);
  assert.equal(ponderadaLigada(normalizarRegua(null)), false, 'padrao de fabrica e desligada');
  assert.equal(ponderadaLigada(normalizarRegua({})), false);
});

test('ponderadaLigada so devolve true para o booleano true — texto, 1 ou outro lixo nao ligam', () => {
  assert.equal(ponderadaLigada({ ponderada_ligada: 'true' }), false, 'string nao e booleano');
  assert.equal(ponderadaLigada({ ponderada_ligada: 1 }), false, 'numero nao e booleano');
  assert.equal(ponderadaLigada({ ponderada_ligada: true }), true);
});

test('normalizarRegua le o interruptor de dentro de `limiares` (sem coluna nova no banco) e o devolve como campo PROPRIO', () => {
  const desligada = normalizarRegua({ limiares: { escalarForte: 0.7 } });
  assert.equal(desligada.ponderada_ligada, false, 'linha sem a chave cai no padrao: desligada');
  assert.equal(desligada.limiares.ponderada_ligada, undefined,
    'o booleano NUNCA fica dentro do objeto de limiares normalizado — misturaria com multiplicador');
  const ligada = normalizarRegua({ limiares: { escalarForte: 0.7, ponderada_ligada: true } });
  assert.equal(ligada.ponderada_ligada, true);
  assert.equal(ligada.limiares.escalarForte, 0.7, 'ligar o interruptor nao mexe nos multiplicadores da mesma secao');
});

test('ligar o interruptor troca a meta que metaDoBalde(post) consulta, sem apagar a outra', () => {
  const r = normalizarRegua({ limiares: { ponderada_ligada: true }, metas: { engajamento: 0.013, engajamento_bruto: 0.32 } });
  assert.equal(ponderadaLigada(r), true);
  assert.equal(metaDoBalde(r, 'post'), 0.013, 'ligada, post volta a ler a meta ANTIGA (R$/ponto)');
  assert.equal(r.metas.engajamento_bruto, 0.32, 'a meta NOVA continua guardada, so deixa de ser consultada');
});

test('desligar de novo volta a ler a meta nova — nenhuma das duas se apaga ao trocar o interruptor', () => {
  const base = { metas: { engajamento: 0.013, engajamento_bruto: 0.32 } };
  const ligada = normalizarRegua({ ...base, limiares: { ponderada_ligada: true } });
  const desligada = normalizarRegua({ ...base, limiares: { ponderada_ligada: false } });
  assert.equal(metaDoBalde(ligada, 'post'), 0.013);
  assert.equal(metaDoBalde(desligada, 'post'), 0.32);
  assert.equal(ligada.metas.engajamento, 0.013, 'a antiga sobrevive nos dois estados');
  assert.equal(desligada.metas.engajamento, 0.013, 'a antiga sobrevive nos dois estados');
  assert.equal(ligada.metas.engajamento_bruto, 0.32, 'a nova sobrevive nos dois estados');
  assert.equal(desligada.metas.engajamento_bruto, 0.32, 'a nova sobrevive nos dois estados');
});

// ACHADO na verificação da Tarefa 5 (rodada de correção 1, 25/09/2026):
// reguaDaConta não copiava `ponderada_ligada` — o caminho REAL da tela
// (_gtReguaAtiva -> reguaDaConta) sempre via `undefined`, então
// `ponderadaLigada(reguaAtiva)` era SEMPRE false em produção, não importa o
// que estivesse salvo. O interruptor da Tarefa 4 nunca tinha efeito nenhum
// pelo caminho de verdade — só nos testes que chamam metaDoBalde direto em
// cima do normalizarRegua, sem passar por reguaDaConta.
test('reguaDaConta leva o interruptor da ponderada junto — é GERAL, como pesos e limiares', () => {
  const ligada = normalizarRegua({
    limiares: { ponderada_ligada: true },
    metas_por_conta: { vessel: { engajamento: 0.013, engajamento_bruto: 0.32 } },
  });
  const porConta = reguaDaConta(ligada, 'vessel');
  assert.equal(ponderadaLigada(porConta), true,
    'sem este campo, o interruptor nunca dispararia pelo caminho real da tela (_gtReguaAtiva)');
  // A PROVA que importa: `metaDoBalde('post')` só lê a meta ANTIGA
  // (0.013, R$/ponto) em vez da NOVA (0.32, R$/engajamento) quando o
  // interruptor sobrevive à passagem por reguaDaConta — antes deste
  // conserto, `porConta.ponderada_ligada` era `undefined` e este teste
  // devolvia 0.32 mesmo com a régua real dizendo "ligada".
  assert.equal(metaDoBalde(porConta, 'post'), 0.013);
});

test('reguaDaConta com o interruptor DESLIGADO continua desligado, não como default silencioso', () => {
  const desligada = normalizarRegua({ limiares: { ponderada_ligada: false } });
  assert.equal(ponderadaLigada(reguaDaConta(desligada, 'x')), false);
});
