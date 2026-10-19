#!/bin/sh
# Teste do gerar-core-env-go.py com env de mentira. Uso: sh ops/virada/vps/gerar-core-env-go.test.sh
set -eu
D=$(mktemp -d); trap 'rm -rf "$D"' EXIT
cd "$(dirname "$0")"
cat > "$D/core.env" << 'EOF2'
OUTRA=1
CORE_SHOPIFY_DESTINOS='[{"nome":"pdv","url":"https://pdv/x","topicos":["orders/create"],"segredo":"s-pdv","ativo":true},{"nome":"supabase_checkout","url":"http://127.0.0.1:9/","topicos":["carts/create"],"segredo":"s-chk","ativo":true},{"nome":"supabase_abandono","url":"https://x.supabase.co/functions/v1/receber-webhook-abandono","topicos":["checkouts/create"],"segredo":"s-abd","ativo":true}]'
META_HOSTS_MIDIA=x.supabase.co
CADASTRO_SUPABASE_URL=https://x.supabase.co
ULTIMA=2
EOF2
echo VESSEL_INTERNO_SEGREDO=chave-interna > "$D/api.env"
echo seg-pedidos > "$D/seg"
API_ENV="$D/api.env" SEGREDO_PEDIDOS_ARQ="$D/seg" python3 -I gerar-core-env-go.py "$D/core.env" "$D/core.env.go"
# 2ª geração a partir da saída: idempotente
API_ENV="$D/api.env" SEGREDO_PEDIDOS_ARQ="$D/seg" python3 -I gerar-core-env-go.py "$D/core.env.go" "$D/core.env.go2"
cmp "$D/core.env.go" "$D/core.env.go2"
g() { grep -c -F -- "$1" "$D/core.env.go" | grep -qx 1 || { echo "FALHOU: $1" >&2; exit 1; }; }
g "OUTRA=1"; g "ULTIMA=2"
g '"nome":"supabase_checkout","url":"https://central.rbvcompany.com/api/receber-webhook-checkout"'
g '"nome":"supabase_abandono","url":"https://central.rbvcompany.com/api/receber-webhook-abandono"'
g '"nome":"central_pedidos","topicos":["orders/create","orders/paid","orders/updated"],"ativo":true,"url":"https://central.rbvcompany.com/api/receber-webhook-pedido-shopify","segredo":"seg-pedidos"'
g '"segredo":"s-chk"'; g '"segredo":"s-abd"'
g "META_HOSTS_MIDIA=x.supabase.co,central.rbvcompany.com"
g "CADASTRO_SUPABASE_URL=https://central.rbvcompany.com"; g "CADASTRO_SUPABASE_CHAVE=chave-interna"; g "CADASTRO_ACEITA_P_TESTE=false"
[ "$(stat -f %Lp "$D/core.env.go" 2> /dev/null || stat -c %a "$D/core.env.go")" = 600 ]
echo "gerar-core-env-go: OK"
