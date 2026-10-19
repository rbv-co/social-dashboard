import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { abrirDados, modoPg } from './cartoes-dados.mjs';

// Client falso: `respostas` mapeia um trecho do SQL para o que devolver (ou uma função que lança); conta conexões abertas/fechadas.
function clienteFalso(respostas = {}) {
  const e = { consultas: [], abertas: 0, fechadas: 0 };
  class Client extends EventEmitter {
    async connect() { if (e.falharConexao?.()) throw Object.assign(new Error('ECONNREFUSED'), { code: 'ECONNREFUSED' }); e.abertas++; }
    async query(sql, v) {
      const s = sql.replace(/\s+/g, ' ').trim();
      e.consultas.push([s, v]);
      const k = Object.keys(respostas).find((t) => s.includes(t));
      const r = k ? respostas[k] : { rows: [] };
      return typeof r === 'function' ? r(s, v) : r;
    }
    async end() { e.fechadas++; }
  }
  return { Client, e };
}
const ENV = { CARTOES_DATABASE_URL: 'postgres://robo_cartoes@10.0.0.2:5432/api' };
const semEsperar = { esperar: async () => {} };

test('sem CARTOES_DATABASE_URL fica no REST (rollback) e exige as chaves do Supabase', async () => {
  assert.equal(modoPg({}), false);
  await assert.rejects(() => abrirDados({}), /faltam SUPABASE_URL/);
  assert.equal((await abrirDados({ SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_KEY: 'k' })).via, 'rest');
});

test('URL do pg apontando para o Supabase é recusada', () => {
  assert.throws(() => modoPg({ CARTOES_DATABASE_URL: 'postgres://u@db.abc.supabase.co/postgres' }), /aponta para o Supabase/);
});

test('REST: o fetch recebe exatamente o que o robô mandava antes', async () => {
  const chamadas = [];
  const fetchOriginal = globalThis.fetch;
  globalThis.fetch = async (url, o = {}) => { chamadas.push([url, o.method || 'GET', o.body]); return new Response('{"ok":true,"pedido":null}', { status: 200 }); };
  try {
    const d = await abrirDados({ SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_KEY: 'k' });
    assert.deepEqual(await d.rpc('vessel_cartao_pegar_da_fila'), { ok: true, pedido: null });
    await d.pedidosAbertos();
    await d.naFila(2);
    assert.deepEqual(chamadas.map((c) => c.slice(0, 2)), [
      ['https://x.supabase.co/rest/v1/rpc/vessel_cartao_pegar_da_fila', 'POST'],
      ['https://x.supabase.co/rest/v1/vessel_cartao_pedidos?situacao=in.(na_fila,rodando)&select=id,situacao,criado_em,pecas&order=criado_em', 'GET'],
      ['https://x.supabase.co/rest/v1/vessel_cartao_pedidos?situacao=eq.na_fila&select=id&limit=2', 'GET'],
    ]);
  } finally { globalThis.fetch = fetchOriginal; }
});

test('pg: RPC chama só a função da lista, com parâmetros tipados, e devolve o JSON da função', async () => {
  const { Client, e } = clienteFalso({ pegar_da_fila: { rows: [{ r: { ok: true, pedido: { id: 'p1', pecas: ['A'] } } }] } });
  const d = await abrirDados(ENV, { Client, ...semEsperar });
  assert.deepEqual(await d.rpc('vessel_cartao_pegar_da_fila'), { ok: true, pedido: { id: 'p1', pecas: ['A'] } });
  assert.equal(e.consultas[0][0], 'select public.vessel_cartao_pegar_da_fila() as r');
  await assert.rejects(() => d.rpc('vessel_qualquer_outra'), /fora da lista/);
  assert.equal(e.abertas, e.fechadas); // nenhuma conexão vaza
});

test('pg: pedido_terminou leva os 5 parâmetros na ordem e p_pecas como array', async () => {
  const { Client, e } = clienteFalso({ pedido_terminou: { rows: [{ r: { ok: true, marcadas: 2 } }] } });
  const d = await abrirDados(ENV, { Client, ...semEsperar });
  const r = await d.rpc('vessel_cartao_pedido_terminou', { p_pedido: 'u1', p_ok: true, p_pasta: 'P', p_erro: null, p_pecas: ['A', 'B'] });
  assert.equal(r.marcadas, 2);
  assert.match(e.consultas[0][0], /\$1::uuid, \$2::boolean, \$3::text, \$4::text, \$5::text\[\]/);
  assert.deepEqual(e.consultas[0][1], ['u1', true, 'P', null, ['A', 'B']]);
});

test('pg: banco fora na devolução tenta de novo e o pedido NÃO se perde; erro SQL não repete', async () => {
  const { Client, e } = clienteFalso({ pedido_terminou: { rows: [{ r: { ok: true, marcadas: 1 } }] } });
  let falhas = 2;
  e.falharConexao = () => falhas-- > 0;
  const d = await abrirDados(ENV, { Client, ...semEsperar });
  assert.equal((await d.rpc('vessel_cartao_pedido_terminou', { p_pedido: 'u1', p_ok: true, p_pecas: ['A'] })).marcadas, 1);
  assert.equal(e.consultas.length, 1); // só a terceira tentativa chegou à query

  const sql = clienteFalso({ pedido_terminou: () => { throw Object.assign(new Error('permission denied'), { code: '42501' }); } });
  const d2 = await abrirDados(ENV, { Client: sql.Client, ...semEsperar });
  await assert.rejects(() => d2.rpc('vessel_cartao_pedido_terminou', { p_pedido: 'u1', p_ok: true, p_pecas: [] }), /42501/);
  assert.equal(sql.e.consultas.length, 1);
});

test('pg: pegar_da_fila NUNCA repete (repetir pegaria um segundo pedido)', async () => {
  const { Client, e } = clienteFalso();
  e.falharConexao = () => true;
  const d = await abrirDados(ENV, { Client, ...semEsperar });
  await assert.rejects(() => d.rpc('vessel_cartao_pegar_da_fila'), /ECONNREFUSED|sem conexão/);
  assert.equal(e.consultas.length, 0);
});

test('pg: leituras voltam no mesmo formato do PostgREST (vessel_lotes aninhado) e usam row_to_json', async () => {
  const linha = { codigo: 'A1', numero_na_serie: 3, vessel_lotes: { sku: 'SKU' } };
  const { Client, e } = clienteFalso({ vessel_pecas: { rows: [{ j: JSON.stringify(linha) }] } });
  const d = await abrirDados(ENV, { Client, ...semEsperar });
  assert.deepEqual(await d.pecas(['A1']), [linha]);
  assert.match(e.consultas[0][0], /^select row_to_json\(t\)::text as j from \(select p\.codigo/);
  assert.deepEqual(e.consultas[0][1], [['A1']]);
});

test('pg: guardarIds é um upsert idempotente em uma única consulta (rodar 2 vezes dá o mesmo)', async () => {
  const { Client, e } = clienteFalso();
  const d = await abrirDados(ENV, { Client, ...semEsperar });
  const l = [{ codigo: 'A', nome: 'a.png', zoho_id: 'z1', pasta_id: 'p', atualizado_em: '2026-10-18T10:00:00Z' }, { codigo: 'A', nome: 'b.png', zoho_id: 'z2', pasta_id: 'p', atualizado_em: '2026-10-18T10:00:00Z' }];
  await d.guardarIds(l); await d.guardarIds(l);
  assert.equal(e.consultas.length, 2);
  assert.match(e.consultas[0][0], /on conflict \(codigo, nome\) do update/);
  assert.deepEqual(e.consultas[0][1][0], ['A', 'A']);
  assert.deepEqual(e.consultas[0], e.consultas[1]);
});

test('pg: conexaoZoho lê acessos_conexoes e acusa Zoho desconectado', async () => {
  const ok = clienteFalso({ acessos_conexoes: { rows: [{ client_id: 'c', client_secret: 's', refresh_token: 'r', data_center: '.com' }] } });
  assert.equal((await (await abrirDados(ENV, { Client: ok.Client })).conexaoZoho()).refresh_token, 'r');
  const vazio = clienteFalso();
  await assert.rejects(async () => (await abrirDados(ENV, { Client: vazio.Client })).conexaoZoho(), /não está conectada ao Zoho/);
  assert.equal(vazio.e.abertas, vazio.e.fechadas);
});
