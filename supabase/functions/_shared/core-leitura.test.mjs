import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ligada, escolherFonte, criarClienteCore, clienteDoAmbiente, catalogoDoCore, saldoDoDepositoPorSku,
  idadeDoEspelho, limiteDeIdadeMin,
} from './core-leitura.js';

const resp = (corpo, status = 200) => ({ ok: status < 400, status, json: async () => corpo });
const semEspera = () => Promise.resolve();

/** fetch falso: `rotas` é uma função (url, init) → resposta; guarda as chamadas. */
function falso(rotas) {
  const chamadas = [];
  const fetchImpl = async (url, init) => { chamadas.push({ url: String(url), init }); return rotas(new URL(url), init); };
  return { fetchImpl, chamadas };
}

test('ligada: só "true"/"1" ligam; ausente, vazio ou outra coisa desliga', () => {
  assert.equal(ligada('X', {}), false);
  assert.equal(ligada('X', { CORE_LEITURA_X: 'false' }), false);
  assert.equal(ligada('X', { CORE_LEITURA_X: '' }), false);
  assert.equal(ligada('X', { CORE_LEITURA_X: 'sim' }), false);
  assert.equal(ligada('X', { CORE_LEITURA_X: 'true' }), true);
  assert.equal(ligada('X', { CORE_LEITURA_X: ' TRUE ' }), true);
  assert.equal(ligada('X', { CORE_LEITURA_X: '1' }), true);
});

test('escolherFonte: desligada chama SO o bling; ligada chama SO o core', () => {
  const visto = [];
  const fontes = { bling: () => { visto.push('bling'); return 'B'; }, core: () => { visto.push('core'); return 'C'; } };
  assert.equal(escolherFonte('X', {}, fontes), 'B');
  assert.equal(escolherFonte('X', { CORE_LEITURA_X: 'false' }, fontes), 'B');
  assert.equal(escolherFonte('X', { CORE_LEITURA_X: 'true' }, fontes), 'C');
  assert.deepEqual(visto, ['bling', 'bling', 'core']);
});

test('cliente: sem token lanca; URL padrao; Bearer no header; query com array e campos', async () => {
  assert.throws(() => criarClienteCore({}), /CORE_API_TOKEN/);
  const { fetchImpl, chamadas } = falso(() => resp({ data: [], proximo_cursor: null }));
  const core = clienteDoAmbiente({ CORE_API_TOKEN: 'segredo-x' }, { fetchImpl });
  await core.todas('estoque_depositos', { campos: ['id_bling', 'saldo'], deposito_id: [1, 2] });
  const u = new URL(chamadas[0].url);
  assert.equal(u.origin, 'https://core.rbvcompany.com');
  assert.equal(u.pathname, '/api/interno/espelho/estoque_depositos');
  assert.equal(u.searchParams.get('campos'), 'id_bling,saldo');
  assert.deepEqual(u.searchParams.getAll('deposito_id[]'), ['1', '2']);
  assert.equal(chamadas[0].init.headers.Authorization, 'Bearer segredo-x');
});

test('cliente: usa CORE_URL e tira a barra final', async () => {
  const { fetchImpl, chamadas } = falso(() => resp({ data: [], proximo_cursor: null }));
  const core = clienteDoAmbiente({ CORE_API_TOKEN: 't', CORE_URL: 'https://core.teste/' }, { fetchImpl });
  await core.todas('produtos_bling');
  assert.ok(chamadas[0].url.startsWith('https://core.teste/api/interno/espelho/produtos_bling'));
});

test('todas: segue proximo_cursor ate acabar e junta as paginas', async () => {
  const { fetchImpl, chamadas } = falso((u) => {
    const c = u.searchParams.get('cursor');
    if (!c) return resp({ data: [{ id: 1 }, { id: 2 }], proximo_cursor: 'c2', espelhado_em: 'A' });
    return resp({ data: [{ id: 3 }], proximo_cursor: null, espelhado_em: 'B' });
  });
  const core = criarClienteCore({ token: 't', fetchImpl });
  const { linhas, espelhadoEm } = await core.todas('pedidos');
  assert.deepEqual(linhas.map((l) => l.id), [1, 2, 3]);
  assert.equal(espelhadoEm, 'B');
  assert.equal(chamadas.length, 2);
  assert.equal(new URL(chamadas[1].url).searchParams.get('cursor'), 'c2');
});

test('erro: 4xx lanca sem o token na mensagem; 5xx/429 tenta de novo e depois lanca', async () => {
  const f401 = falso(() => resp({}, 401));
  const a = criarClienteCore({ token: 'segredo-x', fetchImpl: f401.fetchImpl, esperar: semEspera });
  await assert.rejects(a.todas('pedidos'), (e) => /401/.test(e.message) && !e.message.includes('segredo-x'));
  assert.equal(f401.chamadas.length, 1);

  let m = 0;
  const f = falso(() => { m++; return m < 3 ? resp({}, 503) : resp({ data: [{ id: 1 }], proximo_cursor: null }); });
  const b = criarClienteCore({ token: 't', fetchImpl: f.fetchImpl, esperar: semEspera });
  assert.equal((await b.todas('pedidos')).linhas.length, 1);

  const sempre = falso(() => resp({}, 429));
  const c = criarClienteCore({ token: 't', fetchImpl: sempre.fetchImpl, esperar: semEspera });
  await assert.rejects(c.todas('pedidos'), /429\/5xx repetido/);
  assert.equal(sempre.chamadas.length, 4);
});

test('todas: resposta sem lista lanca (nunca devolve parcial calado)', async () => {
  const core = criarClienteCore({ token: 't', fetchImpl: falso(() => resp({ erro: 'x' })).fetchImpl });
  await assert.rejects(core.todas('pedidos'), /sem lista/);
});

test('catalogoDoCore: formato de blingProdutos, so ativos, nome cortado em 60', async () => {
  const { fetchImpl, chamadas } = falso(() => resp({
    data: [{ id_bling: 10, codigo: 'A1', descricao: 'x'.repeat(80), preco: '199.90' }, { id_bling: 11, codigo: null, descricao: null, preco: null }],
    proximo_cursor: null,
  }));
  const prod = await catalogoDoCore(criarClienteCore({ token: 't', fetchImpl }));
  assert.deepEqual(prod['10'], { nome: 'x'.repeat(60), codigo: 'A1', preco: 199.9 });
  assert.deepEqual(prod['11'], { nome: '', codigo: '', preco: 0 });
  assert.equal(new URL(chamadas[0].url).searchParams.get('id_situacaocadastro'), '1');
});

function espelho({ produtos, saldos, espelhadoEm = new Date().toISOString(), sincronia }) {
  return falso((u) => {
    if (u.pathname.endsWith('/produtos_bling')) return resp({ data: produtos, proximo_cursor: null });
    assert.equal(u.searchParams.get('deposito_id'), '14888726277');
    return resp({ data: saldos, proximo_cursor: null, espelhado_em: espelhadoEm, ...(sincronia ? { sincronia } : {}) });
  });
}

test('saldoDoDepositoPorSku: SKU -> saldo; SKU sem linha de saldo fica FORA (intocado)', async () => {
  const { fetchImpl } = espelho({
    produtos: [{ id_bling: 1, codigo: 'A' }, { id_bling: 2, codigo: 'B' }, { id_bling: 3, codigo: 'C' }],
    saldos: [{ id_bling: 1, saldo: '10.0000' }, { id_bling: 2, saldo: '0.0000' }],
  });
  const m = await saldoDoDepositoPorSku(criarClienteCore({ token: 't', fetchImpl }),
    { skus: new Set(['A', 'B', 'C', 'Z']), depositoId: '14888726277' });
  assert.deepEqual([...m], [['A', 10], ['B', 0]]);   // C sem saldo e Z desconhecido: fora
});

test('saldoDoDepositoPorSku: espelho sem nenhum saldo do deposito lanca (vazio nao e zero)', async () => {
  const { fetchImpl } = espelho({ produtos: [{ id_bling: 1, codigo: 'A' }], saldos: [] });
  await assert.rejects(saldoDoDepositoPorSku(criarClienteCore({ token: 't', fetchImpl }),
    { skus: new Set(['A']), depositoId: '14888726277' }), /sem saldos/);
});

test('saldoDoDepositoPorSku: idade vem do bloco sincronia e devolve defasado, nao erro', async () => {
  const velho = new Date(Date.now() - 3 * 3600e3).toISOString();
  const mk = (sincronia) => criarClienteCore({ token: 't', fetchImpl: espelho({
    produtos: [{ id_bling: 1, codigo: 'A' }], saldos: [{ id_bling: 1, saldo: 5 }], sincronia }).fetchImpl });
  const args = { skus: new Set(['A']), depositoId: '14888726277' };
  const velha = { ultimo_ok: velho, periodo_s: 900, atrasado: false };
  const m = await saldoDoDepositoPorSku(mk(velha), { ...args, maxIdadeMin: 60 });
  assert.equal(m.get('A'), 5, 'o saldo continua legivel');
  assert.equal(m.defasado, true);
  assert.match(m.motivo, /60 min/);
  assert.equal((await saldoDoDepositoPorSku(mk(velha), { ...args, maxIdadeMin: 0 })).defasado, false, '0 = sem limite');
  assert.equal((await saldoDoDepositoPorSku(mk(velha), { ...args, maxIdadeMin: 600 })).defasado, false);
  assert.equal((await saldoDoDepositoPorSku(mk({ atrasado: true }), args)).defasado, true, 'o core diz atrasado');
  assert.equal((await saldoDoDepositoPorSku(mk({ tempo_real: false }), args)).defasado, true, 'webhook mudo');
});

test('saldoDoDepositoPorSku: SEM bloco sincronia nao acusa, mesmo com espelhado_em velho e limite ligado', async () => {
  const velho = new Date(Date.now() - 30 * 24 * 3600e3).toISOString();
  const core = criarClienteCore({ token: 't', fetchImpl: espelho({
    produtos: [{ id_bling: 1, codigo: 'A' }], saldos: [{ id_bling: 1, saldo: 5 }], espelhadoEm: velho }).fetchImpl });
  const m = await saldoDoDepositoPorSku(core, { skus: new Set(['A']), depositoId: '14888726277', maxIdadeMin: 1 });
  assert.equal(m.defasado, false);
  assert.equal(idadeDoEspelho(null, { maxIdadeMin: 1 }).semSincronia, true);
});

test('limiteDeIdadeMin: numero vale para todas; tabela=min por tabela; torto vira 0', () => {
  assert.equal(limiteDeIdadeMin({}, 'x'), 0);
  assert.equal(limiteDeIdadeMin({ CORE_ESPELHO_MAX_IDADE_MIN: '30' }, 'x'), 30);
  const env = { CORE_ESPELHO_MAX_IDADE_MIN: 'estoque_depositos=2160, shopify_pedidos=30, 60' };
  assert.equal(limiteDeIdadeMin(env, 'estoque_depositos'), 2160);
  assert.equal(limiteDeIdadeMin(env, 'shopify_pedidos'), 30);
  assert.equal(limiteDeIdadeMin(env, 'contatos'), 60, 'o número solto é o padrão');
  assert.equal(limiteDeIdadeMin({ CORE_ESPELHO_MAX_IDADE_MIN: 'abc,x=-5' }, 'x'), 0);
});

// Core LENTO/pendurado: sem prazo o robô ficava parado até o limite do wrapper (30 min) sem dizer nada.
test('core lento: fetch que nunca responde e abortado pelo prazo e lanca erro claro', async () => {
  // timer com ref: o fetch de verdade mantém o loop vivo; o falso precisa fazer o mesmo (AbortSignal.timeout é unref).
  const pendurado = (_url, init) => new Promise((_, rej) => {
    const vivo = setTimeout(() => {}, 5000);
    init.signal.addEventListener('abort', () => { clearTimeout(vivo); rej(init.signal.reason); });
  });
  const core = criarClienteCore({ token: 't', fetchImpl: pendurado, prazoMs: 20, esperar: semEspera });
  await assert.rejects(core.todas('pedidos'), (e) => /prazo|timeout|abort/i.test(`${e.name} ${e.message}`));
});

test('core fora (conexao recusada): lanca, nunca devolve lista vazia', async () => {
  const core = criarClienteCore({ token: 't', fetchImpl: async () => { throw new TypeError('fetch failed'); }, esperar: semEspera });
  await assert.rejects(core.todas('pedidos'), /fetch failed/);
});

test('core 200 com corpo que nao e JSON: lanca', async () => {
  const f = falso(() => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('Unexpected token <'); } }));
  const core = criarClienteCore({ token: 't', fetchImpl: f.fetchImpl, esperar: semEspera });
  await assert.rejects(core.todas('pedidos'), /Unexpected token/);
});

test('consumidor do espelho: CORE_ESPELHO_TOKEN vence CORE_API_TOKEN; sem ele, o de sempre', async () => {
  const { fetchImpl, chamadas } = falso(() => resp({ data: [], proximo_cursor: null }));
  await clienteDoAmbiente({ CORE_API_TOKEN: 'a', CORE_ESPELHO_TOKEN: 'b' }, { fetchImpl }).todas('contatos');
  await clienteDoAmbiente({ CORE_API_TOKEN: 'a' }, { fetchImpl }).todas('contatos');
  assert.deepEqual(chamadas.map((c) => c.init.headers.Authorization), ['Bearer b', 'Bearer a']);
});
