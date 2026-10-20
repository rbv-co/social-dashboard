# Leitores e escritores finais das 3 tabelas a eliminar (plano 05 C, 20/10/2026)

Método: `grep` só no `social-dashboard` (worktree da `origin/main` + as mudanças deste plano; `vessel/apps/central` é cópia velha e ficou de fora), `pg_class.relacl`/`pg_attribute.attacl`/`pg_stat_user_tables`/dependências no api-db em `begin read only` (`ssh op`, `docker exec api-db psql`). Nada gravado.

## Estado no api-db
| Tabela | Linhas | Escritas desde a restauração (ins/upd/del) | Dependências |
|---|---|---|---|
| `bling_tokens` | 1 | 1/0/0 (só a carga da restauração) | nenhuma (sem view, função, trigger, policy; sem FK) |
| `estoque_do_site_estado` | 2 | 2/0/0 (carga da restauração) | nenhuma |
| `vessel_envios_ao_meta` | 0 | 0/0/0 | só a FK de saída `pedido_id → vessel_pedidos` (cai com a tabela) |

`idx_scan` = 0 nas três; `seq_scan` 112/86/100 em 20/10 18:09Z e +1 cada em 18:12Z (o `pg_dump` do backup deste plano): quem varre é só `copia` e backup.

## GRANTs (relacl lido em produção)
| Papel | bling_tokens | estoque_do_site_estado | vessel_envios_ao_meta |
|---|---|---|---|
| `api_app` (dono) | tudo | tudo | tudo |
| `copia` | SELECT (a tabela inteira, inclusive `client_secret`) | SELECT | SELECT |
| `anon`, `authenticated` | INSERT/UPDATE/DELETE/TRUNCATE (inertes: sem SELECT, sem policy) | nada | INSERT/UPDATE/DELETE/TRUNCATE (inertes) |
| `service_role` | INSERT/UPDATE/DELETE/TRUNCATE (inerte) | INSERT/UPDATE/DELETE/TRUNCATE (inerte) | INSERT/UPDATE/DELETE/TRUNCATE (inerte) |
| `robo_selo`, `robo_pedidos_vessel` | SELECT só em `(id, access_token)` — **sem uso desde este plano** | nada | nada |
| `pdv_leitura` | **nada** (confirmado: `papel-pdv.sql:45-46` só dá `vessel_pecas` e `vessel_lotes`) | nada | nada |

## Leitores e escritores no código (arquivo:linha)
**Coletor (VPS):** nenhum lê nem escreve mais. Antes deste plano, 5 robôs liam `bling_tokens` só no caminho antigo (`CORE_BLING_PROXY` desligada; ligada em produção desde antes de 20/10): `coletor/classificar-material-dos-lotes.mjs:52`, `classificar-material-vessel.mjs:57`, `trazer-vendedores-do-bling.mjs:33`, `trazer-pedidos-do-bling.mjs:73`, `fotos-do-selo-do-bling.mjs:187` — removidos; `coletor/lib/bling-token.mjs` agora lança sem a flag; teste de regressão em `lib/bling-token.test.mjs` proíbe `bling_tokens`/`oauth/token` nesses 5.
**Cópia diária:** `coletor/guardar-copia-do-banco.mjs:107` (`bling_tokens`: valores trocados por marca) e agora `:108` (`estoque_do_site_estado.valor`); a tabela some da cópia quando for eliminada. Papel `copia`: `ops/vps/api-db/papel-copia.sql:24` (`grant select on all tables`).
**API Go (`api/`):** nenhuma referência de código (`grep` em `api/internal`, `api/cmd`); só fotos de teste do esquema do Supabase (`api/internal/testebanco/testdata/producao_{colunas,restricoes}.tsv`, `.../esquema/01-tabelas-5-05.sql:5` "bling_tokens fica fora", `api/internal/autz/catalogo-policies-producao.json:564`). Não são lidas contra o banco vivo.
**GRANTs em arquivo:** `ops/vps/api-db/papel-robo-selo.sql:38` e `papel-robo-pedidos-vessel.sql:38` (removidos); `ops/vps/api-db/papel-robos.teste.sh` (agora prova que os dois NÃO leem `access_token`).
**Edges do Supabase (`supabase/functions/`, banco antigo, parado desde 19/10; não tocam o api-db):** `bling-proxy/index.ts:85,112`, `vessel-registrar-garantia/index.ts:97,118`, `vessel-espelhar-lista/index.ts:316,331`, `estoque-do-site/index.ts:57,62,74`, `enviar-push-vendas/index.ts:65`. Se ainda estiverem publicadas no Supabase, leem o `bling_tokens` DE LÁ (outro banco, mesmo risco de renovador latente já registrado em `02-evidencias/token-bling.md`); é assunto do desligamento do Supabase, não do drop no api-db.
**Histórico (não executa):** `db/migrations/2026-09-25-estoque-do-site-a-cada-minuto.sql:16-24`, `db/migrations/2026-09-17-vessel-pedidos.sql:117-130`, `coletor/aplicar-vessel-pedidos.mjs:23` (só lista as tabelas para conferir o esquema).
**`vessel_envios_ao_meta`:** nenhum escritor em lugar nenhum (o CAPI é do Core: `meta_eventos`).
