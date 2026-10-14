#!/bin/sh
# Ensaio COMPLETO da virada no api-db da VPS (banco de ENSAIO: o de produção só nasce no corte), sem tocar a
# produção: o Supabase só é lido (pg_dump e contagens em transação somente leitura, 5 leituras REST medidas);
# nginx, DNS, front, core, crontab e pg_cron ficam como estão (impressão digital da VPS antes x depois).
# Etapas cronometradas: recriar o api-db do zero -> ops/migracao/ensaio.sh pelo túnel (dump, restore, usuários,
# contagens, órfãos, triggers, Storage) -> papel sem superusuário -> host do Storage no banco -> foto do corte e clone (o "Supabase
# congelado") -> imagem, `api migrar` como api_app -> API e worker no ar SEM credenciais e com TODAS as tarefas
# desligadas -> `api worker conferir` -> foto do corte -> 5 rotas medidas (Go x Supabase) -> escritas reais da API -> parar a API
# (1º passo do rollback) -> delta, replay no clone e comparação linha a linha -> limpeza.
# Recusa se /root/api-db/PRODUCAO existir (o corte cria esse arquivo; dali em diante o api-db é produção).
# Uso: [ENSAIO_SEM_STORAGE=1] sh ops/virada/ensaio-vps.sh   (ORIGEM_DATABASE_URL, SUPABASE_URL e SUPABASE_SERVICE_KEY do ambiente ou de
#      ENV_COLETOR, padrão coletor/.env: DATABASE_URL, SUPABASE_URL, SUPABASE_SERVICE_KEY; nada disso é impresso)
# Saída: 0 = tudo conferido; 1 = falhou (relatório em ops/migracao/saida/ensaio-vps-*/relatorio.txt).
set -u
AQUI=$(cd "$(dirname "$0")" && pwd); RAIZ=$(cd "$AQUI/../.." && pwd)
. "$RAIZ/ops/migracao/oculta.sh"
VPS=${VPS:-op}; E=/root/ensaio-api; PT=${PORTA_TUNEL:-55471}
ENV_COLETOR=${ENV_COLETOR:-$RAIZ/coletor/.env}
le() { [ -r "$ENV_COLETOR" ] && sed -n "s/^$1=//p" "$ENV_COLETOR" | head -1; }
ORIGEM_DATABASE_URL=${ORIGEM_DATABASE_URL:-$(le DATABASE_URL)}; SUPABASE_URL=${SUPABASE_URL:-$(le SUPABASE_URL)}
SUPABASE_SERVICE_KEY=${SUPABASE_SERVICE_KEY:-$(le SUPABASE_SERVICE_KEY)}
[ -n "$ORIGEM_DATABASE_URL" ] && [ -n "$SUPABASE_URL" ] && [ -n "$SUPABASE_SERVICE_KEY" ] \
  || { echo "faltam ORIGEM_DATABASE_URL, SUPABASE_URL e SUPABASE_SERVICE_KEY (ou ENV_COLETOR)" >&2; exit 1; }
export ORIGEM_DATABASE_URL SUPABASE_URL SUPABASE_SERVICE_KEY
ORIGEM=$(printf '%s' "$ORIGEM_DATABASE_URL" | sed 's#:6543/#:5432/#')
umask 077
OUT="$RAIZ/ops/migracao/saida/ensaio-vps-$(date +%Y%m%d-%H%M%S)"; mkdir -p "$OUT"
v() { ssh -o BatchMode=yes "$VPS" "$@"; }
DC="docker compose --project-directory $E -f $E/docker-compose.yml"
rel() { printf '%s\n' "$*" | tee -a "$OUT/relatorio.txt"; }
FALHAS=""; TUNEL=""; JANELA=0
# etapa NOME [janela] cmd...: cronometra; "janela" soma no tempo de manutenção; falha aborta (com limpeza)
etapa() {
  _n=$1; shift; _c=0; [ "$1" = janela ] && { _c=1; shift; }
  echo "== $_n" >> "$OUT/etapas.log"; _t0=$(date +%s); _st=0
  "$@" >> "$OUT/etapas.log" 2>&1 || _st=$?
  _d=$(( $(date +%s) - _t0 )); [ $_c = 0 ] || JANELA=$((JANELA + _d))
  if [ $_st = 0 ]; then rel "$(printf '%-44s %5ss  OK' "$_n" "$_d")"; return 0; fi
  rel "$(printf '%-44s %5ss  FALHOU (saída %s)' "$_n" "$_d" "$_st")"; FALHAS="$FALHAS
  - $_n"; tail -15 "$OUT/etapas.log" | oculta >&2; exit 1
}
limpa() {
  s=$?; trap - EXIT INT TERM HUP
  [ -z "$TUNEL" ] || { [ -z "${ALVO:-}" ] || psql "$ALVO" -X -q -c "drop database if exists api_base" > /dev/null 2>&1; kill "$TUNEL" 2> /dev/null; }
  v "[ -d $E ] && { $DC down --remove-orphans > /dev/null 2>&1; docker image rm central-api:ensaio > /dev/null 2>&1; rm -rf $E; }; true"
  rm -rf "$OUT/delta/base" "$OUT/delta/atual" "$OUT/delta/comparar" "$OUT"/delta/*.csv "$OUT"/delta/*.chaves "$OUT"/delta/*.apagar 2> /dev/null
  [ -z "$FALHAS" ] || rel "ENSAIO FALHOU:$FALHAS"
  exit $s
}
trap limpa EXIT; trap 'exit 130' INT TERM HUP

impressao() {
  v 'for d in $(find /root /opt -maxdepth 3 -name .git -type d 2>/dev/null | sort); do r=${d%/.git}
       printf "%s %s %s\n" "$r" "$(git -C "$r" rev-parse --short HEAD 2>/dev/null)" "$(git -C "$r" status --porcelain 2>/dev/null | sha256sum | cut -c1-12)"; done
     printf "nginx %s\ncrontab %s\ncron.d %s\n" "$(cat /etc/nginx/sites-enabled/* | sha256sum | cut -c1-12)" \
       "$(crontab -l | sha256sum | cut -c1-12)" "$(cat /etc/cron.d/* | sha256sum | cut -c1-12)"
     printf "conteineres %s\n" "$(docker ps --format "{{.Names}} {{.Image}}" | grep -v -E "^(api-db|api-ensaio-)" | sort | sha256sum | cut -c1-12)"'
}
guarda() { v 'test ! -e /root/api-db/PRODUCAO' || { echo "/root/api-db/PRODUCAO existe: o api-db é produção; recuso"; return 1; }; }
recriar_db() {
  v "[ -d $E ] && $DC down --remove-orphans; cd /root/api-db && docker compose down -v && docker compose up -d" &&
  v 'for i in $(seq 60); do [ "$(docker inspect -f "{{.State.Health.Status}}" api-db)" = healthy ] && exit 0; sleep 2; done; exit 1'
}
tunel() {
  IP=$(v "docker inspect -f '{{(index .NetworkSettings.Networks \"api_net\").IPAddress}}' api-db") || return 1
  SENHA=$(v "sed -n 's/^POSTGRES_PASSWORD=//p' /root/secrets/api-db.env") || return 1
  ssh -o BatchMode=yes -o ExitOnForwardFailure=yes -N -L "127.0.0.1:$PT:$IP:5432" "$VPS" & TUNEL=$!
  ALVO="postgres://api:$SENHA@127.0.0.1:$PT/api?sslmode=disable"; BASE="postgres://api:$SENHA@127.0.0.1:$PT/api_base?sslmode=disable"
  for i in $(seq 20); do psql "$ALVO" -X -Atqc 'select 1' > /dev/null 2>&1 && return 0; sleep 1; done; echo "túnel não abriu"; return 1
}
ensaio_sh() {
  _r=0; ALVO_DATABASE_URL="$ALVO" ENSAIO_SAIDA="$OUT/ensaio" sh "$RAIZ/ops/migracao/ensaio.sh" --permitir-alvo-remoto ${ENSAIO_SEM_STORAGE:+--sem-storage} || _r=$?
  cp "$OUT"/ensaio/*/relatorio.txt "$OUT/ensaio-relatorio.txt" 2> /dev/null
  # 3 = só contagem divergente: sem congelar o Supabase, tabela quente cresce durante o dump (no corte, congelado, tem de dar 0)
  [ $_r = 3 ] && { echo "CONFIRA: contagem divergente em tabela quente (ver ensaio-relatorio.txt)"; return 0; }; return $_r
}
tabelas() {
  psql "$ORIGEM" -X -q -At -c "begin read only" -c "select tablename from pg_tables where schemaname = 'public' order by 1" -c "commit" \
    > "$OUT/tabelas-supabase.txt" 2> "$OUT/.erro" || { oculta < "$OUT/.erro"; return 1; }
  rm -f "$OUT/.erro"; [ -s "$OUT/tabelas-supabase.txt" ]
}
preparar_vps() {
  v "rm -rf $E && mkdir -p $E/arquivos/fabrica-criativos && chown -R 10001:10001 $E/arquivos && chmod 750 $E/arquivos" &&
  scp -q "$RAIZ/ops/vps/api/docker-compose.yml" "$AQUI/papel-da-api.sql" "$VPS:$E/" &&
  v "cd $E && printf 'API_PROJETO=api-ensaio\nAPI_VERSAO=ensaio\nAPI_ENV=$E/api.env\nWORKER_ENV=$E/worker.env\nARQUIVOS_HOST=$E/arquivos\nAPI_PORTA=18080\n' > .env"
}
imagem() {
  docker buildx build --platform linux/amd64 -t central-api:ensaio --load "$RAIZ/api" &&
  docker save central-api:ensaio | gzip -1 | v 'gunzip | docker load'
}
# api_app com senha nova; a senha não sai da VPS (vai pelo stdin do psql do contêiner)
papel() {
  v "umask 077; openssl rand -hex 24 > $E/app.senha
     { printf '\\\\set senha %s\n' \"\$(cat $E/app.senha)\"; cat $E/papel-da-api.sql; } | docker exec -i api-db sh -c 'psql -X -q -At -v ON_ERROR_STOP=1 -U \"\$POSTGRES_USER\" -d \"\$POSTGRES_DB\" -f -'
     s=\$(cat $E/app.senha); printf 'DATABASE_URL=postgres://api_app:%s@api-db:5432/api?sslmode=disable&connect_timeout=5\n' \"\$s\" > $E/api.env
     cp $E/api.env $E/worker.env; echo 'WORKER_TAREFAS_DESLIGADAS=*' >> $E/worker.env
     openssl rand -hex 24 > $E/shopify.segredo; echo \"SHOPIFY_WEBHOOK_SEGREDOS=\$(cat $E/shopify.segredo)\" >> $E/api.env" > "$OUT/papel.txt" || return 1
  cat "$OUT/papel.txt"; grep -q '^sobrou_de_outro_dono|0$' "$OUT/papel.txt" && grep -q '^api_app|f|f|f|f|f$' "$OUT/papel.txt"
}
# o script do Plano 6 (coletor/), na VPS, com o `pg` dos robôs: relatório, depois --aplicar (backup em bkp_urls_*)
trocar_host() {
  v "mkdir -p $E/trocar && ln -sfn /opt/robos/social-dashboard/coletor/node_modules $E/trocar/node_modules" &&
  scp -q "$RAIZ/coletor/trocar-host-das-urls-de-storage.mjs" "$VPS:$E/trocar/" &&
  v "cd $E/trocar && IP=\$(docker inspect -f '{{(index .NetworkSettings.Networks \"api_net\").IPAddress}}' api-db) &&
     S=\$(sed -n 's/^POSTGRES_PASSWORD=//p' /root/secrets/api-db.env) &&
     DATABASE_URL=\"postgres://api:\$S@\$IP:5432/api\" node trocar-host-das-urls-de-storage.mjs --host-novo https://central.rbvcompany.com --aplicar" \
    | tee "$OUT/storage-host.txt"
  grep -q 'sobraram 0 coluna' "$OUT/storage-host.txt"   # o tee esconde a saída do node: confere pelo texto
}
# o corte guarda um clone do banco recém-restaurado (segundos, na janela): é a base do delta se for preciso voltar
clone() { for i in 1 2 3 4 5; do psql "$ALVO" -X -q -c "create database api_base template api" && return 0; sleep 3; done; return 1; }
foto() { sh "$AQUI/delta.sh" base "$BASE" "$OUT/delta" "$OUT/tabelas-supabase.txt"; }
subir() {
  v "$DC up -d --no-build --pull never && for i in \$(seq 50); do a=\$(docker inspect -f '{{.State.Health.Status}}' api-ensaio-api-1); w=\$(docker inspect -f '{{.State.Health.Status}}' api-ensaio-worker-1)
       [ \"\$a\" = healthy ] && [ \"\$w\" = healthy ] && exit 0; sleep 3; done; docker logs --tail 20 api-ensaio-worker-1; exit 1"
}
listar() {
  v "$DC exec -T worker api worker listar" > "$OUT/worker-listar.txt" || return 1
  echo "tarefas: $(grep -c . "$OUT/worker-listar.txt"), desligadas: $(grep -c DESLIGADA "$OUT/worker-listar.txt")"
  [ "$(grep -c DESLIGADA "$OUT/worker-listar.txt")" -ge 15 ]
}
# robô novo (profiles), um webhook de checkout assinado como o do Core (carrinho_eventos: identity "generated always")
# e duas tarefas seguras do worker (robos_execucoes): o delta tem de levar tudo isso de volta
robo() { v "umask 077; $DC exec -T api api servico criar ensaio-medida ensaio-medida@robos.invalid --modulos meta > $E/token 2> /dev/null && test -s $E/token"; }
escritas_reais() {
  v "cd $E && c='{\"cart_token\":\"ensaio-virada-'\$(date +%s)'\"}'; h=\$(printf '%s' \"\$c\" | openssl dgst -sha256 -hmac \"\$(cat shopify.segredo)\" -binary | base64)
     r=\$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' -H \"X-Shopify-Hmac-Sha256: \$h\" \
          -H 'X-Shopify-Topic: checkouts/create' -H \"X-Shopify-Event-Id: ensaio-\$(date +%s%N)\" --data \"\$c\" http://127.0.0.1:18080/receber-webhook-checkout)
     echo \"webhook de checkout assinado: HTTP \$r\"; [ \"\$r\" = 200 ]" &&
  v "$DC exec -T worker api worker rodar conferir-robos --forcar && $DC exec -T worker api worker rodar faxina-da-api --forcar"
}
medir() {
  printf 'header = "apikey: %s"\nheader = "Authorization: Bearer %s"\n' "$SUPABASE_SERVICE_KEY" "$SUPABASE_SERVICE_KEY" | v "umask 077; cat > $E/sb.curl" &&
  v "umask 077; SB='$SUPABASE_URL/rest/v1'; GO=http://127.0.0.1:18080; cd $E
     printf 'header = \"Authorization: Bearer %s\"\n' \"\$(cat token)\" > go.curl
     m() { for i in \$(seq 20); do curl -s -K \"\$3\" -o resp -w '%{http_code} %{time_total}\n' --max-time 30 \"\$2\"; done > t.txt
           l=\$(python3 -c 'import json,sys; print(len(json.load(open(sys.argv[1]))))' resp 2> /dev/null || echo '?'); e=\$(awk '\$1 != 200' t.txt | wc -l)
           sort -n -k2 t.txt | awk -v n=\"\$1\" -v l=\"\$l\" -v e=\"\$e\" '{ t[NR] = \$2 } END { printf \"%-34s p50 %5.0f ms  p95 %5.0f ms  max %5.0f ms  erros %d/%d  linhas %s\n\", n, t[int(NR*0.5+0.5)]*1000, t[int(NR*0.95+0.5)]*1000, t[NR]*1000, e, NR, l }'; }
     m 'go  GET /redes/contas' \"\$GO/redes/contas\" go.curl;                     m 'sb  accounts (id,name)' \"\$SB/accounts?select=id,name&limit=1000\" sb.curl
     m 'go  GET /redes/seguidores' \"\$GO/redes/seguidores\" go.curl;             m 'sb  daily_snapshots' \"\$SB/daily_snapshots?select=*&limit=1000\" sb.curl
     m 'go  GET /redes/engajamento' \"\$GO/redes/engajamento\" go.curl;           m 'sb  engagement_snapshots' \"\$SB/engagement_snapshots?select=*&limit=1000\" sb.curl
     m 'go  GET /redes/campanhas' \"\$GO/redes/campanhas\" go.curl;               m 'sb  campaigns' \"\$SB/campaigns?select=*&limit=1000\" sb.curl
     m 'go  GET /redes/insights-de-campanha' \"\$GO/redes/insights-de-campanha\" go.curl; m 'sb  campaign_insights' \"\$SB/campaign_insights?select=*&limit=1000\" sb.curl
     rm -f sb.curl go.curl resp t.txt" > "$OUT/medidas.txt" || return 1
  cat "$OUT/medidas.txt"; ! grep -E '^go .* erros [1-9]' "$OUT/medidas.txt"   # erro no Go reprova (no Supabase só registra)
}
parar() { v "$DC stop"; }
delta_replay() {
  sh "$AQUI/delta.sh" exportar "$ALVO" "$OUT/delta" &&
  psql "$BASE" -X -q -v ON_ERROR_STOP=1 -f "$OUT/delta/replay.sql" &&
  sh "$AQUI/delta.sh" comparar "$BASE" "$OUT/delta"
}

rel "ensaio da virada no api-db ($(date '+%F %T')); commit $(git -C "$RAIZ" rev-parse --short HEAD)"
etapa "0. o api-db não é produção" guarda
impressao > "$OUT/vps-antes.txt" || exit 1
etapa "1. imagem amd64 (Mac) e carga na VPS" imagem
etapa "2. recriar o api-db do zero" recriar_db
etapa "3. túnel até o api-db" tunel
etapa "4. tabelas do Supabase (só leitura)" tabelas
etapa "5. ensaio.sh: dump/restore/usuários/conferências" ensaio_sh
etapa "6. preparar a pasta do ensaio na VPS" preparar_vps
etapa "7. papel api_app (sem superusuário)" janela papel
etapa "7b. trocar o host do Storage no banco" janela trocar_host
etapa "8. clone do corte (api_base)" janela clone
etapa "9. api migrar (como api_app)" janela v "$DC run --rm --pull never api migrar"
etapa "10. API e worker no ar (healthy)" janela subir
etapa "11. api worker conferir" janela v "$DC exec -T worker api worker conferir"
etapa "11b. foto do corte (do clone, fora da janela)" foto
etapa "12. todas as tarefas DESLIGADAS" listar
etapa "12b. robô de serviço (token da medida)" robo
etapa "13. 5 rotas: Go x Supabase (20 cada)" medir
etapa "14. escritas reais (robô, webhook, worker)" escritas_reais
etapa "15. rollback: parar API e worker" parar
etapa "16. delta, replay no clone, comparação" delta_replay
impressao > "$OUT/vps-depois.txt"
rel "----"
grep -E 'JANELA|volume|DIFERE|órfãos|triggers' "$OUT/ensaio-relatorio.txt" 2> /dev/null | sed 's/^/ensaio.sh: /' | tee -a "$OUT/relatorio.txt"
rel "janela = JANELA SEM Storage do ensaio.sh (acima) + etapas 7 a 11 (${JANELA}s); o Storage incremental corre em paralelo"
rel "$(grep -c . "$OUT/tabelas-supabase.txt") tabelas no Supabase; $(cat "$OUT/delta/resumo.tsv" 2> /dev/null | wc -l | tr -d ' ') com mudança depois da foto (tabela, novas, alteradas, apagadas):"
sed 's/^/  /' "$OUT/delta/resumo.tsv" | tee -a "$OUT/relatorio.txt"
rel "medidas (servidor a servidor, da VPS):"; sed 's/^/  /' "$OUT/medidas.txt" | tee -a "$OUT/relatorio.txt"
if diff "$OUT/vps-antes.txt" "$OUT/vps-depois.txt" > "$OUT/vps.diff"; then rel "VPS: repositórios, nginx, crontab, cron.d e contêineres de produção INALTERADOS"
else rel "VPS: impressão digital MUDOU (ver vps.diff; conferir se foi outra sessão):"; cat "$OUT/vps.diff" | tee -a "$OUT/relatorio.txt"; fi
rel "ENSAIO DA VIRADA OK (relatório: $OUT/relatorio.txt)"
