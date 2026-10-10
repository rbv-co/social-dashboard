# Sair do Supabase: Postgres próprio e API em Go

Data: 2026-10-09 · Estado: rascunho para revisão · Autor: Claude, com o dono do projeto

## 1. Objetivo e decisões já tomadas

**Objetivo.** Eliminar o Supabase do `social-dashboard` por completo, para não somar complexidade ao `core` (Laravel, dono do espelho do Bling, Shopify e proxy Meta).

Decisões do dono, nesta ordem, e que esta spec não reabre:

1. Saída **completa**: Postgres próprio + API nova **em Go**.
2. **Sem RLS.** A autorização é reescrita em código Go. As 228 policies viram a especificação de comportamento a preservar (testes), não código a portar.
3. Virada em **big-bang**: um único corte, sem convivência por área.
4. Não migrar para MySQL (as policies e funções plpgsql são específicas de Postgres).

Isto **reverte** a decisão anterior ("social-dashboard mantém o Supabase", registrada ao integrar o projeto ao monorepo).

**Critério de sucesso.** O sistema roda sem nenhuma chamada a `*.supabase.co`, sem perda de dados, com as mesmas permissões de hoje, e o Supabase fica desligado após o período de retorno (seção 10).

**Fora de escopo.** Redesenhar telas, mudar regras de negócio, migrar o front de Vue, mover o `coletor/` para fora do GitHub Actions, trocar Bling/Meta/Shopify por outro fornecedor.

## 2. Inventário do que o Supabase faz hoje

> **Atualização 2026-10-09:** o levantamento em produção (`docs/migracao-go/RESULTADO-DO-LEVANTAMENTO.md`) substitui as contagens por grep abaixo. Números reais: banco de **197 MB**, **276 policies** em 144 tabelas (37 `restrictive`), **308 funções** (260 `security definer`), **63 triggers**, **24 crons ativos**, **51 edge functions**, **26 usuários** (todos e-mail+senha), 24 perfis (5 `disabled`), **11 buckets ≈ 640 MB**. A especificação das permissões é o catálogo de produção (`catalogo-policies-producao.json`), não o das migrations.

Contagens por grep (aproximadas, **superadas pela atualização acima**; migrations repetem funções redefinidas):

| Peça | Tamanho |
|---|---|
| Edge functions | 49 (a pasta `social-dashboard-token` tem 2 a mais: `vessel-baixar-cartao`, `vessel-cartoes-trigger`) |
| Banco | 266 migrations, ~163 tabelas, 228 policies, centenas de funções plpgsql, 44 triggers |
| Prefixos de tabela | `vessel_*` 51, `acessos_*` 15, `frota_*` 14, `fabrica_*` 11, `patrimonio_*` 9, `gt_*` 9, `conteudo_*` 9, `bling_*` 6 |
| pg_cron | ~20 agendamentos |
| Auth | 12 arquivos do front usam `supabase.auth` |
| Acesso direto do navegador | 347 `.from()` em 37 arquivos, 43 `.rpc()` em 8 arquivos, 39 `functions.invoke` |
| Storage | 7 buckets usados no código: `acessos-avatars`, `acessos-termos`, `arquivos`, `avatars`, `conteudo`, `fabrica-criativos`, `vessel-curriculos` (a lista completa, incluindo buckets só declarados em migration, sai do levantamento da seção 15) |
| Realtime | não usado |
| Robôs | 103 arquivos de `coletor/` e 29 workflows do GitHub Actions leem/gravam via Supabase |

Consumidores fora do repo que também mudam:

- **vessel-brasil**: páginas públicas chamam ~20 RPCs com a chave anon (`vessel_entrar_na_lista`, `vessel_registrar_cartao`, `vessel_marcar_presenca`, `vessel_candidatar_vaga`, etc.) e a edge `vessel-conta`.
- **Tema Shopify**: `capturacontato.liquid` fala direto com o Supabase.
- **n8n**: workflow `OWv78JhWKGS5x7br` faz POST em `rest/v1/vessel_lista_espera`.
- **PDV (pdv-novo / pdv-backend)**: `pecas-origem.service.ts` lê do Supabase.
- **Webhooks de entrada**: Shopify e Chatwoot apontam para URLs de edge.
- **Chatwoot / core**: edges recebem eventos e usam `CORE_API_TOKEN` (flags do PR #308, desligadas).

## 3. Arquitetura alvo

```
 navegador (Vue, estático no nginx) ─┐
 vessel-brasil (páginas públicas) ───┤
 tema Shopify / n8n / PDV ───────────┼──▶ nginx ──▶ api (Go)  ──▶ Postgres próprio
 Shopify / Chatwoot (webhooks) ──────┤                │   └──▶ volume de arquivos
 coletor / GitHub Actions ───────────┘                ├──▶ core (Bling, Meta, Shopify: proxy e espelho)
                                       worker (Go) ───┤──▶ Zoho, Microsoft, Anthropic, OpenAI, Z-API, GitHub
```

### 3.1 Stack

- Um módulo Go, dois subcomandos do mesmo binário: `api` (HTTP) e `worker` (agendador e filas).
- `net/http` com `chi`; `pgx` v5; `sqlc` para queries tipadas; `goose` para migrations; `slog` para log.
- Nenhum ORM. Nenhum framework de DI.
- Pasta: `api/` na raiz do repo `rbv-co/social-dashboard`, com `internal/<dominio>/` por área (`frota`, `acessos`, `vessel`, `fabrica`, `patrimonio`, `conteudo`, `meta`, `comercial`, `admin`, `auth`, `integracoes`).
- Testes de integração rodam contra Postgres descartável (o repo já tem `db/banco-descartavel.mjs` como precedente).

### 3.2 Postgres próprio

- Postgres 16 ou 17 em container na VPS `op`, rede Docker própria, volume nomeado, **fora** do compose do core e do `db-lavessel`.
- Backup diário com `pg_dump` + WAL opcional, retenção local de 14 dias e cópia fora da máquina; restauração testada antes do corte (padrão já usado no `core-db`).
- Conexão da API com usuário de aplicação sem superuser; um segundo usuário somente leitura para o comparador e relatórios.
- Extensões necessárias (confirmado no levantamento): `pgcrypto`, `uuid-ossp`. Produção **não** usa `pg_trgm` nem `unaccent`. `pg_cron`, `pg_net`, `pg_stat_statements` e `supabase_vault` **não** são levados: o agendador passa para o `worker`.
- `auth.*`, `storage.*` e `realtime.*` do Supabase **não** são migrados como schema. Os dados úteis deles são exportados (seções 4 e 7).

## 4. Autenticação e sessões

- Tabela `usuarios` própria, populada a partir de `auth.users` com `id` (uuid) preservado, e-mail, hash **bcrypt copiado como está** (o GoTrue usa bcrypt), `email_confirmado`, metadados necessários. Assim `profiles.id` e todas as chaves estrangeiras continuam válidas e **ninguém precisa redefinir a senha**.
- Sessão **opaca** no Postgres (`sessoes`: token aleatório de 256 bits guardado como hash, usuário, criada, expira, último uso, origem). O cliente manda `Authorization: Bearer`. Sem JWT, sem refresh. Expiração deslizante; logout revoga a linha.
- Rotas: `POST /auth/entrar`, `POST /auth/sair`, `GET /auth/eu`, convite e troca de senha (e-mail com token de uso único), reset de senha.
- **Entrar como outro usuário** (`entrar-como-usuario`): endpoint admin que cria uma sessão marcada com `impersonador_id`, gravando em `entradas_como_outro_usuario` como hoje. A sessão impersonada nunca renova sozinha.
- **Contas de clientes da Vessel** (`vessel-conta`, hoje RPCs `vessel_conta_*`): mesma tabela de sessões com `tipo = 'cliente'` e escopo restrito às rotas públicas da Vessel. É um mecanismo, dois tipos de sessão.
- **Contas de serviço** (robôs do `coletor`, ex.: `claudecode@rbvcompany.com`): login por e-mail e senha como hoje, ou token de serviço de longa duração em `tokens_de_servico`, revogável. A regra existente de que essa conta **não** é limitada a loja (comentário em `bling-proxy`) vira regra explícita e testada no Go.
- Limite de tentativas de login por IP e por e-mail (hoje herdado do GoTrue).

## 5. Autorização (substitui a RLS)

Princípio: **toda rota passa por um único ponto de decisão** e a política padrão é negar.

- `internal/auth/pode.go`: `Pode(ator, ação, recurso) bool`, onde `ator` traz id, papel, permissões por tela, equipes e `escopo_por_equipe` (o que hoje vive em `profiles`, `equipes`, `equipes_membros`, `canais_grupos_membros`).
- A matriz permissão × tela (migrations `permissao-por-tela`, `2026-08-13-*`) vira dados + testes, **não** `if` espalhado.
- A regra de canais por loja (`_shared/canais-de-venda-permitidos.js`, usada pelo front **e** pelo `bling-proxy`) é portada uma vez para Go e exposta ao front por endpoint (`GET /eu/canais`), eliminando a duplicação entre front e backend.
- Rotas públicas (Vessel, webhooks) são uma lista explícita e curta, cada uma com limite de taxa, validação de entrada e, nos webhooks, HMAC.

**Extração das policies como especificação.** Antes de qualquer regra em Go, a fase 1 gera um catálogo a partir das migrations e do banco de produção (`pg_policies`, `pg_proc`, triggers): para cada tabela, quem lê/insere/altera/apaga e sob qual condição. Esse catálogo vira:

1. a lista de verificação de cobertura (nenhuma policy sem teste ou sem decisão de "descartada, porque X");
2. a base dos **testes de contrato de permissão** (tabela de casos: ator × operação × recurso → permitido/negado), executados contra o Go.

Risco principal desta decisão: uma regra esquecida vira vazamento silencioso ou bloqueio indevido. Por isso a cobertura do catálogo é critério de entrada para a virada (seção 9).

## 6. Dados e funções do banco

- Esquema `public` migrado por `pg_dump --schema-only` limpo (sem `auth`, `storage`, `realtime`, `supabase_*`, `pgsodium`, `vault`) e consolidado em uma migration base do `goose`; as 266 migrations antigas ficam no repo como histórico, não são reexecutadas.
- **Policies e `GRANT`s de role `anon`/`authenticated` são removidos** do esquema novo. O usuário da aplicação acessa tudo; quem decide é o Go.
- **Funções plpgsql**: cada uma cai em uma de três categorias, decidida no levantamento:
  - *Lógica de negócio com efeito colateral* (ex.: `vessel_conta_criar`, `vessel_registrar_como_cliente`, `vessel_decidir_pedido_de_registro`, `disparar_robo`, `tomar_trava`): reescrita em Go dentro de transação. Onde a atomicidade depende do banco (travas, filas com `FOR UPDATE SKIP LOCKED`), fica como query no `sqlc`.
  - *Consulta pura* usada por RPC: vira query `sqlc` no módulo do domínio.
  - *Trigger de integridade* (validação, histórico, `trilha-de-edicoes`): **permanece no banco**, por segurança; só remove-se o que chamava `auth.uid()` (passa a ler a identidade de uma variável de sessão `app.usuario_id` definida pela API em cada transação, para a trilha de auditoria continuar sabendo quem editou).
- `segredos_de_cron` (hoje guarda chaves no banco) é substituída por variáveis de ambiente do `worker`; o conteúdo é rotacionado, não copiado.
- Dados migrados por `pg_dump --data-only` em janela de manutenção (seção 9), com contagem de linhas por tabela e checksum de amostras comparados origem × destino.

## 7. Storage

- Cada bucket (os 7 acima, mais os que o levantamento achar) vira diretório em um volume da VPS (`/var/lib/api/arquivos/<bucket>/...`), mantendo o **mesmo caminho do objeto** para que as referências guardadas nas tabelas continuem válidas.
- Público vs. privado preservado por bucket: `acessos-avatars` e `avatars` públicos via nginx; os demais exigem URL assinada de curta duração emitida pela API após `Pode()`.
- Upload sempre pela API (limite de tamanho e tipo MIME por bucket, extraídos das migrations de `storage.buckets`).
- Script de cópia de todos os objetos antes do corte, repetível (rsync incremental) e verificação por contagem e tamanho. A `faxina-storage.yml` e o `vigia-armazenamento` do coletor passam a operar sobre o volume.

## 8. Mapa das 49 edge functions

Destino: **Core** (já existe no Laravel e a API chama o core), **Go-api** (rota síncrona), **Go-worker** (agendada), **Remover**.

| Edge | Hoje | Destino |
|---|---|---|
| `comparar-metricas`, `probe-fidelidade` | desligadas | Remover |
| `bling-proxy` | front (4 telas) + 6 robôs | Go-api, falando com o **core**; porta a regra de canais por loja |
| `meta-proxy` | front (4 telas) + 24 chamadas de robôs | Go-api, falando com o **core** (proxy Meta) |
| `estoque-do-site` (1/min) | cron | Go-worker (lê estoque do core, grava na Shopify) |
| `enviar-push-vendas` | cron 07h e 22h | Go-worker, pedidos via core |
| `coletar-dados`, `coletar-dados-hora`, `contar-collabs`, `serie-novos-dia`, `insights-ao-vivo`, `conteudo-espelho` | cron + front | Go-worker (cron) e Go-api (ao vivo), Graph API via **core** |
| `auditar-dados` | cron | Go-worker (+ `run_integrity_checks` reescrita) |
| `receber-webhook-pedido-shopify`, `receber-webhook-checkout`, `receber-webhook-abandono` | webhook Shopify | **Core** recebe e a API consome (fan-out do core, hoje dormente); onde o core não cobre, Go-api com HMAC |
| `receber-webhook-chatwoot`, `receber-opt-out-chatwoot` | webhook Chatwoot | Go-api com segredo compartilhado |
| `enviar-mensagem-abandono` (1/min), `enviar-relatorio-hora`, `enviar-push-saldo`, `enviar-push-frota`, `avisar-decisao-de-reserva` | cron / front | Go-worker (Chatwoot via API existente, Z-API, Web Push) |
| `conteudo-hora-h` | cron | Go-worker |
| `fabrica-trigger`, `fabrica-apagar`, `fabrica-candidatos`, `fabrica-looks`, `fabrica-publicos`, `fabrica-purga`, `conteudo-trigger`, `vessel-fotos-trigger` | front + cron | Go-api (despacho de GitHub Actions com PAT em env) e Go-worker (purga) |
| `custo-anthropic`, `custo-openai`, `ler-documento`, `sugerir-publico-ia` | front | Go-api (proxy com checagem de permissão) |
| `buscar-lugar` | front | Go-api (Nominatim com cache) |
| `invite-user`, `entrar-como-usuario`, `conferir-senha` | front | Go-api (módulo `auth`) |
| `acessos-oauth`, `acessos-proxy` (1735 linhas) | front | Go-api; OAuth Zoho/Microsoft; tokens em `acessos_conexoes` |
| `enviar-pdf-checklist` (10 min), `vessel-log-de-carocos`, `vessel-triagem-da-vaga` (1/min), `vessel-espelhar-lista` | cron/robôs | Go-worker; Zoho WorkDrive e Zoho Sheet |
| `vessel-conta`, `vessel-registrar-garantia`, `vessel-lembretes` | site público | Go-api (rotas públicas da Vessel) |

Regras de portabilidade:

- Nenhuma edge nova no Core sem passar pelo PR dele. Onde o destino é "core", este projeto só **consome**; se faltar endpoint no core, vira pendência do core, não código novo aqui.
- Webhooks: a troca de URL na Shopify e no Chatwoot é passo do dia da virada, com o endpoint novo já testado em paralelo antes (seção 9).

### 8.1 Agendamentos (pg_cron → worker)

Agenda **real de produção** (24 jobs ativos, UTC; fonte: `cron.job`, ver `docs/migracao-go/RESULTADO-DO-LEVANTAMENTO.md`): `abandono-de-checkout` `* * * * *` · `coletar-dados-07h` `0 10` · `-12h` `0 15` · `-18h` `0 21` · `-2359` `59 2` · `coletar-dados-hora` `5 * * * *` · `coletar-dados-hora-retentativa-00h` `30 3 * * *` · `conferir-robos` `2-59/5 * * * *` · `conteudo-espelho` `*/30 * * * *` · `conteudo-hora-h` `*/5 * * * *` · `enviar-mensagem-abandono` `* * * * *` · `enviar-pdf-checklist` `*/10 * * * *` · `enviar-push-frota` `30 10 * * 1-5` · `enviar-relatorio-hora` `10 * * * *` · `fabrica-purga-diaria` `17 4 * * *` · `integridade-diaria` `30 2 * * *` · `push-saldo-08h` `0 11 * * *` · `push-vendas-07h` `0 10 * * *` · `push-vendas-22h` `0 1 * * *` · `vessel-espelhar-lista` `*/3 * * * *` · `vessel-lembretes` `0 12 * * *` · `vessel-log-de-carocos` `4,14,24,34,44,54 * * * *` · `vessel-rd-station` `* * * * *` · `vessel-triagem-da-vaga` `* * * * *`.

**Não portar:** `estoque-do-site` (nas migrations, mas desligado em produção em 2026-10-08: o core assumiu o estoque) e `teste-auditar-agora` (resíduo de teste). `vessel-rd-station`, `abandono-de-checkout` e `conferir-robos` são **SQL puro** (não chamam edge); `vessel-rd-station` fala com a RD Station pelo banco e exige decisão explícita (portar ou descartar). Há ainda o workflow `guardar-copia-do-banco` (GitHub Actions), que copia o banco via Supabase e muda de alvo.

O `worker` executa cada tarefa sob `pg_try_advisory_lock(hash(nome))` (nunca duas instâncias), registra início/fim/erro em `robos_execucoes` (tabela que a tela "saúde dos robôs" já lê) e tem tempo limite por tarefa. O comportamento de `conferir-robos` (alerta quando um robô não roda) é mantido.

## 9. Plano de virada (big-bang) e ensaio

Como a virada é única, o risco é mitigado por **ensaio repetível** e por um **critério de entrada** objetivo.

**Workstreams** (paralelizáveis, cada um vira seu plano):

1. Infra, Postgres, backup e restauração.
2. Núcleo da API: `auth`, `Pode()`, sessões, log, limite de taxa, cliente do core.
3. Catálogo de policies e funções + testes de contrato de permissão.
4. Módulos de domínio (reescrita de rotas e regras): `frota`, `acessos`, `conteudo`, `admin`, `patrimonio`, `meta-ads`, `gestao-trafego`, `autenticidade`, `comercial`, `vessel` (público), etc.
5. Worker e as tarefas agendadas.
6. Storage.
7. Front: `src/compartilhado/` ganha um cliente `api` no lugar do `supabase-js`; telas trocam `.from/.rpc/.invoke` por chamadas ao cliente. Estimativa de superfície: 347 + 43 + 39 chamadas.
8. Consumidores externos: vessel-brasil, tema Shopify, n8n, PDV, 29 workflows, `coletor/`.
9. Ensaio e virada.

**Ambiente de ensaio.** Cópia do dump de produção, API e worker apontando para ela, front de homologação. O ensaio completo (restore, migração de dados e arquivos, subir serviços, rodar a suíte) é repetido até ser **entediante** e cronometrado; o tempo medido define a janela de manutenção.

**Comparador** (shadow): enquanto o Supabase ainda é a produção, um script reexecuta amostras de leituras reais das telas contra o Go (com a mesma identidade) e compara os resultados. Divergência em leitura é bug do Go ou regra de permissão errada. Escritas são provadas só em homologação.

**Critério de entrada na virada**, todos obrigatórios:

- catálogo de policies 100% coberto (teste ou descarte justificado);
- suíte existente (`npm test`) verde e testes de contrato verdes;
- comparador sem divergência não explicada nas telas de cada papel (admin, gestor, loja, frota, conta de serviço, cliente Vessel);
- ensaio de corte completo executado ao menos 2 vezes, restore verificado;
- cada edge do mapa com destino implementado e testado, ou removida por decisão registrada;
- plano de rollback revisado.

**Dia da virada** (um só `!`-script revisado, rodado pelo dono ou com ok explícito; nada em produção sem aprovação):

1. Janela de manutenção avisada; Supabase em somente leitura (revogar escrita das roles `anon`/`authenticated`/service para congelar).
2. Dump final, restore no Postgres próprio, contagens e checksums, rsync final do storage.
3. Subir `api` e `worker`; rodar fumaça autenticada por papel.
4. Trocar: front (build novo), URLs dos webhooks (Shopify, Chatwoot), segredos de GitHub Actions, `coletor/.env`, vessel-brasil, tema Shopify, n8n, PDV.
5. Observação ativa por algumas horas (erros 5xx, tarefas do worker, webhooks recebidos).

## 10. Rollback

- O projeto Supabase **continua intacto** (somente leitura, sem apagar nada) por **14 dias** após a virada. Nada é desligado antes disso.
- Volta atrás nos primeiros dias: reverter a troca de URLs/segredos/build e reabrir escrita no Supabase. Dados escritos no Postgres novo desde a virada precisam ser reexportados para o Supabase: por isso, as **primeiras 24 h** têm um *dump* a cada hora do Postgres novo e a decisão de "voltar ou seguir" é tomada nesse período.
- Passada a janela, o Supabase é exportado uma última vez (dump + storage guardados com o backup frio) e só então desligado.
- **Cancelamento do plano Supabase só com ok explícito do dono**, depois desse período.

## 11. Segurança

- Segredos só em variáveis de ambiente do container, nunca em tabela nem em repositório. A chave `SUPABASE_SERVICE_ROLE_KEY` e as `anon` somem; a rotação de segredos permanece **decisão adiada do dono** (plano em `PLANO-DE-ROTACAO-DE-SEGREDOS.md`, fora do git), mas os segredos novos da API nascem já fora de tabelas.
- HMAC obrigatório nos webhooks, limite de taxa e CORS restrito às origens do painel e da vessel-brasil nas rotas públicas.
- Sessão guardada como hash; token nunca logado; cabeçalhos de segurança já presentes em `vercel.json` (X-Frame-Options, CSP `frame-ancestors`) replicados no nginx.
- Dados pessoais: `shopify_pedidos` e leituras do PDV têm pendência conhecida de dado pessoal (commit "pdv_leitura ... não funcionou — ver achado"); a regra de acesso é tratada no catálogo de policies e testada, não herdada.
- Antes da virada, rodar a skill/rotina de revisão de segurança sobre a API (autorização por rota, injeção, SSRF nos proxies).

## 12. Operação

- Deploy: container `api` e `worker` na VPS `op` por script com reversão automática, no padrão de `/root/deploy-pdv-com-reversao.sh`. Atenção ao que já mordeu: arquivos com modo 600 criados por git na VPS que o container não lê; `up -d --no-deps` para não reiniciar outros containers; não recriar o banco com operação em andamento.
- O front deixa a Vercel e vai para nginx na VPS (decisão anterior, mantida).
- Observabilidade: logs estruturados, `/saude` e `/pronto`, métricas simples (contagem de erros, duração por rota, atraso de tarefas) e o alerta de robôs já existente.
- Monitoramento do backup diário e restauração testada periodicamente.

## 13. Testes

- **Contrato de permissão** (seção 5): tabela ator × operação × recurso.
- **Integração** por módulo contra Postgres descartável.
- **Comparador** Supabase × Go (seção 9).
- **Suíte atual** (`npm test`, ~dezenas de arquivos em `src/`, `coletor/`, `db/`, `supabase/functions/`): os testes de `db/*.test.mjs` que provam regras de banco (ex.: `transferencia-de-propriedade`, `registro-com-conta`, `trilha-de-edicoes`) são portados como testes de integração Go, pois documentam comportamento real que já quebrou antes. `toda-edge-compila.test.mjs` deixa de existir com as edges.
- Regra de produto do repo mantida: **tela entregue se mede a 375px num navegador de verdade** (`PADRAO-DA-CENTRAL.md`).

## 14. Riscos

| Risco | Mitigação |
|---|---|
| Regra de RLS esquecida (vazamento ou bloqueio) | Catálogo de policies com cobertura obrigatória, testes de contrato, comparador por papel |
| Big-bang sem volta parcial | Ensaios repetidos, Supabase intacto 14 dias, dump horário nas primeiras 24 h |
| Reescrita grande de funções plpgsql | Triggers de integridade ficam no banco; reescreve só a lógica de negócio, com os testes de `db/` portados |
| Terceira stack na casa (Laravel, NestJS no PDV, agora Go) | Aceito pelo dono; API pequena, sem dependências exóticas, mesmo padrão de deploy |
| `coletor/` e 29 workflows dependem do Supabase | Workstream próprio; robôs passam a usar o cliente da API ou conexão direta somente leitura onde fizer sentido |
| Cron em produção diferente do repo | Fase 0 compara `cron.job` de produção com as migrations |
| Duas pessoas publicando/implantando (lição do projeto) | Só se implanta o que está na `main`; comparar o que está no ar antes de sobrescrever |
| Limite do Bling é por conta (3 req/s) | A API **nunca** chama o Bling direto; usa o proxy do core com seu rate gate |

## 15. Levantamento obrigatório (fase 0, antes de qualquer código)

Somente leitura, em produção, com ok do dono:

1. `cron.job` ativos (agenda real).
2. `pg_policies`, `pg_proc`, triggers e views reais (o repo pode estar atrás do banco).
3. Extensões instaladas, tamanho do banco e dos buckets, número de linhas de `auth.users`.
4. Lista dos segredos das edges (`supabase secrets list` **filtrado**; nunca imprimir tudo) para mapear o que vira variável de ambiente.
5. Quais edges recebem tráfego real hoje (logs de invocação dos últimos 30 dias) para confirmar o que pode ser removido.
6. Plano e custo atuais do Supabase.
7. Decisão sobre `vessel-rd-station` e sobre as duas edges extras do `social-dashboard-token`.

## 16. Decisão em aberto para a revisão

- **Onde fica o código Go.** Esta spec assume `api/` dentro de `rbv-co/social-dashboard`. A alternativa é um repo próprio ou o monorepo `rbv-co/vessel`. Mudar isto só altera caminhos e CI, não o desenho.
