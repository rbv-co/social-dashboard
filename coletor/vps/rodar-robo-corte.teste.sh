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
# `flock` não existe no Mac: um substituto que sempre dá o lock deixa o robô de fato rodar nos casos "não recusa"
mkdir -p "$T/bin"; printf '#!/bin/sh\nexit 0\n' > "$T/bin/flock"; chmod +x "$T/bin/flock"; export PATH="$T/bin:$PATH"
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
[ -e "$T/rodou" ]; confere "e o robô roda" $? 0

env_com 'SAIU_DO_SUPABASE=sim' 'DATABASE_URL=postgres://api:x@172.21.0.2:5432/api'
roda d; grep -q RECUSADO "$T/logs/d.log" 2>/dev/null; confere "cortado com env no banco novo e sem chave de serviço: não recusa" $? 1
[ -e "$T/rodou" ]; confere "e o robô roda" $? 0

# ponte/PostgREST (opção B do achado 06-1): a chave fica, mas a URL REST já não é a do Supabase
env_com 'SAIU_DO_SUPABASE=sim' 'DATABASE_URL=postgres://api:x@172.21.0.2:5432/api' 'SUPABASE_URL=http://127.0.0.1:3000' 'SUPABASE_SERVICE_KEY=chave'
roda e; grep -q RECUSADO "$T/logs/e.log" 2>/dev/null; confere "chave de serviço com SUPABASE_URL fora do Supabase: não recusa" $? 1
[ -e "$T/rodou" ]; confere "e o robô roda" $? 0
env_com 'SAIU_DO_SUPABASE=sim' 'SUPABASE_URL=https://abc.supabase.co' 'SUPABASE_SERVICE_KEY=chave'
roda f; confere "chave de serviço com SUPABASE_URL do Supabase: recusa (78)" $? 78

# revisão Opus do plano 02: robô que não usa o DATABASE_URL global e robôs do Storage (fase 2) com a chave renomeada
POOLER='DATABASE_URL=postgresql://postgres.abc:senha@aws-1-sa-east-1.pooler.supabase.com:6543/postgres'
roda_env() { bash "$R" "$1" 1 -- sh -c "echo \"DB=\${DATABASE_URL:-} K=\${SUPABASE_SERVICE_KEY:-} V=\${VIGIA_DATABASE_URL:-} S=\${STORAGE_SUPABASE_SERVICE_KEY:-}\" > $T/env" >/dev/null 2>&1; }
for r in publicar-o-site copia-do-banco; do
  env_com 'SAIU_DO_SUPABASE=sim' "$POOLER"; roda_env $r
  confere "$r sem uso do DATABASE_URL global: roda com o corte ligado" "$(cat "$T/env" 2>/dev/null)" "DB= K= V= S="
done
env_com 'SAIU_DO_SUPABASE=sim' "$POOLER" 'VIGIA_DATABASE_URL=postgres://robo_vigia_meta:x@172.21.0.2:5432/api'; roda_env vigia-problemas-meta
confere "vigia roda com o corte ligado e fica com a URL dele" "$(cat "$T/env" 2>/dev/null)" "DB= K= V=postgres://robo_vigia_meta:x@172.21.0.2:5432/api S="
env_com 'SAIU_DO_SUPABASE=sim' 'DATABASE_URL=postgres://api:x@172.21.0.2:5432/api' 'VIGIA_DATABASE_URL=segredo-do-vigia'; roda_env outro
confere "a URL do vigia não chega aos outros robôs" "$(cat "$T/env" 2>/dev/null)" "DB=postgres://api:x@172.21.0.2:5432/api K= V= S="
for r in opr-diario faxina-storage; do
  env_com 'SAIU_DO_SUPABASE=sim' 'DATABASE_URL=postgres://api:x@172.21.0.2:5432/api' 'SUPABASE_URL=https://abc.supabase.co' 'STORAGE_SUPABASE_SERVICE_KEY=chave-storage'; roda_env $r
  confere "$r (Storage) recebe a chave como SUPABASE_SERVICE_KEY e não é recusado" "$(cat "$T/env" 2>/dev/null)" "DB=postgres://api:x@172.21.0.2:5432/api K=chave-storage V= S="
done
env_com 'SAIU_DO_SUPABASE=sim' 'DATABASE_URL=postgres://api:x@172.21.0.2:5432/api' 'SUPABASE_URL=https://abc.supabase.co' 'STORAGE_SUPABASE_SERVICE_KEY=chave-storage'; roda_env cards
confere "robô fora do Storage não recebe a chave do Storage" "$(cat "$T/env" 2>/dev/null)" "DB=postgres://api:x@172.21.0.2:5432/api K= V= S="
env_com 'DATABASE_URL=postgres://velho' 'SUPABASE_SERVICE_KEY=chave' 'STORAGE_SUPABASE_SERVICE_KEY=outra'; roda_env opr-diario
confere "SEM a flag nada muda (a chave solta fica, a do Storage não é usada)" "$(cat "$T/env" 2>/dev/null)" "DB=postgres://velho K=chave V= S="

[ "$falhas" -eq 0 ] && echo "TUDO OK" || { echo "$falhas falha(s)"; exit 1; }
