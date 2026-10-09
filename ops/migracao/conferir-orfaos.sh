#!/bin/sh
# Para cada chave estrangeira que aponta para public.usuarios, conta as linhas órfãs
# (valor preenchido sem linha pai). Saída "tabela.coluna n"; exit 1 se algum n > 0.
# Um usuário apagado (soft delete) no Auth que ainda é referenciado aparece aqui, não é escondido.
set -eu
A=${1:?uso: conferir-orfaos.sh ALVO_URL}
ruim=$(mktemp)
lista=$(psql "$A" -X -Atq -F '|' -c "select conrelid::regclass::text, (select attname from pg_attribute where attrelid = conrelid and attnum = conkey[1]) from pg_constraint where contype = 'f' and confrelid = 'public.usuarios'::regclass and array_length(conkey, 1) = 1 order by 1, 2")
[ -n "$lista" ] || { echo "nenhuma FK aponta para public.usuarios: restauração errada?" >&2; rm -f "$ruim"; exit 1; }
printf '%s\n' "$lista" | while IFS='|' read -r tabela coluna; do
    n=$(psql "$A" -X -Atqc "select count(*) from $tabela t where t.\"$coluna\" is not null and not exists (select 1 from public.usuarios u where u.id = t.\"$coluna\")")
    echo "$tabela.$coluna $n"
    [ "$n" = 0 ] || echo x >> "$ruim"
  done
if [ -s "$ruim" ]; then rm -f "$ruim"; exit 1; fi
rm -f "$ruim"
