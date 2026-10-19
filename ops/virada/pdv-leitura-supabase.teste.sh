#!/usr/bin/env bash
# Prova o pdv-leitura-supabase.sh num banco DESCARTÁVEL de um Postgres de teste já de pé (precisa de `psql` 17), com
# o Supabase de mentira: RLS em vessel_* com policy só para `authenticated`, default privileges que dão SELECT em toda
# tabela nova ao papel e o papel `pdv_leitura` com login e bypassrls. Nada de produção. Remove banco e papéis no fim.
# Uso (na raiz do repositório):
#   TEST_DATABASE_URL='postgres://postgres@127.0.0.1:55505/postgres?sslmode=disable' bash ops/virada/pdv-leitura-supabase.teste.sh
set -u
AQUI="$(cd "$(dirname "$0")" && pwd)"
SH="$AQUI/pdv-leitura-supabase.sh"
[ -n "${TEST_DATABASE_URL:-}" ] || { echo "falta TEST_DATABASE_URL"; exit 2; }
BASE="${TEST_DATABASE_URL%%\?*}"
SERVIDOR="${BASE%/*}"
SERVIDOR_PDV="$(printf %s "$SERVIDOR" | sed 's#//[^@/]*@#//pdv_leitura@#')"
NOME="pdvsb_t_$$"
DIR="$(mktemp -d)"
falhas=0
confere() { if [ "$2" = "$3" ]; then echo "ok   $1"; else echo "FALHA $1 (esperado '$3', veio '$2')"; falhas=$((falhas + 1)); fi; }
nega() { local saida; saida="$(pdv -c "$2" 2>&1)"
  case "$saida" in *"permission denied"*) echo "ok   $1" ;; *) echo "FALHA $1 (veio: $saida)"; falhas=$((falhas + 1)) ;; esac; }
adm() { psql "$SERVIDOR/$NOME" -X -v ON_ERROR_STOP=1 -q -At "$@"; }
pdv() { psql "$SERVIDOR_PDV/$NOME" -X -q -At "$@"; }
roda() { sh "$SH" "$1" "${2:-$SERVIDOR/$NOME}" "$DIR" 2>&1; }
saida() { roda "$@" > /dev/null; echo $?; }
# a ACL inteira do public (tabela, coluna e default), para comparar antes × depois
acl() { adm -c "select string_agg(format('%s=%s[%s]', c.relname, coalesce(c.relacl::text, '-'),
                  coalesce((select string_agg(t.attname || ':' || t.attacl::text, ',' order by t.attname)
                              from pg_attribute t where t.attrelid = c.oid and t.attacl is not null), '')), ' ' order by c.relname)
                || ' | ' || coalesce((select string_agg(defaclacl::text, ' ') from pg_default_acl), '-')
                from pg_class c where c.relnamespace = 'public'::regnamespace"; }
limpar() { psql "$BASE" -X -q -c "drop database if exists $NOME" -c "drop role if exists pdv_leitura" >/dev/null 2>&1; rm -rf "$DIR"; }
trap limpar EXIT

psql "$BASE" -X -q -v ON_ERROR_STOP=1 -c "create database $NOME" || exit 1
psql "$BASE" -X -q -v ON_ERROR_STOP=1 -c "create role pdv_leitura login bypassrls" \
  -c "do \$\$ begin if not exists (select from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if; end \$\$" || exit 1
adm <<'SQLX'
alter default privileges for role postgres in schema public grant select on tables to pdv_leitura;
create table velha (x int);
create table vessel_lotes (id uuid primary key, sku text, fornecedor text);
create table vessel_pecas (codigo text primary key, lote_id uuid references vessel_lotes, numero_na_serie int, gravada_em timestamptz, criado_em timestamptz);
create table shopify_pedidos (id int primary key, cliente_email text);
create table profiles (id int primary key, email text);
create view robos_saude as select 1 as ok;
create sequence contador;
alter table vessel_lotes enable row level security;
alter table vessel_pecas enable row level security;
create policy vessel_lotes_read on vessel_lotes for select to authenticated using (true);
create policy vessel_pecas_read on vessel_pecas for select to authenticated using (true);
insert into vessel_lotes values ('aaaaaaaa-0000-0000-0000-000000000001', 'SS1A.01', 'fornecedor-secreto'), ('aaaaaaaa-0000-0000-0000-000000000002', null, 'x');
insert into vessel_pecas values ('ABXCKN5PZA', 'aaaaaaaa-0000-0000-0000-000000000001', 7, now(), now()), ('SEMSKU0000', 'aaaaaaaa-0000-0000-0000-000000000002', 1, now(), now());
insert into shopify_pedidos values (1, 'cliente@x');
grant select on profiles to pdv_leitura with grant option;
grant insert (id) on profiles to pdv_leitura;
SQLX
confere "aplicar sem foto: recusa" "$(saida aplicar)" "1"
adm -c "grant select on contador to pdv_leitura"
confere "foto com grant em sequência: recusa (a reversão não o cobriria)" "$(saida foto)" "1"
adm -c "revoke select on contador from pdv_leitura"
ANTES="$(acl)"
confere "foto" "$(saida foto)" "0"
confere "foto de novo: recusa sobrescrever" "$(saida foto)" "1"

psql "$BASE" -X -q -c "alter role pdv_leitura nobypassrls"
SAIDA="$(roda aplicar)"; confere "aplicar sem bypassrls: falha" "$?" "1"
confere "  e diz que não aplicou" "$(printf '%s\n' "$SAIDA" | grep -c '^NÃO APLICADO')" "1"
confere "e desfaz tudo (ACL igual à de antes)" "$(acl)" "$ANTES"
psql "$BASE" -X -q -c "alter role pdv_leitura bypassrls"
adm -c "grant select on shopify_pedidos to public"
confere "aplicar com PUBLIC lendo outra tabela: falha" "$(saida aplicar)" "1"
adm -c "revoke select on shopify_pedidos from public"
confere "e desfaz tudo de novo" "$(acl)" "$ANTES"

confere "aplicar (rodada 1)" "$(saida aplicar)" "0"; DEPOIS="$(acl)"
confere "aplicar (rodada 2)" "$(saida aplicar)" "0"
confere "a rodada 2 não muda a ACL" "$(acl)" "$DEPOIS"
psql "$BASE" -X -q -c "alter role pdv_leitura nobypassrls"
confere "aplicar falhando com a ACL já mudada: não diz 'não aplicado'" "$(roda aplicar | grep -c '^FALHOU e a ACL NÃO é a da foto')" "1"
psql "$BASE" -X -q -c "alter role pdv_leitura bypassrls"
confere "ler como o PDV" "$(roda ler "$SERVIDOR_PDV/$NOME")" "linhas=1 shopify_pedidos=negado vessel_pecas_tudo=negado profiles=negado"
adm -c "update vessel_lotes set sku = null where sku = 'SS1A.01'"
confere "ler com 0 linhas: sai 1" "$(saida ler "$SERVIDOR_PDV/$NOME")" "1"
adm -c "update vessel_lotes set sku = 'SS1A.01' where id = 'aaaaaaaa-0000-0000-0000-000000000001'"
confere "ler sem conexão: sai 1 (não o 2 do psql)" "$(saida ler 'postgres://ninguem@127.0.0.1:1/x')" "1"

Q="select p.codigo, l.sku, p.numero_na_serie, p.criado_em is not null from public.vessel_pecas p join public.vessel_lotes l on l.id = p.lote_id where l.sku is not null"
confere "todas(): a peça com SKU, apesar do RLS" "$(pdv -c "$Q")" "ABXCKN5PZA|SS1A.01|7|t"
confere "doCodigo(): uma peça" "$(pdv -c "$Q and p.codigo = 'ABXCKN5PZA' limit 1")" "ABXCKN5PZA|SS1A.01|7|t"
confere "set role pdv_leitura + a consulta (o caminho do ensaio)" "$(adm -c "begin" -c "set local role pdv_leitura" -c "$Q" -c "rollback")" "ABXCKN5PZA|SS1A.01|7|t"
nega "não lê coluna fora da consulta (gravada_em)" "select gravada_em from vessel_pecas"
nega "não lê coluna fora da consulta (fornecedor)" "select fornecedor from vessel_lotes"
nega "não lê a view" "select * from robos_saude"
nega "não insere mais em profiles (o grant de coluna saiu)" "insert into profiles (id) values (2)"
adm -c "create table nova (x int)"
nega "tabela nova depois do aplicar: não lê (o default saiu)" "select * from nova"
confere "bypassrls continua ligado" "$(adm -c "select rolbypassrls from pg_roles where rolname = 'pdv_leitura'")" "t"

adm -c "drop table nova" -c "drop table velha"
confere "reverter com tabela apagada depois da foto: devolve o resto e acusa" "$(saida reverter)" "1"
confere "  o resto voltou (o PDV lê profiles)" "$(pdv -c 'select count(*) from profiles')" "0"
adm -c "create table velha (x int)"
confere "reverter" "$(roda reverter)" "REVERTIDO: ACL igual à de antes (9 linhas)"
confere "a ACL inteira voltou a ser a de antes" "$(acl)" "$ANTES"
confere "ler depois de reverter" "$(roda ler "$SERVIDOR_PDV/$NOME")" "linhas=1 shopify_pedidos=lido vessel_pecas_tudo=lido profiles=lido"
adm -c "create table nova (x int)"
confere "tabela nova depois de reverter: o default voltou" "$(pdv -c "select count(*) from nova")" "0"

[ "$falhas" -eq 0 ] && echo "TUDO OK" || { echo "$falhas falha(s)"; exit 1; }
