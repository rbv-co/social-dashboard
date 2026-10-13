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
- **Ensaiado** (13/10, árvore descartável do `feat/api-go-plano-5-8` 41c24eba + estes arquivos, Postgres 17): os dois testes passam com `-race` (3 rodadas); `limpar-dump.test.mjs` com a regra e o caso novo: 15 `pass`. Mutações conferidas: sem `on conflict` → 23505 no 2º disparo; `ErrIncerto` como `falhou` → `falhou:1`; resultado gravado com o `ctx` da tarefa → `atendendo:1`; órfão de volta a `pendente` → "atendeu um órfão". Tirar só o `skip locked` (mantendo o `for update`) NÃO reprova, e está certo: o segundo espera e o `where situacao = 'pendente'` reavaliado não acha a linha.

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
- Mutações que têm de reprovar: tirar o `on conflict` (o 2º disparo dá 23505: o insert do cadastro quebraria); pegar com `select` e depois `update … where id = $1` em dois comandos (o teste dos 8 atendentes roda mais de uma vez); a reconciliação devolver o órfão a `pendente` (ele roda de novo); `ErrIncerto` tratado como `falhou`; gravar o resultado com o `ctx` da tarefa (o caso do prazo deixa a linha `atendendo`); tirar a regra `substituidas` (o teste node reprova).

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
	if v := textoDe(t, p, `select string_agg(situacao, ',' order by id) from disparos_pendentes where robo = 'espelho'`); v != "incerto,atendendo" {
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

### Task 2: D0 — fatia 5.10 do esquema de produção nos testes

**Revisor:** opus. **Depende de:** Task 1 (a `disparar_robo` nova, que `vessel_espelhar_agora` chama); 5.1 Task 1 (carregador, `usuarios`, `profiles`, `conta_ativa()` em `02-gatilhos.sql`).

**(a) Contrato**
- `esquema/01-tabelas-5-10.sql` (abaixo): as 11 tabelas com a policy `is_vessel_admin()` do catálogo (`levantamento/01-policies.csv:383-402`: `vessel_baixas`, `vessel_cartao_pedidos`, `vessel_clientes`, `vessel_edicoes`, `vessel_garantias_baixadas`, `vessel_leituras`, `vessel_lembretes`, `vessel_lotes`, `vessel_pecas`, `vessel_pedidos_de_registro`, `vessel_registros`) e `vessel_cartao_arquivos` (fora do catálogo; lida por `POST /vessel-baixar-cartao`), cada bloco com a migration de origem e os `alter table` posteriores já aplicados. `vessel_edicoes` é do 5.10 (Ruling 5.10-5). Duas colunas PRESUMIDAS, sem DDL no repositório: `vessel_registros.nascimento date` e `vessel_registros.bling_atualizado_em timestamptz` (a função de decidir as grava; o espelho do Bling as lê; conferidas no banco restaurado pelo `conferir`, Task 8).
- **Não declaradas** (de outras fatias): `vessel_lista_espera` e `vessel_pedidos` (5.11; `vessel_data_da_compra` só lê `vessel_pedidos` quando há número de pedido do Bling SEM data — os testes do 5.10 sempre dão a data na conferência), `acessos_conexoes` (5.4; a Task 6 a cria no teste se faltar). O 5.11 NÃO redeclara as 12 tabelas daqui.
- `esquema/03-funcoes-5-10.sql`: **35 funções verbatim** do levantamento, geradas pelo script do Step 2 e conferidas por hash: o portão `is_vessel_admin` (`02-funções.csv:1450-1461`); 11 ajudantes que as RPCs chamam (`vessel_chave_do_produto` 3662-3674, `vessel_cpf_mascarado` 4489-4498, `vessel_cpf_valido` 4499-4521, `vessel_meses_de_garantia` 6921-6932, `vessel_garantia_ate` 5984-5992, `vessel_data_da_compra` 4731-4762, `vessel_garantia_ate_do_registro` 5993-6011, `vessel_peca_presa` 7160-7191, `vessel_maior_da_serie` 6800-6816, `vessel_criar_pecas` 4522-4573, `vessel_renumerar_lote` 8782-8853) — em ordem de dependência, porque função `LANGUAGE sql` é conferida na criação; as 7 funções de gatilho (`vessel_toca_atualizado_em` 10940-10949, `vessel_lotes_marcar_teste` 6778-6787, `vessel_lote_novo_herda_material` 6724-6747, `vessel_lote_material_recalcula_garantia` 6710-6723, `vessel_lembretes_morre_com_o_registro` 6621-6635, `vessel_registros_preencher_cliente_id` 8768-8781, `vessel_espelhar_agora` 5771-5784 SEM o gatilho dele, que é do 5.11); e as 16 RPCs do painel (linhas na Task 4). O fechamento foi conferido por script (toda função que estas chamam está na lista, menos `conta_ativa`, que vem do `02-gatilhos.sql`, e `disparar_robo`, da migração 00007).
- **Os 6 gatilhos vivos**, no fim do `03`, com `create or replace trigger` e a orientação/OF/WHEN das migrations (o `03-triggers.csv` não traz OF nem WHEN): `trg_vessel_lotes_marcar_teste` (BEFORE INSERT OR UPDATE **OF sku**), `trg_vessel_lote_novo_herda_material` (BEFORE INSERT), `trg_vessel_lote_material_recalcula_garantia` (AFTER UPDATE **OF material** … **WHEN (old.material is distinct from new.material)**), `vessel_clientes_atualizado` (BEFORE UPDATE), `vessel_registros_preencher_cliente_id` (BEFORE INSERT), `vessel_registros_mata_o_lembrete` (AFTER INSERT). **Os 2 do levantamento que SAÍRAM de produção em 10/10** (`vessel_lote_novo_pede_foto`, `vessel_cartao_pedido_novo_acorda_o_robo`) ficam de fora, e as funções deles também (Ruling 5.10-4). A linha 5.10 da IV.2 do mestre conta 8: eram 8 no levantamento de 09/10.
- `TestEsquemaDeProducaoComOsGatilhosVerbatim` (5.1) ganha os 6 na lista exata (ordem alfabética: depois de `trg_impedir_autopromocao`; se o 5.9 já entrou, `conteudo_pecas_guarda` continua primeiro).
- `TestFatiaDaAutenticidade` porta, por COMPORTAMENTO, o que os `db/*.test.mjs` do selo provavam pelo TEXTO das migrations: `registro-com-conta.test.mjs` (o gatilho preenche `cliente_id` por `new.pedido_id`), `lembretes-de-registro.test.mjs` (o lembrete aberto morre com o registro), `trilha-de-edicoes.test.mjs` (a lista fechada de ações aceita toda ação que as funções do painel escrevem, e recusa outra), `vessel-registro-nao-toma-peca-com-dona.test.mjs` (o `bling` só para a chave de serviço — e, na compat, para ninguém: achado 2). `serie-continua-no-produto`, `cartao-trava-a-serie` e `transferencia-de-propriedade` ficam assim: a série contínua e a peça presa são provadas pelas rotas na Task 4 (`vessel_gerar_lote`, `vessel_editar_lote`, `vessel_excluir_lote`); a transferência pela dona (`vessel_transferencia_*`) é do Plano 6 (rotas públicas), e só o `vessel_trocar_dono` do painel entra aqui (Task 4). Os `db/*.test.mjs` continuam no repositório até o Plano 8 (eles leem `db/migrations`, que não muda).
- **Ensaiado** (13/10, Postgres 17, a mesma árvore da Task 1 + estes arquivos): a fatia carrega depois das do 5.1, 5.6 e 5.7 e antes das funções; `TestFatiaDaAutenticidade` e `TestEsquemaDeProducaoComOsGatilhosVerbatim` (com a lista nova) passam; `go test ./...` com a fatia carregada: todos os pacotes `ok`. Mutações conferidas: sem o gatilho `vessel_registros_mata_o_lembrete` (a lista e o lembrete reprovam); a `disparar_robo` antiga com `net.http_post` (o insert na tabela de prova quebra: `schema "net" does not exist`). Também ensaiadas, à mão no mesmo banco, as 16 funções como o selo, o super, o admin sem o módulo, o desativado e sem perfil (ver a Task 4).

**(b) Testes de aceitação** (`TestFatiaDaAutenticidade`, `esquema_selo_test.go`, código no Step 3)
- As 12 tabelas e `disparos_pendentes` existem; os gatilhos das `vessel_*` são EXATAMENTE os 6, com o momento certo.
- O gatilho de produção `vessel_espelhar_agora` numa tabela de prova: 3 inserts e 3 updates não quebram e viram UM pedido (`vessel-espelhar-lista|pendente|6|{"origem": "gatilho"}`).
- Lote: o segundo lote do mesmo SKU herda `canvas|herdado`; SKU `teste-01` marca `teste`; trocar o SKU recalcula.
- Registro: `cliente_id` vem do pedido; o lembrete aberto vira `registro|true`; mudar o material do lote para `couro` recalcula a garantia pela data da conferência (`2026-01-10` + 6 meses = `2026-07-10`); `vessel_clientes_atualizado` toca `atualizado_em`.
- Trilha: as 10 ações do painel entram; `inventada` = 23514.
- Portão: o selo passa em `vessel_alertas`; o admin sem o módulo recebe `sem_permissao`; `vessel_decidir_pedido_de_registro` com `bling` = `sem_permissao` como o selo, como o super e sem identidade.
- Mutações que têm de reprovar: tirar um gatilho do `03` (a lista reprova); a `disparar_robo` antiga (o insert de prova quebra); declarar `vessel_lista_espera` aqui e o 5.11 também (`42P07` na carga — conferido no merge, não por teste); o gatilho fora da lista do teste do 5.1.

**(c) Arquivos:** Create `api/internal/testebanco/esquema/01-tabelas-5-10.sql`, `api/internal/testebanco/esquema/03-funcoes-5-10.sql`, `api/internal/testebanco/esquema_selo_test.go`; Modify `api/internal/testebanco/esquema_test.go` (e `esquema/gerar-gatilhos.mjs` só no caso do Step 4).

**(d) Dependências:** Task 1; 5.1 Task 1.

- [ ] **Step 1: A DDL da fatia.** Crie `api/internal/testebanco/esquema/01-tabelas-5-10.sql`:

```sql
-- FATIA 5.10 do esquema de produção para os testes (D0 reconstruído: Rulings 5.1-1, 5.9-1 e 5.10-4). Carrega
-- depois de 01-tabelas-5-01.sql (usuarios, profiles). As 11 tabelas com a policy is_vessel_admin() do catálogo
-- e vessel_cartao_arquivos (lida por POST /vessel-baixar-cartao), das migrations; FKs de auth.users não há.
-- PRESUMIDAS (sem DDL no repositório: existem em produção, a função vessel_decidir_pedido_de_registro as grava e
-- a edge vessel-espelhar-lista as lê): vessel_registros.nascimento e vessel_registros.bling_atualizado_em.
-- NÃO declaradas aqui: vessel_lista_espera e vessel_pedidos (5.11: vessel_data_da_compra lê vessel_pedidos só
-- quando há número de pedido do Bling sem data — os testes do 5.10 dão a data), acessos_conexoes (5.4). Os 6
-- gatilhos vivos e as 35 funções vão VERBATIM em 03-funcoes-5-10.sql.

-- db/migrations/2026-08-04-vessel-verify.sql:19-28 + 2026-08-04-vessel-verify-fotos.sql:11
-- + 2026-09-04-vessel-lote-ganha-numero-da-os.sql:8 + 2026-09-17-vessel-lote-de-teste.sql:44-45,53-54
-- + 2026-09-18-zz-vessel-garantia-pelo-material.sql:54-76
create table public.vessel_lotes (
  id             uuid primary key default gen_random_uuid(),
  modelo         text not null,
  cor            text,
  sku            text,
  quantidade     int  not null,
  fabricado_em   date not null default current_date,
  criado_por     uuid,
  criado_em      timestamptz not null default now(),
  fotos          text[],
  os             text,
  teste          boolean not null default false,
  material       text,
  material_fonte text,
  constraint vessel_lotes_material_check check (material is null or material in ('canvas', 'couro')),
  constraint vessel_lotes_material_fonte_check
    check (material_fonte is null or material_fonte in ('dono', 'bling_estrutura', 'painel', 'herdado')),
  constraint vessel_lotes_material_com_fonte_check check (material is not null or material_fonte is null)
);
create index vessel_lotes_teste_idx on public.vessel_lotes (teste) where teste;

-- 2026-08-04-vessel-verify.sql:30-36 + 2026-09-11-vessel-cartoes-fila-e-trava.sql:32-33
create table public.vessel_pecas (
  codigo           text primary key,
  lote_id          uuid references public.vessel_lotes(id) on delete cascade,
  numero_na_serie  int  not null,
  gravada_em       timestamptz,
  criado_em        timestamptz not null default now(),
  cartao_gerado_em timestamptz
);

-- 2026-09-17-vessel-contas-base.sql:18-34
create table public.vessel_clientes (
  id                  uuid primary key default gen_random_uuid(),
  nome                text not null,
  cpf                 text not null unique,
  email               text not null unique,
  whatsapp            text,
  nascimento          date,
  cidade              text,
  senha_hash          text not null,
  senha_trocada_em    timestamptz,
  email_confirmado_em timestamptz,
  bling_contato_id    bigint,
  pessoa_id           bigint,
  teste               boolean not null default false,
  criado_em           timestamptz not null default now(),
  atualizado_em       timestamptz not null default now()
);

-- 2026-09-03-zz-vessel-garantia-com-dono.sql:93-123 + 2026-09-16-zz-vessel-abrir-pedido-com-nascimento.sql:53-54
-- + 2026-09-17-vessel-registro-com-conta.sql:17-19
create table public.vessel_pedidos_de_registro (
  id               uuid primary key default gen_random_uuid(),
  codigo           text not null references public.vessel_pecas(codigo) on delete cascade,
  nome             text not null,
  cpf              text not null,
  whatsapp         text not null,
  onde_comprou     text,
  comprado_em      date,
  estado           text not null default 'pendente' check (estado in ('pendente', 'aprovado', 'recusado')),
  decidido_por_que text check (decidido_por_que in ('bling', 'na_mao')),
  conferencia      jsonb,
  criado_em        timestamptz not null default now(),
  decidido_em      timestamptz,
  decidido_quem    uuid,
  motivo           text,
  nascimento       date,
  cliente_id       uuid references public.vessel_clientes(id),
  presente_de_nome text
);
create index vessel_pedidos_registro_codigo_idx on public.vessel_pedidos_de_registro (codigo, criado_em desc);
create index vessel_pedidos_registro_pendente_idx on public.vessel_pedidos_de_registro (criado_em) where estado = 'pendente';

-- 2026-08-04-vessel-verify.sql:43-51 + 2026-09-03-zz-vessel-garantia-com-dono.sql:137-141
-- + 2026-09-17-vessel-registro-com-conta.sql:15-16 + 2026-09-18-zz-vessel-garantia-pelo-material.sql:96
-- + PRESUMIDAS: nascimento, bling_atualizado_em (ver o cabeçalho)
create table public.vessel_registros (
  codigo              text primary key references public.vessel_pecas(codigo) on delete cascade,
  nome                text not null,
  whatsapp            text not null,
  onde_comprou        text,
  comprado_em         date,
  garantia_ate        date,
  registrado_em       timestamptz not null default now(),
  cpf                 text,
  pedido_id           uuid references public.vessel_pedidos_de_registro(id),
  bling_contato_id    text,
  bling_pedido        text,
  cliente_id          uuid references public.vessel_clientes(id),
  nascimento          date,
  bling_atualizado_em timestamptz
);

-- 2026-08-04-vessel-verify.sql:53-62
create table public.vessel_leituras (
  id       bigserial primary key,
  codigo   text not null,
  achou    boolean not null,
  agente   text,
  ip_hash  text,
  lido_em  timestamptz not null default now()
);
create index vessel_leituras_codigo_idx on public.vessel_leituras (codigo, lido_em desc);

-- 2026-08-30-vessel-baixas.sql:15-30 + 2026-09-01-vessel-editar-etiquetas.sql:324-338 (o motivo 'teste')
create table public.vessel_baixas (
  id           uuid primary key default gen_random_uuid(),
  codigo       text not null references public.vessel_pecas(codigo) on delete cascade,
  motivo       text not null constraint vessel_baixas_motivo_check
               check (motivo in ('extraviada', 'defeito', 'devolvida', 'etiqueta_perdida', 'teste')),
  baixada_em   timestamptz not null default now(),
  baixada_por  uuid,
  desfeita_em  timestamptz,
  desfeita_por uuid
);
create index vessel_baixas_codigo_idx on public.vessel_baixas (codigo);
create unique index vessel_baixas_ativa_idx on public.vessel_baixas (codigo) where desfeita_em is null;

-- 2026-09-01-vessel-editar-etiquetas.sql:46-59 + a lista de ações de 2026-09-19-zz-vessel-trilha-a-lista-inteira.sql:28-37
-- (a última a redefinir o check; a trilha não tem FK de propósito: sobrevive à peça excluída)
create table public.vessel_edicoes (
  id        uuid primary key default gen_random_uuid(),
  codigo    text not null,
  acao      text not null constraint vessel_edicoes_acao_check check (acao = any (array[
              'desmarcar_gravada', 'sobrescrever_para_fila', 'sobrescrever_para_baixa',
              'registro_aprovado', 'registro_recusado', 'dono_trocado', 'baixar_garantia',
              'lote_excluido', 'peca_excluida', 'etiqueta_adotada', 'numero_trocado',
              'transferida_pela_dona', 'material_do_lote', 'conta_ligada_pelo_cpf'])),
  motivo    text,
  detalhes  jsonb not null default '{}'::jsonb,
  feito_por uuid,
  feito_em  timestamptz not null default now()
);
create index vessel_edicoes_codigo_idx on public.vessel_edicoes (codigo, feito_em desc);

-- 2026-09-05-vessel-garantias-baixadas.sql:38-53
create table public.vessel_garantias_baixadas (
  id               bigint generated always as identity primary key,
  codigo           text not null,
  nome             text,
  whatsapp         text,
  cpf              text,
  onde_comprou     text,
  comprado_em      date,
  garantia_ate     date,
  registrado_em    timestamptz,
  bling_contato_id text,
  bling_pedido     text,
  motivo           text not null,
  baixada_em       timestamptz not null default now(),
  baixada_por      uuid
);

-- 2026-09-11-vessel-cartoes-fila-e-trava.sql:39-70
create table public.vessel_cartao_pedidos (
  id          uuid primary key default gen_random_uuid(),
  pecas       text[] not null,
  situacao    text not null default 'na_fila' check (situacao in ('na_fila', 'rodando', 'pronto', 'falhou')),
  pasta       text,
  erro        text,
  criado_por  uuid,
  criado_em   timestamptz not null default now(),
  comecou_em  timestamptz,
  terminou_em timestamptz
);
create index vessel_cartao_pedidos_recentes on public.vessel_cartao_pedidos (criado_em desc);
create index vessel_cartao_pedidos_na_fila on public.vessel_cartao_pedidos (criado_em) where situacao in ('na_fila', 'rodando');

-- 2026-10-09-vessel-cartao-arquivos.sql:17-24 (fora do catálogo: só o robô grava e a rota do cartão lê)
create table public.vessel_cartao_arquivos (
  codigo        text not null,
  nome          text not null,
  zoho_id       text not null,
  pasta_id      text,
  atualizado_em timestamptz not null default now(),
  primary key (codigo, nome)
);

-- 2026-09-19-zzz-vessel-lembretes-register-later.sql:66-135
create table public.vessel_lembretes (
  id               uuid primary key default gen_random_uuid(),
  peca_codigo      text not null,
  email            text not null,
  cliente_id       uuid references public.vessel_clientes(id),
  consentimento_em timestamptz not null,
  criado_em        timestamptz not null default now(),
  enviado_7_em     timestamptz,
  enviado_30_em    timestamptz,
  cancelado_em     timestamptz,
  cancelado_por    text,
  token_hash       text,
  constraint vessel_lembretes_codigo_normalizado_check
    check (peca_codigo = upper(regexp_replace(peca_codigo, '[\s.\-_]', '', 'g'))),
  constraint vessel_lembretes_email_normalizado_check check (email = lower(btrim(email)) and email <> ''),
  constraint vessel_lembretes_cancelamento_check check ((cancelado_em is null) = (cancelado_por is null)),
  constraint vessel_lembretes_cancelado_por_check check (cancelado_por is null or cancelado_por in ('cliente', 'registro'))
);
create unique index vessel_lembretes_um_aberto_idx on public.vessel_lembretes (peca_codigo)
  where cancelado_em is null and enviado_30_em is null;
create index vessel_lembretes_peca_idx on public.vessel_lembretes (peca_codigo, criado_em desc);
create index vessel_lembretes_email_idx on public.vessel_lembretes (email, criado_em desc);
create index vessel_lembretes_token_idx on public.vessel_lembretes (token_hash) where token_hash is not null;
```

- [ ] **Step 2: As funções e os gatilhos, verbatim.** Rode, da raiz da worktree, o gerador de uso único (fica fora do repositório; no scratchpad da sessão, não em `/tmp` compartilhado):

```bash
SCRATCH=$(mktemp -d)
cat > "$SCRATCH/fatia510.mjs" <<'FIM'
// Gera esquema/03-funcoes-5-10.sql VERBATIM do levantamento (uso único, Plano 5.10 Task 2).
// node fatia510.mjs <levantamento>/02-funções.csv > api/internal/testebanco/esquema/03-funcoes-5-10.sql
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
// a ordem importa: função LANGUAGE sql é conferida na criação (as que ela chama têm de existir antes)
const ajudantes = ['is_vessel_admin', 'vessel_chave_do_produto', 'vessel_cpf_mascarado', 'vessel_cpf_valido',
  'vessel_meses_de_garantia', 'vessel_garantia_ate', 'vessel_data_da_compra', 'vessel_garantia_ate_do_registro',
  'vessel_peca_presa', 'vessel_maior_da_serie', 'vessel_criar_pecas', 'vessel_renumerar_lote'];
const dosGatilhos = ['vessel_toca_atualizado_em', 'vessel_lotes_marcar_teste', 'vessel_lote_novo_herda_material',
  'vessel_lote_material_recalcula_garantia', 'vessel_lembretes_morre_com_o_registro',
  'vessel_registros_preencher_cliente_id', 'vessel_espelhar_agora'];
const rpcs = ['vessel_alertas', 'vessel_baixar_garantia', 'vessel_baixar_peca', 'vessel_decidir_pedido_de_registro',
  'vessel_definir_material_do_lote', 'vessel_desfazer_baixa', 'vessel_desmarcar_gravada', 'vessel_editar_lote',
  'vessel_excluir_lote', 'vessel_excluir_peca', 'vessel_fila_de_registros', 'vessel_gerar_lote', 'vessel_marcar_gravada',
  'vessel_pedir_cartoes', 'vessel_sobrescrever_etiqueta', 'vessel_trocar_dono'];
const todas = [...ajudantes, ...dosGatilhos, ...rpcs];
for (const n of todas) if (!corpo.has(n)) { console.error(`falta ${n} no CSV`); process.exit(1); }
// os 6 gatilhos vivos em produção, com a orientação, o OF e o WHEN das migrations (03-triggers.csv não os traz)
const gatilhos = `
-- 2026-09-17-vessel-lote-de-teste.sql:94-98
create or replace trigger trg_vessel_lotes_marcar_teste before insert or update of sku on public.vessel_lotes
  for each row execute function public.vessel_lotes_marcar_teste();
-- 2026-09-18-zz-vessel-garantia-pelo-material.sql:377-381
create or replace trigger trg_vessel_lote_novo_herda_material before insert on public.vessel_lotes
  for each row execute function public.vessel_lote_novo_herda_material();
-- 2026-09-18-zz-vessel-garantia-pelo-material.sql:331-336
create or replace trigger trg_vessel_lote_material_recalcula_garantia after update of material on public.vessel_lotes
  for each row when (old.material is distinct from new.material)
  execute function public.vessel_lote_material_recalcula_garantia();
-- 2026-09-17-vessel-contas-base.sql:77-80
create or replace trigger vessel_clientes_atualizado before update on public.vessel_clientes
  for each row execute function public.vessel_toca_atualizado_em();
-- 2026-09-17-vessel-registro-com-conta.sql:230-233
create or replace trigger vessel_registros_preencher_cliente_id before insert on public.vessel_registros
  for each row execute function public.vessel_registros_preencher_cliente_id();
-- 2026-09-19-zzz-vessel-lembretes-register-later.sql:472-475
create or replace trigger vessel_registros_mata_o_lembrete after insert on public.vessel_registros
  for each row execute function public.vessel_lembretes_morre_com_o_registro();
`;
process.stdout.write(
  '-- VERBATIM de levantamento/02-funções.csv (gerado por fatia510.mjs, Plano 5.10 Task 2): o portão is_vessel_admin,\n' +
  '-- 11 ajudantes, as 7 funções de gatilho (vessel_espelhar_agora SEM gatilho: o dele é da fatia do 5.11, em\n' +
  '-- vessel_lista_espera) e as 16 RPCs do painel. Os 6 gatilhos vivos em produção vão no fim, com OF/WHEN das\n' +
  '-- migrations; vessel_lote_novo_pede_foto e vessel_cartao_pedido_novo_acorda_o_robo NÃO (removidos em 10/10:\n' +
  '-- db/migrations/2026-10-10-robos-na-vps-sem-gatilho-do-actions.sql). `create or replace trigger`: se o gerador do\n' +
  '-- 02-gatilhos.sql também os emitir (com CONFERIDOS), a recriação aqui é a mesma (Rulings 5.7-1, 5.9-1, 5.10-4).\n\n' +
  todas.map((n) => corpo.get(n)).join('\n') + gatilhos);
FIM
node "$SCRATCH/fatia510.mjs" /Users/gabrielgertrudes/Projetos/Trabalho/lavessel/social-dashboard/.claude/worktrees/levantamento-ro/docs/migracao-go/levantamento/02-funções.csv \
  > api/internal/testebanco/esquema/03-funcoes-5-10.sql
shasum -a 256 api/internal/testebanco/esquema/03-funcoes-5-10.sql
# 84ed26b8f20e693b40e08d0368d5c6e558d919e3812b288dd169f84066c59c2f (o do ensaio). Hash diferente = o levantamento mudou: pare e reporte.
grep -c 'CREATE OR REPLACE FUNCTION' api/internal/testebanco/esquema/03-funcoes-5-10.sql   # 35
grep -c '^create or replace trigger' api/internal/testebanco/esquema/03-funcoes-5-10.sql   # 6
```

- [ ] **Step 3: O teste.** Crie `api/internal/testebanco/esquema_selo_test.go`:

```go
package testebanco

import (
	"context"
	"errors"
	"reflect"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/rbv-co/social-dashboard/api/internal/banco"
)

// A fatia 5.10: as 12 tabelas do selo, os 6 gatilhos vivos em produção (com o OF e o WHEN das migrations), as 35
// funções verbatim e a disparar_robo nova (migração 00007). Porta, por COMPORTAMENTO, o que os db/*.test.mjs do
// selo provavam pelo texto das migrations: registro-com-conta (o gatilho preenche cliente_id pelo pedido),
// lembretes-de-registro (o lembrete morre com o registro), trilha-de-edicoes (a lista fechada de ações),
// vessel-registro-nao-toma-peca-com-dona (o 'bling' só para a chave de serviço). A série, a peça presa e as
// recusas das funções são da Task 4 (pelas rotas).
func TestFatiaDaAutenticidade(t *testing.T) {
	p := ComEsquemaDeProducao(t)
	ctx := context.Background()
	const (
		selo    = "a5a10000-0000-4000-a000-000000000001" // features {autenticidade}
		super   = "a5a10000-0000-4000-a000-000000000002" // is_superadmin da ficha, sem o módulo
		admin   = "a5a10000-0000-4000-a000-000000000003" // papel admin, sem o módulo: is_vessel_admin NÃO olha o papel
		lote1   = "a5a20000-0000-4000-a000-0000000000b1"
		lote2   = "a5a20000-0000-4000-a000-0000000000b2"
		lote3   = "a5a20000-0000-4000-a000-0000000000b3"
		pedido  = "a5a30000-0000-4000-a000-0000000000d1"
		cliente = "a5a40000-0000-4000-a000-0000000000c1"
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
	exec := func(sql string, args ...any) {
		t.Helper()
		if _, err := p.Exec(ctx, sql, args...); err != nil {
			t.Fatalf("%s: %v", sql, err)
		}
	}
	como := func(id, sql string, args ...any) string {
		t.Helper()
		var v *string
		if err := banco.ComUsuario(ctx, p, id, func(tx pgx.Tx) error { return tx.QueryRow(ctx, sql, args...).Scan(&v) }); err != nil {
			t.Fatalf("%s como %s: %v", sql, id, err)
		}
		if v == nil {
			return "<nulo>"
		}
		return *v
	}

	for _, tab := range []string{"vessel_lotes", "vessel_pecas", "vessel_clientes", "vessel_pedidos_de_registro", "vessel_registros",
		"vessel_leituras", "vessel_baixas", "vessel_edicoes", "vessel_garantias_baixadas", "vessel_cartao_pedidos",
		"vessel_cartao_arquivos", "vessel_lembretes", "disparos_pendentes"} {
		if um(`select coalesce(to_regclass($1::text)::text, 'falta')`, "public."+tab) == "falta" {
			t.Errorf("tabela %s não existe", tab)
		}
	}
	// os gatilhos do selo: os 6 vivos; vessel_lote_novo_pede_foto e vessel_cartao_pedido_novo_acorda_o_robo saíram em 10/10
	linhas, err := p.Query(ctx, `select c.relname::text || '.' || g.tgname::text || ':' ||
		  case when g.tgtype::int & 2 = 2 then 'before' else 'after' end
		  from pg_trigger g join pg_class c on c.oid = g.tgrelid
		 where not g.tgisinternal and c.relname like 'vessel\_%' order by 1`)
	if err != nil {
		t.Fatal(err)
	}
	gat, err := pgx.CollectRows(linhas, pgx.RowTo[string])
	if err != nil {
		t.Fatal(err)
	}
	if quer := []string{"vessel_clientes.vessel_clientes_atualizado:before",
		"vessel_lotes.trg_vessel_lote_material_recalcula_garantia:after", "vessel_lotes.trg_vessel_lote_novo_herda_material:before",
		"vessel_lotes.trg_vessel_lotes_marcar_teste:before", "vessel_registros.vessel_registros_mata_o_lembrete:after",
		"vessel_registros.vessel_registros_preencher_cliente_id:before"}; !reflect.DeepEqual(gat, quer) {
		t.Errorf("gatilhos do selo = %v, esperava %v", gat, quer)
	}

	// o gatilho de produção da lista de espera (o dele é do 5.11) numa tabela de prova: insert e update não quebram, e
	// os 6 disparos (3 inserts, 3 updates) viram UM pedido pendente
	exec(`create table lista_de_prova (id int);
		create trigger lista_de_prova_espelhar after insert or update on lista_de_prova
		  for each row execute function vessel_espelhar_agora();
		insert into lista_de_prova values (1);
		insert into lista_de_prova values (2), (3);
		update lista_de_prova set id = id + 10`)
	if v := um(`select robo || '|' || situacao || '|' || pedidos || '|' || corpo::text from disparos_pendentes`); v != `vessel-espelhar-lista|pendente|6|{"origem": "gatilho"}` {
		t.Errorf("disparos do espelho = %s", v)
	}

	// lote: marcar teste pelo prefixo do SKU (no insert e no update OF sku) e herdar o material do último lote do SKU
	exec(`insert into vessel_lotes (id, modelo, sku, quantidade, material, material_fonte) values ($1::uuid, 'Linear', 'SS0001HB.S1', 3, 'canvas', 'dono')`, lote1)
	exec(`insert into vessel_lotes (id, modelo, sku, quantidade) values ($1::uuid, 'Linear', 'SS0001HB.S1', 1)`, lote3)
	exec(`insert into vessel_lotes (id, modelo, sku, quantidade) values ($1::uuid, 'Prova', 'teste-01', 2)`, lote2)
	if v := um(`select material || '|' || material_fonte || '|' || teste::text from vessel_lotes where id = $1::uuid`, lote3); v != "canvas|herdado|false" {
		t.Errorf("lote novo do mesmo SKU = %s", v)
	}
	if v := um(`select teste::text || '|' || coalesce(material, '-') from vessel_lotes where id = $1::uuid`, lote2); v != "true|-" {
		t.Errorf("lote de teste = %s", v)
	}
	exec(`update vessel_lotes set sku = 'SS9' where id = $1::uuid`, lote2)
	if v := um(`select teste::text from vessel_lotes where id = $1::uuid`, lote2); v != "false" {
		t.Errorf("trocar o SKU não recalculou teste: %s", v)
	}

	// registro: o gatilho preenche cliente_id pelo PEDIDO (new.pedido_id) e mata o lembrete aberto da peça
	exec(`insert into vessel_pecas (codigo, lote_id, numero_na_serie, gravada_em) values ('VBAAAA0003', $1::uuid, 3, now())`, lote1)
	exec(`insert into vessel_clientes (id, nome, cpf, email, senha_hash) values ($1::uuid, 'Ana', '52998224725', 'ana@x.com', 'x')`, cliente)
	exec(`insert into vessel_pedidos_de_registro (id, codigo, nome, cpf, whatsapp, estado, decidido_por_que, conferencia, criado_em, cliente_id)
		values ($1::uuid, 'VBAAAA0003', 'Ana Cliente', '52998224725', '11999990000', 'aprovado', 'na_mao', '{"quando":"2026-01-10"}',
		  '2026-01-12T12:00:00Z', $2::uuid)`, pedido, cliente)
	exec(`insert into vessel_lembretes (peca_codigo, email, consentimento_em) values ('VBAAAA0003', 'ana@x.com', now())`)
	exec(`insert into vessel_registros (codigo, nome, whatsapp, garantia_ate, registrado_em, cpf, pedido_id, bling_pedido)
		values ('VBAAAA0003', 'Ana Cliente', '11999990000', '2028-01-10', '2026-01-15T15:00:00Z', '52998224725', $1::uuid, '777')`, pedido)
	if v := um(`select cliente_id::text from vessel_registros where codigo = 'VBAAAA0003'`); v != cliente {
		t.Errorf("cliente_id do registro = %s", v)
	}
	if v := um(`select cancelado_por || '|' || (cancelado_em is not null)::text from vessel_lembretes`); v != "registro|true" {
		t.Errorf("lembrete depois do registro = %s", v)
	}
	// material do lote muda → a garantia recalcula pela data da compra da conferência (couro: 6 meses)
	exec(`update vessel_lotes set material = 'couro', material_fonte = 'painel' where id = $1::uuid`, lote1)
	if v := um(`select garantia_ate::text from vessel_registros where codigo = 'VBAAAA0003'`); v != "2026-07-10" {
		t.Errorf("garantia em couro = %s", v)
	}
	exec(`update vessel_clientes set nome = 'Ana B' where id = $1::uuid`, cliente)
	if v := um(`select (atualizado_em > criado_em)::text from vessel_clientes`); v != "true" {
		t.Error("vessel_clientes_atualizado não tocou atualizado_em")
	}

	// a trilha aceita toda ação que as funções do painel escrevem, e só a lista fechada
	for _, acao := range []string{"desmarcar_gravada", "sobrescrever_para_fila", "sobrescrever_para_baixa", "registro_aprovado",
		"registro_recusado", "dono_trocado", "baixar_garantia", "lote_excluido", "peca_excluida", "material_do_lote"} {
		if _, err := p.Exec(ctx, `insert into vessel_edicoes (codigo, acao) values ('X', $1::text)`, acao); err != nil {
			t.Errorf("a trilha recusou %s: %v", acao, err)
		}
	}
	_, err = p.Exec(ctx, `insert into vessel_edicoes (codigo, acao) values ('X', 'inventada')`)
	if pe := (*pgconn.PgError)(nil); !errors.As(err, &pe) || pe.Code != "23514" {
		t.Errorf("ação fora da lista = %v", err)
	}

	// o portão das funções: módulo ou super da ficha; o papel admin sozinho, não
	exec(`insert into usuarios (id, email) values ($1::uuid, 'selo@x.com'), ($2::uuid, 'super@x.com'), ($3::uuid, 'admin@x.com')`, selo, super, admin)
	exec(`insert into profiles (id, email, role, features, is_superadmin) values ($1::uuid, 'selo@x.com', 'viewer', '{autenticidade}', false),
		  ($2::uuid, 'super@x.com', 'viewer', '{}', true), ($3::uuid, 'admin@x.com', 'admin', '{}', false)`, selo, super, admin)
	if v := como(selo, `select vessel_alertas()->>'ok'`); v != "true" {
		t.Errorf("selo nos alertas = %s", v)
	}
	if v := como(admin, `select vessel_alertas()->>'motivo'`); v != "sem_permissao" {
		t.Errorf("admin sem o módulo nos alertas = %s", v)
	}
	// 'bling' (aprovação automática) na compat: ninguém passa — nem o selo, nem o super, nem uma conexão sem identidade
	// (auth.role() da compat nunca é nulo e o papel nunca é service_role): é do Plano 6 (achado 2)
	for _, id := range []string{selo, super} {
		if v := como(id, `select vessel_decidir_pedido_de_registro($1::uuid, 'aprovado', 'bling', '{"pedido":"9"}'::jsonb, null)->>'motivo'`, pedido); v != "sem_permissao" {
			t.Errorf("'bling' como %s = %s", id, v)
		}
	}
	if v := um(`select vessel_decidir_pedido_de_registro($1::uuid, 'aprovado', 'bling', '{"pedido":"9"}'::jsonb, null)->>'motivo'`, pedido); v != "sem_permissao" {
		t.Errorf("'bling' sem identidade = %s", v)
	}
}
```

- [ ] **Step 4: A lista de gatilhos.** Em `api/internal/testebanco/esquema_test.go`, `TestEsquemaDeProducaoComOsGatilhosVerbatim`: a lista `quer` ganha, depois de `"trg_impedir_autopromocao"`, `"trg_vessel_lote_material_recalcula_garantia", "trg_vessel_lote_novo_herda_material", "trg_vessel_lotes_marcar_teste", "vessel_clientes_atualizado", "vessel_registros_mata_o_lembrete", "vessel_registros_preencher_cliente_id"` (a ordem do `order by 1` em `en_US.utf8`, conferida no ensaio). **Se o pré-voo achou `CONFERIDOS` em `gerar-gatilhos.mjs` (o 5.2 entrou):** o gerador passa a emitir os gatilhos de TODA tabela declarada em `01-tabelas-*.sql` — inclusive os 2 que saíram de produção em 10/10 (o `03-triggers.csv` é de 09/10). Acrescente as 8 entradas e o filtro de uma linha, sem regerar o `02-gatilhos.sql` aqui:

```js
  'vessel_clientes.vessel_clientes_atualizado': {},                                     // db/migrations/2026-09-17-vessel-contas-base.sql:77-80
  'vessel_lotes.trg_vessel_lotes_marcar_teste': { de: 'sku' },                          // db/migrations/2026-09-17-vessel-lote-de-teste.sql:94-98
  'vessel_lotes.trg_vessel_lote_novo_herda_material': {},                               // db/migrations/2026-09-18-zz-vessel-garantia-pelo-material.sql:377-381
  'vessel_lotes.trg_vessel_lote_material_recalcula_garantia': { de: 'material', quando: 'old.material is distinct from new.material' }, // 2026-09-18-zz-vessel-garantia-pelo-material.sql:331-336
  'vessel_registros.vessel_registros_preencher_cliente_id': {},                         // db/migrations/2026-09-17-vessel-registro-com-conta.sql:230-233
  'vessel_registros.vessel_registros_mata_o_lembrete': {},                              // db/migrations/2026-09-19-zzz-vessel-lembretes-register-later.sql:472-475
  'vessel_lotes.vessel_lote_novo_pede_foto': { fora: true },                            // REMOVIDO em produção: db/migrations/2026-10-10-robos-na-vps-sem-gatilho-do-actions.sql:13
  'vessel_cartao_pedidos.vessel_cartao_pedido_novo_acorda_o_robo': { fora: true },      // REMOVIDO em produção: idem :14
```
e, logo depois do laço que exige `CONFERIDOS` (antes de calcular `chamadas`), `for (const [k] of gatilhos) if (CONFERIDOS[k].fora) gatilhos.delete(k);` (o gatilho removido não sai, nem a função dele). O `create or replace trigger` do `03-funcoes-5-10.sql` torna a dupla emissão idempotente; quem regerar o `02` (5.3) confere que os 2 removidos não aparecem.

- [ ] **Step 5:** `cd api && gofmt -l ./internal && go test -count=1 -run 'TestFatia|TestEsquema|TestNomesDosArquivos' ./internal/testebanco/` PASS (inclui `TestFatiaDaFabrica` etc. das outras fatias e o de nomes de dois dígitos); `go test -count=1 ./...` (a fatia carrega em todo `ComEsquemaDeProducao`); mutações de (b) reprovam, uma por vez.
- [ ] **Step 6: Commit** `test(api): D0 — fatia 5.10 do esquema (as 12 tabelas do selo, 35 funções verbatim e os 6 gatilhos vivos)` (+ `Co-Authored-By`).

---

### Task 3: `vessel` — o mundo do selo e as 6 leituras

**Revisor:** sonnet. **Depende de:** Task 2 (a fatia).

**(a) Contrato**
- `vessel/mundo_test.go`: as pessoas (`selo` com o módulo `autenticidade`; `super` com `is_superadmin` e nenhum módulo; `admin` = papel `admin` com outros módulos; `leitor`; `desativado` com o módulo; `chave` = a chave `autenticidade` só em `permissions`), o "entrar como" (`impersonado` = o super entrou como o selo), as linhas (2 lotes, 5 peças, a dona de P3 com CPF, nascimento e o pedido do Bling, 2 pedidos de registro pendentes, uma baixa ativa e uma desfeita, 2 pedidos de cartão, um lembrete com `token_hash`, 2 leituras) e `fotoDoSelo` (as 9 tabelas que as RPCs gravam e `disparos_pendentes`). Toda conferência negada da Task 4 compara a foto antes e depois.
- `vessel/leituras.go`: as 6 GETs, uma por leitura da tela (Ruling 5.10-6), com a regra de Ler do catálogo (`is_vessel_admin()`), sem filtro de recorte (o selo é um só). `/autenticidade/lotes` com TODAS as colunas (a busca universal varre o lote); `/autenticidade/pecas` com `?codigo=` (lista; a tela relê em blocos de 100 códigos de 10 caracteres: ~1,1 KB na URL); `/autenticidade/registros` SEM `cpf`, `nascimento`, `cliente_id`, `pedido_id`, `bling_contato_id`, `bling_atualizado_em`, `presente_de_nome` (Ruling 5.10-7); `/autenticidade/baixas` só as ativas; `/autenticidade/cartao-pedidos` (a tela manda `?limite=20`); `/autenticidade/lembretes` sem `token_hash`. Ordens padrão = as da tela.
- A doc do pacote (`rd.go:1`) passa a `// Package vessel: as tarefas da Vessel que o worker roda (Plano 4) e o painel de Autenticidade do selo (Plano 5.10): leituras, RPCs e o cartão EAN.`
- **Ensaiado** (13/10, a mesma árvore + Tasks 1–2): `TestMundoDoSelo` e `TestLeiturasDoSelo` passam com `-race` na primeira rodada.

```go
package vessel

import (
	"maps"
	"slices"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/autz"
	"github.com/rbv-co/social-dashboard/api/internal/dados"
)

// leituras: as 6 leituras da tela de Autenticidade (tela-de-autenticidade.vue: carregar, carregarLembretes,
// carregarAFilaDeCartoes, atualizarAsPecas, recarregarAsPecas). Regra = catálogo: is_vessel_admin() nas 6 tabelas
// (o módulo 'autenticidade' em features ou is_superadmin da ficha, conta ativa); quem não passa recebe 200 [] e
// X-Total-Count 0 (Ruling 9 do mestre). O selo é um só para a casa: nenhum recorte por conta, loja ou dono. As
// tabelas que a tela não lê direto (clientes, leituras, garantias baixadas, pedidos de registro, trilha) não têm
// rota: as funções as leem (Ruling 5.10-6).
var leituras = map[string]dados.Consulta{
	// TODAS as colunas: a tela lia select('*') e a busca universal varre o lote inteiro (busca-e-arquivamento.js:73-85)
	"/autenticidade/lotes": {Tabela: "vessel_lotes", Alias: "l",
		SQL: `select l.id, l.modelo, l.cor, l.sku, l.quantidade, l.fabricado_em, l.criado_por, l.criado_em, l.fotos, l.os,
		  l.teste, l.material, l.material_fonte from vessel_lotes l`,
		OrdemPadrao: "l.criado_em desc", Desempate: "l.id"},
	// ?codigo=A,B relê só as peças de um pedido de cartão que terminou (atualizarAsPecas, em blocos de 100)
	"/autenticidade/pecas": {Tabela: "vessel_pecas", Alias: "p",
		SQL:         `select p.codigo, p.lote_id, p.numero_na_serie, p.gravada_em, p.cartao_gerado_em from vessel_pecas p`,
		Filtros:     []dados.Filtro{{Param: "codigo", SQL: "p.codigo = any(@codigo::text[])", Tipo: "texto[]"}},
		OrdemPadrao: "p.criado_em", Desempate: "p.codigo"},
	// as colunas que a tela usa (lista, busca, planilha, aviso da fila): SEM cpf, nascimento e os vínculos (Ruling 5.10-7)
	"/autenticidade/registros": {Tabela: "vessel_registros", Alias: "r",
		SQL: `select r.codigo, r.nome, r.whatsapp, r.onde_comprou, r.comprado_em, r.garantia_ate, r.registrado_em, r.bling_pedido
		  from vessel_registros r`,
		OrdemPadrao: "r.registrado_em desc", Desempate: "r.codigo"},
	// só a baixa ATIVA (a tela lia .is('desfeita_em', null))
	"/autenticidade/baixas": {Tabela: "vessel_baixas", Alias: "b",
		SQL: `select b.codigo, b.motivo, b.baixada_em from vessel_baixas b`, Onde: "b.desfeita_em is null",
		OrdemPadrao: "b.baixada_em desc", Desempate: "b.id"},
	// a fila de cartões: a tela pede as 20 mais recentes (?limite=20)
	"/autenticidade/cartao-pedidos": {Tabela: "vessel_cartao_pedidos", Alias: "q",
		SQL: `select q.id, q.pecas, q.situacao, q.pasta, q.erro, q.criado_por, q.criado_em, q.comecou_em, q.terminou_em
		  from vessel_cartao_pedidos q`,
		OrdemPadrao: "q.criado_em desc", Desempate: "q.id"},
	// COLUNAS_DO_LEMBRETE (lembretes-do-selo.js:29-30): o token_hash do link de cancelar NÃO sai
	"/autenticidade/lembretes": {Tabela: "vessel_lembretes", Alias: "m",
		SQL: `select m.id, m.peca_codigo, m.email, m.criado_em, m.enviado_7_em, m.enviado_30_em, m.cancelado_em, m.cancelado_por
		  from vessel_lembretes m`,
		OrdemPadrao: "m.criado_em desc", Desempate: "m.id"},
}

// montarLeituras registra as 6 GETs (declaração inválida = panic na montagem: a API não sobe).
func montarLeituras(r chi.Router, p *pgxpool.Pool) {
	for _, caminho := range slices.Sorted(maps.Keys(leituras)) {
		r.Get(caminho, leituras[caminho].Handler(p, autz.Producao))
	}
}
```

**(b) Testes de aceitação** (`mundo_test.go` e `leituras_test.go`, código abaixo)
- `TestMundoDoSelo`: `autz.VesselAdmin` = verdadeiro para selo e super, falso para admin, leitor, chave e desativado (o mundo mostra os dois lados); as linhas carregaram.
- `TestLeiturasDoSelo` (pela cadeia real): para cada uma das 6 rotas, selo, super e impersonado veem a linha marcada; admin, leitor e chave recebem `[]` com `X-Total-Count: 0`; desativado e sem sessão, 401; parâmetro fora da lista, 400. E: `?codigo=` filtra (e não abre nada a quem não é do selo); registros SEM o CPF, sem a chave `"cpf"` e sem o nascimento, COM o `bling_pedido`; só a baixa ativa; lembretes sem `HASH-SECRETO`; `?limite=1` traz a mais nova; lotes com `os`.
- Mutações que têm de reprovar: `r.cpf` na lista de `/autenticidade/registros`; tirar o `Onde` das baixas; `m.token_hash` nos lembretes; trocar a tabela de uma Consulta por uma sem `is_vessel_admin` (o catálogo dá outra regra: o lado negado reprova).

```go
package vessel

import (
	"context"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/autz"
	"github.com/rbv-co/social-dashboard/api/internal/testebanco/mundoteste"
)

// O mundo do selo: quem passa em is_vessel_admin() (o módulo autenticidade, ou is_superadmin da ficha) e quem não
// passa (papel admin sem o módulo, a chave autenticidade em permissions sem o módulo, um leitor, a conta
// desativada), mais o "entrar como" (o super entrou como o selo).
const (
	idSelo       = "a5a10000-0000-4000-a000-000000000001"
	idSuper      = "a5a10000-0000-4000-a000-000000000002"
	idAdmin      = "a5a10000-0000-4000-a000-000000000003"
	idLeitor     = "a5a10000-0000-4000-a000-000000000004"
	idDesativado = "a5a10000-0000-4000-a000-000000000005"
	idChave      = "a5a10000-0000-4000-a000-000000000006"

	L1 = "a5a20000-0000-4000-a000-0000000000b1" // Linear, SS0001HB.S1, canvas: P1 gravada com cartão, P2 livre, P3 gravada com dona
	L2 = "a5a20000-0000-4000-a000-0000000000b2" // Prova, TESTE-01, sem material: T1 livre (lembrete, pedido pendente), T2 baixada

	P1, P2, P3 = "VBAAAA0001", "VBAAAA0002", "VBAAAA0003"
	T1, T2     = "VBTTTT0001", "VBTTTT0002"

	PR1 = "a5a30000-0000-4000-a000-0000000000d1" // aprovado: deu a dona de P3 (conferência com data: 2026-01-10)
	PR2 = "a5a30000-0000-4000-a000-0000000000d2" // pendente, em P2
	PR3 = "a5a30000-0000-4000-a000-0000000000d3" // pendente, em T1
	Q1  = "a5a50000-0000-4000-a000-0000000000e1" // pedido de cartão pronto (P1), pasta do dia 2026-10-09
	Q2  = "a5a50000-0000-4000-a000-0000000000e2" // pedido de cartão que falhou (P2)

	cpfDaDona = "52998224725"
)

var pessoas = []mundoteste.Pessoa{
	{Chave: "selo", ID: idSelo, Email: "selo@x.com", Papel: "viewer", Modulos: []string{"autenticidade"}},
	{Chave: "super", ID: idSuper, Email: "super@x.com", Papel: "viewer", Super: true},
	{Chave: "admin", ID: idAdmin, Email: "admin@x.com", Papel: "admin", Modulos: []string{"meta", "sales"}},
	{Chave: "leitor", ID: idLeitor, Email: "leitor@x.com", Papel: "viewer", Modulos: []string{"meta"}},
	{Chave: "desativado", ID: idDesativado, Email: "fora@x.com", Papel: "viewer", Modulos: []string{"autenticidade"}, Desativado: true},
	{Chave: "chave", ID: idChave, Email: "chave@x.com", Papel: "viewer", Modulos: []string{"meta"}},
}

const linhas = `
update profiles set permissions = '{"autenticidade": ["ver", "editar"]}' where id = '` + idChave + `';
insert into vessel_lotes (id, modelo, cor, sku, quantidade, material, material_fonte, os, criado_em) values
  ('` + L1 + `', 'Linear', 'Caramelo', 'SS0001HB.S1', 3, 'canvas', 'dono', 'OS-7', '2026-01-01T10:00:00Z'),
  ('` + L2 + `', 'Prova', null, 'TESTE-01', 2, null, null, null, '2026-02-01T10:00:00Z');
insert into vessel_pecas (codigo, lote_id, numero_na_serie, gravada_em, cartao_gerado_em, criado_em) values
  ('VBAAAA0001', '` + L1 + `', 1, '2026-01-02T10:00:00Z', '2026-10-09T12:00:00Z', '2026-01-01T10:00:00Z'),
  ('VBAAAA0002', '` + L1 + `', 2, null, null, '2026-01-01T10:00:01Z'),
  ('VBAAAA0003', '` + L1 + `', 3, '2026-01-02T10:05:00Z', null, '2026-01-01T10:00:02Z'),
  ('VBTTTT0001', '` + L2 + `', 1, null, null, '2026-02-01T10:00:00Z'),
  ('VBTTTT0002', '` + L2 + `', 2, null, null, '2026-02-01T10:00:01Z');
insert into vessel_pedidos_de_registro (id, codigo, nome, cpf, whatsapp, estado, decidido_por_que, conferencia, criado_em) values
  ('` + PR1 + `', 'VBAAAA0003', 'Ana Cliente', '` + cpfDaDona + `', '11999990000', 'aprovado', 'na_mao', '{"quando": "2026-01-10"}', '2026-01-12T12:00:00Z'),
  ('` + PR2 + `', 'VBAAAA0002', 'Carla Compradora', '11144477735', '11977776666', 'pendente', null, null, '2026-02-01T12:00:00Z'),
  ('` + PR3 + `', 'VBTTTT0001', 'Duda Teste', '11144477735', '11966665555', 'pendente', null, null, '2026-02-02T12:00:00Z');
insert into vessel_registros (codigo, nome, whatsapp, onde_comprou, comprado_em, garantia_ate, registrado_em, cpf, pedido_id,
    bling_pedido, bling_contato_id, nascimento)
  values ('VBAAAA0003', 'Ana Cliente', '11999990000', 'Loja Iguatemi', '2026-01-10', '2028-01-10', '2026-01-15T15:00:00Z',
    '` + cpfDaDona + `', '` + PR1 + `', '777', '555', '1990-05-01');
insert into vessel_baixas (codigo, motivo, baixada_em) values ('VBTTTT0002', 'teste', '2026-02-03T10:00:00Z');
insert into vessel_baixas (codigo, motivo, baixada_em, desfeita_em) values ('VBTTTT0001', 'defeito', '2026-02-02T10:00:00Z', '2026-02-02T11:00:00Z');
insert into vessel_cartao_pedidos (id, pecas, situacao, pasta, erro, criado_em, terminou_em) values
  ('` + Q1 + `', '{VBAAAA0001}', 'pronto', 'Cartões com EAN/2026-10-09', null, '2026-10-09T11:00:00Z', '2026-10-09T12:00:00Z'),
  ('` + Q2 + `', '{VBAAAA0002}', 'falhou', null, 'zoho fora', '2026-10-10T11:00:00Z', '2026-10-10T11:05:00Z');
insert into vessel_lembretes (peca_codigo, email, consentimento_em, token_hash) values
  ('VBTTTT0001', 'duda@x.com', '2026-02-02T12:00:00Z', 'HASH-SECRETO');
insert into vessel_leituras (codigo, achou, ip_hash, lido_em) values
  ('VBAAAA0003', true, 'ip1', now() - interval '1 day'), ('NAOEXISTE', false, 'ip2', now() - interval '2 days');
`

// fotoDoSelo: tudo o que uma RPC do selo pode mudar. Igual antes e depois = o negado não gravou.
const fotoDoSelo = `select md5(coalesce(string_agg(t, '|' order by t), '')) from (
	select 'l' || row_to_json(x)::text t from vessel_lotes x union all
	select 'p' || row_to_json(x)::text from vessel_pecas x union all
	select 'r' || row_to_json(x)::text from vessel_registros x union all
	select 'q' || row_to_json(x)::text from vessel_pedidos_de_registro x union all
	select 'b' || row_to_json(x)::text from vessel_baixas x union all
	select 'e' || row_to_json(x)::text from vessel_edicoes x union all
	select 'g' || row_to_json(x)::text from vessel_garantias_baixadas x union all
	select 'c' || row_to_json(x)::text from vessel_cartao_pedidos x union all
	select 'm' || row_to_json(x)::text from vessel_lembretes x union all
	select 'd' || row_to_json(x)::text from disparos_pendentes x) f`

func novoMundo(t *testing.T, montar ...func(chi.Router, *pgxpool.Pool)) *mundoteste.Mundo {
	t.Helper()
	return mundoteste.Novo(t, mundoteste.Opcoes{Pessoas: pessoas, Linhas: linhas,
		Impersonadas: map[string][2]string{"impersonado": {idSelo, idSuper}}}, montar...)
}

// O mundo mostra os dois lados da regra (is_vessel_admin = autz.VesselAdmin) e as linhas carregam.
func TestMundoDoSelo(t *testing.T) {
	m := novoMundo(t)
	for id, quer := range map[string]bool{idSelo: true, idSuper: true, idAdmin: false, idLeitor: false, idChave: false, idDesativado: false} {
		e, err := autz.CarregarEscopo(context.Background(), m.P, id)
		if err != nil {
			t.Fatal(err)
		}
		if autz.VesselAdmin(e) != quer {
			t.Errorf("VesselAdmin(%s) = %t, esperava %t", id, !quer, quer)
		}
	}
	if v := m.Um(t, `select (select count(*) from vessel_pecas)::text || '|' || (select count(*) from vessel_registros)::text
		|| '|' || (select count(*) from vessel_baixas where desfeita_em is null)::text`); v != "5|1|1" {
		t.Errorf("linhas = %s", v)
	}
}
```

```go
package vessel

import (
	"strings"
	"testing"

	"github.com/rbv-co/social-dashboard/api/internal/testebanco/mundoteste"
)

// As 6 leituras pela cadeia real (auth.Exigir → autz.ComEscopo): quem é do selo vê; quem não é recebe [] e conta 0
// (papel admin, a chave só em permissions e o leitor); conta desativada e sem sessão = 401; parâmetro fora da lista = 400.
func TestLeiturasDoSelo(t *testing.T) {
	m := novoMundo(t, montarLeituras)
	marcas := map[string]string{ // rota → um pedaço que só aparece com as linhas legíveis
		"/autenticidade/lotes":          `"material_fonte":"dono"`,
		"/autenticidade/pecas":          `"VBTTTT0002"`,
		"/autenticidade/registros":      `"Ana Cliente"`,
		"/autenticidade/baixas":         `"VBTTTT0002"`,
		"/autenticidade/cartao-pedidos": `"pronto"`,
		"/autenticidade/lembretes":      `"duda@x.com"`,
	}
	if len(marcas) != len(leituras) {
		t.Fatalf("leitura sem caso aqui: %d rotas, %d casos", len(leituras), len(marcas))
	}
	for rota, marca := range marcas {
		for _, quem := range []string{"selo", "super", "impersonado"} {
			if st, b := m.Pedir(t, quem, "GET", rota, ""); st != 200 || !strings.Contains(b, marca) {
				t.Errorf("%s GET %s = %d %s", quem, rota, st, b)
			}
		}
		for _, quem := range []string{"admin", "leitor", "chave"} {
			w := m.Resposta(t, quem, "GET", rota+"?contar=1", "")
			if w.Code != 200 || strings.TrimSpace(w.Body.String()) != "[]" || w.Header().Get("X-Total-Count") != "0" {
				t.Errorf("%s GET %s = %d %s (X-Total-Count %q)", quem, rota, w.Code, w.Body, w.Header().Get("X-Total-Count"))
			}
		}
		for _, quem := range []string{"desativado", ""} {
			if st, _ := m.Pedir(t, quem, "GET", rota, ""); st != 401 {
				t.Errorf("%q GET %s = %d, esperava 401", quem, rota, st)
			}
		}
		if st, _ := m.Pedir(t, "selo", "GET", rota+"?inventado=1", ""); st != 400 {
			t.Errorf("GET %s?inventado=1 = %d, esperava 400", rota, st)
		}
	}
	m.Rodar(t, []mundoteste.Caso{
		{Nome: "peças por código", Quem: "selo", Metodo: "GET", Caminho: "/autenticidade/pecas?codigo=VBAAAA0001,VBAAAA0003", Status: 200, Tem: P3, NaoTem: P2},
		{Nome: "peças por código, quem não é do selo", Quem: "admin", Metodo: "GET", Caminho: "/autenticidade/pecas?codigo=VBAAAA0001", Status: 200, NaoTem: P1},
		{Nome: "registros sem o CPF", Quem: "selo", Metodo: "GET", Caminho: "/autenticidade/registros", Status: 200, NaoTem: cpfDaDona},
		{Nome: "registros sem a coluna cpf", Quem: "selo", Metodo: "GET", Caminho: "/autenticidade/registros", Status: 200, NaoTem: `"cpf"`},
		{Nome: "registros sem o nascimento", Quem: "selo", Metodo: "GET", Caminho: "/autenticidade/registros", Status: 200, NaoTem: "1990-05-01"},
		{Nome: "registros com o pedido do Bling (a tela mostra)", Quem: "selo", Metodo: "GET", Caminho: "/autenticidade/registros", Status: 200, Tem: `"bling_pedido":"777"`},
		{Nome: "só a baixa ativa", Quem: "selo", Metodo: "GET", Caminho: "/autenticidade/baixas", Status: 200, Tem: T2, NaoTem: T1},
		{Nome: "lembretes sem o hash do link", Quem: "selo", Metodo: "GET", Caminho: "/autenticidade/lembretes", Status: 200, NaoTem: "HASH-SECRETO"},
		{Nome: "a fila com limite, a mais nova primeiro", Quem: "selo", Metodo: "GET", Caminho: "/autenticidade/cartao-pedidos?limite=1", Status: 200, Tem: `"falhou"`, NaoTem: `"pronto"`},
		{Nome: "lotes com todas as colunas", Quem: "selo", Metodo: "GET", Caminho: "/autenticidade/lotes", Status: 200, Tem: `"os":"OS-7"`},
	})
}
```

**(c) Arquivos:** Create `api/internal/vessel/leituras.go`, `api/internal/vessel/mundo_test.go`, `api/internal/vessel/leituras_test.go`; Modify `api/internal/vessel/rd.go` (só a linha da doc do pacote).

**(d) Dependências:** Task 2.

- [ ] **Step 1:** Os testes; ver falhar (`montarLeituras` não existe). - [ ] **Step 2:** `leituras.go` e a linha da doc. - [ ] **Step 3:** `cd api && gofmt -l ./internal && go vet ./internal/vessel/ && go test -count=1 -race ./internal/vessel/` PASS (inclui os testes da RD do Plano 4); mutações reprovam. - [ ] **Step 4: Commit** `feat(api): selo Vessel — as 6 leituras do painel de Autenticidade (regra do catálogo; registros sem CPF)` (+ `Co-Authored-By`).

---

### Task 4: As 16 RPCs — portões provados contra as funções, a decisão de registro só "na mão", efeitos e corrida

**Revisor:** opus. **Depende de:** Task 2 (as funções verbatim), Task 3 (mundo, `fotoDoSelo`).

**(a) Contrato**
- `vessel.FuncoesRPC` (abaixo): as 16 funções, com nomes, tipos e DEFAULTs de `02-funções.csv` — `vessel_alertas` 2597-2654, `vessel_baixar_garantia` 2743-2795, `vessel_baixar_peca` 2796-2822, `vessel_decidir_pedido_de_registro` 4774-4943 (`p_conferencia` e `p_motivo` com DEFAULT), `vessel_definir_material_do_lote` 4944-5017, `vessel_desfazer_baixa` 5018-5039, `vessel_desmarcar_gravada` 5040-5097, `vessel_editar_lote` 5516-5582 (`p_os` com DEFAULT), `vessel_excluir_lote` 5840-5899, `vessel_excluir_peca` 5900-5942, `vessel_fila_de_registros` 5956-5983 (`p_codigo` com DEFAULT), `vessel_gerar_lote` 6012-6047 (`p_fotos text[]`; `p_os` com DEFAULT), `vessel_marcar_gravada` 6817-6847, `vessel_pedir_cartoes` 7543-7603 (`p_pecas text[]`), `vessel_sobrescrever_etiqueta` 9209-9328, `vessel_trocar_dono` 11214-11268. Todas devolvem `json` → `rpc.Valor` (o `to_json` do `json` é o mesmo texto: a tela recebe o objeto de hoje, com o espaçamento do Postgres).
- **Portão** = `autz.VesselAdmin` nas 16, igual à primeira linha de cada função (`if not public.is_vessel_admin() then return json_build_object('ok', false, 'motivo', 'sem_permissao')`; na decisão, o mesmo teste no ramo `na_mao`), provado pessoa a pessoa (`TestPortoesIguaisAsFuncoes`), inclusive o desativado (a função chama `conta_ativa()`) e o usuário sem perfil. Negado = `403 {"error":"sem_permissao"}` do núcleo, sem a função rodar (Ruling 5.10-8). Diferença conhecida e aceita: na decisão, a função valida `p_estado`/`p_quem_decidiu` ANTES do portão; para quem não é do selo, a API responde 403 onde a função responderia `estado_invalido` — nada é gravado em nenhum dos dois.
- **`SoSessaoPropria: true`** nas 14 que gravam (`grava(...)`); `vessel_alertas` e `vessel_fila_de_registros` ficam abertas ao "entrar como" (só leem; a fila mascara o CPF: `vessel_cpf_mascarado`).
- **Sem `Conferir` de alvo** (Ruling 5.10-9): o selo é global (nenhuma policy recorta por loja, conta ou dono) e cada função confere o que recebe na própria transação (`peca_nao_existe`, `antiga_nao_existe`, `sem_garantia`, `nao_tem_dono`, `lote_nao_existe`, `pedido_nao_existe`, `ja_decidido`, `confirmacao_nao_bate`). **A exceção** é `vessel_decidir_pedido_de_registro`: `Conferir: soNaMao` exige `p_quem_decidiu = "na_mao"` e `p_conferencia` ausente ou `null` (Ruling 5.10-10). A trava de `bling` da função lê `current_setting('role')` e `auth.role()` do Supabase: na compat ela nega a todos (Task 2), mas a API não depende disso; e uma conferência vinda do painel gravaria `bling_pedido`/`bling_contato_id` de outra venda no registro.
- As recusas das funções continuam `200 {"ok":false,"motivo":…}` (como pelo PostgREST); erro de forma é `400 pedido_invalido` do registro (parâmetro faltando, lista que não é lista, parâmetro desconhecido).
- **Corrida** (`TestBaixaSimultanea`): `vessel_baixar_peca` confere e depois grava; duas ao mesmo tempo dão uma baixa e, na outra, `ja_baixada` ou `409` (o índice `vessel_baixas_ativa_idx` recusa: `dados.ErroDoBanco` 23505 → 409) — o mesmo que o PostgREST dava; nunca duas baixas ativas. Sem trava a mais na API: a regra mora no índice.
- **Ensaiado** (13/10, a árvore + Tasks 1–3): os três testes passam com `-race` em 3 rodadas seguidas. Mutações conferidas: portão aceitando o papel `admin` (`TestPortoesIguaisAsFuncoes` acusa as funções); `SoSessaoPropria` fora (o impersonado baixa a garantia); sem `soNaMao` (o "bling" do painel vira `200 sem_permissao` e a conferência inventada chega à função — no teste, ela tenta ler `vessel_pedidos`, que é do 5.11, e dá 500; em produção gravaria o pedido inventado).

```go
package vessel

import (
	"context"
	"encoding/json"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/rbv-co/social-dashboard/api/internal/autz"
	"github.com/rbv-co/social-dashboard/api/internal/rpc"
)

// FuncoesRPC: as 16 funções do painel de Autenticidade em POST /rpc/{nome} (web.FuncoesRPC as junta). Portão =
// autz.VesselAdmin, a checagem da primeira linha de cada uma (is_vessel_admin(); TestPortoesIguaisAsFuncoes prova
// pessoa a pessoa). As 14 que gravam recusam "entrar como" (SoSessaoPropria); vessel_alertas e
// vessel_fila_de_registros só leem (a fila já mascara o CPF). Sem Conferir de alvo: o selo é um só para a casa e
// cada função confere a existência e o estado do que recebe na própria transação (Ruling 5.10-9) — a exceção é a
// decisão de registro (soNaMao). Parâmetros e DEFAULTs = levantamento/02-funções.csv; todas devolvem json (rpc.Valor).
var FuncoesRPC = []rpc.Funcao{
	{Nome: "vessel_alertas", Retorno: rpc.Valor, Portao: autz.VesselAdmin},
	{Nome: "vessel_fila_de_registros", Retorno: rpc.Valor, Portao: autz.VesselAdmin,
		Params: []rpc.Param{{Nome: "p_codigo", Tipo: "text", Opcional: true}}},
	grava("vessel_baixar_garantia", texto("p_codigo"), texto("p_motivo")),
	grava("vessel_baixar_peca", texto("p_codigo"), texto("p_motivo")),
	{Nome: "vessel_decidir_pedido_de_registro", Retorno: rpc.Valor, Portao: autz.VesselAdmin, SoSessaoPropria: true,
		Params: []rpc.Param{{Nome: "p_pedido", Tipo: "uuid"}, texto("p_estado"), texto("p_quem_decidiu"),
			{Nome: "p_conferencia", Tipo: "jsonb", Opcional: true}, {Nome: "p_motivo", Tipo: "text", Opcional: true}},
		Conferir: soNaMao},
	grava("vessel_definir_material_do_lote", rpc.Param{Nome: "p_lote", Tipo: "uuid"}, texto("p_material")),
	grava("vessel_desfazer_baixa", texto("p_codigo")),
	grava("vessel_desmarcar_gravada", texto("p_codigo"), texto("p_motivo")),
	grava("vessel_editar_lote", rpc.Param{Nome: "p_lote", Tipo: "uuid"}, texto("p_modelo"), texto("p_cor"), texto("p_sku"),
		rpc.Param{Nome: "p_fabricado_em", Tipo: "date"}, rpc.Param{Nome: "p_quantidade", Tipo: "integer"},
		rpc.Param{Nome: "p_os", Tipo: "text", Opcional: true}),
	grava("vessel_excluir_lote", rpc.Param{Nome: "p_lote", Tipo: "uuid"}),
	grava("vessel_excluir_peca", texto("p_codigo")),
	grava("vessel_gerar_lote", texto("p_modelo"), texto("p_cor"), texto("p_sku"), rpc.Param{Nome: "p_quantidade", Tipo: "integer"},
		rpc.Param{Nome: "p_fabricado_em", Tipo: "date"}, rpc.Param{Nome: "p_fotos", Tipo: "text[]"},
		rpc.Param{Nome: "p_os", Tipo: "text", Opcional: true}),
	grava("vessel_marcar_gravada", texto("p_codigo")),
	grava("vessel_pedir_cartoes", rpc.Param{Nome: "p_pecas", Tipo: "text[]"}),
	grava("vessel_sobrescrever_etiqueta", texto("p_codigo_antigo"), texto("p_codigo_novo"), texto("p_destino"), texto("p_motivo")),
	grava("vessel_trocar_dono", texto("p_codigo"), texto("p_nome"), texto("p_cpf"), texto("p_whatsapp"), texto("p_motivo"),
		texto("p_confirmacao")),
}

func texto(nome string) rpc.Param { return rpc.Param{Nome: nome, Tipo: "text"} }

// grava: função do selo que muda o mundo — portão do selo e "entrar como" recusado.
func grava(nome string, params ...rpc.Param) rpc.Funcao {
	return rpc.Funcao{Nome: nome, Params: params, Retorno: rpc.Valor, Portao: autz.VesselAdmin, SoSessaoPropria: true}
}

// soNaMao: o painel decide pedido de registro só "na mão" e sem conferência anexada (a tela manda 'na_mao' e
// p_conferencia null: tela-de-autenticidade.vue:3718-3729). 'bling' é a aprovação automática da edge
// vessel-registrar-garantia (Plano 6), e a conferência é a prova do Bling que só ela tem; vinda do painel, seria a
// tela dando a si mesma o selo de conferido, e o bling_pedido/bling_contato_id inventados iriam para o registro da
// dona (a trava "pedido_ja_usado" e o espelho do Bling os usam). 403 sem a função rodar (Ruling 5.10-10).
func soNaMao(_ context.Context, _ pgx.Tx, _ *autz.Escopo, args map[string]json.RawMessage) error {
	var quem string
	if json.Unmarshal(args["p_quem_decidiu"], &quem) != nil || quem != "na_mao" {
		return autz.ErrNegado
	}
	if c, tem := args["p_conferencia"]; tem && strings.TrimSpace(string(c)) != "null" {
		return autz.ErrNegado
	}
	return nil
}
```

**(b) Testes de aceitação** (`rpc_test.go`, código abaixo)
- `TestPortoesIguaisAsFuncoes`: cada uma das 16 funções, chamada com argumentos válidos como cada pessoa do mundo e como um usuário sem perfil, numa transação desfeita: negada = `motivo = 'sem_permissao'`; `autz.VesselAdmin` dá o MESMO, com pelo menos 2 permitidas e 5 negadas por função.
- `TestRPCsDoSelo` (pela cadeia real; as recusas "intactas" pela `fotoDoSelo`): admin, chave e leitor → 403; desativado → 401; impersonado baixando garantia ou decidindo registro → 403 com a frase; `bling` e conferência inventada → 403; parâmetro faltando, fotos que não são lista, peças que não são texto, parâmetro desconhecido → 400; e as recusas das funções com 200 (`motivo_invalido`, `peca_nao_existe`, `motivo_obrigatorio` ×3, `confirmacao_nao_bate`, `cpf_invalido`, `esta_gravada`, `tem_gravada`, `abaixo_do_gravado`, `material_invalido`). Permitidos, com o efeito no banco: alertas para o impersonado; a fila com o CPF mascarado e por peça; marcar gravada; baixar, `ja_baixada` e desfazer (autoria da sessão); sobrescrever para a baixa (antiga sem gravação, nova gravada, baixa com o motivo, trilha); desmarcar com motivo; **gerar lote: a série continua no produto (4 e 5) e o material é herdado**; lote de teste; **editar para 5: nenhum número repetido no SKU** (o que `serie-continua-no-produto.test.mjs` e `cartao-trava-a-serie.test.mjs` guardavam); material `Couro` recalcula a garantia da dona (`2026-07-10`); pedir cartões juntando repetidos; aprovar na mão (garantia do material, sem pedido do Bling, `decidido_quem` da sessão), `ja_decidido`; aprovar em lote sem material (garantia nula, o lembrete morre); trocar a dona (o elo com o Bling sai, a garantia fica, a trilha leva o CPF mascarado); baixar a garantia (guardada em `vessel_garantias_baixadas` antes de apagar); a trilha da peça; excluir a peça livre e o lote livre (trilha antes do delete).
- `TestBaixaSimultanea`: duas baixas da mesma peça ao mesmo tempo → uma ganha, a outra `ja_baixada` ou 409, uma baixa ativa.
- Mutações que têm de reprovar: as três do ensaio; `vessel_alertas` com `SoSessaoPropria` (a leitura do impersonado reprova); `p_fotos` declarado `text` (o corpo `null` da tela continua passando, mas `"a.jpg"` deixa de dar 400).

```go
package vessel

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"sync"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/autz"
	"github.com/rbv-co/social-dashboard/api/internal/banco"
	"github.com/rbv-co/social-dashboard/api/internal/rpc"
	"github.com/rbv-co/social-dashboard/api/internal/testebanco/mundoteste"
)

// montarRPCs monta a lista como web.Rotas, no grupo de domínio.
func montarRPCs(r chi.Router, p *pgxpool.Pool) {
	reg, err := rpc.Novo(p, FuncoesRPC...)
	if err != nil {
		panic(err)
	}
	r.Post("/rpc/{nome}", reg.ServeHTTP)
}

var errDesfazer = errors.New("desfazer")

// intacto roda casos que NÃO podem mudar o selo: a foto das tabelas é a mesma antes e depois.
func intacto(t *testing.T, m *mundoteste.Mundo, casos []mundoteste.Caso) {
	t.Helper()
	antes := m.Um(t, fotoDoSelo)
	m.Rodar(t, casos)
	if m.Um(t, fotoDoSelo) != antes {
		t.Fatal("um caso que devia ser recusado mudou o selo")
	}
}

// O portão do Go = a primeira linha de cada função de produção, pessoa por pessoa: cada função roda como cada pessoa
// (e como um usuário sem perfil) numa transação desfeita; negada = {"ok":false,"motivo":"sem_permissao"}. As
// funções são SECURITY DEFINER e is_vessel_admin() chama conta_ativa(): o desativado é negado nelas e no Go.
func TestPortoesIguaisAsFuncoes(t *testing.T) {
	m := novoMundo(t)
	ctx := context.Background()
	const semPerfil = "a5a10000-0000-4000-a000-000000000099"
	if _, err := m.P.Exec(ctx, `insert into usuarios (id, email) values ($1::uuid, 'semperfil@x.com')`, semPerfil); err != nil {
		t.Fatal(err)
	}
	ids := map[string]string{"semPerfil": semPerfil}
	for _, p := range pessoas {
		ids[p.Chave] = p.ID
	}
	// argumentos válidos: quem passa no portão não esbarra noutra recusa antes dele
	chamadas := map[string]string{
		"vessel_alertas":                    `vessel_alertas()`,
		"vessel_fila_de_registros":          `vessel_fila_de_registros(null)`,
		"vessel_baixar_garantia":            `vessel_baixar_garantia('VBAAAA0003', 'pedido da cliente')`,
		"vessel_baixar_peca":                `vessel_baixar_peca('VBAAAA0002', 'extraviada')`,
		"vessel_decidir_pedido_de_registro": `vessel_decidir_pedido_de_registro('` + PR2 + `'::uuid, 'aprovado', 'na_mao', null, null)`,
		"vessel_definir_material_do_lote":   `vessel_definir_material_do_lote('` + L1 + `'::uuid, 'couro')`,
		"vessel_desfazer_baixa":             `vessel_desfazer_baixa('VBTTTT0002')`,
		"vessel_desmarcar_gravada":          `vessel_desmarcar_gravada('VBAAAA0001', null)`,
		"vessel_editar_lote":                `vessel_editar_lote('` + L1 + `'::uuid, 'Linear', 'Caramelo', 'SS0001HB.S1', null, 4, null)`,
		"vessel_excluir_lote":               `vessel_excluir_lote('` + L2 + `'::uuid)`,
		"vessel_excluir_peca":               `vessel_excluir_peca('VBAAAA0002')`,
		"vessel_gerar_lote":                 `vessel_gerar_lote('Linear', 'Caramelo', 'SS0001HB.S1', 2, null, null, null)`,
		"vessel_marcar_gravada":             `vessel_marcar_gravada('VBAAAA0002')`,
		"vessel_pedir_cartoes":              `vessel_pedir_cartoes(array['VBAAAA0002'])`,
		"vessel_sobrescrever_etiqueta":      `vessel_sobrescrever_etiqueta('VBAAAA0001', 'VBAAAA0002', 'fila', 'etiqueta rasgou')`,
		"vessel_trocar_dono":                `vessel_trocar_dono('VBAAAA0003', 'Bia', '11144477735', '11988887777', 'venda', 'VBAAAA0003')`,
	}
	if len(chamadas) != len(FuncoesRPC) {
		t.Fatalf("%d chamadas para %d funções", len(chamadas), len(FuncoesRPC))
	}
	for _, f := range FuncoesRPC {
		chamada, ok := chamadas[f.Nome]
		if !ok {
			t.Errorf("função sem chamada no teste: %s", f.Nome)
			continue
		}
		var permitidas, negadas int
		for quem, id := range ids {
			e, err := autz.CarregarEscopo(ctx, m.P, id)
			if err != nil {
				t.Fatal(err)
			}
			var motivo *string
			err = banco.ComUsuario(ctx, m.P, id, func(tx pgx.Tx) error {
				if err := tx.QueryRow(ctx, `select (`+chamada+`)->>'motivo'`).Scan(&motivo); err != nil {
					return err
				}
				return errDesfazer
			})
			if !errors.Is(err, errDesfazer) {
				t.Fatalf("%s como %s: %v", f.Nome, quem, err)
			}
			naFuncao := motivo == nil || *motivo != "sem_permissao"
			if naFuncao {
				permitidas++
			} else {
				negadas++
			}
			if no := f.Portao(e); no != naFuncao {
				t.Errorf("%s como %s: o portão do Go = %t, a função %t", f.Nome, quem, no, naFuncao)
			}
		}
		if permitidas < 2 || negadas < 5 {
			t.Errorf("%s: o mundo tem de mostrar os dois lados: %d permitidas, %d negadas", f.Nome, permitidas, negadas)
		}
	}
}

func TestRPCsDoSelo(t *testing.T) {
	m := novoMundo(t, montarRPCs)
	rpcDe := func(nome string) string { return "/rpc/" + nome }
	// recusas: do portão (403), do "entrar como" (403 com a frase), da conferência do registro (403), da forma (400)
	// e das próprias funções (200 com ok:false) — nenhuma muda o selo
	intacto(t, m, []mundoteste.Caso{
		{Nome: "admin sem o módulo lê alertas", Quem: "admin", Metodo: "POST", Caminho: rpcDe("vessel_alertas"), Status: 403, Tem: "sem_permissao"},
		{Nome: "a chave só em permissions", Quem: "chave", Metodo: "POST", Caminho: rpcDe("vessel_fila_de_registros"), Corpo: `{}`, Status: 403},
		{Nome: "leitor baixa peça", Quem: "leitor", Metodo: "POST", Caminho: rpcDe("vessel_baixar_peca"), Corpo: `{"p_codigo":"VBAAAA0002","p_motivo":"extraviada"}`, Status: 403},
		{Nome: "admin troca a dona", Quem: "admin", Metodo: "POST", Caminho: rpcDe("vessel_trocar_dono"),
			Corpo: `{"p_codigo":"VBAAAA0003","p_nome":"Bia","p_cpf":"11144477735","p_whatsapp":"11988887777","p_motivo":"venda","p_confirmacao":"VBAAAA0003"}`, Status: 403},
		{Nome: "desativado", Quem: "desativado", Metodo: "POST", Caminho: rpcDe("vessel_alertas"), Status: 401},
		{Nome: "impersonado baixa a garantia", Quem: "impersonado", Metodo: "POST", Caminho: rpcDe("vessel_baixar_garantia"),
			Corpo: `{"p_codigo":"VBAAAA0003","p_motivo":"pedido da cliente"}`, Status: 403, Tem: "Quem entrou como outra pessoa"},
		{Nome: "impersonado decide registro", Quem: "impersonado", Metodo: "POST", Caminho: rpcDe("vessel_decidir_pedido_de_registro"),
			Corpo: `{"p_pedido":"` + PR2 + `","p_estado":"aprovado","p_quem_decidiu":"na_mao"}`, Status: 403, Tem: "Quem entrou como outra pessoa"},
		{Nome: "o painel dizendo 'bling'", Quem: "selo", Metodo: "POST", Caminho: rpcDe("vessel_decidir_pedido_de_registro"),
			Corpo: `{"p_pedido":"` + PR2 + `","p_estado":"aprovado","p_quem_decidiu":"bling","p_conferencia":{"pedido":"9","quando":"2026-02-01"}}`, Status: 403},
		{Nome: "na mão com uma conferência inventada", Quem: "super", Metodo: "POST", Caminho: rpcDe("vessel_decidir_pedido_de_registro"),
			Corpo: `{"p_pedido":"` + PR2 + `","p_estado":"aprovado","p_quem_decidiu":"na_mao","p_conferencia":{"pedido":"9","contato":"8"}}`, Status: 403},
		{Nome: "falta a confirmação", Quem: "selo", Metodo: "POST", Caminho: rpcDe("vessel_trocar_dono"),
			Corpo: `{"p_codigo":"VBAAAA0003","p_nome":"Bia","p_cpf":"11144477735","p_whatsapp":"11988887777","p_motivo":"venda"}`, Status: 400, Tem: "falta o parâmetro p_confirmacao"},
		{Nome: "fotos que não são lista", Quem: "selo", Metodo: "POST", Caminho: rpcDe("vessel_gerar_lote"),
			Corpo: `{"p_modelo":"X","p_cor":null,"p_sku":null,"p_quantidade":1,"p_fabricado_em":null,"p_fotos":"a.jpg"}`, Status: 400, Tem: "deve ser uma lista"},
		{Nome: "peças que não são texto", Quem: "selo", Metodo: "POST", Caminho: rpcDe("vessel_pedir_cartoes"), Corpo: `{"p_pecas":[1]}`, Status: 400, Tem: "lista de textos"},
		{Nome: "parâmetro desconhecido", Quem: "selo", Metodo: "POST", Caminho: rpcDe("vessel_marcar_gravada"), Corpo: `{"p_codigo":"VBAAAA0002","p_quem":"x"}`, Status: 400, Tem: "parâmetro desconhecido"},
		// as recusas das próprias funções chegam como chegavam pelo PostgREST: 200 com ok:false e o motivo
		{Nome: "motivo de baixa fora da lista", Quem: "selo", Metodo: "POST", Caminho: rpcDe("vessel_baixar_peca"), Corpo: `{"p_codigo":"VBAAAA0002","p_motivo":"roubada"}`, Status: 200, Tem: "motivo_invalido"},
		{Nome: "peça que não existe", Quem: "selo", Metodo: "POST", Caminho: rpcDe("vessel_marcar_gravada"), Corpo: `{"p_codigo":"XX"}`, Status: 200, Tem: "peca_nao_existe"},
		{Nome: "desmarcar peça com dona sem motivo", Quem: "selo", Metodo: "POST", Caminho: rpcDe("vessel_desmarcar_gravada"), Corpo: `{"p_codigo":"VBAAAA0003","p_motivo":null}`, Status: 200, Tem: "motivo_obrigatorio"},
		{Nome: "confirmação que não bate", Quem: "selo", Metodo: "POST", Caminho: rpcDe("vessel_trocar_dono"),
			Corpo: `{"p_codigo":"VBAAAA0003","p_nome":"Bia","p_cpf":"11144477735","p_whatsapp":"11988887777","p_motivo":"venda","p_confirmacao":"VBAAAA0001"}`, Status: 200, Tem: "confirmacao_nao_bate"},
		{Nome: "CPF inválido", Quem: "selo", Metodo: "POST", Caminho: rpcDe("vessel_trocar_dono"),
			Corpo: `{"p_codigo":"VBAAAA0003","p_nome":"Bia","p_cpf":"11111111111","p_whatsapp":"11988887777","p_motivo":"venda","p_confirmacao":"VBAAAA0003"}`, Status: 200, Tem: "cpf_invalido"},
		{Nome: "excluir peça gravada", Quem: "selo", Metodo: "POST", Caminho: rpcDe("vessel_excluir_peca"), Corpo: `{"p_codigo":"VBAAAA0001"}`, Status: 200, Tem: "esta_gravada"},
		{Nome: "excluir lote com peça gravada", Quem: "selo", Metodo: "POST", Caminho: rpcDe("vessel_excluir_lote"), Corpo: `{"p_lote":"` + L1 + `"}`, Status: 200, Tem: "tem_gravada"},
		{Nome: "lote abaixo das presas", Quem: "selo", Metodo: "POST", Caminho: rpcDe("vessel_editar_lote"),
			Corpo: `{"p_lote":"` + L1 + `","p_modelo":"Linear","p_cor":"Caramelo","p_sku":"SS0001HB.S1","p_fabricado_em":null,"p_quantidade":1}`, Status: 200, Tem: "abaixo_do_gravado"},
		{Nome: "material fora da lista", Quem: "selo", Metodo: "POST", Caminho: rpcDe("vessel_definir_material_do_lote"), Corpo: `{"p_lote":"` + L1 + `","p_material":"seda"}`, Status: 200, Tem: "material_invalido"},
		{Nome: "baixar garantia sem motivo", Quem: "selo", Metodo: "POST", Caminho: rpcDe("vessel_baixar_garantia"), Corpo: `{"p_codigo":"VBAAAA0003","p_motivo":" "}`, Status: 200, Tem: "motivo_obrigatorio"},
		{Nome: "cartão de peça que não existe", Quem: "selo", Metodo: "POST", Caminho: rpcDe("vessel_pedir_cartoes"), Corpo: `{"p_pecas":["XX"]}`, Status: 200, Tem: "peca_nao_existe"},
		{Nome: "recusar sem motivo", Quem: "selo", Metodo: "POST", Caminho: rpcDe("vessel_decidir_pedido_de_registro"),
			Corpo: `{"p_pedido":"` + PR2 + `","p_estado":"recusado","p_quem_decidiu":"na_mao","p_conferencia":null,"p_motivo":null}`, Status: 200, Tem: "motivo_obrigatorio"},
	})

	const trilha = `select coalesce(string_agg(acao || ':' || (feito_por = '` + idSelo + `')::text, ',' order by feito_em, acao), '') from vessel_edicoes where codigo = '`
	m.Rodar(t, []mundoteste.Caso{
		{Nome: "alertas para o impersonado (só lê)", Quem: "impersonado", Metodo: "POST", Caminho: rpcDe("vessel_alertas"), Status: 200, Tem: `"total_leituras" : 2`},
		{Nome: "a fila com o CPF mascarado", Quem: "selo", Metodo: "POST", Caminho: rpcDe("vessel_fila_de_registros"), Corpo: `{}`, Status: 200, Tem: `***.982.247-**`, NaoTem: cpfDaDona},
		{Nome: "a fila de uma peça", Quem: "selo", Metodo: "POST", Caminho: rpcDe("vessel_fila_de_registros"), Corpo: `{"p_codigo":"vbtttt0001"}`, Status: 200, Tem: "Duda Teste", NaoTem: "Carla"},
		{Nome: "marcar gravada", Quem: "selo", Metodo: "POST", Caminho: rpcDe("vessel_marcar_gravada"), Corpo: `{"p_codigo":"vbaaaa0002"}`, Status: 200, Tem: `"ja_estava" : false`,
			Efeito: `select (gravada_em is not null)::text from vessel_pecas where codigo = 'VBAAAA0002'`, Quer: "true"},
		{Nome: "baixar peça", Quem: "selo", Metodo: "POST", Caminho: rpcDe("vessel_baixar_peca"), Corpo: `{"p_codigo":"VBAAAA0002","p_motivo":"extraviada"}`, Status: 200, Tem: `"ok" : true`,
			Efeito: `select motivo || '|' || (baixada_por = '` + idSelo + `')::text from vessel_baixas where codigo = 'VBAAAA0002' and desfeita_em is null`, Quer: "extraviada|true"},
		{Nome: "baixar de novo", Quem: "selo", Metodo: "POST", Caminho: rpcDe("vessel_baixar_peca"), Corpo: `{"p_codigo":"VBAAAA0002","p_motivo":"defeito"}`, Status: 200, Tem: "ja_baixada"},
		{Nome: "desfazer a baixa", Quem: "selo", Metodo: "POST", Caminho: rpcDe("vessel_desfazer_baixa"), Corpo: `{"p_codigo":"VBAAAA0002"}`, Status: 200, Tem: `"ok" : true`,
			Efeito: `select count(*)::text from vessel_baixas where codigo = 'VBAAAA0002' and desfeita_em is null`, Quer: "0"},
		{Nome: "sobrescrever para a baixa", Quem: "selo", Metodo: "POST", Caminho: rpcDe("vessel_sobrescrever_etiqueta"),
			Corpo: `{"p_codigo_antigo":"VBAAAA0001","p_codigo_novo":"VBTTTT0001","p_destino":"baixa","p_motivo":"defeito"}`, Status: 200, Tem: `"destino" : "baixa"`,
			Efeito: `select (select (gravada_em is null)::text from vessel_pecas where codigo = 'VBAAAA0001') || '|' || (select (gravada_em is not null)::text from vessel_pecas where codigo = 'VBTTTT0001')
				|| '|' || (select motivo from vessel_baixas where codigo = 'VBAAAA0001' and desfeita_em is null)`, Quer: "true|true|defeito"},
		{Nome: "a trilha da sobrescrita", Efeito: trilha + `VBAAAA0001'`, Quer: "sobrescrever_para_baixa:true"},
		{Nome: "desmarcar a peça com dona, com motivo", Quem: "selo", Metodo: "POST", Caminho: rpcDe("vessel_desmarcar_gravada"),
			Corpo: `{"p_codigo":"VBAAAA0003","p_motivo":"etiqueta trocada"}`, Status: 200, Tem: `"tinha_garantia" : true`,
			Efeito: trilha + `VBAAAA0003'`, Quer: "desmarcar_gravada:true"},
		{Nome: "gerar lote: a série continua no produto e o material é herdado", Quem: "selo", Metodo: "POST", Caminho: rpcDe("vessel_gerar_lote"),
			Corpo: `{"p_modelo":"Linear","p_cor":"Caramelo","p_sku":"SS0001HB.S1","p_quantidade":2,"p_fabricado_em":null,"p_fotos":null,"p_os":""}`, Status: 200, Tem: `"primeiro_numero" : 4`,
			Efeito: `select l.material || '|' || l.material_fonte || '|' || (l.criado_por = '` + idSelo + `')::text || '|' || coalesce(l.os, 'nulo') || '|' || string_agg(p.numero_na_serie::text, ',' order by p.numero_na_serie)
				from vessel_lotes l join vessel_pecas p on p.lote_id = l.id where l.id <> '` + L1 + `' and l.sku = 'SS0001HB.S1' group by l.id`, Quer: "canvas|herdado|true|nulo|4,5"},
		{Nome: "gerar lote de teste", Quem: "selo", Metodo: "POST", Caminho: rpcDe("vessel_gerar_lote"),
			Corpo: `{"p_modelo":"Prova","p_cor":null,"p_sku":"TESTE-02","p_quantidade":1,"p_fabricado_em":"2026-10-01","p_fotos":null}`, Status: 200,
			Efeito: `select teste::text || '|' || fabricado_em::text from vessel_lotes where sku = 'TESTE-02'`, Quer: "true|2026-10-01"},
		{Nome: "editar o lote para 5: a série do produto continua sem número repetido", Quem: "selo", Metodo: "POST", Caminho: rpcDe("vessel_editar_lote"),
			Corpo: `{"p_lote":"` + L1 + `","p_modelo":"Linear","p_cor":"Caramelo","p_sku":"SS0001HB.S1","p_fabricado_em":null,"p_quantidade":5,"p_os":"OS-8"}`, Status: 200, Tem: `"quantidade" : 5`,
			Efeito: `select (count(*) = count(distinct p.numero_na_serie))::text || '|' || count(*)::text from vessel_pecas p join vessel_lotes l on l.id = p.lote_id where l.sku = 'SS0001HB.S1'`, Quer: "true|7"},
		{Nome: "o material do lote recalcula a garantia da dona", Quem: "selo", Metodo: "POST", Caminho: rpcDe("vessel_definir_material_do_lote"),
			Corpo: `{"p_lote":"` + L1 + `","p_material":"Couro"}`, Status: 200, Tem: `"registros_recalculados" : 1`,
			Efeito: `select garantia_ate::text from vessel_registros where codigo = 'VBAAAA0003'`, Quer: "2026-07-10"},
		{Nome: "pedir cartões (repetido e em minúscula vira um)", Quem: "selo", Metodo: "POST", Caminho: rpcDe("vessel_pedir_cartoes"),
			Corpo: `{"p_pecas":["vbaaaa0002","VBAAAA0002"," "]}`, Status: 200, Tem: `"pecas" : 1`,
			Efeito: `select pecas::text || '|' || situacao || '|' || (criado_por = '` + idSelo + `')::text from vessel_cartao_pedidos where situacao = 'na_fila'`, Quer: "{VBAAAA0002}|na_fila|true"},
		{Nome: "aprovar na mão: a dona nova com a garantia do material", Quem: "selo", Metodo: "POST", Caminho: rpcDe("vessel_decidir_pedido_de_registro"),
			Corpo: `{"p_pedido":"` + PR2 + `","p_estado":"aprovado","p_quem_decidiu":"na_mao","p_conferencia":null,"p_motivo":null}`, Status: 200, Tem: `"garantia_ate" : "2026-08-01"`,
			Efeito: `select r.nome || '|' || coalesce(r.bling_pedido, 'nulo') || '|' || p.estado || '|' || (p.decidido_quem = '` + idSelo + `')::text
				from vessel_registros r join vessel_pedidos_de_registro p on p.id = r.pedido_id where r.codigo = 'VBAAAA0002'`, Quer: "Carla Compradora|nulo|aprovado|true"},
		{Nome: "decidir de novo", Quem: "selo", Metodo: "POST", Caminho: rpcDe("vessel_decidir_pedido_de_registro"),
			Corpo: `{"p_pedido":"` + PR2 + `","p_estado":"recusado","p_quem_decidiu":"na_mao","p_motivo":"x"}`, Status: 200, Tem: "ja_decidido"},
		{Nome: "aprovar em lote sem material: garantia nula (nunca chutar) e o lembrete morre", Quem: "super", Metodo: "POST", Caminho: rpcDe("vessel_decidir_pedido_de_registro"),
			Corpo: `{"p_pedido":"` + PR3 + `","p_estado":"aprovado","p_quem_decidiu":"na_mao"}`, Status: 200, Tem: `"garantia_ate" : null`,
			Efeito: `select cancelado_por from vessel_lembretes where peca_codigo = 'VBTTTT0001'`, Quer: "registro"},
		{Nome: "trocar a dona: o elo com o Bling sai e a trilha leva o CPF mascarado", Quem: "selo", Metodo: "POST", Caminho: rpcDe("vessel_trocar_dono"),
			Corpo: `{"p_codigo":"VBAAAA0003","p_nome":"Bia","p_cpf":"111.444.777-35","p_whatsapp":"(11) 98888-7777","p_motivo":"venda","p_confirmacao":"vbaaaa-0003"}`, Status: 200, Tem: `"para" : "Bia"`,
			Efeito: `select r.nome || '|' || r.cpf || '|' || coalesce(r.bling_pedido, 'nulo') || '|' || coalesce(r.pedido_id::text, 'nulo') || '|' || r.garantia_ate::text || '|'
				|| (select e.detalhes -> 'para' ->> 'cpf' from vessel_edicoes e where e.codigo = r.codigo and e.acao = 'dono_trocado')
				from vessel_registros r where r.codigo = 'VBAAAA0003'`, Quer: "Bia|11144477735|nulo|nulo|2026-07-10|***.444.777-**"},
		{Nome: "baixar a garantia: guarda antes de apagar", Quem: "selo", Metodo: "POST", Caminho: rpcDe("vessel_baixar_garantia"),
			Corpo: `{"p_codigo":"VBAAAA0003","p_motivo":"pedido da cliente"}`, Status: 200, Tem: `"ok" : true`,
			Efeito: `select (select count(*) from vessel_registros where codigo = 'VBAAAA0003')::text || '|' || g.nome || '|' || g.motivo || '|' || (g.baixada_por = '` + idSelo + `')::text
				from vessel_garantias_baixadas g where g.codigo = 'VBAAAA0003'`, Quer: "0|Bia|pedido da cliente|true"},
		{Nome: "a trilha da peça da dona", Efeito: `select string_agg(acao, ',' order by feito_em, acao) from vessel_edicoes where codigo = 'VBAAAA0003'`,
			Quer: "desmarcar_gravada,material_do_lote,dono_trocado,baixar_garantia"},
	})
	// excluir: a peça livre de maior número do lote e o lote gerado (2 peças livres)
	livre := m.Um(t, `select codigo from vessel_pecas where lote_id = '`+L1+`' and gravada_em is null and codigo not in (select codigo from vessel_registros)
		and codigo not in (select unnest(pecas) from vessel_cartao_pedidos) order by numero_na_serie desc limit 1`)
	gerado := m.Um(t, `select id::text from vessel_lotes where sku = 'SS0001HB.S1' and id <> '`+L1+`'`)
	m.Rodar(t, []mundoteste.Caso{
		{Nome: "excluir a peça livre", Quem: "selo", Metodo: "POST", Caminho: rpcDe("vessel_excluir_peca"), Corpo: `{"p_codigo":"` + livre + `"}`, Status: 200, Tem: `"ok" : true`,
			Efeito: trilha + livre + `'`, Quer: "peca_excluida:true"},
		{Nome: "excluir o lote livre", Quem: "selo", Metodo: "POST", Caminho: rpcDe("vessel_excluir_lote"), Corpo: `{"p_lote":"` + gerado + `"}`, Status: 200, Tem: `"excluidas" : 2`,
			Efeito: `select count(*)::text from vessel_edicoes where acao = 'lote_excluido' and detalhes ->> 'lote' = '` + gerado + `'`, Quer: "2"},
	})
}

// Duas baixas da mesma peça ao mesmo tempo: uma ganha; a outra recebe "ja_baixada" (a função conferiu depois) ou 409
// (as duas conferiram antes e o índice de uma baixa ativa por peça recusou a segunda) — o mesmo que o PostgREST dava.
// Nunca duas baixas ativas.
func TestBaixaSimultanea(t *testing.T) {
	m := novoMundo(t, montarRPCs)
	var wg sync.WaitGroup
	st := make([]int, 2)
	corpo := make([]string, 2)
	comeca := make(chan struct{})
	for i := range 2 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-comeca
			st[i], corpo[i] = m.Pedir(t, "selo", "POST", "/rpc/vessel_baixar_peca", `{"p_codigo":"VBAAAA0002","p_motivo":"extraviada"}`)
		}()
	}
	close(comeca)
	wg.Wait()
	ganhou := 0
	for i := range 2 {
		switch {
		case st[i] == http.StatusOK && strings.Contains(corpo[i], `"ok" : true`):
			ganhou++
		case st[i] == http.StatusOK && strings.Contains(corpo[i], "ja_baixada"), st[i] == http.StatusConflict:
		default:
			t.Errorf("resposta inesperada: %d %s", st[i], corpo[i])
		}
	}
	if ganhou != 1 {
		t.Errorf("baixas que ganharam = %d", ganhou)
	}
	if v := m.Um(t, `select count(*)::text from vessel_baixas where codigo = 'VBAAAA0002' and desfeita_em is null`); v != "1" {
		t.Errorf("baixas ativas = %s", v)
	}
}
```

**(c) Arquivos:** Create `api/internal/vessel/rpc.go`, `api/internal/vessel/rpc_test.go`.

**(d) Dependências:** Tasks 2 e 3; `rpc.Novo`, `rpc.Funcao.Conferir/SoSessaoPropria` (5.7).

- [ ] **Step 1:** Testes; ver falhar. - [ ] **Step 2:** `rpc.go` (código de (a)). - [ ] **Step 3:** `cd api && gofmt -l ./internal && go vet ./internal/vessel/ && go test -count=1 -race ./internal/vessel/` PASS; mutações reprovam. - [ ] **Step 4: Commit** `feat(api): as 16 RPCs do selo Vessel com o portão de cada função e a decisão de registro só na mão` (+ `Co-Authored-By`).

---

### Task 5: `internal/zoho` — o cliente do WorkDrive (só leitura)

**Revisor:** opus. **Depende de:** nada (pacote novo; `testebanco.Novo` para a tabela).

**(a) Contrato**
- O que a edge `vessel-baixar-cartao` fazia com o Zoho (`supabase/functions/vessel-baixar-cartao/index.ts:36-95`), em Go e sem os caches de listagem (Ruling 5.10-12): **conexão** de `acessos_conexoes` (provedor `zoho`: `client_id`, `client_secret`, `refresh_token`, `data_center`; a tabela não está no catálogo, só o servidor lê — como a chave de serviço); **token de acesso** pelo `refresh_token` em `accounts.zoho<dc>/oauth/v2/token`, guardado em memória por 50 min (o `refresh_token` do Zoho NÃO roda: nada é regravado); **um retry** quando o Zoho recusa o token (401 ou `F7003`/`invalid oauth` no corpo); **listar** pasta paginando de 50 em 50 até 5000 (listagem que falhou é erro, nunca pasta vazia); **baixar** devolvendo a resposta para quem chama transmitir.
- Defesas novas (a edge não tinha): `data_center` de lista FECHADA (`.com`, `.eu`, `.in`, `.com.au`, `.jp`, `.ca`, `.sa`, `.com.cn`, `.uk`; outro texto = `ErrDesconectado`, sem pedido nenhum: o valor vem do banco e levaria o `refresh_token` a outro host); redirecionamento só para `https` e no máximo 3 (o Go tira o `Authorization` quando o domínio muda, como o `fetch` da edge); erros sem URL, sem corpo do Zoho e sem segredo; `Conexao` com campos fechados e `String()` sem segredo.
- `ParaTeste(t, pool, base)` (base loopback, nos dois papéis), no molde do `github.ParaTeste` do 5.8.
- Interface para o Plano 6 em "Interfaces que este plano entrega". `ponytail:` o token em memória vale por processo (a API roda em uma instância; com várias, guardar o token no banco).
- **Ensaiado** (13/10): `TestConexao` e `TestClienteZoho` passam com `-race`. Mutações conferidas: sem a lista de data centers (`evil.com/x` passa); sem o retry (`F7003` vira erro); seguindo redirecionamento para `http` (vira "sem resposta" em vez do 302).

```go
// Package zoho fala com o Zoho WorkDrive pela conexão OAuth da Central guardada em acessos_conexoes (provedor
// 'zoho', gravada pela tela de Acessos), como as edges faziam com a chave de serviço. Só leitura: listar uma pasta
// e baixar um arquivo. Consumidor: vessel (POST /vessel-baixar-cartao, Plano 5.10); o Plano 6 acrescenta o que
// precisar (planilhas, upload) neste mesmo cliente. Os segredos (client_secret, refresh_token e o token de acesso)
// não saem deste pacote: nem em erro, nem em log, nem no String() da conexão.
package zoho

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ErrDesconectado: não há conexão do Zoho utilizável (sem linha, sem refresh_token ou data center fora da lista).
var ErrDesconectado = errors.New("zoho: sem conexão")

// ErroHTTP: o Zoho respondeu fora do 2xx (ou um redirecionamento que não seguimos). Sem o corpo: pode citar o token.
type ErroHTTP struct{ Status int }

func (e *ErroHTTP) Error() string { return fmt.Sprintf("zoho: status %d", e.Status) }

// dataCenters: os sufixos de domínio do Zoho (accounts.zoho<dc>, www.zohoapis<dc>). Lista FECHADA: o valor vem do
// banco, e um texto qualquer levaria o refresh_token a outro host.
var dataCenters = []string{".com", ".eu", ".in", ".com.au", ".jp", ".ca", ".sa", ".com.cn", ".uk"}

// reTokenRecusado: o Zoho invalida o token antes de 1 hora (F7003, visto em 06/10/2026) e às vezes não responde 401.
var reTokenRecusado = regexp.MustCompile(`(?i)F7003|invalid.{0,3}oauth`)

const porPagina = 50 // o máximo do WorkDrive por chamada

// Conexao: as credenciais lidas de acessos_conexoes. Campos fechados e String() sem segredo.
type Conexao struct{ clientID, clientSecret, refreshToken, sufixo string }

func (c Conexao) String() string { return "zoho.Conexao(" + c.sufixo + ")" }

// Item: um arquivo ou pasta de uma listagem.
type Item struct {
	ID, Nome string
	Pasta    bool
}

// Cliente: o token de acesso fica em memória por 50 min (o Zoho limita quantos tokens novos se pedem por janela;
// pedir um por clique estouraria isso). ponytail: um por processo; vários processos = guardar o token no banco.
type Cliente struct {
	pool        *pgxpool.Pool
	http        *http.Client
	contas, api func(sufixo string) string // bases; só ParaTeste troca
	mu          sync.Mutex
	token       string
	ate         time.Time
}

func Novo(p *pgxpool.Pool) *Cliente {
	return &Cliente{pool: p, http: &http.Client{Timeout: 50 * time.Second,
		// segue até 3 redirecionamentos, só para https (o download do WorkDrive pode mudar de host; o Go tira o
		// Authorization quando o domínio muda, como o fetch da edge); http ou o 4º = 3xx devolvido (ErroHTTP)
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= 3 || req.URL.Scheme != "https" {
				return http.ErrUseLastResponse
			}
			return nil
		}},
		contas: func(s string) string { return "https://accounts.zoho" + s },
		api:    func(s string) string { return "https://www.zohoapis" + s + "/workdrive/api/v1" }}
}

// ParaTeste: o cliente falando com um Zoho de mentira (httptest) nos dois papéis (contas e API). Base que não é
// loopback derruba o teste: nunca aponta para um host de verdade.
func ParaTeste(t testing.TB, p *pgxpool.Pool, base string) *Cliente {
	t.Helper()
	u, err := url.Parse(base)
	if err != nil || u.Scheme != "http" || (u.Hostname() != "127.0.0.1" && u.Hostname() != "::1" && u.Hostname() != "localhost") {
		t.Fatalf("zoho.ParaTeste: base %q não é loopback", base)
	}
	c := Novo(p)
	b := strings.TrimRight(base, "/")
	c.contas = func(string) string { return b }
	c.api = func(string) string { return b + "/workdrive/api/v1" }
	return c
}

// Conexao lê a conexão da Central (acessos_conexoes, provedor 'zoho'). Data center vazio = '.com', como a edge.
func (c *Cliente) Conexao(ctx context.Context) (Conexao, error) {
	var con Conexao
	var dc *string
	err := c.pool.QueryRow(ctx, `select coalesce(client_id, ''), coalesce(client_secret, ''), coalesce(refresh_token, ''), data_center
		  from acessos_conexoes where provedor = 'zoho'`).Scan(&con.clientID, &con.clientSecret, &con.refreshToken, &dc)
	if errors.Is(err, pgx.ErrNoRows) {
		return Conexao{}, ErrDesconectado
	}
	if err != nil {
		return Conexao{}, err
	}
	con.sufixo = ".com"
	if dc != nil && strings.TrimSpace(*dc) != "" {
		con.sufixo = "." + strings.TrimPrefix(strings.TrimSpace(*dc), ".")
	}
	if con.refreshToken == "" || !slices.Contains(dataCenters, con.sufixo) {
		return Conexao{}, ErrDesconectado
	}
	return con, nil
}

func (c *Cliente) tokenDe(ctx context.Context, con Conexao) (string, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.token != "" && time.Now().Before(c.ate) {
		return c.token, nil
	}
	form := url.Values{"grant_type": {"refresh_token"}, "client_id": {con.clientID}, "client_secret": {con.clientSecret},
		"refresh_token": {con.refreshToken}}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.contas(con.sufixo)+"/oauth/v2/token", strings.NewReader(form.Encode()))
	if err != nil {
		return "", errors.New("zoho: sem token")
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	resp, err := c.http.Do(req)
	if err != nil {
		return "", errors.New("zoho: sem token (sem resposta)")
	}
	defer resp.Body.Close()
	var j struct {
		AccessToken string `json:"access_token"`
	}
	if json.NewDecoder(io.LimitReader(resp.Body, 64<<10)).Decode(&j) != nil || j.AccessToken == "" {
		return "", fmt.Errorf("zoho: sem token (status %d)", resp.StatusCode)
	}
	c.token, c.ate = j.AccessToken, time.Now().Add(50*time.Minute)
	return c.token, nil
}

func (c *Cliente) esquecer(tok string) {
	c.mu.Lock()
	if c.token == tok {
		c.token = ""
	}
	c.mu.Unlock()
}

// get: GET na API do WorkDrive com o token; token recusado (401 ou F7003) = renova e tenta UMA vez de novo.
// Fora do 2xx = *ErroHTTP (o corpo, que pode citar o token, é descartado aqui).
func (c *Cliente) get(ctx context.Context, con Conexao, caminho string) (*http.Response, error) {
	for tentativa := 0; ; tentativa++ {
		tok, err := c.tokenDe(ctx, con)
		if err != nil {
			return nil, err
		}
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.api(con.sufixo)+caminho, nil)
		if err != nil {
			return nil, err
		}
		req.Header.Set("Authorization", "Zoho-oauthtoken "+tok)
		req.Header.Set("Accept", "application/vnd.api+json")
		resp, err := c.http.Do(req)
		if err != nil { // o *url.Error traz a URL: não sai daqui
			return nil, errors.New("zoho: sem resposta")
		}
		if resp.StatusCode/100 == 2 {
			return resp, nil
		}
		corpo, _ := io.ReadAll(io.LimitReader(resp.Body, 4<<10))
		resp.Body.Close()
		if tentativa == 0 && (resp.StatusCode == http.StatusUnauthorized || reTokenRecusado.Match(corpo)) {
			c.esquecer(tok)
			continue
		}
		return nil, &ErroHTTP{Status: resp.StatusCode}
	}
}

// Listar: os itens de uma pasta, paginando (50 por chamada, até 5000). Leitura que falhou é erro, nunca lista vazia.
func (c *Cliente) Listar(ctx context.Context, con Conexao, pasta string) ([]Item, error) {
	var todos []Item
	for offset := 0; offset < 5000; offset += porPagina {
		resp, err := c.get(ctx, con, "/files/"+url.PathEscape(pasta)+"/files?page%5Blimit%5D="+strconv.Itoa(porPagina)+
			"&page%5Boffset%5D="+strconv.Itoa(offset))
		if err != nil {
			return nil, err
		}
		var j struct {
			Data []struct {
				ID         string `json:"id"`
				Attributes struct {
					Name     string `json:"name"`
					IsFolder bool   `json:"is_folder"`
				} `json:"attributes"`
			} `json:"data"`
		}
		err = json.NewDecoder(io.LimitReader(resp.Body, 8<<20)).Decode(&j)
		resp.Body.Close()
		if err != nil {
			return nil, errors.New("zoho: listagem ilegível")
		}
		for _, d := range j.Data {
			todos = append(todos, Item{ID: d.ID, Nome: strings.TrimSpace(d.Attributes.Name), Pasta: d.Attributes.IsFolder})
		}
		if len(j.Data) < porPagina {
			break
		}
	}
	return todos, nil
}

// Baixar: o conteúdo do arquivo `id`; quem chama fecha o corpo. Fora do 2xx = *ErroHTTP.
func (c *Cliente) Baixar(ctx context.Context, con Conexao, id string) (*http.Response, error) {
	return c.get(ctx, con, "/download/"+url.PathEscape(id))
}
```

**(b) Testes de aceitação** (`zoho_test.go`, código abaixo)
- `TestConexao`: data center nulo/vazio → `.com`; `.eu` e `com.au` normalizados; `evil.com/x`, `.com.evil.net`, `com@evil` → `ErrDesconectado`; sem `refresh_token` e sem linha → `ErrDesconectado`; a conexão impressa (`%v`, `%s`) não mostra `SEGREDO`.
- `TestClienteZoho` (Zoho de mentira): listar 60 itens em 2 páginas (offset 50), nome aparado, pasta marcada; baixar com o MESMO token (1 pedido de token até ali, `Zoho-oauthtoken TOKEN-1`); `F7003` uma vez → renova (2 tokens) e lista; recusado duas vezes → `ErroHTTP{400}` sem `SEGREDO` no erro; 404; listagem 500; redirecionamento para `http` → `ErroHTTP{302}` (não seguido); Zoho fora do ar → erro sem URL e sem segredo.
- Mutações que têm de reprovar: as três do ensaio; o token sem cache (o "1 pedido de token" reprova); o erro levando o corpo do Zoho (`SEGREDO-NO-CORPO` aparece).

```go
package zoho

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/testebanco"
)

// a tabela de db/migrations/acessos/006_zoho.sql:2-13 (a fatia do 5.4 a declara; aqui o teste não depende dela)
const tabelaDeConexoes = `create table if not exists acessos_conexoes (provedor text primary key, client_id text, client_secret text,
  refresh_token text, org_id text, data_center text default '.com', escopos text, conectado_por uuid, conectado_em timestamptz,
  atualizado_em timestamptz not null default now())`

func comConexao(t *testing.T, dc string) *pgxpool.Pool {
	t.Helper()
	p := testebanco.Novo(t)
	if _, err := p.Exec(context.Background(), tabelaDeConexoes); err != nil {
		t.Fatal(err)
	}
	if _, err := p.Exec(context.Background(), `insert into acessos_conexoes (provedor, client_id, client_secret, refresh_token, data_center)
		values ('zoho', 'ID-1', 'SEGREDO-CLIENTE', 'SEGREDO-REFRESH', nullif($1::text, '-'))`, dc); err != nil {
		t.Fatal(err)
	}
	return p
}

func TestConexao(t *testing.T) {
	ctx := context.Background()
	for _, c := range []struct{ dc, sufixo string }{{"-", ".com"}, {"", ".com"}, {".eu", ".eu"}, {"com.au", ".com.au"}} {
		con, err := Novo(comConexao(t, c.dc)).Conexao(ctx)
		if err != nil || con.sufixo != c.sufixo {
			t.Errorf("data_center %q = %q %v", c.dc, con.sufixo, err)
		}
		if s := fmt.Sprint(con) + fmt.Sprintf("%v %s", con, con); strings.Contains(s, "SEGREDO") {
			t.Errorf("a conexão impressa mostra o segredo: %s", s)
		}
	}
	for _, dc := range []string{"evil.com/x", ".com.evil.net", "com@evil"} {
		if _, err := Novo(comConexao(t, dc)).Conexao(ctx); !errors.Is(err, ErrDesconectado) {
			t.Errorf("data_center %q = %v, esperava ErrDesconectado", dc, err)
		}
	}
	p := comConexao(t, "-")
	p.Exec(ctx, `update acessos_conexoes set refresh_token = ''`)
	if _, err := Novo(p).Conexao(ctx); !errors.Is(err, ErrDesconectado) {
		t.Errorf("sem refresh_token = %v", err)
	}
	p.Exec(ctx, `delete from acessos_conexoes`)
	if _, err := Novo(p).Conexao(ctx); !errors.Is(err, ErrDesconectado) {
		t.Errorf("sem linha = %v", err)
	}
}

// zohoFalso: o accounts.zoho (token) e o WorkDrive (listar, baixar) de mentira.
type zohoFalso struct {
	mu                 sync.Mutex
	tokens, recusas    int    // quantos tokens foram pedidos; quantas respostas F7003 ainda dar
	itens              int    // itens da pasta "raiz"
	ultimoAuth, ultimo string // o Authorization e o caminho do último pedido à API
}

func (z *zohoFalso) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	z.mu.Lock()
	defer z.mu.Unlock()
	if r.URL.Path == "/oauth/v2/token" {
		r.ParseForm()
		if r.PostForm.Get("refresh_token") != "SEGREDO-REFRESH" || r.PostForm.Get("client_secret") != "SEGREDO-CLIENTE" {
			w.WriteHeader(400)
			return
		}
		z.tokens++
		fmt.Fprintf(w, `{"access_token":"TOKEN-%d"}`, z.tokens)
		return
	}
	z.ultimoAuth, z.ultimo = r.Header.Get("Authorization"), r.URL.RequestURI()
	if z.recusas > 0 {
		z.recusas--
		w.WriteHeader(400)
		io.WriteString(w, `{"errors":[{"id":"F7003","title":"Invalid OAuth token SEGREDO-NO-CORPO"}]}`)
		return
	}
	switch {
	case strings.HasPrefix(r.URL.Path, "/workdrive/api/v1/files/raiz/files"):
		offset := 0
		fmt.Sscan(r.URL.Query().Get("page[offset]"), &offset)
		var itens []string
		for i := offset; i < z.itens && i < offset+50; i++ {
			itens = append(itens, fmt.Sprintf(`{"id":"i%d","attributes":{"name":" item %d ","is_folder":%t}}`, i, i, i%2 == 0))
		}
		fmt.Fprintf(w, `{"data":[%s]}`, strings.Join(itens, ","))
	case r.URL.Path == "/workdrive/api/v1/files/quebrada/files":
		w.WriteHeader(500)
	case r.URL.Path == "/workdrive/api/v1/download/arq1":
		io.WriteString(w, "PNG-BYTES")
	case r.URL.Path == "/workdrive/api/v1/download/pula":
		http.Redirect(w, r, "http://127.0.0.1:1/arquivo", http.StatusFound) // para http: não segue
	default:
		w.WriteHeader(404)
	}
}

func TestClienteZoho(t *testing.T) {
	ctx := context.Background()
	z := &zohoFalso{itens: 60}
	srv := httptest.NewServer(z)
	defer srv.Close()
	c := ParaTeste(t, comConexao(t, "-"), srv.URL)
	con, err := c.Conexao(ctx)
	if err != nil {
		t.Fatal(err)
	}
	// listar pagina (60 itens = 2 chamadas), apara o nome e marca a pasta
	itens, err := c.Listar(ctx, con, "raiz")
	if err != nil || len(itens) != 60 || itens[0] != (Item{ID: "i0", Nome: "item 0", Pasta: true}) || itens[59].Pasta {
		t.Fatalf("listar = %d %v %+v", len(itens), err, itens)
	}
	if !strings.Contains(z.ultimo, "page%5Boffset%5D=50") && !strings.Contains(z.ultimo, "page[offset]=50") {
		t.Errorf("a 2ª página não pediu o offset 50: %s", z.ultimo)
	}
	// baixar com o MESMO token (um pedido de token para tudo até aqui)
	resp, err := c.Baixar(ctx, con, "arq1")
	if err != nil {
		t.Fatal(err)
	}
	b, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	if string(b) != "PNG-BYTES" || z.tokens != 1 || z.ultimoAuth != "Zoho-oauthtoken TOKEN-1" {
		t.Errorf("baixar = %q, tokens %d, auth %q", b, z.tokens, z.ultimoAuth)
	}
	// F7003 (o Zoho invalidou o token antes da hora): renova e tenta UMA vez
	z.recusas = 1
	if _, err := c.Listar(ctx, con, "raiz"); err != nil || z.tokens != 2 {
		t.Errorf("F7003 = %v, tokens %d", err, z.tokens)
	}
	// recusado duas vezes: erro com o status, sem o corpo (que cita o token)
	z.recusas = 2
	_, err = c.Baixar(ctx, con, "arq1")
	var e *ErroHTTP
	if !errors.As(err, &e) || e.Status != 400 || strings.Contains(err.Error(), "SEGREDO") {
		t.Errorf("recusado duas vezes = %v", err)
	}
	// 404, listagem quebrada, redirecionamento para http e Zoho fora do ar
	if _, err := c.Baixar(ctx, con, "nao-existe"); !errors.As(err, &e) || e.Status != 404 {
		t.Errorf("404 = %v", err)
	}
	if _, err := c.Listar(ctx, con, "quebrada"); !errors.As(err, &e) || e.Status != 500 {
		t.Errorf("listagem quebrada = %v", err)
	}
	if _, err := c.Baixar(ctx, con, "pula"); !errors.As(err, &e) || e.Status != http.StatusFound {
		t.Errorf("redirecionamento para http = %v", err)
	}
	srv.Close()
	c2 := ParaTeste(t, comConexao(t, "-"), srv.URL)
	_, err = c2.Listar(ctx, con, "raiz")
	if err == nil || strings.Contains(err.Error(), "127.0.0.1") || strings.Contains(err.Error(), "SEGREDO") {
		t.Errorf("fora do ar = %v (sem URL nem segredo)", err)
	}
}
```

**(c) Arquivos:** Create `api/internal/zoho/zoho.go`, `api/internal/zoho/zoho_test.go`.

**(d) Dependências:** nenhuma.

- [ ] **Step 1:** Testes; ver falhar. - [ ] **Step 2:** `zoho.go`. - [ ] **Step 3:** `cd api && gofmt -l ./internal && go vet ./internal/zoho/ && go test -count=1 -race ./internal/zoho/` PASS; mutações reprovam. - [ ] **Step 4: Commit** `feat(api): cliente internal/zoho (WorkDrive, só leitura) — token em memória, data center de lista fechada, sem segredo em erro` (+ `Co-Authored-By`).

---

### Task 6: `POST /vessel-baixar-cartao` — a edge do cartão EAN, sem os caches de listagem

**Revisor:** sonnet. **Depende de:** Task 3 (mundo), Task 5 (`internal/zoho`).

**(a) Contrato** (= o da edge `supabase/functions/vessel-baixar-cartao/index.ts:152-235`, exceto o 401/403 de sessão)
- `POST /vessel-baixar-cartao` com `{"codigo","face","formato"}`. **Portão** `autz.VesselAdmin` (a edge perguntava `is_vessel_admin()` ao banco com o token de quem chamou): quem não é do selo = `403 {"error":"sem_permissao"}` do núcleo (a edge respondia `{"erro":"sem_permissao"}`: a tela muda a leitura, Plano 7). O "entrar como" baixa (só lê; Ruling 5.10-11). Sem sessão/desativado = 401 do `auth.Exigir`.
- Respostas da edge, iguais: `400 {"erro":"codigo_invalido"}` (código fora de `^[A-Z0-9]{4,24}$` depois de `trim`+maiúsculas; corpo ilegível ou código que não é texto também); `404 peca_nao_existe`; `409 sem_cartao` (sem `cartao_gerado_em`); `400 pedido_invalido` (face ∉ `frente|verso` ou formato ∉ `png|pdf`: o nome do arquivo é montado aqui, o pedido nunca escolhe caminho); `503 zoho_desconectado`; `404 {"erro":"arquivo_nao_achado","arquivo":<nome>}`; `502 {"erro":"zoho_recusou","status":<n>}`; `502 zoho_indisponivel`; `500 banco_indisponivel`. Sucesso: `200` com os bytes do Zoho em fluxo, `Content-Type: application/octet-stream` (a tela lê como Blob), `Content-Disposition: attachment; filename=<nome>` (por `mime.FormatMediaType`: o SKU é texto livre do lote), `Cache-Control: no-store`. O `Server-Timing` da edge (diagnóstico) não é portado.
- Fluxo: peça (`numero_na_serie`, `cartao_gerado_em`, `sku` do lote) → nome do arquivo → conexão → o id gravado pelo robô em `vessel_cartao_arquivos` (caminho comum, sem listar nada) → sem linha ou recusado: a busca na árvore do robô (`<raiz>/Vessel Brasil/Cartões com EAN/<AAAA-MM-DD>/<SKU - Nome>/<arquivo>`), olhando primeiro o dia do último pedido `pronto|falhou` da peça (`pecas @> array[codigo]`, `order by terminou_em desc`, como a edge) e depois do mais novo ao mais velho.
- **Sem os caches de listagem da edge** (`pastaDosCartoes`, `diasConhecidos`, `arquivosConhecidos`: Ruling 5.10-12): existiam porque a busca era o caminho de todo clique; com o id gravado pelo robô (desde 09/10, e preenchido para os cartões anteriores por `preencher-arquivos-dos-cartoes.mjs`), a busca é o resgate. O segundo `acharOArquivo` da edge (refazer a busca sem o cache depois de um download recusado) cai junto: sem cache, daria o mesmo id. Fica o token em memória (`internal/zoho`).
- As regras de nome do robô (`_shared/cartao-no-zoho.js`) portadas em Go no mesmo arquivo (`nomeDoArquivo`, `diasEmOrdem`, `diaDaPasta`, `diasComDicaPrimeiro`, `pastaDoSku`, `ehPastaDosCartoes`, com NFC por `golang.org/x/text/unicode/norm`), com os exemplos reais do teste da edge.
- **Prazo próprio de 60 s** (`web.PrazoCartao`, Task 8), fora do grupo de domínio (30 s): o resgate pela busca levava ~7 s e o download de um PDF a 600 dpi corre em fluxo; o `WriteTimeout` do servidor (`web.EscritaDoServidor`) já passa de 120 s.
- **Ensaiado** (13/10): `TestRegrasDoCartao` e `TestBaixarCartao` passam com `-race`. Mutações conferidas: sem o portão (admin e chave baixam); sem a expressão do código (`../VBAAAA0001` chega ao banco e vira 404).

```go
package vessel

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"mime"
	"net/http"
	"regexp"
	"slices"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/autz"
	"github.com/rbv-co/social-dashboard/api/internal/dados"
	"github.com/rbv-co/social-dashboard/api/internal/zoho"
	"golang.org/x/text/unicode/norm"
)

// raizDasFotos: "Fotos por SKU (coletor)" no WorkDrive, a mesma raiz do robô de cartões (coletor/robo-de-cartoes.mjs:34).
// ZOHO_PASTA_FOTOS nunca foi definida nos segredos das edges (levantamento/segredos-nomes.txt): vale o padrão delas.
const raizDasFotos = "6kuqn469a1e0841ee49e0bd0d18cab60c9cd5"

var (
	reCodigoDaPeca = regexp.MustCompile(`^[A-Z0-9]{4,24}$`)
	reDia          = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}$`)
)

// Cartao porta a edge vessel-baixar-cartao (supabase/functions/vessel-baixar-cartao/index.ts): entrega ao navegador o
// arquivo real de um cartão EAN que o robô já deixou no Zoho (frente ou verso, png ou pdf). Contrato = o da edge
// (corpo {codigo, face, formato}; erros {"erro": …} com os mesmos status), exceto o 401/403 de sessão, no formato
// do núcleo. Portão = is_vessel_admin() (autz.VesselAdmin), a regra de vessel_pedir_cartoes; o "entrar como" baixa
// (só lê). Caminho comum: o id que o robô gravou em vessel_cartao_arquivos; sem ele (ou recusado), a busca na árvore
// do robô, sem os caches de listagem da edge (Ruling 5.10-12). Monte DEPOIS de autz.ComEscopo.
type Cartao struct {
	Pool *pgxpool.Pool
	Zoho *zoho.Cliente
}

func erroDoCartao(w http.ResponseWriter, status int, corpo map[string]any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(corpo)
}

func (c *Cartao) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	if e := autz.EscopoDo(ctx); e == nil || !autz.VesselAdmin(e) {
		dados.Erro(w, http.StatusForbidden, "sem_permissao", "")
		return
	}
	var pedido struct {
		Codigo  any `json:"codigo"`
		Face    any `json:"face"`
		Formato any `json:"formato"`
	}
	bruto, _ := io.ReadAll(http.MaxBytesReader(w, r.Body, 4<<10))
	json.Unmarshal(bruto, &pedido) // corpo ilegível = campos vazios = codigo_invalido, como a edge
	cod, _ := pedido.Codigo.(string)
	codigo := strings.ToUpper(strings.TrimSpace(cod))
	if !reCodigoDaPeca.MatchString(codigo) {
		erroDoCartao(w, http.StatusBadRequest, map[string]any{"erro": "codigo_invalido"})
		return
	}
	var numero int
	var gerado *time.Time
	var sku *string
	err := c.Pool.QueryRow(ctx, `select p.numero_na_serie, p.cartao_gerado_em, l.sku from vessel_pecas p
		  left join vessel_lotes l on l.id = p.lote_id where p.codigo = $1::text`, codigo).Scan(&numero, &gerado, &sku)
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		erroDoCartao(w, http.StatusNotFound, map[string]any{"erro": "peca_nao_existe"})
		return
	case err != nil:
		slog.Error("vessel-baixar-cartao: leitura da peça", "erro", err.Error())
		erroDoCartao(w, http.StatusInternalServerError, map[string]any{"erro": "banco_indisponivel"})
		return
	case gerado == nil: // só o que o robô entregou: peça sem cartão não tem arquivo (a tela manda gerar primeiro)
		erroDoCartao(w, http.StatusConflict, map[string]any{"erro": "sem_cartao"})
		return
	}
	face, _ := pedido.Face.(string)
	formato, _ := pedido.Formato.(string)
	nome := nomeDoArquivo(textoOuVazio(sku), numero, face, formato)
	if nome == "" {
		erroDoCartao(w, http.StatusBadRequest, map[string]any{"erro": "pedido_invalido"})
		return
	}
	con, err := c.Zoho.Conexao(ctx)
	if errors.Is(err, zoho.ErrDesconectado) {
		erroDoCartao(w, http.StatusServiceUnavailable, map[string]any{"erro": "zoho_desconectado"})
		return
	}
	if err != nil {
		slog.Error("vessel-baixar-cartao: leitura da conexão", "erro", err.Error())
		erroDoCartao(w, http.StatusInternalServerError, map[string]any{"erro": "banco_indisponivel"})
		return
	}
	// o id que o robô gravou: baixa direto. Sem linha (erro de leitura conta como sem linha, como a edge) ou com
	// id que o Zoho recusa (arquivo trocado ou apagado): a busca na árvore.
	var gravado string
	c.Pool.QueryRow(ctx, `select zoho_id from vessel_cartao_arquivos where codigo = $1::text and nome = $2::text`, codigo, nome).Scan(&gravado)
	var resp *http.Response
	if gravado != "" {
		if r2, err := c.Zoho.Baixar(ctx, con, gravado); err == nil {
			resp = r2
		}
	}
	if resp == nil {
		// o dia do último pedido que entregou a peça: só a dica de onde olhar primeiro
		var pasta *string
		c.Pool.QueryRow(ctx, `select pasta from vessel_cartao_pedidos where pecas @> array[$1::text]
			  and situacao in ('pronto', 'falhou') and pasta is not null order by terminou_em desc limit 1`, codigo).Scan(&pasta)
		id, err := c.acharOArquivo(ctx, con, textoOuVazio(sku), nome, diaDaPasta(textoOuVazio(pasta)))
		if err != nil {
			slog.Error("vessel-baixar-cartao: busca no Zoho", "erro", err.Error())
			erroDoCartao(w, http.StatusBadGateway, map[string]any{"erro": "zoho_indisponivel"})
			return
		}
		if id == "" {
			erroDoCartao(w, http.StatusNotFound, map[string]any{"erro": "arquivo_nao_achado", "arquivo": nome})
			return
		}
		resp, err = c.Zoho.Baixar(ctx, con, id)
		var e *zoho.ErroHTTP
		if errors.As(err, &e) {
			slog.Error("vessel-baixar-cartao: download", "arquivo", nome, "status", e.Status)
			erroDoCartao(w, http.StatusBadGateway, map[string]any{"erro": "zoho_recusou", "status": e.Status})
			return
		}
		if err != nil {
			erroDoCartao(w, http.StatusBadGateway, map[string]any{"erro": "zoho_indisponivel"})
			return
		}
	}
	defer resp.Body.Close()
	// octet-stream de propósito (a tela lê como Blob); o nome vai escapado (o SKU é texto livre do lote)
	w.Header().Set("Content-Type", "application/octet-stream")
	w.Header().Set("Content-Disposition", mime.FormatMediaType("attachment", map[string]string{"filename": nome}))
	w.Header().Set("Cache-Control", "no-store")
	io.Copy(w, resp.Body)
}

// acharOArquivo: o id do arquivo no dia mais novo que o tem (o dia-dica primeiro); "" se nenhum dia tem. A árvore é a
// do robô: <raiz>/Vessel Brasil/Cartões com EAN/<AAAA-MM-DD>/<SKU - Nome>/<arquivo>.
func (c *Cartao) acharOArquivo(ctx context.Context, con zoho.Conexao, sku, nome, dica string) (string, error) {
	descer := func(pasta string, achar func(zoho.Item) bool) (string, error) {
		itens, err := c.Zoho.Listar(ctx, con, pasta)
		if err != nil {
			return "", err
		}
		for _, i := range itens {
			if achar(i) {
				return i.ID, nil
			}
		}
		return "", nil
	}
	vb, err := descer(raizDasFotos, func(i zoho.Item) bool { return i.Pasta && norm.NFC.String(i.Nome) == "Vessel Brasil" })
	if err != nil || vb == "" {
		return "", err
	}
	cartoes, err := descer(vb, func(i zoho.Item) bool { return i.Pasta && ehPastaDosCartoes(i.Nome) })
	if err != nil || cartoes == "" {
		return "", err
	}
	itens, err := c.Zoho.Listar(ctx, con, cartoes)
	if err != nil {
		return "", err
	}
	for _, dia := range diasComDicaPrimeiro(diasEmOrdem(itens), dica) {
		doDia, err := c.Zoho.Listar(ctx, con, dia.ID)
		if err != nil {
			return "", err
		}
		pasta := pastaDoSku(doDia, sku)
		if pasta == nil {
			continue
		}
		id, err := descer(pasta.ID, func(i zoho.Item) bool { return !i.Pasta && i.Nome == nome })
		if err != nil || id != "" {
			return id, err
		}
	}
	return "", nil
}

func textoOuVazio(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

// ── As regras de NOME do robô (supabase/functions/_shared/cartao-no-zoho.js, que repete coletor/lib/cartoes-da-fila.js).
// Se mudarem no robô, mudam aqui: TestRegrasDoCartao confere os exemplos reais de cartao-no-zoho.test.mjs.

// nomeDoArquivo: "<SKU>_cartao_<NN>_<frente|verso>.<png|pdf>"; "" se a face, o formato ou a peça não fazem sentido.
// Lista fechada: o pedido nunca escolhe caminho (../ não passa).
func nomeDoArquivo(sku string, numero int, face, formato string) string {
	if sku == "" || numero < 1 || !slices.Contains([]string{"frente", "verso"}, face) || !slices.Contains([]string{"png", "pdf"}, formato) {
		return ""
	}
	return fmt.Sprintf("%s_cartao_%02d_%s.%s", sku, numero, face, formato)
}

// diasEmOrdem: só as pastas de dia de verdade ("2026-10-06"), da mais nova para a mais velha ("… - BKP …" fica fora).
func diasEmOrdem(itens []zoho.Item) []zoho.Item {
	var dias []zoho.Item
	for _, i := range itens {
		if i.Pasta && reDia.MatchString(strings.TrimSpace(i.Nome)) {
			dias = append(dias, i)
		}
	}
	slices.SortStableFunc(dias, func(a, b zoho.Item) int { return strings.Compare(strings.TrimSpace(b.Nome), strings.TrimSpace(a.Nome)) })
	return dias
}

// diaDaPasta: o dia ("2026-10-06") de uma pasta de pedido do robô ("Cartões com EAN/2026-10-06"); "" se não for isso.
// Serve de dica, nunca de verdade.
func diaDaPasta(pasta string) string {
	partes := strings.Split(pasta, "/")
	if dia := strings.TrimSpace(partes[len(partes)-1]); reDia.MatchString(dia) {
		return dia
	}
	return ""
}

// diasComDicaPrimeiro: a mesma lista com o dia-dica na frente (os outros na ordem de antes); sem dica, a lista como veio.
func diasComDicaPrimeiro(dias []zoho.Item, dica string) []zoho.Item {
	if dica == "" {
		return dias
	}
	var frente, resto []zoho.Item
	for _, d := range dias {
		if strings.TrimSpace(d.Nome) == dica {
			frente = append(frente, d)
		} else {
			resto = append(resto, d)
		}
	}
	return append(frente, resto...)
}

// pastaDoSku: a subpasta "SKU - Nome do modelo" de um dia, pelo prefixo "SKU - " (NFC dos dois lados: "Média" pode
// vir com o acento solto, conforme quem criou a pasta). nil se não houver.
func pastaDoSku(itens []zoho.Item, sku string) *zoho.Item {
	prefixo := norm.NFC.String(sku + " - ")
	for i := range itens {
		if itens[i].Pasta && strings.HasPrefix(norm.NFC.String(itens[i].Nome), prefixo) {
			return &itens[i]
		}
	}
	return nil
}

// ehPastaDosCartoes: "Cartões com EAN", comparada sem depender de como o acento foi gravado.
func ehPastaDosCartoes(nome string) bool {
	return strings.TrimSpace(norm.NFC.String(nome)) == "Cartões com EAN"
}
```

**(b) Testes de aceitação** (`cartao_test.go`, código abaixo)
- `TestRegrasDoCartao`: os exemplos de `cartao-no-zoho.test.mjs` (nome, face/formato/peça inválidos, `../../x`, dias em ordem sem o BKP e sem o que não é pasta, a pasta do SKU com o acento solto e sem confundir `S1` com `S10`, a pasta dos cartões em NFD e o BKP, o dia da pasta, o dia-dica na frente).
- `TestBaixarCartao` (cadeia real, Zoho de mentira com a árvore do robô): admin e chave → 403; desativado → 401; nenhum deles chega ao Zoho; sem corpo, código que não é texto, código com barra → 400 `codigo_invalido`; peça que não existe → 404; peça sem cartão → 409; face fora da lista e com caminho → 400 `pedido_invalido` — nenhum chega ao Zoho; o id gravado (código em minúscula) baixa com 1 download e 0 listagens, para o selo e para o impersonado, com os 3 cabeçalhos; sem id gravado acha no dia da dica e no dia mais velho; id gravado recusado cai na busca; arquivo que nenhum dia tem → 404 com o nome; download recusado → 502 com o status; Zoho fora na busca → 502 `zoho_indisponivel` sem segredo; sem conexão → 503.
- Mutações que têm de reprovar: as duas do ensaio; trocar a ordem dos dias (`diasEmOrdem` crescente: o `verso.pdf` do dia 8 continua achado, mas a dica deixa de valer — o `TestRegrasDoCartao` reprova); `Content-Type` diferente de octet-stream.

```go
package vessel

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"sync"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/testebanco/mundoteste"
	"github.com/rbv-co/social-dashboard/api/internal/zoho"
	"golang.org/x/text/unicode/norm"
)

// Os exemplos reais de supabase/functions/_shared/cartao-no-zoho.test.mjs.
func TestRegrasDoCartao(t *testing.T) {
	if n := nomeDoArquivo("SS0001HB.S1", 4, "frente", "png"); n != "SS0001HB.S1_cartao_04_frente.png" {
		t.Errorf("nome = %s", n)
	}
	if n := nomeDoArquivo("SS0003SB.B2", 10, "verso", "pdf"); n != "SS0003SB.B2_cartao_10_verso.pdf" {
		t.Errorf("nome = %s", n)
	}
	for _, c := range []struct {
		sku       string
		n         int
		face, fmt string
	}{{"SS0001HB.S1", 4, "lado", "png"}, {"SS0001HB.S1", 4, "frente", "exe"}, {"SS0001HB.S1", 0, "frente", "png"},
		{"", 4, "frente", "png"}, {"SS0001HB.S1", 4, "../../x", "png"}} {
		if n := nomeDoArquivo(c.sku, c.n, c.face, c.fmt); n != "" {
			t.Errorf("%+v virou nome: %s", c, n)
		}
	}
	pasta := func(id, nome string) zoho.Item { return zoho.Item{ID: id, Nome: nome, Pasta: true} }
	dias := diasEmOrdem([]zoho.Item{pasta("a", "2026-09-07"), pasta("b", "2026-10-07"), pasta("c", "2026-10-06"),
		pasta("d", "Cartões com EAN - BKP 07-09-2026"), {ID: "e", Nome: "2026-10-08"}})
	if ids := []string{dias[0].ID, dias[1].ID, dias[2].ID}; len(dias) != 3 || !reflect.DeepEqual(ids, []string{"b", "c", "a"}) {
		t.Errorf("dias = %+v", dias)
	}
	sub := []zoho.Item{pasta("1", "SS0001HB.S1 - Linear Caramelo Pequena"), pasta("2", "SS0001HB.S10 - Outra"),
		pasta("3", norm.NFD.String("SS0001HB.M2 - Linear Vermelha Média"))}
	if p := pastaDoSku(sub, "SS0001HB.S1"); p == nil || p.ID != "1" {
		t.Errorf("pasta do SKU = %+v", p)
	}
	if p := pastaDoSku(sub, "SS0001HB.M2"); p == nil || p.ID != "3" {
		t.Errorf("o acento solto escondeu a pasta: %+v", p)
	}
	if pastaDoSku(sub, "SS9999XX.Z9") != nil || pastaDoSku(nil, "SS0001HB.S1") != nil {
		t.Error("achou pasta que não existe")
	}
	if !ehPastaDosCartoes("Cartões com EAN") || !ehPastaDosCartoes(norm.NFD.String("Cartões com EAN")) || ehPastaDosCartoes("Cartões com EAN - BKP 06-09-2026") {
		t.Error("a pasta dos cartões")
	}
	for pasta, quer := range map[string]string{"Cartões com EAN/2026-10-09": "2026-10-09", " Cartões com EAN/2026-10-09 ": "2026-10-09",
		"Cartões com EAN/2026-10-09 - BKP": "", "Cartões com EAN": "", "": ""} {
		if d := diaDaPasta(pasta); d != quer {
			t.Errorf("diaDaPasta(%q) = %q", pasta, d)
		}
	}
	tres := []zoho.Item{pasta("9", "2026-10-09"), pasta("7", "2026-10-07"), pasta("6", "2026-10-06")}
	nomes := func(l []zoho.Item) (s []string) {
		for _, i := range l {
			s = append(s, i.Nome)
		}
		return
	}
	for dica, quer := range map[string][]string{"2026-10-06": {"2026-10-06", "2026-10-09", "2026-10-07"},
		"2026-10-09": {"2026-10-09", "2026-10-07", "2026-10-06"}, "2026-01-01": {"2026-10-09", "2026-10-07", "2026-10-06"},
		"": {"2026-10-09", "2026-10-07", "2026-10-06"}} {
		if n := nomes(diasComDicaPrimeiro(tres, dica)); !reflect.DeepEqual(n, quer) {
			t.Errorf("dica %q = %v", dica, n)
		}
	}
}

// zohoDoRobo: a árvore que o robô de cartões deixa no WorkDrive, de mentira.
type zohoDoRobo struct {
	mu        sync.Mutex
	pedidos   []string          // os caminhos pedidos à API (sem o token)
	quebrado  bool              // toda listagem responde 500
	pastas    map[string]string // id da pasta → itens no JSON:API do WorkDrive
	conteudos map[string]string // id do arquivo → bytes; ausente = 404
	recusa    map[string]int    // id do arquivo → status do download
}

func novoZohoDoRobo() *zohoDoRobo {
	item := func(id, nome string, pasta bool) string {
		return fmt.Sprintf(`{"id":%q,"attributes":{"name":%q,"is_folder":%t}}`, id, nome, pasta)
	}
	lista := func(itens ...string) string { return `{"data":[` + strings.Join(itens, ",") + `]}` }
	return &zohoDoRobo{
		pastas: map[string]string{
			raizDasFotos: lista(item("vb", "Vessel Brasil", true), item("outra", "Outra marca", true)),
			"vb":         lista(item("bkp", "Cartões com EAN - BKP 06-09-2026", true), item("ce", norm.NFD.String("Cartões com EAN"), true)),
			"ce":         lista(item("d8", "2026-10-08", true), item("d9", "2026-10-09", true)),
			"d9":         lista(item("sku9", "SS0001HB.S1 - Linear Caramelo", true)),
			"d8":         lista(item("sku8", "SS0001HB.S1 - Linear Caramelo", true)),
			"sku9":       lista(item("v1", "SS0001HB.S1_cartao_01_verso.png", false), item("fp1", "SS0001HB.S1_cartao_01_frente.pdf", false)),
			"sku8":       lista(item("vp1", "SS0001HB.S1_cartao_01_verso.pdf", false)),
		},
		conteudos: map[string]string{"gravado1": "FRENTE-PNG", "v1": "VERSO-PNG", "vp1": "VERSO-PDF-DO-DIA-8"},
		recusa:    map[string]int{"fp1": 500},
	}
}

func (z *zohoDoRobo) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	z.mu.Lock()
	defer z.mu.Unlock()
	if r.URL.Path == "/oauth/v2/token" {
		io.WriteString(w, `{"access_token":"TOKEN-DO-ZOHO"}`)
		return
	}
	z.pedidos = append(z.pedidos, r.URL.Path)
	if r.Header.Get("Authorization") != "Zoho-oauthtoken TOKEN-DO-ZOHO" {
		w.WriteHeader(401)
		return
	}
	if id, ok := strings.CutPrefix(r.URL.Path, "/workdrive/api/v1/download/"); ok {
		if s := z.recusa[id]; s != 0 {
			w.WriteHeader(s)
			return
		}
		c, ok := z.conteudos[id]
		if !ok {
			w.WriteHeader(404)
			return
		}
		io.WriteString(w, c)
		return
	}
	id := strings.TrimSuffix(strings.TrimPrefix(r.URL.Path, "/workdrive/api/v1/files/"), "/files")
	if z.quebrado {
		w.WriteHeader(500)
		return
	}
	if l, ok := z.pastas[id]; ok && r.URL.Query().Get("page[offset]") == "0" {
		io.WriteString(w, l)
		return
	}
	io.WriteString(w, `{"data":[]}`)
}

func (z *zohoDoRobo) contar(prefixo string) (n int) {
	z.mu.Lock()
	defer z.mu.Unlock()
	for _, p := range z.pedidos {
		if strings.HasPrefix(p, prefixo) {
			n++
		}
	}
	z.pedidos = nil
	return
}

func TestBaixarCartao(t *testing.T) {
	z := novoZohoDoRobo()
	srv := httptest.NewServer(z)
	defer srv.Close()
	m := novoMundo(t, func(r chi.Router, p *pgxpool.Pool) {
		r.Post("/vessel-baixar-cartao", (&Cartao{Pool: p, Zoho: zoho.ParaTeste(t, p, srv.URL)}).ServeHTTP)
	})
	// a conexão (a tabela é da fatia do 5.4: aqui só se faltar) e o id que o robô gravou da frente em png de P1
	if _, err := m.P.Exec(context.Background(), `create table if not exists acessos_conexoes (provedor text primary key, client_id text,
		  client_secret text, refresh_token text, org_id text, data_center text default '.com', escopos text, conectado_por uuid,
		  conectado_em timestamptz, atualizado_em timestamptz not null default now())`); err != nil {
		t.Fatal(err)
	}
	m.P.Exec(context.Background(), `insert into acessos_conexoes (provedor, client_id, client_secret, refresh_token) values
		('zoho', 'ID', 'SEGREDO-CLIENTE', 'SEGREDO-REFRESH');
		insert into vessel_cartao_arquivos (codigo, nome, zoho_id) values ('VBAAAA0001', 'SS0001HB.S1_cartao_01_frente.png', 'gravado1');
		update vessel_pecas set cartao_gerado_em = now() where codigo = 'VBAAAA0003'`)
	corpo := func(codigo, face, formato string) string {
		return fmt.Sprintf(`{"codigo":%q,"face":%q,"formato":%q}`, codigo, face, formato)
	}
	m.Rodar(t, []mundoteste.Caso{
		{Nome: "quem não é do selo", Quem: "admin", Metodo: "POST", Caminho: "/vessel-baixar-cartao", Corpo: corpo(P1, "frente", "png"), Status: 403, Tem: `"error":"sem_permissao"`},
		{Nome: "a chave só em permissions", Quem: "chave", Metodo: "POST", Caminho: "/vessel-baixar-cartao", Corpo: corpo(P1, "frente", "png"), Status: 403},
		{Nome: "desativado", Quem: "desativado", Metodo: "POST", Caminho: "/vessel-baixar-cartao", Corpo: corpo(P1, "frente", "png"), Status: 401},
	})
	if n := z.contar("/"); n != 0 {
		t.Fatalf("quem foi recusado chegou ao Zoho: %d pedidos", n)
	}
	m.Rodar(t, []mundoteste.Caso{
		{Nome: "sem corpo", Quem: "selo", Metodo: "POST", Caminho: "/vessel-baixar-cartao", Status: 400, Tem: `"erro":"codigo_invalido"`},
		{Nome: "código que não é texto", Quem: "selo", Metodo: "POST", Caminho: "/vessel-baixar-cartao", Corpo: `{"codigo":12345678,"face":"frente","formato":"png"}`, Status: 400, Tem: "codigo_invalido"},
		{Nome: "código com barra", Quem: "selo", Metodo: "POST", Caminho: "/vessel-baixar-cartao", Corpo: corpo("../VBAAAA0001", "frente", "png"), Status: 400, Tem: "codigo_invalido"},
		{Nome: "peça que não existe", Quem: "selo", Metodo: "POST", Caminho: "/vessel-baixar-cartao", Corpo: corpo("ZZZZ9999", "frente", "png"), Status: 404, Tem: `"erro":"peca_nao_existe"`},
		{Nome: "peça sem cartão", Quem: "selo", Metodo: "POST", Caminho: "/vessel-baixar-cartao", Corpo: corpo(P2, "frente", "png"), Status: 409, Tem: `"erro":"sem_cartao"`},
		{Nome: "face fora da lista", Quem: "selo", Metodo: "POST", Caminho: "/vessel-baixar-cartao", Corpo: corpo(P1, "lado", "png"), Status: 400, Tem: `"erro":"pedido_invalido"`},
		{Nome: "face com caminho", Quem: "selo", Metodo: "POST", Caminho: "/vessel-baixar-cartao", Corpo: corpo(P1, "../../x", "png"), Status: 400, Tem: "pedido_invalido"},
	})
	if n := z.contar("/"); n != 0 {
		t.Fatalf("pedido inválido chegou ao Zoho: %d pedidos", n)
	}
	// o caminho comum: o id gravado pelo robô, sem listar nada; o "entrar como" também baixa (só lê)
	for _, quem := range []string{"selo", "impersonado"} {
		w := m.Resposta(t, quem, "POST", "/vessel-baixar-cartao", corpo(strings.ToLower(P1), "frente", "png"))
		if w.Code != 200 || w.Body.String() != "FRENTE-PNG" || w.Header().Get("Content-Type") != "application/octet-stream" ||
			!strings.Contains(w.Header().Get("Content-Disposition"), "SS0001HB.S1_cartao_01_frente.png") || w.Header().Get("Cache-Control") != "no-store" {
			t.Errorf("%s baixando pelo id gravado = %d %q %v", quem, w.Code, w.Body, w.Header())
		}
		if n, l := z.contar("/workdrive/api/v1/download/"), z.contar("/workdrive/api/v1/files/"); n != 1 || l != 0 {
			t.Errorf("%s: %d downloads e %d listagens, esperava 1 e 0", quem, n, l)
		}
	}
	// sem id gravado: a busca acha no dia da dica (o do último pedido pronto: 2026-10-09) e no dia mais velho
	casos := []struct{ face, formato, quer string }{{"verso", "png", "VERSO-PNG"}, {"verso", "pdf", "VERSO-PDF-DO-DIA-8"}}
	for _, c := range casos {
		w := m.Resposta(t, "selo", "POST", "/vessel-baixar-cartao", corpo(P1, c.face, c.formato))
		if w.Code != 200 || w.Body.String() != c.quer {
			t.Errorf("busca %s.%s = %d %s", c.face, c.formato, w.Code, w.Body)
		}
	}
	// id gravado que o Zoho recusa (arquivo trocado): cai na busca
	m.P.Exec(context.Background(), `insert into vessel_cartao_arquivos (codigo, nome, zoho_id) values ('VBAAAA0001', 'SS0001HB.S1_cartao_01_verso.png', 'sumiu')`)
	if st, b := m.Pedir(t, "selo", "POST", "/vessel-baixar-cartao", corpo(P1, "verso", "png")); st != 200 || b != "VERSO-PNG" {
		t.Errorf("id gravado recusado = %d %s", st, b)
	}
	m.Rodar(t, []mundoteste.Caso{
		{Nome: "arquivo que nenhum dia tem", Quem: "selo", Metodo: "POST", Caminho: "/vessel-baixar-cartao", Corpo: corpo(P3, "frente", "png"),
			Status: 404, Tem: `"arquivo":"SS0001HB.S1_cartao_03_frente.png"`},
		{Nome: "o Zoho recusa o download", Quem: "selo", Metodo: "POST", Caminho: "/vessel-baixar-cartao", Corpo: corpo(P1, "frente", "pdf"),
			Status: 502, Tem: `"status":500`},
	})
	z.mu.Lock()
	z.quebrado = true // toda listagem responde 500 daqui em diante
	z.mu.Unlock()
	m.Rodar(t, []mundoteste.Caso{{Nome: "o Zoho fora do ar na busca", Quem: "selo", Metodo: "POST", Caminho: "/vessel-baixar-cartao",
		Corpo: corpo(P1, "verso", "pdf"), Status: 502, Tem: `"erro":"zoho_indisponivel"`, NaoTem: "SEGREDO"}})
	m.P.Exec(context.Background(), `delete from acessos_conexoes`)
	m.Rodar(t, []mundoteste.Caso{{Nome: "sem conexão do Zoho", Quem: "selo", Metodo: "POST", Caminho: "/vessel-baixar-cartao",
		Corpo: corpo(P1, "frente", "png"), Status: 503, Tem: `"erro":"zoho_desconectado"`}})
}
```

**(c) Arquivos:** Create `api/internal/vessel/cartao.go`, `api/internal/vessel/cartao_test.go`.

**(d) Dependências:** Tasks 3 e 5.

- [ ] **Step 1:** Testes; ver falhar. - [ ] **Step 2:** `cartao.go`. - [ ] **Step 3:** `cd api && gofmt -l ./internal && go vet ./internal/vessel/ && go test -count=1 -race ./internal/vessel/` PASS; mutações reprovam. - [ ] **Step 4: Commit** `feat(api): POST /vessel-baixar-cartao — o cartão EAN do Zoho pelo servidor, com o portão do selo e sem os caches de listagem` (+ `Co-Authored-By`).

---

### Task 7: `GET /fabrica/robo/material-do-sku` — o contrato que o 5.8 deixou para o dono de `vessel_lotes`

**Revisor:** sonnet. **Depende de:** Task 2 (`vessel_lotes` na fatia, com o gatilho que herda o material); 5.8 (`internal/fabrica`: `montarRobo`, `responder`, o mundo com `robo`/`roboSemFabrica`).

**(a) Contrato** (plano 5.8, Ruling 5.8-13 e a seção do inventário do robô)
- `GET /fabrica/robo/material-do-sku?sku=<texto de 1 a 80>` → `200 {"material": <"canvas"|"couro"|null>}` = `select material from vessel_lotes where sku = $1::text and material is not null order by criado_em desc, id desc limit 1` (a consulta de `coletor/hero-ia/texto-da-garantia.mjs:42-47`). Sem lote com material = `null` (a arte sai sem a pílula, como o robô já trata). `sku` ausente, vazio, com mais de 80 caracteres, repetido ou com outro parâmetro junto = 400.
- Mora em `internal/fabrica` (no grupo `auth.SoServico` + `soFabricante` de `montarRobo`): só o robô da Fábrica, com a chave `meta.fabrica` no perfil de serviço; painel (inclusive super e fabricante), impersonado e robô sem a chave = 403; sem sessão = 401 (Ruling 5.10-14). Projeta UMA coluna: o robô não ganha o módulo `autenticidade`.
- As varreduras do 5.8 (`fabrica/rotas_test.go`) passam a contar 10 leituras e 8 rotas de robô, e a leitura de robô é chamada com a query obrigatória (`consultas`).
- **Ensaiado** (13/10): `go test -race ./internal/fabrica/` inteiro passa com a rota e o teste novos.

Em `api/internal/fabrica/robo.go`, a linha no grupo de `montarRobo` e a função:

```go
		r.Post("/fabrica/robo/execucoes", criarExecucao(p))
		r.Get("/fabrica/robo/material-do-sku", materialDoSku(p)) // Plano 5.10 (Ruling 5.8-13)
	})
}

// materialDoSku: GET /fabrica/robo/material-do-sku?sku= — o material do lote MAIS RECENTE do SKU com material, para a
// pílula de garantia da arte (coletor/hero-ia/texto-da-garantia.mjs:42-47, a mesma consulta). Contrato do 5.8
// (Ruling 5.8-13), implementado pelo 5.10, dono de vessel_lotes: UMA coluna para o robô da Fábrica, sem dar a ele o
// módulo autenticidade (que abriria as RPCs do selo). Sem lote com material: {"material": null} (sem pílula).
func materialDoSku(p *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		sku := q.Get("sku")
		if len(q) != 1 || len(q["sku"]) != 1 || strings.TrimSpace(sku) == "" || utf8.RuneCountInString(sku) > 80 {
			dados.Erro(w, http.StatusBadRequest, "pedido_invalido", "sku é obrigatório (até 80 caracteres) e é o único parâmetro.")
			return
		}
		var material *string
		err := p.QueryRow(r.Context(), `select material from vessel_lotes where sku = $1::text and material is not null
			order by criado_em desc, id desc limit 1`, sku).Scan(&material)
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			dados.ErroDoBanco(w, err)
			return
		}
		responder(w, http.StatusOK, map[string]*string{"material": material})
	}
}
```

Em `api/internal/fabrica/rotas_test.go`: antes de `varrer`, `var consultas = map[string]string{"/fabrica/robo/material-do-sku": "?sku=SS0001HB.S1"}` (com o comentário "a query obrigatória das leituras que não respondem sem ela (Plano 5.10)"); em `varrer`, `f(metodo, rota, rota+consultas[rota], "")` nas GETs; em `TestNadaVazaEntreContas`, `l != 10` (e a mensagem "esperava 10 (1) e 12"); em `TestRotasDeRoboSoServico`, `robo != 8`.

**(b) Testes de aceitação** (`robo_material_test.go`, código abaixo)
- `TestMaterialDoSku`: o mais recente COM material (`couro`, mesmo havendo um lote mais novo sem material); SKU com `&` e espaço; SKU sem lote e SKU que parece SQL → `null`; sem sku, vazio, 81 caracteres, dois skus, parâmetro a mais → 400; fabricante, super, robô sem a chave, impersonado → 403; sem sessão → 401. E as varreduras do 5.8 continuam passando com a rota nova.
- Mutações que têm de reprovar: tirar o `and material is not null` (vem `null` do lote de março); montar fora do grupo de robô (o fabricante lê: 403 reprova); aceitar parâmetro a mais.

```go
package fabrica

import (
	"context"
	"strings"
	"testing"

	"github.com/rbv-co/social-dashboard/api/internal/testebanco/mundoteste"
)

// O material do lote mais recente do SKU, para a pílula de garantia da arte: só o robô da Fábrica (sessão de
// serviço com a chave), uma coluna, o SKU exato (texto livre, nunca no SQL).
func TestMaterialDoSku(t *testing.T) {
	m := mundoRobo(t)
	ctx := context.Background()
	for _, sql := range []string{
		`insert into vessel_lotes (modelo, sku, quantidade, material, material_fonte, criado_em) values
		  ('Linear', 'SS0001HB.S1', 1, 'canvas', 'dono', '2026-01-01T10:00:00Z'),
		  ('Linear', 'SS0001HB.S1', 1, 'couro', 'painel', '2026-02-01T10:00:00Z'),
		  ('Linear', 'SS0001HB.S1', 1, null, null, '2026-03-01T10:00:00Z'),
		  ('Bolsa', 'A&B 1', 1, 'canvas', 'dono', '2026-01-01T10:00:00Z')`,
		// o gatilho deu ao lote de março o material herdado; tirá-lo deixa o lote mais novo SEM material
		`update vessel_lotes set material = null, material_fonte = null where criado_em = '2026-03-01T10:00:00Z'`,
	} {
		if _, err := m.P.Exec(ctx, sql); err != nil {
			t.Fatal(err)
		}
	}
	const rota = "/fabrica/robo/material-do-sku"
	m.Rodar(t, []mundoteste.Caso{
		{Nome: "o mais recente com material", Quem: "robo", Metodo: "GET", Caminho: rota + "?sku=SS0001HB.S1", Status: 200, Tem: `{"material":"couro"}`},
		{Nome: "SKU com & e espaço", Quem: "robo", Metodo: "GET", Caminho: rota + "?sku=A%26B%201", Status: 200, Tem: `{"material":"canvas"}`},
		{Nome: "SKU sem lote", Quem: "robo", Metodo: "GET", Caminho: rota + "?sku=SS9999", Status: 200, Tem: `{"material":null}`},
		{Nome: "SKU que parece SQL", Quem: "robo", Metodo: "GET", Caminho: rota + "?sku=x%27%20or%20%271%27%3D%271", Status: 200, Tem: `{"material":null}`},
		{Nome: "sem sku", Quem: "robo", Metodo: "GET", Caminho: rota, Status: 400},
		{Nome: "sku vazio", Quem: "robo", Metodo: "GET", Caminho: rota + "?sku=%20", Status: 400},
		{Nome: "sku longo demais", Quem: "robo", Metodo: "GET", Caminho: rota + "?sku=" + strings.Repeat("a", 81), Status: 400},
		{Nome: "dois skus", Quem: "robo", Metodo: "GET", Caminho: rota + "?sku=a&sku=b", Status: 400},
		{Nome: "parâmetro a mais", Quem: "robo", Metodo: "GET", Caminho: rota + "?sku=SS0001HB.S1&x=1", Status: 400},
		{Nome: "painel, mesmo o fabricante", Quem: "fabricante", Metodo: "GET", Caminho: rota + "?sku=SS0001HB.S1", Status: 403},
		{Nome: "super pelo painel", Quem: "super", Metodo: "GET", Caminho: rota + "?sku=SS0001HB.S1", Status: 403},
		{Nome: "robô sem a chave da Fábrica", Quem: "roboSemFabrica", Metodo: "GET", Caminho: rota + "?sku=SS0001HB.S1", Status: 403},
		{Nome: "impersonado", Quem: "impersonado", Metodo: "GET", Caminho: rota + "?sku=SS0001HB.S1", Status: 403},
		{Nome: "sem sessão", Quem: "", Metodo: "GET", Caminho: rota + "?sku=SS0001HB.S1", Status: 401},
	})
}
```

**(c) Arquivos:** Create `api/internal/fabrica/robo_material_test.go`; Modify `api/internal/fabrica/robo.go`, `api/internal/fabrica/rotas_test.go`.

**(d) Dependências:** Task 2; 5.8 mesclado (ou no branch, pelo pré-voo).

- [ ] **Step 1:** Teste; ver falhar (404). - [ ] **Step 2:** A rota e os ajustes das varreduras. - [ ] **Step 3:** `cd api && gofmt -l ./internal && go vet ./internal/fabrica/ && go test -count=1 -race ./internal/fabrica/` PASS; mutações reprovam. - [ ] **Step 4: Commit** `feat(api): GET /fabrica/robo/material-do-sku — a pílula de garantia da Fábrica lê o material do lote (contrato do 5.8)` (+ `Co-Authored-By`).

---

### Task 8: Montagem, varreduras, `conferir`, notas e API-PRONTA

**Revisor:** opus. **Depende de:** Tasks 3–7.

**(a) Contrato**
- `vessel.Montar(r, p)` registra as **6 leituras** no grupo de DOMÍNIO de `web.Rotas` (`auth.Exigir` → `comPrazo(PrazoDominio)` → `autz.ComEscopo`), depois do `fabrica.Montar`. As 16 RPCs entram por `web.FuncoesRPC` (`vessel.FuncoesRPC, // Plano 5.10`) e SAEM de `RPCPendentes` no mesmo commit (o bloco `// 5.10 (autenticidade): 16` inteiro; `TestListasDeRPCFecham` confere a soma das 92).
- `POST /vessel-baixar-cartao` no grupo de SESSÃO com `autz.ComEscopo(p)` e `comPrazo(PrazoCartao)` (`PrazoCartao = 60 * time.Second`, ao lado de `PrazoIA`/`PrazoMapa`), com `zoho.Novo(p)`. O portão do selo está DENTRO do handler (como o `/bling-proxy` e o `/custo-*`): `TestNenhumaRotaNovaFicaAberta` prova o 403 sem módulo. `TestPrazosPorRotaPelaMontagemReal` ganha `"POST /vessel-baixar-cartao": PrazoCartao` e as 6 leituras com `PrazoDominio`.
- **Os dois testes do 5.0 que usavam `vessel_gerar_lote` como "um nome pendente qualquer"** (`TestRPCRegistradaPelaMontagemReal` em `web/rotas_test.go` e `TestRotasPanicaComRPCRegistradaErrada` em `web/rpc_lista_test.go`) passam a usar `RPCPendentes[len(RPCPendentes)-1]` (o último pendente, de um sub-plano futuro): com o 5.10, `vessel_gerar_lote` registrada de verdade faria a montagem panicar por nome duplicado (ensaiado). A intenção deles (uma função movida de pendente para registrada monta e responde; as erradas panicam) continua. Quando `RPCPendentes` esvaziar (Plano 8), troque por uma função de teste fora das listas.
- `vessel/rotas_test.go`: `TestNadaVazaDoSelo` varre TODA rota de `Montar` (chi.Walk) e TODA função de `FuncoesRPC` com um corpo válido (`corpos`): admin, leitor e chave recebem `[]`/conta 0 nas leituras e 403 nas RPCs; o impersonado lê tudo (leituras e as 2 RPCs de leitura) e recebe 403 com a frase nas 14 que gravam; a foto não muda. Rota ou função nova sem caso aqui faz o teste falhar.
- `cmd/api/conferir.go`: `colunasDoWorker` com as 8 tabelas que as rotas, o cartão e o material-do-sku leem (inclusive as 2 colunas PRESUMIDAS de `vessel_registros`, que só o banco restaurado confirma) e `acessos_conexoes` (o `internal/zoho`); `tiposDoWorker` com os casts (`vessel_pecas.codigo` texto, `vessel_cartao_pedidos.pecas` `text[]`, `garantia_ate` e `nascimento` `date`); `gatilhosDoWorker` com os 6 gatilhos vivos; e `conferirDisparos` (a `disparar_robo` tem de ser a da 00007 — grava em `disparos_pendentes`, sem `net.http_post` — e os 2 gatilhos removidos em 10/10 não podem ter voltado). As 16 RPCs NÃO entram em `funcoesDoWorker`: `conferirRPC` (5.0) confere cada função de `web.FuncoesRPC`.
- `cmd/api/conferir_test.go`: a fixture `esquemaCompleto` cria as funções de `web.FuncoesRPC` pela própria declaração (o bloco do plano 5.9, Task 9 — **se o 5.9 já entrou, ele já está lá: não duplique**); sem isso todo teste do `conferir` acusa as 16 (ensaiado). `TestConferirNaFatiaD0NaoAcusaOPlano510` e `TestConferirDisparos`.
- `internal/github/github.go`: só os comentários — o do pacote ("Consumidores: fabrica (5.8), Plano 6") e o de `Disparos` ("O 5.10 não acrescenta entrada: os robôs do selo rodam na VPS e o Actions não alcança o banco (Ruling 5.10-2); o Plano 6, as dele."). Nenhuma entrada nova.
- **Ensaiado** (13/10, a árvore com as Tasks 1–8): `go test ./internal/web/ ./cmd/api ./internal/vessel ./internal/fabrica` passa; `go test -race ./...` na seção "Verificação final".

```go
package vessel

import (
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Montar registra as rotas de tabela do painel de Autenticidade no grupo de DOMÍNIO de web.Rotas (depois de
// auth.Exigir, do prazo de 30 s e de autz.ComEscopo): as 6 leituras. As 16 RPCs entram por FuncoesRPC
// (web.FuncoesRPC); POST /vessel-baixar-cartao (Cartao) tem prazo próprio e web.Rotas o monta fora do grupo de
// domínio. Nenhuma escrita de tabela: em produção as 11 tabelas do selo só têm policy de SELECT.
func Montar(r chi.Router, p *pgxpool.Pool) { montarLeituras(r, p) }
```

```go
package vessel

import (
	"net/http"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// corpos: um pedido VÁLIDO por RPC do selo. Função nova sem corpo aqui faz as varreduras falharem.
var corpos = map[string]string{
	"vessel_alertas":                    `{}`,
	"vessel_fila_de_registros":          `{}`,
	"vessel_baixar_garantia":            `{"p_codigo":"VBAAAA0003","p_motivo":"pedido da cliente"}`,
	"vessel_baixar_peca":                `{"p_codigo":"VBAAAA0002","p_motivo":"extraviada"}`,
	"vessel_decidir_pedido_de_registro": `{"p_pedido":"` + PR2 + `","p_estado":"aprovado","p_quem_decidiu":"na_mao"}`,
	"vessel_definir_material_do_lote":   `{"p_lote":"` + L1 + `","p_material":"couro"}`,
	"vessel_desfazer_baixa":             `{"p_codigo":"VBTTTT0002"}`,
	"vessel_desmarcar_gravada":          `{"p_codigo":"VBAAAA0001","p_motivo":null}`,
	"vessel_editar_lote":                `{"p_lote":"` + L1 + `","p_modelo":"Linear","p_cor":"Caramelo","p_sku":"SS0001HB.S1","p_fabricado_em":null,"p_quantidade":4}`,
	"vessel_excluir_lote":               `{"p_lote":"` + L2 + `"}`,
	"vessel_excluir_peca":               `{"p_codigo":"VBAAAA0002"}`,
	"vessel_gerar_lote":                 `{"p_modelo":"Linear","p_cor":null,"p_sku":"SS0001HB.S1","p_quantidade":1,"p_fabricado_em":null,"p_fotos":null}`,
	"vessel_marcar_gravada":             `{"p_codigo":"VBAAAA0002"}`,
	"vessel_pedir_cartoes":              `{"p_pecas":["VBAAAA0002"]}`,
	"vessel_sobrescrever_etiqueta":      `{"p_codigo_antigo":"VBAAAA0001","p_codigo_novo":"VBAAAA0002","p_destino":"fila","p_motivo":"rasgou"}`,
	"vessel_trocar_dono":                `{"p_codigo":"VBAAAA0003","p_nome":"Bia","p_cpf":"11144477735","p_whatsapp":"11988887777","p_motivo":"venda","p_confirmacao":"VBAAAA0003"}`,
}

// tudo: as 6 leituras de Montar e as 16 RPCs, como web.Rotas as monta no grupo de domínio.
func tudo(r chi.Router, p *pgxpool.Pool) {
	Montar(r, p)
	montarRPCs(r, p)
}

// Ninguém fora do selo lê nem grava nada dele, por NENHUMA rota (leitura: [] e conta 0; RPC: 403, sem efeito);
// o "entrar como" lê tudo e não grava nada. Rota ou função nova entra sozinha (chi.Walk e FuncoesRPC).
func TestNadaVazaDoSelo(t *testing.T) {
	m := novoMundo(t, tudo)
	antes := m.Um(t, fotoDoSelo)
	lidas := 0
	err := chi.Walk(m.H.(chi.Routes), func(metodo, rota string, _ http.Handler, _ ...func(http.Handler) http.Handler) error {
		if metodo != http.MethodGet {
			return nil
		}
		lidas++
		for _, quem := range []string{"admin", "leitor", "chave"} {
			w := m.Resposta(t, quem, "GET", rota+"?contar=1", "")
			if w.Code != http.StatusOK || strings.TrimSpace(w.Body.String()) != "[]" || w.Header().Get("X-Total-Count") != "0" {
				t.Errorf("%s GET %s = %d %s", quem, rota, w.Code, w.Body)
			}
		}
		if st, b := m.Pedir(t, "impersonado", "GET", rota, ""); st != http.StatusOK || strings.TrimSpace(b) == "[]" {
			t.Errorf("o impersonado (o alvo é do selo) não leu %s: %d %s", rota, st, b)
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if lidas != len(leituras) || lidas != 6 {
		t.Errorf("leituras montadas = %d, declaradas = %d, esperava 6", lidas, len(leituras))
	}
	gravam := 0
	for _, f := range FuncoesRPC {
		corpo, ok := corpos[f.Nome]
		if !ok {
			t.Errorf("RPC sem corpo nas varreduras: %s", f.Nome)
			continue
		}
		for _, quem := range []string{"admin", "leitor", "chave"} {
			if st, b := m.Pedir(t, quem, "POST", "/rpc/"+f.Nome, corpo); st != http.StatusForbidden {
				t.Errorf("%s POST /rpc/%s = %d %s", quem, f.Nome, st, b)
			}
		}
		st, b := m.Pedir(t, "impersonado", "POST", "/rpc/"+f.Nome, corpo)
		if f.SoSessaoPropria {
			gravam++
			if st != http.StatusForbidden || !strings.Contains(b, "Quem entrou como outra pessoa") {
				t.Errorf("impersonado POST /rpc/%s = %d %s", f.Nome, st, b)
			}
		} else if st != http.StatusOK {
			t.Errorf("impersonado lendo /rpc/%s = %d %s", f.Nome, st, b)
		}
	}
	if len(FuncoesRPC) != 16 || gravam != 14 {
		t.Errorf("RPCs = %d (%d gravam), esperava 16 (14)", len(FuncoesRPC), gravam)
	}
	if m.Um(t, fotoDoSelo) != antes {
		t.Error("quem não é do selo, ou o impersonado, mudou o selo")
	}
}
```

Em `api/internal/web/rotas_test.go`, antes do `init`:

```go
// Plano 5.10: as 6 leituras do selo. Portão = catálogo (is_vessel_admin), provado pela matriz de `internal/vessel`
// (TestLeiturasDoSelo, TestNadaVazaDoSelo). O cartão (POST /vessel-baixar-cartao, portão do selo DENTRO do handler)
// e a rota de robô da Fábrica NÃO entram: TestNenhumaRotaNovaFicaAberta prova o 403 sem módulo.
var rotas510 = []string{"GET /autenticidade/lotes", "GET /autenticidade/pecas", "GET /autenticidade/registros",
	"GET /autenticidade/baixas", "GET /autenticidade/cartao-pedidos", "GET /autenticidade/lembretes"}
```
o `init` passa a `slices.Concat(rotas51, rotas57, rotas58, rotas510)` (mais as listas de quem entrou antes); em `TestPrazosPorRotaPelaMontagemReal`, `"POST /vessel-baixar-cartao": PrazoCartao` no mapa e `slices.Concat(rotas51, rotas57, rotas510)` no laço do prazo de domínio; e, no fim:

```go
// Plano 5.10: o selo pela montagem de PRODUÇÃO (web.Rotas): as leituras no grupo de domínio, as 16 RPCs registradas e
// o cartão com o portão do selo antes do Zoho (sem conexão do Zoho no banco de teste: 503 depois do portão).
func TestSeloPelaMontagemReal(t *testing.T) {
	p := testebanco.ComEsquemaDeProducao(t)
	s := auth.NovoStore(p)
	h := Rotas(p, s, auth.NovoLimitador(), config.Config{})
	ctx := context.Background()
	if _, err := p.Exec(ctx, `create table if not exists acessos_conexoes (provedor text primary key, client_id text, client_secret text,
		refresh_token text, org_id text, data_center text default '.com', escopos text, conectado_por uuid, conectado_em timestamptz,
		atualizado_em timestamptz not null default now())`); err != nil {
		t.Fatal(err)
	}
	quem := map[string]string{}
	for i, c := range []struct{ nome, features string }{{"selo", "{autenticidade}"}, {"so-meta", "{meta}"}} {
		id := fmt.Sprintf("5a10a000-0000-4000-a000-00000000000%d", i+1)
		if _, err := p.Exec(ctx, `insert into usuarios (id, email) values ($1::uuid, $2::text)`, id, c.nome+"@x.com"); err != nil {
			t.Fatal(err)
		}
		if _, err := p.Exec(ctx, `insert into profiles (id, email, role, features) values ($1::uuid, $2::text, 'viewer', $3::text[])`, id, c.nome+"@x.com", c.features); err != nil {
			t.Fatal(err)
		}
		tok, err := s.Criar(ctx, id, "painel", nil)
		if err != nil {
			t.Fatal(err)
		}
		quem[c.nome] = tok
	}
	if _, err := p.Exec(ctx, `insert into vessel_lotes (id, modelo, sku, quantidade) values ('5a10b000-0000-4000-a000-000000000001', 'Linear', 'SS1', 1);
		insert into vessel_pecas (codigo, lote_id, numero_na_serie, cartao_gerado_em) values ('VBMONTA001', '5a10b000-0000-4000-a000-000000000001', 1, now())`); err != nil {
		t.Fatal(err)
	}
	for _, c := range []struct {
		nome, quem, metodo, rota, corpo string
		status                          int
		tem                             string
	}{
		{"leitura sem sessão", "", "GET", "/autenticidade/pecas", "", 401, "nao_autenticado"},
		{"leitura de quem não é do selo", "so-meta", "GET", "/autenticidade/pecas", "", 200, "[]"},
		{"leitura do selo", "selo", "GET", "/autenticidade/pecas", "", 200, "VBMONTA001"},
		{"RPC registrada, quem não é do selo", "so-meta", "POST", "/rpc/vessel_alertas", "{}", 403, "sem_permissao"},
		{"RPC registrada, o selo", "selo", "POST", "/rpc/vessel_marcar_gravada", `{"p_codigo":"VBMONTA001"}`, 200, `"ja_estava" : false`},
		{"cartão, quem não é do selo", "so-meta", "POST", "/vessel-baixar-cartao", `{"codigo":"VBMONTA001","face":"frente","formato":"png"}`, 403, "sem_permissao"},
		{"cartão passa o portão e para sem o Zoho", "selo", "POST", "/vessel-baixar-cartao", `{"codigo":"VBMONTA001","face":"frente","formato":"png"}`, 503, "zoho_desconectado"},
	} {
		req := httptest.NewRequest(c.metodo, c.rota, strings.NewReader(c.corpo))
		if c.quem != "" {
			req.Header.Set("Authorization", "Bearer "+quem[c.quem])
		}
		w := httptest.NewRecorder()
		h.ServeHTTP(w, req)
		if w.Code != c.status || !strings.Contains(w.Body.String(), c.tem) {
			t.Errorf("%s: %s %s = %d %s; esperava %d com %q", c.nome, c.metodo, c.rota, w.Code, w.Body, c.status, c.tem)
		}
	}
}
```

Em `api/cmd/api/conferir.go`, depois de `gatilhosDoWorker` (e `conferirDisparos, // Plano 5.10` na lista de conferências de `conferirSchema`, depois do `conferirRPC`):

```go
// conferirDisparos (Plano 5.10, Ruling 28 do mestre): a disparar_robo que vale é a da migração 00007 (grava em
// disparos_pendentes); a de produção chamava net.http_post (pg_net não existe aqui) e, restaurada por um dump não
// limpo ou fora de ordem, quebraria o cadastro da lista de espera do site (gatilho vessel_lista_espera_espelhar). E
// os 2 gatilhos que acordavam o GitHub Actions (removidos de produção em 10/10) não podem voltar: o Actions não
// alcança este banco e os robôs rodam na VPS.
func conferirDisparos(ctx context.Context, tx pgx.Tx) ([]string, error) {
	var faltam []string
	var nova bool
	if err := tx.QueryRow(ctx, `select coalesce(bool_and(prosrc like '%disparos_pendentes%' and prosrc not like '%net.http_post%'), false)
		  from pg_proc where proname = 'disparar_robo' and pronamespace = current_schema()::regnamespace`).Scan(&nova); err != nil {
		return nil, err
	}
	if !nova {
		faltam = append(faltam, "função disparar_robo: ausente ou a de produção (pg_net): rode `api migrar` (00007) e restaure com o limpar-dump.mjs atual")
	}
	linhas, err := tx.Query(ctx, `select t.tgname::text from pg_trigger t join pg_class c on c.oid = t.tgrelid
		 where not t.tgisinternal and c.relnamespace = current_schema()::regnamespace
		   and t.tgname in ('vessel_lote_novo_pede_foto', 'vessel_cartao_pedido_novo_acorda_o_robo') order by 1`)
	if err != nil {
		return nil, err
	}
	voltaram, err := pgx.CollectRows(linhas, pgx.RowTo[string])
	if err != nil {
		return nil, err
	}
	for _, g := range voltaram {
		faltam = append(faltam, "gatilho "+g+": removido de produção em 10/10 e de volta (acordaria o GitHub Actions, que não alcança o banco): derrube-o")
	}
	return faltam, nil
}

```

Em `api/cmd/api/conferir_test.go`, no fim:

```go
// Plano 5.10: contra a fatia D0 (as 12 tabelas do selo, os 6 gatilhos e as 16 RPCs) e a migração 00007, o conferir
// não acusa nada do selo nem da disparar_robo — pega erro de digitação nas listas. As 2 colunas presumidas de
// vessel_registros estão na fatia; no banco restaurado quem as confere é o `api worker conferir`.
func TestConferirNaFatiaD0NaoAcusaOPlano510(t *testing.T) {
	p := testebanco.ComEsquemaDeProducao(t)
	tabelas510 := []string{"vessel_lotes", "vessel_pecas", "vessel_registros", "vessel_baixas", "vessel_cartao_pedidos",
		"vessel_cartao_arquivos", "vessel_lembretes", "vessel_clientes"}
	for _, f := range faltamDe(t, p) {
		if strings.Contains(f, "disparar_robo") || strings.Contains(f, "disparos_pendentes") || strings.Contains(f, "vessel_") && strings.Contains(f, "gatilho") {
			t.Errorf("a fatia D0 devia satisfazer o 5.10, mas o conferir acusa %q", f)
		}
		for _, tb := range tabelas510 {
			if strings.Contains(f, " "+tb+".") || strings.Contains(f, " "+tb+"(") || strings.Contains(f, "/rpc/vessel_") {
				t.Errorf("a fatia D0 devia satisfazer o 5.10, mas o conferir acusa %q", f)
			}
		}
	}
}

// Plano 5.10: a disparar_robo de produção (pg_net) e os 2 gatilhos do Actions de volta são acusados; a da 00007, não.
func TestConferirDisparos(t *testing.T) {
	p := testebanco.Novo(t) // as migrações já trazem a 00007
	tem := func(trecho string) bool {
		for _, f := range faltamDe(t, p) {
			if strings.Contains(f, trecho) {
				return true
			}
		}
		return false
	}
	if tem("disparar_robo") || tem("vessel_lote_novo_pede_foto") {
		t.Fatal("a 00007 sozinha não pode ser acusada")
	}
	exec(t, p, `create or replace function disparar_robo(p_robo text, p_funcao text, p_segredo text, p_body jsonb default '{}'::jsonb,
		p_timeout integer default 120000) returns bigint language plpgsql as $f$
		declare v bigint; begin select net.http_post(url := 'https://x') into v; return v; end $f$`)
	exec(t, p, `create table if not exists vessel_lotes (id uuid); create function pede_foto() returns trigger language plpgsql as $f$ begin return new; end $f$;
		create trigger vessel_lote_novo_pede_foto after insert on vessel_lotes for each row execute function pede_foto()`)
	if !tem("função disparar_robo: ausente ou a de produção") || !tem("gatilho vessel_lote_novo_pede_foto: removido de produção") {
		t.Errorf("o conferir não acusou a função antiga e o gatilho de volta: %v", faltamDe(t, p))
	}
}
```

Em `docs/migracao-go/NOTAS-DA-IMPLANTACAO.md`, ao fim:

```markdown
## Plano 5.10 — Autenticidade (selo Vessel)

### Variáveis de ambiente (serviço `api`)
Nenhuma nova. O Zoho do cartão usa a conexão de `acessos_conexoes` (provedor `zoho`, a mesma da tela de Acessos e do robô de cartões); a raiz das fotos é a padrão do robô (`ZOHO_PASTA_FOTOS` nunca foi definida nas edges).

### Rotas novas
- Com sessão, regra = catálogo (`is_vessel_admin()`: o módulo `autenticidade` em `features` ou `is_superadmin` da ficha; o papel `admin` sozinho NÃO passa): `GET /autenticidade/lotes`, `/pecas` (`?codigo=A,B`), `/registros` (SEM CPF e nascimento), `/baixas` (só as ativas), `/cartao-pedidos`, `/lembretes` (sem `token_hash`).
- `POST /rpc/<nome>` para as 16 `vessel_*` do painel (portão = o da função; as 14 que gravam recusam "entrar como"; `vessel_decidir_pedido_de_registro` só com `p_quem_decidiu = "na_mao"` e sem `p_conferencia`).
- `POST /vessel-baixar-cartao` (portão do selo; prazo 60 s; "entrar como" baixa).
- `GET /fabrica/robo/material-do-sku?sku=` (só o robô da Fábrica, sessão de serviço).

### A fila `disparos_pendentes` (Ruling 28 do mestre; Rulings 5.10-1 a 5.10-3)
- A migração `00007` cria `disparos_pendentes` e troca `public.disparar_robo`: ela só grava (ou junta) um pedido pendente por robô, nunca chama rede. Quem chamava a função antiga e ainda existe no banco novo: o gatilho `vessel_lista_espera_espelhar` (cadastro da lista de espera do site). Sem a troca, todo cadastro quebrava no corte (o `pg_net` não vem).
- O restore (`ops/migracao/restaurar.sh`) roda `api migrar` ANTES do `schema.sql`: o `limpar-dump.mjs` tira a `disparar_robo` antiga do dump (contagem `substituidas` = 2: a função e o comentário). Restaurar com um dump limpo por versão anterior do script = `function already exists`, e o restore para (é o certo).
- Atendente: nenhum no 5.10. O Plano 6 atende `vessel-espelhar-lista` pela tarefa do espelho (`banco.AtenderDisparo`). Até lá os disparos se juntam num pedido pendente só (uma linha), e o espelho de 3 em 3 minutos do Plano 6 cobre.
- `disparar_robo` NÃO grava mais `robos_execucoes` (a linha de cada `net.http_post`): a saúde de cada robô vem de quem o executa.

### nginx
- `location = /api/vessel-baixar-cartao { proxy_read_timeout 70s; proxy_buffering off; proxy_pass http://127.0.0.1:8080/vessel-baixar-cartao; }` (o prazo da rota é 60 s, o padrão do nginx também; o download vem em fluxo).

### Antes do corte
- `api worker conferir` no banco restaurado: colunas e tipos do 5.10 — em especial as PRESUMIDAS `vessel_registros.nascimento` (date) e `bling_atualizado_em`, sem DDL no repositório —, os 6 gatilhos do selo ligados, as 16 RPCs pelo `conferirRPC`, a `disparar_robo` da `00007` e os 2 gatilhos do Actions AUSENTES.
- `select tgname from pg_trigger g join pg_class c on c.oid = g.tgrelid where not g.tgisinternal and c.relname like 'vessel\_%' order by 1` = os 6 do selo + `vessel_lista_espera_espelhar` + os do 5.11 (`vessel_atendimentos_atualizado`, `vessel_pessoas_atualizado`, `vessel_private_edits_funil`, `vessel_stylist*`, `vessel_rd_na_fila`). Nenhum `vessel_lote_novo_pede_foto` nem `vessel_cartao_pedido_novo_acorda_o_robo`.
- As frases e os corpos verbatim: `select md5(string_agg(prosrc, '|' order by proname)) from pg_proc where proname in (<as 35 de 03-funcoes-5-10.sql>)` no banco restaurado = o mesmo `select` num Postgres de teste com as fatias carregadas; diferente = alguém mudou a função em produção depois do levantamento: refaça o `TestPortoesIguaisAsFuncoes` com a nova antes do corte.
- No ensaio, numa transação desfeita: `insert into vessel_lista_espera (...) values (...)` (um cadastro de prova) não falha e deixa 1 pedido `vessel-espelhar-lista` em `disparos_pendentes`.
- No ensaio, o botão "Baixar" de um cartão de verdade (frente e verso, PNG e PDF) pela API: o Zoho pode redirecionar o download; o cliente segue até 3 redirecionamentos `https` (Ruling 5.10-12). Se falhar com 502 `zoho_recusou` 3xx, pare e reporte.
- A conta do robô da Fábrica (5.8) lê `GET /fabrica/robo/material-do-sku` com o token dela (um SKU com lote em canvas devolve `canvas`).

### Mudanças de contrato que o Plano 7 absorve
(ver a seção "Mudanças de contrato" do plano 5.10)

### Achados para o dono
(ver a seção "Achados para o dono" do plano 5.10)
```

Em `docs/migracao-go/API-PRONTA.md`: o **Estado** ganha "5.10"; a soma de rotas, +8 (6 leituras, o cartão, o material-do-sku) e "RPC: 17 funções registradas"; e uma seção `## Autenticidade — selo Vessel (5.10)` com uma linha por rota (o formato das outras: rota, o que substitui com arquivo:linha do inventário, portão, contrato), as 16 RPCs numa linha só (`POST /rpc/vessel_*`, com a lista, o portão e "recusas da função = 200 `{ok:false, motivo}`; portão = 403 `{"error":"sem_permissao"}`") e a linha do `material-do-sku` na seção da Fábrica.

**(b) Testes de aceitação**
- `TestNadaVazaDoSelo` (acima), `TestSeloPelaMontagemReal` (pela montagem de PRODUÇÃO: leitura sem sessão 401, de quem não é do selo `[]`, do selo com a peça; RPC registrada 403 para quem não é e `ja_estava: false` para o selo; cartão 403 para quem não é e `503 zoho_desconectado` para o selo — passou o portão e o escopo, e não há conexão no banco de teste), `TestNenhumaRotaNovaFicaAberta` e `TestPrazosPorRotaPelaMontagemReal` com as rotas novas, `TestListasDeRPCFecham` (as 16 saíram de `RPCPendentes`), `TestConferirNaFatiaD0NaoAcusaOPlano510`, `TestConferirDisparos` e os testes existentes do `conferir`.
- Mutações que têm de reprovar: `vessel.Montar` FORA do grupo com `ComEscopo` (as leituras respondem 500: `TestSeloPelaMontagemReal`); o cartão sem `autz.ComEscopo` (o portão nega a todos: o selo recebe 403); um nome do 5.10 de volta em `RPCPendentes` (a montagem recusa); `SoSessaoPropria` fora de uma das 14 (`TestNadaVazaDoSelo`); um nome errado nas listas do `conferir` (`TestConferirNaFatiaD0NaoAcusaOPlano510`); a `disparar_robo` antiga no banco (`TestConferirDisparos`).

**(c) Arquivos:** Create `api/internal/vessel/rotas.go`, `api/internal/vessel/rotas_test.go`; Modify `api/internal/web/rotas.go`, `api/internal/web/rotas_test.go`, `api/internal/web/rpc_lista.go`, `api/internal/web/rpc_lista_test.go`, `api/internal/github/github.go` (comentários), `api/cmd/api/conferir.go`, `api/cmd/api/conferir_test.go`, `docs/migracao-go/NOTAS-DA-IMPLANTACAO.md`, `docs/migracao-go/API-PRONTA.md`.

**(d) Dependências:** Tasks 3–7; `web.Rotas`, `web.FuncoesRPC`, `RPCPendentes`, `conferirRPC` (5.0).

- [ ] **Step 1:** Os testes; ver falhar (as leituras dão 404 pela montagem; o conferir não conhece o selo).
- [ ] **Step 2: Implementar** (código e trechos de (a)); `gofmt -w ./internal ./cmd`.
- [ ] **Step 3:** `cd api && gofmt -l . && go vet ./... && go test -count=1 -race ./... 2>&1 | grep -v goose | grep -E '^(ok|FAIL|---)'` → todos `ok`; mutações de (b) reprovam, uma por vez.
- [ ] **Step 4: Commit** `feat(api): monta o selo Vessel (leituras, 16 RPCs, cartão e material-do-sku), varreduras, conferir e notas` (+ `Co-Authored-By`).

---

### Verificação final do 5.10

- [ ] `docker stop pg-plano510` e `make -C api teste PG_PORTA=58550` → todos `ok` (nunca junto com o gate de outra worktree).
- [ ] Subir o `pg-plano510` de novo e `cd api && go test -count=1 -v ./... 2>&1 | grep -c -- '--- SKIP'` → `0`.
- [ ] `node --test ops/migracao/limpar-dump.test.mjs` → `pass` (15 casos).
- [ ] `cd api && gofmt -l . && go vet ./...` → nada.
- [ ] `git diff origin/main...HEAD --stat -- src/ supabase/ coletor/ db/ .github/` → vazio (front, edge e robô trocam no Plano 7; produção não muda). `ops/migracao/limpar-dump*` é a única mudança fora de `api/` e `docs/`.
- [ ] `grep -rn 'internal/github\|api.github.com' api/internal/vessel api/internal/banco` → nada (o selo não despacha nada: Ruling 5.10-2); `grep -n '"vessel_' api/internal/web/rpc_lista.go | grep -v 'proibid\|ForaDoPainel'` → só os do 5.11 (os 16 saíram de `RPCPendentes`).
- [ ] `grep -rn 'Conferir:' api/internal/vessel/*.go | grep -v _test` → `1` (só `soNaMao`: Ruling 5.10-9); `grep -c 'SoSessaoPropria: true' api/internal/vessel/rpc.go` → `2` (a de `vessel_decidir_pedido_de_registro` e a de `grava`, que vale para 13).
- [ ] `grep -rn 'client_secret\|refresh_token' api/internal | grep -v '_test.go\|zoho/zoho.go\|conferir'` → nada (o segredo do Zoho só passa pelo `internal/zoho`).
- [ ] `docker stop pg-plano510`.
- [ ] Revisão final do branch por opus com foco em: o cadastro do site no corte (a `disparar_robo` nova em TODO caminho de restore e de migração? alguma forma de ela falhar?), a fila (algum caminho atende duas vezes ou refaz o incerto?), o selo (alguma rota ou RPC alcança registro, garantia ou dona sem `is_vessel_admin`? o "entrar como" grava? o `bling` passa pelo painel?), o CPF (alguma resposta traz o CPF inteiro ou o nascimento?) e o Zoho (algum segredo em resposta, erro ou log? algum host vindo do banco?).

---

## Inventário: sítios do front a trocar (Plano 7)

`grep` em `src/ferramentas/autenticidade/` (fora de `*.test.*`) no `origin/main` de 13/10 (1694af1b; o branch deste plano tem as mesmas linhas −2 a partir da 2325, antes do `import` da área `conta`), contando `sbClient.from('<tabela>')`, `sbClient.rpc('<nome>')` e `functions.invoke('<edge>')`: **8 sítios nas 6 tabelas, 18 chamadas das 16 RPCs e 1 chamada à edge**, todos em `tela-de-autenticidade.vue` (`tela`). Nenhuma outra tela lê as 11 tabelas do selo (`tela-de-base-de-leads.vue` lê `vessel_lista_espera`, `vessel_atendimentos`, `vessel_pessoas` e `vessel_origens`: 5.11).

| Rota | Sítios (`tela:linha`, função) | Qtde |
|---|---|---|
| `GET /autenticidade/lotes` | :4148 `carregar` | 1 |
| `GET /autenticidade/pecas` | :4152 `carregar`; :4063 `atualizarAsPecas` (`?codigo=` em blocos de 100); :4073 `recarregarAsPecas` | 3 |
| `GET /autenticidade/registros` | :4153 `carregar` | 1 |
| `GET /autenticidade/baixas` | :4161 `carregar` (o `.is('desfeita_em', null)` some: a rota já filtra) | 1 |
| `GET /autenticidade/cartao-pedidos?limite=20` | :3879 `carregarAFilaDeCartoes` (relê a cada 3 s com pedido ativo) | 1 |
| `GET /autenticidade/lembretes` | :4247 `carregarLembretes` (colunas de `lembretes-do-selo.js:29-30`) | 1 |
| `POST /rpc/vessel_alertas` | :4154 `carregar` | 1 |
| `POST /rpc/vessel_fila_de_registros` | :4158 `carregar` | 1 |
| `POST /rpc/vessel_baixar_garantia` | :2831 `confirmarBaixaDeGarantia` | 1 |
| `POST /rpc/vessel_desmarcar_gravada` | :3210 `confirmarResetDaLeitura` (`desmarcarNoBanco`), :3469 `apagarGravacao` | 2 |
| `POST /rpc/vessel_decidir_pedido_de_registro` | :3718 `confirmarDecisao` | 1 |
| `POST /rpc/vessel_trocar_dono` | :3774 `confirmarTroca` | 1 |
| `POST /rpc/vessel_pedir_cartoes` | :4013 `enviarPedido` | 1 |
| `POST /rpc/vessel_gerar_lote` | :4266 `gerarLote` | 1 |
| `POST /rpc/vessel_definir_material_do_lote` | :4431 `salvarMaterial` | 1 |
| `POST /rpc/vessel_editar_lote` | :4518 `salvarEdicao` | 1 |
| `POST /rpc/vessel_excluir_lote` | :4555 `excluirLote` | 1 |
| `POST /rpc/vessel_baixar_peca` | :4582 `baixarPeca` | 1 |
| `POST /rpc/vessel_excluir_peca` | :4604 `excluirPeca` | 1 |
| `POST /rpc/vessel_desfazer_baixa` | :4621 `desfazerBaixa` | 1 |
| `POST /rpc/vessel_marcar_gravada` | :4655 `marcarGravada`, :5116 `marcarPeloGravador` | 2 |
| `POST /rpc/vessel_sobrescrever_etiqueta` | :4926 `sobrescreverEtiqueta` | 1 |
| `POST /vessel-baixar-cartao` | :3922 `buscarOArquivoDoCartao` (de `carregarAsImagensDoCartao` :3959 e `baixarOCartao` :3977); a frase sai de `cartoes-ean.js:252` `fraseDoDownloadRecusado` | 1 |

Na mesma tela, de OUTROS planos (não trocar pelo 5.10): **Plano 3** — `chamarBling`/`paginasDoBling` (`/bling-proxy`, já liberado ao módulo `autenticidade` para `produtos`) em :2873, :3622, :4378, :4384, :4398; **5.0** — `conferir-senha` em :4495 (já atrás da chave `conta` no `origin/main`); o `fetch` do `indice.json` do site público (:3865) não muda. **Robôs** (trilha C, Plano 7): `coletor/vps/cartoes-ean-vigia.sh` (o `GET rest/v1/vessel_cartao_pedidos` vira `psql -c`, com papel próprio e `EXECUTE` nas 3 `vessel_cartao_*`: INVENTÁRIO item 9), `coletor/robo-de-cartoes.mjs` e `coletor/fotos-do-selo-do-bling.mjs` (já `pg`: só a `DATABASE_URL`), `coletor/hero-ia/texto-da-garantia.mjs:42-47` (→ `GET /fabrica/robo/material-do-sku`), `.github/workflows/cartoes-ean.yml` e `fotos-do-selo.yml` (aposentar: não alcançam o banco novo, achado 1).

## Mudanças de contrato que o Plano 7 absorve

- **Leituras** → `GET /api/autenticidade/<recurso>` com as colunas da tela e a ordem de hoje. `registros` sem `cpf`, `nascimento`, `cliente_id`, `pedido_id`, `bling_contato_id`, `bling_atualizado_em`, `presente_de_nome` (a tela não os usa: lista, busca, planilha `lotes.js:391-398` e o aviso da fila `tela:1627` leem `codigo, nome, whatsapp, onde_comprou, comprado_em, garantia_ate, registrado_em, bling_pedido`). `baixas` só as ativas. `pecas?codigo=A,B` (lista por vírgula). `cartao-pedidos?limite=20`. `lembretes`: o caminho "a tabela ainda não existe" (`lembretes-do-selo.js:126`, 42P01/PGRST205) não acontece mais. Mais de 1000 peças: a lista corta no teto (achado 6).
- **RPCs** → `POST /api/rpc/<nome>` com o mesmo corpo de `sbClient.rpc`; a resposta é o mesmo objeto da função (o `json` do Postgres, com espaços). As recusas da FUNÇÃO continuam `200 {ok:false, motivo}`. A recusa do PORTÃO (quem não é do selo) vira `403 {"error":"sem_permissao"}` em vez de `200 {ok:false, motivo:'sem_permissao'}`: em `carregar` (:4192-4197) e nas ações, o 403 tem de virar o mesmo `e.recusa = 'sem_permissao'` (`fraseDaRecusa`) — senão a tela diz "confira sua conexão" para quem não tem a chave, o erro que o comentário de :4176-4186 descreve. "Entrar como" nas 14 que gravam = `403` com `mensagem: "Quem entrou como outra pessoa só consulta."` (mostrar a frase). `vessel_decidir_pedido_de_registro`: só `p_quem_decidiu: 'na_mao'` e `p_conferencia: null` (a tela já manda assim; outro valor = 403). Duas baixas da mesma peça ao mesmo tempo podem dar `409` (já davam pelo PostgREST).
- **Cartão** → `POST /api/vessel-baixar-cartao` com o mesmo corpo e as mesmas respostas `{erro}`; o 403 de quem não é do selo vem `{"error":"sem_permissao"}` (em `buscarOArquivoDoCartao`, ler `detalhe?.erro ?? detalhe?.error`); 401 de sessão no formato do núcleo; some o `Server-Timing`; o `Content-Disposition` é o do `mime` (a tela usa o próprio nome no `<a download>`). Os bytes chegam como hoje (`application/octet-stream`).
- **Robôs**: ver o inventário. A edge `vessel-baixar-cartao` sai no Plano 7 (depois de a tela trocar); as edges `vessel-fotos-trigger` e `vessel-cartoes-trigger` já não têm quem as chame desde 10/10 (aposentar).

## Paralelização

- **Uma worktree por tarefa paralela** (merge na ordem dos números). As Tasks 3, 4, 6 e 8 são o MESMO pacote Go (`vessel`): em worktrees separadas, cada uma só cria os SEUS arquivos; o mundo (`mundo_test.go`: pessoas, linhas, `fotoDoSelo`, `novoMundo`) é da Task 3 (a 4 e a 6 o usam); `montarRPCs` e `intacto` moram em `rpc_test.go` (Task 4; a 8 usa `montarRPCs`). A 7 mexe em `internal/fabrica`. Um contêiner (`pg-plano510`, porta 58550) atende todas: cada teste cria o próprio banco ou schema.
- **Onda 1:** Task 1 (`banco`, `ops/migracao`) e Task 5 (`zoho`) — paralelas, pacotes disjuntos. **Onda 2:** Task 2 (`testebanco`; o teste do espelho precisa da 00007). **Onda 3:** Task 3 (`vessel`) e Task 7 (`fabrica`) — paralelas. **Onda 4:** Tasks 4 e 6 (`vessel`, arquivos distintos; a 6 precisa da 5). **Onda 5:** Task 8 (a única que toca `web/*`, `cmd/api/conferir*.go`, `github.go` e as notas).
- **Com outros sub-planos:** o **5.9** anda em paralelo (IV.3): conflito mecânico em `web/rotas.go` (uma linha de `FuncoesRPC` e uma de `Montar` cada), `web/rotas_test.go` (`rotas59`/`rotas510` e o `init`), `web/rpc_lista.go` (cada um tira o SEU bloco de `RPCPendentes`), `esquema_test.go` (a lista de gatilhos: `conteudo_pecas_guarda` + os 6), `cmd/api/conferir*.go` (a fixture de `web.FuncoesRPC` é UMA: quem mescla por último não duplica) e as notas; quem mescla por último junta e roda o gate. O **5.11** não redeclara as 12 tabelas nem as funções do 5.10 (Interfaces que este plano entrega) e cria na fatia dele `vessel_lista_espera`, `vessel_pedidos` e o gatilho `vessel_lista_espera_espelhar` (a função `vessel_espelhar_agora` já está no `03-funcoes-5-10.sql`). Quem regerar o `02-gatilhos.sql` com `CONFERIDOS` (5.2/5.3) confere as 8 entradas da Task 2 (Step 4). O **5.4** declara `acessos_conexoes`: os testes do 5.10 a criam com `if not exists`. A migração `00007` é a próxima livre hoje: quem entrar antes com outra 00007 empurra esta (pré-voo). O **Plano 6** consome `banco.AtenderDisparo` e `internal/zoho`. Gates (`make teste`, contêiner fixo `pg-api-teste`) nunca ao mesmo tempo.

## Rulings do 5.10

1. Ruling: `disparar_robo` vira `insert … on conflict do update` em `disparos_pendentes` (um pedido pendente por robô; os disparos se juntam), na migração goose `00007` com `create or replace` e `set search_path from current`, sem `revoke`, e a versão de produção sai do dump pela regra `substituidas` do `limpar-dump.mjs` — o `pg_net` não vai para o Postgres novo e `vessel_espelhar_agora` não trata erro (o cadastro da lista de espera quebraria); o "versão na camada de compatibilidade" do Ruling 28 colidiria do mesmo jeito com o `CREATE FUNCTION` do dump (a compat e o `migrar` rodam ANTES do schema no `restaurar.sh`), e a função é de domínio, com Down, não um "o que o Supabase oferecia" — custo se errada: o corpo de um disparo que se junta a um pendente se perde (servia só ao registro da edge), e um restore com dump limpo pela versão antiga do script falha alto (`function already exists`, `ON_ERROR_STOP`).
2. Ruling: SEM tarefa de despacho no 5.10 e SEM `internal/github` (o mestre previa despachar `vessel-fotos-trigger`/`vessel-cartoes-trigger` ao GitHub) — em produção os 2 gatilhos que chamavam essas edges foram REMOVIDOS em 10/10 (`2026-10-10-robos-na-vps-sem-gatilho-do-actions.sql`: rodariam em dobro com a VPS), os robôs olham a fila sozinhos na VPS (fotos a cada 5 min; cartões a cada 10 s) e o runner do Actions não alcança o `api-db`; o único chamador vivo é `vessel_espelhar_agora`, cujo atendente é o espelho do Plano 6 — custo se errada: se alguém religar os dois gatilhos, os pedidos ficam pendentes (um por robô) sem atendente, e os robôs da VPS continuam pegando lote e cartão no tempo deles (o `conferir` acusa os gatilhos de volta).
3. Ruling: `banco.AtenderDisparo` é o contrato da fila — pega no máximo UM pendente por chamada (`for update skip locked`, autocommit: dois atendentes nunca pegam o mesmo), grava o resultado com contexto próprio, `atendendo` de mais de 30 min vira `incerto` e NUNCA roda de novo sozinho, falha vira `falhou` sem repetição (o próximo disparo abre outro pendente), faxina de 30 dias na mesma chamada — uma fila que repete sozinha despacharia duas vezes o que não é idempotente; o espelho do Plano 6 se cura sozinho e tem agenda própria — custo se errada: a falha de um atendimento só se cura no próximo disparo ou na agenda do atendente.
4. Ruling: D0 = fatia reconstruída das migrations (12 tabelas: as 11 do catálogo + `vessel_cartao_arquivos`), com 2 colunas presumidas de `vessel_registros` (sem DDL no repositório), os 6 gatilhos vivos com OF/WHEN das migrations e 35 funções VERBATIM do levantamento por script e hash; os 2 gatilhos removidos em 10/10 ficam fora; `vessel_lista_espera`, `vessel_pedidos` (5.11) e `acessos_conexoes` (5.4) não são declaradas — os portões, as frases e os efeitos têm de ser os de PRODUÇÃO; o levantamento é de 09/10 e a remoção de 10/10 está numa migration aplicada (`REVISAO-CORE/06-central.md:108`) — custo se errada: função ou coluna mudada em produção depois do levantamento só aparece no `conferir` e no `md5(prosrc)` do "Antes do corte".
5. Ruling: `vessel_edicoes` (a trilha) é do 5.10, não do 5.11 como a IV.2 lista — a policy é `is_vessel_admin()` e só as funções do selo escrevem nela; as "edições" do 5.11 são as do Stylist Circle (`vessel_edicao_*`, outra tabela) — custo se errada: nenhum (sem rota: as funções leem e escrevem a trilha).
6. Ruling: 6 rotas de leitura, uma por leitura da tela; `vessel_clientes`, `vessel_leituras`, `vessel_garantias_baixadas`, `vessel_pedidos_de_registro` e `vessel_edicoes` ficam SEM rota (a tela não as lê direto: as RPCs leem, e a regra continua compilada no catálogo) — leitura nova = uma `dados.Consulta` — custo se errada: uma tela nova que leia essas tabelas pede rota.
7. Ruling: `GET /autenticidade/registros` não manda `cpf`, `nascimento` nem os vínculos (`cliente_id`, `pedido_id`, `bling_contato_id`, `bling_atualizado_em`, `presente_de_nome`); `/lembretes` não manda `token_hash`; `/lotes` manda TODAS as colunas — a tela não usa os primeiros (e mascara o CPF na fila de propósito: `vessel_fila_de_registros`); o `select('*')` de hoje entrega CPF e nascimento de toda dona a quem tem a chave (achado 3); a busca universal varre o lote inteiro — custo se errada: tela que precise do CPF inteiro pede rota com Ruling.
8. Ruling: portão das 16 RPCs = `autz.VesselAdmin` (provado pessoa a pessoa: `TestPortoesIguaisAsFuncoes`), com o 403 do núcleo `{"error":"sem_permissao"}` em vez do `200 {ok:false, motivo:'sem_permissao'}` da função — o registro do 5.0 é um só para todos os domínios e nega antes da função; a função continua respondendo assim se o portão do Go um dia divergir; na decisão de registro a função valida o estado ANTES do portão, e a API devolve 403 onde ela devolveria `estado_invalido` (nada grava nos dois) — custo se errada: a tela muda um ramo de erro (Plano 7).
9. Ruling: sem `Conferir` de alvo nas RPCs — o selo é global (nenhuma policy recorta por loja, conta ou dono: quem é do selo mexe em toda peça) e cada função confere a existência e o estado do que recebe na própria transação; só a decisão de registro ganha conferência (Ruling 10) — custo se errada: nenhum enquanto o catálogo não recortar o selo; se um dia recortar, cada RPC ganha o `Conferir` do recorte.
10. Ruling: `vessel_decidir_pedido_de_registro` pelo painel só com `p_quem_decidiu = "na_mao"` e sem `p_conferencia` (`Conferir: soNaMao`, 403 sem a função rodar) — a trava de `bling` da função lê `current_setting('role')`/`auth.role()` do Supabase (na compat nega a todos), e a conferência vinda do painel gravaria `bling_pedido`/`bling_contato_id` de outra venda no registro da dona (a trava "pedido já usado" e o espelho do Bling os usam) — custo se errada: nenhum para a tela (ela manda `na_mao` e `null`); a aprovação automática fica com o Plano 6 (achado 2).
11. Ruling: `SoSessaoPropria` nas 14 RPCs que gravam; `vessel_alertas`, `vessel_fila_de_registros`, as 6 leituras e o cartão ficam abertos ao "entrar como" — ver o que a pessoa vê; a fila e as leituras não trazem CPF inteiro — custo se errada: o super-admin que entrou como alguém do selo vê a fila de registros (com o CPF mascarado), como a pessoa.
12. Ruling: `POST /vessel-baixar-cartao` mantém o contrato da edge (corpo, `{erro}`, status) com o portão do selo no handler, prazo próprio de 60 s fora do grupo de domínio e o Zoho pelo servidor, SEM os caches de listagem da edge (o caminho comum é o id gravado pelo robô; a busca é o resgate), seguindo até 3 redirecionamentos `https` — o `fetch` da edge seguia redirecionamento (o download do WorkDrive pode mudar de host) e o Go tira o `Authorization` quando o domínio muda, como o `fetch` — custo se errada: o resgate leva ~7 s como antes dos caches; se o Zoho redirecionar para um host que exige o token, o download falha com 502 (o "Antes do corte" testa um cartão real).
13. Ruling: o cliente `internal/zoho` é mínimo (conexão, token, listar, baixar) e só ele lê os segredos de `acessos_conexoes`; `data_center` de lista fechada; token em memória por processo (`ponytail:`) — um cliente só para os segredos do Zoho, que o Plano 6 estende (espelho, acessos) em vez de escrever outro — custo se errada: com várias instâncias da API, cada uma pede o seu token (o Zoho limita renovações; guardar no banco se incomodar).
14. Ruling: `GET /fabrica/robo/material-do-sku` (contrato do Ruling 5.8-13) mora em `internal/fabrica`, no grupo de robô, e só lê `vessel_lotes` (declarada pelo 5.10) — entra sozinho nas varreduras de robô do 5.8 — custo se errada: as varreduras do 5.8 contam 10 leituras e 8 rotas de robô (ajustadas na Task 7).
15. Ruling: paridade nas regras do selo que o dono pode querer mudar — o papel `admin` sem o módulo não vê o selo; a senha de "excluir lote"/"baixar garantia"/"apagar gravação" é só da tela; qualquer pessoa do selo troca a dona, baixa a garantia e aprova registro — a migração não muda regra de negócio (spec §1) — custo se errada: nenhum além do de hoje (achados 4 e 5).

## Achados para o dono

1. **O plano-mestre (Ruling 28) previa acordar os robôs do selo pelo GitHub; não há o que acordar.** Os 2 gatilhos que chamavam `vessel-fotos-trigger` e `vessel-cartoes-trigger` foram removidos em 10/10 (rodariam em dobro com a VPS), e o GitHub Actions não alcança o banco novo. Os workflows `cartoes-ean.yml` e `fotos-do-selo.yml` (retaguardas manuais) param de funcionar no corte: aposentar no Plano 7. O único disparo vivo é o do cadastro da lista de espera, que o 5.10 deixa na fila para o espelho do Plano 6.
2. **A aprovação automática de garantia (`bling`) vai parar no corte se o Plano 6 não tratar.** A trava da função exige o papel `service_role` do Supabase (`current_setting('role')`); no banco novo ninguém o tem, então a edge `vessel-registrar-garantia` portada vai receber "sem permissão" e todo registro vai para a fila manual. Decisão do Plano 6 (trilha A): dar à rota pública o papel na transação (`set local role` + `app.papel_db`) ou trocar a trava da função (mudança em produção, decisão sua).
3. **A tela de Autenticidade recebe hoje o CPF inteiro e a data de nascimento de todas as donas** (`select('*')` em `vessel_registros`), embora mascare o CPF na fila de propósito. Ninguém usa esses campos na tela. A API não os manda.
4. **A senha pedida em "excluir lote", "baixar garantia" e "apagar gravação" é só da tela:** o banco não a exige, e quem tem a chave chama a função direto. Mantido (paridade). Se quiser a senha valendo de verdade, ela entra na rota (decisão sua).
5. **Papel `admin` sem a chave "Autenticidade" não vê nem mexe no selo** (a regra olha o módulo e o super-admin, não o papel). Mantido.
6. **A lista de peças é lida inteira sem paginar:** passando de 1000 peças (o teto do Supabase e da API), as mais novas somem da tela em silêncio. Eram ~340 em 09/10 (174 lotes). No Plano 7 a tela lê por lote ou pagina.
7. **Duas colunas de `vessel_registros` (`nascimento`, `bling_atualizado_em`) existem em produção sem migration no repositório.** O `conferir` as confere no banco restaurado.
8. **Duas baixas da mesma peça ao mesmo tempo dão erro técnico (409) para a segunda** (a função confere e depois grava; o índice segura). Já é assim hoje; a peça fica baixada uma vez só.

## Cobertura da spec e o que vem depois

**As 11 tabelas do selo (11 policies `is_vessel_admin()`, todas só SELECT) e `vessel_cartao_arquivos`:**

| Tabela | Policy | Destino |
|---|---|---|
| `vessel_lotes` | `vessel_lotes_read`; gatilhos marcar teste, herdar e recalcular material | Task 2 (D0, gatilhos), Task 3 (`/autenticidade/lotes`), Task 4 (gerar, editar, excluir, material), Task 7 (`material-do-sku`) |
| `vessel_pecas` | `vessel_pecas_read` | Task 3 (`/autenticidade/pecas`), Task 4 (marcar, desmarcar, sobrescrever, excluir, baixar), Task 6 (cartão) |
| `vessel_registros` | `vessel_registros_read`; gatilhos `cliente_id` e lembrete | Task 2, Task 3 (sem CPF), Task 4 (decidir, trocar dona, baixar garantia) |
| `vessel_baixas` | `vessel_baixas_read` | Task 3 (só ativas), Task 4 (baixar, desfazer, sobrescrever; corrida) |
| `vessel_cartao_pedidos` | `vessel_cartao_pedidos_read` | Task 3, Task 4 (`vessel_pedir_cartoes`), Task 6 (a dica do dia); o robô da VPS em `pg` (sem rota) |
| `vessel_lembretes` | `vessel_lembretes_read` | Task 3 (sem `token_hash`), Task 2/4 (morre com o registro) |
| `vessel_clientes` | `vessel_clientes_read`; gatilho `atualizado_em` | Task 2 (sem rota: Ruling 5.10-6) |
| `vessel_garantias_baixadas` | `vessel_garantias_baixadas_read` | Task 4 (`vessel_baixar_garantia`; sem rota) |
| `vessel_leituras` | `vessel_leituras_read` | Task 4 (`vessel_alertas`; sem rota) |
| `vessel_pedidos_de_registro` | `vessel_pedidos_registro_read` | Task 4 (`vessel_fila_de_registros`, decidir; sem rota) |
| `vessel_edicoes` | `vessel_edicoes_read` | Task 2 (lista fechada), Task 4 (a trilha de cada função; sem rota) |
| `vessel_cartao_arquivos` | (fora do catálogo: só o robô grava) | Task 6 (o id gravado) |

RPC: as 16 (Task 4), que saem de `RPCPendentes` (Task 8). Edge: `vessel-baixar-cartao` (Task 6). Gatilhos: os 6 vivos (Task 2; a linha da IV.2 contava 8: Ruling 5.10-4). `disparar_robo` sem `pg_net` (Task 1, Ruling 28). O contrato do 5.8 (`material-do-sku`, Task 7). Os `db/*.test.mjs` de registro portados por comportamento (Task 2 e Task 4); os de transferência pela dona são do Plano 6. Spec §5 (catálogo, ator × operação × recurso pela cadeia real), §6 (funções do banco com portão provado contra a função verbatim; a função de domínio que dependia de extensão do Supabase reescrita em SQL atrás de fila), §8 (fila do worker com garantias de entrega), §9 (workstreams 3, 4 e 7), §11 (segredo do Zoho só no servidor; CPF fora da resposta; impersonação sem escrita), §13 (negados sem efeito, varreduras de toda rota e função, concorrência da fila e da baixa).

**O que vem depois:**
- **Plano 6 (trilha A):** a tarefa do espelho da lista (`vessel-espelhar-lista`) atende a fila por `banco.AtenderDisparo`; a aprovação automática de garantia (achado 2); `internal/zoho` estendido; as rotas públicas da Vessel (`vessel_transferencia_*`, `vessel_registrar_como_cliente`…).
- **Plano 7 (trilha C):** os 27 sítios da tabela do inventário; o vigia dos cartões em `psql`; a pílula da Fábrica pela rota nova; aposentar os 2 workflows e as 3 edges (`vessel-baixar-cartao` depois da troca; `vessel-fotos-trigger` e `vessel-cartoes-trigger` já sem chamador).
- **5.11:** declara `vessel_lista_espera` (com o gatilho do espelho), `vessel_pedidos` e as funções dele; não redeclara as do 5.10.
- **Antes do corte:** `api worker conferir`, o `md5` das 35 funções, o cadastro de prova na lista de espera, o download de um cartão real e o `material-do-sku` com o token do robô (NOTAS).
