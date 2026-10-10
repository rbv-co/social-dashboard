# Resultado do levantamento de produção (2026-10-09)

Rodado com `docs/migracao-go/levantar.sh` contra o Postgres do Supabase (`kounqtdoioootxqegkij`), **somente leitura** (`begin read only` em volta de cada consulta). Só contagens, nomes e agendas; nenhum segredo, e-mail ou corpo de função está neste arquivo. Os CSVs completos ficam em `docs/migracao-go/levantamento/` (fora do git).

## Resumo (o que muda na spec)

| Item | Spec assumia | Produção tem |
|---|---|---|
| Tamanho do banco | desconhecido | **197 MB** (dump/restore leva minutos: a janela do big-bang é curta) |
| Policies RLS | 228 (migrations) | **276 em 144 tabelas** (37 `restrictive`). 76 só existem em produção; 17 só nas migrations. **A verdade é produção**: `catalogo-policies-producao.json` |
| Funções do schema `public` | "centenas" | **308** (260 `security definer`) |
| Triggers | 44 | **63 em 27 tabelas** |
| Views | — | 1 |
| Agendamentos pg_cron | ~20 | **24, todos ativos** (lista abaixo) |
| Edge functions | 49 | **51** no repo (as 2 extras de `social-dashboard-token` já estão no `main`: `vessel-baixar-cartao`, `vessel-cartoes-trigger`; a segunda roda em produção) |
| Usuários (Auth) | desconhecido | **26**, todos e-mail + senha (provedor `email`), 0 banidos, 0 e-mails duplicados, 0 sem confirmação, 0 `banned_until = infinity` |
| Perfis | — | **24** (`permissions` é `jsonb` objeto em todos), **5 desativados** (`profiles.disabled = true`) |
| Extensões | `pgcrypto`, `pg_trgm`, `unaccent`, `uuid-ossp` | `pg_cron`, `pg_net`, `pg_stat_statements`, `pgcrypto`, `plpgsql`, `supabase_vault`, `uuid-ossp`. **Sem `pg_trgm` nem `unaccent`**; `pg_cron`/`pg_net`/`supabase_vault` não são levadas |
| Storage | 7 buckets | **11 buckets, ≈ 640 MB** (tabela abaixo) |
| Segredos das edges | — | **52 nomes** (lista abaixo, só nomes) |

Consequências diretas:

- **5 contas desativadas em `profiles.disabled`** e nenhum `banned_until`: a checagem de `profiles.disabled` no login e na sessão (corrigida na revisão final) é obrigatória; sem ela essas 5 contas entrariam.
- **26 usuários, 197 MB, 4,4 mil sessões Supabase**: depois do corte todos precisam entrar de novo (as sessões do GoTrue não migram). Ninguém precisa trocar a senha (hash bcrypt copiado).
- O catálogo das migrations (217) **não presta como especificação**: usar o de produção (276). A policy dinâmica `so_contas_permitidas` já vem expandida em `pg_policies`.

## Agendamentos reais (pg_cron, UTC)

Todos chamam `disparar_robo(...)`/`disparar_coletor(...)` (que fazem `pg_net` para uma edge) ou funções SQL.

| Job | Agenda | Alvo |
|---|---|---|
| `abandono-de-checkout` | `* * * * *` | SQL `mover_abandonados_para_fila` |
| `coletar-dados-07h` / `-12h` / `-18h` | `0 10`, `0 15`, `0 21` | edge `coletar-dados` (1 rodada por conta de anúncio) |
| `coletar-dados-2359` | `59 2 * * *` | edge `coletar-dados` |
| `coletar-dados-hora` | `5 * * * *` | edge `coletar-dados-hora` |
| `coletar-dados-hora-retentativa-00h` | `30 3 * * *` | edge `coletar-dados-hora` |
| `conferir-robos` | `2-59/5 * * * *` | SQL `conferir_robos` |
| `conteudo-espelho` | `*/30 * * * *` | edge `conteudo-espelho` |
| `conteudo-hora-h` | `*/5 * * * *` | edge `conteudo-hora-h` |
| `enviar-mensagem-abandono` | `* * * * *` | edge `enviar-mensagem-abandono` |
| `enviar-pdf-checklist` | `*/10 * * * *` | edge `enviar-pdf-checklist` |
| `enviar-push-frota` | `30 10 * * 1-5` | edge `enviar-push-frota` |
| `enviar-relatorio-hora` | `10 * * * *` | edge `enviar-relatorio-hora` |
| `fabrica-purga-diaria` | `17 4 * * *` | edge `fabrica-purga` |
| `integridade-diaria` | `30 2 * * *` | edge `auditar-dados` |
| `push-saldo-08h` | `0 11 * * *` | edge `enviar-push-saldo` |
| `push-vendas-07h` / `-22h` | `0 10`, `0 1` | edge `enviar-push-vendas` |
| `vessel-espelhar-lista` | `*/3 * * * *` | edge `vessel-espelhar-lista` |
| `vessel-lembretes` | `0 12 * * *` | edge `vessel-lembretes` |
| `vessel-log-de-carocos` | `4,14,24,34,44,54 * * * *` | edge `vessel-log-de-carocos` |
| `vessel-rd-station` | `* * * * *` | **SQL `vessel_rd_enviar`** (sem edge: a integração RD Station vive no banco) |
| `vessel-triagem-da-vaga` | `* * * * *` | edge `vessel-triagem-da-vaga` |

Diferenças para a spec §8.1:

- **Faltavam na spec:** `coletar-dados-hora` (`5 * * * *`), `coletar-dados-hora-retentativa-00h` (`30 3`), `enviar-push-frota` (`30 10 * * 1-5`), `enviar-relatorio-hora` (`10 * * * *`), `vessel-espelhar-lista` (`*/3`), `vessel-lembretes` (`0 12`).
- **Não está mais em produção:** `estoque-do-site` (`* * * * *` nas migrations). Ele ainda tem 18 mil execuções nos últimos 30 dias, mas a última é de **2026-10-08**: foi desligado ontem, provavelmente porque o core assumiu o estoque. **Não portar.** `teste-auditar-agora` também não existe em produção.
- **`vessel-rd-station`** é SQL puro (`vessel_rd_enviar`, que fala com a RD Station via `pg_net`): decidir portar para o worker ou descartar (pendência aberta da spec).
- Existe um fluxo **fora do pg_cron**: o workflow do GitHub Actions `guardar-copia-do-banco` (13 execuções, 5 falhas, última em 2026-10-06) faz cópia do banco **via Supabase**; precisa ser reescrito para o novo Postgres (`pg_dump` agendado no host).

## Atividade real dos robôs (últimos 30 dias, `robos_execucoes`)

| Robô | Rodadas | Falhas | Obs. |
|---|---|---|---|
| `vessel-triagem-da-vaga` | 19,8 mil | 84 | a cada minuto |
| `enviar-mensagem-abandono` | 14,4 mil | 51 | a cada minuto |
| `vessel-espelhar-lista` (+ `· bling`, `· planilha`) | 14,6 mil (+3,3 mil cada) | 249 | **a parte `planilha` falha 53%** (1.754 de 3.323) |
| `conteudo-hora-h` | 8,5 mil | 297 | |
| `enviar-pdf-checklist` | 4,3 mil | 130 | |
| `vessel-log-de-carocos` | 2,5 mil | 696 | 28% de falha |
| `conteudo-espelho` | 1,4 mil | 36 | |
| `meta-hora` / `-retentativa-00h` | 660 / 22 | 45 / 0 | |
| `enviar-relatorio-hora` | 645 | **305 (47%)** | já falha muito hoje |
| `coletar-dados-{07h,12h,18h,2359}` | 8 contas × ~30 dias cada | 0–3 por conta | |
| `auditar-dados`, `fabrica-purga`, `push-*`, `vessel-lembretes`, `vessel-cartoes-trigger`, `vessel-fotos-trigger` | 17–72 | poucas | `vessel-cartoes-trigger` e `vessel-fotos-trigger` são disparos de GitHub Actions |
| `estoque-do-site` | 18,4 mil | 2,2 mil | parou em 2026-10-08 |

Portar um robô **que já falha muito** exige decidir se se reproduz o comportamento ou se corrige a causa; registrar isso no plano de crons.

## Storage (buckets)

| Bucket | Público | Objetos | Tamanho |
|---|---|---|---|
| `ig-cache` | sim | 407 | 339 MB |
| `fotos-modelo` | sim | 174 | 253 MB |
| `fabrica-criativos` | sim | 84 | 37 MB |
| `arquivos` | não | 4 | 5 MB (limite 50 MB, lista longa de MIME) |
| `vessel-curriculos` | não | 8 | 1,2 MB (limite 5 MB) |
| `profile-pics` | sim | 9 | 0,8 MB |
| `acessos-avatars` | sim | 22 | 79 kB |
| `publico` | sim | 1 | 3 kB |
| `acessos-termos` | não | 0 | 0 |
| `avatars` | sim | 0 | 0 (limite 2 MB, imagens) |
| `conteudo` | não | 0 | 0 (limite 300 MB, imagens e vídeo) |

`ig-cache` e `fotos-modelo` (≈ 590 MB) são **caches regeneráveis** (fotos do Bling e do Instagram): avaliar não migrar e regenerar no destino.

## Segredos das edges (52 nomes, sem valores)

- **Chatwoot (6):** `CHATWOOT_API_TOKEN`, `CHATWOOT_BOT_SECRET`, `CHATWOOT_CAIXA_ID`, `CHATWOOT_CONTA_ID`, `CHATWOOT_URL`, `CHATWOOT_WEBHOOK_SEGREDO`
- **Core (5):** `CORE_API_TOKEN`, `CORE_BLING_PROXY`, `CORE_BLING_TOKEN`, `CORE_META`, `CORE_URL`
- **Shopify (5):** `SHOPIFY_CLIENT_ID`, `SHOPIFY_CLIENT_SECRET`, `SHOPIFY_SHOP`, `SHOPIFY_WEBHOOK_SECRET`, `ORIGEM_DA_LOJA_SHOPIFY`
- **Mensagens e envio (24):** `ENVIO_ATRASO_MINUTOS`, `ENVIO_LIMITE_POR_RODADA`, `ENVIO_MAX_HORAS`, `ENVIO_MODO`, `ENVIO_MODO_FOLLOWUP`, `ENVIO_MODO_INICIO`, `ENVIO_MODO_PEDIDO`, `ENVIO_SO_PARA`, `DISPARO_IMEDIATO`, `RESERVAR_AVISO_CHATWOOT`, `LINK_BASE`, `TEMPLATE_FOLLOWUP`, `TEMPLATE_IDIOMA`, `TEMPLATE_INICIO`, `TEMPLATE_NOME`, `TEMPLATE_PEDIDO`, `TEMPLATE_TEXTO`, `TEMPLATE_TEXTO_FOLLOWUP`, `TEMPLATE_TEXTO_INICIO`, `TEMPLATE_TEXTO_PEDIDO`, `ZAPI_INSTANCE_ID`, `ZAPI_INSTANCE_TOKEN`, `ZAPI_TOKEN`, `ZEPTOMAIL_DE`/`ZEPTOMAIL_TOKEN`
- **GitHub (3):** `GITHUB_PAT_FABRICA`, `GITHUB_PAT_FOTOS`, `GITHUB_REPO`
- **Outros:** `FABRICA_PURGA_SECRET`
- **Do próprio Supabase (somem com a saída):** `SUPABASE_ANON_KEY`, `SUPABASE_DB_URL`, `SUPABASE_JWKS`, `SUPABASE_PUBLISHABLE_KEYS`, `SUPABASE_SECRET_KEYS`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_URL`

**Não estão nos segredos** (o código das edges os lê com `Deno.env.get`, então hoje usam o valor padrão ou o ramo "ausente"): `META_APP_ID`, `META_APP_SECRET`, `ALERT_WEBHOOK_URL`. As chaves de IA (Anthropic/OpenAI) vivem na tabela `segredos_de_cron` (workflow `guardar-chave-ia`), não nos segredos da edge. No novo mundo, os dois grupos viram variáveis de ambiente do worker; as chaves de `segredos_de_cron` precisam ser **rotacionadas e recolocadas por quem as possui**, não copiadas do banco.

## Tabelas

- Sem chave primária (6): `ad_insights_hora`, `campaign_insights_hora`, `perfil_visitas_hora`, `vessel_tentativas_de_presente`, `vessel_tentativas_de_revelar`, `vessel_tentativas_de_transferencia`. O dump/restore funciona, mas a importação precisa de cuidado se for feita linha a linha.
- Maiores (estimativa de linhas): `cron.job_run_details` 126 mil (**não migrar**, é do pg_cron), `robos_execucoes` 111 mil, `campaign_insights` 33 mil, `campaign_insights_hora` 16 mil, `ad_insights_hora` 9,4 mil, `engagement_snapshots` 8,1 mil, `content_snapshots` 8 mil. Tabelas de `auth` (`refresh_tokens` 5,6 mil, `sessions` 4,4 mil, `mfa_amr_claims` 4,4 mil) **não migram**.
- `profiles` tem estas colunas: `id`, `email`, `name`, `role`, `created_at`, `disabled`, `features` (array, modelo antigo), `avatar_url`, `permissions` (jsonb), `allowed_accounts` (array), `is_superadmin`, `escopo_por_equipe`, `precisa_trocar_senha`, `perfil_id`, `permissions_excecao` (jsonb). `role` é `text` (não é enum).

## O que isto muda nos próximos planos

1. **Plano 2 (Postgres + ensaio):** banco de 197 MB torna o ensaio de corte barato e repetível; `pg_dump` do schema `public` + dados, sem `auth`, `storage`, `cron`, `net`, `vault`. Rotinas de cópia diária precisam existir antes da virada.
2. **Catálogo de policies:** usar `catalogo-policies-producao.json` (276) como especificação dos testes de permissão; as 37 `restrictive` são portões de conta e precisam virar regras explícitas.
3. **Funções:** 308 funções, 260 `security definer`: é o maior volume de reescrita e precisa de triagem (lógica de negócio × consulta pura × trigger de integridade), ver `levantamento/02-funções.csv`.
4. **Crons:** portar os 21 que chamam edge + 2 SQL (`abandono-de-checkout`, `conferir-robos`) + decidir `vessel-rd-station`; **não** portar `estoque-do-site`.
5. **Backup:** `guardar-copia-do-banco` e a rotina de restauração (`coletor/restaurar-copia.mjs`) mudam de alvo.
6. **Spec:** atualizar §2 (números), §8.1 (agendas) e §3.2 (extensões) com a tabela de resumo acima.
