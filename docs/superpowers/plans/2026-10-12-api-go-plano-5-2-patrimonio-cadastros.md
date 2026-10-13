# Sair do Supabase — Plano 5.2: Patrimônio e cadastros compartilhados

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **Execute na worktree `p5-52`** (branch `feat/api-go-plano-5-2`, empilhada sobre `feat/api-go-plano-5-1` = sub-plano 5.1, que está sobre `feat/api-go-dominios` = Plano 5.0). Faça `git add` só dos caminhos de cada task. Este plano contrata sobre as **interfaces** do 5.0 (plano-mestre, Tasks 1–10, com as correções das revisões das Tasks 5 e 6) e do 5.1 (Tasks 1–3), não sobre o código deles: o pré-voo confere que elas existem com esses nomes.

**Goal:** Trocar os 49 acessos diretos do front às 9 tabelas do Patrimônio e às 5 RPCs do cadastro rápido e da ligação carro ↔ bem por 30 rotas da API em Go e 5 entradas na lista branca de `/rpc`, decidindo com as MESMAS regras das 20 policies de produção — o escopo por time de `pode_ver_bem` nos bens e "a posse segue o bem" —, com os 3 gatilhos do bem e os 5 do carro rodando verbatim e vendo quem pede.

**Architecture:** Um pacote de domínio `internal/patrimonio`, montado no grupo de domínio do 5.0 (`auth.Exigir` → `autz.ComEscopo`). Leitura = `dados.Consulta` (gramática do 5.0; nomes embutidos por `left join` com marcador). Escrita = o caminho declarado do 5.1 (`dados.Tabela` + `RotaCriar/RotaEditar/RotaApagar`), que ganha `CriarSoLegivel` (Task 2); os lotes e a configuração têm handler próprio que passa pelo MESMO `Tabela.Editar/Apagar/Criar` (portanto pelo `PodeX`) dentro de UMA transação `banco.ComUsuario`. RPC pelo registro do 5.0, que ganha `SoSessaoPropria`. Os testes rodam contra a fatia 5.2 do D0 (patrimônio das migrations, frota e cadastro de pessoas mínimos, gatilhos com o `UPDATE OF`/`WHEN` das migrations e as 5 RPCs verbatim), ensaiada num Postgres 17 durante a escrita deste plano.

**Tech Stack:** Go 1.26 (`go.mod`), `chi`, `pgx` v5, `goose`, Postgres 17 (contêiner), Node 22 (só o gerador de gatilhos).

**Spec:** `docs/superpowers/specs/2026-10-09-sair-do-supabase-design.md` (§5 autorização, §11 segurança, §13 testes), o plano-mestre `docs/superpowers/plans/2026-10-11-api-go-plano-5-dominios.md` (§II contrato, IV.1 regras de sub-plano, linha 5.2 da IV.2, nota "As 107 da categoria F" da I.2: o 5.2 tem 5 RPCs registráveis; Rulings 1–36) e o plano 5.1 `docs/superpowers/plans/2026-10-12-api-go-plano-5-1-admin-equipes-acesso.md` (Rulings 5.1-1 a 5.1-14). Especificação das permissões: `docs/migracao-go/catalogo-policies-producao.json` (as 20 policies de `patrimonio_*`).

## Global Constraints

- Nada em produção: sem `ssh`, sem credencial real, sem `push`. Postgres local descartável; segredos de teste inventados.
- Regra de cada tabela = a do catálogo (`autz.Producao`); regra de cada RPC = a checagem que a função faz por dentro; corpo de gatilho e de função = o de produção (verbatim). Divergência só por Ruling deste plano.
- Negar por padrão. Todo portão tem o lado negado assertado **com o efeito** (nada gravado/apagado, conferido no banco).
- IDOR: lista com linha alheia = `[]`/linha ausente; escrita em linha invisível = `404`; `403` para linha visível sem permissão, para mudança que leva a linha para fora do que a pessoa vê e para criação do que ela não veria (Ruling 5.2-2).
- **Toda rota ganha teste de vazamento com pessoa restrita (trava de time ou sem módulo) pelo handler real**, na mesma cadeia `auth.Exigir` → `autz.ComEscopo` da produção.
- **O mapa de escrita sai da MESMA struct que monta o INSERT/UPDATE** (`dados.Campos` da struct de `json.RawMessage`); **`PodeX` roda dentro da MESMA transação `banco.ComUsuario` que grava** (inclusive nos lotes).
- SQL: todo parâmetro com cast explícito; nada do pedido no texto do SQL (tabela, lista de colunas e ordens fixas na rota).
- Autoria vem da sessão (`patrimonio_log.quem`), nunca do corpo. Sessão de "entrar como" só lê (Ruling 5.2-3).
- Sem dependência nova; `go.mod` fica em `go 1.26.0`.
- Gate: `make -C api teste PG_PORTA=58537` com `--- SKIP` = 0; `gofmt -l` e `go vet` limpos. O alvo `teste` usa o contêiner de nome fixo `pg-api-teste`: não rode o gate junto com outra worktree.
- Commits terminam com `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>` (o modelo que implementa). Código, comentários e mensagens em português com acentuação; frases copiadas da tela ou de função do banco ficam como estão.
- `go` roda em `api/`; `git` e `node` na raiz da worktree.

## Review Focus

1. **Pessoa com trava de time lendo ou gravando bem/posse de outro time** (por id, por filtro `pessoa_id`/`bem_id`, ou dentro de um lote) → `[]`/404, nada gravado; a do próprio time e a "pela mão" (`acessos_pessoas.profile_id`) passam. Testes: `TestBensLeitura`, `TestBensEscrita` (Task 4), `TestPosses` (Task 6), `TestBensEmMassa` (Task 5).
2. **Criar o que não se verá** (bem em local de outro time, item sem local nem pessoa com trava, posse de bem alheio, referência que não existe) → 403 igual nos três casos, nada gravado, sem oráculo de existência. Testes: `TestCriarSoLegivel` (Task 2), `TestBensEscrita` (Task 4), `TestPosses` (Task 6).
3. **Lote com um id alheio no meio** (`em-massa`, `apagar-em-massa`) → 404 e NENHUM bem nem posse mudado, inclusive os ids processados antes. Teste: `TestBensEmMassa` (Task 5).
4. **Bem ligado a carro mudando situação/responsável pela API** → quem decide são os gatilhos verbatim (a situação segue a frota; o responsável espelha no carro; carro sem responsável fecha a posse aberta dele — e SÓ nesse caso, pelo `WHEN`), e a resposta traz a linha depois dos gatilhos. Testes: `TestFatiaDoPatrimonioComGatilhosVerbatim` (Task 1), `TestBensEscrita` (Task 4), `TestBensEmMassa` (Task 5).
5. **Sessão de "entrar como" chamando escrita de tabela ou RPC que grava** → 403 sem efeito; as RPCs que só leem continuam 200. Testes: `TestSoSessaoPropria`, `TestRPCSoSessaoPropria` (Task 2), `TestEscritasRecusamImpersonado` (Task 10).

---

## Interfaces do 5.0 e do 5.1 que este plano consome

(Dos planos; o pré-voo confere cada uma. Nome diferente só de campo/função: use o real em todo o plano. Semântica diferente: **pare e reporte**.)

**Do 5.0 (plano-mestre e revisões das Tasks 5 e 6 no ledger `.superpowers/sdd/2026-10-11-api-go-plano-5-dominios/progress.md`):**
- `dados.Consulta{Tabela, Alias, SQL, Onde string; Filtros []Filtro; Ordens map[string]string; OrdemPadrao, Desempate string}`; `Handler(b, cat)` chama `Validar` e dá `panic` na montagem. **Gramática permitida**: a principal UMA vez, como 1º item do `from`; só `join`/`left join` com `on`, tabela do catálogo com alias e o marcador `{ler:<tabela>:<alias>}` como termo de `and` na condição (precedido de `on`/`and`/`where`/`(` e seguido de `and`/`)`); um alias por tabela; sem subconsulta no `from`, sem `where`/`order`/`limit` no nível 0; cada condição de filtro entra entre parênteses.
- `dados.Filtro{Param, SQL, Tipo}` (`texto | uuid | inteiro | data | instante | booleano`, com `[]` = lista; cast explícito compatível: `inteiro` só `bigint`).
- `dados.LerCorpo` (ponteiro para struct; campo não declarado = 400 `corpo_invalido`), `dados.Erro`, `dados.ErroDoBanco` (RAISE de função com frase: P0001/22023/23514 → 400 `regra_de_negocio`, 42501 → 403 `sem_permissao`, P0002 → 404, sempre com `mensagem`; 23505/23503 nativos → 409 `conflito`; outros 22xxx/23xxx → 400 `pedido_invalido`), `dados.ErroDeEscrita` (`ErrNaoEncontrado` → 404, `ErrNegado` → 403, `ErrDeclaracao` → 500).
- `autz.Producao`; `autz.Escopo{ID, TemPerfil, Ativo, Papel, SuperFicha, Modulos, SemTrava, Locais, Pessoas, ...}`; `autz.CarregarEscopo`, `EscopoDo`, `NoContexto`, `ComEscopo`; `autz.Ler, Criar, Editar, EditarNova, Apagar`; `(*Catalogo).Filtro`, `PodeCriar` (exige como chave toda coluna que a regra de Criar lê), `PodeEditar`/`PodeApagar` (travam a linha; invisível = `ErrNaoEncontrado`); `autz.Conferir`; `autz.ErrNegado`, `ErrNaoEncontrado`, `ErrDeclaracao`; `autz.Regra`, `autz.PodeCadastrarPessoaRapida`, `autz.FrotaAdmin`, `autz.PatrimonioAdmin`.
- `auth.Ator{ID, Tipo string; ImpersonadorID *string}`, `AtorDoContexto`, `NoContexto`, `Exigir`, `NovoStore`, `(*Store).Criar(ctx, id, tipo, impersonadorID)`, `NovoLimitador`.
- `banco.ComUsuario(ctx, p, id, fn)` (`fn` com erro = rollback).
- `rpc.Funcao{Nome; Params []rpc.Param; Retorno; Portao autz.Regra}`, `rpc.Param{Nome, Tipo; Opcional}`, `rpc.Valor/Conjunto/Nada`, `rpc.Novo` (recusa a lista proibida), `(*Registro).ServeHTTP` (nome → portão → parâmetros → `ComUsuario`; `Conjunto` com teto de 1000).
- `web.Rotas(p, s, lim, cfg)` com o grupo de domínio; `web.FuncoesRPC`, `RPCPendentes`, `RPCForaDoPainel` e o teste que exige `nomes(FuncoesRPC) ∪ RPCPendentes` = as 92 (requisitos da Task 10 do mestre); mapas `publicas`/`soSessao` de `web/rotas_test.go`.

**Do 5.1:**
- `testebanco.ComEsquemaDeProducao(t)`; `api/internal/testebanco/esquema/01-tabelas-5-1.sql`, `gerar-gatilhos.mjs`, `02-gatilhos.sql`; `TestEsquemaDeProducaoComOsGatilhosVerbatim`.
- `dados.Tabela{Nome, Resposta, Autor string}` com `Validar`, `Criar`, `Editar`, `Apagar` e o `devolver` interno; `dados.Campos`, `dados.RotaCriar[C]`, `RotaEditar[C]`, `RotaApagar`, `dados.Responder`.
- `acesso.soSessaoPropria` (`acesso/acesso.go`) e o mundo `acesso/mundo_test.go` (`pessoas`, `linhasDoMundo`, `fotoDoMundo`, `mundo{p, h, tok}`, `novoMundo`, `resposta/pedir/um/rodar`, `caso`).

## Pré-voo (antes da Task 1)

- [ ] `cd /Users/gabrielgertrudes/Projetos/Trabalho/lavessel/social-dashboard/.claude/worktrees/p5-52 && git status --short && git branch --show-current` → só este plano (ou vazio); `feat/api-go-plano-5-2`.
- [ ] Trazer o 5.1 executado (que já traz o 5.0): `git merge --no-edit feat/api-go-plano-5-1`. Conferir:
  ```bash
  grep -c 'func (t Tabela) Criar\|func RotaCriar\|func (t Tabela) devolver' api/internal/dados/escrita.go   # 3
  grep -c 'func ComEsquemaDeProducao' api/internal/testebanco/esquema.go                                    # 1
  test -f api/internal/testebanco/esquema/gerar-gatilhos.mjs && head -4 api/internal/testebanco/esquema/02-gatilhos.sql | grep -c 'Funções (7)'  # 1
  grep -c 'func soSessaoPropria' api/internal/acesso/acesso.go                                              # 1
  grep -c 'func novoMundo' api/internal/acesso/mundo_test.go                                                # 1
  grep -c 'PodeCadastrarPessoaRapida\|PatrimonioAdmin \|FrotaAdmin ' api/internal/autz/predicados.go       # ≥ 3
  grep -c 'ErrDeclaracao' api/internal/autz/escrita.go                                                      # ≥ 1 (PodeCriar exige as colunas da regra)
  grep -c '"23514"' api/internal/dados/dados.go                                                             # 1 (frase dos RAISE)
  grep -c 'type Funcao struct' api/internal/rpc/rpc.go                                                      # 1
  grep -c 'RPCPendentes' api/internal/web/*.go                                                              # ≥ 1
  ```
  Qualquer `0`: o 5.0/5.1 não terminou — **pare e reporte**.
- [ ] Sem ciclo de pacotes para a Task 2: `cd api && go list -deps ./internal/auth | grep -c internal/dados` → `0` (o `auth` não importa `dados`; senão `dados.SoSessaoPropria` não pode importar `auth`: **pare e reporte**).
- [ ] `go version` → `go1.26`+; `node --version` → `v22`+.
- [ ] Levantamento (fonte do gerador, fora do git):
  ```bash
  L=/Users/gabrielgertrudes/Projetos/Trabalho/lavessel/social-dashboard/.claude/worktrees/levantamento-ro/docs/migracao-go/levantamento
  test -f "$L/02-funções.csv" && test -f "$L/03-triggers.csv" && echo ok
  ```
- [ ] Docker no ar, porta livre (`lsof -iTCP:58537 -sTCP:LISTEN` → vazio) e o banco das etapas:
  ```bash
  docker run -d --rm --name pg-plano52 -e POSTGRES_PASSWORD=x -p 127.0.0.1:58537:5432 postgres:17
  until docker exec pg-plano52 pg_isready -h 127.0.0.1 -U postgres >/dev/null 2>&1; do sleep 1; done
  export TEST_DATABASE_URL='postgres://postgres:x@localhost:58537/postgres?sslmode=disable'
  ```
- [ ] Linha de base: `cd api && go test ./... && go test -v ./... 2>&1 | grep -c -- '--- SKIP'` → tudo `ok` e `0`.

## Estrutura de arquivos

```
api/internal/testebanco/esquema/01-tabelas-5-2.sql   # DDL da fatia 5.2 (+ "-- funções:" das RPCs)
api/internal/testebanco/esquema/gerar-gatilhos.mjs   # (mod.) funções pedidas + CONFERIDOS (UPDATE OF/WHEN das migrations)
api/internal/testebanco/esquema/02-gatilhos.sql      # (regerado) 26 funções, 14 gatilhos
api/internal/testebanco/esquema_test.go              # (mod.) lista de gatilhos esperada
api/internal/testebanco/esquema_patrimonio_test.go   # gatilhos do bem e do carro e RPCs, verbatim, com identidade
api/internal/testebanco/mundoteste/mundoteste.go     # o mundo de teste das rotas (extraído do 5.1)
api/internal/testebanco/mundoteste/mundoteste_test.go
api/internal/dados/escrita.go                        # (mod.) Tabela.CriarSoLegivel
api/internal/dados/criar_so_legivel_test.go
api/internal/dados/sessao.go, sessao_test.go         # SoSessaoPropria, FraseEntrarComo
api/internal/rpc/rpc.go                              # (mod.) Funcao.SoSessaoPropria
api/internal/rpc/sessao_test.go
api/internal/acesso/acesso.go, mundo_test.go         # (mod.) usam dados.SoSessaoPropria e mundoteste
api/internal/patrimonio/patrimonio.go                # doc, soSessaoPropria, deve, texto, textoOuNulo
api/internal/patrimonio/mundo_test.go                # pessoas, linhas, fotoDoMundo, novoMundo, ajudantes
api/internal/patrimonio/patrimonio_test.go           # TestMundoDoPatrimonio
api/internal/patrimonio/bens.go       (+ _test)      # GET/POST/PATCH/DELETE /patrimonio/bens
api/internal/patrimonio/massa.go      (+ _test)      # POST /patrimonio/bens/em-massa e /apagar-em-massa
api/internal/patrimonio/posses.go     (+ _test)      # GET/POST/PATCH /patrimonio/posses
api/internal/patrimonio/cadastros.go  (+ _test)      # empresas, locais, comodos, categorias, tipos
api/internal/patrimonio/config.go     (+ _test)      # GET/PUT /patrimonio/config, POST /patrimonio/log
api/internal/patrimonio/rpc.go        (+ _test)      # FuncoesRPC (5), FrotaOuPatrimonio
api/internal/patrimonio/rotas.go      (+ _test)      # Montar; varredura do impersonado
api/internal/web/rotas.go, rotas_test.go             # montagem, FuncoesRPC, RPCPendentes, listas, montagem real
api/cmd/api/conferir.go                              # colunas, tipos, único e funções que as rotas presumem
docs/migracao-go/NOTAS-DA-IMPLANTACAO.md             # seção do 5.2
```

## Tarefas

| # | Task | Revisor | Depende de |
|---|---|---|---|
| 1 | D0: fatia 5.2 do esquema (gatilhos com `UPDATE OF`/`WHEN`, RPCs verbatim) | **opus** (dados: é contra isto que a autorização é provada) | 5.1 |
| 2 | Fundação: `CriarSoLegivel`, `SoSessaoPropria` em `dados` e em `rpc` | **opus** (autorização: toda criação e toda RPC passam aqui) | 5.1 |
| 3 | Mundo de teste compartilhado (`mundoteste`) e o mundo do Patrimônio | **opus** (autorização: a matriz de todas as rotas roda nele) | 1, 2 |
| 4 | Bens: `GET/POST/PATCH/DELETE /patrimonio/bens` | **opus** (escopo por time, IDOR, gatilhos) | 2, 3 |
| 5 | Bens em massa: alterar (com a posse) e apagar | **opus** (dados: atomicidade, IDOR em lote) | 4, 6 |
| 6 | Posses: `GET/POST/PATCH /patrimonio/posses` | **opus** ("a posse segue o bem") | 2, 3 |
| 7 | Cadastros: empresas, locais, cômodos, categorias, tipos | sonnet (regra só de ator, sem linha) | 2, 3 |
| 8 | Configuração e log | **opus** (upsert com a regra escrita à mão; autoria) | 2, 3 |
| 9 | RPCs: cadastro rápido e ligação carro ↔ bem | **opus** (portões, escrita por função SECURITY DEFINER) | 2, 3 |
| 10 | Montagem, `conferir`, notas e varredura do impersonado | **opus** (fronteira) | 4–9 |

---

### Task 1: D0 — fatia 5.2 do esquema de produção nos testes

**Revisor:** opus. **Depende de:** 5.1 (Task 1).

**(a) Contrato**
- `esquema/01-tabelas-5-2.sql` (abaixo): as 9 tabelas do Patrimônio **completas** (das migrations), `acessos_setores`, `frota_veiculos` e `frota_uso` **mínimas** (o que os gatilhos e as RPCs leem e gravam; os donos, 5.4 e 5.3, completam com `alter table … add column` no `01-tabelas-5-N.sql` deles, NUNCA com outro `create table`), `acessos_pessoas` ampliada por `alter` (é mínima no 5.1) e as FKs de `equipes` que o 5.1 deixou para cá. A linha `-- funções: …` pede ao gerador as 5 RPCs verbatim.
- `gerar-gatilhos.mjs` passa a (i) incluir as funções das linhas `-- funções:` e o fechamento delas; (ii) emitir `UPDATE OF <colunas>` e `WHEN (<condição>)` de `CONFERIDOS`, copiados das migrations com a fonte ao lado; (iii) **falhar** se um gatilho gerado não estiver em `CONFERIDOS` (o `03-triggers.csv` não traz nem `UPDATE OF` nem `WHEN`: sem o `WHEN`, `trg_frota_fechar_posse_orfa` fecharia a posse do carro a cada troca de responsável — Ruling 5.2-1).
- Resultado esperado (ensaiado em Postgres 17 durante a escrita do plano): `-- Funções (26): bem_de_veiculo_segue_a_frota, conta_ativa, criar_pessoa_rapida, criar_setor_rapido, equipes_toca_atualizado, espelhar_grupo_do_canal, espelhar_rename_do_grupo, frota_aceite_imutavel, frota_espelha_responsavel_no_bem, frota_espelha_situacao_no_bem, frota_fechar_posse_orfa, frota_uso_enfileirar_pdf, guard_profiles, impedir_autopromocao, is_acessos_admin, is_frota_admin, is_patrimonio_admin, is_superadmin, patrimonio_espelha_responsavel_no_veiculo, patrimonio_espelha_situacao_no_veiculo, patrimonio_traduz_situacao_para_frota, pessoas_para_escolher, pode_cadastrar_pessoa_rapida, setores_para_escolher, sincronizar_carro_e_bem, situacao_do_bem_pelo_veiculo` e 14 gatilhos.

**(b) Testes de aceitação**
- `TestEsquemaDeProducaoComOsGatilhosVerbatim` (5.1) passa com a lista nova de 14 gatilhos.
- `TestFatiaDoPatrimonioComGatilhosVerbatim` (código abaixo), com a pessoa de patrimônio em `banco.ComUsuario`: ligar o carro ao bem leva a situação do carro ao bem; mudar a situação no Patrimônio de um bem ligado não pega (segue a frota); o responsável do bem espelha no carro e a posse aberta do carro CONTINUA aberta; a situação do carro espelha no bem; bem sem responsável deixa o carro sem responsável e FECHA a posse dele; item comum (sem carro) muda de situação livremente. RPCs verbatim: `criar_pessoa_rapida` cria e, com o mesmo nome em outra caixa/espaços, devolve `ja_existia`; sem módulo → `42501 Sem acesso para cadastrar colaborador`; `sincronizar_carro_e_bem` com bem que não é veículo → `23514` com a frase da trava de categoria e NENHUM carro criado (a função inteira desfaz).
- Mutações que têm de reprovar (uma por vez): tirar o `quando` de `trg_frota_fechar_posse_orfa` em `CONFERIDOS` e regerar (o passo do responsável fecha a posse — ensaiado: reprova); apagar a linha `create trigger trg_bem_de_veiculo_segue_a_frota` do `02-gatilhos.sql`; tirar `criar_pessoa_rapida` da linha `-- funções:` e regerar (a RPC some do D0 e o passo do cadastro rápido reprova); tirar uma entrada de `CONFERIDOS` (o gerador tem de sair com erro, sem escrever o arquivo pela metade: redirecione para um arquivo temporário).

**(c) Arquivos:** Create `api/internal/testebanco/esquema/01-tabelas-5-2.sql`, `api/internal/testebanco/esquema_patrimonio_test.go`; Modify `api/internal/testebanco/esquema/gerar-gatilhos.mjs` (troca inteira), `api/internal/testebanco/esquema/02-gatilhos.sql` (regerado), `api/internal/testebanco/esquema_test.go` (lista esperada).

**(d) Dependências:** 5.1 Task 1 (`ComEsquemaDeProducao`, `01-tabelas-5-1.sql`); `banco.ComUsuario`; levantamento local.

- [ ] **Step 1: A DDL da fatia.** Crie `api/internal/testebanco/esquema/01-tabelas-5-2.sql`:

```sql
-- FATIA 5.2 do esquema de produção para os testes (D0 reconstruído: Rulings 5.1-1 e 5.2-1). Carregada
-- DEPOIS de 01-tabelas-5-1.sql (ordem de nome). Fonte ao lado de cada tabela. Tabelas de outros
-- sub-planos entram MÍNIMAS (só o que os gatilhos, as RPCs e as rotas do 5.2 leem e gravam); o dono
-- delas completa com `alter table ... add column` no 01-tabelas-5-N.sql dele. FKs de auth.users viram
-- public.usuarios (ops/migracao/limpar-dump.mjs:64).
-- A linha abaixo é lida por gerar-gatilhos.mjs: estas funções entram verbatim em 02-gatilhos.sql.
-- funções: criar_pessoa_rapida, criar_setor_rapido, pessoas_para_escolher, setores_para_escolher, sincronizar_carro_e_bem

-- db/migrations/acessos/018_patrimonio_cadastros.sql:24-30
create table public.patrimonio_empresas (
  id        uuid primary key default gen_random_uuid(),
  nome      text not null unique,
  ordem     int not null default 0,
  criado_em timestamptz not null default now()
);

-- acessos/018:32-38 + acessos/020_patrimonio_hierarquia.sql:19, 25, 121, 124-126, 135 (único por marca)
create table public.patrimonio_locais (
  id         uuid primary key default gen_random_uuid(),
  nome       text not null,
  ordem      int not null default 0,
  criado_em  timestamptz not null default now(),
  empresa_id uuid not null references public.patrimonio_empresas(id) on delete cascade
);
create unique index uq_patrimonio_locais_marca_nome on public.patrimonio_locais (empresa_id, nome);

-- acessos/018:40-46 + acessos/020:20, 26, 122, 128-130, 136 (único por local)
create table public.patrimonio_comodos (
  id        uuid primary key default gen_random_uuid(),
  nome      text not null,
  ordem     int not null default 0,
  criado_em timestamptz not null default now(),
  local_id  uuid not null references public.patrimonio_locais(id) on delete cascade
);
create unique index uq_patrimonio_comodos_local_nome on public.patrimonio_comodos (local_id, nome);

-- acessos/018:49-56
create table public.patrimonio_categorias (
  id             uuid primary key default gen_random_uuid(),
  nome           text not null unique,
  vida_util_anos int,
  ordem          int not null default 0,
  criado_em      timestamptz not null default now()
);

-- acessos/018:59-66
create table public.patrimonio_tipos (
  id           uuid primary key default gen_random_uuid(),
  categoria_id uuid not null references public.patrimonio_categorias(id) on delete cascade,
  nome         text not null,
  ordem        int not null default 0,
  criado_em    timestamptz not null default now(),
  unique (categoria_id, nome)
);

-- do 5.4, MÍNIMA: acessos/004_v2.sql:2-8 (o que criar_setor_rapido e setores_para_escolher leem e gravam)
create table public.acessos_setores (
  id        uuid primary key default gen_random_uuid(),
  nome      text not null unique,
  cor       text,
  ordem     int not null default 0,
  criado_em timestamptz not null default now()
);

-- acessos_pessoas é MÍNIMA no 5.1; aqui, as colunas que o cadastro rápido lê e grava:
-- acessos/001_base.sql:5-6 (cargo, status), acessos/004_v2.sql:20 (setor_id), 2026-08-06-pessoa-marca.sql:14-15 (marca_id)
alter table public.acessos_pessoas
  add column cargo    text,
  add column status   text not null default 'ativo' check (status in ('ativo', 'inativo')),
  add column setor_id uuid references public.acessos_setores(id) on delete set null,
  add column marca_id uuid references public.patrimonio_empresas(id);

-- as FKs de equipes que o 5.1 deixou para cá (2026-08-04-equipes-e-escopo.sql:58-62)
alter table public.equipes
  add foreign key (local_id)   references public.patrimonio_locais(id)   on delete set null,
  add foreign key (setor_id)   references public.acessos_setores(id)     on delete set null,
  add foreign key (empresa_id) references public.patrimonio_empresas(id) on delete set null;

-- acessos/019_patrimonio_bens.sql:3-28 + 2026-08-13-patrimonio-numero-de-serie.sql:11-12
create table public.patrimonio_bens (
  id             uuid primary key default gen_random_uuid(),
  numero         int unique,
  nome           text not null,
  valor_centavos bigint,
  data_compra    date,
  empresa_id     uuid references public.patrimonio_empresas(id)   on delete set null,
  local_id       uuid references public.patrimonio_locais(id)     on delete set null,
  comodo_id      uuid references public.patrimonio_comodos(id)    on delete set null,
  categoria_id   uuid references public.patrimonio_categorias(id) on delete set null,
  tipo_id        uuid references public.patrimonio_tipos(id)      on delete set null,
  marca          text,
  pessoa_id      uuid references public.acessos_pessoas(id) on delete set null,
  dono_texto     text,
  etiquetado     boolean not null default false,
  situacao       text not null default 'em_estoque'
                 check (situacao in ('em_uso', 'em_estoque', 'em_manutencao', 'baixado')),
  observacao     text,
  detalhes       jsonb not null default '{}'::jsonb,
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now(),
  numero_serie   text
);

-- acessos/019:38-47
create table public.patrimonio_posse (
  id          uuid primary key default gen_random_uuid(),
  bem_id      uuid not null references public.patrimonio_bens(id) on delete cascade,
  pessoa_id   uuid references public.acessos_pessoas(id) on delete set null,
  pessoa_nome text,
  de          date not null,
  ate         date,
  motivo      text,
  criado_em   timestamptz not null default now()
);

-- acessos/019:50-58
create table public.patrimonio_log (
  id        uuid primary key default gen_random_uuid(),
  quem      uuid,
  acao      text not null,
  alvo      text,
  resultado text,
  detalhe   text,
  quando    timestamptz not null default now()
);

-- acessos/021_patrimonio_config.sql:8-12
create table public.patrimonio_config (
  chave         text primary key,
  valor         text not null,
  atualizado_em timestamptz not null default now()
);

-- do 5.3, MÍNIMA: o que os gatilhos do bem e do carro e sincronizar_carro_e_bem leem e gravam.
-- acessos/022_frota.sql:18-49 (placa única, situação, pessoa_id, atualizado_em), acessos/025_frota_veiculo_completo.sql:20
-- (bem_id), acessos/048_frota_bem_id_unico.sql:44-46 (um carro por bem)
create table public.frota_veiculos (
  id            uuid primary key default gen_random_uuid(),
  placa         text not null unique,
  nome          text not null,
  marca         text,
  fipe_centavos bigint,
  situacao      text not null default 'ativo' check (situacao in ('ativo', 'em_manutencao', 'alienado', 'inativo')),
  pessoa_id     uuid references public.acessos_pessoas(id) on delete set null,
  bem_id        uuid references public.patrimonio_bens(id) on delete set null,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create unique index uq_frota_veiculos_bem_id on public.frota_veiculos (bem_id) where bem_id is not null;

-- do 5.3, MÍNIMA: o que frota_fechar_posse_orfa grava e os gatilhos de frota_uso leem.
-- acessos/022_frota.sql:58-81, acessos/028_frota_checklist.sql:14 (tipo), acessos/046_frota_aceite_de_retirada.sql:33-46
-- (aceite_*; aceite_checklist_id sem a FK: frota_checklist é do 5.3)
create table public.frota_uso (
  id                    uuid primary key default gen_random_uuid(),
  veiculo_id            uuid not null references public.frota_veiculos(id) on delete cascade,
  pessoa_id             uuid references public.acessos_pessoas(id) on delete set null,
  tipo                  text not null default 'viagem',
  saida_em              timestamptz not null default now(),
  volta_em              timestamptz,
  aceite_em             timestamptz,
  aceite_por            uuid references public.usuarios(id) on delete set null,
  aceite_nome           text,
  aceite_rabisco        jsonb,
  aceite_checklist_id   uuid,
  aceite_checklist_hash text
);
```

- [ ] **Step 2: O gerador.** Troque `api/internal/testebanco/esquema/gerar-gatilhos.mjs` inteiro por:

```js
// Gera 02-gatilhos.sql: os gatilhos de produção das tabelas declaradas em 01-tabelas-*.sql, as funções
// pedidas nas linhas "-- funções: a, b" desses arquivos (as RPCs que os testes chamam) e o fechamento
// das funções que uns e outras chamam, VERBATIM do levantamento (02-funções.csv, 03-triggers.csv).
// Uso (na raiz do repositório):
//   node api/internal/testebanco/esquema/gerar-gatilhos.mjs <dir do levantamento> > api/internal/testebanco/esquema/02-gatilhos.sql
// O 03-triggers.csv não traz FOR EACH, UPDATE OF nem WHEN. Todo gatilho sai "for each row"; as colunas
// do UPDATE OF e o WHEN vêm de CONFERIDOS, copiados da migration (fonte ao lado). Gatilho gerado que
// não está em CONFERIDOS faz o script FALHAR: leia a migration dele e acrescente a linha.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// tabela.gatilho → { de: colunas do UPDATE OF, quando: condição do WHEN }; {} = nenhum dos dois.
const CONFERIDOS = {
  'bling_lojas.trg_espelhar_grupo_do_canal': { de: 'grupo_id, grupo' },                // db/migrations/2026-08-27-espelho-do-grupo-nos-dois-sentidos.sql:117-119
  'canais_grupos.trg_espelhar_rename_do_grupo': {},                                     // db/migrations/2026-08-21-canal-pai-e-supervisora-de-grupo.sql:88-90
  'equipes.equipes_atualizado': {},                                                     // db/migrations/2026-08-04-equipes-e-escopo.sql:246-247
  'profiles.trg_guard_profiles': {},                                                    // sem migration no repositório; o corpo usa new/old (Ruling 5.1-1)
  'profiles.trg_impedir_autopromocao': {},                                              // supabase/migrations/20260727_impedir_autopromocao_de_admin.sql:51-53
  'frota_uso.trg_frota_aceite_imutavel': {},                                            // db/migrations/acessos/046_frota_aceite_de_retirada.sql:96-98
  'frota_uso.trg_frota_uso_enfileirar_pdf': { de: 'aceite_em' },                        // db/migrations/2026-08-18-fila-do-pdf-do-aceite.sql:76-78
  'frota_veiculos.trg_frota_espelha_responsavel': { de: 'pessoa_id' },                  // db/migrations/acessos/043_frota_patrimonio_responsavel.sql:50-52
  'frota_veiculos.trg_frota_espelha_situacao': { de: 'situacao' },                      // db/migrations/acessos/042_frota_patrimonio_situacao.sql:86-88
  'frota_veiculos.trg_frota_espelha_situacao_no_bem': {},                               // db/migrations/acessos/051_status_do_veiculo_vale_nos_dois.sql:102-104
  'frota_veiculos.trg_frota_fechar_posse_orfa': { de: 'pessoa_id', quando: 'new.pessoa_id is null' }, // db/migrations/acessos/029_frota_posse_invariante.sql:34-37
  'patrimonio_bens.trg_bem_de_veiculo_segue_a_frota': {},                               // db/migrations/acessos/051_status_do_veiculo_vale_nos_dois.sql:135-138
  'patrimonio_bens.trg_patrimonio_espelha_responsavel': { de: 'pessoa_id' },            // db/migrations/acessos/043_frota_patrimonio_responsavel.sql:69-71
  'patrimonio_bens.trg_patrimonio_espelha_situacao': { de: 'situacao' },                // db/migrations/acessos/042_frota_patrimonio_situacao.sql:110-112
};

const [dir] = process.argv.slice(2);
if (!dir) {
  console.error('uso: gerar-gatilhos.mjs <dir do levantamento>');
  process.exit(2);
}

function lerCSV(texto) {
  const linhas = [];
  let campo = '', linha = [], aspas = false;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (aspas) {
      if (c === '"' && texto[i + 1] === '"') { campo += '"'; i++; }
      else if (c === '"') aspas = false;
      else campo += c;
    } else if (c === '"') aspas = true;
    else if (c === ',') { linha.push(campo); campo = ''; }
    else if (c === '\n') { linha.push(campo); linhas.push(linha); linha = []; campo = ''; }
    else if (c !== '\r') campo += c;
  }
  if (campo || linha.length) { linha.push(campo); linhas.push(linha); }
  return linhas;
}

const aqui = fileURLToPath(new URL('.', import.meta.url));
const fatias = readdirSync(aqui).filter((a) => /^01-tabelas-.*\.sql$/.test(a)).sort()
  .map((a) => readFileSync(join(aqui, a), 'utf8'));
const tabelas = new Set(fatias.flatMap((t) => [...t.matchAll(/create table public\.([a-z_][a-z0-9_]*)/g)].map((m) => m[1])));
const pedidas = fatias.flatMap((t) => [...t.matchAll(/^-- funções: (.+)$/gm)]
  .flatMap((m) => m[1].split(',').map((s) => s.trim()).filter(Boolean)));

const [cabF, ...linF] = lerCSV(readFileSync(join(dir, '02-funções.csv'), 'utf8'));
const iNome = cabF.indexOf('proname'), iDef = cabF.indexOf('definicao');
const funcoes = new Map(linF.filter((l) => l.length > iDef).map((l) => [l[iNome], l[iDef]]));

const [cabG, ...linG] = lerCSV(readFileSync(join(dir, '03-triggers.csv'), 'utf8'));
const c = (n) => cabG.indexOf(n);
const gatilhos = new Map();
for (const l of linG) {
  if (l.length < cabG.length || !tabelas.has(l[c('event_object_table')])) continue;
  const chave = `${l[c('event_object_table')]}.${l[c('trigger_name')]}`;
  const g = gatilhos.get(chave) ?? { chave, tabela: l[c('event_object_table')], nome: l[c('trigger_name')],
    momento: l[c('action_timing')], eventos: [], acao: l[c('action_statement')] };
  g.eventos.push(l[c('event_manipulation')]);
  gatilhos.set(chave, g);
}
for (const g of gatilhos.values()) {
  if (!CONFERIDOS[g.chave]) {
    console.error(`gatilho ${g.chave} sem conferência: leia a migration (UPDATE OF? WHEN?) e acrescente em CONFERIDOS`);
    process.exit(1);
  }
}

const chamadas = (texto) => [...funcoes.keys()].filter((n) => new RegExp(`\\b${n}\\(`).test(texto));
const fila = [...[...gatilhos.values()].flatMap((g) => chamadas(g.acao)), ...pedidas];
const vistas = new Set();
while (fila.length) {
  const n = fila.shift();
  if (vistas.has(n)) continue;
  if (!funcoes.has(n)) { console.error(`função ${n} não está no CSV`); process.exit(1); }
  vistas.add(n);
  fila.push(...chamadas(funcoes.get(n)));
}

const eventos = (g) => g.eventos
  .map((e) => (e === 'UPDATE' && CONFERIDOS[g.chave].de ? `UPDATE OF ${CONFERIDOS[g.chave].de}` : e)).join(' or ');
const quando = (g) => (CONFERIDOS[g.chave].quando ? ` when (${CONFERIDOS[g.chave].quando})` : '');
const nomes = [...vistas].sort();
const ordem = [...gatilhos.values()].sort((a, b) => a.chave.localeCompare(b.chave));
process.stdout.write(
  '-- GERADO por gerar-gatilhos.mjs a partir do levantamento de produção (02-funções.csv, 03-triggers.csv).\n' +
  '-- NÃO EDITE À MÃO: rode o script de novo. Corpos verbatim de produção; orientação dos gatilhos das migrations.\n' +
  `-- Tabelas: ${[...tabelas].sort().join(', ')}\n` +
  `-- Funções (${nomes.length}): ${nomes.join(', ')}\n` +
  'set check_function_bodies = off;\n\n' +
  nomes.map((n) => funcoes.get(n).trim() + ';\n').join('\n') + '\n' +
  ordem.map((g) => `create trigger ${g.nome} ${g.momento} ${eventos(g)} on public.${g.tabela} for each row${quando(g)} ${g.acao};\n`).join(''),
);
```

Rode: `node api/internal/testebanco/esquema/gerar-gatilhos.mjs "$L" > api/internal/testebanco/esquema/02-gatilhos.sql && sed -n 4p api/internal/testebanco/esquema/02-gatilhos.sql | cut -c1-20 && grep -c '^create trigger' api/internal/testebanco/esquema/02-gatilhos.sql && grep -c 'when (new.pessoa_id is null)' api/internal/testebanco/esquema/02-gatilhos.sql` → `-- Funções (26): be…`, `14`, `1`. Outro número: **pare e reporte** (o CSV mudou ou o fechamento pegou nome a mais).

- [ ] **Step 3: A lista de gatilhos do 5.1.** Em `api/internal/testebanco/esquema_test.go`, troque a lista esperada de `TestEsquemaDeProducaoComOsGatilhosVerbatim` por (mesma ordem em collation C e en_US):

```go
	if quer := []string{"equipes_atualizado", "trg_bem_de_veiculo_segue_a_frota", "trg_espelhar_grupo_do_canal",
		"trg_espelhar_rename_do_grupo", "trg_frota_aceite_imutavel", "trg_frota_espelha_responsavel",
		"trg_frota_espelha_situacao", "trg_frota_espelha_situacao_no_bem", "trg_frota_fechar_posse_orfa",
		"trg_frota_uso_enfileirar_pdf", "trg_guard_profiles", "trg_impedir_autopromocao",
		"trg_patrimonio_espelha_responsavel", "trg_patrimonio_espelha_situacao"}; !reflect.DeepEqual(gat, quer) {
```

- [ ] **Step 4: O teste da fatia.** Crie `api/internal/testebanco/esquema_patrimonio_test.go`:

```go
package testebanco

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/rbv-co/social-dashboard/api/internal/banco"
)

// A fatia 5.2: os gatilhos do bem e do carro, VERBATIM e com o UPDATE OF/WHEN das migrations, e as
// RPCs do cadastro rápido e da ligação carro ↔ bem rodando com a identidade da transação.
func TestFatiaDoPatrimonioComGatilhosVerbatim(t *testing.T) {
	p := ComEsquemaDeProducao(t)
	ctx := context.Background()
	const (
		pat     = "5e200000-0000-4000-a000-000000000001" // features {patrimonio}
		ninguem = "5e200000-0000-4000-a000-000000000002" // sem módulo
		p1      = "9e200000-0000-4000-a000-000000000001"
		p2      = "9e200000-0000-4000-a000-000000000002"
		e1      = "a1000000-0000-4000-a000-000000000001"
		l1      = "a2000000-0000-4000-a000-000000000001"
		catV    = "a4000000-0000-4000-a000-000000000001"
		catM    = "a4000000-0000-4000-a000-000000000002"
		b1      = "b0000000-0000-4000-a000-000000000001"
		bv      = "b0000000-0000-4000-a000-000000000005"
		v1      = "f0000000-0000-4000-a000-000000000001"
		u1      = "f1000000-0000-4000-a000-000000000001"
	)
	if _, err := p.Exec(ctx, `
		insert into usuarios (id, email) values ('`+pat+`', 'pat@x.com'), ('`+ninguem+`', 'ninguem@x.com');
		insert into profiles (id, email, role, features) values ('`+pat+`', 'pat@x.com', 'viewer', '{patrimonio}'),
		  ('`+ninguem+`', 'ninguem@x.com', 'viewer', '{}');
		insert into acessos_pessoas (id, nome) values ('`+p1+`', 'Pessoa Um'), ('`+p2+`', 'Pessoa Dois');
		insert into patrimonio_empresas (id, nome) values ('`+e1+`', 'Vessel');
		insert into patrimonio_locais (id, nome, empresa_id) values ('`+l1+`', 'Loja', '`+e1+`');
		insert into patrimonio_categorias (id, nome) values ('`+catV+`', 'Veículos'), ('`+catM+`', 'Móveis');
		insert into patrimonio_bens (id, numero, nome, local_id, categoria_id, pessoa_id, situacao) values
		  ('`+bv+`', 10, 'Kwid', '`+l1+`', '`+catV+`', '`+p1+`', 'em_estoque'),
		  ('`+b1+`', 1, 'Cadeira', '`+l1+`', '`+catM+`', null, 'em_uso');
		insert into frota_veiculos (id, placa, nome, situacao, pessoa_id) values ('`+v1+`', 'ABC1D23', 'Kwid', 'ativo', '`+p1+`');
		insert into frota_uso (id, veiculo_id, pessoa_id, tipo) values ('`+u1+`', '`+v1+`', '`+p1+`', 'posse');`); err != nil {
		t.Fatal(err)
	}
	como := func(id, sql string) error {
		return banco.ComUsuario(ctx, p, id, func(tx pgx.Tx) error { _, err := tx.Exec(ctx, sql); return err })
	}
	um := func(sql string) string {
		var v *string
		if err := p.QueryRow(ctx, sql).Scan(&v); err != nil {
			t.Fatalf("%s: %v", sql, err)
		}
		if v == nil {
			return "<nulo>"
		}
		return *v
	}
	// situação do bem | situação do carro | responsável do carro | posse do carro aberta?
	estado := func() string {
		return um(`select b.situacao || '|' || v.situacao || '|' || coalesce(v.pessoa_id::text, '-') || '|' ||
			(select (u.volta_em is null)::text from frota_uso u where u.id = '` + u1 + `')
			from patrimonio_bens b, frota_veiculos v where b.id = '` + bv + `' and v.id = '` + v1 + `'`)
	}
	for _, c := range []struct{ nome, sql, quer string }{
		{"ligar o carro ao bem leva a situação do carro ao bem",
			`update frota_veiculos set bem_id = '` + bv + `' where id = '` + v1 + `'`, "em_uso|ativo|" + p1 + "|true"},
		{"bem de veículo segue a frota: mudar a situação no Patrimônio não pega",
			`update patrimonio_bens set situacao = 'em_estoque' where id = '` + bv + `'`, "em_uso|ativo|" + p1 + "|true"},
		{"o responsável do bem espelha no carro e a posse do carro continua aberta (WHEN)",
			`update patrimonio_bens set pessoa_id = '` + p2 + `' where id = '` + bv + `'`, "em_uso|ativo|" + p2 + "|true"},
		{"a situação do carro espelha no bem",
			`update frota_veiculos set situacao = 'em_manutencao' where id = '` + v1 + `'`, "em_manutencao|em_manutencao|" + p2 + "|true"},
		{"bem sem responsável: o carro também, e a posse aberta do carro fecha",
			`update patrimonio_bens set pessoa_id = null where id = '` + bv + `'`, "em_manutencao|em_manutencao|-|false"},
	} {
		if err := como(pat, c.sql); err != nil {
			t.Fatalf("%s: %v", c.nome, err)
		}
		if v := estado(); v != c.quer {
			t.Errorf("%s: %s, esperava %s", c.nome, v, c.quer)
		}
	}
	if err := como(pat, `update patrimonio_bens set situacao = 'baixado' where id = '`+b1+`'`); err != nil {
		t.Fatal(err)
	}
	if v := um(`select situacao from patrimonio_bens where id = '` + b1 + `'`); v != "baixado" {
		t.Errorf("item comum (sem carro) = %s: a situação dele é decidida no Patrimônio", v)
	}

	// RPCs verbatim, com quem pede
	jaExistia := func(nome string) bool {
		var ja bool
		if err := banco.ComUsuario(ctx, p, pat, func(tx pgx.Tx) error {
			return tx.QueryRow(ctx, `select ja_existia from criar_pessoa_rapida($1::text)`, nome).Scan(&ja)
		}); err != nil {
			t.Fatalf("criar_pessoa_rapida(%q): %v", nome, err)
		}
		return ja
	}
	if jaExistia("Fulana de Tal") || !jaExistia("  fulana de tal ") {
		t.Error("criar_pessoa_rapida não achou a existente pelo nome sem caixa e sem espaços")
	}
	codigo := func(err error) string {
		var pe *pgconn.PgError
		if errors.As(err, &pe) {
			return pe.Code + " " + pe.Message
		}
		return ""
	}
	if c := codigo(como(ninguem, `select * from criar_pessoa_rapida('Outra')`)); !strings.HasPrefix(c, "42501 Sem acesso para cadastrar colaborador") {
		t.Errorf("sem módulo: %q", c)
	}
	err := como(pat, `select sincronizar_carro_e_bem(p_bem_id => '`+b1+`', p_placa => 'XYZ9A88', p_nome => 'Carro')`)
	if c := codigo(err); !strings.HasPrefix(c, `23514 O nº de patrimônio 1 é "Cadeira", que não é um veículo`) {
		t.Errorf("trava de categoria: %q", c)
	}
	if v := um(`select count(*)::text from frota_veiculos`); v != "1" {
		t.Errorf("carros = %s: a função abortada não pode deixar o carro que criou", v)
	}
}
```

Run: `cd api && go test -count=1 -run 'EsquemaDeProducao|FatiaDoPatrimonio' -v ./internal/testebanco/ 2>&1 | grep -E '^(--- |ok|FAIL)'` → as duas `--- PASS`. (O cenário e a mutação do `WHEN` foram ensaiados em Postgres 17 com estes mesmos arquivos.)

- [ ] **Step 5: Morder.** As mutações de (b), uma por vez, regerando o `02-gatilhos.sql` quando ela for no gerador; `git checkout` depois.

- [ ] **Step 6: Commit.**

```bash
git add api/internal/testebanco/esquema/ api/internal/testebanco/esquema_test.go api/internal/testebanco/esquema_patrimonio_test.go
git commit -m "test(api): D0 — fatia 5.2 (patrimônio, frota mínima, gatilhos com UPDATE OF/WHEN das migrations e RPCs verbatim)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Fundação — `CriarSoLegivel`, `SoSessaoPropria` em `dados` e em `rpc`

**Revisor:** opus. **Depende de:** 5.1 (Task 2: `dados/escrita.go`; Task 3: `acesso/acesso.go`), 5.0 (Task 6: `rpc`).

**(a) Contrato**
- `dados.Tabela` ganha `CriarSoLegivel bool`: a linha criada tem de passar também na regra de **Ler** de quem cria (avaliada sobre a linha gravada, com defaults e gatilhos, no `devolver` que já existe). Não passa → `autz.ErrNegado` (403) e a transação é desfeita. Referência inexistente (23503) responde igual (`ErrNegado`): uma FK para o que não existe e uma para o que a pessoa não vê não podem ser distinguíveis (Ruling 5.2-2). Sem a flag, o comportamento do 5.1 não muda (`{"id"}` quando não lê; 23503 → 409).
- `dados.SoSessaoPropria(frase string) func(http.Handler) http.Handler`: ator ausente ou com `ImpersonadorID` → `403 {"error":"sem_permissao","mensagem":frase}` sem chamar o handler. `dados.FraseEntrarComo = "Quem entrou como outra pessoa só consulta."`. O `soSessaoPropria` do 5.1 passa a ser `dados.SoSessaoPropria("Quem entrou como outra pessoa não muda acessos nem avisos.")` (mesma frase, mesmo teste).
- `rpc.Funcao` ganha `SoSessaoPropria bool`: depois do portão, sessão de "entrar como" recebe 403 com `dados.FraseEntrarComo` e a função NÃO roda. Função sem a flag (as que só leem) continua aberta a quem entrou como.

**(b) Testes de aceitação**
- `TestCriarSoLegivel` (código abaixo): cria o que lê → linha completa; o que não lê → `ErrNegado` e nada gravado; conta inexistente (FK) → `ErrNegado` igual; sem a flag, o 5.1 continua (`{"id"}` e 409).
- `TestSoSessaoPropria` (dados): sem ator → 403; sessão própria → handler roda; impersonado → 403 com a frase e o handler NÃO roda.
- `TestRPCSoSessaoPropria`: impersonado chamando função com a flag → 403 com "Quem entrou como outra pessoa" e a marca NÃO é gravada; função sem a flag → 200.
- `TestSoSessaoPropria` do 5.1 (`acesso`) continua verde.
- Mutações que têm de reprovar: em `devolver`, manter o fallback `{"id"}` mesmo com `soLegivel` ("o que não lê" vira 201); tirar o mapeamento 23503 → `ErrNegado` (FK inexistente vira 409: oráculo); em `rpc.ServeHTTP`, checar `SoSessaoPropria` DEPOIS de `banco.ComUsuario` (a marca é gravada).

**(c) Arquivos:** Modify `api/internal/dados/escrita.go`, `api/internal/rpc/rpc.go`, `api/internal/acesso/acesso.go`; Create `api/internal/dados/criar_so_legivel_test.go`, `api/internal/dados/sessao.go`, `api/internal/dados/sessao_test.go`, `api/internal/rpc/sessao_test.go`.

**(d) Dependências:** `autz.Filtro/ErrNegado`, `auth.AtorDoContexto/NoContexto`, `banco.ComUsuario`, `testebanco.Novo`; os ajudantes do teste do 5.0 em `rpc_test.go` (`todos`, `quemPede`, `chamar`) e do 5.1 em `escrita_test.go` (`catalogoDeEscrita`, `quemEscreve`).

- [ ] **Step 1: Os testes que falham.** Crie `api/internal/dados/criar_so_legivel_test.go`:

```go
package dados

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/rbv-co/social-dashboard/api/internal/autz"
	"github.com/rbv-co/social-dashboard/api/internal/banco"
	"github.com/rbv-co/social-dashboard/api/internal/testebanco"
)

// CriarSoLegivel: quem cria tem de conseguir ler o que criou; o que não existe responde igual ao que
// a pessoa não vê (sem oráculo). Catálogo de teste do 5.1: coisa lida por pode_ver_conta(account_id),
// criada por quem tem o módulo frota.
func TestCriarSoLegivel(t *testing.T) {
	cat, err := autz.Compilar([]byte(catalogoDeEscrita))
	if err != nil {
		t.Fatal(err)
	}
	p := testebanco.Novo(t)
	ctx := context.Background()
	if _, err := p.Exec(ctx, `create table conta (id text primary key);
		insert into conta values ('A1'), ('A2');
		create table coisa (id uuid primary key default gen_random_uuid(), account_id text references conta(id), nome text)`); err != nil {
		t.Fatal(err)
	}
	frota := &autz.Escopo{ID: quemEscreve, TemPerfil: true, Ativo: true, SemTrava: true, Modulos: []string{"frota"}, Contas: []string{"A1"}}
	criar := func(tb Tabela, conta string) ([]byte, error) {
		var linha []byte
		err := banco.ComUsuario(ctx, p, frota.ID, func(tx pgx.Tx) (err error) {
			linha, err = tb.Criar(ctx, tx, cat, frota, map[string]any{"account_id": conta, "nome": "x"})
			return err
		})
		return linha, err
	}
	total := func() (n int) {
		p.QueryRow(ctx, `select count(*) from coisa`).Scan(&n)
		return n
	}
	so := Tabela{Nome: "coisa", Resposta: "t.id, t.account_id", CriarSoLegivel: true}
	if l, err := criar(so, "A1"); err != nil || !strings.Contains(string(l), `"account_id":"A1"`) {
		t.Errorf("cria o que lê: %s %v", l, err)
	}
	if _, err := criar(so, "A2"); !errors.Is(err, autz.ErrNegado) || total() != 1 {
		t.Errorf("criou o que não lê: %v (%d linhas)", err, total())
	}
	if _, err := criar(so, "A9"); !errors.Is(err, autz.ErrNegado) || total() != 1 {
		t.Errorf("conta inexistente = %v: tem de responder igual à invisível", err)
	}
	livre := Tabela{Nome: "coisa", Resposta: "t.id, t.account_id"}
	if l, err := criar(livre, "A2"); err != nil || strings.Contains(string(l), "account_id") || total() != 2 {
		t.Errorf("sem a flag, o 5.1 devolve só o id: %s %v", l, err)
	}
	if _, err := criar(livre, "A9"); err == nil || errors.Is(err, autz.ErrNegado) {
		t.Errorf("sem a flag, FK inexistente continua erro do banco (409): %v", err)
	}
}
```

Crie `api/internal/dados/sessao_test.go`:

```go
package dados

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/rbv-co/social-dashboard/api/internal/auth"
)

func TestSoSessaoPropria(t *testing.T) {
	chamou := false
	h := SoSessaoPropria("Só a própria sessão grava.")(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		chamou = true
		w.WriteHeader(http.StatusNoContent)
	}))
	por := "11111111-0000-4000-a000-000000000009"
	for _, c := range []struct {
		nome   string
		ator   *auth.Ator
		status int
	}{
		{"sem ator", nil, http.StatusForbidden},
		{"sessão própria", &auth.Ator{ID: "11111111-0000-4000-a000-000000000001"}, http.StatusNoContent},
		{"entrou como outra pessoa", &auth.Ator{ID: "11111111-0000-4000-a000-000000000001", ImpersonadorID: &por}, http.StatusForbidden},
	} {
		chamou = false
		r := httptest.NewRequest("POST", "/x", nil)
		if c.ator != nil {
			r = r.WithContext(auth.NoContexto(r.Context(), c.ator))
		}
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		negado := c.status == http.StatusForbidden
		if w.Code != c.status || chamou == negado || (negado && !strings.Contains(w.Body.String(), "Só a própria sessão grava.")) {
			t.Errorf("%s: %d %s (handler rodou: %v)", c.nome, w.Code, w.Body, chamou)
		}
	}
}
```

Crie `api/internal/rpc/sessao_test.go`:

```go
package rpc

import (
	"context"
	"net/http"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/rbv-co/social-dashboard/api/internal/auth"
	"github.com/rbv-co/social-dashboard/api/internal/autz"
	"github.com/rbv-co/social-dashboard/api/internal/testebanco"
)

// Função que grava recusa a sessão de "entrar como" ANTES de rodar; função que só lê continua aberta.
func TestRPCSoSessaoPropria(t *testing.T) {
	p := testebanco.Novo(t)
	ctx := context.Background()
	if _, err := p.Exec(ctx, `create table marca (quem text);
		create function marcar() returns void language sql as $$ insert into marca values (current_setting('app.usuario_id', true)) $$;
		create function ler() returns int language sql as $$ select 1 $$;`); err != nil {
		t.Fatal(err)
	}
	reg, err := Novo(p, Funcao{Nome: "marcar", Retorno: Nada, Portao: todos, SoSessaoPropria: true}, Funcao{Nome: "ler", Portao: todos})
	if err != nil {
		t.Fatal(err)
	}
	por := "11111111-0000-4000-a000-000000000009"
	r := chi.NewRouter()
	r.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
			c := auth.NoContexto(req.Context(), &auth.Ator{ID: quemPede, Tipo: "painel", ImpersonadorID: &por})
			next.ServeHTTP(w, req.WithContext(autz.NoContexto(c, &autz.Escopo{ID: quemPede})))
		})
	})
	r.Post("/rpc/{nome}", reg.ServeHTTP)
	if w := chamar(r, "marcar", `{}`); w.Code != http.StatusForbidden || !strings.Contains(w.Body.String(), "Quem entrou como outra pessoa") {
		t.Fatalf("impersonado gravando = %d %s", w.Code, w.Body)
	}
	var n int
	p.QueryRow(ctx, `select count(*) from marca`).Scan(&n)
	if n != 0 {
		t.Fatalf("a função rodou para quem entrou como (%d marcas)", n)
	}
	if w := chamar(r, "ler", `{}`); w.Code != http.StatusOK {
		t.Fatalf("função que só lê = %d %s", w.Code, w.Body)
	}
}
```

Run: `cd api && go test -count=1 ./internal/dados/ ./internal/rpc/` → FAIL de compilação (`CriarSoLegivel`, `SoSessaoPropria` não existem).

- [ ] **Step 2: Implementar em `dados`.** Em `api/internal/dados/escrita.go`:
  1. Acrescente o import `"github.com/jackc/pgx/v5/pgconn"`.
  2. Na struct `Tabela`, depois de `Autor`, acrescente:
     ```go
     	// CriarSoLegivel: a linha criada tem de passar também na regra de LER de quem cria (o que a
     	// pessoa grava ela tem de conseguir ver; Ruling 5.2-2). Senão — e também quando uma referência
     	// (FK) não existe, para não denunciar o que existe fora do alcance dela — ErrNegado (403) e a
     	// transação é desfeita.
     	CriarSoLegivel bool
     ```
  3. Em `Criar`, troque o `return t.devolver(ctx, tx, cat, e, `insert …`, pgx.NamedArgs{"dados_campos": string(j)})` por:
     ```go
     	linha, err := t.devolver(ctx, tx, cat, e, `insert into `+tab+` (`+lista+`) select `+lista+
     		` from jsonb_populate_record(null::`+tab+`, @dados_campos::jsonb) returning *`,
     		pgx.NamedArgs{"dados_campos": string(j)}, t.CriarSoLegivel)
     	var pe *pgconn.PgError
     	if t.CriarSoLegivel && errors.As(err, &pe) && pe.Code == "23503" {
     		return nil, autz.ErrNegado // referência inexistente responde igual à invisível (sem oráculo)
     	}
     	return linha, err
     ```
  4. Em `Editar`, acrescente `, false` como último argumento da chamada a `t.devolver`.
  5. Troque a função `devolver` inteira por:
     ```go
     // devolver roda a escrita como CTE e responde a linha pela lista Resposta se quem pede a lê DEPOIS
     // de gravada (regra de Ler do catálogo sobre a linha nova); senão {"id": …} (contrato II.2) — ou,
     // com soLegivel, ErrNegado: a transação de banco.ComUsuario é desfeita e nada fica gravado.
     func (t Tabela) devolver(ctx context.Context, tx pgx.Tx, cat *autz.Catalogo, e *autz.Escopo, escrita string, args pgx.NamedArgs, soLegivel bool) ([]byte, error) {
     	f, err := cat.Filtro(e, t.Nome, autz.Ler, "t")
     	if err != nil {
     		return nil, err
     	}
     	seNaoLe := `(select row_to_json(y) from (select t.id from t) y)`
     	if soLegivel {
     		seNaoLe = `null::json`
     	}
     	var corpo []byte
     	// row_to_json e não json_build_object: este escreve {"id" : …} com espaços; o PostgREST, compacto
     	err = tx.QueryRow(ctx, `with t as (`+escrita+`) select coalesce(
     		(select row_to_json(x) from (select `+t.Resposta+` from t where `+f.SQL+`) x), `+seNaoLe+`)`, f.Juntar(args)).Scan(&corpo)
     	if err != nil {
     		return nil, err
     	}
     	if corpo == nil {
     		if soLegivel {
     			return nil, autz.ErrNegado
     		}
     		return nil, autz.ErrNaoEncontrado
     	}
     	return corpo, nil
     }
     ```

Crie `api/internal/dados/sessao.go`:

```go
package dados

import (
	"net/http"

	"github.com/rbv-co/social-dashboard/api/internal/auth"
)

// FraseEntrarComo responde às escritas recusadas a quem entrou como outra pessoa.
const FraseEntrarComo = "Quem entrou como outra pessoa só consulta."

// SoSessaoPropria recusa a rota (403 com `frase`, sem chamar o handler) a quem entrou como outra
// pessoa ("entrar como", Ruling 18 do mestre) e a pedido sem ator (rota montada fora de auth.Exigir).
// Extraído do 5.1 (acesso.soSessaoPropria) no 5.2: o rastro e a autoria iriam no nome do alvo.
func SoSessaoPropria(frase string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if a := auth.AtorDoContexto(r.Context()); a == nil || a.ImpersonadorID != nil {
				Erro(w, http.StatusForbidden, "sem_permissao", frase)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}
```

Em `api/internal/acesso/acesso.go`, troque a função `soSessaoPropria` (e o import de `auth`, se ficar sem uso) por:

```go
// soSessaoPropria recusa as escritas do 5.1 a quem entrou como outra pessoa: o rastro (audit_log)
// atribuiria ao alvo o que o super-admin fez, e a inscrição de push deixaria o aparelho dele
// recebendo os avisos do alvo.
var soSessaoPropria = dados.SoSessaoPropria("Quem entrou como outra pessoa não muda acessos nem avisos.")
```

- [ ] **Step 3: Implementar em `rpc`.** Em `api/internal/rpc/rpc.go`: na struct `Funcao`, depois de `Portao`, acrescente:

```go
	// SoSessaoPropria: a função GRAVA. Sessão de "entrar como" recebe 403 sem a função rodar
	// (Ruling 5.2-3); função que só lê fica aberta a quem entrou como (ver o que a pessoa vê).
	SoSessaoPropria bool
```

e, em `ServeHTTP`, logo depois do bloco `if !f.Portao(e) { … }`:

```go
	if f.SoSessaoPropria && a.ImpersonadorID != nil {
		dados.Erro(w, http.StatusForbidden, "sem_permissao", dados.FraseEntrarComo)
		return
	}
```

- [ ] **Step 4: Rodar e morder.** `gofmt -l ./internal && go vet ./internal/dados/ ./internal/rpc/ ./internal/acesso/ && go test -count=1 -v ./internal/dados/ ./internal/rpc/ ./internal/acesso/ 2>&1 | grep -E '^(--- |ok|FAIL)'` → tudo PASS. Aplique as mutações de (b), uma por vez, e veja reprovar.

- [ ] **Step 5: Commit.**

```bash
git add api/internal/dados/ api/internal/rpc/ api/internal/acesso/acesso.go
git commit -m "feat(api): criar só o que se vê (Tabela.CriarSoLegivel) e 'entrar como' só lê em dados e em rpc

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Mundo de teste compartilhado (`mundoteste`) e o mundo do Patrimônio

**Revisor:** opus. **Depende de:** 1, 2.

**(a) Contrato**
- `mundoteste` (pacote de teste NÃO `_test`, em `api/internal/testebanco/mundoteste`; não fica em `testebanco` porque os testes internos de `autz` importam `testebanco` e haveria ciclo — Ruling 5.2-13): `Pessoa{Chave, ID, Email, Papel string; Super, Trava, Desativado bool; Modulos, Contas []string}`; `Opcoes{Pessoas []Pessoa; Linhas string; Impersonadas map[string][2]string}`; `Novo(t, o, montar ...func(chi.Router, *pgxpool.Pool)) *Mundo` (banco da Task 1, pessoas com perfil e sessão de painel, sessões impersonadas, `Linhas` sem identidade, rotas atrás de `auth.Exigir` → `autz.ComEscopo`); `Mundo{P, H, Tok}` com `Resposta`, `Pedir`, `Um`, `Rodar`; `Caso{Nome, Quem, Metodo, Caminho, Corpo string; Status int; Tem, NaoTem, Efeito, Quer string}`.
- `acesso/mundo_test.go` vira adaptador fino (os testes do 5.1 não mudam uma linha).
- `patrimonio`: `soSessaoPropria`, `deve`, `texto`, `textoOuNulo` (abaixo); o mundo do Patrimônio (`novoMundo`, `pessoas`, `linhasDoMundo`, `fotoDoMundo`, ids, `caso`, `contar`, `col`, `ids`).

**(b) Testes de aceitação**
- `TestMundoTeste` (`mundoteste`): sem sessão → 401; sessão própria chega com o `Escopo` (módulos); sessão impersonada chega com `ImpersonadorID`; `Linhas` rodaram.
- `TestMundoDoPatrimonio`: o `Escopo` que chega à rota — `patT1` = `[L1]|[P1]|false|false`; `patT2` = `[L2]|[]|false|false`; `patGeral` = `[]|[]|true|false`; `impersonado` = `[]|[]|true|true`; `viewer` = `[]|[]|false|false`; sem sessão 401; 6 bens no mundo.
- Os testes do pacote `acesso` (5.1) continuam verdes sem mudança.

**(c) Arquivos:** Create `api/internal/testebanco/mundoteste/mundoteste.go`, `api/internal/testebanco/mundoteste/mundoteste_test.go`, `api/internal/patrimonio/patrimonio.go`, `api/internal/patrimonio/mundo_test.go`, `api/internal/patrimonio/patrimonio_test.go`; Modify `api/internal/acesso/mundo_test.go`.

**(d) Dependências:** Task 1 (fatia 5.2), Task 2 (`dados.SoSessaoPropria`); `auth.Exigir/NovoStore/Store.Criar`; `autz.ComEscopo/EscopoDo`.

- [ ] **Step 1: `mundoteste`.** Crie `api/internal/testebanco/mundoteste/mundoteste.go`:

```go
// Package mundoteste monta o mundo de teste das rotas de domínio: o esquema de produção (D0), as
// pessoas com perfil e sessão, as linhas do domínio e as rotas atrás da MESMA cadeia do grupo de
// domínio de web.Rotas (auth.Exigir → autz.ComEscopo). Extraído do 5.1 (acesso/mundo_test.go) no 5.2,
// como o 5.1 previa. Não fica em testebanco: os testes internos de autz importam testebanco, e
// testebanco importando autz seria ciclo (Ruling 5.2-13).
package mundoteste

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/auth"
	"github.com/rbv-co/social-dashboard/api/internal/autz"
	"github.com/rbv-co/social-dashboard/api/internal/testebanco"
)

// Pessoa vira uma linha em usuarios e em profiles e uma sessão de painel. Trava = escopo_por_equipe;
// Contas nil = allowed_accounts nulo (vê todas as contas); Modulos = features.
type Pessoa struct {
	Chave, ID, Email, Papel  string
	Super, Trava, Desativado bool
	Modulos, Contas          []string
}

type Opcoes struct {
	Pessoas []Pessoa
	Linhas  string // SQL do domínio, rodado sem identidade depois das pessoas
	// Impersonadas: chave da sessão → {id do alvo, id de quem entrou como ele}.
	Impersonadas map[string][2]string
}

type Mundo struct {
	P   *pgxpool.Pool
	H   http.Handler
	Tok map[string]string
}

// Novo monta o mundo num banco novo (testebanco.ComEsquemaDeProducao).
func Novo(t *testing.T, o Opcoes, montar ...func(chi.Router, *pgxpool.Pool)) *Mundo {
	t.Helper()
	p := testebanco.ComEsquemaDeProducao(t)
	ctx := context.Background()
	s := auth.NovoStore(p)
	m := &Mundo{P: p, Tok: map[string]string{}}
	for _, x := range o.Pessoas {
		modulos := x.Modulos
		if modulos == nil {
			modulos = []string{}
		}
		if _, err := p.Exec(ctx, `insert into usuarios (id, email) values ($1::uuid, $2::text)`, x.ID, x.Email); err != nil {
			t.Fatal(err)
		}
		if _, err := p.Exec(ctx, `insert into profiles (id, email, name, role, is_superadmin, escopo_por_equipe,
			  allowed_accounts, features, disabled)
			values ($1::uuid, $2::text, $3::text, $4::text, $5::boolean, $6::boolean, $7::uuid[], $8::text[], $9::boolean)`,
			x.ID, x.Email, x.Chave, x.Papel, x.Super, x.Trava, x.Contas, modulos, x.Desativado); err != nil {
			t.Fatal(err)
		}
		tok, err := s.Criar(ctx, x.ID, "painel", nil)
		if err != nil {
			t.Fatal(err)
		}
		m.Tok[x.Chave] = tok
	}
	for chave, par := range o.Impersonadas {
		por := par[1]
		tok, err := s.Criar(ctx, par[0], "painel", &por)
		if err != nil {
			t.Fatal(err)
		}
		m.Tok[chave] = tok
	}
	if o.Linhas != "" {
		if _, err := p.Exec(ctx, o.Linhas); err != nil {
			t.Fatal(err)
		}
	}
	r := chi.NewRouter()
	r.Group(func(r chi.Router) {
		r.Use(auth.Exigir(p, s))
		r.Use(autz.ComEscopo(p))
		for _, f := range montar {
			f(r, p)
		}
	})
	m.H = r
	return m
}

// Resposta faz a requisição como `quem` ("" = sem sessão).
func (m *Mundo) Resposta(t *testing.T, quem, metodo, caminho, corpo string) *httptest.ResponseRecorder {
	t.Helper()
	r := httptest.NewRequest(metodo, caminho, strings.NewReader(corpo))
	if quem != "" {
		tok, ok := m.Tok[quem]
		if !ok {
			t.Fatalf("pessoa %q fora do mundo", quem)
		}
		r.Header.Set("Authorization", "Bearer "+tok)
	}
	w := httptest.NewRecorder()
	m.H.ServeHTTP(w, r)
	return w
}

func (m *Mundo) Pedir(t *testing.T, quem, metodo, caminho, corpo string) (int, string) {
	t.Helper()
	w := m.Resposta(t, quem, metodo, caminho, corpo)
	return w.Code, w.Body.String()
}

// Um roda uma consulta de UMA coluna ::text (nulo = "<nulo>").
func (m *Mundo) Um(t *testing.T, sql string, args ...any) string {
	t.Helper()
	var v *string
	if err := m.P.QueryRow(context.Background(), sql, args...).Scan(&v); err != nil {
		t.Fatalf("%s: %v", sql, err)
	}
	if v == nil {
		return "<nulo>"
	}
	return *v
}

// Caso: uma requisição e o que tem de sair dela. Efeito/Quer: consulta rodada DEPOIS (o "negado não
// grava"); caso sem Metodo só confere o efeito.
type Caso struct {
	Nome, Quem, Metodo, Caminho, Corpo string
	Status                             int
	Tem, NaoTem                        string
	Efeito, Quer                       string
}

func (m *Mundo) Rodar(t *testing.T, casos []Caso) {
	t.Helper()
	for _, c := range casos {
		if c.Metodo != "" {
			st, corpo := m.Pedir(t, c.Quem, c.Metodo, c.Caminho, c.Corpo)
			if st != c.Status || (c.Tem != "" && !strings.Contains(corpo, c.Tem)) || (c.NaoTem != "" && strings.Contains(corpo, c.NaoTem)) {
				t.Errorf("%s: %s %s como %q = %d %s; esperava %d com %q e sem %q", c.Nome, c.Metodo, c.Caminho, c.Quem, st, corpo, c.Status, c.Tem, c.NaoTem)
			}
		}
		if c.Efeito != "" {
			if v := m.Um(t, c.Efeito); v != c.Quer {
				t.Errorf("%s: efeito %q = %q, esperava %q", c.Nome, c.Efeito, v, c.Quer)
			}
		}
	}
}
```

`mundoteste_test.go`: `TestMundoTeste` com duas pessoas (`a`: módulo `frota`; `b`: nenhum), `Impersonadas{"imp": {idB, idA}}`, `Linhas: "create table eco_teste (x int); insert into eco_teste values (1)"` e uma sonda `GET /eco` que escreve `strings.Join(e.Modulos, ",") + "|" + strconv.FormatBool(a.ImpersonadorID != nil)`: sem sessão → 401; `a` → `frota|false`; `imp` → `|true`; `m.Um(t, "select count(*)::text from eco_teste")` → `1`.

- [ ] **Step 2: O adaptador do 5.1.** Em `api/internal/acesso/mundo_test.go`, troque a struct `mundo`, `novoMundo`, `resposta`, `pedir`, `um` e `rodar` (mantenha `pessoas`, `linhasDoMundo`, `fotoDoMundo`, as constantes e a struct `caso`) por:

```go
type mundo struct {
	*mundoteste.Mundo
	p   *pgxpool.Pool
	h   http.Handler
	tok map[string]string
}

// novoMundo: o mundo do 5.1 sobre o mundoteste (Task 3 do 5.2); os testes do 5.1 não mudam.
func novoMundo(t *testing.T, montar ...func(chi.Router, *pgxpool.Pool)) *mundo {
	t.Helper()
	ps := make([]mundoteste.Pessoa, len(pessoas))
	for i, x := range pessoas {
		ps[i] = mundoteste.Pessoa{Chave: x.chave, ID: x.id, Email: x.email, Papel: x.papel, Super: x.super, Trava: x.trava, Contas: x.contas}
	}
	w := mundoteste.Novo(t, mundoteste.Opcoes{Pessoas: ps, Linhas: linhasDoMundo,
		Impersonadas: map[string][2]string{"impersonado": {idAdmin, idSuper}}}, montar...)
	return &mundo{Mundo: w, p: w.P, h: w.H, tok: w.Tok}
}

func (m *mundo) resposta(t *testing.T, quem, metodo, caminho, corpo string) *httptest.ResponseRecorder {
	t.Helper()
	return m.Resposta(t, quem, metodo, caminho, corpo)
}

func (m *mundo) pedir(t *testing.T, quem, metodo, caminho, corpo string) (int, string) {
	t.Helper()
	return m.Pedir(t, quem, metodo, caminho, corpo)
}

func (m *mundo) um(t *testing.T, sql string, args ...any) string {
	t.Helper()
	return m.Um(t, sql, args...)
}

func (m *mundo) rodar(t *testing.T, casos []caso) {
	t.Helper()
	cs := make([]mundoteste.Caso, len(casos))
	for i, c := range casos {
		cs[i] = mundoteste.Caso{Nome: c.nome, Quem: c.quem, Metodo: c.metodo, Caminho: c.caminho, Corpo: c.corpo,
			Status: c.status, Tem: c.tem, NaoTem: c.naoTem, Efeito: c.efeito, Quer: c.quer}
	}
	m.Rodar(t, cs)
}
```

(Imports: tire `context`, `strings`, `auth`, `autz`, `testebanco` se ficarem sem uso; acrescente `mundoteste`.)

- [ ] **Step 3: O pacote e o mundo do Patrimônio.** Crie `api/internal/patrimonio/patrimonio.go`:

```go
// Package patrimonio: as rotas do sub-plano 5.2 — bens (com o escopo por time de pode_ver_bem), a
// posse (que segue o bem), a árvore Marca › Local › Ambiente, categorias e tipos, a configuração e o
// log do Patrimônio, e as RPCs do cadastro rápido e da ligação carro ↔ bem. Toda regra é a do
// catálogo de produção (autz.Producao); toda escrita roda em banco.ComUsuario (os gatilhos do bem e do
// carro rodam com quem pede); sessão de "entrar como" só lê (Ruling 5.2-3).
package patrimonio

import (
	"encoding/json"
	"fmt"
	"strings"
	"unicode/utf8"

	"github.com/rbv-co/social-dashboard/api/internal/dados"
)

// soSessaoPropria vai em TODA escrita de tabela do 5.2 (TestEscritasRecusamImpersonado confere).
var soSessaoPropria = dados.SoSessaoPropria(dados.FraseEntrarComo)

// deve: declaração de rota errada faz a API não subir.
func deve(err error) {
	if err != nil {
		panic(err)
	}
}

// texto confere um campo de texto obrigatório-quando-presente: ausente passa (a não ser que seja
// obrigatório); presente (inclusive null) tem de ser string com 1 a max caracteres sem os espaços das pontas.
func texto(campo string, v json.RawMessage, max int, obrigatorio bool) error {
	if v == nil {
		if obrigatorio {
			return fmt.Errorf("Falta %s.", campo)
		}
		return nil
	}
	var s string
	if json.Unmarshal(v, &s) != nil || strings.TrimSpace(s) == "" || utf8.RuneCountInString(s) > max {
		return fmt.Errorf("Confira %s: texto de 1 a %d caracteres.", campo, max)
	}
	return nil
}

// textoOuNulo: ausente ou null passa; senão, string de até max caracteres.
func textoOuNulo(campo string, v json.RawMessage, max int) error {
	if v == nil || string(v) == "null" {
		return nil
	}
	var s string
	if json.Unmarshal(v, &s) != nil || utf8.RuneCountInString(s) > max {
		return fmt.Errorf("Confira %s: texto de até %d caracteres.", campo, max)
	}
	return nil
}
```

Crie `api/internal/patrimonio/mundo_test.go`:

```go
package patrimonio

import (
	"encoding/json"
	"slices"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/testebanco/mundoteste"
)

type caso = mundoteste.Caso

// Pessoas, cadastros e bens do mundo do 5.2 (ids fixos).
const (
	idPatGeral   = "5e200000-0000-4000-a000-000000000001" // patrimônio SEM trava: vê todos os bens
	idPatT1      = "5e200000-0000-4000-a000-000000000002" // patrimônio com trava, no time T1 (local L1); a P1 é ela
	idPatT2      = "5e200000-0000-4000-a000-000000000003" // patrimônio com trava, no time T2 (local L2)
	idFrota      = "5e200000-0000-4000-a000-000000000004" // só frota: lê e cria marca, local e ambiente; não lê bem
	idAcessos    = "5e200000-0000-4000-a000-000000000005" // só acessos: cadastro rápido, nada de patrimônio
	idViewer     = "5e200000-0000-4000-a000-000000000006" // nada
	idSuperFicha = "5e200000-0000-4000-a000-000000000007" // super pela ficha, papel viewer, sem módulo (frota pela ficha)

	P1 = "9e200000-0000-4000-a000-000000000001" // acessos_pessoas da patT1 (profile_id)
	P2 = "9e200000-0000-4000-a000-000000000002" // motorista, sem login
	S1 = "a6000000-0000-4000-a000-000000000001"

	E1   = "a1000000-0000-4000-a000-000000000001"
	E2   = "a1000000-0000-4000-a000-000000000002"
	L1   = "a2000000-0000-4000-a000-000000000001" // local do T1
	L2   = "a2000000-0000-4000-a000-000000000002" // local do T2
	L3   = "a2000000-0000-4000-a000-000000000003" // local sem time
	C1   = "a3000000-0000-4000-a000-000000000001" // ambiente em L1
	CatV = "a4000000-0000-4000-a000-000000000001" // Veículos
	CatM = "a4000000-0000-4000-a000-000000000002" // Móveis e Utensílios
	TpM  = "a5000000-0000-4000-a000-000000000001" // Mesa (Móveis)
	T1   = "e2000000-0000-4000-a000-000000000001"
	T2   = "e2000000-0000-4000-a000-000000000002"

	B1  = "b0000000-0000-4000-a000-000000000001" // em L1
	B2  = "b0000000-0000-4000-a000-000000000002" // em L2
	B3  = "b0000000-0000-4000-a000-000000000003" // em L3, com a P1 (a patT1 vê pela mão)
	B4  = "b0000000-0000-4000-a000-000000000004" // sem local nem pessoa
	BV  = "b0000000-0000-4000-a000-000000000005" // veículo em L1, ligado ao V1
	BV2 = "b0000000-0000-4000-a000-000000000006" // veículo em L1, sem carro
	PO1 = "b1000000-0000-4000-a000-000000000001" // posse aberta do B1
	PO2 = "b1000000-0000-4000-a000-000000000002" // posse aberta do B2
	PO3 = "b1000000-0000-4000-a000-000000000003" // posse fechada do B3
	V1  = "f0000000-0000-4000-a000-000000000001"
	U1  = "f1000000-0000-4000-a000-000000000001" // posse aberta do V1 na frota
)

var pessoas = []mundoteste.Pessoa{
	{Chave: "patGeral", ID: idPatGeral, Email: "patgeral@x.com", Papel: "viewer", Modulos: []string{"patrimonio"}},
	{Chave: "patT1", ID: idPatT1, Email: "patt1@x.com", Papel: "viewer", Trava: true, Modulos: []string{"patrimonio"}},
	{Chave: "patT2", ID: idPatT2, Email: "patt2@x.com", Papel: "viewer", Trava: true, Modulos: []string{"patrimonio"}},
	{Chave: "frota", ID: idFrota, Email: "frota@x.com", Papel: "viewer", Trava: true, Modulos: []string{"frota"}},
	{Chave: "acessos", ID: idAcessos, Email: "acessos@x.com", Papel: "viewer", Trava: true, Modulos: []string{"acessos"}},
	{Chave: "viewer", ID: idViewer, Email: "viewer@x.com", Papel: "viewer", Trava: true},
	{Chave: "superFicha", ID: idSuperFicha, Email: "superficha@x.com", Papel: "viewer", Super: true, Trava: true},
}

// sem identidade; ligar o V1 ao BV no insert dispara o espelho de situação (já batem: em_uso/ativo)
const linhasDoMundo = `
insert into acessos_pessoas (id, nome, profile_id) values ('` + P1 + `', 'Pessoa da T1', '` + idPatT1 + `'), ('` + P2 + `', 'Motorista', null);
insert into acessos_setores (id, nome, ordem) values ('` + S1 + `', 'Administrativo', 1);
insert into patrimonio_empresas (id, nome, ordem) values ('` + E1 + `', 'Vessel', 1), ('` + E2 + `', 'RBV Company', 2);
insert into patrimonio_locais (id, nome, ordem, empresa_id) values ('` + L1 + `', 'Loja Tivoli', 1, '` + E1 + `'),
  ('` + L2 + `', 'Loja Dom Pedro', 2, '` + E1 + `'), ('` + L3 + `', 'Sede Limeira', 1, '` + E2 + `');
insert into patrimonio_comodos (id, nome, ordem, local_id) values ('` + C1 + `', 'Operação Loja', 1, '` + L1 + `');
insert into patrimonio_categorias (id, nome, ordem) values ('` + CatM + `', 'Móveis e Utensílios', 2), ('` + CatV + `', 'Veículos', 6);
insert into patrimonio_tipos (id, categoria_id, nome, ordem) values ('` + TpM + `', '` + CatM + `', 'Mesa', 1);
insert into patrimonio_config (chave, valor) values ('numero_maximo', '400');
insert into equipes (id, nome, local_id) values ('` + T1 + `', 'Tivoli', '` + L1 + `'), ('` + T2 + `', 'Dom Pedro', '` + L2 + `');
insert into equipes_membros (equipe_id, profile_id, papel) values ('` + T1 + `', '` + idPatT1 + `', 'vendedora'), ('` + T2 + `', '` + idPatT2 + `', 'vendedora');
insert into patrimonio_bens (id, numero, nome, local_id, categoria_id, pessoa_id, situacao) values
  ('` + B1 + `', 1, 'Cadeira da Tivoli', '` + L1 + `', '` + CatM + `', null, 'em_uso'),
  ('` + B2 + `', 2, 'Cadeira do Dom Pedro', '` + L2 + `', '` + CatM + `', null, 'em_uso'),
  ('` + B3 + `', 3, 'Notebook da Pessoa T1', '` + L3 + `', null, '` + P1 + `', 'em_uso'),
  ('` + B4 + `', 4, 'Mesa sem lugar', null, '` + CatM + `', null, 'em_estoque'),
  ('` + BV + `', 10, 'Kwid', '` + L1 + `', '` + CatV + `', '` + P2 + `', 'em_uso'),
  ('` + BV2 + `', 11, 'Kwid novo', '` + L1 + `', '` + CatV + `', null, 'em_estoque');
insert into patrimonio_posse (id, bem_id, pessoa_id, pessoa_nome, de, ate) values
  ('` + PO1 + `', '` + B1 + `', '` + P2 + `', 'Motorista', '2026-01-01', null),
  ('` + PO2 + `', '` + B2 + `', '` + P2 + `', 'Motorista', '2026-01-01', null),
  ('` + PO3 + `', '` + B3 + `', '` + P1 + `', 'Pessoa da T1', '2025-01-01', '2025-12-31');
insert into frota_veiculos (id, placa, nome, situacao, pessoa_id, bem_id) values ('` + V1 + `', 'ABC1D23', 'Kwid', 'ativo', '` + P2 + `', '` + BV + `');
insert into frota_uso (id, veiculo_id, pessoa_id, tipo) values ('` + U1 + `', '` + V1 + `', '` + P2 + `', 'posse');`

// fotoDoMundo: um hash de tudo que o 5.2 pode gravar (direto ou por gatilho). Igual antes e depois = nada mudou.
const fotoDoMundo = `select md5(string_agg(l, '|' order by l)) from (
  select 'bens:' || t::text as l from patrimonio_bens t union all
  select 'posse:' || t::text from patrimonio_posse t union all
  select 'empresas:' || t::text from patrimonio_empresas t union all
  select 'locais:' || t::text from patrimonio_locais t union all
  select 'comodos:' || t::text from patrimonio_comodos t union all
  select 'categorias:' || t::text from patrimonio_categorias t union all
  select 'tipos:' || t::text from patrimonio_tipos t union all
  select 'config:' || t::text from patrimonio_config t union all
  select 'log:' || t::text from patrimonio_log t union all
  select 'pessoas:' || t::text from acessos_pessoas t union all
  select 'setores:' || t::text from acessos_setores t union all
  select 'veiculos:' || t::text from frota_veiculos t union all
  select 'usos:' || t::text from frota_uso t) z`

func novoMundo(t *testing.T, montar ...func(chi.Router, *pgxpool.Pool)) *mundoteste.Mundo {
	t.Helper()
	return mundoteste.Novo(t, mundoteste.Opcoes{Pessoas: pessoas, Linhas: linhasDoMundo,
		Impersonadas: map[string][2]string{"impersonado": {idPatGeral, idSuperFicha}}}, montar...)
}

func contar(tabela string) string { return "select count(*)::text from " + tabela }

func col(tabela, coluna, id string) string {
	return "select " + coluna + "::text from " + tabela + " where id = '" + id + "'"
}

// ids: os "id" de uma lista JSON, em ordem.
func ids(t *testing.T, corpo string) []string {
	t.Helper()
	var l []struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal([]byte(corpo), &l); err != nil {
		t.Fatalf("%v: %s", err, corpo)
	}
	out := make([]string, len(l))
	for i, x := range l {
		out[i] = x.ID
	}
	slices.Sort(out)
	return out
}
```

`patrimonio_test.go`: `TestMundoDoPatrimonio` com a sonda `GET /eco` que escreve `fmt.Sprintf("%v|%v|%v|%v", e.Locais, e.Pessoas, e.SemTrava, a.ImpersonadorID != nil)` (a partir de `autz.EscopoDo` e `auth.AtorDoContexto`) e os casos de (b); `m.Um(t, contar("patrimonio_bens"))` → `6`; `m.Um(t, fotoDoMundo)` ≠ `<nulo>`.

- [ ] **Step 4: Rodar.** `gofmt -l ./internal && go vet ./internal/testebanco/... ./internal/patrimonio/ ./internal/acesso/ && go test -count=1 ./internal/testebanco/... ./internal/patrimonio/ ./internal/acesso/` → `ok`. Mutação que tem de reprovar: em `mundoteste.Novo`, montar as rotas sem `autz.ComEscopo` (a sonda responde 500 e `TestMundoDoPatrimonio` cai).

- [ ] **Step 5: Commit.** `git add api/internal/testebanco/mundoteste/ api/internal/acesso/mundo_test.go api/internal/patrimonio/ && git commit -m "test(api): mundo de teste das rotas extraído do 5.1 (mundoteste) e o mundo do Patrimônio"` (+ linha `Co-Authored-By`).

---

### Task 4: Bens — `GET/POST/PATCH/DELETE /patrimonio/bens`

**Revisor:** opus. **Depende de:** 2, 3.

**(a) Contrato** (as declarações são o código; `soSessaoPropria` em toda escrita)

```go
const colunasBem = `t.id, t.numero, t.nome, t.valor_centavos, t.data_compra, t.empresa_id, t.local_id, t.comodo_id, ` +
	`t.categoria_id, t.tipo_id, t.marca, t.numero_serie, t.pessoa_id, t.dono_texto, t.etiquetado, t.situacao, ` +
	`t.observacao, t.detalhes, t.criado_em, t.atualizado_em`

// GET /patrimonio/bens. Regras: patrimonio_bens_rw (is_patrimonio_admin) E a restritiva
// patrimonio_bens_so_do_meu_time (pode_ver_bem(local_id, pessoa_id)). Os três nomes que a ficha de
// Acessos embute (tela-de-acessos.vue:2076) vêm sempre ({nome} ou null), cada um com a regra de Ler
// da sua tabela (Ruling 5.2-7). Filtro pessoa_id (a ficha de Acessos); ordens numero (padrão) e nome.
var consultaBens = dados.Consulta{
	Tabela: "patrimonio_bens", Alias: "t",
	SQL: `select ` + colunasBem + `,
	        case when cat.id is null then null else json_build_object('nome', cat.nome) end as patrimonio_categorias,
	        case when loc.id is null then null else json_build_object('nome', loc.nome) end as patrimonio_locais,
	        case when amb.id is null then null else json_build_object('nome', amb.nome) end as patrimonio_comodos
	      from patrimonio_bens t
	      left join patrimonio_categorias cat on {ler:patrimonio_categorias:cat} and cat.id = t.categoria_id
	      left join patrimonio_locais loc on {ler:patrimonio_locais:loc} and loc.id = t.local_id
	      left join patrimonio_comodos amb on {ler:patrimonio_comodos:amb} and amb.id = t.comodo_id`,
	Filtros:     []dados.Filtro{{Param: "pessoa_id", SQL: "t.pessoa_id = @pessoa_id::uuid", Tipo: "uuid"}},
	Ordens:      map[string]string{"numero": "t.numero", "nome": "t.nome"},
	OrdemPadrao: "t.numero",
	Desempate:   "t.id",
}

// corpoBem: as colunas que salvarBem grava (tela-de-patrimonio.vue:1659-1678). Ausente = não muda;
// null = limpa. atualizado_em vem da tela, como hoje (Ruling 5.2-11).
type corpoBem struct {
	Nome          json.RawMessage `json:"nome,omitempty"`
	Numero        json.RawMessage `json:"numero,omitempty"`
	NumeroSerie   json.RawMessage `json:"numero_serie,omitempty"`
	ValorCentavos json.RawMessage `json:"valor_centavos,omitempty"`
	DataCompra    json.RawMessage `json:"data_compra,omitempty"`
	EmpresaID     json.RawMessage `json:"empresa_id,omitempty"`
	LocalID       json.RawMessage `json:"local_id,omitempty"`
	ComodoID      json.RawMessage `json:"comodo_id,omitempty"`
	CategoriaID   json.RawMessage `json:"categoria_id,omitempty"`
	TipoID        json.RawMessage `json:"tipo_id,omitempty"`
	Marca         json.RawMessage `json:"marca,omitempty"`
	PessoaID      json.RawMessage `json:"pessoa_id,omitempty"`
	DonoTexto     json.RawMessage `json:"dono_texto,omitempty"`
	Situacao      json.RawMessage `json:"situacao,omitempty"`
	Observacao    json.RawMessage `json:"observacao,omitempty"`
	Etiquetado    json.RawMessage `json:"etiquetado,omitempty"`
	AtualizadoEm  json.RawMessage `json:"atualizado_em,omitempty"`
}

// Validar: o nome, se veio, é texto (o POST sem nome cai no not null: 400). O resto é o tipo e o
// check da coluna.
func (c corpoBem) Validar() error { return texto("o nome", c.Nome, 200, false) }

// POST (CriarSoLegivel: com trava de time só cria o que vai ver — Ruling 5.2-2), PATCH /{id}
// (PodeEditar: Ler + rw + editar_so_do_meu_time na antiga e na nova) e DELETE /{id} (Ler + rw +
// apagar_so_do_meu_time). Os gatilhos do bem rodam em banco.ComUsuario; a resposta é a linha DEPOIS deles.
var tabelaBens = dados.Tabela{Nome: "patrimonio_bens", Resposta: colunasBem, CriarSoLegivel: true}

func montarBens(r chi.Router, p *pgxpool.Pool) {
	deve(tabelaBens.Validar(autz.Producao))
	r.Get("/patrimonio/bens", consultaBens.Handler(p, autz.Producao))
	r.With(soSessaoPropria).Post("/patrimonio/bens", dados.RotaCriar[corpoBem](p, autz.Producao, tabelaBens))
	r.With(soSessaoPropria).Patch("/patrimonio/bens/{id}", dados.RotaEditar[corpoBem](p, autz.Producao, tabelaBens))
	r.With(soSessaoPropria).Delete("/patrimonio/bens/{id}", dados.RotaApagar(p, autz.Producao, tabelaBens))
}
```

O marcador vem ANTES da condição do `on` (a gramática do 5.0 o quer como termo de `and` precedido de `on`/`and` e seguido de `and`/`)`). `json_build_object` escreve `{"nome" : "x"}` com espaços dentro do objeto embutido: os testes procuram o nome, não os bytes (Ruling 8 do mestre).

**(b) Testes de aceitação** (`TestBensLeitura`, `TestBensEscrita`; código abaixo)

**(c) Arquivos:** Create `api/internal/patrimonio/bens.go`, `api/internal/patrimonio/bens_test.go`.

**(d) Dependências:** Task 2 (`CriarSoLegivel`), Task 3 (mundo, `soSessaoPropria`, `deve`, `texto`); 5.1 `dados.Tabela/RotaCriar/RotaEditar/RotaApagar`.

- [ ] **Step 1: Os testes que falham.** Crie `api/internal/patrimonio/bens_test.go`:

```go
package patrimonio

import (
	"slices"
	"testing"
)

// VAZAMENTO: cada pessoa recebe exatamente os bens que pode_ver_bem deixa (e nenhum sem o módulo).
func TestBensLeitura(t *testing.T) {
	m := novoMundo(t, montarBens)
	for quem, quer := range map[string][]string{
		"patGeral":   {B1, B2, B3, B4, BV, BV2},
		"patT1":      {B1, B3, BV, BV2}, // L1 pelo time; B3 pela mão (a P1 é ela)
		"patT2":      {B2},
		"frota":      {},
		"acessos":    {},
		"viewer":     {},
		"superFicha": {}, // paridade: a permissiva exige is_patrimonio_admin (Ruling 5.2-16)
	} {
		slices.Sort(quer)
		st, corpo := m.Pedir(t, quem, "GET", "/patrimonio/bens", "")
		if got := ids(t, corpo); st != 200 || !slices.Equal(got, quer) {
			t.Errorf("%s vê %v (%d), esperava %v", quem, got, st, quer)
		}
	}
	m.Rodar(t, []caso{
		{Nome: "sem sessão", Metodo: "GET", Caminho: "/patrimonio/bens", Status: 401},
		{Nome: "IDOR por filtro: a T2 pedindo os bens do motorista do carro da T1", Quem: "patT2", Metodo: "GET",
			Caminho: "/patrimonio/bens?pessoa_id=" + P2, Status: 200, Tem: "[]"},
		{Nome: "pela mão: o notebook da P1 em local sem time, com o nome do local embutido", Quem: "patT1", Metodo: "GET",
			Caminho: "/patrimonio/bens?pessoa_id=" + P1, Status: 200, Tem: "Sede Limeira", NaoTem: "Cadeira"},
		{Nome: "embutido sem categoria sai null", Quem: "patT1", Metodo: "GET", Caminho: "/patrimonio/bens?pessoa_id=" + P1,
			Status: 200, Tem: `"patrimonio_categorias":null`},
		{Nome: "a outra trava não vê o que está com a P1", Quem: "patT2", Metodo: "GET", Caminho: "/patrimonio/bens?pessoa_id=" + P1,
			Status: 200, Tem: "[]"},
		{Nome: "a Frota pede os bens para ligar carro: vazio sem o módulo (paridade)", Quem: "frota", Metodo: "GET",
			Caminho: "/patrimonio/bens?ordem=nome&limite=500", Status: 200, Tem: "[]"},
		{Nome: "ordem fora da lista", Quem: "patGeral", Metodo: "GET", Caminho: "/patrimonio/bens?ordem=valor_centavos", Status: 400},
		{Nome: "filtro que não existe não vira filtro silencioso", Quem: "patGeral", Metodo: "GET", Caminho: "/patrimonio/bens?local_id=" + L1, Status: 400},
		{Nome: "pessoa_id malformado", Quem: "patGeral", Metodo: "GET", Caminho: "/patrimonio/bens?pessoa_id=1%20or%201=1", Status: 400},
	})
	if w := m.Resposta(t, "patT1", "GET", "/patrimonio/bens?pessoa_id="+P1+"&contar=1&limite=1", ""); w.Header().Get("X-Total-Count") != "1" {
		t.Errorf("X-Total-Count = %q (o contador da ficha de Acessos)", w.Header().Get("X-Total-Count"))
	}
}

func TestBensEscrita(t *testing.T) {
	m := novoMundo(t, montarBens)
	u := func(id string) string { return "/patrimonio/bens/" + id }
	criar := func(nome, quem, corpo string, status int, total string) caso {
		return caso{Nome: nome, Quem: quem, Metodo: "POST", Caminho: "/patrimonio/bens", Corpo: corpo, Status: status,
			Efeito: contar("patrimonio_bens"), Quer: total}
	}
	carro := `select coalesce(v.pessoa_id::text, '-') || '|' || v.situacao || '|' || (u.volta_em is null)::text
		from frota_veiculos v join frota_uso u on u.veiculo_id = v.id where v.id = '` + V1 + `'`
	m.Rodar(t, []caso{
		criar("sem o módulo patrimônio não cria", "frota", `{"nome":"Mesa","local_id":"`+L1+`"}`, 403, "6"),
		criar("sem trava cria em qualquer local", "patGeral",
			`{"nome":"Mesa nova","numero":20,"local_id":"`+L2+`","categoria_id":"`+CatM+`","atualizado_em":"2026-10-12T12:00:00Z"}`, 201, "7"),
		criar("com trava cria no local do time", "patT1", `{"nome":"Cadeira nova","local_id":"`+L1+`"}`, 201, "8"),
		criar("com trava NÃO cria no local de outro time (Ruling 5.2-2)", "patT1", `{"nome":"Fora","local_id":"`+L2+`"}`, 403, "8"),
		criar("com trava NÃO cria item sem local nem pessoa (não o veria)", "patT1", `{"nome":"Solto"}`, 403, "8"),
		criar("local que não existe responde igual ao alheio (sem oráculo)", "patT1",
			`{"nome":"X","local_id":"a2000000-0000-4000-a000-000000000099"}`, 403, "8"),
		criar("número de etiqueta repetido", "patGeral", `{"nome":"X","numero":1}`, 409, "8"),
		criar("situação fora da lista", "patGeral", `{"nome":"X","situacao":"perdido"}`, 400, "8"),
		criar("sem nome", "patGeral", `{"numero":30}`, 400, "8"),
		criar("nome em branco", "patGeral", `{"nome":"   "}`, 400, "8"),
		criar("coluna que a tela não grava", "patGeral", `{"nome":"X","criado_em":"2020-01-01T00:00:00Z"}`, 400, "8"),
		criar("entrar como não cria", "impersonado", `{"nome":"X"}`, 403, "8"),

		{Nome: "edita o que vê", Quem: "patT1", Metodo: "PATCH", Caminho: u(B1), Corpo: `{"observacao":"riscada"}`,
			Status: 200, Tem: `"observacao":"riscada"`, Efeito: col("patrimonio_bens", "observacao", B1), Quer: "riscada"},
		{Nome: "IDOR: bem de outro time é 404 e fica intacto", Quem: "patT1", Metodo: "PATCH", Caminho: u(B2),
			Corpo: `{"observacao":"x"}`, Status: 404, Efeito: col("patrimonio_bens", "observacao", B2), Quer: "<nulo>"},
		{Nome: "IDOR: a outra trava também não mexe no da T1", Quem: "patT2", Metodo: "PATCH", Caminho: u(B1),
			Corpo: `{"observacao":"y"}`, Status: 404, Efeito: col("patrimonio_bens", "observacao", B1), Quer: "riscada"},
		{Nome: "mover para local de outro time: 403 (sairia do que ela vê)", Quem: "patT1", Metodo: "PATCH", Caminho: u(B1),
			Corpo: `{"local_id":"` + L2 + `"}`, Status: 403, Efeito: col("patrimonio_bens", "local_id", B1), Quer: L1},
		{Nome: "passar adiante o que só vê pela mão: 403, paridade com o WITH CHECK", Quem: "patT1", Metodo: "PATCH", Caminho: u(B3),
			Corpo: `{"pessoa_id":"` + P2 + `"}`, Status: 403, Efeito: col("patrimonio_bens", "pessoa_id", B3), Quer: P1},
		{Nome: "Frota não lê bem: 404", Quem: "frota", Metodo: "PATCH", Caminho: u(B1), Corpo: `{"observacao":"z"}`, Status: 404},
		{Nome: "id malformado", Quem: "patGeral", Metodo: "PATCH", Caminho: u("nao-e-uuid"), Corpo: `{"observacao":"z"}`, Status: 404},
		{Nome: "bem de veículo segue a frota: a resposta traz a situação do carro", Quem: "patGeral", Metodo: "PATCH", Caminho: u(BV),
			Corpo: `{"situacao":"em_estoque"}`, Status: 200, Tem: `"situacao":"em_uso"`, Efeito: carro, Quer: P2 + "|ativo|true"},
		{Nome: "o responsável espelha no carro e a posse do carro segue aberta", Quem: "patGeral", Metodo: "PATCH", Caminho: u(BV),
			Corpo: `{"pessoa_id":"` + P1 + `"}`, Status: 200, Efeito: carro, Quer: P1 + "|ativo|true"},
		{Nome: "bem sem responsável: o carro também, e a posse do carro fecha", Quem: "patGeral", Metodo: "PATCH", Caminho: u(BV),
			Corpo: `{"pessoa_id":null}`, Status: 200, Efeito: carro, Quer: "-|ativo|false"},
		{Nome: "entrar como não edita", Quem: "impersonado", Metodo: "PATCH", Caminho: u(B4), Corpo: `{"observacao":"x"}`,
			Status: 403, Tem: "Quem entrou como outra pessoa", Efeito: col("patrimonio_bens", "observacao", B4), Quer: "<nulo>"},

		{Nome: "IDOR: apagar bem de outro time é 404 e ele fica", Quem: "patT1", Metodo: "DELETE", Caminho: u(B2), Status: 404,
			Efeito: "select count(*)::text from patrimonio_bens where id = '" + B2 + "'", Quer: "1"},
		{Nome: "sem o módulo: 404 e fica", Quem: "viewer", Metodo: "DELETE", Caminho: u(B4), Status: 404,
			Efeito: "select count(*)::text from patrimonio_bens where id = '" + B4 + "'", Quer: "1"},
		{Nome: "apaga o que vê; a posse vai junto", Quem: "patGeral", Metodo: "DELETE", Caminho: u(B2), Status: 204,
			Efeito: "select count(*)::text from patrimonio_posse where bem_id = '" + B2 + "'", Quer: "0"},
		{Nome: "com trava apaga o do time", Quem: "patT1", Metodo: "DELETE", Caminho: u(BV2), Status: 204,
			Efeito: "select count(*)::text from patrimonio_bens where id = '" + BV2 + "'", Quer: "0"},
	})
}
```

Run: `cd api && go test -count=1 -run 'Bens' ./internal/patrimonio/` → FAIL de compilação (`montarBens`).

- [ ] **Step 2: Implementar.** Crie `api/internal/patrimonio/bens.go` com as declarações de (a) (imports: `encoding/json`, `chi`, `pgxpool`, `autz`, `dados`).

- [ ] **Step 3: Rodar e morder.** `gofmt -l ./internal && go vet ./internal/patrimonio/ && go test -count=1 -v -run 'Bens' ./internal/patrimonio/ 2>&1 | grep -E '^(--- |ok|FAIL)'` → PASS. Mutações que têm de reprovar: `CriarSoLegivel: false` (o "local de outro time" vira 201); trocar `{ler:patrimonio_locais:loc}` por `true` (o `Validar` recusa: a API não sobe); tirar `r.With(soSessaoPropria)` do PATCH.

- [ ] **Step 4: Commit.** `git add api/internal/patrimonio/bens.go api/internal/patrimonio/bens_test.go && git commit -m "feat(api): /patrimonio/bens com o escopo por time de produção e os gatilhos do bem vendo quem pede"` (+ `Co-Authored-By`).

---

### Task 5: Bens em massa — alterar (com a posse) e apagar

**Revisor:** opus. **Depende de:** 4 (`tabelaBens`), 6 (`tabelaPosses`).

**(a) Contrato**
- `POST /patrimonio/bens/em-massa` `{"ids": [uuid, …], "alteracao": {situacao?, empresa_id?, local_id?, comodo_id?, categoria_id?, pessoa_id?, dono_texto?, atualizado_em?}}` → `200 {"alterados": n}`. `ids`: 1 a 1000, uuid, sem repetição (senão 400); `alteracao` = as colunas de `montarAlteracaoEmMassa` (`src/ferramentas/patrimonio/acao-em-massa.js:14-21, 51`) + `atualizado_em` que a tela manda; ausente = não muda, `null` = limpa; `{}` = 400. Cada id passa pelo MESMO `tabelaBens.Editar` do PATCH (PodeEditar + update + gatilhos), em ordem de id, numa transação só: um negado (404/403) ou erro = NADA gravado (Ruling 5.2-4). Se `pessoa_id` veio, na mesma transação: fecha a posse aberta de cada bem (`ate` = hoje em São Paulo) e, havendo dono novo, abre a dele com `pessoa_nome` lido de `acessos_pessoas` e `motivo = 'alteração em massa'`, cada posse pelo `tabelaPosses.Editar/Criar` (Ruling 5.2-5) — o que `tela-de-patrimonio.vue:1902-1911` fazia em duas chamadas soltas.
- `POST /patrimonio/bens/apagar-em-massa` `{"ids": [...]}` → `204`. Cada id pelo `tabelaBens.Apagar`; tudo ou nada. As posses vão pela FK (`on delete cascade`).
- `soSessaoPropria` nas duas.

```go
package patrimonio

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"regexp"
	"slices"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/autz"
	"github.com/rbv-co/social-dashboard/api/internal/banco"
	"github.com/rbv-co/social-dashboard/api/internal/dados"
)

// LoteMaximo: a tela só marca o que lista (407 bens em produção, levantamento/07-linhas.csv).
const LoteMaximo = 1000

var reUUID = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)

type corpoEmMassa struct {
	IDs       []string        `json:"ids"`
	Alteracao corpoBemEmMassa `json:"alteracao"`
}

// corpoBemEmMassa: as colunas de montarAlteracaoEmMassa (acao-em-massa.js) e o atualizado_em que a tela manda.
type corpoBemEmMassa struct {
	Situacao     json.RawMessage `json:"situacao,omitempty"`
	EmpresaID    json.RawMessage `json:"empresa_id,omitempty"`
	LocalID      json.RawMessage `json:"local_id,omitempty"`
	ComodoID     json.RawMessage `json:"comodo_id,omitempty"`
	CategoriaID  json.RawMessage `json:"categoria_id,omitempty"`
	PessoaID     json.RawMessage `json:"pessoa_id,omitempty"`
	DonoTexto    json.RawMessage `json:"dono_texto,omitempty"`
	AtualizadoEm json.RawMessage `json:"atualizado_em,omitempty"`
}

type corpoApagarEmMassa struct {
	IDs []string `json:"ids"`
}

// idsDoLote: de 1 a LoteMaximo uuids distintos, EM ORDEM (duas massas simultâneas travam as linhas
// na mesma ordem: sem deadlock).
func idsDoLote(ids []string) ([]string, error) {
	if len(ids) == 0 || len(ids) > LoteMaximo {
		return nil, fmt.Errorf("Mande de 1 a %d itens.", LoteMaximo)
	}
	out := make([]string, len(ids))
	for i, id := range ids {
		out[i] = strings.ToLower(id)
		if !reUUID.MatchString(out[i]) {
			return nil, errors.New("Item inválido no lote.")
		}
	}
	slices.Sort(out)
	if len(slices.Compact(slices.Clone(out))) != len(out) {
		return nil, errors.New("Item repetido no lote.")
	}
	return out, nil
}

// emMassa: POST /patrimonio/bens/em-massa. Cada bem pelo MESMO caminho do PATCH unitário (o mapa de
// escrita sai da mesma struct; PodeEditar na mesma transação que grava). ponytail: ~3 consultas por
// item (até 1000); um update único com where id = any() quando o volume pedir — sem perder o PodeEditar por linha.
func emMassa(p *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		e := autz.EscopoDo(r.Context())
		if e == nil {
			dados.Erro(w, http.StatusInternalServerError, "erro_interno", "")
			return
		}
		var in corpoEmMassa
		if !dados.LerCorpo(w, r, &in) {
			return
		}
		lote, err := idsDoLote(in.IDs)
		if err != nil {
			dados.Erro(w, http.StatusBadRequest, "pedido_invalido", err.Error())
			return
		}
		campos, err := dados.Campos(&in.Alteracao)
		if err != nil {
			dados.Erro(w, http.StatusInternalServerError, "erro_interno", "")
			return
		}
		if len(campos) == 0 {
			dados.Erro(w, http.StatusBadRequest, "corpo_invalido", "Nada para gravar.")
			return
		}
		pessoa, trocaDono := campos["pessoa_id"]
		ctx := r.Context()
		err = banco.ComUsuario(ctx, p, e.ID, func(tx pgx.Tx) error {
			for _, id := range lote {
				if _, err := tabelaBens.Editar(ctx, tx, autz.Producao, e, id, campos); err != nil {
					return err
				}
			}
			if !trocaDono {
				return nil
			}
			return trocarDonoEmMassa(ctx, tx, e, lote, pessoa.(json.RawMessage))
		})
		if err != nil {
			dados.ErroDeEscrita(w, err)
			return
		}
		dados.Responder(w, http.StatusOK, fmt.Appendf(nil, `{"alterados":%d}`, len(lote)))
	}
}

// trocarDonoEmMassa: o que a tela fazia depois do update em massa (tela-de-patrimonio.vue:1902-1911), na
// MESMA transação (Ruling 5.2-5): fecha a posse aberta de cada bem com ate = hoje (São Paulo) e, havendo
// dono novo, abre a dele com motivo 'alteração em massa'. Cada posse passa pela regra do catálogo pelo
// mesmo caminho das rotas de posse. O pessoa_id já passou pela FK no update dos bens.
func trocarDonoEmMassa(ctx context.Context, tx pgx.Tx, e *autz.Escopo, lote []string, pessoa json.RawMessage) error {
	var hoje string
	if err := tx.QueryRow(ctx, `select ((now() at time zone 'America/Sao_Paulo')::date)::text`).Scan(&hoje); err != nil {
		return err
	}
	linhas, err := tx.Query(ctx, `select id::text from patrimonio_posse where bem_id = any(@ids::uuid[]) and ate is null order by id`,
		pgx.NamedArgs{"ids": lote})
	if err != nil {
		return err
	}
	abertas, err := pgx.CollectRows(linhas, pgx.RowTo[string])
	if err != nil {
		return err
	}
	for _, id := range abertas {
		if _, err := tabelaPosses.Editar(ctx, tx, autz.Producao, e, id, map[string]any{"ate": hoje}); err != nil {
			return err
		}
	}
	if string(pessoa) == "null" {
		return nil // sem dono novo: só fecha (a tela não abre posse de "ninguém")
	}
	var nome *string
	if err := tx.QueryRow(ctx, `select nome from acessos_pessoas where id = (@p::jsonb #>> '{}')::uuid`,
		pgx.NamedArgs{"p": string(pessoa)}).Scan(&nome); err != nil {
		return err
	}
	for _, id := range lote {
		if _, err := tabelaPosses.Criar(ctx, tx, autz.Producao, e, map[string]any{
			"bem_id": id, "pessoa_id": pessoa, "pessoa_nome": nome, "de": hoje, "motivo": "alteração em massa"}); err != nil {
			return err
		}
	}
	return nil
}

// apagarEmMassa: POST /patrimonio/bens/apagar-em-massa. Tudo ou nada, pelo mesmo Apagar do DELETE unitário.
func apagarEmMassa(p *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		e := autz.EscopoDo(r.Context())
		if e == nil {
			dados.Erro(w, http.StatusInternalServerError, "erro_interno", "")
			return
		}
		var in corpoApagarEmMassa
		if !dados.LerCorpo(w, r, &in) {
			return
		}
		lote, err := idsDoLote(in.IDs)
		if err != nil {
			dados.Erro(w, http.StatusBadRequest, "pedido_invalido", err.Error())
			return
		}
		ctx := r.Context()
		err = banco.ComUsuario(ctx, p, e.ID, func(tx pgx.Tx) error {
			for _, id := range lote {
				if err := tabelaBens.Apagar(ctx, tx, autz.Producao, e, id); err != nil {
					return err
				}
			}
			return nil
		})
		if err != nil {
			dados.ErroDeEscrita(w, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

func montarMassa(r chi.Router, p *pgxpool.Pool) {
	r.With(soSessaoPropria).Post("/patrimonio/bens/em-massa", emMassa(p))
	r.With(soSessaoPropria).Post("/patrimonio/bens/apagar-em-massa", apagarEmMassa(p))
}
```

**(b) Testes de aceitação** (`TestBensEmMassa`; `novoMundo(t, montarMassa)`; `lote := func(ids ...string) string { return `"ids":["` + strings.Join(ids, `","`) + `"]` }`; casos em ordem, cada um conferindo o efeito no banco)
- `patT1` em-massa `[B1, BV2]` `{situacao:"em_manutencao"}` → `200 {"alterados":2}`, BV2 `em_manutencao`.
- **`patT1` em-massa `[B1, B2]` `{situacao:"baixado"}` → 404 e B1 continua `em_manutencao`** (B1 vem antes na ordem: prova o tudo-ou-nada).
- `patT1` em-massa `[B1]` `{local_id:L2, comodo_id:null}` → 403, B1 em L1.
- `patGeral` em-massa `[B1, B2]` `{pessoa_id:P1, dono_texto:null}` → 200; PO1 e PO2 com `ate = (now() at time zone 'America/Sao_Paulo')::date`; 2 posses abertas com `motivo = 'alteração em massa'` e `pessoa_nome = 'Pessoa da T1'`.
- `patGeral` em-massa `[B1]` `{pessoa_id:null}` → 200; nenhuma posse aberta de B1; nenhuma posse nova.
- `patGeral` em-massa `[BV]` `{pessoa_id:null}` → 200; `V1.pessoa_id` nulo e U1 fechada (os gatilhos rodam no lote).
- Pedido inválido (400, nada muda): `ids: []`; 1001 ids; id repetido (`"repetido"`); `"1 or 1=1"`; `alteracao: {}` (`"Nada para gravar"`); `alteracao: {nome:"x"}` (`corpo_invalido`); `alteracao: {situacao:"perdido"}` com B4 → B4 continua `em_estoque`.
- `frota` em-massa `[B4]` → 404 (não lê bem), B4 intacto; `impersonado` → 403 com a frase, B4 intacto.
- apagar-em-massa: **`patT1` `[B1, B2]` → 404 e os dois ficam**; `patT1` `[B1, BV2]` → 204, os dois somem e as posses de B1 somem; `viewer` `[B4]` → 404, fica; `impersonado` `[B4]` → 403, fica; `patGeral` `[B4]` → 204.
- Mutações que têm de reprovar: trocar o laço de `tabelaBens.Editar` por um `update patrimonio_bens set … where id = any(@ids)` (o "id de outro time no meio" vira 200); tirar a chamada a `trocarDonoEmMassa` (as posses ficam abertas); rodar `trocarDonoEmMassa` numa SEGUNDA `banco.ComUsuario` (com uma posse negada, os bens ficam alterados).

**(c) Arquivos:** Create `api/internal/patrimonio/massa.go`, `api/internal/patrimonio/massa_test.go`.

**(d) Dependências:** Tasks 4 e 6; `dados.Campos/LerCorpo/Responder/ErroDeEscrita`; `banco.ComUsuario`.

- [ ] **Step 1:** Testes de (b); ver falhar (`montarMassa`). - [ ] **Step 2:** Implementar `massa.go` (código de (a)). - [ ] **Step 3:** `gofmt -l ./internal && go vet ./internal/patrimonio/ && go test -count=1 -v -run EmMassa ./internal/patrimonio/` → PASS; mutações reprovam. - [ ] **Step 4:** Commit `feat(api): bens em massa (alterar com a posse e apagar), tudo ou nada pelo mesmo caminho da edição unitária` (+ `Co-Authored-By`).

---

### Task 6: Posses — `GET/POST/PATCH /patrimonio/posses`

**Revisor:** opus. **Depende de:** 2, 3.

**(a) Contrato**

```go
const colunasPosse = `t.id, t.bem_id, t.pessoa_id, t.pessoa_nome, t.de, t.ate, t.motivo, t.criado_em`

// GET /patrimonio/posses. Regras: patrimonio_posse_rw (is_patrimonio_admin) E a restritiva
// patrimonio_posse_segue_o_bem (o bem é visível por pode_ver_bem). Filtros: bem_id (a ficha),
// aberta (relatório "com quem está": ate is null), de_desde/de_ate (relatório do período, pela data de início).
var consultaPosses = dados.Consulta{
	Tabela: "patrimonio_posse", Alias: "t",
	SQL: `select ` + colunasPosse + ` from patrimonio_posse t`,
	Filtros: []dados.Filtro{
		{Param: "bem_id", SQL: "t.bem_id = @bem_id::uuid", Tipo: "uuid"},
		{Param: "aberta", SQL: "(t.ate is null) = @aberta::boolean", Tipo: "booleano"},
		{Param: "de_desde", SQL: "t.de >= @de_desde::date", Tipo: "data"},
		{Param: "de_ate", SQL: "t.de <= @de_ate::date", Tipo: "data"},
	},
	Ordens:      map[string]string{"de": "t.de"},
	OrdemPadrao: "t.de desc",
	Desempate:   "t.id",
}

// corpoPosseNova: o que sincronizarPosse grava (tela-de-patrimonio.vue:1624-1630). pessoa_nome vem da
// tela, como hoje: é o nome congelado no histórico.
type corpoPosseNova struct {
	BemID      json.RawMessage `json:"bem_id,omitempty"`
	PessoaID   json.RawMessage `json:"pessoa_id,omitempty"`
	PessoaNome json.RawMessage `json:"pessoa_nome,omitempty"`
	De         json.RawMessage `json:"de,omitempty"`
	Ate        json.RawMessage `json:"ate,omitempty"`
	Motivo     json.RawMessage `json:"motivo,omitempty"`
}

// corpoFimDaPosse: o PATCH só fecha (tela-de-patrimonio.vue:1620); trocar o bem de uma posse não existe.
type corpoFimDaPosse struct {
	Ate json.RawMessage `json:"ate,omitempty"`
}

// POST (CriarSoLegivel: posse de bem que a pessoa não vê = 403, nada gravado — Ruling 5.2-2) e
// PATCH /{id} (PodeEditar: posse de bem invisível = 404).
var tabelaPosses = dados.Tabela{Nome: "patrimonio_posse", Resposta: colunasPosse, CriarSoLegivel: true}

func montarPosses(r chi.Router, p *pgxpool.Pool) // GET; POST; PATCH /{id} (soSessaoPropria nas escritas; deve(tabelaPosses.Validar))
```

**(b) Testes de aceitação** (`TestPosses`)
- Leitura (vazamento): `patT1` GET → exatamente `{PO1, PO3}` (sem PO2); `patT1` `?bem_id=`B2 → `[]`; `patT2` GET → `{PO2}`; `patGeral` `?aberta=true` → `{PO1, PO2}`; `?aberta=false` → `{PO3}`; `?de_desde=2026-01-01&de_ate=2026-12-31&ordem=de.desc` → `{PO1, PO2}`; `frota`, `acessos`, `viewer`, `superFicha` GET → `[]`; `?aberta=sim` → 400; `?bem_id=x` → 400.
- Criar: `patT1` POST `{bem_id:B1, pessoa_id:P1, pessoa_nome:"Pessoa da T1", de:"2026-10-12"}` → 201 com a linha; **`patT1` POST `{bem_id:B2, …}` → 403 e contagem igual**; `patT1` POST `{bem_id:"b0000000-0000-4000-a000-000000000099", …}` → 403 igual (sem oráculo); `frota` POST → 403; `patGeral` POST `{bem_id:B1, de:"ontem"}` → 400; sem `de` → 400; `impersonado` POST → 403; contagem conferida em cada recusa.
- Fechar: `patT1` PATCH PO1 `{ate:"2026-10-12"}` → 200; **`patT1` PATCH PO2 → 404, PO2 aberta**; `patT1` PATCH PO1 `{bem_id:B2}` → 400 `corpo_invalido`; `viewer` PATCH PO1 → 404; `impersonado` PATCH → 403.
- Mutações que têm de reprovar: `CriarSoLegivel: false` em `tabelaPosses` (a posse do B2 vira 201 `{"id"}`); trocar o `Tabela` da consulta por `patrimonio_bens` (o `Validar` recusa).

**(c) Arquivos:** Create `api/internal/patrimonio/posses.go`, `api/internal/patrimonio/posses_test.go`.

**(d) Dependências:** Tasks 2 e 3.

- [ ] **Step 1:** Teste; ver falhar. - [ ] **Step 2:** Implementar. - [ ] **Step 3:** gofmt/vet/test PASS; mutações reprovam. - [ ] **Step 4:** Commit `feat(api): /patrimonio/posses — a posse segue o bem (leitura, criação e fechamento)` (+ `Co-Authored-By`).

---

### Task 7: Cadastros — empresas, locais, cômodos, categorias e tipos

**Revisor:** sonnet. **Depende de:** 2, 3.

**(a) Contrato** (regras só de ator: nenhuma linha restringe; a assimetria Frota cria-mas-não-edita é a do catálogo)

| Recurso | Ler | Criar | Editar / Apagar |
|---|---|---|---|
| `/patrimonio/empresas`, `/patrimonio/locais`, `/patrimonio/comodos` | `is_patrimonio_admin` ∨ `is_frota_admin` (`*_leitura_frota`) | idem (`*_criar_frota`) | só `is_patrimonio_admin` (`*_rw`): a Frota vê (403), quem não vê leva 404 |
| `/patrimonio/categorias`, `/patrimonio/tipos` | `is_patrimonio_admin` | idem | idem (tipos: sem PATCH/DELETE, Ruling 5.2-8) |

```go
const (
	colunasMarca     = `t.id, t.nome, t.ordem, t.criado_em`
	colunasLocal     = `t.id, t.nome, t.ordem, t.criado_em, t.empresa_id`
	colunasAmbiente  = `t.id, t.nome, t.ordem, t.criado_em, t.local_id`
	colunasCategoria = `t.id, t.nome, t.vida_util_anos, t.ordem, t.criado_em`
	colunasTipo      = `t.id, t.categoria_id, t.nome, t.ordem, t.criado_em`
)

// Leituras: as duas telas pedem .order('ordem').order('nome') (padrão); o admin pede só nome.
// categorias tem nome_como: a Frota acha "Veículos" como a função sincronizar acha (ilike '%ve%cul%', Ruling 5.2-14).
var (
	consultaMarcas     = dados.Consulta{Tabela: "patrimonio_empresas", Alias: "t", SQL: `select ` + colunasMarca + ` from patrimonio_empresas t`, Ordens: map[string]string{"nome": "t.nome", "ordem": "t.ordem"}, OrdemPadrao: "t.ordem, t.nome", Desempate: "t.id"}
	consultaLocais     = dados.Consulta{Tabela: "patrimonio_locais", Alias: "t", SQL: `select ` + colunasLocal + ` from patrimonio_locais t`, Ordens: map[string]string{"nome": "t.nome", "ordem": "t.ordem"}, OrdemPadrao: "t.ordem, t.nome", Desempate: "t.id"}
	consultaAmbientes  = dados.Consulta{Tabela: "patrimonio_comodos", Alias: "t", SQL: `select ` + colunasAmbiente + ` from patrimonio_comodos t`, Ordens: map[string]string{"nome": "t.nome", "ordem": "t.ordem"}, OrdemPadrao: "t.ordem, t.nome", Desempate: "t.id"}
	consultaCategorias = dados.Consulta{Tabela: "patrimonio_categorias", Alias: "t", SQL: `select ` + colunasCategoria + ` from patrimonio_categorias t`,
		Filtros: []dados.Filtro{{Param: "nome_como", SQL: "t.nome ilike @nome_como::text", Tipo: "texto"}},
		Ordens:  map[string]string{"nome": "t.nome", "ordem": "t.ordem"}, OrdemPadrao: "t.ordem, t.nome", Desempate: "t.id"}
	consultaTipos = dados.Consulta{Tabela: "patrimonio_tipos", Alias: "t", SQL: `select ` + colunasTipo + ` from patrimonio_tipos t`, Ordens: map[string]string{"nome": "t.nome", "ordem": "t.ordem"}, OrdemPadrao: "t.ordem, t.nome", Desempate: "t.id"}
)

// Corpos do POST (o "+" das duas telas e as Listas: tela-de-patrimonio.vue:1436, 1533, 1974, 1988;
// tela-de-frota.vue:3188, 3271). Validar: nome obrigatório (1..200) e o pai obrigatório, com a frase da tela.
type corpoMarca struct {
	Nome  json.RawMessage `json:"nome,omitempty"`
	Ordem json.RawMessage `json:"ordem,omitempty"`
}
type corpoLocal struct {
	Nome      json.RawMessage `json:"nome,omitempty"`
	Ordem     json.RawMessage `json:"ordem,omitempty"`
	EmpresaID json.RawMessage `json:"empresa_id,omitempty"` // "Escolha a marca antes de criar um local novo."
}
type corpoAmbiente struct {
	Nome    json.RawMessage `json:"nome,omitempty"`
	Ordem   json.RawMessage `json:"ordem,omitempty"`
	LocalID json.RawMessage `json:"local_id,omitempty"` // "Escolha o local antes de criar um ambiente novo."
}
type corpoCategoria struct {
	Nome  json.RawMessage `json:"nome,omitempty"`
	Ordem json.RawMessage `json:"ordem,omitempty"`
}
type corpoTipo struct {
	Nome        json.RawMessage `json:"nome,omitempty"`
	Ordem       json.RawMessage `json:"ordem,omitempty"`
	CategoriaID json.RawMessage `json:"categoria_id,omitempty"` // "Escolha a categoria antes de criar um tipo novo."
}

// corpoNome: o PATCH das Listas só renomeia (tela-de-patrimonio.vue:2003).
type corpoNome struct {
	Nome json.RawMessage `json:"nome,omitempty"`
}

var (
	tabelaMarcas     = dados.Tabela{Nome: "patrimonio_empresas", Resposta: colunasMarca}
	tabelaLocais     = dados.Tabela{Nome: "patrimonio_locais", Resposta: colunasLocal}
	tabelaAmbientes  = dados.Tabela{Nome: "patrimonio_comodos", Resposta: colunasAmbiente}
	tabelaCategorias = dados.Tabela{Nome: "patrimonio_categorias", Resposta: colunasCategoria}
	tabelaTipos      = dados.Tabela{Nome: "patrimonio_tipos", Resposta: colunasTipo}
)

// montarCadastros: GET/POST/PATCH {id}/DELETE {id} de empresas, locais, comodos e categorias; GET/POST de tipos.
// Cada Tabela por deve(…Validar(autz.Producao)); cada escrita com r.With(soSessaoPropria).
func montarCadastros(r chi.Router, p *pgxpool.Pool)
```

Apagar marca leva os locais e os ambientes dela (FK `on delete cascade`); os bens ficam, sem o campo (`on delete set null`) — inclusive bens que a pessoa não vê, como em produção (ações de FK não passam pela RLS). Nome repetido no mesmo pai = 409 `conflito` (`tela-de-patrimonio.vue:1446, 1976, 1991` passam a olhar o 409 em vez da mensagem do banco: Plano 7).

**(b) Testes de aceitação** (`TestCadastros`; para cada um dos 5 recursos, com contagem/valor conferido depois de cada recusa)
- Leitura (vazamento): empresas/locais/comodos — `patGeral`, `patT1` (a trava não restringe cadastro), `frota` e `superFicha` (frota pela ficha) leem todos; `acessos` e `viewer` → `[]`. Categorias/tipos — `patGeral` e `patT1` leem; **`frota` → `[]`**, `superFicha` → `[]`, `viewer` → `[]`. `patGeral` `GET /patrimonio/categorias?nome_como=%25ve%25cul%25&limite=1` → só `Veículos`. `?ordem=nome` → 200; `?ordem=criado_em` → 400.
- Criar: `patGeral` POST empresas `{"nome":"Mantova","ordem":3}` → 201; **`frota` POST locais `{"nome":"Barracão","empresa_id":E1}` → 201** (frota cria); `frota` POST categorias → 403; `viewer`/`acessos` POST empresas → 403; POST locais `{"nome":"Loja Tivoli","empresa_id":E1}` → 409, `{"nome":"Loja Tivoli","empresa_id":E2}` → 201 (único por marca); POST locais sem `empresa_id` → 400 com "Escolha a marca"; POST comodos sem `local_id` → 400 com "Escolha o local"; POST tipos sem `categoria_id` → 400 com "Escolha a categoria"; `{"nome":"  "}` → 400; `{"nome":"X","criado_em":"…"}` → 400 `corpo_invalido`; `impersonado` → 403.
- Renomear/apagar: `patGeral` PATCH empresas/E2 `{"nome":"RBV"}` → 200; **`frota` PATCH locais/L1 → 403** (vê, não edita), nome intacto; `viewer` PATCH locais/L1 → 404; PATCH `{"ordem":2}` → 400 `corpo_invalido`; `frota` DELETE comodos/C1 → 403, fica; `viewer` DELETE → 404, fica; `patGeral` DELETE empresas/E2 → 204, L3 some junto e B3 fica com `local_id` nulo; `impersonado` PATCH/DELETE → 403.
- Mutações que têm de reprovar: `RotaEditar[corpoLocal]` no PATCH de locais (o `{"ordem":2}` deixa de ser 400 e mudar de marca passaria); tirar o `Validar` de `corpoLocal` (o POST sem marca vira 400 genérico, sem a frase da tela); `r.Get("/patrimonio/categorias", consultaMarcas.Handler(…))` (a Frota passa a ler a lista: o caso "frota → `[]`" reprova).

**(c) Arquivos:** Create `api/internal/patrimonio/cadastros.go`, `api/internal/patrimonio/cadastros_test.go`.

**(d) Dependências:** Tasks 2 e 3.

- [ ] **Step 1:** Teste; ver falhar. - [ ] **Step 2:** Implementar (declarações de (a) + `montarCadastros` + os `Validar`). - [ ] **Step 3:** gofmt/vet/test PASS; mutações reprovam. - [ ] **Step 4:** Commit `feat(api): cadastros do Patrimônio (marca, local, ambiente, categoria, tipo) com a leitura e a criação da Frota` (+ `Co-Authored-By`).

---

### Task 8: Configuração e log

**Revisor:** opus. **Depende de:** 2, 3.

**(a) Contrato**
- `GET /patrimonio/config` → `[{chave, valor, atualizado_em}]` (regra `patrimonio_config_rw`: `is_patrimonio_admin`).
- `PUT /patrimonio/config/{chave}` `{"valor": "<texto>"}` → `200 {chave, valor, atualizado_em}`. Lista fechada de chaves (hoje só `numero_maximo`, inteiro de 1 a 999999 em texto: `tela-de-patrimonio.vue:1735-1737`); outra chave → 404; `atualizado_em` = `now()` do servidor (o corpo da tela perde o campo: mandar = 400, Ruling 5.2-10). Upsert: `PodeCriar` + `EditarNova` sobre a linha nova; no conflito, Ler + Editar da linha existente no `WHERE` do `DO UPDATE` (o padrão do push do 5.1).
- `POST /patrimonio/log` `{acao, alvo?, resultado?, detalhe?}` → 201 com a linha; `quem` = a sessão (`Autor`, Ruling 5.2-9; mandar `quem` = 400). Sem `GET` (nenhuma tela lê o log, Ruling 5.2-8).
- `soSessaoPropria` nas escritas.

```go
package patrimonio

import (
	"encoding/json"
	"errors"
	"net/http"
	"regexp"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/autz"
	"github.com/rbv-co/social-dashboard/api/internal/banco"
	"github.com/rbv-co/social-dashboard/api/internal/dados"
)

var consultaConfig = dados.Consulta{Tabela: "patrimonio_config", Alias: "t",
	SQL: `select t.chave, t.valor, t.atualizado_em from patrimonio_config t`, OrdemPadrao: "t.chave", Desempate: "t.chave"}

// formatosDeConfig: as chaves que a tela grava e o formato do valor (lista fechada, Ruling 5.2-10).
var formatosDeConfig = map[string]*regexp.Regexp{
	"numero_maximo": regexp.MustCompile(`^[1-9][0-9]{0,5}$`), // tela-de-patrimonio.vue:1735-1737
}

// gravarConfig: PUT /patrimonio/config/{chave} {valor}. Upsert pela chave (a tela fazia .upsert).
func gravarConfig(p *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		e := autz.EscopoDo(r.Context())
		if e == nil {
			dados.Erro(w, http.StatusInternalServerError, "erro_interno", "")
			return
		}
		chave := chi.URLParam(r, "chave")
		formato, ok := formatosDeConfig[chave]
		if !ok {
			dados.Erro(w, http.StatusNotFound, "nao_encontrado", "")
			return
		}
		var in struct {
			Valor string `json:"valor"`
		}
		if !dados.LerCorpo(w, r, &in) {
			return
		}
		if !formato.MatchString(in.Valor) {
			dados.Erro(w, http.StatusBadRequest, "pedido_invalido", "A numeração vai de 1 a 999999.")
			return
		}
		ctx := r.Context()
		var corpo []byte
		err := banco.ComUsuario(ctx, p, e.ID, func(tx pgx.Tx) error {
			linha := map[string]any{"chave": chave, "valor": in.Valor}
			if err := autz.Producao.PodeCriar(ctx, tx, e, "patrimonio_config", linha); err != nil {
				return err
			}
			fn, err := autz.Producao.Filtro(e, "patrimonio_config", autz.EditarNova, "autz_nova")
			if err != nil {
				return err
			}
			if ok, err := autz.Conferir(ctx, tx, fn, "patrimonio_config", linha); err != nil || !ok {
				if err == nil {
					err = autz.ErrNegado
				}
				return err
			}
			fl, err := autz.Producao.Filtro(e, "patrimonio_config", autz.Ler, "patrimonio_config")
			if err != nil {
				return err
			}
			fe, err := autz.Producao.Filtro(e, "patrimonio_config", autz.Editar, "patrimonio_config")
			if err != nil {
				return err
			}
			err = tx.QueryRow(ctx, `with n as (insert into patrimonio_config (chave, valor, atualizado_em)
				values (@chave::text, @valor::text, now())
				on conflict (chave) do update set valor = excluded.valor, atualizado_em = excluded.atualizado_em
				  where (`+fl.SQL+`) and (`+fe.SQL+`)
				returning chave, valor, atualizado_em) select row_to_json(n) from n`,
				fe.Juntar(fl.Juntar(pgx.NamedArgs{"chave": chave, "valor": in.Valor}))).Scan(&corpo)
			if errors.Is(err, pgx.ErrNoRows) {
				return autz.ErrNegado // a linha existe e quem pede não a edita: fica como estava
			}
			return err
		})
		if err != nil {
			dados.ErroDeEscrita(w, err)
			return
		}
		dados.Responder(w, http.StatusOK, corpo)
	}
}

const colunasLog = `t.id, t.quem, t.acao, t.alvo, t.resultado, t.detalhe, t.quando`

// corpoLog: o que registrarLog grava (tela-de-patrimonio.vue:1604). quem vem da sessão (Autor).
type corpoLog struct {
	Acao      json.RawMessage `json:"acao,omitempty"`
	Alvo      json.RawMessage `json:"alvo,omitempty"`
	Resultado json.RawMessage `json:"resultado,omitempty"`
	Detalhe   json.RawMessage `json:"detalhe,omitempty"`
}

func (c corpoLog) Validar() error {
	return errors.Join(texto("a ação", c.Acao, 100, true), textoOuNulo("o alvo", c.Alvo, 200),
		textoOuNulo("o resultado", c.Resultado, 50), textoOuNulo("o detalhe", c.Detalhe, 2000))
}

var tabelaLog = dados.Tabela{Nome: "patrimonio_log", Resposta: colunasLog, Autor: "quem"}

func montarConfig(r chi.Router, p *pgxpool.Pool) {
	deve(tabelaLog.Validar(autz.Producao))
	r.Get("/patrimonio/config", consultaConfig.Handler(p, autz.Producao))
	r.With(soSessaoPropria).Put("/patrimonio/config/{chave}", gravarConfig(p))
	r.With(soSessaoPropria).Post("/patrimonio/log", dados.RotaCriar[corpoLog](p, autz.Producao, tabelaLog))
}
```

**(b) Testes de aceitação** (`TestConfigELog`)
- Config, leitura: `patGeral` → `numero_maximo`/`400`; **`frota` → `[]`**, `viewer` → `[]`.
- Config, gravação: `patGeral` PUT `numero_maximo` `{"valor":"500"}` → 200 com `"valor":"500"` e `atualizado_em` maior que antes; `patT1` PUT `{"valor":"600"}` → 200 (regra só de ator: a configuração é da empresa, como hoje); **`frota` PUT → 403, valor intacto**; `viewer` PUT → 403; `{"valor":"0"}`, `{"valor":"abc"}`, `{"valor":"1234567"}` → 400; `{"valor":"500","atualizado_em":"x"}` → 400 `corpo_invalido`; `PUT /patrimonio/config/outra` → 404; `impersonado` PUT → 403, valor intacto. Caminho de inserção: apagar a linha (`m.P.Exec`); **`frota` PUT `{"valor":"400"}` → 403 e a linha continua não existindo**; `patGeral` PUT `{"valor":"400"}` → 200 e a linha existe.
- Log: `patT1` POST `{"acao":"bem.editar","alvo":"bem:` + B1 + `","resultado":"ok","detalhe":"Cadeira"}` → 201 com `"quem":"` + idPatT1 + `"`; `{"acao":"x","quem":"` + idPatGeral + `"}` → 400 `corpo_invalido`; `{"acao":""}` → 400; `{"detalhe":"y"}` (sem ação) → 400; `frota` POST → 403; `impersonado` POST → 403; contagem do log conferida em cada recusa.
- Mutações que têm de reprovar: tirar o `PodeCriar` E a conferência `EditarNova` (a `frota` cria a linha que não existia); `Autor: ""` em `tabelaLog` (`quem` sai nulo). O `where (…) and (…)` do `on conflict` é defesa em profundidade: com a regra só de ator, o `PodeCriar` já decide e nenhuma mutação o isola hoje (se a policy passar a ler a linha, ele é que segura).

**(c) Arquivos:** Create `api/internal/patrimonio/config.go`, `api/internal/patrimonio/config_test.go`.

**(d) Dependências:** Tasks 2 e 3; `autz.Producao.PodeCriar/Filtro/Conferir`; `dados.RotaCriar`.

- [ ] **Step 1:** Teste; ver falhar. - [ ] **Step 2:** Implementar (código de (a)). - [ ] **Step 3:** gofmt/vet/test PASS; mutações reprovam. - [ ] **Step 4:** Commit `feat(api): configuração do Patrimônio por PUT (lista fechada) e log com a autoria da sessão` (+ `Co-Authored-By`).

---

### Task 9: RPCs — cadastro rápido e ligação carro ↔ bem

**Revisor:** opus. **Depende de:** 2, 3.

**(a) Contrato** (as 5 de `nomes(FuncoesRPC)` do 5.2; parâmetros, defaults e retorno de `02-funções.csv`; portão = a checagem que a função faz por dentro)

```go
package patrimonio

import (
	"github.com/rbv-co/social-dashboard/api/internal/autz"
	"github.com/rbv-co/social-dashboard/api/internal/rpc"
)

// FrotaOuPatrimonio: a checagem de sincronizar_carro_e_bem (is_frota_admin() or is_patrimonio_admin()).
var FrotaOuPatrimonio = autz.Regra(func(e *autz.Escopo) bool { return autz.FrotaAdmin(e) || autz.PatrimonioAdmin(e) })

// FuncoesRPC: as RPCs do 5.2 na lista branca de POST /rpc/{nome} (web.FuncoesRPC as junta). As que
// gravam recusam a sessão de "entrar como" (Ruling 5.2-3); as listas de escolha não.
var FuncoesRPC = []rpc.Funcao{
	{Nome: "pessoas_para_escolher", Retorno: rpc.Conjunto, Portao: autz.PodeCadastrarPessoaRapida},
	{Nome: "setores_para_escolher", Retorno: rpc.Conjunto, Portao: autz.PodeCadastrarPessoaRapida},
	{Nome: "criar_pessoa_rapida", Retorno: rpc.Conjunto, Portao: autz.PodeCadastrarPessoaRapida, SoSessaoPropria: true,
		Params: []rpc.Param{{Nome: "p_nome", Tipo: "text"}, {Nome: "p_cargo", Tipo: "text", Opcional: true},
			{Nome: "p_marca_id", Tipo: "uuid", Opcional: true}, {Nome: "p_setor_id", Tipo: "uuid", Opcional: true}}},
	{Nome: "criar_setor_rapido", Retorno: rpc.Conjunto, Portao: autz.PodeCadastrarPessoaRapida, SoSessaoPropria: true,
		Params: []rpc.Param{{Nome: "p_nome", Tipo: "text"}}},
	{Nome: "sincronizar_carro_e_bem", Retorno: rpc.Valor, Portao: FrotaOuPatrimonio, SoSessaoPropria: true,
		Params: []rpc.Param{{Nome: "p_carro_id", Tipo: "uuid", Opcional: true}, {Nome: "p_bem_id", Tipo: "uuid", Opcional: true},
			{Nome: "p_placa", Tipo: "text", Opcional: true}, {Nome: "p_etiqueta", Tipo: "integer", Opcional: true},
			{Nome: "p_nome", Tipo: "text", Opcional: true}, {Nome: "p_marca", Tipo: "text", Opcional: true},
			{Nome: "p_valor_centavos", Tipo: "bigint", Opcional: true}}},
}
```

Erros que chegam à tela com a frase da função (5.0, B1): `22023` "Digite o nome antes de criar." e `23514` das travas de `sincronizar_carro_e_bem` → 400 `regra_de_negocio`; portão negado → 403 `sem_permissao` SEM chamar a função (a frase 42501 da função não chega: o portão vem antes). `bem_de_veiculo_segue_a_frota` e os `patrimonio_espelha_*` são gatilhos (ficam no banco, Task 1), não RPC.

**(b) Testes de aceitação**
- `TestPortoesDoPatrimonioContraAsFuncoes` (código abaixo): para cada pessoa do mundo, mais uma desativada com tudo e uma sem perfil, o portão Go = a função de produção chamada como a pessoa; o mundo mostra os dois lados de cada portão.
- `TestRPCsDoPatrimonio` (`novoMundo(t, montarRPCs)`; o ajudante, em `rpc_test.go`, também é usado pela varredura da Task 10):
  ```go
  // montarRPCs: a lista branca do 5.2 como web.Rotas a monta (POST /rpc/{nome} no grupo de domínio).
  func montarRPCs(r chi.Router, p *pgxpool.Pool) {
  	reg, err := rpc.Novo(p, FuncoesRPC...)
  	deve(err)
  	r.Post("/rpc/{nome}", reg.ServeHTTP)
  }
  ```
  - `pessoas_para_escolher`: `frota`, `acessos`, `superFicha` e `patT1` → 200 com `Motorista` e `Pessoa da T1`; **`viewer` → 403 sem lista** (a função não roda).
  - `setores_para_escolher`: `frota` → 200 com `Administrativo`; `viewer` → 403.
  - `criar_pessoa_rapida`: `patT1` `{"p_nome":"Nova Pessoa"}` → 200 `"ja_existia":false`; `{"p_nome":"nova pessoa "}` → 200 `"ja_existia":true` e só 1 linha com esse nome; `{"p_nome":"   "}` → 400 `regra_de_negocio` "Digite o nome antes de criar."; `{"p_nome":"X","p_email":"y"}` → 400; `viewer` → 403, contagem igual; `impersonado` → 403 "Quem entrou como outra pessoa", contagem igual.
  - `criar_setor_rapido`: `frota` `{"p_nome":"Logística"}` → 200 `"ja_existia":false`; `viewer` → 403.
  - `sincronizar_carro_e_bem` (retorna `jsonb`: o texto sai com `": "`, então o teste procura o valor, não `"fez":"…"`): `patGeral` `{"p_bem_id":BV2,"p_placa":"xyz-9a88","p_nome":"Kwid novo"}` → 200 com `criou_carro`, carro `XYZ9A88` ligado ao BV2 e BV2 `em_uso` (gatilho); repetir → 200 com `ja_ligados`; `{"p_bem_id":B1,"p_placa":"QQQ1Q11","p_nome":"x"}` → 400 com "não é um veículo" e NENHUM carro novo; `frota` (sem patrimônio) liga `{"p_etiqueta":11,"p_placa":"XYZ9A88"}` → 200; `viewer` → 403; `impersonado` → 403, contagem de carros igual.
  - **ACHADO (Ruling 5.2-6), paridade documentada:** `patT2` (trava T2) `{"p_etiqueta":1,"p_placa":"ZZZ1Z11","p_nome":"x"}` → 400 com `Cadeira da Tivoli` na frase — o nome de um bem que ela não vê.
- Mutações que têm de reprovar: portão de `criar_pessoa_rapida` = `autz.PatrimonioAdmin` (a `frota` e o `acessos` levam 403 no caso positivo); `FrotaOuPatrimonio` só com `autz.PatrimonioAdmin` (o teste contra a função acusa a pessoa `frota`); `Retorno: rpc.Valor` em `pessoas_para_escolher` (sai uma linha só, sem os dois nomes); tirar `SoSessaoPropria` de `criar_pessoa_rapida` (o caso `impersonado` cria a pessoa). Declaração × `pg_proc` (nomes, tipos, defaults, `setof`) é conferida no banco restaurado pelo `conferir` do 5.0, item (b)(iii).

```go
func TestPortoesDoPatrimonioContraAsFuncoes(t *testing.T) {
	m := novoMundo(t)
	ctx := context.Background()
	const desativado, semPerfil = "5e200000-0000-4000-a000-000000000099", "5e200000-0000-4000-a000-000000000098"
	if _, err := m.P.Exec(ctx, `insert into usuarios (id, email) values ($1::uuid, 'des@x.com')`, desativado); err != nil {
		t.Fatal(err)
	}
	if _, err := m.P.Exec(ctx, `insert into profiles (id, email, role, features, disabled, is_superadmin)
		values ($1::uuid, 'des@x.com', 'admin', '{patrimonio,frota,acessos}', true, true)`, desativado); err != nil {
		t.Fatal(err)
	}
	quem := []string{desativado, semPerfil}
	for _, x := range pessoas {
		quem = append(quem, x.ID)
	}
	lados := map[string]map[bool]bool{"pessoa": {}, "carro": {}}
	for _, id := range quem {
		e, err := autz.CarregarEscopo(ctx, m.P, id)
		if err != nil {
			t.Fatal(err)
		}
		var pessoa, carro bool
		if err := banco.ComUsuario(ctx, m.P, id, func(tx pgx.Tx) error {
			return tx.QueryRow(ctx, `select pode_cadastrar_pessoa_rapida(), is_frota_admin() or is_patrimonio_admin()`).Scan(&pessoa, &carro)
		}); err != nil {
			t.Fatal(err)
		}
		if autz.PodeCadastrarPessoaRapida(e) != pessoa || FrotaOuPatrimonio(e) != carro {
			t.Errorf("%s: Go %v/%v, produção %v/%v", id, autz.PodeCadastrarPessoaRapida(e), FrotaOuPatrimonio(e), pessoa, carro)
		}
		lados["pessoa"][pessoa], lados["carro"][carro] = true, true
	}
	for nome, l := range lados {
		if !l[true] || !l[false] {
			t.Errorf("o mundo não mostra os dois lados do portão %s", nome)
		}
	}
}
```

**(c) Arquivos:** Create `api/internal/patrimonio/rpc.go`, `api/internal/patrimonio/rpc_test.go`.

**(d) Dependências:** Task 1 (funções verbatim no D0), Task 2 (`rpc.Funcao.SoSessaoPropria`), Task 3; `rpc.Novo`, `autz.CarregarEscopo`, `banco.ComUsuario`.

- [ ] **Step 1:** Testes; ver falhar (`FuncoesRPC`). - [ ] **Step 2:** Implementar `rpc.go`. - [ ] **Step 3:** gofmt/vet/test PASS; mutações reprovam. - [ ] **Step 4:** Commit `feat(api): RPCs do cadastro rápido e da ligação carro ↔ bem na lista branca, com o portão das funções` (+ `Co-Authored-By`).

---

### Task 10: Montagem, `conferir`, notas e varredura do impersonado

**Revisor:** opus. **Depende de:** 4–9.

**(a) Contrato**
- `patrimonio.Montar(r chi.Router, p *pgxpool.Pool)` chama `montarBens`, `montarMassa`, `montarPosses`, `montarCadastros`, `montarConfig`. `web.Rotas` chama `patrimonio.Montar(r, p)` no grupo de domínio (depois de `acesso.Montar(r, p)`); `web.FuncoesRPC` passa a incluir `patrimonio.FuncoesRPC`; os 5 nomes saem de `RPCPendentes`.
- `web/rotas_test.go`: `soSessao` ganha as 30 rotas do 5.2.
- `cmd/api/conferir.go` e `NOTAS-DA-IMPLANTACAO.md` (abaixo).

**(b) Testes de aceitação**
- `TestEscritasRecusamImpersonado` (`patrimonio/rotas_test.go`, código abaixo): `chi.Walk` nas rotas não-GET de `/patrimonio/` → com a sessão `impersonado`, cada uma 403 com a frase; exatamente **22** escritas; as 3 RPCs que gravam → 403; `pessoas_para_escolher` → 200; `fotoDoMundo` igual antes e depois.
- `TestNenhumaRotaNovaFicaAberta` (existente) passa com a lista atualizada (toda rota do 5.2 dá 401 sem sessão).
- O teste de `RPCPendentes` do 5.0 (`nomes(FuncoesRPC) ∪ RPCPendentes` = as 92, sem interseção com `RPCForaDoPainel`) passa.
- `TestPatrimonioPelaMontagemReal` (`web/rotas_test.go`, `testebanco.ComEsquemaDeProducao` + `usuarios`/`profiles` de um `pat` com `{patrimonio}` e de um `viewer`, sessões de `auth.NovoStore`): `GET /patrimonio/bens` sem sessão → 401; `viewer` → `200 []`; `viewer` `POST /patrimonio/empresas {"nome":"Vessel"}` → 403 e nenhuma empresa; `pat` → 201; `viewer` `POST /rpc/pessoas_para_escolher` → 403; `pat` → `200 []` (prova o registro em `web.FuncoesRPC`).

**(c) Arquivos:** Create `api/internal/patrimonio/rotas.go`, `api/internal/patrimonio/rotas_test.go`; Modify `api/internal/web/rotas.go`, `api/internal/web/rotas_test.go`, `api/cmd/api/conferir.go`, `docs/migracao-go/NOTAS-DA-IMPLANTACAO.md`.

**(d) Dependências:** Tasks 4–9; `web.Rotas` do 5.0/5.1.

- [ ] **Step 1: Testes que falham.** `patrimonio/rotas_test.go`:

```go
package patrimonio

import (
	"net/http"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
)

// Toda escrita do 5.2 recusa a sessão de "entrar como", sem tocar no banco (Ruling 5.2-3).
func TestEscritasRecusamImpersonado(t *testing.T) {
	m := novoMundo(t, Montar, montarRPCs)
	antes := m.Um(t, fotoDoMundo)
	n := 0
	err := chi.Walk(m.H.(chi.Routes), func(metodo, rota string, _ http.Handler, _ ...func(http.Handler) http.Handler) error {
		if metodo == http.MethodGet || !strings.HasPrefix(rota, "/patrimonio/") {
			return nil
		}
		n++
		caminho := strings.NewReplacer("{id}", B1, "{chave}", "numero_maximo").Replace(rota)
		st, corpo := m.Pedir(t, "impersonado", metodo, caminho, `{}`)
		if st != http.StatusForbidden || !strings.Contains(corpo, "Quem entrou como outra pessoa") {
			t.Errorf("%s %s como impersonado = %d %s", metodo, rota, st, corpo)
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if n != 22 {
		t.Errorf("escritas = %d, esperava 22 (rota de escrita nova? ponha soSessaoPropria e conte aqui)", n)
	}
	for _, c := range []struct {
		nome, corpo string
		status      int
	}{
		{"criar_pessoa_rapida", `{"p_nome":"Intrusa"}`, http.StatusForbidden},
		{"criar_setor_rapido", `{"p_nome":"Intruso"}`, http.StatusForbidden},
		{"sincronizar_carro_e_bem", `{"p_bem_id":"` + BV2 + `","p_placa":"IMP1A11","p_nome":"x"}`, http.StatusForbidden},
		{"pessoas_para_escolher", ``, http.StatusOK}, // só lê: quem entrou como vê o que a pessoa vê
	} {
		if st, corpo := m.Pedir(t, "impersonado", "POST", "/rpc/"+c.nome, c.corpo); st != c.status {
			t.Errorf("rpc %s como impersonado = %d %s, esperava %d", c.nome, st, corpo, c.status)
		}
	}
	if depois := m.Um(t, fotoDoMundo); depois != antes {
		t.Error("o impersonado mudou o banco")
	}
}
```

Em `web/rotas_test.go`, acrescente em `soSessao` (com o comentário "Plano 5.2: portão = catálogo, provado pela matriz de cada rota em `internal/patrimonio`; escrita de impersonado recusada por `TestEscritasRecusamImpersonado`"): `"GET /patrimonio/bens"`, `"POST /patrimonio/bens"`, `"PATCH /patrimonio/bens/{id}"`, `"DELETE /patrimonio/bens/{id}"`, `"POST /patrimonio/bens/em-massa"`, `"POST /patrimonio/bens/apagar-em-massa"`, `"GET /patrimonio/posses"`, `"POST /patrimonio/posses"`, `"PATCH /patrimonio/posses/{id}"`, e, para cada `x` em `empresas`, `locais`, `comodos`, `categorias`: `"GET /patrimonio/x"`, `"POST /patrimonio/x"`, `"PATCH /patrimonio/x/{id}"`, `"DELETE /patrimonio/x/{id}"`; `"GET /patrimonio/tipos"`, `"POST /patrimonio/tipos"`, `"GET /patrimonio/config"`, `"PUT /patrimonio/config/{chave}"`, `"POST /patrimonio/log"` (30). E `TestPatrimonioPelaMontagemReal` com os casos de (b). Run: `go test -count=1 ./internal/patrimonio/ ./internal/web/` → FAIL (`Montar` não existe; rotas não montadas).

- [ ] **Step 2: Implementar.** `patrimonio/rotas.go`:

```go
package patrimonio

import (
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Montar registra as rotas do 5.2 no grupo de DOMÍNIO de web.Rotas (depois de auth.Exigir e de
// autz.ComEscopo). As RPCs entram pela lista branca (FuncoesRPC → web.FuncoesRPC), não por aqui.
func Montar(r chi.Router, p *pgxpool.Pool) {
	montarBens(r, p)
	montarMassa(r, p)
	montarPosses(r, p)
	montarCadastros(r, p)
	montarConfig(r, p)
}
```

Em `web/rotas.go`: import `"github.com/rbv-co/social-dashboard/api/internal/patrimonio"`; no grupo de domínio, depois de `acesso.Montar(r, p)`, acrescente `patrimonio.Montar(r, p) // Plano 5.2`; troque a declaração de `FuncoesRPC` por `var FuncoesRPC = slices.Concat([]rpc.Funcao{}, patrimonio.FuncoesRPC /* 5.2 */)` (os próximos sub-planos acrescentam argumentos; importe `slices` se faltar); em `RPCPendentes`, tire `pessoas_para_escolher`, `setores_para_escolher`, `criar_pessoa_rapida`, `criar_setor_rapido` e `sincronizar_carro_e_bem` (na forma que a Task 10 do 5.0 criou).

Em `cmd/api/conferir.go` (troque a linha existente da mesma tabela pela união; acrescente as novas):

```go
// colunasDoWorker
"patrimonio_bens":       "id,numero,nome,valor_centavos,data_compra,empresa_id,local_id,comodo_id,categoria_id,tipo_id,marca,numero_serie,pessoa_id,dono_texto,etiquetado,situacao,observacao,detalhes,criado_em,atualizado_em",
"patrimonio_posse":      "id,bem_id,pessoa_id,pessoa_nome,de,ate,motivo,criado_em",
"patrimonio_empresas":   "id,nome,ordem,criado_em",
"patrimonio_locais":     "id,nome,ordem,criado_em,empresa_id",
"patrimonio_comodos":    "id,nome,ordem,criado_em,local_id",
"patrimonio_categorias": "id,nome,vida_util_anos,ordem,criado_em",
"patrimonio_tipos":      "id,categoria_id,nome,ordem,criado_em",
"patrimonio_config":     "chave,valor,atualizado_em",
"patrimonio_log":        "id,quem,acao,alvo,resultado,detalhe,quando",
"acessos_pessoas":       "id,nome,profile_id,email_corporativo,cargo,status,setor_id,marca_id", // união com a do 5.0/5.1
"acessos_setores":       "id,nome,ordem",
"frota_veiculos":        "id,placa,nome,marca,fipe_centavos,situacao,pessoa_id,bem_id,atualizado_em", // o 5.3 amplia

// tiposDoWorker (os filtros fazem ::uuid/::date nestas colunas; os embutidos casam por uuid)
"patrimonio_bens.pessoa_id": "uuid", "patrimonio_bens.local_id": "uuid", "patrimonio_bens.categoria_id": "uuid",
"patrimonio_bens.comodo_id": "uuid", "patrimonio_posse.bem_id": "uuid", "patrimonio_posse.de": "date",
"patrimonio_posse.ate": "date", "equipes.local_id": "uuid", "acessos_pessoas.profile_id": "uuid",

// unicosDoWorker (alvo de ON CONFLICT)
"patrimonio_config(chave)",

// funcoesDoWorker (os gatilhos do bem que as escritas do 5.2 presumem)
"bem_de_veiculo_segue_a_frota()", "patrimonio_espelha_responsavel_no_veiculo()", "patrimonio_espelha_situacao_no_veiculo()",
```

(As 5 RPCs são conferidas pelo item (b) dos requisitos da Task 10 do mestre — existem em `public`, `has_function_privilege('authenticated', …)`, declaração × `pg_proc` — assim que entram em `FuncoesRPC`.)

Em `NOTAS-DA-IMPLANTACAO.md`, acrescente ao fim:

```markdown
## Plano 5.2 — patrimônio e cadastros compartilhados

### Rotas novas (com sessão; regra = catálogo de produção; escrita de sessão "entrar como" = 403)
- `/patrimonio/bens` (GET, POST, PATCH/DELETE `{id}`), `POST /patrimonio/bens/em-massa`, `POST /patrimonio/bens/apagar-em-massa`, `/patrimonio/posses` (GET, POST, PATCH `{id}`), `/patrimonio/empresas|locais|comodos|categorias` (GET, POST, PATCH/DELETE `{id}`), `/patrimonio/tipos` (GET, POST), `GET /patrimonio/config`, `PUT /patrimonio/config/{chave}`, `POST /patrimonio/log`.
- `POST /rpc/{pessoas_para_escolher, setores_para_escolher, criar_pessoa_rapida, criar_setor_rapido, sincronizar_carro_e_bem}`.

### Mudanças de contrato que o Plano 7 absorve
- Escrita negada responde 403/404 (o PostgREST respondia 2xx com zero linhas); criar bem ou posse que a pessoa não veria = 403 (antes passava).
- Nome repetido (marca/local/ambiente/categoria/tipo/etiqueta) = 409 `conflito`: `tela-de-patrimonio.vue:1446, 1976, 1991` testavam `/duplicate key|unique/` na mensagem do banco; passam a olhar o status.
- `salvarEmMassa` vira UMA chamada (`POST /patrimonio/bens/em-massa {ids, alteracao}`): a troca de dono fecha e abre as posses no servidor — saem as chamadas de `:1904` e `:1907`. `apagarEmMassa` vira `POST …/apagar-em-massa {ids}`. Um id fora do alcance derruba o lote inteiro (antes: pulado em silêncio).
- `ampliarNumeracao` vira `PUT /patrimonio/config/numero_maximo {valor}` (sem `atualizado_em`, que o servidor põe).
- `patrimonio_log.quem` passa a ser preenchido pela sessão (antes nulo); mandar `quem` = 400.
- A Frota acha a categoria de veículos por `GET /patrimonio/categorias?nome_como=%ve%cul%&limite=1`.
- A auditoria de Acessos (`tela-de-acessos.vue:2248`, `LIMITE_AUDITORIA = 5000`) recebe no máximo 1000 bens (o teto da API e do `max_rows` de antes; 407 bens hoje).

### Achados para o dono (paridade mantida; decisão de produto)
- `sincronizar_carro_e_bem` (e a `etiqueta_quem_e`, do 5.3) são SECURITY DEFINER e ignoram o escopo por time: quem tem patrimônio com trava liga carro a bem de outro time pelo número da etiqueta, e a frase de erro da trava de categoria diz o NOME do bem ("O nº de patrimônio 1 é "Cadeira da Tivoli"…"). Corrigir é mudar a função em produção.
- Super-admin pela ficha com papel `viewer` e sem o módulo não vê bem nenhum (a permissiva exige `is_patrimonio_admin`), embora `pode_ver_bem` o deixe ver tudo.
- `is_patrimonio_admin`/`is_frota_admin` olham `features`, derivada de QUALQUER permissão com `ver`: quem só abre o Patrimônio grava pela API (a tela esconde o botão). É a nota de escopo de 13/08 (`2026-08-13-cadastro-rapido-nota-de-escopo.sql`), agora valendo para a API inteira do Patrimônio.
- Em produção, inserir bem e posse não passava pela trava de time (a migração de 04/08 restringiu ler, editar e apagar). A API restringe (Ruling 5.2-2).

### Antes do corte
- `api worker conferir` no banco restaurado confere as colunas, os tipos, o único de `patrimonio_config` e os 3 gatilhos do bem.
- Conferir a orientação dos 14 gatilhos da fatia D0 contra o banco restaurado: `select tgname, pg_get_triggerdef(oid) from pg_trigger where not tgisinternal and tgrelid::regclass::text in ('patrimonio_bens','frota_veiculos','frota_uso','bling_lojas','canais_grupos','equipes','profiles') order by 1` deve trazer o mesmo `UPDATE OF`/`WHEN` de `api/internal/testebanco/esquema/02-gatilhos.sql` (em especial `trg_frota_fechar_posse_orfa … WHEN ((new.pessoa_id IS NULL))`).
```

Rode `gofmt -w ./internal ./cmd`.

- [ ] **Step 3: Rodar e ver passar.** `gofmt -l . && go vet ./... && go test -count=1 -race ./... 2>&1 | grep -v goose | grep -E '^(ok|FAIL|---)'` → todos `ok`. Mutações que têm de reprovar: tirar `soSessaoPropria` de UMA escrita (a varredura acusa); tirar `SoSessaoPropria: true` de uma RPC que grava; esquecer de tirar um nome de `RPCPendentes` (o teste da Task 10 do 5.0 acusa a interseção).

- [ ] **Step 4: Commit.**

```bash
git add api/internal/patrimonio/rotas.go api/internal/patrimonio/rotas_test.go api/internal/web/ api/cmd/api/conferir.go docs/migracao-go/NOTAS-DA-IMPLANTACAO.md
git commit -m "feat(api): monta as rotas e as RPCs do 5.2, conferir do esquema e notas

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Verificação final do 5.2

- [ ] `docker stop pg-plano52` e `make -C api teste PG_PORTA=58537` → todos `ok`.
- [ ] Subir o `pg-plano52` de novo e `cd api && go test -count=1 -v ./... 2>&1 | grep -c -- '--- SKIP'` → `0`.
- [ ] `cd api && gofmt -l . && go vet ./...` → nada.
- [ ] `git diff feat/api-go-plano-5-1 --stat -- src/ supabase/ coletor/ db/` → vazio (o front troca no Plano 7; produção não muda).
- [ ] `docker stop pg-plano52`.
- [ ] Revisão final do branch por opus com foco em: algum caminho de `massa.go`/`config.go` grava fora de `PodeX` ou em outra transação; `CriarSoLegivel` (o 23503 vira 403 só com a flag; o fallback `{"id"}` some só com ela); a fatia D0 (`CONFERIDOS` bate com as migrations citadas?); a varredura do impersonado cobre toda escrita; o `left join` dos embutidos com o marcador como termo de `and`.

---

## Inventário: sítios do front a trocar (Plano 7)

`grep` em `src/` (fora de `*.test.*` e de `src/demonstracao/`) em 2026-10-12: **43 literais** (`.from('patrimonio_*')` 33 + `.rpc(…)` das 5 funções 10) **+ 6 por variável** (`from(def.tabela)`/`from(pedido.tabela)`) = **49 sítios**; nenhum REST cru (`sb(`/`adFetch(`/`rest/v1`) nessas tabelas. `src/compartilhado`: **0 chamadas** (só comentários: `arvore-de-locais.js:6-8`, `pessoas-para-escolher.js:8, 67`).

Abreviações: `pat` = `src/ferramentas/patrimonio/tela-de-patrimonio.vue`; `rel` = `src/ferramentas/patrimonio/relatorios-do-patrimonio.js`; `frota` = `src/ferramentas/frota/tela-de-frota.vue`; `ac` = `src/ferramentas/acessos/tela-de-acessos.vue`; `admin` = `src/ferramentas/admin/tela-de-admin.vue`.

| Rota | Sítios | Qtde |
|---|---|---|
| `GET /patrimonio/bens` | pat:2064; frota:1091 (`?ordem=nome&limite=500`); ac:1819 (`?pessoa_id=&contar=1&limite=1`), 2075 (`?pessoa_id=&ordem=nome`, usa os embutidos), 2248 (`?limite=1000`) | 5 |
| `POST /patrimonio/bens` / `PATCH /patrimonio/bens/{id}` / `DELETE /patrimonio/bens/{id}` | pat:1686 / pat:1682 / pat:2052 | 3 |
| `POST /patrimonio/bens/em-massa` | pat:1896 (+ :1904 e :1907 somem: a posse vai junto) | 3 |
| `POST /patrimonio/bens/apagar-em-massa` | pat:1926 | 1 |
| `GET /patrimonio/posses` | pat:1563 (`?bem_id=&ordem=de.desc`), 1611 (`?bem_id=`); rel:53 (`?aberta=true&ordem=de.desc`), 89 (`?de_desde=&de_ate=&ordem=de.desc`) | 4 |
| `POST /patrimonio/posses` / `PATCH /patrimonio/posses/{id}` | pat:1624 / pat:1620 | 2 |
| `GET /patrimonio/empresas` | pat:2065; frota:1229; admin:3720 (`?ordem=nome`) | 3 |
| `POST /patrimonio/empresas` (literal) | pat:1533; frota:3271 | 2 |
| `GET /patrimonio/locais` / `comodos` / `categorias` / `tipos` | pat:2066, frota:1230 / pat:2067, frota:1231 / pat:2068, frota:1104 (`?nome_como=%25ve%25cul%25&limite=1`) / pat:2069 | 7 |
| `POST /patrimonio/{empresas,categorias,locais,comodos,tipos}` por variável | pat:1436 (os 5), 1974 (locais, comodos), 1988 (empresas, categorias); frota:3188 (empresas, locais, comodos) | 4 |
| `PATCH` / `DELETE /patrimonio/{empresas,locais,comodos,categorias}/{id}` por variável | pat:2003 / pat:2030 | 2 |
| `GET /patrimonio/config` / `PUT /patrimonio/config/numero_maximo` | pat:2076 / pat:1736 | 2 |
| `POST /patrimonio/log` | pat:1604 | 1 |
| `POST /rpc/pessoas_para_escolher` / `setores_para_escolher` | pat:2074, frota:1078 / pat:2075, frota:1080 | 4 |
| `POST /rpc/criar_pessoa_rapida` / `criar_setor_rapido` | pat:1487, frota:3228 / pat:1519, frota:3259 | 4 |
| `POST /rpc/sincronizar_carro_e_bem` | pat:1699, frota:3391 | 2 |

Nas mesmas telas, de OUTROS planos (não trocar pelo 5.2): 5.3 — `frota_veiculos` em pat:1296, 1312, 1328 (liga/desliga/cria carro a partir do bem), pat:2084, ac:1820, 2078, 2249 e o resto de `tela-de-frota.vue`; 5.4 — `acessos_*` de `tela-de-acessos.vue` (inclusive ac:1821 `acessos_termos`) e admin:3674 (`acessos_pessoas` com `patrimonio_empresas(nome)` embutido: a rota do 5.4 usa o marcador `{ler:patrimonio_empresas:<alias>}`).

## Paralelização

- **Uma worktree por tarefa paralela** (merge na ordem dos números). Na mesma worktree, só em sequência: as Tasks 3–10 são o MESMO pacote Go (`patrimonio`), e um arquivo pela metade de uma quebra a compilação da outra.
- **Onda 1:** Tasks 1 e 2 (pacotes e arquivos distintos: `testebanco/esquema*` × `dados`, `rpc`, `acesso/acesso.go`).
- **Onda 2:** Task 3 (precisa da 1 — a fatia — e da 2 — `dados.SoSessaoPropria`).
- **Onda 3:** Tasks 4, 6, 7, 8 e 9 — cinco em paralelo, cada uma só nos seus dois arquivos (`bens*`, `posses*`, `cadastros*`, `config*`, `rpc*`).
- **Onda 4:** Task 5 (usa `tabelaBens` da 4 e `tabelaPosses` da 6).
- **Onda 5:** Task 10 (a única que toca `web/`, `conferir.go` e as notas).
- O gate (`make -C api teste`) usa o contêiner de nome fixo `pg-api-teste`: rode-o numa worktree por vez; nas etapas, cada worktree usa o seu `pg-plano52-<n>` numa porta própria.

## Rulings do 5.2

1. Ruling: D0 do 5.2 = as 9 tabelas do Patrimônio completas das migrations, `acessos_setores`/`frota_veiculos`/`frota_uso` MÍNIMAS e `acessos_pessoas` ampliada por `alter`, com as 5 RPCs verbatim pedidas pela linha `-- funções:`; o gerador ganha `CONFERIDOS` (o `UPDATE OF` e o `WHEN` copiados da migration de cada gatilho, com a fonte) e FALHA diante de gatilho não conferido — o `03-triggers.csv` não traz `WHEN`, e sem ele `trg_frota_fechar_posse_orfa` fecharia a posse do carro a cada troca de responsável do bem (ensaiado: a mutação reprova); `frota_uso` entra porque o gatilho do bem chega até ela; de quebra, o `trg_espelhar_grupo_do_canal` do 5.1 passa a sair como em produção (`UPDATE OF grupo_id, grupo`) — custo se errada: orientação mal copiada só aparece na conferência de `pg_get_triggerdef` das NOTAS (ou quando o `pg_dump` do ensaio substituir a fatia).
2. Ruling: escopo por time também na CRIAÇÃO — `POST /patrimonio/bens` e `POST /patrimonio/posses` só gravam linha que quem cria consegue LER depois (`dados.Tabela.CriarSoLegivel`, avaliado sobre a linha gravada); senão 403 e a transação é desfeita; FK para o que não existe também 403 (sem oráculo) — em produção o `insert` não tinha a restritiva (a migração de 04/08 limitou ler/editar/apagar e não inserir) e posse de bem alheio é escrita numa linha que a pessoa não vê; "mover para fora do que vê" já era 403 no `update` — custo se errada: pessoa com trava de time não cadastra item fora do próprio time nem sem local (pede a quem não tem trava).
3. Ruling: sessão de "entrar como" só LÊ no 5.2 — as 22 escritas de tabela e as 3 RPCs que gravam respondem 403 (`dados.SoSessaoPropria`, extraído do 5.1, e `rpc.Funcao.SoSessaoPropria`); as listas de escolha continuam abertas — `patrimonio_log.quem` e as fichas, carros e ligações criados iriam no nome do alvo; estende os Rulings 18 do mestre e 5.1-4 — custo se errada: o super-admin sai da sessão impersonada para mexer no patrimônio.
4. Ruling: lotes atômicos — `em-massa` e `apagar-em-massa` recebem `ids` (1 a 1000, em ordem) e passam cada um pelo MESMO `Tabela.Editar`/`Apagar` da rota unitária (mesma struct, `PodeX` por linha) numa transação só; um negado = nada gravado — hoje era UMA chamada `.in('id', ids)` cuja RLS pulava as linhas invisíveis em silêncio; N chamadas do front não seriam atômicas — custo se errada: um id alheio derruba o lote inteiro (a tela só marca o que lista); ~3 consultas por item.
5. Ruling: a troca de dono em massa leva a posse junto, no servidor e na mesma transação (fecha as abertas com `ate` = hoje em São Paulo; abre a do dono novo com o nome lido de `acessos_pessoas` e `motivo = 'alteração em massa'`) — é exatamente o que `tela-de-patrimonio.vue:1902-1911` fazia em duas chamadas soltas, uma delas um insert em array que nenhuma rota unitária faz — custo se errada: o Plano 7 tira as duas chamadas de posse do `salvarEmMassa`.
6. Ruling: RPCs com paridade, inclusive o furo de escopo das SECURITY DEFINER — `sincronizar_carro_e_bem` acha e liga bem de qualquer time pelo id ou pelo número, e a frase da trava de categoria diz o nome do bem; o teste documenta como ACHADO — consertar é mudar a função em produção (decisão do dono, nas NOTAS), e apertar o portão em Go travaria a Frota, que não tem escopo por time — custo se errada: quem tem patrimônio com trava descobre o nome de bem alheio pelo número, como hoje.
7. Ruling: um recurso por tabela com a UNIÃO das colunas e filtros que as telas usam (como o 5.1-6); `GET /patrimonio/bens` sempre traz os três nomes embutidos (`patrimonio_categorias`, `patrimonio_locais`, `patrimonio_comodos` = `{nome}` ou `null`) que a ficha de Acessos lê, por `left join` com o marcador de cada tabela — uma rota a mais por tela seria superfície a mais com a mesma regra — custo se errada: três `left join` por leitura de ~400 linhas.
8. Ruling: só as rotas que alguma tela usa — tipos sem PATCH/DELETE; log só POST (nenhuma tela lê o log); PATCH de cadastro só `{nome}`; PATCH de posse só `{ate}` — `autz` nega o resto e cada rota a mais é superfície — custo se errada: tela nova ganha uma declaração de ~10 linhas.
9. Ruling: `patrimonio_log.quem` vem da sessão (`Autor`) e é recusado no corpo — hoje sai nulo (a tela não manda) — custo se errada: nenhum (coluna que ninguém lê).
10. Ruling: configuração por `PUT /patrimonio/config/{chave}` com lista fechada de chaves (`numero_maximo`, inteiro de 1 a 999999) e `atualizado_em` do servidor; upsert com `PodeCriar` + `EditarNova` e, no conflito, Ler + Editar no `WHERE` do `DO UPDATE` (padrão do push, 5.1) — a tabela guarda decisão da empresa e a tela só grava essa chave — custo se errada: chave nova de configuração exige uma linha no mapa.
11. Ruling: `atualizado_em` dos bens continua vindo do corpo (a tela manda; nenhuma regra o lê) — paridade sem código — custo se errada: a coluna reflete o relógio do navegador, como hoje.
12. Ruling: o Patrimônio não tem Storage (nenhum bucket nem upload; o leitor de etiqueta usa a câmera só no aparelho) — nada a portar para o Plano 6; o ponto de integração, se um dia houver anexo de bem, é uma rota própria no Plano 6 apontando para `patrimonio_bens.id` (a coluna `detalhes jsonb` guarda campos por categoria, não arquivo) — custo se errada: nenhum.
13. Ruling: o mundo de teste do 5.1 vira o pacote `testebanco/mundoteste` e o `acesso/mundo_test.go` um adaptador fino — o 5.1 previa a extração ao segundo pacote; não pode ficar em `testebanco` porque os testes internos de `autz` importam `testebanco` (ciclo) — custo se errada: um pacote de teste a mais.
14. Ruling: filtro `nome_como` (ILIKE com o padrão do pedido como VALOR de parâmetro) só em categorias, para a Frota achar "Veículos" do mesmo jeito que `sincronizar_carro_e_bem` acha (`ilike '%ve%cul%'`) — trocar por igualdade mudaria o que a tela encontra — custo se errada: um padrão abusivo varre uma tabela de ~10 linhas.
15. Ruling: `bem_de_veiculo_segue_a_frota` e os espelhos são gatilhos verbatim no banco, não RPC nem regra em Go: `PATCH` de situação num bem ligado a carro responde 200 com a situação DO CARRO (a resposta é a linha depois dos gatilhos) — reescrever o espelho em Go duplicaria a regra que o banco já garante para a Frota também — custo se errada: a tela recebe o valor aceito, não o pedido (e mostra o certo).
16. Ruling: paridade das permissões do catálogo mesmo onde surpreendem — super-admin pela ficha sem papel admin nem módulo não vê bem; quem só abre o Patrimônio (feature derivada de `ver`) grava; a configuração e os cadastros não têm trava de time — "mesmas permissões de hoje"; os achados vão para o dono nas NOTAS — custo se errada: as mesmas brechas de hoje continuam até o dono decidir.

## Cobertura da spec e o que o 5.3+ assume

**As 9 tabelas da linha 5.2 (20 policies, 4 restritivas):**

| Tabela | Policies | Destino |
|---|---|---|
| `patrimonio_bens` | `_rw` (all), `_so_do_meu_time` (select, R), `_editar_so_do_meu_time` (update, R), `_apagar_so_do_meu_time` (delete, R) | Tasks 4 e 5 (+ `CriarSoLegivel` na criação, Ruling 5.2-2) |
| `patrimonio_posse` | `_rw`, `_segue_o_bem` (select, R) | Tasks 6 e 5 |
| `patrimonio_empresas`, `patrimonio_locais`, `patrimonio_comodos` | `_rw`, `_leitura_frota`, `_criar_frota` (×3) | Task 7 |
| `patrimonio_categorias`, `patrimonio_tipos` | `_rw` (×2) | Task 7 |
| `patrimonio_config` | `_rw` | Task 8 |
| `patrimonio_log` | `_insert`, `_select` | Task 8 (select sem rota, Ruling 5.2-8) |

RPCs (5 das 92 registráveis): Task 9. Gatilhos da linha 5.2: `trg_bem_de_veiculo_segue_a_frota`, `trg_patrimonio_espelha_responsavel`, `trg_patrimonio_espelha_situacao` (Task 1, verbatim, com os 5 do carro que a cadeia alcança). Spec §5 (autorização por catálogo, escopo por time, IDOR, testes ator × operação × recurso pela cadeia real) e §11 (lista fechada, autoria da sessão, sem oráculo de existência).

**O que o 5.3+ assume:**
- **5.3 (Frota):** `frota_veiculos` e `frota_uso` JÁ existem MÍNIMAS em `01-tabelas-5-2.sql`; o 5.3 as completa com `alter table … add column` no `01-tabelas-5-3.sql` (um `create table` de novo quebra a carga). Os 5 gatilhos delas já estão em `CONFERIDOS` e no `02-gatilhos.sql`; os de `frota_checklist*`, `frota_requisicoes` etc. entram em `CONFERIDOS` com a orientação da migration (o gerador recusa os não conferidos). A tela da Frota usa as rotas do 5.2 para a árvore (GET/POST de empresas, locais e cômodos), as listas de pessoas/setores e as RPCs `criar_*`/`sincronizar_carro_e_bem`; os `PATCH frota_veiculos.bem_id` de `tela-de-patrimonio.vue:1296, 1312` são rota do 5.3 (os gatilhos levam a situação e o responsável ao bem). `etiqueta_quem_e` é do 5.3 (o mesmo achado de escopo da Ruling 5.2-6).
- **5.4 (Acessos):** `acessos_pessoas` (mínima no 5.1 + `cargo`, `status`, `setor_id`, `marca_id` aqui) e `acessos_setores` (mínima aqui) são completadas pelo 5.4 com `alter`. A ficha de Acessos lê bens por `GET /patrimonio/bens?pessoa_id=` (com os embutidos); `admin:3674` embute `patrimonio_empresas(nome)` com o marcador `{ler:patrimonio_empresas:<alias>}`.
- **Todos:** `dados.Tabela.CriarSoLegivel` para criação que tem de ser vista por quem cria; `dados.SoSessaoPropria(frase)` e `rpc.Funcao.SoSessaoPropria` para o "entrar como só lê" (cada sub-plano decide e conta na sua varredura); `testebanco/mundoteste` para o mundo de teste (pessoas, sessões impersonadas, cadeia real); `web.FuncoesRPC = slices.Concat(…, <dominio>.FuncoesRPC)` e o nome sai de `RPCPendentes`; lote = ids em ordem pelo mesmo caminho da rota unitária numa transação.
