# Sair do Supabase — Plano 5.3: Frota

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **Execute na worktree `p5-53`** (branch `feat/api-go-plano-5-3`, empilhada sobre `feat/api-go-plano-5-1`; antes da Task 1 ela recebe o 5.2 EXECUTADO, que já traz 5.0 e 5.1). Faça `git add` só dos caminhos de cada task. Este plano contrata sobre as **interfaces** do 5.0, do 5.1 e do 5.2 (escritas nos planos deles), não sobre o código: o pré-voo confere que elas existem com esses nomes.

**Goal:** Trocar as 58 leituras e escritas diretas do front nas 14 tabelas `frota_*` e nas 2 RPCs da Frota por 27 rotas da API em Go (+2 nomes no `/rpc`) que decidem com as MESMAS regras das 28 policies de produção, com os 12 gatilhos de produção (aceite imutável, ficha assinada imutável, aprovação/cancelamento/arquivamento de reserva, histórico, filas de PDF, espelho no Patrimônio, posse órfã) vendo quem pede — e com retirada concorrente e troca de posse decididas por constraint e transação.

**Architecture:** As rotas moram no pacote `internal/frota`, que já tem o push da frota e `POST /avisar-decisao-de-reserva` (Plano 4, reusado sem mudança), montadas no grupo de domínio do 5.0 (`auth.Exigir` → `autz.ComEscopo`). Leitura = `dados.Consulta` (regra de Ler do catálogo no `WHERE`, gramática permitida). Escrita = o caminho declarado do 5.1 (`dados.Tabela` + `RotaCriar/RotaEditar/RotaApagar`: o MESMO mapa de colunas vai ao `PodeX` e ao `INSERT/UPDATE`, na MESMA transação de `banco.ComUsuario`). As três escritas compostas (ficha + respostas + assinatura; manutenção + trocas; fechar posse + abrir posse + parar o carro) são handlers próprios que chamam `Tabela.Criar/Editar` linha a linha numa transação só. Testes contra a fatia 5.3 do esquema de produção (D0): tabelas das migrations, funções e gatilhos verbatim do levantamento.

**Tech Stack:** Go 1.26 (`go.mod`), `chi`, `pgx` v5, Postgres 17 (contêiner), Node 22 (só o gerador de gatilhos).

**Spec:** `docs/superpowers/specs/2026-10-09-sair-do-supabase-design.md` (§5 autorização, §6 funções do banco, §11 segurança, §13 testes) e o plano-mestre `docs/superpowers/plans/2026-10-11-api-go-plano-5-dominios.md` (§II contrato, IV.1 regras de sub-plano, linha 5.3 da IV.2, Rulings 1–36). Modelo e interfaces: `docs/superpowers/plans/2026-10-12-api-go-plano-5-1-admin-equipes-acesso.md`. Especificação das permissões: `docs/migracao-go/catalogo-policies-producao.json` (28 policies `frota_*`, todas `is_frota_admin()`; `frota_req_criar` = `is_frota_admin() AND criada_por = auth.uid()`; `frota_requisicoes` sem policy de DELETE; `frota_requisicoes_historico` só SELECT).

## Global Constraints

- Nada em produção: sem `ssh`, sem credencial real, sem `push`. Postgres local descartável; segredos de teste inventados.
- Regra de cada tabela = a do catálogo (`autz.Producao`), nunca reescrita à mão; regra dos gatilhos e das RPCs = o corpo de produção (verbatim do levantamento). Divergência só por Ruling deste plano.
- Negar por padrão. Todo portão tem o lado negado assertado **com o efeito** (contagem/linha conferida no banco depois).
- IDOR e vazamento: lista negada = `200 []`; escrita em linha invisível = `404`; `403` só para criar ou para linha visível. **Toda rota ganha teste de vazamento com pessoa restrita pelo handler real** (mundo com a cadeia `auth.Exigir` → `autz.ComEscopo`).
- **Mapa de escrita da MESMA struct que monta o INSERT/UPDATE:** colunas = tags `json` de uma struct de `json.RawMessage` (`dados.Campos`); o mapa que vai ao `PodeX` é o que vai ao SQL (`dados.Tabela`). Nenhum SQL de escrita à mão nas rotas (a única consulta própria de escrita é a conferência de posse da Task 4, depois do `PodeEditar`).
- **`PodeX` na MESMA transação de `banco.ComUsuario` que grava** (os gatilhos leem `auth.uid()`; o `PodeEditar` trava a linha `for update`). `PodeCriar` exige toda coluna lida pela regra como chave do mapa (`criada_por` das reservas vem por `Tabela.Autor`).
- Autoria vem da sessão (`criada_por`, `criado_por`, `assinada_por`), nunca do corpo (mandar = `400 corpo_invalido`). Campos que entram na impressão digital da ficha (`assinada_em`, hodômetro, respostas…) vêm do corpo: são o que foi assinado.
- Sessão de "entrar como" só LÊ na Frota: toda escrita = `403` sem efeito (Ruling 5.3-5).
- Leitura declarada só com a GRAMÁTICA permitida do 5.0 (`select <colunas> from <tabela> t`, sem junção nem subconsulta); toda condição de filtro entre parênteses é o `dados` que põe.
- SQL: todo parâmetro com cast explícito; nada do pedido no texto do SQL.
- Sem dependência nova; `go.mod` fica em `go 1.26.0`.
- Gate: `make -C api teste PG_PORTA=58538` com `--- SKIP` = 0; `gofmt -l` e `go vet` limpos. O alvo `teste` usa o contêiner de nome fixo `pg-api-teste`: não rode o gate junto com outra worktree.
- Commits terminam com `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>` (o modelo que implementa). Código, comentários e mensagens em português com acentuação; frases de gatilho e de tela ficam como estão.
- `go` roda em `api/`; `git` e `node` na raiz da worktree.

## Review Focus

1. **Duas pessoas pegando o mesmo carro ao mesmo tempo** (retirada) **e duas trocas de posse fechando a mesma posse** → exatamente um sucesso e um `409`; uma linha aberta por carro; nenhuma posse órfã nem fechada duas vezes. Teste: `TestRetiradaETrocaConcorrentes` (Task 4).
2. **Quem tem a Frota sem a feature `frota.aprovar` aprovando, cancelando, arquivando ou editando o conteúdo de uma reserva** → `400 regra_de_negocio` com a frase do gatilho, reserva e histórico intactos; com a feature, `decidida_por`/`encerrada_por`/`arquivada_por` e o histórico = quem pediu. Teste: `TestReservas` (Task 5).
3. **Pessoa sem a Frota** (papel admin, só `frota.aprovar`, só Patrimônio, ninguém) **em QUALQUER rota** → `200 []`/`403`/`404`; conta desativada com a feature `frota` → `401` (o `auth.Exigir` não aceita a sessão dela); banco intacto. Teste: `TestNadaVazaParaQuemNaoTemFrota` (Task 10), que percorre TODAS as rotas.
4. **Checklist com segunda ficha no mesmo dia, resposta inválida no meio ou `assinada_por` no corpo** → `409`/`400` e NADA gravado (sem ficha órfã, sem resposta solta); a assinada sai com `assinada_por` = sessão e na fila do PDF. Teste: `TestChecklistNumaGravacaoSo` (Task 6).
5. **Sessão de "entrar como" em toda escrita** (aceite e assinatura no nome do alvo seriam fraude; os gatilhos carimbariam o alvo) → `403` sem efeito. Teste: `TestEscritasRecusamImpersonado` (Task 10).

---

## Interfaces que este plano consome

(Dos planos 5.0, 5.1 e 5.2; o pré-voo confere cada uma.)

- **5.0** — `dados`: `Consulta{Tabela, Alias, SQL, Onde; Filtros []Filtro; Ordens map[string]string; OrdemPadrao, Desempate string}` com `Validar(cat)`/`Handler(b, cat)`; `Filtro{Param, SQL, Tipo}` (tipos `texto|uuid|inteiro|data|instante|booleano`, sufixo `[]`); `LerCorpo` (recusa campo não declarado, 1 MiB), `Erro`, `ErroDoBanco` (RAISE nosso — `P0001`, `23514`, `22023`… com `pe.Where` terminando em ` at RAISE` — passa a frase: `400 regra_de_negocio`; `23505`/`23503` = `409`; outros `22*`/`23*` = `400 pedido_invalido`), `ErroDeEscrita`. `autz`: `Producao`, `EscopoDo`, `ComEscopo`, `FrotaAdmin`, `PatrimonioAdmin`, `(*Catalogo).PodeCriar/PodeEditar/PodeApagar`, `ErrNegado`, `ErrNaoEncontrado`. `auth`: `Ator{ID, ImpersonadorID}`, `AtorDoContexto`, `NoContexto`, `Exigir`, `NovoStore`, `(*Store).Criar(ctx, id, tipo, impersonadorID)`. `banco.ComUsuario`. `rpc`: `Funcao{Nome, Params, Retorno, Portao}`, `Param{Nome, Tipo, Opcional}`, `Valor`/`Conjunto`, `Novo(p, fs...)` (recusa nome proibido). `web`: `FuncoesRPC`, `RPCPendentes`, grupo de domínio de `web.Rotas`, mapas `publicas`/`soSessao` em `rotas_test.go`.
- **5.1** — `testebanco.ComEsquemaDeProducao(t)` (banco novo com compat + migrações + `esquema/*.sql` em ordem de nome); `esquema/01-tabelas-5-1.sql` (`profiles` com `features`, `acessos_pessoas` mínima: `id, nome, profile_id, email_corporativo`); `esquema/gerar-gatilhos.mjs`. `dados.Tabela{Nome, Resposta, Autor}` com `Validar`, `Criar(ctx, tx, cat, e, campos) ([]byte, error)`, `Editar(ctx, tx, cat, e, id, campos) ([]byte, error)`, `Apagar(ctx, tx, cat, e, id) error`; `dados.Campos(corpo) (map[string]any, error)`; `RotaCriar[C]`/`RotaEditar[C]` (id de `chi.URLParam(r, "id")`, `C.Validar()` se existir, `{}` = 400)/`RotaApagar`; `dados.Responder`. Rotas `GET /acesso/usuarios` e `PATCH /acesso/usuarios/{id}` (a tela da Frota as usa no convite do dono).
- **5.2** — `esquema/01-tabelas-5-2.sql` com `patrimonio_bens` (pelo menos `id, numero, nome, categoria_id, pessoa_id, situacao, atualizado_em, marca, valor_centavos`), `patrimonio_categorias (id, nome)`, `patrimonio_empresas`, `patrimonio_locais`, `patrimonio_comodos` (`id`) e os gatilhos de `patrimonio_bens` gerados; as RPCs `pessoas_para_escolher`, `setores_para_escolher`, `criar_pessoa_rapida`, `criar_setor_rapido`, `sincronizar_carro_e_bem` em `web.FuncoesRPC`; as leituras de `patrimonio_*` (com `pode_ver_bem`) que a tela da Frota troca no Plano 7.
- **Plano 4** — pacote `internal/frota` (`PushFrota`, `Reserva`; nomes de topo já usados: `responder`, `obj`, `deref`, `dia`, `carga`, `veiculo`, `Item`, `Config`, `Pessoa`, `Usuario`, `Requisicao`, `Aviso`; nos testes: `ambienteFrota`, `ligarAviso`, `montarReserva`, `sp`, `tabelasFrota`, `u*`/`p*`/`v*`/`reqID`). `POST /avisar-decisao-de-reserva` atrás de `auth.ExigirPermissao("frota.aprovar", "ver")`.

## Pré-voo (antes da Task 1)

- [ ] `cd /Users/gabrielgertrudes/Projetos/Trabalho/lavessel/social-dashboard/.claude/worktrees/p5-53 && git status --short && git branch --show-current` → vazio (ou só este plano); `feat/api-go-plano-5-3`.
- [ ] Trazer o 5.2 executado (com 5.0 e 5.1): `git merge --no-edit feat/api-go-plano-5-2`. Conferir:
  ```bash
  grep -c 'func ComEsquemaDeProducao' api/internal/testebanco/esquema.go                            # 1
  grep -c 'func (t Tabela) Criar\|func (t Tabela) Editar\|func RotaCriar\|func Campos' api/internal/dados/escrita.go  # 4
  grep -c 'func raiseNosso' api/internal/dados/dados.go                                              # 1
  grep -c 'func (c \*Catalogo) PodeEditar' api/internal/autz/escrita.go                              # 1
  grep -n 'etiqueta_quem_e\|frota_corrente_do_veiculo' api/internal/web/*.go                         # nas pendentes (RPCPendentes)
  grep -c 'create table public.patrimonio_bens\|create table public.patrimonio_categorias\|create table public.patrimonio_empresas\|create table public.patrimonio_locais\|create table public.patrimonio_comodos' api/internal/testebanco/esquema/01-tabelas-5-2.sql   # 5
  sed -n '/create table public.patrimonio_bens/,/^);/p' api/internal/testebanco/esquema/01-tabelas-5-2.sql
  grep -n 'create table public.frota_' api/internal/testebanco/esquema/01-tabelas-5-*.sql              # vazio (ou: Ruling 5.3-2)
  grep -n 'condicoes\|avulsas' api/internal/testebanco/esquema/gerar-gatilhos.mjs                     # o 5.2 já mexeu no gerador?
  grep -ln 'func NovoMundo\|type Caso struct' api/internal/testebanco/*.go                           # o 5.2 extraiu o mundo do 5.1?
  ```
  Qualquer `0` nas cinco primeiras ou na dos `patrimonio_*`: a dependência não terminou — **pare e reporte**. Nome diferente só de campo/função: use o real em todo o plano. Semântica diferente (ex.: `Tabela.Criar` sem `PodeCriar`): **pare e reporte**.
  - `patrimonio_bens` sem `pessoa_id`, `situacao` ou `atualizado_em` (os gatilhos da Frota gravam as três): acrescente-as em `01-tabelas-5-3.sql` com `alter table public.patrimonio_bens add column if not exists …` e a fonte (`db/migrations/acessos/042_frota_patrimonio_situacao.sql`, `043_frota_patrimonio_responsavel.sql`). Coluna `NOT NULL` sem default além de `id, numero, nome, categoria_id, situacao`: acrescente-a com um valor válido nos inserts de `patrimonio_bens` das Tasks 1 e 2.
  - Tabela `frota_*` declarada numa fatia anterior: apague essa declaração mínima de lá (Ruling 5.3-2) no commit da Task 1.
  - Gerador já com mecanismo de condições/funções avulsas (5.2): use-o e acrescente só as entradas da Frota; os passos 2–3 da Task 1 viram "acrescente as entradas".
  - Mundo já extraído para `testebanco` (5.2): use-o no lugar das funções genéricas de `mundo_test.go` (Task 2), mesma semântica.
- [ ] `go version` → `go1.26`+; `node --version` → `v22`+.
- [ ] Levantamento (fonte do gerador, fora do git):
  ```bash
  L=/Users/gabrielgertrudes/Projetos/Trabalho/lavessel/social-dashboard/.claude/worktrees/levantamento-ro/docs/migracao-go/levantamento
  test -f "$L/02-funções.csv" && test -f "$L/03-triggers.csv" && echo ok
  ```
- [ ] Docker no ar, porta livre (`lsof -iTCP:58538 -sTCP:LISTEN` → vazio) e o banco das etapas:
  ```bash
  docker run -d --rm --name pg-plano53 -e POSTGRES_PASSWORD=x -p 127.0.0.1:58538:5432 postgres:17
  until docker exec pg-plano53 pg_isready -h 127.0.0.1 -U postgres >/dev/null 2>&1; do sleep 1; done
  export TEST_DATABASE_URL='postgres://postgres:x@localhost:58538/postgres?sslmode=disable'
  ```
- [ ] Linha de base: `cd api && go test ./... && go test -v ./... 2>&1 | grep -c -- '--- SKIP'` → tudo `ok` e `0`.

## Estrutura de arquivos

```
api/internal/testebanco/esquema/01-tabelas-5-3.sql            # DDL das 14 tabelas frota_* (fonte por bloco)
api/internal/testebanco/esquema/condicoes-dos-gatilhos.json   # UPDATE OF / WHEN das migrations (o CSV não traz)
api/internal/testebanco/esquema/funcoes-avulsas-5-3.txt       # RPCs da Frota que nenhum gatilho chama
api/internal/testebanco/esquema/gerar-gatilhos.mjs            # + condições e funções avulsas
api/internal/testebanco/esquema/02-gatilhos.sql               # REGERADO
api/internal/testebanco/esquema_frota_test.go                 # os 12 gatilhos disparam com a identidade da transação
api/internal/frota/dominio.go          (+ _test)              # soSessaoPropria, deve, naLinha, idDaLinha
api/internal/frota/mundo_test.go                              # pessoas, linhas, sessões, cadeia Exigir → ComEscopo
api/internal/frota/veiculos.go         (+ _test)              # /frota/veiculos
api/internal/frota/usos.go             (+ _test)              # /frota/usos, POST /frota/usos/trocar
api/internal/frota/requisicoes.go      (+ _test)              # /frota/requisicoes
api/internal/frota/checklists.go       (+ _test)              # /frota/checklists, /respostas, /copias
api/internal/frota/configuracao.go     (+ _test)              # /frota/checklist-itens, /frota/checklist-config, /frota/plano-revisao
api/internal/frota/manutencoes.go      (+ _test)              # POST /frota/manutencoes, /frota/revisoes, /frota/abastecimentos
api/internal/frota/rpc.go              (+ _test)              # FuncoesRPC: etiqueta_quem_e, frota_corrente_do_veiculo
api/internal/frota/rotas.go            (+ rotas_test.go)      # Montar; varreduras do impersonado e do vazamento
api/internal/web/rotas.go, rotas_test.go                      # montagem, FuncoesRPC, soSessao, montagem real
api/cmd/api/conferir.go                                       # colunas, tipos, únicos e funções que as rotas presumem
docs/migracao-go/NOTAS-DA-IMPLANTACAO.md                      # seção do 5.3
```

## Tarefas

| # | Task | Revisor | Depende de |
|---|---|---|---|
| 1 | D0: fatia 5.3 do esquema (tabelas `frota_*`, 12 gatilhos verbatim com condições, RPCs) | **opus** (dados: é contra isto que tudo é provado) | 5.1 T1, 5.2 (fatia) |
| 2 | `frota`: fundação (mundo de teste, portão de impersonado, ajudantes) | **opus** (autorização) | 1, 5.1 T2 |
| 3 | Veículos | **opus** (dados: espelho no Patrimônio, posse órfã) | 2 |
| 4 | Uso: retirada, devolução e troca de posse numa transação | **opus** (concorrência, aceite) | 2, 3 |
| 5 | Reservas (requisições) | **opus** (`criada_por`, aprovação por gatilho) | 2 |
| 6 | Checklist numa gravação só e leituras das fichas | **opus** (assinatura, imutabilidade) | 2 |
| 7 | Itens e dias do checklist; plano de revisão | sonnet | 2 |
| 8 | Manutenções, revisões e abastecimentos | **opus** (dinheiro) | 2 |
| 9 | RPCs da Frota | **opus** (portões) | 2 |
| 10 | Montagem, varreduras (impersonado e vazamento), `conferir` e notas | **opus** (fronteira) | 3–9 |

---

### Task 1: D0 — fatia 5.3 do esquema de produção nos testes

**Revisor:** opus. **Depende de:** Task 1 do 5.1 (carregador e gerador), fatia do 5.2.

**(a) Contrato**
- `esquema/01-tabelas-5-3.sql`: as 14 tabelas `frota_*` com colunas, tipos, defaults, checks e índices únicos das migrations citadas, na ordem em que as colunas entraram; FKs de `auth.users` → `public.usuarios`. São declaradas SÓ aqui (Ruling 5.3-2).
- `esquema/condicoes-dos-gatilhos.json`: `{"<tabela>.<gatilho>": {"eventos"?: "...", "quando"?: "...", "fonte": "arquivo:linhas"}}` — o `03-triggers.csv` não traz `UPDATE OF` nem `WHEN`; sem o `WHEN (old.assinada_em is not null)` o gatilho de imutabilidade recusaria TODA edição de ficha, a assinatura inclusive. Chave que não casa com gatilho gerado = o gerador sai com erro.
- `esquema/funcoes-avulsas-*.txt`: um nome por linha (`#` comenta), semente extra do fechamento de funções (RPCs que nenhum gatilho chama). Nome fora do CSV = erro.
- `02-gatilhos.sql` regerado: os 12 gatilhos das `frota_*` (19 linhas de `03-triggers.csv:7-25`) e, entre as funções, estas 16 (algumas podem já vir do 5.2): `etiqueta_quem_e, frota_aceite_imutavel, frota_checar_arquivamento, frota_checar_decisao, frota_checklist_enfileirar_pdf, frota_checklist_imutavel, frota_corrente_do_veiculo, frota_espelha_responsavel_no_bem, frota_espelha_situacao_no_bem, frota_fechar_posse_orfa, frota_gravar_historico, frota_resposta_imutavel, frota_uso_enfileirar_pdf, is_patrimonio_admin, pode_aprovar_frota, situacao_do_bem_pelo_veiculo`.

**(b) Testes de aceitação** (`TestFatiaDaFrotaComOsGatilhosVerbatim`, código abaixo)
- Os gatilhos das `frota_*` são exatamente os 12; os 6 com condição mostram no `pg_get_triggerdef` o `UPDATE OF`/`WHEN` das migrations.
- Aceite: sem identidade → `23514` e nada gravado; com identidade → `aceite_por` = quem gravou e `aceite_em` = agora (o valor do pedido é ignorado), +1 em `frota_uso_pdf`; depois de assinado, mudar `aceite_nome` → `23514`.
- Ficha: editável sem assinatura; assinar enfileira o PDF; assinada → `update`/`delete`/resposta nova/resposta alterada = `P0001` e nada muda.
- Reserva: motorista sem `frota.aprovar` aprovando → `23514` "permissão para aprovar"; sem identidade → `23514`; motorista mudando o destino → `23514`; nada muda e histórico vazio. Aprovador aprovando e mudando o destino → `decidida_por` = ele e duas linhas no histórico com `quem` = ele; cancelar sem motivo → `23514`; arquivar aprovada não vencida → `23514`.
- Veículo: `situacao = 'inativo'` → bem `em_estoque`; tirar o dono fixo → posse aberta fechada; dono novo → `patrimonio_bens.pessoa_id`.

**(c) Arquivos:** Create `api/internal/testebanco/esquema/01-tabelas-5-3.sql`, `api/internal/testebanco/esquema/condicoes-dos-gatilhos.json`, `api/internal/testebanco/esquema/funcoes-avulsas-5-3.txt`, `api/internal/testebanco/esquema_frota_test.go`; Modify `api/internal/testebanco/esquema/gerar-gatilhos.mjs`, `api/internal/testebanco/esquema/02-gatilhos.sql` (regerado).

**(d) Dependências:** `testebanco.ComEsquemaDeProducao`, `banco.ComUsuario`; levantamento local; `01-tabelas-5-1.sql` (`usuarios` pelas migrações, `profiles`, `acessos_pessoas`) e `01-tabelas-5-2.sql` (`patrimonio_*`).

- [ ] **Step 1: A DDL.** Crie `api/internal/testebanco/esquema/01-tabelas-5-3.sql`:

```sql
-- FATIA 5.3 (Frota) do esquema de produção para os testes (D0 reconstruído: Rulings 5.1-1 e 5.3-1).
-- Carregada depois de 01-tabelas-5-1.sql e 01-tabelas-5-2.sql (ordem do nome): usa public.usuarios
-- (migrações da API), acessos_pessoas (5.1, mínima) e patrimonio_bens/_empresas/_locais/_comodos (5.2).
-- Colunas na ORDEM em que as migrations as criaram; FKs de auth.users viram public.usuarios, como no
-- dump limpo (ops/migracao/limpar-dump.mjs:64). As 14 tabelas frota_* são declaradas SÓ aqui (Ruling 5.3-2).
-- Os gatilhos e as funções vêm verbatim do levantamento (02-gatilhos.sql, gerado).

-- db/migrations/acessos/022_frota.sql:18-49 + 025_frota_veiculo_completo.sql:8-20 + 026_frota_contato.sql:8-12
-- + 027_frota_oficina.sql:9-10 + 034_arvore_local_universal.sql:34-36 + 048_frota_bem_id_unico.sql:44-46
create table public.frota_veiculos (
  id                    uuid primary key default gen_random_uuid(),
  placa                 text not null unique,
  nome                  text not null,
  marca                 text,
  ano                   int,
  cor                   text,
  combustivel           text,
  renavam               text,
  chassi                text,
  tipo_oleo             text,
  contrato              text,
  codigo_patrimonial    text,
  aluguel_centavos      bigint,
  fipe_centavos         bigint,
  categoria_comercial   text,
  blindado              boolean not null default false,
  situacao              text not null default 'ativo' check (situacao in ('ativo','em_manutencao','alienado','inativo')),
  pessoa_id             uuid references public.acessos_pessoas(id) on delete set null,
  local_texto           text,
  observacao            text,
  criado_em             timestamptz not null default now(),
  atualizado_em         timestamptz not null default now(),
  seguro_seguradora     text,
  seguro_apolice        text,
  seguro_vence_em       date,
  seguro_valor_centavos bigint,
  tag_pedagio           text,
  rastreador            text,
  bem_id                uuid references public.patrimonio_bens(id) on delete set null,
  contato_nome          text,
  contato_telefone      text,
  contato_papel         text,
  oficina_nome          text,
  oficina_telefone      text,
  empresa_id            uuid references public.patrimonio_empresas(id) on delete set null,
  local_id              uuid references public.patrimonio_locais(id) on delete set null,
  comodo_id             uuid references public.patrimonio_comodos(id) on delete set null
);
create unique index uq_frota_veiculos_bem_id on public.frota_veiculos (bem_id) where bem_id is not null;

-- 028_frota_checklist.sql:24-33 + 044_frota_checklist_impede_uso.sql:21-22
create table public.frota_checklist_itens (
  id         uuid primary key default gen_random_uuid(),
  ordem      int not null default 0,
  item       text not null unique,
  cadencia   text not null check (cadencia in ('diario','semanal','mensal')),
  ativo      boolean not null default true,
  observacao text,
  impede_uso boolean not null default false
);

-- 028_frota_checklist.sql:43-48 (a linha única id = true)
create table public.frota_checklist_config (
  id            boolean primary key default true check (id),
  dia_semanal   int not null default 5 check (dia_semanal between 1 and 5),
  semana_mensal int not null default 1 check (semana_mensal between 1 and 4),
  dia_mensal    int not null default 3 check (dia_mensal between 1 and 5)
);

-- 028_frota_checklist.sql:52-75 + 032_frota_checklist_assinatura.sql:9-19 + 037_frota_checklist_rabisco.sql:26-38
create table public.frota_checklist (
  id                       uuid primary key default gen_random_uuid(),
  veiculo_id               uuid not null references public.frota_veiculos(id) on delete cascade,
  pessoa_id                uuid references public.acessos_pessoas(id) on delete set null,
  pessoa_nome              text,
  feita_em                 date not null,
  cadencias                text[] not null default '{diario}',
  hodometro                int not null check (hodometro > 0),
  hodometro_justificativa  text,
  resultado                text not null default 'liberado' check (resultado in ('liberado','com_ressalvas','nao_liberado')),
  anomalias                text,
  criada_em                timestamptz not null default now(),
  criada_por               uuid references public.usuarios(id) on delete set null,
  aberta_em                timestamptz,
  assinada_em              timestamptz,
  assinada_por             uuid references public.usuarios(id) on delete set null,
  assinatura_hash          text,
  assinatura_hash_anterior text,
  sem_assinatura_motivo    text,
  assinatura_rabisco       jsonb,
  assinatura_versao        smallint,
  unique (veiculo_id, feita_em)
);

-- 028_frota_checklist.sql:79-91 + 032_frota_checklist_assinatura.sql:32-33 + 035_frota_resposta_ordem_unica.sql:43-44
create table public.frota_checklist_respostas (
  id           uuid primary key default gen_random_uuid(),
  checklist_id uuid not null references public.frota_checklist(id) on delete cascade,
  item_id      uuid references public.frota_checklist_itens(id) on delete set null,
  item_texto   text not null,
  cadencia     text not null,
  estado       text not null check (estado in ('ok','nao_ok','na')),
  observacao   text,
  ordem        int not null default 0
);
create unique index frota_resposta_ordem_unica on public.frota_checklist_respostas (checklist_id, ordem);

-- 036_frota_checklist_pdf.sql:30-54
create table public.frota_checklist_pdf (
  id           uuid primary key default gen_random_uuid(),
  checklist_id uuid not null references public.frota_checklist(id) on delete cascade,
  situacao     text not null default 'na_fila' check (situacao in ('na_fila','enviando','enviado','falhou')),
  tentativas   int not null default 0,
  ultimo_erro  text,
  tentado_em   timestamptz,
  zoho_file_id text,
  criado_em    timestamptz not null default now(),
  enviado_em   timestamptz,
  unique (checklist_id)
);

-- 022_frota.sql:58-91 + 028_frota_checklist.sql:14-20 + 046_frota_aceite_de_retirada.sql:32-46
create table public.frota_uso (
  id                    uuid primary key default gen_random_uuid(),
  veiculo_id            uuid not null references public.frota_veiculos(id) on delete cascade,
  pessoa_id             uuid references public.acessos_pessoas(id) on delete set null,
  pessoa_nome           text,
  saida_em              timestamptz not null default now(),
  km_saida              int,
  volta_em              timestamptz,
  km_volta              int,
  destino               text,
  finalidade            text,
  tanque_quartos        int check (tanque_quartos between 0 and 4),
  observacao            text,
  criado_em             timestamptz not null default now(),
  tipo                  text not null default 'viagem',
  aceite_em             timestamptz,
  aceite_por            uuid references public.usuarios(id) on delete set null,
  aceite_nome           text,
  aceite_rabisco        jsonb,
  aceite_checklist_id   uuid references public.frota_checklist(id) on delete set null,
  aceite_checklist_hash text,
  constraint frota_uso_volta_depois check (volta_em is null or volta_em >= saida_em),
  constraint frota_uso_km_cresce check (km_volta is null or km_saida is null or km_volta >= km_saida),
  constraint frota_uso_tipo_valido check (tipo in ('viagem','posse'))
);
-- "um carro, uma saída aberta": a trava da concorrência (022_frota.sql:88-89)
create unique index uniq_frota_uso_um_aberto on public.frota_uso (veiculo_id) where volta_em is null;

-- db/migrations/2026-08-18-fila-do-pdf-do-aceite.sql:17-30
create table public.frota_uso_pdf (
  id           uuid primary key default gen_random_uuid(),
  uso_id       uuid not null unique references public.frota_uso(id) on delete cascade,
  situacao     text not null default 'na_fila' check (situacao in ('na_fila','enviando','enviado','falhou')),
  tentativas   integer not null default 0,
  ultimo_erro  text,
  tentado_em   timestamptz,
  zoho_file_id text,
  criado_em    timestamptz not null default now(),
  enviado_em   timestamptz
);

-- 023_frota_requisicoes.sql:14-38 + 045_frota_reserva_editar_cancelar_revogar.sql:44-59 + 047_frota_reserva_arquivar.sql:41-43
create table public.frota_requisicoes (
  id                 uuid primary key default gen_random_uuid(),
  veiculo_id         uuid not null references public.frota_veiculos(id) on delete cascade,
  pessoa_id          uuid references public.acessos_pessoas(id) on delete set null,
  pessoa_nome        text,
  departamento       text,
  destino            text,
  finalidade         text,
  retirada_prevista  timestamptz not null,
  devolucao_prevista timestamptz,
  situacao           text not null default 'pendente',
  criada_por         uuid references public.usuarios(id) on delete set null,
  criada_em          timestamptz not null default now(),
  decidida_por       uuid references public.usuarios(id) on delete set null,
  decidida_em        timestamptz,
  motivo_decisao     text,
  uso_id             uuid references public.frota_uso(id) on delete set null,
  observacao         text,
  encerrada_por      uuid references public.usuarios(id) on delete set null,
  encerrada_em       timestamptz,
  encerrada_motivo   text,
  arquivada_em       timestamptz,
  arquivada_por      uuid references public.usuarios(id),
  constraint frota_req_volta_depois check (devolucao_prevista is null or devolucao_prevista > retirada_prevista),
  constraint frota_requisicoes_situacao_check check (situacao in ('pendente','aprovada','recusada','cancelada','revogada','usada'))
);

-- 045_frota_reserva_editar_cancelar_revogar.sql:65-77 (só o gatilho escreve)
create table public.frota_requisicoes_historico (
  id            uuid primary key default gen_random_uuid(),
  requisicao_id uuid not null references public.frota_requisicoes(id) on delete cascade,
  campo         text not null,
  de            text,
  para          text,
  motivo        text,
  quem          uuid references public.usuarios(id) on delete set null,
  quando        timestamptz not null default now()
);

-- 022_frota.sql:93-99 + 024_frota_revisoes.sql:27
create table public.frota_plano_revisao (
  id         uuid primary key default gen_random_uuid(),
  item       text not null unique,
  a_cada_km  int not null check (a_cada_km > 0),
  ordem      int not null default 0,
  ativo      boolean not null default true,
  observacao text
);

-- 041_frota_manutencao.sql:15-32
create table public.frota_manutencoes (
  id             uuid primary key default gen_random_uuid(),
  veiculo_id     uuid not null references public.frota_veiculos(id) on delete cascade,
  km             int not null check (km >= 0),
  feita_em       date,
  oficina        text,
  total_centavos bigint,
  observacao     text,
  criada_em      timestamptz not null default now(),
  criada_por     uuid references public.usuarios(id) on delete set null
);

-- 024_frota_revisoes.sql:9-23 + 041_frota_manutencao.sql:40-42
create table public.frota_revisoes (
  id             uuid primary key default gen_random_uuid(),
  veiculo_id     uuid not null references public.frota_veiculos(id) on delete cascade,
  item           text not null,
  km             int check (km >= 0),
  feita_em       date,
  oficina        text,
  custo_centavos bigint,
  observacao     text,
  criada_em      timestamptz not null default now(),
  criada_por     uuid references public.usuarios(id) on delete set null,
  manutencao_id  uuid references public.frota_manutencoes(id) on delete cascade
);

-- 056_frota_abastecimentos.sql:6-29
create table public.frota_abastecimentos (
  id             uuid primary key default gen_random_uuid(),
  veiculo_id     uuid not null references public.frota_veiculos(id) on delete cascade,
  pessoa_id      uuid references public.acessos_pessoas(id) on delete set null,
  pessoa_nome    text,
  abastecido_em  timestamptz not null default now(),
  km             integer not null,
  litros         numeric(7,3) not null,
  total_centavos integer not null,
  tanque_depois  smallint not null,
  combustivel    text not null,
  posto          text,
  observacao     text,
  criado_em      timestamptz not null default now(),
  criado_por     uuid,
  constraint frota_abast_km_positivo check (km > 0),
  constraint frota_abast_litros_positivo check (litros > 0),
  constraint frota_abast_total_positivo check (total_centavos > 0),
  constraint frota_abast_tanque_valido check (tanque_depois between 0 and 4)
);
```

- [ ] **Step 2: Condições e funções avulsas.** Crie `api/internal/testebanco/esquema/condicoes-dos-gatilhos.json`:

```json
{
  "frota_checklist.trg_frota_checklist_enfileirar_pdf": {"eventos": "insert or update of assinada_em", "fonte": "db/migrations/acessos/036_frota_checklist_pdf.sql:119-121"},
  "frota_checklist.trg_frota_checklist_imutavel": {"quando": "old.assinada_em is not null", "fonte": "db/migrations/acessos/032_frota_checklist_assinatura.sql:50-54"},
  "frota_uso.trg_frota_uso_enfileirar_pdf": {"eventos": "insert or update of aceite_em", "fonte": "db/migrations/2026-08-18-fila-do-pdf-do-aceite.sql:76-78"},
  "frota_veiculos.trg_frota_espelha_responsavel": {"eventos": "update of pessoa_id", "fonte": "db/migrations/acessos/043_frota_patrimonio_responsavel.sql:50-52"},
  "frota_veiculos.trg_frota_espelha_situacao": {"eventos": "update of situacao", "fonte": "db/migrations/acessos/042_frota_patrimonio_situacao.sql:86-88"},
  "frota_veiculos.trg_frota_fechar_posse_orfa": {"eventos": "update of pessoa_id", "quando": "new.pessoa_id is null", "fonte": "db/migrations/acessos/029_frota_posse_invariante.sql:34-38"}
}
```

e `api/internal/testebanco/esquema/funcoes-avulsas-5-3.txt`:

```
# RPCs da Frota (Plano 5.3, Task 9): nenhum gatilho as chama; o teste do /rpc chama a de produção.
etiqueta_quem_e
frota_corrente_do_veiculo
```

- [ ] **Step 3: O gerador.** Em `api/internal/testebanco/esquema/gerar-gatilhos.mjs` (do 5.1):
  1. Troque as duas linhas do cabeçalho `// O 03-triggers.csv não traz FOR EACH nem WHEN: todos saem "for each row", sem WHEN. Ao acrescentar` / `// tabela, confira nas migrations a orientação e o WHEN de cada gatilho novo.` por:
     ```js
     // O 03-triggers.csv não traz FOR EACH, UPDATE OF nem WHEN: todos saem "for each row"; UPDATE OF e WHEN
     // vêm de condicoes-dos-gatilhos.json (copiados das migrations, com a fonte). Funções que nenhum gatilho
     // chama (RPCs) entram por funcoes-avulsas-*.txt. Ao acrescentar tabela, confira cada gatilho novo.
     ```
  2. Logo depois do laço que monta `gatilhos`, acrescente:
     ```js
     const condicoes = JSON.parse(readFileSync(join(aqui, 'condicoes-dos-gatilhos.json'), 'utf8'));
     for (const k of Object.keys(condicoes)) {
       if (!gatilhos.has(k)) { console.error(`condição para gatilho que não existe: ${k}`); process.exit(1); }
     }
     const avulsas = readdirSync(aqui).filter((a) => /^funcoes-avulsas-.*\.txt$/.test(a))
       .flatMap((a) => readFileSync(join(aqui, a), 'utf8').split('\n').map((l) => l.replace(/#.*/, '').trim()).filter(Boolean));
     ```
  3. Troque `const fila = [...gatilhos.values()].flatMap((g) => chamadas(g.acao));` por `const fila = [...gatilhos.values()].flatMap((g) => chamadas(g.acao)).concat(avulsas);`.
  4. Troque a linha de saída dos gatilhos (`ordem.map((g) => \`create trigger ${g.nome} ${g.momento} ${g.eventos.join(' or ')} on public.${g.tabela} for each row ${g.acao};\n\`).join(''),`) por:
     ```js
       ordem.map((g) => {
         const c = condicoes[`${g.tabela}.${g.nome}`] ?? {};
         return `create trigger ${g.nome} ${g.momento} ${c.eventos ?? g.eventos.join(' or ')} on public.${g.tabela} for each row` +
           `${c.quando ? ` when (${c.quando})` : ''} ${g.acao};\n`;
       }).join(''),
     ```
  Rode `node api/internal/testebanco/esquema/gerar-gatilhos.mjs "$L" > api/internal/testebanco/esquema/02-gatilhos.sql`. Confira: `head -5 …/02-gatilhos.sql` lista as 16 funções do contrato (a)  na linha `-- Funções (N)`; `grep -c '^create trigger trg_frota' …/02-gatilhos.sql` → `12`; `grep 'when (' …/02-gatilhos.sql` → as 2 condições. Diferença: **pare e reporte**. `git diff` de `02-gatilhos.sql` só ACRESCENTA (nada do 5.1/5.2 some).

- [ ] **Step 4: O teste que falha.** Crie `api/internal/testebanco/esquema_frota_test.go`:

```go
package testebanco

import (
	"context"
	"errors"
	"reflect"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/rbv-co/social-dashboard/api/internal/banco"
)

// A fatia 5.3 (Frota): os 12 gatilhos verbatim, com as condições das migrations, disparam com a
// identidade da transação (banco.ComUsuario). Sem identidade, o aceite e a decisão de reserva recusam.
func TestFatiaDaFrotaComOsGatilhosVerbatim(t *testing.T) {
	p := ComEsquemaDeProducao(t)
	ctx := context.Background()
	const (
		motorista = "f1000000-0000-4000-a000-000000000001" // features {frota}
		aprovador = "f1000000-0000-4000-a000-000000000002" // features {frota, frota.aprovar}
		pessoa    = "f1a00000-0000-4000-a000-000000000001"
		categoria = "f1c00000-0000-4000-a000-000000000001"
		bem       = "f1b00000-0000-4000-a000-000000000001"
		carro     = "f1d00000-0000-4000-a000-000000000001" // dono fixo, posse aberta, bem ligado
		carro2    = "f1d00000-0000-4000-a000-000000000002" // rodízio, nada aberto
		item      = "f1900000-0000-4000-a000-000000000001"
		ficha     = "f1800000-0000-4000-a000-000000000001"
		reserva   = "f1f00000-0000-4000-a000-000000000001"
	)
	if _, err := p.Exec(ctx, `
		insert into usuarios (id, email) values ('`+motorista+`', 'motorista@x.com'), ('`+aprovador+`', 'aprovador@x.com');
		insert into profiles (id, email, role, features) values ('`+motorista+`', 'motorista@x.com', 'viewer', '{frota}'),
		  ('`+aprovador+`', 'aprovador@x.com', 'viewer', '{frota,frota.aprovar}');
		insert into acessos_pessoas (id, nome, profile_id) values ('`+pessoa+`', 'Motorista', '`+motorista+`');
		insert into patrimonio_categorias (id, nome) values ('`+categoria+`', 'Veículos');
		insert into patrimonio_bens (id, numero, nome, categoria_id, situacao) values ('`+bem+`', 101, 'Gol', '`+categoria+`', 'em_uso');
		insert into frota_veiculos (id, placa, nome, pessoa_id, bem_id) values ('`+carro+`', 'AAA1A11', 'Gol', '`+pessoa+`', '`+bem+`'),
		  ('`+carro2+`', 'BBB2B22', 'Uno', null, null);
		insert into frota_uso (veiculo_id, pessoa_id, tipo) values ('`+carro+`', '`+pessoa+`', 'posse');
		insert into frota_checklist_itens (id, item, cadencia) values ('`+item+`', 'Pneus', 'diario');
		insert into frota_checklist (id, veiculo_id, feita_em, hodometro) values ('`+ficha+`', '`+carro+`', '2026-10-01', 5000);
		insert into frota_checklist_respostas (checklist_id, item_id, item_texto, cadencia, estado)
		  values ('`+ficha+`', '`+item+`', 'Pneus', 'diario', 'ok');
		insert into frota_requisicoes (id, veiculo_id, retirada_prevista, criada_por)
		  values ('`+reserva+`', '`+carro2+`', '2026-10-20T12:00:00Z', '`+motorista+`');`); err != nil {
		t.Fatal(err)
	}
	como := func(id, sql string) error {
		return banco.ComUsuario(ctx, p, id, func(tx pgx.Tx) error { _, err := tx.Exec(ctx, sql); return err })
	}
	codigo := func(err error) string {
		var pe *pgconn.PgError
		if errors.As(err, &pe) {
			return pe.Code
		}
		return ""
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

	// 1. os 12 gatilhos de produção, com as condições das migrations
	var gat []string
	linhas, err := p.Query(ctx, `select t.tgname::text from pg_trigger t join pg_class c on c.oid = t.tgrelid
		where not t.tgisinternal and c.relname like 'frota\_%' order by 1`)
	if err != nil {
		t.Fatal(err)
	}
	for linhas.Next() {
		var n string
		linhas.Scan(&n)
		gat = append(gat, n)
	}
	if quer := []string{"trg_frota_aceite_imutavel", "trg_frota_checar_arquivamento", "trg_frota_checar_decisao",
		"trg_frota_checklist_enfileirar_pdf", "trg_frota_checklist_imutavel", "trg_frota_espelha_responsavel",
		"trg_frota_espelha_situacao", "trg_frota_espelha_situacao_no_bem", "trg_frota_fechar_posse_orfa",
		"trg_frota_gravar_historico", "trg_frota_resposta_imutavel", "trg_frota_uso_enfileirar_pdf"}; !reflect.DeepEqual(gat, quer) {
		t.Fatalf("gatilhos = %v, esperava %v", gat, quer)
	}
	for nome, trechos := range map[string][]string{
		"trg_frota_checklist_imutavel":       {"WHEN ((old.assinada_em IS NOT NULL))"},
		"trg_frota_fechar_posse_orfa":        {"UPDATE OF pessoa_id", "WHEN ((new.pessoa_id IS NULL))"},
		"trg_frota_checklist_enfileirar_pdf": {"UPDATE OF assinada_em"},
		"trg_frota_uso_enfileirar_pdf":       {"UPDATE OF aceite_em"},
		"trg_frota_espelha_situacao":         {"UPDATE OF situacao"},
		"trg_frota_espelha_responsavel":      {"UPDATE OF pessoa_id"},
	} {
		def := um(`select pg_get_triggerdef(oid) from pg_trigger where tgname = '` + nome + `'`)
		for _, tr := range trechos {
			if !strings.Contains(def, tr) {
				t.Errorf("%s sem %q: %s", nome, tr, def)
			}
		}
	}

	// 2. aceite: sem identidade não assina; com identidade o gatilho carimba quem e quando; depois é imutável
	if _, err := p.Exec(ctx, `insert into frota_uso (veiculo_id, aceite_em) values ('`+carro2+`', now())`); codigo(err) != "23514" {
		t.Errorf("aceite sem identidade: %v", err)
	}
	if err := como(motorista, `insert into frota_uso (veiculo_id, aceite_em, aceite_nome, aceite_por)
		values ('`+carro2+`', '2020-01-01', 'Motorista', '`+aprovador+`')`); err != nil {
		t.Fatal(err)
	}
	if v := um(`select aceite_por::text || '/' || (aceite_em > '2026-01-01')::text || '/' || (select count(*) from frota_uso_pdf)::text
		from frota_uso where veiculo_id = '` + carro2 + `'`); v != motorista+"/true/1" {
		t.Errorf("aceite = %s, esperava o carimbo de quem gravou, agora, e a fila do PDF", v)
	}
	if err := como(aprovador, `update frota_uso set aceite_nome = 'Outro' where veiculo_id = '`+carro2+`'`); codigo(err) != "23514" {
		t.Errorf("aceite assinado mudou: %v", err)
	}

	// 3. ficha: editável enquanto sem assinatura (WHEN); assinar enfileira o PDF; assinada não muda nem some
	if err := como(motorista, `update frota_checklist set hodometro = 5001 where id = '`+ficha+`'`); err != nil {
		t.Errorf("ficha sem assinatura não editou: %v", err)
	}
	if err := como(motorista, `update frota_checklist set assinada_em = now(), assinatura_hash = 'h' where id = '`+ficha+`'`); err != nil {
		t.Fatal(err)
	}
	if v := um(`select count(*)::text from frota_checklist_pdf where checklist_id = '` + ficha + `'`); v != "1" {
		t.Errorf("assinar não pôs a ficha na fila do PDF: %s", v)
	}
	for _, sql := range []string{
		`update frota_checklist set hodometro = 1 where id = '` + ficha + `'`,
		`delete from frota_checklist where id = '` + ficha + `'`,
		`insert into frota_checklist_respostas (checklist_id, item_texto, cadencia, estado, ordem) values ('` + ficha + `', 'x', 'diario', 'ok', 1)`,
		`update frota_checklist_respostas set estado = 'nao_ok' where checklist_id = '` + ficha + `'`,
	} {
		if err := como(aprovador, sql); codigo(err) != "P0001" {
			t.Errorf("ficha assinada aceitou %q: %v", sql, err)
		}
	}
	if v := um(`select hodometro::text || '/' || (select string_agg(estado, ',') from frota_checklist_respostas)
		from frota_checklist where id = '` + ficha + `'`); v != "5001/ok" {
		t.Errorf("ficha assinada mudou: %s", v)
	}

	// 4. reserva: quem decide é quem tem frota.aprovar (gatilho), com rastro de QUEM mudou
	if err := como(motorista, `update frota_requisicoes set situacao = 'aprovada' where id = '`+reserva+`'`); codigo(err) != "23514" ||
		!strings.Contains(err.Error(), "permissão para aprovar") {
		t.Errorf("motorista aprovou: %v", err)
	}
	if _, err := p.Exec(ctx, `update frota_requisicoes set situacao = 'recusada' where id = '`+reserva+`'`); codigo(err) != "23514" {
		t.Errorf("decisão sem identidade: %v", err)
	}
	if err := como(motorista, `update frota_requisicoes set destino = 'Campinas' where id = '`+reserva+`'`); codigo(err) != "23514" {
		t.Errorf("motorista editou a reserva: %v", err)
	}
	if v := um(`select situacao || '/' || coalesce(destino, '-') || '/' || (select count(*) from frota_requisicoes_historico)::text
		from frota_requisicoes where id = '` + reserva + `'`); v != "pendente/-/0" {
		t.Errorf("recusa gravou: %s", v)
	}
	if err := como(aprovador, `update frota_requisicoes set situacao = 'aprovada', destino = 'Campinas' where id = '`+reserva+`'`); err != nil {
		t.Fatal(err)
	}
	if v := um(`select r.decidida_por::text || '/' || string_agg(h.campo || ':' || coalesce(h.de, '-') || '>' || h.para || ':' || h.quem::text, ',' order by h.campo)
		from frota_requisicoes r join frota_requisicoes_historico h on h.requisicao_id = r.id
		where r.id = '` + reserva + `' group by r.decidida_por`); v != aprovador+"/destino:->Campinas:"+aprovador+",situação:pendente>aprovada:"+aprovador {
		t.Errorf("decisão e histórico = %s", v)
	}
	if err := como(aprovador, `update frota_requisicoes set situacao = 'cancelada' where id = '`+reserva+`'`); codigo(err) != "23514" ||
		!strings.Contains(err.Error(), "motivo") {
		t.Errorf("cancelou sem motivo: %v", err)
	}
	if err := como(aprovador, `update frota_requisicoes set arquivada_em = now() where id = '`+reserva+`'`); codigo(err) != "23514" ||
		!strings.Contains(err.Error(), "Só reserva encerrada") {
		t.Errorf("arquivou reserva aprovada que não venceu: %v", err)
	}

	// 5. veículo: parar espelha no Patrimônio; tirar o dono fecha a posse órfã; o dono novo vai ao bem
	if err := como(motorista, `update frota_veiculos set situacao = 'inativo' where id = '`+carro+`'`); err != nil {
		t.Fatal(err)
	}
	if v := um(`select situacao from patrimonio_bens where id = '` + bem + `'`); v != "em_estoque" {
		t.Errorf("bem = %s, esperava em_estoque", v)
	}
	if err := como(motorista, `update frota_veiculos set pessoa_id = null where id = '`+carro+`'`); err != nil {
		t.Fatal(err)
	}
	if v := um(`select count(*)::text from frota_uso where veiculo_id = '` + carro + `' and volta_em is null`); v != "0" {
		t.Errorf("posse órfã ficou aberta: %s", v)
	}
	if err := como(motorista, `update frota_veiculos set pessoa_id = '`+pessoa+`' where id = '`+carro+`'`); err != nil {
		t.Fatal(err)
	}
	if v := um(`select coalesce(pessoa_id::text, '<nulo>') from patrimonio_bens where id = '` + bem + `'`); v != pessoa {
		t.Errorf("responsável do bem = %s", v)
	}
}
```

Run: `cd api && go test -count=1 -run FatiaDaFrota ./internal/testebanco/` → PASS; sem os Steps 1–3 o mesmo comando falha (`relation "frota_veiculos" does not exist`), e as mutações do Step 5 mostram que ele morde.

- [ ] **Step 5: Rodar e ver morder.** `gofmt -l ./internal && go vet ./internal/testebanco/ && go test -count=1 -v ./internal/testebanco/ 2>&1 | grep -E '^(--- |ok|FAIL)'` → todos `--- PASS` (o teste do 5.1 inclusive). Mutações que têm de reprovar (uma por vez, regerando e depois `git checkout`): tirar a entrada `trg_frota_checklist_imutavel` do JSON (assinar recusa); tirar `funcoes-avulsas-5-3.txt` (a Task 9 é que acusa — aqui confira só que `etiqueta_quem_e` some do cabeçalho); apagar a linha `create trigger trg_frota_aceite_imutavel` do `02-gatilhos.sql`.

- [ ] **Step 6: Commit.**

```bash
git add api/internal/testebanco/esquema/ api/internal/testebanco/esquema_frota_test.go
git commit -m "test(api): D0 — fatia 5.3 (frota) com os 12 gatilhos verbatim, condições das migrations e as RPCs

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: `frota` — fundação (mundo de teste, portão de impersonado, ajudantes)

**Revisor:** opus. **Depende de:** 1; `dados.Tabela` (Task 2 do 5.1).

**(a) Contrato**
- `soSessaoPropria(next http.Handler) http.Handler`: ator ausente ou com `ImpersonadorID` → `403 {"error":"sem_permissao","mensagem":"Quem entrou como outra pessoa não grava na Frota."}` (Ruling 5.3-5). Em TODA escrita da Frota.
- `deve(err error)`: declaração errada → `panic` na montagem.
- `naLinha(id string, h http.HandlerFunc) http.HandlerFunc`: põe `{id}` no contexto do chi para uma rota sem id na URL (configuração do checklist).
- `idDaLinha(linha []byte) (string, error)`: o `id` da linha que `Tabela.Criar` devolveu (linha inteira ou `{"id"}`).
- `vazio(v json.RawMessage) bool`: chave ausente ou `null` (validação dos corpos compostos das Tasks 4 e 6).
- Teste (interno ao pacote): `novoMundo(t, montar ...func(chi.Router, *pgxpool.Pool)) *mundo` com o banco da Task 1, 9 pessoas (+ sessão `impersonado` = a do motorista aberta pelo super), as linhas abaixo e as rotas atrás da MESMA cadeia do grupo de domínio (`auth.Exigir` → `autz.ComEscopo`); `(*mundo).resposta/pedir/um/rodar`; `type caso`; `semFrota` (as 4 pessoas COM sessão e sem a Frota; a desativada nem tem sessão); `fotoDaFrota` (hash das 14 tabelas + `patrimonio_bens`).

**(b) Testes de aceitação**
- `TestMundoDaFrota`: sem sessão → 401; o `Escopo` chega (`FrotaAdmin|SuperFicha|impersonado`): motorista `true|false|false`, aprovador `true|false|false`, superFicha `true|true|false`, soAprovar `false|false|false`, admin `false|false|false`, impersonado `true|false|true`; desativado → 401 (o `Store.Buscar` do 5.0 recusa sessão de perfil `disabled`: a conta desativada nem chega ao `Escopo`); a ficha C1 está na fila do PDF (gatilho rodou na carga).
- `TestSoSessaoPropria`: sem ator → 403; ator próprio → passa; impersonado → 403 com a frase e o handler não roda.
- `TestIdDaLinha`: `{"id":"x","a":1}` → `x`; `{"id":"x"}` → `x`; `{}` e lixo → erro.

**(c) Arquivos:** Create `api/internal/frota/dominio.go`, `api/internal/frota/dominio_test.go`, `api/internal/frota/mundo_test.go`.

**(d) Dependências:** Task 1; `auth.Exigir/NovoStore/Store.Criar/AtorDoContexto`; `autz.ComEscopo/EscopoDo/FrotaAdmin`; `dados.Erro`.

- [ ] **Step 1: O mundo.** Crie `api/internal/frota/mundo_test.go`:

```go
package frota

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

// Pessoas do mundo da Frota. is_frota_admin() = conta ativa e ('frota' em features ou super pela
// ficha); pode_aprovar_frota() = conta ativa e ('frota.aprovar' em features ou super pela ficha).
const (
	idSuperFicha = "f3000000-0000-4000-a000-000000000001" // papel viewer, super pela ficha: lê, grava e aprova
	idAprovador  = "f3000000-0000-4000-a000-000000000002" // features {frota, frota.aprovar}
	idMotorista  = "f3000000-0000-4000-a000-000000000003" // features {frota}
	idMotorista2 = "f3000000-0000-4000-a000-000000000004" // features {frota}
	idSoAprovar  = "f3000000-0000-4000-a000-000000000005" // features {frota.aprovar} SEM frota: não lê nada
	idPatrimonio = "f3000000-0000-4000-a000-000000000006" // features {patrimonio}
	idAdmin      = "f3000000-0000-4000-a000-000000000007" // papel admin sem frota: admin do Patrimônio, não da Frota
	idDesativado = "f3000000-0000-4000-a000-000000000008" // features {frota}, conta desativada: a sessão não vale (401)
	idViewer     = "f3000000-0000-4000-a000-000000000009" // nada

	pMotorista = "f3a00000-0000-4000-a000-000000000001" // ficha de colaborador ligada ao motorista
	catVeiculo = "f3c00000-0000-4000-a000-000000000001"
	catMovel   = "f3c00000-0000-4000-a000-000000000002"
	bemCarro   = "f3b00000-0000-4000-a000-000000000001" // etiqueta 101, ligado ao V1
	bemCarro2  = "f3b00000-0000-4000-a000-000000000002" // etiqueta 103, veículo livre
	bemMesa    = "f3b00000-0000-4000-a000-000000000003" // etiqueta 102, não é veículo

	V1  = "f3d00000-0000-4000-a000-000000000001" // Gol, dono fixo pMotorista, posse U1 aberta, bem 101
	V2  = "f3d00000-0000-4000-a000-000000000002" // Uno, rodízio, nada aberto
	U1  = "f3e00000-0000-4000-a000-000000000001" // posse aberta do V1
	U2  = "f3e00000-0000-4000-a000-000000000002" // viagem fechada do V2 (km 100 → 150)
	R1  = "f3f00000-0000-4000-a000-000000000001" // reserva pendente do V2, criada pelo motorista
	R2  = "f3f00000-0000-4000-a000-000000000002" // reserva aprovada do V2, criada pelo motorista2
	I1  = "f3900000-0000-4000-a000-000000000001" // item diário 'Pneus'
	I2  = "f3900000-0000-4000-a000-000000000002" // item semanal 'Faróis'
	C1  = "f3800000-0000-4000-a000-000000000001" // ficha ASSINADA do V1 (2026-10-01), resposta Q1, na fila do PDF
	C2  = "f3800000-0000-4000-a000-000000000002" // ficha sem assinatura do V2 (2026-10-02)
	Q1  = "f3700000-0000-4000-a000-000000000001"
	P1  = "f3600000-0000-4000-a000-000000000001" // plano 'Troca de óleo' a cada 7000 km
	M1  = "f3500000-0000-4000-a000-000000000001" // manutenção do V1
	Rv1 = "f3500000-0000-4000-a000-000000000002" // troca da M1
	A1  = "f3400000-0000-4000-a000-000000000001" // abastecimento do V1
)

var pessoasDoMundo = []struct {
	chave, id, email, papel string
	super, desativada       bool
	features                []string
}{
	{"superFicha", idSuperFicha, "superficha@x.com", "viewer", true, false, nil},
	{"aprovador", idAprovador, "aprovador@x.com", "viewer", false, false, []string{"frota", "frota.aprovar"}},
	{"motorista", idMotorista, "motorista@x.com", "viewer", false, false, []string{"frota"}},
	{"motorista2", idMotorista2, "motorista2@x.com", "viewer", false, false, []string{"frota"}},
	{"soAprovar", idSoAprovar, "soaprovar@x.com", "viewer", false, false, []string{"frota.aprovar"}},
	{"patrimonio", idPatrimonio, "patrimonio@x.com", "viewer", false, false, []string{"patrimonio"}},
	{"admin", idAdmin, "admin@x.com", "admin", false, false, nil},
	{"desativado", idDesativado, "desativado@x.com", "viewer", false, true, []string{"frota"}},
	{"viewer", idViewer, "viewer@x.com", "viewer", false, false, nil},
}

// semFrota: quem tem sessão e não pode ver nem gravar nada da Frota (o lado negado de toda rota). A conta
// desativada fica de fora: nem sessão ela tem (auth.Exigir → 401), e a varredura da Task 10 confere isso.
var semFrota = []string{"admin", "soAprovar", "patrimonio", "viewer"}

// Sem identidade (p.Exec): os gatilhos que exigem auth.uid() não são exercidos pela carga.
const linhasDaFrota = `
insert into acessos_pessoas (id, nome, profile_id) values ('` + pMotorista + `', 'Motorista', '` + idMotorista + `');
insert into patrimonio_categorias (id, nome) values ('` + catVeiculo + `', 'Veículos'), ('` + catMovel + `', 'Móveis');
insert into patrimonio_bens (id, numero, nome, categoria_id, situacao) values
  ('` + bemCarro + `', 101, 'Gol da frota', '` + catVeiculo + `', 'em_uso'),
  ('` + bemMesa + `', 102, 'Mesa', '` + catMovel + `', 'em_uso'),
  ('` + bemCarro2 + `', 103, 'Kwid do patrimônio', '` + catVeiculo + `', 'em_estoque');
insert into frota_veiculos (id, placa, nome, pessoa_id, bem_id) values
  ('` + V1 + `', 'AAA1A11', 'Gol', '` + pMotorista + `', '` + bemCarro + `'), ('` + V2 + `', 'BBB2B22', 'Uno', null, null);
insert into frota_uso (id, veiculo_id, pessoa_id, pessoa_nome, tipo, saida_em) values
  ('` + U1 + `', '` + V1 + `', '` + pMotorista + `', 'Motorista', 'posse', '2026-10-01T08:00:00Z');
insert into frota_uso (id, veiculo_id, pessoa_nome, tipo, saida_em, volta_em, km_saida, km_volta) values
  ('` + U2 + `', '` + V2 + `', 'Fulano', 'viagem', '2026-10-02T08:00:00Z', '2026-10-02T12:00:00Z', 100, 150);
insert into frota_requisicoes (id, veiculo_id, retirada_prevista, situacao, criada_por) values
  ('` + R1 + `', '` + V2 + `', '2026-10-20T12:00:00Z', 'pendente', '` + idMotorista + `'),
  ('` + R2 + `', '` + V2 + `', '2026-10-21T12:00:00Z', 'aprovada', '` + idMotorista2 + `');
insert into frota_checklist_itens (id, ordem, item, cadencia) values ('` + I1 + `', 1, 'Pneus', 'diario'), ('` + I2 + `', 2, 'Faróis', 'semanal');
insert into frota_checklist_config default values;
insert into frota_checklist (id, veiculo_id, feita_em, hodometro) values ('` + C1 + `', '` + V1 + `', '2026-10-01', 5000);
insert into frota_checklist_respostas (id, checklist_id, item_id, item_texto, cadencia, estado, ordem)
  values ('` + Q1 + `', '` + C1 + `', '` + I1 + `', 'Pneus', 'diario', 'ok', 0);
update frota_checklist set assinada_em = '2026-10-01T09:00:00Z', assinatura_hash = 'h-c1', assinatura_versao = 2 where id = '` + C1 + `';
insert into frota_checklist (id, veiculo_id, feita_em, hodometro, sem_assinatura_motivo)
  values ('` + C2 + `', '` + V2 + `', '2026-10-02', 150, 'sem_login');
insert into frota_plano_revisao (id, item, a_cada_km, ordem) values ('` + P1 + `', 'Troca de óleo', 7000, 1);
insert into frota_manutencoes (id, veiculo_id, km, total_centavos) values ('` + M1 + `', '` + V1 + `', 5000, 30000);
insert into frota_revisoes (id, veiculo_id, item, km, custo_centavos, manutencao_id)
  values ('` + Rv1 + `', '` + V1 + `', 'Troca de óleo', 5000, 30000, '` + M1 + `');
insert into frota_abastecimentos (id, veiculo_id, abastecido_em, km, litros, total_centavos, tanque_depois, combustivel)
  values ('` + A1 + `', '` + V1 + `', '2026-10-05T10:00:00Z', 5100, 40.5, 25000, 4, 'gasolina');`

// fotoDaFrota: um hash das 14 tabelas da Frota e do Patrimônio que os gatilhos espelham. Igual antes
// e depois = nada mudou (nem por gatilho).
const fotoDaFrota = `select md5(string_agg(l, '|' order by l)) from (
  select 'v:' || t::text as l from frota_veiculos t union all
  select 'u:' || t::text from frota_uso t union all
  select 'up:' || t::text from frota_uso_pdf t union all
  select 'r:' || t::text from frota_requisicoes t union all
  select 'rh:' || t::text from frota_requisicoes_historico t union all
  select 'c:' || t::text from frota_checklist t union all
  select 'ci:' || t::text from frota_checklist_itens t union all
  select 'cc:' || t::text from frota_checklist_config t union all
  select 'cr:' || t::text from frota_checklist_respostas t union all
  select 'cp:' || t::text from frota_checklist_pdf t union all
  select 'pl:' || t::text from frota_plano_revisao t union all
  select 'm:' || t::text from frota_manutencoes t union all
  select 'rv:' || t::text from frota_revisoes t union all
  select 'a:' || t::text from frota_abastecimentos t union all
  select 'pb:' || t::text from patrimonio_bens t) z`

type mundo struct {
	p   *pgxpool.Pool
	h   http.Handler
	tok map[string]string
}

// novoMundo: a fatia de produção, as pessoas e as linhas acima, uma sessão por pessoa (+ "impersonado":
// a sessão do motorista aberta pelo super pela ficha) e as rotas de `montar` atrás da MESMA cadeia do
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
	tok, err := s.Criar(ctx, idMotorista, "painel", &super)
	if err != nil {
		t.Fatal(err)
	}
	m.tok["impersonado"] = tok
	if _, err := p.Exec(ctx, linhasDaFrota); err != nil {
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

- [ ] **Step 2: Os testes que falham.** Crie `api/internal/frota/dominio_test.go` com `TestMundoDaFrota` (rota de sonda `GET /eco` montada no próprio teste, que escreve `fmt.Sprintf("%t|%t|%t", autz.FrotaAdmin(e), e.SuperFicha, a.ImpersonadorID != nil)` de `autz.EscopoDo`/`auth.AtorDoContexto`; casos do contrato (b) com `m.rodar`, `tem` = a string inteira; e `m.um(t, "select count(*)::text from frota_checklist_pdf where checklist_id = '"+C1+"'") == "1"`), `TestSoSessaoPropria` (handler interno que responde 204; sem ator → 403; `auth.NoContexto(ctx, &auth.Ator{ID: idMotorista})` → 204; com `ImpersonadorID` → 403 com "Quem entrou como outra pessoa" e o 204 nunca acontece) e `TestIdDaLinha`. Run: `go test -count=1 ./internal/frota/` → FAIL de compilação (`soSessaoPropria`).

- [ ] **Step 3: Implementar.** Crie `api/internal/frota/dominio.go`:

```go
package frota

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/rbv-co/social-dashboard/api/internal/auth"
	"github.com/rbv-co/social-dashboard/api/internal/dados"
)

// Rotas de domínio da Frota (sub-plano 5.3). A regra de toda tabela é a do catálogo de produção
// (autz.Producao: is_frota_admin() nas 14); aprovar, cancelar, revogar, arquivar e editar reserva,
// aceite de retirada e ficha assinada são os gatilhos verbatim, que leem auth.uid() — por isso toda
// escrita roda em banco.ComUsuario, com o PodeX na MESMA transação que grava (dados.Tabela).

// soSessaoPropria recusa as escritas da Frota a quem entrou como outra pessoa (Ruling 5.3-5): os
// gatilhos carimbam auth.uid() — o ALVO — em aceite_por, decidida_por, encerrada_por, arquivada_por
// e no histórico, e a assinatura do checklist sairia no nome dele.
func soSessaoPropria(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if a := auth.AtorDoContexto(r.Context()); a == nil || a.ImpersonadorID != nil {
			dados.Erro(w, http.StatusForbidden, "sem_permissao", "Quem entrou como outra pessoa não grava na Frota.")
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

// naLinha fixa o {id} de uma rota que não o leva na URL (a configuração do checklist é a linha única
// id = true), para reusar dados.RotaEditar sem SQL próprio.
func naLinha(id string, h http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if rc := chi.RouteContext(r.Context()); rc != nil {
			rc.URLParams.Add("id", id)
		}
		h(w, r)
	}
}

// idDaLinha lê o id da linha que dados.Tabela.Criar devolveu (a linha inteira, ou só {"id"} quando quem
// grava não a lê depois).
func idDaLinha(linha []byte) (string, error) {
	var x struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(linha, &x); err != nil || x.ID == "" {
		return "", errors.New("frota: linha gravada sem id")
	}
	return x.ID, nil
}

// vazio: chave ausente ou null explícito (validação dos corpos compostos das Tasks 4 e 6).
func vazio(v json.RawMessage) bool { return len(v) == 0 || string(v) == "null" }
```

- [ ] **Step 4: Rodar e ver passar (e morder).** `gofmt -l ./internal && go vet ./internal/frota/ && go test -count=1 -v ./internal/frota/ 2>&1 | grep -E '^(--- |ok|FAIL)'` → `--- PASS` (os testes do Plano 4 inclusive). Mutação: `a == nil || a.ImpersonadorID != nil` → `a == nil`.

- [ ] **Step 5: Commit.** `git add api/internal/frota/dominio.go api/internal/frota/dominio_test.go api/internal/frota/mundo_test.go && git commit -m "feat(api): frota — mundo de teste do 5.3 e escrita recusada a quem entrou como outra pessoa"` (+ linha `Co-Authored-By`).

---

### Task 3: Veículos — `/frota/veiculos`

**Revisor:** opus. **Depende de:** 2.

**(a) Contrato** (o código; `soSessaoPropria` em toda escrita)

```go
const colunasVeiculo = `t.id, t.placa, t.nome, t.marca, t.ano, t.cor, t.combustivel, t.renavam, t.chassi, t.tipo_oleo, ` +
	`t.contrato, t.codigo_patrimonial, t.aluguel_centavos, t.fipe_centavos, t.categoria_comercial, t.blindado, t.situacao, ` +
	`t.pessoa_id, t.local_texto, t.observacao, t.criado_em, t.atualizado_em, t.seguro_seguradora, t.seguro_apolice, ` +
	`t.seguro_vence_em, t.seguro_valor_centavos, t.tag_pedagio, t.rastreador, t.bem_id, t.contato_nome, t.contato_telefone, ` +
	`t.contato_papel, t.oficina_nome, t.oficina_telefone, t.empresa_id, t.local_id, t.comodo_id`

// GET /frota/veiculos (frota_veiculos_ler: is_frota_admin()). Também é a leitura do Patrimônio
// (tela-de-patrimonio.vue:2084) e de Colaboradores e Acessos (tela-de-acessos.vue:1820, 2078, 2249).
var consultaVeiculos = dados.Consulta{Tabela: "frota_veiculos", Alias: "t", SQL: `select ` + colunasVeiculo + ` from frota_veiculos t`,
	Filtros: []dados.Filtro{{Param: "pessoa_id", SQL: "t.pessoa_id = @pessoa_id::uuid", Tipo: "uuid"}},
	Ordens:  map[string]string{"nome": "t.nome"}, OrdemPadrao: "t.nome", Desempate: "t.id"}

// POST /frota/veiculos e PATCH /frota/veiculos/{id} (frota_veiculos_escrever). A união do que as três
// telas gravam (tela-de-frota.vue:2977-2995 + valores e local; tela-de-patrimonio.vue:1296, 1312, 1328;
// tela-de-frota.vue:1551). Fora: id, blindado, criado_em (400). Mudar situacao/pessoa_id/bem_id dispara
// os gatilhos verbatim (espelho no Patrimônio, posse órfã fechada).
type corpoVeiculo struct {
	Nome                json.RawMessage `json:"nome,omitempty"`
	Placa               json.RawMessage `json:"placa,omitempty"`
	Marca               json.RawMessage `json:"marca,omitempty"`
	Ano                 json.RawMessage `json:"ano,omitempty"`
	Cor                 json.RawMessage `json:"cor,omitempty"`
	Combustivel         json.RawMessage `json:"combustivel,omitempty"`
	Renavam             json.RawMessage `json:"renavam,omitempty"`
	Chassi              json.RawMessage `json:"chassi,omitempty"`
	TipoOleo            json.RawMessage `json:"tipo_oleo,omitempty"`
	Contrato            json.RawMessage `json:"contrato,omitempty"`
	CodigoPatrimonial   json.RawMessage `json:"codigo_patrimonial,omitempty"`
	AluguelCentavos     json.RawMessage `json:"aluguel_centavos,omitempty"`
	FipeCentavos        json.RawMessage `json:"fipe_centavos,omitempty"`
	CategoriaComercial  json.RawMessage `json:"categoria_comercial,omitempty"`
	Situacao            json.RawMessage `json:"situacao,omitempty"`
	PessoaID            json.RawMessage `json:"pessoa_id,omitempty"`
	LocalTexto          json.RawMessage `json:"local_texto,omitempty"`
	Observacao          json.RawMessage `json:"observacao,omitempty"`
	AtualizadoEm        json.RawMessage `json:"atualizado_em,omitempty"`
	SeguroSeguradora    json.RawMessage `json:"seguro_seguradora,omitempty"`
	SeguroApolice       json.RawMessage `json:"seguro_apolice,omitempty"`
	SeguroVenceEm       json.RawMessage `json:"seguro_vence_em,omitempty"`
	SeguroValorCentavos json.RawMessage `json:"seguro_valor_centavos,omitempty"`
	TagPedagio          json.RawMessage `json:"tag_pedagio,omitempty"`
	Rastreador          json.RawMessage `json:"rastreador,omitempty"`
	BemID               json.RawMessage `json:"bem_id,omitempty"`
	ContatoNome         json.RawMessage `json:"contato_nome,omitempty"`
	ContatoTelefone     json.RawMessage `json:"contato_telefone,omitempty"`
	ContatoPapel        json.RawMessage `json:"contato_papel,omitempty"`
	OficinaNome         json.RawMessage `json:"oficina_nome,omitempty"`
	OficinaTelefone     json.RawMessage `json:"oficina_telefone,omitempty"`
	EmpresaID           json.RawMessage `json:"empresa_id,omitempty"`
	LocalID             json.RawMessage `json:"local_id,omitempty"`
	ComodoID            json.RawMessage `json:"comodo_id,omitempty"`
}

var tabelaVeiculos = dados.Tabela{Nome: "frota_veiculos", Resposta: colunasVeiculo}

func montarVeiculos(r chi.Router, p *pgxpool.Pool) {
	deve(consultaVeiculos.Validar(autz.Producao))
	deve(tabelaVeiculos.Validar(autz.Producao))
	r.Get("/frota/veiculos", consultaVeiculos.Handler(p, autz.Producao))
	r.With(soSessaoPropria).Post("/frota/veiculos", dados.RotaCriar[corpoVeiculo](p, autz.Producao, tabelaVeiculos))
	r.With(soSessaoPropria).Patch("/frota/veiculos/{id}", dados.RotaEditar[corpoVeiculo](p, autz.Producao, tabelaVeiculos))
}
```

Erros esperados: placa repetida (`frota_veiculos_placa_key`) e bem já ligado a outro carro (`uq_frota_veiculos_bem_id`) → 409; `situacao` fora da lista (check) e tipo que a coluna não aceita → 400.

**(b) Testes de aceitação** (`TestVeiculos`, com `m.rodar`; "intacto"/"total igual" conferidos por `efeito`)
- Leitura: `motorista` GET → `Gol` antes de `Uno` (`"placa":"AAA1A11"`); `?pessoa_id=`pMotorista → só V1; `?pessoa_id=x` → 400; `?pessoa_id=`pMotorista`&contar=1&limite=1` → `X-Total-Count: 1`. **Vazamento:** cada pessoa de `semFrota` GET → `200 []`.
- Criar: `motorista` POST `{"placa":"CCC3C33","nome":"Kwid","situacao":"ativo","aluguel_centavos":150000}` → 201 com `"aluguel_centavos":150000`; forma do Patrimônio `{"nome":"Kwid 2","placa":"DDD4D44","marca":null,"bem_id":"<bemCarro2>","situacao":"ativo"}` → 201 e `patrimonio_bens(bemCarro2).situacao = 'em_uso'` (gatilho no INSERT); placa `AAA1A11` → 409 e `bem_id` = bemCarro → 409, total igual; `"blindado":true` → 400 `corpo_invalido`; `"situacao":"voando"` → 400; `"ano":"dois mil"` → 400; total igual nos três. Cada pessoa de `semFrota` POST → 403, total igual; `impersonado` → 403 com "Quem entrou como outra pessoa", total igual.
- Editar: `motorista` PATCH V2 `{"situacao":"em_manutencao"}` → 200; PATCH V1 `{"situacao":"inativo","atualizado_em":"2026-10-12T10:00:00Z"}` → 200 e `patrimonio_bens(bemCarro).situacao = 'em_estoque'`; PATCH V1 `{"pessoa_id":null}` → 200 e U1 com `volta_em` preenchido (posse órfã fechada pelo gatilho); PATCH V1 `{"bem_id":null}` → 200. **IDOR/vazamento:** `admin` e `soAprovar` PATCH V1 `{"nome":"x"}` → 404, nome intacto; id inexistente e `nao-e-uuid` → 404; `impersonado` → 403, intacto.
- Mutações que têm de reprovar: tirar `soSessaoPropria` do PATCH; montar a consulta com `Tabela: "frota_uso"` (o `Validar` acusa: `deve` derruba a montagem).

**(c) Arquivos:** Create `api/internal/frota/veiculos.go`, `api/internal/frota/veiculos_test.go`.

**(d) Dependências:** Task 2; `dados.Consulta/Tabela/RotaCriar/RotaEditar`.

- [ ] **Step 1:** `veiculos_test.go` com os casos; `go test -count=1 -run TestVeiculos ./internal/frota/` → FAIL (`montarVeiculos`).
- [ ] **Step 2:** Implementar `veiculos.go` (o contrato acima, com imports `encoding/json`, `chi`, `pgxpool`, `autz`, `dados`).
- [ ] **Step 3:** `gofmt -l ./internal && go vet ./internal/frota/ && go test -count=1 -v -run TestVeiculos ./internal/frota/` → PASS; mutações reprovam.
- [ ] **Step 4:** Commit `feat(api): /frota/veiculos com a regra de produção e os espelhos no Patrimônio` (+ `Co-Authored-By`).

---

### Task 4: Uso — retirada, devolução e troca de posse numa transação

**Revisor:** opus. **Depende de:** 2, 3 (`tabelaVeiculos`).

**(a) Contrato**
- `GET /frota/usos`: filtros `aberta` (booleano: `(t.volta_em is null) = @aberta::boolean`), `veiculo_id` (uuid), `saida_de`/`saida_ate` (data, `t.saida_em >= / <= @x::date`: o cast do PostgREST, Ruling 5.3-14); ordem `saida_em`, padrão `t.saida_em desc`, desempate `t.id`.
- `POST /frota/usos` (retirada; `tipo` fica `viagem`): `veiculo_id, saida_em, pessoa_id, pessoa_nome, km_saida, tanque_quartos, destino, finalidade, observacao, aceite_em, aceite_nome, aceite_rabisco, aceite_checklist_id, aceite_checklist_hash` → 201. `aceite_por`/`aceite_em` são do gatilho `frota_aceite_imutavel` (o `aceite_em` do pedido só liga o carimbo). Carro já fora (`uniq_frota_uso_um_aberto`) → 409.
- `PATCH /frota/usos/{id}` (devolução): `volta_em, km_volta, tanque_quartos` → 200.
- `POST /frota/usos/trocar` (Ruling 5.3-8) `{veiculo_id, fechar?: {id, volta_em}, abrir?: {pessoa_id, pessoa_nome, saida_em}, para_estoque?: bool}` → `200 {"fechado": <id>|null, "aberto": <id>|null}`, tudo numa transação: (1) `PodeEditar` da posse a fechar; conferir que ela AINDA é a posse aberta daquele carro (`veiculo_id` igual, `tipo = 'posse'`, `volta_em is null`; senão `409 conflito` "Alguém mexeu neste carro agora há pouco. Recarregue para ver."); `tabelaUsos.Editar` com `{volta_em}`; (2) `tabelaUsos.Criar` com `abrir` + `veiculo_id` do topo + `tipo = 'posse'`; (3) `para_estoque` → `tabelaVeiculos.Editar(veiculo_id, {situacao: 'inativo'})`. Inválido (sem `veiculo_id`, nada a fazer, `para_estoque` com `abrir`, `fechar` sem `id`/`volta_em`) → 400 `pedido_invalido`; campo a mais em `abrir` (inclusive `tipo`, `veiculo_id`) → 400 `corpo_invalido`.

```go
const colunasUso = `t.id, t.veiculo_id, t.pessoa_id, t.pessoa_nome, t.saida_em, t.km_saida, t.volta_em, t.km_volta, ` +
	`t.destino, t.finalidade, t.tanque_quartos, t.observacao, t.criado_em, t.tipo, t.aceite_em, t.aceite_por, ` +
	`t.aceite_nome, t.aceite_rabisco, t.aceite_checklist_id, t.aceite_checklist_hash`

var consultaUsos = dados.Consulta{Tabela: "frota_uso", Alias: "t", SQL: `select ` + colunasUso + ` from frota_uso t`,
	Filtros: []dados.Filtro{
		{Param: "aberta", SQL: "(t.volta_em is null) = @aberta::boolean", Tipo: "booleano"},
		{Param: "veiculo_id", SQL: "t.veiculo_id = @veiculo_id::uuid", Tipo: "uuid"},
		{Param: "saida_de", SQL: "t.saida_em >= @saida_de::date", Tipo: "data"},
		{Param: "saida_ate", SQL: "t.saida_em <= @saida_ate::date", Tipo: "data"},
	},
	Ordens: map[string]string{"saida_em": "t.saida_em"}, OrdemPadrao: "t.saida_em desc", Desempate: "t.id"}

type corpoRetirada struct {
	VeiculoID           json.RawMessage `json:"veiculo_id,omitempty"`
	SaidaEm             json.RawMessage `json:"saida_em,omitempty"`
	PessoaID            json.RawMessage `json:"pessoa_id,omitempty"`
	PessoaNome          json.RawMessage `json:"pessoa_nome,omitempty"`
	KmSaida             json.RawMessage `json:"km_saida,omitempty"`
	TanqueQuartos       json.RawMessage `json:"tanque_quartos,omitempty"`
	Destino             json.RawMessage `json:"destino,omitempty"`
	Finalidade          json.RawMessage `json:"finalidade,omitempty"`
	Observacao          json.RawMessage `json:"observacao,omitempty"`
	AceiteEm            json.RawMessage `json:"aceite_em,omitempty"`
	AceiteNome          json.RawMessage `json:"aceite_nome,omitempty"`
	AceiteRabisco       json.RawMessage `json:"aceite_rabisco,omitempty"`
	AceiteChecklistID   json.RawMessage `json:"aceite_checklist_id,omitempty"`
	AceiteChecklistHash json.RawMessage `json:"aceite_checklist_hash,omitempty"`
}

type corpoDevolucao struct {
	VoltaEm       json.RawMessage `json:"volta_em,omitempty"`
	KmVolta       json.RawMessage `json:"km_volta,omitempty"`
	TanqueQuartos json.RawMessage `json:"tanque_quartos,omitempty"`
}

var tabelaUsos = dados.Tabela{Nome: "frota_uso", Resposta: colunasUso}

// pedidoTroca: POST /frota/usos/trocar — o "passar o carro" (tela-de-frota.vue:1513, 1524, 1551) e a troca
// do dono fixo (3451, 3466) numa transação só (Ruling 5.3-8).
type pedidoTroca struct {
	VeiculoID   string      `json:"veiculo_id"`
	Fechar      *fechamento `json:"fechar"`
	Abrir       *corpoPosse `json:"abrir"`
	ParaEstoque bool        `json:"para_estoque"`
}

type fechamento struct {
	ID      string          `json:"id"`
	VoltaEm json.RawMessage `json:"volta_em"`
}

// corpoPosse: a posse nova; veiculo_id vem do topo e tipo é sempre 'posse' (pedido não escolhe).
type corpoPosse struct {
	PessoaID   json.RawMessage `json:"pessoa_id,omitempty"`
	PessoaNome json.RawMessage `json:"pessoa_nome,omitempty"`
	SaidaEm    json.RawMessage `json:"saida_em,omitempty"`
}

var errPosseMudou = errors.New("frota: a posse a fechar não é mais a aberta deste carro")

func trocarPosse(p *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		e := autz.EscopoDo(r.Context())
		if e == nil {
			dados.Erro(w, http.StatusInternalServerError, "erro_interno", "")
			return
		}
		var in pedidoTroca
		if !dados.LerCorpo(w, r, &in) {
			return
		}
		if in.VeiculoID == "" || (in.Fechar == nil && in.Abrir == nil && !in.ParaEstoque) || (in.ParaEstoque && in.Abrir != nil) ||
			(in.Fechar != nil && (in.Fechar.ID == "" || vazio(in.Fechar.VoltaEm))) {
			dados.Erro(w, http.StatusBadRequest, "pedido_invalido",
				"Diga o carro e o que fazer: fechar a posse aberta, abrir a nova ou recolher para o estoque.")
			return
		}
		var abrir map[string]any
		if in.Abrir != nil {
			var err error
			if abrir, err = dados.Campos(in.Abrir); err != nil {
				dados.Erro(w, http.StatusInternalServerError, "erro_interno", "")
				return
			}
			abrir["veiculo_id"], abrir["tipo"] = in.VeiculoID, "posse"
		}
		var fechado, aberto *string
		ctx := r.Context()
		err := banco.ComUsuario(ctx, p, e.ID, func(tx pgx.Tx) error {
			if in.Fechar != nil {
				volta := map[string]any{"volta_em": in.Fechar.VoltaEm}
				// PodeEditar ANTES da conferência: linha invisível = 404, sem dizer se existe ou se está aberta
				if err := autz.Producao.PodeEditar(ctx, tx, e, "frota_uso", in.Fechar.ID, volta); err != nil {
					return err
				}
				var aberta bool
				if err := tx.QueryRow(ctx, `select veiculo_id = @veiculo::uuid and tipo = 'posse' and volta_em is null
					from frota_uso where id = @id::uuid`, pgx.NamedArgs{"veiculo": in.VeiculoID, "id": in.Fechar.ID}).Scan(&aberta); err != nil {
					return err
				}
				if !aberta {
					return errPosseMudou
				}
				if _, err := tabelaUsos.Editar(ctx, tx, autz.Producao, e, in.Fechar.ID, volta); err != nil {
					return err
				}
				fechado = &in.Fechar.ID
			}
			if abrir != nil {
				linha, err := tabelaUsos.Criar(ctx, tx, autz.Producao, e, abrir)
				if err != nil {
					return err // carro na rua = uniq_frota_uso_um_aberto = 409, e o fechamento acima é desfeito
				}
				id, err := idDaLinha(linha)
				if err != nil {
					return err
				}
				aberto = &id
			}
			if in.ParaEstoque {
				if _, err := tabelaVeiculos.Editar(ctx, tx, autz.Producao, e, in.VeiculoID, map[string]any{"situacao": "inativo"}); err != nil {
					return err
				}
			}
			return nil
		})
		if errors.Is(err, errPosseMudou) {
			dados.Erro(w, http.StatusConflict, "conflito", "Alguém mexeu neste carro agora há pouco. Recarregue para ver.")
			return
		}
		if err != nil {
			dados.ErroDeEscrita(w, err)
			return
		}
		corpo, _ := json.Marshal(map[string]*string{"fechado": fechado, "aberto": aberto})
		dados.Responder(w, http.StatusOK, corpo)
	}
}

func montarUsos(r chi.Router, p *pgxpool.Pool) {
	deve(consultaUsos.Validar(autz.Producao))
	deve(tabelaUsos.Validar(autz.Producao))
	r.Get("/frota/usos", consultaUsos.Handler(p, autz.Producao))
	r.With(soSessaoPropria).Post("/frota/usos", dados.RotaCriar[corpoRetirada](p, autz.Producao, tabelaUsos))
	r.With(soSessaoPropria).Patch("/frota/usos/{id}", dados.RotaEditar[corpoDevolucao](p, autz.Producao, tabelaUsos))
	r.With(soSessaoPropria).Post("/frota/usos/trocar", trocarPosse(p))
}
```

**(b) Testes de aceitação**
- `TestRetiradaETrocaConcorrentes` (código abaixo): duas retiradas do V2 juntas → `{201, 409}` e uma linha aberta; duas trocas fechando U1 juntas → `{200, 409}`, uma posse aberta no V1 e U1 fechada uma vez só.
- `TestUsos` (`m.rodar`): leitura `?aberta=true` → U1 sem U2; `?aberta=false&limite=400` → U2; `?saida_de=2026-10-02&saida_ate=2026-10-03` → só U2; `?aberta=talvez` → 400; **vazamento:** `semFrota` → `[]`. Retirada `motorista` POST `{"veiculo_id":V2,"km_saida":150,"tanque_quartos":3,"destino":"Campinas","aceite_em":"2020-01-01T00:00:00Z","aceite_nome":"Motorista","aceite_rabisco":[[[0,0],[1,1]]],"aceite_checklist_id":C2,"aceite_checklist_hash":null}` → 201 com `aceite_por` = motorista, `aceite_em` > 2026-01-01, `tipo` = `viagem` e +1 em `frota_uso_pdf`; retirar o V1 (posse aberta) → 409, total igual; `"aceite_por"` ou `"tipo"` no corpo → 400 `corpo_invalido`; `"tanque_quartos":5` → 400; `semFrota` POST → 403 e `impersonado` → 403, total igual. Devolução da viagem criada `{"volta_em":"2026-10-12T18:00:00Z","km_volta":180,"tanque_quartos":2}` → 200; `km_volta` 100 (menor que a saída) → 400, intacta; `admin` PATCH U1 → 404, intacta; `impersonado` → 403.
- `TestTrocarPosse` (`m.rodar`, buscando os ids novos com `m.um`): passar o V1 a uma pessoa de fora (`fechar` U1 às 10h, `abrir` `{"pessoa_id":null,"pessoa_nome":"Fulano de Fora","saida_em":"2026-10-12T10:00:00Z"}`) → 200 com `"fechado":"<U1>"`, U1 fechada às 10h e a nova `tipo = 'posse'` com o nome; devolver ao dono fixo (fecha a nova, abre `pMotorista`) → 200; recolher para o estoque (fecha a aberta, `para_estoque: true`) → 200, nenhuma aberta no V1, V1 `inativo` e `bemCarro` `em_estoque` (gatilho); fechar de novo a posse já fechada → 409 com "Alguém mexeu neste carro", nada muda; fechar com `veiculo_id` = V2 uma posse do V1 → 409; fechar uma VIAGEM pela troca → 409; **`abrir` com `saida_em` inválido → 400 e a posse que ia fechar CONTINUA aberta (uma transação só)**; `para_estoque` com `abrir` → 400; `{}` → 400; `fechar` sem `volta_em` → 400; `abrir` com `tipo` ou `veiculo_id` → 400 `corpo_invalido`. **IDOR/vazamento:** `admin` com `fechar` U1 → 404 e nada muda; `admin` só com `abrir` → 403; `impersonado` → 403.
- Mutações que têm de reprovar: tirar a conferência `volta_em is null` (a posse já fechada é sobrescrita e responde 200); um `banco.ComUsuario` por passo (o caso "abrir inválido" deixa a posse fechada); `uniq_frota_uso_um_aberto` apagado da fatia (a corrida dá `{201, 201}`).

```go
// corridaDeDois dispara os dois pedidos ao mesmo tempo e devolve os status em ordem crescente.
func corridaDeDois(t *testing.T, m *mundo, a, b, metodo, caminho, corpo string) [2]int {
	t.Helper()
	var st [2]int
	var wg sync.WaitGroup
	for i, quem := range []string{a, b} {
		wg.Add(1)
		go func() {
			defer wg.Done()
			w := m.resposta(t, quem, metodo, caminho, corpo)
			st[i] = w.Code
		}()
	}
	wg.Wait()
	if st[0] > st[1] {
		st[0], st[1] = st[1], st[0]
	}
	return st
}

// Duas pessoas pegando o mesmo carro: o índice parcial decide (um 201, um 409). Duas trocas fechando a
// mesma posse: o PodeEditar trava a linha e a conferência acusa a segunda (um 200, um 409).
func TestRetiradaETrocaConcorrentes(t *testing.T) {
	m := novoMundo(t, montarUsos)
	if st := corridaDeDois(t, m, "motorista", "motorista2", "POST", "/frota/usos", `{"veiculo_id":"`+V2+`","km_saida":150}`); st != [2]int{201, 409} {
		t.Errorf("retiradas simultâneas = %v, esperava [201 409]", st)
	}
	if v := m.um(t, `select count(*)::text from frota_uso where veiculo_id = '`+V2+`' and volta_em is null`); v != "1" {
		t.Errorf("V2 com %s saídas abertas", v)
	}
	troca := `{"veiculo_id":"` + V1 + `","fechar":{"id":"` + U1 + `","volta_em":"2026-10-12T10:00:00Z"},` +
		`"abrir":{"pessoa_id":null,"pessoa_nome":"Fulano de Fora","saida_em":"2026-10-12T10:00:00Z"}}`
	if st := corridaDeDois(t, m, "motorista", "motorista2", "POST", "/frota/usos/trocar", troca); st != [2]int{200, 409} {
		t.Errorf("trocas simultâneas = %v, esperava [200 409]", st)
	}
	if v := m.um(t, `select count(*) filter (where volta_em is null)::text || '/' ||
		(select volta_em::text from frota_uso where id = '`+U1+`') from frota_uso where veiculo_id = '`+V1+`'`); v != "1/2026-10-12 10:00:00+00" {
		t.Errorf("V1 depois da corrida = %s", v)
	}
}
```

**(c) Arquivos:** Create `api/internal/frota/usos.go`, `api/internal/frota/usos_test.go`.

**(d) Dependências:** Tasks 2 e 3; `autz.Producao.PodeEditar`; `banco.ComUsuario`; `dados.Tabela.Criar/Editar/Campos/LerCorpo/Responder/ErroDeEscrita`.

- [ ] **Step 1:** Testes; `go test -count=1 -race -run 'Usos|TrocarPosse|Concorrentes' ./internal/frota/` → FAIL (`montarUsos`).
- [ ] **Step 2:** Implementar `usos.go` (o contrato acima).
- [ ] **Step 3:** `gofmt -l ./internal && go vet ./internal/frota/ && go test -count=5 -race -v -run 'Usos|TrocarPosse|Concorrentes' ./internal/frota/` → PASS nas 5 rodadas; mutações reprovam.
- [ ] **Step 4:** Commit `feat(api): /frota/usos e a troca de posse numa transação (carro em duas mãos = 409)` (+ `Co-Authored-By`).

---

### Task 5: Reservas — `/frota/requisicoes`

**Revisor:** opus. **Depende de:** 2.

**(a) Contrato**

```go
const colunasRequisicao = `t.id, t.veiculo_id, t.pessoa_id, t.pessoa_nome, t.departamento, t.destino, t.finalidade, ` +
	`t.retirada_prevista, t.devolucao_prevista, t.situacao, t.criada_por, t.criada_em, t.decidida_por, t.decidida_em, ` +
	`t.motivo_decisao, t.uso_id, t.observacao, t.encerrada_por, t.encerrada_em, t.encerrada_motivo, t.arquivada_em, t.arquivada_por`

// GET /frota/requisicoes (frota_req_ler: is_frota_admin() — quem vê a Frota vê a agenda inteira).
var consultaRequisicoes = dados.Consulta{Tabela: "frota_requisicoes", Alias: "t",
	SQL:    `select ` + colunasRequisicao + ` from frota_requisicoes t`,
	Ordens: map[string]string{"retirada_prevista": "t.retirada_prevista"}, OrdemPadrao: "t.retirada_prevista", Desempate: "t.id"}

// POST /frota/requisicoes (frota_req_criar: is_frota_admin() AND criada_por = auth.uid()). criada_por vem
// da sessão por Tabela.Autor — e TEM de estar no mapa: o PodeCriar exige toda coluna que a regra lê.
// Sem situacao: a reserva nasce pendente (Ruling 5.3-11). tela-de-frota.vue:2439.
type corpoReservaNova struct {
	VeiculoID         json.RawMessage `json:"veiculo_id,omitempty"`
	PessoaID          json.RawMessage `json:"pessoa_id,omitempty"`
	PessoaNome        json.RawMessage `json:"pessoa_nome,omitempty"`
	Departamento      json.RawMessage `json:"departamento,omitempty"`
	Destino           json.RawMessage `json:"destino,omitempty"`
	Finalidade        json.RawMessage `json:"finalidade,omitempty"`
	RetiradaPrevista  json.RawMessage `json:"retirada_prevista,omitempty"`
	DevolucaoPrevista json.RawMessage `json:"devolucao_prevista,omitempty"`
	Observacao        json.RawMessage `json:"observacao,omitempty"`
}

// PATCH /frota/requisicoes/{id} (frota_req_atualizar: is_frota_admin()). Quem pode decidir, cancelar,
// revogar, arquivar ou mudar o conteúdo é o GATILHO (frota_checar_decisao, frota_checar_arquivamento),
// com a frase dele; quem decidiu/encerrou/arquivou e o histórico também (auth.uid()). As colunas e os
// valores de situacao são os que a tela grava (1718, 2486, 2743, 2796, 2833).
type corpoReservaEdicao struct {
	VeiculoID         json.RawMessage `json:"veiculo_id,omitempty"`
	PessoaID          json.RawMessage `json:"pessoa_id,omitempty"`
	PessoaNome        json.RawMessage `json:"pessoa_nome,omitempty"`
	Departamento      json.RawMessage `json:"departamento,omitempty"`
	Destino           json.RawMessage `json:"destino,omitempty"`
	Finalidade        json.RawMessage `json:"finalidade,omitempty"`
	RetiradaPrevista  json.RawMessage `json:"retirada_prevista,omitempty"`
	DevolucaoPrevista json.RawMessage `json:"devolucao_prevista,omitempty"`
	Observacao        json.RawMessage `json:"observacao,omitempty"`
	Situacao          json.RawMessage `json:"situacao,omitempty"`
	MotivoDecisao     json.RawMessage `json:"motivo_decisao,omitempty"`
	EncerradaMotivo   json.RawMessage `json:"encerrada_motivo,omitempty"`
	ArquivadaEm       json.RawMessage `json:"arquivada_em,omitempty"`
	UsoID             json.RawMessage `json:"uso_id,omitempty"`
}

// Validar: situacao só com os valores que a tela grava (Ruling 5.3-11): nada volta a 'pendente'.
func (c corpoReservaEdicao) Validar() error {
	if c.Situacao == nil {
		return nil
	}
	var s string
	if json.Unmarshal(c.Situacao, &s) != nil || !slices.Contains([]string{"aprovada", "recusada", "cancelada", "revogada", "usada"}, s) {
		return errors.New("situacao deve ser aprovada, recusada, cancelada, revogada ou usada")
	}
	return nil
}

var tabelaRequisicoes = dados.Tabela{Nome: "frota_requisicoes", Resposta: colunasRequisicao, Autor: "criada_por"}

func montarRequisicoes(r chi.Router, p *pgxpool.Pool) // GET; POST e PATCH {id} com soSessaoPropria. Sem DELETE (não há policy).
```

O aviso a quem pediu continua sendo `POST /avisar-decisao-de-reserva` (Plano 4), chamado pela tela depois do PATCH — nada de push aqui.

**(b) Testes de aceitação** (`TestReservas`, com `m.rodar`; "intacta" = `situacao`/coluna conferida e contagem de `frota_requisicoes_historico` igual)
- Leitura: `motorista` GET → R1 antes de R2. **Vazamento:** `semFrota` → `[]`.
- Criar: `motorista` POST `{"veiculo_id":V2,"retirada_prevista":"2026-10-25T12:00:00Z","destino":"Campinas"}` → 201 com `criada_por` = motorista e `situacao` = `pendente`; `"criada_por":aprovador` → 400 `corpo_invalido`; `"situacao":"aprovada"` → 400 `corpo_invalido` (não nasce aprovada); `devolucao_prevista` antes da retirada → 400; total igual nos três; `semFrota` POST → 403 e `impersonado` → 403, total igual.
- Decidir: `motorista` PATCH R1 `{"situacao":"aprovada"}` → 400 `regra_de_negocio` "Você não tem permissão para aprovar requisições de veículo.", intacta; `soAprovar` (tem a feature, não lê) → 404, intacta; `aprovador` PATCH R1 `{"situacao":"aprovada","motivo_decisao":null}` → 200 com `decidida_por` = aprovador e 1 linha de histórico `situação pendente→aprovada` com `quem` = aprovador; `superFicha` decide R1 de volta para `recusada` com motivo → 200 (`decidida_por` = superFicha).
- Encerrar: `aprovador` PATCH R2 `{"situacao":"cancelada"}` → 400 "Escreva o motivo do cancelamento ou da revogação.", intacta; com `encerrada_motivo` → 200 e `encerrada_por` = aprovador; `motorista` revoga → 400 "Você não pode cancelar nem revogar…".
- Editar conteúdo: `motorista` PATCH R1 `{"destino":"Sorocaba"}` → 400 "Você não pode alterar reserva de veículo. Peça a quem aprova.", intacta; reserva encerrada editada pelo aprovador → 400 "Esta reserva já está …".
- Arquivar: `aprovador` arquiva reserva pendente → 400 "Só reserva encerrada ou vencida pode ser arquivada…"; arquiva a cancelada → 200 com `arquivada_por` = aprovador; `motorista` arquiva → 400 "Você não pode arquivar reserva de veículo…".
- Elo com a viagem: `motorista` PATCH `{"uso_id":U2,"situacao":"usada"}` → 200 (sem gatilho de permissão: paridade).
- `{"situacao":"pendente"}` → 400 `pedido_invalido`; `{"decidida_por":…}` → 400 `corpo_invalido`; id inexistente → 404; `admin` PATCH R1 → 404; `impersonado` → 403, intacta.
- Mutações que têm de reprovar: `Autor: ""` em `tabelaRequisicoes` (o POST não passa: a regra lê `criada_por`); PATCH gravando por `p.Exec` fora de `banco.ComUsuario` (o aprovador recebe a recusa do gatilho); tirar o `Validar` (`pendente` passa).

**(c) Arquivos:** Create `api/internal/frota/requisicoes.go`, `api/internal/frota/requisicoes_test.go`.

**(d) Dependências:** Task 2.

- [ ] **Step 1:** Testes; ver falhar. - [ ] **Step 2:** Implementar. - [ ] **Step 3:** gofmt/vet/test PASS; mutações reprovam. - [ ] **Step 4:** Commit `feat(api): /frota/requisicoes — reserva com autoria da sessão e decisão pelos gatilhos de produção` (+ `Co-Authored-By`).

---

### Task 6: Checklist numa gravação só e leituras das fichas

**Revisor:** opus. **Depende de:** 2.

**(a) Contrato**
- `GET /frota/checklists`: filtros `veiculo_id` (uuid), `feita_de`/`feita_ate` (data), `assinada` (booleano: `(t.assinada_em is not null) = @assinada::boolean`); ordem `feita_em`, padrão `t.feita_em desc`. Atende 1097 (120 dias), 2146 (hash anterior: `?veiculo_id=&assinada=true&ordem=feita_em.desc&limite=1`), 3124 e `relatorios-da-frota.js:101`.
- `GET /frota/checklists/respostas`: filtro `checklist_id` (`uuid[]`: `t.checklist_id = any(@checklist_id::uuid[])`); ordem padrão `t.ordem`, desempate `t.id`.
- `GET /frota/checklists/copias` (fila do PDF, `frota_checklist_pdf`): colunas `checklist_id, situacao, tentativas, ultimo_erro, criado_em, enviado_em`; filtros `situacao` (texto), `pendente` (booleano: `(t.situacao <> 'enviado') = @pendente::boolean`); ordem `criado_em`, padrão `t.criado_em`.
- `POST /frota/checklists` `{ficha, respostas, assinatura?}` → `201` com a ficha (pela lista da leitura) — Ruling 5.3-7. Numa transação: `tabelaChecklists.Criar(ficha)` (com `criada_por` = sessão), cada resposta por `tabelaRespostas.Criar` com `checklist_id` e `ordem` = posição (a ordem entra na impressão digital, migration 032), e, se há assinatura, `tabelaChecklists.Editar(id, assinatura + assinada_por = sessão)` — o gatilho de imutabilidade só dispara com a ficha JÁ assinada, e o da fila do PDF enfileira. Qualquer passo falhando desfaz tudo. Até 200 respostas; assinatura exige `assinada_em` e `assinatura_hash`; assinatura com `sem_assinatura_motivo` → 400 `pedido_invalido`. Segunda ficha do carro no dia → 409. A senha é conferida antes pela tela em `POST /conferir-senha` (5.0), como hoje.

```go
const colunasChecklist = `t.id, t.veiculo_id, t.pessoa_id, t.pessoa_nome, t.feita_em, t.cadencias, t.hodometro, ` +
	`t.hodometro_justificativa, t.resultado, t.anomalias, t.criada_em, t.criada_por, t.aberta_em, t.assinada_em, ` +
	`t.assinada_por, t.assinatura_hash, t.assinatura_hash_anterior, t.sem_assinatura_motivo, t.assinatura_rabisco, t.assinatura_versao`
const colunasResposta = `t.id, t.checklist_id, t.item_id, t.item_texto, t.cadencia, t.estado, t.observacao, t.ordem`
const colunasCopia = `t.checklist_id, t.situacao, t.tentativas, t.ultimo_erro, t.criado_em, t.enviado_em`

var consultaChecklists = dados.Consulta{Tabela: "frota_checklist", Alias: "t", SQL: `select ` + colunasChecklist + ` from frota_checklist t`,
	Filtros: []dados.Filtro{
		{Param: "veiculo_id", SQL: "t.veiculo_id = @veiculo_id::uuid", Tipo: "uuid"},
		{Param: "feita_de", SQL: "t.feita_em >= @feita_de::date", Tipo: "data"},
		{Param: "feita_ate", SQL: "t.feita_em <= @feita_ate::date", Tipo: "data"},
		{Param: "assinada", SQL: "(t.assinada_em is not null) = @assinada::boolean", Tipo: "booleano"},
	},
	Ordens: map[string]string{"feita_em": "t.feita_em"}, OrdemPadrao: "t.feita_em desc", Desempate: "t.id"}

var consultaRespostas = dados.Consulta{Tabela: "frota_checklist_respostas", Alias: "t",
	SQL:     `select ` + colunasResposta + ` from frota_checklist_respostas t`,
	Filtros: []dados.Filtro{{Param: "checklist_id", SQL: "t.checklist_id = any(@checklist_id::uuid[])", Tipo: "uuid[]"}},
	Ordens:  map[string]string{"ordem": "t.ordem"}, OrdemPadrao: "t.ordem", Desempate: "t.id"}

// A fila do PDF (frota_checklist_pdf_ler: is_frota_admin()): as três leituras de "cópias no Zoho".
var consultaCopias = dados.Consulta{Tabela: "frota_checklist_pdf", Alias: "t", SQL: `select ` + colunasCopia + ` from frota_checklist_pdf t`,
	Filtros: []dados.Filtro{
		{Param: "situacao", SQL: "t.situacao = @situacao::text", Tipo: "texto"},
		{Param: "pendente", SQL: "(t.situacao <> 'enviado') = @pendente::boolean", Tipo: "booleano"},
	},
	Ordens: map[string]string{"criado_em": "t.criado_em"}, OrdemPadrao: "t.criado_em", Desempate: "t.id"}

var tabelaChecklists = dados.Tabela{Nome: "frota_checklist", Resposta: colunasChecklist, Autor: "criada_por"}
var tabelaRespostas = dados.Tabela{Nome: "frota_checklist_respostas", Resposta: colunasResposta}

// A ficha (painel-de-checklist.vue:217-232 + pessoa e motivo, tela-de-frota.vue:2117, 2195). Fora:
// criada_por, assinada_* (vêm da sessão ou da assinatura) — mandar = 400.
type corpoFicha struct {
	VeiculoID              json.RawMessage `json:"veiculo_id,omitempty"`
	FeitaEm                json.RawMessage `json:"feita_em,omitempty"`
	PessoaID               json.RawMessage `json:"pessoa_id,omitempty"`
	PessoaNome             json.RawMessage `json:"pessoa_nome,omitempty"`
	Cadencias              json.RawMessage `json:"cadencias,omitempty"`
	Hodometro              json.RawMessage `json:"hodometro,omitempty"`
	HodometroJustificativa json.RawMessage `json:"hodometro_justificativa,omitempty"`
	Resultado              json.RawMessage `json:"resultado,omitempty"`
	Anomalias              json.RawMessage `json:"anomalias,omitempty"`
	SemAssinaturaMotivo    json.RawMessage `json:"sem_assinatura_motivo,omitempty"`
}

// Uma resposta; checklist_id e ordem são da rota.
type corpoResposta struct {
	ItemID     json.RawMessage `json:"item_id,omitempty"`
	ItemTexto  json.RawMessage `json:"item_texto,omitempty"`
	Cadencia   json.RawMessage `json:"cadencia,omitempty"`
	Estado     json.RawMessage `json:"estado,omitempty"`
	Observacao json.RawMessage `json:"observacao,omitempty"`
}

// A assinatura (tela-de-frota.vue:2179-2193): o que foi assinado vem do corpo; assinada_por, da sessão.
type corpoAssinatura struct {
	AbertaEm               json.RawMessage `json:"aberta_em,omitempty"`
	AssinadaEm             json.RawMessage `json:"assinada_em,omitempty"`
	AssinaturaHash         json.RawMessage `json:"assinatura_hash,omitempty"`
	AssinaturaHashAnterior json.RawMessage `json:"assinatura_hash_anterior,omitempty"`
	AssinaturaVersao       json.RawMessage `json:"assinatura_versao,omitempty"`
	AssinaturaRabisco      json.RawMessage `json:"assinatura_rabisco,omitempty"`
}

type pedidoFicha struct {
	Ficha      corpoFicha       `json:"ficha"`
	Respostas  []corpoResposta  `json:"respostas"`
	Assinatura *corpoAssinatura `json:"assinatura"`
}

func (in pedidoFicha) validar() error {
	switch {
	case len(in.Respostas) > 200:
		return errors.New("Uma ficha tem no máximo 200 itens.")
	case in.Assinatura != nil && (vazio(in.Assinatura.AssinadaEm) || vazio(in.Assinatura.AssinaturaHash)):
		return errors.New("A assinatura precisa da hora e da impressão digital.")
	case in.Assinatura != nil && !vazio(in.Ficha.SemAssinaturaMotivo):
		return errors.New("Ficha assinada não tem motivo de ficar sem assinatura.")
	}
	return nil
}

// gravarFicha: POST /frota/checklists. Hoje são 3 gravações (tela-de-frota.vue:2209, 2229, 2247) e a tela
// trata à mão a ficha que ficou sem respostas ou sem assinatura — estados que o índice "um carro, um dia,
// uma ficha" e o gatilho de imutabilidade tornam PERMANENTES. Aqui é uma transação (Ruling 5.3-7).
func gravarFicha(p *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		e := autz.EscopoDo(r.Context())
		if e == nil {
			dados.Erro(w, http.StatusInternalServerError, "erro_interno", "")
			return
		}
		var in pedidoFicha
		if !dados.LerCorpo(w, r, &in) { // decodificador estrito: campo a mais em qualquer nível = 400
			return
		}
		if err := in.validar(); err != nil {
			dados.Erro(w, http.StatusBadRequest, "pedido_invalido", err.Error())
			return
		}
		ficha, err := dados.Campos(&in.Ficha)
		respostas := make([]map[string]any, len(in.Respostas))
		for i := range in.Respostas {
			if err == nil {
				respostas[i], err = dados.Campos(&in.Respostas[i])
			}
		}
		var assinatura map[string]any
		if err == nil && in.Assinatura != nil {
			if assinatura, err = dados.Campos(in.Assinatura); err == nil {
				assinatura["assinada_por"] = e.ID // autoria da sessão; o corpo não tem o campo
			}
		}
		if err != nil { // tag de struct inválida: defeito da rota
			dados.Erro(w, http.StatusInternalServerError, "erro_interno", "")
			return
		}
		ctx := r.Context()
		var linha []byte
		err = banco.ComUsuario(ctx, p, e.ID, func(tx pgx.Tx) error {
			var err error
			if linha, err = tabelaChecklists.Criar(ctx, tx, autz.Producao, e, ficha); err != nil {
				return err
			}
			id, err := idDaLinha(linha)
			if err != nil {
				return err
			}
			for i, rsp := range respostas {
				rsp["checklist_id"], rsp["ordem"] = id, i
				if _, err := tabelaRespostas.Criar(ctx, tx, autz.Producao, e, rsp); err != nil {
					return err
				}
			}
			if assinatura != nil {
				linha, err = tabelaChecklists.Editar(ctx, tx, autz.Producao, e, id, assinatura)
			}
			return err
		})
		if err != nil {
			dados.ErroDeEscrita(w, err)
			return
		}
		dados.Responder(w, http.StatusCreated, linha)
	}
}

func montarChecklists(r chi.Router, p *pgxpool.Pool) // 3 GET (consultaChecklists, consultaRespostas, consultaCopias) + POST com soSessaoPropria; deve(…Validar)
```

**(b) Testes de aceitação**
- `TestChecklistNumaGravacaoSo` (código abaixo).
- `TestLeiturasDasFichas` (`m.rodar`): `motorista` `?feita_de=2026-10-01` → C2 antes de C1; `?veiculo_id=V1&assinada=true&ordem=feita_em.desc&limite=1` → só C1 (`"assinatura_hash":"h-c1"`); `?feita_de=01/10/2026` → 400; `/respostas?checklist_id=C1,C2` → Q1; `?checklist_id=x` → 400; `/copias?pendente=true` → C1 `na_fila`; `/copias?situacao=enviado&contar=1&limite=1` → `X-Total-Count: 0`. **Vazamento:** cada pessoa de `semFrota` nas três → `[]`.
- Mutações que têm de reprovar: as respostas num `banco.ComUsuario` próprio (o caso "resposta inválida no meio" deixa a ficha); `AssinadaPor` na struct da assinatura (o caso "assinada_por no corpo" passa); não preencher `assinada_por` (o primeiro caso reprova).

```go
func TestChecklistNumaGravacaoSo(t *testing.T) {
	m := novoMundo(t, montarChecklists)
	ficha := func(veiculo, dia, extra string) string {
		return `"ficha":{"veiculo_id":"` + veiculo + `","feita_em":"` + dia + `","cadencias":["diario","semanal"],"hodometro":5200,` +
			`"resultado":"com_ressalvas","anomalias":"farol","pessoa_id":"` + pMotorista + `","pessoa_nome":"Motorista"` + extra + `}`
	}
	const respostas = `"respostas":[{"item_id":"` + I1 + `","item_texto":"Pneus","cadencia":"diario","estado":"ok","observacao":null},` +
		`{"item_id":"` + I2 + `","item_texto":"Faróis","cadencia":"semanal","estado":"nao_ok","observacao":"queimado"}]`
	const assinatura = `"assinatura":{"aberta_em":"2026-10-12T09:58:00Z","assinada_em":"2026-10-12T10:00:00Z","assinatura_hash":"h-novo",` +
		`"assinatura_hash_anterior":"h-c1","assinatura_versao":2,"assinatura_rabisco":[[[0.1,0.2],[0.3,0.4]]]}`
	corpo := func(partes ...string) string { return "{" + strings.Join(partes, ",") + "}" }
	const fichas, todas = `select count(*)::text from frota_checklist`, `select count(*)::text from frota_checklist_respostas`
	daFicha := func(v, dia, expr string) string {
		return `select ` + expr + ` from frota_checklist c where c.veiculo_id = '` + v + `' and c.feita_em = '` + dia + `'`
	}
	muitas := `"respostas":[` + strings.TrimSuffix(strings.Repeat(`{"item_texto":"x","cadencia":"diario","estado":"ok"},`, 201), ",") + `]`
	m.rodar(t, []caso{
		{"assinada numa gravação só; autoria da sessão; respostas na ordem", "motorista", "POST", "/frota/checklists",
			corpo(ficha(V2, "2026-10-12", ""), respostas, assinatura), 201, `"assinatura_hash":"h-novo"`, "",
			daFicha(V2, "2026-10-12", `c.assinada_por::text || '/' || c.criada_por::text || '/' || c.assinada_em::text || '/' ||
				(select string_agg(r.ordem || ':' || r.item_texto || ':' || r.estado, ',' order by r.ordem)
				   from frota_checklist_respostas r where r.checklist_id = c.id)`),
			idMotorista + "/" + idMotorista + "/2026-10-12 10:00:00+00/0:Pneus:ok,1:Faróis:nao_ok"},
		{"…e o gatilho a pôs na fila do PDF", "", "", "", "", 0, "", "",
			daFicha(V2, "2026-10-12", `(select p.situacao from frota_checklist_pdf p where p.checklist_id = c.id)`), "na_fila"},
		{"segunda ficha do carro no dia: 409 e nenhuma resposta solta", "motorista2", "POST", "/frota/checklists",
			corpo(ficha(V2, "2026-10-12", ""), respostas), 409, "conflito", "", todas, "3"},
		{"resposta inválida no meio: 400 e a ficha também não fica", "motorista", "POST", "/frota/checklists",
			corpo(ficha(V1, "2026-10-12", ""), strings.Replace(respostas, `"nao_ok"`, `"talvez"`, 1)), 400, "pedido_invalido", "", fichas, "3"},
		{"sem assinatura (quem não tem login): grava com o motivo", "motorista", "POST", "/frota/checklists",
			corpo(ficha(V1, "2026-10-13", `,"sem_assinatura_motivo":"sem_login"`), respostas), 201, `"sem_assinatura_motivo":"sem_login"`, "",
			daFicha(V1, "2026-10-13", `coalesce(c.assinada_em::text, '<nulo>') || '/' || coalesce(c.assinada_por::text, '<nulo>')`), "<nulo>/<nulo>"},
		{"assinatura e motivo de sem assinatura juntos: 400", "motorista", "POST", "/frota/checklists",
			corpo(ficha(V1, "2026-10-14", `,"sem_assinatura_motivo":"sem_login"`), respostas, assinatura), 400, "pedido_invalido", "", fichas, "4"},
		{"assinatura sem a impressão digital: 400", "motorista", "POST", "/frota/checklists",
			corpo(ficha(V1, "2026-10-14", ""), respostas, strings.Replace(assinatura, `"assinatura_hash":"h-novo",`, "", 1)), 400, "pedido_invalido", "", fichas, "4"},
		{"assinada_por no corpo: 400", "motorista", "POST", "/frota/checklists",
			corpo(ficha(V1, "2026-10-14", ""), respostas, strings.Replace(assinatura, `"aberta_em"`, `"assinada_por":"`+idAprovador+`","aberta_em"`, 1)),
			400, "corpo_invalido", "", fichas, "4"},
		{"criada_por na ficha: 400", "motorista", "POST", "/frota/checklists",
			corpo(ficha(V1, "2026-10-14", `,"criada_por":"`+idAprovador+`"`), respostas), 400, "corpo_invalido", "", fichas, "4"},
		{"checklist_id na resposta: 400", "motorista", "POST", "/frota/checklists",
			corpo(ficha(V1, "2026-10-14", ""), strings.Replace(respostas, `"item_id"`, `"checklist_id":"`+C1+`","item_id"`, 1)), 400, "corpo_invalido", "", todas, "5"},
		{"201 respostas: 400", "motorista", "POST", "/frota/checklists", corpo(ficha(V1, "2026-10-14", ""), muitas), 400, "200 itens", "", fichas, "4"},
		{"papel admin sem a Frota: 403 e nada gravado", "admin", "POST", "/frota/checklists", corpo(ficha(V1, "2026-10-14", ""), respostas), 403, "sem_permissao", "", fichas, "4"},
		{"só frota.aprovar: 403", "soAprovar", "POST", "/frota/checklists", corpo(ficha(V1, "2026-10-14", ""), respostas), 403, "sem_permissao", "", fichas, "4"},
		{"conta desativada: nem a sessão vale (401)", "desativado", "POST", "/frota/checklists", corpo(ficha(V1, "2026-10-14", ""), respostas), 401, "", "", fichas, "4"},
		{"entrar-como não assina no nome do alvo: 403", "impersonado", "POST", "/frota/checklists",
			corpo(ficha(V1, "2026-10-14", ""), respostas, assinatura), 403, "Quem entrou como outra pessoa", "", fichas, "4"},
	})
}
```

**(c) Arquivos:** Create `api/internal/frota/checklists.go`, `api/internal/frota/checklists_test.go`.

**(d) Dependências:** Task 2 (`idDaLinha`, `vazio`).

- [ ] **Step 1:** Testes; `go test -count=1 -run 'Checklist|Fichas' ./internal/frota/` → FAIL (`montarChecklists`).
- [ ] **Step 2:** Implementar `checklists.go`.
- [ ] **Step 3:** gofmt/vet/test PASS; mutações reprovam.
- [ ] **Step 4:** Commit `feat(api): /frota/checklists — ficha, respostas e assinatura numa transação, e as leituras das fichas` (+ `Co-Authored-By`).

---

### Task 7: Itens e dias do checklist; plano de revisão

**Revisor:** sonnet. **Depende de:** 2.

**(a) Contrato** (só declarações; `soSessaoPropria` em toda escrita)

```go
const colunasItem = `t.id, t.ordem, t.item, t.cadencia, t.ativo, t.observacao, t.impede_uso`
const colunasConfig = `t.id, t.dia_semanal, t.semana_mensal, t.dia_mensal`
const colunasPlano = `t.id, t.item, t.a_cada_km, t.ordem, t.ativo, t.observacao`

// GET /frota/checklist-itens (ordem t.ordem); POST {item, cadencia, ordem} (editor-de-checklist.vue:68);
// PATCH /{id} {impede_uso, ativo} (tela-de-frota.vue:2307, 2320). Nome repetido = 409.
type corpoItemNovo struct {
	Item     json.RawMessage `json:"item,omitempty"`
	Cadencia json.RawMessage `json:"cadencia,omitempty"`
	Ordem    json.RawMessage `json:"ordem,omitempty"`
}
type corpoItemEdicao struct {
	ImpedeUso json.RawMessage `json:"impede_uso,omitempty"`
	Ativo     json.RawMessage `json:"ativo,omitempty"`
}
var tabelaItens = dados.Tabela{Nome: "frota_checklist_itens", Resposta: colunasItem}

// GET /frota/checklist-config (ordem t.id) e PATCH /frota/checklist-config {dia_semanal, semana_mensal, dia_mensal}:
// a linha única id = true, fixada pela rota com naLinha("true", …) (Ruling 5.3-16).
type corpoConfig struct {
	DiaSemanal   json.RawMessage `json:"dia_semanal,omitempty"`
	SemanaMensal json.RawMessage `json:"semana_mensal,omitempty"`
	DiaMensal    json.RawMessage `json:"dia_mensal,omitempty"`
}
var tabelaConfig = dados.Tabela{Nome: "frota_checklist_config", Resposta: colunasConfig}

// GET /frota/plano-revisao (ordem t.ordem); POST {item, a_cada_km, observacao, ordem}; PATCH /{id}
// {item, a_cada_km, observacao, ativo} (tela-de-frota.vue:2935, 2936, 2945). Sem DELETE (a tela desliga).
type corpoPlano struct {
	Item       json.RawMessage `json:"item,omitempty"`
	ACadaKm    json.RawMessage `json:"a_cada_km,omitempty"`
	Observacao json.RawMessage `json:"observacao,omitempty"`
	Ordem      json.RawMessage `json:"ordem,omitempty"`
	Ativo      json.RawMessage `json:"ativo,omitempty"`
}
var tabelaPlano = dados.Tabela{Nome: "frota_plano_revisao", Resposta: colunasPlano}

func montarConfiguracao(r chi.Router, p *pgxpool.Pool) // 3 GET; POST/PATCH dos itens; r.With(soSessaoPropria).Patch("/frota/checklist-config", naLinha("true", dados.RotaEditar[corpoConfig](…))); POST/PATCH do plano
```

**(b) Testes de aceitação** (`TestConfiguracaoDaFrota`, com `m.rodar`)
- Itens: `motorista` GET → `Pneus` antes de `Faróis`; POST `{"item":"Buzina","cadencia":"semanal","ordem":30}` → 201; `Pneus` de novo → 409; `"cadencia":"anual"` → 400; total igual nos dois; PATCH I1 `{"impede_uso":true}` → 200; PATCH I1 `{"ativo":false}` → 200; PATCH `{"item":"x"}` → 400 `corpo_invalido`.
- Dias: GET → 1 linha `"id":true`; PATCH `{"dia_semanal":3,"semana_mensal":2,"dia_mensal":4}` → 200 e gravado; `"dia_semanal":6` → 400 e intacto.
- Plano: GET → P1; POST `{"item":"Pneus","a_cada_km":40000,"observacao":null,"ordem":2}` → 201; `Troca de óleo` de novo → 409; `"a_cada_km":0` → 400; PATCH P1 `{"ativo":false}` → 200.
- **Vazamento/IDOR:** cada pessoa de `semFrota`: os três GET → `[]`; POST de item e de plano → 403 (total igual); PATCH de I1, P1 e da configuração → 404 (intactos). `impersonado` em toda escrita → 403.

**(c) Arquivos:** Create `api/internal/frota/configuracao.go`, `api/internal/frota/configuracao_test.go`.

**(d) Dependências:** Task 2 (`naLinha`).

- [ ] **Step 1:** Testes; ver falhar. - [ ] **Step 2:** Implementar. - [ ] **Step 3:** gofmt/vet/test PASS. - [ ] **Step 4:** Commit `feat(api): itens e dias do checklist e plano de revisão da frota` (+ `Co-Authored-By`).

---

### Task 8: Manutenções, revisões e abastecimentos

**Revisor:** opus (dinheiro). **Depende de:** 2.

**(a) Contrato**
- `POST /frota/manutencoes` `{manutencao: {veiculo_id, km, feita_em, oficina, total_centavos, observacao}, trocas: [{item, custo_centavos}]}` → `201` com a manutenção. Uma transação (Ruling 5.3-7): `tabelaManutencoes.Criar` (`criada_por` = sessão) e cada troca por `tabelaRevisoes.Criar` com `manutencao_id` e `veiculo_id, km, feita_em, oficina` COPIADOS do cabeçalho (`lancamento-de-manutencao.js:227-239`: a troca é do mesmo serviço) e `criada_por` = sessão. 1 a 30 trocas (`[]` → 400 "Marque ao menos uma troca."). Substitui cabeçalho + trocas + o delete de desfazer (3549, 3572, 3590).
- `GET /frota/revisoes` (ordem padrão `t.criada_em`, desempate `t.id`; a sanfona agrupa por `manutencao_id`); `DELETE /frota/revisoes/{id}` (o ✕ de cada troca, 3499) → 204.
- `GET /frota/abastecimentos` (padrão `t.abastecido_em desc`); `POST /frota/abastecimentos` (2055) `{veiculo_id, pessoa_id, pessoa_nome, abastecido_em, km, litros, total_centavos, tanque_depois, combustivel, posto, observacao}` → 201 com `criado_por` = sessão. Os checks do banco (km, litros e total positivos, tanque 0–4) → 400.

```go
const colunasManutencao = `t.id, t.veiculo_id, t.km, t.feita_em, t.oficina, t.total_centavos, t.observacao, t.criada_em, t.criada_por`
const colunasRevisao = `t.id, t.veiculo_id, t.item, t.km, t.feita_em, t.oficina, t.custo_centavos, t.observacao, t.criada_em, t.criada_por, t.manutencao_id`
const colunasAbastecimento = `t.id, t.veiculo_id, t.pessoa_id, t.pessoa_nome, t.abastecido_em, t.km, t.litros, t.total_centavos, ` +
	`t.tanque_depois, t.combustivel, t.posto, t.observacao, t.criado_em, t.criado_por`

var consultaRevisoes = dados.Consulta{Tabela: "frota_revisoes", Alias: "t", SQL: `select ` + colunasRevisao + ` from frota_revisoes t`,
	Ordens: map[string]string{"criada_em": "t.criada_em"}, OrdemPadrao: "t.criada_em", Desempate: "t.id"}
var consultaAbastecimentos = dados.Consulta{Tabela: "frota_abastecimentos", Alias: "t",
	SQL:    `select ` + colunasAbastecimento + ` from frota_abastecimentos t`,
	Ordens: map[string]string{"abastecido_em": "t.abastecido_em"}, OrdemPadrao: "t.abastecido_em desc", Desempate: "t.id"}

var tabelaManutencoes = dados.Tabela{Nome: "frota_manutencoes", Resposta: colunasManutencao, Autor: "criada_por"}
var tabelaRevisoes = dados.Tabela{Nome: "frota_revisoes", Resposta: colunasRevisao, Autor: "criada_por"}
var tabelaAbastecimentos = dados.Tabela{Nome: "frota_abastecimentos", Resposta: colunasAbastecimento, Autor: "criado_por"}

type corpoManutencao struct {
	VeiculoID     json.RawMessage `json:"veiculo_id,omitempty"`
	Km            json.RawMessage `json:"km,omitempty"`
	FeitaEm       json.RawMessage `json:"feita_em,omitempty"`
	Oficina       json.RawMessage `json:"oficina,omitempty"`
	TotalCentavos json.RawMessage `json:"total_centavos,omitempty"`
	Observacao    json.RawMessage `json:"observacao,omitempty"`
}

type corpoTroca struct {
	Item          json.RawMessage `json:"item,omitempty"`
	CustoCentavos json.RawMessage `json:"custo_centavos,omitempty"`
}

type pedidoManutencao struct {
	Manutencao corpoManutencao `json:"manutencao"`
	Trocas     []corpoTroca    `json:"trocas"`
}

// doCabecalho: o que cada troca herda do serviço (mesmo carro, KM, data e oficina).
var doCabecalho = []string{"veiculo_id", "km", "feita_em", "oficina"}

// gravarManutencao: POST /frota/manutencoes — o serviço e as trocas numa transação (Ruling 5.3-7).
func gravarManutencao(p *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		e := autz.EscopoDo(r.Context())
		if e == nil {
			dados.Erro(w, http.StatusInternalServerError, "erro_interno", "")
			return
		}
		var in pedidoManutencao
		if !dados.LerCorpo(w, r, &in) {
			return
		}
		if len(in.Trocas) == 0 || len(in.Trocas) > 30 {
			dados.Erro(w, http.StatusBadRequest, "pedido_invalido", "Marque ao menos uma troca (no máximo 30 por lançamento).")
			return
		}
		cab, err := dados.Campos(&in.Manutencao)
		trocas := make([]map[string]any, len(in.Trocas))
		for i := range in.Trocas {
			if err == nil {
				trocas[i], err = dados.Campos(&in.Trocas[i])
			}
		}
		if err != nil {
			dados.Erro(w, http.StatusInternalServerError, "erro_interno", "")
			return
		}
		ctx := r.Context()
		var linha []byte
		err = banco.ComUsuario(ctx, p, e.ID, func(tx pgx.Tx) error {
			var err error
			if linha, err = tabelaManutencoes.Criar(ctx, tx, autz.Producao, e, cab); err != nil {
				return err
			}
			id, err := idDaLinha(linha)
			if err != nil {
				return err
			}
			for _, tr := range trocas {
				tr["manutencao_id"] = id
				for _, c := range doCabecalho {
					if v, ok := cab[c]; ok {
						tr[c] = v
					}
				}
				if _, err := tabelaRevisoes.Criar(ctx, tx, autz.Producao, e, tr); err != nil {
					return err
				}
			}
			return nil
		})
		if err != nil {
			dados.ErroDeEscrita(w, err)
			return
		}
		dados.Responder(w, http.StatusCreated, linha)
	}
}

type corpoAbastecimento struct {
	VeiculoID     json.RawMessage `json:"veiculo_id,omitempty"`
	PessoaID      json.RawMessage `json:"pessoa_id,omitempty"`
	PessoaNome    json.RawMessage `json:"pessoa_nome,omitempty"`
	AbastecidoEm  json.RawMessage `json:"abastecido_em,omitempty"`
	Km            json.RawMessage `json:"km,omitempty"`
	Litros        json.RawMessage `json:"litros,omitempty"`
	TotalCentavos json.RawMessage `json:"total_centavos,omitempty"`
	TanqueDepois  json.RawMessage `json:"tanque_depois,omitempty"`
	Combustivel   json.RawMessage `json:"combustivel,omitempty"`
	Posto         json.RawMessage `json:"posto,omitempty"`
	Observacao    json.RawMessage `json:"observacao,omitempty"`
}

func montarManutencoes(r chi.Router, p *pgxpool.Pool) // POST /frota/manutencoes; GET + DELETE {id} de revisões; GET + POST de abastecimentos; soSessaoPropria nas escritas
```

**(b) Testes de aceitação** (`TestManutencoesEAbastecimentos`, com `m.rodar`)
- Manutenção: `motorista` POST `{"manutencao":{"veiculo_id":V1,"km":6000,"feita_em":"2026-10-10","oficina":"JHM","total_centavos":45000,"observacao":null},"trocas":[{"item":"Troca de óleo","custo_centavos":30000},{"item":"Filtro","custo_centavos":null}]}` → 201 com `"total_centavos":45000`; efeito: as 2 trocas com `km` 6000, `oficina` JHM, `feita_em` 2026-10-10, `veiculo_id` V1 e `criada_por` = motorista. `"trocas":[]` → 400 "Marque ao menos uma troca"; `"km":-1` no cabeçalho → 400 e NENHUM cabeçalho a mais; segunda troca com `"custo_centavos":"caro"` → 400 e o cabeçalho também não fica; troca com `"km"` → 400 `corpo_invalido`; `"criada_por"` no cabeçalho → 400 `corpo_invalido`. `semFrota` e `impersonado` → 403/403, contagens iguais.
- Revisões: `motorista` GET → Rv1 com `"manutencao_id":"<M1>"`; `semFrota` GET → `[]`; `admin` DELETE Rv1 → 404 e fica; `impersonado` DELETE → 403 e fica; `motorista` DELETE Rv1 → 204 e some.
- Abastecimentos: `motorista` GET → A1 (`"litros":40.500`); POST `{"veiculo_id":V1,"abastecido_em":"2026-10-12T09:00:00Z","km":5300,"litros":38.25,"total_centavos":22000,"tanque_depois":4,"combustivel":"gasolina"}` → 201 com `criado_por` = motorista; `"criado_por"` no corpo → 400; `"total_centavos":0` → 400; `"litros":"muito"` → 400; total igual nos três; `semFrota` GET → `[]`, POST → 403; `impersonado` POST → 403.
- Mutações que têm de reprovar: `Autor: ""` em `tabelaAbastecimentos` (`criado_por` nulo); as trocas numa transação própria (o caso "segunda troca inválida" deixa o cabeçalho); tirar o laço `doCabecalho` (km/oficina das trocas saem nulos).

**(c) Arquivos:** Create `api/internal/frota/manutencoes.go`, `api/internal/frota/manutencoes_test.go`.

**(d) Dependências:** Task 2.

- [ ] **Step 1:** Testes; ver falhar. - [ ] **Step 2:** Implementar. - [ ] **Step 3:** gofmt/vet/test PASS; mutações reprovam. - [ ] **Step 4:** Commit `feat(api): manutenção com as trocas numa transação, revisões e abastecimentos da frota` (+ `Co-Authored-By`).

---

### Task 9: RPCs da Frota

**Revisor:** opus (portões). **Depende de:** 2.

**(a) Contrato** — `frota.FuncoesRPC` (a Task 10 a junta a `web.FuncoesRPC` e tira os 2 nomes de `web.RPCPendentes`):

```go
package frota

import (
	"github.com/rbv-co/social-dashboard/api/internal/autz"
	"github.com/rbv-co/social-dashboard/api/internal/rpc"
)

// FuncoesRPC: as funções que a tela da Frota chama por .rpc (tela-de-frota.vue:3025, 3123). Nome, parâmetros
// e retorno de levantamento/02-funções.csv; portão = a checagem da própria função (Ruling 26 do mestre).
var FuncoesRPC = []rpc.Funcao{
	// etiqueta_quem_e(p_numero integer) returns jsonb, SECURITY DEFINER: por dentro devolve {existe:false} a
	// quem não é is_patrimonio_admin() — o portão é essa checagem (Ruling 5.3-10).
	{Nome: "etiqueta_quem_e", Params: []rpc.Param{{Nome: "p_numero", Tipo: "integer"}}, Retorno: rpc.Valor, Portao: autz.PatrimonioAdmin},
	// frota_corrente_do_veiculo(p_veiculo uuid) returns table, SECURITY INVOKER: lia frota_checklist e
	// frota_checklist_respostas pela RLS de quem chamava (is_frota_admin), que deixa de existir.
	{Nome: "frota_corrente_do_veiculo", Params: []rpc.Param{{Nome: "p_veiculo", Tipo: "uuid"}}, Retorno: rpc.Conjunto, Portao: autz.FrotaAdmin},
}
```

`autz.FrotaAdmin` e `autz.PatrimonioAdmin` já são comparados com `is_frota_admin()`/`is_patrimonio_admin()` de produção em `TestPortoesContraAsFuncoesDeProducao` (5.0): nenhum portão novo.

**(b) Testes de aceitação** (`TestRPCDaFrota`: mundo com `rpc.Novo(p, FuncoesRPC...)` montado em `POST /rpc/{nome}` — `Novo` com erro = `t.Fatal`: nome proibido, tipo fora da lista ou portão nulo; `m.rodar`)
- `frota_corrente_do_veiculo`: `motorista` `{"p_veiculo":V1}` → 200 com `h-c1` e `Pneus` (as respostas em jsonb); `superFicha` → 200; carro inexistente → `200 []`; `{"p_veiculo":"x"}` → 400; `impersonado` → 200 (leitura). **Vazamento:** cada pessoa de `semFrota` → 403 `sem_permissao` sem chamar a função (nada de `h-c1` no corpo).
- `etiqueta_quem_e`: `patrimonio` `{"p_numero":101}` → 200 com `AAA1A11` e `Gol da frota`; `admin` (papel admin = admin do Patrimônio) → 200 com `AAA1A11`; `{"p_numero":999}` → 200 com `"existe": false`; `{"p_numero":102}` → 200 sem `placa_ligada` preenchida (`Mesa`); `{"p_numero":"cento e um"}` → 400; parâmetro a mais → 400. **Ruling 5.3-10:** `motorista` (só Frota) → 403 e o corpo NÃO tem `Gol`; `viewer` → 403.
- Mutação que tem de reprovar: `Portao: autz.FrotaAdmin` na `etiqueta_quem_e` (motorista passa a 200).

**(c) Arquivos:** Create `api/internal/frota/rpc.go`, `api/internal/frota/rpc_test.go`.

**(d) Dependências:** Tasks 1 (as 2 funções no banco de teste, por `funcoes-avulsas-5-3.txt`) e 2; `rpc.Novo` (5.0).

- [ ] **Step 1:** Teste; ver falhar (`FuncoesRPC`). - [ ] **Step 2:** Implementar. - [ ] **Step 3:** gofmt/vet/test PASS; mutação reprova. - [ ] **Step 4:** Commit `feat(api): RPCs da frota (etiqueta_quem_e, frota_corrente_do_veiculo) com o portão de cada função` (+ `Co-Authored-By`).

---

### Task 10: Montagem, varreduras (impersonado e vazamento), `conferir` e notas

**Revisor:** opus. **Depende de:** 3–9.

**(a) Contrato**
- `frota.Montar(r chi.Router, p *pgxpool.Pool)` chama `montarVeiculos, montarUsos, montarRequisicoes, montarChecklists, montarConfiguracao, montarManutencoes`.
- `web/rotas.go`: no grupo de domínio (com `autz.ComEscopo`), depois das montagens do 5.1/5.2, `frota.Montar(r, p) // Plano 5.3`. `web.FuncoesRPC` ganha `frota.FuncoesRPC` (literal → `slices.Concat(<literal>, frota.FuncoesRPC)`; se já for `slices.Concat`, acrescente o argumento) e `etiqueta_quem_e`/`frota_corrente_do_veiculo` saem de `web.RPCPendentes`. `POST /avisar-decisao-de-reserva` (Plano 4) fica onde está.
- `web/rotas_test.go`: `soSessao` ganha as 27 rotas (comentário: "portão = catálogo, provado pela matriz de cada rota em `internal/frota`; vazamento e impersonado por `TestNadaVazaParaQuemNaoTemFrota` e `TestEscritasRecusamImpersonado`").
- `cmd/api/conferir.go`: o que as rotas e os gatilhos presumem (abaixo).
- `NOTAS-DA-IMPLANTACAO.md`: seção do 5.3.

**(b) Testes de aceitação**
- `TestEscritasRecusamImpersonado` e `TestNadaVazaParaQuemNaoTemFrota` (`frota/rotas_test.go`, código abaixo): percorrem TODAS as rotas de `Montar` com `chi.Walk`; exatamente 16 escritas e 11 leituras; quem tem sessão e não tem a Frota recebe `[]`/403/404 e a conta desativada, 401 em todas; `fotoDaFrota` igual antes e depois.
- `TestNenhumaRotaNovaFicaAberta` (existente) passa com `soSessao` atualizado: toda rota da Frota dá 401 sem sessão.
- `TestFrotaPelaMontagemReal` (`web/rotas_test.go`, no molde de `TestAcessoPelaMontagemReal` do 5.1: `testebanco.ComEsquemaDeProducao` + `usuarios`/`profiles` de um motorista `{frota}` e de um admin sem frota): `GET /frota/veiculos` sem sessão → 401; admin → `200 []`; motorista `POST /frota/veiculos {"placa":"ZZZ1Z11","nome":"Teste"}` → 201; admin `PATCH` desse carro → 404 e intacto; admin `POST /rpc/frota_corrente_do_veiculo` → 403; motorista → 200; motorista `POST /rpc/etiqueta_quem_e {"p_numero":1}` → 403.
- O teste de `RPCPendentes` do 5.0 (`nomes(FuncoesRPC) ∪ RPCPendentes` = os 92) continua verde.

```go
package frota

import (
	"net/http"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
)

// Toda escrita da Frota recusa a sessão de "entrar como", sem tocar no banco (Ruling 5.3-5).
func TestEscritasRecusamImpersonado(t *testing.T) {
	m := novoMundo(t, Montar)
	antes := m.um(t, fotoDaFrota)
	n := 0
	err := chi.Walk(m.h.(chi.Routes), func(metodo, rota string, _ http.Handler, _ ...func(http.Handler) http.Handler) error {
		if metodo == http.MethodGet {
			return nil
		}
		n++
		st, corpo := m.pedir(t, "impersonado", metodo, strings.ReplaceAll(rota, "{id}", V1), `{"observacao":"x"}`)
		if st != http.StatusForbidden || !strings.Contains(corpo, "Quem entrou como outra pessoa") {
			t.Errorf("%s %s como impersonado = %d %s", metodo, rota, st, corpo)
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if n != 16 {
		t.Errorf("escritas = %d, esperava 16 (rota de escrita nova? ponha soSessaoPropria e conte aqui)", n)
	}
	if depois := m.um(t, fotoDaFrota); depois != antes {
		t.Error("o impersonado mudou o banco")
	}
}

// Quem não tem a Frota (papel admin, só frota.aprovar, só Patrimônio, ninguém) não lê nem grava NADA, pelo
// handler real: lista = [], criar = 403, linha existente = 404; a conta desativada (com a feature frota)
// nem passa da sessão: 401 em toda rota; banco intacto. Escrita nova sem entrada em `escritas` faz o
// teste falhar.
func TestNadaVazaParaQuemNaoTemFrota(t *testing.T) {
	m := novoMundo(t, Montar)
	antes := m.um(t, fotoDaFrota)
	type escrita struct {
		id, corpo string
		status    int
	}
	escritas := map[string]escrita{
		"POST /frota/veiculos":              {"", `{"placa":"ZZZ9Z99","nome":"Intruso"}`, 403},
		"PATCH /frota/veiculos/{id}":        {V1, `{"observacao":"x"}`, 404},
		"POST /frota/usos":                  {"", `{"veiculo_id":"` + V2 + `","km_saida":1}`, 403},
		"PATCH /frota/usos/{id}":            {U1, `{"volta_em":"2026-10-12T10:00:00Z"}`, 404},
		"POST /frota/usos/trocar":           {"", `{"veiculo_id":"` + V1 + `","fechar":{"id":"` + U1 + `","volta_em":"2026-10-12T10:00:00Z"}}`, 404},
		"POST /frota/requisicoes":           {"", `{"veiculo_id":"` + V2 + `","retirada_prevista":"2026-11-01T12:00:00Z"}`, 403},
		"PATCH /frota/requisicoes/{id}":     {R1, `{"destino":"x"}`, 404},
		"POST /frota/checklists":            {"", `{"ficha":{"veiculo_id":"` + V2 + `","feita_em":"2026-11-01","hodometro":1},"respostas":[]}`, 403},
		"POST /frota/checklist-itens":       {"", `{"item":"Intruso","cadencia":"diario"}`, 403},
		"PATCH /frota/checklist-itens/{id}": {I1, `{"ativo":false}`, 404},
		"PATCH /frota/checklist-config":     {"", `{"dia_semanal":2}`, 404},
		"POST /frota/plano-revisao":         {"", `{"item":"Intruso","a_cada_km":1}`, 403},
		"PATCH /frota/plano-revisao/{id}":   {P1, `{"ativo":false}`, 404},
		"DELETE /frota/revisoes/{id}":       {Rv1, ``, 404},
		"POST /frota/manutencoes":           {"", `{"manutencao":{"veiculo_id":"` + V1 + `","km":1},"trocas":[{"item":"x"}]}`, 403},
		"POST /frota/abastecimentos": {"", `{"veiculo_id":"` + V1 + `","km":1,"litros":1,"total_centavos":1,` +
			`"tanque_depois":1,"combustivel":"x"}`, 403},
	}
	for _, quem := range semFrota {
		leituras, gravacoes := 0, 0
		err := chi.Walk(m.h.(chi.Routes), func(metodo, rota string, _ http.Handler, _ ...func(http.Handler) http.Handler) error {
			if metodo == http.MethodGet {
				leituras++
				if st, corpo := m.pedir(t, quem, metodo, rota, ""); st != http.StatusOK || strings.TrimSpace(corpo) != "[]" {
					t.Errorf("%s GET %s = %d %s; esperava 200 []", quem, rota, st, corpo)
				}
				return nil
			}
			gravacoes++
			e, ok := escritas[metodo+" "+rota]
			if !ok {
				t.Errorf("escrita sem caso de vazamento: %s %s", metodo, rota)
				return nil
			}
			if st, corpo := m.pedir(t, quem, metodo, strings.ReplaceAll(rota, "{id}", e.id), e.corpo); st != e.status {
				t.Errorf("%s %s %s = %d %s; esperava %d", quem, metodo, rota, st, corpo, e.status)
			}
			return nil
		})
		if err != nil {
			t.Fatal(err)
		}
		if leituras != 11 || gravacoes != 16 {
			t.Errorf("rotas = %d leituras e %d escritas, esperava 11 e 16", leituras, gravacoes)
		}
	}
	err := chi.Walk(m.h.(chi.Routes), func(metodo, rota string, _ http.Handler, _ ...func(http.Handler) http.Handler) error {
		e := escritas[metodo+" "+rota]
		if st, corpo := m.pedir(t, "desativado", metodo, strings.ReplaceAll(rota, "{id}", e.id), e.corpo); st != http.StatusUnauthorized {
			t.Errorf("desativado %s %s = %d %s; esperava 401", metodo, rota, st, corpo)
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if depois := m.um(t, fotoDaFrota); depois != antes {
		t.Error("quem não tem a Frota mudou o banco")
	}
}
```

**(c) Arquivos:** Create `api/internal/frota/rotas.go`, `api/internal/frota/rotas_test.go`; Modify `api/internal/web/rotas.go`, `api/internal/web/rotas_test.go`, `api/cmd/api/conferir.go`, `docs/migracao-go/NOTAS-DA-IMPLANTACAO.md`.

**(d) Dependências:** Tasks 3–9; `web.Rotas`, `web.FuncoesRPC`, `web.RPCPendentes` (5.0).

- [ ] **Step 1: Testes que falham.** `frota/rotas_test.go` (acima); em `web/rotas_test.go`, as 27 entradas de `soSessao` (`"GET /frota/veiculos"`, `"POST /frota/veiculos"`, `"PATCH /frota/veiculos/{id}"`, `"GET /frota/usos"`, `"POST /frota/usos"`, `"PATCH /frota/usos/{id}"`, `"POST /frota/usos/trocar"`, `"GET /frota/requisicoes"`, `"POST /frota/requisicoes"`, `"PATCH /frota/requisicoes/{id}"`, `"GET /frota/checklists"`, `"POST /frota/checklists"`, `"GET /frota/checklists/respostas"`, `"GET /frota/checklists/copias"`, `"GET /frota/checklist-itens"`, `"POST /frota/checklist-itens"`, `"PATCH /frota/checklist-itens/{id}"`, `"GET /frota/checklist-config"`, `"PATCH /frota/checklist-config"`, `"GET /frota/plano-revisao"`, `"POST /frota/plano-revisao"`, `"PATCH /frota/plano-revisao/{id}"`, `"GET /frota/revisoes"`, `"DELETE /frota/revisoes/{id}"`, `"POST /frota/manutencoes"`, `"GET /frota/abastecimentos"`, `"POST /frota/abastecimentos"`) e `TestFrotaPelaMontagemReal`. Run: `go test -count=1 ./internal/frota/ ./internal/web/` → FAIL (`Montar` não existe).
- [ ] **Step 2: Implementar.** `frota/rotas.go`:

```go
package frota

import (
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Montar registra as rotas do 5.3 no grupo de DOMÍNIO de web.Rotas (depois de auth.Exigir e de
// autz.ComEscopo). Declaração errada derruba a subida (deve). POST /avisar-decisao-de-reserva (Plano 4)
// é montado à parte, no grupo autenticado, com o portão da edge.
func Montar(r chi.Router, p *pgxpool.Pool) {
	montarVeiculos(r, p)
	montarUsos(r, p)
	montarRequisicoes(r, p)
	montarChecklists(r, p)
	montarConfiguracao(r, p)
	montarManutencoes(r, p)
}
```

`web/rotas.go`: `frota.Montar(r, p) // Plano 5.3` no grupo de domínio; `FuncoesRPC` com `frota.FuncoesRPC`; os 2 nomes fora de `RPCPendentes`.

`cmd/api/conferir.go` (troque a linha existente da mesma tabela pela versão abaixo; acrescente as novas):

```go
// colunasDoWorker
"frota_veiculos":              "id,placa,nome,marca,ano,cor,combustivel,renavam,chassi,tipo_oleo,contrato,codigo_patrimonial,aluguel_centavos,fipe_centavos,categoria_comercial,blindado,situacao,pessoa_id,local_texto,observacao,criado_em,atualizado_em,seguro_seguradora,seguro_apolice,seguro_vence_em,seguro_valor_centavos,tag_pedagio,rastreador,bem_id,contato_nome,contato_telefone,contato_papel,oficina_nome,oficina_telefone,empresa_id,local_id,comodo_id",
"frota_uso":                   "id,veiculo_id,pessoa_id,pessoa_nome,saida_em,km_saida,volta_em,km_volta,destino,finalidade,tanque_quartos,observacao,criado_em,tipo,aceite_em,aceite_por,aceite_nome,aceite_rabisco,aceite_checklist_id,aceite_checklist_hash",
"frota_requisicoes":           "id,veiculo_id,pessoa_id,pessoa_nome,departamento,destino,finalidade,retirada_prevista,devolucao_prevista,situacao,criada_por,criada_em,decidida_por,decidida_em,motivo_decisao,uso_id,observacao,encerrada_por,encerrada_em,encerrada_motivo,arquivada_em,arquivada_por",
"frota_requisicoes_historico": "requisicao_id,campo,de,para,motivo,quem,quando",
"frota_checklist":             "id,veiculo_id,pessoa_id,pessoa_nome,feita_em,cadencias,hodometro,hodometro_justificativa,resultado,anomalias,criada_em,criada_por,aberta_em,assinada_em,assinada_por,assinatura_hash,assinatura_hash_anterior,sem_assinatura_motivo,assinatura_rabisco,assinatura_versao",
"frota_checklist_respostas":   "id,checklist_id,item_id,item_texto,cadencia,estado,observacao,ordem",
"frota_checklist_pdf":         "checklist_id,situacao,tentativas,ultimo_erro,criado_em,enviado_em",
"frota_uso_pdf":               "uso_id,situacao",
"frota_checklist_itens":       "id,ordem,item,cadencia,ativo,observacao,impede_uso",
"frota_checklist_config":      "id,dia_semanal,semana_mensal,dia_mensal",
"frota_plano_revisao":         "id,item,a_cada_km,ordem,ativo,observacao",
"frota_manutencoes":           "id,veiculo_id,km,feita_em,oficina,total_centavos,observacao,criada_em,criada_por",
"frota_revisoes":              "id,veiculo_id,item,km,feita_em,oficina,custo_centavos,observacao,criada_em,criada_por,manutencao_id",
"frota_abastecimentos":        "id,veiculo_id,pessoa_id,pessoa_nome,abastecido_em,km,litros,total_centavos,tanque_depois,combustivel,posto,observacao,criado_em,criado_por",

// tiposDoWorker (filtros e conferências com cast; a linha única da configuração; dinheiro)
"frota_veiculos.id": "uuid", "frota_veiculos.pessoa_id": "uuid", "frota_uso.id": "uuid", "frota_uso.veiculo_id": "uuid",
"frota_uso.saida_em": "timestamp with time zone", "frota_uso.volta_em": "timestamp with time zone",
"frota_checklist.assinada_em": "timestamp with time zone", "frota_checklist_respostas.checklist_id": "uuid",
"frota_checklist_config.id": "boolean", "frota_abastecimentos.total_centavos": "integer", "frota_abastecimentos.litros": "numeric",
"frota_manutencoes.total_centavos": "bigint", "frota_revisoes.custo_centavos": "bigint",

// unicosDoWorker (os 409 das rotas dependem destes únicos completos)
"frota_veiculos(placa)", "frota_checklist(veiculo_id,feita_em)", "frota_checklist_respostas(checklist_id,ordem)",
"frota_checklist_itens(item)", "frota_plano_revisao(item)",

// deduplicadoresDoWorker (únicos PARCIAIS: "um carro, uma saída aberta" e "um bem, um carro")
"frota_uso(veiculo_id)", "frota_veiculos(bem_id)",

// funcoesDoWorker (os gatilhos que as escritas da Frota presumem; as 2 RPCs o conferir já cobre por FuncoesRPC)
"frota_aceite_imutavel()", "frota_checar_decisao()", "frota_checar_arquivamento()", "frota_gravar_historico()",
"frota_checklist_imutavel()", "frota_resposta_imutavel()", "frota_checklist_enfileirar_pdf()", "frota_uso_enfileirar_pdf()",
"frota_fechar_posse_orfa()", "frota_espelha_situacao_no_bem()", "frota_espelha_responsavel_no_bem()", "pode_aprovar_frota()",
```

Em `NOTAS-DA-IMPLANTACAO.md`, acrescente ao fim:

```markdown
## Plano 5.3 — Frota

### Rotas novas (com sessão; regra = catálogo de produção, `is_frota_admin()`; escrita de sessão "entrar como" = 403)
- `/frota/veiculos`, `/frota/usos` (+ `POST /frota/usos/trocar`), `/frota/requisicoes`, `/frota/checklists` (+ `/respostas`, `/copias`), `/frota/checklist-itens`, `/frota/checklist-config`, `/frota/plano-revisao`, `/frota/revisoes`, `POST /frota/manutencoes`, `/frota/abastecimentos`; `POST /rpc/etiqueta_quem_e` e `POST /rpc/frota_corrente_do_veiculo`.
- `POST /avisar-decisao-de-reserva` (Plano 4) continua como está: a tela o chama depois do PATCH da reserva.

### Mudanças de contrato que o Plano 7 absorve
- Checklist numa chamada: `POST /frota/checklists {ficha, respostas, assinatura?}` (substitui tela-de-frota.vue:2209, 2229, 2247 e o tratamento de ficha pela metade); `assinada_por` e `criada_por` saem do corpo.
- Manutenção numa chamada: `POST /frota/manutencoes {manutencao, trocas:[{item, custo_centavos}]}` (substitui 3549, 3572 e o delete de desfazer em 3590).
- Troca de posse numa chamada: `POST /frota/usos/trocar {veiculo_id, fechar?, abrir?, para_estoque?}` (passe 1513/1524/1551; dono fixo 3451/3466, depois do PATCH do veículo); `409` quando a posse a fechar já não é a aberta.
- `criada_por` (reserva) e `criado_por` (abastecimento) saem do corpo; a reserva nasce sem `situacao`; PATCH aceita só `aprovada|recusada|cancelada|revogada|usada`.
- A frase do gatilho chega em `mensagem` (`400 regra_de_negocio`); a tela hoje lê `error.message`. Duplicidade = `409 conflito` (a tela hoje testa `/duplicate|unique/`).
- `etiqueta_quem_e` responde 403 a quem não é admin do Patrimônio (antes `{existe:false}`, que a tela mostrava como "Número livre"): a tela fica calada (tela-de-frota.vue:3027-3030).

### Achados para o dono
- Pelo PostgREST, quem tinha a Frota podia CRIAR reserva já `aprovada` (o gatilho de decisão só olha UPDATE) e forjar `assinada_por`/`criada_por`; a API fecha os três.
- `permissions['frota.aprovar']` (o botão da tela e a rota do aviso) e a feature `frota.aprovar` (o gatilho) precisam andar juntas: com só uma, a pessoa vê o botão e recebe a recusa, ou o contrário (Ruling 13 do mestre).
- `etiqueta_quem_e` dizia "Número livre" a quem só tinha a Frota.

### Antes do corte
- `api worker conferir` no banco restaurado: colunas, tipos, únicos e funções dos gatilhos da Frota.
- `select tgname, pg_get_triggerdef(oid) from pg_trigger where tgname like 'trg_frota%' order by 1` no banco restaurado = as condições de `api/internal/testebanco/esquema/condicoes-dos-gatilhos.json`.
- Plano 6: o consumidor das filas de PDF (`enviar-pdf-checklist`) roda `frota_pdf_aceite_pegar_da_fila`, que não devolve nada sem `is_frota_admin()`: precisa de identidade com a Frota.
```

Rode `gofmt -w ./internal ./cmd`.
- [ ] **Step 3: Rodar e ver passar.** `gofmt -l . && go vet ./... && go test -count=1 -race ./... 2>&1 | grep -v goose | grep -E '^(ok|FAIL|---)'` → todos `ok`. Mutações que têm de reprovar: tirar `soSessaoPropria` de UMA escrita qualquer (varredura do impersonado acusa); acrescentar uma escrita de mentira em `Montar` sem caso em `escritas` (varredura do vazamento acusa); montar `frota.Montar` FORA do grupo com `ComEscopo` (as rotas respondem 500).
- [ ] **Step 4: Commit.**

```bash
git add api/internal/frota/rotas.go api/internal/frota/rotas_test.go api/internal/web/ api/cmd/api/conferir.go docs/migracao-go/NOTAS-DA-IMPLANTACAO.md
git commit -m "feat(api): monta as rotas da frota, RPCs no registro, varreduras de impersonado e vazamento, conferir e notas

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Verificação final do 5.3

- [ ] `docker stop pg-plano53` e `make -C api teste PG_PORTA=58538` → todos `ok`.
- [ ] Subir o `pg-plano53` de novo e `cd api && go test -count=1 -v ./... 2>&1 | grep -c -- '--- SKIP'` → `0`.
- [ ] `cd api && gofmt -l . && go vet ./...` → nada.
- [ ] `git diff feat/api-go-plano-5-2 --stat -- src/ supabase/ coletor/` → vazio (o front troca no Plano 7).
- [ ] `docker stop pg-plano53`.
- [ ] Revisão final do branch por opus com foco em: as três escritas compostas (algum passo fora da transação? alguma coluna fora da struct? `PodeEditar` antes da conferência de posse?), a fatia D0 (alguma condição de gatilho ou default diverge das migrations?), as varreduras (alguma rota nova escapa?) e o portão das duas RPCs.

---

## Inventário: sítios do front a trocar (Plano 7)

`grep` em `src/` (fora de `*.test.*` e `src/demonstracao/`) em 2026-10-12, contando `.from('<tabela>')`, `.from(<variável>)`, `.rpc('<nome>')`, `functions.invoke` e `functions/v1/<edge>`: a pasta `src/ferramentas/frota/` tem **74 literais** (todos em `tela-de-frota.vue` e `relatorios-da-frota.js`; `assinar-checklist.js` e `convite-do-dono.js` são lógica pura, sem acesso). Deles, **51 são do 5.3** (`frota_uso` 9, `frota_requisicoes` 7, `frota_checklist` 6, `frota_veiculos` 4, `frota_plano_revisao` 4, `frota_checklist_itens` 4, `frota_checklist_respostas` 3, `frota_revisoes` 3, `frota_checklist_pdf` 3, `frota_checklist_config` 2, `frota_abastecimentos` 2, `frota_manutencoes` 2, RPCs 2) e 23 de outros planos. Fora da pasta, **7** leituras/escritas de `frota_veiculos` (Patrimônio e Colaboradores e Acessos) = **58 sítios do 5.3**. Storage na Frota: **0** (os PDFs vão ao Zoho pelo robô do Plano 6).

Abreviações: `frota` = `src/ferramentas/frota/tela-de-frota.vue`; `rel` = `src/ferramentas/frota/relatorios-da-frota.js`; `pat` = `src/ferramentas/patrimonio/tela-de-patrimonio.vue`; `ac` = `src/ferramentas/acessos/tela-de-acessos.vue`.

| Rota | Sítios | Qtde |
|---|---|---|
| `GET /frota/veiculos` | frota:1039; pat:2084; ac:1820 (`?pessoa_id=&contar=1&limite=1`), 2078 (`?pessoa_id=`), 2249 | 5 |
| `POST /frota/veiculos` | frota:3375; pat:1328 | 2 |
| `PATCH /frota/veiculos/{id}` | frota:3433; pat:1296, 1312 | 3 |
| `GET /frota/usos` | frota:1055 (`?aberta=true`), 1060 (`?aberta=false&limite=400`); rel:191 (`?saida_de=&saida_ate=`) | 3 |
| `POST /frota/usos` | frota:1690 | 1 |
| `PATCH /frota/usos/{id}` | frota:1723 | 1 |
| `POST /frota/usos/trocar` | frota:1513+1524+1551 (passar o carro); 3451+3466 (dono fixo) | 5 |
| `GET /frota/requisicoes` | frota:1084 | 1 |
| `POST /frota/requisicoes` | frota:2439 | 1 |
| `PATCH /frota/requisicoes/{id}` | frota:1718, 2486, 2743, 2796, 2833 | 5 |
| `GET /frota/checklists` | frota:1097 (`?feita_de=`), 2146 (`?veiculo_id=&assinada=true&ordem=feita_em.desc&limite=1`), 3124 (`?veiculo_id=`); rel:101 | 4 |
| `POST /frota/checklists` | frota:2209+2229+2247 | 3 |
| `GET /frota/checklists/respostas` | frota:648, 1159 | 2 |
| `GET /frota/checklists/copias` | frota:1194 (`?pendente=true&limite=200`), 1197 (`?situacao=enviado&contar=1&limite=1`), 1204 (`?ordem=criado_em.desc&limite=300`) | 3 |
| `GET` / `POST` / `PATCH /frota/checklist-itens` | frota:1093 / 2291 / 2307, 2320 | 4 |
| `GET` / `PATCH /frota/checklist-config` | frota:1094 / 2334 | 2 |
| `GET` / `POST` / `PATCH /frota/plano-revisao` | frota:1085 / 2935 / 2936, 2945 | 4 |
| `GET` / `DELETE /frota/revisoes` | frota:1086 / 3499 | 2 |
| `POST /frota/manutencoes` | frota:3549+3572+3590 | 3 |
| `GET` / `POST /frota/abastecimentos` | frota:1109 / 2055 | 2 |
| `POST /rpc/etiqueta_quem_e` | frota:3025 | 1 |
| `POST /rpc/frota_corrente_do_veiculo` | frota:3123 | 1 |

Na mesma tela, de OUTROS planos (não trocar pelo 5.3): **5.0** — `invite-user` frota:756, `conferir-senha` frota:2129; **5.1** — `GET /acesso/usuarios` frota:788 (`?email=`), 1079; `PATCH /acesso/usuarios/{id}` frota:802, 819; **5.2** — `patrimonio_bens` frota:1091, `patrimonio_categorias` 1104, `patrimonio_empresas` 1229 e 3271, `patrimonio_locais` 1230, `patrimonio_comodos` 1231, `from(pedido.tabela)` 3188, RPCs `pessoas_para_escolher` 1078, `setores_para_escolher` 1080, `criar_pessoa_rapida` 3228, `criar_setor_rapido` 3259, `sincronizar_carro_e_bem` 3391; **5.4** — `acessos_pessoas` frota:829, 948, 1005, 1070; **Plano 4** — `avisar-decisao-de-reserva` frota:2523 (a rota já existe: só a URL e o token). Robôs e scripts com chave de serviço (Plano 7): `coletor/importar-frota.mjs`, `abrir-posses-frota.mjs`, `frota-para-patrimonio.mjs`, `conceder-frota.mjs`, `importar-frota-manutencao.mjs`.

## Paralelização

- **Uma worktree por tarefa paralela** (merge na ordem dos números). As Tasks 2–10 são o MESMO pacote Go (`frota`): na mesma worktree, só em sequência (arquivo pela metade de uma quebra a compilação da outra). Cada task só toca os seus dois arquivos; a 10 é a única que toca `web/`, `conferir.go` e as notas. Um contêiner (`pg-plano53`) atende todas: cada teste cria o próprio banco.
- **Onda 1:** Task 1.
- **Onda 2:** Task 2.
- **Onda 3:** Tasks 3, 5, 6, 7, 8 e 9 — seis em paralelo, cada uma só nos seus dois arquivos (os ajudantes comuns — `soSessaoPropria`, `deve`, `naLinha`, `idDaLinha`, `vazio` — são da Task 2).
- **Onda 4:** Task 4 (precisa de `tabelaVeiculos`, da 3).
- **Onda 5:** Task 10.

## Rulings do 5.3

1. Ruling: D0 da Frota = fatia RECONSTRUÍDA `01-tabelas-5-3.sql` (14 tabelas das migrations, na ordem em que as colunas entraram, fonte por bloco) + gatilhos e funções verbatim gerados do levantamento; o gerador ganha `condicoes-dos-gatilhos.json` (`UPDATE OF`/`WHEN` das migrations, que o `03-triggers.csv` não traz) e `funcoes-avulsas-*.txt` (RPCs que nenhum gatilho chama) — sem o `WHEN (old.assinada_em is not null)` o gatilho de imutabilidade recusaria TODA edição de ficha, a assinatura inclusive, e sem as RPCs no banco o teste do `/rpc` não chamaria a função de produção; o `pg_dump` do ensaio (Ruling 29 do mestre) troca a fatia depois pelo mesmo carregador — custo se errada: condição de gatilho divergente de produção só aparece no `pg_get_triggerdef` do banco restaurado (NOTAS, antes do corte).
2. Ruling: as 14 tabelas `frota_*` são declaradas UMA vez, na fatia 5.3; fatia anterior que tenha declarado alguma mínima perde a declaração — `create table` repetido derruba o carregador, e duas versões da mesma tabela divergem em silêncio; o carregador lê todos os arquivos em todo teste, então quem a usava continua com ela — custo se errada: nenhum.
3. Ruling: as rotas moram no pacote `frota` do Plano 4, ao lado do push e da reserva, que são reusados sem mudança — o domínio já tem dono e a reserva já decide quem recebe o aviso a partir do gravado; um pacote novo duplicaria leituras de `frota_*` — custo se errada: o pacote mistura worker e rotas, e os nomes de teste não podem colidir com os do Plano 4 (listados nas Interfaces).
4. Ruling: permissão = catálogo nas 14 tabelas (`is_frota_admin()`: feature `frota` ou super pela ficha, conta ativa) + gatilhos verbatim para aprovar/recusar/cancelar/revogar/arquivar/editar reserva (`pode_aprovar_frota()`: feature `frota.aprovar` ou super pela ficha); as chaves `frota.*` de `permissions` (`frota.aprovar`, `frota.relatorios`) são portão de TELA e da rota do aviso do Plano 4 (`ExigirPermissao("frota.aprovar", "ver")`), não das rotas de dados — "mesmas permissões de hoje" (Ruling 13 do mestre); papel `admin` sem a feature não vê a Frota, como hoje — custo se errada: quem tem só uma das duas formas de `frota.aprovar` vê o botão e recebe a frase do gatilho (como hoje; achado nas NOTAS).
5. Ruling: sessão de "entrar como" só LÊ na Frota: as 16 escritas respondem 403 — os gatilhos carimbam `auth.uid()` (o ALVO) em `aceite_por`, `decidida_por`, `encerrada_por`, `arquivada_por` e no histórico, e `assinada_por` da ficha seria dele: aceite e assinatura em nome de outro são fraude possível; estende o Ruling 18 do mestre e o 5.1-4 — custo se errada: o super-admin sai da sessão impersonada para operar a frota.
6. Ruling: autoria vem da sessão — `criada_por` (reserva: exigido pela policy; ficha; manutenção; troca), `criado_por` (abastecimento) e `assinada_por` (ficha) são preenchidos pelo servidor e recusados no corpo; `aceite_por`, `decidida_por`, `encerrada_por`, `arquivada_por` e `historico.quem` continuam dos gatilhos; o que entra na impressão digital da ficha (inclusive `assinada_em`) vem do corpo, porque é o que foi assinado — pela API, autoria vinda do corpo seria falsificável por qualquer um com a Frota (hoje a tela manda `estado.userId`) — custo se errada: ficha e troca passam a ter `criada_por` (antes nulo).
7. Ruling: escrita de cabeçalho com linhas é UMA rota numa transação — `POST /frota/checklists` (ficha + respostas + assinatura) e `POST /frota/manutencoes` (serviço + trocas), reaproveitando `Tabela.Criar/Editar` linha a linha (mesmo `PodeX`, mesmo mapa, mesmo SQL) — hoje são 3 e 2 gravações com estados parciais PERMANENTES (ficha sem respostas ou sem assinatura não se refaz: "um carro, um dia, uma ficha" + imutabilidade; cabeçalho órfão desfeito por delete compensatório), e `dados.Tabela` é por linha, então lote pediria handler próprio de qualquer jeito — custo se errada: o Plano 7 reescreve `gravarChecklist` e `gravarLancamento` (ficam mais simples).
8. Ruling: troca de posse é UMA rota numa transação (`POST /frota/usos/trocar`: fecha a posse aberta, abre a nova, opcionalmente para o carro), com `PodeEditar` antes e a conferência de que a posse a fechar AINDA é a aberta daquele carro (409 senão); retirada e devolução ficam CRUD, e a concorrência da retirada é do índice parcial `uniq_frota_uso_um_aberto` (23505 → 409) — o "fechou e não abriu" deixa o carro sem responsável (a própria tela chama de crítico, tela-de-frota.vue:1527-1538) e duas trocas simultâneas sobrescreviam o fechamento — custo se errada: devolução repetida do mesmo uso ainda sobrescreve `km_volta` (como hoje; `ponytail`: conferência `volta_em is null` no PATCH quando aparecer).
9. Ruling: reserva e retirada continuam duas chamadas (`POST /frota/usos`, depois `PATCH /frota/requisicoes/{id} {uso_id, situacao: 'usada'}`) — a tela decidiu de propósito que o elo falhando não desfaz a viagem (tela-de-frota.vue:1707-1717) — custo se errada: a reserva pode ficar `aprovada` depois de usada (como hoje).
10. Ruling: `etiqueta_quem_e` tem portão `autz.PatrimonioAdmin` (a checagem interna da função, Ruling 26 do mestre) e responde 403 a quem não é admin do Patrimônio, em vez do `{existe:false}` da função — a função disfarçava a negação de "número livre" e a tela mostrava "Número livre. O item vai ser criado no Patrimônio." (etiqueta-do-veiculo.js:157-158) a quem só tem a Frota; com 403 a tela fica calada (tela-de-frota.vue:3027-3030) e a gravação confere de novo no banco; `frota_corrente_do_veiculo` tem portão `FrotaAdmin` (invoker que lia pela RLS de quem chamava) — custo se errada: quem só tem a Frota deixa de ver o aviso adiantado da etiqueta (que para ele era falso).
11. Ruling: corpo da reserva fechado — POST sem `situacao` nem colunas de decisão (nasce `pendente`; pelo PostgREST nascia `aprovada` se o corpo dissesse, porque o gatilho de decisão só olha UPDATE); PATCH só com as colunas e os valores de `situacao` que a tela grava (`aprovada`, `recusada`, `cancelada`, `revogada`, `usada`): nada volta a `pendente` — mesma superfície da tela, sem a porta lateral do PostgREST — custo se errada: reabrir reserva vira rota nova, se o dono quiser.
12. Ruling: tabelas sem leitor no front não ganham rota — `frota_requisicoes_historico` (só o gatilho escreve), `frota_uso_pdf` (fila do robô), `frota_manutencoes` (só a gravação atômica); `frota_requisicoes` não tem policy de DELETE e não ganha DELETE; ficha e resposta não têm PATCH/DELETE (imutáveis depois de assinadas; a tela não edita) — `autz` nega o que não tem rota — custo se errada: uma tela nova que queira o histórico ganha uma `Consulta` de ~10 linhas.
13. Ruling: as filas de PDF (`frota_checklist_pdf`, `frota_uso_pdf`) são o ponto de integração com o Plano 6 — enchidas pelos gatilhos verbatim (testados nas Tasks 1, 4 e 6), consumidas por `frota_pdf_pegar_da_fila`/`frota_pdf_aceite_pegar_da_fila` (categoria W: o robô, não o `/rpc`); a tela só lê o estado de `frota_checklist_pdf`; a Frota não usa Storage (grep: 0) — os PDFs vão ao Zoho WorkDrive, que é do Plano 6 — custo se errada: o consumidor do Plano 6 precisa de identidade com a Frota (a função do aceite não devolve nada sem `is_frota_admin()`; NOTAS).
14. Ruling: leituras = um recurso por tabela com a UNIÃO das colunas e filtros que as telas usam (frota, Patrimônio e Colaboradores e Acessos leem `frota_veiculos` pela mesma rota), períodos com o cast do PostgREST (`saida_em <= @data::date` = 00:00 UTC, que exclui o próprio dia como hoje) e o teto de 1000 linhas do mestre (as fichas de 120 dias encostam nele com ~10 carros, como já encostavam) — paridade com o que as telas e os relatórios mostram — custo se errada: o relatório de uso continua cortando o último dia do período (a tela pode mandar o dia seguinte no Plano 7).
15. Ruling: o mundo de teste da Frota é próprio (`frota/mundo_test.go`), com a cópia das ~45 linhas genéricas do mundo do 5.1 (`resposta/pedir/um/rodar/caso`), salvo se o 5.2 já as tiver extraído para `testebanco` (pré-voo) — as pessoas e linhas são outras (features `frota`/`frota.aprovar`, ficha assinada, posse aberta) e o 5.2 roda em paralelo: extrair aqui criaria conflito — custo se errada: ~45 linhas de teste duplicadas até a extração.
16. Ruling: a configuração do checklist é `GET/PATCH /frota/checklist-config`, sem id na URL: a rota fixa a linha única `id = true` (`naLinha`) e reusa `dados.RotaEditar` — é uma linha só por desenho (028_frota_checklist.sql:43-48) — custo se errada: nenhum.

## Cobertura da spec e o que vem depois

**As 14 tabelas da linha 5.3 (28 policies, nenhuma restritiva) e as 2 RPCs:**

| Tabela | Destino |
|---|---|
| `frota_veiculos` | Task 3 (+ gatilhos de espelho no Patrimônio e posse órfã) |
| `frota_uso` | Task 4 (aceite imutável, fila do PDF do aceite, índice "uma saída aberta") |
| `frota_uso_pdf` | sem rota (Ruling 5.3-12/13); enchida pelo gatilho, conferida nas Tasks 1 e 4 |
| `frota_requisicoes` | Task 5 (`frota_req_criar` com `criada_por`; decisão, encerramento e arquivamento pelos gatilhos) |
| `frota_requisicoes_historico` | sem rota; escrita pelo gatilho, conferida nas Tasks 1 e 5 |
| `frota_checklist`, `frota_checklist_respostas` | Task 6 (imutabilidade nas Tasks 1 e 6) |
| `frota_checklist_pdf` | Task 6 (leitura `/copias`); fila do Plano 6 |
| `frota_checklist_itens`, `frota_checklist_config`, `frota_plano_revisao` | Task 7 |
| `frota_manutencoes`, `frota_revisoes`, `frota_abastecimentos` | Task 8 |
| RPC `etiqueta_quem_e`, `frota_corrente_do_veiculo` | Task 9 |

Gatilhos: os 12 das `frota_*` (19 linhas de `03-triggers.csv:7-25`) ficam no banco, verbatim, e são exercidos com a identidade da transação (Task 1); `bem_de_veiculo_segue_a_frota` e os `patrimonio_espelha_*` são do 5.2. Spec §5 (catálogo, IDOR, ator × operação × recurso), §6 (gatilhos ficam e veem a identidade), §11 (autoria da sessão, impersonação sem escrita), §13 (concorrência e falha no meio da gravação testadas).

**O que vem depois:**
- **5.4** lê `frota_veiculos` por `GET /frota/veiculos?pessoa_id=` (com `contar=1`); o **5.2** grava `frota_veiculos` pela tela do Patrimônio por `POST`/`PATCH /frota/veiculos`.
- **Plano 6:** `enviar-pdf-checklist` (consumidor das duas filas, com identidade que tenha a Frota) e o Zoho WorkDrive.
- **Plano 7:** os 58 sítios da tabela acima (as três chamadas compostas mudam de forma: checklist, manutenção e troca de posse), os 23 dos outros planos na mesma tela, e os cinco scripts do `coletor/` que gravam na Frota com a chave de serviço.
- O mundo de teste da Frota é interno ao pacote `frota`; a extração para `testebanco` fica para o próximo pacote de rotas que precisar dele.
