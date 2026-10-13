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
