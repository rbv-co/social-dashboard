# Sair do Supabase — Plano 5.5: Comercial (Bling e Shopify)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **Execute na worktree `p5-55`** (branch `feat/api-go-plano-5-5`, empilhada sobre `feat/api-go-plano-5-2`; antes da Task 1 ela recebe o 5.2 EXECUTADO, que já traz o 5.0 e o 5.1; o 5.3 e o 5.4 NÃO são pré-requisito). Faça `git add` só dos caminhos de cada task. Este plano contrata sobre as **interfaces** do 5.0, do 5.1 e do 5.2 (escritas nos planos deles), não sobre o código: o pré-voo confere que elas existem com esses nomes.

**Goal:** Trocar os 40 acessos diretos do front às 15 tabelas do Comercial (Bling e Shopify) por 18 rotas da API em Go que decidem com as MESMAS regras das 33 policies de produção — o escopo por canal (`pode_ver_canal`) e por depósito (`pode_ver_estoque`) em toda leitura que o tem em produção — e delimitar o que o painel GRAVA: metas (dinheiro) e fechar/agrupar canal, cada salvamento numa transação, e os dois caches de vendas que só o navegador preenche.

**Architecture:** Um pacote de domínio novo, `internal/vendas` (rotas em `/comercial/…`), montado no grupo de domínio do 5.0 (`auth.Exigir` → `autz.ComEscopo`); o `internal/comercial` dos Planos 3/4 (proxy do Bling e push de vendas) não muda. Leitura = `dados.Consulta` de UMA tabela (gramática permitida do 5.0; a regra de Ler do catálogo — inclusive as 7 restritivas de canal/depósito — entra pela CTE-sombra, nunca escrita à mão). Escrita = o caminho declarado do 5.1 (`dados.Tabela`), que ganha a coluna-chave que não é `id` (`Tabela.Chave` + `autz.PodeEditarPor/PodeApagarPor`) e o upsert sem corrida (`Tabela.Gravar`); o salvamento das metas e os lotes dos caches chamam o MESMO `Tabela.Criar/Editar/Apagar/Gravar` linha a linha numa transação `banco.ComUsuario` só. Testes contra a fatia 5.5 do D0 (tabelas das migrations; o único gatilho do domínio, `trg_espelhar_grupo_do_canal`, já está no D0 desde o 5.1).

**Tech Stack:** Go 1.26 (`go.mod`), `chi`, `pgx` v5, Postgres 17 (contêiner), Node 22 (só para rodar de novo o gerador de gatilhos).

**Spec:** `docs/superpowers/specs/2026-10-09-sair-do-supabase-design.md` (§5 autorização, §11 segurança, §13 testes) e o plano-mestre `docs/superpowers/plans/2026-10-11-api-go-plano-5-dominios.md` (§II contrato, IV.1 regras de sub-plano, linha 5.5 da IV.2, Rulings 1–36 — em especial o 14: a regra de canais do `bling-proxy` e `pode_ver_canal` continuam DUAS; e o 24: o push de vendas continua global). Modelos: os planos 5.1, 5.2 e 5.3. Especificação das permissões: `docs/migracao-go/catalogo-policies-producao.json` (as 33 policies de `bling_*`, `gc_*`, `gestao_comercial_briefings`, `shopify_pedidos`; 7 restritivas: `pode_ver_canal` em `bling_pedido_nota`, `bling_pedido_ajuste_valor`, `bling_pedido_ajuste_vendedor`, `bling_pedido_forma_pagamento`, `gc_vendas_item` e `shopify_pedidos`; `pode_ver_estoque` em `gc_estoque_item`).

## Global Constraints

- Nada em produção: sem `ssh`, sem credencial real, sem `push`. Postgres local descartável; segredos de teste inventados.
- Regra de cada tabela = a do catálogo (`autz.Producao`), nunca reescrita à mão. Nenhuma rota escreve `pode_ver_canal`/`pode_ver_estoque` em SQL: entram pela regra de Ler (CTE-sombra do 5.0). Divergência só por Ruling deste plano.
- Negar por padrão. Todo portão tem o lado negado assertado **com o efeito** (hash/contagem conferidos no banco depois).
- **Vazamento entre lojas é o risco principal:** toda leitura com restritiva tem a matriz COMPLETA pessoa × linhas (oito pessoas, inclusive vendedora, gestora, supervisora de grupo, estoque liberado, papel admin com trava e ninguém) pelo handler real, na mesma cadeia `auth.Exigir` → `autz.ComEscopo` da produção; filtro com id de outra loja/depósito = linha ausente; `contar=1` conta só o visível.
- IDOR na escrita: linha invisível = `404`; `403` para linha visível sem permissão e para criação negada.
- **Mapa de escrita da MESMA struct que monta o INSERT/UPDATE** (`dados.Campos` de struct de `json.RawMessage`); **`PodeX` dentro da MESMA transação `banco.ComUsuario` que grava**, inclusive nos lotes; `PodeCriar` exige toda coluna lida pela regra como chave (as regras de criação do 5.5 só leem o ator: `pode_ver_vendas()`, papel `admin`).
- Leitura declarada só com a GRAMÁTICA permitida do 5.0 (`select <colunas> from <tabela> t`, sem junção nem subconsulta). SQL próprio só em dois pontos da Task 7: a trava do mês (não lê dado) e a localização da meta pela chave natural (com a regra de Ler do catálogo).
- SQL: todo parâmetro com cast explícito; nada do pedido no texto do SQL (tabela, colunas, chave e ordens fixas na rota).
- Sessão de "entrar como" só LÊ no Comercial: as 4 escritas = `403` sem efeito (Ruling 5.5-8). Nenhuma tabela gravada pelo 5.5 tem coluna de autoria; as que têm (`bling_pedido_ajuste_*.criado_por`) não ganham rota (Ruling 5.5-4).
- Dado pessoal: `shopify_pedidos.cliente_nome`, `cliente_email` e `bruto` não saem por rota nenhuma (Ruling 5.5-7); nada de valor de pedido ou nome de cliente em log.
- Sem dependência nova; `go.mod` fica em `go 1.26.0`.
- Gate: `make -C api teste PG_PORTA=58555` com `--- SKIP` = 0; `gofmt -l` e `go vet` limpos. O alvo `teste` usa o contêiner de nome fixo `pg-api-teste`: não rode o gate junto com outra worktree.
- Commits terminam com `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>` (o modelo que implementa). Código, comentários e mensagens em português com acentuação; frases de tela ficam como estão.
- `go` roda em `api/`; `git` e `node` na raiz da worktree.

## Review Focus

1. **Vendedora, gestora ou supervisora de grupo lendo nota, ajuste de valor ou de vendedor, forma de pagamento, venda por item, pedido Shopify ou estoque de OUTRA loja/depósito** (sem filtro, com filtro apontando para a outra loja, pela contagem) → linha ausente; super pela ficha e "sem trava" veem tudo; papel `admin` COM trava não vê nada (paridade). Testes: `TestNadaVazaEntreLojas`, `TestFiltrosNaoAbremOutraLoja` (Task 4), `TestTodaLeituraTemEscopoDeclarado` (Task 9).
2. **Salvar metas com uma linha negada, inválida ou duplicada no meio** → nada gravado, nem as linhas anteriores; dois salvamentos simultâneos do mesmo mês criando a mesma meta → uma linha só. Testes: `TestSalvarMetas`, `TestSalvarMetasSemCorrida` (Task 7).
3. **Duas TVs da Gestão à Vista gravando o mesmo pedido no cache ao mesmo tempo** → as duas `200`, uma linha; coluna ausente não apaga o que havia (`vendor_id` sobrevive a uma linha só com `qtd_itens`); quem não tem `sales` nem papel admin → `403`, nada gravado. Testes: `TestGravarCaches`, `TestCachesSemCorrida` (Task 8).
4. **Pedido Shopify** → a resposta nunca traz `cliente_nome`, `cliente_email` nem `bruto`, para ninguém (nem super). Teste: `TestNadaVazaEntreLojas` (Task 4).
5. **Sessão de "entrar como" em qualquer escrita** (metas, canal, caches) → `403` com a frase, banco intacto; leituras continuam. Teste: `TestEscritasRecusamImpersonado` (Task 9).

---

## Interfaces que este plano consome

(Dos planos 5.0, 5.1 e 5.2; o pré-voo confere cada uma. Nome diferente só de campo/função: use o real em todo o plano. Semântica diferente: **pare e reporte**.)

- **5.0** — `dados.Consulta{Tabela, Alias, SQL, Onde; Filtros []Filtro; Ordens map[string]string; OrdemPadrao, Desempate string}` com `Validar(cat)`/`Handler(b, cat)` (dá `panic` na montagem se a declaração for errada); gramática permitida e CTE-sombra por tabela do catálogo; `dados.Filtro{Param, SQL, Tipo}` (`texto|uuid|inteiro|data|instante|booleano`, sufixo `[]`; cast explícito compatível com o tipo); `LerCorpo` (recusa campo não declarado, inclusive em struct aninhada), `Erro`, `ErroDoBanco`, `ErroDeEscrita` (`ErrNaoEncontrado` → 404, `ErrNegado` → 403, `ErrDeclaracao` → 500; 23505/23503 → 409; outros 22xxx/23xxx → 400). `autz`: `Producao`, `Escopo{ID, Papel, SuperFicha, Modulos, SemTrava, Canais, Depositos, ...}`, `EscopoDo`, `ComEscopo`, `Ler/Criar/Editar/EditarNova/Apagar`, `(*Catalogo).Filtro`, `PodeCriar`, `PodeEditar`/`PodeApagar` (travam a linha `id`; Ler no `WHERE`; id no tipo da coluna com savepoint), `Filtro.Juntar`, `ErrNegado`, `ErrNaoEncontrado`, `ErrDeclaracao`. `auth`: `Ator{ID, ImpersonadorID}`, `AtorDoContexto`, `Exigir`, `NovoStore`, `(*Store).Criar`. `banco.ComUsuario`. `web.Rotas` (grupo de domínio), mapas `publicas`/`soSessao` de `web/rotas_test.go`.
- **5.1** — `testebanco.ComEsquemaDeProducao(t)`; `esquema/01-tabelas-5-1.sql` com `bling_lojas` MÍNIMA (`loja_id, nome, grupo, grupo_id, fechado_em`), `equipes` (com `canal_loja_id`, `deposito_id`), `equipes_membros`, `equipes_permissoes`, `canais_grupos`, `canais_grupos_membros`; o gatilho `trg_espelhar_grupo_do_canal` em `02-gatilhos.sql`. `dados.Tabela{Nome, Resposta, Autor}` com `Validar`, `Criar`, `Editar`, `Apagar`, `devolver`; `dados.Campos`, `RotaEditar[C]`, `dados.Responder`. As liberações de estoque (`/equipes/permissoes`) são do 5.1: aqui só se lê o efeito delas (`pode_ver_estoque`).
- **5.2** — `dados.Tabela.CriarSoLegivel` (e o `devolver(…, soLegivel bool)`), `dados.SoSessaoPropria(frase)`, `dados.FraseEntrarComo`; `testebanco/mundoteste` (`Pessoa{Chave, ID, Email, Papel; Super, Trava, Desativado; Modulos, Contas}`, `Opcoes{Pessoas, Linhas, Impersonadas}`, `Novo`, `Mundo{P, H, Tok}` com `Resposta/Pedir/Um/Rodar`, `Caso`).

## Pré-voo (antes da Task 1)

- [ ] `cd /Users/gabrielgertrudes/Projetos/Trabalho/lavessel/social-dashboard/.claude/worktrees/p5-55 && git status --short && git branch --show-current` → vazio (ou só este plano); `feat/api-go-plano-5-5`.
- [ ] Trazer o 5.2 executado (com 5.0 e 5.1): `git merge --no-edit feat/api-go-plano-5-2`. Conferir:
  ```bash
  grep -c 'func (t Tabela) Criar\|func (t Tabela) Editar\|func (t Tabela) Apagar\|func (t Tabela) devolver\|func RotaEditar' api/internal/dados/escrita.go  # 5
  grep -c 'CriarSoLegivel' api/internal/dados/escrita.go                                     # ≥ 1
  grep -c 'func SoSessaoPropria\|FraseEntrarComo' api/internal/dados/sessao.go               # 2
  grep -c 'func Novo' api/internal/testebanco/mundoteste/mundoteste.go                        # 1
  grep -c 'func ComEsquemaDeProducao' api/internal/testebanco/esquema.go                      # 1
  grep -c 'create table public.bling_lojas' api/internal/testebanco/esquema/01-tabelas-5-1.sql   # 1
  grep -rn 'create table public.\(bling_\|gc_\|shopify_\|gestao_comercial\)' api/internal/testebanco/esquema/  # só bling_lojas (5-1)
  grep -n 'func (c \*Catalogo) PodeEditar\|func (c \*Catalogo) PodeApagar\|func (c \*Catalogo) conferirExistente' api/internal/autz/escrita.go
  grep -n '\.id\b\|attname\|autz_id' api/internal/autz/escrita.go       # onde "id" acha a linha: a Task 2 parametriza ESTES pontos
  grep -n 'Desempate' api/internal/dados/consulta.go                      # aceita lista ("t.a, t.b")? ver nota abaixo
  grep -n '"texto"\|"data"\|"instante"' api/internal/dados/parametros.go  # casts aceitos por tipo (ver nota abaixo)
  test -d api/internal/vendas && echo existe || echo ok                    # ok
  ```
  Qualquer `0` nas sete primeiras: a dependência não terminou — **pare e reporte**.
  - `Desempate` que recuse lista: use a expressão de linha, que é UMA expressão (`(t.deposito_id, t.sku)`), nas Tasks 4 (estoque, vendas por item).
  - Se o tipo `texto` só aceitar `::text`, a janela das notas já vem como `@janela::text::daterange` (Task 4). Tipo que recuse `::date[]`/`::timestamptz`/`::bigint[]` nos filtros desta lista: **pare e reporte**.
- [ ] `go version` → `go1.26`+; `node --version` → `v22`+.
- [ ] Levantamento (fonte do gerador, fora do git): `L=/Users/gabrielgertrudes/Projetos/Trabalho/lavessel/social-dashboard/.claude/worktrees/levantamento-ro/docs/migracao-go/levantamento; test -f "$L/02-funções.csv" && test -f "$L/03-triggers.csv" && echo ok`.
- [ ] Docker no ar, porta livre (`lsof -iTCP:58555 -sTCP:LISTEN` → vazio) e o banco das etapas:
  ```bash
  docker run -d --rm --name pg-plano55 -e POSTGRES_PASSWORD=x -p 127.0.0.1:58555:5432 postgres:17
  until docker exec pg-plano55 pg_isready -h 127.0.0.1 -U postgres >/dev/null 2>&1; do sleep 1; done
  export TEST_DATABASE_URL='postgres://postgres:x@localhost:58555/postgres?sslmode=disable'
  ```
- [ ] Linha de base: `cd api && go test ./... && go test -v ./... 2>&1 | grep -c -- '--- SKIP'` → tudo `ok` e `0`.

## Estrutura de arquivos

```
api/internal/testebanco/esquema/01-tabelas-5-5.sql      # as 13 tabelas do Comercial (fonte por bloco) + foco em bling_lojas
api/internal/testebanco/esquema_comercial_test.go        # colunas que as rotas presumem, colunas geradas, checks, nenhum gatilho novo
api/internal/autz/escrita.go                (mod.)       # PodeEditarPor/PodeApagarPor (a linha por outra coluna que não id)
api/internal/autz/escrita_chave_test.go
api/internal/dados/escrita.go               (mod.)       # Tabela.Chave, Tabela.Gravar (upsert sem corrida)
api/internal/dados/chave_test.go
api/internal/vendas/vendas.go                            # doc do pacote, soSessaoPropria, deve, textoOuNulo
api/internal/vendas/mundo_test.go                        # pessoas, linhas, fotoDoComercial, novoMundo, chaves, aoMesmoTempo
api/internal/vendas/vendas_test.go                       # TestMundoDoComercial (o Escopo que chega à rota)
api/internal/vendas/leituras.go      (+ _test)           # as 7 leituras com restritiva de canal/depósito
api/internal/vendas/globais.go       (+ _test)           # depósitos e briefings
api/internal/vendas/lojas.go         (+ _test)           # GET e PATCH /comercial/lojas
api/internal/vendas/metas.go         (+ _test)           # GET metas de loja e de vendedora; POST /comercial/metas/salvar
api/internal/vendas/caches.go        (+ _test)           # vendedoras e vendedor do pedido: GET e gravar em lote
api/internal/vendas/rotas.go         (+ rotas_test.go)   # Montar; varreduras do impersonado, das leituras e das escritas
api/internal/web/rotas.go, rotas_test.go                 # montagem, soSessao, montagem real
api/cmd/api/conferir.go                                  # colunas, tipos, únicos e a função do gatilho que as rotas presumem
docs/migracao-go/NOTAS-DA-IMPLANTACAO.md                 # seção do 5.5
```

## Tarefas

| # | Task | Revisor | Depende de |
|---|---|---|---|
| 1 | D0: fatia 5.5 do esquema (13 tabelas) | **opus** (dados: é contra isto que o escopo é provado) | 5.2 executado |
| 2 | Fundação: chave que não é `id` e upsert sem corrida | **opus** (autorização e dados: toda escrita do 5.5 passa aqui) | 5.0, 5.1 T2, 5.2 T2 |
| 3 | Pacote `vendas` e o mundo de teste do Comercial | **opus** (autorização: a matriz roda nele) | 1, 5.2 T3 |
| 4 | Leituras com escopo de canal e de depósito | **opus** (vazamento entre lojas, dado pessoal) | 3 |
| 5 | Leituras globais: depósitos e briefings | sonnet | 3 |
| 6 | Lojas: leitura e fechar/agrupar canal | **opus** (super pela ficha, chave `loja_id`, gatilho) | 2, 3 |
| 7 | Metas: leitura e salvar o mês numa transação | **opus** (DINHEIRO, atomicidade, corrida) | 3 |
| 8 | Caches de vendas: vendedoras e vendedor do pedido | **opus** (ranking e push, concorrência) | 2, 3 |
| 9 | Montagem, varreduras, `conferir` e notas | **opus** (fronteira) | 4–8 |

---

### Task 1: D0 — fatia 5.5 do esquema de produção nos testes

**Revisor:** opus. **Depende de:** 5.2 executado (carregador, gerador, `bling_lojas` mínima do 5.1).

**(a) Contrato**
- `esquema/01-tabelas-5-5.sql` (abaixo): as 13 tabelas do Comercial declaradas UMA vez (Ruling 5.5-1; nenhuma fatia anterior as declara — o pré-voo confere), com colunas, tipos, defaults, checks e colunas geradas das migrations citadas, e `bling_lojas` completada por `alter` (é do 5.5; o 5.1 a declarou mínima). FKs de `auth.users` → `public.usuarios`. `bling_tokens` fica fora (só o serviço a lê; nenhuma rota).
- Nenhum gatilho novo: `levantamento/03-triggers.csv:2-3` só tem `trg_espelhar_grupo_do_canal` em `bling_lojas`, já gerado desde o 5.1 (com o `UPDATE OF` do 5.2). Rodar o gerador de novo NÃO muda `02-gatilhos.sql`.

**(b) Testes de aceitação** (`TestFatiaDoComercial`, código abaixo)
- As 13 tabelas + `bling_lojas` têm exatamente as colunas que as rotas e o `conferir` presumem (`colunasDoComercial`).
- `bling_pedido_nota.data_da_venda`/`origem_da_data` são geradas: sem nota → o dia do pedido e `pedido`; com nota → o dia da nota e `nota`.
- Checks dos ajustes: motivo com menos de 10 letras ou valor negativo → `23514`, nada gravado.
- Defaults: `shopify_pedidos.loja_id` = 205512275; `bling_lojas.foco` = `true`; `bling_pedido_vendedor.qtd_itens` = 1.
- Nenhum gatilho nas 13 tabelas novas.
- Mutações que têm de reprovar (uma por vez): tirar o `generated always` de `data_da_venda`; tirar o check de `motivo`; tirar `pedido_numero`.

**(c) Arquivos:** Create `api/internal/testebanco/esquema/01-tabelas-5-5.sql`, `api/internal/testebanco/esquema_comercial_test.go`.

**(d) Dependências:** `testebanco.ComEsquemaDeProducao` (5.1); levantamento local (só para conferir que o gerador não muda nada).

- [ ] **Step 1: A DDL da fatia.** Crie `api/internal/testebanco/esquema/01-tabelas-5-5.sql`:

```sql
-- FATIA 5.5 do esquema de produção para os testes (D0 reconstruído: Rulings 5.1-1 e 5.5-1). Carregada
-- DEPOIS das fatias 5-1…5-4 (ordem de nome). As 13 tabelas do Comercial são declaradas SÓ aqui; as
-- fatias seguintes (5.10, 5.11: funções vessel_* leem bling_*) as usam como estão. "Presumido" = sem DDL
-- no repositório (tabela anterior às migrations): o `api worker conferir` confere no banco restaurado
-- (Task 9). Nenhuma destas tabelas tem gatilho em produção (levantamento/03-triggers.csv:2-3: só
-- bling_lojas, já no D0 desde o 5.1). bling_tokens fica fora: só o serviço a lê.

-- bling_lojas é do 5.5; o 5.1 a declarou mínima. 2026-09-05-bling-lojas-ganha-foco.sql:16-17
alter table public.bling_lojas add column if not exists foco boolean not null default true;

-- 2026-09-05-bling-depositos.sql:12-18
create table public.bling_depositos (
  deposito_id   bigint primary key,
  nome          text not null,
  ativo         boolean not null default true,
  padrao        boolean not null default false,
  atualizado_em timestamptz not null default now()
);

-- presumido: a "mesma forma" de bling_vendedor_metas (supabase/migrations/20260707_criar_bling_vendedor_metas.sql:3)
-- com loja_id e loja_nome (coletor/gestor-comercial.mjs:397). SEM único (loja_id, year, month): a tela de
-- Admin grava por update/insert (tela-de-admin.vue:4231-4233), não por upsert como nas vendedoras (:4229).
create table public.bling_metas (
  id          serial primary key,
  loja_id     bigint not null,
  loja_nome   text,
  year        integer not null,
  month       integer not null,
  meta_valor  numeric,
  daily_goals jsonb,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

-- supabase/migrations/20260707_criar_bling_vendedor_metas.sql:5-15 (a 004_vendedor_metas.sql nunca rodou: ver a 20260707:1-3)
create table public.bling_vendedor_metas (
  id          serial primary key,
  vendor_id   bigint not null,
  year        integer not null,
  month       integer not null,
  meta_valor  numeric,
  daily_goals jsonb,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now(),
  unique (vendor_id, year, month)
);

-- presumido: o que a Gestão à Vista grava (tela-de-gestao-a-vista.vue:308, 314) e o Admin lê (tela-de-admin.vue:559);
-- único em vendor_id (o onConflict da tela)
create table public.bling_vendedores (
  vendor_id  bigint primary key,
  nome       text,
  updated_at timestamptz default now()
);

-- presumido: o cache que as telas gravam (tela-de-gestao-a-vista.vue:246, 285; tela-de-analise-vendas.vue:630-641);
-- qtd_itens: 005_pedido_qtd_itens.sql:5-6; vendor_id ANULÁVEL (a Análise de Vendas grava linha sem vendedor)
create table public.bling_pedido_vendedor (
  pedido_id   bigint primary key,
  vendor_id   bigint,
  pedido_data date,
  qtd_itens   int default 1,
  loja_id     bigint
);

-- 2026-08-11-nota-fiscal-dos-pedidos.sql:25-47 + pedido_numero (presumido: gravado por
-- coletor/lib/notas-bling.mjs:59, lido por src/compartilhado/data-da-venda.js:32)
create table public.bling_pedido_nota (
  pedido_id      bigint primary key,
  loja_id        bigint,
  data_pedido    date not null,
  total          numeric(12,2),
  nota_id        bigint,
  modelo         text check (modelo in ('nfe', 'nfce')),
  nota_numero    text,
  nota_serie     int,
  nota_situacao  smallint,
  data_da_nota   date,
  emitida_em     timestamptz,
  data_da_venda  date generated always as (coalesce(data_da_nota, data_pedido)) stored,
  origem_da_data text generated always as (case when data_da_nota is null then 'pedido' else 'nota' end) stored,
  conferido_em   timestamptz not null default now(),
  pedido_numero  text
);

-- 2026-09-12-valor-corrigido-da-venda.sql:33-41
create table public.bling_pedido_ajuste_valor (
  pedido_id       bigint primary key,
  loja_id         bigint,
  total_corrigido numeric(12,2) not null check (total_corrigido >= 0),
  total_do_bling  numeric(12,2),
  motivo          text not null check (length(btrim(motivo)) >= 10),
  criado_por      uuid references public.usuarios(id),
  criado_em       timestamptz not null default now()
);

-- 2026-09-25-ajuste-manual-do-vendedor.sql:25-33
create table public.bling_pedido_ajuste_vendedor (
  pedido_id           bigint primary key,
  loja_id             bigint,
  vendor_id_corrigido bigint not null,
  vendor_id_do_bling  bigint,
  motivo              text not null check (length(btrim(motivo)) >= 10),
  criado_por          uuid references public.usuarios(id),
  criado_em           timestamptz not null default now()
);

-- 2026-10-03-forma-de-pagamento-do-pedido.sql:23-32
create table public.bling_pedido_forma_pagamento (
  parcela_id         bigint primary key,
  pedido_id          bigint not null,
  loja_id            bigint,
  forma_pagamento_id bigint not null,
  valor              numeric(12,2) not null,
  data_vencimento    date,
  eh_devolucao       boolean not null,
  atualizado_em      timestamptz not null default now()
);

-- 012_relatorios_comerciais.sql:6-16
create table public.gc_vendas_item (
  mes           date not null,
  canal_loja_id bigint not null,
  sku           text not null,
  produto       text,
  categoria     text,
  unidades      int not null default 0,
  faturamento   numeric not null default 0,
  atualizado_em timestamptz default now(),
  primary key (mes, canal_loja_id, sku)
);

-- 012_relatorios_comerciais.sql:23-31
create table public.gc_estoque_item (
  deposito_id   bigint not null,
  sku           text not null,
  produto       text,
  categoria     text,
  saldo         int not null default 0,
  atualizado_em timestamptz default now(),
  primary key (deposito_id, sku)
);

-- 011_gestao_comercial.sql:4-12
create table public.gestao_comercial_briefings (
  id         uuid primary key default gen_random_uuid(),
  rodada     date not null default current_date,
  periodo    text,
  resumo     text,
  conteudo   text not null,
  dados_json jsonb,
  created_at timestamptz not null default now()
);

-- 2026-10-03-pedidos-da-shopify.sql:22-34
create table public.shopify_pedidos (
  id                bigint primary key,
  numero            text,
  loja_id           bigint not null default 205512275,
  total             numeric(12,2) not null,
  moeda             text not null default 'BRL',
  status_financeiro text not null,
  cliente_nome      text,
  cliente_email     text,
  criado_em_shopify timestamptz not null,
  bruto             jsonb not null,
  atualizado_em     timestamptz not null default now()
);
```

- [ ] **Step 2: O teste que falha.** Crie `api/internal/testebanco/esquema_comercial_test.go`:

```go
package testebanco

import (
	"context"
	"errors"
	"slices"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgconn"
)

// colunasDoComercial: o que as rotas do 5.5 leem e gravam. A MESMA lista vai ao cmd/api/conferir.go (Task 9).
var colunasDoComercial = map[string]string{
	"bling_lojas":                  "loja_id,nome,grupo,grupo_id,fechado_em,foco",
	"bling_depositos":              "deposito_id,nome,ativo,padrao",
	"bling_metas":                  "id,loja_id,year,month,meta_valor,daily_goals",
	"bling_vendedor_metas":         "id,vendor_id,year,month,meta_valor,daily_goals",
	"bling_vendedores":             "vendor_id,nome,updated_at",
	"bling_pedido_vendedor":        "pedido_id,vendor_id,pedido_data,qtd_itens,loja_id",
	"bling_pedido_nota":            "pedido_id,pedido_numero,data_pedido,data_da_venda,total,loja_id,nota_situacao",
	"bling_pedido_ajuste_valor":    "pedido_id,loja_id,total_corrigido",
	"bling_pedido_ajuste_vendedor": "pedido_id,loja_id,vendor_id_corrigido",
	"bling_pedido_forma_pagamento": "parcela_id,pedido_id,loja_id,valor,eh_devolucao",
	"gc_estoque_item":              "deposito_id,sku,produto,categoria,saldo",
	"gc_vendas_item":               "mes,canal_loja_id,sku,produto,categoria,unidades,faturamento",
	"gestao_comercial_briefings":   "id,rodada,periodo,resumo,conteudo,dados_json,created_at",
	"shopify_pedidos":              "id,loja_id,total,status_financeiro,criado_em_shopify",
}

// A fatia 5.5: as colunas que as rotas presumem, as colunas geradas da nota, os checks dos ajustes, os
// defaults e nenhum gatilho novo (o único do domínio, em bling_lojas, é do D0 do 5.1).
func TestFatiaDoComercial(t *testing.T) {
	p := ComEsquemaDeProducao(t)
	ctx := context.Background()
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
	for tab, quer := range colunasDoComercial {
		var tem []string
		linhas, err := p.Query(ctx, `select column_name::text from information_schema.columns
			where table_schema = 'public' and table_name = $1::text`, tab)
		if err != nil {
			t.Fatal(err)
		}
		for linhas.Next() {
			var c string
			linhas.Scan(&c)
			tem = append(tem, c)
		}
		for _, c := range strings.Split(quer, ",") {
			if !slices.Contains(tem, c) {
				t.Errorf("%s.%s ausente na fatia", tab, c)
			}
		}
	}

	if _, err := p.Exec(ctx, `
		insert into bling_lojas (loja_id, nome) values (77, 'Loja de teste');
		insert into bling_pedido_nota (pedido_id, loja_id, data_pedido) values (1, 77, '2026-10-01');
		insert into bling_pedido_nota (pedido_id, loja_id, data_pedido, data_da_nota) values (2, 77, '2026-10-01', '2026-10-02');
		insert into shopify_pedidos (id, total, status_financeiro, criado_em_shopify, bruto) values (1, 10, 'paid', now(), '{}');
		insert into bling_pedido_vendedor (pedido_id, vendor_id) values (1, 7);`); err != nil {
		t.Fatal(err)
	}
	if v := um(`select string_agg(data_da_venda::text || '/' || origem_da_data, ',' order by pedido_id) from bling_pedido_nota`); v != "2026-10-01/pedido,2026-10-02/nota" {
		t.Errorf("data_da_venda = %s", v)
	}
	if v := um(`select (select loja_id::text from shopify_pedidos) || '/' || (select foco::text from bling_lojas where loja_id = 77) ||
		'/' || (select qtd_itens::text from bling_pedido_vendedor)`); v != "205512275/true/1" {
		t.Errorf("defaults = %s", v)
	}
	for _, sql := range []string{
		`insert into bling_pedido_ajuste_valor (pedido_id, total_corrigido, motivo) values (1, 10, 'curto')`,
		`insert into bling_pedido_ajuste_valor (pedido_id, total_corrigido, motivo) values (2, -5, 'motivo bem comprido')`,
		`insert into bling_pedido_ajuste_vendedor (pedido_id, vendor_id_corrigido, motivo) values (1, 7, 'curto')`,
	} {
		var pe *pgconn.PgError
		if _, err := p.Exec(ctx, sql); !errors.As(err, &pe) || pe.Code != "23514" {
			t.Errorf("%s: %v (esperava 23514)", sql, err)
		}
	}
	if v := um(`select ((select count(*) from bling_pedido_ajuste_valor) + (select count(*) from bling_pedido_ajuste_vendedor))::text`); v != "0" {
		t.Errorf("check negado gravou: %s", v)
	}
	if v := um(`select string_agg(tgname::text, ',') from pg_trigger where not tgisinternal and tgrelid::regclass::text in (
		'bling_depositos','bling_metas','bling_vendedor_metas','bling_vendedores','bling_pedido_vendedor','bling_pedido_nota',
		'bling_pedido_ajuste_valor','bling_pedido_ajuste_vendedor','bling_pedido_forma_pagamento','gc_estoque_item',
		'gc_vendas_item','gestao_comercial_briefings','shopify_pedidos')`); v != "<nulo>" {
		t.Errorf("gatilho inesperado na fatia 5.5: %s", v)
	}
}
```

Run: `cd api && go test -count=1 -run FatiaDoComercial ./internal/testebanco/` → FAIL (tabelas ausentes) antes do Step 1; PASS depois.

- [ ] **Step 3: O gerador não muda nada.** Na raiz: `node api/internal/testebanco/esquema/gerar-gatilhos.mjs "$L" > /tmp/02.sql && diff -q /tmp/02.sql api/internal/testebanco/esquema/02-gatilhos.sql` → sem diferença (as tabelas novas não têm gatilho). Diferença: **pare e reporte** (o CSV ou o gerador mudou).
- [ ] **Step 4: Rodar e morder.** `gofmt -l ./internal && go vet ./internal/testebanco/ && go test -count=1 -v ./internal/testebanco/ 2>&1 | grep -E '^(--- |ok|FAIL)'` → tudo PASS (inclusive `TestEsquemaDeProducaoComOsGatilhosVerbatim`, lista de gatilhos igual). Aplique as mutações de (b), uma por vez, e veja reprovar.
- [ ] **Step 5: Commit.** `git add api/internal/testebanco/esquema/01-tabelas-5-5.sql api/internal/testebanco/esquema_comercial_test.go && git commit -m "test(api): D0 — fatia 5.5 do esquema (as 13 tabelas do Comercial, declaradas uma vez)"` (+ linha `Co-Authored-By`).

---

### Task 2: Fundação — chave que não é `id` e upsert sem corrida

**Revisor:** opus. **Depende de:** 5.0 (`autz/escrita.go`), 5.1 T2 e 5.2 T2 (`dados/escrita.go`). Os testes usam `testebanco.Novo` (não dependem da Task 1).

**(a) Contrato**
- `autz`: `(*Catalogo).PodeEditarPor(ctx, tx, e, tab, coluna, valor string, mudancas map[string]any) error` e `PodeApagarPor(ctx, tx, e, tab, coluna, valor string) error` — a MESMA conferência de `PodeEditar`/`PodeApagar` (trava `for update`, Ler no `WHERE`, USING na antiga, WITH CHECK na nova, valor no tipo da coluna com savepoint), achando a linha por `coluna`. `coluna` é texto FIXO da rota: fora de `^[a-z_][a-z0-9_]{0,62}$` → `ErrDeclaracao`; sempre citada com `pgx.Identifier`. `PodeEditar(…, id, …)` = `PodeEditarPor(…, "id", id, …)` (assinaturas antigas intactas: 5.1–5.3 não mudam).
- `dados.Tabela.Chave string`: a coluna que acha a linha em `Editar`/`Apagar`/`Gravar` e que vai no `{"<chave>": …}` quando quem grava não lê; vazia = `id`. `Validar` recusa chave fora da expressão regular. `RotaEditar`/`RotaApagar` continuam lendo `{id}` da URL: o valor é o da `Chave`.
- `dados.Tabela.Gravar(ctx, tx, cat, e, campos) ([]byte, error)`: o `.upsert(…, {onConflict: <chave>})` das telas, sem corrida (Ruling 5.5-3): a linha existe e se lê → `Editar` (só as colunas presentes além da chave); não existe → `PodeCriar` + `insert … on conflict (<chave>) do nothing`; se outra transação a criou no meio → `Editar` de novo; existe e não se lê → `ErrNaoEncontrado` (404, sem oráculo). A chave TEM de vir em `campos` e nunca muda; só a chave = erro; com `CriarSoLegivel` = `ErrDeclaracao`.

**(b) Testes de aceitação**
- `TestPodeEditarPorOutraColuna` (`autz`, tabela `loja (loja_id bigint pk, conta text, nome text)`, catálogo de teste: Ler e Editar por `pode_ver_conta(conta)`, Apagar por `superadmin_pela_ficha()`): pessoa da conta A1 → `nil` na loja 1; loja 2 (A2) → `ErrNaoEncontrado`; mover a loja 1 para A2 → `ErrNegado`; valor `"x"` → `ErrNaoEncontrado` e a transação continua usável (`select 1` depois funciona); coluna `"loja_id; drop table loja"` → `ErrDeclaracao` e a tabela existe; `PodeApagarPor` super → `nil`, pessoa A1 → `ErrNegado`. Os testes de `PodeEditar`/`PodeApagar` e o oráculo do 5.0 continuam verdes sem mudança.
- `TestTabelaComChave` e `TestGravarSemCorrida` (`dados`, código abaixo).
- Mutações que têm de reprovar: em `conferirExistente`, deixar `id` fixo (a loja 1 vira `ErrNaoEncontrado`); em `Gravar`, trocar o `on conflict … do nothing` por nada (a corrida dá 409 em vez de 200); em `Gravar`, chamar `criar` ANTES de `Editar` (quem só edita recebe 403); em `devolver`, voltar o `{"id"}` fixo (a resposta sem leitura perde a chave).

**(c) Arquivos:** Modify `api/internal/autz/escrita.go`, `api/internal/dados/escrita.go`; Create `api/internal/autz/escrita_chave_test.go`, `api/internal/dados/chave_test.go`.

**(d) Dependências:** `autz.Compilar/PodeCriar/Filtro/ErrNegado/ErrNaoEncontrado/ErrDeclaracao`; `banco.ComUsuario`; `testebanco.Novo`; `dados.Campos/colunas/devolver`.

- [ ] **Step 1: O teste de `dados` que falha.** Crie `api/internal/dados/chave_test.go`:

```go
package dados

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"sync"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/rbv-co/social-dashboard/api/internal/autz"
	"github.com/rbv-co/social-dashboard/api/internal/banco"
	"github.com/rbv-co/social-dashboard/api/internal/testebanco"
)

// loja: chave loja_id (bigint); lida e editada por quem vê a conta, criada por quem tem o módulo frota,
// apagada por super pela ficha.
const catalogoDaChave = `[
 {"tabela":"loja","nome":"le","tipo":"permissive","comando":"select","papeis":["authenticated"],"using":"pode_ver_conta(conta)","withCheck":null},
 {"tabela":"loja","nome":"cria","tipo":"permissive","comando":"insert","papeis":["authenticated"],"using":null,"withCheck":"is_frota_admin()"},
 {"tabela":"loja","nome":"edita","tipo":"permissive","comando":"update","papeis":["authenticated"],"using":"pode_ver_conta(conta)","withCheck":"pode_ver_conta(conta)"},
 {"tabela":"loja","nome":"apaga","tipo":"permissive","comando":"delete","papeis":["authenticated"],"using":"superadmin_pela_ficha()","withCheck":null}
]`

func mundoDaChave(t *testing.T) (*autz.Catalogo, func(e *autz.Escopo, f func(tx pgx.Tx) error) error, func(string) string) {
	t.Helper()
	cat, err := autz.Compilar([]byte(catalogoDaChave))
	if err != nil {
		t.Fatal(err)
	}
	p := testebanco.Novo(t)
	ctx := context.Background()
	if _, err := p.Exec(ctx, `create table loja (loja_id bigint primary key, conta text, nome text not null default 'sem nome', n int);
		insert into loja values (1, 'A1', 'um', 10), (2, 'A2', 'dois', 20)`); err != nil {
		t.Fatal(err)
	}
	como := func(e *autz.Escopo, f func(tx pgx.Tx) error) error { return banco.ComUsuario(ctx, p, e.ID, f) }
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
	return cat, como, um
}

var (
	frotaA1 = &autz.Escopo{ID: quemEscreve, TemPerfil: true, Ativo: true, Modulos: []string{"frota"}, Contas: []string{"A1"}}
	soA1    = &autz.Escopo{ID: quemEscreve, TemPerfil: true, Ativo: true, Contas: []string{"A1"}}
	superF  = &autz.Escopo{ID: quemEscreve, TemPerfil: true, Ativo: true, SuperFicha: true}
)

func raw(s string) json.RawMessage { return json.RawMessage(s) }

func TestTabelaComChave(t *testing.T) {
	cat, como, um := mundoDaChave(t)
	ctx := context.Background()
	tab := Tabela{Nome: "loja", Chave: "loja_id", Resposta: "t.loja_id, t.conta, t.nome, t.n"}
	if err := tab.Validar(cat); err != nil {
		t.Fatal(err)
	}
	if (Tabela{Nome: "loja", Chave: "loja_id; drop table loja", Resposta: "t.loja_id"}).Validar(cat) == nil {
		t.Fatal("chave inválida validou")
	}
	editar := func(e *autz.Escopo, chave string, campos map[string]any) (l []byte, err error) {
		err = como(e, func(tx pgx.Tx) error { l, err = tab.Editar(ctx, tx, cat, e, chave, campos); return err })
		return l, err
	}
	gravar := func(tb Tabela, e *autz.Escopo, campos map[string]any) (l []byte, err error) {
		err = como(e, func(tx pgx.Tx) error { l, err = tb.Gravar(ctx, tx, cat, e, campos); return err })
		return l, err
	}
	linha := func(k string) string { return um("select conta || '/' || nome || '/' || coalesce(n::text, '-') from loja where loja_id = " + k) }

	// Editar pela chave: a MESMA conferência do PodeEditar, achando a linha por loja_id
	if l, err := editar(soA1, "1", map[string]any{"nome": raw(`"um!"`)}); err != nil || !strings.Contains(string(l), `"nome":"um!"`) {
		t.Errorf("edita pela chave: %s %v", l, err)
	}
	if _, err := editar(soA1, "2", map[string]any{"nome": raw(`"x"`)}); !errors.Is(err, autz.ErrNaoEncontrado) || linha("2") != "A2/dois/20" {
		t.Errorf("outra conta = %v (IDOR)", err)
	}
	if _, err := editar(soA1, "1", map[string]any{"conta": raw(`"A2"`)}); !errors.Is(err, autz.ErrNegado) || linha("1") != "A1/um!/10" {
		t.Errorf("mover para conta que não vê = %v", err)
	}
	if _, err := editar(soA1, "x", map[string]any{"nome": raw(`"x"`)}); !errors.Is(err, autz.ErrNaoEncontrado) {
		t.Errorf("chave que não é número = %v", err)
	}

	// Gravar: edita o que existe (só as colunas presentes), cria o que não existe
	if _, err := gravar(tab, frotaA1, map[string]any{"loja_id": raw(`3`), "conta": raw(`"A1"`), "nome": raw(`"tres"`)}); err != nil || linha("3") != "A1/tres/-" {
		t.Errorf("cria pela chave: %v %s", err, linha("3"))
	}
	if _, err := gravar(tab, frotaA1, map[string]any{"loja_id": raw(`1`), "nome": raw(`"um de novo"`)}); err != nil || linha("1") != "A1/um de novo/10" {
		t.Errorf("edita o que existe sem mexer no ausente: %v %s", err, linha("1"))
	}
	if _, err := gravar(tab, soA1, map[string]any{"loja_id": raw(`1`), "n": raw(`11`)}); err != nil || linha("1") != "A1/um de novo/11" {
		t.Errorf("quem só edita grava a que existe: %v", err)
	}
	if _, err := gravar(tab, soA1, map[string]any{"loja_id": raw(`4`), "conta": raw(`"A1"`)}); !errors.Is(err, autz.ErrNegado) || um("select count(*)::text from loja where loja_id = 4") != "0" {
		t.Errorf("sem a regra de criar = %v", err)
	}
	if _, err := gravar(tab, frotaA1, map[string]any{"loja_id": raw(`2`), "nome": raw(`"x"`)}); !errors.Is(err, autz.ErrNaoEncontrado) || linha("2") != "A2/dois/20" {
		t.Errorf("existe e não se lê = %v (sem oráculo, intacta)", err)
	}
	if _, err := gravar(tab, frotaA1, map[string]any{"nome": raw(`"sem chave"`)}); err == nil {
		t.Error("gravar sem a chave passou")
	}
	if _, err := gravar(tab, frotaA1, map[string]any{"loja_id": raw(`5`)}); err == nil || um("select count(*)::text from loja where loja_id = 5") != "0" {
		t.Error("gravar só a chave passou")
	}
	if _, err := gravar(Tabela{Nome: "loja", Chave: "loja_id", Resposta: "t.loja_id", CriarSoLegivel: true}, frotaA1,
		map[string]any{"loja_id": raw(`6`), "nome": raw(`"x"`)}); !errors.Is(err, autz.ErrDeclaracao) {
		t.Errorf("Gravar com CriarSoLegivel = %v", err)
	}

	// Apagar pela chave
	var err error
	if err = como(soA1, func(tx pgx.Tx) error { return tab.Apagar(ctx, tx, cat, soA1, "1") }); !errors.Is(err, autz.ErrNegado) {
		t.Errorf("apagar sem a regra = %v", err)
	}
	if err = como(superF, func(tx pgx.Tx) error { return tab.Apagar(ctx, tx, cat, superF, "2") }); err != nil || um("select count(*)::text from loja where loja_id = 2") != "0" {
		t.Errorf("super apaga pela chave: %v", err)
	}
}

// Duas transações gravando a MESMA chave nova ao mesmo tempo: as duas passam e fica uma linha.
func TestGravarSemCorrida(t *testing.T) {
	cat, como, um := mundoDaChave(t)
	ctx := context.Background()
	tab := Tabela{Nome: "loja", Chave: "loja_id", Resposta: "t.loja_id"}
	for i := range 20 {
		k := fmt.Sprint(100 + i)
		var wg sync.WaitGroup
		largada := make(chan struct{})
		erros := make([]error, 2)
		for lado := range 2 {
			wg.Add(1)
			go func() {
				defer wg.Done()
				<-largada
				erros[lado] = como(frotaA1, func(tx pgx.Tx) error {
					_, err := tab.Gravar(ctx, tx, cat, frotaA1, map[string]any{"loja_id": raw(k), "conta": raw(`"A1"`), "n": raw(fmt.Sprint(lado))})
					return err
				})
			}()
		}
		close(largada)
		wg.Wait()
		if erros[0] != nil || erros[1] != nil {
			t.Fatalf("chave %s: %v / %v", k, erros[0], erros[1])
		}
		if v := um("select count(*)::text from loja where loja_id = " + k); v != "1" {
			t.Fatalf("chave %s: %s linhas", k, v)
		}
	}
}
```

Run: `go test -count=1 -run 'TabelaComChave|GravarSemCorrida' ./internal/dados/` → FAIL de compilação (`Chave`, `Gravar`).

- [ ] **Step 2: `autz`.** Em `api/internal/autz/escrita.go`:
  1. Renomeie o corpo atual de `PodeEditar` para `PodeEditarPor` com o parâmetro `coluna` logo antes do valor, e o de `PodeApagar` para `PodeApagarPor`; acrescente as duas de antes como delegação:
     ```go
     var reColunaDaChave = regexp.MustCompile(`^[a-z_][a-z0-9_]{0,62}$`)

     // PodeEditar: a linha `id` (o caso comum). Ver PodeEditarPor.
     func (c *Catalogo) PodeEditar(ctx context.Context, tx pgx.Tx, e *Escopo, tab, id string, mudancas map[string]any) error {
     	return c.PodeEditarPor(ctx, tx, e, tab, "id", id, mudancas)
     }

     // PodeApagar: a linha `id`. Ver PodeApagarPor.
     func (c *Catalogo) PodeApagar(ctx context.Context, tx pgx.Tx, e *Escopo, tab, id string) error {
     	return c.PodeApagarPor(ctx, tx, e, tab, "id", id)
     }
     ```
  2. Em `PodeEditarPor`/`PodeApagarPor`, primeira linha: `if !reColunaDaChave.MatchString(coluna) { return ErrDeclaracao }` (a coluna vem da declaração da rota; nunca do pedido).
  3. Passe `coluna` até `conferirExistente` (ou como a 5.0 o chamou) e troque, em TODO ponto em que `id` identifica a linha — a comparação `autz_velha.id …`, a descoberta do tipo da coluna para o cast com savepoint (ex.: `attname = 'id'` → `attname = @autz_coluna::text`) —, o nome fixo por `pgx.Identifier{coluna}.Sanitize()` (no SQL) ou pelo parâmetro (na consulta ao catálogo do Postgres). Nada mais muda.
  4. Crie `escrita_chave_test.go` com `TestPodeEditarPorOutraColuna` (casos de (b); catálogo de teste e tabela `loja` como em `chave_test.go`, sem importar `dados`).

- [ ] **Step 3: `dados`.** Em `api/internal/dados/escrita.go` (as versões do 5.1 + 5.2):
  1. Imports: acrescente `"bytes"` e `"maps"`.
  2. Na struct `Tabela`, depois de `CriarSoLegivel`:
     ```go
     	// Chave: a coluna que acha a linha em Editar/Apagar/Gravar (o {id} da URL é o valor dela) e que vai
     	// no {"<chave>": …} quando quem grava não lê. Vazia = "id" (Ruling 5.5-2).
     	Chave string
     ```
     e o método `func (t Tabela) chave() string { if t.Chave == "" { return "id" }; return t.Chave }`.
  3. Em `Validar`, mais um caso: `case t.Chave != "" && !reColuna.MatchString(t.Chave): return fmt.Errorf("tabela %s: Chave %q inválida", t.Nome, t.Chave)`.
  4. Troque `Criar` por `Criar` + `criar` (o corpo é o do 5.2, com o sufixo `seConflito` antes do `returning`):
     ```go
     // Criar confere a linha nova (WITH CHECK de insert), grava SÓ as colunas presentes e devolve a linha.
     // Rode dentro de banco.ComUsuario.
     func (t Tabela) Criar(ctx context.Context, tx pgx.Tx, cat *autz.Catalogo, e *autz.Escopo, campos map[string]any) ([]byte, error) {
     	return t.criar(ctx, tx, cat, e, campos, "")
     }

     // criar: Criar com um sufixo FIXO antes do returning (Gravar usa ` on conflict (<chave>) do nothing`).
     func (t Tabela) criar(ctx context.Context, tx pgx.Tx, cat *autz.Catalogo, e *autz.Escopo, campos map[string]any, seConflito string) ([]byte, error) {
     	if e == nil {
     		return nil, autz.ErrNegado
     	}
     	if t.Autor != "" {
     		campos[t.Autor] = e.ID // autoria vem da sessão, nunca do corpo
     	}
     	cols, err := colunas(campos)
     	if err != nil {
     		return nil, err
     	}
     	if err := cat.PodeCriar(ctx, tx, e, t.Nome, campos); err != nil {
     		return nil, err
     	}
     	j, err := json.Marshal(campos)
     	if err != nil {
     		return nil, err
     	}
     	tab, lista := pgx.Identifier{t.Nome}.Sanitize(), strings.Join(cols, ", ")
     	linha, err := t.devolver(ctx, tx, cat, e, `insert into `+tab+` (`+lista+`) select `+lista+
     		` from jsonb_populate_record(null::`+tab+`, @dados_campos::jsonb)`+seConflito+` returning *`,
     		pgx.NamedArgs{"dados_campos": string(j)}, t.CriarSoLegivel)
     	var pe *pgconn.PgError
     	if t.CriarSoLegivel && errors.As(err, &pe) && pe.Code == "23503" {
     		return nil, autz.ErrNegado // referência inexistente responde igual à invisível (sem oráculo)
     	}
     	return linha, err
     }
     ```
  5. Em `Editar`: `cat.PodeEditar(ctx, tx, e, t.Nome, id, campos)` → `cat.PodeEditarPor(ctx, tx, e, t.Nome, t.chave(), id, campos)`, e no SQL `dados_alvo.id` → `dados_alvo.`+pgx.Identifier{t.chave()}.Sanitize() (mantendo a forma da comparação que o 5.1 usa).
  6. Em `Apagar`: `PodeApagar` → `PodeApagarPor(ctx, tx, e, t.Nome, t.chave(), id)` e `where id…` → `where `+pgx.Identifier{t.chave()}.Sanitize()+`…`.
  7. Em `devolver`: `(select t.id from t)` → `(select t.`+pgx.Identifier{t.chave()}.Sanitize()+` from t)`.
  8. Acrescente:
     ```go
     // Gravar é o `.upsert(…, {onConflict: <chave>})` das telas, sem corrida (Ruling 5.5-3): se a linha existe
     // e quem pede a lê, Editar (PodeEditarPor trava a linha: USING na antiga, WITH CHECK na nova; só as
     // colunas presentes além da chave); se não existe, Criar com `on conflict (<chave>) do nothing`
     // (PodeCriar antes) e, se outra transação a criou entre um passo e outro, Editar de novo. Existe e não
     // se lê = ErrNaoEncontrado (404, sem oráculo). A chave TEM de vir em campos e nunca muda. Rode dentro
     // de banco.ComUsuario.
     func (t Tabela) Gravar(ctx context.Context, tx pgx.Tx, cat *autz.Catalogo, e *autz.Escopo, campos map[string]any) ([]byte, error) {
     	if t.CriarSoLegivel {
     		return nil, autz.ErrDeclaracao // o "do nothing" responderia ErrNegado e Gravar não saberia tentar Editar
     	}
     	k := t.chave()
     	valor, err := textoDaChave(campos[k])
     	if err != nil {
     		return nil, fmt.Errorf("dados: %s.%s: %w", t.Nome, k, err)
     	}
     	mudancas := maps.Clone(campos)
     	delete(mudancas, k)
     	if len(mudancas) == 0 {
     		return nil, ErrSemCampos
     	}
     	linha, err := t.Editar(ctx, tx, cat, e, valor, mudancas)
     	if !errors.Is(err, autz.ErrNaoEncontrado) {
     		return linha, err
     	}
     	linha, err = t.criar(ctx, tx, cat, e, maps.Clone(campos), ` on conflict (`+pgx.Identifier{k}.Sanitize()+`) do nothing`)
     	if !errors.Is(err, autz.ErrNaoEncontrado) {
     		return linha, err // criou; ou PodeCriar negou (403, que não depende de a linha existir)
     	}
     	return t.Editar(ctx, tx, cat, e, valor, mudancas) // outra transação criou no meio; ou existe e não se lê: 404
     }

     // textoDaChave: o valor da chave como texto (PodeEditarPor o põe no tipo da coluna). Vem do corpo
     // (json.RawMessage: número ou texto JSON) ou da rota (string).
     func textoDaChave(v any) (string, error) {
     	switch x := v.(type) {
     	case string:
     		return x, nil
     	case json.RawMessage:
     		d := json.NewDecoder(bytes.NewReader(x))
     		d.UseNumber()
     		var y any
     		if d.Decode(&y) == nil {
     			switch z := y.(type) {
     			case string:
     				return z, nil
     			case json.Number:
     				return z.String(), nil
     			}
     		}
     	}
     	return "", errors.New("chave ausente ou não é número/texto")
     }
     ```
- [ ] **Step 4: Rodar e morder.** `gofmt -l ./internal && go vet ./internal/autz/ ./internal/dados/ && go test -count=1 -race ./internal/autz/ ./internal/dados/ ./internal/acesso/ ./internal/patrimonio/` → tudo `ok` (as rotas do 5.1/5.2 usam a chave `id` padrão e não mudam). Aplique as mutações de (b), uma por vez, e veja reprovar.
- [ ] **Step 5: Commit.** `git add api/internal/autz/ api/internal/dados/ && git commit -m "feat(api): escrita pela coluna-chave que não é id (PodeEditarPor, Tabela.Chave) e upsert sem corrida (Tabela.Gravar)"` (+ `Co-Authored-By`).

---

### Task 3: Pacote `vendas` e o mundo de teste do Comercial

**Revisor:** opus. **Depende de:** 1, 5.2 T3 (`mundoteste`).

**(a) Contrato**
- `vendas.go`: `soSessaoPropria = dados.SoSessaoPropria(dados.FraseEntrarComo)`; `deve(err)` (`panic` na montagem); `textoOuNulo(campo, v, max)` (como o do 5.2).
- Mundo (interno aos testes do pacote): 8 pessoas (abaixo; `pessoas` cobre TODOS os perfis de escopo do Comercial), `"impersonado"` = sessão do `admin` aberta pelo `super`; lojas 1, 2, 3 (grupo G1), 4 (sem time) e 205512275 (Shopify); times T1 (canal 1, depósito 11), T2 (canal 2, depósito 12), T3 (canal 3, depósito 13); uma linha por loja em cada tabela com restritiva; `fotoDoComercial` (hash de tudo que o 5.5 grava); `chaves(t, corpo, campo)`; `aoMesmoTempo(f)`.

**(b) Testes de aceitação** (`TestMundoDoComercial`, sonda `GET /eco` no próprio teste escrevendo `fmt.Sprintf("%v|%v|%v|%v", e.Canais, e.Depositos, e.SemTrava || e.SuperFicha, a.ImpersonadorID != nil)` a partir de `autz.EscopoDo` e `auth.AtorDoContexto`)
- `super` → `[]|[]|true|false`; `semTrava` → `[]|[]|true|false`; `admin` → `[]|[]|false|false`; `vendT1` → `[1]|[]|false|false`; `estT1` → `[1]|[11]|false|false`; `gestorT2` → `[2]|[12]|false|false`; `supervG1` → `[3]|[13]|false|false` (a supervisora do grupo G1 chega ao T3 pelo grupo); `viewer` → `[]|[]|false|false`; `impersonado` → `[]|[]|false|true`; sem sessão → 401.
- `m.Um(t, "select count(*)::text from bling_pedido_nota")` → `4`; `m.Um(t, fotoDoComercial)` ≠ `<nulo>`.
- Mutação que tem de reprovar: tirar a linha da liberação de estoque do `estT1` (`estT1` cai para `[1]|[]`).

**(c) Arquivos:** Create `api/internal/vendas/vendas.go`, `api/internal/vendas/mundo_test.go`, `api/internal/vendas/vendas_test.go`.

**(d) Dependências:** Task 1 (fatia), `mundoteste` (5.2), `dados.SoSessaoPropria` (5.2).

- [ ] **Step 1: O pacote.** Crie `api/internal/vendas/vendas.go`:

```go
// Package vendas: as rotas do sub-plano 5.5 — o Comercial (Bling e Shopify): lojas e o grupo do canal,
// depósitos, metas de loja e de vendedora, os dois caches que as telas de venda preenchem (vendedor do
// pedido e nome da vendedora), notas, ajustes de valor e de vendedor, formas de pagamento, estoque e
// vendas por item, o briefing da Gestão Comercial e os pedidos da Shopify. Toda regra é a do catálogo de
// produção (autz.Producao: pode_ver_canal e pode_ver_estoque entram sozinhos pela regra de Ler); toda
// escrita roda em banco.ComUsuario; sessão de "entrar como" só lê (Ruling 5.5-8). O proxy do Bling e o
// push de vendas (internal/comercial, Planos 3 e 4) não mudam (Rulings 14 e 24 do mestre).
package vendas

import (
	"encoding/json"
	"fmt"
	"unicode/utf8"

	"github.com/rbv-co/social-dashboard/api/internal/dados"
)

// soSessaoPropria vai em TODA escrita do 5.5 (TestEscritasRecusamImpersonado confere).
var soSessaoPropria = dados.SoSessaoPropria(dados.FraseEntrarComo)

// deve: declaração de rota errada faz a API não subir.
func deve(err error) {
	if err != nil {
		panic(err)
	}
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

- [ ] **Step 2: O mundo.** Crie `api/internal/vendas/mundo_test.go`:

```go
package vendas

import (
	"encoding/json"
	"fmt"
	"slices"
	"strings"
	"sync"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/testebanco/mundoteste"
)

type caso = mundoteste.Caso

// Pessoas e linhas do mundo do 5.5 (ids fixos). "Trava" = escopo_por_equipe; "sales" = a feature que
// pode_ver_vendas() aceita (além de papel admin e super pela ficha).
const (
	idSuper    = "5e550000-0000-4000-a000-000000000001" // super pela ficha, papel viewer: vê todo canal; NÃO grava metas
	idAdmin    = "5e550000-0000-4000-a000-000000000002" // papel admin, com trava, sem time: grava metas e caches, não vê canal
	idSemTrava = "5e550000-0000-4000-a000-000000000003" // sem trava, sem sales: vê todo canal, não grava cache
	idVendT1   = "5e550000-0000-4000-a000-000000000004" // vendedora do T1 (canal 1), sales, sem liberação de estoque
	idEstT1    = "5e550000-0000-4000-a000-000000000005" // vendedora do T1 com a liberação de estoque do T1 (depósito 11)
	idGestorT2 = "5e550000-0000-4000-a000-000000000006" // gestora do T2 (canal 2, depósito 12)
	idSupervG1 = "5e550000-0000-4000-a000-000000000007" // supervisora do grupo G1 (loja 3 → T3, canal 3, depósito 13)
	idViewer   = "5e550000-0000-4000-a000-000000000008" // ninguém

	T1 = "e5500000-0000-4000-a000-000000000001"
	T2 = "e5500000-0000-4000-a000-000000000002"
	T3 = "e5500000-0000-4000-a000-000000000003"
	G1 = "c5500000-0000-4000-a000-000000000001"
	G2 = "c5500000-0000-4000-a000-000000000002"
	B1 = "b5500000-0000-4000-a000-000000000001" // briefing da semana 40
	B2 = "b5500000-0000-4000-a000-000000000002" // briefing da semana 41 (o mais novo)
)

var pessoas = []mundoteste.Pessoa{
	{Chave: "super", ID: idSuper, Email: "super@x.com", Papel: "viewer", Super: true, Trava: true},
	{Chave: "admin", ID: idAdmin, Email: "admin@x.com", Papel: "admin", Trava: true},
	{Chave: "semTrava", ID: idSemTrava, Email: "semtrava@x.com", Papel: "viewer"},
	{Chave: "vendT1", ID: idVendT1, Email: "vendt1@x.com", Papel: "viewer", Trava: true, Modulos: []string{"sales"}},
	{Chave: "estT1", ID: idEstT1, Email: "estt1@x.com", Papel: "viewer", Trava: true, Modulos: []string{"sales"}},
	{Chave: "gestorT2", ID: idGestorT2, Email: "gestort2@x.com", Papel: "viewer", Trava: true, Modulos: []string{"sales"}},
	{Chave: "supervG1", ID: idSupervG1, Email: "supervg1@x.com", Papel: "viewer", Trava: true, Modulos: []string{"sales"}},
	{Chave: "viewer", ID: idViewer, Email: "viewer@x.com", Papel: "viewer", Trava: true},
}

// sem identidade; o gatilho de bling_lojas espelha o nome do grupo em `grupo`
const linhasDoMundo = `
insert into canais_grupos (id, nome) values ('` + G1 + `', 'Atacado'), ('` + G2 + `', 'Varejo');
insert into bling_lojas (loja_id, nome, grupo_id) values (1, 'Loja Tivoli', null), (2, 'Loja Dom Pedro', null),
  (3, 'Atacado', '` + G1 + `'), (4, 'Fábrica', null), (205512275, 'Loja Shopify', null);
insert into equipes (id, nome, canal_loja_id, deposito_id) values
  ('` + T1 + `', 'Tivoli', 1, 11), ('` + T2 + `', 'Dom Pedro', 2, 12), ('` + T3 + `', 'Atacado', 3, 13);
insert into equipes_membros (equipe_id, profile_id, papel) values ('` + T1 + `', '` + idVendT1 + `', 'vendedora'),
  ('` + T1 + `', '` + idEstT1 + `', 'vendedora'), ('` + T2 + `', '` + idGestorT2 + `', 'gestor');
insert into canais_grupos_membros (grupo_id, profile_id) values ('` + G1 + `', '` + idSupervG1 + `');
insert into equipes_permissoes (equipe_id, profile_id, chave) values ('` + T1 + `', '` + idEstT1 + `', 'estoque');
insert into bling_depositos (deposito_id, nome, padrao) values (11, 'Depósito Tivoli', true), (12, 'Depósito Dom Pedro', false),
  (13, 'Depósito Atacado', false), (99, 'Depósito Geral', false);
insert into bling_metas (id, loja_id, year, month, meta_valor, daily_goals) values
  (1, 0, 2026, 10, 200000, null), (2, 1, 2026, 10, 60000, '{"1": 2000, "2": 2000}'), (3, 2, 2026, 9, 50000, null);
select setval('bling_metas_id_seq', 3);
insert into bling_vendedor_metas (id, vendor_id, year, month, meta_valor) values (1, 7, 2026, 10, 20000);
select setval('bling_vendedor_metas_id_seq', 1);
insert into bling_vendedores (vendor_id, nome) values (7, 'Ana'), (8, 'Bia');
insert into bling_pedido_vendedor (pedido_id, vendor_id, pedido_data, qtd_itens, loja_id) values
  (101, 7, '2026-10-01', 2, 1), (102, 8, '2026-10-02', 1, 2);
insert into bling_pedido_nota (pedido_id, pedido_numero, loja_id, data_pedido, total, nota_situacao, data_da_nota) values
  (101, '2001', 1, '2026-10-01', 100, 6, null), (102, '2002', 2, '2026-10-02', 200, 6, null),
  (103, '2003', 3, '2026-10-03', 300, 6, '2026-10-04'), (104, '2004', null, '2026-10-05', 400, 6, null);
insert into bling_pedido_ajuste_valor (pedido_id, loja_id, total_corrigido, total_do_bling, motivo) values
  (101, 1, 90, 100, 'desconto no pix não lançado'), (102, 2, 150, 200, 'troca abatida no caixa');
insert into bling_pedido_ajuste_vendedor (pedido_id, loja_id, vendor_id_corrigido, vendor_id_do_bling, motivo) values
  (101, 1, 8, 7, 'quem vendeu foi a Bia'), (103, 3, 7, null, 'quem vendeu foi a Ana');
insert into bling_pedido_forma_pagamento (parcela_id, pedido_id, loja_id, forma_pagamento_id, valor, eh_devolucao) values
  (1001, 101, 1, 5, 10, true), (1002, 102, 2, 5, 20, true), (1003, 101, 1, 1, 90, false);
insert into gc_vendas_item (mes, canal_loja_id, sku, produto, categoria, unidades, faturamento) values
  ('2026-09-01', 1, 'A', 'Bolsa A', 'Bolsas', 2, 500), ('2026-09-01', 2, 'B', 'Bolsa B', 'Bolsas', 1, 300),
  ('2026-09-01', 3, 'C', 'Bolsa C', 'Bolsas', 4, 900), ('2026-10-01', 1, 'A', 'Bolsa A', 'Bolsas', 1, 250);
insert into gc_estoque_item (deposito_id, sku, produto, categoria, saldo) values
  (11, 'A', 'Bolsa A', 'Bolsas', 5), (12, 'B', 'Bolsa B', 'Bolsas', 3), (13, 'C', 'Bolsa C', 'Bolsas', 7), (99, 'D', 'Bolsa D', 'Bolsas', 1);
insert into gestao_comercial_briefings (id, rodada, resumo, conteudo, created_at) values
  ('` + B1 + `', '2026-10-05', 'semana 40', 'texto 40', '2026-10-05T12:00:00Z'),
  ('` + B2 + `', '2026-10-12', 'semana 41', 'texto 41', '2026-10-12T12:00:00Z');
insert into shopify_pedidos (id, numero, loja_id, total, status_financeiro, cliente_nome, cliente_email, criado_em_shopify, bruto) values
  (9001, '#1001', 205512275, 500, 'paid', 'Fulana de Tal', 'fulana@exemplo.com', '2026-10-01T15:00:00Z', '{"email": "fulana@exemplo.com"}'),
  (9002, '#1002', 1, 300, 'paid', 'Beltrana', 'beltrana@exemplo.com', '2026-10-02T15:00:00Z', '{}');`

// fotoDoComercial: um hash de tudo que o 5.5 grava. Igual antes e depois = nada mudou.
const fotoDoComercial = `select md5(string_agg(l, '|' order by l)) from (
  select 'lojas:' || t::text as l from bling_lojas t union all
  select 'metas:' || t::text from bling_metas t union all
  select 'vmetas:' || t::text from bling_vendedor_metas t union all
  select 'vendedoras:' || t::text from bling_vendedores t union all
  select 'cache:' || t::text from bling_pedido_vendedor t) z`

func novoMundo(t *testing.T, montar ...func(chi.Router, *pgxpool.Pool)) *mundoteste.Mundo {
	t.Helper()
	return mundoteste.Novo(t, mundoteste.Opcoes{Pessoas: pessoas, Linhas: linhasDoMundo,
		Impersonadas: map[string][2]string{"impersonado": {idAdmin, idSuper}}}, montar...)
}

// chaves: os valores de `campo` numa lista JSON, como texto, ordenados e juntados por vírgula ("" = vazia).
func chaves(t *testing.T, corpo, campo string) string {
	t.Helper()
	d := json.NewDecoder(strings.NewReader(corpo))
	d.UseNumber()
	var l []map[string]any
	if err := d.Decode(&l); err != nil {
		t.Fatalf("%v: %s", err, corpo)
	}
	out := make([]string, 0, len(l))
	for _, x := range l {
		out = append(out, fmt.Sprint(x[campo]))
	}
	slices.Sort(out)
	return strings.Join(out, ",")
}

// aoMesmoTempo roda f(0) e f(1) soltos pela mesma largada (para provar a ausência de corrida). Dentro de
// f, só t.Errorf (nunca Fatal fora da goroutine do teste).
func aoMesmoTempo(f func(lado int)) {
	var wg sync.WaitGroup
	largada := make(chan struct{})
	for lado := range 2 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-largada
			f(lado)
		}()
	}
	close(largada)
	wg.Wait()
}
```

- [ ] **Step 3: O teste.** `vendas_test.go` com `TestMundoDoComercial` (casos de (b)). Run: `gofmt -l ./internal && go vet ./internal/vendas/ && go test -count=1 -v ./internal/vendas/ 2>&1 | grep -E '^(--- |ok|FAIL)'` → PASS; a mutação de (b) reprova.
- [ ] **Step 4: Commit.** `git add api/internal/vendas/ && git commit -m "test(api): pacote vendas e o mundo de teste do Comercial (oito escopos de canal e depósito)"` (+ `Co-Authored-By`).

---

### Task 4: Leituras com escopo de canal e de depósito

**Revisor:** opus. **Depende de:** 3.

**(a) Contrato** (as declarações são o código; regra = catálogo: `<tabela>_leitura` `true` E a restritiva de produção, que a CTE-sombra aplica sozinha)

```go
package vendas

import (
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/autz"
	"github.com/rbv-co/social-dashboard/api/internal/dados"
)

// leiturasComEscopo: as 7 tabelas com restritiva de produção (pode_ver_canal ×6, pode_ver_estoque ×1).
// Colunas = as que as telas leem (Ruling 5.5-7: nos pedidos da Shopify, nada de cliente nem payload).
var leiturasComEscopo = map[string]dados.Consulta{
	// data-da-venda.js:28. janela = daterange do Postgres ("[AAAA-MM-DD,AAAA-MM-DD]"): o
	// .or(and(data_da_venda…),and(data_pedido…)) da tela (Ruling 5.5-11). Restritiva: bpn_so_do_meu_canal.
	"/comercial/notas": {Tabela: "bling_pedido_nota", Alias: "t",
		SQL: `select t.pedido_id, t.pedido_numero, t.data_pedido, t.data_da_venda, t.total, t.loja_id, t.nota_situacao from bling_pedido_nota t`,
		Filtros: []dados.Filtro{{Param: "janela", Tipo: "texto",
			SQL: "(t.data_da_venda >= lower(@janela::text::daterange) and t.data_da_venda < upper(@janela::text::daterange)) or " +
				"(t.data_pedido >= lower(@janela::text::daterange) and t.data_pedido < upper(@janela::text::daterange))"}},
		OrdemPadrao: "t.pedido_id", Desempate: "t.pedido_id"},
	// valor-corrigido.js:30. Restritiva: bpav_so_do_meu_canal. motivo/criado_por: nenhuma tela lê.
	"/comercial/ajustes-de-valor": {Tabela: "bling_pedido_ajuste_valor", Alias: "t",
		SQL:         `select t.pedido_id, t.total_corrigido from bling_pedido_ajuste_valor t`,
		OrdemPadrao: "t.pedido_id", Desempate: "t.pedido_id"},
	// vendedor-corrigido.js:23. Restritiva: bpaven_so_do_meu_canal.
	"/comercial/ajustes-de-vendedor": {Tabela: "bling_pedido_ajuste_vendedor", Alias: "t",
		SQL:         `select t.pedido_id, t.vendor_id_corrigido from bling_pedido_ajuste_vendedor t`,
		OrdemPadrao: "t.pedido_id", Desempate: "t.pedido_id"},
	// valor-liquido-de-troca.js:26 (?eh_devolucao=true). Restritiva: bpfp_so_do_meu_canal.
	"/comercial/formas-de-pagamento": {Tabela: "bling_pedido_forma_pagamento", Alias: "t",
		SQL:         `select t.pedido_id, t.valor from bling_pedido_forma_pagamento t`,
		Filtros:     []dados.Filtro{{Param: "eh_devolucao", SQL: "t.eh_devolucao = @eh_devolucao::boolean", Tipo: "booleano"}},
		OrdemPadrao: "t.pedido_id", Desempate: "t.parcela_id"},
	// tela-de-gestao-a-vista.vue:970 (?deposito_id=), relatorios-comerciais.vue:414. Restritiva: gc_ei_so_do_meu_time (pode_ver_estoque).
	"/comercial/estoque": {Tabela: "gc_estoque_item", Alias: "t",
		SQL:         `select t.deposito_id, t.sku, t.produto, t.categoria, t.saldo from gc_estoque_item t`,
		Filtros:     []dados.Filtro{{Param: "deposito_id", SQL: "t.deposito_id = any(@deposito_id::bigint[])", Tipo: "inteiro[]"}},
		OrdemPadrao: "t.deposito_id", Desempate: "t.deposito_id, t.sku"},
	// relatorios-comerciais.vue:402 (?mes=), :426. Restritiva: gc_vi_so_do_meu_time (pode_ver_canal(canal_loja_id)).
	"/comercial/vendas-por-item": {Tabela: "gc_vendas_item", Alias: "t",
		SQL:         `select t.mes, t.canal_loja_id, t.sku, t.produto, t.categoria, t.unidades, t.faturamento from gc_vendas_item t`,
		Filtros:     []dados.Filtro{{Param: "mes", SQL: "t.mes = any(@mes::date[])", Tipo: "data[]"}},
		OrdemPadrao: "t.mes", Desempate: "t.mes, t.canal_loja_id, t.sku"},
	// pedidos-shopify.js:42. Restritiva: shopify_pedidos_so_do_meu_canal.
	"/comercial/pedidos-shopify": {Tabela: "shopify_pedidos", Alias: "t",
		SQL: `select t.id, t.total, t.criado_em_shopify, t.status_financeiro from shopify_pedidos t`,
		Filtros: []dados.Filtro{
			{Param: "criado_de", SQL: "t.criado_em_shopify >= @criado_de::timestamptz", Tipo: "instante"},
			{Param: "criado_ate", SQL: "t.criado_em_shopify < @criado_ate::timestamptz", Tipo: "instante"},
			{Param: "status_financeiro", SQL: "t.status_financeiro = any(@status_financeiro::text[])", Tipo: "texto[]"},
		},
		OrdemPadrao: "t.criado_em_shopify", Desempate: "t.id"},
}

// montarLeituras: as 7 GET. Handler chama Validar (declaração errada derruba a subida).
func montarLeituras(r chi.Router, p *pgxpool.Pool) {
	for caminho, c := range leiturasComEscopo {
		r.Get(caminho, c.Handler(p, autz.Producao))
	}
}
```

Sem permissão = `200 []`; parâmetro desconhecido, repetido ou inválido (janela que não é intervalo, mês que não é data) = `400`.

**(b) Testes de aceitação** (`leituras_test.go`)
- `TestNadaVazaEntreLojas` (código abaixo): para CADA rota de `leiturasComEscopo` × CADA pessoa de `pessoas`, o conjunto exato de chaves; faltar um par = o teste falha. Nos pedidos Shopify, a resposta de TODA pessoa não tem `Fulana`, `fulana@`, `cliente_` nem `bruto`.
- `TestFiltrosNaoAbremOutraLoja`: `vendT1` `/comercial/estoque?deposito_id=12` → `""`; `estT1` `?deposito_id=11,12` → `11`; `vendT1` `/comercial/vendas-por-item?mes=2026-09-01` → canal `1`; `gestorT2` `?mes=2026-10-01` → `""`; `vendT1` `/comercial/notas?janela=[2026-10-01,2026-10-31]` (com `url.QueryEscape`) → `101`; `super` `?janela=[2026-10-04,2026-10-04]` → `103` (pela data da nota) e `?janela=[2026-10-03,2026-10-03]` → `103` (pela data do pedido); `super` `/comercial/pedidos-shopify?criado_de=2026-10-02T00:00:00-03:00&criado_ate=2026-10-03T00:00:00-03:00&status_financeiro=paid,partially_refunded` → `9002`; `vendT1` `/comercial/notas?contar=1&limite=1` → `X-Total-Count: 1`; `?janela=x` → 400; `?mes=setembro` → 400; `?loja_id=2` → 400 (parâmetro desconhecido, nunca ignorado).
- Mutações que têm de reprovar: trocar a `Tabela` da consulta de notas por `bling_pedido_vendedor` (o `Validar` derruba a montagem); acrescentar `cliente_email` à lista da Shopify (o `naoTem` acusa); tirar o parêntese em volta do `or` da janela NA DECLARAÇÃO e confirmar que o 5.0 ainda embrulha (o teste continua verde: a defesa é do `dados`).

```go
package vendas

import (
	"net/http"
	"strings"
	"testing"
)

// casoDeEscopo: as chaves que cada pessoa enxerga numa leitura com restritiva (campo ordenado; "" = vazia).
type casoDeEscopo struct {
	caminho, campo string
	quer           map[string]string
}

// casosDeEscopo: TODA rota de leiturasComEscopo × TODA pessoa do mundo. Lojas: 1 = T1, 2 = T2, 3 = T3 (G1),
// 205512275 = Shopify (sem time), nota 104 sem loja. papel admin COM trava não vê canal nenhum (paridade).
var casosDeEscopo = map[string]casoDeEscopo{
	"/comercial/notas": {"/comercial/notas", "pedido_id", map[string]string{
		"super": "101,102,103,104", "semTrava": "101,102,103,104", "admin": "", "vendT1": "101", "estT1": "101",
		"gestorT2": "102", "supervG1": "103", "viewer": ""}},
	"/comercial/ajustes-de-valor": {"/comercial/ajustes-de-valor", "pedido_id", map[string]string{
		"super": "101,102", "semTrava": "101,102", "admin": "", "vendT1": "101", "estT1": "101",
		"gestorT2": "102", "supervG1": "", "viewer": ""}},
	"/comercial/ajustes-de-vendedor": {"/comercial/ajustes-de-vendedor", "pedido_id", map[string]string{
		"super": "101,103", "semTrava": "101,103", "admin": "", "vendT1": "101", "estT1": "101",
		"gestorT2": "", "supervG1": "103", "viewer": ""}},
	"/comercial/formas-de-pagamento": {"/comercial/formas-de-pagamento?eh_devolucao=true", "pedido_id", map[string]string{
		"super": "101,102", "semTrava": "101,102", "admin": "", "vendT1": "101", "estT1": "101",
		"gestorT2": "102", "supervG1": "", "viewer": ""}},
	"/comercial/estoque": {"/comercial/estoque", "deposito_id", map[string]string{
		"super": "11,12,13,99", "semTrava": "11,12,13,99", "admin": "", "vendT1": "", "estT1": "11",
		"gestorT2": "12", "supervG1": "13", "viewer": ""}},
	"/comercial/vendas-por-item": {"/comercial/vendas-por-item", "canal_loja_id", map[string]string{
		"super": "1,1,2,3", "semTrava": "1,1,2,3", "admin": "", "vendT1": "1,1", "estT1": "1,1",
		"gestorT2": "2", "supervG1": "3", "viewer": ""}},
	"/comercial/pedidos-shopify": {"/comercial/pedidos-shopify", "id", map[string]string{
		"super": "9001,9002", "semTrava": "9001,9002", "admin": "", "vendT1": "9002", "estT1": "9002",
		"gestorT2": "", "supervG1": "", "viewer": ""}},
}

// Nenhuma linha de outra loja/depósito chega a quem não a vê em produção, pelo handler real.
func TestNadaVazaEntreLojas(t *testing.T) {
	m := novoMundo(t, montarLeituras)
	if len(casosDeEscopo) != len(leiturasComEscopo) {
		t.Fatalf("%d casos para %d rotas: rota com restritiva sem matriz", len(casosDeEscopo), len(leiturasComEscopo))
	}
	for rota, c := range casosDeEscopo {
		if _, ok := leiturasComEscopo[rota]; !ok {
			t.Fatalf("caso de %s sem rota", rota)
		}
		for _, p := range pessoas {
			quer, ok := c.quer[p.Chave]
			if !ok {
				t.Fatalf("%s: falta o caso de %s", rota, p.Chave)
			}
			st, corpo := m.Pedir(t, p.Chave, http.MethodGet, c.caminho, "")
			if st != http.StatusOK {
				t.Errorf("%s como %s = %d %s", c.caminho, p.Chave, st, corpo)
				continue
			}
			if v := chaves(t, corpo, c.campo); v != quer {
				t.Errorf("%s como %s: %s = %q, esperava %q", c.caminho, p.Chave, c.campo, v, quer)
			}
			for _, proibido := range []string{"Fulana", "fulana@", "cliente_", "bruto"} {
				if strings.Contains(corpo, proibido) {
					t.Errorf("%s como %s devolveu %q (dado pessoal)", c.caminho, p.Chave, proibido)
				}
			}
		}
	}
}
```

**(c) Arquivos:** Create `api/internal/vendas/leituras.go`, `api/internal/vendas/leituras_test.go`.

**(d) Dependências:** Task 3; `dados.Consulta/Filtro` (5.0).

- [ ] **Step 1:** `leituras_test.go` (o código acima + `TestFiltrosNaoAbremOutraLoja`); `go test -count=1 -run 'NadaVaza|Filtros' ./internal/vendas/` → FAIL (`montarLeituras`).
- [ ] **Step 2:** Implementar `leituras.go` (o contrato acima).
- [ ] **Step 3:** `gofmt -l ./internal && go vet ./internal/vendas/ && go test -count=1 -v -run 'NadaVaza|Filtros' ./internal/vendas/` → PASS; mutações reprovam.
- [ ] **Step 4:** Commit `feat(api): leituras do Comercial com o escopo de canal e de depósito de produção (sem dado de cliente da Shopify)` (+ `Co-Authored-By`).

---

### Task 5: Leituras globais — depósitos e briefings

**Revisor:** sonnet. **Depende de:** 3.

**(a) Contrato**

```go
// GET /comercial/depositos (bling_depositos_read: true). tela-de-gestao-a-vista.vue:704.
var consultaDepositos = dados.Consulta{Tabela: "bling_depositos", Alias: "t",
	SQL:    `select t.deposito_id, t.nome, t.ativo, t.padrao from bling_depositos t`,
	Ordens: map[string]string{"nome": "t.nome"}, OrdemPadrao: "t.deposito_id", Desempate: "t.deposito_id"}

// GET /comercial/briefings (gcb_select: true). tela-de-gestao-comercial.vue:277 (?ordem=created_at.desc&limite=20).
var consultaBriefings = dados.Consulta{Tabela: "gestao_comercial_briefings", Alias: "t",
	SQL:    `select t.id, t.rodada, t.periodo, t.resumo, t.conteudo, t.dados_json, t.created_at from gestao_comercial_briefings t`,
	Ordens: map[string]string{"created_at": "t.created_at", "rodada": "t.rodada"}, OrdemPadrao: "t.created_at desc", Desempate: "t.id"}

func montarGlobais(r chi.Router, p *pgxpool.Pool) {
	r.Get("/comercial/depositos", consultaDepositos.Handler(p, autz.Producao))
	r.Get("/comercial/briefings", consultaBriefings.Handler(p, autz.Producao))
}
```

**(b) Testes de aceitação** (`TestLeiturasGlobais`): `viewer` `/comercial/depositos` → `11,12,13,99` (paridade: policy `true`); `?ordem=nome&limite=1` → `Depósito Atacado`; `viewer` `/comercial/briefings?limite=1` → só `B2` (o mais novo); `?ordem=created_at.asc&limite=1` → `B1`; `?rodada=x` → 400; sem sessão → 401 (pela cadeia do mundo).

**(c) Arquivos:** Create `api/internal/vendas/globais.go`, `api/internal/vendas/globais_test.go`.

**(d) Dependências:** Task 3.

- [ ] **Step 1:** Teste; ver falhar. - [ ] **Step 2:** Implementar. - [ ] **Step 3:** gofmt/vet/test PASS. - [ ] **Step 4:** Commit `feat(api): depósitos e briefings do Comercial (leitura de toda sessão, como em produção)` (+ `Co-Authored-By`).

---

### Task 6: Lojas — leitura e fechar/agrupar canal

**Revisor:** opus. **Depende de:** 2 (`Tabela.Chave`), 3.

**(a) Contrato**

```go
const colunasLoja = `t.loja_id, t.nome, t.grupo, t.grupo_id, t.fechado_em`

// GET /comercial/lojas (authenticated read bling_lojas: true). gav:685; admin:881, 1229, 4107; av:394 (?ordem=loja_id).
var consultaLojas = dados.Consulta{Tabela: "bling_lojas", Alias: "t", SQL: `select ` + colunasLoja + ` from bling_lojas t`,
	Ordens: map[string]string{"nome": "t.nome", "loja_id": "t.loja_id"}, OrdemPadrao: "t.nome", Desempate: "t.loja_id"}

// PATCH /comercial/lojas/{id} — {id} = loja_id (bling_lojas_grupo_superadmin: superadmin_pela_ficha() antes e
// depois). O que o Admin grava (tela-de-admin.vue:1072 fechado_em; :1194 grupo_id); o texto `grupo` vem do
// gatilho espelhar_grupo_do_canal e volta na resposta. Mandar nome/grupo/loja_id = 400.
type corpoLoja struct {
	FechadoEm json.RawMessage `json:"fechado_em,omitempty"`
	GrupoID   json.RawMessage `json:"grupo_id,omitempty"`
}

var tabelaLojas = dados.Tabela{Nome: "bling_lojas", Chave: "loja_id", Resposta: colunasLoja}

func montarLojas(r chi.Router, p *pgxpool.Pool) {
	deve(tabelaLojas.Validar(autz.Producao))
	r.Get("/comercial/lojas", consultaLojas.Handler(p, autz.Producao))
	r.With(soSessaoPropria).Patch("/comercial/lojas/{id}", dados.RotaEditar[corpoLoja](p, autz.Producao, tabelaLojas))
}
```

Erros esperados: grupo inexistente (FK) → 409; data que não é data → 400; loja inexistente ou `{id}` que não é número → 404 (linha lida por toda sessão: inexistente é o único 404).

**(b) Testes de aceitação** (`TestLojas`, com `m.Rodar`; efeito conferido no banco)
- Leitura: `viewer` → as 5 lojas (`chaves(…, "loja_id")` = `1,2,205512275,3,4`; a primeira pelo nome é a 3, `Atacado`); `?ordem=loja_id&limite=1` → `1`; a loja 3 traz `"grupo":"Atacado"`.
- Fechar: `super` PATCH `/comercial/lojas/2` `{"fechado_em":"2026-08-31"}` → 200 com `"fechado_em":"2026-08-31"`; `{"fechado_em":null}` → 200 e nulo (reabrir); `admin` (papel admin, não é super) → 403 e intacta; `vendT1` → 403; `semTrava` → 403.
- Agrupar: `super` PATCH `/comercial/lojas/1` `{"grupo_id":"` + G2 + `"}` → 200 com `"grupo":"Varejo"` (o gatilho rodou dentro da transação e a resposta é a linha depois dele); `{"grupo_id":null}` → 200 e `grupo` nulo; `{"grupo_id":"c5500000-0000-4000-a000-0000000000ff"}` → 409, intacta.
- Pedido inválido (intacta): `{}` → 400; `{"nome":"x"}` → 400 `corpo_invalido`; `{"fechado_em":"31/08/2026"}` → 400; `/comercial/lojas/999` → 404; `/comercial/lojas/abc` → 404; `impersonado` → 403 com a frase.
- Mutações que têm de reprovar: `Chave: ""` em `tabelaLojas` (o PATCH quebra: `bling_lojas` não tem `id`); `RotaEditar` sem `soSessaoPropria` (pega na Task 9).

**(c) Arquivos:** Create `api/internal/vendas/lojas.go`, `api/internal/vendas/lojas_test.go`.

**(d) Dependências:** Tasks 2 e 3; `dados.RotaEditar` (5.1).

- [ ] **Step 1:** Teste; ver falhar. - [ ] **Step 2:** Implementar (o contrato acima, imports `encoding/json`, `chi`, `pgxpool`, `autz`, `dados`). - [ ] **Step 3:** gofmt/vet/test PASS; mutações reprovam. - [ ] **Step 4:** Commit `feat(api): /comercial/lojas — leitura e fechar/agrupar canal só por super-admin, com o espelho do grupo` (+ `Co-Authored-By`).

---

### Task 7: Metas — leitura e salvar o mês numa transação

**Revisor:** opus (dinheiro). **Depende de:** 3. (Usa `Tabela.Criar/Editar/Apagar` pelo `id`, sem `Chave`.)

**(a) Contrato**
- `GET /comercial/metas-lojas?ano=&mes=` e `GET /comercial/metas-vendedoras?ano=&mes=` (regra: `auth.role() = 'authenticated'` = toda sessão; Ruling 5.5-5).
- `POST /comercial/metas/salvar` (`soSessaoPropria`; regra de escrita: `admin_write_metas`/`admin_write_vend_metas` = papel `admin` com conta ativa) com
  `{"ano":2026,"mes":10,"lojas":{"gravar":[{"loja_id":1,"meta_valor":80000,"daily_goals":{"1":40000,"2":40000}},{"loja_id":2,"meta_valor":50000,"daily_goals":null}],"apagar":[0]},"vendedoras":{"gravar":[{"vendor_id":8,"meta_valor":15000,"daily_goals":null}],"apagar":[7]}}`
  → `200 {"gravadas":n,"apagadas":m}`. Tudo numa transação, sob a trava do mês (Ruling 5.5-6): cada meta é localizada pela chave natural (`loja_id`/`vendor_id`, `year`, `month`) com a regra de Ler; 0 linhas → `Tabela.Criar`; 1 → `Tabela.Editar` (`meta_valor`, `daily_goals`); mais de 1 → `409` "Há mais de uma meta…" (nunca escolhe uma em silêncio); apagar o que não existe → 404. Qualquer recusa (403/404/409/400 do banco) = NADA gravado. `loja_id` 0 = "Total geral" (paridade).
- Validação (400 `pedido_invalido`, nada gravado): `ano` 2020–2100, `mes` 1–12; de 1 a 500 metas no total; chave inteira (loja ≥ 0, vendedora ≥ 1); a mesma chave duas vezes no mesmo lado (gravar ∪ apagar) = 400; `meta_valor` número > 0 até 999.999.999,99 com até 2 casas; `daily_goals` ausente/`null` (grava nulo) ou objeto de até 31 chaves `^[0-9A-Za-z_-]{1,20}$` com valores do mesmo formato (≥ 0). Campo desconhecido = 400 `corpo_invalido`.
- Registro no log (sem valores): `slog.Info("metas salvas", "por", e.ID, "ano", …, "mes", …, "gravadas", n, "apagadas", m)`.

```go
package vendas

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"regexp"
	"strconv"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/autz"
	"github.com/rbv-co/social-dashboard/api/internal/banco"
	"github.com/rbv-co/social-dashboard/api/internal/dados"
)

const (
	colunasMetaLoja      = `t.id, t.loja_id, t.year, t.month, t.meta_valor, t.daily_goals`
	colunasMetaVendedora = `t.id, t.vendor_id, t.year, t.month, t.meta_valor, t.daily_goals`
	// MetasPorVez: o formulário de metas do Admin mostra as lojas e as vendedoras de UM mês (dezenas).
	MetasPorVez = 500
)

var (
	filtrosDoMes = []dados.Filtro{
		{Param: "ano", SQL: "t.year = @ano::bigint", Tipo: "inteiro"},
		{Param: "mes", SQL: "t.month = @mes::bigint", Tipo: "inteiro"},
	}
	// GET /comercial/metas-lojas: gav:686, admin:4108, av:395.
	consultaMetasLojas = dados.Consulta{Tabela: "bling_metas", Alias: "t", SQL: `select ` + colunasMetaLoja + ` from bling_metas t`,
		Filtros: filtrosDoMes, OrdemPadrao: "t.loja_id", Desempate: "t.id"}
	// GET /comercial/metas-vendedoras: admin:4110.
	consultaMetasVendedoras = dados.Consulta{Tabela: "bling_vendedor_metas", Alias: "t", SQL: `select ` + colunasMetaVendedora + ` from bling_vendedor_metas t`,
		Filtros: filtrosDoMes, OrdemPadrao: "t.vendor_id", Desempate: "t.id"}

	tabelaMetasLojas      = dados.Tabela{Nome: "bling_metas", Resposta: colunasMetaLoja}
	tabelaMetasVendedoras = dados.Tabela{Nome: "bling_vendedor_metas", Resposta: colunasMetaVendedora}

	reInteiro    = regexp.MustCompile(`^(0|[1-9][0-9]{0,17})$`)
	reValor      = regexp.MustCompile(`^(0|[1-9][0-9]{0,8})(\.[0-9]{1,2})?$`) // R$ até 999.999.999,99, 2 casas
	reChaveDoDia = regexp.MustCompile(`^[0-9A-Za-z_-]{1,20}$`)
)

type metaDaLoja struct {
	LojaID     json.RawMessage `json:"loja_id"`
	MetaValor  json.RawMessage `json:"meta_valor"`
	DailyGoals json.RawMessage `json:"daily_goals"`
}

type metaDaVendedora struct {
	VendorID   json.RawMessage `json:"vendor_id"`
	MetaValor  json.RawMessage `json:"meta_valor"`
	DailyGoals json.RawMessage `json:"daily_goals"`
}

type corpoMetas struct {
	Ano   int `json:"ano"`
	Mes   int `json:"mes"`
	Lojas struct {
		Gravar []metaDaLoja      `json:"gravar"`
		Apagar []json.RawMessage `json:"apagar"`
	} `json:"lojas"`
	Vendedoras struct {
		Gravar []metaDaVendedora `json:"gravar"`
		Apagar []json.RawMessage `json:"apagar"`
	} `json:"vendedoras"`
}

// lado: as metas de UMA tabela num salvamento.
type lado struct {
	tabela dados.Tabela
	coluna string // loja_id | vendor_id
	nome   string // para as frases
	gravar []metaValidada
	apagar []int64
}

type metaValidada struct {
	chave          int64
	valor, diarias json.RawMessage
}

// metaDuplicada: a chave natural tem mais de uma linha no mês (bling_metas pode não ter único): 409.
type metaDuplicada struct {
	nome  string
	chave int64
}

func (d metaDuplicada) Error() string {
	return fmt.Sprintf("Há mais de uma meta da %s %d neste mês. Avise o suporte antes de salvar de novo.", d.nome, d.chave)
}

func lerChave(v json.RawMessage, minimo int64) (int64, bool) {
	if !reInteiro.Match(v) {
		return 0, false
	}
	n, err := strconv.ParseInt(string(v), 10, 64)
	return n, err == nil && n >= minimo
}

func validarMeta(nome string, chave, valor, diarias json.RawMessage, minimo int64) (metaValidada, error) {
	k, ok := lerChave(chave, minimo)
	if !ok {
		return metaValidada{}, fmt.Errorf("Confira a %s da meta.", nome)
	}
	if f, err := strconv.ParseFloat(string(valor), 64); !reValor.Match(valor) || err != nil || f <= 0 {
		return metaValidada{}, fmt.Errorf("Meta da %s %d: use um valor maior que zero, com até duas casas.", nome, k)
	}
	if len(diarias) == 0 || string(diarias) == "null" {
		return metaValidada{chave: k, valor: valor, diarias: json.RawMessage("null")}, nil
	}
	var dias map[string]json.RawMessage
	if json.Unmarshal(diarias, &dias) != nil || len(dias) > 31 {
		return metaValidada{}, fmt.Errorf("Meta da %s %d: a meta de cada dia tem de ser uma lista de até 31 dias.", nome, k)
	}
	for dia, v := range dias {
		if !reChaveDoDia.MatchString(dia) || !reValor.Match(v) {
			return metaValidada{}, fmt.Errorf("Meta da %s %d: confira a meta do dia %q.", nome, k, dia)
		}
	}
	return metaValidada{chave: k, valor: valor, diarias: diarias}, nil
}

// validarMetas confere o pedido inteiro ANTES de abrir a transação.
func validarMetas(in corpoMetas) ([]lado, error) {
	if in.Ano < 2020 || in.Ano > 2100 || in.Mes < 1 || in.Mes > 12 {
		return nil, errors.New("Mês ou ano inválido.")
	}
	lojas := lado{tabela: tabelaMetasLojas, coluna: "loja_id", nome: "loja"}
	for _, g := range in.Lojas.Gravar {
		m, err := validarMeta("loja", g.LojaID, g.MetaValor, g.DailyGoals, 0) // 0 = "Total geral"
		if err != nil {
			return nil, err
		}
		lojas.gravar = append(lojas.gravar, m)
	}
	vend := lado{tabela: tabelaMetasVendedoras, coluna: "vendor_id", nome: "vendedora"}
	for _, g := range in.Vendedoras.Gravar {
		m, err := validarMeta("vendedora", g.VendorID, g.MetaValor, g.DailyGoals, 1)
		if err != nil {
			return nil, err
		}
		vend.gravar = append(vend.gravar, m)
	}
	for _, par := range []struct {
		l      *lado
		apagar []json.RawMessage
		minimo int64
	}{{&lojas, in.Lojas.Apagar, 0}, {&vend, in.Vendedoras.Apagar, 1}} {
		for _, v := range par.apagar {
			k, ok := lerChave(v, par.minimo)
			if !ok {
				return nil, fmt.Errorf("Confira a %s da meta a apagar.", par.l.nome)
			}
			par.l.apagar = append(par.l.apagar, k)
		}
	}
	total := 0
	for _, l := range []lado{lojas, vend} {
		todas := make([]int64, 0, len(l.gravar)+len(l.apagar))
		for _, g := range l.gravar {
			todas = append(todas, g.chave)
		}
		vistas := map[int64]bool{}
		for _, k := range append(todas, l.apagar...) {
			if vistas[k] {
				return nil, fmt.Errorf("A %s %d aparece duas vezes.", l.nome, k)
			}
			vistas[k] = true
		}
		total += len(vistas)
	}
	switch {
	case total == 0:
		return nil, errors.New("Nada para gravar.")
	case total > MetasPorVez:
		return nil, fmt.Errorf("Mande no máximo %d metas por vez.", MetasPorVez)
	}
	return []lado{lojas, vend}, nil
}

// localizarMeta: os ids da meta pela chave natural, com a regra de Ler do catálogo (para metas, toda
// sessão; a defesa vale se a policy mudar). Roda sob a trava do mês.
func localizarMeta(ctx context.Context, tx pgx.Tx, e *autz.Escopo, l lado, chave int64, ano, mes int) ([]string, error) {
	f, err := autz.Producao.Filtro(e, l.tabela.Nome, autz.Ler, "t")
	if err != nil {
		return nil, err
	}
	linhas, err := tx.Query(ctx, `select t.id::text from `+pgx.Identifier{l.tabela.Nome}.Sanitize()+` t where t.`+
		pgx.Identifier{l.coluna}.Sanitize()+` = @chave::bigint and t.year = @ano::int and t.month = @mes::int and (`+f.SQL+`) order by t.id`,
		f.Juntar(pgx.NamedArgs{"chave": chave, "ano": ano, "mes": mes}))
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(linhas, pgx.RowTo[string])
}

// salvarMetas: POST /comercial/metas/salvar. O "Salvar" do Admin (tela-de-admin.vue:4246-4266) numa
// transação só, cada meta pelo MESMO Tabela.Criar/Editar/Apagar (PodeX + SQL com o mesmo mapa).
func salvarMetas(p *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		e := autz.EscopoDo(r.Context())
		if e == nil {
			dados.Erro(w, http.StatusInternalServerError, "erro_interno", "")
			return
		}
		var in corpoMetas
		if !dados.LerCorpo(w, r, &in) {
			return
		}
		lados, err := validarMetas(in)
		if err != nil {
			dados.Erro(w, http.StatusBadRequest, "pedido_invalido", err.Error())
			return
		}
		ctx := r.Context()
		var gravadas, apagadas int
		err = banco.ComUsuario(ctx, p, e.ID, func(tx pgx.Tx) error {
			gravadas, apagadas = 0, 0
			// a trava do mês: dois salvamentos do mesmo mês não criam a mesma meta duas vezes (Ruling 5.5-6)
			if _, err := tx.Exec(ctx, `select pg_advisory_xact_lock(hashtext('comercial.metas'), @periodo::int)`,
				pgx.NamedArgs{"periodo": in.Ano*100 + in.Mes}); err != nil {
				return err
			}
			for _, l := range lados {
				for _, g := range l.gravar {
					ids, err := localizarMeta(ctx, tx, e, l, g.chave, in.Ano, in.Mes)
					if err != nil {
						return err
					}
					switch len(ids) {
					case 0:
						_, err = l.tabela.Criar(ctx, tx, autz.Producao, e, map[string]any{
							l.coluna: g.chave, "year": in.Ano, "month": in.Mes, "meta_valor": g.valor, "daily_goals": g.diarias})
					case 1:
						_, err = l.tabela.Editar(ctx, tx, autz.Producao, e, ids[0], map[string]any{
							"meta_valor": g.valor, "daily_goals": g.diarias})
					default:
						err = metaDuplicada{l.nome, g.chave}
					}
					if err != nil {
						return err
					}
					gravadas++
				}
				for _, k := range l.apagar {
					ids, err := localizarMeta(ctx, tx, e, l, k, in.Ano, in.Mes)
					if err != nil {
						return err
					}
					switch len(ids) {
					case 0:
						return autz.ErrNaoEncontrado
					case 1:
						if err := l.tabela.Apagar(ctx, tx, autz.Producao, e, ids[0]); err != nil {
							return err
						}
					default:
						return metaDuplicada{l.nome, k}
					}
					apagadas++
				}
			}
			return nil
		})
		var dup metaDuplicada
		switch {
		case errors.As(err, &dup):
			dados.Erro(w, http.StatusConflict, "conflito", dup.Error())
			return
		case err != nil:
			dados.ErroDeEscrita(w, err)
			return
		}
		slog.Info("metas salvas", "por", e.ID, "ano", in.Ano, "mes", in.Mes, "gravadas", gravadas, "apagadas", apagadas)
		dados.Responder(w, http.StatusOK, fmt.Appendf(nil, `{"gravadas":%d,"apagadas":%d}`, gravadas, apagadas))
	}
}

func montarMetas(r chi.Router, p *pgxpool.Pool) {
	deve(tabelaMetasLojas.Validar(autz.Producao))
	deve(tabelaMetasVendedoras.Validar(autz.Producao))
	r.Get("/comercial/metas-lojas", consultaMetasLojas.Handler(p, autz.Producao))
	r.Get("/comercial/metas-vendedoras", consultaMetasVendedoras.Handler(p, autz.Producao))
	r.With(soSessaoPropria).Post("/comercial/metas/salvar", salvarMetas(p))
}
```

**(b) Testes de aceitação** (`metas_test.go`; `fotoDasMetas` = md5 de `bling_metas` + `bling_vendedor_metas`, conferido em toda recusa)
- `TestMetasLeitura`: `viewer` `/comercial/metas-lojas?ano=2026&mes=10` → `loja_id` `0,1` (paridade: toda sessão); `?ano=2026&mes=9` → `2`; `/comercial/metas-vendedoras?ano=2026&mes=10` → `vendor_id` `7`; `?ano=x` → 400; a linha da loja 1 traz `"daily_goals":{"1": 2000, "2": 2000}` como objeto.
- `TestSalvarMetas`, em ordem:
  1. `admin` salva o corpo do contrato (loja 1 → 80000 com diárias; loja 2 → 50000 sem diárias; apaga a loja 0; vendedora 8 → 15000; apaga a 7) → `200 {"gravadas":3,"apagadas":2}`; `bling_metas` de 2026/10 = `1:80000:{"1": 40000, "2": 40000},2:50000:-`; a meta da loja 1 continua com `id` 2 (editada, não duplicada); a de 2026/09 intacta; `bling_vendedor_metas` de 2026/10 = `8:15000`.
  2. **Tudo ou nada:** `admin` `{"ano":2026,"mes":10,"lojas":{"gravar":[{"loja_id":4,"meta_valor":1000}],"apagar":[3]}}` → 404 e NENHUMA meta da loja 4 (a gravação anterior da mesma transação foi desfeita).
  3. Quem não pode (foto igual): `super` (papel viewer) → 403 (paridade: só papel admin; achado); `vendT1` → 403; `semTrava` → 403; `impersonado` (a sessão do admin aberta pelo super) → 403 com "Quem entrou como outra pessoa".
  4. Pedido inválido (400, foto igual): `meta_valor` `-1`, `0`, `"80000"`, `80000.123`, `1e5`, `1000000000`; `daily_goals` `[1,2]`, `{"1":-5}`, `{"1; drop":1}`, 32 dias; `ano` 1999; `mes` 13; loja 1 em `gravar` e em `apagar`; corpo sem metas (`"Nada para gravar."`); 501 metas; `{"ano":2026,"mes":10,"lojas":{"gravar":[{"loja_id":1,"meta_valor":1,"nome":"x"}]}}` → 400 `corpo_invalido`; `vendor_id` 0.
  5. **Duplicata:** `m.P.Exec` insere uma segunda meta da loja 1 em 2026/10; `admin` grava a loja 1 → 409 com "mais de uma meta"; foto igual.
- `TestSalvarMetasSemCorrida`: 10 rodadas; em cada uma, `aoMesmoTempo` com o `admin` salvando `{"ano":2026,"mes":11,"lojas":{"gravar":[{"loja_id":<40+i>,"meta_valor":<1000+lado>}]}}` → as duas 200 e `count(*)` da loja `40+i` em 2026/11 = 1.
- Mutações que têm de reprovar: tirar o `pg_advisory_xact_lock` (a corrida cria duas linhas — `bling_metas` não tem único); trocar `ComUsuario` por duas transações (uma para gravar, outra para apagar: o item 2 deixa a loja 4 gravada); `default: err = metaDuplicada` → `default: ids = ids[:1]` (o item 5 vira 200); tirar o `f <= 0` (o `0` passa).

**(c) Arquivos:** Create `api/internal/vendas/metas.go`, `api/internal/vendas/metas_test.go`.

**(d) Dependências:** Task 3; `dados.Tabela/Consulta/LerCorpo/ErroDeEscrita/Responder`; `autz.Producao.Filtro`; `banco.ComUsuario`.

- [ ] **Step 1:** Testes de (b); ver falhar (`montarMetas`). - [ ] **Step 2:** Implementar `metas.go` (código de (a)). - [ ] **Step 3:** `gofmt -l ./internal && go vet ./internal/vendas/ && go test -count=1 -race -v -run Metas ./internal/vendas/` → PASS; mutações reprovam. - [ ] **Step 4:** Commit `feat(api): metas do Comercial — leitura e salvar o mês inteiro numa transação, sob a trava do mês` (+ `Co-Authored-By`).

---

### Task 8: Caches de vendas — vendedoras e vendedor do pedido

**Revisor:** opus. **Depende de:** 2 (`Tabela.Chave`, `Tabela.Gravar`), 3.

**(a) Contrato**
- `GET /comercial/vendedoras` (toda sessão) e `GET /comercial/pedidos-vendedor?pedido_id=1,2,…` (toda sessão; até 1000 ids por chamada — a tela manda até 500; `ordem=pedido_data.desc` para o Admin). Paridade com a policy `true` (Ruling 5.5-5; achado).
- `POST /comercial/pedidos-vendedor/gravar {"linhas":[{pedido_id, vendor_id?, pedido_data?, qtd_itens?, loja_id?}]}` e `POST /comercial/vendedoras/gravar {"linhas":[{vendor_id, nome?, updated_at?}]}` (`soSessaoPropria`; regra: `pode_ver_vendas()` = papel admin, super pela ficha ou feature `sales`, conta ativa) → `200 {"gravadas":n}`. De 1 a 1000 linhas; cada linha: a chave inteira positiva (número JSON) e ao menos uma coluna além dela; coluna ausente não muda, `null` grava nulo; `nome` até 200 letras. Cada linha pelo MESMO `Tabela.Gravar` (PodeX + SQL com o mapa da struct), em ordem de chave (dois lotes travam na mesma ordem: sem deadlock), numa transação só: uma recusa = nada gravado (Rulings 5.5-3 e 5.5-14).

```go
package vendas

import (
	"cmp"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"regexp"
	"slices"
	"strconv"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/autz"
	"github.com/rbv-co/social-dashboard/api/internal/banco"
	"github.com/rbv-co/social-dashboard/api/internal/dados"
)

const (
	colunasVendedora     = `t.vendor_id, t.nome, t.updated_at`
	colunasCacheVendedor = `t.pedido_id, t.vendor_id, t.pedido_data, t.qtd_itens, t.loja_id`
	// LinhasPorLote: a Gestão à Vista grava de 10 em 10; a Análise de Vendas, os pedidos do período sem quantidade.
	LinhasPorLote = 1000
)

var (
	// GET /comercial/vendedoras: gav:757; admin:559, 4109 (?ordem=nome); av:396.
	consultaVendedoras = dados.Consulta{Tabela: "bling_vendedores", Alias: "t", SQL: `select ` + colunasVendedora + ` from bling_vendedores t`,
		Ordens: map[string]string{"nome": "t.nome"}, OrdemPadrao: "t.vendor_id", Desempate: "t.vendor_id"}
	// GET /comercial/pedidos-vendedor: gav:758; admin:560, 4111; av:485, 487.
	consultaCacheVendedor = dados.Consulta{Tabela: "bling_pedido_vendedor", Alias: "t", SQL: `select ` + colunasCacheVendedor + ` from bling_pedido_vendedor t`,
		Filtros: []dados.Filtro{{Param: "pedido_id", SQL: "t.pedido_id = any(@pedido_id::bigint[])", Tipo: "inteiro[]"}},
		Ordens:  map[string]string{"pedido_data": "t.pedido_data"}, OrdemPadrao: "t.pedido_id", Desempate: "t.pedido_id"}

	tabelaVendedoras    = dados.Tabela{Nome: "bling_vendedores", Chave: "vendor_id", Resposta: colunasVendedora}
	tabelaCacheVendedor = dados.Tabela{Nome: "bling_pedido_vendedor", Chave: "pedido_id", Resposta: colunasCacheVendedor}

	reChavePositiva = regexp.MustCompile(`^[1-9][0-9]{0,17}$`)
)

// linhaCacheVendedor: o que as telas gravam no cache (tela-de-gestao-a-vista.vue:246, 285; tela-de-analise-vendas.vue:630-636).
type linhaCacheVendedor struct {
	PedidoID   json.RawMessage `json:"pedido_id,omitempty"`
	VendorID   json.RawMessage `json:"vendor_id,omitempty"`
	PedidoData json.RawMessage `json:"pedido_data,omitempty"`
	QtdItens   json.RawMessage `json:"qtd_itens,omitempty"`
	LojaID     json.RawMessage `json:"loja_id,omitempty"`
}

func validarCacheVendedor(l linhaCacheVendedor) error {
	if !reChavePositiva.Match(l.PedidoID) {
		return errors.New("falta o pedido_id (número).")
	}
	if l.VendorID == nil && l.PedidoData == nil && l.QtdItens == nil && l.LojaID == nil {
		return errors.New("nada para gravar além do pedido_id.")
	}
	return nil
}

// linhaVendedora: o que a Gestão à Vista grava (tela-de-gestao-a-vista.vue:308).
type linhaVendedora struct {
	VendorID  json.RawMessage `json:"vendor_id,omitempty"`
	Nome      json.RawMessage `json:"nome,omitempty"`
	UpdatedAt json.RawMessage `json:"updated_at,omitempty"`
}

func validarVendedora(l linhaVendedora) error {
	if !reChavePositiva.Match(l.VendorID) {
		return errors.New("falta o vendor_id (número).")
	}
	if l.Nome == nil && l.UpdatedAt == nil {
		return errors.New("nada para gravar além do vendor_id.")
	}
	return textoOuNulo("o nome", l.Nome, 200)
}

// gravarLote: POST {linhas:[…]} → cada linha passa pela validação, vira mapa pela MESMA struct
// (dados.Campos) e é gravada por Tabela.Gravar (PodeX + SQL com o mesmo mapa), em ordem de chave, numa
// transação só. ponytail: ~3 consultas por linha (até 1000); um upsert único quando o volume pedir —
// sem perder o PodeX por linha.
func gravarLote[L any](p *pgxpool.Pool, tab dados.Tabela, validar func(L) error) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		e := autz.EscopoDo(r.Context())
		if e == nil {
			dados.Erro(w, http.StatusInternalServerError, "erro_interno", "")
			return
		}
		var in struct {
			Linhas []L `json:"linhas"`
		}
		if !dados.LerCorpo(w, r, &in) {
			return
		}
		if n := len(in.Linhas); n == 0 || n > LinhasPorLote {
			dados.Erro(w, http.StatusBadRequest, "pedido_invalido", fmt.Sprintf("Mande de 1 a %d linhas.", LinhasPorLote))
			return
		}
		type item struct {
			chave  int64
			campos map[string]any
		}
		lote := make([]item, 0, len(in.Linhas))
		for i := range in.Linhas {
			if err := validar(in.Linhas[i]); err != nil {
				dados.Erro(w, http.StatusBadRequest, "pedido_invalido", fmt.Sprintf("Linha %d: %s", i+1, err))
				return
			}
			campos, err := dados.Campos(&in.Linhas[i])
			if err != nil {
				dados.Erro(w, http.StatusInternalServerError, "erro_interno", "")
				return
			}
			k, _ := strconv.ParseInt(string(campos[tab.Chave].(json.RawMessage)), 10, 64) // validar já conferiu
			lote = append(lote, item{k, campos})
		}
		// ordem da chave (estável: repetida no lote mantém a ordem da tela, a última vence)
		slices.SortStableFunc(lote, func(a, b item) int { return cmp.Compare(a.chave, b.chave) })
		ctx := r.Context()
		err := banco.ComUsuario(ctx, p, e.ID, func(tx pgx.Tx) error {
			for _, it := range lote {
				if _, err := tab.Gravar(ctx, tx, autz.Producao, e, it.campos); err != nil {
					return err
				}
			}
			return nil
		})
		if err != nil {
			dados.ErroDeEscrita(w, err)
			return
		}
		dados.Responder(w, http.StatusOK, fmt.Appendf(nil, `{"gravadas":%d}`, len(lote)))
	}
}

func montarCaches(r chi.Router, p *pgxpool.Pool) {
	deve(tabelaVendedoras.Validar(autz.Producao))
	deve(tabelaCacheVendedor.Validar(autz.Producao))
	r.Get("/comercial/vendedoras", consultaVendedoras.Handler(p, autz.Producao))
	r.Get("/comercial/pedidos-vendedor", consultaCacheVendedor.Handler(p, autz.Producao))
	r.With(soSessaoPropria).Post("/comercial/vendedoras/gravar", gravarLote(p, tabelaVendedoras, validarVendedora))
	r.With(soSessaoPropria).Post("/comercial/pedidos-vendedor/gravar", gravarLote(p, tabelaCacheVendedor, validarCacheVendedor))
}
```

**(b) Testes de aceitação** (`caches_test.go`; `fotoDosCaches` = md5 de `bling_vendedores` + `bling_pedido_vendedor`, conferido em toda recusa)
- `TestCachesLeitura`: `viewer` `/comercial/vendedoras?ordem=nome` → `7,8` (Ana antes de Bia); **`vendT1` `/comercial/pedidos-vendedor?pedido_id=101,102` → `101,102`** (paridade: a policy de produção é `true` — comentário no teste aponta o achado 2); `?ordem=pedido_data.desc&limite=1` → `102`; `?pedido_id=abc` → 400.
- `TestGravarCaches`, em ordem:
  1. `vendT1` `/comercial/pedidos-vendedor/gravar` `{"linhas":[{"pedido_id":105,"vendor_id":7,"pedido_data":"2026-10-06","qtd_itens":1,"loja_id":1},{"pedido_id":101,"qtd_itens":5}]}` → `200 {"gravadas":2}`; 105 criado; **101 com `qtd_itens` 5 e `vendor_id` ainda 7** (ausente não muda).
  2. `admin` `{"linhas":[{"pedido_id":102,"vendor_id":null}]}` → 200 e `vendor_id` de 102 nulo (`null` explícito grava nulo).
  3. Lote repetido na mesma requisição: `vendT1` `[{"pedido_id":106,"vendor_id":7},{"pedido_id":106,"vendor_id":8}]` → 200 e 106 com `vendor_id` 8 (a última vence).
  4. Quem não pode (403, foto igual): `viewer`; `semTrava` (sem `sales` nem papel admin); `impersonado` (403 com a frase).
  5. **Tudo ou nada:** `vendT1` `[{"pedido_id":107,"qtd_itens":1},{"pedido_id":108,"qtd_itens":"muitos"}]` → 400 e 107 NÃO existe.
  6. Pedido inválido (400, foto igual): `{"linhas":[]}`; 1001 linhas; `{"pedido_id":"101","qtd_itens":1}` (texto); `{"pedido_id":0,…}`; só `{"pedido_id":109}`; `{"pedido_id":110,"vendedor":7}` → `corpo_invalido`; `{"pedido_id":110,"qtd_itens":1}` sem o envelope `linhas` → `corpo_invalido`.
  7. Vendedoras: `vendT1` `/comercial/vendedoras/gravar` `{"linhas":[{"vendor_id":9,"nome":"Carla","updated_at":"2026-10-12T10:00:00Z"},{"vendor_id":7,"nome":"Ana Paula"}]}` → 200; 9 criada, 7 renomeada; `viewer` → 403; `nome` de 201 letras → 400; `vendor_id` 0 → 400.
- `TestCachesSemCorrida`: 20 rodadas; em cada uma, `aoMesmoTempo` com `vendT1` (lado 0) e `admin` (lado 1) gravando `{"linhas":[{"pedido_id":<200+i>,"vendor_id":7,"qtd_itens":<1+lado>}]}` → as duas 200 e `count(*)` do pedido `200+i` = 1. Mais 20 rodadas com dois pedidos EXISTENTES em ordens opostas (lado 0 manda `[<300+2i>, <301+2i>]`, lado 1 manda `[<301+2i>, <300+2i>]`, ambos criados antes da rodada) → as duas 200 (a ordem de chave evita deadlock).
- Mutações que têm de reprovar: trocar `tab.Gravar` por `tab.Criar` (o item 1 dá 409 no 101); tirar o `slices.SortStableFunc` (as rodadas de ordens opostas dão deadlock → 500); montar o POST sem `soSessaoPropria` (pega na Task 9).

**(c) Arquivos:** Create `api/internal/vendas/caches.go`, `api/internal/vendas/caches_test.go`.

**(d) Dependências:** Tasks 2 e 3; `dados.Campos/LerCorpo/Responder/ErroDeEscrita`.

- [ ] **Step 1:** Testes de (b); ver falhar (`montarCaches`). - [ ] **Step 2:** Implementar `caches.go` (código de (a)). - [ ] **Step 3:** `gofmt -l ./internal && go vet ./internal/vendas/ && go test -count=1 -race -v -run Caches ./internal/vendas/` → PASS; mutações reprovam. - [ ] **Step 4:** Commit `feat(api): caches de vendas (vendedor do pedido e vendedoras) gravados em lote, sem corrida, por quem vê vendas` (+ `Co-Authored-By`).

---

### Task 9: Montagem, varreduras, `conferir` e notas

**Revisor:** opus. **Depende de:** 4–8.

**(a) Contrato**
- `vendas.Montar(r chi.Router, p *pgxpool.Pool)` chama `montarLeituras, montarGlobais, montarLojas, montarMetas, montarCaches`.
- `web/rotas.go`: no grupo de domínio (com `autz.ComEscopo`), depois das montagens do 5.1/5.2 (e do 5.3/5.4, se já mescladas), `vendas.Montar(r, p) // Plano 5.5`. Nenhuma RPC: `web.FuncoesRPC` e `RPCPendentes` não mudam (Ruling 5.5-12).
- `web/rotas_test.go`: `soSessao` ganha as 18 rotas (comentário: "portão = catálogo, provado pela matriz de `internal/vendas`; vazamento por `TestNadaVazaEntreLojas`/`TestTodaLeituraTemEscopoDeclarado`, impersonado por `TestEscritasRecusamImpersonado`").
- `cmd/api/conferir.go` e `NOTAS-DA-IMPLANTACAO.md` (abaixo).

**(b) Testes de aceitação**
- `TestEscritasRecusamImpersonado`, `TestTodaLeituraTemEscopoDeclarado`, `TestNadaGravaQuemNaoPode` (`vendas/rotas_test.go`, código abaixo): `chi.Walk` em TODAS as rotas de `Montar`: exatamente 14 leituras e 4 escritas; toda leitura tem matriz de escopo (Task 4) ou está declarada global; toda escrita tem os negados listados e recusa o impersonado; `fotoDoComercial` igual antes e depois.
- `TestNenhumaRotaNovaFicaAberta` (existente) passa com `soSessao` atualizado: toda rota do 5.5 dá 401 sem sessão.
- `TestComercialPelaMontagemReal` (`web/rotas_test.go`, no molde de `TestAcessoPelaMontagemReal` do 5.1: `testebanco.ComEsquemaDeProducao` + `usuarios`/`profiles` de uma vendedora com `sales` no time do canal 1 e de um viewer; `bling_pedido_nota` dos canais 1 e 2): `GET /comercial/notas` sem sessão → 401; vendedora → só o pedido do canal 1; viewer → `200 []`; viewer `PATCH /comercial/lojas/1 {"fechado_em":"2026-08-31"}` → 403 e intacta; viewer `POST /comercial/pedidos-vendedor/gravar` → 403.

```go
package vendas

import (
	"net/http"
	"slices"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
)

// leiturasGlobais: as leituras SEM restritiva em produção (policy true ou auth.role() = 'authenticated'):
// toda sessão lê tudo, como pelo PostgREST (Ruling 5.5-5; achado 2 para o dono). As com restritiva estão
// em casosDeEscopo (Task 4).
var leiturasGlobais = []string{"/comercial/lojas", "/comercial/depositos", "/comercial/metas-lojas",
	"/comercial/metas-vendedoras", "/comercial/vendedoras", "/comercial/pedidos-vendedor", "/comercial/briefings"}

// Toda escrita do 5.5 recusa a sessão de "entrar como", sem tocar no banco (Ruling 5.5-8).
func TestEscritasRecusamImpersonado(t *testing.T) {
	m := novoMundo(t, Montar)
	antes := m.Um(t, fotoDoComercial)
	n := 0
	err := chi.Walk(m.H.(chi.Routes), func(metodo, rota string, _ http.Handler, _ ...func(http.Handler) http.Handler) error {
		if metodo == http.MethodGet {
			return nil
		}
		n++
		st, corpo := m.Pedir(t, "impersonado", metodo, strings.ReplaceAll(rota, "{id}", "1"), `{}`)
		if st != http.StatusForbidden || !strings.Contains(corpo, "Quem entrou como outra pessoa") {
			t.Errorf("%s %s como impersonado = %d %s", metodo, rota, st, corpo)
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if n != 4 {
		t.Errorf("escritas = %d, esperava 4 (rota de escrita nova? ponha soSessaoPropria e conte aqui)", n)
	}
	if m.Um(t, fotoDoComercial) != antes {
		t.Error("o impersonado mudou o banco")
	}
}

// Toda leitura montada tem a matriz de escopo (restritiva de produção) ou está declarada global; uma
// leitura nova sem nenhum dos dois faz o teste falhar.
func TestTodaLeituraTemEscopoDeclarado(t *testing.T) {
	m := novoMundo(t, Montar)
	n := 0
	err := chi.Walk(m.H.(chi.Routes), func(metodo, rota string, _ http.Handler, _ ...func(http.Handler) http.Handler) error {
		if metodo != http.MethodGet {
			return nil
		}
		n++
		if _, ok := casosDeEscopo[rota]; ok {
			return nil // provada pessoa a pessoa em TestNadaVazaEntreLojas
		}
		if !slices.Contains(leiturasGlobais, rota) {
			t.Errorf("leitura sem matriz de escopo e não declarada global: %s", rota)
			return nil
		}
		if st, corpo := m.Pedir(t, "viewer", http.MethodGet, rota, ""); st != http.StatusOK || strings.TrimSpace(corpo) == "[]" {
			t.Errorf("global %s como viewer = %d %s (paridade: toda sessão lê)", rota, st, corpo)
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if n != 14 || len(casosDeEscopo)+len(leiturasGlobais) != 14 {
		t.Errorf("leituras = %d (casos %d + globais %d), esperava 14", n, len(casosDeEscopo), len(leiturasGlobais))
	}
}

// Quem não pode gravar não grava NADA, pelo handler real (403 e banco intacto); uma escrita nova sem caso
// faz o teste falhar.
func TestNadaGravaQuemNaoPode(t *testing.T) {
	m := novoMundo(t, Montar)
	antes := m.Um(t, fotoDoComercial)
	escritas := map[string]struct {
		caminho, corpo string
		negados        []string
	}{
		"PATCH /comercial/lojas/{id}": {"/comercial/lojas/2", `{"fechado_em":"2026-08-31"}`,
			[]string{"admin", "semTrava", "vendT1", "estT1", "gestorT2", "supervG1", "viewer"}},
		"POST /comercial/metas/salvar": {"/comercial/metas/salvar", `{"ano":2026,"mes":10,"lojas":{"gravar":[{"loja_id":1,"meta_valor":1}]}}`,
			[]string{"super", "semTrava", "vendT1", "estT1", "gestorT2", "supervG1", "viewer"}},
		"POST /comercial/vendedoras/gravar": {"/comercial/vendedoras/gravar", `{"linhas":[{"vendor_id":7,"nome":"Intrusa"}]}`,
			[]string{"semTrava", "viewer"}},
		"POST /comercial/pedidos-vendedor/gravar": {"/comercial/pedidos-vendedor/gravar", `{"linhas":[{"pedido_id":101,"vendor_id":8}]}`,
			[]string{"semTrava", "viewer"}},
	}
	n := 0
	err := chi.Walk(m.H.(chi.Routes), func(metodo, rota string, _ http.Handler, _ ...func(http.Handler) http.Handler) error {
		if metodo == http.MethodGet {
			return nil
		}
		n++
		e, ok := escritas[metodo+" "+rota]
		if !ok {
			t.Errorf("escrita sem caso de recusa: %s %s", metodo, rota)
			return nil
		}
		for _, quem := range e.negados {
			if st, corpo := m.Pedir(t, quem, metodo, e.caminho, e.corpo); st != http.StatusForbidden {
				t.Errorf("%s %s como %s = %d %s; esperava 403", metodo, e.caminho, quem, st, corpo)
			}
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if n != len(escritas) {
		t.Errorf("escritas = %d, casos = %d", n, len(escritas))
	}
	if m.Um(t, fotoDoComercial) != antes {
		t.Error("quem não pode gravar mudou o banco")
	}
}
```

**(c) Arquivos:** Create `api/internal/vendas/rotas.go`, `api/internal/vendas/rotas_test.go`; Modify `api/internal/web/rotas.go`, `api/internal/web/rotas_test.go`, `api/cmd/api/conferir.go`, `docs/migracao-go/NOTAS-DA-IMPLANTACAO.md`.

**(d) Dependências:** Tasks 4–8; `web.Rotas` (5.0).

- [ ] **Step 1: Testes que falham.** `vendas/rotas_test.go` (acima); em `web/rotas_test.go`, as 18 entradas de `soSessao` (`"GET /comercial/lojas"`, `"PATCH /comercial/lojas/{id}"`, `"GET /comercial/depositos"`, `"GET /comercial/metas-lojas"`, `"GET /comercial/metas-vendedoras"`, `"POST /comercial/metas/salvar"`, `"GET /comercial/vendedoras"`, `"POST /comercial/vendedoras/gravar"`, `"GET /comercial/pedidos-vendedor"`, `"POST /comercial/pedidos-vendedor/gravar"`, `"GET /comercial/notas"`, `"GET /comercial/ajustes-de-valor"`, `"GET /comercial/ajustes-de-vendedor"`, `"GET /comercial/formas-de-pagamento"`, `"GET /comercial/estoque"`, `"GET /comercial/vendas-por-item"`, `"GET /comercial/briefings"`, `"GET /comercial/pedidos-shopify"`) e `TestComercialPelaMontagemReal`. Run: `go test -count=1 ./internal/vendas/ ./internal/web/` → FAIL (`Montar` não existe).
- [ ] **Step 2: Implementar.** `vendas/rotas.go`:

```go
package vendas

import (
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Montar registra as rotas do 5.5 no grupo de DOMÍNIO de web.Rotas (depois de auth.Exigir e de
// autz.ComEscopo). Declaração errada derruba a subida (deve / Consulta.Handler).
func Montar(r chi.Router, p *pgxpool.Pool) {
	montarLeituras(r, p)
	montarGlobais(r, p)
	montarLojas(r, p)
	montarMetas(r, p)
	montarCaches(r, p)
}
```

`web/rotas.go`: import `"github.com/rbv-co/social-dashboard/api/internal/vendas"` e `vendas.Montar(r, p) // Plano 5.5` no grupo de domínio.

`cmd/api/conferir.go` (troque as linhas existentes da mesma tabela pela versão abaixo; acrescente as novas):

```go
// colunasDoWorker (= colunasDoComercial do teste da Task 1, menos o que só o D0 precisa)
"bling_lojas":                  "loja_id,nome,grupo,grupo_id,fechado_em",
"bling_depositos":              "deposito_id,nome,ativo,padrao",
"bling_metas":                  "id,loja_id,year,month,meta_valor,daily_goals",
"bling_vendedor_metas":         "id,vendor_id,year,month,meta_valor,daily_goals",
"bling_vendedores":             "vendor_id,nome,updated_at",
"bling_pedido_vendedor":        "pedido_id,vendor_id,pedido_data,qtd_itens,loja_id",
"bling_pedido_nota":            "pedido_id,pedido_numero,data_pedido,data_da_venda,total,loja_id,nota_situacao",
"bling_pedido_ajuste_valor":    "pedido_id,loja_id,total_corrigido",
"bling_pedido_ajuste_vendedor": "pedido_id,loja_id,vendor_id_corrigido",
"bling_pedido_forma_pagamento": "parcela_id,pedido_id,loja_id,valor,eh_devolucao",
"gc_estoque_item":              "deposito_id,sku,produto,categoria,saldo",
"gc_vendas_item":               "mes,canal_loja_id,sku,produto,categoria,unidades,faturamento",
"gestao_comercial_briefings":   "id,rodada,periodo,resumo,conteudo,dados_json,created_at",

// tiposDoWorker (filtros com cast, chaves das escritas, dinheiro e datas)
"bling_lojas.loja_id": "bigint", "bling_lojas.grupo_id": "uuid", "bling_lojas.fechado_em": "date",
"bling_metas.loja_id": "bigint|integer", "bling_metas.year": "integer|bigint", "bling_metas.month": "integer|bigint",
"bling_metas.daily_goals": "jsonb", "bling_vendedor_metas.vendor_id": "bigint|integer", "bling_vendedor_metas.daily_goals": "jsonb",
"bling_vendedores.vendor_id": "bigint|integer", "bling_pedido_vendedor.pedido_data": "date",
"bling_pedido_forma_pagamento.eh_devolucao": "boolean", "gc_estoque_item.deposito_id": "bigint",
"gc_vendas_item.mes": "date", "gc_vendas_item.canal_loja_id": "bigint", "shopify_pedidos.criado_em_shopify": "timestamp with time zone",

// unicosDoWorker (alvos do `on conflict` de Tabela.Gravar)
"bling_pedido_vendedor(pedido_id)", "bling_vendedores(vendor_id)",

// funcoesDoWorker (o gatilho que o PATCH de loja presume)
"espelhar_grupo_do_canal()",
```

Em `NOTAS-DA-IMPLANTACAO.md`, acrescente ao fim:

```markdown
## Plano 5.5 — Comercial (Bling e Shopify)

### Rotas novas (com sessão; regra = catálogo de produção; escrita de sessão "entrar como" = 403)
- Leitura com escopo de canal/depósito: `/comercial/notas`, `/comercial/ajustes-de-valor`, `/comercial/ajustes-de-vendedor`, `/comercial/formas-de-pagamento`, `/comercial/estoque`, `/comercial/vendas-por-item`, `/comercial/pedidos-shopify`.
- Leitura de toda sessão (como em produção): `/comercial/lojas`, `/comercial/depositos`, `/comercial/metas-lojas`, `/comercial/metas-vendedoras`, `/comercial/vendedoras`, `/comercial/pedidos-vendedor`, `/comercial/briefings`.
- Escrita: `PATCH /comercial/lojas/{loja_id}` (só super-admin pela ficha), `POST /comercial/metas/salvar` (papel admin), `POST /comercial/vendedoras/gravar` e `POST /comercial/pedidos-vendedor/gravar` (quem vê vendas: admin, super-admin ou `sales`).
- Nenhuma RPC (`meus_vinculos` não é chamada pelo front).

### Mudanças de contrato que o Plano 7 absorve
- Metas numa chamada: `POST /comercial/metas/salvar {ano, mes, lojas:{gravar,apagar}, vendedoras:{gravar,apagar}}` substitui `_mtGravar`/`_mtApagar` (tela-de-admin.vue:4223-4245) e o laço de :4256-4257; tudo ou nada (a frase "N já foram gravadas" sai); duplicata antiga = 409.
- Fechar/agrupar canal: `PATCH /comercial/lojas/{loja_id}` com `{fechado_em}` ou `{grupo_id}`; recusa = 403/404 (o `gravar` de tela-de-admin.vue:1034 conferia "0 linhas").
- Caches: `POST /comercial/pedidos-vendedor/gravar {linhas}` e `POST /comercial/vendedoras/gravar {linhas}` (antes `.upsert(onConflict)`); coluna ausente não muda (o PostgREST punha nulo nas linhas sem a chave da primeira).
- Notas: `?janela=[AAAA-MM-DD,AAAA-MM-DD]` (o `.or(and(...),and(...))` de data-da-venda.js:33). Pedidos Shopify: `?criado_de=&criado_ate=&status_financeiro=a,b`; a resposta não tem nome, e-mail nem payload do cliente. Formas de pagamento: `?eh_devolucao=true`. Estoque: `?deposito_id=a,b`. Vendas por item: `?mes=AAAA-MM-01,…`. Metas: `?ano=&mes=`. Cache: `?pedido_id=a,b` (até 1000; a tela manda até 500); a consulta sem `qtd_itens` de tela-de-analise-vendas.vue:487 sai.
- Paginação por `limite`/`deslocamento` (era `.range`); `limit(5000)` de tela-de-admin.vue:560 e :4111 vira `limite=1000` (o PostgREST já entregava 1000).

### Antes do corte
- `api worker conferir` no banco restaurado: colunas, tipos, os únicos `bling_pedido_vendedor(pedido_id)` e `bling_vendedores(vendor_id)` e `espelhar_grupo_do_canal()`.
- Metas duplicadas travam o salvamento (409): `select loja_id, year, month, count(*) from bling_metas group by 1, 2, 3 having count(*) > 1` e o mesmo em `bling_vendedor_metas` (por `vendor_id`) têm de voltar vazios; se não, apagar a duplicata mais nova.
- `select is_nullable from information_schema.columns where table_name = 'bling_pedido_vendedor' and column_name = 'vendor_id'` = `YES` (a Análise de Vendas grava linha sem vendedor). Se for `NO`, essas linhas continuam recusadas (como hoje) e o lote inteiro delas volta 400: anotar para o Plano 7.
- Ajustes de valor e de vendedor continuam sem tela (decisão de 15/09, pendências B6): o "comando de banco de super-admin" passa a rodar no Postgres próprio, preenchendo `criado_por` à mão.
- A fatia `api/internal/testebanco/esquema/01-tabelas-5-5.sql` é reconstruída: `bling_metas`, `bling_vendedores`, `bling_pedido_vendedor` e `bling_pedido_nota.pedido_numero` são PRESUMIDOS; quando o `pg_dump` do ensaio existir, trocar a fatia e rodar os testes.
```

Rode `gofmt -w ./internal ./cmd`.

- [ ] **Step 3: Rodar e ver passar.** `gofmt -l . && go vet ./... && go test -count=1 -race ./... 2>&1 | grep -v goose | grep -E '^(ok|FAIL|---)'` → todos `ok`. Mutações que têm de reprovar: tirar `soSessaoPropria` de UMA escrita (a varredura do impersonado acusa); acrescentar uma GET de mentira em `Montar` (a varredura das leituras acusa); montar `vendas.Montar` FORA do grupo com `ComEscopo` (as rotas respondem 500 e `TestComercialPelaMontagemReal` cai).
- [ ] **Step 4: Commit.**

```bash
git add api/internal/vendas/rotas.go api/internal/vendas/rotas_test.go api/internal/web/ api/cmd/api/conferir.go docs/migracao-go/NOTAS-DA-IMPLANTACAO.md
git commit -m "feat(api): monta as rotas do Comercial, varreduras de impersonado, de escopo e de escrita, conferir e notas

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Verificação final do 5.5

- [ ] `docker stop pg-plano55` e `make -C api teste PG_PORTA=58555` → todos `ok`.
- [ ] Subir o `pg-plano55` de novo e `cd api && go test -count=1 -v ./... 2>&1 | grep -c -- '--- SKIP'` → `0`.
- [ ] `cd api && gofmt -l . && go vet ./...` → nada.
- [ ] `git diff feat/api-go-plano-5-2 --stat -- src/ supabase/ coletor/ db/` → vazio (o front troca no Plano 7; produção não muda).
- [ ] `git diff feat/api-go-plano-5-2 --stat -- api/internal/comercial/` → vazio (proxy e push intocados: Rulings 14 e 24 do mestre).
- [ ] `docker stop pg-plano55`.
- [ ] Revisão final do branch por opus com foco em: `PodeEditarPor` (algum ponto de `conferirExistente` ficou com `id` fixo?), `Tabela.Gravar` (alguma ordem que deixa quem só edita receber 403, ou que cria duplicata na corrida?), `salvarMetas` (algum passo fora da transação ou sem `PodeX`? a trava cobre criar e apagar?), a matriz de escopo (alguma pessoa × rota sem caso?), e se alguma coluna de cliente da Shopify escapa.

---

## Inventário: sítios do front a trocar (Plano 7)

`grep` em `src/` (fora de `*.test.*` e de `src/demonstracao/`) em 2026-10-12, contando `.from('<tabela>')`, `sb('<tabela>`, `gravar('<tabela>`, `adFetch('<tabela>` e `.from(<variável>)`: **37 literais** nas 15 tabelas (1 deles em comentário: `tela-de-gestao-comercial.vue:82`) **+ 4 por variável** (`sbClient.from(tabela)` das metas) = **40 sítios**. RPC: **0** (`meus_vinculos` só aparece em comentário, `tela-de-gestao-a-vista.vue:694`). REST cru: os 3 literais `sb(`/`gravar(` do Admin, já contados. `bling_tokens`: 0. `src/ferramentas/vendas` (só o menu) e `atendimentos`: 0. Storage: 0.

Abreviações: `gav` = `src/ferramentas/gestao-a-vista/tela-de-gestao-a-vista.vue`; `admin` = `src/ferramentas/admin/tela-de-admin.vue`; `av` = `src/ferramentas/analise-vendas/tela-de-analise-vendas.vue`; `rc` = `src/ferramentas/gestao-comercial/relatorios-comerciais.vue`; `gc` = `src/ferramentas/gestao-comercial/tela-de-gestao-comercial.vue`; `cp` = `src/compartilhado`.

| Rota | Sítios | Qtde |
|---|---|---|
| `GET /comercial/lojas` | gav:685; admin:881, 1229 (`sb`), 4107; av:394 (`?ordem=loja_id`) | 5 |
| `PATCH /comercial/lojas/{loja_id}` | admin:1072 (`{fechado_em}`), 1194 (`{grupo_id}`) — ambos pelo `gravar` de admin:1034 | 2 |
| `GET /comercial/depositos` | gav:704 | 1 |
| `GET /comercial/metas-lojas` | gav:686; admin:4108; av:395 (`?ano=&mes=`) | 3 |
| `GET /comercial/metas-vendedoras` | admin:4110 | 1 |
| `POST /comercial/metas/salvar` | admin:4229, 4231, 4233, 4241 (`from(tabela)`; o laço de :4256-4257 vira UMA chamada) | 4 |
| `GET /comercial/vendedoras` | gav:757; admin:559, 4109 (`?ordem=nome`); av:396 | 4 |
| `POST /comercial/vendedoras/gravar` | gav:314 | 1 |
| `GET /comercial/pedidos-vendedor` | gav:758 (`?pedido_id=`); admin:560, 4111 (`?ordem=pedido_data.desc&limite=1000`); av:485, 487 (a 487 sai) | 5 |
| `POST /comercial/pedidos-vendedor/gravar` | gav:264, 293, 313; av:641 | 4 |
| `GET /comercial/notas` | cp/data-da-venda.js:28 (`?janela=`) | 1 |
| `GET /comercial/ajustes-de-valor` | cp/valor-corrigido.js:30 | 1 |
| `GET /comercial/ajustes-de-vendedor` | cp/vendedor-corrigido.js:23 | 1 |
| `GET /comercial/formas-de-pagamento` | cp/valor-liquido-de-troca.js:26 (`?eh_devolucao=true`) | 1 |
| `GET /comercial/estoque` | gav:970 (`?deposito_id=`); rc:414 | 2 |
| `GET /comercial/vendas-por-item` | rc:402 (`?mes=`), 426 | 2 |
| `GET /comercial/briefings` | gc:277 (`?ordem=created_at.desc&limite=20`) | 1 |
| `GET /comercial/pedidos-shopify` | cp/pedidos-shopify.js:42 | 1 |

Nas mesmas telas, de OUTROS planos (não trocar pelo 5.5): **5.1** — `equipes`/`equipes_membros`/`canais_grupos_membros` em gav:690, 692, 697, av:403, 405, 409, `gestao-comercial/time-de-vendas.vue` e `tela-de-gestao-comercial.vue:62`; o resto da seção de canais e de usuários do Admin. **Plano 3** — `bling-proxy` (`blingCall` em gav e av) e `/eu/canais` (`cp/canais-de-venda-permitidos.js`). Robôs e scripts que escrevem nestas tabelas (Plano 7, sem rota no 5.5): `coletor/notas-dos-pedidos.mjs` (`bling_pedido_nota`), `trazer-pedidos-do-bling.mjs` (`bling_pedido_forma_pagamento`), `relatorios-comerciais.mjs` (`gc_*`, `bling_lojas`, `bling_depositos`), `gestor-comercial.mjs` e `atualizar-cards-comercial.mjs` (`gestao_comercial_briefings`), `trazer-pedidos-da-shopify.mjs` (`shopify_pedidos`, que também chega pelo webhook já em Go), `aplicar-valor-corrigido.mjs` (ajuste por `DATABASE_URL`), `preencher-loja-dos-pedidos.mjs` (PATCH condicional `loja_id=is.null` no cache com sessão de serviço: vira SQL de manutenção, não o lote do 5.5, que sobrescreveria), `coletor/lib/ajustes-de-valor.mjs` (leitura com chave de serviço).

## Paralelização

- **Uma worktree por tarefa paralela** (merge na ordem dos números). As Tasks 3–9 são o MESMO pacote Go (`vendas`): na mesma worktree, só em sequência (arquivo pela metade de uma quebra a compilação da outra). Cada task só toca os seus dois arquivos; a 9 é a única que toca `web/`, `conferir.go` e as notas. Um contêiner (`pg-plano55`) atende todas: cada teste cria o próprio banco.
- **Onda 1:** Tasks 1 e 2 (pacotes e arquivos distintos: `testebanco/esquema*` × `autz` + `dados`).
- **Onda 2:** Task 3 (precisa da 1).
- **Onda 3:** Tasks 4, 5 e 7 (precisam da 3) e 6 e 8 (precisam da 2 e da 3) — cinco em paralelo.
- **Onda 4:** Task 9.

## Rulings do 5.5

1. Ruling: D0 do 5.5 = as 13 tabelas do Comercial declaradas UMA vez em `01-tabelas-5-5.sql` (DDL das migrations com a fonte; `bling_metas`, `bling_vendedores`, `bling_pedido_vendedor` e `bling_pedido_nota.pedido_numero` presumidos e conferidos pelo `conferir`), `bling_lojas` completada por `alter`, nenhum gatilho novo e `bling_tokens` fora — o único gatilho do domínio já está no D0 e as funções `vessel_*` dos 5.10/5.11 que leem `bling_*` vão usar estas tabelas como estão — custo se errada: coluna ou nulidade presumida diferente só aparece no `conferir` do banco restaurado.
2. Ruling: a escrita acha a linha pela coluna-chave declarada (`dados.Tabela.Chave` + `autz.PodeEditarPor/PodeApagarPor`), com `PodeEditar/PodeApagar` delegando para `"id"` — `bling_lojas`, `bling_pedido_vendedor` e `bling_vendedores` não têm `id`, e reescrever a conferência à mão em cada rota é onde nasceria o furo; a mudança fica na função que todas as escritas já usam — custo se errada: um defeito em `conferirExistente` vale para toda escrita (por isso opus, as mutações da Task 2 e o oráculo do 5.0 continuando verde).
3. Ruling: `Tabela.Gravar` = o `.upsert(onConflict)` das telas sem corrida: edita se existe e se lê, senão `PodeCriar` + `insert … on conflict do nothing` e, se outra transação criou no meio, edita — várias TVs da Gestão à Vista detalham os mesmos pedidos ao mesmo tempo; "criar e falhar com 409" derrubaria o lote inteiro da segunda TV; editar antes de criar mantém quem só edita (regra de update sem a de insert) gravando — custo se errada: 2 a 3 consultas por linha (até 1000 por lote).
4. Ruling: o painel GRAVA só quatro coisas — metas (papel admin), fechar/agrupar canal (super pela ficha) e os dois caches que só o navegador preenche (`bling_pedido_vendedor`, `bling_vendedores`; `pode_ver_vendas`, decisão do dono de 18/08 em `2026-08-18-cache-de-vendas-so-quem-ve-vendas.sql`); os caches ganham rota porque o push das 22h (itens por pedido), o Admin (loja de cada vendedora) e o ranking dependem deles e nenhum robô os preenche; ajustes de valor e de vendedor NÃO ganham rota (sem tela por decisão de 15/09, pendências B6: continuam comando de banco de super-admin); notas, formas de pagamento, estoque, vendas por item, briefings, depósitos e pedidos Shopify são espelhos escritos só por robôs/webhook (Planos 3, 4 e 7) — custo se errada: cadastrar ajuste continua exigindo acesso ao banco, como hoje.
5. Ruling: escopo de leitura = catálogo, sem regra extra em Go — as 7 restritivas (`pode_ver_canal` ×6, `pode_ver_estoque` ×1) entram pela regra de Ler; as tabelas `true`/`authenticated` (lojas, depósitos, metas, vendedoras, cache vendedor×pedido, briefings) continuam lidas por toda sessão; papel `admin` com trava não vê canal (as funções ignoram o papel) — "mesmas permissões de hoje" (spec §1); recortar as globais por canal mudaria números nas telas de quem tem trava — custo se errada: a vendedora continua podendo ler metas, cache e briefing de outras lojas (achado 2, com a correção de uma linha por rota).
6. Ruling: salvar metas é UMA transação por mês (`POST /comercial/metas/salvar`), sob `pg_advisory_xact_lock` do mês, localizando cada meta pela chave natural com a regra de Ler e passando pelo MESMO `Tabela.Criar/Editar/Apagar` (pelo `id`); mais de uma linha para a chave = 409 — hoje a tela grava uma a uma e para no meio ("Não salvou tudo… N já foram gravadas"), e `bling_metas` provavelmente não tem único em (loja, ano, mês) (a tela faz update/insert, não upsert), então a trava substitui o `on conflict`; escolher uma das duplicatas em silêncio esconderia erro de dado — custo se errada: o Plano 7 reescreve o `_mtSalvar`; duplicata antiga bloqueia o salvamento do mês até ser limpa (consulta nas NOTAS).
7. Ruling: pedidos da Shopify saem só com `id, total, criado_em_shopify, status_financeiro` (o que `pedidos-shopify.js` lê); `cliente_nome`, `cliente_email` e `bruto` não saem por rota nenhuma; nos ajustes, `motivo`/`criado_por` também ficam fora — minimização de dado pessoal: nenhuma tela os lê, e pelo PostgREST qualquer pessoa que visse a loja Shopify os lia — custo se errada: tela futura que precise do cliente ganha a coluna por Ruling.
8. Ruling: sessão de "entrar como" só LÊ no Comercial: as 4 escritas respondem 403 — metas e canal seriam gravados com a identidade do alvo; nos caches seria inofensivo, mas uma regra só para o domínio é mais simples de provar (varredura) — estende o Ruling 18 do mestre e os 5.1-4/5.2-3/5.3-5 — custo se errada: o cache não é preenchido enquanto o super-admin navega como outra pessoa (a próxima TV preenche).
9. Ruling: as rotas moram num pacote novo, `internal/vendas` (prefixo `/comercial/`), e não no `internal/comercial` dos Planos 3/4 — lá estão o proxy do Bling e o push de vendas, com nomes de topo (`responder`, `erro`, `texto`, `pedido`…) que colidiriam, nada é compartilhado e o Ruling 14 do mestre manda manter a regra do proxy separada — custo se errada: dois pacotes no mesmo domínio.
10. Ruling: teto de 1000 linhas do mestre (Ruling 10) também no cache lido pelo Admin — `tela-de-admin.vue:560/4111` pedem `limit(5000)`, mas o PostgREST (`max_rows` 1000) sempre entregou 1000 — custo se errada: a "loja da vendedora" segue calculada sobre os 1000 pedidos mais recentes, como hoje (achado 7).
11. Ruling: a janela das notas é UM filtro `janela` com um intervalo de datas do Postgres (`[AAAA-MM-DD,AAAA-MM-DD]`, `@janela::text::daterange`) — o `.or(and(data_da_venda…),and(data_pedido…))` da tela não cabe em dois filtros independentes (seriam AND e trariam linhas a mais) — custo se errada: o Plano 7 monta o texto do intervalo; intervalo malformado = 400.
12. Ruling: nenhuma RPC no 5.5 — `meus_vinculos` não é chamada pelo front (só citada em comentário); o vínculo chega pelo `Escopo` e pelas rotas do 5.1; a lista do `/rpc` e `RPCPendentes` (92 registráveis) não mudam — custo se errada: nenhum.
13. Ruling: o 5.5 não toca o `bling-proxy` nem o push de vendas — Rulings 14 (duas regras de canal) e 24 (push global) do mestre; o push lê as tabelas do Comercial direto pelo pool do worker e não passa pelas rotas — custo se errada: a regra de canais do proxy (supervisora pelo NOME do grupo) e a do banco (pelo `grupo_id`) seguem precisando andar juntas por decisão de produto.
14. Ruling: os lotes dos caches recebem de 1 a 1000 linhas `{"linhas":[…]}`, chave inteira positiva e ao menos uma coluna além dela, processadas em ordem de chave (estável) numa transação; `updated_at` das vendedoras vem do corpo (paridade, como o 5.2-11) — ordem fixa evita deadlock entre duas TVs; tudo ou nada é o que o PostgREST já fazia por requisição — custo se errada: uma linha ruim derruba o lote dela (a tela ignora o erro e a próxima carga refaz).
15. Ruling: as metas validam dinheiro antes da transação (valor > 0 até 999.999.999,99, duas casas; metas diárias = objeto de até 31 dias com valores do mesmo formato) e o salvamento vai ao log com quem, mês e contagens, sem valores — as tabelas de meta não têm coluna de autoria e criar uma é decisão de produto; o log dá o "quem mudou" que hoje não existe — custo se errada: valor com mais de duas casas vindo de outra origem é recusado (a tela arredonda a duas).

## Achados para o dono

1. **Os caches de vendas são escritos pelo navegador:** quem tem `sales` (ou papel admin, ou é super-admin) pode reescrever o vendedor de QUALQUER pedido, de qualquer loja, e o nome de qualquer vendedora; esse cache alimenta o ranking, a "loja de cada vendedora" do Admin e os "itens por pedido" do push das 22h. É a decisão de 18/08 ("quem pode ver vendas") e a API a mantém. Correção definitiva: o servidor gravar o cache quando detalha o pedido pelo proxy do Bling (Plano 3) e a escrita sair do navegador.
2. **Leituras globais por policy `true`:** metas de todas as lojas e vendedoras, o cache vendedor×pedido (quantos pedidos cada vendedora de outra loja fez, por dia), os nomes das vendedoras e o briefing semanal da Gestão Comercial (`dados_json` com números de todas as lojas) são lidos por qualquer sessão — pela API como pelo PostgREST; é a tela que esconde. Recortar por canal é uma linha por rota, se o dono decidir (muda os números de quem tem trava).
3. **Metas só para papel `admin`:** super-admin pela ficha com papel viewer abre o Admin e recebe 403 ao salvar metas (o mesmo descompasso do achado do 5.1 em perfis).
4. **Papel `admin` com trava de time não vê nenhuma nota, ajuste, forma de pagamento, venda por item, pedido Shopify nem estoque** (`pode_ver_canal`/`pode_ver_estoque` ignoram o papel; só super-admin e "sem trava" veem tudo).
5. **Ajustes de valor e de vendedor continuam sem tela** (B6, 15/09): depois do corte, o comando de banco roda no Postgres próprio e `criado_por` só fica preenchido se quem cadastra preencher.
6. **`bling_metas` provavelmente sem único (loja, ano, mês):** a API serializa o salvamento por mês e recusa duplicata (409); linha duplicada antiga precisa ser limpa antes do corte (consulta nas NOTAS).
7. **`tela-de-admin.vue:560/4111` pedem 5000 linhas do cache e sempre receberam 1000** (`max_rows`): a "loja da vendedora" é calculada sobre os 1000 pedidos mais recentes.
8. **Nome, e-mail e payload dos clientes da Shopify eram legíveis por quem via a loja Shopify** (pelo PostgREST); nenhuma tela os usa e a API deixa de servi-los.

## Cobertura da spec e o que vem depois

**As 15 tabelas da linha 5.5 (33 policies, 7 restritivas):**

| Tabela | Policies | Destino |
|---|---|---|
| `bling_lojas` | `authenticated read` (select), `bling_lojas_grupo_superadmin` (update) | Task 6 (+ gatilho `trg_espelhar_grupo_do_canal`, D0 do 5.1) |
| `bling_depositos` | `bling_depositos_read` | Task 5 |
| `bling_metas`, `bling_vendedor_metas` | `admin_write_*` (all), `authenticated read*` (select), `service_role*` (compila `false`, Ruling 5 do mestre) | Task 7 |
| `bling_vendedores`, `bling_pedido_vendedor` | `authenticated can read*`, `quem ve vendas grava/atualiza*` | Task 8 |
| `bling_pedido_nota`, `bling_pedido_forma_pagamento` | `*_leitura` + `*_so_do_meu_canal` (R) | Task 4 (escrita: robôs) |
| `bling_pedido_ajuste_valor`, `bling_pedido_ajuste_vendedor` | `*_leitura` + `*_so_do_meu_canal` (R) + `*_escrever` (all, super pela ficha) | Task 4 (escrita sem rota, Ruling 5.5-4) |
| `gc_estoque_item` | `gc_ei_read` + `gc_ei_so_do_meu_time` (R, `pode_ver_estoque`) | Task 4 |
| `gc_vendas_item` | `gc_vi_read` + `gc_vi_so_do_meu_time` (R) | Task 4 |
| `gestao_comercial_briefings` | `gcb_select` | Task 5 |
| `shopify_pedidos` | `shopify_pedidos_leitura` + `_so_do_meu_canal` (R) | Task 4 (escrita: webhook do Plano 3 e robô) |
| `bling_tokens` | `service_role full access tokens` | sem rota (só o serviço; Plano 3/4) |

Liberações de estoque (`equipes_permissoes`) são do 5.1 (Task 5 dele); aqui o efeito delas é provado pelo `estT1` da matriz. Spec §5 (catálogo como especificação, escopo de loja/canal/depósito, IDOR, ator × operação × recurso pela cadeia real), §11 (minimização de dado pessoal, lista fechada de colunas gravadas, impersonação sem escrita), §13 (corrida e falha no meio do lote testadas).

**O que vem depois:**
- **5.10 / 5.11:** as funções `vessel_*` que leem `bling_vendedores`, `bling_pedido_vendedor` e `bling_lojas` (`vessel_carocos`, `vessel_ligar_vendedor`, `vessel_vendedores_parecidos`…) usam as tabelas desta fatia como estão (nunca outro `create table`).
- **Plano 3 (pendência registrada):** o servidor preencher os caches ao detalhar pedidos pelo proxy, se o dono decidir pelo achado 1.
- **Plano 7:** os 40 sítios da tabela acima (metas, canal e caches mudam de forma), os helpers de `src/compartilhado` (data da venda, valor e vendedor corrigidos, troca, Shopify) e os robôs listados no inventário.
- **Plano 8:** `api worker conferir` e as consultas de "Antes do corte" no banco restaurado; trocar a fatia reconstruída pelo `pg_dump` do ensaio.
