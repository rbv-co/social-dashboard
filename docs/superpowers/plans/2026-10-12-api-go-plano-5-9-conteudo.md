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
