#!/usr/bin/env bash
# Publica a API Go da Central (serviço `api` e, com --worker, também o `worker`) na VPS `op`,
# com trava, saúde, contagem de 5xx e REVERSÃO AUTOMÁTICA. Roda do Mac, de um checkout limpo da main.
#   deploy/publicar-api.sh [--worker] [--migrar-so-aditivas]
#
# Regras (CLAUDE.md do repositório, plano 08-D do INTEGRACAO-CORE-2026-10):
#  - só se publica o que JÁ está na origin/main (HEAD tem de ser ancestral dela e api/ estar limpa);
#  - imagem amd64 construída no Mac e enviada por `docker save | docker load` (não gasta a CPU da VPS);
#  - trava `flock` na VPS; backup do api-db (pg_dump) antes de migrar; `up -d --no-deps` (NUNCA --remove-orphans);
#  - `migrar` só roda se você passar --migrar-so-aditivas (você garante que as migrations novas são aditivas);
#  - depois: saúde dos containers, 3× /api/saude pelo nginx e 0 respostas 5xx em /api/ por OBSERVAR_S segundos;
#    qualquer falha volta o .env e os containers para as versões de antes e sai com código 1.
# Reversão manual: `API_VERSAO=<antes> docker compose up -d --no-deps --no-build --pull never api` em /root/api.
set -euo pipefail

WORKER=0; MIGRAR=0
for a in "$@"; do
  case "$a" in
    --worker) WORKER=1 ;;
    --migrar-so-aditivas) MIGRAR=1 ;;
    *) echo "uso: $0 [--worker] [--migrar-so-aditivas]"; exit 2 ;;
  esac
done
HOST=${DEPLOY_HOST:-op}
OBSERVAR_S=${OBSERVAR_S:-120}

cd "$(git rev-parse --show-toplevel)"
git fetch -q origin
git merge-base --is-ancestor HEAD origin/main || { echo "HEAD não está na origin/main: publicar só o que já está no GitHub"; exit 1; }
[ -z "$(git status --porcelain -- api)" ] || { echo "api/ tem alteração não commitada ou arquivo novo solto"; exit 1; }
VER=$(git rev-parse --short=8 HEAD)
SERVICOS=api; [ "$WORKER" = 1 ] && SERVICOS="api worker"

echo ">> build central-api:$VER (linux/amd64)"
docker buildx build --platform linux/amd64 -t "central-api:$VER" --load api >/dev/null
echo ">> enviando a imagem para $HOST"
docker save "central-api:$VER" | gzip -1 | ssh "$HOST" 'gunzip | docker load' >/dev/null

echo ">> publicando na VPS (serviços: $SERVICOS)"
# o script vai para um ARQUIVO na VPS e roda de lá: pela entrada padrão, o `docker compose run` engoliria o resto dele
# e a queda do ssh o mataria no meio da observação
scp -q "$(dirname "$0")/publicar-api-na-vps.sh" "$HOST:/root/.publicar-api-na-vps.sh"
ssh "$HOST" "flock -n /var/lock/deploy-api.lock bash /root/.publicar-api-na-vps.sh '$VER' '$SERVICOS' '$MIGRAR' '$OBSERVAR_S' </dev/null 2>&1 | tee -a /root/backups-api/deploy-$VER.log; exit \${PIPESTATUS[0]}" || { echo "DEPLOY NÃO CONCLUÍDO (ver acima)"; exit 1; }
