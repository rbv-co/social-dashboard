import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { abrirFontePg, NOME_DO_ROBO } from './fonte-pg.mjs';

// Cliente do `pg` de mentira: guarda as consultas e responde por um trecho do SQL.
function clienteFalso(respostas) {
  const consultas = [];
  class Client {
    constructor(cfg) { this.cfg = cfg; }
    async connect() { consultas.push(['connect', this.cfg.connectionString]); }
    async query(sql, params) {
      consultas.push([sql, params]);
      const achou = Object.entries(respostas).find(([trecho]) => sql.includes(trecho));
      return { rows: achou ? achou[1] : [] };
    }
    async end() { consultas.push(['end']); }
  }
  return { Client, consultas };
}

test('lê as tabelas e as linhas como o PostgREST devolvia', async () => {
  const { Client, consultas } = clienteFalso({
    'information_schema.tables': [{ table_name: 'accounts' }, { table_name: 'usuarios' }],
    'from public."accounts"': [{ j: '{"id":"a1","access_token":"x","criado":"2026-10-10T12:00:00+00:00"}' }],
  });
  const f = await abrirFontePg('postgres://copia@127.0.0.1:55470/api', { Client });
  assert.deepEqual(await f.tabelas(), ['accounts', 'usuarios']);
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
