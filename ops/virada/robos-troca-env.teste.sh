#!/bin/sh
# Prova de robos-troca-env.sh num env FALSO: aplicar guarda o backup, liga a flag, grava 15 URLs sem vazar senha na saída;
# recusa sem senha (env intocado) e sem sobrescrever o backup; reverter devolve o env idêntico.
set -eu
AQUI=$(cd "$(dirname "$0")" && pwd); T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
S="$T/seg"; mkdir "$S"; E="$T/robos.env"; D="$T/d"
printf 'DATABASE_URL=postgres://postgres:velha@aws.pooler.supabase.com:5432/postgres\nZAPI_TOKEN=abc\nSUPABASE_SERVICE_KEY="chave-velha"\nVIGIA_DATABASE_URL=velho\nSAIU_DO_SUPABASE=\n' > "$E"; chmod 640 "$E"
for a in reporte selo pedidos-vessel shopify metaads-zoho vigia-meta notas relatorios cards gestor interesses opr budget noticias faxina; do echo "segredo-$a" > "$S/robo-$a.senha"; done
cp "$E" "$T/original"
rm "$S/robo-faxina.senha"
sh "$AQUI/robos-troca-env.sh" aplicar "$D" "$E" "$S" 2>/dev/null && { echo "FALHOU: aceitou sem senha"; exit 1; }
cmp -s "$E" "$T/original" && [ ! -e "$D/robos.env.antes" ] || { echo "FALHOU: mexeu no env sem senha"; exit 1; }
echo segredo-faxina > "$S/robo-faxina.senha"
sh "$AQUI/robos-troca-env.sh" aplicar "$D" "$E" "$S" > "$T/saida"
! grep -q segredo- "$T/saida" || { echo "FALHOU: senha na saída"; exit 1; }
cmp -s "$D/robos.env.antes" "$T/original" || { echo "FALHOU: backup diferente"; exit 1; }
grep -q '^SAIU_DO_SUPABASE=1$' "$E" && grep -q '^ZAPI_TOKEN=abc$' "$E" && grep -q '^DATABASE_URL=.*supabase' "$E" || { echo "FALHOU: chaves"; exit 1; }
grep -q '^VIGIA_DATABASE_URL=postgres://robo_vigia_meta:segredo-vigia-meta@api-db:5432/api' "$E" || { echo "FALHOU: URL do vigia"; exit 1; }
grep -q '^STORAGE_SUPABASE_SERVICE_KEY="chave-velha"$' "$E" && ! grep -q '^SUPABASE_SERVICE_KEY=' "$E" || { echo "FALHOU: chave do Storage não foi renomeada"; exit 1; }
[ "$(grep -c 'VIGIA_DATABASE_URL=\|SAIU_DO_SUPABASE=' "$E")" -eq 2 ] || { echo "FALHOU: chave duplicada"; exit 1; }
sh "$AQUI/robos-troca-env.sh" aplicar "$D" "$E" "$S" >/dev/null 2>&1 && { echo "FALHOU: sobrescreveu o backup"; exit 1; }
echo 'a@b' > "$S/robo-opr.senha"; cp "$T/original" "$T/e2"; rm -rf "$T/d2"
sh "$AQUI/robos-troca-env.sh" aplicar "$T/d2" "$T/e2" "$S" 2>/dev/null && { echo "FALHOU: aceitou senha com @"; exit 1; }
cmp -s "$T/e2" "$T/original" && [ ! -e "$T/d2/robos.env.antes" ] || { echo "FALHOU: senha ruim mexeu no env"; exit 1; }
sh "$AQUI/robos-troca-env.sh" reverter "$D" "$E" >/dev/null
cmp -s "$E" "$T/original" || { echo "FALHOU: reversão"; exit 1; }
echo "TUDO OK"
