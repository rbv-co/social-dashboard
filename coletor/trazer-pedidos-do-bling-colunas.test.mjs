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

test('o robô grava quem vendeu no cache do ranking (bling_pedido_vendedor), com o vendedor que vessel_pedidos guardou', () => {
  const pos = FONTE.indexOf('insert into bling_pedido_vendedor');
  assert.ok(pos > -1, 'sem isto o ranking por vendedor depende do navegador de quem abre a tela (Letícia, 18/10/2026)');
  assert.match(FONTE, /returning id, vendedor_id`/,
    'o vendedor do cache tem de ser o do upsert (coalesce): o Bling passa a devolver vendedor.id=0 depois (2745/2746)');
  assert.match(FONTE.slice(pos - 200, pos), /if \(linha\.vendedor_id\)/,
    'sem vendedor nenhum não vira linha do cache');
  assert.match(FONTE.slice(pos, pos + 500), /\[p\.id, linha\.vendedor_id,/);
  assert.match(FONTE.slice(pos, pos + 300), /on conflict \(pedido_id\) do update/);
});

test('o robô de vendedores grava o nome em bling_vendedores (o que o ranking mostra)', () => {
  const vend = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'trazer-vendedores-do-bling.mjs'), 'utf8');
  assert.match(vend, /insert into public\.bling_vendedores \(vendor_id, nome, updated_at\)[\s\S]{0,120}on conflict \(vendor_id\) do update/);
});
