#!/bin/sh
# Ensaio do corte: origem (SOMENTE LEITURA) -> Postgres local descartável. Cronometra cada etapa.
# Recria o alvo do zero a cada rodada (idempotente). Apaga dump e Storage copiado no fim (dado
# pessoal e segredos), salvo --manter; também apaga se a rodada falhar ou for interrompida.
# Uso: sh ops/migracao/ensaio.sh [--manter] [--permitir-alvo-remoto] [--sem-storage] [--excluir-buckets b1,b2]
# Ambiente: ORIGEM_DATABASE_URL (obrigatória, nunca impressa); SUPABASE_URL e SUPABASE_SERVICE_KEY
# (obrigatórias, exceto com --sem-storage); ALVO_PORTA (padrão 58450); ALVO_DATABASE_URL (padrão: o
# contêiner local); ALVO_CONTAINER (padrão ensaio-alvo); ENSAIO_SAIDA (padrão ops/migracao/saida).
# Saída: 0 = tudo conferido; 1 = variável obrigatória ausente, guarda recusou, etapa falhou, ERRO de contagem,
# órfãos ou diferença de políticas/triggers (o relatório diz qual); 2 = opção inválida (uso); 3 = só divergência numérica de contagem (CONFIRA: tabela quente?), nunca "OK"; 130 = interrompido.
# Com --permitir-alvo-remoto o alvo NÃO é um contêiner: ALVO_DATABASE_URL tem de ser um banco vazio.
set -u
# o ambiente do shell não pode redirecionar psql/pg_dump/go para outro host
unset PGHOSTADDR PGSERVICE PGSERVICEFILE PGHOST PGPORT
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
# nunca aponta para produção por engano. Só se aceita URL postgres:// simples: host 127.0.0.1 (o contêiner só escuta nele; depois do
# único @ da autoridade), sem lista de hosts, sem %, e na query só sslmode= (nada de host=, hostaddr=,
# service=, nem nomes percent-encoded). A porta tem de ser a do contêiner (ALVO_PORTA).
# o nome do contêiner é apagado com docker rm -fv: só aceita ensaio-*
case "$CONT" in ensaio-*[!A-Za-z0-9_.-]*|ensaio-*) ;; *) echo "ALVO_CONTAINER tem de começar com ensaio- (recuso apagar '$CONT')" >&2; exit 1;; esac
case "$CONT" in *[!A-Za-z0-9_.-]*) echo "ALVO_CONTAINER com caracteres inválidos; recuso" >&2; exit 1;; esac
recusa() { echo "ALVO_DATABASE_URL não é local ($1); recuso (use --permitir-alvo-remoto se for de propósito)" >&2; exit 1; }
if [ "$REMOTO" != 1 ]; then
  case "$ALVO_URL" in postgres://*|postgresql://*) ;; *) recusa "só aceito URL postgres://";; esac
  case "$ALVO_URL" in *" "*|*#*) recusa "espaço ou # na URL";; esac
  REST=${ALVO_URL#*://}; AUT=${REST%%[/?]*}
  case "$AUT" in *@*@*) recusa "mais de um @";; esac
  HP=${AUT##*@}
  case "$HP" in *,*|*%*) recusa "lista de hosts ou %";; esac
  case "$HP" in 127.0.0.1|127.0.0.1:*) ;; *) recusa "host $HP";; esac
  case "$REST" in *\?*)
    set -f; IFS='&'; set -- ${REST#*\?}; unset IFS; set +f
    for p; do case "$p" in sslmode=*[!a-z-]*|sslmode=) recusa "parâmetro inválido";; sslmode=*) ;; *) recusa "só sslmode= é aceito na query";; esac; done;; esac
  case "$HP" in *:*) P=${HP#*:};; *) P=;; esac
  [ "${P:-5432}" = "$PORTA" ] || { echo "a porta da ALVO_DATABASE_URL (${P:-5432}) difere de ALVO_PORTA ($PORTA); recuso" >&2; exit 1; }
fi

if [ "$STORAGE" = 1 ]; then
  [ -n "${SUPABASE_URL:-}" ] && [ -n "${SUPABASE_SERVICE_KEY:-}" ] || { echo "defina SUPABASE_URL e SUPABASE_SERVICE_KEY (não são impressas) ou use --sem-storage" >&2; exit 1; }
fi
SAIDA=${ENSAIO_SAIDA:-$AQUI/saida}
OUT="$SAIDA/ensaio-$(date +%Y%m%d-%H%M%S)-$$"
mkdir -p "$OUT" && chmod 700 "$SAIDA" "$OUT" || { echo "não consegui criar $OUT" >&2; exit 1; }
# no EXIT preserva o código de saída; INT/TERM/HUP saem com 130 (e caem no EXIT, que limpa)
limpa() {
  s=$?; trap - EXIT INT TERM HUP
  [ "$REMOTO" = 1 ] || docker rm -fv "$CONT" >/dev/null 2>&1
  [ "$MANTER" = 1 ] || rm -rf "$OUT/dump" "$OUT/storage"
  exit $s
}
trap limpa EXIT
trap 'exit 130' INT TERM HUP

oculta() { sed -E 's#postgres(ql)?://[^ "]*#<URL>#g'; }
rel() { printf '%s\n' "$*" | tee -a "$OUT/relatorio.txt"; }
FALHAS=""; BLOQ=""; JANELA=0; JANELA6=0; CONF=""
pula() { rel "$(printf '%-30s %5s  PULADA (%s)' "$1" - "$2")"; }
# etapa NOME MODO cmd...  MODO: bloqueia (falha trava as dependentes), depende (pulada se travado), livre
etapa() {
  nome=$1; modo=$2; shift 2
  if [ -n "$BLOQ" ] && [ "$modo" != livre ]; then
    pula "$nome" "etapa anterior falhou"; return 1
  fi
  t0=$(date +%s); s=0; "$@" || s=$?; d=$(( $(date +%s) - t0 ))
  case "$nome" in 6*) JANELA6=$d;; [2-5]*) JANELA=$((JANELA + d));; esac
  if [ $s = 0 ]; then r=OK
  elif [ $s = 3 ] && [ "$CONF" = 1 ]; then r="CONFIRA ($DIF tabelas)"
  else
    r="FALHOU (saída $s)"; FALHAS="$FALHAS
  - $nome"; [ "$modo" != bloqueia ] || BLOQ=1
  fi
  rel "$(printf '%-30s %4ss  %s' "$nome" "$d" "$r")"; return $s
}

sobe_alvo() {
  if [ "$REMOTO" = 1 ]; then echo "(alvo remoto informado: nada a subir)"; return 0; fi
  docker rm -fv "$CONT" >/dev/null 2>&1
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
  cp "$OUT/dump/limpeza.json" "$OUT/limpeza.json"   # só contagens; o dump/ é apagado no fim
}
restaura() { sh "$AQUI/restaurar.sh" "$ALVO_URL" "$OUT/dump"; }
importa_usuarios() {
  s=0
  ( cd "$RAIZ/api" && DATABASE_URL="$ALVO_URL" ORIGEM_DATABASE_URL="$(printf '%s' "$ORIGEM_DATABASE_URL" | sed 's#:6543/#:5432/#')" go run ./cmd/api importar-usuarios ) > "$OUT/importar.log" 2>&1 || s=$?
  # a URL não vaza: o log guardado e o que vai para a tela são a versão oculta
  oculta < "$OUT/importar.log" > "$OUT/importar.log.tmp" && mv "$OUT/importar.log.tmp" "$OUT/importar.log"; cat "$OUT/importar.log" >&2
  return $s
}
# Só linhas DIFERE numéricas (listagem ok, nenhum ERRO) = tabela possivelmente quente: devolve 3
# (CONFIRA, o humano decide). Listagem falhou (2), linha ERRO, saída vazia ou qualquer outro status = falha.
contagens() {
  s=0; sh "$AQUI/conferir-contagens.sh" "$ORIGEM_DATABASE_URL" "$ALVO_URL" > "$OUT/contagens.txt" || s=$?
  DIF=$(grep -c DIFERE "$OUT/contagens.txt"); grep DIFERE "$OUT/contagens.txt"
  case $s in
    0) [ -s "$OUT/contagens.txt" ] || { echo "conferir-contagens não produziu saída" >&2; return 1; }
       [ "$DIF" = 0 ] || { echo "conferir-contagens saiu 0 mas há linhas DIFERE" >&2; return 1; }
       return 0;;
    1) if grep -Eq ' ERRO( |$)' "$OUT/contagens.txt"; then echo "contagem com ERRO (consulta falhou em algum lado)" >&2; return 1; fi
       [ "$DIF" != 0 ] || { echo "conferir-contagens saiu 1 sem nenhuma linha DIFERE" >&2; return 1; }
       CONF=1; return 3;;
    2) echo "conferir-contagens não conseguiu listar as tabelas da origem (saída 2)" >&2; return 2;;
    *) echo "conferir-contagens falhou (saída $s)" >&2; return $s;;
  esac
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
# O que o ensaio-local prova no Supabase de mentira, refeito contra a ORIGEM de verdade (somente leitura):
# o alvo não tem policies nem RLS, e o estado (tgenabled) de cada trigger de usuário é o mesmo origem × alvo
# (trigger desligado em produção e ligado no alvo apareceria só depois do corte).
SQL_TRG="select c.relname || '.' || t.tgname || '=' || t.tgenabled::text from pg_trigger t join pg_class c on c.oid=t.tgrelid where c.relnamespace='public'::regnamespace and not t.tgisinternal and c.relname not in ('usuarios','sessoes','goose_db_version') order by (c.relname || '.' || t.tgname || '=' || t.tgenabled::text) collate \"C\""
estrutura() {
  O=$(printf '%s' "$ORIGEM_DATABASE_URL" | sed 's#:6543/#:5432/#'); E="$OUT/estrutura.err"
  pol=$(psql "$ALVO_URL" -X -Atqc "select count(*) from pg_policies where schemaname='public'" 2> "$E") || { oculta < "$E" >&2; return 1; }
  rls=$(psql "$ALVO_URL" -X -Atqc "select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relrowsecurity" 2> "$E") || { oculta < "$E" >&2; return 1; }
  psql "$ALVO_URL" -X -Atqc "$SQL_TRG" > "$OUT/triggers-alvo.txt" 2> "$E" || { oculta < "$E" >&2; return 1; }
  printf 'begin read only;\n%s;\ncommit;\n' "$SQL_TRG" | psql "$O" -X -Atq 2> "$E" | grep -vE '^(BEGIN|COMMIT)$' > "$OUT/triggers-origem.txt"
  [ "$(cat "$E" | wc -c | tr -d ' ')" = 0 ] || { oculta < "$E" >&2; echo "consulta de triggers na origem falhou" >&2; return 1; }
  s=0; diff "$OUT/triggers-origem.txt" "$OUT/triggers-alvo.txt" > "$OUT/triggers.diff" || s=1
  TRG=$(wc -l < "$OUT/triggers-alvo.txt" | tr -d ' ')
  [ "$pol" = 0 ] || { echo "o alvo tem $pol policies (deveria ter 0)" >&2; s=1; }
  [ "$rls" = 0 ] || { echo "o alvo tem $rls tabelas com RLS ligada (deveria ter 0)" >&2; s=1; }
  [ $s = 0 ] || { echo "triggers origem (<) × alvo (>):" >&2; cat "$OUT/triggers.diff" >&2; return 1; }
}
storage() {
  s=0; node "$AQUI/copiar-storage.mjs" --destino "$OUT/storage" ${EXCL:+--excluir "$EXCL"} > "$OUT/storage.txt" 2>&1 || s=$?
  cat "$OUT/storage.txt"
  [ $s = 0 ] || return $s
  grep -q '^total:' "$OUT/storage.txt" || { echo "copiar-storage terminou sem a linha de total" >&2; return 1; }
}

DUMP_BYTES=""; DIF="?"; ORF="?"; TRG="?"
rel "ensaio $(date '+%F %T'): origem somente leitura, alvo $(printf '%s' "$ALVO_URL" | sed -E 's#//.*@#//***@#'), storage: $([ "$STORAGE" = 1 ] && echo "sim${EXCL:+ (excluindo $EXCL)}" || echo não)"
# esquenta o cache do Go (sem cronometrar) para a compilação não entrar nas etapas 3 e 4
( cd "$RAIZ/api" && go build -o /dev/null ./cmd/api ) || { echo "go build falhou" >&2; exit 1; }
etapa "1. subir Postgres alvo"     bloqueia sobe_alvo
etapa "2. dump (completo + schema)" bloqueia dump
etapa "3. restaurar"               bloqueia restaura
etapa "4. importar usuários"       depende  importa_usuarios; s4=$?
etapa "5. conferir contagens"      depende  contagens
if [ $s4 = 0 ] || [ -n "$BLOQ" ]; then etapa "5b. conferir órfãos (FKs)" depende orfaos
else pula "5b. conferir órfãos (FKs)" "importar usuários falhou"; fi
etapa "5c. policies/RLS/triggers" depende estrutura
if [ "$STORAGE" = 1 ]; then etapa "6. copiar Storage" livre storage; else pula "6. copiar Storage" "--sem-storage"; fi

MB=$(awk -v b="${DUMP_BYTES:-0}" 'BEGIN { printf "%.1f", b / 1e6 }')
rel "----"
rel "volume: dump ${MB} MB; storage: $(grep '^total:' "$OUT/storage.txt" 2>/dev/null || echo 'n/d (pulado ou falhou)')"
rel "limpeza do schema (contagens): $(cat "$OUT/limpeza.json" 2>/dev/null || echo n/d)"
rel "importar-usuarios: $(grep 'usuários importados' "$OUT/importar.log" 2>/dev/null | sed -E 's/^.*msg=//' || true)"
rel "tabelas com contagem diferente (DIFERE): $DIF (ver $OUT/contagens.txt; tabela quente pode crescer durante o dump)"
rel "FKs para usuarios conferidas: $(wc -l < "$OUT/orfaos.txt" 2>/dev/null | tr -d ' ') (inclui as de sessoes; em produção o levantamento espera 23 = 21 + 2 em sessoes); com órfãos: $ORF (ver $OUT/orfaos.txt; resolver antes do corte)"
rel "triggers de usuário comparados origem × alvo: $TRG (diferenças em $OUT/triggers.diff)"
if [ "$STORAGE" = 1 ]; then
  rel "JANELA de manutenção estimada SEM Storage (etapas 2 a 5c): ${JANELA}s"
  rel "JANELA COM Storage (etapas 2 a 6): $((JANELA + JANELA6))s (no corte o Storage é rsync incremental, spec §7 e §9; aqui a etapa 6 é a cópia completa)"
else
  rel "JANELA de manutenção estimada SEM Storage (etapas 2 a 5c): ${JANELA}s; com Storage: n/d (--sem-storage)"
fi
rel "relatório em $OUT/relatorio.txt"
if [ -n "$FALHAS" ]; then
  rel "ENSAIO FALHOU, etapas com problema:$FALHAS"; exit 1
fi
if [ -n "$CONF" ]; then
  rel "ENSAIO CONCLUÍDO COM DIVERGÊNCIAS A CONFERIR (contagens: $DIF tabelas; ver $OUT/contagens.txt)"; exit 3
fi
rel "ENSAIO OK"
