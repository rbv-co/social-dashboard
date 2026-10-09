#!/bin/sh
# Ensaio do corte: origem (SOMENTE LEITURA) -> Postgres local descartável. Cronometra cada etapa.
# Recria o alvo do zero a cada rodada (idempotente). Apaga dump e Storage copiado no fim (dado
# pessoal e segredos), salvo --manter; também apaga se a rodada falhar ou for interrompida.
# Uso: sh ops/migracao/ensaio.sh [--manter] [--permitir-alvo-remoto] [--sem-storage] [--excluir-buckets b1,b2]
# Ambiente: ORIGEM_DATABASE_URL (obrigatória, nunca impressa); SUPABASE_URL e SUPABASE_SERVICE_KEY
# (obrigatórias, exceto com --sem-storage); ALVO_PORTA (padrão 58450); ALVO_DATABASE_URL (padrão: o
# contêiner local); ALVO_CONTAINER (padrão ensaio-alvo); ENSAIO_SAIDA (padrão ops/migracao/saida).
# Saída: 0 = tudo conferido; 1 = alguma etapa ou conferência falhou (o relatório diz qual); 2 = uso.
# Com --permitir-alvo-remoto o alvo NÃO é um contêiner: ALVO_DATABASE_URL tem de ser um banco vazio.
set -u
umask 077   # dump, Storage e relatório: 600/700
AQUI=$(cd "$(dirname "$0")" && pwd)
RAIZ=$(cd "$AQUI/../.." && pwd)
MANTER=0; REMOTO=0; STORAGE=1; EXCL=""
while [ $# -gt 0 ]; do case "$1" in
  --manter) MANTER=1;; --permitir-alvo-remoto) REMOTO=1;; --sem-storage) STORAGE=0;;
  --excluir-buckets) [ $# -ge 2 ] || { echo "--excluir-buckets pede uma lista (b1,b2)" >&2; exit 2; }; shift; EXCL=$1;;
  *) echo "opção desconhecida: $1" >&2; exit 2;; esac; shift; done
[ "$STORAGE" = 1 ] || [ -z "$EXCL" ] || { echo "--excluir-buckets não combina com --sem-storage" >&2; exit 2; }

[ -n "${ORIGEM_DATABASE_URL:-}" ] || { echo "defina ORIGEM_DATABASE_URL (não é impresso)" >&2; exit 1; }
PORTA=${ALVO_PORTA:-58450}; CONT=${ALVO_CONTAINER:-ensaio-alvo}
ALVO_URL=${ALVO_DATABASE_URL:-postgres://postgres:x@127.0.0.1:$PORTA/postgres?sslmode=disable}
# nunca aponta para produção por engano: o host do alvo (depois do último @ da autoridade) tem de ser local
if [ "$REMOTO" != 1 ]; then
  AUT=${ALVO_URL#*://}; AUT=${AUT%%/*}; HP=${AUT##*@}
  case "$HP" in localhost|localhost:*|127.0.0.1|127.0.0.1:*|\[::1\]|\[::1\]:*) ;;
    *) echo "ALVO_DATABASE_URL não é local; recuso (use --permitir-alvo-remoto se for de propósito)" >&2; exit 1 ;; esac
  case "$ALVO_URL" in *host=*|*hostaddr=*) echo "ALVO_DATABASE_URL não é local (parâmetro host= na URL); recuso" >&2; exit 1 ;; esac
fi

if [ "$STORAGE" = 1 ]; then
  [ -n "${SUPABASE_URL:-}" ] && [ -n "${SUPABASE_SERVICE_KEY:-}" ] || { echo "defina SUPABASE_URL e SUPABASE_SERVICE_KEY (não são impressas) ou use --sem-storage" >&2; exit 1; }
fi
SAIDA=${ENSAIO_SAIDA:-$AQUI/saida}
OUT="$SAIDA/ensaio-$(date +%Y%m%d-%H%M%S)-$$"
mkdir -p "$OUT" && chmod 700 "$SAIDA" "$OUT" || { echo "não consegui criar $OUT" >&2; exit 1; }
# no EXIT preserva o código de saída; INT/TERM saem com 130 (e caem no EXIT, que limpa)
limpa() {
  s=$?; trap - EXIT INT TERM
  [ "$REMOTO" = 1 ] || docker rm -f "$CONT" >/dev/null 2>&1
  [ "$MANTER" = 1 ] || rm -rf "$OUT/dump" "$OUT/storage"
  exit $s
}
trap limpa EXIT
trap 'exit 130' INT TERM

oculta() { sed -E 's#postgres(ql)?://[^ "]*#<URL>#g'; }
rel() { printf '%s\n' "$*" | tee -a "$OUT/relatorio.txt"; }
FALHAS=""; BLOQ=""; JANELA=0
# etapa NOME MODO cmd...  MODO: bloqueia (falha trava as dependentes), depende (pulada se travado), livre
etapa() {
  nome=$1; modo=$2; shift 2
  if [ -n "$BLOQ" ] && [ "$modo" != livre ]; then
    rel "$(printf '%-30s %5s  PULADA (etapa anterior falhou)' "$nome" -)"; return 1
  fi
  t0=$(date +%s); s=0; "$@" || s=$?; d=$(( $(date +%s) - t0 ))
  case "$nome" in [2-6]*) JANELA=$((JANELA + d));; esac
  if [ $s = 0 ]; then r=OK; else
    r="FALHOU (saída $s)"; FALHAS="$FALHAS
  - $nome"; [ "$modo" != bloqueia ] || BLOQ=1
  fi
  rel "$(printf '%-30s %4ss  %s' "$nome" "$d" "$r")"; return $s
}

sobe_alvo() {
  if [ "$REMOTO" = 1 ]; then echo "(alvo remoto informado: nada a subir)"; return 0; fi
  docker rm -f "$CONT" >/dev/null 2>&1
  if command -v nc >/dev/null 2>&1 && nc -z 127.0.0.1 "$PORTA" >/dev/null 2>&1; then
    echo "a porta $PORTA já está ocupada; escolha outra com ALVO_PORTA=..." >&2; return 1
  fi
  docker run -d --rm --name "$CONT" -e POSTGRES_PASSWORD=x -p "127.0.0.1:$PORTA:5432" postgres:17 >/dev/null || { echo "docker run falhou (porta $PORTA ocupada ou Docker parado)" >&2; return 1; }
  for i in $(seq 60); do docker exec "$CONT" pg_isready -h 127.0.0.1 -U postgres >/dev/null 2>&1 && break; sleep 1; done
  # pg_isready responde antes da reinicialização final do entrypoint; espera um psql de verdade
  for i in $(seq 60); do psql "$ALVO_URL" -X -Atqc 'select 1' >/dev/null 2>&1 && return 0; sleep 1; done
  echo "alvo local não ficou pronto" >&2; return 1
}
dump() {
  sh "$AQUI/dump-supabase.sh" "$ORIGEM_DATABASE_URL" "$OUT/dump" || return $?
  DUMP_BYTES=$(wc -c < "$OUT/dump/completo.dump" | tr -d ' ')
}
restaura() { sh "$AQUI/restaurar.sh" "$ALVO_URL" "$OUT/dump"; }
importa_usuarios() {
  s=0
  ( cd "$RAIZ/api" && DATABASE_URL="$ALVO_URL" ORIGEM_DATABASE_URL="$(printf '%s' "$ORIGEM_DATABASE_URL" | sed 's#:6543/#:5432/#')" go run ./cmd/api importar-usuarios ) > "$OUT/importar.log" 2>&1 || s=$?
  # a URL não vaza: o log guardado e o que vai para a tela são a versão oculta
  oculta < "$OUT/importar.log" > "$OUT/importar.log.tmp" && mv "$OUT/importar.log.tmp" "$OUT/importar.log"; cat "$OUT/importar.log" >&2
  return $s
}
# DIFERE = diferença real ou erro (confira: tabela quente durante o dump?); saída ≠ 0 ou vazia = falha
contagens() {
  s=0; sh "$AQUI/conferir-contagens.sh" "$ORIGEM_DATABASE_URL" "$ALVO_URL" > "$OUT/contagens.txt" || s=$?
  DIF=$(grep -c DIFERE "$OUT/contagens.txt"); grep DIFERE "$OUT/contagens.txt"
  [ $s = 0 ] || { echo "conferir-contagens saiu com $s" >&2; return $s; }
  [ -s "$OUT/contagens.txt" ] || { echo "conferir-contagens não produziu saída" >&2; return 1; }
  [ "$DIF" = 0 ]
}
# órfão = FK para usuarios sem pai depois do importar-usuarios (usuário apagado ainda referenciado):
# resolver antes do corte
orfaos() {
  s=0; sh "$AQUI/conferir-orfaos.sh" "$ALVO_URL" > "$OUT/orfaos.txt" || s=$?
  ORF=$(grep -cv ' 0$' "$OUT/orfaos.txt"); grep -v ' 0$' "$OUT/orfaos.txt"
  [ $s = 0 ] || { echo "conferir-orfaos saiu com $s" >&2; return $s; }
  [ -s "$OUT/orfaos.txt" ] || { echo "conferir-orfaos não produziu saída" >&2; return 1; }
  [ "$ORF" = 0 ]
}
storage() {
  [ "$STORAGE" = 1 ] || { echo "(storage pulado por --sem-storage)"; return 0; }
  s=0; node "$AQUI/copiar-storage.mjs" --destino "$OUT/storage" ${EXCL:+--excluir "$EXCL"} > "$OUT/storage.txt" 2>&1 || s=$?
  cat "$OUT/storage.txt"
  [ $s = 0 ] || return $s
  grep -q '^total:' "$OUT/storage.txt" || { echo "copiar-storage terminou sem a linha de total" >&2; return 1; }
}

DUMP_BYTES=""; DIF="?"; ORF="?"
rel "ensaio $(date '+%F %T'): origem somente leitura, alvo $(printf '%s' "$ALVO_URL" | sed -E 's#//[^@]*@#//***@#'), storage: $([ "$STORAGE" = 1 ] && echo "sim${EXCL:+ (excluindo $EXCL)}" || echo não)"
etapa "1. subir Postgres alvo"     bloqueia sobe_alvo
etapa "2. dump (completo + schema)" bloqueia dump
etapa "3. restaurar"               bloqueia restaura
etapa "4. importar usuários"       depende  importa_usuarios
etapa "5. conferir contagens"      depende  contagens
etapa "5b. conferir órfãos (FKs)"  depende  orfaos
etapa "6. copiar Storage"          livre    storage

MB=$(awk -v b="${DUMP_BYTES:-0}" 'BEGIN { printf "%.1f", b / 1e6 }')
rel "----"
rel "volume: dump ${MB} MB; storage: $(grep '^total:' "$OUT/storage.txt" 2>/dev/null || echo 'n/d (pulado ou falhou)')"
rel "tabelas com contagem diferente (DIFERE): $DIF (ver $OUT/contagens.txt; tabela quente pode crescer durante o dump)"
rel "FKs para usuarios com órfãos: $ORF (ver $OUT/orfaos.txt; resolver antes do corte)"
rel "janela de manutenção estimada (soma das etapas 2 a 6): ${JANELA}s; relatório em $OUT/relatorio.txt"
if [ -n "$FALHAS" ]; then
  rel "ENSAIO FALHOU, etapas com problema:$FALHAS"; exit 1
fi
rel "ENSAIO OK"
