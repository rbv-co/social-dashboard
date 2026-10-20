#!/bin/sh
# Cópia CIFRADA (gpg AES256, a mesma senha e o mesmo Drive do /usr/local/bin/backup-offsite) do backup do dia do
# api-db: dump, papéis e os segredos sem os quais o dump não vira serviço (senhas dos papéis, env da API e do worker).
# Vai para gdrive:backups-vps-op/AAAA-MM-DD/ ; a retenção de 7 dias é a do backup-offsite (apaga por idade, a pasta toda).
# Restaurar: ver RESTAURAR.md. Variáveis opcionais (padrões = produção): BACKUP_DIR, DESTINO, SENHA, SEGREDOS, RCLONE.
set -eu
umask 077
DIR=${BACKUP_DIR:-/root/backups-api}
DESTINO=${DESTINO:-gdrive:backups-vps-op}
SENHA=${SENHA:-/root/.backup-gpg-pass}
SEGREDOS=${SEGREDOS:-/root/secrets}
RCLONE=${RCLONE:-rclone}
DIA=$(date +%F)
erro() { echo "$(date '+%F %T') $*" >&2; }
[ -r "$SENHA" ] || { erro "senha do gpg ausente ($SENHA)"; exit 1; }
ARQ=$(ls -1t "$DIR"/api-db-2*.dump 2>/dev/null | head -1 || true)
[ -n "$ARQ" ] && [ -s "$ARQ" ] || { erro "nenhum dump em $DIR"; exit 1; }
# só vale o de hoje: um dump velho copiado como se fosse o do dia esconderia o backup que não rodou
[ -n "$(find "$ARQ" -mmin -1440)" ] || { erro "o dump mais novo ($ARQ) tem mais de 24 h"; exit 1; }
GLOB="${ARQ%.dump}.globals.sql"
[ -s "$GLOB" ] || { erro "sem os papéis ($GLOB)"; exit 1; }
TMP=$(mktemp -d /root/.backup-api-offsite.XXXXXX)
trap 'rm -rf "$TMP"' EXIT
cifra() { gpg --batch --yes --pinentry-mode loopback --passphrase-file "$SENHA" --symmetric --cipher-algo AES256 --compress-algo none -o "$2" "$1"; }
cifra "$ARQ" "$TMP/$(basename "$ARQ").gpg"
cifra "$GLOB" "$TMP/$(basename "$GLOB").gpg"
( cd "$SEGREDOS" && tar -czf "$TMP/api-db-segredos-$DIA.tar.gz" api-db.env api.env worker.env *.senha )
cifra "$TMP/api-db-segredos-$DIA.tar.gz" "$TMP/api-db-segredos-$DIA.tar.gz.gpg"
rm -f "$TMP/api-db-segredos-$DIA.tar.gz"
"$RCLONE" copy "$TMP" "$DESTINO/$DIA" --include "*.gpg" --retries 5 --low-level-retries 10
"$RCLONE" check "$TMP" "$DESTINO/$DIA" --include "*.gpg" --one-way
echo "$(date '+%F %T') backup-api-db-offsite ok: $DESTINO/$DIA ($(basename "$ARQ"))"
