#!/usr/bin/env bash
# Publica a Central na VPS com REVERSAO AUTOMATICA (mesmo molde do deploy do PDV).
# Instalar como /root/deploy-central.sh. Uso: ssh op /root/deploy-central.sh [sha]
# Clone ISOLADO em /root/central-src (nunca /root/vessel: o cron das planilhas roda de la).
# So troca o symlink /var/www/central/atual; se o teste de fumaca falhar, volta sozinho.
#
# VIRADA (T+11 do roteiro): o front da API em Go e o MESMO codigo com `VITE_API_AREAS='*'` no build.
#   PREPARAR=1 VITE_API_AREAS='*' /root/deploy-central.sh <sha>   so constroi e confere; NAO troca o symlink, nao poda
#   REUSAR=1   VITE_API_AREAS='*' /root/deploy-central.sh <sha>   troca para a release ja construida (sem build) se ela
#                                                                 foi feita com o MESMO valor de VITE_API_AREAS
# Sem as duas variaveis o comportamento e o de sempre (constroi e troca). Com VITE_API_AREAS definida, o build so
# publica se o valor estiver gravado no pacote (a variavel esquecida ou errada nao chega ao ar calada).
set -u
REPO=${CENTRAL_REPO:-https://github.com/rbv-co/social-dashboard.git}
SRC=${CENTRAL_SRC:-/root/central-src}
BASE=${CENTRAL_BASE:-/var/www/central}
HOST=${CENTRAL_HOST:-https://central.rbvcompany.com}
# --resolve evita depender do DNS: valida a VPS mesmo antes/depois do corte.
RES="--resolve central.rbvcompany.com:443:127.0.0.1"
exec 9>/var/lock/deploy-central.lock
flock -n 9 || { echo "outro deploy da central em andamento"; exit 1; }

[ -d "$SRC/.git" ] || git clone -q "$REPO" "$SRC" || exit 1
cd "$SRC" || exit 1
git fetch -q origin && git checkout -q -f "${1:-origin/main}" || exit 1
SHA=$(git rev-parse --short HEAD); echo ">> build $SHA ($(git log -1 --format=%s | cut -c1-70))"

REL=$BASE/releases/$SHA
MARCA=$BASE/marcas/$SHA   # o VITE_API_AREAS com que a release foi construida (fora de releases/: nao entra na poda)
AREAS=${VITE_API_AREAS:-}
if [ "${REUSAR:-}" = 1 ] && [ -d "$REL" ] && [ -f "$MARCA" ] && [ "$(cat "$MARCA")" = "$AREAS" ]; then
  echo ">> release $SHA ja construida com VITE_API_AREAS='$AREAS': sem build"
else
  # so a raiz (Vue + Vite): o coletor/ tem 1,4 GB de fotos e dependencias proprias, nao entra no build
  NODE_OPTIONS=--max-old-space-size=1536 nice -n 19 npm ci --no-audit --no-fund >/dev/null 2>&1 \
    && NODE_OPTIONS=--max-old-space-size=1536 nice -n 19 npm run build >/tmp/central-build.log 2>&1 \
    || { echo "BUILD FALHOU (nada foi publicado):"; tail -15 /tmp/central-build.log; exit 1; }
  if [ -n "$AREAS" ] && ! grep -rqF "VITE_API_AREAS:\"$AREAS\"" dist/assets; then
    echo "BUILD SEM O VITE_API_AREAS='$AREAS' gravado no pacote (nada foi publicado)"; exit 1
  fi
  # a release NO AR nunca e apagada por um build do mesmo sha com outro VITE_API_AREAS
  if [ "$(readlink -f "$BASE/atual" 2>/dev/null)" = "$REL" ] && [ "$(cat "$MARCA" 2>/dev/null)" != "$AREAS" ]; then
    echo "release $SHA esta no ar com outro VITE_API_AREAS: nada foi publicado"; exit 1; fi
  mkdir -p "$BASE/releases" "$BASE/marcas" && rm -rf "$REL" && cp -r dist "$REL"
  # armadilha ja vista: arquivos 600/700 que o nginx (www-data) nao le
  find "$REL" -type f -exec chmod 644 {} + ; find "$REL" -type d -exec chmod 755 {} +
  printf '%s' "$AREAS" > "$MARCA"
fi
if [ "${PREPARAR:-}" = 1 ]; then echo "PREPARADO ($SHA, VITE_API_AREAS='$AREAS'): nada foi trocado"; exit 0; fi

ANTES=; [ -L "$BASE/atual" ] && ANTES=$(readlink -f "$BASE/atual"); [ -d "$ANTES" ] || ANTES=
ln -sfn "$REL" "$BASE/atual.novo" && mv -T "$BASE/atual.novo" "$BASE/atual"

fumaca() {
  local pacote c
  pacote=$(grep -oE '/assets/index-[A-Za-z0-9_-]+\.js' "$BASE/atual/index.html" | head -1)
  c() { curl -s -o /dev/null -w %{http_code} --max-time 8 $RES "$@"; }
  [ "$(c "$HOST/")" = 200 ] && [ "$(c "$HOST$pacote")" = 200 ] && [ "$(c "$HOST/sw-push.js")" = 200 ] \
    && [ "$(c "$HOST/escritorio-3d/")" = 200 ] && [ "$(c "$HOST/verify/ABC")" = 307 ] \
    && [ "$(c "$HOST/assets/nao-existe.js")" = 404 ]
}
if fumaca; then
  echo "DEPLOY OK ($SHA)"
  ls -1dt "$BASE"/releases/* | tail -n +6 | xargs -r rm -rf
  exit 0
fi
echo "FALHOU na fumaca: REVERTENDO"
if [ -n "$ANTES" ]; then ln -sfn "$ANTES" "$BASE/atual.novo" && mv -T "$BASE/atual.novo" "$BASE/atual"; echo "voltou para $ANTES"; else rm -f "$BASE/atual"; echo "sem release anterior: atual removido"; fi
exit 1
