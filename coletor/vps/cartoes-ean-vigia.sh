#!/usr/bin/env bash
# VIGIA DA FILA DE CARTÕES EAN, NA VPS (/opt/cartoes-ean). Roda como serviço (cartoes-ean.service).
#
# Olha a fila a cada 10 s; havendo pedido, atualiza o código (só o que está na `main`) e chama o robô de sempre
# (coletor/robo-de-cartoes.mjs), até $WORKERS ao mesmo tempo. Sem preparação de máquina, sem checkout, sem cache: o cartão sai em segundos.
# O workflow do GitHub (.github/workflows/cartoes-ean.yml) continua como retaguarda; `vessel_cartao_pegar_da_fila`
# é atômica, então os dois não pegam o mesmo pedido.
#
# Layout esperado em $RAIZ:  node/ (Node 22)  venv/ (Python)  social-dashboard/ e, DENTRO dele, vessel-brasil/
# ⚠️ vessel-brasil tem de ficar DENTRO de social-dashboard: o gerador do site importa ../../coletor/lib/cutout.mjs.
# BANCO (coletor/lib/cartoes-dados.mjs), do EnvironmentFile do serviço (/etc/cartoes-ean.env):
#   - api-db por `pg` (virada): CARTOES_DB_SENHA, a senha do papel robo_cartoes (ops/vps/api-db/papel-robo-cartoes.sql). Vai para o
#     `pg` por PGPASSWORD, nunca por argumento nem pela URL. CARTOES_DATABASE_URL, se não vier pronta, é montada com o IP do
#     `api-db` na rede api_net (como o conteudo-vigia.sh);
#   - Supabase (REST, o de antes e o ROLLBACK): SUPABASE_URL e SUPABASE_SERVICE_KEY. Voltar = tirar CARTOES_DB_SENHA (e
#     CARTOES_DATABASE_URL) do arquivo e reiniciar o serviço.
set -u
RAIZ="${RAIZ:-/opt/cartoes-ean}"
WORKERS="${CARTOES_WORKERS:-2}"   # robôs ao mesmo tempo; a VPS divide CPU com o PDV, então poucos
export PATH="$RAIZ/node/bin:$RAIZ/venv/bin:$PATH"
export VESSEL_DIR="$RAIZ/social-dashboard/vessel-brasil"
# Espelho PERMANENTE das fotos do Zoho: só baixa o que mudou (regras de validade em coletor/lib/espelho-de-fotos.mjs).
export FOTOS_CACHE="$RAIZ/cache-fotos"
log() { echo "$(date -u +%FT%TZ) $*"; }
if [ -n "${CARTOES_DB_SENHA:-}" ]; then
  export PGPASSWORD="$CARTOES_DB_SENHA"
  if [ -z "${CARTOES_DATABASE_URL:-}" ]; then
    ip=$(docker inspect -f '{{(index .NetworkSettings.Networks "api_net").IPAddress}}' api-db 2>/dev/null)
    [ -n "$ip" ] || { log "erro: não achei o IP do api-db"; exit 1; }
    export CARTOES_DATABASE_URL="postgres://robo_cartoes@$ip:5432/api"
  fi
  unset SUPABASE_URL SUPABASE_SERVICE_KEY   # com o banco novo, nada aqui pode escrever no Supabase por engano
else
  : "${SUPABASE_URL:?falta SUPABASE_URL (ou CARTOES_DB_SENHA)}" "${SUPABASE_SERVICE_KEY:?falta SUPABASE_SERVICE_KEY}"
fi

atualizar() {
  # Falha de rede no pull NÃO impede o cartão: segue com o código que já está aqui.
  git -C "$RAIZ/social-dashboard" pull -q --ff-only || log "aviso: pull do social-dashboard falhou"
  git -C "$VESSEL_DIR" pull -q --ff-only || log "aviso: pull do vessel-brasil falhou"
  local novo
  novo=$(cat "$RAIZ/social-dashboard/coletor/package-lock.json" "$RAIZ/social-dashboard/coletor/requirements-cartoes.txt" | sha256sum)
  if [ "$novo" != "$(cat "$RAIZ/.deps" 2>/dev/null)" ]; then
    log "dependências mudaram: reinstalando"
    (cd "$RAIZ/social-dashboard/coletor" && npm ci --silent) \
      && pip install -q -r "$RAIZ/social-dashboard/coletor/requirements-cartoes.txt" \
      && echo "$novo" > "$RAIZ/.deps" || log "erro: instalação das dependências falhou"
  fi
}

# Um robô: esvazia a fila (pega pedido atrás de pedido até acabar). Vários ao mesmo tempo são seguros: `vessel_cartao_pegar_da_fila`
# é atômica e o robô trava o que divide (espelho de fotos, recortes, pastas do Zoho) — ver coletor/robo-de-cartoes.mjs.
# O prefixo [robô N] separa as linhas de cada um no log.
trabalhador() {
  (cd "$RAIZ/social-dashboard" && node --import ./coletor/lib/curl-fetch.mjs coletor/robo-de-cartoes.mjs) 2>&1 \
    | sed -u "s/^/[robô $1] /"
}

# Quantos pedidos esperam (no máximo $WORKERS), ou "erro". Leitura que falhou NÃO é fila vazia.
fila() { (cd "$RAIZ/social-dashboard" && node coletor/cartoes-fila.mjs "$WORKERS") || echo erro; }

rodando() { jobs -rp | wc -l | tr -d ' '; }

log "vigia no ar (até $WORKERS robôs ao mesmo tempo)"
voltas=0
while true; do
  n=$(fila)
  if [ "$n" = erro ]; then
    log "não consegui ler a fila; tento de novo em 30 s"; sleep 20
  elif [ "$n" -gt 0 ]; then
    r=$(rodando)
    # Só atualiza o código com NENHUM robô rodando: pull no meio de um trocaria os arquivos debaixo dele.
    [ "$r" -eq 0 ] && atualizar
    novos=$((WORKERS - r)); [ "$novos" -gt "$n" ] && novos=$n   # um robô novo só se há pedido esperando por ele
    for ((i = 1; i <= novos; i++)); do log "pedido na fila: robô $((r + i))"; trabalhador $((r + i)) & sleep 3; done
  else
    # A cada ~10 min roda um robô mesmo com a fila vazia: é ele quem devolve à fila o pedido travado em `rodando`.
    voltas=$((voltas + 1))
    if [ "$voltas" -ge 60 ] && [ "$(rodando)" -eq 0 ]; then voltas=0; atualizar; trabalhador 1 & fi
  fi
  sleep 10
done
