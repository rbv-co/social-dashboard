# Runbook: eliminar `bling_tokens`, `estoque_do_site_estado` e `vessel_envios_ao_meta` do api-db (plano 05 C)

**Estado:** preparado, NÃO aplicado. Só com a aprovação do dono (a etapa 2 é irreversível sem o backup). Não é migration do goose (não está em `api/internal/banco/migracoes/`): `api migrar` a aplicaria sozinha no próximo deploy. Aplicar à mão, nesta ordem. Prova do roteiro em banco descartável: `bash ops/vps/api-db/eliminar-3-tabelas/ensaio.sh` (TUDO OK em 20/10/2026).

Por que sai: as 3 tabelas não têm leitor nem escritor vivo (`leitores-finais.md`, nesta pasta). `bling_tokens` é segredo duplicado (o Core é o único dono e renovador do token do Bling), `estoque_do_site_estado` guarda um token da Shopify e `vessel_envios_ao_meta` está vazia (o CAPI é do Core).

## 0. Pré-condições (todas verificáveis; uma falha = não começa)
1. PR do plano 05 mergeado e o coletor da VPS nele: `ssh op 'git -C /opt/robos/social-dashboard log -1 --format=%h'` bate com a `main`. Os 5 robôs do coletor não leem mais `bling_tokens`; `CORE_BLING_PROXY=true` está em `/etc/robos.env` (conferido em 20/10) e é obrigatório.
2. Os robôs que usam o Bling rodaram ≥ 1 vez cada depois disso sem erro: `pedidos-da-vessel` (de hora em hora), `fotos-do-selo` (a cada 5 min), `relatorios-comerciais` (08:52). `tail -n 5 /var/log/robos/pedidos-da-vessel.log` termina ok (`✓`/sem `Erro`).
3. Core com token do Bling válido (os robôs dependem do proxy dele): `curl -s -o /dev/null -w '%{http_code}' https://core.rbvcompany.com/up` = 200.
4. **Passos do dono feitos** (`passos-do-dono.md`, nesta pasta): token da Shopify trocado e cópias antigas do Drive limpas. Sem isto o token velho continua nas cópias, com ou sem a tabela.
5. Aprovação do dono registrada no `COORDENACAO.md`.

## 1. Backup (logo antes, não reaproveite o de ontem)
```bash
ssh op 'umask 077; D=/root/backups-api/plano05-C-3-tabelas-$(date +%Y%m%d-%H%M).dump
  docker exec -i api-db sh -c "pg_dump -Fc -t bling_tokens -t estoque_do_site_estado -t vessel_envios_ao_meta -U \"\$POSTGRES_USER\" \"\$POSTGRES_DB\"" > $D
  ls -l $D; docker exec -i api-db pg_restore -l < $D | grep -c "TABLE DATA"'    # tem de dar 3
```
O arquivo tem tokens: fica em `/root/backups-api` (0600, só root), nunca vai para o Mac nem para o Drive. Existe um de 20/10 (`plano05-C-3-tabelas-20261020.dump`).

## 2. Etapa 1: revogar (reversível em segundos)
```bash
ssh op 'docker exec -i api-db sh -c "psql -X -v ON_ERROR_STOP=1 -U \"\$POSTGRES_USER\" -d \"\$POSTGRES_DB\"" ' < ops/vps/api-db/eliminar-3-tabelas/1-revogar.sql
```
Tira `anon/authenticated/service_role` das 3 e `robo_selo/robo_pedidos_vessel` do `bling_tokens(id, access_token)`. **Não tira o `copia`**: a cópia diária lê todas as tabelas e um `permission denied` derrubaria a cópia inteira (o `copia` sai com a tabela, na etapa 2). Reaplicar `papel-robo-selo.sql` e `papel-robo-pedidos-vessel.sql` (já sem o GRANT de `bling_tokens`) dá o mesmo efeito para esses dois.

**Observar ≥ 24 h** (passa por 24 execuções de `pedidos-da-vessel`, ~290 de `fotos-do-selo`, `relatorios-comerciais` das 08:52 e a cópia das 03:40):
```bash
ssh op 'grep -l "permission denied" /var/log/robos/*.log; grep -h "bling_tokens\|estoque_do_site_estado\|vessel_envios_ao_meta" /var/log/robos/*.log | tail -5'
```
(nunca `docker logs --tail` na VPS.) Qualquer `permission denied` nessas tabelas = alguém ainda depende: **reverta a etapa 1** (seção 5) e descubra quem antes de seguir. Confira também a visão `robos_saude` (nenhum robô novo em falha).

## 3. Etapa 2: eliminar
```bash
ssh op 'docker exec -i api-db sh -c "psql -X -v ON_ERROR_STOP=1 -U \"\$POSTGRES_USER\" -d \"\$POSTGRES_DB\"" ' < ops/vps/api-db/eliminar-3-tabelas/2-eliminar.sql
```
Uma transação, `lock_timeout` 5 s, sem CASCADE. Aborta (sem apagar nada) se `vessel_envios_ao_meta` tiver linha ou se as outras duas ganharam linha desde o backup.

## 4. Verificação
- `select count(*) from pg_tables where tablename in ('bling_tokens','estoque_do_site_estado','vessel_envios_ao_meta')` = 0.
- API: `ssh op 'curl -s 127.0.0.1:8080/saude'` = ok; `vessel_pedidos` intacta (contagem igual à de antes).
- Próxima rodada de `fotos-do-selo` e `pedidos-da-vessel` sem erro; `relatorios-comerciais` das 08:52 ok.
- Cópia diária das 03:40 sem `permission denied` e sem `bling_tokens.jsonl`/`estoque_do_site_estado.jsonl` no manifesto (`coletor/guardar-copia-do-banco.mjs --ensaio` antes, se quiser).
- Depois de uns dias estável: `rm` do dump antigo (ele tem token).

## 5. Reversão
- **Só a etapa 1:** `1-revogar-reverter.sql` (devolve os GRANTs exatos de 20/10; provado no ensaio).
- **A etapa 2:** `2-eliminar-reverter.sql` (recria o esquema vazio, idêntico ao de produção em 20/10, com dono `api_app` e SELECT do `copia`), depois os dados e as sequences:
  `ssh op 'docker exec -i api-db sh -c "pg_restore --data-only --single-transaction -U \"\$POSTGRES_USER\" -d \"\$POSTGRES_DB\"" < /root/backups-api/<dump>'` (o dump fica na VPS; variáveis escapadas para o shell do CONTÊINER expandi-las) e, se quiser os GRANTs antigos, `1-revogar-reverter.sql`.
  Atenção: o `bling_tokens` restaurado é o de 20/10 e **não funciona** (o refresh é rotativo e quem renova é o Core); a restauração serve para recuperar o esquema, não para voltar a falar com o Bling por fora do Core.

## 6. O que fica fora (não faz parte do drop)
`supabase/functions/*` (edges que citam `bling_tokens` e rodavam no Supabase, parado desde 19/10; outro banco), `db/migrations/` (histórico), e as fotos de esquema/políticas do Supabase usadas pelos testes (`api/internal/testebanco/testdata/producao_*.tsv`, `api/internal/autz/catalogo-policies-producao.json`): continuam como estão, são retratos do Supabase.
