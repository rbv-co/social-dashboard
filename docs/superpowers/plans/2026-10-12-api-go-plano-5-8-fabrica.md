# Sair do Supabase — Plano 5.8: Fábrica de anúncios

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **Execute na worktree `p5-58`** (branch `feat/api-go-plano-5-8`, que já traz o 5.0 e o 5.1 executados e os planos 5.1, 5.2, 5.6, 5.7). Antes da Task 1 ela recebe o **5.7 EXECUTADO** (`git merge --no-edit feat/api-go-plano-5-7`, que traz o 5.6 e a fundação comum do 5.2), o **5.5 EXECUTADO** (a fatia D0 de `gc_vendas_item`, `gc_estoque_item` e `gestao_comercial_briefings`) e, se já mesclado, o **5.13** (contas de serviço, trilha A). Faça `git add` só dos caminhos de cada task. Este plano contrata sobre as **interfaces** escritas nos planos 5.0–5.7 e 5.13, não sobre o código: o pré-voo confere que elas existem com esses nomes.

**Goal:** Trocar os 23 acessos do front às 9 tabelas da Fábrica de Anúncios por rotas de domínio que decidem com as MESMAS regras das 18 policies de produção (1 restritiva `pode_ver_conta`), portar as 5 edges da Fábrica (`fabrica-trigger`, `fabrica-apagar`, `fabrica-candidatos`, `fabrica-looks`, `fabrica-publicos`) com o portão delas, entregar o cliente `internal/github` (despacho de workflow com o PAT só em variável de ambiente, lista fechada de repositório/workflow/ref, erros por classe) e dar ao robô da Fábrica, que continua no GitHub Actions, as rotas de robô (`/fabrica/robo/…`, só sessão de serviço) para tudo o que ele hoje lê e grava pelo REST do Supabase.

**Architecture:** Dois pacotes. `internal/github` (novo, sem banco): `Cliente` com `Disparar(nome, entradas)` e `Cancelar(nome, runID)` sobre a lista fechada `Disparos`; URL base fixa (só os testes do pacote trocam), sem seguir redirecionamento, prazo de 15 s, erro tipado por classe (401, 403, 404, 422, limite, 5xx, sem resposta). `internal/fabrica` (já existe com a purga do Plano 4) ganha as rotas, montadas no grupo de domínio do 5.0 (`auth.Exigir` → `comPrazo(PrazoDominio)` → `autz.ComEscopo`): leituras = `dados.Consulta` (regra de Ler do catálogo; `fabrica_marcas` com a restritiva); escritas nas duas tabelas que o catálogo deixa a pessoa gravar (`fabrica_campanhas`, `fabrica_criativos`) = `dados.Tabela` (`PodeCriar/PodeEditar/PodeApagar` na transação que grava); escritas que em produção só a chave de serviço fazia (as edges e o robô) = portão `Fabricante` (a MESMA regra da policy de escrita: papel `admin`, super pela ficha ou a chave `meta.fabrica`) + SQL explícito em `banco.ComUsuario`. Rotas de robô atrás de `auth.SoServico` (5.13) e das regras do PERFIL do robô. Testes contra a fatia 5.8 do D0 e contra GitHub de mentira (`httptest`).

**Tech Stack:** Go 1.26 (`go.mod`), `chi`, `pgx` v5, Postgres 17 (contêiner), `net/http/httptest`, `os.Root` (Go 1.25+: `Remove`, `RemoveAll`).

**Spec:** `docs/superpowers/specs/2026-10-09-sair-do-supabase-design.md` (§4 contas de serviço, §5 autorização, §7 arquivos no disco, §11 segurança, §13 testes) e o plano-mestre `docs/superpowers/plans/2026-10-11-api-go-plano-5-dominios.md` (§II contrato, IV.1 regras de sub-plano, linha 5.8 da IV.2, IV.3, Rulings 1–36, em especial 5, 9, 11, 26, 34 e 36). Modelos: `…-5-7-gestao-trafego.md` (formato, varreduras, proxies com externo de mentira), `…-5-6-meta-redes.md` (`PodeVerConta`, varredura por conta), `…-5-2-patrimonio-cadastros.md` (`SoSessaoPropria`, `mundoteste`). Permissões: `docs/migracao-go/catalogo-policies-producao.json` — 18 policies nas 9 tabelas (`levantamento/01-policies.csv:196-221`). Robô: `docs/migracao-go/INVENTARIO-DO-COLETOR.md` (commit `f7a71f4d`, linha `fabrica-job-runner.mjs`, itens 1, 2, 5, 6 e 10) e `~/Projetos/Trabalho/lavessel/MIGRACAO-GO/COORDENACAO.md` (12/10, 23:10–23:20 e a decisão final da orquestradora sobre contas de serviço).

## Global Constraints

- Nada em produção: sem `ssh`, sem credencial real, sem `push`. Postgres local descartável; segredos de teste inventados (`SEGREDO-…`); o GitHub dos testes é `httptest`.
- Regra de cada tabela = a do catálogo (`autz.Producao`), nunca reescrita à mão. Leitura `true` em 8 das 9 tabelas (qualquer sessão); `fabrica_marcas` com a restritiva `so_contas_permitidas` (`pode_ver_conta(account_id)`); escrita de pessoa só em `fabrica_campanhas` e `fabrica_criativos` (`fab_camp_write`/`fab_criativos_write`). As outras 7 só a chave de serviço gravava (`auth.role() = 'service_role'`, que compila `false`: Ruling 5 do mestre). Divergência só por Ruling deste plano.
- "Fabricante" = `exists(profiles p where p.id = auth.uid() and (p.role = 'admin' or p.is_superadmin = true or p.permissions ? 'meta.fabrica'))`: super pela FICHA entra (não por e-mail); a chave é de `permissions` (o `?` do jsonb), NÃO de `features`. É o portão das 5 edges e o das rotas de robô (Ruling 5.8-3), provado igual à policy compilada pessoa a pessoa (`TestFabricanteIgualAPolicy`).
- Negar por padrão. Todo portão tem o lado negado assertado **com o efeito**: foto do banco igual; o GitHub de mentira não recebeu pedido; o arquivo continua no disco.
- Toda rota tem teste de vazamento pela cadeia real (`mundoteste`: `auth.Exigir` → `autz.ComEscopo`); a única leitura com restritiva (`GET /fabrica/marcas`) entra na varredura por conta sem filtro, com `?account_id=<A2>` e com `contar=1`.
- Escritas: sessão de "entrar como" = `403 {"error":"sem_permissao","mensagem":"Quem entrou como outra pessoa só consulta."}` sem efeito (`dados.SoSessaoPropria(dados.FraseEntrarComo)`). `PodeX` na MESMA transação de `banco.ComUsuario` que grava, sobre o MESMO mapa que vai ao `INSERT`/`UPDATE`. Rotas de robô: `auth.SoServico` (sessão de painel = 403) **e** as regras do perfil do robô.
- Segredos: o PAT do GitHub vem SÓ de `GITHUB_PAT` (variável de ambiente), entra em `config.Segredos()` e nunca sai em resposta, erro nem log; o corpo de resposta do GitHub não sai do pacote `github` (pode citar o repositório). Log de despacho: disparo, classe, status e duração.
- Externo com URL FIXA no código (campo não exportado; só os testes do pacote trocam), sem seguir redirecionamento, com resposta lida até um teto e prazo de 15 s.
- Disco: caminho vindo do banco só apaga dentro de `<ARQUIVOS_DIR>/fabrica-criativos` (`filepath.IsLocal` + sem NUL + `os.Root`, a MESMA função `apagar` da purga do Plano 4).
- SQL: todo parâmetro com cast explícito; nada do pedido no texto do SQL.
- Sem dependência nova; `go.mod` fica em `go 1.26.0`.
- Gate: `make -C api teste PG_PORTA=58548` com `--- SKIP` = 0; `gofmt -l` e `go vet` limpos. O alvo `teste` usa o contêiner de nome fixo `pg-api-teste`: nunca junto com o gate de outra worktree.
- Commits terminam com `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>` (o modelo que implementa). Código, comentários e mensagens em português com acentuação; códigos de erro copiados das edges ficam como estão (`tipo_invalido`, `campanhaId_obrigatorio`, `chave_obrigatoria`, `fonte_invalida`, `acao_invalida`).
- `go` roda em `api/`; `git` na raiz da worktree.

## Review Focus

1. **O PAT do GitHub vazando ou indo para onde não deve** — token em resposta, erro, log ou `robos_execucoes`; despacho para repositório/workflow/ref fora da lista; entrada não declarada ou com valor fora do formato; redirecionamento do GitHub seguido com o cabeçalho. Testes: `TestDispararListaFechada`, `TestErrosPorClasse`, `TestTokenNuncaSai` (Task 2).
2. **Quem não é fabricante disparando robô (gasto de IA paga, anúncio na Meta) ou apagando campanha** — sem a chave, `leitor`, `impersonado`, sessão sem módulo → `403` com o GitHub de mentira com **0 pedidos**, nenhuma linha em `fabrica_jobs`/`fabrica_campanhas` e nenhum arquivo apagado. Testes: `TestTrigger` (Task 5), `TestApagar` (Task 6), `TestEscritasRecusamImpersonado` (Task 10).
3. **`fabrica-apagar` saindo da pasta** — `storage_path` com `..`, absoluto, NUL, symlink de diretório para fora → nada fora de `<ARQUIVOS_DIR>/fabrica-criativos` some; a segunda chamada responde igual (idempotente). Teste: `TestApagar` (Task 6).
4. **Rota de robô aberta a sessão de painel, ou robô passando por cima do próprio perfil** — painel (mesmo fabricante ou admin) → 403; robô sem a chave `meta.fabrica` → 403 nas escritas; nada gravado. Testes: `TestRotasDeRobo` (Task 9), `TestRoboPelaMontagemReal` (Task 10).
5. **Conta escondida pela restritiva de `fabrica_marcas`** — fabricante limitado a A1 (ou lista vazia, ou o "entrar como") não vê a marca de A2 em nenhuma forma de pedido. Teste: `TestNadaVazaEntreContas` (Task 10).

---

## Interfaces que este plano consome

(Dos planos; o pré-voo confere cada uma. Nome diferente só de campo/função: use o real em todo o plano. Semântica diferente: **pare e reporte**.)

- **5.0** — `dados.Consulta{Tabela, Alias, SQL, Onde; Filtros []Filtro; Ordens map[string]string; OrdemPadrao, Desempate string}` com `Validar(cat)`/`Handler(b, cat)` (`panic` na montagem se inválida; `contar=1` → `X-Total-Count` sob a MESMA regra; teto 1000; parâmetro desconhecido = 400; subconsulta escalar na lista do select com `{ler:<tabela>:<alias>}`); `dados.Filtro{Param, SQL, Tipo}` (`texto|uuid|inteiro|data|instante|booleano`, sufixo `[]` = lista por vírgula); `dados.LerCorpo` (`DisallowUnknownFields`, 1 MiB), `dados.Erro`, `dados.Responder`, `dados.ErroDeEscrita`, `dados.ErroDoBanco`, `dados.Campos`. `autz`: `Producao`, `Escopo{ID, TemPerfil, Ativo, Papel, SuperFicha, Modulos, Chaves, TodasContas, Contas…}`, `CarregarEscopo`, `EscopoDo`, `ComEscopo`, `Ler/Criar/Editar/Apagar`, `(*Catalogo).Filtro/PodeCriar/PodeApagar`, `Conferir`, `ErrNegado`, `ErrNaoEncontrado`, `Regra`. `auth`: `Ator{ID, Tipo, Papel, SuperAdmin, Modulos, ImpersonadorID}`, `AtorDoContexto`, `Exigir` (aceita sessão `painel` e `servico`), `NovoStore`, `(*Store).Criar(ctx, id, tipo, impersonador)`. `banco.ComUsuario`. `web.Rotas`, `comPrazo`, `PrazoDominio` (30 s), mapas `publicas`/`soSessao` de `rotas_test.go`. `config.Config`/`Segredos()`, `config.ArquivosDir`.
- **5.1** — `testebanco.ComEsquemaDeProducao(t)` (compat + migrações + `esquema/*.sql` em ordem de nome; nomes `01-tabelas-5-NN.sql`, `02-gatilhos.sql`, `03-funcoes-5-NN.sql`, dois dígitos, conferidos por `esquema_test.go`); `01-tabelas-5-01.sql` com `ia_execucoes` (`db/migrations/025_ia_execucoes.sql`); `dados.Tabela{Nome, Resposta, Autor}` com `Validar`, `Criar`, `Editar`, `Apagar`.
- **5.2 (fundação comum)** — `dados.SoSessaoPropria(frase)`, `dados.FraseEntrarComo`; `testebanco/mundoteste`: `Pessoa{Chave, ID, Email, Papel; Super, Trava, Desativado; Modulos, Contas}`, `Opcoes{Pessoas, Linhas, Impersonadas}`, `Novo(t, o, montar...)`, `Mundo{P, H, Tok}` com `Resposta/Pedir/Um/Rodar`, `Caso{…}`. A `Pessoa` não tem `permissions`: o mundo grava a chave `meta.fabrica` pelo SQL de `Linhas` (roda depois das pessoas).
- **5.5** — a fatia D0 com `gc_vendas_item (mes, canal_loja_id bigint, sku, produto, categoria, unidades int, faturamento numeric)`, `gc_estoque_item (deposito_id bigint, sku, produto, categoria, saldo int)` e `gestao_comercial_briefings (id, rodada date, dados_json jsonb, created_at)` (`01-tabelas-5-05.sql`; plano 5.5, Task 1). Só a Task 7 (`fabrica-candidatos`) depende dela.
- **5.6** — `autz.PodeVerConta(e, conta)`; nada mais (a fábrica não lê tabela de métrica).
- **5.7** — `esquema/01-tabelas-5-07.sql` JÁ declara `fabrica_marcas` completa (Ruling 5.7-1: id, nome, caption_template, ad_account, page_id, ig_id, account_id **text**, ativo, created_at, segmento, termos_produto); a fatia 5.8 **não a redeclara**. `POST /buscar-lugar` (`mapa.Novo`) e `GET /gestao-trafego/interesses-sugeridos?marca_id=&objetivo=` já servem ao `painel-subir.vue` (5.8 não porta outro). O `init` de `cmd/api/conferir.go` respeita o tipo declarado de `account_id` (Ruling 5.7-16).
- **5.13 (trilha A: contas de serviço)** — cada robô é um `usuarios` + `profiles` próprio (papel `viewer`, `features` mínimas, `allowed_accounts` nulo, sem senha); `tokens_de_servico (id, usuario_id, nome único, token_hash sha256, criado_em, revogado_em, ultimo_uso_em)`; `Authorization: Bearer <token>` → sessão/`Ator{Tipo:"servico"}` do usuário do robô, com o PERFIL dele (catálogo, módulo e conta valem como para gente); usuário ou perfil desativado = 401; **`auth.SoServico`** (middleware: sessão que não é `servico` = 403 `sem_permissao`) para as rotas de robô; CLI `api servico criar <nome> <email>` / `revogar <nome>` / `listar`. **Sem escopos por token** (decisão final da orquestradora, COORDENACAO 12/10). Os testes deste plano criam a sessão de serviço com `(*auth.Store).Criar(ctx, id, "servico", nil)` (já existe; `auth.Exigir` já aceita o tipo). Se o 5.13 ainda não estiver mesclado, a Task 3 cria `auth.SoServico` com o código EXATO de lá (abaixo); quando o 5.13 entrar, fica a versão dele.

## Interfaces que este plano entrega

- `github.Novo(token string) *github.Cliente` com `Configurado() bool`, `Disparar(ctx, nome, entradas map[string]string) error`, `Cancelar(ctx, nome, runID string) error`; `github.Disparos` (lista fechada; 5.10 e o Plano 6 acrescentam UMA entrada cada); `*github.Erro{Classe, Status, EsperarAte}` com as classes `TokenInvalido`, `SemPermissao`, `NaoEncontrado`, `Recusado`, `Limite`, `Indisponivel`, `Incerto`, `Inesperado`; `github.ErrSemToken`, `ErrDesconhecido`, `ErrEntrada` (Task 2).
- `config.Config.GitHubPAT` (`GITHUB_PAT`, em `Segredos()`) (Task 2).
- `fabrica.Fabricante` (`autz.Regra`) e `fabrica.Montar(r chi.Router, p *pgxpool.Pool, gh *github.Cliente, arquivos string)` (Tasks 3 e 10).
- As rotas de robô `/fabrica/robo/…` (Task 9), com o contrato que o Plano 7 usa para trocar o REST do Supabase no `coletor/fabrica-job-runner.mjs` e módulos.
- `auth.SoServico` **só se** o 5.13 não o tiver entregado (Task 3, código idêntico ao contrato do 5.13).
- D0: `esquema/01-tabelas-5-08.sql` (as 8 tabelas da Fábrica que faltam; nenhuma função nem gatilho em produção).

## Pré-voo (antes da Task 1)

- [ ] `cd /Users/gabrielgertrudes/Projetos/Trabalho/lavessel/social-dashboard/.claude/worktrees/p5-58 && git status --short && git branch --show-current` → vazio (ou só este plano); `feat/api-go-plano-5-8`.
- [ ] Trazer as dependências executadas: `git merge --no-edit feat/api-go-plano-5-7` e `git merge --no-edit feat/api-go-plano-5-5` (e `feat/api-go-plano-5-13`, se já existir com código). Conferir:
  ```bash
  grep -c 'create table public.fabrica_marcas' api/internal/testebanco/esquema/01-tabelas-5-07.sql   # 1 (do 5.7)
  grep -c 'create table public.gc_vendas_item\|create table public.gc_estoque_item\|create table public.gestao_comercial_briefings' api/internal/testebanco/esquema/01-tabelas-5-05.sql  # 3 (do 5.5)
  grep -c 'create table public.ia_execucoes' api/internal/testebanco/esquema/01-tabelas-5-01.sql   # 1
  grep -rn 'create table public.fabrica_\(lojas\|campanhas\|criativos\|jobs\|meta_jobs\|objetivos\|publicos\|looks\)' api/internal/testebanco/esquema/  # vazio
  grep -c 'func PodeVerConta' api/internal/autz/predicados.go                                     # 1
  grep -c 'func SoSessaoPropria\|FraseEntrarComo' api/internal/dados/sessao.go                    # ≥ 2
  grep -c 'func Novo' api/internal/testebanco/mundoteste/mundoteste.go                            # 1
  grep -c 'func RotaCriar\|func RotaEditar\|func RotaApagar' api/internal/dados/escrita.go        # 3
  grep -c 'func apagar(raiz \*os.Root' api/internal/fabrica/purga.go                              # 1 (a Task 6 reusa)
  grep -n 'se.Tipo != "painel" && se.Tipo != "servico"' api/internal/auth/middleware.go          # 1 linha
  grep -rn 'func SoServico' api/internal/auth/                                                   # 1 linha (5.13) OU vazio (Task 3 cria)
  grep -rn 'tokens_de_servico' api/internal/banco/migracoes/                                      # 5.13 mesclado? (só informativo)
  grep -rn 'GITHUB_PAT\|internal/github' api/                                                     # vazio
  cd api && go list -deps ./internal/fabrica | grep -c 'internal/web'                             # 0 (sem ciclo)
  ```
  Qualquer `0` onde se espera ≥ 1: a dependência não terminou — **pare e reporte**. Sem a fatia do 5.5: siga com todas as tasks MENOS a 7 (`fabrica-candidatos`), que espera o merge do 5.5. A fatia do 5.5 com nome de um dígito (`01-tabelas-5-5.sql`): ela é renomeada pelo próprio 5.5 (regra do `esquema_test.go`); use o nome que estiver no disco.
- [ ] **5.13 (contas de serviço):** se `func SoServico` existe, confira a forma: `func SoServico(next http.Handler) http.Handler` (use `r.With(auth.SoServico)`). Se o 5.13 a entregou como fábrica (`SoServico()`), use `r.With(auth.SoServico())` em todo o plano. Se o 5.13 mudou `auth.Exigir` para só aceitar `servico` vindo de `tokens_de_servico` (sessão de `Store.Criar(…, "servico", …)` recusada), troque o ajudante `sessaoDeServico` da Task 3 pelo ajudante de teste do 5.13 que cria usuário de robô + token (ex.: `servicoteste.Novo(t, p, nome, email)`) e use o token devolvido: os casos e as asserções não mudam.
- [ ] `go version` → `go1.26`+.
- [ ] Docker no ar, porta livre (`lsof -iTCP:58548 -sTCP:LISTEN` → vazio) e o banco das etapas:
  ```bash
  docker run -d --rm --name pg-plano58 -e POSTGRES_PASSWORD=x -p 127.0.0.1:58548:5432 postgres:17
  until docker exec pg-plano58 pg_isready -h 127.0.0.1 -U postgres >/dev/null 2>&1; do sleep 1; done
  export TEST_DATABASE_URL='postgres://postgres:x@localhost:58548/postgres?sslmode=disable'
  ```
- [ ] Linha de base: `cd api && go test ./... && go test -v ./... 2>&1 | grep -c -- '--- SKIP'` → tudo `ok` e `0`.

## Estrutura de arquivos

```
api/internal/testebanco/esquema/01-tabelas-5-08.sql     # as 8 tabelas da Fábrica (fabrica_marcas é do 5.7), fonte por bloco
api/internal/testebanco/esquema_fabrica_test.go         # TestFatiaDaFabrica
api/internal/github/github.go          (+ github_test.go) # cliente, lista fechada, classes de erro
api/internal/config/config.go          (+ config_test.go) # GitHubPAT (GITHUB_PAT) em Segredos()
api/internal/auth/servico.go           (+ servico_test.go) # SoServico — SÓ se o 5.13 não a trouxe
api/internal/fabrica/fabrica.go                          # doc, Fabricante, soFabricante, soSessaoPropria, ajudantes
api/internal/fabrica/mundo_test.go, fabrica_test.go      # pessoas, robôs, linhas, foto; TestMundoDaFabrica, TestFabricanteIgualAPolicy
api/internal/fabrica/leituras.go       (+ _test)         # 9 GETs + POST /fabrica/criativos/escolher
api/internal/fabrica/disparo.go        (+ _test)         # POST /fabrica-trigger
api/internal/fabrica/apagar.go         (+ _test)         # POST /fabrica-apagar
api/internal/fabrica/candidatos.go     (+ _test)         # POST /fabrica-candidatos
api/internal/fabrica/curadoria.go      (+ _test)         # POST /fabrica-looks, POST /fabrica-publicos
api/internal/fabrica/robo.go           (+ _test)         # /fabrica/robo/… (só sessão de serviço)
api/internal/fabrica/rotas.go          (+ rotas_test.go) # Montar; varreduras de vazamento, impersonado e robô
api/internal/web/rotas.go, rotas_test.go                 # montagem, soSessao, TestFabricaPelaMontagemReal
api/cmd/api/conferir.go                (+ conferir_test.go) # colunas, tipos, únicos da Fábrica
docs/migracao-go/NOTAS-DA-IMPLANTACAO.md                 # seção do 5.8
```

**Não toca:** `esquema/gerar-gatilhos.mjs` nem `02-gatilhos.sql` (nenhuma das 9 tabelas tem gatilho em produção: `levantamento/03-triggers.csv` não as cita; nem função: `02-funções.csv` idem); `autz` (as 18 policies já compilam: `termoChave("meta.fabrica")`, `termoSuper()`, `podeVerConta`); `meta`/`meta-proxy` (o `painel-subir.vue` continua usando o do Plano 3 com o escopo do 5.6); `fabrica/purga.go` (só reusa `apagar`); `coletor/` e `src/` (Plano 7).

## Tarefas

| # | Task | Revisor | Depende de |
|---|---|---|---|
| 1 | D0: fatia 5.8 (8 tabelas, FKs para `fabrica_marcas` do 5.7 e `usuarios`) | **opus** (dados: tudo é provado contra isto) | 5.1 T1, 5.7 T1 |
| 2 | `internal/github`: cliente, lista fechada, classes de erro, `GITHUB_PAT` | **opus** (PAT, despacho) | — |
| 3 | `fabrica`: fundação (`Fabricante` provado contra a policy, mundo com robôs, foto) e `auth.SoServico` se faltar | **opus** (portão de toda escrita) | 1 |
| 4 | Leituras do painel (9) e `POST /fabrica/criativos/escolher` | sonnet | 3 |
| 5 | `POST /fabrica-trigger` (rodada + job numa transação, despacho fora dela, falha que não deixa job pendurado) | **opus** (gasto, GitHub) | 2, 3 |
| 6 | `POST /fabrica-apagar` (banco, run cancelado, arquivos só dentro da raiz; idempotente) | **opus** (apagar arquivo) | 2, 3 |
| 7 | `POST /fabrica-candidatos` (port fiel do cálculo, lojas só da Fábrica) | sonnet | 3, 5.5 T1 |
| 8 | `POST /fabrica-looks` e `POST /fabrica-publicos` | sonnet | 3 |
| 9 | Rotas de robô (`/fabrica/robo/…`): jobs, próximo lote, campanha, criativos, look, rastro da Meta, execução | **opus** (sessão de serviço, perfil do robô) | 3 |
| 10 | Montagem, varreduras (conta, impersonado, robô), `conferir` e notas | **opus** (fronteira) | 4–9 |

---

<!-- EM ESCRITA: Tasks 1–10, inventário, paralelização, Rulings, achados e cobertura vêm nos próximos commits. -->
