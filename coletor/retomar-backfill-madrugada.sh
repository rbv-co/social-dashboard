#!/bin/bash
# RETOMA O BACKFILL DOS QUATRO NÚMEROS, de madrugada, até três vezes.
#
# POR QUE UMA CASCA EM VOLTA DO ROBÔ: o robô para sozinho depois de 5 erros
# seguidos, de propósito — erro em série quase sempre é limite de taxa da Meta, e
# insistir já derrubou o painel ao vivo neste projeto uma vez. Mas na madrugada de
# 18/08 foi isso que acabou com a noite pela metade: 593 alvos de 1.407, e o resto
# esperando alguém rodar de novo. Uma oscilação de internet não pode custar a noite
# inteira. Então: até 3 passadas, com 10 minutos de pausa entre elas.
#
# QUANDO ELE PARA DE VEZ: quando o robô anunciar que não sobrou alvo. Aí a casca
# apaga o arquivo de retomada (se ficar, ele faz qualquer tentativa futura pular
# esses alvos em silêncio), deixa um marcador de PRONTO e desliga o próprio
# agendamento.
#
# Ele NÃO reinicia sozinho enquanto houver alvo: as 3 passadas são o teto da noite.
# Sobrando alvo, a noite seguinte continua de onde parou.
set -u

REPO="/Users/erickmartins/iamundi"
NODE="/usr/local/bin/node"
LOG="$REPO/coletor/backfill-madrugada.log"
RETOMADA="$REPO/coletor/.preencher-numeros-de-campanha.json"
PRONTO="$REPO/coletor/.backfill-numeros-PRONTO"
ROTULO="com.iamundi.backfill-numeros"

PASSADAS=3
PAUSA_ENTRE=600   # 10 minutos

cd "$REPO" || exit 1

# Já terminou numa noite anterior: não gasta chamada nenhuma na Meta.
if [ -f "$PRONTO" ]; then
  echo "[$(date '+%F %T')] backfill já estava PRONTO — nada a fazer." >> "$LOG"
  exit 0
fi

echo "" >> "$LOG"
echo "=========== retomada de $(date '+%F %T') ===========" >> "$LOG"

for n in $(seq 1 $PASSADAS); do
  echo "" >> "$LOG"
  echo "--- passada $n de $PASSADAS ---" >> "$LOG"

  SAIDA="$("$NODE" coletor/preencher-numeros-de-campanha.mjs 2>&1)"
  echo "$SAIDA" >> "$LOG"

  # A primeira linha do robô diz quanto sobrou: "... ; N pela frente."
  # Zero pela frente é a única condição de fim — e ela vem do robô, não de um
  # palpite da casca.
  if echo "$SAIDA" | grep -q "; 0 pela frente"; then
    echo "" >> "$LOG"
    echo "✔ nao sobrou alvo: backfill CONCLUIDO em $(date '+%F %T')." >> "$LOG"
    rm -f "$RETOMADA"
    date '+%F %T' > "$PRONTO"
    # Desliga o proprio agendamento. Se falhar, o marcador acima ja impede
    # qualquer rodada futura de gastar chamada.
    launchctl bootout "gui/$(id -u)/$ROTULO" 2>>"$LOG"
    echo "  agendamento desligado e arquivo de retomada apagado." >> "$LOG"
    exit 0
  fi

  if [ "$n" -lt "$PASSADAS" ]; then
    echo "  (ainda sobrou alvo — esperando $((PAUSA_ENTRE / 60)) min antes da proxima passada)" >> "$LOG"
    sleep "$PAUSA_ENTRE"
  fi
done

echo "" >> "$LOG"
echo "As $PASSADAS passadas da noite acabaram e ainda sobrou alvo. A noite que vem continua de onde parou." >> "$LOG"
