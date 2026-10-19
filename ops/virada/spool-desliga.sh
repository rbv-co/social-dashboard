#!/bin/sh
# Desliga o spool do Chatwoot (plano 01, VIRADA-2026-10): esvazia a fila no destino com o spool ainda
# recebendo, vira as duas rotas do Chatwoot para o destino (spool-nginx.sh), para o serviço (o SIGTERM espera
# os POSTs em curso) e reenvia o que chegou nesse meio-tempo. go = fim da janela (API nova); edge = rollback.
# Se o destino não aceitar a fila, NÃO desliga: o spool segue recebendo e nada se perde.
# O diretório /var/lib/virada-spool fica como evidência (entregue/ e rejeitado/).
# Uso: sh ops/virada/spool-desliga.sh go|edge   (NA_VPS como no spool-nginx.sh)
# Saída: 0 = desligado e fila vazia; 1 = falhou (ver a etapa na mensagem); 2 = uso.
set -eu
[ $# -eq 1 ] && case $1 in go|edge) ;; *) false;; esac || { sed -n '2,8p' "$0" >&2; exit 2; }
AQUI=$(dirname "$0")
BK=${BK:-/root/virada/spool}
NA_VPS=${NA_VPS:-ssh -o BatchMode=yes ${VPS:-op}}

# duas rodadas: a 1ª pode levar minutos (5/s); a 2ª pega o que chegou durante ela e deixa só segundos até o nginx
for _ in 1 2; do
  sh "$AQUI/spool-replay.sh" "$1" || { echo "spool-desliga: a fila não esvaziou em $1 ou houve REJEITADO (ver acima e a pasta rejeitado/); spool continua ligado e recebendo" >&2; exit 1; }
done
sh "$AQUI/spool-nginx.sh" "$1" || { echo "spool-desliga: nginx não virou; spool continua ligado e recebendo" >&2; exit 1; }
# ponytail: nos segundos entre a 2ª rodada e o nginx, um evento vivo pode chegar ao destino antes do último do
# spool. Inofensivo: o Go guarda 1 por conversation_id+tipo com o created_at do corpo, e cada um é de conversa
# diferente na prática. Ordem estrita exigiria segurar o tráfego vivo no nginx, o que o Chatwoot não tolera (5 s).
$NA_VPS sh << 'NO_ALVO'
set -eu
systemctl disable -q --now virada-spool
rm -f /etc/systemd/system/virada-spool.service
systemctl daemon-reload
echo "virada-spool parado e removido; eventos em /var/lib/virada-spool"
NO_ALVO
rc=0
sh "$AQUI/spool-replay.sh" "$1" || rc=$?
if [ $rc -ne 0 ]; then
  echo "spool-desliga: sobrou fila depois de desligar; rodar spool-replay.sh $1 até sair 0" >&2
  exit 1
fi
# janela encerrada: o próximo liga começa outro relatório
echo "[ ! -e '$BK/inicio' ] || mv '$BK/inicio' '$BK/janela-ate-'\$(date +%Y%m%d-%H%M%S)" | $NA_VPS sh
echo "ok: spool desligado; rotas do Chatwoot -> $1"
