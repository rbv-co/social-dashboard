#!/bin/sh
# Inverso do t29-fase-a.sh (rollback A4): cron.d de volta, `cartoes-ean` iniciado e `gh workflow enable` do que estava ATIVO antes.
# Idempotente. Uso: sh t29-desfazer.sh <D=pasta de trabalho da virada> [--sem-vps]
# Depois da troca (T+17) NÃO use este script sozinho: o robos.env novo aponta para o api-db (rollback B5 do roteiro).
set -eu
AQUI=$(cd "$(dirname "$0")" && pwd)
D=${1:-}; [ -s "$D/workflows-ativos-antes.txt" ] || { echo "sem $D/workflows-ativos-antes.txt (a Fase A não rodou por aqui)" >&2; exit 2; }
HOST=${HOST:-op}; GH_REPO=${GH_REPO:-rbv-co/social-dashboard}; GH=${GH:-gh}
if [ "${2:-}" != --sem-vps ]; then
  if [ -n "${LOCAL:-}" ]; then sh -s desfazer < "$AQUI/t29-vps.sh"; else ssh "$HOST" sh -s desfazer < "$AQUI/t29-vps.sh"; fi
fi
grep -Fxf "$D/workflows.txt" "$D/workflows-ativos-antes.txt" | while read -r w; do [ -n "$w" ] || continue; $GH workflow enable "$(basename "$w")" -R "$GH_REPO"; done
echo "DESFEITO (robôs + Actions)"
