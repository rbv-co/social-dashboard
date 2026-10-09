#!/bin/sh
# Compara count(*) de cada tabela do public: origem × destino.
# Saída: "tabela origem destino"; exit 1 se alguma diferir.
# Tabela QUENTE (a origem cresce durante o dump) aparece como "origem maior": confira,
# no dia do corte a origem estará congelada (somente leitura) e tem de bater exato.
# "destino maior" nunca é explicável por crescimento: é erro real.
set -eu
O=${1:?uso: conferir-contagens.sh ORIGEM_URL ALVO_URL}
A=${2:?uso: conferir-contagens.sh ORIGEM_URL ALVO_URL}
O=$(printf '%s' "$O" | sed 's#:6543/#:5432/#')
# itera as tabelas da ORIGEM: o alvo tem a mais usuarios, sessoes e goose_db_version
tabelas=$(printf 'begin read only;\nselect table_name from information_schema.tables where table_schema=%s and table_type=%s order by 1;\ncommit;\n' "'public'" "'BASE TABLE'" | psql "$O" -X -Atq | grep -vE '^(BEGIN|COMMIT)$')
ruim=0
for t in $tabelas; do
  co=$(printf 'begin read only;\nselect count(*) from public."%s";\ncommit;\n' "$t" | psql "$O" -X -Atq | grep -E '^[0-9]+$' | head -1)
  ca=$(psql "$A" -X -Atqc "select count(*) from public.\"$t\"")
  marca=
  if [ "$co" != "$ca" ]; then
    ruim=1
    if [ "$co" -gt "$ca" ]; then marca=" <-- DIFERE (origem maior: tabela quente que cresceu durante o dump?)"; else marca=" <-- DIFERE (destino maior: erro real)"; fi
  fi
  echo "$t $co $ca$marca"
done
exit $ruim
