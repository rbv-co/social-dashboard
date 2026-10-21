#!/usr/bin/env bash
# Metade do deploy que roda NA VPS (enviada por ssh por publicar-api.sh, sob flock). Uso: bash -s -- <sha> "<serviços>" <migrar 0|1> <observar_s>
set -u
VER=$1; SERVICOS=$2; MIGRAR=$3; OBSERVAR_S=$4
# RAIZ, LOG_NGINX e BACKUPS só mudam no teste (publicar-api-na-vps.teste.sh)
RAIZ=${RAIZ:-/root/api}; LOG=${LOG_NGINX:-/var/log/nginx/central.access.log}; BACKUPS=${BACKUPS:-/root/backups-api}
cd "$RAIZ" || exit 1
antes() { docker inspect -f '{{.Config.Image}}' "$1" | cut -d: -f2; }
A_API=$(antes api-api-1); A_WORKER=$(antes api-worker-1)
echo "ANTES: api=$A_API worker=$A_WORKER; DEPOIS: $VER ($SERVICOS)"
docker image inspect "central-api:$VER" >/dev/null || { echo "imagem central-api:$VER não chegou"; exit 1; }

BK=$BACKUPS/deploy-$VER-$(date -u +%Y%m%dT%H%MZ).dump
docker exec api-db pg_dump -U api -Fc api > "$BK" && [ -s "$BK" ] || { echo "backup falhou"; rm -f "$BK"; exit 1; }
echo "backup: $BK"
cp .env ".env.bak-pre-$VER"

subir() { # $1 = versão da api, $2 = versão do worker; só os serviços de $SERVICOS (ou todos, na reversão)
  for s in $3; do
    v=$1; [ "$s" = worker ] && v=$2
    API_VERSAO=$v docker compose up -d --no-deps --no-build --pull never "$s" >/dev/null 2>&1 || return 1
  done
}
saudaveis() { # espera até 120 s todos os serviços pedidos ficarem healthy
  for s in $1; do
    for _ in $(seq 1 60); do
      [ "$(docker inspect -f '{{.State.Health.Status}}' "api-$s-1" 2>/dev/null)" = healthy ] && continue 2
      sleep 2
    done
    echo "api-$s-1 não ficou healthy"; return 1
  done
}
reverter() {
  echo "REVERTENDO para api=$A_API worker=$A_WORKER"
  cp ".env.bak-pre-$VER" .env
  subir "$A_API" "$A_WORKER" "$SERVICOS"; saudaveis "$SERVICOS" && echo "revertido e saudável" || echo "ATENÇÃO: reversão não ficou saudável"
  exit 1
}

if [ "$MIGRAR" = 1 ]; then
  API_VERSAO=$VER docker compose run --rm --pull never api migrar >/dev/null || { echo "migrar falhou (nada foi trocado)"; exit 1; }
fi
sed "s/^API_VERSAO=.*/API_VERSAO=$VER/" .env > .env.novo && cat .env.novo > .env && rm .env.novo   # cat preserva o modo 600
LINHAS=$(($(wc -l < "$LOG")))
subir "$VER" "$VER" "$SERVICOS" || reverter
saudaveis "$SERVICOS" || reverter
for i in 1 2 3; do
  c=$(curl -s -o /dev/null -w '%{http_code}' --resolve central.rbvcompany.com:443:127.0.0.1 https://central.rbvcompany.com/api/saude)
  [ "$c" = 200 ] || { echo "/api/saude respondeu $c"; reverter; }
  sleep 2
done
echo ">> observando 5xx por ${OBSERVAR_S}s"
sleep "$OBSERVAR_S"
# ponytail: se o log girar durante a observação, o tail cai no começo do arquivo novo (conta a mais, nunca a menos)
N5=$(($(tail -n +"$((LINHAS + 1))" "$LOG" 2>/dev/null | awk '$7 ~ /^\/api\// && $9 >= 500' | wc -l)))
[ "$N5" = 0 ] || { echo "$N5 respostas 5xx em /api/ depois do deploy"; reverter; }
echo "OK: api=$(antes api-api-1) worker=$(antes api-worker-1), 0 5xx, saúde 200 (3/3). Backup $BK; reversão: API_VERSAO=$A_API (api) / $A_WORKER (worker)"
