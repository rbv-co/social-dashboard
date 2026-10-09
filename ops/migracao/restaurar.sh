#!/bin/sh
# Restaura no Postgres ALVO: compat -> migrations da API (usuarios, sessoes) -> schema limpo -> dados.
# O alvo deve estar VAZIO. As FKs que apontavam para auth.users já vêm reescritas para public.usuarios.
# Requisitos: o psql do Mac deve ser >= 16.10 ou 17.6 (o dump traz \restrict/\unrestrict, que
# versões antigas do psql não entendem); superusuário no alvo (--disable-triggers).
# Uso: sh ops/migracao/restaurar.sh 'postgres://...@alvo/db' ops/migracao/saida/2026-10-09
set -eu
ALVO=${1:?uso: restaurar.sh ALVO_DATABASE_URL DUMP_DIR}
DUMP=${2:?uso: restaurar.sh ALVO_DATABASE_URL DUMP_DIR}
AQUI=$(cd "$(dirname "$0")" && pwd)
RAIZ=$(cd "$AQUI/../.." && pwd)
oculta() { sed -E 's#postgres(ql)?://[^ "]*#<URL>#g'; }
LOG=$(mktemp); trap 'rm -f "$LOG"' EXIT
# psql cujo stderr passa por oculta (a URL não vaza), preservando o código de saída
pq() { s=0; psql "$@" 2> "$LOG" || s=$?; oculta < "$LOG" >&2; return $s; }

# recusa alvo que já tem relações no public (não mistura com restauração anterior)
JA=$(pq "$ALVO" -X -Atqc "select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','p','v','m','f','S')") || { echo "não consegui consultar o alvo" >&2; exit 1; }
[ "$JA" = 0 ] || { echo "o alvo já tem $JA relações no public; use um banco vazio" >&2; exit 1; }

pq "$ALVO" -X -q -v ON_ERROR_STOP=1 -f "$RAIZ/api/internal/banco/compat/compat.sql" > /dev/null
# cria public.usuarios/sessoes (as FKs reescritas do schema precisam da tabela pai)
( cd "$RAIZ/api" && DATABASE_URL="$ALVO" go run ./cmd/api migrar ) > "$LOG" 2>&1 || { oculta < "$LOG" >&2; echo "migrar falhou" >&2; exit 1; }
# o cabeçalho do schema traz check_function_bodies=false: funções SQL que citam objetos que não
# levamos (net.*, storage.*) criam sem erro; serão reescritas nos planos de domínio.
pq "$ALVO" -X -q -v ON_ERROR_STOP=1 -f "$DUMP/schema.sql" > /dev/null
echo "schema restaurado"
# dados com triggers desligados (não dispara regra de negócio, trilha nem checagem de FK).
# O dump entra por stdin (pode estar fora da pasta montada em /work); --single-transaction: tudo ou nada.
sh "$AQUI/pg17.sh" pg_restore --data-only --disable-triggers --single-transaction --no-owner --exit-on-error -d "$ALVO" < "$DUMP/completo.dump" > "$LOG" 2>&1 || { oculta < "$LOG" >&2; echo "pg_restore falhou" >&2; exit 1; }
# o pg_restore --disable-triggers religa TODOS os triggers ao fim de cada tabela (ENABLE TRIGGER ALL),
# desfazendo DISABLE / ENABLE REPLICA / ENABLE ALWAYS do schema: reaplica os estados do schema.sql.
ESTADOS=$(mktemp)
grep -E '^ALTER TABLE .* (DISABLE|ENABLE (REPLICA|ALWAYS)) TRIGGER ' "$DUMP/schema.sql" > "$ESTADOS" || true   # grep sai 1 se não houver nenhum: ok
if [ -s "$ESTADOS" ]; then pq "$ALVO" -X -q -v ON_ERROR_STOP=1 -f "$ESTADOS" > /dev/null || { rm -f "$ESTADOS"; echo "reaplicar estados de triggers falhou" >&2; exit 1; }; fi
rm -f "$ESTADOS"
pq "$ALVO" -X -q -c "analyze" > /dev/null
echo "dados restaurados (rode importar-usuarios e conferir-orfaos.sh em seguida)"
