import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { EventEmitter } from 'node:events';
import { abrirFontePg, NOME_DO_ROBO } from './fonte-pg.mjs';

// Cliente do `pg` de mentira: guarda as consultas e responde por um trecho do SQL.
function clienteFalso(respostas) {
  const consultas = [];
  const clientes = [];
  class Client extends EventEmitter {
    constructor(cfg) { super(); this.cfg = cfg; clientes.push(this); }
    async connect() { consultas.push(['connect', this.cfg.connectionString]); }
    async query(sql, params) {
      consultas.push([sql, params]);
      const achou = Object.entries(respostas).find(([trecho]) => sql.includes(trecho));
      return { rows: achou ? achou[1] : [] };
    }
    async end() { consultas.push(['end']); }
  }
  return { Client, consultas, clientes };
}

test('lê as tabelas e as linhas como o PostgREST devolvia', async () => {
  const { Client, consultas } = clienteFalso({
    'pg_tables': [{ tablename: 'accounts' }, { tablename: 'usuarios' }],
    'from public."accounts"': [{ j: '{"id":"a1","access_token":"x","criado":"2026-10-10T12:00:00+00:00"}' }],
  });
  const f = await abrirFontePg('postgres://copia@127.0.0.1:55470/api', { Client });
  assert.deepEqual(await f.tabelas(), ['accounts', 'usuarios']);
  // pg_tables lista TODA tabela do public, mesmo a que o papel não pode ler: information_schema.tables a
  // esconderia e a tabela sumiria da cópia sem erro nenhum (agora ela falha alto na leitura).
  const sqlTabelas = consultas.find(([sql]) => String(sql).includes('pg_tables'))[0];
  assert.match(sqlTabelas, /schemaname = 'public'/);
  assert.doesNotMatch(sqlTabelas, /information_schema/);
  assert.deepEqual(await f.ler('accounts'), [{ id: 'a1', access_token: 'x', criado: '2026-10-10T12:00:00+00:00' }]);
  await assert.rejects(() => f.ler('accounts"; drop table x; --'), /nome de tabela recusado/);
  await f.fechar();
  assert.equal(consultas.at(-1)[0], 'end');
});

test('registra a rodada no painel com o nome de produção e já conferida', async () => {
  const { Client, consultas } = clienteFalso({});
  const f = await abrirFontePg('postgres://x', { Client });
  await f.registrar(false, 'x'.repeat(3000));
  const [sql, params] = consultas.at(-1);
  assert.match(sql, /insert into robos_execucoes .*conferido_em/s);
  assert.deepEqual(params.slice(0, 3), [NOME_DO_ROBO, false, 500]);
  assert.equal(params[3].length, 2000);
  assert.equal(NOME_DO_ROBO, 'guardar-copia-do-banco');
});

test('sem conexão do Zoho a cópia para com a frase de sempre', async () => {
  const { Client } = clienteFalso({ acessos_conexoes: [{ client_id: 'c', refresh_token: null }] });
  const f = await abrirFontePg('postgres://x', { Client });
  await assert.rejects(() => f.conexaoZoho(), /Abra Acessos → Zoho/);
});

// A regra da cópia é "copiar TUDO menos o decidido": as tabelas NOVAS da API (senha em bcrypt,
// sessões, marcas de webhook, livro de envios) não podem ir para o drive compartilhado.
test('as credenciais e o estado da API Go ficam fora da cópia', () => {
  const robo = readFileSync(new URL('../guardar-copia-do-banco.mjs', import.meta.url), 'utf8');
  assert.match(robo, /usuarios: \['senha_hash'\]/);
  for (const t of ['sessoes', 'goose_db_version', 'webhooks_recebidos', 'envios_feitos']) {
    assert.match(robo, new RegExp(`SEM_COPIA = new Set\\(\\[[^\\]]*'${t}'`, 's'), t);
  }
  assert.match(robo, /COPIA_DATABASE_URL/);
});

test('nome de tabela fora do padrão derruba a listagem em vez de ser pulado', async () => {
  const { Client } = clienteFalso({ pg_tables: [{ tablename: 'accounts' }, { tablename: 'Usuarios; drop' }] });
  const f = await abrirFontePg('postgres://x', { Client });
  await assert.rejects(() => f.tabelas(), /nome de tabela recusado/);
});

// api-db reiniciado no meio do envio ao Zoho (minutos com a conexão parada): o pg emite 'error' no cliente
// e, sem ouvinte, isso vira exceção não tratada. Com ouvinte, a leitura falha com frase clara e o registro
// final (que o painel de saúde cobra) reconecta em vez de se perder.
test('queda da conexão no meio da rodada falha limpo e o registro final reconecta', async () => {
  const { Client, consultas, clientes } = clienteFalso({});
  const f = await abrirFontePg('postgres://copia@x/api', { Client });
  clientes[0].emit('error', new Error('terminating connection due to administrator command'));
  await assert.rejects(() => f.ler('accounts'), /conexão com o banco caiu/);
  await assert.rejects(() => f.tabelas(), /conexão com o banco caiu/);
  await f.registrar(true, 'ok');
  assert.equal(clientes.length, 2);
  assert.equal(clientes[1].cfg.connectionString, 'postgres://copia@x/api');
  assert.equal(consultas.filter(([sql]) => String(sql).includes('insert into robos_execucoes')).length, 1);
  await f.fechar();
});

test('o robô usa um nome só e avisa de pasta sem manifesto', () => {
  const robo = readFileSync(new URL('../guardar-copia-do-banco.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(robo, /const NOME_DO_ROBO/);
  assert.match(robo, /import \{ abrirFontePg, NOME_DO_ROBO \}/);
  assert.match(robo, /sem manifesto/);
});

test('coluna de credencial que sumiu das linhas derruba a cópia (no Postgres próprio)', () => {
  const robo = readFileSync(new URL('../guardar-copia-do-banco.mjs', import.meta.url), 'utf8');
  assert.match(robo, /PODE_NAO_EXISTIR/);
  assert.match(robo, /coluna de credencial sumiu/);
});
