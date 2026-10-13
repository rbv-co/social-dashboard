# Sair do Supabase — Plano 5.6: Meta e redes (métricas)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **Execute na worktree `p5-56`** (branch `feat/api-go-plano-5-6`, empilhada sobre o PLANO do 5.2; antes da Task 1 ela recebe o 5.2 EXECUTADO, que já traz 5.0 e 5.1, ou o sub-plano executado mais recente da cadeia). As dependências de código são só 5.0, 5.1 e 5.2: roda **em paralelo com a execução de 5.3, 5.4 e 5.5** (pacotes e fatias D0 disjuntos; ver Paralelização). Faça `git add` só dos caminhos de cada task. Este plano contrata sobre as **interfaces** dos planos 5.0, 5.1, 5.2 e 3 (escritas neles), não sobre o código: o pré-voo confere que elas existem com esses nomes.

**Goal:** Trocar os 60 acessos vivos do front às 15 tabelas de métricas da Meta e das redes por 18 rotas da API em Go que decidem com as MESMAS regras das 39 policies de produção (15 restritivas `pode_ver_conta`), provar por varredura que nenhuma rota entrega linha ou contagem de conta fora de `allowed_accounts`, e fechar o Ruling 34: o `meta-proxy` e as 3 rotas ao vivo do Plano 3 passam a usar o MESMO escopo de contas, com o caminho da Graph ancorado na conta do pedido.

**Architecture:** Pacote novo `internal/redes`, montado no grupo de domínio do 5.0 (`auth.Exigir` → `autz.ComEscopo`). Leitura = `dados.Consulta` (regra de Ler do catálogo, inclusive a restritiva, no `WHERE` e na sombra de CTE; uma tabela por rota, sem junção). Escrita: `PATCH` de conta pelo caminho declarado do 5.1 (`dados.Tabela` + `RotaEditar`); metas e filtros de campanha por um upsert que reproduz o `INSERT … ON CONFLICT DO UPDATE` do PostgREST sob a RLS (`PodeCriar` + `EditarNova` na linha nova; Ler + Editar na existente), na transação de `banco.ComUsuario`. Fora das tabelas, `autz.PodeVerConta` (o mesmo predicado, provado contra a função de produção) vale no `meta-proxy` e em `insights-ao-vivo`/`serie-novos-dia`/`contar-collabs`. Testes contra a fatia 5.6 do D0 (tabelas reconstruídas; nenhum gatilho; `pode_ver_conta` verbatim).

**Tech Stack:** Go 1.26 (`go.mod`), `chi`, `pgx` v5, Postgres 17 (contêiner).

**Spec:** `docs/superpowers/specs/2026-10-09-sair-do-supabase-design.md` (§5 autorização, §11 segurança, §13 testes) e o plano-mestre `docs/superpowers/plans/2026-10-11-api-go-plano-5-dominios.md` (§II contrato, IV.1 regras de sub-plano, linha 5.6 da IV.2, Rulings 1–36, em especial o 34). Modelos e interfaces: `…-5-1-admin-equipes-acesso.md`, `…-5-2-patrimonio-cadastros.md`, `…-5-3-frota.md`, `…-5-4-acessos.md`; Plano 3 (`…-plano-3-edges-do-core.md`, Task 5 e o `meta-proxy`). Especificação das permissões: `docs/migracao-go/catalogo-policies-producao.json` — 39 policies nas 17 tabelas; a restritiva `so_contas_permitidas` (`pode_ver_conta(account_id[::text])`) está em 15; **`accounts` e `visitas_perfil_dia` NÃO a têm** (a linha 5.6 do mestre dizia "tudo com `pode_ver_conta`": achado nº 1).

## Global Constraints

- Nada em produção: sem `ssh`, sem credencial real, sem `push`. Postgres local descartável; segredos de teste inventados (`SEGREDO-…`).
- Regra de cada tabela = a do catálogo (`autz.Producao`), nunca reescrita à mão. Fora de tabela (proxy e rotas ao vivo), a regra é `autz.PodeVerConta`, conferida contra `pode_ver_conta` de produção. Divergência só por Ruling deste plano.
- **Escopo por conta em TODA leitura** (`allowed_accounts`: nulo = todas; `{}` = nenhuma; lista = só ela; papel `admin` e super pela FICHA = todas; super por e-mail NÃO). Conta invisível responde igual a conta inexistente (sem oráculo): lista `[]`, contagem `0`, proxy `400 conta nao encontrada`, rota ao vivo `404`.
- Negar por padrão. Todo portão tem o lado negado assertado **com o efeito** (foto do banco igual; o core de mentira não recebeu pedido).
- **Toda rota tem teste de vazamento com pessoa restrita pelo handler real** (cadeia `auth.Exigir` → `autz.ComEscopo`), sem filtro, com `?account_id=<outra>` e com `contar=1`.
- **Mapa de escrita da MESMA struct/mapa que monta o INSERT/UPDATE; `PodeX` na MESMA transação de `banco.ComUsuario` que grava;** `PodeCriar` exige toda coluna lida pela regra.
- Leitura declarada só com a GRAMÁTICA permitida do 5.0 (`select <colunas> from <tabela> t`, sem junção nem subconsulta; ordens e filtros por lista).
- Segredos: `accounts.access_token` e `accounts.publicacao_automatica` nunca em resposta, log ou corpo aceito (o SELECT de produção é por coluna; Ruling 5.6-8). Corpo e parâmetros do `meta-proxy` nunca em log.
- Sessão de "entrar como" só LÊ (vê o que o ALVO vê): as 3 escritas e o `POST`/`DELETE`/mídia do `meta-proxy` = `403 {"error":"sem_permissao","mensagem":<frase>}` sem efeito (o formato único de recusa impersonada do 5.0, Ruling 18 corrigido).
- SQL: todo parâmetro com cast explícito; nada do pedido no texto do SQL (tabela, colunas, chave de conflito e ordens fixas na rota).
- Sem dependência nova; `go.mod` fica em `go 1.26.0`.
- Gate: `make -C api teste PG_PORTA=58541` com `--- SKIP` = 0; `gofmt -l` e `go vet` limpos. O alvo `teste` usa o contêiner de nome fixo `pg-api-teste`: nunca junto com o gate de outra worktree.
- Commits terminam com `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>` (o modelo que implementa). Código, comentários e mensagens em português com acentuação; frases copiadas da edge ficam como estão (`conta nao encontrada`).
- `go` roda em `api/`; `git` na raiz da worktree.

## Review Focus

1. **Pessoa limitada a A1 (ou com a lista vazia, ou pela sessão de "entrar como" aberta por um super) pedindo qualquer leitura sem filtro, com `?account_id=A2` ou com `contar=1`** → nenhuma linha nem contagem de A2; o impersonado vê o que o ALVO vê, não o que o super veria. Teste: `TestNadaVazaEntreContas` (Task 9), que percorre TODAS as leituras.
2. **`meta-proxy` com `accountId` permitido e caminho de outra conta** (`/act_<outra>/…`, `/me/adaccounts`, `..`, `/v22.0/…`, objeto solto, `%2F`) → `403` sem o core receber nada; `accountId` invisível → `400 conta nao encontrada`, byte a byte igual ao inexistente. Teste: `TestMetaProxyEscopoDeContas` (Task 8).
3. **`access_token`/`publicacao_automatica` em resposta ou log** — de qualquer rota, de quem pode tudo, com corpo válido, quebrado ou trazendo a chave → nunca; `PATCH` com a chave = `400`. Testes: `TestContas` (Task 3), `TestSegredoDaContaNuncaSai` (Task 9).
4. **Lote de metas com UMA linha de conta invisível no meio** → `403` e nada gravado, nem as linhas da conta permitida; criar meta/filtro de conta invisível = `403` igual a mexer na existente de outra conta. Testes: `TestMetas`, `TestFiltrosDeCampanha` (Task 7).
5. **Sessão de "entrar como" escrevendo** (3 rotas) **ou mandando `POST`/`DELETE`/mídia pelo `meta-proxy`** → `403` com a frase, banco intacto, core sem pedido; `GET` pelo proxy continua. Testes: `TestEscritasRecusamImpersonado` (Task 9), `TestMetaProxyEscopoDeContas` (Task 8).

---

## Interfaces que este plano consome

(Dos planos; o pré-voo confere cada uma. Nome diferente só de campo/função: use o real em todo o plano. Semântica diferente: **pare e reporte**.)

- **5.0** — `dados.Consulta{Tabela, Alias, SQL, Onde; Filtros []Filtro; Ordens map[string]string; OrdemPadrao, Desempate string}` com `Validar(cat)`/`Handler(b, cat)` (`Handler` valida e dá `panic` na montagem; `contar=1` → `X-Total-Count`, contado sob a MESMA regra; teto 1000; parâmetro desconhecido = 400); `Desempate` = UMA coluna (`reDesempate`); `dados.Filtro{Param, SQL, Tipo}` (`texto|uuid|inteiro|data|instante|booleano`, `[]` = lista por vírgula; `inteiro` só com `::bigint`); `dados.LerCorpo` (`DisallowUnknownFields`, 1 MiB), `dados.Erro`, `dados.Responder`, `dados.ErroDeEscrita`. `autz`: `Producao`, `Escopo{ID, TemPerfil, Ativo, Papel, SuperFicha, TodasContas, Contas…}`, `CarregarEscopo(ctx, b, id)`, `EscopoDo`, `ComEscopo`, `Ler/Criar/Editar/EditarNova/Apagar`, `(*Catalogo).Filtro/PodeCriar`, `Filtro.Juntar`, `Conferir`, `ErrNegado`, `ErrNaoEncontrado`; `podeVerConta` (predicado interno em `predicados.go`). `auth.Ator{ID, ImpersonadorID}`, `AtorDoContexto`, `Exigir`, `ExigirModulo`, `NovoStore`, `(*Store).Criar(ctx, id, tipo, impersonadorID)` (sessão impersonada só vale com impersonador super pela ficha). `banco.ComUsuario`. `web.Rotas` com o grupo de domínio (`autz.ComEscopo(p)`) e os mapas `publicas`/`soSessao` de `rotas_test.go`. `testebanco.TabelasDoEscopo(t, p)`.
- **5.1** — `testebanco.ComEsquemaDeProducao(t)` (banco novo com compat + migrações + `esquema/*.sql` em ordem de nome); `esquema/01-tabelas-5-1.sql` (`profiles` com `allowed_accounts uuid[]`, `is_superadmin`, `role`, `disabled`, `permissions`, `features`); `esquema/02-gatilhos.sql` com `conta_ativa`. `dados.Tabela{Nome, Resposta, Autor}` com `Validar`, `Editar`; `dados.RotaEditar[C](p, cat, tabela)` (id de `chi.URLParam(r, "id")`; roda `C.Validar()`; `{}` = 400; invisível = 404).
- **5.2** — `dados.SoSessaoPropria(frase)`, `dados.FraseEntrarComo` (`"Quem entrou como outra pessoa só consulta."`); `testebanco/mundoteste`: `Pessoa{Chave, ID, Email, Papel; Super, Trava, Desativado; Modulos, Contas}` (`Contas` nil = `allowed_accounts` nulo; `[]string{}` = `'{}'`), `Opcoes{Pessoas, Linhas, Impersonadas}`, `Novo(t, o, montar...)`, `Mundo{P, H, Tok}` com `Resposta/Pedir/Um/Rodar`, `Caso`.
- **5.5 (se já executado)** — `dados.Tabela.Chave`, `Tabela.Gravar` e `autz.PodeEditarPor/PodeApagarPor`: **NÃO usados aqui** (Ruling 5.6-16). Nada deste plano depende do 5.5.
- **Plano 3** — `meta.Proxy{Pool, Core, HostsDeMidia}` (`proxy.go`), `meta.AoVivo{Pool, Core}` com `Insights`, `SerieNovosDia`, `ContarCollabs` (`ao_vivo.go`); nos testes do pacote `meta`: `montarMetaCom(t, resp, ddlAccounts, hosts) *ambienteMeta`, `ambienteMeta{p, h, core, cli, tokens}`, `(*ambienteMeta).post`, `graphOK`, `accountsTexto` (`conta-1` ig `1784` ad `999`; `42`; `conta-3`; `conta-sem-ig`), `uMeta`, `uSocial`, `uAdmin`, `uNada`. Em `web/rotas.go`: as 4 rotas no grupo de sessão (`/meta-proxy` com `ExigirModulo("meta")`; as 3 ao vivo com `ExigirModulo("social")` e `comPrazo`).

## Interfaces que este plano entrega

- `autz.VeTodasAsContas(e *Escopo) bool` e `autz.PodeVerConta(e *Escopo, conta string) bool` (Task 2): o 5.7 (`sugerir-publico-ia` recebe `contaId`), o 5.8 e qualquer rota que receba uma conta fora de tabela usam estes.
- `redes.Montar(r chi.Router, p *pgxpool.Pool)` (Task 9).
- D0: `esquema/01-tabelas-5-6.sql` com `accounts` completa (as fatias 5.7–5.9 a referenciam por FK e carregam depois) e as 15 tabelas de métrica; `esquema/03-funcoes-5-6.sql` com `pode_ver_conta` verbatim.

## Pré-voo (antes da Task 1)

- [ ] `cd /Users/gabrielgertrudes/Projetos/Trabalho/lavessel/social-dashboard/.claude/worktrees/p5-56 && git status --short && git branch --show-current` → vazio (ou só este plano); `feat/api-go-plano-5-6`.
- [ ] Trazer o 5.2 executado (ou o mais recente da cadeia): `git merge --no-edit feat/api-go-plano-5-2`. Conferir:
  ```bash
  grep -c 'func ComEsquemaDeProducao' api/internal/testebanco/esquema.go                          # 1
  grep -c 'func RotaEditar\|func (t Tabela) Editar' api/internal/dados/escrita.go                 # 2
  grep -c 'func SoSessaoPropria\|FraseEntrarComo' api/internal/dados/sessao.go                    # ≥ 2
  grep -c 'func Novo' api/internal/testebanco/mundoteste/mundoteste.go                            # 1
  grep -c 'Modulos, Contas' api/internal/testebanco/mundoteste/mundoteste.go                      # 1
  grep -n 'func podeVerConta' api/internal/autz/predicados.go                                     # o predicado a reaproveitar
  grep -c 'TodasContas' api/internal/autz/escopo.go                                               # ≥ 1
  grep -c 'func (c \*Catalogo) PodeCriar' api/internal/autz/escrita.go; grep -c 'func Conferir' api/internal/autz/filtro.go   # 1 e 1
  grep -c 'FUNCTION public.conta_ativa' api/internal/testebanco/esquema/02-gatilhos.sql            # ≥ 1
  grep -c 'func TabelasDoEscopo' api/internal/testebanco/testebanco.go                            # 1
  grep -c 'autz.ComEscopo(p)' api/internal/web/rotas.go                                           # ≥ 1 (grupo de domínio)
  grep -n '"/meta-proxy"\|"/insights-ao-vivo"\|"/serie-novos-dia"\|"/contar-collabs"' api/internal/web/rotas.go   # 4, no grupo de sessão
  grep -n 'create table public.accounts\|references public.accounts\|public.social_metas\|public.campaign' api/internal/testebanco/esquema/01-tabelas-*.sql   # vazio
  grep -n 'is_superadmin' api/internal/testebanco/testebanco.go                                   # o legado tem a coluna
  ```
  Qualquer `0`: a dependência não terminou — **pare e reporte**. Declaração de `accounts` ou de tabela de métrica numa fatia anterior (mínima, para FK): apague-a de lá no commit da Task 1 (Ruling 5.6-1). `pode_ver_conta` já em `02-gatilhos.sql`: siga igual (o `03-funcoes-5-6.sql` é `create or replace` idêntico).
- [ ] `go version` → `go1.26`+.
- [ ] Docker no ar, porta livre (`lsof -iTCP:58541 -sTCP:LISTEN` → vazio) e o banco das etapas:
  ```bash
  docker run -d --rm --name pg-plano56 -e POSTGRES_PASSWORD=x -p 127.0.0.1:58541:5432 postgres:17
  until docker exec pg-plano56 pg_isready -h 127.0.0.1 -U postgres >/dev/null 2>&1; do sleep 1; done
  export TEST_DATABASE_URL='postgres://postgres:x@localhost:58541/postgres?sslmode=disable'
  ```
- [ ] Linha de base: `cd api && go test ./... && go test -v ./... 2>&1 | grep -c -- '--- SKIP'` → tudo `ok` e `0`.

## Estrutura de arquivos

```
api/internal/testebanco/esquema/01-tabelas-5-6.sql      # accounts + as 15 tabelas de métrica (fonte por bloco); sem gatilhos
api/internal/testebanco/esquema/03-funcoes-5-6.sql      # pode_ver_conta VERBATIM (02-funções.csv:1914-1929)
api/internal/testebanco/esquema_redes_test.go           # únicos (alvos de ON CONFLICT), FKs, nenhum gatilho, função carregada
api/internal/autz/predicados.go          (+ conta_test.go) # VeTodasAsContas, PodeVerConta; podeVerConta usa VeTodasAsContas
api/internal/redes/redes.go                              # doc, soSessaoPropria, deve, filtros comuns de conta e período
api/internal/redes/mundo_test.go                         # pessoas (A1/A2/lista vazia/admin/super/e-mail/meta.hora/impersonado), linhas, foto
api/internal/redes/redes_test.go                         # TestMundoDasRedes, TestPodeVerContaIgualAProducao
api/internal/redes/contas.go           (+ _test)         # GET /redes/contas, PATCH /redes/contas/{id}
api/internal/redes/organico.go         (+ _test)         # seguidores, leituras-de-seguidores, engajamento, conteudo
api/internal/redes/anuncios.go         (+ _test)         # campanhas, conjuntos, anuncios, insights-de-campanha, insights-da-conta
api/internal/redes/hora.go             (+ _test)         # campanhas-por-hora, anuncios-por-hora, visitas-por-hora
api/internal/redes/escolhas.go         (+ _test)         # metas e filtros de campanha (GET + PUT upsert)
api/internal/redes/rotas.go            (+ rotas_test.go) # Montar; varreduras: vazamento entre contas, impersonado, segredo
api/internal/meta/escopo.go            (+ escopo_contas_test.go) # contaVisivel, caminhoDaConta
api/internal/meta/proxy.go, ao_vivo.go, proxy_test.go    # (mod.) Ruling 34; fixture com ComEscopo e pessoas com lista
api/internal/web/rotas.go, rotas_test.go                 # ComEscopo nas 4 rotas do Plano 3 (Task 8); redes.Montar e soSessao (Task 9)
api/cmd/api/conferir.go                                  # colunas, tipos, únicos e a função que as rotas presumem
docs/migracao-go/NOTAS-DA-IMPLANTACAO.md                 # seção do 5.6
```

**Não toca:** `esquema/gerar-gatilhos.mjs` nem `esquema/02-gatilhos.sql` (nenhum gatilho nas 17 tabelas: `levantamento/03-triggers.csv` não tem nenhuma); `web.FuncoesRPC`/`RPCPendentes` (nenhuma RPC no 5.6).

## Tarefas

| # | Task | Revisor | Depende de |
|---|---|---|---|
| 1 | D0: fatia 5.6 (accounts + 15 tabelas de métrica; `pode_ver_conta` verbatim; sem gatilhos) | **opus** (dados: é contra isto que tudo é provado) | 5.1 T1 |
| 2 | `autz.PodeVerConta` + `redes`: fundação (mundo com contas A1/A2 e segredos plantados, filtros comuns, portão de impersonado) | **opus** (autorização) | 1, 5.2 T2–T3 |
| 3 | Contas: `GET /redes/contas` (colunas fechadas) e `PATCH /redes/contas/{id}` | **opus** (segredo, permissão) | 2 |
| 4 | Orgânico: seguidores, leituras de seguidores, engajamento, conteúdo | sonnet | 2 |
| 5 | Anúncios: campanhas, conjuntos, anúncios, insights de campanha e da conta | **opus** (dinheiro: gasto) | 2 |
| 6 | Por hora: campanhas, anúncios e visitas | **opus** (dinheiro; regra dupla `meta.hora` + conta) | 2 |
| 7 | Escolhas: metas e filtros de campanha (`GET` + `PUT` upsert) | **opus** (escrita, criar só o que se vê, lote atômico) | 2 |
| 8 | `meta-proxy` e rotas ao vivo com o escopo de contas (Ruling 34) | **opus** (autorização; dinheiro: `POST` na Meta) | 2 (só `autz`) |
| 9 | Montagem, varreduras (vazamento entre contas, impersonado, segredo), `conferir` e notas | **opus** (fronteira) | 3–8 |

---

### Task 1: D0 — fatia 5.6 do esquema de produção nos testes

**Revisor:** opus. **Depende de:** 5.1 Task 1 (carregador e `profiles`/`conta_ativa`).

**(a) Contrato**
- `esquema/01-tabelas-5-6.sql` (abaixo): `accounts` com as colunas que o worker e as telas usam (inclusive `access_token` e `publicacao_automatica`, para provar que nunca saem) e as 15 tabelas de métrica, cada bloco com a fonte. `ads_snapshots` fica FORA (Ruling 5.6-9). Tipos sem DDL no repositório levam `presumido` e são conferidos pelo `api worker conferir` (Task 9).
- `esquema/03-funcoes-5-6.sql`: `pode_ver_conta` **verbatim** de `levantamento/02-funções.csv:1914-1929` (carrega depois de `02-gatilhos.sql`, que define `conta_ativa`).
- Os únicos são exatamente os alvos de `ON CONFLICT` do worker (`api/internal/meta/coleta.go`, `coleta_anuncios.go`, `hora.go`) e das telas (`social_metas`, `campaign_filters`).

**(b) Testes de aceitação** (`TestFatiaDasRedes`, `esquema_redes_test.go`, num `testebanco.ComEsquemaDeProducao`)
- As 16 tabelas existem (`to_regclass`) e `ads_snapshots` não.
- Nenhum gatilho: `select count(*) from pg_trigger g join pg_class c on c.oid = g.tgrelid where not g.tgisinternal and c.relname = any(<as 16>)` = `0`.
- Cada alvo de conflito existe: para cada `(tabela, chave)` de `alvos` (código abaixo), `insert … on conflict (<chave>) do nothing` com uma linha mínima válida roda sem erro e a segunda vez não duplica.
- FKs: apagar a conta A1 leva junto as linhas de A1 em `followers_leituras`, `campaign_adsets` e `visitas_perfil_dia` (as três têm `on delete cascade` nas migrations).
- `pode_ver_conta` carregada verbatim: `pg_get_functiondef('public.pode_ver_conta(text)'::regprocedure)` contém `p_conta is null` e `SECURITY DEFINER`; como uma pessoa com `allowed_accounts '{}'` (em `banco.ComUsuario`): `pode_ver_conta(null)` = `true` e `pode_ver_conta('<A1>')` = `false`.
- Mutações que têm de reprovar: tirar o `unique (account_id, periodo, indicador)` de `social_metas`; apagar `03-funcoes-5-6.sql`.

**(c) Arquivos:** Create `api/internal/testebanco/esquema/01-tabelas-5-6.sql`, `api/internal/testebanco/esquema/03-funcoes-5-6.sql`, `api/internal/testebanco/esquema_redes_test.go`.

**(d) Dependências:** 5.1 Task 1; `banco.ComUsuario`.

- [ ] **Step 1: A DDL da fatia.** Crie `api/internal/testebanco/esquema/01-tabelas-5-6.sql`:

```sql
-- FATIA 5.6 do esquema de produção para os testes (D0 reconstruído: Rulings 5.1-1 e 5.6-1). Carrega
-- depois de 01-tabelas-5-1…5-5 (ordem de nome); pode_ver_conta vem em 03-funcoes-5-6.sql, depois de
-- 02-gatilhos.sql (precisa de conta_ativa). Nenhuma destas tabelas tem gatilho em produção
-- (levantamento/03-triggers.csv: zero linhas), por isso o gerador não muda. Tabelas anteriores às
-- migrations: colunas = as que o worker grava (api/internal/meta/*_test.go, conferidas em produção por
-- cmd/api/conferir.go) + as que as telas leem; o que não tem fonte leva "presumido" e é conferido pelo
-- `api worker conferir`. ads_snapshots fica FORA (Ruling 5.6-9: ninguém grava, só um contador a lê).

-- accounts: id/name/instagram_id/ad_account_id/access_token = cmd/api/conferir.go:24; username,
-- profile_picture_url, picture_url, accent_color = os selects das telas (tela-de-admin.vue:3968,
-- tela-de-analise-campanhas.vue:213); publicacao_automatica = 2026-07-30-conteudo-04-hora-h.sql:21-22;
-- conteudo_usa_portal = 2026-08-01-conteudo-12-concorrentes-por-marca.sql:33-34; persona =
-- 2026-08-12-persona-da-marca.sql:23-24. Em produção o SELECT de `authenticated` é concedido COLUNA A
-- COLUNA (2026-08-13-persona-grant-de-leitura.sql:9-15): access_token e publicacao_automatica não são
-- legíveis pelo navegador — as rotas usam lista fechada (Ruling 5.6-8). Tipos: presumidos (texto).
create table public.accounts (
  id                    uuid primary key default gen_random_uuid(),
  name                  text,
  username              text,
  instagram_id          text,
  ad_account_id         text,
  access_token          text,
  profile_picture_url   text,
  picture_url           text,
  accent_color          text,
  publicacao_automatica boolean not null default false,
  conteudo_usa_portal   boolean not null default false,
  persona               text
);

-- coleta.go:177-178 (on conflict (account_id, captured_at)); gained/lost: tela-de-redes-sociais.vue:2106
create table public.daily_snapshots (
  account_id      uuid not null,
  captured_at     date not null,
  followers_count int,
  gained          int,
  lost            int,
  unique (account_id, captured_at)
);

-- 2026-07-16-followers-leituras.sql:13-18 + origem (2026-09-17-followers-leituras-origem.sql)
create table public.followers_leituras (
  id              bigserial primary key,
  account_id      uuid not null references public.accounts(id) on delete cascade,
  followers_count integer not null,
  lido_em         timestamptz not null default now(),
  origem          text
);

-- coleta.go:566-584 (upsertEng); created_at: lido pelo Admin (tela-de-admin.vue:1777), presumido
create table public.engagement_snapshots (
  account_id         uuid not null,
  captured_at        date not null,
  period_days        int not null,
  likes int, comments int, saves int, shares int, reach int, views int, total_interactions int,
  accounts_engaged   int,
  profile_views      int,
  created_at         timestamptz not null default now(),
  unique (account_id, captured_at, period_days)
);

-- coleta.go:199-209
create table public.content_snapshots (
  account_id  uuid not null,
  captured_at date not null,
  period_days int not null,
  posts_count int, reels_count int, stories_count int, story_shares int, story_replies int,
  story_reach int, story_interactions int, story_navigation int, story_profile_visits int,
  story_follows int, story_nav_forward int, story_nav_back int, story_nav_exit int, story_nav_next int,
  unique (account_id, captured_at, period_days)
);

-- coleta_anuncios.go:24-26; account_id ANULÁVEL como no teste do worker (hora_test.go:19): a linha sem
-- conta é visível a todos (pode_ver_conta(null) = true), e o mundo da Task 2 tem uma
create table public.campaigns (
  campaign_id text primary key,
  account_id  uuid,
  name        text,
  objective   text,
  status      text,
  synced_at   date
);

-- supabase/migrations/20260817_baldes_de_campanha_conjuntos_e_contagens.sql
create table public.campaign_adsets (
  adset_id          text primary key,
  campaign_id       text not null,
  account_id        uuid not null references public.accounts(id) on delete cascade,
  destination_type  text,
  optimization_goal text,
  synced_at         date not null default current_date
);

-- 2026-09-18-meta-ads-catalogo-anuncios.sql
create table public.ads (
  ad_id        text primary key,
  campaign_id  text not null,
  account_id   uuid not null,
  name         text not null default '',
  status       text not null default '',
  destino_link text,
  synced_at    date not null default current_date
);

-- coleta_anuncios.go:144-148 + 2026-07-02-campaign-insights-actions.sql + 20260817_baldes…sql (conversas…)
create table public.campaign_insights (
  campaign_id     text not null,
  account_id      uuid not null,
  captured_at     date not null,
  period_days     int not null,
  spend           numeric,
  impressions bigint, clicks bigint, reach bigint,
  post_engagement int, likes int, comments int, shares int, saves int,
  conversas int, cadastros int, compras int, visitas int,
  unique (campaign_id, account_id, captured_at, period_days)
);

-- presumido: o upsert do coletor Python (projetos/central-inteligencia/redes-sociais/coletor/coletar.py:337-345)
create table public.account_insights (
  account_id  uuid not null,
  captured_at date not null,
  period_days int not null,
  spend       numeric,
  impressions bigint,
  clicks      bigint,
  reach       bigint,
  frequency   numeric,
  unique (account_id, captured_at, period_days)
);

-- 2026-09-11-meta-ads-hora-tabela.sql + 2026-09-12-meta-ads-hora-cliques.sql
create table public.campaign_insights_hora (
  campaign_id          text not null,
  account_id           uuid not null,
  dia                  date not null,
  hora                 smallint not null check (hora between 0 and 23),
  gasto_acumulado      numeric(12,2) not null default 0,
  conversas_acumuladas integer not null default 0,
  gasto_hora           numeric(12,2) not null default 0,
  conversas_hora       integer not null default 0,
  coletado_em          timestamptz not null default now(),
  cliques_acumulados   integer not null default 0,
  cliques_hora         integer not null default 0,
  unique (campaign_id, account_id, dia, hora)
);

-- 2026-09-12-meta-ads-hora-visitas-perfil-da-conta.sql
create table public.perfil_visitas_hora (
  account_id         uuid not null,
  dia                date not null,
  hora               smallint not null check (hora between 0 and 23),
  visitas_acumuladas integer not null default 0,
  visitas_hora       integer not null default 0,
  coletado_em        timestamptz not null default now(),
  unique (account_id, dia, hora)
);

-- 2026-09-18-meta-ads-ad-insights-hora.sql
create table public.ad_insights_hora (
  ad_id              text not null,
  campaign_id        text not null,
  account_id         uuid not null,
  dia                date not null,
  hora               smallint not null check (hora between 0 and 23),
  gasto_acumulado    numeric not null default 0,
  gasto_hora         numeric not null default 0,
  cliques_acumulados integer not null default 0,
  cliques_hora       integer not null default 0,
  coletado_em        timestamptz not null default now(),
  unique (ad_id, account_id, dia, hora)
);

-- 2026-09-17-visitas-perfil-dia.sql (sem rota: Ruling 5.6-9; está aqui para a foto e para o 5.11)
create table public.visitas_perfil_dia (
  account_id   uuid not null references public.accounts(id) on delete cascade,
  dia          date not null,
  visitas      integer not null,
  calculado_em timestamptz not null default now(),
  primary key (account_id, dia)
);

-- presumido: (account_id, periodo, indicador, valor) com onConflict nas três primeiras
-- (tela-de-redes-sociais.vue:1357-1359; spec 2026-08-17-baldes…-design.md:86-88). account_id é TEXTO:
-- a policy sai `pode_ver_conta(account_id)` sem ::text (o Postgres descarta o cast de texto para texto).
create table public.social_metas (
  account_id text not null,
  periodo    text not null,
  indicador  text not null,
  valor      numeric,
  unique (account_id, periodo, indicador)
);

-- presumido: POST com `resolution=merge-duplicates` e sem on_conflict = conflito pela PK
-- (tela-de-redes-sociais.vue:3830-3834); account_id uuid (a policy faz ::text); selected_ids text[]
-- (null = todas, [] = nenhuma; coletar.py:244 lê a lista)
create table public.campaign_filters (
  account_id   uuid primary key,
  selected_ids text[],
  updated_at   timestamptz
);
```

- [ ] **Step 2: A função.** Crie `api/internal/testebanco/esquema/03-funcoes-5-6.sql` (o corpo é o de produção, sem mudar um caractere entre `CREATE` e `$function$`):

```sql
-- pode_ver_conta VERBATIM de levantamento/02-funções.csv:1914-1929 (a regra das 15 restritivas
-- so_contas_permitidas). Depois de 02-gatilhos.sql porque chama conta_ativa(). Se o gerador um dia
-- também a emitir, os dois `create or replace` são idênticos.
CREATE OR REPLACE FUNCTION public.pode_ver_conta(p_conta text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select public.conta_ativa() and exists (
    select 1 from public.profiles p
     where p.id = auth.uid()
       and (p.role = 'admin' or p.is_superadmin
            or p.allowed_accounts is null
            or p_conta is null
            or p_conta = any (p.allowed_accounts::text[]))
  );
$function$;
```

- [ ] **Step 3: O teste.** `esquema_redes_test.go` com `TestFatiaDasRedes` (contrato (b)); a lista de alvos:

```go
// alvos: os ON CONFLICT do worker (coleta.go, coleta_anuncios.go, hora.go) e das telas (Task 7).
var alvos = []struct{ tabela, chave, linha string }{
	{"daily_snapshots", "account_id, captured_at", `(account_id, captured_at) values ('` + a1 + `', '2026-10-11')`},
	{"engagement_snapshots", "account_id, captured_at, period_days", `(account_id, captured_at, period_days) values ('` + a1 + `', '2026-10-11', 7)`},
	{"content_snapshots", "account_id, captured_at, period_days", `(account_id, captured_at, period_days) values ('` + a1 + `', '2026-10-11', 7)`},
	{"campaigns", "campaign_id", `(campaign_id, account_id) values ('9', '` + a1 + `')`},
	{"campaign_adsets", "adset_id", `(adset_id, campaign_id, account_id) values ('8', '9', '` + a1 + `')`},
	{"ads", "ad_id", `(ad_id, campaign_id, account_id) values ('7', '9', '` + a1 + `')`},
	{"campaign_insights", "campaign_id, account_id, captured_at, period_days", `(campaign_id, account_id, captured_at, period_days) values ('9', '` + a1 + `', '2026-10-11', 0)`},
	{"account_insights", "account_id, captured_at, period_days", `(account_id, captured_at, period_days) values ('` + a1 + `', '2026-10-11', 7)`},
	{"campaign_insights_hora", "campaign_id, account_id, dia, hora", `(campaign_id, account_id, dia, hora) values ('9', '` + a1 + `', '2026-10-11', 9)`},
	{"perfil_visitas_hora", "account_id, dia, hora", `(account_id, dia, hora) values ('` + a1 + `', '2026-10-11', 9)`},
	{"ad_insights_hora", "ad_id, account_id, dia, hora", `(ad_id, campaign_id, account_id, dia, hora) values ('7', '9', '` + a1 + `', '2026-10-11', 9)`},
	{"social_metas", "account_id, periodo, indicador", `(account_id, periodo, indicador, valor) values ('` + a1 + `', '1', 'seguidores', 1)`},
	{"campaign_filters", "account_id", `(account_id) values ('` + a1 + `')`},
}
```

Run: `go test -count=1 ./internal/testebanco/` → FAIL antes dos Steps 1–2; PASS depois. Aplique as mutações de (b), uma por vez, e veja reprovar.

- [ ] **Step 4: Commit** `feat(api): D0 — fatia 5.6 (contas e métricas da Meta, sem gatilhos) e pode_ver_conta verbatim` (+ `Co-Authored-By`).

---

### Task 2: `autz.PodeVerConta` e `redes` — fundação

**Revisor:** opus. **Depende de:** 1; 5.2 Tasks 2–3 (`dados.SoSessaoPropria`, `mundoteste`).

**(a) Contrato**
- `autz.VeTodasAsContas(e *Escopo) bool` e `autz.PodeVerConta(e *Escopo, conta string) bool` (código abaixo); o predicado SQL `podeVerConta` passa a decidir o "todas" pelo MESMO `VeTodasAsContas` (uma regra, duas formas: Ruling 5.6-14).
- `redes`: `soSessaoPropria` (= `dados.SoSessaoPropria(dados.FraseEntrarComo)`), `deve`, `filtroConta`, `filtroContaTexto`, `filtroPeriodo`, `filtrosDeData(col)` (abaixo). Os filtros comuns moram aqui para as Tasks 3–7 andarem em paralelo.
- Teste (interno): `novoMundo(t, montar...) *mundoteste.Mundo` com o banco da Task 1, as pessoas, as linhas e a foto abaixo; sessão `impersonado` = a de `soA1` aberta por `superA1`.

**(b) Testes de aceitação**
- `TestPodeVerConta` (`autz/conta_test.go`, puro): `nil` → falso; inativo ou sem perfil → falso para tudo; papel `admin`, super pela ficha ou `TodasContas` → verdadeiro para qualquer texto; lista `[A1]` → só `A1` (comparação exata: `A1` maiúsculo não casa); lista vazia → falso.
- `TestMundoDasRedes` (sonda `GET /eco` montada no teste, que escreve `fmt.Sprintf("%t|%s|%t", autz.VeTodasAsContas(e), strings.Join(e.Contas, ","), a.ImpersonadorID != nil)`): sem sessão → 401; `todas` → `true||false`; `soA1` → `false|<A1>|false`; `nenhuma` → `false||false`; `adminA1`, `superA1` → `true|<A1>|false`; `emailA1` (super por E-MAIL) → `false|<A1>|false`; `semModulo` → `true||false`; `impersonado` → `false|<A1>|true`; `desativado` → 401.
- `TestPodeVerContaIgualAProducao` (código abaixo): para TODA pessoa do mundo (a desativada inclusive) × `{A1, A2, A3 inexistente}`, `autz.PodeVerConta(CarregarEscopo(id), c)` = `select pode_ver_conta(c)` rodado como a pessoa em `banco.ComUsuario`; e a matriz tem os dois lados (algum verdadeiro e algum falso).
- Mutações que têm de reprovar: `VeTodasAsContas` sem `e.Ativo` (a desativada passa a ver: a comparação com produção acusa); `slices.Contains(e.Contas, conta)` → `len(e.Contas) > 0` (`soA1` vê A2); `podeVerConta` deixa de chamar `VeTodasAsContas` e esquece o `e.SuperFicha` (o oráculo do 5.0, `TestContratoDePermissaoContraARLSDeProducao`, acusa).

**(c) Arquivos:** Modify `api/internal/autz/predicados.go`; Create `api/internal/autz/conta_test.go`, `api/internal/redes/redes.go`, `api/internal/redes/mundo_test.go`, `api/internal/redes/redes_test.go`.

**(d) Dependências:** Task 1; `autz.CarregarEscopo/EscopoDo/ComEscopo`; `mundoteste`; `banco.ComUsuario`.

- [ ] **Step 1: `autz`.** Em `api/internal/autz/predicados.go`, acrescente:

```go
// VeTodasAsContas: pode_ver_conta é verdadeiro para QUALQUER conta — conta ativa, com perfil, e papel
// 'admin', super-admin pela FICHA ou allowed_accounts nulo. Lista vazia ('{}') NÃO é "todas": é nenhuma.
// Super-admin só por e-mail (is_superadmin()) não entra: a função lê p.is_superadmin.
func VeTodasAsContas(e *Escopo) bool {
	return e != nil && e.Ativo && e.TemPerfil && (e.Papel == "admin" || e.SuperFicha || e.TodasContas)
}

// PodeVerConta é pode_ver_conta(conta) (02-funções.csv:1914) avaliado em Go para uma conta NÃO nula: a
// regra das restritivas so_contas_permitidas para o que não é tabela — o meta-proxy e as rotas ao vivo
// (Ruling 34 do mestre, 5.6-4). Comparação exata de texto, como `p_conta = any(allowed_accounts::text[])`.
func PodeVerConta(e *Escopo, conta string) bool {
	return VeTodasAsContas(e) || (e != nil && e.Ativo && e.TemPerfil && slices.Contains(e.Contas, conta))
}
```

e, em `podeVerConta`, troque `if e.Papel == "admin" || e.SuperFicha || e.TodasContas {` por `if VeTodasAsContas(e) {` (o `if !e.Ativo || !e.TemPerfil { return "false" }` antes dele fica).

- [ ] **Step 2: o pacote.** Crie `api/internal/redes/redes.go`:

```go
// Package redes: as rotas do sub-plano 5.6 — as métricas da Meta e das redes que o worker grava
// (Plano 4) e o painel lê (contas, seguidores, engajamento, conteúdo, campanhas, conjuntos, anúncios,
// insights por dia e por hora, visitas) e o que as telas gravam (metas, filtros de campanha, campos da
// conta). Regra de toda tabela = catálogo de produção (autz.Producao: a restritiva so_contas_permitidas
// em 15 das 17); escrita em banco.ComUsuario; "entrar como" só lê (Ruling 5.6-6). O cliente da Graph,
// o meta-proxy e as rotas ao vivo continuam no pacote meta (Ruling 5.6-2).
package redes

import "github.com/rbv-co/social-dashboard/api/internal/dados"

var soSessaoPropria = dados.SoSessaoPropria(dados.FraseEntrarComo)

// deve: declaração de rota errada (Consulta ou Tabela fora do catálogo) faz a API não subir.
func deve(err error) {
	if err != nil {
		panic(err)
	}
}

// Filtros comuns. TODA leitura do pacote declara o de conta e projeta account_id (Ruling 5.6-10): é o
// que a varredura de vazamento da Task 9 usa para provar que nenhuma rota entrega outra conta.
var (
	filtroConta      = dados.Filtro{Param: "account_id", SQL: "t.account_id = @account_id::uuid", Tipo: "uuid"}
	filtroContaTexto = dados.Filtro{Param: "account_id", SQL: "t.account_id = @account_id::text", Tipo: "texto"} // social_metas
	filtroPeriodo    = dados.Filtro{Param: "period_days", SQL: "t.period_days = @period_days::bigint", Tipo: "inteiro"}
)

// filtrosDeData: os recortes eq/gte/lte do PostgREST sobre uma coluna date (`<col>`, `<col>_de`,
// `<col>_ate`), com o cast ::date do PostgREST. col é constante da rota, nunca do pedido.
func filtrosDeData(col string) []dados.Filtro {
	return []dados.Filtro{
		{Param: col, SQL: "t." + col + " = @" + col + "::date", Tipo: "data"},
		{Param: col + "_de", SQL: "t." + col + " >= @" + col + "_de::date", Tipo: "data"},
		{Param: col + "_ate", SQL: "t." + col + " <= @" + col + "_ate::date", Tipo: "data"},
	}
}
```

- [ ] **Step 3: o mundo.** Crie `api/internal/redes/mundo_test.go`:

```go
package redes

import (
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/testebanco/mundoteste"
)

const (
	A1 = "a5600000-0000-4000-a000-0000000000a1" // 'Vessel': ig 1784, act 111, token SEGREDO-token-A1
	A2 = "a5600000-0000-4000-a000-0000000000a2" // 'Mantova': ig 1785, ad_account 'act_222', token SEGREDO-token-A2
	A3 = "a5600000-0000-4000-a000-0000000000a3" // não existe

	idTodas      = "a5610000-0000-4000-a000-000000000001"
	idSoA1       = "a5610000-0000-4000-a000-000000000002"
	idNenhuma    = "a5610000-0000-4000-a000-000000000003"
	idAdminA1    = "a5610000-0000-4000-a000-000000000004"
	idSuperA1    = "a5610000-0000-4000-a000-000000000005"
	idEmailA1    = "a5610000-0000-4000-a000-000000000006"
	idHoraA1     = "a5610000-0000-4000-a000-000000000007"
	idSemModulo  = "a5610000-0000-4000-a000-000000000008"
	idDesativado = "a5610000-0000-4000-a000-000000000009"
)

// pessoas: os três estados de allowed_accounts (nulo, lista, vazia), os que ignoram a lista (papel admin,
// super pela FICHA) e o que não ignora (super por E-MAIL), a chave meta.hora (Linhas) e quem não tem
// módulo nenhum (as tabelas não olham módulo: Ruling 5.6-3).
var pessoas = []mundoteste.Pessoa{
	{Chave: "todas", ID: idTodas, Email: "todas@x.com", Papel: "viewer", Modulos: []string{"social", "meta"}},
	{Chave: "soA1", ID: idSoA1, Email: "soa1@x.com", Papel: "viewer", Modulos: []string{"social", "meta"}, Contas: []string{A1}},
	{Chave: "nenhuma", ID: idNenhuma, Email: "nenhuma@x.com", Papel: "viewer", Modulos: []string{"social", "meta"}, Contas: []string{}},
	{Chave: "adminA1", ID: idAdminA1, Email: "admina1@x.com", Papel: "admin", Contas: []string{A1}},
	{Chave: "superA1", ID: idSuperA1, Email: "supera1@x.com", Papel: "viewer", Super: true, Contas: []string{A1}},
	{Chave: "emailA1", ID: idEmailA1, Email: "breno@rbvcompany.com", Papel: "viewer", Contas: []string{A1}},
	{Chave: "horaA1", ID: idHoraA1, Email: "horaa1@x.com", Papel: "viewer", Modulos: []string{"meta"}, Contas: []string{A1}},
	{Chave: "semModulo", ID: idSemModulo, Email: "semmodulo@x.com", Papel: "viewer"},
	{Chave: "desativado", ID: idDesativado, Email: "desativado@x.com", Papel: "admin", Desativado: true},
}

// Sem identidade. Toda linha de A2 carrega o uuid de A2 em account_id: é por ele que a varredura acha
// vazamento. A campanha 9000 não tem conta (pode_ver_conta(null) = verdadeiro: visível a todos).
const linhasDasRedes = `
update profiles set permissions = '{"meta.hora": ["ver"]}' where id = '` + idHoraA1 + `';
insert into accounts (id, name, username, instagram_id, ad_account_id, access_token, accent_color, persona, publicacao_automatica) values
  ('` + A1 + `', 'Vessel', 'vessel', '1784', '111', 'SEGREDO-token-A1', '#1A3A6B', 'Mulheres 30+', true),
  ('` + A2 + `', 'Mantova', 'mantova', '1785', 'act_222', 'SEGREDO-token-A2', '#7A1F1F', null, false);
insert into daily_snapshots (account_id, captured_at, followers_count, gained, lost) values
  ('` + A1 + `', '2026-10-10', 1000, 5, 1), ('` + A1 + `', '2026-10-11', 1004, 6, 2), ('` + A2 + `', '2026-10-11', 2000, 9, 3);
insert into followers_leituras (account_id, followers_count, lido_em, origem) values
  ('` + A1 + `', 1004, '2026-10-11T12:00:00Z', 'hora'), ('` + A2 + `', 2000, '2026-10-11T12:00:00Z', 'hora');
insert into engagement_snapshots (account_id, captured_at, period_days, likes, reach) values
  ('` + A1 + `', '2026-10-11', 7, 10, 100), ('` + A1 + `', '2026-10-11', 1, 2, 20), ('` + A2 + `', '2026-10-11', 7, 30, 300);
insert into content_snapshots (account_id, captured_at, period_days, posts_count, stories_count, story_replies) values
  ('` + A1 + `', '2026-10-11', 1, 1, 3, 4), ('` + A1 + `', '2026-10-11', 0, 0, 1, 0), ('` + A2 + `', '2026-10-11', 1, 2, 5, 6);
insert into campaigns (campaign_id, account_id, name, objective, status, synced_at) values
  ('9000', null, 'Campanha sem conta', 'OUTCOME_AWARENESS', 'ACTIVE', '2026-10-11'),
  ('9001', '` + A1 + `', 'Seguidores Vessel', 'OUTCOME_ENGAGEMENT', 'ACTIVE', '2026-10-11'),
  ('9002', '` + A2 + `', 'Vendas Mantova', 'OUTCOME_SALES', 'PAUSED', '2026-10-11');
insert into campaign_adsets (adset_id, campaign_id, account_id, destination_type, optimization_goal) values
  ('8001', '9001', '` + A1 + `', 'INSTAGRAM_PROFILE', 'PROFILE_VISIT'), ('8002', '9002', '` + A2 + `', 'WEBSITE', 'OFFSITE_CONVERSIONS');
insert into ads (ad_id, campaign_id, account_id, name, status, destino_link) values
  ('7001', '9001', '` + A1 + `', 'Anúncio Vessel', 'ACTIVE', 'https://vessel.exemplo/a'),
  ('7002', '9002', '` + A2 + `', 'Anúncio Mantova', 'ACTIVE', 'https://mantova.exemplo/b');
insert into campaign_insights (campaign_id, account_id, captured_at, period_days, spend, impressions) values
  ('9001', '` + A1 + `', '2026-10-10', 0, 100.10, 1000), ('9001', '` + A1 + `', '2026-10-11', 0, 1234.56, 2000),
  ('9002', '` + A2 + `', '2026-10-11', 0, 999.99, 5000);
insert into account_insights (account_id, captured_at, period_days, spend, impressions, clicks, reach, frequency) values
  ('` + A1 + `', '2026-10-11', 7, 1334.66, 3000, 30, 900, 3.33), ('` + A2 + `', '2026-10-11', 7, 999.99, 5000, 50, 2000, 2.5);
insert into campaign_insights_hora (campaign_id, account_id, dia, hora, gasto_acumulado, gasto_hora, conversas_hora) values
  ('9001', '` + A1 + `', '2026-10-11', 9, 12.50, 12.50, 1), ('9001', '` + A1 + `', '2026-10-11', 10, 20.00, 7.50, 0),
  ('9002', '` + A2 + `', '2026-10-11', 9, 40.00, 40.00, 2);
insert into ad_insights_hora (ad_id, campaign_id, account_id, dia, hora, gasto_hora, cliques_hora) values
  ('7001', '9001', '` + A1 + `', '2026-10-11', 9, 3.25, 4), ('7002', '9002', '` + A2 + `', '2026-10-11', 9, 8.75, 9);
insert into perfil_visitas_hora (account_id, dia, hora, visitas_hora) values
  ('` + A1 + `', '2026-10-11', 9, 11), ('` + A2 + `', '2026-10-11', 9, 22);
insert into visitas_perfil_dia (account_id, dia, visitas) values ('` + A1 + `', '2026-10-10', 50), ('` + A2 + `', '2026-10-10', 60);
insert into social_metas (account_id, periodo, indicador, valor) values
  ('` + A1 + `', '1', 'seguidores', 100), ('` + A2 + `', '1', 'seguidores', 200);
insert into campaign_filters (account_id, selected_ids, updated_at) values
  ('` + A1 + `', '{9001}', '2026-10-01T00:00:00Z'), ('` + A2 + `', '{9002}', '2026-10-01T00:00:00Z');`

// fotoDasRedes: hash das 16 tabelas da fatia (as sem rota inclusive). Igual antes e depois = nada mudou.
const fotoDasRedes = `select md5(string_agg(l, '|' order by l)) from (
  select 'a:' || t::text as l from accounts t union all
  select 'd:' || t::text from daily_snapshots t union all
  select 'f:' || t::text from followers_leituras t union all
  select 'e:' || t::text from engagement_snapshots t union all
  select 'c:' || t::text from content_snapshots t union all
  select 'ca:' || t::text from campaigns t union all
  select 'cs:' || t::text from campaign_adsets t union all
  select 'ad:' || t::text from ads t union all
  select 'ci:' || t::text from campaign_insights t union all
  select 'ai:' || t::text from account_insights t union all
  select 'ch:' || t::text from campaign_insights_hora t union all
  select 'ph:' || t::text from perfil_visitas_hora t union all
  select 'ah:' || t::text from ad_insights_hora t union all
  select 'vd:' || t::text from visitas_perfil_dia t union all
  select 'sm:' || t::text from social_metas t union all
  select 'cf:' || t::text from campaign_filters t) z`

// novoMundo: a fatia de produção, as pessoas, as linhas e a sessão "impersonado" (a de soA1 aberta por
// superA1), com as rotas de `montar` atrás da MESMA cadeia do grupo de domínio de web.Rotas.
func novoMundo(t *testing.T, montar ...func(chi.Router, *pgxpool.Pool)) *mundoteste.Mundo {
	t.Helper()
	return mundoteste.Novo(t, mundoteste.Opcoes{Pessoas: pessoas, Linhas: linhasDasRedes,
		Impersonadas: map[string][2]string{"impersonado": {idSoA1, idSuperA1}}}, montar...)
}
```

- [ ] **Step 4: os testes.** `redes_test.go` com `TestMundoDasRedes` (contrato (b)) e:

```go
// A regra que o proxy e as rotas ao vivo usam (autz.PodeVerConta) é a de produção, pessoa a pessoa.
func TestPodeVerContaIgualAProducao(t *testing.T) {
	m := novoMundo(t)
	ctx := context.Background()
	viu, negou := false, false
	for _, x := range pessoas {
		e, err := autz.CarregarEscopo(ctx, m.P, x.ID)
		if err != nil {
			t.Fatal(err)
		}
		for _, c := range []string{A1, A2, A3} {
			var prod bool
			if err := banco.ComUsuario(ctx, m.P, x.ID, func(tx pgx.Tx) error {
				return tx.QueryRow(ctx, `select public.pode_ver_conta($1::text)`, c).Scan(&prod)
			}); err != nil {
				t.Fatal(err)
			}
			if got := autz.PodeVerConta(e, c); got != prod {
				t.Errorf("%s × %s: Go %v, produção %v", x.Chave, c, got, prod)
			}
			viu, negou = viu || prod, negou || !prod
		}
	}
	if !viu || !negou {
		t.Error("o mundo não mostra os dois lados de pode_ver_conta")
	}
}
```

Run: `go test -count=1 ./internal/autz/ ./internal/redes/` → FAIL de compilação antes dos Steps 1–3; PASS depois. Aplique as mutações de (b).

- [ ] **Step 5: Commit** `feat(api): autz.PodeVerConta (a regra das restritivas por conta, provada contra produção) e a fundação do pacote redes` (+ `Co-Authored-By`).

---

### Task 3: Contas — `GET /redes/contas` e `PATCH /redes/contas/{id}`

**Revisor:** opus. **Depende de:** 2.

**(a) Contrato**
- `GET /redes/contas` → `[{id, name, username, instagram_id, ad_account_id, profile_picture_url, picture_url, accent_color, persona, conteudo_usa_portal}]`, ordem `name` (padrão; `?ordem=name[.desc]`). Regra: `auth_read_accounts` (qualquer sessão; a tabela NÃO tem a restritiva em produção: Ruling 5.6-3, achado nº 1). **Nunca** `access_token` nem `publicacao_automatica` (Ruling 5.6-8). Sem filtros.
- `PATCH /redes/contas/{id}` (`soSessaoPropria`) com qualquer subconjunto de `name` (texto 1–100), `username` (texto até 100 ou `null`), `accent_color` (`#RRGGBB`), `persona` (texto até 20000 ou `null`), `conteudo_usa_portal` (booleano) → `200` com a linha (mesmas colunas do GET). Regra: `admin_update_accounts` (papel `admin`, com Ler). Outra chave (inclusive `access_token`, `publicacao_automatica`, `id`) → `400 corpo_invalido`; `{}` → 400; id inexistente ou inválido → 404; sem papel admin → 403 (a conta é visível a todos).

```go
package redes

import (
	"encoding/json"
	"errors"
	"regexp"
	"strings"
	"unicode/utf8"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/autz"
	"github.com/rbv-co/social-dashboard/api/internal/dados"
)

// colunasConta: lista FECHADA (Ruling 5.6-8). Em produção o SELECT de `authenticated` em accounts é por
// coluna e deixa de fora access_token (o token da Meta) e publicacao_automatica; a API conecta como dona
// da tabela e não tem esse freio — a lista é o freio. Nunca `t.*`.
const colunasConta = `t.id, t.name, t.username, t.instagram_id, t.ad_account_id, t.profile_picture_url, ` +
	`t.picture_url, t.accent_color, t.persona, t.conteudo_usa_portal`

// GET /redes/contas: Admin (1776, 1915, 3968, 4019), Redes (3277), Relatório (230), Conteúdo (65),
// Gestor (610), Análise de campanhas (213), Marca/Vendas (83).
var consultaContas = dados.Consulta{Tabela: "accounts", Alias: "t",
	SQL:    `select ` + colunasConta + ` from accounts t`,
	Ordens: map[string]string{"name": "t.name"}, OrdemPadrao: "t.name", Desempate: "t.id"}

// corpoConta: o que as três telas gravam — nome/@/cor (Admin 4004), persona (Gestor 1331), Portal
// (Conteúdo 499). Qualquer outra chave é recusada por dados.LerCorpo.
type corpoConta struct {
	Name              json.RawMessage `json:"name,omitempty"`
	Username          json.RawMessage `json:"username,omitempty"`
	AccentColor       json.RawMessage `json:"accent_color,omitempty"`
	Persona           json.RawMessage `json:"persona,omitempty"`
	ConteudoUsaPortal json.RawMessage `json:"conteudo_usa_portal,omitempty"`
}

var reCor = regexp.MustCompile(`^#[0-9a-fA-F]{6}$`)

// textoAte: texto de até max caracteres; nulo só se podeNulo; vazio só se !obrigatorio.
func textoAte(v json.RawMessage, max int, podeNulo, obrigatorio bool) bool {
	if string(v) == "null" {
		return podeNulo
	}
	var s string
	if json.Unmarshal(v, &s) != nil || utf8.RuneCountInString(s) > max {
		return false
	}
	return !obrigatorio || strings.TrimSpace(s) != ""
}

func (c corpoConta) Validar() error {
	var e []error
	if c.Name != nil && !textoAte(c.Name, 100, false, true) {
		e = append(e, errors.New("O nome da conta tem de 1 a 100 caracteres."))
	}
	if c.Username != nil && !textoAte(c.Username, 100, true, false) {
		e = append(e, errors.New("O @ tem até 100 caracteres."))
	}
	var cor string
	if c.AccentColor != nil && (json.Unmarshal(c.AccentColor, &cor) != nil || !reCor.MatchString(cor)) {
		e = append(e, errors.New("A cor é #RRGGBB."))
	}
	if c.Persona != nil && !textoAte(c.Persona, 20000, true, false) {
		e = append(e, errors.New("A persona tem até 20000 caracteres."))
	}
	var b bool
	// "null" em bool não dá erro no json (deixa o zero): a coluna é not null, então null é recusado à parte.
	if c.ConteudoUsaPortal != nil && (string(c.ConteudoUsaPortal) == "null" || json.Unmarshal(c.ConteudoUsaPortal, &b) != nil) {
		e = append(e, errors.New("O Portal de Notícias é ligado ou desligado."))
	}
	return errors.Join(e...)
}

var tabelaContas = dados.Tabela{Nome: "accounts", Resposta: colunasConta}

func montarContas(r chi.Router, p *pgxpool.Pool) {
	deve(tabelaContas.Validar(autz.Producao))
	r.Get("/redes/contas", consultaContas.Handler(p, autz.Producao))
	r.With(soSessaoPropria).Patch("/redes/contas/{id}", dados.RotaEditar[corpoConta](p, autz.Producao, tabelaContas))
}
```

**(b) Testes de aceitação** (`TestContas`, `m.Rodar`)
- `GET` como `todas`, `soA1`, `nenhuma`, `semModulo`, `impersonado` → 200 com A1 e A2 (paridade: Ruling 5.6-3), com `"persona":"Mulheres 30+"`, **sem** `SEGREDO`, `"access_token":` nem `"publicacao_automatica":`; `?ordem=name.desc` → Mantova antes de Vessel; `?ordem=access_token` → 400; `?select=access_token` → 400; `desativado` → 401.
- `PATCH /redes/contas/{A1}` como `adminA1` `{"persona":"Mulheres 35+"}` → 200 com a persona nova e sem `SEGREDO`; efeito: `persona` gravada, `access_token` = `SEGREDO-token-A1`. `adminA1` `PATCH` de A2 → 200 (o papel admin edita qualquer conta: `accounts` não tem a restritiva). `{"name":"Vessel Brasil","username":"vesselbr","accent_color":"#112233","conteudo_usa_portal":true}` → 200 e as quatro colunas mudam.
- Negados, com a linha intacta (`md5(accounts::text)` igual): `todas` → 403; `superA1` (super pela FICHA, papel viewer) → 403 (paridade: só papel admin); `impersonado` → 403 com "Quem entrou como outra pessoa"; `adminA1` `{"access_token":"x"}` → 400 `corpo_invalido`; `{"publicacao_automatica":false}` → 400; `{"id":"` + A2 + `"}` → 400; `{"name":""}` → 400; `{"accent_color":"vermelho"}` → 400; `{"conteudo_usa_portal":"sim"}` → 400; `{"conteudo_usa_portal":null}` → 400; `{}` → 400; `PATCH /redes/contas/` + A3 → 404; `PATCH /redes/contas/abc` → 404.
- Mutações que têm de reprovar: `t.access_token` acrescentado a `colunasConta` (o GET mostra `SEGREDO`); `Name` com `obrigatorio=false`; tirar `soSessaoPropria`.

**(c) Arquivos:** Create `api/internal/redes/contas.go`, `api/internal/redes/contas_test.go`.

**(d) Dependências:** Task 2; `dados.RotaEditar/Tabela`.

- [ ] **Step 1:** Testes; ver falhar. - [ ] **Step 2:** Implementar (código de (a)). - [ ] **Step 3:** `gofmt -l ./internal && go vet ./internal/redes/ && go test -count=1 ./internal/redes/` PASS; mutações reprovam. - [ ] **Step 4:** Commit `feat(api): contas da Meta com colunas fechadas (o token nunca sai) e edição só por papel admin` (+ `Co-Authored-By`).

---

### Task 4: Orgânico — seguidores, leituras de seguidores, engajamento, conteúdo

**Revisor:** sonnet. **Depende de:** 2.

**(a) Contrato** (só declarações; a regra é `auth_read_*` + a restritiva `pode_ver_conta` de cada tabela)

```go
package redes

import (
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/autz"
	"github.com/rbv-co/social-dashboard/api/internal/dados"
)

// GET /redes/seguidores (daily_snapshots): Admin (1778 ?captured_at=hoje; 4029 ?contar=1&limite=1;
// 4033 ?account_id=&ordem=captured_at.desc&limite=1), Redes (2106 ?account_id=&captured_at_de=&captured_at_ate=
// &ordem=captured_at; 2116; 3557 …&limite=100), Relatório (157, 163).
var consultaSeguidores = dados.Consulta{Tabela: "daily_snapshots", Alias: "t",
	SQL:     `select t.account_id, t.captured_at, t.followers_count, t.gained, t.lost from daily_snapshots t`,
	Filtros: append([]dados.Filtro{filtroConta}, filtrosDeData("captured_at")...),
	Ordens:  map[string]string{"captured_at": "t.captured_at"}, OrdemPadrao: "t.captured_at", Desempate: "t.account_id"}

// GET /redes/leituras-de-seguidores (followers_leituras): Gestor (746), OPR (307), Por hora (316), todos
// com ?account_id=&lido_em_de=<instante>&ordem=lido_em.
var consultaLeituras = dados.Consulta{Tabela: "followers_leituras", Alias: "t",
	SQL: `select t.id, t.account_id, t.followers_count, t.lido_em, t.origem from followers_leituras t`,
	Filtros: []dados.Filtro{filtroConta,
		{Param: "lido_em_de", SQL: "t.lido_em >= @lido_em_de::timestamptz", Tipo: "instante"}},
	Ordens: map[string]string{"lido_em": "t.lido_em"}, OrdemPadrao: "t.lido_em", Desempate: "t.id"}

// GET /redes/engajamento (engagement_snapshots): Admin (1777 ?captured_at=hoje; 4030 contagem), Redes
// (2107, 2108 ?account_id=&period_days=&captured_at_ate=&ordem=captured_at.desc&limite=1), Relatório (158).
var consultaEngajamento = dados.Consulta{Tabela: "engagement_snapshots", Alias: "t",
	SQL: `select t.account_id, t.captured_at, t.period_days, t.likes, t.comments, t.saves, t.shares, t.reach,
	  t.views, t.total_interactions, t.accounts_engaged, t.profile_views, t.created_at from engagement_snapshots t`,
	Filtros: append([]dados.Filtro{filtroConta, filtroPeriodo}, filtrosDeData("captured_at")...),
	Ordens:  map[string]string{"captured_at": "t.captured_at"}, OrdemPadrao: "t.captured_at, t.account_id", Desempate: "t.period_days"}

// GET /redes/conteudo (content_snapshots): Admin (4031 contagem), Redes (2109, 2110, 2112, 2113;
// 3323 ?captured_at=hoje&period_days_ate=1&ordem=period_days), Relatório (159).
var consultaConteudo = dados.Consulta{Tabela: "content_snapshots", Alias: "t",
	SQL: `select t.account_id, t.captured_at, t.period_days, t.posts_count, t.reels_count, t.stories_count,
	  t.story_shares, t.story_replies, t.story_reach, t.story_interactions, t.story_navigation, t.story_nav_forward,
	  t.story_nav_back, t.story_nav_exit, t.story_nav_next, t.story_profile_visits, t.story_follows from content_snapshots t`,
	Filtros: append([]dados.Filtro{filtroConta, filtroPeriodo,
		{Param: "period_days_ate", SQL: "t.period_days <= @period_days_ate::bigint", Tipo: "inteiro"}},
		filtrosDeData("captured_at")...),
	Ordens:      map[string]string{"captured_at": "t.captured_at", "period_days": "t.period_days"},
	OrdemPadrao: "t.captured_at, t.account_id", Desempate: "t.period_days"}

func montarOrganico(r chi.Router, p *pgxpool.Pool) {
	r.Get("/redes/seguidores", consultaSeguidores.Handler(p, autz.Producao))
	r.Get("/redes/leituras-de-seguidores", consultaLeituras.Handler(p, autz.Producao))
	r.Get("/redes/engajamento", consultaEngajamento.Handler(p, autz.Producao))
	r.Get("/redes/conteudo", consultaConteudo.Handler(p, autz.Producao))
}
```

**(b) Testes de aceitação** (`TestOrganico`, `m.Rodar`)
- Matriz por conta, nas quatro rotas: `todas`, `adminA1`, `superA1`, `semModulo` → A1 e A2; `soA1`, `emailA1`, `horaA1`, `impersonado` → só A1; `nenhuma` → `[]`; `desativado` → 401.
- Filtros e ordens: `seguidores?account_id=A1&captured_at_de=2026-10-11` → só a de 1004; `?account_id=A1&ordem=captured_at.desc&limite=1` → 1004; `?captured_at=2026-10-11&contar=1&limite=1` como `todas` → `X-Total-Count: 2`, como `soA1` → `1`; `leituras-de-seguidores?account_id=A1&lido_em_de=2026-10-11T00:00:00Z&ordem=lido_em` → 1 linha com `"origem":"hora"`; `engajamento?account_id=A1&period_days=7&captured_at_ate=2026-10-11&ordem=captured_at.desc&limite=1` → `"reach":100`; `conteudo?captured_at=2026-10-11&period_days_ate=1&ordem=period_days` como `soA1` → as duas de A1, period 0 antes de 1, com `"story_replies":4`.
- IDOR: `soA1` `?account_id=` + A2 em cada rota → `[]`; `?account_id=` + A2 + `&contar=1&limite=1` → `X-Total-Count: 0`.
- 400: `?period_days=sete`, `?captured_at=ontem`, `?account_id=x`, `?lido_em_de=2026-10-11` (instante sem hora: RFC 3339, Ruling 5.6-15), `?limite=1001`, `?ordem=followers_count`.

**(c) Arquivos:** Create `api/internal/redes/organico.go`, `api/internal/redes/organico_test.go`.

**(d) Dependências:** Task 2.

- [ ] **Step 1:** Testes; ver falhar. - [ ] **Step 2:** Implementar. - [ ] **Step 3:** gofmt/vet/test PASS. - [ ] **Step 4:** Commit `feat(api): leituras do orgânico (seguidores, leituras, engajamento e conteúdo) com o recorte por conta` (+ `Co-Authored-By`).

---

### Task 5: Anúncios — campanhas, conjuntos, anúncios, insights de campanha e da conta

**Revisor:** opus (dinheiro: `spend`). **Depende de:** 2.

**(a) Contrato** (só declarações; `numeric` sai como número JSON montado pelo Postgres, igual ao PostgREST: nenhum gasto passa por `float64` em Go)

```go
package redes

// GET /redes/campanhas (campaigns): Redes (2121 ?account_id=; 3785 ?account_id= na ordem padrão status,
// nome; 3898), OPR (305) e Por hora (315) sem filtro. A campanha sem conta é visível a todos (pode_ver_conta(null)).
var consultaCampanhas = dados.Consulta{Tabela: "campaigns", Alias: "t",
	SQL:     `select t.campaign_id, t.account_id, t.name, t.objective, t.status, t.synced_at from campaigns t`,
	Filtros: []dados.Filtro{filtroConta},
	OrdemPadrao: "t.status, t.name", Desempate: "t.campaign_id"}

// GET /redes/conjuntos (campaign_adsets): Redes (2122 ?account_id=).
var consultaConjuntos = dados.Consulta{Tabela: "campaign_adsets", Alias: "t",
	SQL:     `select t.adset_id, t.campaign_id, t.account_id, t.destination_type, t.optimization_goal, t.synced_at from campaign_adsets t`,
	Filtros: []dados.Filtro{filtroConta},
	OrdemPadrao: "t.campaign_id", Desempate: "t.adset_id"}

// GET /redes/anuncios (ads): Por hora (318 ?account_id=).
var consultaAnuncios = dados.Consulta{Tabela: "ads", Alias: "t",
	SQL:     `select t.ad_id, t.campaign_id, t.account_id, t.name, t.status, t.destino_link, t.synced_at from ads t`,
	Filtros: []dados.Filtro{filtroConta},
	OrdemPadrao: "t.name", Desempate: "t.ad_id"}

// GET /redes/insights-de-campanha (campaign_insights): Redes (2280 ?account_id=&period_days=0&captured_at_de=
// &captured_at_ate=&ordem=captured_at; 2458/2459 …&campaign_id=a,b&ordem=captured_at.desc), Relatório (154),
// Gestor (1024 ?captured_at_de= de todas as contas), OPR (306). Ordem padrão: mais nova primeiro (o corte
// do teto, se houver, leva as mais antigas: Ruling 5.6-11).
var consultaInsightsDeCampanha = dados.Consulta{Tabela: "campaign_insights", Alias: "t",
	SQL: `select t.campaign_id, t.account_id, t.captured_at, t.period_days, t.spend, t.impressions, t.clicks, t.reach,
	  t.post_engagement, t.likes, t.comments, t.shares, t.saves, t.conversas, t.cadastros, t.compras, t.visitas
	  from campaign_insights t`,
	Filtros: append([]dados.Filtro{filtroConta, filtroPeriodo,
		{Param: "campaign_id", SQL: "t.campaign_id = any(@campaign_id::text[])", Tipo: "texto[]"}},
		filtrosDeData("captured_at")...),
	Ordens:      map[string]string{"captured_at": "t.captured_at"},
	OrdemPadrao: "t.captured_at desc, t.account_id, t.period_days", Desempate: "t.campaign_id"}

// GET /redes/insights-da-conta (account_insights): Redes (2518 ?account_id=&period_days=&captured_at_ate=
// &ordem=captured_at.desc&limite=1).
var consultaInsightsDaConta = dados.Consulta{Tabela: "account_insights", Alias: "t",
	SQL: `select t.account_id, t.captured_at, t.period_days, t.spend, t.impressions, t.clicks, t.reach, t.frequency
	  from account_insights t`,
	Filtros:     append([]dados.Filtro{filtroConta, filtroPeriodo}, filtrosDeData("captured_at")...),
	Ordens:      map[string]string{"captured_at": "t.captured_at"},
	OrdemPadrao: "t.captured_at desc, t.account_id", Desempate: "t.period_days"}

func montarAnuncios(r chi.Router, p *pgxpool.Pool) // 5 GET: /redes/campanhas, /conjuntos, /anuncios, /insights-de-campanha, /insights-da-conta
```

**(b) Testes de aceitação** (`TestAnuncios`, `m.Rodar`)
- Matriz por conta nas cinco: `todas`, `adminA1`, `superA1`, `semModulo` → A1 e A2; `soA1`, `emailA1`, `horaA1`, `impersonado` → só A1; `nenhuma` → `[]` em todas, **exceto** `/redes/campanhas` → só a `9000` (sem conta), sem `9001`/`9002`.
- Gasto exato: `insights-de-campanha?account_id=A1&period_days=0&captured_at=2026-10-11` → `"spend":1234.56`; `insights-da-conta?account_id=A1&period_days=7&ordem=captured_at.desc&limite=1` → `"spend":1334.66,` e `"frequency":3.33`.
- Lista de campanhas: `soA1` `insights-de-campanha?campaign_id=9001,9002` → só as linhas de `9001` (a de A2 não aparece por pedir o id); `?campaign_id=` (vazio) → 400.
- Ordem padrão: `todas` `insights-de-campanha` → `2026-10-11` antes de `2026-10-10`; `?ordem=captured_at` → ao contrário. `campanhas?account_id=A1` como `todas` → `9001`; padrão `status, name` → `ACTIVE` antes de `PAUSED`.
- Contagem sob a regra: `soA1` `insights-de-campanha?contar=1&limite=1` → `X-Total-Count: 2`; `todas` → `3`.
- IDOR: `soA1` `?account_id=` + A2 → `[]` nas cinco; `nenhuma` `?campaign_id=9002` → `[]`.
- 400: `?period_days=x`, `?captured_at_de=10/10/2026`, `?limite=5000` (o teto: Ruling 5.6-11), `?ordem=spend`.
- Mutações que têm de reprovar: `OrdemPadrao` de `insights-de-campanha` sem o `desc` (o caso da ordem padrão acusa); tirar `filtroPeriodo` de `insights-da-conta` (`?period_days=7` vira 400).

**(c) Arquivos:** Create `api/internal/redes/anuncios.go`, `api/internal/redes/anuncios_test.go`.

**(d) Dependências:** Task 2.

- [ ] **Step 1:** Testes; ver falhar. - [ ] **Step 2:** Implementar. - [ ] **Step 3:** gofmt/vet/test PASS; mutação reprova. - [ ] **Step 4:** Commit `feat(api): leituras de campanhas, conjuntos, anúncios e insights com o recorte por conta e o gasto exato` (+ `Co-Authored-By`).

---

### Task 6: Por hora — campanhas, anúncios e visitas

**Revisor:** opus (dinheiro; regra dupla). **Depende de:** 2.

**(a) Contrato.** Regra de produção em `campaign_insights_hora`, `ad_insights_hora` e `perfil_visitas_hora`: permissiva "perfil com papel `admin`, super pela FICHA ou `permissions ? 'meta.hora'`" **E** a restritiva `pode_ver_conta` (compiladas do catálogo; nada escrito à mão). Tela: Relatório por hora (`tela-de-relatorio-por-hora.vue:314, 317, 319`, todas com `?account_id=<Vessel>&dia_de=<data>` na ordem padrão `dia desc, hora asc`).

```go
package redes

var filtroDiaDe = dados.Filtro{Param: "dia_de", SQL: "t.dia >= @dia_de::date", Tipo: "data"}

var consultaCampanhasPorHora = dados.Consulta{Tabela: "campaign_insights_hora", Alias: "t",
	SQL: `select t.campaign_id, t.account_id, t.dia, t.hora, t.gasto_acumulado, t.gasto_hora, t.conversas_acumuladas,
	  t.conversas_hora, t.cliques_acumulados, t.cliques_hora from campaign_insights_hora t`,
	Filtros: []dados.Filtro{filtroConta, filtroDiaDe}, OrdemPadrao: "t.dia desc, t.hora, t.account_id", Desempate: "t.campaign_id"}

var consultaAnunciosPorHora = dados.Consulta{Tabela: "ad_insights_hora", Alias: "t",
	SQL: `select t.ad_id, t.campaign_id, t.account_id, t.dia, t.hora, t.gasto_acumulado, t.gasto_hora,
	  t.cliques_acumulados, t.cliques_hora from ad_insights_hora t`,
	Filtros: []dados.Filtro{filtroConta, filtroDiaDe}, OrdemPadrao: "t.dia desc, t.hora, t.account_id", Desempate: "t.ad_id"}

var consultaVisitasPorHora = dados.Consulta{Tabela: "perfil_visitas_hora", Alias: "t",
	SQL:     `select t.account_id, t.dia, t.hora, t.visitas_acumuladas, t.visitas_hora from perfil_visitas_hora t`,
	Filtros: []dados.Filtro{filtroConta, filtroDiaDe}, OrdemPadrao: "t.dia desc, t.hora", Desempate: "t.account_id"}

func montarHora(r chi.Router, p *pgxpool.Pool) // GET /redes/campanhas-por-hora, /redes/anuncios-por-hora, /redes/visitas-por-hora
```

**(b) Testes de aceitação** (`TestPorHora`, `m.Rodar`)
- Regra dupla, nas três: `adminA1`, `superA1` → A1 e A2; `horaA1` → só A1; `todas` (sem `meta.hora`), `soA1`, `nenhuma`, `emailA1` (super por E-MAIL: a permissiva lê a ficha), `semModulo`, `impersonado` (o alvo `soA1` não tem `meta.hora`, embora quem entrou como ele seja super) → `[]`; `desativado` → 401.
- Ordem e valores: `horaA1` `campanhas-por-hora?account_id=A1&dia_de=2026-10-11` → hora 9 antes de 10, `"gasto_hora":12.50` e `"gasto_hora":7.50` (o `numeric(12,2)` chega com as duas casas, como no PostgREST); `anuncios-por-hora` → `"gasto_hora":3.25,` e `"cliques_hora":4`; `visitas-por-hora` → `"visitas_hora":11`.
- Contagem: `horaA1` `campanhas-por-hora?contar=1&limite=1` → `X-Total-Count: 2`; `todas` → `0`.
- IDOR: `horaA1` `?account_id=` + A2 → `[]` nas três.
- 400: `?dia_de=hoje`, `?ordem=hora`, `?hora=9`.

**(c) Arquivos:** Create `api/internal/redes/hora.go`, `api/internal/redes/hora_test.go`.

**(d) Dependências:** Task 2.

- [ ] **Step 1:** Testes; ver falhar. - [ ] **Step 2:** Implementar. - [ ] **Step 3:** gofmt/vet/test PASS. - [ ] **Step 4:** Commit `feat(api): leituras por hora com a regra dupla de produção (meta.hora e conta)` (+ `Co-Authored-By`).

---

### Task 7: Escolhas — metas e filtros de campanha

**Revisor:** opus. **Depende de:** 2.

**(a) Contrato**
- `GET /redes/metas` (`?account_id=` texto) → `[{account_id, periodo, indicador, valor}]` (Redes 1364). `GET /redes/filtros-de-campanha` (`?account_id=` uuid) → `[{account_id, selected_ids, updated_at}]` (Redes 2111, 3786, 3897).
- `PUT /redes/metas` (`soSessaoPropria`) `{"metas":[{"account_id":"<uuid>","periodo":"<a-z0-9_ até 20>","indicador":"<a-z0-9_. até 80>","valor":<número>}, …]}` (1 a 50 itens; todas as chaves obrigatórias) → `200` com o array das linhas gravadas. Cada item é um upsert por `(account_id, periodo, indicador)`; o lote é UMA transação: um item recusado = `403` e nada gravado (Ruling 5.6-7). Substitui o `.upsert(payload, {onConflict})` de Redes 1359.
- `PUT /redes/filtros-de-campanha/{account_id}` (`soSessaoPropria`) `{"selected_ids": null | ["<dígitos>", …]}` (chave obrigatória; `null` = todas as campanhas, `[]` = nenhuma; até 2000) → `200 {account_id, selected_ids, updated_at}`; `updated_at` = relógio do servidor (Ruling 5.6-13). `{account_id}` que não é uuid → 404. Substitui os dois `POST … merge-duplicates` de Redes 3830 e 3853.
- Regra das duas escritas = catálogo (`social_metas_write`/`auth_write_filters`: qualquer sessão) com a semântica do upsert sob a RLS (`upsertVisivel`, abaixo): conta invisível = `403`, igual para "a linha existe e é de outra conta" e "a linha não existe e eu não a veria".

```go
package redes

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"maps"
	"math"
	"net/http"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/autz"
	"github.com/rbv-co/social-dashboard/api/internal/banco"
	"github.com/rbv-co/social-dashboard/api/internal/dados"
)

const (
	colunasMeta   = `account_id, periodo, indicador, valor`
	colunasFiltro = `account_id, selected_ids, updated_at`
)

var consultaMetas = dados.Consulta{Tabela: "social_metas", Alias: "t",
	SQL:     `select t.account_id, t.periodo, t.indicador, t.valor from social_metas t`,
	Filtros: []dados.Filtro{filtroContaTexto}, OrdemPadrao: "t.account_id, t.periodo", Desempate: "t.indicador"}

var consultaFiltros = dados.Consulta{Tabela: "campaign_filters", Alias: "t",
	SQL:     `select t.account_id, t.selected_ids, t.updated_at from campaign_filters t`,
	Filtros: []dados.Filtro{filtroConta}, OrdemPadrao: "t.updated_at", Desempate: "t.account_id"}

var (
	reUUID      = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)
	rePeriodo   = regexp.MustCompile(`^[a-z0-9_]{1,20}$`)
	reIndicador = regexp.MustCompile(`^[a-z0-9_.]{1,80}$`)
	reIDDaMeta  = regexp.MustCompile(`^[0-9]{1,30}$`) // id de campanha da Meta
)

// upsertVisivel: INSERT … ON CONFLICT DO UPDATE com a semântica que o PostgREST tinha sob a RLS de
// produção (a tela fazia .upsert / resolution=merge-duplicates): (1) a linha nova passa no WITH CHECK de
// criar (PodeCriar) E na regra de LER e de editar sobre ela (EditarNova: num upsert o Postgres confere as
// policies de SELECT na linha proposta — é isso que barrava a conta invisível); (2) a linha que já existe
// só muda se quem pede a lê e a edita (WHERE do DO UPDATE). Fora disso, autz.ErrNegado — igual para "existe
// e é de outra conta" e "não existe e não se veria" (sem oráculo; Ruling 5.6-7). `linha` é o MESMO mapa
// que vai às conferências e ao INSERT (jsonb_populate_record); tabela, chave e resposta são da rota, nunca
// do pedido. Roda na tx de banco.ComUsuario de quem pede.
func upsertVisivel(ctx context.Context, tx pgx.Tx, e *autz.Escopo, tab string, chave []string, linha map[string]any, resposta string) ([]byte, error) {
	if err := autz.Producao.PodeCriar(ctx, tx, e, tab, linha); err != nil {
		return nil, err
	}
	fn, err := autz.Producao.Filtro(e, tab, autz.EditarNova, "autz_nova")
	if err != nil {
		return nil, err
	}
	if ok, err := autz.Conferir(ctx, tx, fn, tab, linha); err != nil || !ok {
		if err == nil {
			err = autz.ErrNegado
		}
		return nil, err
	}
	fl, err := autz.Producao.Filtro(e, tab, autz.Ler, tab)
	if err != nil {
		return nil, err
	}
	fe, err := autz.Producao.Filtro(e, tab, autz.Editar, tab)
	if err != nil {
		return nil, err
	}
	var lista, sets, alvo []string
	for _, c := range slices.Sorted(maps.Keys(linha)) {
		id := pgx.Identifier{c}.Sanitize()
		lista = append(lista, id)
		if !slices.Contains(chave, c) {
			sets = append(sets, id+" = excluded."+id)
		}
	}
	for _, c := range chave {
		alvo = append(alvo, pgx.Identifier{c}.Sanitize())
	}
	j, err := json.Marshal(linha)
	if err != nil {
		return nil, err
	}
	t, l := pgx.Identifier{tab}.Sanitize(), strings.Join(lista, ", ")
	var corpo []byte
	err = tx.QueryRow(ctx, `with n as (insert into `+t+` (`+l+`) select `+l+` from jsonb_populate_record(null::`+t+`, @linha::jsonb)
		on conflict (`+strings.Join(alvo, ", ")+`) do update set `+strings.Join(sets, ", ")+`
		  where (`+fl.SQL+`) and (`+fe.SQL+`)
		returning `+resposta+`) select row_to_json(n) from n`,
		fe.Juntar(fl.Juntar(pgx.NamedArgs{"linha": string(j)}))).Scan(&corpo)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, autz.ErrNegado // a linha existe e quem pede não a lê ou não a edita: fica como estava
	}
	return corpo, err
}

type corpoMetas struct {
	Metas []struct {
		AccountID string          `json:"account_id"`
		Periodo   string          `json:"periodo"`
		Indicador string          `json:"indicador"`
		Valor     json.RawMessage `json:"valor"`
	} `json:"metas"`
}

// numeroDaMeta: o valor tem de ser número JSON finito; volta o texto exato (json.Number) para o numeric
// não passar por float64 (Ruling 5.6-13).
func numeroDaMeta(v json.RawMessage) (json.Number, bool) {
	d := json.NewDecoder(bytes.NewReader(v))
	d.UseNumber()
	var x any
	if d.Decode(&x) != nil {
		return "", false
	}
	n, ok := x.(json.Number)
	if !ok {
		return "", false
	}
	f, err := strconv.ParseFloat(string(n), 64)
	return n, err == nil && !math.IsInf(f, 0)
}

// gravarMetas: PUT /redes/metas. Lote atômico (Ruling 5.6-7).
func gravarMetas(p *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		e := autz.EscopoDo(r.Context())
		if e == nil {
			dados.Erro(w, http.StatusInternalServerError, "erro_interno", "")
			return
		}
		var in corpoMetas
		if !dados.LerCorpo(w, r, &in) {
			return
		}
		if len(in.Metas) == 0 || len(in.Metas) > 50 {
			dados.Erro(w, http.StatusBadRequest, "pedido_invalido", "Mande de 1 a 50 metas.")
			return
		}
		linhas := make([]map[string]any, 0, len(in.Metas))
		for _, m := range in.Metas {
			valor, ok := numeroDaMeta(m.Valor)
			if !reUUID.MatchString(m.AccountID) || !rePeriodo.MatchString(m.Periodo) || !reIndicador.MatchString(m.Indicador) || !ok {
				dados.Erro(w, http.StatusBadRequest, "pedido_invalido", "Meta com conta, período, indicador ou valor inválido.")
				return
			}
			linhas = append(linhas, map[string]any{"account_id": m.AccountID, "periodo": m.Periodo, "indicador": m.Indicador, "valor": valor})
		}
		ctx := r.Context()
		saida := make([]string, 0, len(linhas))
		err := banco.ComUsuario(ctx, p, e.ID, func(tx pgx.Tx) error {
			for _, l := range linhas {
				b, err := upsertVisivel(ctx, tx, e, "social_metas", []string{"account_id", "periodo", "indicador"}, l, colunasMeta)
				if err != nil {
					return err // uma recusada desfaz o lote inteiro
				}
				saida = append(saida, string(b))
			}
			return nil
		})
		if err != nil {
			dados.ErroDeEscrita(w, err)
			return
		}
		dados.Responder(w, http.StatusOK, []byte("["+strings.Join(saida, ",")+"]"))
	}
}

// gravarFiltro: PUT /redes/filtros-de-campanha/{account_id} {selected_ids}.
func gravarFiltro(p *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		e := autz.EscopoDo(r.Context())
		if e == nil {
			dados.Erro(w, http.StatusInternalServerError, "erro_interno", "")
			return
		}
		conta := chi.URLParam(r, "account_id")
		if !reUUID.MatchString(conta) {
			dados.Erro(w, http.StatusNotFound, "nao_encontrado", "")
			return
		}
		var in struct {
			SelectedIDs json.RawMessage `json:"selected_ids"`
		}
		if !dados.LerCorpo(w, r, &in) {
			return
		}
		var ids []string
		if in.SelectedIDs == nil || (string(in.SelectedIDs) != "null" && (json.Unmarshal(in.SelectedIDs, &ids) != nil ||
			len(ids) > 2000 || slices.ContainsFunc(ids, func(s string) bool { return !reIDDaMeta.MatchString(s) }))) {
			dados.Erro(w, http.StatusBadRequest, "pedido_invalido", "selected_ids: null (todas) ou lista de ids de campanha.")
			return
		}
		linha := map[string]any{"account_id": conta, "selected_ids": in.SelectedIDs,
			"updated_at": time.Now().UTC().Format(time.RFC3339Nano)}
		ctx := r.Context()
		var corpo []byte
		err := banco.ComUsuario(ctx, p, e.ID, func(tx pgx.Tx) (err error) {
			corpo, err = upsertVisivel(ctx, tx, e, "campaign_filters", []string{"account_id"}, linha, colunasFiltro)
			return err
		})
		if err != nil {
			dados.ErroDeEscrita(w, err)
			return
		}
		dados.Responder(w, http.StatusOK, corpo)
	}
}

func montarEscolhas(r chi.Router, p *pgxpool.Pool) {
	r.Get("/redes/metas", consultaMetas.Handler(p, autz.Producao))
	r.With(soSessaoPropria).Put("/redes/metas", gravarMetas(p))
	r.Get("/redes/filtros-de-campanha", consultaFiltros.Handler(p, autz.Producao))
	r.With(soSessaoPropria).Put("/redes/filtros-de-campanha/{account_id}", gravarFiltro(p))
}
```

**(b) Testes de aceitação** (`TestMetas`, `TestFiltrosDeCampanha`, `m.Rodar`; "intacto" = `md5` de `social_metas`/`campaign_filters` igual ao de antes)
- Leituras: `soA1` `GET /redes/metas` → só A1 (`"valor":100`); `?account_id=` + A2 → `[]`; `nenhuma` → `[]`; `todas` → as duas. Filtros: `soA1` → só A1 com `"selected_ids":["9001"]`; `?account_id=` + A2 → `[]`.
- Metas, permitido: `soA1` `PUT {"metas":[{"account_id":A1,"periodo":"1","indicador":"seguidores","valor":150},{"account_id":A1,"periodo":"7","indicador":"seguidores.cps","valor":1.25}]}` → 200 com as duas; efeito: `valor` 150 na existente e a nova com `1.25` exato (`valor::text = '1.25'`). `todas` grava A2 → 200.
- Metas, negado e intacto: `soA1` só com A2 (existente) → 403; `soA1` A2 com período novo `"30"` → 403 e a linha NÃO existe (criar o que não se veria); **lote `[A1 válido, A2]` → 403 e o 150 continua 100 / nada novo** (atômico); `nenhuma` com A1 → 403; `impersonado` → 403 com "Quem entrou como outra pessoa"; `{"metas":[]}`, 51 itens, `"valor":"150"` (texto), `"valor":null`, `"periodo":"Um Mês"`, `"account_id":"x"`, chave a mais (`"id":1`), item sem `valor` → 400.
- Filtros: `soA1` `PUT /redes/filtros-de-campanha/` + A1 `{"selected_ids":["9001","9003"]}` → 200 com os dois e `updated_at` posterior a `2026-10-01`; `{"selected_ids":null}` → 200 e a coluna fica nula; `{"selected_ids":[]}` → 200 e `{}`. Negado e intacto: `soA1` em A2 → 403; `soA1` em A3 (não existe) → 403 igual; `nenhuma` em A1 → 403; `impersonado` → 403; `{}` (sem a chave) → 400; `["abc"]` → 400; 2001 ids → 400; `{"selected_ids":[],"updated_at":"x"}` → 400 `corpo_invalido`; `PUT …/filtros-de-campanha/abc` → 404.
- Mutações que têm de reprovar: tirar a conferência `EditarNova` (o `soA1` cria a meta de A2 do período `"30"`); gravar cada item em sua própria `ComUsuario` (o lote misto deixa o 150 gravado); trocar `upsertVisivel` por `insert … on conflict do nothing` + `Editar` (o caminho do `Tabela.Gravar` do 5.5): o `soA1` cria o filtro de uma conta sem linha que não vê (Ruling 5.6-16). O `where (…) and (…)` do `on conflict` é defesa em profundidade: com a conta na chave de conflito, a `EditarNova` já barra (nenhuma mutação o isola hoje; se a regra passar a ler outra coluna, é ele que segura).

**(c) Arquivos:** Create `api/internal/redes/escolhas.go`, `api/internal/redes/escolhas_test.go`.

**(d) Dependências:** Task 2; `autz.Producao.PodeCriar/Filtro`, `autz.Conferir`, `banco.ComUsuario`, `dados.LerCorpo/Erro/ErroDeEscrita/Responder`.

- [ ] **Step 1:** Testes; ver falhar. - [ ] **Step 2:** Implementar (código de (a)). - [ ] **Step 3:** gofmt/vet/test PASS; mutações reprovam. - [ ] **Step 4:** Commit `feat(api): metas e filtros de campanha por upsert com a semântica da RLS (lote atômico, conta invisível = 403)` (+ `Co-Authored-By`).

---

### Task 8: `meta-proxy` e rotas ao vivo com o escopo de contas (Ruling 34)

**Revisor:** opus. **Depende de:** 2 (só `autz.PodeVerConta`/`VeTodasAsContas`). **É a única task que altera código do Plano 3** (`internal/meta/proxy.go`, `ao_vivo.go` e a fixture de teste; `web/rotas.go` só ganha o `autz.ComEscopo(p)` nas 4 rotas).

**(a) Contrato**
- As 4 rotas passam por `autz.ComEscopo(p)` (depois do `ExigirModulo`). Sem escopo no contexto = falha fechada (conta recusada e `slog.Error`).
- **`POST /meta-proxy`**, nesta ordem, ANTES de qualquer pedido ao core:
  1. sessão de "entrar como" com `method` `POST`/`DELETE` ou com `imageFromUrl`/`videoFromUrl` → `403 {"error":"sem_permissao","mensagem":"Quem entrou como outra pessoa só consulta."}` (Ruling 5.6-6; `GET` continua);
  2. `accountId` que a pessoa não vê (`autz.PodeVerConta`) ou que não existe → `400 {"error":"conta nao encontrada"}`, idênticos (Ruling 34);
  3. quem NÃO vê todas as contas (`!autz.VeTodasAsContas`): o `path` tem de morar na conta do pedido — `act_<ad_account_id dela>` (com ou sem `act_` no cadastro), `<instagram_id dela>` ou `search`, seguido só de nomes de aresta (`/insights`, `/campaigns`, `/media`…); senão `403 {"error":"caminho fora da conta"}` (Ruling 5.6-5);
  4. o resto como hoje (SSRF de mídia, core, respostas).
- **`/insights-ao-vivo`, `/serie-novos-dia`, `/contar-collabs`:** conta que a pessoa não vê = a resposta de conta inexistente de cada uma (`404 {"meta_erro":"conta não encontrada"}`; `404 {"erro":"conta não encontrada"}` nas outras duas), sem chamar o core. Os atalhos de hoje (`dias` vazio, `since`/`until` vazios) continuam antes da checagem (não leem nada da conta). Os caminhos dessas rotas já vêm do banco (`instagram_id`/`ad_account_id` da conta), então não precisam de âncora.

`api/internal/meta/escopo.go`:

```go
package meta

import (
	"log/slog"
	"net/http"
	"regexp"
	"strings"

	"github.com/rbv-co/social-dashboard/api/internal/autz"
)

// contaVisivel: a conta do pedido passa na MESMA regra das tabelas dela (pode_ver_conta; Ruling 34 do
// mestre, estendido às rotas ao vivo pelo 5.6-4). Sem escopo no contexto (rota montada fora de
// autz.ComEscopo) nega e avisa: falha fechada.
func contaVisivel(r *http.Request, conta string) bool {
	e := autz.EscopoDo(r.Context())
	if e == nil {
		slog.Error("meta: rota sem autz.ComEscopo; conta recusada", "rota", r.URL.Path)
		return false
	}
	return autz.PodeVerConta(e, conta)
}

// reCaminhoAncorado: o caminho que quem tem lista de contas pode pedir — /act_<n>, /<n> ou /search,
// seguido só de nomes de aresta. Sem versão, "..", "%", "?", vírgula, maiúscula ou id depois da raiz.
var reCaminhoAncorado = regexp.MustCompile(`^/?(act_[0-9]+|[0-9]+|search)(/[a-z_]+)*/?$`)

// caminhoDaConta (Ruling 5.6-5): o token do core é um só e alcança TODAS as contas; sem âncora, um
// accountId permitido com o caminho de outra conta lia a outra. Vale só para quem não vê todas as contas.
// ponytail: objeto solto (/<campanha>, /<anúncio>, /me/…) é negado a quem tem lista; olhar
// campaigns/ads/campaign_adsets da conta quando alguém com lista precisar editar campanha pelo Gestor.
func caminhoDaConta(caminho, adAccount, instagram string) bool {
	m := reCaminhoAncorado.FindStringSubmatch(caminho)
	if m == nil {
		return false
	}
	switch raiz := m[1]; {
	case raiz == "search":
		return true // busca de segmentação: não lê dado de conta
	case strings.HasPrefix(raiz, "act_"):
		return adAccount != "" && strings.TrimPrefix(raiz, "act_") == strings.TrimPrefix(adAccount, "act_")
	default:
		return instagram != "" && raiz == instagram
	}
}
```

Em `api/internal/meta/proxy.go` (imports `autz`, `auth`, `dados`, `pgx`), troque o bloco que vai de `var existe bool` até o `if !existe { … }` por:

```go
	metodo := strings.ToUpper(in.Method)
	escreve := metodo == "POST" || metodo == "DELETE" || in.ImageFromURL != "" || in.VideoFromURL != ""
	if a := auth.AtorDoContexto(r.Context()); escreve && (a == nil || a.ImpersonadorID != nil) {
		// Ruling 5.6-6: criar campanha, subir mídia e apagar na Meta gastam dinheiro em nome de alguém.
		responder(w, http.StatusForbidden, map[string]string{"error": "sem_permissao", "mensagem": dados.FraseEntrarComo})
		return
	}
	if !contaVisivel(r, conta) { // Ruling 34: conta que a pessoa não vê responde igual à que não existe
		erro(w, http.StatusBadRequest, "conta nao encontrada")
		return
	}
	var adAcc, ig *string
	err := p.Pool.QueryRow(r.Context(), `select ad_account_id::text, instagram_id::text from accounts where id::text = $1`, conta).Scan(&adAcc, &ig)
	if errors.Is(err, pgx.ErrNoRows) {
		erro(w, http.StatusBadRequest, "conta nao encontrada")
		return
	}
	if err != nil {
		slog.Error("meta-proxy: consulta de conta falhou", "erro", err)
		erro(w, http.StatusInternalServerError, "erro_interno")
		return
	}
	texto := func(s *string) string {
		if s == nil {
			return ""
		}
		return *s
	}
	if !autz.VeTodasAsContas(autz.EscopoDo(r.Context())) && !caminhoDaConta(in.Path, texto(adAcc), texto(ig)) {
		erro(w, http.StatusForbidden, "caminho fora da conta")
		return
	}
```

Em `api/internal/meta/ao_vivo.go`: em `Insights`, logo depois de montar `campanhas` e antes da consulta de `accounts`, `if !contaVisivel(r, textoDe(in["account_id"])) { responder(w, http.StatusNotFound, obj{"meta_erro": "conta não encontrada"}); return }`; em `SerieNovosDia`, depois do atalho de `dias` vazio, `if !contaVisivel(r, textoDe(in.AccountID)) { responder(w, http.StatusNotFound, obj{"erro": "conta não encontrada"}); return }`; em `ContarCollabs`, depois do atalho de `since`/`until`, o mesmo com `conta`.

Em `api/internal/web/rotas.go`, nas 4 linhas: `r.With(auth.ExigirModulo("meta"), autz.ComEscopo(p)).Post("/meta-proxy", …)` e `r.With(auth.ExigirModulo("social"), autz.ComEscopo(p), comPrazo(…)).Post(…)` nas três ao vivo.

Em `api/internal/meta/proxy_test.go`, `montarMetaCom`: depois do DDL, `testebanco.TabelasDoEscopo(t, p)`; no grupo, `r.Use(autz.ComEscopo(p))` depois de `auth.Exigir`; o laço de perfis grava também `allowed_accounts` e `is_superadmin` e ganha `uRestrito` (`viewer`, `{meta,social}`, `'{conta-1}'`), `uAdminRestrito` (`admin`, `{}`, `'{conta-1}'`) e `uSuper` (`viewer`, `{}`, nulo, `is_superadmin` verdadeiro); e `tokens["impersonado"]` = `s.Criar(ctx, uMeta, "painel", &uSuper)` (o impersonador tem de ser super pela ficha: a sessão só vale enquanto ele for). Os testes existentes do Plano 3 não mudam (as pessoas antigas têm `allowed_accounts` nulo).

**(b) Testes de aceitação**
- `TestMetaProxyEscopoDeContas` (`escopo_contas_test.go`; `n` = pedidos ao core antes e depois de cada caso):

| quem | corpo | esperado | core |
|---|---|---|---|
| `uRestrito` | `conta-3`, `/act_999/insights` | `400 {"error":"conta nao encontrada"}` | 0 |
| `uRestrito` | `nao-existe`, `/act_999/insights` | resposta byte a byte igual à anterior | 0 |
| `uRestrito` | `conta-1`: `/act_999/insights`, `act_999/campaigns`, `/1784/media`, `/search` (`type=adinterest`), `POST /act_999/campaigns` | 200 | 1 cada |
| `uRestrito` | `conta-1`: `/act_123/insights`, `/1785/insights`, `/me/adaccounts`, `/act_999/../act_123/insights`, `/v22.0/act_999/insights`, `/9001`, `/`, `/act_999%2F..%2Fact_1/insights`, `/act_999/insights?ids=1`, `/ACT_999/insights` | `403 {"error":"caminho fora da conta"}` | 0 |
| `uAdminRestrito` | `conta-3`, `/me/adaccounts` | 200 (papel admin vê todas: sem âncora) | 1 |
| `uMeta` (sem lista) | `conta-3`, `/me/adaccounts` | 200 (paridade) | 1 |
| `impersonado` | `conta-1` `GET /act_999/insights` | 200 | 1 |
| `impersonado` | `POST /act_999/campaigns`; `DELETE /9001`; `imageFromUrl` `https://midia.exemplo/x.jpg` | `403` com `"sem_permissao"` e "Quem entrou como outra pessoa" | 0 |

- `TestAoVivoEscopoDeContas`: `uRestrito` em `insights-ao-vivo` com `conta-3` → `404 {"meta_erro":"conta não encontrada"}`; em `serie-novos-dia` (com `dias`) e `contar-collabs` (com `since`/`until`) com `conta-3` → `404 {"erro":"conta não encontrada"}`; core 0 nos três; com `conta-1` → 200 nos três.
- `TestMetaSemEscopoNega`: as rotas montadas sem `autz.ComEscopo` → `uMeta` recebe `400 conta nao encontrada` no proxy e `404` no ao vivo, o core 0 e o log traz "rota sem autz.ComEscopo".
- `TestEscopoDeContasPelaMontagemReal` (`web/rotas_test.go`, sobre a fixture de usuários existente + `testebanco.TabelasDoEscopo` + um perfil `meta-restrito` com `{meta, social}` e `allowed_accounts` = uma conta que não é a do fixture): `so-meta` → `/meta-proxy` com a conta do fixture e `/act_1/insights` → **não** 400 (200 ou 503 sem core configurado: passou da conta); `meta-restrito` → `400 conta nao encontrada`; `so-social` → `/insights-ao-vivo` não 404; `meta-restrito` → 404. (Sem o `ComEscopo` na montagem real, `so-meta` cairia em 400: o teste acusa.)
- Os testes existentes de `internal/meta` (`TestMetaProxy*`, `TestInsightsAoVivo*`, `TestSerieNovosDia*`, `TestContarCollabs*`, `TestAoVivo*`) continuam verdes.
- Mutações que têm de reprovar: tirar o `contaVisivel` do proxy (`conta-3` → 200, core chamado); tirar o `!autz.VeTodasAsContas(…) &&` (o `uMeta` toma 403 no `/me/adaccounts`: paridade quebrada); `[a-z_.]` na expressão (o `..` passa); checar impersonado só em `POST` (o `DELETE` passa); a checagem do ao vivo DEPOIS da consulta de `accounts`… e do core (core chamado).

**(c) Arquivos:** Create `api/internal/meta/escopo.go`, `api/internal/meta/escopo_contas_test.go`; Modify `api/internal/meta/proxy.go`, `api/internal/meta/ao_vivo.go`, `api/internal/meta/proxy_test.go`, `api/internal/web/rotas.go`, `api/internal/web/rotas_test.go`.

**(d) Dependências:** Task 2 (`autz.PodeVerConta/VeTodasAsContas`); `autz.ComEscopo/EscopoDo`; `testebanco.TabelasDoEscopo`; `dados.FraseEntrarComo`.

- [ ] **Step 1:** Testes; ver falhar (o `uRestrito` lê `conta-3`). - [ ] **Step 2:** Implementar (código de (a)). - [ ] **Step 3:** `gofmt -l ./internal && go vet ./internal/meta/ ./internal/web/ && go test -count=1 -race ./internal/meta/ ./internal/web/` PASS; mutações reprovam. - [ ] **Step 4:** Commit `fix(api): meta-proxy e rotas ao vivo com o escopo de contas (Ruling 34), caminho ancorado na conta e "entrar como" sem escrever na Meta` (+ `Co-Authored-By`).

---

### Task 9: Montagem, varreduras (vazamento entre contas, impersonado, segredo), `conferir` e notas

**Revisor:** opus. **Depende de:** 3–8.

**(a) Contrato**
- `redes.Montar(r chi.Router, p *pgxpool.Pool)` chama `montarContas, montarOrganico, montarAnuncios, montarHora, montarEscolhas`: **15 leituras e 3 escritas**. `web/rotas.go`: `redes.Montar(r, p) // Plano 5.6` no grupo de domínio. `web/rotas_test.go`: `soSessao` ganha as 18 rotas (comentário: "portão = catálogo, provado pela matriz de cada rota em `internal/redes`; vazamento entre contas, impersonado e segredo por `TestNadaVazaEntreContas`, `TestEscritasRecusamImpersonado` e `TestSegredoDaContaNuncaSai`"); `TestRedesPelaMontagemReal`.
- `cmd/api/conferir.go` e `NOTAS-DA-IMPLANTACAO.md` (abaixo).

**(b) Testes de aceitação** (`redes/rotas_test.go`, código abaixo)
- `TestNadaVazaEntreContas`: TODA leitura de `Montar` exceto `/redes/contas` (Ruling 5.6-3) — exatamente 14 —, para `soA1`, `emailA1`, `horaA1`, `impersonado` e `nenhuma`, sem filtro, com `?account_id=<A2>` e com `?account_id=<A2>&contar=1&limite=1`: 200, sem o uuid de A2, `X-Total-Count: 0`; `nenhuma` também sem A1; e o lado positivo: `adminA1` vê A2 em cada uma.
- `TestEscritasRecusamImpersonado`: as 3 escritas como `impersonado` → 403 com a frase; foto igual.
- `TestSegredoDaContaNuncaSai`: toda rota, como `adminA1`, `todas` e `impersonado`, com o corpo válido, um quebrado e um com `access_token` → nenhuma resposta com `SEGREDO`, `"access_token":` ou `"publicacao_automatica":`; nada disso no log; os tokens intactos.
- `TestNenhumaRotaNovaFicaAberta` (existente) passa com `soSessao` atualizado.
- `TestRedesPelaMontagemReal` (`web/rotas_test.go`, `testebanco.ComEsquemaDeProducao` + `usuarios`/`profiles` de uma pessoa com `allowed_accounts` = `{A1}` e de uma `admin`, contas A1/A2 e uma linha de `engagement_snapshots` de cada): `GET /redes/engajamento` sem sessão → 401; a limitada → só A1; a `admin` → as duas; a limitada `PUT /redes/metas` com A2 → 403.

```go
package redes

import (
	"bytes"
	"log/slog"
	"net/http"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/rbv-co/social-dashboard/api/internal/testebanco/mundoteste"
)

// escritas: um pedido VÁLIDO por rota de escrita de Montar. Rota de escrita nova sem entrada aqui faz as
// varreduras falharem.
var escritas = map[string]struct{ caminho, corpo string }{
	"PATCH /redes/contas/{id}": {"/redes/contas/" + A1, `{"persona":"x"}`},
	"PUT /redes/metas":         {"/redes/metas", `{"metas":[{"account_id":"` + A1 + `","periodo":"1","indicador":"seguidores","valor":1}]}`},
	"PUT /redes/filtros-de-campanha/{account_id}": {"/redes/filtros-de-campanha/" + A1, `{"selected_ids":["9001"]}`},
}

// varrer chama f para cada rota de Montar, com o caminho preenchido e o corpo de `escritas`.
func varrer(t *testing.T, m *mundoteste.Mundo, f func(metodo, rota, caminho, corpo string)) (leituras, gravacoes int) {
	t.Helper()
	err := chi.Walk(m.H.(chi.Routes), func(metodo, rota string, _ http.Handler, _ ...func(http.Handler) http.Handler) error {
		if metodo == http.MethodGet {
			leituras++
			f(metodo, rota, rota, "")
			return nil
		}
		gravacoes++
		e, ok := escritas[metodo+" "+rota]
		if !ok {
			t.Errorf("escrita sem caso nas varreduras: %s %s", metodo, rota)
			return nil
		}
		f(metodo, rota, e.caminho, e.corpo)
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	return leituras, gravacoes
}

// A2 nunca aparece para quem não a vê — em NENHUMA leitura de Montar, sem filtro, filtrando por A2 ou
// contando; o impersonado vê o que o ALVO (soA1) vê, não o que o super veria. /redes/contas é a exceção
// declarada (a tabela não tem a restritiva em produção: Ruling 5.6-3). Toda leitura projeta account_id
// (Ruling 5.6-10), por isso o uuid de A2 na resposta é vazamento.
func TestNadaVazaEntreContas(t *testing.T) {
	m := novoMundo(t, Montar)
	l, g := varrer(t, m, func(metodo, rota, _, _ string) {
		if metodo != http.MethodGet || rota == "/redes/contas" {
			return
		}
		for _, quem := range []string{"soA1", "emailA1", "horaA1", "impersonado", "nenhuma"} {
			for _, q := range []string{"", "?account_id=" + A2, "?account_id=" + A2 + "&contar=1&limite=1"} {
				w := m.Resposta(t, quem, "GET", rota+q, "")
				if w.Code != http.StatusOK || strings.Contains(w.Body.String(), A2) {
					t.Errorf("%s GET %s%s = %d %s", quem, rota, q, w.Code, w.Body)
				}
				if strings.Contains(q, "contar=1") && w.Header().Get("X-Total-Count") != "0" {
					t.Errorf("%s contou linhas de A2 em %s: %q", quem, rota, w.Header().Get("X-Total-Count"))
				}
			}
		}
		if _, b := m.Pedir(t, "nenhuma", "GET", rota, ""); strings.Contains(b, A1) {
			t.Errorf("lista vazia viu A1 em %s: %s", rota, b)
		}
		if _, b := m.Pedir(t, "adminA1", "GET", rota, ""); !strings.Contains(b, A2) {
			t.Errorf("adminA1 não viu A2 em %s (a rota projeta account_id?): %s", rota, b)
		}
	})
	if l != 15 || g != 3 {
		t.Errorf("rotas = %d leituras e %d escritas, esperava 15 e 3", l, g)
	}
}

// Toda escrita recusa a sessão de "entrar como", sem tocar no banco (Ruling 5.6-6).
func TestEscritasRecusamImpersonado(t *testing.T) {
	m := novoMundo(t, Montar)
	antes := m.Um(t, fotoDasRedes)
	_, n := varrer(t, m, func(metodo, rota, caminho, corpo string) {
		if metodo == http.MethodGet {
			return
		}
		if st, b := m.Pedir(t, "impersonado", metodo, caminho, corpo); st != http.StatusForbidden || !strings.Contains(b, "Quem entrou como outra pessoa") {
			t.Errorf("%s %s como impersonado = %d %s", metodo, rota, st, b)
		}
	})
	if n != 3 {
		t.Errorf("escritas = %d, esperava 3 (rota nova? ponha soSessaoPropria e um caso em `escritas`)", n)
	}
	if m.Um(t, fotoDasRedes) != antes {
		t.Error("o impersonado mudou o banco")
	}
}

// O token da Meta e a chave de publicação automática nunca saem (Ruling 5.6-8): nem em resposta de
// nenhuma rota — de quem pode tudo, com corpo válido, quebrado ou trazendo a chave — nem no log.
func TestSegredoDaContaNuncaSai(t *testing.T) {
	m := novoMundo(t, Montar)
	var log bytes.Buffer
	anterior := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(&log, &slog.HandlerOptions{Level: slog.LevelDebug})))
	defer slog.SetDefault(anterior)
	for _, quem := range []string{"adminA1", "todas", "impersonado"} {
		varrer(t, m, func(metodo, rota, caminho, corpo string) {
			for _, c := range []string{corpo, `{"lixo":`, `{"access_token":"x"}`} {
				_, b := m.Pedir(t, quem, metodo, caminho, c)
				if strings.Contains(b, "SEGREDO") || strings.Contains(b, `"access_token":`) || strings.Contains(b, `"publicacao_automatica":`) {
					t.Errorf("%s %s %s devolveu segredo: %s", quem, metodo, rota, b)
				}
			}
		})
	}
	if strings.Contains(log.String(), "SEGREDO") {
		t.Errorf("segredo no log:\n%s", log.String())
	}
	if v := m.Um(t, `select string_agg(access_token, ',' order by name)::text from accounts`); v != "SEGREDO-token-A2,SEGREDO-token-A1" {
		t.Errorf("os tokens mudaram: %s", v)
	}
}
```

**(c) Arquivos:** Create `api/internal/redes/rotas.go`, `api/internal/redes/rotas_test.go`; Modify `api/internal/web/rotas.go`, `api/internal/web/rotas_test.go`, `api/cmd/api/conferir.go`, `docs/migracao-go/NOTAS-DA-IMPLANTACAO.md`.

**(d) Dependências:** Tasks 3–8; `web.Rotas`.

- [ ] **Step 1: Testes que falham.** `redes/rotas_test.go` (acima); em `web/rotas_test.go`, as 18 entradas de `soSessao`: `"GET /redes/contas"`, `"PATCH /redes/contas/{id}"`, `"GET /redes/seguidores"`, `"GET /redes/leituras-de-seguidores"`, `"GET /redes/engajamento"`, `"GET /redes/conteudo"`, `"GET /redes/campanhas"`, `"GET /redes/conjuntos"`, `"GET /redes/anuncios"`, `"GET /redes/insights-de-campanha"`, `"GET /redes/insights-da-conta"`, `"GET /redes/campanhas-por-hora"`, `"GET /redes/anuncios-por-hora"`, `"GET /redes/visitas-por-hora"`, `"GET /redes/metas"`, `"PUT /redes/metas"`, `"GET /redes/filtros-de-campanha"`, `"PUT /redes/filtros-de-campanha/{account_id}"`; e `TestRedesPelaMontagemReal`. Run: `go test -count=1 ./internal/redes/ ./internal/web/` → FAIL (`Montar` não existe).
- [ ] **Step 2: Implementar.** `redes/rotas.go`:

```go
package redes

import (
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Montar registra as rotas do 5.6 no grupo de DOMÍNIO de web.Rotas (depois de auth.Exigir e de
// autz.ComEscopo). Declaração errada derruba a subida. Rota nova entra sozinha nas varreduras.
func Montar(r chi.Router, p *pgxpool.Pool) {
	montarContas(r, p)
	montarOrganico(r, p)
	montarAnuncios(r, p)
	montarHora(r, p)
	montarEscolhas(r, p)
}
```

`web/rotas.go`: `redes.Montar(r, p) // Plano 5.6` no grupo de domínio, depois das montagens anteriores.

`cmd/api/conferir.go` (troque as linhas existentes das mesmas tabelas pela união; acrescente as novas):

```go
// colunasDoWorker
"accounts":             "id,name,username,instagram_id,ad_account_id,access_token,profile_picture_url,picture_url,accent_color,persona,conteudo_usa_portal,publicacao_automatica",
"daily_snapshots":      "account_id,captured_at,followers_count,gained,lost",
"followers_leituras":   "id,account_id,followers_count,origem,lido_em",
"engagement_snapshots": "account_id,captured_at,period_days,likes,comments,saves,shares,reach,views,total_interactions,accounts_engaged,profile_views,created_at",
"content_snapshots":    "account_id,captured_at,period_days,posts_count,reels_count,stories_count,story_shares,story_replies,story_reach,story_interactions,story_navigation,story_profile_visits,story_follows,story_nav_forward,story_nav_back,story_nav_exit,story_nav_next",
"campaign_adsets":      "adset_id,campaign_id,account_id,destination_type,optimization_goal,synced_at",
"account_insights":     "account_id,captured_at,period_days,spend,impressions,clicks,reach,frequency",
"social_metas":         "account_id,periodo,indicador,valor",
"campaign_filters":     "account_id,selected_ids,updated_at",

// tiposDoWorker (os filtros fazem ::uuid/::date/::bigint/::timestamptz; as escritas presumem estes tipos)
"accounts.id": "uuid", "accounts.conteudo_usa_portal": "boolean", "accounts.persona": "text",
"daily_snapshots.captured_at": "date", "engagement_snapshots.captured_at": "date", "content_snapshots.captured_at": "date",
"account_insights.captured_at": "date", "followers_leituras.lido_em": "timestamp with time zone",
"perfil_visitas_hora.dia": "date", "ad_insights_hora.dia": "date",
"social_metas.account_id": "text", "social_metas.periodo": "text", "social_metas.indicador": "text", "social_metas.valor": "numeric",
"campaign_filters.account_id": "uuid", "campaign_filters.selected_ids": "ARRAY", "campaign_filters.updated_at": "timestamp with time zone",

// unicosDoWorker (alvos de ON CONFLICT das escritas do 5.6)
"social_metas(account_id,periodo,indicador)", "campaign_filters(account_id)",

// funcoesDoWorker
"pode_ver_conta(text)",
```

Em `NOTAS-DA-IMPLANTACAO.md`, acrescente ao fim:

```markdown
## Plano 5.6 — Meta e redes (métricas)

### Rotas novas (com sessão; regra = catálogo de produção; escrita de sessão "entrar como" = 403)
- Leituras: `/redes/contas`, `/redes/seguidores`, `/redes/leituras-de-seguidores`, `/redes/engajamento`, `/redes/conteudo`, `/redes/campanhas`, `/redes/conjuntos`, `/redes/anuncios`, `/redes/insights-de-campanha`, `/redes/insights-da-conta`, `/redes/campanhas-por-hora`, `/redes/anuncios-por-hora`, `/redes/visitas-por-hora`, `/redes/metas`, `/redes/filtros-de-campanha`.
- Escritas: `PATCH /redes/contas/{id}` (papel admin), `PUT /redes/metas`, `PUT /redes/filtros-de-campanha/{account_id}`.
- `meta-proxy`, `insights-ao-vivo`, `serie-novos-dia`, `contar-collabs` (Plano 3) passam por `autz.ComEscopo` e recusam conta fora de `allowed_accounts` (Ruling 34).

### Mudanças de contrato que o Plano 7 absorve
- `limite` vai até 1000: `limit=5000` (tela-de-redes-sociais.vue:2121, 2122, 2280, 2456-2459) vira `limite=1000&contar=1`, e a tela avisa quando `X-Total-Count` passa do que veio (substitui `length >= _tetoAds`, que nunca disparava). Contagens do Admin (`select=id` + `.length`, tela-de-admin.vue:4029-4031) viram `contar=1&limite=1` + `X-Total-Count`.
- Filtros com nome: `account_id`, `period_days`, `period_days_ate`, `captured_at`, `captured_at_de`, `captured_at_ate`, `campaign_id` (lista por vírgula), `lido_em_de` (instante RFC 3339: o Gestor, tela-de-gestao-trafego.vue:746, manda `<data>T00:00:00Z` em vez da data pura), `dia_de`; ordens `captured_at`, `lido_em`, `period_days`, `name`.
- Metas: `PUT /redes/metas {"metas":[…]}` (o lote é atômico; recusa = 403 e a tela mostra, em vez do `console.warn`). Filtros: `PUT /redes/filtros-de-campanha/{account_id} {"selected_ids": …}` (sem `updated_at`).
- Conta: `PATCH /redes/contas/{id}` (Admin 4004, Gestor 1331, Conteúdo 499); quem não tem papel admin recebe 403 (o Portal de Notícias da Central de Conteúdo hoje "salvava" sem gravar).
- `ads_snapshots`: sem rota; o cartão "Ads" da aba Dados do Admin (tela-de-admin.vue:4032) sai.
- `meta-proxy`: conta fora da lista = `400 conta nao encontrada`; caminho fora da conta (para quem tem lista) = `403 caminho fora da conta`; `POST`/`DELETE`/mídia de sessão "entrar como" = `403 sem_permissao`. Rotas ao vivo: conta fora da lista = 404.

### Achados para o dono
(ver a seção "Achados para o dono" do plano 5.6)

### Antes do corte
- `api worker conferir` no banco restaurado: colunas, tipos, únicos e `pode_ver_conta(text)` do 5.6 (em especial os presumidos: `social_metas`, `campaign_filters`, `account_insights`, `engagement_snapshots.created_at`).
- Grant por coluna de `accounts`: `select has_column_privilege('authenticated','public.accounts','access_token','SELECT')` = `false` e o mesmo para `publicacao_automatica` (a lista fechada das rotas replica isso; coluna nova que a tela precise ler entra na lista com Ruling).
- Nenhum gatilho nas 17 tabelas: `select count(*) from pg_trigger g join pg_class c on c.oid = g.tgrelid where not g.tgisinternal and c.relname in ('accounts','account_insights','daily_snapshots','engagement_snapshots','content_snapshots','campaigns','campaign_insights','campaign_insights_hora','campaign_adsets','campaign_filters','ads','ads_snapshots','ad_insights_hora','perfil_visitas_hora','followers_leituras','social_metas','visitas_perfil_dia')` = 0.
- Quem tem lista de contas: `select count(*) filter (where allowed_accounts is not null) as com_lista, count(*) filter (where allowed_accounts is not null and features && '{meta}') as com_lista_e_meta from profiles` — se `com_lista_e_meta` > 0, avisar que o Gestor/Análise de campanhas perdem `/me/*` e objetos soltos para essas pessoas (Ruling 5.6-5).
- Conta de serviço que chamar o `meta-proxy` (robôs do `coletor/`, Plano 7) precisa de perfil ativo com `allowed_accounts` nulo (ou papel admin): sem perfil, toda conta é recusada.
```

Rode `gofmt -w ./internal ./cmd`.
- [ ] **Step 3: Rodar e ver passar.** `gofmt -l . && go vet ./... && go test -count=1 -race ./... 2>&1 | grep -v goose | grep -E '^(ok|FAIL|---)'` → todos `ok`. Mutações que têm de reprovar: tirar `soSessaoPropria` de UMA escrita (varredura do impersonado acusa); uma leitura de mentira em `Montar` que não projete `account_id` (o lado positivo acusa); `t.access_token` numa leitura (varredura do segredo acusa); montar `redes.Montar` FORA do grupo com `ComEscopo` (as rotas respondem 500).
- [ ] **Step 4: Commit** `feat(api): monta as rotas de métricas da Meta e das redes, varreduras de vazamento entre contas, impersonado e segredo, conferir e notas` (+ `Co-Authored-By`).

---

### Verificação final do 5.6

- [ ] `docker stop pg-plano56` e `make -C api teste PG_PORTA=58541` → todos `ok` (nunca junto com o gate de outra worktree).
- [ ] Subir o `pg-plano56` de novo e `cd api && go test -count=1 -v ./... 2>&1 | grep -c -- '--- SKIP'` → `0`.
- [ ] `cd api && gofmt -l . && go vet ./...` → nada.
- [ ] `git diff feat/api-go-plano-5-2 --stat -- src/ supabase/ coletor/ db/` → vazio (o front troca no Plano 7; produção não muda).
- [ ] `grep -rn 'access_token' api/internal/redes --include='*.go' | grep -v _test.go` → só o comentário de `colunasConta`.
- [ ] `docker stop pg-plano56`.
- [ ] Revisão final do branch por opus com foco em: a âncora do caminho no proxy (algum formato de `path` que o core aceite e a expressão deixe passar?), o upsert (`PodeX` e `INSERT` com o MESMO mapa, na MESMA transação? algum caminho grava sem a `EditarNova`?), as varreduras (alguma rota escapa? toda leitura projeta `account_id`?), as colunas fechadas de `accounts` e a fatia D0 (algum tipo presumido que mude a semântica de um filtro?).

---

## Inventário: sítios do front a trocar (Plano 7)

`grep` em `src/` (fora de `*.test.*` e `src/demonstracao/`) em 2026-10-12, contando `.from('<tabela>')`, `sb('<tabela>…')`, `adFetch('<tabela>…')`, `fetch(…/rest/v1/<tabela>)` e as 3 chamadas por variável do Relatório (`q('<tabela>', …)`, tela-de-relatorio-redes.vue:147): **61 sítios** nas tabelas do 5.6 — `accounts` 13, `daily_snapshots` 8, `content_snapshots` 7, `campaign_insights` 6, `engagement_snapshots` 5, `campaigns` 5, `campaign_filters` 5, `followers_leituras` 3, `social_metas` 2, e 1 em cada uma de `campaign_adsets`, `ads`, `account_insights`, `campaign_insights_hora`, `ad_insights_hora`, `perfil_visitas_hora`, `ads_snapshots`; `visitas_perfil_dia`: **0**. Deles, **60 vivos → rotas do 5.6** e **1 sem rota** (Ruling 5.6-9). `.rpc`: **0**.

Abreviações: `rs` = `src/ferramentas/redes-sociais/tela-de-redes-sociais.vue`; `rr` = `redes-sociais/tela-de-relatorio-redes.vue`; `ad` = `admin/tela-de-admin.vue`; `ac` = `analise-campanhas/tela-de-analise-campanhas.vue`; `gt` = `gestao-trafego/tela-de-gestao-trafego.vue`; `opr` = `meta-ads/tela-de-relatorio-opr.vue`; `rph` = `meta-ads/tela-de-relatorio-por-hora.vue`; `cv` = `conteudo/dados-conteudo.js`; `mv` = `analise-vendas/tela-de-marca-vendas.vue`.

| Rota | Sítios | Qtde |
|---|---|---|
| `GET /redes/contas` | ac:213; ad:1776, 1915, 3968, 4019; rs:3277; rr:230; cv:65; gt:610; mv:83 | 10 |
| `PATCH /redes/contas/{id}` | ad:4004 (nome, @, cor); gt:1331 (persona); cv:499 (Portal) | 3 |
| `GET /redes/seguidores` | ad:1778, 4029 (`?contar=1&limite=1`), 4033; rs:2106, 2116, 3557; rr:157, 163 | 8 |
| `GET /redes/engajamento` | ad:1777, 4030 (contagem); rs:2107, 2108; rr:158 | 5 |
| `GET /redes/conteudo` | ad:4031 (contagem); rs:2109, 2110, 2112, 2113, 3323; rr:159 | 7 |
| `GET /redes/leituras-de-seguidores` | gt:746; opr:307; rph:316 | 3 |
| `GET /redes/campanhas` | rs:2121, 3785, 3898; opr:305; rph:315 | 5 |
| `GET /redes/conjuntos` | rs:2122 | 1 |
| `GET /redes/anuncios` | rph:318 | 1 |
| `GET /redes/insights-de-campanha` | rs:2280, 2458, 2459; rr:154; gt:1024; opr:306 | 6 |
| `GET /redes/insights-da-conta` | rs:2518 | 1 |
| `GET /redes/campanhas-por-hora` / `anuncios-por-hora` / `visitas-por-hora` | rph:314 / rph:319 / rph:317 | 3 |
| `GET` / `PUT /redes/metas` | rs:1364 / rs:1359 | 2 |
| `GET` / `PUT /redes/filtros-de-campanha` | rs:2111, 3786, 3897 / rs:3830, 3853 | 5 |
| sem rota (`ads_snapshots`, tabela sem escritor) | ad:4032 — o cartão sai | 1 |

**Edges já portadas no Plano 3 (só a URL muda; agora com o escopo de contas da Task 8):** `meta-proxy` — ac:127; gt:373, 399, 5433, 5466; `meta-ads/tela-de-fabrica-home.vue:77`; `meta-ads/painel-subir.vue:51, 140, 184, 193, 317, 337, 344, 357` (14); `insights-ao-vivo` rs:1273, `contar-collabs` rs:1288, `serie-novos-dia` rs:1334 (3). Robôs do `coletor/` que chamam o `meta-proxy` (`validar-orcamento-combos.mjs`, `validar-objetivos-combos.mjs`, `sondar-*.mjs`, `sugerir-interesses.mjs`, `reparar-looks-quebrados.mjs`): Plano 7, com sessão de serviço (ver "Antes do corte").

Nas mesmas telas, de OUTROS planos (não trocar pelo 5.6): **5.1** — `data_integrity_checks` (aba Saúde: ad:1772-1775), `push_preferencias` (ad:1908), perfis; **5.5** — vendas em `mv`; **5.7** — `gt_*` e `interesses_sugeridos` em `gt`; **5.8** — fábrica em `meta-ads`; **5.9** — o resto de `cv`; **5.11** — `chatwoot_eventos` em opr:309. Os botões "coletar/auditar agora" da Saúde: Ruling 30 do mestre (não portados).

## Paralelização

- **Uma worktree por tarefa paralela** (merge na ordem dos números). As Tasks 2–7 e 9 são o MESMO pacote Go (`redes`): na mesma worktree, só em sequência (arquivo pela metade de uma quebra a compilação da outra). Cada task só toca os seus dois arquivos; os ajudantes comuns (`soSessaoPropria`, `deve`, filtros, mundo) são da Task 2. Um contêiner (`pg-plano56`, porta 58541) atende todas: cada teste cria o próprio banco.
- **Onda 1:** Task 1. **Onda 2:** Task 2. **Onda 3:** Tasks 3, 4, 5, 6, 7 (pacote `redes`, arquivos distintos) e 8 (pacote `meta` + as 4 linhas de `web/rotas.go`) — seis em paralelo. **Onda 4:** Task 9 (a única que toca `redes/rotas*.go`, `conferir.go` e as notas; mexe em `web/rotas*.go` depois da 8).
- **Com 5.3, 5.4 e 5.5 (execução em paralelo):** pacotes disjuntos (`redes`/`meta` × `frota`/`acessos`/`comercial`); fatias D0 disjuntas (`01-tabelas-5-6.sql` e `03-funcoes-5-6.sql` não tocam o gerador nem `02-gatilhos.sql`, que o 5.3 regera); nenhum teste deste plano depende de tabela deles. Em comum só os arquivos de fronteira (`web/rotas.go`, `web/rotas_test.go`, `cmd/api/conferir.go`, `NOTAS-DA-IMPLANTACAO.md`): conflito mecânico de listas — quem mescla por último junta e roda o gate. O `autz/predicados.go` (Task 2) é mexido só aqui. Gates (`make teste`, contêiner fixo `pg-api-teste`) nunca ao mesmo tempo.

## Rulings do 5.6

1. Ruling: D0 = fatia RECONSTRUÍDA `01-tabelas-5-6.sql` (as 16 tabelas com fonte por bloco: migrations onde há, DDL dos testes do worker conferida em produção pelo `conferir` onde não há, e os presumidos marcados) + `03-funcoes-5-6.sql` com `pode_ver_conta` verbatim; nenhum gatilho em produção nessas tabelas, então o gerador e `02-gatilhos.sql` não mudam; declaração de `accounts` ou de tabela de métrica feita por outra fatia sai de lá e vem para cá — fica disjunto do 5.3 (que regera `02-gatilhos.sql`) e a comparação com a função de produção roda no mundo do próprio pacote; o `pg_dump` do ensaio (Ruling 29 do mestre) troca a fatia depois pelo mesmo carregador — custo se errada: tipo presumido divergente (`selected_ids` jsonb, `valor` inteiro) só aparece no `api worker conferir` do banco restaurado.
2. Ruling: pacote novo `internal/redes` para as rotas de tabela; o `internal/meta` continua sendo o cliente da Graph, o worker e as rotas ao vivo, e só ganha o escopo de contas (Task 8) — misturar rotas de tabela no pacote do worker colidiria nomes de teste e acoplaria o painel ao coletor — custo se errada: dois pacotes do mesmo assunto (o comentário de pacote diz qual é qual).
3. Ruling: permissão = catálogo nas 15 tabelas com rota, sem exigir módulo (`social`/`meta` são portão de TELA, como hoje: as policies não os leem); `accounts` é legível por qualquer sessão (em produção ela não tem a restritiva) e por isso é a única leitura fora da varredura de vazamento; as tabelas por hora têm a regra dupla compilada (papel admin, super pela ficha ou `meta.hora`, E a conta) — "mesmas permissões de hoje"; restringir é policy em produção, que o catálogo recompilado leva à API sem código (achados 1 e 6) — custo se errada: a lista de marcas e as métricas das contas permitidas continuam legíveis sem o módulo, como hoje.
4. Ruling: fora das tabelas, a regra de conta é `autz.PodeVerConta` (o predicado das restritivas avaliado em Go, comparado pessoa a pessoa com `pode_ver_conta` de produção) e vale no `meta-proxy` (Ruling 34) E nas 3 rotas ao vivo (`insights-ao-vivo`, `serie-novos-dia`, `contar-collabs`), que hoje só conferem se a conta existe; conta invisível responde exatamente como inexistente — as tabelas daquela conta já são negadas pela restritiva; a mesma conta ao vivo aberta contradiz a regra, e uma resposta diferente diria que a conta existe — custo se errada: quem lia ao vivo uma conta fora da lista deixa de ler (o certo).
5. Ruling: para quem NÃO vê todas as contas, o `path` do `meta-proxy` tem de morar na conta do pedido (`act_<ad_account_id>`, `<instagram_id>` ou `search`, só com nomes de aresta depois); para quem vê todas, nada muda — o token do core é um só e alcança todas as contas: conferir só o `accountId` (leitura literal do Ruling 34) deixava ler qualquer conta trocando o caminho; objeto solto (`/<campanha>`, `/<anúncio>`, `/me/…`) não se liga a uma conta sem consulta, e hoje ninguém tem lista (31/07: 0 de 15) — custo se errada: pessoa com lista perde no Gestor e na Análise de campanhas a descoberta por `/me/*` e a edição por id de objeto (o `ponytail` no código diz onde abrir com `campaigns`/`ads`/`campaign_adsets`).
6. Ruling: sessão de "entrar como" só LÊ — as 3 escritas de `redes` (`dados.SoSessaoPropria`) e o `POST`/`DELETE`/mídia do `meta-proxy` respondem 403; as leituras usam o escopo do ALVO — metas e filtros sairiam no nome do alvo, e criar campanha ou subir mídia na Meta gasta dinheiro; estende o Ruling 18 do mestre, o 5.2-3 e o 5.4-5 ao Plano 3 pelo único arquivo dele que este plano já altera — custo se errada: o super-admin sai da sessão impersonada para mexer em campanha.
7. Ruling: as escritas de metas e filtros são upsert com a semântica do PostgREST sob a RLS (`upsertVisivel`: `PodeCriar` + `EditarNova` sobre a linha nova; Ler + Editar no `WHERE` do `DO UPDATE`), e o lote de metas é UMA transação — a tela fazia `.upsert`/`merge-duplicates`, e é a conferência de SELECT do `ON CONFLICT` que barrava a conta invisível (por isso `campaign_filters` estava "protegida nas duas pontas", 2026-08-18-cache…sql:1-7); um `INSERT` simples deixaria criar meta de conta que a pessoa não vê; 403 igual para "existe e é de outra conta" e "não existe e não se veria" fecha o oráculo — custo se errada: uma meta inválida no lote derruba o lote inteiro (a tela manda as do mesmo indicador juntas).
8. Ruling: `accounts` sai sempre por lista FECHADA de 10 colunas; `access_token` e `publicacao_automatica` nunca (nem no `PATCH`, que as recusa) — em produção o SELECT de `authenticated` é concedido coluna a coluna justamente para isso, e grant de coluna não está no catálogo de policies; a API conecta como dona da tabela — custo se errada: coluna nova que uma tela precise ler entra na lista com Ruling (como em produção entrava com GRANT).
9. Ruling: só as rotas que as telas usam — sem rota para `visitas_perfil_dia` (0 leitores no front; só o robô do OPR a usa, com chave de serviço) nem para `ads_snapshots` (nenhum escritor no repositório; fica fora do D0 e o cartão "Ads" do Admin sai no Plano 7); `account_insights` só leitura; nenhum `DELETE`; `accounts` sem filtros — rota sem tela é superfície sem dono, e `visitas_perfil_dia` nem tem a restritiva em produção (a rota a abriria a todos) — custo se errada: uma tela nova que queira essas tabelas ganha uma `Consulta` de ~5 linhas (e, para `visitas_perfil_dia`, a policy antes).
10. Ruling: leituras = um recurso por tabela com a UNIÃO das colunas e filtros que as telas usam (5.1-6, 5.3-14); TODA leitura projeta `account_id` e declara o filtro `account_id`; ordem padrão = a chave única inteira e o desempate (que o `dados` exige ser UMA coluna) é a última coluna dela; ordem pedida pela tela (`captured_at`, `lido_em`) sempre vem com o filtro de conta e período, que a torna única — a varredura de vazamento só prova alguma coisa se toda rota mostrar a conta da linha; nenhuma tela pagina essas leituras — custo se errada: leitura sem filtro de conta ordenada por data tem empate entre contas (a mesma não determinação do PostgREST de hoje).
11. Ruling: teto de 1000 linhas (mestre, Ruling 10) com `contar=1`; `insights-de-campanha` sai da mais nova para a mais antiga por padrão — se o `max_rows` do Supabase é 1000, hoje o intervalo personalizado (`limit=5000`, conferido com `>= 5000`) e a fila do Gestor (3 dias de todas as contas) cortam em silêncio e o investimento sai menor; com `X-Total-Count` a tela passa a ver o corte, e a ordem por data faz o corte levar o mais velho — custo se errada: a tela que não ler `X-Total-Count` continua cortando (como hoje).
12. Ruling: `PATCH /redes/contas/{id}` aceita a união do que as três telas gravam (`name`, `username`, `accent_color`, `persona`, `conteudo_usa_portal`) e a regra é a do catálogo (`admin_update_accounts`: papel `admin`); super-admin com papel viewer recebe 403 — paridade com produção, onde o mesmo pedido "passava" com 0 linhas sem erro — custo se errada: super-admin sem papel admin não edita marca (achado 8).
13. Ruling: `campaign_filters.updated_at` vem do relógio do servidor (o corpo a recusa); metas sem carimbo; o `valor` da meta vai ao `numeric` pelo texto exato do JSON (`json.Number`, sem `float64`) — o relógio do navegador era falsificável e inútil; meta de custo (R$ 1,25) não pode virar 1.2499999 — custo se errada: nenhum.
14. Ruling: `autz.VeTodasAsContas`/`autz.PodeVerConta` são exportados e o predicado SQL `podeVerConta` passa a decidir o "todas" pelo mesmo `VeTodasAsContas` — uma regra em duas formas (SQL para tabela, Go para o que não é tabela), presa pelo oráculo do 5.0 de um lado e pela comparação com a função de produção do outro — custo se errada: nenhum (mudança mecânica no predicado, coberta pelo teste de contrato existente).
15. Ruling: filtros de data com o cast do PostgREST (`::date` em `captured_at`/`dia`, instante RFC 3339 em `lido_em_de`) — o PostgREST convertia `lido_em=gte.2026-10-01` em meia-noite UTC; o Plano 7 manda o mesmo instante explicitamente (`2026-10-01T00:00:00Z`) — custo se errada: a janela de seguidores do Gestor desloca 3 h (dentro dos 3 dias de folga que ela já tem).
16. Ruling: as escritas de metas e filtros usam o `upsertVisivel` deste plano, e não o `Tabela.Gravar` do 5.5 — `social_metas` tem chave composta (o `Gravar` acha a linha por UMA coluna), e o `Gravar` cria a linha que não existe só com `PodeCriar`: em tabela com a restritiva de leitura isso deixaria quem tem lista criar meta/filtro de conta que não vê, e o par "404 se existe / sucesso se não existe" diria o que existe; o `upsertVisivel` é um `INSERT … ON CONFLICT DO UPDATE` só (atômico, sem corrida) com a conferência de SELECT na linha proposta, como o PostgREST — custo se errada: dois caminhos de upsert no código (o do 5.5 serve aos caches globais).

## Achados para o dono

1. **`accounts` e `visitas_perfil_dia` não têm a restritiva por conta em produção** (o plano-mestre dizia que todas as 17 tinham). Qualquer sessão lista todas as marcas (nome, @, ids da Meta, foto, cor, persona) e, pelo PostgREST de hoje, lê as visitas por dia de qualquer conta. A API mantém a lista de contas (paridade, colunas fechadas) e não abre rota para `visitas_perfil_dia`. Correção: duas policies `so_contas_permitidas` em produção (na lista de contas, `pode_ver_conta(id::text)`); o catálogo recompilado leva à API sem código.
2. **O Ruling 34 literal não fechava nada:** o token do core é único, então quem tem lista lia qualquer conta pondo outro `path` no `meta-proxy`. A API ancora o caminho na conta do pedido; o custo é que pessoa com lista perde `/me/*` e edição por id de objeto no Gestor e na Análise de campanhas. Em 31/07, 0 de 15 perfis tinham lista — conferir antes do corte (NOTAS).
3. **"Entrar como" criava campanha e subia mídia na Meta** pela edge (o JWT do alvo valia). A API recusa `POST`/`DELETE`/mídia de sessão impersonada.
4. **Push de saldo (Plano 4)** avisa todo inscrito sobre o saldo de TODAS as contas de anúncio, tenha ou não lista — como o push de vendas (Ruling 24). Decisão de produto.
5. **Corte silencioso de linhas** (se o `max_rows` é 1000): o intervalo personalizado de Redes pede 5000 e só avisa ao chegar a 5000, então um mês ou mais de anúncios sai com investimento menor sem aviso; a fila do Gestor soma 3 dias de todas as contas numa leitura; os contadores do Admin param em 1000 (`daily_snapshots` tem 1.213 linhas). A API devolve `X-Total-Count` e o Plano 7 passa a avisar.
6. **Métricas sem módulo:** qualquer sessão lê as métricas das contas que vê, com ou sem `social`/`meta` (as policies não olham módulo). Mantido; fechar = policy por módulo.
7. **Tabelas sem dono:** ninguém grava `ads_snapshots` (o cartão "Ads" do Admin conta uma tabela morta: sai no Plano 7); `account_insights` só é gravada pelo coletor Python do Mac (o Plano 4 não o portou): com o Mac parado, o alcance deduplicado de Redes some sem aviso.
8. **Edição de marca:** o Portal de Notícias (Central de Conteúdo) "salva" sem gravar para quem não tem papel admin (update de 0 linhas sem erro); super-admin com papel viewer também não edita marca. A API responde 403 (a tela passa a dizer).

## Cobertura da spec e o que vem depois

**As 17 tabelas da linha 5.6 (39 policies, 15 restritivas):**

| Tabela | Policies | Destino |
|---|---|---|
| `accounts` | `auth_read_accounts`, `admin_update_accounts` (sem restritiva) | Task 3 (colunas fechadas; `PATCH` só papel admin) |
| `daily_snapshots`, `followers_leituras`, `engagement_snapshots`, `content_snapshots` | leitura autenticada + `so_contas_permitidas` | Task 4 |
| `campaigns`, `campaign_adsets`, `ads`, `campaign_insights`, `account_insights` | leitura autenticada (+ escrita de serviço) + `so_contas_permitidas` | Task 5 |
| `campaign_insights_hora`, `ad_insights_hora`, `perfil_visitas_hora` | `*_leitura` (admin/super/`meta.hora`) + `so_contas_permitidas` | Task 6 |
| `social_metas`, `campaign_filters` | leitura + escrita autenticadas + `so_contas_permitidas` | Task 7 (upsert com a semântica da RLS) |
| `visitas_perfil_dia` | `auth_read_visitas_perfil_dia` (sem restritiva) | sem rota (Ruling 5.6-9); D0 e foto |
| `ads_snapshots` | leitura autenticada + escrita de serviço + `so_contas_permitidas` | sem rota, fora do D0 (Ruling 5.6-9) |

Plano 3: `meta-proxy` e as 3 rotas ao vivo com o escopo de contas (Task 8, Ruling 34). RPC: nenhuma (`web.FuncoesRPC` e `RPCPendentes` não mudam). Gatilhos: 0. Spec §5 (catálogo, escopo por conta, IDOR, ator × operação × recurso pela cadeia real), §11 (segredo fora de resposta e log, impersonação sem escrita, sem oráculo de existência), §13 (escrita em lote atômica testada; vazamento varrido em toda rota).

**O que vem depois:**
- **5.7 (Gestão de tráfego):** lê contas por `GET /redes/contas` e insights/seguidores pelas rotas daqui; `POST /sugerir-publico-ia` recebe `contaId` e deve usar `autz.PodeVerConta`; a fatia `01-tabelas-5-7.sql` referencia `accounts` (carrega depois desta).
- **5.8 (Fábrica):** a fábrica chama o `meta-proxy` com a conta Vessel fixa (`painel-subir.vue:25`): quem tiver lista sem a Vessel recebe 400 lá.
- **5.9 (Conteúdo):** o Portal grava por `PATCH /redes/contas/{id}`.
- **Plano 4:** decidir o recorte do push de saldo (achado 4).
- **5.5 e quem usar `Tabela.Gravar` depois:** o `Gravar` do 5.5 cria a linha nova só com `PodeCriar` (sem a conferência de SELECT que o `ON CONFLICT` do PostgREST fazia) e responde 404 para "existe e não vejo" mas sucesso para "não existe": serve às tabelas sem restritiva de leitura (os caches globais do 5.5); em tabela com `pode_ver_*` restritiva, use o caminho do `upsertVisivel` deste plano (Ruling 5.6-16).
- **Plano 7:** os 60 sítios da tabela acima (+ o cartão do Admin que sai), as 17 chamadas de edge com a URL nova e os erros novos do proxy, e os robôs do `coletor/` com sessão de serviço com perfil.
- **Atenção para quem escrever as fatias 5.10–5.12:** `01-tabelas-5-10.sql`, `5-11` e `5-12` ordenam ANTES de `01-tabelas-5-2.sql` (ordem de nome): fatia que referencie tabela de 5.2–5.9 por FK quebra a carga — use outro nome (ex.: `01-tabelas-5-z10.sql`) ou só referencie tabelas do 5.1.
