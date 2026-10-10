# Sair do Supabase — Plano 4: worker e tarefas agendadas (coletores Meta, mensagens, avisos e manutenção)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **Execute na worktree `api-go-worker`** (branch `feat/api-go-worker`, empilhada sobre `feat/api-go-edges` = Plano 3, já mesclado na `main` pelo PR #340); nunca na `main`. Faça `git add` só dos caminhos de cada task.

**Goal:** Tirar do pg_cron e das edges do Supabase os 17 jobs de produção que este plano porta (os 3 coletores Meta de cron pelo core, as mensagens e avisos a clientes e equipe, e os robôs de manutenção) como 18 tarefas do worker (mais `faxina-da-api`, nova), mais a rota `POST /avisar-decisao-de-reserva`, com o mesmo contrato de cada origem, nome de produção em `robos_execucoes`, nenhum envio repetido e falha sempre visível; e fazer a cópia de segurança diária ler o Postgres novo depois do corte.

**Architecture:** O `worker` do Plano 3 vira um agendador completo (`robfig/cron/v3` em UTC): cada execução roda sob `pg_try_advisory_lock` de duas chaves numa conexão própria, com prazo, linha em `robos_execucoes` (nome de produção, `conferido_em`) e segredos mascarados; envio para fora passa por um livro (`envios_feitos`) que reserva antes de enviar. Cada tarefa é um tipo pequeno no pacote do domínio (`meta`, `conteudo`, `frota`, `mensagens`, `vessel`, `fabrica`) com `Rodar(ctx) error` e `Tarefa() worker.Tarefa`; a Graph só pelo core (`internal/core`, agora com ritmo), push pelo `webpush` do Plano 3, Chatwoot/Z-API/RD por clientes HTTP mínimos. `cmd/api/tarefas.go` monta a lista; `api worker` ganha `listar`, `rodar <tarefa>`, `conferir` e `saude`.

**Tech Stack:** Go 1.26 (`go.mod`; toolchain local 1.27), `chi`, `pgx` v5, `goose`, `robfig/cron/v3` (já no `go.mod`), Postgres 17 (testes em contêiner), `net/http/httptest` para core, Graph, push, Chatwoot, Z-API e RD de mentira; Node 22 (`node --test`) e bash para a cópia de segurança.

**Spec:** `docs/superpowers/specs/2026-10-09-sair-do-supabase-design.md` (§7 Storage no disco, §8 mapa das edges, §8.1 agendamentos, §11 segurança, §12 operação) e `docs/migracao-go/RESULTADO-DO-LEVANTAMENTO.md` (agenda real dos 24 jobs, `estoque-do-site` desligado, `vessel-rd-station` como SQL puro). Contratos de origem: cada `supabase/functions/<edge>/index.ts`, os módulos `_shared` que elas importam e as funções SQL citadas em cada task.

## Global Constraints

- **Nada em produção é tocado por este plano.** Sem `ssh`, sem credencial real, sem `push`. Testes usam só servidores `httptest` e Postgres local descartável; segredos nos testes são textos inventados. Passos de VPS e do dia da virada ficam ESCRITOS (`ops/vps/api-db/LEIA-ME.md`, `docs/migracao-go/NOTAS-DA-IMPLANTACAO.md`) para o dono executar.
- **A Graph da Meta só pelo core** (`POST {CORE_URL}/api/interno/meta/graph`, contrato abaixo), nunca direto; o cliente do worker anda com `RitmoMeta = 600 ms`.
- **Contrato de cada tarefa = o da origem** (edge ou função SQL): mesmo SQL, mesma agenda UTC de `cron.job`, mesmos textos que chegam a pessoas (byte a byte, com vetores gerados no Node 22 pelos próprios módulos `_shared`), exceto onde um Ruling diz o contrário.
- **Nome em `robos_execucoes` = nome de produção.** A tela de saúde casa `robos_esperados` por `LIKE robo || '%'` (`db/migrations/2026-07-31-saude-dos-robos.sql:187`); um nome novo deixaria robô esperado "sem execução". A tabela da seção "Os 24 jobs" é a referência.
- **Nada que sai para fora sai duas vezes** na mesma janela (push, WhatsApp, template do Chatwoot, conversão na RD): livro `envios_feitos` ou reserva na própria linha (`vessel_rd_envios`, `conteudo_reivindicar_hora_h`). Rodar de novo a mesma tarefa (cron, `api worker rodar`, dois workers) nunca reenvia.
- **Falha visível:** erro de qualquer peça, aparelho ou envio vira erro da tarefa (linha `ok = false` em `robos_execucoes`); nas tarefas com uma linha por conta (`coletar-dados-*`) a falha de uma conta vira a linha `ok = false` DA CONTA (a view `robos_saude` julga por variante) mais sinal na métrica, no log e no código de saída da CLI; nunca "200 com a falha dentro".
- **Segredos nunca em log, erro ou `robos_execucoes`:** `config.Config.Segredos()` e `mensagens.Config.Segredos()` passam por `worker.Limpar`; erro de rede é desembrulhado (`*url.Error` carrega a URL). Cada task que toca segredo tem teste que procura o segredo na saída.
- **Cada serviço externo tem fake `httptest`** cobrindo falha, lentidão (prazo vencido), 429 e repetição: Web Push (`pushteste`, sufixos `/e500`, `/e429`, `/rede`, `/lento`), RD, Z-API e Chatwoot nos testes da task que os usa; o 429 e o ritmo do core são do `core.Cliente` (`core_test.go`, Plano 3 e Task 3), e cada tarefa da Graph testa a falha da Meta virando erro.
- **Sem dependência nova:** biblioteca padrão, `pgx`, `chi`, `goose`, `robfig/cron/v3` (já no `go.mod`). `go.mod` fica em `go 1.26.0`.
- **Gate real:** `make -C api teste PG_PORTA=58432` (CI do GitHub bloqueado por billing). Teste de banco que **pula** (sem `TEST_DATABASE_URL`) **não é aprovação**: rode com `-v` e confira que não há `--- SKIP`.
- **SQL:** no código de produção, todo parâmetro tem cast explícito (`$1::uuid`, `$2::text`, `$3::timestamptz`, `$4::bigint`); nos testes, sempre que o tipo for ambíguo (o mesmo parâmetro como `uuid` e como texto, `jsonb`, função sobrecarregada): sem isso o insert falha calado e o teste mente. Tabelas anteriores às migrations são conferidas por `api worker conferir` (Task 12).
- **Fuso:** "hoje" e "hora" de São Paulo com `time/tzdata` embutido, salvo onde a edge usava UTC (está no comentário de cada função).
- Cada commit termina com `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Código, comentários e mensagens em português com acentuação correta; textos copiados das edges e do banco ficam como na origem (ex.: `a resposta foi apagada pelo pg_net antes da conferencia`, sem acento, como em produção).
- Comandos `go` rodam em `api/`; `git`, `node` e `bash` na raiz da worktree.

## Review Focus

1. **Dois workers no ar ao mesmo tempo** (deploy sobreposto, `docker compose up` sem parar o antigo) → cada tarefa executa uma vez só e nenhum push, WhatsApp ou template sai duas vezes. Testes: `TestDuasInstanciasSoUmaExecutaEAPuladaNaoGravaLinha` e `TestLivroDeEnvios` (Task 1), mais o "rodar de novo não reenvia" de cada envio (Tasks 3, 4, 5, 8 e 10).
2. **Conta com acento e robôs de prefixo parecido** (`Mantova Móveis`; `meta-hora` × `coletar-dados`; `enviar-push-saldo-08h` × `enviar-push-saldo`) → a linha `coletar-dados-07h · Mantova Móveis` casa `coletar-dados`, e nenhum nome de tarefa cai no esperado errado pela regra do prefixo mais longo. Testes: `TestColetaDiariaUmaLinhaPorContaComONomeDeProducao` (Task 6) e `TestNomesCasamComRobosEsperados` (Task 12).
3. **Virada do dia em São Paulo** (00:05 e 00:30 de Brasília = 03:05 e 03:30 UTC) → dia NOVO e hora 0, não a hora 3 do UTC nem o dia anterior; a repescagem das 00h30 grava a hora 0. Teste: `TestMetaHoraNaViradaDoDiaEmSaoPaulo` (Task 7).
4. **Segredo dentro de erro de serviço externo** (token da instância Z-API no caminho da URL, `api_key` da RD na query, token do Chatwoot) → nunca em `robos_execucoes`, no log nem no erro devolvido. Testes: `TestRespostaSemSegredoECortadaEm500` (Task 1), `TestRDRedeForaNaoGuardaOToken` (Task 2), `TestClassificarEDetalhe` (Task 9) e `TestRelatorioHoraZAPIRecusaEhErroSemToken` (Task 8).
5. **Chatwoot lento até estourar o prazo no meio do lote** → o envio que estava pendurado vira `falhou` (ambíguo: nunca é reenviado) e o resto do lote VOLTA à fila sem gastar tentativa; a rodada termina com erro `limite_de_tempo`. Teste: `TestPrazoAcabaNoMeio` (Task 10).

---

## Pré-voo (antes da Task 1)

- [ ] `cd /Users/gabrielgertrudes/Projetos/Trabalho/lavessel/social-dashboard/.claude/worktrees/api-go-worker && git status --short` → vazio; `git branch --show-current` → `feat/api-go-worker`.
- [ ] Trazer a `main` (o Plano 3 foi mesclado com 2 commits de revisão que esta branch não tem, e com `coletor/vps/`, que a Task 11 edita; os trechos "troque" deste plano foram escritos sobre esse estado):
  ```bash
  git fetch origin
  git merge --no-edit origin/main
  grep -q 'func Filtrar' api/internal/worker/worker.go && test -f coletor/vps/copia-do-banco.sh && grep -q WORKER_TAREFAS_DESLIGADAS api/internal/config/config.go && echo ok
  ```
  Esperado: merge sem conflito (conferido com `git merge-tree` contra `origin/main` = `7adcdd89`) e `ok`. Se a `main` andou depois disso e algum trecho "troque" de uma task não casar exatamente, **pare e reporte**; não adapte por conta própria.
- [ ] `go version` → `go1.26` ou mais novo; `node --version` → `v22` ou mais novo.
- [ ] Docker no ar e porta livre: `lsof -iTCP:58432 -sTCP:LISTEN` → vazio.
- [ ] Banco das etapas (fica no ar até a verificação final):
  ```bash
  docker run -d --rm --name pg-plano4 -e POSTGRES_PASSWORD=x -p 127.0.0.1:58432:5432 postgres:17
  until docker exec pg-plano4 pg_isready -h 127.0.0.1 -U postgres >/dev/null 2>&1; do sleep 1; done
  export TEST_DATABASE_URL='postgres://postgres:x@localhost:58432/postgres?sslmode=disable'
  ```
  Toda etapa "Run" de Go assume `TEST_DATABASE_URL` exportada e o diretório `api/`.
- [ ] Linha de base: `cd api && go test ./... && go test -v ./... 2>&1 | grep -c -- '--- SKIP'` → tudo `ok` e `0`.

## Contrato do core e dos serviços externos (referência para todas as tasks)

**Core** — fonte: `vessel-core-go`, commit `e8a06e8c3` (relido em 2026-10-10; o core virou Go no PR #242, o Plano 3 leu o Laravel em `168882e29`; ver Ruling da lacuna).

| | Meta (Graph pelo core) |
|---|---|
| Rota | `POST {CORE_URL}/api/interno/meta/graph`, grupo de limite "espelho" (`services/core/cmd/core/meta.go:40-42`) |
| Autenticação | `Authorization: Bearer <CORE_API_TOKEN>`; sem token válido `401 {"erro":"nao_autorizado"}`, escopo errado `403 {"erro":"escopo_negado"}`, acima do limite `429 {"erro":"limite_excedido"}` + `Retry-After` (`internal/auth/consumidor.go:123,135,139,144`) |
| Limite | 120 chamadas/min **por consumidor** (`internal/config/config.go:172`, `APILimiteMin`): o worker anda a 600 ms por chamada (~100/min) e deve ter consumidor próprio |
| Caminhos de GET aceitos | `^(/(me\|act_\d+\|\d+)(/[a-z_]+){0,3}\|/search)$` (barras verticais escapadas só por causa da tabela) (`internal/meta/http.go:109`, checado em `:187`); o teste `permitidoNoCore` (Task 6) confere todo caminho que o worker pede |
| Corpo | `{caminho, metodo, parametros}` (o `core.PedidoMeta` do Plano 3); `parametros` ≤ 64 KB, senão 413 (`internal/meta/http.go:116,196`) |
| Repetição no cliente | só 429, até 3 tentativas, `Retry-After` (Plano 3, `core.Cliente.Meta`) |

**Outros serviços** (contrato = o da edge de origem):

| Serviço | Chamada | Fonte |
|---|---|---|
| Web Push | RFC 8291/8292 (`webpush.Enviar`, Plano 3); 404/410 poda a inscrição | `supabase/functions/enviar-push-*/index.ts` |
| Z-API | `POST https://api.z-api.io/instances/{ZAPI_INSTANCE_ID}/token/{ZAPI_INSTANCE_TOKEN}/send-text`, cabeçalho `Client-Token: {ZAPI_TOKEN}`, corpo `{phone, message}`; não-2xx = `Z-API send-text: <status> <corpo>` | `supabase/functions/enviar-relatorio-hora/index.ts:78-83` |
| Chatwoot | `{CHATWOOT_URL}/api/v1/accounts/{conta}` + `/contacts/search`, `/contacts`, `/contacts/{id}` (PUT), `/conversations`, `/conversations/{id}/messages`, com `api_access_token`; reserva do aviso em `/custom_api/v1/accounts/{conta}/avisos/reservar` e `/liberar` com `X-Bot-Secret` | `supabase/functions/_shared/cliente-chatwoot.js:36,67,94,111-159` |
| RD Station | `POST https://api.rd.services/platform/conversions?api_key=<token>`, corpo = `vessel_rd_payload(origem_id)`, prazo 30 s | `db/migrations/2026-09-28-zz-vessel-rd-station-segura-sem-email.sql:61` |

## Os 24 jobs de produção (e o que mais o worker roda)

Fonte: `cron.job` de produção (`docs/migracao-go/RESULTADO-DO-LEVANTAMENTO.md`, "Agendamentos reais"; spec §8.1). "Nome de produção" é o `robo` gravado em `robos_execucoes`, que a tela casa com `robos_esperados`.

| # | Job (`cron.job`) | Origem | Cron UTC | Nome de produção | Destino |
|---|---|---|---|---|---|
| 1 | `abandono-de-checkout` | SQL `mover_abandonados_para_fila(p_minutos => 10)` | `* * * * *` | `abandono-de-checkout` (passa a gravar linha) | Plano 4 — Task 2 |
| 2 | `coletar-dados-07h` | edge `coletar-dados` via `disparar_coletor` | `0 10 * * *` | `coletar-dados-07h · <conta>` (uma por conta) | Plano 4 — Tasks 6 e 7 |
| 3 | `coletar-dados-12h` | idem | `0 15 * * *` | `coletar-dados-12h · <conta>` | Plano 4 — Tasks 6 e 7 |
| 4 | `coletar-dados-18h` | idem | `0 21 * * *` | `coletar-dados-18h · <conta>` | Plano 4 — Tasks 6 e 7 |
| 5 | `coletar-dados-2359` | idem | `59 2 * * *` | `coletar-dados-2359 · <conta>` | Plano 4 — Tasks 6 e 7 |
| 6 | `coletar-dados-hora` | edge `coletar-dados-hora` | `5 * * * *` | `meta-hora` | Plano 4 — Task 7 |
| 7 | `coletar-dados-hora-retentativa-00h` | edge `coletar-dados-hora` | `30 3 * * *` | `meta-hora-retentativa-00h` | Plano 4 — Task 7 |
| 8 | `conferir-robos` | SQL `conferir_robos()` | `2-59/5 * * * *` | `conferir-robos` (passa a gravar linha) | Plano 4 — Task 2 |
| 9 | `conteudo-espelho` | edge `conteudo-espelho` | `*/30 * * * *` | `conteudo-espelho` | Plano 4 — Task 5 |
| 10 | `conteudo-hora-h` | edge `conteudo-hora-h` | `*/5 * * * *` | `conteudo-hora-h` | Plano 4 — Task 5 |
| 11 | `enviar-mensagem-abandono` | edge `enviar-mensagem-abandono` (Chatwoot) | `* * * * *` | `enviar-mensagem-abandono` | Plano 4 — Tasks 9 e 10 |
| 12 | `enviar-pdf-checklist` | edge `enviar-pdf-checklist` (Zoho WorkDrive) | `*/10 * * * *` | — | Plano 6 (fica no Supabase até lá) |
| 13 | `enviar-push-frota` | edge `enviar-push-frota` | `30 10 * * 1-5` | `enviar-push-frota` | Plano 4 — Task 4 |
| 14 | `enviar-relatorio-hora` | edge `enviar-relatorio-hora` (Z-API) | `10 * * * *` | `enviar-relatorio-hora` | Plano 4 — Task 8 |
| 15 | `fabrica-purga-diaria` | edge `fabrica-purga` | `17 4 * * *` | `fabrica-purga` | Plano 4 — Task 2 |
| 16 | `integridade-diaria` | edge `auditar-dados` + SQL `run_integrity_checks` | `30 2 * * *` | `auditar-dados` | Plano 4 — Task 6 |
| 17 | `push-saldo-08h` | edge `enviar-push-saldo` | `0 11 * * *` | `enviar-push-saldo-08h` | Plano 4 — Task 3 |
| 18 | `push-vendas-07h` | edge `enviar-push-vendas` | `0 10 * * *` | `enviar-push-vendas-07h` | Plano 3 (feito) |
| 19 | `push-vendas-22h` | edge `enviar-push-vendas` | `0 1 * * *` | `enviar-push-vendas-22h` | Plano 3 (feito) |
| 20 | `vessel-espelhar-lista` | edge `vessel-espelhar-lista` (Zoho Sheet) | `*/3 * * * *` | — | Plano 6 |
| 21 | `vessel-lembretes` | edge `vessel-lembretes` | `0 12 * * *` | — | Plano 6 |
| 22 | `vessel-log-de-carocos` | edge `vessel-log-de-carocos` (Zoho) | `4,14,24,34,44,54 * * * *` | — | Plano 6 |
| 23 | `vessel-rd-station` | SQL `vessel_rd_enviar()` (`pg_net` → RD Station) | `* * * * *` | `vessel-rd-station` (passa a gravar linha) | Plano 4 — Task 2 (portado) |
| 24 | `vessel-triagem-da-vaga` | edge `vessel-triagem-da-vaga` (Zoho) | `* * * * *` | — | Plano 6 |
| — | `estoque-do-site` | (nas migrations; desligado em 2026-10-08) | — | — | não portar |
| — | `teste-auditar-agora` | (resíduo de teste; não existe em produção) | — | — | não portar |
| — | `guardar-copia-do-banco` (fora do pg_cron) | `coletor/vps/robos.cron` → `copia-do-banco.sh` → `guardar-copia-do-banco.mjs` | `12 6 * * *` | `guardar-copia-do-banco` | Plano 4 — Task 11 |
| — | `faxina-da-api` (nova) | — | `41 5 * * *` | `faxina-da-api` | Plano 4 — Task 2 |
| — | `avisar-decisao-de-reserva` (rota, não job) | edge chamada pelo front | — | — | Plano 4 — Task 4 (`POST /avisar-decisao-de-reserva`) |

## Estrutura de arquivos

```
api/internal/worker/worker.go              # agendador: trava de 2 chaves, prazo, robos_execucoes, métricas, /saude, desligamento (reescrito; Filtrar mantida)
api/internal/worker/manutencao.go          # conferir-robos e faxina-da-api
api/internal/banco/envios.go               # livro de envios: ReservarEnvio / LiberarEnvio
api/internal/banco/migracoes/00003_envios_feitos.sql
api/internal/config/config.go              # + WORKER_ADDR, RD_STATION_TOKEN, ARQUIVOS_DIR, ALERT_WEBHOOK_URL, ZAPI_*; Segredos()
api/internal/core/core.go                  # + RitmoMeta (intervalo mínimo entre chamadas à Meta)
api/internal/texto/texto.go                # formatação igual ao JS (Intl pt-BR, UTF-16, \s do JS)
api/internal/webpush/destinatarios.go      # quem recebe cada tipo de push + entrega com o livro
api/internal/webpush/pushteste/pushteste.go # serviço de push de mentira para os testes dos outros pacotes
api/internal/meta/graph.go                 # GET e paginação da Graph pelo core
api/internal/meta/saldo.go, push_saldo.go  # enviar-push-saldo-08h
api/internal/meta/coleta.go                # coletar-dados (Instagram), 4 rodadas, uma linha por conta
api/internal/meta/coleta_anuncios.go       # coletar-dados (campanhas, anúncios, conjuntos, insights)
api/internal/meta/auditar.go               # auditar-dados + run_integrity_checks em Go
api/internal/meta/hora.go                  # meta-hora e meta-hora-retentativa-00h
api/internal/meta/relatorio_hora.go        # enviar-relatorio-hora + cliente Z-API
api/internal/frota/regras.go, push_frota.go, reserva.go   # enviar-push-frota e POST /avisar-decisao-de-reserva
api/internal/conteudo/pictografico.go, casar.go, hora_h.go, espelho.go   # conteudo-hora-h e conteudo-espelho
api/internal/mensagens/mover.go            # abandono-de-checkout
api/internal/mensagens/regras.go, config.go, chatwoot.go, fila.go, rodadas.go   # enviar-mensagem-abandono
api/internal/vessel/rd.go                  # vessel-rd-station
api/internal/fabrica/purga.go              # fabrica-purga
api/internal/web/rotas.go                  # + POST /avisar-decisao-de-reserva
api/cmd/api/main.go                        # worker não migra; `worker saude` sem banco
api/cmd/api/worker.go                      # api worker [listar | rodar <t> [--forcar] | conferir | saude]
api/cmd/api/tarefas.go                     # a lista de tarefas de produção
api/cmd/api/conferir.go                    # premissas de schema que o worker presume
coletor/lib/fonte-pg.mjs                   # a cópia de segurança lendo o Postgres próprio
coletor/guardar-copia-do-banco.mjs, coletor/restaurar-copia.mjs   # usam fonte-pg com COPIA_DATABASE_URL
coletor/vps/copia-do-banco.sh              # monta COPIA_DATABASE_URL pelo IP do api-db
ops/vps/api-db/papel-copia.sql, LEIA-ME.md # papel só leitura `copia`
.github/workflows/copia-do-banco.yml       # retaguarda até o corte, com trava SAIU_DO_SUPABASE
docs/migracao-go/NOTAS-DA-IMPLANTACAO.md   # seção do Plano 4
```

## Tarefas

| # | Task | Revisor |
|---|---|---|
| 1 | Framework do worker: trava de duas chaves, livro de envios, `robos_execucoes` com nome de produção, CLI, saúde e desligamento gracioso | **opus (idempotência, segredos)** |
| 2 | Manutenção e robôs de SQL puro: `conferir-robos`, `faxina-da-api`, `abandono-de-checkout`, `vessel-rd-station`, `fabrica-purga` | **opus (token na URL, apaga arquivos)** |
| 3 | Graph com ritmo, push compartilhado, formatação do JS e `enviar-push-saldo-08h` | **opus (push a pessoas)** |
| 4 | Frota: `enviar-push-frota` e `POST /avisar-decisao-de-reserva` | **opus (rota autenticada, push a pessoas)** |
| 5 | Conteúdo: `conteudo-hora-h` e `conteudo-espelho` | padrão |
| 6 | `coletar-dados` (Instagram, 4 rodadas, linha por conta) e `auditar-dados` com `run_integrity_checks` em Go | padrão |
| 7 | `coletar-dados` (anúncios), `meta-hora` e `meta-hora-retentativa-00h` | padrão |
| 8 | `enviar-relatorio-hora` pela Z-API | **opus (mensagem a grupo, token no caminho)** |
| 9 | Mensagens de abandono: regras e cliente do Chatwoot | **opus (mensagem a cliente, credencial)** |
| 10 | Mensagens de abandono: fila, rodadas e tarefa | **opus (mensagem a cliente, idempotência)** |
| 11 | Cópia de segurança lê o Postgres novo (papel `copia`, VPS, retaguarda do GitHub) | **opus (cópia do banco, credencial)** |
| 12 | Montagem final: `api worker conferir`, nomes × `robos_esperados`, notas de implantação | padrão |

Ordem: 1 → 12 em sequência (cada task acrescenta uma linha em `cmd/api/tarefas.go` e um bloco no mapa `producao` de `cmd/api/worker_test.go`; ver "Interfaces"). Cada task termina com o pacote compilando e todos os testes passando: o ensaio deste plano reaplicou as 12 tasks, em ordem, sobre a `main` mesclada e rodou `gofmt`, `go vet`, `go build` e os testes de cada task (com `-race` e sem `--- SKIP`).

---

### Task 1: Framework do worker: trava de duas chaves, livro de envios, `robos_execucoes`, CLI, saúde e desligamento

**Revisor:** **opus** (trava entre instâncias, idempotência de envio, segredo fora de log).

O `worker` do Plano 3 tem `Registrar`/`Iniciar`, trava de UMA chave e devolve `nil` mesmo quando a tarefa falha. Esta task reescreve `api/internal/worker/worker.go` inteiro (a `Filtrar` do Plano 3 continua no fim do arquivo, sem mudança) com as regras da spec §8.1:

- agenda em UTC (`cron.WithLocation(time.UTC)`), sem recuperar execução perdida;
- trava `pg_try_advisory_lock($1::int, hashtext($2::text))` com `EspacoDaTrava = 0x57524B52`, numa conexão PRÓPRIA (fora do pool), solta explicitamente antes de fechar; execução pulada só loga e conta em `Metrica.Puladas`;
- prazo por tarefa (`Limite`), pânico vira erro;
- linha em `robos_execucoes` com o nome de produção: `status_code` 200/500, `ok`, `resposta` "ok" ou o erro limpo de segredos e cortado em 500 caracteres (o `left(r.content, 500)` de `conferir_robos`, `db/migrations/2026-07-31-saude-dos-robos.sql:96-126`, linha 108), `conferido_em = now()`;
- `RegistroProprio` (para tarefas que gravam uma linha por conta) e `Gravador()`;
- `WORKER_TAREFAS_DESLIGADAS` desliga SEM desregistrar (para `api worker rodar <t> --forcar`);
- `Iniciar`: no cancelamento para de agendar, espera `Graca` (30 s), cancela o contexto das tarefas e espera mais 15 s;
- `Saude()`: `GET /saude` e `GET /metricas`, só leitura.

O livro `envios_feitos` (migração goose 00003) dá idempotência a todo envio das próximas tasks. O `main` passa o subcomando `worker` para `cmd/api/worker.go` e o worker deixa de migrar (Ruling); `api worker saude` responde sem abrir o banco (healthcheck). O teste do push de vendas do Plano 3 muda para esperar o erro que `Rodar` agora devolve.

**Files:**
- Modify (arquivo inteiro): `api/internal/worker/worker.go`
- Test (modify): `api/internal/worker/worker_test.go`
- Create: `api/internal/banco/envios.go`
- Create: `api/internal/banco/migracoes/00003_envios_feitos.sql`
- Modify: `api/internal/config/config.go`
- Test (modify): `api/internal/config/config_test.go`
- Modify (arquivo inteiro): `api/cmd/api/main.go`
- Create: `api/cmd/api/worker.go`
- Create: `api/cmd/api/tarefas.go`
- Test: `api/cmd/api/worker_test.go`
- Test (modify): `api/internal/comercial/push_vendas_conteudo_test.go`

**Interfaces:**
- Consumes: `banco.Migrar`, `config.Carregar`, `comercial.PushVendas{Pool, Core, VAPID}.Tarefas()` e `webpush.ValidarVAPID` (Plano 3); `worker.Filtrar(ts []Tarefa, desligadas []string) ([]Tarefa, error)` (Plano 3, mantida).
- Produces:
  - `const worker.EspacoDaTrava int32 = 0x57524B52`.
  - `type worker.Tarefa struct { Nome, Agenda string; Limite time.Duration; Trava string; RegistroProprio bool; Executar func(ctx context.Context) error }` — `Trava` vazia = `Nome`.
  - `worker.Novo(p *pgxpool.Pool) *worker.Agendador`, com campos exportados `Desligadas, Segredos []string` e `Graca time.Duration`; métodos `Registrar(Tarefa) error`, `Buscar(nome string) (Tarefa, bool)`, `Tarefas() []Tarefa`, `Desligada(nome string) bool`, `Rodar(ctx, Tarefa) (executou bool, err error)`, `Gravador() func(ctx context.Context, robo string, inicio time.Time, erro error) error`, `Iniciar(ctx)`, `Saude() http.Handler`.
  - `worker.Gravar(ctx, db banco.Executor, robo string, inicio time.Time, erro error, segredos []string) error`; `worker.Limpar(s string, segredos []string) string`; `type worker.Metrica`.
  - `type banco.Executor interface { Exec(ctx, sql string, arguments ...any) (pgconn.CommandTag, error) }`; `banco.ReservarEnvio(ctx, db Executor, chave string) (bool, error)` (true = esta execução reservou); `banco.LiberarEnvio(ctx, db Executor, chave string) error`; tabela `envios_feitos(chave text primary key, feito_em timestamptz)`.
  - `config.Config.WorkerAddr string`; `func (c config.Config) Segredos() []string`.
  - Em `cmd/api`: `tarefas(p *pgxpool.Pool, cfg config.Config, ag *worker.Agendador) []worker.Tarefa` (cada task seguinte acrescenta uma linha antes do `return ts`), `vapid(cfg) webpush.VAPID`, `rodarWorker(ctx, p, cfg, args []string) int`, `saudeDoWorker(addr string) int`; o mapa `producao` (nome → agenda) em `cmd/api/worker_test.go`, que cada task seguinte estende.

- [ ] **Step 1: Escrever os testes que falham**

Substitua o arquivo inteiro `api/internal/worker/worker_test.go` por:

```go
package worker

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/banco"
	"github.com/rbv-co/social-dashboard/api/internal/testebanco"
)

func nada(context.Context) error { return nil }

func TestAgendasDeProducaoSaoValidas(t *testing.T) {
	a := Novo(testebanco.Novo(t))
	for i, ag := range []string{
		"* * * * *", "0 10 * * *", "0 15 * * *", "0 21 * * *", "59 2 * * *", "5 * * * *", "30 3 * * *",
		"2-59/5 * * * *", "*/30 * * * *", "*/5 * * * *", "30 10 * * 1-5", "10 * * * *", "17 4 * * *",
		"30 2 * * *", "0 11 * * *", "0 1 * * *", "41 5 * * *",
	} {
		if err := a.Registrar(Tarefa{Nome: fmt.Sprintf("t%d", i), Agenda: ag, Limite: time.Second, Executar: nada}); err != nil {
			t.Errorf("agenda %q: %v", ag, err)
		}
	}
	if err := a.Registrar(Tarefa{Nome: "x", Agenda: "isto não é cron", Limite: time.Second, Executar: nada}); err == nil {
		t.Error("agenda inválida deveria falhar")
	}
	if err := a.Registrar(Tarefa{Nome: "t0", Agenda: "* * * * *", Limite: time.Second, Executar: nada}); err == nil {
		t.Error("nome repetido deveria falhar")
	}
}

func linha(t *testing.T, p *pgxpool.Pool, robo string) (ok bool, resp string, n int) {
	t.Helper()
	p.QueryRow(context.Background(), `select count(*) from robos_execucoes where robo = $1`, robo).Scan(&n)
	p.QueryRow(context.Background(), `select coalesce(ok, false), coalesce(resposta, '') from robos_execucoes where robo = $1 order by id desc limit 1`, robo).Scan(&ok, &resp)
	return
}

// semTrava confere em pg_locks (visão do cluster inteiro) que a trava da tarefa não sobrou.
// pg_try_advisory_lock(int, int) guarda a 1ª chave em classid, a 2ª em objid e objsubid = 2.
func semTrava(t *testing.T, p *pgxpool.Pool, trava string) {
	t.Helper()
	var n int
	if err := p.QueryRow(context.Background(), `select count(*) from pg_locks
		where locktype = 'advisory' and objsubid = 2 and granted
		  and classid::bigint = $1::bigint and objid::bigint = (hashtext($2::text)::bigint & 4294967295)`,
		int64(EspacoDaTrava), trava).Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n != 0 {
		t.Fatalf("trava de %q vazou (%d linhas em pg_locks)", trava, n)
	}
}

func TestRodarRegistraSucessoEErroComConferidoEm(t *testing.T) {
	p := testebanco.Novo(t)
	a := Novo(p)
	ctx := context.Background()
	if ex, err := a.Rodar(ctx, Tarefa{Nome: "boa", Limite: time.Second, Executar: nada}); !ex || err != nil {
		t.Fatalf("ex=%v err=%v", ex, err)
	}
	if ok, resp, n := linha(t, p, "boa"); !ok || resp != "ok" || n != 1 {
		t.Fatalf("ok=%v resp=%q n=%d", ok, resp, n)
	}
	ex, err := a.Rodar(ctx, Tarefa{Nome: "ruim", Limite: time.Second, Executar: func(context.Context) error { return errors.New("bling fora") }})
	if !ex || err == nil || err.Error() != "bling fora" {
		t.Fatalf("o erro da tarefa volta para quem chamou: ex=%v err=%v", ex, err)
	}
	if ok, resp, _ := linha(t, p, "ruim"); ok || resp != "bling fora" {
		t.Fatalf("ok=%v resp=%q", ok, resp)
	}
	var semConferir, status500 int
	p.QueryRow(ctx, `select count(*) filter (where conferido_em is null), count(*) filter (where status_code = 500) from robos_execucoes`).Scan(&semConferir, &status500)
	if semConferir != 0 || status500 != 1 {
		t.Fatalf("toda linha nasce conferida (conferir-robos não reescreve): sem conferido_em=%d, status 500=%d", semConferir, status500)
	}
	semTrava(t, p, "boa")
	semTrava(t, p, "ruim")
}

func TestRespostaSemSegredoECortadaEm500(t *testing.T) {
	p := testebanco.Novo(t)
	a := Novo(p)
	a.Segredos = []string{"segredo-do-chatwoot-123", "curto"}
	longo := strings.Repeat("é", 600)
	a.Rodar(context.Background(), Tarefa{Nome: "vaza", Limite: time.Second, Executar: func(context.Context) error {
		return fmt.Errorf("POST https://x/token/segredo-do-chatwoot-123/send curto %s", longo)
	}})
	_, resp, _ := linha(t, p, "vaza")
	if strings.Contains(resp, "segredo-do-chatwoot-123") || !strings.Contains(resp, "/token/***/send curto") {
		t.Fatalf("segredo na resposta (ou o curto foi trocado): %q", resp)
	}
	if n := len([]rune(resp)); n != 500 {
		t.Fatalf("resposta com %d caracteres, esperava 500", n)
	}
}

func TestLimiteDeTempoCancelaATarefa(t *testing.T) {
	p := testebanco.Novo(t)
	a := Novo(p)
	a.Rodar(context.Background(), Tarefa{Nome: "lenta", Limite: 50 * time.Millisecond,
		Executar: func(ctx context.Context) error { <-ctx.Done(); return ctx.Err() }})
	if ok, resp, _ := linha(t, p, "lenta"); ok || !strings.Contains(resp, "deadline") {
		t.Fatalf("ok=%v resp=%q", ok, resp)
	}
	semTrava(t, p, "lenta")
}

func TestDuasInstanciasSoUmaExecutaEAPuladaNaoGravaLinha(t *testing.T) {
	p := testebanco.Novo(t)
	a, b := Novo(p), Novo(p) // dois processos de worker no mesmo banco (deploy sobreposto)
	preso, liberar := make(chan struct{}), make(chan struct{})
	tarefa := Tarefa{Nome: "unica", Limite: 5 * time.Second, Executar: func(context.Context) error {
		close(preso)
		<-liberar
		return nil
	}}
	feito := make(chan bool)
	go func() { ex, _ := a.Rodar(context.Background(), tarefa); feito <- ex }()
	select {
	case <-preso:
	case <-time.After(5 * time.Second):
		t.Fatal("a primeira execução não começou")
	}
	ex, err := b.Rodar(context.Background(), Tarefa{Nome: "unica", Limite: time.Second, Executar: func(context.Context) error { t.Error("não podia executar"); return nil }})
	if ex || err != nil {
		t.Fatalf("segunda: ex=%v err=%v", ex, err)
	}
	close(liberar)
	if !<-feito {
		t.Fatal("a primeira deveria ter executado")
	}
	if _, _, n := linha(t, p, "unica"); n != 1 {
		t.Fatalf("pulada não grava linha: esperava 1, achei %d", n)
	}
	if b.metricas["unica"].Puladas != 1 {
		t.Fatalf("pulada não contou: %+v", b.metricas["unica"])
	}
}

func TestTravaCompartilhadaEntreTarefas(t *testing.T) {
	p := testebanco.Novo(t)
	a := Novo(p)
	preso, liberar := make(chan struct{}), make(chan struct{})
	go a.Rodar(context.Background(), Tarefa{Nome: "meta-hora", Trava: "coletar-dados-hora", Limite: 5 * time.Second,
		Executar: func(context.Context) error { close(preso); <-liberar; return nil }})
	<-preso
	ex, _ := a.Rodar(context.Background(), Tarefa{Nome: "meta-hora-retentativa-00h", Trava: "coletar-dados-hora", Limite: time.Second, Executar: nada})
	close(liberar)
	if ex {
		t.Fatal("tarefas com a mesma Trava não podem rodar juntas")
	}
}

func TestEspacoDeDuasChavesNaoColideComAsFuncoesSQL(t *testing.T) {
	p := testebanco.Novo(t)
	a := Novo(p)
	ctx := context.Background()
	// Uma função de produção segura a trava de UMA chave com o mesmo texto: o worker roda mesmo assim.
	tx, err := p.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `select pg_advisory_xact_lock(hashtext('pegar_da_fila'))`); err != nil {
		t.Fatal(err)
	}
	if ex, err := a.Rodar(ctx, Tarefa{Nome: "pegar_da_fila", Limite: time.Second, Executar: nada}); !ex || err != nil {
		t.Fatalf("colidiu com a trava de uma chave: ex=%v err=%v", ex, err)
	}
}

func TestPanicoViraErroELiberaATrava(t *testing.T) {
	p := testebanco.Novo(t)
	a := Novo(p)
	ctx := context.Background()
	ex, err := a.Rodar(ctx, Tarefa{Nome: "boom", Limite: time.Second, Executar: func(context.Context) error { panic("kaboom") }})
	if !ex || err == nil || !strings.Contains(err.Error(), "kaboom") {
		t.Fatalf("ex=%v err=%v", ex, err)
	}
	semTrava(t, p, "boom")
	for i, f := range []func(context.Context) error{nada, func(context.Context) error { return errors.New("falha") },
		func(c context.Context) error { <-c.Done(); return c.Err() }} {
		if ex, _ := a.Rodar(ctx, Tarefa{Nome: "boom", Limite: 20 * time.Millisecond, Executar: f}); !ex {
			t.Fatalf("rodada %d depois de liberar a trava não executou", i)
		}
		semTrava(t, p, "boom")
	}
	if _, _, n := linha(t, p, "boom"); n != 4 {
		t.Fatalf("esperava 4 linhas, achei %d", n)
	}
}

// Pool de 2 conexões e 6 tarefas que USAM o banco ao mesmo tempo: a trava não pode tomar conexão do
// pool (senão as tarefas esperariam umas pelas outras até o prazo).
func TestTarefasQueUsamOBancoNaoTravamOPool(t *testing.T) {
	grande := testebanco.Novo(t)
	cfg := grande.Config()
	cfg.MaxConns = 2
	pequeno, err := pgxpool.NewWithConfig(context.Background(), cfg)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pequeno.Close)
	a := Novo(pequeno)
	var wg sync.WaitGroup
	for i := range 6 {
		wg.Go(func() {
			a.Rodar(context.Background(), Tarefa{Nome: fmt.Sprintf("pool-%d", i), Limite: 5 * time.Second,
				Executar: func(ctx context.Context) error {
					_, err := pequeno.Exec(ctx, `select pg_sleep(0.1)`)
					return err
				}})
		})
	}
	feito := make(chan struct{})
	go func() { wg.Wait(); close(feito) }()
	select {
	case <-feito:
	case <-time.After(10 * time.Second):
		t.Fatal("tarefas presas: a trava está disputando o pool")
	}
	for i := range 6 {
		if ok, resp, n := linha(t, grande, fmt.Sprintf("pool-%d", i)); !ok || n != 1 {
			t.Errorf("pool-%d: ok=%v resp=%q n=%d", i, ok, resp, n)
		}
	}
}

func TestRegistroProprioSoGravaALinhaDaTarefaNaFalha(t *testing.T) {
	p := testebanco.Novo(t)
	a := Novo(p)
	gravar := a.Gravador()
	ctx := context.Background()
	a.Rodar(ctx, Tarefa{Nome: "coletar-dados-07h", RegistroProprio: true, Limite: time.Second, Executar: func(ctx context.Context) error {
		return gravar(ctx, "coletar-dados-07h · Vessel", time.Now(), nil)
	}})
	if _, _, n := linha(t, p, "coletar-dados-07h"); n != 0 {
		t.Fatal("com RegistroProprio e sucesso, o agendador não grava a linha dele")
	}
	if ok, _, n := linha(t, p, "coletar-dados-07h · Vessel"); !ok || n != 1 {
		t.Fatal("a linha da variante não foi gravada")
	}
	a.Rodar(ctx, Tarefa{Nome: "coletar-dados-07h", RegistroProprio: true, Limite: time.Second, Executar: func(context.Context) error { panic("x") }})
	if ok, _, n := linha(t, p, "coletar-dados-07h"); ok || n != 1 {
		t.Fatal("falha inteira tem de aparecer com o nome da tarefa")
	}
}

func TestDesligadaNaoAgendaMasFicaParaORodarManual(t *testing.T) {
	a := Novo(testebanco.Novo(t))
	a.Desligadas = []string{"vessel-rd-station"}
	if err := a.Registrar(Tarefa{Nome: "vessel-rd-station", Agenda: "* * * * *", Limite: time.Second, Executar: nada}); err != nil {
		t.Fatal(err)
	}
	if err := a.Registrar(Tarefa{Nome: "conferir-robos", Agenda: "* * * * *", Limite: time.Second, Executar: nada}); err != nil {
		t.Fatal(err)
	}
	if len(a.cron.Entries()) != 1 {
		t.Fatalf("só a ligada entra na agenda: %d entradas", len(a.cron.Entries()))
	}
	if _, ok := a.Buscar("vessel-rd-station"); !ok || !a.Desligada("vessel-rd-station") || a.Desligada("conferir-robos") {
		t.Fatal("a desligada continua registrada (para `api worker rodar --forcar`)")
	}
	a.Desligadas = []string{"*"}
	if !a.Desligada("qualquer") {
		t.Fatal(`"*" desliga todas`)
	}
}

func TestLimiteEExecutarInvalidosSaoRejeitados(t *testing.T) {
	p := testebanco.Novo(t)
	a := Novo(p)
	casos := map[string]Tarefa{
		"limite zero":     {Nome: "v1", Agenda: "* * * * *", Executar: nada},
		"limite negativo": {Nome: "v2", Agenda: "* * * * *", Limite: -time.Second, Executar: nada},
		"executar nil":    {Nome: "v3", Agenda: "* * * * *", Limite: time.Second},
		"sem nome":        {Agenda: "* * * * *", Limite: time.Second, Executar: nada},
	}
	for nome, tf := range casos {
		if err := a.Registrar(tf); err == nil {
			t.Errorf("%s: Registrar deveria falhar", nome)
		}
		if ex, err := a.Rodar(context.Background(), tf); ex || err == nil {
			t.Errorf("%s: Rodar deveria falhar sem executar (ex=%v err=%v)", nome, ex, err)
		}
	}
	var n int
	p.QueryRow(context.Background(), `select count(*) from robos_execucoes`).Scan(&n)
	if n != 0 {
		t.Fatalf("nenhuma linha podia ser gravada: %d", n)
	}
}

// Desligamento: a tarefa em andamento tem a Graca; depois o contexto dela é cancelado e a linha de
// erro ainda é gravada (nada fica pendurado sem registro).
func TestDesligamentoCancelaDepoisDaGraca(t *testing.T) {
	p := testebanco.Novo(t)
	a := Novo(p)
	a.Graca = 100 * time.Millisecond
	comecou := make(chan struct{})
	var uma sync.Once
	if err := a.Registrar(Tarefa{Nome: "presa", Agenda: "@every 1s", Limite: time.Minute, Executar: func(ctx context.Context) error {
		uma.Do(func() { close(comecou) })
		<-ctx.Done()
		return ctx.Err()
	}}); err != nil {
		t.Fatal(err)
	}
	ctx, parar := context.WithCancel(context.Background())
	fim := make(chan struct{})
	go func() { a.Iniciar(ctx); close(fim) }()
	select {
	case <-comecou:
	case <-time.After(5 * time.Second):
		t.Fatal("a tarefa não foi agendada")
	}
	parar()
	select {
	case <-fim:
	case <-time.After(10 * time.Second):
		t.Fatal("Iniciar não voltou depois da graça")
	}
	if ok, resp, n := linha(t, p, "presa"); ok || n != 1 || !strings.Contains(resp, "canceled") {
		t.Fatalf("ok=%v resp=%q n=%d", ok, resp, n)
	}
}

func TestSaudeEMetricas(t *testing.T) {
	p := testebanco.Novo(t)
	a := Novo(p)
	a.Segredos = []string{"segredo-123456"}
	a.Registrar(Tarefa{Nome: "falha", Agenda: "0 1 * * *", Limite: time.Second, Executar: func(context.Context) error { return errors.New("x segredo-123456") }})
	a.Rodar(context.Background(), Tarefa{Nome: "falha", Limite: time.Second, Executar: func(context.Context) error { return errors.New("x segredo-123456") }})
	h := a.Saude()
	w := httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest("GET", "/saude", nil))
	if w.Code != 503 {
		t.Fatalf("parado: %d", w.Code)
	}
	a.rodando.Store(true)
	w = httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest("GET", "/saude", nil))
	if w.Code != 200 {
		t.Fatalf("rodando: %d", w.Code)
	}
	w = httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest("GET", "/metricas", nil))
	var m map[string]struct {
		Agenda     string `json:"agenda"`
		Falhas     int64  `json:"falhas"`
		UltimoErro string `json:"ultimo_erro"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &m); err != nil || m["falha"].Falhas != 1 || m["falha"].Agenda != "0 1 * * *" {
		t.Fatalf("métricas: %s (%v)", w.Body, err)
	}
	if strings.Contains(w.Body.String(), "segredo-123456") {
		t.Fatalf("segredo nas métricas: %s", w.Body)
	}
	w = httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest("POST", "/saude", nil))
	if w.Code != 405 {
		t.Fatalf("saúde é só leitura: POST = %d", w.Code)
	}
}

func TestLivroDeEnvios(t *testing.T) {
	p := testebanco.Novo(t)
	ctx := context.Background()
	if ok, err := banco.ReservarEnvio(ctx, p, "relatorio:2026-10-10:14:wpp"); !ok || err != nil {
		t.Fatalf("primeira reserva: ok=%v err=%v", ok, err)
	}
	if ok, _ := banco.ReservarEnvio(ctx, p, "relatorio:2026-10-10:14:wpp"); ok {
		t.Fatal("a mesma chave não pode ser reservada duas vezes")
	}
	if err := banco.LiberarEnvio(ctx, p, "relatorio:2026-10-10:14:wpp"); err != nil {
		t.Fatal(err)
	}
	if ok, _ := banco.ReservarEnvio(ctx, p, "relatorio:2026-10-10:14:wpp"); !ok {
		t.Fatal("liberada, pode ser reservada de novo")
	}
}
```

Em `api/internal/config/config_test.go`, troque:

```go
import "testing"
```

por:

```go
import (
	"slices"
	"testing"
)
```

Acrescente ao fim de `api/internal/config/config_test.go`:

```go
func TestCarregarVariaveisDoWorker(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://x")
	t.Setenv("WORKER_ADDR", " 127.0.0.1:8081 ")
	t.Setenv("CORE_API_TOKEN", "tok-do-core")
	c, err := Carregar()
	if err != nil {
		t.Fatal(err)
	}
	if c.WorkerAddr != "127.0.0.1:8081" {
		t.Fatalf("%+v", c)
	}
	if !slices.Contains(c.Segredos(), "tok-do-core") {
		t.Fatalf("o token do core é segredo do worker: %v", c.Segredos())
	}
}
```

Crie `api/cmd/api/worker_test.go`:

```go
package main

import (
	"context"
	"maps"
	"testing"

	"github.com/rbv-co/social-dashboard/api/internal/config"
	"github.com/rbv-co/social-dashboard/api/internal/testebanco"
	"github.com/rbv-co/social-dashboard/api/internal/worker"
)

// producao: nome em robos_execucoes -> agenda de cron.job (UTC). Cada task do Plano 4 acrescenta as
// suas linhas; a Task 12 confere a lista inteira contra a tabela do plano.
var producao = map[string]string{
	"enviar-push-vendas-07h": "0 10 * * *",
	"enviar-push-vendas-22h": "0 1 * * *",
}

func TestTarefasDeProducao(t *testing.T) {
	got := map[string]string{}
	for _, tf := range tarefas(nil, config.Config{}, worker.Novo(nil)) {
		if _, dup := got[tf.Nome]; dup {
			t.Errorf("nome repetido: %s", tf.Nome)
		}
		got[tf.Nome] = tf.Agenda
	}
	if !maps.Equal(got, producao) {
		t.Fatalf("tarefas = %v\nesperava %v", got, producao)
	}
}

func TestWorkerSubcomandos(t *testing.T) {
	p := testebanco.Novo(t)
	ctx := context.Background()
	cfg := config.Config{TarefasDesligadas: []string{"enviar-push-vendas-07h"}}
	casos := []struct {
		args []string
		quer int
	}{
		{[]string{"listar"}, 0},
		{[]string{"rodar"}, 2},
		{[]string{"rodar", "nao-existe"}, 2},
		{[]string{"rodar", "enviar-push-vendas-07h"}, 2}, // desligada sem --forcar
		{[]string{"rodar", "enviar-push-vendas-22h"}, 1}, // VAPID vazio: a tarefa falha (sem rede)
		{[]string{"rodar", "enviar-push-vendas-07h", "--forcar"}, 1},
		{[]string{"bobagem"}, 2},
	}
	for _, c := range casos {
		if got := rodarWorker(ctx, p, cfg, c.args); got != c.quer {
			t.Errorf("worker %v = %d, esperava %d", c.args, got, c.quer)
		}
	}
	// Erro de digitação em WORKER_TAREFAS_DESLIGADAS manteria ligado o que se quis desligar: recusa subir.
	errado := config.Config{TarefasDesligadas: []string{"enviar-push-vendas-7h"}}
	if got := rodarWorker(ctx, p, errado, []string{"listar"}); got != 1 {
		t.Fatalf("nome desconhecido em WORKER_TAREFAS_DESLIGADAS: %d", got)
	}
	var n int
	p.QueryRow(ctx, `select count(*) from robos_execucoes where ok = false and robo like 'enviar-push-vendas-%'`).Scan(&n)
	if n != 2 {
		t.Fatalf("as duas execuções manuais deviam virar linha com erro: %d", n)
	}
	if _, err := p.Exec(ctx, `drop table envios_feitos`); err != nil {
		t.Fatal(err)
	}
	if got := rodarWorker(ctx, p, cfg, []string{"listar"}); got != 1 {
		t.Fatalf("sem as tabelas do worker ele recusa subir: %d", got)
	}
}
```

Em `api/internal/comercial/push_vendas_conteudo_test.go`, troque:

```go
	if _, err := worker.Novo(p).Rodar(context.Background(), pv.Tarefas()[1]); err != nil {
		t.Fatal(err)
	}
```

por:

```go
	if ex, err := worker.Novo(p).Rodar(context.Background(), pv.Tarefas()[1]); !ex || err == nil {
		t.Fatalf("Rodar devolve o erro da tarefa: ex=%v err=%v", ex, err)
	}
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `go test -count=1 ./cmd/api ./internal/comercial ./internal/config ./internal/worker`
Expected: FAIL. Primeiras falhas, como saíram no ensaio deste plano: `--- FAIL: TestPushVendasVAPIDRuimFalhaERegistraNoRobo`, `has no field or method WorkerAddr`, `has no field or method Segredos`, `undefined: EspacoDaTrava`, `has no field or method metricas`, `unknown field Trava in struct literal of type Tarefa` (o pacote `comercial` compila e o teste do push de vendas falha porque `Rodar` ainda devolve `nil`).

- [ ] **Step 3: Implementar**

Substitua o arquivo inteiro `api/internal/worker/worker.go` por:

```go
// Package worker roda as tarefas agendadas (substitui o pg_cron e as edges de cron).
//
// Regras (spec §8.1):
//   - agenda em UTC, como o pg_cron; execução perdida (worker fora do ar na hora) NÃO é recuperada:
//     a próxima é a da agenda seguinte (o robfig/cron calcula a partir de agora);
//   - cada execução roda sob pg_try_advisory_lock de DUAS chaves (EspacoDaTrava, hashtext(trava)),
//     numa conexão própria, fora do pool. O espaço de duas chaves (objsubid = 2 em pg_locks) é
//     separado do de UMA chave bigint que as 26 funções SQL de produção usam
//     (pg_advisory_xact_lock(hashtext(...)), objsubid = 1): nenhuma trava do worker colide com elas;
//   - o resultado vai para robos_execucoes com o nome de PRODUÇÃO (a tela "saúde dos robôs" casa
//     robos_esperados por LIKE '<robo>%') e conferido_em = now().
package worker

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"slices"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/banco"
	"github.com/robfig/cron/v3"
)

// EspacoDaTrava é a 1ª chave do advisory lock de toda tarefa ("WRKR" em ASCII). Nenhuma função SQL
// pode usar pg_advisory_*(int, int) com esta 1ª chave.
const EspacoDaTrava int32 = 0x57524B52

type Tarefa struct {
	Nome   string        // nome de PRODUÇÃO em robos_execucoes
	Agenda string        // cron de 5 campos, em UTC (como o pg_cron)
	Limite time.Duration // prazo de UMA execução; vencido, o contexto da tarefa é cancelado
	// Trava: chave do advisory lock; vazio = Nome. Tarefas que gravam as mesmas linhas dividem a
	// trava (ex.: meta-hora e meta-hora-retentativa-00h).
	Trava string
	// RegistroProprio: a tarefa grava as próprias linhas em robos_execucoes (ex.: uma por conta). O
	// agendador só grava a linha com Nome quando a execução inteira falha (erro, prazo ou pânico).
	RegistroProprio bool
	Executar        func(ctx context.Context) error
}

func (t Tarefa) trava() string {
	if t.Trava != "" {
		return t.Trava
	}
	return t.Nome
}

// Metrica é o que /metricas mostra de cada tarefa (desde que o processo subiu).
type Metrica struct {
	Execucoes       int64     `json:"execucoes"`
	Falhas          int64     `json:"falhas"`
	Puladas         int64     `json:"puladas"` // outra execução segurava a trava
	UltimoInicio    time.Time `json:"ultimo_inicio,omitzero"`
	UltimaDuracaoMs int64     `json:"ultima_duracao_ms"`
	UltimoErro      string    `json:"ultimo_erro,omitempty"`
}

type Agendador struct {
	pool  *pgxpool.Pool
	cron  *cron.Cron
	agora func() time.Time

	Desligadas []string      // WORKER_TAREFAS_DESLIGADAS; "*" desliga todas
	Segredos   []string      // valores que nunca saem em robos_execucoes nem no log
	Graca      time.Duration // desligamento: quanto espera as tarefas em andamento; 0 = 30 s

	ctxTarefas     context.Context
	cancelaTarefas context.CancelFunc
	rodando        atomic.Bool

	mu       sync.Mutex
	tarefas  map[string]Tarefa
	metricas map[string]*Metrica
}

func Novo(p *pgxpool.Pool) *Agendador {
	ctx, cancela := context.WithCancel(context.Background())
	return &Agendador{pool: p, cron: cron.New(cron.WithLocation(time.UTC)), agora: time.Now,
		ctxTarefas: ctx, cancelaTarefas: cancela, tarefas: map[string]Tarefa{}, metricas: map[string]*Metrica{}}
}

func validar(t Tarefa) error {
	if t.Nome == "" {
		return errors.New("tarefa sem nome")
	}
	if t.Limite <= 0 {
		return fmt.Errorf("tarefa %q: Limite deve ser positivo", t.Nome)
	}
	if t.Executar == nil {
		return fmt.Errorf("tarefa %q: Executar não pode ser nil", t.Nome)
	}
	return nil
}

// Desligada: o nome está em WORKER_TAREFAS_DESLIGADAS (ou a lista tem "*").
func (a *Agendador) Desligada(nome string) bool {
	return slices.Contains(a.Desligadas, "*") || slices.Contains(a.Desligadas, nome)
}

// Registrar guarda a tarefa (para `api worker rodar`/`listar`) e a agenda, a menos que esteja desligada.
func (a *Agendador) Registrar(t Tarefa) error {
	if err := validar(t); err != nil {
		return err
	}
	if _, err := cron.ParseStandard(t.Agenda); err != nil {
		return fmt.Errorf("tarefa %q: agenda %q: %w", t.Nome, t.Agenda, err)
	}
	a.mu.Lock()
	if _, dup := a.tarefas[t.Nome]; dup {
		a.mu.Unlock()
		return fmt.Errorf("tarefa %q registrada duas vezes", t.Nome)
	}
	a.tarefas[t.Nome] = t
	a.metricas[t.Nome] = &Metrica{}
	a.mu.Unlock()
	if a.Desligada(t.Nome) {
		slog.Info("tarefa desligada por WORKER_TAREFAS_DESLIGADAS", "nome", t.Nome)
		return nil
	}
	_, err := a.cron.AddFunc(t.Agenda, func() {
		if _, err := a.Rodar(a.ctxTarefas, t); err != nil {
			slog.Error("tarefa falhou", "nome", t.Nome, "erro", Limpar(err.Error(), a.Segredos))
		}
	})
	return err
}

// Buscar devolve a tarefa registrada (ligada ou desligada).
func (a *Agendador) Buscar(nome string) (Tarefa, bool) {
	a.mu.Lock()
	defer a.mu.Unlock()
	t, ok := a.tarefas[nome]
	return t, ok
}

// Tarefas devolve as registradas, em ordem de nome.
func (a *Agendador) Tarefas() []Tarefa {
	a.mu.Lock()
	defer a.mu.Unlock()
	out := make([]Tarefa, 0, len(a.tarefas))
	for _, t := range a.tarefas {
		out = append(out, t)
	}
	slices.SortFunc(out, func(x, y Tarefa) int { return strings.Compare(x.Nome, y.Nome) })
	return out
}

func (a *Agendador) contar(nome string, f func(*Metrica)) {
	a.mu.Lock()
	defer a.mu.Unlock()
	m := a.metricas[nome]
	if m == nil {
		m = &Metrica{}
		a.metricas[nome] = m
	}
	f(m)
}

// executar roda a tarefa convertendo pânico em erro: uma tarefa defeituosa não derruba o worker.
func executar(ctx context.Context, t Tarefa) (err error) {
	defer func() {
		if r := recover(); r != nil {
			err = fmt.Errorf("pânico: %v", r)
		}
	}()
	return t.Executar(ctx)
}

// Rodar executa UMA vez sob a trava. executou=false (sem erro) = outra execução segura a trava
// (fica no log e em Metrica.Puladas, nunca em robos_execucoes). err = o erro da tarefa (já gravado
// em robos_execucoes) ou da infraestrutura (conexão, gravação).
func (a *Agendador) Rodar(ctx context.Context, t Tarefa) (bool, error) {
	if err := validar(t); err != nil {
		return false, err
	}
	// Conexão PRÓPRIA para a trava (fora do pool): a tarefa usa o pool à vontade e várias tarefas ao
	// mesmo tempo nunca esgotam o pool segurando travas.
	conn, err := pgx.ConnectConfig(ctx, a.pool.Config().ConnConfig.Copy())
	if err != nil {
		return false, err
	}
	defer func() {
		c, cancela := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancela()
		conn.Close(c) // fim da sessão: o Postgres solta qualquer trava que ainda esteja nela
	}()
	var ganhou bool
	if err := conn.QueryRow(ctx, `select pg_try_advisory_lock($1::int, hashtext($2::text))`, EspacoDaTrava, t.trava()).Scan(&ganhou); err != nil {
		return false, err
	}
	if ganhou {
		// Solta EXPLICITAMENTE antes de fechar: o fim da sessão é assíncrono no servidor, e a próxima
		// execução (ou outra instância) poderia achar a trava ainda presa por um instante.
		defer func() {
			c, cancela := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancela()
			if _, err := conn.Exec(c, `select pg_advisory_unlock($1::int, hashtext($2::text))`, EspacoDaTrava, t.trava()); err != nil {
				slog.Error("não consegui soltar a trava; a sessão fecha e o Postgres solta", "nome", t.Nome, "erro", err)
			}
		}()
	}
	if !ganhou {
		a.contar(t.Nome, func(m *Metrica) { m.Puladas++ })
		slog.Info("tarefa pulada: outra execução segura a trava", "nome", t.Nome, "trava", t.trava())
		return false, nil
	}

	ctxT, cancela := context.WithTimeout(ctx, t.Limite)
	defer cancela()
	inicio, relogio := a.agora(), time.Now()
	erro := executar(ctxT, t)
	a.contar(t.Nome, func(m *Metrica) {
		m.Execucoes++
		m.UltimoInicio, m.UltimaDuracaoMs, m.UltimoErro = inicio, time.Since(relogio).Milliseconds(), ""
		if erro != nil {
			m.Falhas++
			m.UltimoErro = cortar(Limpar(erro.Error(), a.Segredos), 200)
		}
	})
	if t.RegistroProprio && erro == nil {
		return true, nil
	}
	// Contexto novo: o da tarefa pode ter vencido. Grava na conexão da trava (o pool pode estar cheio).
	c, cancelaC := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancelaC()
	return true, errors.Join(erro, Gravar(c, conn, t.Nome, inicio, erro, a.Segredos))
}

// Gravar grava UMA linha em robos_execucoes. status_code 200/500 e ok como o conferir_robos fazia
// (ok = status 2xx); resposta "ok" ou o erro sem segredos, com até 500 caracteres (o left(...,500)
// de conferir_robos); conferido_em = now(), para conferir-robos nunca reescrever a linha.
func Gravar(ctx context.Context, db banco.Executor, robo string, inicio time.Time, erro error, segredos []string) error {
	ok, resp, status := erro == nil, "ok", 200
	if erro != nil {
		resp, status = Limpar(erro.Error(), segredos), 500
	}
	_, err := db.Exec(ctx, `insert into robos_execucoes (robo, disparado_em, status_code, ok, resposta, conferido_em)
		values ($1::text, $2::timestamptz, $3::int, $4::boolean, $5::text, now())`, robo, inicio, status, ok, cortar(resp, 500))
	return err
}

// Gravador é o Gravar com o pool e os segredos do agendador: o que as tarefas com RegistroProprio
// recebem (ex.: uma linha por conta em coletar-dados).
func (a *Agendador) Gravador() func(ctx context.Context, robo string, inicio time.Time, erro error) error {
	return func(ctx context.Context, robo string, inicio time.Time, erro error) error {
		return Gravar(ctx, a.pool, robo, inicio, erro, a.Segredos)
	}
}

// Limpar troca cada segredo (com 8 caracteres ou mais) por ***. É a ÚLTIMA barreira: quem monta o
// erro já não deve pôr segredo nele.
func Limpar(s string, segredos []string) string {
	for _, seg := range segredos {
		if len(seg) >= 8 {
			s = strings.ReplaceAll(s, seg, "***")
		}
	}
	return s
}

func cortar(s string, n int) string {
	r := []rune(s)
	if len(r) <= n {
		return s
	}
	return string(r[:n])
}

// Iniciar agenda tudo e bloqueia até ctx acabar. No desligamento: nada novo começa; as tarefas em
// andamento têm Graca para terminar; depois o contexto delas é cancelado (a linha de erro ainda é
// gravada) e Iniciar espera mais 15 s no máximo.
func (a *Agendador) Iniciar(ctx context.Context) {
	a.rodando.Store(true)
	a.cron.Start()
	<-ctx.Done()
	a.rodando.Store(false)
	parado := a.cron.Stop()
	graca := a.Graca
	if graca <= 0 {
		graca = 30 * time.Second
	}
	select {
	case <-parado.Done():
		return
	case <-time.After(graca):
	}
	slog.Warn("desligando: tarefas ainda em andamento; cancelando", "graca", graca)
	a.cancelaTarefas()
	select {
	case <-parado.Done():
	case <-time.After(15 * time.Second):
		slog.Error("desligando: tarefas não terminaram 15 s depois de canceladas")
	}
}

// Saude: GET /saude (200 enquanto agenda, 503 parado) e GET /metricas (JSON por tarefa). Só leitura:
// não há rota que execute tarefa (execução manual é `api worker rodar`).
func (a *Agendador) Saude() http.Handler {
	m := http.NewServeMux()
	m.HandleFunc("GET /saude", func(w http.ResponseWriter, _ *http.Request) {
		if !a.rodando.Load() {
			http.Error(w, "parado", http.StatusServiceUnavailable)
			return
		}
		w.Write([]byte("ok"))
	})
	m.HandleFunc("GET /metricas", func(w http.ResponseWriter, _ *http.Request) {
		type item struct {
			Agenda    string `json:"agenda"`
			Desligada bool   `json:"desligada"`
			Metrica
		}
		a.mu.Lock()
		out := map[string]item{}
		for nome, t := range a.tarefas {
			out[nome] = item{t.Agenda, a.Desligada(nome), *a.metricas[nome]}
		}
		a.mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(out)
	})
	return m
}

// Filtrar tira as tarefas desligadas ("*" desliga todas), para o ensaio não disparar efeitos reais.
// Nome que não é "*" nem de tarefa registrada é erro (um erro de digitação manteria ligado o que
// se quis desligar, ex.: push real no ensaio).
func Filtrar(ts []Tarefa, desligadas []string) ([]Tarefa, error) {
	validos := []string{}
	for _, t := range ts {
		validos = append(validos, t.Nome)
	}
	var desconhecidos []string
	for _, d := range desligadas {
		if d != "*" && !slices.Contains(validos, d) {
			desconhecidos = append(desconhecidos, d)
		}
	}
	if len(desconhecidos) > 0 {
		return nil, fmt.Errorf("WORKER_TAREFAS_DESLIGADAS: nomes desconhecidos %v; válidos: * ou %v", desconhecidos, validos)
	}
	var out []Tarefa
	for _, t := range ts {
		if !slices.Contains(desligadas, "*") && !slices.Contains(desligadas, t.Nome) {
			out = append(out, t)
		}
	}
	return out, nil
}
```

Crie `api/internal/banco/envios.go`:

```go
package banco

import (
	"context"

	"github.com/jackc/pgx/v5/pgconn"
)

// Executor é o que pgxpool.Pool, pgxpool.Conn, pgx.Conn e pgx.Tx têm em comum para escrever.
type Executor interface {
	Exec(ctx context.Context, sql string, arguments ...any) (pgconn.CommandTag, error)
}

// ReservarEnvio é o livro de envios: marca `chave` ANTES de mandar a mensagem. true = esta execução
// pode mandar; false = já foi mandada (ou está sendo, por outra execução). Uma execução repetida
// (manual, duas instâncias, reentrega) nunca reenvia.
func ReservarEnvio(ctx context.Context, db Executor, chave string) (bool, error) {
	tag, err := db.Exec(ctx, `insert into envios_feitos (chave) values ($1::text) on conflict (chave) do nothing`, chave)
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() == 1, nil
}

// LiberarEnvio desfaz a reserva. Só quando o envio COMPROVADAMENTE não saiu (recusa com status):
// num envio ambíguo (prazo, queda no meio) a reserva fica, e a mensagem não é repetida.
func LiberarEnvio(ctx context.Context, db Executor, chave string) error {
	_, err := db.Exec(ctx, `delete from envios_feitos where chave = $1::text`, chave)
	return err
}
```

Crie `api/internal/banco/migracoes/00003_envios_feitos.sql`:

```sql
-- +goose Up
-- Livro de envios do worker e da API: uma linha por mensagem/push JÁ reservado para envio
-- (chave = tarefa:dia:...:destino). Reservar ANTES de enviar é o que impede uma execução repetida
-- (manual, duas instâncias no deploy) de mandar a mesma mensagem de novo. Expurgo: faxina-da-api (45 dias).
create table envios_feitos (
  chave    text primary key,
  feito_em timestamptz not null default now()
);

-- +goose Down
drop table envios_feitos;
```

Em `api/internal/config/config.go`, troque:

```go
	// WORKER_TAREFAS_DESLIGADAS: nomes de tarefas que o worker NÃO registra ("*" = todas).
	// O ensaio roda com banco restaurado de produção: ligue "*" (ou o push) para não mandar push de verdade.
	TarefasDesligadas []string
}
```

por:

```go
	// WORKER_TAREFAS_DESLIGADAS: tarefas que o worker NÃO agenda ("*" = todas); `api worker rodar <t> --forcar` ainda roda.
	// Nome que não é "*" nem de tarefa registrada: o worker recusa subir (worker.Filtrar).
	// O ensaio roda com banco restaurado de produção: ligue "*" (ou o push) para não mandar push de verdade.
	TarefasDesligadas []string

	// Plano 4 (worker).
	WorkerAddr string // WORKER_ADDR: endereço do GET /saude e /metricas do worker; vazio = sem HTTP
}

// Segredos: os valores que nunca podem sair em robos_execucoes nem no log do worker
// (worker.Limpar troca cada um por ***).
func (c Config) Segredos() []string {
	return append([]string{c.CoreToken, c.ChatwootSegredo, c.VAPIDPrivada}, c.ShopifySegredos...)
}
```

Em `api/internal/config/config.go`, troque:

```go
		TarefasDesligadas: lista("WORKER_TAREFAS_DESLIGADAS"),
	}
```

por:

```go
		TarefasDesligadas: lista("WORKER_TAREFAS_DESLIGADAS"),
		WorkerAddr:        strings.TrimSpace(os.Getenv("WORKER_ADDR")),
	}
```

Substitua o arquivo inteiro `api/cmd/api/main.go` por:

```go
package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/rbv-co/social-dashboard/api/internal/auth"
	"github.com/rbv-co/social-dashboard/api/internal/banco"
	"github.com/rbv-co/social-dashboard/api/internal/config"
	"github.com/rbv-co/social-dashboard/api/internal/importacao"
	"github.com/rbv-co/social-dashboard/api/internal/web"
)

func main() {
	if len(os.Args) < 2 {
		slog.Error("uso: api <api|worker [listar|rodar <tarefa> [--forcar]|saude]|importar-usuarios|migrar>")
		os.Exit(2)
	}
	if os.Args[1] == "worker" && len(os.Args) > 2 && os.Args[2] == "saude" {
		os.Exit(saudeDoWorker(os.Getenv("WORKER_ADDR"))) // healthcheck: não abre o banco
	}
	ctx, parar := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer parar()
	cfg, err := config.Carregar()
	if err != nil {
		slog.Error("configuração", "erro", err)
		os.Exit(1)
	}
	p, err := banco.Abrir(ctx, cfg.DatabaseURL)
	if err != nil {
		slog.Error("banco", "erro", err)
		os.Exit(1)
	}
	defer p.Close()
	// O worker NÃO migra: api e worker subindo juntos disputariam a migração (o goose daqui não
	// tem trava). Quem migra é o `api` (ou `api migrar`); o worker confere as tabelas e recusa subir.
	if os.Args[1] != "worker" {
		if err := banco.Migrar(p); err != nil {
			slog.Error("migrations", "erro", err)
			os.Exit(1)
		}
	}
	switch os.Args[1] {
	case "api":
		// Prazos: WriteTimeout acima do maior prazo por requisição (web.PrazoCollabs = 120 s)
		// para o handler terminar e responder antes de a conexão cair; ReadTimeout cobre o
		// corpo de até 5 MB da Shopify em rede ruim; IdleTimeout fecha keep-alive parado.
		srv := &http.Server{Addr: cfg.Addr, Handler: web.Rotas(p, auth.NovoStore(p), auth.NovoLimitador(), cfg),
			ReadHeaderTimeout: 10 * time.Second, ReadTimeout: 30 * time.Second,
			WriteTimeout: web.PrazoCollabs + 30*time.Second, IdleTimeout: 120 * time.Second}
		fim := make(chan struct{})
		go func() {
			<-ctx.Done()
			c, cancela := context.WithTimeout(context.Background(), 15*time.Second)
			defer cancela()
			if err := srv.Shutdown(c); err != nil {
				slog.Error("encerramento", "erro", err)
			}
			close(fim)
		}()
		slog.Info("api no ar", "addr", cfg.Addr)
		if err := srv.ListenAndServe(); !errors.Is(err, http.ErrServerClosed) {
			slog.Error("servidor", "erro", err)
			os.Exit(1)
		}
		<-fim // espera o escoamento das requisições antes do p.Close() adiado
	case "worker":
		codigo := rodarWorker(ctx, p, cfg, os.Args[2:])
		p.Close()
		os.Exit(codigo)
	case "importar-usuarios":
		origem := os.Getenv("ORIGEM_DATABASE_URL")
		if origem == "" {
			slog.Error("defina ORIGEM_DATABASE_URL (somente leitura, restore local no ensaio)")
			os.Exit(1)
		}
		n, ign, err := importacao.Importar(ctx, importacao.FonteSupabase(origem), p, time.Now())
		if err != nil {
			slog.Error("importação", "erro", err)
			os.Exit(1)
		}
		slog.Info("usuários importados", "importados", n, "ignorados_sem_email", ign)
	case "migrar":
		slog.Info("migrations aplicadas")
	default:
		slog.Error("subcomando desconhecido", "cmd", os.Args[1])
		os.Exit(2)
	}
}
```

Crie `api/cmd/api/worker.go`:

```go
package main

import (
	"context"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"slices"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/config"
	"github.com/rbv-co/social-dashboard/api/internal/webpush"
	"github.com/rbv-co/social-dashboard/api/internal/worker"
)

// rodarWorker é o subcomando `api worker`:
//
//	api worker                          agenda tudo e fica no ar (SIGTERM = desligamento gracioso)
//	api worker listar                   nome, agenda (UTC), prazo e se está desligada
//	api worker rodar <tarefa> [--forcar] executa UMA vez agora, com trava e linha em robos_execucoes
//	api worker saude                    GET http://$WORKER_ADDR/saude (healthcheck; tratado em main, sem banco)
//
// Saída de `rodar`: 0 ok, 1 a tarefa falhou, 2 uso errado (tarefa desconhecida, ou desligada sem
// --forcar), 3 pulada (outra execução segura a trava). Não existe rota HTTP que execute tarefa.
func rodarWorker(ctx context.Context, p *pgxpool.Pool, cfg config.Config, args []string) int {
	sub := ""
	if len(args) > 0 {
		sub = args[0]
	}
	if err := conferirTabelas(ctx, p); err != nil {
		slog.Error("worker: banco sem as tabelas do worker; rode `api migrar` (ou suba o api) antes", "erro", err)
		return 1
	}
	ag := worker.Novo(p)
	ag.Desligadas, ag.Segredos = cfg.TarefasDesligadas, cfg.Segredos()
	ts := tarefas(p, cfg, ag)
	if _, err := worker.Filtrar(ts, cfg.TarefasDesligadas); err != nil { // nome desconhecido: recusa subir
		slog.Error("configuração", "erro", err)
		return 1
	}
	if _, err := webpush.ValidarVAPID(vapid(cfg)); err != nil { // o erro nunca traz as chaves
		slog.Warn("VAPID inválido: as tarefas de push vão falhar em toda execução", "erro", err)
	}
	for _, t := range ts {
		if err := ag.Registrar(t); err != nil {
			slog.Error("tarefa inválida", "nome", t.Nome, "erro", err)
			return 1
		}
	}
	switch sub {
	case "":
		if cfg.WorkerAddr != "" {
			srv := &http.Server{Addr: cfg.WorkerAddr, Handler: ag.Saude(), ReadHeaderTimeout: 5 * time.Second}
			go func() {
				if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
					slog.Error("worker: /saude", "erro", err)
				}
			}()
			defer srv.Close()
		}
		slog.Info("worker no ar", "tarefas", len(ag.Tarefas()), "desligadas", cfg.TarefasDesligadas)
		ag.Iniciar(ctx)
		return 0
	case "listar":
		for _, t := range ag.Tarefas() {
			estado := "ligada"
			if ag.Desligada(t.Nome) {
				estado = "DESLIGADA"
			}
			fmt.Printf("%-44s %-26s %-8s %s\n", t.Nome, t.Agenda, t.Limite, estado)
		}
		return 0
	case "rodar":
		if len(args) < 2 {
			fmt.Fprintln(os.Stderr, "uso: api worker rodar <tarefa> [--forcar]")
			return 2
		}
		t, ok := ag.Buscar(args[1])
		if !ok {
			fmt.Fprintf(os.Stderr, "tarefa desconhecida: %q (veja `api worker listar`)\n", args[1])
			return 2
		}
		if ag.Desligada(t.Nome) && !slices.Contains(args[2:], "--forcar") {
			fmt.Fprintf(os.Stderr, "%s está em WORKER_TAREFAS_DESLIGADAS; para rodar mesmo assim: --forcar\n", t.Nome)
			return 2
		}
		executou, err := ag.Rodar(ctx, t)
		switch {
		case err != nil:
			fmt.Fprintf(os.Stderr, "%s falhou: %s\n", t.Nome, worker.Limpar(err.Error(), ag.Segredos))
			return 1
		case !executou:
			fmt.Fprintf(os.Stderr, "%s pulada: outra execução segura a trava\n", t.Nome)
			return 3
		}
		fmt.Printf("%s ok\n", t.Nome)
		return 0
	}
	fmt.Fprintf(os.Stderr, "subcomando desconhecido: worker %s\n", sub)
	return 2
}

// conferirTabelas: as tabelas que o worker escreve existem (o worker não migra; ver main).
func conferirTabelas(ctx context.Context, p *pgxpool.Pool) error {
	_, err := p.Exec(ctx, `select 1 from envios_feitos limit 0; select 1 from robos_execucoes limit 0`)
	return err
}

func saudeDoWorker(addr string) int {
	if addr == "" {
		fmt.Fprintln(os.Stderr, "WORKER_ADDR vazio: o worker não expõe /saude")
		return 1
	}
	cli := &http.Client{Timeout: 3 * time.Second}
	r, err := cli.Get("http://" + addr + "/saude")
	if err != nil {
		fmt.Fprintln(os.Stderr, "worker fora do ar:", err)
		return 1
	}
	defer r.Body.Close()
	io.Copy(io.Discard, r.Body)
	if r.StatusCode != http.StatusOK {
		fmt.Fprintln(os.Stderr, "worker parado:", r.StatusCode)
		return 1
	}
	return 0
}
```

Crie `api/cmd/api/tarefas.go`:

```go
package main

import (
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/comercial"
	"github.com/rbv-co/social-dashboard/api/internal/config"
	"github.com/rbv-co/social-dashboard/api/internal/core"
	"github.com/rbv-co/social-dashboard/api/internal/webpush"
	"github.com/rbv-co/social-dashboard/api/internal/worker"
)

// tarefas monta TODAS as tarefas de produção do worker, com o nome que robos_execucoes já usa (a
// tela de saúde casa robos_esperados por prefixo) e a agenda de cron.job (UTC). A tabela completa
// está no Plano 4 e é conferida por TestTarefasDeProducao. Só monta: nada aqui fala com rede ou banco.
func tarefas(p *pgxpool.Pool, cfg config.Config, ag *worker.Agendador) []worker.Tarefa {
	cli := core.Novo(cfg.CoreURL, cfg.CoreToken)
	var ts []worker.Tarefa
	// HTTP nil: o push herda o cliente seguro (Dialer.Control recusa faixas proibidas).
	pv := &comercial.PushVendas{Pool: p, Core: cli, VAPID: vapid(cfg)}
	ts = append(ts, pv.Tarefas()...)
	return ts
}

func vapid(cfg config.Config) webpush.VAPID {
	return webpush.VAPID{Publica: cfg.VAPIDPublica, Privada: cfg.VAPIDPrivada, Assunto: cfg.VAPIDAssunto}
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `gofmt -l . && go vet ./... && go test -race -count=1 ./internal/worker/ ./internal/banco/ ./internal/config/ ./internal/comercial/ ./cmd/api/ -v 2>&1 | grep -E -- '^(ok|FAIL|--- FAIL|--- SKIP)'`
Expected: `gofmt` não lista nada; só linhas `ok`, nenhuma `FAIL` nem `--- SKIP`.

- [ ] **Step 5: Commit**

```bash
git add api/internal/worker/worker.go api/internal/worker/worker_test.go api/internal/banco/envios.go api/internal/banco/migracoes/00003_envios_feitos.sql api/internal/config/config.go api/internal/config/config_test.go api/cmd/api/main.go api/cmd/api/worker.go api/cmd/api/tarefas.go api/cmd/api/worker_test.go api/internal/comercial/push_vendas_conteudo_test.go
git commit -m "feat(api): worker com trava de duas chaves, livro de envios, robos_execucoes com nome de produção, CLI e desligamento gracioso

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Manutenção e robôs de SQL puro: `conferir-robos`, `faxina-da-api`, `abandono-de-checkout`, `vessel-rd-station`, `fabrica-purga`

**Revisor:** **opus** (token da RD na URL, arquivos apagados do disco).

Cinco tarefas pequenas, todas com o nome de produção:

- `conferir-robos` (`2-59/5 * * * *`): porta `conferir_robos()` (`db/migrations/2026-07-31-saude-dos-robos.sql:96-126`). Sem `pg_net` as linhas já nascem conferidas; a tarefa fecha as antigas sem `conferido_em` (mais de 6 h, com o texto de produção `a resposta foi apagada pelo pg_net antes da conferencia`) e apaga as de mais de 60 dias.
- `faxina-da-api` (`41 5 * * *`, nova): sessões vencidas, `webhooks_recebidos` > 30 dias (pendência do Plano 3) e `envios_feitos` > 45 dias.
- `abandono-de-checkout` (`* * * * *`): `select mover_abandonados_para_fila(p_minutos => 10)` (`db/migrations/2026-09-29-abandono-de-checkout.sql:99,131`). O teste usa o DDL e a função de produção (constante `checkoutAbandono`, reaproveitada na Task 10).
- `vessel-rd-station` (`* * * * *`, PORTADO): porta `vessel_rd_enviar()` (`db/migrations/2026-09-28-zz-vessel-rd-station-segura-sem-email.sql`): reenvia `enviado` parado há 10 min, alterna `sem_email` ↔ `pendente`, reserva até 50 linhas com `for update skip locked` (marca `enviado` e soma tentativa), manda `vessel_rd_payload(origem_id)` à RD com `?api_key=` e grava `status`, `http_status` e `left(resposta, 500)`. Sem `RD_STATION_TOKEN` não chama a RD, arruma a fila e falha visível (`rd_sem_token`). O token nunca aparece em erro nem na linha (o `*url.Error` é desembrulhado).
- `fabrica-purga` (`17 4 * * *`): porta `supabase/functions/fabrica-purga/index.ts`, mas o arquivo mora no disco (spec §7): `<ARQUIVOS_DIR>/fabrica-criativos/<storage_path>`, com `filepath.IsLocal` recusando caminho que escape da pasta; arquivo que já não existe conta como apagado; `purgado_em` na transação.

**Files:**
- Create: `api/internal/worker/manutencao.go`
- Test: `api/internal/worker/manutencao_test.go`
- Create: `api/internal/mensagens/mover.go`
- Test: `api/internal/mensagens/mover_test.go`
- Create: `api/internal/vessel/rd.go`
- Test: `api/internal/vessel/rd_test.go`
- Create: `api/internal/fabrica/purga.go`
- Test: `api/internal/fabrica/purga_test.go`
- Modify: `api/internal/config/config.go`
- Test (modify): `api/internal/config/config_test.go`
- Modify: `api/cmd/api/tarefas.go`
- Test (modify): `api/cmd/api/worker_test.go`

**Interfaces:**
- Consumes: `worker.Tarefa`, `worker.Novo`, `Agendador.Rodar` (Task 1); `testebanco.Novo(t)`; `config.Config` (Task 1).
- Produces:
  - `worker.ConferirRobos(p *pgxpool.Pool) worker.Tarefa`, `worker.FaxinaDaAPI(p *pgxpool.Pool) worker.Tarefa`.
  - `mensagens.MoverAbandonados(p *pgxpool.Pool) worker.Tarefa` (abre o pacote `mensagens`; a constante de teste `checkoutAbandono` em `mover_test.go` é usada pela Task 10).
  - `type vessel.RD struct { Pool *pgxpool.Pool; Token, URL string; HTTP *http.Client }` com `Rodar(ctx) error` e `Tarefa() worker.Tarefa`.
  - `type fabrica.Purga struct { Pool *pgxpool.Pool; Dir string }` com `Rodar` e `Tarefa`.
  - `config.Config.RDStationToken`, `config.Config.ArquivosDir` (padrão `/var/lib/api/arquivos`), ambos em `Segredos()` quando secretos (o token da RD).

- [ ] **Step 1: Escrever os testes que falham**

Crie `api/internal/worker/manutencao_test.go`:

```go
package worker

import (
	"context"
	"testing"
	"time"

	"github.com/rbv-co/social-dashboard/api/internal/testebanco"
)

func TestConferirRobos(t *testing.T) {
	p := testebanco.Novo(t)
	ctx := context.Background()
	if _, err := p.Exec(ctx, `insert into robos_execucoes (robo, disparado_em, ok, resposta, conferido_em) values
		('pendente-velha', now() - interval '7 hours', null, null, null),
		('pendente-nova', now() - interval '1 hour', null, null, null),
		('conferida-velha', now() - interval '7 hours', true, 'ok', now() - interval '7 hours'),
		('vencida', now() - interval '61 days', true, 'ok', now() - interval '61 days'),
		('quase-vencida', now() - interval '59 days', true, 'ok', now() - interval '59 days')`); err != nil {
		t.Fatal(err)
	}
	if err := ConferirRobos(p).Executar(ctx); err != nil {
		t.Fatal(err)
	}
	estado := func(robo string) (existe bool, resp string, conferida bool) {
		err := p.QueryRow(ctx, `select coalesce(resposta, ''), conferido_em is not null from robos_execucoes where robo = $1`, robo).Scan(&resp, &conferida)
		return err == nil, resp, conferida
	}
	if _, resp, c := estado("pendente-velha"); !c || resp != "a resposta foi apagada pelo pg_net antes da conferencia" {
		t.Fatalf("pendente com mais de 6 h: conferida=%v resp=%q", c, resp)
	}
	if _, _, c := estado("pendente-nova"); c {
		t.Fatal("pendente com menos de 6 h não se mexe")
	}
	if _, resp, _ := estado("conferida-velha"); resp != "ok" {
		t.Fatalf("linha já conferida nunca é reescrita: %q", resp)
	}
	if existe, _, _ := estado("vencida"); existe {
		t.Fatal("mais de 60 dias é apagada")
	}
	if existe, _, _ := estado("quase-vencida"); !existe {
		t.Fatal("59 dias fica")
	}
}

func TestFaxinaDaAPI(t *testing.T) {
	p := testebanco.Novo(t)
	ctx := context.Background()
	const u = "dddddddd-0000-0000-0000-000000000001"
	if _, err := p.Exec(ctx, `insert into usuarios (id, email) values ($1::uuid, 'f@x')`, u); err != nil {
		t.Fatal(err)
	}
	if _, err := p.Exec(ctx, `insert into sessoes (token_hash, usuario_id, expira_em) values
		('vencida', $1::uuid, now() - interval '1 minute'), ('valida', $1::uuid, now() + interval '1 hour')`, u); err != nil {
		t.Fatal(err)
	}
	if _, err := p.Exec(ctx, `insert into webhooks_recebidos (origem, evento_id, recebido_em) values
		('pedido', 'velho', now() - interval '31 days'), ('pedido', 'novo', now() - interval '29 days')`); err != nil {
		t.Fatal(err)
	}
	if _, err := p.Exec(ctx, `insert into envios_feitos (chave, feito_em) values
		('velha', now() - interval '46 days'), ('nova', now() - interval '44 days')`); err != nil {
		t.Fatal(err)
	}
	if err := FaxinaDaAPI(p).Executar(ctx); err != nil {
		t.Fatal(err)
	}
	var sessoes, webhooks, envios string
	p.QueryRow(ctx, `select string_agg(token_hash, ',') from sessoes`).Scan(&sessoes)
	p.QueryRow(ctx, `select string_agg(evento_id, ',') from webhooks_recebidos`).Scan(&webhooks)
	p.QueryRow(ctx, `select string_agg(chave, ',') from envios_feitos`).Scan(&envios)
	if sessoes != "valida" || webhooks != "novo" || envios != "nova" {
		t.Fatalf("sessoes=%q webhooks=%q envios=%q", sessoes, webhooks, envios)
	}
}

func TestAgendasDaManutencao(t *testing.T) {
	for _, c := range []struct {
		t            Tarefa
		nome, agenda string
	}{
		{ConferirRobos(nil), "conferir-robos", "2-59/5 * * * *"},
		{FaxinaDaAPI(nil), "faxina-da-api", "41 5 * * *"},
	} {
		if c.t.Nome != c.nome || c.t.Agenda != c.agenda || c.t.Limite <= 0 || c.t.Limite > 5*time.Minute {
			t.Errorf("%+v", c.t)
		}
	}
}
```

Crie `api/internal/mensagens/mover_test.go`:

```go
package mensagens

import (
	"context"
	"testing"

	"github.com/rbv-co/social-dashboard/api/internal/testebanco"
)

// checkoutAbandono: a tabela de produção (migrations 2026-09-29/30) e a função do banco como está em
// pg_proc (levantamento 02-funções.csv): o teste prova a CHAMADA (nome e argumento), não reescreve a regra.
const checkoutAbandono = `
create table checkout_abandono (
  token text primary key, email text, telefone text, nome text, total numeric, moeda text,
  url_de_recuperacao text,
  status text not null default 'aguardando' check (status in ('aguardando', 'fila_envio', 'pagamento_pendente', 'comprou')),
  iniciado_em timestamptz not null default now(), ultimo_evento_em timestamptz not null default now(),
  fila_envio_em timestamptz, comprou_em timestamptz, comprou_depois boolean not null default false,
  pedido_criado_em timestamptz,
  mensagem_status text, mensagem_reservada_em timestamptz, mensagem_enviada_em timestamptz,
  mensagem_motivo text, mensagem_tentativas int not null default 0, chatwoot_conversation_id bigint);
create function mover_abandonados_para_fila(p_minutos integer default 10, p_pix_minutos integer default 35)
returns integer language plpgsql as $$
declare movidos int; reabertos int;
begin
  update checkout_abandono set status = 'fila_envio', fila_envio_em = now()
   where status = 'aguardando' and ultimo_evento_em < now() - make_interval(mins => p_minutos);
  get diagnostics movidos = row_count;
  update checkout_abandono
     set status = case when comprou_depois then 'fila_envio' else 'aguardando' end,
         ultimo_evento_em = now(), pedido_criado_em = null
   where status = 'pagamento_pendente' and pedido_criado_em < now() - make_interval(mins => p_pix_minutos);
  get diagnostics reabertos = row_count;
  return movidos + reabertos;
end $$;`

func TestMoverAbandonados(t *testing.T) {
	p := testebanco.Novo(t)
	ctx := context.Background()
	if _, err := p.Exec(ctx, checkoutAbandono); err != nil {
		t.Fatal(err)
	}
	if _, err := p.Exec(ctx, `insert into checkout_abandono (token, status, ultimo_evento_em, pedido_criado_em) values
		('parado-11min', 'aguardando', now() - interval '11 minutes', null),
		('parado-9min', 'aguardando', now() - interval '9 minutes', null),
		('pix-vencido', 'pagamento_pendente', now(), now() - interval '36 minutes')`); err != nil {
		t.Fatal(err)
	}
	tf := MoverAbandonados(p)
	if tf.Nome != "abandono-de-checkout" || tf.Agenda != "* * * * *" {
		t.Fatalf("%+v", tf)
	}
	if err := tf.Executar(ctx); err != nil {
		t.Fatal(err)
	}
	for token, quer := range map[string]string{"parado-11min": "fila_envio", "parado-9min": "aguardando", "pix-vencido": "aguardando"} {
		var st string
		p.QueryRow(ctx, `select status from checkout_abandono where token = $1`, token).Scan(&st)
		if st != quer {
			t.Errorf("%s: status %q, esperava %q", token, st, quer)
		}
	}
}

func TestMoverAbandonadosSemAFuncaoEErro(t *testing.T) {
	p := testebanco.Novo(t)
	if err := MoverAbandonados(p).Executar(context.Background()); err == nil {
		t.Fatal("sem a função no banco a tarefa tem de falhar (visível em robos_execucoes)")
	}
}
```

Crie `api/internal/vessel/rd_test.go`:

```go
package vessel

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/testebanco"
)

const tokenRD = "token-publico-da-rd-123"

// Tabelas como em produção (migrations 2026-09-16 e 2026-09-28*); vessel_rd_payload é um esboço com a
// MESMA assinatura (a de verdade continua no banco restaurado).
const tabelasRD = `
create table vessel_pessoas (id bigserial primary key, nome text not null, telefone text not null, email text);
create table vessel_rd_envios (
  id bigint generated always as identity primary key, origem_id bigint not null unique, pessoa_id bigint not null,
  codigo text, status text not null default 'pendente' check (status in ('pendente', 'enviado', 'ok', 'falhou', 'sem_email')),
  tentativas int not null default 0, request_id bigint, http_status int, resposta text,
  criado_em timestamptz not null default now(), atualizado_em timestamptz not null default now());
create function vessel_rd_payload(p_origem_id bigint) returns jsonb language sql stable as $$
  select case when p_origem_id = 404 then null
    else jsonb_build_object('event_type', 'CONVERSION', 'payload', jsonb_build_object('conversion_identifier', 'beauty-session-' || p_origem_id)) end $$;
insert into vessel_pessoas (id, nome, telefone, email) values (1, 'Ana', '5511999990001', 'ana@x'), (2, 'Bia', '5511999990002', '  ');`

type rdFalsa struct {
	mu     sync.Mutex
	corpos []string
	querys []string
	status int
	atraso time.Duration // responde depois disso (lentidão)
}

// responder troca a resposta da RD (sob a trava: o servidor lê em outra goroutine).
func (f *rdFalsa) responder(status int, atraso time.Duration) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.status, f.atraso = status, atraso
}

func envios(f *rdFalsa) int { c, _ := f.lista(); return len(c) }

// lista: cópia dos corpos e das querys recebidos (sob a trava: o servidor anota em outra goroutine).
func (f *rdFalsa) lista() (corpos, querys []string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return slices.Clone(f.corpos), slices.Clone(f.querys)
}

func ambienteRD(t *testing.T, status int) (*RD, *rdFalsa, *pgxpool.Pool) {
	t.Helper()
	p := testebanco.Novo(t)
	if _, err := p.Exec(context.Background(), tabelasRD); err != nil {
		t.Fatal(err)
	}
	f := &rdFalsa{status: status}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		f.mu.Lock()
		f.corpos = append(f.corpos, string(b))
		f.querys = append(f.querys, r.URL.RawQuery)
		st, atraso := f.status, f.atraso
		f.mu.Unlock()
		time.Sleep(atraso)
		if r.Header.Get("Content-Type") != "application/json" {
			st = 415
		}
		w.WriteHeader(st)
		io.WriteString(w, `{"event_uuid":"x"}`)
	}))
	t.Cleanup(srv.Close)
	return &RD{Pool: p, Token: tokenRD, URL: srv.URL}, f, p
}

func estadoRD(t *testing.T, p *pgxpool.Pool, origem int64) (status string, tentativas int, http *int, resp string) {
	t.Helper()
	if err := p.QueryRow(context.Background(), `select status, tentativas, http_status, coalesce(resposta, '') from vessel_rd_envios where origem_id = $1`, origem).
		Scan(&status, &tentativas, &http, &resp); err != nil {
		t.Fatal(err)
	}
	return
}

func TestRDEnviaAFilaEMarcaOk(t *testing.T) {
	rd, f, p := ambienteRD(t, 200)
	ctx := context.Background()
	if _, err := p.Exec(ctx, `insert into vessel_rd_envios (origem_id, pessoa_id, codigo) values (10, 1, 'BS1'), (11, 1, 'BS1')`); err != nil {
		t.Fatal(err)
	}
	if err := rd.Rodar(ctx); err != nil {
		t.Fatal(err)
	}
	corpos, querys := f.lista()
	if len(corpos) != 2 || !strings.Contains(corpos[0], `"beauty-session-10"`) || querys[0] != "api_key="+tokenRD {
		t.Fatalf("envios = %v %v", corpos, querys)
	}
	if st, n, h, resp := estadoRD(t, p, 10); st != "ok" || n != 1 || h == nil || *h != 200 || resp != `{"event_uuid":"x"}` {
		t.Fatalf("st=%s n=%d http=%v resp=%q", st, n, h, resp)
	}
	if err := rd.Rodar(ctx); err != nil || envios(f) != 2 {
		t.Fatalf("o que deu ok nunca é reenviado: err=%v envios=%d", err, envios(f))
	}
}

func TestRDSemEmailEsperaEVoltaQuandoGanhaEmail(t *testing.T) {
	rd, f, p := ambienteRD(t, 200)
	ctx := context.Background()
	p.Exec(ctx, `insert into vessel_rd_envios (origem_id, pessoa_id) values (20, 2)`)
	rd.Rodar(ctx)
	if st, n, _, _ := estadoRD(t, p, 20); st != "sem_email" || n != 0 || envios(f) != 0 {
		t.Fatalf("sem e-mail não gasta tentativa: st=%s n=%d envios=%d", st, n, envios(f))
	}
	p.Exec(ctx, `update vessel_pessoas set email = 'bia@x' where id = 2`)
	rd.Rodar(ctx)
	if st, n, _, _ := estadoRD(t, p, 20); st != "ok" || n != 1 {
		t.Fatalf("ganhou e-mail, volta e vai: st=%s n=%d", st, n)
	}
}

func TestRDFalhaTentaAteCincoVezesEAparece(t *testing.T) {
	rd, f, p := ambienteRD(t, 400)
	ctx := context.Background()
	p.Exec(ctx, `insert into vessel_rd_envios (origem_id, pessoa_id) values (30, 1)`)
	for i := range 6 {
		err := rd.Rodar(ctx)
		if i < 5 && (err == nil || !strings.Contains(err.Error(), "1 de 1")) {
			t.Fatalf("rodada %d: falha tem de virar erro da tarefa: %v", i, err)
		}
		if i == 5 && err != nil {
			t.Fatalf("depois de 5 tentativas a linha sai da fila: %v", err)
		}
	}
	if st, n, h, _ := estadoRD(t, p, 30); st != "falhou" || n != 5 || *h != 400 || envios(f) != 5 {
		t.Fatalf("st=%s n=%d http=%v envios=%d", st, n, h, envios(f))
	}
}

func TestRDEnviadoParadoHaDezMinutosVoltaAFila(t *testing.T) {
	rd, f, p := ambienteRD(t, 200)
	ctx := context.Background()
	p.Exec(ctx, `insert into vessel_rd_envios (origem_id, pessoa_id, status, tentativas, atualizado_em) values
		(40, 1, 'enviado', 1, now() - interval '11 minutes'), (41, 1, 'enviado', 1, now() - interval '2 minutes')`)
	rd.Rodar(ctx)
	if st, n, _, _ := estadoRD(t, p, 40); st != "ok" || n != 2 {
		t.Fatalf("parado há 11 min é reenviado: st=%s n=%d", st, n)
	}
	if st, _, _, _ := estadoRD(t, p, 41); st != "enviado" || envios(f) != 1 {
		t.Fatalf("enviado há 2 min fica quieto: st=%s envios=%d", st, envios(f))
	}
}

func TestRDSemTokenNaoChamaARDMasArrumaAFila(t *testing.T) {
	rd, f, p := ambienteRD(t, 200)
	rd.Token = ""
	ctx := context.Background()
	p.Exec(ctx, `insert into vessel_rd_envios (origem_id, pessoa_id) values (50, 2)`)
	if err := rd.Rodar(ctx); err == nil || !strings.Contains(err.Error(), "rd_sem_token") {
		t.Fatalf("sem token é erro visível: %v", err)
	}
	if st, _, _, _ := estadoRD(t, p, 50); st != "sem_email" || envios(f) != 0 {
		t.Fatalf("st=%s envios=%d", st, envios(f))
	}
}

func TestRDRedeForaNaoGuardaOToken(t *testing.T) {
	rd, _, p := ambienteRD(t, 200)
	rd.URL = "http://127.0.0.1:1/conversions" // ninguém escuta
	rd.HTTP = &http.Client{Timeout: time.Second}
	ctx := context.Background()
	p.Exec(ctx, `insert into vessel_rd_envios (origem_id, pessoa_id) values (60, 1), (404, 1)`)
	err := rd.Rodar(ctx)
	if err == nil || strings.Contains(err.Error(), tokenRD) {
		t.Fatalf("err=%v", err)
	}
	st, _, h, resp := estadoRD(t, p, 60)
	if st != "falhou" || h != nil || resp == "" || strings.Contains(resp, tokenRD) || strings.Contains(resp, "api_key") {
		t.Fatalf("st=%s http=%v resp=%q", st, h, resp)
	}
	if st, _, _, resp := estadoRD(t, p, 404); st != "falhou" || !strings.Contains(resp, "sem payload") {
		t.Fatalf("origem sumida: st=%s resp=%q", st, resp)
	}
}

// 429 e lentidão além do prazo: falha visível, a linha volta à fila (até 5 tentativas) e o token
// nunca é guardado; quando a RD volta, a mesma linha vai.
func TestRD429ELentaVoltamAFilaSemToken(t *testing.T) {
	rd, f, p := ambienteRD(t, 429)
	rd.HTTP = &http.Client{Timeout: 100 * time.Millisecond}
	ctx := context.Background()
	p.Exec(ctx, `insert into vessel_rd_envios (origem_id, pessoa_id) values (70, 1)`)
	if err := rd.Rodar(ctx); err == nil {
		t.Fatal("429 é falha visível")
	}
	if st, n, h, _ := estadoRD(t, p, 70); st != "falhou" || n != 1 || h == nil || *h != 429 {
		t.Fatalf("429: st=%s n=%d http=%v", st, n, h)
	}
	f.responder(200, 300*time.Millisecond)
	err := rd.Rodar(ctx)
	st, n, h, resp := estadoRD(t, p, 70)
	if err == nil || st != "falhou" || n != 2 || h != nil || strings.Contains(resp, tokenRD) || strings.Contains(err.Error(), tokenRD) {
		t.Fatalf("lenta: err=%v st=%s n=%d http=%v resp=%q", err, st, n, h, resp)
	}
	f.responder(200, 0)
	if err := rd.Rodar(ctx); err != nil {
		t.Fatal(err)
	}
	if st, n, _, _ := estadoRD(t, p, 70); st != "ok" || n != 3 || envios(f) != 3 {
		t.Fatalf("voltou: st=%s n=%d envios=%d", st, n, envios(f))
	}
}
```

Crie `api/internal/fabrica/purga_test.go`:

```go
package fabrica

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/testebanco"
)

// Colunas de produção usadas (migrations 015_fabrica_criativos.sql e 017_fabrica_jobs_lifecycle.sql).
const tabelasFabrica = `
create table fabrica_campanhas (id uuid primary key, nome text not null default 'x', created_at timestamptz not null default now(),
  fechada_em timestamptz, purgado_em timestamptz);
create table fabrica_criativos (id uuid primary key default gen_random_uuid(), campanha_id uuid references fabrica_campanhas(id) on delete cascade,
  storage_path text, purgado_em timestamptz);
insert into fabrica_campanhas (id, created_at, fechada_em, purgado_em) values
  ('00000000-0000-0000-0000-00000000000a', now() - interval '2 days', now() - interval '1 day', null),   -- fechada
  ('00000000-0000-0000-0000-00000000000b', now() - interval '2 days', null, null),                       -- aberta e nova
  ('00000000-0000-0000-0000-00000000000c', now() - interval '31 days', null, null),                      -- abandonada
  ('00000000-0000-0000-0000-00000000000d', now() - interval '40 days', now() - interval '39 days', now()); -- já purgada
insert into fabrica_criativos (campanha_id, storage_path) values
  ('00000000-0000-0000-0000-00000000000a', 'a/1.png'), ('00000000-0000-0000-0000-00000000000a', 'a/sumiu.png'),
  ('00000000-0000-0000-0000-00000000000a', null), ('00000000-0000-0000-0000-00000000000a', ''),
  ('00000000-0000-0000-0000-00000000000b', 'b/1.png'), ('00000000-0000-0000-0000-00000000000c', 'c/1.png'),
  ('00000000-0000-0000-0000-00000000000d', 'd/1.png');`

func ambientePurga(t *testing.T) (*Purga, *pgxpool.Pool, string) {
	t.Helper()
	p := testebanco.Novo(t)
	if _, err := p.Exec(context.Background(), tabelasFabrica); err != nil {
		t.Fatal(err)
	}
	dir := t.TempDir()
	for _, f := range []string{"a/1.png", "b/1.png", "c/1.png", "d/1.png"} {
		caminho := filepath.Join(dir, "fabrica-criativos", f)
		os.MkdirAll(filepath.Dir(caminho), 0o755)
		os.WriteFile(caminho, []byte("x"), 0o644)
	}
	return &Purga{Pool: p, Dir: dir}, p, dir
}

func existe(dir, f string) bool {
	_, err := os.Stat(filepath.Join(dir, "fabrica-criativos", f))
	return err == nil
}

func TestPurgaApagaFechadasEAbandonadas(t *testing.T) {
	pu, p, dir := ambientePurga(t)
	if err := pu.Rodar(context.Background()); err != nil {
		t.Fatal(err)
	}
	if existe(dir, "a/1.png") || existe(dir, "c/1.png") {
		t.Fatal("fechada e abandonada há 30+ dias perdem os arquivos")
	}
	if !existe(dir, "b/1.png") || !existe(dir, "d/1.png") {
		t.Fatal("aberta e nova fica; já purgada não é tocada")
	}
	var marcadas, criativos int
	p.QueryRow(context.Background(), `select count(*) from fabrica_campanhas where purgado_em is not null`).Scan(&marcadas)
	p.QueryRow(context.Background(), `select count(*) from fabrica_criativos where purgado_em is not null`).Scan(&criativos)
	if marcadas != 3 || criativos != 5 {
		t.Fatalf("rodadas marcadas=%d (esperava a, c, d) criativos marcados=%d (4 de a + 1 de c)", marcadas, criativos)
	}
}

func TestPurgaRecusaCaminhoForaDaPasta(t *testing.T) {
	pu, p, dir := ambientePurga(t)
	fora := filepath.Join(dir, "fora.txt")
	os.WriteFile(fora, []byte("não apague"), 0o644)
	p.Exec(context.Background(), `insert into fabrica_criativos (campanha_id, storage_path) values ('00000000-0000-0000-0000-00000000000a', '../fora.txt')`)
	err := pu.Rodar(context.Background())
	if err == nil || !strings.Contains(err.Error(), "caminho recusado") {
		t.Fatalf("err=%v", err)
	}
	if _, err := os.Stat(fora); err != nil {
		t.Fatal("arquivo fora da pasta do bucket foi apagado")
	}
	var marcada bool
	p.QueryRow(context.Background(), `select purgado_em is not null from fabrica_campanhas where id = '00000000-0000-0000-0000-00000000000a'`).Scan(&marcada)
	if marcada {
		t.Fatal("rodada com caminho recusado não pode ficar marcada como purgada")
	}
}

func TestPurgaSemDiretorioEErro(t *testing.T) {
	pu, _, _ := ambientePurga(t)
	pu.Dir = ""
	if err := pu.Rodar(context.Background()); err == nil {
		t.Fatal("ARQUIVOS_DIR vazio tem de falhar")
	}
	if tf := pu.Tarefa(); tf.Nome != "fabrica-purga" || tf.Agenda != "17 4 * * *" {
		t.Fatalf("%+v", tf)
	}
}
```

Acrescente ao fim de `api/internal/config/config_test.go`:

```go
func TestCarregarRDEArquivos(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://x")
	t.Setenv("RD_STATION_TOKEN", " token-publico-rd ")
	c, _ := Carregar()
	if c.RDStationToken != "token-publico-rd" || c.ArquivosDir != "/var/lib/api/arquivos" || !slices.Contains(c.Segredos(), "token-publico-rd") {
		t.Fatalf("%+v", c)
	}
	t.Setenv("ARQUIVOS_DIR", "/dados/arquivos")
	if c, _ := Carregar(); c.ArquivosDir != "/dados/arquivos" {
		t.Fatalf("ArquivosDir = %q", c.ArquivosDir)
	}
}
```

Em `api/cmd/api/worker_test.go`, troque:

```go

}

func TestTarefasDeProducao
```

por:

```go

	// Task 2
	"conferir-robos":       "2-59/5 * * * *",
	"faxina-da-api":        "41 5 * * *",
	"abandono-de-checkout": "* * * * *",
	"vessel-rd-station":    "* * * * *",
	"fabrica-purga":        "17 4 * * *",
}

func TestTarefasDeProducao
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `go test -count=1 ./cmd/api ./internal/config ./internal/fabrica ./internal/mensagens ./internal/vessel ./internal/worker`
Expected: FAIL. Primeiras falhas, como saíram no ensaio deste plano: `--- FAIL: TestTarefasDeProducao`, `has no field or method RDStationToken`, `has no field or method ArquivosDir`, `undefined: MoverAbandonados`, `undefined: RD`, `undefined: Purga`

- [ ] **Step 3: Implementar**

Crie `api/internal/worker/manutencao.go`:

```go
package worker

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// ConferirRobos porta public.conferir_robos (pg_cron 2-59/5). A função copiava a resposta do pg_net
// para robos_execucoes; o worker já grava cada execução conferida (conferido_em = now()), então sobra
// o resto dela: fechar linha antiga sem conferência (as do Supabase até o corte) com o MESMO texto de
// produção (sem acento, como está em pg_proc) e apagar o que passou de 60 dias.
func ConferirRobos(p *pgxpool.Pool) Tarefa {
	return Tarefa{Nome: "conferir-robos", Agenda: "2-59/5 * * * *", Limite: time.Minute, Executar: func(ctx context.Context) error {
		if _, err := p.Exec(ctx, `update robos_execucoes
			   set conferido_em = now(), resposta = 'a resposta foi apagada pelo pg_net antes da conferencia'
			 where conferido_em is null and disparado_em < now() - interval '6 hours'`); err != nil {
			return err
		}
		_, err := p.Exec(ctx, `delete from robos_execucoes where disparado_em < now() - interval '60 days'`)
		return err
	}}
}

// FaxinaDaAPI (tarefa nova, faxina-da-api) apaga o que as tabelas da própria API acumulam:
// sessões vencidas (NOTAS-DA-IMPLANTACAO, Plano 1), marcas de webhook com mais de 30 dias (reentrega
// do core vai até ~5 h; pendência do Plano 3) e o livro de envios com mais de 45 dias (as chaves
// levam o dia: nada repete depois disso).
func FaxinaDaAPI(p *pgxpool.Pool) Tarefa {
	return Tarefa{Nome: "faxina-da-api", Agenda: "41 5 * * *", Limite: 2 * time.Minute, Executar: func(ctx context.Context) error {
		for _, sql := range []string{
			`delete from sessoes where expira_em < now()`,
			`delete from webhooks_recebidos where recebido_em < now() - interval '30 days'`,
			`delete from envios_feitos where feito_em < now() - interval '45 days'`,
		} {
			if _, err := p.Exec(ctx, sql); err != nil {
				return err
			}
		}
		return nil
	}}
}
```

Crie `api/internal/mensagens/mover.go`:

```go
// Package mensagens: os robôs de mensagem (WhatsApp pelo Chatwoot) do abandono de checkout.
package mensagens

import (
	"context"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/worker"
)

// MoverAbandonados porta o job abandono-de-checkout (pg_cron 1/min, SQL puro):
// `select public.mover_abandonados_para_fila(10)`. A regra (10 min sem evento -> fila de envio;
// Pix vencido em 35 min reabre) continua na função do banco restaurado.
func MoverAbandonados(p *pgxpool.Pool) worker.Tarefa {
	return worker.Tarefa{Nome: "abandono-de-checkout", Agenda: "* * * * *", Limite: 30 * time.Second,
		Executar: func(ctx context.Context) error {
			var n int
			if err := p.QueryRow(ctx, `select mover_abandonados_para_fila(p_minutos => 10)`).Scan(&n); err != nil {
				return err
			}
			if n > 0 {
				slog.Info("abandono-de-checkout", "movidos", n)
			}
			return nil
		}}
}
```

Crie `api/internal/vessel/rd.go`:

```go
// Package vessel: as tarefas da Vessel que o worker roda.
package vessel

import (
	"bytes"
	"cmp"
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"slices"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/worker"
)

const urlRD = "https://api.rd.services/platform/conversions"

// RD porta public.vessel_rd_enviar (job vessel-rd-station, pg_cron 1/min): manda à RD Station
// Marketing a fila vessel_rd_envios (cadastros de Beauty Session) como conversão. O gatilho
// vessel_rd_na_fila e a função vessel_rd_payload continuam no banco; só o HTTP sai do pg_net.
type RD struct {
	Pool  *pgxpool.Pool
	Token string       // RD_STATION_TOKEN (era segredos_de_cron 'rd-station-token-publico'): vai na query
	URL   string       // vazio = a da RD (o teste troca)
	HTTP  *http.Client // nil = prazo de 30 s por envio (o timeout_milliseconds do pg_net)
}

func (rd *RD) Tarefa() worker.Tarefa {
	return worker.Tarefa{Nome: "vessel-rd-station", Agenda: "* * * * *", Limite: 4 * time.Minute, Executar: rd.Rodar}
}

type envioRD struct{ id, origem int64 }

func (rd *RD) Rodar(ctx context.Context) error {
	// 1) Enviado há mais de 10 min sem resposta (inclui o que estava no pg_net na hora do corte).
	if _, err := rd.Pool.Exec(ctx, `update vessel_rd_envios
		   set status = 'falhou', resposta = 'sem resposta em 10 min', atualizado_em = now()
		 where status = 'enviado' and atualizado_em < now() - interval '10 minutes'`); err != nil {
		return err
	}
	// 2) Sem e-mail espera (a conta da RD recusa contato só com telefone); ganhou e-mail, volta à fila.
	if _, err := rd.Pool.Exec(ctx, `update vessel_rd_envios e
		   set status = case when nullif(trim(p.email), '') is null then 'sem_email' else 'pendente' end,
		       atualizado_em = now()
		  from vessel_pessoas p
		 where p.id = e.pessoa_id
		   and ((e.status = 'pendente' and nullif(trim(p.email), '') is null)
		     or (e.status = 'sem_email' and nullif(trim(p.email), '') is not null))`); err != nil {
		return err
	}
	if rd.Token == "" {
		return errors.New("rd_sem_token: RD_STATION_TOKEN vazio (para desligar a tarefa, WORKER_TAREFAS_DESLIGADAS=vessel-rd-station)")
	}
	// 3) Reserva até 50 (pendentes e falhas com menos de 5 tentativas) num comando só: quem reservou
	//    marca 'enviado' e conta a tentativa ANTES do HTTP (caiu no meio = volta em 10 min, passo 1).
	linhas, err := rd.Pool.Query(ctx, `with alvo as (
		  select id from vessel_rd_envios
		   where status = 'pendente' or (status = 'falhou' and tentativas < 5)
		   order by id limit 50 for update skip locked)
		update vessel_rd_envios e set status = 'enviado', tentativas = e.tentativas + 1, atualizado_em = now()
		  from alvo where e.id = alvo.id
		returning e.id, e.origem_id`)
	if err != nil {
		return err
	}
	alvos, err := pgx.CollectRows(linhas, func(r pgx.CollectableRow) (a envioRD, err error) {
		return a, r.Scan(&a.id, &a.origem)
	})
	if err != nil {
		return err
	}
	slices.SortFunc(alvos, func(a, b envioRD) int { return cmp.Compare(a.id, b.id) })
	falhas := 0
	for _, a := range alvos {
		status, codigo, resposta := rd.enviar(ctx, a.origem)
		if status != "ok" {
			falhas++
		}
		c, cancela := context.WithTimeout(context.WithoutCancel(ctx), 10*time.Second)
		_, err := rd.Pool.Exec(c, `update vessel_rd_envios set status = $2::text, http_status = $3::int,
			resposta = left($4::text, 500), atualizado_em = now() where id = $1::bigint`, a.id, status, codigo, resposta)
		cancela()
		if err != nil {
			return err
		}
	}
	if len(alvos) > 0 {
		slog.Info("vessel-rd-station", "enviados", len(alvos), "falhas", falhas)
	}
	if falhas > 0 {
		return fmt.Errorf("rd: %d de %d envios falharam (tentam de novo no próximo minuto, até 5 vezes)", falhas, len(alvos))
	}
	return nil
}

// enviar faz UM POST. Devolve status ('ok'|'falhou'), o código HTTP (nil sem resposta) e o texto
// para vessel_rd_envios.resposta. O token vai na query da URL: o erro do http.Client traz a URL
// inteira, então só a causa (sem URL) é guardada.
func (rd *RD) enviar(ctx context.Context, origem int64) (string, *int, string) {
	var payload *string
	if err := rd.Pool.QueryRow(ctx, `select vessel_rd_payload($1::bigint)::text`, origem).Scan(&payload); err != nil {
		return "falhou", nil, "payload: " + err.Error()
	}
	if payload == nil {
		return "falhou", nil, "sem payload: a origem não existe mais"
	}
	base := rd.URL
	if base == "" {
		base = urlRD
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, base+"?api_key="+url.QueryEscape(rd.Token), bytes.NewReader([]byte(*payload)))
	if err != nil {
		return "falhou", nil, "pedido inválido"
	}
	req.Header.Set("Content-Type", "application/json")
	cli := rd.HTTP
	if cli == nil {
		cli = &http.Client{Timeout: 30 * time.Second}
	}
	r, err := cli.Do(req)
	if err != nil {
		var ue *url.Error
		if errors.As(err, &ue) {
			err = ue.Err
		}
		return "falhou", nil, err.Error()
	}
	defer r.Body.Close()
	corpo, _ := io.ReadAll(io.LimitReader(r.Body, 64<<10))
	codigo := r.StatusCode
	if codigo >= 200 && codigo <= 299 {
		return "ok", &codigo, string(corpo)
	}
	return "falhou", &codigo, string(corpo)
}
```

Crie `api/internal/fabrica/purga.go`:

```go
// Package fabrica: as tarefas da Fábrica de Anúncios que o worker roda.
package fabrica

import (
	"context"
	"errors"
	"fmt"
	"io/fs"
	"log/slog"
	"os"
	"path/filepath"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/worker"
)

// Purga porta supabase/functions/fabrica-purga (job fabrica-purga-diaria, robô 'fabrica-purga'):
// apaga os criativos das rodadas fechadas (ou nunca fechadas e com mais de 30 dias) e marca
// purgado_em. Os arquivos moram em <Dir>/fabrica-criativos/<storage_path> (spec §7: o mesmo caminho
// do objeto no bucket). Qualquer erro aborta a rodada, como o `throw` da edge.
type Purga struct {
	Pool *pgxpool.Pool
	Dir  string // ARQUIVOS_DIR
}

func (pu *Purga) Tarefa() worker.Tarefa {
	return worker.Tarefa{Nome: "fabrica-purga", Agenda: "17 4 * * *", Limite: 5 * time.Minute, Executar: pu.Rodar}
}

func (pu *Purga) Rodar(ctx context.Context) error {
	if pu.Dir == "" {
		return errors.New("ARQUIVOS_DIR vazio: não sei onde estão os criativos")
	}
	base := filepath.Join(pu.Dir, "fabrica-criativos")
	linhas, err := pu.Pool.Query(ctx, `select id::text from fabrica_campanhas
		where purgado_em is null and (fechada_em is not null or created_at < now() - interval '30 days')`)
	if err != nil {
		return err
	}
	rodadas, err := pgx.CollectRows(linhas, pgx.RowTo[string])
	if err != nil {
		return err
	}
	objetos := 0
	for _, id := range rodadas {
		linhas, err := pu.Pool.Query(ctx, `select storage_path from fabrica_criativos
			where campanha_id = $1::uuid and purgado_em is null and coalesce(storage_path, '') <> ''`, id)
		if err != nil {
			return err
		}
		caminhos, err := pgx.CollectRows(linhas, pgx.RowTo[string])
		if err != nil {
			return err
		}
		for _, c := range caminhos {
			// O caminho vem do banco: nunca sai da pasta do bucket (nada de "..", absoluto ou vazio).
			if !filepath.IsLocal(c) {
				return fmt.Errorf("rodada %s: caminho recusado %q", id, c)
			}
			if err := os.Remove(filepath.Join(base, c)); err != nil && !errors.Is(err, fs.ErrNotExist) {
				return fmt.Errorf("rodada %s: %w", id, err)
			}
		}
		objetos += len(caminhos)
		err = pgx.BeginFunc(ctx, pu.Pool, func(tx pgx.Tx) error {
			if _, err := tx.Exec(ctx, `update fabrica_criativos set purgado_em = now() where campanha_id = $1::uuid and purgado_em is null`, id); err != nil {
				return err
			}
			_, err := tx.Exec(ctx, `update fabrica_campanhas set purgado_em = now() where id = $1::uuid`, id)
			return err
		})
		if err != nil {
			return err
		}
	}
	slog.Info("fabrica-purga", "rodadas_purgadas", len(rodadas), "objetos_apagados", objetos)
	return nil
}
```

Em `api/internal/config/config.go`, troque:

```go
	// Plano 4 (worker).
	WorkerAddr string // WORKER_ADDR: endereço do GET /saude e /metricas do worker; vazio = sem HTTP
}
```

por:

```go
	// Plano 4 (worker).
	WorkerAddr     string // WORKER_ADDR: endereço do GET /saude e /metricas do worker; vazio = sem HTTP
	RDStationToken string // RD_STATION_TOKEN: token público da RD Station (vessel-rd-station)
	ArquivosDir    string // ARQUIVOS_DIR: raiz dos buckets no disco (spec §7); padrão /var/lib/api/arquivos
}
```

Em `api/internal/config/config.go`, troque:

```go
		TarefasDesligadas: lista("WORKER_TAREFAS_DESLIGADAS"),
		WorkerAddr:        strings.TrimSpace(os.Getenv("WORKER_ADDR")),
	}
```

por:

```go
		TarefasDesligadas: lista("WORKER_TAREFAS_DESLIGADAS"),
		WorkerAddr:        strings.TrimSpace(os.Getenv("WORKER_ADDR")),
		RDStationToken:    strings.TrimSpace(os.Getenv("RD_STATION_TOKEN")),
		ArquivosDir:       strings.TrimSpace(os.Getenv("ARQUIVOS_DIR")),
	}
```

Em `api/internal/config/config.go`, troque:

```go
	return append([]string{c.CoreToken, c.ChatwootSegredo, c.VAPIDPrivada}, c.ShopifySegredos...)
```

por:

```go
	return append([]string{c.CoreToken, c.ChatwootSegredo, c.VAPIDPrivada, c.RDStationToken}, c.ShopifySegredos...)
```

Em `api/internal/config/config.go`, troque:

```go
	if c.CoreURL == "" {
```

por:

```go
	if c.ArquivosDir == "" {
		c.ArquivosDir = "/var/lib/api/arquivos"
	}
	if c.CoreURL == "" {
```

Em `api/cmd/api/tarefas.go`, troque:

```go
	"github.com/rbv-co/social-dashboard/api/internal/core"
```

por:

```go
	"github.com/rbv-co/social-dashboard/api/internal/core"
	"github.com/rbv-co/social-dashboard/api/internal/fabrica"
```

Em `api/cmd/api/tarefas.go`, troque:

```go
	"github.com/rbv-co/social-dashboard/api/internal/fabrica"
```

por:

```go
	"github.com/rbv-co/social-dashboard/api/internal/fabrica"
	"github.com/rbv-co/social-dashboard/api/internal/mensagens"
	"github.com/rbv-co/social-dashboard/api/internal/vessel"
```

Em `api/cmd/api/tarefas.go`, troque:

```go
	return ts
}
```

por:

```go
	ts = append(ts, worker.ConferirRobos(p), worker.FaxinaDaAPI(p), mensagens.MoverAbandonados(p),
		(&vessel.RD{Pool: p, Token: cfg.RDStationToken}).Tarefa(),
		(&fabrica.Purga{Pool: p, Dir: cfg.ArquivosDir}).Tarefa())
	return ts
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `gofmt -l . && go vet ./... && go test -race -count=1 ./internal/worker/ ./internal/mensagens/ ./internal/vessel/ ./internal/fabrica/ ./internal/config/ ./cmd/api/ -v 2>&1 | grep -E -- '^(ok|FAIL|--- FAIL|--- SKIP)'`
Expected: `gofmt` não lista nada; só linhas `ok`, nenhuma `FAIL` nem `--- SKIP`.

- [ ] **Step 5: Commit**

```bash
git add api/internal/worker/manutencao.go api/internal/worker/manutencao_test.go api/internal/mensagens/mover.go api/internal/mensagens/mover_test.go api/internal/vessel/rd.go api/internal/vessel/rd_test.go api/internal/fabrica/purga.go api/internal/fabrica/purga_test.go api/internal/config/config.go api/internal/config/config_test.go api/cmd/api/tarefas.go api/cmd/api/worker_test.go
git commit -m "feat(api): manutenção e robôs de SQL puro no worker (conferir-robos, faxina, abandono-de-checkout, vessel-rd-station, fabrica-purga)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Graph com ritmo, push compartilhado, formatação do JS e `enviar-push-saldo-08h`

**Revisor:** **opus** (push a pessoas; chamadas à Meta dentro do limite do core).

A base que as tasks 4 a 8 usam, mais a primeira tarefa de push nova:

- `core.Cliente.RitmoMeta`: intervalo mínimo entre duas chamadas à Meta do mesmo cliente (o core limita 120/min por consumidor). O worker usa 600 ms; a API (rotas ao vivo) continua sem ritmo.
- `texto`: moeda e milhar como o `Intl.NumberFormat('pt-BR')` do JS (arredondamento "halfExpand" sobre a menor representação decimal; `R$` + espaço não separável no estilo moeda), corte em unidades UTF-16 (o `.slice` do JS) e a classe `\s` do JS. Vetores gerados no Node 22.
- `webpush.Destinatarios` (quem recebe cada tipo: `push_preferencias` com o padrão do tipo — só `vendas` nasce ligado) e `webpush.Entregar` (envia a cada aparelho com a chave `<prefixo>:<sha256(endpoint)[:8]>` no livro: rodar de novo não reenvia; 404/410 poda a inscrição; qualquer não-2xx libera a reserva).
- `pushteste`: serviço de push de mentira (TLS, respostas por sufixo do caminho) e inscrições para os testes de outros pacotes.
- `meta.GET` e `meta.Paginas`: a Graph pelo core, com o erro da Graph ou do core virando `Meta API <caminho>: <mensagem>` e o `paging.next` convertido em caminho sem versão e sem token.
- `enviar-push-saldo-08h` (`0 11 * * *`): porta `supabase/functions/enviar-push-saldo/index.ts` + `_shared/saldo-de-conta.js` (saldo lido do texto pt-BR do `display_string`, pré-paga pelo `funding_source_details.type == 20`, ritmo pelos últimos 7 dias). Confere a VAPID antes de qualquer chamada; conta que falha vira erro da tarefa, mas as outras avisam.

**Files:**
- Modify: `api/internal/core/core.go`
- Test (modify): `api/internal/core/core_test.go`
- Create: `api/internal/texto/texto.go`
- Test: `api/internal/texto/texto_test.go`
- Create: `api/internal/webpush/destinatarios.go`
- Test: `api/internal/webpush/destinatarios_test.go`
- Test: `api/internal/webpush/pushteste/pushteste.go`
- Create: `api/internal/meta/graph.go`
- Test: `api/internal/meta/graph_test.go`
- Create: `api/internal/meta/saldo.go`
- Create: `api/internal/meta/push_saldo.go`
- Test: `api/internal/meta/push_saldo_test.go`
- Modify: `api/cmd/api/tarefas.go`
- Test (modify): `api/cmd/api/worker_test.go`

**Interfaces:**
- Consumes: `core.Cliente`, `core.PedidoMeta`, `core.Cliente.Meta` (Plano 3); `webpush.Enviar`, `webpush.VAPID`, `webpush.ValidarVAPID`, `webpush.Inscricao` (Plano 3); `banco.ReservarEnvio`/`LiberarEnvio`, `worker.Tarefa` (Task 1); `coreMeta` e `tokenDoCore` de `internal/meta/proxy_test.go` (Plano 3).
- Produces:
  - `core.Cliente.RitmoMeta time.Duration`.
  - `texto.EspacoJS` (classe de regex), `texto.Reais(v float64) string` (`R$` + U+00A0), `texto.ReaisSimples(v float64) string` (`R$ ` com espaço comum), `texto.Milhar(n int64) string`, `texto.CortarUTF16(s string, n int) string`.
  - `type webpush.Destino struct { webpush.Inscricao; UserID string }`; `webpush.Destinatarios(ctx, p, tipo, usuario string) ([]Destino, error)` (`usuario` vazio = todos); `type webpush.Resultado struct { Enviados, Podados, Repetidos, Falhas int }`; `webpush.Entregar(ctx, p, cli *http.Client, alvos []Destino, payload []byte, v VAPID, prefixo string) (Resultado, error)`.
  - `pushteste.Tabelas` (DDL de `push_subs`/`push_preferencias`), `pushteste.Novo(t) *Servico` (`HTTP`, `Recebidos(caminho)`, `Total()`, `Ultimo(t, caminho)`), `pushteste.VAPID(t)`, `pushteste.Inscrever(t, p, caminho, userID string) *ecdh.PrivateKey`, `pushteste.Decifrar(t, corpo, ua)`.
  - `meta.GET(ctx, c *core.Cliente, caminho string, params map[string]any) (map[string]any, error)`; `meta.Paginas(ctx, c, caminho string, params map[string]any, max int, tolerante bool) ([]any, error)`; nos testes do pacote `meta`: `coreDeTeste(t, resp) (*core.Cliente, *coreMeta)` e `(*coreMeta).lista()`.
  - `type meta.PushSaldo struct { Pool; Core *core.Cliente; VAPID webpush.VAPID; HTTP *http.Client; Agora func() time.Time }` com `Rodar` e `Tarefa`.

- [ ] **Step 1: Escrever os testes que falham**

Acrescente ao fim de `api/internal/core/core_test.go`:

```go
func TestMetaAndaNoRitmo(t *testing.T) {
	c, f, esperas := novoCore(t, status(200, `{"data":[]}`))
	c.RitmoMeta = 100 * time.Millisecond
	for range 3 {
		if _, err := c.Meta(context.Background(), PedidoMeta{Caminho: "/1784", Metodo: "GET"}, 1); err != nil {
			t.Fatal(err)
		}
	}
	// O Dormir do teste não dorme: a fila anda 100 ms por chamada (1ª sem espera, 2ª ~100 ms, 3ª ~200 ms).
	if f.n() != 3 || len(*esperas) != 2 || (*esperas)[0] < 80*time.Millisecond || (*esperas)[1] < 180*time.Millisecond {
		t.Fatalf("chamadas=%d esperas=%v", f.n(), *esperas)
	}
	c2, _, esperas2 := novoCore(t, status(200, `{}`))
	c2.Meta(context.Background(), PedidoMeta{Caminho: "/1"}, 1)
	c2.Meta(context.Background(), PedidoMeta{Caminho: "/1"}, 1)
	if len(*esperas2) != 0 {
		t.Fatalf("sem RitmoMeta não espera: %v", *esperas2)
	}
}
```

Crie `api/internal/texto/texto_test.go`:

```go
package texto

import (
	"regexp"
	"testing"
)

// Os valores esperados saíram do Node 22 (o mesmo Intl das edges), não de cabeça.
func TestReaisComoOIntlDoJS(t *testing.T) {
	casos := []struct {
		v              float64
		reais, simples string
	}{
		{0, "R$\U000000a00,00", "R$ 0,00"},
		{3, "R$\U000000a03,00", "R$ 3,00"},
		{1234.56, "R$\U000000a01.234,56", "R$ 1.234,56"},
		{0.005, "R$\U000000a00,01", "R$ 0,01"},
		{0.015, "R$\U000000a00,02", "R$ 0,02"},
		{2.675, "R$\U000000a02,68", "R$ 2,68"},
		{1e6, "R$\U000000a01.000.000,00", "R$ 1.000.000,00"},
		{12.3456, "R$\U000000a012,35", "R$ 12,35"},
		{-1, "-R$\U000000a01,00", "R$ -1,00"},
		{0.125, "R$\U000000a00,13", "R$ 0,13"},
		{1.005, "R$\U000000a01,01", "R$ 1,01"},
		{123456789.995, "R$\U000000a0123.456.790,00", "R$ 123.456.790,00"},
		{451.8, "R$\U000000a0451,80", "R$ 451,80"},
		{0.1 + 0.2, "R$\U000000a00,30", "R$ 0,30"},
		{999.995, "R$\U000000a01.000,00", "R$ 1.000,00"},
		{-1234.5, "-R$\U000000a01.234,50", "R$ -1.234,50"},
	}
	for _, c := range casos {
		if got := Reais(c.v); got != c.reais {
			t.Errorf("Reais(%v) = %q, esperava %q", c.v, got, c.reais)
		}
		if got := ReaisSimples(c.v); got != c.simples {
			t.Errorf("ReaisSimples(%v) = %q, esperava %q", c.v, got, c.simples)
		}
	}
}

func TestMilhar(t *testing.T) {
	for n, quer := range map[int64]string{0: "0", 7: "7", 999: "999", 1000: "1.000", 24351: "24.351", 1234567: "1.234.567", -24351: "-24.351"} {
		if got := Milhar(n); got != quer {
			t.Errorf("Milhar(%d) = %q, esperava %q", n, got, quer)
		}
	}
}

func TestCortarUTF16(t *testing.T) {
	if got := CortarUTF16("ação", 3); got != "açã" {
		t.Errorf("acentuado precomposto conta 1: %q", got)
	}
	if got := CortarUTF16("𝐁𝐨𝐥𝐬𝐚 preta", 4); got != "𝐁𝐨" {
		t.Errorf("letra matemática conta 2: %q", got)
	}
	if got := CortarUTF16("𝐁𝐨𝐥", 3); got != "𝐁\U0000fffd" {
		t.Errorf("corte no meio do par: %q", got)
	}
	if got := CortarUTF16("abc", 10); got != "abc" {
		t.Errorf("%q", got)
	}
}

func TestEspacoJS(t *testing.T) {
	re := regexp.MustCompile(`^` + EspacoJS + `+$`)
	if !re.MatchString("\t\n\v\f\r \U000000a0\U00001680\U00002000\U0000200a\U00002028\U00002029\U0000202f\U0000205f\U00003000\U0000feff") {
		t.Fatal("falta espaço do JS na classe")
	}
	if re.MatchString("\U00000085") || re.MatchString("\U0000200b") {
		t.Fatal("U+0085 e U+200B não são \\s no JS")
	}
}
```

Crie `api/internal/webpush/destinatarios_test.go`:

```go
package webpush_test

import (
	"context"
	"net/http"
	"testing"
	"time"

	"github.com/rbv-co/social-dashboard/api/internal/testebanco"
	"github.com/rbv-co/social-dashboard/api/internal/webpush"
	"github.com/rbv-co/social-dashboard/api/internal/webpush/pushteste"
)

const (
	uQuer    = "cccccccc-0000-0000-0000-000000000001"
	uNaoQuer = "cccccccc-0000-0000-0000-000000000002"
	uPadrao  = "cccccccc-0000-0000-0000-000000000003"
)

func TestDestinatariosSeguemAPreferenciaEOPadraoDoTipo(t *testing.T) {
	p := testebanco.Novo(t)
	ctx := context.Background()
	if _, err := p.Exec(ctx, pushteste.Tabelas); err != nil {
		t.Fatal(err)
	}
	pushteste.Inscrever(t, p, "quer", uQuer)
	pushteste.Inscrever(t, p, "nao-quer", uNaoQuer)
	pushteste.Inscrever(t, p, "padrao", uPadrao)
	pushteste.Inscrever(t, p, "sem-dono", "")
	p.Exec(ctx, `insert into push_preferencias (user_id, tipo, ativo) values
		($1::uuid, 'saldo', true), ($2::uuid, 'saldo', false), ($2::uuid, 'vendas', false)`, uQuer, uNaoQuer)
	nomes := func(tipo, usuario string) (out []string) {
		ds, err := webpush.Destinatarios(ctx, p, tipo, usuario)
		if err != nil {
			t.Fatal(err)
		}
		for _, d := range ds {
			out = append(out, d.Endpoint[len("https://example.com/push/"):]+"="+d.UserID[len(d.UserID)-1:])
		}
		return
	}
	if got := nomes("saldo", ""); len(got) != 1 || got[0] != "quer=1" {
		t.Fatalf("saldo nasce desligado; só quem ligou: %v", got)
	}
	if got := nomes("vendas", ""); len(got) != 2 || got[0] != "padrao=3" || got[1] != "quer=1" {
		t.Fatalf("vendas nasce ligado; quem desligou sai e sem dono nunca entra: %v", got)
	}
	if got := nomes("saldo", uNaoQuer); len(got) != 0 {
		t.Fatalf("restrito a um dono que não quer: %v", got)
	}
	if got := nomes("tipo-inventado", ""); len(got) != 0 {
		t.Fatalf("tipo desconhecido não chega a ninguém: %v", got)
	}
}

func TestEntregarNaoRepeteEPodaMortas(t *testing.T) {
	p := testebanco.Novo(t)
	ctx := context.Background()
	if _, err := p.Exec(ctx, pushteste.Tabelas); err != nil {
		t.Fatal(err)
	}
	srv := pushteste.Novo(t)
	v := pushteste.VAPID(t)
	ua := pushteste.Inscrever(t, p, "boa", uQuer)
	pushteste.Inscrever(t, p, "morta", uQuer)
	pushteste.Inscrever(t, p, "e500", uQuer)
	pushteste.Inscrever(t, p, "rede", uQuer)
	pushteste.Inscrever(t, p, "e429", uQuer)
	alvos, _ := webpush.Destinatarios(ctx, p, "vendas", "")
	r, err := webpush.Entregar(ctx, p, srv.HTTP, alvos, []byte(`{"title":"oi"}`), v, "teste:2026-10-10")
	if err != nil {
		t.Fatal(err)
	}
	if r != (webpush.Resultado{Enviados: 1, Podados: 1, Falhas: 3}) {
		t.Fatalf("primeira entrega: %+v", r)
	}
	if string(pushteste.Decifrar(t, srv.Ultimo(t, "boa"), ua)) != `{"title":"oi"}` {
		t.Fatal("o conteúdo não abre do lado do navegador")
	}
	var n int
	p.QueryRow(ctx, `select count(*) from push_subs where endpoint like '%/morta'`).Scan(&n)
	if n != 0 {
		t.Fatal("410 apaga a inscrição")
	}
	// Execução repetida com o MESMO prefixo: quem recebeu não recebe de novo; quem falhou tenta outra vez.
	alvos, _ = webpush.Destinatarios(ctx, p, "vendas", "")
	r, _ = webpush.Entregar(ctx, p, srv.HTTP, alvos, []byte(`{"title":"oi"}`), v, "teste:2026-10-10")
	if r != (webpush.Resultado{Repetidos: 1, Falhas: 3}) || srv.Recebidos("boa") != 1 || srv.Recebidos("e500") != 2 || srv.Recebidos("e429") != 2 {
		t.Fatalf("repetida: %+v boa=%d e500=%d e429=%d", r, srv.Recebidos("boa"), srv.Recebidos("e500"), srv.Recebidos("e429"))
	}
	// Outro prefixo (outro dia) envia de novo.
	r, _ = webpush.Entregar(ctx, p, srv.HTTP, alvos[:1], []byte(`{}`), v, "teste:2026-10-11")
	if r.Enviados != 1 {
		t.Fatalf("outro dia: %+v", r)
	}
}

// Serviço de push lento além do prazo do cliente: conta como falha e libera a reserva (push é
// idempotente no aparelho pela tag), então a execução seguinte entrega.
func TestEntregarLentoFalhaEDepoisEntrega(t *testing.T) {
	p := testebanco.Novo(t)
	ctx := context.Background()
	if _, err := p.Exec(ctx, pushteste.Tabelas); err != nil {
		t.Fatal(err)
	}
	srv := pushteste.Novo(t)
	v := pushteste.VAPID(t)
	pushteste.Inscrever(t, p, "lento", uQuer)
	alvos, _ := webpush.Destinatarios(ctx, p, "vendas", "")
	apressado := &http.Client{Transport: srv.HTTP.Transport, Timeout: 100 * time.Millisecond}
	if r, _ := webpush.Entregar(ctx, p, apressado, alvos, []byte(`{}`), v, "lento:2026-10-10"); r != (webpush.Resultado{Falhas: 1}) {
		t.Fatalf("lento: %+v", r)
	}
	if r, _ := webpush.Entregar(ctx, p, srv.HTTP, alvos, []byte(`{}`), v, "lento:2026-10-10"); r != (webpush.Resultado{Enviados: 1}) {
		t.Fatalf("depois do prazo vencido a reserva foi liberada: %+v", r)
	}
}
```

Crie `api/internal/webpush/pushteste/pushteste.go`:

```go
// Package pushteste: o serviço de Web Push de mentira, as chaves e a decifragem do lado do
// "navegador", para os testes dos pacotes que mandam push (meta, frota, conteudo). Só testes o importam.
package pushteste

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/ecdh"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/hkdf"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/webpush"
)

// Tabelas como em produção (db/migrations/2026-07-24-push-subs.sql e 2026-07-29-push-preferencias.sql,
// sem as FKs para auth.users/profiles).
const Tabelas = `
create table push_subs (id uuid primary key default gen_random_uuid(), endpoint text not null unique,
  p256dh text not null, auth text not null, user_id uuid, created_at timestamptz not null default now());
create table push_preferencias (user_id uuid not null, tipo text not null, ativo boolean not null,
  alterado_em timestamptz not null default now(), alterado_por uuid, primary key (user_id, tipo));`

// Servico é o serviço de push em https://example.com/push/<caminho>. O sufixo do caminho escolhe a
// resposta: /morta 410, /nf 404, /e500 500, /e429 429, /rede derruba a conexão, /lento responde 201
// depois de 300 ms (para o prazo do cliente vencer antes); o resto, 201.
type Servico struct {
	HTTP *http.Client

	mu     sync.Mutex
	corpos map[string][][]byte
}

func Novo(t *testing.T) *Servico {
	t.Helper()
	s := &Servico{corpos: map[string][][]byte{}}
	srv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		s.mu.Lock()
		s.corpos[r.URL.Path] = append(s.corpos[r.URL.Path], b)
		s.mu.Unlock()
		for sufixo, st := range map[string]int{"/morta": 410, "/nf": 404, "/e500": 500, "/e429": 429} {
			if strings.HasSuffix(r.URL.Path, sufixo) {
				w.WriteHeader(st)
				return
			}
		}
		if strings.HasSuffix(r.URL.Path, "/rede") {
			c, _, _ := w.(http.Hijacker).Hijack()
			c.Close()
			return
		}
		if strings.HasSuffix(r.URL.Path, "/lento") {
			time.Sleep(300 * time.Millisecond)
		}
		w.WriteHeader(http.StatusCreated)
	}))
	t.Cleanup(srv.Close)
	s.HTTP = srv.Client()
	s.HTTP.Transport.(*http.Transport).DialContext = func(ctx context.Context, rede, _ string) (net.Conn, error) {
		return (&net.Dialer{}).DialContext(ctx, rede, srv.Listener.Addr().String())
	}
	return s
}

// Recebidos: quantos pushes chegaram em /push/<caminho>.
func (s *Servico) Recebidos(caminho string) int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.corpos["/push/"+caminho])
}

// Total: quantos pushes chegaram, em todos os caminhos.
func (s *Servico) Total() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	n := 0
	for _, c := range s.corpos {
		n += len(c)
	}
	return n
}

// Ultimo: o último corpo (cifrado) que chegou em /push/<caminho>.
func (s *Servico) Ultimo(t *testing.T, caminho string) []byte {
	t.Helper()
	s.mu.Lock()
	defer s.mu.Unlock()
	c := s.corpos["/push/"+caminho]
	if len(c) == 0 {
		t.Fatalf("nada chegou em /push/%s", caminho)
	}
	return c[len(c)-1]
}

// VAPID gera um par de chaves de teste válido.
func VAPID(t *testing.T) webpush.VAPID {
	t.Helper()
	k, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	d, _ := k.Bytes()
	pub, _ := k.PublicKey.Bytes()
	return webpush.VAPID{Publica: base64.RawURLEncoding.EncodeToString(pub), Privada: base64.RawURLEncoding.EncodeToString(d), Assunto: "mailto:teste@exemplo.com"}
}

// Inscrever grava uma inscrição em https://example.com/push/<caminho> (auth = 16 zeros) e devolve a
// chave do "navegador" para Decifrar. userID vazio = inscrição sem dono.
func Inscrever(t *testing.T, p *pgxpool.Pool, caminho, userID string) *ecdh.PrivateKey {
	t.Helper()
	ua, _ := ecdh.P256().GenerateKey(rand.Reader)
	if _, err := p.Exec(context.Background(), `insert into push_subs (endpoint, p256dh, auth, user_id) values ($1, $2, $3, nullif($4::text, '')::uuid)`,
		"https://example.com/push/"+caminho, base64.RawURLEncoding.EncodeToString(ua.PublicKey().Bytes()),
		base64.RawURLEncoding.EncodeToString(make([]byte, 16)), userID); err != nil {
		t.Fatal(err)
	}
	return ua
}

// Decifrar faz o papel do navegador (RFC 8291 §3.4) com a chave de Inscrever (auth = 16 zeros).
func Decifrar(t *testing.T, corpo []byte, ua *ecdh.PrivateKey) []byte {
	t.Helper()
	salt, asPub, ct := corpo[:16], corpo[21:86], corpo[86:]
	pub, err := ecdh.P256().NewPublicKey(asPub)
	if err != nil {
		t.Fatal(err)
	}
	segredo, _ := ua.ECDH(pub)
	info := append(append([]byte("WebPush: info\x00"), ua.PublicKey().Bytes()...), asPub...)
	ikm, _ := hkdf.Key(sha256.New, segredo, make([]byte, 16), string(info), 32)
	cek, _ := hkdf.Key(sha256.New, ikm, salt, "Content-Encoding: aes128gcm\x00", 16)
	nonce, _ := hkdf.Key(sha256.New, ikm, salt, "Content-Encoding: nonce\x00", 12)
	bloco, _ := aes.NewCipher(cek)
	gcm, _ := cipher.NewGCM(bloco)
	claro, err := gcm.Open(nil, nonce, ct, nil)
	if err != nil {
		t.Fatalf("não decifra: %v", err)
	}
	return claro[:len(claro)-1]
}
```

Crie `api/internal/meta/graph_test.go`:

```go
package meta

import (
	"context"
	"net/http/httptest"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/rbv-co/social-dashboard/api/internal/core"
)

// coreDeTeste: o core de mentira da Graph (coreMeta, de proxy_test.go) e um cliente que não dorme.
// As tasks do Plano 4 no pacote meta usam este ajudante.
func coreDeTeste(t *testing.T, resp func(core.PedidoMeta) (int, string, map[string]string)) (*core.Cliente, *coreMeta) {
	t.Helper()
	f := &coreMeta{resp: resp}
	srv := httptest.NewServer(f)
	t.Cleanup(srv.Close)
	cli := core.Novo(srv.URL, tokenDoCore)
	cli.Dormir = func(context.Context, time.Duration) error { return nil }
	return cli, f
}

// lista: cópia dos pedidos que o core de mentira recebeu (sob a trava: o servidor anota em outra goroutine).
func (f *coreMeta) lista() []core.PedidoMeta {
	f.mu.Lock()
	defer f.mu.Unlock()
	return slices.Clone(f.pedidos)
}

func TestGETErroDaGraphEDoCoreViramErro(t *testing.T) {
	cli, _ := coreDeTeste(t, func(p core.PedidoMeta) (int, string, map[string]string) {
		switch p.Caminho {
		case "/ok":
			return 200, `{"data":[{"id":"1"}]}`, nil
		case "/graph":
			return 400, `{"error":{"message":"(#100) Invalid parameter","code":100}}`, nil
		case "/erro-200":
			return 200, `{"error":{"message":"Unsupported get request"}}`, nil
		}
		return 400, `{"erro":"caminho ou metodo nao permitido"}`, nil
	})
	if j, err := GET(context.Background(), cli, "/ok", nil); err != nil || len(j["data"].([]any)) != 1 {
		t.Fatalf("j=%v err=%v", j, err)
	}
	for cam, quer := range map[string]string{
		"/graph":    "Meta API /graph: (#100) Invalid parameter",
		"/erro-200": "Meta API /erro-200: Unsupported get request",
		"/core":     "Meta API /core: core: caminho ou metodo nao permitido",
	} {
		_, err := GET(context.Background(), cli, cam, nil)
		if err == nil || err.Error() != quer || strings.Contains(err.Error(), tokenDoCore) {
			t.Errorf("%s: %v", cam, err)
		}
	}
}

func TestPaginasSegueONextEToleraOuNao(t *testing.T) {
	cli, f := coreDeTeste(t, func(p core.PedidoMeta) (int, string, map[string]string) {
		switch p.Parametros["after"] {
		case nil:
			return 200, `{"data":[1,2],"paging":{"next":"https://graph.facebook.com/v21.0/act_9/ads?after=P2&access_token=***"}}`, nil
		case "P2":
			return 200, `{"data":[3],"paging":{"next":"https://graph.facebook.com/v21.0/act_9/ads?after=P3&access_token=***"}}`, nil
		}
		return 500, `{"error":{"message":"página 3 caiu"}}`, nil
	})
	todos, err := Paginas(context.Background(), cli, "/act_9/ads", map[string]any{"limit": "500"}, 50, true)
	if err != nil || len(todos) != 3 {
		t.Fatalf("tolerante devolve o que leu: %v %v", todos, err)
	}
	if ps := f.lista(); ps[1].Caminho != "/act_9/ads" || ps[1].Parametros["access_token"] != nil {
		t.Fatalf("o next vira caminho sem versão e sem token: %+v", ps[1])
	}
	if _, err := Paginas(context.Background(), cli, "/act_9/ads", nil, 50, false); err == nil {
		t.Fatal("não tolerante: página seguinte que falha é erro")
	}
	antes := f.n()
	if todos, _ := Paginas(context.Background(), cli, "/act_9/ads", nil, 2, true); len(todos) != 3 || f.n()-antes != 2 {
		t.Fatalf("teto de páginas: %v chamadas=%d", todos, f.n()-antes)
	}
}
```

Crie `api/internal/meta/push_saldo_test.go`:

```go
package meta

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/rbv-co/social-dashboard/api/internal/core"
	"github.com/rbv-co/social-dashboard/api/internal/testebanco"
	"github.com/rbv-co/social-dashboard/api/internal/webpush/pushteste"
)

func conta(prepaga bool, tipo any, texto string) map[string]any {
	return map[string]any{"is_prepay_account": prepaga, "funding_source_details": map[string]any{"type": tipo, "display_string": texto}}
}

// Esperados gerados com o próprio _shared/saldo-de-conta.js (Node 22).
func TestSaldoComoAEdge(t *testing.T) {
	for txt, quer := range map[string]int64{"Saldo (R$ 12.345,67)": 1234567, "R$\U000000a00,05": 5} {
		if c := lerSaldoDoTexto(txt); c == nil || *c != quer {
			t.Errorf("%q = %v", txt, c)
		}
	}
	if lerSaldoDoTexto("R$ 1.673") != nil || lerSaldoDoTexto("Available balance ($200.00 USD)") != nil {
		t.Fatal("formato fora do pt-BR é 'não sei', nunca um número")
	}
	breno := conta(true, 20, "Saldo disponível (R$ 1.673,75 BRL)")
	vessel := conta(false, "20", "Saldo disponível (R$\U000000a00,00 BRL)")
	raissa := conta(false, 1, "Visa final 1234")
	pouco := conta(true, nil, "Saldo disponível (R$ 200,00 BRL)")
	estranho := conta(true, nil, "Available balance ($200.00 USD)")
	l := func(nome string, c map[string]any, gasto float64) Leitura {
		x := lerSaldo(c, gasto)
		x.Conta = nome
		return x
	}
	casos := []struct {
		ls            []Leitura
		titulo, corpo string
	}{
		{[]Leitura{l("breno", breno, 100), l("raissa", raissa, 50), l("estranho", estranho, 10)}, "", ""},
		{[]Leitura{l("pouco", pouco, 150)}, "pouco: saldo para 1 dia", "R$ 200,00 restantes. No ritmo atual, o saldo dura cerca de 1 dia."},
		{[]Leitura{l("pouco", pouco, 100), l("vessel", vessel, 10), l("breno", breno, 1000)}, "vessel está sem saldo",
			"vessel: sem saldo · breno: R$ 1.673,75 (~1 dia) · pouco: R$ 200,00 (~2 dias)"},
		{[]Leitura{l("pouco", pouco, 300)}, "pouco: saldo acaba hoje", "R$ 200,00 restantes. No ritmo atual, o saldo não passa de hoje."},
		{[]Leitura{l("vessel", vessel, 0)}, "vessel está sem saldo", "R$ 0,00 restantes. O saldo acabou — as campanhas desta conta já podem ter parado."},
	}
	for i, c := range casos {
		titulo, corpo, ok := montarAvisoDeSaldo(c.ls)
		if titulo != c.titulo || corpo != c.corpo || ok != (c.titulo != "") {
			t.Errorf("caso %d: %q / %q / %v", i, titulo, corpo, ok)
		}
	}
	if x := lerSaldo(breno, 0); x.Nivel != "ok" || x.DiasRestantes != nil || x.Porque != "Não sei o ritmo de gasto para estimar quanto tempo dura." {
		t.Fatalf("sem ritmo: %+v", x)
	}
}

const accountsSaldo = `create table accounts (id uuid primary key, name text, instagram_id text, ad_account_id text, access_token text);
insert into accounts values ('aaaaaaaa-0000-0000-0000-000000000001', 'Pouco', null, 'act_111', null),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'Cartão', null, '222', null),
  ('aaaaaaaa-0000-0000-0000-000000000003', 'Sem anúncio', '1784', null, null);`

func graphDoSaldo(falhaCartao bool) func(core.PedidoMeta) (int, string, map[string]string) {
	return func(p core.PedidoMeta) (int, string, map[string]string) {
		switch p.Caminho {
		case "/act_111":
			return 200, `{"is_prepay_account":true,"funding_source_details":{"type":20,"display_string":"Saldo disponível (R$ 200,00 BRL)"}}`, nil
		case "/act_111/insights":
			return 200, `{"data":[{"spend":"2100"}]}`, nil // 300/dia: acaba hoje
		case "/act_222":
			if falhaCartao {
				return 400, `{"error":{"message":"(#200) sem permissão"}}`, nil
			}
			return 200, `{"is_prepay_account":false,"funding_source_details":{"type":1}}`, nil
		case "/act_222/insights":
			return 500, `{"error":{"message":"fora"}}`, nil
		}
		return 404, `{"erro":"rota de teste desconhecida"}`, nil
	}
}

func ambienteSaldo(t *testing.T, falhaCartao bool) (*PushSaldo, *pushteste.Servico, *coreMeta) {
	t.Helper()
	p := testebanco.Novo(t)
	if _, err := p.Exec(context.Background(), accountsSaldo+pushteste.Tabelas); err != nil {
		t.Fatal(err)
	}
	cli, f := coreDeTeste(t, graphDoSaldo(falhaCartao))
	srv := pushteste.Novo(t)
	agora := func() time.Time { return time.Date(2026, 10, 10, 11, 0, 0, 0, time.UTC) }
	return &PushSaldo{Pool: p, Core: cli, VAPID: pushteste.VAPID(t), HTTP: srv.HTTP, Agora: agora}, srv, f
}

func TestPushSaldoAvisaQuemQuerUmaVezSo(t *testing.T) {
	ps, srv, f := ambienteSaldo(t, false)
	ctx := context.Background()
	ua := pushteste.Inscrever(t, ps.Pool, "quer", "cccccccc-0000-0000-0000-000000000001")
	pushteste.Inscrever(t, ps.Pool, "padrao", "cccccccc-0000-0000-0000-000000000002") // saldo nasce desligado
	ps.Pool.Exec(ctx, `insert into push_preferencias (user_id, tipo, ativo) values ('cccccccc-0000-0000-0000-000000000001', 'saldo', true)`)
	if err := ps.Rodar(ctx); err != nil {
		t.Fatal(err)
	}
	var msg map[string]string
	json.Unmarshal(pushteste.Decifrar(t, srv.Ultimo(t, "quer"), ua), &msg)
	if msg["title"] != "Pouco: saldo acaba hoje" || msg["body"] != "R$ 200,00 restantes. No ritmo atual, o saldo não passa de hoje." ||
		msg["tag"] != "gt-saldo" || msg["url"] != "/gestao-trafego" {
		t.Fatalf("push = %v", msg)
	}
	if srv.Recebidos("padrao") != 0 {
		t.Fatal("quem não ligou o aviso de saldo não recebe")
	}
	for _, ped := range f.lista() {
		if ped.Caminho == "/act_act_111" || ped.Parametros["access_token"] != nil {
			t.Fatalf("pedido ao core: %+v", ped)
		}
	}
	// A mesma manhã de novo (rodar manual): nada é reenviado.
	if err := ps.Rodar(ctx); err != nil || srv.Total() != 1 {
		t.Fatalf("repetida reenviou: err=%v total=%d", err, srv.Total())
	}
}

func TestPushSaldoContaQueFalhaEErroMasAsOutrasAvisam(t *testing.T) {
	ps, srv, _ := ambienteSaldo(t, true)
	pushteste.Inscrever(t, ps.Pool, "quer", "cccccccc-0000-0000-0000-000000000001")
	ps.Pool.Exec(context.Background(), `insert into push_preferencias (user_id, tipo, ativo) values ('cccccccc-0000-0000-0000-000000000001', 'saldo', true)`)
	err := ps.Rodar(context.Background())
	if err == nil || !strings.Contains(err.Error(), "Cartão: Meta API /act_222: (#200) sem permissão") {
		t.Fatalf("falha de uma conta tem de aparecer: %v", err)
	}
	if srv.Recebidos("quer") != 1 {
		t.Fatal("as outras contas avisam mesmo assim")
	}
}

func TestPushSaldoSemVAPIDNemChamaOCore(t *testing.T) {
	ps, _, f := ambienteSaldo(t, false)
	ps.VAPID.Privada = ""
	if err := ps.Rodar(context.Background()); err == nil || f.n() != 0 {
		t.Fatalf("err=%v chamadas=%d", err, f.n())
	}
	if tf := ps.Tarefa(); tf.Nome != "enviar-push-saldo-08h" || tf.Agenda != "0 11 * * *" {
		t.Fatalf("%+v", tf)
	}
}
```

Em `api/cmd/api/worker_test.go`, troque:

```go

}

func TestTarefasDeProducao
```

por:

```go

	// Task 3
	"enviar-push-saldo-08h": "0 11 * * *",
}

func TestTarefasDeProducao
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `go test -count=1 ./cmd/api ./internal/core ./internal/meta ./internal/texto ./internal/webpush ./internal/webpush/pushteste`
Expected: FAIL. Primeiras falhas, como saíram no ensaio deste plano: `--- FAIL: TestTarefasDeProducao`, `undefined: Reais`, `undefined: ReaisSimples`, `undefined: Milhar`, `undefined: CortarUTF16`, `undefined: EspacoJS`

- [ ] **Step 3: Implementar**

Em `api/internal/core/core.go`, troque:

```go
	Dormir    func(ctx context.Context, d time.Duration) error // nil = espera de verdade (o teste troca)
}
```

por:

```go
	Dormir    func(ctx context.Context, d time.Duration) error // nil = espera de verdade (o teste troca)
	// RitmoMeta: intervalo mínimo entre duas chamadas à Meta deste cliente (0 = sem ritmo). O core
	// limita 120 chamadas/min por consumidor nas rotas da Meta (vessel-core-go@e8a06e8c3,
	// services/core/cmd/core/meta.go:40 e internal/config/config.go:172); o worker anda abaixo disso.
	RitmoMeta time.Duration

	ritmoMu     sync.Mutex
	proximaMeta time.Time
}
```

Em `api/internal/core/core.go`, troque:

```go
	"strconv"
	"time"
)
```

por:

```go
	"strconv"
	"sync"
	"time"
)
```

Em `api/internal/core/core.go`, troque:

```go
	for t := 1; ; t++ {
		r, err := c.enviar(ctx, CaminhoMeta, p)
```

por:

```go
	for t := 1; ; t++ {
		if err := c.esperarRitmo(ctx); err != nil {
			return nil, err
		}
		r, err := c.enviar(ctx, CaminhoMeta, p)
```

Acrescente ao fim de `api/internal/core/core.go`:

```go
// esperarRitmo segura a chamada até a vez dela (fila por ordem de chegada): no máximo uma chamada à
// Meta a cada RitmoMeta. Sem ritmo, passa direto.
func (c *Cliente) esperarRitmo(ctx context.Context) error {
	if c.RitmoMeta <= 0 {
		return nil
	}
	c.ritmoMu.Lock()
	agora := time.Now()
	vez := c.proximaMeta
	if vez.Before(agora) {
		vez = agora
	}
	c.proximaMeta = vez.Add(c.RitmoMeta)
	c.ritmoMu.Unlock()
	if d := vez.Sub(agora); d > 0 {
		return c.dormir(ctx, d)
	}
	return nil
}
```

Crie `api/internal/texto/texto.go`:

```go
// Package texto: as poucas formatações do JavaScript das edges que as mensagens e avisos precisam
// reproduzir byte a byte (dinheiro, milhar, corte de texto).
package texto

import (
	"math"
	"strconv"
	"strings"
	"unicode/utf16"
)

// EspacoJS é a classe `\s` do JavaScript (o `\s` do Go só tem o ASCII): para regex portadas das edges.
const EspacoJS = `[\t\n\v\f\r \x{00a0}\x{1680}\x{2000}-\x{200a}\x{2028}\x{2029}\x{202f}\x{205f}\x{3000}\x{feff}]`

// centavos arredonda como o Intl do JS: sobre a representação decimal MAIS CURTA do double (a de
// String(v)), metade para longe do zero (ECMA-402 roundingMode "halfExpand"). 2.675 vira 268 (o
// double é 2,67499…, mas o JS arredonda o texto "2.675"); 0.015 vira 2.
func centavos(v float64) int64 {
	inteiro, frac, _ := strings.Cut(strconv.FormatFloat(math.Abs(v), 'f', -1, 64), ".")
	frac += "000"
	n, _ := strconv.ParseInt(inteiro+frac[:2], 10, 64)
	if frac[2] >= '5' {
		n++
	}
	return n
}

func milhar(n int64) string {
	s := strconv.FormatInt(n, 10)
	var b strings.Builder
	for i, c := range s {
		if i > 0 && (len(s)-i)%3 == 0 {
			b.WriteByte('.')
		}
		b.WriteRune(c)
	}
	return b.String()
}

func valor(v float64) string {
	c := centavos(v)
	return milhar(c/100) + "," + strconv.FormatInt(100+c%100, 10)[1:]
}

// Reais = v.toLocaleString('pt-BR', {style: 'currency', currency: 'BRL'}): "R$" + espaço NÃO
// separável (U+00A0) + "1.234,56"; negativo "-R$ 1,00".
func Reais(v float64) string {
	sinal := ""
	if v < 0 {
		sinal = "-"
	}
	return sinal + "R$\U000000a0" + valor(v)
}

// ReaisSimples = 'R$ ' + v.toLocaleString('pt-BR', {minimumFractionDigits: 2, maximumFractionDigits: 2})
// (espaço comum; negativo "R$ -1,00"), o brl() de _shared/saldo-de-conta.js.
func ReaisSimples(v float64) string {
	sinal := ""
	if v < 0 {
		sinal = "-"
	}
	return "R$ " + sinal + valor(v)
}

// Milhar = n.toLocaleString('pt-BR') para inteiro: "24.351".
func Milhar(n int64) string {
	if n < 0 {
		return "-" + milhar(-n)
	}
	return milhar(n)
}

// CortarUTF16 = s.slice(0, n) do JS, que conta unidades UTF-16 (um emoji ou letra "𝐁" vale 2).
// Diferença de propósito: um corte no meio de um par substituto vira U+FFFD (o JS deixaria meio caractere).
func CortarUTF16(s string, n int) string {
	u := utf16.Encode([]rune(s))
	if len(u) <= n {
		return s
	}
	return string(utf16.Decode(u[:n]))
}
```

Crie `api/internal/webpush/destinatarios.go`:

```go
package webpush

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"log/slog"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/banco"
)

// Destino é uma inscrição de push com o dono (push_subs.user_id).
type Destino struct {
	Inscricao
	UserID string
}

// padraoDoTipo: sem linha em push_preferencias vale o padrão do tipo (TIPOS_DE_NOTIFICACAO de
// _shared/notificacoes.js): só 'vendas' nasce ligado. Tipo fora da lista não chega a ninguém.
var padraoDoTipo = map[string]bool{"vendas": true, "saldo": false, "conteudo": false, "frota": false, "frota_reserva": false}

// Destinatarios = inscricoesDoTipo de _shared/notificacoes.js: as inscrições COM dono que querem
// `tipo` (a preferência gravada vence; sem ela, o padrão do tipo). usuario != "" restringe a um dono.
func Destinatarios(ctx context.Context, p *pgxpool.Pool, tipo, usuario string) ([]Destino, error) {
	padrao, ok := padraoDoTipo[tipo]
	if !ok {
		return nil, nil
	}
	linhas, err := p.Query(ctx, `select s.endpoint, s.p256dh, s.auth, s.user_id::text from push_subs s
		where s.user_id is not null and ($3::text = '' or s.user_id::text = $3::text)
		  and coalesce((select pp.ativo from push_preferencias pp where pp.user_id = s.user_id and pp.tipo = $1::text), $2::boolean)
		order by s.endpoint`, tipo, padrao, usuario)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(linhas, func(r pgx.CollectableRow) (d Destino, err error) {
		return d, r.Scan(&d.Endpoint, &d.P256dh, &d.Auth, &d.UserID)
	})
}

// Resultado de uma entrega.
type Resultado struct {
	Enviados, Podados, Repetidos, Falhas int
}

// Entregar manda `payload` a cada destino. Antes de cada envio reserva `prefixo:<sha do endpoint>`
// no livro de envios: destino já servido com esse prefixo não recebe de novo (execução repetida =
// Repetidos). 404/410 apaga a inscrição (morta). Sem 2xx a reserva é desfeita, e a próxima execução
// pode tentar. A falha de um destino não derruba os outros; o erro devolvido é só o do banco.
func Entregar(ctx context.Context, p *pgxpool.Pool, cli *http.Client, alvos []Destino, payload []byte, v VAPID, prefixo string) (Resultado, error) {
	var r Resultado
	for _, d := range alvos {
		h := sha256.Sum256([]byte(d.Endpoint))
		chave := prefixo + ":" + hex.EncodeToString(h[:8]) // o endpoint é um token: não vai inteiro para a chave
		ok, err := banco.ReservarEnvio(ctx, p, chave)
		if err != nil {
			return r, err
		}
		if !ok {
			r.Repetidos++
			continue
		}
		st, err := Enviar(ctx, cli, d.Inscricao, payload, v)
		switch {
		case err != nil:
			slog.Warn("push: inscrição pulada", "erro", err) // o erro do Enviar não traz o endpoint
			r.Falhas++
		case st >= 200 && st < 300:
			r.Enviados++
			continue // a reserva fica: esta mensagem saiu
		case st == http.StatusGone || st == http.StatusNotFound:
			if _, err := p.Exec(ctx, `delete from push_subs where endpoint = $1::text`, d.Endpoint); err == nil {
				r.Podados++
			}
		default:
			slog.Warn("push: o serviço de push recusou", "status", st) // só o código: o endpoint é um token
			r.Falhas++
		}
		c, cancela := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
		err = banco.LiberarEnvio(c, p, chave)
		cancela()
		if err != nil {
			return r, err
		}
	}
	return r, nil
}
```

Crie `api/internal/meta/graph.go`:

```go
package meta

import (
	"context"
	"fmt"
	"log/slog"

	"github.com/rbv-co/social-dashboard/api/internal/core"
)

// GET é a Graph pelo core para as tarefas do worker (o `apiGet`/`graph` das edges de cron): devolve o
// JSON da Graph; resposta com "error" (da Graph, ou do core já no formato da Graph por comoGraph)
// vira erro com a mensagem da Meta. Nunca leva token: a API não tem token da Meta e o core mascara o
// dele (`access_token=***`). 429 do core repete até 3 vezes; o ritmo é o RitmoMeta do cliente.
func GET(ctx context.Context, c *core.Cliente, caminho string, params map[string]any) (map[string]any, error) {
	j, err := (&AoVivo{Core: c}).graph(ctx, caminho, params)
	if err != nil {
		return nil, err
	}
	if e, ok := j["error"].(map[string]any); ok {
		msg, _ := e["message"].(string)
		if msg == "" {
			msg = "erro na Meta"
		}
		return nil, fmt.Errorf("Meta API %s: %s", caminho, msg)
	}
	return j, nil
}

// Paginas segue paging.next juntando `data`, até `max` páginas (teto de segurança). A 1ª página
// falhar é erro. Falha numa página seguinte: tolerante = devolve o que já leu (o `if (!r.ok) break`
// de coletar-dados); senão = erro (coletar-dados-hora lança).
func Paginas(ctx context.Context, c *core.Cliente, caminho string, params map[string]any, max int, tolerante bool) ([]any, error) {
	j, err := GET(ctx, c, caminho, params)
	if err != nil {
		return nil, err
	}
	todos, _ := j["data"].([]any)
	for n := 1; n < max; n++ {
		paging, _ := j["paging"].(map[string]any)
		next, _ := paging["next"].(string)
		if next == "" {
			return todos, nil
		}
		cam, ps, ok := traduzirURL(next)
		if !ok {
			return todos, nil
		}
		if j, err = GET(ctx, c, cam, ps); err != nil {
			if tolerante {
				slog.Warn("meta: página seguinte falhou; fico com o que já li", "caminho", caminho, "erro", err)
				return todos, nil
			}
			return nil, err
		}
		pagina, _ := j["data"].([]any)
		todos = append(todos, pagina...)
	}
	return todos, nil
}
```

Crie `api/internal/meta/saldo.go`:

```go
package meta

import (
	"cmp"
	"fmt"
	"math"
	"regexp"
	"slices"
	"strconv"
	"strings"

	"github.com/rbv-co/social-dashboard/api/internal/texto"
)

// Porta de _shared/saldo-de-conta.js. O `balance` da Meta é a FATURA, não o saldo: o saldo de verdade
// só vem como TEXTO em funding_source_details.display_string ("Saldo disponível (R$ 1.673,75 BRL)").
// O parse falha FECHADO: não reconheceu = 'nao-sei', que nunca vira aviso.

const tipoPrePago = 20

var reSaldo = regexp.MustCompile(`R\$` + texto.EspacoJS + `*([\d.]+),(\d{2})`)

// lerSaldoDoTexto: "Saldo disponível (R$ 1.673,75 BRL)" -> 167375 (centavos); outra forma -> nil.
func lerSaldoDoTexto(t string) *int64 {
	m := reSaldo.FindStringSubmatch(t)
	if m == nil {
		return nil
	}
	inteiro := strings.ReplaceAll(m[1], ".", "")
	n, err := strconv.ParseInt(inteiro, 10, 64)
	if err != nil {
		return nil
	}
	cent, _ := strconv.ParseInt(m[2], 10, 64)
	c := n*100 + cent
	return &c
}

func ehPrePaga(conta map[string]any) bool {
	if v, ok := conta["is_prepay_account"].(bool); ok && v {
		return true
	}
	fs, _ := conta["funding_source_details"].(map[string]any)
	return fs != nil && numero(fs["type"]) == tipoPrePago
}

// Leitura é o lerSaldo() de uma conta (+ conta e account_id, como a edge acrescenta).
type Leitura struct {
	PrePaga       bool
	Centavos      *int64
	Reais         *float64
	DiasRestantes *float64
	Nivel         string // acabou | critico | atencao | ok | nao-se-aplica | nao-sei
	Porque        string
	Conta         string
	AccountID     string
}

func f64(v float64) *float64 { return &v }

func plural(n float64) string {
	if n == 1 {
		return ""
	}
	return "s"
}

func lerSaldo(conta map[string]any, gastoPorDia float64) Leitura {
	if !ehPrePaga(conta) {
		return Leitura{Nivel: "nao-se-aplica", Porque: "Esta conta paga no cartão — não tem saldo que acabe."}
	}
	fs, _ := conta["funding_source_details"].(map[string]any)
	ds, _ := fs["display_string"].(string)
	c := lerSaldoDoTexto(ds)
	if c == nil {
		return Leitura{PrePaga: true, Nivel: "nao-sei", Porque: "Não consegui ler o saldo desta conta."}
	}
	reais := float64(*c) / 100
	var dias *float64
	if !math.IsNaN(gastoPorDia) && !math.IsInf(gastoPorDia, 0) && gastoPorDia > 0 {
		dias = f64(reais / gastoPorDia)
	}
	l := Leitura{PrePaga: true, Centavos: c, Reais: &reais}
	switch {
	case *c <= 0:
		l.DiasRestantes, l.Nivel, l.Porque = f64(0), "acabou", "O saldo acabou — as campanhas desta conta já podem ter parado."
	case dias == nil:
		l.Nivel, l.Porque = "ok", "Não sei o ritmo de gasto para estimar quanto tempo dura."
	case *dias < 1:
		l.DiasRestantes, l.Nivel, l.Porque = dias, "critico", "No ritmo atual, o saldo não passa de hoje."
	case *dias < 3:
		d := math.Floor(*dias)
		l.DiasRestantes, l.Nivel, l.Porque = dias, "atencao", fmt.Sprintf("No ritmo atual, o saldo dura cerca de %d dia%s.", int(d), plural(d))
	default:
		l.DiasRestantes, l.Nivel, l.Porque = dias, "ok", fmt.Sprintf("No ritmo atual, o saldo dura cerca de %d dias.", int(math.Floor(*dias)))
	}
	return l
}

var urgencia = map[string]int{"acabou": 0, "critico": 1, "atencao": 2}

// contasParaAvisar: só acabou, critico e atencao ('nao-sei' fica de fora de propósito), da mais urgente
// para a menos; empate pelo prazo (sort estável, como o do JS).
func contasParaAvisar(ls []Leitura) []Leitura {
	var out []Leitura
	for _, l := range ls {
		if _, ok := urgencia[l.Nivel]; ok {
			out = append(out, l)
		}
	}
	dias := func(l Leitura) float64 {
		if l.DiasRestantes == nil {
			return 0
		}
		return *l.DiasRestantes
	}
	slices.SortStableFunc(out, func(a, b Leitura) int {
		if c := cmp.Compare(urgencia[a.Nivel], urgencia[b.Nivel]); c != 0 {
			return c
		}
		return cmp.Compare(dias(a), dias(b))
	})
	return out
}

// montarAvisoDeSaldo: título e corpo do push, ou ok=false quando não há o que avisar.
func montarAvisoDeSaldo(ls []Leitura) (titulo, corpo string, ok bool) {
	lista := contasParaAvisar(ls)
	if len(lista) == 0 {
		return "", "", false
	}
	p := lista[0]
	linha := func(l Leitura) string {
		if l.Nivel == "acabou" {
			return l.Conta + ": sem saldo"
		}
		prazo := "hoje"
		if *l.DiasRestantes >= 1 {
			d := math.Floor(*l.DiasRestantes)
			prazo = fmt.Sprintf("%d dia%s", int(d), plural(d))
		}
		return fmt.Sprintf("%s: %s (~%s)", l.Conta, texto.ReaisSimples(*l.Reais), prazo)
	}
	switch p.Nivel {
	case "acabou":
		titulo = p.Conta + " está sem saldo"
	case "critico":
		titulo = p.Conta + ": saldo acaba hoje"
	default:
		d := math.Floor(*p.DiasRestantes)
		titulo = fmt.Sprintf("%s: saldo para %d dia%s", p.Conta, int(d), plural(d))
	}
	if len(lista) == 1 {
		corpo = texto.ReaisSimples(*p.Reais) + " restantes. " + p.Porque
	} else {
		partes := make([]string, len(lista))
		for i, l := range lista {
			partes[i] = linha(l)
		}
		corpo = strings.Join(partes, " · ")
	}
	return titulo, corpo, true
}
```

Crie `api/internal/meta/push_saldo.go`:

```go
package meta

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/core"
	"github.com/rbv-co/social-dashboard/api/internal/webpush"
	"github.com/rbv-co/social-dashboard/api/internal/worker"
)

// PushSaldo porta supabase/functions/enviar-push-saldo (job push-saldo-08h, robô
// 'enviar-push-saldo-08h'): lê o saldo das contas de anúncio pela Graph (via core) e manda UM push a
// quem quer o tipo 'saldo' quando alguma está acabando. Nada urgente = nada enviado.
type PushSaldo struct {
	Pool  *pgxpool.Pool
	Core  *core.Cliente
	VAPID webpush.VAPID
	HTTP  *http.Client     // serviço de push; nil = o cliente seguro do webpush
	Agora func() time.Time // nil = time.Now
}

func (ps *PushSaldo) Tarefa() worker.Tarefa {
	return worker.Tarefa{Nome: "enviar-push-saldo-08h", Agenda: "0 11 * * *", Limite: 3 * time.Minute, Executar: ps.Rodar}
}

type contaDeAnuncio struct{ id, nome, adAccount string }

func (ps *PushSaldo) Rodar(ctx context.Context) error {
	// VAPID errado falha AQUI, uma vez (a edge devolvia 500 vapid_nao_configurado).
	if _, err := webpush.ValidarVAPID(ps.VAPID); err != nil {
		return err
	}
	linhas, err := ps.Pool.Query(ctx, `select id::text, coalesce(name, ''), ad_account_id::text from accounts
		where coalesce(ad_account_id::text, '') <> '' order by name`)
	if err != nil {
		return err
	}
	contas, err := pgx.CollectRows(linhas, func(r pgx.CollectableRow) (c contaDeAnuncio, err error) {
		return c, r.Scan(&c.id, &c.nome, &c.adAccount)
	})
	if err != nil {
		return err
	}
	if len(contas) == 0 {
		slog.Info("push de saldo: nenhuma conta de anúncio", "motivo", "sem_contas")
		return nil
	}
	var leituras []Leitura
	var falhas []string
	for _, c := range contas {
		acc := strings.TrimPrefix(c.adAccount, "act_") // limparId da edge
		nome := c.nome
		if nome == "" {
			nome = acc
		}
		detalhe, err := GET(ctx, ps.Core, "/act_"+acc, map[string]any{"fields": "is_prepay_account,funding_source_details"})
		if err != nil {
			falhas = append(falhas, nome+": "+err.Error())
			continue
		}
		// O ritmo dos últimos 7 dias transforma "R$ 200" em "dura 2 dias"; sem ele, não estima prazo.
		gasto7 := 0.0
		if ins, err := GET(ctx, ps.Core, "/act_"+acc+"/insights", map[string]any{"date_preset": "last_7d", "fields": "spend"}); err == nil {
			gasto7 = numero(primeiro(ins)["spend"])
		}
		l := lerSaldo(detalhe, gasto7/7)
		l.Conta, l.AccountID = nome, c.id
		leituras = append(leituras, l)
	}
	erroDasFalhas := func() error {
		if len(falhas) == 0 {
			return nil
		}
		return fmt.Errorf("saldo: %d conta(s) sem leitura: %s", len(falhas), strings.Join(falhas, " · "))
	}
	titulo, corpo, temAviso := montarAvisoDeSaldo(leituras)
	if !temAviso {
		for _, l := range leituras {
			slog.Info("push de saldo: nada urgente", "conta", l.Conta, "nivel", l.Nivel)
		}
		return erroDasFalhas()
	}
	payload, _ := json.Marshal(struct {
		Title string `json:"title"`
		Body  string `json:"body"`
		Tag   string `json:"tag"` // substitui o aviso anterior em vez de empilhar
		URL   string `json:"url"`
	}{titulo, corpo, "gt-saldo", "/gestao-trafego"})
	alvos, err := webpush.Destinatarios(ctx, ps.Pool, "saldo", "")
	if err != nil {
		return err
	}
	if len(alvos) == 0 {
		slog.Info("push de saldo: ninguém quer este tipo", "titulo", titulo)
		return erroDasFalhas()
	}
	agora := time.Now
	if ps.Agora != nil {
		agora = ps.Agora
	}
	dia := agora().In(saoPaulo).Format("2006-01-02")
	r, err := webpush.Entregar(ctx, ps.Pool, ps.HTTP, alvos, payload, ps.VAPID, "enviar-push-saldo:"+dia)
	if err != nil {
		return err
	}
	slog.Info("push de saldo", "titulo", titulo, "enviados", r.Enviados, "podados", r.Podados, "repetidos", r.Repetidos, "falhas", r.Falhas)
	if r.Enviados == 0 && r.Falhas > 0 {
		return fmt.Errorf("nenhum_push_entregue: %d inscrições, 0 aceitas", len(alvos))
	}
	return erroDasFalhas()
}
```

Em `api/cmd/api/tarefas.go`, troque:

```go
import (
	"github.com/jackc/pgx/v5/pgxpool"
```

por:

```go
import (
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
```

Em `api/cmd/api/tarefas.go`, troque:

```go
	"github.com/rbv-co/social-dashboard/api/internal/mensagens"
```

por:

```go
	"github.com/rbv-co/social-dashboard/api/internal/mensagens"
	"github.com/rbv-co/social-dashboard/api/internal/meta"
```

Em `api/cmd/api/tarefas.go`, troque:

```go
	cli := core.Novo(cfg.CoreURL, cfg.CoreToken)
	var ts []worker.Tarefa
```

por:

```go
	cli := core.Novo(cfg.CoreURL, cfg.CoreToken)
	cli.RitmoMeta = 600 * time.Millisecond // ~100 chamadas/min à Meta, abaixo do teto de 120/min do core
	var ts []worker.Tarefa
```

Em `api/cmd/api/tarefas.go`, troque:

```go
	return ts
}
```

por:

```go
	ts = append(ts, (&meta.PushSaldo{Pool: p, Core: cli, VAPID: vapid(cfg)}).Tarefa())
	return ts
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `gofmt -l . && go vet ./... && go test -race -count=1 ./internal/core/ ./internal/texto/ ./internal/webpush/... ./internal/meta/ ./cmd/api/ -v 2>&1 | grep -E -- '^(ok|FAIL|--- FAIL|--- SKIP)'`
Expected: `gofmt` não lista nada; só linhas `ok`, nenhuma `FAIL` nem `--- SKIP`.

- [ ] **Step 5: Commit**

```bash
git add api/internal/core/core.go api/internal/core/core_test.go api/internal/texto/texto.go api/internal/texto/texto_test.go api/internal/webpush/destinatarios.go api/internal/webpush/destinatarios_test.go api/internal/webpush/pushteste/pushteste.go api/internal/meta/graph.go api/internal/meta/graph_test.go api/internal/meta/saldo.go api/internal/meta/push_saldo.go api/internal/meta/push_saldo_test.go api/cmd/api/tarefas.go api/cmd/api/worker_test.go
git commit -m "feat(api): Graph com ritmo, push compartilhado, formatação do JS e enviar-push-saldo-08h no worker

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Frota: `enviar-push-frota` e `POST /avisar-decisao-de-reserva`

**Revisor:** **opus** (rota autenticada nova que dispara push; texto do push nunca vem do cliente).

- `enviar-push-frota` (`30 10 * * 1-5`): porta `supabase/functions/enviar-push-frota/index.ts` (cadências do dia pela `frota_checklist_config`, itens ativos, quem responde pelo carro: a posse aberta em `frota_uso` e, na falta, o dono fixo; quem já fez o checklist de hoje não recebe). Chave no livro `enviar-push-frota:<dia>:<veículo>`; `frota` nasce DESLIGADO em `push_preferencias`. Fim de semana e ninguém ligado não enviam; falha de aparelho vira erro.
- `POST /avisar-decisao-de-reserva`: porta `supabase/functions/avisar-decisao-de-reserva/index.ts` como rota da API (o front chama depois de aprovar/recusar/cancelar/revogar), atrás de `auth.Exigir` + `auth.ExigirPermissao("frota.aprovar", "ver")` (o portão da edge). O corpo é SÓ `{requisicaoId}`: o texto sai do que está gravado (senão seria um jeito de mandar push arbitrário ao celular de qualquer um). Mesmas respostas da edge (`400 sem_requisicao`, `404 requisicao_nao_encontrada`, `motivo` em `situacao_nao_avisavel`, `quem_pediu_nao_tem_login`, `decidiu_a_propria`, `sem_aparelho_ou_aviso_desligado`, `500 vapid_nao_configurado`/`erro_interno`). A mesma decisão não vai duas vezes ao mesmo aparelho (livro `avisar-decisao-de-reserva:<id>:<situação>`; `enviados` conta enviados + repetidos).
- `TestAvisarDecisaoDeReservaPeloPortaoReal` prova pela montagem real das rotas: sem a permissão, 403 antes do handler; com ela, o 400 do corpo vazio vem DEPOIS do portão.

**Files:**
- Create: `api/internal/frota/regras.go`
- Test: `api/internal/frota/regras_test.go`
- Create: `api/internal/frota/push_frota.go`
- Test: `api/internal/frota/push_frota_test.go`
- Create: `api/internal/frota/reserva.go`
- Test: `api/internal/frota/reserva_test.go`
- Modify: `api/internal/web/rotas.go`
- Test (modify): `api/internal/web/rotas_test.go`
- Modify: `api/cmd/api/tarefas.go`
- Test (modify): `api/cmd/api/worker_test.go`

**Interfaces:**
- Consumes: `webpush.Destinatarios`, `webpush.Entregar`, `pushteste.*` (Task 3); `auth.Exigir`, `auth.ExigirPermissao`, `web.Rotas` e os ajudantes de `rotas_test.go` (núcleo e Plano 3); `worker.Tarefa` (Task 1).
- Produces:
  - `type frota.PushFrota struct { Pool; VAPID webpush.VAPID; HTTP *http.Client; Agora func() time.Time }` com `Rodar` e `Tarefa`.
  - `type frota.Reserva struct { Pool; VAPID webpush.VAPID; HTTP *http.Client }` com `ServeHTTP` (montado em `POST /avisar-decisao-de-reserva`).

- [ ] **Step 1: Escrever os testes que falham**

Crie `api/internal/frota/regras_test.go`:

```go
package frota

import (
	"slices"
	"strings"
	"testing"
	"time"
)

func sp(s string) *string { return &s }

// Esperados gerados com _shared/checklist.js, aviso-de-checklist.js e aviso-de-reserva.js (Node 22).
func TestCadenciasDoDiaComoAEdge(t *testing.T) {
	cfg := Config{DiaSemanal: 5, SemanaMensal: 1, DiaMensal: 3}
	casos := []struct {
		hoje, semanal, mensal string
		quer                  []string
	}{
		{"2026-10-09", "", "", []string{"diario", "semanal"}},           // sexta = dia da semanal
		{"2026-10-07", "", "", []string{"diario", "mensal"}},            // 1ª quarta = dia do mensal
		{"2026-10-06", "2026-09-25", "", []string{"diario", "semanal"}}, // semanal atrasada (11 dias)
		{"2026-10-06", "", "2026-09-01", []string{"diario", "mensal"}},  // mensal atrasada (35 dias)
		{"2026-10-10", "", "", nil},                                     // sábado
		{"2026-10-14", "2026-10-09", "2026-10-07", []string{"diario"}},
	}
	for _, c := range casos {
		if got := cadenciasDoDia(c.hoje, cfg, c.semanal, c.mensal); !slices.Equal(got, c.quer) {
			t.Errorf("%s: %v, esperava %v", c.hoje, got, c.quer)
		}
	}
}

func TestMontarAvisoDoChecklist(t *testing.T) {
	for _, c := range []struct {
		n             int
		cad           []string
		titulo, corpo string
	}{
		{1, []string{"diario"}, "Checklist do Volvo", "1 item e o hodômetro."},
		{3, []string{"diario", "semanal", "mensal"}, "Checklist do Volvo", "3 itens e o hodômetro. Hoje tem a conferência do mês junto."},
		{2, []string{"diario", "semanal"}, "Checklist do Volvo", "2 itens e o hodômetro. Hoje tem a conferência da semana junto."},
	} {
		if ti, co := montarAviso("Volvo", c.n, c.cad); ti != c.titulo || co != c.corpo {
			t.Errorf("%q / %q", ti, co)
		}
	}
	itens := []Item{{"semanal", 2, true}, {"diario", 3, true}, {"diario", 1, false}, {"mensal", 0, true}, {"diario", 1, true}}
	if got := itensDaFicha(itens, []string{"diario", "semanal"}); len(got) != 3 || got[0].Ordem != 1 || got[2].Ordem != 3 {
		t.Fatalf("ativos das cadências, na ordem: %+v", got)
	}
}

func TestLoginDaPessoa(t *testing.T) {
	us := []Usuario{{"u1", "raissa@rbv.com"}, {"u2", "marcus@rbv.com"}}
	casos := []struct {
		p    *Pessoa
		quer string
	}{
		{&Pessoa{ProfileID: "u2", EmailCorporativo: "raissa@rbv.com"}, "u2"}, // o elo vence
		{&Pessoa{ProfileID: "u-sumiu", EmailCorporativo: " Raissa@RBV.com "}, "u1"},
		{&Pessoa{EmailCorporativo: ""}, ""}, // duas ausências não são a mesma pessoa
		{&Pessoa{EmailCorporativo: "outra@rbv.com"}, ""},
		{nil, ""},
	}
	for i, c := range casos {
		if got := loginDaPessoa(c.p, us); got != c.quer {
			t.Errorf("caso %d: %q", i, got)
		}
	}
}

func TestMontarAvisoDeReservaComoAEdge(t *testing.T) {
	ret := time.Date(2026, 10, 12, 17, 5, 0, 0, time.UTC) // 14:05 em São Paulo
	base := Requisicao{RetiradaPrevista: &ret, Destino: sp("Campinas ")}
	com := func(f func(*Requisicao)) Requisicao { r := base; f(&r); return r }
	casos := []struct {
		r             Requisicao
		veiculo       string
		titulo, corpo string
	}{
		{com(func(r *Requisicao) { r.Situacao = "aprovada" }), "Volvo", "Reserva aprovada", "Volvo · 12/10 às 14:05 · Campinas"},
		{com(func(r *Requisicao) { r.Situacao, r.Destino = "aprovada", sp("  ") }), "Volvo", "Reserva aprovada", "Volvo · 12/10 às 14:05 · "},
		{com(func(r *Requisicao) { r.Situacao, r.MotivoDecisao = "recusada", sp("  carro   na\noficina  ") }), "", "Reserva recusada", "o veículo · 12/10 às 14:05 — carro na oficina"},
		{com(func(r *Requisicao) { r.Situacao, r.MotivoDecisao = "recusada", sp("") }), "Volvo", "Reserva recusada", "Volvo · 12/10 às 14:05 — sem motivo escrito. Fale com quem administra a Frota."},
		{Requisicao{Situacao: "revogada", EncerradaMotivo: sp(strings.Repeat("x", 130))}, "Volvo", "A sua reserva foi encerrada", "Volvo — " + strings.Repeat("x", 119) + "…"},
		{com(func(r *Requisicao) { r.Situacao = "cancelada" }), "Volvo", "A sua reserva foi cancelada", "Volvo · 12/10 às 14:05 — o carro não está mais reservado para você."},
	}
	for i, c := range casos {
		a, ok := montarAvisoDeReserva(c.r, c.veiculo)
		if !ok || a.Titulo != c.titulo || a.Corpo != c.corpo || a.URL != "/frota" {
			t.Errorf("caso %d: %+v ok=%v", i, a, ok)
		}
	}
	if _, ok := montarAvisoDeReserva(com(func(r *Requisicao) { r.Situacao = "pendente" }), "Volvo"); ok {
		t.Fatal("pendente não é decisão: não avisa")
	}
}
```

Crie `api/internal/frota/push_frota_test.go`:

```go
package frota

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/testebanco"
	"github.com/rbv-co/social-dashboard/api/internal/webpush/pushteste"
)

// Colunas de produção usadas (db/migrations/acessos/001, 004, 022, 023, 028, 045; acessos_pessoas.profile_id
// existe em produção e não aparece nas migrations — premissa conferida por ops/migracao/conferir-worker.sql).
const tabelasFrota = `
create table acessos_pessoas (id uuid primary key, nome text not null, profile_id uuid, email_corporativo text);
create table frota_veiculos (id uuid primary key, placa text not null unique, nome text not null, pessoa_id uuid,
  situacao text not null default 'ativo');
create table frota_checklist_itens (id uuid primary key default gen_random_uuid(), ordem int not null default 0,
  item text not null unique, cadencia text not null, ativo boolean not null default true);
create table frota_checklist_config (id boolean primary key default true, dia_semanal int not null default 5,
  semana_mensal int not null default 1, dia_mensal int not null default 3);
create table frota_checklist (id uuid primary key default gen_random_uuid(), veiculo_id uuid not null, feita_em date not null,
  cadencias text[] not null default '{diario}', hodometro int not null default 1, unique (veiculo_id, feita_em));
create table frota_uso (id uuid primary key default gen_random_uuid(), veiculo_id uuid not null, pessoa_id uuid, pessoa_nome text,
  saida_em timestamptz not null default now(), volta_em timestamptz, tipo text not null default 'viagem');
create table frota_requisicoes (id uuid primary key default gen_random_uuid(), veiculo_id uuid not null, pessoa_id uuid,
  pessoa_nome text, destino text, retirada_prevista timestamptz not null, situacao text not null default 'pendente',
  criada_por uuid, motivo_decisao text, encerrada_motivo text);`

const (
	uMarcus  = "eeeeeeee-0000-0000-0000-000000000001"
	uBarbara = "eeeeeeee-0000-0000-0000-000000000002"
	uRaissa  = "eeeeeeee-0000-0000-0000-000000000003"
	pMarcus  = "ffffffff-0000-0000-0000-000000000001"
	pBarbara = "ffffffff-0000-0000-0000-000000000002"
	pRaissa  = "ffffffff-0000-0000-0000-000000000003"
	pSemLog  = "ffffffff-0000-0000-0000-000000000004"
	vVolvo   = "99999999-0000-0000-0000-000000000001"
	vFiat    = "99999999-0000-0000-0000-000000000002"
	vGol     = "99999999-0000-0000-0000-000000000003"
	vDoblo   = "99999999-0000-0000-0000-000000000004"
)

// Cenário: o Volvo é do Marcus, mas está emprestado (posse aberta) com a Barbara; o Fiat é da Raissa
// (só pelo e-mail corporativo, sem o elo); o Gol já tem ficha hoje; o Doblo é de quem não tem login.
func ambienteFrota(t *testing.T) (*PushFrota, *pushteste.Servico, *pgxpool.Pool) {
	t.Helper()
	p := testebanco.Novo(t)
	ctx := context.Background()
	if _, err := p.Exec(ctx, tabelasFrota+pushteste.Tabelas); err != nil {
		t.Fatal(err)
	}
	// Os ids entram por texto (constantes do teste), em comandos separados: o pgx não aceita vários
	// comandos num pedido com parâmetros.
	for _, sql := range []string{
		`insert into profiles (id, email) values ('` + uMarcus + `', 'marcus@rbv.com'), ('` + uBarbara + `', 'barbara@rbv.com'), ('` + uRaissa + `', 'raissa@rbv.com')`,
		`insert into acessos_pessoas values ('` + pMarcus + `', 'Marcus', '` + uMarcus + `', null), ('` + pBarbara + `', 'Barbara', '` + uBarbara + `', null),
			('` + pRaissa + `', 'Raissa', null, 'Raissa@RBV.com'), ('` + pSemLog + `', 'Sem Login', null, null)`,
		`insert into frota_veiculos values ('` + vVolvo + `', 'AAA', 'Volvo', '` + pMarcus + `', 'ativo'), ('` + vFiat + `', 'BBB', 'Fiat', '` + pRaissa + `', 'ativo'),
			('` + vGol + `', 'CCC', 'Gol', '` + pMarcus + `', 'ativo'), ('` + vDoblo + `', 'DDD', 'Doblo', '` + pSemLog + `', 'ativo')`,
		`insert into frota_uso (veiculo_id, pessoa_id, tipo) values ('` + vVolvo + `', '` + pBarbara + `', 'posse')`,
		`insert into frota_checklist (veiculo_id, feita_em) values ('` + vGol + `', '2026-10-09')`,
		`insert into frota_checklist_config default values`,
		`insert into frota_checklist_itens (ordem, item, cadencia) values (1, 'pneu', 'diario'), (2, 'óleo', 'semanal'), (3, 'estepe', 'mensal')`,
	} {
		if _, err := p.Exec(ctx, sql); err != nil {
			t.Fatal(err)
		}
	}
	srv := pushteste.Novo(t)
	agora := func() time.Time { return time.Date(2026, 10, 9, 10, 30, 0, 0, time.UTC) } // sexta 07:30 em SP
	return &PushFrota{Pool: p, VAPID: pushteste.VAPID(t), HTTP: srv.HTTP, Agora: agora}, srv, p
}

func ligarAviso(t *testing.T, p *pgxpool.Pool, tipo string, usuarios ...string) {
	t.Helper()
	for _, u := range usuarios {
		if _, err := p.Exec(context.Background(), `insert into push_preferencias (user_id, tipo, ativo) values ($1::uuid, $2, true)`, u, tipo); err != nil {
			t.Fatal(err)
		}
	}
}

func TestPushFrotaAvisaQuemEstaComOCarro(t *testing.T) {
	pf, srv, p := ambienteFrota(t)
	uaBarbara := pushteste.Inscrever(t, p, "barbara", uBarbara)
	uaRaissa := pushteste.Inscrever(t, p, "raissa", uRaissa)
	pushteste.Inscrever(t, p, "marcus", uMarcus)
	ligarAviso(t, p, "frota", uMarcus, uBarbara, uRaissa)
	if err := pf.Rodar(context.Background()); err != nil {
		t.Fatal(err)
	}
	var b, r map[string]string
	json.Unmarshal(pushteste.Decifrar(t, srv.Ultimo(t, "barbara"), uaBarbara), &b)
	json.Unmarshal(pushteste.Decifrar(t, srv.Ultimo(t, "raissa"), uaRaissa), &r)
	if b["titulo"] != "Checklist do Volvo" || b["corpo"] != "2 itens e o hodômetro. Hoje tem a conferência da semana junto." || b["url"] != "/frota" {
		t.Fatalf("Barbara (posse do Volvo): %v", b)
	}
	if r["titulo"] != "Checklist do Fiat" {
		t.Fatalf("Raissa, achada pelo e-mail corporativo: %v", r)
	}
	if srv.Recebidos("marcus") != 0 {
		t.Fatal("o Marcus emprestou o Volvo e o Gol já tem ficha: nada para ele")
	}
	if err := pf.Rodar(context.Background()); err != nil || srv.Total() != 2 {
		t.Fatalf("rodar de novo na mesma manhã não reenvia: err=%v total=%d", err, srv.Total())
	}
}

func TestPushFrotaFimDeSemanaENinguemLigadoNaoEnviam(t *testing.T) {
	pf, srv, p := ambienteFrota(t)
	pushteste.Inscrever(t, p, "barbara", uBarbara)
	if err := pf.Rodar(context.Background()); err != nil || srv.Total() != 0 {
		t.Fatalf("frota nasce desligado: err=%v total=%d", err, srv.Total())
	}
	ligarAviso(t, p, "frota", uBarbara)
	pf.Agora = func() time.Time { return time.Date(2026, 10, 10, 10, 30, 0, 0, time.UTC) } // sábado
	if err := pf.Rodar(context.Background()); err != nil || srv.Total() != 0 {
		t.Fatalf("sábado não pede checklist: err=%v total=%d", err, srv.Total())
	}
}

func TestPushFrotaFalhasFicamVisiveis(t *testing.T) {
	pf, srv, p := ambienteFrota(t)
	pushteste.Inscrever(t, p, "e500", uBarbara)
	ligarAviso(t, p, "frota", uBarbara)
	if err := pf.Rodar(context.Background()); err == nil || !strings.Contains(err.Error(), "nenhum_push_entregue") {
		t.Fatalf("todas as entregas recusadas = erro da tarefa: %v", err)
	}
	pf.VAPID.Assunto = "x"
	if err := pf.Rodar(context.Background()); err == nil {
		t.Fatal("VAPID inválido falha antes de tudo")
	}
	p.Exec(context.Background(), `drop table frota_uso`)
	pf.VAPID = pushteste.VAPID(t)
	if err := pf.Rodar(context.Background()); err == nil || !strings.Contains(err.Error(), "quem está com cada carro") || srv.Recebidos("e500") != 1 {
		t.Fatalf("consulta que falha não manda nada pela metade: %v", err)
	}
	if tf := pf.Tarefa(); tf.Nome != "enviar-push-frota" || tf.Agenda != "30 10 * * 1-5" {
		t.Fatalf("%+v", tf)
	}
}
```

Crie `api/internal/frota/reserva_test.go`:

```go
package frota

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/auth"
	"github.com/rbv-co/social-dashboard/api/internal/webpush/pushteste"
)

const (
	uAprova = "eeeeeeee-0000-0000-0000-0000000000a1"
	uSuper  = "eeeeeeee-0000-0000-0000-0000000000a2"
	uNada   = "eeeeeeee-0000-0000-0000-0000000000a3"
	reqID   = "77777777-0000-0000-0000-000000000001"
)

type ambienteReserva struct {
	p      *pgxpool.Pool
	h      http.Handler
	srv    *pushteste.Servico
	tokens map[string]string
}

func montarReserva(t *testing.T) *ambienteReserva {
	t.Helper()
	pf, srv, p := ambienteFrota(t)
	ctx := context.Background()
	s := auth.NovoStore(p)
	tokens := map[string]string{}
	for _, u := range []struct {
		id, perm string
		super    bool
	}{
		{uAprova, `{"frota.aprovar":["ver"]}`, false}, {uSuper, `{}`, true}, {uNada, `{"frota":["ver"]}`, false},
		{uBarbara, `{}`, false},
	} {
		p.Exec(ctx, `insert into usuarios (id, email) values ($1::uuid, $1::text || '@x')`, u.id)
		if _, err := p.Exec(ctx, `insert into profiles (id, email, role, is_superadmin, permissions) values ($1::uuid, $1::text || '@x', 'viewer', $2, $3::jsonb)
			on conflict (id) do update set permissions = excluded.permissions, is_superadmin = excluded.is_superadmin`, u.id, u.super, u.perm); err != nil {
			t.Fatal(err)
		}
		tokens[u.id], _ = s.Criar(ctx, u.id, "painel", nil)
	}
	p.Exec(ctx, `insert into frota_requisicoes (id, veiculo_id, pessoa_id, pessoa_nome, destino, retirada_prevista, situacao, criada_por, motivo_decisao)
		values ($1::uuid, $2::uuid, $3::uuid, 'Barbara', 'Campinas', '2026-10-12T17:05:00Z', 'recusada', $4::uuid, 'carro na oficina')`,
		reqID, vVolvo, pBarbara, uAprova)
	r := chi.NewRouter()
	r.Group(func(r chi.Router) {
		r.Use(auth.Exigir(p, s))
		r.With(auth.ExigirPermissao("frota.aprovar", "ver")).Post("/avisar-decisao-de-reserva", (&Reserva{Pool: p, VAPID: pf.VAPID, HTTP: srv.HTTP}).ServeHTTP)
	})
	return &ambienteReserva{p: p, h: r, srv: srv, tokens: tokens}
}

func (a *ambienteReserva) post(token, corpo string) (int, map[string]any) {
	req := httptest.NewRequest("POST", "/avisar-decisao-de-reserva", strings.NewReader(corpo))
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	w := httptest.NewRecorder()
	a.h.ServeHTTP(w, req)
	var m map[string]any
	json.Unmarshal(w.Body.Bytes(), &m)
	return w.Code, m
}

func TestReservaPortao(t *testing.T) {
	a := montarReserva(t)
	corpo := `{"requisicaoId":"` + reqID + `"}`
	if c, _ := a.post("", corpo); c != 401 {
		t.Fatalf("sem sessão: %d", c)
	}
	if c, _ := a.post(a.tokens[uNada], corpo); c != 403 {
		t.Fatalf("sem frota.aprovar: %d", c)
	}
	if c, _ := a.post(a.tokens[uBarbara], corpo); c != 403 {
		t.Fatalf("quem pediu não decide: %d", c)
	}
	for _, u := range []string{uAprova, uSuper} {
		if c, m := a.post(a.tokens[u], corpo); c != 200 || m["ok"] != true {
			t.Fatalf("%s: %d %v", u, c, m)
		}
	}
}

func TestReservaAvisaQuemPediuUmaVezSo(t *testing.T) {
	a := montarReserva(t)
	ua := pushteste.Inscrever(t, a.p, "barbara", uBarbara)
	ligarAviso(t, a.p, "frota_reserva", uBarbara)
	corpo := `{"requisicaoId":"` + reqID + `"}`
	c, m := a.post(a.tokens[uAprova], corpo)
	if c != 200 || m["enviados"] != 1.0 || m["situacao"] != "recusada" {
		t.Fatalf("%d %v", c, m)
	}
	var aviso map[string]string
	json.Unmarshal(pushteste.Decifrar(t, a.srv.Ultimo(t, "barbara"), ua), &aviso)
	if aviso["titulo"] != "Reserva recusada" || aviso["corpo"] != "Volvo · 12/10 às 14:05 — carro na oficina" {
		t.Fatalf("o texto sai do que está gravado: %v", aviso)
	}
	// Clique duplo: a pessoa já foi avisada; não recebe de novo e o front continua vendo "avisei".
	if c, m := a.post(a.tokens[uAprova], corpo); c != 200 || m["enviados"] != 1.0 || a.srv.Total() != 1 {
		t.Fatalf("%d %v total=%d", c, m, a.srv.Total())
	}
}

func TestReservaRespostasDaEdge(t *testing.T) {
	a := montarReserva(t)
	tok := a.tokens[uAprova]
	if c, m := a.post(tok, `{}`); c != 400 || m["erro"] != "sem_requisicao" {
		t.Fatalf("%d %v", c, m)
	}
	if c, m := a.post(tok, `{"requisicaoId":"nao-e-uuid"}`); c != 404 || m["erro"] != "requisicao_nao_encontrada" {
		t.Fatalf("%d %v", c, m)
	}
	if c, m := a.post(tok, `{"requisicaoId":"`+reqID+`"}`); c != 200 || m["motivo"] != "sem_aparelho_ou_aviso_desligado" || m["enviados"] != 0.0 {
		t.Fatalf("Barbara sem aparelho: %d %v", c, m)
	}
	a.p.Exec(context.Background(), `update frota_requisicoes set pessoa_id = null, criada_por = $1::uuid`, uAprova)
	if c, m := a.post(tok, `{"requisicaoId":"`+reqID+`"}`); c != 200 || m["motivo"] != "decidiu_a_propria" {
		t.Fatalf("%d %v", c, m)
	}
	a.p.Exec(context.Background(), `update frota_requisicoes set criada_por = null`)
	if c, m := a.post(tok, `{"requisicaoId":"`+reqID+`"}`); c != 200 || m["motivo"] != "quem_pediu_nao_tem_login" || m["pessoa"] != "Barbara" {
		t.Fatalf("%d %v", c, m)
	}
	a.p.Exec(context.Background(), `update frota_requisicoes set situacao = 'pendente'`)
	if c, m := a.post(tok, `{"requisicaoId":"`+reqID+`"}`); c != 200 || m["motivo"] != "situacao_nao_avisavel" {
		t.Fatalf("%d %v", c, m)
	}
}
```

Acrescente ao fim de `api/internal/web/rotas_test.go`:

```go
// Plano 4: avisar-decisao-de-reserva pela montagem real. O corpo vazio dá 400 DEPOIS do portão: quem
// recebe 400 passou; quem recebe 403 parou nele (mata um portão montado com a permissão errada).
func TestAvisarDecisaoDeReservaPeloPortaoReal(t *testing.T) {
	p := testebanco.Novo(t)
	s := auth.NovoStore(p)
	h := Rotas(p, s, auth.NovoLimitador(), config.Config{})
	ctx := context.Background()
	toks := map[string]string{}
	for i, u := range []struct{ nome, perm string }{
		{"aprova", `{"frota.aprovar":["ver"]}`}, {"frota-ver", `{"frota":["ver"]}`}, {"aprova-editar", `{"frota.aprovar":["editar"]}`},
	} {
		id := fmt.Sprintf("22222222-2222-2222-2222-22222222222%d", i)
		p.Exec(ctx, `insert into usuarios (id, email) values ($1::uuid, $1::text || '@x')`, id)
		if _, err := p.Exec(ctx, `insert into profiles (id, email, permissions) values ($1::uuid, $1::text || '@x', $2::jsonb)`, id, u.perm); err != nil {
			t.Fatal(err)
		}
		toks[u.nome], _ = s.Criar(ctx, id, "painel", nil)
	}
	for nome, quer := range map[string]int{"aprova": 400, "frota-ver": 403, "aprova-editar": 403} {
		r := httptest.NewRequest("POST", "/avisar-decisao-de-reserva", strings.NewReader(`{}`))
		r.Header.Set("Authorization", "Bearer "+toks[nome])
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		if w.Code != quer {
			t.Errorf("%s = %d, esperava %d", nome, w.Code, quer)
		}
	}
}
```

Em `api/cmd/api/worker_test.go`, troque:

```go

}

func TestTarefasDeProducao
```

por:

```go

	// Task 4
	"enviar-push-frota": "30 10 * * 1-5",
}

func TestTarefasDeProducao
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `go test -count=1 ./cmd/api ./internal/frota ./internal/web`
Expected: FAIL. Primeiras falhas, como saíram no ensaio deste plano: `--- FAIL: TestTarefasDeProducao`, `--- FAIL: TestAvisarDecisaoDeReservaPeloPortaoReal`, `undefined: PushFrota`, `undefined: Config`, `undefined: cadenciasDoDia`, `undefined: montarAviso`

- [ ] **Step 3: Implementar**

Crie `api/internal/frota/regras.go`:

```go
// Package frota: o aviso do checklist da manhã e o aviso da decisão de reserva (push).
package frota

import (
	"fmt"
	"regexp"
	"slices"
	"strings"
	"time"
	_ "time/tzdata" // America/Sao_Paulo sem depender do zoneinfo do contêiner

	"github.com/rbv-co/social-dashboard/api/internal/texto"
)

var saoPaulo = func() *time.Location {
	l, err := time.LoadLocation("America/Sao_Paulo")
	if err != nil {
		panic(err)
	}
	return l
}()

// Config é a linha de frota_checklist_config.
type Config struct{ DiaSemanal, SemanaMensal, DiaMensal int }

func dia(iso string) time.Time { t, _ := time.Parse("2006-01-02", iso); return t }

// diaDaSemana (checklist.js): 1 = segunda … 7 = domingo.
func diaDaSemana(iso string) int {
	n := int(dia(iso).Weekday())
	if n == 0 {
		return 7
	}
	return n
}

func diasEntre(a, b string) int { return int(dia(b).Sub(dia(a)).Hours() / 24) }

func ehDiaDoMensal(iso string, c Config) bool {
	return diaDaSemana(iso) == c.DiaMensal && (dia(iso).Day()-1)/7+1 == c.SemanaMensal
}

// cadenciasDoDia (checklist.js, sem `pegandoAgora`: o robô da manhã não pega carro). Nunca feito
// NÃO é atrasado; fim de semana não pede nada.
func cadenciasDoDia(hoje string, c Config, ultimaSemanal, ultimaMensal string) []string {
	if diaDaSemana(hoje) > 5 {
		return nil
	}
	out := []string{"diario"}
	if diaDaSemana(hoje) == c.DiaSemanal || (ultimaSemanal != "" && diasEntre(ultimaSemanal, hoje) > 7) {
		out = append(out, "semanal")
	}
	if ehDiaDoMensal(hoje, c) || (ultimaMensal != "" && diasEntre(ultimaMensal, hoje) > 31) {
		out = append(out, "mensal")
	}
	return out
}

// Item é uma linha de frota_checklist_itens.
type Item struct {
	Cadencia string
	Ordem    int
	Ativo    bool
}

// itensDaFicha: os itens ativos das cadências pedidas, na ordem do gestor.
func itensDaFicha(itens []Item, cadencias []string) []Item {
	var out []Item
	for _, i := range itens {
		if i.Ativo && slices.Contains(cadencias, i.Cadencia) {
			out = append(out, i)
		}
	}
	slices.SortStableFunc(out, func(a, b Item) int { return a.Ordem - b.Ordem })
	return out
}

// montarAviso (aviso-de-checklist.js): o tamanho da tarefa, e por que hoje é mais longo.
func montarAviso(veiculo string, itens int, cadencias []string) (titulo, corpo string) {
	quantos := fmt.Sprintf("%d itens", itens)
	if itens == 1 {
		quantos = "1 item"
	}
	extra := ""
	switch {
	case slices.Contains(cadencias, "mensal"):
		extra = " Hoje tem a conferência do mês junto."
	case slices.Contains(cadencias, "semanal"):
		extra = " Hoje tem a conferência da semana junto."
	}
	return "Checklist do " + veiculo, quantos + " e o hodômetro." + extra
}

// Pessoa é uma linha de acessos_pessoas; Usuario, de profiles.
type Pessoa struct{ ID, Nome, ProfileID, EmailCorporativo string }
type Usuario struct{ ID, Email string }

func chaveDeEmail(s string) string { return strings.ToLower(strings.TrimSpace(s)) }

// loginDaPessoa (quem-loga.js): o elo profile_id (se aponta para usuário que existe), senão o e-mail
// corporativo. Vazio = sem login (resposta legítima).
func loginDaPessoa(p *Pessoa, usuarios []Usuario) string {
	if p == nil {
		return ""
	}
	if p.ProfileID != "" {
		for _, u := range usuarios {
			if u.ID == p.ProfileID {
				return u.ID
			}
		}
	}
	email := chaveDeEmail(p.EmailCorporativo)
	if email == "" {
		return ""
	}
	for _, u := range usuarios {
		if chaveDeEmail(u.Email) == email {
			return u.ID
		}
	}
	return ""
}

// ── aviso da decisão de reserva (aviso-de-reserva.js) ────────────────────────────────────────────

// Requisicao é o pedaço de frota_requisicoes que o aviso lê.
type Requisicao struct {
	ID, VeiculoID, Situacao                 string
	RetiradaPrevista                        *time.Time
	Destino, MotivoDecisao, EncerradaMotivo *string
	PessoaID, PessoaNome, CriadaPor         *string
}

// Aviso é o push (as chaves que o service worker da central lê para este tipo).
type Aviso struct {
	Titulo string `json:"titulo"`
	Corpo  string `json:"corpo"`
	URL    string `json:"url"`
}

var reEspacos = regexp.MustCompile(texto.EspacoJS + `+`)

// encurtar: um parágrafo no push é cortado pelo celular no meio da frase; corta aqui, com reticências.
func encurtar(p *string) string {
	if p == nil {
		return ""
	}
	t := strings.Trim(reEspacos.ReplaceAllString(*p, " "), " ") // = trim() + replace(/\s+/g, ' ') do JS
	if texto.CortarUTF16(t, 120) == t {
		return t
	}
	return strings.TrimRight(texto.CortarUTF16(t, 119), " ") + "…"
}

// montarAvisoDeReserva: o aviso de uma reserva DECIDIDA; ok=false para o que não é decisão.
func montarAvisoDeReserva(r Requisicao, veiculo string) (Aviso, bool) {
	if veiculo == "" {
		veiculo = "o veículo"
	}
	partes := []string{veiculo}
	if r.RetiradaPrevista != nil {
		partes = append(partes, r.RetiradaPrevista.In(saoPaulo).Format("02/01 às 15:04"))
	}
	junto := func() string { return strings.Join(partes, " · ") }
	switch r.Situacao {
	case "aprovada":
		if r.Destino != nil && *r.Destino != "" { // "  " conta (truthy no JS): entra aparado
			partes = append(partes, strings.TrimSpace(*r.Destino))
		}
		return Aviso{"Reserva aprovada", junto(), "/frota"}, true
	case "recusada":
		if m := encurtar(r.MotivoDecisao); m != "" {
			return Aviso{"Reserva recusada", junto() + " — " + m, "/frota"}, true
		}
		return Aviso{"Reserva recusada", junto() + " — sem motivo escrito. Fale com quem administra a Frota.", "/frota"}, true
	case "revogada", "cancelada":
		titulo := "A sua reserva foi cancelada"
		if r.Situacao == "revogada" {
			titulo = "A sua reserva foi encerrada"
		}
		if m := encurtar(r.EncerradaMotivo); m != "" {
			return Aviso{titulo, junto() + " — " + m, "/frota"}, true
		}
		return Aviso{titulo, junto() + " — o carro não está mais reservado para você.", "/frota"}, true
	}
	return Aviso{}, false
}
```

Crie `api/internal/frota/push_frota.go`:

```go
package frota

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"slices"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/webpush"
	"github.com/rbv-co/social-dashboard/api/internal/worker"
)

// PushFrota porta supabase/functions/enviar-push-frota (cron 30 10 * * 1-5, robô 'enviar-push-frota'):
// avisa, no celular, quem ainda não fez o checklist do carro de hoje. Quem responde pelo carro é
// quem está com ele (posse aberta em frota_uso); só na falta dela, o dono fixo (D9b).
type PushFrota struct {
	Pool  *pgxpool.Pool
	VAPID webpush.VAPID
	HTTP  *http.Client     // serviço de push; nil = o cliente seguro do webpush
	Agora func() time.Time // nil = time.Now
}

func (pf *PushFrota) Tarefa() worker.Tarefa {
	return worker.Tarefa{Nome: "enviar-push-frota", Agenda: "30 10 * * 1-5", Limite: 2 * time.Minute, Executar: pf.Rodar}
}

type veiculo struct{ id, nome, pessoaID string }

func (pf *PushFrota) Rodar(ctx context.Context) error {
	if _, err := webpush.ValidarVAPID(pf.VAPID); err != nil {
		return err
	}
	agora := time.Now
	if pf.Agora != nil {
		agora = pf.Agora
	}
	hojeT := agora().In(saoPaulo)
	hoje := hojeT.Format("2006-01-02")
	desde := hojeT.AddDate(0, 0, -120).Format("2006-01-02") // acha a última semanal/mensal de cada carro

	// Toda consulta de que a decisão depende é conferida: falhou, a tarefa falha (nada sai com dado pela metade).
	var cfg Config
	err := pf.Pool.QueryRow(ctx, `select dia_semanal, semana_mensal, dia_mensal from frota_checklist_config limit 1`).
		Scan(&cfg.DiaSemanal, &cfg.SemanaMensal, &cfg.DiaMensal)
	semConfig := errors.Is(err, pgx.ErrNoRows)
	if err != nil && !semConfig {
		return fmt.Errorf("configuração: %w", err)
	}
	linhas, err := pf.Pool.Query(ctx, `select cadencia, ordem, ativo from frota_checklist_itens order by ordem`)
	if err != nil {
		return fmt.Errorf("itens do checklist: %w", err)
	}
	itens, err := pgx.CollectRows(linhas, func(r pgx.CollectableRow) (i Item, err error) { return i, r.Scan(&i.Cadencia, &i.Ordem, &i.Ativo) })
	if err != nil {
		return fmt.Errorf("itens do checklist: %w", err)
	}
	if semConfig || len(itens) == 0 {
		slog.Info("push da frota: sem lista ou sem configuração — não envio com dado incompleto")
		return nil
	}
	inscritos, err := webpush.Destinatarios(ctx, pf.Pool, "frota", "")
	if err != nil {
		return fmt.Errorf("aparelhos inscritos: %w", err)
	}
	if len(inscritos) == 0 {
		slog.Info("push da frota: ninguém ligou este aviso ainda")
		return nil
	}
	linhas, err = pf.Pool.Query(ctx, `select v.id::text, v.nome,
			coalesce((select u.pessoa_id::text from frota_uso u
			   where u.veiculo_id = v.id and u.tipo = 'posse' and u.volta_em is null and u.pessoa_id is not null limit 1), v.pessoa_id::text)
		  from frota_veiculos v
		 where v.pessoa_id is not null and v.situacao = 'ativo'
		   and not exists (select 1 from frota_checklist f where f.veiculo_id = v.id and f.feita_em = $1::date)
		 order by v.nome`, hoje)
	if err != nil {
		return fmt.Errorf("quem está com cada carro: %w", err)
	}
	devendo, err := pgx.CollectRows(linhas, func(r pgx.CollectableRow) (v veiculo, err error) { return v, r.Scan(&v.id, &v.nome, &v.pessoaID) })
	if err != nil {
		return fmt.Errorf("quem está com cada carro: %w", err)
	}
	pessoas, err := carregarPessoas(ctx, pf.Pool)
	if err != nil {
		return err
	}
	usuarios, err := carregarUsuarios(ctx, pf.Pool)
	if err != nil {
		return err
	}
	var total webpush.Resultado
	var semAviso []string
	for _, v := range devendo {
		var us, um *string
		if err := pf.Pool.QueryRow(ctx, `select
			  max(feita_em) filter (where 'semanal' = any(cadencias))::text,
			  max(feita_em) filter (where 'mensal' = any(cadencias))::text
			from frota_checklist where veiculo_id = $1::uuid and feita_em >= $2::date`, v.id, desde).Scan(&us, &um); err != nil {
			return fmt.Errorf("fichas de checklist: %w", err)
		}
		cad := cadenciasDoDia(hoje, cfg, deref(us), deref(um))
		if len(cad) == 0 {
			continue // fim de semana
		}
		pessoa := pessoas[v.pessoaID]
		uid := loginDaPessoa(pessoa, usuarios)
		if uid == "" {
			if pessoa != nil && !slices.Contains(semAviso, pessoa.Nome) {
				semAviso = append(semAviso, pessoa.Nome)
			}
			continue
		}
		var dela []webpush.Destino
		for _, s := range inscritos {
			if s.UserID == uid {
				dela = append(dela, s)
			}
		}
		if len(dela) == 0 {
			continue
		}
		titulo, corpo := montarAviso(v.nome, len(itensDaFicha(itens, cad)), cad)
		carga, _ := json.Marshal(Aviso{titulo, corpo, "/frota"})
		r, err := webpush.Entregar(ctx, pf.Pool, pf.HTTP, dela, carga, pf.VAPID, "enviar-push-frota:"+hoje+":"+v.id)
		if err != nil {
			return err
		}
		total.Enviados += r.Enviados
		total.Podados += r.Podados
		total.Repetidos += r.Repetidos
		total.Falhas += r.Falhas
	}
	// Quem devia hoje e não tem login sai NOMEADO no log (o defeito antigo era pular calado).
	slog.Info("push da frota", "hoje", hoje, "enviados", total.Enviados, "podados", total.Podados,
		"repetidos", total.Repetidos, "falhas", total.Falhas, "sem_aviso", semAviso)
	if total.Enviados == 0 && total.Falhas > 0 {
		return fmt.Errorf("nenhum_push_entregue: %d falhas", total.Falhas)
	}
	return nil
}

func deref(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

func carregarPessoas(ctx context.Context, p *pgxpool.Pool) (map[string]*Pessoa, error) {
	linhas, err := p.Query(ctx, `select id::text, nome, coalesce(profile_id::text, ''), coalesce(email_corporativo, '') from acessos_pessoas`)
	if err != nil {
		return nil, fmt.Errorf("pessoas: %w", err)
	}
	ps, err := pgx.CollectRows(linhas, func(r pgx.CollectableRow) (x Pessoa, err error) {
		return x, r.Scan(&x.ID, &x.Nome, &x.ProfileID, &x.EmailCorporativo)
	})
	if err != nil {
		return nil, fmt.Errorf("pessoas: %w", err)
	}
	m := map[string]*Pessoa{}
	for i := range ps {
		m[ps[i].ID] = &ps[i]
	}
	return m, nil
}

func carregarUsuarios(ctx context.Context, p *pgxpool.Pool) ([]Usuario, error) {
	linhas, err := p.Query(ctx, `select id::text, coalesce(email, '') from profiles`)
	if err != nil {
		return nil, fmt.Errorf("usuários do app: %w", err)
	}
	us, err := pgx.CollectRows(linhas, func(r pgx.CollectableRow) (u Usuario, err error) { return u, r.Scan(&u.ID, &u.Email) })
	if err != nil {
		return nil, fmt.Errorf("usuários do app: %w", err)
	}
	return us, nil
}
```

Crie `api/internal/frota/reserva.go`:

```go
package frota

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/auth"
	"github.com/rbv-co/social-dashboard/api/internal/webpush"
)

// Reserva é POST /avisar-decisao-de-reserva (porta da edge de mesmo nome; o front chama depois de
// aprovar/recusar/cancelar/revogar). DEVE vir atrás de auth.Exigir + auth.ExigirPermissao(
// "frota.aprovar", "ver") — o mesmo portão da edge (superadmin ou permissions['frota.aprovar']
// contém 'ver'). Quem chama manda SÓ o id: o texto sai do que está gravado (senão seria um jeito de
// mandar push arbitrário para o celular de qualquer pessoa).
type Reserva struct {
	Pool  *pgxpool.Pool
	VAPID webpush.VAPID
	HTTP  *http.Client // serviço de push; nil = o cliente seguro do webpush
}

func responder(w http.ResponseWriter, status int, corpo any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(corpo)
}

type obj = map[string]any

func (rs *Reserva) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	ator := auth.AtorDoContexto(ctx)
	var in struct {
		RequisicaoID any `json:"requisicaoId"`
	}
	json.NewDecoder(http.MaxBytesReader(w, r.Body, 8<<10)).Decode(&in)
	id, _ := in.RequisicaoID.(string)
	if id == "" {
		responder(w, http.StatusBadRequest, obj{"ok": false, "erro": "sem_requisicao"})
		return
	}
	falhou := func(onde string, err error) {
		slog.Error("avisar-decisao-de-reserva", "onde", onde, "erro", err)
		responder(w, http.StatusInternalServerError, obj{"ok": false, "erro": "erro_interno"})
	}
	var req Requisicao
	var veiculo *string
	err := rs.Pool.QueryRow(ctx, `select r.id::text, r.situacao, r.retirada_prevista, r.destino, r.motivo_decisao,
			r.encerrada_motivo, r.pessoa_id::text, r.pessoa_nome, r.criada_por::text, v.nome
		  from frota_requisicoes r left join frota_veiculos v on v.id = r.veiculo_id
		 where r.id::text = $1::text`, id).
		Scan(&req.ID, &req.Situacao, &req.RetiradaPrevista, &req.Destino, &req.MotivoDecisao, &req.EncerradaMotivo,
			&req.PessoaID, &req.PessoaNome, &req.CriadaPor, &veiculo)
	if errors.Is(err, pgx.ErrNoRows) {
		responder(w, http.StatusNotFound, obj{"ok": false, "erro": "requisicao_nao_encontrada"})
		return
	}
	if err != nil {
		falhou("requisição", err)
		return
	}
	aviso, ok := montarAvisoDeReserva(req, deref(veiculo))
	if !ok {
		responder(w, http.StatusOK, obj{"ok": true, "enviados": 0, "motivo": "situacao_nao_avisavel", "situacao": req.Situacao})
		return
	}
	// Quem PEDIU: pessoa_id na frente; criada_por como resgate (pedido aberto pela Gestão em nome de outro).
	destino := ""
	if req.PessoaID != nil {
		pessoas, err := carregarPessoas(ctx, rs.Pool)
		if err != nil {
			falhou("pessoas", err)
			return
		}
		usuarios, err := carregarUsuarios(ctx, rs.Pool)
		if err != nil {
			falhou("usuários", err)
			return
		}
		destino = loginDaPessoa(pessoas[*req.PessoaID], usuarios)
	}
	if destino == "" {
		destino = deref(req.CriadaPor)
	}
	if destino == "" {
		responder(w, http.StatusOK, obj{"ok": true, "enviados": 0, "motivo": "quem_pediu_nao_tem_login", "pessoa": req.PessoaNome})
		return
	}
	if destino == ator.ID {
		responder(w, http.StatusOK, obj{"ok": true, "enviados": 0, "motivo": "decidiu_a_propria"})
		return
	}
	inscritos, err := webpush.Destinatarios(ctx, rs.Pool, "frota_reserva", destino)
	if err != nil {
		falhou("inscrições", err)
		return
	}
	if len(inscritos) == 0 {
		responder(w, http.StatusOK, obj{"ok": true, "enviados": 0, "motivo": "sem_aparelho_ou_aviso_desligado"})
		return
	}
	if _, err := webpush.ValidarVAPID(rs.VAPID); err != nil {
		slog.Error("avisar-decisao-de-reserva: VAPID", "erro", err) // o erro nunca traz as chaves
		responder(w, http.StatusInternalServerError, obj{"ok": false, "erro": "vapid_nao_configurado"})
		return
	}
	carga, _ := json.Marshal(aviso)
	// A mesma decisão (id + situação) não vai duas vezes ao mesmo aparelho (clique duplo, nova tentativa).
	res, err := webpush.Entregar(ctx, rs.Pool, rs.HTTP, inscritos, carga, rs.VAPID, "avisar-decisao-de-reserva:"+req.ID+":"+req.Situacao)
	if err != nil {
		falhou("entrega", err)
		return
	}
	// Já entregue antes conta como entregue: o front só precisa saber se a pessoa foi avisada.
	responder(w, http.StatusOK, obj{"ok": true, "enviados": res.Enviados + res.Repetidos, "podados": res.Podados, "situacao": req.Situacao})
}
```

Em `api/internal/web/rotas.go`, troque:

```go
		r.With(auth.ExigirModulo("social"), comPrazo(PrazoCollabs)).Post("/contar-collabs", av.ContarCollabs)
	})
```

por:

```go
		r.With(auth.ExigirModulo("social"), comPrazo(PrazoCollabs)).Post("/contar-collabs", av.ContarCollabs)
		// Plano 4: o mesmo portão da edge (superadmin ou permissions['frota.aprovar'] com 'ver').
		r.With(auth.ExigirPermissao("frota.aprovar", "ver")).Post("/avisar-decisao-de-reserva",
			(&frota.Reserva{Pool: p, VAPID: webpush.VAPID{Publica: cfg.VAPIDPublica, Privada: cfg.VAPIDPrivada, Assunto: cfg.VAPIDAssunto}}).ServeHTTP)
	})
```

Em `api/internal/web/rotas.go`, troque:

```go
	"github.com/rbv-co/social-dashboard/api/internal/core"
```

por:

```go
	"github.com/rbv-co/social-dashboard/api/internal/core"
	"github.com/rbv-co/social-dashboard/api/internal/frota"
```

Em `api/internal/web/rotas.go`, troque:

```go
	"github.com/rbv-co/social-dashboard/api/internal/webhooks"
```

por:

```go
	"github.com/rbv-co/social-dashboard/api/internal/webhooks"
	"github.com/rbv-co/social-dashboard/api/internal/webpush"
```

Em `api/cmd/api/tarefas.go`, troque:

```go
	"github.com/rbv-co/social-dashboard/api/internal/fabrica"
```

por:

```go
	"github.com/rbv-co/social-dashboard/api/internal/fabrica"
	"github.com/rbv-co/social-dashboard/api/internal/frota"
```

Em `api/cmd/api/tarefas.go`, troque:

```go
	return ts
}
```

por:

```go
	ts = append(ts, (&frota.PushFrota{Pool: p, VAPID: vapid(cfg)}).Tarefa())
	return ts
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `gofmt -l . && go vet ./... && go test -race -count=1 ./internal/frota/ ./internal/web/ ./cmd/api/ -v 2>&1 | grep -E -- '^(ok|FAIL|--- FAIL|--- SKIP)'`
Expected: `gofmt` não lista nada; só linhas `ok`, nenhuma `FAIL` nem `--- SKIP`.

- [ ] **Step 5: Commit**

```bash
git add api/internal/frota/regras.go api/internal/frota/regras_test.go api/internal/frota/push_frota.go api/internal/frota/push_frota_test.go api/internal/frota/reserva.go api/internal/frota/reserva_test.go api/internal/web/rotas.go api/internal/web/rotas_test.go api/cmd/api/tarefas.go api/cmd/api/worker_test.go
git commit -m "feat(api): enviar-push-frota no worker e POST /avisar-decisao-de-reserva

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Conteúdo: `conteudo-hora-h` e `conteudo-espelho`

**Revisor:** padrão.

- `conteudo-hora-h` (`*/5 * * * *`): porta `supabase/functions/conteudo-hora-h/index.ts`. Confere a VAPID ANTES de reivindicar (`conteudo_reivindicar_hora_h()`, `UPDATE ... RETURNING`: duas execuções nunca avisam a mesma peça, e reivindicar sem conseguir avisar queimaria a peça). Avisa quem pode publicar (responsável, ou os admins quando não há), grava a trilha em `conteudo_eventos` com os textos da edge. A publicação automática da edge NÃO é portada (desligada: `ESCOPOS_DE_PUBLICACAO_LIBERADOS = false`).
- `conteudo-espelho` (`*/30 * * * *`, 10 min): porta `supabase/functions/conteudo-espelho/index.ts` + `_shared/casar-publicacao.js` + `_shared/cadencia-de-medicao.js`: casa peças sem vínculo com o post real de `/{ig}/media` (semelhança de legenda normalizada em unidades UTF-16, `\p{Extended_Pictographic}` com a tabela do V8 em `pictografico.go`, janela de horário) e mede as vinculadas na cadência da edge; a peça casada agora é medida na mesma rodada, como na edge. Data de medição em UTC (como a edge). Falha da Meta numa peça vira erro da tarefa.

**Files:**
- Create: `api/internal/conteudo/pictografico.go`
- Create: `api/internal/conteudo/casar.go`
- Test: `api/internal/conteudo/casar_test.go`
- Create: `api/internal/conteudo/hora_h.go`
- Create: `api/internal/conteudo/espelho.go`
- Test: `api/internal/conteudo/conteudo_test.go`
- Modify: `api/cmd/api/tarefas.go`
- Test (modify): `api/cmd/api/worker_test.go`

**Interfaces:**
- Consumes: `meta.GET` (a Graph pelo core), `webpush.Destinatarios`, `webpush.Entregar`, `pushteste.*` e `texto.EspacoJS` (Task 3); `worker.Tarefa` (Task 1).
- Produces:
  - `type conteudo.HoraH struct { Pool; VAPID webpush.VAPID; HTTP *http.Client; Agora func() time.Time }` e `type conteudo.Espelho struct { Pool; Core *core.Cliente; Agora func() time.Time }`, ambos com `Rodar` e `Tarefa`.
  - `conteudo.Midia`, `conteudo.Peca`, `conteudo.Achado` (entrada e saída do `casar`).

- [ ] **Step 1: Escrever os testes que falham**

Crie `api/internal/conteudo/casar_test.go`:

```go
package conteudo

import (
	"math"
	"testing"
	"time"
)

// Esperados gerados com o próprio _shared/casar-publicacao.js (Node 22).
func TestSemelhancaDeTextoComoAEdge(t *testing.T) {
	for _, c := range []struct {
		a, b string
		quer float64
	}{
		{"Bolsa de couro preta #vessel @loja 😍✨", "bolsa de couro preta", 1},
		{"bolsa de couro preta", "receita de bolo", 0.19393939393939397},
		{"Nova coleção de inverno chegou", "Nova coleção de inverno chegou! Corre pro site 🛍️", 1},
		{"𝐁𝐨𝐥𝐬𝐚 𝐩𝐫𝐞𝐭𝐚 nova", "𝐁𝐨𝐥𝐬𝐚 𝐩𝐫𝐞𝐭𝐚 linda", 0.7234042553191489},
		{"Ação de Natal: até 30% OFF", "acao de natal ate 30 off", 0.7454545454545454},
		{"", "qualquer", 0},
		{"Lançamento da semana — carteira café", "Lancamento semana carteira cafe ☕", 0.9703703703703703},
	} {
		if got := semelhancaDeTexto(c.a, c.b); math.Abs(got-c.quer) > 1e-12 {
			t.Errorf("%q × %q = %v, esperava %v", c.a, c.b, got, c.quer)
		}
	}
}

func hora(s string) *time.Time { t, _ := time.Parse(time.RFC3339, s); return &t }

func TestCasarComoAEdge(t *testing.T) {
	pecas := []Peca{
		{ID: "p1", Formato: "feed", Legenda: "Bolsa de couro preta", Hashtags: "#vessel", PublicarEm: hora("2026-10-09T14:00:00Z")},
		{ID: "p2", Formato: "reels", Legenda: "Bastidores da sessão de fotos", PublicarEm: hora("2026-10-09T18:00:00Z")},
		{ID: "p3", Formato: "carrossel", Legenda: "Três jeitos de usar a bolsa", PublicarEm: hora("2026-10-09T20:00:00Z")},
	}
	midias := []Midia{
		{ID: "m1", Caption: "Bolsa de couro preta #vessel", MediaType: "IMAGE", MediaProductType: "FEED", Timestamp: "2026-10-09T14:07:00+0000", Permalink: "https://ig/p/m1", MediaURL: "https://cdn/m1.jpg"},
		{ID: "m2", Caption: "Bastidores da sessão de fotos 🎬", MediaType: "VIDEO", MediaProductType: "REELS", Timestamp: "2026-10-09T17:30:00+0000", Permalink: "https://ig/p/m2", ThumbnailURL: "https://cdn/m2t.jpg"},
		{ID: "m3", Caption: "Bastidores da sessão", MediaType: "VIDEO", MediaProductType: "REELS", Timestamp: "2026-10-09T18:20:00+0000", Permalink: "https://ig/p/m3"},
		{ID: "m4", Caption: "Três jeitos de usar", MediaType: "CAROUSEL_ALBUM", MediaProductType: "FEED", Timestamp: "2026-10-10T19:00:00+0000"},
		{ID: "m5", Caption: "Bolsa de couro preta #vessel", MediaType: "IMAGE", MediaProductType: "STORY", Timestamp: "2026-10-09T14:01:00+0000"},
	}
	got := casar(pecas, midias, map[string]bool{})
	quer := []struct {
		peca, midia, situacao, motivo string
		pont                          float64
	}{
		{"p1", "m1", "automatico", "Legenda 100% parecida, publicado 7 min depois do combinado.", 0.9985},
		{"p2", "m3", "sugerido", "Legenda 100% parecida, publicado 20 min depois do combinado. Há outro post parecido no mesmo período.", 0.9958},
		{"p3", "m4", "sugerido", "Legenda 100% parecida, publicado 1380 min depois do combinado.", 0.7125},
	}
	if len(got) != len(quer) {
		t.Fatalf("achados = %+v", got)
	}
	for i, q := range quer {
		g := got[i]
		if g.PecaID != q.peca || g.IGMediaID != q.midia || g.Situacao != q.situacao || g.Motivo != q.motivo || g.Pontuacao != q.pont {
			t.Errorf("achado %d = %+v", i, g)
		}
	}
	if *got[0].IGThumb != "https://cdn/m1.jpg" || got[2].IGPermalink != nil || got[1].IGThumb != nil {
		t.Errorf("thumb cai no media_url; permalink ausente = nulo: %+v", got)
	}
	if again := casar(pecas, midias, map[string]bool{"m1": true}); len(again) != 2 || again[0].PecaID != "p2" {
		t.Fatalf("post já usado não é oferecido de novo: %+v", again)
	}
}
```

Crie `api/internal/conteudo/conteudo_test.go`:

```go
package conteudo

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/core"
	"github.com/rbv-co/social-dashboard/api/internal/testebanco"
	"github.com/rbv-co/social-dashboard/api/internal/webpush/pushteste"
)

// Tabelas da Central de Conteúdo como em produção (migrations 2026-07-29-conteudo-01, 2026-07-31-conteudo-07,
// 2026-08-01-conteudo-16) e a função de reivindicação como está em pg_proc (levantamento 02-funções.csv).
const tabelasConteudo = `
create table accounts (id uuid primary key, name text, instagram_id text, access_token text);
create table conteudo_pecas (id uuid primary key default gen_random_uuid(), account_id uuid not null references accounts(id),
  titulo text not null, formato text not null, status text not null default 'rascunho', legenda text not null default '',
  hashtags text not null default '', publicar_em timestamptz, publicado_em timestamptz, avisado_em timestamptz,
  ig_media_id text, ig_permalink text, responsavel uuid);
create table conteudo_eventos (id bigserial primary key, peca_id uuid not null references conteudo_pecas(id), de text, para text,
  acao text not null, detalhe text, quem uuid, quando timestamptz not null default now());
create table conteudo_casamentos (id uuid primary key default gen_random_uuid(), peca_id uuid not null references conteudo_pecas(id),
  ig_media_id text not null, ig_permalink text, ig_timestamp timestamptz, ig_caption text, ig_thumb text, pontuacao numeric not null,
  motivo text, situacao text not null default 'sugerido', unique (peca_id, ig_media_id));
create table conteudo_metricas (peca_id uuid not null references conteudo_pecas(id), capturado_em date not null, curtidas int,
  comentarios int, alcance int, salvamentos int, compartilhamentos int, visualizacoes int, bruto jsonb, primary key (peca_id, capturado_em));
create function conteudo_reivindicar_hora_h() returns setof conteudo_pecas language sql as $$
  update conteudo_pecas set avisado_em = now() where status = 'agendada' and avisado_em is null and publicar_em <= now() returning * $$;
insert into accounts values ('aaaaaaaa-0000-0000-0000-000000000001', 'Vessel', '1784', null);`

const contaVessel = "aaaaaaaa-0000-0000-0000-000000000001"

func bancoConteudo(t *testing.T) *pgxpool.Pool {
	t.Helper()
	p := testebanco.Novo(t)
	if _, err := p.Exec(context.Background(), tabelasConteudo+pushteste.Tabelas); err != nil {
		t.Fatal(err)
	}
	return p
}

func peca(t *testing.T, p *pgxpool.Pool, titulo, formato, status string, publicarEm time.Time, responsavel string) string {
	t.Helper()
	var id string
	if err := p.QueryRow(context.Background(), `insert into conteudo_pecas (account_id, titulo, formato, status, legenda, publicar_em, responsavel)
		values ($1::uuid, $2, $3, $4, $2, $5, nullif($6::text, '')::uuid) returning id::text`, contaVessel, titulo, formato, status, publicarEm, responsavel).Scan(&id); err != nil {
		t.Fatal(err)
	}
	return id
}

func eventos(t *testing.T, p *pgxpool.Pool, id string) []string {
	t.Helper()
	linhas, _ := p.Query(context.Background(), `select acao || ': ' || coalesce(detalhe, '') from conteudo_eventos where peca_id = $1::uuid order by id`, id)
	defer linhas.Close()
	var out []string
	for linhas.Next() {
		var s string
		linhas.Scan(&s)
		out = append(out, s)
	}
	return out
}

const (
	uConteudo = "cccccccc-0000-0000-0000-0000000000c1"
	uOutro    = "cccccccc-0000-0000-0000-0000000000c2"
	uSemAcess = "cccccccc-0000-0000-0000-0000000000c3"
)

func TestHoraHAvisaUmaVezSoEQuemPode(t *testing.T) {
	p := bancoConteudo(t)
	ctx := context.Background()
	p.Exec(ctx, `insert into profiles (id, email, role, features) values
		('`+uConteudo+`', 'c@x', 'viewer', '{conteudo}'), ('`+uOutro+`', 'o@x', 'admin', '{}'), ('`+uSemAcess+`', 's@x', 'viewer', '{banco}')`)
	srv := pushteste.Novo(t)
	ua := pushteste.Inscrever(t, p, "conteudo", uConteudo)
	pushteste.Inscrever(t, p, "outro", uOutro)
	pushteste.Inscrever(t, p, "sem-acesso", uSemAcess)
	p.Exec(ctx, `insert into push_preferencias (user_id, tipo, ativo) values ('`+uConteudo+`', 'conteudo', true), ('`+uOutro+`', 'conteudo', true), ('`+uSemAcess+`', 'conteudo', true)`)
	agora := time.Now()
	naHora := peca(t, p, " Bolsa nova ", "carrossel", "agendada", agora.Add(-time.Minute), "")
	velha := peca(t, p, "Velha", "feed", "agendada", agora.Add(-13*time.Hour), "")
	doDono := peca(t, p, "Do dono", "reels", "agendada", agora.Add(-2*time.Minute), uConteudo)
	futura := peca(t, p, "Futura", "feed", "agendada", agora.Add(time.Hour), "")
	h := &HoraH{Pool: p, VAPID: pushteste.VAPID(t), HTTP: srv.HTTP}
	if err := h.Rodar(ctx); err != nil {
		t.Fatal(err)
	}
	if srv.Recebidos("conteudo") != 2 || srv.Recebidos("outro") != 1 || srv.Recebidos("sem-acesso") != 0 {
		t.Fatalf("conteudo=%d outro=%d sem-acesso=%d", srv.Recebidos("conteudo"), srv.Recebidos("outro"), srv.Recebidos("sem-acesso"))
	}
	var aviso map[string]string
	json.Unmarshal(pushteste.Decifrar(t, srv.Ultimo(t, "conteudo"), ua), &aviso)
	if !strings.HasPrefix(aviso["title"], "Hora de publicar: ") || !strings.HasPrefix(aviso["tag"], "conteudo-") {
		t.Fatalf("aviso = %v", aviso)
	}
	if ev := eventos(t, p, naHora); len(ev) != 1 || ev[0] != "avisou: Aviso enviado para 2 aparelho(s)." {
		t.Fatalf("na hora: %v", ev)
	}
	if ev := eventos(t, p, velha); len(ev) != 1 || !strings.Contains(ev[0], "Passou mais de 12 horas") {
		t.Fatalf("velha: %v", ev)
	}
	if ev := eventos(t, p, doDono); len(ev) != 1 || ev[0] != "avisou: Aviso enviado para 1 aparelho(s)." {
		t.Fatalf("com responsável, só ele: %v", ev)
	}
	if ev := eventos(t, p, futura); len(ev) != 0 {
		t.Fatalf("futura não é reivindicada: %v", ev)
	}
	total := srv.Total()
	if err := h.Rodar(ctx); err != nil || srv.Total() != total {
		t.Fatalf("rodar de novo não avisa de novo: err=%v total %d -> %d", err, total, srv.Total())
	}
}

func TestAvisoDePecaComoAEdge(t *testing.T) {
	var a map[string]string
	json.Unmarshal(avisoDePeca(pecaDaHora{id: "p1", titulo: "  ", formato: "x", conta: " Vessel "}), &a)
	if a["title"] != "Hora de publicar: Peça sem título" || a["body"] != "Publicação · Vessel · legenda pronta para copiar" ||
		a["tag"] != "conteudo-p1" || a["url"] != "/conteudo/peca/p1" {
		t.Fatalf("%v", a)
	}
	json.Unmarshal(avisoDePeca(pecaDaHora{id: "p2", titulo: "Look", formato: "stories"}), &a)
	if a["body"] != "Story · legenda pronta para copiar" {
		t.Fatalf("%v", a)
	}
}

func TestHoraHResponsavelDesligadoFicaNaTrilhaEVAPIDRuimNaoReivindica(t *testing.T) {
	p := bancoConteudo(t)
	ctx := context.Background()
	p.Exec(ctx, `insert into profiles (id, email, role, features) values ('`+uConteudo+`', 'c@x', 'viewer', '{conteudo}')`)
	id := peca(t, p, "Do dono", "feed", "agendada", time.Now().Add(-time.Minute), uConteudo)
	h := &HoraH{Pool: p, VAPID: pushteste.VAPID(t), HTTP: pushteste.Novo(t).HTTP}
	h.VAPID.Privada = ""
	if err := h.Rodar(ctx); err == nil {
		t.Fatal("VAPID inválido é erro")
	}
	var avisado bool
	p.QueryRow(ctx, `select avisado_em is not null from conteudo_pecas where id = $1::uuid`, id).Scan(&avisado)
	if avisado {
		t.Fatal("com VAPID errado nada pode ser reivindicado")
	}
	h.VAPID = pushteste.VAPID(t)
	if err := h.Rodar(ctx); err != nil {
		t.Fatal(err)
	}
	if ev := eventos(t, p, id); len(ev) != 1 || !strings.Contains(ev[0], "quem é responsável por esta peça está com o aviso de conteúdo desligado") {
		t.Fatalf("%v", ev)
	}
}

// ── espelho ──────────────────────────────────────────────────────────────────────────────────────

type graphFalsa struct {
	mu      sync.Mutex
	pedidos []core.PedidoMeta
	resp    func(core.PedidoMeta) (int, string)
}

// lista: cópia dos pedidos recebidos (sob a trava).
func (f *graphFalsa) lista() []core.PedidoMeta {
	f.mu.Lock()
	defer f.mu.Unlock()
	return slices.Clone(f.pedidos)
}

func coreConteudo(t *testing.T, resp func(core.PedidoMeta) (int, string)) (*core.Cliente, *graphFalsa) {
	t.Helper()
	f := &graphFalsa{resp: resp}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var p core.PedidoMeta
		json.NewDecoder(r.Body).Decode(&p)
		f.mu.Lock()
		f.pedidos = append(f.pedidos, p)
		f.mu.Unlock()
		st, corpo := f.resp(p)
		w.WriteHeader(st)
		io.WriteString(w, corpo)
	}))
	t.Cleanup(srv.Close)
	cli := core.Novo(srv.URL, "token-do-core")
	cli.Dormir = func(context.Context, time.Duration) error { return nil }
	return cli, f
}

func TestEspelhoCasaEMede(t *testing.T) {
	p := bancoConteudo(t)
	ctx := context.Background()
	agora := time.Date(2026, 10, 10, 15, 0, 0, 0, time.UTC)
	casa := peca(t, p, "Bolsa de couro preta", "feed", "agendada", time.Date(2026, 10, 9, 14, 0, 0, 0, time.UTC), "")
	story := peca(t, p, "Story", "stories", "agendada", time.Date(2026, 10, 9, 14, 0, 0, 0, time.UTC), "")
	medida := peca(t, p, "Antiga", "feed", "publicada", time.Date(2026, 10, 1, 12, 0, 0, 0, time.UTC), "")
	p.Exec(ctx, `update conteudo_pecas set ig_media_id = 'm-antiga', publicado_em = '2026-10-01T12:00:00Z' where id = $1::uuid`, medida)
	cli, f := coreConteudo(t, func(pd core.PedidoMeta) (int, string) {
		switch pd.Caminho {
		case "/1784/media":
			return 200, `{"data":[{"id":"m1","caption":"Bolsa de couro preta","media_type":"IMAGE","media_product_type":"FEED","timestamp":"2026-10-09T14:05:00+0000","permalink":"https://ig/p/m1"}]}`
		case "/m1": // a recém-casada já é medida na mesma rodada (o passo B vem depois do A, como na edge)
			return 200, `{"like_count":5,"comments_count":0}`
		case "/m1/insights":
			return 200, `{"data":[{"name":"reach","values":[{"value":100}]},{"name":"impressions","values":[{"value":150}]}]}`
		case "/m-antiga":
			return 200, `{"like_count":42,"comments_count":3,"permalink":"https://ig/p/a"}`
		case "/m-antiga/insights":
			return 400, `{"error":{"message":"(#10) Not enough viewers"}}`
		}
		return 404, `{"erro":"desconhecido"}`
	})
	e := &Espelho{Pool: p, Core: cli, Agora: func() time.Time { return agora }}
	if err := e.Rodar(ctx); err != nil {
		t.Fatal(err)
	}
	var mediaID, status string
	p.QueryRow(ctx, `select coalesce(ig_media_id, ''), status from conteudo_pecas where id = $1::uuid`, casa).Scan(&mediaID, &status)
	if mediaID != "m1" || status != "publicada" {
		t.Fatalf("casou automático: media=%q status=%q", mediaID, status)
	}
	if ev := eventos(t, p, casa); len(ev) != 1 || ev[0] != "casou: Encontrei o post no Instagram sozinho. Legenda 100% parecida, publicado 5 min depois do combinado." {
		t.Fatalf("%v", ev)
	}
	var curtidas, alcance *int
	var dia string
	p.QueryRow(ctx, `select curtidas, alcance, capturado_em::text from conteudo_metricas where peca_id = $1::uuid`, medida).Scan(&curtidas, &alcance, &dia)
	if curtidas == nil || *curtidas != 42 || alcance != nil || dia != "2026-10-10" {
		t.Fatalf("insights falhou: curtidas ficam, alcance nulo (não zero): %v %v %s", curtidas, alcance, dia)
	}
	var vis *int
	p.QueryRow(ctx, `select visualizacoes from conteudo_metricas where peca_id = $1::uuid`, casa).Scan(&vis)
	if vis == nil || *vis != 150 {
		t.Fatalf("views ausente cai em impressions: %v", vis)
	}
	for _, pd := range f.lista() {
		if strings.Contains(pd.Caminho, story) {
			t.Fatal("story nunca é casado")
		}
	}
	n := len(f.lista())
	err := e.Rodar(ctx)
	if depois := len(f.lista()); err != nil || depois != n {
		t.Fatalf("já medida hoje e já casada: nada a perguntar à Meta (pedidos %d -> %d, err=%v)", n, depois, err)
	}
}

func TestEspelhoFalhaDaMetaFicaVisivel(t *testing.T) {
	p := bancoConteudo(t)
	peca(t, p, "Bolsa", "feed", "agendada", time.Now().Add(-time.Hour), "")
	cli, _ := coreConteudo(t, func(core.PedidoMeta) (int, string) { return 500, `{"error":{"message":"fora do ar"}}` })
	e := &Espelho{Pool: p, Core: cli}
	if err := e.Rodar(context.Background()); err == nil || !strings.Contains(err.Error(), "casar Vessel: Meta API /1784/media: fora do ar") {
		t.Fatalf("err=%v", err)
	}
}

func TestPrecisaMedir(t *testing.T) {
	agora := time.Date(2026, 10, 10, 15, 0, 0, 0, time.UTC)
	dia := func(d int) time.Time { return agora.AddDate(0, 0, -d) }
	for _, c := range []struct {
		publicado time.Time
		ultima    string
		quer      bool
	}{
		{dia(3), "", true}, {dia(31), "", false}, {dia(3), "2026-10-10", false}, {dia(3), "2026-10-09", true},
		{dia(20), "2026-10-05", false}, {dia(20), "2026-10-02", true},
	} {
		if got := precisaMedir(c.publicado, c.ultima, agora); got != c.quer {
			t.Errorf("publicado %s, última %q: %v", c.publicado.Format("01-02"), c.ultima, got)
		}
	}
}
```

Em `api/cmd/api/worker_test.go`, troque:

```go

}

func TestTarefasDeProducao
```

por:

```go

	// Task 5
	"conteudo-hora-h":  "*/5 * * * *",
	"conteudo-espelho": "*/30 * * * *",
}

func TestTarefasDeProducao
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `go test -count=1 ./cmd/api ./internal/conteudo`
Expected: FAIL. Primeiras falhas, como saíram no ensaio deste plano: `--- FAIL: TestTarefasDeProducao`, `undefined: semelhancaDeTexto`, `undefined: Peca`, `undefined: Midia`, `undefined: casar`, `undefined: HoraH`

- [ ] **Step 3: Implementar**

Crie `api/internal/conteudo/pictografico.go`:

```go
package conteudo

import "unicode"

// pictografico é \p{Extended_Pictographic} do JavaScript (gerado do Node 22, o mesmo Unicode das
// edges): o regexp do Go não tem essa propriedade. Regerar só se a edge mudar.
var pictografico = &unicode.RangeTable{
	R16: []unicode.Range16{
		{0xA9, 0xA9, 1}, {0xAE, 0xAE, 1}, {0x203C, 0x203C, 1}, {0x2049, 0x2049, 1}, {0x2122, 0x2122, 1},
		{0x2139, 0x2139, 1}, {0x2194, 0x2199, 1}, {0x21A9, 0x21AA, 1}, {0x231A, 0x231B, 1}, {0x2328, 0x2328, 1},
		{0x23CF, 0x23CF, 1}, {0x23E9, 0x23F3, 1}, {0x23F8, 0x23FA, 1}, {0x24C2, 0x24C2, 1}, {0x25AA, 0x25AB, 1},
		{0x25B6, 0x25B6, 1}, {0x25C0, 0x25C0, 1}, {0x25FB, 0x25FE, 1}, {0x2600, 0x2604, 1}, {0x260E, 0x260E, 1},
		{0x2611, 0x2611, 1}, {0x2614, 0x2615, 1}, {0x2618, 0x2618, 1}, {0x261D, 0x261D, 1}, {0x2620, 0x2620, 1},
		{0x2622, 0x2623, 1}, {0x2626, 0x2626, 1}, {0x262A, 0x262A, 1}, {0x262E, 0x262F, 1}, {0x2638, 0x263A, 1},
		{0x2640, 0x2640, 1}, {0x2642, 0x2642, 1}, {0x2648, 0x2653, 1}, {0x265F, 0x2660, 1}, {0x2663, 0x2663, 1},
		{0x2665, 0x2666, 1}, {0x2668, 0x2668, 1}, {0x267B, 0x267B, 1}, {0x267E, 0x267F, 1}, {0x2692, 0x2697, 1},
		{0x2699, 0x2699, 1}, {0x269B, 0x269C, 1}, {0x26A0, 0x26A1, 1}, {0x26A7, 0x26A7, 1}, {0x26AA, 0x26AB, 1},
		{0x26B0, 0x26B1, 1}, {0x26BD, 0x26BE, 1}, {0x26C4, 0x26C5, 1}, {0x26C8, 0x26C8, 1}, {0x26CE, 0x26CF, 1},
		{0x26D1, 0x26D1, 1}, {0x26D3, 0x26D4, 1}, {0x26E9, 0x26EA, 1}, {0x26F0, 0x26F5, 1}, {0x26F7, 0x26FA, 1},
		{0x26FD, 0x26FD, 1}, {0x2702, 0x2702, 1}, {0x2705, 0x2705, 1}, {0x2708, 0x270D, 1}, {0x270F, 0x270F, 1},
		{0x2712, 0x2712, 1}, {0x2714, 0x2714, 1}, {0x2716, 0x2716, 1}, {0x271D, 0x271D, 1}, {0x2721, 0x2721, 1},
		{0x2728, 0x2728, 1}, {0x2733, 0x2734, 1}, {0x2744, 0x2744, 1}, {0x2747, 0x2747, 1}, {0x274C, 0x274C, 1},
		{0x274E, 0x274E, 1}, {0x2753, 0x2755, 1}, {0x2757, 0x2757, 1}, {0x2763, 0x2764, 1}, {0x2795, 0x2797, 1},
		{0x27A1, 0x27A1, 1}, {0x27B0, 0x27B0, 1}, {0x27BF, 0x27BF, 1}, {0x2934, 0x2935, 1}, {0x2B05, 0x2B07, 1},
		{0x2B1B, 0x2B1C, 1}, {0x2B50, 0x2B50, 1}, {0x2B55, 0x2B55, 1}, {0x3030, 0x3030, 1}, {0x303D, 0x303D, 1},
		{0x3297, 0x3297, 1}, {0x3299, 0x3299, 1},
	},
	R32: []unicode.Range32{
		{0x1F004, 0x1F004, 1}, {0x1F02C, 0x1F02F, 1}, {0x1F094, 0x1F09F, 1}, {0x1F0AF, 0x1F0B0, 1}, {0x1F0C0, 0x1F0C0, 1},
		{0x1F0CF, 0x1F0D0, 1}, {0x1F0F6, 0x1F0FF, 1}, {0x1F170, 0x1F171, 1}, {0x1F17E, 0x1F17F, 1}, {0x1F18E, 0x1F18E, 1},
		{0x1F191, 0x1F19A, 1}, {0x1F1AE, 0x1F1E5, 1}, {0x1F201, 0x1F20F, 1}, {0x1F21A, 0x1F21A, 1}, {0x1F22F, 0x1F22F, 1},
		{0x1F232, 0x1F23A, 1}, {0x1F23C, 0x1F23F, 1}, {0x1F249, 0x1F25F, 1}, {0x1F266, 0x1F321, 1}, {0x1F324, 0x1F393, 1},
		{0x1F396, 0x1F397, 1}, {0x1F399, 0x1F39B, 1}, {0x1F39E, 0x1F3F0, 1}, {0x1F3F3, 0x1F3F5, 1}, {0x1F3F7, 0x1F3FA, 1},
		{0x1F400, 0x1F4FD, 1}, {0x1F4FF, 0x1F53D, 1}, {0x1F549, 0x1F54E, 1}, {0x1F550, 0x1F567, 1}, {0x1F56F, 0x1F570, 1},
		{0x1F573, 0x1F57A, 1}, {0x1F587, 0x1F587, 1}, {0x1F58A, 0x1F58D, 1}, {0x1F590, 0x1F590, 1}, {0x1F595, 0x1F596, 1},
		{0x1F5A4, 0x1F5A5, 1}, {0x1F5A8, 0x1F5A8, 1}, {0x1F5B1, 0x1F5B2, 1}, {0x1F5BC, 0x1F5BC, 1}, {0x1F5C2, 0x1F5C4, 1},
		{0x1F5D1, 0x1F5D3, 1}, {0x1F5DC, 0x1F5DE, 1}, {0x1F5E1, 0x1F5E1, 1}, {0x1F5E3, 0x1F5E3, 1}, {0x1F5E8, 0x1F5E8, 1},
		{0x1F5EF, 0x1F5EF, 1}, {0x1F5F3, 0x1F5F3, 1}, {0x1F5FA, 0x1F64F, 1}, {0x1F680, 0x1F6C5, 1}, {0x1F6CB, 0x1F6D2, 1},
		{0x1F6D5, 0x1F6E5, 1}, {0x1F6E9, 0x1F6E9, 1}, {0x1F6EB, 0x1F6F0, 1}, {0x1F6F3, 0x1F6FF, 1}, {0x1F7DA, 0x1F7FF, 1},
		{0x1F80C, 0x1F80F, 1}, {0x1F848, 0x1F84F, 1}, {0x1F85A, 0x1F85F, 1}, {0x1F888, 0x1F88F, 1}, {0x1F8AE, 0x1F8AF, 1},
		{0x1F8BC, 0x1F8BF, 1}, {0x1F8C2, 0x1F8CF, 1}, {0x1F8D9, 0x1F8FF, 1}, {0x1F90C, 0x1F93A, 1}, {0x1F93C, 0x1F945, 1},
		{0x1F947, 0x1F9FF, 1}, {0x1FA58, 0x1FA5F, 1}, {0x1FA6E, 0x1FAFF, 1}, {0x1FC00, 0x1FFFD, 1},
	},
}
```

Crie `api/internal/conteudo/casar.go`:

```go
// Package conteudo: os robôs da Central de Conteúdo (hora H e espelho com o Instagram).
package conteudo

import (
	"cmp"
	"encoding/binary"
	"fmt"
	"math"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"time"
	"unicode"
	"unicode/utf16"

	"github.com/rbv-co/social-dashboard/api/internal/texto"
	"golang.org/x/text/unicode/norm"
)

// Porta de _shared/casar-publicacao.js. Um falso positivo é MUITO pior que um "não sei": o
// automático só dispara com nota alta e sem concorrente perto; o resto vira pergunta na tela.

const (
	limiarAutomatico  = 0.85
	limiarConcorrente = 0.60
	horasAntes        = 2
	horasDepois       = 24
	pesoLegenda       = 0.70
	pesoTempo         = 0.30
	pesoPalavras      = 0.6
	pesoBigramas      = 0.4
)

var (
	reAcento   = regexp.MustCompile(`[\x{0300}-\x{036f}]`)
	reMarcacao = regexp.MustCompile(`[#@][\p{L}\p{N}_]+`)
	reEspacos  = regexp.MustCompile(texto.EspacoJS + `+`)
)

// normalizar = normalizarParaComparar, devolvida em unidades UTF-16: o JS corta (slice(0,200)),
// mede palavras (p.length > 2) e monta bigramas sobre unidades UTF-16 — legendas do Instagram usam
// letras "𝐁𝐨𝐥𝐝" (fora do BMP), e contar runas daria outra nota.
func normalizar(s string) []uint16 {
	s = reAcento.ReplaceAllString(norm.NFD.String(s), "")
	s = reMarcacao.ReplaceAllString(s, " ")
	s = strings.Map(func(r rune) rune {
		if r == 0xFE0F || r == 0x200D || unicode.Is(pictografico, r) {
			return ' '
		}
		return r
	}, s)
	s = strings.Trim(reEspacos.ReplaceAllString(strings.ToLower(s), " "), " ")
	u := utf16.Encode([]rune(s))
	if len(u) > 200 {
		u = u[:200]
	}
	return u
}

func chave(u []uint16) string {
	b := make([]byte, 2*len(u))
	for i, x := range u {
		binary.LittleEndian.PutUint16(b[2*i:], x)
	}
	return string(b)
}

func palavras(u []uint16) map[string]bool {
	m := map[string]bool{}
	ini := 0
	for i := 0; i <= len(u); i++ {
		if i == len(u) || u[i] == ' ' {
			if i-ini > 2 { // palavra curta ("de", "na") é cola, não conteúdo
				m[chave(u[ini:i])] = true
			}
			ini = i + 1
		}
	}
	return m
}

func bigramas(u []uint16) map[string]bool {
	m := map[string]bool{}
	for i := 0; i+1 < len(u); i++ {
		m[chave(u[i:i+2])] = true
	}
	return m
}

func dice(a, b map[string]bool) float64 {
	if len(a) == 0 || len(b) == 0 {
		return 0
	}
	comuns := 0
	for x := range a {
		if b[x] {
			comuns++
		}
	}
	return 2 * float64(comuns) / float64(len(a)+len(b))
}

func comeca(a, b []uint16) bool { return len(a) >= len(b) && slices.Equal(a[:len(b)], b) }

func semelhancaDeTexto(a, b string) float64 {
	na, nb := normalizar(a), normalizar(b)
	if len(na) == 0 || len(nb) == 0 {
		return 0
	}
	if comeca(na, nb) || comeca(nb, na) { // legenda colada e alguém acrescentou algo no fim
		return 1
	}
	return pesoPalavras*dice(palavras(na), palavras(nb)) + pesoBigramas*dice(bigramas(na), bigramas(nb))
}

// Midia é um item de /{ig}/media.
type Midia struct {
	ID               string `json:"id"`
	Caption          string `json:"caption"`
	MediaType        string `json:"media_type"`
	MediaProductType string `json:"media_product_type"`
	Timestamp        string `json:"timestamp"`
	Permalink        string `json:"permalink"`
	ThumbnailURL     string `json:"thumbnail_url"`
	MediaURL         string `json:"media_url"`
}

// Peca é o pedaço de conteudo_pecas que o casamento lê.
type Peca struct {
	ID, AccountID, Formato, Legenda, Hashtags string
	PublicarEm                                *time.Time
}

func formatoCombina(formato string, m Midia) bool {
	if m.MediaProductType == "STORY" {
		return false
	}
	switch formato { // stories fica de fora: /{ig}/media não devolve story de forma confiável
	case "feed":
		return (m.MediaType == "IMAGE" || m.MediaType == "VIDEO") && m.MediaProductType != "REELS"
	case "carrossel":
		return m.MediaType == "CAROUSEL_ALBUM"
	case "reels":
		return m.MediaProductType == "REELS"
	}
	return false
}

// horaDaMeta lê o timestamp da Graph ("2026-10-09T14:00:00+0000") ou RFC 3339.
func horaDaMeta(s string) (time.Time, bool) {
	for _, l := range []string{"2006-01-02T15:04:05-0700", time.RFC3339} {
		if t, err := time.Parse(l, s); err == nil {
			return t, true
		}
	}
	return time.Time{}, false
}

type nota struct {
	total, legenda float64
	motivo         string
}

func arredondar(x float64) int64 { return int64(math.Floor(x + 0.5)) } // Math.round do JS (x >= 0)

func pontuar(p Peca, m Midia) (nota, bool) {
	if p.PublicarEm == nil || m.Timestamp == "" || !formatoCombina(p.Formato, m) {
		return nota{}, false
	}
	tm, ok := horaDaMeta(m.Timestamp)
	if !ok {
		return nota{}, false
	}
	minutos := float64(tm.Sub(*p.PublicarEm).Milliseconds()) / 60000
	if minutos < -horasAntes*60 || minutos > horasDepois*60 {
		return nota{}, false
	}
	var partes []string // a legenda de referência inclui as hashtags: é o texto que a pessoa copiou
	for _, s := range []string{p.Legenda, p.Hashtags} {
		if s != "" {
			partes = append(partes, s)
		}
	}
	legenda := semelhancaDeTexto(strings.Join(partes, " "), m.Caption)
	tempo := 1 - math.Min(math.Abs(minutos)/1440, 1)
	dif := arredondar(math.Abs(minutos))
	quando := "no horário exato"
	if dif != 0 {
		lado := "depois"
		if minutos < 0 {
			lado = "antes"
		}
		quando = fmt.Sprintf("%d min %s do combinado", dif, lado)
	}
	return nota{total: pesoLegenda*legenda + pesoTempo*tempo, legenda: legenda,
		motivo: fmt.Sprintf("Legenda %d%% parecida, publicado %s.", arredondar(legenda*100), quando)}, true
}

// Achado é uma linha de conteudo_casamentos.
type Achado struct {
	PecaID, IGMediaID, IGTimestamp, IGCaption, Situacao, Motivo string
	IGPermalink, IGThumb                                        *string
	Pontuacao                                                   float64
}

func ouNulo(s ...string) *string {
	for _, x := range s {
		if x != "" {
			return &x
		}
	}
	return nil
}

// casar: atribuição gulosa (o melhor par primeiro; cada peça e cada post uma vez só).
func casar(pecas []Peca, midias []Midia, jaUsados map[string]bool) []Achado {
	type par struct {
		p Peca
		m Midia
		n nota
	}
	var pares []par
	for _, p := range pecas {
		for _, m := range midias {
			if jaUsados[m.ID] {
				continue
			}
			if n, ok := pontuar(p, m); ok {
				pares = append(pares, par{p, m, n})
			}
		}
	}
	slices.SortStableFunc(pares, func(a, b par) int { return cmp.Compare(b.n.total, a.n.total) })
	feitas, usadas := map[string]bool{}, map[string]bool{}
	var saida []Achado
	for _, x := range pares {
		if feitas[x.p.ID] || usadas[x.m.ID] {
			continue
		}
		sozinho := true // outro candidato perto para ESTA peça = não dá para ter certeza
		for _, o := range pares {
			if o.p.ID == x.p.ID && o.m.ID != x.m.ID && !usadas[o.m.ID] && o.n.total >= limiarConcorrente {
				sozinho = false
				break
			}
		}
		situacao, motivo := "sugerido", x.n.motivo
		if x.n.total >= limiarAutomatico && sozinho {
			situacao = "automatico"
		}
		if !sozinho {
			motivo += " Há outro post parecido no mesmo período."
		}
		pont, _ := strconv.ParseFloat(strconv.FormatFloat(x.n.total, 'f', 4, 64), 64) // Number(total.toFixed(4))
		feitas[x.p.ID], usadas[x.m.ID] = true, true
		saida = append(saida, Achado{PecaID: x.p.ID, IGMediaID: x.m.ID, IGPermalink: ouNulo(x.m.Permalink),
			IGTimestamp: x.m.Timestamp, IGCaption: x.m.Caption, IGThumb: ouNulo(x.m.ThumbnailURL, x.m.MediaURL),
			Pontuacao: pont, Situacao: situacao, Motivo: motivo})
	}
	return saida
}
```

Crie `api/internal/conteudo/hora_h.go`:

```go
package conteudo

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/webpush"
	"github.com/rbv-co/social-dashboard/api/internal/worker"
)

// HoraH porta supabase/functions/conteudo-hora-h (pg_cron */5, robô 'conteudo-hora-h'): reivindica as
// peças cuja hora chegou (conteudo_reivindicar_hora_h: UPDATE ... RETURNING no banco, então duas
// execuções nunca avisam a mesma peça) e manda o push a quem pode publicar. A publicação automática
// da edge NÃO é portada: está desligada (ESCOPOS_DE_PUBLICACAO_LIBERADOS = false, sem App Review).
type HoraH struct {
	Pool  *pgxpool.Pool
	VAPID webpush.VAPID
	HTTP  *http.Client     // serviço de push; nil = o cliente seguro do webpush
	Agora func() time.Time // nil = time.Now
}

func (h *HoraH) Tarefa() worker.Tarefa {
	return worker.Tarefa{Nome: "conteudo-hora-h", Agenda: "*/5 * * * *", Limite: 2 * time.Minute, Executar: h.Rodar}
}

// toleranciaHoraH: peça mais velha que isto é reivindicada (não fica presa) mas não gera aviso
// (aviso-de-conteudo.js: HORAS_DE_TOLERANCIA = 12).
const toleranciaHoraH = 12 * time.Hour

var formatos = map[string]string{"feed": "Post do feed", "carrossel": "Carrossel", "reels": "Reels", "stories": "Story"}

type pecaDaHora struct {
	id, accountID, titulo, formato, conta string
	publicarEm                            *time.Time
	responsavel                           string
}

// avisoDePeca = montarAvisoDePeca (aviso-de-conteudo.js).
func avisoDePeca(p pecaDaHora) []byte {
	titulo := strings.TrimSpace(p.titulo)
	if titulo == "" {
		titulo = "Peça sem título"
	}
	formato := formatos[p.formato]
	if formato == "" {
		formato = "Publicação"
	}
	partes := []string{formato}
	if marca := strings.TrimSpace(p.conta); marca != "" {
		partes = append(partes, marca)
	}
	partes = append(partes, "legenda pronta para copiar")
	b, _ := json.Marshal(struct {
		Title string `json:"title"`
		Body  string `json:"body"`
		Tag   string `json:"tag"` // por peça: o service worker usa renotify, tag repetida apagaria o aviso anterior
		URL   string `json:"url"`
	}{"Hora de publicar: " + titulo, strings.Join(partes, " · "), "conteudo-" + p.id, "/conteudo/peca/" + p.id})
	return b
}

func (h *HoraH) Rodar(ctx context.Context) error {
	// VAPID errado falha ANTES de reivindicar: senão as peças seriam marcadas e nunca avisadas.
	if _, err := webpush.ValidarVAPID(h.VAPID); err != nil {
		return err
	}
	agora := time.Now
	if h.Agora != nil {
		agora = h.Agora
	}
	linhas, err := h.Pool.Query(ctx, `select c.id::text, c.account_id::text, coalesce(c.titulo, ''), coalesce(c.formato, ''),
			coalesce(a.name, ''), c.publicar_em, coalesce(c.responsavel::text, '')
		  from conteudo_reivindicar_hora_h() c left join accounts a on a.id = c.account_id`)
	if err != nil {
		return fmt.Errorf("falha_ao_reivindicar: %w", err)
	}
	pecas, err := pgx.CollectRows(linhas, func(r pgx.CollectableRow) (p pecaDaHora, err error) {
		return p, r.Scan(&p.id, &p.accountID, &p.titulo, &p.formato, &p.conta, &p.publicarEm, &p.responsavel)
	})
	if err != nil {
		return fmt.Errorf("falha_ao_reivindicar: %w", err)
	}
	if len(pecas) == 0 {
		return nil
	}
	evento := func(id, detalhe string) error {
		_, err := h.Pool.Exec(ctx, `insert into conteudo_eventos (peca_id, acao, detalhe) values ($1::uuid, 'avisou', $2::text)`, id, detalhe)
		return err
	}
	var total webpush.Resultado
	for _, p := range pecas {
		if p.publicarEm == nil || agora().Sub(*p.publicarEm) > toleranciaHoraH {
			if err := evento(p.id, "Passou mais de 12 horas do horário marcado — não avisei para não encher o celular de aviso velho."); err != nil {
				return err
			}
			continue
		}
		alvos, err := alvosDoAviso(ctx, h.Pool, p.responsavel)
		if err != nil {
			return err
		}
		if len(alvos) == 0 { // a peça já foi reivindicada: o motivo fica na trilha
			detalhe := "Chegou a hora, mas ninguém tem o aviso de conteúdo ligado (Administração › Usuários)."
			if p.responsavel != "" {
				detalhe = "Chegou a hora, mas quem é responsável por esta peça está com o aviso de conteúdo desligado (Administração › Usuários)."
			}
			if err := evento(p.id, detalhe); err != nil {
				return err
			}
			continue
		}
		r, err := webpush.Entregar(ctx, h.Pool, h.HTTP, alvos, avisoDePeca(p), h.VAPID, "conteudo-hora-h:"+p.id)
		if err != nil {
			return err
		}
		total.Enviados += r.Enviados
		total.Podados += r.Podados
		total.Falhas += r.Falhas
		if err := evento(p.id, fmt.Sprintf("Aviso enviado para %d aparelho(s).", r.Enviados+r.Repetidos)); err != nil {
			return err
		}
	}
	slog.Info("conteudo-hora-h", "pecas", len(pecas), "enviados", total.Enviados, "podados", total.Podados, "falhas", total.Falhas)
	if total.Enviados == 0 && total.Falhas > 0 {
		return fmt.Errorf("nenhum_push_entregue: %d falhas", total.Falhas)
	}
	return nil
}

// alvosDoAviso (aviso-de-conteudo.js): quer o tipo 'conteudo' E pode abrir a ferramenta (admin,
// superadmin ou 'conteudo' em features). Com responsável, o aviso é SÓ dele (vazio se ele desligou).
func alvosDoAviso(ctx context.Context, p *pgxpool.Pool, responsavel string) ([]webpush.Destino, error) {
	querem, err := webpush.Destinatarios(ctx, p, "conteudo", responsavel)
	if err != nil || len(querem) == 0 {
		return nil, err
	}
	linhas, err := p.Query(ctx, `select id::text from profiles
		where coalesce(role::text, '') = 'admin' or coalesce(is_superadmin, false) or 'conteudo' = any(coalesce(features, '{}'::text[]))`)
	if err != nil {
		return nil, err
	}
	ids, err := pgx.CollectRows(linhas, pgx.RowTo[string])
	if err != nil {
		return nil, err
	}
	podem := map[string]bool{}
	for _, id := range ids {
		podem[id] = true
	}
	var out []webpush.Destino
	for _, d := range querem {
		if podem[d.UserID] {
			out = append(out, d)
		}
	}
	return out, nil
}
```

Crie `api/internal/conteudo/espelho.go`:

```go
package conteudo

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/core"
	"github.com/rbv-co/social-dashboard/api/internal/meta"
	"github.com/rbv-co/social-dashboard/api/internal/worker"
)

// Espelho porta supabase/functions/conteudo-espelho (pg_cron */30, robô 'conteudo-espelho'):
// A) CASAR peças agendadas/publicadas sem vínculo com o post real de /{ig}/media;
// B) MEDIR as já vinculadas (cadência de cadencia-de-medicao.js). A Graph vai SEMPRE pelo core.
type Espelho struct {
	Pool  *pgxpool.Pool
	Core  *core.Cliente
	Agora func() time.Time // nil = time.Now
}

func (e *Espelho) Tarefa() worker.Tarefa {
	return worker.Tarefa{Nome: "conteudo-espelho", Agenda: "*/30 * * * *", Limite: 10 * time.Minute, Executar: e.Rodar}
}

const (
	camposMidia          = "id,caption,media_type,media_product_type,timestamp,permalink,thumbnail_url,media_url,like_count,comments_count"
	diasDeAcompanhamento = 30
	diasDeMedidaDiaria   = 7
)

func (e *Espelho) Rodar(ctx context.Context) error {
	agora := time.Now
	if e.Agora != nil {
		agora = e.Agora
	}
	t := agora()
	var falhas []string
	casadas, sugeridas, err := e.casar(ctx, t, &falhas)
	if err != nil {
		return err
	}
	medidas, err := e.medir(ctx, t, &falhas)
	if err != nil {
		return err
	}
	slog.Info("conteudo-espelho", "casadas", casadas, "sugeridas", sugeridas, "medidas", medidas, "falhas", len(falhas))
	if len(falhas) > 0 { // uma conta/peça que falha não derruba as outras, mas a rodada fica vermelha
		return fmt.Errorf("espelho: %d falha(s): %s", len(falhas), strings.Join(falhas, " · "))
	}
	return nil
}

type contaIG struct{ id, nome, ig string }

// casar = PASSO A. Story fica de fora (a Graph não devolve story de forma confiável em /media).
func (e *Espelho) casar(ctx context.Context, t time.Time, falhas *[]string) (casadas, sugeridas int, err error) {
	linhas, err := e.Pool.Query(ctx, `select id::text, account_id::text, coalesce(formato, ''), coalesce(legenda, ''), coalesce(hashtags, ''), publicar_em
		  from conteudo_pecas
		 where status in ('agendada', 'publicada') and formato <> 'stories' and ig_media_id is null
		   and publicar_em is not null and publicar_em >= $1::timestamptz
		 order by publicar_em`, t.Add(-7*24*time.Hour))
	if err != nil {
		return 0, 0, err
	}
	pecas, err := pgx.CollectRows(linhas, func(r pgx.CollectableRow) (p Peca, err error) {
		return p, r.Scan(&p.ID, &p.AccountID, &p.Formato, &p.Legenda, &p.Hashtags, &p.PublicarEm)
	})
	if err != nil || len(pecas) == 0 {
		return 0, 0, err
	}
	porConta := map[string][]Peca{}
	var ids []string
	for _, p := range pecas {
		if porConta[p.AccountID] == nil {
			ids = append(ids, p.AccountID)
		}
		porConta[p.AccountID] = append(porConta[p.AccountID], p)
	}
	linhas, err = e.Pool.Query(ctx, `select id::text, coalesce(name, ''), coalesce(instagram_id::text, '') from accounts where id::text = any($1::text[]) order by name`, ids)
	if err != nil {
		return 0, 0, err
	}
	contas, err := pgx.CollectRows(linhas, func(r pgx.CollectableRow) (c contaIG, err error) { return c, r.Scan(&c.id, &c.nome, &c.ig) })
	if err != nil {
		return 0, 0, err
	}
	for _, c := range contas {
		if c.ig == "" {
			continue
		}
		j, err := meta.GET(ctx, e.Core, "/"+c.ig+"/media", map[string]any{"fields": camposMidia, "limit": "50"})
		if err != nil {
			*falhas = append(*falhas, "casar "+c.nome+": "+err.Error())
			continue
		}
		var lote struct {
			Data []Midia `json:"data"`
		}
		b, _ := json.Marshal(j)
		json.Unmarshal(b, &lote)
		daConta := porConta[c.id]
		pecaIDs := make([]string, len(daConta))
		for i, p := range daConta {
			pecaIDs[i] = p.ID
		}
		// Posts já vinculados a alguma peça, ou já decididos para estas: nunca oferecer de novo o que a
		// pessoa já disse que não era.
		linhas, err := e.Pool.Query(ctx, `select ig_media_id from conteudo_pecas where ig_media_id is not null
			union select ig_media_id from conteudo_casamentos where peca_id::text = any($1::text[])`, pecaIDs)
		if err != nil {
			return 0, 0, err
		}
		usados, err := pgx.CollectRows(linhas, pgx.RowTo[string])
		if err != nil {
			return 0, 0, err
		}
		jaUsados := map[string]bool{}
		for _, u := range usados {
			jaUsados[u] = true
		}
		for _, a := range casar(daConta, lote.Data, jaUsados) {
			err := pgx.BeginFunc(ctx, e.Pool, func(tx pgx.Tx) error {
				if _, err := tx.Exec(ctx, `insert into conteudo_casamentos (peca_id, ig_media_id, ig_permalink, ig_timestamp, ig_caption, ig_thumb, pontuacao, situacao, motivo)
					values ($1::uuid, $2::text, $3::text, $4::timestamptz, $5::text, $6::text, $7::numeric, $8::text, $9::text)
					on conflict (peca_id, ig_media_id) do update set ig_permalink = excluded.ig_permalink, ig_timestamp = excluded.ig_timestamp,
					  ig_caption = excluded.ig_caption, ig_thumb = excluded.ig_thumb, pontuacao = excluded.pontuacao,
					  situacao = excluded.situacao, motivo = excluded.motivo`,
					a.PecaID, a.IGMediaID, a.IGPermalink, a.IGTimestamp, a.IGCaption, a.IGThumb, a.Pontuacao, a.Situacao, a.Motivo); err != nil {
					return err
				}
				if a.Situacao != "automatico" {
					return nil
				}
				if _, err := tx.Exec(ctx, `update conteudo_pecas set ig_media_id = $2::text, ig_permalink = $3::text, status = 'publicada',
					publicado_em = $4::timestamptz where id = $1::uuid`, a.PecaID, a.IGMediaID, a.IGPermalink, a.IGTimestamp); err != nil {
					return err
				}
				_, err := tx.Exec(ctx, `insert into conteudo_eventos (peca_id, acao, detalhe) values ($1::uuid, 'casou', $2::text)`,
					a.PecaID, "Encontrei o post no Instagram sozinho. "+a.Motivo)
				return err
			})
			if err != nil {
				return 0, 0, err
			}
			if a.Situacao == "automatico" {
				casadas++
			} else {
				sugeridas++
			}
		}
	}
	return casadas, sugeridas, nil
}

// precisaMedir (cadencia-de-medicao.js): todo dia na 1ª semana, uma vez por semana até 30 dias,
// depois nunca. As datas são em UTC, como a edge (toISOString().slice(0,10)).
func precisaMedir(publicado time.Time, ultima string, agora time.Time) bool {
	idade := agora.Sub(publicado).Hours() / 24
	if idade > diasDeAcompanhamento {
		return false
	}
	if ultima == "" {
		return true
	}
	if ultima >= agora.UTC().Format("2006-01-02") {
		return false
	}
	u, err := time.Parse(time.RFC3339, ultima+"T12:00:00Z")
	if err != nil {
		return false
	}
	return idade <= diasDeMedidaDiaria || agora.Sub(u).Hours()/24 >= 7
}

// insight devolve values[0].value da primeira métrica presente (nil = a Meta não respondeu).
func insight(ins map[string]any, nomes ...string) any {
	lista, _ := ins["data"].([]any)
	for _, nome := range nomes {
		for _, x := range lista {
			i, _ := x.(map[string]any)
			if i["name"] != nome {
				continue
			}
			vs, _ := i["values"].([]any)
			if len(vs) > 0 {
				if v, _ := vs[0].(map[string]any); v["value"] != nil {
					return v["value"]
				}
			}
		}
	}
	return nil
}

// medir = PASSO B. null e 0 são diferentes: null = a Meta não respondeu a métrica.
func (e *Espelho) medir(ctx context.Context, t time.Time, falhas *[]string) (int, error) {
	linhas, err := e.Pool.Query(ctx, `select p.id::text, p.ig_media_id, p.publicado_em,
			coalesce((select max(m.capturado_em)::text from conteudo_metricas m where m.peca_id = p.id), '')
		  from conteudo_pecas p
		 where p.ig_media_id is not null and p.publicado_em >= $1::timestamptz
		   and exists (select 1 from accounts a where a.id = p.account_id)`, t.Add(-diasDeAcompanhamento*24*time.Hour))
	if err != nil {
		return 0, err
	}
	type publicada struct {
		id, media, ultima string
		em                time.Time
	}
	pubs, err := pgx.CollectRows(linhas, func(r pgx.CollectableRow) (p publicada, err error) {
		return p, r.Scan(&p.id, &p.media, &p.em, &p.ultima)
	})
	if err != nil {
		return 0, err
	}
	medidas := 0
	for _, p := range pubs {
		if !precisaMedir(p.em, p.ultima, t) {
			continue
		}
		midia, err := meta.GET(ctx, e.Core, "/"+p.media, map[string]any{"fields": "like_count,comments_count,permalink"})
		if err != nil {
			*falhas = append(*falhas, "medir "+p.id+": "+err.Error())
			continue
		}
		// Os insights falham em alguns tipos de mídia (e em post antigo): não impedem curtidas e comentários.
		ins, _ := meta.GET(ctx, e.Core, "/"+p.media+"/insights", map[string]any{"metric": "reach,saved,shares,views"})
		bruto, _ := json.Marshal(map[string]any{"midia": midia, "insights": ins})
		if _, err := e.Pool.Exec(ctx, `insert into conteudo_metricas (peca_id, capturado_em, curtidas, comentarios, alcance, salvamentos, compartilhamentos, visualizacoes, bruto)
			values ($1::uuid, $2::date, $3::numeric::int, $4::numeric::int, $5::numeric::int, $6::numeric::int, $7::numeric::int, $8::numeric::int, $9::jsonb)
			on conflict (peca_id, capturado_em) do update set curtidas = excluded.curtidas, comentarios = excluded.comentarios,
			  alcance = excluded.alcance, salvamentos = excluded.salvamentos, compartilhamentos = excluded.compartilhamentos,
			  visualizacoes = excluded.visualizacoes, bruto = excluded.bruto`,
			p.id, t.UTC().Format("2006-01-02"), numeroOuNulo(midia["like_count"]), numeroOuNulo(midia["comments_count"]),
			numeroOuNulo(insight(ins, "reach")), numeroOuNulo(insight(ins, "saved")), numeroOuNulo(insight(ins, "shares")),
			numeroOuNulo(insight(ins, "views", "impressions")), string(bruto)); err != nil {
			return medidas, err
		}
		medidas++
	}
	return medidas, nil
}

// numeroOuNulo: o número como texto (o banco converte), ou nil. Nunca troca "não veio" por zero.
func numeroOuNulo(v any) *string {
	if v == nil {
		return nil
	}
	s := fmt.Sprint(v)
	return &s
}
```

Em `api/cmd/api/tarefas.go`, troque:

```go
	"github.com/rbv-co/social-dashboard/api/internal/config"
```

por:

```go
	"github.com/rbv-co/social-dashboard/api/internal/config"
	"github.com/rbv-co/social-dashboard/api/internal/conteudo"
```

Em `api/cmd/api/tarefas.go`, troque:

```go
	return ts
}
```

por:

```go
	ts = append(ts, (&conteudo.HoraH{Pool: p, VAPID: vapid(cfg)}).Tarefa(), (&conteudo.Espelho{Pool: p, Core: cli}).Tarefa())
	return ts
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `gofmt -l . && go vet ./... && go test -race -count=1 ./internal/conteudo/ ./cmd/api/ -v 2>&1 | grep -E -- '^(ok|FAIL|--- FAIL|--- SKIP)'`
Expected: `gofmt` não lista nada; só linhas `ok`, nenhuma `FAIL` nem `--- SKIP`.

- [ ] **Step 5: Commit**

```bash
git add api/internal/conteudo/pictografico.go api/internal/conteudo/casar.go api/internal/conteudo/casar_test.go api/internal/conteudo/hora_h.go api/internal/conteudo/espelho.go api/internal/conteudo/conteudo_test.go api/cmd/api/tarefas.go api/cmd/api/worker_test.go
git commit -m "feat(api): conteudo-hora-h e conteudo-espelho no worker

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 6: `coletar-dados` (Instagram, 4 rodadas, linha por conta) e `auditar-dados` com `run_integrity_checks` em Go

**Revisor:** padrão.

- `coletar-dados-07h`/`-12h`/`-18h`/`-2359`: porta `supabase/functions/coletar-dados/index.ts` + `public.disparar_coletor`. Uma rodada passa por TODAS as contas que `disparar_coletor` escolhia (`instagram_id` e `access_token` preenchidos, ordem por nome), em série, com 6 min por conta e 50 min por rodada; grava UMA linha por conta (`coletar-dados-07h · <conta>`, `RegistroProprio`), e a falha de uma conta não para as outras. Por conta: seguidores (`daily_snapshots` + `followers_leituras` origem `diario`), "seguiram/deixaram" brutos dos últimos 14 dias (`bruto_seguidores_parado` quando o Instagram para de publicar), stories de hoje, `/media` lido UMA vez para os 5 períodos, engajamento com a resiliência da edge (leitura pela metade não é gravada, fica o último bom), `content_snapshots`, e o aviso `coleta_zerada` em `data_integrity_checks` (+ `ALERT_WEBHOOK_URL`, cuja URL nunca sai em erro). A parte de anúncios entra como esboço aqui e é implementada na Task 7. A Graph vai pelo core, dono do token: `renovarToken` não existe mais.
- `auditar-dados` (`30 2 * * *`): porta `supabase/functions/auditar-dados/index.ts` e REESCREVE `run_integrity_checks` (os mesmos 7 checks, o mesmo SQL, numa transação), apagando do dia só as linhas dos próprios checks (a função SQL apagava também as do `coletar-dados`). Spot-check contra a Graph e o `veredito` da edge; aviso por `ALERT_WEBHOOK_URL`.

**Files:**
- Create: `api/internal/meta/coleta.go`
- Create: `api/internal/meta/coleta_anuncios.go`
- Test: `api/internal/meta/coleta_test.go`
- Create: `api/internal/meta/auditar.go`
- Test: `api/internal/meta/auditar_test.go`
- Modify: `api/internal/config/config.go`
- Test (modify): `api/internal/config/config_test.go`
- Modify: `api/cmd/api/tarefas.go`
- Test (modify): `api/cmd/api/worker_test.go`

**Interfaces:**
- Consumes: `meta.GET`, `meta.Paginas`, `coreDeTeste` (Task 3); `worker.Tarefa`, `Agendador.Gravador()` (Task 1); `saoPaulo` (Plano 3, pacote `meta`).
- Produces:
  - `type meta.ColetaDiaria struct { Pool; Core *core.Cliente; Gravar func(ctx, robo string, inicio time.Time, erro error) error; Alerta string; HTTP *http.Client; Agora func() time.Time; Dormir func(context.Context, time.Duration) error }` com `Tarefas() []worker.Tarefa` (4 rodadas, `Trava: "coletar-dados"`) e `Rodada(ctx, rodada string) error`.
  - `func (c *ColetaDiaria) anuncios(ctx, conta contaColeta, hoje string, degradados *[]string) error` (esboço; a Task 7 substitui o arquivo).
  - `type meta.Auditoria struct { Pool; Core; Alerta string; HTTP; Agora }` com `Rodar` e `Tarefa`; `avisarWebhook(ctx, cli, alvo, msg string) error`.
  - `config.Config.AlertaWebhook` (em `Segredos()`).
  - Nos testes: `tabelasColeta`, `contaA1`, `contaA3`, `agoraColeta`, `permitidoNoCore`, `graphDaColeta`, `ambienteColeta` (usados pelas Tasks 7 e 8).

- [ ] **Step 1: Escrever os testes que falham**

Crie `api/internal/meta/coleta_test.go`:

```go
package meta

import (
	"context"
	"regexp"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/core"
	"github.com/rbv-co/social-dashboard/api/internal/testebanco"
	"github.com/rbv-co/social-dashboard/api/internal/worker"
)

// Tabelas anteriores às migrations (accounts, daily_snapshots, engagement_snapshots, content_snapshots,
// data_integrity_checks) têm aqui SÓ as colunas que o coletor usa; o ensaio confere em produção
// (ops/migracao/conferir-worker.sql). followers_leituras vem de 2026-07-16-followers-leituras.sql.
const tabelasColeta = `
create table accounts (id uuid primary key, name text, instagram_id text, ad_account_id text, access_token text, picture_url text);
create table daily_snapshots (account_id uuid not null, captured_at date not null, followers_count int, gained int, lost int,
  unique (account_id, captured_at));
create table followers_leituras (id bigserial primary key, account_id uuid not null, followers_count int not null,
  lido_em timestamptz not null default now(), origem text);
create table engagement_snapshots (account_id uuid not null, captured_at date not null, period_days int not null,
  likes int, comments int, saves int, shares int, reach int, views int, total_interactions int, accounts_engaged int, profile_views int,
  unique (account_id, captured_at, period_days));
create table content_snapshots (account_id uuid not null, captured_at date not null, period_days int not null, posts_count int,
  reels_count int, stories_count int, story_shares int, story_replies int, story_reach int, story_interactions int,
  story_navigation int, story_profile_visits int, story_follows int, story_nav_forward int, story_nav_back int, story_nav_exit int,
  story_nav_next int, unique (account_id, captured_at, period_days));
create table data_integrity_checks (id bigserial primary key, checked_date date not null, account_id uuid, check_name text not null,
  status text not null, detail text);
insert into accounts (id, name, instagram_id, ad_account_id, access_token) values
  ('aaaaaaaa-0000-0000-0000-0000000000a1', 'Vessel', '1784', null, 'tok'),
  ('aaaaaaaa-0000-0000-0000-0000000000a2', 'Mantova Móveis', '1785', null, 'tok'),
  ('aaaaaaaa-0000-0000-0000-0000000000a3', 'Breno', '1786', null, 'tok'),
  ('aaaaaaaa-0000-0000-0000-0000000000a4', 'Sem token', '1787', null, null);`

const (
	contaA1 = "aaaaaaaa-0000-0000-0000-0000000000a1"
	contaA3 = "aaaaaaaa-0000-0000-0000-0000000000a3"
)

// agoraColeta: sábado 2026-10-10 07:00 em São Paulo (10:00 UTC, a rodada das 07h).
var agoraColeta = time.Date(2026, 10, 10, 10, 0, 0, 0, time.UTC)

// permitidoNoCore: a allow-list de GET do proxy da Meta (vessel-core-go@e8a06e8c3,
// services/core/internal/meta/http.go:111). Caminho fora dela = 400 no core de verdade.
var permitidoNoCore = regexp.MustCompile(`^(/(me|act_\d+|\d+)(/[a-z_]+){0,3}|/search)$`)

func diaDoSince(p core.PedidoMeta) string {
	s, _ := p.Parametros["since"].(string)
	n, _ := strconv.ParseInt(s, 10, 64)
	return time.Unix(n, 0).In(saoPaulo).Format("2006-01-02")
}

func graphDaColeta(p core.PedidoMeta) (int, string, map[string]string) {
	m := func(k string) string { s, _ := p.Parametros[k].(string); return s }
	switch {
	case p.Caminho == "/1785":
		return 500, `{"error":{"message":"(#2) Service temporarily unavailable"}}`, nil
	case (p.Caminho == "/1784" || p.Caminho == "/1786") && m("fields") == "followers_count":
		return 200, `{"followers_count":24345}`, nil
	case m("metric") == "follows_and_unfollows":
		switch diaDoSince(p) {
		case "2026-10-09":
			return 200, `{"data":[]}`, nil // ontem sem número: atraso normal, ainda não é recado
		case "2026-10-08":
			if p.Caminho == "/1784"+"/insights" {
				return 200, `{"data":[{"total_value":{"breakdowns":[{"results":[]}]}}]}`, nil // respondeu sem número
			}
		}
		return 200, `{"data":[{"total_value":{"breakdowns":[{"results":[{"dimension_values":["FOLLOWER"],"value":14},{"dimension_values":["NON_FOLLOWER"],"value":3}]}]}}]}`, nil
	case strings.HasPrefix(m("metric"), "likes,comments"):
		if p.Caminho == "/1786/insights" { // a Meta pela metade: curtidas zeradas com 556 interações
			return 200, `{"data":[{"name":"likes","total_value":{"value":0}},{"name":"comments","total_value":{"value":34}},{"name":"reach","total_value":{"value":900}},{"name":"total_interactions","total_value":{"value":556}}]}`, nil
		}
		return 200, `{"data":[{"name":"likes","total_value":{"value":100}},{"name":"comments","total_value":{"value":10}},{"name":"saves","total_value":{"value":5}},
			{"name":"shares","total_value":{"value":3}},{"name":"reach","total_value":{"value":1000}},{"name":"views","total_value":{"value":2000}},
			{"name":"total_interactions","total_value":{"value":118}},{"name":"accounts_engaged","total_value":{"value":50}},{"name":"profile_views","total_value":{"value":20}}]}`, nil
	case p.Caminho == "/1784/stories":
		return 200, `{"data":[{"id":"501","timestamp":"2026-10-10T12:00:00+0000"},{"id":"502","timestamp":"2026-10-09T20:00:00+0000"}]}`, nil
	case p.Caminho == "/501/insights" && m("breakdown") == "":
		return 200, `{"data":[{"name":"reach","values":[{"value":10}]},{"name":"replies","value":1},{"name":"shares","value":2},
			{"name":"total_interactions","value":5},{"name":"navigation","value":8},{"name":"profile_visits","value":1},{"name":"follows","value":0}]}`, nil
	case p.Caminho == "/501/insights":
		return 200, `{"data":[{"total_value":{"breakdowns":[{"results":[{"dimension_values":["tap_forward"],"value":5},{"dimension_values":["tap_back"],"value":1},
			{"dimension_values":["tap_exit"],"value":1},{"dimension_values":["swipe_forward"],"value":1}]}]}}]}`, nil
	case p.Caminho == "/1784/media":
		return 200, `{"data":[
			{"id":"1","media_product_type":"REELS","timestamp":"2026-10-10T11:00:00+0000","owner":{"id":"1784"}},
			{"id":"2","media_product_type":"FEED","timestamp":"2026-10-10T11:30:00+0000","owner":{"id":"1784"}},
			{"id":"3","media_product_type":"FEED","timestamp":"2026-10-09T15:00:00+0000"},
			{"id":"4","media_product_type":"FEED","timestamp":"2026-09-30T15:00:00+0000","owner":{"id":"1784"}},
			{"id":"5","media_product_type":"FEED","timestamp":"2026-10-10T11:00:00+0000","owner":{"id":"999"}},
			{"id":"6","media_product_type":"STORY","timestamp":"2026-10-10T11:00:00+0000","owner":{"id":"1784"}}]}`, nil
	}
	return 200, `{"data":[]}`, nil
}

func ambienteColeta(t *testing.T) (*ColetaDiaria, *coreMeta, *pgxpool.Pool, *worker.Agendador) {
	t.Helper()
	p := testebanco.Novo(t)
	if _, err := p.Exec(context.Background(), tabelasColeta); err != nil {
		t.Fatal(err)
	}
	cli, f := coreDeTeste(t, graphDaColeta)
	ag := worker.Novo(p)
	c := &ColetaDiaria{Pool: p, Core: cli, Gravar: ag.Gravador(), Agora: func() time.Time { return agoraColeta },
		Dormir: func(context.Context, time.Duration) error { return nil }}
	return c, f, p, ag
}

func TestColetaDiariaUmaLinhaPorContaComONomeDeProducao(t *testing.T) {
	c, f, p, ag := ambienteColeta(t)
	ctx := context.Background()
	ex, err := ag.Rodar(ctx, c.Tarefas()[0])
	if !ex || err != nil {
		t.Fatalf("a conta que falha fica na linha dela; a rodada não falha: ex=%v err=%v", ex, err)
	}
	linhas, _ := p.Query(ctx, `select robo, ok, coalesce(resposta, '') from robos_execucoes order by robo`)
	var got []string
	for linhas.Next() {
		var robo, resp string
		var ok bool
		linhas.Scan(&robo, &ok, &resp)
		got = append(got, robo+"|"+strconv.FormatBool(ok)+"|"+resp)
	}
	quer := []string{
		"coletar-dados-07h · Breno|true|ok",
		"coletar-dados-07h · Mantova Móveis|false|Meta API /1785: (#2) Service temporarily unavailable",
		"coletar-dados-07h · Vessel|true|ok",
	}
	if strings.Join(got, "\n") != strings.Join(quer, "\n") {
		t.Fatalf("robos_execucoes =\n%s\nesperava\n%s", strings.Join(got, "\n"), strings.Join(quer, "\n"))
	}
	for _, ped := range f.lista() {
		if !permitidoNoCore.MatchString(ped.Caminho) || ped.Parametros["access_token"] != nil || ped.Metodo != "GET" {
			t.Errorf("pedido fora do contrato do core: %+v", ped)
		}
		if strings.HasPrefix(ped.Caminho, "/1787") {
			t.Error("conta sem access_token não entra na rodada (o filtro de disparar_coletor)")
		}
	}
}

func TestColetaDiariaGravaComoAEdge(t *testing.T) {
	c, _, p, _ := ambienteColeta(t)
	ctx := context.Background()
	if err := c.Rodada(ctx, "07h"); err != nil {
		t.Fatal(err)
	}
	var seguidores, ganho, perda int
	p.QueryRow(ctx, `select followers_count, gained, lost from daily_snapshots where account_id = $1::uuid and captured_at = '2026-10-10'`, contaA1).
		Scan(&seguidores, &ganho, &perda)
	if seguidores != 24345 || ganho != 14 || perda != 3 {
		t.Fatalf("daily_snapshots: %d %d %d", seguidores, ganho, perda)
	}
	var leituras int
	p.QueryRow(ctx, `select count(*) from followers_leituras where origem = 'diario'`).Scan(&leituras)
	if leituras != 2 {
		t.Fatalf("uma leitura por conta coletada: %d", leituras)
	}
	var recado string
	p.QueryRow(ctx, `select detail from data_integrity_checks where check_name = 'bruto_seguidores_parado' and account_id = $1::uuid`, contaA1).Scan(&recado)
	if recado != "Vessel: o Instagram não publica seguiram/deixaram desde 08/10 (1 dia sem número)" {
		t.Fatalf("recado do bruto parado: %q", recado)
	}
	var posts0, reels0, stories0, alcance0, frente0, posts7, reels7, posts14 int
	var stories7 *int
	p.QueryRow(ctx, `select posts_count, reels_count, stories_count, story_reach, story_nav_forward from content_snapshots
		where account_id = $1::uuid and period_days = 0`, contaA1).Scan(&posts0, &reels0, &stories0, &alcance0, &frente0)
	p.QueryRow(ctx, `select posts_count, reels_count, stories_count from content_snapshots where account_id = $1::uuid and period_days = 7`, contaA1).
		Scan(&posts7, &reels7, &stories7)
	p.QueryRow(ctx, `select posts_count from content_snapshots where account_id = $1::uuid and period_days = 14`, contaA1).Scan(&posts14)
	if posts0 != 1 || reels0 != 1 || stories0 != 1 || alcance0 != 10 || frente0 != 5 {
		t.Fatalf("período 0: posts=%d reels=%d stories=%d alcance=%d frente=%d", posts0, reels0, stories0, alcance0, frente0)
	}
	if posts7 != 2 || reels7 != 1 || stories7 != nil || posts14 != 3 {
		t.Fatalf("7d: posts=%d reels=%d stories=%v; 14d: posts=%d", posts7, reels7, stories7, posts14)
	}
	var periodos string
	p.QueryRow(ctx, `select string_agg(period_days::text || '=' || likes, ',' order by period_days) from engagement_snapshots where account_id = $1::uuid`, contaA1).Scan(&periodos)
	if periodos != "0=100,1=100,7=100,14=100,30=100,99=100" {
		t.Fatalf("engajamento: %q", periodos)
	}
	var zerada string
	var engBreno int
	p.QueryRow(ctx, `select detail from data_integrity_checks where check_name = 'coleta_zerada'`).Scan(&zerada)
	p.QueryRow(ctx, `select count(*) from engagement_snapshots where account_id = $1::uuid`, contaA3).Scan(&engBreno)
	quer := "⚠️ Coleta IG: a Meta retornou métricas zeradas/inconsistentes (alcance 0 ou likes/comments/saves/shares zerados com interações>0) mesmo após 5 tentativas em: " +
		"Breno 0d · Breno 7d (sem histórico) · Breno 14d (sem histórico) · Breno 30d (sem histórico) · Breno mês (sem histórico). " +
		"Mantive o valor mais recente válido (não zerei o painel). Verificar token/permissões da Meta."
	if zerada != quer || engBreno != 0 {
		t.Fatalf("leitura pela metade não vira linha: zerada=%q linhas=%d", zerada, engBreno)
	}
}

func TestColetaDiariaUsaOUltimoBomEAgendas(t *testing.T) {
	c, _, p, _ := ambienteColeta(t)
	ctx := context.Background()
	p.Exec(ctx, `insert into engagement_snapshots (account_id, captured_at, period_days, likes, comments, saves, shares, reach, views, total_interactions, accounts_engaged, profile_views)
		values ($1::uuid, '2026-10-09', 7, 80, 9, 4, 2, 800, 1500, 95, 40, 15)`, contaA3)
	if err := c.Rodada(ctx, "12h"); err != nil {
		t.Fatal(err)
	}
	var likes, comments int
	p.QueryRow(ctx, `select likes, comments from engagement_snapshots where account_id = $1::uuid and captured_at = '2026-10-10' and period_days = 7`, contaA3).Scan(&likes, &comments)
	if likes != 80 || comments != 34 {
		t.Fatalf("o zero vem do último bom e o que a Meta mandou fica: likes=%d comments=%d", likes, comments)
	}
	var quer = map[string]string{"coletar-dados-07h": "0 10 * * *", "coletar-dados-12h": "0 15 * * *", "coletar-dados-18h": "0 21 * * *", "coletar-dados-2359": "59 2 * * *"}
	for _, tf := range c.Tarefas() {
		if quer[tf.Nome] != tf.Agenda || tf.Trava != "coletar-dados" || !tf.RegistroProprio {
			t.Errorf("%+v", tf)
		}
	}
}
```

Crie `api/internal/meta/auditar_test.go`:

```go
package meta

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/rbv-co/social-dashboard/api/internal/core"
	"github.com/rbv-co/social-dashboard/api/internal/testebanco"
)

func f(v float64) *float64 { return &v }

func TestVereditoComoAEdge(t *testing.T) {
	for _, c := range []struct {
		painel, meta    *float64
		status, detalhe string
	}{
		{nil, f(10), "warn", "sem dado p/ comparar"},
		{f(10), nil, "warn", "sem dado p/ comparar"},
		{f(0), f(51), "fail", "painel=0 vs Meta=51"},
		{f(0), f(50), "fail", "painel=0 vs Meta=50"}, // div = 1 > 0,30
		{f(100), f(80), "warn", "painel=100 vs Meta=80 (25%)"},
		{f(100), f(70), "fail", "painel=100 vs Meta=70"},
		{f(12.5), f(10), "warn", "painel=12.5 vs Meta=10 (25%)"},
		{f(100), f(120), "warn", "painel=100 vs Meta=120 (17%)"},
		{f(100), f(110), "ok", "painel=100 vs Meta=110"},
	} {
		if st, d := veredito(c.painel, c.meta); st != c.status || d != c.detalhe {
			t.Errorf("%v × %v = %s %q", c.painel, c.meta, st, d)
		}
	}
}

func TestAuditoriaChecksSpotcheckEAviso(t *testing.T) {
	p := testebanco.Novo(t)
	ctx := context.Background()
	if _, err := p.Exec(ctx, tabelasColeta); err != nil {
		t.Fatal(err)
	}
	for _, sql := range []string{
		`insert into daily_snapshots values ('` + contaA1 + `', '2026-10-07', 1000, 5, 1), ('` + contaA1 + `', '2026-10-09', 1000, 0, 0),
			('` + contaA1 + `', '2026-10-10', 700, 0, 0)`,
		`insert into engagement_snapshots (account_id, captured_at, period_days, likes, reach, views, total_interactions) values
			('` + contaA1 + `', '2026-10-10', 7, 100, 1000, 1200, 120), ('` + contaA1 + `', '2026-10-10', 14, 90, 900, 1100, 100),
			('` + contaA1 + `', '2026-10-10', 30, 200, 2000, 2500, 230)`,
		`insert into content_snapshots (account_id, captured_at, period_days, posts_count) values ('` + contaA1 + `', '2026-10-10', 0, 1)`,
		// recados que o coletar-dados deixou no dia: NÃO podem ser apagados pela auditoria
		`insert into data_integrity_checks (checked_date, account_id, check_name, status, detail) values
			('2026-10-10', '` + contaA1 + `', 'bruto_seguidores_parado', 'fail', 'Vessel: parou'),
			('2026-10-10', null, 'coleta_zerada', 'fail', 'Breno 0d'),
			('2026-10-10', '` + contaA1 + `', 'frescor', 'fail', 'velho')`,
	} {
		if _, err := p.Exec(ctx, sql); err != nil {
			t.Fatal(err)
		}
	}
	cli, f := coreDeTeste(t, func(pd core.PedidoMeta) (int, string, map[string]string) {
		if pd.Caminho == "/1784/insights" {
			return 200, `{"data":[{"name":"likes","total_value":{"value":120}},{"name":"reach","total_value":{"value":1000}}]}`, nil
		}
		return 400, `{"error":{"message":"conta sem acesso"}}`, nil
	})
	var recebido string
	alerta := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		var m map[string]string
		json.Unmarshal(b, &m)
		recebido = m["text"]
	}))
	t.Cleanup(alerta.Close)
	a := &Auditoria{Pool: p, Core: cli, Alerta: alerta.URL + "/hook-secreto", Agora: func() time.Time { return agoraColeta }}
	if err := a.Rodar(ctx); err != nil {
		t.Fatal(err)
	}
	estado := func(check string) string {
		var s string
		p.QueryRow(ctx, `select status || ' ' || coalesce(detail, '') from data_integrity_checks where check_name = $1 and account_id = $2::uuid`, check, contaA1).Scan(&s)
		return s
	}
	for check, quer := range map[string]string{
		"frescor":          "ok daily=2026-10-10 eng=2026-10-10",
		"bruto_seguidores": "warn ultimo=2026-10-07",
		"aninhamento":      "fail likes 100/90/200",
		"queda_seguidores": "fail hoje=700 ontem=1000",
		"alcance_vs_views": "ok reach=1000 views=1200",
		"meta_spotcheck":   "warn curtidas painel=100 vs Meta=120 (17%) · alcance painel=1000 vs Meta=1000",
	} {
		if got := estado(check); got != quer {
			t.Errorf("%s = %q, esperava %q", check, got, quer)
		}
	}
	var n int
	p.QueryRow(ctx, `select count(*) from data_integrity_checks where check_name in ('bruto_seguidores_parado', 'coleta_zerada')`).Scan(&n)
	if n != 2 {
		t.Fatalf("os recados do coletar-dados sumiram: %d", n)
	}
	if !strings.HasPrefix(recebido, "Saúde dos dados (2026-10-10)\n\n🚨 ") || !strings.Contains(recebido, "• ? · coleta_zerada (Breno 0d)") ||
		!strings.Contains(recebido, "• Vessel · bruto_seguidores_parado (Vessel: parou)") || !strings.Contains(recebido, "⚠️ ") {
		t.Fatalf("aviso = %q", recebido)
	}
	for _, pd := range f.lista() {
		if pd.Caminho == "//insights" || strings.Contains(pd.Caminho, "null") {
			t.Fatalf("conta sem instagram_id não vira pedido: %+v", pd)
		}
	}
}

func TestAuditoriaSemSnapshotsEErro(t *testing.T) {
	p := testebanco.Novo(t)
	p.Exec(context.Background(), tabelasColeta)
	cli, _ := coreDeTeste(t, graphOK(`{}`))
	if err := (&Auditoria{Pool: p, Core: cli}).Rodar(context.Background()); err == nil || err.Error() != "sem snapshots" {
		t.Fatalf("err=%v", err)
	}
	if tf := (&Auditoria{}).Tarefa(); tf.Nome != "auditar-dados" || tf.Agenda != "30 2 * * *" {
		t.Fatalf("%+v", tf)
	}
}

func TestAvisarWebhookNaoVazaAURL(t *testing.T) {
	err := avisarWebhook(context.Background(), &http.Client{Timeout: time.Second}, "http://127.0.0.1:1/hook-secreto-123", "x")
	if err == nil || strings.Contains(err.Error(), "hook-secreto-123") {
		t.Fatalf("err=%v", err)
	}
}
```

Acrescente ao fim de `api/internal/config/config_test.go`:

```go
func TestCarregarAlerta(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://x")
	t.Setenv("ALERT_WEBHOOK_URL", "https://hooks.exemplo/segredo-do-webhook")
	c, _ := Carregar()
	if c.AlertaWebhook != "https://hooks.exemplo/segredo-do-webhook" || !slices.Contains(c.Segredos(), c.AlertaWebhook) {
		t.Fatalf("%+v", c)
	}
}
```

Em `api/cmd/api/worker_test.go`, troque:

```go

}

func TestTarefasDeProducao
```

por:

```go

	// Task 6
	"coletar-dados-07h":  "0 10 * * *",
	"coletar-dados-12h":  "0 15 * * *",
	"coletar-dados-18h":  "0 21 * * *",
	"coletar-dados-2359": "59 2 * * *",
	"auditar-dados":      "30 2 * * *",
}

func TestTarefasDeProducao
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `go test -count=1 ./cmd/api ./internal/config ./internal/meta`
Expected: FAIL. Primeiras falhas, como saíram no ensaio deste plano: `--- FAIL: TestTarefasDeProducao`, `has no field or method AlertaWebhook`, `undefined: ColetaDiaria`, `undefined: veredito`, `undefined: Auditoria`, `undefined: avisarWebhook`

- [ ] **Step 3: Implementar**

Crie `api/internal/meta/coleta.go`:

```go
package meta

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/core"
	"github.com/rbv-co/social-dashboard/api/internal/texto"
	"github.com/rbv-co/social-dashboard/api/internal/worker"
)

// ColetaDiaria porta supabase/functions/coletar-dados + public.disparar_coletor (jobs coletar-dados-07h,
// -12h, -18h e -2359). Uma rodada passa por TODAS as contas que disparar_coletor escolhia
// (instagram_id e access_token preenchidos, em ordem de nome) e grava UMA linha por conta em
// robos_execucoes com o nome de produção 'coletar-dados-<rodada> · <conta>' (a tela casa
// 'coletar-dados%'). A Graph vai pelo core, que é o dono do token: renovarToken não existe mais.
type ColetaDiaria struct {
	Pool   *pgxpool.Pool
	Core   *core.Cliente
	Gravar func(ctx context.Context, robo string, inicio time.Time, erro error) error // worker.Agendador.Gravador()
	Alerta string                                                                     // ALERT_WEBHOOK_URL (opcional; vazio = só a linha em data_integrity_checks)
	HTTP   *http.Client                                                               // para o alerta; nil = prazo de 15 s
	Agora  func() time.Time                                                           // nil = time.Now
	Dormir func(context.Context, time.Duration) error                                 // espera entre releituras; nil = espera de verdade
}

// Tarefas: as 4 rodadas de produção (cron.job, UTC). Dividem a trava: duas rodadas nunca se cruzam.
func (c *ColetaDiaria) Tarefas() []worker.Tarefa {
	rodada := func(nome, agenda string) worker.Tarefa {
		return worker.Tarefa{Nome: "coletar-dados-" + nome, Agenda: agenda, Trava: "coletar-dados", RegistroProprio: true,
			Limite: 50 * time.Minute, Executar: func(ctx context.Context) error { return c.Rodada(ctx, nome) }}
	}
	return []worker.Tarefa{rodada("07h", "0 10 * * *"), rodada("12h", "0 15 * * *"), rodada("18h", "0 21 * * *"), rodada("2359", "59 2 * * *")}
}

// prazoPorConta: uma conta presa não come a rodada inteira (o pg_net dava 140 s por conta; pelo
// core, no ritmo de ~100 chamadas/min, uma conta grande precisa de alguns minutos).
const prazoPorConta = 6 * time.Minute

type contaColeta struct{ id, nome, ig, ad string }

func (c *ColetaDiaria) agora() time.Time {
	if c.Agora != nil {
		return c.Agora()
	}
	return time.Now()
}

func (c *ColetaDiaria) dormir(ctx context.Context, d time.Duration) error {
	if c.Dormir != nil {
		return c.Dormir(ctx, d)
	}
	t := time.NewTimer(d)
	defer t.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-t.C:
		return nil
	}
}

// Rodada coleta todas as contas. A falha de uma conta vira a linha DELA (ok=false) e a rodada segue.
func (c *ColetaDiaria) Rodada(ctx context.Context, rodada string) error {
	linhas, err := c.Pool.Query(ctx, `select id::text, coalesce(name, ''), instagram_id::text, coalesce(ad_account_id::text, '')
		  from accounts where instagram_id is not null and access_token is not null order by name`)
	if err != nil {
		return err
	}
	contas, err := pgx.CollectRows(linhas, func(r pgx.CollectableRow) (x contaColeta, err error) {
		return x, r.Scan(&x.id, &x.nome, &x.ig, &x.ad)
	})
	if err != nil {
		return err
	}
	for _, conta := range contas {
		inicio := c.agora()
		ctxC, cancela := context.WithTimeout(ctx, prazoPorConta)
		erro := c.processarConta(ctxC, conta)
		cancela()
		g, cancelaG := context.WithTimeout(context.WithoutCancel(ctx), 10*time.Second)
		err := c.Gravar(g, fmt.Sprintf("coletar-dados-%s · %s", rodada, conta.nome), inicio, erro)
		cancelaG()
		if err != nil {
			return err
		}
		if ctx.Err() != nil { // o prazo da rodada acabou: o que faltou não foi coletado (a linha da tarefa diz)
			return ctx.Err()
		}
	}
	return nil
}

var periodos = []int{0, 1, 7, 14, 30}

var chavesEng = []string{"likes", "comments", "saves", "shares", "reach", "views", "total_interactions", "accounts_engaged", "profile_views"}

func (c *ColetaDiaria) hoje() string { return c.agora().In(saoPaulo).Format("2006-01-02") }

// menosDias: o dia de São Paulo `n` dias antes de `dia` (brDateMinus da edge).
func menosDias(dia string, n int) string {
	t, _ := time.ParseInLocation("2006-01-02", dia, saoPaulo)
	return t.AddDate(0, 0, -n).Format("2006-01-02")
}

// inicioDoDia: a meia-noite de São Paulo em segundos (`${dia}T00:00:00-03:00` da edge).
func inicioDoDia(dia string) int64 {
	t, _ := time.ParseInLocation("2006-01-02", dia, saoPaulo)
	return t.Unix()
}

func diaDaMeta(ts string) string {
	for _, l := range []string{"2006-01-02T15:04:05-0700", time.RFC3339} {
		if t, err := time.Parse(l, ts); err == nil {
			return t.In(saoPaulo).Format("2006-01-02")
		}
	}
	return ""
}

func (c *ColetaDiaria) processarConta(ctx context.Context, conta contaColeta) error {
	hoje := c.hoje()
	var degradados []string
	j, err := GET(ctx, c.Core, "/"+conta.ig, map[string]any{"fields": "followers_count"})
	if err != nil {
		return err // como a edge: sem a contagem, nada desta conta é coletado nesta rodada
	}
	seguidores := numero(j["followers_count"])
	if _, err := c.Pool.Exec(ctx, `insert into daily_snapshots (account_id, captured_at, followers_count) values ($1::uuid, $2::date, $3::numeric)
		on conflict (account_id, captured_at) do update set followers_count = excluded.followers_count`, conta.id, hoje, seguidores); err != nil {
		return err
	}
	// Cada leitura é uma linha própria (append-only): o movimento DENTRO do dia não se perde.
	if _, err := c.Pool.Exec(ctx, `insert into followers_leituras (account_id, followers_count, origem) values ($1::uuid, $2::numeric, 'diario')`,
		conta.id, seguidores); err != nil {
		return err
	}
	if err := c.brutoDeSeguidores(ctx, conta, hoje); err != nil {
		return err
	}
	st := c.storiesDeHoje(ctx, conta.ig, hoje)
	midias, erroMidias := GET(ctx, c.Core, "/"+conta.ig+"/media", map[string]any{"fields": "id,media_product_type,timestamp,owner", "limit": "100"})
	for _, dias := range periodos {
		posts, reels := 0, 0
		if erroMidias == nil { // uma leitura de /media serve os 5 períodos (a edge pedia a mesma coisa 5 vezes)
			posts, reels = contarMidias(midias, conta.ig, hoje, dias)
		}
		if err := c.gravarEng(ctx, conta, hoje, dias, &degradados); err != nil {
			return err
		}
		sql := `insert into content_snapshots (account_id, captured_at, period_days, posts_count, reels_count)
			values ($1::uuid, $2::date, $3::int, $4::int, $5::int)
			on conflict (account_id, captured_at, period_days) do update set posts_count = excluded.posts_count, reels_count = excluded.reels_count`
		args := []any{conta.id, hoje, dias, posts, reels}
		if dias <= 1 {
			sql = `insert into content_snapshots (account_id, captured_at, period_days, posts_count, reels_count, stories_count, story_shares,
				story_replies, story_reach, story_interactions, story_navigation, story_profile_visits, story_follows,
				story_nav_forward, story_nav_back, story_nav_exit, story_nav_next)
				values ($1::uuid, $2::date, $3::int, $4::int, $5::int, $6::int, $7::numeric, $8::numeric, $9::numeric, $10::numeric,
				  $11::numeric, $12::numeric, $13::numeric, $14::numeric, $15::numeric, $16::numeric, $17::numeric)
				on conflict (account_id, captured_at, period_days) do update set posts_count = excluded.posts_count,
				  reels_count = excluded.reels_count, stories_count = excluded.stories_count, story_shares = excluded.story_shares,
				  story_replies = excluded.story_replies, story_reach = excluded.story_reach, story_interactions = excluded.story_interactions,
				  story_navigation = excluded.story_navigation, story_profile_visits = excluded.story_profile_visits,
				  story_follows = excluded.story_follows, story_nav_forward = excluded.story_nav_forward,
				  story_nav_back = excluded.story_nav_back, story_nav_exit = excluded.story_nav_exit, story_nav_next = excluded.story_nav_next`
			args = append(args, st.quantos, st.shares, st.replies, st.reach, st.interactions, st.navigation, st.profileVisits,
				st.follows, st.navForward, st.navBack, st.navExit, st.navNext)
		}
		if _, err := c.Pool.Exec(ctx, sql, args...); err != nil {
			return err
		}
	}
	if err := c.gravarEng(ctx, conta, hoje, 99, &degradados); err != nil {
		return err
	}
	if conta.ad != "" { // perfil sem ad_account_id não tem anúncios: pula, sem erro
		if err := c.anuncios(ctx, conta, hoje, &degradados); err != nil {
			return err
		}
	}
	c.avisarSuperAdmin(ctx, hoje, degradados)
	return nil
}

// contarMidias: posts e reels do perfil (não collabs de terceiros, não stories) publicados no período.
func contarMidias(j map[string]any, ig, hoje string, dias int) (posts, reels int) {
	de, ate := menosDias(hoje, dias), ""
	switch dias {
	case 0:
		de, ate = hoje, hoje
	case 1:
		de = menosDias(hoje, 1)
		ate = de
	}
	itens, _ := j["data"].([]any)
	for _, x := range itens {
		m, _ := x.(map[string]any)
		dono := ig
		if o, ok := m["owner"].(map[string]any); ok && o["id"] != nil {
			dono = fmt.Sprint(o["id"])
		}
		produto, _ := m["media_product_type"].(string)
		if dono != ig || produto == "STORY" {
			continue
		}
		if ts, _ := m["timestamp"].(string); ts != "" {
			d := diaDaMeta(ts)
			if d < de || (ate != "" && d > ate) {
				continue
			}
		}
		if produto == "REELS" {
			reels++
		} else {
			posts++
		}
	}
	return
}

type stories struct {
	quantos                                                                  int
	shares, replies, reach, interactions, navigation, profileVisits, follows float64
	navForward, navBack, navExit, navNext                                    float64
}

// storiesDeHoje: soma das métricas dos stories publicados HOJE (São Paulo). Erro numa story não conta;
// erro na lista = zeros (como a edge).
func (c *ColetaDiaria) storiesDeHoje(ctx context.Context, ig, hoje string) stories {
	var s stories
	j, err := GET(ctx, c.Core, "/"+ig+"/stories", map[string]any{"fields": "id,timestamp", "limit": "100"})
	if err != nil {
		return s
	}
	itens, _ := j["data"].([]any)
	for _, x := range itens {
		st, _ := x.(map[string]any)
		ts, _ := st["timestamp"].(string)
		if ts == "" || diaDaMeta(ts) != hoje {
			continue
		}
		s.quantos++
		id := fmt.Sprint(st["id"])
		if ins, err := GET(ctx, c.Core, "/"+id+"/insights", map[string]any{"metric": "reach,replies,shares,total_interactions,navigation,profile_visits,follows"}); err == nil {
			lista, _ := ins["data"].([]any)
			for _, y := range lista {
				it, _ := y.(map[string]any)
				v := it["value"]
				if v == nil {
					if vs, _ := it["values"].([]any); len(vs) > 0 {
						v0, _ := vs[0].(map[string]any)
						v = v0["value"]
					}
				}
				n := numero(v)
				switch it["name"] {
				case "shares":
					s.shares += n
				case "replies":
					s.replies += n
				case "reach":
					s.reach += n
				case "total_interactions":
					s.interactions += n
				case "navigation":
					s.navigation += n
				case "profile_visits":
					s.profileVisits += n
				case "follows":
					s.follows += n
				}
			}
		}
		if nb, err := GET(ctx, c.Core, "/"+id+"/insights", map[string]any{"metric": "navigation", "breakdown": "story_navigation_action_type"}); err == nil {
			for _, y := range resultados(primeiro(nb)) {
				r, _ := y.(map[string]any)
				n := numero(r["value"])
				switch dimensao(r) {
				case "tap_forward":
					s.navForward += n
				case "tap_back":
					s.navBack += n
				case "tap_exit":
					s.navExit += n
				case "swipe_forward":
					s.navNext += n
				}
			}
		}
	}
	return s
}

// brutoDeSeguidores: re-lê "seguiram/deixaram" dos 3 dias recentes e de todo dia dos últimos 14 ainda
// 0/0 (buraco de queda do coletor). Dia fechado há 2+ dias sem número = o Instagram parou de publicar:
// fica gravado (bruto_seguidores_parado) e quem avisa, uma vez por dia, é o auditar-dados.
func (c *ColetaDiaria) brutoDeSeguidores(ctx context.Context, conta contaColeta, hoje string) error {
	linhas, err := c.Pool.Query(ctx, `select captured_at::text, coalesce(gained, 0)::float8, coalesce(lost, 0)::float8 from daily_snapshots
		where account_id = $1::uuid and captured_at >= $2::date and captured_at <= $3::date`, conta.id, menosDias(hoje, 14), hoje)
	if err != nil {
		return err
	}
	type linhaDia struct{ ganho, perda float64 }
	dias := map[string]linhaDia{}
	var d string
	var l linhaDia
	if _, err := pgx.ForEachRow(linhas, []any{&d, &l.ganho, &l.perda}, func() error { dias[d] = l; return nil }); err != nil {
		return err
	}
	var semBruto []string
	for dd := 0; dd < 14; dd++ {
		dia := menosDias(hoje, dd)
		row, tem := dias[dia]
		buraco := tem && row.ganho == 0 && row.perda == 0
		if dd >= 3 && !buraco {
			continue // dia antigo já preenchido (ou sem linha): não re-busca; o que tem número conta como publicado
		}
		ate := inicioDoDia(dia) + 86399 // `${dia}T23:59:59-03:00`
		r, err := GET(ctx, c.Core, "/"+conta.ig+"/insights", map[string]any{"metric": "follows_and_unfollows", "period": "day",
			"metric_type": "total_value", "breakdown": "follow_type", "since": strconv.FormatInt(inicioDoDia(dia), 10), "until": strconv.FormatInt(ate, 10)})
		publicado, seguiu, deixou := false, 0.0, 0.0
		if err == nil {
			publicado, seguiu, deixou = lerBrutoDoDia(r)
		}
		if !publicado {
			if dia <= menosDias(hoje, 2) { // o de hoje e o de ontem ainda podem estar sem número (atraso normal da Meta)
				semBruto = append(semBruto, dia)
			}
			continue
		}
		if _, err := c.Pool.Exec(ctx, `update daily_snapshots set gained = $3::numeric, lost = $4::numeric where account_id = $1::uuid and captured_at = $2::date`,
			conta.id, dia, seguiu, deixou); err != nil {
			return err
		}
	}
	if len(semBruto) == 0 {
		return nil
	}
	desde := semBruto[len(semBruto)-1] // o dia fechado mais antigo (o laço vai de hoje para trás)
	plural := "dias"
	if len(semBruto) == 1 {
		plural = "dia"
	}
	recado := fmt.Sprintf("%s: o Instagram não publica seguiram/deixaram desde %s/%s (%d %s sem número)", conta.nome, desde[8:10], desde[5:7], len(semBruto), plural)
	return pgx.BeginFunc(ctx, c.Pool, func(tx pgx.Tx) error { // regravável: fica sempre a leitura mais nova do dia
		if _, err := tx.Exec(ctx, `delete from data_integrity_checks where checked_date = $1::date and check_name = 'bruto_seguidores_parado' and account_id = $2::uuid`,
			hoje, conta.id); err != nil {
			return err
		}
		_, err := tx.Exec(ctx, `insert into data_integrity_checks (checked_date, account_id, status, check_name, detail) values ($1::date, $2::uuid, 'fail', 'bruto_seguidores_parado', $3::text)`,
			hoje, conta.id, texto.CortarUTF16(recado, 900))
		return err
	})
}

// ── engajamento (leitura-de-engajamento.js) ─────────────────────────────────────────────────────

type eng map[string]float64

func somaDoDetalhe(l eng) float64 { return l["likes"] + l["comments"] + l["saves"] + l["shares"] }

// leituraParcial: a Meta às vezes manda o detalhamento PELA METADE (curtidas zeradas com o total
// certo). Zero curtidas com 50+ interações não é explicável (piso medido em produção).
func leituraParcial(l eng) bool {
	if l == nil || l["total_interactions"] <= 0 {
		return false
	}
	return somaDoDetalhe(l) == 0 || (l["likes"] == 0 && l["total_interactions"] >= 50)
}

func leituraServe(l eng) bool { return l != nil && l["reach"] > 0 && !leituraParcial(l) }

func rotulo(dias int) string {
	if dias == 99 {
		return "mês"
	}
	return fmt.Sprintf("%dd", dias)
}

// engajamento lê as 9 métricas da conta no período; nil = a Meta não respondeu.
func (c *ColetaDiaria) engajamento(ctx context.Context, ig, hoje string, dias int) eng {
	agora := c.agora().Unix()
	var de, ate int64
	switch dias {
	case 0:
		de, ate = inicioDoDia(hoje), agora
	case 1:
		de, ate = inicioDoDia(menosDias(hoje, 1)), inicioDoDia(hoje)
	case 99:
		de, ate = inicioDoDia(hoje[:7]+"-01"), agora
	default: // últimos N dias COMPLETOS (fecha à meia-noite de São Paulo, = "Últimos N dias" do Business Suite)
		de, ate = inicioDoDia(menosDias(hoje, dias)), inicioDoDia(hoje)
	}
	j, err := GET(ctx, c.Core, "/"+ig+"/insights", map[string]any{
		"metric": "likes,comments,saves,shares,reach,views,total_interactions,accounts_engaged,profile_views", "period": "day",
		"metric_type": "total_value", "since": strconv.FormatInt(de, 10), "until": strconv.FormatInt(ate, 10)})
	if err != nil {
		return nil
	}
	v := eng{}
	itens, _ := j["data"].([]any)
	for _, x := range itens {
		it, _ := x.(map[string]any)
		nome, _ := it["name"].(string)
		tv, _ := it["total_value"].(map[string]any)
		v[nome] = numero(tv["value"])
	}
	return v
}

// gravarEng: grava o período; leitura pela metade não é gravada (vira degradado e fica o último bom).
func (c *ColetaDiaria) gravarEng(ctx context.Context, conta contaColeta, hoje string, dias int, degradados *[]string) error {
	if dias == 0 { // "hoje" é reescrito 4x por dia e só cresce: na dúvida, NÃO sobrescreve
		var v eng
		for i := range 4 {
			v = c.engajamento(ctx, conta.ig, hoje, 0)
			if !leituraParcial(v) {
				break
			}
			if i < 3 {
				if err := c.dormir(ctx, time.Duration(300*(i+1))*time.Millisecond); err != nil {
					return err
				}
			}
		}
		if leituraParcial(v) {
			*degradados = append(*degradados, conta.nome+" "+rotulo(0))
			return nil
		}
		return c.upsertEng(ctx, conta.id, hoje, 0, v)
	}
	var ultima eng
	ok := false
	for i := range 5 {
		ultima = c.engajamento(ctx, conta.ig, hoje, dias)
		if leituraServe(ultima) {
			ok = true
			break
		}
		if i < 4 {
			if err := c.dormir(ctx, time.Duration(350*(i+1))*time.Millisecond); err != nil {
				return err
			}
		}
	}
	junto := eng{}
	for k, x := range ultima {
		junto[k] = x
	}
	if ultima == nil {
		junto = nil
	}
	if !ok {
		prev, err := c.ultimoBom(ctx, conta.id, dias)
		if err != nil {
			return err
		}
		switch {
		case prev != nil:
			if junto == nil {
				junto = eng{}
			}
			for _, k := range chavesEng {
				if !(junto[k] > 0) {
					junto[k] = prev[k]
				}
			}
			if dias != 1 { // 1d não alerta: o painel mostra 2D e um dia quieto é normal
				*degradados = append(*degradados, conta.nome+" "+rotulo(dias))
			}
		case junto == nil || !(junto["reach"] > 0) || leituraParcial(junto):
			if dias != 1 {
				*degradados = append(*degradados, conta.nome+" "+rotulo(dias)+" (sem histórico)")
			}
			return nil
		}
	}
	return c.upsertEng(ctx, conta.id, hoje, dias, junto)
}

// ultimoBom: a linha mais recente (das últimas 30 com alcance) que passa no leituraServe; nil se
// nenhuma presta (não ter valor é melhor que copiar um errado para a frente).
func (c *ColetaDiaria) ultimoBom(ctx context.Context, conta string, dias int) (eng, error) {
	linhas, err := c.Pool.Query(ctx, `select coalesce(likes, 0)::float8, coalesce(comments, 0)::float8, coalesce(saves, 0)::float8,
			coalesce(shares, 0)::float8, coalesce(reach, 0)::float8, coalesce(views, 0)::float8, coalesce(total_interactions, 0)::float8,
			coalesce(accounts_engaged, 0)::float8, coalesce(profile_views, 0)::float8
		  from engagement_snapshots where account_id = $1::uuid and period_days = $2::int and reach > 0
		 order by captured_at desc limit 30`, conta, dias)
	if err != nil {
		return nil, err
	}
	defer linhas.Close()
	for linhas.Next() {
		vs := make([]float64, len(chavesEng))
		ptrs := make([]any, len(vs))
		for i := range vs {
			ptrs[i] = &vs[i]
		}
		if err := linhas.Scan(ptrs...); err != nil {
			return nil, err
		}
		l := eng{}
		for i, k := range chavesEng {
			l[k] = vs[i]
		}
		if leituraServe(l) {
			return l, nil
		}
	}
	return nil, linhas.Err()
}

// upsertEng grava só as métricas presentes (engCols da edge); as colunas vêm da lista fixa chavesEng.
func (c *ColetaDiaria) upsertEng(ctx context.Context, conta, hoje string, dias int, v eng) error {
	var cols, vals, sets []string
	args := []any{conta, hoje, dias}
	for _, k := range chavesEng {
		x, ok := v[k]
		if !ok {
			continue
		}
		args = append(args, x)
		cols = append(cols, k)
		vals = append(vals, fmt.Sprintf("$%d::numeric", len(args)))
		sets = append(sets, k+" = excluded."+k)
	}
	if len(cols) == 0 {
		return nil
	}
	_, err := c.Pool.Exec(ctx, `insert into engagement_snapshots (account_id, captured_at, period_days, `+strings.Join(cols, ", ")+`)
		values ($1::uuid, $2::date, $3::int, `+strings.Join(vals, ", ")+`)
		on conflict (account_id, captured_at, period_days) do update set `+strings.Join(sets, ", "), args...)
	return err
}

// avisarSuperAdmin: métricas zeradas/inconsistentes viram UMA linha 'coleta_zerada' (e o webhook, se
// houver). É aviso: falhar aqui não derruba a conta.
func (c *ColetaDiaria) avisarSuperAdmin(ctx context.Context, hoje string, degradados []string) {
	if len(degradados) == 0 {
		return
	}
	msg := "⚠️ Coleta IG: a Meta retornou métricas zeradas/inconsistentes (alcance 0 ou likes/comments/saves/shares zerados com interações>0) mesmo após 5 tentativas em: " +
		strings.Join(degradados, " · ") + ". Mantive o valor mais recente válido (não zerei o painel). Verificar token/permissões da Meta."
	if _, err := c.Pool.Exec(ctx, `insert into data_integrity_checks (checked_date, status, check_name, detail) values ($1::date, 'fail', 'coleta_zerada', $2::text)`,
		hoje, texto.CortarUTF16(msg, 900)); err != nil {
		slog.Error("coletar-dados: alerta no banco", "erro", err)
	}
	if err := avisarWebhook(ctx, c.HTTP, c.Alerta, msg); err != nil {
		slog.Error("coletar-dados: webhook de alerta", "erro", err)
	}
}

// avisarWebhook manda {text, content} (Slack e Discord) a ALERT_WEBHOOK_URL. A URL é segredo: o erro
// devolvido nunca a contém.
func avisarWebhook(ctx context.Context, cli *http.Client, alvo, msg string) error {
	if alvo == "" {
		return nil
	}
	corpo, _ := json.Marshal(map[string]string{"text": msg, "content": msg})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, alvo, bytes.NewReader(corpo))
	if err != nil {
		return errors.New("ALERT_WEBHOOK_URL inválida")
	}
	req.Header.Set("Content-Type", "application/json")
	if cli == nil {
		cli = &http.Client{Timeout: 15 * time.Second}
	}
	r, err := cli.Do(req)
	if err != nil {
		var ue *url.Error
		if errors.As(err, &ue) {
			err = ue.Err
		}
		return err
	}
	r.Body.Close()
	if r.StatusCode >= 300 {
		return fmt.Errorf("webhook de alerta respondeu %d", r.StatusCode)
	}
	return nil
}
```

Crie `api/internal/meta/coleta_anuncios.go`:

```go
package meta

import "context"

// anuncios: a parte de anúncios de coletar-dados (campanhas, anúncios, conjuntos e insights por
// campanha) — implementada na Task 7.
func (c *ColetaDiaria) anuncios(ctx context.Context, conta contaColeta, hoje string, degradados *[]string) error {
	return nil
}
```

Crie `api/internal/meta/auditar.go`:

```go
package meta

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"math"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/core"
	"github.com/rbv-co/social-dashboard/api/internal/worker"
)

// Auditoria porta supabase/functions/auditar-dados (job integridade-diaria, robô 'auditar-dados') e
// REESCREVE public.run_integrity_checks aqui: os mesmos 7 checks, no mesmo SQL, numa transação.
type Auditoria struct {
	Pool   *pgxpool.Pool
	Core   *core.Cliente
	Alerta string           // ALERT_WEBHOOK_URL (opcional): UM recado por dia com fails e warns
	HTTP   *http.Client     // para o alerta; nil = prazo de 15 s
	Agora  func() time.Time // nil = time.Now
}

func (a *Auditoria) Tarefa() worker.Tarefa {
	return worker.Tarefa{Nome: "auditar-dados", Agenda: "30 2 * * *", Limite: 5 * time.Minute, Executar: a.Rodar}
}

// checksInternos: os nomes que esta auditoria grava (e só estes ela apaga antes de regravar).
var checksInternos = []string{"frescor", "bruto_seguidores", "eng_likes0", "aninhamento", "nav_soma", "queda_seguidores", "alcance_vs_views"}

// integridade: o corpo de run_integrity_checks (levantamento 02-funções.csv), com v_today = $1.
var integridade = []string{
	`insert into data_integrity_checks(checked_date,account_id,check_name,status,detail)
	select $1::date, a.id, 'frescor',
	  case when (select max(captured_at) from daily_snapshots where account_id=a.id)=$1::date
	        and (select max(captured_at) from engagement_snapshots where account_id=a.id)=$1::date
	        and (select max(captured_at) from content_snapshots where account_id=a.id)=$1::date then 'ok' else 'fail' end,
	  'daily='||coalesce((select max(captured_at)::text from daily_snapshots where account_id=a.id),'-')||' eng='||coalesce((select max(captured_at)::text from engagement_snapshots where account_id=a.id),'-')
	from accounts a`,
	`insert into data_integrity_checks(checked_date,account_id,check_name,status,detail)
	select $1::date, a.id, 'bruto_seguidores',
	  case when coalesce((select max(captured_at) from daily_snapshots where account_id=a.id and (coalesce(gained,0)>0 or coalesce(lost,0)>0)), date '2000-01-01') >= $1::date-2 then 'ok' else 'warn' end,
	  'ultimo='||coalesce((select max(captured_at)::text from daily_snapshots where account_id=a.id and (coalesce(gained,0)>0 or coalesce(lost,0)>0)),'nunca')
	from accounts a`,
	`insert into data_integrity_checks(checked_date,account_id,check_name,status,detail)
	select $1::date, e.account_id, 'eng_likes0',
	  case when count(*) filter (where e.likes=0 and e.total_interactions>50)>0 then 'fail' else 'ok' end,
	  coalesce(string_agg(distinct case when e.likes=0 and e.total_interactions>50 then 'p'||e.period_days end, ','),'')
	from engagement_snapshots e where e.captured_at=$1::date group by e.account_id`,
	`insert into data_integrity_checks(checked_date,account_id,check_name,status,detail)
	select $1::date, x.account_id, 'aninhamento',
	  case when coalesce(l7,0)<=coalesce(l14,0) and coalesce(l14,0)<=coalesce(l30,0) and coalesce(r7,0)<=coalesce(r14,0) and coalesce(r14,0)<=coalesce(r30,0) then 'ok' else 'fail' end,
	  'likes '||coalesce(l7,0)||'/'||coalesce(l14,0)||'/'||coalesce(l30,0)
	from (select account_id,
	    max(likes) filter(where period_days=7) l7,max(likes) filter(where period_days=14) l14,max(likes) filter(where period_days=30) l30,
	    max(reach) filter(where period_days=7) r7,max(reach) filter(where period_days=14) r14,max(reach) filter(where period_days=30) r30
	  from engagement_snapshots where captured_at=$1::date and period_days in (7,14,30) group by account_id) x`,
	`insert into data_integrity_checks(checked_date,account_id,check_name,status,detail)
	select $1::date, c.account_id, 'nav_soma',
	  case when bool_and(c.story_navigation=c.story_nav_forward+c.story_nav_back+c.story_nav_exit+c.story_nav_next) then 'ok' else 'fail' end, ''
	from content_snapshots c where c.captured_at=$1::date and c.period_days=1 and c.stories_count>0 group by c.account_id`,
	`insert into data_integrity_checks(checked_date,account_id,check_name,status,detail)
	select $1::date, a.id, 'queda_seguidores',
	  case when x.yc>0 and (x.yc-x.tc)::float/x.yc > 0.25 then 'fail'
	       when x.yc>0 and (x.yc-x.tc)::float/x.yc > 0.10 then 'warn' else 'ok' end,
	  'hoje='||coalesce(x.tc,0)||' ontem='||coalesce(x.yc,0)
	from accounts a cross join lateral (
	  select (select followers_count from daily_snapshots where account_id=a.id and captured_at=$1::date) tc,
	         (select followers_count from daily_snapshots where account_id=a.id and captured_at<$1::date order by captured_at desc limit 1) yc) x`,
	`insert into data_integrity_checks(checked_date,account_id,check_name,status,detail)
	select $1::date, e.account_id, 'alcance_vs_views',
	  case when (e.views>0 and e.reach=0) or (e.reach > e.views + 5) then 'fail' else 'ok' end,
	  'reach='||e.reach||' views='||e.views
	from engagement_snapshots e where e.captured_at=$1::date and e.period_days=7`,
}

// veredito: o valor do painel contra a Meta ao vivo (verdict() da edge).
func veredito(painel, meta *float64) (string, string) {
	if painel == nil || meta == nil {
		return "warn", "sem dado p/ comparar"
	}
	f := func(v float64) string { return strconv.FormatFloat(v, 'f', -1, 64) }
	div := math.Abs(*painel-*meta) / math.Max(*meta, 1)
	switch {
	case (*painel == 0 && *meta > 50) || div > 0.30:
		return "fail", fmt.Sprintf("painel=%s vs Meta=%s", f(*painel), f(*meta))
	case div > 0.15:
		return "warn", fmt.Sprintf("painel=%s vs Meta=%s (%d%%)", f(*painel), f(*meta), int64(math.Floor(div*100+0.5)))
	}
	return "ok", fmt.Sprintf("painel=%s vs Meta=%s", f(*painel), f(*meta))
}

func (a *Auditoria) Rodar(ctx context.Context) error {
	var hoje *string
	if err := a.Pool.QueryRow(ctx, `select max(captured_at)::text from daily_snapshots`).Scan(&hoje); err != nil {
		return err
	}
	if hoje == nil {
		return errors.New("sem snapshots")
	}
	// 1) Checks internos. Só os nomes que a auditoria grava são apagados antes: os recados que o
	//    coletar-dados deixou no dia (coleta_zerada, bruto_seguidores_parado) entram no aviso abaixo.
	err := pgx.BeginFunc(ctx, a.Pool, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `delete from data_integrity_checks where checked_date = $1::date and check_name = any($2::text[])`, *hoje, checksInternos); err != nil {
			return err
		}
		for _, sql := range integridade {
			if _, err := tx.Exec(ctx, sql, *hoje); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return fmt.Errorf("run_integrity_checks: %w", err)
	}
	// 2) Spot-check contra a Meta ao vivo (curtidas + alcance, 7 dias).
	linhas, err := a.Pool.Query(ctx, `select id::text, coalesce(name, ''), coalesce(instagram_id::text, '') from accounts order by name`)
	if err != nil {
		return err
	}
	type contaAud struct{ id, nome, ig string }
	contas, err := pgx.CollectRows(linhas, func(r pgx.CollectableRow) (c contaAud, err error) { return c, r.Scan(&c.id, &c.nome, &c.ig) })
	if err != nil {
		return err
	}
	if _, err := a.Pool.Exec(ctx, `delete from data_integrity_checks where checked_date = $1::date and check_name = 'meta_spotcheck'`, *hoje); err != nil {
		return err
	}
	agora := time.Now
	if a.Agora != nil {
		agora = a.Agora
	}
	ate := agora().Unix()
	for _, c := range contas {
		var metaLikes, metaReach *float64
		if c.ig != "" {
			if j, err := GET(ctx, a.Core, "/"+c.ig+"/insights", map[string]any{"metric": "likes,reach", "period": "day", "metric_type": "total_value",
				"since": strconv.FormatInt(ate-7*86400, 10), "until": strconv.FormatInt(ate, 10)}); err == nil {
				itens, _ := j["data"].([]any)
				for _, x := range itens {
					it, _ := x.(map[string]any)
					tv, _ := it["total_value"].(map[string]any)
					if tv["value"] == nil {
						continue
					}
					v := numero(tv["value"])
					switch it["name"] {
					case "likes":
						metaLikes = &v
					case "reach":
						metaReach = &v
					}
				}
			} else {
				slog.Warn("auditar-dados: Meta", "conta", c.nome, "erro", err)
			}
		}
		var sLikes, sReach *float64
		err := a.Pool.QueryRow(ctx, `select likes::float8, reach::float8 from engagement_snapshots
			where account_id = $1::uuid and captured_at = $2::date and period_days = 7 limit 1`, c.id, *hoje).Scan(&sLikes, &sReach)
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return err
		}
		vl, dl := veredito(sLikes, metaLikes)
		vr, dr := veredito(sReach, metaReach)
		pior := "ok"
		if vl == "fail" || vr == "fail" {
			pior = "fail"
		} else if vl == "warn" || vr == "warn" {
			pior = "warn"
		}
		if _, err := a.Pool.Exec(ctx, `insert into data_integrity_checks (checked_date, account_id, check_name, status, detail)
			values ($1::date, $2::uuid, 'meta_spotcheck', $3::text, $4::text)`, *hoje, c.id, pior, "curtidas "+dl+" · alcance "+dr); err != nil {
			return err
		}
	}
	// 3) UM recado por dia com fails E warns (o warn entrou em 2026-08-06: sabia e não contava).
	linhas, err = a.Pool.Query(ctx, `select coalesce(nullif(a.name, ''), nullif(a.instagram_id::text, ''), '?'), d.check_name, coalesce(d.detail, ''), d.status
		  from data_integrity_checks d left join accounts a on a.id = d.account_id
		 where d.checked_date = $1::date and d.status in ('fail', 'warn')
		 order by d.status, d.check_name, 1`, *hoje)
	if err != nil {
		return err
	}
	var fails, warns []string
	var nome, check, detalhe, status string
	if _, err := pgx.ForEachRow(linhas, []any{&nome, &check, &detalhe, &status}, func() error {
		l := "• " + nome + " · " + check
		if detalhe != "" {
			l += " (" + detalhe + ")"
		}
		if status == "fail" {
			fails = append(fails, l)
		} else {
			warns = append(warns, l)
		}
		return nil
	}); err != nil {
		return err
	}
	slog.Info("auditar-dados", "dia", *hoje, "fails", len(fails), "warns", len(warns))
	if len(fails)+len(warns) > 0 {
		var partes []string
		if len(fails) > 0 {
			partes = append(partes, fmt.Sprintf("🚨 %d falha(s):\n", len(fails))+strings.Join(fails, "\n"))
		}
		if len(warns) > 0 {
			partes = append(partes, fmt.Sprintf("⚠️ %d aviso(s):\n", len(warns))+strings.Join(warns, "\n"))
		}
		if err := avisarWebhook(ctx, a.HTTP, a.Alerta, "Saúde dos dados ("+*hoje+")\n\n"+strings.Join(partes, "\n\n")); err != nil {
			slog.Error("auditar-dados: webhook de alerta", "erro", err)
		}
	}
	return nil
}
```

Em `api/internal/config/config.go`, troque:

```go
	// Plano 4 (worker).
	WorkerAddr     string // WORKER_ADDR: endereço do GET /saude e /metricas do worker; vazio = sem HTTP
	RDStationToken string // RD_STATION_TOKEN: token público da RD Station (vessel-rd-station)
	ArquivosDir    string // ARQUIVOS_DIR: raiz dos buckets no disco (spec §7); padrão /var/lib/api/arquivos
}
```

por:

```go
	// Plano 4 (worker).
	WorkerAddr     string // WORKER_ADDR: endereço do GET /saude e /metricas do worker; vazio = sem HTTP
	RDStationToken string // RD_STATION_TOKEN: token público da RD Station (vessel-rd-station)
	ArquivosDir    string // ARQUIVOS_DIR: raiz dos buckets no disco (spec §7); padrão /var/lib/api/arquivos
	AlertaWebhook  string // ALERT_WEBHOOK_URL: recados de coleta zerada e da auditoria (opcional; é segredo)
}
```

Em `api/internal/config/config.go`, troque:

```go
		TarefasDesligadas: lista("WORKER_TAREFAS_DESLIGADAS"),
		WorkerAddr:        strings.TrimSpace(os.Getenv("WORKER_ADDR")),
		RDStationToken:    strings.TrimSpace(os.Getenv("RD_STATION_TOKEN")),
		ArquivosDir:       strings.TrimSpace(os.Getenv("ARQUIVOS_DIR")),
	}
```

por:

```go
		TarefasDesligadas: lista("WORKER_TAREFAS_DESLIGADAS"),
		WorkerAddr:        strings.TrimSpace(os.Getenv("WORKER_ADDR")),
		RDStationToken:    strings.TrimSpace(os.Getenv("RD_STATION_TOKEN")),
		ArquivosDir:       strings.TrimSpace(os.Getenv("ARQUIVOS_DIR")),
		AlertaWebhook:     strings.TrimSpace(os.Getenv("ALERT_WEBHOOK_URL")),
	}
```

Em `api/internal/config/config.go`, troque:

```go
	return append([]string{c.CoreToken, c.ChatwootSegredo, c.VAPIDPrivada, c.RDStationToken}, c.ShopifySegredos...)
```

por:

```go
	return append([]string{c.CoreToken, c.ChatwootSegredo, c.VAPIDPrivada, c.RDStationToken, c.AlertaWebhook}, c.ShopifySegredos...)
```

Em `api/cmd/api/tarefas.go`, troque:

```go
	return ts
}
```

por:

```go
	ts = append(ts, (&meta.ColetaDiaria{Pool: p, Core: cli, Gravar: ag.Gravador(), Alerta: cfg.AlertaWebhook}).Tarefas()...)
	ts = append(ts, (&meta.Auditoria{Pool: p, Core: cli, Alerta: cfg.AlertaWebhook}).Tarefa())
	return ts
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `gofmt -l . && go vet ./... && go test -race -count=1 ./internal/meta/ ./internal/config/ ./cmd/api/ -v 2>&1 | grep -E -- '^(ok|FAIL|--- FAIL|--- SKIP)'`
Expected: `gofmt` não lista nada; só linhas `ok`, nenhuma `FAIL` nem `--- SKIP`.

- [ ] **Step 5: Commit**

```bash
git add api/internal/meta/coleta.go api/internal/meta/coleta_anuncios.go api/internal/meta/coleta_test.go api/internal/meta/auditar.go api/internal/meta/auditar_test.go api/internal/config/config.go api/internal/config/config_test.go api/cmd/api/tarefas.go api/cmd/api/worker_test.go
git commit -m "feat(api): coletar-dados (Instagram, uma linha por conta) e auditar-dados com run_integrity_checks em Go

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 7: `coletar-dados` (anúncios), `meta-hora` e `meta-hora-retentativa-00h`

**Revisor:** padrão.

- Anúncios do `coletar-dados` (substitui o esboço da Task 6): campanhas, anúncios (com o link de destino do criativo), conjuntos e insights por campanha nas janelas da edge, com a conversão numérica do JS (`parseInt`/`parseFloat` em `inteiroJS`/`floatJS`) e as contagens de ações (`conversas`, `cadastros`, `compras`, `visitas`).
- `meta-hora` (`5 * * * *`) e `meta-hora-retentativa-00h` (`30 3 * * *`), trava comum `coletar-dados-hora`, 10 min: porta `supabase/functions/coletar-dados-hora/index.ts`. Por conta de anúncio: gasto, conversas e cliques DESTA hora (delta contra a última leitura do dia, nunca negativo), seguidores (`followers_leituras` origem `hora`), visitas ao perfil e, nas campanhas "outro", gasto e clique por anúncio. A hora gravada é a de parede de São Paulo; às 00:05 o dia é o NOVO e a hora é 0. Havia conta e nada foi coletado = erro (a edge devolvia 500), inclusive às 00:05, quando a repescagem das 00h30 cobre.

**Files:**
- Modify (arquivo inteiro): `api/internal/meta/coleta_anuncios.go`
- Create: `api/internal/meta/hora.go`
- Test: `api/internal/meta/hora_test.go`
- Modify: `api/cmd/api/tarefas.go`
- Test (modify): `api/cmd/api/worker_test.go`

**Interfaces:**
- Consumes: `ColetaDiaria`, `contaColeta`, `tabelasColeta`, `agoraColeta`, `ambienteColeta`, `graphDaColeta` (Task 6); `meta.GET`/`Paginas`, `coreDeTeste` (Task 3); `worker.Tarefa` (Task 1).
- Produces:
  - `type meta.ColetaHora struct { Pool; Core *core.Cliente; Agora func() time.Time }` com `Tarefas() []worker.Tarefa` (`meta-hora` e `meta-hora-retentativa-00h`) e `Rodar(ctx) error`.
  - Nos testes: `tabelasAnuncios` (DDL de `campaigns`, `ads`, `campaign_adsets`, `campaign_insights*`, `perfil_visitas_hora`, `ad_insights_hora`), usada pela Task 8.

- [ ] **Step 1: Escrever os testes que falham**

Crie `api/internal/meta/hora_test.go`:

```go
package meta

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/core"
	"github.com/rbv-co/social-dashboard/api/internal/testebanco"
)

// Tabelas de hora como nas migrations 2026-09-11/12/18 (campaign_insights_hora, perfil_visitas_hora,
// ad_insights_hora, ads); campaigns e campaign_insights são anteriores às migrations (colunas usadas).
const tabelasAnuncios = `
create table campaigns (campaign_id text primary key, account_id uuid, name text, objective text, status text, synced_at date);
create table ads (ad_id text primary key, campaign_id text not null, account_id uuid not null, name text not null default '',
  status text not null default '', destino_link text, synced_at date not null default current_date);
create table campaign_adsets (adset_id text primary key, campaign_id text not null, account_id uuid not null, destination_type text,
  optimization_goal text, synced_at date not null default current_date);
create table campaign_insights (campaign_id text not null, account_id uuid not null, captured_at date not null, period_days int not null,
  spend numeric, impressions bigint, clicks bigint, reach bigint, post_engagement int, likes int, comments int, shares int, saves int,
  conversas int, cadastros int, compras int, visitas int, unique (campaign_id, account_id, captured_at, period_days));
create table campaign_insights_hora (campaign_id text not null, account_id uuid not null, dia date not null,
  hora smallint not null check (hora between 0 and 23), gasto_acumulado numeric(12,2) not null default 0,
  conversas_acumuladas integer not null default 0, gasto_hora numeric(12,2) not null default 0, conversas_hora integer not null default 0,
  coletado_em timestamptz not null default now(), cliques_acumulados integer not null default 0, cliques_hora integer not null default 0,
  unique (campaign_id, account_id, dia, hora));
create table perfil_visitas_hora (account_id uuid not null, dia date not null, hora smallint not null check (hora between 0 and 23),
  visitas_acumuladas integer not null default 0, visitas_hora integer not null default 0, coletado_em timestamptz not null default now(),
  unique (account_id, dia, hora));
create table ad_insights_hora (ad_id text not null, campaign_id text not null, account_id uuid not null, dia date not null,
  hora smallint not null check (hora between 0 and 23), gasto_acumulado numeric not null default 0, gasto_hora numeric not null default 0,
  cliques_acumulados integer not null default 0, cliques_hora integer not null default 0, coletado_em timestamptz not null default now(),
  unique (ad_id, account_id, dia, hora));`

func graphDaHora(gasto string) func(core.PedidoMeta) (int, string, map[string]string) {
	return func(p core.PedidoMeta) (int, string, map[string]string) {
		m := func(k string) string { s, _ := p.Parametros[k].(string); return s }
		switch {
		case p.Caminho == "/act_999/insights" && m("level") == "campaign":
			if gasto == "" {
				return 200, `{"data":[]}`, nil // 00:05: a Meta ainda não processou o dia
			}
			return 200, `{"data":[{"campaign_id":"c-wpp","spend":"` + gasto + `","actions":[{"action_type":"onsite_conversion.messaging_conversation_started_7d","value":"7"},{"action_type":"link_click","value":"30"}]}]}`, nil
		case p.Caminho == "/act_999/insights" && m("level") == "ad":
			return 200, `{"data":[{"ad_id":"ad-outro","campaign_id":"c-axiom","spend":"4.5","actions":[{"action_type":"link_click","value":"9"}]},
				{"ad_id":"ad-wpp","campaign_id":"c-wpp","spend":"9","actions":[]}]}`, nil
		case p.Caminho == "/1784" && m("fields") == "followers_count":
			return 200, `{"followers_count":24350}`, nil
		case p.Caminho == "/1784/insights" && m("metric") == "profile_views":
			return 200, `{"data":[{"name":"profile_views","total_value":{"value":40}}]}`, nil
		}
		return 404, `{"erro":"rota de teste desconhecida"}`, nil
	}
}

func ambienteHora(t *testing.T, gasto string, agora time.Time) (*ColetaHora, *pgxpool.Pool) {
	t.Helper()
	p := testebanco.Novo(t)
	ctx := context.Background()
	if _, err := p.Exec(ctx, tabelasColeta+tabelasAnuncios); err != nil {
		t.Fatal(err)
	}
	for _, sql := range []string{
		`update accounts set ad_account_id = '999' where id = '` + contaA1 + `'`,
		`insert into campaigns values ('c-wpp', '` + contaA1 + `', '[CAMPANHA WPP] Leads', '', '', null), ('c-axiom', '` + contaA1 + `', 'AXIOM bolsas', '', '', null)`,
		`insert into ads (ad_id, campaign_id, account_id, destino_link) values ('ad-outro', 'c-axiom', '` + contaA1 + `', 'https://loja/x'),
			('ad-wpp', 'c-wpp', '` + contaA1 + `', 'https://loja/y')`,
	} {
		if _, err := p.Exec(ctx, sql); err != nil {
			t.Fatal(err)
		}
	}
	cli, _ := coreDeTeste(t, graphDaHora(gasto))
	return &ColetaHora{Pool: p, Core: cli, Agora: func() time.Time { return agora }}, p
}

func TestMetaHoraDeltaContraAHoraAnterior(t *testing.T) {
	ch, p := ambienteHora(t, "25.5", time.Date(2026, 10, 10, 14, 5, 0, 0, time.UTC)) // 11:05 em SP
	ctx := context.Background()
	p.Exec(ctx, `insert into campaign_insights_hora (campaign_id, account_id, dia, hora, gasto_acumulado, conversas_acumuladas, cliques_acumulados)
		values ('c-wpp', '`+contaA1+`', '2026-10-10', 10, 20, 5, 40), ('c-wpp', '`+contaA1+`', '2026-10-10', 9, 10, 2, 10)`)
	p.Exec(ctx, `insert into perfil_visitas_hora (account_id, dia, hora, visitas_acumuladas) values ('`+contaA1+`', '2026-10-10', 10, 31)`)
	if err := ch.Rodar(ctx); err != nil {
		t.Fatal(err)
	}
	var gastoHora float64
	var conversasHora, cliquesHora, hora int
	p.QueryRow(ctx, `select gasto_hora::float8, conversas_hora, cliques_hora, hora from campaign_insights_hora where hora = 11`).Scan(&gastoHora, &conversasHora, &cliquesHora, &hora)
	if gastoHora != 5.5 || conversasHora != 2 || cliquesHora != 0 || hora != 11 {
		t.Fatalf("delta contra a hora 10 (nunca negativo): gasto=%v conversas=%d cliques=%d hora=%d", gastoHora, conversasHora, cliquesHora, hora)
	}
	var visitas, leituras int
	p.QueryRow(ctx, `select visitas_hora from perfil_visitas_hora where hora = 11`).Scan(&visitas)
	p.QueryRow(ctx, `select count(*) from followers_leituras where origem = 'hora'`).Scan(&leituras)
	if visitas != 9 || leituras != 1 {
		t.Fatalf("visitas_hora=%d leituras=%d", visitas, leituras)
	}
	var anuncios string
	p.QueryRow(ctx, `select string_agg(ad_id || '=' || cliques_hora, ',') from ad_insights_hora`).Scan(&anuncios)
	if anuncios != "ad-outro=9" {
		t.Fatalf("só anúncios de campanha 'outro': %q", anuncios)
	}
	// Segunda rodada NA MESMA hora: atualiza a mesma linha (não duplica nem se compara consigo mesma).
	if err := ch.Rodar(ctx); err != nil {
		t.Fatal(err)
	}
	var n int
	p.QueryRow(ctx, `select count(*) from campaign_insights_hora where hora = 11`).Scan(&n)
	p.QueryRow(ctx, `select conversas_hora from campaign_insights_hora where hora = 11`).Scan(&conversasHora)
	if n != 1 || conversasHora != 2 {
		t.Fatalf("repetida: linhas=%d conversas_hora=%d", n, conversasHora)
	}
}

func TestMetaHoraNaViradaDoDiaEmSaoPaulo(t *testing.T) {
	// 03:05 UTC = 00:05 em São Paulo: o dia é o NOVO (10/10) e a hora é 0, não a 3 do UTC.
	ch, p := ambienteHora(t, "", time.Date(2026, 10, 10, 3, 5, 0, 0, time.UTC))
	err := ch.Rodar(context.Background())
	if err == nil || !strings.Contains(err.Error(), "nada coletado (dia 2026-10-10, hora 0)") {
		t.Fatalf("00:05 sem gasto ainda = erro visível (a repescagem das 00:30 cobre): %v", err)
	}
	ch.Agora = func() time.Time { return time.Date(2026, 10, 10, 3, 30, 0, 0, time.UTC) }
	ch.Core, _ = coreDeTeste(t, graphDaHora("3"))
	if err := ch.Rodar(context.Background()); err != nil {
		t.Fatal(err)
	}
	var dia string
	var hora int
	p.QueryRow(context.Background(), `select dia::text, hora from campaign_insights_hora`).Scan(&dia, &hora)
	if dia != "2026-10-10" || hora != 0 {
		t.Fatalf("repescagem gravou dia=%s hora=%d", dia, hora)
	}
	ts := ch.Tarefas()
	if ts[0].Nome != "meta-hora" || ts[0].Agenda != "5 * * * *" || ts[1].Nome != "meta-hora-retentativa-00h" || ts[1].Agenda != "30 3 * * *" ||
		ts[0].Trava != ts[1].Trava || ts[0].Trava == "" {
		t.Fatalf("%+v", ts)
	}
}

func TestTipoDaCampanha(t *testing.T) {
	for nome, quer := range map[string]string{
		"[CAMPANHA WPP] x": "wpp", "[+ SEGUIDORES] y": "seguidores", "[+ ENGAJAMENTO] z": "engajamento",
		"[ENGAJAMENTO] POST 10": "engajamento", "[Engajamento] vaga": "outro", "AXIOM": "outro",
	} {
		if got := tipoDaCampanha(nome); got != quer {
			t.Errorf("%q = %q", nome, got)
		}
	}
}

func TestColetaDiariaAnuncios(t *testing.T) {
	c, f, p, _ := ambienteColeta(t)
	ctx := context.Background()
	if _, err := p.Exec(ctx, tabelasAnuncios); err != nil {
		t.Fatal(err)
	}
	p.Exec(ctx, `update accounts set ad_account_id = '999' where id = '`+contaA1+`'`)
	resp := f.resp
	f.resp = func(pd core.PedidoMeta) (int, string, map[string]string) {
		m := func(k string) string { s, _ := pd.Parametros[k].(string); return s }
		switch pd.Caminho {
		case "/act_999/campaigns":
			return 200, `{"data":[{"id":"c1","name":"[CAMPANHA WPP] Leads","objective":"OUTCOME_LEADS","status":"ACTIVE"}]}`, nil
		case "/act_999/ads":
			return 200, `{"data":[{"id":"a1","name":"Anúncio","campaign_id":"c1","status":"ACTIVE","creative":{"asset_feed_spec":{"link_urls":[{"website_url":"https://x"},{"website_url":"https://y"}]}}},
				{"id":"a2","campaign_id":"c1","creative":{"object_story_spec":{"video_data":{"call_to_action":{"value":{"link":"https://v"}}}}}}]}`, nil
		case "/act_999/adsets":
			return 500, `{"error":{"message":"conjuntos fora"}}`, nil
		case "/act_999/insights":
			if m("time_range") == `{"since":"2026-10-03","until":"2026-10-09"}` { // 7d: últimos 7 dias COMPLETOS
				return 200, `{"data":[{"campaign_id":"c1","spend":"70.25","impressions":"1000","clicks":"12.9","reach":"800",
					"actions":[{"action_type":"post_reaction","value":"9"},{"action_type":"onsite_conversion.total_messaging_connection","value":"4"},
					{"action_type":"onsite_conversion.messaging_conversation_started_7d","value":"6"},{"action_type":"landing_page_view","value":"3"}]}]}`, nil
			}
			return 200, `{"data":[]}`, nil
		}
		return resp(pd)
	}
	if err := c.Rodada(ctx, "07h"); err != nil {
		t.Fatal(err)
	}
	var links string
	p.QueryRow(ctx, `select string_agg(ad_id || '=' || coalesce(destino_link, 'nulo'), ',' order by ad_id) from ads`).Scan(&links)
	if links != "a1=https://x | https://y,a2=https://v" {
		t.Fatalf("destino_link: %q", links)
	}
	var spend float64
	var clicks, likes, conversas, visitas int
	p.QueryRow(ctx, `select spend::float8, clicks, likes, conversas, visitas from campaign_insights where period_days = 7`).Scan(&spend, &clicks, &likes, &conversas, &visitas)
	if spend != 70.25 || clicks != 12 || likes != 9 || conversas != 4 || visitas != 3 {
		t.Fatalf("7d: spend=%v clicks=%d likes=%d conversas=%d (a 1ª forma, sem somar) visitas=%d", spend, clicks, likes, conversas, visitas)
	}
	var nCampanha int
	p.QueryRow(ctx, `select count(*) from campaigns where campaign_id = 'c1' and synced_at = '2026-10-10'`).Scan(&nCampanha)
	if nCampanha != 1 {
		t.Fatal("campanhas sincronizadas com synced_at = hoje")
	}
}
```

Em `api/cmd/api/worker_test.go`, troque:

```go

}

func TestTarefasDeProducao
```

por:

```go

	// Task 7
	"meta-hora":                 "5 * * * *",
	"meta-hora-retentativa-00h": "30 3 * * *",
}

func TestTarefasDeProducao
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `go test -count=1 ./cmd/api ./internal/meta`
Expected: FAIL. Primeiras falhas, como saíram no ensaio deste plano: `--- FAIL: TestTarefasDeProducao`, `undefined: ColetaHora`, `undefined: tipoDaCampanha`

- [ ] **Step 3: Implementar**

Substitua o arquivo inteiro `api/internal/meta/coleta_anuncios.go` por:

```go
package meta

import (
	"context"
	"fmt"
	"log/slog"
	"regexp"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5"
)

// anuncios é a parte de anúncios de coletar-dados: campanhas, anúncios (com o link de destino),
// conjuntos e os insights por campanha (5 recortes + o gasto de cada um dos 7 dias anteriores como
// period_days 0: a Meta re-atribui gasto por 1-2 dias). Erro da META segue o que a edge fazia (pula,
// ou vira degradado nos anúncios); erro do BANCO aborta a conta (linha ok=false em robos_execucoes).
func (c *ColetaDiaria) anuncios(ctx context.Context, conta contaColeta, hoje string, degradados *[]string) error {
	act := "/act_" + conta.ad
	if itens, err := Paginas(ctx, c.Core, act+"/campaigns", obj{"fields": "id,name,objective,status", "limit": "500"}, maxPaginas, true); err == nil {
		err := pgx.BeginFunc(ctx, c.Pool, func(tx pgx.Tx) error {
			for _, x := range itens {
				m, _ := x.(obj)
				if _, err := tx.Exec(ctx, `insert into campaigns (campaign_id, account_id, name, objective, status, synced_at)
					values ($1::text, $2::uuid, $3::text, $4::text, $5::text, $6::date)
					on conflict (campaign_id) do update set account_id = excluded.account_id, name = excluded.name,
					  objective = excluded.objective, status = excluded.status, synced_at = excluded.synced_at`,
					textoDe(m["id"]), conta.id, textoOuVazio(m["name"]), textoOuVazio(m["objective"]), textoOuVazio(m["status"]), hoje); err != nil {
					return err
				}
			}
			return nil
		})
		if err != nil {
			return err
		}
	} else {
		slog.Warn("coletar-dados: campanhas", "conta", conta.nome, "erro", err) // sem anúncio na conta: segue
	}

	// Página de 100: com o campo aninhado do criativo a Meta recusa 500 por página (medido em 18/09/2026).
	if itens, err := Paginas(ctx, c.Core, act+"/ads", obj{"fields": "id,name,campaign_id,status,creative{object_story_spec,asset_feed_spec,object_url}", "limit": "100"}, maxPaginas, true); err != nil {
		*degradados = append(*degradados, fmt.Sprintf("ads (%s): %s", conta.id, err.Error()))
	} else {
		err := pgx.BeginFunc(ctx, c.Pool, func(tx pgx.Tx) error {
			for _, x := range itens {
				m, _ := x.(obj)
				criativo, _ := m["creative"].(obj)
				if _, err := tx.Exec(ctx, `insert into ads (ad_id, campaign_id, account_id, name, status, destino_link, synced_at)
					values ($1::text, $2::text, $3::uuid, $4::text, $5::text, $6::text, $7::date)
					on conflict (ad_id) do update set campaign_id = excluded.campaign_id, account_id = excluded.account_id, name = excluded.name,
					  status = excluded.status, destino_link = excluded.destino_link, synced_at = excluded.synced_at`,
					textoDe(m["id"]), textoDe(m["campaign_id"]), conta.id, textoOuVazio(m["name"]), textoOuVazio(m["status"]), linkDoCriativo(criativo), hoje); err != nil {
					return err
				}
			}
			return nil
		})
		if err != nil {
			return err
		}
	}

	// O sinal do conjunto (destination_type, optimization_goal) decide o balde da campanha no painel.
	if itens, err := Paginas(ctx, c.Core, act+"/adsets", obj{"fields": "id,campaign_id,destination_type,optimization_goal", "limit": "500"}, maxPaginas, true); err != nil {
		slog.Warn("coletar-dados: conjuntos FALHOU", "conta", conta.nome, "erro", err)
	} else {
		err := pgx.BeginFunc(ctx, c.Pool, func(tx pgx.Tx) error {
			for _, x := range itens {
				m, _ := x.(obj)
				campanha := textoOuVazio(m["campaign_id"])
				if campanha == "" {
					continue
				}
				if _, err := tx.Exec(ctx, `insert into campaign_adsets (adset_id, campaign_id, account_id, destination_type, optimization_goal, synced_at)
					values ($1::text, $2::text, $3::uuid, $4::text, $5::text, $6::date)
					on conflict (adset_id) do update set campaign_id = excluded.campaign_id, account_id = excluded.account_id,
					  destination_type = excluded.destination_type, optimization_goal = excluded.optimization_goal, synced_at = excluded.synced_at`,
					textoDe(m["id"]), campanha, conta.id, textoOuNulo(m["destination_type"]), textoOuNulo(m["optimization_goal"]), hoje); err != nil {
					return err
				}
			}
			return nil
		})
		if err != nil {
			return err
		}
	}

	for _, dias := range periodos {
		de, ate := janelaDeAds(hoje, dias)
		if err := c.insightsDeCampanha(ctx, conta, act, de, ate, hoje, dias); err != nil {
			return err
		}
	}
	for dd := 1; dd <= 7; dd++ { // o pd=0 de ontem até 7 dias atrás, pela atribuição tardia da Meta
		dia := menosDias(hoje, dd)
		if err := c.insightsDeCampanha(ctx, conta, act, dia, dia, dia, 0); err != nil {
			return err
		}
	}
	return nil
}

// janelaDeAds (janela-de-ads.js): 0 = o próprio dia; N = os últimos N dias COMPLETOS (até ontem).
func janelaDeAds(hoje string, dias int) (string, string) {
	if dias == 0 {
		return hoje, hoje
	}
	return menosDias(hoje, dias), menosDias(hoje, 1)
}

func (c *ColetaDiaria) insightsDeCampanha(ctx context.Context, conta contaColeta, act, de, ate, capturado string, dias int) error {
	itens, err := Paginas(ctx, c.Core, act+"/insights", obj{"fields": "campaign_id,spend,impressions,clicks,reach,actions",
		"time_range": fmt.Sprintf(`{"since":"%s","until":"%s"}`, de, ate), "level": "campaign", "limit": "500"}, maxPaginas, true)
	if err != nil {
		return nil // sem dados de anúncio: a edge pulava em silêncio
	}
	return pgx.BeginFunc(ctx, c.Pool, func(tx pgx.Tx) error {
		for _, x := range itens {
			r, _ := x.(obj)
			acoes, _ := r["actions"].([]any)
			ct := contagensDaCampanha(acoes)
			if _, err := tx.Exec(ctx, `insert into campaign_insights (campaign_id, account_id, captured_at, period_days, spend, impressions, clicks, reach,
					post_engagement, likes, comments, shares, saves, conversas, cadastros, compras, visitas)
				values ($1::text, $2::uuid, $3::date, $4::int, $5::numeric, $6::bigint, $7::bigint, $8::bigint, $9::int, $10::int, $11::int,
					$12::int, $13::int, $14::int, $15::int, $16::int, $17::int)
				on conflict (campaign_id, account_id, captured_at, period_days) do update set spend = excluded.spend,
				  impressions = excluded.impressions, clicks = excluded.clicks, reach = excluded.reach, post_engagement = excluded.post_engagement,
				  likes = excluded.likes, comments = excluded.comments, shares = excluded.shares, saves = excluded.saves,
				  conversas = excluded.conversas, cadastros = excluded.cadastros, compras = excluded.compras, visitas = excluded.visitas`,
				textoDe(r["campaign_id"]), conta.id, capturado, dias, floatJS(r["spend"]), inteiroJS(r["impressions"]), inteiroJS(r["clicks"]),
				inteiroJS(r["reach"]), acao(acoes, "post_engagement"), acao(acoes, "post_reaction", "like"), acao(acoes, "comment"),
				acao(acoes, "post", "share"), acao(acoes, "onsite_conversion.post_save", "post_save"),
				ct["conversas"], ct["cadastros"], ct["compras"], ct["visitas"]); err != nil {
				return err
			}
		}
		return nil
	})
}

func textoOuVazio(v any) string {
	if v == nil {
		return ""
	}
	return textoDe(v)
}

func textoOuNulo(v any) *string {
	if v == nil {
		return nil
	}
	s := textoDe(v)
	return &s
}

var reInteiroJS = regexp.MustCompile(`^[\t\n\v\f\r \x{00a0}\x{feff}]*([+-]?\d+)`)

// inteiroJS = parseInt(v ?? '0') do JS: o inteiro do começo do texto; sem número = nulo (NaN vira null).
func inteiroJS(v any) *int64 {
	s := "0"
	if v != nil {
		s = textoDe(v)
	}
	m := reInteiroJS.FindStringSubmatch(s)
	if m == nil {
		return nil
	}
	n, err := strconv.ParseInt(m[1], 10, 64)
	if err != nil {
		return nil
	}
	return &n
}

// floatJS = parseFloat(v ?? '0'): o número do começo do texto; sem número = nulo.
func floatJS(v any) *float64 {
	s := "0"
	if v != nil {
		s = strings.TrimSpace(textoDe(v))
	}
	for fim := len(s); fim > 0; fim-- {
		if f, err := strconv.ParseFloat(s[:fim], 64); err == nil {
			return &f
		}
	}
	return nil
}

// acao (actVal de coletar-dados): o 1º tipo da lista que existir em `actions`; parseInt(...) || 0.
func acao(acoes []any, tipos ...string) int64 {
	for _, t := range tipos {
		for _, x := range acoes {
			a, _ := x.(obj)
			if a["action_type"] != t {
				continue
			}
			v := a["value"]
			if v == nil {
				v = "0"
			}
			if n := inteiroJS(v); n != nil {
				return *n
			}
			return 0
		}
	}
	return 0
}

// contagensDaCampanha (acoes-de-campanha.js): para na PRIMEIRA forma que existir (a Meta manda a
// mesma conversa com mais de um action_type; somar contaria duas vezes).
func contagensDaCampanha(acoes []any) map[string]int64 {
	tipos := map[string][]string{
		"conversas": {"onsite_conversion.total_messaging_connection", "onsite_conversion.messaging_conversation_started_7d"},
		"cadastros": {"lead", "onsite_conversion.lead_grouped"},
		"compras":   {"purchase", "omni_purchase"},
		"visitas":   {"landing_page_view"}, // visita é landing_page_view, não link_click
	}
	out := map[string]int64{}
	for chave, lista := range tipos {
		out[chave] = acao(acoes, lista...)
	}
	return out
}

// linkDoCriativo (delta-de-hora.js): o destino do anúncio nos 4 formatos reais; nulo sem link (ex.:
// clique para o WhatsApp).
func linkDoCriativo(cr obj) *string {
	if cr == nil {
		return nil
	}
	osp, _ := cr["object_story_spec"].(obj)
	if ld, _ := osp["link_data"].(obj); ld["link"] != nil && textoDe(ld["link"]) != "" {
		return textoOuNulo(ld["link"])
	}
	if vd, _ := osp["video_data"].(obj); vd != nil {
		cta, _ := vd["call_to_action"].(obj)
		val, _ := cta["value"].(obj)
		if val["link"] != nil && textoDe(val["link"]) != "" {
			return textoOuNulo(val["link"])
		}
	}
	afs, _ := cr["asset_feed_spec"].(obj)
	if urls, _ := afs["link_urls"].([]any); len(urls) > 0 {
		partes := make([]string, len(urls))
		for i, u := range urls {
			m, _ := u.(obj)
			partes[i] = textoOuVazio(m["website_url"]) // undefined vira "" no join do JS
		}
		s := strings.Join(partes, " | ")
		return &s
	}
	if cr["object_url"] != nil && textoDe(cr["object_url"]) != "" {
		return textoOuNulo(cr["object_url"])
	}
	return nil
}
```

Crie `api/internal/meta/hora.go`:

```go
package meta

import (
	"context"
	"fmt"
	"log/slog"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/core"
	"github.com/rbv-co/social-dashboard/api/internal/worker"
)

// ColetaHora porta supabase/functions/coletar-dados-hora (jobs coletar-dados-hora e
// coletar-dados-hora-retentativa-00h; robôs 'meta-hora' e 'meta-hora-retentativa-00h'): por conta de
// anúncio, o gasto e as conversas DESTA hora (delta contra a última leitura do dia), seguidores da
// conta, visitas ao perfil e, nas campanhas "outro", gasto e clique por anúncio. A hora gravada é a
// hora de parede de São Paulo da rodada.
type ColetaHora struct {
	Pool  *pgxpool.Pool
	Core  *core.Cliente
	Agora func() time.Time // nil = time.Now
}

// Tarefas: a rodada de hora em hora (minuto 5) e a repescagem da hora 0 (00:30 em São Paulo). As
// duas gravam as mesmas linhas (upsert por dia+hora): dividem a trava.
func (ch *ColetaHora) Tarefas() []worker.Tarefa {
	return []worker.Tarefa{
		{Nome: "meta-hora", Agenda: "5 * * * *", Trava: "coletar-dados-hora", Limite: 10 * time.Minute, Executar: ch.Rodar},
		{Nome: "meta-hora-retentativa-00h", Agenda: "30 3 * * *", Trava: "coletar-dados-hora", Limite: 10 * time.Minute, Executar: ch.Rodar},
	}
}

// tipoDaCampanha (relatorio-por-hora.js): o prefixo EXATO do nome (maiúsculas importam).
func tipoDaCampanha(nome string) string {
	switch {
	case strings.HasPrefix(nome, "[CAMPANHA WPP]"):
		return "wpp"
	case strings.HasPrefix(nome, "[+ SEGUIDORES]"):
		return "seguidores"
	case strings.HasPrefix(nome, "[+ ENGAJAMENTO]"), strings.HasPrefix(nome, "[ENGAJAMENTO]"):
		return "engajamento"
	}
	return "outro"
}

// primeiraAcao (conversasIniciadas/visitasNoPerfil/linkClicks de delta-de-hora.js): o 1º tipo achado.
func primeiraAcao(acoes []any, tipos ...string) int64 { return acao(acoes, tipos...) }

func delta(atual, anterior float64) float64 { return max(0, atual-anterior) } // nunca negativo (a Meta corrige para baixo)

type contaHora struct{ id, nome, ad, ig string }

func (ch *ColetaHora) Rodar(ctx context.Context) error {
	agora := time.Now
	if ch.Agora != nil {
		agora = ch.Agora
	}
	t := agora().In(saoPaulo)
	dia, hora := t.Format("2006-01-02"), t.Hour()
	linhas, err := ch.Pool.Query(ctx, `select id::text, coalesce(name, ''), ad_account_id::text, coalesce(instagram_id::text, '')
		  from accounts where ad_account_id is not null order by name`)
	if err != nil {
		return err
	}
	contas, err := pgx.CollectRows(linhas, func(r pgx.CollectableRow) (c contaHora, err error) { return c, r.Scan(&c.id, &c.nome, &c.ad, &c.ig) })
	if err != nil {
		return err
	}
	var degradados []string
	campanhas := 0
	for _, c := range contas {
		campanhas += ch.campanhas(ctx, c, dia, hora, &degradados)
		ch.seguidores(ctx, c, &degradados)
		ch.visitas(ctx, c, dia, hora, agora(), &degradados)
		ch.anunciosOutro(ctx, c, dia, hora, &degradados)
	}
	if len(degradados) > 0 {
		slog.Warn("meta-hora: degradado", "dia", dia, "hora", hora, "itens", degradados)
	}
	// Havia conta e NADA foi coletado: erro (a edge devolvia 500 para a saúde enxergar). Na hora 0 isto
	// é o esperado às 00:05 (a Meta ainda não processou o dia); a repescagem das 00:30 cobre.
	if campanhas == 0 && len(contas) > 0 {
		return fmt.Errorf("nada coletado (dia %s, hora %d): %s", dia, hora, strings.Join(degradados, " · "))
	}
	slog.Info("meta-hora", "dia", dia, "hora", hora, "contas", len(contas), "campanhas", campanhas)
	return nil
}

func timeRange(dia string) string { return fmt.Sprintf(`{"since":"%s","until":"%s"}`, dia, dia) }

// campanhas: o insight do dia (acumulado até agora) por campanha e o delta contra a última linha de
// HOJE antes desta hora (uma segunda rodada na mesma hora não se compara consigo mesma).
func (ch *ColetaHora) campanhas(ctx context.Context, c contaHora, dia string, hora int, degradados *[]string) int {
	itens, err := Paginas(ctx, ch.Core, "/act_"+c.ad+"/insights", obj{"fields": "campaign_id,spend,actions",
		"time_range": timeRange(dia), "level": "campaign"}, maxPaginas, false)
	if err != nil {
		*degradados = append(*degradados, c.nome+": "+err.Error())
		return 0
	}
	if len(itens) == 0 {
		return 0
	}
	type anterior struct{ gasto, conversas, cliques float64 }
	ant := map[string]anterior{}
	linhas, err := ch.Pool.Query(ctx, `select campaign_id, gasto_acumulado::float8, conversas_acumuladas::float8, cliques_acumulados::float8
		  from campaign_insights_hora where account_id = $1::uuid and dia = $2::date and hora < $3::int order by hora desc`, c.id, dia, hora)
	if err == nil {
		var id string
		var a anterior
		_, err = pgx.ForEachRow(linhas, []any{&id, &a.gasto, &a.conversas, &a.cliques}, func() error {
			if _, tem := ant[id]; !tem {
				ant[id] = a
			}
			return nil
		})
	}
	if err != nil {
		*degradados = append(*degradados, c.nome+": falha ao ler leitura anterior ("+err.Error()+")")
		return 0
	}
	err = pgx.BeginFunc(ctx, ch.Pool, func(tx pgx.Tx) error {
		for _, x := range itens {
			r, _ := x.(obj)
			acoes, _ := r["actions"].([]any)
			id := textoDe(r["campaign_id"])
			gasto := 0.0
			if g := floatJS(r["spend"]); g != nil {
				gasto = *g
			}
			conversas := float64(primeiraAcao(acoes, "onsite_conversion.messaging_conversation_started_7d", "onsite_conversion.messaging_conversation_started"))
			// "cliques_*" por herança do schema: o conteúdo é visita ao perfil, que na prática cai no link_click.
			visitas := float64(primeiraAcao(acoes, "profile_visits", "profile_views", "link_click"))
			a := ant[id]
			if _, err := tx.Exec(ctx, `insert into campaign_insights_hora (campaign_id, account_id, dia, hora, gasto_acumulado, conversas_acumuladas,
					cliques_acumulados, gasto_hora, conversas_hora, cliques_hora)
				values ($1::text, $2::uuid, $3::date, $4::int, $5::numeric, $6::int, $7::int, $8::numeric, $9::int, $10::int)
				on conflict (campaign_id, account_id, dia, hora) do update set gasto_acumulado = excluded.gasto_acumulado,
				  conversas_acumuladas = excluded.conversas_acumuladas, cliques_acumulados = excluded.cliques_acumulados,
				  gasto_hora = excluded.gasto_hora, conversas_hora = excluded.conversas_hora, cliques_hora = excluded.cliques_hora`,
				id, c.id, dia, hora, gasto, conversas, visitas, delta(gasto, a.gasto), delta(conversas, a.conversas), delta(visitas, a.cliques)); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		*degradados = append(*degradados, c.nome+": falha ao gravar ("+err.Error()+")")
		return 0
	}
	return len(itens)
}

// seguidores: uma leitura da contagem por rodada (o delta hora a hora quem calcula é a tela).
func (ch *ColetaHora) seguidores(ctx context.Context, c contaHora, degradados *[]string) {
	if c.ig == "" {
		return
	}
	j, err := GET(ctx, ch.Core, "/"+c.ig, obj{"fields": "followers_count"})
	if err != nil {
		*degradados = append(*degradados, c.nome+": seguidores ("+err.Error()+")")
		return
	}
	if _, err := ch.Pool.Exec(ctx, `insert into followers_leituras (account_id, followers_count, origem) values ($1::uuid, $2::numeric, 'hora')`,
		c.id, numero(j["followers_count"])); err != nil {
		*degradados = append(*degradados, c.nome+": falha ao gravar seguidores ("+err.Error()+")")
	}
}

// visitas: profile_views só existe como ACUMULADO DO DIA (period=hour não existe na Graph): delta
// contra a hora anterior da mesma conta, mesmo dia.
func (ch *ColetaHora) visitas(ctx context.Context, c contaHora, dia string, hora int, agora time.Time, degradados *[]string) {
	if c.ig == "" {
		return
	}
	j, err := GET(ctx, ch.Core, "/"+c.ig+"/insights", obj{"metric": "profile_views", "metric_type": "total_value", "period": "day",
		"since": strconv.FormatInt(inicioDoDia(dia), 10), "until": strconv.FormatInt(agora.Unix(), 10)})
	if err != nil {
		*degradados = append(*degradados, c.nome+": visitas ao perfil ("+err.Error()+")")
		return
	}
	tv, _ := primeiro(j)["total_value"].(obj)
	acumulado := numero(tv["value"])
	var anterior float64
	err = ch.Pool.QueryRow(ctx, `select coalesce((select visitas_acumuladas from perfil_visitas_hora
		where account_id = $1::uuid and dia = $2::date and hora < $3::int order by hora desc limit 1), 0)::float8`, c.id, dia, hora).Scan(&anterior)
	if err != nil {
		*degradados = append(*degradados, c.nome+": falha ao ler visitas ao perfil anteriores ("+err.Error()+")")
		return
	}
	if _, err := ch.Pool.Exec(ctx, `insert into perfil_visitas_hora (account_id, dia, hora, visitas_acumuladas, visitas_hora)
		values ($1::uuid, $2::date, $3::int, $4::numeric, $5::numeric)
		on conflict (account_id, dia, hora) do update set visitas_acumuladas = excluded.visitas_acumuladas, visitas_hora = excluded.visitas_hora`,
		c.id, dia, hora, acumulado, delta(acumulado, anterior)); err != nil {
		*degradados = append(*degradados, c.nome+": falha ao gravar visitas ao perfil ("+err.Error()+")")
	}
}

// anunciosOutro: gasto e clique no link POR ANÚNCIO, só nas campanhas "outro" (Sales/Leads por link).
func (ch *ColetaHora) anunciosOutro(ctx context.Context, c contaHora, dia string, hora int, degradados *[]string) {
	linhas, err := ch.Pool.Query(ctx, `select a.ad_id, a.campaign_id, coalesce(k.name, '') from ads a join campaigns k on k.campaign_id = a.campaign_id
		where a.account_id = $1::uuid and k.account_id = $1::uuid and a.destino_link is not null`, c.id)
	if err != nil {
		*degradados = append(*degradados, c.nome+": falha ao ler catálogo de ads ("+err.Error()+")")
		return
	}
	escopo := map[string]bool{}
	var ad, campanha, nome string
	if _, err := pgx.ForEachRow(linhas, []any{&ad, &campanha, &nome}, func() error {
		if tipoDaCampanha(nome) == "outro" {
			escopo[ad] = true
		}
		return nil
	}); err != nil {
		*degradados = append(*degradados, c.nome+": falha ao ler catálogo de ads ("+err.Error()+")")
		return
	}
	if len(escopo) == 0 {
		return
	}
	itens, err := Paginas(ctx, ch.Core, "/act_"+c.ad+"/insights", obj{"fields": "ad_id,campaign_id,spend,actions",
		"time_range": timeRange(dia), "level": "ad"}, maxPaginas, false)
	if err != nil {
		*degradados = append(*degradados, c.nome+": ads outro ("+err.Error()+")")
		return
	}
	type anterior struct{ gasto, cliques float64 }
	ant := map[string]anterior{}
	linhas, err = ch.Pool.Query(ctx, `select ad_id, gasto_acumulado::float8, cliques_acumulados::float8 from ad_insights_hora
		where account_id = $1::uuid and dia = $2::date and hora < $3::int order by hora desc`, c.id, dia, hora)
	if err == nil {
		var id string
		var a anterior
		_, err = pgx.ForEachRow(linhas, []any{&id, &a.gasto, &a.cliques}, func() error {
			if _, tem := ant[id]; !tem {
				ant[id] = a
			}
			return nil
		})
	}
	if err != nil {
		*degradados = append(*degradados, c.nome+": falha ao ler ad_insights_hora anterior ("+err.Error()+")")
		return
	}
	err = pgx.BeginFunc(ctx, ch.Pool, func(tx pgx.Tx) error {
		for _, x := range itens {
			r, _ := x.(obj)
			id := textoDe(r["ad_id"])
			if !escopo[id] {
				continue
			}
			acoes, _ := r["actions"].([]any)
			gasto := 0.0
			if g := floatJS(r["spend"]); g != nil {
				gasto = *g
			}
			cliques := float64(primeiraAcao(acoes, "link_click"))
			a := ant[id]
			if _, err := tx.Exec(ctx, `insert into ad_insights_hora (ad_id, campaign_id, account_id, dia, hora, gasto_acumulado, cliques_acumulados, gasto_hora, cliques_hora)
				values ($1::text, $2::text, $3::uuid, $4::date, $5::int, $6::numeric, $7::int, $8::numeric, $9::int)
				on conflict (ad_id, account_id, dia, hora) do update set campaign_id = excluded.campaign_id, gasto_acumulado = excluded.gasto_acumulado,
				  cliques_acumulados = excluded.cliques_acumulados, gasto_hora = excluded.gasto_hora, cliques_hora = excluded.cliques_hora`,
				id, textoDe(r["campaign_id"]), c.id, dia, hora, gasto, cliques, delta(gasto, a.gasto), delta(cliques, a.cliques)); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		*degradados = append(*degradados, c.nome+": falha ao gravar ad_insights_hora ("+err.Error()+")")
	}
}
```

Em `api/cmd/api/tarefas.go`, troque:

```go
	return ts
}
```

por:

```go
	ts = append(ts, (&meta.ColetaHora{Pool: p, Core: cli}).Tarefas()...)
	return ts
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `gofmt -l . && go vet ./... && go test -race -count=1 ./internal/meta/ ./cmd/api/ -v 2>&1 | grep -E -- '^(ok|FAIL|--- FAIL|--- SKIP)'`
Expected: `gofmt` não lista nada; só linhas `ok`, nenhuma `FAIL` nem `--- SKIP`.

- [ ] **Step 5: Commit**

```bash
git add api/internal/meta/coleta_anuncios.go api/internal/meta/hora.go api/internal/meta/hora_test.go api/cmd/api/tarefas.go api/cmd/api/worker_test.go
git commit -m "feat(api): anúncios do coletar-dados e meta-hora com a retentativa das 00h

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 8: `enviar-relatorio-hora` pela Z-API

**Revisor:** **opus** (mensagem a grupo de WhatsApp; token da instância no caminho da URL).

Porta `supabase/functions/enviar-relatorio-hora/index.ts` + `_shared/relatorio-por-hora.js` (`10 * * * *`): manda ao grupo de WhatsApp, em DUAS mensagens, os relatórios da hora (Mensagem WPP e Seguidores), só da conta Vessel, com os textos byte a byte da edge (vetores gerados pelo módulo `_shared` no Node 22). Sem dado: um aviso curto, nunca silêncio. Mudanças de sinal (Ruling): falha de leitura do banco, que a edge devolvia 200, vira aviso no grupo E erro da tarefa; recusa da Z-API (instância desconectada, a causa provável dos 47% de falha de hoje) é erro visível sem o token. Cada mensagem tem chave no livro `enviar-relatorio-hora:<dia>:<HH>:wpp|seguidores|aviso`: rodar de novo na mesma hora não reenvia; recusa clara libera a reserva; envio ambíguo (caiu depois de mandar) não se repete.

**Files:**
- Create: `api/internal/meta/relatorio_hora.go`
- Test: `api/internal/meta/relatorio_hora_test.go`
- Modify: `api/internal/config/config.go`
- Test (modify): `api/internal/config/config_test.go`
- Modify: `api/cmd/api/tarefas.go`
- Test (modify): `api/cmd/api/worker_test.go`

**Interfaces:**
- Consumes: `banco.ReservarEnvio`/`LiberarEnvio`, `worker.Novo`/`Rodar`/`Segredos` (Task 1); `texto.Reais`, `texto.Milhar` (Task 3); `tabelasColeta` (Task 6) e `tabelasAnuncios` (Task 7) nos testes.
- Produces:
  - `type meta.ZAPI struct { InstanceID, InstanceToken, ClientToken, URL string; HTTP *http.Client }` com `Enviar(ctx, telefone, mensagem string) (ambiguo bool, err error)` — nenhum erro contém a URL.
  - `type meta.RelatorioHora struct { Pool; ZAPI *ZAPI; Agora func() time.Time }` com `Rodar` e `Tarefa`; constantes `contaVessel`, `grupoWhatsApp`.
  - `config.Config.ZAPIInstancia`, `ZAPIToken`, `ZAPICliente` (os três em `Segredos()`).

- [ ] **Step 1: Escrever os testes que falham**

Crie `api/internal/meta/relatorio_hora_test.go`:

```go
package meta

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/testebanco"
	"github.com/rbv-co/social-dashboard/api/internal/worker"
)

const (
	zapiInstancia = "instancia-123"
	zapiToken     = "token-da-instancia-zapi-456"
	zapiCliente   = "client-token-zapi-789"
)

type zapiFalsa struct {
	mu        sync.Mutex
	mensagens []string
	caminhos  []string
	clientes  []string
	status    int           // 0 = 200
	derrubar  bool          // simula queda depois de receber (envio ambíguo)
	atraso    time.Duration // responde depois disso (lentidão)
}

// atrasar faz a Z-API responder só depois de d.
func (z *zapiFalsa) atrasar(d time.Duration) {
	z.mu.Lock()
	defer z.mu.Unlock()
	z.atraso = d
}

// responder troca a resposta da Z-API (sob a trava: o servidor lê em outra goroutine).
func (z *zapiFalsa) responder(status int, derrubar bool) {
	z.mu.Lock()
	defer z.mu.Unlock()
	z.status, z.derrubar = status, derrubar
}

// lista: cópia das mensagens, caminhos e Client-Token recebidos.
func (z *zapiFalsa) lista() (mensagens, caminhos, clientes []string) {
	z.mu.Lock()
	defer z.mu.Unlock()
	return slices.Clone(z.mensagens), slices.Clone(z.caminhos), slices.Clone(z.clientes)
}

func ambienteRelatorio(t *testing.T) (*RelatorioHora, *zapiFalsa, *pgxpool.Pool) {
	t.Helper()
	p := testebanco.Novo(t)
	if _, err := p.Exec(context.Background(), tabelasColeta+tabelasAnuncios); err != nil {
		t.Fatal(err)
	}
	z := &zapiFalsa{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var corpo map[string]string
		b, _ := io.ReadAll(r.Body)
		json.Unmarshal(b, &corpo)
		z.mu.Lock()
		z.mensagens = append(z.mensagens, corpo["phone"]+"|"+corpo["message"])
		z.caminhos = append(z.caminhos, r.URL.Path)
		z.clientes = append(z.clientes, r.Header.Get("Client-Token"))
		st, derrubar, atraso := z.status, z.derrubar, z.atraso
		z.mu.Unlock()
		time.Sleep(atraso)
		if derrubar {
			c, _, _ := w.(http.Hijacker).Hijack()
			c.Close()
			return
		}
		if st != 0 {
			w.WriteHeader(st)
			io.WriteString(w, `{"error":"instance not connected"}`)
			return
		}
		io.WriteString(w, `{"messageId":"1"}`)
	}))
	t.Cleanup(srv.Close)
	rh := &RelatorioHora{Pool: p, ZAPI: &ZAPI{InstanceID: zapiInstancia, InstanceToken: zapiToken, ClientToken: zapiCliente, URL: srv.URL},
		Agora: func() time.Time { return time.Date(2026, 10, 10, 17, 10, 0, 0, time.UTC) }} // 14:10 em São Paulo
	return rh, z, p
}

// dadosDoRelatorio: o mesmo cenário com que os textos esperados foram gerados pelo
// _shared/relatorio-por-hora.js (Node 22).
func dadosDoRelatorio(t *testing.T, p *pgxpool.Pool) {
	t.Helper()
	for _, sql := range []string{
		`insert into campaigns (campaign_id, name) values ('c-wpp', '[CAMPANHA WPP] Leads Vessel'), ('c-wpp2', '[CAMPANHA WPP] Remarketing'),
			('c-seg', '[+ SEGUIDORES] Perfil'), ('c-outro', 'AXIOM')`,
		`insert into campaign_insights_hora (campaign_id, account_id, dia, hora, gasto_hora, gasto_acumulado, conversas_hora) values
			('c-wpp', '` + contaVessel + `', '2026-10-10', 13, 12.5, 40.25, 3), ('c-wpp', '` + contaVessel + `', '2026-10-10', 14, 10, 50.25, 4),
			('c-wpp2', '` + contaVessel + `', '2026-10-10', 14, 5.333, 5.333, 1), ('c-seg', '` + contaVessel + `', '2026-10-10', 14, 7.2, 30, 0),
			('c-seg', '` + contaVessel + `', '2026-10-10', 13, 6, 22.8, 0), ('c-outro', '` + contaVessel + `', '2026-10-10', 14, 3, 3, 0)`,
		`insert into followers_leituras (account_id, followers_count, lido_em, origem) values
			('` + contaVessel + `', 24300, '2026-10-09T23:05:00Z', 'hora'), ('` + contaVessel + `', 24310, '2026-10-10T03:05:00Z', 'hora'),
			('` + contaVessel + `', 24311, '2026-10-10T16:05:00Z', 'hora'), ('` + contaVessel + `', 24330, '2026-10-10T17:05:00Z', 'hora'),
			('` + contaVessel + `', 24332, '2026-10-10T17:08:00Z', 'diario')`,
		`insert into perfil_visitas_hora (account_id, dia, hora, visitas_hora) values ('` + contaVessel + `', '2026-10-10', 13, 5),
			('` + contaVessel + `', '2026-10-10', 14, 8)`,
	} {
		if _, err := p.Exec(context.Background(), sql); err != nil {
			t.Fatal(err)
		}
	}
}

const (
	msgWpp = "📊 Leads recebidos — 14h, 10/10\n\nINTERVALO\nLeads no período: 5\nCusto por lead: R$\U000000a03,07\nGasto no período: R$\U000000a015,33\n\n" +
		"TOTAL DESDOBRADO\n[CAMPANHA WPP] Leads Vessel — 4 leads · Gasto Dia: R$\U000000a050,25\n[CAMPANHA WPP] Remarketing — 1 lead · Gasto Dia: R$\U000000a05,33\n\n" +
		"Total de leads no dia: 8\nTotal de gasto no dia: R$\U000000a027,83"
	msgSeguidores = "📊 Seguidores e visitas ao perfil — 14h, 10/10\n\nINTERVALO\nNovos seguidores no período: +19\nVisitas ao perfil da conta: 8\n" +
		"Custo por visita ao perfil: R$\U000000a00,90\nCusto por seguidor: R$\U000000a00,38\nInvestimento: R$\U000000a07,20\n\nTOTAL\n" +
		"Total seguidores da conta: 24.330\nTotal seguidores do dia: +30\nTotal visitantes dia: 13\nCusto de seguidores dia: R$\U000000a00,44\n" +
		"Custo visitantes dia: R$\U000000a01,02\nInvestimento no dia: R$\U000000a013,20"
)

func TestRelatorioHoraComoAEdgeEUmaVezSo(t *testing.T) {
	rh, z, p := ambienteRelatorio(t)
	dadosDoRelatorio(t, p)
	ctx := context.Background()
	if err := rh.Rodar(ctx); err != nil {
		t.Fatal(err)
	}
	msgs, caminhos, clientes := z.lista()
	if len(msgs) != 2 || msgs[0] != grupoWhatsApp+"|"+msgWpp || msgs[1] != grupoWhatsApp+"|"+msgSeguidores {
		t.Fatalf("mensagens =\n%q", msgs)
	}
	if caminhos[0] != "/instances/"+zapiInstancia+"/token/"+zapiToken+"/send-text" || clientes[0] != zapiCliente {
		t.Fatalf("contrato da Z-API: %s %s", caminhos[0], clientes[0])
	}
	err := rh.Rodar(ctx)
	if msgs, _, _ = z.lista(); err != nil || len(msgs) != 2 {
		t.Fatalf("rodar de novo na mesma hora não reenvia: err=%v mensagens=%d", err, len(msgs))
	}
}

func TestRelatorioHoraSemDadoAvisa(t *testing.T) {
	rh, z, _ := ambienteRelatorio(t)
	if err := rh.Rodar(context.Background()); err != nil {
		t.Fatal(err)
	}
	if msgs, _, _ := z.lista(); len(msgs) != 1 || msgs[0] != grupoWhatsApp+"|⚠️ Relatório das 14h, 10/10 não saiu — sem dado disponível pra essa hora." {
		t.Fatalf("%q", msgs)
	}
}

func TestRelatorioHoraLeituraQueFalhaAvisaEEErro(t *testing.T) {
	rh, z, p := ambienteRelatorio(t)
	p.Exec(context.Background(), `drop table followers_leituras`)
	err := rh.Rodar(context.Background())
	if err == nil || !strings.Contains(err.Error(), "não consegui ler os dados de seguidores") {
		t.Fatalf("a edge dava 200 aqui; agora é erro visível: %v", err)
	}
	if msgs, _, _ := z.lista(); len(msgs) != 1 || !strings.Contains(msgs[0], "não saiu — não consegui ler os dados de seguidores.") {
		t.Fatalf("%q", msgs)
	}
}

// A Z-API desconectada (QR) é a causa provável dos 47% de falha de hoje: continua falha VISÍVEL, sem o
// token da instância no erro nem na linha de robos_execucoes; a recusa libera a reserva (a próxima tenta).
func TestRelatorioHoraZAPIRecusaEhErroSemToken(t *testing.T) {
	rh, z, p := ambienteRelatorio(t)
	dadosDoRelatorio(t, p)
	z.responder(401, false)
	ag := worker.Novo(p)
	ag.Segredos = []string{zapiToken, zapiCliente}
	ex, err := ag.Rodar(context.Background(), rh.Tarefa())
	if !ex || err == nil {
		t.Fatalf("ex=%v err=%v", ex, err)
	}
	var resp string
	p.QueryRow(context.Background(), `select resposta from robos_execucoes where robo = 'enviar-relatorio-hora'`).Scan(&resp)
	if !strings.Contains(resp, "wpp: Z-API send-text: 401") || strings.Contains(resp, zapiToken) || strings.Contains(err.Error(), zapiToken) {
		t.Fatalf("resp=%q err=%v", resp, err)
	}
	z.responder(0, false)
	err = rh.Rodar(context.Background())
	if msgs, _, _ := z.lista(); err != nil || len(msgs) != 4 {
		t.Fatalf("recusada não ficou reservada: err=%v mensagens=%d", err, len(msgs))
	}
}

func TestRelatorioHoraEnvioAmbiguoNaoRepete(t *testing.T) {
	rh, z, p := ambienteRelatorio(t)
	dadosDoRelatorio(t, p)
	z.responder(0, true)
	if err := rh.Rodar(context.Background()); err == nil || strings.Contains(err.Error(), zapiToken) {
		t.Fatalf("err=%v", err)
	}
	z.responder(0, false)
	err := rh.Rodar(context.Background())
	if msgs, _, _ := z.lista(); err != nil || len(msgs) != 2 {
		t.Fatalf("a mensagem pode ter saído: não manda de novo (mensagens=%d err=%v)", len(msgs), err)
	}
}

func TestRelatorioHoraSemZAPINemTenta(t *testing.T) {
	rh, z, _ := ambienteRelatorio(t)
	rh.ZAPI.ClientToken = ""
	err := rh.Rodar(context.Background())
	if msgs, _, _ := z.lista(); err == nil || len(msgs) != 0 {
		t.Fatalf("err=%v mensagens=%d", err, len(msgs))
	}
	if tf := rh.Tarefa(); tf.Nome != "enviar-relatorio-hora" || tf.Agenda != "10 * * * *" {
		t.Fatalf("%+v", tf)
	}
}

// 429 é recusa clara (libera a reserva: a próxima rodada da hora manda); Z-API lenta além do prazo é
// envio AMBÍGUO (a mensagem pode ter saído): fica reservada e nunca é repetida.
func TestRelatorioHoraZAPI429LiberaELentaNaoRepete(t *testing.T) {
	rh, z, p := ambienteRelatorio(t)
	dadosDoRelatorio(t, p)
	rh.ZAPI.HTTP = &http.Client{Timeout: 100 * time.Millisecond}
	z.responder(429, false)
	if err := rh.Rodar(context.Background()); err == nil || !strings.Contains(err.Error(), "Z-API send-text: 429") {
		t.Fatalf("429: %v", err)
	}
	z.responder(0, false)
	z.atrasar(300 * time.Millisecond)
	err := rh.Rodar(context.Background())
	if err == nil || strings.Contains(err.Error(), zapiToken) {
		t.Fatalf("lenta: %v", err)
	}
	z.atrasar(0)
	if err := rh.Rodar(context.Background()); err != nil {
		t.Fatal(err)
	}
	if msgs, _, _ := z.lista(); len(msgs) != 4 {
		t.Fatalf("2 recusadas (429) + 2 ambíguas (lentas), nenhuma repetida depois: %d", len(msgs))
	}
}
```

Acrescente ao fim de `api/internal/config/config_test.go`:

```go
func TestCarregarZAPI(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://x")
	t.Setenv("ZAPI_INSTANCE_ID", "instancia-123")
	t.Setenv("ZAPI_INSTANCE_TOKEN", "token-da-instancia")
	t.Setenv("ZAPI_TOKEN", "client-token")
	c, _ := Carregar()
	if c.ZAPIInstancia != "instancia-123" || c.ZAPIToken != "token-da-instancia" || c.ZAPICliente != "client-token" {
		t.Fatalf("%+v", c)
	}
	for _, s := range []string{"instancia-123", "token-da-instancia", "client-token"} {
		if !slices.Contains(c.Segredos(), s) {
			t.Errorf("%q fora de Segredos()", s)
		}
	}
}
```

Em `api/cmd/api/worker_test.go`, troque:

```go

}

func TestTarefasDeProducao
```

por:

```go

	// Task 8
	"enviar-relatorio-hora": "10 * * * *",
}

func TestTarefasDeProducao
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `go test -count=1 ./cmd/api ./internal/config ./internal/meta`
Expected: FAIL. Primeiras falhas, como saíram no ensaio deste plano: `--- FAIL: TestTarefasDeProducao`, `has no field or method ZAPIInstancia`, `has no field or method ZAPIToken`, `has no field or method ZAPICliente`, `undefined: RelatorioHora`, `undefined: ZAPI`

- [ ] **Step 3: Implementar**

Crie `api/internal/meta/relatorio_hora.go`:

```go
package meta

import (
	"bytes"
	"cmp"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"slices"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/banco"
	"github.com/rbv-co/social-dashboard/api/internal/texto"
	"github.com/rbv-co/social-dashboard/api/internal/worker"
)

// ZAPI manda texto pela Z-API. O token da INSTÂNCIA vai no caminho da URL: nenhum erro devolvido
// aqui contém a URL.
type ZAPI struct {
	InstanceID, InstanceToken, ClientToken string // ZAPI_INSTANCE_ID, ZAPI_INSTANCE_TOKEN, ZAPI_TOKEN
	URL                                    string // vazio = https://api.z-api.io (o teste troca)
	HTTP                                   *http.Client
}

func (z *ZAPI) configurada() bool {
	return z != nil && z.InstanceID != "" && z.InstanceToken != "" && z.ClientToken != ""
}

// Enviar manda `mensagem` a `telefone` (um grupo é "<id>-group"). ambiguo=true: não houve resposta
// (prazo, queda) e a mensagem PODE ter saído — quem chama não repete.
func (z *ZAPI) Enviar(ctx context.Context, telefone, mensagem string) (ambiguo bool, err error) {
	base := z.URL
	if base == "" {
		base = "https://api.z-api.io"
	}
	corpo, _ := json.Marshal(map[string]string{"phone": telefone, "message": mensagem})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost,
		base+"/instances/"+url.PathEscape(z.InstanceID)+"/token/"+url.PathEscape(z.InstanceToken)+"/send-text", bytes.NewReader(corpo))
	if err != nil {
		return false, errors.New("Z-API: pedido inválido")
	}
	req.Header.Set("Client-Token", z.ClientToken)
	req.Header.Set("Content-Type", "application/json")
	cli := z.HTTP
	if cli == nil {
		cli = &http.Client{Timeout: 20 * time.Second}
	}
	r, err := cli.Do(req)
	if err != nil {
		var ue *url.Error
		if errors.As(err, &ue) {
			err = ue.Err
		}
		return true, fmt.Errorf("Z-API send-text: %w", err)
	}
	defer r.Body.Close()
	b, _ := io.ReadAll(io.LimitReader(r.Body, 4<<10))
	if r.StatusCode < 200 || r.StatusCode > 299 {
		return false, fmt.Errorf("Z-API send-text: %d %s", r.StatusCode, texto.CortarUTF16(string(b), 200))
	}
	return false, nil
}

// RelatorioHora porta supabase/functions/enviar-relatorio-hora (pg_cron 10 * * * *): manda ao grupo de
// WhatsApp, em DUAS mensagens, os relatórios da hora (Mensagem WPP e Seguidores, a MESMA regra da tela
// em relatorio-por-hora.js), só da conta Vessel. Sem dado: um aviso curto, nunca silêncio.
type RelatorioHora struct {
	Pool  *pgxpool.Pool
	ZAPI  *ZAPI
	Agora func() time.Time // nil = time.Now
}

// Os mesmos recortes fixos da edge (e da tela): a conta Vessel e o "Grupo de teste z-api".
const (
	contaVessel   = "b6883e82-07cb-4f21-9fd7-ea7626786174"
	grupoWhatsApp = "120363431546698175-group"
)

func (rh *RelatorioHora) Tarefa() worker.Tarefa {
	return worker.Tarefa{Nome: "enviar-relatorio-hora", Agenda: "10 * * * *", Limite: 2 * time.Minute, Executar: rh.Rodar}
}

type campanhaDaHora struct {
	id, nome, tipo       string
	gastoHora, gastoAcum float64
	conversasHora        int64
}

type horaDoDia struct {
	hora      int
	campanhas []campanhaDaHora
}

type leituraSeg struct {
	total int64
	lido  time.Time
	hora  bool // origem = 'hora'
}

type deltaSeg struct {
	dia   string
	hora  int
	delta *int64
	total int64
}

func custoPorLead(gasto float64, n float64) *float64 {
	if n == 0 {
		return nil
	}
	c := gasto / n
	return &c
}

func comSinal(n int64) string {
	if n > 0 {
		return fmt.Sprintf("+%d", n)
	}
	return fmt.Sprint(n)
}

func cabecalho(titulo, dia string, hora int) string {
	return fmt.Sprintf("📊 %s — %02dh, %s/%s", titulo, hora, dia[8:10], dia[5:7])
}

// montarMensagemWpp (relatorio-por-hora.js): só campanhas [CAMPANHA WPP]; "" quando não há nenhuma.
func montarMensagemWpp(dia string, hora int, campanhas []campanhaDaHora, leadsHoje int64, gastoHoje float64) string {
	var wpp []campanhaDaHora
	for _, c := range campanhas {
		if c.tipo == "wpp" {
			wpp = append(wpp, c)
		}
	}
	if len(wpp) == 0 {
		return ""
	}
	var leads int64
	var gasto float64
	for _, c := range wpp {
		leads += c.conversasHora
		gasto += c.gastoHora
	}
	linhas := []string{cabecalho("Leads recebidos", dia, hora), "", "INTERVALO", fmt.Sprintf("Leads no período: %d", leads)}
	if cpl := custoPorLead(gasto, float64(leads)); cpl != nil {
		linhas = append(linhas, "Custo por lead: "+texto.Reais(*cpl))
	}
	linhas = append(linhas, "Gasto no período: "+texto.Reais(gasto), "", "TOTAL DESDOBRADO")
	for _, c := range wpp {
		plural := "s"
		if c.conversasHora == 1 {
			plural = ""
		}
		linhas = append(linhas, fmt.Sprintf("%s — %d lead%s · Gasto Dia: %s", c.nome, c.conversasHora, plural, texto.Reais(c.gastoAcum)))
	}
	linhas = append(linhas, "", fmt.Sprintf("Total de leads no dia: %d", leadsHoje), "Total de gasto no dia: "+texto.Reais(gastoHoje))
	return strings.Join(linhas, "\n")
}

func somaDoTipo(horas []horaDoDia, tipo string, f func(campanhaDaHora) float64) float64 {
	s := 0.0
	for _, h := range horas {
		for _, c := range h.campanhas {
			if c.tipo == tipo {
				s += f(c)
			}
		}
	}
	return s
}

// montarMensagemSeguidores (relatorio-por-hora.js): INTERVALO (resultado da hora) e TOTAL (do dia e da
// conta); cada linha só entra com o próprio valor; "" quando não há nada em nenhuma das partes.
func montarMensagemSeguidores(dia string, hora int, seguidoresDelta, visitasDelta, seguidoresTotal, seguidoresHoje *int64,
	gastoSeguidores, gastoSeguidoresHoje float64, visitasHoje int64) string {
	if seguidoresTotal == nil && seguidoresHoje == nil && visitasDelta == nil {
		return ""
	}
	var periodo, totais []string
	if seguidoresDelta != nil {
		periodo = append(periodo, "Novos seguidores no período: "+comSinal(*seguidoresDelta))
	}
	if visitasDelta != nil {
		periodo = append(periodo, fmt.Sprintf("Visitas ao perfil da conta: %d", *visitasDelta))
	}
	if gastoSeguidores > 0 {
		if visitasDelta != nil {
			if c := custoPorLead(gastoSeguidores, float64(*visitasDelta)); c != nil {
				periodo = append(periodo, "Custo por visita ao perfil: "+texto.Reais(*c))
			}
		}
		if seguidoresDelta != nil && *seguidoresDelta > 0 {
			periodo = append(periodo, "Custo por seguidor: "+texto.Reais(gastoSeguidores/float64(*seguidoresDelta)))
		}
		periodo = append(periodo, "Investimento: "+texto.Reais(gastoSeguidores))
	}
	if seguidoresTotal != nil {
		totais = append(totais, "Total seguidores da conta: "+texto.Milhar(*seguidoresTotal))
	}
	if seguidoresHoje != nil {
		totais = append(totais, "Total seguidores do dia: "+comSinal(*seguidoresHoje))
	}
	totais = append(totais, fmt.Sprintf("Total visitantes dia: %d", visitasHoje))
	if gastoSeguidoresHoje > 0 {
		if seguidoresHoje != nil && *seguidoresHoje > 0 {
			totais = append(totais, "Custo de seguidores dia: "+texto.Reais(gastoSeguidoresHoje/float64(*seguidoresHoje)))
		}
		if visitasHoje > 0 {
			totais = append(totais, "Custo visitantes dia: "+texto.Reais(gastoSeguidoresHoje/float64(visitasHoje)))
		}
		totais = append(totais, "Investimento no dia: "+texto.Reais(gastoSeguidoresHoje))
	}
	corpo := []string{cabecalho("Seguidores e visitas ao perfil", dia, hora), ""}
	if len(periodo) > 0 {
		corpo = append(append(corpo, "INTERVALO"), periodo...)
	}
	if len(periodo) > 0 && len(totais) > 0 {
		corpo = append(corpo, "")
	}
	if len(totais) > 0 {
		corpo = append(append(corpo, "TOTAL"), totais...)
	}
	return strings.Join(corpo, "\n")
}

// deltaDeSeguidoresPorHora (relatorio-por-hora.js): uma leitura por balde dia+hora de São Paulo (a de
// origem 'hora' vence; entre iguais, a mais recente) e o delta contra o balde anterior (atravessa a
// meia-noite: seguidor é estoque). A primeira da série tem total e não tem delta.
func deltaDeSeguidoresPorHora(ls []leituraSeg) []deltaSeg {
	type balde struct {
		dia  string
		hora int
		l    leituraSeg
	}
	porBalde := map[string]*balde{}
	var ordem []*balde
	for _, l := range ls {
		t := l.lido.In(saoPaulo)
		chave := t.Format("2006-01-02|15")
		atual, tem := porBalde[chave]
		switch {
		case !tem:
			b := &balde{t.Format("2006-01-02"), t.Hour(), l}
			porBalde[chave] = b
			ordem = append(ordem, b)
		case l.hora && !atual.l.hora, l.hora == atual.l.hora && l.lido.After(atual.l.lido):
			atual.l = l
		}
	}
	slices.SortStableFunc(ordem, func(a, b *balde) int { return a.l.lido.Compare(b.l.lido) })
	out := make([]deltaSeg, len(ordem))
	for i, b := range ordem {
		out[i] = deltaSeg{dia: b.dia, hora: b.hora, total: b.l.total}
		if i > 0 {
			d := b.l.total - ordem[i-1].l.total
			out[i].delta = &d
		}
	}
	return out
}

func (rh *RelatorioHora) Rodar(ctx context.Context) error {
	if !rh.ZAPI.configurada() {
		return errors.New("zapi_nao_configurada: ZAPI_INSTANCE_ID, ZAPI_INSTANCE_TOKEN e ZAPI_TOKEN são obrigatórios")
	}
	agora := time.Now
	if rh.Agora != nil {
		agora = rh.Agora
	}
	t := agora().In(saoPaulo)
	dia, hora := t.Format("2006-01-02"), t.Hour()

	horas, err := rh.lerCampanhas(ctx, dia)
	if err != nil {
		return rh.semDados(ctx, dia, hora, "não consegui ler os dados de campanha", err)
	}
	leituras, err := rh.lerSeguidores(ctx, t)
	if err != nil {
		return rh.semDados(ctx, dia, hora, "não consegui ler os dados de seguidores", err)
	}
	visitas := map[int]int64{}
	var visitasHoje int64
	linhas, err := rh.Pool.Query(ctx, `select hora, coalesce(visitas_hora, 0) from perfil_visitas_hora where account_id = $1::uuid and dia = $2::date`, contaVessel, dia)
	if err == nil {
		var h int
		var v int64
		_, err = pgx.ForEachRow(linhas, []any{&h, &v}, func() error { visitas[h] = v; visitasHoje += v; return nil })
	}
	if err != nil {
		return rh.semDados(ctx, dia, hora, "não consegui ler os dados de visita ao perfil", err)
	}

	var daHora []campanhaDaHora
	for _, h := range horas {
		if h.hora == hora {
			daHora = h.campanhas
		}
	}
	leadsHoje := int64(somaDoTipo(horas, "wpp", func(c campanhaDaHora) float64 { return float64(c.conversasHora) }))
	gastoWppHoje := somaDoTipo(horas, "wpp", func(c campanhaDaHora) float64 { return c.gastoHora })
	deltas := deltaDeSeguidoresPorHora(leituras)
	var segDelta, segTotal, segHoje *int64
	var somaHoje int64
	temHoje := false
	for _, d := range deltas {
		if d.dia == dia && d.hora == hora {
			segDelta, segTotal = d.delta, &d.total
		}
		if d.dia == dia {
			temHoje = true
			if d.delta != nil {
				somaHoje += *d.delta
			}
		}
	}
	if temHoje {
		segHoje = &somaHoje
	}
	var visitasDelta *int64
	if v, tem := visitas[hora]; tem {
		visitasDelta = &v
	}
	gastoSeg := 0.0
	for _, c := range daHora {
		if c.tipo == "seguidores" {
			gastoSeg += c.gastoHora
		}
	}
	gastoSegHoje := somaDoTipo(horas, "seguidores", func(c campanhaDaHora) float64 { return c.gastoHora })
	mensagens := []struct{ nome, texto string }{
		{"wpp", montarMensagemWpp(dia, hora, daHora, leadsHoje, gastoWppHoje)},
		{"seguidores", montarMensagemSeguidores(dia, hora, segDelta, visitasDelta, segTotal, segHoje, gastoSeg, gastoSegHoje, visitasHoje)},
	}
	// As DUAS, separadas e nesta ordem; uma falhando não impede a outra.
	enviadas := 0
	var falhas []string
	for _, m := range mensagens {
		if m.texto == "" {
			continue
		}
		if err := rh.enviar(ctx, fmt.Sprintf("enviar-relatorio-hora:%s:%02d:%s", dia, hora, m.nome), m.texto); err != nil {
			falhas = append(falhas, m.nome+": "+err.Error())
			continue
		}
		enviadas++
	}
	if enviadas == 0 && len(falhas) == 0 {
		if err := rh.enviar(ctx, fmt.Sprintf("enviar-relatorio-hora:%s:%02d:aviso", dia, hora), aviso(dia, hora, "sem dado disponível pra essa hora")); err != nil {
			falhas = append(falhas, "aviso: "+err.Error())
		}
	}
	if len(falhas) > 0 {
		return errors.New(strings.Join(falhas, " · "))
	}
	slog.Info("enviar-relatorio-hora", "dia", dia, "hora", hora, "enviadas", enviadas)
	return nil
}

func aviso(dia string, hora int, motivo string) string {
	return fmt.Sprintf("⚠️ Relatório das %02dh, %s/%s não saiu — %s.", hora, dia[8:10], dia[5:7], motivo)
}

// semDados: leitura do banco falhou. Avisa o grupo (melhor um aviso curto que silêncio) e a tarefa
// termina com ERRO (a edge respondia 200 aqui, e a saúde dos robôs ficava verde).
func (rh *RelatorioHora) semDados(ctx context.Context, dia string, hora int, motivo string, causa error) error {
	if err := rh.enviar(ctx, fmt.Sprintf("enviar-relatorio-hora:%s:%02d:aviso", dia, hora), aviso(dia, hora, motivo)); err != nil {
		return fmt.Errorf("%s: %w (e o aviso falhou: %v)", motivo, causa, err)
	}
	return fmt.Errorf("%s: %w", motivo, causa)
}

// enviar reserva a mensagem no livro de envios ANTES de mandar: rodar de novo na mesma hora não repete
// o que já saiu (conta como enviada). Recusa da Z-API desfaz a reserva; envio ambíguo, não.
func (rh *RelatorioHora) enviar(ctx context.Context, chave, msg string) error {
	ok, err := banco.ReservarEnvio(ctx, rh.Pool, chave)
	if err != nil || !ok {
		return err
	}
	ambiguo, err := rh.ZAPI.Enviar(ctx, grupoWhatsApp, msg)
	if err != nil && !ambiguo {
		c, cancela := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
		defer cancela()
		if e := banco.LiberarEnvio(c, rh.Pool, chave); e != nil {
			return errors.Join(err, e)
		}
	}
	return err
}

// lerCampanhas: campaign_insights_hora da conta no DIA inteiro (o total do dia soma as horas),
// agrupado por hora (crescente) e, na hora, por gasto (maior primeiro), como agruparPorDiaEHora.
func (rh *RelatorioHora) lerCampanhas(ctx context.Context, dia string) ([]horaDoDia, error) {
	linhas, err := rh.Pool.Query(ctx, `select h.hora, h.campaign_id, coalesce(nullif(c.name, ''), h.campaign_id), coalesce(h.gasto_hora, 0)::float8,
			coalesce(h.gasto_acumulado, 0)::float8, coalesce(h.conversas_hora, 0)
		  from campaign_insights_hora h left join campaigns c on c.campaign_id = h.campaign_id
		 where h.account_id = $1::uuid and h.dia = $2::date order by h.hora, h.campaign_id`, contaVessel, dia)
	if err != nil {
		return nil, err
	}
	porHora := map[int]*horaDoDia{}
	var horas []*horaDoDia
	var hr int
	var c campanhaDaHora
	if _, err := pgx.ForEachRow(linhas, []any{&hr, &c.id, &c.nome, &c.gastoHora, &c.gastoAcum, &c.conversasHora}, func() error {
		c.tipo = tipoDaCampanha(c.nome)
		h := porHora[hr]
		if h == nil {
			h = &horaDoDia{hora: hr}
			porHora[hr] = h
			horas = append(horas, h)
		}
		h.campanhas = append(h.campanhas, c)
		return nil
	}); err != nil {
		return nil, err
	}
	out := make([]horaDoDia, len(horas))
	for i, h := range horas {
		slices.SortStableFunc(h.campanhas, func(a, b campanhaDaHora) int { return cmp.Compare(b.gastoHora, a.gastoHora) })
		out[i] = *h
	}
	return out, nil
}

// lerSeguidores: as leituras da conta nas últimas 25 h (o delta atravessa a virada do dia).
func (rh *RelatorioHora) lerSeguidores(ctx context.Context, agora time.Time) ([]leituraSeg, error) {
	linhas, err := rh.Pool.Query(ctx, `select followers_count, lido_em, coalesce(origem, '') = 'hora' from followers_leituras
		where account_id = $1::uuid and lido_em >= $2::timestamptz order by lido_em`, contaVessel, agora.Add(-25*time.Hour))
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(linhas, func(r pgx.CollectableRow) (l leituraSeg, err error) { return l, r.Scan(&l.total, &l.lido, &l.hora) })
}
```

Em `api/internal/config/config.go`, troque:

```go
	// Plano 4 (worker).
	WorkerAddr     string // WORKER_ADDR: endereço do GET /saude e /metricas do worker; vazio = sem HTTP
	RDStationToken string // RD_STATION_TOKEN: token público da RD Station (vessel-rd-station)
	ArquivosDir    string // ARQUIVOS_DIR: raiz dos buckets no disco (spec §7); padrão /var/lib/api/arquivos
	AlertaWebhook  string // ALERT_WEBHOOK_URL: recados de coleta zerada e da auditoria (opcional; é segredo)
}
```

por:

```go
	// Plano 4 (worker).
	WorkerAddr     string // WORKER_ADDR: endereço do GET /saude e /metricas do worker; vazio = sem HTTP
	RDStationToken string // RD_STATION_TOKEN: token público da RD Station (vessel-rd-station)
	ArquivosDir    string // ARQUIVOS_DIR: raiz dos buckets no disco (spec §7); padrão /var/lib/api/arquivos
	AlertaWebhook  string // ALERT_WEBHOOK_URL: recados de coleta zerada e da auditoria (opcional; é segredo)
	ZAPIInstancia  string // ZAPI_INSTANCE_ID (vai no caminho da URL da Z-API)
	ZAPIToken      string // ZAPI_INSTANCE_TOKEN (vai no caminho da URL da Z-API)
	ZAPICliente    string // ZAPI_TOKEN (cabeçalho Client-Token)
}
```

Em `api/internal/config/config.go`, troque:

```go
		TarefasDesligadas: lista("WORKER_TAREFAS_DESLIGADAS"),
		WorkerAddr:        strings.TrimSpace(os.Getenv("WORKER_ADDR")),
		RDStationToken:    strings.TrimSpace(os.Getenv("RD_STATION_TOKEN")),
		ArquivosDir:       strings.TrimSpace(os.Getenv("ARQUIVOS_DIR")),
		AlertaWebhook:     strings.TrimSpace(os.Getenv("ALERT_WEBHOOK_URL")),
	}
```

por:

```go
		TarefasDesligadas: lista("WORKER_TAREFAS_DESLIGADAS"),
		WorkerAddr:        strings.TrimSpace(os.Getenv("WORKER_ADDR")),
		RDStationToken:    strings.TrimSpace(os.Getenv("RD_STATION_TOKEN")),
		ArquivosDir:       strings.TrimSpace(os.Getenv("ARQUIVOS_DIR")),
		AlertaWebhook:     strings.TrimSpace(os.Getenv("ALERT_WEBHOOK_URL")),
		ZAPIInstancia:     strings.TrimSpace(os.Getenv("ZAPI_INSTANCE_ID")),
		ZAPIToken:         strings.TrimSpace(os.Getenv("ZAPI_INSTANCE_TOKEN")),
		ZAPICliente:       strings.TrimSpace(os.Getenv("ZAPI_TOKEN")),
	}
```

Em `api/internal/config/config.go`, troque:

```go
	return append([]string{c.CoreToken, c.ChatwootSegredo, c.VAPIDPrivada, c.RDStationToken, c.AlertaWebhook}, c.ShopifySegredos...)
```

por:

```go
	return append([]string{c.CoreToken, c.ChatwootSegredo, c.VAPIDPrivada, c.RDStationToken, c.AlertaWebhook,
		c.ZAPIInstancia, c.ZAPIToken, c.ZAPICliente}, c.ShopifySegredos...)
```

Em `api/cmd/api/tarefas.go`, troque:

```go
	return ts
}
```

por:

```go
	zapi := &meta.ZAPI{InstanceID: cfg.ZAPIInstancia, InstanceToken: cfg.ZAPIToken, ClientToken: cfg.ZAPICliente}
	ts = append(ts, (&meta.RelatorioHora{Pool: p, ZAPI: zapi}).Tarefa())
	return ts
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `gofmt -l . && go vet ./... && go test -race -count=1 ./internal/meta/ ./internal/config/ ./cmd/api/ -v 2>&1 | grep -E -- '^(ok|FAIL|--- FAIL|--- SKIP)'`
Expected: `gofmt` não lista nada; só linhas `ok`, nenhuma `FAIL` nem `--- SKIP`.

- [ ] **Step 5: Commit**

```bash
git add api/internal/meta/relatorio_hora.go api/internal/meta/relatorio_hora_test.go api/internal/config/config.go api/internal/config/config_test.go api/cmd/api/tarefas.go api/cmd/api/worker_test.go
git commit -m "feat(api): enviar-relatorio-hora pela Z-API, uma vez por hora

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Mensagens de abandono: regras e cliente do Chatwoot

**Revisor:** **opus** (mensagem a cliente; credenciais do Chatwoot e do AgentBot).

A parte pura e o cliente HTTP do robô `enviar-mensagem-abandono` (porta de `supabase/functions/_shared/mensagem-de-abandono.js`, `rodada-completa.js`, `rodada-da-fila.js`, `rodada-de-mensagens.js` e `cliente-chatwoot.js`), sem mudar regra:

- `regras.go`: nome do cliente formatado, telefone normalizado para E.164 do Brasil, janela de envio, templates de marketing e de pedido (parâmetros do WhatsApp), validação da configuração (modos `desligado`/`seco`/`lista`/`ligado`, limites, `ENVIO_ATRASO_MINUTOS` que não é número reprova), decisão de envio por linha e trava cruzada.
- `config.go`: `LerConfig(os.Getenv)` lê as MESMAS variáveis da edge; tudo nasce desligado; `Segredos()` devolve o token da API e o segredo do AgentBot.
- `chatwoot.go`: buscar ou criar contato, abrir conversa, enviar template, saber se o cliente respondeu desde o envio, e reservar/liberar o aviso no `custom_api` com `X-Bot-Secret`. Todo erro carrega o passo e o status (`abrir_conversa:0 ...`), nunca o token; `classificarErro` separa credencial recusada (para a rodada), recusa do cliente e envio ambíguo.

**Files:**
- Create: `api/internal/mensagens/regras.go`
- Test: `api/internal/mensagens/regras_test.go`
- Create: `api/internal/mensagens/config.go`
- Create: `api/internal/mensagens/chatwoot.go`
- Test: `api/internal/mensagens/chatwoot_test.go`

**Interfaces:**
- Consumes: `texto.EspacoJS`, `texto.CortarUTF16` (Task 3).
- Produces:
  - `mensagens.Config`, `mensagens.Passada`, `mensagens.ChatwootConfig`, `mensagens.LerConfig(getenv func(string) string) Config`, `(Config).Segredos() []string`.
  - `type mensagens.Chatwoot struct { URL, ContaID string; CaixaID int64; Token, BotSecret string; HTTP *http.Client }` com `AcharOuCriarContato(ctx, nome *string, telefone string) (int64, error)`, `AbrirConversa(ctx, contatoID int64, telefone string) (int64, error)`, `EnviarTemplate(ctx, conversaID int64, texto string, params Template) error`, `Respondeu(ctx, conversaID int64, desde *time.Time) (bool, error)`, `ReservarAviso(ctx, phone, tipo, chave string, idadeS *int64) (string, error)`, `LiberarAviso(ctx, phone, tipo, chave string) string`.
  - `mensagens.ErroChatwoot`, `classificarErro`, `detalheDoErro`, `decidirEnvio`, `decidirLinha`, `validarConfig`, `templateMarketing`, `templatePedido`, `LinhaAbandono`, `LinhaFila`, `Decisao`, `Template`, `ParamsTemplate` (usados pela Task 10).
  - Nos testes: `chatwootFalso` (`lista()`, `chamadas()`), `novoChatwoot`, `caminhoFeliz`, `tokenChatwoot`, `segredoDoBot`.

- [ ] **Step 1: Escrever os testes que falham**

Crie `api/internal/mensagens/regras_test.go`:

```go
package mensagens

import (
	"encoding/json"
	"math"
	"slices"
	"testing"
	"time"
)

func s(v string) *string { return &v }

// Esperados gerados com o próprio _shared/mensagem-de-abandono.js (Node 22).
func TestNomesComoAEdge(t *testing.T) {
	for _, c := range []struct {
		entrada         string
		completo, curto string
	}{
		{"maysa priscila", "Maysa Priscila", "Maysa"},
		{"MARIA DA SILVA", "Maria da Silva", "Maria"},
		{"ana-clara d'avila", "Ana-Clara D'Avila", "Ana-Clara"},
		{"DeAndre mcKenzie", "DeAndre mcKenzie", "DeAndre"},
		{"  joão   E maria ", "João e Maria", "João"},
		{"ÉRICA DOS SANTOS", "Érica dos Santos", "Érica"},
		{"xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx y", "Xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx Y", "Xxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"},
	} {
		if got := formatarNomeCompleto(s(c.entrada)); got == nil || *got != c.completo {
			t.Errorf("formatarNomeCompleto(%q) = %v", c.entrada, got)
		}
		if got := primeiroNome(s(c.entrada)); got != c.curto {
			t.Errorf("primeiroNome(%q) = %q", c.entrada, got)
		}
	}
	for _, vazio := range []*string{nil, s(""), s("   ")} {
		if formatarNomeCompleto(vazio) != nil || primeiroNome(vazio) != "cliente" {
			t.Errorf("vazio %v: nome completo nulo e primeiro nome 'cliente'", vazio)
		}
	}
}

func TestNormalizarTelefone(t *testing.T) {
	for entrada, quer := range map[string]string{
		"(11) 98765-4321": "5511987654321", "5511987654321": "5511987654321", "+55 11 98765-4321": "5511987654321",
		"0055 11 98765-4321": "5511987654321", "1187654321": "", "551187654321": "", "11 8765-4321": "", "abc": "",
	} {
		if got := normalizarTelefone(s(entrada)); got != quer {
			t.Errorf("%q = %q, esperava %q", entrada, got, quer)
		}
	}
}

func TestTemplatesComoAEdge(t *testing.T) {
	b, _ := json.Marshal(templateMarketing("abandono_v2", "pt_BR", s("maria silva"), "abc?key=1"))
	if string(b) != `{"name":"abandono_v2","category":"MARKETING","language":"pt_BR","processed_params":{"body":{"1":"Maria"},"buttons":[{"type":"url","parameter":"abc?key=1"}]}}` {
		t.Fatalf("%s", b)
	}
	b, _ = json.Marshal(templatePedido("pedido_v1", "pt_BR", s("MARIA"), s("1001")))
	if string(b) != `{"name":"pedido_v1","category":"UTILITY","language":"pt_BR","processed_params":{"body":{"1":"Maria","2":"1001"}}}` {
		t.Fatalf("pedido sem botão: %s", b)
	}
}

func TestValidarConfigComoAEdge(t *testing.T) {
	ruim := Passada{Modo: "ligado", Limite: math.NaN(), LinkBase: "https://x"}
	quer := []string{"ENVIO_LIMITE_POR_RODADA inválido (inteiro de 1 a 100)", "LINK_BASE vazio ou sem a barra final", "TEMPLATE_NOME vazio",
		"CHATWOOT_URL vazio ou sem http(s)", "CHATWOOT_CONTA_ID vazio", "CHATWOOT_CAIXA_ID vazio ou inválido", "CHATWOOT_API_TOKEN vazio"}
	if got := validarConfig(ruim, ChatwootConfig{URL: "x", CaixaID: "0"}, true); !slices.Equal(got, quer) {
		t.Fatalf("%q", got)
	}
	lista := Passada{Modo: "lista", Limite: 10, LinkBase: "https://x/", TemplateNome: "t"}
	if got := validarConfig(lista, ChatwootConfig{URL: "https://c", ContaID: "1", CaixaID: "2", Token: "k"}, true); !slices.Equal(got, []string{"ENVIO_SO_PARA vazio"}) {
		t.Fatalf("%q", got)
	}
	if got := validarConfig(Passada{Modo: "seco", Limite: 200}, ChatwootConfig{}, false); !slices.Equal(got, quer[:1]) {
		t.Fatalf("seco só exige limite (e link quando o tipo exige): %q", got)
	}
}

func TestLerConfigNasceDesligadoEComOsPadroes(t *testing.T) {
	env := map[string]string{"ENVIO_MODO": "seco", "ENVIO_SO_PARA": "(11) 98765-4321, ,5521999990000", "RESERVAR_AVISO_CHATWOOT": "true",
		"ENVIO_LIMITE_POR_RODADA": "abc", "ABANDONO_TRAVA_CRUZADA": "Não"}
	c := LerConfig(func(k string) string { return env[k] })
	if c.Inicio.Modo != "desligado" || c.Pedido.Modo != "desligado" || c.Followup.Modo != "desligado" || c.Abandono.Modo != "seco" {
		t.Fatalf("modos: %+v", c)
	}
	if c.Inicio.MaxHoras != 1 || c.Pedido.MaxHoras != 2 || c.Abandono.MaxHoras != 24 || c.Followup.MaxHoras != 24 || c.FollowupAposHoras != 48 {
		t.Fatalf("padrões de horas: %+v", c)
	}
	if !math.IsNaN(c.Abandono.Limite) || !c.Pedido.ReservarAviso || c.Abandono.ReservarAviso || c.Abandono.TravaCruzada || c.Abandono.Idioma != "pt_BR" {
		t.Fatalf("%+v", c.Abandono)
	}
	if !slices.Equal(c.Abandono.SoPara, []string{"11987654321", "5521999990000"}) {
		t.Fatalf("soPara: %q", c.Abandono.SoPara)
	}
	if !travaCruzadaLigada("") || !travaCruzadaLigada("sim") || travaCruzadaLigada(" OFF ") {
		t.Fatal("trava cruzada padrão LIGADA")
	}
}

func TestDecidir(t *testing.T) {
	dentro := time.Date(2026, 10, 10, 15, 0, 0, 0, time.UTC) // 12:00 em SP
	fora := time.Date(2026, 10, 11, 0, 30, 0, 0, time.UTC)   // 21:30 em SP
	base := "https://loja.com/checkouts/"
	l := LinhaAbandono{Token: "t", Telefone: s("11 98765-4321"), Status: "fila_envio", URL: s(base + "abc?key=1")}
	if d := decidirEnvio(l, nil, dentro, base); d.Acao != "enviar" || d.Telefone != "5511987654321" || d.Sufixo != "abc?key=1" {
		t.Fatalf("%+v", d)
	}
	for nome, c := range map[string]struct {
		l      LinhaAbandono
		agora  time.Time
		bloq   map[string]bool
		motivo string
	}{
		"saiu da fila": {LinhaAbandono{Status: "comprou", Telefone: l.Telefone, URL: l.URL}, dentro, nil, "nao_esta_mais_na_fila"},
		"sem telefone": {LinhaAbandono{Status: "fila_envio", Telefone: s(" "), URL: l.URL}, dentro, nil, "sem_telefone"},
		"fixo":         {LinhaAbandono{Status: "fila_envio", Telefone: s("1132654321"), URL: l.URL}, dentro, nil, "telefone_invalido"},
		"pediu parar":  {l, dentro, map[string]bool{"5511987654321": true}, "pediu_para_nao_receber"},
		"outra base":   {LinhaAbandono{Status: "fila_envio", Telefone: l.Telefone, URL: s("https://outra/x")}, dentro, nil, "sem_link"},
		"fora janela":  {l, fora, nil, "fora_da_janela"},
	} {
		if d := decidirEnvio(c.l, c.bloq, c.agora, base); d.Motivo != c.motivo {
			t.Errorf("%s: %+v", nome, d)
		}
	}
	f := LinhaFila{Chave: "k", Telefone: l.Telefone}
	if d := decidirLinha("pedido", f, map[string]bool{"5511987654321": true}, dentro, ""); d.Acao != "enviar" {
		t.Fatalf("pedido é transacional: ignora bloqueados e link: %+v", d)
	}
	if d := decidirLinha("inicio", f, nil, dentro, base); d.Acao != "esperar" || d.Motivo != "sem_link_ainda" {
		t.Fatalf("inicio sem link ainda espera: %+v", d)
	}
	if d := decidirLinha("followup", f, nil, dentro, base); d.Motivo != "sem_link" {
		t.Fatalf("followup sem link é ignorado: %+v", d)
	}
	if amostraDoSufixo("abc?KEY=segredo&x=1") != "abc?KEY=…&x=1" {
		t.Fatal("a chave de recuperação não vai para o log")
	}
}
```

Crie `api/internal/mensagens/chatwoot_test.go`:

```go
package mensagens

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"
)

const (
	tokenChatwoot = "token-do-chatwoot-abc123"
	segredoDoBot  = "segredo-do-agentbot-xyz789"
)

// chatwootFalso: o Chatwoot de mentira. `resp` decide a resposta por "MÉTODO caminho"; o padrão é
// o caminho feliz (contato achado com o telefone como nome, conversa 77, mensagem aceita, nada recebido).
type chatwootFalso struct {
	mu      sync.Mutex
	pedidos []string // "MÉTODO caminho corpo"
	cabecas []http.Header
	resp    func(metodo, caminho string, corpo map[string]any) (int, string)
}

// lista: cópia dos pedidos e cabeçalhos (sob a trava: o servidor anota em outra goroutine).
func (f *chatwootFalso) lista() ([]string, []http.Header) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return slices.Clone(f.pedidos), slices.Clone(f.cabecas)
}

func (f *chatwootFalso) chamadas(prefixo string) int {
	f.mu.Lock()
	defer f.mu.Unlock()
	n := 0
	for _, p := range f.pedidos {
		if strings.HasPrefix(p, prefixo) {
			n++
		}
	}
	return n
}

func novoChatwoot(t *testing.T, resp func(metodo, caminho string, corpo map[string]any) (int, string)) (*Chatwoot, *chatwootFalso) {
	t.Helper()
	f := &chatwootFalso{resp: resp}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		var corpo map[string]any
		json.Unmarshal(b, &corpo)
		caminho := r.URL.Path
		if r.URL.RawQuery != "" {
			caminho += "?" + r.URL.RawQuery
		}
		f.mu.Lock()
		f.pedidos = append(f.pedidos, r.Method+" "+caminho+" "+string(b))
		f.cabecas = append(f.cabecas, r.Header.Clone())
		f.mu.Unlock()
		st, txt := 0, ""
		if f.resp != nil {
			st, txt = f.resp(r.Method, caminho, corpo)
		}
		if st == 0 {
			st, txt = caminhoFeliz(r.Method, caminho)
		}
		if st == -1 { // derruba a conexão: rede/prazo (status 0)
			c, _, _ := w.(http.Hijacker).Hijack()
			c.Close()
			return
		}
		w.WriteHeader(st)
		io.WriteString(w, txt)
	}))
	t.Cleanup(srv.Close)
	return &Chatwoot{URL: srv.URL + "/", ContaID: "3", CaixaID: 9, Token: tokenChatwoot, BotSecret: segredoDoBot}, f
}

func caminhoFeliz(metodo, caminho string) (int, string) {
	switch {
	case strings.HasPrefix(caminho, "/api/v1/accounts/3/contacts/search"):
		return 200, `{"payload":[{"id":51,"name":"+55 11 98765-4321","phone_number":"+5511987654321"}]}`
	case metodo == "PUT" && strings.HasPrefix(caminho, "/api/v1/accounts/3/contacts/"):
		return 200, `{"payload":{"id":51}}`
	case metodo == "POST" && caminho == "/api/v1/accounts/3/contacts":
		return 200, `{"payload":{"contact":{"id":52}}}`
	case metodo == "POST" && caminho == "/api/v1/accounts/3/conversations":
		return 200, `{"id":77}`
	case metodo == "POST" && strings.HasSuffix(caminho, "/messages"):
		return 200, `{"id":901}`
	case metodo == "GET" && strings.HasSuffix(caminho, "/messages"):
		return 200, `{"payload":[{"message_type":1,"created_at":1760000000},{"message_type":3,"created_at":1760000100}]}`
	case strings.HasSuffix(caminho, "/avisos/reservar"):
		return 200, `{"ok":true,"resultado":"reservado"}`
	case strings.HasSuffix(caminho, "/avisos/liberar"):
		return 200, `{"ok":true,"resultado":"liberado"}`
	}
	return 404, `{"error":"rota de teste desconhecida"}`
}

func TestAcharOuCriarContato(t *testing.T) {
	c, f := novoChatwoot(t, nil)
	ctx := context.Background()
	id, err := c.AcharOuCriarContato(ctx, s("Maria Silva"), "5511987654321")
	if err != nil || id != 51 {
		t.Fatalf("id=%d err=%v", id, err)
	}
	pedidos, cabecas := f.lista()
	if pedidos[0] != "GET /api/v1/accounts/3/contacts/search?q=%2B5511987654321 " || cabecas[0].Get("api_access_token") != tokenChatwoot {
		t.Fatalf("busca: %q", pedidos[0])
	}
	if pedidos[1] != `PUT /api/v1/accounts/3/contacts/51 {"name":"Maria Silva"}` {
		t.Fatalf("o telefone como nome vira o nome da cliente: %q", pedidos[1])
	}
	// Nome real que alguém já pôs nunca é sobrescrito; contato novo é criado com o nome (ou o +55…).
	c2, f2 := novoChatwoot(t, func(m, cam string, _ map[string]any) (int, string) {
		if strings.Contains(cam, "search") {
			return 200, `{"payload":[{"id":60,"name":"Dona Maria","phone_number":"+5511987654321"}]}`
		}
		return 0, ""
	})
	if id, _ := c2.AcharOuCriarContato(ctx, s("Maria"), "5511987654321"); id != 60 || f2.chamadas("PUT") != 0 {
		t.Fatalf("id=%d puts=%d", id, f2.chamadas("PUT"))
	}
	c3, f3 := novoChatwoot(t, func(m, cam string, _ map[string]any) (int, string) {
		if strings.Contains(cam, "search") {
			return 200, `{"payload":[]}`
		}
		return 0, ""
	})
	id3, _ := c3.AcharOuCriarContato(ctx, nil, "5511987654321")
	p3, _ := f3.lista()
	if id3 != 52 || !strings.Contains(p3[1], `"name":"+5511987654321"`) || !strings.Contains(p3[1], `"inbox_id":9`) {
		t.Fatalf("id=%d criar=%q", id3, p3[1])
	}
	// PUT do nome com 401 para a rodada; com 500, segue (nome é cosmético).
	for st, quer := range map[int]bool{401: true, 500: false} {
		c4, _ := novoChatwoot(t, func(m, cam string, _ map[string]any) (int, string) {
			if m == "PUT" {
				return st, `{}`
			}
			return 0, ""
		})
		_, err := c4.AcharOuCriarContato(ctx, s("Maria"), "5511987654321")
		if (err != nil) != quer {
			t.Errorf("PUT %d: err=%v", st, err)
		}
	}
}

func TestRespondeuDesde(t *testing.T) {
	ctx := context.Background()
	desde := time.Unix(1760000000, 500e6) // 1760000000,5 s
	casos := []struct {
		corpo string
		desde *time.Time
		quer  bool
		erro  string
	}{
		{`{"payload":[{"message_type":0,"created_at":1759999999}]}`, &desde, false, ""}, // conversa antiga com a loja não conta
		{`{"payload":[{"message_type":0,"created_at":1760000001}]}`, &desde, true, ""},
		{`[{"message_type":0,"created_at":1}]`, nil, true, ""},
		{`{"payload":[{"message_type":1,"created_at":1760000009}]}`, &desde, false, ""},
		{`{"payload":[{"message_type":0}]}`, &desde, false, "mensagem_sem_data"},
		{`{"nada":1}`, nil, false, "resposta_inesperada"},
	}
	for i, c := range casos {
		cw, _ := novoChatwoot(t, func(m, cam string, _ map[string]any) (int, string) {
			if m == "GET" && strings.HasSuffix(cam, "/messages") {
				return 200, c.corpo
			}
			return 0, ""
		})
		got, err := cw.Respondeu(ctx, 77, c.desde)
		var ec *ErroChatwoot
		if got != c.quer || (c.erro == "") != (err == nil) || (c.erro != "" && (!errors.As(err, &ec) || ec.Corpo != c.erro)) {
			t.Errorf("caso %d: %v %v", i, got, err)
		}
	}
}

func TestReservarELiberarAviso(t *testing.T) {
	ctx := context.Background()
	idade := int64(30)
	for _, c := range []struct {
		st    int
		corpo string
		quer  string
		erro  int // status do ErroChatwoot; -1 = sem erro
	}{
		{200, `{"ok":true,"resultado":"adiado"}`, "adiado", -1},
		{200, `{"ok":true,"resultado":"duplicado"}`, "duplicado", -1},
		{200, `{"ok":true,"resultado":"talvez"}`, "", 200},
		{200, `não é json`, "", 200},
		{401, `{}`, "", 401},
		{503, `{}`, "", 503},
		{-1, ``, "", 0},
	} {
		cw, f := novoChatwoot(t, func(m, cam string, _ map[string]any) (int, string) {
			if strings.HasSuffix(cam, "/reservar") {
				return c.st, c.corpo
			}
			return 0, ""
		})
		got, err := cw.ReservarAviso(ctx, "5511987654321", "pedido_recebido", "1001", &idade)
		var ec *ErroChatwoot
		if got != c.quer || (c.erro == -1) != (err == nil) || (c.erro != -1 && (!errors.As(err, &ec) || ec.Status != c.erro || ec.Passo != "reservar_aviso")) {
			t.Errorf("%d %s: %q %v", c.st, c.corpo, got, err)
		}
		if err != nil && (strings.Contains(err.Error(), segredoDoBot) || strings.Contains(err.Error(), "5511987654321")) {
			t.Errorf("segredo ou telefone no erro: %v", err)
		}
		pedidos, cabecas := f.lista()
		if len(cabecas) > 0 && (cabecas[0].Get("X-Bot-Secret") != segredoDoBot || cabecas[0].Get("api_access_token") != "") {
			t.Errorf("a reserva usa o X-Bot-Secret, não o token da API")
		}
		if c.st == 200 && !strings.Contains(pedidos[0], `"idade_s":30`) {
			t.Errorf("idade_s não foi: %q", pedidos[0])
		}
	}
	cw, _ := novoChatwoot(t, func(m, cam string, _ map[string]any) (int, string) { return -1, "" })
	if got := cw.LiberarAviso(ctx, "5511987654321", "pedido_recebido", "1001"); got != "" {
		t.Fatalf("liberar é best-effort: %q", got)
	}
}

func TestClassificarEDetalhe(t *testing.T) {
	for _, c := range []struct {
		err  error
		quer string
	}{
		{&ErroChatwoot{0, "x", "enviar_template"}, "falhou"}, // rede NO envio: pode ter saído
		{&ErroChatwoot{0, "x", "abrir_conversa"}, "tentar_de_novo"},
		{&ErroChatwoot{401, nil, "buscar_contato"}, "parar"},
		{&ErroChatwoot{403, nil, "enviar_template"}, "parar"},
		{&ErroChatwoot{429, nil, "enviar_template"}, "tentar_de_novo"},
		{&ErroChatwoot{502, nil, "enviar_template"}, "tentar_de_novo"},
		{&ErroChatwoot{422, nil, "enviar_template"}, "falhou"},
		{errors.New("outra coisa"), "tentar_de_novo"},
	} {
		if got := classificarErro(c.err); got != c.quer {
			t.Errorf("%v = %s", c.err, got)
		}
	}
	if d := detalheDoErro(&ErroChatwoot{422, map[string]any{"error": "Template <inválido>"}, "enviar_template"}); d != `enviar_template:422 {"error":"Template <inválido>"}` {
		t.Fatalf("%q", d)
	}
	cw, _ := novoChatwoot(t, func(m, cam string, _ map[string]any) (int, string) { return -1, "" })
	_, err := cw.AbrirConversa(context.Background(), 51, "5511987654321")
	if err == nil || strings.Contains(detalheDoErro(err), tokenChatwoot) || !strings.HasPrefix(detalheDoErro(err), "abrir_conversa:0 ") {
		t.Fatalf("rede: %v / %q", err, detalheDoErro(err))
	}
}
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `go test -count=1 ./internal/mensagens`
Expected: FAIL. Primeiras falhas, como saíram no ensaio deste plano: `undefined: Chatwoot`, `undefined: ErroChatwoot`

- [ ] **Step 3: Implementar**

Crie `api/internal/mensagens/regras.go`:

```go
package mensagens

import (
	"fmt"
	"math"
	"regexp"
	"strings"
	"time"
	_ "time/tzdata" // America/Sao_Paulo sem depender do zoneinfo do contêiner

	"github.com/rbv-co/social-dashboard/api/internal/texto"
)

// Regras PURAS de _shared/mensagem-de-abandono.js e _shared/trava-cruzada.js (sem rede, sem banco).

var saoPaulo = func() *time.Location {
	l, err := time.LoadLocation("America/Sao_Paulo")
	if err != nil {
		panic(err)
	}
	return l
}()

const (
	janelaInicio = 8  // 08:00 entra
	janelaFim    = 21 // 21:00 não entra
)

var (
	reSeparadorDeNome = regexp.MustCompile(`(^|[-'’])(\p{L})`)
	reEspacos         = regexp.MustCompile(texto.EspacoJS + `+`)
	reNaoDigito       = regexp.MustCompile(`\D`)
	reCelular         = regexp.MustCompile(`^55[1-9][1-9]9\d{8}$`)
	particulas        = map[string]bool{"da": true, "de": true, "do": true, "das": true, "dos": true, "e": true}
)

// capitalizarNome: "maria"/"MARIA" -> "Maria"; "ana-clara" -> "Ana-Clara". Caixa MISTURADA foi digitada
// de propósito ("DeAndre", "McKenzie"): fica como veio.
func capitalizarNome(p string) string {
	minusculo := strings.ToLower(p)
	if p != minusculo && p != strings.ToUpper(p) {
		return p
	}
	return reSeparadorDeNome.ReplaceAllStringFunc(minusculo, strings.ToUpper)
}

// palavras = s.trim().split(/\s+/) do JS (com o \s do JS), sem itens vazios.
func palavras(s string) []string {
	t := strings.Trim(reEspacos.ReplaceAllString(s, " "), " ")
	if t == "" {
		return nil
	}
	return strings.Split(t, " ")
}

// formatarNomeCompleto: "MARIA DA SILVA" -> "Maria da Silva". Vazio = nil (quem chama cai no telefone).
func formatarNomeCompleto(nome *string) *string {
	if nome == nil {
		return nil
	}
	ps := palavras(*nome)
	if len(ps) == 0 {
		return nil
	}
	for i, p := range ps {
		minuscula := strings.ToLower(p)
		soUmCaso := p == minuscula || p == strings.ToUpper(p)
		if i > 0 && soUmCaso && particulas[minuscula] {
			ps[i] = minuscula
		} else {
			ps[i] = capitalizarNome(p)
		}
	}
	s := strings.Join(ps, " ")
	return &s
}

// primeiroNome nunca devolve vazio: o template exige a variável preenchida.
func primeiroNome(nome *string) string {
	if nome == nil {
		return "cliente"
	}
	ps := palavras(*nome)
	if len(ps) == 0 {
		return "cliente"
	}
	return capitalizarNome(texto.CortarUTF16(ps[0], 30))
}

// normalizarTelefone: celular brasileiro como o Chatwoot/WhatsApp usa (55 + DDD + 9 + 8 dígitos).
// Fixo e celular sem o 9 não recebem WhatsApp de forma confiável: nil.
func normalizarTelefone(bruto *string) string {
	if bruto == nil {
		return ""
	}
	d := reNaoDigito.ReplaceAllString(*bruto, "")
	d = strings.TrimPrefix(d, "00")
	if len(d) == 10 || len(d) == 11 {
		d = "55" + d
	}
	if !reCelular.MatchString(d) {
		return ""
	}
	return d
}

// dentroDaJanela: 08:00 <= hora < 21:00 em Brasília.
func dentroDaJanela(agora time.Time) bool {
	h := agora.In(saoPaulo).Hour()
	return h >= janelaInicio && h < janelaFim
}

// sufixoDoLink: o link dinâmico do botão = base FIXA + sufixo. Base vazia nunca casa (o "sufixo" seria
// a URL inteira e o botão quebraria).
func sufixoDoLink(url *string, base string) string {
	if base == "" || url == nil || !strings.HasPrefix(*url, base) {
		return ""
	}
	return (*url)[len(base):]
}

// Template é o template_params que o Chatwoot aceita (app/models/message.rb). O botão de URL precisa
// ser o PRIMEIRO botão do template: o Chatwoot usa a posição.
type Template struct {
	Name            string         `json:"name"`
	Category        string         `json:"category"`
	Language        string         `json:"language"`
	ProcessedParams ParamsTemplate `json:"processed_params"`
}

type ParamsTemplate struct {
	Body    map[string]any `json:"body"` // any: o número do pedido pode ir nulo, como na edge
	Buttons []Botao        `json:"buttons,omitempty"`
}

type Botao struct {
	Type      string `json:"type"`
	Parameter string `json:"parameter"`
}

// templateMarketing: abandono, follow-up e inicio — MARKETING, {1: nome} e o link no primeiro botão.
func templateMarketing(nomeTemplate, idioma string, nome *string, sufixo string) Template {
	return Template{nomeTemplate, "MARKETING", idioma, ParamsTemplate{map[string]any{"1": primeiroNome(nome)}, []Botao{{"url", sufixo}}}}
}

// templatePedido: pedido recebido — UTILITY, {1: nome, 2: número} e NENHUM botão (link reclassificaria
// como marketing).
func templatePedido(nomeTemplate, idioma string, nome *string, numero *string) Template {
	return Template{nomeTemplate, "UTILITY", idioma, ParamsTemplate{map[string]any{"1": primeiroNome(nome), "2": numero}, nil}}
}

const limiteMaximoPorRodada = 100

func inteiro(x float64) bool { return !math.IsNaN(x) && !math.IsInf(x, 0) && x == math.Trunc(x) }

// validarConfig: o que o robô exige ANTES de tocar em qualquer linha. Falha FECHADA: segredo ausente
// ou inválido nunca vira "sem limite" nem "link quebrado para todos". O seco não fala com o Chatwoot.
func validarConfig(c Passada, chat ChatwootConfig, exigeLink bool) []string {
	var p []string
	if !inteiro(c.Limite) || c.Limite < 1 || c.Limite > limiteMaximoPorRodada {
		p = append(p, fmt.Sprintf("ENVIO_LIMITE_POR_RODADA inválido (inteiro de 1 a %d)", limiteMaximoPorRodada))
	}
	if exigeLink && (c.LinkBase == "" || !strings.HasSuffix(c.LinkBase, "/")) {
		p = append(p, "LINK_BASE vazio ou sem a barra final")
	}
	if c.Modo == "seco" {
		return p
	}
	if c.TemplateNome == "" {
		p = append(p, "TEMPLATE_NOME vazio")
	}
	if !strings.HasPrefix(chat.URL, "http://") && !strings.HasPrefix(chat.URL, "https://") {
		p = append(p, "CHATWOOT_URL vazio ou sem http(s)")
	}
	if chat.ContaID == "" {
		p = append(p, "CHATWOOT_CONTA_ID vazio")
	}
	if caixa := numeroJS(chat.CaixaID, math.NaN()); !inteiro(caixa) || caixa < 1 {
		p = append(p, "CHATWOOT_CAIXA_ID vazio ou inválido")
	}
	if chat.Token == "" {
		p = append(p, "CHATWOOT_API_TOKEN vazio")
	}
	if c.Modo == "lista" && len(c.SoPara) == 0 {
		p = append(p, "ENVIO_SO_PARA vazio")
	}
	return p
}

// Decisao é o que fazer com UMA linha antes de qualquer chamada externa.
type Decisao struct {
	Acao     string // enviar | ignorar | esperar
	Motivo   string
	Telefone string
	Sufixo   string
}

// decidirEnvio (abandono): na fila, com telefone de celular, sem pedido de parar, com link da base e
// dentro da janela.
func decidirEnvio(l LinhaAbandono, bloqueados map[string]bool, agora time.Time, base string) Decisao {
	if l.Status != "fila_envio" {
		return Decisao{Acao: "ignorar", Motivo: "nao_esta_mais_na_fila"}
	}
	if l.Telefone == nil || strings.TrimSpace(*l.Telefone) == "" {
		return Decisao{Acao: "ignorar", Motivo: "sem_telefone"}
	}
	tel := normalizarTelefone(l.Telefone)
	if tel == "" {
		return Decisao{Acao: "ignorar", Motivo: "telefone_invalido"}
	}
	if bloqueados[tel] {
		return Decisao{Acao: "ignorar", Motivo: "pediu_para_nao_receber"}
	}
	suf := sufixoDoLink(l.URL, base)
	if suf == "" {
		return Decisao{Acao: "ignorar", Motivo: "sem_link"}
	}
	if !dentroDaJanela(agora) {
		return Decisao{Acao: "esperar", Motivo: "fora_da_janela"}
	}
	return Decisao{Acao: "enviar", Telefone: tel, Sufixo: suf}
}

// decidirLinha (rodada-da-fila.js): pedido é transacional (sem bloqueados nem link); inicio e
// follow-up são marketing (bloqueados e link). inicio sem link AINDA espera (o link chega num evento
// seguinte do checkout) sem gastar tentativa.
func decidirLinha(tipo string, l LinhaFila, bloqueados map[string]bool, agora time.Time, base string) Decisao {
	if l.Telefone == nil || strings.TrimSpace(*l.Telefone) == "" {
		return Decisao{Acao: "ignorar", Motivo: "sem_telefone"}
	}
	tel := normalizarTelefone(l.Telefone)
	if tel == "" {
		return Decisao{Acao: "ignorar", Motivo: "telefone_invalido"}
	}
	suf := ""
	if tipo == "followup" || tipo == "inicio" {
		if bloqueados[tel] {
			return Decisao{Acao: "ignorar", Motivo: "pediu_para_nao_receber"}
		}
		if tipo == "inicio" && (l.URL == nil || *l.URL == "") {
			return Decisao{Acao: "esperar", Motivo: "sem_link_ainda"}
		}
		if suf = sufixoDoLink(l.URL, base); suf == "" {
			return Decisao{Acao: "ignorar", Motivo: "sem_link"}
		}
	}
	if !dentroDaJanela(agora) {
		return Decisao{Acao: "esperar", Motivo: "fora_da_janela"}
	}
	return Decisao{Acao: "enviar", Telefone: tel, Sufixo: suf}
}

// travaCruzadaLigada: ABANDONO_TRAVA_CRUZADA padrão LIGADA; só desliga com false/0/off/nao/não.
func travaCruzadaLigada(v string) bool {
	switch strings.ToLower(strings.TrimSpace(v)) {
	case "false", "0", "off", "nao", "não":
		return false
	}
	return true
}

const (
	motivoTravaCruzada = "ignorada_trava_cruzada"
	horasDaTrava       = 20
)

// amostraDoSufixo: o sufixo do link sem a chave secreta de recuperação (vai para o log do modo seco).
var reChave = regexp.MustCompile(`(?i)(key=)[^&]*`)

func amostraDoSufixo(s string) string { return reChave.ReplaceAllString(s, "${1}…") }

// LinhaAbandono é o que pegar_para_mensagem devolve (uma linha de checkout_abandono).
type LinhaAbandono struct {
	Token               string
	Telefone, Nome, URL *string
	Status              string
	IniciadoEm          time.Time
}

// LinhaFila é o que pegar_da_fila devolve (uma linha de mensagem_fila).
type LinhaFila struct {
	Chave                       string
	Numero, Nome, Telefone, URL *string
	ConversaOrigem              *int64
	CriadoEm                    time.Time
}
```

Crie `api/internal/mensagens/config.go`:

```go
package mensagens

import (
	"math"
	"strconv"
	"strings"
)

// ChatwootConfig: CHATWOOT_URL, CHATWOOT_CONTA_ID, CHATWOOT_CAIXA_ID, CHATWOOT_API_TOKEN e
// CHATWOOT_BOT_SECRET (o segredo do AgentBot, só para reservar/liberar o aviso).
type ChatwootConfig struct {
	URL, ContaID, CaixaID, Token, BotSecret string
}

// Passada é a configuração de UMA passada (inicio, pedido, abandono, followup).
type Passada struct {
	Modo                        string // desligado | seco | lista | ligado
	Limite                      float64
	MaxHoras                    float64
	AtrasoMin                   float64 // só o abandono
	SoPara                      []string
	LinkBase, Idioma            string
	TemplateNome, TemplateTexto string
	TravaCruzada                bool
	ReservarAviso               bool // só o pedido
}

// Config é o ambiente do robô (rodada-completa.js). ⚠️ NASCE TUDO DESLIGADO: modo vazio = desligado.
type Config struct {
	Chatwoot                           ChatwootConfig
	Inicio, Pedido, Abandono, Followup Passada
	FollowupAposHoras                  float64
}

// numeroJS = Number(v || padrao) do JS: vazio vira o padrão; texto que não é número vira NaN (e a
// validação RECUSA, nunca "sem limite").
func numeroJS(v string, padrao float64) float64 {
	if v == "" {
		return padrao
	}
	f, err := strconv.ParseFloat(strings.TrimSpace(v), 64)
	if err != nil {
		return math.NaN()
	}
	return f
}

// LerConfig lê o mesmo ambiente da edge enviar-mensagem-abandono (getenv = os.Getenv).
func LerConfig(getenv func(string) string) Config {
	var soPara []string
	for _, n := range strings.Split(getenv("ENVIO_SO_PARA"), ",") {
		if d := reNaoDigito.ReplaceAllString(n, ""); d != "" {
			soPara = append(soPara, d)
		}
	}
	idioma := getenv("TEMPLATE_IDIOMA")
	if idioma == "" {
		idioma = "pt_BR"
	}
	modo := func(nome string) string {
		if m := getenv(nome); m != "" {
			return m
		}
		return "desligado"
	}
	base := Passada{Limite: numeroJS(getenv("ENVIO_LIMITE_POR_RODADA"), 10), SoPara: soPara, LinkBase: getenv("LINK_BASE"),
		Idioma: idioma, TravaCruzada: travaCruzadaLigada(getenv("ABANDONO_TRAVA_CRUZADA"))}
	passada := func(m, maxHoras, padraoHoras, template, textoTemplate string) Passada {
		p := base
		p.Modo, p.MaxHoras = modo(m), numeroJS(getenv(maxHoras), parse(padraoHoras))
		p.TemplateNome, p.TemplateTexto = getenv(template), getenv(textoTemplate)
		return p
	}
	c := Config{
		Chatwoot: ChatwootConfig{URL: getenv("CHATWOOT_URL"), ContaID: getenv("CHATWOOT_CONTA_ID"), CaixaID: getenv("CHATWOOT_CAIXA_ID"),
			Token: getenv("CHATWOOT_API_TOKEN"), BotSecret: getenv("CHATWOOT_BOT_SECRET")},
		Inicio:            passada("ENVIO_MODO_INICIO", "INICIO_MAX_HORAS", "1", "TEMPLATE_INICIO", "TEMPLATE_TEXTO_INICIO"),
		Pedido:            passada("ENVIO_MODO_PEDIDO", "PEDIDO_MAX_HORAS", "2", "TEMPLATE_PEDIDO", "TEMPLATE_TEXTO_PEDIDO"),
		Abandono:          passada("ENVIO_MODO", "ENVIO_MAX_HORAS", "24", "TEMPLATE_NOME", "TEMPLATE_TEXTO"),
		Followup:          passada("ENVIO_MODO_FOLLOWUP", "FOLLOWUP_MAX_HORAS", "24", "TEMPLATE_FOLLOWUP", "TEMPLATE_TEXTO_FOLLOWUP"),
		FollowupAposHoras: numeroJS(getenv("FOLLOWUP_APOS_HORAS"), 48),
	}
	c.Pedido.ReservarAviso = getenv("RESERVAR_AVISO_CHATWOOT") == "true"
	// Number(env('ENVIO_ATRASO_MINUTOS') || 0): sem padrão de validação na edge; aqui NaN reprova.
	c.Abandono.AtrasoMin = numeroJS(getenv("ENVIO_ATRASO_MINUTOS"), 0)
	return c
}

func parse(s string) float64 { f, _ := strconv.ParseFloat(s, 64); return f }

// Segredos: os valores do ambiente das mensagens que nunca podem ir para log nem robos_execucoes.
func (c Config) Segredos() []string { return []string{c.Chatwoot.Token, c.Chatwoot.BotSecret} }
```

Crie `api/internal/mensagens/chatwoot.go`:

```go
package mensagens

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/rbv-co/social-dashboard/api/internal/texto"
)

// Porta de _shared/cliente-chatwoot.js. O token NUNCA aparece em log nem em mensagem de erro.

// ErroChatwoot: Status 0 = rede/prazo (sem resposta), com o PASSO em que falhou.
type ErroChatwoot struct {
	Status int
	Corpo  any
	Passo  string
}

func (e *ErroChatwoot) Error() string { return fmt.Sprintf("chatwoot %s: HTTP %d", e.Passo, e.Status) }

const (
	prazoChatwoot = 15 * time.Second
	prazoLiberar  = 4 * time.Second // best-effort, no caminho de erro: não pode segurar a rodada
)

// classificarErro: 401/403 -> parar a rodada (credencial); 429/5xx/rede -> tentar de novo; demais 4xx
// -> falhou. ⚠️ Rede/prazo NO enviar_template NÃO tenta de novo: a mensagem pode ter saído.
func classificarErro(err error) string {
	var e *ErroChatwoot
	if !errors.As(err, &e) {
		return "tentar_de_novo"
	}
	switch {
	case e.Status == 0 && e.Passo == "enviar_template":
		return "falhou"
	case e.Status == 0:
		return "tentar_de_novo"
	case e.Status == 401 || e.Status == 403:
		return "parar"
	case e.Status == 429 || e.Status >= 500:
		return "tentar_de_novo"
	}
	return "falhou"
}

// detalheDoErro: `${passo}:${status} ${JSON.stringify(corpo ?? ”).slice(0,160)}` (ou o texto do erro).
func detalheDoErro(err error) string {
	var e *ErroChatwoot
	if !errors.As(err, &e) {
		return texto.CortarUTF16(err.Error(), 160)
	}
	var b bytes.Buffer
	enc := json.NewEncoder(&b)
	enc.SetEscapeHTML(false) // como o JSON.stringify
	corpo := e.Corpo
	if corpo == nil {
		corpo = ""
	}
	enc.Encode(corpo)
	return fmt.Sprintf("%s:%d %s", e.Passo, e.Status, texto.CortarUTF16(strings.TrimRight(b.String(), "\n"), 160))
}

// Chatwoot é o cliente mínimo da API do Chatwoot para o robô.
type Chatwoot struct {
	URL, ContaID string
	CaixaID      int64
	Token        string // api_access_token
	BotSecret    string // X-Bot-Secret do custom_api (reserva do aviso)
	HTTP         *http.Client
}

func (c *Chatwoot) cliente() *http.Client {
	if c.HTTP != nil {
		return c.HTTP
	}
	return http.DefaultClient
}

func (c *Chatwoot) raiz() string { return strings.TrimSuffix(c.URL, "/") }

// semURL: o erro do http.Client traz a URL; fica só a causa (cortada).
func semURL(err error) string {
	var ue *url.Error
	if errors.As(err, &ue) {
		err = ue.Err
	}
	return texto.CortarUTF16(err.Error(), 160)
}

func decodificar(b []byte) any {
	if len(b) == 0 {
		return nil
	}
	d := json.NewDecoder(bytes.NewReader(b))
	d.UseNumber()
	var v any
	if d.Decode(&v) != nil {
		return string(b) // corpo que não é JSON: fica o texto
	}
	return v
}

func (c *Chatwoot) chamar(ctx context.Context, passo, metodo, caminho string, corpo any) (any, error) {
	ctx, cancela := context.WithTimeout(ctx, prazoChatwoot)
	defer cancela()
	var leitor io.Reader
	if corpo != nil {
		b, _ := json.Marshal(corpo)
		leitor = bytes.NewReader(b)
	}
	req, err := http.NewRequestWithContext(ctx, metodo, c.raiz()+"/api/v1/accounts/"+c.ContaID+caminho, leitor)
	if err != nil {
		return nil, &ErroChatwoot{0, "pedido_invalido", passo}
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("api_access_token", c.Token)
	r, err := c.cliente().Do(req)
	if err != nil {
		return nil, &ErroChatwoot{0, semURL(err), passo}
	}
	defer r.Body.Close()
	b, _ := io.ReadAll(io.LimitReader(r.Body, 1<<20))
	j := decodificar(b)
	if r.StatusCode < 200 || r.StatusCode > 299 {
		return nil, &ErroChatwoot{r.StatusCode, j, passo}
	}
	return j, nil
}

func campo(v any, chaves ...string) any {
	for _, k := range chaves {
		m, _ := v.(map[string]any)
		v = m[k]
	}
	return v
}

func id64(v any) (int64, bool) {
	switch x := v.(type) {
	case json.Number:
		n, err := x.Int64()
		return n, err == nil
	case string:
		n, err := strconv.ParseInt(x, 10, 64)
		return n, err == nil
	}
	return 0, false
}

func (c *Chatwoot) customAPI(ctx context.Context, prazo time.Duration, caminho string, corpo any) (int, any, error) {
	ctx, cancela := context.WithTimeout(ctx, prazo)
	defer cancela()
	b, _ := json.Marshal(corpo)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.raiz()+"/custom_api/v1/accounts/"+c.ContaID+caminho, bytes.NewReader(b))
	if err != nil {
		return 0, nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Bot-Secret", c.BotSecret)
	r, err := c.cliente().Do(req)
	if err != nil {
		return 0, nil, err
	}
	defer r.Body.Close()
	lido, _ := io.ReadAll(io.LimitReader(r.Body, 64<<10))
	return r.StatusCode, decodificar(lido), nil
}

// ReservarAviso reserva o aviso único (custom_api, X-Bot-Secret). Devolve reservado | duplicado |
// janela | adiado; qualquer outra coisa é ErroChatwoot (passo reservar_aviso). O segredo e o telefone
// nunca entram no erro.
func (c *Chatwoot) ReservarAviso(ctx context.Context, phone, tipo, chave string, idadeS *int64) (string, error) {
	corpo := map[string]any{"phone": phone, "tipo": tipo, "chave": chave}
	if idadeS != nil && *idadeS >= 0 { // o Chatwoot só adia (adiado) enquanto idade_s < 120
		corpo["idade_s"] = *idadeS
	}
	st, j, err := c.customAPI(ctx, prazoChatwoot, "/avisos/reservar", corpo)
	if err != nil {
		return "", &ErroChatwoot{0, "rede_ou_timeout", "reservar_aviso"}
	}
	if st < 200 || st > 299 {
		return "", &ErroChatwoot{st, nil, "reservar_aviso"}
	}
	res, _ := campo(j, "resultado").(string)
	if campo(j, "ok") != true || (res != "reservado" && res != "duplicado" && res != "janela" && res != "adiado") {
		return "", &ErroChatwoot{st, "resposta_inesperada", "reservar_aviso"}
	}
	return res, nil
}

// LiberarAviso desfaz a reserva, SÓ quando a mensagem comprovadamente não foi aceita. Best-effort:
// nunca falha; devolve liberado | inexistente | "" (não deu para saber).
func (c *Chatwoot) LiberarAviso(ctx context.Context, phone, tipo, chave string) string {
	st, j, err := c.customAPI(ctx, prazoLiberar, "/avisos/liberar", map[string]any{"phone": phone, "tipo": tipo, "chave": chave})
	res, _ := campo(j, "resultado").(string)
	if err == nil && st >= 200 && st <= 299 && campo(j, "ok") == true && (res == "liberado" || res == "inexistente") {
		return res
	}
	return ""
}

var reTelefoneComoNome = regexp.MustCompile(`^[+\d\s()-]*$`)

// AcharOuCriarContato acha pelo telefone (+55…) ou cria. O nome só é escrito por cima quando o contato
// tem o TELEFONE como nome (a triagem do Chatwoot cria assim): nome real nunca é sobrescrito.
func (c *Chatwoot) AcharOuCriarContato(ctx context.Context, nome *string, telefone string) (int64, error) {
	e164 := "+" + telefone
	achados, err := c.chamar(ctx, "buscar_contato", http.MethodGet, "/contacts/search?q="+url.QueryEscape(e164), nil)
	if err != nil {
		return 0, err
	}
	lista, _ := campo(achados, "payload").([]any)
	for _, x := range lista {
		ct, _ := x.(map[string]any)
		if ct["phone_number"] != e164 {
			continue
		}
		id, _ := id64(ct["id"])
		nomeAtual, temNome := ct["name"]
		atual, _ := nomeAtual.(string) // null vira "": vazio também é "só telefone"
		if nome != nil && strings.TrimSpace(*nome) != "" && temNome && reTelefoneComoNome.MatchString(strings.TrimSpace(atual)) {
			if _, err := c.chamar(ctx, "atualizar_contato", http.MethodPut, "/contacts/"+strconv.FormatInt(id, 10),
				map[string]any{"name": strings.TrimSpace(*nome)}); err != nil && classificarErro(err) == "parar" {
				return 0, err // nome é cosmético; credencial recusada, não
			}
		}
		return id, nil
	}
	nomeNovo := e164
	if nome != nil && *nome != "" {
		nomeNovo = *nome
	}
	criado, err := c.chamar(ctx, "criar_contato", http.MethodPost, "/contacts", map[string]any{"inbox_id": c.CaixaID, "name": nomeNovo, "phone_number": e164})
	if err != nil {
		return 0, err
	}
	if id, ok := id64(campo(criado, "payload", "contact", "id")); ok {
		return id, nil
	}
	id, _ := id64(campo(criado, "id"))
	return id, nil
}

// AbrirConversa: para WhatsApp o source_id do contato na caixa é o número sem o "+".
func (c *Chatwoot) AbrirConversa(ctx context.Context, contatoID int64, telefone string) (int64, error) {
	j, err := c.chamar(ctx, "abrir_conversa", http.MethodPost, "/conversations", map[string]any{"inbox_id": c.CaixaID, "contact_id": contatoID, "source_id": telefone})
	if err != nil {
		return 0, err
	}
	id, _ := id64(campo(j, "id"))
	return id, nil
}

func (c *Chatwoot) EnviarTemplate(ctx context.Context, conversaID int64, texto string, params Template) error {
	_, err := c.chamar(ctx, "enviar_template", http.MethodPost, "/conversations/"+strconv.FormatInt(conversaID, 10)+"/messages",
		map[string]any{"content": texto, "message_type": "outgoing", "private": false, "template_params": params})
	return err
}

// Respondeu: a cliente mandou mensagem (message_type 0) nesta conversa — desde `desde`, quando dado
// (a conversa é reaproveitada: uma antiga com a loja não conta). ⚠️ "não consegui ler" NÃO é "não
// respondeu": falha na leitura, mensagem sem data ou `desde` inválido são erro (quem chama não envia).
func (c *Chatwoot) Respondeu(ctx context.Context, conversaID int64, desde *time.Time) (bool, error) {
	j, err := c.chamar(ctx, "ler_conversa", http.MethodGet, "/conversations/"+strconv.FormatInt(conversaID, 10)+"/messages", nil)
	if err != nil {
		return false, err
	}
	msgs, ok := j.([]any)
	if !ok {
		msgs, ok = campo(j, "payload").([]any)
	}
	if !ok {
		return false, &ErroChatwoot{200, "resposta_inesperada", "ler_conversa"}
	}
	var recebidas []map[string]any
	for _, x := range msgs {
		m, _ := x.(map[string]any)
		if n, ok := m["message_type"].(json.Number); ok && n.String() == "0" {
			recebidas = append(recebidas, m)
		}
	}
	if desde == nil {
		return len(recebidas) > 0, nil
	}
	limite := float64(desde.UnixMilli()) / 1000 // o Chatwoot manda created_at em segundos
	for _, m := range recebidas {
		n, ok := m["created_at"].(json.Number)
		if !ok {
			return false, &ErroChatwoot{200, "mensagem_sem_data", "ler_conversa"}
		}
		criado, err := n.Float64()
		if err != nil {
			return false, &ErroChatwoot{200, "mensagem_sem_data", "ler_conversa"}
		}
		if criado >= limite {
			return true, nil
		}
	}
	return false, nil
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `gofmt -l . && go vet ./... && go test -race -count=1 ./internal/mensagens/ -v 2>&1 | grep -E -- '^(ok|FAIL|--- FAIL|--- SKIP)'`
Expected: `gofmt` não lista nada; só linhas `ok`, nenhuma `FAIL` nem `--- SKIP`.

- [ ] **Step 5: Commit**

```bash
git add api/internal/mensagens/regras.go api/internal/mensagens/regras_test.go api/internal/mensagens/config.go api/internal/mensagens/chatwoot.go api/internal/mensagens/chatwoot_test.go
git commit -m "feat(api): regras das mensagens de abandono e cliente do Chatwoot

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Mensagens de abandono: fila, rodadas e tarefa

**Revisor:** **opus** (mensagem a cliente; nunca duplicar; prazo no meio do lote).

O robô `enviar-mensagem-abandono` (`* * * * *`, prazo de 4 min) sobre as regras da Task 9:

- `fila.go`: a interface `fila` e `filaSQL`, que chama as funções SQL de produção do abandono (`checkout_*`, `contatos_sem_mensagem`) com argumentos nomeados e cast em cada parâmetro. `TestFilaSQLChamaAsFuncoesDeProducao` roda contra esboços com a MESMA assinatura de produção.
- `rodadas.go`: as passadas `inicio`, `pedido` (com reserva do aviso no Chatwoot), `abandono` e `followup`, na ordem e com as regras de `rodada-completa.js`; config inválida não toca nada; credencial recusada para a rodada inteira; modo inválido só desliga aquela passada; `seco` só lê e `lista` filtra por `ENVIO_SO_PARA`. As gravações na fila usam `context.WithoutCancel` (o prazo não pode deixar uma linha "enviando" para sempre). Quando o prazo acaba entre itens: o item pendurado vira `falhou` (ambíguo, nunca reenviado), o resto volta à fila sem contar tentativa e a rodada termina com `limite_de_tempo`.
- A tarefa entra em `tarefas.go` com `mensagens.LerConfig(os.Getenv)`, e os segredos das mensagens entram em `ag.Segredos` em `cmd/api/worker.go`.

**Files:**
- Create: `api/internal/mensagens/fila.go`
- Test: `api/internal/mensagens/fila_test.go`
- Create: `api/internal/mensagens/rodadas.go`
- Test: `api/internal/mensagens/rodadas_test.go`
- Modify: `api/cmd/api/tarefas.go`
- Modify: `api/cmd/api/worker.go`
- Test (modify): `api/cmd/api/worker_test.go`

**Interfaces:**
- Consumes: Tudo da Task 9; `checkoutAbandono` de `mover_test.go` (Task 2); `banco.ReservarEnvio`, `worker.Tarefa` (Task 1).
- Produces:
  - `type mensagens.Mensagens struct { Pool; Cfg Config; HTTP *http.Client; Agora func() time.Time }` com `Rodar` e `Tarefa` (`enviar-mensagem-abandono`, `* * * * *`, 4 min).
  - Nos testes: `filaFalsa` (com o gancho `aoGravar`).

- [ ] **Step 1: Escrever os testes que falham**

Crie `api/internal/mensagens/fila_test.go`:

```go
package mensagens

import (
	"context"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/testebanco"
)

// Esboços das funções de produção com as MESMAS assinaturas (levantamento 02-funções.csv): anotam os
// argumentos recebidos. Provam nomes, argumentos nomeados e tipos da chamada do Go — a regra continua
// na função de verdade do banco restaurado.
const filaDeTeste = checkoutAbandono + `
create table mensagem_fila (tipo text not null, chave text not null, numero text, nome text, telefone text, url_de_recuperacao text,
  conversa_origem bigint, criado_em timestamptz not null default now(), mensagem_status text, mensagem_reservada_em timestamptz,
  mensagem_enviada_em timestamptz, mensagem_motivo text, mensagem_tentativas int not null default 0, chatwoot_conversation_id bigint,
  primary key (tipo, chave));
create table contatos_sem_mensagem (telefone text primary key, motivo text, criado_em timestamptz not null default now());
create table chamadas (id bigserial primary key, nome text, args text);
create function anotar(n text, a text) returns void language sql as $$ insert into chamadas (nome, args) values (n, a) $$;
create function pegar_para_mensagem(p_limite integer, p_atraso_min integer, p_reservar boolean default true, p_ultimos11 text[] default null, p_max_horas integer default 24)
returns setof checkout_abandono language plpgsql as $$ begin
  perform anotar('pegar_para_mensagem', format('%s %s %s %s %s', p_limite, p_atraso_min, p_reservar, coalesce(p_ultimos11::text, 'nulo'), p_max_horas));
  return query select * from checkout_abandono where status = 'fila_envio' order by token; end $$;
create function pegar_da_fila(p_tipo text, p_limite integer, p_max_horas integer, p_reservar boolean default true, p_ultimos11 text[] default null)
returns setof mensagem_fila language plpgsql as $$ begin
  perform anotar('pegar_da_fila', format('%s %s %s %s %s', p_tipo, p_limite, p_max_horas, p_reservar, coalesce(p_ultimos11::text, 'nulo')));
  return query select * from mensagem_fila where tipo = p_tipo order by chave; end $$;
create function marcar_mensagem(p_token text, p_status text, p_motivo text default null, p_conversa bigint default null) returns void
  language sql as $$ select anotar('marcar_mensagem', format('%s %s %s %s', p_token, p_status, coalesce(p_motivo, 'nulo'), coalesce(p_conversa::text, 'nulo'))) $$;
create function marcar_da_fila(p_tipo text, p_chave text, p_status text, p_motivo text default null, p_conversa bigint default null) returns void
  language sql as $$ select anotar('marcar_da_fila', format('%s %s %s %s %s', p_tipo, p_chave, p_status, coalesce(p_motivo, 'nulo'), coalesce(p_conversa::text, 'nulo'))) $$;
create function devolver_mensagem(p_token text, p_contar boolean) returns void
  language sql as $$ select anotar('devolver_mensagem', format('%s %s', p_token, p_contar)) $$;
create function devolver_da_fila(p_tipo text, p_chave text, p_contar boolean) returns void
  language sql as $$ select anotar('devolver_da_fila', format('%s %s %s', p_tipo, p_chave, p_contar)) $$;
create function liberar_mensagens_travadas() returns integer language sql as $$ select anotar('liberar_mensagens_travadas', ''); select 0 $$;
create function liberar_travadas_da_fila() returns integer language sql as $$ select anotar('liberar_travadas_da_fila', ''); select 0 $$;
create function agendar_followups(p_apos_horas integer default 48, p_teto_horas integer default 24) returns integer
  language sql as $$ select anotar('agendar_followups', format('%s %s', p_apos_horas, p_teto_horas)); select 0 $$;
create function avaliar_trava_cruzada(p_telefone text, p_horas integer default 20, p_tipo text default null, p_chave text default null) returns text
  language sql as $$ select anotar('avaliar_trava_cruzada', format('%s %s %s %s', p_telefone, p_horas, p_tipo, p_chave));
  select case p_telefone when '5511900000001' then 'barrar' when '5511900000002' then 'talvez' else 'liberar' end $$;`

func chamadasSQL(t *testing.T, p *pgxpool.Pool) []string {
	t.Helper()
	linhas, _ := p.Query(context.Background(), `select nome || ': ' || args from chamadas order by id`)
	defer linhas.Close()
	var out []string
	for linhas.Next() {
		var s string
		linhas.Scan(&s)
		out = append(out, s)
	}
	return out
}

func TestFilaSQLChamaAsFuncoesDeProducao(t *testing.T) {
	p := testebanco.Novo(t)
	ctx := context.Background()
	if _, err := p.Exec(ctx, filaDeTeste); err != nil {
		t.Fatal(err)
	}
	p.Exec(ctx, `insert into checkout_abandono (token, telefone, nome, url_de_recuperacao, status, iniciado_em) values
		('tok1', '11987654321', 'Ana', 'https://l/x', 'fila_envio', '2026-10-10T12:00:00Z'), ('tok2', null, null, null, 'comprou', now())`)
	p.Exec(ctx, `insert into mensagem_fila (tipo, chave, numero, telefone, conversa_origem, criado_em) values
		('pedido', 'p1', '#1001', '11987654321', null, '2026-10-10T12:00:00Z'), ('followup', 'f1', null, '11987654322', 55, now())`)
	p.Exec(ctx, `insert into contatos_sem_mensagem (telefone) values ('5511987654321')`)
	f := filaSQL{p}
	if err := f.liberarMensagensTravadas(ctx); err != nil {
		t.Fatal(err)
	}
	ab, err := f.pegarParaMensagem(ctx, 10, 0, true, nil, 24)
	if err != nil || len(ab) != 1 || ab[0].Token != "tok1" || *ab[0].Nome != "Ana" || !ab[0].IniciadoEm.Equal(time.Date(2026, 10, 10, 12, 0, 0, 0, time.UTC)) {
		t.Fatalf("ab=%+v err=%v", ab, err)
	}
	fl, err := f.pegarDaFila(ctx, "pedido", 5, 2, false, []string{"11987654321"})
	if err != nil || len(fl) != 1 || *fl[0].Numero != "#1001" || fl[0].ConversaOrigem != nil {
		t.Fatalf("fl=%+v err=%v", fl, err)
	}
	conv := int64(77)
	f.marcarMensagem(ctx, "tok1", "enviada", "", &conv)
	f.marcarDaFila(ctx, "pedido", "p1", "ignorada", "sem_telefone", nil)
	f.devolverMensagem(ctx, "tok1", true)
	f.devolverDaFila(ctx, "followup", "f1", false)
	f.liberarTravadasDaFila(ctx)
	f.agendarFollowups(ctx, 48, 24)
	quer := []string{
		"liberar_mensagens_travadas: ", "pegar_para_mensagem: 10 0 t nulo 24", "pegar_da_fila: pedido 5 2 f {11987654321}",
		"marcar_mensagem: tok1 enviada nulo 77", "marcar_da_fila: pedido p1 ignorada sem_telefone nulo",
		"devolver_mensagem: tok1 t", "devolver_da_fila: followup f1 f", "liberar_travadas_da_fila: ", "agendar_followups: 48 24",
	}
	if got := chamadasSQL(t, p); !slices.Equal(got, quer) {
		t.Fatalf("chamadas =\n%s", strings.Join(got, "\n"))
	}
	if b, err := f.bloqueados(ctx, []string{"5511987654321", "5511900000009"}); err != nil || !b["5511987654321"] || b["5511900000009"] {
		t.Fatalf("bloqueados=%v err=%v", b, err)
	}
	if st, _ := f.statusDoCheckout(ctx, "tok2"); st != "comprou" {
		t.Fatalf("status=%q", st)
	}
	if st, err := f.statusDoCheckout(ctx, "nao-existe"); st != "" || err != nil {
		t.Fatalf("sem linha = vazio, não erro: %q %v", st, err)
	}
	for tel, quer := range map[string]string{"5511900000001": "barrar", "5511900000002": "erro", "5511900000003": "liberar"} {
		if got := f.travaCruzada(ctx, tel, "abandono", "tok1"); got != quer {
			t.Errorf("trava %s = %s", tel, got)
		}
	}
	p.Exec(ctx, `drop function avaliar_trava_cruzada(text, integer, text, text)`)
	if got := f.travaCruzada(ctx, "5511900000003", "", ""); got != "erro" {
		t.Fatalf("falha ao consultar a trava não libera: %s", got)
	}
}

// Ponta a ponta pelo banco: o robô com a filaSQL, o Chatwoot de mentira e os esboços.
func TestMensagensPeloBanco(t *testing.T) {
	p := testebanco.Novo(t)
	ctx := context.Background()
	if _, err := p.Exec(ctx, filaDeTeste); err != nil {
		t.Fatal(err)
	}
	p.Exec(ctx, `insert into checkout_abandono (token, telefone, nome, url_de_recuperacao, status, iniciado_em) values
		('tok1', '11987654321', 'MARIA', 'https://loja.com/checkouts/abc?key=1', 'fila_envio', now() - interval '1 hour')`)
	cw, _ := novoChatwoot(t, nil)
	cfg := configLigada(cw)
	desligar(&cfg, "abandono")
	m := &Mensagens{Pool: p, Cfg: cfg, Agora: func() time.Time { return agoraDentro }}
	if err := m.Rodar(ctx); err != nil {
		t.Fatal(err)
	}
	got := chamadasSQL(t, p)
	if !slices.Contains(got, "marcar_mensagem: tok1 enviada nulo 77") || !slices.Contains(got, "avaliar_trava_cruzada: 5511987654321 20 abandono tok1") {
		t.Fatalf("chamadas =\n%s", strings.Join(got, "\n"))
	}
}
```

Crie `api/internal/mensagens/rodadas_test.go`:

```go
package mensagens

import (
	"context"
	"fmt"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"
)

// filaFalsa é o banco de mentira das rodadas (como o `sb` falso dos testes da edge): guarda as linhas
// e anota cada chamada.
type filaFalsa struct {
	mu                     sync.Mutex
	abandono               []LinhaAbandono
	porTipo                map[string][]LinhaFila
	chamadas               []string
	status                 map[string]string // status do checkout por token; ausente = fila_envio
	trava                  string            // resposta da trava cruzada; "" = liberar
	bloq                   map[string]bool
	erroPegar, erroBloq    error
	erroStatus, erroGravar error  // erroGravar: só o marcar 'enviada'
	aoGravar               func() // chamado depois de marcar 'enviada'
	reservas               []bool
	ultimos                [][]string
}

func (f *filaFalsa) anotar(s string, a ...any) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.chamadas = append(f.chamadas, fmt.Sprintf(s, a...))
}

func (f *filaFalsa) tem(prefixo string) int {
	f.mu.Lock()
	defer f.mu.Unlock()
	n := 0
	for _, c := range f.chamadas {
		if strings.HasPrefix(c, prefixo) {
			n++
		}
	}
	return n
}

func (f *filaFalsa) liberarMensagensTravadas(context.Context) error {
	f.anotar("liberar_mensagens")
	return nil
}
func (f *filaFalsa) liberarTravadasDaFila(context.Context) error {
	f.anotar("liberar_fila")
	return nil
}
func (f *filaFalsa) pegarParaMensagem(_ context.Context, limite, atraso int, reservar bool, u11 []string, maxHoras int) ([]LinhaAbandono, error) {
	f.anotar("pegar abandono limite=%d atraso=%d max=%d", limite, atraso, maxHoras)
	f.reservas, f.ultimos = append(f.reservas, reservar), append(f.ultimos, u11)
	return f.abandono, f.erroPegar
}
func (f *filaFalsa) pegarDaFila(_ context.Context, tipo string, limite, maxHoras int, reservar bool, u11 []string) ([]LinhaFila, error) {
	f.anotar("pegar %s limite=%d max=%d", tipo, limite, maxHoras)
	f.reservas, f.ultimos = append(f.reservas, reservar), append(f.ultimos, u11)
	return f.porTipo[tipo], f.erroPegar
}
func (f *filaFalsa) marcarMensagem(_ context.Context, token, status, motivo string, conversa *int64) error {
	return f.marcar("abandono", token, status, motivo, conversa)
}
func (f *filaFalsa) marcarDaFila(_ context.Context, tipo, chave, status, motivo string, conversa *int64) error {
	return f.marcar(tipo, chave, status, motivo, conversa)
}
func (f *filaFalsa) marcar(tipo, chave, status, motivo string, conversa *int64) error {
	c := ""
	if conversa != nil {
		c = fmt.Sprintf(" conversa=%d", *conversa)
	}
	f.anotar("marcar %s %s %s %s%s", tipo, chave, status, motivo, c)
	if status == "enviada" {
		if f.aoGravar != nil {
			f.aoGravar()
		}
		return f.erroGravar
	}
	return nil
}
func (f *filaFalsa) devolverMensagem(_ context.Context, token string, contar bool) error {
	f.anotar("devolver abandono %s contar=%v", token, contar)
	return nil
}
func (f *filaFalsa) devolverDaFila(_ context.Context, tipo, chave string, contar bool) error {
	f.anotar("devolver %s %s contar=%v", tipo, chave, contar)
	return nil
}
func (f *filaFalsa) agendarFollowups(_ context.Context, apos, teto int) error {
	f.anotar("agendar_followups %d %d", apos, teto)
	return nil
}
func (f *filaFalsa) bloqueados(_ context.Context, ts []string) (map[string]bool, error) {
	f.anotar("bloqueados %s", strings.Join(ts, ","))
	return f.bloq, f.erroBloq
}
func (f *filaFalsa) statusDoCheckout(_ context.Context, token string) (string, error) {
	f.anotar("status %s", token)
	if st, ok := f.status[token]; ok {
		return st, f.erroStatus
	}
	return "fila_envio", f.erroStatus
}
func (f *filaFalsa) travaCruzada(_ context.Context, tel, tipo, chave string) string {
	f.anotar("trava %s %s %s", tel, tipo, chave)
	if f.trava == "" {
		return "liberar"
	}
	return f.trava
}

// agoraDentro: sábado 12:00 em São Paulo (dentro da janela 08-21).
var agoraDentro = time.Date(2026, 10, 10, 15, 0, 0, 0, time.UTC)

const baseLink = "https://loja.com/checkouts/"

func configLigada(cw *Chatwoot) Config {
	chat := ChatwootConfig{URL: cw.URL, ContaID: cw.ContaID, CaixaID: "9", Token: cw.Token, BotSecret: cw.BotSecret}
	p := func(template, texto string, maxHoras float64) Passada {
		return Passada{Modo: "ligado", Limite: 10, MaxHoras: maxHoras, LinkBase: baseLink, Idioma: "pt_BR",
			TemplateNome: template, TemplateTexto: texto, TravaCruzada: true}
	}
	return Config{Chatwoot: chat, Inicio: p("inicio_v1", "Oi {{1}}, reservamos!", 1), Pedido: p("pedido_v1", "{{1}}, pedido {{2}} recebido", 2),
		Abandono: p("abandono_v2", "Oi {{1}}, seu carrinho {{1}}", 24), Followup: p("followup_v1", "{{1}}, ainda dá tempo", 24), FollowupAposHoras: 48}
}

func desligar(c *Config, menos ...string) {
	for nome, p := range map[string]*Passada{"inicio": &c.Inicio, "pedido": &c.Pedido, "abandono": &c.Abandono, "followup": &c.Followup} {
		if !slices.Contains(menos, nome) {
			p.Modo = "desligado"
		}
	}
}

func linhaAbandono(token string) LinhaAbandono {
	return LinhaAbandono{Token: token, Telefone: s("(11) 98765-4321"), Nome: s("MARIA SILVA"), URL: s(baseLink + "abc?key=1"),
		Status: "fila_envio", IniciadoEm: agoraDentro.Add(-time.Hour)}
}

func robo(t *testing.T, f *filaFalsa, resp func(string, string, map[string]any) (int, string), passadas ...string) (*Mensagens, *chatwootFalso) {
	t.Helper()
	cw, falso := novoChatwoot(t, resp)
	cfg := configLigada(cw)
	desligar(&cfg, passadas...)
	return &Mensagens{Cfg: cfg, Agora: func() time.Time { return agoraDentro }, fila: f}, falso
}

func TestAbandonoCaminhoFeliz(t *testing.T) {
	f := &filaFalsa{abandono: []LinhaAbandono{linhaAbandono("tok-aaaaaaaaaa")}}
	m, cw := robo(t, f, nil, "abandono")
	if err := m.Rodar(context.Background()); err != nil {
		t.Fatal(err)
	}
	quer := []string{"liberar_mensagens", "pegar abandono limite=10 atraso=0 max=24", "bloqueados 5511987654321",
		"trava 5511987654321 abandono tok-aaaaaaaaaa", "status tok-aaaaaaaaaa", "marcar abandono tok-aaaaaaaaaa enviada  conversa=77"}
	if !slices.Equal(f.chamadas, quer) || !f.reservas[0] || f.ultimos[0] != nil {
		t.Fatalf("chamadas =\n%s", strings.Join(f.chamadas, "\n"))
	}
	pedidos, _ := cw.lista()
	envio := pedidos[len(pedidos)-1]
	if !strings.Contains(envio, `"content":"Oi Maria, seu carrinho {{1}}"`) ||
		!strings.Contains(envio, `"template_params":{"name":"abandono_v2","category":"MARKETING","language":"pt_BR","processed_params":{"body":{"1":"Maria"},"buttons":[{"type":"url","parameter":"abc?key=1"}]}}`) {
		t.Fatalf("envio = %s", envio)
	}
	if cw.chamadas("PUT /api/v1/accounts/3/contacts/51") != 1 || !strings.Contains(pedidos[1], `"name":"Maria Silva"`) {
		t.Fatalf("contato com o telefone como nome ganha o nome formatado: %q", pedidos)
	}
}

func TestAbandonoNaoEnviaQuemRespondeuOuSaiuDaFila(t *testing.T) {
	f := &filaFalsa{abandono: []LinhaAbandono{linhaAbandono("respondeu"), linhaAbandono("comprou")}, status: map[string]string{"comprou": "pagamento_pendente"}}
	inicio := float64(agoraDentro.Add(-time.Hour).Unix())
	m, cw := robo(t, f, func(met, cam string, _ map[string]any) (int, string) {
		if met == "GET" && strings.HasSuffix(cam, "/messages") {
			return 200, fmt.Sprintf(`{"payload":[{"message_type":0,"created_at":%d}]}`, int64(inicio)+60)
		}
		return 0, ""
	}, "abandono")
	m.Rodar(context.Background())
	if f.tem("marcar abandono respondeu ignorada respondeu") != 1 || f.tem("marcar abandono comprou ignorada nao_esta_mais_na_fila") != 1 {
		t.Fatalf("%s", strings.Join(f.chamadas, "\n"))
	}
	if cw.chamadas("POST /api/v1/accounts/3/conversations/77/messages") != 0 {
		t.Fatal("nada podia ser enviado")
	}
}

func TestAbandonoFalhasNuncaDuplicam(t *testing.T) {
	casos := []struct {
		nome    string
		resp    func(string, string, map[string]any) (int, string)
		gravar  error
		esperar string
	}{
		{"template recusado (422)", func(m, c string, _ map[string]any) (int, string) {
			if m == "POST" && strings.HasSuffix(c, "/messages") {
				return 422, `{"error":"Template não aprovado"}`
			}
			return 0, ""
		}, nil, `marcar abandono t1 falhou enviar_template:422 {"error":"Template não aprovado"}`},
		{"rede NO envio: pode ter saído", func(m, c string, _ map[string]any) (int, string) {
			if m == "POST" && strings.HasSuffix(c, "/messages") {
				return -1, ""
			}
			return 0, ""
		}, nil, "marcar abandono t1 falhou enviar_template:0 "},
		{"rede ANTES do envio", func(m, c string, _ map[string]any) (int, string) {
			if strings.HasSuffix(c, "/conversations") {
				return -1, ""
			}
			return 0, ""
		}, nil, "devolver abandono t1 contar=true"},
		{"gravar 'enviada' falha", nil, fmt.Errorf("banco fora"), "marcar abandono t1 enviada  conversa=77"},
	}
	for _, c := range casos {
		f := &filaFalsa{abandono: []LinhaAbandono{linhaAbandono("t1")}, erroGravar: c.gravar}
		m, _ := robo(t, f, c.resp, "abandono")
		m.Rodar(context.Background())
		if f.tem(c.esperar) != 1 {
			t.Errorf("%s:\n%s", c.nome, strings.Join(f.chamadas, "\n"))
		}
		if c.nome != "rede ANTES do envio" && f.tem("devolver") != 0 {
			t.Errorf("%s: devolver reenviaria: %v", c.nome, f.chamadas)
		}
	}
}

func TestCredencialRecusadaParaARodada(t *testing.T) {
	f := &filaFalsa{abandono: []LinhaAbandono{linhaAbandono("t1"), linhaAbandono("t2")}}
	m, _ := robo(t, f, func(_, c string, _ map[string]any) (int, string) {
		if strings.Contains(c, "search") {
			return 401, `{"error":"Invalid token"}`
		}
		return 0, ""
	}, "abandono")
	err := m.Rodar(context.Background())
	if err == nil || err.Error() != "abandono: credencial_recusada" {
		t.Fatalf("err=%v", err)
	}
	if f.tem("devolver abandono t1 contar=false") != 1 || f.tem("devolver abandono t2 contar=false") != 1 || f.tem("marcar") != 0 {
		t.Fatalf("%s", strings.Join(f.chamadas, "\n"))
	}
	if strings.Contains(err.Error(), tokenChatwoot) {
		t.Fatal("token no erro")
	}
}

func TestBloqueadosIlegiveisAbortamEConfigInvalidaNaoTocaNada(t *testing.T) {
	f := &filaFalsa{abandono: []LinhaAbandono{linhaAbandono("t1")}, erroBloq: fmt.Errorf("timeout")}
	m, cw := robo(t, f, nil, "abandono")
	if err := m.Rodar(context.Background()); err == nil || err.Error() != "abandono: falha_bloqueados" {
		t.Fatalf("err=%v", err)
	}
	if f.tem("devolver abandono t1 contar=false") != 1 || cw.chamadas("") != 0 {
		t.Fatalf("%v / chatwoot=%d", f.chamadas, cw.chamadas(""))
	}
	f2 := &filaFalsa{abandono: []LinhaAbandono{linhaAbandono("t1")}}
	m2, _ := robo(t, f2, nil, "abandono")
	m2.Cfg.Chatwoot.Token = ""
	if err := m2.Rodar(context.Background()); err == nil || err.Error() != "abandono: config_invalida" || len(f2.chamadas) != 0 {
		t.Fatalf("config inválida: err=%v chamadas=%v", err, f2.chamadas)
	}
}

func TestSecoSoLeEListaFiltra(t *testing.T) {
	f := &filaFalsa{abandono: []LinhaAbandono{linhaAbandono("t1")}}
	m, cw := robo(t, f, nil, "abandono")
	m.Cfg.Abandono.Modo = "seco"
	if err := m.Rodar(context.Background()); err != nil {
		t.Fatal(err)
	}
	if f.reservas[0] || f.tem("marcar") != 0 || f.tem("devolver") != 0 || f.tem("liberar") != 0 || cw.chamadas("") != 0 {
		t.Fatalf("seco: %v chatwoot=%d", f.chamadas, cw.chamadas(""))
	}
	f2 := &filaFalsa{}
	m2, _ := robo(t, f2, nil, "abandono")
	m2.Cfg.Abandono.Modo, m2.Cfg.Abandono.SoPara = "lista", []string{"5511987654321", "21999990000"}
	m2.Rodar(context.Background())
	if !slices.Equal(f2.ultimos[0], []string{"11987654321", "21999990000"}) || !f2.reservas[0] {
		t.Fatalf("lista: %v", f2.ultimos)
	}
}

func TestPedidoComReservaDoAviso(t *testing.T) {
	linha := LinhaFila{Chave: "pedido-123456789", Numero: s("#1001"), Nome: s("maria"), Telefone: s("11987654321"), CriadoEm: agoraDentro.Add(-30 * time.Second)}
	reservaCom := func(st int, corpo string, envio int) func(string, string, map[string]any) (int, string) {
		return func(m, c string, _ map[string]any) (int, string) {
			if strings.HasSuffix(c, "/avisos/reservar") {
				return st, corpo
			}
			if envio != 0 && m == "POST" && strings.HasSuffix(c, "/messages") {
				return envio, `{"error":"x"}`
			}
			return 0, ""
		}
	}
	casos := []struct {
		nome                   string
		resp                   func(string, string, map[string]any) (int, string)
		querFila               []string
		enviou, liberou, adiou bool
	}{
		{"reservado envia", reservaCom(200, `{"ok":true,"resultado":"reservado"}`, 0), []string{"marcar pedido pedido-123456789 enviada  conversa=77"}, true, false, false},
		{"adiado devolve sem contar", reservaCom(200, `{"ok":true,"resultado":"adiado"}`, 0), []string{"devolver pedido pedido-123456789 contar=false"}, false, false, true},
		{"duplicado ignora", reservaCom(200, `{"ok":true,"resultado":"duplicado"}`, 0), []string{"marcar pedido pedido-123456789 ignorada aviso_chatwoot_duplicado"}, false, false, false},
		{"5xx na reserva libera e espera", reservaCom(503, `{}`, 0), []string{"devolver pedido pedido-123456789 contar=false"}, false, true, false},
		{"envio ambíguo NÃO libera nem devolve", reservaCom(200, `{"ok":true,"resultado":"reservado"}`, -1),
			[]string{"marcar pedido pedido-123456789 falhou envio_incerto_conferir_no_chatwoot: enviar_template:0 "}, false, false, false},
		{"4xx no envio libera e marca falhou", reservaCom(200, `{"ok":true,"resultado":"reservado"}`, 422), []string{`marcar pedido pedido-123456789 falhou enviar_template:422 {"error":"x"}`}, false, true, false},
	}
	for _, c := range casos {
		f := &filaFalsa{porTipo: map[string][]LinhaFila{"pedido": {linha}}}
		m, cw := robo(t, f, c.resp, "pedido")
		m.Cfg.Pedido.ReservarAviso = true
		m.Rodar(context.Background())
		for _, q := range c.querFila {
			if f.tem(q) != 1 {
				t.Errorf("%s: falta %q em\n%s", c.nome, q, strings.Join(f.chamadas, "\n"))
			}
		}
		enviou := cw.chamadas("POST /api/v1/accounts/3/conversations/77/messages") == 1 && f.tem("marcar pedido pedido-123456789 enviada") == 1
		if enviou != c.enviou || (cw.chamadas("POST /custom_api/v1/accounts/3/avisos/liberar") == 1) != c.liberou {
			t.Errorf("%s: enviou=%v liberou=%d", c.nome, enviou, cw.chamadas("POST /custom_api/v1/accounts/3/avisos/liberar"))
		}
		if f.tem("trava") != 0 || f.tem("bloqueados") != 0 {
			t.Errorf("%s: o pedido é transacional (sem trava cruzada nem bloqueados)", c.nome)
		}
		if c.nome == "reservado envia" {
			pedidos, _ := cw.lista()
			res, envio := pedidos[0], pedidos[len(pedidos)-1]
			if !strings.Contains(res, `"chave":"1001"`) || !strings.Contains(res, `"idade_s":30`) || !strings.Contains(res, `"tipo":"pedido_recebido"`) ||
				!strings.Contains(envio, `"content":"Maria, pedido #1001 recebido"`) ||
				!strings.Contains(envio, `"processed_params":{"body":{"1":"Maria","2":"#1001"}}`) || strings.Contains(envio, "buttons") {
				t.Errorf("reserva=%s\nenvio=%s", res, envio)
			}
		}
	}
	// Reserva com 401: para a rodada e devolve o que sobrou, sem vazar o segredo do bot.
	f := &filaFalsa{porTipo: map[string][]LinhaFila{"pedido": {linha, {Chave: "outro", Telefone: s("11912345678"), CriadoEm: agoraDentro}}}}
	m, _ := robo(t, f, reservaCom(401, `{}`, 0), "pedido")
	m.Cfg.Pedido.ReservarAviso = true
	err := m.Rodar(context.Background())
	if err == nil || err.Error() != "pedido: reserva_recusada" || f.tem("devolver pedido outro contar=false") != 1 || strings.Contains(err.Error(), segredoDoBot) {
		t.Fatalf("err=%v\n%s", err, strings.Join(f.chamadas, "\n"))
	}
	m.Cfg.Chatwoot.BotSecret = ""
	if err := m.Rodar(context.Background()); err == nil || err.Error() != "pedido: config_invalida" {
		t.Fatalf("reserva ligada sem o segredo falha fechada: %v", err)
	}
}

func TestFollowup(t *testing.T) {
	conv := int64(55)
	linhas := []LinhaFila{
		{Chave: "sem-conversa", Telefone: s("11987654321"), URL: s(baseLink + "a")},
		{Chave: "comprou", Telefone: s("11987654322"), URL: s(baseLink + "b"), ConversaOrigem: &conv},
		{Chave: "feliz", Nome: s("ana"), Telefone: s("11987654323"), URL: s(baseLink + "c"), ConversaOrigem: &conv},
	}
	f := &filaFalsa{porTipo: map[string][]LinhaFila{"followup": linhas}, status: map[string]string{"comprou": "comprou"}}
	m, cw := robo(t, f, nil, "followup")
	if err := m.Rodar(context.Background()); err != nil {
		t.Fatal(err)
	}
	for _, q := range []string{"agendar_followups 48 24", "marcar followup sem-conversa ignorada sem_conversa_de_origem",
		"marcar followup comprou ignorada nao_esta_mais_na_fila", "marcar followup feliz enviada  conversa=77"} {
		if f.tem(q) != 1 {
			t.Errorf("falta %q em\n%s", q, strings.Join(f.chamadas, "\n"))
		}
	}
	if cw.chamadas("GET /api/v1/accounts/3/conversations/55/messages") != 1 {
		t.Fatal("o follow-up pergunta se a cliente respondeu na conversa de origem")
	}
	f2 := &filaFalsa{}
	m2, _ := robo(t, f2, nil, "followup")
	m2.Cfg.Followup.Modo = "seco"
	m2.Rodar(context.Background())
	if f2.tem("agendar_followups") != 0 {
		t.Fatal("o seco não agenda")
	}
}

func TestInicioETravaCruzada(t *testing.T) {
	linhas := []LinhaFila{{Chave: "sem-link", Telefone: s("11987654321")}, {Chave: "barrado", Telefone: s("11987654322"), URL: s(baseLink + "x")}}
	f := &filaFalsa{porTipo: map[string][]LinhaFila{"inicio": linhas}, trava: "barrar"}
	m, cw := robo(t, f, nil, "inicio")
	m.Rodar(context.Background())
	if f.tem("devolver inicio sem-link contar=false") != 1 || f.tem("marcar inicio barrado ignorada ignorada_trava_cruzada") != 1 || cw.chamadas("") != 0 {
		t.Fatalf("%s", strings.Join(f.chamadas, "\n"))
	}
	for trava, quer := range map[string]string{"esperar": "devolver inicio barrado contar=false", "erro": "devolver inicio barrado contar=true"} {
		f := &filaFalsa{porTipo: map[string][]LinhaFila{"inicio": linhas[1:]}, trava: trava}
		m, _ := robo(t, f, nil, "inicio")
		m.Rodar(context.Background())
		if f.tem(quer) != 1 {
			t.Errorf("trava %s: %v", trava, f.chamadas)
		}
	}
}

func TestModoInvalidoSoNaquelaPassada(t *testing.T) {
	f := &filaFalsa{porTipo: map[string][]LinhaFila{"pedido": {{Chave: "p1", Numero: s("1"), Telefone: s("11987654321"), CriadoEm: agoraDentro}}}}
	m, _ := robo(t, f, nil, "pedido", "abandono")
	m.Cfg.Abandono.Modo = "talvez"
	err := m.Rodar(context.Background())
	if err == nil || err.Error() != "abandono: modo_invalido" || f.tem("marcar pedido p1 enviada") != 1 {
		t.Fatalf("err=%v chamadas=%v", err, f.chamadas)
	}
}

// O prazo da tarefa acaba no meio: a linha em envio termina (gravada mesmo com o contexto cancelado) e
// as seguintes voltam à fila SEM gastar tentativa; um envio pendurado até o prazo vira 'falhou' (nunca
// é reenviado).
func TestPrazoAcabaNoMeio(t *testing.T) {
	ctx, cancela := context.WithCancel(context.Background())
	defer cancela()
	f := &filaFalsa{abandono: []LinhaAbandono{linhaAbandono("t1"), linhaAbandono("t2")}, aoGravar: cancela} // o prazo vence logo depois da 1ª
	m, _ := robo(t, f, nil, "abandono")
	err := m.Rodar(ctx)
	if err == nil || err.Error() != "abandono: limite_de_tempo" {
		t.Fatalf("err=%v", err)
	}
	if f.tem("marcar abandono t1 enviada  conversa=77") != 1 || f.tem("devolver abandono t2 contar=false") != 1 {
		t.Fatalf("%s", strings.Join(f.chamadas, "\n"))
	}
	ctx2, cancela2 := context.WithTimeout(context.Background(), 300*time.Millisecond)
	defer cancela2()
	f2 := &filaFalsa{abandono: []LinhaAbandono{linhaAbandono("t1"), linhaAbandono("t2")}}
	m2, _ := robo(t, f2, func(met, c string, _ map[string]any) (int, string) {
		if met == "POST" && strings.HasSuffix(c, "/messages") {
			time.Sleep(500 * time.Millisecond) // pendura até o prazo
		}
		return 0, ""
	}, "abandono")
	m2.Rodar(ctx2)
	if f2.tem("marcar abandono t1 falhou enviar_template:0") != 1 || f2.tem("devolver abandono t1") != 0 || f2.tem("devolver abandono t2 contar=false") != 1 {
		t.Fatalf("%s", strings.Join(f2.chamadas, "\n"))
	}
}

func TestTarefaDasMensagens(t *testing.T) {
	tf := (&Mensagens{}).Tarefa()
	if tf.Nome != "enviar-mensagem-abandono" || tf.Agenda != "* * * * *" || tf.Limite <= time.Minute {
		t.Fatalf("%+v", tf)
	}
}
```

Em `api/cmd/api/worker_test.go`, troque:

```go

}

func TestTarefasDeProducao
```

por:

```go

	// Task 10
	"enviar-mensagem-abandono": "* * * * *",
}

func TestTarefasDeProducao
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `go test -count=1 ./cmd/api ./internal/mensagens`
Expected: FAIL. Primeiras falhas, como saíram no ensaio deste plano: `--- FAIL: TestTarefasDeProducao`, `undefined: Mensagens`, `undefined: filaSQL`

- [ ] **Step 3: Implementar**

Crie `api/internal/mensagens/fila.go`:

```go
package mensagens

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// fila é o que as rodadas pedem ao banco. A implementação de verdade (filaSQL) chama as MESMAS funções
// SQL que a edge chamava por RPC (pegar_para_mensagem, pegar_da_fila, marcar_*, devolver_*,
// liberar_*, agendar_followups, avaliar_trava_cruzada): a reserva com FOR UPDATE SKIP LOCKED e os
// estados (enviando/enviada/falhou/ignorada) continuam no banco. Os testes das rodadas usam uma fila
// de mentira em memória; filaSQL é testada contra funções com as assinaturas de produção.
type fila interface {
	liberarMensagensTravadas(ctx context.Context) error
	pegarParaMensagem(ctx context.Context, limite, atrasoMin int, reservar bool, ultimos11 []string, maxHoras int) ([]LinhaAbandono, error)
	marcarMensagem(ctx context.Context, token, status, motivo string, conversa *int64) error
	devolverMensagem(ctx context.Context, token string, contar bool) error
	liberarTravadasDaFila(ctx context.Context) error
	pegarDaFila(ctx context.Context, tipo string, limite, maxHoras int, reservar bool, ultimos11 []string) ([]LinhaFila, error)
	marcarDaFila(ctx context.Context, tipo, chave, status, motivo string, conversa *int64) error
	devolverDaFila(ctx context.Context, tipo, chave string, contar bool) error
	agendarFollowups(ctx context.Context, aposHoras, tetoHoras int) error
	bloqueados(ctx context.Context, telefones []string) (map[string]bool, error)
	statusDoCheckout(ctx context.Context, token string) (string, error)    // "" = não achou
	travaCruzada(ctx context.Context, telefone, tipo, chave string) string // barrar | esperar | liberar | erro
}

type filaSQL struct{ p *pgxpool.Pool }

func nulo(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

func (f filaSQL) liberarMensagensTravadas(ctx context.Context) error {
	_, err := f.p.Exec(ctx, `select liberar_mensagens_travadas()`)
	return err
}

func (f filaSQL) pegarParaMensagem(ctx context.Context, limite, atrasoMin int, reservar bool, ultimos11 []string, maxHoras int) ([]LinhaAbandono, error) {
	linhas, err := f.p.Query(ctx, `select token, telefone, nome, url_de_recuperacao, status, iniciado_em
		from pegar_para_mensagem(p_limite => $1::int, p_atraso_min => $2::int, p_reservar => $3::boolean, p_ultimos11 => $4::text[], p_max_horas => $5::int)`,
		limite, atrasoMin, reservar, ultimos11, maxHoras)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(linhas, func(r pgx.CollectableRow) (l LinhaAbandono, err error) {
		return l, r.Scan(&l.Token, &l.Telefone, &l.Nome, &l.URL, &l.Status, &l.IniciadoEm)
	})
}

func (f filaSQL) marcarMensagem(ctx context.Context, token, status, motivo string, conversa *int64) error {
	_, err := f.p.Exec(ctx, `select marcar_mensagem(p_token => $1::text, p_status => $2::text, p_motivo => $3::text, p_conversa => $4::bigint)`,
		token, status, nulo(motivo), conversa)
	return err
}

func (f filaSQL) devolverMensagem(ctx context.Context, token string, contar bool) error {
	_, err := f.p.Exec(ctx, `select devolver_mensagem(p_token => $1::text, p_contar => $2::boolean)`, token, contar)
	return err
}

func (f filaSQL) liberarTravadasDaFila(ctx context.Context) error {
	_, err := f.p.Exec(ctx, `select liberar_travadas_da_fila()`)
	return err
}

func (f filaSQL) pegarDaFila(ctx context.Context, tipo string, limite, maxHoras int, reservar bool, ultimos11 []string) ([]LinhaFila, error) {
	linhas, err := f.p.Query(ctx, `select chave, numero, nome, telefone, url_de_recuperacao, conversa_origem, criado_em
		from pegar_da_fila(p_tipo => $1::text, p_limite => $2::int, p_max_horas => $3::int, p_reservar => $4::boolean, p_ultimos11 => $5::text[])`,
		tipo, limite, maxHoras, reservar, ultimos11)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(linhas, func(r pgx.CollectableRow) (l LinhaFila, err error) {
		return l, r.Scan(&l.Chave, &l.Numero, &l.Nome, &l.Telefone, &l.URL, &l.ConversaOrigem, &l.CriadoEm)
	})
}

func (f filaSQL) marcarDaFila(ctx context.Context, tipo, chave, status, motivo string, conversa *int64) error {
	_, err := f.p.Exec(ctx, `select marcar_da_fila(p_tipo => $1::text, p_chave => $2::text, p_status => $3::text, p_motivo => $4::text, p_conversa => $5::bigint)`,
		tipo, chave, status, nulo(motivo), conversa)
	return err
}

func (f filaSQL) devolverDaFila(ctx context.Context, tipo, chave string, contar bool) error {
	_, err := f.p.Exec(ctx, `select devolver_da_fila(p_tipo => $1::text, p_chave => $2::text, p_contar => $3::boolean)`, tipo, chave, contar)
	return err
}

func (f filaSQL) agendarFollowups(ctx context.Context, aposHoras, tetoHoras int) error {
	_, err := f.p.Exec(ctx, `select agendar_followups(p_apos_horas => $1::int, p_teto_horas => $2::int)`, aposHoras, tetoHoras)
	return err
}

func (f filaSQL) bloqueados(ctx context.Context, telefones []string) (map[string]bool, error) {
	linhas, err := f.p.Query(ctx, `select telefone from contatos_sem_mensagem where telefone = any($1::text[])`, telefones)
	if err != nil {
		return nil, err
	}
	ts, err := pgx.CollectRows(linhas, pgx.RowTo[string])
	if err != nil {
		return nil, err
	}
	m := map[string]bool{}
	for _, t := range ts {
		m[t] = true
	}
	return m, nil
}

func (f filaSQL) statusDoCheckout(ctx context.Context, token string) (string, error) {
	var st string
	err := f.p.QueryRow(ctx, `select status from checkout_abandono where token = $1::text`, token).Scan(&st)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", nil
	}
	return st, err
}

// travaCruzada (trava-cruzada.js): falha ou resposta desconhecida = 'erro' ("não sei" não libera).
func (f filaSQL) travaCruzada(ctx context.Context, telefone, tipo, chave string) string {
	var r *string
	if err := f.p.QueryRow(ctx, `select avaliar_trava_cruzada(p_telefone => $1::text, p_horas => $2::int, p_tipo => $3::text, p_chave => $4::text)`,
		telefone, horasDaTrava, nulo(tipo), nulo(chave)).Scan(&r); err != nil || r == nil {
		return "erro"
	}
	switch *r {
	case "barrar", "esperar", "liberar":
		return *r
	}
	return "erro"
}
```

Crie `api/internal/mensagens/rodadas.go`:

```go
package mensagens

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"slices"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/texto"
	"github.com/rbv-co/social-dashboard/api/internal/worker"
)

// Porta de _shared/rodada-de-mensagens.js (abandono), rodada-da-fila.js (inicio, pedido, follow-up)
// e rodada-completa.js (as 4 passadas, cada uma com o seu MODO). ⚠️ NASCE TUDO DESLIGADO.

// resultado de uma passada: o status da edge (200 ok; 500 configuração/fila/bloqueados/prazo; 502
// credencial recusada) e o corpo (vai para o log, sem telefone nem segredo).
type resultado struct {
	status int
	corpo  map[string]any
}

// Mensagens é o robô enviar-mensagem-abandono (pg_cron 1/min).
type Mensagens struct {
	Pool  *pgxpool.Pool
	Cfg   Config
	HTTP  *http.Client     // para o Chatwoot; nil = http.DefaultClient
	Agora func() time.Time // nil = time.Now
	fila  fila             // nil = filaSQL{Pool} (o teste troca)
}

// Tarefa: 1/min. O prazo (4 min) passa do minuto de propósito: a execução seguinte é pulada pela trava,
// e uma rodada com Chatwoot lento termina as linhas que começou em vez de cortá-las no meio.
func (m *Mensagens) Tarefa() worker.Tarefa {
	return worker.Tarefa{Nome: "enviar-mensagem-abandono", Agenda: "* * * * *", Limite: 4 * time.Minute, Executar: m.Rodar}
}

var modos = []string{"desligado", "seco", "lista", "ligado"}

func (m *Mensagens) Rodar(ctx context.Context) error {
	agora := time.Now()
	if m.Agora != nil {
		agora = m.Agora()
	}
	f := m.fila
	if f == nil {
		f = filaSQL{m.Pool}
	}
	c := m.Cfg
	chat := &Chatwoot{URL: c.Chatwoot.URL, ContaID: c.Chatwoot.ContaID, CaixaID: int64(numeroJS(c.Chatwoot.CaixaID, 0)),
		Token: c.Chatwoot.Token, BotSecret: c.Chatwoot.BotSecret, HTTP: m.HTTP}
	passadas := []struct {
		nome  string
		p     Passada
		rodar func(cli *Chatwoot) resultado
	}{
		{"inicio", c.Inicio, func(cli *Chatwoot) resultado {
			return processarFila(ctx, f, cli, c.Inicio, c.Chatwoot, "inicio", agora)
		}},
		{"pedido", c.Pedido, func(cli *Chatwoot) resultado {
			return processarFila(ctx, f, cli, c.Pedido, c.Chatwoot, "pedido", agora)
		}},
		{"abandono", c.Abandono, func(cli *Chatwoot) resultado { return processarRodada(ctx, f, cli, c.Abandono, c.Chatwoot, agora) }},
		{"followup", c.Followup, func(cli *Chatwoot) resultado {
			// Agenda quem recebeu a de abandono há FOLLOWUP_APOS_HORAS. O seco só LÊ: não agenda.
			if c.Followup.Modo != "seco" && inteiro(c.Followup.MaxHoras) && c.Followup.MaxHoras >= 1 {
				if err := f.agendarFollowups(context.WithoutCancel(ctx), int(c.FollowupAposHoras), int(c.Followup.MaxHoras)); err != nil {
					slog.Error("falha em agendar_followups", "erro", err)
				}
			}
			return processarFila(ctx, f, cli, c.Followup, c.Chatwoot, "followup", agora)
		}},
	}
	var falhas []string
	for _, p := range passadas {
		if p.p.Modo == "desligado" {
			continue
		}
		if !slices.Contains(modos, p.p.Modo) { // modo desconhecido falha fechado só naquele tipo
			falhas = append(falhas, p.nome+": modo_invalido")
			continue
		}
		cli := chat
		if p.p.Modo == "seco" {
			cli = nil // o seco nunca fala com o Chatwoot
		}
		r := rodarProtegido(p.rodar, cli)
		slog.Info("enviar-mensagem-abandono", "passada", p.nome, "modo", p.p.Modo, "status", r.status, "corpo", r.corpo)
		if r.status != 200 {
			falhas = append(falhas, fmt.Sprintf("%s: %v", p.nome, r.corpo["erro"]))
		}
	}
	if len(falhas) > 0 {
		return errors.New(strings.Join(falhas, "; "))
	}
	return nil
}

// rodarProtegido: uma passada que quebra não derruba as outras (o try/catch de rodada-completa.js).
func rodarProtegido(rodar func(*Chatwoot) resultado, cli *Chatwoot) (r resultado) {
	defer func() {
		if x := recover(); x != nil {
			slog.Error("falha na passada", "erro", texto.CortarUTF16(fmt.Sprint(x), 160))
			r = resultado{500, map[string]any{"ok": false, "erro": "excecao"}}
		}
	}()
	return rodar(cli)
}

func registrar(nome string, err error) error {
	if err != nil {
		slog.Error("falha em "+nome, "erro", err) // o item já foi decidido: não há o que refazer aqui
	}
	return err
}

func ultimos11(p Passada) []string {
	if p.Modo != "lista" {
		return nil
	}
	out := make([]string, len(p.SoPara))
	for i, n := range p.SoPara {
		out[i] = n[max(0, len(n)-11):]
	}
	return out
}

func finalDoTelefone(t string) any {
	if t == "" {
		return nil
	}
	return t[len(t)-4:]
}

func motivoOuNulo(m string) any {
	if m == "" {
		return nil
	}
	return m
}

// processarRodada é o abandono (rodada-de-mensagens.js).
func processarRodada(ctx context.Context, f fila, cli *Chatwoot, cfg Passada, chat ChatwootConfig, agora time.Time) resultado {
	seco := cfg.Modo == "seco"
	problemas := validarConfig(cfg, chat, true)
	if !inteiro(cfg.MaxHoras) || cfg.MaxHoras < 1 {
		problemas = append(problemas, "ENVIO_MAX_HORAS inválido (inteiro a partir de 1)")
	}
	if !inteiro(cfg.AtrasoMin) || cfg.AtrasoMin < 0 {
		problemas = append(problemas, "ENVIO_ATRASO_MINUTOS inválido (inteiro a partir de 0)")
	}
	if len(problemas) > 0 {
		return resultado{500, map[string]any{"ok": false, "erro": "config_invalida", "problemas": problemas}}
	}
	db := context.WithoutCancel(ctx) // o estado da fila é gravado mesmo se o prazo da tarefa acabar no meio
	if !seco {
		registrar("liberar_mensagens_travadas", f.liberarMensagensTravadas(db))
	}
	lote, err := f.pegarParaMensagem(db, int(cfg.Limite), int(cfg.AtrasoMin), !seco, ultimos11(cfg), int(cfg.MaxHoras))
	if err != nil {
		return resultado{500, map[string]any{"ok": false, "erro": "falha_ao_pegar", "detalhe": err.Error()}}
	}
	devolver := func(token string, contar bool) { registrar("devolver_mensagem", f.devolverMensagem(db, token, contar)) }
	marcar := func(token, status, motivo string) {
		registrar("marcar_mensagem", f.marcarMensagem(db, token, status, motivo, nil))
	}
	// ⚠️ Se a lista de quem pediu para parar não puder ser lida, NÃO se envia nada.
	var telefones []string
	for _, l := range lote {
		if t := normalizarTelefone(l.Telefone); t != "" && !slices.Contains(telefones, t) {
			telefones = append(telefones, t)
		}
	}
	bloqueados := map[string]bool{}
	if len(telefones) > 0 {
		if bloqueados, err = f.bloqueados(db, telefones); err != nil {
			slog.Error("falha ao ler bloqueados; rodada abortada", "erro", err)
			if !seco {
				for _, l := range lote {
					devolver(l.Token, false)
				}
			}
			return resultado{500, map[string]any{"ok": false, "erro": "falha_bloqueados"}}
		}
	}
	var res []map[string]any
	for i, l := range lote {
		d := decidirEnvio(l, bloqueados, agora, cfg.LinkBase)
		curto := texto.CortarUTF16(l.Token, 8)
		if seco {
			item := map[string]any{"token": curto, "decisao": d.Acao, "motivo": motivoOuNulo(d.Motivo), "telefone_final": finalDoTelefone(d.Telefone), "sufixo_amostra": nil}
			if d.Sufixo != "" {
				item["sufixo_amostra"] = amostraDoSufixo(d.Sufixo)
			}
			res = append(res, item)
			continue
		}
		if ctx.Err() != nil { // o prazo acabou: nenhuma linha nova começa; o resto volta sem gastar tentativa
			for _, x := range lote[i:] {
				devolver(x.Token, false)
			}
			return resultado{500, map[string]any{"ok": false, "erro": "limite_de_tempo", "resultado": res}}
		}
		switch d.Acao {
		case "ignorar":
			marcar(l.Token, "ignorada", d.Motivo)
			res = append(res, map[string]any{"token": curto, "resultado": "ignorada", "motivo": d.Motivo})
			continue
		case "esperar":
			devolver(l.Token, false)
			res = append(res, map[string]any{"token": curto, "resultado": "esperando", "motivo": d.Motivo})
			continue
		}
		if cfg.TravaCruzada { // outra automática ao mesmo telefone nas últimas 20 h barra esta
			switch f.travaCruzada(db, d.Telefone, "abandono", l.Token) {
			case "erro":
				devolver(l.Token, true)
				res = append(res, map[string]any{"token": curto, "resultado": "esperando", "motivo": "falha_na_trava_cruzada"})
				continue
			case "esperar":
				devolver(l.Token, false)
				res = append(res, map[string]any{"token": curto, "resultado": "esperando", "motivo": "telefone_com_envio_em_andamento"})
				continue
			case "barrar":
				marcar(l.Token, "ignorada", motivoTravaCruzada)
				res = append(res, map[string]any{"token": curto, "resultado": "ignorada", "motivo": motivoTravaCruzada})
				continue
			}
		}
		// ⚠️ RELÊ o status na hora de enviar: um pagamento pode ter chegado desde a reserva.
		st, err := f.statusDoCheckout(db, l.Token)
		if err != nil {
			slog.Error("falha ao reler o status; item devolvido", "erro", err)
			devolver(l.Token, true)
			res = append(res, map[string]any{"token": curto, "resultado": "esperando", "motivo": "falha_ao_reler_status"})
			continue
		}
		if st != "fila_envio" {
			marcar(l.Token, "ignorada", "nao_esta_mais_na_fila")
			res = append(res, map[string]any{"token": curto, "resultado": "ignorada", "motivo": "nao_esta_mais_na_fila"})
			continue
		}
		item, parar := enviarAbandono(ctx, db, f, cli, cfg, l, d)
		if parar { // credencial/permissão: o problema não é do lead. Devolve este e os que sobraram, sem contar.
			for _, x := range lote[i:] {
				devolver(x.Token, false)
			}
			slog.Error("chatwoot recusou a credencial; rodada interrompida", "detalhe", item["detalhe"])
			return resultado{502, map[string]any{"ok": false, "erro": "credencial_recusada", "detalhe": item["detalhe"], "resultado": res}}
		}
		item["token"] = curto
		res = append(res, item)
	}
	return resultado{200, map[string]any{"ok": true, "modo": cfg.Modo, "quantidade": len(res), "resultado": res}}
}

func enviarAbandono(ctx, db context.Context, f fila, cli *Chatwoot, cfg Passada, l LinhaAbandono, d Decisao) (map[string]any, bool) {
	falha := func(err error) (map[string]any, bool) {
		tipo, detalhe := classificarErro(err), detalheDoErro(err)
		switch tipo {
		case "parar":
			return map[string]any{"resultado": "tentar_de_novo", "detalhe": detalhe}, true
		case "tentar_de_novo":
			registrar("devolver_mensagem", f.devolverMensagem(db, l.Token, true))
			return map[string]any{"resultado": "tentar_de_novo", "detalhe": detalhe}, false
		}
		registrar("marcar_mensagem", f.marcarMensagem(db, l.Token, "falhou", detalhe, nil))
		return map[string]any{"resultado": "falhou", "detalhe": detalhe}, false
	}
	contato, err := cli.AcharOuCriarContato(ctx, formatarNomeCompleto(l.Nome), d.Telefone)
	if err != nil {
		return falha(err)
	}
	conversa, err := cli.AbrirConversa(ctx, contato, d.Telefone)
	if err != nil {
		return falha(err)
	}
	// Já respondeu DESDE o início deste checkout (a conversa é reaproveitada): a de 24 h não sai.
	respondeu, err := cli.Respondeu(ctx, conversa, &l.IniciadoEm)
	if err != nil {
		return falha(err)
	}
	if respondeu {
		registrar("marcar_mensagem", f.marcarMensagem(db, l.Token, "ignorada", "respondeu", nil))
		return map[string]any{"resultado": "ignorada", "motivo": "respondeu"}, false
	}
	texto := cfg.TemplateTexto
	if texto == "" {
		texto = "[template " + cfg.TemplateNome + "]"
	}
	texto = strings.Replace(texto, "{{1}}", primeiroNome(l.Nome), 1)
	if err := cli.EnviarTemplate(ctx, conversa, texto, templateMarketing(cfg.TemplateNome, cfg.Idioma, l.Nome, d.Sufixo)); err != nil {
		return falha(err)
	}
	// ⚠️ A mensagem JÁ SAIU. Se gravar falhar, não devolve nem reenvia: fica 'enviando' e, em 10 min,
	// vira falhou/travada_sem_confirmacao (visível), nunca uma segunda mensagem.
	if registrar("marcar_mensagem", f.marcarMensagem(db, l.Token, "enviada", "", &conversa)) != nil {
		return map[string]any{"resultado": "enviada_sem_gravar"}, false
	}
	return map[string]any{"resultado": "enviada"}, false
}

type aviso struct{ phone, tipo, chave string }

// processarFila: inicio, pedido e follow-up (rodada-da-fila.js).
func processarFila(ctx context.Context, f fila, cli *Chatwoot, cfg Passada, chat ChatwootConfig, tipo string, agora time.Time) resultado {
	seco, followup := cfg.Modo == "seco", tipo == "followup"
	problemas := validarConfig(cfg, chat, followup || tipo == "inicio")
	if !inteiro(cfg.MaxHoras) || cfg.MaxHoras < 1 {
		problemas = append(problemas, "ENVIO_MAX_HORAS inválido (inteiro a partir de 1)")
	}
	reservar := tipo == "pedido" && cfg.ReservarAviso
	if reservar && chat.BotSecret == "" { // não envia o pedido sem a trava que se pediu
		problemas = append(problemas, "CHATWOOT_BOT_SECRET ausente (RESERVAR_AVISO_CHATWOOT=true exige)")
	}
	if len(problemas) > 0 {
		return resultado{500, map[string]any{"ok": false, "erro": "config_invalida", "problemas": problemas}}
	}
	db := context.WithoutCancel(ctx)
	marcar := func(chave, status, motivo string) error {
		return registrar("marcar_da_fila", f.marcarDaFila(db, tipo, chave, status, motivo, nil))
	}
	devolver := func(chave string, contar bool) {
		registrar("devolver_da_fila", f.devolverDaFila(db, tipo, chave, contar))
	}
	if !seco {
		registrar("liberar_travadas_da_fila", f.liberarTravadasDaFila(db))
	}
	lote, err := f.pegarDaFila(db, tipo, int(cfg.Limite), int(cfg.MaxHoras), !seco, ultimos11(cfg))
	if err != nil {
		slog.Error("falha ao pegar da fila", "erro", err)
		return resultado{500, map[string]any{"ok": false, "erro": "falha_ao_pegar", "detalhe": err.Error()}}
	}
	bloqueados := map[string]bool{}
	var telefones []string
	for _, l := range lote {
		if t := normalizarTelefone(l.Telefone); t != "" && !slices.Contains(telefones, t) {
			telefones = append(telefones, t)
		}
	}
	if (followup || tipo == "inicio") && len(telefones) > 0 { // o pedido é transacional: não consulta
		if bloqueados, err = f.bloqueados(db, telefones); err != nil {
			slog.Error("falha ao ler bloqueados; rodada abortada", "erro", err)
			if !seco {
				for _, l := range lote {
					devolver(l.Chave, false)
				}
			}
			return resultado{500, map[string]any{"ok": false, "erro": "falha_bloqueados"}}
		}
	}
	var res []map[string]any
	adiados := 0 // reserva respondeu 'adiado': o core manda a NF-e; só se conta
	for i, l := range lote {
		d := decidirLinha(tipo, l, bloqueados, agora, cfg.LinkBase)
		curto := texto.CortarUTF16(l.Chave, 8)
		if seco {
			item := map[string]any{"chave": curto, "decisao": d.Acao, "motivo": motivoOuNulo(d.Motivo), "telefone_final": finalDoTelefone(d.Telefone), "sufixo_amostra": nil}
			if d.Sufixo != "" {
				item["sufixo_amostra"] = amostraDoSufixo(d.Sufixo)
			}
			res = append(res, item)
			continue
		}
		if ctx.Err() != nil {
			for _, x := range lote[i:] {
				devolver(x.Chave, false)
			}
			return resultado{500, map[string]any{"ok": false, "erro": "limite_de_tempo", "resultado": res}}
		}
		pendentes := lote[i+1:]
		switch d.Acao {
		case "ignorar":
			marcar(l.Chave, "ignorada", d.Motivo)
			res = append(res, map[string]any{"chave": curto, "resultado": "ignorada", "motivo": d.Motivo})
			continue
		case "esperar":
			devolver(l.Chave, false)
			res = append(res, map[string]any{"chave": curto, "resultado": "esperando", "motivo": d.Motivo})
			continue
		}
		if cfg.TravaCruzada && tipo != "pedido" { // o pedido recebido (transacional) nunca é barrado
			switch f.travaCruzada(db, d.Telefone, tipo, l.Chave) {
			case "erro":
				devolver(l.Chave, true)
				res = append(res, map[string]any{"chave": curto, "resultado": "esperando", "motivo": "falha_na_trava_cruzada"})
				continue
			case "esperar":
				devolver(l.Chave, false)
				res = append(res, map[string]any{"chave": curto, "resultado": "esperando", "motivo": "telefone_com_envio_em_andamento"})
				continue
			case "barrar":
				marcar(l.Chave, "ignorada", motivoTravaCruzada)
				res = append(res, map[string]any{"chave": curto, "resultado": "ignorada", "motivo": motivoTravaCruzada})
				continue
			}
		}
		// Reserva do aviso no Chatwoot (trava ADICIONAL): só 'reservado' autoriza.
		var reservado *aviso
		liberarReserva := func() { // best-effort; uma reserva órfã faria a próxima rodada receber 'duplicado'
			if reservado != nil {
				a := *reservado
				reservado = nil
				cli.LiberarAviso(db, a.phone, a.tipo, a.chave)
			}
		}
		if reservar {
			chaveAviso := strings.TrimPrefix(deref(l.Numero), "#")
			if chaveAviso == "" {
				chaveAviso = l.Chave
			}
			av := aviso{d.Telefone, "pedido_recebido", chaveAviso}
			idade := max(0, int64(agora.Sub(l.CriadoEm)/time.Second))
			r, err := cli.ReservarAviso(ctx, av.phone, av.tipo, av.chave, &idade)
			if err != nil {
				st := 0
				var ec *ErroChatwoot
				if errors.As(err, &ec) {
					st = ec.Status
				}
				detalhe := fmt.Sprintf("reservar_aviso:%d", st)
				if st == 0 || st >= 500 || st == 200 { // a resposta pode ter se perdido com a reserva gravada
					reservado = &av
					liberarReserva()
				}
				devolver(l.Chave, false)
				if st == 401 || st == 403 {
					for _, x := range pendentes {
						devolver(x.Chave, false)
					}
					slog.Error("chatwoot recusou o X-Bot-Secret na reserva do aviso; rodada interrompida", "detalhe", detalhe)
					return resultado{502, map[string]any{"ok": false, "erro": "reserva_recusada", "detalhe": detalhe, "resultado": res}}
				}
				res = append(res, map[string]any{"chave": curto, "resultado": "esperando", "motivo": "falha_na_reserva_do_aviso", "detalhe": detalhe})
				continue
			}
			if r == "adiado" {
				devolver(l.Chave, false)
				adiados++
				continue
			}
			if r != "reservado" { // duplicado | janela: já foi avisada
				marcar(l.Chave, "ignorada", "aviso_chatwoot_"+r)
				res = append(res, map[string]any{"chave": curto, "resultado": "ignorada", "motivo": "aviso_chatwoot_" + r})
				continue
			}
			reservado = &av
		}
		if followup {
			// ⚠️ RELÊ o status: entre agendar e enviar a cliente pode ter comprado ou gerado um Pix.
			st, err := f.statusDoCheckout(db, l.Chave)
			if err != nil {
				slog.Error("falha ao reler o status; item devolvido", "erro", err)
				devolver(l.Chave, true)
				res = append(res, map[string]any{"chave": curto, "resultado": "esperando", "motivo": "falha_ao_reler_status"})
				continue
			}
			if st != "fila_envio" {
				marcar(l.Chave, "ignorada", "nao_esta_mais_na_fila")
				res = append(res, map[string]any{"chave": curto, "resultado": "ignorada", "motivo": "nao_esta_mais_na_fila"})
				continue
			}
			if l.ConversaOrigem == nil { // sem a conversa anterior não há como saber se respondeu
				marcar(l.Chave, "ignorada", "sem_conversa_de_origem")
				res = append(res, map[string]any{"chave": curto, "resultado": "ignorada", "motivo": "sem_conversa_de_origem"})
				continue
			}
		}
		item, parar := enviarDaFila(ctx, db, f, cli, cfg, tipo, l, d, reservado != nil, liberarReserva)
		if parar { // credencial/permissão: devolve este e os que sobraram, sem contar tentativa
			devolver(l.Chave, false)
			for _, x := range pendentes {
				devolver(x.Chave, false)
			}
			slog.Error("chatwoot recusou a credencial; rodada interrompida", "detalhe", item["detalhe"])
			return resultado{502, map[string]any{"ok": false, "erro": "credencial_recusada", "detalhe": item["detalhe"], "resultado": res}}
		}
		item["chave"] = curto
		res = append(res, item)
	}
	corpo := map[string]any{"ok": true, "modo": cfg.Modo, "tipo": tipo, "quantidade": len(res), "resultado": res}
	if reservar {
		corpo["adiados"] = adiados
	}
	return resultado{200, corpo}
}

func deref(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

func enviarDaFila(ctx, db context.Context, f fila, cli *Chatwoot, cfg Passada, tipo string, l LinhaFila, d Decisao,
	comReserva bool, liberarReserva func()) (map[string]any, bool) {
	chegouNoEnvio := false // a partir do enviarTemplate uma falha pode ser ambígua
	falha := func(err error) (map[string]any, bool) {
		como, detalhe := classificarErro(err), detalheDoErro(err)
		var ec *ErroChatwoot
		ambigua := chegouNoEnvio && (!errors.As(err, &ec) || ec.Status == 0 || ec.Status >= 500)
		if comReserva && ambigua { // a Meta pode ter aceitado: NÃO libera (permitiria um 2º aviso) e NÃO devolve
			registrar("marcar_da_fila", f.marcarDaFila(db, tipo, l.Chave, "falhou", "envio_incerto_conferir_no_chatwoot: "+detalhe, nil))
			return map[string]any{"resultado": "falhou", "motivo": "envio_incerto", "detalhe": detalhe}, false
		}
		liberarReserva() // a falha foi comprovadamente ANTES de a mensagem ser aceita
		switch como {
		case "parar":
			return map[string]any{"resultado": "tentar_de_novo", "detalhe": detalhe}, true
		case "tentar_de_novo":
			registrar("devolver_da_fila", f.devolverDaFila(db, tipo, l.Chave, true))
			return map[string]any{"resultado": "tentar_de_novo", "detalhe": detalhe}, false
		}
		registrar("marcar_da_fila", f.marcarDaFila(db, tipo, l.Chave, "falhou", detalhe, nil))
		return map[string]any{"resultado": "falhou", "detalhe": detalhe}, false
	}
	if tipo == "followup" {
		respondeu, err := cli.Respondeu(ctx, *l.ConversaOrigem, nil)
		if err != nil {
			return falha(err)
		}
		if respondeu {
			registrar("marcar_da_fila", f.marcarDaFila(db, tipo, l.Chave, "ignorada", "respondeu", nil))
			return map[string]any{"resultado": "ignorada", "motivo": "respondeu"}, false
		}
	}
	contato, err := cli.AcharOuCriarContato(ctx, formatarNomeCompleto(l.Nome), d.Telefone)
	if err != nil {
		return falha(err)
	}
	conversa, err := cli.AbrirConversa(ctx, contato, d.Telefone)
	if err != nil {
		return falha(err)
	}
	texto := cfg.TemplateTexto
	if texto == "" {
		texto = "[template " + cfg.TemplateNome + "]"
	}
	texto = strings.Replace(strings.Replace(texto, "{{1}}", primeiroNome(l.Nome), 1), "{{2}}", deref(l.Numero), 1)
	params := templateMarketing(cfg.TemplateNome, cfg.Idioma, l.Nome, d.Sufixo) // inicio e follow-up
	if tipo == "pedido" {
		params = templatePedido(cfg.TemplateNome, cfg.Idioma, l.Nome, l.Numero)
	}
	chegouNoEnvio = true
	if err := cli.EnviarTemplate(ctx, conversa, texto, params); err != nil {
		return falha(err)
	}
	// ⚠️ A mensagem JÁ SAIU: se gravar falhar, fica 'enviando' (vira falhou em 10 min), nunca reenvia.
	if registrar("marcar_da_fila", f.marcarDaFila(db, tipo, l.Chave, "enviada", "", &conversa)) != nil {
		return map[string]any{"resultado": "enviada_sem_gravar"}, false
	}
	return map[string]any{"resultado": "enviada"}, false
}
```

Em `api/cmd/api/tarefas.go`, troque:

```go
import (
	"time"
```

por:

```go
import (
	"os"
	"time"
```

Em `api/cmd/api/tarefas.go`, troque:

```go
	return ts
}
```

por:

```go
	ts = append(ts, (&mensagens.Mensagens{Pool: p, Cfg: mensagens.LerConfig(os.Getenv)}).Tarefa())
	return ts
}
```

Em `api/cmd/api/worker.go`, troque:

```go
	ag.Desligadas, ag.Segredos = cfg.TarefasDesligadas, cfg.Segredos()
```

por:

```go
	ag.Desligadas = cfg.TarefasDesligadas
	ag.Segredos = append(cfg.Segredos(), mensagens.LerConfig(os.Getenv).Segredos()...)
```

Em `api/cmd/api/worker.go`, troque:

```go
	"github.com/rbv-co/social-dashboard/api/internal/config"
```

por:

```go
	"github.com/rbv-co/social-dashboard/api/internal/config"
	"github.com/rbv-co/social-dashboard/api/internal/mensagens"
```

- [ ] **Step 4: Rodar e ver passar**

Run: `gofmt -l . && go vet ./... && go test -race -count=1 ./internal/mensagens/ ./cmd/api/ -v 2>&1 | grep -E -- '^(ok|FAIL|--- FAIL|--- SKIP)'`
Expected: `gofmt` não lista nada; só linhas `ok`, nenhuma `FAIL` nem `--- SKIP`.

- [ ] **Step 5: Commit**

```bash
git add api/internal/mensagens/fila.go api/internal/mensagens/fila_test.go api/internal/mensagens/rodadas.go api/internal/mensagens/rodadas_test.go api/cmd/api/tarefas.go api/cmd/api/worker.go api/cmd/api/worker_test.go
git commit -m "feat(api): enviar-mensagem-abandono no worker (fila, rodadas e prazo)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Cópia de segurança lê o Postgres novo (papel `copia`, VPS e retaguarda do GitHub)

**Revisor:** **opus** (cópia do banco inteiro; papel no Postgres; senha e credenciais fora da cópia e da linha de comando).

A cópia diária para o Zoho WorkDrive já roda NA VPS (`coletor/vps/robos.cron`, 06h12 UTC → `coletor/vps/copia-do-banco.sh` → `coletor/guardar-copia-do-banco.mjs`); o `.github/workflows/copia-do-banco.yml` só aceita disparo manual. Hoje ela lê o Supabase pelo PostgREST. Depois do corte não há PostgREST:

- `coletor/lib/fonte-pg.mjs`: com `COPIA_DATABASE_URL`, lista as tabelas do `public`, lê cada uma como `row_to_json` (o mesmo JSON que o PostgREST devolvia), grava a linha da rodada em `robos_execucoes` com `conferido_em` e lê a conexão do Zoho de `acessos_conexoes`. `guardar-copia-do-banco.mjs` e `restaurar-copia.mjs` delegam a ela quando a variável existe; sem ela, nada muda.
- As tabelas novas da API ficam fora da cópia (`sessoes`, `goose_db_version`, `webhooks_recebidos`, `envios_feitos`) e `usuarios.senha_hash` sai sem o valor.
- `copia-do-banco.sh`: com `COPIA_DB_SENHA` em `/etc/robos.env`, monta `COPIA_DATABASE_URL` pelo IP do `api-db` na rede `api_net` (sem porta publicada; o IP muda quando o contêiner é recriado), e falha antes de chamar o node se o `api-db` estiver fora do ar.
- `ops/vps/api-db/papel-copia.sql`: papel `copia` com SELECT em todas as tabelas do `public` (inclusive as futuras), sem `sessoes`, e INSERT só em `robos_execucoes`; a senha entra pelo ambiente (`\getenv`), nunca na linha de comando.
- O workflow do GitHub vira retaguarda até o corte, com a etapa que recusa quando `vars.SAIU_DO_SUPABASE == 'sim'` (depois do corte ele copiaria o Supabase velho por cima da cópia boa do dia, porque o upload sobrescreve pelo nome).

**Files:**
- Create: `coletor/lib/fonte-pg.mjs`
- Test: `coletor/lib/fonte-pg.test.mjs`
- Modify: `coletor/guardar-copia-do-banco.mjs`
- Modify: `coletor/restaurar-copia.mjs`
- Modify: `coletor/vps/copia-do-banco.sh`
- Test: `coletor/vps/copia-do-banco.teste.sh`
- Modify: `coletor/vps/LEIA-ME-ROBOS.txt`
- Create: `ops/vps/api-db/papel-copia.sql`
- Modify: `ops/vps/api-db/LEIA-ME.md`
- Modify: `.github/workflows/copia-do-banco.yml`

**Interfaces:**
- Consumes: `coletor/lib/zoho-da-central.mjs` e `coletor/lib/carregar-env.mjs` (existentes); `pg` (já em `coletor/package.json`); `robos_execucoes` (Plano 2, restaurada).
- Produces:
  - `abrirFontePg(url, { Client }?)` → `{ tabelas(), ler(nome), registrar(deuCerto, recado), conexaoZoho(), fechar() }` e `NOME_DO_ROBO = 'guardar-copia-do-banco'`.
  - Variáveis: `COPIA_DATABASE_URL` (lida pelo node), `COPIA_DB_SENHA` (lida pelo `copia-do-banco.sh`, em `/etc/robos.env`); variável do repositório `SAIU_DO_SUPABASE`.

- [ ] **Step 1: Escrever os testes que falham**

Crie `coletor/lib/fonte-pg.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { abrirFontePg, NOME_DO_ROBO } from './fonte-pg.mjs';

// Cliente do `pg` de mentira: guarda as consultas e responde por um trecho do SQL.
function clienteFalso(respostas) {
  const consultas = [];
  class Client {
    constructor(cfg) { this.cfg = cfg; }
    async connect() { consultas.push(['connect', this.cfg.connectionString]); }
    async query(sql, params) {
      consultas.push([sql, params]);
      const achou = Object.entries(respostas).find(([trecho]) => sql.includes(trecho));
      return { rows: achou ? achou[1] : [] };
    }
    async end() { consultas.push(['end']); }
  }
  return { Client, consultas };
}

test('lê as tabelas e as linhas como o PostgREST devolvia', async () => {
  const { Client, consultas } = clienteFalso({
    'information_schema.tables': [{ table_name: 'accounts' }, { table_name: 'usuarios' }],
    'from public."accounts"': [{ j: '{"id":"a1","access_token":"x","criado":"2026-10-10T12:00:00+00:00"}' }],
  });
  const f = await abrirFontePg('postgres://copia@127.0.0.1:55470/api', { Client });
  assert.deepEqual(await f.tabelas(), ['accounts', 'usuarios']);
  assert.deepEqual(await f.ler('accounts'), [{ id: 'a1', access_token: 'x', criado: '2026-10-10T12:00:00+00:00' }]);
  await assert.rejects(() => f.ler('accounts"; drop table x; --'), /nome de tabela recusado/);
  await f.fechar();
  assert.equal(consultas.at(-1)[0], 'end');
});

test('registra a rodada no painel com o nome de produção e já conferida', async () => {
  const { Client, consultas } = clienteFalso({});
  const f = await abrirFontePg('postgres://x', { Client });
  await f.registrar(false, 'x'.repeat(3000));
  const [sql, params] = consultas.at(-1);
  assert.match(sql, /insert into robos_execucoes .*conferido_em/s);
  assert.deepEqual(params.slice(0, 3), [NOME_DO_ROBO, false, 500]);
  assert.equal(params[3].length, 2000);
  assert.equal(NOME_DO_ROBO, 'guardar-copia-do-banco');
});

test('sem conexão do Zoho a cópia para com a frase de sempre', async () => {
  const { Client } = clienteFalso({ acessos_conexoes: [{ client_id: 'c', refresh_token: null }] });
  const f = await abrirFontePg('postgres://x', { Client });
  await assert.rejects(() => f.conexaoZoho(), /Abra Acessos → Zoho/);
});

// A regra da cópia é "copiar TUDO menos o decidido": as tabelas NOVAS da API (senha em bcrypt,
// sessões, marcas de webhook, livro de envios) não podem ir para o drive compartilhado.
test('as credenciais e o estado da API Go ficam fora da cópia', () => {
  const robo = readFileSync(new URL('../guardar-copia-do-banco.mjs', import.meta.url), 'utf8');
  assert.match(robo, /usuarios: \['senha_hash'\]/);
  for (const t of ['sessoes', 'goose_db_version', 'webhooks_recebidos', 'envios_feitos']) {
    assert.match(robo, new RegExp(`SEM_COPIA = new Set\\(\\[[^\\]]*'${t}'`, 's'), t);
  }
  assert.match(robo, /COPIA_DATABASE_URL/);
});
```

Crie `coletor/vps/copia-do-banco.teste.sh`:

```bash
#!/usr/bin/env bash
# Autoteste do copia-do-banco.sh: docker e node de mentira, nada de produção.
# Uso: bash coletor/vps/copia-do-banco.teste.sh
set -u
AQUI="$(cd "$(dirname "$0")" && pwd)"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
printf '#!/bin/sh\necho "$IP_FALSO"\n' > "$T/docker"
printf '#!/bin/sh\necho "url=${COPIA_DATABASE_URL:-} args=$*" >> "%s/node.log"\n' "$T" > "$T/node"
chmod +x "$T/docker" "$T/node"
export PATH="$T:$PATH"
falhas=0
confere() { if [ "$2" = "$3" ]; then echo "ok   $1"; else echo "FALHA $1 (esperado '$3', veio '$2')"; falhas=$((falhas + 1)); fi; }
C="$AQUI/copia-do-banco.sh"

IP_FALSO=172.20.0.5 COPIA_DB_SENHA=ab12cd34ef56 bash "$C" --ensaio; confere "depois do corte roda" $? 0
confere "URL do Postgres novo pelo IP da api_net" "$(head -1 "$T/node.log" | cut -d' ' -f1)" "url=postgres://copia:ab12cd34ef56@172.20.0.5:5432/api"
grep -q -- "--limpar" "$T/node.log"; confere "ensaio não limpa" $? 1

rm -f "$T/node.log"
IP_FALSO=172.20.0.5 bash "$C" --ensaio; confere "antes do corte roda" $? 0
confere "sem COPIA_DB_SENHA não monta URL (segue no Supabase)" "$(cut -d' ' -f1 "$T/node.log")" "url="

rm -f "$T/node.log"
IP_FALSO= COPIA_DB_SENHA=ab12cd34ef56 bash "$C" --ensaio 2>/dev/null; confere "api-db fora do ar falha" $? 1
[ -e "$T/node.log" ]; confere "sem IP nem chama o node" $? 1

[ "$falhas" -eq 0 ] && echo "TUDO OK" || { echo "$falhas falha(s)"; exit 1; }
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test coletor/lib/fonte-pg.test.mjs; bash coletor/vps/copia-do-banco.teste.sh`
Expected: o `node --test` falha com `ERR_MODULE_NOT_FOUND` (`Cannot find module '.../coletor/lib/fonte-pg.mjs'`); o autoteste do shell imprime `FALHA URL do Postgres novo pelo IP da api_net (esperado 'url=postgres://copia:ab12cd34ef56@172.20.0.5:5432/api', veio 'url=')`, `FALHA api-db fora do ar falha` e `FALHA sem IP nem chama o node`, e sai com 1.

- [ ] **Step 3: Implementar**

Crie `coletor/lib/fonte-pg.mjs`:

```js
// A FONTE DA CÓPIA DE SEGURANÇA NO POSTGRES PRÓPRIO (saída do Supabase, Plano 4).
//
// Depois do corte não existe mais PostgREST: a cópia (coletor/guardar-copia-do-banco.mjs, agendada
// NA VPS por coletor/vps/robos.cron) lê o Postgres da API direto, com o papel SÓ LEITURA `copia`
// (ops/vps/api-db/papel-copia.sql), por COPIA_DATABASE_URL. Cada linha sai como row_to_json — o MESMO
// JSON que o PostgREST devolvia (ele monta a resposta com as funções JSON do próprio Postgres), então
// os arquivos, o manifesto e a conferência mensal não mudam.
//
// `Client` é injetável para o teste não precisar de banco; sem ele, usa o `pg` do coletor.
export const NOME_DO_ROBO = 'guardar-copia-do-banco';

const NOME_DE_TABELA = /^[a-z_][a-z0-9_]*$/;

export async function abrirFontePg(url, { Client } = {}) {
  if (!Client) ({ default: { Client } } = await import('pg'));
  const cli = new Client({ connectionString: url });
  await cli.connect();
  return {
    /** Todas as tabelas do schema public (a regra é copiar TUDO menos o que o robô exclui). */
    async tabelas() {
      const r = await cli.query(`select table_name from information_schema.tables
        where table_schema = 'public' and table_type = 'BASE TABLE' order by 1`);
      return r.rows.map((x) => x.table_name);
    },
    /** Uma tabela inteira. O nome vem do próprio banco, mas vai validado e entre aspas mesmo assim. */
    async ler(nome) {
      if (!NOME_DE_TABELA.test(nome)) throw new Error(`nome de tabela recusado: ${nome}`);
      const r = await cli.query(`select row_to_json(t)::text as j from public."${nome}" t`);
      return r.rows.map((x) => JSON.parse(x.j));
    },
    /** A linha da rodada em robos_execucoes (o painel de saúde cobra este robô como crítico). */
    async registrar(deuCerto, recado) {
      await cli.query(`insert into robos_execucoes (robo, ok, status_code, resposta, conferido_em)
        values ($1, $2, $3, $4, now())`, [NOME_DO_ROBO, deuCerto, deuCerto ? 200 : 500, String(recado).slice(0, 2000)]);
    },
    /** A conexão do Zoho que o dono liga em Acessos → Zoho (a mesma de antes, agora lida do banco novo). */
    async conexaoZoho() {
      const r = await cli.query(`select client_id, client_secret, refresh_token, data_center
        from acessos_conexoes where provedor = 'zoho' limit 1`);
      const c = r.rows[0];
      if (!c?.refresh_token) {
        throw new Error('A Central não está conectada ao Zoho. Abra Acessos → Zoho e clique em conectar.');
      }
      return c;
    },
    fechar: () => cli.end(),
  };
}
```

Em `coletor/guardar-copia-do-banco.mjs`, troque:

```js
  baixarArquivo, subirArquivo, mandarParaLixeira,
} from './lib/zoho-da-central.mjs';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://kounqtdoioootxqegkij.supabase.co';
```

por:

```js
  baixarArquivo, subirArquivo, mandarParaLixeira,
} from './lib/zoho-da-central.mjs';
import { abrirFontePg } from './lib/fonte-pg.mjs';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://kounqtdoioootxqegkij.supabase.co';
```

Em `coletor/guardar-copia-do-banco.mjs`, troque:

```js
  'robos_execucoes', 'robos_travas', 'coletor_log', 'gestor_log',
  'data_integrity_checks', 'ia_execucoes', 'audit_log', 'schema_migrations',
]);

```

por:

```js
  'robos_execucoes', 'robos_travas', 'coletor_log', 'gestor_log',
  'data_integrity_checks', 'ia_execucoes', 'audit_log', 'schema_migrations',
  // Da API Go (saída do Supabase): sessões guardam hash de token, as marcas de webhook e o livro de
  // envios são estado de execução, e goose_db_version se refaz com `api migrar`.
  'sessoes', 'goose_db_version', 'webhooks_recebidos', 'envios_feitos',
]);

```

Em `coletor/guardar-copia-do-banco.mjs`, troque:

```js
 */
const SEM_O_VALOR = {
  segredos_de_cron: ['segredo'],
  bling_tokens: ['access_token', 'refresh_token', 'client_secret'],
```

por:

```js
 */
const SEM_O_VALOR = {
  usuarios: ['senha_hash'],          // a senha (bcrypt) que a API Go copiou do Supabase Auth
  segredos_de_cron: ['segredo'],
  bling_tokens: ['access_token', 'refresh_token', 'client_secret'],
```

Em `coletor/guardar-copia-do-banco.mjs`, troque:

```js
const QUEDA_QUE_ASSUSTA = 0.10;    // 10% de linhas a menos numa tabela

// ── Supabase ─────────────────────────────────────────────────────────────────

const cabSb = {
```

por:

```js
const QUEDA_QUE_ASSUSTA = 0.10;    // 10% de linhas a menos numa tabela

// ── a fonte: o Supabase (até o corte) ou o Postgres próprio ──────────────────
//
// ⚠️ DEPOIS DO CORTE (saída do Supabase) não existe PostgREST: com COPIA_DATABASE_URL a cópia lê o
// Postgres da API pelo papel só leitura `copia` (ops/vps/api-db/papel-copia.sql). O resto do robô
// não muda: mesmas regras de credencial, de dado de cliente e de encolhimento.
let fontePg = null;

const cabSb = {
```

Em `coletor/guardar-copia-do-banco.mjs`, troque:

```js
 */
async function tabelasDoBanco() {
  const r = await fetch(REST + '/', { headers: cabSb });
  if (!r.ok) throw new Error(`não consegui listar as tabelas (HTTP ${r.status})`);
```

por:

```js
 */
async function tabelasDoBanco() {
  if (fontePg) return fontePg.tabelas();
  const r = await fetch(REST + '/', { headers: cabSb });
  if (!r.ok) throw new Error(`não consegui listar as tabelas (HTTP ${r.status})`);
```

Em `coletor/guardar-copia-do-banco.mjs`, troque:

```js
/** Uma tabela inteira, de mil em mil linhas. */
async function lerTabela(nome) {
  const linhas = [];
  const passo = 1000;
```

por:

```js
/** Uma tabela inteira, de mil em mil linhas. */
async function lerTabela(nome) {
  if (fontePg) return fontePg.ler(nome);
  const linhas = [];
  const passo = 1000;
```

Em `coletor/guardar-copia-do-banco.mjs`, troque:

```js
async function registrar(deuCerto, recado) {
  try {
    await fetch(`${REST}/robos_execucoes`, {
      method: 'POST',
```

por:

```js
async function registrar(deuCerto, recado) {
  try {
    if (fontePg) return await fontePg.registrar(deuCerto, recado);
    await fetch(`${REST}/robos_execucoes`, {
      method: 'POST',
```

Em `coletor/guardar-copia-do-banco.mjs`, troque:

```js
const MES = `${hoje.getFullYear()}-${p(hoje.getMonth() + 1)}`;

if (!SERVICE_KEY) {
  console.error('⛔ Falta SUPABASE_SERVICE_KEY.');
  process.exit(1);
}

console.log(`\nCÓPIA DE ${DIA}${semanal ? ' (semanal: com o histórico de métrica)' : ''}` +
```

por:

```js
const MES = `${hoje.getFullYear()}-${p(hoje.getMonth() + 1)}`;

if (!SERVICE_KEY && !process.env.COPIA_DATABASE_URL) {
  console.error('⛔ Falta SUPABASE_SERVICE_KEY (ou, depois do corte, COPIA_DATABASE_URL).');
  process.exit(1);
}
if (process.env.COPIA_DATABASE_URL) fontePg = await abrirFontePg(process.env.COPIA_DATABASE_URL);

console.log(`\nCÓPIA DE ${DIA}${semanal ? ' (semanal: com o histórico de métrica)' : ''}` +
```

Em `coletor/guardar-copia-do-banco.mjs`, troque:

```js
}

const conexao = await conexaoZoho(REST, cabSb);
const tz = await tokenZoho(conexao);
const base = await acharOuCriarPasta(tz, RAIZ, PASTA_BASE);
```

por:

```js
}

const conexao = fontePg ? await fontePg.conexaoZoho() : await conexaoZoho(REST, cabSb);
const tz = await tokenZoho(conexao);
const base = await acharOuCriarPasta(tz, RAIZ, PASTA_BASE);
```

Em `coletor/guardar-copia-do-banco.mjs`, troque:

```js
// crítico, porque é a única cópia que existe.
await registrar(true, `${arquivos.length} arquivos, ${(bytes / 1024 / 1024).toFixed(1)} MB, dia ${DIA}`);
console.log('\npronto.\n');
```

por:

```js
// crítico, porque é a única cópia que existe.
await registrar(true, `${arquivos.length} arquivos, ${(bytes / 1024 / 1024).toFixed(1)} MB, dia ${DIA}`);
await fontePg?.fechar();
console.log('\npronto.\n');
```

Em `coletor/restaurar-copia.mjs`, troque:

```js
import './lib/carregar-env.mjs';
import { createHash } from 'node:crypto';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://kounqtdoioootxqegkij.supabase.co';
```

por:

```js
import './lib/carregar-env.mjs';
import { createHash } from 'node:crypto';
import { abrirFontePg } from './lib/fonte-pg.mjs';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://kounqtdoioootxqegkij.supabase.co';
```

Em `coletor/restaurar-copia.mjs`, troque:

```js
const soma = (texto) => createHash('sha256').update(texto).digest('hex');

async function tokenZoho() {
  const r = await fetch(`${REST}/acessos_conexoes?provedor=eq.zoho`
    + '&select=client_id,client_secret,refresh_token,data_center&limit=1', { headers: cabSb });
  const [c] = await r.json();
  if (!c?.refresh_token) throw new Error('A Central não está conectada ao Zoho.');
  let dc = String(c.data_center || '.com');
  if (!dc.startsWith('.')) dc = '.' + dc;
```

por:

```js
const soma = (texto) => createHash('sha256').update(texto).digest('hex');

// Depois do corte (saída do Supabase) a conexão do Zoho vem do Postgres próprio (COPIA_DATABASE_URL).
async function conexaoDoZoho() {
  if (process.env.COPIA_DATABASE_URL) {
    const f = await abrirFontePg(process.env.COPIA_DATABASE_URL);
    try { return await f.conexaoZoho(); } finally { await f.fechar(); }
  }
  const r = await fetch(`${REST}/acessos_conexoes?provedor=eq.zoho`
    + '&select=client_id,client_secret,refresh_token,data_center&limit=1', { headers: cabSb });
  const [c] = await r.json();
  if (!c?.refresh_token) throw new Error('A Central não está conectada ao Zoho.');
  return c;
}

async function tokenZoho() {
  const c = await conexaoDoZoho();
  let dc = String(c.data_center || '.com');
  if (!dc.startsWith('.')) dc = '.' + dc;
```

Em `coletor/vps/copia-do-banco.sh`, troque:

```bash
# DIA 1º: baixa a cópia de ontem e confere cada arquivo contra o manifesto — backup que nunca foi restaurado não é backup.
set -u
argumentos=("$@")
[ "$(date -u +%w)" = "0" ] && argumentos+=(--semanal)
```

por:

```bash
# DIA 1º: baixa a cópia de ontem e confere cada arquivo contra o manifesto — backup que nunca foi restaurado não é backup.
set -u

# DEPOIS DO CORTE (saída do Supabase, Plano 4): com COPIA_DB_SENHA em /etc/robos.env a cópia lê o Postgres da API
# com o papel `copia` (ops/vps/api-db/papel-copia.sql). O api-db não publica porta: o endereço é o IP do contêiner
# na rede api_net, lido a cada rodada (muda quando o contêiner é recriado). A senha é hex (openssl rand -hex 24):
# vai na URL sem escapar e nunca é impressa.
if [ -n "${COPIA_DB_SENHA:-}" ]; then
  ip=$(docker inspect -f '{{(index .NetworkSettings.Networks "api_net").IPAddress}}' api-db 2>/dev/null)
  [ -n "$ip" ] || { echo "api-db fora do ar (sem IP na rede api_net): cópia não feita" >&2; exit 1; }
  export COPIA_DATABASE_URL="postgres://copia:${COPIA_DB_SENHA}@${ip}:5432/api"
fi

argumentos=("$@")
[ "$(date -u +%w)" = "0" ] && argumentos+=(--semanal)
```

Em `coletor/vps/LEIA-ME-ROBOS.txt`, troque:

```text
- copia-do-banco.sh  e faxina-storage.sh: os dois workflows que tinham mais de um passo.
- rodar-robo.teste.sh  autoteste do wrapper (Linux). `bash coletor/vps/rodar-robo.teste.sh`

ONDE FICA NA VPS
```

por:

```text
- copia-do-banco.sh  e faxina-storage.sh: os dois workflows que tinham mais de um passo.
- rodar-robo.teste.sh  autoteste do wrapper (Linux). `bash coletor/vps/rodar-robo.teste.sh`
- copia-do-banco.teste.sh  autoteste da cópia (docker e node de mentira). `bash coletor/vps/copia-do-banco.teste.sh`
  Depois do corte a cópia lê o Postgres da API: COPIA_DB_SENHA em /etc/robos.env (ops/vps/api-db/LEIA-ME.md).

ONDE FICA NA VPS
```

Crie `ops/vps/api-db/papel-copia.sql`:

```sql
-- Papel `copia`: o que a cópia de segurança para o Zoho (coletor/guardar-copia-do-banco.mjs, agendada na
-- VPS por coletor/vps/robos.cron) usa depois do corte (Plano 4, Task 11). Lê todas as tabelas do public
-- e só escreve a linha da rodada em robos_execucoes (o painel de saúde cobra o robô como crítico).
--
-- Rodar como o dono do banco, depois da carga e de `api migrar` (só com ok do dono). A senha entra pelo
-- AMBIENTE (\getenv), nunca na linha de comando (que qualquer `ps` do host mostra):
--   SENHA_COPIA="$(cat /root/secrets/copia.senha)" docker exec -i -e SENHA_COPIA api-db psql -U api -d api < /root/api-db/papel-copia.sql
-- Reaplicar é seguro: a senha é trocada e os GRANTs são refeitos.
\set ON_ERROR_STOP on
\getenv senha SENHA_COPIA
\if :{?senha}
\else
  do $$ begin raise exception 'falta SENHA_COPIA no ambiente'; end $$;
\endif

select not exists (select 1 from pg_roles where rolname = 'copia') as criar \gset
\if :criar
  create role copia login;
\endif
alter role copia with login nosuperuser nocreatedb nocreaterole noinherit connection limit 2 password :'senha';

grant connect on database :"DBNAME" to copia;
grant usage on schema public to copia;
grant select on all tables in schema public to copia;
-- Tabela que nascer depois (migração nova) também entra: a regra da cópia é "copiar TUDO menos o decidido".
alter default privileges in schema public grant select on tables to copia;

-- O hash dos tokens de sessão não sai nem por engano (SEM_COPIA já pula a tabela; o banco garante).
revoke select on public.sessoes from copia;

-- A linha da rodada (robos_execucoes.id é bigserial: o insert precisa da sequência).
grant insert on public.robos_execucoes to copia;
grant usage on sequence public.robos_execucoes_id_seq to copia;
```

Em `ops/vps/api-db/LEIA-ME.md`, troque:

```markdown
  `TESTE_CONTAINER` (o nome deve terminar em `-teste`).

## Regras do projeto

```

por:

````markdown
  `TESTE_CONTAINER` (o nome deve terminar em `-teste`).

## Cópia de segurança para o Zoho: papel `copia` (no corte, só com ok do dono)

Até o corte, a cópia diária para o Zoho WorkDrive (`coletor/vps/robos.cron` → `coletor/vps/copia-do-banco.sh` →
`coletor/guardar-copia-do-banco.mjs`, 06h12 UTC) lê o Supabase. No corte ela passa a ler ESTE banco com o papel
`copia`: SELECT em todas as tabelas do `public` (menos `sessoes`) e INSERT só em `robos_execucoes` (a linha da
rodada, que o painel cobra como crítica). Continua sem porta publicada: o `copia-do-banco.sh` lê o IP do `api-db`
na `api_net` a cada rodada e monta `COPIA_DATABASE_URL` sozinho quando `COPIA_DB_SENHA` existe em `/etc/robos.env`.

Um comando por linha. A senha nunca vai para a linha de comando (o `ps` do host mostra argumentos): entra pelo
ambiente, e o `papel-copia.sql` a lê com `\getenv`.

```sh
scp ops/vps/api-db/papel-copia.sql op:/root/api-db/papel-copia.sql
ssh op
[ -e /root/secrets/copia.senha ] || ( umask 077; openssl rand -hex 24 > /root/secrets/copia.senha )
SENHA_COPIA="$(cat /root/secrets/copia.senha)" docker exec -i -e SENHA_COPIA api-db psql -U api -d api < /root/api-db/papel-copia.sql
grep -q '^COPIA_DB_SENHA=' /etc/robos.env || echo "COPIA_DB_SENHA=$(cat /root/secrets/copia.senha)" >> /etc/robos.env
/opt/robos/social-dashboard/coletor/vps/rodar-robo.sh copia-do-banco 60 -- bash coletor/vps/copia-do-banco.sh --ensaio
tail -30 /var/log/robos/copia-do-banco.log
```

O ensaio lista as tabelas e as contagens sem enviar nada. A senha é hex de propósito: vai na URL sem escapar.
Reaplicar o `papel-copia.sql` é seguro (troca a senha e refaz os GRANTs; tabela nova criada pelo `api` também
entra, por `ALTER DEFAULT PRIVILEGES`). Para voltar ao Supabase antes do corte: apagar a linha `COPIA_DB_SENHA`
do `/etc/robos.env`. No corte, ligar também `gh variable set SAIU_DO_SUPABASE --body sim`: a retaguarda manual
do GitHub (`.github/workflows/copia-do-banco.yml`) passa a recusar, porque copiaria o Supabase velho por cima da
cópia boa do dia.

## Regras do projeto

````

Em `.github/workflows/copia-do-banco.yml`, troque:

```yaml
name: Cópia de segurança do banco

# TODO DIA, às 06h12 UTC (03h12 em Campinas): copia o banco inteiro para o Zoho
# WorkDrive.
#
# ⚠️ POR QUE ESTE AGENDAMENTO EXISTE
# A organização está no plano FREE da Supabase. A documentação deles é
# explícita: backup diário automático é só de Pro para cima, e projetos Free
# devem exportar por conta própria. Até 16/09/2026 ninguém exportava — o banco
# não tinha cópia NENHUMA. Esta é a única que existe.
#
# ⚠️ POR QUE AQUI E NÃO NUMA EDGE FUNCTION
# Mais de uma pessoa publica Edge Function neste projeto, cada uma do próprio
# computador, e quem publica por último vence — já apagou trabalho no ar em
# 14/09. Uma cópia de segurança não pode depender de quem publicou por último.
# GitHub Actions também roda FORA da Supabase, que é o que se quer de um backup:
# se a conta da Supabase for perdida, o robô que faz a cópia não vai junto.
#
# O minuto 12 evita a hora cheia (medido neste repo: agendar na hora cheia
# atrasa de 2 a 3 horas) e a madrugada evita disputar banda com os robôs do dia.
#
# DOMINGO leva `--semanal`: inclui o histórico de métrica, que é grande e quase
# todo recoletável, e por isso não vale copiar todo dia.
on:
  # AGENDAMENTO NA VPS (coletor/vps/robos.cron): este workflow só roda por disparo manual, como retaguarda.
```

por:

```yaml
name: Cópia de segurança do banco

# ⚠️ RETAGUARDA MANUAL, SÓ ATÉ O CORTE DA SAÍDA DO SUPABASE.
#
# A cópia de TODO DIA roda na VPS: coletor/vps/robos.cron (06h12 UTC, 03h12 em Campinas) chama
# coletor/vps/copia-do-banco.sh, que roda o MESMO guardar-copia-do-banco.mjs (domingo com --semanal, dia 1º
# confere a cópia de ontem). Este workflow só existe para disparo manual enquanto o banco é o Supabase.
#
# ⚠️ POR QUE ELE PARA NO CORTE
# Depois do corte o banco é o Postgres da API (contêiner api-db na VPS), que NÃO publica porta: um runner do
# GitHub não chega nele, e abrir porta pública num banco para um backup é trocar um risco por outro. A cópia
# da VPS passa a ler o Postgres novo (COPIA_DB_SENHA em /etc/robos.env; ops/vps/api-db/LEIA-ME.md). Se este
# workflow rodasse depois do corte, copiaria o Supabase VELHO e, como o upload sobrescreve pelo nome
# (override-name-exist), trocaria a cópia boa do dia por dado parado. Por isso, no corte, o dono liga a
# variável do repositório SAIU_DO_SUPABASE=sim (gh variable set SAIU_DO_SUPABASE --body sim) e a primeira
# etapa abaixo recusa. O Plano 8 apaga este arquivo junto com os segredos do Supabase.
#
# O minuto 12 da VPS evita a hora cheia e a madrugada evita disputar banda com os robôs do dia. DOMINGO leva
# `--semanal`: inclui o histórico de métrica, que é grande e quase todo recoletável.
on:
  # AGENDAMENTO NA VPS (coletor/vps/robos.cron): este workflow só roda por disparo manual, como retaguarda.
```

Em `.github/workflows/copia-do-banco.yml`, troque:

```yaml
    timeout-minutes: 60
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v6
```

por:

```yaml
    timeout-minutes: 60
    steps:
      - name: Recusar depois do corte
        if: vars.SAIU_DO_SUPABASE == 'sim'
        run: |
          echo "::error::Saímos do Supabase: a cópia roda só na VPS (coletor/vps/robos.cron) e lê o Postgres da API. Este workflow copiaria dado velho por cima da cópia boa do dia."
          exit 1
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v6
```

- [ ] **Step 4: Rodar e ver passar**

Run:
```bash
node --test coletor/lib/fonte-pg.test.mjs
bash coletor/vps/copia-do-banco.teste.sh
node --check coletor/guardar-copia-do-banco.mjs && node --check coletor/restaurar-copia.mjs && bash -n coletor/vps/copia-do-banco.sh && echo sintaxe-ok
python3 -c 'import yaml; yaml.safe_load(open(".github/workflows/copia-do-banco.yml"))' && echo yaml-ok
```
Expected: `# pass 4`, `# fail 0`; `TUDO OK`; `sintaxe-ok`; `yaml-ok`.

- [ ] **Step 5: Provar o papel `copia` no Postgres do pré-voo**

Run (na raiz; o banco `t11copia` é descartado no fim):
```bash
docker exec -i pg-plano4 psql -U postgres -q -c "create database t11copia"
docker exec -i pg-plano4 psql -U postgres -d t11copia -q -c "create table sessoes (id text, token_hash text); create table robos_execucoes (id bigserial primary key, robo text not null, disparado_em timestamptz not null default now(), status_code int, ok boolean, resposta text, conferido_em timestamptz); create table accounts (id int, access_token text);"
docker exec -i pg-plano4 psql -U postgres -d t11copia < ops/vps/api-db/papel-copia.sql; echo "sem senha: $?"
SENHA_COPIA=abcdef0123456789 docker exec -i -e SENHA_COPIA pg-plano4 psql -U postgres -d t11copia -q < ops/vps/api-db/papel-copia.sql; echo "com senha: $?"
SENHA_COPIA=abcdef0123456789 docker exec -i -e SENHA_COPIA pg-plano4 psql -U postgres -d t11copia -q < ops/vps/api-db/papel-copia.sql; echo "reaplicado: $?"
docker exec -i -e PGPASSWORD=abcdef0123456789 pg-plano4 psql -h 127.0.0.1 -U copia -d t11copia -tA -c "select count(*) from accounts" -c "insert into robos_execucoes (robo, ok, status_code, resposta, conferido_em) values ('guardar-copia-do-banco', true, 200, 'ok', now())"
docker exec -i -e PGPASSWORD=abcdef0123456789 pg-plano4 psql -h 127.0.0.1 -U copia -d t11copia -c "select * from sessoes" 2>&1 | head -1
docker exec -i -e PGPASSWORD=abcdef0123456789 pg-plano4 psql -h 127.0.0.1 -U copia -d t11copia -c "delete from robos_execucoes" 2>&1 | head -1
docker exec -i pg-plano4 psql -U postgres -q -c "drop database t11copia" -c "drop role copia"
```
Expected: `ERROR:  falta SENHA_COPIA no ambiente` e `sem senha: 3`; `com senha: 0`; `reaplicado: 0`; `0` e `INSERT 0 1`; `ERROR:  permission denied for table sessoes`; `ERROR:  permission denied for table robos_execucoes`.

- [ ] **Step 6: Ensaio da cópia contra o Postgres do pré-voo**

Precisa de `coletor/node_modules` (`(cd coletor && npm ci --silent)` se faltar). `COLETOR_ENV=/dev/null` impede que um `coletor/.env` com credencial real seja lido; `--ensaio` para antes de qualquer chamada ao Zoho.

Run:
```bash
docker exec -i pg-plano4 psql -U postgres -q -c "create database t11e"
docker exec -i pg-plano4 psql -U postgres -d t11e -q -c "create table usuarios (id uuid primary key, email text, senha_hash text); insert into usuarios values ('aaaaaaaa-0000-0000-0000-000000000001', 'a@x', 'hash-de-teste'); create table sessoes (id text, token_hash text); insert into sessoes values ('s', 'h'); create table accounts (id uuid, name text, access_token text); insert into accounts values ('aaaaaaaa-0000-0000-0000-000000000002', 'Móveis', 'EAAG-x'); create table robos_execucoes (id bigserial primary key, robo text not null, disparado_em timestamptz not null default now(), status_code int, ok boolean, resposta text, conferido_em timestamptz);"
COLETOR_ENV=/dev/null COPIA_DATABASE_URL='postgres://postgres:x@localhost:58432/t11e' node coletor/guardar-copia-do-banco.mjs --ensaio; echo "saida=$?"
docker exec -i pg-plano4 psql -U postgres -q -c "drop database t11e"
```
Expected: `4 tabelas no banco · 2 nesta cópia · 2 fora de propósito`, `accounts 1 linhas`, `usuarios 1 linhas`, `2 tabelas tiveram a credencial removida do arquivo`, a frase final do ensaio ("Nada foi enviado, e nenhuma pasta foi criada no Zoho") e `saida=0`.

- [ ] **Step 7: Commit**

```bash
git add coletor/lib/fonte-pg.mjs coletor/lib/fonte-pg.test.mjs coletor/guardar-copia-do-banco.mjs coletor/restaurar-copia.mjs coletor/vps/copia-do-banco.sh coletor/vps/copia-do-banco.teste.sh coletor/vps/LEIA-ME-ROBOS.txt ops/vps/api-db/papel-copia.sql ops/vps/api-db/LEIA-ME.md .github/workflows/copia-do-banco.yml
git commit -m "feat(coletor): cópia de segurança lê o Postgres da API depois do corte (papel copia, VPS e retaguarda do GitHub)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Montagem final: `api worker conferir`, nomes × `robos_esperados`, notas de implantação

**Revisor:** padrão.

- `cmd/api/conferir.go`: o que as tarefas presumem do schema de PRODUÇÃO restaurado (colunas por tabela, índices únicos usados em `ON CONFLICT` e funções SQL chamadas), exposto como `api worker conferir` para o ensaio do Plano 2 depois do restore. Várias dessas tabelas são anteriores às migrations e só têm DDL no banco real; os testes deste plano usaram DDL reescrita a partir do levantamento.
- `TestNomesCasamComRobosEsperados`: aplica a regra da view `robos_saude` (prefixo mais longo de `robos_esperados`, lista das migrations) a cada nome de tarefa e às linhas por conta, e prova que nenhum nome cai no esperado errado.
- `TestTarefasDeProducao` (já existente) confere a lista inteira: 20 tarefas, nome × agenda = a tabela "Os 24 jobs".
- `NOTAS-DA-IMPLANTACAO.md` ganha a seção do Plano 4 (variáveis, ensaio, parada, lista de `cron.unschedule` do dia da virada, premissas).

**Files:**
- Create: `api/cmd/api/conferir.go`
- Modify: `api/cmd/api/worker.go`
- Test (modify): `api/cmd/api/worker_test.go`
- Modify: `docs/migracao-go/NOTAS-DA-IMPLANTACAO.md`

**Interfaces:**
- Consumes: `tarefas`, `rodarWorker`, `producao` (Tasks 1 a 10); `testebanco.Novo`.
- Produces:
  - `conferirSchema(ctx, p *pgxpool.Pool) ([]string, error)` (cada item = premissa quebrada); `colunasDoWorker`, `unicosDoWorker`, `funcoesDoWorker`.
  - Subcomando `api worker conferir` (saída 0 = schema confere; 1 = lista o que falta).

- [ ] **Step 1: Escrever os testes que falham**

Em `api/cmd/api/worker_test.go`, troque:

```go
	"maps"
	"testing"
```

por:

```go
	"maps"
	"slices"
	"strings"
	"testing"
```

Acrescente ao fim de `api/cmd/api/worker_test.go`:

```go
func TestConferirSchema(t *testing.T) {
	p := testebanco.Novo(t)
	ctx := context.Background()
	for _, sql := range []string{
		`create table daily_snapshots (account_id uuid, captured_at date, followers_count int, gained int, lost int, unique (captured_at, account_id))`,
		`create table campaigns (campaign_id text, account_id uuid)`,
		`create function vessel_rd_payload(p_origem_id bigint) returns jsonb language sql as 'select null::jsonb'`,
	} {
		if _, err := p.Exec(ctx, sql); err != nil {
			t.Fatal(err)
		}
	}
	faltam, err := conferirSchema(ctx, p)
	if err != nil {
		t.Fatal(err)
	}
	tem := func(item string) bool { return slices.Contains(faltam, item) }
	for _, quer := range []string{"coluna campaigns.objective", "único campaigns(campaign_id)", "função pegar_da_fila(text,integer,integer,boolean,text[])",
		"coluna accounts.id"} {
		if !tem(quer) {
			t.Errorf("faltou acusar %q", quer)
		}
	}
	for _, nao := range []string{"coluna daily_snapshots.gained", "único daily_snapshots(account_id,captured_at)", "função vessel_rd_payload(bigint)",
		"coluna robos_execucoes.conferido_em"} {
		if tem(nao) {
			t.Errorf("acusou o que existe: %q", nao)
		}
	}
	if got := rodarWorker(ctx, p, config.Config{}, []string{"conferir"}); got != 1 {
		t.Fatalf("schema incompleto = saída 1: %d", got)
	}
}

// Os nomes que a tela "saúde dos robôs" enxerga: robos_saude atribui cada execução ao robô esperado de
// prefixo MAIS LONGO (migration 2026-09-22-vigia-dos-robos-cada-um-no-seu-teto.sql). Um nome trocado
// faz o robô sumir da tela ou cair no teto do vizinho (meta-hora dentro de coletar-dados: alarme falso).
func TestNomesCasamComRobosEsperados(t *testing.T) {
	esperados := []string{"coletar-dados", "conteudo-hora-h", "conteudo-espelho", "enviar-push-vendas", "enviar-push-saldo", "auditar-dados",
		"meta-hora", "enviar-relatorio-hora", "meta-hora-retentativa-00h", "vessel-espelhar-lista", "vessel-log-de-carocos", "estoque-do-site",
		"vessel-triagem-da-vaga", "enviar-mensagem-abandono", "enviar-push-frota", "guardar-copia-do-banco"}
	dono := func(robo string) string {
		melhor := ""
		for _, e := range esperados {
			if strings.HasPrefix(robo, e) && len(e) > len(melhor) {
				melhor = e
			}
		}
		return melhor
	}
	quer := map[string]string{
		"coletar-dados-07h · Mantova Móveis": "coletar-dados", "coletar-dados-2359 · Vessel": "coletar-dados",
		"meta-hora": "meta-hora", "meta-hora-retentativa-00h": "meta-hora-retentativa-00h",
		"enviar-push-saldo-08h": "enviar-push-saldo", "enviar-push-vendas-07h": "enviar-push-vendas", "enviar-push-vendas-22h": "enviar-push-vendas",
		"enviar-push-frota": "enviar-push-frota", "auditar-dados": "auditar-dados", "conteudo-hora-h": "conteudo-hora-h",
		"conteudo-espelho": "conteudo-espelho", "enviar-relatorio-hora": "enviar-relatorio-hora", "enviar-mensagem-abandono": "enviar-mensagem-abandono",
		// sem ficha em robos_esperados (eram SQL puro, ou são novas): não podem cair na de outro robô
		"conferir-robos": "", "faxina-da-api": "", "abandono-de-checkout": "", "vessel-rd-station": "", "fabrica-purga": "",
	}
	for robo, e := range quer {
		if got := dono(robo); got != e {
			t.Errorf("%q cai em %q, esperava %q", robo, got, e)
		}
	}
	for nome := range producao { // toda tarefa de produção tem o destino na tabela acima (exceto as variantes por conta)
		if _, ok := quer[nome]; !ok && !strings.HasPrefix(nome, "coletar-dados-") {
			t.Errorf("tarefa %q sem destino conferido na tela de saúde", nome)
		}
	}
}
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `go test -count=1 ./cmd/api`
Expected: FAIL. Primeiras falhas, como saíram no ensaio deste plano: `undefined: conferirSchema`

- [ ] **Step 3: Implementar**

Crie `api/cmd/api/conferir.go`:

```go
package main

import (
	"context"
	"slices"
	"sort"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"
)

// O que as tarefas do worker presumem do schema de PRODUÇÃO restaurado (várias tabelas são anteriores
// às migrations e não têm DDL no repositório). `api worker conferir` roda isto no ensaio do Plano 2,
// depois do restore: cada item listado é uma premissa quebrada (coluna, índice único usado em
// ON CONFLICT ou função SQL que o worker chama).
var colunasDoWorker = map[string]string{
	"accounts":               "id,name,instagram_id,ad_account_id,access_token",
	"daily_snapshots":        "account_id,captured_at,followers_count,gained,lost",
	"followers_leituras":     "account_id,followers_count,origem,lido_em",
	"engagement_snapshots":   "account_id,captured_at,period_days,likes,comments,saves,shares,reach,views,total_interactions,accounts_engaged,profile_views",
	"content_snapshots":      "account_id,captured_at,period_days,posts_count,reels_count,stories_count,story_shares,story_replies,story_reach,story_interactions,story_navigation,story_profile_visits,story_follows,story_nav_forward,story_nav_back,story_nav_exit,story_nav_next",
	"data_integrity_checks":  "checked_date,account_id,check_name,status,detail",
	"campaigns":              "campaign_id,account_id,name,objective,status,synced_at",
	"ads":                    "ad_id,campaign_id,account_id,name,status,destino_link,synced_at",
	"campaign_adsets":        "adset_id,campaign_id,account_id,destination_type,optimization_goal,synced_at",
	"campaign_insights":      "campaign_id,account_id,captured_at,period_days,spend,impressions,clicks,reach,post_engagement,likes,comments,shares,saves,conversas,cadastros,compras,visitas",
	"campaign_insights_hora": "campaign_id,account_id,dia,hora,gasto_acumulado,conversas_acumuladas,cliques_acumulados,gasto_hora,conversas_hora,cliques_hora",
	"perfil_visitas_hora":    "account_id,dia,hora,visitas_acumuladas,visitas_hora",
	"ad_insights_hora":       "ad_id,campaign_id,account_id,dia,hora,gasto_acumulado,cliques_acumulados,gasto_hora,cliques_hora",
	"push_subs":              "endpoint,p256dh,auth,user_id",
	"push_preferencias":      "user_id,tipo,ativo",
	"profiles":               "id,email,role,is_superadmin,features,permissions",
	"acessos_pessoas":        "id,nome,profile_id,email_corporativo",
	"frota_veiculos":         "id,nome,pessoa_id,situacao",
	"frota_checklist_itens":  "cadencia,ordem,ativo",
	"frota_checklist_config": "dia_semanal,semana_mensal,dia_mensal",
	"frota_checklist":        "veiculo_id,feita_em,cadencias",
	"frota_uso":              "veiculo_id,pessoa_id,tipo,volta_em",
	"frota_requisicoes":      "id,veiculo_id,situacao,retirada_prevista,destino,motivo_decisao,encerrada_motivo,pessoa_id,pessoa_nome,criada_por",
	"conteudo_pecas":         "id,account_id,titulo,formato,status,legenda,hashtags,publicar_em,publicado_em,avisado_em,ig_media_id,ig_permalink,responsavel",
	"conteudo_eventos":       "peca_id,acao,detalhe",
	"conteudo_casamentos":    "peca_id,ig_media_id,ig_permalink,ig_timestamp,ig_caption,ig_thumb,pontuacao,situacao,motivo",
	"conteudo_metricas":      "peca_id,capturado_em,curtidas,comentarios,alcance,salvamentos,compartilhamentos,visualizacoes,bruto",
	"checkout_abandono":      "token,status",
	"contatos_sem_mensagem":  "telefone",
	"vessel_rd_envios":       "id,origem_id,pessoa_id,status,tentativas,http_status,resposta,atualizado_em",
	"vessel_pessoas":         "id,email",
	"fabrica_campanhas":      "id,created_at,fechada_em,purgado_em",
	"fabrica_criativos":      "campanha_id,storage_path,purgado_em",
	"robos_execucoes":        "robo,disparado_em,status_code,ok,resposta,conferido_em",
}

// unicosDoWorker: os alvos de ON CONFLICT (sem o índice único o Postgres recusa o upsert).
var unicosDoWorker = []string{
	"daily_snapshots(account_id,captured_at)", "engagement_snapshots(account_id,captured_at,period_days)",
	"content_snapshots(account_id,captured_at,period_days)", "campaigns(campaign_id)", "ads(ad_id)", "campaign_adsets(adset_id)",
	"campaign_insights(campaign_id,account_id,captured_at,period_days)", "campaign_insights_hora(campaign_id,account_id,dia,hora)",
	"perfil_visitas_hora(account_id,dia,hora)", "ad_insights_hora(ad_id,account_id,dia,hora)",
	"conteudo_casamentos(peca_id,ig_media_id)", "conteudo_metricas(peca_id,capturado_em)",
}

// funcoesDoWorker: as funções SQL de produção que o worker chama (assinatura de to_regprocedure).
var funcoesDoWorker = []string{
	"mover_abandonados_para_fila(integer,integer)", "pegar_para_mensagem(integer,integer,boolean,text[],integer)",
	"pegar_da_fila(text,integer,integer,boolean,text[])", "marcar_mensagem(text,text,text,bigint)",
	"marcar_da_fila(text,text,text,text,bigint)", "devolver_mensagem(text,boolean)", "devolver_da_fila(text,text,boolean)",
	"liberar_mensagens_travadas()", "liberar_travadas_da_fila()", "agendar_followups(integer,integer)",
	"avaliar_trava_cruzada(text,integer,text,text)", "conteudo_reivindicar_hora_h()", "vessel_rd_payload(bigint)",
}

// conferirSchema devolve as premissas quebradas, em ordem (vazio = tudo certo).
func conferirSchema(ctx context.Context, p *pgxpool.Pool) ([]string, error) {
	var faltam []string
	for tabela, cols := range colunasDoWorker {
		var existentes []string
		linhas, err := p.Query(ctx, `select column_name::text from information_schema.columns
			where table_schema = current_schema() and table_name = $1::text`, tabela)
		if err != nil {
			return nil, err
		}
		for linhas.Next() {
			var c string
			if err := linhas.Scan(&c); err != nil {
				linhas.Close()
				return nil, err
			}
			existentes = append(existentes, c)
		}
		linhas.Close()
		for _, c := range strings.Split(cols, ",") {
			if !slices.Contains(existentes, c) {
				faltam = append(faltam, "coluna "+tabela+"."+c)
			}
		}
	}
	for _, u := range unicosDoWorker {
		tabela, cols, _ := strings.Cut(strings.TrimSuffix(u, ")"), "(")
		quer := strings.Split(cols, ",")
		sort.Strings(quer)
		var tem bool
		if err := p.QueryRow(ctx, `select exists (
			select 1 from pg_index x join pg_class t on t.oid = x.indrelid
			 where t.relname = $1::text and t.relnamespace = current_schema()::regnamespace and x.indisunique
			   and (select array_agg(a.attname::text order by a.attname) from unnest(x.indkey) k
			          join pg_attribute a on a.attrelid = t.oid and a.attnum = k) = $2::text[])`, tabela, quer).Scan(&tem); err != nil {
			return nil, err
		}
		if !tem {
			faltam = append(faltam, "único "+u)
		}
	}
	for _, f := range funcoesDoWorker {
		var tem bool
		if err := p.QueryRow(ctx, `select to_regprocedure(current_schema() || '.' || $1::text) is not null`, f).Scan(&tem); err != nil {
			return nil, err
		}
		if !tem {
			faltam = append(faltam, "função "+f)
		}
	}
	sort.Strings(faltam)
	return faltam, nil
}
```

Em `api/cmd/api/worker.go`, troque:

```go
//	api worker rodar <tarefa> [--forcar] executa UMA vez agora, com trava e linha em robos_execucoes
```

por:

```go
//	api worker rodar <tarefa> [--forcar] executa UMA vez agora, com trava e linha em robos_execucoes
//	api worker conferir                 lista as premissas de schema quebradas (ensaio, depois do restore)
```

Em `api/cmd/api/worker.go`, troque:

```go
	case "rodar":
		if len(args) < 2 {
```

por:

```go
	case "conferir":
		faltam, err := conferirSchema(ctx, p)
		if err != nil {
			fmt.Fprintln(os.Stderr, "conferir:", err)
			return 1
		}
		for _, f := range faltam {
			fmt.Println(f)
		}
		if len(faltam) > 0 {
			fmt.Fprintf(os.Stderr, "%d premissa(s) do worker quebrada(s) no schema\n", len(faltam))
			return 1
		}
		fmt.Println("schema confere com o que o worker presume")
		return 0
	case "rodar":
		if len(args) < 2 {
```

Acrescente ao fim de `docs/migracao-go/NOTAS-DA-IMPLANTACAO.md`:

```markdown
## Plano 4 — worker e tarefas agendadas

### O que o worker roda
- 20 tarefas com o nome de PRODUÇÃO em `robos_execucoes` (a tela de saúde casa `robos_esperados` pelo prefixo mais longo): `abandono-de-checkout`, `auditar-dados`, `coletar-dados-07h`/`-12h`/`-18h`/`-2359` (uma linha POR CONTA: `coletar-dados-07h · <conta>`), `conferir-robos`, `conteudo-espelho`, `conteudo-hora-h`, `enviar-mensagem-abandono`, `enviar-push-frota`, `enviar-push-saldo-08h`, `enviar-push-vendas-07h`/`-22h`, `enviar-relatorio-hora`, `fabrica-purga`, `faxina-da-api` (nova), `meta-hora`, `meta-hora-retentativa-00h`, `vessel-rd-station`. `api worker listar` mostra agenda (UTC), prazo e se está desligada.
- Agenda em UTC, igual à de `cron.job`; execução perdida com o worker fora do ar NÃO é recuperada. Cada execução roda sob `pg_try_advisory_lock(0x57524B52, hashtext(<trava>))` numa conexão própria: dois workers ao mesmo tempo (deploy sobreposto) nunca executam a mesma tarefa juntos; o segundo pula e só loga.
- Envio para fora (push, WhatsApp, Chatwoot) passa pelo livro `envios_feitos` (migração 00003): repetir a tarefa na mesma janela não reenvia. Envio ambíguo (caiu depois de mandar) fica reservado: a mensagem pode ter saído, então não sai de novo.
- Execução manual SÓ pela linha de comando: `docker compose exec worker api worker rodar <tarefa>` (saída 0 ok, 1 falhou, 2 uso errado ou desligada sem `--forcar`, 3 pulada pela trava). Não existe rota HTTP que execute tarefa; `GET /saude` e `GET /metricas` (em `WORKER_ADDR`) só leem.

### Variáveis de ambiente novas (worker)
- `WORKER_ADDR` (opcional, ex.: `0.0.0.0:8081` dentro da rede do compose; nunca publicado no host): `GET /saude` (200 agendando, 503 parado) e `GET /metricas`. Healthcheck do compose: `api worker saude` (não abre o banco).
- `WORKER_TAREFAS_DESLIGADAS` agora DESLIGA SEM DESREGISTRAR: a tarefa não é agendada, mas `api worker rodar <t> --forcar` ainda roda. Nome desconhecido continua fazendo o worker recusar subir.
- `CORE_API_TOKEN`: recomendado um consumidor PRÓPRIO do worker no core (o limite da Meta é 120/min por consumidor, `vessel-core-go@e8a06e8c3` `internal/config/config.go:172`); o worker anda a 600 ms por chamada (~100/min), e as telas ao vivo da API deixam de disputar o mesmo balde.
- `RD_STATION_TOKEN` (vessel-rd-station), `ARQUIVOS_DIR` (padrão `/var/lib/api/arquivos`; o worker monta o MESMO volume da API, porque `fabrica-purga` apaga de `<ARQUIVOS_DIR>/fabrica-criativos/`), `ALERT_WEBHOOK_URL` (opcional: coleta zerada e auditoria), `ZAPI_INSTANCE_ID`, `ZAPI_INSTANCE_TOKEN`, `ZAPI_TOKEN` (relatório por hora no grupo de WhatsApp).
- Mensagens de abandono: as MESMAS variáveis da edge `enviar-mensagem-abandono` (`CHATWOOT_URL`, `CHATWOOT_CONTA_ID`, `CHATWOOT_CAIXA_ID`, `CHATWOOT_API_TOKEN`, `CHATWOOT_BOT_SECRET`, `ENVIO_MODO`, `ENVIO_MODO_INICIO`, `ENVIO_MODO_PEDIDO`, `ENVIO_MODO_FOLLOWUP`, `ENVIO_LIMITE_POR_RODADA`, `ENVIO_SO_PARA`, `ENVIO_ATRASO_MINUTOS`, `*_MAX_HORAS`, `FOLLOWUP_APOS_HORAS`, `TEMPLATE_*`, `TEMPLATE_IDIOMA`, `LINK_BASE`, `ABANDONO_TRAVA_CRUZADA`, `RESERVAR_AVISO_CHATWOOT`), copiadas dos segredos da edge por quem tem acesso. Modo vazio = `desligado`; `ENVIO_ATRASO_MINUTOS` que não é número reprova a configuração (na edge virava `NaN`, sem validação).
- Todos os valores secretos acima entram em `Segredos()`: são trocados por `***` antes de qualquer linha de `robos_execucoes` e de log.

### Subida, ensaio e parada
- O worker NÃO migra mais (substitui a nota "os dois executam goose.Up" do Plano 3): `api migrar` (ou o `api`) antes; sem `envios_feitos`/`robos_execucoes` o worker recusa subir.
- Depois do restore do ensaio: `api worker conferir` lista cada coluna, índice único (ON CONFLICT) ou função SQL que o worker presume e o banco restaurado não tem. Lista vazia = pode seguir.
- ENSAIO MANDA MENSAGEM DE VERDADE: com o banco de produção restaurado, o worker mandaria template de WhatsApp a CLIENTES (abandono), mensagem ao grupo (relatório), push e conversões à RD. No ensaio, `WORKER_TAREFAS_DESLIGADAS=*` sempre; rodar uma tarefa de cada vez com `api worker rodar <t> --forcar` só as que não falam com fora, ou com as credenciais externas vazias (a tarefa falha alto, sem enviar).
- Parada: o worker espera 30 s as tarefas em andamento, cancela, e espera mais 15 s. No compose do worker: `stop_grace_period: 60s` (o padrão de 10 s do Docker mataria no meio de um envio).

### Dia da virada (Plano 8)
- No MESMO momento em que o worker sobe com as tarefas ligadas, desagendar no Supabase (`select cron.unschedule('<nome>')`) os jobs que ele substitui: `abandono-de-checkout`, `coletar-dados-07h`, `coletar-dados-12h`, `coletar-dados-18h`, `coletar-dados-2359`, `coletar-dados-hora`, `coletar-dados-hora-retentativa-00h`, `conferir-robos`, `conteudo-espelho`, `conteudo-hora-h`, `enviar-mensagem-abandono`, `enviar-push-frota`, `enviar-relatorio-hora`, `fabrica-purga-diaria`, `integridade-diaria`, `push-saldo-08h`, `vessel-rd-station` (e os `push-vendas-07h`/`-22h` do Plano 3). Sem isso, push, WhatsApp e mensagem de cliente saem DUAS vezes.
- Ficam no Supabase até o Plano 6: `enviar-pdf-checklist`, `vessel-espelhar-lista`, `vessel-lembretes`, `vessel-log-de-carocos`, `vessel-triagem-da-vaga` (Zoho/Vessel). `estoque-do-site` e `teste-auditar-agora` já estão desligados e não voltam.
- Z-API: conferir a instância CONECTADA (QR lido) antes da virada; instância desconectada é a causa provável dos 47% de falha do `enviar-relatorio-hora` hoje, e no worker ela aparece como falha com `Z-API send-text: <status>` na tela de saúde.
- Front: `functions.invoke('avisar-decisao-de-reserva')` vira `POST /api/avisar-decisao-de-reserva` (Plano 7; mesmo corpo `{requisicaoId}`, mesmo portão `frota.aprovar`/`ver`). O `location /api/` genérico do nginx já cobre.
- Cópia de segurança: papel `copia` e `COPIA_DB_SENHA` (ver `ops/vps/api-db/LEIA-ME.md`) e `gh variable set SAIU_DO_SUPABASE --body sim` para a retaguarda do GitHub recusar.

### Premissas a conferir antes do corte
- O contrato do core foi relido em `vessel-core-go@e8a06e8c3` (rota `POST /api/interno/meta/graph`, `services/core/cmd/core/meta.go:40-42`; allow-list de GET `internal/meta/http.go:109`; `parametros` ≤ 64 KB `http.go:116,196`; 401/403/429 `internal/auth/consumidor.go:123,135,139,144`). Todos os caminhos que o worker pede cabem na allow-list; se o core em produção for outro commit, reconferir.
- Tabelas anteriores às migrations (sem DDL no repositório): a lista de colunas e índices está em `api/cmd/api/conferir.go`; `api worker conferir` é a conferência.
- `run_integrity_checks` agora é Go (`auditar-dados`): apaga em `data_integrity_checks` só as linhas dos PRÓPRIOS checks do dia; a função SQL antiga apagava também as do `coletar-dados`.

### Pendências do Plano 3 resolvidas aqui
- Purga de `webhooks_recebidos` (> 30 dias): `faxina-da-api`, junto com sessões vencidas e `envios_feitos` > 45 dias.
- Os 3 coletores Meta de cron: portados. O disparo imediato do abandono (`DISPARO_IMEDIATO`) continua NÃO portado: o `enviar-mensagem-abandono` de minuto em minuto cobre (atraso de até 1 min).
```

- [ ] **Step 4: Rodar e ver passar**

Run: `gofmt -l . && go vet ./... && go test -race -count=1 ./cmd/api/ -v 2>&1 | grep -E -- '^(ok|FAIL|--- FAIL|--- SKIP)'`
Expected: `gofmt` não lista nada; só linhas `ok`, nenhuma `FAIL` nem `--- SKIP`.

- [ ] **Step 5: Commit**

```bash
git add api/cmd/api/conferir.go api/cmd/api/worker.go api/cmd/api/worker_test.go docs/migracao-go/NOTAS-DA-IMPLANTACAO.md
git commit -m "feat(api): api worker conferir, nomes × robos_esperados e notas de implantação do Plano 4

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Verificação final do Plano 4

- [ ] `docker stop pg-plano4` e depois `make -C api teste PG_PORTA=58432` → todos os pacotes `ok`.
- [ ] Executados × pulados com banco: subir o `pg-plano4` de novo (comando do pré-voo) e `cd api && go test -count=1 -v ./... 2>&1 | grep -c -- '--- SKIP'` → `0`.
- [ ] `cd api && gofmt -l . && go vet ./...` → nada listado.
- [ ] `node --test coletor/lib/fonte-pg.test.mjs && bash coletor/vps/copia-do-banco.teste.sh` → `# fail 0` e `TUDO OK`.
- [ ] `grep -rn "graph.facebook.com\|api.z-api.io\|api.rd.services" api/internal --include='*.go' | grep -v _test.go` → só `meta/ao_vivo.go` (Plano 3), a URL padrão da Z-API em `meta/relatorio_hora.go` e a da RD em `vessel/rd.go`; nenhuma chamada direta à Graph.
- [ ] `git diff origin/main --stat -- supabase/ src/` → vazio (as edges e o front continuam no ar até a virada).
- [ ] `docker stop pg-plano4`.
- [ ] Revisão final do branch (whole-branch review) por um revisor opus, com o foco em: dois workers ao mesmo tempo (trava e livro), segredo em erro externo (Z-API, RD, Chatwoot), mensagem a cliente (abandono) e ao grupo (relatório), rota `POST /avisar-decisao-de-reserva`, e o papel `copia`.

## Rulings do plano

- Ruling: Os 3 coletores Meta de cron (`coletar-dados` nas 4 rodadas, `coletar-dados-hora` com a retentativa das 00h e `conteudo-espelho`) entram aqui, pelo core; a foto do perfil que `coletar-dados` sobe ao Storage fica para o Plano 6 — o Storage novo (disco + rota pública) é do Plano 6, e a foto não alimenta número nenhum — custo: até o Plano 6 a foto da conta não se atualiza sozinha quando muda no Instagram.
- Ruling: `enviar-relatorio-hora` (47% de falha) é reproduzido com os mesmos textos, mas o SINAL é corrigido: falha de leitura do banco, que a edge devolvia como 200, vira aviso no grupo E erro da tarefa; recusa da Z-API continua erro visível, sem o token — esconder o defeito manteria o robô verde na tela de saúde; a causa provável (instância da Z-API desconectada) é operacional e vai para as NOTAS — custo: se a causa for outra, a taxa de falha continua alta, agora sem mentir.
- Ruling: `meta-hora` mantém "nada coletado" como erro (a edge devolvia 500), inclusive às 00:05 de São Paulo, quando ainda não há gasto; a retentativa das 00h30 cobre — é o comportamento que a tela de saúde e o alarme de conta sem coleta já conhecem — custo: uma linha vermelha por dia às 00h05 continua aparecendo, como hoje.
- Ruling: `vessel-rd-station` é PORTADO, não descartado: mesma fila `vessel_rd_envios` e mesmas regras de `vessel_rd_enviar()` (10 min para reenviar `enviado` parado, `sem_email` ↔ `pendente`, até 5 tentativas, lote de 50 com `for update skip locked`); o payload continua vindo de `vessel_rd_payload` no banco, só o HTTP sai do `pg_net` — os cadastros de Beauty Session viram conversão na RD que o comercial usa, e descartar perderia leads em silêncio no corte — custo: mais uma integração externa no worker; sem `RD_STATION_TOKEN` a tarefa falha visível (desligável com `WORKER_TAREFAS_DESLIGADAS=vessel-rd-station`).
- Ruling: `enviar-pdf-checklist` (Zoho WorkDrive), `vessel-espelhar-lista`, `vessel-lembretes`, `vessel-log-de-carocos` e `vessel-triagem-da-vaga` vão para o Plano 6 e ficam no pg_cron do Supabase até lá — todos dependem de Zoho (`acessos_conexoes`) e do Storage, que o Plano 6 porta juntos — custo: o Plano 6 precisa entrar antes da virada, senão esses 5 param no corte.
- Ruling: Cada tarefa grava com o nome de PRODUÇÃO de `robos_execucoes` (`enviar-push-saldo-08h`, `auditar-dados`, `fabrica-purga`, `meta-hora`, `coletar-dados-07h · <conta>`...), não com o nome do job; as 3 tarefas que eram SQL puro (`abandono-de-checkout`, `conferir-robos`, `vessel-rd-station`) passam a gravar linha também — a tela casa `robos_esperados` por prefixo e um nome novo deixaria robô esperado "sem execução"; gravar as de SQL dá visibilidade que não havia — custo: ~3.200 linhas a mais por dia em `robos_execucoes` (purgadas em 60 dias).
- Ruling: Agenda com `robfig/cron/v3` em UTC (já no `go.mod`), sem recuperar execução perdida, e trava `pg_try_advisory_lock(0x57524B52, hashtext(trava))` de DUAS chaves numa conexão própria, fora do pool, com `Trava` compartilhável (as 4 rodadas de `coletar-dados` dividem uma; `meta-hora` e a retentativa, outra) — igual ao pg_cron (UTC, sem catch-up); a forma de duas chaves (`objsubid = 2`) nunca colide com as 26 funções SQL de produção que usam a chave única `hashtext(...)`; conexão própria evita esgotar o pool segurando travas — custo: uma conexão extra por tarefa em andamento (no pico, ~6).
- Ruling: `Agendador.Rodar` passa a devolver o erro da tarefa (o do Plano 3 devolvia `nil`) e o teste do push de vendas do Plano 3 muda para esperar isso — `api worker rodar` precisa do erro para sair com 1 — custo: nenhum chamador dependia do `nil` (só aquele teste).
- Ruling: Execução pulada pela trava não grava linha em `robos_execucoes` (só log e `Metrica.Puladas`) — uma linha "pulada" pareceria execução e esconderia "ATRASADO" na tela — custo: sobreposição constante só aparece no log e em `/metricas`.
- Ruling: Desligar por ambiente reaproveita `WORKER_TAREFAS_DESLIGADAS` do Plano 3 (mesma variável, `*` = todas, nome desconhecido recusa subir via `worker.Filtrar`), mas a tarefa desligada fica REGISTRADA e não agendada, e `api worker rodar <t> --forcar` a executa — uma variável só no ambiente; o ensaio precisa rodar uma tarefa à mão sem ligar o agendamento — custo: o comentário "NÃO registra" do Plano 3 muda de sentido (atualizado no `config.go` e nas NOTAS).
- Ruling: Execução manual só pela linha de comando (`api worker rodar`); `GET /saude` e `GET /metricas` só leem e ficam na rede interna (`WORKER_ADDR`) — rota HTTP que dispara envio a cliente seria superfície de ataque sem ganho — custo: rodar à mão exige `docker compose exec` na VPS.
- Ruling: Desligamento gracioso: para de agendar, espera 30 s (`Graca`), cancela o contexto das tarefas e espera mais 15 s; o compose do worker precisa de `stop_grace_period: 60s` — um envio interrompido vira "ambíguo" (fica reservado) em vez de duplicar, e 60 s cobre os 45 s com folga — custo: deploy do worker até 1 min mais lento.
- Ruling: O worker NÃO migra mais: confere `envios_feitos` e `robos_execucoes` e recusa subir sem elas; quem migra é o `api` (ou `api migrar`) — `api` e `worker` subindo juntos disputariam o goose, que aqui não tem trava — custo: subir o worker antes da primeira migração falha, com a mensagem dizendo o que fazer.
- Ruling: Livro `envios_feitos` (migração 00003): reserva a chave ANTES de enviar; recusa clara do serviço libera; envio ambíguo (caiu depois de mandar) mantém a reserva, então WhatsApp e template nunca repetem; push libera em qualquer não-2xx (o aparelho junta notificações pela `tag`) — "uma repetição nunca reenvia" sem depender da memória do processo, e dois workers no deploy batem na mesma chave — custo: um envio ambíguo que na verdade NÃO saiu não é refeito na mesma janela (perde-se um aviso, nunca se duplica).
- Ruling: `resposta` em `robos_execucoes` é "ok" no sucesso e o erro passado por `worker.Limpar` (troca por `***` todo valor de `Segredos()` com 8 caracteres ou mais), cortado em 500 caracteres, com `conferido_em = now()` — mesmo corte do `left(...,500)` de `conferir_robos`; a limpeza é a última barreira, além de cada cliente já não pôr URL nem token no erro — custo: um segredo com menos de 8 caracteres não seria mascarado (nenhum dos atuais é).
- Ruling: Em `coletar-dados`, erro de BANCO numa conta aborta aquela conta (linha `ok = false` dela) e a rodada segue nas outras; erro da Graph num pedaço vira "degradado", como na edge — gravar metade das tabelas de uma conta sem avisar é pior do que não gravar — custo: uma falha de banco perde a rodada daquela conta (a próxima rodada refaz).
- Ruling: Falha de uma conta, peça, aparelho ou linha vira ERRO da tarefa (a edge respondia 200 com a lista de falhas dentro), e os outros itens continuam — "falha visível": a tela de saúde só enxerga `ok` — custo: um único item ruim pinta o robô de vermelho até ser resolvido.
- Ruling: O cliente do core do worker anda com `RitmoMeta = 600 ms` (~100 chamadas/min) e as NOTAS recomendam um `CORE_API_TOKEN` próprio do worker — o core limita 120/min por consumidor nas rotas da Meta (`vessel-core-go@e8a06e8c3`, `internal/config/config.go:172`); sem ritmo, `coletar-dados` estoura o limite e as telas ao vivo da API levam 429 junto — custo: uma rodada com muitas contas leva minutos (6 min por conta, 50 min a rodada).
- Ruling: A seleção de contas de `coletar-dados` é a de `disparar_coletor` (`instagram_id` e `access_token` preenchidos, ordem por nome), mesmo com o token agora no core — mesmo conjunto de contas que produção coleta hoje — custo: conta conectada só no core, sem token na tabela, não é coletada até alguém preencher.
- Ruling: Contas em SÉRIE, com 6 min por conta e 50 min por rodada — o `disparar_coletor` abria uma chamada por conta, todas ao mesmo tempo, mas o limite do core é por consumidor: em paralelo só se trocaria espera por 429 — custo: com mais de ~8 contas grandes a rodada pode estourar 50 min (a conta que sobrar fica com a linha de erro de prazo).
- Ruling: Uma leitura de `/{ig}/media` serve os 5 períodos (a edge pedia a mesma lista 5 vezes) — mesmas contagens, 4 chamadas a menos por conta dentro do limite do core — custo: nenhum (a lista é a mesma; testado com os vetores da edge).
- Ruling: `run_integrity_checks` é reescrita em Go dentro de `auditar-dados` (mesmos 7 checks, mesmo SQL, numa transação), apagando do dia só as linhas dos PRÓPRIOS checks; a função SQL antiga fica no banco, sem chamador — a spec §8 pede a reescrita, e a versão SQL apagava as linhas `coleta_zerada`/`bruto_seguidores_parado` que o `coletar-dados` grava — custo: duas versões da regra convivem até o Plano 8 apagar a SQL.
- Ruling: `ALERT_WEBHOOK_URL` é opcional; vazio = só a linha em `data_integrity_checks`, que a tela já mostra — a edge usava o mesmo segredo opcional — custo: sem a variável ninguém é avisado fora da tela.
- Ruling: `conferir-robos` vira manutenção: as linhas já nascem com `conferido_em`, então a tarefa só fecha as antigas sem conferência (texto de produção, sem acento) e apaga as de mais de 60 dias; o alerta de robô que não roda continua sendo a view `robos_saude` — sem `pg_net` não há resposta assíncrona para conferir, e a spec §8.1 pede manter o alerta, que mora na view — custo: nenhum.
- Ruling: Tarefa nova `faxina-da-api` (05h41 UTC): sessões vencidas, `webhooks_recebidos` com mais de 30 dias e `envios_feitos` com mais de 45 — a purga de `webhooks_recebidos` era pendência do Plano 3 e as tabelas novas não podem crescer sem fim — custo: uma linha diária a mais em `robos_execucoes` (fora de `robos_esperados`).
- Ruling: `fabrica-purga` apaga do disco (`<ARQUIVOS_DIR>/fabrica-criativos/<storage_path>`), recusa caminho que não seja `filepath.IsLocal`, trata "não existe" como já apagado e marca `purgado_em` na transação — spec §7 (Storage no disco, mesmo caminho do objeto no bucket); `storage_path` vem do banco e não pode escapar da pasta — custo: o worker precisa montar o mesmo volume da API.
- Ruling: `conteudo-hora-h` porta só o aviso: a publicação automática da edge NÃO é portada (desligada: `ESCOPOS_DE_PUBLICACAO_LIBERADOS = false`, sem App Review), e a VAPID é conferida ANTES de reivindicar as peças — reivindicar sem conseguir avisar queimaria a peça (o `UPDATE ... RETURNING` não volta atrás) — custo: quando o App Review sair, a publicação automática é trabalho novo.
- Ruling: Toda tarefa de push confere a VAPID antes de qualquer leitura externa ou reserva, e o boot do worker continua avisando VAPID inválida (o aviso do Plano 3 passou para `rodarWorker`) — VAPID errada é configuração; gastar chamadas ao core e reservar envios para depois falhar só sujaria o livro — custo: nenhum.
- Ruling: `POST /avisar-decisao-de-reserva` vira rota da API (não tarefa), com o mesmo portão (`frota.aprovar`/`ver`), as mesmas respostas da edge e deduplicação por `<requisição>:<situação>` no livro; o corpo é só o id — clique duplo não pode mandar dois pushes, e aceitar texto do cliente seria push arbitrário para o celular de qualquer um — custo: o front só passa a usar no Plano 7 (até lá, a edge segue).
- Ruling: O texto de evento "Aviso enviado para N aparelho(s)" do `conteudo-hora-h` conta enviados + repetidos — com o livro, uma repetição devolve "repetido" para quem já recebeu, e contar só os novos diria "0 aparelhos" de uma peça avisada — custo: nenhum.
- Ruling: O disparo imediato do abandono (`DISPARO_IMEDIATO`, no fim do webhook) NÃO é portado; `enviar-mensagem-abandono` de minuto em minuto cobre — a edge o tinha desligado e ele duplicaria a lógica da rodada — custo: até ~1 min a mais entre o abandono e a mensagem.
- Ruling: `enviar-mensagem-abandono` porta `rodada-completa.js`/`rodada-da-fila.js` sem mudar regra (modos, limites, janela, trava cruzada, reserva do aviso no Chatwoot); prazo de 4 min por rodada, com o item pendurado virando `falhou` e o resto voltando à fila sem gastar tentativa; `ENVIO_ATRASO_MINUTOS` que não é número reprova a configuração — mensagem a cliente não pode mudar de regra na migração, e o prazo evita que a rodada se sobreponha à do minuto seguinte (que seria pulada) — custo: uma rodada lenta manda menos naquele minuto.
- Ruling: O pré-voo mescla `origin/main` na branch (merge limpo, conferido com `git merge-tree` contra `7adcdd89`) antes da Task 1 — o Plano 3 foi mesclado com 2 commits de revisão que esta worktree não tem (`WORKER_TAREFAS_DESLIGADAS`/`Filtrar`, `CORE_URL` só https, prazo do bling-proxy) e com `coletor/vps/`, que a Task 11 edita; os trechos "troque" deste plano foram escritos e ensaiados sobre esse estado — custo: se a `main` andar de novo nesses arquivos, algum "troque" não casa e o executor para.
- Ruling: A cópia de segurança passa a ler o Postgres novo NA VPS (`COPIA_DB_SENHA` → `copia-do-banco.sh` monta `COPIA_DATABASE_URL` pelo IP do `api-db` na `api_net`, papel `copia` só leitura + INSERT em `robos_execucoes`), e o YAML do GitHub vira retaguarda até o corte, com a trava `vars.SAIU_DO_SUPABASE`, e some no Plano 8 — o agendamento já está na VPS (`coletor/vps/robos.cron`, 06h12); o `api-db` não publica porta e abrir porta de banco para um runner é risco maior que o ganho; depois do corte o YAML copiaria o Supabase velho por cima da cópia boa do dia (`override-name-exist`) — custo: se o dono esquecer a variável no corte, um disparo manual estraga a cópia daquele dia (a semanal e a mensal anteriores ficam).
- Ruling: As tabelas novas da API ficam fora da cópia (`sessoes`, `goose_db_version`, `webhooks_recebidos`, `envios_feitos`), `usuarios.senha_hash` sai sem o valor e o papel `copia` nem lê `sessoes` — mesma regra de "credencial não vai para o drive compartilhado" que a cópia já aplica — custo: restaurar da cópia exige `api migrar` e todos entram de novo.
- Ruling: Tabelas anteriores às migrations (sem DDL no repositório) são usadas com cast explícito em todo parâmetro e conferidas por `api worker conferir` (colunas, índices de `ON CONFLICT`, funções SQL), rodado no ensaio depois do restore — os testes usam DDL reescrita a partir do levantamento; a conferência contra o banco real fecha a lacuna — custo: premissa errada só aparece no ensaio, não no `go test`.
- Ruling: Datas: "hoje" e "hora" das tarefas são de São Paulo (`time/tzdata` embutido), exceto onde a edge usava UTC (`conteudo-espelho` mede por data UTC) — fidelidade ao que já está gravado; mudar o fuso de uma série quebraria a continuidade dos gráficos — custo: duas convenções convivem (documentadas no código).
- Ruling: Textos e números que chegam a pessoas (moeda com espaço não separável, milhar, corte em unidades UTF-16, `\s` do JS, emoji) seguem o JS byte a byte, com vetores gerados pelos próprios módulos `_shared` no Node 22 — mensagem de WhatsApp e push não pode mudar na migração — custo: funções de formatação próprias (`internal/texto`) em vez de `golang.org/x/text`.
- Ruling: Constantes fixas da edge ficam como estão (conta Vessel e "Grupo de teste z-api" no relatório por hora) — são recortes que o dono escolheu e a tela usa os mesmos; virar configuração é mudança de produto — custo: trocar o grupo exige deploy.
- Ruling: `ZAPI_INSTANCE_ID` e `ZAPI_INSTANCE_TOKEN` vão no caminho da URL da Z-API, então entram em `Segredos()` com o `ZAPI_TOKEN`, e todo erro de rede (`*url.Error`, que carrega a URL) é desembrulhado antes de virar texto (Z-API; RD com `?api_key=`) — senão o token sairia em `robos_execucoes` e no log — custo: o erro de rede perde a URL (o nome do passo fica).
- Ruling: Lacuna de contrato do core: relido em `vessel-core-go@e8a06e8c3` (o Plano 3 leu `168882e29`, ainda Laravel; o core virou Go no PR #242): rota `POST /api/interno/meta/graph` (`services/core/cmd/core/meta.go:40-42`), 120/min por consumidor (`internal/config/config.go:172`), 401/403/429 (`internal/auth/consumidor.go:123,135,139,144`), allow-list de GET (`internal/meta/http.go:109`, checada em `:187`) e `parametros` até 64 KB (`http.go:116,196`); todo caminho que o worker pede casa a allow-list (`permitidoNoCore` em `coleta_test.go`) — o contrato mudou de implementação, não de forma — custo: se a produção rodar outro commit, reconferir antes do corte (está nas NOTAS).

## Cobertura da spec e o que vem depois

**Coberto por este plano:**
- §8 (mapa das edges), linhas de destino Go-worker: `coletar-dados`, `coletar-dados-hora`, `conteudo-espelho` (Graph via core; Tasks 3, 6, 7, 5); `auditar-dados` + `run_integrity_checks` reescrita (Task 6); `enviar-mensagem-abandono` (Tasks 9 e 10), `enviar-relatorio-hora` (Task 8), `enviar-push-saldo` (Task 3), `enviar-push-frota` e `avisar-decisao-de-reserva` (Task 4); `conteudo-hora-h` (Task 5); `fabrica-purga` (Task 2).
- §8.1 (agendamentos): os 24 jobs de produção estão mapeados na tabela "Os 24 jobs" — 17 viram tarefa aqui (mais `faxina-da-api`, nova), 2 já eram do Plano 3, 5 vão para o Plano 6; `estoque-do-site` e `teste-auditar-agora` não são portados; `vessel-rd-station` decidido (portado); `guardar-copia-do-banco` muda de alvo (Task 11). Trava por tarefa, `robos_execucoes`, tempo limite e o alerta de `conferir-robos` mantido (Tasks 1, 2 e 12).
- §7 (Storage no disco): `fabrica-purga` já apaga do volume (`ARQUIVOS_DIR`).
- §11 (segurança): segredos só em variáveis de ambiente, mascarados em toda saída; rota nova atrás do portão da edge; nenhuma rota que execute tarefa.
- §12 (operação): `/saude` e `/metricas` do worker, `api worker saude` para healthcheck, backup diário lendo o Postgres novo com papel próprio.

**Fica para depois:**
- **Plano 5 (domínios):** unificar `PodeModulo` com `Pode`; decidir se as funções SQL do abandono (`checkout_*`) viram Go.
- **Plano 6 (Storage, Zoho e Vessel):** `enviar-pdf-checklist`, `vessel-espelhar-lista`, `vessel-lembretes`, `vessel-log-de-carocos`, `vessel-triagem-da-vaga` e a foto do perfil do `coletar-dados`; usam `worker.Tarefa`, o livro `envios_feitos`, `webpush.Entregar`, `texto` e `meta.GET`/`Paginas` deste plano. Precisa entrar antes da virada.
- **Plano 7 (front e robôs):** o front troca `functions.invoke('avisar-decisao-de-reserva')` por `POST /api/avisar-decisao-de-reserva`.
- **Plano 8 (virada):** compose do worker (`stop_grace_period: 60s`, `WORKER_ADDR` interno, healthcheck `api worker saude`, volume de `ARQUIVOS_DIR`); `cron.unschedule` dos 17 jobs no mesmo momento em que o worker liga as tarefas (lista nas NOTAS); `WORKER_TAREFAS_DESLIGADAS` vazia; `gh variable set SAIU_DO_SUPABASE --body sim`, papel `copia` e `COPIA_DB_SENHA`; apagar `.github/workflows/copia-do-banco.yml` e a função SQL `run_integrity_checks`.
