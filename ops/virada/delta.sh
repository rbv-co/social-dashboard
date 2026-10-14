#!/bin/sh
# O que o Postgres novo ganhou DEPOIS do corte, por chave primária, para levar de volta ao Supabase no rollback
# tardio (depois da abertura). Compara a linha inteira (md5 do texto da linha) com a foto tirada no corte.
# Uso: sh ops/virada/delta.sh base     DB_URL DIR TABELAS   foto do corte em DIR/base, só das tabelas de TABELAS
#                                                          (uma por linha: as do Supabase; as só da API ficam fora)
#      sh ops/virada/delta.sh exportar DB_URL DIR           foto de agora (DIR/atual), DIR/delta/<t>.{csv,apagar},
#                                                          DIR/resumo.tsv e DIR/replay.sql
#      sh ops/virada/delta.sh comparar DB_URL DIR           foto de DB_URL contra DIR/atual (prova do replay)
# O replay roda no Supabase (ainda congelado) como `postgres`: psql -X -v ON_ERROR_STOP=1 -f DIR/replay.sql.
# Uma transação com session_replication_role=replica (sem gatilho nem checagem de FK, como o pg_restore; o
# supautils libera esse parâmetro ao postgres): apaga as chaves que sumiram, faz upsert das novas/alteradas e
# acerta as sequências (identity "generated always" inclusive: overriding system value). Tabela sem chave primária que mudou: só acusa (replay à mão). auth.users não entra.
# Saída: 0 ok (comparar: igual); 1 falhou (comparar: diferente; exportar: tabela sem chave mudou); 2 uso.
set -eu
ACAO=${1:-}; URL=${2:-}; DIR=${3:-}
[ -n "$ACAO" ] && [ -n "$URL" ] && [ -n "$DIR" ] || { sed -n '4,15p' "$0" >&2; exit 2; }
AQUI=$(cd "$(dirname "$0")" && pwd)
. "$AQUI/../migracao/oculta.sh"
umask 077; mkdir -p "$DIR"; DIR=$(cd "$DIR" && pwd)
TAB=$(printf '\t')
# o texto da linha depende destes parâmetros: fixos nas fotos e no replay (SET, não PGOPTIONS: passa pelo pooler)
AJUSTES="set timezone = 'UTC'; set datestyle = 'ISO, MDY'; set intervalstyle = 'postgres'; set extra_float_digits = 3; set bytea_output = 'hex'"
q() { _q=0; psql "$URL" -X -q -v ON_ERROR_STOP=1 -At -F "$TAB" -c "$AJUSTES" "$@" 2> "$DIR/.erro" || _q=$?; oculta < "$DIR/.erro" >&2; rm -f "$DIR/.erro"; return $_q; }
pk_de() {
  q -c "select coalesce(string_agg(quote_ident(a.attname), ',' order by k.n), '')
          from pg_index i cross join lateral unnest(i.indkey::int2[]) with ordinality k(att, n)
          join pg_attribute a on a.attrelid = i.indrelid and a.attnum = k.att
         where i.indrelid = 'public.$1'::regclass and i.indisprimary"
}
# foto de uma tabela: "chave<TAB>md5" ordenado (byte a byte, para o join); sem chave primária, uma linha "*"
foto() {
  pk=$(pk_de "$1")
  if [ -n "$pk" ]; then
    q -c "copy (select row($pk)::text, md5(_delta_::text) from public.$1 _delta_) to stdout" | LC_ALL=C sort -t "$TAB" -k1,1 > "$2/$1.tsv"
  else
    q -c "select '*', count(*) || ':' || coalesce(md5(string_agg(md5(_delta_::text), '' order by md5(_delta_::text))), '') from public.$1 _delta_" > "$2/$1.tsv"
  fi
}
fotos() { for f in "$DIR"/base/*.tsv; do foto "$(basename "$f" .tsv)" "$1"; done; }

case "$ACAO" in
base)
  LISTA=${4:?uso: delta.sh base DB_URL DIR TABELAS}
  [ ! -e "$DIR/base" ] || { echo "já existe $DIR/base (a foto do corte): recuso sobrescrever" >&2; exit 1; }
  ruins=$(grep -v -E '^[a-z_][a-z0-9_]*$' "$LISTA" | grep -v '^$' || true)
  [ -z "$ruins" ] || { echo "nomes de tabela fora do padrão (a-z, 0-9, _): $ruins" >&2; exit 1; }
  mkdir -p "$DIR/base.tmp"
  n=0; for t in $(grep -v '^$' "$LISTA"); do foto "$t" "$DIR/base.tmp"; n=$((n + 1)); done
  mv "$DIR/base.tmp" "$DIR/base"
  echo "foto do corte: $n tabelas, $(cat "$DIR"/base/*.tsv | wc -l | tr -d ' ') linhas; sem chave primária: $(grep -l '^\*' "$DIR"/base/*.tsv | wc -l | tr -d ' ')";;
exportar)
  [ -d "$DIR/base" ] || { echo "sem $DIR/base: rode 'base' no corte" >&2; exit 1; }
  rm -rf "$DIR/atual" "$DIR/delta"; mkdir -p "$DIR/atual" "$DIR/delta"; : > "$DIR/resumo.tsv"
  fotos "$DIR/atual"
  R="$DIR/replay.sql"; s=0; i=0
  printf '%s\n' '\set ON_ERROR_STOP 1' 'begin;' "set local session_replication_role = replica;" "set local timezone = 'UTC';" \
    "set local datestyle = 'ISO, MDY';" "set local intervalstyle = 'postgres';" "set local extra_float_digits = 3;" > "$R"
  for f in "$DIR"/base/*.tsv; do
    t=$(basename "$f" .tsv); a="$DIR/atual/$t.tsv"
    if grep -q '^\*' "$f"; then
      cmp -s "$f" "$a" || { echo "$t: SEM CHAVE PRIMÁRIA e mudou desde o corte: replay à mão" >&2; s=1; }
      continue
    fi
    LC_ALL=C join -t "$TAB" -v2 "$f" "$a" | cut -f1 > "$DIR/delta/$t.chaves"
    LC_ALL=C join -t "$TAB" "$f" "$a" | awk -F "$TAB" '$2 != $3 { print $1 }' > "$DIR/delta/$t.alteradas"
    LC_ALL=C join -t "$TAB" -v1 "$f" "$a" | cut -f1 > "$DIR/delta/$t.apagar"
    ni=$(wc -l < "$DIR/delta/$t.chaves" | tr -d ' '); nu=$(wc -l < "$DIR/delta/$t.alteradas" | tr -d ' '); nd=$(wc -l < "$DIR/delta/$t.apagar" | tr -d ' ')
    if [ $((ni + nu + nd)) = 0 ]; then rm -f "$DIR/delta/$t".*; continue; fi
    printf '%s\t%s\t%s\t%s\n' "$t" "$ni" "$nu" "$nd" >> "$DIR/resumo.tsv"
    novas=$ni; cat "$DIR/delta/$t.alteradas" >> "$DIR/delta/$t.chaves"; rm -f "$DIR/delta/$t.alteradas"
    pk=$(pk_de "$t"); i=$((i + 1))
    IFS="$TAB" read -r cols resto exc <<EOF
$(q -c "select string_agg(quote_ident(a.attname), ',' order by a.attnum),
               coalesce(string_agg(quote_ident(a.attname), ',' order by a.attnum) filter (where a.attnum <> all (i.indkey::int2[])), ''),
               coalesce(string_agg('excluded.' || quote_ident(a.attname), ',' order by a.attnum) filter (where a.attnum <> all (i.indkey::int2[])), '')
          from pg_attribute a join pg_index i on i.indrelid = a.attrelid and i.indisprimary
         where a.attrelid = 'public.$t'::regclass and a.attnum > 0 and not a.attisdropped and a.attgenerated = ''")
EOF
    q -f - <<EOF
create temp table _k (k text);
\copy _k from '$DIR/delta/$t.chaves'
\copy (select $cols from public.$t _delta_ where row($pk)::text in (select k from _k)) to '$DIR/delta/$t.csv' csv
EOF
    if [ -n "$resto" ]; then acao="do update set ($resto) = row($exc)"; else acao="do nothing"; fi
    {
      printf '%s\n' "-- public.$t: $ni novas, $nu alteradas, $nd apagadas" \
        "create temp table _k$i (k text) on commit drop;" \
        "\\copy _k$i from '$DIR/delta/$t.apagar'" \
        "delete from public.$t where row($pk)::text in (select k from _k$i);" \
        "create temp table _r$i on commit drop as select $cols from public.$t limit 0;" \
        "\\copy _r$i from '$DIR/delta/$t.csv' csv" \
        "insert into public.$t ($cols) overriding system value select $cols from _r$i on conflict ($pk) $acao;"
      # sequência de coluna serial/identity: nunca atrás do maior id que voltou
      [ "$novas" = 0 ] || q -c "select format('select setval(%L, m) from (select max(%I) m from public.%I) s where m > (select last_value from %s);',
                                              q.s, q.c, '$t', q.s)
                                  from (select a.attname c, pg_get_serial_sequence('public.$t', a.attname) s from pg_attribute a
                                         where a.attrelid = 'public.$t'::regclass and a.attnum > 0 and not a.attisdropped) q
                                 where q.s is not null"
    } >> "$R"
  done
  printf '%s\n' 'commit;' >> "$R"
  echo "tabelas com mudança desde o corte: $(wc -l < "$DIR/resumo.tsv" | tr -d ' ') (tabela, novas, alteradas, apagadas):"
  cat "$DIR/resumo.tsv"
  echo "replay: $R"
  exit $s;;
comparar)
  [ -d "$DIR/atual" ] || { echo "sem $DIR/atual: rode 'exportar' antes" >&2; exit 1; }
  rm -rf "$DIR/comparar"; mkdir -p "$DIR/comparar"; fotos "$DIR/comparar"
  dif=0
  for f in "$DIR"/atual/*.tsv; do
    t=$(basename "$f"); cmp -s "$f" "$DIR/comparar/$t" || { echo "DIFERENTE: ${t%.tsv}"; dif=$((dif + 1)); }
  done
  [ "$dif" = 0 ] || { echo "$dif tabela(s) diferente(s)" >&2; exit 1; }
  echo "IGUAL: $(ls "$DIR"/atual/*.tsv | wc -l | tr -d ' ') tabelas, linha a linha";;
*) sed -n '4,15p' "$0" >&2; exit 2;;
esac
