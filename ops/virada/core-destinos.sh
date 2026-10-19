#!/bin/sh
# Segura no Core as entregas da Shopify para o Supabase na janela da virada (plano 01, VIRADA-2026-10).
#   janela [--imprimir]  supabase_checkout, supabase_abandono e, se existir, supabase_pedido (o webhook de pedidos
#                 que sai do admin da Shopify e passa pelo Core) de CORE_SHOPIFY_DESTINOS -> http://127.0.0.1:9/:
#                 conexão recusada, o Core guarda cada evento em webhook_entregas (pendente) e tenta de novo em
#                 +1, +5, +15 e +60 min; na 5ª tentativa (~81 min depois de chegar) vira falhou e para. O resto
#                 do env fica igual byte a byte. Guarda o env de antes em $BK. --imprimir só mostra a troca.
#   instalar ARQ  instala o env ARQ (caminho absoluto no alvo; T+14: o core.env.go) e solta o retido.
#   restaurar     volta o env de antes da janela byte a byte e solta o retido (rollback).
#   soltar        retido dos destinos do Supabase (pendente; falhou desde o início da janela) -> pendente já, com
#                 tentativas 0; a varredura de 1 min do Core entrega. Com a janela ligada, só recomeça os ~81 min.
#   contar        entregas dos destinos do Supabase por status desde o início da janela (só leitura).
# Cada troca grava os dois arquivos que o deploy.sh compara e roda o deploy do Core com SKIP_PULL=1 (nada de
# código novo; o core-go é recriado: segundos sem receber, a Shopify reenvia). Se o deploy falhar (ele volta as
# imagens e AVISA por WhatsApp e e-mail), volta o env anterior e deploya de novo. Só nomes de chave e
# esquema://host vão para a saída, nunca segredo.
# Uso: sh ops/virada/core-destinos.sh janela [--imprimir] | instalar ARQ | restaurar | soltar | contar
#      (NA_VPS como no spool-nginx.sh)
# Saída: 0 = feito (ou já estava); 1 = falhou (env anterior de volta); 2 = uso.
set -eu
uso() { sed -n '2,18p' "$0" >&2; exit 2; }
case "${1:-}:$#" in
  janela:1|restaurar:1|soltar:1|contar:1|instalar:2) ;;
  janela:2) [ "$2" = --imprimir ] || uso ;;
  *) uso ;;
esac
NA_VPS=${NA_VPS:-ssh -o BatchMode=yes ${VPS:-op}}
q() { printf "'%s'" "$(printf %s "$1" | sed "s/'/'\\\\''/g")"; }
CORE_SRC=${CORE_SRC:-/root/core-src}

{
  echo "set -eu"
  echo "ACAO=$(q "$1") ARG2=$(q "${2:-}") BK=$(q "${BK:-/root/virada/core}") CORE_SRC=$(q "$CORE_SRC")"
  echo "SEGREDOS=$(q "${SEGREDOS:-/root/secrets/core.env}") DEPLOY_ENV=$(q "${DEPLOY_ENV:-$CORE_SRC/services/core/deploy/.env}")"
  # ensaio: DEPLOY e DB trocam o deploy.sh e o mysql do core-db por comandos falsos
  echo "DEPLOY=$(q "${DEPLOY:-}") DB=$(q "${DB:-}")"
  cat << 'NO_ALVO'
umask 077
falha() { echo "FALHOU: $*" >&2; exit 1; }

destinos() {  # trocar ENV SAIDA|- (sai 3 se já está na janela) | diff A B
  python3 - "$@" << 'PY'
import json, sys
from urllib.parse import urlsplit
CHAVE, RET, ALVO = "CORE_SHOPIFY_DESTINOS", "http://127.0.0.1:9/", ("supabase_checkout", "supabase_abandono", "supabase_pedido")
OBRIGATORIOS = ALVO[:2]  # supabase_pedido só existe depois que o dono tira o webhook de pedidos do admin

def falha(m):
    print("FALHOU: " + m, file=sys.stderr)
    sys.exit(1)

def ler(arq):
    with open(arq, encoding="utf-8", newline="") as f:
        linhas = f.read().split("\n")
    i = [n for n, l in enumerate(linhas) if l.startswith(CHAVE + "=")]
    if len(i) != 1:
        falha("%s: %d linhas %s (esperava 1)" % (arq, len(i), CHAVE))
    v = linhas[i[0]][len(CHAVE) + 1:]
    if len(v) < 2 or v[0] != "'" or v[-1] != "'":
        falha("%s: %s fora de aspas simples" % (arq, CHAVE))
    try:
        ds = json.loads(v[1:-1])
    except ValueError:
        falha("%s: JSON inválido em %s (o Core ficaria sem destino nenhum, calado)" % (arq, CHAVE))
    if not isinstance(ds, list) or not all(isinstance(d, dict) and d.get("nome") and (d.get("url") or d.get("urls")) for d in ds):
        falha("%s: %s não é uma lista de destinos com nome e url" % (arq, CHAVE))
    por = {d["nome"]: d for d in ds}
    if len(por) != len(ds):
        falha("%s: nome de destino repetido" % arq)
    for n in OBRIGATORIOS:  # webhook_entregas guarda o NOME do destino: sem ele, o retido fica órfão
        if n not in por:
            falha("%s: sem o destino %s" % (arq, n))
    return linhas, i[0], ds, por

def mostra(d):  # sem usuário, senha, query e, fora dos destinos do Supabase, sem caminho (n8n leva segredo no caminho)
    p = urlsplit(d.get("url") or "")
    if not p.scheme:
        return "(urls)" if d.get("urls") else "(sem url)"
    return "%s://%s%s%s" % (p.scheme, p.hostname, ":%s" % p.port if p.port else "", p.path if d["nome"] in ALVO else "")

modo, a, b = sys.argv[1:4]
if modo == "trocar":
    linhas, i, ds, por = ler(a)
    alvo = [n for n in ALVO if n in por]
    for n in alvo:
        if "urls" in por[n] or por[n].get("ativo") is False:
            falha("%s tem urls ou está inativo: trocar à mão" % n)
    if all(por[n].get("url") == RET for n in alvo):
        print("já na janela: %s -> %s" % (", ".join(alvo), RET))
        sys.exit(3)
    antes = json.loads(json.dumps(ds))
    for n in alvo:
        print("%s: %s -> %s" % (n, mostra(por[n]), RET))
        por[n]["url"] = RET
    novo = json.dumps(ds, ensure_ascii=False, separators=(",", ":"))
    if "'" in novo:
        falha("aspas simples dentro do JSON")
    if [dict(d, url=RET) if d["nome"] in ALVO else d for d in antes] != json.loads(novo):
        falha("a troca mudaria mais que as url dos destinos do Supabase")
    linhas[i] = "%s='%s'" % (CHAVE, novo)
    if b != "-":
        with open(b, "w", encoding="utf-8", newline="") as f:
            f.write("\n".join(linhas))
elif modo == "diff":  # o que muda de A para B, sem valores
    la, _, _, pa = ler(a)
    lb, _, _, pb = ler(b)
    for n in ALVO:
        if n in pa and n not in pb:
            falha("%s sem o destino %s (o retido dele ficaria órfão)" % (b, n))
    ka, kb = ({l.split("=", 1)[0]: l for l in ls if "=" in l and not l.lstrip().startswith("#")} for ls in (la, lb))
    for k in sorted(ka.keys() | kb.keys()):
        if k != CHAVE and ka.get(k) != kb.get(k):
            print("  %s %s" % ("-" if k not in kb else "+" if k not in ka else "~", k))
    for n in list(pa) + [n for n in pb if n not in pa]:
        da, db = pa.get(n), pb.get(n)
        if da is None or db is None:
            print("  destino %s %s %s" % ("+" if da is None else "-", n, mostra(db or da)))
        elif da != db:
            mud = sorted(c for c in da.keys() | db.keys() if c != "url" and da.get(c) != db.get(c))
            url = " %s -> %s;" % (mostra(da), mostra(db)) if da.get("url") != db.get("url") else ""
            print("  destino ~ %s:%s%s" % (n, url, " mudou " + ", ".join(mud) if mud else ""))
PY
}

deploy_core() {
  echo "deploy do Core (log em $BK/deploy-$TS.log)..."
  rc=0
  if [ -n "$DEPLOY" ]; then
    sh -c "$DEPLOY" >> "$BK/deploy-$TS.log" 2>&1 < /dev/null || rc=$?
  else
    CORE_SEGREDOS="$SEGREDOS" SKIP_PULL=1 flock -w 1800 /root/.revisao-deploy-core.lock \
      "$CORE_SRC/services/core/deploy/deploy.sh" >> "$BK/deploy-$TS.log" 2>&1 < /dev/null || rc=$?
  fi
  tail -3 "$BK/deploy-$TS.log" | grep -v -i -E 'senha|token|secret|password|chave' | cut -c1-200 || true
  return $rc
}

mesmo_codigo() {  # o deploy reconstrói do core-src: tem de ser o commit que já roda, sem alteração local
  [ -z "$DEPLOY" ] || return 0
  rodando=$(docker inspect core-go --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' < /dev/null)
  local_=$(git -C "$CORE_SRC" rev-parse --short=9 HEAD)
  sujo=$(git -C "$CORE_SRC" status --porcelain -uno | head -1)
  [ "$rodando" = "$local_" ] && [ -z "$sujo" ] && return 0
  echo "AVISO: o deploy subiria outro código (rodando $rodando; core-src $local_${sujo:+ com alteração local})" >&2
  return 1
}

poe() {  # $1 nos dois arquivos, cada um por tmp + mv
  for f in "$SEGREDOS" "$DEPLOY_ENV"; do
    cp "$1" "$f.virada-novo" && chmod 600 "$f.virada-novo" && mv "$f.virada-novo" "$f" || return 1
  done
}

instala() {  # $1: env novo. Grava os dois arquivos e deploya; se falhar, volta o anterior e deploya de novo.
  echo "o que muda no env (sem valores):"
  destinos diff "$SEGREDOS" "$1"
  cp -p "$SEGREDOS" "$BK/core.env.$TS"
  if poe "$1" && deploy_core; then return 0; fi
  echo "FALHOU a troca; voltando o env anterior ($BK/core.env.$TS)" >&2
  poe "$BK/core.env.$TS" || falha "não consegui voltar o env: copiar $BK/core.env.$TS para $SEGREDOS e $DEPLOY_ENV à mão"
  deploy_core || falha "também falhou o deploy do env anterior (ele está nos arquivos): conferir o Core já"
  exit 1
}

retido() {  # $1: SQL; DESDE = início da janela - 90 min: o Core tenta por ~81 min, então o que já vinha falhando antes da janela e virou falhou dentro dela também sai (sem início: 1 dia, e o falhou fica de fora)
  if [ -f "$BK/inicio" ]; then
    grep -qxE '[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}' "$BK/inicio" || falha "$BK/inicio ilegível"
    sql=$(printf '%s\n' "$1" | sed "s/DESDE/'$(cat "$BK/inicio")' - INTERVAL 90 MINUTE/g")
  else
    sql=$(printf '%s\n' "$1" | sed -e "s/ OR (status='falhou' AND created_at >= DESDE)//" -e "s/DESDE/UTC_TIMESTAMP() - INTERVAL 1 DAY/g")
  fi
  if [ -n "$DB" ]; then printf '%s\n' "$sql" | sh -c "$DB"
  else printf '%s\n' "$sql" | docker exec -i core-db sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql -uroot -N "$MYSQL_DATABASE"'; fi
}
CONTAR="SELECT destino, status, COUNT(*) FROM webhook_entregas WHERE destino IN ('supabase_checkout','supabase_abandono','supabase_pedido')
  AND created_at >= DESDE GROUP BY destino, status ORDER BY destino, status;"
soltar() {
  echo "antes de soltar (destino, status, quantas):"
  retido "$CONTAR"
  retido "UPDATE webhook_entregas SET status='pendente', tentativas=0, proxima_tentativa_em=UTC_TIMESTAMP(),
  updated_at=UTC_TIMESTAMP() WHERE destino IN ('supabase_checkout','supabase_abandono','supabase_pedido') AND descartado_em IS NULL
  AND (status='pendente' OR (status='falhou' AND created_at >= DESDE));
SELECT CONCAT('soltas: ', ROW_COUNT());"
  echo "a varredura de 1 min do Core entrega; conferir com: core-destinos.sh contar"
}

iguais() { cmp -s "$SEGREDOS" "$DEPLOY_ENV"; }
TS=$(date -u +%Y%m%d-%H%M%S)
case $ACAO in
janela)
  iguais || falha "$SEGREDOS e $DEPLOY_ENV diferem (o deploy.sh abortaria): alguém mexeu num só"
  if [ -n "$ARG2" ]; then
    rc=0; destinos trocar "$SEGREDOS" - || rc=$?
    [ $rc -eq 3 ] && exit 0
    mesmo_codigo || echo "(com --imprimir só avisa; a janela de verdade para aqui)" >&2
    exit $rc
  fi
  mesmo_codigo || falha "acertar o core-src antes da janela (git -C $CORE_SRC status / log)"
  mkdir -p "$BK" && chmod 700 "$BK"
  rc=0; destinos trocar "$SEGREDOS" "$BK/core.env.janela" || rc=$?
  [ $rc -eq 3 ] && exit 0
  [ $rc -eq 0 ] || exit 1
  # repetir a janela depois do instalar (T+14) apagaria o env de antes, que o restaurar usa
  if [ -f "$BK/core.env.antes-janela" ] && ! cmp -s "$SEGREDOS" "$BK/core.env.antes-janela"; then
    falha "o env atual não é o de antes da janela ($BK/core.env.antes-janela): já passou do T+14? para outra janela, renomear esse arquivo"
  fi
  cp -p "$SEGREDOS" "$BK/core.env.antes-janela"
  date -u '+%Y-%m-%d %H:%M:%S' > "$BK/inicio"
  instala "$BK/core.env.janela"
  echo "ok: Core segurando os destinos do Supabase desde $(cat "$BK/inicio") UTC; conferir com: core-destinos.sh contar"
  ;;
instalar|restaurar)
  if [ "$ACAO" = instalar ]; then novo=$ARG2; else novo=$BK/core.env.antes-janela; fi
  case $novo in /*) ;; *) falha "$novo: caminho absoluto no alvo" ;; esac
  [ -f "$novo" ] || falha "$novo não existe"
  destinos diff "$novo" "$novo" > /dev/null  # valida antes de tocar em qualquer arquivo
  if ! iguais; then
    [ "$ACAO" = restaurar ] || falha "$SEGREDOS e $DEPLOY_ENV diferem: alguém mexeu num só"
    echo "AVISO: $SEGREDOS e $DEPLOY_ENV diferiam; o restaurar grava os dois" >&2
  fi
  mkdir -p "$BK" && chmod 700 "$BK"
  if iguais && cmp -s "$novo" "$SEGREDOS"; then
    echo "o env já é $novo (sem deploy)"
  else
    if ! mesmo_codigo; then
      [ "$ACAO" = restaurar ] || falha "acertar o core-src antes de instalar"
      echo "o restaurar segue mesmo assim: é o rollback" >&2
    fi
    instala "$novo"
  fi
  soltar
  ;;
soltar) soltar ;;
contar) echo "destino, status, quantas:"; retido "$CONTAR" ;;
esac
NO_ALVO
} | $NA_VPS sh
