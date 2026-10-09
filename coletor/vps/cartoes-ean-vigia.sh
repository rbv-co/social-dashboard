#!/usr/bin/env bash
# VIGIA DA FILA DE CARTÕES EAN, NA VPS (/opt/cartoes-ean). Roda como serviço (cartoes-ean.service).
#
# Olha a fila a cada 10 s; havendo pedido, atualiza o código (só o que está na `main`) e chama o robô de sempre
# (coletor/robo-de-cartoes.mjs). Sem preparação de máquina, sem checkout, sem cache: o cartão sai em segundos.
# O workflow do GitHub (.github/workflows/cartoes-ean.yml) continua como retaguarda; `vessel_cartao_pegar_da_fila`
# é atômica, então os dois não pegam o mesmo pedido.
#
# Layout esperado em $RAIZ:  node/ (Node 22)  venv/ (Python)  social-dashboard/  vessel-brasil/
# Segredos: SUPABASE_URL e SUPABASE_SERVICE_KEY vêm do EnvironmentFile do serviço (/etc/cartoes-ean.env).
set -u
RAIZ="${RAIZ:-/opt/cartoes-ean}"
export PATH="$RAIZ/node/bin:$RAIZ/venv/bin:$PATH"
export VESSEL_DIR="$RAIZ/vessel-brasil"
: "${SUPABASE_URL:?falta SUPABASE_URL}" "${SUPABASE_SERVICE_KEY:?falta SUPABASE_SERVICE_KEY}"
log() { echo "$(date -u +%FT%TZ) $*"; }

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

gerar() {
  atualizar
  (cd "$RAIZ/social-dashboard" && node --import ./coletor/lib/curl-fetch.mjs coletor/robo-de-cartoes.mjs) \
    || log "robô terminou com erro (o pedido volta ao banco como falhou ou é recolocado depois de 150 min)"
}

# Leitura que falhou NÃO é fila vazia: devolve "erro" e o laço espera mais.
fila() {
  local corpo
  corpo=$(curl -fsS --max-time 20 "$SUPABASE_URL/rest/v1/vessel_cartao_pedidos?situacao=eq.na_fila&select=id&limit=1" \
    -H "apikey: $SUPABASE_SERVICE_KEY" -H "Authorization: Bearer $SUPABASE_SERVICE_KEY") || { echo erro; return; }
  [ "$corpo" = "[]" ] && echo vazia || echo tem
}

log "vigia no ar"
voltas=0
while true; do
  case "$(fila)" in
    tem) log "pedido na fila"; gerar ;;
    erro) log "não consegui ler a fila; tento de novo em 30 s"; sleep 20 ;;
    *)
      # A cada ~10 min roda o robô mesmo com a fila vazia: é ele quem devolve à fila o pedido travado em `rodando`.
      voltas=$((voltas + 1))
      if [ "$voltas" -ge 60 ]; then voltas=0; gerar; fi
      ;;
  esac
  sleep 10
done
