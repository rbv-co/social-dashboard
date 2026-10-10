#!/bin/sh
# Restaura o backup MAIS RECENTE num contêiner temporário (nunca toca o banco de verdade) e
# confere tabelas e dados: a lista de tabelas restauradas bate com a do índice do dump e public.usuarios tem linhas.
# Uso: sh testar-restauracao.sh [arquivo.dump]
# Variáveis opcionais (padrões = produção): BACKUP_DIR, TESTE_CONTAINER (o nome deve terminar em -teste).
set -eu
umask 077
DIR=${BACKUP_DIR:-/root/backups-api}
CT=${TESTE_CONTAINER:-api-db-teste}
IMG=postgres:17-trixie
erro() { echo "$(date '+%F %T') $*" >&2; }
case "$CT" in *-teste) ;; *) erro "recusado: TESTE_CONTAINER deve terminar em -teste"; exit 1 ;; esac
ARQ=${1:-$(ls -1t "$DIR"/api-db-*.dump 2>/dev/null | head -1 || true)}
[ -n "$ARQ" ] && [ -f "$ARQ" ] || { erro "nenhum backup encontrado em $DIR"; exit 1; }
sha() { if command -v sha256sum >/dev/null 2>&1; then sha256sum "$@"; else shasum -a 256 "$@"; fi; }
( cd "$(dirname "$ARQ")" && sha -c "$(basename "$ARQ").sha256" )
# traps ANTES do docker run; -v apaga o volume anônimo (senão vaza uma cópia dos dados por execução)
trap 'docker rm -fv "$CT" >/dev/null 2>&1 || true' EXIT
trap 'exit 130' INT HUP TERM
docker rm -fv "$CT" >/dev/null 2>&1 || true
docker run -d --rm --network none --memory 1g --name "$CT" -e POSTGRES_PASSWORD=teste "$IMG" >/dev/null
# a imagem reinicia o servidor após o initdb: exige duas respostas seguidas
OK=0
for _ in $(seq 90); do
  if docker exec "$CT" psql -U postgres -Atc 'select 1' >/dev/null 2>&1; then OK=$((OK+1)); [ "$OK" -ge 2 ] && break; else OK=0; fi
  sleep 1
done
[ "$OK" -ge 2 ] || { erro "contêiner de teste não subiu"; exit 1; }
# Tabelas esperadas = as que o ÍNDICE do dump lista (TABLE public <nome>), por nome; as restauradas = relações
# comuns e particionadas (relkind r/p) do schema public. Comparar as LISTAS (e não contar linhas de texto)
# pega tabela trocada por outra e não diverge com tabelas particionadas.
ESPERADO=$(docker exec -i "$CT" pg_restore -l < "$ARQ" | awk '/ TABLE public /{for(i=1;i<NF;i++) if($i=="public"){print $(i+1); break}}' | LC_ALL=C sort)
[ -n "$ESPERADO" ] || { erro "o índice do dump não lista nenhuma TABLE public"; exit 1; }
docker exec "$CT" createdb -U postgres teste
docker exec -i "$CT" pg_restore -U postgres -d teste --no-owner --exit-on-error < "$ARQ"
RESTAURADAS=$(docker exec "$CT" psql -U postgres -d teste -Atc "select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','p')" | LC_ALL=C sort)
[ -n "$RESTAURADAS" ] || { erro "restauração sem tabelas"; exit 1; }
[ "$RESTAURADAS" = "$ESPERADO" ] || { erro "restauração difere: o dump lista [$(echo $ESPERADO)], restaurou [$(echo $RESTAURADAS)]"; exit 1; }
N=$(printf '%s\n' "$ESPERADO" | wc -l | tr -d ' ')
U=$(docker exec "$CT" psql -U postgres -d teste -Atc "select count(*) from public.usuarios")
[ "$U" -gt 0 ] || { erro "restauração sem dados: public.usuarios vazia"; exit 1; }
echo "$(date '+%F %T') restauração ok: $N tabelas, $U usuários ($ARQ)"
