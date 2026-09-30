// Postgres descartável para testes de COMPORTAMENTO do SQL: sobe um cluster temporário, aplica as
// migrations dadas e apaga tudo no fim. Pula sozinho (temPg = false) se initdb/pg_ctl/psql não existirem.
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const AQUI = dirname(fileURLToPath(import.meta.url))
const BINS = [process.env.PG_BIN, '/opt/homebrew/opt/postgresql@17/bin', '/opt/homebrew/opt/postgresql@16/bin', '/usr/lib/postgresql/16/bin', '/usr/lib/postgresql/17/bin', '']
  .filter((b) => b !== undefined)
const achar = (nome) => BINS.map((b) => (b ? join(b, nome) : nome)).find((p) => spawnSync(p, ['--version']).status === 0)
const INITDB = achar('initdb'), PG_CTL = achar('pg_ctl'), PSQL = achar('psql')
const ENV = { ...process.env, LC_ALL: 'C' } // o Postgres recusa subir com locale inválido

export const temPg = Boolean(INITDB && PG_CTL && PSQL)

/** Stubs do que o Supabase fornece e as migrations usam: papéis, `auth.uid()`, `profiles` e o `cron.schedule`. */
const STUBS = `create role service_role; create role anon; create role authenticated;
  create schema cron; create function cron.schedule(text, text, text) returns bigint language sql as 'select 1::bigint';
  create schema auth; create function auth.uid() returns uuid language sql as 'select null::uuid';
  create table public.profiles (id uuid, role text, is_superadmin boolean, features text[]);`

export function bancoDescartavel(migrations) {
  const porta = String(54000 + Math.floor(Math.random() * 900))
  let dir
  const psql = (...args) => execFileSync(PSQL, ['-X', '-h', dir, '-p', porta, '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', ...args], { encoding: 'utf8', env: ENV })
  return {
    sql: (comando) => psql('-tA', '-c', comando).trim(),
    iniciar() {
      if (!temPg) return
      dir = mkdtempSync(join(tmpdir(), 'pg-teste-'))
      execFileSync(INITDB, ['-D', dir, '-A', 'trust', '-U', 'postgres', '--no-sync', '--no-locale', '-E', 'UTF8'], { env: ENV })
      execFileSync(PG_CTL, ['-D', dir, '-o', `-k ${dir} -p ${porta} -c listen_addresses=''`, '-l', join(dir, 'log'), '-w', 'start'], { env: ENV })
      psql('-tA', '-c', STUBS)
      for (const m of migrations) psql('-q', '-f', join(AQUI, 'migrations', m))
    },
    parar() {
      if (!temPg || !dir) return
      spawnSync(PG_CTL, ['-D', dir, '-m', 'immediate', 'stop'], { stdio: 'ignore', env: ENV })
      rmSync(dir, { recursive: true, force: true })
    },
  }
}
