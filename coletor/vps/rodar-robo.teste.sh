#!/usr/bin/env bash
# Autoteste do rodar-robo.sh (precisa de Linux com flock; roda sem tocar em nada de produção).
# Uso: bash coletor/vps/rodar-robo.teste.sh
set -u
AQUI="$(cd "$(dirname "$0")" && pwd)"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
mkdir -p "$T/raiz/coletor"
git -C "$T/raiz" init -q
export RAIZ="$T/raiz" LOGS="$T/logs" LOCKS="$T" ENV_ROBOS="$T/robos.env" NODE_BIN="$T"
printf '%s\n' '# comentário' 'SEGREDO=valor-que-nao-pode-ir-pro-log' 'ASPAS="com aspas"' "PERIGO=a&b;touch $T/executou \$(touch $T/executou2)" '' > "$T/robos.env"
printf '#!/bin/sh\necho "$1" >> "%s/avisos"\n' "$T" > "$T/avisa.sh"; chmod +x "$T/avisa.sh"
echo "ALERT_COMANDO=$T/avisa.sh" >> "$T/robos.env"
falhas=0
confere() { if [ "$2" = "$3" ]; then echo "ok   $1"; else echo "FALHA $1 (esperado '$3', veio '$2')"; falhas=$((falhas + 1)); fi; }
R="$AQUI/rodar-robo.sh"

bash "$R" ok 1 -- sh -c 'test -n "$SEGREDO"'; confere "sucesso e env carregado" $? 0
[ -e "$T/logs/ok.falhou" ]; confere "sucesso não deixa marca de falha" $? 1
bash "$R" aspas 1 -- sh -c '[ "$ASPAS" = "com aspas" ]'; confere "aspas externas são removidas" $? 0
bash "$R" perigo 1 -- sh -c 'case "$PERIGO" in a\&b\;touch*) exit 0;; *) exit 1;; esac'; confere "valor com & ; \$() chega literal" $? 0
[ -e "$T/executou" ] || [ -e "$T/executou2" ]; confere "valor do env nunca é executado" $? 1

bash "$R" ruim 1 -- sh -c 'exit 3'; confere "falha devolve o código" $? 3
[ -e "$T/logs/ruim.falhou" ]; confere "falha deixa marca" $? 0
bash "$R" ruim 1 -- sh -c 'exit 3'; bash "$R" ruim 1 -- sh -c 'exit 3'
confere "aviso só na 1ª falha (3 falhas seguidas = 1 aviso)" "$(grep -c 'falhou na VPS' "$T/avisos")" 1
bash "$R" ruim 1 -- true; [ -e "$T/logs/ruim.falhou" ]; confere "sucesso seguinte limpa a marca" $? 1
confere "avisa quando volta ao normal" "$(grep -c 'voltou ao normal' "$T/avisos")" 1
touch -d '7 hours ago' "$T/logs/velha.falhou"; bash "$R" velha 1 -- sh -c 'exit 1'
confere "repete o aviso depois de 6 h de falha" "$(grep -c 'Robô velha falhou' "$T/avisos")" 1
bash "$R" ok 1 -- true
confere "sucesso sem falha anterior não avisa" "$(grep -c 'Robô ok' "$T/avisos")" 0

(bash "$R" lento 1 -- sleep 3 &) ; sleep 1
bash "$R" lento 1 -- true; confere "sobreposição é pulada com 0" $? 0
grep -q "pulada" "$T/logs/lento.log"; confere "sobreposição aparece no log" $? 0
sleep 3

bash "$R" sem-separador 1 true 2>/dev/null; confere "uso errado dá 64" $? 64

grep -rq "valor-que-nao-pode-ir-pro-log" "$T/logs"; confere "segredo não vaza para o log" $? 1

rm "$T/robos.env"; bash "$R" semenv 1 -- true; confere "sem arquivo de segredos dá 78" $? 78

[ "$falhas" -eq 0 ] && echo "TUDO OK" || { echo "$falhas falha(s)"; exit 1; }
