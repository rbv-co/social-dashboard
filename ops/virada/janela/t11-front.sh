#!/bin/bash
# T+11 da virada: o front da Central passa a falar com a API em Go (`VITE_API_AREAS='*'` no build). O build leva
# minutos e roda na VPS: por isso se CONSTRÓI ANTES (preparar, não troca nada) e na janela só se TROCA o symlink
# (aplicar, segundos), com a fumaça e a reversão do deploy-central.sh. Roda na VPS, como root.
#
#   sh t11-front.sh preparar <sha>   constrói a release com VITE_API_AREAS='*', confere que o valor está no pacote e anota
#                                    o sha em /root/virada/front-sha.txt. NÃO troca o symlink (pode rodar a qualquer hora).
#   sh t11-front.sh aplicar <sha>    (JANELA, só a orquestradora; depois do T+10: nginx com /api/) troca para a release
#                                    preparada, fumaça por --resolve, confere /api/saude e o pacote no ar; falhou => volta
#   sh t11-front.sh reverter         devolve o front de ANTES (a release de /root/virada/front-antes.txt, o front do
#                                    Supabase), atômico, e confere. É o "volta = B" do roteiro para o front.
#
# O <sha> é o do `main` do social-dashboard com TUDO mergeado (o da orquestradora no runbook); o `preparar` e o `aplicar`
# TÊM de receber o mesmo (o `aplicar` recusa release que não foi preparada com o mesmo VITE_API_AREAS).
set -eu
V=${V:-/root/virada}; BASE=${CENTRAL_BASE:-/var/www/central}; HOST=${CENTRAL_HOST:-https://central.rbvcompany.com}
DEPLOY=${DEPLOY_CENTRAL:-/root/deploy-central.sh}; RES="--resolve central.rbvcompany.com:443:127.0.0.1"
modo=${1:-}; sha=${2:-}
falha() { echo "FALHOU: $*" >&2; exit 1; }
c() { curl -s -o /dev/null -w '%{http_code}' --max-time 8 $RES "$@"; }

case "$modo" in
preparar)
  [ -n "$sha" ] || falha "uso: t11-front.sh preparar <sha>"
  saida=$(PREPARAR=1 REUSAR=1 VITE_API_AREAS='*' "$DEPLOY" "$sha" 2>&1) || { echo "$saida" | tail -8; falha "o preparo não terminou (nada foi trocado)"; }
  echo "$saida" | tail -3
  curto=$(echo "$saida" | sed -n 's/^>> build \([0-9a-f]*\) .*/\1/p' | head -1); [ -n "$curto" ] || falha "não achei o sha construído na saída"
  [ -f "$BASE/marcas/$curto" ] && [ "$(cat "$BASE/marcas/$curto")" = '*' ] || falha "release $curto sem a marca VITE_API_AREAS='*'"
  grep -rqF 'VITE_API_AREAS:"*"' "$BASE/releases/$curto/assets" || falha "pacote $curto sem VITE_API_AREAS gravado"
  printf '%s\n' "$curto" > "$V/front-sha.txt"
  echo "PREPARADO: release $curto com VITE_API_AREAS='*' (sha anotado em $V/front-sha.txt); front no ar: $(basename "$(readlink -f "$BASE/atual")")" ;;
aplicar)
  [ -n "$sha" ] || falha "uso: t11-front.sh aplicar <sha>"
  # a release NO AR agora é a da reversão (e vale mais que o front-antes.txt do P12, que pode estar velho)
  antes=$(readlink -f "$BASE/atual") && [ -d "$antes" ] || falha "não há release no ar para voltar: não troco"
  [ "$(cat "$BASE/marcas/$(basename "$antes")" 2>/dev/null)" != '*' ] || falha "o front no ar ($(basename "$antes")) já é o da API em Go: nada a aplicar (para voltar: reverter)"
  printf '%s\n' "$antes" > "$V/front-antes-t11.txt"
  [ "$antes" = "$(cat "$V/front-antes.txt" 2>/dev/null)" ] || echo "ATENÇÃO: o no ar ($antes) difere do P12 ($V/front-antes.txt); a reversão usa o no ar"
  [ "$(curl -s --max-time 8 $RES "$HOST/api/saude")" = ok ] || falha "$HOST/api/saude não responde ok: o nginx do T+10 (include do /api/) não está no ar"
  REUSAR=1 VITE_API_AREAS='*' "$DEPLOY" "$sha" | tail -4 | tee /tmp/t11-front.log
  grep -q "DEPLOY OK" /tmp/t11-front.log || falha "deploy-central não confirmou (ele já reverteu sozinho se trocou); front no ar: $(basename "$(readlink -f "$BASE/atual")")"
  grep -q "sem build" /tmp/t11-front.log || echo "ATENÇÃO: o deploy CONSTRUIU na janela (a release não estava preparada com o mesmo sha)"
  grep -rqF 'VITE_API_AREAS:"*"' "$BASE/atual/assets" || { echo "pacote no ar SEM VITE_API_AREAS: REVERTENDO"; "$0" reverter; exit 1; }
  [ "$(c "$HOST/api/saude")" = 200 ] || { echo "/api/saude não deu 200 depois da troca: REVERTENDO"; "$0" reverter; exit 1; }
  echo "T+11 FRONT OK ($(basename "$(readlink -f "$BASE/atual")")): reversão = sh t11-front.sh reverter" ;;
reverter)
  arq="$V/front-antes-t11.txt"; [ -s "$arq" ] || arq="$V/front-antes.txt"
  [ -s "$arq" ] || falha "sem front-antes-t11.txt nem front-antes.txt"
  antes=$(cat "$arq"); [ -d "$antes" ] || falha "release $antes não existe mais"
  ln -sfn "$antes" "$BASE/atual.novo" && mv -T "$BASE/atual.novo" "$BASE/atual"
  [ "$(c "$HOST/")" = 200 ] || falha "voltei para $antes mas $HOST/ não deu 200"
  echo "REVERTIDO: front de antes no ar ($(basename "$antes"))" ;;
*) echo "uso: sh t11-front.sh preparar <sha> | aplicar <sha> | reverter" >&2; exit 2 ;;
esac
