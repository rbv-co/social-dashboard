#!/bin/sh
# Pré-voo da VPS para a janela (plano 08, VIRADA-2026-10; roteiro P4–P13 + api-db). SÓ LEITURA: não escreve na VPS
# (o `nginx -t` é na cópia /root/virada/nginx-teste), nunca imprime valor de segredo.
# Uso: sh ops/virada/preflight-vps.sh     (NA_VPS como no spool-nginx.sh; TUNEL=0 pula o teste do túnel do Mac)
# Saída: linhas `OK <item>`, `FALTA <item>` (bloqueia), `DONO <nome>` (passo do dono, não bloqueia). Última linha:
#   `PREFLIGHT VPS OK` (exit 0) ou `PREFLIGHT VPS: N item(ns) faltando` (exit 1).
set -eu
RAIZ=$(cd "$(dirname "$0")/../.." && pwd)
NA_VPS=${NA_VPS:-ssh -o BatchMode=yes ${VPS:-op}}
SAIDA=$(mktemp); trap 'rm -f "$SAIDA"' EXIT
FETCH=ok; git -C "$RAIZ" fetch -q origin 2> /dev/null || FETCH=falhou

$NA_VPS sh -s > "$SAIDA" << 'NO_ALVO' || true
V=/root/virada
ok() { echo "OK $*"; }
falta() { echo "FALTA $*"; }
dono() { echo "DONO $*"; }
tem() { grep -qE "^$2=[^'\"]" "$1" 2> /dev/null; }   # variável presente e não vazia (nem '' nem "")

# A. P4 e P7
c=$(curl -4 -s -o /dev/null -w '%{http_code}' --max-time 10 https://fcm.googleapis.com/fcm/send || true)
case $c in 404|405) ok "A/P4 saída IPv4 para o FCM ($c)" ;; *) falta "A/P4 FCM por IPv4 deu '$c' (esperado 404/405): o Web Push precisa" ;; esac
livre=$(df -BG --output=avail / | tail -1 | tr -dc 0-9); disp=$(free -m | awk 'NR==2{print $7}')
[ "${livre:-0}" -ge 20 ] && ok "A/P7 disco: ${livre} GB livres" || falta "A/P7 disco: ${livre} GB livres (< 20)"
[ "${disp:-0}" -ge 1500 ] && ok "A/P7 RAM: ${disp} MB disponíveis" || falta "A/P7 RAM: ${disp} MB disponíveis (< 1500)"

# B. P5 e P6
for f in api.env worker.env; do
  p=/root/secrets/$f
  [ -s $p ] && [ "$(stat -c %a $p)" = 600 ] && ok "B $f existe, modo 600" || falta "B $f ausente, vazio ou fora do modo 600"
  grep -q '^DATABASE_URL=.*@api-db:5432/api?.*pool_max_conns=16' $p && ok "B $f: DATABASE_URL no api-db com pool_max_conns=16" || falta "B $f: DATABASE_URL sem api-db/pool_max_conns=16"
done
grep -qx 'WORKER_TAREFAS_DESLIGADAS=\*' /root/secrets/worker.env && ok "B worker.env: WORKER_TAREFAS_DESLIGADAS=*" || falta "B worker.env sem WORKER_TAREFAS_DESLIGADAS=*"
for k in CORE_URL CORE_API_TOKEN VAPID_PUBLIC_KEY VAPID_PRIVATE_KEY VAPID_SUBJECT ARQUIVOS_SEGREDO VESSEL_INTERNO_SEGREDO ORIGENS_PERMITIDAS API_URL_PUBLICA SHOPIFY_WEBHOOK_SEGREDOS CHATWOOT_WEBHOOK_SEGREDO HOSTS_DE_MIDIA ZAPI_INSTANCE_ID ZAPI_INSTANCE_TOKEN ZAPI_TOKEN ANTHROPIC_ADMIN_KEY OPENAI_ADMIN_KEY ANTHROPIC_API_KEY_TRAFEGO; do
  tem /root/secrets/api.env $k && ok "B api.env $k" || falta "B api.env sem $k"
done
for k in CORE_URL CORE_API_TOKEN VAPID_PUBLIC_KEY VAPID_PRIVATE_KEY VAPID_SUBJECT ZAPI_INSTANCE_ID ZAPI_INSTANCE_TOKEN ZAPI_TOKEN ANTHROPIC_API_KEY_TRAFEGO; do
  tem /root/secrets/worker.env $k && ok "B worker.env $k" || falta "B worker.env sem $k"
done
for k in ZEPTOMAIL_TOKEN GITHUB_PAT; do tem /root/secrets/api.env $k && ok "B api.env $k" || dono "api.env $k"; done
grep -o '^CORE_API_ESCOPOS=.*' /root/secrets/core.env | tr ',' '\n' | grep -E 'social-dashboard:' | grep -q 'bling' && \
  grep -o '^CORE_API_ESCOPOS=.*' /root/secrets/core.env | tr ',' '\n' | grep 'social-dashboard:' | grep -q 'meta' && \
  grep -o '^CORE_API_ESCOPOS=.*' /root/secrets/core.env | tr ',' '\n' | grep 'social-dashboard:' | grep -q 'espelho' \
  && ok "B/P6 consumidor social-dashboard com bling, meta e espelho" || falta "B/P6 escopos do consumidor social-dashboard"

# C. P8
ver=$(sed -n 's/^API_VERSAO=//p' /root/api/.env 2> /dev/null)
a=$(docker image inspect "central-api:$ver" --format '{{.Architecture}}' 2> /dev/null || true)
[ "$a" = amd64 ] && ok "C/P8 imagem central-api:$ver (amd64) na VPS" || falta "C/P8 imagem central-api:$ver ausente ou não amd64"
echo "VERSAO $ver"

# D. P9
(cd /root/api && docker compose config -q 2> /dev/null) && ok "D/P9 docker compose config -q" || falta "D/P9 compose inválido"
[ -z "$(ss -ltn 'sport = :8080' | tail -n +2)" ] && ok "D/P9 8080 livre" || falta "D/P9 algo escuta na 8080 (a API não pode estar de pé antes do T+8)"
[ "$(stat -c %u:%g /var/lib/api/arquivos)" = 10001:10001 ] && [ -d /var/lib/api/arquivos/fabrica-criativos ] && ok "D/P9 /var/lib/api/arquivos (10001:10001, fabrica-criativos)" || falta "D/P9 /var/lib/api/arquivos"

# E. P10
for f in nginx-central-api.conf nginx-semquery.conf api-arquivos-e-storage.conf t10-nginx.sh spool-nginx.sh; do [ -s $V/$f ] || falta "E/P10 falta $V/$f"; done
[ -x $V/t10-nginx.sh ] && ok "E/P10 $V/t10-nginx.sh e os 3 arquivos de nginx" || falta "E/P10 t10-nginx.sh"
nginx -t -c $V/nginx-teste/nginx.conf > /dev/null 2>&1 && ok "E/P10 nginx -t na cópia (nginx-teste)" || falta "E/P10 nginx -t na cópia falhou (ou a cópia não existe: preparar-vps.sh nginx)"
grep -q 'central-api.conf' $V/nginx-teste/sites-enabled/central.rbvcompany.com 2> /dev/null && ok "E/P10 a cópia inclui central-api, arquivos-e-storage e chatwoot" || falta "E/P10 a cópia não tem os includes"
if grep -rhE '^\s*log_format\s+saude\b' /etc/nginx | grep -qE '\$(request|args|query_string|request_uri)\b'; then falta "E/P10 log_format saude com query"; else ok "E/P10 log_format saude sem \$request/\$args"; fi
grep -v 'central-chatwoot.conf' /etc/nginx/sites-enabled/central.rbvcompany.com | cmp -s - $V/central.rbvcompany.com && ok "E/P10 o nginx de produção ainda é o do backup (nada ligado; o include das rotas do Chatwoot do P17 não conta)" || falta "E/P10 o site da central mudou depois do backup (virada ligada ou alteração alheia?)"

# F. P11
[ -s $V/10-buckets.csv ] || falta "F/P11 falta $V/10-buckets.csv"
while IFS=, read -r b n t; do
  nd=$(find /var/lib/api/arquivos/$b -type f 2> /dev/null | wc -l); td=$(find /var/lib/api/arquivos/$b -type f -printf '%s\n' 2> /dev/null | awk '{s+=$1} END{print s+0}')
  if [ "$nd" = "$n" ] && [ "$td" = "$t" ]; then ok "F/P11 bucket $b: $n objetos, $t bytes"
  elif [ "$nd" -ge "$n" ]; then ok "F/P11 bucket $b: disco $nd/$td (csv $n/$t; subiu objeto depois: o T+8 recopia)"
  else falta "F/P11 bucket $b: disco $nd objetos/$td bytes, csv $n/$t"; fi
done < $V/10-buckets.csv

# G. P12
for f in central.rbvcompany.com core.env robos.env cartoes-ean.env pdv-backend.env chatwoot.env robos-social-dashboard nginx-alvo.txt front-antes.txt site-antes.txt; do
  [ -s $V/$f ] && [ "$(stat -c %a $V/$f)" = 600 ] || falta "G/P12 $V/$f ausente, vazio ou fora do 600"
done
ok "G/P12 backups de reversão conferidos em $V (nginx, core, robôs, Cartões, PDV, Chatwoot, front, site)"
for f in core.env:/root/secrets/core.env robos.env:/etc/robos.env cartoes-ean.env:/etc/cartoes-ean.env pdv-backend.env:/root/pdv-backend/.env chatwoot.env:/opt/chatwoot/.env; do
  cmp -s $V/${f%%:*} ${f#*:} || echo "AVISO G/P12 ${f#*:} mudou depois do backup (rodar preparar-vps.sh backups antes da janela, se a mudança for legítima)"
done

# H. P13
[ -x $V/t14-core-go.sh ] && [ -x $V/t16-chatwoot-go.sh ] && ok "H/P13 t14-core-go.sh e t16-chatwoot-go.sh" || falta "H/P13 faltam t14/t16"
python3 $V/gerar-core-env-go.py /root/secrets/core.env /tmp/.core.env.go.pf 2> /dev/null && cmp -s /tmp/.core.env.go.pf $V/core.env.go && ok "H/P13 core.env.go está de acordo com o core.env de agora" || falta "H/P13 core.env.go ausente ou velho (sh $V/t14-core-go.sh --imprimir)"
CI=$(docker run --rm --env-file /tmp/.core.env.go.pf --entrypoint /core core-core-go cli conferir-config 2>&1 | tail -1)
rm -f /tmp/.core.env.go.pf
[ "$CI" = "configuração completa" ] && ok "H/P13 o Core aceita o core.env.go (conferir-config)" || falta "H/P13 conferir-config do core.env.go: $CI"
python3 -I -c "
import json,sys
d={}
for l in open('$V/core.env.go').read().splitlines():
    if '=' in l and not l.startswith('#'):
        k,v=l.split('=',1); d[k]=v
n=[x['nome'] for x in json.loads(d['CORE_SHOPIFY_DESTINOS'].strip(\"'\")) if x['url'].startswith('https://central.rbvcompany.com/api/')]
sys.exit(0 if sorted(n)==['central_pedidos','supabase_abandono','supabase_checkout'] else 1)" && ok "H/P13 destinos do Go no core.env.go: supabase_checkout, supabase_abandono, central_pedidos" || falta "H/P13 destinos do Go no core.env.go"
sh $V/t16-chatwoot-go.sh --imprimir > /tmp/.t16.pf 2>&1 && ok "H/P13 t16 (Chatwoot): $(head -1 /tmp/.t16.pf | cut -c1-120)" || falta "H/P13 t16-chatwoot-go.sh --imprimir falhou: $(head -1 /tmp/.t16.pf)"
rm -f /tmp/.t16.pf

# I. api-db
[ "$(docker inspect -f '{{.State.Health.Status}}' api-db 2> /dev/null)" = healthy ] && ok "I api-db saudável" || falta "I api-db não está healthy"
[ ! -e /root/api-db/PRODUCAO ] && ok "I api-db sem a marca PRODUCAO (o T+1 pode recriar)" || falta "I /root/api-db/PRODUCAO existe: o ensaio e o T+1 recusam"
echo "FIM"
echo "IP_API_DB $(docker inspect -f '{{(index .NetworkSettings.Networks "api_net").IPAddress}}' api-db 2> /dev/null)"
NO_ALVO
# imagem x main (do lado do Mac, que tem o git)
VER=$(sed -n 's/^VERSAO //p' "$SAIDA")
if [ -n "$VER" ] && git -C "$RAIZ" cat-file -e "$VER^{commit}" 2> /dev/null; then
  if git -C "$RAIZ" diff --quiet "$VER" origin/main -- api; then echo "OK C/P8 a imagem $VER tem o mesmo api/ da origin/main" >> "$SAIDA"
  else echo "FALTA C/P8 api/ mudou entre a imagem $VER e a origin/main: refazer o build" >> "$SAIDA"; fi
else echo "FALTA C/P8 não consegui comparar a imagem '$VER' com a origin/main (commit desconhecido)" >> "$SAIDA"; fi
# túnel do Mac até o api-db (LEIA-ME do api-db, "Como o Mac chega")
if [ "${TUNEL:-1}" = 1 ]; then
  IP=$(sed -n 's/^IP_API_DB //p' "$SAIDA")
  S=$(mktemp -u /tmp/pf-tunel.XXXXXX)
  if [ -n "$IP" ] && ssh -o BatchMode=yes -o ExitOnForwardFailure=yes -M -S "$S" -f -N -L 55478:"$IP":5432 "${VPS:-op}" 2> /dev/null; then
    if nc -z -w 5 127.0.0.1 55478 2> /dev/null; then echo "OK I túnel do Mac até o api-db (127.0.0.1:55478 -> $IP:5432)" >> "$SAIDA"; else echo "FALTA I o túnel abriu mas a porta do api-db não responde" >> "$SAIDA"; fi
    ssh -S "$S" -O exit "${VPS:-op}" > /dev/null 2>&1 || true
  else echo "FALTA I não consegui abrir o túnel do Mac até o api-db" >> "$SAIDA"; fi
fi
grep -qx FIM "$SAIDA" || echo "FALTA o ssh caiu antes do fim da conferência na VPS (seções depois da última linha acima não rodaram)" >> "$SAIDA"
[ "$FETCH" = ok ] || echo "FALTA git fetch origin falhou: a comparação da imagem com a main pode estar velha" >> "$SAIDA"
grep -vE '^(VERSAO|IP_API_DB|FIM)( |$)' "$SAIDA"
N=$(grep -c '^FALTA ' "$SAIDA" || true)
D=$(grep '^DONO ' "$SAIDA" | sed 's/^DONO //' | tr '\n' ' ')
[ -n "$D" ] && echo "(passos do dono, não bloqueiam: $D)"
if [ "$N" = 0 ]; then echo "PREFLIGHT VPS OK"; else echo "PREFLIGHT VPS: $N item(ns) faltando"; exit 1; fi
