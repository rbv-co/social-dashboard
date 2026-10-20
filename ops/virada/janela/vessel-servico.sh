#!/bin/bash
# Roda um serviço Node da Vessel na VPS contra o api-db: espelho da planilha (laço), lembretes (diário), carocos (a cada 10 min) ou contatos (lista de espera -> Bling, 1 min).
# Uso: vessel-servico <espelho|lembretes|carocos|contatos> [args do node]     (instalado em /usr/local/sbin por t19-vessel.sh)
# Env em texto: /root/secrets/vessel-servicos.env (DATABASE_URL do papel api_app com `@api-db:` + ZEPTOMAIL_TOKEN). O `@api-db:` vira o IP
# do contêiner na api_net a cada partida (o IP muda se o api-db for recriado: o serviço reinicia sozinho e acha o novo).
set -u
ENV=${VESSEL_ENV:-/root/secrets/vessel-servicos.env}; REPO=${REPO:-/opt/robos/social-dashboard}; NODE_BIN=${NODE_BIN:-/opt/cartoes-ean/node/bin}
qual=${1:-}; shift || true
case "$qual" in
  espelho) s=espelho-da-vessel-na-vps.mjs ;; lembretes) s=lembretes-da-vessel-na-vps.mjs ;; carocos) s=log-de-carocos.mjs ;; contatos) s=vessel-contatos-no-bling.mjs ;;
  *) echo "uso: $0 <espelho|lembretes|carocos|contatos> [args]" >&2; exit 64 ;;
esac
[ -r "$ENV" ] || { echo "sem $ENV" >&2; exit 78; }
while IFS= read -r l || [ -n "$l" ]; do
  [[ "$l" =~ ^[[:space:]]*([A-Za-z_][A-Za-z0-9_]*)=(.*)$ ]] || continue
  v="${BASH_REMATCH[2]}"; case "$v" in \"*\") v="${v:1:${#v}-2}" ;; \'*\') v="${v:1:${#v}-2}" ;; esac
  export "${BASH_REMATCH[1]}=$v"
done < "$ENV"
[ -z "${SEM_ZEPTOMAIL:-}" ] || export ZEPTOMAIL_TOKEN=   # prova dos lembretes: nada sai por e-mail
case "${DATABASE_URL:-}" in
  *@api-db:*) ip=$(docker inspect -f '{{(index .NetworkSettings.Networks "api_net").IPAddress}}' api-db 2>/dev/null)
              [ -n "$ip" ] || { echo "sem IP do api-db (docker inspect)" >&2; exit 1; }
              export DATABASE_URL="${DATABASE_URL//@api-db:/@$ip:}" ;;
  "") echo "sem DATABASE_URL em $ENV" >&2; exit 78 ;;
esac
export PATH="$NODE_BIN:$PATH"; cd "$REPO/coletor" || exit 78
exec nice -n 10 node "$s" "$@"
