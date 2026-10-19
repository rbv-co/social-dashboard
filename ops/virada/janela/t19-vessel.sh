#!/bin/bash
# T+19 (serviços da Vessel na VPS, PR #381): espelho da planilha (serviço), lembretes (cron 12h UTC), carocos (cron */10) e o vigia de
# Conteúdo (serviço). Roda NA VPS como root, DEPOIS do t17-robos.sh (que grava CONTEUDO_DB_SENHA no robos.env). Aditivo e reversível.
# Uso: bash t19-vessel.sh <aplicar|reverter>
#  aplicar:  1. confere as 3 funções (`to_regprocedure`) e a tabela da fila no api-db; 2. cria vessel-servicos.env (600: DATABASE_URL do papel
#               api_app + ZEPTOMAIL_TOKEN copiado do api.env); 3. instala o wrapper (/usr/local/sbin/vessel-servico), as units e o cron.d;
#            4. prova: espelho `--uma-vez`, carocos `--ensaio`, lembretes sem token (nada sai); 5. liga vessel-espelho e conteudo-vigia e
#               confere `is-active`; `robos_execucoes` do espelho gravada. Falha em qualquer passo: desfaz tudo (sai 1).
#  reverter: para e desabilita as duas units, tira o cron.d, units e env. Idempotente.
# Sem ZEPTOMAIL_TOKEN no api.env o LEMBRETE NÃO é instalado (aviso alto no fim, exit 0 nos demais): sem o token ele marcaria e-mail como falha.
# Variáveis só para ensaio: BANCO=api_corte, UMA_VEZ=--ensaio (o espelho não grava no Zoho), DESTINO_UNITS, DESTINO_CRON, SBIN, SEG, SYSTEMCTL, SO_PROVAS=1.
set -u
ACAO=${1:-}; [ "$ACAO" = aplicar ] || [ "$ACAO" = reverter ] || { sed -n '3,4p' "$0" >&2; exit 2; }
AQUI=$(cd "$(dirname "$0")" && pwd)
SEG=${SEG:-/root/secrets}; SBIN=${SBIN:-/usr/local/sbin}; SYSTEMCTL=${SYSTEMCTL:-systemctl}; BANCO=${BANCO:-api}
UNITS=${DESTINO_UNITS:-/etc/systemd/system}; CRONS=${DESTINO_CRON:-/etc/cron.d}; ENV_ROBOS=${ENV_ROBOS:-/etc/robos.env}
UMA_VEZ=${UMA_VEZ:---uma-vez}; REPO=${REPO:-/opt/robos/social-dashboard}; export REPO
VENV="$SEG/vessel-servicos.env"
say() { echo "[t19-vessel] $*"; }
psql_api() { docker exec api-db psql -U api -d "$BANCO" -XAtc "$1"; }

desfazer() {
  for u in vessel-espelho conteudo-vigia; do $SYSTEMCTL disable --now "$u" 2>/dev/null || true; rm -f "$UNITS/$u.service"; done
  $SYSTEMCTL daemon-reload 2>/dev/null || true
  rm -f "$CRONS/vessel-servicos" "$SBIN/vessel-servico" "$VENV"; say "DESFEITO (espelho, conteúdo, cron de lembretes/carocos e env removidos)"
}
if [ "$ACAO" = reverter ]; then desfazer; exit 0; fi
fail() { echo "[t19-vessel] FALHOU: $*" >&2; desfazer; exit 1; }

[ "$(docker inspect -f '{{.State.Health.Status}}' api-db 2>/dev/null)" = healthy ] || { echo "api-db não está healthy" >&2; exit 1; }
f=$(psql_api "select to_regprocedure('vessel_lembretes_a_enviar()') is not null and to_regprocedure('vessel_lembrete_marcar_enviado(uuid,integer)') is not null and to_regprocedure('vessel_carocos()') is not null and to_regclass('disparos_pendentes') is not null and to_regclass('robos_execucoes') is not null")
[ "$f" = t ] || { echo "FALHOU: faltam funções/tabelas no api-db ($BANCO): to_regprocedure das 3 funções, disparos_pendentes, robos_execucoes" >&2; exit 1; }
[ -s "$SEG/api-app.senha" ] || { echo "FALHOU: sem $SEG/api-app.senha" >&2; exit 1; }
[ -n "${SO_PROVAS:-}" ] || grep -q '^CONTEUDO_DB_SENHA=' "$ENV_ROBOS" || { echo "FALHOU: sem CONTEUDO_DB_SENHA em $ENV_ROBOS (t17-robos.sh não rodou?)" >&2; exit 1; }

trap 'fail "erro inesperado (linha $LINENO)"' ERR
set -e
( umask 077
  printf 'DATABASE_URL=postgres://api_app:%s@api-db:5432/%s?sslmode=disable\n' "$(cat "$SEG/api-app.senha")" "$BANCO" > "$VENV"
  tok=$(sed -n 's/^ZEPTOMAIL_TOKEN=//p' "$SEG/api.env" 2>/dev/null | tail -1)
  [ -z "$tok" ] || printf 'ZEPTOMAIL_TOKEN=%s\n' "$tok" >> "$VENV" )
LEMBRETE=sim; grep -q '^ZEPTOMAIL_TOKEN=.' "$VENV" || LEMBRETE=nao
install -m 755 "$AQUI/vessel-servico.sh" "$SBIN/vessel-servico"
install -m 644 "$AQUI/vessel-espelho.service" "$UNITS/vessel-espelho.service"
install -m 644 "$REPO/coletor/vps/conteudo-vigia.service" "$UNITS/conteudo-vigia.service"
if [ "$LEMBRETE" = sim ]; then install -m 644 "$AQUI/vessel-servicos.cron" "$CRONS/vessel-servicos"
else grep -v 'vessel-servico lembretes' "$AQUI/vessel-servicos.cron" > "$CRONS/vessel-servicos"; chmod 644 "$CRONS/vessel-servicos"; fi
$SYSTEMCTL daemon-reload

# provas antes de ligar qualquer serviço (o espelho --uma-vez grava no Zoho se houver pedido na fila; --ensaio nunca grava)
t0=$(date +%s)
"$SBIN/vessel-servico" espelho $UMA_VEZ > /dev/null 2>&1 || fail "espelho $UMA_VEZ"
"$SBIN/vessel-servico" carocos --ensaio > /dev/null 2>&1 || fail "carocos --ensaio"
SEM_ZEPTOMAIL=1 "$SBIN/vessel-servico" lembretes 2>/dev/null | grep -q '"mandados"' || fail "lembretes (sem token, nada sai)"
if [ "$UMA_VEZ" = --uma-vez ]; then
  n=$(psql_api "select count(*) from robos_execucoes where robo = 'vessel-espelhar-lista' and conferido_em >= to_timestamp($t0 - 2)")
  [ "${n:-0}" -ge 1 ] || fail "espelho --uma-vez não gravou robos_execucoes"
fi
[ -n "${SO_PROVAS:-}" ] && { say "SÓ PROVAS: nada ligado"; trap - ERR; exit 0; }
$SYSTEMCTL enable --now vessel-espelho conteudo-vigia
sleep 8
for u in vessel-espelho conteudo-vigia; do [ "$($SYSTEMCTL is-active "$u")" = active ] || fail "$u não ficou ativo"; done
trap - ERR
say "APLICADO: vessel-espelho e conteudo-vigia ativos; cron de carocos (*/10) instalado; lembrete: $LEMBRETE"
[ "$LEMBRETE" = sim ] || echo "[t19-vessel] ⚠️ LEMBRETE NÃO INSTALADO: falta ZEPTOMAIL_TOKEN em $SEG/api.env. Depois de gravá-lo: bash $0 reverter && bash $0 aplicar (ou acrescente a linha em $VENV e o cron do lembrete)." >&2
