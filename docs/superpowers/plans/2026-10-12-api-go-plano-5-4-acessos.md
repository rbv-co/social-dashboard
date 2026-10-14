# Sair do Supabase — Plano 5.4: Colaboradores e Acessos (cadastro)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **Execute na worktree `p5-54`** (branch `feat/api-go-plano-5-4`, empilhada sobre o PLANO do 5.3; antes da Task 1 ela recebe o 5.2 EXECUTADO, que já traz 5.0 e 5.1). Roda **em paralelo com a execução do 5.3** (worktree `p5-53`): pacotes e fatias D0 disjuntos (ver Paralelização). Faça `git add` só dos caminhos de cada task. Este plano contrata sobre as **interfaces** do 5.0, do 5.1 e do 5.2 (escritas nos planos deles), não sobre o código: o pré-voo confere que elas existem com esses nomes.

**Goal:** Trocar os 45 sítios VIVOS do front nas tabelas `acessos_*` (tela de Colaboradores e Acessos, Admin e Frota) por 16 rotas da API em Go que decidem com as MESMAS regras das 14 policies de produção (`is_acessos_admin()`), com o elo ficha↔login (que decide `pode_ver_bem`) numa ação com compare-and-set, a exclusão de colaborador restrita a admin como a tela já restringia, a trilha com autoria da sessão — e provar que nenhuma rota deste domínio alcança os segredos de `acessos_conexoes`, que ficam inteiros com o Plano 6.

**Architecture:** Pacote novo `internal/acessos` (plural; o `acesso` do 5.1 é de contas de login), montado no grupo de domínio do 5.0 (`auth.Exigir` → `autz.ComEscopo`). Leitura = `dados.Consulta` (regra de Ler do catálogo no `WHERE`; embutidos = subconsulta com `{ler:…}` e lista fechada de colunas). Escrita = o caminho declarado do 5.1 (`dados.Tabela` + `RotaCriar/RotaEditar/RotaApagar`: o MESMO mapa vai ao `PodeX` e ao `INSERT/UPDATE`, na MESMA transação de `banco.ComUsuario`). Dois handlers próprios (ligar ficha ao login, excluir colaborador), ambos com `PodeX` antes, na mesma transação. Testes contra a fatia 5.4 do esquema de produção (D0): tabelas das migrations; as `acessos_*` não têm gatilho em produção, então nada é regerado.

**Tech Stack:** Go 1.26 (`go.mod`), `chi`, `pgx` v5, Postgres 17 (contêiner).

**Spec:** `docs/superpowers/specs/2026-10-09-sair-do-supabase-design.md` (§5 autorização, §11 segurança, §13 testes) e o plano-mestre `docs/superpowers/plans/2026-10-11-api-go-plano-5-dominios.md` (§II contrato, IV.1 regras de sub-plano, linha 5.4 da IV.2, Rulings 1–36). Modelos e interfaces: `…-5-1-admin-equipes-acesso.md` e `…-5-3-frota.md`. Especificação das permissões: `docs/migracao-go/catalogo-policies-producao.json` — 14 policies em 13 tabelas, todas `is_acessos_admin()` (`acessos_log`: só `select` e `insert`); `acessos_conexoes` NÃO está no catálogo (RLS ligada SEM policy: só a chave de serviço, `db/migrations/acessos/006_zoho.sql:1-15`).

## Global Constraints

- Nada em produção: sem `ssh`, sem credencial real, sem `push`. Postgres local descartável; segredos de teste inventados (`SEGREDO-…`).
- Regra de cada tabela = a do catálogo (`autz.Producao`), nunca reescrita à mão. Única divergência: excluir colaborador exige papel `admin` (Ruling 5.4-6).
- Negar por padrão. Todo portão tem o lado negado assertado **com o efeito** (contagem/linha/foto do banco conferida depois).
- IDOR e vazamento: lista negada = `200 []`; escrita em linha invisível = `404`; `403` só para criar ou para linha visível. **Toda rota tem teste de vazamento com pessoa restrita pelo handler real** (cadeia `auth.Exigir` → `autz.ComEscopo`).
- **Mapa de escrita da MESMA struct que monta o INSERT/UPDATE** (`dados.Campos` → `dados.Tabela`). Nenhum SQL de escrita à mão; a única consulta própria é a conferência do "ligar", DEPOIS do `PodeEditar`.
- **`PodeX` na MESMA transação de `banco.ComUsuario` que grava.** `PodeCriar` exige toda coluna lida pela regra (as daqui não leem coluna nenhuma).
- Autoria da sessão: `acessos_log.quem` vem de `Tabela.Autor`; mandar no corpo = `400 corpo_invalido`. `profile_id` só entra por criar (Admin) ou pela ação `ligar`; o PATCH o recusa.
- Sessão de "entrar como" só LÊ: as 10 escritas = `403` sem efeito (Ruling 5.4-5).
- Leitura declarada só com a GRAMÁTICA permitida do 5.0; embutido = subconsulta na lista com `{ler:<tabela>:<alias>}` como termo de `and` e colunas fechadas (`json_build_object`).
- **Segredos:** nenhuma declaração, rota, RPC ou teste deste pacote lê `acessos_conexoes` (só o D0 a cria e a varredura a semeia). Nunca em log nem em resposta: `client_secret`, `refresh_token`, `oauth_state`, corpo de pedido, telefone/e-mail/motivo de saída de colaborador.
- SQL: todo parâmetro com cast explícito; nada do pedido no texto do SQL.
- Sem dependência nova; `go.mod` fica em `go 1.26.0`.
- Gate: `make -C api teste PG_PORTA=58539` com `--- SKIP` = 0; `gofmt -l` e `go vet` limpos. O alvo `teste` usa o contêiner de nome fixo `pg-api-teste`: nunca ao mesmo tempo que o gate do 5.3.
- Commits terminam com `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>` (o modelo que implementa). Código, comentários e mensagens em português com acentuação; frases copiadas da tela ficam como estão.
- `go` roda em `api/`; `git` na raiz da worktree.

## Review Focus

1. **Ficha que já está ligada a OUTRO login** (dois admins ao mesmo tempo, ou o convite do dono na Frota) → `409` e o elo intacto; ligar de novo ao mesmo login = `200`; depois do elo, o `Escopo` do login inclui a ficha (é o que abre `pode_ver_bem`). Testes: `TestLigarFichaAoLogin`, `TestLigarConcorrente` (Task 4).
2. **Quem tem só a feature `acessos` excluindo colaborador** → `403 "Só admin pode excluir."` e nada apagado (vínculos e termos intactos); admin → `204` e a cascata. Teste: `TestExcluirColaborador` (Task 4).
3. **Pessoa sem Colaboradores e Acessos** (super pela ficha, super por e-mail, só Frota, só Patrimônio, ninguém) **em QUALQUER rota** → `[]`/`403`/`404`; conta desativada → `401`; foto do banco igual. Teste: `TestNadaVazaParaQuemNaoTemAcessos` (Task 7).
4. **Segredo de `acessos_conexoes` em qualquer resposta ou linha de log de qualquer rota de `Montar`, ou uma declaração que leia a tabela** → nunca; `Validar` recusa. Teste: `TestConexoesNuncaSaem` (Task 7).
5. **Embutido de tabela que a pessoa não lê** (a marca do Patrimônio para quem só tem `acessos`) → `"patrimonio_empresas": null`, sem o nome da marca. Teste: `TestPessoas` (Task 3).

---

## Interfaces que este plano consome

(Dos planos 5.0, 5.1 e 5.2; o pré-voo confere cada uma.)

- **5.0** — `dados`: `Consulta{Tabela, Alias, SQL, Onde; Filtros []Filtro; Ordens map[string]string; OrdemPadrao, Desempate string}` com `Validar(cat)`/`Handler(b, cat)` (contar=1 → `X-Total-Count`; teto 1000); `Filtro{Param, SQL, Tipo}`; `LerCorpo` (recusa campo não declarado), `Erro`, `ErroDoBanco` (`23505`/`23503` = 409; outros `22*`/`23*` = 400 `pedido_invalido`), `ErroDeEscrita`. `autz`: `Producao`, `Escopo{ID, Papel, Ativo, Pessoas…}`, `CarregarEscopo(ctx, b, id)`, `EscopoDo`, `ComEscopo`, `AcessosAdmin` (= `is_acessos_admin()`, conferido contra a função de produção no oráculo), `Ler/Criar/Editar/Apagar`, `(*Catalogo).Filtro/PodeEditar/PodeApagar`, `ErrNegado`, `ErrNaoEncontrado`. `auth`: `Ator{ID, ImpersonadorID}`, `AtorDoContexto`, `NoContexto`, `Exigir`, `NovoStore`, `(*Store).Criar(ctx, id, tipo, impersonadorID)`. `banco.ComUsuario`. `web`: grupo de domínio de `web.Rotas`; mapas `publicas`/`soSessao` em `rotas_test.go`.
- **5.1** — `testebanco.ComEsquemaDeProducao(t)` (banco novo com compat + migrações + `esquema/*.sql` em ordem de nome); `esquema/01-tabelas-5-1.sql` com `profiles`, `equipes` (com `setor_id uuid` SEM FK: "entra com a fatia do 5.4") e `acessos_pessoas` MÍNIMA (`id, nome, profile_id, email_corporativo`). `dados.Tabela{Nome, Resposta, Autor}` com `Validar`, `Criar`, `Editar(ctx, tx, cat, e, id, campos)`, `Apagar(ctx, tx, cat, e, id)`; `dados.Campos`; `RotaCriar[C]`/`RotaEditar[C]` (roda `C.Validar()` se existir)/`RotaApagar`; `dados.Responder`.
- **5.2** — `esquema/01-tabelas-5-2.sql` com `patrimonio_empresas (id, nome, …)` (FK de `acessos_pessoas.marca_id` e embutido do Admin). O 5.2 é dono das RPCs `pessoas_para_escolher`, `setores_para_escolher`, `criar_pessoa_rapida`, `criar_setor_rapido` (leem/gravam `acessos_pessoas`/`acessos_setores` por dentro) e da leitura `GET /patrimonio/bens` que a tela de Acessos usa por `?pessoa_id=` (tela-de-acessos.vue:1819, 2075, 2248: Plano 7). Se a fatia do 5.2 declarou alguma `acessos_*` (mínima, para os testes dessas RPCs), ela passa para cá (Ruling 5.4-2).
- **5.3** — nada no código. A tela de Acessos lê `GET /frota/veiculos?pessoa_id=` (5.3, Task 3) nos sítios 1820, 2078 e 2249 (Plano 7).

## Interfaces que este plano entrega

- `acessos.Montar(r chi.Router, p *pgxpool.Pool)` (Task 7), montado por `web.Rotas`.
- No pacote `acessos`, para o Plano 6 (que põe o proxy e as rotas de arquivo NESTE pacote, Ruling 5.4-3): `tabelaPessoas`, `colunasPessoa`, `tabelaLog` (`Autor: "quem"`), `consultaRecursos`, `soSessaoPropria`, `emBranco`; nos testes `novoMundo`, `escritas`, `fotoDosAcessos` e as três varreduras de `rotas_test.go`, que passam a cobrir toda rota nova de `Montar` sozinhas.
- D0: `esquema/01-tabelas-5-4.sql` com as 13 `acessos_*` completas e `acessos_conexoes` (a tabela dos segredos, para os testes do Plano 6).

## Pré-voo (antes da Task 1)

- [ ] `cd /Users/gabrielgertrudes/Projetos/Trabalho/lavessel/social-dashboard/.claude/worktrees/p5-54 && git status --short && git branch --show-current` → vazio (ou só este plano); `feat/api-go-plano-5-4`.
- [ ] Trazer o 5.2 executado (com 5.0 e 5.1): `git merge --no-edit feat/api-go-plano-5-2`. Conferir:
  ```bash
  grep -c 'func ComEsquemaDeProducao' api/internal/testebanco/esquema.go                                   # 1
  grep -c 'func (t Tabela) Criar\|func (t Tabela) Editar\|func (t Tabela) Apagar\|func RotaCriar\|func RotaEditar\|func RotaApagar\|func Campos\|func Responder' api/internal/dados/escrita.go   # 8
  grep -c 'func (c \*Catalogo) PodeEditar\|func (c \*Catalogo) PodeApagar' api/internal/autz/escrita.go     # 2
  grep -c 'AcessosAdmin' api/internal/autz/predicados.go                                                    # ≥ 1
  grep -n 'acessos_pessoas ap where ap.profile_id' api/internal/autz/escopo.go                              # Escopo.Pessoas lê o elo
  grep -c 'autz.ComEscopo(p)' api/internal/web/rotas.go                                                     # 1
  grep -n 'create table public.acessos_pessoas' api/internal/testebanco/esquema/01-tabelas-5-1.sql          # a MÍNIMA
  grep -c 'create table public.patrimonio_empresas' api/internal/testebanco/esquema/01-tabelas-5-2.sql      # 1
  sed -n '/create table public.patrimonio_empresas/,/^);/p' api/internal/testebanco/esquema/01-tabelas-5-2.sql
  grep -n 'acessos_' api/internal/testebanco/esquema/01-tabelas-5-*.sql                                     # declarações a trazer para cá
  grep -rln 'insert into acessos_pessoas\|insert into equipes' api/internal --include='*_test.go'           # dados de teste que a fatia vai apertar
  grep -ln 'func NovoMundo\|type Caso struct' api/internal/testebanco/*.go                                  # o 5.2 extraiu o mundo?
  ```
  Qualquer `0` nas seis primeiras ou na de `patrimonio_empresas`: a dependência não terminou — **pare e reporte**. Nome diferente só de campo/função: use o real em todo o plano. Semântica diferente (ex.: `Tabela.Editar` sem `PodeEditar`; `Escopo.Pessoas` sem ler `profile_id`): **pare e reporte**.
  - Alguma `acessos_*` (tabela ou coluna de `acessos_pessoas` por `alter`) declarada numa fatia do 5.2/5.3: apague essa declaração de lá no commit da Task 1 (Ruling 5.4-2). Só `acessos_pessoas` MÍNIMA fica na 5.1 (as fatias 5.2/5.3 a referenciam por FK e carregam antes).
  - `patrimonio_empresas` com coluna `NOT NULL` sem default além de `id, nome`: acrescente um valor válido nos inserts das Tasks 1 e 2.
  - Teste de outro pacote que grava `acessos_pessoas` sem `nome` ou `equipes.setor_id` com id inventado: a fatia o reprova (as duas restrições são de produção: `001_base.sql:4`, `2026-08-04-equipes-e-escopo.sql:60`); corrija o DADO do teste (dê o nome / crie o setor), não a fatia, no commit da Task 1.
  - Mundo já extraído para `testebanco` (5.2): use-o no lugar das funções genéricas de `mundo_test.go` (Task 2), mesma semântica.
- [ ] `go version` → `go1.26`+.
- [ ] Docker no ar, porta livre (`lsof -iTCP:58539 -sTCP:LISTEN` → vazio) e o banco das etapas:
  ```bash
  docker run -d --rm --name pg-plano54 -e POSTGRES_PASSWORD=x -p 127.0.0.1:58539:5432 postgres:17
  until docker exec pg-plano54 pg_isready -h 127.0.0.1 -U postgres >/dev/null 2>&1; do sleep 1; done
  export TEST_DATABASE_URL='postgres://postgres:x@localhost:58539/postgres?sslmode=disable'
  ```
- [ ] Linha de base: `cd api && go test ./... && go test -v ./... 2>&1 | grep -c -- '--- SKIP'` → tudo `ok` e `0`.

## Estrutura de arquivos

```
api/internal/testebanco/esquema/01-tabelas-5-4.sql        # 12 acessos_* + acessos_conexoes; acessos_pessoas COMPLETADA; FK equipes.setor_id
api/internal/testebanco/esquema_acessos_test.go           # checks, únicos, FKs e "nenhum gatilho" da fatia
api/internal/acessos/acessos.go        (+ acessos_test.go) # doc do pacote, soSessaoPropria, deve, emBranco
api/internal/acessos/mundo_test.go                         # pessoas, linhas, segredos plantados, sessões, cadeia Exigir → ComEscopo
api/internal/acessos/pessoas.go        (+ _test)           # GET/POST /acessos/pessoas, PATCH /acessos/pessoas/{id}
api/internal/acessos/acoes.go          (+ _test)           # POST /acessos/pessoas/{id}/ligar, DELETE /acessos/pessoas/{id}, POST /acessos/log
api/internal/acessos/estrutura.go      (+ _test)           # /acessos/organizacoes, /acessos/setores
api/internal/acessos/pastas.go         (+ _test)           # GET /acessos/recursos, /acessos/vinculos (+ POST), GET /acessos/termos
api/internal/acessos/rotas.go          (+ rotas_test.go)   # Montar; varreduras de impersonado, vazamento e segredos
api/internal/web/rotas.go, rotas_test.go                   # montagem, soSessao, montagem real
api/cmd/api/conferir.go                                    # colunas, tipos e únicos que as rotas presumem
docs/migracao-go/NOTAS-DA-IMPLANTACAO.md                   # seção do 5.4
```

**Não toca:** `esquema/gerar-gatilhos.mjs` nem `esquema/02-gatilhos.sql` (nenhum gatilho nas `acessos_*`: Ruling 5.4-1), nem `01-tabelas-5-1.sql` (a mínima é completada por `alter`).

## Tarefas

| # | Task | Revisor | Depende de |
|---|---|---|---|
| 1 | D0: fatia 5.4 (12 `acessos_*` + `acessos_conexoes`; `acessos_pessoas` completada; FK `equipes.setor_id`; sem gatilhos) | **opus** (dados: é contra isto que tudo é provado) | 5.1 T1, 5.2 (fatia) |
| 2 | `acessos`: fundação (mundo de teste com segredos plantados, portão de impersonado, `emBranco`) | **opus** (autorização) | 1, 5.1 T2 |
| 3 | Pessoas: leitura com embutidos e cadastro (`GET`/`POST`/`PATCH`) | **opus** (dado pessoal; regra de outra tabela no embutido) | 2 |
| 4 | Ligar ficha ao login, excluir colaborador e trilha | **opus** (permissão de ver bens, exclusão em cascata, autoria) | 3 |
| 5 | Estrutura: organizações e setores | sonnet | 2 |
| 6 | Pastas, vínculos e termos (leituras + vínculo novo) | sonnet | 2 |
| 7 | Montagem, varreduras (impersonado, vazamento, segredos), `conferir` e notas | **opus** (fronteira, segredos) | 3–6 |

---

### Task 1: D0 — fatia 5.4 do esquema de produção nos testes

**Revisor:** opus. **Depende de:** Task 1 do 5.1 (carregador), fatia do 5.2 (`patrimonio_empresas`).

**(a) Contrato**
- `esquema/01-tabelas-5-4.sql`: `acessos_organizacoes`, `acessos_setores`, `acessos_dispositivos`, `acessos_termos`, `acessos_config`, `acessos_log`, `acessos_recursos`, `acessos_vinculos`, `acessos_drive_marcas`, `acessos_drive_setores`, `acessos_drive_overrides`, `acessos_patrimonio_historico` e `acessos_conexoes` com colunas, tipos, defaults, checks, únicos e FKs das migrations (fonte por bloco); `acessos_pessoas` (nascida mínima na 5.1) COMPLETADA por `alter table` com as 16 colunas que faltam, `nome not null` e o check de `status`; a FK `equipes.setor_id → acessos_setores` (`on delete set null`) que a 5.1 deixou para cá. Declaradas SÓ aqui (Ruling 5.4-2).
- `02-gatilhos.sql` não muda: `03-triggers.csv` não tem gatilho em tabela `acessos_*`.

**(b) Testes de aceitação** (`TestFatiaDosAcessos`, código abaixo)
- Nenhum gatilho nas `acessos_*`; `acessos_pessoas` com exatamente as 20 colunas de produção.
- Recusas com o código do Postgres: `status = 'inativo'` → `23514`; `nome` nulo → `23502`; recurso `dropbox` → `23514`; `external_id` repetido no WorkDrive → `23505`; papel `admin` no vínculo → `23514`; `resultado = 'parcial'` na trilha → `23514`; setor de mesmo nome na MESMA organização → `23505`; organização repetida → `23505`; apagar a marca (`patrimonio_empresas`) usada por uma ficha → `23503`.
- Permitidos: setor de mesmo nome em OUTRA organização; `external_id` repetido fora do WorkDrive.
- FKs: apagar setor zera `acessos_pessoas.setor_id` E `equipes.setor_id`; apagar organização zera a do setor e a da ficha; apagar a ficha leva vínculos, termos e dispositivos.

**(c) Arquivos:** Create `api/internal/testebanco/esquema/01-tabelas-5-4.sql`, `api/internal/testebanco/esquema_acessos_test.go`.

**(d) Dependências:** `testebanco.ComEsquemaDeProducao`; `01-tabelas-5-1.sql` (`acessos_pessoas` mínima, `equipes`), `01-tabelas-5-2.sql` (`patrimonio_empresas`).

- [ ] **Step 1: A DDL.** Crie `api/internal/testebanco/esquema/01-tabelas-5-4.sql`:

```sql
-- FATIA 5.4 (Colaboradores e Acessos) do esquema de produção para os testes (D0 reconstruído:
-- Rulings 5.1-1 e 5.4-1). Carregada depois de 01-tabelas-5-1/5-2/5-3 (ordem do nome). As acessos_*
-- são declaradas SÓ aqui (Ruling 5.4-2), menos acessos_pessoas: ela nasce MÍNIMA na 5.1 (o que o
-- Escopo lê) porque as fatias 5.2/5.3 a referenciam por FK e carregam antes — aqui ela é COMPLETADA.
-- Nenhuma acessos_* tem gatilho em produção (03-triggers.csv): 02-gatilhos.sql não muda.

-- db/migrations/acessos/005_organizacoes.sql:2-7
create table public.acessos_organizacoes (
  id        uuid primary key default gen_random_uuid(),
  nome      text not null unique,
  ordem     int not null default 0,
  criado_em timestamptz not null default now()
);

-- 004_v2.sql:2-8 + 005_organizacoes.sql:19 + 014_setor_unique_por_org.sql:3-7 (nome único POR organização)
create table public.acessos_setores (
  id             uuid primary key default gen_random_uuid(),
  nome           text not null,
  cor            text,
  ordem          int not null default 0,
  criado_em      timestamptz not null default now(),
  organizacao_id uuid references public.acessos_organizacoes(id) on delete set null
);
create unique index acessos_setores_org_nome_uk on public.acessos_setores (organizacao_id, nome);

-- acessos_pessoas: 001_base.sql:2-11 + 004_v2.sql:19-30 + 006_zoho.sql:20-21 + 010_colab_contas.sql:2-3
-- + 011_colab_org.sql:3 + db/migrations/2026-08-06-pessoa-marca.sql:14-15. profile_id: presumido (5.1).
alter table public.acessos_pessoas
  alter column nome set not null,
  add column cargo                text,
  add column status               text not null default 'ativo'
    constraint acessos_pessoas_status_check check (status in ('ativo','desligado')),
  add column criado_em            timestamptz not null default now(),
  add column atualizado_em        timestamptz not null default now(),
  add column setor_id             uuid references public.acessos_setores(id) on delete set null,
  add column numero_pessoal       text,
  add column numero_corporativo   text,
  add column data_inicio_contrato date,
  add column data_fim_contrato    date,
  add column motivo_saida         text,
  add column avatar_url           text,
  add column zoho_account_id      text,
  add column email_outlook        text,
  add column conta_apple          text,
  add column organizacao_id       uuid references public.acessos_organizacoes(id) on delete set null,
  add column marca_id             uuid references public.patrimonio_empresas(id);

-- 2026-08-04-equipes-e-escopo.sql:60: a FK que a fatia 5.1 deixou para cá
alter table public.equipes add constraint equipes_setor_id_fkey
  foreign key (setor_id) references public.acessos_setores(id) on delete set null;

-- 001_base.sql:13-22 + 004_v2.sql:33-38 + 2026-07-17-patrimonio-completo.sql:7-8 (0 linhas; sem rota: Ruling 5.4-10)
create table public.acessos_dispositivos (
  id             uuid primary key default gen_random_uuid(),
  pessoa_id      uuid not null references public.acessos_pessoas(id) on delete cascade,
  tipo           text not null,
  descricao      text not null,
  identificador  text,
  status         text not null default 'em_uso' check (status in ('em_uso','a_devolver','devolvido','perdido')),
  desde          date,
  observacao     text,
  atualizado_em  timestamptz not null default now(),
  categoria      text not null default 'dispositivo' check (categoria in ('dispositivo','veiculo')),
  detalhes       jsonb not null default '{}'::jsonb,
  valor_centavos bigint
);

-- 004_v2.sql:41-48 (recriada como documentos enviados)
create table public.acessos_termos (
  id           uuid primary key default gen_random_uuid(),
  pessoa_id    uuid not null references public.acessos_pessoas(id) on delete cascade,
  titulo       text,
  arquivo_path text not null,
  enviado_em   timestamptz not null default now(),
  observacao   text
);

-- 001_base.sql:39-44 (a linha única; sem rota)
create table public.acessos_config (
  id            int primary key default 1 check (id = 1),
  empresa       text,
  modelo_termo  text,
  atualizado_em timestamptz not null default now()
);

-- 001_base.sql:46-55 (só select e insert no catálogo)
create table public.acessos_log (
  id        uuid primary key default gen_random_uuid(),
  quando    timestamptz not null default now(),
  quem      uuid,
  acao      text not null,
  provedor  text,
  alvo      text,
  resultado text not null default 'ok' check (resultado in ('ok','erro')),
  detalhe   text
);

-- 009_recursos.sql:2-11 + 2026-07-16-acessos-arquivar-recurso.sql:12-14 + 2026-07-17-acessos-recursos-aceitar-workdrive.sql:19-39
create table public.acessos_recursos (
  id               uuid primary key default gen_random_uuid(),
  tipo             text not null default 'onedrive'
    constraint acessos_recursos_tipo_check check (tipo in ('onedrive','icloud','workdrive')),
  provedor         text default 'microsoft',
  nome             text not null,
  external_id      text,
  drive_id         text,
  caminho          text,
  criado_em        timestamptz not null default now(),
  arquivado_em     timestamptz,
  arquivado_motivo text
);
create unique index acessos_recursos_workdrive_external_id on public.acessos_recursos (external_id)
  where tipo = 'workdrive' and external_id is not null;

-- 012_icloud_vinculos.sql:3-12
create table public.acessos_vinculos (
  id         uuid primary key default gen_random_uuid(),
  recurso_id uuid not null references public.acessos_recursos(id) on delete cascade,
  pessoa_id  uuid not null references public.acessos_pessoas(id) on delete cascade,
  papel      text not null default 'leitura' check (papel in ('leitura','edicao')),
  estado     text not null default 'pendente' check (estado in ('pendente','feito')),
  observacao text,
  criado_em  timestamptz not null default now(),
  feito_em   timestamptz
);

-- 015_drive_marcas.sql:3-9 e 016_drive_setores_overrides.sql:2-14 (sem rota: Ruling 5.4-10; o proxy lê as marcas)
create table public.acessos_drive_marcas (
  id          uuid primary key default gen_random_uuid(),
  nome        text not null,
  external_id text not null unique,
  ordem       int not null default 0,
  criado_em   timestamptz not null default now()
);
create table public.acessos_drive_setores (
  id        uuid primary key default gen_random_uuid(),
  chave     text not null unique,
  label     text not null,
  ordem     int not null default 100,
  criado_em timestamptz not null default now()
);
create table public.acessos_drive_overrides (
  external_id   text primary key,
  setor_chave   text not null,
  nome          text,
  atualizado_em timestamptz not null default now()
);

-- 2026-07-17-patrimonio-completo.sql:14-25 (sem rota)
create table public.acessos_patrimonio_historico (
  id             uuid primary key default gen_random_uuid(),
  dispositivo_id uuid not null references public.acessos_dispositivos(id) on delete cascade,
  pessoa_id      uuid references public.acessos_pessoas(id) on delete set null,
  pessoa_nome    text,
  de             date not null,
  ate            date,
  motivo         text,
  criado_em      timestamptz not null default now()
);

-- 006_zoho.sql:2-13 + 007_zoho_state.sql:2-3. SEGREDOS (client_secret, refresh_token, oauth_state). Em
-- produção: RLS ligada SEM policy (só a chave de serviço). Fora do catálogo: o autz nega. Só o Plano 6
-- (proxy e OAuth) a lê ou grava; aqui ela existe para provar que nada deste domínio a alcança (Task 7).
create table public.acessos_conexoes (
  provedor       text primary key,
  client_id      text,
  client_secret  text,
  refresh_token  text,
  org_id         text,
  data_center    text default '.com',
  escopos        text,
  conectado_por  uuid,
  conectado_em   timestamptz,
  atualizado_em  timestamptz not null default now(),
  oauth_state    text,
  oauth_state_em timestamptz
);
```

- [ ] **Step 2: O teste que falha.** Crie `api/internal/testebanco/esquema_acessos_test.go`:

```go
package testebanco

import (
	"context"
	"errors"
	"testing"

	"github.com/jackc/pgx/v5/pgconn"
)

// A fatia 5.4: as acessos_* com os checks, os únicos e as FKs das migrations (que decidem o 400/409
// das rotas e a cascata de excluir colaborador), sem gatilho nenhum, e acessos_pessoas completa.
func TestFatiaDosAcessos(t *testing.T) {
	p := ComEsquemaDeProducao(t)
	ctx := context.Background()
	const (
		org1 = "a4a00000-0000-4000-a000-000000000001"
		org2 = "a4a00000-0000-4000-a000-000000000002"
		set1 = "a4b00000-0000-4000-a000-000000000001"
		emp  = "a4c00000-0000-4000-a000-000000000001"
		pes  = "a4d00000-0000-4000-a000-000000000001"
		rec  = "a4e00000-0000-4000-a000-000000000001"
		eq   = "a4f00000-0000-4000-a000-000000000001"
	)
	exec := func(sql string) error { _, err := p.Exec(ctx, sql); return err }
	codigo := func(err error) string {
		var pe *pgconn.PgError
		if errors.As(err, &pe) {
			return pe.Code
		}
		return "<sem erro>"
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
	if err := exec(`
		insert into acessos_organizacoes (id, nome) values ('` + org1 + `', 'Sede Centro'), ('` + org2 + `', 'Fábrica');
		insert into acessos_setores (id, nome, organizacao_id) values ('` + set1 + `', 'RH', '` + org1 + `');
		insert into patrimonio_empresas (id, nome) values ('` + emp + `', 'Vessel');
		insert into acessos_pessoas (id, nome, setor_id, organizacao_id, marca_id)
		  values ('` + pes + `', 'Ana', '` + set1 + `', '` + org1 + `', '` + emp + `');
		insert into acessos_recursos (id, tipo, nome, external_id) values ('` + rec + `', 'workdrive', 'Contratos', 'wd-1');
		insert into acessos_vinculos (recurso_id, pessoa_id) values ('` + rec + `', '` + pes + `');
		insert into acessos_termos (pessoa_id, arquivo_path) values ('` + pes + `', '` + pes + `/1-t.pdf');
		insert into acessos_dispositivos (pessoa_id, tipo, descricao) values ('` + pes + `', 'celular', 'iPhone');
		insert into equipes (id, nome, tipo, setor_id) values ('` + eq + `', 'Time RH', 'setor', '` + set1 + `');`); err != nil {
		t.Fatal(err)
	}

	// 1. nenhum gatilho nas acessos_* (nada a gerar) e acessos_pessoas completa (mínima da 5.1 + o resto)
	if v := um(`select count(*)::text from pg_trigger g join pg_class c on c.oid = g.tgrelid
		where not g.tgisinternal and c.relname like 'acessos\_%'`); v != "0" {
		t.Errorf("gatilhos nas acessos_* = %s, esperava 0", v)
	}
	if v := um(`select string_agg(column_name, ',' order by column_name) from information_schema.columns
		where table_schema = 'public' and table_name = 'acessos_pessoas'`); v != "atualizado_em,avatar_url,cargo,conta_apple,"+
		"criado_em,data_fim_contrato,data_inicio_contrato,email_corporativo,email_outlook,id,marca_id,motivo_saida,nome,"+
		"numero_corporativo,numero_pessoal,organizacao_id,profile_id,setor_id,status,zoho_account_id" {
		t.Errorf("colunas de acessos_pessoas = %s", v)
	}

	// 2. o que o banco recusa (é o 400/409 das rotas)
	for sql, quer := range map[string]string{
		`insert into acessos_pessoas (nome, status) values ('X', 'inativo')`:                                 "23514",
		`insert into acessos_pessoas (nome) values (null)`:                                                    "23502",
		`insert into acessos_recursos (tipo, nome) values ('dropbox', 'X')`:                                   "23514",
		`insert into acessos_recursos (tipo, nome, external_id) values ('workdrive', 'Y', 'wd-1')`:            "23505",
		`insert into acessos_vinculos (recurso_id, pessoa_id, papel) values ('` + rec + `', '` + pes + `', 'admin')`: "23514",
		`insert into acessos_log (acao, resultado) values ('x', 'parcial')`:                                   "23514",
		`insert into acessos_setores (nome, organizacao_id) values ('RH', '` + org1 + `')`:                     "23505",
		`insert into acessos_organizacoes (nome) values ('Fábrica')`:                                          "23505",
		`delete from patrimonio_empresas where id = '` + emp + `'`:                                            "23503",
	} {
		if c := codigo(exec(sql)); c != quer {
			t.Errorf("%s: código %s, esperava %s", sql, c, quer)
		}
	}
	// ...e o que ele aceita: mesmo nome de setor em outra organização; external_id repetido fora do WorkDrive
	for _, sql := range []string{
		`insert into acessos_setores (nome, organizacao_id) values ('RH', '` + org2 + `')`,
		`insert into acessos_recursos (tipo, nome, external_id) values ('onedrive', 'Z', 'wd-1'), ('onedrive', 'W', 'wd-1')`,
	} {
		if err := exec(sql); err != nil {
			t.Errorf("%s: %v", sql, err)
		}
	}

	// 3. as FKs de produção: setor → ficha e time; organização → setor e ficha; ficha → vínculos, termos, dispositivos
	if err := exec(`delete from acessos_setores where id = '` + set1 + `'`); err != nil {
		t.Fatal(err)
	}
	if v := um(`select coalesce((select setor_id::text from acessos_pessoas where id = '` + pes + `'), '<nulo>') || '/' ||
		coalesce((select setor_id::text from equipes where id = '` + eq + `'), '<nulo>')`); v != "<nulo>/<nulo>" {
		t.Errorf("apagar setor: ficha/time = %s, esperava os dois zerados", v)
	}
	if err := exec(`delete from acessos_organizacoes where id = '` + org1 + `'`); err != nil {
		t.Fatal(err)
	}
	if v := um(`select coalesce(organizacao_id::text, '<nulo>') from acessos_pessoas where id = '` + pes + `'`); v != "<nulo>" {
		t.Errorf("apagar organização: ficha = %s", v)
	}
	if err := exec(`delete from acessos_pessoas where id = '` + pes + `'`); err != nil {
		t.Fatal(err)
	}
	if v := um(`select ((select count(*) from acessos_vinculos) + (select count(*) from acessos_termos) +
		(select count(*) from acessos_dispositivos))::text`); v != "0" {
		t.Errorf("apagar a ficha deixou %s vínculos/termos/dispositivos", v)
	}
}
```

Run: `cd api && go test -count=1 -run FatiaDosAcessos ./internal/testebanco/` → FAIL (`relation "acessos_organizacoes" does not exist`) antes do Step 1; PASS depois.

- [ ] **Step 3: Rodar e ver morder.** `gofmt -l ./internal && go vet ./internal/testebanco/ && go test -count=1 -v ./internal/testebanco/ 2>&1 | grep -E '^(--- |ok|FAIL)'` → todos `--- PASS` (5.1, 5.2 e 5.3 inclusive, se já mesclados). Mutações que têm de reprovar (uma por vez, `git checkout` depois): tirar `on delete set null` da FK de `equipes.setor_id`; tirar o check de `acessos_log.resultado`; trocar o único de setor por `unique (nome)`.
- [ ] **Step 4: Rodar a suíte inteira** (`go test -count=1 ./...`): o que reprovar por dado de teste fora de produção (ficha sem nome, setor inventado em `equipes`) é corrigido no DADO daquele teste, neste commit (pré-voo).
- [ ] **Step 5: Commit.** `git add api/internal/testebanco/esquema/01-tabelas-5-4.sql api/internal/testebanco/esquema_acessos_test.go` (+ as declarações removidas de outra fatia e os dados de teste corrigidos, se houver) e `git commit -m "test(api): D0 — fatia 5.4 (acessos) com checks, únicos e FKs das migrations, sem gatilhos"` (+ `Co-Authored-By`).

---

### Task 2: `acessos` — fundação (mundo de teste, portão de impersonado, `emBranco`)

**Revisor:** opus. **Depende de:** 1; `dados.Tabela` (Task 2 do 5.1).

**(a) Contrato**
- `soSessaoPropria(next http.Handler) http.Handler`: ator ausente ou com `ImpersonadorID` → `403 {"error":"sem_permissao","mensagem":"Quem entrou como outra pessoa não grava em Colaboradores e Acessos."}` (Ruling 5.4-5). Em TODA escrita do pacote.
- `deve(err error)`: declaração errada → `panic` na montagem.
- `emBranco(v json.RawMessage) bool`: ausente, `null`, não-texto ou só espaços (`nome` é a única coluna obrigatória sem default do cadastro).
- Teste (interno): `novoMundo(t, montar ...func(chi.Router, *pgxpool.Pool)) *mundo` com o banco da Task 1, 8 pessoas (+ `impersonado` = a sessão de `acessos` aberta pelo super pela ficha), as linhas e os SEGREDOS plantados abaixo, e as rotas atrás da MESMA cadeia do grupo de domínio; `(*mundo).resposta/pedir/um/rodar`; `type caso`; `semAcessos`; `fotoDosAcessos` (hash das 14 tabelas `acessos_*` + `equipes.setor_id`).

**(b) Testes de aceitação**
- `TestMundoDosAcessos` (sonda `GET /eco` montada no teste, que escreve `fmt.Sprintf("%t|%s|%t", autz.AcessosAdmin(e), e.Papel, a.ImpersonadorID != nil)`): sem sessão → 401; `acessos` → `true|viewer|false`; `admin` → `true|admin|false`; `superFicha`, `superEmail`, `frota`, `patrimonio`, `viewer` → `false|viewer|false`; `impersonado` → `true|viewer|true`; `desativado` → 401. E `autz.CarregarEscopo(ctx, m.p, idAcessos)` → `Pessoas == [P1]` (o elo da carga é o que o Escopo lê).
- `TestSoSessaoPropria`: sem ator → 403; ator próprio → passa (204); impersonado → 403 com a frase e o handler não roda.
- `TestEmBranco`: `"Ana"` → falso; ausente, `null`, `"  "`, `1` → verdadeiro.

**(c) Arquivos:** Create `api/internal/acessos/acessos.go`, `api/internal/acessos/acessos_test.go`, `api/internal/acessos/mundo_test.go`.

**(d) Dependências:** Task 1; `auth.Exigir/NovoStore/Store.Criar/AtorDoContexto`; `autz.ComEscopo/EscopoDo/AcessosAdmin/CarregarEscopo`; `dados.Erro`.

- [ ] **Step 1: O mundo.** Crie `api/internal/acessos/mundo_test.go`:

```go
package acessos

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

// Pessoas do mundo. is_acessos_admin() = conta ativa e (papel admin ou 'acessos' em features): NÃO
// inclui super-admin, nem pela ficha nem por e-mail.
const (
	idAcessos    = "a4000000-0000-4000-a000-000000000001" // features {acessos}, viewer: lê e grava; não exclui colaborador
	idAdmin      = "a4000000-0000-4000-a000-000000000002" // papel admin: is_acessos_admin pelo papel; exclui; lê o Patrimônio
	idSuperFicha = "a4000000-0000-4000-a000-000000000003" // viewer, super pela ficha, sem acessos: NADA
	idSuperEmail = "a4000000-0000-4000-a000-000000000004" // breno@rbvcompany.com (is_superadmin() por e-mail), viewer: NADA
	idFrota      = "a4000000-0000-4000-a000-000000000005" // features {frota}: o convite do dono (tela-de-frota.vue:829)
	idPatrimonio = "a4000000-0000-4000-a000-000000000006" // features {patrimonio}
	idDesativado = "a4000000-0000-4000-a000-000000000007" // features {acessos}, conta desativada: nem a sessão vale
	idViewer     = "a4000000-0000-4000-a000-000000000008" // nada; é o login que a Carla recebe no "ligar"

	O1  = "a4100000-0000-4000-a000-000000000001" // 'Sede Centro', ordem 1
	O2  = "a4100000-0000-4000-a000-000000000002" // 'Fábrica Conchal', ordem 2
	S1  = "a4200000-0000-4000-a000-000000000001" // 'RH' na O1
	S2  = "a4200000-0000-4000-a000-000000000002" // 'Comercial' na O1; o time EQ1 aponta para ele
	EMP = "a4300000-0000-4000-a000-000000000001" // patrimonio_empresas 'Vessel' (a marca)
	P1  = "a4400000-0000-4000-a000-000000000001" // 'Ana Lima', ativa, S1/O1/Vessel, LIGADA ao idAcessos
	P2  = "a4400000-0000-4000-a000-000000000002" // 'Bruno Reis', desligado, vínculo V2
	P3  = "a4400000-0000-4000-a000-000000000003" // 'Carla Dias', ativa, S2, SEM login (a ligar)
	R1  = "a4500000-0000-4000-a000-000000000001" // pasta iCloud 'Fotos da loja'
	R2  = "a4500000-0000-4000-a000-000000000002" // pasta WorkDrive 'Contratos' (wd-1)
	R3  = "a4500000-0000-4000-a000-000000000003" // pasta iCloud 'Antiga', ARQUIVADA
	V1  = "a4600000-0000-4000-a000-000000000001" // R1 ↔ P1, leitura, pendente
	V2  = "a4600000-0000-4000-a000-000000000002" // R2 ↔ P2, edição, feito
	T1  = "a4700000-0000-4000-a000-000000000001" // termo da Ana
	L1  = "a4800000-0000-4000-a000-000000000001" // uma linha da trilha
	EQ1 = "a4900000-0000-4000-a000-000000000001" // time do tipo setor (5.1) apontando para S2

	telefoneDaAna = "11 90000-0001" // dado pessoal: aparece nas respostas de quem pode, nunca em log
)

var pessoasDoMundo = []struct {
	chave, id, email, papel string
	super, desativada       bool
	features                []string
}{
	{"acessos", idAcessos, "acessos@x.com", "viewer", false, false, []string{"acessos"}},
	{"admin", idAdmin, "admin@x.com", "admin", false, false, nil},
	{"superFicha", idSuperFicha, "superficha@x.com", "viewer", true, false, nil},
	{"superEmail", idSuperEmail, "breno@rbvcompany.com", "viewer", false, false, nil},
	{"frota", idFrota, "frota@x.com", "viewer", false, false, []string{"frota"}},
	{"patrimonio", idPatrimonio, "patrimonio@x.com", "viewer", false, false, []string{"patrimonio"}},
	{"desativado", idDesativado, "desativado@x.com", "viewer", false, true, []string{"acessos"}},
	{"viewer", idViewer, "viewer@x.com", "viewer", false, false, nil},
}

// semAcessos: quem tem sessão e não pode ver nem gravar NADA do cadastro (o lado negado de toda rota).
// A conta desativada fica de fora: nem sessão ela tem (401), e a varredura da Task 7 confere isso.
var semAcessos = []string{"superFicha", "superEmail", "frota", "patrimonio", "viewer"}

// Sem identidade (p.Exec). Os SEGREDO-* de acessos_conexoes nunca podem aparecer em resposta nem em log.
const linhasDosAcessos = `
insert into acessos_organizacoes (id, nome, ordem) values ('` + O1 + `', 'Sede Centro', 1), ('` + O2 + `', 'Fábrica Conchal', 2);
insert into acessos_setores (id, nome, ordem, organizacao_id) values ('` + S1 + `', 'RH', 1, '` + O1 + `'), ('` + S2 + `', 'Comercial', 2, '` + O1 + `');
insert into patrimonio_empresas (id, nome) values ('` + EMP + `', 'Vessel');
insert into acessos_pessoas (id, nome, status, setor_id, organizacao_id, marca_id, profile_id, email_corporativo, numero_pessoal) values
  ('` + P1 + `', 'Ana Lima', 'ativo', '` + S1 + `', '` + O1 + `', '` + EMP + `', '` + idAcessos + `', 'ana@rbv.com', '` + telefoneDaAna + `'),
  ('` + P3 + `', 'Carla Dias', 'ativo', '` + S2 + `', '` + O1 + `', null, null, null, null);
insert into acessos_pessoas (id, nome, status, motivo_saida, data_fim_contrato)
  values ('` + P2 + `', 'Bruno Reis', 'desligado', 'Pediu demissão', '2026-09-30');
insert into acessos_recursos (id, tipo, provedor, nome, external_id, caminho, arquivado_em) values
  ('` + R1 + `', 'icloud', 'apple', 'Fotos da loja', null, null, null),
  ('` + R2 + `', 'workdrive', 'zoho', 'Contratos', 'wd-1', '/RBV/Contratos', null),
  ('` + R3 + `', 'icloud', 'apple', 'Antiga', null, null, '2026-07-16T00:00:00Z');
insert into acessos_vinculos (id, recurso_id, pessoa_id, papel, estado, criado_em) values
  ('` + V1 + `', '` + R1 + `', '` + P1 + `', 'leitura', 'pendente', '2026-10-01T10:00:00Z'),
  ('` + V2 + `', '` + R2 + `', '` + P2 + `', 'edicao', 'feito', '2026-10-02T10:00:00Z');
insert into acessos_termos (id, pessoa_id, titulo, arquivo_path) values ('` + T1 + `', '` + P1 + `', 'Termo do notebook', '` + P1 + `/1760000000000-termo.pdf');
insert into acessos_log (id, quem, acao, alvo) values ('` + L1 + `', '` + idAcessos + `', 'org.criar', 'org:Sede Centro');
insert into acessos_drive_marcas (nome, external_id) values ('RBV', 'od-raiz-1');
insert into acessos_drive_setores (chave, label) values ('c_marketing_1234', 'Marketing');
insert into acessos_drive_overrides (external_id, setor_chave) values ('od-pasta-1', 'c_marketing_1234');
insert into equipes (id, nome, tipo, setor_id) values ('` + EQ1 + `', 'Time Comercial', 'setor', '` + S2 + `');
insert into acessos_conexoes (provedor, client_id, client_secret, refresh_token, org_id, oauth_state) values
  ('zoho', 'cli-zoho', 'SEGREDO-cliente-zoho', 'SEGREDO-refresh-zoho', 'org-1', 'SEGREDO-estado-zoho'),
  ('microsoft', 'cli-ms', 'SEGREDO-cliente-ms', 'SEGREDO-refresh-ms', null, null);`

// fotoDosAcessos: um hash das 14 tabelas acessos_* (as sem rota inclusive: acessos_conexoes, drive,
// dispositivos, config, histórico) e do setor dos times. Igual antes e depois = nada mudou.
const fotoDosAcessos = `select md5(string_agg(l, '|' order by l)) from (
  select 'p:' || t::text as l from acessos_pessoas t union all
  select 'o:' || t::text from acessos_organizacoes t union all
  select 's:' || t::text from acessos_setores t union all
  select 'r:' || t::text from acessos_recursos t union all
  select 'v:' || t::text from acessos_vinculos t union all
  select 't:' || t::text from acessos_termos t union all
  select 'l:' || t::text from acessos_log t union all
  select 'd:' || t::text from acessos_dispositivos t union all
  select 'c:' || t::text from acessos_config t union all
  select 'h:' || t::text from acessos_patrimonio_historico t union all
  select 'dm:' || t::text from acessos_drive_marcas t union all
  select 'ds:' || t::text from acessos_drive_setores t union all
  select 'do:' || t::text from acessos_drive_overrides t union all
  select 'cx:' || t::text from acessos_conexoes t union all
  select 'eq:' || t.id || ':' || coalesce(t.setor_id::text, '-') from equipes t) z`

type mundo struct {
	p   *pgxpool.Pool
	h   http.Handler
	tok map[string]string
}

// novoMundo: a fatia de produção, as pessoas e as linhas acima, uma sessão por pessoa (+ "impersonado":
// a sessão de `acessos` aberta pelo super pela ficha) e as rotas de `montar` atrás da MESMA cadeia do
// grupo de domínio de web.Rotas: auth.Exigir → autz.ComEscopo.
func novoMundo(t *testing.T, montar ...func(chi.Router, *pgxpool.Pool)) *mundo {
	t.Helper()
	p := testebanco.ComEsquemaDeProducao(t)
	ctx := context.Background()
	s := auth.NovoStore(p)
	m := &mundo{p: p, tok: map[string]string{}}
	for _, x := range pessoasDoMundo {
		if _, err := p.Exec(ctx, `insert into usuarios (id, email) values ($1::uuid, $2::text)`, x.id, x.email); err != nil {
			t.Fatal(err)
		}
		if _, err := p.Exec(ctx, `insert into profiles (id, email, name, role, is_superadmin, disabled, features)
			values ($1::uuid, $2::text, $3::text, $4::text, $5::boolean, $6::boolean, coalesce($7::text[], '{}'))`,
			x.id, x.email, x.chave, x.papel, x.super, x.desativada, x.features); err != nil {
			t.Fatal(err)
		}
		tok, err := s.Criar(ctx, x.id, "painel", nil)
		if err != nil {
			t.Fatal(err)
		}
		m.tok[x.chave] = tok
	}
	super := idSuperFicha
	tok, err := s.Criar(ctx, idAcessos, "painel", &super)
	if err != nil {
		t.Fatal(err)
	}
	m.tok["impersonado"] = tok
	if _, err := p.Exec(ctx, linhasDosAcessos); err != nil {
		t.Fatal(err)
	}
	r := chi.NewRouter()
	r.Group(func(r chi.Router) {
		r.Use(auth.Exigir(p, s))
		r.Use(autz.ComEscopo(p))
		for _, f := range montar {
			f(r, p)
		}
	})
	m.h = r
	return m
}

// resposta faz a requisição como `quem` ("" = sem sessão).
func (m *mundo) resposta(t *testing.T, quem, metodo, caminho, corpo string) *httptest.ResponseRecorder {
	t.Helper()
	r := httptest.NewRequest(metodo, caminho, strings.NewReader(corpo))
	if quem != "" {
		tok, ok := m.tok[quem]
		if !ok {
			t.Fatalf("pessoa %q fora do mundo", quem)
		}
		r.Header.Set("Authorization", "Bearer "+tok)
	}
	w := httptest.NewRecorder()
	m.h.ServeHTTP(w, r)
	return w
}

func (m *mundo) pedir(t *testing.T, quem, metodo, caminho, corpo string) (int, string) {
	t.Helper()
	w := m.resposta(t, quem, metodo, caminho, corpo)
	return w.Code, w.Body.String()
}

// um roda uma consulta de UMA coluna ::text (nulo = "<nulo>").
func (m *mundo) um(t *testing.T, sql string, args ...any) string {
	t.Helper()
	var v *string
	if err := m.p.QueryRow(context.Background(), sql, args...).Scan(&v); err != nil {
		t.Fatalf("%s: %v", sql, err)
	}
	if v == nil {
		return "<nulo>"
	}
	return *v
}

// caso: uma requisição e o que tem de sair dela; efeito/quer = consulta rodada DEPOIS (o "negado não
// grava"); caso sem metodo só confere o efeito.
type caso struct {
	nome, quem, metodo, caminho, corpo string
	status                             int
	tem, naoTem                        string
	efeito, quer                       string
}

func (m *mundo) rodar(t *testing.T, casos []caso) {
	t.Helper()
	for _, c := range casos {
		if c.metodo != "" {
			st, corpo := m.pedir(t, c.quem, c.metodo, c.caminho, c.corpo)
			if st != c.status || (c.tem != "" && !strings.Contains(corpo, c.tem)) || (c.naoTem != "" && strings.Contains(corpo, c.naoTem)) {
				t.Errorf("%s: %s %s como %q = %d %s; esperava %d com %q e sem %q", c.nome, c.metodo, c.caminho, c.quem, st, corpo, c.status, c.tem, c.naoTem)
			}
		}
		if c.efeito != "" {
			if v := m.um(t, c.efeito); v != c.quer {
				t.Errorf("%s: efeito %q = %q, esperava %q", c.nome, c.efeito, v, c.quer)
			}
		}
	}
}
```

- [ ] **Step 2: Os testes que falham.** Crie `api/internal/acessos/acessos_test.go` com `TestMundoDosAcessos`, `TestSoSessaoPropria` e `TestEmBranco` (contrato (b); `TestSoSessaoPropria` usa `auth.NoContexto(ctx, &auth.Ator{ID: idAcessos})` e o mesmo com `ImpersonadorID`). Run: `go test -count=1 ./internal/acessos/` → FAIL de compilação (`soSessaoPropria`).

- [ ] **Step 3: Implementar.** Crie `api/internal/acessos/acessos.go`:

```go
// Package acessos: rotas de domínio de Colaboradores e Acessos (sub-plano 5.4) — o CADASTRO de
// colaboradores (acessos_pessoas), da estrutura (organizações, setores), das pastas e vínculos e a
// trilha. Não confundir com o pacote acesso (5.1: contas de login, perfis de acesso, equipes). A regra
// de toda tabela é a do catálogo de produção (autz.Producao: is_acessos_admin() nas 13); o Zoho, a
// Microsoft, o OAuth, os segredos de acessos_conexoes e os arquivos são do Plano 6, que se monta aqui.
package acessos

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/rbv-co/social-dashboard/api/internal/auth"
	"github.com/rbv-co/social-dashboard/api/internal/dados"
)

// soSessaoPropria recusa as escritas a quem entrou como outra pessoa (Ruling 5.4-5): a trilha
// (acessos_log.quem) e o elo ficha↔login sairiam no nome do ALVO.
func soSessaoPropria(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if a := auth.AtorDoContexto(r.Context()); a == nil || a.ImpersonadorID != nil {
			dados.Erro(w, http.StatusForbidden, "sem_permissao", "Quem entrou como outra pessoa não grava em Colaboradores e Acessos.")
			return
		}
		next.ServeHTTP(w, r)
	})
}

// deve: declaração de rota errada (Consulta ou Tabela fora do catálogo) faz a API não subir.
func deve(err error) {
	if err != nil {
		panic(err)
	}
}

// emBranco: ausente, null, não-texto ou só espaços. nome é a única coluna obrigatória sem default do
// cadastro (001_base.sql:4, 004_v2.sql:3, 005_organizacoes.sql:3); a tela já recusa ("Nome é obrigatório").
func emBranco(v json.RawMessage) bool {
	var s string
	return json.Unmarshal(v, &s) != nil || strings.TrimSpace(s) == ""
}
```

- [ ] **Step 4: Rodar e ver passar (e morder).** `gofmt -l ./internal && go vet ./internal/acessos/ && go test -count=1 -v ./internal/acessos/ 2>&1 | grep -E '^(--- |ok|FAIL)'` → `--- PASS`. Mutação: `a == nil || a.ImpersonadorID != nil` → `a == nil`.
- [ ] **Step 5: Commit** `feat(api): acessos — mundo de teste do 5.4 (com segredos plantados) e escrita recusada a quem entrou como outra pessoa` (+ `Co-Authored-By`).

---

### Task 3: Pessoas — leitura com embutidos e cadastro

**Revisor:** opus. **Depende de:** 2.

**(a) Contrato** (o código; `soSessaoPropria` em toda escrita)

```go
const colunasPessoa = `t.id, t.nome, t.cargo, t.status, t.criado_em, t.atualizado_em, t.setor_id, t.email_corporativo, ` +
	`t.numero_pessoal, t.numero_corporativo, t.data_inicio_contrato, t.data_fim_contrato, t.motivo_saida, t.avatar_url, ` +
	`t.zoho_account_id, t.email_outlook, t.conta_apple, t.organizacao_id, t.profile_id, t.marca_id`

// GET /acessos/pessoas (acessos_pessoas_rw: is_acessos_admin()). A UNIÃO do que as telas leem:
// Colaboradores e Acessos (select *: 1341, 2244, 2564, 2565, 2578), Frota (tela-de-frota.vue:1070) e
// Admin (tela-de-admin.vue:3672, com os três embutidos). Cada embutido passa pela regra de Ler da SUA
// tabela e sai com lista fechada: quem não lê o Patrimônio recebe "patrimonio_empresas": null, como o
// embutido do PostgREST sob RLS (Ruling 5.4-9).
var consultaPessoas = dados.Consulta{Tabela: "acessos_pessoas", Alias: "t",
	SQL: `select ` + colunasPessoa + `,
	  (select json_build_object('nome', s.nome) from acessos_setores s
	    where s.id = t.setor_id and {ler:acessos_setores:s}) as acessos_setores,
	  (select json_build_object('nome', o.nome) from acessos_organizacoes o
	    where o.id = t.organizacao_id and {ler:acessos_organizacoes:o}) as acessos_organizacoes,
	  (select json_build_object('nome', m.nome) from patrimonio_empresas m
	    where m.id = t.marca_id and {ler:patrimonio_empresas:m}) as patrimonio_empresas
	from acessos_pessoas t`,
	Filtros:     []dados.Filtro{{Param: "status", SQL: "t.status = @status::text", Tipo: "texto"}},
	OrdemPadrao: "t.nome", Desempate: "t.id"}

// POST /acessos/pessoas: o que a tela grava ao criar (tela-de-acessos.vue:1619) e o "criar cadastro"
// do Admin, já ligado ao login (tela-de-admin.vue:3212). Nasce 'ativo' (sem status no corpo).
type corpoPessoaNova struct {
	Nome               json.RawMessage `json:"nome,omitempty"`
	Cargo              json.RawMessage `json:"cargo,omitempty"`
	SetorID            json.RawMessage `json:"setor_id,omitempty"`
	OrganizacaoID      json.RawMessage `json:"organizacao_id,omitempty"`
	EmailCorporativo   json.RawMessage `json:"email_corporativo,omitempty"`
	EmailOutlook       json.RawMessage `json:"email_outlook,omitempty"`
	ContaApple         json.RawMessage `json:"conta_apple,omitempty"`
	NumeroCorporativo  json.RawMessage `json:"numero_corporativo,omitempty"`
	NumeroPessoal      json.RawMessage `json:"numero_pessoal,omitempty"`
	DataInicioContrato json.RawMessage `json:"data_inicio_contrato,omitempty"`
	ProfileID          json.RawMessage `json:"profile_id,omitempty"`
	AtualizadoEm       json.RawMessage `json:"atualizado_em,omitempty"`
}

func (c corpoPessoaNova) Validar() error {
	if emBranco(c.Nome) {
		return errors.New("Nome é obrigatório")
	}
	return nil
}

// PATCH /acessos/pessoas/{id}: a união das edições (ficha 1618, campo único 1783, desligar 1858,
// reativar 1891, Zoho 1964, e-mail do OneDrive 1279/2323; Frota 948/1005; lotação do Admin 3166).
// Fora: profile_id (só por POST …/ligar: decide pode_ver_bem, Ruling 5.4-7), avatar_url (o Plano 6
// grava junto com o arquivo, Ruling 5.4-12), id, criado_em — mandar = 400.
type corpoPessoa struct {
	Nome               json.RawMessage `json:"nome,omitempty"`
	Cargo              json.RawMessage `json:"cargo,omitempty"`
	Status             json.RawMessage `json:"status,omitempty"`
	SetorID            json.RawMessage `json:"setor_id,omitempty"`
	OrganizacaoID      json.RawMessage `json:"organizacao_id,omitempty"`
	MarcaID            json.RawMessage `json:"marca_id,omitempty"`
	EmailCorporativo   json.RawMessage `json:"email_corporativo,omitempty"`
	EmailOutlook       json.RawMessage `json:"email_outlook,omitempty"`
	ContaApple         json.RawMessage `json:"conta_apple,omitempty"`
	NumeroCorporativo  json.RawMessage `json:"numero_corporativo,omitempty"`
	NumeroPessoal      json.RawMessage `json:"numero_pessoal,omitempty"`
	DataInicioContrato json.RawMessage `json:"data_inicio_contrato,omitempty"`
	DataFimContrato    json.RawMessage `json:"data_fim_contrato,omitempty"`
	MotivoSaida        json.RawMessage `json:"motivo_saida,omitempty"`
	ZohoAccountID      json.RawMessage `json:"zoho_account_id,omitempty"`
	AtualizadoEm       json.RawMessage `json:"atualizado_em,omitempty"`
}

func (c corpoPessoa) Validar() error {
	if c.Nome != nil && emBranco(c.Nome) {
		return errors.New("Nome é obrigatório")
	}
	return nil
}

var tabelaPessoas = dados.Tabela{Nome: "acessos_pessoas", Resposta: colunasPessoa}

func montarPessoas(r chi.Router, p *pgxpool.Pool) {
	deve(consultaPessoas.Validar(autz.Producao))
	deve(tabelaPessoas.Validar(autz.Producao))
	r.Get("/acessos/pessoas", consultaPessoas.Handler(p, autz.Producao))
	r.With(soSessaoPropria).Post("/acessos/pessoas", dados.RotaCriar[corpoPessoaNova](p, autz.Producao, tabelaPessoas))
	r.With(soSessaoPropria).Patch("/acessos/pessoas/{id}", dados.RotaEditar[corpoPessoa](p, autz.Producao, tabelaPessoas))
}
```

Se a gramática do 5.0 recusar `json_build_object` na lista: use a forma do teste da gramática (`(select row_to_json(s) from acessos_setores s where … and {ler:…})`) — as três tabelas embutidas não têm coluna sensível e a regra é a mesma — e registre no relatório da task. Erros: setor/organização/marca inexistente → 409 (`23503`); `status` fora da lista → 400; tipo errado → 400.

**(b) Testes de aceitação** (`TestPessoas`, com `m.rodar`; "intacta"/"total igual" por `efeito`)
- Leitura: `acessos` GET → Ana, Bruno, Carla nessa ordem, com `"numero_pessoal":"11 90000-0001"` e `"acessos_setores":{"nome":"RH"}`; **embutido sob a regra da outra tabela:** `acessos` (não lê o Patrimônio) → `"patrimonio_empresas":null` e sem `Vessel`; `admin` (papel admin lê o Patrimônio) → `"patrimonio_empresas":{"nome":"Vessel"}`; `?status=ativo&contar=1&limite=1` → `X-Total-Count: 2`; `?nome=Ana` → 400; `?ordem=email` → 400. **Vazamento:** cada pessoa de `semAcessos` → `200 []` (nem `Ana` nem o telefone).
- Criar: `acessos` POST `{"nome":"Diego","email_corporativo":"diego@rbv.com","setor_id":S1}` → 201 com `"status":"ativo"` e `"profile_id":null`; `admin` POST `{"nome":"Eva","email_corporativo":"eva@x.com","profile_id":idViewer}` → 201 com o `profile_id`; `{"nome":"  "}` → 400 "Nome é obrigatório"; `"status":"desligado"`, `"id"`, `"criado_em"`, `"avatar_url"` → 400 `corpo_invalido`; `setor_id` inexistente → 409; total igual em todos os negados. `semAcessos` POST → 403 e `impersonado` → 403 com "Quem entrou como outra pessoa", total igual.
- Editar: `acessos` PATCH P1 `{"email_outlook":"ana@outlook.com","atualizado_em":"2026-10-12T10:00:00Z"}` → 200 e SÓ essas mudam (cargo e telefone iguais); desligar P3 `{"status":"desligado","motivo_saida":"Fim do contrato","data_fim_contrato":"2026-10-12"}` → 200; reativar `{"status":"ativo","motivo_saida":null,"data_fim_contrato":null}` → 200 com os dois nulos; `admin` lotação `{"marca_id":EMP}` → 200; `{"status":"inativo"}` → 400; `{"nome":null}` → 400; `{"profile_id":idViewer}` e `{"avatar_url":"https://x"}` → 400 `corpo_invalido`, elo intacto. **IDOR/vazamento:** cada `semAcessos` PATCH P1 `{"cargo":"x"}` → 404 e intacta; id inexistente e `nao-e-uuid` → 404; `impersonado` → 403 e intacta.
- Mutações que têm de reprovar: `ProfileID` em `corpoPessoa` (o PATCH do elo passa); trocar `{ler:patrimonio_empresas:m}` por `true` (a `Validar` recusa a declaração: `deve` derruba a montagem); tirar `soSessaoPropria` do POST.

**(c) Arquivos:** Create `api/internal/acessos/pessoas.go`, `api/internal/acessos/pessoas_test.go`.

**(d) Dependências:** Task 2; `dados.Consulta/Tabela/RotaCriar/RotaEditar`.

- [ ] **Step 1:** `pessoas_test.go` com os casos; `go test -count=1 -run TestPessoas ./internal/acessos/` → FAIL (`montarPessoas`).
- [ ] **Step 2:** Implementar `pessoas.go` (o contrato acima, imports `encoding/json`, `errors`, `chi`, `pgxpool`, `autz`, `dados`).
- [ ] **Step 3:** `gofmt -l ./internal && go vet ./internal/acessos/ && go test -count=1 -v -run TestPessoas ./internal/acessos/` → PASS; mutações reprovam.
- [ ] **Step 4:** Commit `feat(api): /acessos/pessoas com a regra de produção e embutidos sob a regra de cada tabela` (+ `Co-Authored-By`).

---

### Task 4: Ligar ficha ao login, excluir colaborador e trilha

**Revisor:** opus. **Depende de:** 3 (`tabelaPessoas`, `colunasPessoa`).

**(a) Contrato**
- `POST /acessos/pessoas/{id}/ligar` `{"profile_id":"<uuid>"}` → `200` com a ficha (Ruling 5.4-7). Numa transação: `PodeEditar` (trava a linha; ficha invisível = 404 sem dizer a quem está ligada) → conferência `profile_id is null or profile_id = @novo` → senão `409 conflito` "Este cadastro já foi ligado a outro login enquanto esta ficha estava aberta. Feche e abra de novo para ver como está agora." (a frase da tela-de-admin.vue:3192-3193) → `tabelaPessoas.Editar` com o MESMO mapa. Ligar de novo ao mesmo login = 200. `profile_id` ausente/vazio → 400 "Diga a conta de login."; não-uuid → 400. Atende tela-de-admin.vue:3190 e tela-de-frota.vue:829.
- `DELETE /acessos/pessoas/{id}` → `204` (Ruling 5.4-6): `PodeApagar` (404 invisível) → papel `admin` (senão `403 sem_permissao` "Só admin pode excluir.", a frase da tela-de-acessos.vue:2007) → `tabelaPessoas.Apagar`; a cascata é do banco (vínculos, termos, dispositivos; zera `pessoa_id` em bens, carros e histórico). Avatar e PDFs no Storage: Plano 6.
- `POST /acessos/log` `{acao, alvo?, resultado?, detalhe?}` → `201` com a linha; `quem` = sessão (`Autor`), `quando` = default (Ruling 5.4-8). `acao` em branco → 400; `resultado` fora de `ok|erro` → 400 (check; achado).

```go
var errFichaJaLigada = errors.New("acessos: a ficha já está ligada a outro login")
var errSoAdminExclui = errors.New("acessos: só admin exclui colaborador")

type pedidoLigar struct {
	ProfileID string `json:"profile_id"`
}

// ligarAoLogin: POST /acessos/pessoas/{id}/ligar. profile_id alimenta pode_ver_bem (autz.Escopo.Pessoas:
// "o bem está comigo") — é permissão de ver bens, por isso não passa pelo PATCH. Compare-and-set: ficha
// ligada a OUTRO login = 409, nunca sobrescrita (tela-de-admin.vue:3180-3187 já pedia isso ao banco).
func ligarAoLogin(p *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		e := autz.EscopoDo(r.Context())
		if e == nil {
			dados.Erro(w, http.StatusInternalServerError, "erro_interno", "")
			return
		}
		var in pedidoLigar
		if !dados.LerCorpo(w, r, &in) {
			return
		}
		if strings.TrimSpace(in.ProfileID) == "" {
			dados.Erro(w, http.StatusBadRequest, "pedido_invalido", "Diga a conta de login.")
			return
		}
		id, ctx := chi.URLParam(r, "id"), r.Context()
		mudanca := map[string]any{"profile_id": in.ProfileID} // o MESMO mapa vai ao PodeEditar e ao UPDATE
		var linha []byte
		err := banco.ComUsuario(ctx, p, e.ID, func(tx pgx.Tx) error {
			// PodeEditar ANTES da conferência: trava a linha (o segundo pedido espera aqui e depois enxerga
			// o elo do primeiro) e responde 404 para ficha invisível sem dizer se ela está ligada
			if err := autz.Producao.PodeEditar(ctx, tx, e, "acessos_pessoas", id, mudanca); err != nil {
				return err
			}
			var livre bool
			if err := tx.QueryRow(ctx, `select profile_id is null or profile_id = @novo::uuid
				from acessos_pessoas where id = @id::uuid`, pgx.NamedArgs{"novo": in.ProfileID, "id": id}).Scan(&livre); err != nil {
				return err
			}
			if !livre {
				return errFichaJaLigada
			}
			var err error
			linha, err = tabelaPessoas.Editar(ctx, tx, autz.Producao, e, id, mudanca)
			return err
		})
		switch {
		case errors.Is(err, errFichaJaLigada):
			dados.Erro(w, http.StatusConflict, "conflito",
				"Este cadastro já foi ligado a outro login enquanto esta ficha estava aberta. Feche e abra de novo para ver como está agora.")
		case err != nil:
			dados.ErroDeEscrita(w, err)
		default:
			dados.Responder(w, http.StatusOK, linha)
		}
	}
}

// excluirColaborador: DELETE /acessos/pessoas/{id}. Catálogo (is_acessos_admin) E papel admin: a tela só
// oferecia o botão a admin (tela-de-acessos.vue:2007) e a exclusão é definitiva e em cascata (Ruling 5.4-6).
func excluirColaborador(p *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		e := autz.EscopoDo(r.Context())
		if e == nil {
			dados.Erro(w, http.StatusInternalServerError, "erro_interno", "")
			return
		}
		id, ctx := chi.URLParam(r, "id"), r.Context()
		err := banco.ComUsuario(ctx, p, e.ID, func(tx pgx.Tx) error {
			if err := autz.Producao.PodeApagar(ctx, tx, e, "acessos_pessoas", id); err != nil {
				return err // invisível = 404, antes de dizer qualquer coisa sobre o papel
			}
			if e.Papel != "admin" {
				return errSoAdminExclui
			}
			return tabelaPessoas.Apagar(ctx, tx, autz.Producao, e, id)
		})
		switch {
		case errors.Is(err, errSoAdminExclui):
			dados.Erro(w, http.StatusForbidden, "sem_permissao", "Só admin pode excluir.")
		case err != nil:
			dados.ErroDeEscrita(w, err)
		default:
			w.WriteHeader(http.StatusNoContent)
		}
	}
}

const colunasLog = `t.id, t.quando, t.quem, t.acao, t.provedor, t.alvo, t.resultado, t.detalhe`

// POST /acessos/log (acessos_log_insert: is_acessos_admin()). quem = sessão (antes vinha do navegador,
// tela-de-acessos.vue:129); provedor é do proxy (Plano 6). Sem PATCH/DELETE: o catálogo não tem.
type corpoLog struct {
	Acao      json.RawMessage `json:"acao,omitempty"`
	Alvo      json.RawMessage `json:"alvo,omitempty"`
	Resultado json.RawMessage `json:"resultado,omitempty"`
	Detalhe   json.RawMessage `json:"detalhe,omitempty"`
}

func (c corpoLog) Validar() error {
	if emBranco(c.Acao) {
		return errors.New("Diga a ação.")
	}
	return nil
}

var tabelaLog = dados.Tabela{Nome: "acessos_log", Resposta: colunasLog, Autor: "quem"}

func montarAcoesDaPessoa(r chi.Router, p *pgxpool.Pool) {
	deve(tabelaLog.Validar(autz.Producao))
	r.With(soSessaoPropria).Post("/acessos/pessoas/{id}/ligar", ligarAoLogin(p))
	r.With(soSessaoPropria).Delete("/acessos/pessoas/{id}", excluirColaborador(p))
	r.With(soSessaoPropria).Post("/acessos/log", dados.RotaCriar[corpoLog](p, autz.Producao, tabelaLog))
}
```

**(b) Testes de aceitação**
- `TestLigarFichaAoLogin` (`m.rodar` + `autz.CarregarEscopo(ctx, m.p, idViewer)`): antes, o `Escopo` do `viewer` não tem P3; `acessos` liga P3 a `idViewer` → 200 com `"profile_id":"<idViewer>"` e o `Escopo` do `viewer` passa a ter P3 (o próximo pedido dele já vê os bens da Carla pelo Patrimônio); de novo ao mesmo login → 200; P3 a `idFrota` → 409 com "já foi ligado a outro login" e o elo continua `idViewer`; P1 (ligada a `idAcessos`) a `idViewer` → 409; `{}` → 400 "Diga a conta de login."; `{"profile_id":"x"}` → 400; `{"profile_id":…,"nome":"x"}` → 400 `corpo_invalido`; id inexistente → 404. **Vazamento/IDOR:** `frota` (o convite do dono, tela-de-frota.vue:829) e cada `semAcessos` → 404 e o elo intacto; `impersonado` → 403 e intacto.
- `TestLigarConcorrente` (código abaixo): `acessos` e `admin` ligando P3 a logins diferentes ao mesmo tempo → `{200, 409}` e o elo é um dos dois.
- `TestExcluirColaborador`: `acessos` (feature, papel viewer) DELETE P2 → 403 "Só admin pode excluir." e P2 + V2 intactos; cada `semAcessos` → 404 e intacto; `impersonado` → 403 e intacto; `admin` DELETE P2 → 204, P2 e V2 somem; de novo → 404; `admin` DELETE P1 → 204, T1 e V1 somem e o `Escopo` do `acessos` perde P1.
- `TestTrilha`: `acessos` POST `{"acao":"colaborador.editar","alvo":"colab:Ana","resultado":"ok","detalhe":null}` → 201 com `"quem":"<idAcessos>"`; `"quem":idAdmin` → 400 `corpo_invalido`; `"quando"` → 400; `"resultado":"parcial"` → 400; `{"acao":" "}` → 400; total igual nos negados; `semAcessos` → 403; `impersonado` → 403.
- Mutações que têm de reprovar: tirar a conferência `profile_id is null or …` (o 409 vira 200 e sobrescreve); conferência ANTES do `PodeEditar` (a corrida dá `{200, 200}` às vezes — rode `-count=20`); `e.Papel != "admin"` removido (o `acessos` apaga); `Autor: ""` em `tabelaLog` (`quem` sai nulo).

```go
// Dois admins ligando a MESMA ficha a logins diferentes: o PodeEditar trava a linha, o segundo enxerga o
// elo do primeiro e recebe 409 — nunca dois 200 com o segundo sobrescrevendo.
func TestLigarConcorrente(t *testing.T) {
	m := novoMundo(t, montarPessoas, montarAcoesDaPessoa)
	var st [2]int
	var wg sync.WaitGroup
	for i, x := range []struct{ quem, login string }{{"acessos", idViewer}, {"admin", idFrota}} {
		wg.Add(1)
		go func() {
			defer wg.Done()
			st[i] = m.resposta(t, x.quem, "POST", "/acessos/pessoas/"+P3+"/ligar", `{"profile_id":"`+x.login+`"}`).Code
		}()
	}
	wg.Wait()
	slices.Sort(st[:])
	if st != [2]int{200, 409} {
		t.Errorf("ligações simultâneas = %v, esperava [200 409]", st)
	}
	if v := m.um(t, `select coalesce(profile_id::text, '<nulo>') from acessos_pessoas where id = '`+P3+`'`); v != idViewer && v != idFrota {
		t.Errorf("elo = %s", v)
	}
}
```

**(c) Arquivos:** Create `api/internal/acessos/acoes.go`, `api/internal/acessos/acoes_test.go`.

**(d) Dependências:** Task 3; `autz.PodeEditar/PodeApagar/CarregarEscopo`, `banco.ComUsuario`, `dados.Tabela.Editar/Apagar`, `dados.RotaCriar`.

- [ ] **Step 1:** Testes; `go test -count=1 -run 'Ligar|Excluir|Trilha' ./internal/acessos/` → FAIL (`montarAcoesDaPessoa`).
- [ ] **Step 2:** Implementar `acoes.go` (imports `encoding/json`, `errors`, `net/http`, `strings`, `chi`, `pgx`, `pgxpool`, `autz`, `banco`, `dados`).
- [ ] **Step 3:** `gofmt -l ./internal && go vet ./internal/acessos/ && go test -count=1 -race -v -run 'Ligar|Excluir|Trilha' ./internal/acessos/` → PASS; `go test -count=20 -run TestLigarConcorrente ./internal/acessos/` → PASS; mutações reprovam.
- [ ] **Step 4:** Commit `feat(api): ligar ficha ao login com compare-and-set, excluir colaborador só por admin e trilha com autoria da sessão` (+ `Co-Authored-By`).

---

### Task 5: Estrutura — organizações e setores

**Revisor:** sonnet. **Depende de:** 2.

**(a) Contrato** (só declarações; `soSessaoPropria` em toda escrita; sem PATCH: nenhuma tela renomeia)

```go
const colunasOrganizacao = `t.id, t.nome, t.ordem, t.criado_em`
const colunasSetor = `t.id, t.nome, t.cor, t.ordem, t.criado_em, t.organizacao_id`

// GET /acessos/organizacoes (1339, 2242, 2606; Admin 3721 com ?ordem=nome) e GET /acessos/setores
// (1340, 2243, 2607; Admin 3722). Padrão = a ordem da tela (ordem, depois nome).
var consultaOrganizacoes = dados.Consulta{Tabela: "acessos_organizacoes", Alias: "t",
	SQL:    `select ` + colunasOrganizacao + ` from acessos_organizacoes t`,
	Ordens: map[string]string{"nome": "t.nome"}, OrdemPadrao: "t.ordem, t.nome", Desempate: "t.id"}
var consultaSetores = dados.Consulta{Tabela: "acessos_setores", Alias: "t",
	SQL:    `select ` + colunasSetor + ` from acessos_setores t`,
	Ordens: map[string]string{"nome": "t.nome"}, OrdemPadrao: "t.ordem, t.nome", Desempate: "t.id"}

// POST (1456; 1494). DELETE (1464; 1502): o banco zera organizacao_id/setor_id de setores, fichas e
// times (equipes.setor_id, FK de produção) — a tela já avisa "ficarão sem setor".
type corpoOrganizacao struct {
	Nome  json.RawMessage `json:"nome,omitempty"`
	Ordem json.RawMessage `json:"ordem,omitempty"`
}
type corpoSetor struct {
	Nome          json.RawMessage `json:"nome,omitempty"`
	Ordem         json.RawMessage `json:"ordem,omitempty"`
	OrganizacaoID json.RawMessage `json:"organizacao_id,omitempty"`
}

var errNome = errors.New("Nome é obrigatório")

func (c corpoOrganizacao) Validar() error {
	if emBranco(c.Nome) {
		return errNome
	}
	return nil
}

func (c corpoSetor) Validar() error {
	if emBranco(c.Nome) {
		return errNome
	}
	return nil
}

var tabelaOrganizacoes = dados.Tabela{Nome: "acessos_organizacoes", Resposta: colunasOrganizacao}
var tabelaSetores = dados.Tabela{Nome: "acessos_setores", Resposta: colunasSetor}

func montarEstrutura(r chi.Router, p *pgxpool.Pool) // GET + POST + DELETE {id} das duas (RotaCriar/RotaApagar); deve(…Validar)
```

**(b) Testes de aceitação** (`TestEstrutura`, `m.rodar`)
- Leitura: `acessos` GET organizações → Sede Centro antes de Fábrica; `?ordem=nome` → Fábrica antes; `?contar=1&limite=1` → `X-Total-Count: 2`; setores → RH antes de Comercial. **Vazamento:** `semAcessos` → `[]` nas duas.
- Criar: organização `{"nome":"Sede Village","ordem":3}` → 201; `{"nome":"Fábrica Conchal"}` → 409; `{"nome":""}` → 400; `"criado_em"` → 400; setor `{"nome":"RH","organizacao_id":O1}` → 409 e `{"nome":"RH","organizacao_id":O2}` → 201 (único por organização); `organizacao_id` inexistente → 409; total igual nos negados; `semAcessos` → 403; `impersonado` → 403.
- Apagar: `acessos` DELETE S2 → 204 e `equipes(EQ1).setor_id` nulo, P3 sem setor; DELETE O1 → 204, S1 e P1 sem organização. **IDOR:** `semAcessos` DELETE O2/S1 → 404 e intactos; id inexistente → 404; `impersonado` → 403.
- Mutação que tem de reprovar: `Validar` de `corpoSetor` removido (o `{"nome":""}` grava).

**(c) Arquivos:** Create `api/internal/acessos/estrutura.go`, `api/internal/acessos/estrutura_test.go`.

**(d) Dependências:** Task 2 (`emBranco`, `soSessaoPropria`, `deve`, mundo).

- [ ] **Step 1:** Testes; ver falhar. - [ ] **Step 2:** Implementar. - [ ] **Step 3:** gofmt/vet/test PASS; mutação reprova. - [ ] **Step 4:** Commit `feat(api): /acessos/organizacoes e /acessos/setores com a regra de produção` (+ `Co-Authored-By`).

---

### Task 6: Pastas, vínculos e termos (leituras + vínculo novo)

**Revisor:** sonnet. **Depende de:** 2.

**(a) Contrato** (só declarações; `soSessaoPropria` no POST)

```go
const colunasRecurso = `t.id, t.tipo, t.provedor, t.nome, t.external_id, t.drive_id, t.caminho, t.criado_em, ` +
	`t.arquivado_em, t.arquivado_motivo`

// GET /acessos/recursos: contagem por provedor (488: ?tipo=&arquivado=false&contar=1&limite=1), lista do
// console (522: ?tipo=&arquivado=false; iCloud com ?ordem=nome), provisionamento (1910) e Visão geral
// (2594). Gravar pasta é do proxy (Plano 6); a tela de pastas do iCloud não tem caminho (Ruling 5.4-10).
var consultaRecursos = dados.Consulta{Tabela: "acessos_recursos", Alias: "t",
	SQL: `select ` + colunasRecurso + ` from acessos_recursos t`,
	Filtros: []dados.Filtro{
		{Param: "tipo", SQL: "t.tipo = @tipo::text", Tipo: "texto"},
		{Param: "arquivado", SQL: "(t.arquivado_em is not null) = @arquivado::boolean", Tipo: "booleano"},
	},
	Ordens: map[string]string{"nome": "t.nome", "caminho": "t.caminho"}, OrdemPadrao: "t.caminho, t.nome", Desempate: "t.id"}

const colunasVinculo = `t.id, t.recurso_id, t.pessoa_id, t.papel, t.estado, t.observacao, t.criado_em, t.feito_em`

// GET /acessos/vinculos (669: ?recurso_id=; 1881: ?pessoa_id=; 2250: todos). O embutido acessos_recursos
// é o que a tela lê (nome, tipo, arquivado_em), sob a regra de Ler da tabela de pastas.
var consultaVinculos = dados.Consulta{Tabela: "acessos_vinculos", Alias: "t",
	SQL: `select ` + colunasVinculo + `,
	  (select json_build_object('nome', r.nome, 'tipo', r.tipo, 'arquivado_em', r.arquivado_em) from acessos_recursos r
	    where r.id = t.recurso_id and {ler:acessos_recursos:r}) as acessos_recursos
	from acessos_vinculos t`,
	Filtros: []dados.Filtro{
		{Param: "recurso_id", SQL: "t.recurso_id = @recurso_id::uuid", Tipo: "uuid"},
		{Param: "pessoa_id", SQL: "t.pessoa_id = @pessoa_id::uuid", Tipo: "uuid"},
	},
	OrdemPadrao: "t.criado_em", Desempate: "t.id"}

// POST /acessos/vinculos: o provisionamento do iCloud (1984). Sem PATCH/DELETE: os sítios que os usavam
// estão na tela sem caminho (Ruling 5.4-10). Sem único (recurso, pessoa), como em produção.
type corpoVinculo struct {
	RecursoID json.RawMessage `json:"recurso_id,omitempty"`
	PessoaID  json.RawMessage `json:"pessoa_id,omitempty"`
	Papel     json.RawMessage `json:"papel,omitempty"`
	Estado    json.RawMessage `json:"estado,omitempty"`
}

var tabelaVinculos = dados.Tabela{Nome: "acessos_vinculos", Resposta: colunasVinculo}

const colunasTermo = `t.id, t.pessoa_id, t.titulo, t.arquivo_path, t.enviado_em, t.observacao`

// GET /acessos/termos (1821: ?pessoa_id=&contar=1&limite=1; 2173: ?pessoa_id=). Enviar, baixar e
// apagar termo mexem no arquivo: Plano 6, com a linha (Ruling 5.4-12).
var consultaTermos = dados.Consulta{Tabela: "acessos_termos", Alias: "t",
	SQL:     `select ` + colunasTermo + ` from acessos_termos t`,
	Filtros: []dados.Filtro{{Param: "pessoa_id", SQL: "t.pessoa_id = @pessoa_id::uuid", Tipo: "uuid"}},
	OrdemPadrao: "t.enviado_em desc", Desempate: "t.id"}

func montarPastas(r chi.Router, p *pgxpool.Pool) // 3 GET + POST /acessos/vinculos (RotaCriar) com soSessaoPropria; deve(…Validar)
```

(Mesma ressalva da Task 3 sobre `json_build_object` na gramática.)

**(b) Testes de aceitação** (`TestPastasVinculosETermos`, `m.rodar`)
- Recursos: `?tipo=icloud&arquivado=false&ordem=nome` → R1 sem R3; `?tipo=workdrive&arquivado=false&contar=1&limite=1` → `X-Total-Count: 1`; sem filtro → R2 (`/RBV/Contratos`) e os iCloud; `?arquivado=talvez` → 400.
- Vínculos: `?recurso_id=R1` → V1 com `"acessos_recursos":{"nome":"Fotos da loja","tipo":"icloud","arquivado_em":null}`; `?pessoa_id=P2` → V2 com `"tipo":"workdrive"`; `?pessoa_id=x` → 400. POST `{"recurso_id":R1,"pessoa_id":P3,"papel":"edicao","estado":"pendente"}` → 201; `"papel":"admin"` → 400; recurso inexistente → 409; `"criado_em"` → 400; total igual nos negados.
- Termos: `?pessoa_id=P1` → T1 (`"arquivo_path":"<P1>/1760000000000-termo.pdf"`); `?pessoa_id=P3&contar=1&limite=1` → `X-Total-Count: 0`.
- **Vazamento:** `semAcessos` → `[]` nas três leituras e 403 no POST, total igual; `impersonado` POST → 403.
- Mutação que tem de reprovar: o embutido sem `{ler:acessos_recursos:r}` (a `Validar` recusa: `deve` derruba a montagem).

**(c) Arquivos:** Create `api/internal/acessos/pastas.go`, `api/internal/acessos/pastas_test.go`.

**(d) Dependências:** Task 2.

- [ ] **Step 1:** Testes; ver falhar. - [ ] **Step 2:** Implementar. - [ ] **Step 3:** gofmt/vet/test PASS; mutação reprova. - [ ] **Step 4:** Commit `feat(api): leituras de pastas, vínculos e termos e o vínculo novo do provisionamento` (+ `Co-Authored-By`).

---

### Task 7: Montagem, varreduras (impersonado, vazamento, segredos), `conferir` e notas

**Revisor:** opus. **Depende de:** 3–6.

**(a) Contrato**
- `acessos.Montar(r chi.Router, p *pgxpool.Pool)` chama `montarPessoas, montarAcoesDaPessoa, montarEstrutura, montarPastas`.
- `web/rotas.go`: no grupo de domínio (com `autz.ComEscopo`), depois das montagens do 5.1/5.2 (e do 5.3, se já mesclado), `acessos.Montar(r, p) // Plano 5.4`.
- `web/rotas_test.go`: `soSessao` ganha as 16 rotas (comentário: "portão = catálogo, provado pela matriz de cada rota em `internal/acessos`; vazamento, impersonado e segredos por `TestNadaVazaParaQuemNaoTemAcessos`, `TestEscritasRecusamImpersonado` e `TestConexoesNuncaSaem`"); `TestAcessosPelaMontagemReal`.
- `cmd/api/conferir.go` e `NOTAS-DA-IMPLANTACAO.md` (abaixo).

**(b) Testes de aceitação**
- `TestEscritasRecusamImpersonado`, `TestNadaVazaParaQuemNaoTemAcessos`, `TestConexoesNuncaSaem` (`acessos/rotas_test.go`, código abaixo): percorrem TODAS as rotas de `Montar` com `chi.Walk`; exatamente 6 leituras e 10 escritas; foto do banco igual onde nada podia mudar; nenhum `SEGREDO-` (nem o telefone da Ana) em resposta ou log; `Validar` recusa declaração que leia `acessos_conexoes`.
- `TestNenhumaRotaNovaFicaAberta` (existente) passa com `soSessao` atualizado.
- `TestAcessosPelaMontagemReal` (`web/rotas_test.go`, no molde de `TestAcessoPelaMontagemReal` do 5.1: `testebanco.ComEsquemaDeProducao` + `usuarios`/`profiles` de uma pessoa `{acessos}` e de uma `viewer`): `GET /acessos/pessoas` sem sessão → 401; `viewer` → `200 []`; `acessos` `POST /acessos/pessoas {"nome":"Teste"}` → 201; `viewer` `PATCH` dessa ficha → 404 e intacta; `acessos` `DELETE` dela → 403 (papel viewer).

```go
package acessos

import (
	"bytes"
	"log/slog"
	"net/http"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/rbv-co/social-dashboard/api/internal/autz"
	"github.com/rbv-co/social-dashboard/api/internal/dados"
)

// Um pedido de escrita por rota de Montar e o status de quem NÃO tem Colaboradores e Acessos: criar =
// 403, linha existente = 404. Rota de escrita nova sem entrada aqui faz as varreduras falharem.
type escrita struct {
	id, corpo string
	status    int
}

var escritas = map[string]escrita{
	"POST /acessos/pessoas":            {"", `{"nome":"Intruso"}`, 403},
	"PATCH /acessos/pessoas/{id}":      {P1, `{"cargo":"x"}`, 404},
	"DELETE /acessos/pessoas/{id}":     {P1, ``, 404},
	"POST /acessos/pessoas/{id}/ligar": {P3, `{"profile_id":"` + idViewer + `"}`, 404},
	"POST /acessos/log":                {"", `{"acao":"x"}`, 403},
	"POST /acessos/organizacoes":       {"", `{"nome":"Intrusa"}`, 403},
	"DELETE /acessos/organizacoes/{id}": {O1, ``, 404},
	"POST /acessos/setores":            {"", `{"nome":"Intruso"}`, 403},
	"DELETE /acessos/setores/{id}":     {S1, ``, 404},
	"POST /acessos/vinculos":           {"", `{"recurso_id":"` + R1 + `","pessoa_id":"` + P3 + `","papel":"leitura","estado":"pendente"}`, 403},
}

// varrer chama `f` para cada rota de Montar, com o caminho já preenchido e o corpo de `escritas`.
func varrer(t *testing.T, m *mundo, f func(metodo, rota, caminho, corpo string)) (leituras, gravacoes int) {
	t.Helper()
	err := chi.Walk(m.h.(chi.Routes), func(metodo, rota string, _ http.Handler, _ ...func(http.Handler) http.Handler) error {
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
		f(metodo, rota, strings.ReplaceAll(rota, "{id}", e.id), e.corpo)
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	return leituras, gravacoes
}

// Toda escrita recusa a sessão de "entrar como", sem tocar no banco (Ruling 5.4-5).
func TestEscritasRecusamImpersonado(t *testing.T) {
	m := novoMundo(t, Montar)
	antes := m.um(t, fotoDosAcessos)
	_, n := varrer(t, m, func(metodo, rota, caminho, corpo string) {
		if metodo == http.MethodGet {
			return
		}
		if st, b := m.pedir(t, "impersonado", metodo, caminho, corpo); st != http.StatusForbidden || !strings.Contains(b, "Quem entrou como outra pessoa") {
			t.Errorf("%s %s como impersonado = %d %s", metodo, rota, st, b)
		}
	})
	if n != 10 {
		t.Errorf("escritas = %d, esperava 10 (rota de escrita nova? ponha soSessaoPropria e um caso em `escritas`)", n)
	}
	if depois := m.um(t, fotoDosAcessos); depois != antes {
		t.Error("o impersonado mudou o banco")
	}
}

// Quem não tem Colaboradores e Acessos (super pela ficha, super por e-mail, só Frota, só Patrimônio,
// ninguém) não lê nem grava NADA, pelo handler real; a conta desativada (com a feature) nem passa da
// sessão: 401 em toda rota; banco intacto.
func TestNadaVazaParaQuemNaoTemAcessos(t *testing.T) {
	m := novoMundo(t, Montar)
	antes := m.um(t, fotoDosAcessos)
	for _, quem := range semAcessos {
		l, g := varrer(t, m, func(metodo, rota, caminho, corpo string) {
			st, b := m.pedir(t, quem, metodo, caminho, corpo)
			if metodo == http.MethodGet {
				if st != http.StatusOK || strings.TrimSpace(b) != "[]" {
					t.Errorf("%s GET %s = %d %s; esperava 200 []", quem, rota, st, b)
				}
				return
			}
			if quer := escritas[metodo+" "+rota].status; st != quer {
				t.Errorf("%s %s %s = %d %s; esperava %d", quem, metodo, rota, st, b, quer)
			}
		})
		if l != 6 || g != 10 {
			t.Errorf("rotas = %d leituras e %d escritas, esperava 6 e 10", l, g)
		}
	}
	varrer(t, m, func(metodo, rota, caminho, corpo string) {
		if st, b := m.pedir(t, "desativado", metodo, caminho, corpo); st != http.StatusUnauthorized {
			t.Errorf("desativado %s %s = %d %s; esperava 401", metodo, rota, st, b)
		}
	})
	if depois := m.um(t, fotoDosAcessos); depois != antes {
		t.Error("quem não tem Colaboradores e Acessos mudou o banco")
	}
}

// Os segredos de acessos_conexoes (Plano 6) nunca saem por este pacote: a tabela está fora do catálogo
// (em produção: RLS sem policy), nenhuma declaração a lê, e nenhuma resposta nem linha de log de
// NENHUMA rota de Montar — de quem pode tudo, com corpos válidos e inválidos — traz um deles. Quando o
// Plano 6 montar o proxy aqui, esta varredura passa a cobri-lo sozinha.
func TestConexoesNuncaSaem(t *testing.T) {
	if _, err := autz.Producao.Filtro(&autz.Escopo{}, "acessos_conexoes", autz.Ler, "c"); err == nil {
		t.Fatal("acessos_conexoes entrou no catálogo: reveja o Ruling 5.4-11 antes de qualquer rota")
	}
	for nome, c := range map[string]dados.Consulta{
		"principal": {Tabela: "acessos_conexoes", Alias: "t", SQL: `select t.provedor from acessos_conexoes t`,
			OrdemPadrao: "t.provedor", Desempate: "t.provedor"},
		"embutida com marcador": {Tabela: "acessos_pessoas", Alias: "t", OrdemPadrao: "t.nome", Desempate: "t.id",
			SQL: `select t.id, (select c.refresh_token from acessos_conexoes c where c.provedor = 'zoho' and {ler:acessos_conexoes:c}) as x from acessos_pessoas t`},
		"embutida sem marcador": {Tabela: "acessos_pessoas", Alias: "t", OrdemPadrao: "t.nome", Desempate: "t.id",
			SQL: `select t.id, (select c.refresh_token from acessos_conexoes c where c.provedor = 'zoho') as x from acessos_pessoas t`},
	} {
		if err := c.Validar(autz.Producao); err == nil {
			t.Errorf("%s: Validar aceitou ler acessos_conexoes", nome)
		}
	}
	if err := (dados.Tabela{Nome: "acessos_conexoes", Resposta: "t.provedor"}).Validar(autz.Producao); err == nil {
		t.Error("Tabela aceitou gravar acessos_conexoes")
	}

	m := novoMundo(t, Montar)
	var log bytes.Buffer
	anterior := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(&log, &slog.HandlerOptions{Level: slog.LevelDebug})))
	defer slog.SetDefault(anterior)
	for _, quem := range []string{"admin", "acessos", "impersonado"} {
		varrer(t, m, func(metodo, rota, caminho, corpo string) {
			for _, c := range []string{corpo, `{"lixo":`} { // o corpo do caso e um quebrado (caminho de erro)
				if _, b := m.pedir(t, quem, metodo, caminho, c); strings.Contains(b, "SEGREDO") {
					t.Errorf("%s %s %s devolveu segredo: %s", quem, metodo, rota, b)
				}
			}
		})
	}
	if s := log.String(); strings.Contains(s, "SEGREDO") || strings.Contains(s, telefoneDaAna) {
		t.Errorf("segredo ou dado pessoal no log:\n%s", s)
	}
	if v := m.um(t, `select count(*)::text from acessos_conexoes where client_secret like 'SEGREDO-%' and refresh_token like 'SEGREDO-%'`); v != "2" {
		t.Errorf("as conexões mudaram: %s", v)
	}
}
```

**(c) Arquivos:** Create `api/internal/acessos/rotas.go`, `api/internal/acessos/rotas_test.go`; Modify `api/internal/web/rotas.go`, `api/internal/web/rotas_test.go`, `api/cmd/api/conferir.go`, `docs/migracao-go/NOTAS-DA-IMPLANTACAO.md`.

**(d) Dependências:** Tasks 3–6; `web.Rotas` (5.0).

- [ ] **Step 1: Testes que falham.** `acessos/rotas_test.go` (acima); em `web/rotas_test.go`, as 16 entradas de `soSessao` (`"GET /acessos/pessoas"`, `"POST /acessos/pessoas"`, `"PATCH /acessos/pessoas/{id}"`, `"DELETE /acessos/pessoas/{id}"`, `"POST /acessos/pessoas/{id}/ligar"`, `"POST /acessos/log"`, `"GET /acessos/organizacoes"`, `"POST /acessos/organizacoes"`, `"DELETE /acessos/organizacoes/{id}"`, `"GET /acessos/setores"`, `"POST /acessos/setores"`, `"DELETE /acessos/setores/{id}"`, `"GET /acessos/recursos"`, `"GET /acessos/vinculos"`, `"POST /acessos/vinculos"`, `"GET /acessos/termos"`) e `TestAcessosPelaMontagemReal`. Run: `go test -count=1 ./internal/acessos/ ./internal/web/` → FAIL (`Montar` não existe).
- [ ] **Step 2: Implementar.** `acessos/rotas.go`:

```go
package acessos

import (
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Montar registra as rotas do 5.4 no grupo de DOMÍNIO de web.Rotas (depois de auth.Exigir e de
// autz.ComEscopo). Declaração errada derruba a subida (deve). O Plano 6 acrescenta aqui o proxy do
// Zoho/Microsoft e as rotas de arquivo; as varreduras de rotas_test.go passam a cobri-los.
func Montar(r chi.Router, p *pgxpool.Pool) {
	montarPessoas(r, p)
	montarAcoesDaPessoa(r, p)
	montarEstrutura(r, p)
	montarPastas(r, p)
}
```

`web/rotas.go`: `acessos.Montar(r, p) // Plano 5.4` no grupo de domínio.

`cmd/api/conferir.go` (troque a linha existente da mesma tabela — a 5.1 pode ter `acessos_pessoas` mínima — e acrescente as novas):

```go
// colunasDoWorker
"acessos_pessoas":      "id,nome,cargo,status,criado_em,atualizado_em,setor_id,email_corporativo,numero_pessoal,numero_corporativo,data_inicio_contrato,data_fim_contrato,motivo_saida,avatar_url,zoho_account_id,email_outlook,conta_apple,organizacao_id,profile_id,marca_id",
"acessos_organizacoes": "id,nome,ordem,criado_em",
"acessos_setores":      "id,nome,cor,ordem,criado_em,organizacao_id",
"acessos_recursos":     "id,tipo,provedor,nome,external_id,drive_id,caminho,criado_em,arquivado_em,arquivado_motivo",
"acessos_vinculos":     "id,recurso_id,pessoa_id,papel,estado,observacao,criado_em,feito_em",
"acessos_termos":       "id,pessoa_id,titulo,arquivo_path,enviado_em,observacao",
"acessos_log":          "id,quando,quem,acao,provedor,alvo,resultado,detalhe",

// tiposDoWorker (filtros e a conferência do "ligar" com cast; o elo que o Escopo lê)
"acessos_pessoas.id": "uuid", "acessos_pessoas.profile_id": "uuid", "acessos_pessoas.status": "text",
"acessos_vinculos.recurso_id": "uuid", "acessos_vinculos.pessoa_id": "uuid", "acessos_termos.pessoa_id": "uuid",
"acessos_recursos.tipo": "text", "acessos_recursos.arquivado_em": "timestamp with time zone", "acessos_log.quem": "uuid",

// unicosDoWorker (os 409 de organização e setor dependem destes únicos completos)
"acessos_organizacoes(nome)", "acessos_setores(organizacao_id,nome)",
```

Em `NOTAS-DA-IMPLANTACAO.md`, acrescente ao fim:

```markdown
## Plano 5.4 — Colaboradores e Acessos (cadastro)

### Rotas novas (com sessão; regra = catálogo de produção, `is_acessos_admin()`; escrita de sessão "entrar como" = 403)
- `/acessos/pessoas` (GET com os embutidos de setor, organização e marca; POST; PATCH `{id}`; DELETE `{id}` só papel admin; POST `{id}/ligar`), `POST /acessos/log`, `/acessos/organizacoes` e `/acessos/setores` (GET, POST, DELETE `{id}`), `GET /acessos/recursos`, `/acessos/vinculos` (GET, POST), `GET /acessos/termos`.
- Nenhuma rota lê ou grava `acessos_conexoes` (Plano 6).

### Mudanças de contrato que o Plano 7 absorve
- O elo ficha↔login sai do PATCH: `POST /acessos/pessoas/{id}/ligar {profile_id}` (tela-de-admin.vue:3190, tela-de-frota.vue:829); ficha já ligada a OUTRO login = `409` (a Frota passa a mostrar a pendência que já tem em vez de sobrescrever).
- Excluir colaborador: `DELETE /acessos/pessoas/{id}`; quem não é admin recebe `403 "Só admin pode excluir."`.
- `quem` sai do corpo da trilha (`POST /acessos/log`); `resultado` só `ok`/`erro` (o `parcial` da 1980 vira `erro` ou espera decisão do dono).
- PATCH de pessoa sem `profile_id` nem `avatar_url` (a foto é gravada pela rota de arquivo do Plano 6).
- Contagens com `contar=1&limite=1` (`X-Total-Count`); os embutidos chegam com as mesmas chaves (`acessos_setores`, `acessos_organizacoes`, `patrimonio_empresas`, `acessos_recursos`).
- 15 sítios em código sem caminho na tela (aba Drive antiga, tela de pastas do iCloud, tela antiga do WorkDrive) não ganham rota: apagar o código.

### Achados para o dono
- Excluir colaborador: só o navegador barrava quem não é admin; pela API do Supabase quem tinha só a feature `acessos` apagava (em cascata). A API fecha.
- Quem tem a feature `acessos` liga qualquer ficha a qualquer login, inclusive o próprio, e com isso passa a ver no Patrimônio os bens que estão com aquela pessoa (`pode_ver_bem`). Mantido; correção de uma linha: exigir papel admin no `ligar`, como no excluir.
- A trilha nunca gravou o `parcial` do provisionamento do OneDrive (tela-de-acessos.vue:1980): o banco só aceita `ok`/`erro` e a tela engole o erro.
- `quem` da trilha vinha do navegador (falsificável); agora é a sessão.
- Super-admin sem a feature `acessos` (pela ficha ou por e-mail) não vê colaboradores — nem na lista de usuários do Admin, que lê `acessos_pessoas` (como hoje).

### Antes do corte
- `api worker conferir` no banco restaurado: colunas, tipos e únicos de `acessos_*`; `acessos_pessoas.profile_id` é `uuid` (presumido: sem DDL no repositório).
- `select count(*) from pg_trigger g join pg_class c on c.oid = g.tgrelid where not g.tgisinternal and c.relname like 'acessos\_%'` = 0 no banco restaurado (premissa do D0).
- `acessos_conexoes` continua sem policy e fora do catálogo; a cópia dos segredos para o servidor novo é do Plano 6.
```

Rode `gofmt -w ./internal ./cmd`.
- [ ] **Step 3: Rodar e ver passar.** `gofmt -l . && go vet ./... && go test -count=1 -race ./... 2>&1 | grep -v goose | grep -E '^(ok|FAIL|---)'` → todos `ok`. Mutações que têm de reprovar: tirar `soSessaoPropria` de UMA escrita qualquer (varredura do impersonado acusa); acrescentar uma escrita de mentira em `Montar` sem caso em `escritas` (as varreduras acusam); uma rota de teste em `Montar` que responda `select refresh_token from acessos_conexoes` por `p.QueryRow` (a varredura de segredos acusa); montar `acessos.Montar` FORA do grupo com `ComEscopo` (as rotas respondem 500).
- [ ] **Step 4: Commit.** `git add api/internal/acessos/rotas.go api/internal/acessos/rotas_test.go api/internal/web/ api/cmd/api/conferir.go docs/migracao-go/NOTAS-DA-IMPLANTACAO.md` e `git commit -m "feat(api): monta as rotas de Colaboradores e Acessos, varreduras de impersonado, vazamento e segredos, conferir e notas"` (+ `Co-Authored-By`).

---

### Verificação final do 5.4

- [ ] `docker stop pg-plano54` e `make -C api teste PG_PORTA=58539` → todos `ok` (não junto com o gate do 5.3).
- [ ] Subir o `pg-plano54` de novo e `cd api && go test -count=1 -v ./... 2>&1 | grep -c -- '--- SKIP'` → `0`.
- [ ] `cd api && gofmt -l . && go vet ./...` → nada.
- [ ] `git diff feat/api-go-plano-5-2 --stat -- src/ supabase/ coletor/` → vazio (o front troca no Plano 7).
- [ ] `grep -rn 'acessos_conexoes' api/internal --include='*.go' | grep -v _test.go` → nada.
- [ ] `docker stop pg-plano54`.
- [ ] Revisão final do branch por opus com foco em: o `ligar` (conferência depois do `PodeEditar`? algum caminho grava `profile_id` sem ele?), o excluir (404 antes do 403?), os embutidos (alguma tabela lida sem `{ler:}`, alguma coluna fora da lista?), as varreduras (alguma rota escapa?) e a fatia D0 (algum check/FK diverge das migrations).

---

## O que é 5.4 e o que é Plano 6

| Assunto | 5.4 (este plano) | Plano 6 |
|---|---|---|
| Cadastro: pessoas, organizações, setores, vínculo novo, trilha; leituras de pastas, vínculos e termos | as 16 rotas | reusa `tabelaPessoas`/`tabelaLog`/`consultaRecursos` deste pacote quando grava |
| `acessos_conexoes` (`client_secret`, `refresh_token`, `oauth_state`) | DDL no D0 e a prova de que nada daqui a alcança (`TestConexoesNuncaSaem`) | Todo o acesso, com lista fechada de colunas: estado (só `{connected, org_id, conectado_em}`, como a edge), `authUrl` (grava `oauth_state` de uso único com prazo), callback (confere o `state`, grava `refresh_token`, `conectado_por` = sessão), leitura dos segredos só dentro do servidor para chamar Zoho/Graph. Portão `autz.AcessosAdmin` com sessão própria (não "entrar como"); nada disso em log, erro ou resposta |
| `acessos-proxy` (tela-de-acessos.vue:134; 34 chamadas `_acProxy`, 26 ações `zoho.*`/`microsoft.*`) e `acessos-oauth` | — | tudo, montado em `acessos.Montar` (as varreduras o cobrem) |
| Escritas que o proxy faz no banco: `acessos_pessoas` (`zoho.import`, foto), `acessos_recursos` (`importarPastas`, `addFolder`, `removeFolder`), `acessos_log` (com `provedor`); leitura de `acessos_drive_marcas` (Auditoria do OneDrive) | — | pelo caminho declarado (`dados.Tabela`, `PodeX` em `banco.ComUsuario`) |
| Storage `acessos-avatars` (1998, 2010; grava `avatar_url`, 2001) e `acessos-termos` (2206-2224: envio = arquivo + linha em `acessos_termos`; baixar = URL assinada; apagar = arquivo + linha) | só `GET /acessos/termos` | tudo; o caminho do arquivo é gerado no servidor |
| `DELETE /acessos/pessoas/{id}` | apaga a linha (cascata no banco) | acrescenta a remoção do avatar e dos PDFs dos termos |
| `enviar-pdf-checklist` (lê `acessos_recursos` e `acessos_pessoas`) | — | o robô, com identidade (5.3, NOTAS) |

## Inventário: sítios do front a trocar (Plano 7)

`grep` em `src/` (fora de `*.test.*` e `src/demonstracao/`) em 2026-10-12: **65 literais** nas tabelas do 5.4 (`acessos_pessoas` 23, `acessos_recursos` 8, `acessos_vinculos` 8, `acessos_organizacoes` 6, `acessos_setores` 6, `acessos_termos` 6, `acessos_drive_setores` 3, `acessos_drive_overrides` 2, `acessos_drive_marcas` 2, `acessos_log` 1) — 55 em `tela-de-acessos.vue`, 6 no Admin, 4 na Frota. Deles: **45 vivos → rotas do 5.4**, **5 → Plano 6** (arquivo + metadado), **15 em código sem caminho → apagar** (Ruling 5.4-10). `acessos_dispositivos`, `acessos_config`, `acessos_patrimonio_historico`: **0**. `.rpc`: **0**.

Abreviações: `ac` = `src/ferramentas/acessos/tela-de-acessos.vue`; `admin` = `src/ferramentas/admin/tela-de-admin.vue`; `frota` = `src/ferramentas/frota/tela-de-frota.vue`.

| Rota | Sítios | Qtde |
|---|---|---|
| `GET /acessos/pessoas` | ac:1341, 2244, 2564 (`?status=ativo&contar=1&limite=1`), 2565 (`?status=desligado&contar=1&limite=1`), 2578 (`?status=ativo`); frota:1070; admin:3672 | 7 |
| `POST /acessos/pessoas` | ac:1619; admin:3212 | 2 |
| `PATCH /acessos/pessoas/{id}` | ac:1279, 1618, 1783, 1858, 1891, 1964, 2323; frota:948, 1005; admin:3166 | 10 |
| `POST /acessos/pessoas/{id}/ligar` | admin:3190; frota:829 | 2 |
| `DELETE /acessos/pessoas/{id}` | ac:2011 | 1 |
| `POST /acessos/log` | ac:129 | 1 |
| `GET` / `POST` / `DELETE /acessos/organizacoes` | ac:1339, 2242, 2606 (`?contar=1&limite=1`); admin:3721 (`?ordem=nome`) / ac:1456 / ac:1464 | 6 |
| `GET` / `POST` / `DELETE /acessos/setores` | ac:1340, 2243, 2607 (`?contar=1&limite=1`); admin:3722 (`?ordem=nome`) / ac:1494 / ac:1502 | 6 |
| `GET /acessos/recursos` | ac:488 (`?tipo=&arquivado=false&contar=1&limite=1`), 522 (`?tipo=&arquivado=false`; iCloud `&ordem=nome`), 1910 (`?tipo=icloud&arquivado=false&ordem=nome`), 2594 (`?arquivado=false`) | 4 |
| `GET` / `POST /acessos/vinculos` | ac:669 (`?recurso_id=`), 1881 (`?pessoa_id=`), 2250 / ac:1984 | 4 |
| `GET /acessos/termos` | ac:1821 (`?pessoa_id=&contar=1&limite=1`), 2173 (`?pessoa_id=`) | 2 |

**Plano 6 (arquivo + metadado):** ac:2001 (`avatar_url` depois do upload), 2208 (linha do termo depois do upload), 2214 e 2222 (`arquivo_path` para o Storage), 2224 (apagar termo com o arquivo).

**Sem caminho na tela (apagar; Ruling 5.4-10):** aba Drive antiga (`_acDrivePaintShell` não tem chamador): ac:1093, 1101, 1104, 1110, 1112, 1247, 1255; tela de pastas do iCloud (`_acOpenICloud` não tem chamador e `_acRender` não tem a aba `icloud`): ac:229, 244, 250, 262, 281, 287, 293; tela antiga do WorkDrive (`_acRenderWorkdrive` não tem chamador): ac:369.

Na mesma tela, de OUTROS planos (não trocar pelo 5.4): **5.2** — `patrimonio_bens` ac:1819 (`?pessoa_id=&contar=1&limite=1`), 2075 (`?pessoa_id=` com categoria, local e cômodo embutidos), 2248; **5.3** — `GET /frota/veiculos` ac:1820 (`?pessoa_id=&contar=1&limite=1`), 2078 (`?pessoa_id=`), 2249; **Plano 6** — Storage ac:1998, 2010, 2206, 2209, 2216, 2223 e o proxy ac:134.

## Paralelização

- **Uma worktree por tarefa paralela** (merge na ordem dos números). As Tasks 2–7 são o MESMO pacote Go (`acessos`): na mesma worktree, só em sequência (arquivo pela metade de uma quebra a compilação da outra). Cada task só toca os seus dois arquivos; a 7 é a única que toca `web/`, `conferir.go` e as notas. Um contêiner (`pg-plano54`, porta 58539) atende todas: cada teste cria o próprio banco.
- **Onda 1:** Task 1. **Onda 2:** Task 2. **Onda 3:** Tasks 3, 5 e 6 — três em paralelo (os ajudantes comuns — `soSessaoPropria`, `deve`, `emBranco`, o mundo — são da Task 2). **Onda 4:** Task 4 (precisa de `tabelaPessoas`, da 3). **Onda 5:** Task 7.
- **Com o 5.3 (execução em paralelo):** pacotes disjuntos (`frota` × `acessos`); fatias D0 disjuntas (`01-tabelas-5-3.sql` × `01-tabelas-5-4.sql`; o 5.4 não toca `gerar-gatilhos.mjs` nem `02-gatilhos.sql`); nenhum teste de um depende de tabela do outro (o mundo do 5.4 não cria nada de `frota_*`). Em comum só os arquivos de fronteira das Tasks finais (`web/rotas.go`, `web/rotas_test.go`, `cmd/api/conferir.go`, `NOTAS-DA-IMPLANTACAO.md`): conflito mecânico de listas — quem mescla por último junta as duas e roda o gate. Os gates (`make teste`, contêiner fixo `pg-api-teste`) nunca ao mesmo tempo.

## Rulings do 5.4

1. Ruling: D0 = fatia RECONSTRUÍDA `01-tabelas-5-4.sql` (12 `acessos_*` + `acessos_conexoes` das migrations, fonte por bloco), com `acessos_pessoas` COMPLETADA por `alter` (nasce mínima na 5.1 porque as fatias 5.2/5.3 a referenciam por FK e carregam antes) e a FK `equipes.setor_id` que a 5.1 deixou para cá; nenhum gatilho em `acessos_*` em produção, então `02-gatilhos.sql` e o gerador não mudam — fica disjunto do 5.3, que mexe nos dois; o `pg_dump` do ensaio (Ruling 29 do mestre) troca a fatia depois pelo mesmo carregador — custo se errada: coluna, check ou FK de produção fora das migrations (`profile_id` é presumido) só aparece no `api worker conferir` do banco restaurado.
2. Ruling: as `acessos_*` são declaradas UMA vez, nesta fatia (só `acessos_pessoas` mínima fica na 5.1); declaração ou coluna de `acessos_*` feita por outra fatia (o 5.2 precisa de setores e de colunas de pessoa para testar as RPCs de cadastro rápido) sai de lá e vem para cá — `create table`/`add column` repetido derruba o carregador e duas versões divergem em silêncio; o carregador lê todos os arquivos em todo teste — custo se errada: nenhum.
3. Ruling: pacote novo `internal/acessos` (plural), separado do `acesso` do 5.1, e o Plano 6 põe o proxy e as rotas de arquivo NESTE pacote — o 5.1 é de contas de login; este é o cadastro de colaboradores, e o proxy grava as mesmas tabelas: no mesmo pacote ele reusa `tabelaPessoas`/`tabelaLog`/`consultaRecursos` sem exportá-las e as varreduras o cobrem sozinhas — custo se errada: dois pacotes de nome vizinho (o comentário de pacote diz qual é qual).
4. Ruling: permissão = catálogo nas 13 tabelas (`is_acessos_admin()`: conta ativa e papel `admin` ou feature `acessos`); super-admin sem a feature (pela ficha ou por e-mail) não vê, e papel `admin` vê — "mesmas permissões de hoje"; a única divergência é o excluir (5.4-6) — custo se errada: o super-admin continua precisando da feature para ver colaboradores, como hoje (achado nas NOTAS).
5. Ruling: sessão de "entrar como" só LÊ no cadastro: as 10 escritas respondem 403 — a trilha (`quem`) e o elo ficha↔login sairiam no nome do ALVO; estende o Ruling 18 do mestre, o 5.1-4 e o 5.3-5 — custo se errada: o super-admin sai da sessão impersonada para cadastrar.
6. Ruling: excluir colaborador exige papel `admin` além do catálogo, e a checagem do papel vem DEPOIS do `PodeApagar` (invisível = 404) — a tela só oferece o botão a admin (tela-de-acessos.vue:2007), a exclusão é definitiva e em cascata (vínculos, termos, dispositivos; zera o responsável de bens e carros), e pelo PostgREST quem tinha só a feature apagava por fora da tela; fecha a porta lateral como o 5.3-11 fechou a da reserva — custo se errada: quem tem só a feature e apagava pela API direta deixa de apagar (a tela já não deixava).
7. Ruling: o elo ficha↔login (`profile_id`) é uma ação própria, `POST /acessos/pessoas/{id}/ligar`, com compare-and-set na transação (`PodeEditar` trava; ligada a outro login = 409; ao mesmo = 200); o PATCH o recusa; criar já ligado (Admin) continua; desligar o elo não tem rota — `profile_id` é o que `pode_ver_bem` lê ("o bem está comigo"), então mudar o elo muda o que um login vê no Patrimônio, e a tela do Admin já pedia ao banco "só se ainda estiver solto" (tela-de-admin.vue:3180-3187); o convite do dono na Frota (829) sobrescrevia em silêncio — custo se errada: a Frota passa a receber 409 numa ficha já ligada a outro login e mostra a pendência que já tem; desligar um elo errado é SQL até alguém pedir a rota.
8. Ruling: autoria da sessão — `acessos_log.quem` por `Tabela.Autor` (recusado no corpo); `quando`, `criado_em`, `enviado_em` são defaults; `atualizado_em` e `feito_em` continuam vindo do corpo (não são autoria, e as `acessos_*` não têm gatilho que os carimbe) — pela API, `quem` vindo do navegador seria falsificável por qualquer um com a feature — custo se errada: as linhas de trilha antigas continuam com o `quem` que o navegador mandou.
9. Ruling: embutidos (`acessos_setores`, `acessos_organizacoes`, `patrimonio_empresas` na leitura de pessoas; `acessos_recursos` na de vínculos) = subconsulta na lista com `{ler:<tabela>:<alias>}` e colunas FECHADAS por `json_build_object`, com o nome que a tela já lê (IV.1 do mestre) — mesma semântica do embutido do PostgREST sob RLS (quem não lê a tabela recebe `null`) e nenhuma coluna a mais — custo se errada: se a gramática recusar `json_build_object`, `row_to_json(<alias>)` devolve as colunas inteiras dessas três tabelas sem segredo (ressalva nas Tasks 3 e 6).
10. Ruling: código sem caminho na tela não ganha rota — a aba Drive antiga (`_acDrivePaintShell`, 7 sítios em `acessos_drive_*`), a tela de pastas do iCloud (`_acOpenICloud`/`_acRenderICloud`, 7 sítios: criar/apagar pasta, listar/editar/apagar vínculo) e a tela antiga do WorkDrive (`_acRenderWorkdrive`, 1) não têm chamador (o roteador `_acRender` só tem `geral`/`org`/`drive`/`auditoria`/`config`); `acessos_dispositivos`, `acessos_config` e `acessos_patrimonio_historico` têm 0 sítios; o `autz` nega o que não tem rota (5.1-5, 5.3-12) — rota para código morto é superfície sem dono — custo se errada: se o dono quiser uma dessas telas de volta, são ~3 declarações por tabela.
11. Ruling: `acessos_conexoes` fica fora do 5.4 — está fora do catálogo (RLS ligada SEM policy: só a chave de serviço), nenhuma tela a lê, e todo uso dela (estado, `authUrl`, callback, segredos para chamar Zoho/Graph) é do proxy e do OAuth, que o mestre manda para o Plano 6; aqui ela entra no D0 e uma varredura com segredos plantados prova que nenhuma rota, declaração ou log do pacote a alcança, e o contrato que o Plano 6 cumpre está na seção "O que é 5.4 e o que é Plano 6" — um módulo só tocando a tabela dos segredos é o desenho mais fácil de auditar — custo se errada: o estado da conexão na tela de Configurações espera o Plano 6 (hoje já vem do proxy).
12. Ruling: o que só existe por causa de um arquivo é do Plano 6 junto com o arquivo — gravar e apagar `acessos_termos`, ler `arquivo_path` para o Storage e gravar `avatar_url` (o PATCH recusa `avatar_url`); o 5.4 só LÊ os termos — hoje são 3 passos com compensação na mão (upload, linha, remove se a linha falhar) e o caminho vem do navegador; no Plano 6 é uma rota com o caminho gerado no servidor — custo se errada: entre o 5.4 e o Plano 6 não há rota para enviar termo nem foto (o front só troca no Plano 7, depois dos dois).
13. Ruling: leituras = um recurso por tabela com a UNIÃO das colunas, filtros e embutidos que as telas usam (5.1-6, 5.3-14), contagens por `contar=1&limite=1`, ordem padrão = a da tela (`t.ordem, t.nome`; `t.caminho, t.nome`) — a regra é a mesma para todas — custo se errada: a tela recebe colunas que não usa (as que o PostgREST já entregava a ela).
14. Ruling: o mundo de teste é próprio (`acessos/mundo_test.go`), com a cópia das ~45 linhas genéricas do mundo do 5.1, salvo se o 5.2 já as tiver extraído para `testebanco` (pré-voo) — as pessoas e linhas são outras e o 5.3 roda em paralelo: extrair aqui criaria conflito — custo se errada: ~45 linhas de teste duplicadas até a extração.

## Cobertura da spec e o que vem depois

**As 13 tabelas da linha 5.4 (14 policies, nenhuma restritiva) e a dos segredos:**

| Tabela | Destino |
|---|---|
| `acessos_pessoas` | Tasks 3 e 4 (leitura com embutidos, cadastro, elo com o login, exclusão por admin) |
| `acessos_log` | Task 4 (inserção com `quem` da sessão; sem leitura no front; sem PATCH/DELETE no catálogo) |
| `acessos_organizacoes`, `acessos_setores` | Task 5 (+ FK de `equipes.setor_id`) |
| `acessos_recursos`, `acessos_vinculos`, `acessos_termos` | Task 6 (leituras; vínculo novo); escritas de pasta e de termo: Plano 6 (5.4-11, 5.4-12) |
| `acessos_drive_marcas`, `acessos_drive_setores`, `acessos_drive_overrides` | sem rota (5.4-10); o proxy lê as marcas (Plano 6) |
| `acessos_dispositivos`, `acessos_config`, `acessos_patrimonio_historico` | sem rota (0 sítios; 5.4-10); só D0, pela cascata |
| `acessos_conexoes` (fora do catálogo) | sem rota (5.4-11); D0 e `TestConexoesNuncaSaem`; Plano 6 |

RPC: nenhuma (`.rpc` = 0 na tela de Acessos; as 4 de cadastro rápido que leem `acessos_*` por dentro são do 5.2); `web.FuncoesRPC` e `web.RPCPendentes` não mudam. Gatilhos: 0 nas `acessos_*`.

Spec §5 (catálogo, IDOR, ator × operação × recurso — inclusive o embutido sob a regra de outra tabela), §11 (autoria da sessão, impersonação sem escrita, segredo fora de resposta e de log, porta lateral do PostgREST fechada no excluir), §13 (concorrência no elo ficha↔login testada).

**O que vem depois:**
- **Plano 6:** proxy e OAuth (`acessos-proxy`, `acessos-oauth`: 26 ações) em `acessos.Montar`, `acessos_conexoes` com o contrato da seção acima, Storage de avatar e termos (com as linhas), remoção dos arquivos ao excluir colaborador, e o robô do PDF do checklist.
- **Plano 7:** os 45 sítios da tabela acima (o elo e a exclusão mudam de forma), os 15 sítios de código sem caminho apagados, os 5 do Plano 6 e os de 5.2/5.3 na mesma tela.
- **5.2:** a tela de Acessos lê `GET /patrimonio/bens?pessoa_id=` (com `contar` e os embutidos de categoria, local e cômodo) — se o plano do 5.2 não a tiver, é pendência dele.
- O mundo de teste é interno ao pacote `acessos`; a extração para `testebanco` fica para o próximo pacote que precisar dele.
