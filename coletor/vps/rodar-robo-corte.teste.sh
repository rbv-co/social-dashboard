#!/usr/bin/env bash
# Prova a TRAVA DO CORTE do rodar-robo.sh (SAIU_DO_SUPABASE + env ainda no Supabase). Roda em qualquer Unix, sem `flock`: a trava
# sai ANTES do lock. Uso: bash coletor/vps/rodar-robo-corte.teste.sh
set -u
AQUI="$(cd "$(dirname "$0")" && pwd)"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
mkdir -p "$T/raiz/coletor"
export RAIZ="$T/raiz" LOGS="$T/logs" LOCKS="$T" ENV_ROBOS="$T/robos.env" NODE_BIN="$T"
printf '#!/bin/sh\necho "$1" >> "%s/avisos"\n' "$T" > "$T/avisa.sh"; chmod +x "$T/avisa.sh"
falhas=0
confere() { if [ "$2" = "$3" ]; then echo "ok   $1"; else echo "FALHA $1 (esperado '$3', veio '$2')"; falhas=$((falhas + 1)); fi; }
R="$AQUI/rodar-robo.sh"
env_com() { { echo "ALERT_COMANDO=$T/avisa.sh"; printf '%s\n' "$@"; } > "$ENV_ROBOS"; rm -rf "$T/logs" "$T/avisos" "$T/rodou"; }
roda() { bash "$R" "$1" 1 -- sh -c "touch $T/rodou" >/dev/null 2>&1; }

env_com 'SAIU_DO_SUPABASE=sim' 'DATABASE_URL=postgresql://postgres.abc:senha@aws-1-sa-east-1.pooler.supabase.com:6543/postgres'
roda a; confere "cortado + DATABASE_URL no pooler do Supabase: recusa (78)" $? 78
[ -e "$T/rodou" ]; confere "e o robô NÃO roda" $? 1
grep -q 'RECUSADO.*DATABASE_URL' "$T/logs/a.log"; confere "o log diz qual variável" $? 0
confere "avisa uma vez" "$(grep -c RECUSADO "$T/avisos")" 1
roda a; roda a
confere "recusas seguidas não repetem o aviso" "$(grep -c RECUSADO "$T/avisos")" 1
grep -rq 'senha' "$T/logs" "$T/avisos"; confere "a senha não vai ao log nem ao aviso" $? 1

env_com 'SAIU_DO_SUPABASE=sim' 'DATABASE_URL=postgres://api:x@172.21.0.2:5432/api' 'SUPABASE_SERVICE_KEY=chave'
roda b; confere "cortado + SUPABASE_SERVICE_KEY ainda no env: recusa (78)" $? 78
grep -q 'RECUSADO.*SUPABASE_SERVICE_KEY' "$T/logs/b.log"; confere "o log diz qual variável (chave de serviço)" $? 0

env_com 'DATABASE_URL=postgresql://postgres.abc:senha@aws-1-sa-east-1.pooler.supabase.com:6543/postgres' 'SUPABASE_SERVICE_KEY=chave'
roda c; grep -q RECUSADO "$T/logs/c.log" 2>/dev/null; confere "SEM SAIU_DO_SUPABASE (hoje) nada muda: não recusa" $? 1

env_com 'SAIU_DO_SUPABASE=sim' 'DATABASE_URL=postgres://api:x@172.21.0.2:5432/api'
roda d; grep -q RECUSADO "$T/logs/d.log" 2>/dev/null; confere "cortado com env no banco novo e sem chave de serviço: não recusa" $? 1

[ "$falhas" -eq 0 ] && echo "TUDO OK" || { echo "$falhas falha(s)"; exit 1; }
