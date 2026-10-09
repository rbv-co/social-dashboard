#!/bin/sh
# Dump SOMENTE LEITURA do schema public do Supabase: schema (limpo) + dados.
# Uso: sh ops/migracao/dump-supabase.sh 'postgres://...' ops/migracao/saida/2026-10-09
# A URL não é impressa. Porta 6543 (pooler em modo transação) é trocada por 5432 (sessão).
# O pg_dump lê numa transação REPEATABLE READ somente leitura; nada é escrito na origem.
set -eu
ORIGEM=${1:?uso: dump-supabase.sh ORIGEM_DATABASE_URL SAIDA_DIR}
SAIDA=${2:?uso: dump-supabase.sh ORIGEM_DATABASE_URL SAIDA_DIR}
AQUI=$(cd "$(dirname "$0")" && pwd)
ORIGEM=$(printf '%s' "$ORIGEM" | sed 's#:6543/#:5432/#')
umask 077
mkdir -p "$SAIDA"; chmod 700 "$SAIDA"
oculta() { sed -E 's#postgres(ql)?://[^ "]*#<URL>#g'; }

# schema: sem dono, sem permissões; só o public
sh "$AQUI/pg17.sh" pg_dump "$ORIGEM" --schema=public --schema-only --no-owner --no-privileges \
  > "$SAIDA/schema-bruto.sql" 2> "$SAIDA/schema.erro" || { oculta < "$SAIDA/schema.erro" >&2; echo "pg_dump (schema) falhou" >&2; exit 1; }
node "$AQUI/limpar-dump.mjs" "$SAIDA/schema-bruto.sql" "$SAIDA/schema.sql" > "$SAIDA/limpeza.json"
echo "limpeza: $(cat "$SAIDA/limpeza.json")"

# dados: formato custom (restauração seletiva e paralela)
sh "$AQUI/pg17.sh" pg_dump "$ORIGEM" --schema=public --data-only --no-owner --no-privileges -Fc \
  > "$SAIDA/dados.dump" 2> "$SAIDA/dados.erro" || { oculta < "$SAIDA/dados.erro" >&2; echo "pg_dump (dados) falhou" >&2; exit 1; }
rm -f "$SAIDA/schema.erro" "$SAIDA/dados.erro"
chmod 600 "$SAIDA"/* 
echo "dump gravado em $SAIDA (schema.sql, dados.dump)"
