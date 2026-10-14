import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { abrirBanco, gravarIdeias, concluirJob, falharJob } from './conteudo-banco.mjs';

function clienteFalso({ falharNoInsert = false } = {}) {
  const consultas = [];
  class Client extends EventEmitter {
    async connect() {}
    async query(sql, v) {
      consultas.push([sql.replace(/\s+/g, ' ').trim(), v]);
      if (falharNoInsert && sql.includes('insert into conteudo_ideias')) throw new Error('boom');
      return { rows: [] };
    }
    async end() {}
  }
  return { Client, consultas };
}

test('sem URL não abre (falha alto, sem cair em outro banco)', async () => {
  await assert.rejects(() => abrirBanco('', { Client: class {} }), /falta CONTEUDO_DATABASE_URL/);
});

test('ideias vão numa transação e o roteiro vai como JSON, não como array do Postgres', async () => {
  const { Client, consultas } = clienteFalso();
  const db = await abrirBanco('postgres://x', { Client });
  await gravarIdeias(db, 'conta1', [{ titulo: 'A', roteiro: [{ fala: 'oi' }] }, { titulo: 'B' }], { modelo: 'm', jobId: 'j1' });
  assert.deepEqual(consultas.map(([s]) => s.split(' ')[0]), ['begin', 'insert', 'insert', 'commit']);
  assert.equal(consultas[1][1][5], '[{"fala":"oi"}]');
  assert.equal(consultas[2][1][5], '[]');
  assert.match(consultas[1][0], /'ia'/); // origem fixa: o robô não escolhe
});

test('falha no meio desfaz tudo (nenhuma ideia pela metade)', async () => {
  const { Client, consultas } = clienteFalso({ falharNoInsert: true });
  const db = await abrirBanco('postgres://x', { Client });
  await assert.rejects(() => gravarIdeias(db, 'c', [{ titulo: 'A' }], { modelo: 'm', jobId: null }), /boom/);
  assert.equal(consultas.at(-1)[0], 'rollback');
});

test('fim do job: resultado como JSON e erro cortado em 500', async () => {
  const { Client, consultas } = clienteFalso();
  const db = await abrirBanco('postgres://x', { Client });
  await concluirJob(db, 'j', { gravadas: 2 });
  await falharJob(db, 'j', 'x'.repeat(900));
  assert.equal(consultas[0][1][1], '{"gravadas":2}');
  assert.equal(consultas[1][1][1].length, 500);
  assert.ok(consultas.every(([sql]) => sql.includes("and status = 'rodando'")));
});
