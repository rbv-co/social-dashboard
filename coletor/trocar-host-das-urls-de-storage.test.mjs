import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseHostNovo, expressao, achar, aplicar } from './trocar-host-das-urls-de-storage.mjs';

test('host novo: só origem https', () => {
  assert.equal(parseHostNovo('https://api.exemplo.com'), 'https://api.exemplo.com');
  assert.equal(parseHostNovo('https://api.exemplo.com/'), 'https://api.exemplo.com');
  for (const ruim of ['http://api.exemplo.com', 'api.exemplo.com', 'https://api.exemplo.com/x', 'https://u:s@api.exemplo.com', 'https://a.com?x=1', '']) {
    assert.throws(() => parseHostNovo(ruim), undefined, ruim);
  }
});

test('a expressão usa o host como parâmetro (nunca no texto) e trata jsonb pelo texto', () => {
  assert.match(expressao('url', 'text', 'x'), /regexp_replace\("url", '.*', \$1 \|\| '\\1', 'g'\)/);
  assert.match(expressao('dados', 'jsonb', 'x'), /^\(regexp_replace\("dados"::text,.*\)::jsonb$/);
  assert.ok(!expressao('url', 'text', 'https://api.exemplo.com').includes('api.exemplo.com'));
});

// roda na VPS, que tem Node 20 (ensaio da virada, 14/10: Map.groupBy derrubou o --aplicar com "is not a function")
test('não usa API do Node 21+ (a VPS roda Node 20)', () => {
  const fonte = readFileSync(new URL('./trocar-host-das-urls-de-storage.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(fonte, /\b(Map|Object)\.groupBy\b|Promise\.withResolvers|Array\.fromAsync/);
});

// com banco de verdade (TEST_DATABASE_URL): acha, faz backup, troca só o host, não toca no que não é do Storage
test('troca o host no banco, com backup, e não mexe no resto', { skip: !process.env.TEST_DATABASE_URL }, async () => {
  const { default: pg } = await import('pg');
  const admin = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL });
  await admin.connect();
  const nome = 'trocar_host_' + Math.random().toString(16).slice(2, 10);
  await admin.query(`create database ${nome}`);
  const url = new URL(process.env.TEST_DATABASE_URL); url.pathname = '/' + nome;
  const cli = new pg.Client({ connectionString: url.toString() });
  await cli.connect();
  try {
    await cli.query(`create table fotos (id int primary key, url text, outro text);
      create table blocos (id int primary key, dados jsonb);
      create table sem_url (id int primary key, nota text);
      insert into fotos values (1, 'https://kounq.supabase.co/storage/v1/object/public/avatars/a.png', 'https://kounq.supabase.co/rest/v1/x'),
        (2, 'https://exemplo.com/a.png', null), (3, null, null);
      insert into blocos values (1, '{"capa": "https://abc-def.supabase.co/storage/v1/object/public/conteudo/x.jpg", "n": 3}'::jsonb);
      insert into sem_url values (1, 'sem nada')`);
    const achadas = await achar(cli);
    assert.deepEqual(achadas.map((a) => `${a.tabela}.${a.coluna}:${a.linhas}`).sort(), ['blocos.dados:1', 'fotos.url:1']);
    await aplicar(cli, achadas, 'https://api.exemplo.com', '202610141200');
    const { rows: [f] } = await cli.query(`select url, outro from fotos where id = 1`);
    assert.equal(f.url, 'https://api.exemplo.com/storage/v1/object/public/avatars/a.png');
    assert.equal(f.outro, 'https://kounq.supabase.co/rest/v1/x', 'só o Storage muda: a URL de REST fica');
    const { rows: [b] } = await cli.query(`select dados from blocos`);
    assert.deepEqual(b.dados, { capa: 'https://api.exemplo.com/storage/v1/object/public/conteudo/x.jpg', n: 3 });
    assert.equal((await cli.query(`select url from fotos where id = 2`)).rows[0].url, 'https://exemplo.com/a.png');
    assert.equal((await cli.query(`select count(*)::int n from bkp_urls_202610141200_fotos`)).rows[0].n, 1);
    assert.equal((await cli.query(`select url from bkp_urls_202610141200_fotos`)).rows[0].url, 'https://kounq.supabase.co/storage/v1/object/public/avatars/a.png');
    assert.deepEqual(await achar(cli), [], 'nada sobra com a URL antiga');
  } finally {
    await cli.end();
    await admin.query(`drop database ${nome} with (force)`);
    await admin.end();
  }
});
