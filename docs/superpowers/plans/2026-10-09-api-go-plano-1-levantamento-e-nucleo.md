# Sair do Supabase — Plano 1: levantamento (fase 0) e núcleo da API em Go

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **Execute num worktree** (superpowers:using-git-worktrees), nunca direto na `main`; a pasta principal tem alterações de outras pessoas. Faça `git add` só dos caminhos de cada task.

**Goal:** Entregar (a) o catálogo das 228 policies e o levantamento read-only de produção que decidem o resto da migração e (b) o núcleo da API em Go: servidor, banco, sessões, login, `Pode()`, importador de usuários e worker com trava.

**Architecture:** Um módulo Go em `api/` com `chi` + `pgx` + `goose`; autenticação por sessão opaca no Postgres; autorização num único ponto (`Ator.Pode`); agendador com `pg_try_advisory_lock`. O catálogo de policies é gerado por um script Node (reaproveita `coletor/objetos-de-uma-migration.mjs`) e será a especificação dos testes de permissão dos próximos planos.

**Tech Stack:** Go 1.24+ (local: 1.27.1), `github.com/go-chi/chi/v5`, `github.com/jackc/pgx/v5`, `github.com/pressly/goose/v3`, `golang.org/x/crypto/bcrypt`, `github.com/robfig/cron/v3`; Postgres 17 em Docker para testes; Node 22 (`node --test`) para o catálogo.

**Spec:** `docs/superpowers/specs/2026-10-09-sair-do-supabase-design.md` (seções 3, 4, 5, 8.1 e 15 são implementadas aqui).

## Global Constraints

- Nada toca produção neste plano. O levantamento (Task 2) é **somente leitura** e só o dono executa, com `default_transaction_read_only=on`.
- Sem ORM e sem framework de injeção de dependência; autorização **negada por padrão**.
- Senha: hash **bcrypt copiado como está** de `auth.users`; ninguém redefine senha.
- Sessão **opaca** guardada como hash SHA-256; token de 256 bits; **sem JWT, sem refresh**.
- Sessão impersonada **nunca renova sozinha**; sessão de tipo `cliente` nunca passa em `Pode`.
- Segredos nunca em tabela nem em arquivo versionado; saídas do levantamento ficam fora do git (`docs/migracao-go/levantamento/` no `.gitignore`).
- Nunca rodar `supabase secrets list` sem filtrar (imprime tudo); só nomes.
- Cron do worker em **UTC**, como o pg_cron.
- Cada commit termina com `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Textos de erro e comentários em português, com acentuação correta.

## Review Focus

Entradas e condições que a spec implica e que nenhuma task óbvia cobriria; cada uma tem teste na task dona:

1. E-mail com maiúsculas e espaços no login entra na mesma conta (Task 5).
2. Usuário desativado **depois** de criar a sessão perde o acesso na hora (Task 4).
3. Sessão expirada ou token inexistente devolve 401, nunca 500 (Task 4/5).
4. Token de cliente da Vessel tentando recurso do painel é negado (Task 6).
5. Corpo de login gigante, JSON inválido ou campos vazios devolvem 400 sem pânico (Task 5).
6. Sessão impersonada não se estende com o uso (Task 4).
7. Duas instâncias do worker disparando a mesma tarefa: só uma executa (Task 8).
8. Importar de novo o mesmo `auth.users` não duplica nem corrompe hashes (Task 7).

## Estrutura de arquivos

```
db/catalogo/policies.mjs                 # extrai policies das migrations (puro, com teste)
db/catalogo/policies.test.mjs
db/catalogo/gerar.mjs                    # CLI: escreve docs/migracao-go/catalogo-policies.json
docs/migracao-go/levantamento.sql        # consultas read-only de produção
docs/migracao-go/levantar.sh             # roda o .sql com transação read-only
docs/migracao-go/levantamento.test.mjs   # prova que o .sql só lê
api/go.mod
api/Makefile                             # make teste (sobe Postgres 17 descartável)
api/cmd/api/main.go                      # subcomandos: api | worker | importar-usuarios
api/internal/config/config.go (+_test)
api/internal/banco/banco.go
api/internal/banco/migracoes/00001_usuarios_e_sessoes.sql
api/internal/testebanco/testebanco.go    # schema isolado por teste
api/internal/auth/senha.go (+_test)
api/internal/auth/sessoes.go (+_test)
api/internal/auth/ator.go
api/internal/auth/pode.go (+_test)
api/internal/auth/limitador.go (+_test)
api/internal/auth/middleware.go
api/internal/auth/rotas.go (+_test)
api/internal/web/rotas.go                # roteador: saúde, pronto, auth
api/internal/importacao/usuarios.go (+_test)
api/internal/worker/worker.go (+_test)
.github/workflows/api.yml
```

---

### Task 1: Catálogo de policies a partir das migrations

**Files:**
- Create: `db/catalogo/policies.mjs`, `db/catalogo/policies.test.mjs`, `db/catalogo/gerar.mjs`
- Modify: `package.json` (acrescentar `'db/**/*.test.mjs'` já existe no script `test`; nada a mudar), `.gitignore` (não há; a saída é versionada)

**Interfaces:**
- Consumes: `semComentario(sql)` de `coletor/objetos-de-uma-migration.mjs`
- Produces: `politicasDe(sql) -> {eventos}` e `catalogo(arquivos: {nome, sql}[]) -> Politica[]`, onde `Politica = { tabela, nome, comando: 'all'|'select'|'insert'|'update'|'delete', papeis: string[], using: string|null, withCheck: string|null, arquivo: string }`

- [ ] **Step 1: Escrever o teste que falha**

`db/catalogo/policies.test.mjs`:

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { catalogo } from './policies.mjs'

const um = (sql) => catalogo([{ nome: 'a.sql', sql }])

test('extrai tabela, nome, comando, using e with check', () => {
  const [p] = um(`create policy "User le proprias" on public.user_permissions
    for select to authenticated using (auth.uid() = user_id) with check (true);`)
  assert.equal(p.tabela, 'user_permissions')
  assert.equal(p.nome, 'user le proprias')
  assert.equal(p.comando, 'select')
  assert.deepEqual(p.papeis, ['authenticated'])
  assert.equal(p.using, 'auth.uid() = user_id')
  assert.equal(p.withCheck, 'true')
})

test('sem FOR o comando é all e sem TO o papel é public', () => {
  const [p] = um(`create policy x on t using (true);`)
  assert.equal(p.comando, 'all')
  assert.deepEqual(p.papeis, ['public'])
})

test('using com parênteses aninhados e ponto e vírgula dentro de texto', () => {
  const [p] = um(`create policy x on t for all using (
    exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'a;b'));`)
  assert.equal(p.using, "exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'a;b')")
})

test('drop policy remove e create posterior substitui', () => {
  const r = catalogo([
    { nome: '1.sql', sql: `create policy x on t for select using (true); create policy y on t using (true);` },
    { nome: '2.sql', sql: `drop policy if exists y on t; create policy x on t for select using (false);` },
  ])
  assert.equal(r.length, 1)
  assert.equal(r[0].nome, 'x')
  assert.equal(r[0].using, 'false')
  assert.equal(r[0].arquivo, '2.sql')
})

test('ignora policy dentro de comentário', () => {
  assert.equal(um(`-- create policy x on t using (true);\n/* create policy y on t using (true); */`).length, 0)
})

test('papéis múltiplos', () => {
  const [p] = um(`create policy x on t for select to anon, authenticated using (true);`)
  assert.deepEqual(p.papeis, ['anon', 'authenticated'])
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test db/catalogo/policies.test.mjs`
Expected: FAIL com `Cannot find module './policies.mjs'`.

- [ ] **Step 3: Implementar**

`db/catalogo/policies.mjs`:

```js
// CATÁLOGO DE POLICIES lido do texto das migrations (sem banco, sem rede).
// É um CRUZAMENTO, não a verdade: a verdade é `pg_policies` de produção
// (docs/migracao-go/levantamento.sql). A ordem aplicada é a ordem dos arquivos.
import { semComentario } from '../../coletor/objetos-de-uma-migration.mjs'

const nome = (s) => String(s).replace(/^public\./i, '').replace(/^"|"$/g, '').toLowerCase()

// Acha o fim do comando (';' fora de parênteses e de aspas simples).
function fimDoComando(s, de) {
  let d = 0, aspas = false
  for (let i = de; i < s.length; i++) {
    const c = s[i]
    if (c === "'") aspas = !aspas
    else if (!aspas && c === '(') d++
    else if (!aspas && c === ')') d--
    else if (!aspas && d === 0 && c === ';') return i
  }
  return s.length
}

// Devolve o conteúdo do parêntese que abre em s[i].
function conteudoDoParentese(s, i) {
  let d = 0, aspas = false
  for (let j = i; j < s.length; j++) {
    const c = s[j]
    if (c === "'") aspas = !aspas
    else if (!aspas && c === '(') d++
    else if (!aspas && c === ')') { d--; if (d === 0) return s.slice(i + 1, j).trim() }
  }
  return null
}

function clausula(corpo, re) {
  const m = re.exec(corpo)
  return m ? conteudoDoParentese(corpo, m.index + m[0].length - 1) : null
}

export function catalogo(arquivos) {
  const mapa = new Map()
  for (const { nome: arquivo, sql } of arquivos) {
    const s = semComentario(sql)
    const eventos = []
    for (const m of s.matchAll(/drop\s+policy\s+(?:if\s+exists\s+)?("[^"]+"|\w+)\s+on\s+([\w".]+)/gi)) {
      eventos.push({ pos: m.index, drop: true, nome: nome(m[1]), tabela: nome(m[2]) })
    }
    for (const m of s.matchAll(/create\s+policy\s+("[^"]+"|\w+)\s+on\s+([\w".]+)/gi)) {
      const corpo = s.slice(m.index, fimDoComando(s, m.index))
      const cmd = /\bfor\s+(all|select|insert|update|delete)\b/i.exec(corpo)
      const to = /\bto\s+([\w",\s]+?)(?=\s+(?:using|with)\b|\s*$)/i.exec(corpo)
      eventos.push({
        pos: m.index, drop: false, nome: nome(m[1]), tabela: nome(m[2]),
        comando: cmd ? cmd[1].toLowerCase() : 'all',
        papeis: to ? to[1].split(',').map((x) => x.trim().replace(/"/g, '').toLowerCase()).filter(Boolean) : ['public'],
        using: clausula(corpo, /\busing\s*\(/i),
        withCheck: clausula(corpo, /\bwith\s+check\s*\(/i),
        arquivo,
      })
    }
    eventos.sort((a, b) => a.pos - b.pos)
    for (const e of eventos) {
      const k = `${e.tabela}|${e.nome}`
      if (e.drop) mapa.delete(k)
      else mapa.set(k, { tabela: e.tabela, nome: e.nome, comando: e.comando, papeis: e.papeis, using: e.using, withCheck: e.withCheck, arquivo: e.arquivo })
    }
  }
  return [...mapa.values()].sort((a, b) => a.tabela.localeCompare(b.tabela) || a.nome.localeCompare(b.nome))
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test db/catalogo/policies.test.mjs`
Expected: PASS (6 testes).

- [ ] **Step 5: CLI que gera o catálogo**

`db/catalogo/gerar.mjs`:

```js
// Uso: node db/catalogo/gerar.mjs  -> docs/migracao-go/catalogo-policies.json
import { readdirSync, readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { catalogo } from './policies.mjs'

const RAIZ = new URL('../..', import.meta.url).pathname
const sqls = (dir) => readdirSync(dir, { recursive: true })
  .map(String).filter((f) => f.endsWith('.sql')).map((f) => join(dir, f))
  .filter((f) => statSync(f).isFile())

const arquivos = [...sqls(join(RAIZ, 'db/migrations')), ...sqls(join(RAIZ, 'supabase/migrations'))]
  .sort((a, b) => relative(RAIZ, a).localeCompare(relative(RAIZ, b)))
  .map((f) => ({ nome: relative(RAIZ, f), sql: readFileSync(f, 'utf8') }))

const lista = catalogo(arquivos)
mkdirSync(join(RAIZ, 'docs/migracao-go'), { recursive: true })
writeFileSync(join(RAIZ, 'docs/migracao-go/catalogo-policies.json'), JSON.stringify(lista, null, 2) + '\n')
console.log(`${lista.length} policies em ${new Set(lista.map((p) => p.tabela)).size} tabelas`)
```

Run: `node db/catalogo/gerar.mjs`
Expected: imprime algo como `NNN policies em MMM tabelas` (a ordem é por nome de arquivo e o catálogo é um cruzamento; o número esperado é próximo de 228 e qualquer diferença grande deve ser anotada na Task 2).

- [ ] **Step 6: Commit**

```bash
git add db/catalogo docs/migracao-go/catalogo-policies.json
git commit -m "feat(migracao-go): catálogo de policies extraído das migrations" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Consultas de levantamento em produção (somente leitura)

**Files:**
- Create: `docs/migracao-go/levantamento.sql`, `docs/migracao-go/levantar.sh`, `docs/migracao-go/levantamento.test.mjs`
- Modify: `.gitignore` (acrescentar `docs/migracao-go/levantamento/`)

**Interfaces:**
- Produces: arquivos CSV em `docs/migracao-go/levantamento/` (fora do git) que alimentam os Planos 2+.

- [ ] **Step 1: Teste que prova que o SQL só lê**

`docs/migracao-go/levantamento.test.mjs`:

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { semComentario } from '../../coletor/objetos-de-uma-migration.mjs'

const sql = semComentario(readFileSync(new URL('./levantamento.sql', import.meta.url), 'utf8'))

test('levantamento.sql só tem SELECT', () => {
  const proibidas = /\b(insert|update|delete|drop|alter|create|truncate|grant|revoke|copy|vacuum|call|do)\b/i
  assert.equal(proibidas.test(sql), false, 'comando que escreve no banco')
  const comandos = sql.split(';').map((c) => c.trim()).filter(Boolean)
  assert.ok(comandos.length >= 10)
  for (const c of comandos) assert.match(c, /^(select|with)\b/i, `não é SELECT: ${c.slice(0, 60)}`)
})

test('levantar.sh força transação somente leitura e não imprime URL', () => {
  const sh = readFileSync(new URL('./levantar.sh', import.meta.url), 'utf8')
  assert.match(sh, /default_transaction_read_only=on/)
  assert.doesNotMatch(sh, /echo\s+"?\$\{?DATABASE_URL/)
})
```

- [ ] **Step 2: Ver falhar**

Run: `node --test docs/migracao-go/levantamento.test.mjs`
Expected: FAIL (arquivo não existe).

- [ ] **Step 3: Escrever o SQL**

`docs/migracao-go/levantamento.sql` (cada consulta termina com `;` e vira um CSV pelo script):

```sql
-- 01 policies reais
select schemaname, tablename, policyname, permissive, roles::text, cmd, qual, with_check from pg_policies where schemaname = 'public' order by 1, 2, 3;
-- 02 funções do schema public (corpo completo)
select p.proname, pg_get_function_identity_arguments(p.oid) as args, p.prosecdef as security_definer, pg_get_functiondef(p.oid) as definicao from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.prokind = 'f' order by 1, 2;
-- 03 triggers
select event_object_table, trigger_name, action_timing, event_manipulation, action_statement from information_schema.triggers where trigger_schema = 'public' order by 1, 2;
-- 04 agendamentos reais do pg_cron
select jobid, jobname, schedule, active, command from cron.job order by jobid;
-- 05 extensões instaladas
select extname, extversion from pg_extension order by 1;
-- 06 tamanho do banco
select current_database() as banco, pg_size_pretty(pg_database_size(current_database())) as tamanho;
-- 07 linhas por tabela (estimativa) — as 80 maiores
select relname, n_live_tup from pg_stat_user_tables order by n_live_tup desc limit 80;
-- 08 usuários do Auth
select count(*) as usuarios, count(*) filter (where coalesce(encrypted_password, '') <> '') as com_senha, count(*) filter (where banned_until > now()) as banidos from auth.users;
-- 09 provedores de login
select provider, count(*) as n from auth.identities group by 1 order by 2 desc;
-- 10 buckets e objetos
select b.id, b.public, b.file_size_limit, b.allowed_mime_types::text, count(o.id) as objetos, pg_size_pretty(coalesce(sum((o.metadata ->> 'size')::bigint), 0)) as tamanho from storage.buckets b left join storage.objects o on o.bucket_id = b.id group by b.id, b.public, b.file_size_limit, b.allowed_mime_types order by 1;
-- 11 views
select viewname, definition from pg_views where schemaname = 'public' order by 1;
-- 12 colunas de profiles (modelo de permissão real)
select column_name, data_type, is_nullable from information_schema.columns where table_schema = 'public' and table_name = 'profiles' order by ordinal_position;
-- 13 sequências e tabelas sem chave primária (risco de importação)
select c.relname as tabela from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and not exists (select 1 from pg_index i where i.indrelid = c.oid and i.indisprimary) order by 1;
```

- [ ] **Step 4: Escrever o script**

`docs/migracao-go/levantar.sh`:

```sh
#!/bin/sh
# Roda levantamento.sql em transação SOMENTE LEITURA e grava um CSV por consulta
# em docs/migracao-go/levantamento/ (pasta fora do git: pode conter corpo de função).
# Uso (quem roda é o dono): DATABASE_URL='postgres://...' sh docs/migracao-go/levantar.sh
set -eu
[ -n "${DATABASE_URL:-}" ] || { echo "defina DATABASE_URL (não é impresso)"; exit 1; }
AQUI=$(cd "$(dirname "$0")" && pwd)
SAIDA="$AQUI/levantamento"
mkdir -p "$SAIDA"
export PGOPTIONS='-c default_transaction_read_only=on -c statement_timeout=60000'
n=0
# separa por consulta: cada bloco começa com "-- NN titulo"
awk -v dir="$SAIDA" '/^-- [0-9][0-9] /{f=dir"/"$2"-"$3".sql"; sub(/ +$/,"",f)} f && !/^--/{print > f}' "$AQUI/levantamento.sql"
for f in "$SAIDA"/*.sql; do
  psql "$DATABASE_URL" -X -q --csv -f "$f" -o "${f%.sql}.csv" && n=$((n+1)) || echo "falhou: $(basename "$f")"
done
echo "$n consultas gravadas em docs/migracao-go/levantamento/"
```

- [ ] **Step 5: Ver passar e ignorar a saída**

```bash
echo 'docs/migracao-go/levantamento/' >> .gitignore
node --test docs/migracao-go/levantamento.test.mjs
```
Expected: PASS (2 testes).

- [ ] **Step 6: Ensaio do script em banco local (sem produção)**

Run (usa o Postgres do Docker local; o `auth`/`cron`/`storage` não existem, então só as consultas 01–07, 11–13 devem gerar CSV e as demais aparecem como `falhou`; isso é esperado e prova que nada escreve):
```bash
docker run -d --rm --name pg-levantamento -e POSTGRES_PASSWORD=x -p 55433:5432 postgres:17
sleep 4
DATABASE_URL='postgres://postgres:x@localhost:55433/postgres' sh docs/migracao-go/levantar.sh
docker stop pg-levantamento
```
Expected: mensagem `N consultas gravadas ...` e `falhou:` para as de `auth`, `cron`, `storage`.

- [ ] **Step 7: Commit**

```bash
git add docs/migracao-go/levantamento.sql docs/migracao-go/levantar.sh docs/migracao-go/levantamento.test.mjs .gitignore
git commit -m "feat(migracao-go): consultas de levantamento somente leitura" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 8: Pedir ao dono para rodar em produção (não executar sozinho)**

Texto para o dono (uma linha, para colar): `! DATABASE_URL='<string de conexão do Supabase, usuário postgres>' sh docs/migracao-go/levantar.sh`. Separadamente, para os nomes dos segredos das edges (sem valores): `! npx supabase secrets list --project-ref kounqtdoioootxqegkij --output json | jq -r '.[].name' | sort > docs/migracao-go/levantamento/segredos-nomes.txt`. Resultado esperado: CSVs na pasta ignorada. **Os Planos 2+ só são escritos depois disso**; os 7 itens abertos da seção 15 da spec (inclusive `vessel-rd-station`, extras do `social-dashboard-token`, plano e custo) são fechados com estes arquivos e com o painel.

---

### Task 3: Módulo Go, configuração, banco e roteador mínimo

**Files:**
- Create: `api/go.mod` (via `go mod init`), `api/Makefile`, `api/cmd/api/main.go`, `api/internal/config/config.go`, `api/internal/config/config_test.go`, `api/internal/banco/banco.go`, `api/internal/banco/migracoes/00001_usuarios_e_sessoes.sql`, `api/internal/testebanco/testebanco.go`, `api/internal/web/rotas.go`, `.github/workflows/api.yml`

**Interfaces:**
- Produces: `config.Carregar() (Config, error)` com `Config{Addr, DatabaseURL string; Origens []string}`; `banco.Abrir(ctx, url) (*pgxpool.Pool, error)`; `banco.Migrar(*pgxpool.Pool) error`; `testebanco.Novo(t *testing.T) *pgxpool.Pool` (schema isolado, migrado, com `profiles` e `robos_execucoes` mínimas); `web.Rotas(p *pgxpool.Pool, s *auth.Store, l *auth.Limitador) http.Handler` (esta assinatura é completada na Task 5).

- [ ] **Step 1: Inicializar o módulo**

```bash
mkdir -p api && cd api
go mod init github.com/rbv-co/social-dashboard/api
```

- [ ] **Step 2: Teste de config (falha)**

`api/internal/config/config_test.go`:

```go
package config

import "testing"

func TestCarregarExigeDatabaseURL(t *testing.T) {
	t.Setenv("DATABASE_URL", "")
	if _, err := Carregar(); err == nil {
		t.Fatal("deveria recusar sem DATABASE_URL")
	}
}

func TestCarregarPadroes(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://x")
	t.Setenv("ADDR", "")
	t.Setenv("ORIGENS_PERMITIDAS", " https://a.com , ,https://b.com ")
	c, err := Carregar()
	if err != nil {
		t.Fatal(err)
	}
	if c.Addr != ":8080" {
		t.Fatalf("Addr = %q", c.Addr)
	}
	if len(c.Origens) != 2 || c.Origens[0] != "https://a.com" || c.Origens[1] != "https://b.com" {
		t.Fatalf("Origens = %#v", c.Origens)
	}
}
```

Run: `cd api && go test ./internal/config/...`
Expected: FAIL (`undefined: Carregar`).

- [ ] **Step 3: Implementar config**

`api/internal/config/config.go`:

```go
// Package config lê a configuração do processo a partir de variáveis de ambiente.
package config

import (
	"errors"
	"os"
	"strings"
)

type Config struct {
	Addr        string
	DatabaseURL string
	Origens     []string // CORS: usado quando as rotas públicas entrarem (plano da Vessel)
}

func Carregar() (Config, error) {
	c := Config{Addr: os.Getenv("ADDR"), DatabaseURL: os.Getenv("DATABASE_URL")}
	if c.Addr == "" {
		c.Addr = ":8080"
	}
	if c.DatabaseURL == "" {
		return c, errors.New("DATABASE_URL ausente")
	}
	for _, o := range strings.Split(os.Getenv("ORIGENS_PERMITIDAS"), ",") {
		if o = strings.TrimSpace(o); o != "" {
			c.Origens = append(c.Origens, o)
		}
	}
	return c, nil
}
```

Run: `go test ./internal/config/...` → Expected: PASS.

- [ ] **Step 4: Migration base e pacote banco**

`api/internal/banco/migracoes/00001_usuarios_e_sessoes.sql`:

```sql
-- +goose Up
create table usuarios (
  id                  uuid primary key,
  email               text not null,
  senha_hash          text,
  email_confirmado_em timestamptz,
  criado_em           timestamptz not null default now(),
  desativado_em       timestamptz
);
create unique index usuarios_email_unico on usuarios (lower(email));

create table sessoes (
  token_hash      text primary key,
  usuario_id      uuid not null references usuarios (id) on delete cascade,
  tipo            text not null default 'painel' check (tipo in ('painel', 'cliente', 'servico')),
  impersonador_id uuid references usuarios (id),
  criada_em       timestamptz not null default now(),
  expira_em       timestamptz not null,
  ultimo_uso_em   timestamptz not null default now()
);
create index sessoes_usuario_idx on sessoes (usuario_id);

-- +goose Down
drop table sessoes;
drop table usuarios;
```

`api/internal/banco/banco.go`:

```go
// Package banco abre o pool do Postgres e aplica as migrations embutidas.
package banco

import (
	"context"
	"embed"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/jackc/pgx/v5/stdlib"
	"github.com/pressly/goose/v3"
)

//go:embed migracoes/*.sql
var migracoes embed.FS

func Abrir(ctx context.Context, url string) (*pgxpool.Pool, error) {
	p, err := pgxpool.New(ctx, url)
	if err != nil {
		return nil, err
	}
	if err := p.Ping(ctx); err != nil {
		p.Close()
		return nil, err
	}
	return p, nil
}

func Migrar(p *pgxpool.Pool) error {
	goose.SetBaseFS(migracoes)
	if err := goose.SetDialect("postgres"); err != nil {
		return err
	}
	db := stdlib.OpenDBFromPool(p)
	defer db.Close()
	return goose.Up(db, "migracoes")
}
```

- [ ] **Step 5: Helper de teste (schema isolado por teste)**

`api/internal/testebanco/testebanco.go`:

```go
// Package testebanco dá a cada teste um schema novo e migrado num Postgres real.
// Pula sozinho se TEST_DATABASE_URL não existir (use `make teste`).
package testebanco

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"os"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/banco"
)

// Tabelas que em produção vêm do dump do Supabase. Aqui só o mínimo que o núcleo lê.
const legado = `
create table profiles (
  id uuid primary key, email text, role text,
  is_superadmin boolean default false, permissions jsonb default '{}'::jsonb
);
create table robos_execucoes (
  id bigserial primary key, robo text not null, request_id bigint,
  disparado_em timestamptz not null default now(), status_code int, ok boolean,
  resposta text, conferido_em timestamptz
);`

func Novo(t *testing.T) *pgxpool.Pool {
	t.Helper()
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		t.Skip("TEST_DATABASE_URL ausente: rode `make teste` em api/")
	}
	ctx := context.Background()
	admin, err := pgx.Connect(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	b := make([]byte, 6)
	rand.Read(b)
	esquema := "t_" + hex.EncodeToString(b)
	if _, err := admin.Exec(ctx, "create schema "+esquema); err != nil {
		t.Fatal(err)
	}
	cfg, err := pgxpool.ParseConfig(url)
	if err != nil {
		t.Fatal(err)
	}
	cfg.ConnConfig.RuntimeParams["search_path"] = esquema
	p, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		p.Close()
		admin.Exec(ctx, "drop schema "+esquema+" cascade")
		admin.Close(ctx)
	})
	if err := banco.Migrar(p); err != nil {
		t.Fatal(err)
	}
	if _, err := p.Exec(ctx, legado); err != nil {
		t.Fatal(err)
	}
	return p
}
```

- [ ] **Step 6: Makefile e roteador mínimo com teste**

`api/Makefile`:

```make
PG_PORTA ?= 55432
teste:
	-docker rm -f pg-api-teste >/dev/null 2>&1
	docker run -d --rm --name pg-api-teste -e POSTGRES_PASSWORD=x -p $(PG_PORTA):5432 postgres:17 >/dev/null
	until docker exec pg-api-teste pg_isready -U postgres >/dev/null 2>&1; do sleep 1; done
	TEST_DATABASE_URL=postgres://postgres:x@localhost:$(PG_PORTA)/postgres?sslmode=disable go test ./... ; s=$$?; docker stop pg-api-teste >/dev/null; exit $$s
```

`api/internal/web/rotas_test.go`:

```go
package web

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/rbv-co/social-dashboard/api/internal/auth"
	"github.com/rbv-co/social-dashboard/api/internal/testebanco"
)

func TestSaudeEProntoSemAutenticacao(t *testing.T) {
	p := testebanco.Novo(t)
	h := Rotas(p, auth.NovoStore(p), auth.NovoLimitador())
	for _, caminho := range []string{"/saude", "/pronto"} {
		r := httptest.NewRecorder()
		h.ServeHTTP(r, httptest.NewRequest("GET", caminho, nil))
		if r.Code != http.StatusOK {
			t.Fatalf("%s = %d", caminho, r.Code)
		}
	}
}
```

(Este teste só compila depois da Task 5; ele nasce aqui e é o primeiro a ser executado ao final dela. Se preferir manter o ciclo verde, comente-o e descomente na Task 5.)

`api/internal/web/rotas.go`:

```go
// Package web monta o roteador HTTP.
package web

import (
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/auth"
)

func Rotas(p *pgxpool.Pool, s *auth.Store, l *auth.Limitador) http.Handler {
	r := chi.NewRouter()
	r.Use(middleware.RealIP) // ponytail: confia em X-Forwarded-For; só serve atrás do nginx
	r.Get("/saude", func(w http.ResponseWriter, _ *http.Request) { w.Write([]byte("ok")) })
	r.Get("/pronto", func(w http.ResponseWriter, r *http.Request) {
		if err := p.Ping(r.Context()); err != nil {
			http.Error(w, "banco indisponível", http.StatusServiceUnavailable)
			return
		}
		w.Write([]byte("ok"))
	})
	h := auth.NovosHandlers(p, s, l)
	r.Post("/auth/entrar", h.Entrar)
	r.Group(func(r chi.Router) {
		r.Use(auth.Exigir(p, s))
		r.Post("/auth/sair", h.Sair)
		r.Get("/auth/eu", h.Eu)
	})
	return r
}
```

- [ ] **Step 7: `main.go` com subcomandos**

`api/cmd/api/main.go`:

```go
package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/rbv-co/social-dashboard/api/internal/auth"
	"github.com/rbv-co/social-dashboard/api/internal/banco"
	"github.com/rbv-co/social-dashboard/api/internal/config"
	"github.com/rbv-co/social-dashboard/api/internal/web"
)

func main() {
	if len(os.Args) < 2 {
		slog.Error("uso: api <api|worker|importar-usuarios>")
		os.Exit(2)
	}
	ctx, parar := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer parar()
	cfg, err := config.Carregar()
	if err != nil {
		slog.Error("configuração", "erro", err)
		os.Exit(1)
	}
	p, err := banco.Abrir(ctx, cfg.DatabaseURL)
	if err != nil {
		slog.Error("banco", "erro", err)
		os.Exit(1)
	}
	defer p.Close()
	if err := banco.Migrar(p); err != nil {
		slog.Error("migrations", "erro", err)
		os.Exit(1)
	}
	switch os.Args[1] {
	case "api":
		srv := &http.Server{Addr: cfg.Addr, Handler: web.Rotas(p, auth.NovoStore(p), auth.NovoLimitador()), ReadHeaderTimeout: 10 * time.Second}
		go func() { <-ctx.Done(); srv.Shutdown(context.Background()) }()
		slog.Info("api no ar", "addr", cfg.Addr)
		if err := srv.ListenAndServe(); !errors.Is(err, http.ErrServerClosed) {
			slog.Error("servidor", "erro", err)
			os.Exit(1)
		}
	default:
		slog.Error("subcomando desconhecido", "cmd", os.Args[1])
		os.Exit(2)
	}
}
```

(`worker` e `importar-usuarios` entram nas Tasks 7 e 8.)

- [ ] **Step 8: Dependências e commit**

```bash
cd api && go get github.com/go-chi/chi/v5 github.com/jackc/pgx/v5 github.com/pressly/goose/v3 golang.org/x/crypto github.com/robfig/cron/v3 && go mod tidy
```
(`go mod tidy` só termina limpo depois que as Tasks 4 a 8 existirem; até lá ignore avisos de pacote ausente.)

Workflow de CI `.github/workflows/api.yml`:

```yaml
name: API Go
on:
  push: { branches: [main], paths: ['api/**'] }
  pull_request: { paths: ['api/**'] }
jobs:
  api:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:17
        env: { POSTGRES_PASSWORD: x }
        ports: ['5432:5432']
        options: >-
          --health-cmd pg_isready --health-interval 5s --health-timeout 5s --health-retries 10
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-go@v5
        with: { go-version-file: api/go.mod }
      - run: cd api && go vet ./... && go test ./...
        env:
          TEST_DATABASE_URL: postgres://postgres:x@localhost:5432/postgres?sslmode=disable
```

Nota: o CI do GitHub do projeto está bloqueado por billing (jobs nem iniciam); o gate real é `make teste` local.

```bash
git add api/go.mod api/go.sum api/Makefile api/cmd api/internal/config api/internal/banco api/internal/testebanco api/internal/web .github/workflows/api.yml
git commit -m "feat(api): módulo Go, config, banco com migration base e roteador" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Senha e sessões

**Files:**
- Create: `api/internal/auth/senha.go`, `senha_test.go`, `sessoes.go`, `sessoes_test.go`

**Interfaces:**
- Produces:
  - `auth.HashDaSenha(senha string) (string, error)`; `auth.SenhaConfere(hash, senha string) bool`
  - `type Sessao struct{ UsuarioID, Tipo string; ImpersonadorID *string; ExpiraEm time.Time }`
  - `type Store struct{ TTL time.Duration; ... }`; `auth.NovoStore(*pgxpool.Pool) *Store`
  - `(*Store).Criar(ctx, usuarioID, tipo string, impersonadorID *string) (token string, err error)`
  - `(*Store).Buscar(ctx, token string) (*Sessao, error)` devolve `auth.ErrSessaoInvalida`
  - `(*Store).Revogar(ctx, token string) error`

- [ ] **Step 1: Testes de senha (falham)**

`api/internal/auth/senha_test.go`:

```go
package auth

import (
	"strings"
	"testing"
)

func TestSenhaRoundTrip(t *testing.T) {
	h, err := HashDaSenha("correta")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(h, "$2a$") { // mesmo prefixo que o GoTrue grava
		t.Fatalf("prefixo inesperado: %q", h[:4])
	}
	if !SenhaConfere(h, "correta") || SenhaConfere(h, "errada") || SenhaConfere("", "correta") {
		t.Fatal("conferência incorreta")
	}
}
```

Run: `cd api && go test ./internal/auth/ -run Senha` → FAIL (`undefined`).

- [ ] **Step 2: Implementar senha**

`api/internal/auth/senha.go`:

```go
package auth

import "golang.org/x/crypto/bcrypt"

func HashDaSenha(senha string) (string, error) {
	b, err := bcrypt.GenerateFromPassword([]byte(senha), bcrypt.DefaultCost)
	return string(b), err
}

// SenhaConfere aceita o hash bcrypt como o GoTrue o gravou ($2a$...).
func SenhaConfere(hash, senha string) bool {
	return bcrypt.CompareHashAndPassword([]byte(hash), []byte(senha)) == nil
}
```

Run → PASS.

- [ ] **Step 3: Testes de sessão (falham)**

`api/internal/auth/sessoes_test.go`:

```go
package auth

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/rbv-co/social-dashboard/api/internal/testebanco"
)

const uid = "11111111-1111-1111-1111-111111111111"
const uid2 = "22222222-2222-2222-2222-222222222222"

func novoUsuario(t *testing.T, s *Store, id, email string) {
	t.Helper()
	if _, err := s.pool.Exec(context.Background(), `insert into usuarios (id, email) values ($1, $2)`, id, email); err != nil {
		t.Fatal(err)
	}
}

func TestCriarEBuscar(t *testing.T) {
	s := NovoStore(testebanco.Novo(t))
	novoUsuario(t, s, uid, "a@x.com")
	tok, err := s.Criar(context.Background(), uid, "painel", nil)
	if err != nil || tok == "" {
		t.Fatal(err)
	}
	se, err := s.Buscar(context.Background(), tok)
	if err != nil || se.UsuarioID != uid || se.Tipo != "painel" || se.ImpersonadorID != nil {
		t.Fatalf("sessão = %+v, err = %v", se, err)
	}
	// o token em claro nunca é guardado
	var n int
	s.pool.QueryRow(context.Background(), `select count(*) from sessoes where token_hash = $1`, tok).Scan(&n)
	if n != 0 {
		t.Fatal("token guardado em claro")
	}
}

func TestTokenInexistenteEExpirada(t *testing.T) {
	s := NovoStore(testebanco.Novo(t))
	novoUsuario(t, s, uid, "a@x.com")
	if _, err := s.Buscar(context.Background(), "nao-existe"); !errors.Is(err, ErrSessaoInvalida) {
		t.Fatalf("err = %v", err)
	}
	tok, _ := s.Criar(context.Background(), uid, "painel", nil)
	s.agora = func() time.Time { return time.Now().Add(s.TTL + time.Minute) }
	if _, err := s.Buscar(context.Background(), tok); !errors.Is(err, ErrSessaoInvalida) {
		t.Fatalf("expirada deveria ser inválida, err = %v", err)
	}
}

func TestUsuarioDesativadoDepoisDaSessaoPerdeAcesso(t *testing.T) {
	s := NovoStore(testebanco.Novo(t))
	novoUsuario(t, s, uid, "a@x.com")
	tok, _ := s.Criar(context.Background(), uid, "painel", nil)
	s.pool.Exec(context.Background(), `update usuarios set desativado_em = now() where id = $1`, uid)
	if _, err := s.Buscar(context.Background(), tok); !errors.Is(err, ErrSessaoInvalida) {
		t.Fatalf("err = %v", err)
	}
}

func TestRenovacaoDeslizanteMasNuncaParaImpersonada(t *testing.T) {
	s := NovoStore(testebanco.Novo(t))
	novoUsuario(t, s, uid, "a@x.com")
	novoUsuario(t, s, uid2, "adm@x.com")
	normal, _ := s.Criar(context.Background(), uid, "painel", nil)
	imp := uid2
	impersonada, _ := s.Criar(context.Background(), uid, "painel", &imp)
	antesN, _ := s.Buscar(context.Background(), normal)
	antesI, _ := s.Buscar(context.Background(), impersonada)
	s.agora = func() time.Time { return time.Now().Add(10 * time.Minute) }
	depoisN, _ := s.Buscar(context.Background(), normal)
	depoisI, _ := s.Buscar(context.Background(), impersonada)
	if !depoisN.ExpiraEm.After(antesN.ExpiraEm) {
		t.Fatal("sessão normal deveria renovar")
	}
	if !depoisI.ExpiraEm.Equal(antesI.ExpiraEm) {
		t.Fatal("sessão impersonada não pode renovar")
	}
}

func TestRevogar(t *testing.T) {
	s := NovoStore(testebanco.Novo(t))
	novoUsuario(t, s, uid, "a@x.com")
	tok, _ := s.Criar(context.Background(), uid, "painel", nil)
	if err := s.Revogar(context.Background(), tok); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Buscar(context.Background(), tok); !errors.Is(err, ErrSessaoInvalida) {
		t.Fatalf("err = %v", err)
	}
}
```

Run: `make -C api teste` → FAIL (`undefined: NovoStore`).

- [ ] **Step 4: Implementar sessões**

`api/internal/auth/sessoes.go`:

```go
package auth

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var ErrSessaoInvalida = errors.New("sessão inválida")

type Sessao struct {
	UsuarioID      string
	Tipo           string
	ImpersonadorID *string
	ExpiraEm       time.Time
}

type Store struct {
	TTL   time.Duration
	pool  *pgxpool.Pool
	agora func() time.Time
}

func NovoStore(p *pgxpool.Pool) *Store {
	return &Store{TTL: 12 * time.Hour, pool: p, agora: time.Now}
}

func hashDoToken(t string) string {
	h := sha256.Sum256([]byte(t))
	return hex.EncodeToString(h[:])
}

func (s *Store) Criar(ctx context.Context, usuarioID, tipo string, impersonadorID *string) (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	token := base64.RawURLEncoding.EncodeToString(b)
	agora := s.agora()
	_, err := s.pool.Exec(ctx,
		`insert into sessoes (token_hash, usuario_id, tipo, impersonador_id, criada_em, expira_em, ultimo_uso_em)
		 values ($1, $2, $3, $4, $5, $6, $5)`,
		hashDoToken(token), usuarioID, tipo, impersonadorID, agora, agora.Add(s.TTL))
	return token, err
}

// Buscar valida o token e, só para sessão normal, renova a expiração
// (no máximo a cada 5 min, para não escrever no banco a cada requisição).
func (s *Store) Buscar(ctx context.Context, token string) (*Sessao, error) {
	h := hashDoToken(token)
	agora := s.agora()
	var se Sessao
	var ultimo time.Time
	err := s.pool.QueryRow(ctx,
		`select s.usuario_id::text, s.tipo, s.impersonador_id::text, s.expira_em, s.ultimo_uso_em
		   from sessoes s join usuarios u on u.id = s.usuario_id
		  where s.token_hash = $1 and u.desativado_em is null`, h).
		Scan(&se.UsuarioID, &se.Tipo, &se.ImpersonadorID, &se.ExpiraEm, &ultimo)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrSessaoInvalida
	}
	if err != nil {
		return nil, err
	}
	if !agora.Before(se.ExpiraEm) {
		return nil, ErrSessaoInvalida
	}
	if se.ImpersonadorID == nil && agora.Sub(ultimo) > 5*time.Minute {
		novo := agora.Add(s.TTL)
		if _, err := s.pool.Exec(ctx, `update sessoes set expira_em = $2, ultimo_uso_em = $3 where token_hash = $1`, h, novo, agora); err != nil {
			return nil, err
		}
		se.ExpiraEm = novo
	}
	return &se, nil
}

func (s *Store) Revogar(ctx context.Context, token string) error {
	_, err := s.pool.Exec(ctx, `delete from sessoes where token_hash = $1`, hashDoToken(token))
	return err
}
```

- [ ] **Step 5: Rodar e commit**

Run: `make -C api teste` (os testes de `auth` rodam; os de `web` ainda não compilam: use `cd api && TEST_DATABASE_URL=... go test ./internal/auth/` ou rode `make teste` depois da Task 5).
Expected: PASS em `TestSenhaRoundTrip`, `TestCriarEBuscar`, `TestTokenInexistenteEExpirada`, `TestUsuarioDesativadoDepoisDaSessaoPerdeAcesso`, `TestRenovacaoDeslizanteMasNuncaParaImpersonada`, `TestRevogar`.

```bash
git add api/internal/auth/senha.go api/internal/auth/senha_test.go api/internal/auth/sessoes.go api/internal/auth/sessoes_test.go
git commit -m "feat(api): senha bcrypt e sessões opacas com expiração deslizante" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Limitador, ator, middleware e rotas de autenticação

**Files:**
- Create: `api/internal/auth/limitador.go`, `limitador_test.go`, `ator.go`, `middleware.go`, `rotas.go`, `rotas_test.go`

**Interfaces:**
- Consumes: `Store`, `SenhaConfere`, `HashDaSenha`, `ErrSessaoInvalida` (Task 4).
- Produces:
  - `auth.NovoLimitador() *Limitador`; `(*Limitador).Bloqueado(chave string) bool`; `.Falhou(chave string)`; `.Limpar(chave string)`
  - `type Ator struct{ ID, Tipo, Papel string; SuperAdmin bool; Permissoes map[string][]string; ImpersonadorID *string }`
  - `auth.CarregarAtor(ctx, *pgxpool.Pool, *Sessao) (*Ator, error)`
  - `auth.Exigir(p *pgxpool.Pool, s *Store) func(http.Handler) http.Handler`; `auth.AtorDoContexto(ctx) *Ator`
  - `auth.ExigirPermissao(recurso, acao string) func(http.Handler) http.Handler` (403 `{"error":"sem_permissao"}`)
  - `auth.NovosHandlers(p, s, l) *Handlers` com `Entrar`, `Sair`, `Eu`

- [ ] **Step 1: Teste do limitador (falha)**

`api/internal/auth/limitador_test.go`:

```go
package auth

import (
	"testing"
	"time"
)

func TestLimitadorBloqueiaAposMaxEJanelaExpira(t *testing.T) {
	l := NovoLimitador()
	agora := time.Now()
	l.agora = func() time.Time { return agora }
	for i := 0; i < l.Max; i++ {
		if l.Bloqueado("k") {
			t.Fatalf("bloqueou cedo, i=%d", i)
		}
		l.Falhou("k")
	}
	if !l.Bloqueado("k") {
		t.Fatal("deveria bloquear")
	}
	if l.Bloqueado("outra") {
		t.Fatal("chave diferente não pode ser afetada")
	}
	agora = agora.Add(l.Janela + time.Second)
	if l.Bloqueado("k") {
		t.Fatal("janela deveria ter expirado")
	}
	l.Falhou("k")
	l.Limpar("k")
	if l.Bloqueado("k") || len(l.falhas["k"]) != 0 {
		t.Fatal("Limpar deveria zerar")
	}
}
```

- [ ] **Step 2: Implementar limitador**

`api/internal/auth/limitador.go`:

```go
package auth

import (
	"sync"
	"time"
)

// Limitador conta falhas de login por chave (e-mail|ip) numa janela.
// ponytail: em memória, vale para uma instância só; Redis/Postgres se houver mais de uma.
type Limitador struct {
	Max    int
	Janela time.Duration
	mu     sync.Mutex
	falhas map[string][]time.Time
	agora  func() time.Time
}

func NovoLimitador() *Limitador {
	return &Limitador{Max: 5, Janela: 15 * time.Minute, falhas: map[string][]time.Time{}, agora: time.Now}
}

func (l *Limitador) podar(k string) {
	corte := l.agora().Add(-l.Janela)
	vivas := l.falhas[k][:0]
	for _, t := range l.falhas[k] {
		if t.After(corte) {
			vivas = append(vivas, t)
		}
	}
	if len(vivas) == 0 {
		delete(l.falhas, k)
		return
	}
	l.falhas[k] = vivas
}

func (l *Limitador) Bloqueado(k string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.podar(k)
	return len(l.falhas[k]) >= l.Max
}

func (l *Limitador) Falhou(k string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.falhas[k] = append(l.falhas[k], l.agora())
}

func (l *Limitador) Limpar(k string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	delete(l.falhas, k)
}
```

- [ ] **Step 3: Ator, middleware e rotas**

`api/internal/auth/ator.go`:

```go
package auth

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Ator é quem está fazendo a requisição, já com o que pode.
type Ator struct {
	ID             string
	Tipo           string // painel | cliente | servico
	Papel          string
	SuperAdmin     bool
	Permissoes     map[string][]string // recurso -> ações ("ver","criar","editar","excluir")
	ImpersonadorID *string
}

func CarregarAtor(ctx context.Context, p *pgxpool.Pool, s *Sessao) (*Ator, error) {
	a := &Ator{ID: s.UsuarioID, Tipo: s.Tipo, ImpersonadorID: s.ImpersonadorID, Permissoes: map[string][]string{}}
	var perm []byte
	err := p.QueryRow(ctx,
		`select coalesce(role, ''), coalesce(is_superadmin, false), coalesce(permissions, '{}'::jsonb)
		   from profiles where id = $1`, s.UsuarioID).Scan(&a.Papel, &a.SuperAdmin, &perm)
	if errors.Is(err, pgx.ErrNoRows) {
		return a, nil // sem perfil = sem permissão (cliente da Vessel não tem profile)
	}
	if err != nil {
		return nil, err
	}
	if err := json.Unmarshal(perm, &a.Permissoes); err != nil {
		return nil, err
	}
	return a, nil
}
```

`api/internal/auth/middleware.go`:

```go
package auth

import (
	"context"
	"errors"
	"net/http"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"
)

type chaveAtor struct{}

func AtorDoContexto(ctx context.Context) *Ator {
	a, _ := ctx.Value(chaveAtor{}).(*Ator)
	return a
}

func erroJSON(w http.ResponseWriter, status int, codigo string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	w.Write([]byte(`{"error":"` + codigo + `"}`))
}

func tokenDe(r *http.Request) string {
	t, _ := strings.CutPrefix(r.Header.Get("Authorization"), "Bearer ")
	return t
}

func Exigir(p *pgxpool.Pool, s *Store) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			token := tokenDe(r)
			if token == "" {
				erroJSON(w, http.StatusUnauthorized, "nao_autenticado")
				return
			}
			se, err := s.Buscar(r.Context(), token)
			if errors.Is(err, ErrSessaoInvalida) {
				erroJSON(w, http.StatusUnauthorized, "nao_autenticado")
				return
			}
			if err != nil {
				erroJSON(w, http.StatusInternalServerError, "erro_interno")
				return
			}
			a, err := CarregarAtor(r.Context(), p, se)
			if err != nil {
				erroJSON(w, http.StatusInternalServerError, "erro_interno")
				return
			}
			next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), chaveAtor{}, a)))
		})
	}
}

// ExigirPermissao deve vir DEPOIS de Exigir.
func ExigirPermissao(recurso, acao string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if !AtorDoContexto(r.Context()).Pode(recurso, acao) {
				erroJSON(w, http.StatusForbidden, "sem_permissao")
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}
```

`api/internal/auth/rotas.go`:

```go
package auth

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/crypto/bcrypt"
)

type Handlers struct {
	pool    *pgxpool.Pool
	sessoes *Store
	limite  *Limitador
}

func NovosHandlers(p *pgxpool.Pool, s *Store, l *Limitador) *Handlers {
	return &Handlers{pool: p, sessoes: s, limite: l}
}

// gasta o mesmo tempo de bcrypt quando o e-mail não existe, para não revelar quem tem conta
var hashFalso, _ = bcrypt.GenerateFromPassword([]byte("x"), bcrypt.DefaultCost)

func (h *Handlers) Entrar(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Email string `json:"email"`
		Senha string `json:"senha"`
	}
	if json.NewDecoder(http.MaxBytesReader(w, r.Body, 4<<10)).Decode(&in) != nil || in.Email == "" || in.Senha == "" {
		erroJSON(w, http.StatusBadRequest, "pedido_invalido")
		return
	}
	email := strings.ToLower(strings.TrimSpace(in.Email))
	chave := email + "|" + r.RemoteAddr
	if h.limite.Bloqueado(chave) {
		erroJSON(w, http.StatusTooManyRequests, "muitas_tentativas")
		return
	}
	var id, hash string
	err := h.pool.QueryRow(r.Context(),
		`select id::text, coalesce(senha_hash, '') from usuarios where lower(email) = $1 and desativado_em is null`, email).
		Scan(&id, &hash)
	if errors.Is(err, pgx.ErrNoRows) {
		id, hash = "", string(hashFalso)
	} else if err != nil {
		erroJSON(w, http.StatusInternalServerError, "erro_interno")
		return
	}
	if !SenhaConfere(hash, in.Senha) || id == "" {
		h.limite.Falhou(chave)
		erroJSON(w, http.StatusUnauthorized, "credenciais_invalidas")
		return
	}
	h.limite.Limpar(chave)
	token, err := h.sessoes.Criar(r.Context(), id, "painel", nil)
	if err != nil {
		erroJSON(w, http.StatusInternalServerError, "erro_interno")
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"token": token})
}

func (h *Handlers) Sair(w http.ResponseWriter, r *http.Request) {
	if err := h.sessoes.Revogar(r.Context(), tokenDe(r)); err != nil {
		erroJSON(w, http.StatusInternalServerError, "erro_interno")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handlers) Eu(w http.ResponseWriter, r *http.Request) {
	a := AtorDoContexto(r.Context())
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"id": a.ID, "tipo": a.Tipo, "papel": a.Papel, "superadmin": a.SuperAdmin,
		"permissoes": a.Permissoes, "impersonador_id": a.ImpersonadorID,
	})
}
```

- [ ] **Step 4: Testes das rotas (falham antes de `Pode` existir; faça a Task 6 junto)**

`api/internal/auth/rotas_test.go`:

```go
package auth

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/testebanco"
)

func montar(t *testing.T) (*pgxpool.Pool, *Store, http.Handler) {
	t.Helper()
	p := testebanco.Novo(t)
	s := NovoStore(p)
	h := NovosHandlers(p, s, NovoLimitador())
	r := chi.NewRouter()
	r.Post("/auth/entrar", h.Entrar)
	r.Group(func(r chi.Router) {
		r.Use(Exigir(p, s))
		r.Post("/auth/sair", h.Sair)
		r.Get("/auth/eu", h.Eu)
		r.With(ExigirPermissao("frota", "ver")).Get("/frota", func(w http.ResponseWriter, _ *http.Request) { w.Write([]byte("ok")) })
	})
	return p, s, r
}

func usuarioComSenha(t *testing.T, p *pgxpool.Pool, id, email, senha, permissoes string) {
	t.Helper()
	hash, _ := HashDaSenha(senha)
	ctx := context.Background()
	if _, err := p.Exec(ctx, `insert into usuarios (id, email, senha_hash) values ($1, $2, $3)`, id, email, hash); err != nil {
		t.Fatal(err)
	}
	if _, err := p.Exec(ctx, `insert into profiles (id, email, role, permissions) values ($1, $2, 'viewer', $3::jsonb)`, id, email, permissoes); err != nil {
		t.Fatal(err)
	}
}

func chamar(h http.Handler, metodo, caminho, corpo, token string) *httptest.ResponseRecorder {
	r := httptest.NewRequest(metodo, caminho, strings.NewReader(corpo))
	if token != "" {
		r.Header.Set("Authorization", "Bearer "+token)
	}
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	return w
}

func entrar(t *testing.T, h http.Handler, email, senha string) string {
	t.Helper()
	w := chamar(h, "POST", "/auth/entrar", `{"email":"`+email+`","senha":"`+senha+`"}`, "")
	if w.Code != 200 {
		t.Fatalf("entrar = %d %s", w.Code, w.Body)
	}
	var o struct{ Token string }
	json.Unmarshal(w.Body.Bytes(), &o)
	return o.Token
}

func TestLoginNormalizaEmailEntraNaMesmaConta(t *testing.T) {
	p, _, h := montar(t)
	usuarioComSenha(t, p, uid, "pessoa@x.com", "s3nha", `{}`)
	if entrar(t, h, "  PESSOA@X.com ", "s3nha") == "" {
		t.Fatal("sem token")
	}
}

func TestLoginErradoEPedidoRuim(t *testing.T) {
	p, _, h := montar(t)
	usuarioComSenha(t, p, uid, "a@x.com", "certa", `{}`)
	casos := []struct {
		corpo string
		code  int
	}{
		{`{"email":"a@x.com","senha":"errada"}`, 401},
		{`{"email":"nao@x.com","senha":"qualquer"}`, 401},
		{`{"email":"","senha":""}`, 400},
		{`nao é json`, 400},
		{`{"email":"a@x.com","senha":"` + strings.Repeat("a", 10000) + `"}`, 400},
	}
	for _, c := range casos {
		if w := chamar(h, "POST", "/auth/entrar", c.corpo, ""); w.Code != c.code {
			t.Fatalf("corpo %.30q: %d, esperava %d", c.corpo, w.Code, c.code)
		}
	}
}

func TestLimiteDeTentativas(t *testing.T) {
	p, _, h := montar(t)
	usuarioComSenha(t, p, uid, "a@x.com", "certa", `{}`)
	for i := 0; i < 5; i++ {
		chamar(h, "POST", "/auth/entrar", `{"email":"a@x.com","senha":"errada"}`, "")
	}
	if w := chamar(h, "POST", "/auth/entrar", `{"email":"a@x.com","senha":"certa"}`, ""); w.Code != 429 {
		t.Fatalf("esperava 429, veio %d", w.Code)
	}
}

func TestEuSairESemToken(t *testing.T) {
	p, _, h := montar(t)
	usuarioComSenha(t, p, uid, "a@x.com", "certa", `{"frota":["ver"]}`)
	if w := chamar(h, "GET", "/auth/eu", "", ""); w.Code != 401 {
		t.Fatalf("sem token = %d", w.Code)
	}
	tok := entrar(t, h, "a@x.com", "certa")
	w := chamar(h, "GET", "/auth/eu", "", tok)
	if w.Code != 200 || !strings.Contains(w.Body.String(), `"frota":["ver"]`) {
		t.Fatalf("eu = %d %s", w.Code, w.Body)
	}
	if w := chamar(h, "POST", "/auth/sair", "", tok); w.Code != 204 {
		t.Fatalf("sair = %d", w.Code)
	}
	if w := chamar(h, "GET", "/auth/eu", "", tok); w.Code != 401 {
		t.Fatalf("depois de sair = %d", w.Code)
	}
}

func TestPermissaoPorRota(t *testing.T) {
	p, _, h := montar(t)
	usuarioComSenha(t, p, uid, "com@x.com", "s", `{"frota":["ver"]}`)
	usuarioComSenha(t, p, uid2, "sem@x.com", "s", `{"frota":["editar"]}`)
	if w := chamar(h, "GET", "/frota", "", entrar(t, h, "com@x.com", "s")); w.Code != 200 {
		t.Fatalf("com permissão = %d", w.Code)
	}
	if w := chamar(h, "GET", "/frota", "", entrar(t, h, "sem@x.com", "s")); w.Code != 403 {
		t.Fatalf("sem 'ver' = %d", w.Code)
	}
}
```

- [ ] **Step 5: Commit só depois da Task 6** (as rotas dependem de `Pode`). Siga para a Task 6 e rode tudo junto.

---

### Task 6: `Pode()` — autorização negada por padrão

**Files:**
- Create: `api/internal/auth/pode.go`, `api/internal/auth/pode_test.go`

**Interfaces:**
- Produces: `(*Ator).Pode(recurso, acao string) bool`. Regras: ator nulo → falso; tipo `cliente` → falso (nunca acessa recurso do painel); `SuperAdmin` → verdadeiro; senão, verdadeiro só se `Permissoes[recurso]` contém `acao`. Tudo o que não está listado é negado. O catálogo de policies (Task 1/2) decide, nos próximos planos, regras por linha (ex.: escopo por loja) que entram como funções próprias; **esta é só a camada recurso × ação**, equivalente ao `permissions{}` de hoje.

- [ ] **Step 1: Teste (falha)**

`api/internal/auth/pode_test.go`:

```go
package auth

import "testing"

func TestPode(t *testing.T) {
	comum := &Ator{Tipo: "painel", Permissoes: map[string][]string{"frota": {"ver", "criar"}, "meta.gestor": {"ver"}}}
	casos := []struct {
		nome    string
		ator    *Ator
		recurso string
		acao    string
		quer    bool
	}{
		{"ator nulo", nil, "frota", "ver", false},
		{"permitido", comum, "frota", "criar", true},
		{"ação não listada", comum, "frota", "excluir", false},
		{"recurso não listado", comum, "patrimonio", "ver", false},
		{"recurso vazio", comum, "", "ver", false},
		{"super-admin passa tudo", &Ator{Tipo: "painel", SuperAdmin: true}, "qualquer", "excluir", true},
		{"cliente da Vessel nunca", &Ator{Tipo: "cliente", SuperAdmin: true, Permissoes: map[string][]string{"frota": {"ver"}}}, "frota", "ver", false},
		{"conta de serviço usa permissões", &Ator{Tipo: "servico", Permissoes: map[string][]string{"meta.gestor": {"ver"}}}, "meta.gestor", "ver", true},
	}
	for _, c := range casos {
		if got := c.ator.Pode(c.recurso, c.acao); got != c.quer {
			t.Errorf("%s: Pode(%q,%q) = %v, esperava %v", c.nome, c.recurso, c.acao, got, c.quer)
		}
	}
}
```

- [ ] **Step 2: Implementar**

`api/internal/auth/pode.go`:

```go
package auth

import "slices"

// Pode é o ÚNICO ponto de decisão recurso×ação. Nega tudo o que não foi concedido.
func (a *Ator) Pode(recurso, acao string) bool {
	if a == nil || a.Tipo == "cliente" {
		return false
	}
	if a.SuperAdmin {
		return true
	}
	return slices.Contains(a.Permissoes[recurso], acao)
}
```

- [ ] **Step 3: Rodar tudo (Tasks 3–6)**

Run: `cd api && go mod tidy && make teste`
Expected: PASS em `internal/auth` (senha, sessões, limitador, rotas, Pode), `internal/config` e `internal/web` (`TestSaudeEProntoSemAutenticacao`).

- [ ] **Step 4: Commit**

```bash
git add api/internal/auth api/go.mod api/go.sum
git commit -m "feat(api): login, logout, /auth/eu, limitador e Pode() negando por padrão" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Importador de usuários (`auth.users` → `usuarios`)

**Files:**
- Create: `api/internal/importacao/usuarios.go`, `api/internal/importacao/usuarios_test.go`
- Modify: `api/cmd/api/main.go` (subcomando `importar-usuarios`)

**Interfaces:**
- Consumes: `testebanco.Novo`, `auth.SenhaConfere`, `auth.HashDaSenha`.
- Produces:
  - `type UsuarioOrigem struct{ ID, Email, SenhaHash string; ConfirmadoEm, CriadoEm, BanidoAte *time.Time }`
  - `type Fonte interface{ Usuarios(ctx context.Context) ([]UsuarioOrigem, error) }`
  - `importacao.Importar(ctx, f Fonte, p *pgxpool.Pool, agora time.Time) (importados, ignorados int, err error)`
  - `importacao.FonteSupabase(url string) Fonte` (lê `auth.users` com transação somente leitura)

- [ ] **Step 1: Testes (falham)**

`api/internal/importacao/usuarios_test.go`:

```go
package importacao

import (
	"context"
	"testing"
	"time"

	"github.com/rbv-co/social-dashboard/api/internal/auth"
	"github.com/rbv-co/social-dashboard/api/internal/testebanco"
)

type fonteFalsa []UsuarioOrigem

func (f fonteFalsa) Usuarios(context.Context) ([]UsuarioOrigem, error) { return f, nil }

func TestImportarPreservaHashEMarcaBanidoEIgnoraSemEmail(t *testing.T) {
	p := testebanco.Novo(t)
	hash, _ := auth.HashDaSenha("senha-antiga")
	agora := time.Now()
	futuro, passado := agora.Add(24*time.Hour), agora.Add(-24*time.Hour)
	f := fonteFalsa{
		{ID: "11111111-1111-1111-1111-111111111111", Email: "Ana@X.com", SenhaHash: hash, ConfirmadoEm: &passado, CriadoEm: &passado},
		{ID: "22222222-2222-2222-2222-222222222222", Email: "banido@x.com", SenhaHash: hash, BanidoAte: &futuro},
		{ID: "33333333-3333-3333-3333-333333333333", Email: "ban-vencido@x.com", SenhaHash: hash, BanidoAte: &passado},
		{ID: "44444444-4444-4444-4444-444444444444", Email: "", SenhaHash: hash},
	}
	n, ign, err := Importar(context.Background(), f, p, agora)
	if err != nil || n != 3 || ign != 1 {
		t.Fatalf("n=%d ign=%d err=%v", n, ign, err)
	}
	var gravado string
	p.QueryRow(context.Background(), `select senha_hash from usuarios where lower(email) = 'ana@x.com'`).Scan(&gravado)
	if gravado != hash || !auth.SenhaConfere(gravado, "senha-antiga") {
		t.Fatal("hash não foi preservado byte a byte")
	}
	var desativados int
	p.QueryRow(context.Background(), `select count(*) from usuarios where desativado_em is not null`).Scan(&desativados)
	if desativados != 1 {
		t.Fatalf("só o banido vigente deveria estar desativado, achei %d", desativados)
	}
}

func TestImportarDeNovoNaoDuplicaENemCorrompe(t *testing.T) {
	p := testebanco.Novo(t)
	hash, _ := auth.HashDaSenha("x")
	f := fonteFalsa{{ID: "11111111-1111-1111-1111-111111111111", Email: "a@x.com", SenhaHash: hash}}
	for i := 0; i < 3; i++ {
		if _, _, err := Importar(context.Background(), f, p, time.Now()); err != nil {
			t.Fatal(err)
		}
	}
	var n int
	p.QueryRow(context.Background(), `select count(*) from usuarios`).Scan(&n)
	if n != 1 {
		t.Fatalf("duplicou: %d", n)
	}
}
```

Run: `make -C api teste` → FAIL (`undefined: Importar`).

- [ ] **Step 2: Implementar**

`api/internal/importacao/usuarios.go`:

```go
// Package importacao copia dados do Supabase para o banco novo.
package importacao

import (
	"context"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type UsuarioOrigem struct {
	ID, Email, SenhaHash              string
	ConfirmadoEm, CriadoEm, BanidoAte *time.Time
}

type Fonte interface {
	Usuarios(ctx context.Context) ([]UsuarioOrigem, error)
}

// Importar é idempotente: pode rodar quantas vezes precisar no ensaio.
// Conta sem e-mail (login só por telefone) é ignorada e contada.
func Importar(ctx context.Context, f Fonte, p *pgxpool.Pool, agora time.Time) (importados, ignorados int, err error) {
	lista, err := f.Usuarios(ctx)
	if err != nil {
		return 0, 0, err
	}
	tx, err := p.Begin(ctx)
	if err != nil {
		return 0, 0, err
	}
	defer tx.Rollback(ctx)
	for _, u := range lista {
		email := strings.TrimSpace(u.Email)
		if email == "" {
			ignorados++
			continue
		}
		var desativado *time.Time
		if u.BanidoAte != nil && u.BanidoAte.After(agora) {
			desativado = &agora
		}
		criado := agora
		if u.CriadoEm != nil {
			criado = *u.CriadoEm
		}
		if _, err := tx.Exec(ctx, `
			insert into usuarios (id, email, senha_hash, email_confirmado_em, criado_em, desativado_em)
			values ($1, $2, $3, $4, $5, $6)
			on conflict (id) do update set email = excluded.email, senha_hash = excluded.senha_hash,
			  email_confirmado_em = excluded.email_confirmado_em, desativado_em = excluded.desativado_em`,
			u.ID, email, nullSeVazio(u.SenhaHash), u.ConfirmadoEm, criado, desativado); err != nil {
			return 0, 0, err
		}
		importados++
	}
	return importados, ignorados, tx.Commit(ctx)
}

func nullSeVazio(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

type fonteSupabase struct{ url string }

// FonteSupabase lê auth.users em transação somente leitura.
func FonteSupabase(url string) Fonte { return fonteSupabase{url} }

func (f fonteSupabase) Usuarios(ctx context.Context) ([]UsuarioOrigem, error) {
	c, err := pgx.Connect(ctx, f.url)
	if err != nil {
		return nil, err
	}
	defer c.Close(ctx)
	tx, err := c.BeginTx(ctx, pgx.TxOptions{AccessMode: pgx.ReadOnly})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	rows, err := tx.Query(ctx, `select id::text, coalesce(email, ''), coalesce(encrypted_password, ''),
		email_confirmed_at, created_at, banned_until from auth.users where deleted_at is null`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []UsuarioOrigem
	for rows.Next() {
		var u UsuarioOrigem
		if err := rows.Scan(&u.ID, &u.Email, &u.SenhaHash, &u.ConfirmadoEm, &u.CriadoEm, &u.BanidoAte); err != nil {
			return nil, err
		}
		out = append(out, u)
	}
	return out, rows.Err()
}
```

- [ ] **Step 3: Subcomando no `main.go`**

Em `api/cmd/api/main.go`, antes do `switch`, nada muda; acrescente um `case` (e o import `importacao`):

```go
	case "importar-usuarios":
		origem := os.Getenv("ORIGEM_DATABASE_URL")
		if origem == "" {
			slog.Error("defina ORIGEM_DATABASE_URL (somente leitura, restore local no ensaio)")
			os.Exit(1)
		}
		n, ign, err := importacao.Importar(ctx, importacao.FonteSupabase(origem), p, time.Now())
		if err != nil {
			slog.Error("importação", "erro", err)
			os.Exit(1)
		}
		slog.Info("usuários importados", "importados", n, "ignorados_sem_email", ign)
```

- [ ] **Step 4: Rodar e commit**

Run: `make -C api teste` → Expected: PASS.

```bash
git add api/internal/importacao api/cmd/api/main.go
git commit -m "feat(api): importador idempotente de auth.users preservando hash bcrypt" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Worker com trava e registro em `robos_execucoes`

**Files:**
- Create: `api/internal/worker/worker.go`, `api/internal/worker/worker_test.go`
- Modify: `api/cmd/api/main.go` (subcomando `worker`)

**Interfaces:**
- Consumes: `testebanco.Novo` (inclui `robos_execucoes`).
- Produces:
  - `type Tarefa struct{ Nome, Agenda string; Limite time.Duration; Executar func(ctx context.Context) error }`
  - `worker.Novo(p *pgxpool.Pool) *Agendador`; `(*Agendador).Registrar(Tarefa) error`; `(*Agendador).Rodar(ctx, Tarefa) (executou bool, err error)`; `(*Agendador).Iniciar(ctx)` (bloqueia até `ctx` acabar)

- [ ] **Step 1: Testes (falham)**

`api/internal/worker/worker_test.go`:

```go
package worker

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/rbv-co/social-dashboard/api/internal/testebanco"
)

func TestAgendasDaSpecSaoValidas(t *testing.T) {
	a := Novo(testebanco.Novo(t))
	for _, ag := range []string{
		"0 10 * * *", "0 15 * * *", "0 21 * * *", "59 2 * * *", "0 1 * * *", "0 11 * * *",
		"30 2 * * *", "17 4 * * *", "*/30 * * * *", "*/5 * * * *", "2-59/5 * * * *",
		"* * * * *", "4,14,24,34,44,54 * * * *", "*/10 * * * *",
	} {
		if err := a.Registrar(Tarefa{Nome: "t", Agenda: ag, Limite: time.Second, Executar: func(context.Context) error { return nil }}); err != nil {
			t.Errorf("agenda %q: %v", ag, err)
		}
	}
	if err := a.Registrar(Tarefa{Nome: "x", Agenda: "isto não é cron"}); err == nil {
		t.Error("agenda inválida deveria falhar")
	}
}

func linha(t *testing.T, a *Agendador, robo string) (ok bool, resp string, n int) {
	t.Helper()
	a.pool.QueryRow(context.Background(), `select count(*) from robos_execucoes where robo = $1`, robo).Scan(&n)
	a.pool.QueryRow(context.Background(), `select coalesce(ok, false), coalesce(resposta, '') from robos_execucoes where robo = $1 order by id desc limit 1`, robo).Scan(&ok, &resp)
	return
}

func TestRodarRegistraSucessoEErro(t *testing.T) {
	a := Novo(testebanco.Novo(t))
	ctx := context.Background()
	if ex, err := a.Rodar(ctx, Tarefa{Nome: "boa", Limite: time.Second, Executar: func(context.Context) error { return nil }}); !ex || err != nil {
		t.Fatalf("ex=%v err=%v", ex, err)
	}
	if ok, resp, n := linha(t, a, "boa"); !ok || resp != "ok" || n != 1 {
		t.Fatalf("ok=%v resp=%q n=%d", ok, resp, n)
	}
	a.Rodar(ctx, Tarefa{Nome: "ruim", Limite: time.Second, Executar: func(context.Context) error { return errors.New("bling fora") }})
	if ok, resp, _ := linha(t, a, "ruim"); ok || resp != "bling fora" {
		t.Fatalf("ok=%v resp=%q", ok, resp)
	}
}

func TestLimiteDeTempoCancelaATarefa(t *testing.T) {
	a := Novo(testebanco.Novo(t))
	a.Rodar(context.Background(), Tarefa{Nome: "lenta", Limite: 50 * time.Millisecond,
		Executar: func(ctx context.Context) error { <-ctx.Done(); return ctx.Err() }})
	if ok, resp, _ := linha(t, a, "lenta"); ok || !strings.Contains(resp, "deadline") {
		t.Fatalf("ok=%v resp=%q", ok, resp)
	}
}

func TestDuasInstanciasSoUmaExecuta(t *testing.T) {
	a := Novo(testebanco.Novo(t))
	preso, liberar := make(chan struct{}), make(chan struct{})
	tarefa := Tarefa{Nome: "unica", Limite: 5 * time.Second, Executar: func(context.Context) error {
		close(preso)
		<-liberar
		return nil
	}}
	feito := make(chan bool)
	go func() { ex, _ := a.Rodar(context.Background(), tarefa); feito <- ex }()
	<-preso
	if ex, err := a.Rodar(context.Background(), Tarefa{Nome: "unica", Limite: time.Second, Executar: func(context.Context) error { t.Error("não podia executar"); return nil }}); ex || err != nil {
		t.Fatalf("segunda rodada: ex=%v err=%v", ex, err)
	}
	close(liberar)
	if !<-feito {
		t.Fatal("a primeira deveria ter executado")
	}
	if _, _, n := linha(t, a, "unica"); n != 1 {
		t.Fatalf("esperava 1 linha, achei %d", n)
	}
}
```

- [ ] **Step 2: Implementar**

`api/internal/worker/worker.go`:

```go
// Package worker roda tarefas agendadas (substitui o pg_cron + edges de cron).
package worker

import (
	"context"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/robfig/cron/v3"
)

type Tarefa struct {
	Nome     string
	Agenda   string // cron de 5 campos, em UTC (como o pg_cron)
	Limite   time.Duration
	Executar func(ctx context.Context) error
}

type Agendador struct {
	pool  *pgxpool.Pool
	cron  *cron.Cron
	agora func() time.Time
}

func Novo(p *pgxpool.Pool) *Agendador {
	return &Agendador{pool: p, cron: cron.New(cron.WithLocation(time.UTC)), agora: time.Now}
}

func (a *Agendador) Registrar(t Tarefa) error {
	_, err := a.cron.AddFunc(t.Agenda, func() {
		if _, err := a.Rodar(context.Background(), t); err != nil {
			slog.Error("tarefa", "nome", t.Nome, "erro", err)
		}
	})
	return err
}

// Rodar executa uma vez sob pg_try_advisory_lock: se outra instância já roda a
// mesma tarefa, devolve false sem executar. Grava o resultado em robos_execucoes.
func (a *Agendador) Rodar(ctx context.Context, t Tarefa) (bool, error) {
	conn, err := a.pool.Acquire(ctx)
	if err != nil {
		return false, err
	}
	defer conn.Release()
	var ganhou bool
	if err := conn.QueryRow(ctx, `select pg_try_advisory_lock(hashtext($1))`, t.Nome).Scan(&ganhou); err != nil {
		return false, err
	}
	if !ganhou {
		return false, nil
	}
	defer conn.Exec(context.Background(), `select pg_advisory_unlock(hashtext($1))`, t.Nome)

	ctxT, cancela := context.WithTimeout(ctx, t.Limite)
	defer cancela()
	inicio := a.agora()
	erro := t.Executar(ctxT)
	ok, resp, status := erro == nil, "ok", 200
	if erro != nil {
		resp, status = erro.Error(), 500
	}
	_, err = a.pool.Exec(context.Background(),
		`insert into robos_execucoes (robo, disparado_em, status_code, ok, resposta) values ($1, $2, $3, $4, $5)`,
		t.Nome, inicio, status, ok, resp)
	return true, err
}

func (a *Agendador) Iniciar(ctx context.Context) {
	a.cron.Start()
	<-ctx.Done()
	<-a.cron.Stop().Done() // espera as tarefas em andamento terminarem
}
```

- [ ] **Step 3: Subcomando `worker` no `main.go`**

```go
	case "worker":
		ag := worker.Novo(p)
		slog.Info("worker no ar (sem tarefas registradas ainda; entram nos planos seguintes)")
		ag.Iniciar(ctx)
```
(e o import `"github.com/rbv-co/social-dashboard/api/internal/worker"`).

- [ ] **Step 4: Rodar tudo, vet e commit**

Run: `cd api && gofmt -w . && go vet ./... && make teste`
Expected: `go vet` sem avisos; todos os pacotes PASS. (O `gofmt -w` só realinha espaços; confira o `git diff` antes do commit.)

```bash
git add api/internal/worker api/cmd/api/main.go
git commit -m "feat(api): worker com trava por tarefa e registro em robos_execucoes" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Verificação final do Plano 1

- [ ] `node --test db/catalogo/policies.test.mjs docs/migracao-go/levantamento.test.mjs` → verde.
- [ ] `make -C api teste` → verde; `go vet ./...` e `gofmt -l .` limpos.
- [ ] `npm test` (suíte existente) continua verde: este plano não altera código do front nem das edges.
- [ ] Subir localmente: `DATABASE_URL=... go run ./cmd/api api`, `curl localhost:8080/saude` → `ok`; importar um restore de teste com `importar-usuarios`; login com a senha original de um usuário real do restore (**nunca** em produção sem ok).
- [ ] Anexar ao PR: contagem do catálogo (Task 1) e resultado do levantamento (Task 2) rodado pelo dono.

## Cobertura da spec e o que vem depois

| Spec | Onde |
|---|---|
| 3.1 stack, pasta `api/` | Task 3 |
| 3.2 Postgres de teste | Task 3 (Makefile); Postgres de produção: Plano 2 |
| 4 sessões, login, logout, impersonação (mecanismo), tipos de sessão, limite de tentativas | Tasks 4–5 (endpoint "entrar como" e convites: Plano de `admin`) |
| 4 importação de `auth.users` | Task 7 |
| 5 `Pode()` e catálogo de policies | Tasks 1, 6 (regras por linha: planos por domínio) |
| 8.1 worker e trava | Task 8 (tarefas reais: Plano de crons) |
| 15 levantamento | Task 2 |

Próximos planos (escritos **depois** do levantamento): 2) Postgres de produção, dump/restore e ensaio; 3) edges que o core já cobre (Bling, Meta, webhooks); 4) crons e proxies de IA; 5) domínios (`frota`, `acessos`, `patrimonio`, `conteudo`, `admin`, `meta-ads`, `gestao-trafego`, `autenticidade`, `comercial`); 6) Zoho/Microsoft, Storage e rotas públicas da Vessel; 7) front, robôs e consumidores externos; 8) virada e rollback.
