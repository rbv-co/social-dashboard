#!/bin/sh
# Dump SOMENTE LEITURA do schema public do Supabase: UM pg_dump (um só snapshot, metade da carga
# em produção) em formato custom, de onde se deriva o schema limpo.
# Uso: sh ops/migracao/dump-supabase.sh 'postgres://...' ops/migracao/saida/2026-10-09
# Saída: SAIDA/completo.dump (schema+dados, formato custom), SAIDA/schema.sql (limpo).
# A URL não é impressa. Porta 6543 (pooler em modo transação) é trocada por 5432 (sessão).
# O pg_dump lê numa transação REPEATABLE READ somente leitura; nada é escrito na origem.
set -eu
ORIGEM=${1:?uso: dump-supabase.sh ORIGEM_DATABASE_URL SAIDA_DIR}
SAIDA=${2:?uso: dump-supabase.sh ORIGEM_DATABASE_URL SAIDA_DIR}
AQUI=$(cd "$(dirname "$0")" && pwd)
ORIGEM=$(printf '%s' "$ORIGEM" | sed 's#:6543/#:5432/#')
umask 077   # tudo que for criado daqui em diante é 600/700 (o dump tem dados pessoais e segredos)
mkdir -p "$SAIDA"; chmod 700 "$SAIDA"
oculta() { sed -E 's#postgres(ql)?://[^ "]*#<URL>#g'; }

# formato custom: permite restauração seletiva (schema, dados) a partir de um único arquivo
sh "$AQUI/pg17.sh" pg_dump "$ORIGEM" --schema=public --no-owner --no-privileges -Fc \
  > "$SAIDA/completo.dump" 2> "$SAIDA/dump.erro" || { oculta < "$SAIDA/dump.erro" >&2; echo "pg_dump falhou" >&2; exit 1; }
rm -f "$SAIDA/dump.erro"

# schema bruto derivado localmente do mesmo arquivo (stdin: o pg_restore roda num contêiner que não enxerga o arquivo do Mac)
sh "$AQUI/pg17.sh" pg_restore --schema-only --no-owner --no-privileges -f - < "$SAIDA/completo.dump" > "$SAIDA/schema-bruto.sql" \
  || { echo "pg_restore (schema) falhou" >&2; exit 1; }
node "$AQUI/limpar-dump.mjs" "$SAIDA/schema-bruto.sql" "$SAIDA/schema.sql" > "$SAIDA/limpeza.json"
echo "limpeza: $(cat "$SAIDA/limpeza.json")"
echo "dump gravado em $SAIDA (completo.dump, schema.sql)"
