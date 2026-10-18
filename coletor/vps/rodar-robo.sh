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
[[ "$nome" =~ ^[A-Za-z0-9_-]+$ ]] || { echo "nome inválido: só letras, números, _ e -" >&2; exit 64; }

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

# PAPEL DO ROBÔ NO BANCO NOVO (plano 02 da virada, ops/vps/api-db/LEIA-ME.md): cada robô tem a PRÓPRIA URL do api-db,
# ROBO_<NOME>_DATABASE_URL (nome em maiúsculas, `-` vira `_`), que vira o DATABASE_URL só dele. Sem a variável nada muda (cron atual).
# As URLs dos outros robôs saem do ambiente: papel por robô não vale nada se todo robô enxerga a senha de todos.
var_url="ROBO_$(printf %s "$nome" | tr 'a-z-' 'A-Z_')_DATABASE_URL"
[ -n "${!var_url:-}" ] && export DATABASE_URL="${!var_url}"
for v in $(compgen -e | grep -E '^ROBO_.*_DATABASE_URL$'); do unset "$v"; done
# O api-db não publica porta e o cron roda no host: `@api-db:` na URL vira o IP atual do contêiner na api_net (como o copia-do-banco.sh).
# Sem IP a URL fica como está e o robô falha alto na conexão (nunca cai calado no banco velho).
case "${DATABASE_URL:-}${REPORTAR_DATABASE_URL:-}${VIGIA_DATABASE_URL:-}" in
  *@api-db:*)
    ip_api_db=$(docker inspect -f '{{(index .NetworkSettings.Networks "api_net").IPAddress}}' api-db 2>/dev/null)
    if [ -n "$ip_api_db" ]; then
      for v in DATABASE_URL REPORTAR_DATABASE_URL VIGIA_DATABASE_URL; do
        [ -n "${!v:-}" ] && export "$v=${!v//@api-db:/@$ip_api_db:}"
      done
    else log "aviso: não achei o IP do api-db (docker inspect)"; fi ;;
esac

# Robôs que NÃO leem o DATABASE_URL global (copia fala por COPIA_*, vigia por VIGIA_DATABASE_URL, publicar-o-site por banco nenhum):
# com o corte ligado ele não vale para eles, e a trava abaixo os recusaria por nada (revisão Opus do PR do plano 02).
# STORAGE (fase 2 do plano 02): opr-diario e faxina-storage ainda mexem em arquivo no Storage do Supabase. O robos-troca-env.sh
# renomeia a chave para STORAGE_SUPABASE_SERVICE_KEY; só esses dois a recebem (como SUPABASE_SERVICE_KEY) e a trava não olha a
# chave deles. Para os outros ela some e a SUPABASE_SERVICE_KEY solta segue recusada. Sem a flag nada muda.
so_storage=""
if [ -n "${SAIU_DO_SUPABASE:-}" ]; then
  case "$nome" in copia-do-banco|vigia-problemas-meta|publicar-o-site) unset DATABASE_URL ;; esac
  case "$nome" in
    opr-diario|faxina-storage)
      if [ -n "${STORAGE_SUPABASE_SERVICE_KEY:-}" ]; then export SUPABASE_SERVICE_KEY="$STORAGE_SUPABASE_SERVICE_KEY"; so_storage=1; fi ;;
  esac
fi
unset STORAGE_SUPABASE_SERVICE_KEY
# a credencial do vigia é só dele (o REPORTAR_DATABASE_URL, do papel de menor poder, todos usam)
[ "$nome" = vigia-problemas-meta ] || unset VIGIA_DATABASE_URL

# Canais de aviso (ambos opcionais, em /etc/robos.env): ALERT_COMANDO (programa que recebe o texto como $1; na VPS
# é o avisar-whatsapp.py, o mesmo grupo do monitor) e ALERT_WEBHOOK_URL (JSON `text`/`content`: Slack e Discord).
# A mensagem nunca leva segredo: só o nome do robô e o motivo.
avisar() {
  if [ -n "${ALERT_COMANDO:-}" ]; then "$ALERT_COMANDO" "$1" >> "$LOGS/$nome.log" 2>&1 || log "aviso: ALERT_COMANDO falhou"; fi
  if [ -n "${ALERT_WEBHOOK_URL:-}" ]; then
    curl -fsS -m 15 -H 'Content-Type: application/json' \
      -d "{\"text\":\"$1\",\"content\":\"$1\"}" "$ALERT_WEBHOOK_URL" >/dev/null 2>&1 || log "aviso: webhook de alerta falhou"
  fi
}

# A CHAVE DO CORTE (a mesma de copia-do-banco.sh): com SAIU_DO_SUPABASE ligada o banco é o NOVO. Robô cujo DATABASE_URL ainda é o
# pooler do Supabase gravaria no banco VELHO (o `postgres` do pooler é o dono das tabelas: o congelar não o barra) e robô com
# SUPABASE_SERVICE_KEY leria o velho por REST. Recusa SEM rodar nada (nem o `git pull`) e avisa o que ajustar em $ENV_ROBOS.
# Achado 06-1 (REVISAO-TESTES-2026-10): o roteiro da virada só põe CENTRAL_API_* no env dos robôs.
if [ -n "${SAIU_DO_SUPABASE:-}" ]; then
  velho=""
  case "${DATABASE_URL:-}" in *supabase.com*|*supabase.co*) velho="DATABASE_URL" ;; esac
  # a chave de serviço só é "velha" se a URL REST ainda for a do Supabase (sem SUPABASE_URL, os robôs caem no host fixo dele)
  if [ -z "$velho" ] && [ -z "$so_storage" ] && [ -n "${SUPABASE_SERVICE_KEY:-}" ]; then
    case "${SUPABASE_URL:-supabase.co}" in *supabase.co*|*supabase.com*) velho="SUPABASE_SERVICE_KEY" ;; esac
  fi
  if [ -n "$velho" ]; then
    log "RECUSADO: SAIU_DO_SUPABASE está ligada e $velho ainda aponta para o Supabase (o banco agora é o novo): ajuste $ENV_ROBOS"
    marca="$LOGS/$nome.falhou"
    if [ ! -e "$marca" ] || [ -n "$(find "$marca" -mmin +360 2>/dev/null)" ]; then
      touch "$marca"
      avisar "Robô $nome RECUSADO na VPS: $velho ainda aponta para o Supabase com SAIU_DO_SUPABASE ligada. Ajuste $ENV_ROBOS."
    fi
    exit 78
  fi
fi

# SEGUNDO CANAL DE AVISO: grava a rodada em `robos_execucoes`, o mesmo termômetro do painel de saúde da central
# (`robos_saude`, olhado contra `robos_esperados`). O WhatsApp (ALERT_COMANDO) depende de uma sessão da Evolution que
# cai e só volta lendo QR; sem este canal, robô parado é silêncio. Falha ao gravar NUNCA derruba nem muda o robô.
# Com REPORTAR_DATABASE_URL (papel `robo_reporte` no api-db) grava por `pg`; senão, por REST no Supabase (SUPABASE_URL +
# SUPABASE_SERVICE_KEY); sem nenhum dos dois, não faz nada. $1=status $2=ok(true/false) $3=texto sem aspas.
reportar() {
  if [ -n "${REPORTAR_DATABASE_URL:-}" ]; then
    timeout 20 node "$RAIZ/coletor/vps/reportar-rodada.mjs" "$nome" "$1" "$2" "$3" >> "$LOGS/$nome.log" 2>&1 || log "aviso: não consegui gravar a rodada no painel da central"
    return 0
  fi
  [ -n "${SUPABASE_URL:-}" ] && [ -n "${SUPABASE_SERVICE_KEY:-}" ] || return 0
  curl -fsS -m 15 -X POST "$SUPABASE_URL/rest/v1/robos_execucoes" \
    -H "apikey: $SUPABASE_SERVICE_KEY" -H "Authorization: Bearer $SUPABASE_SERVICE_KEY" \
    -H 'Content-Type: application/json' -H 'Prefer: return=minimal' \
    -d "{\"robo\":\"$nome\",\"status_code\":$1,\"ok\":$2,\"resposta\":\"$3\",\"conferido_em\":\"$(date -u +%FT%TZ)\"}" \
    >/dev/null 2>&1 || log "aviso: não consegui gravar a rodada no painel da central"
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
nice -n 10 timeout --kill-after=30 "$((limite * 60))" env -u REPORTAR_DATABASE_URL "$@" >> "$LOGS/$nome.log" 2>&1
codigo=$?
dur=$(( $(date +%s) - inicio ))

# Avisa na MUDANÇA de estado (caiu / voltou), e repete a cada 6 h enquanto continuar caído — um robô de hora em hora
# quebrado não pode mandar 24 mensagens por dia. O momento da primeira falha é a data da marca `.falhou`.
marca="$LOGS/$nome.falhou"
if [ "$codigo" -eq 0 ]; then
  log "fim: ok em ${dur}s"
  reportar 200 true "ok em ${dur}s"
  if [ -e "$marca" ]; then rm -f "$marca"; avisar "Robô $nome voltou ao normal na VPS."; fi
else
  [ "$codigo" -eq 124 ] && motivo="estourou o limite de ${limite} min" || motivo="saiu com código $codigo"
  log "FALHOU: $motivo (${dur}s)"
  reportar 500 false "$motivo (${dur}s)"
  if [ ! -e "$marca" ] || [ -n "$(find "$marca" -mmin +360 2>/dev/null)" ]; then
    touch "$marca"
    avisar "Robô $nome falhou na VPS: $motivo. Log: $LOGS/$nome.log"
  fi
fi
exit "$codigo"
