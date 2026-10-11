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
# na rede api_net, lido a cada rodada (muda quando o contêiner é recriado). A URL NÃO leva a senha: ela vai no
# PGPASSWORD (variável nativa do `pg`), que não aparece em argumento nem em URL de log. A senha é hex
# (openssl rand -hex 24) e nunca é impressa; este script não usa `set -x`.
#
# A CHAVE DO CORTE: SAIU_DO_SUPABASE (qualquer valor não vazio, em /etc/robos.env) = "o banco agora é o novo".
# Com ela, faltar COPIA_DB_SENHA é ERRO, nunca "volta para o Supabase velho calado" (copiaria dado parado e o
# painel diria que está tudo bem). Voltar atrás de propósito = apagar AS DUAS linhas do /etc/robos.env
# (SAIU_DO_SUPABASE e COPIA_DB_SENHA): só apagar a primeira NÃO volta, porque com a senha ainda lá a cópia lê o banco novo.
if [ -n "${SAIU_DO_SUPABASE:-}" ] && [ -z "${COPIA_DB_SENHA:-}" ]; then
  echo "SAIU_DO_SUPABASE está ligada mas falta COPIA_DB_SENHA em /etc/robos.env: cópia não feita (sem volta ao Supabase). Para voltar ao Supabase de propósito, apague AS DUAS linhas de /etc/robos.env: SAIU_DO_SUPABASE e COPIA_DB_SENHA." >&2
  exit 1
fi
if [ -n "${COPIA_DB_SENHA:-}" ]; then
  ip=$(docker inspect -f '{{(index .NetworkSettings.Networks "api_net").IPAddress}}' api-db 2>/dev/null)
  [ -n "$ip" ] || { echo "api-db fora do ar (sem IP na rede api_net): cópia não feita" >&2; exit 1; }
  export PGPASSWORD="$COPIA_DB_SENHA"
  export COPIA_DATABASE_URL="postgres://copia@${ip}:5432/api"
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
