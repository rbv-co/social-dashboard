#!/bin/sh
# Reaplica no api-db a ACL de trabalho do Supabase (o `reverter-acl.sql` que `supabase.sh congelar` grava) logo depois do
# dump/restore do corte. O dump do t+1 sai DEPOIS do congelamento (t+0), então leva ao api-db a ACL congelada (sem INSERT/UPDATE/
# EXECUTE para anon/authenticated/service_role) e a API Go não escreveria; foi o desvio 2 da janela de 20/10 (t+9-conferir, 92 premissas).
# Uso: sh ops/virada/reaplicar-acl.sh ALVO_URL REVERTER_ACL_SQL [DIR_SAIDA]
# Só o banco `api` do api-db (túnel em 127.0.0.1): recusa URL do Supabase, host que não seja local, banco com outro nome e arquivo com
# qualquer coisa além de GRANT. Tudo numa transação; GRANT repetido não muda nada (idempotente). Nunca imprime a URL.
# ACL_BANCO_ESPERADO existe só para o teste (banco descartável); em produção vale `api`.
set -eu
ALVO=${1:?uso: reaplicar-acl.sh ALVO_URL REVERTER_ACL_SQL [DIR_SAIDA]}; SQL=${2:?falta o reverter-acl.sql}; DIR=${3:-}
BANCO=${ACL_BANCO_ESPERADO:-api}
recusa() { echo "RECUSADO: $*" >&2; exit 2; }
case $ALVO in *[Ss][Uu][Pp][Aa][Bb][Aa][Ss][Ee]*|*pooler*) recusa "o alvo parece o Supabase" ;; esac
case $ALVO in *@127.0.0.1:*|*@localhost:*|*@127.0.0.1/*|*@localhost/*) ;; *) recusa "o alvo não é o túnel local do api-db" ;; esac
case $ALVO in *host=*|*hostaddr=*|*service=*) recusa "a URL traz host/hostaddr/service por parâmetro" ;; esac
[ "$BANCO" != postgres ] || recusa "ACL_BANCO_ESPERADO não pode ser 'postgres'"
nome=${ALVO##*/}; nome=${nome%%\?*}
[ "$nome" = "$BANCO" ] || recusa "o banco da URL não é '$BANCO'"
[ -s "$SQL" ] || recusa "sem $SQL (este D não é o da janela?)"
! grep -q '\\' "$SQL" || recusa "o arquivo tem barra invertida (meta-comando do psql)"
awk 'NF && !/^grant [A-Za-z, ]+ on (table|routine|function|sequence) [^;]+;$/ { ruim = 1 } END { exit ruim }' "$SQL" || recusa "o arquivo tem algo além de GRANT"
n=$(grep -c '^grant ' "$SQL" || true)
[ "$n" -gt 0 ] || recusa "o arquivo não tem GRANT"
if [ -n "$DIR" ] && [ ! -e "$DIR/acl-api-antes-reverter.txt" ]; then # reexecução não sobrescreve a foto original
  mkdir -p "$DIR"
  psql "$ALVO" -X -Atq -c "select c.relname, c.relacl from pg_class c where c.relnamespace = 'public'::regnamespace and c.relacl is not null order by 1" > "$DIR/acl-api-antes-reverter.txt"
fi
{
  printf "do \$\$ begin if current_database() <> %s then raise exception 'banco errado: %%', current_database(); end if; end \$\$;\n" "'$BANCO'"
  cat "$SQL"
} | psql "$ALVO" -X -q -v ON_ERROR_STOP=1 --single-transaction -f - > /dev/null
echo "ACL de trabalho reaplicada no $BANCO: $n GRANTs"
