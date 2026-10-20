#!/bin/sh
# roda NA VPS: amostra a cada 5 s durante $1 segundos. Saída CSV: hora,load1,steal%,cpu_api%,mem_api,cpu_db%,mem_db,conexoes_pg
N=$1
echo "hora,load1,cpu_api_pct,mem_api,cpu_db_pct,mem_db,conexoes_pg,sys_idle_pct,sys_steal_pct"
FIM=$(( $(date +%s) + N ))
while [ "$(date +%s)" -lt "$FIM" ]; do
  L=$(cut -d' ' -f1 /proc/loadavg)
  S=$(docker stats --no-stream --format '{{.Name}} {{.CPUPerc}} {{.MemUsage}}' api-api-1 api-db 2>/dev/null)
  A=$(echo "$S" | awk '$1=="api-api-1"{print $2","$3}'); B=$(echo "$S" | awk '$1=="api-db"{print $2","$3}')
  C=$(echo "select count(*) from pg_stat_activity where datname='api'" | docker exec -i api-db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -qAt')
  V=$(vmstat 1 2 | tail -1 | awk '{print $15","$17}')
  echo "$(date -u +%T),$L,$A,$B,$C,$V"
done
