#!/bin/sh
# Reenvia o que o spool guardou (plano 01, VIRADA-2026-10), em ordem de chegada, para a API Go (go) ou de volta
# à edge do Supabase (edge = rollback), e imprime o relatório: o JSON do reenviar, quantos eventos há em cada
# pasta e as requisições do Chatwoot que o nginx NÃO respondeu com 200 desde que o spool ligou (essas o
# Chatwoot não reenvia: vão para a conciliação com o revisor-eventos-meta). Repetir é inofensivo.
# Uso: sh ops/virada/spool-replay.sh go|edge   (NA_VPS como no spool-nginx.sh)
# Saída: a do reenviar: 0 = fila vazia e nada rejeitado; 1 = sobrou pendente ou rejeitado; 2 = uso/trava.
set -eu
[ $# -eq 1 ] && case $1 in go|edge) ;; *) false;; esac || { sed -n '2,7p' "$0" >&2; exit 2; }
BK=${BK:-/root/virada/spool}
NA_VPS=${NA_VPS:-ssh -o BatchMode=yes ${VPS:-op}}

{
  echo "set -eu"
  echo "DESTINO='$1' BK='$BK'"
  cat << 'NO_ALVO'
D=/var/lib/virada-spool
[ -d "$D" ] || { echo "FALHOU: $D não existe (o spool nunca ligou neste alvo)" >&2; exit 1; }
rc=0
python3 /usr/local/lib/virada/spool.py reenviar --dir "$D" --destino "$DESTINO" < /dev/null || rc=$?
conta() { find "$1" -maxdepth 1 -name '*.json' ! -name '.*' 2> /dev/null | wc -l; }
echo "pasta do spool (todas as janelas): $(conta "$D") pendentes, $(conta "$D/entregue") entregues, $(conta "$D/rejeitado") rejeitados"
if [ -e "$BK/inicio" ]; then
  # saude.log: "$time_iso8601 $host $status $request_method $uri", sem query (o ?token= não vai a log)
  cat /var/log/nginx/saude.log.1 /var/log/nginx/saude.log 2> /dev/null |
    awk -v ini="$(cat "$BK/inicio")" '$1 >= ini && $4 == "POST" && $5 ~ /^\/api\/receber-(webhook|opt-out)-chatwoot$/ && $3 != 200' > "$BK/nao-200.txt" || true
  echo "nginx, rotas do Chatwoot sem 200 desde $(cat "$BK/inicio"): $(wc -l < "$BK/nao-200.txt") (lista em $BK/nao-200.txt)"
  head -20 "$BK/nao-200.txt"
fi
exit $rc
NO_ALVO
} | $NA_VPS sh
