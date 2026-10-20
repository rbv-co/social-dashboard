#!/bin/sh
# gracioso = `docker restart` (mesmo contêiner e imagem, SIGTERM + graça de 60 s; não depende de API_VERSAO nem de compose).
# roda NA VPS, destacado: queda-worker.sh <crash|gracioso> <epoch-do-disparo> <saida>. Mata/recria o api-worker-1 no meio da
# tarefa meta-hora (24 s, minuto 5 de cada hora) e mede a retomada. Escreve só em <saida>; produção só é LIDA (e o worker, derrubado).
set -u
MODO=$1; ALVO=$2; OUT=$3
Q() { docker exec -i api-db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -qAt'; }
{
N=$(( ALVO - $(date +%s) )); [ "$N" -gt 0 ] && sleep "$N"
ID=$(echo "select hashtext('coletar-dados-hora')" | Q)
echo "== $MODO disparo previsto $(date -u -d @$ALVO +%T)Z"
echo "antes: enviando=$(echo "select count(*) from checkout_abandono where mensagem_status='enviando'" | Q) fila_envio=$(echo "select count(*) from checkout_abandono where status='fila_envio'" | Q) envios_feitos=$(echo "select count(*) from envios_feitos" | Q) restarts=$(docker inspect -f '{{.RestartCount}}' api-worker-1) iniciado=$(docker inspect -f '{{.State.StartedAt}}' api-worker-1)"
echo "meta-hora EM ANDAMENTO (trava coletar-dados-hora presa) no instante da queda: $(echo "select count(*) > 0 from pg_locks where locktype='advisory' and granted and objid=$ID::oid" | Q)"
T0=$(date +%s); echo "queda @ $(date -u +%T.%N | cut -c1-12)Z"
if [ "$MODO" = crash ]; then docker kill api-worker-1 >/dev/null  # ATENÇÃO: o docker trata `docker kill` como parada manual e NÃO reinicia (visto em 20/10); use crash-pid
elif [ "$MODO" = crash-pid ]; then kill -9 "$(docker inspect -f '{{.State.Pid}}' api-worker-1)"   # SIGKILL pelo host = OOM/queda real: a política de reinício age
else docker restart api-worker-1 >/dev/null; fi
echo "locks advisory 1 s depois da queda (trava solta pelo Postgres): $(sleep 1; echo "select count(*) from pg_locks where locktype='advisory' and granted and objid=$ID::oid" | Q)"
for i in $(seq 180); do S=$(docker inspect -f '{{.State.Health.Status}}' api-worker-1 2>/dev/null || echo ausente); [ "$S" = healthy ] && break; sleep 1; done
echo "worker $S após $(( $(date +%s)-T0 )) s; RestartCount=$(docker inspect -f '{{.RestartCount}}' api-worker-1) StartedAt=$(docker inspect -f '{{.State.StartedAt}}' api-worker-1)"
sleep 240
echo "depois (4 min): enviando=$(echo "select count(*) from checkout_abandono where mensagem_status='enviando'" | Q) fila_envio=$(echo "select count(*) from checkout_abandono where status='fila_envio'" | Q) envios_feitos=$(echo "select count(*) from envios_feitos" | Q)"
echo "minutos com mais de uma execução dos robôs de 1 min nos últimos 10 min [esperado nenhuma linha]:"
echo "select robo, date_trunc('minute', disparado_em), count(*) from robos_execucoes where disparado_em > to_timestamp($T0) - interval '6 minutes' and robo in ('abandono-de-checkout','enviar-mensagem-abandono','vessel-espelhar-lista') group by 1,2 having count(*)>1" | Q
echo "abandono-de-checkout ao redor da queda (UTC, ok):"; echo "select to_char(disparado_em at time zone 'utc','HH24:MI:SS') || ' ' || ok from robos_execucoes where robo='abandono-de-checkout' and disparado_em > to_timestamp($T0) - interval '2 minutes' order by disparado_em" | Q | tr '\n' ';'; echo
echo "maior intervalo entre ticks de abandono-de-checkout (de 2 min antes até agora): $(echo "select max(d) from (select disparado_em - lag(disparado_em) over (order by disparado_em) d from robos_execucoes where robo='abandono-de-checkout' and disparado_em > to_timestamp($T0) - interval '2 minutes') x" | Q)"
echo "falhas (ok=false) desde a queda em robôs do worker: $(echo "select count(*) from robos_execucoes where disparado_em > to_timestamp($T0) and ok is false and robo in ('abandono-de-checkout','enviar-mensagem-abandono','conferir-robos','publicar-o-site','meta-hora')" | Q)"
echo "meta-hora: linhas em robos_execucoes na última 1 h 30 (UTC, ok):"; echo "select to_char(disparado_em at time zone 'utc','HH24:MI:SS') || ' ' || coalesce(ok::text,'null') from robos_execucoes where robo='meta-hora' and disparado_em > now() - interval '90 minutes' order by disparado_em" | Q | tr '\n' ';'; echo
echo "duplicidade em ad_insights_hora (a UNIQUE já garante) [esperado 0]: $(echo "select count(*) from (select 1 from ad_insights_hora group by ad_id, account_id, dia, hora having count(*)>1) x" | Q 2>&1 | head -1)"
INI=$(date -u -d @$((T0-30)) +%Y-%m-%dT%H:%M:%S)
echo "pedidos central.rbvcompany.com desde 30 s antes da queda: $(awk -v i=$INI '{t=substr($1,1,19); if (t>=i && $2=="central.rbvcompany.com") n++} END{print n+0}' /var/log/nginx/saude.log); com 5xx: $(awk -v i=$INI '{t=substr($1,1,19); if (t>=i && $2=="central.rbvcompany.com" && $3>=500) n++} END{print n+0}' /var/log/nginx/saude.log)"
echo "api-api-1: $(docker inspect -f '{{.State.Health.Status}} rc={{.RestartCount}}' api-api-1)"
echo "FIM"
} > "$OUT" 2>&1
