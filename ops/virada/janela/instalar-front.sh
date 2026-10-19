#!/bin/sh
# Instala na VPS os scripts do front e do PDV da janela (plano 09): t11-front.sh e t17-pdv.sh em /root/virada, e o
# deploy-central.sh novo (PREPARAR/REUSAR; compatível com o uso de sempre) em /root/deploy-central.sh, guardando o antigo.
# NÃO liga nada, não troca front, não mexe no PDV. Roda NA VPS como root, de um clone na `main` (git pull antes).
# (t17-site.sh NÃO vem para a VPS: roda no Mac da orquestradora, que tem o push do vessel-brasil.)
# Uso: sh instalar-front.sh [RAIZ=/opt/robos/social-dashboard]
set -eu
RAIZ=${1:-/opt/robos/social-dashboard}; VIRADA=${VIRADA:-/root/virada}; BACKUP=${BACKUP:-/root/backups/virada}
DEPLOY=${DEPLOY_CENTRAL:-/root/deploy-central.sh}
J="$RAIZ/ops/virada/janela"; [ -f "$J/t11-front.sh" ] || { echo "FALHOU: $J/t11-front.sh não existe (git pull?)" >&2; exit 1; }
mkdir -p "$VIRADA" "$BACKUP"; chmod 700 "$VIRADA"
for f in t11-front.sh t17-pdv.sh; do install -m 755 "$J/$f" "$VIRADA/$f"; done
if ! cmp -s "$RAIZ/deploy/publicar-central.sh" "$DEPLOY"; then
  [ ! -e "$DEPLOY" ] || cp -p "$DEPLOY" "$BACKUP/deploy-central.sh.$(date -u +%Y%m%dT%H%M%SZ)"
  install -m 755 "$RAIZ/deploy/publicar-central.sh" "$DEPLOY"; echo "deploy-central.sh atualizado (antigo em $BACKUP)"
fi
( cd "$VIRADA" && sha256sum t11-front.sh t17-pdv.sh > MANIFESTO-front.sha256 && sha256sum "$DEPLOY" >> MANIFESTO-front.sha256 )
echo "FRONT/PDV INSTALADOS em $VIRADA (MANIFESTO-front.sha256)"
