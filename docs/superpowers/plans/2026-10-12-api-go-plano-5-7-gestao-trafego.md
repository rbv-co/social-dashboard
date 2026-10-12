# Sair do Supabase — Plano 5.7: Gestão de tráfego

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **Execute na worktree `p5-57`** (branch `feat/api-go-plano-5-7`, que já traz o 5.0 e o 5.1 executados e os planos 5.1, 5.2 e 5.6). Antes da Task 1 ela recebe o **5.6 EXECUTADO** (`git merge --no-edit feat/api-go-plano-5-6`), que traz junto a fundação comum do 5.2 (`dados.SoSessaoPropria`, `mundoteste`). Faça `git add` só dos caminhos de cada task. Este plano contrata sobre as **interfaces** escritas nos planos 5.0, 5.1, 5.2 e 5.6, não sobre o código: o pré-voo confere que elas existem com esses nomes.

**Goal:** Trocar os 23 acessos vivos do front às 10 tabelas da Gestão de Tráfego (e à RPC `gt_registrar_problemas`) por 16 rotas de domínio e uma RPC registrada que decidem com as MESMAS regras das 24 policies de produção (5 restritivas `pode_ver_conta`), e portar as 3 edges da tela (`sugerir-publico-ia`, `ler-documento`, `buscar-lugar`) para a API em Go com portão, limite de custo/taxa, prazo, teto de corpo, chave de IA em variável de ambiente e o mapa falando só com o Nominatim.

**Architecture:** Três pacotes novos. `internal/trafego` (tabelas e RPC), montado no grupo de domínio do 5.0 (`auth.Exigir` → `autz.ComEscopo`): leitura = `dados.Consulta` (regra de Ler do catálogo no `WHERE`, inclusive a restritiva); escrita = o caminho declarado do 5.1 (`dados.Tabela` + `RotaCriar/RotaEditar/RotaApagar`) nos rascunhos, o upsert com a semântica da RLS (`dados.UpsertVisivel`, promovido do `redes.upsertVisivel` do 5.6) na configuração e nos objetivos, e handlers de uma transação para a decisão da fila (criar só o que se vê) e a régua (configuração + histórico juntos); a RPC entra em `web.FuncoesRPC` com o portão da função e a conta conferida por `autz.PodeVerConta` (campo novo `rpc.Funcao.ParamConta`). `internal/ia` (os dois proxies da Anthropic, HTTP cru com URL fixa) e `internal/mapa` (o Nominatim, com cache e uma ligação por segundo) ficam no grupo de sessão, como o `meta-proxy`, cada um com `ExigirModulo` e `comPrazo` próprios. Testes contra a fatia 5.7 do D0 (tabelas reconstruídas das migrations; o gatilho e a função verbatim do levantamento) e contra servidores externos de mentira (`httptest`).

**Tech Stack:** Go 1.26 (`go.mod`), `chi`, `pgx` v5, Postgres 17 (contêiner), `net/http/httptest`.

**Spec:** `docs/superpowers/specs/2026-10-09-sair-do-supabase-design.md` (§5 autorização, §8 proxies de IA e de mapa, §11 segurança, §13 testes) e o plano-mestre `docs/superpowers/plans/2026-10-11-api-go-plano-5-dominios.md` (§II contrato, IV.1 regras de sub-plano, linha 5.7 da IV.2, IV.3, Rulings 1–36, em especial 5, 26, 34 e 36). Modelos: `…-5-6-meta-redes.md` (formato, `upsertVisivel`, `PodeVerConta`), `…-5-1-admin-equipes-acesso.md` e `…-5-2-patrimonio-cadastros.md` (escrita declarada, `SoSessaoPropria`, `mundoteste`, RPC por sub-plano). Permissões: `docs/migracao-go/catalogo-policies-producao.json` — 24 policies nas 10 tabelas (`levantamento/01-policies.csv:258-312`).

## Global Constraints

- Nada em produção: sem `ssh`, sem credencial real, sem `push`. Postgres local descartável; segredos de teste inventados (`SEGREDO-…`); a Anthropic e o Nominatim dos testes são `httptest`.
- Regra de cada tabela = a do catálogo (`autz.Producao`), nunca reescrita à mão. Divergência só por Ruling deste plano (5.7-5, 5.7-7, 5.7-8, 5.7-9, 5.7-12 a 5.7-14).
- "Gestor" nas policies das 10 tabelas é `exists(profiles p where p.id = auth.uid() and (p.role = 'admin' or 'meta.gestor' = any(p.features)))`: **super-admin pela ficha NÃO entra** (nem por e-mail). O compilador do 5.0 já traduz isso (`perfilCom(termoPapel("admin"), termoModulo("meta.gestor"))`); nenhum código deste plano reescreve.
- Escopo por conta em toda leitura das 5 restritivas (`gt_campanhas_rascunho`, `gt_fila_decisoes`, `gt_ad_analises`, `gt_budget_analises`, `gt_problemas_meta`): `allowed_accounts` nulo = todas; `{}` = nenhuma; lista = só ela; papel `admin` e super pela ficha = todas (`pode_ver_conta`). Conta invisível responde igual a conta inexistente (lista `[]`, `404`, `403` iguais).
- Negar por padrão. Todo portão tem o lado negado assertado **com o efeito**: foto do banco igual; o servidor externo de mentira não recebeu pedido.
- Toda rota tem teste de vazamento com pessoa restrita pela cadeia real (`mundoteste`: `auth.Exigir` → `autz.ComEscopo`), sem filtro, com `?account_id=<A2>` e com `contar=1`.
- Escritas: sessão de "entrar como" = `403 {"error":"sem_permissao","mensagem":"Quem entrou como outra pessoa só consulta."}` sem efeito (`dados.SoSessaoPropria(dados.FraseEntrarComo)`; na RPC, `rpc.Funcao.SoSessaoPropria`). `PodeX` na MESMA transação de `banco.ComUsuario` que grava, sobre o MESMO mapa que vai ao `INSERT`/`UPDATE`.
- Leitura declarada só com a GRAMÁTICA do 5.0 (`select … from <tabela> t [left join … on … and {ler:…}]`; filtros comparam coluna com parâmetro tipado; ordens e filtros por lista).
- Segredos: a chave da IA vem SÓ de `ANTHROPIC_API_KEY_TRAFEGO` (nunca de `segredos_de_cron`), entra em `config.Segredos()` e nunca sai em resposta nem em log. Log dos proxies: nunca chave, prompt, persona, evidência, documento, termo de busca ou coordenada.
- Externos com URL FIXA no código (campo não exportado; só os testes do pacote trocam), sem seguir redirecionamento, com resposta lida até um teto e prazo da rota.
- SQL: todo parâmetro com cast explícito; nada do pedido no texto do SQL.
- Sem dependência nova (nem o SDK da Anthropic: Ruling 5.7-11); `go.mod` fica em `go 1.26.0`.
- Gate: `make -C api teste PG_PORTA=58542` com `--- SKIP` = 0; `gofmt -l` e `go vet` limpos. O alvo `teste` usa o contêiner de nome fixo `pg-api-teste`: nunca junto com o gate de outra worktree.
- Commits terminam com `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>` (o modelo que implementa). Código, comentários e mensagens em português com acentuação; frases copiadas das edges ficam como estão (`digite pelo menos 3 letras`, `coordenada invalida`).
- `go` roda em `api/`; `git` na raiz da worktree.

## Review Focus

1. **Gestor limitado a A1 (ou com lista vazia, ou a sessão de "entrar como" aberta por um super) pedindo qualquer leitura** sem filtro, com `?account_id=A2` ou com `contar=1` → nenhuma linha nem contagem de A2. Teste: `TestNadaVazaEntreContas` (Task 11), que percorre TODAS as leituras de `trafego.Montar`.
2. **Escrever para conta que não vê** — decisão da fila de A2, rascunho de A2 ou movido para A2, metas de A2 na régua, `gt_registrar_problemas` com `p_conta` = A2 → `403` e banco intacto (inclusive os problemas de A2 continuam abertos). Testes: `TestDecisoes` (Task 4), `TestRascunhos` (Task 5), `TestRegua` (Task 7), `TestRegistrarProblemas` (Task 8).
3. **Proxies de IA gastando dinheiro de quem não pode** — pessoa sem `meta.gestor`, `contaId` invisível, corpo inválido, PDF falso, acima do limite por pessoa, chave ausente → resposta da edge (ou 429) e a Anthropic de mentira com **0 pedidos**; a chave nunca em resposta nem em log. Testes: `TestSugerirPublico`, `TestLerDocumento`, `TestIASemSegredoNoLog` (Task 10).
4. **SSRF e abuso no `buscar-lugar`** — termo com `/`, `@`, `..`, `%`; redirecionamento do upstream; resposta gigante; rajada → só `GET` em `<Nominatim>/search` ou `/reverse` com o termo na query, redirecionamento não seguido, uma ligação por vez com intervalo, cache. Teste: `TestBuscarLugar` (Task 9).
5. **Régua sem perder metas de outra conta** — duas pessoas salvando contas diferentes ao mesmo tempo → as duas metas ficam; o histórico grava junto (ou nada grava). Testes: `TestReguaNaoPerdeMetaDeOutraConta`, `TestRegua` (Task 7).

---

## Interfaces que este plano consome

(Dos planos; o pré-voo confere cada uma. Nome diferente só de campo/função: use o real em todo o plano. Semântica diferente: **pare e reporte**.)

- **5.0** — `dados.Consulta{Tabela, Alias, SQL, Onde; Filtros []Filtro; Ordens map[string]string; OrdemPadrao, Desempate string}` com `Validar(cat)`/`Handler(b, cat)` (`panic` na montagem se a declaração é inválida; `contar=1` → `X-Total-Count` sob a MESMA regra; teto 1000; parâmetro desconhecido = 400; `left join … on … and {ler:<tabela>:<alias>}`); `dados.Filtro{Param, SQL, Tipo}` (`texto|uuid|inteiro|data|instante|booleano`); `dados.LerCorpo` (`DisallowUnknownFields`, 1 MiB), `dados.Erro`, `dados.Responder`, `dados.ErroDeEscrita`, `dados.Campos`. `autz`: `Producao`, `Escopo{ID, TemPerfil, Ativo, Papel, SuperFicha, Modulos, TodasContas, Contas…}` com `Modulo(m)`, `CarregarEscopo`, `EscopoDo`, `NoContexto`, `ComEscopo`, `Ler/Criar/Editar/EditarNova/Apagar`, `(*Catalogo).Filtro/PodeCriar`, `Filtro.Nega/Juntar`, `Conferir`, `ErrNegado`, `ErrNaoEncontrado`, `ErrDeclaracao`, `Regra`. `auth`: `Ator{ID, Tipo, SuperAdmin, Modulos, ImpersonadorID}`, `AtorDoContexto`, `NoContexto`, `Exigir`, `ExigirModulo` (passa super-admin pela ficha, papel `admin` ou o módulo), `NovoLimitador`/`Limitador{Max, Janela}.Tentar(k)`. `banco.ComUsuario`. `rpc.Funcao{Nome, Params, Retorno, Portao}`, `rpc.Param{Nome, Tipo, Opcional}`, `rpc.Novo`, `rpc.Valor`. `web.Rotas`, `web.FuncoesRPC`, `web.RPCPendentes` (contém `gt_registrar_problemas`), `comPrazo`, `EscritaDoServidor` (150 s), mapas `publicas`/`soSessao` de `rotas_test.go`. `config.Config`/`Segredos()`.
- **5.1** — `testebanco.ComEsquemaDeProducao(t)` (banco novo: compat + migrações + `esquema/*.sql` em ordem de nome); `esquema/01-tabelas-5-1.sql` (`profiles`, `usuarios` vêm das migrações); `dados.Tabela{Nome, Resposta, Autor}` com `Validar`, `Criar`, `Editar`, `Apagar`; `dados.RotaCriar[C]/RotaEditar[C]/RotaApagar` (id de `chi.URLParam(r, "id")`; `C.Validar()`; `{}` = 400; invisível = 404; regra que lê coluna declarada e ausente = `400 "Informe <coluna>."`).
- **5.2 (fundação comum)** — `dados.SoSessaoPropria(frase)`, `dados.FraseEntrarComo`; `testebanco/mundoteste`: `Pessoa{Chave, ID, Email, Papel; Super, Trava, Desativado; Modulos, Contas}` (`Contas` nil = `allowed_accounts` nulo; `[]string{}` = `'{}'`), `Opcoes{Pessoas, Linhas, Impersonadas}`, `Novo(t, o, montar...)`, `Mundo{P, H, Tok}` com `Resposta/Pedir/Um/Rodar`, `Caso{Nome, Quem, Metodo, Caminho, Corpo, Status, Tem, NaoTem, Efeito, Quer}`. **Não usados** (trilha A do 5.2, podem não existir): `Tabela.CriarSoLegivel` (a decisão da fila confere a leitura por conta própria: Ruling 5.7-5). `rpc.Funcao.SoSessaoPropria`: usado; se o 5.2 ainda não o trouxe, a Task 2 o acrescenta com o código EXATO do plano 5.2 (Task 2, Step 3), para o merge posterior ser idêntico.
- **5.6** — `autz.PodeVerConta(e *Escopo, conta string) bool` (e `VeTodasAsContas`); `redes.upsertVisivel(ctx, tx, e, tab, chave, linha, resposta)` em `api/internal/redes/escolhas.go` (a Task 2 o promove a `dados.UpsertVisivel` e o 5.6 passa a chamar o promovido); `GET /redes/contas` (a tela lê as contas por ele). **Nenhuma FK das tabelas gt_* aponta para `accounts`** (em produção `account_id` é texto sem FK): a fatia 5.7 não depende da fatia 5.6; só o código depende do 5.6.

## Interfaces que este plano entrega

- `dados.UpsertVisivel(ctx, tx, cat, e, tab, chave, linha, resposta) ([]byte, error)` (Task 2): o upsert com a semântica da RLS, para qualquer sub-plano (5.8 em diante).
- `rpc.Funcao.ParamConta string` (Task 2): RPC que recebe uma conta da Meta confere `autz.PodeVerConta` antes de rodar.
- `trafego.Montar(r chi.Router, p *pgxpool.Pool)` e `trafego.FuncoesRPC` (Tasks 8 e 11).
- `ia.Nova(chave string) *ia.IA` com `SugerirPublico` e `LerDocumento`; `mapa.Novo() *mapa.Mapa` (`http.Handler`): o `POST /buscar-lugar` serve também à fábrica (5.8 não porta outro).
- D0: `esquema/01-tabelas-5-7.sql` (as 10 tabelas e `fabrica_marcas`, que é do 5.8 e passa a ser declarada aqui: Ruling 5.7-1) e `esquema/03-funcoes-5-7.sql` (gatilho e RPC verbatim).
- `config.Config.IATrafego` (`ANTHROPIC_API_KEY_TRAFEGO`).

## Pré-voo (antes da Task 1)

- [ ] `cd /Users/gabrielgertrudes/Projetos/Trabalho/lavessel/social-dashboard/.claude/worktrees/p5-57 && git status --short && git branch --show-current` → vazio (ou só este plano); `feat/api-go-plano-5-7`.
- [ ] Trazer o 5.6 executado: `git merge --no-edit feat/api-go-plano-5-6`. Conferir:
  ```bash
  grep -c 'func PodeVerConta' api/internal/autz/predicados.go                                   # 1
  grep -n 'func upsertVisivel' api/internal/redes/escolhas.go                                     # 1 linha (a Task 2 o promove)
  grep -c 'func Montar' api/internal/redes/rotas.go                                               # 1
  grep -c 'func SoSessaoPropria\|FraseEntrarComo' api/internal/dados/sessao.go                   # ≥ 2
  grep -c 'func Novo' api/internal/testebanco/mundoteste/mundoteste.go                            # 1
  grep -c 'func ComEsquemaDeProducao' api/internal/testebanco/esquema.go                          # 1
  grep -c 'func RotaCriar\|func RotaEditar\|func RotaApagar' api/internal/dados/escrita.go        # 3
  grep -c '"gt_registrar_problemas"' api/internal/web/rpc_lista.go                                # 1 (em RPCPendentes)
  grep -c 'autz.ComEscopo(p)' api/internal/web/rotas.go                                           # ≥ 2 (domínio e meta-proxy)
  grep -n 'SoSessaoPropria bool' api/internal/rpc/rpc.go                                          # 1 linha OU vazio (ver Task 2)
  grep -n 'gt_\|fabrica_marcas\|interesses_sugeridos' api/internal/testebanco/esquema/*.sql       # vazio
  grep -n 'func init' -A6 api/cmd/api/conferir.go                                                 # o init que força account_id = uuid (Task 11 corrige)
  cd api && go list -deps ./internal/autz | grep -c 'internal/rpc\|internal/dados'                # 0 (sem ciclo: rpc e dados importam autz)
  ```
  Qualquer `0` onde se espera ≥ 1: a dependência não terminou — **pare e reporte**. Tabela `gt_*`, `fabrica_marcas` ou `interesses_sugeridos` já declarada em outra fatia (um 5.8 adiantado): apague-a de lá no commit da Task 1 (Ruling 5.7-1).
- [ ] `go version` → `go1.26`+.
- [ ] Docker no ar, porta livre (`lsof -iTCP:58542 -sTCP:LISTEN` → vazio) e o banco das etapas:
  ```bash
  docker run -d --rm --name pg-plano57 -e POSTGRES_PASSWORD=x -p 127.0.0.1:58542:5432 postgres:17
  until docker exec pg-plano57 pg_isready -h 127.0.0.1 -U postgres >/dev/null 2>&1; do sleep 1; done
  export TEST_DATABASE_URL='postgres://postgres:x@localhost:58542/postgres?sslmode=disable'
  ```
- [ ] Linha de base: `cd api && go test ./... && go test -v ./... 2>&1 | grep -c -- '--- SKIP'` → tudo `ok` e `0`.

## Estrutura de arquivos

```
api/internal/testebanco/esquema/01-tabelas-5-7.sql      # as 10 tabelas + fabrica_marcas (fonte por bloco)
api/internal/testebanco/esquema/03-funcoes-5-7.sql      # gt_rascunho_toca_updated_at + gatilho e gt_registrar_problemas VERBATIM
api/internal/testebanco/esquema_trafego_test.go         # TestFatiaDoTrafego
api/internal/dados/upsert.go           (+ upsert_test.go) # UpsertVisivel (promovido do 5.6)
api/internal/redes/escolhas.go                           # (mod.) chama dados.UpsertVisivel; o local sai
api/internal/rpc/rpc.go                (+ rpc_conta_test.go) # Funcao.ParamConta (+ SoSessaoPropria se faltar)
api/internal/trafego/trafego.go                          # doc, soSessaoPropria, deve, filtroConta, ajudantes de validação, agora
api/internal/trafego/mundo_test.go, trafego_test.go      # pessoas, linhas, foto; TestMundoDoTrafego
api/internal/trafego/fila.go           (+ _test)         # análises de orçamento e de anúncio; decisões (GET, POST)
api/internal/trafego/rascunhos.go      (+ _test)         # GET/POST/PATCH/DELETE rascunhos
api/internal/trafego/escolhas.go       (+ _test)         # config de métricas e objetivos por interação
api/internal/trafego/regua.go          (+ _test)         # régua (GET, PUT atômico com histórico)
api/internal/trafego/interesses.go     (+ _test)         # interesses sugeridos
api/internal/trafego/problemas.go      (+ _test)         # GestorDeTrafego, FuncoesRPC (gt_registrar_problemas)
api/internal/trafego/rotas.go          (+ rotas_test.go) # Montar; varreduras de vazamento e de impersonado
api/internal/ia/claude.go, ia.go, prompts.go (+ ia_test.go, prompts_test.go) # cliente mínimo e as duas rotas
api/internal/mapa/mapa.go              (+ mapa_test.go)  # POST /buscar-lugar
api/internal/config/config.go          (+ config_test.go) # IATrafego (ANTHROPIC_API_KEY_TRAFEGO)
api/internal/web/rotas.go, rpc_lista.go, rotas_test.go   # montagem, FuncoesRPC, prazos, soSessao
api/cmd/api/conferir.go                (+ conferir_test.go) # colunas, tipos, únicos, função; init respeita tipo declarado
docs/migracao-go/NOTAS-DA-IMPLANTACAO.md                 # seção do 5.7
```

**Não toca:** `esquema/gerar-gatilhos.mjs` nem `esquema/02-gatilhos.sql` (o único gatilho das 10 tabelas vai verbatim em `03-funcoes-5-7.sql` com `create or replace trigger`: Ruling 5.7-1); `autz` (nenhum átomo novo: as 24 policies já compilam; o portão da RPC mora em `trafego`); `meta` e o `meta-proxy`.

## Tarefas

| # | Task | Revisor | Depende de |
|---|---|---|---|
| 1 | D0: fatia 5.7 (10 tabelas + `fabrica_marcas`; gatilho e RPC verbatim) | **opus** (dados: tudo é provado contra isto) | 5.1 T1 |
| 2 | Peças comuns: `dados.UpsertVisivel` (promovido do 5.6) e `rpc.Funcao.ParamConta` (+ `SoSessaoPropria` se faltar) | **opus** (autorização compartilhada) | 5.6 |
| 3 | `trafego`: fundação (pacote, ajudantes, mundo com contas A1/A2, foto) | sonnet | 1 |
| 4 | Fila: análises de orçamento e de anúncio, decisões (`GET` e `POST` que só cria o que se vê) | **opus** (escopo por conta; escrita) | 3 |
| 5 | Rascunhos de campanha (`GET/POST/PATCH/DELETE`, dono `criado_por`) | **opus** (dono, restritiva em ALL) | 3 |
| 6 | Escolhas: configuração de métricas e objetivos por interação (upsert e apagar) | **opus** (escrita por upsert) | 2, 3 |
| 7 | Régua (`GET` e `PUT` atômico com histórico, sem perder meta de outra conta) e interesses sugeridos | **opus** (concorrência; leitura com junção) | 3 |
| 8 | RPC `gt_registrar_problemas`: portão igual à função, conta conferida, impersonado | **opus** (SECURITY DEFINER sem `pode_ver_conta`) | 2, 3 |
| 9 | `mapa`: `POST /buscar-lugar` (Nominatim fixo, cache, uma ligação por segundo, limite) | **opus** (SSRF) | — |
| 10 | `ia`: `POST /sugerir-publico-ia` e `POST /ler-documento` (chave em variável de ambiente, limite, PDF conferido) | **opus** (custo de IA, segredo) | — (5.6 só pelo `autz.PodeVerConta`) |
| 11 | Montagem, varreduras (vazamento entre contas, impersonado), prazos, `conferir` e notas | **opus** (fronteira) | 4–10 |

---

### Task 1: D0 — fatia 5.7 do esquema de produção nos testes

**Revisor:** opus. **Depende de:** 5.1 Task 1 (carregador, `usuarios`, `profiles`).

**(a) Contrato**
- `esquema/01-tabelas-5-7.sql` (abaixo): as 10 tabelas da linha 5.7 e `fabrica_marcas` (dona: 5.8; declarada aqui porque `interesses_sugeridos` tem FK para ela e `01-tabelas-5-7` carrega ANTES de `01-tabelas-5-8`: Ruling 5.7-1). Cada bloco com a fonte; o que não tem DDL no repositório leva `presumido` e é conferido pelo `api worker conferir` (Task 11). FKs de `auth.users` viram `public.usuarios` (como no dump limpo). Nenhuma FK para `accounts` (produção não tem).
- `esquema/03-funcoes-5-7.sql`: `gt_rascunho_toca_updated_at` (`levantamento/02-funções.csv:1201-1208`) e o gatilho `gt_rascunho_updated_at` (`03-triggers.csv:26`; `BEFORE UPDATE … FOR EACH ROW`, como na migration `2026-08-03-gt-rascunhos-de-campanha.sql`), e `gt_registrar_problemas` (`02-funções.csv:1210-1286`), **verbatim** entre `CREATE` e `$function$`. `create or replace trigger` (Postgres 14+): se um dia o gerador também emitir este gatilho em `02-gatilhos.sql`, a recriação aqui é idempotente.
- Os únicos são os alvos de `ON CONFLICT` da tela (`gt_config_metricas(balde)`, `gt_objetivo_interacao(alvo_id)`), da RPC (`gt_problemas_meta(ad_id, codigo)`) e do robô `sugerir-interesses` (`interesses_sugeridos(marca_id, objetivo)`).

**(b) Testes de aceitação** (`TestFatiaDoTrafego`, `esquema_trafego_test.go`, num `testebanco.ComEsquemaDeProducao`)
- As 11 tabelas existem (`to_regclass`).
- Um gatilho só nelas: `select string_agg(g.tgname, ',') from pg_trigger g join pg_class c on c.oid = g.tgrelid where not g.tgisinternal and c.relname = any(<as 11>)` = `gt_rascunho_updated_at`; e ele age: `update gt_campanhas_rascunho set nome = 'x'` faz `updated_at` passar o valor inserido (`'2020-01-01'`).
- `criado_por` tem `default auth.uid()`: dentro de `banco.ComUsuario(<pessoa>)`, `insert … (account_id) values ('A1') returning criado_por::text` = a pessoa.
- Únicos: para cada `(tabela, chave, linha)` de `alvos` (código abaixo), `insert … on conflict (<chave>) do nothing` duas vezes deixa 1 linha.
- Checks (cada um `23514`): `gt_fila_decisoes.escopo = 'outro'`; `gt_fila_decisoes.decisao = 'talvez'`; `gt_campanhas_rascunho.status = 'x'`; `gt_ponderada_config.id = 2`; `gt_objetivo_interacao.interacao = 'likes'`; `gt_objetivo_interacao.nivel = 'conta'`.
- FKs (`23503`): `interesses_sugeridos` com `marca_id` inexistente; `gt_campanhas_rascunho` com `criado_por` inexistente. `delete from fabrica_marcas` leva junto os `interesses_sugeridos` dela (`on delete cascade`).
- `gt_registrar_problemas` verbatim: `pg_get_functiondef('public.gt_registrar_problemas(text,jsonb)'::regprocedure)` contém `SECURITY DEFINER`, `service_role` e `distinct on (ad_id, codigo)`; chamada como pessoa com `features '{meta.gestor}'` com `p_conta 'A1'` e um item → `1` e a linha existe com `account_id = 'A1'`; como pessoa `viewer` sem módulo → `P0001` com `Sem permissao na Gestao de Trafego.`.
- Mutações que têm de reprovar: apagar `03-funcoes-5-7.sql` (gatilho e função somem); tirar o `unique (marca_id, objetivo)`; trocar `account_id text` por `uuid` em `gt_problemas_meta` (a RPC grava `p_conta` texto: `'A1'` não converte).

**(c) Arquivos:** Create `api/internal/testebanco/esquema/01-tabelas-5-7.sql`, `api/internal/testebanco/esquema/03-funcoes-5-7.sql`, `api/internal/testebanco/esquema_trafego_test.go`.

**(d) Dependências:** 5.1 Task 1; `banco.ComUsuario`.

- [ ] **Step 1: A DDL da fatia.** Crie `api/internal/testebanco/esquema/01-tabelas-5-7.sql`:

```sql
-- FATIA 5.7 do esquema de produção para os testes (D0 reconstruído: Rulings 5.1-1, 5.6-1 e 5.7-1).
-- Carrega depois de 01-tabelas-5-1…5-6 (ordem de nome) e antes de 01-tabelas-5-8. As funções e o
-- único gatilho vêm em 03-funcoes-5-7.sql. Nenhuma FK para accounts: em produção account_id destas
-- tabelas é TEXTO sem FK (as policies fazem pode_ver_conta(account_id) sem cast). FKs de auth.users
-- viram public.usuarios (ops/migracao/limpar-dump.mjs:64). "presumido" = sem DDL no repositório;
-- conferido pelo `api worker conferir` no banco restaurado.

-- db/migrations/2026-07-02-gt-config-metricas.sql:1-5
create table public.gt_config_metricas (
  balde      text primary key,
  metricas   jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

-- db/migrations/2026-07-02-gt-budget-analises.sql:1-14; impactos: presumido jsonb (o robô grava um
-- objeto: coletor/budget-ia.mjs:508, 1039; a tela o lê em tela-de-gestao-trafego.vue:1019)
create table public.gt_budget_analises (
  campaign_id              text primary key,
  account_id               text not null,
  objetivo                 text,
  effective_status         text,
  budget_atual_centavos    integer,
  budget_sugerido_centavos integer,
  veredito                 text,
  justificativa            text,
  impacto_estimado         text,
  impactos                 jsonb,
  modelo                   text not null default 'claude-opus-4-8',
  gerado_em                timestamptz not null default now(),
  valida_ate               timestamptz
);

-- db/migrations/2026-07-02-gt-ad-analises.sql:1-10
create table public.gt_ad_analises (
  ad_id         text primary key,
  campaign_id   text,
  account_id    text,
  veredito      text,
  justificativa text,
  modelo        text not null default 'claude-opus-4-8',
  gerado_em     timestamptz not null default now(),
  valida_ate    timestamptz
);

-- db/migrations/2026-07-29-fila-decisoes.sql:1-15 + escopo (2026-07-29-fila-escopo-criativos.sql e o
-- check de 2026-08-12-fila-escopo-saude.sql)
create table public.gt_fila_decisoes (
  id                       bigserial primary key,
  campaign_id              text not null,
  account_id               text,
  veredito                 text not null,
  budget_atual_centavos    integer,
  budget_sugerido_centavos integer,
  analise_gerada_em        timestamptz,
  decisao                  text not null check (decisao in ('aprovada', 'recusada')),
  decidido_em              timestamptz not null default now(),
  decidido_por             uuid,
  silenciar_ate            timestamptz,
  aplicado                 jsonb not null default '[]'::jsonb,
  erro                     text,
  escopo                   text not null default 'orcamento'
                           constraint gt_fila_decisoes_escopo_check check (escopo in ('orcamento', 'criativos', 'saude'))
);

-- supabase/migrations/20260728_ponderada_config.sql:1-8 + metas_por_conta (2026-07-29-regua-metas-por-conta.sql);
-- limiares_resultado: presumido jsonb anulável (lido em tela-de-gestao-trafego.vue:1563 e regua.js:57)
create table public.gt_ponderada_config (
  id                 int primary key default 1 check (id = 1),
  pesos              jsonb not null default '{"curtidas":1,"comentarios":10,"salvamentos":30,"compartilhamentos":20}'::jsonb,
  metas              jsonb not null default '{"engajamento":0.15,"reconhecimento":0.15}'::jsonb,
  limiares           jsonb not null default '{"escalarForte":0.8,"dentroMeta":1.0,"manter":1.3}'::jsonb,
  updated_at         timestamptz not null default now(),
  updated_by         uuid,
  metas_por_conta    jsonb not null default '{}'::jsonb,
  limiares_resultado jsonb
);

-- supabase/migrations/20260728_ponderada_config.sql:10-16
create table public.gt_ponderada_config_log (
  id         bigserial primary key,
  mudou_em   timestamptz not null default now(),
  mudou_quem uuid,
  antes      jsonb,
  depois     jsonb
);

-- supabase/migrations/20260728_objetivo_por_interacao.sql:1-8
create table public.gt_objetivo_interacao (
  alvo_id    text primary key,
  nivel      text not null check (nivel in ('campanha','anuncio')),
  interacao  text not null check (interacao in ('curtidas','comentarios','salvamentos','compartilhamentos')),
  conta_id   uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid
);

-- db/migrations/2026-08-03-gt-rascunhos-de-campanha.sql:1-20 (criado_por: auth.users → usuarios)
create table public.gt_campanhas_rascunho (
  id          uuid primary key default gen_random_uuid(),
  account_id  text not null,
  criado_por  uuid not null references public.usuarios(id) default auth.uid(),
  estado      jsonb not null default '{}'::jsonb,
  passo       int not null default 0,
  nome        text not null default '',
  tipo        text not null default '',
  status      text not null default 'rascunho' check (status in ('rascunho', 'criada', 'falhou')),
  resultado   jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- db/migrations/2026-08-17-guardar-o-motivo-da-meta.sql:1-18
create table public.gt_problemas_meta (
  ad_id         text        not null,
  codigo        integer     not null,
  account_id    text,
  campaign_id   text,
  conta_nome    text,
  campanha_nome text,
  ad_nome       text,
  titulo        text,
  detalhe       text,
  nivel         text,
  grave         boolean     not null default false,
  primeira_vez  timestamptz not null default now(),
  ultima_vez    timestamptz not null default now(),
  resolvido_em  timestamptz,
  primary key (ad_id, codigo)
);

-- DONA: fatia 5.8 (Fábrica). Declarada aqui porque interesses_sugeridos (5.7) tem FK para ela e esta
-- fatia carrega antes da 5.8 (Ruling 5.7-1): a fatia 5.8 NÃO a redeclara; coluna que faltar entra lá
-- com `alter table public.fabrica_marcas add column if not exists …`.
-- db/migrations/018_fabrica_marcas_lojas.sql:2-12 + segmento (2026-07-31-marca-segmento.sql:17-18)
-- + termos_produto (2026-08-01-interesses-termos-de-produto.sql:31-32)
create table public.fabrica_marcas (
  id               uuid primary key default gen_random_uuid(),
  nome             text not null,
  caption_template text not null default 'Ofertas {marca} · chame a gente no WhatsApp 💬',
  ad_account       text not null,
  page_id          text not null,
  ig_id            text not null,
  account_id       text not null,
  ativo            boolean not null default true,
  created_at       timestamptz not null default now(),
  segmento         text,
  termos_produto   text[] not null default '{}'
);

-- db/migrations/2026-07-31-interesses-sugeridos.sql:1-11
create table public.interesses_sugeridos (
  id        uuid primary key default gen_random_uuid(),
  marca_id  uuid not null references public.fabrica_marcas(id) on delete cascade,
  objetivo  text not null,
  itens     jsonb not null default '[]'::jsonb,
  propostos int not null default 0,
  validos   int not null default 0,
  modelo    text,
  gerado_em timestamptz not null default now(),
  unique (marca_id, objetivo)
);
```

- [ ] **Step 2: As funções.** Crie `api/internal/testebanco/esquema/03-funcoes-5-7.sql` (os corpos são os de produção, sem mudar um caractere entre `CREATE` e `$function$`):

```sql
-- VERBATIM de levantamento/02-funções.csv:1201-1208 e 1210-1286; o gatilho de 03-triggers.csv:26 com a
-- orientação da migration 2026-08-03-gt-rascunhos-de-campanha.sql (BEFORE UPDATE … FOR EACH ROW).
-- `create or replace trigger`: se o gerador um dia também emitir este gatilho em 02-gatilhos.sql
-- (que carrega antes), a recriação aqui é a mesma (Ruling 5.7-1).
CREATE OR REPLACE FUNCTION public.gt_rascunho_toca_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  new.updated_at = now();
  return new;
end $function$;

create or replace trigger gt_rascunho_updated_at BEFORE UPDATE on public.gt_campanhas_rascunho
  for each row EXECUTE FUNCTION gt_rascunho_toca_updated_at();

CREATE OR REPLACE FUNCTION public.gt_registrar_problemas(p_conta text, p_itens jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_quantos integer := 0;
  v_papel text := coalesce(
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
    ''
  );
begin
  if v_papel <> 'service_role' and not exists (
    select 1 from public.profiles p
     where p.id = auth.uid()
       and (p.role = 'admin' or 'meta.gestor' = any (p.features))
  ) then
    raise exception 'Sem permissao na Gestao de Trafego.';
  end if;

  if p_conta is null or p_conta = '' then
    raise exception 'Falta dizer de qual conta e a lista.';
  end if;

  with bruto as (
    select
      x.ad_id, x.codigo, x.campaign_id, x.conta_nome, x.campanha_nome,
      x.ad_nome, x.titulo, x.detalhe, x.nivel, coalesce(x.grave, false) as grave,
      row_number() over () as ordem
    from jsonb_to_recordset(coalesce(p_itens, '[]'::jsonb)) as x(
      ad_id text, codigo integer, campaign_id text, conta_nome text,
      campanha_nome text, ad_nome text, titulo text, detalhe text,
      nivel text, grave boolean
    )
    where x.ad_id is not null and x.codigo is not null
  ),
  entrada as (
    select distinct on (ad_id, codigo) *
      from bruto
     order by ad_id, codigo, ordem
  )
  insert into public.gt_problemas_meta as g (
    ad_id, codigo, account_id, campaign_id, conta_nome, campanha_nome,
    ad_nome, titulo, detalhe, nivel, grave, primeira_vez, ultima_vez, resolvido_em
  )
  select
    e.ad_id, e.codigo, p_conta, e.campaign_id, e.conta_nome, e.campanha_nome,
    e.ad_nome, e.titulo, e.detalhe, e.nivel, e.grave, now(), now(), null
  from entrada e
  on conflict (ad_id, codigo) do update set
    ultima_vez    = now(),
    resolvido_em  = null,
    account_id    = excluded.account_id,
    campaign_id   = coalesce(excluded.campaign_id, g.campaign_id),
    conta_nome    = coalesce(nullif(excluded.conta_nome, ''), g.conta_nome),
    campanha_nome = coalesce(nullif(excluded.campanha_nome, ''), g.campanha_nome),
    ad_nome       = coalesce(nullif(excluded.ad_nome, ''), g.ad_nome),
    titulo        = coalesce(nullif(excluded.titulo, ''), g.titulo),
    detalhe       = coalesce(nullif(excluded.detalhe, ''), g.detalhe),
    nivel         = coalesce(nullif(excluded.nivel, ''), g.nivel),
    grave         = excluded.grave;

  get diagnostics v_quantos = row_count;

  update public.gt_problemas_meta g
     set resolvido_em = now()
   where g.account_id = p_conta
     and g.resolvido_em is null
     and not exists (
       select 1
         from jsonb_to_recordset(coalesce(p_itens, '[]'::jsonb)) as x(ad_id text, codigo integer)
        where x.ad_id = g.ad_id and x.codigo = g.codigo
     );

  return v_quantos;
end $function$;
```

Confira o verbatim com `diff`: `sed -n 1210,1286p <levantamento>/02-funções.csv | sed '1s/^gt_registrar_problemas,"p_conta text, p_itens jsonb",t,"//'` contra o bloco acima (só o `;` final e o fim da aspa do CSV diferem).

- [ ] **Step 3: O teste.** `esquema_trafego_test.go` com `TestFatiaDoTrafego` (contrato (b)); a lista de alvos:

```go
// alvos: os ON CONFLICT da tela (config de métricas, objetivos), da RPC e do robô sugerir-interesses.
var alvos = []struct{ tabela, chave, linha string }{
	{"gt_config_metricas", "balde", `(balde) values ('engajamento')`},
	{"gt_objetivo_interacao", "alvo_id", `(alvo_id, nivel, interacao) values ('9001', 'campanha', 'curtidas')`},
	{"gt_problemas_meta", "ad_id, codigo", `(ad_id, codigo, account_id) values ('7001', 1, 'A1')`},
	{"interesses_sugeridos", "marca_id, objetivo", `(marca_id, objetivo) values ('` + marcaTeste + `', 'seguidores')`},
}
```

(`marcaTeste` é uma `fabrica_marcas` inserida no começo do teste.) Run: `go test -count=1 -run TestFatiaDoTrafego ./internal/testebanco/` → FAIL antes dos Steps 1–2; PASS depois. Aplique as mutações de (b), uma por vez, e veja reprovar.

- [ ] **Step 4: Commit** `feat(api): D0 — fatia 5.7 (gestão de tráfego e fabrica_marcas) com o gatilho e gt_registrar_problemas verbatim` (+ `Co-Authored-By`).

---

### Task 2: Peças comuns — `dados.UpsertVisivel` e `rpc.Funcao.ParamConta`

**Revisor:** opus. **Depende de:** 5.6 executado (o `redes.upsertVisivel` a promover).

**(a) Contrato**
- `dados.UpsertVisivel` = o `redes.upsertVisivel` do 5.6 (Rulings 5.6-7 e 5.6-16) com o catálogo por parâmetro e duas guardas a mais (escopo nulo = negado; linha só com a chave = `ErrDeclaracao`). `redes/escolhas.go` passa a chamar `dados.UpsertVisivel(ctx, tx, autz.Producao, e, …)` e o local sai: os testes do 5.6 (`TestMetas`, `TestFiltrosDeCampanha`, as varreduras) continuam verdes sem mudança (Ruling 5.7-6).
- `rpc.Funcao.ParamConta`: nome de um parâmetro `text` da função que diz de qual conta da Meta ela cuida. Depois do portão e do `SoSessaoPropria`, com o corpo lido: valor texto → tem de passar em `autz.PodeVerConta(e, valor)`, senão `403 {"error":"sem_permissao"}` SEM a função rodar; `null` ou ausente (se opcional) → segue (a função decide); outro tipo → `400 pedido_invalido "<param> deve ser texto"`. `rpc.Novo` recusa `ParamConta` que não nomeie um parâmetro `text` declarado (a API não sobe). Ruling 5.7-10.
- Se o pré-voo mostrou `SoSessaoPropria bool` ausente em `rpc.go`: acrescente-o com o código EXATO do plano 5.2 (Task 2, Step 3; reproduzido abaixo) e o teste `TestRPCSoSessaoPropria` de lá. Se já existe, não mexa.

```go
package dados

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"maps"
	"slices"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/rbv-co/social-dashboard/api/internal/autz"
)

// UpsertVisivel: INSERT … ON CONFLICT DO UPDATE com a semântica que o PostgREST tinha sob a RLS de
// produção (a tela fazia .upsert / resolution=merge-duplicates): (1) a linha nova passa no WITH CHECK de
// criar (PodeCriar) E na regra de LER e de editar sobre ela (EditarNova: num upsert o Postgres confere as
// policies de SELECT na linha proposta — é isso que barrava a conta invisível); (2) a linha que já existe
// só muda se quem pede a lê e a edita (WHERE do DO UPDATE). Fora disso, autz.ErrNegado — igual para
// "existe e é de outra conta" e "não existe e não se veria" (sem oráculo). `linha` é o MESMO mapa que vai
// às conferências e ao INSERT (jsonb_populate_record); tabela, chave e resposta (lista de colunas, sem
// alias) são da rota, nunca do pedido. Rode na tx de banco.ComUsuario de quem pede.
// Promovido de redes.upsertVisivel (5.6, Rulings 5.6-7 e 5.6-16) no 5.7 (Ruling 5.7-6).
func UpsertVisivel(ctx context.Context, tx pgx.Tx, cat *autz.Catalogo, e *autz.Escopo, tab string, chave []string,
	linha map[string]any, resposta string) ([]byte, error) {
	if e == nil {
		return nil, autz.ErrNegado
	}
	if err := cat.PodeCriar(ctx, tx, e, tab, linha); err != nil {
		return nil, err
	}
	fn, err := cat.Filtro(e, tab, autz.EditarNova, "autz_nova")
	if err != nil {
		return nil, err
	}
	if ok, err := autz.Conferir(ctx, tx, fn, tab, linha); err != nil || !ok {
		if err == nil {
			err = autz.ErrNegado
		}
		return nil, err
	}
	fl, err := cat.Filtro(e, tab, autz.Ler, tab)
	if err != nil {
		return nil, err
	}
	fe, err := cat.Filtro(e, tab, autz.Editar, tab)
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
	if len(sets) == 0 {
		return nil, fmt.Errorf("%w: upsert de %s sem coluna fora da chave", autz.ErrDeclaracao, tab)
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
```

Em `api/internal/rpc/rpc.go`, na struct `Funcao` (depois de `Portao` e, se existir, de `SoSessaoPropria`):

```go
	// ParamConta: o parâmetro (text) que diz de qual conta da Meta a função cuida. Valor texto tem de
	// ser de uma conta que quem pede vê (autz.PodeVerConta, a regra das restritivas so_contas_permitidas):
	// senão 403 sem a função rodar. null segue (a função decide). Ruling 5.7-10: função SECURITY DEFINER
	// que grava por conta não passava pela restritiva de produção.
	ParamConta string
```

em `Novo`, logo depois do laço que confere os parâmetros:

```go
		if f.ParamConta != "" && !slices.ContainsFunc(f.Params, func(p Param) bool { return p.Nome == f.ParamConta && p.Tipo == "text" }) {
			return nil, fmt.Errorf("rpc %s: ParamConta %q não é um parâmetro text declarado", f.Nome, f.ParamConta)
		}
```

em `ServeHTTP`: dentro do laço `for _, pr := range f.Params`, logo depois de `delete(corpo, pr.Nome)`, guarde o valor (`if pr.Nome == f.ParamConta { conta, temConta = v, tem }`, com `var conta json.RawMessage; var temConta bool` declarados antes do laço); e, logo depois do bloco `if len(corpo) > 0 { … parâmetro desconhecido … }`:

```go
	if f.ParamConta != "" && temConta && strings.TrimSpace(string(conta)) != "null" {
		var c string
		if json.Unmarshal(conta, &c) != nil {
			dados.Erro(w, http.StatusBadRequest, "pedido_invalido", f.ParamConta+" deve ser texto")
			return
		}
		if !autz.PodeVerConta(e, c) {
			dados.Erro(w, http.StatusForbidden, "sem_permissao", "")
			return
		}
	}
```

Se faltar `SoSessaoPropria` (pré-voo): na struct, depois de `Portao`, o campo do 5.2 e, em `ServeHTTP`, logo depois do `if !f.Portao(e) { … }`:

```go
	// SoSessaoPropria: a função GRAVA. Sessão de "entrar como" recebe 403 sem a função rodar
	// (Ruling 5.2-3); função que só lê fica aberta a quem entrou como (ver o que a pessoa vê).
	SoSessaoPropria bool
```
```go
	if f.SoSessaoPropria && a.ImpersonadorID != nil {
		dados.Erro(w, http.StatusForbidden, "sem_permissao", dados.FraseEntrarComo)
		return
	}
```

**(b) Testes de aceitação**
- `TestUpsertVisivel` (`dados/upsert_test.go`; catálogo de teste e tabela `escolha` abaixo; escopo `e` = ativo, com perfil, `Contas: [coisaA1]`):
  ```go
  const catalogoDeUpsert = `[
   {"tabela":"escolha","nome":"le","tipo":"permissive","comando":"select","papeis":["authenticated"],"using":"true","withCheck":null},
   {"tabela":"escolha","nome":"so_contas","tipo":"restrictive","comando":"select","papeis":["authenticated"],"using":"pode_ver_conta(account_id)","withCheck":null},
   {"tabela":"escolha","nome":"grava","tipo":"permissive","comando":"all","papeis":["authenticated"],"using":"true","withCheck":"true"}
  ]`
  // tabela: create table escolha (account_id uuid primary key, valor int); linha de coisaA2 (valor 20) já existe
  ```
  casos: A1 nova `{account_id: A1, valor: 1}` → corpo `{"account_id":"<A1>","valor":1}`; A1 de novo com `valor 2` → `valor 2` gravado; A2 (existe, invisível) `valor 99` → `autz.ErrNegado` e continua `20`; `aaaaaaaa-0000-4000-a000-000000000003` (não existe, invisível) → `ErrNegado` e NÃO criada; `e = nil` → `ErrNegado`; linha só com `account_id` → `errors.Is(err, autz.ErrDeclaracao)`. Cada caso numa transação própria (`p.Begin`), confirmada no fim.
- `TestRPCParamConta` (`rpc/rpc_conta_test.go`, com `montarCom` e `chamar` de `rpc_test.go`; a função `conta_marcar(p_conta text, p_n integer default 0) returns void` grava `p_conta` em `marca`, criada no teste; ator e escopo com o mesmo `quemPede`, escopo ativo e com perfil): escopo com `Contas: ["A1"]` → `{"p_conta":"A1"}` 204 e 1 marca; `{"p_conta":"A2"}` 403 `sem_permissao` e 0 marcas novas; `{"p_conta":5}` 400 "p_conta deve ser texto"; `{"p_conta":null}` 204 (a função decide); escopo `TodasContas` → `"A2"` 204. `rpc.Novo` com `ParamConta: "p_x"` (não declarado) ou apontando para `p_n` (integer) → erro.
- Os testes existentes de `dados`, `rpc` e `redes` continuam verdes (`TestMetas` e `TestFiltrosDeCampanha` do 5.6 provam a promoção).
- Mutações que têm de reprovar: tirar a conferência `EditarNova` de `UpsertVisivel` (o caso "não existe, invisível" cria a linha); tirar o `if !autz.PodeVerConta` (A2 vira 204 e a marca é gravada); tirar a recusa de tipo (o `5` deixa de ser 400).

**(c) Arquivos:** Create `api/internal/dados/upsert.go`, `api/internal/dados/upsert_test.go`, `api/internal/rpc/rpc_conta_test.go`; Modify `api/internal/rpc/rpc.go`, `api/internal/redes/escolhas.go` (troca as duas chamadas, apaga `upsertVisivel` e os imports que ficarem sem uso).

**(d) Dependências:** 5.6 (`redes.upsertVisivel`, `autz.PodeVerConta`); `autz.Conferir/Filtro/PodeCriar`.

- [ ] **Step 1:** Testes; ver falhar (compilação). - [ ] **Step 2:** Implementar (código de (a)). - [ ] **Step 3:** `gofmt -l ./internal && go vet ./internal/dados/ ./internal/rpc/ ./internal/redes/ && go test -count=1 ./internal/dados/ ./internal/rpc/ ./internal/redes/` PASS; mutações reprovam. - [ ] **Step 4:** Commit `feat(api): upsert com a semântica da RLS em dados (promovido do 5.6) e RPC que confere a conta da Meta antes de rodar` (+ `Co-Authored-By`).

---

### Task 3: `trafego` — fundação (pacote, ajudantes, mundo)

**Revisor:** sonnet. **Depende de:** 1; `mundoteste` e `dados.SoSessaoPropria` (5.2, vindos com o 5.6).

**(a) Contrato**
- `api/internal/trafego/trafego.go` (abaixo): doc do pacote, `soSessaoPropria`, `deve`, `filtroConta` (texto: `account_id` das gt_* é `text`), `agora`, `escopoOu500`, `reUUID`, `reIDDaMeta` e os ajudantes de validação de `json.RawMessage` que as Tasks 4–7 usam (moram aqui para elas andarem em paralelo).
- Teste (interno): `novoMundo(t, montar...) *mundoteste.Mundo` com a fatia da Task 1, as pessoas, as linhas e a foto abaixo; sessão `impersonado` = a de `gestorA1` aberta por `superA1`.

```go
// Package trafego: as rotas do sub-plano 5.7 — a Gestão de Tráfego: a fila (análises de orçamento e de
// anúncio do robô, decisões), os rascunhos do assistente de campanha, a configuração de métricas, os
// objetivos por interação, a régua da métrica ponderada (com histórico), as sugestões de interesse e a
// RPC gt_registrar_problemas. Regra de toda tabela = catálogo de produção (autz.Producao: "gestor" é papel
// admin ou 'meta.gestor' em features; a restritiva pode_ver_conta em 5 das 10). Escrita em
// banco.ComUsuario; "entrar como" só lê. Os proxies de IA moram em internal/ia e o de mapa em
// internal/mapa (Ruling 5.7-2).
package trafego

import (
	"encoding/json"
	"net/http"
	"regexp"
	"slices"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/rbv-co/social-dashboard/api/internal/autz"
	"github.com/rbv-co/social-dashboard/api/internal/dados"
)

var soSessaoPropria = dados.SoSessaoPropria(dados.FraseEntrarComo)

// deve: declaração de rota errada (Consulta ou Tabela fora do catálogo) faz a API não subir.
func deve(err error) {
	if err != nil {
		panic(err)
	}
}

// filtroConta: account_id das gt_* é TEXTO (a policy é pode_ver_conta(account_id), sem cast). Toda
// leitura com a restritiva declara este filtro e projeta account_id (Ruling 5.7-4): é por ele que a
// varredura da Task 11 acha vazamento.
var filtroConta = dados.Filtro{Param: "account_id", SQL: "t.account_id = @account_id::text", Tipo: "texto"}

var (
	reUUID     = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)
	reIDDaMeta = regexp.MustCompile(`^[0-9]{1,30}$`) // id de campanha/anúncio na Meta
)

// agora: relógio do servidor para updated_at (o do navegador era falsificável: Ruling 5.6-13).
func agora() string { return time.Now().UTC().Format(time.RFC3339Nano) }

// escopoOu500: rota montada fora de autz.ComEscopo é defeito de montagem (nada gravado).
func escopoOu500(w http.ResponseWriter, r *http.Request) *autz.Escopo {
	e := autz.EscopoDo(r.Context())
	if e == nil {
		dados.Erro(w, http.StatusInternalServerError, "erro_interno", "")
	}
	return e
}

// texto: o valor JSON é texto? (null, número, objeto: não)
func texto(v json.RawMessage) (string, bool) {
	var s string
	if len(v) == 0 || v[0] != '"' || json.Unmarshal(v, &s) != nil {
		return "", false
	}
	return s, true
}

func textoEm(v json.RawMessage, opcoes ...string) bool {
	s, ok := texto(v)
	return ok && slices.Contains(opcoes, s)
}

func casa(v json.RawMessage, re *regexp.Regexp) bool {
	s, ok := texto(v)
	return ok && re.MatchString(s)
}

// textoAte: texto de até max caracteres; vazio (ou só espaço) só se vazioPode.
func textoAte(v json.RawMessage, max int, vazioPode bool) bool {
	s, ok := texto(v)
	return ok && utf8.RuneCountInString(s) <= max && (vazioPode || strings.TrimSpace(s) != "")
}

func objeto(v json.RawMessage) bool {
	var m map[string]json.RawMessage
	return len(v) > 0 && v[0] == '{' && json.Unmarshal(v, &m) == nil
}

func nulo(v json.RawMessage) bool { return strings.TrimSpace(string(v)) == "null" }

func inteiroEntre(v json.RawMessage, min, max int64) bool {
	var n int64
	return json.Unmarshal(v, &n) == nil && n >= min && n <= max
}
```

`api/internal/trafego/mundo_test.go`:

```go
package trafego

import (
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/testebanco/mundoteste"
)

const (
	A1 = "a5700000-0000-4000-a000-0000000000a1" // 'Vessel'
	A2 = "a5700000-0000-4000-a000-0000000000a2" // 'Mantova'
	A3 = "a5700000-0000-4000-a000-0000000000a3" // conta que ninguém tem

	M1 = "a5720000-0000-4000-a000-0000000000b1" // marca da A1
	M2 = "a5720000-0000-4000-a000-0000000000b2" // marca da A2

	R1 = "a5730000-0000-4000-a000-0000000000c1" // rascunho de A1, de gestorTodas
	R2 = "a5730000-0000-4000-a000-0000000000c2" // rascunho de A1, de gestorA1
	R3 = "a5730000-0000-4000-a000-0000000000c3" // rascunho de A2, de gestorTodas

	idGestorTodas   = "a5710000-0000-4000-a000-000000000001"
	idGestorA1      = "a5710000-0000-4000-a000-000000000002"
	idGestorNenhuma = "a5710000-0000-4000-a000-000000000003"
	idAdminA1       = "a5710000-0000-4000-a000-000000000004"
	idSuperA1       = "a5710000-0000-4000-a000-000000000005"
	idLeitor        = "a5710000-0000-4000-a000-000000000006"
	idSemModulo     = "a5710000-0000-4000-a000-000000000007"
	idDesativado    = "a5710000-0000-4000-a000-000000000008"
)

// pessoas: o gestor nos três estados de allowed_accounts (nulo, lista, vazia), quem passa por papel
// (admin), o super pela FICHA que NÃO é gestor (as policies gt_* não o incluem), quem tem 'meta' sem
// 'meta.gestor' (lê o que é aberto, usa o mapa, não usa a IA) e quem não tem módulo nenhum.
var pessoas = []mundoteste.Pessoa{
	{Chave: "gestorTodas", ID: idGestorTodas, Email: "gestortodas@x.com", Papel: "viewer", Modulos: []string{"meta", "meta.gestor"}},
	{Chave: "gestorA1", ID: idGestorA1, Email: "gestora1@x.com", Papel: "viewer", Modulos: []string{"meta", "meta.gestor"}, Contas: []string{A1}},
	{Chave: "gestorNenhuma", ID: idGestorNenhuma, Email: "gestornenhuma@x.com", Papel: "viewer", Modulos: []string{"meta.gestor"}, Contas: []string{}},
	{Chave: "adminA1", ID: idAdminA1, Email: "admina1@x.com", Papel: "admin", Contas: []string{A1}},
	{Chave: "superA1", ID: idSuperA1, Email: "supera1@x.com", Papel: "viewer", Super: true, Contas: []string{A1}},
	{Chave: "leitor", ID: idLeitor, Email: "leitor@x.com", Papel: "viewer", Modulos: []string{"meta"}},
	{Chave: "semModulo", ID: idSemModulo, Email: "semmodulo@x.com", Papel: "viewer"},
	{Chave: "desativado", ID: idDesativado, Email: "desativado@x.com", Papel: "admin", Modulos: []string{"meta.gestor"}, Desativado: true},
}

// Sem identidade. Toda linha de A2 carrega o uuid de A2 em account_id (ou é ligada à marca M2).
// A decisão 3 não tem conta (pode_ver_conta(null) = verdadeiro: todo gestor a vê).
const linhasDoTrafego = `
insert into gt_config_metricas (balde, metricas, updated_at) values ('engajamento', '["cpm","custo_visita"]', '2026-10-01T00:00:00Z');
insert into gt_objetivo_interacao (alvo_id, nivel, interacao, conta_id, updated_at) values
  ('9001', 'campanha', 'curtidas', '` + A1 + `', '2026-10-01T00:00:00Z'),
  ('9002', 'campanha', 'salvamentos', '` + A2 + `', '2026-10-01T00:00:00Z');
insert into gt_ponderada_config (id, metas_por_conta, limiares_resultado, updated_at) values
  (1, '{"` + A1 + `": {"mensagens": 9.8}, "` + A2 + `": {"mensagens": 7.7}}', '{"dentroMeta": 1.0}', '2026-10-01T00:00:00Z');
insert into gt_budget_analises (campaign_id, account_id, veredito, justificativa, budget_atual_centavos, budget_sugerido_centavos, impactos, gerado_em) values
  ('9001', '` + A1 + `', 'escalar', 'Custo abaixo da meta', 10000, 15000, '{"conversas": 3}', '2026-10-11T08:00:00Z'),
  ('9002', '` + A2 + `', 'reduzir', 'Custo acima da meta', 20000, 10000, null, '2026-10-11T09:00:00Z');
insert into gt_ad_analises (ad_id, campaign_id, account_id, veredito, justificativa, gerado_em) values
  ('7001', '9001', '` + A1 + `', 'pausar', 'Sem tração', '2026-10-11T08:00:00Z'),
  ('7002', '9002', '` + A2 + `', 'pausar', 'Sem tração', '2026-10-11T08:00:00Z'),
  ('7003', '9001', '` + A1 + `', 'manter', 'Bom', '2026-10-11T08:00:00Z');
insert into gt_fila_decisoes (campaign_id, account_id, veredito, decisao, decidido_por, escopo, decidido_em) values
  ('9001', '` + A1 + `', 'escalar', 'aprovada', '` + idGestorTodas + `', 'orcamento', '2026-10-10T10:00:00Z'),
  ('9002', '` + A2 + `', 'reduzir', 'recusada', '` + idGestorTodas + `', 'saude', '2026-10-11T10:00:00Z'),
  ('9003', null, 'pausar', 'aprovada', '` + idGestorTodas + `', 'criativos', '2026-10-09T10:00:00Z');
insert into gt_campanhas_rascunho (id, account_id, criado_por, nome, status, updated_at) values
  ('` + R1 + `', '` + A1 + `', '` + idGestorTodas + `', 'Seguidores outubro', 'rascunho', '2026-10-10T10:00:00Z'),
  ('` + R2 + `', '` + A1 + `', '` + idGestorA1 + `', 'Mensagens', 'rascunho', '2026-10-11T10:00:00Z'),
  ('` + R3 + `', '` + A2 + `', '` + idGestorTodas + `', 'Vendas Mantova', 'criada', '2026-10-09T10:00:00Z');
insert into gt_problemas_meta (ad_id, codigo, account_id, titulo, grave) values
  ('7001', 1, '` + A1 + `', 'Texto recusado', true), ('7002', 2, '` + A2 + `', 'Imagem recusada', false);
insert into fabrica_marcas (id, nome, ad_account, page_id, ig_id, account_id) values
  ('` + M1 + `', 'Vessel', 'act_111', 'p1', '1784', '` + A1 + `'),
  ('` + M2 + `', 'Mantova', 'act_222', 'p2', '1785', '` + A2 + `');
insert into interesses_sugeridos (marca_id, objetivo, itens) values
  ('` + M1 + `', 'seguidores', '[{"id":"6003","nome":"Moda"}]'),
  ('` + M2 + `', 'seguidores', '[{"id":"6004","nome":"Bolsas"}]');`

// fotoDoTrafego: hash das 11 tabelas da fatia. Igual antes e depois = nada mudou.
const fotoDoTrafego = `select md5(string_agg(l, '|' order by l)) from (
  select 'cm:' || t::text as l from gt_config_metricas t union all
  select 'oi:' || t::text from gt_objetivo_interacao t union all
  select 'pc:' || t::text from gt_ponderada_config t union all
  select 'pl:' || t::text from gt_ponderada_config_log t union all
  select 'ba:' || t::text from gt_budget_analises t union all
  select 'aa:' || t::text from gt_ad_analises t union all
  select 'fd:' || t::text from gt_fila_decisoes t union all
  select 'cr:' || t::text from gt_campanhas_rascunho t union all
  select 'pm:' || t::text from gt_problemas_meta t union all
  select 'fm:' || t::text from fabrica_marcas t union all
  select 'is:' || t::text from interesses_sugeridos t) z`

// novoMundo: a fatia de produção, as pessoas, as linhas e a sessão "impersonado" (a de gestorA1 aberta por
// superA1), com as rotas de `montar` atrás da MESMA cadeia do grupo de domínio de web.Rotas.
func novoMundo(t *testing.T, montar ...func(chi.Router, *pgxpool.Pool)) *mundoteste.Mundo {
	t.Helper()
	return mundoteste.Novo(t, mundoteste.Opcoes{Pessoas: pessoas, Linhas: linhasDoTrafego,
		Impersonadas: map[string][2]string{"impersonado": {idGestorA1, idSuperA1}}}, montar...)
}
```

**(b) Testes de aceitação** (`trafego_test.go`)
- `TestMundoDoTrafego` (sonda `GET /eco` montada no teste, que escreve `fmt.Sprintf("%t|%t|%s|%t", autz.PodeVerConta(e, A2), e.Modulo("meta.gestor"), e.Papel, a.ImpersonadorID != nil)`): sem sessão → 401; `gestorTodas` → `true|true|viewer|false`; `gestorA1` → `false|true|viewer|false`; `gestorNenhuma` → `false|true|viewer|false`; `adminA1` → `true|false|admin|false`; `superA1` → `true|false|viewer|false`; `leitor` → `true|false|viewer|false`; `impersonado` → `false|true|viewer|true`; `desativado` → 401. E as linhas: `select count(*)::text from gt_fila_decisoes` = `3`; a foto não é vazia.
- `TestAjudantesDeValidacao` (puro): `texto` recusa `null`, `5`, `{}`; `textoAte("\"  \"", 10, false)` = falso e com `true` = verdadeiro; `textoAte` conta caracteres e não bytes (`"ção"` cabe em 3); `objeto` aceita `{}` e recusa `[]`/`null`; `inteiroEntre("1.5", 0, 9)` = falso; `casa("\"9001\"", reIDDaMeta)` = verdadeiro e `"\"90a\""` = falso.

**(c) Arquivos:** Create `api/internal/trafego/trafego.go`, `api/internal/trafego/mundo_test.go`, `api/internal/trafego/trafego_test.go`.

**(d) Dependências:** Task 1; `mundoteste`; `autz.PodeVerConta`.

- [ ] **Step 1:** Testes; ver falhar. - [ ] **Step 2:** Implementar. - [ ] **Step 3:** `gofmt -l ./internal && go vet ./internal/trafego/ && go test -count=1 ./internal/trafego/` PASS. - [ ] **Step 4:** Commit `feat(api): pacote trafego — fundação e mundo de teste com contas A1/A2` (+ `Co-Authored-By`).

---

### Task 4: Fila — análises do robô e decisões

**Revisor:** opus. **Depende de:** 3.

**(a) Contrato**
- `GET /gestao-trafego/analises-de-orcamento` (`gt_budget_analises`; regra: gestor + `pode_ver_conta(account_id)`): a fila (gt:1019). Filtros `account_id`, `veredito`. Ordem padrão `gerado_em desc`.
- `GET /gestao-trafego/analises-de-anuncio` (`gt_ad_analises`; gestor + restritiva): gt:1132 (`?veredito=pausar`). Filtros `account_id`, `veredito`, `campaign_id`.
- `GET /gestao-trafego/decisoes` (`gt_fila_decisoes`; gestor + restritiva): gt:1020, 1124 (`?escopo=saude`), 1133 (`?escopo=criativos`), todas `?ordem=decidido_em.desc`. Filtros `account_id`, `escopo`, `campaign_id`; ordem `decidido_em`.
- `POST /gestao-trafego/decisoes` (`soSessaoPropria`): substitui o `insert` de gt:1378. Corpo: `campaign_id` (dígitos, obrigatório), `veredito` (1–40, obrigatório), `decisao` (`aprovada|recusada`, obrigatório), `escopo` (`orcamento|criativos|saude`, opcional: padrão do banco), `account_id` (uuid ou `null`), `budget_atual_centavos`, `budget_sugerido_centavos`, `analise_gerada_em`, `aplicado`, `erro` (tipos pelo banco). `silenciar_ate` NÃO vem do corpo (no corpo = `400 corpo_invalido`): o servidor grava `agora + 7 dias` quando `decisao = recusada` e nulo quando `aprovada` (Ruling 5.7-17). `decidido_por` vem da SESSÃO (Tabela.Autor); no corpo = `400 corpo_invalido`. Regra: catálogo (`gt_fila_decisoes_insercao`: gestor e `decidido_por = auth.uid()`) **e** a linha nova tem de passar na regra de LER de quem decide (gestor E `pode_ver_conta(account_id)`) — em produção o insert não tinha a restritiva (Ruling 5.7-5). Resposta `201` com `colunasDecisao`.

```go
package trafego

import (
	"encoding/json"
	"errors"
	"maps"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/autz"
	"github.com/rbv-co/social-dashboard/api/internal/banco"
	"github.com/rbv-co/social-dashboard/api/internal/dados"
)

var (
	filtroVeredito = dados.Filtro{Param: "veredito", SQL: "t.veredito = @veredito::text", Tipo: "texto"}
	filtroCampanha = dados.Filtro{Param: "campaign_id", SQL: "t.campaign_id = @campaign_id::text", Tipo: "texto"}
)

var consultaAnalisesDeOrcamento = dados.Consulta{Tabela: "gt_budget_analises", Alias: "t",
	SQL: `select t.campaign_id, t.account_id, t.objetivo, t.effective_status, t.veredito, t.justificativa,
	  t.impacto_estimado, t.impactos, t.budget_atual_centavos, t.budget_sugerido_centavos, t.gerado_em, t.valida_ate
	  from gt_budget_analises t`,
	Filtros:     []dados.Filtro{filtroConta, filtroVeredito},
	OrdemPadrao: "t.gerado_em desc", Desempate: "t.campaign_id"}

var consultaAnalisesDeAnuncio = dados.Consulta{Tabela: "gt_ad_analises", Alias: "t",
	SQL: `select t.ad_id, t.campaign_id, t.account_id, t.veredito, t.justificativa, t.gerado_em, t.valida_ate
	  from gt_ad_analises t`,
	Filtros:     []dados.Filtro{filtroConta, filtroVeredito, filtroCampanha},
	OrdemPadrao: "t.gerado_em desc", Desempate: "t.ad_id"}

// colunasDecisao: o que a tela lê da fila (campaign_id, decisao, decidido_em, silenciar_ate, escopo) + id,
// conta e veredito. decidido_por (uuid de pessoa) não sai: nenhuma tela o lê.
const colunasDecisao = `t.id, t.campaign_id, t.account_id, t.escopo, t.veredito, t.decisao, t.decidido_em, t.silenciar_ate`

var consultaDecisoes = dados.Consulta{Tabela: "gt_fila_decisoes", Alias: "t",
	SQL:     `select ` + colunasDecisao + ` from gt_fila_decisoes t`,
	Filtros: []dados.Filtro{filtroConta, filtroCampanha, {Param: "escopo", SQL: "t.escopo = @escopo::text", Tipo: "texto"}},
	Ordens:  map[string]string{"decidido_em": "t.decidido_em"}, OrdemPadrao: "t.decidido_em desc", Desempate: "t.id"}

// corpoDecisao: o que _gtFilaGravarDecisao grava (tela-de-gestao-trafego.vue:1351-1377), sem decidido_por.
type corpoDecisao struct {
	Escopo                 json.RawMessage `json:"escopo,omitempty"`
	CampaignID             json.RawMessage `json:"campaign_id,omitempty"`
	AccountID              json.RawMessage `json:"account_id,omitempty"`
	Veredito               json.RawMessage `json:"veredito,omitempty"`
	BudgetAtualCentavos    json.RawMessage `json:"budget_atual_centavos,omitempty"`
	BudgetSugeridoCentavos json.RawMessage `json:"budget_sugerido_centavos,omitempty"`
	AnaliseGeradaEm        json.RawMessage `json:"analise_gerada_em,omitempty"`
	Decisao                json.RawMessage `json:"decisao,omitempty"`
	Aplicado               json.RawMessage `json:"aplicado,omitempty"`
	Erro                   json.RawMessage `json:"erro,omitempty"`
}

func (c corpoDecisao) Validar() error {
	var e []error
	if !textoEm(c.Decisao, "aprovada", "recusada") {
		e = append(e, errors.New("decisao é aprovada ou recusada."))
	}
	if c.Escopo != nil && !textoEm(c.Escopo, "orcamento", "criativos", "saude") {
		e = append(e, errors.New("escopo é orcamento, criativos ou saude."))
	}
	if !casa(c.CampaignID, reIDDaMeta) {
		e = append(e, errors.New("campaign_id é o id da campanha na Meta."))
	}
	if c.AccountID != nil && !nulo(c.AccountID) && !casa(c.AccountID, reUUID) {
		e = append(e, errors.New("account_id é o id da conta."))
	}
	if !textoAte(c.Veredito, 40, false) {
		e = append(e, errors.New("veredito tem de 1 a 40 caracteres."))
	}
	if c.Erro != nil && !nulo(c.Erro) && !textoAte(c.Erro, 2000, true) {
		e = append(e, errors.New("erro tem até 2000 caracteres."))
	}
	return errors.Join(e...)
}

// diasDeSilencio: recusar cala a campanha por 7 dias (DIAS_DE_SILENCIO de tela-de-gestao-trafego.vue).
const diasDeSilencio = 7

var tabelaDecisoes = dados.Tabela{Nome: "gt_fila_decisoes", Resposta: colunasDecisao, Autor: "decidido_por"}

// criarDecisao: POST /gestao-trafego/decisoes. Append-only (a migration 2026-07-29-fila-decisoes.sql: corrigir
// é decidir de novo). A linha nova passa na regra de criar do catálogo (Tabela.Criar → PodeCriar) E na
// de LER de quem decide, na MESMA transação e sobre o MESMO mapa (Ruling 5.7-5: decisão de conta que a
// pessoa não vê = 403, nada gravado).
func criarDecisao(p *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		e := autz.EscopoDo(r.Context())
		if e == nil {
			dados.Erro(w, http.StatusInternalServerError, "erro_interno", "")
			return
		}
		var c corpoDecisao
		if !dados.LerCorpo(w, r, &c) {
			return
		}
		if err := c.Validar(); err != nil {
			dados.Erro(w, http.StatusBadRequest, "pedido_invalido", err.Error())
			return
		}
		campos, err := dados.Campos(&c)
		if err != nil {
			dados.Erro(w, http.StatusInternalServerError, "erro_interno", "")
			return
		}
		// Ruling 5.7-17: o silêncio é do servidor (a tela mandava agora + DIAS_DE_SILENCIO, falsificável).
		if textoEm(c.Decisao, "recusada") {
			campos["silenciar_ate"] = time.Now().UTC().Add(diasDeSilencio * 24 * time.Hour).Format(time.RFC3339Nano)
		}
		ctx := r.Context()
		var corpo []byte
		err = banco.ComUsuario(ctx, p, e.ID, func(tx pgx.Tx) error {
			nova := maps.Clone(campos)
			nova["decidido_por"] = e.ID
			if _, tem := nova["account_id"]; !tem {
				nova["account_id"] = nil // o banco grava nulo: a conferência vê o mesmo
			}
			f, err := autz.Producao.Filtro(e, "gt_fila_decisoes", autz.Ler, "autz_nova")
			if err != nil {
				return err
			}
			ok, err := autz.Conferir(ctx, tx, f, "gt_fila_decisoes", nova)
			if err != nil {
				return err
			}
			if !ok {
				return autz.ErrNegado
			}
			corpo, err = tabelaDecisoes.Criar(ctx, tx, autz.Producao, e, campos)
			return err
		})
		if err != nil {
			dados.ErroDeEscrita(w, err)
			return
		}
		dados.Responder(w, http.StatusCreated, corpo)
	}
}

func montarFila(r chi.Router, p *pgxpool.Pool) {
	deve(tabelaDecisoes.Validar(autz.Producao))
	r.Get("/gestao-trafego/analises-de-orcamento", consultaAnalisesDeOrcamento.Handler(p, autz.Producao))
	r.Get("/gestao-trafego/analises-de-anuncio", consultaAnalisesDeAnuncio.Handler(p, autz.Producao))
	r.Get("/gestao-trafego/decisoes", consultaDecisoes.Handler(p, autz.Producao))
	r.With(soSessaoPropria).Post("/gestao-trafego/decisoes", criarDecisao(p))
}
```

**(b) Testes de aceitação** (`TestAnalises`, `TestDecisoes`, `m.Rodar`; "intacto" = `fotoDoTrafego` igual à de antes)
- Matriz nas três leituras: `gestorTodas`, `adminA1` → A1 e A2; `gestorA1`, `impersonado` → só A1; `gestorNenhuma`, `superA1` (super pela ficha não é gestor nas gt_*), `leitor`, `semModulo` → `[]`; `desativado` → 401. Decisões: `gestorA1` vê `9001` e a `9003` (sem conta), nunca `9002`; `gestorNenhuma` vê só a `9003`.
- Filtros e ordem: `analises-de-anuncio?veredito=pausar` como `gestorTodas` → `7001` e `7002`, sem `7003`; `decisoes?escopo=saude&ordem=decidido_em.desc` como `gestorTodas` → só `9002`; `decisoes` padrão → `9002` (11/10) antes de `9001` (10/10) antes de `9003`; `analises-de-orcamento` padrão → `9002` (09h) antes de `9001` (08h), com `"impactos":{"conversas": 3}`.
- Contagem e IDOR: `gestorA1` `?account_id=` + A2 em cada leitura → `[]`; `decisoes?contar=1&limite=1` → `X-Total-Count: 2` para `gestorA1`, `3` para `gestorTodas`.
- 400: `?ordem=veredito`, `?limite=1001`, `?decidido_em=hoje`.
- Criar, permitido: `gestorA1` `{"campaign_id":"9001","account_id":"<A1>","veredito":"escalar","decisao":"recusada","escopo":"orcamento","aplicado":[]}` → 201 com `"decisao":"recusada"` e sem `decidido_por`; efeito: a linha nova tem `decidido_por = idGestorA1` e `silenciar_ate` entre agora + 7 dias − 1 min e agora + 7 dias + 1 min. `"silenciar_ate":"2099-01-01T00:00:00Z"` no corpo → `400 corpo_invalido`, nada gravado. `decisao` `aprovada` → `silenciar_ate` nulo. `{"campaign_id":"9004","account_id":null,"veredito":"pausar","decisao":"aprovada"}` → 201 (sem conta: visível a todo gestor) e `escopo = 'orcamento'` (padrão). `adminA1` com A2 → 201.
- Criar, negado e intacto: `gestorA1` com A2 → 403 (**conta que não vê**); com A3 (não existe) → 403 igual; `gestorNenhuma` com A1 → 403; `leitor`, `superA1` → 403; `impersonado` → 403 com "Quem entrou como outra pessoa"; `{"decidido_por":"<idGestorTodas>",…}` → 400 `corpo_invalido`; `decisao "talvez"`, `campaign_id "abc"`, `veredito ""`, `account_id "x"`, sem `campaign_id` → 400.
- Mutações que têm de reprovar: tirar a conferência de Ler (`gestorA1` cria a decisão de A2: 201); `Autor: ""` em `tabelaDecisoes` (a linha de criar fica sem `decidido_por`, que a regra lê: `autz.ErrDeclaracao`, o caso permitido vira 500); tirar `soSessaoPropria` do POST.

**(c) Arquivos:** Create `api/internal/trafego/fila.go`, `api/internal/trafego/fila_test.go`.

**(d) Dependências:** Task 3; `dados.Tabela.Criar`, `autz.Conferir`.

- [ ] **Step 1:** Testes; ver falhar. - [ ] **Step 2:** Implementar (código de (a)). - [ ] **Step 3:** `gofmt -l ./internal && go vet ./internal/trafego/ && go test -count=1 ./internal/trafego/` PASS; mutações reprovam. - [ ] **Step 4:** Commit `feat(api): fila da Gestão de Tráfego — análises do robô por conta e decisão que só se cria na conta que se vê` (+ `Co-Authored-By`).

---

### Task 5: Rascunhos de campanha

**Revisor:** opus. **Depende de:** 3.

**(a) Contrato** (regra inteira do catálogo, nada à mão: ler = gestor + `pode_ver_conta`; criar = `criado_por = auth.uid()` + gestor + restritiva no WITH CHECK; editar e apagar = `criado_por = auth.uid()` + restritiva em ALL — o gestor lê os rascunhos da conta inteira (o "histórico do time", gt:4911) mas só muda e apaga os seus)
- `GET /gestao-trafego/rascunhos` (gt:4917 `?account_id=&ordem=updated_at.desc&limite=60`; gt:4966 `…&limite=40`). Filtros `account_id`, `status`.
- `POST /gestao-trafego/rascunhos` (gt:4871) → `201` com a linha; `criado_por` da sessão.
- `PATCH /gestao-trafego/rascunhos/{id}` (gt:4868, 4884) → `200`; rascunho de outra pessoa que se vê = `403`; que não se vê = `404`; mover para conta que não se vê = `403`. O gatilho `gt_rascunho_updated_at` carimba `updated_at`.
- `DELETE /gestao-trafego/rascunhos/{id}` (gt:4944) → `204`.

```go
package trafego

import (
	"encoding/json"
	"errors"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/autz"
	"github.com/rbv-co/social-dashboard/api/internal/dados"
)

const colunasRascunho = `t.id, t.account_id, t.criado_por, t.estado, t.passo, t.nome, t.tipo, t.status, t.resultado, t.created_at, t.updated_at`

var consultaRascunhos = dados.Consulta{Tabela: "gt_campanhas_rascunho", Alias: "t",
	SQL:     `select ` + colunasRascunho + ` from gt_campanhas_rascunho t`,
	Filtros: []dados.Filtro{filtroConta, {Param: "status", SQL: "t.status = @status::text", Tipo: "texto"}},
	Ordens:  map[string]string{"updated_at": "t.updated_at"}, OrdemPadrao: "t.updated_at desc", Desempate: "t.id"}

// corpoRascunho: o que linhaParaSalvar (rascunhos.js) e _gtNovoFecharRascunho gravam. criado_por vem da
// sessão (Tabela.Autor): no corpo, dados.LerCorpo recusa.
type corpoRascunho struct {
	AccountID json.RawMessage `json:"account_id,omitempty"`
	Estado    json.RawMessage `json:"estado,omitempty"`
	Passo     json.RawMessage `json:"passo,omitempty"`
	Nome      json.RawMessage `json:"nome,omitempty"`
	Tipo      json.RawMessage `json:"tipo,omitempty"`
	Status    json.RawMessage `json:"status,omitempty"`
	Resultado json.RawMessage `json:"resultado,omitempty"`
}

func (c corpoRascunho) Validar() error {
	var e []error
	if c.AccountID != nil && !casa(c.AccountID, reUUID) {
		e = append(e, errors.New("account_id é o id da conta."))
	}
	if c.Estado != nil && !objeto(c.Estado) {
		e = append(e, errors.New("estado é um objeto."))
	}
	if c.Passo != nil && !inteiroEntre(c.Passo, 0, 50) {
		e = append(e, errors.New("passo é um número de 0 a 50."))
	}
	if c.Nome != nil && !textoAte(c.Nome, 200, true) {
		e = append(e, errors.New("nome tem até 200 caracteres."))
	}
	if c.Tipo != nil && !textoAte(c.Tipo, 120, true) {
		e = append(e, errors.New("tipo tem até 120 caracteres."))
	}
	if c.Status != nil && !textoEm(c.Status, "rascunho", "criada", "falhou") {
		e = append(e, errors.New("status é rascunho, criada ou falhou."))
	}
	if c.Resultado != nil && !nulo(c.Resultado) && !objeto(c.Resultado) {
		e = append(e, errors.New("resultado é um objeto ou nulo."))
	}
	return errors.Join(e...)
}

var tabelaRascunhos = dados.Tabela{Nome: "gt_campanhas_rascunho", Resposta: colunasRascunho, Autor: "criado_por"}

func montarRascunhos(r chi.Router, p *pgxpool.Pool) {
	deve(tabelaRascunhos.Validar(autz.Producao))
	r.Get("/gestao-trafego/rascunhos", consultaRascunhos.Handler(p, autz.Producao))
	r.With(soSessaoPropria).Post("/gestao-trafego/rascunhos", dados.RotaCriar[corpoRascunho](p, autz.Producao, tabelaRascunhos))
	r.With(soSessaoPropria).Patch("/gestao-trafego/rascunhos/{id}", dados.RotaEditar[corpoRascunho](p, autz.Producao, tabelaRascunhos))
	r.With(soSessaoPropria).Delete("/gestao-trafego/rascunhos/{id}", dados.RotaApagar(p, autz.Producao, tabelaRascunhos))
}
```

**(b) Testes de aceitação** (`TestRascunhos`, `m.Rodar`)
- Leitura: `gestorTodas`, `adminA1` → R1, R2, R3; `gestorA1`, `impersonado` → R1 e R2 (o time inteiro na conta que vê), nunca R3; `gestorNenhuma`, `leitor`, `superA1` → `[]`; `?account_id=<A1>&ordem=updated_at.desc&limite=60` como `gestorA1` → R2 antes de R1; `?account_id=` + A2 como `gestorA1` → `[]`; `?status=criada` como `gestorTodas` → só R3.
- Criar: `gestorA1` `{"account_id":"<A1>","estado":{"objetivo":"seguidores"},"passo":1,"nome":"Nova","tipo":"Seguidores","status":"rascunho"}` → 201 com `"criado_por":"<idGestorA1>"`. Negados, contagem igual: `account_id` A2 → 403; sem `account_id` → 400 "Informe account_id."; `{"criado_por":"<idGestorTodas>",…}` → 400 `corpo_invalido`; `leitor` → 403; `superA1` → 403; `impersonado` → 403 com a frase; `"status":"enviada"`, `"estado":[]`, `"passo":51` → 400.
- Editar: `gestorA1` `PATCH R2 {"status":"criada","resultado":{"campanha":"123"}}` → 200 e o gatilho carimbou (`select (updated_at > '2026-10-11T10:00:00Z')::text from gt_campanhas_rascunho where id = R2` = `true`); `gestorA1` `PATCH R1` (do `gestorTodas`, visível) → 403 e R1 intacto; `PATCH R3` → 404 (não vê); `PATCH R2 {"account_id":"<A2>"}` → 403 e R2 continua em A1; `PATCH /gestao-trafego/rascunhos/abc` → 404; `{}` → 400; `gestorTodas` `PATCH R3 {"nome":"x"}` → 200 (dele).
- Apagar: `gestorA1` `DELETE R1` → 403; `DELETE R3` → 404; `impersonado` `DELETE R2` → 403; `gestorA1` `DELETE R2` → 204 e a linha some.
- Mutações que têm de reprovar: `Autor: ""` (a linha de criar fica sem `criado_por`, que a regra lê: `autz.ErrDeclaracao`, o caso permitido vira 500); tirar `soSessaoPropria` do DELETE; apagar o gatilho de `03-funcoes-5-7.sql` (o carimbo não muda).

**(c) Arquivos:** Create `api/internal/trafego/rascunhos.go`, `api/internal/trafego/rascunhos_test.go`.

**(d) Dependências:** Task 3; `dados.Tabela/RotaCriar/RotaEditar/RotaApagar`.

- [ ] **Step 1:** Testes; ver falhar. - [ ] **Step 2:** Implementar. - [ ] **Step 3:** gofmt/vet/test PASS; mutações reprovam. - [ ] **Step 4:** Commit `feat(api): rascunhos do assistente de campanha — o time lê, só o dono muda, só na conta que vê` (+ `Co-Authored-By`).

---

### Task 6: Escolhas — configuração de métricas e objetivos por interação

**Revisor:** opus. **Depende de:** 2 (`dados.UpsertVisivel`), 3.

**(a) Contrato** (as duas tabelas são legíveis por qualquer sessão — `gt_cfg_read` e `objetivo_interacao_leitura` são `true`; a do config vale até para `anon` em produção, aqui só sessão: Ruling 36 do mestre — e gravadas pelo gestor; nenhuma tem a restritiva)
- `GET /gestao-trafego/config-metricas` → `[{balde, metricas, updated_at}]` (gt:696).
- `PUT /gestao-trafego/config-metricas/{balde}` (`soSessaoPropria`) `{"metricas": ["<chave>", …]}` (0 a 30 chaves `[a-z0-9_]{1,40}`) → `200 {balde, metricas, updated_at}`; `updated_at` do servidor. Substitui o `.upsert({balde, metricas, updated_at}, {onConflict:'balde'})` de gt:870. `{balde}` fora de `[a-z_]{1,40}` → 404.
- `GET /gestao-trafego/objetivos` → `[{alvo_id, nivel, interacao, conta_id, updated_at}]` (gt:705, 802); filtros `alvo_id`, `conta_id` (uuid), `nivel` (o robô `budget-ia.mjs:776` usa os dois últimos; Plano 7).
- `PUT /gestao-trafego/objetivos/{alvo_id}` (`soSessaoPropria`) `{"nivel":"campanha|anuncio","interacao":"curtidas|comentarios|salvamentos|compartilhamentos","conta_id":<uuid|null>}` (as três chaves obrigatórias) → `200` com a linha; `updated_by` (sessão) e `updated_at` (servidor). Substitui o `.upsert(…,{onConflict:'alvo_id'})` de gt:763. `{alvo_id}` fora de dígitos → 404.
- `DELETE /gestao-trafego/objetivos/{alvo_id}` (`soSessaoPropria`) → `204` também quando não havia linha (idempotente: a tela deixa de precisar da releitura de gt:802 para desambiguar "zero linhas"); quem não é gestor → `403` antes de tocar no banco (Ruling 5.7-8).

```go
package trafego

import (
	"encoding/json"
	"net/http"
	"regexp"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/autz"
	"github.com/rbv-co/social-dashboard/api/internal/banco"
	"github.com/rbv-co/social-dashboard/api/internal/dados"
)

var consultaConfigMetricas = dados.Consulta{Tabela: "gt_config_metricas", Alias: "t",
	SQL:         `select t.balde, t.metricas, t.updated_at from gt_config_metricas t`,
	OrdemPadrao: "t.updated_at", Desempate: "t.balde"}

var consultaObjetivos = dados.Consulta{Tabela: "gt_objetivo_interacao", Alias: "t",
	SQL: `select t.alvo_id, t.nivel, t.interacao, t.conta_id, t.updated_at from gt_objetivo_interacao t`,
	Filtros: []dados.Filtro{
		{Param: "alvo_id", SQL: "t.alvo_id = @alvo_id::text", Tipo: "texto"},
		{Param: "conta_id", SQL: "t.conta_id = @conta_id::uuid", Tipo: "uuid"},
		{Param: "nivel", SQL: "t.nivel = @nivel::text", Tipo: "texto"}},
	OrdemPadrao: "t.updated_at", Desempate: "t.alvo_id"}

var (
	reBalde   = regexp.MustCompile(`^[a-z_]{1,40}$`)
	reMetrica = regexp.MustCompile(`^[a-z0-9_]{1,40}$`)
)

// upsert grava `linha` por dados.UpsertVisivel na transação de quem pede e responde 200 com a linha.
func upsert(w http.ResponseWriter, r *http.Request, p *pgxpool.Pool, e *autz.Escopo, tab string, chave []string, linha map[string]any, resposta string) {
	var corpo []byte
	err := banco.ComUsuario(r.Context(), p, e.ID, func(tx pgx.Tx) (err error) {
		corpo, err = dados.UpsertVisivel(r.Context(), tx, autz.Producao, e, tab, chave, linha, resposta)
		return err
	})
	if err != nil {
		dados.ErroDeEscrita(w, err)
		return
	}
	dados.Responder(w, http.StatusOK, corpo)
}

// gravarConfig: PUT /gestao-trafego/config-metricas/{balde}.
func gravarConfig(p *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		e := escopoOu500(w, r)
		if e == nil {
			return
		}
		balde := chi.URLParam(r, "balde")
		if !reBalde.MatchString(balde) {
			dados.Erro(w, http.StatusNotFound, "nao_encontrado", "")
			return
		}
		var in struct {
			Metricas json.RawMessage `json:"metricas"`
		}
		if !dados.LerCorpo(w, r, &in) {
			return
		}
		var lista []string
		if json.Unmarshal(in.Metricas, &lista) != nil || lista == nil || len(lista) > 30 || !todasCasam(lista, reMetrica) {
			dados.Erro(w, http.StatusBadRequest, "pedido_invalido", "metricas é uma lista de até 30 chaves de métrica.")
			return
		}
		upsert(w, r, p, e, "gt_config_metricas", []string{"balde"},
			map[string]any{"balde": balde, "metricas": in.Metricas, "updated_at": agora()}, "balde, metricas, updated_at")
	}
}

func todasCasam(l []string, re *regexp.Regexp) bool {
	for _, s := range l {
		if !re.MatchString(s) {
			return false
		}
	}
	return true
}

// gravarObjetivo: PUT /gestao-trafego/objetivos/{alvo_id}. conta_id não amarra alvo_id a uma conta
// (Ruling 5.7-7): paridade com a policy, que não tem a restritiva.
func gravarObjetivo(p *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		e := escopoOu500(w, r)
		if e == nil {
			return
		}
		alvo := chi.URLParam(r, "alvo_id")
		if !reIDDaMeta.MatchString(alvo) {
			dados.Erro(w, http.StatusNotFound, "nao_encontrado", "")
			return
		}
		var in struct {
			Nivel     json.RawMessage `json:"nivel"`
			Interacao json.RawMessage `json:"interacao"`
			ContaID   json.RawMessage `json:"conta_id"`
		}
		if !dados.LerCorpo(w, r, &in) {
			return
		}
		if !textoEm(in.Nivel, "campanha", "anuncio") || !textoEm(in.Interacao, "curtidas", "comentarios", "salvamentos", "compartilhamentos") ||
			in.ContaID == nil || (!nulo(in.ContaID) && !casa(in.ContaID, reUUID)) {
			dados.Erro(w, http.StatusBadRequest, "pedido_invalido", "Informe nivel, interacao e conta_id (ou null).")
			return
		}
		upsert(w, r, p, e, "gt_objetivo_interacao", []string{"alvo_id"},
			map[string]any{"alvo_id": alvo, "nivel": in.Nivel, "interacao": in.Interacao, "conta_id": in.ContaID,
				"updated_at": agora(), "updated_by": e.ID},
			"alvo_id, nivel, interacao, conta_id, updated_at")
	}
}

// apagarObjetivo: DELETE /gestao-trafego/objetivos/{alvo_id} — 204 também sem linha (Ruling 5.7-8). A regra
// de apagar só depende de quem pede (gestor), por isso o "não pode" sai antes do banco.
func apagarObjetivo(p *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		e := escopoOu500(w, r)
		if e == nil {
			return
		}
		alvo := chi.URLParam(r, "alvo_id")
		if !reIDDaMeta.MatchString(alvo) {
			dados.Erro(w, http.StatusNotFound, "nao_encontrado", "")
			return
		}
		fa, err := autz.Producao.Filtro(e, "gt_objetivo_interacao", autz.Apagar, "t")
		if err != nil || fa.Nega() {
			if err == nil {
				err = autz.ErrNegado
			}
			dados.ErroDeEscrita(w, err)
			return
		}
		err = banco.ComUsuario(r.Context(), p, e.ID, func(tx pgx.Tx) error {
			_, err := tx.Exec(r.Context(), `delete from gt_objetivo_interacao t where t.alvo_id = @alvo::text and (`+fa.SQL+`)`,
				fa.Juntar(pgx.NamedArgs{"alvo": alvo}))
			return err
		})
		if err != nil {
			dados.ErroDeEscrita(w, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

func montarEscolhas(r chi.Router, p *pgxpool.Pool) {
	r.Get("/gestao-trafego/config-metricas", consultaConfigMetricas.Handler(p, autz.Producao))
	r.With(soSessaoPropria).Put("/gestao-trafego/config-metricas/{balde}", gravarConfig(p))
	r.Get("/gestao-trafego/objetivos", consultaObjetivos.Handler(p, autz.Producao))
	r.With(soSessaoPropria).Put("/gestao-trafego/objetivos/{alvo_id}", gravarObjetivo(p))
	r.With(soSessaoPropria).Delete("/gestao-trafego/objetivos/{alvo_id}", apagarObjetivo(p))
}
```

**(b) Testes de aceitação** (`TestConfigMetricas`, `TestObjetivos`, `m.Rodar`)
- Leituras abertas a toda sessão (paridade, Ruling 5.7-3): `semModulo`, `leitor`, `gestorA1` → `config-metricas` com `engajamento`; `objetivos` com `9001` E `9002` (inclusive o `conta_id` de A2: a tabela não tem a restritiva; exceção declarada da varredura, Task 11). `objetivos?conta_id=<A1>&nivel=campanha` → só `9001`; `?conta_id=x` → 400; `desativado` → 401.
- Config, permitido: `gestorA1` `PUT …/config-metricas/engajamento {"metricas":["cpm"]}` → 200 `"metricas":["cpm"]`; efeito: `metricas::text = '["cpm"]'` e `updated_at > '2026-10-01'`. `PUT …/vendas {"metricas":[]}` → 200 e a linha nova existe.
- Config, negado e intacto: `leitor`, `superA1` (super pela ficha não é gestor) → 403; `impersonado` → 403 com a frase; `{"metricas":"cpm"}`, `{"metricas":[1]}`, `{"metricas":null}`, 31 chaves, `{"metricas":["CPM"]}` → 400; `{"metricas":[],"updated_at":"x"}` → 400 `corpo_invalido`; `PUT …/config-metricas/Vendas!` → 404.
- Objetivos, permitido: `gestorA1` `PUT …/objetivos/9003 {"nivel":"anuncio","interacao":"comentarios","conta_id":"<A1>"}` → 200; efeito `updated_by = idGestorA1`; `PUT …/9001 {"nivel":"campanha","interacao":"salvamentos","conta_id":null}` → 200 e `interacao` muda. `DELETE …/9001` → 204 e a linha some; `DELETE …/9999` (não existe) → 204.
- Objetivos, negado e intacto: `leitor` `PUT …/9001` → 403; `leitor` `DELETE …/9002` → 403 e `9002` existe; `impersonado` `PUT`/`DELETE` → 403; `"interacao":"likes"`, `"nivel":"conta"`, sem `conta_id`, `"conta_id":"x"` → 400; `PUT …/objetivos/abc` → 404.
- Mutações que têm de reprovar: trocar `dados.UpsertVisivel` por `insert … on conflict do update` sem `PodeCriar` (o `leitor` grava: 200); tirar o `fa.Nega()` do DELETE e o `(fa.SQL)` do `where` (o `leitor` apaga); tirar `soSessaoPropria` de um dos três.

**(c) Arquivos:** Create `api/internal/trafego/escolhas.go`, `api/internal/trafego/escolhas_test.go`.

**(d) Dependências:** Tasks 2 e 3.

- [ ] **Step 1:** Testes; ver falhar. - [ ] **Step 2:** Implementar. - [ ] **Step 3:** gofmt/vet/test PASS; mutações reprovam. - [ ] **Step 4:** Commit `feat(api): configuração de métricas e objetivos por interação gravados por upsert com a regra de produção` (+ `Co-Authored-By`).

---

### Task 7: Régua (com histórico) e interesses sugeridos

**Revisor:** opus. **Depende de:** 3.

**(a) Contrato**
- `GET /gestao-trafego/regua` (`gt_ponderada_config`, regra `true`: toda sessão) → `[{id, pesos, metas, limiares, limiares_resultado, metas_por_conta, updated_at}]` (gt:1563 lia `?id=eq.1` e `linhas[0]`; a tabela tem uma linha só, `check (id = 1)`).
- `PUT /gestao-trafego/regua` (`soSessaoPropria`) `{"pesos":{…},"limiares":{…},"limiares_resultado":{…},"conta_id":"<uuid>","metas":{…}}` (todas obrigatórias; cada objeto com até 50 chaves de até 40 caracteres e valores número, booleano ou `null` — a forma que `regua.js:normalizarRegua` lê; `limiares.ponderada_ligada` é booleano) → `200` com a linha nova. Numa transação só (Ruling 5.7-7): (1) quem não é gestor ou não vê `conta_id` → `403` antes do banco; (2) trava a linha `id = 1`; (3) lê a linha inteira (o `antes` do histórico) e funde `metas_por_conta || {conta_id: metas}` NO SERVIDOR (substitui `mesclarMetasDaConta` da tela: duas pessoas salvando contas diferentes não se apagam); (4) `Tabela.Editar` (regra de editar do catálogo) com `updated_by` = sessão e `updated_at` = servidor; (5) `Tabela.Criar` em `gt_ponderada_config_log` (regra de inserir do catálogo; `mudou_quem` = sessão) com `antes` e `depois` lidos do banco. Falha em qualquer passo desfaz tudo. Substitui gt:1615 e gt:1624.
- `GET /gestao-trafego/interesses-sugeridos` (`interesses_sugeridos`, regra `true`; a marca por `left join fabrica_marcas m … {ler:fabrica_marcas:m}`, que tem a restritiva `pode_ver_conta(account_id)`) → `[{id, marca_id, account_id, objetivo, itens, propostos, validos, gerado_em}]`; `account_id` é o da marca e sai `null` quando quem pede não vê a marca. Filtros `account_id` (o da marca: substitui o `fabrica_marcas!inner(account_id)&fabrica_marcas.account_id=eq.` de gt:4682, que escondia as sugestões de marca invisível — aqui também: marca invisível nunca casa), `marca_id`, `objetivo` (painel-subir.vue:232, da fábrica: `?marca_id=&objetivo=`).

```go
package trafego

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/autz"
	"github.com/rbv-co/social-dashboard/api/internal/banco"
	"github.com/rbv-co/social-dashboard/api/internal/dados"
)

const colunasRegua = `t.id, t.pesos, t.metas, t.limiares, t.limiares_resultado, t.metas_por_conta, t.updated_at`

var consultaRegua = dados.Consulta{Tabela: "gt_ponderada_config", Alias: "t",
	SQL: `select ` + colunasRegua + ` from gt_ponderada_config t`, OrdemPadrao: "t.id", Desempate: "t.id"}

var (
	tabelaRegua    = dados.Tabela{Nome: "gt_ponderada_config", Resposta: colunasRegua}
	tabelaReguaLog = dados.Tabela{Nome: "gt_ponderada_config_log", Resposta: "t.id", Autor: "mudou_quem"}
)

type corpoRegua struct {
	Pesos             json.RawMessage `json:"pesos"`
	Limiares          json.RawMessage `json:"limiares"`
	LimiaresResultado json.RawMessage `json:"limiares_resultado"`
	ContaID           string          `json:"conta_id"`
	Metas             json.RawMessage `json:"metas"`
}

// objetoRaso: objeto JSON de até 50 chaves curtas cujos valores são número, booleano ou null.
func objetoRaso(v json.RawMessage) bool {
	var m map[string]any
	if !objeto(v) || json.Unmarshal(v, &m) != nil || len(m) > 50 {
		return false
	}
	for k, x := range m {
		switch x.(type) {
		case float64, bool, nil:
		default:
			return false
		}
		if k == "" || len(k) > 40 {
			return false
		}
	}
	return true
}

// gravarRegua: PUT /gestao-trafego/regua (Ruling 5.7-7).
func gravarRegua(p *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		e := escopoOu500(w, r)
		if e == nil {
			return
		}
		var in corpoRegua
		if !dados.LerCorpo(w, r, &in) {
			return
		}
		if !objetoRaso(in.Pesos) || !objetoRaso(in.Limiares) || !objetoRaso(in.LimiaresResultado) || !objetoRaso(in.Metas) || !reUUID.MatchString(in.ContaID) {
			dados.Erro(w, http.StatusBadRequest, "pedido_invalido", "A régua é pesos, limiares, limiares_resultado, conta_id e metas.")
			return
		}
		// as metas são DA CONTA: quem não vê a conta não muda as metas dela; quem não é gestor nem trava a linha
		fe, err := autz.Producao.Filtro(e, "gt_ponderada_config", autz.Editar, "t")
		if err != nil || fe.Nega() || !autz.PodeVerConta(e, in.ContaID) {
			if err == nil {
				err = autz.ErrNegado
			}
			dados.ErroDeEscrita(w, err)
			return
		}
		ctx := r.Context()
		var corpo []byte
		err = banco.ComUsuario(ctx, p, e.ID, func(tx pgx.Tx) error {
			// trava ANTES de ler: a leitura seguinte (outra instrução, outro instantâneo) vê a última gravada
			if _, err := tx.Exec(ctx, `select 1 from gt_ponderada_config where id = 1 for update`); err != nil {
				return err
			}
			var antes, mapa []byte
			err := tx.QueryRow(ctx, `select row_to_json(x) from (select `+colunasRegua+` from gt_ponderada_config t where t.id = 1) x`).Scan(&antes)
			if errors.Is(err, pgx.ErrNoRows) {
				return autz.ErrNaoEncontrado
			}
			if err != nil {
				return err
			}
			if err := tx.QueryRow(ctx, `select coalesce(metas_por_conta, '{}'::jsonb) || jsonb_build_object(@conta::text, @metas::jsonb)
				from gt_ponderada_config where id = 1`, pgx.NamedArgs{"conta": in.ContaID, "metas": string(in.Metas)}).Scan(&mapa); err != nil {
				return err
			}
			depois, err := tabelaRegua.Editar(ctx, tx, autz.Producao, e, "1", map[string]any{
				"pesos": in.Pesos, "limiares": in.Limiares, "limiares_resultado": in.LimiaresResultado,
				"metas_por_conta": json.RawMessage(mapa), "updated_at": agora(), "updated_by": e.ID})
			if err != nil {
				return err
			}
			if _, err := tabelaReguaLog.Criar(ctx, tx, autz.Producao, e,
				map[string]any{"antes": json.RawMessage(antes), "depois": json.RawMessage(depois)}); err != nil {
				return err
			}
			corpo = depois
			return nil
		})
		if err != nil {
			dados.ErroDeEscrita(w, err)
			return
		}
		dados.Responder(w, http.StatusOK, corpo)
	}
}

func montarRegua(r chi.Router, p *pgxpool.Pool) {
	deve(tabelaRegua.Validar(autz.Producao))
	deve(tabelaReguaLog.Validar(autz.Producao))
	r.Get("/gestao-trafego/regua", consultaRegua.Handler(p, autz.Producao))
	r.With(soSessaoPropria).Put("/gestao-trafego/regua", gravarRegua(p))
}
```

`api/internal/trafego/interesses.go`:

```go
package trafego

import (
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/autz"
	"github.com/rbv-co/social-dashboard/api/internal/dados"
)

// GET /gestao-trafego/interesses-sugeridos: o que o robô sugerir-interesses gravou por marca × objetivo.
// A conta sai da marca, e só para quem lê a marca (fabrica_marcas tem a restritiva pode_ver_conta).
var consultaInteresses = dados.Consulta{Tabela: "interesses_sugeridos", Alias: "t",
	SQL: `select t.id, t.marca_id, m.account_id, t.objetivo, t.itens, t.propostos, t.validos, t.gerado_em
	  from interesses_sugeridos t left join fabrica_marcas m on m.id = t.marca_id and {ler:fabrica_marcas:m}`,
	Filtros: []dados.Filtro{
		{Param: "account_id", SQL: "m.account_id = @account_id::text", Tipo: "texto"},
		{Param: "marca_id", SQL: "t.marca_id = @marca_id::uuid", Tipo: "uuid"},
		{Param: "objetivo", SQL: "t.objetivo = @objetivo::text", Tipo: "texto"}},
	OrdemPadrao: "t.objetivo", Desempate: "t.id"}

func montarInteresses(r chi.Router, p *pgxpool.Pool) {
	r.Get("/gestao-trafego/interesses-sugeridos", consultaInteresses.Handler(p, autz.Producao))
}
```

**(b) Testes de aceitação** (`TestRegua`, `TestReguaNaoPerdeMetaDeOutraConta`, `TestInteresses`)
- Leitura da régua: `semModulo`, `gestorA1` → 200 com uma linha, `"metas_por_conta"` com A1 E A2 (paridade: a régua é geral; exceção declarada da varredura, Task 11; achado 3).
- Gravar, permitido: `gestorA1` `PUT {"pesos":{"curtidas":1,"comentarios":10},"limiares":{"manter":1.3,"ponderada_ligada":true},"limiares_resultado":{"dentroMeta":1.1},"conta_id":"<A1>","metas":{"mensagens":8.5}}` → 200; efeitos: `metas_por_conta #>> '{<A1>,mensagens}'` = `8.5` e `#>> '{<A2>,mensagens}'` = `7.7` (a outra conta fica); `limiares ->> 'ponderada_ligada'` = `true`; `updated_by = idGestorA1`; `gt_ponderada_config_log` tem 1 linha com `mudou_quem = idGestorA1`, `antes #>> '{metas_por_conta,<A1>,mensagens}'` = `9.8` e `depois #>> '{metas_por_conta,<A1>,mensagens}'` = `8.5`. `gestorTodas` com A2 → 200.
- Gravar, negado e intacto (foto e log com 0 linhas): `gestorA1` com `conta_id` A2 → 403; `gestorNenhuma` com A1 → 403; `leitor`, `superA1` → 403; `impersonado` → 403 com a frase; `"pesos":"x"`, `"pesos":{"a":"texto"}`, `"metas":null`, sem `limiares_resultado`, `"conta_id":"x"`, 51 chaves em `pesos` → 400; chave a mais (`"updated_by":…`) → 400 `corpo_invalido`.
- Histórico falhando desfaz tudo: o teste acrescenta `alter table gt_ponderada_config_log add constraint nunca check (false)`; `gestorA1` `PUT` válido → 400 `pedido_invalido` (23514) e a régua continua igual (foto).
- `TestReguaNaoPerdeMetaDeOutraConta` (determinístico): abre uma transação própria no pool que trava `id = 1` (`select … for update`) e grava `metas_por_conta = metas_por_conta || '{"<A3>": {"mensagens": 1}}'`; em outra goroutine, `gestorTodas` `PUT` com A1; espera 300 ms (o `PUT` está bloqueado na trava); confirma a transação; o `PUT` termina 200; o mapa final tem A1 (`8.5`), A2 e A3. Sem o `for update` antes da leitura, o `PUT` lê o mapa velho e apaga A3: o teste acusa.
- Interesses: `gestorA1` sem filtro → as duas linhas, a de M2 com `"account_id":null` e sem o uuid de A2; `?account_id=<A1>` → só M1; `?account_id=<A2>` → `[]`; `gestorTodas` `?account_id=<A2>` → M2 com `"account_id":"<A2>"`; `?marca_id=<M2>&objetivo=seguidores` como `gestorA1` → a linha de M2 (a tabela é aberta, como na fábrica hoje) com `account_id` nulo; `semModulo` → 200; `?marca_id=x` → 400.
- Mutações que têm de reprovar: tirar o `!autz.PodeVerConta(e, in.ContaID)` (o `gestorA1` muda as metas de A2); tirar o `select 1 … for update` (o teste determinístico perde A3); ignorar o erro do `tabelaReguaLog.Criar` (o caso "histórico falhando" deixa a régua gravada sem histórico); `{ler:fabrica_marcas:m}` → `true` (o `Validar` recusa: a API não sobe).

**(c) Arquivos:** Create `api/internal/trafego/regua.go`, `api/internal/trafego/regua_test.go`, `api/internal/trafego/interesses.go`, `api/internal/trafego/interesses_test.go`.

**(d) Dependências:** Task 3; `dados.Tabela.Editar/Criar`; `autz.PodeVerConta`.

- [ ] **Step 1:** Testes; ver falhar. - [ ] **Step 2:** Implementar. - [ ] **Step 3:** `gofmt -l ./internal && go vet ./internal/trafego/ && go test -count=1 -race ./internal/trafego/` PASS; mutações reprovam. - [ ] **Step 4:** Commit `feat(api): régua gravada numa transação com o histórico e sem perder a meta de outra conta; interesses sugeridos pela marca que se vê` (+ `Co-Authored-By`).

---

### Task 8: RPC `gt_registrar_problemas`

**Revisor:** opus. **Depende de:** 2 (`ParamConta`, `SoSessaoPropria`), 3.

**(a) Contrato**
- Portão = a checagem que a função faz por dentro (Ruling 26 do mestre): perfil com papel `admin` ou `'meta.gestor'` em `features` — **sem** `conta_ativa()` e **sem** super-admin (a função é SECURITY DEFINER e lê `profiles` direto; o ramo `service_role` não vale para sessão da API, Ruling 5 do mestre). `GestorDeTrafego` mora em `trafego` (como o `FrotaOuPatrimonio` do 5.2), não em `autz`.
- `ParamConta: "p_conta"` (Ruling 5.7-9): conta que quem pede não vê = `403` sem a função rodar — a função gravava e FECHAVA problemas de qualquer conta (o `update … set resolvido_em` de `p_conta`), e a tabela tem a restritiva de leitura. `SoSessaoPropria: true` (grava).
- Parâmetros e retorno de `02-funções.csv:1210` (`p_conta text, p_itens jsonb`, sem default; `RETURNS integer` → `rpc.Valor`). Erros da função chegam com a frase: `Falta dizer de qual conta e a lista.` → `400 regra_de_negocio`.

```go
package trafego

import (
	"github.com/rbv-co/social-dashboard/api/internal/autz"
	"github.com/rbv-co/social-dashboard/api/internal/rpc"
)

// GestorDeTrafego: a checagem de gt_registrar_problemas (02-funções.csv:1223-1229): perfil com papel admin
// ou 'meta.gestor' em features. Sem conta_ativa e sem super-admin, como a função (a sessão de conta
// desativada nem existe: auth.Exigir a recusa).
var GestorDeTrafego = autz.Regra(func(e *autz.Escopo) bool {
	return e != nil && e.TemPerfil && (e.Papel == "admin" || e.Modulo("meta.gestor"))
})

// FuncoesRPC: as RPCs do 5.7 na lista branca de POST /rpc/{nome} (web.FuncoesRPC as junta).
var FuncoesRPC = []rpc.Funcao{
	{Nome: "gt_registrar_problemas", Retorno: rpc.Valor, Portao: GestorDeTrafego, SoSessaoPropria: true, ParamConta: "p_conta",
		Params: []rpc.Param{{Nome: "p_conta", Tipo: "text"}, {Nome: "p_itens", Tipo: "jsonb"}}},
}
```

**(b) Testes de aceitação** (`problemas_test.go`; `montarRPCs` monta a lista como `web.Rotas`, no grupo de domínio)

```go
func montarRPCs(r chi.Router, p *pgxpool.Pool) {
	reg, err := rpc.Novo(p, FuncoesRPC...)
	deve(err)
	r.Post("/rpc/{nome}", reg.ServeHTTP)
}
```

- `TestPortaoDoGestorIgualAFuncao`: para cada pessoa do mundo, mais uma sem perfil (`a5710000-0000-4000-a000-000000000099`, só em `usuarios`), `GestorDeTrafego(CarregarEscopo(id))` = a função de produção chamada como a pessoa em `banco.ComUsuario` com `p_conta = '<A3>'` e `'[]'` (permitida = sem erro; negada = `P0001` com `Sem permissao na Gestao de Trafego.`), desfazendo a transação (o `fn` devolve um erro sentinela depois da chamada). O mundo mostra os dois lados; o `desativado` (papel admin) passa nos dois (a função não olha `conta_ativa`) e o `superA1` é negado nos dois.
- `TestRegistrarProblemas` (`novoMundo(t, montarRPCs)`; "intacto" = foto igual):
  - `gestorA1` `{"p_conta":"<A1>","p_itens":[{"ad_id":"7005","codigo":3,"titulo":"Novo"},{"ad_id":"7005","codigo":3,"titulo":"Repetido"}]}` → 200 `1`; efeitos: `7005/3` existe com `account_id = A1` e `titulo = 'Novo'` (o primeiro vence: `distinct on`); `7001/1` (A1, fora da lista) com `resolvido_em` preenchido; `7002/2` (A2) continua aberto.
  - Negados e intactos: `gestorA1` `{"p_conta":"<A2>","p_itens":[]}` → 403 (os problemas de A2 continuam abertos); `p_conta` A3 → 403 igual; `gestorNenhuma` com A1 → 403; `leitor`, `superA1`, `semModulo` → 403 (portão, a função não roda); `impersonado` com A1 → 403 com "Quem entrou como outra pessoa"; `{"p_conta":5,"p_itens":[]}` → 400 "p_conta deve ser texto"; `{"p_conta":"<A1>"}` (sem `p_itens`) → 400 `falta o parâmetro p_itens`.
  - `adminA1` `{"p_conta":"<A2>","p_itens":[]}` → 200 `0` e `7002/2` fechado (papel admin vê todas). `gestorTodas` `{"p_conta":"","p_itens":[]}` → 400 `regra_de_negocio` com `Falta dizer de qual conta e a lista.`; `gestorA1` com `""` → 403 (o vazio não é conta que ele vê).
- Mutações que têm de reprovar: `ParamConta: ""` (o `gestorA1` fecha os problemas de A2: 200); `SoSessaoPropria: false` (o impersonado grava); portão com `|| e.SuperFicha` (a comparação com a função acusa o `superA1`); `Retorno: rpc.Nada` (a resposta deixa de trazer a contagem).

**(c) Arquivos:** Create `api/internal/trafego/problemas.go`, `api/internal/trafego/problemas_test.go`.

**(d) Dependências:** Tasks 2 e 3; `rpc.Novo`.

- [ ] **Step 1:** Testes; ver falhar. - [ ] **Step 2:** Implementar. - [ ] **Step 3:** gofmt/vet/test PASS; mutações reprovam. - [ ] **Step 4:** Commit `feat(api): gt_registrar_problemas na lista branca com o portão da função e a conta conferida antes de gravar` (+ `Co-Authored-By`).

---

### Task 9: `mapa` — `POST /buscar-lugar`

**Revisor:** opus (SSRF). **Depende de:** — (pacote novo; a montagem é da Task 11).

**(a) Contrato** (o da edge `supabase/functions/buscar-lugar/index.ts`; o front troca só a URL — gt:4273, 4298; painel-subir.vue:125, 153)
- Portão: `auth.ExigirModulo("meta")` na montagem (a edge: papel `admin` ou `meta` em `features`; o `ExigirModulo` também deixa passar o super-admin pela ficha, como no `meta-proxy`: Ruling 5.7-14). Sem ator no contexto → `401` (falha fechada).
- `{"acao":"buscar","termo":"<texto>"}`: termo aparado com 3 a 200 caracteres (`400 {"error":"digite pelo menos 3 letras"}` / `400 {"error":"termo longo demais"}`); `GET <Nominatim>/search?format=jsonv2&addressdetails=1&limit=8&countrycodes=br&q=<termo>` → `200 {"lugares": <array do Nominatim>}`; do cache → `{"lugares": …, "doCache": true}`.
- `{"acao":"ondeCaiu","lat":<número>,"lng":<número>}`: `lat` em [-90, 90] e `lng` em [-180, 180], senão `400 {"error":"coordenada invalida"}`; `GET <Nominatim>/reverse?format=jsonv2&addressdetails=1&lat=<lat>&lon=<lng>` → `200` com o objeto do Nominatim; do cache → o mesmo objeto com `"doCache": true`. Chave do cache com 5 casas (`ondeCaiu:%.5f,%.5f`, ~1 m).
- Outra ação → `400 {"error":"acao desconhecida"}`; corpo que não é o objeto → `400 {"error":"corpo_invalido"}` (`dados.LerCorpo`).
- Upstream ≠ 2xx → `502 {"error":"o servico de mapa respondeu <status>"}`; sem resposta (rede, prazo) → `502 {"error":"o servico de mapa nao respondeu"}`; resposta que não é JSON (ou passa de 1 MiB) → `502 {"error":"o servico de mapa respondeu algo ilegivel"}`. Erro nunca vai para o cache; objeto do `reverse` com a chave `error` (mar, por exemplo) volta como a edge devolvia, mas também não vai para o cache.
- Cache em memória (paridade com a edge): 24 h, até 500 chaves (cheio: sai uma qualquer). Uma ligação por vez ao Nominatim e pelo menos 1 s entre elas (a regra de uso deles); quem espera desiste com o prazo da rota. Limite por pessoa: 60 por minuto (`429 {"error":"muitas buscas seguidas; espere um minuto"}`), contado antes do cache.
- SSRF: o endereço é a constante `nominatim` (campo não exportado `base`; só os testes do pacote o trocam); caminho fixo (`/search`, `/reverse`); termo e coordenadas só em `url.Values`; redirecionamento NÃO é seguido; `User-Agent` = o da edge (`QUEM_SOU`).
- Log: só `acao`, `status` e `doCache` — nunca termo nem coordenada.

```go
// Package mapa: POST /buscar-lugar, a recepção do mapa (supabase/functions/buscar-lugar/index.ts): quem
// liga para o Nominatim (OpenStreetMap) em nome da Central, identificado, devagar e com memória — a regra
// de uso deles pede User-Agent e nada de rajada. Serve à Gestão de Tráfego e à Fábrica.
package mapa

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/rbv-co/social-dashboard/api/internal/auth"
	"github.com/rbv-co/social-dashboard/api/internal/dados"
)

const (
	nominatim = "https://nominatim.openstreetmap.org"
	// a identificação que a regra de uso do Nominatim pede (a mesma da edge)
	quemSou       = "iamundi-central-inteligencia/1.0 (contato: erick@rbvcompany.com)"
	validade      = 24 * time.Hour
	tetoDoCache   = 500
	tetoDaResposta = 1 << 20
)

type guardado struct {
	quando time.Time
	valor  []byte
}

// Mapa: o handler. Os campos não exportados só são trocados pelos testes deste pacote (o endereço do
// Nominatim é constante em produção: Ruling 5.7-14).
type Mapa struct {
	base      string
	http      *http.Client
	intervalo time.Duration
	lim       *auth.Limitador
	vez       chan struct{} // uma ligação por vez
	mu        sync.Mutex    // ultima e cache
	ultima    time.Time
	cache     map[string]guardado
}

func Novo() *Mapa {
	lim := auth.NovoLimitador()
	lim.Max, lim.Janela = 60, time.Minute
	return &Mapa{base: nominatim, intervalo: time.Second, lim: lim, vez: make(chan struct{}, 1), cache: map[string]guardado{},
		http: &http.Client{CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}}
}

func erro(w http.ResponseWriter, status int, frase string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(map[string]string{"error": frase})
}

func (m *Mapa) doCache(chave string) ([]byte, bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	g, ok := m.cache[chave]
	if !ok || time.Since(g.quando) > validade {
		delete(m.cache, chave)
		return nil, false
	}
	return g.valor, true
}

func (m *Mapa) guardar(chave string, valor []byte) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if len(m.cache) >= tetoDoCache {
		for k := range m.cache { // ponytail: sai uma chave qualquer; LRU se o volume crescer
			delete(m.cache, k)
			break
		}
	}
	m.cache[chave] = guardado{time.Now(), valor}
}

// ligar faz UMA chamada ao Nominatim, na vez dela e respeitando o intervalo. Devolve o corpo (até 1 MiB),
// o status, ou o erro de rede/prazo.
func (m *Mapa) ligar(ctx context.Context, caminho string, q url.Values) ([]byte, int, error) {
	select {
	case m.vez <- struct{}{}:
	case <-ctx.Done():
		return nil, 0, ctx.Err()
	}
	defer func() {
		m.mu.Lock()
		m.ultima = time.Now()
		m.mu.Unlock()
		<-m.vez
	}()
	m.mu.Lock()
	espera := m.intervalo - time.Since(m.ultima)
	m.mu.Unlock()
	if espera > 0 {
		select {
		case <-time.After(espera):
		case <-ctx.Done():
			return nil, 0, ctx.Err()
		}
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, m.base+caminho+"?"+q.Encode(), nil)
	if err != nil {
		return nil, 0, err
	}
	req.Header.Set("User-Agent", quemSou)
	req.Header.Set("Accept-Language", "pt-BR")
	res, err := m.http.Do(req)
	if err != nil {
		return nil, 0, err
	}
	defer res.Body.Close()
	corpo, err := io.ReadAll(io.LimitReader(res.Body, tetoDaResposta+1))
	return corpo, res.StatusCode, err
}

// buscarFora: cache → Nominatim → valida → (guarda). ok=false quando já respondeu o erro.
func (m *Mapa) buscarFora(w http.ResponseWriter, r *http.Request, acao, chave, caminho string, q url.Values) ([]byte, bool, bool) {
	if v, ok := m.doCache(chave); ok {
		return v, true, true
	}
	corpo, status, err := m.ligar(r.Context(), caminho, q)
	switch {
	case err != nil:
		slog.Warn("buscar-lugar: o Nominatim não respondeu", "acao", acao)
		erro(w, http.StatusBadGateway, "o servico de mapa nao respondeu")
		return nil, false, false
	case status < 200 || status > 299:
		slog.Warn("buscar-lugar: o Nominatim recusou", "acao", acao, "status", status)
		erro(w, http.StatusBadGateway, "o servico de mapa respondeu "+strconv.Itoa(status))
		return nil, false, false
	case len(corpo) > tetoDaResposta || !json.Valid(corpo):
		erro(w, http.StatusBadGateway, "o servico de mapa respondeu algo ilegivel")
		return nil, false, false
	}
	return corpo, false, true
}

func (m *Mapa) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	a := auth.AtorDoContexto(r.Context())
	if a == nil {
		erro(w, http.StatusUnauthorized, "nao_autenticado")
		return
	}
	var in struct {
		Acao  string   `json:"acao"`
		Termo string   `json:"termo"`
		Lat   *float64 `json:"lat"`
		Lng   *float64 `json:"lng"`
	}
	if !dados.LerCorpo(w, r, &in) {
		return
	}
	if !m.lim.Tentar(a.ID) {
		erro(w, http.StatusTooManyRequests, "muitas buscas seguidas; espere um minuto")
		return
	}
	switch in.Acao {
	case "buscar":
		termo := strings.TrimSpace(in.Termo)
		switch n := utf8.RuneCountInString(termo); {
		case n < 3:
			erro(w, http.StatusBadRequest, "digite pelo menos 3 letras")
			return
		case n > 200:
			erro(w, http.StatusBadRequest, "termo longo demais")
			return
		}
		// countrycodes=br: as contas anunciam no Brasil (o mesmo recorte da edge)
		q := url.Values{"format": {"jsonv2"}, "addressdetails": {"1"}, "limit": {"8"}, "countrycodes": {"br"}, "q": {termo}}
		corpo, doCache, ok := m.buscarFora(w, r, in.Acao, "buscar:"+strings.ToLower(termo), "/search", q)
		if !ok {
			return
		}
		if !doCache {
			m.guardar("buscar:"+strings.ToLower(termo), corpo)
		}
		saida := `{"lugares":` + string(corpo)
		if doCache {
			saida += `,"doCache":true`
		}
		dados.Responder(w, http.StatusOK, []byte(saida+"}"))
	case "ondeCaiu":
		if in.Lat == nil || in.Lng == nil || *in.Lat < -90 || *in.Lat > 90 || *in.Lng < -180 || *in.Lng > 180 {
			erro(w, http.StatusBadRequest, "coordenada invalida")
			return
		}
		chave := fmt.Sprintf("ondeCaiu:%.5f,%.5f", *in.Lat, *in.Lng)
		q := url.Values{"format": {"jsonv2"}, "addressdetails": {"1"},
			"lat": {strconv.FormatFloat(*in.Lat, 'f', -1, 64)}, "lon": {strconv.FormatFloat(*in.Lng, 'f', -1, 64)}}
		corpo, doCache, ok := m.buscarFora(w, r, in.Acao, chave, "/reverse", q)
		if !ok {
			return
		}
		var lugar map[string]json.RawMessage
		if json.Unmarshal(corpo, &lugar) != nil {
			erro(w, http.StatusBadGateway, "o servico de mapa respondeu algo ilegivel")
			return
		}
		if doCache {
			lugar["doCache"] = json.RawMessage("true")
			corpo, _ = json.Marshal(lugar)
		} else if _, falhou := lugar["error"]; !falhou {
			m.guardar(chave, bytes.Clone(corpo))
		}
		dados.Responder(w, http.StatusOK, corpo)
	default:
		erro(w, http.StatusBadRequest, "acao desconhecida")
	}
}
```

**(b) Testes de aceitação** (`mapa_test.go`; o Nominatim de mentira é um `httptest.Server` que grava cada pedido — método, caminho, query, `User-Agent` — e responde conforme o caso; `m := Novo(); m.base = srv.URL; m.intervalo = 50 * time.Millisecond`; o ator vai no contexto por `auth.NoContexto`)
- `TestBuscarLugar`:
  - `buscar "Shopping Iguatemi"` → 200 `{"lugares":[…]}`; o servidor recebeu `GET /search` com `q=Shopping Iguatemi`, `countrycodes=br`, `format=jsonv2`, `limit=8`, `addressdetails=1` e `User-Agent` = `quemSou`. De novo com `"  shopping iguatemi "` → 200 com `"doCache":true` e o servidor continua com 1 pedido.
  - SSRF: termo `"../../admin?x=1@evil.com/%2F"` → o servidor recebeu caminho EXATAMENTE `/search` e `q` igual ao termo (aparado); um segundo `httptest` que conta pedidos, para onde o primeiro responde `302 Location`, recebe 0 pedidos e a resposta é `502 "o servico de mapa respondeu 302"`; `Novo().base == "https://nominatim.openstreetmap.org"`.
  - `ondeCaiu {"lat":-23.5,"lng":-46.6}` → 200 com o objeto; o servidor recebeu `GET /reverse` com `lat=-23.5&lon=-46.6`; de novo com `-23.500001` (mesma chave de 5 casas) → 200 com `"doCache":true`, 1 pedido. Objeto com `"error":"Unable to geocode"` → 200 igual à edge, e o seguinte vai de novo ao servidor (não guardou).
  - Negados SEM pedido ao servidor (contagem igual): `"ab"`, termo de 201 caracteres, `"lat":91`, `"lng":-181`, sem `lat`, `"acao":"apagar"`, corpo `lixo`, `{"acao":"buscar","termo":"abc","extra":1}`; sem ator → 401.
  - Upstream 503 → `502 "o servico de mapa respondeu 503"` e o seguinte pede de novo; corpo de 1 MiB + 1 byte → `502 … ilegivel`; servidor que não responde dentro do prazo do contexto (100 ms no teste) → `502 "o servico de mapa nao respondeu"`.
  - Ritmo: três termos diferentes seguidos → os pedidos chegam ao servidor com pelo menos `m.intervalo` entre eles (o servidor grava `time.Now()`).
  - Limite: `m.lim.Max = 2`; o terceiro pedido da mesma pessoa → 429 com a frase e nenhum pedido novo; outra pessoa continua 200.
- `TestBuscarLugarSemTermoNoLog`: com `slog` num buffer, um `buscar` e um `ondeCaiu` → o log não contém o termo nem `-23.5`.
- Mutações que têm de reprovar: `CheckRedirect` removido (o segundo servidor recebe o pedido); `m.base + "/" + in.Termo` no caminho (o caso SSRF acusa); tirar o `select` da vez (o ritmo acusa); guardar antes de validar o status (o 503 vira cache).

**(c) Arquivos:** Create `api/internal/mapa/mapa.go`, `api/internal/mapa/mapa_test.go`.

**(d) Dependências:** `auth.NovoLimitador/AtorDoContexto/NoContexto`; `dados.LerCorpo/Responder`.

- [ ] **Step 1:** Testes; ver falhar. - [ ] **Step 2:** Implementar (código de (a)). - [ ] **Step 3:** `gofmt -l ./internal && go vet ./internal/mapa/ && go test -count=1 -race ./internal/mapa/` PASS; mutações reprovam. - [ ] **Step 4:** Commit `feat(api): buscar-lugar falando só com o Nominatim, uma ligação por segundo, com cache e limite por pessoa` (+ `Co-Authored-By`).

---

### Task 10: `ia` — `POST /sugerir-publico-ia` e `POST /ler-documento`

**Revisor:** opus (custo de IA, segredo). **Depende de:** — (só `autz.PodeVerConta`, do 5.6; a montagem é da Task 11).

**(a) Contrato** (o das edges `supabase/functions/sugerir-publico-ia/index.ts` e `ler-documento/index.ts`: mesmo corpo, mesmas respostas e frases, mesmo modelo, `max_tokens` e prompt — o front troca só a URL, gt:3892, 5074 e gt:1308 —, com estas diferenças por Ruling)
- Portão na montagem: `auth.ExigirModulo("meta.gestor")` = o das duas edges (papel `admin`, super-admin pela ficha ou `meta.gestor` em `features`). `sugerir-publico-ia` também passa por `autz.ComEscopo`.
- Chave: `config.IATrafego` (`ANTHROPIC_API_KEY_TRAFEGO`), nunca da tabela `segredos_de_cron`. Vazia → `503 {"error":"chave_nao_configurada","comoResolver":"Configure ANTHROPIC_API_KEY_TRAFEGO no serviço api e reinicie."}` sem chamar a Anthropic (Ruling 5.7-11).
- `sugerir-publico-ia`: corpo `{evidencia: <objeto>, modo?: "texto", marca?, objetivo?, persona?, contaId: <uuid>}` (`dados.LerCorpo`: 1 MiB, campo desconhecido = `400 {"error":"corpo_invalido"}`). `evidencia` que não é objeto → `400 {"error":"sem_evidencia"}`. **`contaId` novo e obrigatório** (Ruling 5.7-13): ausente/inválido → `400 {"error":"sem_conta"}`; conta que a pessoa não vê (`autz.PodeVerConta`) → `404 {"error":"conta_nao_encontrada"}`. `marca` e `objetivo` cortados em 200 caracteres; `persona` aparada e cortada em 4000 (como a edge). Prompt verbatim (`prompts.go`, abaixo; a evidência entra compactada e cortada em 6000/7000 caracteres, como o `JSON.stringify(ev).slice`). Respostas: `200 {ok, leitura, interesses|sugestoes, cuidado, uso}`; `502 {"error":"anthropic_inacessivel","detalhe"}`, `502 {"error":"anthropic_recusou","status","detalhe"}`, `502 {"error":"resposta_ilegivel","bruto"}`.
- `ler-documento`: corpo `{base64, limite?}` lido até 4,6 MB (`413 {"error":"arquivo_grande_demais","detalhe":"O PDF passa do limite de 3 MB."}` acima disso); base64 sem espaços vazio → `400 {"error":"sem_arquivo"}`; maior que 4.500.000 → `413` com o `detalhe` da edge (`O PDF tem cerca de N MB e o limite aqui é 3 MB.`); **que não decodifica ou não começa com `%PDF-` → `400 {"error":"nao_e_pdf","detalhe":"O arquivo não é um PDF."}` sem gastar a chamada** (Ruling 5.7-12). `limite`: número ≥ 1 → `min(limite, 8000)`; senão 4000. Respostas: `200 {ok:true, texto, uso}`; os `502` da edge (`anthropic_inacessivel`, `anthropic_recusou`, `recusado_pela_ia`, `sem_texto`).
- Limite por pessoa (Ruling 5.7-12), contado depois das validações e da chave, antes da chamada: `sugerir-publico-ia` 30 por hora (`429 {"error":"muitas_leituras","detalhe":"São no máximo 30 leituras da IA por hora por pessoa."}`), `ler-documento` 10 por hora (`429 {"error":"muitos_documentos","detalhe":"São no máximo 10 PDFs por hora por pessoa."}`).
- Saída para a Anthropic: URL constante (`urlAnthropic`, campo não exportado; só os testes do pacote trocam), sem seguir redirecionamento, resposta lida até 4 MiB, prazo = o da rota (`web.PrazoIA`). Cabeçalhos `x-api-key`, `anthropic-version: 2023-06-01`, `content-type: application/json` (os da edge). HTTP cru, sem SDK (Ruling 5.7-11).
- Log (Ruling 5.7-15): uma linha por chamada — `rota`, `pessoa`, `status`, `uso` (contagem de tokens), `ms`, `bytes_pdf`. Nunca chave, prompt, persona, evidência, documento nem o corpo de erro da Anthropic (o `detalhe` vai só na resposta, como na edge).

`api/internal/ia/claude.go`:

```go
// Package ia: os proxies de IA da Gestão de Tráfego (supabase/functions/sugerir-publico-ia e
// ler-documento): o navegador nunca vê a chave da Anthropic; a API confere quem pode, limita o gasto por
// pessoa e repassa o corpo que a edge mandava. A chave vem de ANTHROPIC_API_KEY_TRAFEGO (spec §11).
package ia

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"unicode/utf8"
)

const urlAnthropic = "https://api.anthropic.com/v1/messages"

// claude: o cliente mínimo do Messages API. url só é trocada pelos testes deste pacote.
type claude struct {
	chave string
	url   string
	http  *http.Client
}

type resposta struct {
	Content []struct {
		Type string `json:"type"`
		Text string `json:"text"`
	} `json:"content"`
	StopReason string          `json:"stop_reason"`
	Usage      json.RawMessage `json:"usage"`
	Error      *struct {
		Message string `json:"message"`
	} `json:"error"`
}

// enviar: POST do corpo. err = não houve resposta (rede, prazo); senão o status, a resposta lida (corpo
// que não é JSON vira resposta vazia, como o `.catch(() => ({}))` da edge) e o corpo cru.
func (c *claude) enviar(ctx context.Context, corpo any) (int, resposta, []byte, error) {
	j, err := json.Marshal(corpo)
	if err != nil {
		return 0, resposta{}, nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.url, bytes.NewReader(j))
	if err != nil {
		return 0, resposta{}, nil, err
	}
	req.Header.Set("x-api-key", c.chave)
	req.Header.Set("anthropic-version", "2023-06-01")
	req.Header.Set("content-type", "application/json")
	res, err := c.http.Do(req)
	if err != nil {
		return 0, resposta{}, nil, err
	}
	defer res.Body.Close()
	bruto, _ := io.ReadAll(io.LimitReader(res.Body, 4<<20))
	var r resposta
	_ = json.Unmarshal(bruto, &r)
	return res.StatusCode, r, bruto, nil
}

// detalheDoErro: `d?.error?.message || JSON.stringify(d).slice(0, 500)` da edge.
func detalheDoErro(r resposta, bruto []byte) string {
	if r.Error != nil && r.Error.Message != "" {
		return r.Error.Message
	}
	var b bytes.Buffer
	if json.Compact(&b, bruto) != nil {
		return "{}"
	}
	return cortar(b.String(), 500)
}

// cortar: os primeiros n caracteres (o .slice(0, n) da edge conta unidades UTF-16; aqui, caracteres).
func cortar(s string, n int) string {
	if utf8.RuneCountInString(s) <= n {
		return s
	}
	return string([]rune(s)[:n])
}

func usoOuNulo(u json.RawMessage) json.RawMessage {
	if len(bytes.TrimSpace(u)) == 0 {
		return json.RawMessage("null")
	}
	return u
}

// decodificar: JSON com números exatos (id de interesse da Meta não passa por float64).
func decodificar(b []byte, v any) error {
	d := json.NewDecoder(bytes.NewReader(b))
	d.UseNumber()
	return d.Decode(v)
}

// textoDe: o `String(x || '')` da edge para texto e número; outro tipo sai vazio.
func textoDe(v any) string {
	switch x := v.(type) {
	case string:
		return x
	case json.Number:
		if x == "0" {
			return ""
		}
		return string(x)
	}
	return ""
}
```

`api/internal/ia/prompts.go` (os textos são os da edge, caractere a caractere: `index.ts:148-235`):

```go
package ia

import "strings"

func se(cond bool, s string) string {
	if cond {
		return s
	}
	return ""
}

// juntarSemVazias: o `.filter(Boolean).join('\n')` da edge — tira TODA linha vazia, inclusive as de espaço
// que o array tinha.
func juntarSemVazias(linhas []string) string {
	var out []string
	for _, l := range linhas {
		if l != "" {
			out = append(out, l)
		}
	}
	return strings.Join(out, "\n")
}

func blocoPersona(persona string) []string {
	if persona == "" {
		return nil
	}
	return []string{
		"QUEM A MARCA ATENDE, nas palavras do dono do negócio. Isto é verdade sobre a marca e vale MAIS que qualquer padrão que você encontrar nos números:",
		"<persona>",
		persona,
		"</persona>",
		"Se os números apontarem para um público que contradiz esta descrição, NÃO o recomende: diga na leitura que os números vão para outro lado e por quê. Número de conta mostra quem clicou, não para quem a marca quer vender.",
		"",
	}
}

func montarPrompt(ev, marca, objetivo, persona string) string {
	l := []string{
		"Você ajuda quem cuida de anúncios no Meta Ads de um negócio pequeno, e escreve em português do Brasil, direto, sem jargão.",
		se(marca != "", "A marca é: "+marca+"."),
		se(objetivo != "", "O tipo de campanha que está sendo criada: "+objetivo+"."),
		"",
	}
	l = append(l, blocoPersona(persona)...)
	l = append(l,
		"Estes números são REAIS, medidos nos últimos 90 dias desta conta de anúncios. Não invente outros, não recalcule, não estime:",
		"```json",
		cortar(ev, 6000),
		"```",
		"",
		"Sua tarefa:",
		"1. Escreva uma LEITURA de no máximo 4 frases dizendo o que estes números indicam sobre para quem anunciar — idade, onde e interesses. Cite os números que sustentam cada afirmação.",
		"2. Escolha os interesses que valem a pena manter, ENTRE OS QUE JÁ APARECEM na evidência. Não invente interesses novos nem ids.",
		"   ESCOLHER É DEIXAR DE FORA: devolva SÓ os que você recomenda de verdade. Se um não combina com a marca, não o inclua na lista — mesmo que ele venha dos conjuntos baratos. Explique na leitura por que o deixou de fora.",
		"   Se nenhum valer a pena, devolva a lista vazia.",
		"3. Escreva um CUIDADO de uma frase: o principal risco de seguir esta leitura (por exemplo, público pequeno demais, ou dado concentrado em poucos conjuntos).",
		"",
		"Se os números não sustentarem uma conclusão, diga isso na leitura em vez de inventar uma.",
		"",
		"Responda SÓ com JSON, neste formato:",
		`{"leitura":"...","interesses":[{"id":"...","nome":"..."}],"cuidado":"..."}`,
	)
	return juntarSemVazias(l)
}

func promptDeTexto(ev, marca, objetivo, persona string) string {
	l := []string{
		"Você escreve texto de anúncio para o Meta Ads de um negócio pequeno, em português do Brasil.",
		se(marca != "", "A marca é: "+marca+"."),
		se(objetivo != "", "O tipo de campanha: "+objetivo+"."),
		"",
	}
	l = append(l, blocoPersona(persona)...)
	l = append(l,
		"Estes são os textos que esta conta JÁ RODOU, com o custo real por resultado. São medidos, não estimados:",
		"```json",
		cortar(ev, 7000),
		"```",
		"",
		"ATENÇÃO: os itens em \"vagas\" são anúncios de EMPREGO. Eles têm o custo mais baixo da conta porque",
		"gente se candidata — e NÃO servem de modelo para vender produto. Não copie o tom deles, não os cite",
		"como exemplo a seguir, e não escreva nada que pareça recrutamento.",
		"",
		"Sua tarefa:",
		"1. LEITURA: em no máximo 3 frases, o que separa os textos baratos dos caros NESTA conta. Cite os números.",
		"2. SUGESTOES: escreva 3 textos novos de anúncio, no que a evidência mostra que funciona aqui.",
		"   Cada um com no máximo 3 linhas. Português simples, sem jargão de marketing e sem promessa que a marca não fez.",
		"   Não invente desconto, preço, prazo nem condição que não apareça na evidência.",
		"3. CUIDADO: uma frase sobre o principal risco de seguir esta leitura.",
		"",
		"Responda SÓ com JSON:",
		`{"leitura":"...","sugestoes":["...","...","..."],"cuidado":"..."}`,
	)
	return juntarSemVazias(l)
}

// extrairJSON: o objeto da resposta, inteiro ou o primeiro `{` até o último `}` (o extrairJson da edge).
// Diferente da edge, só objeto vale (um array viraria "undefined" na leitura).
func extrairJSON(texto string) map[string]any {
	var m map[string]any
	if decodificar([]byte(texto), &m) == nil && m != nil {
		return m
	}
	i, f := strings.Index(texto, "{"), strings.LastIndex(texto, "}")
	if i < 0 || f <= i {
		return nil
	}
	m = nil
	if decodificar([]byte(texto[i:f+1]), &m) == nil && m != nil {
		return m
	}
	return nil
}

type interesse struct {
	ID   string `json:"id"`
	Nome string `json:"nome"`
}

// filtrarInteresses: SÓ os que existem na evidência (a IA escolhe; não cria), sem repetir, com o nome da
// evidência (o filtrarInteresses da edge). Nunca nil: a resposta leva [].
func filtrarInteresses(escolhidos any, ev map[string]any) []interesse {
	validos := map[string]string{}
	lista, _ := ev["interesses"].([]any)
	for _, x := range lista {
		i, _ := x.(map[string]any)
		chave := textoDe(i["key"])
		if chave == "" {
			continue
		}
		nome := textoDe(i["nome"])
		if nome == "" {
			nome = chave
		}
		validos[chave] = nome
	}
	saida := []interesse{}
	esc, _ := escolhidos.([]any)
	for _, x := range esc {
		e, _ := x.(map[string]any)
		id := textoDe(e["id"])
		nome, ok := validos[id]
		if !ok || id == "" {
			continue
		}
		repetido := false
		for _, s := range saida {
			repetido = repetido || s.ID == id
		}
		if !repetido {
			saida = append(saida, interesse{id, nome})
		}
	}
	return saida
}

// sugestoesDe: `.slice(0, 3).map(t => String(t || '').slice(0, 600)).filter(Boolean)` — corta ANTES de
// filtrar, como a edge.
func sugestoesDe(v any) []string {
	lista, _ := v.([]any)
	if len(lista) > 3 {
		lista = lista[:3]
	}
	saida := []string{}
	for _, x := range lista {
		if s := cortar(textoDe(x), 600); s != "" {
			saida = append(saida, s)
		}
	}
	return saida
}
```

`api/internal/ia/ia.go`:

```go
package ia

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"math"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/rbv-co/social-dashboard/api/internal/auth"
	"github.com/rbv-co/social-dashboard/api/internal/autz"
	"github.com/rbv-co/social-dashboard/api/internal/dados"
)

const (
	// os modelos e tetos das edges, sem troca na migração (Ruling 5.7-11; achado 5)
	modeloPublico      = "claude-opus-4-5" // sugerir-publico-ia/index.ts:28
	maxTokensPublico   = 1600              // index.ts:35 (o valor que estava no ar)
	modeloDocumento    = "claude-opus-5"   // ler-documento/index.ts:24
	maxTokensDocumento = 8000              // index.ts:27
	maxBase64          = 4_500_000         // index.ts:31 (~3,3 MB de PDF)
	tetoCorpoDocumento = maxBase64 + 100_000
)

var reUUID = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)

// IA: os dois handlers. Monte DEPOIS de auth.Exigir e auth.ExigirModulo("meta.gestor"); o SugerirPublico
// também depois de autz.ComEscopo.
type IA struct {
	claude                   *claude
	limSugerir, limDocumento *auth.Limitador
}

func Nova(chave string) *IA {
	s, d := auth.NovoLimitador(), auth.NovoLimitador()
	s.Max, s.Janela = 30, time.Hour // ponytail: em memória, uma instância; teto de gasto no painel da Anthropic é a segunda barreira
	d.Max, d.Janela = 10, time.Hour
	return &IA{limSugerir: s, limDocumento: d, claude: &claude{chave: chave, url: urlAnthropic,
		http: &http.Client{CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}}}
}

type obj = map[string]any

func responder(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

var semChave = obj{"error": "chave_nao_configurada", "comoResolver": "Configure ANTHROPIC_API_KEY_TRAFEGO no serviço api e reinicie."}

// registrar: a única linha de log por chamada (Ruling 5.7-15).
func registrar(rota, pessoa string, status int, uso json.RawMessage, inicio time.Time, bytesPDF int) {
	slog.Info("ia: chamada à Anthropic", "rota", rota, "pessoa", pessoa, "status", status,
		"uso", string(usoOuNulo(uso)), "ms", time.Since(inicio).Milliseconds(), "bytes_pdf", bytesPDF)
}

type saidaPublico struct {
	Ok         bool            `json:"ok"`
	Leitura    string          `json:"leitura"`
	Interesses []interesse     `json:"interesses"`
	Cuidado    string          `json:"cuidado"`
	Uso        json.RawMessage `json:"uso"`
}

type saidaTexto struct {
	Ok        bool            `json:"ok"`
	Leitura   string          `json:"leitura"`
	Sugestoes []string        `json:"sugestoes"`
	Cuidado   string          `json:"cuidado"`
	Uso       json.RawMessage `json:"uso"`
}

// SugerirPublico: POST /sugerir-publico-ia.
func (ia *IA) SugerirPublico(w http.ResponseWriter, r *http.Request) {
	a, e := auth.AtorDoContexto(r.Context()), autz.EscopoDo(r.Context())
	if a == nil || e == nil {
		slog.Error("ia: sugerir-publico-ia montada sem auth.Exigir ou autz.ComEscopo")
		responder(w, http.StatusInternalServerError, obj{"error": "erro_interno"})
		return
	}
	var in struct {
		Evidencia json.RawMessage `json:"evidencia"`
		Modo      string          `json:"modo"`
		Marca     string          `json:"marca"`
		Objetivo  string          `json:"objetivo"`
		Persona   string          `json:"persona"`
		ContaID   string          `json:"contaId"`
	}
	if !dados.LerCorpo(w, r, &in) {
		return
	}
	var ev map[string]any
	if len(in.Evidencia) == 0 || in.Evidencia[0] != '{' || decodificar(in.Evidencia, &ev) != nil {
		responder(w, http.StatusBadRequest, obj{"error": "sem_evidencia"})
		return
	}
	if !reUUID.MatchString(in.ContaID) {
		responder(w, http.StatusBadRequest, obj{"error": "sem_conta"})
		return
	}
	if !autz.PodeVerConta(e, in.ContaID) { // Ruling 5.7-13: igual a conta inexistente
		responder(w, http.StatusNotFound, obj{"error": "conta_nao_encontrada"})
		return
	}
	if ia.claude.chave == "" {
		responder(w, http.StatusServiceUnavailable, semChave)
		return
	}
	if !ia.limSugerir.Tentar(a.ID) {
		responder(w, http.StatusTooManyRequests, obj{"error": "muitas_leituras", "detalhe": "São no máximo 30 leituras da IA por hora por pessoa."})
		return
	}
	var evc bytes.Buffer
	_ = json.Compact(&evc, in.Evidencia)
	marca, objetivo, persona := cortar(in.Marca, 200), cortar(in.Objetivo, 200), cortar(strings.TrimSpace(in.Persona), 4000)
	texto := in.Modo == "texto"
	prompt := montarPrompt(evc.String(), marca, objetivo, persona)
	if texto {
		prompt = promptDeTexto(evc.String(), marca, objetivo, persona)
	}
	inicio := time.Now()
	st, res, bruto, err := ia.claude.enviar(r.Context(), obj{"model": modeloPublico, "max_tokens": maxTokensPublico,
		"messages": []obj{{"role": "user", "content": prompt}}})
	registrar("sugerir-publico-ia", a.ID, st, res.Usage, inicio, 0)
	if err != nil {
		responder(w, http.StatusBadGateway, obj{"error": "anthropic_inacessivel", "detalhe": err.Error()})
		return
	}
	if st < 200 || st > 299 {
		responder(w, http.StatusBadGateway, obj{"error": "anthropic_recusou", "status": st, "detalhe": detalheDoErro(res, bruto)})
		return
	}
	var b strings.Builder
	for _, c := range res.Content {
		b.WriteString(c.Text)
	}
	saida := strings.TrimSpace(b.String())
	lido := extrairJSON(saida)
	if lido == nil {
		responder(w, http.StatusBadGateway, obj{"error": "resposta_ilegivel", "bruto": cortar(saida, 800)})
		return
	}
	leitura, cuidado, uso := cortar(textoDe(lido["leitura"]), 1200), cortar(textoDe(lido["cuidado"]), 400), usoOuNulo(res.Usage)
	if texto {
		responder(w, http.StatusOK, saidaTexto{true, leitura, sugestoesDe(lido["sugestoes"]), cuidado, uso})
		return
	}
	responder(w, http.StatusOK, saidaPublico{true, leitura, filtrarInteresses(lido["interesses"], ev), cuidado, uso})
}

// limiteDe: o `limite` da edge (min(Number(x), 8000), senão 4000), com piso 1: a edge aceitava 0 e
// negativo, que cortavam o texto do fim (Ruling 5.7-12).
func limiteDe(v json.RawMessage) int {
	var f float64
	if json.Unmarshal(v, &f) != nil || math.IsNaN(f) || math.IsInf(f, 0) || f < 1 {
		return 4000
	}
	return int(math.Min(f, 8000))
}

// LerDocumento: POST /ler-documento.
func (ia *IA) LerDocumento(w http.ResponseWriter, r *http.Request) {
	a := auth.AtorDoContexto(r.Context())
	if a == nil {
		slog.Error("ia: ler-documento montada sem auth.Exigir")
		responder(w, http.StatusInternalServerError, obj{"error": "erro_interno"})
		return
	}
	bruto, err := io.ReadAll(http.MaxBytesReader(w, r.Body, tetoCorpoDocumento))
	var grande *http.MaxBytesError
	if errors.As(err, &grande) {
		responder(w, http.StatusRequestEntityTooLarge, obj{"error": "arquivo_grande_demais", "detalhe": "O PDF passa do limite de 3 MB."})
		return
	}
	var in struct {
		Base64 string          `json:"base64"`
		Limite json.RawMessage `json:"limite"`
	}
	if err != nil || json.Unmarshal(bruto, &in) != nil {
		responder(w, http.StatusBadRequest, obj{"error": "corpo_invalido"})
		return
	}
	b64 := strings.Join(strings.Fields(in.Base64), "") // sem quebra de linha: a API recusa
	if b64 == "" {
		responder(w, http.StatusBadRequest, obj{"error": "sem_arquivo"})
		return
	}
	if len(b64) > maxBase64 {
		responder(w, http.StatusRequestEntityTooLarge, obj{"error": "arquivo_grande_demais", "detalhe": fmt.Sprintf(
			"O PDF tem cerca de %d MB e o limite aqui é %d MB.", int(math.Round(float64(len(b64))*0.75/1024/1024)), int(math.Round(maxBase64*0.75/1024/1024)))})
		return
	}
	pdf, err := base64.StdEncoding.DecodeString(b64)
	if err != nil || !bytes.HasPrefix(pdf, []byte("%PDF-")) { // Ruling 5.7-12: lixo não gasta chamada
		responder(w, http.StatusBadRequest, obj{"error": "nao_e_pdf", "detalhe": "O arquivo não é um PDF."})
		return
	}
	limite := limiteDe(in.Limite)
	if ia.claude.chave == "" {
		responder(w, http.StatusServiceUnavailable, semChave)
		return
	}
	if !ia.limDocumento.Tentar(a.ID) {
		responder(w, http.StatusTooManyRequests, obj{"error": "muitos_documentos", "detalhe": "São no máximo 10 PDFs por hora por pessoa."})
		return
	}
	// o pedido da edge (ler-documento/index.ts:84-95), com as linhas vazias (aqui não há filter)
	pedido := strings.Join([]string{
		"Este documento descreve PARA QUEM uma marca vende (persona, público-alvo, curadoria de marca).",
		"",
		"Devolva o conteúdo dele como TEXTO CORRIDO em português, para ser colado num campo de formulário:",
		fmt.Sprintf("- no máximo %d caracteres;", limite),
		"- preserve a estrutura em parágrafos e tópicos que o documento usa;",
		"- NÃO invente nada que não esteja no documento, e não acrescente comentário seu;",
		"- se o documento tiver faixa etária, renda, cidade, o que a pessoa procura e o que NÃO combina com a marca, esses pontos são os mais importantes e não podem ficar de fora;",
		"- se não couber tudo, corte o que é decoração (história da marca, missão, visão) e mantenha o que descreve a PESSOA.",
		"",
		"Responda SÓ com o texto, sem preâmbulo e sem markdown de cabeçalho.",
	}, "\n")
	inicio := time.Now()
	st, res, corpoErro, err := ia.claude.enviar(r.Context(), obj{"model": modeloDocumento, "max_tokens": maxTokensDocumento,
		"output_config": obj{"effort": "low"},
		"messages": []obj{{"role": "user", "content": []obj{
			{"type": "document", "source": obj{"type": "base64", "media_type": "application/pdf", "data": b64}},
			{"type": "text", "text": pedido}}}}})
	registrar("ler-documento", a.ID, st, res.Usage, inicio, len(pdf))
	if err != nil {
		responder(w, http.StatusBadGateway, obj{"error": "anthropic_inacessivel", "detalhe": err.Error()})
		return
	}
	if st < 200 || st > 299 {
		responder(w, http.StatusBadGateway, obj{"error": "anthropic_recusou", "status": st, "detalhe": detalheDoErro(res, corpoErro)})
		return
	}
	if res.StopReason == "refusal" {
		responder(w, http.StatusBadGateway, obj{"error": "recusado_pela_ia"})
		return
	}
	var b strings.Builder
	for _, c := range res.Content {
		if c.Type == "text" {
			b.WriteString(c.Text)
		}
	}
	texto := strings.TrimSpace(b.String())
	if texto == "" {
		responder(w, http.StatusBadGateway, obj{"error": "sem_texto", "detalhe": "a IA não devolveu texto para este PDF"})
		return
	}
	responder(w, http.StatusOK, obj{"ok": true, "texto": cortar(texto, limite), "uso": usoOuNulo(res.Usage)})
}
```

`api/internal/config/config.go`: o campo `IATrafego string // ANTHROPIC_API_KEY_TRAFEGO: a chave da Anthropic dos proxies de IA da Gestão de Tráfego (Plano 5.7; vazia = 503 chave_nao_configurada). É segredo.`, lido com `strings.TrimSpace(os.Getenv("ANTHROPIC_API_KEY_TRAFEGO"))` e acrescentado à lista de `Segredos()`.

**(b) Testes de aceitação** (`ia_test.go`, `prompts_test.go`; a Anthropic de mentira é um `httptest.Server` que conta os pedidos, guarda o último corpo e os cabeçalhos, e responde conforme o caso; `ia := Nova("SEGREDO-chave-ia"); ia.claude.url = srv.URL`; ator e escopo no contexto por `auth.NoContexto`/`autz.NoContexto`; o portão é o da montagem: `auth.ExigirModulo("meta.gestor")(http.HandlerFunc(ia.SugerirPublico))`)
- Pessoas: `gestor` (`Ator{Tipo:"painel", Modulos:["meta.gestor"]}`, escopo ativo com perfil e `Contas: [A1]`), `super` (`SuperAdmin: true`, escopo `TodasContas`), `leitor` (`Modulos: ["meta"]`).
- `TestSugerirPublico`:
  - `gestor` `{"evidencia":{"interesses":[{"key":"6003","nome":"Moda"},{"key":6004,"nome":"Bolsas"}],"idade":"25-34"},"marca":"Vessel","objetivo":"Seguidores","persona":"  SEGREDO-PERSONA mulheres 30+  ","contaId":"<A1>"}` com a Anthropic devolvendo o texto `Aqui: {"leitura":"L","interesses":[{"id":"6003"},{"id":"9999"},{"id":"6003"},{"id":6004}],"cuidado":"C"} fim` → `200 {"ok":true,"leitura":"L","interesses":[{"id":"6003","nome":"Moda"},{"id":"6004","nome":"Bolsas"}],"cuidado":"C","uso":{…}}`. A Anthropic recebeu: `x-api-key: SEGREDO-chave-ia`, `anthropic-version: 2023-06-01`, `model: claude-opus-4-5`, `max_tokens: 1600`, uma mensagem `user` cujo texto contém `A marca é: Vessel.`, `<persona>\nSEGREDO-PERSONA mulheres 30+\n</persona>` e `"key":6004`, e NÃO contém `\n\n` (o `filter(Boolean)` da edge).
  - `"modo":"texto"` com a resposta `{"leitura":"x","sugestoes":["a","","b","c"],"cuidado":"y"}` → `"sugestoes":["a","b"]` (corta em 3 ANTES de filtrar, como a edge); o prompt é o de texto (contém `os itens em "vagas"`).
  - `super` com `contaId` A2 → 200 (o portão da edge inclui o super pela ficha).
  - Negados com **0 pedidos** à Anthropic: `leitor` → 403 `sem_permissao` (o `ExigirModulo`); `gestor` com `contaId` A2 → `404 {"error":"conta_nao_encontrada"}`; sem `contaId` ou `"x"` → `400 sem_conta`; `evidencia` ausente, `[]` ou `"x"` → `400 sem_evidencia`; corpo `lixo` → `400 corpo_invalido`; campo `extra` → 400; `Nova("")` → `503 chave_nao_configurada` com `comoResolver`; com `ia.limSugerir.Max = 1`, o segundo pedido válido → `429 muitas_leituras` (1 pedido só chegou).
  - Erros da Anthropic: 529 `{"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}` → `502 {"error":"anthropic_recusou","status":529,"detalhe":"Overloaded"}`; 500 com corpo `oops` → `"detalhe":"{}"`; 200 com o texto `sem json` → `502 {"error":"resposta_ilegivel","bruto":"sem json"}`; servidor fechado (`srv.Close()` antes) → `502 anthropic_inacessivel`; 307 para um segundo servidor que conta pedidos → `502 anthropic_recusou` com `"status":307` e o segundo com 0 pedidos.
- `TestLerDocumento`:
  - `gestor` `{"base64":"<base64 de \"%PDF-1.4 SEGREDO-DOC conteúdo\" com quebras de linha a cada 10 caracteres>","limite":10}` com a Anthropic devolvendo `{"content":[{"type":"text","text":"  Mulheres 30 a 45 anos  "}],"stop_reason":"end_turn","usage":{"input_tokens":5}}` → `200 {"ok":true,"texto":"Mulheres 3","uso":{"input_tokens":5}}`. A Anthropic recebeu `model: claude-opus-5`, `max_tokens: 8000`, `output_config.effort: low`, `content[0]` = `document` base64 `application/pdf` com o base64 SEM as quebras, `content[1].text` contendo `- no máximo 10 caracteres;`.
  - `limite` ausente → o pedido diz `4000`; `20000` → `8000`; `-5` → `4000`.
  - Negados com **0 pedidos**: `leitor` → 403; `"base64":""` → `400 sem_arquivo`; `"não-base64!!"` e o base64 de `GIF89a` → `400 nao_e_pdf`; base64 de 4.500.004 caracteres `A` → `413` com `limite aqui é 3 MB`; corpo de 5 MB → `413 arquivo_grande_demais`; `Nova("")` → 503; `ia.limDocumento.Max = 1` → o segundo é 429 `muitos_documentos`.
  - `stop_reason: refusal` → `502 recusado_pela_ia`; `content: []` → `502 sem_texto`.
- `TestIASemSegredoNoLog`: com o `slog` padrão num buffer (nível Debug), os casos felizes e de erro das duas rotas → o log contém `ia: chamada à Anthropic` e NÃO contém `SEGREDO-chave-ia`, `SEGREDO-PERSONA`, `SEGREDO-DOC`, o base64 do PDF nem `"key":6004`; nenhuma resposta contém `SEGREDO-chave-ia`.
- `TestPromptsIguaisAEdge` (`prompts_test.go`, puro): `montarPrompt(`{"a":1}`, "Vessel", "", "")` é exatamente a junção das linhas não vazias da edge (escrita no teste, linha a linha, a partir de `index.ts:160-187`), sem a linha de objetivo e sem o bloco da persona; com persona, o bloco aparece entre o `A marca é` e os números; `cortar` em 6000 caracteres (evidência de 7000 `x` → 6000); `promptDeTexto` idem com 7000. `extrairJSON("x {\"a\":1} y")` → `{a:1}`; `extrairJSON("[1]")` → nil. `filtrarInteresses` com escolhido sem `id`, com `id` inexistente e repetido → só os válidos, sem repetição, `[]` quando nada.
- `TestChaveDaIATrafego` (`config_test.go`): `ANTHROPIC_API_KEY_TRAFEGO=" SEGREDO-ia "` → `IATrafego == "SEGREDO-ia"` e está em `Segredos()`.
- Mutações que têm de reprovar: tirar o `!autz.PodeVerConta` (o `gestor` lê A2: Anthropic chamada); `CheckRedirect` removido (o segundo servidor recebe); limite contado DEPOIS da chamada (o 429 chega com 2 pedidos); `slog.Info(…, "prompt", prompt)` (o teste de log acusa `SEGREDO-PERSONA`); conferência de `%PDF-` removida (o GIF chega à Anthropic); `juntarSemVazias` trocado por `strings.Join(l, "\n")` (o prompt passa a ter `\n\n`).

**(c) Arquivos:** Create `api/internal/ia/claude.go`, `api/internal/ia/prompts.go`, `api/internal/ia/ia.go`, `api/internal/ia/ia_test.go`, `api/internal/ia/prompts_test.go`; Modify `api/internal/config/config.go`, `api/internal/config/config_test.go`.

**(d) Dependências:** `autz.PodeVerConta` (5.6); `auth.NovoLimitador/AtorDoContexto/ExigirModulo`; `dados.LerCorpo`.

- [ ] **Step 1:** Testes; ver falhar. - [ ] **Step 2:** Implementar (código de (a)). - [ ] **Step 3:** `gofmt -l ./internal && go vet ./internal/ia/ ./internal/config/ && go test -count=1 -race ./internal/ia/ ./internal/config/` PASS; mutações reprovam. - [ ] **Step 4:** Commit `feat(api): proxies de IA da Gestão de Tráfego com a chave em variável de ambiente, conta conferida, PDF conferido e limite por pessoa` (+ `Co-Authored-By`).

---

### Task 11: Montagem, varreduras, prazos, `conferir` e notas

**Revisor:** opus. **Depende de:** 4–10.

**(a) Contrato**
- `trafego.Montar(r, p)` chama `montarFila, montarRascunhos, montarEscolhas, montarRegua, montarInteresses`: **8 leituras e 8 escritas**. `web/rotas.go`: `trafego.Montar(r, p) // Plano 5.7` no grupo de domínio; `web.FuncoesRPC` passa a juntar `trafego.FuncoesRPC`; `"gt_registrar_problemas"` (e a linha `// 5.7 (gestão de tráfego): 1`) sai de `RPCPendentes` (`rpc_lista.go`).
- Os proxies no grupo de SESSÃO (como o `meta-proxy`: o prazo do grupo de domínio, 30 s, cortaria a IA), cada um com o seu portão e prazo:

```go
	// Plano 5.7: proxies de IA (chave em ANTHROPIC_API_KEY_TRAFEGO) e de mapa (Nominatim). Portões = os das edges.
	iaTrafego, lugar := ia.Nova(cfg.IATrafego), mapa.Novo()
	r.With(auth.ExigirModulo("meta.gestor"), autz.ComEscopo(p), comPrazo(PrazoIA)).Post("/sugerir-publico-ia", iaTrafego.SugerirPublico)
	r.With(auth.ExigirModulo("meta.gestor"), comPrazo(PrazoIA)).Post("/ler-documento", iaTrafego.LerDocumento)
	r.With(auth.ExigirModulo("meta"), comPrazo(PrazoMapa)).Post("/buscar-lugar", lugar.ServeHTTP)
```

  com, nas constantes de prazo: `PrazoIA = 120 * time.Second` (um PDF pela IA leva até ~2 min; 30 s de folga antes do `EscritaDoServidor`) e `PrazoMapa = 20 * time.Second` (fila de uma ligação por segundo ao Nominatim).

`api/internal/trafego/rotas.go`:

```go
package trafego

import (
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Montar registra as rotas de tabela do 5.7 no grupo de DOMÍNIO de web.Rotas (depois de auth.Exigir e de
// autz.ComEscopo). A RPC entra por FuncoesRPC; os proxies de IA e de mapa, por internal/ia e internal/mapa.
// Declaração errada derruba a subida. Rota nova entra sozinha nas varreduras.
func Montar(r chi.Router, p *pgxpool.Pool) {
	montarFila(r, p)
	montarRascunhos(r, p)
	montarEscolhas(r, p)
	montarRegua(r, p)
	montarInteresses(r, p)
}
```

**(b) Testes de aceitação**
- `trafego/rotas_test.go` (código abaixo): `TestNadaVazaEntreContas` (TODA leitura de `Montar` exceto as três sem restritiva — exatamente 5 —, para `gestorA1`, `impersonado` e `gestorNenhuma`, sem filtro, com `?account_id=<A2>` e com `contar=1`: 200, sem o uuid de A2, `X-Total-Count: 0`; `gestorNenhuma` também sem A1; o lado positivo: `adminA1` vê A2 em cada uma) e `TestEscritasRecusamImpersonado` (as 8 escritas como `impersonado` → 403 com a frase; foto igual).
- `web/rotas_test.go`: `soSessao` ganha as 16 rotas de `Montar` (comentário: "portão = catálogo, provado pela matriz de cada rota em `internal/trafego`; vazamento e impersonado por `TestNadaVazaEntreContas` e `TestEscritasRecusamImpersonado`"); os 3 proxies NÃO entram (o `TestNenhumaRotaNovaFicaAberta` prova o `ExigirModulo`: sem módulo = 403). `TestPrazosPorRotaPelaMontagemReal` ganha `"POST /sugerir-publico-ia": PrazoIA, "POST /ler-documento": PrazoIA, "POST /buscar-lugar": PrazoMapa` (e continua exigindo 30 s de folga antes do `EscritaDoServidor`). `TestRPCRegistradaPelaMontagemReal` passa a ACRESCENTAR a função de teste a `FuncoesRPC` (`append(slices.Clone(original), rpc.Funcao{…})`) em vez de trocá-la: com `gt_registrar_problemas` fora de `RPCPendentes`, trocar a lista inteira derrubaria a soma de `TotalRPCDoPainel`.
- `TestTrafegoPelaMontagemReal` (`web/rotas_test.go`, `testebanco.ComEsquemaDeProducao` + `usuarios`/`profiles` de `gestor-a1` (`{meta, meta.gestor}`, `allowed_accounts {A1}`), `admin` (papel admin), `so-meta` (`{meta}`) e `nenhum`; `gt_budget_analises` com uma linha de A1 e uma de A2; `config.Config{}` sem chave de IA): `GET /gestao-trafego/analises-de-orcamento` sem sessão → 401; `gestor-a1` → só A1; `admin` → as duas; `POST /rpc/gt_registrar_problemas` `gestor-a1` `{"p_conta":"<A2>","p_itens":[]}` → 403 e `{"p_conta":"<A1>","p_itens":[]}` → 200 `0`; `POST /sugerir-publico-ia` `so-meta` → 403 e `gestor-a1` `{"evidencia":{},"contaId":"<A1>"}` → 503 `chave_nao_configurada` (passou portão e escopo; não há para onde ligar); `POST /ler-documento` `so-meta` → 403; `POST /buscar-lugar` `nenhum` → 403 e `so-meta` `{"acao":"apagar"}` → 400 `acao desconhecida` (passou do portão sem ligar para o Nominatim).
- `cmd/api/conferir_test.go`: `TestContaEmTextoNaoViraUUID` — `tiposDoWorker["gt_fila_decisoes.account_id"] == "text"` e `tiposDoWorker["social_metas.account_id"] == "text"` depois do `init` (o `init` atual sobrescreve com `uuid`: a conferência acusaria falso no banco restaurado); `TestConferirSchemaCompletoConfere` e os demais continuam verdes com as listas novas.

```go
package trafego

import (
	"net/http"
	"slices"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/rbv-co/social-dashboard/api/internal/testebanco/mundoteste"
)

// escritas: um pedido VÁLIDO (para quem não entrou como outra pessoa) por rota de escrita de Montar. Rota
// de escrita nova sem entrada aqui faz as varreduras falharem.
var escritas = map[string]struct{ caminho, corpo string }{
	"POST /gestao-trafego/decisoes":                 {"/gestao-trafego/decisoes", `{"campaign_id":"9001","account_id":"` + A1 + `","veredito":"escalar","decisao":"aprovada"}`},
	"POST /gestao-trafego/rascunhos":                {"/gestao-trafego/rascunhos", `{"account_id":"` + A1 + `","estado":{},"nome":"x"}`},
	"PATCH /gestao-trafego/rascunhos/{id}":          {"/gestao-trafego/rascunhos/" + R2, `{"nome":"y"}`},
	"DELETE /gestao-trafego/rascunhos/{id}":         {"/gestao-trafego/rascunhos/" + R2, ``},
	"PUT /gestao-trafego/config-metricas/{balde}":   {"/gestao-trafego/config-metricas/engajamento", `{"metricas":["cpm"]}`},
	"PUT /gestao-trafego/objetivos/{alvo_id}":       {"/gestao-trafego/objetivos/9001", `{"nivel":"campanha","interacao":"curtidas","conta_id":"` + A1 + `"}`},
	"DELETE /gestao-trafego/objetivos/{alvo_id}":    {"/gestao-trafego/objetivos/9001", ``},
	"PUT /gestao-trafego/regua":                     {"/gestao-trafego/regua", `{"pesos":{},"limiares":{},"limiares_resultado":{},"conta_id":"` + A1 + `","metas":{}}`},
}

// semRestritiva: as leituras cujas tabelas não têm pode_ver_conta em produção (Ruling 5.7-3): mostram a
// conta de A2 a todo mundo, como hoje (achado 3). Toda outra leitura entra na varredura.
var semRestritiva = []string{"/gestao-trafego/config-metricas", "/gestao-trafego/objetivos", "/gestao-trafego/regua"}

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

// A2 nunca aparece para quem não a vê — em NENHUMA leitura com a restritiva, sem filtro, filtrando por A2
// ou contando; o impersonado vê o que o ALVO (gestorA1) vê. Toda leitura dessas projeta account_id
// (Ruling 5.7-4), por isso o uuid de A2 na resposta é vazamento.
func TestNadaVazaEntreContas(t *testing.T) {
	m := novoMundo(t, Montar)
	varridas := 0
	l, g := varrer(t, m, func(metodo, rota, _, _ string) {
		if metodo != http.MethodGet || slices.Contains(semRestritiva, rota) {
			return
		}
		varridas++
		for _, quem := range []string{"gestorA1", "impersonado", "gestorNenhuma"} {
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
		if _, b := m.Pedir(t, "gestorNenhuma", "GET", rota, ""); strings.Contains(b, A1) {
			t.Errorf("lista vazia viu A1 em %s: %s", rota, b)
		}
		if _, b := m.Pedir(t, "adminA1", "GET", rota, ""); !strings.Contains(b, A2) {
			t.Errorf("adminA1 não viu A2 em %s (a rota projeta account_id?): %s", rota, b)
		}
	})
	if l != 8 || g != 8 || varridas != 5 {
		t.Errorf("rotas = %d leituras (%d varridas) e %d escritas, esperava 8 (5) e 8", l, varridas, g)
	}
}

// Toda escrita recusa a sessão de "entrar como", sem tocar no banco.
func TestEscritasRecusamImpersonado(t *testing.T) {
	m := novoMundo(t, Montar)
	antes := m.Um(t, fotoDoTrafego)
	_, n := varrer(t, m, func(metodo, rota, caminho, corpo string) {
		if metodo == http.MethodGet {
			return
		}
		if st, b := m.Pedir(t, "impersonado", metodo, caminho, corpo); st != http.StatusForbidden || !strings.Contains(b, "Quem entrou como outra pessoa") {
			t.Errorf("%s %s como impersonado = %d %s", metodo, rota, st, b)
		}
	})
	if n != 8 {
		t.Errorf("escritas = %d, esperava 8 (rota nova? ponha soSessaoPropria e um caso em `escritas`)", n)
	}
	if m.Um(t, fotoDoTrafego) != antes {
		t.Error("o impersonado mudou o banco")
	}
}
```

(`interesses-sugeridos` está na varredura: a tabela é aberta, mas a conta projetada é a da marca, que só sai para quem a vê; a linha de M2 aparece para `gestorA1` com `account_id` nulo — sem o uuid de A2.)

**(c) Arquivos:** Create `api/internal/trafego/rotas.go`, `api/internal/trafego/rotas_test.go`; Modify `api/internal/web/rotas.go`, `api/internal/web/rpc_lista.go`, `api/internal/web/rotas_test.go`, `api/cmd/api/conferir.go`, `api/cmd/api/conferir_test.go`, `docs/migracao-go/NOTAS-DA-IMPLANTACAO.md`.

**(d) Dependências:** Tasks 4–10; `web.Rotas`.

- [ ] **Step 1: Testes que falham.** `trafego/rotas_test.go` (acima); em `web/rotas_test.go`, as 16 entradas de `soSessao`: `"GET /gestao-trafego/analises-de-orcamento"`, `"GET /gestao-trafego/analises-de-anuncio"`, `"GET /gestao-trafego/decisoes"`, `"POST /gestao-trafego/decisoes"`, `"GET /gestao-trafego/rascunhos"`, `"POST /gestao-trafego/rascunhos"`, `"PATCH /gestao-trafego/rascunhos/{id}"`, `"DELETE /gestao-trafego/rascunhos/{id}"`, `"GET /gestao-trafego/config-metricas"`, `"PUT /gestao-trafego/config-metricas/{balde}"`, `"GET /gestao-trafego/objetivos"`, `"PUT /gestao-trafego/objetivos/{alvo_id}"`, `"DELETE /gestao-trafego/objetivos/{alvo_id}"`, `"GET /gestao-trafego/regua"`, `"PUT /gestao-trafego/regua"`, `"GET /gestao-trafego/interesses-sugeridos"`; os 3 prazos; o ajuste de `TestRPCRegistradaPelaMontagemReal`; `TestTrafegoPelaMontagemReal`; `TestContaEmTextoNaoViraUUID`. Run: `go test -count=1 ./internal/trafego/ ./internal/web/ ./cmd/api/` → FAIL (`Montar` não existe).
- [ ] **Step 2: Implementar.** `trafego/rotas.go`; em `web/rotas.go` os imports (`ia`, `mapa`, `trafego`), as constantes, a junção de `FuncoesRPC`, os 3 proxies no grupo de sessão (logo depois das rotas ao vivo do Plano 3) e `trafego.Montar(r, p) // Plano 5.7` no grupo de domínio, depois das montagens anteriores; em `rpc_lista.go`, tirar `gt_registrar_problemas` de `RPCPendentes`.

`cmd/api/conferir.go`:

```go
// colunasDoWorker (Plano 5.7: o que as rotas e a RPC presumem)
"gt_config_metricas":      "balde,metricas,updated_at",
"gt_objetivo_interacao":   "alvo_id,nivel,interacao,conta_id,updated_at,updated_by",
"gt_ponderada_config":     "id,pesos,metas,limiares,limiares_resultado,metas_por_conta,updated_at,updated_by",
"gt_ponderada_config_log": "id,mudou_em,mudou_quem,antes,depois",
"gt_budget_analises":      "campaign_id,account_id,objetivo,effective_status,veredito,justificativa,impacto_estimado,impactos,budget_atual_centavos,budget_sugerido_centavos,gerado_em,valida_ate",
"gt_ad_analises":          "ad_id,campaign_id,account_id,veredito,justificativa,gerado_em,valida_ate",
"gt_fila_decisoes":        "id,campaign_id,account_id,escopo,veredito,budget_atual_centavos,budget_sugerido_centavos,analise_gerada_em,decisao,decidido_em,decidido_por,silenciar_ate,aplicado,erro",
"gt_campanhas_rascunho":   "id,account_id,criado_por,estado,passo,nome,tipo,status,resultado,created_at,updated_at",
"gt_problemas_meta":       "ad_id,codigo,account_id,titulo,grave,primeira_vez,ultima_vez,resolvido_em",
"fabrica_marcas":          "id,account_id",
"interesses_sugeridos":    "id,marca_id,objetivo,itens,propostos,validos,gerado_em",

// tiposDoWorker: account_id das gt_* e de fabrica_marcas é TEXTO (as policies fazem pode_ver_conta(account_id)
// sem cast; os filtros fazem ::text); os jsonb que as escritas gravam por jsonb_populate_record
"gt_budget_analises.account_id": "text", "gt_ad_analises.account_id": "text", "gt_fila_decisoes.account_id": "text",
"gt_campanhas_rascunho.account_id": "text", "gt_problemas_meta.account_id": "text", "fabrica_marcas.account_id": "text",
"gt_objetivo_interacao.conta_id": "uuid", "gt_campanhas_rascunho.criado_por": "uuid", "gt_fila_decisoes.decidido_por": "uuid",
"gt_ponderada_config.metas_por_conta": "jsonb", "gt_ponderada_config.limiares_resultado": "jsonb",
"gt_config_metricas.metricas": "jsonb", "gt_budget_analises.impactos": "jsonb", "gt_campanhas_rascunho.estado": "jsonb",

// unicosDoWorker (alvos de ON CONFLICT: tela, RPC e robô sugerir-interesses)
"gt_config_metricas(balde)", "gt_objetivo_interacao(alvo_id)", "gt_problemas_meta(ad_id,codigo)", "interesses_sugeridos(marca_id,objetivo)",

// funcoesDoWorker e parametrosDasFuncoes
"gt_registrar_problemas(text,jsonb)",
"gt_registrar_problemas": {"p_conta", "p_itens"},
```

e o `init` passa a respeitar o tipo declarado:

```go
func init() { // toda coluna account_id é uuid, SALVO a que a lista acima declara (gt_*, social_metas: texto)
	for tabela, cols := range colunasDoWorker {
		if k := tabela + ".account_id"; slices.Contains(strings.Split(cols, ","), "account_id") && tiposDoWorker[k] == "" {
			tiposDoWorker[k] = "uuid"
		}
	}
}
```

Em `NOTAS-DA-IMPLANTACAO.md`, acrescente ao fim:

```markdown
## Plano 5.7 — Gestão de tráfego

### Variáveis de ambiente (serviço `api`)
| Variável | Observação |
|---|---|
| `ANTHROPIC_API_KEY_TRAFEGO` | a chave da Anthropic dos proxies `sugerir-publico-ia` e `ler-documento`. Hoje ela mora na tabela `segredos_de_cron` (nome `anthropic_api_key_trafego`), lida pela edge com a chave de serviço: quem tem acesso copia o valor para a variável ANTES do corte. Vazia = `503 chave_nao_configurada` (nada é chamado). É segredo (`Segredos()`). Depois do corte, a linha da tabela pode sair (decisão do dono) |

### Rotas novas
- Com sessão, regra = catálogo de produção, escrita de sessão "entrar como" = 403: `GET /gestao-trafego/analises-de-orcamento`, `/analises-de-anuncio`, `/decisoes`, `/rascunhos`, `/config-metricas`, `/objetivos`, `/regua`, `/interesses-sugeridos`; `POST /gestao-trafego/decisoes`, `POST /gestao-trafego/rascunhos`, `PATCH`/`DELETE /gestao-trafego/rascunhos/{id}`, `PUT /gestao-trafego/config-metricas/{balde}`, `PUT`/`DELETE /gestao-trafego/objetivos/{alvo_id}`, `PUT /gestao-trafego/regua`; `POST /rpc/gt_registrar_problemas`.
- Proxies (grupo de sessão): `POST /sugerir-publico-ia` e `POST /ler-documento` (módulo `meta.gestor`, prazo 120 s, 30 e 10 por hora por pessoa), `POST /buscar-lugar` (módulo `meta`, prazo 20 s, 60 por minuto por pessoa, uma ligação por segundo ao Nominatim).

### nginx
- `location = /api/ler-documento { client_max_body_size 5m; proxy_read_timeout 130s; proxy_pass http://127.0.0.1:8080/ler-documento; }` e `location = /api/sugerir-publico-ia { proxy_read_timeout 130s; proxy_pass http://127.0.0.1:8080/sugerir-publico-ia; }` (o padrão de 60 s cortaria a IA; o `64k` do `server {}` recusaria o PDF). Formato de log sem corpo (o PDF e a persona viajam no corpo).

### Mudanças de contrato que o Plano 7 absorve
- Leituras por `GET /gestao-trafego/<recurso>` com filtros nomeados (`account_id`, `veredito`, `escopo`, `campaign_id`, `status`, `alvo_id`, `conta_id`, `nivel`, `marca_id`, `objetivo`) e `ordem=decidido_em|updated_at[.desc]`; a régua é `GET /gestao-trafego/regua` (lista de uma linha). Interesses: `?account_id=` (substitui o `fabrica_marcas!inner(account_id)`); a conta vem em `account_id`, não em `fabrica_marcas.account_id`.
- Decisão: `POST /gestao-trafego/decisoes` SEM `decidido_por` (vem da sessão; mandar = 400); conta que não se vê = 403.
- Rascunhos: `POST` sem `criado_por`; `PATCH`/`DELETE` de rascunho de outra pessoa = 403 (antes: 0 linhas calado).
- Config de métricas: `PUT /gestao-trafego/config-metricas/{balde} {"metricas":[…]}` (sem `updated_at`). Objetivos: `PUT /gestao-trafego/objetivos/{alvo_id} {"nivel","interacao","conta_id"}`; `DELETE` é 204 também sem linha (a releitura de gt:802 sai).
- Régua: UM `PUT /gestao-trafego/regua {"pesos","limiares","limiares_resultado","conta_id","metas"}` (só as metas DA conta; o servidor funde em `metas_por_conta` e grava o histórico junto) substitui o `update` de gt:1615 + o `insert` no log de gt:1624; `conta_id` que a pessoa não vê = 403.
- RPC: `POST /rpc/gt_registrar_problemas` com o mesmo corpo; conta que não se vê = 403 (a tela já engole a falha: o `console.warn` de gt:941).
- `sugerir-publico-ia` passa a exigir `contaId` (a conta aberta, `_gtCurAcc.id`); conta fora da lista = 404 `conta_nao_encontrada`; erros novos `sem_conta` (400) e `muitas_leituras` (429). `ler-documento`: `nao_e_pdf` (400) e `muitos_documentos` (429). `buscar-lugar`: `termo longo demais` (400) e 429 `muitas buscas seguidas; espere um minuto`. As três trocam `functions.invoke`/`fetch(SUPABASE_URL+…)` pelo `POST /api/<nome>` do cliente `api`.

### Antes do corte
- `api worker conferir` no banco restaurado: colunas, tipos, únicos e `gt_registrar_problemas(text,jsonb)` do 5.7 (em especial os presumidos: `gt_budget_analises.impactos`, `gt_ponderada_config.limiares_resultado`).
- Gatilho: `select tgname from pg_trigger where tgrelid = 'public.gt_campanhas_rascunho'::regclass and not tgisinternal` = `gt_rascunho_updated_at` e nenhum outro nas 10 tabelas.
- A chave: `ANTHROPIC_API_KEY_TRAFEGO` preenchida (um `POST /sugerir-publico-ia` de teste no ensaio, com uma conta da lista, volta 200).
- Robôs do `coletor/` que usam estas tabelas com a chave de serviço (Plano 7): `budget-ia.mjs` (grava `gt_budget_analises`/`gt_ad_analises`, lê a régua e os objetivos), `vigia-problemas-meta.mjs` (chama `gt_registrar_problemas`: a conta de serviço precisa de perfil com `meta.gestor` ou papel admin E `allowed_accounts` nulo, senão 403), `sugerir-interesses.mjs` (grava `interesses_sugeridos`), `conferir-a-madrugada.mjs` (lê `gt_problemas_meta`, que não tem rota).

### Achados para o dono
(ver a seção "Achados para o dono" do plano 5.7)
```

Rode `gofmt -w ./internal ./cmd`.
- [ ] **Step 3: Rodar e ver passar.** `gofmt -l . && go vet ./... && go test -count=1 -race ./... 2>&1 | grep -v goose | grep -E '^(ok|FAIL|---)'` → todos `ok`. Mutações que têm de reprovar: tirar `soSessaoPropria` de UMA escrita (a varredura do impersonado acusa); uma leitura de mentira em `Montar` sobre `gt_fila_decisoes` que não projete `account_id` (o lado positivo acusa); `trafego.Montar` FORA do grupo com `ComEscopo` (as rotas respondem 500); `/sugerir-publico-ia` sem `autz.ComEscopo` (o `gestor-a1` leva 500 em vez de 503); o init antigo (o `TestContaEmTextoNaoViraUUID` acusa).
- [ ] **Step 4: Commit** `feat(api): monta a Gestão de Tráfego (rotas, RPC e proxies de IA e de mapa), varreduras de vazamento e impersonado, conferir e notas` (+ `Co-Authored-By`).

---

### Verificação final do 5.7

- [ ] `docker stop pg-plano57` e `make -C api teste PG_PORTA=58542` → todos `ok` (nunca junto com o gate de outra worktree).
- [ ] Subir o `pg-plano57` de novo e `cd api && go test -count=1 -v ./... 2>&1 | grep -c -- '--- SKIP'` → `0`.
- [ ] `cd api && gofmt -l . && go vet ./...` → nada.
- [ ] `git diff feat/api-go-plano-5-6 --stat -- src/ supabase/ coletor/ db/` → vazio (o front troca no Plano 7; produção não muda).
- [ ] `grep -rn 'segredos_de_cron\|supabase\.co' api/internal/ia api/internal/mapa api/internal/trafego` → nada (a chave não vem de tabela; nada fala com o Supabase).
- [ ] `grep -rn 'http.Get\|http.Post\|http.DefaultClient' api/internal/ia api/internal/mapa` → nada (só os clientes sem redirecionamento).
- [ ] `docker stop pg-plano57`.
- [ ] Revisão final do branch por opus com foco em: o `ParamConta` (alguma forma de `p_conta` passa sem `PodeVerConta`?), a decisão da fila e a régua (conferência e gravação com o MESMO mapa, na MESMA transação?), o upsert promovido (o 5.6 continua verde sem mudança de semântica?), os proxies (algum caminho negado chega ao externo? algum log com chave, prompt ou documento? o URL externo pode ser trocado fora dos testes?) e a fatia D0 (algum presumido que mude o tipo de um filtro?).

---

## Inventário: sítios do front a trocar (Plano 7)

`grep` em `src/` (fora de `*.test.*` e `src/demonstracao/`) em 2026-10-12, contando `sb('<tabela>…')`, `sbClient.from('<tabela>')`, `.rpc(…)`, `functions.invoke('<edge>')` e `fetch(SUPABASE_URL + '/functions/v1/<edge>')`: **23 sítios nas 10 tabelas** (`gt_campanhas_rascunho` 6, `gt_objetivo_interacao` 4, `gt_fila_decisoes` 4, `gt_config_metricas` 2, `gt_ponderada_config` 2, `interesses_sugeridos` 2, `gt_budget_analises` 1, `gt_ad_analises` 1, `gt_ponderada_config_log` 1, `gt_problemas_meta` 0), **1 RPC** e **7 chamadas de edge**. Os demais `grep` (comentários em `problemas-do-anuncio.js:100`, `painel-fila.js:436`, `painel-historico.js:5`, `regua.js:68`, `persona-da-marca.js:4`, `sugestoes-de-interesse.js:4, 22`, `busca-de-lugar.js:5`, `painel-de-lugares.js:58`, `painel-subir.vue:202, 205`) não chamam nada.

Abreviações: `gt` = `src/ferramentas/gestao-trafego/tela-de-gestao-trafego.vue`; `ps` = `src/ferramentas/meta-ads/painel-subir.vue`.

| Rota | Sítios | Qtde |
|---|---|---|
| `GET /gestao-trafego/config-metricas` / `PUT …/config-metricas/{balde}` | gt:696 / gt:870 | 2 |
| `GET /gestao-trafego/objetivos` / `PUT` / `DELETE …/objetivos/{alvo_id}` | gt:705, 802 / gt:763 / gt:768 | 4 |
| `GET /gestao-trafego/analises-de-orcamento` | gt:1019 | 1 |
| `GET /gestao-trafego/analises-de-anuncio` | gt:1132 (`?veredito=pausar`) | 1 |
| `GET /gestao-trafego/decisoes` / `POST` | gt:1020, 1124 (`?escopo=saude`), 1133 (`?escopo=criativos`) / gt:1378 | 4 |
| `GET /gestao-trafego/regua` / `PUT` (régua + histórico numa chamada) | gt:1563 / gt:1615 + gt:1624 | 3 |
| `GET /gestao-trafego/interesses-sugeridos` | gt:4682 (`?account_id=`); ps:232 (`?marca_id=&objetivo=`) | 2 |
| `GET` / `POST` / `PATCH` / `DELETE /gestao-trafego/rascunhos[/{id}]` | gt:4917, 4966 / gt:4871 / gt:4868, 4884 / gt:4944 | 6 |
| `POST /rpc/gt_registrar_problemas` | gt:940 | 1 |
| `POST /ler-documento` | gt:1308 | 1 |
| `POST /sugerir-publico-ia` (agora com `contaId`) | gt:3892, 5074 | 2 |
| `POST /buscar-lugar` | gt:4273, 4298; ps:125, 153 | 4 |

Na mesma tela, de OUTROS planos (não trocar pelo 5.7): **5.6** — `accounts` (gt:610 → `GET /redes/contas`; a persona, gt:1331 → `PATCH /redes/contas/{id}`, só papel admin), `followers_leituras` (gt:746), `campaign_insights` (gt:1024); `meta-proxy` (gt:373, 399, 5433, 5466; Plano 3 com o escopo do 5.6); **Plano 6** — o envio de imagem para `fabrica-criativos/gestor-envios/` (policies de Storage de `2026-08-03-gestor-envio-de-imagem.sql`). Robôs do `coletor/` que leem ou gravam estas tabelas (`budget-ia.mjs`, `vigia-problemas-meta.mjs`, `sugerir-interesses.mjs`, `conferir-a-madrugada.mjs`): Plano 7, com sessão de serviço (ver NOTAS).

## Paralelização

- **Uma worktree por tarefa paralela** (merge na ordem dos números). As Tasks 3–8 e 11 são o MESMO pacote Go (`trafego`): em worktrees separadas, cada uma só cria os seus arquivos; os ajudantes comuns (`soSessaoPropria`, `deve`, `filtroConta`, `escopoOu500`, validadores) e o mundo são da Task 3. Um contêiner (`pg-plano57`, porta 58542) atende todas: cada teste cria o próprio banco.
- **Onda 1:** Tasks 1 (`testebanco`), 2 (`dados`, `rpc`, `redes/escolhas.go`), 9 (`mapa`) e 10 (`ia`, `config`) — quatro em paralelo, pacotes disjuntos. **Onda 2:** Task 3. **Onda 3:** Tasks 4, 5, 6, 7 e 8 (6 e 8 esperam também a 2) — cinco em paralelo. **Onda 4:** Task 11 (a única que toca `trafego/rotas*.go`, `web/*`, `conferir*.go` e as notas).
- **Com outros sub-planos:** a fatia 5.7 não toca o gerador nem `02-gatilhos.sql` (o 5.3 o regera) e declara `fabrica_marcas` (o 5.8, quando for escrito, NÃO a redeclara). Arquivos de fronteira em comum: `web/rotas.go`, `web/rotas_test.go`, `web/rpc_lista.go`, `cmd/api/conferir*.go`, `config/config*.go` (o 5.12 acrescenta as chaves admin de IA), `NOTAS-DA-IMPLANTACAO.md` e `rpc/rpc.go` (a trilha A do 5.2 acrescenta `SoSessaoPropria` com o mesmo código): conflito mecânico de listas — quem mescla por último junta e roda o gate. Gates (`make teste`, contêiner fixo `pg-api-teste`) nunca ao mesmo tempo.

## Rulings do 5.7

1. Ruling: D0 = fatia RECONSTRUÍDA `01-tabelas-5-7.sql` (as 10 tabelas das migrations, com os presumidos marcados, e `fabrica_marcas`, que é do 5.8 mas é alvo de FK de `interesses_sugeridos` e carregaria depois) + `03-funcoes-5-7.sql` com o gatilho e a RPC verbatim, o gatilho por `create or replace trigger`; o gerador e `02-gatilhos.sql` não mudam — fica disjunto do 5.3 (que regera o `02`), a FK de produção é testada e o `create or replace` não quebra se o gerador um dia emitir o mesmo gatilho; nenhuma FK para `accounts` porque produção não tem — custo se errada: tipo presumido divergente (`impactos`, `limiares_resultado`) só aparece no `api worker conferir` do banco restaurado; o 5.8 precisa saber que `fabrica_marcas` já está declarada (dito na fatia e em "O que vem depois").
2. Ruling: três pacotes — `trafego` (tabelas e RPC, grupo de domínio), `ia` (os dois proxies da Anthropic) e `mapa` (`buscar-lugar`, que serve também à fábrica) — os proxies não leem tabela nem precisam do mundo de banco, têm prazo maior que o do grupo de domínio e testes com servidor externo de mentira; separados, andam em paralelo às tasks de tabela — custo se errada: três pacotes pequenos em vez de um.
3. Ruling: permissão = catálogo nas 10 tabelas, sem módulo nem escopo extra: "gestor" é papel `admin` ou `meta.gestor` em `features` (super-admin pela ficha NÃO entra, como em produção); as tabelas de leitura `true` (`gt_config_metricas`, `gt_objetivo_interacao`, `gt_ponderada_config`, `interesses_sugeridos`) são lidas por qualquer sessão (Ruling 36 do mestre: só sessão) e por isso ficam fora da varredura de vazamento; escrita negada pela regra vira `403`, no lugar do "0 linhas" silencioso do PostgREST — "mesmas permissões de hoje"; restringir é policy em produção, que o catálogo recompilado leva à API sem código (achados 3 e 7) — custo se errada: a régua e os objetivos de todas as contas continuam legíveis por todos, como hoje.
4. Ruling: só as rotas que as telas usam, com as colunas que telas e robôs leem, e TODA leitura de tabela com a restritiva declara o filtro `account_id` e projeta `account_id` — sem rota para `gt_problemas_meta` (só robô e funções SQL a leem) nem para `gt_ponderada_config_log` (ninguém lê; a escrita é do `PUT /regua`); `decidido_por`/`updated_by` (uuid de pessoa) não saem — rota sem tela é superfície sem dono, e a varredura só prova algo se a conta aparece na resposta — custo se errada: uma tela nova que queira o histórico da régua ou os problemas ganha uma `Consulta` de ~5 linhas.
5. Ruling: a decisão da fila só se cria em conta que quem decide vê (`autz.Conferir` com a regra de LER sobre a linha nova, na transação que grava) — em produção a policy de insert não tinha a restritiva, e um gestor com lista gravava decisão (e silêncio de 7 dias) de campanha de qualquer conta; a tela só manda contas visíveis (a análise que ela decide já passou pela restritiva), então nada legítimo muda; não depende do `CriarSoLegivel` do 5.2 (trilha A, pode não existir) — custo se errada: nenhum para a tela; decisão de conta invisível passa a 403.
6. Ruling: o upsert com a semântica da RLS (`PodeCriar` + `EditarNova` na linha nova; Ler + Editar no `WHERE` do `DO UPDATE`) é PROMOVIDO de `redes.upsertVisivel` (5.6) a `dados.UpsertVisivel`, com o catálogo por parâmetro, e o 5.6 passa a chamá-lo — duas cópias de código de segurança divergiriam; o 5.7 usa em mais duas tabelas e o 5.8 em diante também usarão — custo se errada: a Task 2 toca um arquivo do 5.6 (os testes dele são o guardião).
7. Ruling: a régua é UM `PUT` numa transação — trava a linha, lê o `antes`, funde `metas_por_conta || {conta: metas}` no servidor, grava pelo catálogo e insere o histórico com `antes`/`depois` lidos do banco — e só com `conta_id` que a pessoa vê (`autz.PodeVerConta`); os objetivos mantêm a paridade (sem conferir conta) — a tela mandava o mapa inteiro de todas as contas (duas pessoas salvando contas diferentes apagavam uma à outra), o histórico podia faltar em silêncio e o `antes` vinha do navegador; nos objetivos o `conta_id` não amarra o `alvo_id` (id da Meta) a conta nenhuma, então conferir só ele seria proteção de enfeite — custo se errada: o histórico muda de forma (`antes`/`depois` são a linha inteira do banco; ninguém o lê hoje).
8. Ruling: `DELETE /gestao-trafego/objetivos/{alvo_id}` responde `204` também quando não havia linha (idempotente) e `403` antes do banco para quem não é gestor — a regra de apagar só depende de quem pede; a tela fazia uma releitura (gt:802) só para distinguir "não havia" de "sem permissão", que o 403 explícito resolve — custo se errada: nenhum.
9. Ruling: `gt_registrar_problemas` entra em `web.FuncoesRPC` com portão = a checagem da função (papel `admin` ou `meta.gestor`, sem `conta_ativa` e sem super, Ruling 26 do mestre), `SoSessaoPropria` (grava) e a conta conferida (`ParamConta: "p_conta"`) — a função é SECURITY DEFINER e gravava/FECHAVA problemas de qualquer conta, enquanto a tabela tem a restritiva de leitura (a mesma contradição do Ruling 34 do mestre); a tela só manda contas que viu no `meta-proxy` — custo se errada: o robô vigia, se migrar para sessão de serviço com lista de contas, toma 403 nas contas fora da lista (NOTAS).
10. Ruling: `rpc.Funcao.ParamConta` é genérico no registro (valor texto → `autz.PodeVerConta`; `null` segue; outro tipo → 400) e `rpc.Novo` recusa apontar para parâmetro que não é `text` declarado — é o ponto único de entrada de RPC; o 5.11 e outros com `p_conta` reaproveitam; um middleware antes do registro teria de ler e devolver o corpo — custo se errada: um campo a mais na struct.
11. Ruling: os proxies de IA usam a chave de `ANTHROPIC_API_KEY_TRAFEGO` (nunca `segredos_de_cron`), o MESMO modelo, `max_tokens`, `output_config` e prompt das edges, HTTP cru com URL fixa e sem redirecionamento, sem o SDK da Anthropic — spec §11 (segredo fora de tabela); "sem dependência nova" (Global Constraints do mestre) e o corpo de hoje é uma chamada simples; trocar modelo na migração mudaria resultado e custo sem ninguém decidir (achado 5) — custo se errada: atualizar modelo ou parâmetro é trocar uma constante, sem a ajuda de tipos do SDK.
12. Ruling: limites de custo — por pessoa, em memória (`auth.Limitador`): 30 leituras da IA por hora, 10 PDFs por hora; corpo de 1 MiB no `sugerir` e de 4,6 MB no `ler-documento`; PDF conferido (`%PDF-` depois do base64) antes de gastar; `marca`/`objetivo` cortados em 200; `limite` com piso 1; prazo de 120 s (`PrazoIA`, 30 s antes do `WriteTimeout`) — a edge não tinha limite nenhum além do tamanho, e cada clique custa dinheiro; o teto mensal no console da Anthropic é a segunda barreira (achado 8) — custo se errada: quem usa muito toma 429 por até uma hora; reiniciar a API zera a contagem (ponytail: uma instância).
13. Ruling: `sugerir-publico-ia` passa a exigir `contaId` e confere `autz.PodeVerConta` (404 igual a conta inexistente) — o pedido do plano 5.6 ("O que vem depois"); a evidência continua vindo do navegador, então isso não protege dado: amarra o gasto a uma conta que a pessoa vê e tira da IA quem tem lista vazia — custo se errada: o Plano 7 manda um campo a mais.
14. Ruling: `buscar-lugar` fala só com `https://nominatim.openstreetmap.org` (constante), caminhos fixos, termo e coordenadas só na query, sem redirecionamento, resposta até 1 MiB, uma ligação por vez com 1 s de intervalo, cache de 24 h/500 em memória (paridade), erro fora do cache, 60 por minuto por pessoa; portão `ExigirModulo("meta")`, que também deixa passar o super-admin pela ficha (a edge não olhava `is_superadmin`; é o mesmo portão do `meta-proxy`) — a regra de uso do Nominatim é a razão de existir da edge; SSRF exige destino fixo; a diferença do super é de quem já entra em tudo — custo se errada: rajada de buscas espera na fila (até o prazo de 20 s).
15. Ruling: log dos proxies = uma linha por chamada externa com rota, pessoa, status, contagem de tokens, duração e tamanho do PDF; nunca chave, prompt, persona, evidência, documento, corpo de erro da Anthropic, termo ou coordenada — a persona e o documento são da marca (dado de negócio), a chave é segredo, e o termo/coordenada diz onde a pessoa anuncia; o `detalhe` do erro continua na RESPOSTA, como na edge — custo se errada: depurar exige reproduzir o pedido.
16. Ruling: o `init` de `cmd/api/conferir.go` passa a respeitar o tipo de `account_id` declarado em `tiposDoWorker` — ele forçava `uuid` em toda tabela com `account_id`, e as gt_* (e a `social_metas` do 5.6) são `text`: a conferência acusaria falso no banco restaurado — custo se errada: nenhum.
17. Ruling: `silenciar_ate` da fila é calculado no servidor (`agora + 7 dias` ao recusar; nulo ao aprovar) e recusado no corpo — a tela sempre mandava `agora + DIAS_DE_SILENCIO` (7), então o prazo vindo do navegador só servia para calar uma campanha por anos; decidido pela trilha B na execução — custo se errada: mudar o prazo vira deploy da API (a tela deixa de mandar o campo no Plano 7).

## Achados para o dono

1. **`gt_registrar_problemas` deixava um gestor com lista de contas gravar e FECHAR os problemas da Meta de qualquer conta** (a função é SECURITY DEFINER e não olha `pode_ver_conta`). A API confere a conta antes de rodar.
2. **A fila aceitava decisão de qualquer conta, e o "silenciar até" vem do navegador** (dá para calar uma campanha por anos). A API recusa conta que a pessoa não vê e fixa os 7 dias no servidor (Ruling 5.7-17).
3. **A régua e os objetivos por interação são de todos:** qualquer sessão lê as metas de custo de TODAS as contas (`metas_por_conta`) e os objetivos declarados; qualquer gestor muda o objetivo de campanha de qualquer conta (as policies não têm a restritiva). Mantido (paridade); a régua passa a só mudar as metas da conta que a pessoa vê. Fechar a leitura = policy em produção.
4. **`gt_budget_analises.account_id` antigo:** o comentário da tela (gt:951) diz que ele era o id do registro do token, igual para todas as contas; o robô hoje grava a conta do painel (`budget-ia.mjs:1025-1028`). Linhas antigas, se ainda houver, são recortadas pelo id errado para quem tem lista. Conferir no ensaio: `select account_id, count(*) from gt_budget_analises group by 1`.
5. **Modelos fixos nas edges:** `sugerir-publico-ia` usa `claude-opus-4-5` (geração anterior) e `ler-documento` usa `claude-opus-5`. A migração mantém; trocar (por exemplo por `claude-opus-5-5`, mais barato por token) é decisão sua, com um teste de qualidade das sugestões.
6. **A chave da IA estava numa tabela** (`segredos_de_cron`, lida com a chave de serviço). Passa a variável de ambiente: alguém com acesso copia o valor antes do corte; depois, a linha da tabela pode ser apagada.
7. **Super-admin e persona:** o super-admin pela ficha sem `meta.gestor` usa a IA (portão das edges) mas não vê fila, rascunhos nem análises (as policies não o incluem); e o gestor sem papel admin não grava a persona da marca (`PATCH /redes/contas`, Ruling 12 do 5.6) — hoje o botão de persona do Gestor só funciona para admin.
8. **Custo de IA sem teto em dinheiro:** a API limita 30 leituras e 10 PDFs por hora por pessoa. Recomendo um teto mensal de gasto para esta chave no console da Anthropic.
9. **Corte silencioso:** `gt_ad_analises` tem 714 linhas e cresce; com o teto de 1000 por leitura, a fila passa a poder cortar quando houver mais de 1000 "pausar". A API devolve `X-Total-Count` e o Plano 7 avisa.

## Cobertura da spec e o que vem depois

**As 10 tabelas da linha 5.7 (24 policies, 5 restritivas):**

| Tabela | Policies (restritiva?) | Destino |
|---|---|---|
| `gt_campanhas_rascunho` | `gt_rascunho_leitura` (gestor), `_inserir` (dono + gestor), `_atualizar`/`_apagar` (dono), `so_contas_permitidas` **ALL, restritiva** | Task 5 |
| `gt_fila_decisoes` | `_leitura` (gestor), `_insercao` (gestor + `decidido_por`), `so_contas_permitidas` **select, restritiva** | Task 4 (+ criar só o que se vê) |
| `gt_ad_analises` | `gt_ad_read` (gestor), `so_contas_permitidas` **restritiva** | Task 4 (só leitura; o robô grava) |
| `gt_budget_analises` | `gt_budget_read` (gestor), `so_contas_permitidas` **restritiva** | Task 4 (só leitura) |
| `gt_problemas_meta` | `_leitura` (gestor), `so_contas_permitidas` **restritiva** | sem rota de leitura (Ruling 5.7-4); escrita pela RPC (Task 8) |
| `gt_config_metricas` | `gt_cfg_read` (`true`), `_insert`/`_update` (gestor) | Task 6 |
| `gt_objetivo_interacao` | `_leitura` (`true`), `_escrita` ALL (gestor) | Task 6 |
| `gt_ponderada_config` | `_leitura` (`true`), `_escrita` update (gestor) | Task 7 |
| `gt_ponderada_config_log` | `_leitura` (`true`), `_escrita` insert (gestor) | Task 7 (só escrita, junto da régua) |
| `interesses_sugeridos` | `int_sug_read` (`true`) | Task 7 (só leitura; o robô grava) |

RPC: `gt_registrar_problemas` (Task 8; `RPCPendentes` perde 1). Gatilho: 1 (`gt_rascunho_updated_at`, no banco). Edges: `sugerir-publico-ia`, `ler-documento` (Task 10), `buscar-lugar` (Task 9). Spec §5 (catálogo, escopo por conta, IDOR, ator × operação × recurso pela cadeia real), §8 (proxies com portão e chave fora do navegador; Nominatim com cache), §11 (segredo em variável de ambiente, fora de resposta e log; SSRF; impersonação sem escrita), §13 (escritas negadas sem efeito; concorrência da régua; vazamento varrido em toda rota).

**O que vem depois:**
- **5.8 (Fábrica):** `fabrica_marcas` JÁ está declarada na fatia 5.7 (a 5.8 não a redeclara; coluna nova entra com `alter table … add column if not exists`); `POST /buscar-lugar` e `GET /gestao-trafego/interesses-sugeridos?marca_id=&objetivo=` já servem ao `painel-subir.vue`; `dados.UpsertVisivel` e `rpc.Funcao.ParamConta` estão disponíveis.
- **Plano 6:** o envio de imagem do Gestor para `fabrica-criativos/gestor-envios/` (Storage).
- **Plano 7:** os 23 sítios de tabela, a RPC e as 7 chamadas de edge da tabela acima, com os contratos novos das NOTAS; os 4 robôs do `coletor/` com sessão de serviço (perfil gestor, `allowed_accounts` nulo).
- **Antes do corte:** a chave da IA na variável (achado 6) e o `conferir` no banco restaurado (NOTAS).
