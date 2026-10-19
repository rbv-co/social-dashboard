#!/bin/bash
# Lado da VPS dos passos de banco/API da janela (plano 11): T+1 a T+9, o nginx do rollback B e as conferências V7 a V9.
# NÃO roda sozinho: o `ops/virada/janela.sh` (Mac) o manda por ssh, uma função por vez:
#   ssh op bash -s -- <função> [args] < ops/virada/janela/vps-b1.sh
# Roda como root na VPS. Nunca imprime senha nem token (senha só por stdin do psql ou arquivo 600; a saída ainda passa por
# `oculta` no Mac). Cada função devolve 0 (ok) ou 1 e diz o porquê; nada aqui é chamado fora da janela.
# Funções: recriar | papeis | clone | hosts | storage | subir | conferir | fumaca | parar | nginx-reverter |
#          modo-chatwoot | host-chatwoot | v4 | v7 <local|publico> | v8 | v9 | revogar-fumaca
set -u
S=/root/secrets; V=/root/virada; API=/root/api; ADB=/root/api-db
AR=/var/lib/api/arquivos; CENTRAL=central.rbvcompany.com
falha() { echo "FALHOU: $*"; return 1; }
saudavel() { # saudavel <contêiner> <segundos>
  for _ in $(seq 1 $(( $2 / 2 ))); do
    [ "$(docker inspect -f '{{.State.Health.Status}}' "$1" 2> /dev/null)" = healthy ] && return 0
    sleep 2
  done
  return 1
}
psql_api() { docker exec -i api-db psql -U api -d "${BANCO:-api}" -XAtq -v ON_ERROR_STOP=1 "$@"; }

# T+1: o api-db de ensaio some e nasce vazio (volume novo). Recusa se já for produção.
recriar() {
  [ ! -e "$ADB/PRODUCAO" ] || falha "$ADB/PRODUCAO existe: o api-db é produção; recuso" || return 1
  ( cd "$ADB" && docker compose down -v && docker compose up -d ) || falha "docker compose do api-db" || return 1
  saudavel api-db 120 || falha "api-db não ficou healthy em 2 min" || return 1
  echo "api-db recriado: healthy e vazio"
}

# T+7: papéis, na ordem do roteiro. Os SQL já vêm da main (o Mac sincroniza e confere o sha256 antes).
papeis() {
  [ ! -e "$ADB/PRODUCAO" ] || falha "$ADB/PRODUCAO existe: papéis já aplicados? (o T+7 clone cria a marca DEPOIS)" || return 1
  aplica() { # aplica <arquivo.sql> <VAR> <arquivo-da-senha>
    [ -s "$S/$3" ] || falha "falta $S/$3" || return 1
    ( export "$2=$(cat "$S/$3")"; docker exec -i -e "$2" api-db psql -U api -d api -Xq -v ON_ERROR_STOP=1 < "$ADB/$1" > /dev/null 2> "$V/papeis.err" ) \
      || { sed -E 's/[0-9a-f]{40,}/<oculto>/g' "$V/papeis.err" | tail -n 5; falha "$1"; return 1; }
    echo "ok $1"
  }
  aplica papel-copia.sql SENHA_COPIA copia.senha || return 1
  [ -s "$S/api-app.senha" ] && [ -s "$V/papel-da-api.sql" ] || falha "falta api-app.senha ou $V/papel-da-api.sql" || return 1
  { printf '\\set senha %s\n' "$(cat "$S/api-app.senha")"; cat "$V/papel-da-api.sql"; } \
    | docker exec -i api-db psql -U api -d api -XAtq -v ON_ERROR_STOP=1 -f - > "$V/papel-da-api.out" 2> "$V/papeis.err" \
    || { sed -E 's/[0-9a-f]{40,}/<oculto>/g' "$V/papeis.err" | tail -n 5; falha "papel-da-api.sql"; return 1; }
  grep -q '^sobrou_de_outro_dono|0$' "$V/papel-da-api.out" && grep -q '^api_app|f|f|f|f|f$' "$V/papel-da-api.out" \
    || { cat "$V/papel-da-api.out"; falha "api_app: esperava sobrou_de_outro_dono|0 e api_app|f|f|f|f|f"; return 1; }
  echo "ok papel-da-api.sql (sobrou_de_outro_dono|0; api_app|f|f|f|f|f)"
  aplica papel-conteudo.sql SENHA_CONTEUDO conteudo.senha || return 1
  aplica papel-pdv.sql SENHA_PDV pdv.senha || return 1
  for r in reporte selo pedidos-vessel shopify metaads-zoho vigia-meta notas relatorios cards gestor interesses opr budget noticias faxina cartoes; do
    [ -e "$S/robo-$r.senha" ] || ( umask 077; openssl rand -hex 24 > "$S/robo-$r.senha" )
    aplica "papel-robo-$r.sql" "SENHA_ROBO_$(echo "$r" | tr 'a-z-' 'A-Z_')" "robo-$r.senha" || return 1
  done
  n=$(psql_api -c "select count(*) from pg_roles where rolname ~ '^(robo_|copia\$|conteudo_robo\$|pdv_leitura\$|api_app\$)'") || return 1
  [ "$n" -ge 20 ] || falha "só $n papéis (esperava 20: 16 robo_*, copia, conteudo_robo, pdv_leitura, api_app)" || return 1
  echo "papéis aplicados: $n (16 robôs + copia + conteudo_robo + pdv_leitura + api_app)"
}

# T+7: clone do corte (base do delta) e dump; depois disso o api-db é produção (o ensaio e o T+1 passam a recusar)
clone() {
  ok=0
  for _ in 1 2 3 4 5 6; do
    docker exec api-db psql -U api -d postgres -Xq -c "create database api_corte template api" 2> /dev/null && { ok=1; break; }
    sleep 3
  done
  [ $ok = 1 ] || falha "create database api_corte template api (alguém conectado em api? \`api_corte\` já existe?)" || return 1
  mkdir -p /root/backups-api
  f=/root/backups-api/corte-$(date +%Y%m%d-%H%M).dump
  ( umask 077; docker exec api-db pg_dump -U api -Fc api_corte > "$f" ) && [ -s "$f" ] || falha "pg_dump do api_corte" || return 1
  touch "$ADB/PRODUCAO"
  echo "clone api_corte criado; dump $f ($(du -h "$f" | cut -f1)); $ADB/PRODUCAO marcado"
}

# T+8: host do Storage no banco (relatório e depois --aplicar). O script vem do Mac (scp) para /root/virada/trocar.
hosts() {
  d=$V/trocar
  [ -s "$d/trocar-host-das-urls-de-storage.mjs" ] || falha "falta $d/trocar-host-das-urls-de-storage.mjs" || return 1
  ln -sfn /opt/robos/social-dashboard/coletor/node_modules "$d/node_modules"
  ip=$(docker inspect -f '{{(index .NetworkSettings.Networks "api_net").IPAddress}}' api-db) || return 1
  export DATABASE_URL="postgres://api:$(sed -n 's/^POSTGRES_PASSWORD=//p' "$S/api-db.env")@$ip:5432/api"
  ( cd "$d" && node trocar-host-das-urls-de-storage.mjs --host-novo "https://$CENTRAL" ) || falha "relatório do trocar-host" || return 1
  ( cd "$d" && node trocar-host-das-urls-de-storage.mjs --host-novo "https://$CENTRAL" --aplicar ) > "$d/aplicar.out" 2>&1; rc=$?
  cat "$d/aplicar.out"
  [ $rc = 0 ] && grep -q 'sobraram 0 coluna' "$d/aplicar.out" || falha "trocar-host --aplicar (rc $rc; esperava 'sobraram 0 coluna')" || return 1
}

# T+8: Storage incremental (o que mudou desde o P11), dono 10001 para a API ler
storage() {
  u=$(sed -nE 's/^(export[[:space:]]+)?SUPABASE_URL=//p' /etc/robos.env | head -1 | tr -d "'\"")
  k=$(sed -nE 's/^(export[[:space:]]+)?SUPABASE_SERVICE_KEY=//p' /etc/robos.env | head -1 | tr -d "'\"")
  [ -n "$u" ] && [ -n "$k" ] || falha "SUPABASE_URL/SUPABASE_SERVICE_KEY ausentes em /etc/robos.env" || return 1
  ( cd /opt/robos/social-dashboard/coletor && SUPABASE_URL="$u" SUPABASE_SERVICE_KEY="$k" node copiar-storage-para-disco.mjs "$AR" ) || falha "copiar-storage-para-disco" || return 1
  chown -R 10001:10001 "$AR" || return 1
  while IFS=, read -r b n t; do
    nd=$(find "$AR/$b" -type f 2> /dev/null | wc -l)
    [ "$nd" -ge "$n" ] && echo "ok bucket $b: $nd objetos (csv $n)" || { echo "FALTA bucket $b: $nd objetos (csv $n)"; return 1; }
  done < "$V/10-buckets.csv"
}

# T+8: migrar (como api_app) e subir API e worker (worker.env com WORKER_TAREFAS_DESLIGADAS=*)
subir() {
  cd "$API" || return 1
  grep -qx 'WORKER_TAREFAS_DESLIGADAS=\*' "$S/worker.env" || falha "worker.env sem WORKER_TAREFAS_DESLIGADAS=*" || return 1
  docker compose run --rm --pull never api migrar || falha "api migrar" || return 1
  docker compose up -d --no-build --pull never || falha "docker compose up" || return 1
  for c in api worker; do
    id=$(docker compose ps -q "$c") && [ -n "$id" ] || falha "contêiner $c não existe" || return 1
    saudavel "$id" 150 || { docker compose logs --since 3m "$c" 2>&1 | tail -n 15 | cut -c1-200; falha "$c não ficou healthy em 2,5 min"; return 1; }
  done
  echo "api e worker healthy"
}

# T+9: o esquema que o código presume
conferir() { cd "$API" && docker compose exec -T worker api worker conferir; rc=$?; echo "saída $rc"; return $rc; }

# T+9: fumaça na VPS, sem nginx (127.0.0.1:8080): saúde, usuário de serviço, 5 rotas e um objeto do Storage
fumaca() {
  cd "$API" || return 1
  [ "$(curl -s --max-time 5 127.0.0.1:8080/saude)" = ok ] || falha "127.0.0.1:8080/saude não deu ok" || return 1
  docker compose exec -T api api servico revogar virada-fumaca > /dev/null 2>&1 || true   # idempotência: repetir cria de novo
  ( umask 077; docker compose exec -T api api servico criar virada-fumaca virada-fumaca@robos.invalid --modulos meta > "$V/fumaca.token" 2> /dev/null )
  [ -s "$V/fumaca.token" ] || falha "api servico criar virada-fumaca" || return 1
  ( umask 077; printf 'header = "Authorization: Bearer %s"\n' "$(tail -n 1 "$V/fumaca.token")" > "$V/fumaca.curl" )
  for r in /redes/contas /redes/seguidores /redes/engajamento /redes/campanhas /redes/insights-de-campanha; do
    c=$(curl -s -K "$V/fumaca.curl" --max-time 30 -o "$V/fumaca.resp" -w '%{http_code}' "127.0.0.1:8080$r")
    l=$(python3 -c 'import json,sys; print(len(json.load(open(sys.argv[1]))))' "$V/fumaca.resp" 2> /dev/null || echo 0)
    echo "rota $r HTTP $c linhas $l"
    [ "$c" = 200 ] && [ "$l" -gt 0 ] || { rm -f "$V/fumaca.resp" "$V/fumaca.curl"; falha "rota $r (HTTP $c, $l linhas)"; return 1; }
  done
  rm -f "$V/fumaca.resp" "$V/fumaca.curl"
  obj=
  for b in publico profile-pics acessos-avatars; do
    f=$(find "$AR/$b" -type f 2> /dev/null | head -n 1)
    [ -n "$f" ] && { obj="$b/${f#"$AR/$b/"}"; break; }
  done
  [ -n "$obj" ] || falha "nenhum objeto no disco para a fumaça do Storage" || return 1
  c=$(curl -s -o /dev/null --max-time 20 -w '%{http_code}' "127.0.0.1:8080/storage/v1/object/public/$obj")
  [ "$c" = 200 ] || falha "objeto $obj: HTTP $c" || return 1
  echo "$obj" > "$V/objeto-fumaca.txt"
  echo "objeto $obj HTTP 200; fumaça OK (token em $V/fumaca.token, revogado no fim da janela)"
}

revogar-fumaca() {
  cd "$API" && docker compose exec -T api api servico revogar virada-fumaca > /dev/null 2>&1
  rm -f "$V/fumaca.token" "$V/fumaca.curl"; echo "virada-fumaca revogado; token apagado"
}

parar() { cd "$API" && docker compose stop && echo "api e worker parados"; }

# modo das 2 rotas do Chatwoot no nginx: edge | spool | go | nenhum (mesma lógica do t10-nginx.sh)
modo-chatwoot() {
  CH=/etc/nginx/snippets/central-chatwoot.conf
  if [ ! -e "$CH" ]; then echo nenhum; elif grep -q '127.0.0.1:8099' "$CH"; then echo spool; elif grep -q '127.0.0.1:8080' "$CH"; then echo go; else echo edge; fi
}
host-chatwoot() { grep -E '^CRM_EVENT_WEBHOOK_URL=' /opt/chatwoot/.env | sed -E 's#^[^=]*=##; s#(://[^/?]+).*#\1#'; }

# rollback B1: o nginx volta ao que era ANTES do T+10 (o backup que o t10-nginx.sh tira); só então o front
nginx-reverter() {
  BK=$V/nginx; N=/etc/nginx
  SITE=$N/sites-enabled/central.rbvcompany.com
  if [ "$(grep -c 'central-api.conf' "$SITE")" = 0 ]; then echo "nginx já sem o Go (o t10-nginx.sh voltou sozinho ou nunca rodou): nada a voltar"; return 0; fi
  ts=$(cat "$V/nginx-ts-t10.txt" 2> /dev/null)
  [ -n "$ts" ] && [ -s "$BK/site.$ts" ] || falha "sem $V/nginx-ts-t10.txt ou $BK/site.<hora> (o t+10-nginx não rodou?)" || return 1
  if grep -q 'nginx-teste' "$BK/site.$ts"; then falha "o backup $ts é de uma cópia de teste: recuso"; return 1; fi
  cat "$BK/site.$ts" > "$SITE" || return 1
  for s in central-api.conf api-arquivos-e-storage.conf central-chatwoot.conf; do
    if [ -e "$BK/$s.$ts" ]; then cp -p "$BK/$s.$ts" "$N/snippets/$s"; else rm -f "$N/snippets/$s"; fi
  done
  if [ -e "$BK/semquery.conf.$ts" ]; then cp -p "$BK/semquery.conf.$ts" "$N/conf.d/semquery.conf"; else rm -f "$N/conf.d/semquery.conf"; fi
  nginx -t 2>&1 | tail -n 2 || return 1
  nginx -t > /dev/null 2>&1 && nginx -s reload || falha "nginx -t falhou depois de voltar o backup $ts" || return 1
  [ "$(grep -c 'central-api.conf' "$SITE")" = 0 ] && ! grep -q 'nginx-teste' "$SITE" || falha "o site ainda inclui o Go depois de voltar o backup" || return 1
  echo "nginx de volta ao de antes do T+10 (backup $ts)"
}

# V7: 5 rotas x 20, mais um objeto do Storage. `local` = 127.0.0.1:8080 (T+10, antes do nginx); `publico` = a URL da central
# (depois do nginx). Limite por rota = 2x o p95 do Supabase no ensaio de 14/10 (242, 189, 193, 109, 149 ms), teto 1500 ms.
v7() {
  base=${1:-local}
  [ -s "$V/fumaca.token" ] || falha "sem $V/fumaca.token (rode a fumaça do T+9)" || return 1
  ( umask 077; printf 'header = "Authorization: Bearer %s"\n' "$(tail -n 1 "$V/fumaca.token")" > "$V/v7.curl" )
  if [ "$base" = publico ]; then U="https://$CENTRAL/api"; R="--resolve $CENTRAL:443:127.0.0.1"; O="https://$CENTRAL"
  else U=127.0.0.1:8080; R=; O=127.0.0.1:8080; fi
  rc=0
  for rl in /redes/contas:484 /redes/seguidores:378 /redes/engajamento:386 /redes/campanhas:218 /redes/insights-de-campanha:298; do
    r=${rl%:*}; lim=${rl#*:}
    : > "$V/v7.t"
    for _ in $(seq 1 20); do
      # shellcheck disable=SC2086
      curl -sk -K "$V/v7.curl" $R --max-time 30 -o /dev/null -w '%{http_code} %{time_total}\n' "$U$r" >> "$V/v7.t"
    done
    e=$(awk '$1 != 200' "$V/v7.t" | wc -l)
    p95=$(sort -n -k2 "$V/v7.t" | awk '{ t[NR] = $2 } END { printf "%d", t[int(NR*0.95+0.5)]*1000 }')
    p50=$(sort -n -k2 "$V/v7.t" | awk '{ t[NR] = $2 } END { printf "%d", t[int(NR*0.5+0.5)]*1000 }')
    estado=ok; { [ "$e" = 0 ] && [ "$p95" -le "$lim" ] && [ "$p95" -le 1500 ]; } || { estado=FALHOU; rc=1; }
    echo "rota $r p50 ${p50} ms p95 ${p95} ms (limite ${lim} ms) erros $e/20 $estado"
  done
  rm -f "$V/v7.curl" "$V/v7.t"
  obj=$(cat "$V/objeto-fumaca.txt" 2> /dev/null)
  if [ -n "$obj" ]; then
    # shellcheck disable=SC2086
    c=$(curl -sk $R --max-time 20 -o /dev/null -w '%{http_code}' "$O/storage/v1/object/public/$obj")
    echo "objeto $obj HTTP $c"; [ "$c" = 200 ] || rc=1
  else echo "sem $V/objeto-fumaca.txt"; rc=1; fi
  return $rc
}

# V4: o alvo não tem policy nem RLS (a autorização é do Go)
v4() {
  p=$(psql_api -c "select count(*) from pg_policies where schemaname = 'public'") || return 1
  r=$(psql_api -c "select count(*) from pg_class where relnamespace = 'public'::regnamespace and relrowsecurity") || return 1
  echo "policies $p, tabelas com RLS $r"; [ "$p" = 0 ] && [ "$r" = 0 ]
}

# V8: webhooks que chegaram ao Go depois da troca do nginx ($V/troca-hora.txt, gravada pelo janela.sh)
v8() {
  desde=$(cat "$V/troca-hora.txt" 2> /dev/null) || falha "sem $V/troca-hora.txt (o t+10-nginx grava)" || return 1
  psql_api -c "select origem, count(*), max(recebido_em) from webhooks_recebidos where recebido_em > '$desde'::timestamptz group by 1 order by 1"
}

# estado do spool sem escrever nada: arquivos por pasta
spool-estado() { find /var/lib/virada-spool -maxdepth 2 -type f 2> /dev/null | awk -F/ '{ print $4 }' | sort | uniq -c | sed 's/^ *//'; echo "spool: $(systemctl is-active virada-spool 2>&1)"; }

# V9: worker sem tarefa DESLIGADA e sem falha nas que rodaram
v9() {
  cd "$API" || return 1
  docker compose exec -T worker api worker listar > "$V/v9.listar" || falha "api worker listar" || return 1
  d=$(grep -c DESLIGADA "$V/v9.listar"); echo "tarefas: $(grep -c . "$V/v9.listar"), desligadas: $d"
  m=$(docker compose exec -T worker wget -qO- 127.0.0.1:8081/metricas 2> /dev/null) || falha "/metricas do worker não respondeu" || return 1
  py='import json,sys
d=json.load(sys.stdin)
for k,v in d.items():
    if v.get("falhas", 0) > 0: print("%s falhas=%s %s" % (k, v["falhas"], v.get("ultimo_erro", "")[:80]))'
  f=$(printf '%s' "$m" | python3 -c "$py") || falha "/metricas não é JSON legível" || return 1
  [ -z "$f" ] || { echo "falhas no /metricas:"; printf '%s\n' "$f" | head -n 10; }
  [ "$d" = 0 ] && [ -z "$f" ]
}

[ $# -ge 1 ] || { sed -n '2,12p' "$0" >&2; exit 2; }
fn=$1; shift
case $fn in
  recriar|papeis|clone|hosts|storage|subir|conferir|fumaca|parar|nginx-reverter|modo-chatwoot|host-chatwoot|v4|v7|v8|v9|spool-estado|revogar-fumaca) "$fn" "$@" ;;
  *) echo "função desconhecida: $fn" >&2; exit 2 ;;
esac
