#!/usr/bin/env bash
# Autoteste do copia-do-banco.sh: docker e node de mentira, nada de produção.
# Uso: bash coletor/vps/copia-do-banco.teste.sh
set -u
AQUI="$(cd "$(dirname "$0")" && pwd)"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
printf '#!/bin/sh\necho "$IP_FALSO"\n' > "$T/docker"
printf '#!/bin/sh\necho "url=${COPIA_DATABASE_URL:-} args=$*" >> "%s/node.log"\n' "$T" > "$T/node"
chmod +x "$T/docker" "$T/node"
export PATH="$T:$PATH"
falhas=0
confere() { if [ "$2" = "$3" ]; then echo "ok   $1"; else echo "FALHA $1 (esperado '$3', veio '$2')"; falhas=$((falhas + 1)); fi; }
C="$AQUI/copia-do-banco.sh"

IP_FALSO=172.20.0.5 COPIA_DB_SENHA=ab12cd34ef56 bash "$C" --ensaio; confere "depois do corte roda" $? 0
confere "URL do Postgres novo pelo IP da api_net" "$(head -1 "$T/node.log" | cut -d' ' -f1)" "url=postgres://copia:ab12cd34ef56@172.20.0.5:5432/api"
grep -q -- "--limpar" "$T/node.log"; confere "ensaio não limpa" $? 1

rm -f "$T/node.log"
IP_FALSO=172.20.0.5 bash "$C" --ensaio; confere "antes do corte roda" $? 0
confere "sem COPIA_DB_SENHA não monta URL (segue no Supabase)" "$(cut -d' ' -f1 "$T/node.log")" "url="

rm -f "$T/node.log"
IP_FALSO= COPIA_DB_SENHA=ab12cd34ef56 bash "$C" --ensaio 2>/dev/null; confere "api-db fora do ar falha" $? 1
[ -e "$T/node.log" ]; confere "sem IP nem chama o node" $? 1

[ "$falhas" -eq 0 ] && echo "TUDO OK" || { echo "$falhas falha(s)"; exit 1; }
