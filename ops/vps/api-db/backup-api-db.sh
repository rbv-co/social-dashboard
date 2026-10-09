#!/bin/sh
# Backup diário do Postgres da API. Cron sugerido: ver LEIA-ME.md (com flock e PATH).
# Só rode depois de o esquema e os dados estarem carregados (banco vazio é recusado).
# Variáveis opcionais (padrões = produção): BACKUP_DIR, BACKUP_RETENCAO_DIAS, API_DB_CONTAINER.
set -eu
umask 077
DIR=${BACKUP_DIR:-/root/backups-api}
RET=${BACKUP_RETENCAO_DIAS:-14}
CT=${API_DB_CONTAINER:-api-db}
erro() { echo "$(date '+%F %T') $*" >&2; }
mkdir -p "$DIR"; chmod 700 "$DIR"
ARQ="$DIR/api-db-$(date +%F-%H%M).dump"
# qualquer falha (ou INT/HUP/TERM, que o dash não trata no EXIT) não deixa lixo parcial
trap 'rm -f "$ARQ.tmp"' EXIT
trap 'exit 130' INT HUP TERM
sha() { if command -v sha256sum >/dev/null 2>&1; then sha256sum "$@"; else shasum -a 256 "$@"; fi; }
docker exec "$CT" sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$ARQ.tmp"
# um dump vazio ou truncado não pode virar "backup": lê o arquivo inteiro (só o índice não pega truncamento)
docker exec -i "$CT" pg_restore -f /dev/null < "$ARQ.tmp" \
  || { erro "backup ilegível (pg_restore falhou ao ler o dump inteiro)"; exit 1; }
[ "$(wc -c < "$ARQ.tmp")" -gt 1000 ] || { erro "backup suspeito (muito pequeno)"; exit 1; }
mv "$ARQ.tmp" "$ARQ"
( cd "$DIR" && sha "$(basename "$ARQ")" > "$(basename "$ARQ").sha256" )
chmod 600 "$ARQ" "$ARQ.sha256"
find "$DIR" -name 'api-db-*.dump*' -mtime +"$RET" -delete
echo "$(date '+%F %T') backup ok: $ARQ ($(du -h "$ARQ" | cut -f1))"
