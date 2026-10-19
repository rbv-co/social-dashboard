#!/bin/sh
# Liga o spool do Chatwoot na janela da virada (plano 01, VIRADA-2026-10): instala ops/virada/spool.py no alvo
# como serviço (virada-spool, 127.0.0.1:8099, eventos em /var/lib/virada-spool: fora de qualquer volume do
# Docker, que o T+1 apaga), espera o /saude e vira as duas rotas do Chatwoot para ele (spool-nginx.sh spool).
# Repetir é inofensivo: não apaga evento e não reinicia o serviço que já roda. Desligar: spool-desliga.sh go|edge.
# Uso: sh ops/virada/spool-liga.sh   (NA_VPS como no spool-nginx.sh)
# Saída: 0 = spool recebendo e nginx apontado para ele; 1 = falhou (nginx fica como estava); 2 = uso.
set -eu
[ $# -eq 0 ] || { sed -n '2,7p' "$0" >&2; exit 2; }
AQUI=$(dirname "$0")
BK=${BK:-/root/virada/spool}
NA_VPS=${NA_VPS:-ssh -o BatchMode=yes ${VPS:-op}}

{
  echo "set -eu"
  echo "BK='$BK'"
  echo "mkdir -p /usr/local/lib/virada"
  echo "cat > /usr/local/lib/virada/spool.py.novo << 'FIM_DO_SPOOL'"
  cat "$AQUI/spool.py"
  echo "FIM_DO_SPOOL"
  cat << 'NO_ALVO'
chmod 644 /usr/local/lib/virada/spool.py.novo
mv /usr/local/lib/virada/spool.py.novo /usr/local/lib/virada/spool.py
cat > /etc/systemd/system/virada-spool.service << 'FIM_DA_UNIT'
# Gerado por ops/virada/spool-liga.sh (social-dashboard); spool-desliga.sh remove.
[Unit]
Description=Spool dos webhooks do Chatwoot na janela da virada
After=network.target

[Service]
DynamicUser=yes
StateDirectory=virada-spool
StateDirectoryMode=0700
ExecStart=/usr/bin/python3 /usr/local/lib/virada/spool.py receber --dir /var/lib/virada-spool --porta 8099
Restart=always
RestartSec=1
TimeoutStopSec=30

[Install]
WantedBy=multi-user.target
FIM_DA_UNIT
systemctl daemon-reload
if systemctl is-active -q virada-spool; then echo "virada-spool já rodava (não reiniciado)"; fi
systemctl enable -q --now virada-spool
i=0
until curl -sf --max-time 2 http://127.0.0.1:8099/saude > /dev/null < /dev/null; do
  i=$((i + 1))
  if [ $i -ge 20 ]; then
    echo "FALHOU: o spool não respondeu em 10 s; nginx não foi virado" >&2
    systemctl status virada-spool --no-pager 2>&1 | tail -5 >&2
    exit 1
  fi
  sleep 0.5
done
mkdir -p "$BK"
# início da janela para o relatório do spool-replay.sh (o desliga arquiva; repetir o liga mantém o 1º)
[ -e "$BK/inicio" ] || date -Iseconds > "$BK/inicio"
echo "spool no ar: 127.0.0.1:8099 -> /var/lib/virada-spool (janela desde $(cat "$BK/inicio"))"
NO_ALVO
} | $NA_VPS sh

sh "$AQUI/spool-nginx.sh" spool
