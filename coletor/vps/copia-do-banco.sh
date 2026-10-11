#!/usr/bin/env bash
# Cópia de segurança do banco para o Zoho WorkDrive (era .github/workflows/copia-do-banco.yml). Chamado por rodar-robo.sh.
# Argumentos extras (ex.: --forcar) vão direto ao guardar-copia-do-banco.mjs; --ensaio só ensaia, sem enviar nem limpar.
#
# DOMINGO (UTC) leva --semanal: inclui o histórico de métrica, que é grande e quase todo recoletável.
# A limpeza do que passou do prazo (--limpar) só na rodada automática; ela tem teto de 5 pastas por vez.
# DIA 1º: baixa a cópia de ontem e confere cada arquivo contra o manifesto — backup que nunca foi restaurado não é backup.
set -u

# DEPOIS DO CORTE (saída do Supabase, Plano 4): com COPIA_DB_SENHA em /etc/robos.env a cópia lê o Postgres da API
# com o papel `copia` (ops/vps/api-db/papel-copia.sql). O api-db não publica porta: o endereço é o IP do contêiner
# na rede api_net, lido a cada rodada (muda quando o contêiner é recriado). A senha é hex (openssl rand -hex 24):
# vai na URL sem escapar e nunca é impressa.
if [ -n "${COPIA_DB_SENHA:-}" ]; then
  ip=$(docker inspect -f '{{(index .NetworkSettings.Networks "api_net").IPAddress}}' api-db 2>/dev/null)
  [ -n "$ip" ] || { echo "api-db fora do ar (sem IP na rede api_net): cópia não feita" >&2; exit 1; }
  export COPIA_DATABASE_URL="postgres://copia:${COPIA_DB_SENHA}@${ip}:5432/api"
fi

argumentos=("$@")
[ "$(date -u +%w)" = "0" ] && argumentos+=(--semanal)
case " $* " in *" --ensaio "*) ;; *) argumentos+=(--limpar) ;; esac

node coletor/guardar-copia-do-banco.mjs "${argumentos[@]}" || exit $?

case " $* " in *" --ensaio "*) exit 0 ;; esac
if [ "$(date -u +%d)" = "01" ]; then
  node coletor/restaurar-copia.mjs --conferir "$(date -u -d 'yesterday' +%Y-%m-%d)"
else
  echo "não é dia 1º — a conferência mensal roda no dia 1º."
fi
