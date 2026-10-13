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
