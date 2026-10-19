#!/bin/sh
# Teste do core-destinos.sh sem VPS: o script roda aqui (NA_VPS=env) sobre um core.env falso, com o deploy e o mysql
# trocados por comandos que só registram. Prova: só as url dos destinos do Supabase mudam, restaurar volta byte a byte, deploy que falha
# devolve o env anterior, env torto não chega a ser gravado e nenhum segredo vai para a saída.
# Uso: sh ops/virada/core-destinos.test.sh
set -eu
AQUI=$(cd "$(dirname "$0")" && pwd); S="$AQUI/core-destinos.sh"
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
falha() { echo "FALHOU: $*" >&2; exit 1; }

mkdir -p "$T/secrets" "$T/deploy"
D='[{"nome":"producao","url":"https://prod.exemplo/webhook","segredo":"SEGREDO-FALSO-1","topicos":["orders/create"],"ativo":true},'
D=$D'{"nome":"supabase_checkout","url":"https://sb.exemplo/functions/v1/receber-webhook-checkout","segredo":"SEGREDO-FALSO-2","topicos":["checkouts/create"],"ativo":true},'
D=$D'{"nome":"supabase_abandono","url":"https://sb.exemplo/functions/v1/receber-webhook-abandono","segredo":"SEGREDO-FALSO-3","topicos":["checkouts/update"],"ativo":true},'
D=$D'{"nome":"n8n","url":"https://n8n.exemplo/webhook/SEGREDO-FALSO-4","segredo":"SEGREDO-FALSO-5","topicos":["orders/paid"],"ativo":true}]'
printf '# Core\nCORE_APP_ENV=production\nCORE_DB_SENHA=SEGREDO-FALSO-6\nCORE_SHOPIFY_FANOUT=true\nCORE_SHOPIFY_DESTINOS=%s\nOUTRA="com espaço"\n' "'$D'" > "$T/original"
cp "$T/original" "$T/secrets/core.env"; cp "$T/original" "$T/deploy/.env"
export NA_VPS=env BK="$T/bk" SEGREDOS="$T/secrets/core.env" DEPLOY_ENV="$T/deploy/.env" DB="cat >> $T/sql.log"
# deploy falso: registra; se existir $T/falhar, falha UMA vez (a volta do env anterior passa)
export DEPLOY="echo deploy >> $T/deploys; if [ -e $T/falhar ]; then rm $T/falhar; exit 1; fi"
roda() { rc=0; sh "$S" "$@" >> "$T/saida" 2>&1 || rc=$?; }
deploys() { cat "$T/deploys" 2> /dev/null | wc -l | tr -d ' '; }
iguais_ao() { cmp -s "$1" "$SEGREDOS" && cmp -s "$1" "$DEPLOY_ENV"; }

roda; [ $rc -eq 2 ] || falha "sem argumento: rc $rc (esperava 2)"
roda janela --outra; [ $rc -eq 2 ] || falha "janela --outra: rc $rc"
roda instalar; [ $rc -eq 2 ] || falha "instalar sem arquivo: rc $rc"

roda janela --imprimir
[ $rc -eq 0 ] && iguais_ao "$T/original" && [ ! -e "$BK" ] && [ "$(deploys)" = 0 ] || falha "--imprimir mexeu em algo (rc $rc)"
grep -q 'supabase_checkout: https://sb.exemplo/functions/v1/receber-webhook-checkout -> http://127.0.0.1:9/' "$T/saida" || falha "--imprimir não mostrou a troca"

roda janela
[ $rc -eq 0 ] && [ "$(deploys)" = 1 ] || falha "janela: rc $rc, deploys $(deploys)"
cmp -s "$BK/core.env.antes-janela" "$T/original" || falha "antes-janela difere do original"
cmp -s "$SEGREDOS" "$DEPLOY_ENV" || falha "janela gravou só um dos arquivos"
[ "$(diff "$T/original" "$SEGREDOS" | grep -c '^[<>]')" = 2 ] || falha "janela mudou mais que a linha dos destinos"
python3 - "$T/original" "$SEGREDOS" << 'PY' || falha "janela: destinos errados"
import json, sys
def ds(a):
    l = [l for l in open(a, encoding="utf-8") if l.startswith("CORE_SHOPIFY_DESTINOS=")][0]
    return json.loads(l.split("=", 1)[1].strip()[1:-1])
a, b = ds(sys.argv[1]), ds(sys.argv[2])
assert [d["nome"] for d in a] == [d["nome"] for d in b]
for x, y in zip(a, b):
    if x["nome"].startswith("supabase_"):
        assert y["url"] == "http://127.0.0.1:9/" and dict(x, url=None) == dict(y, url=None), x["nome"]
    else:
        assert x == y, x["nome"]
PY
grep -qxE '[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}' "$BK/inicio" || falha "inicio ausente ou torto"
[ "$(stat -f %Lp "$BK" 2> /dev/null || stat -c %a "$BK")" = 700 ] || falha "BK sem 700"
[ "$(stat -f %Lp "$SEGREDOS" 2> /dev/null || stat -c %a "$SEGREDOS")" = 600 ] || falha "core.env sem 600"

roda janela
[ $rc -eq 0 ] && [ "$(deploys)" = 1 ] || falha "janela 2×: rc $rc, deploys $(deploys)"
grep -q 'já na janela' "$T/saida" || falha "janela 2× não avisou"

roda contar; [ $rc -eq 0 ] || falha "contar: rc $rc"
grep -q "created_at >= '$(cat "$BK/inicio")' - INTERVAL 90 MINUTE" "$T/sql.log" || falha "contar sem o início da janela"

roda restaurar
[ $rc -eq 0 ] && [ "$(deploys)" = 2 ] && iguais_ao "$T/original" || falha "restaurar: rc $rc, deploys $(deploys)"
grep -q "status='falhou' AND created_at >= '$(cat "$BK/inicio")'" "$T/sql.log" || falha "soltar sem o falhou da janela"
grep -q "descartado_em IS NULL" "$T/sql.log" || falha "soltar mexeria em descartado"
roda restaurar
[ $rc -eq 0 ] && [ "$(deploys)" = 2 ] || falha "restaurar 2×: rc $rc, deploys $(deploys)"

# deploy que falha: volta o env anterior nos dois arquivos e deploya de novo
touch "$T/falhar"
roda janela
[ $rc -eq 1 ] && [ "$(deploys)" = 4 ] && iguais_ao "$T/original" || falha "deploy falho: rc $rc, deploys $(deploys)"
grep -q 'FALHOU a troca; voltando o env anterior' "$T/saida" || falha "deploy falho sem aviso"

# T+14: instalar o env da API nova (mesmos nomes de destino, url nova e uma chave a mais)
sed -e 's#https://sb.exemplo/functions/v1/receber-webhook-#https://central.exemplo/api/receber-webhook-#g' "$T/original" > "$T/core.env.go"
echo 'CORE_NOVA=1' >> "$T/core.env.go"
roda janela
roda instalar "$T/core.env.go"
[ $rc -eq 0 ] && iguais_ao "$T/core.env.go" || falha "instalar core.env.go: rc $rc"
grep -q '+ CORE_NOVA' "$T/saida" && grep -q 'destino ~ supabase_checkout: http://127.0.0.1:9/ -> https://central.exemplo/api/receber-webhook-checkout' "$T/saida" ||
  falha "instalar sem o diff esperado"
# depois do T+14, repetir a janela apagaria o env de antes da janela: barra
n=$(deploys); roda janela
[ $rc -eq 1 ] && [ "$(deploys)" = "$n" ] && iguais_ao "$T/core.env.go" || falha "janela depois do instalar: rc $rc"
grep -q 'já passou do T+14' "$T/saida" || falha "guarda do antes-janela sem mensagem"
roda restaurar
[ $rc -eq 0 ] && iguais_ao "$T/original" || falha "restaurar depois do instalar: rc $rc"

# env torto não chega a ser gravado nem deployado
n=$(deploys)
sed 's/"nome":"supabase_abandono"/"nome":"supabase_abandonos"/' "$T/original" > "$T/renomeado"
roda instalar "$T/renomeado"; [ $rc -eq 1 ] && iguais_ao "$T/original" || falha "instalar com destino renomeado: rc $rc"
sed 's/^CORE_SHOPIFY_DESTINOS=.\[/CORE_SHOPIFY_DESTINOS='"'"'[[/' "$T/original" > "$T/torto"
roda instalar "$T/torto"; [ $rc -eq 1 ] && iguais_ao "$T/original" || falha "instalar com JSON inválido: rc $rc"
grep -q 'JSON inválido' "$T/saida" || falha "JSON inválido sem mensagem"
roda instalar core.env.go; [ $rc -eq 1 ] || falha "instalar com caminho relativo: rc $rc"
roda instalar "$T/nao-existe"; [ $rc -eq 1 ] || falha "instalar de arquivo inexistente: rc $rc"
[ "$(deploys)" = "$n" ] || falha "env torto chegou ao deploy"

# um arquivo mexido à mão: janela e instalar param; restaurar grava os dois
echo 'A_MAO=1' >> "$DEPLOY_ENV"
roda janela; [ $rc -eq 1 ] || falha "janela com .env diferente: rc $rc"
roda instalar "$T/core.env.go"; [ $rc -eq 1 ] || falha "instalar com .env diferente: rc $rc"
roda restaurar; [ $rc -eq 0 ] && iguais_ao "$T/original" || falha "restaurar com .env diferente: rc $rc"

# sem início de janela, o soltar não pega falhou antigo
rm "$BK/inicio"; : > "$T/sql.log"
roda soltar; [ $rc -eq 0 ] || falha "soltar sem inicio: rc $rc"
grep -q "falhou" "$T/sql.log" && falha "soltar sem inicio pegaria falhou antigo"
grep -q "UTC_TIMESTAMP() - INTERVAL 1 DAY" "$T/sql.log" || falha "soltar sem inicio sem o limite de 1 dia"

# pedidos já pelo Core (o dono tirou o webhook do admin): supabase_pedido entra na janela, no soltar e no contar,
# e um core.env.go sem ele não instala (o retido do pedido ficaria órfão)
P='{"nome":"supabase_pedido","url":"https://sb.exemplo/functions/v1/receber-webhook-pedido-shopify","segredo":"SEGREDO-FALSO-7","topicos":["orders/create","orders/paid","orders/updated"],"ativo":true}'
sed "s#\"ativo\":true}]'\$#\"ativo\":true},$P]'#" "$T/original" > "$T/com-pedido"
grep -q supabase_pedido "$T/com-pedido" || falha "fixture sem supabase_pedido"
export BK="$T/bk2"; cp "$T/com-pedido" "$SEGREDOS"; cp "$T/com-pedido" "$DEPLOY_ENV"; : > "$T/sql.log"
roda janela
[ $rc -eq 0 ] && cmp -s "$SEGREDOS" "$DEPLOY_ENV" || falha "janela com pedido: rc $rc"
grep -q 'supabase_pedido: https://sb.exemplo/functions/v1/receber-webhook-pedido-shopify -> http://127.0.0.1:9/' "$T/saida" ||
  falha "janela não reteve o pedido"
[ "$(grep -o '"url":"http://127.0.0.1:9/"' "$SEGREDOS" | wc -l | tr -d ' ')" = 3 ] || falha "janela com pedido: não são 3 url retidas"
roda instalar "$T/core.env.go"
[ $rc -eq 1 ] && grep -q 'supabase_pedido (o retido dele ficaria órfão)' "$T/saida" || falha "instalar sem o pedido: rc $rc"
roda restaurar
[ $rc -eq 0 ] && iguais_ao "$T/com-pedido" || falha "restaurar com pedido: rc $rc"
[ "$(grep -c "'supabase_abandono','supabase_pedido')" "$T/sql.log")" -ge 1 ] || falha "soltar sem o pedido"

! grep -q 'SEGREDO-FALSO' "$T/saida" || falha "segredo na saída: $(grep -o 'SEGREDO-FALSO-[0-9]' "$T/saida" | sort -u | tr '\n' ' ')"
echo "ok: core-destinos.sh ($(deploys) deploys falsos, $(grep -c . "$T/saida") linhas de saída, nenhum segredo)"
