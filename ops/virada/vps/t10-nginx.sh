#!/bin/sh
# T+10 da virada (na VPS): o nginx da central passa a falar com a API Go (/api/, webhooks, arquivos e o dialeto do
# Supabase na raiz) e as rotas do Chatwoot passam ao modo `go`. Idempotente; com `nginx -t` antes de cada reload e
# reversão sozinha (site, snippets e conf.d como estavam) se o teste, o reload ou a conferência falharem (saída 1).
# Precisa de /root/virada/{nginx-central-api.conf,nginx-semquery.conf,api-arquivos-e-storage.conf,spool-nginx.sh}.
# Uso: sh /root/virada/t10-nginx.sh [bucket/objeto]   (o objeto, se dado, tem de dar 200 em /storage/v1/object/public/)
# Ensaio sem tocar no nginx de produção: TESTE=1 NGINX_DIR=/root/virada/nginx-teste sh t10-nginx.sh
#   (só aplica na CÓPIA e roda `nginx -t -c`; não recarrega nada, não olha a rede)
set -eu
V=${V:-/root/virada}
NGINX_DIR=${NGINX_DIR:-/etc/nginx}
SITE=${SITE:-$NGINX_DIR/sites-enabled/central.rbvcompany.com}
TESTE=${TESTE:-0}
HOST=central.rbvcompany.com
BK=$V/nginx
SEG="    include $NGINX_DIR/snippets/central-seguranca.conf;"
INC_API="    include $NGINX_DIR/snippets/central-api.conf;"
INC_ARQ="    include $NGINX_DIR/snippets/api-arquivos-e-storage.conf;"
CH=$NGINX_DIR/snippets/central-chatwoot.conf
nginx_t() { if [ "$TESTE" = 1 ]; then nginx -t -c "$NGINX_DIR/nginx.conf"; else nginx -t; fi; }
falha() { echo "FALHOU: $*" >&2; exit 1; }

for f in nginx-central-api.conf nginx-semquery.conf api-arquivos-e-storage.conf spool-nginx.sh; do [ -s "$V/$f" ] || falha "falta $V/$f"; done
# o ?token= do Chatwoot não pode ir ao saude.log: o formato não pode ter $request, $args nem $query_string
if grep -rhE '^\s*log_format\s+saude\b' "$NGINX_DIR" | grep -qE '\$(request|args|query_string|request_uri)\b'; then falha "log_format saude tem query"; fi
[ "$(grep -cxF "$SEG" "$SITE")" = 1 ] || falha "a linha do central-seguranca.conf não é única em $SITE"
if [ "$TESTE" != 1 ]; then
  [ "$(curl -s --max-time 5 http://127.0.0.1:8080/saude)" = ok ] || falha "a API não responde ok em 127.0.0.1:8080/saude (T+8 não fez o up?)"
fi

umask 077
TS=$(date +%Y%m%d-%H%M%S)
mkdir -p "$BK"
cp -p "$SITE" "$BK/site.$TS"
for s in central-api.conf api-arquivos-e-storage.conf central-chatwoot.conf; do [ -e "$NGINX_DIR/snippets/$s" ] && cp -p "$NGINX_DIR/snippets/$s" "$BK/$s.$TS"; done
[ -e "$NGINX_DIR/conf.d/semquery.conf" ] && cp -p "$NGINX_DIR/conf.d/semquery.conf" "$BK/semquery.conf.$TS"
echo "backup: $BK/*.$TS"

volta() {
  echo "FALHOU: $1; voltando o nginx anterior" >&2
  cat "$BK/site.$TS" > "$SITE"
  for s in central-api.conf api-arquivos-e-storage.conf central-chatwoot.conf; do
    if [ -e "$BK/$s.$TS" ]; then cp -p "$BK/$s.$TS" "$NGINX_DIR/snippets/$s"; else rm -f "$NGINX_DIR/snippets/$s"; fi
  done
  if [ -e "$BK/semquery.conf.$TS" ]; then cp -p "$BK/semquery.conf.$TS" "$NGINX_DIR/conf.d/semquery.conf"; else rm -f "$NGINX_DIR/conf.d/semquery.conf"; fi
  if nginx_t > /dev/null 2>&1; then [ "$TESTE" = 1 ] || nginx -s reload; else echo "ATENÇÃO: nginx -t falha até com o anterior" >&2; fi
  exit 1
}

# 1. rotas do Chatwoot no modo go (o central-api.conf depende do snippet: sem ele as duas rotas cairiam no /api/ e o
#    ?token= iria ao central.access.log). Se o spool estiver ligado, quem vira é o spool-desliga.sh (esvazia a fila antes).
modo=nenhum
if [ -e "$CH" ]; then
  if grep -q '127.0.0.1:8099' "$CH"; then modo=spool; elif grep -q '127.0.0.1:8080' "$CH"; then modo=go; else modo=edge; fi
fi
case $modo in
  spool) falha "as rotas do Chatwoot estão no modo spool: rode antes, do Mac, sh ops/virada/spool-desliga.sh go (esvazia a fila e vira)" ;;
  go) echo "rotas do Chatwoot: já em go" ;;
  *)
    if [ "$TESTE" = 1 ]; then
      NA_VPS=env sh "$V/spool-nginx.sh" go --imprimir > "$CH"
      grep -qxF "    include $CH;" "$SITE" || sed "/^$(printf '%s' "$SEG" | sed 's#[/.]#\\&#g')\$/a\\
    include $CH;" "$BK/site.$TS" > "$SITE"
    else
      NA_VPS=env BK=$V/spool sh "$V/spool-nginx.sh" go || falha "spool-nginx.sh go (ele já voltou o anterior)"
    fi ;;
esac

# 2. API Go: log_format, snippets e includes (cada include só se ainda não estiver)
install -m 644 "$V/nginx-semquery.conf" "$NGINX_DIR/conf.d/semquery.conf"
install -m 644 "$V/nginx-central-api.conf" "$NGINX_DIR/snippets/central-api.conf"
install -m 644 "$V/api-arquivos-e-storage.conf" "$NGINX_DIR/snippets/api-arquivos-e-storage.conf"
for inc in "$INC_API" "$INC_ARQ"; do
  grep -qxF "$inc" "$SITE" && continue
  cp "$SITE" "$SITE.novo"
  awk -v seg="$SEG" -v inc="$inc" '{print} $0 == seg {print inc}' "$SITE.novo" > "$SITE"
  rm -f "$SITE.novo"
done
for inc in "$INC_API" "$INC_ARQ"; do [ "$(grep -cxF "$inc" "$SITE")" = 1 ] || volta "include não ficou único: $inc"; done
nginx_t > "$BK/nginx-t.$TS" 2>&1 || { tail -3 "$BK/nginx-t.$TS" >&2; volta "nginx -t"; }
if [ "$TESTE" = 1 ]; then echo "ok (TESTE na cópia $NGINX_DIR): nginx -t passou; nada recarregado"; exit 0; fi
nginx -s reload || volta "reload"
sleep 2

# 3. conferência pela central (SNI/host da central, na própria máquina)
get() { curl -sk --max-time 10 -w ' %{http_code}' --resolve "$HOST:443:127.0.0.1" "https://$HOST$1" < /dev/null || echo "sem resposta"; }
r=$(get /api/saude); [ "$r" = "ok 200" ] || volta "/api/saude: $r"
r=$(get /api/receber-webhook-chatwoot); case $r in *' 405') ;; *) volta "rota do Chatwoot: $r" ;; esac
c=$(curl -sk --max-time 10 -o /dev/null -w '%{http_code}' --resolve "$HOST:443:127.0.0.1" "https://$HOST/" < /dev/null || true)
[ "$c" = 200 ] || volta "a raiz da central não deu 200 ($c)"
if [ -n "${1:-}" ]; then
  c=$(curl -sk --max-time 10 -o /dev/null -w '%{http_code}' --resolve "$HOST:443:127.0.0.1" "https://$HOST/storage/v1/object/public/$1" < /dev/null || true)
  [ "$c" = 200 ] || volta "/storage/v1/object/public/$1: $c"
fi
echo "ok: nginx -> API Go (/api/saude ok; Chatwoot 405 do Go; raiz 200${1:+; objeto 200}); anterior em $BK/*.$TS"
