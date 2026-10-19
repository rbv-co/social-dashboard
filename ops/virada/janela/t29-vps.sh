#!/bin/sh
# Lado da VPS da Fase A (T-29) e do desfazer. Roda NA VPS como root; t29-fase-a.sh / t29-desfazer.sh o chamam por ssh.
# Uso: sh t29-vps.sh <fase-a|desfazer>
#   fase-a   guarda o cron.d atual em $VIRADA/robos-social-dashboard (se já havia uma cópia diferente, ela vira .anterior), tira o cron.d e para o serviço de Cartões
#            (o serviço se chama `cartoes-ean`; `cartoes-ean-vigia` NÃO existe como unit: é o nome do script).
#   desfazer devolve o cron.d (cp, não mv: idempotente) e sobe o serviço. Não mexe em robos.env (isso é do t17-robos.sh).
# Variáveis só para o ensaio com diretórios falsos: CRON, VIRADA, SYSTEMCTL, UNIDADE, LOCKS.
set -eu
CRON=${CRON:-/etc/cron.d/robos-social-dashboard}; VIRADA=${VIRADA:-/root/virada}
SYSTEMCTL=${SYSTEMCTL:-systemctl}; UNIDADE=${UNIDADE:-cartoes-ean}; LOCKS=${LOCKS:-/var/lock}
ACAO=${1:-}; NOME=$(basename "$CRON"); GUARDA="$VIRADA/$NOME"
case "$ACAO" in
fase-a)
  mkdir -p "$VIRADA"
  if [ -e "$CRON" ]; then
    # o cron.d de AGORA é o que o rollback tem de devolver: se já havia cópia diferente (P12 do plano 08, de antes), ela vira .anterior
    if [ -e "$GUARDA" ] && ! cmp -s "$CRON" "$GUARDA"; then mv "$GUARDA" "$GUARDA.anterior"; fi
    [ -e "$GUARDA" ] || cp -p "$CRON" "$GUARDA"
    cmp -s "$CRON" "$GUARDA" || { echo "FALHOU: não consegui guardar $CRON em $GUARDA" >&2; exit 1; }; rm -f "$CRON"
  elif [ ! -e "$GUARDA" ]; then echo "FALHOU: sem $CRON e sem $GUARDA (nada guardado para desfazer)" >&2; exit 1; fi
  $SYSTEMCTL stop "$UNIDADE"
  [ "$($SYSTEMCTL is-active "$UNIDADE" 2>/dev/null || true)" != active ] || { echo "FALHOU: $UNIDADE continua ativo" >&2; exit 1; }
  # robô já em execução termina sozinho (o cron novo não o inicia de novo); só avisa quais ainda estão de pé
  em=0; for l in "$LOCKS"/robo-*.lock; do [ -e "$l" ] || continue; flock -n "$l" true 2>/dev/null || { echo "ainda rodando: $(basename "$l" .lock | sed s/^robo-//)"; em=$((em+1)); }; done
  echo "FASE A OK: cron.d fora ($GUARDA guardado), $UNIDADE parado, $em robô(s) ainda terminando" ;;
desfazer)
  [ -e "$GUARDA" ] || { echo "FALHOU: sem $GUARDA" >&2; exit 1; }
  install -m 644 -o root -g root "$GUARDA" "$CRON" 2>/dev/null || { cp "$GUARDA" "$CRON"; chmod 644 "$CRON"; }
  cmp -s "$GUARDA" "$CRON" || { echo "FALHOU: $CRON difere do guardado" >&2; exit 1; }
  $SYSTEMCTL start "$UNIDADE"
  echo "DESFEITO: cron.d de volta, $UNIDADE iniciado" ;;
*) sed -n '2,8p' "$0" >&2; exit 2 ;;
esac
