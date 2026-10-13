# Sair do Supabase — Plano 5.9: Central de Conteúdo

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **Execute na worktree `p5-59`** (branch `feat/api-go-plano-5-9`, que já traz o 5.0 e o 5.1 executados e os planos 5.1, 5.2, 5.6, 5.7, 5.8). Antes da Task 1 ela recebe o **5.7 EXECUTADO** (`git merge --no-edit feat/api-go-plano-5-7`, que traz o 5.6 — `accounts`, `pode_ver_conta`, `PodeVerConta`, `/redes/contas` — e a fundação comum do 5.2: `dados.SoSessaoPropria`, `mundoteste`, `rpc.Funcao.SoSessaoPropria/ParamConta/Conferir`). O 5.8 NÃO é dependência de código: o Conteúdo não usa `internal/github` (o robô muda para a VPS). Faça `git add` só dos caminhos de cada task. Este plano contrata sobre as **interfaces** escritas nos planos 5.0–5.7, não sobre o código: o pré-voo confere que elas existem com esses nomes.

**Goal:** Trocar os 27 acessos do front às 9 tabelas da Central de Conteúdo por rotas de domínio que decidem com as MESMAS regras das 25 policies de produção (4 restritivas `pode_ver_conta`), com dois fechamentos por Ruling (as filhas da peça só com a peça visível; criar só o que a pessoa lê); registrar as 6 RPCs em `POST /rpc/{nome}` com o portão igual à checagem de cada função (provado pessoa a pessoa contra a função verbatim) e a conta conferida; e portar `conteudo-trigger` SEM o GitHub: a rota grava o pedido em `conteudo_jobs` (mesmas validações, teto e janela da edge, idempotente sob clique duplo) e o vigia da VPS (trilha C, Plano 7) pega da fila.

**Architecture:** Um pacote: `internal/conteudo` (já existe com os robôs do Plano 4: hora H e espelho) ganha as rotas, montadas no grupo de domínio do 5.0 (`auth.Exigir` → `comPrazo(PrazoDominio)` → `autz.ComEscopo`). Leituras = `dados.Consulta` (regra de Ler do catálogo; `GET /conteudo/pecas` traz a capa, a última métrica e a sugestão de casamento EMBUTIDAS, cada uma com o marcador da sua tabela — some a lista de ids na URL; arquivos e eventos com `join` na peça e o marcador dela). Escritas = `dados.Tabela` + `RotaCriar/RotaEditar/RotaApagar`, com um gancho novo, `Tabela.Conferir` (Task 2: a regra que o catálogo não enxerga — peça-mãe visível, conta da linha nova legível, caminho do arquivo —, na MESMA transação, depois do `PodeX`). RPC pelo registro do 5.0 (`rpc.Funcao` com `SoSessaoPropria` e `Conferir`). `POST /conteudo-trigger` = SQL explícito atrás do portão da edge, numa transação com trava consultiva por conta. Sem `internal/github` e sem rotas de robô: o robô de Conteúdo fala com o banco por `pg` na VPS (seção da trilha C). Testes contra a fatia 5.9 do D0 (9 tabelas das migrations; o gatilho e as 6 RPCs verbatim do levantamento).

**Tech Stack:** Go 1.26 (`go.mod`), `chi`, `pgx` v5, Postgres 17 (contêiner), `net/http/httptest`.

**Spec:** `docs/superpowers/specs/2026-10-09-sair-do-supabase-design.md` (§5 autorização, §6 funções do banco, §9 workstreams 3/4/7, §11 segurança, §13 testes) e o plano-mestre `docs/superpowers/plans/2026-10-11-api-go-plano-5-dominios.md` (§II contrato, IV.1 regras de sub-plano, linha 5.9 da IV.2, IV.3, Rulings 1–36, em especial 2, 5, 9, 11, 26). Modelos: `…-5-8-fabrica.md` (formato, portão de edge, varreduras), `…-5-7-gestao-trafego.md` (RPC com `ParamConta`/`Conferir` e `TestPortaoDoGestorIgualAFuncao`), `…-5-6-meta-redes.md` (`PodeVerConta`, `/redes/contas`). Permissões: `docs/migracao-go/catalogo-policies-producao.json` — 25 policies nas 9 tabelas (`levantamento/01-policies.csv:110-174`). Funções: `levantamento/02-funções.csv:178-474`; gatilho: `levantamento/03-triggers.csv:5`. Robô: `docs/migracao-go/INVENTARIO-DO-COLETOR.md` (no `origin/main`; linha `conteudo-ideias.mjs`) e `~/Projetos/Trabalho/lavessel/MIGRACAO-GO/COORDENACAO.md` (12/10 23:10, item (b): o Conteúdo MUDA para a VPS).

## Global Constraints

- Nada em produção: sem `ssh`, sem credencial real, sem `push`. Postgres local descartável. A seção da trilha C é PASSO A PASSO para quem é dono do `coletor/` (Plano 7) e da VPS: este plano NÃO a executa.
- Regra de cada tabela = a do catálogo (`autz.Producao`), nunca reescrita à mão. "Conteudista" do catálogo = perfil ativo com papel `admin`, `is_superadmin` da ficha ou o MÓDULO `conteudo` em `features` (as 25 policies leem `features`, não `permissions`). Restritiva `pode_ver_conta((account_id)::text)` em `conteudo_pecas`, `conteudo_ideias`, `conteudo_blocos`, `conteudo_jobs` (`account_id` é **uuid** nas quatro; nulo = de todas as marcas, legível a todo conteudista). `conteudo_casamentos`, `conteudo_jobs` e `conteudo_metricas` só a chave de serviço gravava; `conteudo_eventos` aceita só INSERT com `quem = auth.uid()`. Divergência só por Ruling deste plano (5.9-3, 5.9-4, 5.9-6, 5.9-7, 5.9-10, 5.9-11).
- Portão de RPC = a checagem de dentro de cada função (`02-funções.csv`), provada igual pessoa a pessoa contra a função verbatim (`TestPortoesIguaisAsFuncoes`). As 6 são SECURITY DEFINER: ignoravam a restritiva; a API confere a peça/ideia/conta do parâmetro (`rpc.Funcao.Conferir`, Ruling 5.9-10).
- Negar por padrão. Todo portão tem o lado negado assertado **com o efeito**: foto das 9 tabelas igual (`fotoDoConteudo`), nenhum job novo, nenhum evento.
- Toda rota tem teste de vazamento pela cadeia real (`mundoteste`: `auth.Exigir` → `autz.ComEscopo`): TODA leitura (salvo `GET /conteudo/concorrentes`, sem a restritiva em produção: Ruling 5.9-5) sem filtro, com `?account_id=<A2>` e com `contar=1`; e o lado positivo (`adminA1` vê A2).
- Escritas: sessão de "entrar como" = `403 {"error":"sem_permissao","mensagem":"Quem entrou como outra pessoa só consulta."}` sem efeito (`dados.SoSessaoPropria(dados.FraseEntrarComo)` nas rotas; `SoSessaoPropria: true` nas 6 RPCs). `PodeX` e `Tabela.Conferir` na MESMA transação de `banco.ComUsuario` que grava, sobre o MESMO mapa que vai ao `INSERT`/`UPDATE` (o `Tabela.Criar/Editar` do 5.0/5.1).
- Toda escrita roda em `banco.ComUsuario`: o gatilho `conteudo_guarda_aprovacao` lê `auth.uid()` e DEIXA PASSAR sem identidade (é a guarda de aprovação; sem identidade, qualquer um aprovaria).
- SQL: todo parâmetro com cast explícito; nada do pedido no texto do SQL.
- Sem dependência nova; `go.mod` fica em `go 1.26.0`.
- Gate: `make -C api teste PG_PORTA=58549` com `--- SKIP` = 0; `gofmt -l` e `go vet` limpos. O alvo `teste` usa o contêiner de nome fixo `pg-api-teste`: nunca junto com o gate de outra worktree.
- Commits terminam com `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>` (o modelo que implementa). Código, comentários e mensagens em português com acentuação; códigos de erro copiados da edge ficam como estão (`conta_invalida`, `ja_rodando`, `insert_falhou`); frases das funções SQL chegam como estão (sem acento: são de produção).
- `go` roda em `api/`; `git` na raiz da worktree.

## Review Focus

1. **Peça aprovada ou agendada sem aprovador** — `PATCH` de `status` para `aprovada`/`reprovada`/`agendada` (vindo de `em_aprovacao`) por quem não tem `conteudo.aprovar`; `POST` de peça já `agendada` (o gatilho é BEFORE UPDATE: o INSERT o pulava); RPC de decisão sem o portão. Testes: `TestPecas` (Task 5), `TestPortoesIguaisAsFuncoes` e `TestRPCsDoConteudo` (Task 7), `TestFatiaDoConteudo` (Task 1).
2. **Conta escondida vazando** — pela restritiva (peças, ideias, blocos, jobs), pelas FILHAS (arquivo, evento, métrica e casamento de peça de outra conta), pelos embutidos de `GET /conteudo/pecas`, por RPC (aprovar peça de A2, ideia virar peça em A2) ou pelo `conteudo-trigger` (IA paga para a conta de outro). Testes: `TestNadaVazaEntreContas` (Task 9), `TestFilhasSoComAPecaVisivel` (Task 5), `TestRPCsDoConteudo` (Task 7), `TestGatilho` (Task 8).
3. **IA paga disparada por quem não pode, ou duas vezes** — sem o portão da edge, conta que não se vê, clique duplo simultâneo (dois jobs), `quantas` acima de 20 (inclusive `3.7`, que o workflow virava `37`). Testes: `TestGatilho`, `TestGatilhoCliqueDuplo` (Task 8).
4. **"Entrar como" gravando** — qualquer escrita, RPC ou `conteudo-trigger` com a sessão impersonada → 403 sem efeito. Testes: `TestEscritasRecusamImpersonado` (Task 9), `TestRPCsDoConteudo` (Task 7).
5. **Arquivo apontando para o objeto de outra peça** — `caminho` fora de `<conta>/<peça>/` (o apagar do Storage, no Plano 6, levaria a arte da outra). Teste: `TestArquivos` (Task 5).

---

## Interfaces que este plano consome

(Dos planos; o pré-voo confere cada uma. Nome diferente só de campo/função: use o real em todo o plano. Semântica diferente: **pare e reporte**.)

- **5.0** — `dados.Consulta{Tabela, Alias, SQL, Onde; Filtros []Filtro; Ordens map[string]string; OrdemPadrao, Desempate string}` com `Validar(cat)`/`Handler(b, cat)` (`panic` na montagem se inválida; `contar=1` → `X-Total-Count` sob a MESMA regra; teto 1000; parâmetro desconhecido = 400; subconsulta escalar na lista do select e `join` com `{ler:<tabela>:<alias>}` na condição; `order by`/`limit` só fora do nível 0); `dados.Filtro{Param, SQL, Tipo}` (`texto|uuid|inteiro|data|instante|booleano`, sufixo `[]` = lista por vírgula); `dados.LerCorpo` (`DisallowUnknownFields`, 1 MiB), `dados.Erro`, `dados.Responder`, `dados.ErroDeEscrita` (`autz.ErrNaoEncontrado` → 404, `autz.ErrNegado` → 403, resto → `ErroDoBanco`: P0001 → `400 regra_de_negocio` com a frase, 23505/23503 → 409, 22*/23* → 400), `dados.Campos`. `autz`: `Producao`, `Escopo{ID, TemPerfil, Ativo, Papel, SuperFicha, Modulos, Chaves, TodasContas, Contas…}`, `(*Escopo).Modulo`, `CarregarEscopo`, `EscopoDo`, `ComEscopo`, `Ler/Criar/Editar/EditarNova/Apagar`, `(*Catalogo).Filtro/PodeCriar/PodeEditar/PodeApagar`, `Conferir(ctx, b, f, tab, linha)`, `(Filtro).Juntar`, `ErrNegado`, `ErrNaoEncontrado`, `Regra`. `auth`: `Ator{ID, Tipo, ImpersonadorID…}`, `AtorDoContexto`, `Exigir`, `NovoStore`, `(*Store).Criar`. `banco.ComUsuario`. `rpc.Novo`, `rpc.Funcao{Nome, Params, Retorno, Portao}`, `rpc.Param{Nome, Tipo, Opcional}`, `rpc.Valor`. `web.Rotas`, `comPrazo`, `PrazoDominio` (30 s), `FuncoesRPC`, `RPCPendentes`, `TotalRPCDoPainel`, mapas `publicas`/`soSessao` de `rotas_test.go`.
- **5.1** — `testebanco.ComEsquemaDeProducao(t)` (compat + migrações + `esquema/*.sql` em ordem de nome; nomes `01-tabelas-5-NN.sql`, `02-gatilhos.sql`, `03-funcoes-5-NN.sql`, dois dígitos, conferidos por `TestNomesDosArquivosDeEsquema`); `TestEsquemaDeProducaoComOsGatilhosVerbatim` com a lista EXATA dos gatilhos carregados; `dados.Tabela{Nome, Resposta, Autor}` com `Validar`, `Criar`, `Editar`, `Apagar` e `RotaCriar[C]/RotaEditar[C]/RotaApagar`.
- **5.2 (fundação comum, vinda com o 5.7)** — `dados.SoSessaoPropria(frase)`, `dados.FraseEntrarComo`; `rpc.Funcao.SoSessaoPropria`; `testebanco/mundoteste`: `Pessoa{Chave, ID, Email, Papel; Super, Trava, Desativado; Modulos, Contas}`, `Opcoes{Pessoas, Linhas, Impersonadas}`, `Novo(t, o, montar...)`, `Mundo{P, H, Tok}` com `Resposta/Pedir/Um/Rodar`, `Caso{…}`. A `Pessoa` não tem `permissions`: o mundo grava a chave pelo SQL de `Linhas`.
- **5.6** — `esquema/01-tabelas-5-06.sql` JÁ declara `accounts` (com `publicacao_automatica` e `conteudo_usa_portal`): a fatia 5.9 **não a redeclara**; `autz.PodeVerConta(e, conta)` (comparação exata de texto com `allowed_accounts::text[]`); `GET /redes/contas` e `PATCH /redes/contas/{id}` (papel `admin`; o "Portal de Notícias" da Central grava por ela, Ruling 5.9-13).
- **5.7** — `rpc.Funcao.ParamConta` e `rpc.Funcao.Conferir func(ctx, tx pgx.Tx, e *autz.Escopo, args map[string]json.RawMessage) error` (na MESMA transação, logo antes da função; `autz.ErrNegado` = 403 sem a função rodar); o padrão `TestPortaoDoGestorIgualAFuncao` (`trafego/problemas_test.go`) e as varreduras (`trafego/rotas_test.go`).
- **5.1 (`GET /acesso/usuarios`)** — a lista de pessoas que a Central usa para "responsável" (`dados-conteudo.js:248`).

## Interfaces que este plano entrega

- `dados.Tabela.Conferir func(ctx context.Context, tx pgx.Tx, e *autz.Escopo, id string, campos map[string]any) error` (Task 2): gancho opcional na MESMA transação, depois do `PodeCriar/PodeEditar/PodeApagar` e antes do SQL; qualquer domínio pode usá-lo (o 5.10 e o 5.11 também têm filhas de tabela com restritiva).
- `conteudo.Conteudista`, `conteudo.Aprovador`, `conteudo.PedeIA` (`autz.Regra`), `conteudo.FuncoesRPC` (6 funções) e `conteudo.Montar(r chi.Router, p *pgxpool.Pool)` (Tasks 3, 7, 9).
- `POST /conteudo-trigger` e o CONTRATO DA FILA `conteudo_jobs` que o vigia da VPS lê (Task 8 e seção da trilha C).
- D0: `esquema/01-tabelas-5-09.sql` (as 9 tabelas) e `esquema/03-funcoes-5-09.sql` (o gatilho `conteudo_pecas_guarda` com a função e as 6 RPCs, verbatim).

## Pré-voo (antes da Task 1)

- [ ] `cd /Users/gabrielgertrudes/Projetos/Trabalho/lavessel/social-dashboard/.claude/worktrees/p5-59 && git status --short && git branch --show-current` → vazio (ou só este plano); `feat/api-go-plano-5-9`.
- [ ] Trazer a dependência executada: `git merge --no-edit feat/api-go-plano-5-7`. Conferir:
  ```bash
  grep -c 'create table public.accounts' api/internal/testebanco/esquema/01-tabelas-5-06.sql            # 1 (do 5.6)
  grep -c 'conteudo_usa_portal' api/internal/testebanco/esquema/01-tabelas-5-06.sql                    # ≥ 1
  grep -rn 'create table public.conteudo_' api/internal/testebanco/esquema/                          # vazio
  grep -c 'func PodeVerConta' api/internal/autz/predicados.go                                         # 1
  grep -c 'func SoSessaoPropria\|FraseEntrarComo' api/internal/dados/sessao.go                        # ≥ 2
  grep -c 'func Novo' api/internal/testebanco/mundoteste/mundoteste.go                                # 1
  grep -c 'SoSessaoPropria bool\|ParamConta string\|Conferir func' api/internal/rpc/rpc.go            # 3
  grep -c '"conteudo_aprovar_e_agendar",' api/internal/web/rpc_lista.go                               # 1 (em RPCPendentes)
  grep -n 'Conferir func' api/internal/dados/escrita.go                                              # vazio (a Task 2 cria)
  grep -n '"gt_rascunho_updated_at"' api/internal/testebanco/esquema_test.go                         # 1 linha (a lista de gatilhos)
  grep -c 'CONFERIDOS' api/internal/testebanco/esquema/gerar-gatilhos.mjs                             # 0 hoje; ≥ 1 se o 5.2 entrou (Task 1, Step 3)
  grep -n '^// Package conteudo' api/internal/conteudo/*.go                                           # 1 linha, em casar.go (a Task 3 a move)
  cd api && go list -deps ./internal/conteudo | grep -c 'internal/web$'                               # 0 (sem ciclo)
  ```
  Qualquer `0` onde se espera ≥ 1: a dependência não terminou — **pare e reporte**. Se o 5.2 (trilha A) já estiver na base com `dados.Tabela.CriarSoLegivel`, o plano continua igual: `Tabela.Conferir` convive com ele (campos distintos da mesma struct; conflito de merge mecânico) e a regra de "criar só o legível" do Conteúdo fica no gancho (Ruling 5.9-4).
- [ ] `go version` → `go1.26`+.
- [ ] Docker no ar, porta livre (`lsof -iTCP:58549 -sTCP:LISTEN` → vazio) e o banco das etapas:
  ```bash
  docker run -d --rm --name pg-plano59 -e POSTGRES_PASSWORD=x -p 127.0.0.1:58549:5432 postgres:17
  until docker exec pg-plano59 pg_isready -h 127.0.0.1 -U postgres >/dev/null 2>&1; do sleep 1; done
  export TEST_DATABASE_URL='postgres://postgres:x@localhost:58549/postgres?sslmode=disable'
  ```
- [ ] Linha de base: `cd api && go test ./... && go test -v ./... 2>&1 | grep -c -- '--- SKIP'` → tudo `ok` e `0`.

## Estrutura de arquivos

```
api/internal/testebanco/esquema/01-tabelas-5-09.sql      # as 9 tabelas da Central de Conteúdo, fonte por bloco
api/internal/testebanco/esquema/03-funcoes-5-09.sql      # gatilho conteudo_pecas_guarda + função + 6 RPCs, VERBATIM
api/internal/testebanco/esquema_conteudo_test.go         # TestFatiaDoConteudo
api/internal/testebanco/esquema_test.go                  # (mod.) a lista de gatilhos ganha conteudo_pecas_guarda
api/internal/testebanco/esquema/gerar-gatilhos.mjs       # (mod.) SÓ se tiver CONFERIDOS (5.2): a entrada do gatilho
api/internal/dados/escrita.go           (+ escrita_conferir_test.go) # Tabela.Conferir
api/internal/conteudo/conteudo.go                         # doc do pacote, regras, conferências, ajudantes
api/internal/conteudo/casar.go                            # (mod.) só a linha "// Package conteudo" sai (a doc passa a conteudo.go)
api/internal/conteudo/mundo_test.go, regras_test.go       # pessoas, linhas, foto; TestMundoDoConteudo, TestAjudantes
api/internal/conteudo/leituras.go       (+ _test)         # 7 GETs
api/internal/conteudo/pecas.go          (+ _test)         # peças, arquivos, eventos (escritas)
api/internal/conteudo/pauta.go          (+ _test)         # ideias, blocos, concorrentes (escritas)
api/internal/conteudo/rpc.go            (+ _test)         # FuncoesRPC e as conferências de parâmetro
api/internal/conteudo/gatilho.go        (+ _test)         # POST /conteudo-trigger
api/internal/conteudo/rotas.go          (+ rotas_test.go) # Montar; varreduras de vazamento e impersonado
api/internal/web/rotas.go, rotas_test.go, rpc_lista.go    # montagem, soSessao, FuncoesRPC, RPCPendentes, TestConteudoPelaMontagemReal
api/cmd/api/conferir.go                (+ conferir_test.go) # colunas, tipos, função do gatilho e gatilho do Conteúdo
docs/migracao-go/NOTAS-DA-IMPLANTACAO.md                  # seção do 5.9
```

**Não toca:** `autz` (as 25 policies já compilam: `termoModulo`, `termoSuper`, `termoPapel`, `podeVerConta` com `(account_id)::text`, `dono("quem")`; os portões das RPCs moram em `conteudo`); `rpc` (o 5.7 já trouxe `SoSessaoPropria`, `ParamConta` e `Conferir`); `02-gatilhos.sql` (o gatilho vai em `03-funcoes-5-09.sql` com `create or replace trigger`, como o 5.7: Ruling 5.9-1); os robôs do Plano 4 em `conteudo` (`hora_h.go`, `espelho.go`, `casar.go` além da linha da doc, `pictografico.go`); `internal/github` (o Conteúdo não despacha nada); `coletor/`, `.github/`, `supabase/` e `src/` (trilha C e Plano 7).

## Tarefas

| # | Task | Revisor | Depende de |
|---|---|---|---|
| 1 | D0: fatia 5.9 (9 tabelas) e `03-funcoes-5-09.sql` (gatilho e 6 RPCs verbatim); lista de gatilhos do 5.1 | **opus** (dados: tudo é provado contra isto) | 5.1 T1, 5.6 T1 |
| 2 | `dados.Tabela.Conferir`: a regra que o catálogo não enxerga, na transação que grava | **opus** (toda escrita de domínio passa aqui) | 5.1 |
| 3 | `conteudo`: fundação (regras `Conteudista`/`Aprovador`/`PedeIA`, conferências de peça e de conta, mundo, foto) | **opus** (portão de toda escrita) | 1, 2 |
| 4 | Leituras (7), com capa, métrica e sugestão embutidas na peça e as filhas presas à peça | sonnet | 3 |
| 5 | Escritas de peça, arquivo e evento (guarda de aprovação pela rota, caminho preso à peça) | **opus** (aprovação, filhas de outra conta) | 2, 3 |
| 6 | Escritas de ideias, blocos e concorrentes | sonnet | 2, 3 |
| 7 | As 6 RPCs: portões provados contra as funções, conferência da peça/ideia/conta | **opus** (aprovação, conta) | 1, 3 |
| 8 | `POST /conteudo-trigger`: fila sem GitHub, validações e teto da edge, idempotente | **opus** (gasto de IA) | 3 |
| 9 | Montagem, varreduras (conta, impersonado), `conferir` e notas | **opus** (fronteira) | 4–8 |

---

## Robô de Conteúdo na VPS — passo a passo para a trilha C (não é tarefa do 5.9)

(a preencher)

## Inventário: sítios do front a trocar (Plano 7)

(a preencher)

## Paralelização

(a preencher)

## Rulings do 5.9

(a preencher)

## Achados para o dono

(a preencher)

## Cobertura da spec e o que vem depois

(a preencher)
