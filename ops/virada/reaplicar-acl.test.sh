#!/bin/sh
# Teste do reaplicar-acl.sh em DOIS bancos descartáveis: `acl_api` (o api-db restaurado a partir do dump congelado) e `acl_sb` (o
# Supabase congelado). Prova o desvio 2 da virada: a ACL de trabalho volta no api e só nele (sem mexer no Supabase, que continua
# congelado), repetir não muda nada, e o script recusa URL do Supabase, host não local, banco de outro nome e arquivo com mais que GRANT.
# Uso: ACL_TEST_ADMIN_URL=postgres://postgres@127.0.0.1:55402/postgres sh ops/virada/reaplicar-acl.test.sh
# Cria e apaga acl_api e acl_sb (e os papéis de teste acl_t_*) nesse servidor. Nunca aponte para produção.
set -eu
ADMIN=${ACL_TEST_ADMIN_URL:?uso: ACL_TEST_ADMIN_URL=postgres://...@servidor-descartável/postgres sh $0}
case "$ADMIN" in *supabase*) echo "recuso: parece o Supabase" >&2; exit 2;; esac
AQUI=$(cd "$(dirname "$0")" && pwd); R=$AQUI/reaplicar-acl.sh
base=${ADMIN%/*}; API="$base/acl_api"; SB="$base/acl_sb"
T=$(mktemp -d); trap 'psql "$ADMIN" -X -q -c "drop database if exists acl_api" -c "drop database if exists acl_sb" >/dev/null 2>&1; rm -rf "$T"' EXIT
falha() { echo "FALHOU: $*" >&2; exit 1; }
for b in acl_api acl_sb; do psql "$ADMIN" -X -q -c "drop database if exists $b" -c "create database $b" 2>/dev/null; done
psql "$ADMIN" -X -q -c "do \$\$ begin if not exists (select 1 from pg_roles where rolname = 'acl_t_anon') then create role acl_t_anon; end if; end \$\$"
# os dois bancos saem iguais e CONGELADOS (sem DML/EXECUTE para o papel, que é o que o dump do t+1 levou ao api)
for u in "$API" "$SB"; do
  psql "$u" -X -q -v ON_ERROR_STOP=1 -c "create table pedidos (id int primary key); create function f(p_x int) returns int language sql as 'select 1';
    revoke all on pedidos from public; revoke execute on function f(int) from public;"
done
cat > "$T/reverter.sql" <<'SQL'
grant INSERT on table public.pedidos to acl_t_anon;
grant UPDATE on table public.pedidos to acl_t_anon;
grant execute on routine public.f(p_x integer) to acl_t_anon;
SQL
acl() { psql "$1" -X -Atq -c "select coalesce(relacl::text, '-') from pg_class where relname = 'pedidos' union all select coalesce(proacl::text, '-') from pg_proc where proname = 'f'"; }
ANTES_SB=$(acl "$SB"); [ "$(acl "$API")" = "$ANTES_SB" ] || falha "bancos de teste deviam sair iguais"
export ACL_BANCO_ESPERADO=acl_api

echo "1) normal: a ACL de trabalho volta no api"
sh "$R" "$API" "$T/reverter.sql" "$T/saida" > "$T/o" || falha "reaplicar falhou: $(cat "$T/o")"
grep -q "3 GRANTs" "$T/o" || falha "saída inesperada: $(cat "$T/o")"
psql "$API" -X -Atq -c "select has_table_privilege('acl_t_anon', 'pedidos', 'INSERT') and has_table_privilege('acl_t_anon', 'pedidos', 'UPDATE') and has_function_privilege('acl_t_anon', 'f(int)', 'EXECUTE')" | grep -qx t || falha "privilégios não voltaram"
[ -s "$T/saida/acl-api-antes-reverter.txt" ] || falha "sem a foto da ACL de antes da reaplicação"
echo "2) repetição: idempotente (ACL idêntica)"
DEPOIS=$(acl "$API"); sh "$R" "$API" "$T/reverter.sql" > /dev/null || falha "2ª rodada falhou"; [ "$(acl "$API")" = "$DEPOIS" ] || falha "2ª rodada mudou a ACL"
FOTO=$(cat "$T/saida/acl-api-antes-reverter.txt"); sh "$R" "$API" "$T/reverter.sql" "$T/saida" > /dev/null; [ "$(cat "$T/saida/acl-api-antes-reverter.txt")" = "$FOTO" ] || falha "a foto original foi sobrescrita"
echo "3) o Supabase continua congelado (nada foi aplicado nele)"
[ "$(acl "$SB")" = "$ANTES_SB" ] || falha "a ACL do Supabase mudou"
echo "4) alvo errado é recusado (e nada muda)"
recusado() { # recusado "motivo" cmd...
  m=$1; shift; set +e; "$@" > "$T/o" 2>&1; rc=$?; set -e
  [ $rc = 2 ] && grep -q "RECUSADO" "$T/o" || falha "$m: devia recusar com 2 (deu $rc: $(cat "$T/o"))"
}
recusado "URL do Supabase" sh "$R" "postgres://postgres:x@db.abc.supabase.co:5432/acl_api" "$T/reverter.sql"
recusado "pooler" sh "$R" "postgres://postgres:x@aws-0-sa.pooler.exemplo.com:6543/acl_api" "$T/reverter.sql"
recusado "host remoto" sh "$R" "postgres://api:x@10.0.0.5:5432/acl_api" "$T/reverter.sql"
recusado "banco de outro nome" sh "$R" "$SB" "$T/reverter.sql"
ACL_BANCO_ESPERADO= recusado "banco ≠ api (padrão)" sh "$R" "$API" "$T/reverter.sql"
printf 'grant INSERT on table public.pedidos to acl_t_anon;\ndrop table public.pedidos;\n' > "$T/ruim.sql"
recusado "arquivo com mais que GRANT" sh "$R" "$API" "$T/ruim.sql"
printf 'grant INSERT on table public.pedidos to acl_t_anon; drop table public.pedidos;\n' > "$T/ruim2.sql"
recusado "comando na mesma linha" sh "$R" "$API" "$T/ruim2.sql"
recusado "host por parâmetro" sh "$R" "$API?host=outro.exemplo.com" "$T/reverter.sql"
printf 'grant INSERT on table public.pedidos to acl_t_anon \\! touch %s/pwned;\n' "$T" > "$T/ruim3.sql"
recusado "meta-comando do psql" sh "$R" "$API" "$T/ruim3.sql"
ACL_BANCO_ESPERADO=postgres recusado "banco postgres" sh "$R" "$base/postgres" "$T/reverter.sql"
[ ! -e "$T/pwned" ] || falha "meta-comando executou"
recusado "arquivo ausente" sh "$R" "$API" "$T/nao-existe.sql"
[ "$(acl "$SB")" = "$ANTES_SB" ] && [ "$(acl "$API")" = "$DEPOIS" ] || falha "alguma recusa mexeu na ACL"
psql "$API" -X -Atq -c "select to_regclass('pedidos')" | grep -qx pedidos || falha "a tabela sumiu"
echo "OK: ACL reaplicada só no api, idempotente, Supabase intacto, alvos errados recusados"
