#!/bin/sh
# Prepara a VPS para a janela (plano 08, VIRADA-2026-10). Aditivo e idempotente: NÃO liga nada, NÃO recarrega o
# nginx de produção, NÃO mexe em webhook. Roda do Mac, na raiz do repositório, na ordem:
#   arquivos   copia os scripts do T+10/T+14/T+16 e os 3 arquivos de nginx para /root/virada
#   backups    P12: o que a reversão precisa (nginx, core.env, robos.env, cartoes-ean.env, PDV, Chatwoot, front, site)
#   segredos   api.env/worker.env: o que dá para derivar (Z-API, segredos de webhook, chaves admin, hosts); só nomes na saída
#   core       core.env.go (T+14) a partir do core.env de agora; diff só de nomes e esquema://host
#   nginx      cópia do nginx + ensaio do t10-nginx.sh nela (`nginx -t -c`); o de produção não é tocado
# Uso: sh ops/virada/preparar-vps.sh [arquivos|backups|segredos|core|nginx|tudo]   (padrão: tudo)
#   ENV_COLETOR (padrão coletor/.env): DATABASE_URL do Supabase, só para ler segredos_de_cron em transação read only.
set -eu
RAIZ=$(cd "$(dirname "$0")/../.." && pwd)
NA_VPS=${NA_VPS:-ssh -o BatchMode=yes ${VPS:-op}}
V=/root/virada
ENV_COLETOR=${ENV_COLETOR:-$RAIZ/coletor/.env}
PSQL=${PSQL:-/opt/homebrew/opt/postgresql@17/bin/psql}

arquivos() {
  $NA_VPS "mkdir -p $V && chmod 700 $V"
  tar --no-xattrs -cf - -C "$RAIZ/ops/virada/vps" gerar-core-env-go.py t10-nginx.sh t14-core-go.sh t16-chatwoot-go.sh \
    -C "$RAIZ/ops/virada" core-destinos.sh spool-nginx.sh | $NA_VPS "tar -xf - -C $V --no-same-owner"
  tar --no-xattrs -cf - -C "$RAIZ/ops/vps/api" nginx-central-api.conf nginx-semquery.conf -C "$RAIZ/deploy/nginx" api-arquivos-e-storage.conf \
    | $NA_VPS "tar -xf - -C $V --no-same-owner"
  $NA_VPS "chmod 700 $V/*.sh $V/*.py; chmod 600 $V/*.conf; ls $V | tr '\n' ' '"; echo
}

backups() {
  $NA_VPS sh -s << 'NO_ALVO'
set -eu
V=/root/virada; umask 077
cp -aL /etc/nginx/sites-enabled/central.rbvcompany.com /root/secrets/core.env /etc/robos.env /etc/cartoes-ean.env "$V/"
cp -aL /root/pdv-backend/.env "$V/pdv-backend.env"
# ATENÇÃO: o roteiro (P12) procurava o env do Chatwoot em /root/chatwoot (só tem o .env.example); o que o compose lê é /opt/chatwoot/.env
cp -aL /opt/chatwoot/.env "$V/chatwoot.env"
cp -aL /etc/cron.d/robos-social-dashboard "$V/"
readlink -f /etc/nginx/sites-enabled/central.rbvcompany.com > "$V/nginx-alvo.txt"
readlink -f /var/www/central/atual > "$V/front-antes.txt"
readlink -f /var/www/vesselbrasil/atual > "$V/site-antes.txt"
cat /opt/chatwoot/.image_tag > "$V/chatwoot-image-tag.txt"
chmod 600 "$V"/*.env "$V/central.rbvcompany.com" "$V/robos-social-dashboard" "$V"/*.txt
echo "backups em $V: $(ls "$V" | grep -E '^(central.rbvcompany.com|core.env|robos.env|cartoes-ean.env|pdv-backend.env|chatwoot.env|robos-social-dashboard|nginx-alvo.txt|front-antes.txt|site-antes.txt)$' | tr '\n' ' ')"
NO_ALVO
}

segredos() {
  [ -r "$ENV_COLETOR" ] || { echo "sem $ENV_COLETOR (ENV_COLETOR)" >&2; exit 1; }
  U=$(sed -n 's/^DATABASE_URL=//p' "$ENV_COLETOR" | head -1 | sed 's#:6543/#:5432/#' | tr -d "\"'")
  # só as 2 chaves admin da tabela segredos_de_cron (read only); os valores vão direto para o stdin da VPS
  { echo 'begin read only;'
    echo "select upper(nome) || '=' || segredo from segredos_de_cron where nome in ('anthropic_admin_key', 'openai_admin_key') order by nome;"
    echo 'rollback;'; } | "$PSQL" "$U" -X -At -q 2> /dev/null | grep -E '^(ANTHROPIC|OPENAI)_ADMIN_KEY=.' | $NA_VPS sh -c 'cat > /root/virada/.admin-keys.tmp; chmod 600 /root/virada/.admin-keys.tmp'
  $NA_VPS sh -s << 'NO_ALVO'
set -eu
V=/root/virada; umask 077
B=/root/backups/virada; TS=$(date +%Y%m%d-%H%M%S)
for f in api.env worker.env; do cp -p /root/secrets/$f "$B/$f-plano08-$TS"; done
poe() { f=/root/secrets/$1; { grep -v "^$2=" "$f" || true; printf '%s=%s\n' "$2" "$3"; } > "$f.novo"; cat "$f.novo" > "$f"; rm -f "$f.novo"; }
pega() { sed -n "s/^$2=//p" "$1" | head -1 | tr -d "\"'"; }
# Z-API: os mesmos 3 valores que os robôs da VPS usam (api: relatório da hora; worker: enviar-relatorio-hora)
for k in ZAPI_INSTANCE_ID ZAPI_INSTANCE_TOKEN ZAPI_TOKEN; do
  v=$(pega /etc/robos.env $k); [ -n "$v" ] || { echo "FALTA $k em /etc/robos.env" >&2; continue; }
  poe api.env $k "$v"; poe worker.env $k "$v"
done
# Chatwoot: o ?token= que o Chatwoot manda hoje à edge é o que a API Go confere
t=$(sed -n 's/^CRM_EVENT_WEBHOOK_URL=.*?token=//p' /opt/chatwoot/.env | head -1)
[ -n "$t" ] && poe api.env CHATWOOT_WEBHOOK_SEGREDO "$t" || echo "FALTA o ?token= do Chatwoot" >&2
# Shopify: admin/app (core.env) + segredo de cada destino que o Core entrega ao Go (o do destino novo nasce aqui)
[ -s $V/segredo-central-pedidos ] || openssl rand -hex 32 > $V/segredo-central-pedidos
SEGS=$(python3 -I - /root/secrets/core.env $V/segredo-central-pedidos << 'PY'
import json, sys
d = {}
for l in open(sys.argv[1]).read().splitlines():
    if "=" in l and not l.startswith("#"):
        k, v = l.split("=", 1); d[k] = v
l = [x.strip().strip("'\"") for x in d.get("SHOPIFY_WEBHOOK_SECRETS", "").split(",") if x.strip()]
for x in json.loads(d["CORE_SHOPIFY_DESTINOS"].strip("'")):
    if x["nome"] in ("supabase_checkout", "supabase_abandono"):
        l.append(x["segredo"])
l.append(open(sys.argv[2]).read().strip())
print(",".join(dict.fromkeys(l)))
PY
)
poe api.env SHOPIFY_WEBHOOK_SEGREDOS "$SEGS"
# hosts: o Storage novo mora na central (o meta-proxy só baixa imagem desses hosts; o Core recebe o mesmo em META_HOSTS_MIDIA)
poe api.env HOSTS_DE_MIDIA central.rbvcompany.com
# chaves admin de custo (segredos_de_cron)
[ -s $V/.admin-keys.tmp ] && while IFS='=' read -r k v; do poe api.env "$k" "$v"; done < $V/.admin-keys.tmp
rm -f $V/.admin-keys.tmp
chmod 600 /root/secrets/api.env /root/secrets/worker.env
for f in api.env worker.env; do echo "$f: $(grep -o '^[A-Z_0-9]*=' /root/secrets/$f | tr -d = | sort | tr '\n' ' ')"; done
echo "backup dos envs: $B/{api,worker}.env-plano08-$TS"
NO_ALVO
}

core() { $NA_VPS "sh $V/t14-core-go.sh --imprimir"; }

nginx() {
  $NA_VPS sh -s << 'NO_ALVO'
set -eu
V=/root/virada
rm -rf $V/nginx-teste && cp -aL /etc/nginx $V/nginx-teste
grep -rlZ '/etc/nginx/' $V/nginx-teste | xargs -0 sed -i "s#/etc/nginx/#$V/nginx-teste/#g"
nginx -t -c $V/nginx-teste/nginx.conf 2>&1 | tail -2
TESTE=1 NGINX_DIR=$V/nginx-teste sh $V/t10-nginx.sh
# idempotente: a 2ª passada na cópia não muda nada
TESTE=1 NGINX_DIR=$V/nginx-teste sh $V/t10-nginx.sh | tail -1
NO_ALVO
}

case ${1:-tudo} in
  arquivos) arquivos ;; backups) backups ;; segredos) segredos ;; core) core ;; nginx) nginx ;;
  tudo) arquivos; backups; segredos; core; nginx ;;
  *) sed -n '2,13p' "$0" >&2; exit 2 ;;
esac
