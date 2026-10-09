# Sair do Supabase — Plano 2: Postgres próprio, camada de compatibilidade, dump/restore e ensaio

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **Execute num worktree**; nunca na `main`. Faça `git add` só dos caminhos de cada task.

**Goal:** Ter o Postgres próprio definido e testável, uma camada de compatibilidade que restaura o schema `public` de produção **sem reescrever as 308 funções no dia 1**, scripts de dump → limpeza → restore → conferência, cópia do Storage, e um ensaio de corte cronometrado e repetível.

**Architecture:** O schema `public` de produção é restaurado como está num Postgres 17 novo, depois de uma limpeza (sem policies, RLS, grants de `anon/authenticated/service_role` e extensões do Supabase). Uma camada de compatibilidade (`auth.uid()` lido de `app.usuario_id`, schema `extensions` com pgcrypto/uuid-ossp, papéis `NOLOGIN`) deixa as 64 funções que usam `auth.uid()` e as 18 que usam `extensions.*` funcionarem; a API define `app.usuario_id` por transação (`ComUsuario`). As **21 chaves estrangeiras de 16 tabelas para `auth.users(id)`** (medido em produção) são reescritas na limpeza para `public.usuarios(id)`, a tabela de identidade da API, que o restore cria (migration do Plano 1) **antes** de carregar o schema. O dado migra com `pg_restore --data-only --disable-triggers`. O Storage migra por um script que lê a API REST e grava em disco.

**Tech Stack:** Go 1.26 (`api/`), Postgres 17, Docker, shell POSIX, Node 22 (`node --test`).

**Spec:** `docs/superpowers/specs/2026-10-09-sair-do-supabase-design.md` (§3.2, §6, §7, §9) e `docs/migracao-go/RESULTADO-DO-LEVANTAMENTO.md` (números reais de produção).

## Global Constraints

- **Nada em produção é alterado por este plano.** Dump e contagens leem o Supabase em `begin read only`/`pg_dump` (transação `REPEATABLE READ` somente leitura); o ensaio roda em Postgres **local** descartável. Aplicar o Postgres na VPS (Task 5) é uma etapa marcada **[VPS — só com ok do dono]**.
- **`pg_dump` precisa ser versão 17** (servidor de produção é 17.6; o 16 do Mac recusa): usar sempre o container `postgres:17` pelo wrapper `ops/migracao/pg17.sh`.
- Dump do Supabase pela **porta de sessão 5432** do pooler (a 6543, modo transação, não serve para `pg_dump`): o script troca `:6543/` por `:5432/` sozinho.
- **Nunca imprimir a URL de conexão**, nem `set -x`, nem `echo` da variável; erros do psql/pg_dump passam por `sed` que troca `postgres://...` por `<URL>`.
- **Dumps contêm dado pessoal e segredos** (`bling_tokens`, `segredos_de_cron`, `acessos_conexoes`...): ficam em `ops/migracao/saida/` (ignorada pelo git), modo `600`, e o ensaio **apaga** os dumps ao terminar, a menos que `--manter`.
- Não levar: schemas `auth`, `storage`, `cron`, `net`, `vault`, `realtime`, `extensions` do Supabase, `supabase_*`; nem `pg_cron`, `pg_net`, `supabase_vault`, `pg_stat_statements` (spec §3.2).
- Policies, `ENABLE ROW LEVEL SECURITY` e `GRANT/REVOKE` para `anon/authenticated/service_role` **não** vão para o banco novo (decisão do dono: sem RLS).
- **Chaves estrangeiras para `auth.users(id)` (21, em 16 tabelas) viram `REFERENCES public.usuarios(id)`** com o mesmo `ON DELETE`; depois de importar os usuários não pode haver linha órfã (`conferir-orfaos.sh`).
- Sem ORM e sem dependências novas além de `node:*` e do que já existe em `api/go.mod`.
- Cada commit termina com `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Textos e comentários em português, com acentuação correta.

## Review Focus

1. Corpo de função (`$$ ... $$`) que contém `;` ou o texto `create policy` **não pode** ser cortado nem removido pela limpeza (Task 3).
2. `auth.uid()` devolve `null` (nunca erro) quando `app.usuario_id` falta ou é inválido, e **não vaza** de uma transação para a seguinte (Tasks 1–2).
3. O restore com `--disable-triggers` não dispara triggers de negócio nem deixa tabela com trigger desabilitado (Task 4).
4. Contagens origem × destino distinguem "diferença real" de "tabela quente que cresceu durante o dump" (Task 4).
5. Nome de objeto do Storage com `..`, barra inicial ou caractere de controle **não escreve fora** da pasta de destino (Task 6).
6. Cópia do Storage interrompida e repetida não corrompe nem duplica (retomável por tamanho) (Task 6).
7. Rodar o ensaio duas vezes seguidas dá o mesmo resultado (idempotente: recria o banco alvo do zero) (Task 7).
9. As FKs para `auth.users` são reescritas **só** em `alter table`/`create table` (nunca em texto dentro de corpo de função) e, após `importar-usuarios`, nenhuma FK para `usuarios` tem órfãos; usuário apagado (soft delete) no Auth que ainda é referenciado aparece como órfão no relatório, não é escondido (Tasks 3, 4, 7).
8. O ensaio nunca aponta para produção por engano: recusa `ALVO_DATABASE_URL` cujo host não seja `localhost`/`127.0.0.1`/`::1` sem `--permitir-alvo-remoto` (Task 7).

## Estrutura de arquivos

```
api/internal/banco/compat/compat.sql      # papéis, schema extensions, auth.uid()/role()
api/internal/banco/compat.go              # //go:embed + const Compat
api/internal/banco/usuario.go             # ComUsuario (app.usuario_id por transação)
api/internal/banco/compat_test.go
api/internal/banco/usuario_test.go
ops/migracao/pg17.sh                      # wrapper: ferramentas do Postgres 17 em Docker
ops/migracao/limpar-dump.mjs              # divide o dump em comandos e remove o que não vai
ops/migracao/limpar-dump.test.mjs
ops/migracao/dump-supabase.sh             # schema + dados, somente leitura
ops/migracao/restaurar.sh                 # compat + schema limpo + dados
ops/migracao/conferir-contagens.sh        # count(*) origem × destino
ops/migracao/conferir-orfaos.sh           # FKs para public.usuarios sem linha pai
ops/migracao/ensaio-local.sh              # prova de ponta a ponta com um "Supabase de mentira" no Docker
ops/migracao/copiar-storage.mjs           # Storage REST -> disco
ops/migracao/copiar-storage.test.mjs
ops/migracao/ensaio.sh                    # ensaio cronometrado contra produção (somente leitura) -> alvo local
ops/vps/api-db/docker-compose.yml
ops/vps/api-db/backup-api-db.sh
ops/vps/api-db/testar-restauracao.sh
ops/vps/api-db/LEIA-ME.md
.gitignore                                # ops/migracao/saida/
```

---

### Task 1: Camada de compatibilidade (`auth.uid()`, `extensions`, papéis)

**Files:**
- Create: `api/internal/banco/compat/compat.sql`, `api/internal/banco/compat.go`, `api/internal/banco/compat_test.go`

**Interfaces:**
- Produces: `banco.Compat` (string com o SQL, idempotente). `auth.uid() uuid`, `auth.role() text`, schema `extensions` com `pgcrypto` e `uuid-ossp`, papéis `anon`, `authenticated`, `service_role` (`NOLOGIN`).
- Consumes: `testebanco.Novo(t)` (Plano 1).

- [ ] **Step 1: Escrever o teste que falha**

`api/internal/banco/compat_test.go`:

```go
package banco_test

import (
	"context"
	"testing"

	"github.com/rbv-co/social-dashboard/api/internal/banco"
	"github.com/rbv-co/social-dashboard/api/internal/testebanco"
)

const uidA = "11111111-1111-1111-1111-111111111111"

func TestCompat(t *testing.T) {
	p := testebanco.Novo(t)
	ctx := context.Background()
	// aplica duas vezes: tem de ser idempotente
	for i := 0; i < 2; i++ {
		if _, err := p.Exec(ctx, banco.Compat); err != nil {
			t.Fatalf("aplicação %d: %v", i+1, err)
		}
	}

	var uid *string
	if err := p.QueryRow(ctx, `select auth.uid()::text`).Scan(&uid); err != nil || uid != nil {
		t.Fatalf("sem app.usuario_id deveria ser null, veio %v (err %v)", uid, err)
	}

	tx, err := p.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := tx.Exec(ctx, `select set_config('app.usuario_id', $1, true)`, uidA); err != nil {
		t.Fatal(err)
	}
	var dentro string
	if err := tx.QueryRow(ctx, `select auth.uid()::text`).Scan(&dentro); err != nil || dentro != uidA {
		t.Fatalf("dentro da transação: %q (err %v)", dentro, err)
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	// set_config(..., true) vale só na transação: não pode vazar
	uid = nil
	if err := p.QueryRow(ctx, `select auth.uid()::text`).Scan(&uid); err != nil || uid != nil {
		t.Fatalf("vazou para fora da transação: %v (err %v)", uid, err)
	}

	// valor inválido vira null, nunca erro
	tx, _ = p.Begin(ctx)
	tx.Exec(ctx, `select set_config('app.usuario_id', 'isto-nao-e-uuid', true)`)
	uid = nil
	if err := tx.QueryRow(ctx, `select auth.uid()::text`).Scan(&uid); err != nil || uid != nil {
		t.Fatalf("valor inválido: %v (err %v)", uid, err)
	}
	tx.Rollback(ctx)

	// extensions.* resolve (as 18 funções de produção que usam pgcrypto/uuid)
	var n int
	if err := p.QueryRow(ctx, `select length(extensions.gen_random_bytes(8))`).Scan(&n); err != nil || n != 8 {
		t.Fatalf("gen_random_bytes: %d (err %v)", n, err)
	}
	var u string
	if err := p.QueryRow(ctx, `select extensions.uuid_generate_v4()::text`).Scan(&u); err != nil || len(u) != 36 {
		t.Fatalf("uuid_generate_v4: %q (err %v)", u, err)
	}

	// auth.role() é conservador: sem configuração, 'authenticated' (nunca 'service_role')
	var papel string
	if err := p.QueryRow(ctx, `select auth.role()`).Scan(&papel); err != nil || papel != "authenticated" {
		t.Fatalf("auth.role() = %q (err %v)", papel, err)
	}

	// os três papéis existem e não fazem login
	var q int
	if err := p.QueryRow(ctx, `select count(*) from pg_roles where rolname in ('anon','authenticated','service_role') and not rolcanlogin`).Scan(&q); err != nil || q != 3 {
		t.Fatalf("papéis NOLOGIN = %d (err %v)", q, err)
	}
}
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `make -C api teste PG_PORTA=58432`
Expected: FAIL com `undefined: banco.Compat`.

- [ ] **Step 3: Implementar**

`api/internal/banco/compat/compat.sql`:

```sql
-- Camada de compatibilidade com o que o Supabase oferecia, para restaurar o schema
-- `public` de produção sem reescrever, no dia 1, as funções que o usam:
--   64 funções chamam auth.uid(); 18 chamam extensions.* (pgcrypto/uuid-ossp); 1 chama auth.role().
-- Idempotente. NÃO cria policies nem dá permissão a ninguém: a autorização é do Go.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin; end if;
end
$$;

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists "uuid-ossp" with schema extensions;

create schema if not exists auth;

-- A API grava a identidade na transação: select set_config('app.usuario_id', '<uuid>', true).
-- Valor ausente ou inválido vira null (nunca erro) e não vaza para a transação seguinte.
create or replace function auth.uid() returns uuid
language plpgsql stable as $$
declare v text := nullif(current_setting('app.usuario_id', true), '');
begin
  return v::uuid;
exception when invalid_text_representation then
  return null;
end
$$;

-- Conservador: sem configuração é 'authenticated', nunca 'service_role'.
create or replace function auth.role() returns text
language sql stable as $$
  select coalesce(nullif(current_setting('app.papel_db', true), ''), 'authenticated')
$$;
```

`api/internal/banco/compat.go`:

```go
package banco

import _ "embed"

// Compat é o SQL da camada de compatibilidade (ver compat/compat.sql). É idempotente.
//
//go:embed compat/compat.sql
var Compat string
```

- [ ] **Step 4: Rodar e ver passar**

Run: `make -C api teste PG_PORTA=58432`
Expected: PASS (`internal/banco`), sem testes pulados.

- [ ] **Step 5: Commit**

```bash
git add api/internal/banco/compat api/internal/banco/compat.go api/internal/banco/compat_test.go
git commit -m "feat(api): camada de compatibilidade (auth.uid, extensions, papéis) para restaurar o public" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: `ComUsuario` — a API define `app.usuario_id` por transação

**Files:**
- Create: `api/internal/banco/usuario.go`, `api/internal/banco/usuario_test.go`

**Interfaces:**
- Consumes: `banco.Compat` (Task 1).
- Produces: `banco.ComUsuario(ctx context.Context, p *pgxpool.Pool, usuarioID string, fn func(tx pgx.Tx) error) error` — roda `fn` numa transação em que `auth.uid()` devolve `usuarioID`; commit se `fn` devolver `nil`, rollback caso contrário.

- [ ] **Step 1: Teste que falha**

`api/internal/banco/usuario_test.go`:

```go
package banco_test

import (
	"context"
	"errors"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/rbv-co/social-dashboard/api/internal/banco"
	"github.com/rbv-co/social-dashboard/api/internal/testebanco"
)

// uma tabela com trigger que grava quem editou, como as de produção (trilha-de-edicoes)
const fixtura = `
create table coisas (id serial primary key, nome text, editado_por uuid);
create function coisas_quem() returns trigger language plpgsql as $$
begin new.editado_por := auth.uid(); return new; end $$;
create trigger coisas_quem before insert or update on coisas for each row execute function coisas_quem();`

func TestComUsuarioGravaAIdentidadeParaOsTriggers(t *testing.T) {
	p := testebanco.Novo(t)
	ctx := context.Background()
	if _, err := p.Exec(ctx, banco.Compat); err != nil {
		t.Fatal(err)
	}
	if _, err := p.Exec(ctx, fixtura); err != nil {
		t.Fatal(err)
	}

	err := banco.ComUsuario(ctx, p, uidA, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `insert into coisas (nome) values ('a')`)
		return err
	})
	if err != nil {
		t.Fatal(err)
	}
	var quem *string
	p.QueryRow(ctx, `select editado_por::text from coisas where nome = 'a'`).Scan(&quem)
	if quem == nil || *quem != uidA {
		t.Fatalf("editado_por = %v", quem)
	}

	// fora do ComUsuario a identidade não existe (e não sobra da transação anterior)
	p.Exec(ctx, `insert into coisas (nome) values ('b')`)
	quem = nil
	p.QueryRow(ctx, `select editado_por::text from coisas where nome = 'b'`).Scan(&quem)
	if quem != nil {
		t.Fatalf("a identidade vazou para outra transação: %v", *quem)
	}
}

func TestComUsuarioFazRollbackSeAFuncaoFalhar(t *testing.T) {
	p := testebanco.Novo(t)
	ctx := context.Background()
	p.Exec(ctx, banco.Compat)
	p.Exec(ctx, fixtura)

	falha := errors.New("falhou")
	err := banco.ComUsuario(ctx, p, uidA, func(tx pgx.Tx) error {
		tx.Exec(ctx, `insert into coisas (nome) values ('x')`)
		return falha
	})
	if !errors.Is(err, falha) {
		t.Fatalf("err = %v", err)
	}
	var n int
	p.QueryRow(ctx, `select count(*) from coisas`).Scan(&n)
	if n != 0 {
		t.Fatalf("não fez rollback: %d linhas", n)
	}
}

func TestComUsuarioRecusaIDInvalidoSemExecutarAFuncao(t *testing.T) {
	p := testebanco.Novo(t)
	ctx := context.Background()
	p.Exec(ctx, banco.Compat)
	chamou := false
	err := banco.ComUsuario(ctx, p, "nao-e-uuid", func(pgx.Tx) error { chamou = true; return nil })
	if err == nil || chamou {
		t.Fatalf("deveria recusar um id que não é uuid (err=%v, chamou=%v)", err, chamou)
	}
}
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `make -C api teste PG_PORTA=58432`
Expected: FAIL (`undefined: banco.ComUsuario`).

- [ ] **Step 3: Implementar**

`api/internal/banco/usuario.go`:

```go
package banco

import (
	"context"
	"fmt"
	"regexp"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var reUUID = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)

// ComUsuario roda fn numa transação em que auth.uid() devolve usuarioID (as funções e
// triggers herdados de produção leem a identidade daí). Commit se fn devolver nil.
// set_config(..., true) vale só até o fim da transação: não vaza para a próxima.
func ComUsuario(ctx context.Context, p *pgxpool.Pool, usuarioID string, fn func(tx pgx.Tx) error) error {
	if !reUUID.MatchString(usuarioID) {
		return fmt.Errorf("usuário inválido: não é um uuid")
	}
	tx, err := p.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `select set_config('app.usuario_id', $1, true)`, usuarioID); err != nil {
		return err
	}
	if err := fn(tx); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `cd api && gofmt -w . && go vet ./... && make teste PG_PORTA=58432`
Expected: PASS, sem pulados.

- [ ] **Step 5: Commit**

```bash
git add api/internal/banco/usuario.go api/internal/banco/usuario_test.go
git commit -m "feat(api): ComUsuario grava app.usuario_id por transação para os triggers herdados" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Limpeza do dump (`limpar-dump.mjs`)

**Files:**
- Create: `ops/migracao/limpar-dump.mjs`, `ops/migracao/limpar-dump.test.mjs`
- Modify: `.gitignore` (acrescentar `ops/migracao/saida/`)

**Interfaces:**
- Produces: `dividir(sql) -> string[]` (comandos, cada um com o `;` final e os comentários que o antecedem; linhas `\meta` do psql viram itens próprios) e `limpar(sql) -> { sql: string, removidos: { policies, rls, grants, extensoes, publicacoes }, reescritos: { fks_usuarios } }` (`fks_usuarios` conta as ocorrências de `REFERENCES auth.users(id)` trocadas por `REFERENCES public.usuarios(id)`, apenas dentro de comandos `alter table` e `create table`). CLI: `node ops/migracao/limpar-dump.mjs ENTRADA.sql SAIDA.sql` (imprime o JSON `{removidos, reescritos}`).

- [ ] **Step 1: Teste que falha**

`ops/migracao/limpar-dump.test.mjs`:

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dividir, limpar } from './limpar-dump.mjs'

test('dividir não corta ponto e vírgula dentro de $$ nem de aspas', () => {
  const sql = `create function f() returns text language plpgsql as $$ begin return 'a;b'; end $$;
select 1;`
  const c = dividir(sql)
  assert.equal(c.length, 2)
  assert.match(c[0], /return 'a;b'; end \$\$;$/)
})

test('dividir entende $tag$ com nome e aspas duplas e aspas dobradas', () => {
  const c = dividir(`create function g() returns int as $corpo$ select 1; $corpo$ language sql;
alter table "a;b" add column x text default 'it''s;ok';`)
  assert.equal(c.length, 2)
})

test('dividir mantém comentário junto do comando e linha \\meta do psql como item próprio', () => {
  const c = dividir(`\\restrict abc123\n-- Name: t; Type: TABLE\ncreate table t (id int);\n\\unrestrict abc123\n`)
  assert.equal(c.length, 3)
  assert.match(c[1], /^-- Name: t; Type: TABLE\ncreate table t/)
})

test('limpar remove policies, RLS, grants, publicações e extensões do Supabase', () => {
  const sql = `
create table t (id int);
alter table t enable row level security;
alter table t force row level security;
create policy "p ; x" on t for select to authenticated using (id = (select 1));
grant all on table t to anon;
revoke all on table t from authenticated;
alter default privileges in schema public grant all on tables to service_role;
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pgcrypto with schema extensions;
create publication supabase_realtime;
`
  const r = limpar(sql)
  assert.deepEqual(r.removidos, { policies: 1, rls: 2, grants: 3, extensoes: 1, publicacoes: 1 })
  assert.deepEqual(r.reescritos, { fks_usuarios: 0 })
  assert.match(r.sql, /create table t/)
  assert.match(r.sql, /create extension if not exists pgcrypto/)
  assert.doesNotMatch(r.sql, /create policy|row level security|grant all|pg_cron|publication/i)
})

test('limpar NÃO remove o texto "create policy" que está dentro do corpo de uma função', () => {
  const sql = `create function cria() returns void language plpgsql as $f$
begin
  execute 'create policy x on t using (true)';
  perform 1; -- grant all on t to anon;
end $f$;`
  const r = limpar(sql)
  assert.equal(r.sql.trim(), sql.trim())
  assert.deepEqual(r.removidos, { policies: 0, rls: 0, grants: 0, extensoes: 0, publicacoes: 0 })
})

test('limpar reescreve FK para auth.users(id) em alter table e create table, mantendo o ON DELETE', () => {
  const sql = `alter table only public.profiles add constraint profiles_id_fkey foreign key (id) references auth.users(id) on delete cascade;
create table public.t (id int, u uuid references auth.users (id) on delete set null, v uuid references auth.users(id));`
  const r = limpar(sql)
  assert.equal(r.reescritos.fks_usuarios, 3)
  assert.match(r.sql, /references public\.usuarios\(id\) on delete cascade/i)
  assert.match(r.sql, /references public\.usuarios\(id\) on delete set null/i)
  assert.doesNotMatch(r.sql, /auth\.users/)
})

test('limpar NÃO mexe em "references auth.users" dentro de corpo de função nem de comentário', () => {
  const sql = `create function f() returns void language plpgsql as $$ begin perform 1; -- references auth.users(id)
  execute 'alter table t add foreign key (u) references auth.users(id)'; end $$;
-- alter table x add foreign key (u) references auth.users(id);
select 1;`
  const r = limpar(sql)
  assert.equal(r.sql, sql)
  assert.equal(r.reescritos.fks_usuarios, 0)
})

test('limpar mantém o resto do dump byte a byte', () => {
  const sql = `-- cabeçalho\nset check_function_bodies = false;\ncreate table a (id int);\ncomment on table a is 'x;y';\n`
  assert.equal(limpar(sql).sql, sql)
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test ops/migracao/limpar-dump.test.mjs`
Expected: FAIL (`Cannot find module './limpar-dump.mjs'`).

- [ ] **Step 3: Implementar**

`ops/migracao/limpar-dump.mjs`:

```js
// Limpa um dump `pg_dump --schema-only` do Supabase para o Postgres próprio:
// tira policies, RLS, grants para os papéis do Supabase, publicações e extensões que não levamos.
// Divide o texto em COMANDOS respeitando '...', "...", $tag$...$tag$ e comentários, porque
// um corpo de função (`$$ ... $$`) pode ter ';' e até a frase "create policy" dentro.
import { readFileSync, writeFileSync } from 'node:fs'

function fimDeAspas(s, i, q) {
  const escapa = q === "'" && /[eE]/.test(s[i - 1] || '') && !/\w/.test(s[i - 2] || ' ')
  for (let j = i + 1; j < s.length; j++) {
    if (escapa && s[j] === '\\') { j++; continue }
    if (s[j] === q) {
      if (s[j + 1] === q) { j++; continue } // aspas dobradas
      return j + 1
    }
  }
  return s.length
}

export function dividir(sql) {
  const itens = []
  let ini = 0
  let i = 0
  const n = sql.length
  const soEspacoDesde = (de, ate) => /^\s*$/.test(sql.slice(de, ate))
  while (i < n) {
    const c = sql[i]
    if (c === '-' && sql[i + 1] === '-') { const f = sql.indexOf('\n', i); i = f < 0 ? n : f + 1; continue }
    if (c === '/' && sql[i + 1] === '*') { const f = sql.indexOf('*/', i + 2); i = f < 0 ? n : f + 2; continue }
    if (c === "'" || c === '"') { i = fimDeAspas(sql, i, c); continue }
    if (c === '$') {
      const m = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i, i + 80))
      if (m) { const f = sql.indexOf(m[0], i + m[0].length); i = f < 0 ? n : f + m[0].length; continue }
    }
    if (c === '\\' && (i === 0 || sql[i - 1] === '\n') && soEspacoDesde(ini, i)) {
      // comando do psql (\restrict, \unrestrict...): uma linha inteira
      const f = sql.indexOf('\n', i)
      const fim = f < 0 ? n : f + 1
      itens.push(sql.slice(ini, fim)); ini = fim; i = fim; continue
    }
    if (c === ';') { itens.push(sql.slice(ini, i + 1)); ini = i + 1 }
    i++
  }
  if (ini < n) itens.push(sql.slice(ini))
  return itens
}

const semComentarios = (c) => c.replace(/\/\*[\s\S]*?\*\//g, ' ').split('\n').filter((l) => !/^\s*--/.test(l)).join('\n').trim()

const REGRAS = [
  ['policies', /^create\s+policy\b/i],
  ['rls', /^alter\s+table\b[\s\S]*\b(enable|force|disable|no\s+force)\s+row\s+level\s+security\s*;$/i],
  ['grants', /^(grant|revoke)\b/i],
  ['grants', /^alter\s+default\s+privileges\b/i],
  ['extensoes', /^create\s+extension\b[\s\S]*\b(pg_cron|pg_net|supabase_vault|pg_stat_statements)\b/i],
  ['extensoes', /^comment\s+on\s+extension\b/i],
  ['publicacoes', /^(create|alter|drop)\s+publication\b/i],
]

// 21 FKs de 16 tabelas apontam para auth.users(id); no banco novo a identidade é public.usuarios.
// Só em alter table / create table: texto dentro de função ou de comentário não é tocado.
const FK_AUTH = /\breferences\s+auth\.users\s*\(\s*id\s*\)/gi

export function limpar(sql) {
  const removidos = { policies: 0, rls: 0, grants: 0, extensoes: 0, publicacoes: 0 }
  const reescritos = { fks_usuarios: 0 }
  const mantidos = []
  for (const cmd of dividir(sql)) {
    const corpo = semComentarios(cmd)
    const regra = REGRAS.find(([, re]) => re.test(corpo))
    if (regra) { removidos[regra[0]]++; continue }
    if (/^(alter\s+table|create\s+table)\b/i.test(corpo) && corpo.search(FK_AUTH) >= 0) {
      reescritos.fks_usuarios += (corpo.match(FK_AUTH) || []).length
      // troca só no corpo do comando (não nos comentários que o antecedem)
      mantidos.push(cmd.replace(corpo, corpo.replace(FK_AUTH, 'REFERENCES public.usuarios(id)')))
    } else mantidos.push(cmd)
  }
  return { sql: mantidos.join(''), removidos, reescritos }
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], 'file://').href) {
  const [entrada, saida] = process.argv.slice(2)
  if (!entrada || !saida) { console.error('uso: node limpar-dump.mjs ENTRADA.sql SAIDA.sql'); process.exit(2) }
  const r = limpar(readFileSync(entrada, 'utf8'))
  writeFileSync(saida, r.sql, { mode: 0o600 })
  console.log(JSON.stringify({ removidos: r.removidos, reescritos: r.reescritos }))
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test ops/migracao/limpar-dump.test.mjs`
Expected: PASS (6 testes). Se o teste "mantém o resto byte a byte" falhar por espaço/linha final, o conserto é na junção (`mantidos.join('')` já preserva o texto original de cada comando); não normalizar o texto.

- [ ] **Step 5: Ignorar a saída e commitar**

```bash
printf '\nops/migracao/saida/\n' >> .gitignore
git add ops/migracao/limpar-dump.mjs ops/migracao/limpar-dump.test.mjs .gitignore
git commit -m "feat(migracao-go): limpeza do dump do Supabase (sem policies, RLS, grants e extensões)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Dump, restore e conferência (com prova de ponta a ponta num "Supabase de mentira")

**Files:**
- Create: `ops/migracao/pg17.sh`, `ops/migracao/dump-supabase.sh`, `ops/migracao/restaurar.sh`, `ops/migracao/conferir-contagens.sh`, `ops/migracao/conferir-orfaos.sh`, `ops/migracao/ensaio-local.sh`
- Modify: `api/cmd/api/main.go` (subcomando `migrar`)

**Interfaces:**
- Consumes: `api/internal/banco/compat/compat.sql` (Task 1), `ops/migracao/limpar-dump.mjs` (Task 3).
- Produces (linha de comando):
  - `pg17.sh <comando> [args...]`: executa o comando (`pg_dump`, `pg_restore`, `psql`) numa imagem `postgres:17`, com a pasta atual montada em `/work`.
  - `dump-supabase.sh ORIGEM_DATABASE_URL SAIDA_DIR`: grava `SAIDA_DIR/schema.sql` (já limpo) e `SAIDA_DIR/dados.dump` (formato custom) e imprime as contagens de remoção.
  - `restaurar.sh ALVO_DATABASE_URL DUMP_DIR`: exige o alvo **vazio**; aplica compat, roda `go run ./cmd/api migrar` (cria `usuarios`, `sessoes`, `goose_db_version`), carrega o schema limpo e os dados.
  - `conferir-contagens.sh ORIGEM_URL ALVO_URL`: itera as tabelas **da origem** e imprime `tabela origem destino`; sai com 1 se houver diferença (veja Review Focus 4). O alvo tem tabelas a mais (`usuarios`, `sessoes`, `goose_db_version`) que não entram.
  - `conferir-orfaos.sh ALVO_URL`: para cada FK que aponta para `public.usuarios`, conta linhas órfãs; imprime `tabela.coluna n` e sai com 1 se algum `n` for maior que 0 (veja Review Focus 9).
  - Subcomando `api migrar`: aplica as migrations do banco (as mesmas que todo subcomando já aplica ao iniciar) e termina.

- [ ] **Step 1: `pg17.sh` e `dump-supabase.sh`**

`ops/migracao/pg17.sh`:

```sh
#!/bin/sh
# Ferramentas do Postgres 17 (o servidor de produção é 17.6; o pg_dump 16 do Mac recusa).
# Uso: sh ops/migracao/pg17.sh pg_dump --version
set -eu
exec docker run --rm -i --network host -v "$PWD:/work" -w /work postgres:17 "$@"
```

Observação para o implementador: no macOS o Docker Desktop **ignora** `--network host` mas a rede de saída funciona e `localhost` dentro do contêiner **não** é o Mac; por isso, para alvos locais use `host.docker.internal`. O script `ensaio-local.sh` trata disso (use a variável `ALVO_HOST_DOCKER`). Se `--network host` fizer o `docker run` falhar no Mac, remova a opção e mantenha o resto.

`ops/migracao/dump-supabase.sh`:

```sh
#!/bin/sh
# Dump SOMENTE LEITURA do schema public do Supabase: schema (limpo) + dados.
# Uso: sh ops/migracao/dump-supabase.sh 'postgres://...' ops/migracao/saida/2026-10-09
# A URL não é impressa. Porta 6543 (pooler em modo transação) é trocada por 5432 (sessão).
set -eu
ORIGEM=${1:?uso: dump-supabase.sh ORIGEM_DATABASE_URL SAIDA_DIR}
SAIDA=${2:?uso: dump-supabase.sh ORIGEM_DATABASE_URL SAIDA_DIR}
AQUI=$(cd "$(dirname "$0")" && pwd)
ORIGEM=$(printf '%s' "$ORIGEM" | sed 's#:6543/#:5432/#')
mkdir -p "$SAIDA"; chmod 700 "$SAIDA"
umask 077
oculta() { sed -E 's#postgres(ql)?://[^ "]*#<URL>#g'; }

# schema: sem dono, sem permissões; só o public
sh "$AQUI/pg17.sh" pg_dump "$ORIGEM" --schema=public --schema-only --no-owner --no-privileges \
  > "$SAIDA/schema-bruto.sql" 2> "$SAIDA/schema.erro" || { oculta < "$SAIDA/schema.erro" >&2; echo "pg_dump (schema) falhou" >&2; exit 1; }
node "$AQUI/limpar-dump.mjs" "$SAIDA/schema-bruto.sql" "$SAIDA/schema.sql" > "$SAIDA/limpeza.json"
echo "limpeza: $(cat "$SAIDA/limpeza.json")"

# dados: formato custom (restauração seletiva e paralela); transação REPEATABLE READ somente leitura
sh "$AQUI/pg17.sh" pg_dump "$ORIGEM" --schema=public --data-only --no-owner --no-privileges -Fc \
  > "$SAIDA/dados.dump" 2> "$SAIDA/dados.erro" || { oculta < "$SAIDA/dados.erro" >&2; echo "pg_dump (dados) falhou" >&2; exit 1; }
rm -f "$SAIDA/schema.erro" "$SAIDA/dados.erro"
echo "dump gravado em $SAIDA (schema.sql, dados.dump)"
```

- [ ] **Step 2: `restaurar.sh` e `conferir-contagens.sh`**

`ops/migracao/restaurar.sh`:

```sh
#!/bin/sh
# Restaura no Postgres ALVO: compat -> migrations da API (usuarios, sessoes) -> schema limpo -> dados.
# O alvo deve estar VAZIO. As FKs que apontavam para auth.users já vêm reescritas para public.usuarios.
# Uso: sh ops/migracao/restaurar.sh 'postgres://...@alvo/db' ops/migracao/saida/2026-10-09
set -eu
ALVO=${1:?uso: restaurar.sh ALVO_DATABASE_URL DUMP_DIR}
DUMP=${2:?uso: restaurar.sh ALVO_DATABASE_URL DUMP_DIR}
AQUI=$(cd "$(dirname "$0")" && pwd)
RAIZ=$(cd "$AQUI/../.." && pwd)

# recusa alvo que já tem tabelas no public (não mistura com restauração anterior)
JA=$(psql "$ALVO" -X -Atqc "select count(*) from information_schema.tables where table_schema='public'")
[ "$JA" = 0 ] || { echo "o alvo já tem $JA tabelas no public; use um banco vazio" >&2; exit 1; }

psql "$ALVO" -X -q -v ON_ERROR_STOP=1 -f "$RAIZ/api/internal/banco/compat/compat.sql" > /dev/null
# cria public.usuarios/sessoes (as FKs reescritas do schema precisam da tabela pai)
( cd "$RAIZ/api" && DATABASE_URL="$ALVO" go run ./cmd/api migrar )
# check_function_bodies=off: funções SQL que citam objetos que não levamos (net.*, storage.*)
# criam sem erro; elas serão reescritas nos planos de domínio.
PGOPTIONS='-c check_function_bodies=off' psql "$ALVO" -X -q -v ON_ERROR_STOP=1 -f "$DUMP/schema.sql" > /dev/null
echo "schema restaurado"
# dados com triggers desligados (não dispara regra de negócio, trilha nem checagem de FK); precisa de superusuário
sh "$AQUI/pg17.sh" pg_restore --data-only --disable-triggers --no-owner --exit-on-error -d "$ALVO" "$DUMP/dados.dump"
psql "$ALVO" -X -q -c "analyze" > /dev/null
echo "dados restaurados (rode importar-usuarios e conferir-orfaos.sh em seguida)"
```

Observação: se `pg17.sh pg_restore -d "$ALVO"` não alcançar o alvo local pelo `localhost` do Mac, use `host.docker.internal` na URL passada ao `pg17.sh`. Como o `schema.sql` já referencia `public.usuarios`, a checagem de FK não ocorre na carga (triggers desligados); a consistência é conferida depois, por `conferir-orfaos.sh`.

`ops/migracao/conferir-contagens.sh`:

```sh
#!/bin/sh
# Compara count(*) de cada tabela do public: origem × destino.
# Saída: "tabela origem destino"; exit 1 se alguma diferir.
# Tabela QUENTE (a origem cresce durante o dump) aparece como "origem > destino": confira,
# no dia do corte a origem estará congelada (somente leitura) e tem de bater exato.
set -eu
O=${1:?uso: conferir-contagens.sh ORIGEM_URL ALVO_URL}
A=${2:?uso: conferir-contagens.sh ORIGEM_URL ALVO_URL}
O=$(printf '%s' "$O" | sed 's#:6543/#:5432/#')
# itera as tabelas da ORIGEM: o alvo tem a mais usuarios, sessoes e goose_db_version
tabelas=$(printf 'begin read only;\nselect table_name from information_schema.tables where table_schema=%s and table_type=%s order by 1;\ncommit;\n' "'public'" "'BASE TABLE'" | psql "$O" -X -Atq | grep -vE '^(BEGIN|COMMIT)$')
ruim=0
for t in $tabelas; do
  co=$(printf 'begin read only;\nselect count(*) from public."%s";\ncommit;\n' "$t" | psql "$O" -X -Atq | sed -n 2p)
  ca=$(psql "$A" -X -Atqc "select count(*) from public.\"$t\"")
  marca=
  if [ "$co" != "$ca" ]; then ruim=1; marca=" <-- DIFERE"; fi
  echo "$t $co $ca$marca"
done
exit $ruim
```

(`sed -n 2p`: dentro do `begin read only`, a linha 1 de saída é `BEGIN`, a 2 é o `count`, a 3 `COMMIT`; com `-q` os rótulos de comando somem, então se a contagem aparecer na linha 1, troque por `grep -E '^[0-9]+$'`. O implementador valida isso no ensaio e usa `grep -E '^[0-9]+$' | head -1`, que funciona nos dois casos.)

- [ ] **Step 3: `ensaio-local.sh` (a prova de ponta a ponta)**

`ops/migracao/conferir-orfaos.sh`:

```sh
#!/bin/sh
# Para cada chave estrangeira que aponta para public.usuarios, conta as linhas órfãs
# (valor preenchido sem linha pai). Saída "tabela.coluna n"; exit 1 se algum n > 0.
# Um usuário apagado (soft delete) no Auth que ainda é referenciado aparece aqui, não é escondido.
set -eu
A=${1:?uso: conferir-orfaos.sh ALVO_URL}
ruim=$(mktemp)
psql "$A" -X -Atq -F '|' -c "select conrelid::regclass::text, (select attname from pg_attribute where attrelid = conrelid and attnum = conkey[1]) from pg_constraint where contype = 'f' and confrelid = 'public.usuarios'::regclass and array_length(conkey, 1) = 1 order by 1, 2" \
| while IFS='|' read -r tabela coluna; do
    n=$(psql "$A" -X -Atqc "select count(*) from $tabela t where t.\"$coluna\" is not null and not exists (select 1 from public.usuarios u where u.id = t.\"$coluna\")")
    echo "$tabela.$coluna $n"
    [ "$n" = 0 ] || echo x >> "$ruim"
  done
if [ -s "$ruim" ]; then rm -f "$ruim"; exit 1; fi
rm -f "$ruim"
```

`ops/migracao/ensaio-local.sh` sobe **dois** Postgres 17 no Docker (um "Supabase de mentira" com `auth`, políticas e grants, e um alvo vazio), roda dump → limpeza → restore → conferência e afirma o resultado:

```sh
#!/bin/sh
# Prova de ponta a ponta das ferramentas, sem tocar em produção: sobe um Postgres que imita o
# Supabase (schema auth, RLS, policies, grants, função que usa auth.uid() e extensions.*) e um
# alvo vazio; roda dump -> limpeza -> restore -> contagens e CONFERE o resultado.
# Uso: sh ops/migracao/ensaio-local.sh
set -eu
AQUI=$(cd "$(dirname "$0")" && pwd)
OUT=$(mktemp -d)
ORIG=ensaio-origem; ALVO=ensaio-alvo; PO=58441; PA=58442
limpa() { docker rm -f "$ORIG" "$ALVO" >/dev/null 2>&1 || true; rm -rf "$OUT"; }
trap limpa EXIT INT TERM
limpa; OUT=$(mktemp -d)
for par in "$ORIG:$PO" "$ALVO:$PA"; do
  n=${par%%:*}; p=${par##*:}
  docker run -d --rm --name "$n" -e POSTGRES_PASSWORD=x -p 127.0.0.1:$p:5432 postgres:17 >/dev/null
done
for p in $PO $PA; do for i in $(seq 60); do docker exec "$( [ $p = $PO ] && echo $ORIG || echo $ALVO )" pg_isready -h 127.0.0.1 -U postgres >/dev/null 2>&1 && break; sleep 1; done; done
URL_O="postgres://postgres:x@127.0.0.1:$PO/postgres"; URL_A="postgres://postgres:x@127.0.0.1:$PA/postgres"

# 1) "Supabase de mentira"
psql "$URL_O" -X -q -v ON_ERROR_STOP=1 <<'SQL'
create role anon nologin; create role authenticated nologin; create role service_role nologin;
create schema extensions; create extension pgcrypto with schema extensions;
create extension "uuid-ossp" with schema extensions;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create table auth.users (id uuid primary key, email text);
create table public.profiles (id uuid primary key references auth.users(id) on delete cascade, nome text, disabled boolean default false);
create table public.notas (id serial primary key, dono uuid, texto text);
alter table public.notas enable row level security;
create policy "dono le" on public.notas for select to authenticated using (dono = auth.uid());
grant all on public.notas to anon, authenticated, service_role;
create function public.token_curto() returns text language sql as $$ select encode(extensions.gen_random_bytes(4), 'hex') $$;
create function public.quem() returns uuid language sql stable as $$ select auth.uid() $$;
create function public.cria_policy_dinamica() returns void language plpgsql as $f$
begin execute 'create policy x on public.notas using (true)'; end $f$;
insert into auth.users select gen_random_uuid(), 'u' || g || '@x.com' from generate_series(1, 2) g;
insert into public.profiles select id, case when email like 'u1%' then 'Ana' else 'Bia' end, email like 'u2%' from auth.users;
insert into public.notas (dono, texto) select id, 'nota ' || g from public.profiles, generate_series(1, 50) g;
SQL

# 2) dump -> limpeza -> restore -> contagens
sh "$AQUI/dump-supabase.sh" "$URL_O" "$OUT/dump" >/dev/null
sh "$AQUI/restaurar.sh" "$URL_A" "$OUT/dump" >/dev/null
sh "$AQUI/conferir-contagens.sh" "$URL_O" "$URL_A" > "$OUT/contagens.txt"

# 2b) "importar-usuarios" simulado: copia os ids de auth.users da origem para public.usuarios do alvo
psql "$URL_O" -X -Atc "select id, email from auth.users" -F '|' | while IFS='|' read -r id email; do
  psql "$URL_A" -X -q -c "insert into public.usuarios (id, email) values ('$id', '$email')"
done
sh "$AQUI/conferir-orfaos.sh" "$URL_A" > "$OUT/orfaos.txt" || falha_orfaos=1

# 3) afirmações
falha() { echo "FALHOU: $1" >&2; exit 1; }
[ -z "${falha_orfaos:-}" ] || falha "FK com órfãos: $(grep -v ' 0$' "$OUT/orfaos.txt")"
[ "$(psql "$URL_A" -X -Atc "select count(*) from pg_constraint where contype='f' and confrelid='public.usuarios'::regclass and conrelid='public.profiles'::regclass")" = 1 ] || falha "a FK de profiles não aponta para public.usuarios"
[ "$(psql "$URL_A" -X -Atc "select count(*) from pg_namespace where nspname='auth' and exists (select 1 from pg_class c where c.relnamespace=pg_namespace.oid and c.relname='users')")" = 0 ] || falha "o alvo não deveria ter auth.users
[ "$(psql "$URL_A" -X -Atc "select count(*) from pg_policies where schemaname='public'")" = 0 ] || falha "restaram policies"
[ "$(psql "$URL_A" -X -Atc "select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relrowsecurity")" = 0 ] || falha "restou RLS ligada"
[ "$(psql "$URL_A" -X -Atc "select length(public.token_curto())")" = 8 ] || falha "extensions.gen_random_bytes não funciona no alvo"
[ "$(psql "$URL_A" -X -Atc "select public.quem() is null")" = t ] || falha "auth.uid() deveria ser null sem app.usuario_id"
[ "$(psql "$URL_A" -X -Atc "select set_config('app.usuario_id','11111111-1111-1111-1111-111111111111',false); select public.quem()::text" | tail -1)" = 11111111-1111-1111-1111-111111111111 ] || falha "auth.uid() não lê app.usuario_id"
[ "$(psql "$URL_A" -X -Atc "select count(*) from pg_proc where proname='cria_policy_dinamica'")" = 1 ] || falha "a função com 'create policy' no corpo foi removida"
[ "$(psql "$URL_A" -X -Atc "select count(*) from public.notas")" = 100 ] || falha "dados não bateram"
[ "$(psql "$URL_A" -X -Atc "select count(*) from pg_trigger t join pg_class c on c.oid=t.tgrelid where c.relnamespace='public'::regnamespace and not t.tgisinternal and t.tgenabled='D'")" = 0 ] || falha "restou trigger desabilitado"
grep -q DIFERE "$OUT/contagens.txt" && falha "contagens diferem: $(grep DIFERE "$OUT/contagens.txt")"
echo "OK: ensaio local passou (dump -> limpeza -> restore -> contagens)"
```

- [ ] **Step 4: Rodar a prova**

Run: `sh ops/migracao/ensaio-local.sh`
Expected: termina com `OK: ensaio local passou (dump -> limpeza -> restore -> contagens)` e deixa **nenhum** contêiner (`docker ps -a | grep ensaio-` vazio). O implementador corrige o que a execução real exigir (rede do Docker no Mac, `--network host`, `host.docker.internal`, a linha de `sed` das contagens) e **registra cada ajuste no relatório**.

- [ ] **Step 4b: Subcomando `migrar`**

Em `api/cmd/api/main.go`, junto dos outros `case` do `switch os.Args[1]`, acrescentar (o `Migrar` já rodou antes do `switch`, então o caso só registra e termina):

```go
	case "migrar":
		slog.Info("migrations aplicadas")
```

Run: `cd api && gofmt -w . && go vet ./... && go build ./...` — Expected: limpo.

- [ ] **Step 5: Commit**

```bash
git add api/cmd/api/main.go ops/migracao/pg17.sh ops/migracao/dump-supabase.sh ops/migracao/restaurar.sh ops/migracao/conferir-contagens.sh ops/migracao/conferir-orfaos.sh ops/migracao/ensaio-local.sh
git commit -m "feat(migracao-go): dump, restore e conferência com prova de ponta a ponta local" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Postgres da API na VPS (compose, backup e teste de restauração)

**Files:**
- Create: `ops/vps/api-db/docker-compose.yml`, `ops/vps/api-db/backup-api-db.sh`, `ops/vps/api-db/testar-restauracao.sh`, `ops/vps/api-db/LEIA-ME.md`

**Interfaces:**
- Produces: contêiner `api-db` (Postgres 17, rede `api_net`, **sem porta publicada**), arquivos de segredo `/root/secrets/api-db.env` (`POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`, modo 600), backups em `/root/backups-api/` (`api-db-AAAA-MM-DD-HHMM.dump` + `.sha256`), retenção 14 dias.

- [ ] **Step 1: compose**

`ops/vps/api-db/docker-compose.yml`:

```yaml
# Postgres 17 da API (saída do Supabase). Sem porta publicada: quem fala com ele são os
# contêineres na rede api_net (a API e o worker) e `docker exec` para administração.
name: api-db
services:
  api-db:
    image: postgres:17
    container_name: api-db
    restart: unless-stopped
    env_file: /root/secrets/api-db.env
    shm_size: 256mb
    mem_limit: 1g
    command: >
      postgres
      -c shared_buffers=256MB
      -c max_connections=100
      -c idle_in_transaction_session_timeout=60000
      -c log_min_duration_statement=500
      -c log_connections=off
    volumes:
      - api_db_data:/var/lib/postgresql/data
    networks: [api_net]
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U \"$$POSTGRES_USER\" -d \"$$POSTGRES_DB\""]
      interval: 10s
      timeout: 5s
      retries: 6
volumes:
  api_db_data:
networks:
  api_net:
    name: api_net
```

- [ ] **Step 2: backup e teste de restauração**

`ops/vps/api-db/backup-api-db.sh`:

```sh
#!/bin/sh
# Backup diário do Postgres da API. Cron sugerido (root): 40 3 * * * /root/api-db/backup-api-db.sh
set -eu
DIR=/root/backups-api
RET=14
mkdir -p "$DIR"; chmod 700 "$DIR"
ARQ="$DIR/api-db-$(date +%F-%H%M).dump"
docker exec api-db sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$ARQ.tmp"
# um dump vazio ou truncado não pode virar "backup": confere o índice
docker exec -i api-db pg_restore -l < "$ARQ.tmp" > /dev/null
[ "$(wc -c < "$ARQ.tmp")" -gt 1000 ] || { echo "backup suspeito (muito pequeno)" >&2; rm -f "$ARQ.tmp"; exit 1; }
mv "$ARQ.tmp" "$ARQ"
( cd "$DIR" && sha256sum "$(basename "$ARQ")" > "$(basename "$ARQ").sha256" )
chmod 600 "$ARQ" "$ARQ.sha256"
find "$DIR" -name 'api-db-*.dump*' -mtime +$RET -delete
echo "backup ok: $ARQ ($(du -h "$ARQ" | cut -f1))"
```

`ops/vps/api-db/testar-restauracao.sh`:

```sh
#!/bin/sh
# Restaura o backup MAIS RECENTE num contêiner temporário e confere que há tabelas e dados.
# Uso: sh testar-restauracao.sh [arquivo.dump]
set -eu
DIR=/root/backups-api
ARQ=${1:-$(ls -1t "$DIR"/api-db-*.dump | head -1)}
( cd "$DIR" && sha256sum -c "$(basename "$ARQ").sha256" )
docker rm -f api-db-teste >/dev/null 2>&1 || true
docker run -d --rm --name api-db-teste -e POSTGRES_PASSWORD=teste postgres:17 >/dev/null
trap 'docker rm -f api-db-teste >/dev/null 2>&1 || true' EXIT
for i in $(seq 60); do docker exec api-db-teste pg_isready -U postgres >/dev/null 2>&1 && break; sleep 1; done
docker exec -i api-db-teste sh -c 'createdb -U postgres teste && pg_restore -U postgres -d teste --no-owner --exit-on-error' < "$ARQ"
N=$(docker exec api-db-teste psql -U postgres -d teste -Atc "select count(*) from information_schema.tables where table_schema='public'")
[ "$N" -gt 0 ] || { echo "restauração sem tabelas" >&2; exit 1; }
echo "restauração ok: $N tabelas no public ($ARQ)"
```

`ops/vps/api-db/LEIA-ME.md` (resumido): como criar `/root/secrets/api-db.env` com `definir-segredo` (digitação oculta; **nunca** pedir a senha no chat), `docker compose -f ... up -d`, instalar o cron do backup, rodar `testar-restauracao.sh`, e a regra do projeto: **nunca recriar o contêiner com operação em andamento**; `up -d --no-deps`.

- [ ] **Step 3: Verificação local (sem VPS)**

Run: `docker compose -f ops/vps/api-db/docker-compose.yml config > /dev/null && echo compose-valido` com um `env_file` de teste temporário (criar `/tmp/api-db.env` e ajustar o caminho só para a validação, sem commitar a mudança); e `sh -n` em cada script `.sh`.
Expected: `compose-valido` e sem erro de sintaxe.

- [ ] **Step 4: Commit**

```bash
git add ops/vps/api-db
git commit -m "feat(ops): Postgres 17 da API (compose, backup diário e teste de restauração)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 5: [VPS — só com ok do dono] Aplicar**

Texto para o dono, uma linha por comando (comandos colados com quebra de linha quebram o `&&`): copiar `ops/vps/api-db` para `/root/api-db` na VPS; criar `/root/secrets/api-db.env` com digitação oculta (usuário `api`, banco `api`); `docker compose -f /root/api-db/docker-compose.yml up -d`; rodar o backup uma vez e `testar-restauracao.sh`; só então agendar o cron. **Não executar sem ok.**

---

### Task 6: Cópia do Storage (`copiar-storage.mjs`)

**Files:**
- Create: `ops/migracao/copiar-storage.mjs`, `ops/migracao/copiar-storage.test.mjs`

**Interfaces:**
- Produces: `copiarBucket({ url, chave, bucket, destino, fetch? }) -> { copiados, pulados, bytes }` e CLI: `node ops/migracao/copiar-storage.mjs --destino DIR [--excluir b1,b2] [--bucket b]` lendo `SUPABASE_URL` e `SUPABASE_SERVICE_KEY` do ambiente. Lista com `POST {url}/storage/v1/object/list/{bucket}` (`{prefix, limit, offset}`; itens com `id === null` são pastas) e baixa com `GET {url}/storage/v1/object/authenticated/{bucket}/{caminho}`; grava em `DIR/<bucket>/<caminho>`.

- [ ] **Step 1: Teste que falha**

`ops/migracao/copiar-storage.test.mjs` sobe um servidor `node:http` que imita a API de Storage (um bucket `b` com `a.txt`, uma pasta `pasta/` com `c.bin`, e um objeto malicioso `../fora.txt`):

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { mkdtempSync, readFileSync, existsSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { copiarBucket } from './copiar-storage.mjs'

function servidor(arvore) {
  // arvore: { 'a.txt': 'oi', 'pasta/c.bin': 'xyz', '../fora.txt': 'mau' }
  let baixados = 0
  const srv = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x')
    if (req.headers.authorization !== 'Bearer segredo') { res.writeHead(401).end(); return }
    if (req.method === 'POST' && u.pathname === '/storage/v1/object/list/b') {
      let corpo = ''
      req.on('data', (d) => (corpo += d))
      req.on('end', () => {
        const { prefix = '', limit = 100, offset = 0 } = JSON.parse(corpo)
        const nomes = Object.keys(arvore).filter((k) => k.startsWith(prefix))
        const itens = new Map()
        for (const k of nomes) {
          const resto = k.slice(prefix.length)
          const i = resto.indexOf('/')
          if (i < 0) itens.set(resto, { name: resto, id: 'id-' + k, metadata: { size: Buffer.byteLength(arvore[k]) } })
          else itens.set(resto.slice(0, i), { name: resto.slice(0, i), id: null, metadata: null })
        }
        const lista = [...itens.values()].slice(offset, offset + limit)
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(lista))
      })
      return
    }
    if (req.method === 'GET' && u.pathname.startsWith('/storage/v1/object/authenticated/b/')) {
      const k = decodeURIComponent(u.pathname.slice('/storage/v1/object/authenticated/b/'.length))
      if (k in arvore) { baixados++; res.writeHead(200).end(arvore[k]); return }
    }
    res.writeHead(404).end()
  })
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r({ srv, url: `http://127.0.0.1:${srv.address().port}`, baixados: () => baixados })))
}

test('copia arquivos e pastas, e uma segunda rodada pula o que já está igual', async () => {
  const { srv, url, baixados } = await servidor({ 'a.txt': 'oi', 'pasta/c.bin': 'xyz' })
  try {
    const destino = mkdtempSync(join(tmpdir(), 'st-'))
    const r1 = await copiarBucket({ url, chave: 'segredo', bucket: 'b', destino })
    assert.deepEqual([r1.copiados, r1.pulados, r1.bytes], [2, 0, 5])
    assert.equal(readFileSync(join(destino, 'b', 'a.txt'), 'utf8'), 'oi')
    assert.equal(readFileSync(join(destino, 'b', 'pasta', 'c.bin'), 'utf8'), 'xyz')
    const r2 = await copiarBucket({ url, chave: 'segredo', bucket: 'b', destino })
    assert.deepEqual([r2.copiados, r2.pulados], [0, 2])
    assert.equal(baixados(), 2) // nada baixado de novo
  } finally { srv.close() }
})

test('nome de objeto com .. não escreve fora da pasta de destino', async () => {
  const { srv, url } = await servidor({ '../fora.txt': 'mau', 'ok.txt': 'bom' })
  try {
    const raiz = mkdtempSync(join(tmpdir(), 'st-'))
    const destino = join(raiz, 'dest')
    await assert.rejects(() => copiarBucket({ url, chave: 'segredo', bucket: 'b', destino }), /caminho inseguro/)
    assert.equal(existsSync(join(raiz, 'fora.txt')), false)
    assert.equal(readdirSync(raiz).includes('fora.txt'), false)
  } finally { srv.close() }
})

test('arquivo parcial (tamanho diferente) é baixado de novo', async () => {
  const { srv, url } = await servidor({ 'a.txt': 'conteudo-inteiro' })
  try {
    const destino = mkdtempSync(join(tmpdir(), 'st-'))
    await copiarBucket({ url, chave: 'segredo', bucket: 'b', destino })
    const { writeFileSync } = await import('node:fs')
    writeFileSync(join(destino, 'b', 'a.txt'), 'conte') // simula cópia interrompida
    const r = await copiarBucket({ url, chave: 'segredo', bucket: 'b', destino })
    assert.deepEqual([r.copiados, r.pulados], [1, 0])
    assert.equal(readFileSync(join(destino, 'b', 'a.txt'), 'utf8'), 'conteudo-inteiro')
  } finally { srv.close() }
})

test('chave errada falha com erro claro e sem imprimir a chave', async () => {
  const { srv, url } = await servidor({ 'a.txt': 'x' })
  try {
    const destino = mkdtempSync(join(tmpdir(), 'st-'))
    await assert.rejects(() => copiarBucket({ url, chave: 'errada', bucket: 'b', destino }), (e) => /401/.test(e.message) && !/errada/.test(e.message))
  } finally { srv.close() }
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test ops/migracao/copiar-storage.test.mjs`
Expected: FAIL (módulo inexistente).

- [ ] **Step 3: Implementar**

`ops/migracao/copiar-storage.mjs`:

```js
// Copia os objetos de um bucket do Supabase Storage para uma pasta local, de forma retomável:
// um arquivo já presente com o MESMO tamanho é pulado; um parcial é baixado de novo.
// Uso: SUPABASE_URL=... SUPABASE_SERVICE_KEY=... node copiar-storage.mjs --destino DIR [--excluir a,b] [--bucket x]
import { mkdirSync, statSync, writeFileSync, renameSync, existsSync } from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'

const PAGINA = 100

function seguro(destinoBucket, caminho) {
  const alvo = resolve(destinoBucket, caminho)
  const raiz = resolve(destinoBucket) + sep
  if (/[\u0000-\u001f]/.test(caminho) || caminho.startsWith('/') || !alvo.startsWith(raiz)) {
    throw new Error(`caminho inseguro no Storage: ${JSON.stringify(caminho)}`)
  }
  return alvo
}

async function chamar(f, url, chave, init = {}) {
  const r = await f(url, { ...init, headers: { authorization: `Bearer ${chave}`, apikey: chave, ...(init.headers || {}) } })
  if (!r.ok) throw new Error(`Storage respondeu ${r.status} em ${new URL(url).pathname}`) // sem a chave na mensagem
  return r
}

async function listar(f, url, chave, bucket, prefixo) {
  const itens = []
  for (let offset = 0; ; offset += PAGINA) {
    const r = await chamar(f, `${url}/storage/v1/object/list/${bucket}`, chave, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prefix: prefixo, limit: PAGINA, offset, sortBy: { column: 'name', order: 'asc' } }),
    })
    const pagina = await r.json()
    itens.push(...pagina)
    if (pagina.length < PAGINA) return itens
  }
}

export async function copiarBucket({ url, chave, bucket, destino, fetch: f = fetch }) {
  const res = { copiados: 0, pulados: 0, bytes: 0 }
  const destinoBucket = join(destino, bucket)
  mkdirSync(destinoBucket, { recursive: true })
  async function visitar(prefixo) {
    for (const it of await listar(f, url, chave, bucket, prefixo)) {
      const caminho = prefixo + it.name
      if (it.id === null) { await visitar(caminho + '/'); continue }
      const alvo = seguro(destinoBucket, caminho)
      const tam = it.metadata?.size
      if (tam != null && existsSync(alvo) && statSync(alvo).size === tam) { res.pulados++; continue }
      const r = await chamar(f, `${url}/storage/v1/object/authenticated/${bucket}/${caminho.split('/').map(encodeURIComponent).join('/')}`, chave)
      const buf = Buffer.from(await r.arrayBuffer())
      mkdirSync(dirname(alvo), { recursive: true })
      writeFileSync(alvo + '.parcial', buf); renameSync(alvo + '.parcial', alvo) // nunca deixa meio-arquivo com o nome final
      res.copiados++; res.bytes += buf.length
    }
  }
  await visitar('')
  return res
}

async function principal() {
  const arg = (n) => { const i = process.argv.indexOf(n); return i < 0 ? undefined : process.argv[i + 1] }
  const destino = arg('--destino'); const so = arg('--bucket'); const excluir = (arg('--excluir') || '').split(',').filter(Boolean)
  const url = process.env.SUPABASE_URL; const chave = process.env.SUPABASE_SERVICE_KEY
  if (!destino || !url || !chave) { console.error('uso: SUPABASE_URL=... SUPABASE_SERVICE_KEY=... node copiar-storage.mjs --destino DIR [--excluir a,b] [--bucket x]'); process.exit(2) }
  const r = await chamar(fetch, `${url}/storage/v1/bucket`, chave)
  const buckets = (await r.json()).map((b) => b.name).filter((b) => (so ? b === so : !excluir.includes(b)))
  let total = { copiados: 0, pulados: 0, bytes: 0 }
  for (const b of buckets) {
    const x = await copiarBucket({ url, chave, bucket: b, destino })
    console.log(`${b}: ${x.copiados} copiados, ${x.pulados} pulados, ${(x.bytes / 1e6).toFixed(1)} MB`)
    for (const k of Object.keys(total)) total[k] += x[k]
  }
  console.log(`total: ${total.copiados} copiados, ${total.pulados} pulados, ${(total.bytes / 1e6).toFixed(1)} MB`)
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], 'file://').href) principal().catch((e) => { console.error(e.message); process.exit(1) })
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test ops/migracao/copiar-storage.test.mjs`
Expected: PASS (4 testes).

- [ ] **Step 5: Commit**

```bash
git add ops/migracao/copiar-storage.mjs ops/migracao/copiar-storage.test.mjs
git commit -m "feat(migracao-go): cópia retomável do Storage do Supabase para disco" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Ensaio cronometrado contra produção (somente leitura) para um alvo local

**Files:**
- Create: `ops/migracao/ensaio.sh`

**Interfaces:**
- Consumes: Tasks 3–6 e `api/cmd/api importar-usuarios` (Plano 1).
- Produces: `sh ops/migracao/ensaio.sh [--manter] [--permitir-alvo-remoto] [--sem-storage] [--excluir-buckets b1,b2]` com `ORIGEM_DATABASE_URL` (e `SUPABASE_URL`/`SUPABASE_SERVICE_KEY` se houver Storage) no ambiente, que: sobe um Postgres 17 **local** vazio, restaura, importa os usuários, confere contagens, copia o Storage e imprime um relatório com a duração de cada etapa (a janela de manutenção do big-bang sai daqui).

- [ ] **Step 1: Escrever o script**

`ops/migracao/ensaio.sh`:

```sh
#!/bin/sh
# Ensaio do corte: produção (SOMENTE LEITURA) -> Postgres local descartável. Cronometra cada etapa.
# Recria o alvo do zero a cada rodada (idempotente). Apaga os dumps no fim, salvo --manter.
# ORIGEM_DATABASE_URL (obrigatória); SUPABASE_URL e SUPABASE_SERVICE_KEY para o Storage.
set -eu
AQUI=$(cd "$(dirname "$0")" && pwd)
RAIZ=$(cd "$AQUI/../.." && pwd)
MANTER=0; REMOTO=0; STORAGE=1; EXCL=""
while [ $# -gt 0 ]; do case "$1" in
  --manter) MANTER=1;; --permitir-alvo-remoto) REMOTO=1;; --sem-storage) STORAGE=0;;
  --excluir-buckets) shift; EXCL=${1:-};; *) echo "opção desconhecida: $1" >&2; exit 2;; esac; shift; done
[ -n "${ORIGEM_DATABASE_URL:-}" ] || { echo "defina ORIGEM_DATABASE_URL (não é impresso)"; exit 1; }
ALVO_URL=${ALVO_DATABASE_URL:-postgres://postgres:x@127.0.0.1:58450/postgres}
# nunca aponta para produção por engano: o alvo tem de ser local
case "$ALVO_URL" in
  *@localhost[:/]*|*@127.0.0.1[:/]*|*@\[::1\][:/]*) ;;
  *) [ "$REMOTO" = 1 ] || { echo "ALVO_DATABASE_URL não é local; recuso (use --permitir-alvo-remoto se for de propósito)" >&2; exit 1; } ;;
esac
OUT="$AQUI/saida/ensaio-$(date +%Y%m%d-%H%M)"; mkdir -p "$OUT"; chmod 700 "$OUT"
rel() { printf '%s\n' "$*" | tee -a "$OUT/relatorio.txt"; }
etapa() { T0=$(date +%s); NOME=$1; shift; "$@"; rel "$(printf '%-34s %5ss' "$NOME" "$(( $(date +%s) - T0 ))")"; }
limpa() { docker rm -f ensaio-alvo >/dev/null 2>&1 || true; [ "$MANTER" = 1 ] || rm -f "$OUT"/dump/schema-bruto.sql "$OUT"/dump/schema.sql "$OUT"/dump/dados.dump; }
trap limpa EXIT INT TERM

sobe_alvo() {
  docker rm -f ensaio-alvo >/dev/null 2>&1 || true
  docker run -d --rm --name ensaio-alvo -e POSTGRES_PASSWORD=x -p 127.0.0.1:58450:5432 postgres:17 >/dev/null
  for i in $(seq 60); do docker exec ensaio-alvo pg_isready -h 127.0.0.1 -U postgres >/dev/null 2>&1 && return 0; sleep 1; done
  echo "alvo local não ficou pronto" >&2; return 1
}
importa_usuarios() ( cd "$RAIZ/api" && DATABASE_URL="$ALVO_URL" ORIGEM_DATABASE_URL="$(printf '%s' "$ORIGEM_DATABASE_URL" | sed 's#:6543/#:5432/#')" go run ./cmd/api importar-usuarios )
storage() {
  [ "$STORAGE" = 1 ] || { echo "(storage pulado)"; return 0; }
  [ -n "${SUPABASE_URL:-}" ] && [ -n "${SUPABASE_SERVICE_KEY:-}" ] || { echo "(storage pulado: faltam SUPABASE_URL/SUPABASE_SERVICE_KEY)"; return 0; }
  node "$AQUI/copiar-storage.mjs" --destino "$OUT/storage" ${EXCL:+--excluir "$EXCL"}
}

rel "ensaio $(date '+%F %T') — origem somente leitura, alvo $(printf '%s' "$ALVO_URL" | sed -E 's#//[^@]*@#//***@#')"
etapa "1. subir Postgres alvo"      sobe_alvo
etapa "2. dump (schema + dados)"    sh "$AQUI/dump-supabase.sh" "$ORIGEM_DATABASE_URL" "$OUT/dump"
etapa "3. restaurar"                sh "$AQUI/restaurar.sh" "$ALVO_URL" "$OUT/dump"
etapa "4. importar usuários"        importa_usuarios
etapa "5. conferir contagens"       sh -c "sh '$AQUI/conferir-contagens.sh' '$ORIGEM_DATABASE_URL' '$ALVO_URL' > '$OUT/contagens.txt' || true"
etapa "5b. conferir órfãos (FKs)"   sh -c "sh '$AQUI/conferir-orfaos.sh' '$ALVO_URL' > '$OUT/orfaos.txt' || true"
etapa "6. copiar Storage"           storage
DIF=$(grep -c DIFERE "$OUT/contagens.txt" || true)
ORF=$(grep -vc ' 0$' "$OUT/orfaos.txt" || true)
rel "FKs para usuarios com órfãos: $ORF (ver $OUT/orfaos.txt)"
rel "tabelas com contagem diferente: $DIF (ver $OUT/contagens.txt; tabela quente pode crescer durante o dump)"
rel "pronto. Somar as etapas 2–6 dá a janela de manutenção do corte."
```

- [ ] **Step 2: Validar a proteção do alvo (sem tocar em produção)**

Run, com uma `ORIGEM_DATABASE_URL` falsa e alvo remoto:
`ORIGEM_DATABASE_URL='postgres://u:p@h/db' ALVO_DATABASE_URL='postgres://u:p@db.exemplo.com/x' sh ops/migracao/ensaio.sh`
Expected: sai com status 1 e a mensagem `ALVO_DATABASE_URL não é local; recuso`, **sem** subir contêiner nem tocar na origem. Run também `sh -n ops/migracao/ensaio.sh`.

- [ ] **Step 3: Commit**

```bash
git add ops/migracao/ensaio.sh
git commit -m "feat(migracao-go): ensaio cronometrado do corte (origem somente leitura, alvo local)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 4: Rodar o ensaio real (leitura em produção, alvo local)**

Quem roda: eu, com a `DATABASE_URL`, o `SUPABASE_URL` e o `SUPABASE_SERVICE_KEY` que já estão no `coletor/.env` (extraídos sem imprimir), **ou** o dono: `! cd <repo> && ORIGEM_DATABASE_URL=... SUPABASE_URL=... SUPABASE_SERVICE_KEY=... sh ops/migracao/ensaio.sh --excluir-buckets ig-cache,fotos-modelo`. Resultado esperado: relatório com as durações; contagens iguais exceto tabelas quentes; **os dumps contêm dado pessoal e segredos: apagados no fim**.

---

## Verificação final do Plano 2

- [ ] `make -C api teste PG_PORTA=58432` verde (compat e `ComUsuario` incluídos), `go vet`, `gofmt` limpos.
- [ ] `node --test ops/migracao/limpar-dump.test.mjs ops/migracao/copiar-storage.test.mjs` verde.
- [ ] `sh ops/migracao/ensaio-local.sh` termina com `OK:` e sem contêineres sobrando.
- [ ] Ensaio real (Task 7 Step 4) com relatório de durações anexado ao PR (sem dados pessoais).
- [ ] `npm test` do repo continua como antes (este plano não toca no front nem nas edges).

## Cobertura da spec e o que vem depois

| Spec | Onde |
|---|---|
| §3.2 Postgres próprio (container, backup, restore testado) | Task 5 |
| §3.2 extensões; sem `pg_cron`/`pg_net`/`vault` | Tasks 1, 3 |
| §6 schema sem policies/grants; identidade via `app.usuario_id` | Tasks 1–3 |
| §6 dado migrado por dump/restore com contagens | Task 4 |
| §7 Storage para disco, mesmo caminho do objeto | Task 6 |
| §9 ensaio repetível e cronometrado | Task 7 |

Próximos planos: 3) edges que o core cobre (Bling, Meta, webhooks Shopify/Chatwoot); 4) worker e crons (24 jobs, `vessel-rd-station`, `guardar-copia-do-banco`); 5) domínios, usando `catalogo-policies-producao.json` e a triagem das 308 funções; 6) Zoho/Microsoft, URLs assinadas e rotas públicas da Vessel; 7) front, robôs/GitHub Actions e consumidores externos; 8) virada e rollback.
