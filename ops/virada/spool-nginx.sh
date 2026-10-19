#!/bin/sh
# Quem atende as duas rotas do Chatwoot na central (plano 01, VIRADA-2026-10): edge (Supabase, como hoje),
# spool (disco, só na janela) ou go (API nova). Grava o snippet do modo, garante o include no server 443 da
# central, nginx -t e reload; se algo falhar, volta site e snippet anteriores. Confere por GET quem respondeu
# (o GET não grava nada em nenhum dos três). O ?token= do Chatwoot passa adiante e NUNCA vai a log.
# Uso: sh ops/virada/spool-nginx.sh edge|spool|go [--imprimir]   (--imprimir: só mostra o snippet)
#   NA_VPS: prefixo que roda "sh" no alvo (padrão: ssh op; ensaio: "docker exec -i <contêiner>").
# Saída: 0 = no modo pedido e conferido; 1 = falhou (nginx de volta ao anterior); 2 = uso.
set -eu
uso() { sed -n '2,8p' "$0" >&2; exit 2; }
MODO=${1:-}; [ $# -le 2 ] || uso
case $MODO in edge|spool|go) ;; *) uso;; esac
case ${2:-} in ''|--imprimir) ;; *) uso;; esac
SITE=${SITE:-/etc/nginx/sites-enabled/central.rbvcompany.com}
SNIPPET=${SNIPPET:-/etc/nginx/snippets/central-chatwoot.conf}
HOST=${HOST:-central.rbvcompany.com}
PORTA=${PORTA:-8099}
RESOLVER=${RESOLVER:-127.0.0.53}
BK=${BK:-/root/virada/spool}
NA_VPS=${NA_VPS:-ssh -o BatchMode=yes ${VPS:-op}}

snippet() {
  echo "# Gerado por ops/virada/spool-nginx.sh $MODO (social-dashboard). Não editar à mão: rodar o script."
  for r in receber-webhook-chatwoot receber-opt-out-chatwoot; do
    echo "location = /api/$r {"
    echo "    client_max_body_size 1m;"
    echo "    access_log /var/log/nginx/saude.log saude;  # sem query; tira a rota do central.access.log, que grava o ?token="
    echo "    error_log /var/log/nginx/chatwoot-erro.log crit;  # o nível error grava a linha da requisição, com o token"
    case $MODO in
      edge) cat << EOF
    resolver $RESOLVER valid=300s;
    set \$edge https://kounqtdoioootxqegkij.supabase.co/functions/v1;
    proxy_pass \$edge/$r\$is_args\$args;
    proxy_set_header Host \$proxy_host;
    proxy_ssl_server_name on;
    proxy_ssl_verify on;
    proxy_ssl_verify_depth 4;
    proxy_ssl_trusted_certificate /etc/ssl/certs/ca-certificates.crt;
EOF
      ;;
      spool) echo "    proxy_pass http://127.0.0.1:$PORTA/$r;" ;;
      go) cat << EOF
    proxy_set_header Host \$host;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_pass http://127.0.0.1:8080/$r;
EOF
      ;;
    esac
    echo "}"
  done
}

[ "${2:-}" = --imprimir ] && { snippet; exit 0; }

# um único "sh" no alvo: variáveis, snippet (heredoc) e o roteiro de troca com reversão
{
  echo "set -eu"
  printf "MODO='%s' SITE='%s' SNIPPET='%s' HOST='%s' BK='%s'\n" "$MODO" "$SITE" "$SNIPPET" "$HOST" "$BK"
  echo "cat > \"\$SNIPPET.novo\" << 'FIM_DO_SNIPPET'"
  snippet
  echo "FIM_DO_SNIPPET"
  cat << 'NO_ALVO'
umask 077
SEG='    include /etc/nginx/snippets/central-seguranca.conf;'
INC="    include $SNIPPET;"
TS=$(date +%Y%m%d-%H%M%S)
mkdir -p "$BK"
cp -p "$SITE" "$BK/site.$TS"
if [ -e "$SNIPPET" ]; then cp -p "$SNIPPET" "$BK/snippet.$TS"; fi
echo "backup: $BK/site.$TS $( [ -e "$BK/snippet.$TS" ] && echo "$BK/snippet.$TS" || echo '(sem snippet anterior)')"
volta() {
  echo "FALHOU: $1; voltando o anterior" >&2
  cat "$BK/site.$TS" > "$SITE"
  if [ -e "$BK/snippet.$TS" ]; then cp -p "$BK/snippet.$TS" "$SNIPPET"; else rm -f "$SNIPPET"; fi
  rm -f "$SNIPPET.novo"
  if nginx -t 2> /dev/null; then nginx -s reload; else echo "ATENÇÃO: nginx -t falha até com o anterior" >&2; fi
  exit 1
}
chmod 644 "$SNIPPET.novo"
mv "$SNIPPET.novo" "$SNIPPET"
if ! grep -qxF "$INC" "$SITE"; then
  [ "$(grep -cxF "$SEG" "$SITE")" = 1 ] || volta "linha do central-seguranca.conf não é única no $SITE"
  # cat > (e não sed -i): o site é arquivo comum hoje, mas se virar link o link continua link
  sed "/^$(printf '%s' "$SEG" | sed 's#[/.]#\\&#g')\$/a\\
$INC" "$BK/site.$TS" > "$SITE"
fi
[ "$(grep -cxF "$INC" "$SITE")" = 1 ] || volta "include do snippet não ficou único"
nginx -t > "$BK/nginx-t.$TS" 2>&1 || { tail -3 "$BK/nginx-t.$TS" >&2; volta "nginx -t"; }
nginx -s reload || volta "reload"
sleep 2  # workers novos assumem
resp=$(curl -sk --max-time 10 -w ' %{http_code}' --resolve "$HOST:443:127.0.0.1" "https://$HOST/api/receber-webhook-chatwoot" < /dev/null) || resp="sem resposta"
case "$MODO:$resp" in
  spool:*'"spool": true'*' 405') ;;
  edge:*'"ok":false'*' 405') ;;
  go:*' 405') case $resp in *'"spool"'*|*'"ok"'*) volta "esperava a API Go, veio: $resp";; esac ;;
  *) volta "esperava $MODO, veio: $resp" ;;
esac
echo "ok: rotas do Chatwoot -> $MODO (GET de conferência: $resp)"
NO_ALVO
} | $NA_VPS sh
