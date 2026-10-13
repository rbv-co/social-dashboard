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

### Task 1: D0 — fatia 5.9 do esquema de produção nos testes

**Revisor:** opus. **Depende de:** 5.1 Task 1 (carregador, `usuarios`, `profiles`), 5.6 Task 1 (`accounts`).

**(a) Contrato**
- `esquema/01-tabelas-5-09.sql` (abaixo): as 9 tabelas, cada bloco com a migration de origem. Todas têm DDL no repositório (`db/migrations/2026-07-29-conteudo-01` … `2026-08-01-conteudo-16`): nenhum presumido. FKs de `auth.users` viram `public.usuarios`; `responsavel` aponta para `profiles` (como em produção). `accounts` vem do 5.6 (carrega antes: ordem do nome) e NÃO é redeclarada.
- `esquema/03-funcoes-5-09.sql`: a função do gatilho (`conteudo_guarda_aprovacao`), o gatilho `conteudo_pecas_guarda` (`create or replace trigger`, BEFORE UPDATE, sem OF nem WHEN: a migration 01:164-167) e as 6 RPCs, **verbatim** do levantamento (as frases SEM acento são as de produção: as migrations do repositório têm acento e estão atrás do banco). Gerado pelo script de uso único do Step 2 e conferido por hash: nada digitado à mão.
- `conteudo_reivindicar_hora_h` (do worker, Plano 4) NÃO entra: os testes do worker usam o próprio banco (`conteudo_test.go`), e nenhuma rota do 5.9 a chama.
- `TestEsquemaDeProducaoComOsGatilhosVerbatim` (5.1) ganha `"conteudo_pecas_guarda"` na lista exata (primeira posição: a lista é ordenada).
- **Ensaiado** num Postgres 17 durante a escrita deste plano (worktree descartável sobre `feat/api-go-plano-5-7`): a fatia carrega, `TestFatiaDoConteudo` abaixo passa inteiro e o teste dos gatilhos passa com a lista nova.

**(b) Testes de aceitação** (`TestFatiaDoConteudo`, `esquema_conteudo_test.go`, código abaixo)
- As 9 tabelas existem; o único gatilho de `conteudo_pecas` é `conteudo_pecas_guarda`, BEFORE UPDATE.
- Defaults: peça `rascunho|''|''`; ideia `nova|manual|[]`; job `ideias|enfileirado|{}`.
- A guarda (com `banco.ComUsuario`): quem tem só `conteudo` não leva a peça `em_aprovacao` para `aprovada`, `reprovada` nem `agendada` (P0001 `Sem permissao para aprovar pecas de conteudo.`, linha intacta); edita a legenda e manda para aprovação; `updated_at` anda.
- `conteudo_decidir` como aprovador: `aprovada`, `aprovado_por` = ele, 1 evento `aprovou`; a segunda decisão recebe `Esta peca nao esta esperando aprovacao (alguem ja decidiu?).`.
- Restrições: formato `tiktok` → 23514; `agendada` sem `publicar_em` → 23514; duas linhas de arquivo na mesma `(peca_id, ordem)` → 23505. O INSERT de peça já `agendada` PASSA no banco (a guarda é BEFORE UPDATE): é a rota que barra (Ruling 5.9-6; o teste documenta o buraco que a Task 5 fecha).
- Cascata: apagar a peça leva arquivos, eventos, métricas e casamentos; a ideia ligada fica com `peca_id` nulo.
- Tipos: `account_id` é `uuid` nas 5 tabelas que o têm.
- Mutações que têm de reprovar: tirar o `create or replace trigger` do `03` (a guarda some: os três casos negados gravam); declarar `accounts` de novo na fatia (`42P07` na carga); `on delete cascade` fora de `conteudo_arquivos.peca_id` (a cascata reprova); o gatilho fora da lista do teste do 5.1.

**(c) Arquivos:** Create `api/internal/testebanco/esquema/01-tabelas-5-09.sql`, `api/internal/testebanco/esquema/03-funcoes-5-09.sql`, `api/internal/testebanco/esquema_conteudo_test.go`; Modify `api/internal/testebanco/esquema_test.go` (e `esquema/gerar-gatilhos.mjs` só no caso do Step 3).

**(d) Dependências:** 5.1 Task 1; 5.6 Task 1 (`accounts` em `01-tabelas-5-06.sql`).

- [ ] **Step 1: A DDL da fatia.** Crie `api/internal/testebanco/esquema/01-tabelas-5-09.sql`:

```sql
-- FATIA 5.9 do esquema de produção para os testes (D0 reconstruído: Rulings 5.1-1, 5.7-1 e 5.9-1). Carrega
-- depois de 01-tabelas-5-01.sql (usuarios, profiles) e 01-tabelas-5-06.sql (accounts, com
-- publicacao_automatica e conteudo_usa_portal: NÃO redeclarar). FKs de auth.users viram public.usuarios
-- (ops/migracao/limpar-dump.mjs:64). Todas com DDL no repositório: sem presumido. O único gatilho de produção
-- nestas tabelas (conteudo_pecas_guarda, levantamento/03-triggers.csv:5) e as 6 RPCs do painel vão VERBATIM
-- em 03-funcoes-5-09.sql.

-- db/migrations/2026-07-29-conteudo-01-fundacao.sql:14-58 (criado_por/aprovado_por: auth.users → usuarios)
-- + 2026-08-01-conteudo-16-responsavel-e-aprovar-agendando.sql:15-16 (responsavel → profiles)
create table public.conteudo_pecas (
  id           uuid primary key default gen_random_uuid(),
  account_id   uuid not null references public.accounts(id) on delete cascade,
  titulo       text not null,
  formato      text not null check (formato in ('feed', 'reels', 'stories', 'carrossel')),
  status       text not null default 'rascunho'
               check (status in ('rascunho', 'em_aprovacao', 'aprovada', 'reprovada',
                                 'agendada', 'publicada', 'arquivada')),
  legenda      text not null default '',
  hashtags     text not null default '',
  observacoes  text,
  publicar_em  timestamptz,
  publicado_em timestamptz,
  avisado_em   timestamptz,
  ig_media_id  text,
  ig_permalink text,
  criado_por        uuid references public.usuarios(id),
  aprovado_por      uuid references public.usuarios(id),
  aprovado_em       timestamptz,
  motivo_reprovacao text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  responsavel  uuid references public.profiles(id) on delete set null,
  constraint conteudo_agendada_tem_data
    check (status <> 'agendada' or publicar_em is not null),
  constraint conteudo_publicada_tem_data
    check (status <> 'publicada' or publicado_em is not null)
);
-- 01-fundacao.sql:64-77 e 16:23-24
create index conteudo_pecas_conta_idx on public.conteudo_pecas (account_id, publicar_em);
create index conteudo_pecas_status_idx on public.conteudo_pecas (status, publicar_em);
create index conteudo_pecas_horah_idx on public.conteudo_pecas (publicar_em)
  where status = 'agendada' and avisado_em is null;
create unique index conteudo_pecas_ig_media_uq on public.conteudo_pecas (ig_media_id)
  where ig_media_id is not null;
create index conteudo_pecas_responsavel_idx on public.conteudo_pecas (responsavel)
  where responsavel is not null;

-- 01-fundacao.sql:83-105
create table public.conteudo_arquivos (
  id        uuid primary key default gen_random_uuid(),
  peca_id   uuid not null references public.conteudo_pecas(id) on delete cascade,
  ordem     int  not null default 1,
  bucket    text not null default 'conteudo',
  caminho   text not null,
  tipo      text not null check (tipo in ('imagem', 'video')),
  mime      text,
  bytes     bigint,
  largura   int,
  altura    int,
  duracao_s numeric,
  created_at timestamptz not null default now(),
  unique (peca_id, ordem)
);
create index conteudo_arquivos_peca_idx on public.conteudo_arquivos (peca_id, ordem);

-- 01-fundacao.sql:111-126
create table public.conteudo_eventos (
  id       bigserial primary key,
  peca_id  uuid not null references public.conteudo_pecas(id) on delete cascade,
  de       text,
  para     text,
  acao     text not null,
  detalhe  text,
  quem     uuid,
  quando   timestamptz not null default now()
);
create index conteudo_eventos_peca_idx on public.conteudo_eventos (peca_id, quando desc);

-- db/migrations/2026-07-31-conteudo-07-metricas.sql:13-27
create table public.conteudo_metricas (
  peca_id           uuid not null references public.conteudo_pecas(id) on delete cascade,
  capturado_em      date not null,
  curtidas          int,
  comentarios       int,
  alcance           int,
  salvamentos       int,
  compartilhamentos int,
  visualizacoes     int,
  bruto             jsonb,
  primary key (peca_id, capturado_em)
);

-- 07-metricas.sql:38-65
create table public.conteudo_casamentos (
  id           uuid primary key default gen_random_uuid(),
  peca_id      uuid not null references public.conteudo_pecas(id) on delete cascade,
  ig_media_id  text not null,
  ig_permalink text,
  ig_timestamp timestamptz,
  ig_caption   text,
  ig_thumb     text,
  pontuacao    numeric not null,
  motivo       text,
  situacao     text not null default 'sugerido'
               check (situacao in ('sugerido', 'confirmado', 'recusado', 'automatico')),
  decidido_por uuid,
  decidido_em  timestamptz,
  created_at   timestamptz not null default now(),
  unique (peca_id, ig_media_id)
);
create index conteudo_casamentos_peca_idx on public.conteudo_casamentos (peca_id, created_at desc);
create index conteudo_casamentos_pendentes_idx on public.conteudo_casamentos (situacao) where situacao = 'sugerido';

-- db/migrations/2026-07-31-conteudo-10-ideias.sql:13-56 + 2026-08-01-conteudo-13-roteiro-completo.sql:20-27
create table public.conteudo_ideias (
  id         uuid primary key default gen_random_uuid(),
  account_id uuid references public.accounts(id) on delete cascade,
  titulo     text not null,
  gancho     text,
  formato    text check (formato in ('feed', 'reels', 'stories', 'carrossel')),
  pilar      text,
  roteiro    jsonb not null default '[]'::jsonb,
  legenda_sugerida  text,
  hashtags_sugeridas text,
  por_que_agora text,
  referencia    text,
  origem     text not null default 'manual' check (origem in ('manual', 'ia')),
  modelo     text,
  job_id     uuid,
  situacao   text not null default 'nova'
             check (situacao in ('nova', 'favorita', 'usada', 'descartada')),
  peca_id    uuid references public.conteudo_pecas(id) on delete set null,
  criado_por uuid,
  created_at timestamptz not null default now(),
  cta            text,
  producao       text,
  porque_formato text
);
create index conteudo_ideias_conta_idx on public.conteudo_ideias (account_id, situacao, created_at desc);
create index conteudo_ideias_novas_idx on public.conteudo_ideias (created_at desc) where situacao in ('nova', 'favorita');

-- 10-ideias.sql:61-77
create table public.conteudo_blocos (
  id         uuid primary key default gen_random_uuid(),
  account_id uuid references public.accounts(id) on delete cascade,
  tipo       text not null check (tipo in ('legenda', 'hashtags', 'cta', 'assinatura')),
  nome       text not null,
  texto      text not null,
  usos       int not null default 0,
  ativo      boolean not null default true,
  criado_por uuid,
  created_at timestamptz not null default now()
);
create index conteudo_blocos_conta_idx on public.conteudo_blocos (account_id, tipo, ativo);

-- 10-ideias.sql:83-98 (criado_por: auth.users → usuarios)
create table public.conteudo_jobs (
  id            uuid primary key default gen_random_uuid(),
  tipo          text not null default 'ideias',
  account_id    uuid references public.accounts(id) on delete cascade,
  params        jsonb not null default '{}'::jsonb,
  status        text not null default 'enfileirado'
                check (status in ('enfileirado', 'rodando', 'concluido', 'erro')),
  github_run_id text,
  resultado     jsonb,
  erro          text,
  criado_por    uuid references public.usuarios(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index conteudo_jobs_status_idx on public.conteudo_jobs (status, created_at desc);

-- db/migrations/2026-08-01-conteudo-12-concorrentes-por-marca.sql:12-30
create table public.conteudo_concorrentes (
  id          uuid primary key default gen_random_uuid(),
  account_id  uuid not null references public.accounts(id) on delete cascade,
  handle      text not null,
  nome        text,
  observacao  text,
  ativo       boolean not null default true,
  created_at  timestamptz not null default now(),
  unique (account_id, handle)
);
create index conteudo_concorrentes_da_conta on public.conteudo_concorrentes (account_id) where ativo;
```

- [ ] **Step 2: As funções e o gatilho, verbatim.** Rode, da raiz da worktree, o gerador de uso único (fica fora do repositório):

```bash
cat > /tmp/fatia59.mjs <<'FIM'
// Gera esquema/03-funcoes-5-09.sql VERBATIM do levantamento (uso único, Plano 5.9 Task 1).
// node fatia59.mjs <levantamento>/02-funções.csv > api/internal/testebanco/esquema/03-funcoes-5-09.sql
import { readFileSync } from 'node:fs';
const t = readFileSync(process.argv[2], 'utf8');
const linhas = []; let l = [], c = '', q = false;
for (let i = 0; i < t.length; i++) {
  const x = t[i];
  if (q) { if (x === '"' && t[i + 1] === '"') { c += '"'; i++; } else if (x === '"') q = false; else c += x; }
  else if (x === '"') q = true; else if (x === ',') { l.push(c); c = ''; }
  else if (x === '\n') { l.push(c); linhas.push(l); l = []; c = ''; } else if (x !== '\r') c += x;
}
const corpo = new Map(linhas.map((r) => [r[0], r[3].trim() + ';\n']));
const rpcs = ['conteudo_aprovar_e_agendar', 'conteudo_casar_na_mao', 'conteudo_decidir', 'conteudo_decidir_casamento',
  'conteudo_ideia_virar_peca', 'conteudo_reavisar'];
for (const n of ['conteudo_guarda_aprovacao', ...rpcs]) if (!corpo.has(n)) { console.error(`falta ${n} no CSV`); process.exit(1); }
process.stdout.write(
  '-- VERBATIM de levantamento/02-funções.csv (gerado por fatia59.mjs, Plano 5.9 Task 1): conteudo_guarda_aprovacao\n' +
  '-- (:367-407), conteudo_aprovar_e_agendar (:178-223), conteudo_casar_na_mao (:224-289), conteudo_decidir (:290-321),\n' +
  '-- conteudo_decidir_casamento (:322-366), conteudo_ideia_virar_peca (:408-448), conteudo_reavisar (:449-474).\n' +
  '-- O gatilho de 03-triggers.csv:5 com a orientação da migration 2026-07-29-conteudo-01-fundacao.sql:164-167\n' +
  '-- (BEFORE UPDATE … FOR EACH ROW, sem OF nem WHEN). `create or replace trigger`: se o gerador também o emitir\n' +
  '-- em 02-gatilhos.sql (que carrega antes), a recriação aqui é a mesma (Rulings 5.7-1 e 5.9-1).\n' +
  corpo.get('conteudo_guarda_aprovacao') + '\n' +
  'create or replace trigger conteudo_pecas_guarda BEFORE UPDATE on public.conteudo_pecas\n' +
  '  for each row EXECUTE FUNCTION conteudo_guarda_aprovacao();\n\n' +
  rpcs.map((n) => corpo.get(n)).join('\n'));
FIM
node /tmp/fatia59.mjs /Users/gabrielgertrudes/Projetos/Trabalho/lavessel/social-dashboard/.claude/worktrees/levantamento-ro/docs/migracao-go/levantamento/02-funções.csv \
  > api/internal/testebanco/esquema/03-funcoes-5-09.sql
shasum -a 256 api/internal/testebanco/esquema/03-funcoes-5-09.sql
# 85984df43d184a769955efb3b8cbad1ff6ca9d8027aa3d1115dafc5a441bb0f3 (o do ensaio). Hash diferente = o levantamento mudou: pare e reporte.
grep -c 'CREATE OR REPLACE FUNCTION' api/internal/testebanco/esquema/03-funcoes-5-09.sql   # 7
```

- [ ] **Step 3: A lista de gatilhos.** Em `api/internal/testebanco/esquema_test.go`, `TestEsquemaDeProducaoComOsGatilhosVerbatim`: acrescente `"conteudo_pecas_guarda"` na lista `quer` (em ordem alfabética: é a primeira). Se o pré-voo achou `CONFERIDOS` em `gerar-gatilhos.mjs` (o 5.2 entrou), acrescente lá a entrada `'conteudo_pecas.conteudo_pecas_guarda': {}` com o comentário `// 2026-07-29-conteudo-01-fundacao.sql:164-167: BEFORE UPDATE, sem OF nem WHEN` (o gerador recusa gatilho não conferido quando for regerado) — sem regerar o `02-gatilhos.sql` aqui (quem o regera é o 5.3; o `create or replace` do `03` torna a dupla emissão idempotente).

- [ ] **Step 4: O teste.** Crie `api/internal/testebanco/esquema_conteudo_test.go`:

```go
package testebanco

import (
	"context"
	"errors"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/rbv-co/social-dashboard/api/internal/banco"
)

// A fatia 5.9: as 9 tabelas das migrations, o gatilho conteudo_pecas_guarda e as 6 RPCs verbatim.
func TestFatiaDoConteudo(t *testing.T) {
	p := ComEsquemaDeProducao(t)
	ctx := context.Background()
	const (
		conta    = "a5900000-0000-4000-a000-0000000000a1"
		editor   = "a5910000-0000-4000-a000-000000000001" // features {conteudo}
		aprova   = "a5910000-0000-4000-a000-000000000002" // features {conteudo, conteudo.aprovar}
		pecaEm   = "a5930000-0000-4000-a000-0000000000c1" // em_aprovacao, com data
		pecaRasc = "a5930000-0000-4000-a000-0000000000c2" // rascunho
	)
	um := func(sql string, args ...any) string {
		t.Helper()
		var v *string
		if err := p.QueryRow(ctx, sql, args...).Scan(&v); err != nil {
			t.Fatalf("%s: %v", sql, err)
		}
		if v == nil {
			return "<nulo>"
		}
		return *v
	}
	codigo := func(err error) (string, string) {
		var pe *pgconn.PgError
		if errors.As(err, &pe) {
			return pe.Code, pe.Message
		}
		return "", ""
	}
	if _, err := p.Exec(ctx, `
		insert into usuarios (id, email) values ('`+editor+`', 'editor@x.com'), ('`+aprova+`', 'aprova@x.com');
		insert into profiles (id, email, role, features) values ('`+editor+`', 'editor@x.com', 'viewer', '{conteudo}'),
		  ('`+aprova+`', 'aprova@x.com', 'viewer', '{conteudo,conteudo.aprovar}');
		insert into accounts (id, name) values ('`+conta+`', 'Vessel');
		insert into conteudo_pecas (id, account_id, titulo, formato, status, publicar_em) values
		  ('`+pecaEm+`', '`+conta+`', 'Em aprovação', 'feed', 'em_aprovacao', '2026-10-20T15:00:00Z'),
		  ('`+pecaRasc+`', '`+conta+`', 'Rascunho', 'reels', 'rascunho', null);`); err != nil {
		t.Fatal(err)
	}
	for _, tab := range []string{"conteudo_pecas", "conteudo_ideias", "conteudo_blocos", "conteudo_arquivos", "conteudo_casamentos",
		"conteudo_concorrentes", "conteudo_eventos", "conteudo_jobs", "conteudo_metricas"} {
		if v := um(`select coalesce(to_regclass($1::text)::text, 'falta')`, "public."+tab); v == "falta" {
			t.Errorf("tabela %s não existe", tab)
		}
	}
	if v := um(`select string_agg(tgname::text || ':' || (tgtype::int & 2 = 2)::text || ':' || (tgtype::int & 16 = 16)::text, ',')
		from pg_trigger where tgrelid = 'conteudo_pecas'::regclass and not tgisinternal`); v != "conteudo_pecas_guarda:true:true" {
		t.Errorf("gatilho de conteudo_pecas = %s, esperava conteudo_pecas_guarda BEFORE UPDATE", v)
	}
	// defaults
	if v := um(`select status || '|' || legenda || '|' || hashtags from conteudo_pecas where id = $1::uuid`, pecaRasc); v != "rascunho||" {
		t.Errorf("defaults da peça = %s", v)
	}
	if v := um(`with n as (insert into conteudo_ideias (titulo) values ('x') returning *) select situacao || '|' || origem || '|' || roteiro::text from n`); v != "nova|manual|[]" {
		t.Errorf("defaults da ideia = %s", v)
	}
	if v := um(`with n as (insert into conteudo_jobs (account_id) values ($1::uuid) returning *) select tipo || '|' || status || '|' || params::text from n`, conta); v != "ideias|enfileirado|{}" {
		t.Errorf("defaults do job = %s", v)
	}
	como := func(id, sql string, args ...any) error {
		return banco.ComUsuario(ctx, p, id, func(tx pgx.Tx) error { _, err := tx.Exec(ctx, sql, args...); return err })
	}
	// a guarda: sem conteudo.aprovar, nem aprovar nem agendar vindo de em_aprovacao; com identidade nula, passa
	for _, s := range []string{"aprovada", "reprovada", "agendada"} {
		err := como(editor, `update conteudo_pecas set status = $1::text where id = $2::uuid`, s, pecaEm)
		if c, m := codigo(err); c != "P0001" || m != "Sem permissao para aprovar pecas de conteudo." {
			t.Errorf("editor levou a %s: %v", s, err)
		}
	}
	if v := um(`select status from conteudo_pecas where id = $1::uuid`, pecaEm); v != "em_aprovacao" {
		t.Errorf("negado gravou: %s", v)
	}
	if err := como(editor, `update conteudo_pecas set legenda = 'nova' where id = $1::uuid`, pecaEm); err != nil {
		t.Errorf("editar a legenda: %v", err)
	}
	if err := como(editor, `update conteudo_pecas set status = 'em_aprovacao' where id = $1::uuid`, pecaRasc); err != nil {
		t.Errorf("mandar para aprovação: %v", err)
	}
	if v := um(`select (updated_at > created_at)::text from conteudo_pecas where id = $1::uuid`, pecaRasc); v != "true" {
		t.Error("a guarda não tocou updated_at")
	}
	// a função de decidir: aprovador passa, grava quem aprovou e o evento; o segundo recebe a frase do trinco
	err := banco.ComUsuario(ctx, p, aprova, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `select conteudo_decidir($1::uuid, 'aprovada', null)`, pecaEm)
		return err
	})
	if err != nil {
		t.Fatalf("aprovador decidindo: %v", err)
	}
	if v := um(`select status || '|' || aprovado_por::text || '|' || (select count(*) from conteudo_eventos where peca_id = $1::uuid and acao = 'aprovou')::text
		from conteudo_pecas where id = $1::uuid`, pecaEm); v != "aprovada|"+aprova+"|1" {
		t.Errorf("depois de decidir: %s", v)
	}
	err = banco.ComUsuario(ctx, p, aprova, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `select conteudo_decidir($1::uuid, 'aprovada', null)`, pecaEm)
		return err
	})
	if c, m := codigo(err); c != "P0001" || m != "Esta peca nao esta esperando aprovacao (alguem ja decidiu?)." {
		t.Errorf("segunda decisão: %v", err)
	}
	// restrições
	if c, _ := codigo(como(editor, `insert into conteudo_pecas (account_id, titulo, formato) values ($1::uuid, 'x', 'tiktok')`, conta)); c != "23514" {
		t.Errorf("formato fora da lista: %s", c)
	}
	if c, _ := codigo(como(editor, `insert into conteudo_pecas (account_id, titulo, formato, status) values ($1::uuid, 'x', 'feed', 'agendada')`, conta)); c != "23514" {
		t.Errorf("agendada sem data: %s", c)
	}
	// o INSERT não passa pela guarda (BEFORE UPDATE): por isso a rota de criar não aceita status (Ruling 5.9-6)
	if err := como(editor, `insert into conteudo_pecas (account_id, titulo, formato, status, publicar_em) values ($1::uuid, 'pulou', 'feed', 'agendada', now())`, conta); err != nil {
		t.Errorf("o insert direto de peça agendada devia passar no banco (é a rota que barra): %v", err)
	}
	// cascata e set null
	if _, err := p.Exec(ctx, `insert into conteudo_arquivos (peca_id, caminho, tipo) values ('`+pecaRasc+`', 'a/b/1.png', 'imagem');
		insert into conteudo_eventos (peca_id, acao) values ('`+pecaRasc+`', 'criou');
		insert into conteudo_metricas (peca_id, capturado_em, curtidas) values ('`+pecaRasc+`', '2026-10-01', 3);
		insert into conteudo_casamentos (peca_id, ig_media_id, pontuacao) values ('`+pecaRasc+`', 'IG9', 0.5);
		insert into conteudo_ideias (titulo, peca_id) values ('ligada', '`+pecaRasc+`')`); err != nil {
		t.Fatal(err)
	}
	if c, _ := codigo(como(editor, `insert into conteudo_arquivos (peca_id, caminho, tipo) values ($1::uuid, 'a/b/2.png', 'imagem')`, pecaRasc)); c != "23505" {
		t.Errorf("duas capas na ordem 1: %s", c)
	}
	if _, err := p.Exec(ctx, `delete from conteudo_pecas where id = $1::uuid`, pecaRasc); err != nil {
		t.Fatal(err)
	}
	if v := um(`select ((select count(*) from conteudo_arquivos) + (select count(*) from conteudo_metricas) + (select count(*) from conteudo_casamentos)
		+ (select count(*) from conteudo_eventos where peca_id = $1::uuid))::text || '|' || coalesce((select peca_id::text from conteudo_ideias where titulo = 'ligada'), 'nulo')`, pecaRasc); v != "0|nulo" {
		t.Errorf("cascata = %s", v)
	}
	// tipos que a restritiva e as rotas presumem
	if v := um(`select string_agg(c.relname || '.' || format_type(a.atttypid, a.atttypmod), ',' order by c.relname) from pg_attribute a
		join pg_class c on c.oid = a.attrelid where a.attname = 'account_id' and c.relkind = 'r' and c.relname like 'conteudo\_%'`); v != "conteudo_blocos.uuid,conteudo_concorrentes.uuid,conteudo_ideias.uuid,conteudo_jobs.uuid,conteudo_pecas.uuid" {
		t.Errorf("account_id = %s", v)
	}
}
```

- [ ] **Step 5:** `cd api && gofmt -l ./internal && go test -count=1 -run 'TestFatia|TestEsquema|TestNomesDosArquivos' ./internal/testebanco/` PASS (inclui o teste de nomes de dois dígitos do 5.1); mutações de (b) reprovam, uma por vez.
- [ ] **Step 6: Commit** `test(api): D0 — fatia 5.9 do esquema (as 9 tabelas do Conteúdo, o gatilho da aprovação e as 6 RPCs verbatim)` (+ `Co-Authored-By`).
---

### Task 2: `dados.Tabela.Conferir` — a regra que o catálogo não enxerga, na transação que grava

**Revisor:** opus. **Depende de:** 5.1 (`dados.Tabela`, `RotaCriar/RotaEditar/RotaApagar`).

**(a) Contrato**
- `dados.Tabela` ganha o campo opcional `Conferir func(ctx, tx pgx.Tx, e *autz.Escopo, id string, campos map[string]any) error`. `Tabela.Criar/Editar/Apagar` o chamam na MESMA transação, **depois** do `PodeCriar/PodeEditar/PodeApagar` (a linha já está travada e sabidamente visível: um id invisível responde 404 antes, sem a conferência rodar — nenhum oráculo) e **antes** do `INSERT/UPDATE/DELETE`. `id = ""` na criação (os `campos` já trazem a coluna `Autor`, com o id da sessão); `campos = nil` no apagar. `autz.ErrNegado` → 403, `autz.ErrNaoEncontrado` → 404, outro erro → `ErroDeEscrita` (500 sem o texto). `RotaCriar/RotaEditar/RotaApagar` não mudam: herdam o gancho pela `Tabela`.
- Por que no `dados` e não em handlers próprios do Conteúdo: o gancho é o mesmo que o 5.7 deu ao `rpc.Funcao.Conferir`, mantém a validação de montagem das structs (`colunasDoCorpo`) e o mapa ÚNICO de escrita (a conferência vê exatamente o que vai ao `INSERT`), e serve ao 5.10/5.11 (filhas de tabelas com restritiva). Nenhuma rota existente muda (campo nil = nada).
- Convive com `CriarSoLegivel` do 5.2 (trilha A), se ele entrar antes: são campos distintos da mesma struct (conflito de merge mecânico; os dois `if` ficam um depois do outro). **Ensaiado** (worktree sobre o 5.7): `go test ./internal/dados/` inteiro passa com a mudança e o teste novo.

```go
// em dados/escrita.go, no fim da struct Tabela (depois de Autor):

	// Conferir (opcional): a regra que o catálogo NÃO enxerga — a linha-mãe visível, a linha nova legível, um
	// caminho preso à mãe. Roda na MESMA transação, DEPOIS do PodeCriar/PodeEditar/PodeApagar (a linha já
	// está travada e sabidamente visível: id invisível responde 404 antes, sem oráculo) e ANTES do SQL que
	// grava. id = "" na criação; campos = nil no apagar; na criação os campos já trazem a coluna Autor.
	// autz.ErrNegado = 403, autz.ErrNaoEncontrado = 404; outro erro segue ErroDeEscrita. Plano 5.9 (Ruling 5.9-4).
	Conferir func(ctx context.Context, tx pgx.Tx, e *autz.Escopo, id string, campos map[string]any) error

// em Tabela.Criar, logo depois do `if err := cat.PodeCriar(...)`:
	if err := t.conferir(ctx, tx, e, "", campos); err != nil {
		return nil, err
	}

// em Tabela.Editar, logo depois do `if err := cat.PodeEditar(...)`:
	if err := t.conferir(ctx, tx, e, id, campos); err != nil {
		return nil, err
	}

// em Tabela.Apagar, logo depois do `if err := cat.PodeApagar(...)`:
	if err := t.conferir(ctx, tx, e, id, nil); err != nil {
		return err
	}

// antes de `devolver`:

// conferir roda Tabela.Conferir, se houver.
func (t Tabela) conferir(ctx context.Context, tx pgx.Tx, e *autz.Escopo, id string, campos map[string]any) error {
	if t.Conferir == nil {
		return nil
	}
	return t.Conferir(ctx, tx, e, id, campos)
}
```

**(b) Testes de aceitação** (`TestTabelaConferir`, `dados/escrita_conferir_test.go`, código abaixo; reusa `catalogoDeEscrita`, `corpoCoisa`, `quemEscreve`, `coisaA1/A2` de `escrita_test.go`)
- Criar passa e a conferência vê a autoria da sessão; recusada com `ErrNegado` → 403, com `ErrNaoEncontrado` → 404, com outro erro → 500 sem o texto — e em todas o banco fica igual, **inclusive a linha que a própria conferência gravou** (mesma transação).
- Sem a regra de criar do catálogo: 403 do `PodeCriar`, conferência NÃO roda. Linha invisível no PATCH: 404 do `PodeEditar`, conferência NÃO roda. Editar passa com o id da linha; apagar recebe `campos` nil.
- Mutações que têm de reprovar: chamar a conferência ANTES do `PodeEditar` (o caso da linha invisível a chama); rodá-la no pool em vez da `tx` (a linha do log fica); ignorar o erro dela (o caso 403 grava).

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
	"github.com/jackc/pgx/v5"
	"github.com/rbv-co/social-dashboard/api/internal/autz"
	"github.com/rbv-co/social-dashboard/api/internal/testebanco"
)

// Tabela.Conferir (Plano 5.9): roda na MESMA transação que grava, depois do PodeX e antes do SQL; o erro dela
// desfaz tudo (inclusive o que ela mesma gravou) e vira 403/404/500 por ErroDeEscrita.
func TestTabelaConferir(t *testing.T) {
	cat, err := autz.Compilar([]byte(catalogoDeEscrita))
	if err != nil {
		t.Fatal(err)
	}
	p := testebanco.Novo(t)
	ctx := context.Background()
	if _, err := p.Exec(ctx, `create table coisa (id uuid primary key default gen_random_uuid(), account_id text,
		  nome text not null default 'sem nome', apelido text, nivel int, criado_por text);
		create table coisa_log (id uuid, quem text);
		insert into coisa (id, account_id, nome) values ('`+coisaA1+`', 'A1', 'um'), ('`+coisaA2+`', 'A2', 'dois')`); err != nil {
		t.Fatal(err)
	}
	var chamadas []string
	tab := Tabela{Nome: "coisa", Resposta: "t.id, t.account_id, t.nome, t.criado_por", Autor: "criado_por",
		Conferir: func(ctx context.Context, tx pgx.Tx, e *autz.Escopo, id string, campos map[string]any) error {
			nome := ""
			if v, ok := campos["nome"].(json.RawMessage); ok {
				json.Unmarshal(v, &nome)
			}
			autor, _ := campos["criado_por"].(string)
			chamadas = append(chamadas, id+"|"+nome+"|"+autor+"|"+map[bool]string{true: "apagar", false: "gravar"}[campos == nil])
			// grava ANTES de recusar: se a transação não fosse a mesma, a linha ficaria
			if _, err := tx.Exec(ctx, `insert into coisa_log values (gen_random_uuid(), 'conferir')`); err != nil {
				return err
			}
			switch {
			case nome == "barrado" || (campos == nil && id == coisaA1):
				return autz.ErrNegado
			case nome == "sumido":
				return autz.ErrNaoEncontrado
			case nome == "explode":
				return errors.New("defeito da conferência")
			}
			return nil
		}}
	escopos := map[string]*autz.Escopo{
		"frota-a1": {ID: quemEscreve, TemPerfil: true, Ativo: true, SemTrava: true, Modulos: []string{"frota"}, Contas: []string{"A1"}},
		"so-a1":    {ID: quemEscreve, TemPerfil: true, Ativo: true, SemTrava: true, Contas: []string{"A1"}},
		"super":    {ID: quemEscreve, TemPerfil: true, Ativo: true, SuperFicha: true},
	}
	r := chi.NewRouter()
	r.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
			next.ServeHTTP(w, req.WithContext(autz.NoContexto(req.Context(), escopos[req.Header.Get("X-Quem")])))
		})
	})
	r.Post("/coisas", RotaCriar[corpoCoisa](p, cat, tab))
	r.Patch("/coisas/{id}", RotaEditar[corpoCoisa](p, cat, tab))
	r.Delete("/coisas/{id}", RotaApagar(p, cat, tab))
	um := func(sql string) string {
		var v string
		if err := p.QueryRow(ctx, sql).Scan(&v); err != nil {
			t.Fatalf("%s: %v", sql, err)
		}
		return v
	}
	const foto = `select (select count(*) from coisa_log)::text || '|' || (select string_agg(id::text || ':' || nome, ',' order by id) from coisa)`
	for _, c := range []struct {
		nome, quem, metodo, caminho, corpo string
		status                             int
		chamada                            string // a última chamada de Conferir; "" = não foi chamada
		muda                               bool
	}{
		{"criar passa e Conferir vê a autoria da sessão", "frota-a1", "POST", "/coisas", `{"account_id":"A1","nome":"tres"}`, 201, "|tres|" + quemEscreve + "|gravar", true},
		{"criar recusado: 403 e nada gravado (nem o log da conferência)", "frota-a1", "POST", "/coisas", `{"account_id":"A1","nome":"barrado"}`, 403, "|barrado|" + quemEscreve + "|gravar", false},
		{"criar com ErrNaoEncontrado: 404", "frota-a1", "POST", "/coisas", `{"account_id":"A1","nome":"sumido"}`, 404, "|sumido|" + quemEscreve + "|gravar", false},
		{"erro qualquer: 500 sem detalhe", "frota-a1", "POST", "/coisas", `{"account_id":"A1","nome":"explode"}`, 500, "|explode|" + quemEscreve + "|gravar", false},
		{"sem a regra de criar: o PodeCriar barra ANTES (Conferir não roda)", "so-a1", "POST", "/coisas", `{"account_id":"A1","nome":"x"}`, 403, "", false},
		{"editar passa com o id da linha", "so-a1", "PATCH", "/coisas/" + coisaA1, `{"nome":"um!"}`, 200, coisaA1 + "|um!||gravar", true},
		{"editar recusado: 403 e intacta", "so-a1", "PATCH", "/coisas/" + coisaA1, `{"nome":"barrado"}`, 403, coisaA1 + "|barrado||gravar", false},
		{"linha invisível: 404 do PodeEditar, Conferir não roda", "so-a1", "PATCH", "/coisas/" + coisaA2, `{"nome":"barrado"}`, 404, "", false},
		{"apagar recusado pela conferência: 403 e fica", "super", "DELETE", "/coisas/" + coisaA1, "", 403, coisaA1 + "|||apagar", false},
		{"apagar passa (campos nil)", "super", "DELETE", "/coisas/" + coisaA2, "", 204, coisaA2 + "|||apagar", true},
	} {
		chamadas = nil
		antes := um(foto)
		req := httptest.NewRequest(c.metodo, c.caminho, strings.NewReader(c.corpo))
		req.Header.Set("X-Quem", c.quem)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		ultima := ""
		if len(chamadas) > 0 {
			ultima = chamadas[len(chamadas)-1]
		}
		if w.Code != c.status || ultima != c.chamada || len(chamadas) > 1 {
			t.Errorf("%s: %d %s; Conferir = %v, esperava %d e %q", c.nome, w.Code, w.Body, chamadas, c.status, c.chamada)
		}
		if mudou := um(foto) != antes; mudou != c.muda {
			t.Errorf("%s: o banco mudou = %t, esperava %t (%s → %s)", c.nome, mudou, c.muda, antes, um(foto))
		}
		if c.status == 500 && strings.Contains(w.Body.String(), "conferência") {
			t.Errorf("%s: o texto do erro interno vazou: %s", c.nome, w.Body)
		}
	}
}
```

**(c) Arquivos:** Modify `api/internal/dados/escrita.go`; Create `api/internal/dados/escrita_conferir_test.go`.

**(d) Dependências:** 5.1 (`dados.Tabela`). Independente da Task 1 (onda 1).

- [ ] **Step 1:** O teste; ver falhar (`Conferir` não existe: não compila). - [ ] **Step 2:** Implementar (código de (a)). - [ ] **Step 3:** `cd api && gofmt -l ./internal && go vet ./internal/dados/ && go test -count=1 ./internal/dados/` PASS (todos os testes do pacote, não só o novo); mutações reprovam. - [ ] **Step 4:** Commit `feat(api): dados.Tabela.Conferir — a regra que o catálogo não enxerga, na mesma transação, depois do PodeX` (+ `Co-Authored-By`).
---

### Task 3: `conteudo` — fundação (regras, conferências de peça e de conta, mundo, foto)

**Revisor:** opus. **Depende de:** 1, 2; `mundoteste` e `dados.SoSessaoPropria` (5.2, vindos com o 5.7).

**(a) Contrato**
- `api/internal/conteudo/conteudo.go` (abaixo): a doc do pacote passa a ser esta (a linha `// Package conteudo: os robôs da Central de Conteúdo (hora H e espelho com o Instagram).` sai de `casar.go`, que fica igual no resto), as três regras, `soSessaoPropria`, `deve`, as conferências que as Tasks 5–8 usam (`pecaVisivel`, `negado`, `soLegivelAoCriar`) e os validadores de `json.RawMessage` (moram aqui para as Tasks 4–8 andarem em paralelo).
- **Nomes que o pacote já usa** (robôs do Plano 4) e que NÃO podem ser declarados de novo: `formatos` (`hora_h.go`), `chave`, `casar`, `normalizar`, `ouNulo`, `numeroOuNulo`, `nota`, `Peca`, `Midia`, `Achado`, `Espelho`, `HoraH`, `pictografico`, `prazoPorPeca`; e o IMPORT `texto` (`casar.go` importa `internal/texto`: um `func texto` no pacote não compila — por isso `comoTexto`). Nos testes: `peca`, `eventos`, `hora`, `umPar`, `contaVessel`, `bancoConteudo`, `tabelasConteudo`, `uConteudo`, `uOutro`, `uSemAcess`, `roundTripFunc`, `graphFalsa`, `coreConteudo`.
- `Conteudista` e `Aprovador` são as checagens das FUNÇÕES (sem conta ativa: SECURITY DEFINER); as TABELAS usam o catálogo (a mesma trinca COM conta ativa). `PedeIA` é o portão da edge `conteudo-trigger` (Ruling 5.9-11). A Task 7 prova `Conteudista`/`Aprovador` iguais às funções pessoa a pessoa.
- `pecaVisivel` é a regra de Ler de `conteudo_pecas` (do catálogo, pelo `Filtro`) aplicada a UMA peça, dentro da transação: é o que prende as filhas (arquivo, evento) e os parâmetros das RPCs à restritiva da peça (Rulings 5.9-3, 5.9-4, 5.9-10).
- Teste (interno): `novoMundo(t, montar...) *mundoteste.Mundo` com a fatia, as pessoas, as linhas e a foto abaixo; sessão `impersonado` = a de `conteudistaA1` aberta por `super`.
- **Ensaiado** (worktree sobre o 5.7 + Tasks 1 e 2): os três testes abaixo passam.

```go
// Package conteudo: a Central de Conteúdo. Os robôs do Plano 4 (hora H: o aviso da peça agendada; espelho:
// casar a peça com o post do Instagram e medir) e as rotas do sub-plano 5.9: leituras do painel
// (dados.Consulta, regra do catálogo; a restritiva pode_ver_conta em peças, ideias, blocos e jobs; as filhas
// da peça presas a ela), escritas pelo catálogo com Tabela.Conferir (a regra que o catálogo não enxerga), as
// 6 RPCs (portão = a checagem de dentro de cada função) e POST /conteudo-trigger (a fila do robô da VPS).
// Toda escrita em banco.ComUsuario: o gatilho conteudo_guarda_aprovacao lê auth.uid(). "Entrar como" só lê.
package conteudo

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"regexp"
	"slices"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
	"github.com/rbv-co/social-dashboard/api/internal/autz"
	"github.com/rbv-co/social-dashboard/api/internal/dados"
)

// Conteudista: a checagem de dentro de conteudo_casar_na_mao, _decidir_casamento, _ideia_virar_peca e
// _reavisar (02-funções.csv:224-289, 322-366, 408-474): perfil com papel admin, is_superadmin (a FICHA) ou o
// módulo 'conteudo' em features. Sem conta_ativa, como as funções: são SECURITY DEFINER, a subconsulta em
// profiles não passa pela RLS (a sessão de conta desativada nem existe: auth.Exigir a recusa). As TABELAS
// usam a regra do catálogo (a mesma trinca, com conta ativa), não esta. Ruling 5.9-9.
var Conteudista = autz.Regra(func(e *autz.Escopo) bool {
	return e != nil && e.TemPerfil && (e.Papel == "admin" || e.SuperFicha || e.Modulo("conteudo"))
})

// Aprovador: a de conteudo_decidir, conteudo_aprovar_e_agendar e do gatilho conteudo_guarda_aprovacao
// (02-funções.csv:178-223, 290-321, 367-407): a mesma trinca com 'conteudo.aprovar' em features.
var Aprovador = autz.Regra(func(e *autz.Escopo) bool {
	return e != nil && e.TemPerfil && (e.Papel == "admin" || e.SuperFicha || e.Modulo("conteudo.aprovar"))
})

// PedeIA: o portão da edge conteudo-trigger (index.ts:36-42): papel admin, is_superadmin (ficha), a chave
// 'conteudo' em permissions ou o módulo 'conteudo' em features. Difere da edge em dois cantos (Ruling 5.9-11):
// a chave casa também como texto de um array no topo de permissions (o `?` do jsonb, que Escopo.Chaves segue;
// o hasOwnProperty da edge não casava) e a conta desativada não passa.
var PedeIA = autz.Regra(func(e *autz.Escopo) bool {
	return e != nil && e.TemPerfil && e.Ativo &&
		(e.Papel == "admin" || e.SuperFicha || e.Chaves["conteudo"] || e.Modulo("conteudo"))
})

var soSessaoPropria = dados.SoSessaoPropria(dados.FraseEntrarComo)

// deve: declaração de rota errada (Consulta ou Tabela fora do catálogo) faz a API não subir.
func deve(err error) {
	if err != nil {
		panic(err)
	}
}

var (
	reUUID = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)
	// os checks das migrations (e src/ferramentas/conteudo/estados.js e formatos.js). "formatos" já é nome do
	// hora_h.go (os rótulos do aviso).
	estadosDaPeca  = []string{"rascunho", "em_aprovacao", "aprovada", "reprovada", "agendada", "publicada", "arquivada"}
	formatosDaPeca = []string{"feed", "reels", "stories", "carrossel"}
)

// bruto: o valor JSON de uma coluna no mapa de escrita (dados.Campos guarda json.RawMessage); ausente = nil.
func bruto(campos map[string]any, col string) json.RawMessage {
	v, _ := campos[col].(json.RawMessage)
	return v
}

// comoTexto: o valor JSON é texto? (null, número, objeto: não). Não se chama "texto": casar.go importa o
// pacote internal/texto, e o nome do pacote e o da função não podem conviver no mesmo pacote Go.
func comoTexto(v json.RawMessage) (string, bool) {
	var s string
	if len(v) == 0 || v[0] != '"' || json.Unmarshal(v, &s) != nil {
		return "", false
	}
	return s, true
}

// textoAte: texto de até max caracteres; vazio (ou só espaço) só se vazioPode.
func textoAte(v json.RawMessage, max int, vazioPode bool) bool {
	s, ok := comoTexto(v)
	return ok && utf8.RuneCountInString(s) <= max && (vazioPode || strings.TrimSpace(s) != "")
}

func casa(v json.RawMessage, re *regexp.Regexp) bool {
	s, ok := comoTexto(v)
	return ok && re.MatchString(s)
}

func nulo(v json.RawMessage) bool { return strings.TrimSpace(string(v)) == "null" }

func textoEm(v json.RawMessage, opcoes ...string) bool {
	s, ok := comoTexto(v)
	return ok && slices.Contains(opcoes, s)
}

// textoOuNulo: null ou texto de até max caracteres (vazio pode).
func textoOuNulo(v json.RawMessage, max int) bool { return nulo(v) || textoAte(v, max, true) }

func uuidOuNulo(v json.RawMessage) bool { return nulo(v) || casa(v, reUUID) }

// instanteOuNulo: null ou um instante RFC 3339 (o toISOString da tela: "2026-10-20T15:00:00.000Z").
func instanteOuNulo(v json.RawMessage) bool {
	if nulo(v) {
		return true
	}
	s, ok := comoTexto(v)
	if !ok {
		return false
	}
	_, err := time.Parse(time.RFC3339, s)
	return err == nil
}

func inteiroEntre(v json.RawMessage, min, max int64) bool {
	var n int64
	return json.Unmarshal(v, &n) == nil && n >= min && n <= max
}

func booleano(v json.RawMessage) bool { s := string(v); return s == "true" || s == "false" }

// pecaVisivel: a peça existe e quem pede a LÊ (a regra de Ler de conteudo_pecas: conteudista do catálogo E
// pode_ver_conta da conta dela); devolve a conta. Senão autz.ErrNaoEncontrado — igual para "não existe", "id
// inválido" e "é de outra conta" (IDOR). Sem trava de linha: mudar a conta de uma peça no meio da transação de
// outra pessoa é corrida que a tela não faz (ponytail: `for no key update` se um dia mover peça entre contas
// virar operação comum). Ruling 5.9-3/5.9-4.
func pecaVisivel(ctx context.Context, tx pgx.Tx, e *autz.Escopo, peca string) (string, error) {
	if !reUUID.MatchString(peca) {
		return "", autz.ErrNaoEncontrado
	}
	f, err := autz.Producao.Filtro(e, "conteudo_pecas", autz.Ler, "pc")
	if err != nil {
		return "", err
	}
	var conta string
	err = tx.QueryRow(ctx, `select pc.account_id::text from conteudo_pecas pc where pc.id = @peca::uuid and (`+f.SQL+`)`,
		f.Juntar(pgx.NamedArgs{"peca": peca})).Scan(&conta)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", autz.ErrNaoEncontrado
	}
	return conta, err
}

// negado: na criação de uma filha (e nos parâmetros de RPC), a mãe invisível e a inexistente respondem igual,
// 403 (como o CriarSoLegivel do 5.2): o pedido não confirma que a mãe existe.
func negado(err error) error {
	if errors.Is(err, autz.ErrNaoEncontrado) {
		return autz.ErrNegado
	}
	return err
}

// soLegivelAoCriar: Tabela.Conferir das tabelas com a restritiva. A linha criada tem de passar na regra de LER
// de quem cria (o Criar do catálogo é só o WITH CHECK, sem a restritiva de select: criar peça/ideia/bloco numa
// conta que não se vê passaria e devolveria só o id). Ruling 5.9-4. Na edição o PodeEditar já confere a
// linha nova com a regra de Ler (EditarNova).
func soLegivelAoCriar(tab string) func(context.Context, pgx.Tx, *autz.Escopo, string, map[string]any) error {
	return func(ctx context.Context, tx pgx.Tx, e *autz.Escopo, id string, campos map[string]any) error {
		if id != "" || campos == nil {
			return nil
		}
		f, err := autz.Producao.Filtro(e, tab, autz.Ler, "autz_nova")
		if err != nil {
			return err
		}
		ok, err := autz.Conferir(ctx, tx, f, tab, campos)
		if err != nil {
			return err
		}
		if !ok {
			return autz.ErrNegado
		}
		return nil
	}
}

// responder: o corpo da edge portada ({"error": código}, {"job_id": …}), que a tela já lê.
func responder(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}
```

`api/internal/conteudo/mundo_test.go`:

```go
package conteudo

import (
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/testebanco/mundoteste"
)

const (
	A1 = "a5900000-0000-4000-a000-0000000000a1" // 'Vessel'
	A2 = "a5900000-0000-4000-a000-0000000000a2" // 'Mantova'
	A9 = "a5900000-0000-4000-a000-0000000000a9" // conta que não existe

	P1 = "a5930000-0000-4000-a000-0000000000c1" // A1, rascunho, com 2 arquivos e 1 evento
	P2 = "a5930000-0000-4000-a000-0000000000c2" // A1, em_aprovacao, com data
	P3 = "a5930000-0000-4000-a000-0000000000c3" // A2, em_aprovacao, com data, 1 arquivo, 1 evento, 1 sugestão
	P4 = "a5930000-0000-4000-a000-0000000000c4" // A1, agendada e já avisada, 2 sugestões
	P5 = "a5930000-0000-4000-a000-0000000000c5" // A2, publicada, 2 métricas
	P6 = "a5930000-0000-4000-a000-0000000000c6" // A1, publicada, 2 métricas
	P7 = "a5930000-0000-4000-a000-0000000000c7" // A1, em_aprovacao SEM data

	AR1 = "a5940000-0000-4000-a000-0000000000d1" // P1, ordem 1, imagem (a capa)
	AR2 = "a5940000-0000-4000-a000-0000000000d2" // P1, ordem 2, vídeo
	AR3 = "a5940000-0000-4000-a000-0000000000d3" // P3, ordem 1, imagem

	CS1 = "a5950000-0000-4000-a000-0000000000e1" // P4, sugerido, 0.7
	CS2 = "a5950000-0000-4000-a000-0000000000e2" // P4, sugerido, 0.5
	CS3 = "a5950000-0000-4000-a000-0000000000e3" // P3, sugerido, 0.9

	I1 = "a5960000-0000-4000-a000-0000000000f1" // A1, nova, da IA
	I2 = "a5960000-0000-4000-a000-0000000000f2" // de todas as marcas (conta nula), nova
	I3 = "a5960000-0000-4000-a000-0000000000f3" // A2, favorita
	I4 = "a5960000-0000-4000-a000-0000000000f4" // A1, descartada
	I5 = "a5960000-0000-4000-a000-0000000000f5" // A1, usada

	B1 = "a5970000-0000-4000-a000-000000000001" // A1, legenda
	B2 = "a5970000-0000-4000-a000-000000000002" // de todas, hashtags
	B3 = "a5970000-0000-4000-a000-000000000003" // A2, cta
	B4 = "a5970000-0000-4000-a000-000000000004" // A1, assinatura, inativo

	K1 = "a5980000-0000-4000-a000-000000000001" // A1, lojaum
	K2 = "a5980000-0000-4000-a000-000000000002" // A2, lojadois

	J1 = "a5990000-0000-4000-a000-000000000001" // A1, ideias, concluído
	J2 = "a5990000-0000-4000-a000-000000000002" // A2, semana, erro

	idConteudista        = "a5910000-0000-4000-a000-000000000001"
	idConteudistaA1      = "a5910000-0000-4000-a000-000000000002"
	idConteudistaNenhuma = "a5910000-0000-4000-a000-000000000003"
	idAprovador          = "a5910000-0000-4000-a000-000000000004"
	idAprovadorA1        = "a5910000-0000-4000-a000-000000000005"
	idSoAprovar          = "a5910000-0000-4000-a000-000000000006"
	idAdminA1            = "a5910000-0000-4000-a000-000000000007"
	idSuper              = "a5910000-0000-4000-a000-000000000008"
	idChaveConteudo      = "a5910000-0000-4000-a000-000000000009"
	idSemModulo          = "a5910000-0000-4000-a000-000000000010"
	idDesativado         = "a5910000-0000-4000-a000-000000000011"
)

// pessoas: o conteudista nos três estados de allowed_accounts (nulo, lista, vazia), o aprovador com e sem
// lista, quem só tem 'conteudo.aprovar' (passa no portão das decisões, não lê as tabelas), quem passa por papel
// (admin) e pela ficha (super), quem tem a chave 'conteudo' só em PERMISSIONS (a edge conteudo-trigger aceita;
// as policies e as funções, não), quem não tem nada e o desativado. A chave vai em linhasDoConteudo.
var pessoas = []mundoteste.Pessoa{
	{Chave: "conteudista", ID: idConteudista, Email: "conteudista@x.com", Papel: "viewer", Modulos: []string{"conteudo"}},
	{Chave: "conteudistaA1", ID: idConteudistaA1, Email: "conteudistaa1@x.com", Papel: "viewer", Modulos: []string{"conteudo"}, Contas: []string{A1}},
	{Chave: "conteudistaNenhuma", ID: idConteudistaNenhuma, Email: "conteudistanenhuma@x.com", Papel: "viewer", Modulos: []string{"conteudo"}, Contas: []string{}},
	{Chave: "aprovador", ID: idAprovador, Email: "aprovador@x.com", Papel: "viewer", Modulos: []string{"conteudo", "conteudo.aprovar"}},
	{Chave: "aprovadorA1", ID: idAprovadorA1, Email: "aprovadora1@x.com", Papel: "viewer", Modulos: []string{"conteudo", "conteudo.aprovar"}, Contas: []string{A1}},
	{Chave: "soAprovar", ID: idSoAprovar, Email: "soaprovar@x.com", Papel: "viewer", Modulos: []string{"conteudo.aprovar"}},
	{Chave: "adminA1", ID: idAdminA1, Email: "admina1@x.com", Papel: "admin", Contas: []string{A1}},
	{Chave: "super", ID: idSuper, Email: "super@x.com", Papel: "viewer", Super: true},
	{Chave: "chaveConteudo", ID: idChaveConteudo, Email: "chaveconteudo@x.com", Papel: "viewer"},
	{Chave: "semModulo", ID: idSemModulo, Email: "semmodulo@x.com", Papel: "viewer"},
	{Chave: "desativado", ID: idDesativado, Email: "desativado@x.com", Papel: "admin", Modulos: []string{"conteudo", "conteudo.aprovar"}, Desativado: true},
}

// Sem identidade. Toda linha de A2 carrega o uuid de A2 (na conta da linha, da peça-mãe ou no caminho).
const linhasDoConteudo = `
update profiles set permissions = '{"conteudo": ["ver"]}' where id = '` + idChaveConteudo + `';
insert into accounts (id, name, username) values ('` + A1 + `', 'Vessel', 'vessel'), ('` + A2 + `', 'Mantova', 'mantova');
insert into conteudo_pecas (id, account_id, titulo, formato, status, publicar_em, publicado_em, avisado_em, ig_media_id, criado_por, created_at) values
  ('` + P1 + `', '` + A1 + `', 'Bastidor da loja', 'reels', 'rascunho', null, null, null, null, '` + idConteudista + `', '2026-10-01T10:00:00Z'),
  ('` + P2 + `', '` + A1 + `', 'Lançamento', 'feed', 'em_aprovacao', '2026-10-20T15:00:00Z', null, null, null, '` + idConteudista + `', '2026-10-02T10:00:00Z'),
  ('` + P3 + `', '` + A2 + `', 'Mantova verão', 'carrossel', 'em_aprovacao', '2026-10-21T15:00:00Z', null, null, null, '` + idConteudista + `', '2026-10-03T10:00:00Z'),
  ('` + P4 + `', '` + A1 + `', 'Promoção', 'stories', 'agendada', '2026-10-10T15:00:00Z', null, '2026-10-10T15:00:00Z', null, '` + idConteudista + `', '2026-10-04T10:00:00Z'),
  ('` + P5 + `', '` + A2 + `', 'Mantova publicada', 'feed', 'publicada', '2026-09-10T15:00:00Z', '2026-09-10T15:05:00Z', null, 'IG5', '` + idConteudista + `', '2026-09-01T10:00:00Z'),
  ('` + P6 + `', '` + A1 + `', 'Vessel publicada', 'feed', 'publicada', '2026-09-11T15:00:00Z', '2026-09-11T15:05:00Z', null, 'IG6', '` + idConteudista + `', '2026-09-02T10:00:00Z'),
  ('` + P7 + `', '` + A1 + `', 'Sem data', 'feed', 'em_aprovacao', null, null, null, null, '` + idConteudista + `', '2026-10-05T10:00:00Z');
insert into conteudo_arquivos (id, peca_id, ordem, caminho, tipo, mime, bytes) values
  ('` + AR1 + `', '` + P1 + `', 1, '` + A1 + `/` + P1 + `/1-capa.png', 'imagem', 'image/png', 1000),
  ('` + AR2 + `', '` + P1 + `', 2, '` + A1 + `/` + P1 + `/2-video.mp4', 'video', 'video/mp4', 9000),
  ('` + AR3 + `', '` + P3 + `', 1, '` + A2 + `/` + P3 + `/1-capa.png', 'imagem', 'image/png', 1000);
insert into conteudo_eventos (peca_id, para, acao, quem, quando) values
  ('` + P1 + `', 'rascunho', 'criou', '` + idConteudista + `', '2026-10-01T10:00:00Z'),
  ('` + P3 + `', 'rascunho', 'criou', '` + idConteudista + `', '2026-10-03T10:00:00Z');
insert into conteudo_metricas (peca_id, capturado_em, curtidas, alcance) values
  ('` + P5 + `', '2026-09-11', 5, 50), ('` + P5 + `', '2026-09-12', 7, 70),
  ('` + P6 + `', '2026-09-12', 10, 100), ('` + P6 + `', '2026-09-13', 20, 200);
insert into conteudo_casamentos (id, peca_id, ig_media_id, pontuacao, motivo, situacao) values
  ('` + CS1 + `', '` + P4 + `', 'IG41', 0.7, 'legenda parecida', 'sugerido'),
  ('` + CS2 + `', '` + P4 + `', 'IG42', 0.5, 'horário perto', 'sugerido'),
  ('` + CS3 + `', '` + P3 + `', 'IG31', 0.9, 'legenda igual', 'sugerido');
insert into conteudo_ideias (id, account_id, titulo, formato, origem, situacao, created_at) values
  ('` + I1 + `', '` + A1 + `', 'Provador ao vivo', 'reels', 'ia', 'nova', '2026-10-01T10:00:00Z'),
  ('` + I2 + `', null, 'Dica de cuidado com couro', 'carrossel', 'manual', 'nova', '2026-10-02T10:00:00Z'),
  ('` + I3 + `', '` + A2 + `', 'Mantova na praia', 'feed', 'manual', 'favorita', '2026-10-03T10:00:00Z'),
  ('` + I4 + `', '` + A1 + `', 'Descartada', 'feed', 'manual', 'descartada', '2026-10-04T10:00:00Z'),
  ('` + I5 + `', '` + A1 + `', 'Já usada', 'feed', 'manual', 'usada', '2026-10-05T10:00:00Z');
insert into conteudo_blocos (id, account_id, tipo, nome, texto, ativo) values
  ('` + B1 + `', '` + A1 + `', 'legenda', 'Abertura', 'Chegou!', true),
  ('` + B2 + `', null, 'hashtags', 'Gerais', '#moda', true),
  ('` + B3 + `', '` + A2 + `', 'cta', 'Chame', 'Chame no direct', true),
  ('` + B4 + `', '` + A1 + `', 'assinatura', 'Velha', 'Vessel', false);
insert into conteudo_concorrentes (id, account_id, handle, nome) values
  ('` + K1 + `', '` + A1 + `', 'lojaum', 'Loja Um'), ('` + K2 + `', '` + A2 + `', 'lojadois', 'Loja Dois');
insert into conteudo_jobs (id, tipo, account_id, params, status, resultado, criado_por, created_at) values
  ('` + J1 + `', 'ideias', '` + A1 + `', '{"quantas": 12}', 'concluido', '{"gravadas": 12}', '` + idConteudista + `', '2026-10-01T10:00:00Z'),
  ('` + J2 + `', 'semana', '` + A2 + `', '{"segunda": "2026-10-05"}', 'erro', null, '` + idConteudista + `', '2026-10-02T10:00:00Z');`

// fotoDoConteudo: hash das 9 tabelas. Igual antes e depois = nada mudou.
const fotoDoConteudo = `select md5(string_agg(l, '|' order by l)) from (
  select 'pe:' || t::text as l from conteudo_pecas t union all
  select 'ar:' || t::text from conteudo_arquivos t union all
  select 'ev:' || t::text from conteudo_eventos t union all
  select 'me:' || t::text from conteudo_metricas t union all
  select 'ca:' || t::text from conteudo_casamentos t union all
  select 'id:' || t::text from conteudo_ideias t union all
  select 'bl:' || t::text from conteudo_blocos t union all
  select 'co:' || t::text from conteudo_concorrentes t union all
  select 'jo:' || t::text from conteudo_jobs t) z`

// novoMundo: a fatia de produção, as pessoas, as linhas e a sessão "impersonado" (a de conteudistaA1 aberta
// por super: o "entrar como" vê o que o ALVO vê, só A1), com as rotas de `montar` atrás da MESMA cadeia do
// grupo de domínio de web.Rotas.
func novoMundo(t *testing.T, montar ...func(chi.Router, *pgxpool.Pool)) *mundoteste.Mundo {
	t.Helper()
	return mundoteste.Novo(t, mundoteste.Opcoes{Pessoas: pessoas, Linhas: linhasDoConteudo,
		Impersonadas: map[string][2]string{"impersonado": {idConteudistaA1, idSuper}}}, montar...)
}
```

**(b) Testes de aceitação** (`regras_test.go`, código abaixo)
- `TestMundoDoConteudo` (sonda `GET /eco` montada no teste, que escreve `Conteudista|Aprovador|PedeIA|tipo|PodeVerConta(A2)`): a tabela `quer` do código (destaques: `soAprovar` → `false|true|false`: decide mas não lê; `chaveConteudo` → `false|false|true`: pede IA, não lê nem decide; `impersonado` → o que `conteudistaA1` vê); sem sessão e `desativado` → 401; 7 peças no mundo.
- `TestConferencias`: `pecaVisivel` devolve a conta para quem lê a peça e `ErrNaoEncontrado` IGUAL para peça de outra conta, inexistente, id inválido, lista vazia, quem só tem `conteudo.aprovar` e o desativado; `soLegivelAoCriar("conteudo_ideias")` recusa (`ErrNegado`) a ideia nova em A2 para quem só vê A1 e para a lista vazia, aceita a conta nula (de todas as marcas) e não age na edição.
- `TestAjudantes` (puro): os validadores e `negado`.
- Mutações que têm de reprovar: `Conteudista` com `e.Ativo` (a Task 7 acusa o desativado: a função o deixa passar); `PedeIA` sem `e.Chaves["conteudo"]` (`chaveConteudo` vira `false`); `pecaVisivel` sem o `f.SQL` (a peça de A2 aparece para `conteudistaA1`); `soLegivelAoCriar` com `autz.Criar` em vez de `autz.Ler` (A1 cria em A2).

```go
package conteudo

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/auth"
	"github.com/rbv-co/social-dashboard/api/internal/autz"
	"github.com/rbv-co/social-dashboard/api/internal/banco"
)

// As regras pela cadeia real (auth.Exigir → autz.ComEscopo), pessoa a pessoa.
func TestMundoDoConteudo(t *testing.T) {
	m := novoMundo(t, func(r chi.Router, _ *pgxpool.Pool) {
		r.Get("/eco", func(w http.ResponseWriter, r *http.Request) {
			e, a := autz.EscopoDo(r.Context()), auth.AtorDoContexto(r.Context())
			fmt.Fprintf(w, "%t|%t|%t|%s|%t", Conteudista(e), Aprovador(e), PedeIA(e), a.Tipo, autz.PodeVerConta(e, A2))
		})
	})
	quer := map[string]string{
		"conteudista": "true|false|true|painel|true", "conteudistaA1": "true|false|true|painel|false",
		"conteudistaNenhuma": "true|false|true|painel|false", "aprovador": "true|true|true|painel|true",
		"aprovadorA1": "true|true|true|painel|false", "soAprovar": "false|true|false|painel|true",
		"adminA1": "true|true|true|painel|true", "super": "true|true|true|painel|true",
		"chaveConteudo": "false|false|true|painel|true", "semModulo": "false|false|false|painel|true",
		"impersonado": "true|false|true|painel|false",
	}
	for quem, q := range quer {
		if st, b := m.Pedir(t, quem, "GET", "/eco", ""); st != 200 || b != q {
			t.Errorf("%s: %d %s, esperava %s", quem, st, b, q)
		}
	}
	for _, quem := range []string{"", "desativado"} {
		if st, _ := m.Pedir(t, quem, "GET", "/eco", ""); st != http.StatusUnauthorized {
			t.Errorf("%q: %d, esperava 401", quem, st)
		}
	}
	if v := m.Um(t, `select count(*)::text from conteudo_pecas`); v != "7" {
		t.Errorf("peças = %s", v)
	}
}

// pecaVisivel e soLegivelAoCriar contra o banco: a mãe de outra conta, a inexistente e o id inválido
// respondem igual (sem oráculo); quem não lê a tabela não vê peça nenhuma.
func TestConferencias(t *testing.T) {
	m := novoMundo(t)
	ctx := context.Background()
	como := func(id string, f func(tx pgx.Tx, e *autz.Escopo) error) error {
		e, err := autz.CarregarEscopo(ctx, m.P, id)
		if err != nil {
			t.Fatal(err)
		}
		return banco.ComUsuario(ctx, m.P, id, func(tx pgx.Tx) error { return f(tx, e) })
	}
	for _, c := range []struct {
		nome, quem, peca, conta string
		err                     error
	}{
		{"a própria conta", idConteudistaA1, P1, A1, nil},
		{"a peça de A2 para quem só vê A1", idConteudistaA1, P3, "", autz.ErrNaoEncontrado},
		{"a peça de A2 para quem vê todas", idConteudista, P3, A2, nil},
		{"admin vê qualquer conta", idAdminA1, P3, A2, nil},
		{"lista vazia não vê nada", idConteudistaNenhuma, P1, "", autz.ErrNaoEncontrado},
		{"só conteudo.aprovar não lê a tabela", idSoAprovar, P1, "", autz.ErrNaoEncontrado},
		{"o desativado não lê", idDesativado, P1, "", autz.ErrNaoEncontrado},
		{"inexistente", idConteudista, "a5930000-0000-4000-a000-0000000000ff", "", autz.ErrNaoEncontrado},
		{"id inválido", idConteudista, "1 or 1=1", "", autz.ErrNaoEncontrado},
	} {
		var conta string
		err := como(c.quem, func(tx pgx.Tx, e *autz.Escopo) (err error) {
			conta, err = pecaVisivel(ctx, tx, e, c.peca)
			return err
		})
		if !errors.Is(err, c.err) || conta != c.conta {
			t.Errorf("pecaVisivel %s: %q %v, esperava %q %v", c.nome, conta, err, c.conta, c.err)
		}
	}
	conferir := soLegivelAoCriar("conteudo_ideias")
	j := func(s string) json.RawMessage { return json.RawMessage(s) }
	for _, c := range []struct {
		nome, quem, id string
		campos         map[string]any
		err            error
	}{
		{"A1 cria em A1", idConteudistaA1, "", map[string]any{"account_id": j(`"` + A1 + `"`), "titulo": j(`"x"`)}, nil},
		{"A1 cria em A2", idConteudistaA1, "", map[string]any{"account_id": j(`"` + A2 + `"`), "titulo": j(`"x"`)}, autz.ErrNegado},
		{"A1 cria de todas as marcas (conta nula)", idConteudistaA1, "", map[string]any{"account_id": j(`null`), "titulo": j(`"x"`)}, nil},
		{"lista vazia cria em A1", idConteudistaNenhuma, "", map[string]any{"account_id": j(`"` + A1 + `"`)}, autz.ErrNegado},
		{"na edição não confere (o PodeEditar já confere a linha nova)", idConteudistaA1, I3, map[string]any{"account_id": j(`"` + A2 + `"`)}, nil},
	} {
		err := como(c.quem, func(tx pgx.Tx, e *autz.Escopo) error { return conferir(ctx, tx, e, c.id, c.campos) })
		if !errors.Is(err, c.err) {
			t.Errorf("soLegivelAoCriar %s: %v, esperava %v", c.nome, err, c.err)
		}
	}
}

func TestAjudantes(t *testing.T) {
	j := func(s string) json.RawMessage { return json.RawMessage(s) }
	for _, c := range []struct {
		nome string
		ok   bool
	}{
		{"comoTexto recusa null", func() bool { _, ok := comoTexto(j(`null`)); return !ok }()},
		{"comoTexto recusa número", func() bool { _, ok := comoTexto(j(`5`)); return !ok }()},
		{"textoAte conta caracteres", textoAte(j(`"ção"`), 3, false)},
		{"textoAte recusa só espaço sem vazioPode", !textoAte(j(`"  "`), 10, false)},
		{"textoOuNulo aceita null", textoOuNulo(j(`null`), 1)},
		{"uuidOuNulo recusa maiúscula (o banco aceitaria; a tela manda minúscula)", !uuidOuNulo(j(`"A5900000-0000-4000-A000-0000000000A1"`))},
		{"instanteOuNulo aceita o toISOString", instanteOuNulo(j(`"2026-10-20T15:00:00.000Z"`))},
		{"instanteOuNulo recusa data sem hora", !instanteOuNulo(j(`"2026-10-20"`))},
		{"inteiroEntre recusa 1.5", !inteiroEntre(j(`1.5`), 0, 10)},
		{"booleano só true/false", booleano(j(`false`)) && !booleano(j(`"true"`))},
		{"textoEm", textoEm(j(`"feed"`), formatosDaPeca...) && !textoEm(j(`"tiktok"`), formatosDaPeca...)},
		{"bruto de coluna ausente é nil", bruto(map[string]any{}, "x") == nil},
		{"negado troca 404 por 403", errors.Is(negado(autz.ErrNaoEncontrado), autz.ErrNegado)},
	} {
		if !c.ok {
			t.Error(c.nome)
		}
	}
}
```

**(c) Arquivos:** Create `api/internal/conteudo/conteudo.go`, `api/internal/conteudo/mundo_test.go`, `api/internal/conteudo/regras_test.go`; Modify `api/internal/conteudo/casar.go` (só a linha do comentário do pacote).

**(d) Dependências:** Task 1 (fatia); Task 2 (a assinatura do gancho que `soLegivelAoCriar` devolve); `mundoteste`; `autz.CarregarEscopo/Conferir/PodeVerConta`.

- [ ] **Step 1:** Testes; ver falhar. - [ ] **Step 2:** Implementar. - [ ] **Step 3:** `cd api && gofmt -l ./internal && go vet ./internal/conteudo/ && go test -count=1 ./internal/conteudo/` PASS (os testes da hora H e do espelho continuam verdes); mutações reprovam. - [ ] **Step 4:** Commit `feat(api): conteúdo — regras das funções e da edge, peça visível e criar só o legível, mundo de teste` (+ `Co-Authored-By`).
---

### Task 4: Leituras (7) — capa, métrica e sugestão embutidas na peça; as filhas presas à peça

**Revisor:** sonnet. **Depende de:** 3.

**(a) Contrato** (regra de Ler do catálogo em toda leitura; uma rota por necessidade de tela; a tela manda a CONTA, nunca a lista de peças)
- `GET /conteudo/pecas` — `listarPecas` (`dados-conteudo.js:80`, `?account_id=`), `carregarPeca` (`:88`, `?id=`), e os três "por lista de ids" (`miniaturasDasPecas :109`, `metricasDasPecas :127`, `sugestoesDeCasamento :145`) viram os EMBUTIDOS `capa`, `metrica`, `sugestao` de cada peça (Ruling 5.9-3). Colunas = `CAMPOS_PECA` (`:20-23`). Filtros `account_id`, `id`, `status` (lista). Ordem `publicar_em` (padrão, nulos por último como o `nullsFirst: false` da tela) ou `created_at`.
- `GET /conteudo/arquivos` — `listarArquivos` (`:95`, `?peca_id=`). `join` na peça com o marcador dela: arquivo de peça invisível não aparece; projeta e filtra `account_id` da peça.
- `GET /conteudo/eventos` — `listarEventos` (`:167`, `?peca_id=`), ordem `quando desc`; idem.
- `GET /conteudo/ideias` — `listarIdeias` (`:282`: `?da_marca=<conta>&descartada=false`). Filtros `account_id` (exato), `da_marca` (a conta OU de todas), `situacao` (lista), `descartada`. Todas as colunas (as escritas devolvem `*`).
- `GET /conteudo/blocos` — `listarBlocos` (`:436`: `?da_marca=<conta>&ativo=true`). Ordem `tipo`.
- `GET /conteudo/concorrentes` — `listarConcorrentes` (`:467`: `?account_id=<conta>&ativo=true`). SEM a restritiva em produção: paridade (Ruling 5.9-5).
- `GET /conteudo/jobs` — `verJob` (`:427`, `?id=`). Sem `criado_por` nem `github_run_id`.
- **Ensaiado** (worktree sobre o 5.7 + Tasks 1–3): as 7 declarações passam na gramática do 5.0 (inclusive as subconsultas com `order by … limit 1` e o `join … and {ler:…}`) e `TestLeituras` passa inteiro; tirar o marcador do `join` de arquivos faz `TestLeiturasDeclaradas` reprovar ("conteudo_pecas pc é lida sem {ler:…}").

```go
package conteudo

import (
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/autz"
	"github.com/rbv-co/social-dashboard/api/internal/dados"
)

// filtroConta: account_id das conteudo_* é UUID (a restritiva é pode_ver_conta((account_id)::text)). Toda
// leitura com a restritiva declara este filtro e projeta account_id: é por ele que a varredura da Task 9
// acha vazamento.
var filtroConta = dados.Filtro{Param: "account_id", SQL: "t.account_id = @account_id::uuid", Tipo: "uuid"}

// filtroDaMarca: "desta marca OU de todas" (account_id nulo), o `.or(account_id.eq.X,account_id.is.null)` de
// listarIdeias/listarBlocos (dados-conteudo.js:291, 438).
var filtroDaMarca = dados.Filtro{Param: "da_marca", SQL: "(t.account_id = @da_marca::uuid or t.account_id is null)", Tipo: "uuid"}

var filtroAtivo = dados.Filtro{Param: "ativo", SQL: "t.ativo = @ativo::boolean", Tipo: "booleano"}

// colunasPeca: o CAMPOS_PECA de dados-conteudo.js:20-23, na mesma ordem.
const colunasPeca = `t.id, t.account_id, t.titulo, t.formato, t.status, t.legenda, t.hashtags, t.observacoes,
  t.publicar_em, t.publicado_em, t.avisado_em, t.ig_media_id, t.ig_permalink, t.responsavel, t.criado_por,
  t.aprovado_por, t.aprovado_em, t.motivo_reprovacao, t.created_at, t.updated_at`

// consultaPecas: GET /conteudo/pecas. Traz EMBUTIDOS, cada um com a regra de Ler da sua tabela, o que a tela
// buscava em três consultas por lista de ids (dados-conteudo.js:106-155): `capa` (o arquivo de ordem 1 se for
// imagem), `metrica` (a leitura mais recente) e `sugestao` (o casamento sugerido de maior pontuação). Some a
// lista de ids na URL (uma conta com centenas de peças estouraria o limite de ~150 uuids do mestre, IV.1).
// Ruling 5.9-3.
var consultaPecas = dados.Consulta{Tabela: "conteudo_pecas", Alias: "t",
	SQL: `select ` + colunasPeca + `,
	  (select jsonb_build_object('caminho', a.caminho, 'tipo', a.tipo) from conteudo_arquivos a
	    where a.peca_id = t.id and a.ordem = 1 and a.tipo = 'imagem' and {ler:conteudo_arquivos:a}) as capa,
	  (select jsonb_build_object('peca_id', m.peca_id, 'capturado_em', m.capturado_em, 'curtidas', m.curtidas,
	      'comentarios', m.comentarios, 'alcance', m.alcance, 'salvamentos', m.salvamentos,
	      'compartilhamentos', m.compartilhamentos, 'visualizacoes', m.visualizacoes)
	    from conteudo_metricas m where m.peca_id = t.id and {ler:conteudo_metricas:m}
	    order by m.capturado_em desc limit 1) as metrica,
	  (select jsonb_build_object('id', c.id, 'peca_id', c.peca_id, 'ig_media_id', c.ig_media_id,
	      'ig_permalink', c.ig_permalink, 'ig_timestamp', c.ig_timestamp, 'ig_caption', c.ig_caption,
	      'ig_thumb', c.ig_thumb, 'pontuacao', c.pontuacao, 'motivo', c.motivo)
	    from conteudo_casamentos c where c.peca_id = t.id and c.situacao = 'sugerido' and {ler:conteudo_casamentos:c}
	    order by c.pontuacao desc, c.id limit 1) as sugestao
	  from conteudo_pecas t`,
	Filtros: []dados.Filtro{filtroConta,
		{Param: "id", SQL: "t.id = @id::uuid", Tipo: "uuid"},
		{Param: "status", SQL: "t.status = any(@status::text[])", Tipo: "texto[]"},
	},
	Ordens:      map[string]string{"publicar_em": "t.publicar_em", "created_at": "t.created_at"},
	OrdemPadrao: "t.publicar_em", Desempate: "t.id"} // asc: nulos por último, o `nullsFirst: false` da tela

// As filhas da peça: só com a peça VISÍVEL (o join leva a regra de Ler de conteudo_pecas, com a restritiva),
// e com account_id da peça projetado e filtrável (a tela manda a conta, nunca a lista de peças). Em produção as
// filhas não tinham a restritiva: quem só via A1 lia arquivos e trilha de A2 (Ruling 5.9-3, achado 1).
const colunasArquivo = `t.id, t.peca_id, t.ordem, t.bucket, t.caminho, t.tipo, t.mime, t.bytes`

var consultaArquivos = dados.Consulta{Tabela: "conteudo_arquivos", Alias: "t",
	SQL: `select ` + colunasArquivo + `, pc.account_id from conteudo_arquivos t
	  join conteudo_pecas pc on pc.id = t.peca_id and {ler:conteudo_pecas:pc}`,
	Filtros: []dados.Filtro{
		{Param: "peca_id", SQL: "t.peca_id = @peca_id::uuid", Tipo: "uuid"},
		{Param: "account_id", SQL: "pc.account_id = @account_id::uuid", Tipo: "uuid"},
	},
	OrdemPadrao: "t.ordem", Desempate: "t.id"}

const colunasEvento = `t.id, t.peca_id, t.de, t.para, t.acao, t.detalhe, t.quem, t.quando`

var consultaEventos = dados.Consulta{Tabela: "conteudo_eventos", Alias: "t",
	SQL: `select ` + colunasEvento + `, pc.account_id from conteudo_eventos t
	  join conteudo_pecas pc on pc.id = t.peca_id and {ler:conteudo_pecas:pc}`,
	Filtros: []dados.Filtro{
		{Param: "peca_id", SQL: "t.peca_id = @peca_id::uuid", Tipo: "uuid"},
		{Param: "account_id", SQL: "pc.account_id = @account_id::uuid", Tipo: "uuid"},
	},
	OrdemPadrao: "t.quando desc", Desempate: "t.id"}

// colunasIdeia: TODAS (criarIdeia/atualizarIdeia faziam `.select('*')`; listarIdeias, um subconjunto).
const colunasIdeia = `t.id, t.account_id, t.titulo, t.gancho, t.formato, t.pilar, t.roteiro, t.producao, t.porque_formato,
  t.cta, t.legenda_sugerida, t.hashtags_sugeridas, t.por_que_agora, t.referencia, t.origem, t.modelo, t.job_id,
  t.situacao, t.peca_id, t.criado_por, t.created_at`

var consultaIdeias = dados.Consulta{Tabela: "conteudo_ideias", Alias: "t",
	SQL: `select ` + colunasIdeia + ` from conteudo_ideias t`,
	Filtros: []dados.Filtro{filtroConta, filtroDaMarca,
		{Param: "situacao", SQL: "t.situacao = any(@situacao::text[])", Tipo: "texto[]"},
		{Param: "descartada", SQL: "(t.situacao = 'descartada') = @descartada::boolean", Tipo: "booleano"},
	},
	OrdemPadrao: "t.created_at desc", Desempate: "t.id"}

const colunasBloco = `t.id, t.account_id, t.tipo, t.nome, t.texto, t.usos, t.ativo, t.criado_por, t.created_at`

var consultaBlocos = dados.Consulta{Tabela: "conteudo_blocos", Alias: "t",
	SQL:         `select ` + colunasBloco + ` from conteudo_blocos t`,
	Filtros:     []dados.Filtro{filtroConta, filtroDaMarca, filtroAtivo},
	OrdemPadrao: "t.tipo", Desempate: "t.id"}

// consultaConcorrentes: SEM a restritiva em produção (conteudo_concorrentes não está na lista de
// 2026-07-31-allowed-accounts-no-banco.sql): todo conteudista lê os de toda marca, como hoje (Ruling 5.9-5).
const colunasConcorrente = `t.id, t.account_id, t.handle, t.nome, t.observacao, t.ativo, t.created_at`

var consultaConcorrentes = dados.Consulta{Tabela: "conteudo_concorrentes", Alias: "t",
	SQL:         `select ` + colunasConcorrente + ` from conteudo_concorrentes t`,
	Filtros:     []dados.Filtro{filtroConta, filtroAtivo},
	OrdemPadrao: "t.nome", Desempate: "t.id"}

// consultaJobs: o que verJob (dados-conteudo.js:427) lê, mais tipo/conta/datas. Sem criado_por nem
// github_run_id (nenhuma tela os lê).
var consultaJobs = dados.Consulta{Tabela: "conteudo_jobs", Alias: "t",
	SQL: `select t.id, t.tipo, t.account_id, t.params, t.status, t.resultado, t.erro, t.created_at, t.updated_at
	  from conteudo_jobs t`,
	Filtros: []dados.Filtro{filtroConta,
		{Param: "id", SQL: "t.id = @id::uuid", Tipo: "uuid"},
		{Param: "status", SQL: "t.status = any(@status::text[])", Tipo: "texto[]"},
	},
	OrdemPadrao: "t.created_at desc", Desempate: "t.id"}

func montarLeituras(r chi.Router, p *pgxpool.Pool) {
	r.Get("/conteudo/pecas", consultaPecas.Handler(p, autz.Producao))
	r.Get("/conteudo/arquivos", consultaArquivos.Handler(p, autz.Producao))
	r.Get("/conteudo/eventos", consultaEventos.Handler(p, autz.Producao))
	r.Get("/conteudo/ideias", consultaIdeias.Handler(p, autz.Producao))
	r.Get("/conteudo/blocos", consultaBlocos.Handler(p, autz.Producao))
	r.Get("/conteudo/concorrentes", consultaConcorrentes.Handler(p, autz.Producao))
	r.Get("/conteudo/jobs", consultaJobs.Handler(p, autz.Producao))
}
```

**(b) Testes de aceitação** (`leituras_test.go`, código abaixo)
- `TestLeiturasDeclaradas`: as 7 passam em `Validar(autz.Producao)`.
- `TestLeituras`: peças — `conteudista` vê as 7 na ordem `publicar_em` (nulos por último), `conteudistaA1` e `impersonado` só as 5 de A1, `adminA1` com `?account_id=<A2>` vê P5 e P3, `conteudistaA1` com o filtro de A2 → `[]`, `conteudistaNenhuma`/`soAprovar`/`semModulo` → `[]`, `?id=`, `?status=…&ordem=created_at.desc`; os embutidos (capa da P1; P2 com os três nulos; a métrica MAIS RECENTE da P6; a sugestão de MAIOR pontuação da P4); `contar=1` → `X-Total-Count: 5` para `conteudistaA1`; 400 para filtro desconhecido, uuid inválido e ordem fora da lista; 401 sem sessão e para o desativado. Filhas — arquivos da P1 em ordem, `?account_id=<A2>` só AR3 para quem vê A2, `conteudistaA1` sem filtro só os da P1 e com `?peca_id=<P3>` → `[]`; eventos da P3 → `[]` para `conteudistaA1`. Ideias e blocos por `da_marca` (a marca + as de todas), ideias de A2 com `da_marca=<A2>` → só a geral para `conteudistaA1`. Concorrentes: `conteudistaA1` LÊ os de A2 (paridade). Jobs pela restritiva; o J1 com o `resultado` e sem `criado_por`.
- Mutações que têm de reprovar: tirar o `{ler:conteudo_pecas:pc}` do `join` (a montagem recusa); trocar o `join` por `left join` mantendo o marcador (a gramática ACEITA, e `conteudistaA1` passa a ver AR3 com a conta nula: o caso `?peca_id=<P3>` reprova — ensaiado; é por isso que o `join` das filhas é interno); tirar o `order by … desc` da métrica (a P6 mostra 10); `filtroDaMarca` sem o `or … is null` (a ideia geral some).

```go
package conteudo

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/rbv-co/social-dashboard/api/internal/autz"
	"github.com/rbv-co/social-dashboard/api/internal/testebanco/mundoteste"
)

// As 7 declarações passam na gramática do 5.0 (sem banco): a API não sobe com uma leitura inválida.
func TestLeiturasDeclaradas(t *testing.T) {
	for nome, c := range map[string]interface{ Validar(*autz.Catalogo) error }{
		"pecas": consultaPecas, "arquivos": consultaArquivos, "eventos": consultaEventos, "ideias": consultaIdeias,
		"blocos": consultaBlocos, "concorrentes": consultaConcorrentes, "jobs": consultaJobs,
	} {
		if err := c.Validar(autz.Producao); err != nil {
			t.Errorf("%s: %v", nome, err)
		}
	}
}

func TestLeituras(t *testing.T) {
	m := novoMundo(t, montarLeituras)
	ids := func(corpo string) string {
		var l []struct{ ID json.RawMessage }
		if err := json.Unmarshal([]byte(corpo), &l); err != nil {
			t.Fatalf("%v: %s", err, corpo)
		}
		var s []string
		for _, x := range l {
			s = append(s, strings.Trim(string(x.ID), `"`))
		}
		return strings.Join(s, ",")
	}
	lista := func(quem, caminho, quer string) {
		t.Helper()
		st, b := m.Pedir(t, quem, "GET", caminho, "")
		if st != 200 || ids(b) != quer {
			t.Errorf("%s GET %s = %d %s\n  esperava ids %s", quem, caminho, st, b, quer)
		}
	}
	// peças: a restritiva, a ordem (publicar_em asc, nulos por último) e os filtros
	lista("conteudista", "/conteudo/pecas", strings.Join([]string{P5, P6, P4, P2, P3, P1, P7}, ","))
	lista("conteudistaA1", "/conteudo/pecas", strings.Join([]string{P6, P4, P2, P1, P7}, ","))
	lista("impersonado", "/conteudo/pecas", strings.Join([]string{P6, P4, P2, P1, P7}, ","))
	lista("adminA1", "/conteudo/pecas?account_id="+A2, P5+","+P3)
	lista("conteudistaA1", "/conteudo/pecas?account_id="+A2, "")
	lista("conteudistaNenhuma", "/conteudo/pecas", "")
	lista("soAprovar", "/conteudo/pecas", "")
	lista("semModulo", "/conteudo/pecas", "")
	lista("conteudista", "/conteudo/pecas?id="+P1, P1)
	lista("conteudista", "/conteudo/pecas?status=em_aprovacao,agendada&ordem=created_at.desc", strings.Join([]string{P7, P4, P3, P2}, ","))
	// os embutidos: capa (ordem 1 imagem), a métrica MAIS RECENTE, a sugestão de MAIOR pontuação
	m.Rodar(t, []mundoteste.Caso{
		{Nome: "capa da P1", Quem: "conteudista", Metodo: "GET", Caminho: "/conteudo/pecas?id=" + P1, Status: 200,
			Tem: `"capa":{"tipo": "imagem", "caminho": "` + A1 + `/` + P1 + `/1-capa.png"}`},
		{Nome: "sem capa nem métrica", Quem: "conteudista", Metodo: "GET", Caminho: "/conteudo/pecas?id=" + P2, Status: 200,
			Tem: `"capa":null,"metrica":null,"sugestao":null`},
		{Nome: "métrica mais recente da P6", Quem: "conteudista", Metodo: "GET", Caminho: "/conteudo/pecas?id=" + P6, Status: 200,
			Tem: `"curtidas": 20`, NaoTem: `"curtidas": 10`},
		{Nome: "sugestão de maior pontuação da P4", Quem: "conteudista", Metodo: "GET", Caminho: "/conteudo/pecas?id=" + P4, Status: 200,
			Tem: `"id": "` + CS1 + `"`, NaoTem: CS2},
		{Nome: "contar", Quem: "conteudistaA1", Metodo: "GET", Caminho: "/conteudo/pecas?limite=1&contar=1", Status: 200, Tem: P6},
		{Nome: "filtro desconhecido", Quem: "conteudista", Metodo: "GET", Caminho: "/conteudo/pecas?criado_por=" + idConteudista, Status: 400},
		{Nome: "uuid inválido", Quem: "conteudista", Metodo: "GET", Caminho: "/conteudo/pecas?id=xyz", Status: 400},
		{Nome: "ordem fora da lista", Quem: "conteudista", Metodo: "GET", Caminho: "/conteudo/pecas?ordem=titulo", Status: 400},
		{Nome: "sem sessão", Quem: "", Metodo: "GET", Caminho: "/conteudo/pecas", Status: 401},
		{Nome: "desativado", Quem: "desativado", Metodo: "GET", Caminho: "/conteudo/pecas", Status: 401},
	})
	if w := m.Resposta(t, "conteudistaA1", "GET", "/conteudo/pecas?limite=1&contar=1", ""); w.Header().Get("X-Total-Count") != "5" {
		t.Errorf("X-Total-Count = %q, esperava 5", w.Header().Get("X-Total-Count"))
	}
	// filhas: presas à peça visível
	lista("conteudista", "/conteudo/arquivos?peca_id="+P1, AR1+","+AR2)
	lista("conteudista", "/conteudo/arquivos?account_id="+A2, AR3)
	lista("conteudistaA1", "/conteudo/arquivos", AR1+","+AR2)
	lista("conteudistaA1", "/conteudo/arquivos?peca_id="+P3, "")
	lista("conteudistaA1", "/conteudo/eventos?peca_id="+P3, "")
	if st, b := m.Pedir(t, "conteudista", "GET", "/conteudo/eventos?peca_id="+P1, ""); st != 200 || !strings.Contains(b, `"acao":"criou"`) || !strings.Contains(b, `"account_id":"`+A1+`"`) {
		t.Errorf("eventos da P1: %d %s", st, b)
	}
	// ideias e blocos: "desta marca ou de todas"
	lista("conteudista", "/conteudo/ideias?da_marca="+A1+"&descartada=false", strings.Join([]string{I5, I2, I1}, ","))
	lista("conteudistaA1", "/conteudo/ideias", strings.Join([]string{I5, I4, I2, I1}, ","))
	lista("conteudistaA1", "/conteudo/ideias?da_marca="+A2, I2)
	lista("conteudista", "/conteudo/ideias?situacao=favorita", I3)
	lista("conteudista", "/conteudo/blocos?da_marca="+A1+"&ativo=true", B2+","+B1) // ordem: tipo
	lista("conteudistaA1", "/conteudo/blocos", B4+","+B2+","+B1)
	// concorrentes: SEM a restritiva (Ruling 5.9-5) — quem só vê A1 lê os de A2, como hoje
	lista("conteudistaA1", "/conteudo/concorrentes?account_id="+A2+"&ativo=true", K2)
	lista("semModulo", "/conteudo/concorrentes", "")
	// jobs: a restritiva
	lista("conteudista", "/conteudo/jobs", J2+","+J1)
	lista("conteudistaA1", "/conteudo/jobs", J1)
	lista("conteudistaA1", "/conteudo/jobs?id="+J2, "")
	if st, b := m.Pedir(t, "conteudista", "GET", "/conteudo/jobs?id="+J1, ""); st != 200 || !strings.Contains(b, `"resultado":{"gravadas": 12}`) || strings.Contains(b, "criado_por") {
		t.Errorf("job J1: %d %s", st, b)
	}
}
```

**(c) Arquivos:** Create `api/internal/conteudo/leituras.go`, `api/internal/conteudo/leituras_test.go`.

**(d) Dependências:** Task 3; `dados.Consulta`.

- [ ] **Step 1:** Testes; ver falhar. - [ ] **Step 2:** Implementar (código de (a)). Se `Validar` recusar alguma declaração que o ensaio aceitou (a gramática mudou depois do 5.7): **pare e reporte** — não troque por filtro no Go. - [ ] **Step 3:** `cd api && gofmt -l ./internal && go vet ./internal/conteudo/ && go test -count=1 ./internal/conteudo/` PASS; mutações reprovam. - [ ] **Step 4:** Commit `feat(api): leituras da Central de Conteúdo pelo catálogo (capa, métrica e sugestão embutidas; filhas presas à peça)` (+ `Co-Authored-By`).

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
