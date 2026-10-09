#!/bin/sh
# Roda levantamento.sql em transação SOMENTE LEITURA e grava um CSV por consulta
# em docs/migracao-go/levantamento/ (pasta fora do git: pode conter corpo de função e,
# na consulta 04 (cron.job.command), até segredos. Nunca versionar).
# Uso (quem roda é o dono): DATABASE_URL='postgres://...' sh docs/migracao-go/levantar.sh
set -eu
[ -n "${DATABASE_URL:-}" ] || { echo "defina DATABASE_URL (não é impresso)"; exit 1; }
AQUI=$(cd "$(dirname "$0")" && pwd)
SAIDA="$AQUI/levantamento"
mkdir -p "$SAIDA"
rm -f "$SAIDA"/*.sql "$SAIDA"/*.csv
export PGOPTIONS='-c default_transaction_read_only=on -c statement_timeout=60000'
# um "options=" na URL ou um pooler pode anular o PGOPTIONS: confere de verdade
[ "$(psql "$DATABASE_URL" -X -Atc 'show default_transaction_read_only')" = on ] || { echo "transação não está somente leitura"; exit 1; }
n=0
# separa por consulta: cada bloco começa com "-- NN titulo"
awk -v dir="$SAIDA" '/^-- [0-9][0-9] /{f=dir"/"$2"-"$3".sql"; sub(/ +$/,"",f)} f && !/^--/{print > f}' "$AQUI/levantamento.sql"
for f in "$SAIDA"/*.sql; do
  psql "$DATABASE_URL" -X -q -v ON_ERROR_STOP=1 --csv -f "$f" -o "${f%.sql}.csv" && n=$((n+1)) || { rm -f "${f%.sql}.csv"; echo "falhou: $(basename "$f")"; }
done
echo "$n consultas gravadas em docs/migracao-go/levantamento/"
