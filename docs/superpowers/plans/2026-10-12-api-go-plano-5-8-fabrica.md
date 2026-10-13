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

### Task 1: D0 — fatia 5.8 do esquema de produção nos testes

**Revisor:** opus. **Depende de:** 5.1 Task 1 (carregador, `usuarios`, `profiles`), 5.7 Task 1 (`fabrica_marcas`).

**(a) Contrato**
- `esquema/01-tabelas-5-08.sql` (abaixo): as 8 tabelas da linha 5.8 que faltam (`fabrica_marcas` já está em `01-tabelas-5-07.sql`, Ruling 5.7-1), cada bloco com a migration de origem. Todas as 8 têm DDL no repositório (`db/migrations/014`–`030` e `2026-09-09-fabrica-loja-iguatemi.sql`): nenhum presumido. FKs de `auth.users` viram `public.usuarios` (como no dump limpo, `ops/migracao/limpar-dump.mjs:64`). `fabrica_lojas.marca_id` e `fabrica_publicos.marca_id` apontam para a `fabrica_marcas` do 5.7 (carrega antes: ordem do nome).
- Nenhuma função, gatilho nem `03-funcoes-5-08.sql`: o levantamento não tem gatilho nem função sobre `fabrica_*` (`grep fabrica levantamento/03-triggers.csv` = vazio). O comentário "setado no trigger" de `021_fabrica_campanhas_status.sql:6` é antigo: o `status` nasce do default.
- As colunas aposentadas não entram (`fabrica_criativos.candidato_id`, `fabrica_rodadas`, `fabrica_candidatos`: `019_fabrica_remove_f1.sql`).

**(b) Testes de aceitação** (`TestFatiaDaFabrica`, `esquema_fabrica_test.go`, num `testebanco.ComEsquemaDeProducao`)
- As 9 tabelas existem (`to_regclass`), com `fabrica_marcas` vinda do 5.7.
- Nenhum gatilho nelas: `select count(*) from pg_trigger g join pg_class c on c.oid = g.tgrelid where not g.tgisinternal and c.relname like 'fabrica\_%'` = `0`.
- Defaults: `insert into fabrica_campanhas (nome) values ('x') returning status, objetivo, desconto_tipo, parcelas` = `gerando|engajamento|fixo|10`; `insert into fabrica_jobs (tipo) values ('gerar') returning status, params::text` = `enfileirado|{}`; `fabrica_looks` nova com `excluido = false`, `tipo = 'codigo'`; `fabrica_publicos` nova com `idade_min 18`, `idade_max 65`, `generos '{}'`.
- FKs: `delete from fabrica_campanhas where id = <C>` leva os criativos dela (`on delete cascade`); `delete from fabrica_marcas where id = <M>` deixa o público dela com `marca_id` nulo (`on delete set null`); `fabrica_jobs.criado_por` e `fabrica_campanhas.criado_por` inexistentes → `23503`; `fabrica_lojas.marca_id` inexistente → `23503`.
- Tipos que as rotas presumem: `select format_type(atttypid, atttypmod) from pg_attribute where attrelid = 'fabrica_lojas'::regclass and attname = 'deposito_id'` = `text` (e `canal_loja_id` = `text`, `geo_cities` = `jsonb`, `fabrica_criativos.preco_de` = `numeric`, `fabrica_publicos.generos` = `integer[]`, `fabrica_looks.objetivos` = `text[]`, `fabrica_meta_jobs.payload` = `jsonb`).
- Mutações que têm de reprovar: tirar o `on delete cascade` de `fabrica_criativos.campanha_id` (o apagar da Task 6 deixaria criativos órfãos; aqui o caso do cascade); declarar `fabrica_marcas` de novo nesta fatia (a carga quebra: `42P07`); `deposito_id bigint` em `fabrica_lojas` (o teste de tipo e a Task 7 reprovam).

**(c) Arquivos:** Create `api/internal/testebanco/esquema/01-tabelas-5-08.sql`, `api/internal/testebanco/esquema_fabrica_test.go`.

**(d) Dependências:** 5.1 Task 1; 5.7 Task 1.

- [ ] **Step 1: A DDL da fatia.** Crie `api/internal/testebanco/esquema/01-tabelas-5-08.sql`:

```sql
-- FATIA 5.8 do esquema de produção para os testes (D0 reconstruído: Rulings 5.1-1, 5.7-1 e 5.8-1).
-- Carrega depois de 01-tabelas-5-07.sql (que declara fabrica_marcas: NÃO redeclarar aqui; coluna que
-- faltar entra com `alter table public.fabrica_marcas add column if not exists …`). Nenhum gatilho nem
-- função de produção nestas tabelas (levantamento/03-triggers.csv e 02-funções.csv). FKs de auth.users
-- viram public.usuarios (ops/migracao/limpar-dump.mjs:64). Todas com DDL no repositório: sem presumido.

-- db/migrations/014_fabrica_anuncios.sql:6-11 + 018_fabrica_marcas_lojas.sql:19-22
create table public.fabrica_lojas (
  deposito_id   text primary key,
  nome          text not null,
  ativo         boolean not null default true,
  ordem         int not null default 0,
  marca_id      uuid references public.fabrica_marcas(id),
  whatsapp      text,
  geo_cities    jsonb,
  canal_loja_id text
);

-- db/migrations/015_fabrica_criativos.sql:2-9 + 017_fabrica_jobs_lifecycle.sql:22-23
-- + 021_fabrica_campanhas_status.sql:2-4 (criado_por: auth.users → usuarios) + 022_fabrica_objetivos.sql:2
create table public.fabrica_campanhas (
  id            uuid primary key default gen_random_uuid(),
  nome          text not null,
  desconto_tipo text not null default 'fixo',
  desconto_pct  numeric,
  parcelas      int not null default 10,
  created_at    timestamptz not null default now(),
  fechada_em    timestamptz,
  purgado_em    timestamptz,
  status        text not null default 'gerando',
  job_id        uuid,
  criado_por    uuid references public.usuarios(id),
  objetivo      text not null default 'engajamento'
);

-- db/migrations/015_fabrica_criativos.sql:11-25 sem candidato_id (019_fabrica_remove_f1.sql:2)
-- + 017:24 (purgado_em) + 020_fabrica_criativos_legenda.sql:2 + 029_fabrica_criativos_sku.sql:4
create table public.fabrica_criativos (
  id           uuid primary key default gen_random_uuid(),
  campanha_id  uuid references public.fabrica_campanhas(id) on delete cascade,
  arquetipo    text not null,
  template     text not null,
  formato      text not null,
  variante     text,
  preco_de     numeric,
  preco_por    numeric,
  storage_path text,
  url          text,
  escolhido    boolean not null default false,
  created_at   timestamptz not null default now(),
  purgado_em   timestamptz,
  legenda      text,
  sku          text
);
create index idx_fab_criativos_campanha on public.fabrica_criativos (campanha_id);

-- db/migrations/016_fabrica_meta_jobs.sql:2-15
create table public.fabrica_meta_jobs (
  id               uuid primary key default gen_random_uuid(),
  conta_id         uuid,
  ad_account_id    text,
  loja             text,
  tipo             text,
  meta_campaign_id text,
  adset_ids        jsonb,
  ad_ids           jsonb,
  payload          jsonb,
  status           text not null default 'criado',
  erro             text,
  created_at       timestamptz not null default now()
);

-- db/migrations/017_fabrica_jobs_lifecycle.sql:3-14 (criado_por: auth.users → usuarios)
create table public.fabrica_jobs (
  id            uuid primary key default gen_random_uuid(),
  tipo          text not null,
  params        jsonb not null default '{}'::jsonb,
  status        text not null default 'enfileirado',
  github_run_id text,
  resultado     jsonb,
  erro          text,
  criado_por    uuid references public.usuarios(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- db/migrations/022_fabrica_objetivos.sql:4-18
create table public.fabrica_objetivos (
  chave                text primary key,
  rotulo               text not null,
  descricao            text not null default '',
  meta_objective       text not null,
  optimization_goal    text not null,
  billing_event        text not null default 'IMPRESSIONS',
  destination_type     text,
  promoted_object_tipo text not null default 'none',
  cta_type             text not null default 'LEARN_MORE',
  looks                text[] not null default '{}',
  pede_desconto        boolean not null default true,
  ativo                boolean not null default true,
  ordem                int not null default 0
);

-- db/migrations/023_fabrica_publicos.sql:2-15
create table public.fabrica_publicos (
  id               uuid primary key default gen_random_uuid(),
  nome             text not null,
  marca_id         uuid references public.fabrica_marcas(id) on delete set null,
  geo              jsonb not null default '{}'::jsonb,
  idade_min        int not null default 18,
  idade_max        int not null default 65,
  generos          int[] not null default '{}',
  interesses       jsonb not null default '[]'::jsonb,
  custom_audiences jsonb not null default '[]'::jsonb,
  ativo            boolean not null default true,
  criado_por       uuid,
  created_at       timestamptz not null default now()
);

-- db/migrations/024_fabrica_looks.sql:2-15 + 030_fabrica_looks_excluido.sql:4
create table public.fabrica_looks (
  chave             text primary key,
  nome              text not null,
  arquetipo         text not null,
  objetivos         text[] not null default '{}',
  ativo             boolean not null default true,
  ordem             int not null default 0,
  preview_url       text,
  tipo              text not null default 'codigo',
  canva_formato_map jsonb not null default '{}'::jsonb,
  campo_map         jsonb not null default '{}'::jsonb,
  criado_por        uuid,
  created_at        timestamptz not null default now(),
  excluido          boolean not null default false
);
```

- [ ] **Step 2: O teste.** `api/internal/testebanco/esquema_fabrica_test.go` com `TestFatiaDaFabrica` (casos de (b); cada inserção numa transação desfeita, como `TestFatiaDoTrafego` do 5.7; usuário de FK criado em `usuarios` no começo).
- [ ] **Step 3:** `cd api && gofmt -l ./internal && go test -count=1 -run 'TestFatia|TestEsquema' ./internal/testebanco/` PASS (inclui o teste de nomes de dois dígitos do 5.1); mutações reprovam.
- [ ] **Step 4: Commit** `test(api): D0 — fatia 5.8 do esquema (as 8 tabelas da Fábrica; fabrica_marcas fica no 5.7)` (+ `Co-Authored-By`).

---

### Task 2: `internal/github` — despacho de workflow com o PAT em variável de ambiente

**Revisor:** opus. **Depende de:** nada (pacote sem banco).

**(a) Contrato**
- `github.Disparos` é a lista FECHADA (Ruling 5.8-4): nome → repositório, arquivo do workflow, ref e entradas aceitas, cada entrada com o seu formato. O pedido escolhe só o NOME e os VALORES das entradas declaradas; entrada faltando, sobrando ou fora do formato = `ErrEntrada` sem chamada. Hoje uma entrada: `"fabrica"` (`fabrica.yml`, `main`, `job_id` uuid). O 5.10 acrescenta `"vessel-fotos"` (`fotos-do-selo.yml`) e `"vessel-cartoes"` (`cartoes-ean.yml`), sem entradas; o Plano 6, as dele. O Conteúdo (5.9) vai para a VPS e NÃO usa este pacote.
- `Novo(token)`: token SÓ do chamador (que o lê de `config.GitHubPAT` = `GITHUB_PAT`). `http.Client` com `Timeout` de 15 s e `CheckRedirect` que NÃO segue (o `Authorization` nunca vai a outro host; 3xx = `Inesperado`). URL base `https://api.github.com` em campo não exportado (só os testes do pacote trocam).
- `Disparar`: `POST /repos/<repo>/actions/workflows/<arquivo>/dispatches` com `{"ref":…,"inputs":{…}}` (sem `inputs` quando não há entradas), cabeçalhos `Authorization: Bearer`, `Accept: application/vnd.github+json`, `X-GitHub-Api-Version: 2022-11-28`, `User-Agent: api-central`. 2xx = sucesso (204 é o de hoje). `Cancelar`: `POST /repos/<repo>/actions/runs/<runID>/cancel`; `runID` só dígitos (1–20); 409 ("já terminou") conta como sucesso (idempotente).
- Classes (`*Erro`; Ruling 5.8-5): 401 → `TokenInvalido`; 403 com `X-RateLimit-Remaining: 0` ou `Retry-After`, e 429 → `Limite` (`EsperarAte` de `Retry-After` ou `X-RateLimit-Reset`, padrão 1 min); outro 403 → `SemPermissao`; 404 → `NaoEncontrado`; 422 → `Recusado`; 5xx → `Indisponivel`; sem resposta: DNS ou conexão recusada → `Indisponivel` (o pedido não saiu), prazo/rede depois de conectar → `Incerto` (pode ter chegado); outro status → `Inesperado`. Nenhuma repetição automática: um despacho repetido acordaria o robô duas vezes (Ruling 5.8-5).
- O corpo de resposta do GitHub é lido até 64 KiB e descartado; `Erro.Error()` = `github: <classe> (<status>)`: sem URL, sem token, sem corpo.
- `config.Config.GitHubPAT` (`GITHUB_PAT`, aparado) entra em `Segredos()`.
- `ParaTeste(t, token, base)`: o cliente apontando para um GitHub de mentira, para os testes de OUTROS pacotes (fabrica, 5.10). Recebe `testing.TB` (o tipo deixa explícito que é de teste) e recusa base que não seja loopback (`127.0.0.1`, `::1`, `localhost`): nem por engano aponta para um host de verdade (Ruling 5.8-4).

```go
// Package github dispara workflows do GitHub Actions e cancela execuções com um token pessoal (PAT) que
// SÓ vem do chamador (config.GitHubPAT = GITHUB_PAT). Lista FECHADA: o pedido escolhe o nome de um
// Disparo e os valores das entradas declaradas; repositório, arquivo e ref são texto deste arquivo.
// Consumidores: fabrica (5.8), retaguardas da Vessel (5.10), Plano 6. Novo consumidor = uma entrada em
// Disparos e o caso dela em TestDispararListaFechada (Ruling 5.8-4).
package github

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"maps"
	"net"
	"net/http"
	"net/url"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"syscall"
	"testing"
	"time"
)

// repoDoPainel: o repositório dos workflows (o GITHUB_REPO das edges). Constante: nunca do pedido.
const repoDoPainel = "rbv-co/social-dashboard"

var (
	reUUID  = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)
	reRunID = regexp.MustCompile(`^[0-9]{1,20}$`)

	reRepo     = regexp.MustCompile(`^[a-z0-9-]{1,39}/[a-z0-9._-]{1,100}$`)
	reWorkflow = regexp.MustCompile(`^[a-z0-9-]{1,80}\.ya?ml$`)
	reRef      = regexp.MustCompile(`^[a-z0-9][a-z0-9._/-]{0,99}$`)
)

// Disparo é um workflow que a API pode acordar. Entradas: nome do input → formato aceito (todas
// obrigatórias; nenhuma outra).
type Disparo struct {
	Repo, Workflow, Ref string
	Entradas            map[string]*regexp.Regexp
}

// Disparos: a lista fechada. 5.10: "vessel-fotos" (fotos-do-selo.yml) e "vessel-cartoes" (cartoes-ean.yml).
var Disparos = map[string]Disparo{
	"fabrica": {Repo: repoDoPainel, Workflow: "fabrica.yml", Ref: "main", Entradas: map[string]*regexp.Regexp{"job_id": reUUID}},
}

var (
	ErrSemToken     = errors.New("github: GITHUB_PAT ausente")
	ErrDesconhecido = errors.New("github: disparo fora da lista")
	ErrEntrada      = errors.New("github: entrada inválida")
)

type Classe string

const (
	TokenInvalido Classe = "token_invalido" // 401: token vencido ou revogado
	SemPermissao  Classe = "sem_permissao"  // 403: token sem "Actions: Read and write" no repositório
	NaoEncontrado Classe = "nao_encontrado" // 404: workflow fora da ref, repositório errado, token sem acesso
	Recusado      Classe = "recusado"       // 422: input que o workflow não declara, workflow sem workflow_dispatch
	Limite        Classe = "limite"         // 429 ou 403 de limite
	Indisponivel  Classe = "indisponivel"   // 5xx, DNS, conexão recusada: o pedido NÃO foi aceito
	Incerto       Classe = "incerto"        // sem resposta depois de conectar: pode ter sido aceito
	Inesperado    Classe = "inesperado"     // 3xx (não seguimos) ou status fora da lista
)

// Erro: a falha classificada. Nunca carrega URL, token nem o corpo do GitHub.
type Erro struct {
	Classe     Classe
	Status     int           // 0 = sem resposta
	EsperarAte time.Duration // só em Limite
}

func (e *Erro) Error() string { return fmt.Sprintf("github: %s (%d)", e.Classe, e.Status) }

// Cliente fala com a API REST do GitHub. Zero valor não serve: use Novo.
type Cliente struct {
	token string
	base  string // https://api.github.com; só os testes deste pacote trocam
	http  *http.Client
}

func Novo(token string) *Cliente {
	return &Cliente{token: strings.TrimSpace(token), base: "https://api.github.com", http: &http.Client{
		Timeout: 15 * time.Second,
		// nunca segue: o Authorization não pode ir a outro host (3xx vira Inesperado)
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
	}}
}

// ParaTeste: o cliente falando com um GitHub de mentira (httptest) — para os testes de outros pacotes
// (fabrica, 5.10). Base que não é loopback derruba o teste: nunca aponta para um host de verdade.
func ParaTeste(t testing.TB, token, base string) *Cliente {
	t.Helper()
	if !loopback(base) {
		t.Fatalf("github.ParaTeste: base %q não é loopback", base)
	}
	c := Novo(token)
	c.base = strings.TrimRight(base, "/")
	return c
}

func loopback(base string) bool {
	u, err := url.Parse(base)
	return err == nil && u.Scheme == "http" && (u.Hostname() == "127.0.0.1" || u.Hostname() == "::1" || u.Hostname() == "localhost")
}

// Configurado: há token. Sem ele, quem chama responde 503 ANTES de gravar qualquer coisa.
func (c *Cliente) Configurado() bool { return c != nil && c.token != "" }

func (d Disparo) conferir(entradas map[string]string) error {
	if !slices.Equal(slices.Sorted(maps.Keys(entradas)), slices.Sorted(maps.Keys(d.Entradas))) {
		return ErrEntrada
	}
	for k, v := range entradas {
		if !d.Entradas[k].MatchString(v) {
			return ErrEntrada
		}
	}
	return nil
}

// Disparar acorda o workflow `nome` com as entradas. Sem repetição: quem chama decide o que fazer
// com cada classe (Ruling 5.8-5).
func (c *Cliente) Disparar(ctx context.Context, nome string, entradas map[string]string) error {
	d, ok := Disparos[nome]
	if !ok {
		return ErrDesconhecido
	}
	if err := d.conferir(entradas); err != nil {
		return err
	}
	if !c.Configurado() {
		return ErrSemToken
	}
	corpo := map[string]any{"ref": d.Ref}
	if len(entradas) > 0 {
		corpo["inputs"] = entradas
	}
	j, err := json.Marshal(corpo)
	if err != nil {
		return err
	}
	return c.chamar(ctx, "/repos/"+d.Repo+"/actions/workflows/"+d.Workflow+"/dispatches", j)
}

// Cancelar pede o cancelamento da execução runID (lida do banco, gravada pelo robô) no repositório do
// disparo `nome`. Execução já terminada (409) conta como cancelada.
func (c *Cliente) Cancelar(ctx context.Context, nome, runID string) error {
	d, ok := Disparos[nome]
	if !ok {
		return ErrDesconhecido
	}
	if !reRunID.MatchString(runID) {
		return ErrEntrada
	}
	if !c.Configurado() {
		return ErrSemToken
	}
	err := c.chamar(ctx, "/repos/"+d.Repo+"/actions/runs/"+runID+"/cancel", nil)
	var e *Erro
	if errors.As(err, &e) && e.Status == http.StatusConflict {
		return nil
	}
	return err
}

func (c *Cliente) chamar(ctx context.Context, caminho string, corpo []byte) error {
	var leitor io.Reader = http.NoBody
	if corpo != nil {
		leitor = bytes.NewReader(corpo)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.base+caminho, leitor)
	if err != nil {
		return &Erro{Classe: Inesperado}
	}
	req.Header.Set("Authorization", "Bearer "+c.token)
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("X-GitHub-Api-Version", "2022-11-28")
	req.Header.Set("User-Agent", "api-central")
	if corpo != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return semResposta(err)
	}
	defer resp.Body.Close()
	io.Copy(io.Discard, io.LimitReader(resp.Body, 64<<10)) // o corpo do GitHub não sai daqui
	return classificar(resp)
}

func classificar(resp *http.Response) error {
	s := resp.StatusCode
	limite := resp.Header.Get("X-RateLimit-Remaining") == "0" || resp.Header.Get("Retry-After") != ""
	switch {
	case s >= 200 && s < 300:
		return nil
	case s == http.StatusTooManyRequests || (s == http.StatusForbidden && limite):
		return &Erro{Classe: Limite, Status: s, EsperarAte: esperar(resp.Header)}
	case s == http.StatusUnauthorized:
		return &Erro{Classe: TokenInvalido, Status: s}
	case s == http.StatusForbidden:
		return &Erro{Classe: SemPermissao, Status: s}
	case s == http.StatusNotFound:
		return &Erro{Classe: NaoEncontrado, Status: s}
	case s == http.StatusUnprocessableEntity:
		return &Erro{Classe: Recusado, Status: s}
	case s >= 500:
		return &Erro{Classe: Indisponivel, Status: s}
	}
	return &Erro{Classe: Inesperado, Status: s}
}

func esperar(h http.Header) time.Duration {
	if n, err := strconv.Atoi(h.Get("Retry-After")); err == nil && n >= 0 {
		return time.Duration(n) * time.Second
	}
	if n, err := strconv.ParseInt(h.Get("X-RateLimit-Reset"), 10, 64); err == nil {
		if d := time.Until(time.Unix(n, 0)); d > 0 {
			return d
		}
	}
	return time.Minute
}

// semResposta: DNS e conexão recusada = o pedido não saiu; o resto (prazo, conexão caída) = incerto.
// O *url.Error (que tem o host e o caminho) não sai daqui.
func semResposta(err error) error {
	var dns *net.DNSError
	if errors.As(err, &dns) || errors.Is(err, syscall.ECONNREFUSED) {
		return &Erro{Classe: Indisponivel}
	}
	return &Erro{Classe: Incerto}
}
```

E em `api/internal/config/config.go`: o campo `GitHubPAT string // GITHUB_PAT: token do GitHub para disparar workflows (fabrica-trigger; 5.10; Plano 6); é segredo`, a leitura `GitHubPAT: strings.TrimSpace(os.Getenv("GITHUB_PAT")),` e `c.GitHubPAT` na lista de `Segredos()`.

**(b) Testes de aceitação** (`github_test.go`, interno; o GitHub de mentira é um `httptest.Server` que guarda método, caminho, cabeçalhos e corpo de cada pedido e responde o status/cabeçalhos do caso; `c := Novo("SEGREDO-pat"); c.base = srv.URL`)
- `TestListaFechadaBemFormada`: toda entrada de `Disparos` passa em `reRepo`, `reWorkflow`, `reRef`, sem `..`, e tem formato não-nulo para cada entrada (pega erro de digitação de quem acrescentar).
- `TestDispararListaFechada`: `Disparar(ctx, "fabrica", {"job_id": <uuid>})` → 1 pedido `POST /repos/rbv-co/social-dashboard/actions/workflows/fabrica.yml/dispatches`, corpo `{"inputs":{"job_id":"<uuid>"},"ref":"main"}`, `Authorization: Bearer SEGREDO-pat`, `Accept`, `X-GitHub-Api-Version`; nil. Negados com **0 pedidos**: `"outro"` (`ErrDesconhecido`); sem `job_id`, com `job_id` `"../x"`, com entrada a mais `{"job_id":…, "ref":"evil"}` (`ErrEntrada`); `Novo("")` e `Novo("   ")` (`ErrSemToken`, e `Configurado()` falso).
- `TestErrosPorClasse` (tabela): 204 → nil; 200 → nil; 401 → `TokenInvalido`; 403 → `SemPermissao`; 403 + `X-RateLimit-Remaining: 0` + `X-RateLimit-Reset: <agora+120>` → `Limite` com `EsperarAte` entre 100 s e 120 s; 429 + `Retry-After: 30` → `Limite` 30 s; 404 → `NaoEncontrado`; 422 → `Recusado`; 500 e 503 → `Indisponivel`; 302 com `Location: <outro httptest>` → `Inesperado` e o OUTRO servidor com **0 pedidos**; servidor que dorme 200 ms com `c.http.Timeout = 50ms` → `Incerto`; servidor fechado (`srv.Close()` antes) → `Indisponivel` (conexão recusada). Cada caso: `errors.As(err, &e)` e `e.Status`.
- `TestCancelar`: `Cancelar(ctx, "fabrica", "123")` → `POST /repos/rbv-co/social-dashboard/actions/runs/123/cancel` sem corpo; 202 → nil; 409 → nil; 404 → `NaoEncontrado`; runID `"12/../../x"`, `""`, `"1a"` → `ErrEntrada` com 0 pedidos.
- `TestTokenNuncaSai`: para cada classe da tabela acima, `err.Error()` não contém `SEGREDO-pat`, `srv.URL` nem o corpo que o servidor mandou (`{"message":"Bad credentials SEGREDO-corpo"}`); `slog` capturado (`slog.SetDefault` com um `TextHandler` num buffer durante o teste) não contém `SEGREDO`.
- `TestParaTesteSoLoopback`: `loopback` recusa `https://api.github.com`, `http://10.0.0.1`, `https://127.0.0.1` e `http://127.0.0.1.exemplo.com`, e aceita `srv.URL`; `ParaTeste(t, …, srv.URL)` aponta para o servidor de mentira.
- `config_test.go`: `GITHUB_PAT="  SEGREDO-x  "` → `GitHubPAT == "SEGREDO-x"` e `slices.Contains(c.Segredos(), "SEGREDO-x")`.
- Mutações que têm de reprovar: tirar o `CheckRedirect` (o 302 entrega o token ao outro servidor: o caso conta 1 pedido lá); trocar `ErrEntrada` por aceitar entrada a mais (o `"ref":"evil"` chega ao GitHub); tirar o `&& limite` do 403 (o 403 comum vira `Limite`); tratar `Incerto` como `Indisponivel` (o caso do prazo reprova); tirar `c.GitHubPAT` de `Segredos()`.

**(c) Arquivos:** Create `api/internal/github/github.go`, `api/internal/github/github_test.go`; Modify `api/internal/config/config.go`, `api/internal/config/config_test.go`.

**(d) Dependências:** nenhuma.

- [ ] **Step 1:** Testes; ver falhar (o pacote não existe). - [ ] **Step 2:** Implementar (código de (a)). - [ ] **Step 3:** `gofmt -l ./internal && go vet ./internal/github/ ./internal/config/ && go test -count=1 -race ./internal/github/ ./internal/config/` PASS; mutações reprovam. - [ ] **Step 4:** Commit `feat(api): cliente internal/github — lista fechada de workflows, PAT só de GITHUB_PAT, erros por classe e sem seguir redirecionamento` (+ `Co-Authored-By`).

---
### Task 3: `fabrica` — fundação (portão `Fabricante`, mundo com robôs, foto) e `auth.SoServico` se faltar

**Revisor:** opus. **Depende de:** 1; `mundoteste` e `dados.SoSessaoPropria` (5.2, vindos com o 5.7).

**(a) Contrato**
- `api/internal/fabrica/fabrica.go` (abaixo): a doc do pacote passa a ser esta (a linha `// Package fabrica: …` sai de `purga.go`, que fica igual no resto), `Fabricante`, `soFabricante`, `soSessaoPropria`, `deve`, `responder` (corpo das edges: `{"error":…,"detail":…}`, `{"ok":true}`) e os ajudantes de validação de `json.RawMessage` que as Tasks 4–9 usam (moram aqui para elas andarem em paralelo).
- `Fabricante` = a policy de escrita (`fab_camp_write`/`fab_criativos_write`) como regra só de quem pede: perfil existente E ativo (a subconsulta em `profiles` passa pela RLS `auth_read_profiles`: Ruling 6 do mestre) E (papel `admin` OU `is_superadmin` da ficha OU chave `meta.fabrica` em `permissions`, o `?` do jsonb — `Escopo.Chaves`, que também casa o texto de um array no topo). As edges liam o mesmo trio com `hasOwnProperty` (que NÃO casa array no topo) e sem olhar `disabled`: Ruling 5.8-3.
- `auth.SoServico` (SÓ se o pré-voo não a achou): o código EXATO abaixo, em `api/internal/auth/servico.go`, com `servico_test.go`. Quando o 5.13 for mesclado, a versão dele substitui esta (mesma assinatura; conflito = apagar este arquivo).
- Teste (interno): `novoMundo(t, montar...) *mundoteste.Mundo` com a fatia, as pessoas, as linhas e a foto abaixo; sessão `impersonado` = a de `fabricanteA1` aberta por `super` (o "entrar como" vê o que o ALVO vê: só A1); as sessões de `robo` e `roboSemFabrica` passam a ser de SERVIÇO (`sessaoDeServico`).

```go
// Package fabrica: a Fábrica de Anúncios. A purga diária (worker, Plano 4) e as rotas do sub-plano 5.8:
// leituras do painel (dados.Consulta, regra do catálogo; fabrica_marcas com a restritiva pode_ver_conta),
// a escolha de criativos (catálogo), as 5 edges portadas (fabrica-trigger, -apagar, -candidatos, -looks,
// -publicos; portão Fabricante, que é a policy de escrita de produção) e as rotas de robô /fabrica/robo/…
// (auth.SoServico + o perfil do robô). Escrita em banco.ComUsuario; "entrar como" só lê (Ruling 5.8-3).
package fabrica

import (
	"encoding/json"
	"net/http"
	"regexp"
	"strings"
	"unicode/utf8"

	"github.com/rbv-co/social-dashboard/api/internal/autz"
	"github.com/rbv-co/social-dashboard/api/internal/dados"
)

// Fabricante: exists(profiles p where p.id = auth.uid() and (p.role = 'admin' or p.is_superadmin = true
// or p.permissions ? 'meta.fabrica')) — fab_camp_write/fab_criativos_write de produção, que o catálogo
// compila igual (TestFabricanteIgualAPolicy compara pessoa a pessoa). É o portão das edges portadas e das
// rotas de robô, cujas tabelas só a chave de serviço gravava (Ruling 5.8-3).
var Fabricante = autz.Regra(func(e *autz.Escopo) bool {
	return e != nil && e.TemPerfil && e.Ativo && (e.Papel == "admin" || e.SuperFicha || e.Chaves["meta.fabrica"])
})

// soFabricante: depois de autz.ComEscopo. Sem escopo (rota montada fora do grupo) nega: falha fechada.
func soFabricante(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !Fabricante(autz.EscopoDo(r.Context())) {
			dados.Erro(w, http.StatusForbidden, "sem_permissao", "")
			return
		}
		next.ServeHTTP(w, r)
	})
}

var soSessaoPropria = dados.SoSessaoPropria(dados.FraseEntrarComo)

// deve: declaração de rota errada (Consulta ou Tabela fora do catálogo) faz a API não subir.
func deve(err error) {
	if err != nil {
		panic(err)
	}
}

var reUUID = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)

// responder: o corpo das edges portadas ({"error": código, "detail": frase}, {"ok": true}, {"job_id": …}),
// que as telas já leem; montado em Go porque não vem de tabela.
func responder(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

// texto: o valor JSON é texto? (null, número, objeto: não)
func texto(v json.RawMessage) (string, bool) {
	var s string
	if len(v) == 0 || v[0] != '"' || json.Unmarshal(v, &s) != nil {
		return "", false
	}
	return s, true
}

// textoAte: texto de até max caracteres; vazio (ou só espaço) só se vazioPode.
func textoAte(v json.RawMessage, max int, vazioPode bool) bool {
	s, ok := texto(v)
	return ok && utf8.RuneCountInString(s) <= max && (vazioPode || strings.TrimSpace(s) != "")
}

func casa(v json.RawMessage, re *regexp.Regexp) bool {
	s, ok := texto(v)
	return ok && re.MatchString(s)
}

func nulo(v json.RawMessage) bool { return strings.TrimSpace(string(v)) == "null" }

func objeto(v json.RawMessage) bool {
	var m map[string]json.RawMessage
	return len(v) > 0 && v[0] == '{' && json.Unmarshal(v, &m) == nil
}

func lista(v json.RawMessage) bool {
	var l []json.RawMessage
	return len(v) > 0 && v[0] == '[' && json.Unmarshal(v, &l) == nil
}

func booleano(v json.RawMessage) bool { s := string(v); return s == "true" || s == "false" }
```

`api/internal/auth/servico.go` (só se faltar):

```go
package auth

import "net/http"

// SoServico: rota de robô (5.8: /fabrica/robo/…). Só sessão tipo 'servico' (emitida de tokens_de_servico
// pelo 5.13) passa; sessão de painel — inclusive admin, super e "entrar como" — = 403. O que o robô pode
// fazer depois é o PERFIL dele (catálogo, módulo, conta), como para gente. Contrato do 5.13 (trilha A).
func SoServico(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if a := AtorDoContexto(r.Context()); a == nil || a.Tipo != "servico" || a.ImpersonadorID != nil {
			erroJSON(w, http.StatusForbidden, "sem_permissao")
			return
		}
		next.ServeHTTP(w, r)
	})
}
```

`api/internal/fabrica/mundo_test.go`:

```go
package fabrica

import (
	"context"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/auth"
	"github.com/rbv-co/social-dashboard/api/internal/testebanco/mundoteste"
)

const (
	A1 = "a5800000-0000-4000-a000-0000000000a1" // 'Vessel'
	A2 = "a5800000-0000-4000-a000-0000000000a2" // 'Mantova'

	M1 = "a5820000-0000-4000-a000-0000000000b1" // marca da A1
	M2 = "a5820000-0000-4000-a000-0000000000b2" // marca da A2

	C1 = "a5830000-0000-4000-a000-0000000000c1" // gerando (J1 rodando, run 111)
	C2 = "a5830000-0000-4000-a000-0000000000c2" // pronta
	C3 = "a5830000-0000-4000-a000-0000000000c3" // publicada (fechada)
	C4 = "a5830000-0000-4000-a000-0000000000c4" // fechada e purgada

	K1 = "a5840000-0000-4000-a000-0000000000d1" // C1, produto, escolhido
	K2 = "a5840000-0000-4000-a000-0000000000d2" // C1, promo
	K3 = "a5840000-0000-4000-a000-0000000000d3" // C2, produto
	K4 = "a5840000-0000-4000-a000-0000000000d4" // C3, produto, escolhido

	J1  = "a5850000-0000-4000-a000-0000000000e1" // gerar C1, rodando, run 111
	J2  = "a5850000-0000-4000-a000-0000000000e2" // subir C3, concluido
	MJ1 = "a5860000-0000-4000-a000-0000000000f1" // rastro da subida de C3
	P1  = "a5870000-0000-4000-a000-000000000001" // público ativo da M1
	P2  = "a5870000-0000-4000-a000-000000000002" // público inativo

	idFabricante        = "a5810000-0000-4000-a000-000000000001"
	idFabricanteA1      = "a5810000-0000-4000-a000-000000000002"
	idFabricanteNenhuma = "a5810000-0000-4000-a000-000000000003"
	idAdminA1           = "a5810000-0000-4000-a000-000000000004"
	idSuper             = "a5810000-0000-4000-a000-000000000005"
	idLeitor            = "a5810000-0000-4000-a000-000000000006"
	idChaveEmLista      = "a5810000-0000-4000-a000-000000000007"
	idSemModulo         = "a5810000-0000-4000-a000-000000000008"
	idDesativado        = "a5810000-0000-4000-a000-000000000009"
	idRobo              = "a5810000-0000-4000-a000-000000000010"
	idRoboSemFabrica    = "a5810000-0000-4000-a000-000000000011"
)

// pessoas: a chave meta.fabrica de permissions nos três estados de allowed_accounts (nulo, lista, vazia),
// quem passa por papel (admin) e pela ficha (super), quem tem 'meta.fabrica' só em FEATURES (não passa: a
// policy lê permissions), a chave num array no topo (passa: o ? do jsonb), quem não tem nada e os dois
// robôs (perfil próprio, sessão de serviço; um com a chave, outro sem). As chaves vão em linhasDaFabrica.
var pessoas = []mundoteste.Pessoa{
	{Chave: "fabricante", ID: idFabricante, Email: "fabricante@x.com", Papel: "viewer", Modulos: []string{"meta"}},
	{Chave: "fabricanteA1", ID: idFabricanteA1, Email: "fabricantea1@x.com", Papel: "viewer", Modulos: []string{"meta"}, Contas: []string{A1}},
	{Chave: "fabricanteNenhuma", ID: idFabricanteNenhuma, Email: "fabricantenenhuma@x.com", Papel: "viewer", Contas: []string{}},
	{Chave: "adminA1", ID: idAdminA1, Email: "admina1@x.com", Papel: "admin", Contas: []string{A1}},
	{Chave: "super", ID: idSuper, Email: "super@x.com", Papel: "viewer", Super: true},
	{Chave: "leitor", ID: idLeitor, Email: "leitor@x.com", Papel: "viewer", Modulos: []string{"meta", "meta.fabrica"}},
	{Chave: "chaveEmLista", ID: idChaveEmLista, Email: "chaveemlista@x.com", Papel: "viewer"},
	{Chave: "semModulo", ID: idSemModulo, Email: "semmodulo@x.com", Papel: "viewer"},
	{Chave: "desativado", ID: idDesativado, Email: "desativado@x.com", Papel: "admin", Desativado: true},
	{Chave: "robo", ID: idRobo, Email: "robo-fabrica@x.com", Papel: "viewer", Modulos: []string{"meta", "sales"}},
	{Chave: "roboSemFabrica", ID: idRoboSemFabrica, Email: "robo-outro@x.com", Papel: "viewer", Modulos: []string{"meta"}},
}

// Sem identidade. Toda linha de A2 é a marca M2; nada mais tem conta (as outras 8 tabelas não têm a
// restritiva).
const linhasDaFabrica = `
update profiles set permissions = '{"meta.fabrica": ["ver", "editar"]}'
 where id in ('` + idFabricante + `', '` + idFabricanteA1 + `', '` + idFabricanteNenhuma + `', '` + idRobo + `');
update profiles set permissions = '["meta.fabrica"]' where id = '` + idChaveEmLista + `';
insert into fabrica_marcas (id, nome, ad_account, page_id, ig_id, account_id, created_at) values
  ('` + M1 + `', 'Vessel', 'act_111', 'p1', '1784', '` + A1 + `', '2026-10-01T00:00:00Z'),
  ('` + M2 + `', 'Mantova', 'act_222', 'p2', '1785', '` + A2 + `', '2026-10-02T00:00:00Z');
insert into fabrica_lojas (deposito_id, nome, ativo, ordem, marca_id, whatsapp, geo_cities, canal_loja_id) values
  ('14888726315', 'Tivoli (Santa Bárbara)', true, 1, '` + M1 + `', '+5519971690502', '[267873]', '205834140'),
  ('14888726277', 'Iguatemi (Campinas)', true, 2, '` + M1 + `', '+5519971092194', '[247071]', '205834116'),
  ('14888617206', 'Shopping Dom Pedro', false, 3, '` + M1 + `', '+5519999545112', '[247071]', '205657609');
insert into fabrica_objetivos (chave, rotulo, meta_objective, optimization_goal, pede_desconto, ativo, ordem) values
  ('engajamento', 'Engajamento (WhatsApp)', 'OUTCOME_ENGAGEMENT', 'CONVERSATIONS', true, true, 1),
  ('branding', 'Reconhecimento', 'OUTCOME_AWARENESS', 'REACH', false, true, 3),
  ('antigo', 'Antigo', 'OUTCOME_TRAFFIC', 'LINK_CLICKS', true, false, 9);
insert into fabrica_looks (chave, nome, arquetipo, objetivos, ativo, ordem, excluido) values
  ('produto-heroi', 'Produto · Herói', 'produto', '{engajamento}', true, 1, false),
  ('promo-sage', 'Promo · Sage', 'promo', '{engajamento,branding}', true, 2, false),
  ('marca-velha', 'Marca · Velha', 'produto', '{}', false, 3, true);
insert into fabrica_campanhas (id, nome, status, objetivo, job_id, created_at, fechada_em, purgado_em) values
  ('` + C1 + `', 'Rodada 1', 'gerando', 'engajamento', '` + J1 + `', '2026-10-10T10:00:00Z', null, null),
  ('` + C2 + `', 'Rodada 2', 'pronta', 'branding', null, '2026-10-11T10:00:00Z', null, null),
  ('` + C3 + `', 'Rodada 3', 'pronta', 'engajamento', null, '2026-10-01T10:00:00Z', '2026-10-05T10:00:00Z', null),
  ('` + C4 + `', 'Rodada 4', 'pronta', 'engajamento', null, '2026-08-01T10:00:00Z', '2026-08-05T10:00:00Z', '2026-09-05T10:00:00Z');
insert into fabrica_criativos (id, campanha_id, sku, arquetipo, template, formato, variante, storage_path, url, escolhido, created_at) values
  ('` + K1 + `', '` + C1 + `', 'S1', 'produto', 'produto-heroi', '1080x1080', 'avista', '` + C1 + `/produto/s1-avista-1080x1080.png', 'https://midia.x/f/` + C1 + `/produto/s1.png', true, '2026-10-10T10:01:00Z'),
  ('` + K2 + `', '` + C1 + `', null, 'promo', 'promo-sage', '1080x1920', 'colecao', '` + C1 + `/promo/colecao-1080x1920.png', 'https://midia.x/f/` + C1 + `/promo/c.png', false, '2026-10-10T10:02:00Z'),
  ('` + K3 + `', '` + C2 + `', 'S2', 'produto', 'produto-heroi', '1080x1080', 'avista', '` + C2 + `/produto/s2-avista-1080x1080.png', 'https://midia.x/f/` + C2 + `/produto/s2.png', false, '2026-10-11T10:01:00Z'),
  ('` + K4 + `', '` + C3 + `', 'S3', 'produto', 'produto-heroi', '1080x1080', 'avista', '` + C3 + `/produto/s3-avista-1080x1080.png', 'https://midia.x/f/` + C3 + `/produto/s3.png', true, '2026-10-01T10:01:00Z');
insert into fabrica_jobs (id, tipo, params, status, github_run_id, criado_por, created_at) values
  ('` + J1 + `', 'gerar', '{"campanhaId": "` + C1 + `", "objetivo": "engajamento"}', 'rodando', '111', '` + idFabricante + `', '2026-10-10T10:00:00Z'),
  ('` + J2 + `', 'subir', '{"campanhaId": "` + C3 + `"}', 'concluido', '222', '` + idFabricante + `', '2026-10-04T10:00:00Z');
insert into fabrica_meta_jobs (id, ad_account_id, loja, tipo, meta_campaign_id, adset_ids, ad_ids, payload, status, created_at) values
  ('` + MJ1 + `', 'act_111', 'Tivoli (Santa Bárbara)', 'estudio', '120001', '["1"]', '["2"]', '{"campanhaId": "` + C3 + `"}', 'criado', '2026-10-05T09:00:00Z');
insert into fabrica_publicos (id, nome, marca_id, ativo, created_at) values
  ('` + P1 + `', 'Campinas 25-45', '` + M1 + `', true, '2026-10-01T00:00:00Z'),
  ('` + P2 + `', 'Velho', null, false, '2026-09-01T00:00:00Z');`

// fotoDaFabrica: hash das 9 tabelas e de ia_execucoes. Igual antes e depois = nada mudou.
const fotoDaFabrica = `select md5(string_agg(l, '|' order by l)) from (
  select 'lo:' || t::text as l from fabrica_lojas t union all
  select 'ob:' || t::text from fabrica_objetivos t union all
  select 'lk:' || t::text from fabrica_looks t union all
  select 'ma:' || t::text from fabrica_marcas t union all
  select 'ca:' || t::text from fabrica_campanhas t union all
  select 'cr:' || t::text from fabrica_criativos t union all
  select 'jo:' || t::text from fabrica_jobs t union all
  select 'mj:' || t::text from fabrica_meta_jobs t union all
  select 'pu:' || t::text from fabrica_publicos t union all
  select 'ia:' || t::text from ia_execucoes t) z`

// sessaoDeServico: a sessão tipo 'servico' do usuário do robô (o que o emissor de tokens_de_servico do
// 5.13 cria). Se o 5.13 trouxer ajudante de teste próprio, use-o aqui (pré-voo).
func sessaoDeServico(t *testing.T, m *mundoteste.Mundo, chave, id string) {
	t.Helper()
	tok, err := auth.NovoStore(m.P).Criar(context.Background(), id, "servico", nil)
	if err != nil {
		t.Fatal(err)
	}
	m.Tok[chave] = tok
}

// novoMundo: a fatia de produção, as pessoas, as linhas, a sessão "impersonado" (a de fabricanteA1
// aberta por super) e as sessões de SERVIÇO dos dois robôs, com as rotas de `montar` atrás da MESMA cadeia do
// grupo de domínio de web.Rotas.
func novoMundo(t *testing.T, montar ...func(chi.Router, *pgxpool.Pool)) *mundoteste.Mundo {
	t.Helper()
	m := mundoteste.Novo(t, mundoteste.Opcoes{Pessoas: pessoas, Linhas: linhasDaFabrica,
		Impersonadas: map[string][2]string{"impersonado": {idFabricanteA1, idSuper}}}, montar...)
	sessaoDeServico(t, m, "robo", idRobo)
	sessaoDeServico(t, m, "roboSemFabrica", idRoboSemFabrica)
	return m
}
```

**(b) Testes de aceitação** (`fabrica_test.go`)
- `TestMundoDaFabrica` (sonda `GET /eco` montada no teste, que escreve `fmt.Sprintf("%t|%s|%t", Fabricante(e), a.Tipo, autz.PodeVerConta(e, A2))`): sem sessão → 401; `fabricante` → `true|painel|true`; `fabricanteA1` → `true|painel|false`; `fabricanteNenhuma` → `true|painel|false`; `adminA1` → `true|painel|true` (papel admin vê toda conta); `super` → `true|painel|true`; `leitor` → `false|painel|true`; `chaveEmLista` → `true|painel|true`; `semModulo` → `false|painel|true`; `desativado` → 401; `robo` → `true|servico|true`; `roboSemFabrica` → `false|servico|true`; `impersonado` → `true|painel|false`. E as linhas: `select count(*)::text from fabrica_criativos` = `4`; a foto não é vazia.
- `TestFabricanteIgualAPolicy`: para cada pessoa (inclusive `desativado` e os robôs), `e := autz.CarregarEscopo(ctx, m.P, id)`; para `fabrica_campanhas` (linha `{"nome":"x"}`) e `fabrica_criativos` (linha `{"arquetipo":"produto","template":"t","formato":"f"}`), `f := autz.Producao.Filtro(e, <tabela>, autz.Criar, "autz_nova")` e `ok := autz.Conferir(ctx, m.P, f, <tabela>, linha)`: `ok == Fabricante(e)` sempre, com pelo menos 5 pessoas de cada lado (o teste falha se o mundo deixar de exercitar os dois lados).
- `TestSoServico` (`auth/servico_test.go`, só se a Task criou o arquivo): ator `painel` → 403 `{"error":"sem_permissao"}`; `servico` → passa; `servico` com `ImpersonadorID` → 403; sem ator → 403.
- `TestAjudantesDeValidacao` (puro): `texto` recusa `null`, `5`, `{}`; `textoAte("\"  \"", 10, false)` = falso e com `true` = verdadeiro; conta caracteres (`"ção"` cabe em 3); `objeto` aceita `{}` e recusa `[]`/`null`; `lista` aceita `[]` e recusa `{}`; `booleano` só `true`/`false`.
- Mutações que têm de reprovar: tirar `e.Ativo` de `Fabricante` (`desativado` vira `true` e o teste da policy acusa); trocar `e.Chaves["meta.fabrica"]` por `e.Modulo("meta.fabrica")` (`leitor` passa e `fabricante` não); em `SoServico`, aceitar `painel`.

**(c) Arquivos:** Create `api/internal/fabrica/fabrica.go`, `api/internal/fabrica/mundo_test.go`, `api/internal/fabrica/fabrica_test.go` (e, se faltar, `api/internal/auth/servico.go`, `api/internal/auth/servico_test.go`); Modify `api/internal/fabrica/purga.go` (só a linha do comentário do pacote).

**(d) Dependências:** Task 1; `mundoteste`; `autz.CarregarEscopo/Conferir/PodeVerConta`.

- [ ] **Step 1:** Testes; ver falhar. - [ ] **Step 2:** Implementar. - [ ] **Step 3:** `gofmt -l ./internal && go vet ./internal/fabrica/ ./internal/auth/ && go test -count=1 ./internal/fabrica/ ./internal/auth/` PASS (os testes da purga continuam verdes); mutações reprovam. - [ ] **Step 4:** Commit `feat(api): fábrica — portão Fabricante provado igual à policy de escrita, mundo com robôs de serviço` (+ `Co-Authored-By`).

---

### Task 4: Leituras do painel e escolha de criativos

**Revisor:** sonnet. **Depende de:** 3.

**(a) Contrato** (regra de Ler do catálogo em toda leitura: `true` em 8 tabelas, `pode_ver_conta(account_id)` em `fabrica_marcas`; uma rota por necessidade de tela, os filtros cobrindo também as leituras do robô — que usa ESTAS rotas com a sessão de serviço: Task 9)
- `GET /fabrica/lojas` — gerar:35 (`?ativo=true`), curar:21, subir:350; robô `lib/config-lojas.mjs:8`, `exportar-zoho.mjs:21`. Filtro `ativo`. Ordem `ordem`.
- `GET /fabrica/objetivos` — gerar:36 (`?ativo=true`), subir:225 (`?chave=`); robô `lib/objetivos.mjs:3`. Filtros `ativo`, `chave`. Ordem `ordem`.
- `GET /fabrica/marcas` — subir:229 (`?account_id=`); robô `lib/config-lojas.mjs:7`. Filtros `account_id`, `ativo`. **Restritiva**: projeta `account_id` (a varredura da Task 10 procura o uuid de A2).
- `GET /fabrica/looks` — looks:20; robô `gerar-criativos.mjs:198`. Filtro `ativo`. Ordem `ordem`.
- `GET /fabrica/publicos` — subir:170 (`?ativo=true`). Ordem `created_at desc`.
- `GET /fabrica/campanhas` — home:32 (`?aberta=true&purgada=false&status=gerando,pronta,erro&ordem=created_at.desc`), home:41 (`?aberta=false&ordem=fechada_em.desc&limite=8`), curar:23 e :56 e subir:222 (`?id=`); robô `subir-estudio.mjs:321`, `exportar-zoho.mjs:16`. Traz `qtd_criativos` (subconsulta com a regra de Ler de `fabrica_criativos`): substitui o laço de uma contagem por rodada a cada 4 s de home:35.
- `GET /fabrica/criativos` — curar:20 (`?campanha_id=`), home:42 (`?limite=1&contar=1` → `X-Total-Count`); robô `fabrica-job-runner.mjs:163`, `gerar-criativos.mjs:304`, `subir-estudio.mjs:301` (`?campanha_id=&escolhido=true&purgado=false`), `exportar-zoho.mjs:25` (`?arquetipo=produto`). Filtros `campanha_id`, `escolhido`, `arquetipo`, `purgado`. O formato 1920x1080 que o `subir` pula continua sendo filtrado pelo robô (Plano 7).
- `GET /fabrica/jobs` — curar:26 e :59, use-job-status:8 (`?id=`), estudio:31 (`?tipo=subir&campanha_id=&ordem=created_at.desc&limite=1`); robô `fabrica-job-runner.mjs:115` (`?id=`), `exportar-zoho.mjs:18` (`?campanha_id=&ordem=created_at&limite=1`). Sem `criado_por` (uuid de pessoa; nenhuma tela o lê).
- `GET /fabrica/meta-jobs` — home:93 (`?campanha_id=<ids>&com_campanha_meta=true`); robô `subir-estudio.mjs:328` (`?tipo=estudio&campanha_id=&ordem=created_at.desc&limite=50`).
- `POST /fabrica/criativos/escolher` (`soSessaoPropria`): substitui curar:33 (um) e curar:48 (vários). Corpo `{"ids": [uuid, …] (1–500), "escolhido": bool}`. Regra = catálogo (`fab_criativos_write`) por `Tabela.Editar` em CADA id, numa transação só, em ordem fixa (duas pessoas escolhendo ao mesmo tempo travam as linhas na mesma ordem); qualquer id invisível/inexistente = `404` e nada muda. Resposta `200 {"atualizados": n}`.

```go
package fabrica

import (
	"net/http"
	"slices"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/autz"
	"github.com/rbv-co/social-dashboard/api/internal/banco"
	"github.com/rbv-co/social-dashboard/api/internal/dados"
)

var filtroAtivo = dados.Filtro{Param: "ativo", SQL: "t.ativo = @ativo::boolean", Tipo: "booleano"}

var consultaLojas = dados.Consulta{Tabela: "fabrica_lojas", Alias: "t",
	SQL: `select t.deposito_id, t.nome, t.ativo, t.ordem, t.marca_id, t.whatsapp, t.geo_cities, t.canal_loja_id
	  from fabrica_lojas t`,
	Filtros: []dados.Filtro{filtroAtivo}, OrdemPadrao: "t.ordem", Desempate: "t.deposito_id"}

var consultaObjetivos = dados.Consulta{Tabela: "fabrica_objetivos", Alias: "t",
	SQL: `select t.chave, t.rotulo, t.descricao, t.meta_objective, t.optimization_goal, t.billing_event,
	  t.destination_type, t.promoted_object_tipo, t.cta_type, t.looks, t.pede_desconto, t.ativo, t.ordem
	  from fabrica_objetivos t`,
	Filtros:     []dados.Filtro{filtroAtivo, {Param: "chave", SQL: "t.chave = @chave::text", Tipo: "texto"}},
	OrdemPadrao: "t.ordem", Desempate: "t.chave"}

// consultaMarcas: a única com a restritiva (so_contas_permitidas = pode_ver_conta(account_id), account_id
// TEXTO). Projeta account_id: é por ele que a varredura da Task 10 acha vazamento.
var consultaMarcas = dados.Consulta{Tabela: "fabrica_marcas", Alias: "t",
	SQL: `select t.id, t.nome, t.caption_template, t.ad_account, t.page_id, t.ig_id, t.account_id, t.ativo,
	  t.segmento, t.termos_produto, t.created_at from fabrica_marcas t`,
	Filtros:     []dados.Filtro{{Param: "account_id", SQL: "t.account_id = @account_id::text", Tipo: "texto"}, filtroAtivo},
	OrdemPadrao: "t.created_at", Desempate: "t.id"}

var consultaLooks = dados.Consulta{Tabela: "fabrica_looks", Alias: "t",
	SQL: `select t.chave, t.nome, t.arquetipo, t.objetivos, t.ativo, t.excluido, t.ordem, t.preview_url, t.tipo,
	  t.canva_formato_map, t.campo_map, t.created_at from fabrica_looks t`,
	Filtros: []dados.Filtro{filtroAtivo}, OrdemPadrao: "t.ordem", Desempate: "t.chave"}

var consultaPublicos = dados.Consulta{Tabela: "fabrica_publicos", Alias: "t",
	SQL: `select t.id, t.nome, t.marca_id, t.geo, t.idade_min, t.idade_max, t.generos, t.interesses,
	  t.custom_audiences, t.ativo, t.created_at from fabrica_publicos t`,
	Filtros: []dados.Filtro{filtroAtivo}, OrdemPadrao: "t.created_at desc", Desempate: "t.id"}

// colunasCampanha: o que home, curar, subir e o robô leem. criado_por (uuid de pessoa) não sai.
const colunasCampanha = `t.id, t.nome, t.status, t.objetivo, t.job_id, t.desconto_tipo, t.desconto_pct, t.parcelas,
  t.created_at, t.fechada_em, t.purgado_em`

var consultaCampanhas = dados.Consulta{Tabela: "fabrica_campanhas", Alias: "t",
	SQL: `select ` + colunasCampanha + `, (select count(*) from fabrica_criativos c
	  where c.campanha_id = t.id and {ler:fabrica_criativos:c}) as qtd_criativos from fabrica_campanhas t`,
	Filtros: []dados.Filtro{
		{Param: "id", SQL: "t.id = @id::uuid", Tipo: "uuid"},
		{Param: "status", SQL: "t.status = any(@status::text[])", Tipo: "texto[]"},
		{Param: "aberta", SQL: "(t.fechada_em is null) = @aberta::boolean", Tipo: "booleano"},
		{Param: "purgada", SQL: "(t.purgado_em is not null) = @purgada::boolean", Tipo: "booleano"},
	},
	Ordens:      map[string]string{"created_at": "t.created_at", "fechada_em": "t.fechada_em"},
	OrdemPadrao: "t.created_at desc", Desempate: "t.id"}

const colunasCriativo = `t.id, t.campanha_id, t.sku, t.arquetipo, t.template, t.formato, t.variante, t.preco_de,
  t.preco_por, t.storage_path, t.url, t.legenda, t.escolhido, t.purgado_em, t.created_at`

var consultaCriativos = dados.Consulta{Tabela: "fabrica_criativos", Alias: "t",
	SQL: `select ` + colunasCriativo + ` from fabrica_criativos t`,
	Filtros: []dados.Filtro{
		{Param: "campanha_id", SQL: "t.campanha_id = @campanha_id::uuid", Tipo: "uuid"},
		{Param: "escolhido", SQL: "t.escolhido = @escolhido::boolean", Tipo: "booleano"},
		{Param: "arquetipo", SQL: "t.arquetipo = @arquetipo::text", Tipo: "texto"},
		{Param: "purgado", SQL: "(t.purgado_em is not null) = @purgado::boolean", Tipo: "booleano"},
	},
	OrdemPadrao: "t.created_at", Desempate: "t.id"}

// consultaJobs: params->>'campanhaId' é expressão total (texto ou nulo, nunca erro): o filtro não vira
// oráculo (regra do modelo de leitura do mestre, IV.1).
var consultaJobs = dados.Consulta{Tabela: "fabrica_jobs", Alias: "t",
	SQL: `select t.id, t.tipo, t.params, t.status, t.github_run_id, t.resultado, t.erro, t.created_at, t.updated_at
	  from fabrica_jobs t`,
	Filtros: []dados.Filtro{
		{Param: "id", SQL: "t.id = @id::uuid", Tipo: "uuid"},
		{Param: "tipo", SQL: "t.tipo = @tipo::text", Tipo: "texto"},
		{Param: "status", SQL: "t.status = @status::text", Tipo: "texto"},
		{Param: "campanha_id", SQL: "t.params->>'campanhaId' = @campanha_id::text", Tipo: "texto"},
	},
	Ordens: map[string]string{"created_at": "t.created_at"}, OrdemPadrao: "t.created_at desc", Desempate: "t.id"}

var consultaMetaJobs = dados.Consulta{Tabela: "fabrica_meta_jobs", Alias: "t",
	SQL: `select t.id, t.tipo, t.loja, t.ad_account_id, t.meta_campaign_id, t.adset_ids, t.ad_ids, t.payload,
	  t.status, t.erro, t.created_at from fabrica_meta_jobs t`,
	Filtros: []dados.Filtro{
		{Param: "campanha_id", SQL: "t.payload->>'campanhaId' = any(@campanha_id::text[])", Tipo: "texto[]"},
		{Param: "tipo", SQL: "t.tipo = @tipo::text", Tipo: "texto"},
		{Param: "com_campanha_meta", SQL: "(t.meta_campaign_id is not null) = @com_campanha_meta::boolean", Tipo: "booleano"},
	},
	Ordens: map[string]string{"created_at": "t.created_at"}, OrdemPadrao: "t.created_at desc", Desempate: "t.id"}

var tabelaCriativos = dados.Tabela{Nome: "fabrica_criativos", Resposta: colunasCriativo}

type pedidoEscolher struct {
	IDs       []string `json:"ids"`
	Escolhido *bool    `json:"escolhido"`
}

// escolher: POST /fabrica/criativos/escolher. Catálogo (fab_criativos_write) em cada id pelo Tabela.Editar
// (PodeEditar trava a linha), tudo numa transação: um id que falha desfaz os outros.
func escolher(p *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		e := autz.EscopoDo(r.Context())
		if e == nil {
			dados.Erro(w, http.StatusInternalServerError, "erro_interno", "")
			return
		}
		var c pedidoEscolher
		if !dados.LerCorpo(w, r, &c) {
			return
		}
		if c.Escolhido == nil || len(c.IDs) == 0 || len(c.IDs) > 500 {
			dados.Erro(w, http.StatusBadRequest, "pedido_invalido", "Mande ids (1 a 500) e escolhido.")
			return
		}
		for _, id := range c.IDs {
			if !reUUID.MatchString(id) {
				dados.Erro(w, http.StatusBadRequest, "pedido_invalido", "ids são uuids.")
				return
			}
		}
		ids := slices.Compact(slices.Sorted(slices.Values(c.IDs)))
		campos := map[string]any{"escolhido": *c.Escolhido}
		ctx := r.Context()
		err := banco.ComUsuario(ctx, p, e.ID, func(tx pgx.Tx) error {
			for _, id := range ids {
				if _, err := tabelaCriativos.Editar(ctx, tx, autz.Producao, e, id, campos); err != nil {
					return err
				}
			}
			return nil
		})
		if err != nil {
			dados.ErroDeEscrita(w, err)
			return
		}
		responder(w, http.StatusOK, map[string]int{"atualizados": len(ids)})
	}
}

func montarLeituras(r chi.Router, p *pgxpool.Pool) {
	deve(tabelaCriativos.Validar(autz.Producao))
	r.Get("/fabrica/lojas", consultaLojas.Handler(p, autz.Producao))
	r.Get("/fabrica/objetivos", consultaObjetivos.Handler(p, autz.Producao))
	r.Get("/fabrica/marcas", consultaMarcas.Handler(p, autz.Producao))
	r.Get("/fabrica/looks", consultaLooks.Handler(p, autz.Producao))
	r.Get("/fabrica/publicos", consultaPublicos.Handler(p, autz.Producao))
	r.Get("/fabrica/campanhas", consultaCampanhas.Handler(p, autz.Producao))
	r.Get("/fabrica/criativos", consultaCriativos.Handler(p, autz.Producao))
	r.Get("/fabrica/jobs", consultaJobs.Handler(p, autz.Producao))
	r.Get("/fabrica/meta-jobs", consultaMetaJobs.Handler(p, autz.Producao))
	r.With(soSessaoPropria).Post("/fabrica/criativos/escolher", escolher(p))
}
```

**(b) Testes de aceitação** (`TestLeituras`, `TestEscolher`, `m.Rodar`; "intacto" = `fotoDaFabrica` igual à de antes)
- Abertas (8 tabelas): `fabricante`, `leitor`, `semModulo`, `impersonado`, `robo` → 200 com as linhas; `desativado` → 401; sem sessão → 401.
- Marcas: `fabricante`, `adminA1` (papel admin vê toda conta), `super`, `robo` → M1 e M2; `fabricanteA1` e `impersonado` (o alvo é o `fabricanteA1`) → só M1; `fabricanteNenhuma` → `[]`; `fabricanteA1 ?account_id=<A2>` → `[]`; `?contar=1` → `X-Total-Count: 1` para `fabricanteA1` e `2` para `fabricante`.
- Filtros e ordem: `lojas?ativo=true` → Tivoli e Iguatemi, nessa ordem, sem Dom Pedro; `objetivos?ativo=true` → `engajamento`, `branding`; `objetivos?chave=branding` → uma, com `"pede_desconto":false`; `looks` → as três em `ordem`; `campanhas?aberta=true&purgada=false&status=gerando,pronta,erro&ordem=created_at.desc` → C2 antes de C1, C1 com `"qtd_criativos":2`; `campanhas?aberta=false&ordem=fechada_em.desc&limite=8` → C3 antes de C4; `criativos?limite=1&contar=1` → `X-Total-Count: 4`; `criativos?campanha_id=<C1>&escolhido=true&purgado=false` → só K1; `jobs?campanha_id=<C1>` → J1 (com `"params"` e sem `criado_por`); `jobs?tipo=subir&campanha_id=<C3>&ordem=created_at.desc&limite=1` → J2; `meta-jobs?campanha_id=<C3>,<C2>&com_campanha_meta=true` → MJ1; `meta-jobs?tipo=estudio&campanha_id=<C3>` → MJ1.
- 400: `campanhas?status=` (vazio), `campanhas?ordem=nome`, `criativos?campanha_id=xyz`, `jobs?criado_por=<id>`, `lojas?limite=1001`.
- Escolher, permitido: `fabricante` `{"ids":["<K2>","<K1>"],"escolhido":false}` → 200 `{"atualizados":2}`; efeito `select string_agg(escolhido::text, ',' order by id) from fabrica_criativos where id in (K1, K2)` = `false,false`; ids repetidos contam uma vez; `chaveEmLista`, `super`, `adminA1` → 200.
- Escolher, negado e intacto: `leitor`, `semModulo`, `roboSemFabrica` → 403; `impersonado` → 403 com "Quem entrou como outra pessoa"; `{"ids":["<K1>","<uuid inexistente>"],"escolhido":false}` → 404 e K1 continua `true`; 501 ids, `[]`, sem `escolhido`, `"escolhido":"sim"`, id `"x"` → 400.
- Mutações que têm de reprovar: tirar o `{ler:fabrica_criativos:c}` da subconsulta (`Validar` recusa: a API não sobe); trocar a transação única por uma por id (o caso do id inexistente deixa K1 mudado); tirar `soSessaoPropria` do POST.

**(c) Arquivos:** Create `api/internal/fabrica/leituras.go`, `api/internal/fabrica/leituras_test.go`.

**(d) Dependências:** Task 3; `dados.Consulta`, `dados.Tabela.Editar`.

- [ ] **Step 1:** Testes; ver falhar. - [ ] **Step 2:** Implementar (código de (a)). Se `dados.Consulta.Validar` recusar o `->>` dos filtros de `jobs`/`meta-jobs` (a gramática do 5.0 aceita operador e literal; se recusar, é defeito dela): **pare e reporte** — não troque por filtro no Go. - [ ] **Step 3:** `gofmt -l ./internal && go vet ./internal/fabrica/ && go test -count=1 ./internal/fabrica/` PASS; mutações reprovam. - [ ] **Step 4:** Commit `feat(api): leituras da Fábrica pelo catálogo (marcas por conta) e escolha de criativos numa transação` (+ `Co-Authored-By`).

---
### Task 5: `POST /fabrica-trigger` — rodada e job numa transação, despacho fora dela

**Revisor:** opus. **Depende de:** 2, 3.

**(a) Contrato** (o da edge `supabase/functions/fabrica-trigger/index.ts`: mesmo corpo `{tipo, params}`, mesma resposta `{job_id, campanha_id}`, mesmos códigos — o front troca só a URL: gerar:95, conferir:25 e :39, subir:381, looks:58 —, com estas diferenças por Ruling)
- Portão: `soFabricante` (a edge: papel admin, `is_superadmin` ou a chave `meta.fabrica`) + `soSessaoPropria` (o robô acordado gasta dinheiro e mexe na Meta em nome da pessoa: "entrar como" não dispara).
- `tipo` ∈ `gerar|subir|ativar|preview` (a lista da edge, `index.ts:17`); fora = `400 {"error":"tipo_invalido"}`. `excluir`, que o `painel-conferir.vue:39` manda, continua recusado (Ruling 5.8-7, achado 2).
- `params`: objeto (ausente/`null` = `{}`), até 64 KiB; `params.campanhaId`, quando vem não vazio, é uuid (o robô o põe na URL do REST: `fabrica-job-runner.mjs:168`); `nome` até 200 e `objetivo` até 40 caracteres. Fora disso = `400 pedido_invalido` com a frase. O resto de `params` (itens, destino, ids de anúncio) passa como está: é o protocolo do robô, que valida o seu (Ruling 5.8-6).
- `GITHUB_PAT` vazio = `503 {"error":"github_nao_configurado"}` ANTES de gravar qualquer coisa (a edge criava a rodada e o job e só então falhava).
- **Transação 1** (`banco.ComUsuario`): no `gerar` sem `campanhaId`, cria a rodada por `tabelaCampanhas.Criar` (catálogo `fab_camp_write`; `criado_por` da sessão; `nome` = o do pedido ou `Rodada · AAAA-MM-DD HH:MM` em UTC, como a edge; `status 'gerando'`; `objetivo` = o do pedido ou `engajamento`) e põe `campanhaId` e `objetivo` em `params`; insere o job (`fabrica_jobs`, que só a chave de serviço gravava: portão da edge, Ruling 5.8-3) com `status 'enfileirado'` e `criado_por` da sessão; liga a rodada nova ao job (`job_id`). Commit.
- **Despacho FORA da transação** (`github.Disparar(ctx, "fabrica", {"job_id": …})`; nenhuma trava presa esperando o GitHub). Sucesso → `200 {"job_id": …, "campanha_id": <uuid|null>}`.
- **Falha** (Ruling 5.8-5): **transação 2** marca o job `erro` (`erro = "<código> github: <classe> (<status>)"`) SÓ se ele ainda está `enfileirado` (se o robô já começou, ele é a verdade: `fabrica-job-runner.mjs:118`), e a rodada criada POR ESTE pedido como `erro` só se ainda `gerando` (a edge marcava também a rodada de um `subir`, que já estava pronta: Ruling 5.8-8). Contexto novo de 5 s (o do pedido pode ter vencido no despacho). Resposta por classe, `{"error": código, "detail": frase}` sem o corpo do GitHub: `Limite` → `429 muitas_tentativas` com `Retry-After`; `Incerto` → `504 dispatch_incerto`; `TokenInvalido`/`SemPermissao`/`NaoEncontrado`/`Recusado`/`Indisponivel`/`Inesperado` → `502 dispatch_falhou` com a frase de cada uma. Nenhuma repetição automática.

```go
package fabrica

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"slices"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/autz"
	"github.com/rbv-co/social-dashboard/api/internal/banco"
	"github.com/rbv-co/social-dashboard/api/internal/dados"
	"github.com/rbv-co/social-dashboard/api/internal/github"
)

// tiposDeJob: a lista da edge (fabrica-trigger/index.ts:17). "excluir" fica fora (Ruling 5.8-7).
var tiposDeJob = []string{"gerar", "subir", "ativar", "preview"}

var tabelaCampanhas = dados.Tabela{Nome: "fabrica_campanhas", Resposta: colunasCampanha, Autor: "criado_por"}

type pedidoDisparo struct {
	Tipo   string          `json:"tipo"`
	Params json.RawMessage `json:"params"`
}

// lerParams: params é objeto (ausente ou null = {}), até 64 KiB; campanhaId, quando vem não vazio, é uuid
// (o robô o põe na URL: fabrica-job-runner.mjs:168); nome até 200 e objetivo até 40 caracteres.
func lerParams(bruto json.RawMessage) (map[string]json.RawMessage, string) {
	params := map[string]json.RawMessage{}
	if len(bruto) == 0 || nulo(bruto) {
		return params, ""
	}
	if len(bruto) > 64<<10 {
		return nil, "params passa de 64 KiB."
	}
	if !objeto(bruto) {
		return nil, "params é um objeto."
	}
	if err := json.Unmarshal(bruto, &params); err != nil {
		return nil, "params é um objeto."
	}
	vazio := func(v json.RawMessage) bool { return nulo(v) || string(v) == `""` }
	if v, tem := params["campanhaId"]; tem && !vazio(v) && !casa(v, reUUID) {
		return nil, "campanhaId é o id da rodada."
	}
	if v, tem := params["nome"]; tem && !nulo(v) && !textoAte(v, 200, true) {
		return nil, "nome tem até 200 caracteres."
	}
	if v, tem := params["objetivo"]; tem && !nulo(v) && !textoAte(v, 40, true) {
		return nil, "objetivo tem até 40 caracteres."
	}
	return params, ""
}

// Disparador: POST /fabrica-trigger. Portão (soFabricante, soSessaoPropria) na montagem.
type Disparador struct {
	Pool *pgxpool.Pool
	GH   *github.Cliente
}

func (d *Disparador) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	e := autz.EscopoDo(r.Context())
	if e == nil {
		dados.Erro(w, http.StatusInternalServerError, "erro_interno", "")
		return
	}
	var c pedidoDisparo
	if !dados.LerCorpo(w, r, &c) {
		return
	}
	if !slices.Contains(tiposDeJob, c.Tipo) {
		responder(w, http.StatusBadRequest, map[string]string{"error": "tipo_invalido"})
		return
	}
	params, motivo := lerParams(c.Params)
	if motivo != "" {
		dados.Erro(w, http.StatusBadRequest, "pedido_invalido", motivo)
		return
	}
	if !d.GH.Configurado() { // antes de gravar: sem token nada nasce (Ruling 5.8-6)
		responder(w, http.StatusServiceUnavailable, map[string]string{"error": "github_nao_configurado"})
		return
	}
	ctx := r.Context()
	campanha, _ := texto(params["campanhaId"])
	criou := false
	var job string
	err := banco.ComUsuario(ctx, d.Pool, e.ID, func(tx pgx.Tx) error {
		if c.Tipo == "gerar" && campanha == "" {
			nome := "Rodada · " + time.Now().UTC().Format("2006-01-02 15:04")
			if s, ok := texto(params["nome"]); ok && s != "" {
				nome = s
			}
			objetivo := "engajamento"
			if s, ok := texto(params["objetivo"]); ok && s != "" {
				objetivo = s
			}
			linha, err := tabelaCampanhas.Criar(ctx, tx, autz.Producao, e,
				map[string]any{"nome": nome, "status": "gerando", "objetivo": objetivo})
			if err != nil {
				return err
			}
			var nova struct {
				ID string `json:"id"`
			}
			if err := json.Unmarshal(linha, &nova); err != nil || nova.ID == "" {
				return fmt.Errorf("fabrica-trigger: rodada criada sem id: %v", err)
			}
			campanha, criou = nova.ID, true
			params["campanhaId"], _ = json.Marshal(campanha)
			params["objetivo"], _ = json.Marshal(objetivo)
		}
		j, err := json.Marshal(params)
		if err != nil {
			return err
		}
		// fabrica_jobs: só a chave de serviço gravava (fab_jobs_srv); o portão é o da edge (Ruling 5.8-3).
		if err := tx.QueryRow(ctx, `insert into fabrica_jobs (tipo, params, status, criado_por)
			values ($1::text, $2::jsonb, 'enfileirado', $3::uuid) returning id::text`,
			c.Tipo, string(j), e.ID).Scan(&job); err != nil {
			return err
		}
		if criou {
			_, err = tx.Exec(ctx, `update fabrica_campanhas set job_id = $1::uuid where id = $2::uuid`, job, campanha)
		}
		return err
	})
	if err != nil {
		dados.ErroDeEscrita(w, err)
		return
	}
	var campanhaID any
	if campanha != "" {
		campanhaID = campanha
	}
	inicio := time.Now()
	err = d.GH.Disparar(ctx, "fabrica", map[string]string{"job_id": job})
	if err == nil {
		slog.Info("fabrica-trigger: robô acordado", "tipo", c.Tipo, "job", job, "ms", time.Since(inicio).Milliseconds())
		responder(w, http.StatusOK, map[string]any{"job_id": job, "campanha_id": campanhaID})
		return
	}
	status, codigo, frase, espera := respostaDoDespacho(err)
	slog.Warn("fabrica-trigger: despacho falhou", "tipo", c.Tipo, "job", job, "erro", err.Error(),
		"ms", time.Since(inicio).Milliseconds())
	ctx2, cancelar := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
	defer cancelar()
	if err := marcarFalha(ctx2, d.Pool, e.ID, job, campanha, criou, codigo+" "+err.Error()); err != nil {
		slog.Error("fabrica-trigger: não marquei o job como erro", "job", job, "erro", err.Error())
	}
	if espera > 0 {
		w.Header().Set("Retry-After", strconv.Itoa(int(espera.Round(time.Second).Seconds())))
	}
	responder(w, status, map[string]string{"error": codigo, "detail": frase})
}

// marcarFalha: o job SÓ se ainda enfileirado (o robô que já começou é a verdade) e a rodada que ESTE pedido
// criou SÓ se ainda gerando. Sem isto ficariam "enfileirado"/"gerando" para sempre (a Home consulta a cada 4 s).
func marcarFalha(ctx context.Context, p *pgxpool.Pool, quem, job, campanha string, criou bool, motivo string) error {
	return banco.ComUsuario(ctx, p, quem, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `update fabrica_jobs set status = 'erro', erro = $2::text, updated_at = now()
			where id = $1::uuid and status = 'enfileirado'`, job, motivo); err != nil {
			return err
		}
		if !criou {
			return nil
		}
		_, err := tx.Exec(ctx, `update fabrica_campanhas set status = 'erro' where id = $1::uuid and status = 'gerando'`, campanha)
		return err
	})
}

// respostaDoDespacho: o que a tela recebe por classe; nunca o corpo do GitHub (Ruling 5.8-5).
func respostaDoDespacho(err error) (status int, codigo, frase string, espera time.Duration) {
	var e *github.Erro
	if !errors.As(err, &e) {
		return http.StatusInternalServerError, "erro_interno", "", 0
	}
	switch e.Classe {
	case github.Limite:
		return http.StatusTooManyRequests, "muitas_tentativas", "O GitHub pediu para esperar antes de acordar o robô de novo.", e.EsperarAte
	case github.Incerto:
		return http.StatusGatewayTimeout, "dispatch_incerto",
			"O GitHub não respondeu a tempo. Confira em Actions se o robô começou antes de disparar de novo.", 0
	case github.TokenInvalido:
		return http.StatusBadGateway, "dispatch_falhou", "O token do GitHub (GITHUB_PAT) venceu ou foi revogado.", 0
	case github.SemPermissao:
		return http.StatusBadGateway, "dispatch_falhou",
			`O token do GitHub não pode disparar ação: falta "Actions: Read and write" no repositório.`, 0
	case github.NaoEncontrado:
		return http.StatusBadGateway, "dispatch_falhou",
			"O GitHub não achou o fabrica.yml na branch main (ou o token não enxerga o repositório).", 0
	case github.Recusado:
		return http.StatusBadGateway, "dispatch_falhou", "O GitHub recusou o disparo: o fabrica.yml não aceita estas entradas.", 0
	case github.Indisponivel:
		return http.StatusBadGateway, "dispatch_falhou", "O GitHub está fora do ar. Tente de novo em alguns minutos.", 0
	}
	return http.StatusBadGateway, "dispatch_falhou", "Resposta inesperada do GitHub.", 0
}
```

**(b) Testes de aceitação** (`disparo_test.go`; o GitHub de mentira é um `httptest.Server` que conta os pedidos, guarda o último corpo e, em cada pedido, lê pela pool `select status from fabrica_jobs where id = <job_id do corpo>` — o job tem de estar VISÍVEL, isto é, comitado; `gh := github.ParaTeste(t, "SEGREDO-pat", srv.URL)`; montagem do teste = a da Task 10: `r.With(soFabricante, soSessaoPropria).Post("/fabrica-trigger", (&Disparador{Pool: p, GH: gh}).ServeHTTP)`)
- Gerar sem rodada: `fabricante` `{"tipo":"gerar","params":{"itens":[{"sku":"S1","deposito":"14888726315","pct":30}],"nome":"Rodada X","objetivo":"branding"}}` → 200 com `job_id` e `campanha_id`; efeito: a rodada `nome 'Rodada X'`, `status 'gerando'`, `objetivo 'branding'`, `criado_por = idFabricante`, `job_id = <job>`; o job `tipo 'gerar'`, `status 'enfileirado'`, `criado_por = idFabricante`, `params->>'campanhaId' = <rodada>`, `params->'itens'` intacto; o GitHub com 1 pedido `{"inputs":{"job_id":"<job>"},"ref":"main"}` e o job visível (`enfileirado`) no momento do pedido.
- Gerar sem `nome` → rodada `Rodada · 20…` (prefixo e formato `AAAA-MM-DD HH:MM`); sem `objetivo` → `engajamento`. Subir `{"tipo":"subir","params":{"campanhaId":"<C2>","destino":{"tipo":"nova"}}}` → 200 `"campanha_id":"<C2>"`, nenhuma rodada nova; preview `{"tipo":"preview","params":{}}` → `"campanha_id":null`. `chaveEmLista`, `super`, `adminA1` → 200.
- Negados, com **0 pedidos ao GitHub** e foto igual: `leitor`, `semModulo`, `roboSemFabrica` → 403 `sem_permissao`; `impersonado` → 403 com "Quem entrou como outra pessoa"; `desativado` → 401; `{"tipo":"excluir","params":{}}` → 400 `tipo_invalido`; `{"tipo":"x"}` → 400; `params` `[]`, `1` → 400; `campanhaId` `"abc"` → 400; `params` de 65 KiB → 400; campo desconhecido no topo → 400 `corpo_invalido`; `GITHUB_PAT` vazio (`github.Novo("")`) → 503 `github_nao_configurado`.
- Falhas do GitHub (cada uma num mundo novo): 403 → 502 `dispatch_falhou` com `"detail"` contendo `Actions`, o job `erro` com `erro` começando por `dispatch_falhou github: sem_permissao (403)`, a rodada criada `erro`; 401 → 502 com `GITHUB_PAT` no `detail`; 404 → 502 com `fabrica.yml`; 429 + `Retry-After: 60` → 429 `muitas_tentativas` e cabeçalho `Retry-After: 60`; servidor que dorme além do prazo do cliente (`gh` com prazo de 50 ms: o teste troca por `ParaTeste` + o servidor dormindo 200 ms; ver Step 2) → 504 `dispatch_incerto`, job e rodada `erro`; nenhum corpo de resposta contém `SEGREDO`. Subir com 500 → 502 e C2 continua `pronta` (Ruling 5.8-8). Robô que já começou: o servidor de mentira faz `update fabrica_jobs set status = 'rodando'` antes de responder 500 → o job continua `rodando`.
- Mutações que têm de reprovar: conferir o token DEPOIS da transação 1 (o caso 503 deixa job e rodada); despachar DENTRO da transação (o GitHub de mentira não acha o job); tirar `and status = 'enfileirado'` (o caso do robô que já começou vira `erro`); marcar a rodada sem olhar `criou` (C2 vira `erro` no subir); devolver o corpo do GitHub no `detail` (o `SEGREDO` do corpo de mentira aparece).

**(c) Arquivos:** Create `api/internal/fabrica/disparo.go`, `api/internal/fabrica/disparo_test.go`.

**(d) Dependências:** Tasks 2 e 3; `dados.Tabela.Criar`, `github.ParaTeste`.

- [ ] **Step 1:** Testes; ver falhar. - [ ] **Step 2:** Implementar (código de (a)). O caso `Incerto` precisa de um cliente com prazo curto: acrescente em `github` o ajuste SÓ de teste `func (c *Cliente) ComPrazoDeTeste(t testing.TB, d time.Duration) *Cliente` (exige `loopback(c.base)`; derruba o teste se não for) — ou, mais simples, deixe o servidor de mentira fechar a conexão sem responder (`http.Hijacker` + `Close`), que o `net/http` devolve como erro de transporte depois de conectar: `Incerto`. Prefira a segunda (nada a mais no pacote). - [ ] **Step 3:** `gofmt -l ./internal && go vet ./internal/fabrica/ && go test -count=1 -race ./internal/fabrica/` PASS; mutações reprovam. - [ ] **Step 4:** Commit `feat(api): fabrica-trigger — rodada e job numa transação, robô acordado fora dela, falha que não deixa job pendurado` (+ `Co-Authored-By`).

---

### Task 6: `POST /fabrica-apagar` — banco, run cancelado e arquivos só dentro da raiz

**Revisor:** opus. **Depende de:** 2, 3.

**(a) Contrato** (o da edge `supabase/functions/fabrica-apagar/index.ts`: corpo `{campanhaId}`, resposta `{"ok":true}`, `400 {"error":"campanhaId_obrigatorio"}` — home:106 e :128 trocam só a URL —, com a ordem e o disco por Ruling 5.8-9)
- Portão: `soFabricante` + `soSessaoPropria` (a edge: o mesmo trio). Regra do catálogo também: `autz.Producao.PodeApagar(…, "fabrica_campanhas", id)` na transação (`fab_camp_write`; o `cascade` leva os criativos, que têm a mesma regra).
- `campanhaId` ausente, `null` ou `""` → `400 campanhaId_obrigatorio`; não-uuid → `400 campanhaId_invalido` (a edge devolvia `{"ok":true}` sem apagar nada, porque o PostgREST falhava e o `maybeSingle` dava nulo).
- **O que apaga e em que ordem:**
  1. **Transação** (`banco.ComUsuario`): trava a rodada (`for update`); não existe → `200 {"ok":true}` (idempotente, como a edge); `PodeApagar`; lê o `github_run_id` do job SE a rodada está `gerando` com `job_id`; lê os `storage_path` não vazios dos criativos; `delete from fabrica_campanhas` (os criativos vão pelo `on delete cascade`). Commit. O banco é a fonte da verdade: depois daqui a rodada não existe para ninguém.
  2. **Cancelar o run** (melhor esforço, `github.Cancelar(ctx, "fabrica", runID)`; já terminado = sucesso): o robô que ainda estiver rodando grava em `fabrica_criativos` de uma rodada que não existe — a FK recusa e ele para.
  3. **Arquivos** (melhor esforço): cada `storage_path` pela MESMA `apagar(raiz, c)` da purga (`filepath.IsLocal`, sem NUL, `os.Root` em `<ARQUIVOS_DIR>/fabrica-criativos`: caminho com `..`, absoluto ou symlink de diretório para fora é recusado; arquivo que já não existe conta como apagado) e, depois, `raiz.RemoveAll(<campanhaId>)` — a pasta da rodada, onde mora o que não tem linha (o `.mp4` do 16:9, `hero-ia.mjs:168`); o `campanhaId` é uuid conferido, e `os.Root` não segue symlink para fora. Falha de arquivo não volta o banco atrás: vai para o log (contagem e o erro de cada um) e sobra para a `faxina-fabrica` da VPS, que apaga o que não tem linha (INVENTARIO 2.1).
- Segunda chamada com o mesmo id → `200 {"ok":true}`, sem GitHub e sem disco.

```go
package fabrica

import (
	"errors"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/autz"
	"github.com/rbv-co/social-dashboard/api/internal/banco"
	"github.com/rbv-co/social-dashboard/api/internal/dados"
	"github.com/rbv-co/social-dashboard/api/internal/github"
)

// Apagador: POST /fabrica-apagar. Portão (soFabricante, soSessaoPropria) na montagem.
type Apagador struct {
	Pool     *pgxpool.Pool
	GH       *github.Cliente
	Arquivos string // ARQUIVOS_DIR: os criativos moram em <Arquivos>/fabrica-criativos/<storage_path>
}

type pedidoApagar struct {
	CampanhaID *string `json:"campanhaId"`
}

func (a *Apagador) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	e := autz.EscopoDo(r.Context())
	if e == nil {
		dados.Erro(w, http.StatusInternalServerError, "erro_interno", "")
		return
	}
	var c pedidoApagar
	if !dados.LerCorpo(w, r, &c) {
		return
	}
	if c.CampanhaID == nil || *c.CampanhaID == "" {
		responder(w, http.StatusBadRequest, map[string]string{"error": "campanhaId_obrigatorio"})
		return
	}
	id := *c.CampanhaID
	if !reUUID.MatchString(id) {
		responder(w, http.StatusBadRequest, map[string]string{"error": "campanhaId_invalido"})
		return
	}
	ctx := r.Context()
	achou := true
	var runID string
	var caminhos []string
	err := banco.ComUsuario(ctx, a.Pool, e.ID, func(tx pgx.Tx) error {
		var status string
		var job *string
		err := tx.QueryRow(ctx, `select status, job_id::text from fabrica_campanhas where id = $1::uuid for update`, id).
			Scan(&status, &job)
		if errors.Is(err, pgx.ErrNoRows) {
			achou = false
			return nil
		}
		if err != nil {
			return err
		}
		if err := autz.Producao.PodeApagar(ctx, tx, e, "fabrica_campanhas", id); err != nil {
			return err
		}
		if status == "gerando" && job != nil {
			err := tx.QueryRow(ctx, `select coalesce(github_run_id, '') from fabrica_jobs where id = $1::uuid`, *job).Scan(&runID)
			if err != nil && !errors.Is(err, pgx.ErrNoRows) {
				return err
			}
		}
		linhas, err := tx.Query(ctx, `select storage_path from fabrica_criativos
			where campanha_id = $1::uuid and coalesce(storage_path, '') <> ''`, id)
		if err != nil {
			return err
		}
		if caminhos, err = pgx.CollectRows(linhas, pgx.RowTo[string]); err != nil {
			return err
		}
		_, err = tx.Exec(ctx, `delete from fabrica_campanhas where id = $1::uuid`, id) // criativos: on delete cascade
		return err
	})
	if err != nil {
		dados.ErroDeEscrita(w, err)
		return
	}
	if !achou {
		responder(w, http.StatusOK, map[string]bool{"ok": true}) // idempotente (fabrica-apagar/index.ts:17)
		return
	}
	// Depois do commit, melhor esforço (Ruling 5.8-9): o banco já é a verdade.
	if runID != "" {
		if err := a.GH.Cancelar(ctx, "fabrica", runID); err != nil {
			slog.Warn("fabrica-apagar: não cancelei o run", "campanha", id, "erro", err.Error())
		}
	}
	falhas := a.apagarArquivos(id, caminhos)
	slog.Info("fabrica-apagar", "campanha", id, "arquivos", len(caminhos), "arquivos_com_erro", falhas, "cancelou_run", runID != "")
	responder(w, http.StatusOK, map[string]bool{"ok": true})
}

// apagarArquivos: cada caminho pela apagar da purga (mesma raiz, mesmo IsLocal) e a pasta da rodada.
// Devolve quantos falharam; o que sobrar é da faxina-fabrica.
func (a *Apagador) apagarArquivos(campanha string, caminhos []string) (falhas int) {
	raiz, err := os.OpenRoot(filepath.Join(a.Arquivos, "fabrica-criativos"))
	if err != nil {
		slog.Error("fabrica-apagar: pasta-base inacessível; os arquivos ficam para a faxina", "erro", err.Error())
		return len(caminhos) + 1
	}
	defer raiz.Close()
	for _, c := range caminhos {
		if err := apagar(raiz, c); err != nil {
			falhas++
			slog.Warn("fabrica-apagar: arquivo não apagado", "campanha", campanha, "erro", err.Error())
		}
	}
	if err := raiz.RemoveAll(campanha); err != nil { // o que não tem linha (o .mp4 do 16:9) mora em <id>/
		falhas++
		slog.Warn("fabrica-apagar: pasta da rodada não apagada", "campanha", campanha, "erro", err.Error())
	}
	return falhas
}
```

**(b) Testes de aceitação** (`apagar_test.go`; `dir := t.TempDir()` com `fabrica-criativos/` e os arquivos dos criativos do mundo, mais `fabrica-criativos/<C1>/produto/s1-avista-1920x1080.mp4` (sem linha) e `dir/fora.txt`; o GitHub de mentira conta os pedidos; montagem `r.With(soFabricante, soSessaoPropria).Post("/fabrica-apagar", (&Apagador{Pool: p, GH: gh, Arquivos: dir}).ServeHTTP)`)
- Rodada gerando: `fabricante` `{"campanhaId":"<C1>"}` → 200 `{"ok":true}`; efeito: C1, K1 e K2 fora do banco (J1 fica: é histórico); `fabrica-criativos/<C1>` não existe mais (com o `.mp4`); o GitHub com 1 pedido `POST /repos/rbv-co/social-dashboard/actions/runs/111/cancel`. De novo → 200 `{"ok":true}`, 0 pedidos a mais, nada muda.
- Rodada pronta (C2): sem pedido ao GitHub; K3 e o arquivo dela somem.
- Caminho fora da raiz: antes, `insert` de criativos em C2 com `storage_path` `../fora.txt`, `/etc/hostname` e `<C2>/../../fora.txt` → 200 (o banco apagou), `dir/fora.txt` continua lá; o log tem "arquivo não apagado".
- Symlink: `fabrica-criativos/<C3>` é um symlink para `dir/externo/` (com `produto/s3-avista-1080x1080.png` dentro) → apagar C3 → 200; `dir/externo/produto/s3-avista-1080x1080.png` continua existindo.
- Negados, com GitHub 0, foto igual e todos os arquivos no lugar: `leitor`, `semModulo`, `roboSemFabrica` → 403; `impersonado` → 403 com a frase; `desativado` → 401.
- Corpo: `{}` e `{"campanhaId":""}` → 400 `campanhaId_obrigatorio`; `{"campanhaId":"x"}` → 400 `campanhaId_invalido`; uuid inexistente → 200 `{"ok":true}` com 0 pedidos.
- Disco e GitHub fora: `Arquivos` apontando para pasta que não existe → 200 e C2 fora do banco (o log diz "pasta-base inacessível"); GitHub respondendo 500 no cancelamento → 200 e C1 fora do banco.
- Mutações que têm de reprovar: trocar `apagar(raiz, c)` por `os.Remove(filepath.Join(a.Arquivos, "fabrica-criativos", c))` (`dir/fora.txt` some); `os.RemoveAll(filepath.Join(...))` no lugar de `raiz.RemoveAll` (o arquivo de `dir/externo` some pelo symlink); responder 404 para rodada inexistente (a segunda chamada reprova); apagar os arquivos ANTES do commit e fazer o banco falhar (gatilho de teste que dá `raise` no delete) → os arquivos sumiram e a rodada ficou (o teste confere que, com o banco falhando, os arquivos continuam).

**(c) Arquivos:** Create `api/internal/fabrica/apagar.go`, `api/internal/fabrica/apagar_test.go`.

**(d) Dependências:** Tasks 2 e 3; `apagar` de `purga.go`; `autz.PodeApagar`.

- [ ] **Step 1:** Testes; ver falhar. - [ ] **Step 2:** Implementar (código de (a)). - [ ] **Step 3:** `gofmt -l ./internal && go vet ./internal/fabrica/ && go test -count=1 -race ./internal/fabrica/` PASS (a purga continua verde); mutações reprovam. - [ ] **Step 4:** Commit `feat(api): fabrica-apagar — banco primeiro, run cancelado e arquivos só dentro da raiz, idempotente` (+ `Co-Authored-By`).

---
