#!/bin/sh
# PROVA DE RESTAURAÇÃO do api-db (não toca o banco de verdade além de LER): numa transação REPEATABLE READ somente
# leitura tira a impressão digital do banco vivo (paridade-tabelas.sql) E o dump (pg_dump --snapshot + papéis) do MESMO
# instante; restaura o dump num contêiner descartável (sem rede, volume próprio, removido ao fim) e compara a
# impressão digital. Repete N vezes (padrão 2). Mede o tempo da restauração (RTO) e a idade do dump (RPO).
# Uso: sh provar-restauracao.sh [pasta-de-saida] [N]     Variáveis: API_DB_CONTAINER, TESTE_CONTAINER (termina em -teste)
set -eu
umask 077
AQUI=$(cd "$(dirname "$0")" && pwd)
OUT=${1:-/root/restore-prova}; N=${2:-2}
CT=${API_DB_CONTAINER:-api-db}; TC=${TESTE_CONTAINER:-api-db-prova-teste}
IMG=postgres:17-trixie
case "$N" in ''|*[!0-9]*|0) echo "N deve ser um inteiro >= 1" >&2; exit 1 ;; esac
case "$TC" in *-teste) ;; *) echo "recusado: TESTE_CONTAINER deve terminar em -teste" >&2; exit 1 ;; esac
mkdir -p "$OUT"; chmod 700 "$OUT"
# apaga também as cópias em claro (o .globals.sql leva o hash das senhas): ficam só os .txt
limpa() { docker rm -fv "$TC" >/dev/null 2>&1 || true; docker exec "$CT" rm -f /tmp/prova.dump /tmp/prova.globals.sql 2>/dev/null || true; rm -f "$OUT/prova.dump" "$OUT/prova.globals.sql"; }
trap limpa EXIT
trap 'exit 130' INT HUP TERM
agora() { date +%s; }

# 1. banco vivo: impressão digital e dump do mesmo snapshot (o psql ignora erro do \! : apaga sobra antes e o dump falho some)
docker exec "$CT" rm -f /tmp/prova.dump /tmp/prova.globals.sql
{ echo 'begin isolation level repeatable read read only;'
  echo 'select pg_export_snapshot() as snap \gset'
  echo '\setenv SNAP :snap'
  echo '\pset tuples_only on'
  echo '\pset format unaligned'
  cat "$AQUI/paridade-tabelas.sql"
  echo '\! pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc --snapshot="$SNAP" -f /tmp/prova.dump || rm -f /tmp/prova.dump'
  echo '\! pg_dumpall -U "$POSTGRES_USER" --globals-only -f /tmp/prova.globals.sql || rm -f /tmp/prova.globals.sql'
  echo 'commit;'
} | docker exec -i "$CT" sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -q' > "$OUT/vivo.txt"
docker cp "$CT:/tmp/prova.dump" "$OUT/prova.dump"; docker cp "$CT:/tmp/prova.globals.sql" "$OUT/prova.globals.sql"
[ "$(grep -c '^T ' "$OUT/vivo.txt")" -gt 0 ] || { echo "impressão digital do banco vivo vazia" >&2; exit 1; }
echo "vivo: $(grep -c '^T ' "$OUT/vivo.txt") tabelas; dump $(du -h "$OUT/prova.dump" | cut -f1)" | tee "$OUT/resumo.txt"

# 2. restaura N vezes num contêiner descartável e compara
for i in $(seq "$N"); do
  docker rm -fv "$TC" >/dev/null 2>&1 || true
  t0=$(agora)
  docker run -d --network none --memory 1g --cpus 1 --name "$TC" -e POSTGRES_PASSWORD=teste "$IMG" >/dev/null
  OK=0; for _ in $(seq 120); do
    if docker exec "$TC" psql -U postgres -Atc 'select 1' >/dev/null 2>&1; then OK=$((OK+1)); [ "$OK" -ge 2 ] && break; else OK=0; fi; sleep 1
  done
  [ "$OK" -ge 2 ] || { echo "contêiner de teste não subiu" >&2; exit 1; }
  t1=$(agora)
  docker exec -i "$TC" psql -U postgres -v ON_ERROR_STOP=1 -q -f - < "$OUT/prova.globals.sql" >/dev/null
  docker exec "$TC" createdb -U postgres -O api api
  docker exec -i "$TC" pg_restore -U postgres -d api --exit-on-error < "$OUT/prova.dump"
  t2=$(agora)
  { echo '\pset tuples_only on'; echo '\pset format unaligned'; cat "$AQUI/paridade-tabelas.sql"; } \
    | docker exec -i "$TC" psql -U postgres -d api -v ON_ERROR_STOP=1 -q > "$OUT/restaurado-$i.txt"
  t3=$(agora)
  if diff -q "$OUT/vivo.txt" "$OUT/restaurado-$i.txt" >/dev/null; then R=IGUAL; else R=DIVERGE; diff "$OUT/vivo.txt" "$OUT/restaurado-$i.txt" | head -20 > "$OUT/diff-$i.txt"; fi
  echo "rodada $i: $R | subir contêiner ${t1:+$((t1-t0))}s, restaurar papéis+dump $((t2-t1))s (RTO do banco $((t2-t0))s), conferir $((t3-t2))s, $(grep -c '^T ' "$OUT/restaurado-$i.txt") tabelas" | tee -a "$OUT/resumo.txt"
  [ "$R" = IGUAL ] || exit 2
done
echo "PARIDADE 100% em $N restaurações" | tee -a "$OUT/resumo.txt"
