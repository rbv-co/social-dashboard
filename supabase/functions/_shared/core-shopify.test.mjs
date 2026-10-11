import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { criarClienteCore } from './core-leitura.js';
import {
  shopifyLeituraLigada, graphqlPeloCore, variantesDoSiteViaCore, pedidosDoEspelho, SQL_UPSERT_PEDIDO_SEM_PII,
} from './core-shopify.js';

const resp = (corpo, status = 200) => ({ ok: status < 400, status, json: async () => corpo });
const semEspera = () => Promise.resolve();

test('flag: só "true"/"1" ligam; ausente é desligada (padrão)', () => {
  assert.equal(shopifyLeituraLigada({}), false);
  assert.equal(shopifyLeituraLigada({ CORE_SHOPIFY_LEITURA: 'false' }), false);
  assert.equal(shopifyLeituraLigada({ CORE_SHOPIFY_LEITURA: '' }), false);
  assert.equal(shopifyLeituraLigada({ CORE_SHOPIFY_LEITURA: ' TRUE ' }), true);
  assert.equal(shopifyLeituraLigada({ CORE_SHOPIFY_LEITURA: '1' }), true);
});

test('proxy: POST graphql com Bearer; erro não vaza o token; 429 repete', async () => {
  assert.throws(() => graphqlPeloCore({}), /CORE_API_TOKEN/);
  const vistos = [];
  let n = 0;
  const fetchImpl = async (url, init) => { vistos.push({ url, init }); return ++n === 1 ? resp({}, 429) : resp({ data: { ok: 1 } }); };
  const gql = graphqlPeloCore({ token: 'segredo-x', fetchImpl, esperar: semEspera });
  assert.deepEqual(await gql('query{ a }', { x: 1 }), { ok: 1 });
  assert.equal(vistos[1].url, 'https://core.rbvcompany.com/api/interno/shopify/proxy');
  assert.equal(vistos[1].init.headers.Authorization, 'Bearer segredo-x');
  assert.deepEqual(JSON.parse(vistos[1].init.body), { tipo: 'graphql', query: 'query{ a }', variaveis: { x: 1 } });
  const ruim = graphqlPeloCore({ token: 'segredo-x', fetchImpl: async () => resp({ erro: 'fora_da_allow_list' }, 403) });
  await assert.rejects(ruim('q'), (e) => /403/.test(e.message) && !/segredo-x/.test(e.message));
});

const no = (sku, tracked, lvl) => ({ sku, displayName: `n ${sku}`, inventoryItem: { id: `i/${sku}`, tracked, inventoryLevel: lvl } });
const nivel = (nome, q) => ({ location: { name: nome }, quantities: [{ quantity: q }] });

test('variantes via proxy: pagina, ignora não-rastreada, mesmo formato de variantesDoShopify', async () => {
  const paginas = [
    { productVariants: { pageInfo: { hasNextPage: true, endCursor: 'c1' }, nodes: [no('A', true, nivel('L', 3)), no('B', false, null)] } },
    { productVariants: { pageInfo: { hasNextPage: false }, nodes: [no('C', true, null)] } },
  ];
  const afters = [];
  const gql = async (q, v) => { afters.push(v.after); return paginas.shift(); };
  const out = await variantesDoSiteViaCore(gql, { local: 'l/1', nomeLocal: 'L', comNome: true });
  assert.deepEqual(afters, [null, 'c1']);
  assert.deepEqual(out, [
    { sku: 'A', inventoryItemId: 'i/A', noLocal: true, disponivel: 3, nome: 'n A' },
    { sku: 'C', inventoryItemId: 'i/C', noLocal: false, disponivel: null, nome: 'n C' },
  ]);
});

test('variantes via proxy: local com nome trocado lança (trava de antes)', async () => {
  const gql = async () => ({ productVariants: { pageInfo: { hasNextPage: false }, nodes: [no('A', true, nivel('Outro', 1))] } });
  await assert.rejects(variantesDoSiteViaCore(gql, { local: 'x', nomeLocal: 'L' }), /mudou de nome/);
});

test('pedidos do espelho: só os atualizados na janela, formato de shopify_pedidos, sem PII', async () => {
  let pedido;
  const fetchImpl = async (url) => {
    pedido = String(url);
    return resp({ proximo_cursor: null, data: [
      { shopify_id: 11, nome: '#1001', status_financeiro: 'paid', total: '199.90', moeda: 'BRL', criado_em: '2026-10-01 12:00:00', atualizado_em: '2026-10-07 10:00:00' },
      { shopify_id: 12, nome: '#1002', status_financeiro: null, total: null, moeda: null, criado_em: '2026-10-07 23:30:00', atualizado_em: '2026-10-08 01:00:00' },
      { shopify_id: 13, nome: '#1000', status_financeiro: 'paid', total: '5', moeda: 'BRL', criado_em: '2026-08-01 00:00:00', atualizado_em: '2026-08-02 00:00:00' },
      { shopify_id: 14, nome: '#9', status_financeiro: 'paid', total: '5', moeda: 'BRL', criado_em: null, atualizado_em: null },
    ] });
  };
  const core = criarClienteCore({ token: 't', fetchImpl });
  const out = await pedidosDoEspelho(core, { desde: new Date('2026-10-05T00:00:00Z') });
  assert.match(pedido, /\/api\/interno\/espelho\/shopify_pedidos\?/);
  assert.deepEqual(out.map((p) => p.id), [11, 12]);
  assert.deepEqual(out[0], { id: 11, numero: '#1001', loja_id: 205512275, total: 199.9, moeda: 'BRL',
    status_financeiro: 'paid', criado_em_shopify: '2026-10-01T12:00:00Z' });
  assert.equal(out[1].status_financeiro, 'pending');
  assert.equal(out[1].total, 0);
  assert.ok(!('cliente_nome' in out[0]) && !('bruto' in out[0]));
});

test('SQL do espelho nunca sobrescreve cliente_nome/cliente_email/bruto em linha existente', () => {
  const [, aoConflitar] = SQL_UPSERT_PEDIDO_SEM_PII.split('do update set');
  assert.doesNotMatch(aoConflitar, /cliente_|bruto/);
});

test('flag desligada: coletor e edge só desviam por flag (caminho antigo intacto)', () => {
  const ped = readFileSync(new URL('../../../coletor/trazer-pedidos-da-shopify.mjs', import.meta.url), 'utf8');
  assert.match(ped, /DO_CORE \? null : await tokenShopify/);
  assert.match(ped, /DO_CORE \? null : await shopifyPedidos/);
  const edge = readFileSync(new URL('../estoque-do-site/index.ts', import.meta.url), 'utf8');
  assert.match(edge, /shopifyLeituraLigada\(env\)\s*\n\s*\? await variantesDoSiteViaCore[^\n]*\n\s*: await variantesDoShopify\(tShop\)/);
});

test('pedidos do espelho: espelho VAZIO lanca (vazio nao e "nenhum pedido"); janela sem pedido e ok', async () => {
  const vazio = criarClienteCore({ token: 't', fetchImpl: async () => resp({ proximo_cursor: null, data: [] }) });
  await assert.rejects(pedidosDoEspelho(vazio, { desde: new Date('2026-10-05T00:00:00Z') }), /espelho .*vazio|sem pedidos/i);

  const antigo = criarClienteCore({ token: 't', fetchImpl: async () => resp({ proximo_cursor: null, data: [
    { shopify_id: 1, nome: '#1', status_financeiro: 'paid', total: '1', moeda: 'BRL', criado_em: '2026-08-01 00:00:00', atualizado_em: '2026-08-02 00:00:00' }] }) });
  assert.deepEqual(await pedidosDoEspelho(antigo, { desde: new Date('2026-10-05T00:00:00Z') }), []);
});

test('proxy do core lento: fetch pendurado e abortado pelo prazo', async () => {
  // timer com ref: o fetch de verdade mantém o loop vivo; o falso precisa fazer o mesmo (AbortSignal.timeout é unref).
  const pendurado = (_url, init) => new Promise((_, rej) => {
    const vivo = setTimeout(() => {}, 5000);
    init.signal.addEventListener('abort', () => { clearTimeout(vivo); rej(init.signal.reason); });
  });
  const graphql = graphqlPeloCore({ token: 't', fetchImpl: pendurado, prazoMs: 20, esperar: semEspera });
  await assert.rejects(graphql('{ shop { name } }'), (e) => /prazo|timeout|abort/i.test(`${e.name} ${e.message}`));
});
