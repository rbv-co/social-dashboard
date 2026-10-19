#!/bin/sh
# T+16 da virada (na VPS): o Chatwoot manda os eventos de CRM para a API Go (a central), com o MESMO ?token=.
# Só a variável CRM_EVENT_WEBHOOK_URL do /opt/chatwoot/.env muda (o webhook de conta "Message created" e o opt-out
# NÃO existem no Chatwoot de produção: tabela webhooks vazia em 19/10; se o dono cadastrar um, a URL é
# https://central.rbvcompany.com/api/receber-opt-out-chatwoot?token=<o mesmo>). Recria só rails e sidekiq com a
# MESMA imagem (nada de build: o deploy.sh do Chatwoot reconstrói a imagem, minutos de CPU no meio da janela).
# Confere a variável dentro do contêiner e o GET da rota pela central (405 do Go; edge/spool respondem outro corpo);
# se algo falhar, volta o .env anterior, recria de novo e sai 1. Guarda o anterior em /root/virada/chatwoot/.
# CONFERE_EDGE=1 (P17, antes da janela): a conferência final espera a edge atrás da central ({"ok":false} 405) em vez do Go.
# Uso: sh /root/virada/t16-chatwoot-go.sh [--imprimir]   (--imprimir: só mostra host antigo -> novo, sem tocar em nada)
set -eu
V=${V:-/root/virada}
DIR=${CHATWOOT_DIR:-/opt/chatwoot}
ENV=$DIR/.env
NOVO_BASE=${CENTRAL_BASE:-https://central.rbvcompany.com}
LINHA=$(grep -E '^CRM_EVENT_WEBHOOK_URL=' "$ENV") || { echo "FALHOU: CRM_EVENT_WEBHOOK_URL ausente em $ENV" >&2; exit 1; }
[ "$(printf '%s\n' "$LINHA" | wc -l)" = 1 ] || { echo "FALHOU: CRM_EVENT_WEBHOOK_URL repetida em $ENV" >&2; exit 1; }
URL=${LINHA#CRM_EVENT_WEBHOOK_URL=}
case $URL in *'?token='*) TOKEN=${URL#*\?token=} ;; *) echo "FALHOU: a URL atual não tem ?token=" >&2; exit 1 ;; esac
# o token entra num sed e numa URL: só caracteres de token (nada de &, # ou barra)
case $TOKEN in ''|*[!A-Za-z0-9._~-]*) echo "FALHOU: token vazio ou com caractere fora de [A-Za-z0-9._~-]" >&2; exit 1 ;; esac
NOVA="$NOVO_BASE/api/receber-webhook-chatwoot?token=$TOKEN"
host() { printf '%s' "$1" | sed -E 's#(://[^/?]+).*#\1#'; }
if [ "$URL" = "$NOVA" ]; then
  for c in chatwoot-rails-1 chatwoot-sidekiq-1; do
    docker exec "$c" printenv CRM_EVENT_WEBHOOK_URL 2> /dev/null | grep -qxF "$NOVA" || { echo "FALHOU: o .env já está na central mas $c ainda não (execução anterior interrompida?): recrie rails e sidekiq" >&2; exit 1; }
  done
  echo "já na central ($(host "$URL")): nada a fazer"; exit 0
fi
echo "CRM_EVENT_WEBHOOK_URL: $(host "$URL") -> $(host "$NOVA")"
[ "${1:-}" = --imprimir ] && exit 0

umask 077
mkdir -p "$V/chatwoot"
TS=$(date +%Y%m%d-%H%M%S)
cp -p "$ENV" "$V/chatwoot/env.$TS"
exec 9> "$DIR/.deploy.lock"
flock -n 9 || { echo "FALHOU: deploy do Chatwoot em andamento ($DIR/.deploy.lock)" >&2; exit 1; }
cd "$DIR"
# a imagem que ESTÁ rodando (o .image_tag é gravado pelo deploy.sh antes da migration e dos testes de saúde: depois de um
# deploy que falhou ele aponta para uma imagem ruim)
IMAGE_TAG=$(docker inspect -f '{{.Config.Image}}' chatwoot-rails-1 | sed 's/.*://')
[ -n "$IMAGE_TAG" ] || { echo "FALHOU: não li a imagem do chatwoot-rails-1" >&2; exit 1; }
export IMAGE_TAG
sobe() { docker compose -f docker-compose.deploy.yml up -d --no-deps rails sidekiq; }
saudavel() { # rails healthy em até 3 min
  for _ in $(seq 1 90); do
    [ "$(docker inspect -f '{{.State.Health.Status}}' chatwoot-rails-1 2> /dev/null)" = healthy ] && return 0
    sleep 2
  done
  return 1
}
volta() {
  echo "FALHOU: $1; voltando o .env anterior" >&2
  cat "$V/chatwoot/env.$TS" > "$ENV"
  sobe > /dev/null 2>&1 || true
  saudavel || echo "ATENÇÃO: rails não ficou healthy depois da volta" >&2
  exit 1
}
# cat > (e não sed -i): preserva dono, modo e inode do arquivo que o compose lê
sed "s#^CRM_EVENT_WEBHOOK_URL=.*#CRM_EVENT_WEBHOOK_URL=$NOVA#" "$V/chatwoot/env.$TS" > "$ENV"
[ "$(grep -c '^CRM_EVENT_WEBHOOK_URL=' "$ENV")" = 1 ] || volta "linha não ficou única"
sobe || volta "docker compose up"
saudavel || volta "rails não ficou healthy"
for c in chatwoot-rails-1 chatwoot-sidekiq-1; do
  docker exec "$c" printenv CRM_EVENT_WEBHOOK_URL 2> /dev/null | grep -qxF "$NOVA" || volta "$c sem a URL nova"
done
resp=$(curl -sk --max-time 10 -w ' %{http_code}' --resolve "central.rbvcompany.com:443:127.0.0.1" "$NOVO_BASE/api/receber-webhook-chatwoot" < /dev/null) || resp="sem resposta"
if [ "${CONFERE_EDGE:-0}" = 1 ]; then
  # P17 (antes da janela): a central faz proxy à edge do Supabase, que responde {"ok":false} 405 ao GET
  case $resp in *'"spool"'*) volta "esperava a edge, veio o spool: $resp" ;; *'"ok":false'*' 405') ;; *) volta "esperava 405 da edge ({\"ok\":false}), veio: $resp" ;; esac
else
  case $resp in *'"ok"'*|*'"spool"'*|"sem resposta") volta "a rota da central não é a do Go: $resp" ;; *' 405') ;; *) volta "esperava 405 da API Go, veio: $resp" ;; esac
fi
echo "ok: Chatwoot -> $(host "$NOVA") (rails e sidekiq recriados; GET de conferência: $resp; env anterior em $V/chatwoot/env.$TS)"
