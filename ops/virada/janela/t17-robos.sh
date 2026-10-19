#!/bin/bash
# T+17 (robôs da VPS): liga os robôs no api-db, só os que têm destino. Roda NA VPS como root, SÓ no passo do roteiro (depois do GO técnico).
# Uso: bash t17-robos.sh <aplicar|reverter>
#  aplicar:  1. confere api-db saudável, marca PRODUCAO (a menos que ENSAIO=1), pacote em $VIRADA, as 17 senhas e o cron novo;
#            2. backup de robos.env, cartoes-ean.env e cron.d em $BACKUP/t17-<hora>/;
#            3. robos-troca-env.sh aplicar (flag SAIU_DO_SUPABASE, 15 URLs, COPIA/CONTEUDO_DB_SENHA, chave de Storage renomeada);
#            4. CARTOES_DB_SENHA em cartoes-ean.env (o vigia monta a URL e tira SUPABASE_*);
#            5. conferir-papeis.mjs: cada papel conecta PELA VIA DOS ROBÔS (se algum falhar: reverte tudo e sai 1);
#            6. instala o cron novo e inicia `cartoes-ean`; 7. fumaça: uma rodada de mentira (`rodar-robo.sh t17-fumaca`) tem de aparecer
#               em robos_execucoes pelo papel robo_reporte.
#            Qualquer falha a partir do passo 3 desfaz sozinha (mesmo código do `reverter`) e sai 1.
#  reverter: desfaz o que o aplicar fez (env, cartoes-ean.env, cron.d, serviço) e volta ao estado da Fase A (robôs parados). NÃO volta ao
#            Supabase: isso é o rollback A/B do roteiro. Idempotente.
# O que fica DESLIGADO (por quê): faxina-storage (Storage = fase 2; está comentado no cron novo e o rodar-robo.sh o recusa);
# ig-coletor (pulado em pg; passo-verifica do coletor-noticias acusa falta de Instagram até a fase 2); imagem do opr-diario (Storage).
# Variáveis só para ensaio: ENSAIO=1 (não exige PRODUCAO), BANCO=api_corte, ENV_ROBOS, CART_ENV, CRON, VIRADA, SEG, SYSTEMCTL, BACKUP, REPO.
set -u
ACAO=${1:-}; [ "$ACAO" = aplicar ] || [ "$ACAO" = reverter ] || { sed -n '3,4p' "$0" >&2; exit 2; }
ENV_ROBOS=${ENV_ROBOS:-/etc/robos.env}; CART_ENV=${CART_ENV:-/etc/cartoes-ean.env}; CRON=${CRON:-/etc/cron.d/robos-social-dashboard}
VIRADA=${VIRADA:-/root/virada}; SEG=${SEG:-/root/secrets}; SYSTEMCTL=${SYSTEMCTL:-systemctl}; BACKUP=${BACKUP:-/root/backups/virada}
REPO=${REPO:-/opt/robos/social-dashboard}; NODE_BIN=${NODE_BIN:-/opt/cartoes-ean/node/bin}; BANCO=${BANCO:-api}; export BANCO
ESTADO="$VIRADA/t17-estado"   # guarda o diretório do backup desta aplicação (o reverter o acha sem argumento)
say() { echo "[t17-robos] $*"; }
die() { echo "[t17-robos] FALHOU: $*" >&2; exit 1; }

desfazer() {
  [ -f "$ESTADO" ] || { say "nada aplicado (sem $ESTADO)"; return 0; }
  dir=$(cat "$ESTADO")
  rm -f "$CRON"; $SYSTEMCTL stop cartoes-ean 2>/dev/null || true
  [ -f "$dir/cartoes-ean.env" ] && cp -p "$dir/cartoes-ean.env" "$CART_ENV"
  [ -f "$dir/troca/robos.env.antes" ] && sh "$VIRADA/robos-troca-env.sh" reverter "$dir/troca" "$ENV_ROBOS" "$SEG"
  rm -f "$ESTADO"; say "DESFEITO: robôs de volta à Fase A (cron fora, cartoes-ean parado, robos.env de antes)"
}

if [ "$ACAO" = reverter ]; then desfazer; exit 0; fi

[ ! -f "$ESTADO" ] || die "já aplicado ($ESTADO): rode reverter antes"
[ "$($SYSTEMCTL is-active cartoes-ean 2>/dev/null || true)" != active ] || die "cartoes-ean ainda ativo: a Fase A (t29) não rodou"
[ ! -e "$CRON" ] || die "$CRON existe: a Fase A (t29) não rodou (o cron velho ainda manda)"
[ -n "${ENSAIO:-}" ] || [ -e /root/api-db/PRODUCAO ] || die "sem /root/api-db/PRODUCAO: o corte (T+7) não aconteceu; este script só roda depois dele"
[ "$(docker inspect -f '{{.State.Health.Status}}' api-db 2>/dev/null)" = healthy ] || die "api-db não está healthy"
for f in robos-social-dashboard.go robos-troca-env.sh; do [ -f "$VIRADA/$f" ] || die "falta $VIRADA/$f (instalar-pacote.sh)"; done
for s in reporte selo pedidos-vessel shopify metaads-zoho vigia-meta notas relatorios cards gestor interesses opr budget noticias faxina cartoes; do
  [ -s "$SEG/robo-$s.senha" ] || die "falta $SEG/robo-$s.senha (T+7 não criou o papel?)"; done
for s in copia conteudo; do [ -s "$SEG/$s.senha" ] || die "falta $SEG/$s.senha"; done

dir="$BACKUP/t17-$(date -u +%Y%m%dT%H%M%SZ)"; ( umask 077; mkdir -p "$dir" )
cp -p "$ENV_ROBOS" "$dir/robos.env"; cp -p "$CART_ENV" "$dir/cartoes-ean.env"
echo "$dir" > "$ESTADO"; say "backup em $dir"
trap 'echo "[t17-robos] falhou: desfazendo" >&2; desfazer' EXIT

sh "$VIRADA/robos-troca-env.sh" aplicar "$dir/troca" "$ENV_ROBOS" "$SEG" || exit 1
grep -q '^CARTOES_DB_SENHA=' "$CART_ENV" || ( umask 077; echo "CARTOES_DB_SENHA=$(cat "$SEG/robo-cartoes.senha")" >> "$CART_ENV" )
# O vigia monta a URL sozinho e tira as SUPABASE_*; a chave velha sai do arquivo para não voltar por engano
grep -Ev '^(SUPABASE_URL|SUPABASE_SERVICE_KEY)=' "$CART_ENV" > "$CART_ENV.novo" && chmod --reference="$CART_ENV" "$CART_ENV.novo" && mv "$CART_ENV.novo" "$CART_ENV"

( cd "$REPO/coletor" && PATH="$NODE_BIN:$PATH" node "$VIRADA/conferir-papeis.mjs" "$ENV_ROBOS" "$CART_ENV" ) || exit 1

install -m 644 -o root -g root "$VIRADA/robos-social-dashboard.go" "$CRON" || exit 1
$SYSTEMCTL start cartoes-ean || exit 1
sleep 5; [ "$($SYSTEMCTL is-active cartoes-ean)" = active ] || { say "cartoes-ean não ficou ativo"; exit 1; }

# fumaça: o rodar-robo.sh lê o env novo, resolve o IP do api-db e grava a rodada por pg (robo_reporte). Robô sem ROBO_<NOME>_DATABASE_URL é
# RECUSADO pela trava (com razão: o DATABASE_URL global ainda é o do Supabase), então a fumaça empresta a URL do papel robo_reporte, só no ambiente
t0=$(date +%s)
ROBO_T17_FUMACA_DATABASE_URL=$(sed -n 's/^REPORTAR_DATABASE_URL=//p' "$ENV_ROBOS" | tail -1) LOGS="$VIRADA/t17-logs" LOCKS="$VIRADA/t17-locks" ENV_ROBOS="$ENV_ROBOS" RAIZ="$REPO" bash -c 'mkdir -p "$LOGS" "$LOCKS"; touch "$LOGS/.pull"; exec "$RAIZ/coletor/vps/rodar-robo.sh" t17-fumaca 2 -- true' || exit 1
n=$(docker exec api-db psql -U api -d "$BANCO" -XAtc "select count(*) from robos_execucoes where robo = 't17-fumaca' and conferido_em >= to_timestamp($t0 - 2)")
[ "${n:-0}" -ge 1 ] || { say "a rodada de fumaça não apareceu em robos_execucoes"; exit 1; }
trap - EXIT
say "APLICADO: flag ligada, 15+3 papéis conectam, cron novo instalado, cartoes-ean ativo, fumaça gravada em robos_execucoes. Reverter: bash $0 reverter"
