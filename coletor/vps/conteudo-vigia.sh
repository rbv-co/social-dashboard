#!/usr/bin/env bash
# VIGIA DA FILA DE PAUTA DE CONTEÚDO, NA VPS. Roda como serviço (conteudo-vigia.service).
#
# A cada 10 s pergunta ao banco (coletor/conteudo-fila.mjs) se há pedido; havendo, atualiza o código (só o que está na
# `main`) e roda UM robô (ideias ou semana) por vez na VPS inteira. Substitui o GitHub Actions conteudo-ideias.yml.
# Tudo por `pg` com o papel `conteudo_robo` (ops/vps/api-db/papel-conteudo.sql). A senha vem de CONTEUDO_DB_SENHA
# (/etc/robos.env) e vai para o `pg` por PGPASSWORD, nunca por argumento nem pela URL.
#
# CONTEUDO_DATABASE_URL: se não vier pronta, é montada com o IP do `api-db` na rede api_net (como o copia-do-banco.sh).
# ANTHROPIC_API_KEY: a MESMA que o budget-ia já usa em /etc/robos.env.
set -u
RAIZ="${RAIZ:-/opt/cartoes-ean}"
REPO="$RAIZ/social-dashboard"
export PATH="$RAIZ/node/bin:$PATH"
: "${CONTEUDO_DB_SENHA:?falta CONTEUDO_DB_SENHA}"
export PGPASSWORD="$CONTEUDO_DB_SENHA"
log() { echo "$(date -u +%FT%TZ) $*"; }

if [ -z "${CONTEUDO_DATABASE_URL:-}" ]; then
  ip=$(docker inspect -f '{{(index .NetworkSettings.Networks "api_net").IPAddress}}' api-db 2>/dev/null)
  [ -n "$ip" ] || { log "erro: não achei o IP do api-db"; exit 1; }
  export CONTEUDO_DATABASE_URL="postgres://conteudo_robo@$ip:5432/api"
fi

fila() { (cd "$REPO" && node coletor/conteudo-fila.mjs "$@"); }

log "vigia de conteúdo no ar"
while true; do
  linha=$(fila pegar) || { log "não consegui ler a fila (erro acima)"; sleep 30; continue; }
  if [ -n "$linha" ]; then
    id=${linha%% *}; tipo=${linha##* }
    # Lista fechada: o valor vira nome de arquivo executado.
    case "$tipo" in
      ideias) s=conteudo-ideias.mjs ;;
      semana) s=conteudo-semana.mjs ;;
      *) fila falhou "$id"; continue ;;
    esac
    # Sem robô rodando (este é o único): pull não troca arquivo debaixo de ninguém. Falha de rede não impede a rodada.
    git -C "$REPO" pull -q --ff-only || log "aviso: pull falhou"
    log "job $id ($tipo)"
    (cd "$REPO" && timeout 15m node coletor/"$s" --job "$id") 2>&1 | sed -u "s/^/[$tipo] /"
    # Saiu com falha sem fechar o job (o robô fecha sozinho quando consegue): rede de segurança.
    [ "${PIPESTATUS[0]}" -eq 0 ] || fila falhou "$id" || true
    continue
  fi
  sleep 10
done
