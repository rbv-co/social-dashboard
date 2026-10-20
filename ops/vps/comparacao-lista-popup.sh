#!/bin/bash
# Plano 07 (INTEGRACAO-CORE-2026-10): compara leads_popup (Core) × vessel_lista_espera (Central) por sha256(lower(trim(email))).
# Imprime SÓ contagens, nunca e-mail. Cron da VPS (UTC): 15 3 * * *  (7 dias a partir de 20/10/2026), saída em /var/log/robos/plano07-comparacao-diaria.txt.
set -u
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
docker exec -i api-db sh -c 'psql -X -At -U "$POSTGRES_USER" -d "$POSTGRES_DB"' <<'SQL' | grep -E '^[0-9a-f]{64}$' | sort > "$T/central"
begin read only;
select encode(sha256(convert_to(lower(trim(email)),'UTF8')),'hex') from vessel_lista_espera;
rollback;
SQL
echo "select sha2(lower(trim(email)),256) from leads_popup where origem='popup-loja' and descadastrado_em is null;" |
  docker exec -i core-db sh -c 'mysql -uroot -p"$MYSQL_ROOT_PASSWORD" "$MYSQL_DATABASE" -N 2>/dev/null' | sort > "$T/core"
echo "select count(*) from vessel_lista_espera where bling_em is null; select count(*) from vessel_lista_espera where planilha_em is null;" |
  docker exec -i api-db sh -c 'psql -X -At -U "$POSTGRES_USER" -d "$POSTGRES_DB"' > "$T/pend"
echo "select sum(central_status is null), sum(central_tentativas >= 5 and central_status is null) from leads_popup where origem='popup-loja' and descadastrado_em is null;" |
  docker exec -i core-db sh -c 'mysql -uroot -p"$MYSQL_ROOT_PASSWORD" "$MYSQL_DATABASE" -N 2>/dev/null' > "$T/ponte"
printf '%s só_no_core=%s em_ambas=%s central_total=%s sem_bling_em=%s sem_planilha_em=%s ponte_pendente_esgotado=%s\n' "$(date -u +%FT%TZ)" \
  "$(comm -23 "$T/core" "$T/central" | wc -l | tr -d ' ')" "$(comm -12 "$T/core" "$T/central" | wc -l | tr -d ' ')" "$(wc -l < "$T/central" | tr -d ' ')" \
  "$(sed -n 1p "$T/pend")" "$(sed -n 2p "$T/pend")" "$(tr '\t' '/' < "$T/ponte")"
