#!/bin/bash
# T+20/T+21: worker da API Go (as 18 tarefas que eram pg_cron). Roda NA VPS como root.
# Uso: bash t20-worker.sh <conferir|liberar|recuperar|reverter>
#  conferir   (HOJE, antes da janela; não muda nada) worker.env tem WORKER_TAREFAS_DESLIGADAS=* e o compose existe.
#  liberar    (T+20) guarda worker.env em $BACKUP, deixa WORKER_TAREFAS_DESLIGADAS VAZIA (nome inexistente faria o worker recusar subir),
#             `docker compose up -d worker` e confere `api worker listar`: nenhuma DESLIGADA.
#  recuperar  (T+21) `api worker rodar <t> --forcar` SÓ das 5 permitidas (abandono-de-checkout coletar-dados-12h meta-hora
#             conteudo-espelho conferir-robos); NUNCA as de push, WhatsApp e RD. Saída 0 em cada, senão sai 1 (anote e siga).
#  reverter   volta o worker.env guardado (tudo DESLIGADO) e para o worker: nada mais roda sozinho.
# Variáveis para ensaio: ENSAIO=1 (dispensa PRODUCAO), API_DIR, WORKER_ENV, BACKUP, DC (comando do compose).
set -u
ACAO=${1:-}; API_DIR=${API_DIR:-/root/api}; WORKER_ENV=${WORKER_ENV:-/root/secrets/worker.env}; BACKUP=${BACKUP:-/root/backups/virada}
DC=${DC:-docker compose}; GUARDA="$BACKUP/worker.env.antes-t20"
PERMITIDAS="abandono-de-checkout coletar-dados-12h meta-hora conteudo-espelho conferir-robos"
say() { echo "[t20-worker] $*"; }
die() { echo "[t20-worker] FALHOU: $*" >&2; exit 1; }
dc() { ( cd "$API_DIR" && $DC "$@" ); }
case "$ACAO" in liberar|recuperar) [ -n "${ENSAIO:-}" ] || [ -e /root/api-db/PRODUCAO ] || die "sem /root/api-db/PRODUCAO: o corte não aconteceu (ligar o worker agora dispararia push/WhatsApp junto com o pg_cron do Supabase)" ;; esac
case "$ACAO" in
conferir)
  [ -f "$WORKER_ENV" ] || die "sem $WORKER_ENV"
  [ "$(grep -c '^WORKER_TAREFAS_DESLIGADAS=\*$' "$WORKER_ENV")" = 1 ] || die "WORKER_TAREFAS_DESLIGADAS não é '*' (o worker ligaria as 18 tarefas ao subir)"
  [ -n "$(find "$WORKER_ENV" -prune -perm 600)" ] || die "$WORKER_ENV legível por grupo/outros (esperava 600)"
  say "OK hoje: worker.env com WORKER_TAREFAS_DESLIGADAS=*, modo 600. $( [ -f "$API_DIR/docker-compose.yml" ] && echo "compose presente" || echo "(compose ainda não copiado: é do plano 08)")" ;;
liberar)
  [ -f "$GUARDA" ] || ( umask 077; mkdir -p "$BACKUP"; cp -p "$WORKER_ENV" "$GUARDA" ) || die "backup do worker.env"
  [ -f "$GUARDA" ] || die "sem backup do worker.env"
  grep -q '^WORKER_TAREFAS_DESLIGADAS=' "$WORKER_ENV" || die "worker.env sem a linha WORKER_TAREFAS_DESLIGADAS"
  sed -i 's/^WORKER_TAREFAS_DESLIGADAS=.*/WORKER_TAREFAS_DESLIGADAS=/' "$WORKER_ENV"
  dc up -d worker || die "compose up -d worker"
  for i in 1 2 3 4 5 6; do [ "$(docker inspect -f '{{.State.Health.Status}}' "$(dc ps -q worker)" 2>/dev/null)" = healthy ] && break; sleep 10; done
  l=$(dc exec -T worker api worker listar) || die "api worker listar"
  [ -n "$l" ] || die "listar vazio"
  ! printf '%s\n' "$l" | grep -q DESLIGADA || { printf '%s\n' "$l" | grep DESLIGADA >&2; die "há tarefa DESLIGADA"; }
  say "WORKER LIBERADO: $(printf '%s\n' "$l" | wc -l) tarefas ligadas" ;;
recuperar)
  ruim=0
  for t in $PERMITIDAS; do
    if dc exec -T worker api worker rodar "$t" --forcar >/dev/null 2>&1; then say "ok $t"; else say "FALHOU $t (anote)"; ruim=$((ruim+1)); fi
  done
  [ "$ruim" -eq 0 ] || exit 1; say "RECUPERADO: 5/5" ;;
reverter)
  [ -f "$GUARDA" ] || die "sem $GUARDA (liberar não rodou)"
  cp -p "$GUARDA" "$WORKER_ENV"; dc up -d --force-recreate worker && dc stop worker || die "recriar/parar o worker";  say "REVERTIDO: worker parado e worker.env com tudo desligado" ;;
*) sed -n '3,4p' "$0" >&2; exit 2 ;;
esac
