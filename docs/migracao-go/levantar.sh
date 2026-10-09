#!/bin/sh
# Roda levantamento.sql em transação SOMENTE LEITURA e grava um CSV por consulta
# em docs/migracao-go/levantamento/ (pasta fora do git: pode conter corpo de função).
# Uso (quem roda é o dono): DATABASE_URL='postgres://...' sh docs/migracao-go/levantar.sh
set -eu
[ -n "${DATABASE_URL:-}" ] || { echo "defina DATABASE_URL (não é impresso)"; exit 1; }
AQUI=$(cd "$(dirname "$0")" && pwd)
SAIDA="$AQUI/levantamento"
mkdir -p "$SAIDA"
export PGOPTIONS='-c default_transaction_read_only=on -c statement_timeout=60000'
n=0
# separa por consulta: cada bloco começa com "-- NN titulo"
awk -v dir="$SAIDA" '/^-- [0-9][0-9] /{f=dir"/"$2"-"$3".sql"; sub(/ +$/,"",f)} f && !/^--/{print > f}' "$AQUI/levantamento.sql"
for f in "$SAIDA"/*.sql; do
  psql "$DATABASE_URL" -X -q -v ON_ERROR_STOP=1 --csv -f "$f" -o "${f%.sql}.csv" && n=$((n+1)) || echo "falhou: $(basename "$f")"
done
echo "$n consultas gravadas em docs/migracao-go/levantamento/"
