# Sair do Supabase — Plano 5.12: Painéis pequenos (notícias, status da IA, fatura das contas de IA)
**Status:** planejado

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **Execute na worktree `.claude/worktrees/p5-512`** (branch `feat/api-go-plano-5-12`, empilhada sobre `feat/api-go-dominios` = Plano 5.0). Faça `git add` só dos caminhos de cada task. Formato enxuto: por task, contrato, testes de aceitação, arquivos e dependências; código completo só onde o risco pede (autorização, chave de API, dinheiro).

**Goal:** Tirar do navegador as leituras diretas das telas Notícias e Status da IA (`noticias_concorrentes`, `noticias_panorama`, `ia_execucoes`, visão `robos_saude`) e portar as edges `custo-anthropic` e `custo-openai` para a API em Go, com as mesmas permissões de hoje.

**Architecture:** As 4 leituras de tabela são `dados.Consulta` (regra de Ler do catálogo aplicada sozinha). A visão `robos_saude` está fora do catálogo (Ruling 27 do Plano 5): rota própria que exige a regra de Ler das DUAS tabelas de baixo e serve a visão como está. A fatura vira o pacote `internal/custo`: portão da edge (papel admin), um cliente HTTP com a política de nova tentativa das edges, sem seguir redirecionamento, com a chave admin vinda de variável de ambiente.

**Tech Stack:** Go 1.26 (`go.mod`), `chi`, `pgx` v5, `math/big` (o `toFixed` do JS), `net/http/httptest` (APIs de mentira), Postgres 17 em contêiner nos testes. Sem dependência nova.

**Spec:** `docs/superpowers/plans/2026-10-11-api-go-plano-5-dominios.md` (§II contrato, IV.1 regras comuns, IV.2 linha 5.12, Rulings 1–36) e `docs/superpowers/specs/2026-10-09-sair-do-supabase-design.md` (§5 autorização, §6 `segredos_de_cron`, §8 edges). Permissões: `docs/migracao-go/catalogo-policies-producao.json`.

## Global Constraints

- **Nada em produção:** sem `ssh`, sem credencial real, sem `push`. Chaves nos testes são textos inventados com 8+ caracteres.
- **Mesmas permissões de hoje:** tabela = regra do catálogo (via `dados.Consulta`/`autz.Filtro`, nunca à mão); `custo-*` = portão da edge (`profiles.role = 'admin'`). Divergência só por Ruling deste plano.
- **Negar por padrão:** sem escopo, tabela fora do catálogo, regra que não cabe = `[]`/403/500, nunca libera.
- **Testes matam mutações:** todo portão com caso positivo E negativo por papel; negado em `custo-*` = fornecedor chamado 0 vezes.
- **Chave admin de IA nunca em log, erro ou resposta;** chamadas ao fornecedor não seguem redirecionamento.
- **SQL:** todo parâmetro com cast explícito; texto do pedido só entra como valor de filtro declarado.
- **Gate real:** `make -C api teste PG_PORTA=58612` (o Makefile usa o contêiner fixo `pg-api-teste`: não rode ao mesmo tempo que outra worktree). Teste que pula não aprova: `--- SKIP` = 0.
- Commits terminam com `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Código, comentários e mensagens em português com acentuação. `go` em `api/`; `git` na raiz da worktree.

## Review Focus

1. **`claude.status` só em `permissions` (sem estar em `features`)** → a tela abre, mas a saúde vem `[]`: as policies leem `features` (Ruling 13 do Plano 5). Teste: pessoa `so-permissao` em `TestSaudeDosRobosPelaMontagemReal` (Task 2).
2. **Fornecedor que redireciona (3xx para outro host) ou devolve a chave no corpo do erro** → redirecionamento não seguido; chave ausente da resposta e do log, inclusive cortada pela metade. Testes: `TestNaoSegueRedirecionamento`, `TestChaveNuncaSaiNoErroNemNoLog` (Task 3).
3. **`has_more: true` para sempre** → para em 50 páginas, sem laço infinito. Teste: `TestPaginasParaEm50` (Task 3).
4. **`dias` fora do normal** (`0`, `-5`, `1000`, `7.5`, `null`, `"30"`, corpo vazio) → ajustado a 1..90 ou 400. Teste: `TestCorpoEJanela` (Task 3).
5. **Detalhamento quebrado com total bom** (5xx no `group_by`, número inválido no uso) → 200 com `porCategoria`/`porChave` `[]`. Testes: `TestAnthropicDetalheQuebradoNaoDerrubaOTotal` (Task 4), `TestOpenAIDetalheQuebradoNaoDerrubaOTotal` (Task 5).

---
## I. Inventário (o que trocar) e premissas

### I.1 Sítios do front (grep, 2026-10-12, nesta worktree)

```bash
grep -rnE "\.from\(|\.rpc\(|functions\.invoke|functions/v1|rest/v1|sb\(|adFetch\(" \
  src/ferramentas/noticias src/ferramentas/claude-status src/ferramentas/inicio src/ferramentas/gestao-interna | grep -v '\.test\.'
# → 6 linhas: 3 .from (noticias), 2 sb( (claude-status), 1 functions.invoke com nome em variável (2 edges)
```

| # | Sítio | Hoje | Depois (Plano 7) |
|---|---|---|---|
| 1 | `src/ferramentas/noticias/tela-de-noticias.vue:108-109` | `.from('noticias_concorrentes').select('rodada').order('rodada',desc).limit(1200)` + `Set`/`slice(0,6)` no JS | `GET /api/noticias/rodadas?limite=6` (já distintas e em ordem) |
| 2 | `…/tela-de-noticias.vue:110-112` | `.from('noticias_concorrentes').select('*').order(rodada,destaque,created_at desc).in('rodada', recentes)` | `GET /api/noticias/concorrentes?rodada=<d1,d2,…>` (sem rodadas: sem o filtro) |
| 3 | `…/tela-de-noticias.vue:119-120` | `.from('noticias_panorama').select('rodada,conteudo_md,modelo,created_at').order('rodada',desc).limit(1)` | `GET /api/noticias/panorama?limite=1` |
| 4 | `src/ferramentas/claude-status/tela-de-status-claude.vue:703` | `sb('ia_execucoes?select=*&order=run_at.desc&limit=200')` | `GET /api/status-ia/execucoes?limite=200` |
| 5 | `…/tela-de-status-claude.vue:707` | `sb('robos_saude?select=*')` | `GET /api/status-ia/saude-dos-robos` |
| 6 | `…/tela-de-status-claude.vue:449` (chamada de :469, :485, :502, :517) | `sbClient.functions.invoke(funcao, { body: { dias } })`, `funcao` = `custo-anthropic` \| `custo-openai` | `POST /api/custo-anthropic` \| `POST /api/custo-openai` com `{dias}`; não-2xx traz corpo (`{"error":"falha","detalhe":…}` 500, `{"error":"sem_permissao"}` 403) |
| — | `…/tela-de-noticias.vue:99` | 14 logos por URL pública do Storage (`…supabase.co/storage/v1/object/public/ig-cache/logo/…`) | **Plano 6** (bucket `ig-cache`), não este |
| — | `src/ferramentas/inicio/*`, `src/ferramentas/gestao-interna/*` | 0 acesso direto (só `controle-de-login-e-usuario.js`) | nada aqui (sessão/perfil: 5.0 + Plano 7) |

Telas sem dono: nenhuma. As 144 tabelas do catálogo aparecem todas na IV.2 do mestre; toda edge chamada pelo front tem dono (21 por nome literal, mais as duas de custo, chamadas por variável em `tela-de-status-claude.vue:449`, que o grep por literal não acha). Quem GRAVA estas tabelas são robôs do `coletor/` com a chave de serviço (`noticias_concorrentes` 21 arquivos, `noticias_panorama` 1, `ia_execucoes` 3, `robos_execucoes` 7, `robos_esperados` 4): Plano 7.

### I.2 Premissas de schema (conferidas)

| Premissa | Fonte |
|---|---|
| `noticias_concorrentes(id uuid pk, marca, titulo, resumo, categoria, url, fonte, data_publicacao date, rodada date not null, destaque bool not null, created_at timestamptz)`; produção tem mais colunas (`produtos` jsonb lido em `tela-de-noticias.vue:328`; `imagem_url` gravada por `coletor/insere-editorial.mjs`) | `db/migrations/007_noticias_concorrentes.sql:7-19` |
| policy `noticias_select_authenticated`: select, `authenticated`, `true` | `007_…:32-36`; catálogo |
| `noticias_panorama(rodada date pk, conteudo_md text not null, modelo, uso, created_at)`; policies `noticias_panorama_read` (`authenticated`, `true`) e `…_read_anon` (`anon`, `true`) | `db/migrations/acessos/017_noticias_panorama.sql:2-13`; catálogo |
| `ia_execucoes(id uuid pk, run_at timestamptz, robo, acao, modelo, input_tokens, output_tokens, chamadas, usd numeric(10,4), duracao_ms, itens, unidade, status, detalhe, github_run_id, created_at)`; policy `ia_exec_select` (`authenticated`, `true`) | `db/migrations/025_ia_execucoes.sql:6-30`; catálogo |
| `robos_execucoes(id bigserial, robo text not null, request_id, disparado_em timestamptz, status_code, ok bool, resposta, conferido_em)` (já no legado do `testebanco`) | `db/migrations/2026-07-31-saude-dos-robos.sql:24-33`; `api/internal/testebanco/testebanco.go:25-29` |
| `robos_esperados(robo text pk, horas_sem_sucesso_ate int not null, critico bool not null default false, porque text)` | `2026-07-31-saude-dos-robos.sql:134-141` |
| Leitura de `robos_esperados` e `robos_execucoes`: `EXISTS(profiles p where p.id = auth.uid() and (p.role = 'admin' or p.is_superadmin or 'claude.status' = any(p.features)))`; `…_srv` = `service_role` | `2026-07-31-…:206-217`; catálogo (`robos_*_leitura`, `robos_*_srv`) |
| Visão `robos_saude` (prefixo mais longo, variantes vivas em 72 h, 11 colunas: `robo, critico, ultimo_sucesso, ultimo_disparo, falhas_24h, disparos_24h, horas_sem_sucesso_ate, situacao, porque, quem_falhou, variantes_vivas`) | `db/migrations/2026-09-22-vigia-dos-robos-cada-um-no-seu-teto.sql:58-124` = `levantamento/11-views.csv:2-63` (produção) |
| `security_invoker = true` posto em `2026-07-31-…:193-198` ("OBRIGATÓRIO") e reaplicado em `2026-08-19-…:130-134`; **a 09-22 recria com `create or replace` e não reaplica** — no Postgres 17 isso zera a opção (conferido: `reloptions` de `{security_invoker=true}` para vazio) | arquivos citados; Ruling 1 |
| Chaves admin hoje em `segredos_de_cron` (`anthropic_admin_key`, `openai_admin_key`), lidas com a chave de serviço | `supabase/functions/custo-anthropic/index.ts:28-32`; `custo-openai/index.ts:119-123` |
| Rota `/claude-status` exige `claude.status` com `ver` (aparência, não segurança) | `src/compartilhado/catalogo-de-ferramentas.js:121`; `src/guarda-de-rotas.js:4-8` |

### I.3 O que este plano consome do Plano 5.0 (contrato do mestre; o código ainda não está pronto)

- `dados.Consulta{Tabela, Alias, SQL, Onde, Filtros, Ordens, OrdemPadrao}` com `Validar(cat) error` e `Handler(b dados.Consultor, cat) http.HandlerFunc`; `dados.Filtro{Param, SQL, Tipo}` (tipo `data[]`); `dados.Lista`, `dados.Erro`, `dados.ErroDoBanco`, `dados.Consultor` (Tasks 1 e 5 do mestre).
- `autz.Producao`, `autz.Compilar`, `(*autz.Catalogo).Filtro(e, tab, autz.Ler, alias) (autz.Filtro, error)` — regra que não depende da linha devolve `SQL` exatamente `"true"` ou `"false"`; `autz.Escopo{ID, TemPerfil, Ativo, Papel, SuperFicha, Modulos, Chaves, Acoes, SemTrava, Contas, …}`; `autz.EscopoDo`, `autz.ComEscopo` (Tasks 2, 3 e 5).
- `auth.NoContexto(ctx, *auth.Ator)` (Task 6); `auth.AtorDoContexto`, `auth.Ator{Tipo, Papel, SuperAdmin, Modulos, Permissoes, ImpersonadorID}` (Plano 1).
- Em `api/internal/web/rotas.go`, o grupo de DOMÍNIO `r.Group(func(r chi.Router) { r.Use(autz.ComEscopo(p)); r.Post("/rpc/{nome}", …) })` dentro do grupo de `auth.Exigir`; em `rotas_test.go`, `soSessao`, `fixtureUsuarios` e `TestPrazosPorRotaPelaMontagemReal`; `testebanco.Novo` e `testebanco.TabelasDoEscopo` (Task 10).

## II. Estrutura de arquivos

```
api/internal/paineis/paineis.go          # Montar: registra as rotas do 5.12 no grupo de domínio
api/internal/paineis/leituras.go         # as 4 dados.Consulta (notícias ×3, diário de IA)
api/internal/paineis/saude.go            # GET /status-ia/saude-dos-robos (visão fora do catálogo)
api/internal/paineis/paineis_test.go     # as Consultas validam contra o catálogo de produção
api/internal/paineis/saude_test.go       # a regra da saúde: por pessoa, as duas tabelas
api/internal/testebanco/paineis.go       # TabelasDosPaineis: DDL das migrations + a visão de produção
api/internal/custo/custo.go              # Rota (portão, corpo, janela, erro), Fatura, fixo, cliente HTTP (nova tentativa, paginação)
api/internal/custo/anthropic.go          # Cost/Usage Report da Anthropic (centavos)
api/internal/custo/openai.go             # Costs API da OpenAI (dólares), nomes das chaves por projeto
api/internal/custo/{custo,anthropic,openai}_test.go
api/internal/config/config.go            # + AnthropicAdmin, OpenAIAdmin (e em Segredos())
api/internal/web/rotas.go                # paineis.Montar no grupo de domínio; custo-* no grupo autenticado (PrazoCusto)
api/internal/web/rotas_test.go           # soSessao e prazos
api/internal/web/paineis_test.go         # matriz pessoa → status/linhas das leituras pela montagem real
api/internal/web/saude_test.go           # idem, a saúde dos robôs
api/internal/web/custo_test.go           # matriz do portão de custo pela montagem real
api/cmd/api/conferir.go                  # colunas/tipos que as rotas presumem no banco restaurado
docs/migracao-go/NOTAS-DA-IMPLANTACAO.md # seção do 5.12
```

## III. Pré-voo (antes da Task 1)

- [ ] `cd /Users/gabrielgertrudes/Projetos/Trabalho/lavessel/social-dashboard/.claude/worktrees/p5-512 && git status --short` → vazio; `git branch --show-current` → `feat/api-go-plano-5-12`.
- [ ] Trazer o 5.0 terminado: `git merge --no-edit feat/api-go-dominios` (só depois da revisão final do 5.0).
- [ ] O contrato da I.3 existe — cada linha imprime `ok`; se alguma falhar, **pare e reporte** (o 5.0 não terminou ou mudou o contrato):
  ```bash
  grep -q 'func (c Consulta) Validar' api/internal/dados/consulta.go && echo ok
  grep -q 'func (c \*Catalogo) Filtro' api/internal/autz/filtro.go && echo ok
  grep -q 'func ComEscopo' api/internal/autz/escrita.go && echo ok
  grep -q 'func NoContexto' api/internal/auth/middleware.go && echo ok
  grep -q 'autz.ComEscopo(p)' api/internal/web/rotas.go && echo ok
  grep -q '"data": *true' api/internal/dados/parametros.go && echo ok
  ```
- [ ] `test -f db/migrations/2026-09-22-vigia-dos-robos-cada-um-no-seu-teto.sql && grep -c 'create or replace view public.robos_saude as' db/migrations/2026-09-22-vigia-dos-robos-cada-um-no-seu-teto.sql` → `1`.
- [ ] `go version` → `go1.26` ou mais novo. Docker no ar; `lsof -iTCP:58612 -sTCP:LISTEN` → vazio.
- [ ] Banco das etapas (fica no ar até a verificação final):
  ```bash
  docker run -d --rm --name pg-p512 -e POSTGRES_PASSWORD=x -p 127.0.0.1:58612:5432 postgres:17
  until docker exec pg-p512 pg_isready -h 127.0.0.1 -U postgres >/dev/null 2>&1; do sleep 1; done
  export TEST_DATABASE_URL='postgres://postgres:x@localhost:58612/postgres?sslmode=disable'
  ```
- [ ] Linha de base: `cd api && go test ./... && go test -v ./... 2>&1 | grep -c -- '--- SKIP'` → tudo `ok` e `0`.

## IV. Tarefas

| # | Task | Revisor | Depende de |
|---|---|---|---|
| 1 | Leituras declaradas: notícias (3) e diário de IA | sonnet | 5.0 |
| 2 | Saúde dos robôs: visão fora do catálogo com a regra das duas tabelas | **opus** (autorização) | 1 |
| 3 | `custo`: rota, portão admin, janela, `fixo`, cliente com nova tentativa e sem redirecionar | **opus** (chave de API, dinheiro) | 5.0 |
| 4 | `custo`: Anthropic (centavos, rateio por chave) | **opus** (dinheiro, chave) | 3 |
| 5 | `custo`: OpenAI (dólares, custo real por chave) | **opus** (dinheiro, chave) | 3, 4 (mesmo pacote) |
| 6 | Montagem do custo, configuração das chaves e matriz pela montagem real | **opus** (fronteira, segredo) | 2, 4, 5 |
| 7 | `conferir` e notas de implantação | sonnet | 5.0 |

Ensaio deste plano (2026-10-12): o código e os testes das Tasks 3 e 4, mais a fatura de vetores da Task 5, foram compilados num módulo descartável com um `auth` de mentira — `gofmt`/`go vet` limpos, `go test -race` verde, e 14 de 14 mutações de segurança e de dinheiro mortas (redirecionamento seguido, corte antes da máscara, super-admin ou serviço passando no portão, ÷100 trocado nos dois fornecedores, arredondamento, trava de 50 páginas, 4 tentativas, `Retry-After` ignorado, peso da saída, chave vazia, id de projeto sem escapar). A visão extraída na Task 1 carregou num Postgres 17 e a semente da Task 2 deu exatamente o esperado. As Tasks 1, 2, 6 e 7 dependem do código do 5.0 e não foram compiladas.

---
### Task 1: Leituras declaradas — notícias e diário de IA

**Contrato** (todas com sessão, no grupo de domínio; resposta = array no formato do PostgREST, II.2 do mestre; regra = a do catálogo, `true` para toda sessão de painel/serviço):

| Rota | Tabela (alias) | Colunas | Filtros | Ordem | A tela pede |
|---|---|---|---|---|---|
| `GET /noticias/rodadas` | `noticias_concorrentes n` | `distinct n.rodada` | — | `n.rodada desc` | `?limite=6` |
| `GET /noticias/concorrentes` | `noticias_concorrentes n` | `n.*` | `rodada` (`data[]`: `AAAA-MM-DD,…`) | `n.rodada desc, n.destaque desc, n.created_at desc, n.id` | `?rodada=…` |
| `GET /noticias/panorama` | `noticias_panorama p` | `rodada, conteudo_md, modelo, created_at` | — | `p.rodada desc` | `?limite=1` |
| `GET /status-ia/execucoes` | `ia_execucoes x` | `x.*` | — | `x.run_at desc, x.id` | `?limite=200` |

Erros: sem sessão `401 nao_autenticado`; sessão de cliente da Vessel `403 sem_permissao` (Ruling 18); parâmetro desconhecido, repetido, `ordem`/`limite` inválido ou data inválida `400 pedido_invalido` (Ruling 10 do mestre).

**Testes de aceitação** (`TestPaineisPelaMontagemReal`, pela montagem real `web.Rotas`):
- Por papel, nas 4 rotas: sem sessão → 401; `cliente` → 403; `admin-desativado` → 401; `nenhum`, `admin`, `super`, `status` → 200 com as MESMAS linhas.
- `/noticias/rodadas?limite=2` → `[{"rodada":"2026-10-06"},{"rodada":"2026-09-29"}]` (distintas; 3 rodadas no banco).
- `/noticias/concorrentes?rodada=2026-10-06,2026-09-29` → títulos na ordem `B2` (destaque), `C1` (11h), `B1` (10h), `A1`; `B2` traz `"produtos":[{"nome":"Bolsa X","preco":199.9}]` (jsonb aninhado, não texto), `"destaque":true`, `"rodada":"2026-10-06"`, `"created_at":"2026-10-06T09:00:00+00:00"`. Sem filtro → as 5 linhas, `D1` (2026-09-22) por último.
- Negativos de parâmetro (todos 400): `?rodada=2026-13-40`, `?rodada=2026-10-06'--`, `?marca=Schutz`, `?ordem=titulo`, `?rodada=2026-10-06&rodada=2026-09-29`, `?limite=1001`.
- `/noticias/panorama?limite=1` → exatamente `[{"rodada":"2026-10-06","conteudo_md":"# Panorama","modelo":"claude-opus-4-8","created_at":"2026-10-06T12:00:00+00:00"}]` (sem `uso`).
- `/status-ia/execucoes?limite=1` → a execução mais recente, `"usd":0.1234` (número), `"run_at"` com `+00:00`; `?contar=1&limite=1` → `X-Total-Count: 2`.
- IDOR: não se aplica (as 3 tabelas não têm escopo por linha: policy `true`); o que se prova é que nenhum parâmetro abre coluna, tabela ou ordem não declarada (os 400 acima).
- Unitário `TestLeiturasValidamContraOCatalogo`: `Montar(chi.NewRouter(), nil, autz.Producao)` → `nil`; `chi.Walk` → exatamente as 4 rotas `GET` acima.

**Arquivos:** criar `api/internal/paineis/paineis.go`, `api/internal/paineis/leituras.go`, `api/internal/paineis/paineis_test.go`, `api/internal/testebanco/paineis.go`, `api/internal/web/paineis_test.go`; alterar `api/internal/web/rotas.go` (grupo de domínio), `api/internal/web/rotas_test.go` (`soSessao`).

**Dependências:** 5.0 (I.3).

- [ ] **Step 1: DDL dos testes.** Crie `api/internal/testebanco/paineis.go` (código completo: é a premissa de schema de todo o 5.12):

```go
package testebanco

import (
	"context"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
)

// TabelasDosPaineis cria as tabelas do sub-plano 5.12 com a DDL das migrations (o D0 não é deste
// plano: Ruling 16 do 5.12) e a visão robos_saude com o texto da migração que está em produção.
// robos_execucoes já vem do legado.
func TabelasDosPaineis(t *testing.T, p *pgxpool.Pool) {
	t.Helper()
	ctx := context.Background()
	// db/migrations/007_noticias_concorrentes.sql:7-19 (+ produtos: coluna que só existe em produção;
	// a tela lê row.produtos em tela-de-noticias.vue:328); acessos/017_noticias_panorama.sql:2-8;
	// 025_ia_execucoes.sql:6-23; 2026-07-31-saude-dos-robos.sql:134-141.
	if _, err := p.Exec(ctx, `
create table noticias_concorrentes (
  id uuid primary key default gen_random_uuid(), marca text not null, titulo text not null, resumo text,
  categoria text, url text, fonte text, data_publicacao date, rodada date not null default current_date,
  destaque boolean not null default false, created_at timestamptz not null default now(), produtos jsonb);
create table noticias_panorama (
  rodada date primary key, conteudo_md text not null, modelo text, uso text, created_at timestamptz not null default now());
create table ia_execucoes (
  id uuid primary key default gen_random_uuid(), run_at timestamptz not null default now(), robo text not null,
  acao text not null, modelo text, input_tokens bigint not null default 0, output_tokens bigint not null default 0,
  chamadas int not null default 0, usd numeric(10,4) not null default 0, duracao_ms bigint, itens int, unidade text,
  status text not null default 'ok', detalhe text, github_run_id text, created_at timestamptz not null default now());
create table robos_esperados (
  robo text primary key, horas_sem_sucesso_ate int not null, critico boolean not null default false, porque text);`); err != nil {
		t.Fatal(err)
	}
	// A visão verbatim de 2026-09-22-…:58-124 (= levantamento/11-views.csv, produção), sem o "public."
	// para nascer no schema do teste.
	_, aqui, _, _ := runtime.Caller(0)
	b, err := os.ReadFile(filepath.Join(filepath.Dir(aqui), "../../../db/migrations/2026-09-22-vigia-dos-robos-cada-um-no-seu-teto.sql"))
	if err != nil {
		t.Fatal(err)
	}
	s := string(b)
	i := strings.Index(s, "create or replace view public.robos_saude as")
	j := strings.Index(s[max(i, 0):], "x.robo;")
	if i < 0 || j < 0 {
		t.Fatal("não achei a visão robos_saude na migração de 2026-09-22")
	}
	visao := strings.Replace(s[i:i+j+len("x.robo;")], "public.robos_saude", "robos_saude", 1)
	if _, err := p.Exec(ctx, visao); err != nil {
		t.Fatal(err)
	}
}
```

- [ ] **Step 2: Testes que falham.** Em `api/internal/paineis/paineis_test.go`, `TestLeiturasValidamContraOCatalogo` (contrato acima). Em `api/internal/web/paineis_test.go` (package `web`), os ajudantes abaixo (completos: as Tasks 2 e 6 os usam) e `TestPaineisPelaMontagemReal` com os casos do contrato (tabela de casos `{caminho, quem, status, corpo esperado}`, corpo comparado com `json.Compact`):

```go
// pessoasDosPaineis: as de fixtureUsuarios (nenhum, so-meta, so-social, so-sales, admin) mais as que
// separam as regras do 5.12. Cria também as tabelas do escopo e as do 5.12. Devolve nome → token.
func pessoasDosPaineis(t *testing.T, p *pgxpool.Pool, s *auth.Store) map[string]string {
	t.Helper()
	toks := fixtureUsuarios(t, p, s)
	testebanco.TabelasDoEscopo(t, p)
	testebanco.TabelasDosPaineis(t, p)
	ctx := context.Background()
	extras := []struct {
		nome, tipo, papel, features, permissions string
		super, desativado                         bool
	}{
		{"super", "painel", "viewer", "{}", "{}", true, false},
		{"status", "painel", "viewer", "{claude.status}", `{"claude.status":["ver"]}`, false, false},
		{"so-permissao", "painel", "viewer", "{}", `{"claude.status":["ver"]}`, false, false},
		{"admin-desativado", "painel", "admin", "{}", "{}", false, true},
		{"cliente", "cliente", "", "", "", false, false}, // cliente da Vessel: sem perfil
	}
	for i, x := range extras {
		id := fmt.Sprintf("51200000-0000-4000-a000-%012d", i+1)
		if _, err := p.Exec(ctx, `insert into usuarios (id, email) values ($1::uuid, $2::text)`, id, x.nome+"@p512.x"); err != nil {
			t.Fatal(err)
		}
		if x.tipo == "painel" {
			if _, err := p.Exec(ctx, `insert into profiles (id, email, role, is_superadmin, features, permissions, disabled, escopo_por_equipe)
				values ($1::uuid, $2::text, $3::text, $4::boolean, $5::text[], $6::jsonb, $7::boolean, false)`,
				id, x.nome+"@p512.x", x.papel, x.super, x.features, x.permissions, x.desativado); err != nil {
				t.Fatal(err)
			}
		}
		tok, err := s.Criar(ctx, id, x.tipo, nil)
		if err != nil {
			t.Fatal(err)
		}
		toks[x.nome] = tok
	}
	return toks
}

// lerDosPaineis faz GET caminho com o token (vazio = sem sessão) e devolve status e corpo.
func lerDosPaineis(h http.Handler, caminho, tok string) (int, string) {
	r := httptest.NewRequest("GET", caminho, nil)
	if tok != "" {
		r.Header.Set("Authorization", "Bearer "+tok)
	}
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	return w.Code, strings.TrimSpace(w.Body.String())
}
```

  Semente (`semearPaineis(t, p)` no mesmo arquivo): `noticias_concorrentes` = `A1` Santa Lolla 2026-09-29 10h; `B1` Schutz 2026-10-06 10h; `B2` Schutz 2026-10-06 09h `destaque=true` `produtos='[{"nome":"Bolsa X","preco":199.9}]'`; `C1` Mercado 2026-10-06 11h; `D1` Arezzo&Co 2026-09-22 (horas em UTC); `noticias_panorama` = 2026-09-29 e 2026-10-06 (`'# Panorama'`, `'claude-opus-4-8'`, `uso='{"in":1}'`, 12h UTC); `ia_execucoes` = 2 linhas (`usd` 0.1234 a mais recente).

- [ ] **Step 3: Rodar e ver falhar.** `go test ./internal/paineis/ ./internal/web/ -run 'TestLeituras|TestPaineis' 2>&1 | tail -3` → FAIL (`undefined: Montar`, 404 nas rotas).

- [ ] **Step 4: Implementar.** `api/internal/paineis/leituras.go`:

```go
package paineis

import "github.com/rbv-co/social-dashboard/api/internal/dados"

// leituras: as Consultas do 5.12. A regra de Ler do catálogo entra sozinha no WHERE; filtros e ordens
// só destas listas (o pedido nunca escolhe tabela, coluna nem trecho de SQL).
var leituras = map[string]dados.Consulta{
	// tela-de-noticias.vue:108-109: as edições mais recentes (a tela pede ?limite=6).
	"/noticias/rodadas": {Tabela: "noticias_concorrentes", Alias: "n",
		SQL: `select distinct n.rodada from noticias_concorrentes n`, OrdemPadrao: "n.rodada desc"},
	// tela-de-noticias.vue:110-112: as notícias dessas edições; sem filtro = todas (até 1000).
	"/noticias/concorrentes": {Tabela: "noticias_concorrentes", Alias: "n",
		SQL:         `select n.* from noticias_concorrentes n`,
		Filtros:     []dados.Filtro{{Param: "rodada", SQL: "n.rodada = any(@rodada::date[])", Tipo: "data[]"}},
		OrdemPadrao: "n.rodada desc, n.destaque desc, n.created_at desc, n.id"},
	// tela-de-noticias.vue:119: o panorama, só as 4 colunas que a tela pede.
	"/noticias/panorama": {Tabela: "noticias_panorama", Alias: "p",
		SQL: `select p.rodada, p.conteudo_md, p.modelo, p.created_at from noticias_panorama p`, OrdemPadrao: "p.rodada desc"},
	// tela-de-status-claude.vue:703: o diário das execuções de IA.
	"/status-ia/execucoes": {Tabela: "ia_execucoes", Alias: "x",
		SQL: `select x.* from ia_execucoes x`, OrdemPadrao: "x.run_at desc, x.id"},
}
```

  `api/internal/paineis/paineis.go`:

```go
// Package paineis são as leituras dos painéis pequenos (sub-plano 5.12): notícias e status da IA.
package paineis

// Montar registra as rotas do 5.12 no grupo de DOMÍNIO de web.Rotas (depois de autz.ComEscopo).
// Consulta que não valida contra o catálogo = erro (a API não sobe).
func Montar(r chi.Router, b dados.Consultor, cat *autz.Catalogo) error {
	for _, caminho := range slices.Sorted(maps.Keys(leituras)) {
		c := leituras[caminho]
		if err := c.Validar(cat); err != nil {
			return fmt.Errorf("paineis %s: %w", caminho, err)
		}
		r.Get(caminho, c.Handler(b, cat))
	}
	return nil
}
```

  Em `api/internal/web/rotas.go`, dentro do grupo de domínio, logo depois de `r.Post("/rpc/{nome}", rpcs.ServeHTTP)` (import `paineis` em ordem alfabética):

```go
			// Plano 5.12: notícias e status da IA (leituras declaradas, regra do catálogo).
			if err := paineis.Montar(r, p, autz.Producao); err != nil {
				panic(err) // declaração errada: a API não sobe
			}
```

  Em `api/internal/web/rotas_test.go`, no fim do mapa `soSessao`:

```go
	// Plano 5.12: leituras com a regra do catálogo (`true` para sessão); a matriz por papel é
	// TestPaineisPelaMontagemReal.
	"GET /noticias/rodadas": true, "GET /noticias/concorrentes": true, "GET /noticias/panorama": true,
	"GET /status-ia/execucoes": true,
```

- [ ] **Step 5: Rodar e ver passar.** `gofmt -l ./internal && go vet ./internal/paineis/ ./internal/web/ && go test -count=1 -v ./internal/paineis/ ./internal/web/ 2>&1 | grep -E '^(--- |ok|FAIL)'` → `--- PASS` em `TestLeiturasValidamContraOCatalogo`, `TestPaineisPelaMontagemReal`, `TestNenhumaRotaNovaFicaAberta`; nenhum `SKIP`.

- [ ] **Step 6: Commit.**
```bash
git add api/internal/paineis/ api/internal/testebanco/paineis.go api/internal/web/rotas.go api/internal/web/rotas_test.go api/internal/web/paineis_test.go
git commit -m "feat(api): leituras de notícias e do diário de IA com a regra do catálogo (Plano 5.12)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---
### Task 2: Saúde dos robôs — visão fora do catálogo com a regra das duas tabelas

**Contrato:** `GET /status-ia/saude-dos-robos` (grupo de domínio) → `200` com as linhas da visão `robos_saude` como estão (11 colunas, ordem `critico desc, robo`, até 1000), ou `200 []` para quem não passa na regra de Ler de `robos_esperados` E de `robos_execucoes` (catálogo: conta ativa e papel `admin`, super-admin pela ficha ou `claude.status` em `features`). Qualquer parâmetro na query → `400 pedido_invalido`. Sem escopo / tabela fora do catálogo → `500`. A API não interpreta nomes de robô: o casamento por prefixo mais longo é da visão (o worker grava `coletar-dados-07h · <conta>`, `meta-hora-retentativa-00h`…; Ruling 2).

**Testes de aceitação:**
- `TestRegraDaSaudeDosRobosEhPorPessoa` (unitário, `autz.Producao`): para as duas tabelas, `Filtro(...).SQL` é exatamente `"true"` para admin, super-admin pela ficha (papel viewer) e `claude.status` em `Modulos`; `"false"` para `claude.status` só em `Chaves`/`Acoes`, comum, admin com `Ativo=false` e sem perfil. Se o catálogo mudar a forma, este teste falha (a rota responderia `[]`).
- `TestSaudeExigeAsDuasTabelas` (catálogo de teste, banco real): `robos_esperados` aberta e `robos_execucoes` só `is_frota_admin()` → pessoa com módulo `frota` recebe as linhas; pessoa sem → `[]` (mata "conferir só a primeira tabela"); `robos_execucoes` com `pode_ver_conta(account_id)` (regra por linha) → `[]` mesmo para quem tem a conta; sem escopo → 500; `?x=1` → 400.
- `TestSaudeDosRobosPelaMontagemReal` (`web.Rotas`, semente abaixo): `admin`, `super`, `status` → as 4 linhas, na ordem `coletar-dados`, `meta-hora`, `meta-hora-retentativa-00h`, `sem-rodar`, com `situacao` = `nunca deu certo`, `ok`, `ok`, `sem registro ainda`, `quem_falhou` de `coletar-dados` = `["coletar-dados-07h · Vessel"]`, e as chaves do 1º objeto na ordem das 11 colunas; `nenhum` e `so-permissao` → `[]`; sem sessão → 401; `cliente` → 403; `admin-desativado` → 401.
  Semente: `robos_esperados` = (`coletar-dados`, 30, true), (`meta-hora`, 4, false), (`meta-hora-retentativa-00h`, 24, false), (`sem-rodar`, 2, false); `robos_execucoes` = (`coletar-dados-07h · Vessel`, `now() - interval '1 hour'`, `ok=false`), (`meta-hora`, `now() - interval '1 hour'`, `ok=true`), (`meta-hora-retentativa-00h`, `now() - interval '2 hours'`, `ok=true`).

**Arquivos:** criar `api/internal/paineis/saude.go`, `api/internal/paineis/saude_test.go`, `api/internal/web/saude_test.go`; alterar `api/internal/paineis/paineis.go` (uma linha), `api/internal/web/rotas_test.go` (`soSessao`).

**Dependências:** Task 1 (`Montar`, `TabelasDosPaineis`, `pessoasDosPaineis`, `lerDosPaineis`).

- [ ] **Step 1: Testes que falham.** `api/internal/paineis/saude_test.go`:

```go
package paineis

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/rbv-co/social-dashboard/api/internal/autz"
	"github.com/rbv-co/social-dashboard/api/internal/testebanco"
)

const eu = "51200000-0000-4000-a000-000000000099"

func TestRegraDaSaudeDosRobosEhPorPessoa(t *testing.T) {
	casos := []struct {
		nome  string
		e     *autz.Escopo
		passa bool
	}{
		{"admin", &autz.Escopo{ID: eu, TemPerfil: true, Ativo: true, Papel: "admin"}, true},
		{"super-admin pela ficha", &autz.Escopo{ID: eu, TemPerfil: true, Ativo: true, Papel: "viewer", SuperFicha: true}, true},
		{"claude.status em features", &autz.Escopo{ID: eu, TemPerfil: true, Ativo: true, Papel: "viewer", Modulos: []string{"claude.status"}}, true},
		{"claude.status só em permissions", &autz.Escopo{ID: eu, TemPerfil: true, Ativo: true, Papel: "viewer",
			Chaves: map[string]bool{"claude.status": true}, Acoes: map[string][]string{"claude.status": {"ver"}}}, false},
		{"comum", &autz.Escopo{ID: eu, TemPerfil: true, Ativo: true, Papel: "viewer"}, false},
		{"admin desativado", &autz.Escopo{ID: eu, TemPerfil: true, Ativo: false, Papel: "admin"}, false},
		{"sem perfil", &autz.Escopo{ID: eu, Ativo: true}, false},
	}
	for _, c := range casos {
		quer := "false"
		if c.passa {
			quer = "true"
		}
		for _, tab := range tabelasDaSaude {
			if f, err := autz.Producao.Filtro(c.e, tab, autz.Ler, "x"); err != nil || f.SQL != quer {
				t.Errorf("%s × %s = %q (%v), esperava %q (a regra virou por linha? reescreva SaudeDosRobos)", c.nome, tab, f.SQL, err, quer)
			}
		}
	}
}

func catalogoDaSaude(t *testing.T, execucoes string) *autz.Catalogo {
	t.Helper()
	cat, err := autz.Compilar([]byte(`[
 {"tabela":"robos_esperados","nome":"le","tipo":"permissive","comando":"select","papeis":["authenticated"],"using":"true","withCheck":null},
 {"tabela":"robos_execucoes","nome":"le","tipo":"permissive","comando":"select","papeis":["authenticated"],"using":"` + execucoes + `","withCheck":null}]`))
	if err != nil {
		t.Fatal(err)
	}
	return cat
}

func lerSaude(h http.Handler, e *autz.Escopo, query string) (int, string) {
	r := httptest.NewRequest("GET", "/status-ia/saude-dos-robos"+query, nil)
	if e != nil {
		r = r.WithContext(autz.NoContexto(r.Context(), e))
	}
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	return w.Code, strings.TrimSpace(w.Body.String())
}

func TestSaudeExigeAsDuasTabelas(t *testing.T) {
	p := testebanco.Novo(t)
	testebanco.TabelasDosPaineis(t, p)
	if _, err := p.Exec(context.Background(), `insert into robos_esperados values ('r', 1, false, 'x')`); err != nil {
		t.Fatal(err)
	}
	h := SaudeDosRobos(p, catalogoDaSaude(t, "is_frota_admin()"))
	frota := &autz.Escopo{ID: eu, TemPerfil: true, Ativo: true, SemTrava: true, Modulos: []string{"frota"}}
	comum := &autz.Escopo{ID: eu, TemPerfil: true, Ativo: true, SemTrava: true}
	if st, corpo := lerSaude(h, frota, ""); st != 200 || !strings.Contains(corpo, `"robo":"r"`) {
		t.Errorf("quem lê as duas = %d %s", st, corpo)
	}
	if st, corpo := lerSaude(h, comum, ""); st != 200 || corpo != "[]" {
		t.Errorf("só a primeira tabela liberada = %d %s, esperava []", st, corpo)
	}
	conta := &autz.Escopo{ID: eu, TemPerfil: true, Ativo: true, SemTrava: true, Contas: []string{"A1"}}
	if st, corpo := lerSaude(SaudeDosRobos(p, catalogoDaSaude(t, "pode_ver_conta(account_id)")), conta, ""); st != 200 || corpo != "[]" {
		t.Errorf("regra por linha = %d %s, esperava [] (fecha)", st, corpo)
	}
	if st, _ := lerSaude(h, nil, ""); st != 500 {
		t.Errorf("sem escopo = %d, esperava 500", st)
	}
	if st, _ := lerSaude(h, frota, "?x=1"); st != 400 {
		t.Errorf("parâmetro = %d, esperava 400", st)
	}
}
```

  `api/internal/web/saude_test.go`: `TestSaudeDosRobosPelaMontagemReal` com `pessoasDosPaineis`, `lerDosPaineis` e os casos do contrato (as chaves do 1º objeto lidas com `json.Decoder.Token()` para conferir a ordem).

- [ ] **Step 2: Rodar e ver falhar.** `go test ./internal/paineis/ ./internal/web/ -run 'Saude' 2>&1 | tail -3` → FAIL (`undefined: SaudeDosRobos`). Se `TestRegraDaSaudeDosRobosEhPorPessoa` falhar por o 5.0 não dobrar constantes (`SQL` diferente de `"true"`/`"false"` para regra por pessoa, ex.: `"(true or false)"`), **pare e reporte**: a rota depende desse contrato da I.3.

- [ ] **Step 3: Implementar** `api/internal/paineis/saude.go` (completo: é autorização):

```go
package paineis

import (
	"net/http"

	"github.com/jackc/pgx/v5"
	"github.com/rbv-co/social-dashboard/api/internal/autz"
	"github.com/rbv-co/social-dashboard/api/internal/dados"
)

// tabelasDaSaude: a visão robos_saude lê estas duas tabelas inteiras. Ela foi criada com
// security_invoker (db/migrations/2026-07-31-saude-dos-robos.sql:193-198): quem a lê passa pela RLS
// das duas. Aqui vale a mesma regra, do catálogo (Ruling 1 do 5.12).
var tabelasDaSaude = []string{"robos_esperados", "robos_execucoes"}

// SaudeDosRobos é GET /status-ia/saude-dos-robos: a visão robos_saude (fora do catálogo: Ruling 27
// do Plano 5) como está, ou [] para quem não lê as duas tabelas de baixo.
func SaudeDosRobos(b dados.Consultor, cat *autz.Catalogo) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if len(r.URL.Query()) > 0 {
			dados.Erro(w, http.StatusBadRequest, "pedido_invalido", "esta leitura não aceita parâmetros")
			return
		}
		e := autz.EscopoDo(r.Context())
		for _, t := range tabelasDaSaude {
			f, err := cat.Filtro(e, t, autz.Ler, "x")
			if err != nil { // sem escopo ou tabela fora do catálogo: 500, nunca libera
				dados.ErroDoBanco(w, err)
				return
			}
			// ponytail: a visão agrega as tabelas inteiras, então só cabe regra POR PESSOA (constante);
			// regra por linha (forma nova no catálogo) responde [] até a rota ser reescrita, e
			// TestRegraDaSaudeDosRobosEhPorPessoa acusa a mudança antes do deploy.
			if f.SQL != "true" {
				w.Header().Set("Content-Type", "application/json")
				w.Write([]byte("[]"))
				return
			}
		}
		dados.Lista(r.Context(), b, w, `select s.* from robos_saude s order by s.critico desc, s.robo limit 1000`, pgx.NamedArgs{})
	}
}
```

  Em `paineis.Montar`, antes do `return nil`: `r.Get("/status-ia/saude-dos-robos", SaudeDosRobos(b, cat))`. Em `soSessao` (`rotas_test.go`), junto das do 5.12: `"GET /status-ia/saude-dos-robos": true,` (quem não passa recebe `200 []`; a matriz é `TestSaudeDosRobosPelaMontagemReal`). Atualize `TestLeiturasValidamContraOCatalogo` para 5 rotas.

- [ ] **Step 4: Rodar e ver passar.** `gofmt -l ./internal && go vet ./internal/paineis/ ./internal/web/ && go test -count=1 -v ./internal/paineis/ ./internal/web/ 2>&1 | grep -E '^(--- |ok|FAIL)'` → `--- PASS` nos três testes da saúde e em `TestNenhumaRotaNovaFicaAberta`.

- [ ] **Step 5: Commit.**
```bash
git add api/internal/paineis/ api/internal/web/saude_test.go api/internal/web/rotas_test.go
git commit -m "feat(api): saúde dos robôs com a regra das duas tabelas da visão (Plano 5.12)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---
### Task 3: `custo` — rota, portão admin, janela, `fixo` e cliente com nova tentativa

**Contrato** (o das edges, `custo-anthropic/index.ts:139-189`, `custo-openai/index.ts:182-270`):
- `POST /custo-anthropic` e `POST /custo-openai` (montados na Task 6), corpo `{"dias": número|null}`; vazio/ausente = 30; ajustado a 1..90 (`Math.min(90, Math.max(1, d))`); texto ou outro tipo → `400 {"error":"pedido_invalido"}`; campos a mais são ignorados.
- Portão ANTES de tudo: `Ator.Tipo = "painel"` e `Ator.Papel = "admin"` (texto exato); senão `403 {"error":"sem_permissao"}` e o fornecedor não é chamado.
- Chave vazia → `500 {"error":"falha","detalhe":"chave_admin_nao_configurada"}`.
- Janela: `Fim` = meia-noite UTC de amanhã; `Inicio = Fim − dias`; `desde`/`ate` = datas UTC.
- `200` = `{"desde","ate","cambio":5.5,"totalUsd","totalBrl","dias":[{data,usd}],"porCategoria":[{item,usd}],"porChave":[…]}` nessa ordem; listas vazias saem `[]`. `totalUsd = fixo(Σdias,4)`, `totalBrl = fixo(Σdias×5.5,2)`.
- Falha do fornecedor → `500 {"error":"falha","detalhe":"<frase da edge>"}`, sem chave, endereço nem corpo do fornecedor.
- Cliente: GET com a chave no cabeçalho; 2xx = sucesso; 429, 5xx e "sem resposta" repetem até 3 tentativas (espera 600 ms, 1200 ms ou o `Retry-After` do 429 se maior, até 1 h); 1xx/3xx/4xx são resposta (sem repetir); nunca começa tentativa que não cabe no orçamento; não segue redirecionamento; corpo do fornecedor até 10 MiB; no log, o corpo de erro com a chave trocada por `***` ANTES do corte de 200 caracteres. Paginação por `next_page` enquanto `has_more`, no máximo 50 páginas.

**Testes de aceitação:** `TestPortaoEhOPapelAdmin` (viewer, super-admin pela ficha com papel viewer, `claude.status`, serviço com papel admin, `Admin` maiúsculo, sem ator → 403 e 0 chamadas; admin → 200), `TestChaveAusente`, `TestCorpoEJanela`, `TestFixoComoOToFixedDoJS`, `TestNovaTentativa`, `TestNaoSegueRedirecionamento`, `TestPrazoPorTentativa`, `TestChaveNuncaSaiNoErroNemNoLog`, `TestPaginasParaEm50` — código abaixo.

**Arquivos:** criar `api/internal/custo/custo.go`, `api/internal/custo/custo_test.go`.

**Dependências:** 5.0 (`auth.NoContexto`).

- [ ] **Step 1: Testes que falham.** `api/internal/custo/custo_test.go`:

```go
package custo

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"net/url"
	"slices"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/rbv-co/social-dashboard/api/internal/auth"
)

const chaveFalsa = "sk-ant-admin01-CHAVE-FALSA-0123456789abcdef"

var (
	admin = &auth.Ator{Tipo: "painel", Papel: "admin"}
	// janelaDeTeste: 30 dias até 2026-10-13 00:00 UTC (as Tasks 4 e 5 usam).
	janelaDeTeste = janelaDe(30, time.Date(2026, 10, 12, 15, 0, 0, 0, time.UTC))
)

func semEspera(context.Context, time.Duration) error { return nil }

func clienteDeTeste(pausas *[]time.Duration) cliente {
	return cliente{fornecedor: "OpenAI", chave: chaveFalsa, http: semRedirecionar, prazo: 8 * time.Second, orcamento: 20 * time.Second,
		cabecalho: func(h http.Header, k string) { h.Set("Authorization", "Bearer "+k) },
		pausa:     func(_ context.Context, d time.Duration) error { *pausas = append(*pausas, d); return nil }}
}

func pedir(rt Rota, a *auth.Ator, corpo string) *httptest.ResponseRecorder {
	r := httptest.NewRequest("POST", "/custo-x", strings.NewReader(corpo))
	if a != nil {
		r = r.WithContext(auth.NoContexto(r.Context(), a))
	}
	w := httptest.NewRecorder()
	rt.ServeHTTP(w, r)
	return w
}

func TestPortaoEhOPapelAdmin(t *testing.T) {
	chamadas := 0
	rt := Rota{Chave: chaveFalsa, Buscar: func(_ context.Context, _ string, j Janela) (Fatura, error) {
		chamadas++
		return novaFatura(j, nil, nil, []any{}), nil
	}}
	casos := []struct {
		nome   string
		a      *auth.Ator
		status int
	}{
		{"sem ator", nil, 403},
		{"viewer", &auth.Ator{Tipo: "painel", Papel: "viewer"}, 403},
		{"super-admin pela ficha com papel viewer (a edge só olha role)", &auth.Ator{Tipo: "painel", Papel: "viewer", SuperAdmin: true}, 403},
		{"claude.status abre a tela, não a fatura", &auth.Ator{Tipo: "painel", Papel: "viewer", Modulos: []string{"claude.status"},
			Permissoes: map[string][]string{"claude.status": {"ver"}}}, 403},
		{"serviço com papel admin", &auth.Ator{Tipo: "servico", Papel: "admin"}, 403},
		{"Admin maiúsculo", &auth.Ator{Tipo: "painel", Papel: "Admin"}, 403},
		{"admin", admin, 200},
	}
	for _, c := range casos {
		antes := chamadas
		w := pedir(rt, c.a, `{"dias":7}`)
		if w.Code != c.status {
			t.Errorf("%s = %d %s, esperava %d", c.nome, w.Code, w.Body, c.status)
		}
		if c.status == 403 && (chamadas != antes || strings.TrimSpace(w.Body.String()) != `{"error":"sem_permissao"}`) {
			t.Errorf("%s: negado chamou o fornecedor (%d) ou corpo errado: %s", c.nome, chamadas-antes, w.Body)
		}
	}
}

func TestChaveAusente(t *testing.T) {
	chamou := false
	rt := Rota{Buscar: func(context.Context, string, Janela) (Fatura, error) { chamou = true; return Fatura{}, nil }}
	if w := pedir(rt, admin, `{}`); w.Code != 500 || strings.TrimSpace(w.Body.String()) != `{"error":"falha","detalhe":"chave_admin_nao_configurada"}` || chamou {
		t.Errorf("admin sem chave = %d %s (chamou=%v)", w.Code, w.Body, chamou)
	}
	if w := pedir(rt, &auth.Ator{Tipo: "painel", Papel: "viewer"}, `{}`); w.Code != 403 {
		t.Errorf("o portão vem antes da chave: %d", w.Code)
	}
}

func TestCorpoEJanela(t *testing.T) {
	agora := time.Date(2026, 10, 12, 22, 30, 0, 0, time.FixedZone("BRT", -3*3600)) // 01:30 UTC do dia 13
	var recebida Janela
	rt := Rota{Chave: chaveFalsa, Agora: func() time.Time { return agora },
		Buscar: func(_ context.Context, _ string, j Janela) (Fatura, error) {
			recebida = j
			return novaFatura(j, nil, nil, []any{}), nil
		}}
	fim := time.Date(2026, 10, 14, 0, 0, 0, 0, time.UTC) // amanhã EM UTC (em UTC já é dia 13)
	casos := []struct {
		corpo  string
		status int
		dias   float64
	}{
		{``, 200, 30}, {`{}`, 200, 30}, {`{"dias":null}`, 200, 30}, {`{"dias":7}`, 200, 7},
		{`{"dias":0}`, 200, 1}, {`{"dias":-5}`, 200, 1}, {`{"dias":1000}`, 200, 90}, {`{"dias":7.5}`, 200, 7.5},
		{`{"dias":7,"outro":1}`, 200, 7},
		{`{"dias":"30"}`, 400, 0}, {`{"dias":[1]}`, 400, 0}, {`{"dias":`, 400, 0},
	}
	for _, c := range casos {
		recebida = Janela{}
		w := pedir(rt, admin, c.corpo)
		if w.Code != c.status {
			t.Errorf("%q = %d %s, esperava %d", c.corpo, w.Code, w.Body, c.status)
			continue
		}
		if c.status != 200 {
			if strings.TrimSpace(w.Body.String()) != `{"error":"pedido_invalido"}` {
				t.Errorf("%q: corpo %s", c.corpo, w.Body)
			}
			continue
		}
		if quer := fim.Add(-time.Duration(c.dias * float64(24*time.Hour))); !recebida.Fim.Equal(fim) || !recebida.Inicio.Equal(quer) {
			t.Errorf("%q: janela %v–%v, esperava %v–%v", c.corpo, recebida.Inicio, recebida.Fim, quer, fim)
		}
	}
	w := pedir(rt, admin, `{"dias":30}`)
	if !strings.HasPrefix(w.Body.String(), `{"desde":"2026-09-14","ate":"2026-10-14","cambio":5.5,"totalUsd":0,"totalBrl":0,"dias":[],"porCategoria":[],"porChave":[]}`) {
		t.Errorf("fatura vazia = %s", w.Body)
	}
}

func TestFixoComoOToFixedDoJS(t *testing.T) {
	a, b, um, dois := 13.35, 5.5, 0.1, 0.2 // variáveis: a conta acontece em float, como no JS
	casos := []struct {
		x     float64
		casas int
		json  string // JSON.stringify(Number(x.toFixed(casas))) no Node 22
	}{
		{a * b, 2, "73.42"},                              // Math.round(x*100)/100 daria 73.43
		{1.03125, 4, "1.0313"}, {-1.03125, 4, "-1.0313"}, // empate exato: para longe do zero
		{1.005, 2, "1"}, {2.5, 0, "3"}, {um + dois, 2, "0.3"}, {123.456789, 4, "123.4568"},
		{-0.00001, 4, "0"}, {1e-7, 4, "0"}, {9.1234567, 6, "9.123457"},
	}
	for _, c := range casos {
		if j, _ := json.Marshal(fixo(c.x, c.casas)); string(j) != c.json {
			t.Errorf("fixo(%v, %d) = %s, esperava %s", c.x, c.casas, j, c.json)
		}
	}
}

// servidorEmSequencia responde um status por tentativa (o último se repete); 200 = {"ok":true}.
func servidorEmSequencia(t *testing.T, status []int, retryAfter string) (*httptest.Server, *int32) {
	var n int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		i := int(atomic.AddInt32(&n, 1)) - 1
		st := status[min(i, len(status)-1)]
		if st == 429 && retryAfter != "" {
			w.Header().Set("Retry-After", retryAfter)
		}
		if st == 302 {
			w.Header().Set("Location", "/outro") // seguido, contaria uma chamada a mais
		}
		w.WriteHeader(st)
		if st == 200 {
			io.WriteString(w, `{"ok":true}`)
		}
	}))
	t.Cleanup(srv.Close)
	return srv, &n
}

func TestNovaTentativa(t *testing.T) {
	ms := time.Millisecond
	casos := []struct {
		nome     string
		status   []int
		retry    string
		chamadas int
		pausas   []time.Duration
		erro     string // "" = deu certo
	}{
		{"503 503 200", []int{503, 503, 200}, "", 3, []time.Duration{600 * ms, 1200 * ms}, ""},
		{"429 com Retry-After 2", []int{429, 200}, "2", 2, []time.Duration{2 * time.Second}, ""},
		{"Retry-After menor que a espera própria", []int{429, 200}, "0.1", 2, []time.Duration{600 * ms}, ""},
		{"404 é resposta", []int{404}, "", 1, nil,
			"Não consegui falar com o OpenAI agora (o OpenAI respondeu, e a resposta é essa). Tentei 1 vez. Tente de novo em instantes; se continuar, o OpenAI está fora do ar."},
		{"401 é resposta", []int{401}, "", 1, nil, "(o OpenAI respondeu, e a resposta é essa)"},
		{"500 até desistir", []int{500}, "", 3, []time.Duration{600 * ms, 1200 * ms}, "(já tentei 3 vezes). Tentei 3 vezes."},
		{"429 pedindo 15 s não cabe no orçamento", []int{429}, "15", 1, nil, "(não caberia outra tentativa no tempo desta chamada)"},
		{"302 não é seguido nem repetido", []int{302}, "", 1, nil, "(o OpenAI respondeu, e a resposta é essa)"},
	}
	for _, c := range casos {
		srv, n := servidorEmSequencia(t, c.status, c.retry)
		var pausas []time.Duration
		var destino struct {
			Ok bool `json:"ok"`
		}
		err := clienteDeTeste(&pausas).getJSON(context.Background(), srv.URL, "teste", &destino)
		switch {
		case c.erro == "" && (err != nil || !destino.Ok):
			t.Errorf("%s: %v", c.nome, err)
		case c.erro != "" && (err == nil || !strings.Contains(err.Error(), c.erro)):
			t.Errorf("%s: erro = %v, esperava conter %q", c.nome, err, c.erro)
		}
		if got := int(atomic.LoadInt32(n)); got != c.chamadas || !slices.Equal(pausas, c.pausas) {
			t.Errorf("%s: %d chamadas e pausas %v, esperava %d e %v", c.nome, got, pausas, c.chamadas, c.pausas)
		}
	}
}

func TestNaoSegueRedirecionamento(t *testing.T) {
	var outro int32
	destino := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { atomic.AddInt32(&outro, 1) }))
	defer destino.Close()
	origem := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, destino.URL+"/roubar", http.StatusFound)
	}))
	defer origem.Close()
	var pausas []time.Duration
	err := clienteDeTeste(&pausas).getJSON(context.Background(), origem.URL, "teste", &struct{}{})
	if n := atomic.LoadInt32(&outro); err == nil || n != 0 {
		t.Fatalf("redirecionamento seguido (outro host recebeu %d) ou aceito: %v", n, err)
	}
}

func TestPrazoPorTentativa(t *testing.T) {
	var n int32
	srv := httptest.NewServer(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&n, 1)
		<-r.Context().Done() // nunca responde: só o prazo da tentativa solta
	}))
	defer srv.Close()
	var pausas []time.Duration
	c := clienteDeTeste(&pausas)
	c.prazo, c.orcamento = 50*time.Millisecond, 10*time.Second
	err := c.getJSON(context.Background(), srv.URL, "teste", &struct{}{})
	if got := atomic.LoadInt32(&n); err == nil || !strings.Contains(err.Error(), "(já tentei 3 vezes)") || got != 3 {
		t.Fatalf("%d tentativas, erro %v", got, err)
	}
}

func TestChaveNuncaSaiNoErroNemNoLog(t *testing.T) {
	var log bytes.Buffer
	antes := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(&log, nil)))
	defer slog.SetDefault(antes)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer "+chaveFalsa {
			t.Error("a chave não foi no cabeçalho")
		}
		w.WriteHeader(401)
		io.WriteString(w, strings.Repeat("x", 190)+chaveFalsa) // atravessa o corte de 200: mascarar ANTES de cortar
	}))
	defer srv.Close()
	var pausas []time.Duration
	err := clienteDeTeste(&pausas).getJSON(context.Background(), srv.URL, "teste", &struct{}{})
	if err == nil {
		t.Fatal("401 aceito")
	}
	for _, onde := range []string{err.Error(), log.String()} {
		if strings.Contains(onde, chaveFalsa[:10]) {
			t.Errorf("a chave (ou o começo dela) vazou: %s", onde)
		}
	}
	if !strings.Contains(log.String(), "status=401") {
		t.Errorf("o log precisa dizer o status: %s", log.String())
	}
	rt := Rota{Chave: chaveFalsa, Buscar: func(context.Context, string, Janela) (Fatura, error) {
		return Fatura{}, errors.New("eco " + chaveFalsa)
	}}
	if w := pedir(rt, admin, `{}`); w.Code != 500 || strings.Contains(w.Body.String(), chaveFalsa) {
		t.Errorf("rota = %d %s", w.Code, w.Body)
	}
}

func TestPaginasParaEm50(t *testing.T) {
	for _, c := range []struct {
		corpo    string
		chamadas int32
	}{
		{`{"data":[],"has_more":true,"next_page":"sempre"}`, 50},
		{`{"data":[],"has_more":true,"next_page":null}`, 1},
		{`{"data":[],"has_more":false,"next_page":"x"}`, 1},
	} {
		var mu sync.Mutex
		var paginas []string
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			mu.Lock()
			paginas = append(paginas, r.URL.Query().Get("page"))
			mu.Unlock()
			io.WriteString(w, c.corpo)
		}))
		var pausas []time.Duration
		err := clienteDeTeste(&pausas).paginas(context.Background(), srv.URL, url.Values{"limit": {"31"}}, "teste", func(pagina) error { return nil })
		srv.Close()
		mu.Lock()
		n := int32(len(paginas))
		if err != nil || n != c.chamadas || paginas[0] != "" || (n > 1 && paginas[1] != "sempre") {
			t.Errorf("%s: %d chamadas %v (%v), esperava %d", c.corpo, n, paginas, err, c.chamadas)
		}
		mu.Unlock()
	}
}
```

- [ ] **Step 2: Rodar e ver falhar.** `go test ./internal/custo/ 2>&1 | tail -3` → FAIL de compilação (`undefined: Rota`).

- [ ] **Step 3: Implementar** `api/internal/custo/custo.go` (completo: chave de API e dinheiro):

```go
// Package custo é a fatura real das contas de IA, portada das edges custo-anthropic e custo-openai
// (supabase/functions/custo-*/index.ts): POST /custo-anthropic e POST /custo-openai, só para quem
// tem papel admin. A chave admin de cada fornecedor vem de variável de ambiente e nunca sai em log,
// erro ou resposta; as chamadas não seguem redirecionamento (o cabeçalho com a chave iria junto).
package custo

import (
	"cmp"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"maps"
	"math"
	"math/big"
	"net/http"
	"net/url"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/rbv-co/social-dashboard/api/internal/auth"
)

// Cambio: US$ → R$, o mesmo das edges e dos robôs (custo-anthropic/index.ts:17, custo-openai/index.ts:45).
const Cambio = 5.5

const isoSegundos = "2006-01-02T15:04:05Z"

// Janela é [Inicio, Fim) em UTC; Fim é a meia-noite UTC de amanhã (o dia de hoje entra inteiro).
type Janela struct{ Inicio, Fim time.Time }

// janelaDe é a régua das edges (custo-anthropic/index.ts:161-166): Math.min(90, Math.max(1, dias)).
func janelaDe(dias float64, agora time.Time) Janela {
	dias = math.Min(90, math.Max(1, dias))
	a := agora.UTC()
	fim := time.Date(a.Year(), a.Month(), a.Day()+1, 0, 0, 0, 0, time.UTC)
	return Janela{Inicio: fim.Add(-time.Duration(dias * float64(24*time.Hour))), Fim: fim}
}

type Dia struct {
	Data string  `json:"data"`
	Usd  float64 `json:"usd"`
}

type Categoria struct {
	Item string  `json:"item"`
	Usd  float64 `json:"usd"`
}

// Fatura é a resposta das edges, campo a campo e na mesma ordem.
type Fatura struct {
	Desde        string      `json:"desde"`
	Ate          string      `json:"ate"`
	Cambio       float64     `json:"cambio"`
	TotalUsd     float64     `json:"totalUsd"`
	TotalBrl     float64     `json:"totalBrl"`
	Dias         []Dia       `json:"dias"`
	PorCategoria []Categoria `json:"porCategoria"`
	PorChave     any         `json:"porChave"` // Anthropic: []ChaveRateada; OpenAI: []ChaveReal (nunca nil)
}

// novaFatura soma os dias NA ORDEM (o reduce das edges) e arredonda como o toFixed. Lista vazia sai
// [] (nunca null: a tela faz Array.isArray).
func novaFatura(j Janela, dias []Dia, cats []Categoria, porChave any) Fatura {
	soma := 0.0
	for _, d := range dias {
		soma += d.Usd
	}
	if dias == nil {
		dias = []Dia{}
	}
	if cats == nil {
		cats = []Categoria{}
	}
	return Fatura{Desde: j.Inicio.UTC().Format(time.DateOnly), Ate: j.Fim.UTC().Format(time.DateOnly), Cambio: Cambio,
		TotalUsd: fixo(soma, 4), TotalBrl: fixo(soma*Cambio, 2), Dias: dias, PorCategoria: cats, PorChave: porChave}
}

// fixo é o Number(x.toFixed(casas)) do JS: arredonda o valor EXATO do float (não o decimal que se lê),
// empate para longe do zero, e devolve o float mais próximo do decimal. Zero sai sem sinal (o JSON da
// edge escrevia 0, nunca -0). Ex.: 13.35*5.5 = 73.42499… → 73.42 (Math.round(x*100)/100 daria 73.43).
func fixo(x float64, casas int) float64 {
	if math.IsNaN(x) || math.IsInf(x, 0) {
		return x // não acontece (numero recusa); responder transforma em erro, nunca em null
	}
	esc := new(big.Int).Exp(big.NewInt(10), big.NewInt(int64(casas)), nil)
	r := new(big.Rat).SetFloat64(math.Abs(x))
	r.Mul(r, new(big.Rat).SetInt(esc)).Add(r, big.NewRat(1, 2))
	n := new(big.Int).Quo(r.Num(), r.Denom()) // piso (r ≥ 0)
	f, _ := new(big.Rat).SetFrac(n, esc).Float64()
	if f == 0 {
		return 0
	}
	return math.Copysign(f, x)
}

// numero é o Number(v ?? 0) do JS para o que as APIs mandam: número, texto numérico (o amount da
// Anthropic é texto decimal) ou nulo/ausente (= 0). Outra coisa é resposta inesperada — nunca NaN.
func numero(v any) (float64, error) {
	switch x := v.(type) {
	case nil:
		return 0, nil
	case float64:
		return x, nil
	case string:
		s := strings.TrimSpace(x)
		if s == "" {
			return 0, nil // Number("") = 0
		}
		if f, err := strconv.ParseFloat(s, 64); err == nil && !math.IsInf(f, 0) && !math.IsNaN(f) {
			return f, nil
		}
	}
	return 0, errors.New("número inválido")
}

// texto é o String(v) do JS para os nomes que as APIs mandam (nulo = "").
func texto(v any) string {
	switch x := v.(type) {
	case nil:
		return ""
	case string:
		return x
	}
	return fmt.Sprint(v)
}

// primeiros: os n primeiros caracteres (o .slice(0, n) das edges, para datas ISO).
func primeiros(s string, n int) string {
	if r := []rune(s); len(r) > n {
		return string(r[:n])
	}
	return s
}

func cortar(s string, n int) string { return primeiros(s, n) }

// somas acumula por nome na ordem em que o nome apareceu (a ordem do Object.entries das edges;
// ponytail: o JS põe antes as chaves que parecem inteiros, e nenhum nome destas APIs é assim).
type somas struct {
	nomes []string
	v     map[string]float64
}

func (s *somas) somar(nome string, x float64) {
	if s.v == nil {
		s.v = map[string]float64{}
	}
	if _, ok := s.v[nome]; !ok {
		s.nomes = append(s.nomes, nome)
	}
	s.v[nome] += x
}

// maiorPrimeiro ordena do maior valor para o menor; empate fica na ordem de chegada (o sort do JS é estável).
func maiorPrimeiro[T any](l []T, valor func(T) float64) {
	slices.SortStableFunc(l, func(a, b T) int { return cmp.Compare(valor(b), valor(a)) })
}

// cliente faz os GETs na API admin de UM fornecedor com a política de nova tentativa da edge
// custo-openai (_shared/tentar-de-novo.js:82-138).
type cliente struct {
	fornecedor       string // "Anthropic" | "OpenAI": entra nas frases e no log
	chave            string
	cabecalho        func(h http.Header, chave string)
	http             *http.Client
	prazo, orcamento time.Duration // por tentativa / pela chamada inteira
	pausa            func(context.Context, time.Duration) error
}

// semRedirecionar: 3xx volta como resposta (e vira erro); seguir levaria o cabeçalho com a chave
// a outro endereço (x-api-key é cabeçalho comum: o cliente do Go o repassaria).
var semRedirecionar = &http.Client{CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}

func esperar(ctx context.Context, d time.Duration) error {
	t := time.NewTimer(d)
	defer t.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-t.C:
		return nil
	}
}

func (c cliente) inesperada() error {
	return errors.New("Resposta inesperada do " + c.fornecedor + ".")
}

// getJSON busca endereco e decodifica a resposta 2xx em destino. O erro é a frase da edge para a
// pessoa: sem a chave, sem o endereço e sem o corpo do fornecedor (o corpo, com a chave mascarada
// e cortado, só vai para o log).
func (c cliente) getJSON(ctx context.Context, endereco, rotulo string, destino any) error {
	comecou := time.Now()
	for tentativa := 1; ; tentativa++ {
		status, retryAfter, corpo, err := c.uma(ctx, endereco)
		if err == nil && status >= 200 && status < 300 {
			if json.Unmarshal(corpo, destino) != nil {
				slog.Warn("custo: resposta fora do formato", "fornecedor", c.fornecedor, "rotulo", rotulo)
				return c.inesperada()
			}
			return nil
		}
		if err != nil {
			status = 0
			slog.Warn("custo: tentativa sem resposta", "fornecedor", c.fornecedor, "rotulo", rotulo, "tentativa", tentativa,
				"prazo", errors.Is(err, context.DeadlineExceeded))
		} else {
			slog.Warn("custo: tentativa recusada", "fornecedor", c.fornecedor, "rotulo", rotulo, "tentativa", tentativa, "status", status,
				"corpo", cortar(strings.ReplaceAll(string(corpo), c.chave, "***"), 200))
		}
		repetir, espera, motivo := decidir(c.fornecedor, tentativa, status, time.Since(comecou), retryAfter, c.prazo, c.orcamento)
		if !repetir {
			return errors.New(fraseDeDesistencia(motivo, tentativa, c.fornecedor))
		}
		if c.pausa(ctx, espera) != nil {
			return errors.New(fraseDeDesistencia("o prazo desta chamada acabou", tentativa, c.fornecedor))
		}
	}
}

// uma faz UMA tentativa com prazo próprio. status 0 = não houve resposta.
func (c cliente) uma(ctx context.Context, endereco string) (status int, retryAfter time.Duration, corpo []byte, err error) {
	ctx, cancela := context.WithTimeout(ctx, c.prazo)
	defer cancela()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endereco, nil)
	if err != nil {
		return 0, 0, nil, err
	}
	c.cabecalho(req.Header, c.chave)
	resp, err := c.http.Do(req)
	if err != nil {
		return 0, 0, nil, err
	}
	defer resp.Body.Close()
	if corpo, err = io.ReadAll(io.LimitReader(resp.Body, 10<<20)); err != nil {
		return 0, 0, nil, err
	}
	if s, e := strconv.ParseFloat(resp.Header.Get("Retry-After"), 64); e == nil && s > 0 {
		retryAfter = time.Duration(math.Min(s, 3600) * float64(time.Second))
	}
	return resp.StatusCode, retryAfter, corpo, nil
}

// decidir é o decidirRepeticao da edge (_shared/tentar-de-novo.js:82-128), com o prazo e o orçamento
// do fornecedor. ponytail: mesma política de core.decidir (Bling, não exportada); unificar no 3º uso.
func decidir(f string, tentativa, status int, decorrido, retryAfter, prazo, orcamento time.Duration) (bool, time.Duration, string) {
	if status != 0 && status != 429 && status < 500 {
		return false, 0, "o " + f + " respondeu, e a resposta é essa"
	}
	if tentativa >= 3 {
		return false, 0, "já tentei 3 vezes"
	}
	espera := (600 * time.Millisecond) << (tentativa - 1)
	if status == 429 && retryAfter > espera {
		espera = retryAfter
	}
	if decorrido+espera+prazo > orcamento {
		return false, 0, "não caberia outra tentativa no tempo desta chamada"
	}
	return true, espera, ""
}

// fraseDeDesistencia é a da edge (_shared/tentar-de-novo.js:133-137), palavra por palavra.
func fraseDeDesistencia(motivo string, tentativas int, f string) string {
	vez := "vezes"
	if tentativas == 1 {
		vez = "vez"
	}
	return fmt.Sprintf("Não consegui falar com o %s agora (%s). Tentei %d %s. Tente de novo em instantes; se continuar, o %s está fora do ar.",
		f, motivo, tentativas, vez, f)
}

// pagina é o envelope das duas APIs: {data: [{…, results: […]}], has_more, next_page}.
type pagina struct {
	Data []struct {
		StartingAt   any              `json:"starting_at"`    // Anthropic
		StartTime    any              `json:"start_time"`     // OpenAI (segundos Unix)
		StartTimeISO any              `json:"start_time_iso"` // OpenAI
		Results      []map[string]any `json:"results"`
	} `json:"data"`
	HasMore  bool    `json:"has_more"`
	NextPage *string `json:"next_page"`
}

// paginas busca endereco?q e segue next_page enquanto has_more, no máximo 50 páginas (a trava
// `while (page && ++guarda < 50)` das edges). Erro de `cada` = erro da busca inteira.
func (c cliente) paginas(ctx context.Context, endereco string, q url.Values, rotulo string, cada func(pagina) error) error {
	proxima := ""
	for range 50 {
		qp := maps.Clone(q)
		if qp == nil {
			qp = url.Values{}
		}
		if proxima != "" {
			qp.Set("page", proxima)
		}
		var p pagina
		if err := c.getJSON(ctx, endereco+"?"+qp.Encode(), rotulo, &p); err != nil {
			return err
		}
		if err := cada(p); err != nil {
			return err
		}
		if !p.HasMore || p.NextPage == nil || *p.NextPage == "" {
			return nil
		}
		proxima = *p.NextPage
	}
	return nil
}

// Rota é POST /custo-anthropic e POST /custo-openai com o contrato das edges.
type Rota struct {
	Chave  string // ANTHROPIC_ADMIN_KEY / OPENAI_ADMIN_KEY
	Buscar func(ctx context.Context, chave string, j Janela) (Fatura, error)
	Agora  func() time.Time // nil = time.Now (o teste fixa o relógio)
}

func (rt Rota) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	// O portão das edges (custo-anthropic/index.ts:150-153): profiles.role = 'admin', ANTES de ler o
	// corpo, a chave ou chamar o fornecedor. Super-admin pela ficha e claude.status NÃO abrem (Ruling 8).
	a := auth.AtorDoContexto(r.Context())
	if a == nil || a.Tipo != "painel" || a.Papel != "admin" {
		responder(w, http.StatusForbidden, erroDaEdge{Error: "sem_permissao"})
		return
	}
	var p struct {
		Dias *float64 `json:"dias"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4<<10)).Decode(&p); err != nil && !errors.Is(err, io.EOF) {
		responder(w, http.StatusBadRequest, erroDaEdge{Error: "pedido_invalido"})
		return
	}
	dias := 30.0
	if p.Dias != nil {
		dias = *p.Dias
	}
	if rt.Chave == "" {
		responder(w, http.StatusInternalServerError, erroDaEdge{"falha", "chave_admin_nao_configurada"})
		return
	}
	agora := time.Now
	if rt.Agora != nil {
		agora = rt.Agora
	}
	f, err := rt.Buscar(r.Context(), rt.Chave, janelaDe(dias, agora()))
	if err != nil {
		// a frase já vem sem a chave (getJSON); o ReplaceAll é a última barreira
		responder(w, http.StatusInternalServerError, erroDaEdge{"falha", strings.ReplaceAll(err.Error(), rt.Chave, "***")})
		return
	}
	responder(w, http.StatusOK, f)
}

// erroDaEdge é o corpo de erro das edges, com "error" antes de "detalhe" (um map sairia em ordem alfabética).
type erroDaEdge struct {
	Error   string `json:"error"`
	Detalhe string `json:"detalhe,omitempty"`
}

func responder(w http.ResponseWriter, status int, v any) {
	b, err := json.Marshal(v)
	if err != nil { // número não finito: erro, nunca null no lugar do valor
		status, b = http.StatusInternalServerError, []byte(`{"error":"falha","detalhe":"resposta inesperada do fornecedor"}`)
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	w.Write(b)
}
```

- [ ] **Step 4: Rodar e ver passar.** `gofmt -l ./internal/custo && go vet ./internal/custo/ && go test -count=1 -race -v ./internal/custo/ 2>&1 | grep -E '^(--- |ok|FAIL)'` → os 9 testes `PASS`.

- [ ] **Step 5: Commit.**
```bash
git add api/internal/custo/custo.go api/internal/custo/custo_test.go
git commit -m "feat(api): base da fatura de IA — portão admin, janela, toFixed do JS e cliente sem redirecionar (Plano 5.12)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---
### Task 4: `custo` — Anthropic

**Contrato** (`custo-anthropic/index.ts:35-137,168-185`; cabeçalhos `x-api-key: <chave>` e `anthropic-version: 2023-06-01`; prazo 15 s por tentativa, orçamento 30 s):
1. **Total (obrigatório; falhou = erro da rota):** `GET {Base}/v1/organizations/cost_report?starting_at=<Inicio ISO s/ms>&ending_at=<Fim>&bucket_width=1d&limit=31[&page=]`; por balde: `{data: starting_at[0:10], usd: (Σ Number(amount ?? 0)) / 100}` — **centavos**.
2. Depois do total, juntos, sem derrubar o total (falha de qualquer tipo = `[]`):
   - `porCategoria`: o mesmo relatório com `group_by[]=description`; nome = `description` ou `"<model ?? '?'> / <token_type ?? '?'>"`; soma de `amount/100` por nome; só `usd > 0`; maior primeiro (estável).
   - `porChave`: nomes de `GET {Base}/v1/organizations/api_keys?limit=100` (`name || id`; falha = sem nomes); uso de `GET {Base}/v1/organizations/usage_report/messages?…&group_by[]=api_key_id`; por `api_key_id || 'desconhecida'`: `tokensIn = uncached_input + cache_read_input + cache_creation_input`, `tokensOut = output_tokens`; `peso = in + out×5`; `usdEstimado = fixo(totalUsdBruto × peso / (Σpeso || 1), 4)`; só `in + out > 0`; maior `usdEstimado` primeiro.

**Testes de aceitação** (`api/internal/custo/anthropic_test.go`, API de mentira com `httptest` que confere chave, versão e a consulta em TODA chamada e conta chamadas por rota):
- `TestAnthropicFatura`: a fatura exata abaixo (vetores do Node 22 com as fórmulas da edge).
- `TestAnthropicDetalheQuebradoNaoDerrubaOTotal`: `group_by=description` → 503 sempre; uso → `output_tokens:"muitos"` → `"totalUsd":13.35` e `"porCategoria":[],"porChave":[]`.
- `TestAnthropicTotalQuebradoFalhaSemChamarOsDetalhes`: `cost_report` → 401 com a chave no corpo → erro = `Não consegui falar com o Anthropic agora (o Anthropic respondeu, e a resposta é essa). Tentei 1 vez. Tente de novo em instantes; se continuar, o Anthropic está fora do ar.`; 0 chamadas a `description`, `api_keys` e `usage_report`.
- `TestAnthropicAmountQueNaoENumero`: `amount:"abc"` no total → `Resposta inesperada do Anthropic.`

**Arquivos:** criar `api/internal/custo/anthropic.go`, `api/internal/custo/anthropic_test.go`.

**Dependências:** Task 3.

- [ ] **Step 1: Testes que falham.** Em `anthropic_test.go`, a API de mentira e o teste principal (os outros três seguem o mesmo molde, trocando a rota em `mudar`):

```go
// apiAnthropicFalsa responde como a API admin; `mudar` troca o handler de uma rota
// ("<caminho>" ou "<caminho>?<group_by>"). Devolve o servidor e um contador de chamadas por rota.
func apiAnthropicFalsa(t *testing.T, mudar map[string]http.HandlerFunc) (*httptest.Server, func(string) int) {
	t.Helper()
	var mu sync.Mutex
	hits := map[string]int{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("x-api-key") != chaveFalsa || r.Header.Get("anthropic-version") != "2023-06-01" {
			t.Errorf("%s sem a chave ou a versão", r.URL.Path)
		}
		q := r.URL.Query()
		rota := r.URL.Path
		if g := q.Get("group_by[]"); g != "" {
			rota += "?" + g
		}
		mu.Lock()
		hits[rota]++
		mu.Unlock()
		if h := mudar[rota]; h != nil {
			h(w, r)
			return
		}
		if r.URL.Path != "/v1/organizations/api_keys" && (q.Get("starting_at") != "2026-09-13T00:00:00Z" ||
			q.Get("ending_at") != "2026-10-13T00:00:00Z" || q.Get("bucket_width") != "1d" || q.Get("limit") != "31") {
			t.Errorf("%s: consulta errada %s", rota, r.URL.RawQuery)
		}
		switch rota {
		case "/v1/organizations/cost_report":
			switch q.Get("page") {
			case "":
				io.WriteString(w, `{"data":[{"starting_at":"2026-10-10T00:00:00Z","results":[{"amount":"1234.5"},{"amount":"0.5"}]}],"has_more":true,"next_page":"p2"}`)
			case "p2":
				io.WriteString(w, `{"data":[{"starting_at":"2026-10-11T00:00:00Z","results":[{"amount":"100"},{"amount":null}]}],"has_more":false,"next_page":null}`)
			default:
				t.Errorf("página inesperada %q", q.Get("page"))
			}
		case "/v1/organizations/cost_report?description":
			io.WriteString(w, `{"data":[{"results":[{"description":"Claude Opus 4.8 Usage - Input Tokens","amount":"1000"},`+
				`{"description":null,"model":"claude-haiku","token_type":"output","amount":"30"},{"description":"Web Search","amount":"0"}]}],"has_more":false}`)
		case "/v1/organizations/api_keys":
			if q.Get("limit") != "100" {
				t.Errorf("api_keys sem limit=100: %s", r.URL.RawQuery)
			}
			io.WriteString(w, `{"data":[{"id":"apikey_a","name":"gestortrafego"},{"id":"apikey_b","name":""}]}`)
		case "/v1/organizations/usage_report/messages?api_key_id":
			io.WriteString(w, `{"data":[{"results":[`+
				`{"api_key_id":"apikey_a","uncached_input_tokens":1000,"cache_read_input_tokens":500,"cache_creation_input_tokens":0,"output_tokens":100},`+
				`{"api_key_id":"apikey_b","uncached_input_tokens":3000,"output_tokens":0},`+
				`{"api_key_id":null,"uncached_input_tokens":0,"output_tokens":0}]}],"has_more":false}`)
		default:
			t.Errorf("rota inesperada %s", rota)
			w.WriteHeader(404)
		}
	}))
	t.Cleanup(srv.Close)
	return srv, func(rota string) int { mu.Lock(); defer mu.Unlock(); return hits[rota] }
}

func TestAnthropicFatura(t *testing.T) {
	if (Anthropic{}).cliente("k").http != semRedirecionar {
		t.Fatal("sem HTTP próprio, a Anthropic tem de usar semRedirecionar")
	}
	srv, _ := apiAnthropicFalsa(t, nil)
	f, err := Anthropic{Base: srv.URL, Pausa: semEspera}.Buscar(context.Background(), chaveFalsa, janelaDeTeste)
	if err != nil {
		t.Fatal(err)
	}
	b, _ := json.Marshal(f)
	// Node 22 com as fórmulas de custo-anthropic/index.ts: CENTAVOS/100; totalBrl = Number((13.35*5.5).toFixed(2)) = 73.42;
	// rateio: pesos 1500+100×5 = 2000 e 3000 → 13.35×2000/5000 = 5.34 e 13.35×3000/5000 = 8.01; "" no nome cai no id.
	quer := `{"desde":"2026-09-13","ate":"2026-10-13","cambio":5.5,"totalUsd":13.35,"totalBrl":73.42,` +
		`"dias":[{"data":"2026-10-10","usd":12.35},{"data":"2026-10-11","usd":1}],` +
		`"porCategoria":[{"item":"Claude Opus 4.8 Usage - Input Tokens","usd":10},{"item":"claude-haiku / output","usd":0.3}],` +
		`"porChave":[{"nome":"apikey_b","tokensIn":3000,"tokensOut":0,"usdEstimado":8.01},{"nome":"gestortrafego","tokensIn":1500,"tokensOut":100,"usdEstimado":5.34}]}`
	if string(b) != quer {
		t.Fatalf("fatura =\n%s\nesperava\n%s", b, quer)
	}
}
```

- [ ] **Step 2: Rodar e ver falhar.** `go test ./internal/custo/ -run Anthropic 2>&1 | tail -3` → FAIL (`undefined: Anthropic`).

- [ ] **Step 3: Implementar** `api/internal/custo/anthropic.go` (completo: dinheiro e chave):

```go
package custo

import (
	"cmp"
	"context"
	"fmt"
	"maps"
	"net/http"
	"net/url"
	"sync"
	"time"
)

// Anthropic é a API admin da Anthropic (custo-anthropic/index.ts): Cost Report, com o amount em
// CENTAVOS de dólar (texto decimal), e Usage Report por chave de API.
type Anthropic struct {
	Base  string                                     // vazio = https://api.anthropic.com
	HTTP  *http.Client                               // nil = semRedirecionar
	Pausa func(context.Context, time.Duration) error // nil = esperar
}

// ChaveRateada: o uso de uma chave e o custo REAL total rateado pelo uso (entrada×1 + saída×5). A
// Anthropic não dá custo por chave: é estimativa, e a tela diz isso (index.ts:91-94).
type ChaveRateada struct {
	Nome        string  `json:"nome"`
	TokensIn    float64 `json:"tokensIn"`
	TokensOut   float64 `json:"tokensOut"`
	UsdEstimado float64 `json:"usdEstimado"`
}

func (a Anthropic) base() string { return cmp.Or(a.Base, "https://api.anthropic.com") }

func (a Anthropic) cliente(chave string) cliente {
	pausa := a.Pausa
	if pausa == nil {
		pausa = esperar
	}
	return cliente{fornecedor: "Anthropic", chave: chave, http: cmp.Or(a.HTTP, semRedirecionar), pausa: pausa,
		prazo: 15 * time.Second, orcamento: 30 * time.Second,
		cabecalho: func(h http.Header, k string) { h.Set("x-api-key", k); h.Set("anthropic-version", "2023-06-01") }}
}

// Buscar: o total por dia (obrigatório) e, depois, os dois detalhamentos juntos (index.ts:168-174).
func (a Anthropic) Buscar(ctx context.Context, chave string, j Janela) (Fatura, error) {
	c := a.cliente(chave)
	base := url.Values{"starting_at": {j.Inicio.UTC().Format(isoSegundos)}, "ending_at": {j.Fim.UTC().Format(isoSegundos)},
		"bucket_width": {"1d"}, "limit": {"31"}}
	dias := []Dia{}
	err := c.paginas(ctx, a.base()+"/v1/organizations/cost_report", base, "custos/total", func(p pagina) error {
		for _, b := range p.Data {
			centavos := 0.0
			for _, x := range b.Results {
				v, err := numero(x["amount"])
				if err != nil {
					return c.inesperada()
				}
				centavos += v
			}
			dias = append(dias, Dia{Data: primeiros(texto(b.StartingAt), 10), Usd: centavos / 100})
		}
		return nil
	})
	if err != nil {
		return Fatura{}, err
	}
	soma := 0.0
	for _, d := range dias {
		soma += d.Usd
	}
	var cats []Categoria
	var chaves []ChaveRateada
	var wg sync.WaitGroup
	wg.Add(2)
	go func() { defer wg.Done(); cats = a.porCategoria(ctx, c, base) }()
	go func() { defer wg.Done(); chaves = a.porChave(ctx, c, base, soma) }()
	wg.Wait()
	return novaFatura(j, dias, cats, chaves), nil
}

// porCategoria é o extrato REAL por descrição (index.ts:66-89); qualquer falha = [].
func (a Anthropic) porCategoria(ctx context.Context, c cliente, base url.Values) []Categoria {
	q := maps.Clone(base)
	q.Add("group_by[]", "description")
	var acc somas
	err := c.paginas(ctx, a.base()+"/v1/organizations/cost_report", q, "custos/descricao", func(p pagina) error {
		for _, b := range p.Data {
			for _, x := range b.Results {
				v, err := numero(x["amount"])
				if err != nil {
					return err
				}
				nome := texto(x["description"])
				if nome == "" {
					nome = fmt.Sprintf("%s / %s", ouInterrogacao(x["model"]), ouInterrogacao(x["token_type"]))
				}
				acc.somar(nome, v/100)
			}
		}
		return nil
	})
	out := []Categoria{}
	if err != nil {
		return out
	}
	for _, nome := range acc.nomes {
		if v := acc.v[nome]; v > 0 {
			out = append(out, Categoria{Item: nome, Usd: v})
		}
	}
	maiorPrimeiro(out, func(x Categoria) float64 { return x.Usd })
	return out
}

func ouInterrogacao(v any) string {
	if v == nil {
		return "?"
	}
	return texto(v)
}

// porChave rateia o custo real pelo uso de cada chave (index.ts:95-137); qualquer falha do uso = [].
func (a Anthropic) porChave(ctx context.Context, c cliente, base url.Values, totalUsd float64) []ChaveRateada {
	nomes := map[string]string{}
	var k struct {
		Data []struct {
			ID   string `json:"id"`
			Name string `json:"name"`
		} `json:"data"`
	}
	if c.getJSON(ctx, a.base()+"/v1/organizations/api_keys?limit=100", "chaves", &k) == nil {
		for _, x := range k.Data {
			nomes[x.ID] = cmp.Or(x.Name, x.ID)
		}
	}
	q := maps.Clone(base)
	q.Add("group_by[]", "api_key_id")
	var in, out somas
	err := c.paginas(ctx, a.base()+"/v1/organizations/usage_report/messages", q, "uso/chave", func(p pagina) error {
		for _, b := range p.Data {
			for _, x := range b.Results {
				id := texto(x["api_key_id"])
				if id == "" {
					id = "desconhecida"
				}
				i := 0.0
				for _, campo := range []string{"uncached_input_tokens", "cache_read_input_tokens", "cache_creation_input_tokens"} {
					v, err := numero(x[campo])
					if err != nil {
						return err
					}
					i += v
				}
				o, err := numero(x["output_tokens"])
				if err != nil {
					return err
				}
				in.somar(id, i)
				out.somar(id, o)
			}
		}
		return nil
	})
	l := []ChaveRateada{}
	if err != nil {
		return l
	}
	pesos := make([]float64, len(in.nomes))
	somaPeso := 0.0
	for n, id := range in.nomes {
		pesos[n] = in.v[id] + out.v[id]*5
		somaPeso += pesos[n]
	}
	if somaPeso == 0 {
		somaPeso = 1
	}
	for n, id := range in.nomes {
		if ti, to := in.v[id], out.v[id]; ti+to > 0 {
			l = append(l, ChaveRateada{Nome: cmp.Or(nomes[id], id), TokensIn: ti, TokensOut: to, UsdEstimado: fixo(totalUsd*pesos[n]/somaPeso, 4)})
		}
	}
	maiorPrimeiro(l, func(x ChaveRateada) float64 { return x.UsdEstimado })
	return l
}
```

- [ ] **Step 4: Rodar e ver passar.** `gofmt -l ./internal/custo && go vet ./internal/custo/ && go test -count=1 -race -v ./internal/custo/ -run Anthropic 2>&1 | grep -E '^(--- |ok|FAIL)'` → os 4 `PASS`.

- [ ] **Step 5: Commit.**
```bash
git add api/internal/custo/anthropic.go api/internal/custo/anthropic_test.go
git commit -m "feat(api): fatura real da Anthropic (centavos, extrato por descrição e rateio por chave) (Plano 5.12)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---
### Task 5: `custo` — OpenAI

**Contrato** (`custo-openai/index.ts:128-262`; cabeçalho `Authorization: Bearer <chave>`; prazo 8 s por tentativa, orçamento 20 s, os da edge):
- Quatro buscas juntas; só o total derruba a rota:
  - total: `GET {Base}/costs?start_time=<Inicio unix>&end_time=<Fim unix>&bucket_width=1d&limit=180[&page=]`; data do balde = `start_time_iso[0:10]` ou, sem ele, a data UTC de `start_time`; `usd = Σ Number(amount.value ?? 0)` — **dólares, sem dividir por 100**.
  - `porCategoria`: `group_by[]=line_item`; nome = `line_item` (nulo = `(sem nome)`); `usd = fixo(soma, 6)`; só `> 0`; maior primeiro.
  - `porChave`: `group_by[]=api_key_id`; `{nome: nomes[id] || id, usd: fixo(soma, 6)}`; só `> 0`; maior primeiro.
  - nomes: `GET {Base}/projects?limit=50`, e por projeto com `id`, em paralelo, `GET {Base}/projects/<id com PathEscape>/api_keys?limit=100` (`name || id`); falha do projeto = sem nomes daquele; falha da lista = sem nomes.

**Testes de aceitação** (`api/internal/custo/openai_test.go`, API de mentira que confere `Authorization`, a consulta e o caminho ESCAPADO):
- `TestOpenAIFatura`: `(OpenAI{}).cliente("k").http == semRedirecionar`; e a fatura exata abaixo. Semente: total página 1 `{"start_time":1791590400,"start_time_iso":"2026-10-10T00:00:00+00:00","results":[{"amount":{"value":12.34}},{"amount":{"value":0.66}}]}` com `next_page:"pg2"`, página 2 `{"start_time":1791676800,"results":[{"amount":null}]}`; `line_item` = `gpt-image-2-2026-04-21 image, output` 9.1234567 e `null` 0.0000004; `api_key_id` = `key_1` 3, `key_2` 10; projetos `proj_1` (chave `key_1` = `FabricadeAnuncios`), `proj/../x` (o servidor só responde em `/projects/proj%2F..%2Fx/api_keys`, e com 500) e um sem `id`. Consulta esperada: `start_time=1789257600`, `end_time=1791849600`, `bucket_width=1d`, `limit=180`.
  ```
  {"desde":"2026-09-13","ate":"2026-10-13","cambio":5.5,"totalUsd":13,"totalBrl":71.5,"dias":[{"data":"2026-10-10","usd":13},{"data":"2026-10-11","usd":0}],"porCategoria":[{"item":"gpt-image-2-2026-04-21 image, output","usd":9.123457}],"porChave":[{"nome":"key_2","usd":10},{"nome":"FabricadeAnuncios","usd":3}]}
  ```
- `TestOpenAIDetalheQuebradoNaoDerrubaOTotal`: `line_item` → 400 → `"porCategoria":[]`, total 13.
- `TestOpenAITotalQuebradoE500`: total → 503 sempre → erro contém `(já tentei 3 vezes)`.
- `TestOpenAINomesFalhamSemDerrubar`: `/projects` → 500 → `"porChave":[{"nome":"key_2","usd":10},{"nome":"key_1","usd":3}]`.

**Arquivos:** criar `api/internal/custo/openai.go`, `api/internal/custo/openai_test.go`.

**Dependências:** Task 3; depois da Task 4 (mesmo pacote: dois implementadores no mesmo pacote quebram a compilação um do outro).

- [ ] **Step 1: Testes que falham.** `openai_test.go` no molde de `apiAnthropicFalsa` (Task 4): `apiOpenAIFalsa(t, mudar)` com a rota = `r.URL.EscapedPath()` (+ `?<group_by>`), conferindo `Authorization: Bearer `+`chaveFalsa` e a consulta; os 4 testes do contrato.
- [ ] **Step 2: Rodar e ver falhar.** `go test ./internal/custo/ -run OpenAI 2>&1 | tail -3` → FAIL (`undefined: OpenAI`).
- [ ] **Step 3: Implementar** `api/internal/custo/openai.go` (completo):

```go
package custo

import (
	"cmp"
	"context"
	"net/http"
	"net/url"
	"strconv"
	"sync"
	"time"
)

// OpenAI é a API admin da OpenAI (custo-openai/index.ts): Costs API com amount.value em DÓLARES
// (não divida por 100: index.ts:13-16) e custo REAL por chave de API.
type OpenAI struct {
	Base  string                                     // vazio = https://api.openai.com/v1/organization
	HTTP  *http.Client                               // nil = semRedirecionar
	Pausa func(context.Context, time.Duration) error // nil = esperar
}

// ChaveReal: o custo cobrado por chave (a OpenAI cobra separado: não é rateio).
type ChaveReal struct {
	Nome string  `json:"nome"`
	Usd  float64 `json:"usd"`
}

type balde struct {
	data    string
	results []map[string]any
}

func (o OpenAI) base() string { return cmp.Or(o.Base, "https://api.openai.com/v1/organization") }

func (o OpenAI) cliente(chave string) cliente {
	pausa := o.Pausa
	if pausa == nil {
		pausa = esperar
	}
	return cliente{fornecedor: "OpenAI", chave: chave, http: cmp.Or(o.HTTP, semRedirecionar), pausa: pausa,
		prazo: 8 * time.Second, orcamento: 20 * time.Second,
		cabecalho: func(h http.Header, k string) { h.Set("Authorization", "Bearer "+k) }}
}

// Buscar faz as quatro perguntas juntas; só o total derruba a resposta (index.ts:225-239).
func (o OpenAI) Buscar(ctx context.Context, chave string, j Janela) (Fatura, error) {
	c := o.cliente(chave)
	var (
		wg            sync.WaitGroup
		total         []balde
		errTotal      error
		linhas, porID somas
		nomes         map[string]string
	)
	wg.Add(4)
	go func() { defer wg.Done(); total, errTotal = o.varrer(ctx, c, j, "") }()
	go func() { defer wg.Done(); linhas = o.detalhe(ctx, c, j, "line_item") }()
	go func() { defer wg.Done(); porID = o.detalhe(ctx, c, j, "api_key_id") }()
	go func() { defer wg.Done(); nomes = o.nomesDasChaves(ctx, c) }()
	wg.Wait()
	if errTotal != nil {
		return Fatura{}, errTotal
	}
	dias := []Dia{}
	for _, b := range total {
		usd := 0.0
		for _, x := range b.results {
			v, err := valor(x)
			if err != nil {
				return Fatura{}, c.inesperada()
			}
			usd += v
		}
		dias = append(dias, Dia{Data: b.data, Usd: usd})
	}
	cats := []Categoria{}
	for _, k := range linhas.nomes {
		if v := fixo(linhas.v[k], 6); v > 0 {
			cats = append(cats, Categoria{Item: k, Usd: v})
		}
	}
	maiorPrimeiro(cats, func(x Categoria) float64 { return x.Usd })
	chaves := []ChaveReal{}
	for _, id := range porID.nomes {
		if v := fixo(porID.v[id], 6); v > 0 {
			chaves = append(chaves, ChaveReal{Nome: cmp.Or(nomes[id], id), Usd: v})
		}
	}
	maiorPrimeiro(chaves, func(x ChaveReal) float64 { return x.Usd })
	return novaFatura(j, dias, cats, chaves), nil
}

// varrer é uma varredura da Costs API em baldes de 1 dia (index.ts:128-148).
func (o OpenAI) varrer(ctx context.Context, c cliente, j Janela, agrupar string) ([]balde, error) {
	q := url.Values{"start_time": {strconv.FormatInt(j.Inicio.Unix(), 10)}, "end_time": {strconv.FormatInt(j.Fim.Unix(), 10)},
		"bucket_width": {"1d"}, "limit": {"180"}}
	rotulo := "custos/total"
	if agrupar != "" {
		q.Add("group_by[]", agrupar)
		rotulo = "custos/" + agrupar
	}
	var out []balde
	err := c.paginas(ctx, o.base()+"/costs", q, rotulo, func(p pagina) error {
		for _, b := range p.Data {
			d := primeiros(texto(b.StartTimeISO), 10)
			if d == "" && b.StartTime != nil {
				s, err := numero(b.StartTime)
				if err != nil {
					return c.inesperada()
				}
				d = time.UnixMilli(int64(s * 1000)).UTC().Format(time.DateOnly)
			}
			out = append(out, balde{data: d, results: b.Results})
		}
		return nil
	})
	return out, err
}

// detalhe soma o custo por <campo> (line_item | api_key_id); qualquer falha = vazio (index.ts:213-223).
func (o OpenAI) detalhe(ctx context.Context, c cliente, j Janela, campo string) somas {
	bs, err := o.varrer(ctx, c, j, campo)
	if err != nil {
		return somas{}
	}
	var acc somas
	for _, b := range bs {
		for _, x := range b.results {
			v, err := valor(x)
			if err != nil {
				return somas{}
			}
			nome := "(sem nome)"
			if x[campo] != nil {
				nome = texto(x[campo])
			}
			acc.somar(nome, v)
		}
	}
	return acc
}

// valor é o Number(x?.amount?.value ?? 0) da edge (index.ts:152): DÓLARES.
func valor(x map[string]any) (float64, error) {
	m, _ := x["amount"].(map[string]any)
	return numero(m["value"])
}

// nomesDasChaves troca key_… pelo nome da chave, perguntando os projetos de uma vez (index.ts:162-180).
func (o OpenAI) nomesDasChaves(ctx context.Context, c cliente) map[string]string {
	nomes := map[string]string{}
	var proj struct {
		Data []struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	if c.getJSON(ctx, o.base()+"/projects?limit=50", "projetos", &proj) != nil {
		return nomes // segue sem nome: o id ainda identifica
	}
	type chave struct {
		ID   string `json:"id"`
		Name string `json:"name"`
	}
	listas := make([][]chave, len(proj.Data))
	var wg sync.WaitGroup
	for i, p := range proj.Data {
		if p.ID == "" {
			continue
		}
		wg.Add(1)
		go func() {
			defer wg.Done()
			var k struct {
				Data []chave `json:"data"`
			}
			if c.getJSON(ctx, o.base()+"/projects/"+url.PathEscape(p.ID)+"/api_keys?limit=100", "chaves", &k) == nil {
				listas[i] = k.Data
			}
		}()
	}
	wg.Wait()
	for _, l := range listas {
		for _, k := range l {
			if k.ID != "" {
				nomes[k.ID] = cmp.Or(k.Name, k.ID)
			}
		}
	}
	return nomes
}
```

- [ ] **Step 4: Rodar e ver passar.** `gofmt -l ./internal/custo && go vet ./internal/custo/ && go test -count=1 -race -v ./internal/custo/ 2>&1 | grep -E '^(--- |ok|FAIL)'` → todos `PASS`.
- [ ] **Step 5: Commit.**
```bash
git add api/internal/custo/openai.go api/internal/custo/openai_test.go
git commit -m "feat(api): fatura real da OpenAI (dólares, extrato por linha e custo por chave) (Plano 5.12)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---
### Task 6: Montagem do custo, configuração das chaves e matriz pela montagem real

**Contrato:** `POST /custo-anthropic` e `POST /custo-openai` no grupo autenticado (`auth.Exigir`), FORA do grupo de domínio, com prazo de 90 s (`PrazoCusto`); `ANTHROPIC_ADMIN_KEY` e `OPENAI_ADMIN_KEY` (com `TrimSpace`) entram em `config.Config` e em `Segredos()`.

**Testes de aceitação:**
- `TestCustoPeloPortaoReal` (`web.Rotas`, `pessoasDosPaineis`), para as duas rotas: sem sessão → `401 {"error":"nao_autenticado"}`; `cliente` → `403 {"error":"sem_permissao"}`; `admin-desativado` → 401; `nenhum`, `status`, `super` → `403 {"error":"sem_permissao"}`; com `config.Config{}` (sem chave) o `admin` → `500 {"error":"falha","detalhe":"chave_admin_nao_configurada"}` (prova que passou do portão sem ir à rede); com as chaves preenchidas, os negados continuam 403 e nenhum corpo contém a chave.
- `TestPrazosPorRotaPelaMontagemReal`: `"POST /custo-anthropic": 90 * time.Second, "POST /custo-openai": 90 * time.Second` no mapa `quer`.
- `TestNenhumaRotaNovaFicaAberta` passa sem mudança (`nenhum` recebe 403).
- `TestCarregarChavesDeCusto` (`config_test.go`): `ANTHROPIC_ADMIN_KEY=" sk-ant-admin-falsa-123 "`, `OPENAI_ADMIN_KEY="sk-admin-falsa-456"` → campos sem espaços e os dois em `Segredos()`.

**Arquivos:** alterar `api/internal/config/config.go`, `api/internal/config/config_test.go`, `api/internal/web/rotas.go`, `api/internal/web/rotas_test.go`; criar `api/internal/web/custo_test.go`.

**Dependências:** Tasks 2 (mesmos arquivos de `web`), 4 e 5. **opus** revisa: rota fora do grupo autenticado, portão e segredo novo.

- [ ] **Step 1: Testes que falham** (contrato acima; `postarCusto(h, rota, corpo, tok) (int, string)` no molde de `lerDosPaineis`).
- [ ] **Step 2: Rodar e ver falhar.** `go test ./internal/config/ ./internal/web/ 2>&1 | tail -4` → FAIL (`c.AnthropicAdmin undefined`; 404 nas rotas).
- [ ] **Step 3: Implementar.**
  `config.go`, no fim da struct `Config`:
  ```go

	// Plano 5.12 (fatura real das contas de IA). Vazia = a rota responde 500 chave_admin_nao_configurada.
	AnthropicAdmin string // ANTHROPIC_ADMIN_KEY: chave ADMIN da organização (Cost/Usage Report)
	OpenAIAdmin    string // OPENAI_ADMIN_KEY: chave ADMIN da organização (Costs API, projetos)
  ```
  em `Segredos()`, acrescente `c.AnthropicAdmin, c.OpenAIAdmin` à lista literal (depois de `c.ZeptoToken`); em `Carregar`, no literal: `AnthropicAdmin: strings.TrimSpace(os.Getenv("ANTHROPIC_ADMIN_KEY")), OpenAIAdmin: strings.TrimSpace(os.Getenv("OPENAI_ADMIN_KEY")),`.
  `rotas.go`: import `custo` (ordem alfabética); no bloco `const`, `PrazoCusto = 90 * time.Second // custo-*: a Anthropic chegou a 18 s (cache-de-custo.js:13-15); 90 dias = 3 páginas em série`; no grupo autenticado, logo ANTES do comentário `// Plano 5: rotas de DOMÍNIO`:
  ```go
		// Plano 5.12: a fatura real das contas de IA. Portão da edge (papel admin) DENTRO do handler,
		// antes de ler o corpo, a chave ou chamar o fornecedor.
		r.With(comPrazo(PrazoCusto)).Post("/custo-anthropic", custo.Rota{Chave: cfg.AnthropicAdmin, Buscar: custo.Anthropic{}.Buscar}.ServeHTTP)
		r.With(comPrazo(PrazoCusto)).Post("/custo-openai", custo.Rota{Chave: cfg.OpenAIAdmin, Buscar: custo.OpenAI{}.Buscar}.ServeHTTP)
  ```
  Rode `gofmt -w ./internal`.
- [ ] **Step 4: Rodar e ver passar.** `gofmt -l . && go vet ./... && go test -count=1 -race ./... 2>&1 | grep -v goose | grep -E '^(ok|FAIL|---)'` → todos `ok`.
- [ ] **Step 5: Commit.**
```bash
git add api/internal/config/ api/internal/web/rotas.go api/internal/web/rotas_test.go api/internal/web/custo_test.go
git commit -m "feat(api): monta custo-anthropic e custo-openai com o portão da edge e as chaves em variável de ambiente (Plano 5.12)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---
### Task 7: `conferir` e notas de implantação

**Contrato:** `api worker conferir` passa a cobrar, no banco restaurado, as colunas que filtros e ordens do 5.12 usam; `NOTAS-DA-IMPLANTACAO.md` ganha a seção do 5.12.

**Testes de aceitação:** `TestConferirSchemaVazioListaEmOrdem` passa a exigir também `"coluna noticias_concorrentes.rodada"` e `"coluna robos_saude.critico"`; `TestConferirSchemaCompletoConfere` e `TestConferirSchemaTudoTextoFalhaPeloTipo` continuam passando (o esquema deles nasce dos mapas).

**Arquivos:** alterar `api/cmd/api/conferir.go`, `api/cmd/api/conferir_test.go`, `docs/migracao-go/NOTAS-DA-IMPLANTACAO.md`.

**Dependências:** 5.0 (independe das outras tasks; nomes de rota e variável fixados neste plano).

- [ ] **Step 1: Teste que falha.** Em `TestConferirSchemaVazioListaEmOrdem`, acrescente os dois itens à lista `quer`. `go test ./cmd/api/ -run TestConferirSchemaVazio 2>&1 | tail -2` → FAIL.
- [ ] **Step 2: Implementar.** Em `colunasDoWorker`, depois da linha de `robos_execucoes`:
  ```go
	"noticias_concorrentes":     "id,rodada,destaque,created_at", // Plano 5.12: filtro e ordem das leituras
	"noticias_panorama":         "rodada,conteudo_md,modelo,created_at",
	"ia_execucoes":              "id,run_at",
	"robos_saude":               "robo,critico", // visão (relkind 'v'): ordem da leitura
  ```
  Em `tiposDoWorker`: `"noticias_concorrentes.rodada": "date", "noticias_panorama.rodada": "date",` (o filtro faz `@rodada::date[]`). `gofmt -w ./cmd`.
  Em `docs/migracao-go/NOTAS-DA-IMPLANTACAO.md`, acrescente ao fim:

```markdown
## Plano 5.12 — painéis pequenos (notícias, status da IA, fatura das contas de IA)

### Variáveis de ambiente (serviço `api`)
| Variável | Observação |
|---|---|
| `ANTHROPIC_ADMIN_KEY` | chave ADMIN da organização Anthropic (Cost/Usage Report). Segredo (`Segredos()`). Vazia = `POST /custo-anthropic` responde 500 `chave_admin_nao_configurada` |
| `OPENAI_ADMIN_KEY` | chave ADMIN da organização OpenAI (Costs API, projetos, chaves). Idem para `POST /custo-openai` |

Hoje as duas estão em `segredos_de_cron` (`anthropic_admin_key`, `openai_admin_key`). Spec §6: o conteúdo é ROTACIONADO, não copiado — gerar chaves admin novas nos consoles, pôr nas variáveis e, depois da virada, revogar as antigas.

### Rotas novas (com sessão)
- `GET /api/noticias/rodadas`, `GET /api/noticias/concorrentes?rodada=…`, `GET /api/noticias/panorama`, `GET /api/status-ia/execucoes`, `GET /api/status-ia/saude-dos-robos` (grupo de domínio; regra do catálogo).
- `POST /api/custo-anthropic`, `POST /api/custo-openai` (papel admin; prazo de 90 s — o `proxy_read_timeout` do nginx já fica acima, Plano 3). A VPS precisa de saída HTTPS para `api.anthropic.com` e `api.openai.com`.

### Achado para o dono (produção; o plano não mexe)
- A visão `robos_saude` provavelmente está SEM `security_invoker` desde `db/migrations/2026-09-22-vigia-dos-robos-cada-um-no-seu-teto.sql`: `create or replace view` zera a opção (conferido em Postgres 17) e a migração não a reaplicou. Sem ela a visão roda como o dono e ignora a RLS de `robos_esperados`/`robos_execucoes`: qualquer sessão — e a chave anon — lê a saúde dos robôs. Conferir no banco restaurado do ensaio: `select reloptions from pg_class where relname = 'robos_saude'` (vazio = sem a opção). A API já aplica a regra das duas tabelas; corrigir produção (`alter view public.robos_saude set (security_invoker = true)`) é decisão de quem cuida dela.

### Antes do corte
- `api worker conferir` cobra também `noticias_concorrentes`, `noticias_panorama`, `ia_execucoes` e a visão `robos_saude`.

### Mudanças de contrato que o Plano 7 absorve
- 6 sítios (plano 5.12, seção I.1): 3 leituras de notícias, 2 do status da IA e a chamada das duas edges de custo. A saúde vem `[]` para quem não tem admin, super-admin pela ficha ou `claude.status` em `features`. Não-2xx de `custo-*` agora traz corpo: `403 {"error":"sem_permissao"}`, `500 {"error":"falha","detalhe":…}`.
- Os logos de concorrentes (`tela-de-noticias.vue:99`, Storage `ig-cache`) são do Plano 6.
```

- [ ] **Step 3: Rodar e ver passar.** `go test -count=1 ./cmd/api/ 2>&1 | tail -2` → `ok`.
- [ ] **Step 4: Commit.**
```bash
git add api/cmd/api/conferir.go api/cmd/api/conferir_test.go docs/migracao-go/NOTAS-DA-IMPLANTACAO.md
git commit -m "feat(api): conferir cobra as colunas do 5.12 e notas de implantação dos painéis pequenos

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---
### Verificação final do 5.12

- [ ] `cd api && gofmt -l . && go vet ./...` → nada listado.
- [ ] `go test -count=1 -race ./...` → todos `ok`; `go test -count=1 -v ./... 2>&1 | grep -c -- '--- SKIP'` → `0`.
- [ ] `docker stop pg-p512`; sem outra sessão com o contêiner `pg-api-teste` (`docker ps | grep pg-api-teste` vazio): `make -C api teste PG_PORTA=58612` → todos `ok`.
- [ ] `grep -rn 'segredos_de_cron\|supabase\.co' api/internal --include='*.go' | grep -v _test.go` → nada.
- [ ] `git diff feat/api-go-dominios --stat -- supabase/ src/ coletor/ db/` → vazio.
- [ ] Revisão final do branch por um revisor **opus**, com foco em: o portão do custo vir antes de corpo/chave/rede; a chave nunca em log, erro, resposta ou redirecionamento; `fixo` e as somas iguais às edges; a regra da saúde (duas tabelas, só constante); nenhuma Consulta abrindo coluna/tabela além do declarado.

---
## V. Paralelização

**Dentro do 5.12** (uma worktree, implementadores sonnet; cada um faz `git add` só dos seus caminhos):

Regra: só andam juntas tasks cujos pacotes não se compilam um ao outro na mesma worktree (`custo` não é importado por ninguém até a Task 6; `cmd/api` importa `web`, que importa `paineis`).

| Onda | Tasks em paralelo | Arquivos de cada uma (disjuntos na onda) |
|---|---|---|
| A | 1, 3 | 1: `paineis/`, `testebanco/paineis.go`, `web/{rotas.go, rotas_test.go, paineis_test.go}` · 3: `custo/custo*.go` |
| B | 2, 4 | 2: `paineis/saude*.go`, `paineis/paineis.go`, `web/{saude_test.go, rotas_test.go}` · 4: `custo/anthropic*.go` |
| C | 5, 7 | 5: `custo/openai*.go` (mesmo pacote da 4: depois dela) · 7: `cmd/api/conferir*.go`, NOTAS (`web` já estável) |
| D | 6 | `config/`, `web/{rotas.go, rotas_test.go, custo_test.go}` |

- Revisores: opus nas Tasks 2–6, sonnet nas 1 e 7; cada revisão antes de começar a task que depende dela.
- Banco: um contêiner (`pg-p512`) basta para as tasks em paralelo — cada teste cria o próprio schema (`testebanco.Novo`). Cada implementador roda o seu pacote; a suíte inteira roda no fim de cada onda.

**Com os outros sub-planos:** o 5.12 depende só do 5.0 e anda em paralelo a qualquer 5.x. Pontos de conflito (resolver mantendo os dois lados): `web/rotas.go` (grupo de domínio e grupo autenticado), `web/rotas_test.go` (`soSessao`, mapa de prazos), `config/config.go` (campos e `Segredos()`), `cmd/api/conferir.go` (mapas), `NOTAS-DA-IMPLANTACAO.md` (seções no fim). Ajudantes de teste do pacote `web` têm o sufixo `DosPaineis`/`Custo` para não colidir com os de outros sub-planos. O 5.1 **não** monta rota para `ia_execucoes`, `robos_esperados`, `robos_execucoes`, `coletor_log`, `projetos_status` nem `gestor_log` (Ruling 4). `make teste` usa o contêiner fixo `pg-api-teste`: nunca em duas worktrees ao mesmo tempo.

---
## Rulings

1. Ruling: `robos_saude` é lida com a regra das DUAS tabelas de baixo (Ler de `robos_esperados` e de `robos_execucoes` no catálogo: conta ativa e papel admin, super-admin pela ficha ou `claude.status` em `features`), e não com `Autenticado` como diz a linha 5.12 da IV.2 do mestre — a visão foi criada com `security_invoker` ("OBRIGATÓRIO", `2026-07-31-saude-dos-robos.sql:193-198`, reaplicado em `2026-08-19-…:130-134`) e a `2026-09-22-…:58-124` a recriou com `create or replace` sem reaplicar, o que zera a opção (conferido no Postgres 17); o "o que a visão dá hoje" é, provavelmente, um acidente que abre a saúde a qualquer sessão e à chave anon, e o levantamento não captura `reloptions`; quem abre `/claude-status` passa — custo se errada: uma sessão sem `claude.status` que chame a API direto recebe `[]` (a tela nem a deixa entrar).
2. Ruling: a saúde é a visão do banco servida como está (`select s.* from robos_saude s`), sem reimplementar em Go o casamento por prefixo — o worker (Plano 4) grava `robos_execucoes` com nomes por variante (`coletar-dados-07h · <conta>`, `meta-hora-retentativa-00h`) e a visão decide de quem é cada execução (prefixo mais longo); uma segunda cópia da regra que já mentiu três vezes é pedir a quarta — custo se errada: nenhum (mudar a visão não muda a API).
3. Ruling: a rota da saúde só aceita regra POR PESSOA (Filtro constante `"true"`); regra que dependa da linha responde `[]`, e `TestRegraDaSaudeDosRobosEhPorPessoa` acusa a mudança do catálogo — a visão agrega as tabelas inteiras, não há linha onde aplicar condição — custo se errada: se o catálogo mudar a forma, a seção some até a rota ser reescrita (o teste falha antes do deploy).
4. Ruling: a leitura de `ia_execucoes` é do 5.12 (`GET /status-ia/execucoes`), não do 5.1 — a única tela que a lê é `claude-status` (`tela-de-status-claude.vue:703`; admin: 0), e assim o 5.12 depende só do 5.0, como diz a IV.3; `robos_esperados`, `robos_execucoes`, `coletor_log`, `projetos_status` e `gestor_log` não ganham rota em sub-plano nenhum (nenhuma tela as lê; só robôs gravam: Plano 7) — custo se errada: o 5.1 precisa ser avisado para não montar essas rotas.
5. Ruling: notícias são 3 `dados.Consulta` espelhando as 3 leituras da tela (rodadas distintas, notícias por rodadas, panorama), não uma rota que calcula "as 6 últimas edições" — filtro declarado não pode carregar subconsulta (o `Validar` só confere o `SQL`); cada leitura fica declarativa e com a regra do catálogo — custo se errada: duas idas ao servidor ao abrir a tela, como hoje.
6. Ruling: `n.*`/`x.*`/`s.*` nas leituras de `noticias_concorrentes`, `ia_execucoes` e `robos_saude`; o panorama traz só as 4 colunas que a tela pede — produção tem colunas além das migrations (`produtos`, `imagem_url`) e a tela pede `select=*`; nenhuma dessas tabelas tem dado pessoal — custo se errada: coluna nova aparece na resposta sem revisão (dado de concorrentes e de robôs).
7. Ruling: `noticias_panorama` não é servida sem sessão (policy `…_read_anon`) — Ruling 36 do mestre; nenhum consumidor anônimo achado (grep em `vessel-brasil`, `vessel`, `vessel-core-go`, `agenteia`, `n8n`: só cópias antigas deste repositório) — custo se errada: um consumidor externo ganha rota própria no Plano 7.
8. Ruling: portão de `custo-*` = o da edge, `profiles.role = 'admin'` exato (`Tipo = painel`, `Papel = admin`), conferido ANTES de ler o corpo, a chave ou chamar o fornecedor; super-admin pela ficha com outro papel e `claude.status` NÃO abrem; sessão "entrar como" um admin abre (o JWT do alvo abria) — "mesmas permissões de hoje" (`custo-anthropic/index.ts:150-153`, `custo-openai/index.ts:193-196`); quem só tem `claude.status` vê a tela com o erro da fatura, como hoje — custo se errada: abrir a fatura ao super-admin é uma linha, por decisão do dono.
9. Ruling: chaves admin em `ANTHROPIC_ADMIN_KEY`/`OPENAI_ADMIN_KEY` (em `Segredos()`), nunca de `segredos_de_cron`; ausente = `500 {"error":"falha","detalhe":"chave_admin_nao_configurada"}` (o texto da edge) — spec §6: o conteúdo é rotacionado, não copiado — custo se errada: na virada alguém gera chaves novas nos consoles (NOTAS).
10. Ruling: um cliente HTTP para os dois fornecedores, com a política de nova tentativa da `custo-openai` (429, 5xx e sem resposta até 3 vezes; 600/1200 ms ou o `Retry-After`; nunca começa tentativa que não cabe no orçamento), prazo/orçamento por tentativa Anthropic 15 s/30 s e OpenAI 8 s/20 s, rota com 90 s — a `custo-anthropic` não tinha nem prazo (7,2 s de média e 18,1 s no pior caso, `cache-de-custo.js:13-15`); relatório é GET, repetir não duplica nada — custo se errada: até 3× chamadas à API admin numa queda do fornecedor.
11. Ruling: as chamadas NÃO seguem redirecionamento, o corpo do fornecedor nunca vai à resposta (só ao log, com a chave mascarada ANTES do corte de 200 caracteres) e o `detalhe` do 500 é a frase fixa da edge (`fraseDeDesistencia`, agora também para a Anthropic, cuja edge devolvia `cost_report_http_<status>: <corpo>`) — `x-api-key` é cabeçalho comum que o cliente do Go repassaria num 3xx; e a tela hoje nem mostra o `detalhe` de um não-2xx (`functions.invoke` só diz "non-2xx") — custo se errada: diagnóstico pelo log, não pela tela.
12. Ruling: detalhamento (`porCategoria`, `porChave`) que falhar por QUALQUER motivo (HTTP, JSON, número) vira `[]` sem derrubar o total; o total que falhar é 500 — é a intenção escrita nas edges (`custo-anthropic/index.ts:78,116,170`; `custo-openai/index.ts:211-233`), que na Anthropic só engolia o `!r.ok` — custo se errada: nenhum.
13. Ruling: números como o JS — somas na mesma ordem e `Number(x.toFixed(n))` por `fixo` (valor exato do float, empate para longe do zero, sem `-0`); `amount` que não é número nem texto numérico é resposta inesperada (erro), não `NaN`→`null` — `13.35×5.5` dá `73.42` no JS e `73.43` com `Math.round(x*100)/100`; o `null` da edge virava "resposta sem valor" na tela — custo se errada: nenhum conhecido.
14. Ruling: corpo `{"dias": número|null}`; vazio/ausente = 30; fora de 1..90 é ajustado; texto ou outro tipo = `400 pedido_invalido` (a edge aceitava `"30"` e dava 500 com `"abc"`); campos a mais ignorados (como a edge); `?dias=` na query (a edge lia) não é portado — a tela manda sempre `{dias}` numérico (`tela-de-status-claude.vue:449`) — custo se errada: nenhum (o Plano 7 manda o corpo, como hoje).
15. Ruling: sem cache da fatura no servidor — a tela já guarda 10 min (`cache-de-custo.js`) e só admins chamam — custo se errada: cada abertura da tela = 2 chamadas por fornecedor, como hoje.
16. Ruling: o 5.12 não entrega nem depende do D0 — não tem gatilho nem RPC; a DDL dos testes é a das migrations (arquivo:linha) e a visão é o texto de `2026-09-22-…:58-124` (igual a `11-views.csv` de produção), lido do arquivo na hora do teste — custo se errada: coluna que só existe em produção não está no teste (as leituras com `*` passam o que houver; `conferir` cobra as que filtros e ordens usam).
17. Ruling: Início e Gestão interna não ganham rota — 0 acesso direto (grep); dependem só de `controle-de-login-e-usuario.js` (5.0 e Plano 7) — custo se errada: nenhum.
18. Ruling: sessão de cliente da Vessel recebe 403 em todas as rotas do 5.12 (o `auth.Exigir` do Plano 1), embora a policy `true` de `authenticated` deixasse um cliente logado no Supabase ler notícias e o diário de IA — negar por padrão; nenhum cliente usa essas leituras — custo se errada: nenhum.

## Cobertura e o que vem depois

**Coberto (linha 5.12 da IV.2 do mestre):**
- Notícias, leitura de `noticias_concorrentes` e `noticias_panorama` (2 tabelas, 3 policies; a de `anon` não é servida): Task 1.
- Status da IA: `ia_execucoes` (Task 1, Ruling 4) e a visão `robos_saude` com a regra das tabelas que o worker alimenta (Task 2, Rulings 1–3).
- `custo-anthropic` e `custo-openai` com o portão da edge e chave em variável de ambiente: Tasks 3–6.
- Início e Gestão interna conferidos: nada a portar (Ruling 17).
- Regras comuns da IV.1: matriz por papel pela montagem real, "negado não chama o fornecedor", `conferir` (Task 7), sítios do Plano 7 com arquivo:linha (I.1).

**Fica para depois:**
- **Plano 6:** os logos do Storage `ig-cache` (`tela-de-noticias.vue:99`).
- **Plano 7:** trocar os 6 sítios da I.1; os robôs do `coletor/` que gravam `noticias_*`, `ia_execucoes` e `robos_*` com a chave de serviço.
- **Plano 8 (virada):** gerar as chaves admin novas e revogar as de `segredos_de_cron`; rodar `api worker conferir` no banco restaurado; levar ao dono o achado do `security_invoker` de `robos_saude`.
