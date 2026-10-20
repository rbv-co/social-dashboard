import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { lerPelaPg, conexaoPelaPg, passo, semResposta, servir, ROBO } from './espelho-da-vessel-na-vps.mjs';

test('a leitura recusa tabela e colunas fora do formato (nada de SQL vindo da consulta)', async () => {
  const cli = { query: async () => { throw new Error('não devia consultar'); } };
  const ler = lerPelaPg(cli);
  for (const c of [{ tabela: 'a; drop table x', colunas: '*' }, { tabela: 'a', colunas: 'id, (select 1)' }, { tabela: 'A', colunas: 'id' }, { tabela: 'a', colunas: '' }]) {
    await assert.rejects(ler(c), /consulta recusada/);
  }
});

test('a conexão do Zoho sem refresh_token é erro claro', async () => {
  await assert.rejects(conexaoPelaPg({ query: async () => ({ rows: [] }) })(), /não está conectada ao Zoho/);
});

const DDL = `create table disparos_pendentes (id bigserial primary key, robo text not null, corpo jsonb not null default '{}',
  situacao text not null default 'pendente', pedidos int not null default 1, criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(), erro text);
  create unique index on disparos_pendentes (robo) where situacao = 'pendente';
  create table pessoas (id int primary key, nome text, criado_em timestamptz, valor numeric(10,2));
  insert into pessoas values (1, 'Ana', '2026-01-02T10:00:00Z', 12.50);`;

async function mundo() {
  const { default: pg } = await import('pg');
  const admin = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL });
  await admin.connect();
  const nome = 'espelho_' + Math.random().toString(16).slice(2, 10);
  await admin.query(`create database ${nome}`);
  const u = new URL(process.env.TEST_DATABASE_URL); u.pathname = '/' + nome;
  const cli = new pg.Client({ connectionString: u.toString() });
  const cli2 = new pg.Client({ connectionString: u.toString() });
  await cli.connect(); await cli2.connect();
  await cli.query(DDL);
  const pede = (n = 1) => cli.query(`insert into disparos_pendentes (robo, pedidos) values ($1, $2) on conflict (robo) where situacao = 'pendente' do update set pedidos = disparos_pendentes.pedidos + $2`, [ROBO, n]);
  const envelhece = (min) => cli.query(`update disparos_pendentes set atualizado_em = now() - make_interval(mins => $1::int) where situacao <> 'pendente'`, [min]);
  const fim = async () => { await cli.end(); await cli2.end(); await admin.query(`drop database ${nome} with (force)`); await admin.end(); };
  return { cli, cli2, pede, envelhece, fim };
}

test('o passo atende o pedido uma vez, respeita o intervalo e não repete falha', { skip: !process.env.TEST_DATABASE_URL }, async () => {
  const m = await mundo();
  try {
    let chamadas = 0, falha = null;
    const executar = async () => { chamadas++; if (falha) throw falha; };
    assert.equal(await passo(m.cli, executar), 'sem_pedido');
    assert.equal(chamadas, 0);
    await m.pede(50);
    assert.equal(await passo(m.cli, executar), 'feito');
    assert.equal(chamadas, 1);
    assert.equal((await m.cli.query(`select situacao, pedidos from disparos_pendentes`)).rows[0].pedidos, 50, 'os 50 pedidos viraram um atendimento');
    await m.pede(3);
    assert.equal(await passo(m.cli, executar), 'cedo', 'dentro do intervalo o pedido espera');
    await m.envelhece(6);
    falha = new Error('zoho recusou');
    assert.equal(await passo(m.cli, executar), 'falhou');
    assert.equal((await m.cli.query(`select erro from disparos_pendentes where situacao = 'falhou'`)).rows[0].erro, 'zoho recusou');
    await m.envelhece(10);
    assert.equal(await passo(m.cli, executar), 'sem_pedido', 'a falha não volta sozinha à fila');
    assert.equal(chamadas, 2);
    // atendimento que morreu no meio vira incerto e nunca roda de novo
    await m.pede(1);
    await m.cli.query(`insert into disparos_pendentes (robo, situacao, atualizado_em) values ($1, 'atendendo', now() - interval '31 minutes')`, [ROBO]);
    await m.envelhece(0);
    await m.cli.query(`update disparos_pendentes set atualizado_em = now() - interval '31 minutes' where situacao = 'atendendo'`);
    falha = null;
    await passo(m.cli, executar);
    assert.equal((await m.cli.query(`select count(*)::int n from disparos_pendentes where situacao = 'incerto'`)).rows[0].n, 1);
  } finally { await m.fim(); }
});

test('timeout ou queda de rede vira incerto (nunca presume falha) e a mensagem chega a aoErro; pedido de 30+ dias sai', { skip: !process.env.TEST_DATABASE_URL }, async () => {
  const m = await mundo();
  try {
    const msgs = [];
    const aoErro = (e) => msgs.push(e);
    await m.pede(1);
    const t = new Error('prazo'); t.name = 'TimeoutError';
    assert.equal(await passo(m.cli, async () => { throw t; }, { aoErro }), 'incerto');
    assert.equal((await m.cli.query(`select count(*)::int n from disparos_pendentes where situacao = 'incerto'`)).rows[0].n, 1);
    assert.deepEqual(msgs, ['prazo']);
    assert.equal(semResposta(new TypeError('fetch failed')), true);
    assert.equal(semResposta(new Error('zoho recusou')), false);
    await m.cli.query(`update disparos_pendentes set atualizado_em = now() - interval '31 days'`);
    await passo(m.cli, async () => {});
    assert.equal((await m.cli.query(`select count(*)::int n from disparos_pendentes`)).rows[0].n, 0);
  } finally { await m.fim(); }
});

test('dois passos ao mesmo tempo: uma rodada só', { skip: !process.env.TEST_DATABASE_URL }, async () => {
  const m = await mundo();
  try {
    let chamadas = 0;
    const executar = async () => { chamadas++; await new Promise((r) => setTimeout(r, 100)); };
    await m.pede(1);
    const r = await Promise.all([passo(m.cli, executar), passo(m.cli2, executar)]);
    assert.equal(chamadas, 1, JSON.stringify(r));
  } finally { await m.fim(); }
});

test('a leitura sai no formato do PostgREST (ISO e numeric como número)', { skip: !process.env.TEST_DATABASE_URL }, async () => {
  const m = await mundo();
  try {
    const [l] = await lerPelaPg(m.cli)({ tabela: 'pessoas', colunas: 'id,nome,criado_em,valor' });
    assert.deepEqual(l, { id: 1, nome: 'Ana', criado_em: '2026-01-02T10:00:00+00:00', valor: 12.50 });
    assert.deepEqual((await lerPelaPg(m.cli)({ tabela: 'pessoas', colunas: '*' }))[0].id, 1);
  } finally { await m.fim(); }
});

// Cliente falso: nada toca produção. `end()` dispara 'end' como o pg.Client de verdade.
function clienteFalso() {
  const cli = new EventEmitter();
  cli.consultas = [];
  cli.query = async (sql) => { cli.consultas.push(sql); return { rows: [{ espera: false, recente: false }], rowCount: 0 }; };
  cli.end = async () => { cli.emit('end'); };
  return cli;
}

test('--uma-vez dá um passo, fecha a conexão sem tratar o fim como queda (não sai com 1) e não reentra no laço', async () => {
  const cli = clienteFalso(), saidas = [];
  const t0 = Date.now();
  await servir(cli, async () => {}, { umaVez: true, sair: (c) => saidas.push(c), esperaS: 60 });
  assert.deepEqual(saidas, []);
  assert.ok(Date.now() - t0 < 10_000, 'não esperou o intervalo do laço');
  assert.equal(cli.consultas.filter((q) => /insert into robos_execucoes/.test(q)).length, 1, 'um passo só');
});

test('no laço, a conexão que cai (end sem sinal) ainda derruba o processo com 1', async () => {
  const cli = clienteFalso(), saidas = [];
  const rodando = servir(cli, async () => {}, { sair: (c) => saidas.push(c), esperaS: 60 });
  await new Promise((r) => setTimeout(r, 100));
  cli.emit('end');
  assert.deepEqual(saidas, [1]);
  process.emit('SIGTERM'); // encerra o laço do teste
  await rodando;
});
