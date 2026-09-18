// db/abrir-pedido-com-nascimento.test.mjs
//
// A deriva: vessel_abrir_pedido_de_registro existia em PRODUÇÃO com 7
// parâmetros, sem migration nenhuma no repositório. Este teste prova que o
// arquivo que documenta essa função tem a data ANTERIOR à desta fase, grava a
// definição real (sem reescrever o corpo) e fecha o portão certo.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = join(dirname(fileURLToPath(import.meta.url)), 'migrations');
const ARQUIVO = '2026-09-16-zz-vessel-abrir-pedido-com-nascimento.sql';
const SQL = readFileSync(join(DIR, ARQUIVO), 'utf8');
const SQL_MIN = SQL.toLowerCase();

test('⚠️ a data no nome do arquivo é ANTERIOR às migrations desta fase (2026-09-17-*)', () => {
  // Comparação por STRING funciona aqui porque o formato é AAAA-MM-DD no
  // início do nome — ordenação lexicográfica bate com ordenação de data.
  assert.ok(ARQUIVO < '2026-09-17', `${ARQUIVO} precisa vir antes de 2026-09-17`);
  const outras = readdirSync(DIR).filter((f) => f.startsWith('2026-09-17-vessel-'));
  assert.ok(outras.length > 0, 'não achei nenhuma migration desta fase para comparar');
  for (const outra of outras) assert.ok(ARQUIVO < outra, `${ARQUIVO} tem de vir antes de ${outra}`);
});

test('a função tem os SETE parâmetros, com p_nascimento por último', () => {
  assert.match(SQL,
    /CREATE OR REPLACE FUNCTION public\.vessel_abrir_pedido_de_registro\(p_codigo text, p_nome text, p_cpf text, p_whatsapp text, p_onde text DEFAULT NULL::text, p_comprado_em date DEFAULT NULL::date, p_nascimento date DEFAULT NULL::date\)/);
});

test('o corpo grava nascimento em vessel_pedidos_de_registro — e a coluna nasce aqui também', () => {
  assert.match(SQL_MIN, /insert into public\.vessel_pedidos_de_registro\s*\n\s*\(codigo, nome, cpf, whatsapp, onde_comprou, comprado_em, nascimento\)/);
  assert.match(SQL_MIN, /alter table public\.vessel_pedidos_de_registro\s*\n\s*add column if not exists nascimento date/);
});

test('⚠️ o cabeçalho avisa que a versão de SEIS parâmetros continua existindo', () => {
  assert.match(SQL, /2026-09-03-zz-vessel-garantia-com-dono\.sql/);
  assert.match(SQL_MIN, /sobrecarga/);
  assert.match(SQL_MIN, /reaplicar.*n[ãa]o (recria|toca)/s);
});

test('⚠️ o cabeçalho explica que este arquivo DOCUMENTA uma função que já estava no ar', () => {
  assert.match(SQL_MIN, /j[áa] estava no ar/);
  assert.match(SQL_MIN, /sem migration/);
});

test('⚠️ o portão fecha SÓ a versão de sete parâmetros, sem soltar para anon/authenticated', () => {
  assert.match(SQL_MIN,
    /revoke all on function public\.vessel_abrir_pedido_de_registro\(text, text, text, text, text, date, date\)\s*\n\s*from public, anon, authenticated/);
  assert.match(SQL_MIN,
    /grant execute on function public\.vessel_abrir_pedido_de_registro\(text, text, text, text, text, date, date\)\s*\n\s*to service_role/);
  assert.ok(!/grant execute on function[^;]*\bto\b[^;]*\b(anon|authenticated)\b/i.test(SQL));
});
