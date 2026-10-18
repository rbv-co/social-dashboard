import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sqlDePrepare, ROBOS_PG } from '../ops/virada/robos-prepare.mjs';

test('um PREPARE por instrução literal; SQL montado (${…}), repetida e texto comum ficam de fora', () => {
  const { sql, total } = sqlDePrepare([['a.mjs',
    "await cli.query('select id from accounts where id = $1', [x]); await cli.query(`update t set a = 1;`);\n"
    + "const q = `select ${campos} from y`; const z = 'select id from accounts where id = $1'; const frase = 'não é SQL';"]]);
  assert.equal(total, 2);
  assert.match(sql, /prepare p1 as select id from accounts where id = \$1;/);
  assert.match(sql, /prepare p2 as update t set a = 1;/);
  assert.ok(sql.startsWith('begin read only;') && sql.trimEnd().endsWith('rollback;'));
});

test('a lista de robôs pg existe e rende instruções de verdade (a lista não envelhece calada)', () => {
  const coletor = dirname(fileURLToPath(import.meta.url));
  const { total } = sqlDePrepare(ROBOS_PG.map((f) => [f, readFileSync(join(coletor, f), 'utf8')]));
  assert.ok(total >= 50, `só ${total} instruções: a lista ou a extração quebrou`);
});
