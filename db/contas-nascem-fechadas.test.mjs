import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/* ⚠️ POR QUE ESTE ARQUIVO EXISTE
 *
 * A chave anônima da Supabase está DENTRO do HTML das páginas públicas. Se uma
 * destas funções ficar concedida a `anon`, qualquer visitante chama
 * `vessel_conta_entrar` direto e a página vira chutador de senha; se
 * `vessel_clientes` ganhar política aberta, a lista de clientes vaza.
 * Já aconteceu no projeto de uma tabela nova nascer sem a trava das irmãs. */

const SQL = readFileSync(join(dirname(fileURLToPath(import.meta.url)),
  'migrations/2026-09-17-vessel-contas-base.sql'), 'utf8').toLowerCase();

test('⚠️ as três tabelas nascem com RLS ligada', () => {
  for (const t of ['vessel_clientes', 'vessel_sessoes', 'vessel_tentativas_de_login']) {
    assert.match(SQL, new RegExp(`alter table public.${t}\\s+enable row level security`));
  }
});

test('⚠️ sessão e tentativas não têm política nenhuma', () => {
  for (const t of ['vessel_sessoes', 'vessel_tentativas_de_login']) {
    assert.ok(!new RegExp(`create policy[^;]+on public.${t}`).test(SQL),
      `${t} não pode ter política: token de sessão não se lê em tela`);
  }
});

test('⚠️ a política de clientes é SÓ de leitura e gateada por is_vessel_admin', () => {
  const m = SQL.match(/create policy[^;]+on public\.vessel_clientes[^;]+;/);
  assert.ok(m, 'falta a política de leitura do painel');
  assert.match(m[0], /for select/);
  assert.match(m[0], /is_vessel_admin\(\)/);
});

test('⚠️ toda função de conta é revogada de anon E authenticated', () => {
  assert.match(SQL, /revoke all on function public\.%s from public, anon, authenticated/);
  assert.ok(!/grant execute on function public\.%s to (anon|authenticated)/.test(SQL));
});

test('⚠️ pgcrypto é chamado qualificado (extensions.)', () => {
  for (const f of ['crypt(', 'gen_salt(', 'digest(', 'gen_random_bytes(']) {
    const solto = new RegExp(`(?<!extensions\\.)\\b${f.replace('(', '\\(')}`);
    assert.ok(!solto.test(SQL), `${f} sem o prefixo extensions. quebra com search_path=public`);
  }
});

test('⚠️ a senha é guardada com bcrypt, nunca em claro nem em sha', () => {
  assert.match(SQL, /extensions\.crypt\([^)]*extensions\.gen_salt\('bf'/);
});
