#!/bin/bash
# Prova (sem VPS, sem build, sem nginx) da lógica do t11-front.sh: preparar não troca nada; aplicar recusa sem /api/saude,
# recusa o que já é o front do Go, troca e confere o pacote; reverter devolve o front de antes. deploy e curl são falsos.
set -eu
AQUI=$(cd "$(dirname "$0")" && pwd); T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
fail() { echo "FALHOU: $*"; exit 1; }
B="$T/central"; mkdir -p "$B/releases/a0000001/assets" "$B/releases/b0000002/assets" "$B/marcas" "$T/v" "$T/bin"
echo 'x' > "$B/releases/a0000001/assets/a.js"; echo 'o={VITE_API_AREAS:"*"}' > "$B/releases/b0000002/assets/a.js"
ln -sfn "$B/releases/a0000001" "$B/atual"
printf '%s\n' "$B/releases/a0000001" > "$T/v/front-antes.txt"
# deploy falso: PREPARAR só marca; senão (REUSAR) troca o symlink para a release do sha e diz "sem build"
cat > "$T/deploy" <<'X'
#!/bin/sh
echo ">> build $1 (falso)"
if [ "$PREPARAR" = 1 ]; then printf '*' > "$CENTRAL_BASE/marcas/$1"; echo "PREPARADO ($1)"; exit 0; fi
[ "${FAKE_DEPLOY:-ok}" = ok ] || { echo "FALHOU na fumaca"; exit 1; }
ln -sfn "$CENTRAL_BASE/releases/$1" "$CENTRAL_BASE/atual"; echo ">> release $1 ja construida com VITE_API_AREAS='*': sem build"; echo "DEPLOY OK ($1)"
X
# curl falso: /api/saude responde conforme FAKE_SAUDE; o resto dá 200
cat > "$T/bin/curl" <<'X'
#!/bin/sh
case "$*" in *-w*) echo 200 ;; *) [ "${FAKE_SAUDE:-ok}" = ok ] && printf ok || printf erro ;; esac
X
printf '#!/bin/sh\n[ "$1" = -T ] && { shift; rm -f "$2"; }\nexec /bin/mv "$@"\n' > "$T/bin/mv"  # o mv do Mac não tem -T
chmod +x "$T/deploy" "$T/bin/curl" "$T/bin/mv"
export PATH="$T/bin:$PATH" V="$T/v" CENTRAL_BASE="$B" DEPLOY_CENTRAL="$T/deploy"
S="sh $AQUI/t11-front.sh"
atual() { basename "$(readlink -f "$B/atual")"; }
# preparar: grava o sha, não troca o symlink
$S preparar b0000002 > "$T/o" 2>&1 || { cat "$T/o"; fail "preparar"; }
[ "$(cat "$T/v/front-sha.txt")" = b0000002 ] && [ "$(atual)" = a0000001 ] || fail "preparar trocou algo ou não anotou o sha"
# aplicar sem /api/saude: recusa e não troca
FAKE_SAUDE=erro $S aplicar b0000002 > "$T/o" 2>&1 && fail "aplicar deveria recusar sem /api/saude" || true
[ "$(atual)" = a0000001 ] || fail "trocou sem /api/saude"
# aplicar com o deploy falhando: não troca
FAKE_DEPLOY=falha $S aplicar b0000002 > "$T/o" 2>&1 && fail "aplicar deveria sair 1" || true
[ "$(atual)" = a0000001 ] || fail "trocou com o deploy falho"
# aplicar ok
$S aplicar b0000002 > "$T/o" 2>&1 || { cat "$T/o"; fail "aplicar"; }
[ "$(atual)" = b0000002 ] && grep -q "T+11 FRONT OK" "$T/o" || fail "não trocou para a release nova"
[ "$(cat "$T/v/front-antes-t11.txt")" = "$(cd "$B/releases/a0000001" && pwd -P)" ] || fail "não guardou a release de antes"
# aplicar de novo: recusa (o no ar já é o do Go)
echo '*' | tr -d '\n' > "$B/marcas/b0000002"
$S aplicar b0000002 > "$T/o" 2>&1 && fail "aplicar de novo deveria recusar" || grep -q "já é o da API em Go" "$T/o" || fail "mensagem de já aplicado"
# reverter
$S reverter > "$T/o" 2>&1 || { cat "$T/o"; fail "reverter"; }
[ "$(atual)" = a0000001 ] || fail "reverter não voltou"
echo "t11-front.teste.sh OK"
