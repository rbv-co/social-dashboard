#!/usr/bin/env bash
# RODA UM ROBÔ AGENDADO NA VPS (o que antes era um workflow de cron do GitHub Actions).
#
# Uso:  rodar-robo.sh <nome> <minutos-de-limite> -- <comando> [args...]
# Ex.:  rodar-robo.sh notas-dos-pedidos 120 -- node coletor/notas-dos-pedidos.mjs --dias=7
#
# O que o Actions fazia de graça e este script refaz:
#  - UM por vez (concurrency do Actions): `flock` por nome. Se o anterior ainda roda, esta rodada é PULADA e fica no log.
#  - limite de tempo (timeout-minutes): `timeout`.
#  - segredos (secrets.*): /etc/robos.env, só root lê (600). Nunca vão para o log.
#  - código atualizado (checkout): `git pull --ff-only` na main, e `npm ci` só quando o package-lock muda.
#  - histórico: /var/log/robos/<nome>.log (rotacionado). Falha deixa /var/log/robos/<nome>.falhou e, se houver
#    ALERT_WEBHOOK_URL, avisa por ele.
#
# Fuso: o cron da VPS é UTC, igual ao do Actions — os horários do .cron são os mesmos dos workflows.
# Código: roda sempre o que está na `main` do clone $RAIZ. Falha no pull NÃO impede a rodada (segue com o que há).
set -u

RAIZ="${RAIZ:-/opt/robos/social-dashboard}"
LOGS="${LOGS:-/var/log/robos}"
LOCKS="${LOCKS:-/var/lock}"
ENV_ROBOS="${ENV_ROBOS:-/etc/robos.env}"
NODE_BIN="${NODE_BIN:-/opt/cartoes-ean/node/bin}"   # Node 22, o mesmo dos Cartões EAN (o Ubuntu da VPS só tem o 20)

nome="${1:-}"; limite="${2:-}"
if [ -z "$nome" ] || ! [[ "$limite" =~ ^[0-9]+$ ]] || [ "${3:-}" != "--" ] || [ $# -lt 4 ]; then
  echo "uso: $0 <nome> <minutos> -- <comando> [args...]" >&2; exit 64
fi
shift 3

mkdir -p "$LOGS"
log() { echo "$(date -u +%FT%TZ) [$nome] $*" >> "$LOGS/$nome.log"; }

# Segredos para o ambiente do robô. Lidos como TEXTO (CHAVE=valor, aspas externas opcionais), nunca com `source`:
# uma senha com `$(...)`, `&` ou `;` não pode virar comando.
[ -r "$ENV_ROBOS" ] || { log "ERRO: sem $ENV_ROBOS"; exit 78; }
while IFS= read -r linha || [ -n "$linha" ]; do
  [[ "$linha" =~ ^[[:space:]]*([A-Za-z_][A-Za-z0-9_]*)=(.*)$ ]] || continue   # pula comentário e linha vazia
  valor="${BASH_REMATCH[2]}"
  case "$valor" in \"*\") valor="${valor:1:${#valor}-2}" ;; \'*\') valor="${valor:1:${#valor}-2}" ;; esac
  export "${BASH_REMATCH[1]}=$valor"
done < "$ENV_ROBOS"
export PATH="$NODE_BIN:$PATH"

avisar() {
  touch "$LOGS/$nome.falhou"
  [ -n "${ALERT_WEBHOOK_URL:-}" ] || return 0
  # Mensagem sem segredo: só o nome e o código de saída. `text` e `content` cobrem Slack e Discord.
  curl -fsS -m 15 -H 'Content-Type: application/json' \
    -d "{\"text\":\"$1\",\"content\":\"$1\"}" "$ALERT_WEBHOOK_URL" >/dev/null 2>&1 || log "aviso: webhook de alerta falhou"
}

# Um robô por vez: se o da rodada anterior ainda roda, pula esta (no Actions a rodada entrava na fila).
exec 9>"$LOCKS/robo-$nome.lock"
if ! flock -n 9; then log "pulada: a rodada anterior ainda está rodando"; exit 0; fi

# Código: o robô segura o lock COMPARTILHADO durante a rodada; o pull só acontece com o lock EXCLUSIVO livre,
# ou seja, nunca troca arquivos debaixo de um robô em andamento. Sem lock livre, segue com o código atual.
exec 8>"$LOCKS/robos-codigo.lock"
if flock -n -x 8; then
  if [ ! -f "$LOGS/.pull" ] || [ -n "$(find "$LOGS/.pull" -mmin +4 2>/dev/null)" ]; then
    touch "$LOGS/.pull"
    git -C "$RAIZ" pull -q --ff-only >> "$LOGS/$nome.log" 2>&1 || log "aviso: git pull falhou; segue com o código que está aqui"
    novo=$(cat "$RAIZ/coletor/package-lock.json" 2>/dev/null | sha256sum)   # os robôs só usam as dependências de coletor/
    if [ "$novo" != "$(cat "$LOGS/.deps" 2>/dev/null)" ]; then
      log "dependências mudaram: npm ci"
      if (cd "$RAIZ/coletor" && npm ci --silent) >> "$LOGS/$nome.log" 2>&1; then
        echo "$novo" > "$LOGS/.deps"
      else
        log "ERRO: npm ci falhou"
      fi
    fi
  fi
  flock -u 8
fi
flock -s 8   # a partir daqui o pull de OUTRO robô espera este terminar (ele só tenta com -n, então nunca trava ninguém)

log "início: $*"
inicio=$(date +%s)
cd "$RAIZ" || { log "ERRO: sem $RAIZ"; exit 78; }
nice -n 10 timeout --kill-after=30 "$((limite * 60))" "$@" >> "$LOGS/$nome.log" 2>&1
codigo=$?
dur=$(( $(date +%s) - inicio ))

if [ "$codigo" -eq 0 ]; then
  log "fim: ok em ${dur}s"
  rm -f "$LOGS/$nome.falhou"
else
  [ "$codigo" -eq 124 ] && motivo="estourou o limite de ${limite} min" || motivo="saiu com código $codigo"
  log "FALHOU: $motivo (${dur}s)"
  avisar "Robô $nome falhou na VPS: $motivo. Log: $LOGS/$nome.log"
fi
exit "$codigo"
