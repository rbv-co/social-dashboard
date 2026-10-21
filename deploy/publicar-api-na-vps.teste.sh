#!/usr/bin/env bash
# Teste da metade da VPS do deploy da API, com docker/curl/sleep falsos: caminho feliz, /api/saude != 200 e 5xx
# depois do deploy (os dois últimos têm de reverter .env e containers). Uso: deploy/publicar-api-na-vps.teste.sh
set -u
AQUI=$(cd "$(dirname "$0")" && pwd); FALHAS=0
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
mkdir "$T/bin" "$T/raiz" "$T/bk"
cat > "$T/bin/docker" <<'F'
#!/usr/bin/env bash
E=$ESTADO
case "$1 $2" in
  "inspect -f") if [[ "$3" == *Health* ]]; then echo healthy; else n=${4#api-}; n=${n%-1}; echo "central-api:$(cat "$E/$n")"; fi ;;
  "image inspect") ;;
  "exec api-db") echo dump ;;
  "compose up") echo "up ${@: -1} $API_VERSAO" >> "$E/chamadas"; echo "$API_VERSAO" > "$E/${@: -1}" ;;
  "compose run") echo "migrar $API_VERSAO" >> "$E/chamadas" ;;
esac
F
printf '#!/usr/bin/env bash\necho "${CODIGO_SAUDE:-200}"\n' > "$T/bin/curl"; printf '#!/usr/bin/env bash\n[ -n "${LINHA5XX:-}" ] && echo "$LINHA5XX" >> "$LOG_NGINX"\nexit 0\n' > "$T/bin/sleep"
chmod +x "$T/bin/"*

rodar() { # $1 nome, $2 código esperado de saída, $3 http da saúde, $4 linha de 5xx no log ("" = nenhuma), $5.. args
  local nome=$1 esperado=$2 saude=$3 linha5xx=$4; shift 4
  export ESTADO=$T/estado; rm -rf "$ESTADO"; mkdir "$ESTADO"; echo antiga > "$ESTADO/api"; echo antiga > "$ESTADO/worker"
  echo "API_VERSAO=antiga" > "$T/raiz/.env"; : > "$T/log"; : > "$ESTADO/chamadas"
  echo '1.1.1.1 - - [21/Oct/2026:13:13:50 +0000] "GET /api/x HTTP/2.0" 200 5 "-" "-"' >> "$T/log"
  PATH="$T/bin:$PATH" CODIGO_SAUDE=$saude LINHA5XX=$linha5xx RAIZ=$T/raiz LOG_NGINX=$T/log BACKUPS=$T/bk \
    bash "$AQUI/publicar-api-na-vps.sh" nova "$*" 0 1 >"$T/saida" 2>&1
  local rc=$?
  local env; env=$(cat "$T/raiz/.env"); local api; api=$(cat "$ESTADO/api"); local wk; wk=$(cat "$ESTADO/worker")
  echo "$nome: rc=$rc .env=$env api=$api worker=$wk"
  [ "$rc" = "$esperado" ] || { echo "  FALHOU: rc esperado $esperado"; FALHAS=$((FALHAS+1)); }
  RES_ENV=$env; RES_API=$api; RES_WK=$wk
}
ruim='2.2.2.2 - - [21/Oct/2026:13:14:00 +0000] "GET /api/pedidos HTTP/2.0" 502 5 "-" "-"'

rodar "feliz (api)" 0 200 "" api
[ "$RES_ENV" = "API_VERSAO=nova" ] && [ "$RES_API" = nova ] && [ "$RES_WK" = antiga ] || { echo "  FALHOU: só a api troca"; FALHAS=$((FALHAS+1)); }
rodar "feliz (api+worker)" 0 200 "" api worker
[ "$RES_WK" = nova ] || { echo "  FALHOU: worker não trocou"; FALHAS=$((FALHAS+1)); }
rodar "saude 503" 1 503 "" api worker
[ "$RES_ENV" = "API_VERSAO=antiga" ] && [ "$RES_API" = antiga ] && [ "$RES_WK" = antiga ] || { echo "  FALHOU: não reverteu"; FALHAS=$((FALHAS+1)); }
rodar "5xx depois do deploy" 1 200 "$ruim" api
[ "$RES_ENV" = "API_VERSAO=antiga" ] && [ "$RES_API" = antiga ] || { echo "  FALHOU: não reverteu"; FALHAS=$((FALHAS+1)); }
[ "$FALHAS" = 0 ] && echo "TUDO OK" || { echo "$FALHAS falha(s)"; exit 1; }
