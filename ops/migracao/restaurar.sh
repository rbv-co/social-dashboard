#!/bin/sh
# Restaura no Postgres ALVO: compat -> migrations da API (usuarios, sessoes) -> schema limpo -> dados.
# O alvo deve estar VAZIO. As FKs que apontavam para auth.users já vêm reescritas para public.usuarios.
# Uso: sh ops/migracao/restaurar.sh 'postgres://...@alvo/db' ops/migracao/saida/2026-10-09
set -eu
ALVO=${1:?uso: restaurar.sh ALVO_DATABASE_URL DUMP_DIR}
DUMP=${2:?uso: restaurar.sh ALVO_DATABASE_URL DUMP_DIR}
AQUI=$(cd "$(dirname "$0")" && pwd)
RAIZ=$(cd "$AQUI/../.." && pwd)
oculta() { sed -E 's#postgres(ql)?://[^ "]*#<URL>#g'; }

# recusa alvo que já tem tabelas no public (não mistura com restauração anterior)
JA=$(psql "$ALVO" -X -Atqc "select count(*) from information_schema.tables where table_schema='public'" 2> /dev/null) || { echo "não consegui consultar o alvo" >&2; exit 1; }
[ "$JA" = 0 ] || { echo "o alvo já tem $JA tabelas no public; use um banco vazio" >&2; exit 1; }

psql "$ALVO" -X -q -v ON_ERROR_STOP=1 -f "$RAIZ/api/internal/banco/compat/compat.sql" > /dev/null
# cria public.usuarios/sessoes (as FKs reescritas do schema precisam da tabela pai)
LOG=$(mktemp); trap 'rm -f "$LOG"' EXIT
( cd "$RAIZ/api" && DATABASE_URL="$ALVO" go run ./cmd/api migrar ) > "$LOG" 2>&1 || { oculta < "$LOG" >&2; echo "migrar falhou" >&2; exit 1; }
# check_function_bodies=off: funções SQL que citam objetos que não levamos (net.*, storage.*)
# criam sem erro; elas serão reescritas nos planos de domínio.
PGOPTIONS='-c check_function_bodies=off' psql "$ALVO" -X -q -v ON_ERROR_STOP=1 -f "$DUMP/schema.sql" > /dev/null
echo "schema restaurado"
# (o dump entra por stdin: pode estar fora da pasta montada em /work)
# dados com triggers desligados (não dispara regra de negócio, trilha nem checagem de FK); precisa de superusuário.
# --disable-triggers religa os triggers ao fim de cada tabela; --exit-on-error aborta sem deixar passar erro.
sh "$AQUI/pg17.sh" pg_restore --data-only --disable-triggers --no-owner --exit-on-error -d "$ALVO" < "$DUMP/dados.dump" > "$LOG" 2>&1 || { oculta < "$LOG" >&2; echo "pg_restore falhou" >&2; exit 1; }
psql "$ALVO" -X -q -c "analyze" > /dev/null
echo "dados restaurados (rode importar-usuarios e conferir-orfaos.sh em seguida)"
