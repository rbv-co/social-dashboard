import test from 'node:test';
import assert from 'node:assert/strict';
import { passo, ensaio, resumo, TETO_TENTATIVAS } from './vessel-contatos-no-bling.mjs';
import { coreFalso, resp } from './lib/core-falso-do-bling.mjs';

const semEspera = () => Promise.resolve();
const DDL = `create table vessel_lista_espera (id bigserial primary key, nome text not null, email text not null, whatsapp text not null,
  origem text not null default 'lp-vesselbrasil', criado_em timestamptz not null default now(), bling_id text, bling_em timestamptz,
  planilha_em timestamptz, ultimo_erro text);
  create unique index on vessel_lista_espera (lower(email));`;

async function mundo(linhas = 3) {
  const { default: pg } = await import('pg');
  const admin = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL });
  await admin.connect();
  const nome = 'contatos_' + Math.random().toString(16).slice(2, 10);
  await admin.query(`create database ${nome}`);
  const u = new URL(process.env.TEST_DATABASE_URL); u.pathname = '/' + nome;
  const cli = new pg.Client({ connectionString: u.toString() }), cli2 = new pg.Client({ connectionString: u.toString() });
  await cli.connect(); await cli2.connect();
  await cli.query(DDL);
  for (let i = 1; i <= linhas; i++) await cli.query(`insert into vessel_lista_espera (nome, email, whatsapp) values ($1, $2, '19999990000')`, [`Pessoa ${i}`, `p${i}@prova.com`]);
  const ler = async () => (await cli.query('select id, bling_id, bling_em is not null as marcada, ultimo_erro from vessel_lista_espera order by id')).rows;
  const fim = async () => { await cli.end(); await cli2.end(); await admin.query(`drop database ${nome} with (force)`); await admin.end(); };
  return { cli, cli2, ler, fim };
}
const pula = { skip: !process.env.TEST_DATABASE_URL };

test('leva cada linha ao Bling uma vez; a segunda passada não chama o Bling', pula, async () => {
  const m = await mundo(3);
  try {
    const core = coreFalso();
    const r = await passo(m.cli, core, { espera: semEspera });
    assert.equal(r.criados, 3);
    assert.ok((await m.ler()).every((l) => l.bling_id && l.marcada && l.ultimo_erro === null));
    const n = core.chamadas.length;
    const r2 = await passo(m.cli, core, { espera: semEspera });
    assert.equal(r2.criados + r2.reaproveitados, 0);
    assert.equal(core.chamadas.length, n, 'nada a fazer = nenhuma chamada');
  } finally { await m.fim(); }
});

test('o erro do Zoho na linha não é apagado pelo sucesso do Bling; o do Bling é', pula, async () => {
  const m = await mundo(2);
  try {
    await m.cli.query(`update vessel_lista_espera set ultimo_erro = 'A Central não está conectada ao Zoho' where id = 1`);
    await m.cli.query(`update vessel_lista_espera set ultimo_erro = 'bling tentativa 2/5: x' where id = 2`);
    await passo(m.cli, coreFalso(), { espera: semEspera });
    const [a, b] = await m.ler();
    assert.match(a.ultimo_erro, /Zoho/);
    assert.equal(b.ultimo_erro, null);
  } finally { await m.fim(); }
});

test('429 para o lote e não grava nada na linha; reautorização idem', pula, async () => {
  const m = await mundo(3);
  try {
    const r = await passo(m.cli, coreFalso({ falhas: { 'POST /contatos': resp(429) } }), { espera: semEspera });
    assert.equal(r.pausa, '429');
    assert.ok((await m.ler()).every((l) => !l.bling_id && l.ultimo_erro === null));
  } finally { await m.fim(); }
});

test('falha temporária conta tentativa e desiste no teto; incerto e recusa não voltam sozinhos', pula, async () => {
  const m = await mundo(3);
  try {
    await m.cli.query(`update vessel_lista_espera set email = 'dois@prova.com' where id = 2`);
    // cada linha falha de um jeito: o Core falso decide pela ordem das chamadas POST
    const core = coreFalso({ falhas: { 'POST /contatos': (() => { let n = 0; return () => { n++; return n % 3 === 1 ? resp(502) : n % 3 === 2 ? resp(504, {}, { incerto: true }) : resp(400, { error: { description: 'ruim' } }); }; })() } });
    const r1 = await passo(m.cli, core, { espera: semEspera });
    assert.deepEqual([r1.tenta, r1.incertos, r1.definitivos], [1, 1, 1]);
    const [a, b, c] = await m.ler();
    assert.match(a.ultimo_erro, /^bling tentativa 1\/5/);
    assert.match(b.ultimo_erro, /^bling incerto: .*conferir/);
    assert.match(c.ultimo_erro, /^bling definitivo: /);
    // só a primeira volta; as outras duas ficam como estão
    const volta = coreFalso({ falhas: { 'POST /contatos': resp(502) } });
    for (let i = 2; i <= TETO_TENTATIVAS; i++) await passo(m.cli, volta, { espera: semEspera });
    assert.match((await m.ler())[0].ultimo_erro, new RegExp(`^bling tentativa ${TETO_TENTATIVAS}/${TETO_TENTATIVAS}`));
    const n = volta.chamadas.length;
    await passo(m.cli, volta, { espera: semEspera });
    assert.equal(volta.chamadas.length, n, 'no teto, ninguém é chamado (as 3 linhas estão paradas)');
  } finally { await m.fim(); }
});

test('duas instâncias ao mesmo tempo criam um contato só por pessoa', pula, async () => {
  const m = await mundo(6);
  try {
    const core = coreFalso();
    const [a, b] = await Promise.all([passo(m.cli, core, { espera: semEspera }), passo(m.cli2, core, { espera: semEspera })]);
    assert.equal(a.criados + b.criados, 6);
    assert.equal(core.criados.size, 6, 'seis chaves, seis contatos');
    assert.ok((await m.ler()).every((l) => l.bling_id));
  } finally { await m.fim(); }
});

test('--id leva só as linhas pedidas; o ensaio só conta', pula, async () => {
  const m = await mundo(4);
  try {
    assert.deepEqual(await ensaio(m.cli, { ids: [2, 3] }), [{ origem: 'lp-vesselbrasil', n: 2 }]);
    const core = coreFalso();
    const r = await passo(m.cli, core, { ids: [2, 3], espera: semEspera });
    assert.equal(r.criados, 2);
    assert.deepEqual((await m.ler()).map((l) => !!l.bling_id), [false, true, true, false]);
    assert.deepEqual(await ensaio(m.cli), [{ origem: 'lp-vesselbrasil', n: 2 }]);
  } finally { await m.fim(); }
});

test('o limite por rodada vale e o resumo não traz dado pessoal', pula, async () => {
  const m = await mundo(5);
  try {
    const r = await passo(m.cli, coreFalso(), { limite: 2, espera: semEspera });
    assert.equal(r.criados, 2);
    assert.doesNotMatch(resumo(r), /@/);
  } finally { await m.fim(); }
});
