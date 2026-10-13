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

### Task 5: Escritas de peça, arquivo e evento

**Revisor:** opus. **Depende de:** 2 (`Tabela.Conferir`), 3 (`pecaVisivel`, `soLegivelAoCriar`, validadores), 4 (`colunasPeca`, `colunasArquivo`, `colunasEvento`: em worktrees paralelas, copie as três constantes e apague a cópia no merge).

**(a) Contrato** (catálogo em toda escrita, pelo `dados.Tabela` do 5.1 + o gancho da Task 2; `soSessaoPropria` em todas)
- `POST /conteudo/pecas` (`criarPeca`, `dados-conteudo.js:188`) com `corpoPecaNova`: `account_id`, `titulo`, `formato` obrigatórios; `legenda`, `hashtags`, `observacoes`, `responsavel`, `publicar_em`, `avisado_em` (só `null`). **Sem `status`** (nasce `rascunho`), sem `publicado_em`, sem os campos de aprovação nem os do Instagram (Ruling 5.9-6). `criado_por` da sessão. A peça nova tem de ser legível por quem cria (`soLegivelAoCriar`: a conta) → senão 403. Resposta `201` com a linha (`colunasPeca`).
- `PATCH /conteudo/pecas/{id}` (`atualizarPeca :199`, `mudarStatus :234`) com `corpoPeca`: as de cima + `status` (a guarda `conteudo_guarda_aprovacao` decide, com a identidade de `banco.ComUsuario`: sem `conteudo.aprovar` → `400 regra_de_negocio` "Sem permissao para aprovar pecas de conteudo.", como o PostgREST respondia) e `publicado_em`. `PodeEditar` aplica a restritiva na linha velha (404) e na nova (mover para conta invisível = 403).
- `DELETE /conteudo/pecas/{id}` (`excluirPeca :521`): `PodeApagar` (com a restritiva) e a cascata do banco (arquivos, eventos, métricas, casamentos; ideia ligada fica com `peca_id` nulo). Os objetos do bucket são do Plano 6 (hoje a tela os apaga antes, `:519`).
- `POST /conteudo/arquivos` (`subirArquivo :551`, `duplicarPeca :607`) com `corpoArquivo`; `PATCH /conteudo/arquivos/{id}` (`trocarOrdem :639`) só com `ordem` (-1 a 1000: o -1 é o valor livre da troca em três passos); `DELETE /conteudo/arquivos/{id}` (`removerArquivo :634`). `conferirArquivo`: peça legível (criar: invisível ou inexistente = 403; editar/apagar: invisível = 404) e, na criação, `caminho` dentro de `<conta da peça>/<peça>/` (403 fora: Ruling 5.9-8). `bucket` só `conteudo`.
- `POST /conteudo/eventos` (`registrarEvento :180`) com `corpoEvento`: `quem` da sessão (a policy exige `quem = auth.uid()`), `acao` só `criou|mudou_status|remarcou|duplicou` (Ruling 5.9-7), `de`/`para` estados ou nulo, peça legível (403).
- **Ensaiado** (worktree sobre o 5.7 + Tasks 1–4): os três testes abaixo passam; tirar o `Conferir` de `tabelaArquivos` faz 12 casos reprovarem; tirar o `soLegivelAoCriar` de `tabelaPecas` faz "criar em conta que não vê" responder `201 {"id"}` e gravar.

```go
package conteudo

import (
	"context"
	"encoding/json"
	"errors"
	"regexp"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/autz"
	"github.com/rbv-co/social-dashboard/api/internal/dados"
)

// corpoPeca: o que atualizarPeca/mudarStatus gravam (dados-conteudo.js:197-237; camposDoBanco de
// painel-peca.vue:535-562; tela-de-conteudo.vue:433; tela-de-peca.vue:249). Os campos de aprovação
// (aprovado_por/_em, motivo_reprovacao) e do Instagram (ig_*) ficam FORA: só as funções os gravam. status
// entra: a guarda conteudo_guarda_aprovacao decide quem aprova (com a identidade de banco.ComUsuario).
// avisado_em só nulo: quem o marca é o robô da hora H (Ruling 5.9-6).
type corpoPeca struct {
	AccountID   json.RawMessage `json:"account_id,omitempty"`
	Titulo      json.RawMessage `json:"titulo,omitempty"`
	Formato     json.RawMessage `json:"formato,omitempty"`
	Status      json.RawMessage `json:"status,omitempty"`
	Legenda     json.RawMessage `json:"legenda,omitempty"`
	Hashtags    json.RawMessage `json:"hashtags,omitempty"`
	Observacoes json.RawMessage `json:"observacoes,omitempty"`
	Responsavel json.RawMessage `json:"responsavel,omitempty"`
	PublicarEm  json.RawMessage `json:"publicar_em,omitempty"`
	PublicadoEm json.RawMessage `json:"publicado_em,omitempty"`
	AvisadoEm   json.RawMessage `json:"avisado_em,omitempty"`
}

func (c corpoPeca) Validar() error {
	var e []error
	ok := func(v json.RawMessage, valido bool, frase string) {
		if v != nil && !valido {
			e = append(e, errors.New(frase))
		}
	}
	ok(c.AccountID, casa(c.AccountID, reUUID), "account_id é o id da conta.")
	ok(c.Titulo, textoAte(c.Titulo, 300, false), "titulo tem de 1 a 300 caracteres.")
	ok(c.Formato, textoEm(c.Formato, formatosDaPeca...), "formato é feed, reels, stories ou carrossel.")
	ok(c.Status, textoEm(c.Status, estadosDaPeca...), "status é um dos estados da peça.")
	ok(c.Legenda, textoAte(c.Legenda, 20000, true), "legenda tem até 20000 caracteres.")
	ok(c.Hashtags, textoAte(c.Hashtags, 5000, true), "hashtags têm até 5000 caracteres.")
	ok(c.Observacoes, textoOuNulo(c.Observacoes, 20000), "observacoes têm até 20000 caracteres.")
	ok(c.Responsavel, uuidOuNulo(c.Responsavel), "responsavel é o id de uma pessoa ou null.")
	ok(c.PublicarEm, instanteOuNulo(c.PublicarEm), "publicar_em é um instante ISO 8601 ou null.")
	ok(c.PublicadoEm, instanteOuNulo(c.PublicadoEm), "publicado_em é um instante ISO 8601 ou null.")
	ok(c.AvisadoEm, nulo(c.AvisadoEm), "avisado_em só pode ser limpo (null): quem marca o aviso é o robô da hora H.")
	return errors.Join(e...)
}

// corpoPecaNova: o que criarPeca recebe (camposDoBanco, planoViraPecas :393, duplicarPeca :581). SEM status
// nem publicado_em: a peça nasce rascunho. O gatilho da aprovação é BEFORE UPDATE — um INSERT já 'agendada'
// pulava a aprovação em produção (Ruling 5.9-6, achado 2). criado_por vem da sessão (Tabela.Autor).
type corpoPecaNova struct {
	AccountID   json.RawMessage `json:"account_id,omitempty"`
	Titulo      json.RawMessage `json:"titulo,omitempty"`
	Formato     json.RawMessage `json:"formato,omitempty"`
	Legenda     json.RawMessage `json:"legenda,omitempty"`
	Hashtags    json.RawMessage `json:"hashtags,omitempty"`
	Observacoes json.RawMessage `json:"observacoes,omitempty"`
	Responsavel json.RawMessage `json:"responsavel,omitempty"`
	PublicarEm  json.RawMessage `json:"publicar_em,omitempty"`
	AvisadoEm   json.RawMessage `json:"avisado_em,omitempty"`
}

func (c corpoPecaNova) Validar() error {
	var falta error
	if c.AccountID == nil || c.Titulo == nil || c.Formato == nil {
		falta = errors.New("Informe account_id, titulo e formato.")
	}
	return errors.Join(falta, corpoPeca{AccountID: c.AccountID, Titulo: c.Titulo, Formato: c.Formato, Legenda: c.Legenda,
		Hashtags: c.Hashtags, Observacoes: c.Observacoes, Responsavel: c.Responsavel, PublicarEm: c.PublicarEm,
		AvisadoEm: c.AvisadoEm}.Validar())
}

// tabelaPecas: catálogo (conteudo_pecas_escrita + a restritiva pela regra de Ler no PodeEditar/PodeApagar) e,
// na criação, a peça nova tem de ser legível (a conta dela, Ruling 5.9-4).
var tabelaPecas = dados.Tabela{Nome: "conteudo_pecas", Resposta: colunasPeca, Autor: "criado_por",
	Conferir: soLegivelAoCriar("conteudo_pecas")}

// reCaminho: <conta>/<peça>/<nome> como subirArquivo monta (dados-conteudo.js:543: `${account}/${peca}/${ordem}-${slug}.${ext}`).
var reCaminho = regexp.MustCompile(`^[0-9a-f-]{36}/[0-9a-f-]{36}/[A-Za-z0-9][A-Za-z0-9._-]{0,159}$`)

// corpoArquivo: o insert de subirArquivo (:551) e de duplicarPeca (:607). bucket só 'conteudo' (o único da
// Central; o Storage é do Plano 6); largura/altura/duracao_s ninguém grava.
type corpoArquivo struct {
	PecaID  json.RawMessage `json:"peca_id,omitempty"`
	Ordem   json.RawMessage `json:"ordem,omitempty"`
	Bucket  json.RawMessage `json:"bucket,omitempty"`
	Caminho json.RawMessage `json:"caminho,omitempty"`
	Tipo    json.RawMessage `json:"tipo,omitempty"`
	Mime    json.RawMessage `json:"mime,omitempty"`
	Bytes   json.RawMessage `json:"bytes,omitempty"`
}

func (c corpoArquivo) Validar() error {
	var e []error
	caminho, _ := comoTexto(c.Caminho)
	if !casa(c.PecaID, reUUID) {
		e = append(e, errors.New("peca_id é o id da peça."))
	}
	if !reCaminho.MatchString(caminho) || strings.Contains(caminho, "..") {
		e = append(e, errors.New("caminho é <conta>/<peça>/<nome do arquivo>."))
	}
	if !textoEm(c.Tipo, "imagem", "video") {
		e = append(e, errors.New("tipo é imagem ou video."))
	}
	if c.Ordem != nil && !inteiroEntre(c.Ordem, 1, 1000) {
		e = append(e, errors.New("ordem é um número de 1 a 1000."))
	}
	if c.Bucket != nil && !textoEm(c.Bucket, "conteudo") {
		e = append(e, errors.New("bucket é conteudo."))
	}
	if c.Mime != nil && !textoOuNulo(c.Mime, 100) {
		e = append(e, errors.New("mime tem até 100 caracteres."))
	}
	if c.Bytes != nil && !nulo(c.Bytes) && !inteiroEntre(c.Bytes, 0, 1<<40) {
		e = append(e, errors.New("bytes é um número inteiro."))
	}
	return errors.Join(e...)
}

// corpoOrdem: trocarOrdem (:639). -1 é o valor livre da troca em três passos (painel-peca.vue:737-739: o
// unique (peca_id, ordem) impede a troca direta).
type corpoOrdem struct {
	Ordem json.RawMessage `json:"ordem,omitempty"`
}

func (c corpoOrdem) Validar() error {
	if !inteiroEntre(c.Ordem, -1, 1000) {
		return errors.New("ordem é um número de -1 a 1000.")
	}
	return nil
}

// conferirArquivo: a peça do arquivo tem de ser uma que quem pede LÊ (a restritiva de conteudo_pecas; a tabela
// de arquivos não tem conta: Ruling 5.9-4). Na criação, a peça do corpo — invisível ou inexistente = 403 — e o
// caminho preso a <conta da peça>/<peça>/ (403 fora dele: o apagar do Storage levaria o objeto de outra peça,
// Ruling 5.9-8). Na edição e no apagar, a peça da linha — invisível = 404, como a própria linha.
func conferirArquivo(ctx context.Context, tx pgx.Tx, e *autz.Escopo, id string, campos map[string]any) error {
	if id == "" {
		peca, _ := comoTexto(bruto(campos, "peca_id"))
		conta, err := pecaVisivel(ctx, tx, e, peca)
		if err != nil {
			return negado(err)
		}
		if caminho, _ := comoTexto(bruto(campos, "caminho")); !strings.HasPrefix(caminho, conta+"/"+peca+"/") {
			return autz.ErrNegado
		}
		return nil
	}
	var peca string
	// a linha existe e quem pede a lê: o PodeEditar/PodeApagar acabou de conferi-la
	if err := tx.QueryRow(ctx, `select peca_id::text from conteudo_arquivos where id = $1::uuid`, id).Scan(&peca); err != nil {
		return err
	}
	_, err := pecaVisivel(ctx, tx, e, peca)
	return err
}

var tabelaArquivos = dados.Tabela{Nome: "conteudo_arquivos", Resposta: colunasArquivo, Conferir: conferirArquivo}

// acoesDaTela: as ações que registrarEvento grava (dados-conteudo.js:193, 235, 624; tela-de-conteudo.vue:435).
// 'aprovou', 'reprovou', 'casou', 'casou_na_mao', 'recusou_casamento', 'reavisar' e o 'criou' da ideia só as
// funções gravam: um evento forjado mentiria na trilha de quem aprovou (Ruling 5.9-7).
var acoesDaTela = []string{"criou", "mudou_status", "remarcou", "duplicou"}

// corpoEvento: registrarEvento (:180). quem vem da sessão (Tabela.Autor: a policy exige quem = auth.uid()).
type corpoEvento struct {
	PecaID  json.RawMessage `json:"peca_id,omitempty"`
	De      json.RawMessage `json:"de,omitempty"`
	Para    json.RawMessage `json:"para,omitempty"`
	Acao    json.RawMessage `json:"acao,omitempty"`
	Detalhe json.RawMessage `json:"detalhe,omitempty"`
}

func (c corpoEvento) Validar() error {
	var e []error
	estado := func(v json.RawMessage) bool { return v == nil || nulo(v) || textoEm(v, estadosDaPeca...) }
	if !casa(c.PecaID, reUUID) {
		e = append(e, errors.New("peca_id é o id da peça."))
	}
	if !textoEm(c.Acao, acoesDaTela...) {
		e = append(e, errors.New("acao é criou, mudou_status, remarcou ou duplicou."))
	}
	if !estado(c.De) || !estado(c.Para) {
		e = append(e, errors.New("de e para são estados da peça ou null."))
	}
	if c.Detalhe != nil && !textoOuNulo(c.Detalhe, 1000) {
		e = append(e, errors.New("detalhe tem até 1000 caracteres."))
	}
	return errors.Join(e...)
}

// tabelaEventos: catálogo (conteudo_eventos_insercao: conteudista e quem = auth.uid()) e a peça do evento
// legível por quem grava (a tabela de eventos não tem conta).
var tabelaEventos = dados.Tabela{Nome: "conteudo_eventos", Resposta: colunasEvento, Autor: "quem",
	Conferir: func(ctx context.Context, tx pgx.Tx, e *autz.Escopo, _ string, campos map[string]any) error {
		peca, _ := comoTexto(bruto(campos, "peca_id"))
		_, err := pecaVisivel(ctx, tx, e, peca)
		return negado(err)
	}}

func montarPecas(r chi.Router, p *pgxpool.Pool) {
	r.With(soSessaoPropria).Post("/conteudo/pecas", dados.RotaCriar[corpoPecaNova](p, autz.Producao, tabelaPecas))
	r.With(soSessaoPropria).Patch("/conteudo/pecas/{id}", dados.RotaEditar[corpoPeca](p, autz.Producao, tabelaPecas))
	r.With(soSessaoPropria).Delete("/conteudo/pecas/{id}", dados.RotaApagar(p, autz.Producao, tabelaPecas))
	r.With(soSessaoPropria).Post("/conteudo/arquivos", dados.RotaCriar[corpoArquivo](p, autz.Producao, tabelaArquivos))
	r.With(soSessaoPropria).Patch("/conteudo/arquivos/{id}", dados.RotaEditar[corpoOrdem](p, autz.Producao, tabelaArquivos))
	r.With(soSessaoPropria).Delete("/conteudo/arquivos/{id}", dados.RotaApagar(p, autz.Producao, tabelaArquivos))
	r.With(soSessaoPropria).Post("/conteudo/eventos", dados.RotaCriar[corpoEvento](p, autz.Producao, tabelaEventos))
}
```

**(b) Testes de aceitação** (`pecas_test.go`, código abaixo; "intacto" = a foto das 9 tabelas igual depois de CADA caso negado)
- `TestPecas`: negados e intactos — criar em conta invisível (403), criar já `agendada` (400 `corpo_invalido`), com `aprovado_por` ou `criado_por` (400), sem título (400 com a frase), marcando o aviso (400), formato fora da lista (400), `soAprovar` e `semModulo` (403); o editor aprovando ou agendando pelo PATCH (400 com a frase da guarda; P2 continua `em_aprovacao`), editar peça de A2 sem vê-la (404), mover para A2 (403), marcar o aviso (400), gravar `ig_media_id` (400), agendar sem data (400 do check), impersonado (403 com a frase), apagar peça de A2 (404). Permitidos com o efeito — criar (`rascunho`, `criado_por` da sessão, aviso nulo), editar e mandar para aprovação, remarcar limpando o aviso, o aprovador aprovando pelo PATCH (a guarda deixa), admin editando a de A2, apagar levando as filhas.
- `TestFilhasSoComAPecaVisivel`: arquivo e evento em peça de A2 e em peça inexistente → 403 IGUAL; reordenar/apagar arquivo de peça de A2 → 404; evento forjando `aprovou` → 400; evento com `quem` no corpo → 400; estado fora da lista → 400; `soAprovar` → 403; o evento permitido sai assinado pela sessão; admin grava na peça de A2.
- `TestArquivos`: caminho de outra peça (de A2 ou da mesma conta) → 403; com `..` ou absoluto → 400; outro bucket → 400; ordem repetida → 409; PATCH com `caminho` → 400; ordem -2 → 400; a troca em três passos de `painel-peca.vue:737-739` termina `2,1,3`; apagar.
- Mutações que têm de reprovar: tirar o `Conferir` de `tabelaArquivos` ou de `tabelaEventos`; tirar o `soLegivelAoCriar` de `tabelaPecas`; pôr `Status` em `corpoPecaNova` (o caso "criar já agendada" grava); `conferirArquivo` sem o `HasPrefix` (o caminho de outra peça grava); `acoesDaTela` com `aprovou`; tirar `soSessaoPropria` de uma rota (o caso do impersonado; e a varredura da Task 9).

```go
package conteudo

import (
	"testing"

	"github.com/rbv-co/social-dashboard/api/internal/testebanco/mundoteste"
)

// intacto: cada caso negado roda e o banco (as 9 tabelas) fica igual.
func intacto(t *testing.T, m *mundoteste.Mundo, casos []mundoteste.Caso) {
	t.Helper()
	for _, c := range casos {
		antes := m.Um(t, fotoDoConteudo)
		m.Rodar(t, []mundoteste.Caso{c})
		if m.Um(t, fotoDoConteudo) != antes {
			t.Errorf("%s: o banco mudou", c.Nome)
		}
	}
}

func TestPecas(t *testing.T) {
	m := novoMundo(t, montarPecas)
	const status = `select status from conteudo_pecas where id = '`
	intacto(t, m, []mundoteste.Caso{
		{Nome: "criar em conta que não vê", Quem: "conteudistaA1", Metodo: "POST", Caminho: "/conteudo/pecas",
			Corpo: `{"account_id":"` + A2 + `","titulo":"x","formato":"feed"}`, Status: 403, Tem: "sem_permissao"},
		{Nome: "criar já agendada (o INSERT pulava a guarda)", Quem: "aprovador", Metodo: "POST", Caminho: "/conteudo/pecas",
			Corpo: `{"account_id":"` + A1 + `","titulo":"x","formato":"feed","status":"agendada","publicar_em":"2026-11-01T15:00:00.000Z"}`, Status: 400, Tem: "corpo_invalido"},
		{Nome: "criar com aprovado_por", Quem: "conteudista", Metodo: "POST", Caminho: "/conteudo/pecas",
			Corpo: `{"account_id":"` + A1 + `","titulo":"x","formato":"feed","aprovado_por":"` + idConteudista + `"}`, Status: 400, Tem: "corpo_invalido"},
		{Nome: "criar com criado_por (vem da sessão)", Quem: "conteudista", Metodo: "POST", Caminho: "/conteudo/pecas",
			Corpo: `{"account_id":"` + A1 + `","titulo":"x","formato":"feed","criado_por":"` + idAprovador + `"}`, Status: 400, Tem: "corpo_invalido"},
		{Nome: "criar sem título", Quem: "conteudista", Metodo: "POST", Caminho: "/conteudo/pecas",
			Corpo: `{"account_id":"` + A1 + `","formato":"feed"}`, Status: 400, Tem: "Informe account_id, titulo e formato."},
		{Nome: "criar marcando o aviso", Quem: "conteudista", Metodo: "POST", Caminho: "/conteudo/pecas",
			Corpo: `{"account_id":"` + A1 + `","titulo":"x","formato":"feed","avisado_em":"2026-10-01T00:00:00Z"}`, Status: 400, Tem: "avisado_em"},
		{Nome: "criar com formato fora da lista", Quem: "conteudista", Metodo: "POST", Caminho: "/conteudo/pecas",
			Corpo: `{"account_id":"` + A1 + `","titulo":"x","formato":"tiktok"}`, Status: 400, Tem: "formato"},
		{Nome: "só conteudo.aprovar não cria", Quem: "soAprovar", Metodo: "POST", Caminho: "/conteudo/pecas",
			Corpo: `{"account_id":"` + A1 + `","titulo":"x","formato":"feed"}`, Status: 403},
		{Nome: "sem módulo não cria", Quem: "semModulo", Metodo: "POST", Caminho: "/conteudo/pecas",
			Corpo: `{"account_id":"` + A1 + `","titulo":"x","formato":"feed"}`, Status: 403},
		// a guarda pela rota: sem conteudo.aprovar, nem aprovar nem agendar vindo de em_aprovacao (400, a frase da função)
		{Nome: "editor aprova pelo PATCH", Quem: "conteudista", Metodo: "PATCH", Caminho: "/conteudo/pecas/" + P2,
			Corpo: `{"status":"aprovada"}`, Status: 400, Tem: "Sem permissao para aprovar pecas de conteudo."},
		{Nome: "editor agenda direto de em_aprovacao", Quem: "conteudista", Metodo: "PATCH", Caminho: "/conteudo/pecas/" + P2,
			Corpo: `{"status":"agendada","avisado_em":null}`, Status: 400, Tem: "Sem permissao para aprovar pecas de conteudo."},
		{Nome: "editar peça de A2 sem vê-la", Quem: "conteudistaA1", Metodo: "PATCH", Caminho: "/conteudo/pecas/" + P3,
			Corpo: `{"titulo":"x"}`, Status: 404},
		{Nome: "mover a peça para conta que não vê", Quem: "conteudistaA1", Metodo: "PATCH", Caminho: "/conteudo/pecas/" + P1,
			Corpo: `{"account_id":"` + A2 + `"}`, Status: 403},
		{Nome: "marcar o aviso", Quem: "conteudista", Metodo: "PATCH", Caminho: "/conteudo/pecas/" + P4,
			Corpo: `{"avisado_em":"2026-10-01T00:00:00Z"}`, Status: 400, Tem: "avisado_em"},
		{Nome: "gravar ig_media_id", Quem: "conteudista", Metodo: "PATCH", Caminho: "/conteudo/pecas/" + P1,
			Corpo: `{"ig_media_id":"IG1"}`, Status: 400, Tem: "corpo_invalido"},
		{Nome: "agendar sem data (check do banco)", Quem: "conteudista", Metodo: "PATCH", Caminho: "/conteudo/pecas/" + P1,
			Corpo: `{"status":"agendada"}`, Status: 400},
		{Nome: "impersonado não edita", Quem: "impersonado", Metodo: "PATCH", Caminho: "/conteudo/pecas/" + P1,
			Corpo: `{"titulo":"x"}`, Status: 403, Tem: "Quem entrou como outra pessoa"},
		{Nome: "apagar peça de A2 sem vê-la", Quem: "conteudistaA1", Metodo: "DELETE", Caminho: "/conteudo/pecas/" + P3, Status: 404},
	})
	if v := m.Um(t, status+P2+`'`); v != "em_aprovacao" {
		t.Fatalf("P2 = %s", v)
	}
	m.Rodar(t, []mundoteste.Caso{
		{Nome: "criar", Quem: "conteudistaA1", Metodo: "POST", Caminho: "/conteudo/pecas",
			Corpo: `{"account_id":"` + A1 + `","titulo":"Nova","formato":"feed","legenda":"oi","responsavel":null,` +
				`"publicar_em":"2026-11-01T15:00:00.000Z","avisado_em":null}`,
			Status: 201, Tem: `"criado_por":"` + idConteudistaA1 + `"`,
			Efeito: `select status || '|' || coalesce(avisado_em::text, 'nulo') from conteudo_pecas where titulo = 'Nova'`, Quer: "rascunho|nulo"},
		{Nome: "editar", Quem: "conteudistaA1", Metodo: "PATCH", Caminho: "/conteudo/pecas/" + P1,
			Corpo: `{"titulo":"Bastidor 2","legenda":"nova","status":"em_aprovacao"}`, Status: 200, Tem: `"titulo":"Bastidor 2"`,
			Efeito: status + P1 + `'`, Quer: "em_aprovacao"},
		{Nome: "remarcar limpa o aviso (tela-de-conteudo.vue:433)", Quem: "conteudista", Metodo: "PATCH", Caminho: "/conteudo/pecas/" + P4,
			Corpo: `{"publicar_em":"2026-10-30T15:00:00.000Z","avisado_em":null}`, Status: 200,
			Efeito: `select coalesce(avisado_em::text, 'nulo') from conteudo_pecas where id = '` + P4 + `'`, Quer: "nulo"},
		{Nome: "aprovador aprova pelo PATCH (a guarda deixa)", Quem: "aprovador", Metodo: "PATCH", Caminho: "/conteudo/pecas/" + P2,
			Corpo: `{"status":"aprovada"}`, Status: 200, Efeito: status + P2 + `'`, Quer: "aprovada"},
		{Nome: "admin edita a de A2", Quem: "adminA1", Metodo: "PATCH", Caminho: "/conteudo/pecas/" + P3,
			Corpo: `{"observacoes":null}`, Status: 200},
		{Nome: "apagar leva as filhas", Quem: "conteudista", Metodo: "DELETE", Caminho: "/conteudo/pecas/" + P1, Status: 204,
			Efeito: `select (select count(*) from conteudo_arquivos where peca_id = '` + P1 + `') + (select count(*) from conteudo_eventos where peca_id = '` + P1 + `')`, Quer: "0"},
	})
}

// As filhas (arquivo, evento) só com a peça VISÍVEL; a peça invisível e a inexistente respondem igual.
func TestFilhasSoComAPecaVisivel(t *testing.T) {
	m := novoMundo(t, montarPecas)
	inexistente := "a5930000-0000-4000-a000-0000000000ff"
	arq := func(peca, conta string) string {
		return `{"peca_id":"` + peca + `","ordem":5,"bucket":"conteudo","caminho":"` + conta + `/` + peca + `/5-x.png","tipo":"imagem","mime":"image/png","bytes":10}`
	}
	intacto(t, m, []mundoteste.Caso{
		{Nome: "arquivo em peça de A2", Quem: "conteudistaA1", Metodo: "POST", Caminho: "/conteudo/arquivos", Corpo: arq(P3, A2), Status: 403},
		{Nome: "arquivo em peça inexistente (igual)", Quem: "conteudistaA1", Metodo: "POST", Caminho: "/conteudo/arquivos", Corpo: arq(inexistente, A1), Status: 403},
		{Nome: "reordenar arquivo de peça de A2", Quem: "conteudistaA1", Metodo: "PATCH", Caminho: "/conteudo/arquivos/" + AR3, Corpo: `{"ordem":2}`, Status: 404},
		{Nome: "apagar arquivo de peça de A2", Quem: "conteudistaA1", Metodo: "DELETE", Caminho: "/conteudo/arquivos/" + AR3, Status: 404},
		{Nome: "evento em peça de A2", Quem: "conteudistaA1", Metodo: "POST", Caminho: "/conteudo/eventos",
			Corpo: `{"peca_id":"` + P3 + `","acao":"criou"}`, Status: 403},
		{Nome: "evento em peça inexistente (igual)", Quem: "conteudistaA1", Metodo: "POST", Caminho: "/conteudo/eventos",
			Corpo: `{"peca_id":"` + inexistente + `","acao":"criou"}`, Status: 403},
		{Nome: "evento forjando aprovação", Quem: "conteudista", Metodo: "POST", Caminho: "/conteudo/eventos",
			Corpo: `{"peca_id":"` + P2 + `","de":"em_aprovacao","para":"aprovada","acao":"aprovou"}`, Status: 400, Tem: "acao"},
		{Nome: "evento assinado por outro", Quem: "conteudista", Metodo: "POST", Caminho: "/conteudo/eventos",
			Corpo: `{"peca_id":"` + P1 + `","acao":"criou","quem":"` + idAprovador + `"}`, Status: 400, Tem: "corpo_invalido"},
		{Nome: "evento com estado fora da lista", Quem: "conteudista", Metodo: "POST", Caminho: "/conteudo/eventos",
			Corpo: `{"peca_id":"` + P1 + `","de":"x","acao":"mudou_status"}`, Status: 400},
		{Nome: "só conteudo.aprovar não grava evento", Quem: "soAprovar", Metodo: "POST", Caminho: "/conteudo/eventos",
			Corpo: `{"peca_id":"` + P1 + `","acao":"criou"}`, Status: 403},
	})
	m.Rodar(t, []mundoteste.Caso{
		{Nome: "evento na própria peça, assinado pela sessão", Quem: "conteudistaA1", Metodo: "POST", Caminho: "/conteudo/eventos",
			Corpo: `{"peca_id":"` + P1 + `","de":"rascunho","para":"em_aprovacao","acao":"mudou_status"}`, Status: 201,
			Tem: `"quem":"` + idConteudistaA1 + `"`},
		{Nome: "admin grava arquivo na peça de A2", Quem: "adminA1", Metodo: "POST", Caminho: "/conteudo/arquivos", Corpo: arq(P3, A2), Status: 201},
	})
}

// O caminho do arquivo fica preso a <conta da peça>/<peça>/; reordenar e apagar seguem a tela.
func TestArquivos(t *testing.T) {
	m := novoMundo(t, montarPecas)
	corpo := func(caminho string) string {
		return `{"peca_id":"` + P1 + `","ordem":3,"bucket":"conteudo","caminho":"` + caminho + `","tipo":"imagem","mime":"image/png","bytes":10}`
	}
	intacto(t, m, []mundoteste.Caso{
		{Nome: "caminho de outra peça", Quem: "conteudista", Metodo: "POST", Caminho: "/conteudo/arquivos", Corpo: corpo(A2 + "/" + P3 + "/1-capa.png"), Status: 403},
		{Nome: "caminho de outra peça da mesma conta", Quem: "conteudista", Metodo: "POST", Caminho: "/conteudo/arquivos", Corpo: corpo(A1 + "/" + P2 + "/3-x.png"), Status: 403},
		{Nome: "caminho com ..", Quem: "conteudista", Metodo: "POST", Caminho: "/conteudo/arquivos", Corpo: corpo(A1 + "/" + P1 + "/../x.png"), Status: 400},
		{Nome: "caminho absoluto", Quem: "conteudista", Metodo: "POST", Caminho: "/conteudo/arquivos", Corpo: corpo("/etc/passwd"), Status: 400},
		{Nome: "outro bucket", Quem: "conteudista", Metodo: "POST", Caminho: "/conteudo/arquivos",
			Corpo: `{"peca_id":"` + P1 + `","bucket":"fabrica-criativos","caminho":"` + A1 + `/` + P1 + `/3-x.png","tipo":"imagem"}`, Status: 400},
		{Nome: "a mesma ordem duas vezes", Quem: "conteudista", Metodo: "POST", Caminho: "/conteudo/arquivos",
			Corpo: `{"peca_id":"` + P1 + `","ordem":1,"caminho":"` + A1 + `/` + P1 + `/1-outra.png","tipo":"imagem"}`, Status: 409},
		{Nome: "reordenar trocando o caminho", Quem: "conteudista", Metodo: "PATCH", Caminho: "/conteudo/arquivos/" + AR1,
			Corpo: `{"ordem":3,"caminho":"x"}`, Status: 400, Tem: "corpo_invalido"},
		{Nome: "ordem fora da faixa", Quem: "conteudista", Metodo: "PATCH", Caminho: "/conteudo/arquivos/" + AR1, Corpo: `{"ordem":-2}`, Status: 400},
	})
	m.Rodar(t, []mundoteste.Caso{
		{Nome: "subir", Quem: "conteudistaA1", Metodo: "POST", Caminho: "/conteudo/arquivos", Corpo: corpo(A1 + "/" + P1 + "/3-foto.png"), Status: 201,
			Tem: `"caminho":"` + A1 + `/` + P1 + `/3-foto.png"`},
		// a troca em três passos de painel-peca.vue:737-739
		{Nome: "troca 1", Quem: "conteudistaA1", Metodo: "PATCH", Caminho: "/conteudo/arquivos/" + AR1, Corpo: `{"ordem":-1}`, Status: 200},
		{Nome: "troca 2", Quem: "conteudistaA1", Metodo: "PATCH", Caminho: "/conteudo/arquivos/" + AR2, Corpo: `{"ordem":1}`, Status: 200},
		{Nome: "troca 3", Quem: "conteudistaA1", Metodo: "PATCH", Caminho: "/conteudo/arquivos/" + AR1, Corpo: `{"ordem":2}`, Status: 200,
			Efeito: `select string_agg(ordem::text, ',' order by caminho) from conteudo_arquivos where peca_id = '` + P1 + `'`, Quer: "2,1,3"},
		{Nome: "apagar", Quem: "conteudistaA1", Metodo: "DELETE", Caminho: "/conteudo/arquivos/" + AR2, Status: 204,
			Efeito: `select count(*)::text from conteudo_arquivos where id = '` + AR2 + `'`, Quer: "0"},
	})
}
```

**(c) Arquivos:** Create `api/internal/conteudo/pecas.go`, `api/internal/conteudo/pecas_test.go`.

**(d) Dependências:** Tasks 2, 3 e 4 (as constantes de colunas).

- [ ] **Step 1:** Testes; ver falhar. - [ ] **Step 2:** Implementar (código de (a)). - [ ] **Step 3:** `cd api && gofmt -l ./internal && go vet ./internal/conteudo/ && go test -count=1 ./internal/conteudo/` PASS; mutações reprovam. - [ ] **Step 4:** Commit `feat(api): escritas de peça, arquivo e evento (a guarda da aprovação pela rota, filhas presas à peça visível)` (+ `Co-Authored-By`).
---

### Task 6: Escritas de ideias, blocos e concorrentes

**Revisor:** sonnet. **Depende de:** 2, 3, 4 (as constantes `colunasIdeia`, `colunasBloco`, `colunasConcorrente`: em worktree paralela, copie e apague no merge), 5 (o ajudante de teste `intacto`, em `pecas_test.go`: em worktree paralela, copie-o para `pauta_test.go` e apague a cópia no merge).

**(a) Contrato** (catálogo + o gancho da Task 2; `soSessaoPropria` em todas)
- `POST /conteudo/ideias` (`criarIdeia`, `dados-conteudo.js:300`) com `corpoIdeiaNova` (título obrigatório; sem `situacao`, `peca_id`, `origem`, `modelo`, `job_id`: a ideia nasce `nova` e `manual`); `PATCH /conteudo/ideias/{id}` (`atualizarIdeia :330`, `mudarSituacaoDaIdeia :339`, `planoViraPecas :409`) com `corpoIdeia` (+ `situacao`, `peca_id`). `conferirIdeia`: criar só o legível (conta nula = de todas as marcas: legível a todo conteudista) e ligar só a peça legível (403 igual para invisível e inexistente). Mover a ideia para conta invisível = 403 (o `EditarNova` do catálogo).
- `POST /conteudo/blocos` (`salvarBloco :447`; a tela só CRIA blocos, `voz-da-marca.vue:197`) com `corpoBloco` (o apelido é obrigatório: `nome` é NOT NULL no banco — achado 7); `PATCH /conteudo/blocos/{id}` (`apagarBloco :455`) só com `ativo`. Criar só o legível.
- `POST /conteudo/concorrentes` (`salvarConcorrente :478`) com `corpoConcorrente`; `PATCH /conteudo/concorrentes/{id}` (`apagarConcorrente :491`) só com `ativo`. SÓ o catálogo: a tabela não tem a restritiva em produção — paridade (Ruling 5.9-5, achado 5). `@` repetido na marca = `409 conflito` (a tela tratava o 23505).
- **Ensaiado** (worktree sobre o 5.7 + Tasks 1–5): os dois testes abaixo passam.

```go
package conteudo

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/autz"
	"github.com/rbv-co/social-dashboard/api/internal/dados"
)

// corpoIdeia: limparParaGravar (roteiro.js:120-145) + account_id (painel-ideia.vue:298), a situação
// (mudarSituacaoDaIdeia, dados-conteudo.js:339) e a peça (planoViraPecas :409). origem, modelo, job_id,
// referencia e porque_formato ficam FORA: são do robô (que grava por pg na VPS).
type corpoIdeia struct {
	AccountID         json.RawMessage `json:"account_id,omitempty"`
	Titulo            json.RawMessage `json:"titulo,omitempty"`
	Formato           json.RawMessage `json:"formato,omitempty"`
	Pilar             json.RawMessage `json:"pilar,omitempty"`
	Gancho            json.RawMessage `json:"gancho,omitempty"`
	Producao          json.RawMessage `json:"producao,omitempty"`
	LegendaSugerida   json.RawMessage `json:"legenda_sugerida,omitempty"`
	Cta               json.RawMessage `json:"cta,omitempty"`
	HashtagsSugeridas json.RawMessage `json:"hashtags_sugeridas,omitempty"`
	PorQueAgora       json.RawMessage `json:"por_que_agora,omitempty"`
	Roteiro           json.RawMessage `json:"roteiro,omitempty"`
	Situacao          json.RawMessage `json:"situacao,omitempty"`
	PecaID            json.RawMessage `json:"peca_id,omitempty"`
}

// listaDeObjetos: [] ou uma lista de até max objetos (o roteiro: um take/card por item).
func listaDeObjetos(v json.RawMessage, max int) bool {
	var l []map[string]json.RawMessage
	return len(v) > 0 && v[0] == '[' && json.Unmarshal(v, &l) == nil && len(l) <= max
}

func (c corpoIdeia) Validar() error {
	var e []error
	ok := func(v json.RawMessage, valido bool, frase string) {
		if v != nil && !valido {
			e = append(e, errors.New(frase))
		}
	}
	ok(c.AccountID, uuidOuNulo(c.AccountID), "account_id é o id da conta ou null (de todas as marcas).")
	ok(c.Titulo, textoAte(c.Titulo, 300, false), "titulo tem de 1 a 300 caracteres.")
	ok(c.Formato, nulo(c.Formato) || textoEm(c.Formato, formatosDaPeca...), "formato é feed, reels, stories, carrossel ou null.")
	ok(c.Pilar, textoOuNulo(c.Pilar, 60), "pilar tem até 60 caracteres.")
	for _, v := range []json.RawMessage{c.Gancho, c.Producao, c.LegendaSugerida, c.Cta, c.HashtagsSugeridas, c.PorQueAgora} {
		ok(v, textoOuNulo(v, 5000), "os textos da ideia têm até 5000 caracteres.")
	}
	ok(c.Roteiro, listaDeObjetos(c.Roteiro, 60), "roteiro é uma lista de até 60 passos.")
	ok(c.Situacao, textoEm(c.Situacao, "nova", "favorita", "usada", "descartada"), "situacao é nova, favorita, usada ou descartada.")
	ok(c.PecaID, uuidOuNulo(c.PecaID), "peca_id é o id da peça ou null.")
	return errors.Join(e...)
}

// corpoIdeiaNova: criarIdeia (:300). Sem situacao nem peca_id (nasce 'nova'; ligar a uma peça é edição) e com
// título obrigatório. origem fica no default 'manual' (a tela mandava 'manual'; o corpo não escolhe 'ia').
type corpoIdeiaNova struct {
	AccountID         json.RawMessage `json:"account_id,omitempty"`
	Titulo            json.RawMessage `json:"titulo,omitempty"`
	Formato           json.RawMessage `json:"formato,omitempty"`
	Pilar             json.RawMessage `json:"pilar,omitempty"`
	Gancho            json.RawMessage `json:"gancho,omitempty"`
	Producao          json.RawMessage `json:"producao,omitempty"`
	LegendaSugerida   json.RawMessage `json:"legenda_sugerida,omitempty"`
	Cta               json.RawMessage `json:"cta,omitempty"`
	HashtagsSugeridas json.RawMessage `json:"hashtags_sugeridas,omitempty"`
	PorQueAgora       json.RawMessage `json:"por_que_agora,omitempty"`
	Roteiro           json.RawMessage `json:"roteiro,omitempty"`
}

func (c corpoIdeiaNova) Validar() error {
	var falta error
	if c.Titulo == nil {
		falta = errors.New("Informe o titulo.")
	}
	return errors.Join(falta, corpoIdeia{AccountID: c.AccountID, Titulo: c.Titulo, Formato: c.Formato, Pilar: c.Pilar,
		Gancho: c.Gancho, Producao: c.Producao, LegendaSugerida: c.LegendaSugerida, Cta: c.Cta,
		HashtagsSugeridas: c.HashtagsSugeridas, PorQueAgora: c.PorQueAgora, Roteiro: c.Roteiro}.Validar())
}

// conferirIdeia: criar só o legível (a conta; nula = de todas as marcas, legível a todo conteudista) e, na
// edição, ligar só a uma peça que quem pede lê (invisível ou inexistente = 403). Rulings 5.9-4.
func conferirIdeia(ctx context.Context, tx pgx.Tx, e *autz.Escopo, id string, campos map[string]any) error {
	if id == "" {
		return soLegivelAoCriar("conteudo_ideias")(ctx, tx, e, id, campos)
	}
	if v := bruto(campos, "peca_id"); v != nil && !nulo(v) {
		peca, _ := comoTexto(v)
		_, err := pecaVisivel(ctx, tx, e, peca)
		return negado(err)
	}
	return nil
}

var tabelaIdeias = dados.Tabela{Nome: "conteudo_ideias", Resposta: colunasIdeia, Autor: "criado_por", Conferir: conferirIdeia}

// corpoBloco: adicionarBloco (voz-da-marca.vue:197-202 → salvarBloco, dados-conteudo.js:447). O nome é NOT NULL
// no banco: o "Apelido (opcional)" vazio, que a tela manda como null, já falhava em produção (achado 7).
type corpoBloco struct {
	AccountID json.RawMessage `json:"account_id,omitempty"`
	Tipo      json.RawMessage `json:"tipo,omitempty"`
	Nome      json.RawMessage `json:"nome,omitempty"`
	Texto     json.RawMessage `json:"texto,omitempty"`
}

func (c corpoBloco) Validar() error {
	var e []error
	if c.AccountID != nil && !uuidOuNulo(c.AccountID) {
		e = append(e, errors.New("account_id é o id da conta ou null (de todas as marcas)."))
	}
	if !textoEm(c.Tipo, "legenda", "hashtags", "cta", "assinatura") {
		e = append(e, errors.New("tipo é legenda, hashtags, cta ou assinatura."))
	}
	if !textoAte(c.Nome, 100, false) {
		e = append(e, errors.New("nome (o apelido) tem de 1 a 100 caracteres."))
	}
	if !textoAte(c.Texto, 5000, false) {
		e = append(e, errors.New("texto tem de 1 a 5000 caracteres."))
	}
	return errors.Join(e...)
}

// corpoAtivo: apagarBloco (:455) e apagarConcorrente (:491) desativam (nunca apagam).
type corpoAtivo struct {
	Ativo json.RawMessage `json:"ativo,omitempty"`
}

func (c corpoAtivo) Validar() error {
	if !booleano(c.Ativo) {
		return errors.New("ativo é true ou false.")
	}
	return nil
}

var tabelaBlocos = dados.Tabela{Nome: "conteudo_blocos", Resposta: colunasBloco, Autor: "criado_por",
	Conferir: soLegivelAoCriar("conteudo_blocos")}

// corpoConcorrente: adicionarConcorrente (voz-da-marca.vue:213-219 → salvarConcorrente, :478). O @ já vem tirado.
type corpoConcorrente struct {
	AccountID  json.RawMessage `json:"account_id,omitempty"`
	Handle     json.RawMessage `json:"handle,omitempty"`
	Nome       json.RawMessage `json:"nome,omitempty"`
	Observacao json.RawMessage `json:"observacao,omitempty"`
}

func (c corpoConcorrente) Validar() error {
	var e []error
	if !casa(c.AccountID, reUUID) {
		e = append(e, errors.New("account_id é o id da conta."))
	}
	if !textoAte(c.Handle, 100, false) {
		e = append(e, errors.New("handle tem de 1 a 100 caracteres."))
	}
	if c.Nome != nil && !textoOuNulo(c.Nome, 200) {
		e = append(e, errors.New("nome tem até 200 caracteres."))
	}
	if c.Observacao != nil && !textoOuNulo(c.Observacao, 2000) {
		e = append(e, errors.New("observacao tem até 2000 caracteres."))
	}
	return errors.Join(e...)
}

// tabelaConcorrentes: SÓ o catálogo — conteudo_concorrentes não tem a restritiva em produção: todo conteudista
// grava o concorrente de qualquer marca, como hoje (Ruling 5.9-5, achado 5). Sem coluna de autoria.
var tabelaConcorrentes = dados.Tabela{Nome: "conteudo_concorrentes", Resposta: colunasConcorrente}

func montarPauta(r chi.Router, p *pgxpool.Pool) {
	r.With(soSessaoPropria).Post("/conteudo/ideias", dados.RotaCriar[corpoIdeiaNova](p, autz.Producao, tabelaIdeias))
	r.With(soSessaoPropria).Patch("/conteudo/ideias/{id}", dados.RotaEditar[corpoIdeia](p, autz.Producao, tabelaIdeias))
	r.With(soSessaoPropria).Post("/conteudo/blocos", dados.RotaCriar[corpoBloco](p, autz.Producao, tabelaBlocos))
	r.With(soSessaoPropria).Patch("/conteudo/blocos/{id}", dados.RotaEditar[corpoAtivo](p, autz.Producao, tabelaBlocos))
	r.With(soSessaoPropria).Post("/conteudo/concorrentes", dados.RotaCriar[corpoConcorrente](p, autz.Producao, tabelaConcorrentes))
	r.With(soSessaoPropria).Patch("/conteudo/concorrentes/{id}", dados.RotaEditar[corpoAtivo](p, autz.Producao, tabelaConcorrentes))
}
```

**(b) Testes de aceitação** (`pauta_test.go`, código abaixo; `intacto` da Task 5)
- `TestIdeias`: negados e intactos — criar em A2 por quem só vê A1 e na própria pela lista vazia (403), com `origem`/`criado_por` (400), sem título (400 com a frase), roteiro que não é lista (400), editar ideia de A2 sem vê-la (404), mover para A2 (403), ligar a peça de A2 e a peça inexistente (403 igual), situação fora da lista (400), trocar a origem (400), `soAprovar` (403). Permitidos com efeito — criar na própria (origem `manual`, `criado_por` da sessão, `nova`), criar de todas as marcas (conta nula), favoritar, o plano virando peça (`usada` + `peca_id`), editar a geral, descartar a de A2 por quem vê todas.
- `TestBlocosEConcorrentes`: bloco em A2 por quem só vê A1 (403), sem apelido (400 com "apelido"), tipo fora da lista (400), com `criado_por` (400), desativar bloco de A2 sem vê-lo (404), editar o texto (400: só `ativo`); concorrente repetido (409), sem conta (400), PATCH de `handle` (400), sem módulo (403), `soAprovar` desativando (404: não lê a tabela). Permitidos: bloco na própria (autoria da sessão), desativar; e a PARIDADE dos concorrentes: quem só vê A1 cria e desativa os de A2.
- Mutações que têm de reprovar: tirar o `Conferir` de `tabelaIdeias` (A1 cria em A2 e liga a P3) ou de `tabelaBlocos`; `corpoIdeiaNova` com `Situacao`; `corpoAtivo` aceitando texto; um `Conferir` de conta em `tabelaConcorrentes` sem Ruling (os casos de paridade reprovam — mudar isso é decisão do dono, achado 5).

```go
package conteudo

import (
	"testing"

	"github.com/rbv-co/social-dashboard/api/internal/testebanco/mundoteste"
)

func TestIdeias(t *testing.T) {
	m := novoMundo(t, montarPauta)
	const situacao = `select situacao || '|' || coalesce(peca_id::text, 'nulo') from conteudo_ideias where id = '`
	intacto(t, m, []mundoteste.Caso{
		{Nome: "criar em conta que não vê", Quem: "conteudistaA1", Metodo: "POST", Caminho: "/conteudo/ideias",
			Corpo: `{"account_id":"` + A2 + `","titulo":"x"}`, Status: 403},
		{Nome: "lista vazia não cria nem na própria", Quem: "conteudistaNenhuma", Metodo: "POST", Caminho: "/conteudo/ideias",
			Corpo: `{"account_id":"` + A1 + `","titulo":"x"}`, Status: 403},
		{Nome: "criar dizendo que é da IA", Quem: "conteudista", Metodo: "POST", Caminho: "/conteudo/ideias",
			Corpo: `{"account_id":"` + A1 + `","titulo":"x","origem":"ia"}`, Status: 400, Tem: "corpo_invalido"},
		{Nome: "criar com criado_por", Quem: "conteudista", Metodo: "POST", Caminho: "/conteudo/ideias",
			Corpo: `{"titulo":"x","criado_por":"` + idAprovador + `"}`, Status: 400, Tem: "corpo_invalido"},
		{Nome: "criar sem título", Quem: "conteudista", Metodo: "POST", Caminho: "/conteudo/ideias",
			Corpo: `{"account_id":"` + A1 + `","gancho":"x"}`, Status: 400, Tem: "Informe o titulo."},
		{Nome: "roteiro que não é lista", Quem: "conteudista", Metodo: "POST", Caminho: "/conteudo/ideias",
			Corpo: `{"titulo":"x","roteiro":{"cena":1}}`, Status: 400, Tem: "roteiro"},
		{Nome: "editar ideia de A2 sem vê-la", Quem: "conteudistaA1", Metodo: "PATCH", Caminho: "/conteudo/ideias/" + I3,
			Corpo: `{"situacao":"descartada"}`, Status: 404},
		{Nome: "mover a ideia para A2", Quem: "conteudistaA1", Metodo: "PATCH", Caminho: "/conteudo/ideias/" + I1,
			Corpo: `{"account_id":"` + A2 + `"}`, Status: 403},
		{Nome: "ligar a ideia a peça de A2", Quem: "conteudistaA1", Metodo: "PATCH", Caminho: "/conteudo/ideias/" + I1,
			Corpo: `{"situacao":"usada","peca_id":"` + P3 + `"}`, Status: 403},
		{Nome: "ligar a peça inexistente (igual)", Quem: "conteudistaA1", Metodo: "PATCH", Caminho: "/conteudo/ideias/" + I1,
			Corpo: `{"situacao":"usada","peca_id":"a5930000-0000-4000-a000-0000000000ff"}`, Status: 403},
		{Nome: "situação fora da lista", Quem: "conteudista", Metodo: "PATCH", Caminho: "/conteudo/ideias/" + I1,
			Corpo: `{"situacao":"arquivada"}`, Status: 400},
		{Nome: "trocar a origem", Quem: "conteudista", Metodo: "PATCH", Caminho: "/conteudo/ideias/" + I1,
			Corpo: `{"origem":"manual"}`, Status: 400, Tem: "corpo_invalido"},
		{Nome: "só conteudo.aprovar não cria", Quem: "soAprovar", Metodo: "POST", Caminho: "/conteudo/ideias",
			Corpo: `{"titulo":"x"}`, Status: 403},
	})
	m.Rodar(t, []mundoteste.Caso{
		{Nome: "criar na própria conta", Quem: "conteudistaA1", Metodo: "POST", Caminho: "/conteudo/ideias",
			Corpo:  `{"account_id":"` + A1 + `","titulo":"Nova pauta","formato":"reels","roteiro":[{"cena":1,"narracao":"oi"}]}`,
			Status: 201, Tem: `"origem":"manual"`,
			Efeito: `select criado_por::text || '|' || situacao from conteudo_ideias where titulo = 'Nova pauta'`, Quer: idConteudistaA1 + "|nova"},
		{Nome: "criar de todas as marcas", Quem: "conteudistaA1", Metodo: "POST", Caminho: "/conteudo/ideias",
			Corpo: `{"account_id":null,"titulo":"Geral"}`, Status: 201},
		{Nome: "favoritar", Quem: "conteudistaA1", Metodo: "PATCH", Caminho: "/conteudo/ideias/" + I1,
			Corpo: `{"situacao":"favorita"}`, Status: 200, Efeito: situacao + I1 + `'`, Quer: "favorita|nulo"},
		{Nome: "o plano vira peça (planoViraPecas)", Quem: "conteudistaA1", Metodo: "PATCH", Caminho: "/conteudo/ideias/" + I1,
			Corpo: `{"situacao":"usada","peca_id":"` + P1 + `"}`, Status: 200, Efeito: situacao + I1 + `'`, Quer: "usada|" + P1},
		{Nome: "editar a geral", Quem: "conteudistaA1", Metodo: "PATCH", Caminho: "/conteudo/ideias/" + I2,
			Corpo: `{"gancho":"Comece pelo couro","cta":null}`, Status: 200},
		{Nome: "descartar a de A2 quem vê todas", Quem: "conteudista", Metodo: "PATCH", Caminho: "/conteudo/ideias/" + I3,
			Corpo: `{"situacao":"descartada"}`, Status: 200, Efeito: situacao + I3 + `'`, Quer: "descartada|nulo"},
	})
}

func TestBlocosEConcorrentes(t *testing.T) {
	m := novoMundo(t, montarPauta)
	intacto(t, m, []mundoteste.Caso{
		{Nome: "bloco em conta que não vê", Quem: "conteudistaA1", Metodo: "POST", Caminho: "/conteudo/blocos",
			Corpo: `{"account_id":"` + A2 + `","tipo":"legenda","nome":"x","texto":"y"}`, Status: 403},
		{Nome: "bloco sem apelido (a tela manda null: o banco recusava)", Quem: "conteudista", Metodo: "POST", Caminho: "/conteudo/blocos",
			Corpo: `{"account_id":"` + A1 + `","tipo":"legenda","nome":null,"texto":"y"}`, Status: 400, Tem: "apelido"},
		{Nome: "bloco de tipo fora da lista", Quem: "conteudista", Metodo: "POST", Caminho: "/conteudo/blocos",
			Corpo: `{"account_id":"` + A1 + `","tipo":"emoji","nome":"x","texto":"y"}`, Status: 400},
		{Nome: "bloco com criado_por (salvarBloco o mandava)", Quem: "conteudista", Metodo: "POST", Caminho: "/conteudo/blocos",
			Corpo: `{"account_id":"` + A1 + `","tipo":"legenda","nome":"x","texto":"y","criado_por":"` + idConteudista + `"}`, Status: 400},
		{Nome: "desativar bloco de A2 sem vê-lo", Quem: "conteudistaA1", Metodo: "PATCH", Caminho: "/conteudo/blocos/" + B3,
			Corpo: `{"ativo":false}`, Status: 404},
		{Nome: "editar o texto do bloco (só ativo)", Quem: "conteudista", Metodo: "PATCH", Caminho: "/conteudo/blocos/" + B1,
			Corpo: `{"texto":"x"}`, Status: 400, Tem: "corpo_invalido"},
		{Nome: "concorrente repetido na marca", Quem: "conteudista", Metodo: "POST", Caminho: "/conteudo/concorrentes",
			Corpo: `{"account_id":"` + A1 + `","handle":"lojaum"}`, Status: 409},
		{Nome: "concorrente sem conta", Quem: "conteudista", Metodo: "POST", Caminho: "/conteudo/concorrentes",
			Corpo: `{"handle":"x"}`, Status: 400},
		{Nome: "concorrente: só ativo no PATCH", Quem: "conteudista", Metodo: "PATCH", Caminho: "/conteudo/concorrentes/" + K1,
			Corpo: `{"handle":"y"}`, Status: 400},
		{Nome: "concorrente sem o módulo", Quem: "semModulo", Metodo: "POST", Caminho: "/conteudo/concorrentes",
			Corpo: `{"account_id":"` + A1 + `","handle":"z"}`, Status: 403},
		{Nome: "concorrente com só conteudo.aprovar", Quem: "soAprovar", Metodo: "PATCH", Caminho: "/conteudo/concorrentes/" + K1,
			Corpo: `{"ativo":false}`, Status: 404},
	})
	m.Rodar(t, []mundoteste.Caso{
		{Nome: "bloco na própria conta", Quem: "conteudistaA1", Metodo: "POST", Caminho: "/conteudo/blocos",
			Corpo: `{"account_id":"` + A1 + `","tipo":"cta","nome":"Chame","texto":"Chame no direct"}`, Status: 201,
			Tem: `"criado_por":"` + idConteudistaA1 + `"`},
		{Nome: "desativar bloco", Quem: "conteudistaA1", Metodo: "PATCH", Caminho: "/conteudo/blocos/" + B1, Corpo: `{"ativo":false}`, Status: 200,
			Efeito: `select ativo::text from conteudo_blocos where id = '` + B1 + `'`, Quer: "false"},
		// paridade (Ruling 5.9-5): concorrentes não têm a restritiva — quem só vê A1 grava e desativa os de A2, como hoje
		{Nome: "concorrente em A2 por quem só vê A1", Quem: "conteudistaA1", Metodo: "POST", Caminho: "/conteudo/concorrentes",
			Corpo: `{"account_id":"` + A2 + `","handle":"lojatres","nome":null,"observacao":"vende bolsa"}`, Status: 201},
		{Nome: "desativar concorrente de A2 por quem só vê A1", Quem: "conteudistaA1", Metodo: "PATCH", Caminho: "/conteudo/concorrentes/" + K2,
			Corpo: `{"ativo":false}`, Status: 200, Efeito: `select ativo::text from conteudo_concorrentes where id = '` + K2 + `'`, Quer: "false"},
	})
}
```

**(c) Arquivos:** Create `api/internal/conteudo/pauta.go`, `api/internal/conteudo/pauta_test.go`.

**(d) Dependências:** Tasks 2, 3, 4 e 5 (ver acima o que copiar em worktree paralela).

- [ ] **Step 1:** Testes; ver falhar. - [ ] **Step 2:** Implementar (código de (a)). - [ ] **Step 3:** `cd api && gofmt -l ./internal && go vet ./internal/conteudo/ && go test -count=1 ./internal/conteudo/` PASS; mutações reprovam. - [ ] **Step 4:** Commit `feat(api): escritas de ideias, blocos e concorrentes (criar só o legível; concorrentes como em produção)` (+ `Co-Authored-By`).
---

### Task 7: As 6 RPCs — portões provados contra as funções, a conta do parâmetro conferida

**Revisor:** opus. **Depende de:** 1 (as funções verbatim), 3 (regras, `comoTexto`, `reUUID`, mundo), 5 (o ajudante de teste `intacto`; em worktree paralela, copie-o e apague no merge).

**(a) Contrato**
- `conteudo.FuncoesRPC` (abaixo): as 6 funções, nomes, parâmetros e DEFAULTs de `02-funções.csv:178-474` (`p_motivo` e `p_publicar_em` opcionais), `rpc.Valor` (devolvem a linha: `to_json` do composto, como o PostgREST; a tela já trata objeto ou lista), `SoSessaoPropria: true` em todas (todas gravam).
- Portões: `Aprovador` em `conteudo_decidir` e `conteudo_aprovar_e_agendar`; `Conteudista` nas outras 4 — iguais à checagem de dentro de cada função, provado pessoa a pessoa (`TestPortoesIguaisAsFuncoes`), inclusive o gatilho da guarda (o mesmo portão do `PATCH` de status da Task 5).
- `Conferir` (Ruling 5.9-10): a peça (`p_peca`), a peça da sugestão (`p_casamento`) e a ideia (`p_ideia`) têm de ser de conta que quem pede VÊ (`autz.PodeVerConta`), e `p_account` também. Só a CONTA: o módulo `conteudo` a função não pedia (quem só tem `conteudo.aprovar` continua decidindo: paridade). Nulo, id inválido, inexistente e de outra conta = 403 IGUAL, sem a função rodar. Ideia de conta nula (de todas as marcas) passa. Sem trava de linha: a decisão concorrente é o trinco da própria função (`and status = 'em_aprovacao'`), e uma trava `for share` na conferência arriscaria impasse entre dois aprovadores (cada um com a trava compartilhada, os dois querendo atualizar a linha); no ensaio o impasse não apareceu em 5 rodadas — janela pequena, mas real —, e sem trava nada se perde.
- Os erros de negócio das funções chegam como `400 regra_de_negocio` com a frase (P0001), como o PostgREST os entregava; o 403 do portão e da conferência é `{"error":"sem_permissao"}` (com a frase do "entrar como" quando é o caso).
- `ParamConta` do 5.7 não serve aqui (exige parâmetro `text`; `p_account` é `uuid`): a conta vai no `Conferir`.
- **Ensaiado** (worktree sobre o 5.7 + Tasks 1–6): os três testes passam com `-race`; `Conteudista` com `e.Ativo` faz o teste dos portões acusar o desativado; tirar o `Conferir` do `conteudo_aprovar_e_agendar` faz o aprovador de A1 agendar a peça de A2.

```go
package conteudo

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/rbv-co/social-dashboard/api/internal/autz"
	"github.com/rbv-co/social-dashboard/api/internal/rpc"
)

// FuncoesRPC: as 6 RPCs do Conteúdo na lista branca de POST /rpc/{nome} (web.FuncoesRPC as junta). Todas
// gravam (SoSessaoPropria: "entrar como" recebe 403 sem a função rodar). O portão é a checagem de dentro de
// cada função (TestPortoesIguaisAsFuncoes); a conferência prende a peça/casamento/ideia/conta do parâmetro à
// restritiva pode_ver_conta, que as funções SECURITY DEFINER ignoravam (Ruling 5.9-10). O ParamConta do 5.7
// não serve: ele é para parâmetro text, e p_account é uuid. Os parâmetros e os DEFAULTs são os de
// 02-funções.csv:178-474.
var FuncoesRPC = []rpc.Funcao{
	{Nome: "conteudo_aprovar_e_agendar", Retorno: rpc.Valor, Portao: Aprovador, SoSessaoPropria: true,
		Params: []rpc.Param{{Nome: "p_peca", Tipo: "uuid"}}, Conferir: pecaDoParametro("p_peca")},
	{Nome: "conteudo_casar_na_mao", Retorno: rpc.Valor, Portao: Conteudista, SoSessaoPropria: true,
		Params:   []rpc.Param{{Nome: "p_peca", Tipo: "uuid"}, {Nome: "p_media", Tipo: "text"}},
		Conferir: pecaDoParametro("p_peca")},
	{Nome: "conteudo_decidir", Retorno: rpc.Valor, Portao: Aprovador, SoSessaoPropria: true,
		Params: []rpc.Param{{Nome: "p_peca", Tipo: "uuid"}, {Nome: "p_decisao", Tipo: "text"},
			{Nome: "p_motivo", Tipo: "text", Opcional: true}},
		Conferir: pecaDoParametro("p_peca")},
	{Nome: "conteudo_decidir_casamento", Retorno: rpc.Valor, Portao: Conteudista, SoSessaoPropria: true,
		Params:   []rpc.Param{{Nome: "p_casamento", Tipo: "uuid"}, {Nome: "p_confirma", Tipo: "boolean"}},
		Conferir: pecaDoCasamento},
	{Nome: "conteudo_ideia_virar_peca", Retorno: rpc.Valor, Portao: Conteudista, SoSessaoPropria: true,
		Params: []rpc.Param{{Nome: "p_ideia", Tipo: "uuid"}, {Nome: "p_account", Tipo: "uuid"},
			{Nome: "p_publicar_em", Tipo: "timestamptz", Opcional: true}},
		Conferir: ideiaEContaVisiveis},
	{Nome: "conteudo_reavisar", Retorno: rpc.Valor, Portao: Conteudista, SoSessaoPropria: true,
		Params: []rpc.Param{{Nome: "p_peca", Tipo: "uuid"}}, Conferir: pecaDoParametro("p_peca")},
}

// contaVisivel: a conta (texto; vazio = a linha não existe) é uma que quem pede vê? Inexistente e de outra
// conta respondem igual (403): o parâmetro não confirma que a linha existe.
func contaVisivel(e *autz.Escopo, conta string, err error) error {
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		return autz.ErrNegado
	case err != nil:
		return err
	case !autz.PodeVerConta(e, conta):
		return autz.ErrNegado
	}
	return nil
}

// pecaDoParametro: a peça do parâmetro tem de ser de uma conta que quem pede vê. Só a CONTA: o módulo
// 'conteudo' a função não pedia (quem só tem 'conteudo.aprovar' continua decidindo, como hoje); o portão já
// decidiu a pessoa. Nulo, id inválido e inexistente = 403, como a de outra conta.
func pecaDoParametro(nome string) func(context.Context, pgx.Tx, *autz.Escopo, map[string]json.RawMessage) error {
	return func(ctx context.Context, tx pgx.Tx, e *autz.Escopo, args map[string]json.RawMessage) error {
		peca, _ := comoTexto(args[nome])
		if !reUUID.MatchString(peca) {
			return autz.ErrNegado
		}
		var conta string
		err := tx.QueryRow(ctx, `select account_id::text from conteudo_pecas where id = $1::uuid`, peca).Scan(&conta)
		return contaVisivel(e, conta, err)
	}
}

// pecaDoCasamento: a peça da sugestão de casamento tem de ser de uma conta que quem pede vê.
func pecaDoCasamento(ctx context.Context, tx pgx.Tx, e *autz.Escopo, args map[string]json.RawMessage) error {
	casamento, _ := comoTexto(args["p_casamento"])
	if !reUUID.MatchString(casamento) {
		return autz.ErrNegado
	}
	var conta string
	err := tx.QueryRow(ctx, `select pc.account_id::text from conteudo_casamentos c
		join conteudo_pecas pc on pc.id = c.peca_id where c.id = $1::uuid`, casamento).Scan(&conta)
	return contaVisivel(e, conta, err)
}

// ideiaEContaVisiveis: a ideia (conta nula = de todas as marcas) e a conta da peça nova (p_account) têm de ser
// de contas que quem pede vê — a função criaria a peça na conta do parâmetro sem olhar pode_ver_conta.
func ideiaEContaVisiveis(ctx context.Context, tx pgx.Tx, e *autz.Escopo, args map[string]json.RawMessage) error {
	ideia, _ := comoTexto(args["p_ideia"])
	conta, _ := comoTexto(args["p_account"])
	if !reUUID.MatchString(ideia) || !reUUID.MatchString(conta) || !autz.PodeVerConta(e, conta) {
		return autz.ErrNegado
	}
	var daIdeia *string
	err := tx.QueryRow(ctx, `select account_id::text from conteudo_ideias where id = $1::uuid`, ideia).Scan(&daIdeia)
	if err == nil && daIdeia == nil {
		return nil // de todas as marcas
	}
	var c string
	if daIdeia != nil {
		c = *daIdeia
	}
	return contaVisivel(e, c, err)
}
```

**(b) Testes de aceitação** (`rpc_test.go`, código abaixo)
- `TestPortoesIguaisAsFuncoes`: para cada pessoa do mundo e uma sem perfil, cada função (e o gatilho) chamada como ela numa transação desfeita: negada = P0001 com a frase do portão daquela função; `Aprovador`/`Conteudista` têm de dar o MESMO, com pelo menos 5 permitidas e 4 negadas por função.
- `TestRPCsDoConteudo` (pela cadeia real; negados "intactos"): aprovar/decidir/casar/reavisar peça de A2 por quem só vê A1 → 403; peça e sugestão e ideia inexistentes ou id inválido → 403 igual; editor aprovando → 403; impersonado → 403 (com a frase do "entrar como" quando o alvo passaria no portão); `chaveConteudo` casando → 403 (a função lê `features`); ideia de A2 em A1 e ideia geral em A2 → 403; lista vazia reavisando → 403; e as frases das funções (`Esta peca nao tem data marcada…`, `Decisao invalida: talvez…`, `…alguem ja decidiu…`, `Informe o link ou o codigo do post.`, `Esse post ja esta ligado a outra peca.`, `Esta ideia ja virou peca.`, `So da para reavisar…`) com 400; parâmetro obrigatório faltando → 400. Permitidos com efeito: aprovar já agendando (status, `aprovado_por`, aviso limpo, trilha `aprovou,mudou_status`), `soAprovar` reprovando a de A2 com motivo (paridade), casar pelo link do reel (`ABC123`), confirmar a sugestão (a peça vira `publicada` com o `ig_media_id`), a sugestão já decidida → 400, a ideia geral virando peça em A1, admin decidindo em A2, reavisar (aviso limpo + evento).
- `TestDecisaoSimultanea`: dois aprovadores, a mesma peça, ao mesmo tempo → um 200 e um 400, UMA decisão na trilha.
- Mutações que têm de reprovar: `Conteudista` com `e.Ativo`; `Aprovador` com `e.Chaves` em vez de `e.Modulo` (`chaveConteudo`/`soAprovar` divergem da função); tirar um `Conferir`; `SoSessaoPropria: false` numa função (o impersonado grava); `pecaDoParametro` lendo a regra de Ler inteira em vez da conta (o caso de paridade do `soAprovar` reprova).

```go
package conteudo

import (
	"context"
	"errors"
	"net/http"
	"sync"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/autz"
	"github.com/rbv-co/social-dashboard/api/internal/banco"
	"github.com/rbv-co/social-dashboard/api/internal/rpc"
	"github.com/rbv-co/social-dashboard/api/internal/testebanco/mundoteste"
)

// montarRPCs monta a lista como web.Rotas, no grupo de domínio.
func montarRPCs(r chi.Router, p *pgxpool.Pool) {
	reg, err := rpc.Novo(p, FuncoesRPC...)
	deve(err)
	r.Post("/rpc/{nome}", reg.ServeHTTP)
}

const idSemPerfil = "a5910000-0000-4000-a000-000000000099" // só em usuarios

var errDesfazer = errors.New("desfazer")

// O portão do Go = a checagem de dentro de cada função de produção (e do gatilho), pessoa por pessoa:
// permitida = a função roda sem erro (a transação é desfeita); negada = P0001 com a frase do portão dela.
// As funções são SECURITY DEFINER: o desativado PASSA nelas (a subconsulta em profiles não vê a RLS), e passa
// em Conteudista/Aprovador também — a sessão dele nem existe (auth.Exigir).
func TestPortoesIguaisAsFuncoes(t *testing.T) {
	m := novoMundo(t)
	ctx := context.Background()
	if _, err := m.P.Exec(ctx, `insert into usuarios (id, email) values ($1::uuid, 'semperfil@x.com')`, idSemPerfil); err != nil {
		t.Fatal(err)
	}
	ids := map[string]string{"semPerfil": idSemPerfil}
	for _, p := range pessoas {
		ids[p.Chave] = p.ID
	}
	for _, c := range []struct {
		nome, sql, frase string
		regra            autz.Regra
	}{
		{"conteudo_aprovar_e_agendar", `select conteudo_aprovar_e_agendar('` + P2 + `'::uuid)`, "Sem permissao para aprovar pecas de conteudo.", Aprovador},
		{"conteudo_casar_na_mao", `select conteudo_casar_na_mao('` + P1 + `'::uuid, 'https://www.instagram.com/p/ABC123/')`, "Voce nao tem acesso a Central de Conteudo.", Conteudista},
		{"conteudo_decidir", `select conteudo_decidir('` + P2 + `'::uuid, 'aprovada', null)`, "Sem permissao para aprovar ou reprovar pecas de conteudo.", Aprovador},
		{"conteudo_decidir_casamento", `select conteudo_decidir_casamento('` + CS1 + `'::uuid, true)`, "Sem permissao na Central de Conteudo.", Conteudista},
		{"conteudo_ideia_virar_peca", `select conteudo_ideia_virar_peca('` + I1 + `'::uuid, '` + A1 + `'::uuid, null)`, "Sem permissao na Central de Conteudo.", Conteudista},
		{"conteudo_reavisar", `select conteudo_reavisar('` + P4 + `'::uuid)`, "Sem permissao na Central de Conteudo.", Conteudista},
		// a guarda das rotas de peça (PATCH de status): mesmo portão de quem aprova
		{"gatilho conteudo_guarda_aprovacao", `update conteudo_pecas set status = 'aprovada' where id = '` + P2 + `'`, "Sem permissao para aprovar pecas de conteudo.", Aprovador},
	} {
		var permitidas, negadas int
		for quem, id := range ids {
			e, err := autz.CarregarEscopo(ctx, m.P, id)
			if err != nil {
				t.Fatal(err)
			}
			err = banco.ComUsuario(ctx, m.P, id, func(tx pgx.Tx) error {
				if _, err := tx.Exec(ctx, c.sql); err != nil {
					return err
				}
				return errDesfazer
			})
			naFuncao := true
			if pg := (*pgconn.PgError)(nil); errors.As(err, &pg) {
				if pg.Code != "P0001" || pg.Message != c.frase {
					t.Fatalf("%s como %s: erro inesperado da função: %v", c.nome, quem, err)
				}
				naFuncao = false
			} else if !errors.Is(err, errDesfazer) {
				t.Fatalf("%s como %s: erro inesperado: %v", c.nome, quem, err)
			}
			if naFuncao {
				permitidas++
			} else {
				negadas++
			}
			if no := c.regra(e); no != naFuncao {
				t.Errorf("%s como %s: o portão do Go = %t, a função %t", c.nome, quem, no, naFuncao)
			}
		}
		if permitidas < 5 || negadas < 4 {
			t.Errorf("%s: o mundo tem de mostrar os dois lados: %d permitidas, %d negadas", c.nome, permitidas, negadas)
		}
	}
}

func TestRPCsDoConteudo(t *testing.T) {
	m := novoMundo(t, montarRPCs)
	inexistente := "a5930000-0000-4000-a000-0000000000ff"
	rpcDe := func(nome string) string { return "/rpc/" + nome }
	intacto(t, m, []mundoteste.Caso{
		// aprovar já agendando
		{Nome: "aprovar peça de A2 sem vê-la", Quem: "aprovadorA1", Metodo: "POST", Caminho: rpcDe("conteudo_aprovar_e_agendar"), Corpo: `{"p_peca":"` + P3 + `"}`, Status: 403},
		{Nome: "aprovar peça inexistente (igual)", Quem: "aprovadorA1", Metodo: "POST", Caminho: rpcDe("conteudo_aprovar_e_agendar"), Corpo: `{"p_peca":"` + inexistente + `"}`, Status: 403},
		{Nome: "aprovar com id inválido (igual)", Quem: "aprovadorA1", Metodo: "POST", Caminho: rpcDe("conteudo_aprovar_e_agendar"), Corpo: `{"p_peca":"x"}`, Status: 403},
		{Nome: "editor aprova", Quem: "conteudista", Metodo: "POST", Caminho: rpcDe("conteudo_aprovar_e_agendar"), Corpo: `{"p_peca":"` + P2 + `"}`, Status: 403},
		{Nome: "impersonado (o alvo não aprova: o portão vem antes)", Quem: "impersonado", Metodo: "POST", Caminho: rpcDe("conteudo_aprovar_e_agendar"), Corpo: `{"p_peca":"` + P2 + `"}`, Status: 403},
		{Nome: "impersonado reavisa a peça que o alvo vê", Quem: "impersonado", Metodo: "POST", Caminho: rpcDe("conteudo_reavisar"), Corpo: `{"p_peca":"` + P4 + `"}`, Status: 403, Tem: "Quem entrou como outra pessoa"},
		{Nome: "impersonado casa na mão", Quem: "impersonado", Metodo: "POST", Caminho: rpcDe("conteudo_casar_na_mao"), Corpo: `{"p_peca":"` + P1 + `","p_media":"ABC"}`, Status: 403, Tem: "Quem entrou como outra pessoa"},
		{Nome: "aprovar sem data", Quem: "aprovador", Metodo: "POST", Caminho: rpcDe("conteudo_aprovar_e_agendar"), Corpo: `{"p_peca":"` + P7 + `"}`, Status: 400, Tem: "Esta peca nao tem data marcada"},
		// decidir
		{Nome: "decidir peça de A2 sem vê-la", Quem: "aprovadorA1", Metodo: "POST", Caminho: rpcDe("conteudo_decidir"), Corpo: `{"p_peca":"` + P3 + `","p_decisao":"aprovada"}`, Status: 403},
		{Nome: "decisão fora da lista", Quem: "aprovador", Metodo: "POST", Caminho: rpcDe("conteudo_decidir"), Corpo: `{"p_peca":"` + P2 + `","p_decisao":"talvez"}`, Status: 400, Tem: "Decisao invalida: talvez"},
		{Nome: "decidir peça que não espera aprovação", Quem: "aprovador", Metodo: "POST", Caminho: rpcDe("conteudo_decidir"), Corpo: `{"p_peca":"` + P1 + `","p_decisao":"aprovada"}`, Status: 400, Tem: "alguem ja decidiu"},
		// casar na mão
		{Nome: "casar peça de A2 sem vê-la", Quem: "conteudistaA1", Metodo: "POST", Caminho: rpcDe("conteudo_casar_na_mao"), Corpo: `{"p_peca":"` + P3 + `","p_media":"ABC"}`, Status: 403},
		{Nome: "casar sem link", Quem: "conteudista", Metodo: "POST", Caminho: rpcDe("conteudo_casar_na_mao"), Corpo: `{"p_peca":"` + P1 + `","p_media":" "}`, Status: 400, Tem: "Informe o link ou o codigo do post."},
		{Nome: "casar com post de outra peça", Quem: "conteudista", Metodo: "POST", Caminho: rpcDe("conteudo_casar_na_mao"), Corpo: `{"p_peca":"` + P1 + `","p_media":"IG5"}`, Status: 400, Tem: "Esse post ja esta ligado a outra peca."},
		{Nome: "casar com a chave em permissions (a função lê features)", Quem: "chaveConteudo", Metodo: "POST", Caminho: rpcDe("conteudo_casar_na_mao"), Corpo: `{"p_peca":"` + P1 + `","p_media":"ABC"}`, Status: 403},
		// decidir casamento
		{Nome: "decidir sugestão de peça de A2", Quem: "conteudistaA1", Metodo: "POST", Caminho: rpcDe("conteudo_decidir_casamento"), Corpo: `{"p_casamento":"` + CS3 + `","p_confirma":true}`, Status: 403},
		{Nome: "decidir sugestão inexistente (igual)", Quem: "conteudistaA1", Metodo: "POST", Caminho: rpcDe("conteudo_decidir_casamento"), Corpo: `{"p_casamento":"` + inexistente + `","p_confirma":true}`, Status: 403},
		// ideia vira peça
		{Nome: "ideia de A2 vira peça em A1", Quem: "conteudistaA1", Metodo: "POST", Caminho: rpcDe("conteudo_ideia_virar_peca"), Corpo: `{"p_ideia":"` + I3 + `","p_account":"` + A1 + `"}`, Status: 403},
		{Nome: "ideia geral vira peça em A2", Quem: "conteudistaA1", Metodo: "POST", Caminho: rpcDe("conteudo_ideia_virar_peca"), Corpo: `{"p_ideia":"` + I2 + `","p_account":"` + A2 + `"}`, Status: 403},
		{Nome: "ideia inexistente (igual)", Quem: "conteudistaA1", Metodo: "POST", Caminho: rpcDe("conteudo_ideia_virar_peca"), Corpo: `{"p_ideia":"` + inexistente + `","p_account":"` + A1 + `"}`, Status: 403},
		{Nome: "ideia já usada", Quem: "conteudistaA1", Metodo: "POST", Caminho: rpcDe("conteudo_ideia_virar_peca"), Corpo: `{"p_ideia":"` + I5 + `","p_account":"` + A1 + `"}`, Status: 400, Tem: "Esta ideia ja virou peca."},
		{Nome: "sem a conta", Quem: "conteudistaA1", Metodo: "POST", Caminho: rpcDe("conteudo_ideia_virar_peca"), Corpo: `{"p_ideia":"` + I1 + `"}`, Status: 400, Tem: "falta o parâmetro p_account"},
		// reavisar
		{Nome: "reavisar peça de A2", Quem: "conteudistaA1", Metodo: "POST", Caminho: rpcDe("conteudo_reavisar"), Corpo: `{"p_peca":"` + P5 + `"}`, Status: 403},
		{Nome: "reavisar peça não agendada", Quem: "conteudistaA1", Metodo: "POST", Caminho: rpcDe("conteudo_reavisar"), Corpo: `{"p_peca":"` + P1 + `"}`, Status: 400, Tem: "So da para reavisar"},
		{Nome: "lista vazia não reavisa", Quem: "conteudistaNenhuma", Metodo: "POST", Caminho: rpcDe("conteudo_reavisar"), Corpo: `{"p_peca":"` + P4 + `"}`, Status: 403},
	})
	const peca = `select status || '|' || coalesce(ig_media_id, '-') || '|' || coalesce(aprovado_por::text, '-') || '|' || coalesce(avisado_em::text, 'nulo') from conteudo_pecas where id = '`
	const eventos = `select string_agg(acao, ',' order by id) from conteudo_eventos where peca_id = '`
	m.Rodar(t, []mundoteste.Caso{
		{Nome: "aprovar já agendando", Quem: "aprovadorA1", Metodo: "POST", Caminho: rpcDe("conteudo_aprovar_e_agendar"), Corpo: `{"p_peca":"` + P2 + `"}`,
			Status: 200, Tem: `"status":"agendada"`, Efeito: peca + P2 + `'`, Quer: "agendada|-|" + idAprovadorA1 + "|nulo"},
		{Nome: "a trilha da aprovação", Efeito: eventos + P2 + `'`, Quer: "aprovou,mudou_status"},
		{Nome: "quem só aprova continua decidindo (paridade)", Quem: "soAprovar", Metodo: "POST", Caminho: rpcDe("conteudo_decidir"),
			Corpo: `{"p_peca":"` + P3 + `","p_decisao":"reprovada","p_motivo":"Foto escura"}`, Status: 200,
			Efeito: `select status || '|' || motivo_reprovacao from conteudo_pecas where id = '` + P3 + `'`, Quer: "reprovada|Foto escura"},
		{Nome: "casar na mão pelo link", Quem: "conteudistaA1", Metodo: "POST", Caminho: rpcDe("conteudo_casar_na_mao"),
			Corpo: `{"p_peca":"` + P1 + `","p_media":"https://www.instagram.com/reel/ABC123/?igsh=x"}`, Status: 200,
			Efeito: `select status || '|' || ig_media_id from conteudo_pecas where id = '` + P1 + `'`, Quer: "publicada|ABC123"},
		{Nome: "confirmar a sugestão", Quem: "conteudistaA1", Metodo: "POST", Caminho: rpcDe("conteudo_decidir_casamento"),
			Corpo: `{"p_casamento":"` + CS1 + `","p_confirma":true}`, Status: 200, Tem: `"situacao":"confirmado"`,
			Efeito: `select status || '|' || ig_media_id from conteudo_pecas where id = '` + P4 + `'`, Quer: "publicada|IG41"},
		{Nome: "a sugestão já decidida", Quem: "conteudistaA1", Metodo: "POST", Caminho: rpcDe("conteudo_decidir_casamento"),
			Corpo: `{"p_casamento":"` + CS1 + `","p_confirma":false}`, Status: 400, Tem: "Esta sugestao ja foi decidida."},
		{Nome: "ideia geral vira peça na própria conta", Quem: "conteudistaA1", Metodo: "POST", Caminho: rpcDe("conteudo_ideia_virar_peca"),
			Corpo: `{"p_ideia":"` + I2 + `","p_account":"` + A1 + `","p_publicar_em":"2026-11-02T15:00:00Z"}`, Status: 200, Tem: `"status":"rascunho"`,
			Efeito: `select situacao || '|' || (select account_id::text from conteudo_pecas pc where pc.id = i.peca_id) from conteudo_ideias i where id = '` + I2 + `'`, Quer: "usada|" + A1},
		{Nome: "admin decide em A2", Quem: "adminA1", Metodo: "POST", Caminho: rpcDe("conteudo_decidir_casamento"),
			Corpo: `{"p_casamento":"` + CS3 + `","p_confirma":false}`, Status: 200, Tem: `"situacao":"recusado"`},
	})
	// reavisar (P4 já foi publicada acima: usa uma peça agendada nova)
	if _, err := m.P.Exec(context.Background(), `insert into conteudo_pecas (id, account_id, titulo, formato, status, publicar_em, avisado_em)
		values ('a5930000-0000-4000-a000-0000000000c8', '`+A1+`', 'Agendada', 'feed', 'agendada', now(), now())`); err != nil {
		t.Fatal(err)
	}
	m.Rodar(t, []mundoteste.Caso{{Nome: "reavisar", Quem: "conteudistaA1", Metodo: "POST", Caminho: rpcDe("conteudo_reavisar"),
		Corpo: `{"p_peca":"a5930000-0000-4000-a000-0000000000c8"}`, Status: 200,
		Efeito: `select coalesce(avisado_em::text, 'nulo') || '|' || (select string_agg(acao, ',') from conteudo_eventos where peca_id = 'a5930000-0000-4000-a000-0000000000c8')
			from conteudo_pecas where id = 'a5930000-0000-4000-a000-0000000000c8'`, Quer: "nulo|reavisar"}})
}

// Dois aprovadores decidindo a MESMA peça ao mesmo tempo: um passa, o outro recebe a frase do trinco da função
// (sem impasse: a conferência não trava a linha) e a trilha tem UMA decisão.
func TestDecisaoSimultanea(t *testing.T) {
	m := novoMundo(t, montarRPCs)
	var wg sync.WaitGroup
	st := make([]int, 2)
	comeca := make(chan struct{})
	for i, quem := range []string{"aprovador", "aprovadorA1"} {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-comeca
			st[i], _ = m.Pedir(t, quem, "POST", "/rpc/conteudo_decidir", `{"p_peca":"`+P2+`","p_decisao":"aprovada"}`)
		}()
	}
	close(comeca)
	wg.Wait()
	if !(st[0] == http.StatusOK && st[1] == http.StatusBadRequest) && !(st[0] == http.StatusBadRequest && st[1] == http.StatusOK) {
		t.Errorf("status = %v, esperava um 200 e um 400", st)
	}
	if v := m.Um(t, `select count(*)::text from conteudo_eventos where peca_id = '`+P2+`' and acao = 'aprovou'`); v != "1" {
		t.Errorf("decisões na trilha = %s", v)
	}
}
```

**(c) Arquivos:** Create `api/internal/conteudo/rpc.go`, `api/internal/conteudo/rpc_test.go`.

**(d) Dependências:** Tasks 1, 3 e 5 (ver acima); `rpc.Novo`, `rpc.Funcao.Conferir/SoSessaoPropria` (5.7).

- [ ] **Step 1:** Testes; ver falhar. - [ ] **Step 2:** Implementar (código de (a)). - [ ] **Step 3:** `cd api && gofmt -l ./internal && go vet ./internal/conteudo/ && go test -count=1 -race ./internal/conteudo/` PASS; mutações reprovam. - [ ] **Step 4:** Commit `feat(api): as 6 RPCs do Conteúdo com o portão de cada função e a conta do parâmetro conferida` (+ `Co-Authored-By`).

---

### Task 8: `POST /conteudo-trigger` — a fila sem GitHub, com as validações e o teto da edge, idempotente

**Revisor:** opus. **Depende de:** 3 (`PedeIA`, `comoTexto`, `reUUID`, `responder`, `soSessaoPropria`, mundo), 4 (`montarLeituras`, num caso do teste), 5 (o ajudante de teste `intacto`; em worktree paralela, copie-o e apague no merge).

**(a) Contrato** (`supabase/functions/conteudo-trigger/index.ts` portada SEM o despacho ao GitHub: COORDENACAO 12/10 23:10 (b), Ruling 5.9-12)
- `POST /conteudo-trigger` (`_pedirAIA`, `dados-conteudo.js:363-375`; chamada por `pedirIdeiasParaIA :353` e `pedirSemanaParaIA :359`), no grupo de domínio. Corpo `{account_id, quantas?, modo?, segunda?}`; resposta `200 {"job_id": …, "quantas": n}` — a mesma da edge, que a tela já lê (`visao-ideias.vue:161`, `painel-semana.vue:182`).
- Ordem: `auth.Exigir` (401) → `autz.ComEscopo` → `soPedeIA` (`403 {"error":"sem_permissao"}`, o corpo da edge) → `soSessaoPropria` (403 com a frase) → `dados.LerCorpo` (campo a mais = `400 corpo_invalido`; a edge ignorava) → `account_id` uuid (texto; maiúscula vira minúscula como a edge aceitava; senão `400 {"error":"conta_invalida"}`) → `autz.PodeVerConta` (`403 sem_permissao`: a edge não olhava a conta, achado 3) → transação `banco.ComUsuario`: trava consultiva da conta (`pg_advisory_xact_lock`), conta existe (senão `400 conta_invalida`: a edge deixava a FK estourar em `500 insert_falhou`), job `enfileirado|rodando` da conta nos últimos 3 min → `409 {"error":"ja_rodando","job_id":…}`, senão `insert` → 200.
- `quantas` = a fórmula da edge (`Math.min(Math.max(Number(q) || 12, 1), 20)`, número ou texto numérico) e depois TRUNCADA para inteiro (`3.7` → `3`): a edge gravava `3.7`, e o workflow apagava o ponto (`${QUANTAS//[^0-9]/}` = `37`), furando o teto de 20 (achado 3). `modo` = lista fechada (`semana` ou `ideias`). `segunda` = `AAAA-MM-DD` de uma data que EXISTE, senão `null` (o robô usa a próxima segunda; `2026-02-30` derrubava o `new Date` dele). `params` = `{"quantas": n}` ou `{"segunda": …}`, como a edge.
- O job nasce `enfileirado`, `criado_por` = a sessão, `github_run_id` nulo; quem o pega é o vigia da VPS (seção da trilha C). Nada de `dispatch_falhou`: a API não chama o GitHub. Erro do banco = `500 {"error":"insert_falhou"}` SEM `detail` (a edge devolvia a mensagem do PostgREST); o motivo vai ao log.
- `conteudo_jobs` só a chave de serviço gravava (`conteudo_jobs_srv`): a escrita é SQL explícito atrás do portão da edge, como as edges da Fábrica (Ruling 5.8-3); o catálogo compila `service_role` como `false`, então "o catálogo" sozinho negaria o que a edge faz (Ruling 5.9-11).
- Dois cliques no MESMO instante: a trava consultiva (`hashtextextended('conteudo-trigger:' || conta, 0)`, até o fim da transação) põe os pedidos em fila; em READ COMMITTED o segundo enxerga o job do primeiro, já comitado, e recebe `409 ja_rodando` com o id dele. Sem a trava, a janela da edge (ler e depois inserir) deixava passar dois jobs — dois robôs pagos.
- **Ensaiado** (worktree sobre o `origin/main` 448c1356 + Tasks 1–7): os três testes passam com `-race`; sem a trava consultiva o `TestGatilhoCliqueDuplo` reprova na 1ª rodada com 2 jobs; sem o `PodeVerConta` a "conta que não vê" grava (`200` e a foto muda); sem a conferência de existência a conta inexistente vira `500 insert_falhou`.

`api/internal/conteudo/gatilho.go`:

```go
package conteudo

import (
	"encoding/json"
	"errors"
	"log/slog"
	"math"
	"net/http"
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
	// maxPorRodada: o teto da edge (MAX_POR_RODADA): cada ideia é token de Opus.
	maxPorRodada  = 20
	quantasPadrao = 12
	// minutosEntreRodadas: uma rodada por vez por marca (MINUTOS_ENTRE_RODADAS da edge).
	minutosEntreRodadas = 3
)

// pedidoGatilho: o corpo de _pedirAIA (dados-conteudo.js:353-375): {account_id, quantas, modo} ou
// {account_id, modo: 'semana', segunda}. Campo a mais = 400 (dados.LerCorpo); a edge o ignorava.
type pedidoGatilho struct {
	AccountID json.RawMessage `json:"account_id"`
	Quantas   json.RawMessage `json:"quantas"`
	Modo      json.RawMessage `json:"modo"`
	Segunda   json.RawMessage `json:"segunda"`
}

// quantasDoPedido: `Math.min(Math.max(Number(body.quantas) || 12, 1), 20)` da edge e, DEPOIS, truncado para
// inteiro: a edge deixava 3.7 passar, e o workflow apagava o ponto (`${QUANTAS//[^0-9]/}` = "37"), furando o
// teto (achado 3). Número ou texto numérico (Number("15") = 15); o resto (ausente, null, "abc", 0) vale 12.
func quantasDoPedido(v json.RawMessage) int {
	var f float64
	var s string
	switch {
	case json.Unmarshal(v, &f) == nil:
	case json.Unmarshal(v, &s) == nil:
		f, _ = strconv.ParseFloat(strings.TrimSpace(s), 64)
	}
	if f == 0 || math.IsNaN(f) {
		f = quantasPadrao
	}
	return int(math.Min(math.Max(f, 1), maxPorRodada)) // int() trunca: 3.7 → 3
}

// segundaDoPedido: "AAAA-MM-DD" de uma data que existe; senão nula (o robô usa a próxima segunda). A edge só
// conferia o formato; uma data impossível derrubava o robô (new Date inválido).
func segundaDoPedido(v json.RawMessage) any {
	s, ok := comoTexto(v)
	if !ok {
		return nil
	}
	if _, err := time.Parse("2006-01-02", s); err != nil {
		return nil
	}
	return s
}

// Gatilho: POST /conteudo-trigger — o da edge supabase/functions/conteudo-trigger/index.ts SEM o despacho ao
// GitHub (COORDENACAO 12/10 23:10 (b)): grava o pedido em conteudo_jobs ('enfileirado') e o vigia da VPS
// (coletor/vps/conteudo-vigia.sh, trilha C) o pega da fila. Portão (PedeIA) e "entrar como" na montagem.
// conteudo_jobs só a chave de serviço gravava (conteudo_jobs_srv): a escrita é SQL explícito atrás do portão
// da edge, como as edges da Fábrica (Ruling 5.8-3, 5.9-11).
type Gatilho struct{ Pool *pgxpool.Pool }

func (g *Gatilho) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	e := autz.EscopoDo(r.Context())
	if e == nil {
		dados.Erro(w, http.StatusInternalServerError, "erro_interno", "")
		return
	}
	var c pedidoGatilho
	if !dados.LerCorpo(w, r, &c) {
		return
	}
	conta, _ := comoTexto(c.AccountID)
	conta = strings.ToLower(conta)
	if !reUUID.MatchString(conta) {
		responder(w, http.StatusBadRequest, map[string]string{"error": "conta_invalida"})
		return
	}
	// a conta que a pessoa não vê: a edge não olhava (gastava IA na marca de outro e gravava o job dela).
	// Ruling 5.9-11.
	if !autz.PodeVerConta(e, conta) {
		responder(w, http.StatusForbidden, map[string]string{"error": "sem_permissao"})
		return
	}
	quantas := quantasDoPedido(c.Quantas)
	modo, params := "ideias", map[string]any{"quantas": quantas}
	if s, _ := comoTexto(c.Modo); s == "semana" { // lista fechada: o valor escolhe o robô do vigia
		modo, params = "semana", map[string]any{"segunda": segundaDoPedido(c.Segunda)}
	}
	j, err := json.Marshal(params)
	if err != nil {
		dados.Erro(w, http.StatusInternalServerError, "erro_interno", "")
		return
	}
	ctx := r.Context()
	var job, emAndamento string
	existe := false
	err = banco.ComUsuario(ctx, g.Pool, e.ID, func(tx pgx.Tx) error {
		// Uma rodada por vez por marca TAMBÉM com dois cliques no mesmo instante: a trava consultiva da conta
		// (até o fim da transação) põe os pedidos em fila; o segundo vê o job do primeiro, já comitado.
		if _, err := tx.Exec(ctx, `select pg_advisory_xact_lock(hashtextextended('conteudo-trigger:' || $1::text, 0))`, conta); err != nil {
			return err
		}
		if err := tx.QueryRow(ctx, `select exists (select 1 from accounts where id = $1::uuid)`, conta).Scan(&existe); err != nil || !existe {
			return err
		}
		err := tx.QueryRow(ctx, `select id::text from conteudo_jobs where account_id = $1::uuid
			and status in ('enfileirado', 'rodando') and created_at >= now() - make_interval(mins => $2::int)
			order by created_at desc limit 1`, conta, minutosEntreRodadas).Scan(&emAndamento)
		if !errors.Is(err, pgx.ErrNoRows) {
			return err // nil: já tem rodada; responde ja_rodando
		}
		return tx.QueryRow(ctx, `insert into conteudo_jobs (tipo, account_id, params, criado_por)
			values ($1::text, $2::uuid, $3::jsonb, $4::uuid) returning id::text`, modo, conta, string(j), e.ID).Scan(&job)
	})
	switch {
	case err != nil:
		slog.Error("conteudo-trigger: gravar o pedido", "conta", conta, "erro", err.Error())
		responder(w, http.StatusInternalServerError, map[string]string{"error": "insert_falhou"})
	case !existe:
		responder(w, http.StatusBadRequest, map[string]string{"error": "conta_invalida"})
	case emAndamento != "":
		responder(w, http.StatusConflict, map[string]string{"error": "ja_rodando", "job_id": emAndamento})
	default:
		slog.Info("conteudo-trigger: pedido na fila", "job", job, "modo", modo, "conta", conta)
		responder(w, http.StatusOK, map[string]any{"job_id": job, "quantas": quantas})
	}
}

// montarGatilho: o portão da edge (PedeIA) ANTES do "entrar como" (quem não pede IA recebe o 403 da edge,
// sem a frase), e "entrar como" só lê.
func montarGatilho(r chi.Router, p *pgxpool.Pool) {
	r.With(soPedeIA, soSessaoPropria).Post("/conteudo-trigger", (&Gatilho{Pool: p}).ServeHTTP)
}

// soPedeIA: depois de autz.ComEscopo. Sem escopo (rota montada fora do grupo) nega: falha fechada.
func soPedeIA(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !PedeIA(autz.EscopoDo(r.Context())) {
			responder(w, http.StatusForbidden, map[string]string{"error": "sem_permissao"})
			return
		}
		next.ServeHTTP(w, r)
	})
}
```

**(b) Testes de aceitação** (`gatilho_test.go`, código abaixo; "intacto" = foto das 9 tabelas igual)
- `TestQuantasDoPedido` (puro): ausente, `null`, `0`, `"abc"`, `""`, `true`, `{}` → 12; `5` → 5; `"15"` → 15; `25` e `"1e3"` → 20; `-5` e `0.5` → 1; `3.7` → 3; `19.99` → 19. `segunda`: `"2026-10-19"` passa; `"2026-02-30"`, `"2026-10-19x"`, `null` e número → nula.
- `TestGatilho`: negados e intactos — sem módulo nem chave (403 `sem_permissao`), só `conteudo.aprovar` (403), desativado e sem sessão (401), impersonado (403 com a frase), conta que não vê (403), lista vazia (403), conta que não é uuid, 36 hífens (a regex da edge aceitava), conta inexistente e conta como número (400 `conta_invalida`), campo desconhecido (400 `corpo_invalido`). Permitidos com efeito — `3.7` vira `{"quantas": 3}` com `criado_por` da sessão; a segunda rodada na mesma marca (outro modo, outra pessoa) → `409` com o id do primeiro e nenhum job novo; a semana em A2 (uuid em maiúscula) por quem vê todas, com data impossível → `{"segunda": null}`; depois de 4 min o pedido preso não segura a marca; `chaveConteudo` pede (a edge aceitava a chave em `permissions`) mas não LÊ o job (`GET /conteudo/jobs` → `[]`: as policies leem `features`).
- `TestGatilhoCliqueDuplo`: 20 rodadas de dois pedidos simultâneos na mesma marca → sempre 1 job, um 200 e um 409, os dois corpos com o MESMO `job_id`.
- Mutações que têm de reprovar: tirar a trava consultiva (2 jobs — ensaiado); tirar o `PodeVerConta` (a conta que não vê grava — ensaiado); tirar a conferência de `accounts` (500 em vez de 400 — ensaiado); `PedeIA` sem `e.Chaves["conteudo"]` (o pedido de `chaveConteudo` vira 403); tirar o `math.Min` do teto (`25` → 25); `soSessaoPropria` fora da montagem (o impersonado grava).

`api/internal/conteudo/gatilho_test.go`:

```go
package conteudo

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"sync"
	"testing"

	"github.com/rbv-co/social-dashboard/api/internal/testebanco/mundoteste"
)

func TestQuantasDoPedido(t *testing.T) {
	for entrada, quer := range map[string]int{
		``: 12, `null`: 12, `0`: 12, `"abc"`: 12, `""`: 12, `5`: 5, `"15"`: 15, `25`: 20, `-5`: 1, `0.5`: 1,
		`3.7`: 3, `19.99`: 19, `"1e3"`: 20, `true`: 12, `{}`: 12,
	} {
		if n := quantasDoPedido(json.RawMessage(entrada)); n != quer {
			t.Errorf("quantas %s = %d, esperava %d", entrada, n, quer)
		}
	}
	for entrada, quer := range map[string]any{`"2026-10-19"`: "2026-10-19", `"2026-02-30"`: nil, `"2026-10-19x"`: nil, `null`: nil, `20261019`: nil} {
		if v := segundaDoPedido(json.RawMessage(entrada)); v != quer {
			t.Errorf("segunda %s = %v, esperava %v", entrada, v, quer)
		}
	}
}

func TestGatilho(t *testing.T) {
	m := novoMundo(t, montarGatilho, montarLeituras)
	pedido := func(conta, resto string) string { return `{"account_id":"` + conta + `"` + resto + `}` }
	intacto(t, m, []mundoteste.Caso{
		{Nome: "sem o módulo nem a chave", Quem: "semModulo", Metodo: "POST", Caminho: "/conteudo-trigger", Corpo: pedido(A1, ""), Status: 403, Tem: `"error":"sem_permissao"`},
		{Nome: "só conteudo.aprovar", Quem: "soAprovar", Metodo: "POST", Caminho: "/conteudo-trigger", Corpo: pedido(A1, ""), Status: 403},
		{Nome: "desativado", Quem: "desativado", Metodo: "POST", Caminho: "/conteudo-trigger", Corpo: pedido(A1, ""), Status: 401},
		{Nome: "sem sessão", Quem: "", Metodo: "POST", Caminho: "/conteudo-trigger", Corpo: pedido(A1, ""), Status: 401},
		{Nome: "impersonado", Quem: "impersonado", Metodo: "POST", Caminho: "/conteudo-trigger", Corpo: pedido(A1, ""), Status: 403, Tem: "Quem entrou como outra pessoa"},
		{Nome: "conta que não vê", Quem: "conteudistaA1", Metodo: "POST", Caminho: "/conteudo-trigger", Corpo: pedido(A2, `,"quantas":5`), Status: 403, Tem: `"error":"sem_permissao"`},
		{Nome: "lista vazia", Quem: "conteudistaNenhuma", Metodo: "POST", Caminho: "/conteudo-trigger", Corpo: pedido(A1, ""), Status: 403},
		{Nome: "conta que não é uuid", Quem: "conteudista", Metodo: "POST", Caminho: "/conteudo-trigger", Corpo: pedido("abc", ""), Status: 400, Tem: `"error":"conta_invalida"`},
		{Nome: "36 hífens (a regex da edge aceitava)", Quem: "conteudista", Metodo: "POST", Caminho: "/conteudo-trigger", Corpo: pedido(strings.Repeat("-", 36), ""), Status: 400, Tem: "conta_invalida"},
		{Nome: "conta que não existe", Quem: "conteudista", Metodo: "POST", Caminho: "/conteudo-trigger", Corpo: pedido(A9, ""), Status: 400, Tem: "conta_invalida"},
		{Nome: "conta como número", Quem: "conteudista", Metodo: "POST", Caminho: "/conteudo-trigger", Corpo: `{"account_id":5}`, Status: 400, Tem: "conta_invalida"},
		{Nome: "campo desconhecido", Quem: "conteudista", Metodo: "POST", Caminho: "/conteudo-trigger", Corpo: pedido(A1, `,"robo":"x"`), Status: 400, Tem: "corpo_invalido"},
	})
	const job = `select tipo || '|' || status || '|' || params::text || '|' || criado_por::text from conteudo_jobs where id = $1::uuid`
	var primeiro struct {
		JobID   string `json:"job_id"`
		Quantas int    `json:"quantas"`
	}
	st, b := m.Pedir(t, "conteudistaA1", "POST", "/conteudo-trigger", pedido(A1, `,"quantas":3.7,"modo":"ideias"`))
	if st != 200 || json.Unmarshal([]byte(b), &primeiro) != nil || primeiro.Quantas != 3 {
		t.Fatalf("pedir ideias: %d %s", st, b)
	}
	if v := m.Um(t, job, primeiro.JobID); v != `ideias|enfileirado|{"quantas": 3}|`+idConteudistaA1 {
		t.Errorf("o job = %s", v)
	}
	m.Rodar(t, []mundoteste.Caso{
		{Nome: "segunda rodada na mesma marca (outro modo, outra pessoa)", Quem: "conteudista", Metodo: "POST", Caminho: "/conteudo-trigger",
			Corpo: pedido(A1, `,"modo":"semana","segunda":"2026-10-19"`), Status: 409, Tem: `{"error":"ja_rodando","job_id":"` + primeiro.JobID + `"}`,
			Efeito: `select count(*)::text from conteudo_jobs where account_id = '` + A1 + `'`, Quer: "2"}, // J1 (concluído) + o novo
		{Nome: "a semana em A2 por quem vê todas", Quem: "conteudista", Metodo: "POST", Caminho: "/conteudo-trigger",
			Corpo: pedido(strings.ToUpper(A2), `,"modo":"semana","segunda":"2026-02-30"`), Status: 200, Tem: `"quantas":12`,
			Efeito: `select tipo || '|' || params::text from conteudo_jobs where account_id = '` + A2 + `' and status = 'enfileirado'`, Quer: `semana|{"segunda": null}`},
	})
	// a janela da edge: rodada presa há mais de 3 min não segura a marca; concluída não conta
	if _, err := m.P.Exec(context.Background(), `update conteudo_jobs set created_at = now() - interval '4 minutes' where id = $1::uuid`, primeiro.JobID); err != nil {
		t.Fatal(err)
	}
	m.Rodar(t, []mundoteste.Caso{
		{Nome: "a chave em permissions pede (a edge aceitava)", Quem: "chaveConteudo", Metodo: "POST", Caminho: "/conteudo-trigger",
			Corpo: pedido(A1, `,"quantas":"15"`), Status: 200, Tem: `"quantas":15`},
		{Nome: "quem pediu com a chave não LÊ o job (as policies leem features)", Quem: "chaveConteudo", Metodo: "GET", Caminho: "/conteudo/jobs", Status: 200, Tem: "[]"},
	})
}

// Dois cliques no MESMO instante: um job só; o outro clique recebe ja_rodando com o id dele. 20 rodadas.
func TestGatilhoCliqueDuplo(t *testing.T) {
	m := novoMundo(t, montarGatilho)
	ctx := context.Background()
	for rodada := range 20 {
		if _, err := m.P.Exec(ctx, `delete from conteudo_jobs where account_id = $1::uuid`, A1); err != nil {
			t.Fatal(err)
		}
		var wg sync.WaitGroup
		st, corpo := make([]int, 2), make([]string, 2)
		comeca := make(chan struct{})
		for i, quem := range []string{"conteudista", "conteudistaA1"} {
			wg.Add(1)
			go func() {
				defer wg.Done()
				<-comeca
				st[i], corpo[i] = m.Pedir(t, quem, "POST", "/conteudo-trigger", `{"account_id":"`+A1+`","quantas":12}`)
			}()
		}
		close(comeca)
		wg.Wait()
		n := m.Um(t, `select count(*)::text from conteudo_jobs where account_id = $1::uuid`, A1)
		ok := (st[0] == http.StatusOK && st[1] == http.StatusConflict) || (st[0] == http.StatusConflict && st[1] == http.StatusOK)
		if !ok || n != "1" {
			t.Fatalf("rodada %d: %v %v, %s jobs", rodada, st, corpo, n)
		}
		id := m.Um(t, `select id::text from conteudo_jobs where account_id = $1::uuid`, A1)
		if !strings.Contains(corpo[0]+corpo[1], `"job_id":"`+id+`"`) || strings.Count(corpo[0]+corpo[1], id) != 2 {
			t.Fatalf("rodada %d: os dois cliques não falam do mesmo job %s: %v", rodada, id, corpo)
		}
	}
}
```

**(c) Arquivos:** Create `api/internal/conteudo/gatilho.go`, `api/internal/conteudo/gatilho_test.go`.

**(d) Dependências:** Tasks 3, 4 e 5 (ver acima). Não usa `internal/github` (o 5.8 não é dependência).

- [ ] **Step 1:** Testes; ver falhar. - [ ] **Step 2:** Implementar (código de (a)). - [ ] **Step 3:** `cd api && gofmt -l ./internal && go vet ./internal/conteudo/ && go test -count=1 -race ./internal/conteudo/` PASS; mutações reprovam. - [ ] **Step 4:** Commit `feat(api): POST /conteudo-trigger grava o pedido na fila do robô (portão e teto da edge, conta visível, um job por clique duplo)` (+ `Co-Authored-By`).

---

### Task 9: Montagem, varreduras, `conferir` e notas

**Revisor:** opus. **Depende de:** 4–8.

**(a) Contrato**
- `conteudo.Montar(r, p)` registra **7 leituras e 14 escritas** (13 de catálogo e o `POST /conteudo-trigger`) no grupo de DOMÍNIO de `web.Rotas` (`auth.Exigir` → `comPrazo(PrazoDominio)` → `autz.ComEscopo`): nada aqui chama fora do banco, os 30 s do grupo bastam. As 6 RPCs entram por `web.FuncoesRPC` (`conteudo.FuncoesRPC`, Plano 5.9) e SAEM de `RPCPendentes` no mesmo commit (a montagem recusa o nome nos dois lugares; `TestListasDeRPCFecham` confere a soma das 92).
- `web/rotas.go`: import `conteudo` (já importado por `cmd/api`, sem ciclo: pré-voo), `conteudo.FuncoesRPC, // Plano 5.9` em `FuncoesRPC` e `conteudo.Montar(r, p) // Plano 5.9` no grupo de domínio, depois do `trafego.Montar`.
- Varreduras pela cadeia real (as do 5.7 são o modelo): vazamento por conta nas 6 leituras com a restritiva (as filhas pela peça; `concorrentes` é a exceção do Ruling 5.9-5); "entrar como" sem escrita nas 14 rotas e nas 6 RPCs; e os corpos da varredura VALEM (quem pode recebe 2xx), senão a varredura passaria com pedidos que nem chegariam a gravar.
- `cmd/api/conferir.go`: o que as rotas, as RPCs e a fila presumem no banco restaurado (colunas, tipos, a função e o gatilho da guarda). As 6 RPCs NÃO entram em `funcoesDoWorker`: o `conferirRPC` (5.0) já confere cada função de `web.FuncoesRPC` contra o `pg_proc` (nomes, tipos, DEFAULT × `Opcional`, retorno, EXECUTE de `authenticated`). Por isso a fixture `esquemaCompleto` passa a criar as funções de `web.FuncoesRPC` pela PRÓPRIA declaração (`Opcional` = `default null`): sem isso, `p_motivo`/`p_publicar_em` sem DEFAULT fazem todo teste do `conferir` acusar a declaração (ensaiado).
- **Ensaiado** (worktree sobre o `origin/main` 448c1356 + Tasks 1–8): `go test -race ./...` inteiro verde, 0 SKIP; tirar o `soSessaoPropria` do `POST /conteudo/blocos` faz `TestEscritasRecusamImpersonado` acusar `201`; tirar `t.account_id` de `colunasIdeia` faz o lado positivo acusar "adminA1 não viu A2"; um erro de digitação numa coluna de `conteudo_jobs` ou no nome do gatilho faz `TestConferirNaFatiaD0NaoAcusaOPlano59` reprovar.

`api/internal/conteudo/rotas.go`:

```go
package conteudo

import (
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Montar registra as rotas do 5.9 no grupo de DOMÍNIO de web.Rotas (depois de auth.Exigir e de
// autz.ComEscopo): 7 leituras, 13 escritas de catálogo e POST /conteudo-trigger. As 6 RPCs entram por
// FuncoesRPC. Declaração errada derruba a subida. Rota nova entra sozinha nas varreduras de rotas_test.go.
func Montar(r chi.Router, p *pgxpool.Pool) {
	montarLeituras(r, p)
	montarPecas(r, p)
	montarPauta(r, p)
	montarGatilho(r, p)
}
```

**(b) Testes de aceitação**
- `conteudo/rotas_test.go` (código abaixo): `TestNadaVazaEntreContas` (6 leituras varridas por `conteudistaA1`, `impersonado` e `conteudistaNenhuma`, sem filtro, com `?account_id=<A2>` e com `contar=1` → nenhum uuid de A2 e `X-Total-Count: 0`; a lista vazia não vê A1; `adminA1` vê A2 em cada uma; contagem exata `7 = 6 + 1` e 14 escritas), `TestEscritasRecusamImpersonado` (as 14 rotas → 403 com a frase; as 6 RPCs têm `SoSessaoPropria` e respondem 403 ao impersonado; a foto não muda), `TestEscritasValemParaQuemPode` (cada corpo de `escritas` → 2xx para `conteudistaA1`).
- `web/rotas_test.go`: `rotas59` (as 20 de catálogo) em `soSessao` (comentário: "portão = catálogo, provado pela matriz de cada rota em `internal/conteudo`; vazamento e impersonado pelas varreduras de lá"); `POST /conteudo-trigger` fica FORA (o `soPedeIA` dá 403 à sessão sem módulo: `TestNenhumaRotaNovaFicaAberta` prova); `TestPrazosPorRotaPelaMontagemReal` ganha as 21 com `PrazoDominio`; `TestConteudoPelaMontagemReal` (código abaixo): leitura sem sessão 401, editor de A1 só vê A1, admin vê as duas, sem módulo lê `[]`; RPC com peça de A2 → 403 e na própria → 200 `aprovada`; `conteudo_aprovar_e_agendar` sem o portão → 403; `/conteudo-trigger` sem módulo e com conta que não se vê → 403, na própria → 200 e UM job `enfileirado` na tabela.
- `cmd/api/conferir_test.go`: a fixture com as funções de `web.FuncoesRPC`; `TestConferirNaFatiaD0NaoAcusaOPlano59` (contra a fatia, nada com ` conteudo_` é acusado, salvo `conteudo_reivindicar_hora_h`, do Plano 4, que tem de aparecer — senão o filtro não provaria nada). Os testes existentes do `conferir` continuam verdes.

```go
package conteudo

import (
	"net/http"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/rbv-co/social-dashboard/api/internal/testebanco/mundoteste"
)

// escritas: um pedido VÁLIDO para conteudistaA1 por rota de escrita de Montar (TestEscritasValemParaQuemPode
// prova). Rota de escrita nova sem entrada aqui faz as varreduras falharem.
var escritas = map[string]struct{ caminho, corpo string }{
	"POST /conteudo/pecas":              {"/conteudo/pecas", `{"account_id":"` + A1 + `","titulo":"x","formato":"feed"}`},
	"PATCH /conteudo/pecas/{id}":        {"/conteudo/pecas/" + P1, `{"titulo":"y"}`},
	"DELETE /conteudo/pecas/{id}":       {"/conteudo/pecas/" + P7, ``},
	"POST /conteudo/arquivos":           {"/conteudo/arquivos", `{"peca_id":"` + P1 + `","ordem":3,"caminho":"` + A1 + `/` + P1 + `/3-x.png","tipo":"imagem"}`},
	"PATCH /conteudo/arquivos/{id}":     {"/conteudo/arquivos/" + AR1, `{"ordem":4}`},
	"DELETE /conteudo/arquivos/{id}":    {"/conteudo/arquivos/" + AR2, ``},
	"POST /conteudo/eventos":            {"/conteudo/eventos", `{"peca_id":"` + P1 + `","acao":"criou"}`},
	"POST /conteudo/ideias":             {"/conteudo/ideias", `{"account_id":"` + A1 + `","titulo":"x"}`},
	"PATCH /conteudo/ideias/{id}":       {"/conteudo/ideias/" + I1, `{"situacao":"favorita"}`},
	"POST /conteudo/blocos":             {"/conteudo/blocos", `{"account_id":"` + A1 + `","tipo":"legenda","nome":"x","texto":"y"}`},
	"PATCH /conteudo/blocos/{id}":       {"/conteudo/blocos/" + B1, `{"ativo":false}`},
	"POST /conteudo/concorrentes":       {"/conteudo/concorrentes", `{"account_id":"` + A1 + `","handle":"novo"}`},
	"PATCH /conteudo/concorrentes/{id}": {"/conteudo/concorrentes/" + K1, `{"ativo":false}`},
	"POST /conteudo-trigger":            {"/conteudo-trigger", `{"account_id":"` + A1 + `","quantas":3}`},
}

// semRestritiva: a ÚNICA leitura fora da varredura de vazamento — conteudo_concorrentes não tem pode_ver_conta
// em produção (Ruling 5.9-5, achado 5): todo conteudista lê os de toda marca, como hoje.
var semRestritiva = map[string]string{
	"/conteudo/concorrentes": "conteudo_concorrentes não está em 2026-07-31-allowed-accounts-no-banco.sql (Ruling 5.9-5)",
}

func mundoMontado(t *testing.T) *mundoteste.Mundo {
	t.Helper()
	return novoMundo(t, Montar, montarRPCs)
}

// varrer chama f para cada rota de Montar (o /rpc/{nome} de montarRPCs fica de fora: as RPCs têm a varredura
// própria), com o caminho preenchido e o corpo de `escritas`.
func varrer(t *testing.T, m *mundoteste.Mundo, f func(metodo, rota, caminho, corpo string)) (leituras, gravacoes int) {
	t.Helper()
	err := chi.Walk(m.H.(chi.Routes), func(metodo, rota string, _ http.Handler, _ ...func(http.Handler) http.Handler) error {
		switch {
		case rota == "/rpc/{nome}":
		case metodo == http.MethodGet:
			leituras++
			f(metodo, rota, rota, "")
		default:
			gravacoes++
			e, ok := escritas[metodo+" "+rota]
			if !ok {
				t.Errorf("escrita sem caso nas varreduras: %s %s", metodo, rota)
				return nil
			}
			f(metodo, rota, e.caminho, e.corpo)
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	return leituras, gravacoes
}

// A2 nunca aparece para quem não a vê — em NENHUMA leitura com a restritiva (as filhas pela peça), sem filtro,
// filtrando por A2 ou contando; o impersonado vê o que o ALVO (conteudistaA1) vê. Toda leitura dessas projeta
// account_id (a da peça, nas filhas), por isso o uuid de A2 na resposta é vazamento.
func TestNadaVazaEntreContas(t *testing.T) {
	m := mundoMontado(t)
	varridas := map[string]bool{}
	l, g := varrer(t, m, func(metodo, rota, _, _ string) {
		if _, excecao := semRestritiva[rota]; metodo != http.MethodGet || excecao {
			return
		}
		varridas[rota] = true
		for _, quem := range []string{"conteudistaA1", "impersonado", "conteudistaNenhuma"} {
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
		if _, b := m.Pedir(t, "conteudistaNenhuma", "GET", rota, ""); strings.Contains(b, A1) {
			t.Errorf("lista vazia viu A1 em %s: %s", rota, b)
		}
		if _, b := m.Pedir(t, "adminA1", "GET", rota, ""); !strings.Contains(b, A2) {
			t.Errorf("adminA1 não viu A2 em %s (a rota projeta account_id?): %s", rota, b)
		}
	})
	for _, rota := range []string{"/conteudo/pecas", "/conteudo/arquivos", "/conteudo/eventos", "/conteudo/ideias",
		"/conteudo/blocos", "/conteudo/jobs"} {
		if !varridas[rota] {
			t.Errorf("a leitura %s ficou fora da varredura de vazamento", rota)
		}
	}
	if l != 7 || g != 14 || len(varridas) != 6 || len(varridas)+len(semRestritiva) != l {
		t.Errorf("rotas = %d leituras (%d varridas, %d exceções) e %d escritas, esperava 7 (6 + 1) e 14", l, len(varridas), len(semRestritiva), g)
	}
}

// Toda escrita — as 13 de catálogo, o /conteudo-trigger e as 6 RPCs — recusa a sessão de "entrar como", sem
// tocar no banco.
func TestEscritasRecusamImpersonado(t *testing.T) {
	m := mundoMontado(t)
	antes := m.Um(t, fotoDoConteudo)
	_, n := varrer(t, m, func(metodo, rota, caminho, corpo string) {
		if metodo == http.MethodGet {
			return
		}
		if st, b := m.Pedir(t, "impersonado", metodo, caminho, corpo); st != http.StatusForbidden || !strings.Contains(b, "Quem entrou como outra pessoa") {
			t.Errorf("%s %s como impersonado = %d %s", metodo, rota, st, b)
		}
	})
	if n != 14 {
		t.Errorf("escritas = %d, esperava 14 (rota nova? ponha soSessaoPropria e um caso em `escritas`)", n)
	}
	for _, f := range FuncoesRPC {
		if !f.SoSessaoPropria {
			t.Errorf("RPC %s sem SoSessaoPropria", f.Nome)
		}
		// o alvo (conteudistaA1) nem passa no portão das decisões: 403 sem a frase; nas outras, a frase
		if st, b := m.Pedir(t, "impersonado", "POST", "/rpc/"+f.Nome, `{}`); st != http.StatusForbidden {
			t.Errorf("RPC %s como impersonado = %d %s", f.Nome, st, b)
		}
	}
	if m.Um(t, fotoDoConteudo) != antes {
		t.Error("o impersonado mudou o banco")
	}
}

// Os corpos de `escritas` valem: quem pode (conteudistaA1, na conta dele) recebe 2xx em cada rota. Sem isto as
// varreduras acima poderiam passar com pedidos que nem chegariam a gravar.
func TestEscritasValemParaQuemPode(t *testing.T) {
	m := novoMundo(t, Montar)
	varrer(t, m, func(metodo, rota, caminho, corpo string) {
		if metodo == http.MethodGet {
			return
		}
		if st, b := m.Pedir(t, "conteudistaA1", metodo, caminho, corpo); st < 200 || st > 299 {
			t.Errorf("%s %s como conteudistaA1 = %d %s", metodo, rota, st, b)
		}
	})
}
```

Em `api/internal/web/rotas_test.go`, depois de `rotas57`:

```go
// Plano 5.9: as 20 rotas de tabela de conteudo.Montar (7 leituras, 13 escritas), no grupo de DOMÍNIO. Portão =
// catálogo, provado pela matriz de cada rota em `internal/conteudo`; vazamento e impersonado por
// `TestNadaVazaEntreContas` e `TestEscritasRecusamImpersonado`. O `POST /conteudo-trigger` NÃO entra: tem o
// portão da edge (PedeIA: sessão sem módulo = 403, TestNenhumaRotaNovaFicaAberta).
var rotas59 = []string{
	"GET /conteudo/pecas", "POST /conteudo/pecas", "PATCH /conteudo/pecas/{id}", "DELETE /conteudo/pecas/{id}",
	"GET /conteudo/arquivos", "POST /conteudo/arquivos", "PATCH /conteudo/arquivos/{id}", "DELETE /conteudo/arquivos/{id}",
	"GET /conteudo/eventos", "POST /conteudo/eventos",
	"GET /conteudo/ideias", "POST /conteudo/ideias", "PATCH /conteudo/ideias/{id}",
	"GET /conteudo/blocos", "POST /conteudo/blocos", "PATCH /conteudo/blocos/{id}",
	"GET /conteudo/concorrentes", "POST /conteudo/concorrentes", "PATCH /conteudo/concorrentes/{id}",
	"GET /conteudo/jobs",
}
```

e troque os dois laços que juntam as listas: no `init`, `for _, c := range slices.Concat(rotas51, rotas57, rotas59) {`; em `TestPrazosPorRotaPelaMontagemReal`, `for _, c := range slices.Concat(rotas51, rotas57, rotas59, []string{"POST /conteudo-trigger"}) { // Planos 5.1, 5.7 e 5.9: no grupo de domínio`. No fim do arquivo:

```go
// Plano 5.9 pela montagem real: as rotas do Conteúdo no grupo de domínio (sessão, escopo, conta), as 6 RPCs na
// lista branca e o /conteudo-trigger com o portão da edge. A matriz de cada rota está em internal/conteudo;
// aqui vale a MONTAGEM (grupo, cadeia, posição, FuncoesRPC).
func TestConteudoPelaMontagemReal(t *testing.T) {
	p := testebanco.ComEsquemaDeProducao(t)
	s := auth.NovoStore(p)
	h := Rotas(p, s, auth.NovoLimitador(), config.Config{})
	ctx := context.Background()
	const a1, a2 = "a5900000-0000-4000-a000-0000000000a1", "a5900000-0000-4000-a000-0000000000a2"
	const p1, p2 = "a5930000-0000-4000-a000-0000000000c1", "a5930000-0000-4000-a000-0000000000c2"
	quem := map[string]string{}
	for i, u := range []struct{ nome, papel, features, contas string }{
		{"editor-a1", "viewer", "{conteudo}", "{" + a1 + "}"}, {"aprovador-a1", "viewer", "{conteudo,conteudo.aprovar}", "{" + a1 + "}"},
		{"admin", "admin", "{}", ""}, {"nenhum", "viewer", "{}", ""},
	} {
		id := fmt.Sprintf("a5910000-0000-4000-a000-00000000020%d", i)
		if _, err := p.Exec(ctx, `insert into usuarios (id, email) values ($1::uuid, $2::text)`, id, u.nome+"@x.com"); err != nil {
			t.Fatal(err)
		}
		if _, err := p.Exec(ctx, `insert into profiles (id, email, name, role, features, escopo_por_equipe, allowed_accounts)
			values ($1::uuid, $2::text, $2::text, $3::text, $4::text[], false, nullif($5::text, '')::uuid[])`,
			id, u.nome+"@x.com", u.papel, u.features, u.contas); err != nil {
			t.Fatal(err)
		}
		var err error
		if quem[u.nome], err = s.Criar(ctx, id, "painel", nil); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := p.Exec(ctx, `insert into accounts (id, name) values ($1::uuid, 'Vessel'), ($2::uuid, 'Mantova')`, a1, a2); err != nil {
		t.Fatal(err)
	}
	if _, err := p.Exec(ctx, `insert into conteudo_pecas (id, account_id, titulo, formato, status, publicar_em) values
		($1::uuid, $2::uuid, 'Da A1', 'feed', 'em_aprovacao', now() + interval '1 day'),
		($3::uuid, $4::uuid, 'Da A2', 'feed', 'em_aprovacao', now() + interval '1 day')`, p1, a1, p2, a2); err != nil {
		t.Fatal(err)
	}
	pedir := func(nome, metodo, caminho, corpo string) (int, string) {
		r := httptest.NewRequest(metodo, caminho, strings.NewReader(corpo))
		r.Header.Set("Content-Type", "application/json")
		if nome != "" {
			r.Header.Set("Authorization", "Bearer "+quem[nome])
		}
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		return w.Code, strings.TrimSpace(w.Body.String())
	}
	for _, c := range []struct {
		nome, quem, metodo, caminho, corpo string
		status                             int
		tem, naoTem                        string
	}{
		{"leitura sem sessão", "", "GET", "/conteudo/pecas", "", 401, "nao_autenticado", ""},
		{"editor com lista só vê a própria conta", "editor-a1", "GET", "/conteudo/pecas", "", 200, a1, a2},
		{"admin vê as duas", "admin", "GET", "/conteudo/pecas", "", 200, a2, ""},
		{"sem módulo lê lista vazia (catálogo)", "nenhum", "GET", "/conteudo/pecas", "", 200, "[]", ""},
		{"RPC com peça de conta que não se vê", "aprovador-a1", "POST", "/rpc/conteudo_decidir", `{"p_peca":"` + p2 + `","p_decisao":"aprovada"}`, 403, "sem_permissao", ""},
		{"RPC na própria conta", "aprovador-a1", "POST", "/rpc/conteudo_decidir", `{"p_peca":"` + p1 + `","p_decisao":"aprovada"}`, 200, `"status":"aprovada"`, ""},
		{"RPC sem o portão da função", "editor-a1", "POST", "/rpc/conteudo_aprovar_e_agendar", `{"p_peca":"` + p1 + `"}`, 403, "sem_permissao", ""},
		{"pedir IA sem o módulo", "nenhum", "POST", "/conteudo-trigger", `{"account_id":"` + a1 + `"}`, 403, "sem_permissao", ""},
		{"pedir IA para conta que não se vê", "editor-a1", "POST", "/conteudo-trigger", `{"account_id":"` + a2 + `"}`, 403, "sem_permissao", ""},
		{"pedir IA na própria conta: o job na fila", "editor-a1", "POST", "/conteudo-trigger", `{"account_id":"` + a1 + `","quantas":5}`, 200, `"quantas":5`, ""},
	} {
		st, corpo := pedir(c.quem, c.metodo, c.caminho, c.corpo)
		if st != c.status || !strings.Contains(corpo, c.tem) || (c.naoTem != "" && strings.Contains(corpo, c.naoTem)) {
			t.Errorf("%s: %s %s como %q = %d %s, esperava %d com %q e sem %q", c.nome, c.metodo, c.caminho, c.quem, st, corpo, c.status, c.tem, c.naoTem)
		}
	}
	var fila string
	if err := p.QueryRow(ctx, `select count(*)::text || '|' || min(status) from conteudo_jobs`).Scan(&fila); err != nil || fila != "1|enfileirado" {
		t.Errorf("a fila = %q %v, esperava 1|enfileirado", fila, err)
	}
}
```

**(c) Arquivos:** Create `api/internal/conteudo/rotas.go`, `api/internal/conteudo/rotas_test.go`; Modify `api/internal/web/rotas.go`, `api/internal/web/rpc_lista.go`, `api/internal/web/rotas_test.go`, `api/cmd/api/conferir.go`, `api/cmd/api/conferir_test.go`, `docs/migracao-go/NOTAS-DA-IMPLANTACAO.md`.

**(d) Dependências:** Tasks 4–8; `web.Rotas`, `web.FuncoesRPC`, `RPCPendentes`, `conferirRPC` (5.0).

- [ ] **Step 1: Testes que falham.** `conteudo/rotas_test.go` (acima); em `web/rotas_test.go`, `rotas59`, os dois laços e `TestConteudoPelaMontagemReal`; em `cmd/api/conferir_test.go`, a fixture e `TestConferirNaFatiaD0NaoAcusaOPlano59`. Run: `go test -count=1 ./internal/conteudo/ ./internal/web/ ./cmd/api/` → FAIL (`Montar` não existe; as rotas não estão montadas).
- [ ] **Step 2: Implementar.** `conteudo/rotas.go`; em `web/rotas.go` o import, `conteudo.FuncoesRPC, // Plano 5.9` em `FuncoesRPC` e `conteudo.Montar(r, p) // Plano 5.9` no grupo de domínio; em `web/rpc_lista.go`, apague o bloco `// 5.9 (conteúdo): 6` e os 6 nomes de `RPCPendentes`.

`cmd/api/conferir.go` (as três entradas do Plano 4 são AMPLIADAS no lugar; o resto entra num bloco do 5.9 no FIM de `colunasDoWorker`, para o `gofmt` não realinhar o mapa inteiro):

```go
// colunasDoWorker: as três do Plano 4, ampliadas no lugar
"conteudo_pecas":      "id,account_id,titulo,formato,status,legenda,hashtags,observacoes,publicar_em,publicado_em,avisado_em,ig_media_id,ig_permalink,responsavel,criado_por,aprovado_por,aprovado_em,motivo_reprovacao,created_at,updated_at", // + Plano 5.9
"conteudo_eventos":    "id,peca_id,de,para,acao,detalhe,quem,quando", // + Plano 5.9
"conteudo_casamentos": "id,peca_id,ig_media_id,ig_permalink,ig_timestamp,ig_caption,ig_thumb,pontuacao,situacao,motivo,decidido_por,decidido_em,created_at", // + Plano 5.9
// (conteudo_metricas fica como está: as rotas a leem com as colunas que o Plano 4 já confere)

// colunasDoWorker, no fim do mapa
// Plano 5.9 (conteúdo): o que as rotas, as RPCs e o /conteudo-trigger presumem; conteudo_jobs é a fila do vigia
// da VPS. Todas com DDL no repositório.
"conteudo_arquivos":     "id,peca_id,ordem,bucket,caminho,tipo,mime,bytes,created_at",
"conteudo_ideias":       "id,account_id,titulo,gancho,formato,pilar,roteiro,legenda_sugerida,hashtags_sugeridas,por_que_agora,referencia,origem,modelo,job_id,situacao,peca_id,criado_por,created_at,cta,producao,porque_formato",
"conteudo_blocos":       "id,account_id,tipo,nome,texto,usos,ativo,criado_por,created_at",
"conteudo_jobs":         "id,tipo,account_id,params,status,github_run_id,resultado,erro,criado_por,created_at,updated_at",
"conteudo_concorrentes": "id,account_id,handle,nome,observacao,ativo,created_at",

// tiposDoWorker, antes do bloco do 5.7
// Plano 5.9: os casts das rotas, das RPCs e do /conteudo-trigger (account_id das conteudo_* é uuid: o init completa)
"conteudo_pecas.criado_por": "uuid", "conteudo_pecas.responsavel": "uuid", "conteudo_arquivos.id": "uuid",
"conteudo_arquivos.peca_id": "uuid", "conteudo_arquivos.ordem": "integer", "conteudo_eventos.quem": "uuid",
"conteudo_casamentos.id": "uuid", "conteudo_ideias.id": "uuid", "conteudo_ideias.peca_id": "uuid", "conteudo_ideias.roteiro": "jsonb",
"conteudo_ideias.criado_por": "uuid", "conteudo_blocos.criado_por": "uuid", "conteudo_jobs.id": "uuid", "conteudo_jobs.params": "jsonb",
"conteudo_jobs.resultado": "jsonb", "conteudo_jobs.criado_por": "uuid", "conteudo_jobs.created_at": "timestamp with time zone",

// funcoesDoWorker, depois de gt_registrar_problemas
"conteudo_guarda_aprovacao()", // Plano 5.9: a função do gatilho (as 6 RPCs, conferirRPC confere por web.FuncoesRPC)

// gatilhosDoWorker
{"conteudo_pecas_guarda", "conteudo_pecas"}, // Plano 5.9: sem ele, quem não aprova aprova pelo PATCH
```

`cmd/api/conferir_test.go`: imports `internal/rpc` e `internal/web`; em `esquemaCompleto`, logo antes do `trg_vazio`:

```go
	// as funções de web.FuncoesRPC (que conferirRPC confere) pela PRÓPRIA declaração: Opcional = DEFAULT (Plano 5.9)
	for _, f := range web.FuncoesRPC {
		var args []string
		for _, pr := range f.Params {
			args = append(args, pr.Nome+" "+pr.Tipo+map[bool]string{true: " default null"}[pr.Opcional])
		}
		retorno := map[rpc.Retorno]string{rpc.Valor: "integer", rpc.Conjunto: "setof integer", rpc.Nada: "void"}[f.Retorno]
		ddl = append(ddl, fmt.Sprintf("create or replace function %s(%s) returns %s language sql as $f$ select null::integer $f$",
			f.Nome, strings.Join(args, ", "), retorno))
	}
```

(`create or replace`: `gt_registrar_problemas` já foi criada pelo laço de `funcoesDoWorker` com o mesmo retorno.) E no fim:

```go
// Plano 5.9: contra a fatia D0 (as 9 conteudo_*, o gatilho da aprovação e as 6 RPCs verbatim), o conferir não
// acusa nada do 5.9 — pega erro de digitação nas listas. conteudo_reivindicar_hora_h é do Plano 4 (o robô da
// hora H tem banco próprio nos testes) e não está na fatia.
func TestConferirNaFatiaD0NaoAcusaOPlano59(t *testing.T) {
	p := testebanco.ComEsquemaDeProducao(t)
	faltam := faltamDe(t, p)
	for _, f := range faltam {
		if strings.Contains(f, " conteudo_") && !strings.Contains(f, "conteudo_reivindicar_hora_h") {
			t.Errorf("a fatia D0 devia satisfazer o 5.9, mas o conferir acusa %q", f)
		}
	}
	if !slices.ContainsFunc(faltam, func(f string) bool { return strings.Contains(f, "conteudo_reivindicar_hora_h") }) {
		t.Error("conteudo_reivindicar_hora_h não está na fatia: o conferir devia acusá-la (o filtro acima não provaria nada)")
	}
}
```

Em `NOTAS-DA-IMPLANTACAO.md`, acrescente ao fim:

```markdown
## Plano 5.9 — Central de Conteúdo

### Rotas novas
- Com sessão, regra = catálogo de produção (conteudista = papel `admin`, `is_superadmin` ou o módulo `conteudo` em `features`; a restritiva `pode_ver_conta` em peças, ideias, blocos e jobs), escrita de sessão "entrar como" = 403: `GET /conteudo/pecas` (com `capa`, `metrica` e `sugestao` embutidas), `/arquivos`, `/eventos`, `/ideias`, `/blocos`, `/concorrentes`, `/jobs`; `POST`/`PATCH`/`DELETE /conteudo/pecas[/{id}]`, `POST`/`PATCH`/`DELETE /conteudo/arquivos[/{id}]`, `POST /conteudo/eventos`, `POST`/`PATCH /conteudo/ideias[/{id}]`, `POST`/`PATCH /conteudo/blocos[/{id}]`, `POST`/`PATCH /conteudo/concorrentes[/{id}]`.
- As filhas da peça (arquivos, eventos, a métrica e a sugestão embutidas) só aparecem com a peça VISÍVEL (em produção não tinham a restritiva). `concorrentes` continua sem a restritiva (paridade, Ruling 5.9-5).
- RPC: `POST /rpc/conteudo_aprovar_e_agendar`, `conteudo_casar_na_mao`, `conteudo_decidir`, `conteudo_decidir_casamento`, `conteudo_ideia_virar_peca`, `conteudo_reavisar` — portão = a checagem de dentro de cada função; a peça/sugestão/ideia/conta do parâmetro tem de ser de conta que a pessoa vê (403 sem a função rodar).
- `POST /conteudo-trigger` (portão da edge: papel `admin`, super pela ficha, a chave `conteudo` em `permissions` ou o módulo `conteudo`; conta visível; "entrar como" não pede): grava o pedido em `conteudo_jobs` (`enfileirado`) e NÃO chama o GitHub. Quem roda é o vigia da VPS (abaixo).

### Robô de Conteúdo na VPS (trilha C, Plano 7)
- O `conteudo-ideias.yml` (GitHub Actions) deixa de existir: `coletor/vps/conteudo-vigia.sh` + `conteudo-vigia.service` pegam o job da fila por `pg` (passo a passo na seção "Robô de Conteúdo na VPS" do plano 5.9). Até o vigia estar no ar, o botão "Gerar ideias com IA" grava o pedido e a tela gira a ampulheta; o vigia expira (`erro`) o pedido com mais de 30 min na fila em vez de gastar IA com clique velho.
- Papel de banco `conteudo_robo` (senha em `/etc/robos.env` como `CONTEUDO_DB_SENHA`), com SELECT/INSERT/UPDATE só no que os dois scripts usam (seção da trilha C) — regras 2, 4, 11 e 15 de `ops/vps/api-db/LEIA-ME.md` para ele.

### Antes do corte
- `api worker conferir` no banco restaurado: as colunas e os tipos das 9 `conteudo_*`, a função `conteudo_guarda_aprovacao()` e o gatilho `conteudo_pecas_guarda` LIGADO em `conteudo_pecas`; as 6 RPCs pelo `conferirRPC` (DEFAULT de `p_motivo` e `p_publicar_em`, EXECUTE de `authenticated`).
- Nenhum outro gatilho nas `conteudo_*`: `select c.relname, g.tgname from pg_trigger g join pg_class c on c.oid = g.tgrelid where not g.tgisinternal and c.relname like 'conteudo\_%'` = só `conteudo_pecas | conteudo_pecas_guarda`.
- As frases das funções (sem acento) e os corpos verbatim: `select md5(prosrc) from pg_proc where proname like 'conteudo\_%' order by proname` no banco restaurado = o mesmo na fatia de teste (`03-funcoes-5-09.sql`); diferente = alguém mudou a função em produção depois do levantamento — refaça o `TestPortoesIguaisAsFuncoes` com a nova antes do corte.
- Pedidos órfãos: `select status, count(*) from conteudo_jobs where status in ('enfileirado','rodando') group by 1` — os que ficaram do Actions viram `erro` antes de ligar o vigia (senão ele os roda na primeira volta): `update conteudo_jobs set status = 'erro', erro = 'pedido de antes da mudança para a VPS', updated_at = now() where status in ('enfileirado','rodando')`.
- Objetos do bucket `conteudo` copiados para o disco (Plano 6) antes de a tela apagar arquivo pela API (hoje `excluirPeca`/`removerArquivo` apagam do Storage primeiro).

### Mudanças de contrato que o Plano 7 absorve
- Peças: `GET /conteudo/pecas?account_id=` (ou `?id=`; `status` lista por vírgula; `ordem=publicar_em|created_at[.desc]`) com `capa {caminho,tipo}`, `metrica {…}` e `sugestao {…}` em cada peça — somem `miniaturasDasPecas`, `metricasDasPecas` e `sugestoesDeCasamento` (a lista de ids na URL). `POST /conteudo/pecas` SEM `status`, `publicado_em`, `criado_por` (vem da sessão), campos de aprovação ou do Instagram — `criarPeca` deixa de mandar `criado_por` (400 se mandar); `avisado_em` só `null`. `PATCH` com `status`: sem `conteudo.aprovar`, levar de `em_aprovacao` a `aprovada|reprovada|agendada` = `400 regra_de_negocio` com a frase da função (o PostgREST respondia o mesmo P0001). `DELETE` é 204.
- Arquivos: `POST /conteudo/arquivos` com `caminho` = `<conta>/<peça>/<nome>` da PRÓPRIA peça (403 fora), `bucket` só `conteudo`; `PATCH` só `ordem` (-1 a 1000, a troca em três passos continua); peça que não se vê = 403 na criação e 404 no resto.
- Eventos: `POST /conteudo/eventos` sem `quem` (vem da sessão); `acao` só `criou|mudou_status|remarcou|duplicou`.
- Ideias: `GET /conteudo/ideias?da_marca=<conta>&descartada=false` (substitui o `.or(account_id.eq.X,account_id.is.null)`); `POST` sem `origem`, `modelo`, `job_id`, `situacao`, `peca_id`, `criado_por`; `PATCH` com `situacao`/`peca_id` (peça que não se vê = 403).
- Blocos: `GET /conteudo/blocos?da_marca=<conta>&ativo=true`; `POST` exige `nome` (o apelido: hoje a tela manda `null` e o banco recusa, achado 7) e não aceita `criado_por`; `PATCH` só `{"ativo": false}`.
- Concorrentes: `GET /conteudo/concorrentes?account_id=&ativo=true`; `POST` (409 se o @ já existe na marca); `PATCH` só `ativo`.
- Job: `GET /conteudo/jobs?id=` (sem `criado_por` nem `github_run_id`).
- RPCs: `POST /api/rpc/<nome>` com o mesmo corpo de `sbClient.rpc`; o erro de negócio chega como `400 {"error":"regra_de_negocio","mensagem":<frase da função>}`; peça de conta que não se vê = 403.
- `conteudo-trigger`: mesma URL sob `/api`, mesmo corpo e mesma resposta; erros: `400 conta_invalida` (também conta inexistente), `400 corpo_invalido` (campo a mais), `403 sem_permissao` (também conta que não se vê), `409 ja_rodando` com `job_id`, `500 insert_falhou` (sem `detail`). Some o `502 dispatch_falhou`.
- Conta e pessoas: `listarContas`/`mudarUsoDoPortal` → `/redes/contas` (5.6; o Portal de Notícias só para papel `admin`, como a policy de hoje: Ruling 5.9-13); `listarPessoas` → `GET /acesso/usuarios` (5.1). Storage (`urlAssinada`, `subirArquivo`, `duplicarPeca`, `removerArquivo`, `excluirPeca`): Plano 6.

### Achados para o dono
(ver a seção "Achados para o dono" do plano 5.9)
```

Rode `gofmt -w ./internal ./cmd`.
- [ ] **Step 3: Rodar e ver passar.** `gofmt -l . && go vet ./... && go test -count=1 -race ./... 2>&1 | grep -v goose | grep -E '^(ok|FAIL|---)'` → todos `ok`. Mutações que têm de reprovar: tirar `soSessaoPropria` de UMA escrita (a varredura do impersonado acusa — ensaiado); uma leitura com a restritiva que não projete `account_id` (o lado positivo acusa — ensaiado); `conteudo.Montar` FORA do grupo com `ComEscopo` (as leituras respondem 500 e o `soPedeIA` nega tudo: `TestConteudoPelaMontagemReal`); um nome de RPC do Conteúdo de volta em `RPCPendentes` (a montagem recusa: `TestListasDeRPCFecham`); um erro de digitação nas listas do `conferir` (ensaiado).
- [ ] **Step 4: Commit** `feat(api): monta a Central de Conteúdo (leituras, escritas, RPCs e a fila do robô), varreduras de conta e impersonado, conferir e notas` (+ `Co-Authored-By`).

---

### Verificação final do 5.9

- [ ] `docker stop pg-plano59` e `make -C api teste PG_PORTA=58549` → todos `ok` (nunca junto com o gate de outra worktree).
- [ ] Subir o `pg-plano59` de novo e `cd api && go test -count=1 -v ./... 2>&1 | grep -c -- '--- SKIP'` → `0`.
- [ ] `cd api && gofmt -l . && go vet ./...` → nada.
- [ ] `git diff origin/main --stat -- src/ supabase/ coletor/ db/ .github/` → vazio (front, edge e robô trocam no Plano 7; produção não muda).
- [ ] `grep -rn 'api.github.com\|internal/github' api/internal/conteudo` → nada (o Conteúdo não despacha nada); `grep -rn 'conteudo_aprovar_e_agendar\|conteudo_reavisar' api/internal/web/rpc_lista.go` → nada (saíram de `RPCPendentes`).
- [ ] `grep -rn 'Conferir:' api/internal/conteudo/*.go | grep -v _test` → `tabelaPecas`, `tabelaArquivos`, `tabelaEventos`, `tabelaIdeias`, `tabelaBlocos` e as 6 RPCs; `tabelaConcorrentes` SEM (Ruling 5.9-5).
- [ ] `docker stop pg-plano59`.
- [ ] Revisão final do branch por opus com foco em: a aprovação (alguma escrita leva a peça a `aprovada`/`agendada` sem passar pela guarda ou por `Aprovador`? algum `INSERT` de peça aceita `status`?), a conta (alguma leitura, filha, embutido, RPC ou o `/conteudo-trigger` alcança A2 para quem só vê A1? alguma conferência roda FORA da transação que grava?), a IA paga (algum caminho cria dois jobs ou um `quantas` acima de 20?), o "entrar como" (alguma escrita ou RPC sem `soSessaoPropria`/`SoSessaoPropria`?) e o caminho do arquivo (algum `caminho` fora de `<conta>/<peça>/` grava?).

---

## Robô de Conteúdo na VPS — passo a passo para a trilha C (não é tarefa do 5.9)

Decidido em COORDENACAO 12/10 23:10 (b): o robô de pauta (`coletor/conteudo-ideias.mjs`, `conteudo-semana.mjs`; leve: só HTTP para a Anthropic, até 15 min) sai do GitHub Actions e roda na VPS em `pg`, como os outros 24. A API do 5.9 só ENFILEIRA (`POST /conteudo-trigger`, Task 8); quem roda é um vigia da VPS no padrão do `coletor/vps/cartoes-ean-vigia.sh`. Dono: trilha C (`coletor/`, Plano 7), com o dono do projeto para o que é na VPS. Nada aqui é executado pelo 5.9.

**1. O contrato da fila (o que a API garante; o vigia não pode presumir mais nada).**
- Linha nova em `conteudo_jobs` com `status = 'enfileirado'`, `tipo ∈ {ideias, semana}` (lista fechada), `account_id` = uuid de uma conta que EXISTE, `criado_por` = quem pediu, `github_run_id` nulo e `params` = `{"quantas": n}` com `n` inteiro de 1 a 20 (tipo `ideias`) ou `{"segunda": "AAAA-MM-DD" | null}` (tipo `semana`, data válida).
- No máximo UM job `enfileirado|rodando` por conta criado nos últimos 3 min (a trava consultiva da Task 8). Mais velho que isso, a marca aceita pedido novo — por isso o vigia expira o pedido velho (passo 3).
- A tela acompanha por `GET /conteudo/jobs?id=` (`verJob`, `dados-conteudo.js:425`: lê `status`, `resultado`, `erro`) e para de girar em `concluido` ou `erro`. O `resultado` de `ideias` é `{sugeridas, gravadas, repetidas, usd}` e o de `semana` é o plano `{…, usd}` (o que os scripts já gravam).

**2. Os scripts passam a `pg` (Plano 7, trilha C).** `conteudo-ideias.mjs` e `conteudo-semana.mjs` trocam o `sb()` (REST com `SUPABASE_SERVICE_KEY`) por `pg` com `CONTEUDO_DATABASE_URL`, nas MESMAS leituras e escritas de hoje:
- leem `accounts (id, name, username, conteudo_usa_portal)` (NUNCA `access_token`), `conteudo_blocos`, `conteudo_pecas`, `conteudo_ideias`, `conteudo_concorrentes`, `conteudo_metricas`, `noticias_concorrentes` e o próprio job (`account_id`, `params`);
- gravam `conteudo_ideias` (`origem = 'ia'`, `modelo`, `job_id`), o fim do job (`status = 'concluido' | 'erro'`, `resultado`, `erro`, `updated_at = now()`) e a linha de custo em `ia_execucoes` (`registrar-execucao.mjs` ganha o caminho `pg` para os robôs da VPS; a Fábrica, que fica no Actions, segue pela rota do 5.8).
- `--job <id>`: `quantas` vem de `params.quantas` (hoje vinha de `--quantas`, que o yml tirava do input), com `Math.min(20, …)` de defesa; NÃO marca mais `rodando` nem grava `github_run_id` (o vigia já marcou). `--conta` e `--seco` continuam para rodar à mão.

**3. O vigia (`coletor/vps/conteudo-vigia.sh` + `coletor/vps/conteudo-vigia.service`).** Uma volta a cada 10 s, UM job por vez na VPS inteira (o `concurrency: conteudo-ideias` do yml), com o código da `main` (`git pull --ff-only` só com nenhum robô rodando, como o dos cartões). A cada volta, por `pg` (num `coletor/conteudo-fila.mjs` pequeno, com teste, chamado pelo `.sh`):
```sql
-- expirar: clique velho não gasta IA; rodada presa não segura a marca
update conteudo_jobs set status = 'erro', updated_at = now(),
       erro = 'O pedido esperou mais de 30 minutos na fila e foi descartado. Peça de novo.'
 where status = 'enfileirado' and created_at <= now() - interval '30 minutes';
update conteudo_jobs set status = 'erro', updated_at = now(),
       erro = 'A rodada passou de 20 minutos sem terminar e foi interrompida.'
 where status = 'rodando' and updated_at <= now() - interval '20 minutes';
-- pegar UM (atômico: dois vigias, por engano, não pegam o mesmo)
update conteudo_jobs set status = 'rodando', updated_at = now()
 where id = (select id from conteudo_jobs where status = 'enfileirado'
              order by created_at for update skip locked limit 1)
returning id, tipo;
```
Com um job: `case "$tipo" in ideias) s=conteudo-ideias.mjs ;; semana) s=conteudo-semana.mjs ;; *) marca erro ;; esac` (lista fechada: o valor vira nome de arquivo executado), `timeout 15m node coletor/$s --job "$id"`. Saída diferente de 0 com o job ainda `rodando` → `erro` com "A rodada falhou antes de terminar; detalhes no log da VPS" (a rede de segurança do passo `failure()` do yml). Log em `/var/log/robos/conteudo-vigia.log` (rotacionado), sem segredo.

**4. Unidade systemd** (`/etc/systemd/system/conteudo-vigia.service`, molde do `cartoes-ean.service`): `EnvironmentFile=/etc/robos.env`, `ExecStart=/opt/robos/social-dashboard/coletor/vps/conteudo-vigia.sh`, `Restart=always`, `RestartSec=15`, `Nice=10`, `CPUWeight=20`, `MemoryHigh=384M`, `MemoryMax=512M` (o robô é só HTTP; a VPS divide CPU e memória com PDV, Chatwoot e o `api-db`). Node 22 de `/opt/cartoes-ean/node/bin`, como o `rodar-robo.sh`. `CONTEUDO_DATABASE_URL` montada no `.sh` pelo IP do `api-db` na rede `api_net` (como o `copia-do-banco.sh:25-28`), senha gerada em `/root/secrets/conteudo.senha` e gravada como `CONTEUDO_DB_SENHA` no `/etc/robos.env` (`600 root`, como a do `copia`), passada por ambiente, nunca por argumento. A chave da Anthropic: a MESMA que o `budget-ia` já usa no `/etc/robos.env` (o yml usava o segredo `ANTHROPIC_API_KEY_TRAFEGO`, "a mesma conta").

**5. Papel de banco `conteudo_robo`** (arquivo `ops/vps/api-db/papel-conteudo.sql`, molde do `papel-copia.sql`; rodar como o dono do banco, só com ok do dono): `login nosuperuser nocreatedb nocreaterole noinherit connection limit 2`; `grant select (id, name, username, conteudo_usa_portal) on accounts` (por COLUNA: `accounts` guarda `access_token`); `grant select on conteudo_blocos, conteudo_pecas, conteudo_concorrentes, conteudo_metricas, noticias_concorrentes`; `grant select, insert on conteudo_ideias`; `grant select (id, tipo, account_id, params, status, created_at, updated_at), update (status, resultado, erro, updated_at) on conteudo_jobs`; `grant insert on ia_execucoes` (+ `usage` da sequência, se houver). Nenhum EXECUTE (regra 15 do `LEIA-ME.md` do `api-db`: o robô não chama função). Conferir com as regras 2, 4 e 11 trocando `copia` por `conteudo_robo`, e que a carga não deixou RLS ligado nessas tabelas (`select relname from pg_class where relname like 'conteudo\_%' and relrowsecurity` → vazio; ligado = o papel lê vazio: pare e fale com a trilha A).

**6. Provas antes do corte** (no `api-db` de ensaio): (a) `POST /api/conteudo-trigger {"account_id":<conta>,"quantas":2}` → em até 10 s o job vai a `rodando` e depois a `concluido` com `resultado.gravadas`; as ideias aparecem em `GET /conteudo/ideias?da_marca=<conta>`; uma linha nova em `ia_execucoes`; (b) `modo: "semana"` → `concluido` com o plano; (c) job com `created_at` de 31 min atrás → `erro` "esperou mais de 30 minutos", sem chamar a IA; (d) `kill -9` no `node` no meio → em ≤ 20 min o job vira `erro`; (e) `systemctl stop conteudo-vigia` com pedido na fila → nada roda e o job fica `enfileirado`; religado depois de 30 min, o job vira `erro` (expirado) sem chamar a IA; (f) `grep -c "$(cat /root/secrets/conteudo.senha)" /var/log/robos/conteudo-vigia.log` → `0`.

**7. No corte:** os jobs `enfileirado|rodando` que vierem do Supabase viram `erro` ANTES de ligar o vigia (NOTAS, "Antes do corte"); `systemctl enable --now conteudo-vigia`; o `conteudo-ideias.yml` e a edge `conteudo-trigger` saem no Plano 7 (o yml escreve no Supabase e precisa do `GITHUB_PAT_FABRICA`, que a API não tem). Reverter = `systemctl disable --now conteudo-vigia` (o pedido fica `enfileirado` e a tela gira; ao religar, o que tiver mais de 30 min expira; nada se perde além do clique).

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
