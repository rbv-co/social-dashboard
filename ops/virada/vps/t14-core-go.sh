#!/bin/sh
# T+14 da virada (na VPS): o Core passa a entregar ao Go (checkout, abandono e o destino novo de pedidos).
# Gera /root/virada/core.env.go do core.env de AGORA (gerar-core-env-go.py) e o instala pelo core-destinos.sh:
# grava core.env e deploy/.env, roda o deploy.sh do Core (SKIP_PULL=1; confere /up e reverte sozinho), solta as
# entregas retidas na janela e, se o deploy falhar, volta o env anterior e deploya de novo (saída 1).
# Uso: sh /root/virada/t14-core-go.sh [--imprimir]   (--imprimir: só gera o core.env.go e mostra o que muda)
set -eu
V=${V:-/root/virada}
ATUAL=${CORE_ENV:-/root/secrets/core.env}
python3 "$V/gerar-core-env-go.py" "$ATUAL" "$V/core.env.go"
echo "muda no core.env (só nomes e esquema://host):"
python3 -I - "$ATUAL" "$V/core.env.go" << 'PY'
import json, re, sys
def le(a):
    d = {}
    for l in open(a).read().splitlines():
        if "=" in l and not l.startswith("#"):
            k, v = l.split("=", 1)
            d[k] = v
    return d
a, b = le(sys.argv[1]), le(sys.argv[2])
for k in sorted(set(a) | set(b)):
    if a.get(k) == b.get(k):
        continue
    if k == "CORE_SHOPIFY_DESTINOS":
        antes = {x["nome"]: x for x in json.loads(a[k].strip("'"))}
        for x in json.loads(b[k].strip("'")):
            if antes.get(x["nome"]) == x:
                continue
            host = re.sub("(://[^/]+).*", "\\1", x["url"])
            print("  destino", x["nome"], "->", host)
    else:
        print("  " + k)
PY
[ "${1:-}" = --imprimir ] && exit 0
NA_VPS=env BK=$V/core exec sh "$V/core-destinos.sh" instalar "$V/core.env.go"
