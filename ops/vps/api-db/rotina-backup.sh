#!/bin/sh
# Rotina diária do backup do api-db (cron 03:40): dump + papéis, cópia cifrada fora da VPS e AVISO se qualquer
# etapa falhar. Antes (até 20/10/2026) a falha só ia para /var/log/backup-api-db.log: era o mesmo buraco que deixou o
# db-lavessel sem dump de 08 a 12/10. O aviso sai pelo monitor do host (e-mail; o WhatsApp está fora desde 13/09).
# `--conferir` (cron 04:15) é o vigia do vigia: avisa se NÃO existe dump de hoje (cron parado, flock preso, disco cheio).
# Variáveis opcionais (padrões = produção): BACKUP_DIR, AVISAR_CMD, OFFSITE_CMD, AQUI.
set -u
AQUI=${AQUI:-$(dirname "$0")}
DIR=${BACKUP_DIR:-/root/backups-api}
AVISAR_CMD=${AVISAR_CMD:-python3 /root/monitor/verificar.py --avisar}
OFFSITE_CMD=${OFFSITE_CMD:-sh $AQUI/backup-api-db-offsite.sh}
avisar() { $AVISAR_CMD "[BACKUP API-DB FALHOU] $(hostname) $(date +%F)" "$1" || true; }
if [ "${1:-}" = "--conferir" ]; then
  # 150 min: o dump das 03:40 tem de existir às 04:15 (e a falha de cópia fora já avisou na própria rotina)
  [ -n "$(find "$DIR" -name 'api-db-2*.dump' -mmin -150 2>/dev/null | head -1)" ] && exit 0
  avisar "nenhum dump do api-db nas últimas 2,5 h em $DIR: o cron das 03:40 não rodou ou falhou sem avisar."
  exit 1
fi
sh "$AQUI/backup-api-db.sh" || { avisar "backup-api-db.sh falhou (dump ou papéis). Log: /var/log/backup-api-db.log"; exit 1; }
$OFFSITE_CMD || { avisar "cópia cifrada para o Drive falhou; o dump local de hoje existe. Log: /var/log/backup-api-db.log"; exit 1; }
