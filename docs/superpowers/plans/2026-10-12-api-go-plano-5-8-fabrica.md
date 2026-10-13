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
4. **Rota de robô aberta a sessão de painel, ou robô passando por cima do próprio perfil** — painel (mesmo fabricante ou admin) → 403; robô sem a chave `meta.fabrica` → 403 nas escritas; nada gravado. Testes: `TestRotasDeRobo` (Task 9), `TestRotasDeRoboSoServico` e `TestFabricaPelaMontagemReal` (Task 10).
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
api/internal/fabrica/purga.go                            # (mod.) só a linha "// Package fabrica" sai (a doc passa a fabrica.go)
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

**Não toca:** `esquema/gerar-gatilhos.mjs` nem `02-gatilhos.sql` (nenhuma das 9 tabelas tem gatilho em produção: `levantamento/03-triggers.csv` não as cita; nem função: `02-funções.csv` idem); `autz` (as 18 policies já compilam: `termoChave("meta.fabrica")`, `termoSuper()`, `podeVerConta`); `meta`/`meta-proxy` (o `painel-subir.vue` continua usando o do Plano 3 com o escopo do 5.6); `fabrica/purga.go` além da linha do comentário do pacote (Task 3; a `apagar` dele é reusada); `coletor/` e `src/` (Plano 7).

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
| 9 | Rotas de robô (`/fabrica/robo/…`): jobs, próximo lote, campanha, criativos, look, rastro da Meta, execução | **opus** (sessão de serviço, perfil do robô) | 3, 4, 5 (`tabelaCriativos`, `tabelaCampanhas`) |
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
	"errors"
	"net/http"
	"net/url"
	"regexp"
	"slices"
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

var (
	reUUID      = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)
	reChaveLook = regexp.MustCompile(`^[a-z0-9][a-z0-9_-]{0,79}$`) // chave de fabrica_looks (templates.mjs, IA_LOOKS)
	reRunID     = regexp.MustCompile(`^[0-9]{1,20}$`)              // id de execução do GitHub Actions
)

// errPedido: entrada inválida descoberta dentro da transação; escritaOuPedido responde 400 com a frase.
type errPedido struct{ frase string }

func (e errPedido) Error() string { return e.frase }

func escritaOuPedido(w http.ResponseWriter, err error) {
	var ep errPedido
	if errors.As(err, &ep) {
		dados.Erro(w, http.StatusBadRequest, "pedido_invalido", ep.frase)
		return
	}
	dados.ErroDeEscrita(w, err)
}

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

func textoEm(v json.RawMessage, opcoes ...string) bool {
	s, ok := texto(v)
	return ok && slices.Contains(opcoes, s)
}

// textoOuNulo: ausente, null ou texto de até max caracteres (vazio pode).
func textoOuNulo(v json.RawMessage, max int) bool { return len(v) == 0 || nulo(v) || textoAte(v, max, true) }

// numeroOuNulo: ausente, null ou número ≥ 0.
func numeroOuNulo(v json.RawMessage) bool {
	var f float64
	return len(v) == 0 || nulo(v) || (json.Unmarshal(v, &f) == nil && f >= 0)
}

// inteiroOuNulo: ausente, null ou inteiro ≥ 0 (cabe em bigint).
func inteiroOuNulo(v json.RawMessage) bool {
	var n int64
	return len(v) == 0 || nulo(v) || (json.Unmarshal(v, &n) == nil && n >= 0)
}

// urlValida: http(s) absoluto, com host, até 2000 caracteres (o endereço público do arquivo; quem lê é a Meta).
func urlValida(v json.RawMessage) bool {
	s, ok := texto(v)
	if !ok || utf8.RuneCountInString(s) > 2000 {
		return false
	}
	u, err := url.Parse(s)
	return err == nil && (u.Scheme == "https" || u.Scheme == "http") && u.Host != "" && u.User == nil
}
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
- `TestAjudantesDeValidacao` (puro): `texto` recusa `null`, `5`, `{}`; `textoAte("\"  \"", 10, false)` = falso e com `true` = verdadeiro; conta caracteres (`"ção"` cabe em 3); `objeto` aceita `{}` e recusa `[]`/`null`; `lista` aceita `[]` e recusa `{}`; `booleano` só `true`/`false`; `urlValida` aceita `https://midia.x/f/a.png` e recusa `javascript:alert(1)`, `/f/a.png`, `https://u:s@x/a`; `numeroOuNulo("-1")` falso; `inteiroOuNulo("1.5")` falso; `escritaOuPedido` com `errPedido{"x"}` → 400 `pedido_invalido` "x" e com `autz.ErrNegado` → 403.
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
- Limite por pessoa: 30 disparos por hora (`auth.Limitador` em memória, Ruling 5.8-16); acima = `429 muitas_tentativas` com `Retry-After`, sem gravar nem despachar. Cada disparo acorda um robô que pode gastar IA paga (gpt-image-2) e criar anúncio na Meta.
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
	"github.com/rbv-co/social-dashboard/api/internal/auth"
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
	Pool   *pgxpool.Pool
	GH     *github.Cliente
	Limite *auth.Limitador // por pessoa (Ruling 5.8-16); Montar põe 30 por hora
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
	if d.Limite != nil && !d.Limite.Tentar(e.ID) {
		w.Header().Set("Retry-After", strconv.Itoa(int(d.Limite.Janela.Seconds())))
		dados.Erro(w, http.StatusTooManyRequests, "muitas_tentativas", "Muitos disparos seguidos; espere um pouco.")
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

**(b) Testes de aceitação** (`TestTrigger`, `disparo_test.go`; o GitHub de mentira é um `httptest.Server` que conta os pedidos, guarda o último corpo e, em cada pedido, lê pela pool `select status from fabrica_jobs where id = <job_id do corpo>` — o job tem de estar VISÍVEL, isto é, comitado; `gh := github.ParaTeste(t, "SEGREDO-pat", srv.URL)`; montagem do teste = a da Task 10: `r.With(soFabricante, soSessaoPropria).Post("/fabrica-trigger", (&Disparador{Pool: p, GH: gh, Limite: lim}).ServeHTTP)`, `lim` = `auth.NovoLimitador()` com `Max 30, Janela time.Hour` salvo no caso do limite)
- Gerar sem rodada: `fabricante` `{"tipo":"gerar","params":{"itens":[{"sku":"S1","deposito":"14888726315","pct":30}],"nome":"Rodada X","objetivo":"branding"}}` → 200 com `job_id` e `campanha_id`; efeito: a rodada `nome 'Rodada X'`, `status 'gerando'`, `objetivo 'branding'`, `criado_por = idFabricante`, `job_id = <job>`; o job `tipo 'gerar'`, `status 'enfileirado'`, `criado_por = idFabricante`, `params->>'campanhaId' = <rodada>`, `params->'itens'` intacto; o GitHub com 1 pedido `{"inputs":{"job_id":"<job>"},"ref":"main"}` e o job visível (`enfileirado`) no momento do pedido.
- Gerar sem `nome` → rodada `Rodada · 20…` (prefixo e formato `AAAA-MM-DD HH:MM`); sem `objetivo` → `engajamento`. Subir `{"tipo":"subir","params":{"campanhaId":"<C2>","destino":{"tipo":"nova"}}}` → 200 `"campanha_id":"<C2>"`, nenhuma rodada nova; preview `{"tipo":"preview","params":{}}` → `"campanha_id":null`. `chaveEmLista`, `super`, `adminA1` → 200.
- Negados, com **0 pedidos ao GitHub** e foto igual: `leitor`, `semModulo`, `roboSemFabrica` → 403 `sem_permissao`; `impersonado` → 403 com "Quem entrou como outra pessoa"; `desativado` → 401; `{"tipo":"excluir","params":{}}` → 400 `tipo_invalido`; `{"tipo":"x"}` → 400; `params` `[]`, `1` → 400; `campanhaId` `"abc"` → 400; `params` de 65 KiB → 400; campo desconhecido no topo → 400 `corpo_invalido`; `GITHUB_PAT` vazio (`github.Novo("")`) → 503 `github_nao_configurado`; com `Limite` de `Max 2` por hora, o 3º disparo válido da mesma pessoa → 429 `muitas_tentativas` com `Retry-After: 3600` (e o de OUTRA pessoa passa).
- Falhas do GitHub (cada uma num mundo novo): 403 → 502 `dispatch_falhou` com `"detail"` contendo `Actions`, o job `erro` com `erro` começando por `dispatch_falhou github: sem_permissao (403)`, a rodada criada `erro`; 401 → 502 com `GITHUB_PAT` no `detail`; 404 → 502 com `fabrica.yml`; 429 + `Retry-After: 60` → 429 `muitas_tentativas` e cabeçalho `Retry-After: 60`; servidor que fecha a conexão sem responder (`http.Hijacker` + `Close`: o `net/http` devolve erro de transporte DEPOIS de conectar) → 504 `dispatch_incerto`, job e rodada `erro`; nenhum corpo de resposta contém `SEGREDO`. Subir com 500 → 502 e C2 continua `pronta` (Ruling 5.8-8). Robô que já começou: o servidor de mentira faz `update fabrica_jobs set status = 'rodando'` antes de responder 500 → o job continua `rodando`.
- Mutações que têm de reprovar: conferir o token DEPOIS da transação 1 (o caso 503 deixa job e rodada); despachar DENTRO da transação (o GitHub de mentira não acha o job); tirar `and status = 'enfileirado'` (o caso do robô que já começou vira `erro`); marcar a rodada sem olhar `criou` (C2 vira `erro` no subir); devolver o corpo do GitHub no `detail` (o `SEGREDO` do corpo de mentira aparece).

**(c) Arquivos:** Create `api/internal/fabrica/disparo.go`, `api/internal/fabrica/disparo_test.go`.

**(d) Dependências:** Tasks 2 e 3; `dados.Tabela.Criar`, `github.ParaTeste`.

- [ ] **Step 1:** Testes; ver falhar. - [ ] **Step 2:** Implementar (código de (a)). - [ ] **Step 3:** `gofmt -l ./internal && go vet ./internal/fabrica/ && go test -count=1 -race ./internal/fabrica/` PASS; mutações reprovam. - [ ] **Step 4:** Commit `feat(api): fabrica-trigger — rodada e job numa transação, robô acordado fora dela, falha que não deixa job pendurado` (+ `Co-Authored-By`).

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

**(b) Testes de aceitação** (`TestApagar`, `apagar_test.go`; `dir := t.TempDir()` com `fabrica-criativos/` e os arquivos dos criativos do mundo, mais `fabrica-criativos/<C1>/produto/s1-avista-1920x1080.mp4` (sem linha) e `dir/fora.txt`; o GitHub de mentira conta os pedidos; montagem `r.With(soFabricante, soSessaoPropria).Post("/fabrica-apagar", (&Apagador{Pool: p, GH: gh, Arquivos: dir}).ServeHTTP)`)
- Rodada gerando: `fabricante` `{"campanhaId":"<C1>"}` → 200 `{"ok":true}`; efeito: C1, K1 e K2 fora do banco (J1 fica: é histórico); `fabrica-criativos/<C1>` não existe mais (com o `.mp4`); o GitHub com 1 pedido `POST /repos/rbv-co/social-dashboard/actions/runs/111/cancel`. De novo → 200 `{"ok":true}`, 0 pedidos a mais, nada muda.
- Rodada pronta (C2): sem pedido ao GitHub; K3 e o arquivo dela somem.
- Caminho fora da raiz: antes, `insert` de criativos em C2 com `storage_path` `../fora.txt`, `/etc/hostname` e `<C2>/../../fora.txt` → 200 (o banco apagou), `dir/fora.txt` continua lá; o log tem "arquivo não apagado".
- Symlink: `fabrica-criativos/<C3>` é um symlink para `dir/externo/` (com `produto/s3-avista-1080x1080.png` dentro) → apagar C3 → 200; `dir/externo/produto/s3-avista-1080x1080.png` continua existindo.
- Negados, com GitHub 0, foto igual e todos os arquivos no lugar: `leitor`, `semModulo`, `roboSemFabrica` → 403; `impersonado` → 403 com a frase; `desativado` → 401.
- Corpo: `{}` e `{"campanhaId":""}` → 400 `campanhaId_obrigatorio`; `{"campanhaId":"x"}` → 400 `campanhaId_invalido`; uuid inexistente → 200 `{"ok":true}` com 0 pedidos.
- Banco que falha no meio: um gatilho de teste `before delete on fabrica_campanhas` que dá `raise exception` só para C2 → resposta ≠ 200, C2 e K3 continuam no banco e o arquivo de K3 continua no disco (arquivo só sai depois do commit).
- Disco e GitHub fora: `Arquivos` apontando para pasta que não existe → 200 e C2 fora do banco (o log diz "pasta-base inacessível"); GitHub respondendo 500 no cancelamento → 200 e C1 fora do banco.
- Mutações que têm de reprovar: trocar `apagar(raiz, c)` por `os.Remove(filepath.Join(a.Arquivos, "fabrica-criativos", c))` (`dir/fora.txt` some); `os.RemoveAll(filepath.Join(...))` no lugar de `raiz.RemoveAll` (o arquivo de `dir/externo` some pelo symlink); responder 404 para rodada inexistente (a segunda chamada reprova); apagar os arquivos ANTES do commit (o caso do banco que falha perde o arquivo de K3).

**(c) Arquivos:** Create `api/internal/fabrica/apagar.go`, `api/internal/fabrica/apagar_test.go`.

**(d) Dependências:** Tasks 2 e 3; `apagar` de `purga.go`; `autz.PodeApagar`.

- [ ] **Step 1:** Testes; ver falhar. - [ ] **Step 2:** Implementar (código de (a)). - [ ] **Step 3:** `gofmt -l ./internal && go vet ./internal/fabrica/ && go test -count=1 -race ./internal/fabrica/` PASS (a purga continua verde); mutações reprovam. - [ ] **Step 4:** Commit `feat(api): fabrica-apagar — banco primeiro, run cancelado e arquivos só dentro da raiz, idempotente` (+ `Co-Authored-By`).

---
### Task 7: `POST /fabrica-candidatos` — o cálculo da edge, portado fiel, só com lojas da Fábrica

**Revisor:** sonnet. **Depende de:** 3; 5.5 Task 1 (`gc_vendas_item`, `gc_estoque_item`, `gestao_comercial_briefings` no D0).

**(a) Contrato** (o da edge `supabase/functions/fabrica-candidatos/index.ts`: corpo `{lojas, fonte, filtros}`, resposta `{"candidatos": [{sku, nome, categoria, porLoja: {<depósito>: {preco, pctPrevisto, precoComDesconto, estoque}}}]}`, `400 {"error":"fonte_invalida"}` — `use-candidatos.js:7` troca só a URL)
- Portão: `soFabricante`. SÓ LEITURA: a sessão de "entrar como" passa (vê o que o alvo veria; Ruling 18 do mestre).
- Lê como a edge lia (chave de serviço): `gc_*` SEM as restritivas `pode_ver_estoque`/`pode_ver_canal` do 5.5 — o resultado é agregado por SKU sobre as lojas da Fábrica, e recortar pela equipe de quem pede mudaria a lista de quem tem escopo por equipe (Ruling 5.8-10).
- **Lojas só da Fábrica:** `lojas` (até 20, cada uma só dígitos) é filtrada por `fabrica_lojas` (na ordem do pedido, sem repetição); depósito fora da Fábrica é ignorado em TUDO — a edge o usava cru na leitura do estoque e no `porLoja`, o que deixava qualquer fabricante ler o estoque de qualquer depósito do Bling (Ruling 5.8-10).
- `fonte` = `oportunidades|garimpo` (o bloco `dados_json[fonte]` do briefing mais recente: `order by rodada desc, created_at desc limit 1`; cada bloco casa a loja cujo NOME contém o texto `bloco.loja`, sem caixa, a primeira na ordem do pedido; item sem `sku` é pulado), `bcg|abc` (vendas dos canais das lojas + estoque dos depósitos; `abc`: faixa A/B/C pela soma acumulada ≤ 0,8 / ≤ 0,95, filtro `filtros.faixa`; `bcg`: quadrante de `bcgClass` em ALGUMA loja ∈ `filtros.quadrantes` — padrão Estrela, Vaca leiteira, Interrogação; `filtros.categoria` por substring sem caixa), `manual` (`filtros.termo` em produto ou SKU, sem caixa; primeira linha de cada SKU). `porLoja` de `bcg|abc|manual` só com as lojas de estoque > 0 (`preco`, `pctPrevisto`, `precoComDesconto` nulos).
- **Sem o teto de 1000 do PostgREST:** a edge lia `gc_vendas_item` pelo REST, que corta em 1000 linhas sem avisar (a tabela tem 3591: `levantamento/07-linhas.csv:15`); a API lê tudo (achado 5).
- Ordem determinística: a primeira aparição de cada SKU, com as vendas em `order by sku, canal_loja_id, mes`; `abc` reordena por faturamento (estável). A edge herdava a ordem das chaves de objeto do JavaScript (SKU numérico antes, crescente): o conteúdo é o mesmo, a ordem pode mudar (a tela mostra na ordem que chega).
- `filtros` é objeto com `faixa`, `quadrantes`, `categoria` e `termo` em texto (lista de texto em `quadrantes`); outro formato = `400 pedido_invalido`.

```go
package fabrica

import (
	"context"
	"encoding/json"
	"errors"
	"math"
	"net/http"
	"regexp"
	"slices"
	"sort"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/dados"
)

var reDeposito = regexp.MustCompile(`^[0-9]{1,18}$`)

type pedidoCandidatos struct {
	Lojas   []string        `json:"lojas"`
	Fonte   string          `json:"fonte"`
	Filtros json.RawMessage `json:"filtros"`
}

type filtrosCandidatos struct {
	Faixa      string    `json:"faixa"`
	Quadrantes *[]string `json:"quadrantes"`
	Categoria  string    `json:"categoria"`
	Termo      string    `json:"termo"`
}

// candidato: o formato da edge. sku/nome/categoria vêm crus do briefing (texto, número ou nulo); ausente
// some do JSON, como o JSON.stringify da edge fazia com undefined.
type candidato struct {
	SKU       json.RawMessage            `json:"sku"`
	Nome      json.RawMessage            `json:"nome,omitempty"`
	Categoria json.RawMessage            `json:"categoria,omitempty"`
	PorLoja   map[string]json.RawMessage `json:"porLoja"`
}

type lojaDaFabrica struct {
	deposito, nome string
	canal          *string
}

// Candidatos: POST /fabrica-candidatos. Portão (soFabricante) na montagem; só lê.
type Candidatos struct{ Pool *pgxpool.Pool }

func (cs *Candidatos) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	var c pedidoCandidatos
	if !dados.LerCorpo(w, r, &c) {
		return
	}
	var f filtrosCandidatos
	if len(c.Filtros) > 0 && !nulo(c.Filtros) {
		if !objeto(c.Filtros) || json.Unmarshal(c.Filtros, &f) != nil {
			dados.Erro(w, http.StatusBadRequest, "pedido_invalido", "filtros é um objeto com faixa, quadrantes, categoria e termo.")
			return
		}
	}
	if len(c.Lojas) > 20 {
		dados.Erro(w, http.StatusBadRequest, "pedido_invalido", "No máximo 20 lojas.")
		return
	}
	for _, l := range c.Lojas {
		if !reDeposito.MatchString(l) {
			dados.Erro(w, http.StatusBadRequest, "pedido_invalido", "lojas são ids de depósito.")
			return
		}
	}
	if !slices.Contains([]string{"oportunidades", "garimpo", "bcg", "abc", "manual"}, c.Fonte) {
		responder(w, http.StatusBadRequest, map[string]string{"error": "fonte_invalida"})
		return
	}
	ctx := r.Context()
	lojas, err := lojasDaFabrica(ctx, cs.Pool, c.Lojas)
	var out []candidato
	if err == nil {
		switch c.Fonte {
		case "oportunidades", "garimpo":
			out, err = doBriefing(ctx, cs.Pool, c.Fonte, lojas)
		case "bcg", "abc":
			out, err = deVendas(ctx, cs.Pool, c.Fonte, lojas, f)
		default:
			out, err = manual(ctx, cs.Pool, lojas, f)
		}
	}
	if err != nil {
		dados.ErroDoBanco(w, err)
		return
	}
	if out == nil {
		out = []candidato{}
	}
	responder(w, http.StatusOK, map[string]any{"candidatos": out})
}

// lojasDaFabrica: as pedidas que existem em fabrica_lojas, na ordem do pedido e sem repetição (Ruling 5.8-10).
func lojasDaFabrica(ctx context.Context, p *pgxpool.Pool, pedidas []string) ([]lojaDaFabrica, error) {
	linhas, err := p.Query(ctx, `select deposito_id, nome, canal_loja_id from fabrica_lojas where deposito_id = any($1::text[])`, pedidas)
	if err != nil {
		return nil, err
	}
	cfg := map[string]lojaDaFabrica{}
	var l lojaDaFabrica
	if _, err := pgx.ForEachRow(linhas, []any{&l.deposito, &l.nome, &l.canal}, func() error {
		cfg[l.deposito] = l
		return nil
	}); err != nil {
		return nil, err
	}
	var out []lojaDaFabrica
	for _, d := range pedidas {
		if x, ok := cfg[d]; ok {
			out = append(out, x)
			delete(cfg, d)
		}
	}
	return out, nil
}

func depositos(lojas []lojaDaFabrica) []int64 {
	var out []int64
	for _, l := range lojas {
		if n, err := strconv.ParseInt(l.deposito, 10, 64); err == nil {
			out = append(out, n)
		}
	}
	return out
}

func canais(lojas []lojaDaFabrica) []int64 {
	var out []int64
	for _, l := range lojas {
		if l.canal != nil {
			if n, err := strconv.ParseInt(*l.canal, 10, 64); err == nil {
				out = append(out, n)
			}
		}
	}
	return out
}

// estoques: "<depósito>|<sku>" → saldo, só dos depósitos da Fábrica pedidos.
func estoques(ctx context.Context, p *pgxpool.Pool, lojas []lojaDaFabrica) (map[string]int64, error) {
	linhas, err := p.Query(ctx, `select deposito_id::text, sku, saldo::bigint from gc_estoque_item
		where deposito_id = any($1::bigint[])`, depositos(lojas))
	if err != nil {
		return nil, err
	}
	out := map[string]int64{}
	var dep, sku string
	var saldo int64
	_, err = pgx.ForEachRow(linhas, []any{&dep, &sku, &saldo}, func() error {
		out[dep+"|"+sku] = saldo
		return nil
	})
	return out, err
}

func porLojaDoEstoque(lojas []lojaDaFabrica, est map[string]int64, sku string) map[string]json.RawMessage {
	out := map[string]json.RawMessage{}
	for _, l := range lojas {
		if n := est[l.deposito+"|"+sku]; n > 0 {
			out[l.deposito], _ = json.Marshal(map[string]any{"preco": nil, "pctPrevisto": nil, "precoComDesconto": nil, "estoque": n})
		}
	}
	return out
}

// bcgClass: a de supabase/functions/fabrica-candidatos/index.ts:4-10 (espelho do lib do coletor). Com d = 0
// (gc_* não tem a data da última venda), "recente" é sempre verdadeiro: Abacaxi nunca sai, como na edge.
func bcgClass(e, g, d float64) string {
	st := g / math.Max(1, g+e)
	recente := !math.IsNaN(d) && !math.IsInf(d, 0) && d <= 21
	switch {
	case g > 0 && st >= 0.5:
		return "Estrela"
	case g > 0 && st >= 0.25:
		return "Vaca leiteira"
	case recente || g > 0:
		return "Interrogação"
	}
	return "Abacaxi"
}

// textoJS: String(x) do JavaScript para o que a edge comparava (bloco.loja).
func textoJS(v json.RawMessage) string {
	if len(v) == 0 {
		return "undefined"
	}
	if s, ok := texto(v); ok {
		return s
	}
	return string(v)
}

func doBriefing(ctx context.Context, p *pgxpool.Pool, fonte string, lojas []lojaDaFabrica) ([]candidato, error) {
	var bruto []byte
	err := p.QueryRow(ctx, `select dados_json -> $1::text from gestao_comercial_briefings
		order by rodada desc, created_at desc limit 1`, fonte).Scan(&bruto)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var blocos []struct {
		Loja  json.RawMessage              `json:"loja"`
		Itens []map[string]json.RawMessage `json:"itens"`
	}
	if len(bruto) == 0 || json.Unmarshal(bruto, &blocos) != nil {
		return nil, nil // sem o bloco ou fora do formato [{loja, itens}]: nada (a edge quebraria com 500)
	}
	idx := map[string]int{}
	var out []candidato
	campos := [][2]string{{"precoOriginal", "preco"}, {"pct", "pctPrevisto"}, {"precoComDesconto", "precoComDesconto"}, {"estoqueLoja", "estoque"}}
	for _, b := range blocos {
		alvo := strings.ToLower(textoJS(b.Loja))
		dep := ""
		for _, l := range lojas {
			if strings.Contains(strings.ToLower(l.nome), alvo) {
				dep = l.deposito
				break
			}
		}
		if dep == "" {
			continue
		}
		for _, it := range b.Itens {
			sku, tem := it["sku"]
			if !tem || nulo(sku) {
				continue
			}
			chave := textoJS(sku)
			i, visto := idx[chave]
			if !visto {
				i, idx[chave] = len(out), len(out)
				out = append(out, candidato{SKU: sku, Nome: it["descricao"], Categoria: it["categoria"], PorLoja: map[string]json.RawMessage{}})
			}
			info := map[string]json.RawMessage{}
			for _, c := range campos {
				if v, tem := it[c[0]]; tem {
					info[c[1]] = v
				}
			}
			out[i].PorLoja[dep], _ = json.Marshal(info)
		}
	}
	return out, nil
}

type agregado struct {
	sku                    string
	nome, categoria        *string
	faturamento, unidades  float64
}

func deVendas(ctx context.Context, p *pgxpool.Pool, fonte string, lojas []lojaDaFabrica, f filtrosCandidatos) ([]candidato, error) {
	est, err := estoques(ctx, p, lojas)
	if err != nil {
		return nil, err
	}
	linhas, err := p.Query(ctx, `select sku, produto, categoria, unidades::float8, faturamento::float8 from gc_vendas_item
		where canal_loja_id = any($1::bigint[]) order by sku, canal_loja_id, mes`, canais(lojas))
	if err != nil {
		return nil, err
	}
	var arr []*agregado
	idx := map[string]*agregado{}
	var sku string
	var nome, categoria *string
	var un, fat float64
	if _, err := pgx.ForEachRow(linhas, []any{&sku, &nome, &categoria, &un, &fat}, func() error {
		a := idx[sku]
		if a == nil {
			a = &agregado{sku: sku, nome: nome, categoria: categoria}
			idx[sku] = a
			arr = append(arr, a)
		}
		a.faturamento += fat
		a.unidades += un
		return nil
	}); err != nil {
		return nil, err
	}
	if fonte == "abc" {
		sort.SliceStable(arr, func(i, j int) bool { return arr[i].faturamento > arr[j].faturamento })
		total := 0.0
		for _, a := range arr {
			total += a.faturamento
		}
		if total == 0 {
			total = 1
		}
		acc, filtrados := 0.0, arr[:0]
		for _, a := range arr {
			acc += a.faturamento
			faixa := "C"
			if p := acc / total; p <= 0.8 {
				faixa = "A"
			} else if p <= 0.95 {
				faixa = "B"
			}
			if f.Faixa == "" || f.Faixa == faixa {
				filtrados = append(filtrados, a)
			}
		}
		arr = filtrados
	} else {
		quads := []string{"Estrela", "Vaca leiteira", "Interrogação"}
		if f.Quadrantes != nil {
			quads = *f.Quadrantes
		}
		filtrados := arr[:0]
		for _, a := range arr {
			noQuadrante := slices.ContainsFunc(lojas, func(l lojaDaFabrica) bool {
				return slices.Contains(quads, bcgClass(float64(est[l.deposito+"|"+a.sku]), a.unidades, 0))
			})
			cat := ""
			if a.categoria != nil {
				cat = *a.categoria
			}
			if noQuadrante && (f.Categoria == "" || strings.Contains(strings.ToLower(cat), strings.ToLower(f.Categoria))) {
				filtrados = append(filtrados, a)
			}
		}
		arr = filtrados
	}
	out := make([]candidato, 0, len(arr))
	for _, a := range arr {
		s, _ := json.Marshal(a.sku)
		n, _ := json.Marshal(a.nome)
		c, _ := json.Marshal(a.categoria)
		out = append(out, candidato{SKU: s, Nome: n, Categoria: c, PorLoja: porLojaDoEstoque(lojas, est, a.sku)})
	}
	return out, nil
}

func manual(ctx context.Context, p *pgxpool.Pool, lojas []lojaDaFabrica, f filtrosCandidatos) ([]candidato, error) {
	est, err := estoques(ctx, p, lojas)
	if err != nil {
		return nil, err
	}
	linhas, err := p.Query(ctx, `select sku, produto, categoria from gc_vendas_item
		where canal_loja_id = any($1::bigint[]) order by sku, canal_loja_id, mes`, canais(lojas))
	if err != nil {
		return nil, err
	}
	termo := strings.ToLower(f.Termo)
	visto := map[string]bool{}
	var out []candidato
	var sku string
	var produto, categoria *string
	_, err = pgx.ForEachRow(linhas, []any{&sku, &produto, &categoria}, func() error {
		nome := ""
		if produto != nil {
			nome = *produto
		}
		if visto[sku] || !(termo == "" || strings.Contains(strings.ToLower(nome), termo) || strings.Contains(strings.ToLower(sku), termo)) {
			return nil
		}
		visto[sku] = true
		s, _ := json.Marshal(sku)
		n, _ := json.Marshal(produto)
		c, _ := json.Marshal(categoria)
		out = append(out, candidato{SKU: s, Nome: n, Categoria: c, PorLoja: porLojaDoEstoque(lojas, est, sku)})
		return nil
	})
	return out, err
}
```

**(b) Testes de aceitação** (`TestCandidatos` e `TestBcgClass`, `candidatos_test.go`; `TestBcgClass` é a tabela pura de `bcgClass` — (2,4,0) Estrela, (5,2,0) Vaca leiteira, (0,0,0) Interrogação, (0,0,30) Abacaxi; dados do teste, além do mundo: `gc_estoque_item` (14888726315,S1,2), (14888726315,S2,0), (14888726277,S2,5), (14888726277,S3,1), (99999,S1,50); `gc_vendas_item` canal 205834140: (2026-09,S1,'Bolsa Um','Bolsas',3,300), (2026-08,S1,'Bolsa Um','Bolsas',1,100), (2026-09,S2,'Carteira','Acessórios',1,50); canal 205834116: (2026-09,S3,'Mochila','Bolsas',0,0), (2026-09,S2,'Carteira','Acessórios',1,50); dois briefings, o mais novo com `{"oportunidades":[{"loja":"tivoli","itens":[{"sku":"S1","descricao":"Bolsa 1","categoria":"Bolsas","precoOriginal":100,"pct":30,"precoComDesconto":70,"estoqueLoja":2}]},{"loja":"Shopping X","itens":[{"sku":"S9"}]}],"garimpo":[{"loja":"iguatemi","itens":[{"sku":"S2","descricao":"Carteira"}]}]}` e o mais velho com outra lista em `oportunidades`. `T` = Tivoli 14888726315, `I` = Iguatemi 14888726277)
- `abc` (`lojas [T, I]`, `filtros {"faixa":"A"}`) → só S1 (400 de 500 = 0,8), `porLoja` só com T (`"estoque":2`); sem `faixa` → S1, S2, S3 nessa ordem.
- `bcg` padrão → S1, S2, S3; `quadrantes ["Estrela"]` → S1, S2; `["Vaca leiteira"]` → S2 (em I: 2/7); `categoria "bolsa"` → S1, S3; `quadrantes []` → `[]` (lista vazia é lista, como na edge).
- `manual` `termo "carteira"` → S2 com `porLoja {"I": {"estoque":5, …}}`; `termo "s3"` → S3; sem termo → S1, S2, S3.
- `oportunidades` (`lojas [T, I]`) → S1 com `porLoja {"T": {"preco":100,"pctPrevisto":30,"precoComDesconto":70,"estoque":2}}` (o briefing MAIS NOVO); S9 não sai (nenhuma loja tem "Shopping X" no nome); `lojas [I]` → `[]`. `garimpo` → S2 com `porLoja {"I": {}}`.
- Loja fora da Fábrica: `manual` com `lojas ["99999"]` → `[]`; com `[T, "99999"]` → S1 com `porLoja` sem `"99999"` (o saldo 50 nunca aparece).
- Sem briefing nenhum → `{"candidatos":[]}`; `dados_json` com `oportunidades` = objeto em vez de lista → `[]`.
- Portão: `leitor`, `semModulo`, `roboSemFabrica` → 403; `impersonado` → 200 (só lê); `desativado` → 401.
- 400: `fonte "x"` → `{"error":"fonte_invalida"}`; `lojas ["abc"]`, 21 lojas, `filtros "x"`, `filtros {"faixa": 1}` → `pedido_invalido`.
- Mais de 1000 linhas: 1200 vendas de SKUs distintos no canal de T, cada um com estoque → `manual` devolve 1200 candidatos (a edge devolvia no máximo 1000).
- Mutações que têm de reprovar: usar `c.Lojas` cru em `estoques` (o `"99999"` aparece); trocar `p <= 0.8` por `p < 0.8` (S1 vira B e o `abc` com `faixa A` sai vazio); ler o briefing MAIS VELHO (`order by rodada asc`: a lista muda); `porLojaDoEstoque` sem o `n > 0` (S2 ganha T com estoque 0).

**(c) Arquivos:** Create `api/internal/fabrica/candidatos.go`, `api/internal/fabrica/candidatos_test.go`.

**(d) Dependências:** Task 3; a fatia do 5.5.

- [ ] **Step 1:** Testes; ver falhar. - [ ] **Step 2:** Implementar (código de (a)). - [ ] **Step 3:** `gofmt -l ./internal && go vet ./internal/fabrica/ && go test -count=1 -run 'TestCandidatos|TestBcg' ./internal/fabrica/` PASS; mutações reprovam. - [ ] **Step 4:** Commit `feat(api): fabrica-candidatos — o cálculo da edge em Go, só com lojas da Fábrica e sem o corte de 1000 linhas` (+ `Co-Authored-By`).

---

### Task 8: `POST /fabrica-looks` e `POST /fabrica-publicos`

**Revisor:** sonnet. **Depende de:** 3.

**(a) Contrato** (os das edges `fabrica-looks/index.ts` e `fabrica-publicos/index.ts`: mesmos corpos, respostas e códigos — looks:23, :38, :48, :53 e subir:294, :303 trocam só a URL —, com as diferenças por Ruling)
- Portão das duas: `soFabricante` + `soSessaoPropria`. As duas tabelas só a chave de serviço gravava (sem policy de escrita para `authenticated`: `fabrica_looks` e `fabrica_publicos` só têm leitura): portão da edge + SQL explícito em `banco.ComUsuario` (Ruling 5.8-3).
- `fabrica-looks`, `acao`:
  - `salvar` `{look: {chave, nome?, objetivos?, ativo?}}` → muda só o que veio; `chave` ausente = `400 {"error":"chave_obrigatoria"}`; `nome` texto 1–120; `objetivos` lista de até 10 textos `^[a-z_]{1,40}$`; `ativo` booleano; nada além de `chave` = `400 corpo_invalido`. Chave inexistente → `{"ok":true}` (a edge: update de 0 linhas).
  - `ordenar` `{ordem: [{chave, ordem}]}` (até 200; item sem `chave` é pulado; `ordem` ausente = 0, como a edge) → numa transação só (a edge fazia um update por item, sem transação: metade podia ficar gravada) → `{"ok":true}`.
  - `excluir` `{chave, excluido?}` → `excluido` = `true` salvo `false` explícito (a edge: `body.excluido !== false`) → `{"ok":true,"excluido":<bool>}`; sem `chave` → `400 chave_obrigatoria`.
  - `sync` → `400 {"error":"acao_invalida"}`: ninguém chama (nem a tela nem o `coletor/`); rota sem tela não entra (Ruling 5.8-12).
  - `chave` de look: `reChaveLook` (`^[a-z0-9][a-z0-9_-]{0,79}$`, da Task 3).
- `fabrica-publicos`, `acao`:
  - `apagar` `{id}` → `id` ausente = `400 {"error":"id_obrigatorio"}`; não-uuid = `400 pedido_invalido`; apaga → `{"ok":true}` (também sem linha: idempotente).
  - `salvar` `{preset: {id?, nome, marca_id?, geo?, idade_min?, idade_max?, generos?, interesses?, custom_audiences?}}` → `nome` ausente = `400 {"error":"nome_obrigatorio"}`; a linha da edge (`marca_id` nulo se ausente, `geo {}`, idades 18/65, listas vazias, `criado_por` da sessão — também no update, como a edge); com `id` → update (id inexistente = `404 nao_encontrado`; a edge dava 500 `salvar_falhou`), sem `id` → insert; resposta `{"id": …}`. Tipos: `geo` objeto, idades inteiras 13–65 com `idade_min ≤ idade_max`, `generos` lista de 1 e 2, `interesses`/`custom_audiences` listas, `marca_id` uuid ou nulo. A tela manda `geo` com `cities`, `excluded`, `countries`, `regions`, `pins` (subir:276-283): passa como está (é o protocolo do robô, `coletor/lib/publico.mjs`).

```go
package fabrica

import (
	"encoding/json"
	"errors"
	"net/http"
	"regexp"
	"slices"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/autz"
	"github.com/rbv-co/social-dashboard/api/internal/banco"
	"github.com/rbv-co/social-dashboard/api/internal/dados"
)

var reObjetivo = regexp.MustCompile(`^[a-z_]{1,40}$`)

// Curadoria: POST /fabrica-looks e POST /fabrica-publicos. Portão (soFabricante, soSessaoPropria) na montagem.
type Curadoria struct{ Pool *pgxpool.Pool }

type pedidoLooks struct {
	Acao     string          `json:"acao"`
	Look     json.RawMessage `json:"look"`
	Ordem    []itemDeOrdem   `json:"ordem"`
	Chave    json.RawMessage `json:"chave"`
	Excluido json.RawMessage `json:"excluido"`
}

type itemDeOrdem struct {
	Chave json.RawMessage `json:"chave"`
	Ordem *int            `json:"ordem"`
}

type lookSalvar struct {
	Chave     json.RawMessage `json:"chave"`
	Nome      json.RawMessage `json:"nome"`
	Objetivos json.RawMessage `json:"objetivos"`
	Ativo     json.RawMessage `json:"ativo"`
}

func objetivosValidos(v json.RawMessage) ([]string, bool) {
	var l []string
	if !lista(v) || json.Unmarshal(v, &l) != nil || len(l) > 10 {
		return nil, false
	}
	for _, o := range l {
		if !reObjetivo.MatchString(o) {
			return nil, false
		}
	}
	return l, true
}

func (cu *Curadoria) Looks(w http.ResponseWriter, r *http.Request) {
	e := autz.EscopoDo(r.Context())
	if e == nil {
		dados.Erro(w, http.StatusInternalServerError, "erro_interno", "")
		return
	}
	var c pedidoLooks
	if !dados.LerCorpo(w, r, &c) {
		return
	}
	ctx := r.Context()
	var resposta any = map[string]bool{"ok": true}
	var corpoRuim string
	trabalho := func(tx pgx.Tx) error { return nil }
	switch c.Acao {
	case "salvar":
		var l lookSalvar
		if len(c.Look) == 0 || nulo(c.Look) || json.Unmarshal(c.Look, &l) != nil || !objeto(c.Look) {
			corpoRuim = "look é um objeto."
			break
		}
		if len(l.Chave) == 0 || nulo(l.Chave) {
			responder(w, http.StatusBadRequest, map[string]string{"error": "chave_obrigatoria"})
			return
		}
		chave, _ := texto(l.Chave)
		objetivos, objOK := objetivosValidos(l.Objetivos)
		switch {
		case !reChaveLook.MatchString(chave):
			corpoRuim = "chave de look inválida."
		case l.Nome != nil && !textoAte(l.Nome, 120, false):
			corpoRuim = "nome tem de 1 a 120 caracteres."
		case l.Objetivos != nil && !objOK:
			corpoRuim = "objetivos é uma lista de até 10 chaves de objetivo."
		case l.Ativo != nil && !booleano(l.Ativo):
			corpoRuim = "ativo é verdadeiro ou falso."
		case l.Nome == nil && l.Objetivos == nil && l.Ativo == nil:
			corpoRuim = "Nada para gravar."
		}
		nome, _ := texto(l.Nome)
		ativo := string(l.Ativo) == "true"
		trabalho = func(tx pgx.Tx) error {
			_, err := tx.Exec(ctx, `update fabrica_looks set
				nome = case when @tem_nome::boolean then @nome::text else nome end,
				objetivos = case when @tem_objetivos::boolean then @objetivos::text[] else objetivos end,
				ativo = case when @tem_ativo::boolean then @ativo::boolean else ativo end
				where chave = @chave::text`,
				pgx.NamedArgs{"tem_nome": l.Nome != nil, "nome": nome, "tem_objetivos": l.Objetivos != nil,
					"objetivos": objetivos, "tem_ativo": l.Ativo != nil, "ativo": ativo, "chave": chave})
			return err
		}
	case "ordenar":
		if len(c.Ordem) > 200 {
			corpoRuim = "No máximo 200 looks."
			break
		}
		for _, o := range c.Ordem {
			if len(o.Chave) > 0 && !nulo(o.Chave) && !casa(o.Chave, reChaveLook) {
				corpoRuim = "chave de look inválida."
			}
		}
		trabalho = func(tx pgx.Tx) error {
			for _, o := range c.Ordem {
				if len(o.Chave) == 0 || nulo(o.Chave) {
					continue // a edge pulava o item sem chave
				}
				chave, _ := texto(o.Chave)
				ordem := 0
				if o.Ordem != nil {
					ordem = *o.Ordem
				}
				if _, err := tx.Exec(ctx, `update fabrica_looks set ordem = $1::int where chave = $2::text`, ordem, chave); err != nil {
					return err
				}
			}
			return nil
		}
	case "excluir":
		if len(c.Chave) == 0 || nulo(c.Chave) || string(c.Chave) == `""` {
			responder(w, http.StatusBadRequest, map[string]string{"error": "chave_obrigatoria"})
			return
		}
		chave, _ := texto(c.Chave)
		if !reChaveLook.MatchString(chave) {
			corpoRuim = "chave de look inválida."
		}
		excluido := string(c.Excluido) != "false"
		resposta = map[string]bool{"ok": true, "excluido": excluido}
		trabalho = func(tx pgx.Tx) error {
			_, err := tx.Exec(ctx, `update fabrica_looks set excluido = $1::boolean where chave = $2::text`, excluido, chave)
			return err
		}
	default: // "sync" inclusive: ninguém chama (Ruling 5.8-12)
		responder(w, http.StatusBadRequest, map[string]string{"error": "acao_invalida"})
		return
	}
	if corpoRuim != "" {
		dados.Erro(w, http.StatusBadRequest, "pedido_invalido", corpoRuim)
		return
	}
	if err := banco.ComUsuario(ctx, cu.Pool, e.ID, trabalho); err != nil {
		dados.ErroDeEscrita(w, err)
		return
	}
	responder(w, http.StatusOK, resposta)
}

type pedidoPublicos struct {
	Acao   string          `json:"acao"`
	ID     json.RawMessage `json:"id"`
	Preset json.RawMessage `json:"preset"`
}

type preset struct {
	ID              json.RawMessage `json:"id"`
	Nome            json.RawMessage `json:"nome"`
	MarcaID         json.RawMessage `json:"marca_id"`
	Geo             json.RawMessage `json:"geo"`
	IdadeMin        json.RawMessage `json:"idade_min"`
	IdadeMax        json.RawMessage `json:"idade_max"`
	Generos         json.RawMessage `json:"generos"`
	Interesses      json.RawMessage `json:"interesses"`
	CustomAudiences json.RawMessage `json:"custom_audiences"`
}

// ou: o valor do pedido, ou o padrão da edge quando ausente/null (`p.x ?? padrão`).
func ou(v json.RawMessage, padrao string) string {
	if len(v) == 0 || nulo(v) {
		return padrao
	}
	return string(v)
}

func (p preset) validar() string {
	idade := func(v json.RawMessage, padrao int) (int, bool) {
		if len(v) == 0 || nulo(v) {
			return padrao, true
		}
		var n int
		return n, json.Unmarshal(v, &n) == nil && n >= 13 && n <= 65
	}
	min, okMin := idade(p.IdadeMin, 18)
	max, okMax := idade(p.IdadeMax, 65)
	var generos []int
	switch {
	case !textoAte(p.Nome, 120, false):
		return "nome tem de 1 a 120 caracteres."
	case len(p.ID) > 0 && !nulo(p.ID) && !casa(p.ID, reUUID):
		return "id é o id do público."
	case len(p.MarcaID) > 0 && !nulo(p.MarcaID) && !casa(p.MarcaID, reUUID):
		return "marca_id é o id da marca."
	case len(p.Geo) > 0 && !nulo(p.Geo) && !objeto(p.Geo):
		return "geo é um objeto."
	case !okMin || !okMax || min > max:
		return "idades são inteiros de 13 a 65, a mínima até a máxima."
	case len(p.Generos) > 0 && !nulo(p.Generos) && (json.Unmarshal(p.Generos, &generos) != nil ||
		slices.ContainsFunc(generos, func(g int) bool { return g != 1 && g != 2 })):
		return "generos é uma lista de 1 e 2."
	case len(p.Interesses) > 0 && !nulo(p.Interesses) && !lista(p.Interesses):
		return "interesses é uma lista."
	case len(p.CustomAudiences) > 0 && !nulo(p.CustomAudiences) && !lista(p.CustomAudiences):
		return "custom_audiences é uma lista."
	}
	return ""
}

func (cu *Curadoria) Publicos(w http.ResponseWriter, r *http.Request) {
	e := autz.EscopoDo(r.Context())
	if e == nil {
		dados.Erro(w, http.StatusInternalServerError, "erro_interno", "")
		return
	}
	var c pedidoPublicos
	if !dados.LerCorpo(w, r, &c) {
		return
	}
	ctx := r.Context()
	switch c.Acao {
	case "apagar":
		if len(c.ID) == 0 || nulo(c.ID) || string(c.ID) == `""` {
			responder(w, http.StatusBadRequest, map[string]string{"error": "id_obrigatorio"})
			return
		}
		if !casa(c.ID, reUUID) {
			dados.Erro(w, http.StatusBadRequest, "pedido_invalido", "id é o id do público.")
			return
		}
		id, _ := texto(c.ID)
		err := banco.ComUsuario(ctx, cu.Pool, e.ID, func(tx pgx.Tx) error {
			_, err := tx.Exec(ctx, `delete from fabrica_publicos where id = $1::uuid`, id)
			return err
		})
		if err != nil {
			dados.ErroDeEscrita(w, err)
			return
		}
		responder(w, http.StatusOK, map[string]bool{"ok": true})
	case "salvar":
		var p preset
		if len(c.Preset) == 0 || nulo(c.Preset) || !objeto(c.Preset) || json.Unmarshal(c.Preset, &p) != nil {
			responder(w, http.StatusBadRequest, map[string]string{"error": "nome_obrigatorio"})
			return
		}
		if len(p.Nome) == 0 || nulo(p.Nome) || string(p.Nome) == `""` {
			responder(w, http.StatusBadRequest, map[string]string{"error": "nome_obrigatorio"})
			return
		}
		if motivo := p.validar(); motivo != "" {
			dados.Erro(w, http.StatusBadRequest, "pedido_invalido", motivo)
			return
		}
		args := pgx.NamedArgs{"nome": ou(p.Nome, "null"), "marca": ou(p.MarcaID, "null"), "geo": ou(p.Geo, "{}"),
			"idade_min": ou(p.IdadeMin, "18"), "idade_max": ou(p.IdadeMax, "65"), "generos": ou(p.Generos, "[]"),
			"interesses": ou(p.Interesses, "[]"), "audiences": ou(p.CustomAudiences, "[]"), "quem": e.ID, "id": ou(p.ID, "null")}
		var id string
		err := banco.ComUsuario(ctx, cu.Pool, e.ID, func(tx pgx.Tx) error {
			// os valores entram como JSON e o Postgres converte pelo tipo da coluna (#>> '{}' tira as aspas)
			const valores = `(@nome::jsonb #>> '{}'), (@marca::jsonb #>> '{}')::uuid, @geo::jsonb,
				(@idade_min::jsonb #>> '{}')::int, (@idade_max::jsonb #>> '{}')::int,
				array(select jsonb_array_elements_text(@generos::jsonb)::int), @interesses::jsonb, @audiences::jsonb, @quem::uuid`
			if len(p.ID) == 0 || nulo(p.ID) {
				return tx.QueryRow(ctx, `insert into fabrica_publicos (nome, marca_id, geo, idade_min, idade_max, generos,
					interesses, custom_audiences, criado_por) values (`+valores+`) returning id::text`, args).Scan(&id)
			}
			err := tx.QueryRow(ctx, `update fabrica_publicos set (nome, marca_id, geo, idade_min, idade_max, generos,
				interesses, custom_audiences, criado_por) = (`+valores+`) where id = (@id::jsonb #>> '{}')::uuid
				returning id::text`, args).Scan(&id)
			if errors.Is(err, pgx.ErrNoRows) {
				return autz.ErrNaoEncontrado
			}
			return err
		})
		if err != nil {
			dados.ErroDeEscrita(w, err)
			return
		}
		responder(w, http.StatusOK, map[string]string{"id": id})
	default:
		responder(w, http.StatusBadRequest, map[string]string{"error": "acao_invalida"})
	}
}
```


**(b) Testes de aceitação** (`TestLooks`, `TestPublicos`, `curadoria_test.go`, `m.Rodar`; "intacto" = foto igual)
- Looks, permitido (`fabricante`): `salvar {"look":{"chave":"promo-sage","nome":"Promo · Sálvia","objetivos":["engajamento"],"ativo":false}}` → 200 `{"ok":true}`; efeito: a linha com o nome, `{engajamento}` e `ativo false`; `salvar` só com `ativo:true` → só `ativo` muda (nome continua "Promo · Sálvia"); `salvar` de chave inexistente → 200 e nada muda; `ordenar {"ordem":[{"chave":"promo-sage","ordem":1},{"chave":"produto-heroi","ordem":2},{"ordem":9}]}` → 200, ordens 1 e 2 (o item sem chave pulado); `excluir {"chave":"marca-velha","excluido":false}` → `{"ok":true,"excluido":false}`; `excluir {"chave":"produto-heroi"}` → `excluido true`.
- Looks, negado e intacto: `leitor`, `semModulo`, `roboSemFabrica` → 403; `impersonado` → 403 com a frase; `salvar` sem `chave` → 400 `chave_obrigatoria`; `excluir` sem `chave` → 400 `chave_obrigatoria`; `sync` → 400 `acao_invalida`; `x` → 400 `acao_invalida`; `objetivos ["Engajamento!"]`, `nome ""`, `ativo "sim"`, `chave "../x"`, só `chave` → 400 `pedido_invalido`; `ordenar` com 201 itens → 400; `ordenar` em que a segunda atualização falha (gatilho de teste que dá `raise` para `produto-heroi`) → resposta ≠ 200 e a ordem de `promo-sage` NÃO mudou (uma transação).
- Públicos, permitido: `salvar {"preset":{"nome":"Campinas 30+","geo":{"cities":[{"key":"247071","radius":10,"distance_unit":"kilometer"}],"pins":[]},"idade_min":30,"idade_max":55,"generos":[2],"interesses":[{"id":"6003","name":"Moda"}],"custom_audiences":[]}}` → 200 `{"id": <uuid>}`; a linha com tudo, `marca_id` nulo e `criado_por = idFabricante`; `salvar` com `"id":"<P1>"` e `nome "Novo"` → 200 `{"id":"<P1>"}`, `marca_id` passa a nulo (paridade) e `criado_por` = quem salvou; `apagar {"id":"<P2>"}` → `{"ok":true}`; de novo → `{"ok":true}`.
- Públicos, negado e intacto: `leitor`, `roboSemFabrica` → 403; `impersonado` → 403; `salvar` sem `nome` → 400 `nome_obrigatorio`; `apagar` sem `id` → 400 `id_obrigatorio`; `idade_min 70`, `idade_min 40` com `idade_max 30`, `generos [3]`, `geo []`, `marca_id "x"` → 400 `pedido_invalido`; `id` inexistente no `salvar` → 404; `acao "x"` → 400 `acao_invalida`.
- Mutações que têm de reprovar: tirar a transação única do `ordenar` (o caso do gatilho deixa `promo-sage` mudado); trocar `string(c.Excluido) != "false"` por `== "true"` (o `excluir` sem `excluido` vira `false`); tirar `soSessaoPropria` de uma das duas.

**(c) Arquivos:** Create `api/internal/fabrica/curadoria.go`, `api/internal/fabrica/curadoria_test.go`.

**(d) Dependências:** Task 3.

- [ ] **Step 1:** Testes; ver falhar. - [ ] **Step 2:** Implementar (código de (a)). - [ ] **Step 3:** `gofmt -l ./internal && go vet ./internal/fabrica/ && go test -count=1 ./internal/fabrica/` PASS; mutações reprovam. - [ ] **Step 4:** Commit `feat(api): fabrica-looks e fabrica-publicos — portão da edge, ordenar numa transação e sync aposentado` (+ `Co-Authored-By`).

---
### Task 9: Rotas de robô — o que o `fabrica-job-runner` grava, por sessão de serviço

**Revisor:** opus. **Depende de:** 3, 4 e 5 (`tabelaCriativos` e `tabelaCampanhas` moram lá).

**(a) Contrato**
- O robô da Fábrica **continua no GitHub Actions** (rembg/BiRefNet em CPU + ffmpeg, até 45 min: COORDENACAO 12/10 23:10 (c)) e não alcança o banco da API. Ele fala com a API com o token de serviço do 5.13 (`Authorization: Bearer <token>`; usuário `robo-fabrica@…` com perfil próprio: papel `viewer`, `features {meta, sales}` — `meta` para o `meta-proxy`, `sales` para os `produtos` do `bling-proxy` —, `permissions {"meta.fabrica": ["ver","editar"]}`, `allowed_accounts` nulo; NOTAS).
- **Leituras do robô = as rotas do painel** (Task 4), com a sessão de serviço e as regras do perfil dele. **Escritas do robô = 7 rotas `/fabrica/robo/…`**, atrás de `auth.SoServico` (painel = 403, inclusive admin, super e "entrar como") e de `soFabricante` (a regra do PERFIL do robô); onde o catálogo tem regra de escrita (`fabrica_campanhas`, `fabrica_criativos`), ela vale também (`Tabela.Editar/Criar`). As tabelas que só a chave de serviço gravava (`fabrica_jobs`, `fabrica_looks`, `fabrica_meta_jobs`, `ia_execucoes`) ficam com SQL explícito sobre colunas declaradas (Ruling 5.8-11).
- O inventário (todo acesso do robô ao REST do Supabase, por arquivo:linha, em `coletor/`) e o destino de cada um:

| Arquivo:linha (`coletor/`) | Hoje (REST com a chave de serviço) | Na API |
|---|---|---|
| `fabrica-job-runner.mjs:115` | `GET fabrica_jobs?id=eq.` | `GET /fabrica/jobs?id=` |
| `fabrica-job-runner.mjs:118, 154, 169, 184, 192, 197, 202, 208` | `PATCH fabrica_jobs` (status, run id, resultado, erro, updated_at) | `PATCH /fabrica/robo/jobs/{id}` |
| `fabrica-job-runner.mjs:53, 55` | `POST fabrica_jobs` (próximo lote) + `PATCH fabrica_campanhas.job_id` | `POST /fabrica/robo/jobs/{id}/proximo-lote` (uma transação; o robô continua acordando o lote pelo `GITHUB_TOKEN` dele, `:58`) |
| `fabrica-job-runner.mjs:163` | `GET fabrica_criativos?campanha_id=` (conta) | `GET /fabrica/criativos?campanha_id=&limite=1&contar=1` (`X-Total-Count`) |
| `fabrica-job-runner.mjs:168, 172, 209` / `:186` | `PATCH fabrica_campanhas` status / `fechada_em` | `PATCH /fabrica/robo/campanhas/{id}` `{"status"}` / `{"fechar":true}` |
| `gerar-criativos.mjs:198` | `GET fabrica_looks` | `GET /fabrica/looks` |
| `lib/objetivos.mjs:3` (`gerar-criativos.mjs:215`, `subir-estudio.mjs:322`) | `GET fabrica_objetivos?ativo=eq.true` | `GET /fabrica/objetivos?ativo=true` |
| `lib/config-lojas.mjs:7, 8` (`gerar-criativos.mjs:265`, `subir-estudio.mjs:293`, `ativar-estudio.mjs:110`, `excluir-estudio.mjs:97`) | `GET fabrica_marcas`, `GET fabrica_lojas` | `GET /fabrica/marcas`, `GET /fabrica/lojas` |
| `gerar-criativos.mjs:304`, `subir-estudio.mjs:301`, `exportar-zoho.mjs:25` | `GET fabrica_criativos` (filtros) | `GET /fabrica/criativos?campanha_id=&escolhido=&purgado=&arquetipo=` |
| `gerar-criativos.mjs:343, 393`; `hero-ia/hero-ia.mjs:177` (via `gerar-criativos.mjs:372`) | `POST fabrica_criativos` (uma ou várias linhas) | `POST /fabrica/robo/criativos` (lista de 1 a 200, uma transação) |
| `gerar-previews.mjs:72` | `PATCH fabrica_looks.preview_url` | `PATCH /fabrica/robo/looks/{chave}` |
| `subir-estudio.mjs:272` | `POST fabrica_meta_jobs` | `POST /fabrica/robo/meta-jobs` |
| `subir-estudio.mjs:321`, `exportar-zoho.mjs:16` | `GET fabrica_campanhas?id=` | `GET /fabrica/campanhas?id=` |
| `subir-estudio.mjs:328` | `GET fabrica_meta_jobs?tipo=&payload->>campanhaId=` | `GET /fabrica/meta-jobs?tipo=&campanha_id=` |
| `exportar-zoho.mjs:18` | `GET fabrica_jobs?params->>campanhaId=` | `GET /fabrica/jobs?campanha_id=&ordem=created_at&limite=1` |
| `exportar-zoho.mjs:21` | `GET fabrica_lojas` | `GET /fabrica/lojas` |
| `registrar-execucao.mjs:35` | `POST ia_execucoes` | `POST /fabrica/robo/execucoes` (só os nomes `fabrica*`) |
| `hero-ia/texto-da-garantia.mjs:43-45` (`gerar-criativos.mjs:358`) | `GET vessel_lotes` (material do lote mais recente do SKU) | `GET /fabrica/robo/material-do-sku?sku=` — **do 5.10** (dono de `vessel_lotes`), contrato abaixo (Ruling 5.8-13); até lá a arte sai sem a pílula (o código já trata: `texto-da-garantia.mjs:56-64`) |
| `gerar-criativos.mjs:50` e o `subir` de cada PNG/MP4 (`lib/storage-upload.mjs`) | bucket `fabrica-criativos` | **Plano 6** (Storage) |
| `gerar-criativos.mjs:66, 76` (modo `--estrela`) e `:275` (rodada criada sem `campanhaId`) | `GET gc_*`, `POST fabrica_campanhas` | **sem rota**: só a linha de comando chega aí (o job sempre traz `itens` e `campanhaId` do `fabrica-trigger`); Ruling 5.8-12 |
| `lib/bling-comercial.mjs` (`loginServico`, `blingProxy`), `meta-proxy` | Supabase Auth + edges | token de serviço (5.13) + `POST /bling-proxy` e `POST /meta-proxy` (Plano 3, escopo do 5.6) |

- **Contrato de cada rota de robô** (todas: `auth.SoServico` + `soFabricante`; corpo pela struct, campo não declarado = `400 corpo_invalido`; `id` da rota que não é uuid = `404`):
  - `PATCH /fabrica/robo/jobs/{id}` `{status?, github_run_id?, resultado?, erro?}` → `204`; `status` ∈ `enfileirado|rodando|concluido|erro`; `github_run_id` só dígitos ou `null`; `resultado` qualquer JSON até 256 KiB; `erro` até 2000 ou `null`; `updated_at = now()` do servidor (o robô mandava o relógio dele); job inexistente = `404`.
  - `POST /fabrica/robo/jobs/{id}/proximo-lote` (sem corpo) → `201 {"job_id"}`: trava o job de origem; só `gerar` (outro = `400`); `continuacao` = a dele + 1; acima de 300 = `409 {"error":"limite_de_lotes"}` (o teto do robô, `fabrica-job-runner.mjs:50`); cria o job `gerar` com os MESMOS `params` + `continuacao`, `status 'enfileirado'`, `criado_por` = o robô; liga a rodada (`campanhaId`) ao job novo. **Idempotente**: se já existe o job `gerar` dessa rodada com essa `continuacao`, devolve ele (`200`) sem criar outro (o robô que repetiu depois de um prazo não acorda dois lotes).
  - `PATCH /fabrica/robo/campanhas/{id}` `{status?, fechar?}` → `200` com a linha (`colunasCampanha`); `status` ∈ `gerando|pronta|erro`; `fechar` só `true` → `fechada_em = now()` do servidor; pelo `tabelaCampanhas.Editar` (catálogo).
  - `POST /fabrica/robo/criativos` `[{campanha_id, arquetipo, template, formato, storage_path, url, sku?, variante?, preco_de?, preco_por?, legenda?}]` (1–200) → `201 {"criados": n}`; cada linha pelo `tabelaCriativos.Criar` (catálogo), numa transação (uma ruim = nenhuma gravada); `storage_path` passa em `filepath.IsLocal`, sem NUL e sem `\`, até 300, e começa por `<campanha_id>/` (Ruling 5.8-11: é o caminho que o `fabrica-apagar` e a purga apagam); `url` http(s) absoluta; rodada inexistente = `409 conflito` (FK).
  - `PATCH /fabrica/robo/looks/{chave}` `{preview_url}` → `204`; `chave` em `reChaveLook`; look inexistente = `404`.
  - `POST /fabrica/robo/meta-jobs` `{tipo, ad_account_id?, loja?, meta_campaign_id?, adset_ids?, ad_ids?, payload?, status?, erro?}` → `201 {"id"}`; `ad_account_id` `act_<dígitos>` ou `null`; `meta_campaign_id` dígitos ou `null`; `adset_ids`/`ad_ids` listas; `payload` objeto até 64 KiB com `campanhaId` uuid quando vem; `status` ∈ `criado|parcial`.
  - `POST /fabrica/robo/execucoes` `{robo, acao, modelo?, input_tokens?, output_tokens?, chamadas?, usd?, duracao_ms?, itens?, unidade?, status?, detalhe?, github_run_id?}` → `201 {"id"}`; `robo` ∈ `fabrica|fabrica-gerar|fabrica-subir|fabrica-ativar|fabrica-excluir|fabrica-preview` (os de `fabrica-job-runner.mjs:127`: o robô da Fábrica não grava execução de outro robô); `status` ∈ `ok|parcial|erro`; contadores inteiros ≥ 0; `usd` número ≥ 0; `null` nas colunas com padrão (`input_tokens`, `output_tokens`, `chamadas`, `usd`, `status`) = o padrão do banco.
- **Para o 5.10** (contrato, sem código aqui): `GET /fabrica/robo/material-do-sku?sku=<texto até 80>` → `200 {"material": <texto|null>}` = `select material from vessel_lotes where sku = $1::text and material is not null order by criado_em desc, id desc limit 1` (o mesmo de `texto-da-garantia.mjs:43`), atrás de `auth.SoServico` + `fabrica.Fabricante`: projeção de UMA coluna para o robô da Fábrica, sem dar a ele o módulo `autenticidade` (que abriria a escrita das tabelas da Vessel). Entra na varredura de robô da Task 10 quando existir.

```go
package fabrica

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"maps"
	"net/http"
	"path/filepath"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/auth"
	"github.com/rbv-co/social-dashboard/api/internal/autz"
	"github.com/rbv-co/social-dashboard/api/internal/banco"
	"github.com/rbv-co/social-dashboard/api/internal/dados"
)

var (
	reAdAccount = regexp.MustCompile(`^act_[0-9]{1,30}$`)
	reIDMeta    = regexp.MustCompile(`^[0-9]{1,30}$`)

	// robosDaFabrica: os nomes que o fabrica-job-runner grava em ia_execucoes (fabrica-job-runner.mjs:127).
	robosDaFabrica = []string{"fabrica", "fabrica-gerar", "fabrica-subir", "fabrica-ativar", "fabrica-excluir", "fabrica-preview"}

	errLimiteDeLotes = errors.New("fabrica: limite de lotes")
)

// lerCamposRobo: corpo C (struct de json.RawMessage com `json:"<coluna>,omitempty"`), C.Validar() e as
// colunas presentes. Já respondeu quando devolve false.
func lerCamposRobo[C interface{ Validar() error }](w http.ResponseWriter, r *http.Request) (map[string]any, bool) {
	var c C
	if !dados.LerCorpo(w, r, &c) {
		return nil, false
	}
	if err := c.Validar(); err != nil {
		dados.Erro(w, http.StatusBadRequest, "pedido_invalido", err.Error())
		return nil, false
	}
	campos, err := dados.Campos(&c)
	if err != nil {
		dados.Erro(w, http.StatusInternalServerError, "erro_interno", "")
		return nil, false
	}
	if len(campos) == 0 {
		dados.Erro(w, http.StatusBadRequest, "corpo_invalido", "Nada para gravar.")
		return nil, false
	}
	return campos, true
}

// atualizarDireto: UPDATE só das colunas presentes (as tags da struct da rota), pelo jsonb_populate_record
// como dados.Tabela. Tabela, coluna-chave, o cast dela e `extra` são texto da rota, nunca do pedido. Para as
// tabelas que só a chave de serviço gravava (Ruling 5.8-11). Nenhuma linha = autz.ErrNaoEncontrado.
func atualizarDireto(ctx context.Context, tx pgx.Tx, tabela, chave, cast, valor string, campos map[string]any, extra string) error {
	cols := slices.Sorted(maps.Keys(campos))
	sets := make([]string, 0, len(cols)+1)
	for _, c := range cols {
		id := pgx.Identifier{c}.Sanitize()
		sets = append(sets, id+" = r."+id)
	}
	if extra != "" {
		sets = append(sets, extra)
	}
	j, err := json.Marshal(campos)
	if err != nil {
		return err
	}
	t := pgx.Identifier{tabela}.Sanitize()
	tag, err := tx.Exec(ctx, `update `+t+` as a set `+strings.Join(sets, ", ")+
		` from jsonb_populate_record(null::`+t+`, @campos::jsonb) as r where a.`+pgx.Identifier{chave}.Sanitize()+` = @chave::`+cast,
		pgx.NamedArgs{"campos": string(j), "chave": valor})
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return autz.ErrNaoEncontrado
	}
	return nil
}

// inserirDireto: INSERT só das colunas presentes, devolvendo o id.
func inserirDireto(ctx context.Context, tx pgx.Tx, tabela string, campos map[string]any) (string, error) {
	cols := slices.Sorted(maps.Keys(campos))
	for i, c := range cols {
		cols[i] = pgx.Identifier{c}.Sanitize()
	}
	j, err := json.Marshal(campos)
	if err != nil {
		return "", err
	}
	t, l := pgx.Identifier{tabela}.Sanitize(), strings.Join(cols, ", ")
	var id string
	err = tx.QueryRow(ctx, `insert into `+t+` (`+l+`) select `+l+` from jsonb_populate_record(null::`+t+`, @campos::jsonb)
		returning id::text`, pgx.NamedArgs{"campos": string(j)}).Scan(&id)
	return id, err
}

func idDaRota(w http.ResponseWriter, r *http.Request) (string, bool) {
	id := chi.URLParam(r, "id")
	if !reUUID.MatchString(id) {
		dados.Erro(w, http.StatusNotFound, "nao_encontrado", "")
		return "", false
	}
	return id, true
}

// ---- jobs ----

type corpoJob struct {
	Status      json.RawMessage `json:"status,omitempty"`
	GithubRunID json.RawMessage `json:"github_run_id,omitempty"`
	Resultado   json.RawMessage `json:"resultado,omitempty"`
	Erro        json.RawMessage `json:"erro,omitempty"`
}

func (c corpoJob) Validar() error {
	var e []error
	if c.Status != nil && !textoEm(c.Status, "enfileirado", "rodando", "concluido", "erro") {
		e = append(e, errors.New("status é enfileirado, rodando, concluido ou erro."))
	}
	if c.GithubRunID != nil && !nulo(c.GithubRunID) && !casa(c.GithubRunID, reRunID) {
		e = append(e, errors.New("github_run_id é o número da execução."))
	}
	if len(c.Resultado) > 256<<10 {
		e = append(e, errors.New("resultado passa de 256 KiB."))
	}
	if !textoOuNulo(c.Erro, 2000) {
		e = append(e, errors.New("erro tem até 2000 caracteres."))
	}
	return errors.Join(e...)
}

func atualizarJob(p *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		e := autz.EscopoDo(r.Context())
		id, ok := idDaRota(w, r)
		if !ok {
			return
		}
		campos, ok := lerCamposRobo[corpoJob](w, r)
		if !ok {
			return
		}
		ctx := r.Context()
		err := banco.ComUsuario(ctx, p, e.ID, func(tx pgx.Tx) error {
			return atualizarDireto(ctx, tx, "fabrica_jobs", "id", "uuid", id, campos, "updated_at = now()")
		})
		if err != nil {
			dados.ErroDeEscrita(w, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

// proximoLote: o encadeamento do gerar (fabrica-job-runner.mjs:46-63) numa transação, idempotente.
func proximoLote(p *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		e := autz.EscopoDo(r.Context())
		id, ok := idDaRota(w, r)
		if !ok {
			return
		}
		ctx := r.Context()
		var novo string
		status := http.StatusCreated
		err := banco.ComUsuario(ctx, p, e.ID, func(tx pgx.Tx) error {
			var tipo string
			var bruto []byte
			err := tx.QueryRow(ctx, `select tipo, params from fabrica_jobs where id = $1::uuid for update`, id).Scan(&tipo, &bruto)
			if errors.Is(err, pgx.ErrNoRows) {
				return autz.ErrNaoEncontrado
			}
			if err != nil {
				return err
			}
			if tipo != "gerar" {
				return errPedido{"Só o job gerar encadeia lote."}
			}
			params := map[string]json.RawMessage{}
			if err := json.Unmarshal(bruto, &params); err != nil {
				return errPedido{"params do job não é objeto."}
			}
			cont := 0
			if v, tem := params["continuacao"]; tem && !nulo(v) {
				if json.Unmarshal(v, &cont) != nil || cont < 0 {
					return errPedido{"continuacao do job inválida."}
				}
			}
			cont++
			if cont > 300 {
				return errLimiteDeLotes
			}
			campanha, _ := texto(params["campanhaId"])
			err = tx.QueryRow(ctx, `select id::text from fabrica_jobs where tipo = 'gerar' and params->>'campanhaId' = $1::text
				and params->>'continuacao' = $2::text order by created_at limit 1`, campanha, strconv.Itoa(cont)).Scan(&novo)
			if err == nil {
				status = http.StatusOK // o mesmo lote pedido de novo: devolve o que já existe
				return nil
			}
			if !errors.Is(err, pgx.ErrNoRows) {
				return err
			}
			params["continuacao"], _ = json.Marshal(cont)
			j, err := json.Marshal(params)
			if err != nil {
				return err
			}
			if err := tx.QueryRow(ctx, `insert into fabrica_jobs (tipo, params, status, criado_por)
				values ('gerar', $1::jsonb, 'enfileirado', $2::uuid) returning id::text`, string(j), e.ID).Scan(&novo); err != nil {
				return err
			}
			if reUUID.MatchString(campanha) {
				_, err = tx.Exec(ctx, `update fabrica_campanhas set job_id = $1::uuid where id = $2::uuid`, novo, campanha)
			}
			return err
		})
		switch {
		case errors.Is(err, errLimiteDeLotes):
			responder(w, http.StatusConflict, map[string]string{"error": "limite_de_lotes"})
		case err != nil:
			escritaOuPedido(w, err)
		default:
			responder(w, status, map[string]string{"job_id": novo})
		}
	}
}

// ---- campanhas (catálogo: fab_camp_write) ----

type corpoCampanhaRobo struct {
	Status json.RawMessage `json:"status,omitempty"`
	Fechar json.RawMessage `json:"fechar,omitempty"`
}

func (c corpoCampanhaRobo) Validar() error {
	if c.Status != nil && !textoEm(c.Status, "gerando", "pronta", "erro") {
		return errors.New("status é gerando, pronta ou erro.")
	}
	if c.Fechar != nil && string(c.Fechar) != "true" {
		return errors.New("fechar só aceita true.")
	}
	return nil
}

func atualizarCampanha(p *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		e := autz.EscopoDo(r.Context())
		id, ok := idDaRota(w, r)
		if !ok {
			return
		}
		campos, ok := lerCamposRobo[corpoCampanhaRobo](w, r)
		if !ok {
			return
		}
		if _, tem := campos["fechar"]; tem { // o relógio é do servidor (o robô mandava o dele)
			delete(campos, "fechar")
			campos["fechada_em"] = time.Now().UTC().Format(time.RFC3339Nano)
		}
		ctx := r.Context()
		var linha []byte
		err := banco.ComUsuario(ctx, p, e.ID, func(tx pgx.Tx) (err error) {
			linha, err = tabelaCampanhas.Editar(ctx, tx, autz.Producao, e, id, campos)
			return err
		})
		if err != nil {
			dados.ErroDeEscrita(w, err)
			return
		}
		dados.Responder(w, http.StatusOK, linha)
	}
}

// ---- criativos (catálogo: fab_criativos_write) ----

type corpoCriativoRobo struct {
	CampanhaID  json.RawMessage `json:"campanha_id,omitempty"`
	SKU         json.RawMessage `json:"sku,omitempty"`
	Arquetipo   json.RawMessage `json:"arquetipo,omitempty"`
	Template    json.RawMessage `json:"template,omitempty"`
	Formato     json.RawMessage `json:"formato,omitempty"`
	Variante    json.RawMessage `json:"variante,omitempty"`
	PrecoDe     json.RawMessage `json:"preco_de,omitempty"`
	PrecoPor    json.RawMessage `json:"preco_por,omitempty"`
	StoragePath json.RawMessage `json:"storage_path,omitempty"`
	URL         json.RawMessage `json:"url,omitempty"`
	Legenda     json.RawMessage `json:"legenda,omitempty"`
}

// Validar: o storage_path é o caminho que o fabrica-apagar e a purga apagam do disco — só dentro da pasta
// da rodada (Ruling 5.8-11).
func (c corpoCriativoRobo) Validar() error {
	campanha, _ := texto(c.CampanhaID)
	caminho, _ := texto(c.StoragePath)
	switch {
	case !reUUID.MatchString(campanha):
		return errors.New("campanha_id é o id da rodada.")
	case !textoAte(c.Arquetipo, 40, false) || !textoAte(c.Template, 80, false) || !textoAte(c.Formato, 20, false):
		return errors.New("arquetipo, template e formato são obrigatórios (até 40, 80 e 20 caracteres).")
	case !textoOuNulo(c.SKU, 80) || !textoOuNulo(c.Variante, 80) || !textoOuNulo(c.Legenda, 5000):
		return errors.New("sku e variante têm até 80 caracteres e legenda até 5000.")
	case !numeroOuNulo(c.PrecoDe) || !numeroOuNulo(c.PrecoPor):
		return errors.New("preco_de e preco_por são números não negativos.")
	case utf8.RuneCountInString(caminho) > 300 || !filepath.IsLocal(caminho) || strings.ContainsAny(caminho, "\\\x00") ||
		!strings.HasPrefix(caminho, campanha+"/"):
		return errors.New("storage_path fica dentro da pasta da rodada (<campanha_id>/…).")
	case !urlValida(c.URL):
		return errors.New("url é o endereço http(s) do arquivo.")
	}
	return nil
}

func criarCriativos(p *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		e := autz.EscopoDo(r.Context())
		var linhas []corpoCriativoRobo
		if !dados.LerCorpo(w, r, &linhas) {
			return
		}
		if len(linhas) == 0 || len(linhas) > 200 {
			dados.Erro(w, http.StatusBadRequest, "pedido_invalido", "Mande de 1 a 200 criativos.")
			return
		}
		todos := make([]map[string]any, len(linhas))
		for i, l := range linhas {
			if err := l.Validar(); err != nil {
				dados.Erro(w, http.StatusBadRequest, "pedido_invalido", fmt.Sprintf("criativo %d: %v", i+1, err))
				return
			}
			campos, err := dados.Campos(&l)
			if err != nil {
				dados.Erro(w, http.StatusInternalServerError, "erro_interno", "")
				return
			}
			todos[i] = campos
		}
		ctx := r.Context()
		err := banco.ComUsuario(ctx, p, e.ID, func(tx pgx.Tx) error {
			for _, campos := range todos {
				if _, err := tabelaCriativos.Criar(ctx, tx, autz.Producao, e, campos); err != nil {
					return err
				}
			}
			return nil
		})
		if err != nil {
			dados.ErroDeEscrita(w, err)
			return
		}
		responder(w, http.StatusCreated, map[string]int{"criados": len(todos)})
	}
}

// ---- looks ----

type corpoLookRobo struct {
	PreviewURL json.RawMessage `json:"preview_url,omitempty"`
}

func (c corpoLookRobo) Validar() error {
	if !urlValida(c.PreviewURL) {
		return errors.New("preview_url é o endereço http(s) da prévia.")
	}
	return nil
}

func atualizarLook(p *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		e := autz.EscopoDo(r.Context())
		chave := chi.URLParam(r, "chave")
		if !reChaveLook.MatchString(chave) {
			dados.Erro(w, http.StatusNotFound, "nao_encontrado", "")
			return
		}
		campos, ok := lerCamposRobo[corpoLookRobo](w, r)
		if !ok {
			return
		}
		ctx := r.Context()
		err := banco.ComUsuario(ctx, p, e.ID, func(tx pgx.Tx) error {
			return atualizarDireto(ctx, tx, "fabrica_looks", "chave", "text", chave, campos, "")
		})
		if err != nil {
			dados.ErroDeEscrita(w, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

// ---- rastro da subida na Meta ----

type corpoMetaJob struct {
	Tipo           json.RawMessage `json:"tipo,omitempty"`
	AdAccountID    json.RawMessage `json:"ad_account_id,omitempty"`
	Loja           json.RawMessage `json:"loja,omitempty"`
	MetaCampaignID json.RawMessage `json:"meta_campaign_id,omitempty"`
	AdsetIDs       json.RawMessage `json:"adset_ids,omitempty"`
	AdIDs          json.RawMessage `json:"ad_ids,omitempty"`
	Payload        json.RawMessage `json:"payload,omitempty"`
	Status         json.RawMessage `json:"status,omitempty"`
	Erro           json.RawMessage `json:"erro,omitempty"`
}

func (c corpoMetaJob) Validar() error {
	var payload map[string]json.RawMessage
	switch {
	case !textoAte(c.Tipo, 40, false):
		return errors.New("tipo é obrigatório (até 40 caracteres).")
	case c.AdAccountID != nil && !nulo(c.AdAccountID) && !casa(c.AdAccountID, reAdAccount):
		return errors.New("ad_account_id é act_<número>.")
	case c.MetaCampaignID != nil && !nulo(c.MetaCampaignID) && !casa(c.MetaCampaignID, reIDMeta):
		return errors.New("meta_campaign_id é o id da campanha na Meta.")
	case !textoOuNulo(c.Loja, 120) || !textoOuNulo(c.Erro, 2000):
		return errors.New("loja tem até 120 caracteres e erro até 2000.")
	case (c.AdsetIDs != nil && !nulo(c.AdsetIDs) && !lista(c.AdsetIDs)) || (c.AdIDs != nil && !nulo(c.AdIDs) && !lista(c.AdIDs)):
		return errors.New("adset_ids e ad_ids são listas.")
	case c.Payload != nil && !nulo(c.Payload) && (!objeto(c.Payload) || len(c.Payload) > 64<<10 || json.Unmarshal(c.Payload, &payload) != nil):
		return errors.New("payload é um objeto de até 64 KiB.")
	case payload["campanhaId"] != nil && !nulo(payload["campanhaId"]) && !casa(payload["campanhaId"], reUUID):
		return errors.New("payload.campanhaId é o id da rodada.")
	case c.Status != nil && !textoEm(c.Status, "criado", "parcial"):
		return errors.New("status é criado ou parcial.")
	}
	return nil
}

func criarMetaJob(p *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		e := autz.EscopoDo(r.Context())
		campos, ok := lerCamposRobo[corpoMetaJob](w, r)
		if !ok {
			return
		}
		ctx := r.Context()
		var id string
		err := banco.ComUsuario(ctx, p, e.ID, func(tx pgx.Tx) (err error) {
			id, err = inserirDireto(ctx, tx, "fabrica_meta_jobs", campos)
			return err
		})
		if err != nil {
			dados.ErroDeEscrita(w, err)
			return
		}
		responder(w, http.StatusCreated, map[string]string{"id": id})
	}
}

// ---- execução do robô (custo e duração: ia_execucoes) ----

type corpoExecucao struct {
	Robo         json.RawMessage `json:"robo,omitempty"`
	Acao         json.RawMessage `json:"acao,omitempty"`
	Modelo       json.RawMessage `json:"modelo,omitempty"`
	InputTokens  json.RawMessage `json:"input_tokens,omitempty"`
	OutputTokens json.RawMessage `json:"output_tokens,omitempty"`
	Chamadas     json.RawMessage `json:"chamadas,omitempty"`
	Usd          json.RawMessage `json:"usd,omitempty"`
	DuracaoMs    json.RawMessage `json:"duracao_ms,omitempty"`
	Itens        json.RawMessage `json:"itens,omitempty"`
	Unidade      json.RawMessage `json:"unidade,omitempty"`
	Status       json.RawMessage `json:"status,omitempty"`
	Detalhe      json.RawMessage `json:"detalhe,omitempty"`
	GithubRunID  json.RawMessage `json:"github_run_id,omitempty"`
}

func (c corpoExecucao) Validar() error {
	switch {
	case !textoEm(c.Robo, robosDaFabrica...):
		return errors.New("robo é um dos robôs da Fábrica.")
	case !textoAte(c.Acao, 80, false):
		return errors.New("acao é obrigatória (até 80 caracteres).")
	case !textoOuNulo(c.Modelo, 80) || !textoOuNulo(c.Unidade, 40) || !textoOuNulo(c.Detalhe, 500):
		return errors.New("modelo, unidade e detalhe têm até 80, 40 e 500 caracteres.")
	case !inteiroOuNulo(c.InputTokens) || !inteiroOuNulo(c.OutputTokens) || !inteiroOuNulo(c.Chamadas) ||
		!inteiroOuNulo(c.DuracaoMs) || !inteiroOuNulo(c.Itens):
		return errors.New("contadores são inteiros não negativos.")
	case !numeroOuNulo(c.Usd):
		return errors.New("usd é um número não negativo.")
	case c.Status != nil && !nulo(c.Status) && !textoEm(c.Status, "ok", "parcial", "erro"):
		return errors.New("status é ok, parcial ou erro.")
	case c.GithubRunID != nil && !nulo(c.GithubRunID) && !casa(c.GithubRunID, reRunID):
		return errors.New("github_run_id é o número da execução.")
	}
	return nil
}

func criarExecucao(p *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		e := autz.EscopoDo(r.Context())
		campos, ok := lerCamposRobo[corpoExecucao](w, r)
		if !ok {
			return
		}
		for _, c := range []string{"input_tokens", "output_tokens", "chamadas", "usd", "status"} {
			if v, tem := campos[c]; tem && nulo(v.(json.RawMessage)) {
				delete(campos, c) // null nas colunas com padrão (not null default): vale o padrão do banco
			}
		}
		ctx := r.Context()
		var id string
		err := banco.ComUsuario(ctx, p, e.ID, func(tx pgx.Tx) (err error) {
			id, err = inserirDireto(ctx, tx, "ia_execucoes", campos)
			return err
		})
		if err != nil {
			dados.ErroDeEscrita(w, err)
			return
		}
		responder(w, http.StatusCreated, map[string]string{"id": id})
	}
}

// montarRobo: as rotas de robô. Só sessão de serviço (auth.SoServico, 5.13) E a regra do perfil do robô
// (soFabricante; e o catálogo onde há: campanhas e criativos). Rota nova de robô entra AQUI (a varredura da
// Task 10 confere que toda /fabrica/robo/… recusa painel).
func montarRobo(r chi.Router, p *pgxpool.Pool) {
	r.Group(func(r chi.Router) {
		r.Use(auth.SoServico, soFabricante)
		r.Patch("/fabrica/robo/jobs/{id}", atualizarJob(p))
		r.Post("/fabrica/robo/jobs/{id}/proximo-lote", proximoLote(p))
		r.Patch("/fabrica/robo/campanhas/{id}", atualizarCampanha(p))
		r.Post("/fabrica/robo/criativos", criarCriativos(p))
		r.Patch("/fabrica/robo/looks/{chave}", atualizarLook(p))
		r.Post("/fabrica/robo/meta-jobs", criarMetaJob(p))
		r.Post("/fabrica/robo/execucoes", criarExecucao(p))
	})
}
```

**(b) Testes de aceitação** (`TestRotasDeRobo`, `robo_test.go`, `m.Rodar`; "intacto" = foto igual)
- Quem passa: SÓ `robo` (sessão de serviço, perfil com a chave). Para CADA uma das 7 rotas, com um corpo válido: `fabricante`, `adminA1`, `super` (sessões de PAINEL que passariam no `Fabricante`) → 403; `impersonado` → 403; `roboSemFabrica` (serviço, perfil sem a chave) → 403; sem sessão → 401; foto igual depois de todos.
- Jobs: `PATCH /fabrica/robo/jobs/<J1> {"status":"concluido","resultado":{"criativos":3},"erro":null}` → 204; efeito `status concluido`, `resultado->>'criativos' = 3`, `erro` nulo, `updated_at` > `'2026-10-10T10:00:00Z'`; `{"status":"x"}`, `{"github_run_id":"12a"}`, `{}` → 400; `{"criado_por":"<id>"}` → 400 `corpo_invalido`; id inexistente → 404; id `"x"` → 404.
- Próximo lote: `POST …/jobs/<J1>/proximo-lote` → 201 `{"job_id": N}`; N com `tipo gerar`, `status enfileirado`, `criado_por = idRobo`, `params->>'continuacao' = '1'`, `params->>'campanhaId' = C1`; C1 com `job_id = N`. De novo → 200 com o MESMO N e um só job novo no banco. `…/jobs/<J2>/proximo-lote` (subir) → 400; job com `continuacao 300` → 409 `limite_de_lotes`.
- Campanhas: `PATCH …/campanhas/<C1> {"status":"pronta"}` → 200 com `"status":"pronta"`; `PATCH …/campanhas/<C2> {"fechar":true}` → `fechada_em` entre agora − 1 min e agora + 1 min; `{"fechada_em":"2001-01-01T00:00:00Z"}` → 400 `corpo_invalido`; `{"status":"publicada"}`, `{"fechar":false}` → 400.
- Criativos: `[{"campanha_id":"<C2>","arquetipo":"produto","template":"produto-heroi","formato":"1080x1080","variante":"avista","sku":"S2","preco_de":100,"preco_por":70,"storage_path":"<C2>/produto/s2-avista-1080x1350.png","url":"https://midia.x/f/a.png","legenda":"Oi"},{…promo sem sku nem preço…}]` → 201 `{"criados":2}`; as duas linhas no banco. Recusados (400, nada gravado — nem as linhas boas do mesmo pedido): `storage_path` `../x.png`, `<C1>/x.png` com `campanha_id` C2, `/abs.png`, `<C2>/a\\b.png`; `url` `javascript:x`; `preco_de -1`; 201 itens; `{}` (objeto, não lista) → 400 `corpo_invalido`. Rodada inexistente (uuid novo) com o caminho dela → 409 `conflito` e nada gravado.
- Looks: `PATCH …/looks/promo-sage {"preview_url":"https://midia.x/f/_previews/promo-sage-1080x1350.png"}` → 204 e gravado; chave inexistente → 404; `{"preview_url":"ftp://x"}` → 400.
- Rastro: `POST …/meta-jobs {"tipo":"estudio","ad_account_id":"act_111","loja":"Tivoli (Santa Bárbara)","meta_campaign_id":"120002","adset_ids":["1"],"ad_ids":["2","3"],"payload":{"campanhaId":"<C2>","destino":{"tipo":"nova"}},"status":"parcial","erro":"rate limit — 1 pendente(s)"}` → 201; `ad_account_id "111"`, `payload.campanhaId "x"`, `status "ok"` → 400.
- Execução: `POST …/execucoes {"robo":"fabrica-gerar","acao":"gerar criativos","modelo":"gpt-image-2","itens":3,"unidade":"criativos","status":"ok","detalhe":"completo","duracao_ms":1000,"github_run_id":"999"}` → 201 e a linha com `usd 0`, `input_tokens 0` (padrões); `{"robo":"fabrica-subir","acao":"subir campanha","usd":null,"status":null}` → 201 com `usd 0` e `status 'ok'`; `robo "budget-ia"` → 400; `itens -1`, `usd "x"` → 400.
- O robô lê pelas rotas do painel: `robo` `GET /fabrica/jobs?id=<J1>` → J1; `GET /fabrica/marcas` → M1 e M2 (lista nula de contas); `GET /fabrica/criativos?campanha_id=<C1>&limite=1&contar=1` → `X-Total-Count: 2`.
- Mutações que têm de reprovar: tirar `auth.SoServico` do grupo (o `fabricante` de painel grava); tirar `soFabricante` (o `roboSemFabrica` grava nas tabelas sem catálogo de escrita); tirar o `HasPrefix(caminho, campanha+"/")` (o caminho da rodada C1 entra numa linha de C2); tirar a busca do lote já existente (a segunda chamada cria outro job); `updated_at` vindo do corpo (o campo não declarado passaria).

**(c) Arquivos:** Create `api/internal/fabrica/robo.go`, `api/internal/fabrica/robo_test.go`.

**(d) Dependências:** Task 3 (`auth.SoServico`, ajudantes), Tasks 4 e 5 (`tabelaCriativos`, `tabelaCampanhas`); `dados.Tabela.Criar/Editar`.

- [ ] **Step 1:** Testes; ver falhar. - [ ] **Step 2:** Implementar (código de (a)). - [ ] **Step 3:** `gofmt -l ./internal && go vet ./internal/fabrica/ && go test -count=1 -race ./internal/fabrica/` PASS; mutações reprovam. - [ ] **Step 4:** Commit `feat(api): rotas de robô da Fábrica — só sessão de serviço, regras do perfil do robô, caminho de arquivo preso à rodada` (+ `Co-Authored-By`).

---
### Task 10: Montagem, varreduras, `conferir` e notas

**Revisor:** opus. **Depende de:** 4–9.

**(a) Contrato**
- `fabrica.Montar(r, p, gh, arquivos)` registra **9 leituras e 13 escritas** (1 de catálogo, 5 edges, 7 de robô) no grupo de DOMÍNIO de `web.Rotas` (`auth.Exigir` → `comPrazo(PrazoDominio)` → `autz.ComEscopo`): o despacho ao GitHub (prazo de 15 s) e o resto cabem nos 30 s do grupo. `web/rotas.go`: `fabrica.Montar(r, p, github.Novo(cfg.GitHubPAT), cfg.ArquivosDir) // Plano 5.8`, depois das montagens anteriores. Nenhuma RPC (a linha 5.8 da IV.2: 0).
- Varreduras pela cadeia real (`trafego` do 5.7 é o modelo): vazamento por conta na única leitura com restritiva; "entrar como" sem escrita; rota de robô só para sessão de serviço com o perfil certo.

`api/internal/fabrica/rotas.go`:

```go
package fabrica

import (
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/auth"
	"github.com/rbv-co/social-dashboard/api/internal/github"
)

// Montar registra as rotas do 5.8 no grupo de DOMÍNIO de web.Rotas (depois de auth.Exigir e de
// autz.ComEscopo). gh: o cliente do GitHub (GITHUB_PAT); arquivos: ARQUIVOS_DIR. Declaração errada derruba
// a subida. Rota nova entra sozinha nas varreduras de rotas_test.go.
func Montar(r chi.Router, p *pgxpool.Pool, gh *github.Cliente, arquivos string) {
	montarLeituras(r, p)
	disparos := auth.NovoLimitador()
	disparos.Max, disparos.Janela = 30, time.Hour // Ruling 5.8-16
	r.With(soFabricante, soSessaoPropria).Post("/fabrica-trigger", (&Disparador{Pool: p, GH: gh, Limite: disparos}).ServeHTTP)
	r.With(soFabricante, soSessaoPropria).Post("/fabrica-apagar", (&Apagador{Pool: p, GH: gh, Arquivos: arquivos}).ServeHTTP)
	r.With(soFabricante).Post("/fabrica-candidatos", (&Candidatos{Pool: p}).ServeHTTP) // só lê: "entrar como" passa
	cur := &Curadoria{Pool: p}
	r.With(soFabricante, soSessaoPropria).Post("/fabrica-looks", cur.Looks)
	r.With(soFabricante, soSessaoPropria).Post("/fabrica-publicos", cur.Publicos)
	montarRobo(r, p)
}
```

**(b) Testes de aceitação**
- `fabrica/rotas_test.go` (código abaixo): `TestNadaVazaEntreContas`, `TestEscritasRecusamImpersonado`, `TestRotasDeRoboSoServico`.
- `web/rotas_test.go`: `soSessao` ganha as 10 rotas de catálogo (`GET /fabrica/lojas`, `/objetivos`, `/marcas`, `/looks`, `/publicos`, `/campanhas`, `/criativos`, `/jobs`, `/meta-jobs` e `POST /fabrica/criativos/escolher`; comentário: "portão = catálogo, provado pela matriz de cada rota em `internal/fabrica`; vazamento e impersonado pelas varreduras de lá"); as 5 edges e as 7 de robô NÃO entram (o `TestNenhumaRotaNovaFicaAberta` prova `soFabricante`/`SoServico`: sessão sem módulo = 403).
- `TestFabricaPelaMontagemReal` (`web/rotas_test.go`, `testebanco.ComEsquemaDeProducao` + `usuarios`/`profiles` de `fabricante` (`permissions {"meta.fabrica":["ver"]}`), `so-meta` (`features {meta}`) e `robo-fabrica` (perfil com a chave, sessão `servico` por `st.Criar(ctx, id, "servico", nil)` — ou o ajudante do 5.13); `config.Config{}` SEM `GITHUB_PAT`): `GET /fabrica/lojas` sem sessão → 401 e `so-meta` → 200; `POST /fabrica-trigger` `so-meta` → 403; `fabricante` `{"tipo":"preview","params":{}}` → 503 `github_nao_configurado` e `select count(*) from fabrica_jobs` = 0 (passou portão e escopo; não há para onde despachar); `POST /fabrica/robo/execucoes` `fabricante` → 403 e `robo-fabrica` `{"robo":"fabrica","acao":"teste"}` → 201; `POST /fabrica-apagar` `fabricante` com uuid inexistente → 200 `{"ok":true}`.
- `cmd/api/conferir_test.go`: os testes existentes continuam verdes com as listas novas; `TestTiposDaFabrica` — `tiposDoWorker["fabrica_lojas.deposito_id"] == "text"` e `["gc_estoque_item.deposito_id"] == "bigint"` depois do `init` (a Task 7 compara texto com texto e converte para `bigint` só no parâmetro).

```go
package fabrica

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/github"
	"github.com/rbv-co/social-dashboard/api/internal/testebanco/mundoteste"
)

// escritas: um pedido VÁLIDO (para quem pode) por rota de escrita de Montar. Rota nova sem entrada aqui
// faz as varreduras falharem.
var escritas = map[string]struct{ caminho, corpo string }{
	"POST /fabrica/criativos/escolher":          {"/fabrica/criativos/escolher", `{"ids":["` + K1 + `"],"escolhido":false}`},
	"POST /fabrica-trigger":                     {"/fabrica-trigger", `{"tipo":"preview","params":{}}`},
	"POST /fabrica-apagar":                      {"/fabrica-apagar", `{"campanhaId":"` + C2 + `"}`},
	"POST /fabrica-candidatos":                  {"/fabrica-candidatos", `{"lojas":["14888726315"],"fonte":"manual","filtros":{}}`},
	"POST /fabrica-looks":                       {"/fabrica-looks", `{"acao":"excluir","chave":"promo-sage"}`},
	"POST /fabrica-publicos":                    {"/fabrica-publicos", `{"acao":"apagar","id":"` + P2 + `"}`},
	"PATCH /fabrica/robo/jobs/{id}":             {"/fabrica/robo/jobs/" + J1, `{"status":"concluido"}`},
	"POST /fabrica/robo/jobs/{id}/proximo-lote": {"/fabrica/robo/jobs/" + J1 + "/proximo-lote", ``},
	"PATCH /fabrica/robo/campanhas/{id}":        {"/fabrica/robo/campanhas/" + C1, `{"status":"pronta"}`},
	"POST /fabrica/robo/criativos": {"/fabrica/robo/criativos", `[{"campanha_id":"` + C2 + `","arquetipo":"produto",` +
		`"template":"t","formato":"1080x1080","storage_path":"` + C2 + `/produto/x.png","url":"https://midia.x/f/x.png"}]`},
	"PATCH /fabrica/robo/looks/{chave}": {"/fabrica/robo/looks/promo-sage", `{"preview_url":"https://midia.x/f/_previews/p.png"}`},
	"POST /fabrica/robo/meta-jobs":      {"/fabrica/robo/meta-jobs", `{"tipo":"estudio","payload":{"campanhaId":"` + C3 + `"},"status":"criado"}`},
	"POST /fabrica/robo/execucoes":      {"/fabrica/robo/execucoes", `{"robo":"fabrica-gerar","acao":"gerar criativos","status":"ok"}`},
}

// soLeitura: POST que só lê (o "entrar como" passa).
const soLeitura = "POST /fabrica-candidatos"

// mundoMontado: o mundo com Montar inteiro, um GitHub de mentira que conta os pedidos e a pasta de arquivos.
func mundoMontado(t *testing.T) (*mundoteste.Mundo, *atomic.Int64) {
	t.Helper()
	var pedidos atomic.Int64
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		pedidos.Add(1)
		w.WriteHeader(http.StatusNoContent)
	}))
	t.Cleanup(srv.Close)
	gh, dir := github.ParaTeste(t, "SEGREDO-pat", srv.URL), t.TempDir()
	return novoMundo(t, func(r chi.Router, p *pgxpool.Pool) { Montar(r, p, gh, dir) }), &pedidos
}

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

// A marca de A2 nunca aparece para quem não vê A2 — sem filtro, filtrando por A2 ou contando; o impersonado
// vê o que o ALVO (fabricanteA1) vê. As outras 8 leituras não têm restritiva (Ruling 5.8-15).
func TestNadaVazaEntreContas(t *testing.T) {
	m, _ := mundoMontado(t)
	comRestritiva := map[string]bool{"/fabrica/marcas": true}
	varridas := 0
	l, g := varrer(t, m, func(metodo, rota, _, _ string) {
		if metodo != http.MethodGet || !comRestritiva[rota] {
			return
		}
		varridas++
		for _, quem := range []string{"fabricanteA1", "impersonado", "fabricanteNenhuma"} {
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
		if _, b := m.Pedir(t, "fabricanteNenhuma", "GET", rota, ""); strings.Contains(b, A1) {
			t.Errorf("lista vazia viu A1 em %s: %s", rota, b)
		}
		if _, b := m.Pedir(t, "adminA1", "GET", rota, ""); !strings.Contains(b, A2) {
			t.Errorf("adminA1 não viu A2 em %s (a rota projeta account_id?): %s", rota, b)
		}
	})
	if l != 9 || g != 13 || varridas != 1 {
		t.Errorf("rotas = %d leituras (%d varridas) e %d escritas, esperava 9 (1) e 13", l, varridas, g)
	}
}

// Toda escrita recusa a sessão de "entrar como", sem tocar no banco nem no GitHub (o candidatos só lê).
func TestEscritasRecusamImpersonado(t *testing.T) {
	m, pedidos := mundoMontado(t)
	antes := m.Um(t, fotoDaFabrica)
	_, n := varrer(t, m, func(metodo, rota, caminho, corpo string) {
		if metodo == http.MethodGet {
			return
		}
		st, b := m.Pedir(t, "impersonado", metodo, caminho, corpo)
		switch chave := metodo + " " + rota; {
		case chave == soLeitura:
			if st != http.StatusOK {
				t.Errorf("%s como impersonado = %d %s (só lê: deveria passar)", chave, st, b)
			}
		case strings.HasPrefix(rota, "/fabrica/robo/"):
			if st != http.StatusForbidden {
				t.Errorf("%s como impersonado = %d %s", chave, st, b)
			}
		default:
			if st != http.StatusForbidden || !strings.Contains(b, "Quem entrou como outra pessoa") {
				t.Errorf("%s como impersonado = %d %s", chave, st, b)
			}
		}
	})
	if n != 13 {
		t.Errorf("escritas = %d, esperava 13 (rota nova? ponha soSessaoPropria e um caso em `escritas`)", n)
	}
	if m.Um(t, fotoDaFabrica) != antes || pedidos.Load() != 0 {
		t.Errorf("o impersonado mudou o banco ou chamou o GitHub (%d pedidos)", pedidos.Load())
	}
}

// Rota de robô: sessão de PAINEL (mesmo quem passaria no Fabricante) e robô sem a chave = 403 sem efeito;
// o robô com o perfil certo passa.
func TestRotasDeRoboSoServico(t *testing.T) {
	m, _ := mundoMontado(t)
	antes := m.Um(t, fotoDaFabrica)
	robo := 0
	varrer(t, m, func(metodo, rota, caminho, corpo string) {
		if !strings.HasPrefix(rota, "/fabrica/robo/") {
			return
		}
		robo++
		for _, quem := range []string{"fabricante", "adminA1", "super", "chaveEmLista", "roboSemFabrica"} {
			if st, b := m.Pedir(t, quem, metodo, caminho, corpo); st != http.StatusForbidden {
				t.Errorf("%s %s como %s = %d %s", metodo, rota, quem, st, b)
			}
		}
	})
	if robo != 7 {
		t.Errorf("rotas de robô = %d, esperava 7", robo)
	}
	if m.Um(t, fotoDaFabrica) != antes {
		t.Error("sessão de painel ou robô sem a chave gravou numa rota de robô")
	}
	varrer(t, m, func(metodo, rota, caminho, corpo string) {
		if !strings.HasPrefix(rota, "/fabrica/robo/") {
			return
		}
		if st, b := m.Pedir(t, "robo", metodo, caminho, corpo); st < 200 || st > 299 {
			t.Errorf("%s %s como robo = %d %s", metodo, rota, st, b)
		}
	})
}
```

**(c) Arquivos:** Create `api/internal/fabrica/rotas.go`, `api/internal/fabrica/rotas_test.go`; Modify `api/internal/web/rotas.go`, `api/internal/web/rotas_test.go`, `api/cmd/api/conferir.go`, `api/cmd/api/conferir_test.go`, `docs/migracao-go/NOTAS-DA-IMPLANTACAO.md`.

**(d) Dependências:** Tasks 4–9; `web.Rotas`.

- [ ] **Step 1: Testes que falham.** `fabrica/rotas_test.go` (acima); em `web/rotas_test.go`, as 10 entradas de `soSessao`, `TestFabricaPelaMontagemReal`; `TestTiposDaFabrica`. Run: `go test -count=1 ./internal/fabrica/ ./internal/web/ ./cmd/api/` → FAIL (`Montar` não existe).
- [ ] **Step 2: Implementar.** `fabrica/rotas.go`; em `web/rotas.go` os imports (`fabrica` — já importado por `cmd/api`, sem ciclo —, `github`) e, no grupo de domínio, depois das montagens anteriores, `fabrica.Montar(r, p, github.Novo(cfg.GitHubPAT), cfg.ArquivosDir) // Plano 5.8`.

`cmd/api/conferir.go` (o que as rotas e o robô presumem; as entradas de `fabrica_campanhas`, `fabrica_criativos` (Plano 4) e `fabrica_marcas` (5.7) são AMPLIADAS, não repetidas):

```go
// colunasDoWorker (Plano 5.8)
"fabrica_campanhas": "id,nome,status,objetivo,job_id,desconto_tipo,desconto_pct,parcelas,criado_por,created_at,fechada_em,purgado_em",
"fabrica_criativos": "id,campanha_id,sku,arquetipo,template,formato,variante,preco_de,preco_por,storage_path,url,legenda,escolhido,purgado_em,created_at",
"fabrica_jobs":      "id,tipo,params,status,github_run_id,resultado,erro,criado_por,created_at,updated_at",
"fabrica_lojas":     "deposito_id,nome,ativo,ordem,marca_id,whatsapp,geo_cities,canal_loja_id",
"fabrica_objetivos": "chave,rotulo,descricao,meta_objective,optimization_goal,billing_event,destination_type,promoted_object_tipo,cta_type,looks,pede_desconto,ativo,ordem",
"fabrica_marcas":    "id,nome,caption_template,ad_account,page_id,ig_id,account_id,ativo,segmento,termos_produto,created_at",
"fabrica_looks":     "chave,nome,arquetipo,objetivos,ativo,excluido,ordem,preview_url,tipo,canva_formato_map,campo_map,created_at",
"fabrica_publicos":  "id,nome,marca_id,geo,idade_min,idade_max,generos,interesses,custom_audiences,ativo,criado_por,created_at",
"fabrica_meta_jobs": "id,tipo,loja,ad_account_id,meta_campaign_id,adset_ids,ad_ids,payload,status,erro,created_at",
"ia_execucoes":      "id,robo,acao,modelo,input_tokens,output_tokens,chamadas,usd,duracao_ms,itens,unidade,status,detalhe,github_run_id",
"gc_vendas_item":    "mes,canal_loja_id,sku,produto,categoria,unidades,faturamento",
"gc_estoque_item":   "deposito_id,sku,saldo",
"gestao_comercial_briefings": "rodada,created_at,dados_json",

// tiposDoWorker (Plano 5.8): os casts e as conversões de que as rotas dependem
"fabrica_lojas.deposito_id": "text", "fabrica_lojas.canal_loja_id": "text", "fabrica_lojas.geo_cities": "jsonb",
"fabrica_campanhas.job_id": "uuid", "fabrica_campanhas.criado_por": "uuid", "fabrica_jobs.id": "uuid",
"fabrica_jobs.params": "jsonb", "fabrica_jobs.resultado": "jsonb", "fabrica_jobs.criado_por": "uuid",
"fabrica_meta_jobs.payload": "jsonb", "fabrica_meta_jobs.adset_ids": "jsonb", "fabrica_meta_jobs.ad_ids": "jsonb",
"fabrica_looks.objetivos": "text[]", "fabrica_publicos.id": "uuid", "fabrica_publicos.generos": "integer[]",
"fabrica_publicos.geo": "jsonb", "fabrica_publicos.idade_min": "integer", "fabrica_publicos.idade_max": "integer",
"gc_vendas_item.canal_loja_id": "bigint", "gc_estoque_item.deposito_id": "bigint", "gestao_comercial_briefings.dados_json": "jsonb",
```

(`fabrica_marcas.account_id` = `text` já está no 5.7; se a lista do 5.5 já declarar `gc_*`/`gestao_comercial_briefings`, una as colunas.)

Em `NOTAS-DA-IMPLANTACAO.md`, acrescente ao fim:

```markdown
## Plano 5.8 — Fábrica de anúncios

### Variáveis de ambiente (serviço `api`)
| Variável | Observação |
|---|---|
| `GITHUB_PAT` | token do GitHub (fine-grained, SÓ o repositório `rbv-co/social-dashboard`, SÓ "Actions: Read and write", com validade anotada) para `POST /fabrica-trigger` (acordar o `fabrica.yml`) e para cancelar a execução no `fabrica-apagar`; o 5.10 e o Plano 6 usam o mesmo. Hoje há `GITHUB_PAT_FABRICA` (403 desde ~29/07: achado 1) e `GITHUB_PAT_FOTOS` nos segredos do Supabase: crie um token NOVO para a API (não copie os de lá). Vazio = `503 github_nao_configurado` sem gravar nada. É segredo (`Segredos()`). |

### Rotas novas
- Com sessão, regra = catálogo (leitura aberta; marcas por conta): `GET /fabrica/lojas`, `/objetivos`, `/marcas`, `/looks`, `/publicos`, `/campanhas`, `/criativos`, `/jobs`, `/meta-jobs`; `POST /fabrica/criativos/escolher`.
- Edges portadas (portão: papel admin, super pela ficha ou a chave `meta.fabrica` de `permissions`; "entrar como" não escreve): `POST /fabrica-trigger` (30 por hora por pessoa), `/fabrica-apagar`, `/fabrica-candidatos`, `/fabrica-looks`, `/fabrica-publicos`.
- Robô (só sessão de serviço do 5.13 + perfil do robô): `PATCH /fabrica/robo/jobs/{id}`, `POST /fabrica/robo/jobs/{id}/proximo-lote`, `PATCH /fabrica/robo/campanhas/{id}`, `POST /fabrica/robo/criativos`, `PATCH /fabrica/robo/looks/{chave}`, `POST /fabrica/robo/meta-jobs`, `POST /fabrica/robo/execucoes`.

### Conta de serviço do robô da Fábrica (depois do 5.13)
- `usuarios` + `profiles` `robo-fabrica@rbvcompany.com`: papel `viewer`, `features {meta, sales}` (`meta` para o `meta-proxy`; `sales` porque o `bling-proxy` só libera `produtos` a `sales`/`gestor`/`autenticidade`, e `autenticidade` abriria a escrita da Vessel: achado 7), `permissions {"meta.fabrica": ["ver","editar"]}`, `allowed_accounts` nulo, `escopo_por_equipe false`, sem senha.
- Token: `api servico criar robo-fabrica robo-fabrica@rbvcompany.com` (imprime UMA vez) → segredo `API_TOKEN_FABRICA` no GitHub (Settings → Secrets) e no `fabrica.yml` no lugar de `SUPABASE_SERVICE_KEY`/`GESTOR_USER_*` (Plano 7). Revogar: `api servico revogar robo-fabrica`.

### Antes do corte
- `api worker conferir` no banco restaurado: colunas e tipos do 5.8 (em especial `fabrica_lojas.deposito_id` texto e `gc_estoque_item.deposito_id` bigint).
- Nenhum gatilho nas `fabrica_*`: `select tgname from pg_trigger g join pg_class c on c.oid = g.tgrelid where not g.tgisinternal and c.relname like 'fabrica\_%'` = vazio.
- Arquivos: os criativos do bucket `fabrica-criativos` copiados para `<ARQUIVOS_DIR>/fabrica-criativos/<storage_path>` (Plano 6) ANTES de ligar o `fabrica-apagar` da API (antes disso ele apaga o banco e não acha arquivo: sobra no Storage antigo, que some com o Supabase).
- `HOSTS_DE_MIDIA` com o host público do Storage novo (Plano 6): o `meta-proxy` só aceita `imageFromUrl` desses hosts, e o `subir` da Fábrica manda a URL do criativo (INVENTARIO item 6).
- `GITHUB_PAT` preenchido e testado no ensaio: um `POST /fabrica-trigger {"tipo":"preview","params":{}}` acorda o `fabrica.yml` (o job aparece em Actions) — com o robô ainda falando com o Supabase, o preview roda contra o banco antigo; faça isso só depois do Plano 7 trocar o robô, ou cancele a execução.
- Confirmar a edge NO AR (`npx supabase functions download fabrica-trigger …`, CLAUDE.md): se ela já aceita `excluir`, o Ruling 5.8-7 muda para aceitar também (achado 2).

### Mudanças de contrato que o Plano 7 absorve
- Leituras por `GET /fabrica/<recurso>` com filtros nomeados (`ativo`, `chave`, `account_id`, `id`, `status` (lista por vírgula), `aberta`, `purgada`, `campanha_id`, `escolhido`, `arquetipo`, `purgado`, `tipo`, `com_campanha_meta`) e `ordem=created_at|fechada_em[.desc]`. A Home troca o laço de contagem (home:35) por `qtd_criativos` de `GET /fabrica/campanhas`, e a contagem total (home:42) por `GET /fabrica/criativos?limite=1&contar=1` (`X-Total-Count`). `jobs` não traz `criado_por`.
- `POST /fabrica/criativos/escolher {"ids":[…],"escolhido":bool}` substitui os dois `update` de `fabrica_criativos` (curar:33, :48).
- As 5 edges: mesma URL sob `/api` e mesmos corpos; erros novos: `fabrica-trigger` → `503 github_nao_configurado`, `429 muitas_tentativas`, `504 dispatch_incerto`, `400 pedido_invalido` (params); `fabrica-apagar` → `400 campanhaId_invalido`; `fabrica-candidatos` → `400 pedido_invalido` (lojas/filtros); `fabrica-looks` → `sync` = `400 acao_invalida`; `fabrica-publicos` → `404` no `salvar` com `id` inexistente. `detail` do `dispatch_falhou` é uma frase da API, não o texto do GitHub.
- Robô (`coletor/fabrica-job-runner.mjs` e módulos, tabela da Task 9): `loginServico` → token de serviço; cada `sbGet/sbPost/sbPatch` → a rota da tabela; `registrar-execucao.mjs` → `POST /fabrica/robo/execucoes` (só para os robôs da Fábrica; os outros robôs desse módulo são da VPS e usam `pg`); a pílula de garantia espera o `GET /fabrica/robo/material-do-sku` do 5.10.

### Achados para o dono
(ver a seção "Achados para o dono" do plano 5.8)
```

Rode `gofmt -w ./internal ./cmd`.
- [ ] **Step 3: Rodar e ver passar.** `gofmt -l . && go vet ./... && go test -count=1 -race ./... 2>&1 | grep -v goose | grep -E '^(ok|FAIL|---)'` → todos `ok`. Mutações que têm de reprovar: tirar `soSessaoPropria` de UMA escrita (a varredura do impersonado acusa); tirar `auth.SoServico` do grupo de robô (`TestRotasDeRoboSoServico`); uma leitura de mentira em `Montar` sobre `fabrica_marcas` que não projete `account_id` (o lado positivo acusa); `fabrica.Montar` FORA do grupo com `ComEscopo` (as rotas de catálogo respondem 500 e o `soFabricante` nega tudo).
- [ ] **Step 4: Commit** `feat(api): monta a Fábrica (leituras, edges e rotas de robô), varreduras de conta, impersonado e sessão de serviço, conferir e notas` (+ `Co-Authored-By`).

---

### Verificação final do 5.8

- [ ] `docker stop pg-plano58` e `make -C api teste PG_PORTA=58548` → todos `ok` (nunca junto com o gate de outra worktree).
- [ ] Subir o `pg-plano58` de novo e `cd api && go test -count=1 -v ./... 2>&1 | grep -c -- '--- SKIP'` → `0`.
- [ ] `cd api && gofmt -l . && go vet ./...` → nada.
- [ ] `git diff feat/api-go-plano-5-7 --stat -- src/ supabase/ coletor/ db/ .github/` → vazio (front e robô trocam no Plano 7; produção não muda).
- [ ] `grep -rn 'GITHUB_PAT\b' api/internal | grep -v 'config\|_test.go'` → nada (o token só entra por `config`); `grep -rn 'http.Get\|http.Post\|http.DefaultClient' api/internal/github api/internal/fabrica` → nada; `grep -rn 'os.Remove\b\|os.RemoveAll' api/internal/fabrica | grep -v _test` → nada (só `os.Root`).
- [ ] `grep -rn 'api.github.com' api/internal | grep -v '_test.go'` → só `github/github.go` (a base fixa).
- [ ] `docker stop pg-plano58`.
- [ ] Revisão final do branch por opus com foco em: o PAT (alguma saída — erro, log, resposta, `robos_execucoes` — com o token? algum caminho segue redirecionamento?), o portão (alguma escrita sem `Fabricante`/catálogo, ou com `PodeX` fora da transação que grava?), o `fabrica-apagar` (algum caminho do banco apaga fora da raiz? o banco apaga antes do disco?), as rotas de robô (alguma aceita painel? o `storage_path` gravado pelo robô fica preso à rodada?) e o despacho (job pendurado em algum ramo de falha?).

---

## Inventário: sítios do front a trocar (Plano 7)

`grep` em `src/ferramentas/meta-ads/` (fora de `*.test.*`) em 2026-10-12, contando `sb('<tabela>…')`, `sbClient.from('<tabela>')`, `functions.invoke('<edge>')` e `fetch(SUPABASE_URL + '/functions/v1/<edge>')`: **23 sítios nas 9 tabelas** (`fabrica_campanhas` 5, `fabrica_criativos` 5, `fabrica_jobs` 4, `fabrica_lojas` 3, `fabrica_objetivos` 2, `fabrica_meta_jobs` 1, `fabrica_marcas` 1, `fabrica_publicos` 1, `fabrica_looks` 1) e **14 chamadas às 5 edges** da Fábrica. Os demais `grep` (comentários em `painel-gerar.vue:3-6`, `painel-subir.vue:34, 45, 58, 203-206`, `tela-de-fabrica-estudio.vue:20`) não chamam nada.

Abreviações: `home` = `tela-de-fabrica-home.vue`; `gerar` = `painel-gerar.vue`; `curar` = `painel-curar.vue`; `subir` = `painel-subir.vue`; `conferir` = `painel-conferir.vue`; `looks` = `tela-de-fabrica-looks.vue`; `estudio` = `tela-de-fabrica-estudio.vue`; `ujs` = `use-job-status.js`; `uc` = `use-candidatos.js`.

| Rota | Sítios | Qtde |
|---|---|---|
| `GET /fabrica/lojas` | gerar:35 (`?ativo=true`), curar:21, subir:350 | 3 |
| `GET /fabrica/objetivos` | gerar:36 (`?ativo=true`), subir:225 (`?chave=`) | 2 |
| `GET /fabrica/campanhas` | home:32, home:41, curar:23, curar:56, subir:222 | 5 |
| `GET /fabrica/criativos` / `POST /fabrica/criativos/escolher` | home:35 (vira `qtd_criativos`), home:42 (`contar=1`), curar:20 / curar:33, curar:48 | 5 |
| `GET /fabrica/jobs` | curar:26, curar:59, estudio:31, ujs:8 | 4 |
| `GET /fabrica/meta-jobs` | home:93 | 1 |
| `GET /fabrica/marcas` | subir:229 (`?account_id=`) | 1 |
| `GET /fabrica/publicos` | subir:170 (`?ativo=true`) | 1 |
| `GET /fabrica/looks` | looks:20 | 1 |
| `POST /fabrica-trigger` | gerar:95, conferir:25, conferir:39 (`excluir`: achado 2), subir:381, looks:58 | 5 |
| `POST /fabrica-apagar` | home:106, home:128 | 2 |
| `POST /fabrica-candidatos` | uc:7 | 1 |
| `POST /fabrica-looks` | looks:23, looks:38, looks:48, looks:53 | 4 |
| `POST /fabrica-publicos` | subir:294, subir:303 | 2 |

Na mesma área, de OUTROS planos (não trocar pelo 5.8): **5.7** — `buscar-lugar` (subir:125, 153) e `interesses_sugeridos` (subir:232 → `GET /gestao-trafego/interesses-sugeridos?marca_id=&objetivo=`); **Plano 3 / 5.6** — `meta-proxy` (subir:51, 140, 184, 193, 317, 337, 344, 357; home:77: o `GET /<id da campanha>` é negado a quem tem lista de contas, achado 9); **5.6** — `campaign_insights_hora`, `campaigns`, `followers_leituras`, `perfil_visitas_hora`, `ads`, `ad_insights_hora` (`tela-de-relatorio-por-hora.vue:314-319`), `campaign_insights` (`tela-de-relatorio-opr.vue:305-307`); **5.11/5.10** — `tela-de-base-de-leads.vue:110-133` (`carrinho_eventos`, `vessel_*`). Robô: a tabela da Task 9 (Plano 7, com a conta de serviço do 5.13).

## Paralelização

- **Uma worktree por tarefa paralela** (merge na ordem dos números). As Tasks 3–10 são o MESMO pacote Go (`fabrica`): em worktrees separadas, cada uma só cria os SEUS arquivos; os ajudantes comuns (`Fabricante`, `soFabricante`, `soSessaoPropria`, `responder`, `errPedido`, `escritaOuPedido`, `reChaveLook`, `reRunID`, validadores) e o mundo são da Task 3; `tabelaCampanhas` mora na Task 5 e `tabelaCriativos` na Task 4 — a Task 9 usa as duas, então espera o merge de 4 e 5 OU declara as duas em `robo.go` e quem mesclar por último apaga a cópia (prefira esperar: é uma onda). Um contêiner (`pg-plano58`, porta 58548) atende todas: cada teste cria o próprio banco.
- **Onda 1:** Tasks 1 (`testebanco`) e 2 (`github`, `config`) — paralelas, pacotes disjuntos. **Onda 2:** Task 3. **Onda 3:** Tasks 4, 5, 6, 7 e 8 (5 e 6 esperam também a 2; 7 espera o 5.5) — cinco em paralelo. **Onda 4:** Task 9 (precisa de `tabelaCampanhas`/`tabelaCriativos` das 4 e 5). **Onda 5:** Task 10 (a única que toca `fabrica/rotas*.go`, `web/*`, `conferir*.go` e as notas).
- **Com outros sub-planos:** a fatia 5.8 não toca o gerador nem `02-gatilhos.sql` e não redeclara `fabrica_marcas` (5.7). `internal/github` é consumido pelo 5.10 (acrescenta `"vessel-fotos"` e `"vessel-cartoes"` em `Disparos`) e pelo Plano 6 — conflito mecânico de uma linha no mapa. `auth/servico.go` só existe aqui se o 5.13 ainda não tiver entrado (conflito = apagar o daqui). Arquivos de fronteira em comum: `web/rotas.go`, `web/rotas_test.go`, `cmd/api/conferir*.go`, `config/config*.go`, `NOTAS-DA-IMPLANTACAO.md`: quem mescla por último junta e roda o gate. Gates (`make teste`, contêiner fixo `pg-api-teste`) nunca ao mesmo tempo.

## Rulings do 5.8

1. Ruling: D0 = fatia RECONSTRUÍDA `01-tabelas-5-08.sql` com as 8 tabelas das migrations (sem presumido: todas têm DDL no repositório), `fabrica_marcas` fica onde o 5.7 a declarou, nenhuma função nem gatilho (o levantamento não tem nenhum nas `fabrica_*`), e `gc_*`/`gestao_comercial_briefings` vêm da fatia do 5.5 — declarar de novo quebraria a carga; o gerador não emite nada para estas tabelas — custo se errada: coluna acrescentada em produção sem migration só aparece no `api worker conferir` do banco restaurado.
2. Ruling: dois pacotes — `internal/github` (genérico, sem banco, consumido por 5.8, 5.10 e Plano 6; o Conteúdo do 5.9 vai para a VPS e não o usa) e `internal/fabrica` (que já tinha a purga), com TODAS as rotas da Fábrica no grupo de domínio, inclusive as edges e as de robô — o despacho cabe nos 30 s do grupo, e as rotas precisam do escopo (`Fabricante` lê o perfil); um pacote por edge seria cerimônia — custo se errada: `fabrica` cresce para ~10 arquivos.
3. Ruling: `Fabricante` (perfil ativo com papel `admin`, `is_superadmin` da ficha ou a chave `meta.fabrica` de `permissions`) é o portão das 5 edges e das rotas de robô, e é a MESMA regra das policies de escrita `fab_camp_write`/`fab_criativos_write` (provado pessoa a pessoa contra o catálogo compilado); nas 7 tabelas que só a chave de serviço gravava, a escrita das edges e do robô é SQL explícito atrás desse portão, em `banco.ComUsuario` — as edges usavam a chave de serviço com esse mesmo trio; o catálogo compila `service_role` como `false` (Ruling 5 do mestre), então "o catálogo" sozinho negaria o que as edges fazem; difere da edge em dois cantos: a chave dentro de um ARRAY no topo de `permissions` passa (o `?` do jsonb; o `hasOwnProperty` da edge não passava) e a conta desativada não passa (já não há sessão dela) — custo se errada: quem tem `permissions` em array passa a disparar a Fábrica (hoje ninguém: o formato normal é objeto).
4. Ruling: o despacho de GitHub Actions usa UM token (`GITHUB_PAT`, fine-grained, só o repositório e só Actions), uma lista FECHADA em código (`Disparos`: repositório constante `rbv-co/social-dashboard`, arquivo, ref e cada entrada com formato), base fixa `https://api.github.com` (só `ParaTeste`, que exige loopback e recebe `testing.TB`, troca), sem seguir redirecionamento — o pedido nunca escolhe repositório, workflow ou ref; um token só vence de uma vez para os três consumidores (é notado no dia seguinte pelo selo da Vessel, em vez de sumir em silêncio como o da Fábrica, achado 1); seguir 3xx entregaria o `Authorization` a outro host — custo se errada: trocar o repositório de dono vira deploy (uma constante), e um token comprometido acorda os três robôs (mitigado: só Actions, só este repositório).
5. Ruling: erro do GitHub por CLASSE (401, 403, limite por 429 ou 403 com cabeçalho de limite, 404, 422, 5xx, sem resposta antes de conectar = indisponível, sem resposta depois de conectar = incerto) e SEM repetição automática; a tela recebe uma frase da API por classe, nunca o corpo do GitHub; no `incerto` o job e a rodada são marcados `erro` com a frase "confira em Actions" — um despacho repetido acordaria o robô duas vezes (ele é idempotente por arquivo, `fabrica-job-runner.mjs:46`, mas gasta tempo de Actions e de gpt-image); se o GitHub aceitou sem responder e o robô rodar, ele mesmo regrava o status (`:118`); o corpo do GitHub pode citar o repositório e não ajuda quem está na tela — custo se errada: no `incerto` raro, a tela diz "erro" por alguns segundos antes de o robô corrigir.
6. Ruling: `fabrica-trigger` confere o token ANTES de gravar e valida só o que a API usa (`campanhaId` uuid, `nome` e `objetivo` com tamanho, `params` objeto até 64 KiB); o resto de `params` passa como está — sem token a edge criava rodada e job que ficavam "gerando" para sempre; `campanhaId` vai para a URL que o robô monta; validar `itens`/`destino` seria reescrever o protocolo do robô, que já os valida — custo se errada: um `params` estranho chega ao robô como hoje.
7. Ruling: `tipo: "excluir"` continua recusado (`400 tipo_invalido`), como na edge do repositório — o botão "Excluir esta remessa" (`painel-conferir.vue:39`, 13/07) manda `excluir` e a edge (última mudança 12/07) recusa: o botão nunca funcionou pelo que está no GitHub; liberar apaga campanhas na Meta e é decisão do dono, não da migração (achado 2) — custo se errada: o botão continua sem efeito até o dono decidir (liberar = uma palavra em `tiposDeJob` e um caso de teste).
8. Ruling: na falha do despacho, o job vira `erro` só se ainda `enfileirado` e a rodada só se foi criada POR ESTE pedido e ainda está `gerando` — a edge marcava `erro` também a rodada de um `subir` (que já estava pronta e passava a aparecer "Deu erro ao gerar"), e sobrescreveria um job que o robô já tivesse começado — custo se errada: nenhum.
9. Ruling: `fabrica-apagar` apaga o BANCO primeiro (rodada e criativos por `cascade`, com `PodeApagar` na transação), depois cancela o run (melhor esforço; já terminado = sucesso) e por fim os arquivos, pela MESMA `apagar` da purga (`filepath.IsLocal`, sem NUL, `os.Root`) e pela pasta `<campanhaId>/` (`os.Root.RemoveAll`); falha de arquivo vai ao log e sobra para a `faxina-fabrica`; rodada inexistente = `{"ok":true}` (idempotente) e id inválido = 400 — arquivo apagado com o banco ainda apontando para ele é imagem quebrada na tela; arquivo sobrando sem linha é só disco, e a faxina já existe para isso; a pasta da rodada leva o `.mp4` do 16:9, que nunca teve linha e sobrava para sempre — custo se errada: com o disco fora, a resposta é `ok` e o espaço só volta na faxina.
10. Ruling: `fabrica-candidatos` lê `gc_*` como a edge (sem as restritivas `pode_ver_estoque`/`pode_ver_canal`), mas SÓ dos depósitos e canais de `fabrica_lojas`, sem o teto de 1000 linhas do PostgREST e em ordem determinística — a edge usava a chave de serviço, e recortar pela equipe de quem pede mudaria a lista dele; o depósito cru do pedido deixava ler o estoque de qualquer depósito do Bling; o teto cortava a lista em silêncio (3591 linhas em `gc_vendas_item`) — custo se errada: as listas BCG/ABC/manual podem crescer (agora estão completas) e a ordem pode mudar (achado 3).
11. Ruling: o robô da Fábrica (no GitHub Actions) escreve por 7 rotas `/fabrica/robo/…` atrás de `auth.SoServico` (contrato do 5.13: sessão de serviço de um usuário com perfil próprio, SEM escopos por token) e da regra do PERFIL dele (`Fabricante`; o catálogo onde há regra de escrita), lê pelas rotas do painel, recebe o relógio do servidor (`updated_at`, `fechada_em`), tem o `proximo-lote` idempotente numa transação e só grava `storage_path` dentro de `<campanha_id>/` — o runner não alcança o banco (COORDENACAO 12/10 23:10); dar ao robô a chave de serviço de volta recriaria o acesso total; o caminho gravado pelo robô é o que o `fabrica-apagar` e a purga apagam do disco — custo se errada: cada nova escrita do robô vira uma rota (o Plano 7 conta 7 hoje).
12. Ruling: só entram as rotas que alguém usa — `fabrica-looks` `sync` (nenhum chamador em `src/` nem `coletor/`), o modo `--estrela` e a rodada criada sem `campanhaId` do `gerar-criativos` (só linha de comando) e o bucket (Plano 6) ficam sem rota — rota sem dono é superfície sem teste de uso; o fluxo vivo (o job do `fabrica-trigger`) não passa por nenhum deles — custo se errada: rodar o `gerar-criativos` à mão pede o banco (VPS) ou uma rota nova.
13. Ruling: a leitura do material do lote para a pílula de garantia (`GET /fabrica/robo/material-do-sku`) tem o contrato definido aqui e é IMPLEMENTADA pelo 5.10, dono de `vessel_lotes` — declarar `vessel_lotes` na fatia 5.8 puxaria os 5 gatilhos dela para o gerador e para `CONFERIDOS`; a rota projeta UMA coluna em vez de dar ao robô o módulo `autenticidade` (que abriria a escrita das tabelas da Vessel) — custo se errada: entre o 5.8 e o 5.10 a arte sai sem a pílula (o robô já trata, `texto-da-garantia.mjs:56-64`).
14. Ruling: a escolha de criativos é UMA ação (`POST /fabrica/criativos/escolher`), com `Tabela.Editar` em cada id numa transação e em ordem fixa — a tela fazia um `update` por id e um `in (…)`; uma ação só cobre os dois, e a ordem fixa evita impasse entre duas pessoas curando a mesma rodada — custo se errada: nenhum.
15. Ruling: as leituras seguem o catálogo — `true` em 8 tabelas (qualquer sessão, inclusive a do robô), `pode_ver_conta` em `fabrica_marcas`; `GET /fabrica/campanhas` traz `qtd_criativos` por subconsulta com a regra de Ler; os filtros por `params->>'campanhaId'`/`payload->>'campanhaId'` usam expressão total (texto ou nulo) — "mesmas permissões de hoje" (achado 6); a Home fazia uma contagem por rodada a cada 4 s enquanto alguma gerava — custo se errada: qualquer sessão continua lendo campanhas, jobs (com `params`) e públicos, como hoje.
16. Ruling: `fabrica-trigger` limita 30 disparos por hora por pessoa (`auth.Limitador` em memória) — cada disparo pode gastar IA paga e criar anúncio; a edge não tinha limite; o grupo de concorrência do `fabrica.yml` só enfileira — custo se errada: quem dispara muito toma 429 por até uma hora; reiniciar a API zera a contagem (uma instância).

## Achados para o dono

1. **O token da Fábrica parece vencido em produção.** O `vessel-fotos-trigger` registra (07/09) que o `GITHUB_PAT_FABRICA` responde 403 ("Resource not accessible by personal access token") e que o último disparo da Fábrica que funcionou foi em 29/07: o botão "Gerar" pode estar falhando hoje. A API usa um token novo (`GITHUB_PAT`); vale conferir a Fábrica em produção agora.
2. **O botão "Excluir esta remessa" (Conferir) nunca funcionou pelo código do repositório:** ele manda `tipo: "excluir"` e a `fabrica-trigger` só aceita `gerar/subir/ativar/preview` (o robô sabe excluir: `excluir-estudio.mjs`). A migração mantém recusado. Decisão sua: liberar (a API aceita com uma palavra) ou tirar o botão. Antes, conferir se a edge NO AR difere da do repositório.
3. **A lista de produtos da Fábrica (BCG, ABC, manual) era cortada em 1000 linhas de vendas sem aviso** (a tabela tem 3591). Com a API a lista fica completa: pode aparecer mais produto do que hoje.
4. **`fabrica-candidatos` deixava ler o estoque de qualquer depósito do Bling** (o depósito vinha cru do pedido). A API só aceita os depósitos da Fábrica.
5. **A Fábrica não tem escopo por loja nem por conta (exceto as marcas):** quem tem a chave `meta.fabrica` vê vendas e estoque agregados de todas as lojas da Fábrica, e qualquer sessão lê campanhas, criativos, jobs (com os itens e preços) e públicos. Mantido (paridade); fechar é policy em produção.
6. **Super-admin e admin passam pela Fábrica sem a chave** (é a policy). E `meta.fabrica` em `features` (módulo) NÃO dá acesso: só a chave em `permissions` — quem tiver só o módulo vê o menu e toma 403 ao gerar.
7. **O robô da Fábrica precisa do módulo `sales` para ler produtos no `bling-proxy`** (não há módulo só de produto além de `autenticidade`, que abriria a escrita da Vessel). Sugestão: o `bling-proxy` aceitar `meta.fabrica` para `produtos` (Plano 3), e o robô ficar sem `sales`.
8. **`fabrica-publicos` ao salvar um preset existente apaga a marca dele e troca o "criado por"** pelo de quem salvou. Mantido (paridade).
9. **Quem tem lista de contas perde o selo de status das campanhas publicadas** na Home: o `meta-proxy` do 5.6 nega `/<id da campanha>` a quem tem lista (o selo cai em "?"). Liberar = olhar `campaigns` da conta no `meta-proxy` (anotado no 5.6).
10. **A pílula de garantia nas artes depende do 5.10** (`GET /fabrica/robo/material-do-sku`); entre o 5.8 e o 5.10 as artes saem sem ela.
11. **Os modos de linha de comando do `gerar-criativos`** (`--estrela`, rodada sem `campanhaId`) e os validadores manuais da Meta deixam de ter banco quando o Supabase sair: rodar na VPS com `pg` ou aposentar (o INVENTARIO já propõe aposentar parte deles).

## Cobertura da spec e o que vem depois

**As 9 tabelas da linha 5.8 (18 policies, 1 restritiva):**

| Tabela | Policies (restritiva?) | Destino |
|---|---|---|
| `fabrica_campanhas` | `fab_camp_read` (`true`), `fab_camp_write` ALL (Fabricante), `fab_camp_srv` (serviço) | Task 4 (leitura), Task 5 (cria no `gerar`), Task 6 (apaga), Task 9 (status/fechar do robô) |
| `fabrica_criativos` | `fab_criativos_read` (`true`), `fab_criativos_write` ALL (Fabricante), `fab_criativos_srv` | Task 4 (leitura e escolha), Task 6 (cascade), Task 9 (o robô cria) |
| `fabrica_jobs` | `fab_jobs_read` (`true`), `fab_jobs_srv` | Task 4 (leitura), Task 5 (cria), Task 9 (robô: status e próximo lote) |
| `fabrica_lojas` | `fab_lojas_read` (`true`), `fab_lojas_srv` | Task 4 (leitura); Task 7 (filtra as lojas) |
| `fabrica_looks` | `fab_looks_read` (`true`) | Task 4 (leitura), Task 8 (curadoria), Task 9 (prévia do robô) |
| `fabrica_marcas` | `fab_marcas_read` (`true`), `so_contas_permitidas` **select, restritiva**, `fab_marcas_srv` | Task 4 (leitura por conta; DDL no 5.7) |
| `fabrica_meta_jobs` | `fab_meta_read` (`true`), `fab_meta_srv` | Task 4 (leitura), Task 9 (o robô grava o rastro) |
| `fabrica_objetivos` | `fab_obj_read` (`true`) | Task 4 (leitura; escrita só por migration) |
| `fabrica_publicos` | `fab_pub_read` (`true`) | Task 4 (leitura), Task 8 (presets) |

Edges: `fabrica-trigger` (Task 5), `fabrica-apagar` (Task 6), `fabrica-candidatos` (Task 7), `fabrica-looks` e `fabrica-publicos` (Task 8); `fabrica-purga` já era do Plano 4; `buscar-lugar` é do 5.7. Cliente `internal/github` (Task 2). RPC: 0. Gatilhos: 0. Spec §4 (conta de serviço para o robô, pelo contrato do 5.13), §5 (catálogo, escopo por conta, IDOR, ator × operação × recurso pela cadeia real), §7 (arquivos no disco só dentro da raiz), §11 (segredo em variável de ambiente, fora de resposta e log; destino externo fixo; impersonação sem escrita), §13 (escritas negadas sem efeito, externo de mentira com contagem, varreduras de toda rota).

**O que vem depois:**
- **5.10 (Autenticidade):** acrescenta `"vessel-fotos"` (`fotos-do-selo.yml`) e `"vessel-cartoes"` (`cartoes-ean.yml`) em `github.Disparos` e usa `github.ParaTeste` nos testes; implementa `GET /fabrica/robo/material-do-sku` (contrato na Task 9) e a põe na varredura de robô do 5.8 (`escritas` não muda: é GET; `TestRotasDeRoboSoServico` passa a contar 8).
- **5.13 (trilha A):** `auth.SoServico` e o emissor de `tokens_de_servico`; se entrar depois do 5.8, apaga `auth/servico.go` daqui e troca `sessaoDeServico` pelo ajudante dele.
- **Plano 6:** Storage (`fabrica-criativos` no disco, upload do robô, `HOSTS_DE_MIDIA` com o host novo); acrescenta a entrada dele em `github.Disparos` se precisar.
- **Plano 7:** os 23 sítios de tabela e as 14 chamadas de edge da tabela acima; o `coletor/fabrica-job-runner.mjs` e módulos pela tabela da Task 9, com o token de serviço no `fabrica.yml`.
- **Antes do corte:** `GITHUB_PAT` novo, conta de serviço do robô, arquivos no disco e `HOSTS_DE_MIDIA` (NOTAS); a decisão do achado 2.
