#!/bin/sh
# Backup diário do Postgres da API. Cron sugerido (root): 40 3 * * * /root/api-db/backup-api-db.sh
# Variáveis opcionais (padrões = produção): BACKUP_DIR, BACKUP_RETENCAO_DIAS, API_DB_CONTAINER.
set -eu
DIR=${BACKUP_DIR:-/root/backups-api}
RET=${BACKUP_RETENCAO_DIAS:-14}
CT=${API_DB_CONTAINER:-api-db}
mkdir -p "$DIR"; chmod 700 "$DIR"
ARQ="$DIR/api-db-$(date +%F-%H%M).dump"
trap 'rm -f "$ARQ.tmp"' EXIT   # qualquer falha não deixa lixo parcial
sha() { if command -v sha256sum >/dev/null 2>&1; then sha256sum "$@"; else shasum -a 256 "$@"; fi; }
docker exec "$CT" sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$ARQ.tmp"
# um dump vazio ou truncado não pode virar "backup": confere o índice
docker exec -i "$CT" pg_restore -l < "$ARQ.tmp" > /dev/null \
  || { echo "backup ilegível (pg_restore -l falhou)" >&2; exit 1; }
[ "$(wc -c < "$ARQ.tmp")" -gt 1000 ] || { echo "backup suspeito (muito pequeno)" >&2; exit 1; }
mv "$ARQ.tmp" "$ARQ"
( cd "$DIR" && sha "$(basename "$ARQ")" > "$(basename "$ARQ").sha256" )
chmod 600 "$ARQ" "$ARQ.sha256"
find "$DIR" -name 'api-db-*.dump*' -mtime +"$RET" -delete
echo "backup ok: $ARQ ($(du -h "$ARQ" | cut -f1))"
