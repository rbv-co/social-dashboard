#!/bin/sh
# Restaura o backup MAIS RECENTE num contêiner temporário (nunca toca o banco de verdade) e
# confere que as tabelas restauradas batem com as do índice do dump.
# Uso: sh testar-restauracao.sh [arquivo.dump]
# Variáveis opcionais (padrões = produção): BACKUP_DIR, TESTE_CONTAINER.
set -eu
DIR=${BACKUP_DIR:-/root/backups-api}
CT=${TESTE_CONTAINER:-api-db-teste}
[ "$CT" != api-db ] || { echo "recusado: TESTE_CONTAINER não pode ser o banco de verdade" >&2; exit 1; }
ARQ=${1:-$(ls -1t "$DIR"/api-db-*.dump | head -1)}
sha() { if command -v sha256sum >/dev/null 2>&1; then sha256sum "$@"; else shasum -a 256 "$@"; fi; }
( cd "$(dirname "$ARQ")" && sha -c "$(basename "$ARQ").sha256" )
docker rm -f "$CT" >/dev/null 2>&1 || true
docker run -d --rm --name "$CT" -e POSTGRES_PASSWORD=teste postgres:17 >/dev/null
trap 'docker rm -f "$CT" >/dev/null 2>&1 || true' EXIT
# a imagem reinicia o servidor após o initdb: exige duas respostas seguidas
OK=0
for _ in $(seq 90); do
  if docker exec "$CT" psql -U postgres -Atc 'select 1' >/dev/null 2>&1; then OK=$((OK+1)); [ "$OK" -ge 2 ] && break; else OK=0; fi
  sleep 1
done
[ "$OK" -ge 2 ] || { echo "contêiner de teste não subiu" >&2; exit 1; }
ESPERADO=$(docker exec -i "$CT" pg_restore -l < "$ARQ" | grep -c ' TABLE public ' || true)
docker exec "$CT" createdb -U postgres teste
docker exec -i "$CT" pg_restore -U postgres -d teste --no-owner --exit-on-error < "$ARQ"
N=$(docker exec "$CT" psql -U postgres -d teste -Atc "select count(*) from information_schema.tables where table_schema='public' and table_type='BASE TABLE'")
[ "$N" -gt 0 ] || { echo "restauração sem tabelas" >&2; exit 1; }
[ "$N" -eq "$ESPERADO" ] || { echo "restauração difere: $N tabelas, o dump lista $ESPERADO" >&2; exit 1; }
echo "restauração ok: $N tabelas no public, conferidas com o índice do dump ($ARQ)"
