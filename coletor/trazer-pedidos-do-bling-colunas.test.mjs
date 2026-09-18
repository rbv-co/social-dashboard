// coletor/trazer-pedidos-do-bling-colunas.test.mjs
//
// ⚠️ POR QUE ESTE TESTE LÊ O ARQUIVO COMO TEXTO
// `trazer-pedidos-do-bling.mjs` conecta no Postgres no TOPO do módulo
// (`await cli.connect()` fora de qualquer função) — importar o arquivo de
// dentro de um teste tentaria abrir conexão de verdade. Mesmo padrão das
// provas de `db/*.test.mjs`: sem banco, a prova é estática.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const FONTE = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'trazer-pedidos-do-bling.mjs'), 'utf8');

test('⚠️ C5 — o robô confere se observacoes/observacoes_internas existem antes de gravar', () => {
  assert.match(FONTE, /import\s*\{\s*colunasExistem\s*\}\s*from\s*['"]\.\/lib\/colunas-existem\.mjs['"]/);
  assert.match(FONTE, /colunasExistem\(/);
});

test('⚠️ C5 — sem as colunas, o robô AVISA no log em vez de morrer calado', () => {
  const pos = FONTE.indexOf('colunasExistem(');
  assert.ok(pos > -1, 'falta a chamada a colunasExistem');
  const janela = FONTE.slice(pos, pos + 600);
  assert.match(janela, /console\.warn/,
    'sem aviso no log, a ausência das colunas passa batido — exatamente o silêncio que este conserto evita');
});

test('⚠️ C5 — o insert monta a lista de colunas dinamicamente (não faz um insert fixo de 20 colunas)', () => {
  // Prova por ausência: o insert antigo listava "observacoes, observacoes_internas"
  // FIXO no texto do SQL. Se esse texto fixo ainda existir, o robô quebra
  // igual quando as colunas não existirem no banco.
  assert.ok(!/insert into vessel_pedidos[\s\S]{0,400}observacoes, observacoes_internas\)/.test(FONTE),
    'o insert não pode listar observacoes/observacoes_internas fixo — tem de montar a lista de colunas conforme colunasExistem');
});
