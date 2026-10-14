import test from 'node:test';
import assert from 'node:assert/strict';
import { pegarProximo, falhou, TIPOS } from './conteudo-fila.mjs';

// Banco de mentira: guarda o SQL na ordem e responde ao "select 1 ... rodando" e ao "returning id, tipo".
function bancoFalso({ rodando = [], pego = [] } = {}) {
  const sqls = [];
  return {
    sqls,
    rodar: async (sql, v) => {
      sqls.push([sql.replace(/\s+/g, ' ').trim(), v]);
      if (sql.includes('select 1 from conteudo_jobs')) return { rows: rodando };
      if (sql.includes('returning id, tipo')) return { rows: pego };
      return { rows: [] };
    },
  };
}

test('expira, descarta os repetidos e só então pega — nesta ordem', async () => {
  const db = bancoFalso({ pego: [{ id: 'j1', tipo: 'ideias' }] });
  assert.deepEqual(await pegarProximo(db), { id: 'j1', tipo: 'ideias' });
  const [a, b, c, d, e] = db.sqls.map(([s]) => s);
  assert.match(a, /esperou mais de 30 minutos.*created_at <= now\(\) - interval '30 minutes'/);
  assert.match(b, /passou de 20 minutos.*status = 'rodando' and updated_at <= now\(\) - interval '20 minutes'/);
  assert.match(c, /Substituído por um pedido mais novo.*n\.created_at > j\.created_at/);
  assert.match(d, /status = 'rodando' limit 1/);
  assert.match(e, /for update skip locked limit 1\) returning id, tipo/);
});

test('com outro job rodando não pega nada (um por vez na VPS)', async () => {
  const db = bancoFalso({ rodando: [{ '?column?': 1 }], pego: [{ id: 'j1', tipo: 'ideias' }] });
  assert.equal(await pegarProximo(db), null);
  assert.ok(!db.sqls.some(([s]) => s.includes('returning id, tipo')));
});

test('fila vazia devolve null', async () => {
  assert.equal(await pegarProximo(bancoFalso()), null);
});

test('tipo fora da lista fechada vira erro e não roda', async () => {
  const db = bancoFalso({ pego: [{ id: 'j9', tipo: '../../x' }] });
  assert.equal(await pegarProximo(db), null);
  const [sql, v] = db.sqls.at(-1);
  assert.match(sql, /set status = 'erro'/);
  assert.equal(v[0], 'j9');
  assert.deepEqual(TIPOS, ['ideias', 'semana']);
});

test('falhou só mexe em job ainda rodando (não sobrescreve o que o robô já fechou)', async () => {
  const db = bancoFalso();
  await falhou(db, 'j1');
  assert.match(db.sqls[0][0], /where id = \$1 and status = 'rodando'/);
});
