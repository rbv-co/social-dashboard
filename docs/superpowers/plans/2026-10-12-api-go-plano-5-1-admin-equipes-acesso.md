# Sair do Supabase — Plano 5.1: Admin, equipes e acesso

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **Execute na worktree `p5-51`** (branch `feat/api-go-plano-5-1`, empilhada sobre `feat/api-go-dominios` = Plano 5.0). Faça `git add` só dos caminhos de cada task. Este plano contrata sobre as **interfaces** do 5.0 (plano-mestre, Tasks 1–10), não sobre o código dele: o pré-voo confere que elas existem com esses nomes.

**Goal:** Trocar as 73 leituras e escritas diretas do front nas tabelas de pessoas, permissões, times, grupos de canal, perfis de acesso, pedidos de acesso, avisos (push) e saúde por 31 rotas da API em Go que decidem com as MESMAS regras das 44 policies de produção dessas tabelas, com os gatilhos de produção (`guard_profiles`, `impedir_autopromocao`...) vendo quem pede.

**Architecture:** Um pacote de domínio `internal/acesso`, montado no grupo de domínio do 5.0 (`auth.Exigir` → `autz.ComEscopo`). Leitura = `dados.Consulta` (regra de Ler do catálogo no `WHERE`). Escrita = um caminho declarado novo em `dados` (`Tabela` + `RotaCriar/RotaEditar/RotaApagar`): colunas vindas só das tags da struct do corpo, `autz.PodeCriar/PodeEditar/PodeApagar` antes de gravar, SQL fixo com `jsonb_populate_record` (o cast é o tipo da coluna), tudo em `banco.ComUsuario`. Os testes rodam contra a fatia 5.1 do esquema de produção (D0): tabelas das migrations e funções/gatilhos **verbatim** do levantamento, num banco novo por teste.

**Tech Stack:** Go 1.26 (`go.mod`), `chi`, `pgx` v5, `goose`, Postgres 17 (contêiner), Node 22 (só o gerador de gatilhos).

**Spec:** `docs/superpowers/specs/2026-10-09-sair-do-supabase-design.md` (§5 autorização, §11 segurança, §13 testes) e o plano-mestre `docs/superpowers/plans/2026-10-11-api-go-plano-5-dominios.md` (§II contrato, IV.1 regras de sub-plano, linha 5.1 da IV.2, Rulings 1–36). Especificação das permissões: `docs/migracao-go/catalogo-policies-producao.json`.

## Global Constraints

- Nada em produção: sem `ssh`, sem credencial real, sem `push`. Postgres local descartável; segredos de teste inventados.
- Regra de cada tabela = a do catálogo (`autz.Producao`), nunca reescrita à mão; regra dos gatilhos = o corpo de produção (verbatim). Divergência só por Ruling deste plano.
- Negar por padrão. Todo teste de portão tem o lado negado assertado **com o efeito** (nada gravado/apagado, conferido no banco).
- IDOR: lista com linha alheia = `[]`/linha ausente; escrita em linha invisível = `404`; `403` só para linha visível.
- SQL: todo parâmetro com cast explícito; nada do pedido no texto do SQL (tabela e lista de colunas fixas na rota; colunas gravadas = tags da struct).
- Toda escrita em `banco.ComUsuario` (os gatilhos de `profiles` e os `default auth.uid()` leem a identidade). Autoria (`criado_por`, `alterado_por`, `concedido_por`) vem da sessão, nunca do corpo.
- Nunca em log: tokens, `endpoint`/`p256dh`/`auth` de push, nome/e-mail de pedido de acesso.
- Sem dependência nova; `go.mod` fica em `go 1.26.0`.
- Gate: `make -C api teste PG_PORTA=58536` com `--- SKIP` = 0; `gofmt -l` e `go vet` limpos. O alvo `teste` usa o contêiner de nome fixo `pg-api-teste`: não rode o gate junto com outra worktree.
- Commits terminam com `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>` (o modelo que implementa). Código, comentários e mensagens em português com acentuação; frases copiadas da tela ou de gatilho ficam como estão.
- `go` roda em `api/`; `git` e `node` na raiz da worktree.

## Review Focus

1. **Admin que não é super mudando o cargo de alguém, editando o perfil do `erick@` ou mexendo no próprio acesso** → recusado pelo gatilho com a identidade de quem pede (400 com a frase do gatilho / 403), nada gravado; e a mudança permitida deixa `audit_log.actor_id` = quem pediu. Teste: `TestEditarUsuario` (Task 4).
2. **Id de linha de outro time/grupo numa escrita** (PATCH/DELETE de membro, liberação de estoque, supervisora) → 404 quando a linha é invisível, 403 quando visível, a linha intacta. Testes: `TestTimesMembrosELiberacoes` (Task 5), `TestGruposESupervisoras` (Task 6).
3. **Sessão de "entrar como" chamando qualquer escrita do 5.1** → 403 sem efeito nenhum no banco. Teste: `TestEscritasRecusamImpersonado` (Task 11), que percorre TODAS as rotas de escrita.
4. **`POST /pedir-acesso` com `status`, campo enorme, e-mail inválido ou em rajada** → 400/429, nada gravado, nenhum nome/e-mail no log. Teste: `TestPedirAcessoPublico` (Task 8).
5. **`null` explícito × chave ausente no PATCH** (`allowed_accounts: null` = vê todas as contas; ausente = não muda) → gravado exatamente assim. Testes: `TestEscritaDeclarada` (Task 2) e `TestEditarUsuario` (Task 4).

---

## Interfaces do 5.0 que este plano consome

(Do plano-mestre; o pré-voo confere cada uma.)

- `dados`: `Consulta{Tabela, Alias, SQL, Onde string; Filtros []Filtro; Ordens map[string]string; OrdemPadrao string; Desempate string}` com `Validar(cat) error` e `Handler(b Consultor, cat) http.HandlerFunc`; `Filtro{Param, SQL, Tipo}`; `LerCorpo`, `Erro`, `ErroDoBanco`, `ErroDeEscrita`; o `escrever(w, status, corpo)` interno de `dados.go`. (O campo de desempate nasceu da revisão da Task 1 do 5.0: `LerOrdem(q, permitidas, padrao, desempate)`. Se a Task 5 do 5.0 o nomear diferente de `Desempate`, use o nome real.)
- `autz`: `Producao *Catalogo`; `Escopo`; `EscopoDo(ctx)`, `NoContexto(ctx, e)`, `ComEscopo(b)`; `Ler, Criar, Editar, Apagar`; `(*Catalogo).Tem/Filtro/PodeCriar/PodeEditar/PodeApagar`; `Filtro.Juntar`; `ErrNegado`, `ErrNaoEncontrado`; `Compilar`.
- `auth`: `Ator{ID, ImpersonadorID, ...}`, `AtorDoContexto`, `NoContexto(ctx, a)`, `Exigir(p, s)`, `NovoStore`, `(*Store).Criar(ctx, id, tipo, impersonadorID)`, `LimitarPorIP(max, janela)`.
- `banco`: `ComUsuario(ctx, p, id, fn)`, `Compat`, `Migrar(p)`, `Configurar(cfg)`.
- `web.Rotas`: grupo de domínio com `r.Use(autz.ComEscopo(p))` e `r.Post("/rpc/{nome}", ...)`; mapas `publicas` e `soSessao` em `rotas_test.go`.

## Pré-voo (antes da Task 1)

- [ ] `cd /Users/gabrielgertrudes/Projetos/Trabalho/lavessel/social-dashboard/.claude/worktrees/p5-51 && git status --short && git branch --show-current` → só este plano (ou vazio); `feat/api-go-plano-5-1`.
- [ ] Trazer o 5.0 completo: `git merge --no-edit feat/api-go-dominios`. Conferir:
  ```bash
  grep -c 'func (c Consulta) Handler\|func ErroDeEscrita' api/internal/dados/consulta.go   # 2
  grep -c 'func ComEscopo\|func (c \*Catalogo) PodeEditar' api/internal/autz/escrita.go     # 2
  grep -c 'func NoContexto' api/internal/auth/middleware.go                                 # 1
  grep -c 'autz.ComEscopo(p)' api/internal/web/rotas.go                                     # 1
  grep -n 'Desempate\|OrdemPadrao' api/internal/dados/consulta.go                           # o nome do campo de desempate
  ```
  Qualquer `0`: o 5.0 não terminou — **pare e reporte**. Nome diferente só de campo/função: use o real em todo o plano. Semântica diferente (ex.: `PodeEditar` sem travar a linha): **pare e reporte**.
- [ ] `go version` → `go1.26`+; `node --version` → `v22`+.
- [ ] Levantamento (fonte do gerador, fora do git):
  ```bash
  L=/Users/gabrielgertrudes/Projetos/Trabalho/lavessel/social-dashboard/.claude/worktrees/levantamento-ro/docs/migracao-go/levantamento
  test -f "$L/02-funções.csv" && test -f "$L/03-triggers.csv" && test -f "$L/12-colunas.csv" && echo ok
  ```
- [ ] Docker no ar, porta livre (`lsof -iTCP:58536 -sTCP:LISTEN` → vazio) e o banco das etapas:
  ```bash
  docker run -d --rm --name pg-plano51 -e POSTGRES_PASSWORD=x -p 127.0.0.1:58536:5432 postgres:17
  until docker exec pg-plano51 pg_isready -h 127.0.0.1 -U postgres >/dev/null 2>&1; do sleep 1; done
  export TEST_DATABASE_URL='postgres://postgres:x@localhost:58536/postgres?sslmode=disable'
  ```
  Os testes do 5.1 CRIAM e APAGAM bancos `esq_<hex>` nesse servidor.
- [ ] Linha de base: `cd api && go test ./... && go test -v ./... 2>&1 | grep -c -- '--- SKIP'` → tudo `ok` e `0`.

## Estrutura de arquivos

```
api/internal/testebanco/esquema.go                   # ComEsquemaDeProducao: banco novo com compat + migrações + esquema/*.sql
api/internal/testebanco/esquema_test.go              # os gatilhos verbatim disparam com a identidade da transação
api/internal/testebanco/esquema/01-tabelas-5-01.sql   # DDL da fatia 5.1 (fonte citada por tabela)
api/internal/testebanco/esquema/gerar-gatilhos.mjs   # gera 02-gatilhos.sql do levantamento
api/internal/testebanco/esquema/02-gatilhos.sql      # GERADO: funções e gatilhos de produção, verbatim
api/internal/dados/escrita.go                        # Tabela (Criar/Editar/Apagar), Campos, RotaCriar/Editar/Apagar, Responder
api/internal/dados/escrita_test.go
api/internal/acesso/acesso.go                        # doc do pacote, soSessaoPropria, deve
api/internal/acesso/mundo_test.go                    # mundo de teste: pessoas, linhas, sessões, cadeia Exigir → ComEscopo
api/internal/acesso/usuarios.go      (+ _test)       # GET/PATCH /acesso/usuarios
api/internal/acesso/times.go         (+ _test)       # /equipes/times, /equipes/membros, /equipes/permissoes
api/internal/acesso/grupos.go        (+ _test)       # /equipes/grupos, /equipes/grupos-membros
api/internal/acesso/perfis.go        (+ _test)       # /acesso/perfis
api/internal/acesso/pedidos.go       (+ _test)       # POST /pedir-acesso (público), /acesso/pedidos
api/internal/acesso/avisos.go        (+ _test)       # /avisos/preferencias, /eu/push/inscrever, /eu/push/desinscrever
api/internal/acesso/saude.go         (+ _test)       # /saude/conferencias, /saude/ia-execucoes
api/internal/acesso/rotas.go         (+ _test)       # Montar; toda escrita recusa impersonado
api/internal/web/rotas.go, rotas_test.go             # montagem + listas pública/só-sessão + montagem real
api/cmd/api/conferir.go                              # colunas, tipos, únicos e funções que as rotas presumem
docs/migracao-go/NOTAS-DA-IMPLANTACAO.md             # seção do 5.1
```

## Tarefas

| # | Task | Revisor | Depende de |
|---|---|---|---|
| 1 | D0: fatia 5.1 do esquema de produção nos testes | **opus** (dados: é contra isto que a autorização é provada) | 5.0 |
| 2 | `dados`: caminho de escrita declarado | **opus** (autorização, injeção: toda escrita passa aqui) | 5.0 |
| 3 | `acesso`: fundação (mundo de teste, portão de impersonado) | **opus** (autorização) | 1 |
| 4 | Usuários: `GET/PATCH /acesso/usuarios` | **opus** (permissões de gente) | 2, 3 |
| 5 | Times: equipes, membros e liberações de estoque | **opus** (escopo por equipe, IDOR) | 2, 3 |
| 6 | Grupos de canal e supervisoras | **opus** (escopo por grupo) | 2, 3 |
| 7 | Perfis de acesso | **opus** (super-admin por e-mail) | 2, 3 |
| 8 | Pedidos de acesso (público e admin) | **opus** (rota pública, dado pessoal) | 2, 3 |
| 9 | Avisos: preferências e inscrição de push | **opus** (dono da linha, segredo) | 3 |
| 10 | Saúde: conferências e execuções de IA (leitura) | sonnet | 3 |
| 11 | Montagem, `conferir`, notas e varredura do impersonado | **opus** (fronteira pública) | 4–10 |

---

### Task 1: D0 — fatia 5.1 do esquema de produção nos testes

**Revisor:** opus. **Depende de:** 5.0.

**(a) Contrato**
- `testebanco.ComEsquemaDeProducao(t *testing.T) *pgxpool.Pool`: banco **novo** `esq_<hex>` (as funções de produção citam `public.<tabela>`: por isso banco, e não schema, por teste) com, nesta ordem: `banco.Compat` (`auth.uid()` lê `app.usuario_id`), `banco.Migrar` (`usuarios`, `sessoes`...; as FKs do dump limpo apontam para `public.usuarios`, `ops/migracao/limpar-dump.mjs:64`) e os arquivos `esquema/*.sql` em ordem de nome. Pula sem `TEST_DATABASE_URL`, como `Novo`. Apaga o banco no `Cleanup` (`with (force)`).
- `esquema/01-tabelas-5-01.sql`: DDL das 15 tabelas que as rotas, o `Escopo` e os gatilhos do 5.1 leem (fonte por tabela, abaixo). Os sub-planos seguintes acrescentam `01-tabelas-5-NN.sql` com DOIS dígitos (`5-02` ... `5-12`; a ordem é a do nome e `5-10` viria antes de `5-2`).
- `esquema/gerar-gatilhos.mjs <dir do levantamento>` → `esquema/02-gatilhos.sql`: os gatilhos de produção das tabelas declaradas em `01-tabelas-*.sql` e o fechamento das funções que eles chamam, **verbatim** de `02-funções.csv`/`03-triggers.csv`. Resultado esperado para a fatia 5.1: 7 funções (`conta_ativa`, `equipes_toca_atualizado`, `espelhar_grupo_do_canal`, `espelhar_rename_do_grupo`, `guard_profiles`, `impedir_autopromocao`, `is_superadmin`) e 5 gatilhos (`levantamento/03-triggers.csv:2-4,6,30-31`).
- Premissas (Ruling 5.1-1): `03-triggers.csv` não traz `FOR EACH`, `WHEN` nem a lista do `UPDATE OF`; os 5 gatilhos da fatia são por linha e sem `WHEN` (`2026-08-04-equipes-e-escopo.sql:246-247`; o de rename do grupo é `2026-08-21-canal-pai-e-supervisora-de-grupo.sql:87-90`; o de `bling_lojas` é `BEFORE INSERT OR UPDATE OF grupo_id, grupo` em `2026-08-27-espelho-do-grupo-nos-dois-sentidos.sql:116-119` e sai gerado sem o `OF`, mesmo efeito porque o corpo só age com `is distinct from` nessas colunas; `supabase/migrations/20260727_impedir_autopromocao_de_admin.sql:50-53`; `guard_profiles` usa `new`/`old`, logo é por linha).

**(b) Testes de aceitação** (`TestEsquemaDeProducaoComOsGatilhosVerbatim`)
- Os gatilhos existentes são exatamente `equipes_atualizado, trg_espelhar_grupo_do_canal, trg_espelhar_rename_do_grupo, trg_guard_profiles, trg_impedir_autopromocao`.
- Negados (com efeito: a linha não muda): admin comum muda o `role` de outra pessoa → `P0001`; admin comum muda o próprio `permissions` → `42501`; admin comum muda o perfil do `erick@rbvcompany.com` → `P0001`.
- Permitidos: super por e-mail (`breno@rbvcompany.com`) muda o `role` → passa e grava `audit_log` `role_change` com `actor_id` = ele; admin comum muda `permissions` de outra pessoa → passa e grava `acesso_change` com `actor_id` = admin.
- Sem identidade (`p.Exec` fora de `ComUsuario`) o `guard_profiles` deixa mudar o cargo — prova de por que toda escrita roda em `ComUsuario`.
- Renomear `canais_grupos` leva o nome a `bling_lojas.grupo`; `update` em `equipes` move `atualizado_em`; `equipes_membros.criado_por` recebe `auth.uid()` de quem grava.

**(c) Arquivos:** Create `api/internal/testebanco/esquema.go`, `api/internal/testebanco/esquema_test.go`, `api/internal/testebanco/esquema/01-tabelas-5-01.sql`, `api/internal/testebanco/esquema/gerar-gatilhos.mjs`, `api/internal/testebanco/esquema/02-gatilhos.sql` (gerado).

**(d) Dependências:** `banco.Compat`, `banco.Migrar`, `banco.Configurar`, `banco.ComUsuario`; levantamento local.

- [ ] **Step 1: A DDL da fatia.** Crie `api/internal/testebanco/esquema/01-tabelas-5-01.sql`:

```sql
-- FATIA 5.1 do esquema de produção para os testes (D0 reconstruído: Ruling 5.1-1). Carregada por
-- testebanco.ComEsquemaDeProducao DEPOIS da camada de compatibilidade e das migrações da API.
-- Fonte ao lado de cada tabela. "Presumido" = sem DDL no repositório (tabela anterior às migrations):
-- o `api worker conferir` confere essas colunas no banco restaurado (Task 11). Tabelas de outros
-- sub-planos entram MÍNIMAS (só o que o Escopo, os gatilhos e as rotas do 5.1 leem); FKs de
-- auth.users viram public.usuarios, como no dump limpo (ops/migracao/limpar-dump.mjs:64).

-- db/migrations/acessos/039_perfis_de_acesso.sql:20-29
create table public.acessos_perfis (
  id          uuid primary key default gen_random_uuid(),
  nome        text not null unique,
  permissions jsonb not null default '{}'::jsonb,
  criado_em   timestamptz not null default now(),
  criado_por  uuid references public.usuarios(id)
);

-- colunas, tipos e nulidade: levantamento/12-colunas.csv:2-16. Defaults: escopo_por_equipe
-- (2026-08-04-equipes-e-escopo.sql:131-132), perfil_id e permissions_excecao (acessos/039:31-39);
-- os demais presumidos. allowed_accounts é "ARRAY" no CSV: uuid[] presumido (as funções fazem ::text[]).
create table public.profiles (
  id                   uuid primary key references public.usuarios(id) on delete cascade,
  email                text not null,
  name                 text,
  role                 text not null default 'viewer',
  created_at           timestamptz default now(),
  disabled             boolean default false,
  features             text[] default '{}',
  avatar_url           text,
  permissions          jsonb not null default '{}'::jsonb,
  allowed_accounts     uuid[],
  is_superadmin        boolean not null default false,
  escopo_por_equipe    boolean not null default true,
  precisa_trocar_senha boolean not null default false,
  perfil_id            uuid references public.acessos_perfis(id) on delete set null,
  permissions_excecao  jsonb not null default '{}'::jsonb
);

-- presumido: as colunas que guard_profiles grava (02-funções.csv, guard_profiles)
create table public.audit_log (
  id          bigserial primary key,
  actor_id    uuid,
  actor_email text,
  action      text not null,
  detail      jsonb,
  created_at  timestamptz not null default now()
);

-- 2026-08-21-canal-pai-e-supervisora-de-grupo.sql:16-28
create table public.canais_grupos (
  id        uuid primary key default gen_random_uuid(),
  nome      text not null,
  ordem     int not null default 0,
  ativo     boolean not null default true,
  criado_em timestamptz not null default now()
);
create unique index canais_grupos_nome_unico on public.canais_grupos (lower(btrim(nome)));

-- do 5.5, MÍNIMA (o que meus_vinculos e os gatilhos leem); grupo_id: canal-pai…sql:33-34; fechado_em presumido
create table public.bling_lojas (
  loja_id    bigint primary key,
  nome       text,
  grupo      text,
  grupo_id   uuid references public.canais_grupos(id) on delete set null,
  fechado_em date
);

-- 2026-08-04-equipes-e-escopo.sql:32-77 + deposito_id (2026-08-04-escopo-em-vendas-e-estoque.sql:21-27).
-- FKs de local_id/setor_id/empresa_id: entram com as fatias do 5.2 e do 5.4.
create table public.equipes (
  id            uuid primary key default gen_random_uuid(),
  nome          text not null,
  tipo          text not null default 'loja' check (tipo in ('loja', 'canal', 'setor')),
  ativo         boolean not null default true,
  canal_loja_id bigint references public.bling_lojas(loja_id) on delete set null,
  local_id      uuid,
  setor_id      uuid,
  empresa_id    uuid,
  deposito_id   bigint,
  ordem         int not null default 100,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create unique index equipes_canal_unico on public.equipes (canal_loja_id) where canal_loja_id is not null;
create unique index equipes_deposito_unico on public.equipes (deposito_id) where deposito_id is not null;

-- 2026-08-04-equipes-e-escopo.sql:85-109
create table public.equipes_membros (
  id         uuid primary key default gen_random_uuid(),
  equipe_id  uuid not null references public.equipes(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  papel      text not null default 'vendedora' check (papel in ('vendedora', 'supervisora', 'gestor')),
  criado_em  timestamptz not null default now(),
  criado_por uuid references public.profiles(id) default auth.uid()
);
create unique index equipes_membros_unico on public.equipes_membros (equipe_id, profile_id);

-- 2026-08-04-escopo-em-vendas-e-estoque.sql:43-56
create table public.equipes_permissoes (
  id            uuid primary key default gen_random_uuid(),
  equipe_id     uuid not null references public.equipes(id) on delete cascade,
  profile_id    uuid not null references public.profiles(id) on delete cascade,
  chave         text not null check (chave in ('estoque')),
  concedido_por uuid references public.profiles(id) default auth.uid(),
  criado_em     timestamptz not null default now()
);
create unique index equipes_permissoes_unica on public.equipes_permissoes (equipe_id, profile_id, chave);

-- 2026-08-21-canal-pai-e-supervisora-de-grupo.sql:103-111
create table public.canais_grupos_membros (
  id            uuid primary key default gen_random_uuid(),
  grupo_id      uuid not null references public.canais_grupos(id) on delete cascade,
  profile_id    uuid not null references public.profiles(id) on delete cascade,
  papel         text not null default 'supervisora' check (papel in ('supervisora')),
  concedido_por uuid references public.profiles(id),
  concedido_em  timestamptz not null default now(),
  unique (grupo_id, profile_id)
);

-- do 5.4, MÍNIMA: o que autz.CarregarEscopo lê
create table public.acessos_pessoas (
  id                uuid primary key default gen_random_uuid(),
  nome              text,
  profile_id        uuid,
  email_corporativo text
);

-- presumido: as colunas que login (tela-de-login.vue:227) e admin (tela-de-admin.vue:4271) usam
create table public.access_requests (
  id         uuid primary key default gen_random_uuid(),
  name       text,
  email      text,
  message    text,
  status     text not null default 'pending',
  created_at timestamptz not null default now()
);

-- 2026-07-24-push-subs.sql:3-10
create table public.push_subs (
  id         uuid primary key default gen_random_uuid(),
  endpoint   text not null unique,
  p256dh     text not null,
  auth       text not null,
  user_id    uuid references public.usuarios(id) on delete cascade,
  created_at timestamptz not null default now()
);

-- 2026-07-29-push-preferencias.sql:12-19 + o check de acessos/052_push_tipo_reserva.sql:17-19
create table public.push_preferencias (
  user_id      uuid not null references public.profiles(id) on delete cascade,
  tipo         text not null check (tipo in ('vendas', 'saldo', 'conteudo', 'frota', 'frota_reserva')),
  ativo        boolean not null,
  alterado_em  timestamptz not null default now(),
  alterado_por uuid,
  primary key (user_id, tipo)
);

-- presumido; os tipos de checked_date (date) e account_id (uuid) são os que cmd/api/conferir.go já exige
create table public.data_integrity_checks (
  id           bigserial primary key,
  checked_date date not null,
  account_id   uuid,
  check_name   text not null,
  status       text not null,
  detail       text,
  created_at   timestamptz not null default now()
);

-- db/migrations/025_ia_execucoes.sql:6-23
create table public.ia_execucoes (
  id            uuid primary key default gen_random_uuid(),
  run_at        timestamptz not null default now(),
  robo          text not null,
  acao          text not null,
  modelo        text,
  input_tokens  bigint not null default 0,
  output_tokens bigint not null default 0,
  chamadas      int not null default 0,
  usd           numeric(10,4) not null default 0,
  duracao_ms    bigint,
  itens         int,
  unidade       text,
  status        text not null default 'ok',
  detalhe       text,
  github_run_id text,
  created_at    timestamptz not null default now()
);
```

- [ ] **Step 2: O gerador.** Crie `api/internal/testebanco/esquema/gerar-gatilhos.mjs` (o leitor de CSV é o mesmo de `autz/autzteste/extrair-ajudantes.mjs`; copiado porque aquele script não exporta nada):

```js
// Gera 02-gatilhos.sql: os gatilhos de produção das tabelas declaradas em 01-tabelas-*.sql e o
// fechamento das funções que eles chamam, VERBATIM do levantamento (02-funções.csv, 03-triggers.csv).
// Uso (na raiz do repositório):
//   node api/internal/testebanco/esquema/gerar-gatilhos.mjs <dir do levantamento> > api/internal/testebanco/esquema/02-gatilhos.sql
// O 03-triggers.csv não traz FOR EACH nem WHEN: todos saem "for each row", sem WHEN. Ao acrescentar
// tabela, confira nas migrations a orientação e o WHEN de cada gatilho novo.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const [dir] = process.argv.slice(2);
if (!dir) {
  console.error('uso: gerar-gatilhos.mjs <dir do levantamento>');
  process.exit(2);
}

function lerCSV(texto) {
  const linhas = [];
  let campo = '', linha = [], aspas = false;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (aspas) {
      if (c === '"' && texto[i + 1] === '"') { campo += '"'; i++; }
      else if (c === '"') aspas = false;
      else campo += c;
    } else if (c === '"') aspas = true;
    else if (c === ',') { linha.push(campo); campo = ''; }
    else if (c === '\n') { linha.push(campo); linhas.push(linha); linha = []; campo = ''; }
    else if (c !== '\r') campo += c;
  }
  if (campo || linha.length) { linha.push(campo); linhas.push(linha); }
  return linhas;
}

const aqui = fileURLToPath(new URL('.', import.meta.url));
const tabelas = new Set(readdirSync(aqui).filter((a) => /^01-tabelas-.*\.sql$/.test(a))
  .flatMap((a) => [...readFileSync(join(aqui, a), 'utf8').matchAll(/create table public\.([a-z_][a-z0-9_]*)/g)].map((m) => m[1])));

const [cabF, ...linF] = lerCSV(readFileSync(join(dir, '02-funções.csv'), 'utf8'));
const iNome = cabF.indexOf('proname'), iDef = cabF.indexOf('definicao');
const funcoes = new Map(linF.filter((l) => l.length > iDef).map((l) => [l[iNome], l[iDef]]));

const [cabG, ...linG] = lerCSV(readFileSync(join(dir, '03-triggers.csv'), 'utf8'));
const c = (n) => cabG.indexOf(n);
const gatilhos = new Map();
for (const l of linG) {
  if (l.length < cabG.length || !tabelas.has(l[c('event_object_table')])) continue;
  const chave = `${l[c('event_object_table')]}.${l[c('trigger_name')]}`;
  const g = gatilhos.get(chave) ?? { tabela: l[c('event_object_table')], nome: l[c('trigger_name')],
    momento: l[c('action_timing')], eventos: [], acao: l[c('action_statement')] };
  g.eventos.push(l[c('event_manipulation')]);
  gatilhos.set(chave, g);
}

const chamadas = (texto) => [...funcoes.keys()].filter((n) => new RegExp(`\\b${n}\\(`).test(texto));
const fila = [...gatilhos.values()].flatMap((g) => chamadas(g.acao));
const vistas = new Set();
while (fila.length) {
  const n = fila.shift();
  if (vistas.has(n)) continue;
  if (!funcoes.has(n)) { console.error(`função ${n} não está no CSV`); process.exit(1); }
  vistas.add(n);
  fila.push(...chamadas(funcoes.get(n)));
}

const nomes = [...vistas].sort();
const ordem = [...gatilhos.values()].sort((a, b) => `${a.tabela}.${a.nome}`.localeCompare(`${b.tabela}.${b.nome}`));
process.stdout.write(
  '-- GERADO por gerar-gatilhos.mjs a partir do levantamento de produção (02-funções.csv, 03-triggers.csv).\n' +
  '-- NÃO EDITE À MÃO: rode o script de novo. Corpos verbatim de produção.\n' +
  `-- Tabelas: ${[...tabelas].sort().join(', ')}\n` +
  `-- Funções (${nomes.length}): ${nomes.join(', ')}\n` +
  'set check_function_bodies = off;\n\n' +
  nomes.map((n) => funcoes.get(n).trim() + ';\n').join('\n') + '\n' +
  ordem.map((g) => `create trigger ${g.nome} ${g.momento} ${g.eventos.join(' or ')} on public.${g.tabela} for each row ${g.acao};\n`).join(''),
);
```

Rode: `node api/internal/testebanco/esquema/gerar-gatilhos.mjs "$L" > api/internal/testebanco/esquema/02-gatilhos.sql && head -4 api/internal/testebanco/esquema/02-gatilhos.sql` → a linha `-- Funções (7): conta_ativa, equipes_toca_atualizado, espelhar_grupo_do_canal, espelhar_rename_do_grupo, guard_profiles, impedir_autopromocao, is_superadmin`. Outro número: **pare e reporte** (o CSV mudou ou o fechamento pegou nome a mais).

- [ ] **Step 3: O teste que falha.** Crie `api/internal/testebanco/esquema_test.go`:

```go
package testebanco

import (
	"context"
	"errors"
	"reflect"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/rbv-co/social-dashboard/api/internal/banco"
)

// A fatia 5.1 do esquema de produção: os gatilhos VERBATIM disparam com a identidade da transação
// (banco.ComUsuario). Sem identidade, guard_profiles confia (contexto de serviço) e tudo passa.
func TestEsquemaDeProducaoComOsGatilhosVerbatim(t *testing.T) {
	p := ComEsquemaDeProducao(t)
	ctx := context.Background()
	const (
		super = "5e000000-0000-4000-a000-000000000001" // breno@rbvcompany.com: na lista de is_superadmin()
		admin = "5e000000-0000-4000-a000-000000000002"
		outra = "5e000000-0000-4000-a000-000000000003"
		erick = "5e000000-0000-4000-a000-000000000004"
		grupo = "c6000000-0000-4000-a000-000000000001"
		time1 = "e1000000-0000-4000-a000-000000000001"
	)
	if _, err := p.Exec(ctx, `
		insert into usuarios (id, email) values ('`+super+`', 'breno@rbvcompany.com'), ('`+admin+`', 'admin@x.com'),
		  ('`+outra+`', 'outra@x.com'), ('`+erick+`', 'erick@rbvcompany.com');
		insert into profiles (id, email, role, is_superadmin) values ('`+super+`', 'breno@rbvcompany.com', 'admin', true),
		  ('`+admin+`', 'admin@x.com', 'admin', false), ('`+outra+`', 'outra@x.com', 'viewer', false),
		  ('`+erick+`', 'erick@rbvcompany.com', 'admin', true);
		insert into canais_grupos (id, nome) values ('`+grupo+`', 'Varejo');
		insert into bling_lojas (loja_id, nome, grupo_id) values (3, 'Loja 3', '`+grupo+`');
		insert into equipes (id, nome, canal_loja_id, atualizado_em) values ('`+time1+`', 'Time 1', 3, '2026-01-01T00:00:00Z');`); err != nil {
		t.Fatal(err)
	}
	var gat []string
	linhas, _ := p.Query(ctx, `select tgname::text from pg_trigger where not tgisinternal order by 1`)
	for linhas.Next() {
		var n string
		linhas.Scan(&n)
		gat = append(gat, n)
	}
	if quer := []string{"equipes_atualizado", "trg_espelhar_grupo_do_canal", "trg_espelhar_rename_do_grupo",
		"trg_guard_profiles", "trg_impedir_autopromocao"}; !reflect.DeepEqual(gat, quer) {
		t.Fatalf("gatilhos = %v, esperava %v", gat, quer)
	}

	como := func(id, sql string) error {
		return banco.ComUsuario(ctx, p, id, func(tx pgx.Tx) error { _, err := tx.Exec(ctx, sql); return err })
	}
	codigo := func(err error) string {
		var pe *pgconn.PgError
		if errors.As(err, &pe) {
			return pe.Code
		}
		return ""
	}
	um := func(sql string) string {
		var v string
		if err := p.QueryRow(ctx, sql).Scan(&v); err != nil {
			t.Fatalf("%s: %v", sql, err)
		}
		return v
	}

	// negados: o gatilho barra e a linha fica como estava
	if err := como(admin, `update profiles set role = 'admin' where id = '`+outra+`'`); codigo(err) != "P0001" {
		t.Errorf("admin comum mudou o cargo: %v", err)
	}
	if err := como(admin, `update profiles set permissions = '{"frota":["ver"]}' where id = '`+admin+`'`); codigo(err) != "42501" {
		t.Errorf("admin comum mudou o próprio acesso: %v", err)
	}
	if err := como(admin, `update profiles set name = 'x' where id = '`+erick+`'`); codigo(err) != "P0001" {
		t.Errorf("admin comum mexeu no perfil do erick: %v", err)
	}
	if v := um(`select string_agg(role || '/' || permissions::text || '/' || coalesce(name, '-'), ',' order by email)
		from profiles where id in ('` + admin + `', '` + erick + `', '` + outra + `')`); v != "admin/{}/-,admin/{}/-,viewer/{}/-" {
		t.Errorf("negado gravou: %s", v)
	}
	// permitidos, com o rastro de QUEM mudou
	if err := como(super, `update profiles set role = 'admin' where id = '`+outra+`'`); err != nil {
		t.Errorf("super por e-mail não mudou o cargo: %v", err)
	}
	if err := como(admin, `update profiles set permissions = '{"frota":["ver"]}' where id = '`+outra+`'`); err != nil {
		t.Errorf("admin não mudou permissões de outra pessoa: %v", err)
	}
	if v := um(`select count(*) filter (where action = 'role_change' and actor_id = '` + super + `')::text || '/' ||
		count(*) filter (where action = 'acesso_change' and actor_id = '` + admin + `')::text from audit_log`); v != "1/1" {
		t.Errorf("rastro role_change/acesso_change = %s, esperava 1/1", v)
	}
	// sem identidade o guard confia: por isso TODA escrita roda em banco.ComUsuario
	if _, err := p.Exec(ctx, `update profiles set role = 'viewer' where id = '`+outra+`'`); err != nil {
		t.Errorf("sem identidade: %v", err)
	}
	// espelho do nome do grupo, atualizado_em e default auth.uid()
	if err := como(super, `update canais_grupos set nome = 'Varejo Físico' where id = '`+grupo+`'`); err != nil {
		t.Fatal(err)
	}
	if v := um(`select grupo from bling_lojas where loja_id = 3`); v != "Varejo Físico" {
		t.Errorf("bling_lojas.grupo = %q", v)
	}
	if err := como(super, `update equipes set nome = 'Time Um' where id = '`+time1+`'`); err != nil {
		t.Fatal(err)
	}
	if v := um(`select (atualizado_em > '2026-01-02')::text from equipes where id = '` + time1 + `'`); v != "true" {
		t.Error("equipes_toca_atualizado não rodou")
	}
	if err := como(super, `insert into equipes_membros (equipe_id, profile_id) values ('`+time1+`', '`+outra+`')`); err != nil {
		t.Fatal(err)
	}
	if v := um(`select criado_por::text from equipes_membros`); v != super {
		t.Errorf("criado_por = %s, esperava quem gravou", v)
	}
}
```

Run: `cd api && go test -count=1 -run EsquemaDeProducao ./internal/testebanco/` → FAIL de compilação (`ComEsquemaDeProducao` não existe).

- [ ] **Step 4: Implementar.** Crie `api/internal/testebanco/esquema.go`:

```go
package testebanco

import (
	"context"
	"crypto/rand"
	"embed"
	"encoding/hex"
	"io/fs"
	"os"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/banco"
)

//go:embed esquema/*.sql
var esquema embed.FS

// ComEsquemaDeProducao devolve um pool num banco NOVO (esq_<hex>) com a camada de compatibilidade,
// as migrações da API e o esquema de produção versionado em esquema/ (tabelas e, gerados do
// levantamento, as funções e os gatilhos verbatim), nessa ordem. Banco, e não schema, por teste: as
// funções de produção citam public.<tabela>. Pula sem TEST_DATABASE_URL, como Novo.
func ComEsquemaDeProducao(t *testing.T) *pgxpool.Pool {
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
	nome := "esq_" + hex.EncodeToString(b)
	if _, err := admin.Exec(ctx, "create database "+nome); err != nil {
		admin.Close(ctx)
		t.Fatal(err)
	}
	cfg, err := pgxpool.ParseConfig(url)
	if err != nil {
		t.Fatal(err)
	}
	cfg.ConnConfig.Database = nome
	banco.Configurar(cfg)
	p, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		p.Close()
		admin.Exec(ctx, "drop database if exists "+nome+" with (force)")
		admin.Close(ctx)
	})
	if _, err := p.Exec(ctx, banco.Compat); err != nil {
		t.Fatalf("compat: %v", err)
	}
	if err := banco.Migrar(p); err != nil {
		t.Fatalf("migrações: %v", err)
	}
	arquivos, err := fs.Glob(esquema, "esquema/*.sql") // ordem do nome: 01-tabelas-5-01, 01-tabelas-5-02..., 02-gatilhos
	if err != nil || len(arquivos) == 0 {
		t.Fatalf("esquema/*.sql: %v", err)
	}
	for _, a := range arquivos {
		sql, _ := esquema.ReadFile(a)
		if _, err := p.Exec(ctx, string(sql)); err != nil {
			t.Fatalf("%s: %v", a, err)
		}
	}
	return p
}
```

- [ ] **Step 5: Rodar e ver passar (e morder).** `gofmt -l ./internal && go vet ./internal/testebanco/ && go test -count=1 -v -run EsquemaDeProducao ./internal/testebanco/ 2>&1 | grep -E '^(--- |ok|FAIL)'` → `--- PASS`, `ok`. Mutações que têm de reprovar (uma por vez, `git checkout` depois): apagar a linha `create trigger trg_guard_profiles` do `02-gatilhos.sql`; trocar `default auth.uid()` de `equipes_membros.criado_por` por nada.

- [ ] **Step 6: Commit.**

```bash
git add api/internal/testebanco/esquema.go api/internal/testebanco/esquema_test.go api/internal/testebanco/esquema/
git commit -m "test(api): D0 — fatia 5.1 do esquema de produção com funções e gatilhos verbatim do levantamento

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: `dados` — caminho de escrita declarado

**Revisor:** opus. **Depende de:** 5.0 (Tasks 1, 3, 5). Os testes usam `testebanco.Novo` (não dependem da Task 1).

**(a) Contrato**
- `type dados.Tabela struct { Nome, Resposta, Autor string }`: `Nome` = tabela do catálogo; `Resposta` = lista de colunas devolvida sobre o alias `t` (a MESMA da leitura da rota); `Autor` = coluna que recebe `e.ID` na criação (vazia = nenhuma). `Validar(cat) error` na montagem (tabela fora do catálogo, `Resposta` vazia, `Autor` inválido = a API não sobe).
- `dados.Campos(corpo any) (map[string]any, error)`: as colunas PRESENTES no corpo (struct de `json.RawMessage` com `json:"<coluna>,omitempty"`): ausente fica fora; `null` explícito entra. Chave fora de `^[a-z_][a-z0-9_]{0,62}$` = erro.
- `(Tabela).Criar(ctx, tx, cat, e, campos) ([]byte, error)`: `PodeCriar` → `insert` só das colunas presentes (o resto, default da tabela) via `jsonb_populate_record(null::<tab>, @campos::jsonb)` → devolve a linha pela `Resposta` se `e` a lê depois de gravada (regra de Ler sobre a linha nova); senão `{"id": …}` (contrato II.2).
- `(Tabela).Editar(ctx, tx, cat, e, id, campos) ([]byte, error)`: `PodeEditar` (trava a linha; Ler + USING na antiga; WITH CHECK na nova) → `update` só das colunas presentes → mesma resposta.
- `(Tabela).Apagar(ctx, tx, cat, e, id) error`: `PodeApagar` → `delete`.
- `dados.RotaCriar[C any](p, cat, t)` → 201; `RotaEditar[C any](p, cat, t)` (id de `chi.URLParam(r, "id")`) → 200; `RotaApagar(p, cat, t)` → 204. Ordem: escopo no contexto (senão 500) → corpo (`LerCorpo`: campo não declarado = 400 `corpo_invalido`) → `C.Validar()` se existir (400 `pedido_invalido` com a frase) → `{}` = 400 "Nada para gravar." → `banco.ComUsuario` → `ErroDeEscrita` (404/403/400/409).
- `dados.Responder(w, status, corpo)`: o `escrever` interno, exportado para os handlers próprios dos domínios.

**(b) Testes de aceitação** (`TestCampos`, `TestTabelaValidar`, `TestEscritaDeclarada`; catálogo de teste: `coisa` lida por quem vê a conta, criada por módulo `frota`, editada por quem vê a conta antes e depois, apagada só por super pela ficha)
- Criar: permitido → 201 com a linha pela `Resposta` (nunca a coluna `segredo`, fora da lista) e `quem` = id da sessão (identidade da transação); permitido mas sem leitura depois → 201 só `{"id"}`; sem a regra → 403 e contagem igual; campo não declarado → 400 e contagem igual; tipo que a coluna não aceita → 400 e contagem igual; `{}` → 400; `Validar` recusando → 400 com a frase; sem escopo no contexto → 500 e contagem igual.
- Editar: só a coluna enviada muda (a ausente fica); `null` explícito grava nulo; linha de outra conta → 404 e intacta (IDOR); mover a linha para conta que não vê → 403 e intacta; id que nem é uuid → 404; tipo errado → 400 e intacta.
- Apagar: sem a regra → 403 e a linha fica; linha invisível → 404 e fica; super pela ficha → 204 e some.

**(c) Arquivos:** Create `api/internal/dados/escrita.go`, `api/internal/dados/escrita_test.go`.

**(d) Dependências:** `autz.Compilar/PodeCriar/PodeEditar/PodeApagar/Filtro/EscopoDo/NoContexto/ErrNegado/ErrNaoEncontrado`; `banco.ComUsuario`; `dados.LerCorpo/Erro/ErroDeEscrita/escrever`; `testebanco.Novo`.

- [ ] **Step 1: O teste que falha.** Crie `api/internal/dados/escrita_test.go`:

```go
package dados

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/autz"
	"github.com/rbv-co/social-dashboard/api/internal/testebanco"
)

const catalogoDeEscrita = `[
 {"tabela":"coisa","nome":"le","tipo":"permissive","comando":"select","papeis":["authenticated"],"using":"pode_ver_conta(account_id)","withCheck":null},
 {"tabela":"coisa","nome":"cria","tipo":"permissive","comando":"insert","papeis":["authenticated"],"using":null,"withCheck":"is_frota_admin()"},
 {"tabela":"coisa","nome":"edita","tipo":"permissive","comando":"update","papeis":["authenticated"],"using":"pode_ver_conta(account_id)","withCheck":"pode_ver_conta(account_id)"},
 {"tabela":"coisa","nome":"apaga","tipo":"permissive","comando":"delete","papeis":["authenticated"],"using":"superadmin_pela_ficha()","withCheck":null}
]`

const (
	quemEscreve = "11111111-0000-4000-a000-000000000001"
	coisaA1     = "aaaaaaaa-0000-4000-a000-000000000001"
	coisaA2     = "aaaaaaaa-0000-4000-a000-000000000002"
)

type corpoCoisa struct {
	AccountID json.RawMessage `json:"account_id,omitempty"`
	Nome      json.RawMessage `json:"nome,omitempty"`
	Apelido   json.RawMessage `json:"apelido,omitempty"`
	Nivel     json.RawMessage `json:"nivel,omitempty"`
}

func (c corpoCoisa) Validar() error {
	if string(c.Nome) == `"proibido"` {
		return errors.New("nome proibido")
	}
	return nil
}

func TestCampos(t *testing.T) {
	var c corpoCoisa
	if err := json.Unmarshal([]byte(`{"nome":"x","apelido":null}`), &c); err != nil {
		t.Fatal(err)
	}
	m, err := Campos(&c)
	if err != nil || len(m) != 2 {
		t.Fatalf("campos = %v %v (ausente entrou ou null sumiu)", m, err)
	}
	if j, _ := json.Marshal(m); string(j) != `{"apelido":null,"nome":"x"}` {
		t.Fatalf("campos = %s", j)
	}
	type ruim struct {
		X json.RawMessage `json:"x; drop table coisa,omitempty"`
	}
	if _, err := Campos(&ruim{X: json.RawMessage(`1`)}); err == nil {
		t.Fatal("tag de coluna inválida passou")
	}
}

func TestTabelaValidar(t *testing.T) {
	cat, _ := autz.Compilar([]byte(catalogoDeEscrita))
	for _, tb := range []Tabela{{Nome: "fora", Resposta: "t.id"}, {Nome: "coisa"}, {Nome: "coisa", Resposta: "t.id", Autor: "x y"}} {
		if tb.Validar(cat) == nil {
			t.Errorf("%+v validou", tb)
		}
	}
}

func montarEscrita(t *testing.T) (http.Handler, *pgxpool.Pool) {
	t.Helper()
	cat, err := autz.Compilar([]byte(catalogoDeEscrita))
	if err != nil {
		t.Fatal(err)
	}
	p := testebanco.Novo(t)
	if _, err := p.Exec(context.Background(), `create table coisa (
		  id uuid primary key default gen_random_uuid(), account_id text, nome text not null default 'sem nome',
		  apelido text, nivel int, quem uuid default nullif(current_setting('app.usuario_id', true), '')::uuid,
		  segredo text default 'nunca-na-resposta');
		insert into coisa (id, account_id, nome, apelido) values ('`+coisaA1+`', 'A1', 'um', 'u'), ('`+coisaA2+`', 'A2', 'dois', 'd')`); err != nil {
		t.Fatal(err)
	}
	tab := Tabela{Nome: "coisa", Resposta: "t.id, t.account_id, t.nome, t.apelido, t.nivel, t.quem"}
	if err := tab.Validar(cat); err != nil {
		t.Fatal(err)
	}
	escopos := map[string]*autz.Escopo{
		"frota-a1": {ID: quemEscreve, TemPerfil: true, Ativo: true, SemTrava: true, Modulos: []string{"frota"}, Contas: []string{"A1"}},
		"so-a1":    {ID: quemEscreve, TemPerfil: true, Ativo: true, SemTrava: true, Contas: []string{"A1"}},
		"super":    {ID: quemEscreve, TemPerfil: true, Ativo: true, SuperFicha: true},
	}
	r := chi.NewRouter()
	r.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
			if e := escopos[req.Header.Get("X-Quem")]; e != nil {
				req = req.WithContext(autz.NoContexto(req.Context(), e))
			}
			next.ServeHTTP(w, req)
		})
	})
	r.Post("/coisas", RotaCriar[corpoCoisa](p, cat, tab))
	r.Patch("/coisas/{id}", RotaEditar[corpoCoisa](p, cat, tab))
	r.Delete("/coisas/{id}", RotaApagar(p, cat, tab))
	return r, p
}

func TestEscritaDeclarada(t *testing.T) {
	h, p := montarEscrita(t)
	um := func(sql string) string {
		var v *string
		if err := p.QueryRow(context.Background(), sql).Scan(&v); err != nil {
			t.Fatalf("%s: %v", sql, err)
		}
		if v == nil {
			return "<nulo>"
		}
		return *v
	}
	const total = "select count(*)::text from coisa"
	linha := func(id, cols string) string { return "select " + cols + " from coisa where id = '" + id + "'" }
	casos := []struct {
		nome, quem, metodo, caminho, corpo string
		status                             int
		tem, naoTem, efeito, quer          string
	}{
		{"cria e devolve pela lista da leitura, com a identidade da transação", "frota-a1", "POST", "/coisas", `{"account_id":"A1","nome":"tres"}`, 201, `"quem":"` + quemEscreve + `"`, "nunca-na-resposta", total, "3"},
		{"cria linha que depois não lê: só o id", "frota-a1", "POST", "/coisas", `{"account_id":"A2","nome":"quatro"}`, 201, `{"id":`, `"nome"`, total, "4"},
		{"sem a regra de criar: 403 e nada gravado", "so-a1", "POST", "/coisas", `{"account_id":"A1"}`, 403, "sem_permissao", "", total, "4"},
		{"campo não declarado: 400 e nada gravado", "frota-a1", "POST", "/coisas", `{"account_id":"A1","segredo":"x"}`, 400, "corpo_invalido", "", total, "4"},
		{"tipo que a coluna não aceita: 400 e nada gravado", "frota-a1", "POST", "/coisas", `{"account_id":"A1","nivel":"alto"}`, 400, "pedido_invalido", "", total, "4"},
		{"corpo vazio", "frota-a1", "POST", "/coisas", `{}`, 400, "Nada para gravar", "", total, "4"},
		{"Validar da struct", "frota-a1", "POST", "/coisas", `{"account_id":"A1","nome":"proibido"}`, 400, "nome proibido", "", total, "4"},
		{"sem escopo no contexto: 500 e nada gravado", "", "POST", "/coisas", `{"account_id":"A1"}`, 500, "erro_interno", "", total, "4"},
		{"edita só a coluna enviada", "so-a1", "PATCH", "/coisas/" + coisaA1, `{"nome":"um!"}`, 200, `"apelido":"u"`, "", linha(coisaA1, "nome || '/' || apelido"), "um!/u"},
		{"null explícito grava nulo", "so-a1", "PATCH", "/coisas/" + coisaA1, `{"apelido":null}`, 200, `"apelido":null`, "", linha(coisaA1, "apelido"), "<nulo>"},
		{"linha de outra conta: 404 (IDOR)", "so-a1", "PATCH", "/coisas/" + coisaA2, `{"nome":"x"}`, 404, "nao_encontrado", "", linha(coisaA2, "nome"), "dois"},
		{"mover para conta que não vê: 403", "so-a1", "PATCH", "/coisas/" + coisaA1, `{"account_id":"A2"}`, 403, "sem_permissao", "", linha(coisaA1, "account_id"), "A1"},
		{"id que nem é uuid: 404", "so-a1", "PATCH", "/coisas/1%20or%201=1", `{"nome":"x"}`, 404, "nao_encontrado", "", "", ""},
		{"tipo errado na edição: 400 e intacta", "so-a1", "PATCH", "/coisas/" + coisaA1, `{"nivel":"alto"}`, 400, "pedido_invalido", "", linha(coisaA1, "nivel::text"), "<nulo>"},
		{"apagar sem a regra: 403 e fica", "so-a1", "DELETE", "/coisas/" + coisaA1, "", 403, "sem_permissao", "", linha(coisaA1, "count(*)::text"), "1"},
		{"apagar linha invisível: 404 e fica", "so-a1", "DELETE", "/coisas/" + coisaA2, "", 404, "nao_encontrado", "", linha(coisaA2, "count(*)::text"), "1"},
		{"super pela ficha apaga", "super", "DELETE", "/coisas/" + coisaA2, "", 204, "", "", linha(coisaA2, "count(*)::text"), "0"},
	}
	for _, c := range casos {
		r := httptest.NewRequest(c.metodo, c.caminho, strings.NewReader(c.corpo))
		r.Header.Set("X-Quem", c.quem)
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		corpo := w.Body.String()
		if w.Code != c.status || (c.tem != "" && !strings.Contains(corpo, c.tem)) || (c.naoTem != "" && strings.Contains(corpo, c.naoTem)) {
			t.Errorf("%s: %d %s", c.nome, w.Code, corpo)
		}
		if c.efeito != "" {
			if v := um(c.efeito); v != c.quer {
				t.Errorf("%s: efeito %q = %q, esperava %q", c.nome, c.efeito, v, c.quer)
			}
		}
	}
}
```

Run: `go test -count=1 -run 'Campos|TabelaValidar|EscritaDeclarada' ./internal/dados/` → FAIL de compilação (`Tabela` não existe).

- [ ] **Step 2: Implementar.** Crie `api/internal/dados/escrita.go`:

```go
package dados

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"regexp"
	"slices"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/autz"
	"github.com/rbv-co/social-dashboard/api/internal/banco"
)

// Tabela é o caminho de ESCRITA declarado de uma tabela do catálogo. Nome, Resposta e Autor são
// texto FIXO da rota; o pedido só escolhe VALORES das colunas que a struct do corpo declara.
type Tabela struct {
	Nome     string // tabela do catálogo (ex.: "equipes")
	Resposta string // colunas devolvidas, sobre o alias t: a MESMA lista da leitura (ex.: "t.id, t.nome")
	Autor    string // coluna que recebe quem grava, na criação (ex.: "criado_por"); vazia = nenhuma
}

var reColuna = regexp.MustCompile(`^[a-z_][a-z0-9_]{0,62}$`)

// ErrSemCampos: o corpo não trouxe coluna nenhuma.
var ErrSemCampos = errors.New("dados: nada para gravar")

// Validar confere a declaração na montagem (erro = a API não sobe).
func (t Tabela) Validar(cat *autz.Catalogo) error {
	switch {
	case !cat.Tem(t.Nome):
		return fmt.Errorf("tabela %q fora do catálogo", t.Nome)
	case strings.TrimSpace(t.Resposta) == "":
		return fmt.Errorf("tabela %s: Resposta obrigatória", t.Nome)
	case t.Autor != "" && !reColuna.MatchString(t.Autor):
		return fmt.Errorf("tabela %s: Autor %q inválido", t.Nome, t.Autor)
	}
	return nil
}

// Campos devolve as colunas PRESENTES no corpo já lido. O corpo é uma struct de json.RawMessage
// com `json:"<coluna>,omitempty"`: chave ausente fica fora (não muda); `null` explícito entra (grava
// nulo). O tipo de cada valor é o Postgres que confere: jsonb_populate_record faz o cast pelo tipo
// da coluna (valor que não converte = 22P02 = 400).
func Campos(corpo any) (map[string]any, error) {
	j, err := json.Marshal(corpo)
	if err != nil {
		return nil, err
	}
	var m map[string]json.RawMessage
	if err := json.Unmarshal(j, &m); err != nil {
		return nil, err
	}
	campos := make(map[string]any, len(m))
	for k, v := range m {
		if !reColuna.MatchString(k) {
			return nil, fmt.Errorf("dados: coluna %q inválida na struct do corpo", k)
		}
		campos[k] = v
	}
	return campos, nil
}

// colunas: as chaves em ordem (SQL determinístico), conferidas e citadas.
func colunas(campos map[string]any) ([]string, error) {
	if len(campos) == 0 {
		return nil, ErrSemCampos
	}
	ks := make([]string, 0, len(campos))
	for k := range campos {
		if !reColuna.MatchString(k) {
			return nil, fmt.Errorf("dados: coluna %q inválida", k)
		}
		ks = append(ks, k)
	}
	slices.Sort(ks)
	for i, k := range ks {
		ks[i] = pgx.Identifier{k}.Sanitize()
	}
	return ks, nil
}

// Criar confere a linha nova (WITH CHECK de insert), grava SÓ as colunas presentes e devolve a linha.
// Rode dentro de banco.ComUsuario.
func (t Tabela) Criar(ctx context.Context, tx pgx.Tx, cat *autz.Catalogo, e *autz.Escopo, campos map[string]any) ([]byte, error) {
	if e == nil {
		return nil, autz.ErrNegado
	}
	if t.Autor != "" {
		campos[t.Autor] = e.ID // autoria vem da sessão, nunca do corpo
	}
	cols, err := colunas(campos)
	if err != nil {
		return nil, err
	}
	if err := cat.PodeCriar(ctx, tx, e, t.Nome, campos); err != nil {
		return nil, err
	}
	j, err := json.Marshal(campos)
	if err != nil {
		return nil, err
	}
	tab, lista := pgx.Identifier{t.Nome}.Sanitize(), strings.Join(cols, ", ")
	return t.devolver(ctx, tx, cat, e, `insert into `+tab+` (`+lista+`) select `+lista+
		` from jsonb_populate_record(null::`+tab+`, @dados_campos::jsonb) returning *`,
		pgx.NamedArgs{"dados_campos": string(j)})
}

// Editar confere (autz.PodeEditar trava a linha; Ler + USING na antiga; WITH CHECK na nova), muda SÓ
// as colunas presentes e devolve a linha. Rode dentro de banco.ComUsuario.
func (t Tabela) Editar(ctx context.Context, tx pgx.Tx, cat *autz.Catalogo, e *autz.Escopo, id string, campos map[string]any) ([]byte, error) {
	cols, err := colunas(campos)
	if err != nil {
		return nil, err
	}
	if err := cat.PodeEditar(ctx, tx, e, t.Nome, id, campos); err != nil {
		return nil, err
	}
	j, err := json.Marshal(campos)
	if err != nil {
		return nil, err
	}
	sets := make([]string, len(cols))
	for i, c := range cols {
		sets[i] = c + " = dados_r." + c
	}
	tab := pgx.Identifier{t.Nome}.Sanitize()
	return t.devolver(ctx, tx, cat, e, `update `+tab+` as dados_alvo set `+strings.Join(sets, ", ")+
		` from jsonb_populate_record(null::`+tab+`, @dados_campos::jsonb) as dados_r`+
		` where dados_alvo.id::text = @dados_id::text returning dados_alvo.*`,
		pgx.NamedArgs{"dados_campos": string(j), "dados_id": id})
}

// Apagar confere (autz.PodeApagar trava a linha; Ler + USING de delete) e apaga.
func (t Tabela) Apagar(ctx context.Context, tx pgx.Tx, cat *autz.Catalogo, e *autz.Escopo, id string) error {
	if err := cat.PodeApagar(ctx, tx, e, t.Nome, id); err != nil {
		return err
	}
	_, err := tx.Exec(ctx, `delete from `+pgx.Identifier{t.Nome}.Sanitize()+` where id::text = @dados_id::text`,
		pgx.NamedArgs{"dados_id": id})
	return err
}

// devolver roda a escrita como CTE e responde a linha pela lista Resposta se quem pede a lê DEPOIS
// de gravada (regra de Ler do catálogo sobre a linha nova); senão {"id": …} (contrato II.2).
func (t Tabela) devolver(ctx context.Context, tx pgx.Tx, cat *autz.Catalogo, e *autz.Escopo, escrita string, args pgx.NamedArgs) ([]byte, error) {
	f, err := cat.Filtro(e, t.Nome, autz.Ler, "t")
	if err != nil {
		return nil, err
	}
	var corpo []byte
	// row_to_json e não json_build_object: este escreve {"id" : …} com espaços; o PostgREST, compacto
	err = tx.QueryRow(ctx, `with t as (`+escrita+`) select coalesce(
		(select row_to_json(x) from (select `+t.Resposta+` from t where `+f.SQL+`) x),
		(select row_to_json(y) from (select t.id from t) y))`, f.Juntar(args)).Scan(&corpo)
	if err != nil {
		return nil, err
	}
	if corpo == nil {
		return nil, autz.ErrNaoEncontrado
	}
	return corpo, nil
}

// lerCampos lê o corpo C, roda C.Validar() se existir e devolve as colunas presentes. Já respondeu
// quando devolve false.
func lerCampos[C any](w http.ResponseWriter, r *http.Request) (map[string]any, bool) {
	var c C
	if !LerCorpo(w, r, &c) {
		return nil, false
	}
	if v, ok := any(&c).(interface{ Validar() error }); ok {
		if err := v.Validar(); err != nil {
			Erro(w, http.StatusBadRequest, "pedido_invalido", err.Error())
			return nil, false
		}
	}
	campos, err := Campos(&c)
	if err != nil { // tag de struct inválida: defeito da rota, não do pedido
		Erro(w, http.StatusInternalServerError, "erro_interno", "")
		return nil, false
	}
	if len(campos) == 0 {
		Erro(w, http.StatusBadRequest, "corpo_invalido", "Nada para gravar.")
		return nil, false
	}
	return campos, true
}

// escopoOuErro: rota de escrita montada fora de autz.ComEscopo é defeito de montagem: 500, nada gravado.
func escopoOuErro(w http.ResponseWriter, r *http.Request) *autz.Escopo {
	e := autz.EscopoDo(r.Context())
	if e == nil {
		Erro(w, http.StatusInternalServerError, "erro_interno", "")
	}
	return e
}

// RotaCriar: POST que lê o corpo C (struct de json.RawMessage), confere e grava em banco.ComUsuario.
func RotaCriar[C any](p *pgxpool.Pool, cat *autz.Catalogo, t Tabela) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		e := escopoOuErro(w, r)
		if e == nil {
			return
		}
		campos, ok := lerCampos[C](w, r)
		if !ok {
			return
		}
		var linha []byte
		err := banco.ComUsuario(r.Context(), p, e.ID, func(tx pgx.Tx) (err error) {
			linha, err = t.Criar(r.Context(), tx, cat, e, campos)
			return err
		})
		if err != nil {
			ErroDeEscrita(w, err)
			return
		}
		escrever(w, http.StatusCreated, linha)
	}
}

// RotaEditar: PATCH /…/{id} com o corpo C.
func RotaEditar[C any](p *pgxpool.Pool, cat *autz.Catalogo, t Tabela) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		e := escopoOuErro(w, r)
		if e == nil {
			return
		}
		campos, ok := lerCampos[C](w, r)
		if !ok {
			return
		}
		id := chi.URLParam(r, "id")
		var linha []byte
		err := banco.ComUsuario(r.Context(), p, e.ID, func(tx pgx.Tx) (err error) {
			linha, err = t.Editar(r.Context(), tx, cat, e, id, campos)
			return err
		})
		if err != nil {
			ErroDeEscrita(w, err)
			return
		}
		escrever(w, http.StatusOK, linha)
	}
}

// RotaApagar: DELETE /…/{id}.
func RotaApagar(p *pgxpool.Pool, cat *autz.Catalogo, t Tabela) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		e := escopoOuErro(w, r)
		if e == nil {
			return
		}
		id := chi.URLParam(r, "id")
		err := banco.ComUsuario(r.Context(), p, e.ID, func(tx pgx.Tx) error {
			return t.Apagar(r.Context(), tx, cat, e, id)
		})
		if err != nil {
			ErroDeEscrita(w, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

// Responder escreve um corpo JSON já montado (pelo Postgres) com o status.
func Responder(w http.ResponseWriter, status int, corpo []byte) { escrever(w, status, corpo) }
```

- [ ] **Step 3: Rodar e ver passar (e morder).** `gofmt -l ./internal && go vet ./internal/dados/ && go test -count=1 -v -run 'Campos|TabelaValidar|EscritaDeclarada' ./internal/dados/ 2>&1 | grep -E '^(--- |ok|FAIL)'` → `--- PASS`. Mutações que têm de reprovar (uma por vez): (1) apagar a chamada `cat.PodeCriar` em `Criar` ("sem a regra de criar"); (2) trocar `banco.ComUsuario(r.Context(), p, e.ID, …)` por `pgx.BeginFunc(r.Context(), p, …)` em `RotaCriar` (`quem` sai nulo); (3) em `Editar`, montar o `set` com TODAS as colunas da tabela em vez de `cols` ("edita só a coluna enviada"); (4) em `devolver`, trocar `where `+f.SQL por `where true` ("cria linha que depois não lê").

- [ ] **Step 4: Commit.**

```bash
git add api/internal/dados/escrita.go api/internal/dados/escrita_test.go
git commit -m "feat(api): caminho de escrita declarado (colunas da struct, regra do catálogo antes de gravar, identidade da transação)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: `acesso` — fundação (mundo de teste e portão de impersonado)

**Revisor:** opus. **Depende de:** 1.

**(a) Contrato**
- `soSessaoPropria(next http.Handler) http.Handler`: ator ausente ou com `ImpersonadorID` → `403 {"error":"sem_permissao","mensagem":"Quem entrou como outra pessoa não muda acessos nem avisos."}` (Ruling 5.1-4). Aplicado em TODA rota de escrita do 5.1.
- `deve(err error)`: declaração de rota errada → `panic` na montagem (a API não sobe).
- Teste (interno ao pacote): `novoMundo(t, montar ...func(chi.Router, *pgxpool.Pool)) *mundo` com o banco da Task 1, 11 pessoas, as linhas abaixo, uma sessão por pessoa (+ `"impersonado"` = sessão do admin aberta pelo super) e as rotas atrás da MESMA cadeia do grupo de domínio de `web.Rotas` (`auth.Exigir` → `autz.ComEscopo`); `(*mundo).pedir/resposta/rodar/um`; `type caso`; `fotoDoMundo` (hash de todas as tabelas escritas pelo 5.1, para "nada mudou").

**(b) Testes de aceitação**
- `TestMundoEACadeiaDoDominio`: sem sessão → 401; o `Escopo` de cada pessoa chega à rota (admin: papel `admin`; super pela ficha: papel `viewer`, `SuperFicha`; supervisora do grupo G1: 1 vínculo, o T3 pelo grupo); a sessão `impersonado` chega com `ImpersonadorID`.
- `TestSoSessaoPropria`: sem ator → 403; ator próprio → passa; ator impersonado → 403 e o handler não roda.

**(c) Arquivos:** Create `api/internal/acesso/acesso.go`, `api/internal/acesso/acesso_test.go`, `api/internal/acesso/mundo_test.go`.

**(d) Dependências:** `testebanco.ComEsquemaDeProducao` (Task 1); `auth.Exigir/NovoStore/Store.Criar/AtorDoContexto/NoContexto`; `autz.ComEscopo/EscopoDo`.

- [ ] **Step 1: O mundo.** Crie `api/internal/acesso/mundo_test.go`:

```go
package acesso

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/auth"
	"github.com/rbv-co/social-dashboard/api/internal/autz"
	"github.com/rbv-co/social-dashboard/api/internal/testebanco"
)

// Pessoas e linhas do mundo de teste do 5.1 (ids fixos). E-mails da lista de is_superadmin() só onde a
// regra pede: super (breno@) e erick@ (o perfil que guard_profiles protege).
const (
	idSuper      = "5e000000-0000-4000-a000-000000000001" // papel admin, super pela ficha E por e-mail
	idSuperFicha = "5e000000-0000-4000-a000-000000000002" // super SÓ pela ficha, papel viewer
	idAdmin      = "5e000000-0000-4000-a000-000000000003" // papel admin
	idViewer     = "5e000000-0000-4000-a000-000000000004" // trava de loja, só a conta A1, sem time
	idSemTrava   = "5e000000-0000-4000-a000-000000000005" // escopo_por_equipe = false
	idGestorT1   = "5e000000-0000-4000-a000-000000000006"
	idSupervT1   = "5e000000-0000-4000-a000-000000000007"
	idVendT1     = "5e000000-0000-4000-a000-000000000008"
	idVendT2     = "5e000000-0000-4000-a000-000000000009" // vendedora no T2 e no T3
	idSupervG1   = "5e000000-0000-4000-a000-000000000010" // supervisora do grupo G1 (a loja 3 é do G1: vê o T3)
	idErick      = "5e000000-0000-4000-a000-000000000011"

	T1 = "e1000000-0000-4000-a000-000000000001" // canal 1
	T2 = "e1000000-0000-4000-a000-000000000002" // canal 2
	T3 = "e1000000-0000-4000-a000-000000000003" // canal 3, loja do grupo G1
	G1 = "c6000000-0000-4000-a000-000000000001"
	G2 = "c6000000-0000-4000-a000-000000000002"
	A1 = "acc00000-0000-4000-a000-000000000001" // contas de anúncio
	A2 = "acc00000-0000-4000-a000-000000000002"

	mGestorT1       = "3e000000-0000-4000-a000-000000000001"
	mSupervT1       = "3e000000-0000-4000-a000-000000000002"
	mVendT1         = "3e000000-0000-4000-a000-000000000003"
	mVendT2         = "3e000000-0000-4000-a000-000000000004"
	mVendT2emT3     = "3e000000-0000-4000-a000-000000000005"
	cgmSupervG1     = "3c000000-0000-4000-a000-000000000001"
	epVendT1        = "3d000000-0000-4000-a000-000000000001"
	epVendT2        = "3d000000-0000-4000-a000-000000000002"
	perfilVendedora = "3a000000-0000-4000-a000-000000000001"
	pedido1         = "3b000000-0000-4000-a000-000000000001"
)

var pessoas = []struct {
	chave, id, email, papel string
	super, trava            bool
	contas                  []string
}{
	{"super", idSuper, "breno@rbvcompany.com", "admin", true, false, nil},
	{"superFicha", idSuperFicha, "superficha@x.com", "viewer", true, false, nil},
	{"admin", idAdmin, "admin@x.com", "admin", false, false, nil},
	{"viewer", idViewer, "viewer@x.com", "viewer", false, true, []string{A1}},
	{"semTrava", idSemTrava, "semtrava@x.com", "viewer", false, false, nil},
	{"gestorT1", idGestorT1, "gestort1@x.com", "viewer", false, true, nil},
	{"supervT1", idSupervT1, "supervt1@x.com", "viewer", false, true, nil},
	{"vendT1", idVendT1, "vendt1@x.com", "viewer", false, true, nil},
	{"vendT2", idVendT2, "vendt2@x.com", "viewer", false, true, nil},
	{"supervG1", idSupervG1, "supervg1@x.com", "viewer", false, true, nil},
	{"erick", idErick, "erick@rbvcompany.com", "admin", true, false, nil},
}

// sem identidade: os gatilhos de profiles são só de UPDATE
const linhasDoMundo = `
insert into canais_grupos (id, nome) values ('` + G1 + `', 'Varejo'), ('` + G2 + `', 'Atacado');
insert into bling_lojas (loja_id, nome, grupo_id) values (1, 'Loja 1', null), (2, 'Loja 2', null), (3, 'Loja 3', '` + G1 + `');
insert into equipes (id, nome, canal_loja_id) values ('` + T1 + `', 'Time 1', 1), ('` + T2 + `', 'Time 2', 2), ('` + T3 + `', 'Time 3', 3);
insert into equipes_membros (id, equipe_id, profile_id, papel) values
  ('` + mGestorT1 + `', '` + T1 + `', '` + idGestorT1 + `', 'gestor'),
  ('` + mSupervT1 + `', '` + T1 + `', '` + idSupervT1 + `', 'supervisora'),
  ('` + mVendT1 + `', '` + T1 + `', '` + idVendT1 + `', 'vendedora'),
  ('` + mVendT2 + `', '` + T2 + `', '` + idVendT2 + `', 'vendedora'),
  ('` + mVendT2emT3 + `', '` + T3 + `', '` + idVendT2 + `', 'vendedora');
insert into canais_grupos_membros (id, grupo_id, profile_id) values ('` + cgmSupervG1 + `', '` + G1 + `', '` + idSupervG1 + `');
insert into equipes_permissoes (id, equipe_id, profile_id, chave) values
  ('` + epVendT1 + `', '` + T1 + `', '` + idVendT1 + `', 'estoque'), ('` + epVendT2 + `', '` + T2 + `', '` + idVendT2 + `', 'estoque');
insert into acessos_perfis (id, nome, permissions) values ('` + perfilVendedora + `', 'Vendedora', '{"frota":["ver"]}');
insert into access_requests (id, name, email, message, created_at)
  values ('` + pedido1 + `', 'Fulana', 'fulana@x.com', 'quero entrar', '2026-10-10T12:00:00Z');
insert into push_subs (endpoint, p256dh, auth, user_id) values
  ('https://push.exemplo/viewer', 'kv', 'av', '` + idViewer + `'), ('https://push.exemplo/admin', 'ka', 'aa', '` + idAdmin + `');
insert into push_preferencias (user_id, tipo, ativo) values ('` + idViewer + `', 'vendas', true), ('` + idAdmin + `', 'vendas', false);
insert into data_integrity_checks (checked_date, account_id, check_name, status, detail) values
  ('2026-10-11', '` + A1 + `', 'coleta_zerada', 'fail', 'conta A1'),
  ('2026-10-11', '` + A2 + `', 'coleta_zerada', 'fail', 'conta A2'),
  ('2026-10-11', null, 'meta_spotcheck', 'warn', 'sem conta');
insert into ia_execucoes (run_at, robo, acao) values ('2026-10-10T10:00:00Z', 'panorama', 'antiga'), ('2026-10-11T10:00:00Z', 'panorama', 'nova');`

// fotoDoMundo: um hash de todas as tabelas que o 5.1 escreve (e do rastro). Igual antes e depois = nada mudou.
const fotoDoMundo = `select md5(string_agg(l, '|' order by l)) from (
  select 'profiles:' || t::text as l from profiles t union all
  select 'equipes:' || t::text from equipes t union all
  select 'equipes_membros:' || t::text from equipes_membros t union all
  select 'equipes_permissoes:' || t::text from equipes_permissoes t union all
  select 'canais_grupos:' || t::text from canais_grupos t union all
  select 'canais_grupos_membros:' || t::text from canais_grupos_membros t union all
  select 'acessos_perfis:' || t::text from acessos_perfis t union all
  select 'access_requests:' || t::text from access_requests t union all
  select 'push_subs:' || t::text from push_subs t union all
  select 'push_preferencias:' || t::text from push_preferencias t union all
  select 'audit_log:' || t::text from audit_log t) z`

type mundo struct {
	p   *pgxpool.Pool
	h   http.Handler
	tok map[string]string
}

// novoMundo: a fatia de produção, as pessoas e as linhas acima, uma sessão por pessoa (+ "impersonado":
// a sessão do admin aberta pelo super) e as rotas de `montar` atrás da MESMA cadeia do grupo de
// domínio de web.Rotas: auth.Exigir → autz.ComEscopo (Ruling 5.1-12).
func novoMundo(t *testing.T, montar ...func(chi.Router, *pgxpool.Pool)) *mundo {
	t.Helper()
	p := testebanco.ComEsquemaDeProducao(t)
	ctx := context.Background()
	s := auth.NovoStore(p)
	m := &mundo{p: p, tok: map[string]string{}}
	for _, x := range pessoas {
		if _, err := p.Exec(ctx, `insert into usuarios (id, email) values ($1::uuid, $2::text)`, x.id, x.email); err != nil {
			t.Fatal(err)
		}
		if _, err := p.Exec(ctx, `insert into profiles (id, email, name, role, is_superadmin, escopo_por_equipe, allowed_accounts)
			values ($1::uuid, $2::text, $3::text, $4::text, $5::boolean, $6::boolean, $7::uuid[])`,
			x.id, x.email, x.chave, x.papel, x.super, x.trava, x.contas); err != nil {
			t.Fatal(err)
		}
		tok, err := s.Criar(ctx, x.id, "painel", nil)
		if err != nil {
			t.Fatal(err)
		}
		m.tok[x.chave] = tok
	}
	super := idSuper
	tok, err := s.Criar(ctx, idAdmin, "painel", &super)
	if err != nil {
		t.Fatal(err)
	}
	m.tok["impersonado"] = tok
	if _, err := p.Exec(ctx, linhasDoMundo); err != nil {
		t.Fatal(err)
	}
	r := chi.NewRouter()
	r.Group(func(r chi.Router) {
		r.Use(auth.Exigir(p, s))
		r.Use(autz.ComEscopo(p))
		for _, f := range montar {
			f(r, p)
		}
	})
	m.h = r
	return m
}

// resposta faz a requisição como `quem` ("" = sem sessão).
func (m *mundo) resposta(t *testing.T, quem, metodo, caminho, corpo string) *httptest.ResponseRecorder {
	t.Helper()
	r := httptest.NewRequest(metodo, caminho, strings.NewReader(corpo))
	if quem != "" {
		tok, ok := m.tok[quem]
		if !ok {
			t.Fatalf("pessoa %q fora do mundo", quem)
		}
		r.Header.Set("Authorization", "Bearer "+tok)
	}
	w := httptest.NewRecorder()
	m.h.ServeHTTP(w, r)
	return w
}

func (m *mundo) pedir(t *testing.T, quem, metodo, caminho, corpo string) (int, string) {
	t.Helper()
	w := m.resposta(t, quem, metodo, caminho, corpo)
	return w.Code, w.Body.String()
}

// um roda uma consulta de UMA coluna ::text (nulo = "<nulo>").
func (m *mundo) um(t *testing.T, sql string, args ...any) string {
	t.Helper()
	var v *string
	if err := m.p.QueryRow(context.Background(), sql, args...).Scan(&v); err != nil {
		t.Fatalf("%s: %v", sql, err)
	}
	if v == nil {
		return "<nulo>"
	}
	return *v
}

// caso: uma requisição e o que tem de sair dela. efeito/quer: consulta rodada DEPOIS (o "negado não
// grava"); caso sem metodo só confere o efeito.
type caso struct {
	nome, quem, metodo, caminho, corpo string
	status                             int
	tem, naoTem                        string
	efeito, quer                       string
}

func (m *mundo) rodar(t *testing.T, casos []caso) {
	t.Helper()
	for _, c := range casos {
		if c.metodo != "" {
			st, corpo := m.pedir(t, c.quem, c.metodo, c.caminho, c.corpo)
			if st != c.status || (c.tem != "" && !strings.Contains(corpo, c.tem)) || (c.naoTem != "" && strings.Contains(corpo, c.naoTem)) {
				t.Errorf("%s: %s %s como %q = %d %s; esperava %d com %q e sem %q", c.nome, c.metodo, c.caminho, c.quem, st, corpo, c.status, c.tem, c.naoTem)
			}
		}
		if c.efeito != "" {
			if v := m.um(t, c.efeito); v != c.quer {
				t.Errorf("%s: efeito %q = %q, esperava %q", c.nome, c.efeito, v, c.quer)
			}
		}
	}
}
```

- [ ] **Step 2: Os testes que falham.** Crie `api/internal/acesso/acesso_test.go` com `TestMundoEACadeiaDoDominio` (rota de sonda `GET /eco` no próprio teste, que escreve `papel|superFicha|impersonado|len(Vinculos)` a partir de `autz.EscopoDo` e `auth.AtorDoContexto`; casos: sem sessão 401; `admin` → `admin|false|false|0`; `superFicha` → `viewer|true|false|0`; `supervG1` → `viewer|false|false|1`; `impersonado` → `admin|false|true|0`) e `TestSoSessaoPropria` (handler interno que responde 204; sem ator → 403; `&auth.Ator{ID: idAdmin}` → 204; com `ImpersonadorID` → 403 com a frase e o 204 nunca acontece). Run: `go test -count=1 ./internal/acesso/` → FAIL de compilação (`soSessaoPropria`).

- [ ] **Step 3: Implementar.** Crie `api/internal/acesso/acesso.go`:

```go
// Package acesso: as rotas do sub-plano 5.1 — usuários e perfis de acesso, pedidos de acesso, times,
// grupos de canal, avisos (push) e saúde. Toda regra é a do catálogo de produção (autz.Producao);
// toda escrita roda em banco.ComUsuario (os gatilhos de profiles e os default auth.uid() leem quem
// pede); sessão de "entrar como" só lê (Ruling 5.1-4).
package acesso

import (
	"net/http"

	"github.com/rbv-co/social-dashboard/api/internal/auth"
	"github.com/rbv-co/social-dashboard/api/internal/dados"
)

// soSessaoPropria recusa as escritas do 5.1 a quem entrou como outra pessoa: o rastro (audit_log)
// atribuiria ao alvo o que o super-admin fez, e a inscrição de push deixaria o aparelho dele
// recebendo os avisos do alvo.
func soSessaoPropria(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if a := auth.AtorDoContexto(r.Context()); a == nil || a.ImpersonadorID != nil {
			dados.Erro(w, http.StatusForbidden, "sem_permissao", "Quem entrou como outra pessoa não muda acessos nem avisos.")
			return
		}
		next.ServeHTTP(w, r)
	})
}

// deve: declaração de rota errada (Consulta ou Tabela fora do catálogo) faz a API não subir.
func deve(err error) {
	if err != nil {
		panic(err)
	}
}
```

- [ ] **Step 4: Rodar e ver passar.** `gofmt -l ./internal && go vet ./internal/acesso/ && go test -count=1 -v ./internal/acesso/ 2>&1 | grep -E '^(--- |ok|FAIL)'` → `--- PASS`. Mutação que tem de reprovar: `a == nil || a.ImpersonadorID != nil` → `a == nil`.

- [ ] **Step 5: Commit.**

```bash
git add api/internal/acesso/
git commit -m "feat(api): pacote acesso — mundo de teste do 5.1 e escrita recusada a quem entrou como outra pessoa

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Usuários — `GET/PATCH /acesso/usuarios`

**Revisor:** opus. **Depende de:** 2, 3.

**(a) Contrato**
- `GET /acesso/usuarios` → array com `id, email, name, role, is_superadmin, permissions, permissions_excecao, features, disabled, avatar_url, allowed_accounts, created_at, perfil_id, escopo_por_equipe`. Filtros: `id` (uuid), `email` (igualdade sem caixa, Ruling 5.1-7), `perfil_id` (uuid). `ordem`: `name` (padrão), `email`, `created_at`; desempate `t.id`. Regra: `auth_read_profiles` (sessão de conta ativa lê todos os perfis), como hoje. `contar=1` → `X-Total-Count`.
- `PATCH /acesso/usuarios/{id}` (`soSessaoPropria`) com qualquer subconjunto de `avatar_url, precisa_trocar_senha, perfil_id, permissions, permissions_excecao, features, allowed_accounts, is_superadmin, escopo_por_equipe, role, disabled` → `200` com a linha. `permissions`/`permissions_excecao` têm de ser objeto (Ruling 5.1-13). Regra: `admin_update_profiles` (`get_my_role() = 'admin'`, com Ler) + os gatilhos: `guard_profiles` (cargo só por super por e-mail; perfil do `erick@` só por super; rastro em `audit_log`) → 400 `regra_de_negocio` com a frase; `impedir_autopromocao` (o próprio acesso só por super) → 403. Linha inexistente/id inválido → 404. Paridade e achado: Ruling 5.1-3.

**(b) Testes de aceitação** (`TestUsuariosLeitura`, `TestEditarUsuario`; código abaixo)

**(c) Arquivos:** Create `api/internal/acesso/usuarios.go`, `api/internal/acesso/usuarios_test.go`.

**(d) Dependências:** `dados.Consulta/Tabela/RotaEditar` (Task 2), `soSessaoPropria/deve` e o mundo (Task 3), `autz.Producao`.

- [ ] **Step 1: Os testes que falham.** Crie `api/internal/acesso/usuarios_test.go`:

```go
package acesso

import (
	"context"
	"encoding/json"
	"testing"
)

func TestUsuariosLeitura(t *testing.T) {
	m := novoMundo(t, montarUsuarios)
	m.p.Exec(context.Background(), `update profiles set perfil_id = '`+perfilVendedora+`' where id = '`+idVendT1+`'`)
	m.rodar(t, []caso{
		{nome: "sem sessão", metodo: "GET", caminho: "/acesso/usuarios", status: 401},
		{nome: "conta ativa lê todos os perfis (auth_read_profiles)", quem: "vendT1", metodo: "GET", caminho: "/acesso/usuarios", status: 200, tem: `"email":"admin@x.com"`},
		{nome: "e-mail sem caixa", quem: "admin", metodo: "GET", caminho: "/acesso/usuarios?email=ADMIN@X.COM", status: 200, tem: idAdmin, naoTem: idViewer},
		{nome: "por perfil de acesso", quem: "admin", metodo: "GET", caminho: "/acesso/usuarios?perfil_id=" + perfilVendedora, status: 200, tem: idVendT1, naoTem: idVendT2},
		{nome: "id malformado", quem: "admin", metodo: "GET", caminho: "/acesso/usuarios?id=1%20or%201=1", status: 400},
		{nome: "ordem fora da lista", quem: "admin", metodo: "GET", caminho: "/acesso/usuarios?ordem=permissions", status: 400},
		{nome: "parâmetro desconhecido não vira filtro silencioso", quem: "admin", metodo: "GET", caminho: "/acesso/usuarios?role=admin", status: 400},
	})
	var l []map[string]any
	if _, corpo := m.pedir(t, "vendT1", "GET", "/acesso/usuarios", ""); json.Unmarshal([]byte(corpo), &l) != nil || len(l) != len(pessoas) {
		t.Fatalf("lista = %d pessoas, esperava %d", len(l), len(pessoas))
	}
	if w := m.resposta(t, "admin", "GET", "/acesso/usuarios?email=admin@x.com&contar=1", ""); w.Header().Get("X-Total-Count") != "1" {
		t.Fatalf("X-Total-Count = %q", w.Header().Get("X-Total-Count"))
	}
}

func TestEditarUsuario(t *testing.T) {
	m := novoMundo(t, montarUsuarios)
	u := func(id string) string { return "/acesso/usuarios/" + id }
	col := func(c, id string) string {
		return "select coalesce(" + c + "::text, '<nulo>') from profiles where id = '" + id + "'"
	}
	rastro := func(acao, ator string) string {
		return "select count(*)::text from audit_log where action = '" + acao + "' and actor_id = '" + ator + "'"
	}
	m.rodar(t, []caso{
		{"admin muda as permissões de outra pessoa", "admin", "PATCH", u(idVendT1), `{"permissions":{"frota":["ver"]},"features":["frota"]}`, 200, `"features":["frota"]`, "", col("permissions", idVendT1), `{"frota": ["ver"]}`},
		{"…e o gatilho registra QUEM mudou (a identidade chegou)", "", "", "", "", 0, "", "", rastro("acesso_change", idAdmin), "1"},
		{"viewer não edita perfil", "viewer", "PATCH", u(idVendT1), `{"disabled":true}`, 403, "sem_permissao", "", col("disabled", idVendT1), "false"},
		{"super pela ficha com papel viewer não edita (a policy lê role = 'admin')", "superFicha", "PATCH", u(idVendT1), `{"disabled":true}`, 403, "", "", col("disabled", idVendT1), "false"},
		{"gestor de time não edita perfil", "gestorT1", "PATCH", u(idVendT1), `{"disabled":true}`, 403, "", "", col("disabled", idVendT1), "false"},
		{"admin comum não muda cargo (guard_profiles)", "admin", "PATCH", u(idVendT1), `{"role":"admin"}`, 400, "Apenas o superadmin pode alterar o cargo", "", col("role", idVendT1), "viewer"},
		{"super por e-mail muda cargo, com rastro", "super", "PATCH", u(idVendT2), `{"role":"admin"}`, 200, `"role":"admin"`, "", rastro("role_change", idSuper), "1"},
		{"admin não mexe no próprio acesso (impedir_autopromocao)", "admin", "PATCH", u(idAdmin), `{"permissions":{"tudo":["ver"]}}`, 403, "", "", col("permissions", idAdmin), "{}"},
		{"admin não mexe no perfil do erick (guard_profiles)", "admin", "PATCH", u(idErick), `{"disabled":true}`, 400, "perfil do superadmin", "", col("disabled", idErick), "false"},
		{"lista de contas", "admin", "PATCH", u(idViewer), `{"allowed_accounts":["` + A2 + `"]}`, 200, A2, "", col("allowed_accounts", idViewer), "{" + A2 + "}"},
		{"chave ausente não muda", "admin", "PATCH", u(idViewer), `{"disabled":false}`, 200, "", "", col("allowed_accounts", idViewer), "{" + A2 + "}"},
		{"null explícito: vê todas as contas", "admin", "PATCH", u(idViewer), `{"allowed_accounts":null}`, 200, `"allowed_accounts":null`, "", col("allowed_accounts", idViewer), "<nulo>"},
		{"permissions tem de ser objeto", "admin", "PATCH", u(idVendT1), `{"permissions":["frota"]}`, 400, "objeto", "", col("permissions", idVendT1), `{"frota": ["ver"]}`},
		{"tipo que a coluna não aceita", "admin", "PATCH", u(idVendT1), `{"is_superadmin":"sim"}`, 400, "pedido_invalido", "", col("is_superadmin", idVendT1), "false"},
		{"coluna que nenhuma tela grava", "admin", "PATCH", u(idVendT1), `{"email":"x@y.com"}`, 400, "corpo_invalido", "", col("email", idVendT1), "vendt1@x.com"},
		{"id que não existe", "admin", "PATCH", u("5e000000-0000-4000-a000-000000000099"), `{"disabled":true}`, 404, "nao_encontrado", "", "", ""},
		{"id malformado", "admin", "PATCH", u("nao-e-uuid"), `{"disabled":true}`, 404, "nao_encontrado", "", "", ""},
		{"entrar-como não edita (Ruling 5.1-4)", "impersonado", "PATCH", u(idVendT1), `{"disabled":true}`, 403, "Quem entrou como outra pessoa", "", col("disabled", idVendT1), "false"},
		{"o resto do que as telas gravam", "admin", "PATCH", u(idVendT1), `{"avatar_url":"https://x/a.png","precisa_trocar_senha":true,"perfil_id":"` + perfilVendedora + `","permissions_excecao":{}}`, 200, perfilVendedora, "", col("precisa_trocar_senha", idVendT1), "true"},
		{"ACHADO (Ruling 5.1-3): admin comum marca super-admin de outra conta — paridade com produção", "admin", "PATCH", u(idVendT1), `{"is_superadmin":true}`, 200, "", "", col("is_superadmin", idVendT1), "true"},
	})
}
```

Run: `go test -count=1 -run 'Usuarios|EditarUsuario' ./internal/acesso/` → FAIL de compilação (`montarUsuarios`).

- [ ] **Step 2: Implementar.** Crie `api/internal/acesso/usuarios.go`:

```go
package acesso

import (
	"encoding/json"
	"fmt"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/autz"
	"github.com/rbv-co/social-dashboard/api/internal/dados"
)

const colunasUsuario = `t.id, t.email, t.name, t.role, t.is_superadmin, t.permissions, t.permissions_excecao, ` +
	`t.features, t.disabled, t.avatar_url, t.allowed_accounts, t.created_at, t.perfil_id, t.escopo_por_equipe`

// GET /acesso/usuarios: a lista de pessoas de todas as telas (admin, times, frota, conteúdo, redes).
// Regra: auth_read_profiles (sessão de conta ativa lê todos os perfis).
var consultaUsuarios = dados.Consulta{
	Tabela: "profiles", Alias: "t",
	SQL: `select ` + colunasUsuario + ` from profiles t`,
	Filtros: []dados.Filtro{
		{Param: "id", SQL: "t.id = @id::uuid", Tipo: "uuid"},
		{Param: "email", SQL: "lower(t.email) = lower(@email::text)", Tipo: "texto"},
		{Param: "perfil_id", SQL: "t.perfil_id = @perfil_id::uuid", Tipo: "uuid"},
	},
	Ordens:      map[string]string{"name": "t.name", "email": "t.email", "created_at": "t.created_at"},
	OrdemPadrao: "t.name",
	Desempate:   "t.id",
}

// corpoUsuario: as colunas de profiles que as telas gravam (inventário). Ausente = não muda; null
// explícito = grava nulo (allowed_accounts nulo = vê todas as contas).
type corpoUsuario struct {
	AvatarURL          json.RawMessage `json:"avatar_url,omitempty"`
	PrecisaTrocarSenha json.RawMessage `json:"precisa_trocar_senha,omitempty"`
	PerfilID           json.RawMessage `json:"perfil_id,omitempty"`
	Permissions        json.RawMessage `json:"permissions,omitempty"`
	PermissionsExcecao json.RawMessage `json:"permissions_excecao,omitempty"`
	Features           json.RawMessage `json:"features,omitempty"`
	AllowedAccounts    json.RawMessage `json:"allowed_accounts,omitempty"`
	IsSuperadmin       json.RawMessage `json:"is_superadmin,omitempty"`
	EscopoPorEquipe    json.RawMessage `json:"escopo_por_equipe,omitempty"`
	Role               json.RawMessage `json:"role,omitempty"`
	Disabled           json.RawMessage `json:"disabled,omitempty"`
}

// Validar: os dois mapas de permissão têm de ser objeto (Ruling 5.1-13); o resto é o tipo da coluna.
func (c corpoUsuario) Validar() error {
	for nome, v := range map[string]json.RawMessage{"permissions": c.Permissions, "permissions_excecao": c.PermissionsExcecao} {
		var m map[string]json.RawMessage
		if v != nil && (json.Unmarshal(v, &m) != nil || m == nil) {
			return fmt.Errorf("%s tem de ser um objeto", nome)
		}
	}
	return nil
}

// PATCH /acesso/usuarios/{id}. Regra: admin_update_profiles + os gatilhos guard_profiles e
// impedir_autopromocao, que leem auth.uid() dentro de banco.ComUsuario.
var tabelaUsuarios = dados.Tabela{Nome: "profiles", Resposta: colunasUsuario}

func montarUsuarios(r chi.Router, p *pgxpool.Pool) {
	deve(consultaUsuarios.Validar(autz.Producao))
	deve(tabelaUsuarios.Validar(autz.Producao))
	r.Get("/acesso/usuarios", consultaUsuarios.Handler(p, autz.Producao))
	r.With(soSessaoPropria).Patch("/acesso/usuarios/{id}", dados.RotaEditar[corpoUsuario](p, autz.Producao, tabelaUsuarios))
}
```

- [ ] **Step 3: Rodar e ver passar (e morder).** `gofmt -l ./internal && go vet ./internal/acesso/ && go test -count=1 -v -run 'Usuarios|EditarUsuario' ./internal/acesso/ 2>&1 | grep -E '^(--- |ok|FAIL)'`. Mutações que têm de reprovar: tirar `r.With(soSessaoPropria)`; trocar `dados.Tabela{Nome: "profiles"…}` por um handler que faz `p.Exec(update…)` sem `ComUsuario` (o gatilho confia: "admin comum não muda cargo" passa a 200); apagar o `Validar` de `corpoUsuario`.

- [ ] **Step 4: Commit.** `git add api/internal/acesso/usuarios.go api/internal/acesso/usuarios_test.go && git commit -m "feat(api): /acesso/usuarios — leitura e edição de perfis com a regra de produção e os gatilhos vendo quem pede"` (+ linha `Co-Authored-By`).

---

### Task 5: Times — equipes, membros e liberações de estoque

**Revisor:** opus. **Depende de:** 2, 3.

**(a) Contrato** (declarações = o código; `soSessaoPropria` em toda escrita)

```go
const colunasTime = `t.id, t.nome, t.tipo, t.ativo, t.canal_loja_id, t.local_id, t.setor_id, t.empresa_id, ` +
	`t.deposito_id, t.ordem, t.criado_em, t.atualizado_em`

// GET /equipes/times. Regra equipes_leitura: true (toda sessão).
var consultaTimes = dados.Consulta{Tabela: "equipes", Alias: "t", SQL: `select ` + colunasTime + ` from equipes t`,
	Ordens: map[string]string{"nome": "t.nome", "ordem": "t.ordem"}, OrdemPadrao: "t.ordem, t.nome", Desempate: "t.id"}

// POST /equipes/times (equipes_criar: super pela ficha OU gestor direto em alguma equipe) e
// PATCH /equipes/times/{id} (equipes_editar: sou_gestor_da_equipe(id)). O que a tela grava (tela-de-admin.vue:1726).
type corpoTime struct {
	Nome        json.RawMessage `json:"nome,omitempty"`
	Tipo        json.RawMessage `json:"tipo,omitempty"`
	CanalLojaID json.RawMessage `json:"canal_loja_id,omitempty"`
}
var tabelaTimes = dados.Tabela{Nome: "equipes", Resposta: colunasTime}

const colunasMembro = `t.id, t.equipe_id, t.profile_id, t.papel, t.criado_em, t.criado_por`

// GET /equipes/membros. Regra membros_leitura: a própria linha OU pode_ver_equipe(equipe_id).
var consultaMembros = dados.Consulta{Tabela: "equipes_membros", Alias: "t", SQL: `select ` + colunasMembro + ` from equipes_membros t`,
	Filtros: []dados.Filtro{
		{Param: "equipe_id", SQL: "t.equipe_id = @equipe_id::uuid", Tipo: "uuid"},
		{Param: "profile_id", SQL: "t.profile_id = @profile_id::uuid", Tipo: "uuid"},
		{Param: "papel", SQL: "t.papel = any(@papel::text[])", Tipo: "texto[]"},
	},
	Ordens: map[string]string{"criado_em": "t.criado_em"}, OrdemPadrao: "t.criado_em", Desempate: "t.id"}

// POST /equipes/membros, PATCH (só o papel: trocar de time não existe na tela) e DELETE /equipes/membros/{id}.
// Regra membros_escrever: sou_gestor_da_equipe(equipe_id) antes e depois. criado_por = default auth.uid().
type corpoMembroNovo struct {
	EquipeID  json.RawMessage `json:"equipe_id,omitempty"`
	ProfileID json.RawMessage `json:"profile_id,omitempty"`
	Papel     json.RawMessage `json:"papel,omitempty"`
}
type corpoMembroPapel struct {
	Papel json.RawMessage `json:"papel,omitempty"`
}
var tabelaMembros = dados.Tabela{Nome: "equipes_membros", Resposta: colunasMembro}

const colunasLiberacao = `t.id, t.equipe_id, t.profile_id, t.chave, t.concedido_por, t.criado_em`

// GET /equipes/permissoes (eqperm_leitura: a própria OU pode_ver_equipe), POST e DELETE /equipes/permissoes/{id}
// (eqperm_escrever: super pela ficha OU supervisora/gestora do time pelos vínculos). concedido_por = default auth.uid().
var consultaLiberacoes = dados.Consulta{Tabela: "equipes_permissoes", Alias: "t", SQL: `select ` + colunasLiberacao + ` from equipes_permissoes t`,
	Filtros: []dados.Filtro{
		{Param: "equipe_id", SQL: "t.equipe_id = @equipe_id::uuid", Tipo: "uuid"},
		{Param: "profile_id", SQL: "t.profile_id = @profile_id::uuid", Tipo: "uuid"},
	},
	Ordens: map[string]string{"criado_em": "t.criado_em"}, OrdemPadrao: "t.criado_em", Desempate: "t.id"}
type corpoLiberacao struct {
	EquipeID  json.RawMessage `json:"equipe_id,omitempty"`
	ProfileID json.RawMessage `json:"profile_id,omitempty"`
	Chave     json.RawMessage `json:"chave,omitempty"`
}
var tabelaLiberacoes = dados.Tabela{Nome: "equipes_permissoes", Resposta: colunasLiberacao}

// montarTimes: GET/POST /equipes/times, PATCH /equipes/times/{id}; GET/POST /equipes/membros,
// PATCH/DELETE /equipes/membros/{id}; GET/POST /equipes/permissoes, DELETE /equipes/permissoes/{id}.
// Cada Consulta/Tabela passa por deve(…Validar(autz.Producao)); cada escrita por r.With(soSessaoPropria).
func montarTimes(r chi.Router, p *pgxpool.Pool)
```

Erros de banco esperados: canal já de outro time (`equipes_canal_unico`) e pessoa já no time → 409; `tipo`/`papel`/`chave` fora da lista (check) → 400. Liberação é apagada por **id** (Ruling 5.1-14).

**(b) Testes de aceitação** (`TestTimesMembrosELiberacoes`, com `m.rodar`; "intacta"/"nada gravado" conferidos por `efeito`)
- Times: `vendT1` GET → T1, T2 e T3. `super` POST `{"nome":"Time 4"}` → 201; `gestorT1` POST `{"nome":"Time 5"}` → 201 (gestor direto); `supervT1` POST → 403 e `admin` POST → 403 (papel admin não cria time), contagem igual. `gestorT1` PATCH T1 `{"nome":"Time Um"}` → 200 e `atualizado_em` move (gatilho); `gestorT1` PATCH T2 → 403 (T2 é visível: leitura `true`), intacto; `supervG1` PATCH T3 → 403 (supervisora não é gestora); `superFicha` PATCH T2 → 200 (`sou_gestor_da_equipe` aceita a ficha); `gestorT1` PATCH T1 `{"canal_loja_id":2}` → 409, intacto; `{"tipo":"bar"}` → 400.
- Membros, leitura (IDOR): `vendT1` GET → `mGestorT1`, `mSupervT1`, `mVendT1`, sem `mVendT2`; `vendT1` GET `?equipe_id=`T2 → `[]`; `semTrava` GET → os 5; `supervG1` GET `?equipe_id=`T3 → `mVendT2emT3` (vínculo pelo grupo), sem `mVendT2`; `gestorT1` GET `?profile_id=`gestorT1`&papel=gestor,supervisora&limite=1` → só `mGestorT1`.
- Membros, escrita: `gestorT1` POST `{equipe_id:T1, profile_id:viewer}` → 201 com `criado_por` = gestorT1 (identidade); `gestorT1` POST em T2 → 403, contagem igual; `supervT1` POST em T1 → 403; repetir `vendT1` em T1 → 409. `gestorT1` PATCH `mVendT1` `{"papel":"supervisora"}` → 200; `gestorT1` PATCH `mVendT2` → 404 (invisível com a trava), intacto; `semTrava` PATCH `mVendT2` → 403 (visível, não é gestora), intacto; `{"papel":"dona"}` → 400; `{"equipe_id":"…"}` → 400 `corpo_invalido`. `vendT1` DELETE `mGestorT1` → 403, fica; `gestorT1` DELETE `mVendT2` → 404, fica; `gestorT1` DELETE `mVendT1` → 204, some; `super` DELETE `mVendT2` → 204.
- Liberações: `vendT1` GET → `epVendT1`, sem `epVendT2`; `supervT1` POST `{equipe_id:T1, profile_id:gestorT1, chave:"estoque"}` → 201 com `concedido_por` = supervT1; `supervG1` POST `{equipe_id:T3, profile_id:vendT2, chave:"estoque"}` → 201 (supervisora pelo grupo); `vendT1` POST em T1 → 403 e `supervT1` POST em T2 → 403, contagem igual; `chave:"vendas"` → 400; `concedido_por` no corpo → 400. `supervT1` DELETE `epVendT2` → 404, fica; `semTrava` DELETE `epVendT2` → 403, fica; `supervT1` DELETE `epVendT1` → 204; `superFicha` DELETE `epVendT2` → 204.
- Mutações que têm de reprovar: `RotaEditar[corpoMembroNovo]` no PATCH de membro (trocar de time passaria); `Tabela{Nome: "equipes"}` no lugar de `equipes_membros` no DELETE de membro; tirar `soSessaoPropria` de uma escrita (pega na Task 11).

**(c) Arquivos:** Create `api/internal/acesso/times.go`, `api/internal/acesso/times_test.go`.

**(d) Dependências:** Tasks 2 e 3.

- [ ] **Step 1:** Escrever `times_test.go` com os casos acima; `go test -count=1 -run TimesMembros ./internal/acesso/` → FAIL (`montarTimes`).
- [ ] **Step 2:** Implementar `times.go` (declarações acima + `montarTimes`).
- [ ] **Step 3:** `gofmt -l ./internal && go vet ./internal/acesso/ && go test -count=1 -v -run TimesMembros ./internal/acesso/` → PASS; aplicar as mutações e ver reprovar.
- [ ] **Step 4:** Commit `feat(api): /equipes/times, /equipes/membros e /equipes/permissoes com o escopo por equipe de produção` (+ `Co-Authored-By`).

---

### Task 6: Grupos de canal e supervisoras

**Revisor:** opus. **Depende de:** 2, 3.

**(a) Contrato**

```go
const colunasGrupo = `t.id, t.nome, t.ordem, t.ativo, t.criado_em`

// GET /equipes/grupos (canais_grupos_leitura: true). POST, PATCH e DELETE /equipes/grupos/{id}
// (canais_grupos_escrever: superadmin_pela_ficha). Renomear leva o nome a bling_lojas.grupo (gatilho
// espelhar_rename_do_grupo); nome repetido (lower/btrim) = 409.
var consultaGrupos = dados.Consulta{Tabela: "canais_grupos", Alias: "t", SQL: `select ` + colunasGrupo + ` from canais_grupos t`,
	Ordens: map[string]string{"nome": "t.nome"}, OrdemPadrao: "t.nome", Desempate: "t.id"}
type corpoGrupo struct {
	Nome json.RawMessage `json:"nome,omitempty"`
}
var tabelaGrupos = dados.Tabela{Nome: "canais_grupos", Resposta: colunasGrupo}

const colunasSupervisora = `t.id, t.grupo_id, t.profile_id, t.papel, t.concedido_por, t.concedido_em`

// GET /equipes/grupos-membros (cgm_leitura: a própria OU pode_ver_grupo(grupo_id)); POST e
// DELETE /equipes/grupos-membros/{id} (cgm_escrever: superadmin_pela_ficha). concedido_por = sessão (Ruling 5.1-9).
var consultaSupervisoras = dados.Consulta{Tabela: "canais_grupos_membros", Alias: "t", SQL: `select ` + colunasSupervisora + ` from canais_grupos_membros t`,
	Filtros: []dados.Filtro{
		{Param: "grupo_id", SQL: "t.grupo_id = @grupo_id::uuid", Tipo: "uuid"},
		{Param: "profile_id", SQL: "t.profile_id = @profile_id::uuid", Tipo: "uuid"},
	},
	Ordens: map[string]string{"concedido_em": "t.concedido_em"}, OrdemPadrao: "t.concedido_em", Desempate: "t.id"}
type corpoSupervisora struct {
	GrupoID   json.RawMessage `json:"grupo_id,omitempty"`
	ProfileID json.RawMessage `json:"profile_id,omitempty"`
	Papel     json.RawMessage `json:"papel,omitempty"`
}
var tabelaSupervisoras = dados.Tabela{Nome: "canais_grupos_membros", Resposta: colunasSupervisora, Autor: "concedido_por"}

func montarGrupos(r chi.Router, p *pgxpool.Pool) // as 7 rotas; deve(…Validar); soSessaoPropria nas escritas
```

Os `PATCH bling_lojas` da mesma seção da tela (`tela-de-admin.vue:1072`, `:1194`: `fechado_em`, `grupo_id`) são do 5.5 (dono de `bling_lojas`).

**(b) Testes de aceitação** (`TestGruposESupervisoras`)
- Grupos: `vendT1` GET → G1 e G2. `super` POST `{"nome":"Online"}` → 201; `superFicha` POST `{"nome":"Feira"}` → 201 (a ficha basta); `admin` POST → 403, contagem igual; `super` POST `{"nome":" varejo "}` → 409 (rode ANTES de renomear o G1). `super` PATCH G1 `{"nome":"Varejo Físico"}` → 200 e `bling_lojas.grupo` da loja 3 = `Varejo Físico`; `admin` PATCH G1 → 403, intacto; `super` DELETE G2 → 204; `admin` DELETE G1 → 403, fica.
- Supervisoras (IDOR): `vendT1` GET → `[]` (sem linha própria, `pode_ver_grupo` falso com a trava); `supervG1` GET → `cgmSupervG1`; `semTrava` GET → todas. `super` POST `{grupo_id:G2, profile_id:vendT1}` → 201 com `concedido_por` = super e `papel` = supervisora; `admin` POST → 403, contagem igual; `papel:"gestora"` → 400; `concedido_por` no corpo → 400. `vendT1` DELETE `cgmSupervG1` → 404, fica; `semTrava` DELETE → 403, fica; `super` DELETE → 204.
- Mutação que tem de reprovar: `Autor: ""` em `tabelaSupervisoras` (`concedido_por` sai nulo).

**(c) Arquivos:** Create `api/internal/acesso/grupos.go`, `api/internal/acesso/grupos_test.go`.

**(d) Dependências:** Tasks 2 e 3.

- [ ] **Step 1:** `grupos_test.go` com os casos; ver falhar (`montarGrupos`).
- [ ] **Step 2:** Implementar `grupos.go`.
- [ ] **Step 3:** gofmt/vet/test PASS; mutação reprova.
- [ ] **Step 4:** Commit `feat(api): /equipes/grupos e /equipes/grupos-membros (só super-admin pela ficha escreve)` (+ `Co-Authored-By`).

---

### Task 7: Perfis de acesso

**Revisor:** opus. **Depende de:** 2, 3.

**(a) Contrato**

```go
const colunasPerfil = `t.id, t.nome, t.permissions, t.criado_em, t.criado_por`

// GET /acesso/perfis (acessos_perfis_ler: true); filtro nome (igualdade exata: a tela procura o perfil
// pelo nome único antes de regravar).
var consultaPerfis = dados.Consulta{Tabela: "acessos_perfis", Alias: "t", SQL: `select ` + colunasPerfil + ` from acessos_perfis t`,
	Filtros: []dados.Filtro{{Param: "nome", SQL: "t.nome = @nome::text", Tipo: "texto"}},
	Ordens:  map[string]string{"nome": "t.nome"}, OrdemPadrao: "t.nome", Desempate: "t.id"}

// POST /acesso/perfis {nome, permissions} e PATCH /acesso/perfis/{id} {permissions}. Regra
// acessos_perfis_escrever: is_superadmin() — a LISTA DE E-MAILS, não a ficha. Nome repetido = 409 (a
// tela usa o 409 para oferecer a regravação). criado_por = sessão (Ruling 5.1-9).
type corpoPerfilNovo struct {
	Nome        json.RawMessage `json:"nome,omitempty"`
	Permissions json.RawMessage `json:"permissions,omitempty"`
}
type corpoPerfilEdicao struct {
	Permissions json.RawMessage `json:"permissions,omitempty"`
}
// Validar (os dois): permissions, se veio, é objeto (mesma checagem de corpoUsuario).
var tabelaPerfis = dados.Tabela{Nome: "acessos_perfis", Resposta: colunasPerfil, Autor: "criado_por"}

func montarPerfis(r chi.Router, p *pgxpool.Pool) // GET /acesso/perfis; POST /acesso/perfis; PATCH /acesso/perfis/{id}
```

**(b) Testes de aceitação** (`TestPerfisDeAcesso`)
- `vendT1` GET → o perfil Vendedora; `?nome=Vendedora` → ele; `?nome=x` → `[]`.
- `super` (e-mail da lista) POST `{"nome":"Estoquista","permissions":{"estoque":["ver"]}}` → 201 com `criado_por` = super; **`superFicha` (ficha sem o e-mail) POST → 403** e `admin` POST → 403, contagem igual; `super` POST `{"nome":"Vendedora",…}` → 409; `permissions: []` → 400; `criado_por` no corpo → 400.
- `super` PATCH Vendedora `{"permissions":{"frota":["ver","editar"]}}` → 200; `superFicha` PATCH → 403, intacto; `{"nome":"y"}` → 400 `corpo_invalido`; `impersonado` PATCH → 403.
- Mutação que tem de reprovar: o catálogo compilar `is_superadmin()` como a ficha (o caso `superFicha` passa a 201) — conferir que `autz` usa `SuperEmail` aqui.

**(c) Arquivos:** Create `api/internal/acesso/perfis.go`, `api/internal/acesso/perfis_test.go`.

**(d) Dependências:** Tasks 2 e 3.

- [ ] **Step 1:** Teste; ver falhar. - [ ] **Step 2:** Implementar. - [ ] **Step 3:** gofmt/vet/test PASS. - [ ] **Step 4:** Commit `feat(api): /acesso/perfis — perfis de acesso (escreve só super-admin da lista de e-mails)` (+ `Co-Authored-By`).

---

### Task 8: Pedidos de acesso (público e admin)

**Revisor:** opus. **Depende de:** 2, 3.

**(a) Contrato**
- `POST /pedir-acesso` — **público**, fora do grupo autenticado, `auth.LimitarPorIP(10, time.Hour)` (Ruling 5.1-8). Corpo `{name, email, message}` (campo a mais, inclusive `status` = 400 `corpo_invalido`); nome 1–120 caracteres, e-mail válido (`net/mail`, até 254), mensagem até 2000; grava `status = 'pending'` fixo → `201 {"id": …}`. Nome/e-mail vazios → 400 com a frase da tela ("Nome e email são obrigatórios."). Nenhum nome/e-mail em log.
- `GET /acesso/pedidos` → `id, name, email, message, status, created_at`, padrão `created_at desc`. Regra `admin_read_requests` (perfil com `role = 'admin'`, ativo).
- `PATCH /acesso/pedidos/{id}` `{status}` com `status` ∈ `pending|approved|denied` → 200. Regra `admin_update_requests`.
- `MontarPublicas(r chi.Router, p *pgxpool.Pool)` (exportada: usada por `web.Rotas` e pelo teste).

```go
const (
	LimitePedirAcesso = 10
	JanelaPedirAcesso = time.Hour
)

// MontarPublicas: a ÚNICA rota pública do 5.1, montada FORA do grupo autenticado de web.Rotas.
func MontarPublicas(r chi.Router, p *pgxpool.Pool) {
	r.With(auth.LimitarPorIP(LimitePedirAcesso, JanelaPedirAcesso)).Post("/pedir-acesso", pedirAcesso(p))
}

// pedirAcesso: POST /pedir-acesso {name, email, message}, sem sessão (a tela de login). Grava só essas
// três colunas e status 'pending' — o insert anônimo de hoje aceitava qualquer coluna, inclusive status.
// Nome e e-mail são dado pessoal: nunca vão para log.
func pedirAcesso(p *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var in struct {
			Name    string `json:"name"`
			Email   string `json:"email"`
			Message string `json:"message"`
		}
		if !dados.LerCorpo(w, r, &in) {
			return
		}
		nome, email, msg := strings.TrimSpace(in.Name), strings.TrimSpace(in.Email), strings.TrimSpace(in.Message)
		if nome == "" || email == "" {
			dados.Erro(w, http.StatusBadRequest, "pedido_invalido", "Nome e email são obrigatórios.")
			return
		}
		if utf8.RuneCountInString(nome) > 120 || len(email) > 254 || utf8.RuneCountInString(msg) > 2000 || !emailPlausivel(email) {
			dados.Erro(w, http.StatusBadRequest, "pedido_invalido", "Confira o nome, o e-mail e o tamanho da mensagem.")
			return
		}
		var corpo []byte
		err := p.QueryRow(r.Context(), `with n as (insert into access_requests (name, email, message, status)
			values (@nome::text, @email::text, @msg::text, 'pending') returning id) select row_to_json(n) from n`,
			pgx.NamedArgs{"nome": nome, "email": email, "msg": msg}).Scan(&corpo)
		if err != nil {
			dados.ErroDoBanco(w, err)
			return
		}
		dados.Responder(w, http.StatusCreated, corpo)
	}
}

// emailPlausivel: um endereço só, sem nome de exibição, com domínio que tem ponto.
func emailPlausivel(s string) bool {
	a, err := mail.ParseAddress(s)
	return err == nil && a.Address == s && strings.Contains(s[strings.LastIndex(s, "@")+1:], ".")
}

const colunasPedido = `t.id, t.name, t.email, t.message, t.status, t.created_at`

var consultaPedidos = dados.Consulta{Tabela: "access_requests", Alias: "t", SQL: `select ` + colunasPedido + ` from access_requests t`,
	OrdemPadrao: "t.created_at desc", Desempate: "t.id"}

type corpoDecisao struct {
	Status json.RawMessage `json:"status,omitempty"`
}

func (c corpoDecisao) Validar() error {
	var s string
	if json.Unmarshal(c.Status, &s) != nil || !slices.Contains([]string{"pending", "approved", "denied"}, s) {
		return errors.New("status deve ser pending, approved ou denied")
	}
	return nil
}

var tabelaPedidos = dados.Tabela{Nome: "access_requests", Resposta: colunasPedido}

func montarPedidos(r chi.Router, p *pgxpool.Pool) // GET /acesso/pedidos; PATCH /acesso/pedidos/{id} (soSessaoPropria)
```

**(b) Testes de aceitação** (`TestPedirAcessoPublico`, `TestPedidosDoAdmin`)
- Público (router próprio com `MontarPublicas(r, m.p)`, sem sessão; `slog` desviado para um buffer durante o teste): `{"name":"Ana Teste","email":"ana@x.com","message":"oi"}` → 201 `{"id"`, linha com `status = 'pending'`; `{"name":"Ana Teste","email":"ana@x.com","status":"approved"}` → 400 `corpo_invalido`, contagem igual; nome vazio → 400 com "Nome e email são obrigatórios."; e-mail `não é e-mail` → 400; nome com 121 caracteres e mensagem com 2001 → 400; contagem igual em todos os recusados. Rajada: o limitador conta TODO pedido do IP, inclusive os recusados acima — complete 10 e o 11º → 429 com `Retry-After`; outro IP (`RemoteAddr = "198.51.100.7:1234"`) → 201. No fim, o buffer de log não contém `ana@x.com` nem `Ana Teste`.
- Admin: `admin` GET → `pedido1`; `viewer` GET → `[]`; `superFicha` GET → `[]` (paridade: a policy lê `role = 'admin'`, Ruling 5.1-3). `admin` PATCH `pedido1` `{"status":"approved"}` → 200; `viewer` PATCH → 404, status intacto; `{"status":"hacked"}` → 400; `{"name":"x"}` → 400; `impersonado` → 403.
- Mutações que têm de reprovar: tirar `'pending'` do insert e aceitar `Status` no corpo; tirar o `LimitarPorIP`.

**(c) Arquivos:** Create `api/internal/acesso/pedidos.go`, `api/internal/acesso/pedidos_test.go`.

**(d) Dependências:** Tasks 2 e 3; `auth.LimitarPorIP`.

- [ ] **Step 1:** Testes; ver falhar. - [ ] **Step 2:** Implementar. - [ ] **Step 3:** gofmt/vet/test PASS; mutações reprovam. - [ ] **Step 4:** Commit `feat(api): POST /pedir-acesso público com limite e /acesso/pedidos para o admin` (+ `Co-Authored-By`).

---

### Task 9: Avisos — preferências e inscrição de push

**Revisor:** opus. **Depende de:** 3.

**(a) Contrato**
- `GET /avisos/preferencias?user_id=` → `user_id, tipo, ativo, alterado_em, alterado_por`. Regra `push_pref_leitura`: a própria OU perfil com `role = 'admin'` ou super pela ficha (ativo). Sem `?ordem` (a chave é composta: só padrão `t.user_id` + desempate `t.tipo` é única).
- `POST /avisos/preferencias` `[{user_id, tipo, ativo}, …]` (1 a 20; par repetido = 400) → `204`. Upsert por `(user_id, tipo)`; cada linha passa no WITH CHECK de `push_pref_escrita` antes de gravar qualquer uma (tudo-ou-nada, Ruling 5.1-10); `alterado_em = now()`, `alterado_por` = sessão (campo no corpo = 400).
- `POST /eu/push/inscrever` `{endpoint, p256dh, auth}` → `200 {"id"}`. Upsert pelo `endpoint`, sempre no nome de quem está logado; endpoint que já é de outra pessoa → `403` sem mexer na linha (Ruling 5.1-11). `endpoint` `https://` até 2048; chaves não vazias até 256. SSRF: a defesa é do envio (`webpush.endpointAceito`, Plano 4).
- `POST /eu/push/desinscrever` `{endpoint}` → `204` sempre (apaga só a própria, pela regra do catálogo no `WHERE`).
- Todas as escritas com `soSessaoPropria`. Endpoint e chaves nunca em log.

```go
const colunasPreferencia = `t.user_id, t.tipo, t.ativo, t.alterado_em, t.alterado_por`

var consultaPreferencias = dados.Consulta{Tabela: "push_preferencias", Alias: "t",
	SQL:     `select ` + colunasPreferencia + ` from push_preferencias t`,
	Filtros: []dados.Filtro{{Param: "user_id", SQL: "t.user_id = @user_id::uuid", Tipo: "uuid"}},
	Ordens:  map[string]string{}, OrdemPadrao: "t.user_id", Desempate: "t.tipo"}

type preferencia struct {
	UserID string `json:"user_id"`
	Tipo   string `json:"tipo"`
	Ativo  *bool  `json:"ativo"`
}

func gravarPreferencias(p *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		e := autz.EscopoDo(r.Context())
		if e == nil {
			dados.Erro(w, http.StatusInternalServerError, "erro_interno", "")
			return
		}
		var linhas []preferencia
		if !dados.LerCorpo(w, r, &linhas) { // slice de struct: o decoder recusa campo desconhecido em cada item
			return
		}
		if len(linhas) == 0 || len(linhas) > 20 {
			dados.Erro(w, http.StatusBadRequest, "pedido_invalido", "Mande de 1 a 20 preferências.")
			return
		}
		vistas := map[string]bool{}
		for _, l := range linhas {
			k := strings.ToLower(l.UserID) + "|" + l.Tipo
			if l.Ativo == nil || vistas[k] {
				dados.Erro(w, http.StatusBadRequest, "pedido_invalido", "Cada preferência precisa de ativo e aparece uma vez só.")
				return
			}
			vistas[k] = true
		}
		j, err := json.Marshal(linhas)
		if err != nil {
			dados.Erro(w, http.StatusInternalServerError, "erro_interno", "")
			return
		}
		err = banco.ComUsuario(r.Context(), p, e.ID, func(tx pgx.Tx) error {
			for _, l := range linhas {
				// ponytail: PodeCriar basta enquanto a policy ler só user_id, que está na chave do conflito (Ruling 5.1-10)
				if err := autz.Producao.PodeCriar(r.Context(), tx, e, "push_preferencias",
					map[string]any{"user_id": l.UserID, "tipo": l.Tipo, "ativo": *l.Ativo}); err != nil {
					return err
				}
			}
			_, err := tx.Exec(r.Context(), `insert into push_preferencias (user_id, tipo, ativo, alterado_em, alterado_por)
				select x.user_id, x.tipo, x.ativo, now(), @eu::uuid
				  from jsonb_to_recordset(@linhas::jsonb) as x(user_id uuid, tipo text, ativo boolean)
				on conflict (user_id, tipo) do update
				  set ativo = excluded.ativo, alterado_em = excluded.alterado_em, alterado_por = excluded.alterado_por`,
				pgx.NamedArgs{"eu": e.ID, "linhas": string(j)})
			return err
		})
		if err != nil {
			dados.ErroDeEscrita(w, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

type inscricao struct {
	Endpoint string `json:"endpoint"`
	P256dh   string `json:"p256dh"`
	Auth     string `json:"auth"`
}

func inscrever(p *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		e := autz.EscopoDo(r.Context())
		if e == nil {
			dados.Erro(w, http.StatusInternalServerError, "erro_interno", "")
			return
		}
		var in inscricao
		if !dados.LerCorpo(w, r, &in) {
			return
		}
		u, err := url.Parse(in.Endpoint)
		if err != nil || u.Scheme != "https" || u.Host == "" || len(in.Endpoint) > 2048 ||
			in.P256dh == "" || in.Auth == "" || len(in.P256dh) > 256 || len(in.Auth) > 256 {
			dados.Erro(w, http.StatusBadRequest, "pedido_invalido", "Inscrição de push inválida.")
			return
		}
		var corpo []byte
		err = banco.ComUsuario(r.Context(), p, e.ID, func(tx pgx.Tx) error {
			if err := autz.Producao.PodeCriar(r.Context(), tx, e, "push_subs", map[string]any{"user_id": e.ID}); err != nil {
				return err
			}
			fl, err := autz.Producao.Filtro(e, "push_subs", autz.Ler, "push_subs")
			if err != nil {
				return err
			}
			fe, err := autz.Producao.Filtro(e, "push_subs", autz.Editar, "push_subs")
			if err != nil {
				return err
			}
			err = tx.QueryRow(r.Context(), `with n as (insert into push_subs (endpoint, p256dh, auth, user_id)
				values (@endpoint::text, @p256dh::text, @auth::text, @eu::uuid)
				on conflict (endpoint) do update set p256dh = excluded.p256dh, auth = excluded.auth
				  where (`+fl.SQL+`) and (`+fe.SQL+`)
				returning id) select row_to_json(n) from n`,
				fe.Juntar(fl.Juntar(pgx.NamedArgs{"endpoint": in.Endpoint, "p256dh": in.P256dh, "auth": in.Auth, "eu": e.ID}))).Scan(&corpo)
			if errors.Is(err, pgx.ErrNoRows) {
				return autz.ErrNegado // o endpoint é de outra pessoa: a linha dela fica como estava
			}
			return err
		})
		if err != nil {
			dados.ErroDeEscrita(w, err)
			return
		}
		dados.Responder(w, http.StatusOK, corpo)
	}
}

// desinscrever: POST /eu/push/desinscrever {endpoint}. Idempotente: apaga só a própria (regra de Ler
// e de Apagar do catálogo no WHERE) e responde 204 mesmo sem linha, como o delete de hoje.
func desinscrever(p *pgxpool.Pool) http.HandlerFunc

func montarAvisos(r chi.Router, p *pgxpool.Pool) // GET/POST /avisos/preferencias; POST /eu/push/inscrever e /eu/push/desinscrever
```

**(b) Testes de aceitação** (`TestPreferenciasDeAviso`, `TestInscricaoDePush`)
- Preferências: `viewer` GET `?user_id=`viewer → `vendas`; `viewer` GET `?user_id=`admin → `[]`; `admin` GET `?user_id=`viewer → `vendas`; `superFicha` GET `?user_id=`viewer → `vendas` (a ficha conta nesta policy). `viewer` POST `[{viewer,"saldo",true}]` → 204 com `alterado_por` = viewer; `admin` POST `[{viewer,"vendas",false}]` → 204, `alterado_por` = admin; **`viewer` POST `[{viewer,"frota",true},{admin,"vendas",true}]` → 403 e NADA gravado** (viewer sem `frota`; admin `vendas` ainda `false`); `tipo:"cafe"` → 400; `[]` → 400; 21 linhas → 400; par repetido → 400; `alterado_por` no item → 400; `impersonado` → 403.
- Push: `viewer` inscreve `https://push.exemplo/novo` → 200, linha com `user_id` = viewer; `viewer` reinscreve o próprio endpoint com chaves novas → 200 e chaves trocadas; **`viewer` inscreve `https://push.exemplo/admin` → 403 e a linha do admin intacta** (dono e chaves); `http://169.254.169.254/x` → 400; endpoint com 2049 caracteres → 400; `p256dh` vazio → 400; `user_id` no corpo → 400. `viewer` desinscreve o endpoint do admin → 204 e a linha do admin fica; desinscreve o próprio → 204 e some. `impersonado` inscreve → 403, contagem igual.
- Mutações que têm de reprovar: tirar o `where (…) and (…)` do `on conflict` (o 403 vira 200 e as chaves do admin mudam); no desinscrever, tirar a regra do `WHERE` (apaga a do admin); apagar o laço de `PodeCriar` (o lote misto passa a 204 e grava a preferência do admin).

**(c) Arquivos:** Create `api/internal/acesso/avisos.go`, `api/internal/acesso/avisos_test.go`.

**(d) Dependências:** Task 3; `autz.Producao.PodeCriar/Filtro`; `banco.ComUsuario`; `dados.LerCorpo/Erro/ErroDeEscrita/Responder` (Task 2).

- [ ] **Step 1:** Testes; ver falhar. - [ ] **Step 2:** Implementar. - [ ] **Step 3:** gofmt/vet/test PASS; mutações reprovam. - [ ] **Step 4:** Commit `feat(api): preferências de aviso e inscrição de push só no nome de quem está logado` (+ `Co-Authored-By`).

---

### Task 10: Saúde — conferências e execuções de IA (leitura)

**Revisor:** sonnet. **Depende de:** 3.

**(a) Contrato**

```go
const colunasConferencia = `t.id, t.checked_date, t.account_id, t.check_name, t.status, t.detail, t.created_at`

// GET /saude/conferencias (aba Saúde e a faixa do admin). Regras: dic_sel (true) E a restritiva
// so_contas_permitidas: pode_ver_conta(account_id::text) — conta fora de allowed_accounts nunca aparece.
var consultaConferencias = dados.Consulta{Tabela: "data_integrity_checks", Alias: "t",
	SQL: `select ` + colunasConferencia + ` from data_integrity_checks t`,
	Filtros: []dados.Filtro{
		{Param: "checked_date", SQL: "t.checked_date = @checked_date::date", Tipo: "data"},
		{Param: "status", SQL: "t.status = @status::text", Tipo: "texto"},
	},
	Ordens: map[string]string{"checked_date": "t.checked_date", "created_at": "t.created_at"},
	OrdemPadrao: "t.created_at desc", Desempate: "t.id"}

const colunasExecucao = `t.id, t.run_at, t.robo, t.acao, t.modelo, t.input_tokens, t.output_tokens, t.chamadas, ` +
	`t.usd, t.duracao_ms, t.itens, t.unidade, t.status, t.detalhe, t.github_run_id, t.created_at`

// GET /saude/ia-execucoes (a tela de status do Claude, sub-plano 5.12). Regra ia_exec_select: true.
var consultaExecucoes = dados.Consulta{Tabela: "ia_execucoes", Alias: "t",
	SQL:    `select ` + colunasExecucao + ` from ia_execucoes t`,
	Ordens: map[string]string{"run_at": "t.run_at"}, OrdemPadrao: "t.run_at desc", Desempate: "t.id"}

func montarSaude(r chi.Router, p *pgxpool.Pool) // os dois GET
```

**(b) Testes de aceitação** (`TestSaude`)
- `viewer` (só a conta A1) GET `/saude/conferencias` → linhas de A1 e a sem conta; **nunca** `conta A2`. `admin` → as 3; `semTrava` (`allowed_accounts` nulo) → as 3.
- `?checked_date=2026-10-11&status=fail` → só as falhas visíveis; `?ordem=checked_date.desc&limite=1` → 1 linha; `?checked_date=11/10/2026` → 400.
- `vendT1` GET `/saude/ia-execucoes?ordem=run_at.desc&limite=200` → `nova` antes de `antiga`; `usd` sai número com as casas (`"usd":0.0000`, como o PostgREST).
- Mutação que tem de reprovar: `Tabela: "ia_execucoes"` na consulta das conferências (o `Validar` acusa a principal lida sem regra).

**(c) Arquivos:** Create `api/internal/acesso/saude.go`, `api/internal/acesso/saude_test.go`.

**(d) Dependências:** Task 3.

- [ ] **Step 1:** Teste; ver falhar. - [ ] **Step 2:** Implementar. - [ ] **Step 3:** gofmt/vet/test PASS. - [ ] **Step 4:** Commit `feat(api): /saude/conferencias (por conta) e /saude/ia-execucoes` (+ `Co-Authored-By`).

---

### Task 11: Montagem, `conferir`, notas e varredura do impersonado

**Revisor:** opus. **Depende de:** 4–10.

**(a) Contrato**
- `acesso.Montar(r chi.Router, p *pgxpool.Pool)` chama os 7 `montar*`; `web.Rotas` chama `acesso.Montar(r, p)` no grupo de domínio (depois de `r.Post("/rpc/{nome}", …)`) e `acesso.MontarPublicas(r, p)` junto das rotas públicas de senha do 5.0 (fora de `auth.Exigir`).
- `web/rotas_test.go`: `publicas` ganha `"POST /pedir-acesso": true`; `soSessao` ganha as 30 rotas do 5.1 (comentário: "portão = catálogo, provado pela matriz de cada rota em `internal/acesso`; escrita de impersonado recusada por `TestEscritasRecusamImpersonado`").
- `cmd/api/conferir.go`: o que as rotas presumem no banco restaurado (abaixo).
- `NOTAS-DA-IMPLANTACAO.md`: seção do 5.1.

**(b) Testes de aceitação**
- `TestEscritasRecusamImpersonado` (`acesso/rotas_test.go`, mundo com `Montar`): `chi.Walk` em todas as rotas não-GET → com a sessão `impersonado`, cada uma responde 403 com "Quem entrou como outra pessoa" (troca `{id}` por `mVendT1`); exatamente **19** escritas (rota de escrita nova sem `soSessaoPropria` ou fora da conta faz o teste falhar); `fotoDoMundo` igual antes e depois.
- `TestNenhumaRotaNovaFicaAberta` (existente) passa com as listas atualizadas: toda rota do 5.1 dá 401 sem sessão; `/pedir-acesso` está montada.
- `TestAcessoPelaMontagemReal` (`web/rotas_test.go`, `testebanco.ComEsquemaDeProducao` + `usuarios`/`profiles` de um admin e um viewer inseridos no teste): `GET /acesso/usuarios` sem sessão → 401; viewer `PATCH /acesso/usuarios/{admin}` `{"disabled":true}` → 403 e `disabled` intacto; viewer `GET /acesso/pedidos` → `200 []`; admin `GET /equipes/times` → 200; `POST /pedir-acesso` sem sessão → 201.

**(c) Arquivos:** Create `api/internal/acesso/rotas.go`, `api/internal/acesso/rotas_test.go`; Modify `api/internal/web/rotas.go`, `api/internal/web/rotas_test.go`, `api/cmd/api/conferir.go`, `docs/migracao-go/NOTAS-DA-IMPLANTACAO.md`.

**(d) Dependências:** Tasks 4–10; `web.Rotas` do 5.0.

- [ ] **Step 1: Testes que falham.** `acesso/rotas_test.go`:

```go
package acesso

import (
	"net/http"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
)

// Toda escrita do 5.1 recusa a sessão de "entrar como", sem tocar no banco (Ruling 5.1-4).
func TestEscritasRecusamImpersonado(t *testing.T) {
	m := novoMundo(t, Montar)
	antes := m.um(t, fotoDoMundo)
	n := 0
	err := chi.Walk(m.h.(chi.Routes), func(metodo, rota string, _ http.Handler, _ ...func(http.Handler) http.Handler) error {
		if metodo == http.MethodGet {
			return nil
		}
		n++
		st, corpo := m.pedir(t, "impersonado", metodo, strings.ReplaceAll(rota, "{id}", mVendT1), `{}`)
		if st != http.StatusForbidden || !strings.Contains(corpo, "Quem entrou como outra pessoa") {
			t.Errorf("%s %s como impersonado = %d %s", metodo, rota, st, corpo)
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if n != 19 {
		t.Errorf("escritas = %d, esperava 19 (rota de escrita nova? ponha soSessaoPropria e conte aqui)", n)
	}
	if depois := m.um(t, fotoDoMundo); depois != antes {
		t.Error("o impersonado mudou o banco")
	}
}
```

Em `web/rotas_test.go`: acrescente `"POST /pedir-acesso": true,` em `publicas`; acrescente em `soSessao` as 30 entradas (`"GET /acesso/usuarios"`, `"PATCH /acesso/usuarios/{id}"`, `"GET /acesso/perfis"`, `"POST /acesso/perfis"`, `"PATCH /acesso/perfis/{id}"`, `"GET /acesso/pedidos"`, `"PATCH /acesso/pedidos/{id}"`, `"GET /equipes/times"`, `"POST /equipes/times"`, `"PATCH /equipes/times/{id}"`, `"GET /equipes/membros"`, `"POST /equipes/membros"`, `"PATCH /equipes/membros/{id}"`, `"DELETE /equipes/membros/{id}"`, `"GET /equipes/permissoes"`, `"POST /equipes/permissoes"`, `"DELETE /equipes/permissoes/{id}"`, `"GET /equipes/grupos"`, `"POST /equipes/grupos"`, `"PATCH /equipes/grupos/{id}"`, `"DELETE /equipes/grupos/{id}"`, `"GET /equipes/grupos-membros"`, `"POST /equipes/grupos-membros"`, `"DELETE /equipes/grupos-membros/{id}"`, `"GET /avisos/preferencias"`, `"POST /avisos/preferencias"`, `"POST /eu/push/inscrever"`, `"POST /eu/push/desinscrever"`, `"GET /saude/conferencias"`, `"GET /saude/ia-execucoes"`) com o comentário do contrato; e `TestAcessoPelaMontagemReal` com os casos de (b). Run: `go test -count=1 ./internal/acesso/ ./internal/web/` → FAIL (`Montar` não existe; `/pedir-acesso` não montada).

- [ ] **Step 2: Implementar.** `acesso/rotas.go`:

```go
package acesso

import (
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Montar registra as rotas do 5.1 no grupo de DOMÍNIO de web.Rotas (depois de auth.Exigir e de
// autz.ComEscopo). Declaração errada derruba a subida (deve).
func Montar(r chi.Router, p *pgxpool.Pool) {
	montarUsuarios(r, p)
	montarPerfis(r, p)
	montarPedidos(r, p)
	montarTimes(r, p)
	montarGrupos(r, p)
	montarAvisos(r, p)
	montarSaude(r, p)
}
```

Em `web/rotas.go`: import `"github.com/rbv-co/social-dashboard/api/internal/acesso"`; logo depois de `r.Post("/auth/definir-senha", conta.DefinirSenha)`, acrescente `acesso.MontarPublicas(r, p) // Plano 5.1: POST /pedir-acesso, público com limite por IP`; no grupo de domínio, depois de `r.Post("/rpc/{nome}", rpcs.ServeHTTP)`, acrescente `acesso.Montar(r, p) // Plano 5.1`.

Em `cmd/api/conferir.go` (troque as linhas existentes da mesma tabela pela versão abaixo; acrescente as novas):

```go
// colunasDoWorker
"profiles":              "id,email,name,role,is_superadmin,disabled,features,permissions,escopo_por_equipe,allowed_accounts,avatar_url,precisa_trocar_senha,perfil_id,permissions_excecao,created_at",
"equipes":               "id,nome,tipo,ativo,canal_loja_id,local_id,setor_id,empresa_id,deposito_id,ordem,criado_em,atualizado_em",
"equipes_membros":       "id,equipe_id,profile_id,papel,criado_em,criado_por",
"equipes_permissoes":    "id,equipe_id,profile_id,chave,concedido_por,criado_em",
"canais_grupos":         "id,nome,ordem,ativo,criado_em",
"canais_grupos_membros": "id,grupo_id,profile_id,papel,concedido_por,concedido_em",
"acessos_perfis":        "id,nome,permissions,criado_em,criado_por",
"access_requests":       "id,name,email,message,status,created_at",
"audit_log":             "actor_id,actor_email,action,detail",
"push_subs":             "id,endpoint,p256dh,auth,user_id,created_at",
"push_preferencias":     "user_id,tipo,ativo,alterado_em,alterado_por",
"data_integrity_checks": "id,checked_date,account_id,check_name,status,detail,created_at",
"ia_execucoes":          "id,run_at,robo,acao,modelo,input_tokens,output_tokens,chamadas,usd,duracao_ms,itens,unidade,status,detalhe,github_run_id,created_at",

// tiposDoWorker (os filtros e o upsert fazem ::uuid nestas colunas)
"profiles.perfil_id": "uuid", "profiles.permissions_excecao": "jsonb", "acessos_perfis.permissions": "jsonb",
"equipes_membros.equipe_id": "uuid", "equipes_membros.profile_id": "uuid",
"equipes_permissoes.equipe_id": "uuid", "equipes_permissoes.profile_id": "uuid",
"canais_grupos_membros.grupo_id": "uuid", "canais_grupos_membros.profile_id": "uuid",
"push_subs.user_id": "uuid", "push_preferencias.user_id": "uuid",

// unicosDoWorker (alvos de ON CONFLICT)
"push_subs(endpoint)", "push_preferencias(user_id,tipo)",

// funcoesDoWorker (os gatilhos que as escritas do 5.1 presumem)
"guard_profiles()", "impedir_autopromocao()", "espelhar_rename_do_grupo()", "equipes_toca_atualizado()",
```

Em `NOTAS-DA-IMPLANTACAO.md`, acrescente ao fim:

```markdown
## Plano 5.1 — admin, equipes e acesso

### Rotas novas
- Pública: `POST /api/pedir-acesso` (10 por IP por hora; só `name`, `email`, `message`; `status` sempre `pending`).
- Com sessão (regra = catálogo de produção; escrita de sessão "entrar como" = 403): `/acesso/usuarios`, `/acesso/perfis`, `/acesso/pedidos`, `/equipes/times`, `/equipes/membros`, `/equipes/permissoes`, `/equipes/grupos`, `/equipes/grupos-membros`, `/avisos/preferencias`, `/eu/push/inscrever`, `/eu/push/desinscrever`, `/saude/conferencias`, `/saude/ia-execucoes`.

### Mudanças de contrato que o Plano 7 absorve
- Escrita negada responde 403/404 (o PostgREST respondia 2xx com zero linhas); a linha devolvida é a da leitura, ou `{"id"}` quando quem gravou não a lê.
- `criado_por`, `alterado_por` e `concedido_por` saem do corpo (a sessão preenche; mandar = 400).
- Liberação de estoque é apagada por id (`DELETE /equipes/permissoes/{id}`): `tela-de-admin.vue:1230` passa a ler o `id`.
- Preferências de aviso vão em lote (`POST /avisos/preferencias`, array); push por `inscrever`/`desinscrever`.
- `permissions`/`permissions_excecao` têm de ser objeto JSON.

### Achados para o dono (paridade mantida; decisão de produto)
- Um admin que não é super-admin pode marcar `is_superadmin` de OUTRA conta (escalada para super pela ficha). Correção de uma linha, se o dono quiser: portão `SuperEmail` quando `is_superadmin` muda.
- A tela de Admin só abre para super-admin, mas editar perfis e ler pedidos de acesso exigem `role = 'admin'`: super-admin com papel viewer vê a tela e não grava.

### Antes do corte
- `api worker conferir` no banco restaurado confere colunas, tipos, únicos e os 4 gatilhos que o 5.1 presume.
- A fatia `api/internal/testebanco/esquema/` é reconstruída (D0 sem dump): quando o ensaio rodar, troque `01-tabelas-*.sql` pelo `pg_dump --schema-only` limpo e rode os testes.
```

Rode `gofmt -w ./internal ./cmd` (alinhamento dos mapas).

- [ ] **Step 3: Rodar e ver passar.** `gofmt -l . && go vet ./... && go test -count=1 -race ./... 2>&1 | grep -v goose | grep -E '^(ok|FAIL|---)'` → todos `ok`. Mutações que têm de reprovar: tirar `soSessaoPropria` de UMA escrita qualquer (varredura acusa); mover `acesso.MontarPublicas` para dentro do grupo autenticado (`/pedir-acesso` responde 401).
- [ ] **Step 4: Commit.**

```bash
git add api/internal/acesso/rotas.go api/internal/acesso/rotas_test.go api/internal/web/ api/cmd/api/conferir.go docs/migracao-go/NOTAS-DA-IMPLANTACAO.md
git commit -m "feat(api): monta as rotas do 5.1 (pedir-acesso público), conferir do esquema e notas

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Verificação final do 5.1

- [ ] `docker stop pg-plano51` e `make -C api teste PG_PORTA=58536` → todos `ok`.
- [ ] Subir o `pg-plano51` de novo e `cd api && go test -count=1 -v ./... 2>&1 | grep -c -- '--- SKIP'` → `0`.
- [ ] `cd api && gofmt -l . && go vet ./...` → nada.
- [ ] `git diff feat/api-go-dominios --stat -- src/ supabase/ coletor/` → vazio (o front troca no Plano 7).
- [ ] `docker stop pg-plano51`.
- [ ] Revisão final do branch por opus com foco em: `dados/escrita.go` (algum caminho grava sem `PodeX` ou fora de `ComUsuario`? alguma coluna vem do pedido?), o `on conflict … where` do push, o lote de preferências, a rota pública, e se a fatia D0 diverge de produção em algo que uma regra lê.

---

## Inventário: sítios do front a trocar (Plano 7)

`grep` em `src/` (fora de `*.test.*` e `src/demonstracao/`) em 2026-10-12: **70 literais** nas tabelas do 5.1 (`profiles` 24, `equipes_membros` 12, `equipes` 7, `equipes_permissoes` 5, `canais_grupos_membros` 5, `data_integrity_checks` 4, `acessos_perfis` 4, `access_requests` 3, `push_subs` 2, `push_preferencias` 2, `ia_execucoes` 1, `canais_grupos` 1) **+ 4 por variável** (`gravar('canais_grupos…')` ×3, `adFetch(alvo)` ×1) **− 1 do 5.0** (`controle-de-login-e-usuario.js:92` → `GET /eu/perfil`) = **73 sítios**. `user_permissions`, `audit_log`, `entradas_como_outro_usuario`, `platform_settings`, `robos_esperados`, `robos_execucoes`, `coletor_log`, `projetos_status` e `gestor_log`: **zero** sítios (Ruling 5.1-5).

Abreviações: `admin` = `src/ferramentas/admin/tela-de-admin.vue`; `frota` = `src/ferramentas/frota/tela-de-frota.vue`; `tv` = `src/ferramentas/gestao-comercial/time-de-vendas.vue`; `gav` = `src/ferramentas/gestao-a-vista/tela-de-gestao-a-vista.vue`; `av` = `src/ferramentas/analise-vendas/tela-de-analise-vendas.vue`; `redes` = `src/ferramentas/redes-sociais/tela-de-redes-sociais.vue`.

| Rota | Sítios | Qtde |
|---|---|---|
| `GET /acesso/usuarios` | admin:743, 1234, 2419, 3665, 3860, 3929; frota:788, 1079; tv:147; `src/ferramentas/conteudo/dados-conteudo.js:248`; redes:3735 | 11 |
| `PATCH /acesso/usuarios/{id}` | admin:449, 748, 767, 2346, 2542, 2794, 3431, 3512, 3942; frota:802, 819; redes:3751 | 12 |
| `GET /acesso/perfis` | admin:2401, 3698 | 2 |
| `POST /acesso/perfis` | admin:2277 | 1 |
| `PATCH /acesso/perfis/{id}` | admin:2492 | 1 |
| `POST /pedir-acesso` | `src/ferramentas/login/tela-de-login.vue:227` | 1 |
| `GET /acesso/pedidos` / `PATCH /acesso/pedidos/{id}` | admin:4271 / admin:4309 | 2 |
| `GET /equipes/times` | admin:882, 1227; gav:690; av:403; tv:145 | 5 |
| `POST` / `PATCH /equipes/times` | admin:1729 / admin:1728 | 2 |
| `GET /equipes/membros` | admin:1228; gav:692; av:405; tv:146; `src/ferramentas/gestao-comercial/tela-de-gestao-comercial.vue:62` | 5 |
| `POST /equipes/membros` | admin:753, 1539; tv:178 | 3 |
| `PATCH` / `DELETE /equipes/membros/{id}` | admin:1452, tv:164 / admin:1506, tv:170 | 4 |
| `GET /equipes/permissoes` | admin:1230; tv:148 | 2 |
| `POST` / `DELETE /equipes/permissoes` | admin:1487, tv:187 / admin:1488 (alvo em :1485-1486), tv:191 | 4 |
| `GET /equipes/grupos` | admin:883 | 1 |
| `POST` / `PATCH` / `DELETE /equipes/grupos` | admin:1100 / admin:1143 / admin:1171 (via `gravar`, :1034) | 3 |
| `GET /equipes/grupos-membros` | admin:1233; gav:697; av:409 | 3 |
| `POST` / `DELETE /equipes/grupos-membros` | admin:1648 / admin:1679 | 2 |
| `GET` / `POST /avisos/preferencias` | admin:1908 / admin:2819 | 2 |
| `POST /eu/push/inscrever` / `desinscrever` | `src/compartilhado/notificacoes-push.js:129` / `:166` | 2 |
| `GET /saude/conferencias` | admin:494, 498, 1772, 1775 | 4 |
| `GET /saude/ia-execucoes` | `src/ferramentas/claude-status/tela-de-status-claude.vue:703` | 1 |

Nas mesmas telas, de OUTROS planos (não trocar pelo 5.1): 5.0 — `invite-user` (admin:724, 3110, 3527, 3869), `entrar-como-usuario` (admin:3412), `controle-de-login-e-usuario.js:92`; 5.2 — admin:3720; 5.4 — admin:3166, 3190, 3212, 3672, 3721, 3722; 5.5 — admin:559, 560, 881, 1072, 1194, 1229, 4107–4111, 4229–4241; 5.6 — admin:1776–1778, 1915, 3968, 4004, 4019–4033; Plano 6 — admin:446, 448 (Storage `avatars`); Ruling 30 do mestre — admin:1761.

## Paralelização

- **Uma worktree por tarefa paralela** (merge na ordem dos números). Na mesma worktree, só em sequência: as Tasks 3–11 são o MESMO pacote Go (`acesso`), e um arquivo pela metade de uma quebra a compilação da outra; `dados` testa importando `testebanco`.
- **Onda 1:** Tasks 1 e 2 (pacotes e arquivos distintos; sem dependência entre si).
- **Onda 2:** Task 3 (precisa da 1).
- **Onda 3:** Tasks 4, 5, 6, 7 e 8 (precisam de 2 e 3), 9 e 10 (precisam só da 3) — sete em paralelo, cada uma só nos seus dois arquivos.
- **Onda 4:** Task 11 (precisa de todas; é a única que toca `web/`, `conferir.go` e as notas).

## Rulings do 5.1

1. Ruling: D0 do 5.1 é a fatia RECONSTRUÍDA (tabelas escritas das migrations e de `12-colunas.csv`, funções e gatilhos gerados verbatim de `02-funções.csv`/`03-triggers.csv`), num banco novo por teste, carregada por `testebanco.ComEsquemaDeProducao` — o `pg_dump` do ensaio (Ruling 29 do mestre) exige ler produção com credencial, que este plano não usa; com os gatilhos verbatim os testes provam o que importa (quem pode mudar cargo, o próprio acesso, o rastro) e o dump substitui as tabelas depois pelo mesmo carregador — custo se errada: default ou constraint diferente de produção só aparece no `api worker conferir` do banco restaurado.
2. Ruling: a escrita de domínio é um caminho declarado em `dados` (`Tabela` + `RotaCriar/RotaEditar/RotaApagar`; colunas das tags da struct, ausente ≠ `null`, `jsonb_populate_record` faz o cast pelo tipo da coluna, resposta pela lista da leitura) — o 5.1 tem 19 escritas e os sub-planos ~160 sítios; repetir o SQL à mão é onde se esquece o `PodeX` ou o `ComUsuario` — custo se errada: um defeito no helper vale para toda escrita (por isso opus e as quatro mutações da Task 2).
3. Ruling: `profiles` mantém a regra de produção: qualquer admin ativo edita qualquer perfil (inclusive `is_superadmin`, `disabled`, `permissions` de outra conta); só os gatilhos barram cargo, o perfil do `erick@` e o próprio acesso; super pela ficha com papel viewer não edita perfis nem lê pedidos de acesso — "mesmas permissões de hoje" (como o Ruling 21 do mestre); os dois achados vão para o dono nas NOTAS, com a correção de uma linha pronta — custo se errada: a escalada de um admin para super pela ficha continua possível, como hoje.
4. Ruling: sessão de "entrar como" só LÊ no 5.1: as 19 escritas respondem 403 — o `audit_log.actor_id` (= `auth.uid()` = o alvo) atribuiria ao alvo a mudança de acesso feita pelo super-admin, e inscrever push deixaria o aparelho dele recebendo os avisos do alvo depois de sair; estende o Ruling 18 do mestre — custo se errada: o super-admin sai da sessão impersonada para administrar.
5. Ruling: tabelas sem leitor no front não ganham rota (`user_permissions`, `audit_log`, `entradas_como_outro_usuario`, `platform_settings`, `robos_esperados`, `robos_execucoes`, `coletor_log`, `projetos_status`, `gestor_log`) — zero sítios em `src/` em 2026-10-12 (o `audit_log` "só é escrito" desde 13/08, `supabase/migrations/20260813_rastro_de_mudanca_de_acesso.sql:27-28`); quem as escreve é gatilho, edge portada, worker ou robô (Planos 3, 4 e 7); `robos_*` chegam à tela pela visão `robos_saude` (5.12); `autz` nega o que não tem rota — custo se errada: uma tela nova que queira a trilha ganha uma `Consulta` de ~10 linhas.
6. Ruling: um recurso por tabela com a UNIÃO das colunas e dos filtros que as telas usam (ex.: `GET /acesso/usuarios` atende 11 leituras de 6 telas), não uma rota por tela — a regra é a mesma para todas (catálogo) e cada rota a mais é superfície a mais — custo se errada: a tela recebe colunas que não usa (as mesmas que o PostgREST já entregava a ela).
7. Ruling: o filtro `email` de usuários é igualdade sem caixa (`lower(email) = lower(@email)`) — os dois jeitos de hoje (`eq.` e `ilike` com curinga escapado) procuram "este e-mail", e e-mail não tem caixa — custo se errada: duas contas que diferem só na caixa casam juntas (a tela de convite já trata mais de uma com `contar=1`).
8. Ruling: `POST /pedir-acesso` é público (Ruling 36 do mestre) com 10 por IP por hora, só `name`/`email`/`message` com limites de tamanho e e-mail válido, `status = 'pending'` fixo — o insert anônimo de hoje aceitava qualquer coluna (inclusive `status`), e rota pública sem limite vira lixo na tela do admin (spec §5: limite e validação em toda rota pública) — custo se errada: um escritório atrás de um IP só pede 10 por hora; spam vindo de muitos IPs não é contido (`ponytail`: teto global quando aparecer).
9. Ruling: autoria vem da sessão — `criado_por` (perfis de acesso), `concedido_por` (supervisoras, antes nulo) e `alterado_por` (preferências) são preenchidos pelo servidor e recusados no corpo; `criado_por`/`concedido_por` com `default auth.uid()` chegam pela identidade da transação — pela API, autoria vinda do corpo seria falsificável por qualquer um — custo se errada: o Plano 7 tira esses campos dos corpos (mandar = 400).
10. Ruling: o lote de preferências de aviso confere cada linha com `PodeCriar` (WITH CHECK) antes de gravar qualquer uma; uma negada = 403 e nada gravado — a policy lê só `user_id`, que está na chave do conflito: a linha antiga tem o mesmo `user_id` da nova, então USING (antiga) e CHECK (nova) são o mesmo predicado — custo se errada: se a policy passar a ler outra coluna, a equivalência quebra (o oráculo do 5.0 acusa a forma nova; reveja este Ruling).
11. Ruling: inscrição de push no endpoint de OUTRA pessoa = 403 sem mexer na linha (paridade: hoje o `upsert` caía na RLS de update); desinscrever é idempotente (204 mesmo sem linha própria) com a regra do catálogo no `WHERE` — o front ignora o resultado do delete e a paridade que importa é "não apaga a dos outros" — custo se errada: aparelho compartilhado segue inscrito no nome de quem inscreveu primeiro, como hoje.
12. Ruling: a matriz de cada rota roda no pacote `acesso` com a MESMA cadeia do grupo de domínio de produção (`auth.Exigir` → `autz.ComEscopo`), e a montagem real é provada em `web` (401 sem sessão, rota pública montada, um IDOR pela montagem) e pela varredura do impersonado sobre `Montar` — os sete arquivos de rota rodam em paralelo sem tocar `web/rotas.go`, e o teste interno do pacote não pode importar `web` (ciclo) — custo se errada: a cadeia do teste pode divergir da montagem; os testes da Task 11 são a rede.
13. Ruling: `permissions` e `permissions_excecao` têm de ser objeto JSON nas escritas de usuário e de perfil de acesso (400 senão); o resto do tipo é o do banco — array ou escalar em `permissions` muda o que o `Escopo` lê (Review Focus 5 do mestre) e nenhuma tela grava outra forma — custo se errada: nenhum.
14. Ruling: liberação de estoque (`equipes_permissoes`) é apagada por id, não pela chave natural `(equipe_id, profile_id, chave)` — mantém o contrato uniforme (`DELETE /…/{id}` → 204, com 404/403 do `PodeApagar`) e a leitura já devolve o `id` — custo se errada: `tela-de-admin.vue:1230` passa a ler o `id` e `:1488` a usá-lo (Plano 7).

## Cobertura da spec e o que o 5.2+ assume

**As 21 tabelas da linha 5.1 (44 policies, 1 restritiva):**

| Tabela | Destino |
|---|---|
| `profiles` | Task 4 (`auth_read_profiles`, `admin_update_profiles` + `guard_profiles`, `impedir_autopromocao`) |
| `acessos_perfis` | Task 7 (`is_superadmin()` por e-mail) |
| `access_requests` | Task 8 (público + `admin_*_requests`) |
| `equipes`, `equipes_membros`, `equipes_permissoes` | Task 5 (+ `equipes_toca_atualizado`) |
| `canais_grupos`, `canais_grupos_membros` | Task 6 (+ `espelhar_rename_do_grupo`) |
| `push_subs`, `push_preferencias` | Task 9 |
| `data_integrity_checks` | Task 10 (com a restritiva `so_contas_permitidas`) |
| `ia_execucoes` | Task 10 (a tela é do 5.12) |
| `user_permissions`, `audit_log`, `entradas_como_outro_usuario`, `platform_settings`, `robos_esperados`, `robos_execucoes`, `coletor_log`, `projetos_status`, `gestor_log` | sem rota (Ruling 5.1-5); `audit_log` é escrito pelos gatilhos e conferido nos testes das Tasks 1 e 4 |

Spec §5 (autorização por catálogo, escopo de equipe/grupo/conta, IDOR, testes ator × operação × recurso) e §11 (rota pública curta com limite e validação; segredo e dado pessoal fora de log). Gatilhos da linha 5.1: `guard_profiles`, `impedir_autopromocao`, `equipes_toca_atualizado`, `espelhar_rename_do_grupo` (Task 1); `guard_user_permissions` fica no banco sem rota que o alcance. Os botões "coletar/auditar agora" da aba Saúde não são portados (Ruling 30 do mestre).

**O que o 5.2+ assume:**
- `testebanco.ComEsquemaDeProducao(t)`: cada sub-plano acrescenta `esquema/01-tabelas-5-NN.sql` (dois dígitos) (fonte citada por tabela, FKs de `auth.users` → `public.usuarios`) e roda `gerar-gatilhos.mjs` de novo (ele lê as tabelas de todos os `01-tabelas-*.sql`), conferindo nas migrations a orientação e o `WHEN` dos gatilhos novos.
- `dados.Tabela` + `RotaCriar/RotaEditar/RotaApagar` + `Campos` + `Responder` para toda escrita de tabela; handler próprio só quando o SQL foge do CRUD (upsert, lote), sempre com `PodeX` antes e em `ComUsuario`. Coluna com `default` que uma policy lê (ex.: `criado_por default auth.uid()` lido por `criado_por = auth.uid()`) vai no mapa via `Autor`: `autz.Conferir` não aplica default.
- `soSessaoPropria` é decisão do 5.1 (escrita de acesso de gente); cada sub-plano decide a sua.
- Rotas que os outros domínios reusam em vez de recriar: `GET /acesso/usuarios` (lista de pessoas para escolha: frota, conteúdo), `GET /equipes/times`, `/equipes/membros` e `/equipes/grupos-membros` (telas de vendas do 5.5), `GET /saude/ia-execucoes` (5.12). Os `PATCH bling_lojas` da seção de canais do admin são do 5.5.
- O mundo de teste (`mundo_test.go`) é interno ao pacote `acesso`; o segundo pacote que precisar dele o extrai para `testebanco` (não antes).
