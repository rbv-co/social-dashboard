#!/usr/bin/env bash
# Ensaia as 4 SQL desta pasta num banco DESCARTÁVEL (nada de produção): GRANTs idênticos aos do api-db em 20/10/2026, dados
# nas 3 tabelas, e prova (1) etapa 1 tira o acesso e a reversão devolve os GRANTs exatos; (2) a etapa 2 recusa se a
# tabela de envios tiver linha; (3) a etapa 2 elimina; (4) a reversão recria o MESMO esquema e o pg_restore devolve os dados.
# Uso (raiz do repositório): TEST_DATABASE_URL='postgres://postgres@127.0.0.1:55505/postgres?sslmode=disable' bash ops/vps/api-db/eliminar-3-tabelas/ensaio.sh
set -u
AQUI="$(cd "$(dirname "$0")" && pwd)"
[ -n "${TEST_DATABASE_URL:-}" ] || { echo "falta TEST_DATABASE_URL"; exit 2; }
BASE="${TEST_DATABASE_URL%%\?*}"; SERVIDOR="${BASE%/*}"; NOME="elim3_t05_$$"; BIN="${PG_BIN:-}"
falhas=0
confere() { if [ "$2" = "$3" ]; then echo "ok   $1"; else echo "FALHA $1 (esperado '$3', veio '$2')"; falhas=$((falhas + 1)); fi; }
adm() { "${BIN}psql" "$SERVIDOR/$NOME" -X -v ON_ERROR_STOP=1 -q -At "$@"; }
limpar() { "${BIN}psql" "$BASE" -X -q -c "drop database if exists $NOME" >/dev/null 2>&1; }
trap limpar EXIT
for r in api_app copia anon authenticated service_role robo_selo robo_pedidos_vessel; do
  "${BIN}psql" "$BASE" -X -q -c "do \$\$ begin if not exists (select 1 from pg_roles where rolname = '$r') then create role $r; end if; end \$\$" || exit 1
done
"${BIN}psql" "$BASE" -X -q -v ON_ERROR_STOP=1 -c "create database $NOME" || exit 1
adm <<'SQLX'
create table vessel_pedidos (id bigint primary key);
insert into vessel_pedidos values (1);
SQLX
# esquema real de produção (2-eliminar-reverter.sql cria o mesmo; aqui cria-se uma vez para ter o "antes")
adm -f "$AQUI/2-eliminar-reverter.sql"
adm <<'SQLX'
insert into bling_tokens (access_token, refresh_token, expires_at, client_id, client_secret) values ('a', 'r', now(), 'c', 's');
insert into estoque_do_site_estado (chave, valor) values ('k1', '{"x":1}'), ('k2', '{"y":2}');
revoke all on bling_tokens, estoque_do_site_estado, vessel_envios_ao_meta from copia;
-- GRANTs de produção (relacl/attacl lidos em 20/10/2026)
grant select on bling_tokens, estoque_do_site_estado, vessel_envios_ao_meta to copia;
grant insert, update, delete, truncate on bling_tokens, vessel_envios_ao_meta to anon, authenticated, service_role;
grant insert, update, delete, truncate on estoque_do_site_estado to service_role;
grant select (id, access_token) on bling_tokens to robo_selo, robo_pedidos_vessel;
SQLX
acl() { adm -c "select c.relname, (select string_agg(x::text, ',' order by x::text) from unnest(c.relacl) x) from pg_class c where relnamespace = 'public'::regnamespace and relname in ('bling_tokens','estoque_do_site_estado','vessel_envios_ao_meta') order by 1" -c "select a.attname, a.attacl::text from pg_attribute a where attrelid = 'public.bling_tokens'::regclass and attacl is not null order by 1"; }
antes="$(acl)"
estrutura() { "${BIN}pg_dump" "$SERVIDOR/$NOME" -s --no-owner --no-privileges -t bling_tokens -t estoque_do_site_estado -t vessel_envios_ao_meta | grep -v '^\\\(un\)\?restrict\|^--'; }
# o "antes" NÃO sai do próprio 2-eliminar-reverter.sql (seria circular): é o `pg_dump -s` REAL do api-db de 20/10/2026
esq_antes="$(cat "$AQUI/esquema-producao-20261020.sql")"
confere "esquema criado pelo reverter == esquema de produção (20/10)" "$(estrutura)" "$esq_antes"
dump="$(mktemp)"; "${BIN}pg_dump" "$SERVIDOR/$NOME" -Fc -t bling_tokens -t estoque_do_site_estado -t vessel_envios_ao_meta > "$dump"

# (1) etapa 1 tira o acesso; reverter devolve exatamente
adm -f "$AQUI/1-revogar.sql"
confere "etapa 1: anon sem privilégio em bling_tokens" "$(adm -c "select has_table_privilege('anon','bling_tokens','insert') or has_table_privilege('service_role','estoque_do_site_estado','delete')")" "f"
confere "etapa 1: robo_selo sem acesso a access_token" "$(adm -c "select has_column_privilege('robo_selo','bling_tokens','access_token','select') or has_column_privilege('robo_pedidos_vessel','bling_tokens','id','select')")" "f"
confere "etapa 1: copia continua lendo (a cópia diária não cai)" "$(adm -c "select has_table_privilege('copia','bling_tokens','select') and has_table_privilege('copia','estoque_do_site_estado','select') and has_table_privilege('copia','vessel_envios_ao_meta','select')")" "t"
adm -f "$AQUI/1-revogar-reverter.sql"
confere "etapa 1: reverter devolve os GRANTs exatos" "$(acl)" "$antes"

# (2) a etapa 2 recusa se a tabela de envios ganhou linha; nada some
adm -c "insert into vessel_envios_ao_meta (pedido_id, evento, event_id) values (1, 'Purchase', 'e1')"
if adm -f "$AQUI/2-eliminar.sql" >/dev/null 2>&1; then echo "FALHA etapa 2 não recusou com linha em vessel_envios_ao_meta"; falhas=$((falhas + 1)); else echo "ok   etapa 2 recusa com linha em vessel_envios_ao_meta"; fi
confere "etapa 2 recusada: as 3 tabelas continuam" "$(adm -c "select count(*) from pg_tables where schemaname='public' and tablename in ('bling_tokens','estoque_do_site_estado','vessel_envios_ao_meta')")" "3"
adm -c "delete from vessel_envios_ao_meta"

# (3) elimina
adm -f "$AQUI/2-eliminar.sql"
confere "etapa 2: as 3 tabelas sumiram" "$(adm -c "select count(*) from pg_tables where schemaname='public' and tablename in ('bling_tokens','estoque_do_site_estado','vessel_envios_ao_meta')")" "0"
confere "etapa 2: vessel_pedidos intacta" "$(adm -c "select count(*) from vessel_pedidos")" "1"

# (4) reverte: esquema idêntico + dados do backup
adm -f "$AQUI/2-eliminar-reverter.sql"
adm -f "$AQUI/1-revogar-reverter.sql" >/dev/null
"${BIN}pg_restore" --data-only --single-transaction -d "$SERVIDOR/$NOME" "$dump" || { echo "FALHA pg_restore"; falhas=$((falhas + 1)); }
confere "reverter: esquema idêntico ao de antes" "$(estrutura)" "$esq_antes"
confere "reverter: dados de volta" "$(adm -c "select (select count(*) from bling_tokens) || '/' || (select count(*) from estoque_do_site_estado) || '/' || (select count(*) from vessel_envios_ao_meta)")" "1/2/0"
confere "reverter: sequence segue de onde parou" "$(adm -c "select nextval('bling_tokens_id_seq')")" "2"
confere "reverter: GRANTs de volta" "$(acl)" "$antes"
rm -f "$dump"
[ "$falhas" -eq 0 ] && echo "TUDO OK" || { echo "$falhas falha(s)"; exit 1; }
