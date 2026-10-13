# Sair do Supabase — Plano 5.10: Autenticidade (selo Vessel no painel)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **Execute na worktree `p5-510`** (branch `feat/api-go-plano-5-10`, que traz os planos 5.1–5.10). Antes da Task 1 ela recebe o **`origin/main`** (`git fetch && git merge --no-edit origin/main`: 5.6, 5.7 e 5.13 já mesclados) e, se o PR do 5.8 ainda não tiver entrado, também o `feat/api-go-plano-5-8` (41c24eba ou posterior: `internal/fabrica` com `montarRobo`, o mundo de teste da Fábrica e `config.GitHubPAT`). O 5.10 NÃO usa `internal/github` (Ruling 5.10-2); do 5.8 ele só precisa de `internal/fabrica` (Task 7). Faça `git add` só dos caminhos de cada task. Este plano contrata sobre as **interfaces** escritas nos planos 5.0–5.9; o pré-voo confere que elas existem com esses nomes. Nada foi ensaiado ainda: o código deste plano foi escrito contra o `origin/main` 1694af1b e o `feat/api-go-plano-5-8` 41c24eba, lidos por `git show`.

**Goal:** (1) Tirar `public.disparar_robo` do `pg_net` ANTES do corte (Ruling 28 do mestre): a função passa a gravar um pedido em `disparos_pendentes` (um por robô, os disparos se juntam), com o contrato de atendimento (`banco.AtenderDisparo`: pega uma vez só, o incerto nunca se repete sozinho, reconciliação e faxina) que o Plano 6 usa para o espelho da lista de espera — sem isso o `insert` em `vessel_lista_espera` (cadastro do site) QUEBRA no corte. (2) Trocar os 8 acessos de tabela, as 18 chamadas de RPC e a chamada de edge da tela de Autenticidade por rotas da API em Go com as MESMAS regras de produção (`is_vessel_admin()` nas 11 tabelas do selo; a checagem de dentro de cada uma das 16 funções, provada pessoa a pessoa), portando `vessel-baixar-cartao` (Zoho WorkDrive pelo servidor) e implementando a leitura `GET /fabrica/robo/material-do-sku` que o 5.8 deixou contratada.

**Architecture:** A fila é SQL + um ajudante: a migração goose `00007_disparos_pendentes.sql` cria a tabela e a nova `disparar_robo` (`create or replace`, `set search_path from current`), `ops/migracao/limpar-dump.mjs` tira a versão antiga do dump (o `restaurar.sh` roda `migrar` ANTES do `schema.sql`) e `banco.AtenderDisparo` é o único jeito de atender um pedido. O selo fica no pacote `internal/vessel` (que já tem o robô da RD do Plano 4): 6 leituras `dados.Consulta` (regra de Ler do catálogo), as 16 RPCs em `vessel.FuncoesRPC` (portão `autz.VesselAdmin`, `SoSessaoPropria` nas 14 que gravam, um `Conferir` só em `vessel_decidir_pedido_de_registro`) e `POST /vessel-baixar-cartao` sobre um cliente `internal/zoho` mínimo (token, listar, baixar) que o Plano 6 estende. Nenhuma escrita de tabela: as 11 tabelas só têm policy de SELECT em produção, quem grava são as funções SECURITY DEFINER. Testes contra a fatia 5.10 do D0 (12 tabelas das migrations, 6 gatilhos com OF/WHEN das migrations, 35 funções verbatim do levantamento).

**Tech Stack:** Go 1.26 (`go.mod`), `chi`, `pgx` v5, `goose`, Postgres 17 (contêiner), `net/http/httptest`, `golang.org/x/text/unicode/norm` (já é dependência direta), Node 22 (só `limpar-dump.mjs` e o gerador de uso único da Task 2).

**Spec:** `docs/superpowers/specs/2026-10-09-sair-do-supabase-design.md` (§5 autorização, §6 funções do banco, §8 worker, §9 workstreams 3/4/7, §11 segurança, §13 testes) e o plano-mestre `docs/superpowers/plans/2026-10-11-api-go-plano-5-dominios.md` (§II contrato, IV.1 regras de sub-plano, linha 5.10 da IV.2, IV.3, Rulings 1–39, em especial 2, 9, 11, 26 e **28**). Modelos: `…-5-9-conteudo.md` (formato, `TestPortoesIguaisAsFuncoes`, varreduras), `…-5-8-fabrica.md` (edge portada, rotas de robô, Ruling 5.8-13: o contrato de `material-do-sku`), `…-5-7-gestao-trafego.md` (`rpc.Funcao.Conferir`). Permissões: `docs/migracao-go/catalogo-policies-producao.json` — 11 policies `is_vessel_admin()` (`levantamento/01-policies.csv:383-402`). Funções: `levantamento/02-funções.csv` (linhas por função na Task 2); gatilhos: `levantamento/03-triggers.csv:36-51`; agenda: `04-agendamentos.csv`. Robôs: `docs/migracao-go/INVENTARIO-DO-COLETOR.md` (no `origin/main`; linhas `robo-de-cartoes.mjs`, `fotos-do-selo-do-bling.mjs`, itens 9 e 10) e `~/Projetos/Trabalho/lavessel/MIGRACAO-GO/COORDENACAO.md`. Produção depois do levantamento: `db/migrations/2026-10-10-robos-na-vps-sem-gatilho-do-actions.sql` (os 2 gatilhos que acordavam o Actions REMOVIDOS em 10/10; `REVISAO-CORE/06-central.md:108`).

## Global Constraints

- Nada em produção: sem `ssh`, sem credencial real, sem `push`. Postgres local descartável; Zoho e GitHub só de mentira (`httptest`, loopback).
- Regra de cada tabela = a do catálogo (`autz.Producao`), nunca reescrita à mão: `is_vessel_admin()` = conta ativa E (o MÓDULO `autenticidade` em `features` OU `is_superadmin` da ficha). Papel `admin` sozinho NÃO passa (paridade: achado 5). Nenhuma das 11 tabelas tem policy de escrita: o 5.10 não tem rota de escrita de tabela; toda escrita é por RPC.
- Portão de RPC = a checagem de dentro da função (`02-funções.csv`), provada igual pessoa a pessoa contra a função verbatim (`TestPortoesIguaisAsFuncoes`). As 16 são SECURITY DEFINER e respondem `{"ok":false,"motivo":"sem_permissao"}` quando o portão de dentro nega; na API o portão do Go nega antes, com o 403 do núcleo (Ruling 5.10-8).
- Negar por padrão. Todo portão tem o lado negado assertado **com o efeito**: foto das 12 tabelas e de `disparos_pendentes` igual (`fotoDoSelo`), nenhum pedido ao Zoho.
- Toda rota tem teste de vazamento pela cadeia real (`mundoteste`: `auth.Exigir` → `autz.ComEscopo`): TODA leitura sem filtro, com filtro e com `contar=1` (`X-Total-Count: 0`) para quem não é do selo; e o lado positivo (quem é vê).
- Escritas (as 14 RPCs que gravam): sessão de "entrar como" = `403 {"error":"sem_permissao","mensagem":"Quem entrou como outra pessoa só consulta."}` sem a função rodar (`SoSessaoPropria: true`). Leituras (`vessel_alertas`, `vessel_fila_de_registros`, as 6 rotas, `/vessel-baixar-cartao`) ficam abertas ao "entrar como" (ver o que a pessoa vê).
- Toda RPC roda em `banco.ComUsuario` (as funções gravam `auth.uid()` em `feito_por`, `baixada_por`, `criado_por`, `decidido_quem`): o `Conferir` roda na MESMA transação, antes da função.
- Segredos: `client_secret` e `refresh_token` do Zoho (de `acessos_conexoes`) e o token de acesso nunca em resposta, erro, log nem em `disparos_pendentes.erro`.
- SQL: todo parâmetro com cast explícito; nada do pedido no texto do SQL.
- Sem dependência nova; `go.mod` fica em `go 1.26.0`.
- Gate: `make -C api teste PG_PORTA=58550` com `--- SKIP` = 0; `gofmt -l` e `go vet` limpos; `node --test ops/migracao/limpar-dump.test.mjs`. O alvo `teste` usa o contêiner de nome fixo `pg-api-teste`: nunca junto com o gate de outra worktree.
- Commits terminam com `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>` (o modelo que implementa). Código, comentários e mensagens em português com acentuação; códigos e frases copiados da edge e das funções ficam como estão (`codigo_invalido`, `sem_cartao`, `motivo_obrigatorio`, frases sem acento das funções).
- `go` roda em `api/`; `git` e `node` na raiz da worktree.

## Review Focus

1. **Insert em `vessel_lista_espera` quebrando no corte** — a função antiga (`net.http_post`) restaurada do dump, a migração colidindo com o `CREATE FUNCTION` do dump, dois cadastros simultâneos estourando o índice de "um pendente por robô", ou a nova função recusando algum argumento. Testes: `TestDispararRoboEnfileiraSemFalhar` (Task 1), `TestLimparTiraADispararRobo` (Task 1, node), `TestFatiaDaAutenticidade` (Task 2: o gatilho de produção `vessel_espelhar_agora` numa tabela de prova).
2. **Pedido atendido duas vezes, ou incerto repetido sozinho** — dois atendentes ao mesmo tempo, `atendendo` órfão voltando a `pendente`, falha refeita sem disparo novo. Teste: `TestAtenderDisparo` (Task 1).
3. **Quem não é do selo lendo ou mexendo na garantia de uma cliente** — leitura de `vessel_registros` (nome, WhatsApp) por quem não tem a chave; RPC de baixar garantia, trocar dona ou decidir registro passando pelo papel `admin`, pela chave em `permissions` ou pelo "entrar como"; aprovação automática `bling` forjada pelo painel com uma "conferência" inventada. Testes: `TestLeiturasDoSelo` (Task 3), `TestPortoesIguaisAsFuncoes`, `TestRPCsDoSelo` (Task 4), `TestNadaVazaDoSelo` e `TestRPCsRecusamImpersonado` (Task 8).
4. **CPF e nascimento da dona saindo da API** — `GET /autenticidade/registros` com `cpf`/`nascimento`; a fila sem a máscara. Testes: `TestLeiturasDoSelo` (Task 3), `TestRPCsDoSelo` (Task 4, `vessel_fila_de_registros`).
5. **Segredo do Zoho vazando ou apontando para outro host** — `client_secret`/`refresh_token`/token na resposta ou no erro; `data_center` do banco virando host arbitrário; redirecionamento para `http`. Testes: `TestClienteZoho` (Task 5), `TestBaixarCartao` (Task 6).

---

## Interfaces que este plano consome

(Dos planos; o pré-voo confere cada uma. Nome diferente só de campo/função: use o real em todo o plano. Semântica diferente: **pare e reporte**.)

- **5.0** — `dados.Consulta{Tabela, Alias, SQL, Onde; Filtros []Filtro; Ordens; OrdemPadrao, Desempate}` com `Handler(b, cat)` (`panic` na montagem se inválida; `contar=1` → `X-Total-Count` sob a MESMA regra; `limite`; teto 1000; parâmetro desconhecido = 400); `dados.Filtro{Param, SQL, Tipo}` (`texto|uuid|…`, sufixo `[]` = lista por vírgula); `dados.Erro`, `dados.ErroDoBanco`. `autz`: `Producao`, `Escopo{ID, TemPerfil, Ativo, Papel, SuperFicha, Modulos, Chaves…}`, `EscopoDo`, `CarregarEscopo`, `ComEscopo`, `Regra`, **`VesselAdmin`** (`predicados.go`: `e.Ativo && (e.Modulo("autenticidade") || e.SuperFicha)`), `ErrNegado`. `auth`: `Ator{ID, Tipo, ImpersonadorID}`, `AtorDoContexto`, `Exigir`, `SoServico` (5.13). `banco.ComUsuario`, `banco.Migrar`, `banco.Compat`. `rpc.Novo`, `rpc.Funcao{Nome, Params, Retorno, Portao, SoSessaoPropria, ParamConta, Conferir}`, `rpc.Param{Nome, Tipo, Opcional}`, `rpc.Valor`; tipo `text[]` aceito (`expr`/`formaOk`). `web.Rotas`, `comPrazo`, `PrazoDominio`, `FuncoesRPC`, `RPCPendentes` (os 16 nomes do 5.10 estão lá), `TotalRPCDoPainel`, mapas `publicas`/`soSessao` e `TestPrazosPorRotaPelaMontagemReal` de `rotas_test.go`.
- **5.1** — `testebanco.ComEsquemaDeProducao(t)` (banco NOVO por teste, schema `public`: compat → migrações goose → `esquema/*.sql` em ordem de nome; `01-tabelas-5-NN.sql`, `02-gatilhos.sql`, `03-funcoes-5-NN.sql`, conferidos por `TestNomesDosArquivosDeEsquema`); `testebanco.Novo(t)` (SCHEMA novo por teste, `search_path` = ele; só as migrações goose e o `legado` — sem a compat); `TestEsquemaDeProducaoComOsGatilhosVerbatim` com a lista EXATA dos gatilhos carregados; `02-gatilhos.sql` traz `conta_ativa()`.
- **5.2 (fundação comum)** — `dados.SoSessaoPropria`, `dados.FraseEntrarComo`; `testebanco/mundoteste`: `Pessoa{Chave, ID, Email, Papel; Super, Trava, Desativado; Modulos, Contas}`, `Opcoes{Pessoas, Linhas, Impersonadas map[string][2]string /* chave → {alvo, quem entrou} */}`, `Novo(t, o, montar...)`, `Mundo{P, H, Tok}` com `Resposta/Pedir/Um/Rodar`, `Caso{Nome, Quem, Metodo, Caminho, Corpo, Status, Tem, NaoTem, Efeito, Quer}`. A `Pessoa` não tem `permissions`: o mundo grava pela SQL de `Linhas`.
- **5.7** — `rpc.Funcao.Conferir func(ctx, tx pgx.Tx, e *autz.Escopo, args map[string]json.RawMessage) error` (na MESMA transação, logo antes da função; `autz.ErrNegado` = 403 sem a função rodar); o padrão das varreduras (`trafego/rotas_test.go`).
- **5.8** — `internal/fabrica`: `montarRobo(r, p)` (grupo `auth.SoServico` + `soFabricante`), `responder(w, status, v)`, o mundo de teste (`novoMundo`, pessoa `robo` = sessão de serviço com a chave `meta.fabrica`, `fabricante`, `impersonado`, `roboSemFabrica`) e o contrato de `GET /fabrica/robo/material-do-sku` (plano 5.8, seção do inventário: `200 {"material": <texto|null>}`, `sku` até 80, `auth.SoServico` + `Fabricante`). `internal/github` existe mas o 5.10 não o usa.
- **5.9** — `dados.Tabela.Conferir` não é usado (o 5.10 não tem escrita de tabela). Se o 5.9 já estiver na base, a lista de gatilhos do 5.1 tem `conteudo_pecas_guarda` (Task 2, Step 4).
- **5.4 (trilha A, opcional)** — `esquema/01-tabelas-5-4.sql` declara `acessos_conexoes` (`db/migrations/acessos/006_zoho.sql:2-13`). Se não estiver na base, os testes da Task 6 criam a tabela com `create table if not exists` (as mesmas colunas): nunca na fatia do 5.10.

## Interfaces que este plano entrega

- **Para o Plano 6 (trilha A) — a fila de disparos** (Task 1):
  - Tabela `disparos_pendentes (id bigserial, robo text, corpo jsonb, situacao 'pendente'|'atendendo'|'feito'|'falhou'|'incerto', pedidos int, criado_em, atualizado_em, erro text)`, com **no máximo UM `pendente` por robô** (índice único parcial): os disparos que chegam enquanto ninguém atende se JUNTAM nele (`pedidos` conta quantos; o `corpo` é o do primeiro). Um disparo que chega enquanto o pedido está `atendendo` abre um `pendente` NOVO (a mudança feita durante o atendimento pede outro).
  - `public.disparar_robo(p_robo, p_funcao, p_segredo, p_body default '{}', p_timeout default 120000) returns bigint` — mesma assinatura de produção; só grava/junta o pedido e devolve o id; NUNCA chama rede e não falha por argumento (nulos viram `'?'`/`'{}'`). NÃO grava mais `robos_execucoes` (quem atende grava a execução dele, como toda tarefa do worker).
  - `banco.AtenderDisparo(ctx, pool, robo, fazer func(context.Context, banco.Disparo) error) (atendeu bool, err error)` e `banco.ErrIncerto`: reconcilia (`atendendo` há mais de 30 min → `incerto`, nunca refeito), faz a faxina (`feito|falhou|incerto` com mais de 30 dias), pega o pendente com `for update skip locked` num comando só (autocommit) e roda `fazer` uma vez; `nil` → `feito`; `ErrIncerto`/prazo/cancelamento → `incerto`; outro erro → `falhou` (texto em `erro`, até 500 caracteres: **sem segredo**). Nada se repete sozinho: quem precisa de nova tentativa espera o próximo disparo ou a própria agenda.
  - Quem atende hoje: ninguém no 5.10. `vessel-espelhar-lista` (único chamador vivo, `vessel_espelhar_agora` em `vessel_lista_espera`) é do Plano 6: a tarefa do espelho no worker chama `banco.AtenderDisparo(ctx, p, "vessel-espelhar-lista", …)` a cada minuto (além da agenda de 3 min, que continua). Os 2 nomes `vessel-fotos-trigger`/`vessel-cartoes-trigger` não têm atendente (Ruling 5.10-2).
- **Para o Plano 6 — o cliente do Zoho** (Task 5): `zoho.Novo(pool) *zoho.Cliente`, `(*Cliente).Conexao(ctx) (Conexao, error)` (lê `acessos_conexoes` provedor `zoho`; `zoho.ErrDesconectado`), `Listar(ctx, con, pasta) ([]Item, error)` (paginado, 50 por página até 5000), `Baixar(ctx, con, id) (*http.Response, error)` (quem chama fecha o corpo), token de acesso em memória por 50 min com UMA renovação no 401/F7003, `data_center` de lista fechada, sem redirecionamento para `http`; `zoho.ParaTeste(t, pool, base)` (loopback). O Plano 6 acrescenta escrita (planilhas, upload) no mesmo cliente.
- **Para o Plano 7 (trilha C)**: as rotas do inventário (seção "Inventário"), `POST /rpc/<16 nomes>` e `POST /vessel-baixar-cartao`; as mudanças de contrato na seção "Mudanças de contrato".
- **Para o 5.8/robô da Fábrica**: `GET /fabrica/robo/material-do-sku` (Task 7).
- **Para o 5.11**: a fatia 5.10 declara `vessel_lotes`, `vessel_pecas`, `vessel_registros`, `vessel_clientes`, `vessel_pedidos_de_registro`, `vessel_edicoes`, `vessel_baixas`, `vessel_leituras`, `vessel_garantias_baixadas`, `vessel_cartao_pedidos`, `vessel_cartao_arquivos`, `vessel_lembretes` e as funções `is_vessel_admin`, `vessel_cpf_valido`, `vessel_cpf_mascarado`, `vessel_espelhar_agora` (sem o gatilho): o 5.11 NÃO as redeclara e cria o gatilho `vessel_lista_espera_espelhar` na fatia dele, junto com `vessel_lista_espera` e `vessel_pedidos`.

## Pré-voo (antes da Task 1)

- [ ] `cd /Users/gabrielgertrudes/Projetos/Trabalho/lavessel/social-dashboard/.claude/worktrees/p5-510 && git status --short && git branch --show-current` → vazio (ou só este plano); `feat/api-go-plano-5-10`.
- [ ] Trazer as dependências executadas: `git fetch && git merge --no-edit origin/main`; se `git merge-base --is-ancestor 41c24eba HEAD` falhar (o 5.8 ainda não entrou na `main`), `git merge --no-edit feat/api-go-plano-5-8`. Conferir:
  ```bash
  grep -c 'VesselAdmin     = Regra(vesselAdmin)' api/internal/autz/predicados.go          # 1
  grep -c '"is_vessel_admin()": vesselAdmin' api/internal/autz/catalogo.go                 # 1 (as 11 policies compilam)
  grep -c '"vessel_alertas",' api/internal/web/rpc_lista.go                                # 1 (em RPCPendentes)
  grep -c 'SoSessaoPropria bool\|ParamConta string\|Conferir func' api/internal/rpc/rpc.go # 3
  grep -c '"disparar_robo"' api/internal/rpc/rpc.go                                        # 1 (proibida: nunca vira RPC)
  grep -c 'func SoServico' api/internal/auth/*.go                                          # 1 (5.13)
  grep -c 'func montarRobo' api/internal/fabrica/robo.go                                   # 1 (5.8)
  grep -c 'func ComEsquemaDeProducao' api/internal/testebanco/esquema.go                   # 1
  grep -c 'func Novo' api/internal/testebanco/mundoteste/mundoteste.go                     # 1
  grep -rn 'create table public.vessel_' api/internal/testebanco/esquema/                   # vazio (nenhuma fatia declarou o selo)
  grep -rn 'disparos_pendentes\|disparar_robo' api/internal/banco/ ops/migracao/limpar-dump.mjs # vazio
  ls api/internal/banco/migracoes/ | tail -1                                               # 00006_tokens_de_servico.sql
  grep -c 'golang.org/x/text' api/go.mod                                                   # 1
  grep -c 'CONFERIDOS' api/internal/testebanco/esquema/gerar-gatilhos.mjs                  # 0 hoje; ≥ 1 se o 5.2 entrou (Task 2, Step 4)
  grep -c 'conteudo_pecas_guarda' api/internal/testebanco/esquema_test.go                  # 0 ou 1 (se o 5.9 entrou)
  grep -lc 'create table public.acessos_conexoes' api/internal/testebanco/esquema/*.sql    # nada ou 1 arquivo (se o 5.4 entrou; Task 6)
  cd api && go list -deps ./internal/vessel | grep -c 'internal/web$'                      # 0 (sem ciclo)
  ```
  Qualquer `0` onde se espera ≥ 1: a dependência não terminou — **pare e reporte**. Se a última migração já for `00007_*` (outro plano entrou antes), a desta Task 1 vira o próximo número livre e o plano inteiro troca `00007` por ele.
- [ ] Produção ainda sem os 2 gatilhos do Actions (Ruling 5.10-2; só leitura, no SQL Editor do Supabase ou pelo dono): `select tgname from pg_trigger where tgname in ('vessel_lote_novo_pede_foto', 'vessel_cartao_pedido_novo_acorda_o_robo')` → nenhuma linha. Se voltarem: **pare e reporte** (alguém religou o disparo ao GitHub, e o 5.10 não tem quem o atenda).
- [ ] `go version` → `go1.26`+; `node --version` → `v22`+.
- [ ] Docker no ar, porta livre (`lsof -iTCP:58550 -sTCP:LISTEN` → vazio) e o banco das etapas:
  ```bash
  docker run -d --rm --name pg-plano510 -e POSTGRES_PASSWORD=x -p 127.0.0.1:58550:5432 postgres:17
  until docker exec pg-plano510 pg_isready -h 127.0.0.1 -U postgres >/dev/null 2>&1; do sleep 1; done
  export TEST_DATABASE_URL='postgres://postgres:x@localhost:58550/postgres?sslmode=disable'
  ```
- [ ] Linha de base: `cd api && go test ./... && go test -v ./... 2>&1 | grep -c -- '--- SKIP'` → tudo `ok` e `0`; `node --test ops/migracao/limpar-dump.test.mjs` → `pass`.

## Estrutura de arquivos

```
api/internal/banco/migracoes/00007_disparos_pendentes.sql   # a fila e a nova public.disparar_robo (sem pg_net)
api/internal/banco/disparos.go           (+ disparos_test.go) # AtenderDisparo, ErrIncerto, Disparo
ops/migracao/limpar-dump.mjs             (+ limpar-dump.test.mjs) # (mod.) tira a disparar_robo antiga do dump
api/internal/testebanco/esquema/01-tabelas-5-10.sql          # as 12 tabelas do selo, fonte por bloco
api/internal/testebanco/esquema/03-funcoes-5-10.sql          # 35 funções VERBATIM + os 6 gatilhos com OF/WHEN
api/internal/testebanco/esquema_selo_test.go                 # TestFatiaDaAutenticidade (os db/*.test.mjs portados)
api/internal/testebanco/esquema_test.go                      # (mod.) a lista de gatilhos ganha os 6
api/internal/testebanco/esquema/gerar-gatilhos.mjs           # (mod.) SÓ se tiver CONFERIDOS (5.2): as 8 entradas
api/internal/vessel/rd.go                                    # (mod.) só a linha "// Package vessel" (a doc cresce)
api/internal/vessel/mundo_test.go                            # pessoas, linhas, fotoDoSelo; TestMundoDoSelo
api/internal/vessel/leituras.go          (+ leituras_test.go) # as 6 GETs /autenticidade/*
api/internal/vessel/rpc.go               (+ rpc_test.go)      # FuncoesRPC (16) e o Conferir do registro
api/internal/zoho/zoho.go                (+ zoho_test.go)     # cliente do WorkDrive (só leitura)
api/internal/vessel/cartao.go            (+ cartao_test.go)   # POST /vessel-baixar-cartao e as regras de nome do robô
api/internal/fabrica/robo.go             (+ robo_material_test.go) # (mod.) GET /fabrica/robo/material-do-sku
api/internal/vessel/rotas.go             (+ rotas_test.go)    # Montar; varreduras de vazamento e de impersonado
api/internal/web/rotas.go, rotas_test.go, rpc_lista.go       # montagem, prazo do cartão, FuncoesRPC, RPCPendentes
api/internal/github/github.go                                # (mod.) só o comentário de Disparos (o 5.10 não acrescenta entrada)
api/cmd/api/conferir.go                  (+ conferir_test.go) # colunas, tipos, funções e gatilhos do selo; a disparar_robo nova
docs/migracao-go/NOTAS-DA-IMPLANTACAO.md, docs/migracao-go/API-PRONTA.md # seção do 5.10
```

**Não toca:** `autz` (as 11 policies já compilam: `is_vessel_admin()` → `vesselAdmin`); `rpc` e `dados` (o 5.7 já trouxe `Conferir` e `SoSessaoPropria`; o 5.10 não tem escrita de tabela); `worker` e `cmd/api/tarefas.go` (nenhuma tarefa nova: Ruling 5.10-2); `02-gatilhos.sql` (os gatilhos vão em `03-funcoes-5-10.sql` com `create or replace trigger`, como o 5.7 e o 5.9); `compat.sql` (Ruling 5.10-1); `coletor/`, `.github/`, `supabase/`, `src/` (Plano 7).

## Tarefas

| # | Task | Revisor | Depende de |
|---|---|---|---|
| 1 | `disparar_robo` sem `pg_net`: migração `00007` (fila + função), `banco.AtenderDisparo`, regra no `limpar-dump.mjs` | **opus** (o cadastro do site depende disto no corte; nada pode sair duas vezes) | — |
| 2 | D0: fatia 5.10 (12 tabelas) e `03-funcoes-5-10.sql` (35 funções verbatim, 6 gatilhos com OF/WHEN); a lista de gatilhos do 5.1; os testes de `db/*.test.mjs` portados | **opus** (tudo é provado contra isto) | 1 |
| 3 | `vessel`: mundo de teste, foto e as 6 leituras | sonnet | 2 |
| 4 | As 16 RPCs: portões provados contra as funções, `Conferir` do registro, efeitos e corrida | **opus** (garantia, dona da peça) | 2, 3 (mundo) |
| 5 | `internal/zoho`: token, listar, baixar (só leitura) | **opus** (segredo do Zoho) | — |
| 6 | `POST /vessel-baixar-cartao` (edge portada, sem os caches de listagem) | sonnet | 3, 5 |
| 7 | `GET /fabrica/robo/material-do-sku` (contrato do 5.8) | sonnet | 2 |
| 8 | Montagem, varreduras (vazamento, impersonado), `conferir`, notas e API-PRONTA | **opus** (fronteira) | 3–7 |

---

### Task 1: `disparar_robo` sem `pg_net` — a fila `disparos_pendentes` e o contrato de atendimento

**Revisor:** opus. **Depende de:** nada (pacote `banco`, migrações e `ops/migracao`).

**(a) Contrato**
- **O que quebra hoje no corte:** `public.disparar_robo` (`02-funções.csv:617-637`) chama `net.http_post` e grava `robos_execucoes`. O Postgres novo não tem `pg_net` (`limpar-dump.mjs` tira a extensão; o `restaurar.sh` cria a função com `check_function_bodies=false`, então ela RESTAURA e só falha ao rodar). O gatilho `vessel_lista_espera_espelhar` (AFTER INSERT/UPDATE em `vessel_lista_espera`, `03-triggers.csv:38-39`) chama `vessel_espelhar_agora()` → `disparar_robo` SEM tratar erro: todo cadastro da lista de espera do site (`vessel_entrar_na_lista`) e toda atualização da lista pelo robô de pedidos QUEBRAM. Os outros dois chamadores do levantamento (`vessel_lote_novo_pede_foto`, `vessel_cartao_pedido_novo_acorda_o_robo`, com `exception when others`) perderam o gatilho em 10/10 (`2026-10-10-robos-na-vps-sem-gatilho-do-actions.sql`); os do `pg_cron` (`04-agendamentos.csv`: espelho de 3 em 3 min, lembretes, caroços, triagem) não existem no Postgres novo (o worker/Plano 6 os substitui).
- **Migração `00007_disparos_pendentes.sql`** (abaixo): a tabela e a nova `disparar_robo` (MESMA assinatura e retorno, `security definer`, `set search_path from current`: no restore o caminho é `public`; nos testes por schema é o do teste). Um pedido `pendente` por robô (índice único parcial): `insert … on conflict (robo) where situacao = 'pendente' do update set pedidos = pedidos + 1`. Disparos simultâneos não falham (o segundo espera o primeiro e junta). Disparo dentro de transação desfeita some junto. Sem `revoke`: a função só enfileira, e um `revoke` de `public` quebraria o gatilho se o dono das funções restauradas for outro papel (o gatilho é `security definer` do dono dele).
- **Ordem do restore (`ops/migracao/restaurar.sh:20-26`): compat → `api migrar` → `schema.sql` → dados.** A `00007` cria a função ANTES do schema, e o `CREATE FUNCTION public.disparar_robo` do dump colidiria (`ON_ERROR_STOP=1`): `limpar-dump.mjs` ganha a regra `substituidas` que tira o `CREATE FUNCTION` e o `COMMENT ON FUNCTION` da `disparar_robo` (quem a CHAMA fica). No banco do ensaio já restaurado, `api migrar` aplica a `00007` e o `create or replace` troca a antiga (Ruling 5.10-1).
- **`banco.AtenderDisparo`** (abaixo): o único jeito de atender um pedido. Reconcilia (`atendendo` há mais de 30 min → `incerto`), faz a faxina (`feito|falhou|incerto` com mais de 30 dias), pega o MAIS ANTIGO `pendente` do robô num `update … where id = (select … for update skip locked)` em autocommit (dois atendentes nunca pegam o mesmo), roda `fazer` UMA vez e grava o resultado com um contexto próprio (o prazo da tarefa não deixa a linha presa em `atendendo`). Resultado: `nil` → `feito`; `ErrIncerto`, `context.DeadlineExceeded` ou `context.Canceled` → `incerto`; outro erro → `falhou`. **Nada se repete sozinho** (Ruling 5.10-3).
- **Sem tarefa do worker no 5.10** (Ruling 5.10-2): não há a quem despachar. O atendente de `vessel-espelhar-lista` é a tarefa do espelho do Plano 6 (Interfaces entregues).

```sql
-- +goose Up
-- Plano 5.10 (Ruling 28 do mestre; Rulings 5.10-1 a 5.10-3): public.disparar_robo sem pg_net. A função de
-- produção (levantamento/02-funções.csv:617-637) chamava net.http_post para acordar uma edge; o Postgres novo
-- não tem pg_net e o gatilho vessel_lista_espera_espelhar (vessel_espelhar_agora, sem tratamento de erro)
-- quebraria todo cadastro da lista de espera. Agora ela só enfileira: quem atende é o worker, por
-- banco.AtenderDisparo (internal/banco/disparos.go). O CREATE FUNCTION do dump sai em limpar-dump.mjs (regra
-- `substituidas`): o restaurar.sh roda esta migração ANTES do schema.
create table disparos_pendentes (
  id            bigserial primary key,
  robo          text not null,
  corpo         jsonb not null default '{}'::jsonb,
  situacao      text not null default 'pendente'
                check (situacao in ('pendente', 'atendendo', 'feito', 'falhou', 'incerto')),
  pedidos       integer not null default 1,   -- quantos disparos este pedido juntou
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  erro          text                          -- por que falhou ou ficou incerto (sem segredo)
);
-- UM pedido esperando por robô: o gatilho dispara a cada linha da lista, e o robô relê a lista inteira.
create unique index disparos_pendentes_um_por_robo on disparos_pendentes (robo) where situacao = 'pendente';
-- a reconciliação procura o atendimento órfão
create index disparos_pendentes_atendendo on disparos_pendentes (robo, atualizado_em) where situacao = 'atendendo';

-- +goose StatementBegin
create or replace function disparar_robo(p_robo text, p_funcao text, p_segredo text,
  p_body jsonb default '{}'::jsonb, p_timeout integer default 120000)
returns bigint
language plpgsql
security definer
set search_path from current
as $function$
-- p_funcao, p_segredo e p_timeout eram da chamada HTTP; ficam na assinatura para os chamadores de produção.
-- NUNCA falha por argumento: quem chama é gatilho de cadastro do site.
declare v_id bigint;
begin
  insert into disparos_pendentes as d (robo, corpo)
  values (coalesce(nullif(p_robo, ''), '?'), coalesce(p_body, '{}'::jsonb))
  on conflict (robo) where situacao = 'pendente'
  do update set pedidos = d.pedidos + 1, atualizado_em = now()
  returning d.id into v_id;
  return v_id;
end
$function$;
-- +goose StatementEnd

-- +goose Down
-- Sem a fila, a função sai junto (a de produção dependia do pg_net, que não existe aqui; restaurar o dump de
-- novo a traz). Sem função, o gatilho de vessel_lista_espera quebra o insert: Down só em ensaio.
-- +goose StatementBegin
drop function if exists disparar_robo(text, text, text, jsonb, integer);
drop table if exists disparos_pendentes;
-- +goose StatementEnd
```

```go
package banco

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ErrIncerto: quem atende devolve (embrulhado) quando não sabe se o efeito aconteceu (pedido no ar quando o
// prazo estourou, conexão caída depois de enviar, 502/504 do outro lado). O pedido fica 'incerto' e NUNCA é
// refeito sozinho.
var ErrIncerto = errors.New("disparo: resultado incerto")

// Disparo é um pedido de disparos_pendentes, gravado por public.disparar_robo (migração 00007).
type Disparo struct {
	ID      int64
	Robo    string
	Corpo   json.RawMessage // o p_body do PRIMEIRO disparo que o pedido juntou
	Pedidos int             // quantos disparos o pedido juntou enquanto esperava
}

// AtenderDisparo atende o pedido pendente de `robo`, se houver (no máximo um: os disparos se juntam enquanto
// ninguém atende), rodando `fazer` UMA vez. atendeu = havia pedido e `fazer` rodou.
//
// Antes de pegar: o 'atendendo' há mais de 30 min (quem atendia morreu no meio) vira 'incerto' e NÃO roda de
// novo; o resolvido há mais de 30 dias sai da tabela. Pegar é um comando só, com `for update skip locked`, em
// autocommit: dois atendentes ao mesmo tempo nunca pegam o mesmo pedido. Um disparo que chega enquanto o
// pedido está 'atendendo' abre outro 'pendente' (a mudança feita durante o atendimento pede outro).
//
// Resultado de `fazer`: nil → 'feito'; ErrIncerto, prazo ou cancelamento → 'incerto'; outro erro → 'falhou'
// (o texto vai para disparos_pendentes.erro: quem atende não põe segredo no erro). Nada se repete sozinho:
// quem precisa de nova tentativa espera o próximo disparo ou a própria agenda.
func AtenderDisparo(ctx context.Context, p *pgxpool.Pool, robo string, fazer func(context.Context, Disparo) error) (bool, error) {
	if _, err := p.Exec(ctx, `update disparos_pendentes set situacao = 'incerto', atualizado_em = now(),
		       erro = 'atendimento interrompido: sem resultado em 30 min'
		 where robo = $1::text and situacao = 'atendendo' and atualizado_em < now() - interval '30 minutes'`, robo); err != nil {
		return false, err
	}
	if _, err := p.Exec(ctx, `delete from disparos_pendentes
		 where robo = $1::text and situacao in ('feito', 'falhou', 'incerto') and atualizado_em < now() - interval '30 days'`, robo); err != nil {
		return false, err
	}
	var d Disparo
	var corpo string
	err := p.QueryRow(ctx, `update disparos_pendentes d set situacao = 'atendendo', atualizado_em = now()
		 where d.id = (select id from disparos_pendentes where robo = $1::text and situacao = 'pendente'
		                order by id limit 1 for update skip locked)
		returning d.id, d.robo, d.corpo::text, d.pedidos`, robo).Scan(&d.ID, &d.Robo, &corpo, &d.Pedidos)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	d.Corpo = json.RawMessage(corpo)
	errFazer := fazer(ctx, d)
	situacao := "feito"
	var texto *string
	if errFazer != nil {
		situacao = "falhou"
		if errors.Is(errFazer, ErrIncerto) || errors.Is(errFazer, context.DeadlineExceeded) || errors.Is(errFazer, context.Canceled) {
			situacao = "incerto"
		}
		s := errFazer.Error()
		texto = &s
	}
	// contexto próprio: o prazo da tarefa que estourou dentro de `fazer` não pode deixar a linha em 'atendendo'
	c, cancela := context.WithTimeout(context.WithoutCancel(ctx), 10*time.Second)
	defer cancela()
	_, errGravar := p.Exec(c, `update disparos_pendentes set situacao = $2::text, erro = left($3::text, 500), atualizado_em = now()
		 where id = $1::bigint and situacao = 'atendendo'`, d.ID, situacao, texto)
	if errGravar != nil { // a linha fica 'atendendo' e a reconciliação a leva a 'incerto' em 30 min: nunca roda de novo
		errGravar = fmt.Errorf("disparo %d: gravar %q: %w", d.ID, situacao, errGravar)
	}
	return true, errors.Join(errFazer, errGravar)
}
```

E em `ops/migracao/limpar-dump.mjs`, na lista `REGRAS` (depois de `publicacoes`) e no objeto `removidos` de `limpar` (`substituidas: 0`):

```js
  // A disparar_robo de produção chama net.http_post (pg_net não vai para o Postgres novo). A substituta (fila
  // disparos_pendentes) vem da migração 00007 da API, que o restaurar.sh roda ANTES do schema: sem tirar esta,
  // o CREATE FUNCTION do dump colide (ON_ERROR_STOP). Quem a CHAMA fica. Plano 5.10, Ruling 5.10-1.
  ['substituidas', /^(create(\s+or\s+replace)?|comment\s+on)\s+function\s+(public\.)?"?disparar_robo"?\s*\(/i],
```

**(b) Testes de aceitação** (`api/internal/banco/disparos_test.go`, pacote `banco_test`, código abaixo; e `ops/migracao/limpar-dump.test.mjs`)
- `TestDispararRoboEnfileiraSemFalhar` (`testebanco.Novo`: schema por teste, a migração aplicada): a assinatura de produção com e sem os DEFAULTs e com tudo nulo devolve o MESMO id para o mesmo robô (`pendente|3|{"origem": "gatilho"}`); outro robô = outro pedido; robô nulo vira `?`; 20 disparos simultâneos do mesmo robô = 0 falhas, 1 pedido com `pedidos` = 20; disparo em transação desfeita não fica.
- `TestAtenderDisparo`: sem pedido = `false` e `fazer` não roda; com pedido: roda UMA vez com `Robo`, `Corpo` (`{"n": 1}`) e `Pedidos` = 2, e o disparo feito DURANTE o atendimento abre um pendente novo (`feito:2,pendente:1`); erro comum → `falhou` com o texto e a chamada seguinte NÃO o refaz; `ErrIncerto` embrulhado e prazo estourado dentro de `fazer` → `incerto` e não refaz; `atendendo` de 31 min → `incerto` sem rodar, o de 29 min fica; faxina: `feito` e `incerto` de 31 dias saem, `falhou` de 29 dias fica; 8 atendentes simultâneos com 1 pedido → `fazer` roda 1 vez; pedido de outro robô não é atendido.
- `limpar-dump.test.mjs`: o caso novo `limpar tira a disparar_robo do dump…` (2 removidas, `net.http_post` some, `disparar_coletor` e a CHAMADA em `vessel_espelhar_agora` ficam) e as duas asserções `deepEqual` de `removidos` existentes (linhas 43 e 58) ganham `substituidas: 0` — a intenção delas (contar exatamente o que sai) continua.
- Mutações que têm de reprovar: tirar o `on conflict` (o 2º disparo dá 23505: o insert do cadastro quebraria); pegar com `select` e `update` em dois comandos sem `skip locked` (o teste dos 8 atendentes roda mais de uma vez); a reconciliação devolver o órfão a `pendente` (ele roda de novo); `ErrIncerto` tratado como `falhou`; gravar o resultado com o `ctx` da tarefa (o caso do prazo deixa a linha `atendendo`); tirar a regra `substituidas` (o teste node reprova).

```go
package banco_test

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/banco"
	"github.com/rbv-co/social-dashboard/api/internal/testebanco"
)

func textoDe(t *testing.T, p *pgxpool.Pool, sql string, args ...any) string {
	t.Helper()
	var v *string
	if err := p.QueryRow(context.Background(), sql, args...).Scan(&v); err != nil {
		t.Fatalf("%s: %v", sql, err)
	}
	if v == nil {
		return "<nulo>"
	}
	return *v
}

func executar(t *testing.T, p *pgxpool.Pool, sql string, args ...any) {
	t.Helper()
	if _, err := p.Exec(context.Background(), sql, args...); err != nil {
		t.Fatalf("%s: %v", sql, err)
	}
}

// A disparar_robo nova só enfileira: nunca chama rede, nunca falha por argumento, e os disparos de um robô se
// juntam num pedido pendente só — o cadastro do site (gatilho de vessel_lista_espera) não pode quebrar, nem com
// dois ao mesmo tempo.
func TestDispararRoboEnfileiraSemFalhar(t *testing.T) {
	p := testebanco.Novo(t)
	ctx := context.Background()
	id1 := textoDe(t, p, `select disparar_robo('vessel-espelhar-lista', 'vessel-espelhar-lista', 'vessel-espelhar-lista', '{"origem":"gatilho"}'::jsonb, 120000)::text`)
	id2 := textoDe(t, p, `select disparar_robo('vessel-espelhar-lista', 'x', 'y')::text`) // os dois DEFAULTs
	id3 := textoDe(t, p, `select disparar_robo('vessel-espelhar-lista', null, null, null, null)::text`)
	if id1 != id2 || id2 != id3 {
		t.Errorf("os disparos do mesmo robô não se juntaram: %s %s %s", id1, id2, id3)
	}
	if v := textoDe(t, p, `select situacao || '|' || pedidos || '|' || corpo::text from disparos_pendentes where id = $1::bigint`, id1); v != `pendente|3|{"origem": "gatilho"}` {
		t.Errorf("pedido = %s", v)
	}
	if textoDe(t, p, `select disparar_robo('vessel-fotos-trigger', 'a', 'b', jsonb_build_object('lote', 1))::text`) == id1 {
		t.Error("robôs diferentes no mesmo pedido")
	}
	nulo := textoDe(t, p, `select disparar_robo(null, null, null, null, null)::text`)
	if v := textoDe(t, p, `select robo || '|' || corpo::text from disparos_pendentes where id = $1::bigint`, nulo); v != "?|{}" {
		t.Errorf("robô e corpo nulos = %s", v)
	}
	// muitos ao mesmo tempo (o site e o robô de pedidos mexendo na lista juntos): nenhum falha, um pedido só
	var wg sync.WaitGroup
	var falhas atomic.Int32
	for range 20 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if _, err := p.Exec(ctx, `select disparar_robo('corrida', 'f', 's')`); err != nil {
				falhas.Add(1)
			}
		}()
	}
	wg.Wait()
	if falhas.Load() != 0 {
		t.Fatalf("%d disparos simultâneos falharam", falhas.Load())
	}
	if v := textoDe(t, p, `select count(*)::text || '|' || sum(pedidos)::text from disparos_pendentes where robo = 'corrida'`); v != "1|20" {
		t.Errorf("corrida = %s, esperava 1 pedido com 20 disparos", v)
	}
	// o disparo é da transação de quem chamou: desfeita, ele some junto
	tx, err := p.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := tx.Exec(ctx, `select disparar_robo('desfeito', 'f', 's')`); err != nil {
		t.Fatal(err)
	}
	tx.Rollback(ctx)
	if v := textoDe(t, p, `select count(*)::text from disparos_pendentes where robo = 'desfeito'`); v != "0" {
		t.Errorf("disparo de transação desfeita ficou: %s", v)
	}
}

func nunca(t *testing.T) func(context.Context, banco.Disparo) error {
	return func(context.Context, banco.Disparo) error {
		t.Error("atendeu o que não devia")
		return nil
	}
}

func TestAtenderDisparo(t *testing.T) {
	p := testebanco.Novo(t)
	ctx := context.Background()
	disparar := func(robo string) { executar(t, p, `select disparar_robo($1::text, 'f', 's', '{"n":1}'::jsonb)`, robo) }
	situacoes := func() string {
		return textoDe(t, p, `select coalesce(string_agg(situacao || ':' || pedidos, ',' order by id), '') from disparos_pendentes where robo = 'espelho'`)
	}

	if atendeu, err := banco.AtenderDisparo(ctx, p, "espelho", nunca(t)); atendeu || err != nil {
		t.Fatalf("sem pedido = %v %v", atendeu, err)
	}

	// um pedido (dois disparos juntos): roda UMA vez; o disparo DURANTE o atendimento abre um pendente novo
	disparar("espelho")
	disparar("espelho")
	var visto banco.Disparo
	atendeu, err := banco.AtenderDisparo(ctx, p, "espelho", func(_ context.Context, d banco.Disparo) error {
		visto = d
		disparar("espelho")
		return nil
	})
	if !atendeu || err != nil || visto.Robo != "espelho" || visto.Pedidos != 2 || string(visto.Corpo) != `{"n": 1}` {
		t.Fatalf("atendimento = %v %v %+v", atendeu, err, visto)
	}
	if v := situacoes(); v != "feito:2,pendente:1" {
		t.Errorf("depois do atendimento = %s", v)
	}

	// falha comum: 'falhou' com o texto, e não volta sozinha
	executar(t, p, `delete from disparos_pendentes`)
	disparar("espelho")
	if _, err := banco.AtenderDisparo(ctx, p, "espelho", func(context.Context, banco.Disparo) error { return errors.New("zoho fora") }); err == nil || !strings.Contains(err.Error(), "zoho fora") {
		t.Errorf("erro = %v", err)
	}
	if v := textoDe(t, p, `select situacao || '|' || erro from disparos_pendentes where robo = 'espelho'`); v != "falhou|zoho fora" {
		t.Errorf("falha = %s", v)
	}
	if atendeu, _ := banco.AtenderDisparo(ctx, p, "espelho", nunca(t)); atendeu {
		t.Error("a falha foi refeita sem disparo novo")
	}

	// incerto (pelo erro marcado e pelo prazo estourado dentro de fazer): também não volta
	for _, c := range []struct {
		nome  string
		fazer func(context.Context, banco.Disparo) error
	}{
		{"ErrIncerto", func(context.Context, banco.Disparo) error { return fmt.Errorf("github: 504: %w", banco.ErrIncerto) }},
		{"prazo", func(ctx context.Context, _ banco.Disparo) error { <-ctx.Done(); return ctx.Err() }},
	} {
		executar(t, p, `delete from disparos_pendentes`)
		disparar("espelho")
		c2, cancela := context.WithTimeout(ctx, 2*time.Second)
		banco.AtenderDisparo(c2, p, "espelho", c.fazer)
		cancela()
		if v := situacoes(); v != "incerto:1" {
			t.Errorf("%s: %s", c.nome, v)
		}
		if atendeu, _ := banco.AtenderDisparo(ctx, p, "espelho", nunca(t)); atendeu {
			t.Errorf("%s: o incerto foi refeito", c.nome)
		}
	}

	// órfão: 'atendendo' há 31 min vira 'incerto' sem rodar; o de 29 min fica
	executar(t, p, `delete from disparos_pendentes`)
	executar(t, p, `insert into disparos_pendentes (robo, situacao, atualizado_em) values
		('espelho', 'atendendo', now() - interval '31 minutes'), ('espelho', 'atendendo', now() - interval '29 minutes')`)
	if atendeu, _ := banco.AtenderDisparo(ctx, p, "espelho", nunca(t)); atendeu {
		t.Error("atendeu um órfão")
	}
	if v := textoDe(t, p, `select string_agg(situacao, ',' order by atualizado_em) from disparos_pendentes where robo = 'espelho'`); v != "incerto,atendendo" {
		t.Errorf("órfãos = %s", v)
	}

	// faxina: o resolvido há mais de 30 dias sai; o de 29 dias fica
	executar(t, p, `delete from disparos_pendentes`)
	executar(t, p, `insert into disparos_pendentes (robo, situacao, atualizado_em) values ('espelho', 'feito', now() - interval '31 days'),
		('espelho', 'incerto', now() - interval '31 days'), ('espelho', 'falhou', now() - interval '29 days')`)
	banco.AtenderDisparo(ctx, p, "espelho", nunca(t))
	if v := situacoes(); v != "falhou:1" {
		t.Errorf("faxina = %s", v)
	}

	// oito atendentes ao mesmo tempo, um pedido: roda uma vez
	executar(t, p, `delete from disparos_pendentes`)
	disparar("espelho")
	var vezes atomic.Int32
	var wg sync.WaitGroup
	comeca := make(chan struct{})
	for range 8 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-comeca
			banco.AtenderDisparo(ctx, p, "espelho", func(context.Context, banco.Disparo) error {
				vezes.Add(1)
				time.Sleep(50 * time.Millisecond)
				return nil
			})
		}()
	}
	close(comeca)
	wg.Wait()
	if vezes.Load() != 1 {
		t.Errorf("o pedido rodou %d vezes", vezes.Load())
	}

	// pedido de outro robô não é deste atendente
	disparar("outro")
	if atendeu, _ := banco.AtenderDisparo(ctx, p, "espelho", nunca(t)); atendeu {
		t.Error("atendeu o pedido de outro robô")
	}
}
```

```js
test('limpar tira a disparar_robo do dump (a substituta vem da migração 00007 da API) e deixa quem a chama', () => {
  const sql = `
CREATE FUNCTION public.disparar_robo(p_robo text, p_funcao text, p_segredo text, p_body jsonb DEFAULT '{}'::jsonb, p_timeout integer DEFAULT 120000) RETURNS bigint
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare v_req bigint;
begin
  select net.http_post(url := 'https://x/functions/v1/' || p_funcao, body := p_body) into v_req;
  return v_req;
end $$;
COMMENT ON FUNCTION public.disparar_robo(p_robo text, p_funcao text, p_segredo text, p_body jsonb, p_timeout integer) IS 'acorda uma edge';
CREATE FUNCTION public.disparar_coletor(p_janela text) RETURNS bigint LANGUAGE sql AS $$ select 1::bigint $$;
CREATE FUNCTION public.vessel_espelhar_agora() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
begin
  perform public.disparar_robo('vessel-espelhar-lista', 'vessel-espelhar-lista', 'vessel-espelhar-lista', '{"origem":"gatilho"}'::jsonb, 120000);
  return null;
end $$;
`
  const r = limpar(sql)
  assert.equal(r.removidos.substituidas, 2)
  assert.doesNotMatch(r.sql, /CREATE FUNCTION public\.disparar_robo/)
  assert.doesNotMatch(r.sql, /net\.http_post/)
  assert.match(r.sql, /CREATE FUNCTION public\.disparar_coletor/)
  assert.match(r.sql, /perform public\.disparar_robo\('vessel-espelhar-lista'/)
})
```

**(c) Arquivos:** Create `api/internal/banco/migracoes/00007_disparos_pendentes.sql`, `api/internal/banco/disparos.go`, `api/internal/banco/disparos_test.go`; Modify `ops/migracao/limpar-dump.mjs`, `ops/migracao/limpar-dump.test.mjs`.

**(d) Dependências:** nenhuma.

- [ ] **Step 1:** Os testes (Go e node); ver falhar (`disparos_pendentes` não existe; `substituidas` é `undefined`).
- [ ] **Step 2:** A migração, `disparos.go` e a regra do `limpar-dump.mjs` (código de (a)).
- [ ] **Step 3:** `cd api && gofmt -l ./internal && go vet ./internal/banco/ && go test -count=1 -race -run 'TestDispararRobo|TestAtenderDisparo|TestRobosEsperados|TestMigr' ./internal/banco/` PASS; `node --test ops/migracao/limpar-dump.test.mjs` PASS; `cd api && go test -count=1 ./...` (a migração nova roda em todo teste: nada pode quebrar); mutações de (b) reprovam, uma por vez.
- [ ] **Step 4: Commit** `feat(api): disparar_robo sem pg_net — fila disparos_pendentes (um pendente por robô), banco.AtenderDisparo e o dump sem a função antiga` (+ `Co-Authored-By`).

---
