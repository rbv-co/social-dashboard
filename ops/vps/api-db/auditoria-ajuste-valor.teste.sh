#!/usr/bin/env bash
# Prova a migration 00013 (auditoria de bling_pedido_ajuste_valor) num banco descartável: Up grava insert/update/delete/
# truncate em audit_log, é idempotente, não mexe nos dados e o Down limpa. Nada de produção.
#   TEST_DATABASE_URL='postgres://postgres@127.0.0.1:55704/postgres' bash ops/vps/api-db/auditoria-ajuste-valor.teste.sh
set -uo pipefail
[ -n "${TEST_DATABASE_URL:-}" ] || { echo "falta TEST_DATABASE_URL"; exit 2; }
BASE="${TEST_DATABASE_URL%%\?*}"; BASE="${BASE%/*}"
NOME="zz_auditoria_$$"; MIG="$(dirname "$0")/../../../api/internal/banco/migracoes/00013_auditoria_ajuste_valor.sql"
adm() { psql "$BASE/$NOME" -X -q -At -v ON_ERROR_STOP=1 "$@"; }
trap 'psql "$BASE/postgres" -X -q -c "drop database if exists $NOME" >/dev/null 2>&1' EXIT
psql "$BASE/postgres" -X -q -c "create database $NOME" || exit 1
falhas=0
confere() { if [ "$2" = "$3" ]; then echo "ok   $1"; else echo "FALHOU $1: veio '$2', esperava '$3'"; falhas=$((falhas+1)); fi; }
trecho() { awk -v up="$1" '/^-- \+goose Down/{d=1} (up=="up" && !d) || (up=="down" && d){ if ($0 !~ /^-- \+goose/) print }' "$MIG"; }

# sem as tabelas, nada acontece
trecho up | adm -f - ; confere "sem as tabelas: não faz nada nem falha" "$?" "0"
adm -c "create table audit_log (id bigint generated always as identity primary key, at timestamptz default now(), actor_id uuid, actor_email text, action text not null, detail jsonb);
        create table bling_pedido_ajuste_valor (pedido_id bigint primary key, loja_id bigint, total_corrigido numeric(12,2) not null, motivo text not null)"
trecho up | adm -f - ; trecho up | adm -f - ; confere "Up duas vezes" "$?" "0"
confere "dois triggers" "$(adm -c "select count(*) from pg_trigger where tgrelid='bling_pedido_ajuste_valor'::regclass and not tgisinternal")" "2"
adm -c "insert into bling_pedido_ajuste_valor values (1, 9, 1615, 'um motivo'); update bling_pedido_ajuste_valor set total_corrigido = 1600 where pedido_id = 1; delete from bling_pedido_ajuste_valor where pedido_id = 1;
        insert into bling_pedido_ajuste_valor values (2, 9, 5, 'outro motivo'); truncate bling_pedido_ajuste_valor"
confere "ações auditadas" "$(adm -c "select string_agg(action, ',' order by id) from audit_log")" "ajuste_valor_insert,ajuste_valor_update,ajuste_valor_delete,ajuste_valor_insert,ajuste_valor_truncate"
confere "delete guarda a linha de antes" "$(adm -c "select detail->'antes'->>'total_corrigido' from audit_log where action='ajuste_valor_delete'")" "1600.00"
confere "update guarda antes e depois" "$(adm -c "select (detail->'antes'->>'total_corrigido')||'>'||(detail->'depois'->>'total_corrigido') from audit_log where action='ajuste_valor_update'")" "1615.00>1600.00"
confere "registra quem" "$(adm -c "select (detail->>'por') is not null from audit_log limit 1")" "t"
confere "PUBLIC não executa a função" "$(adm -c "select has_function_privilege('public','public.auditar_ajuste_valor()','execute')")" "f"
trecho down | adm -f - ; confere "Down tira triggers e função" "$(adm -c "select count(*) from pg_trigger where tgrelid='bling_pedido_ajuste_valor'::regclass and not tgisinternal")$(adm -c "select count(*) from pg_proc where proname='auditar_ajuste_valor'")" "00"
[ "$falhas" = 0 ] && echo "TUDO OK" || { echo "$falhas FALHA(S)"; exit 1; }
