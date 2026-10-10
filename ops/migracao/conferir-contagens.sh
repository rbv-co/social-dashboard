#!/bin/sh
# Compara count(*) de cada tabela do public: origem × destino.
# Saída: "tabela origem destino"; exit 1 se alguma diferir ou se alguma contagem falhar (ERRO).
# Diferença = confira: pode ser tabela quente (cresceu ou perdeu linhas durante o dump) ou erro real.
# No dia do corte a origem estará congelada (somente leitura) e tem de bater exato.
# Nunca fica verde sem conferir: falha de consulta vira linha DIFERE com ERRO.
# Exit 2 = a varredura NÃO terminou (origem inalcançável, script interrompido ou crash no meio): nunca
# se confunde com divergência numérica (1). Só uma execução completa imprime a última linha
# "varredura completa: N tabelas"; quem lê a saída deve exigi-la.
set -eu
O=${1:?uso: conferir-contagens.sh ORIGEM_URL ALVO_URL}
A=${2:?uso: conferir-contagens.sh ORIGEM_URL ALVO_URL}
O=$(printf '%s' "$O" | sed 's#:6543/#:5432/#')
AQUI=$(cd "$(dirname "$0")" && pwd)
. "$AQUI/oculta.sh"
ERR=$(mktemp); SAIDA=$(mktemp); COMPLETA=0
# qualquer saída antes do fim da varredura (sinal, set -e no meio) vira exit 2, não um 1 que pareça divergência
fim() { s=$?; trap - EXIT; rm -f "$ERR" "$SAIDA"; [ "$COMPLETA" = 1 ] || [ "$s" = 2 ] || s=2; exit $s; }
trap fim EXIT
trap 'exit 2' INT TERM HUP
# psql cujo stderr passa por oculta, preservando o código de saída
pq() { s=0; psql "$@" 2> "$ERR" || s=$?; oculta < "$ERR" >&2; return $s; }

# itera as tabelas da ORIGEM: o alvo tem a mais usuarios, sessoes e goose_db_version
printf 'begin read only;\nselect table_name from information_schema.tables where table_schema=%s and table_type=%s order by 1;\ncommit;\n' "'public'" "'BASE TABLE'" | pq "$O" -X -Atq > "$SAIDA" \
  || { echo "ERRO: não consegui listar as tabelas da origem" >&2; exit 2; }
tabelas=$(grep -vE '^(BEGIN|COMMIT)$' "$SAIDA" || true)
[ -n "$tabelas" ] || { echo "ERRO: a origem não tem tabelas no public (ou a listagem falhou)" >&2; exit 2; }
ruim=0; n=0
for t in $tabelas; do
  co=$(printf 'begin read only;\nselect count(*) from public."%s";\ncommit;\n' "$t" | pq "$O" -X -Atq | grep -E '^[0-9]+$' | head -1) || co=
  [ -n "$co" ] || co=ERRO
  ca=$(pq "$A" -X -Atqc "select count(*) from public.\"$t\"") || ca=ERRO
  case "$ca" in ''|*[!0-9]*) ca=ERRO ;; esac
  marca=
  # ERRO nos dois lados também é DIFERE (ERRO == ERRO não pode parecer igual)
  if [ "$co" != "$ca" ] || [ "$co" = ERRO ] || [ "$ca" = ERRO ]; then ruim=1; marca=" <-- DIFERE (confira: tabela quente durante o dump ou erro real)"; fi
  echo "$t $co $ca$marca"
  n=$((n + 1))
done
COMPLETA=1
echo "varredura completa: $n tabelas"
exit $ruim
