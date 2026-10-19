#!/bin/sh
# Pré-voo da JANELA (plano 11; roteiro P1 a P3 e aviso P14), SÓ LEITURA: junta o preflight-vps.sh (plano 08) com o que o Mac e a
# VPS precisam estar na hora de começar o T-32. Nunca escreve em produção nem imprime segredo.
# Uso: sh ops/virada/preflight-janela.sh        (VPS, SB, ENV_COLETOR, TUNEL=0 como nos outros scripts)
# Saída: linhas `OK`, `FALTA` (bloqueia), `DONO` (passo do dono; não bloqueia) e `AVISO`. Última linha:
#   `PREFLIGHT JANELA OK` (exit 0) ou `PREFLIGHT JANELA: N item(ns) faltando` (exit 1).
set -u
export LC_ALL=C
RAIZ=$(cd "$(dirname "$0")/../.." && pwd)
VPS=${VPS:-op}
SSH=${SSH:-ssh -o BatchMode=yes -o ConnectTimeout=15}
SAIDA=$(mktemp); trap 'rm -f "$SAIDA"' EXIT
ok() { echo "OK $*" >> "$SAIDA"; }
falta() { echo "FALTA $*" >> "$SAIDA"; }
dono() { echo "DONO $*" >> "$SAIDA"; }
aviso() { echo "AVISO $*" >> "$SAIDA"; }
. "$RAIZ/ops/migracao/oculta.sh"
# o ensaio vale para a main de agora se o que ele exercita não mudou entre o commit dele e a main (a main anda com docs e scripts da janela)
mesma_base() { git -C "$RAIZ" diff --quiet "$1" origin/main -- api coletor ops/migracao ops/vps ops/virada/supabase.sh ops/virada/delta.sh ops/virada/papel-da-api.sql 2> /dev/null; }

# 0. ferramentas do Mac
v=$(psql --version 2> /dev/null | sed -E 's/[^0-9]*([0-9]+)\.([0-9]+).*/\1 \2/')
set -- $v
if [ "${1:-0}" -gt 16 ] || { [ "${1:-0}" = 16 ] && [ "${2:-0}" -ge 10 ]; }; then ok "0 psql $1.$2 (>= 16.10: lê os dumps com restrict)"; else falta "0 psql do Mac < 16.10 (PATH=/opt/homebrew/opt/postgresql@17/bin:\$PATH)"; fi
for t in go node gh ssh shasum; do command -v "$t" > /dev/null 2>&1 && ok "0 $t" || falta "0 $t não encontrado"; done

# 1. repositório: o que roda a janela é a origin/main de agora
git -C "$RAIZ" fetch -q origin 2> /dev/null || aviso "1 git fetch falhou (a comparação com a main pode estar velha)"
MAIN=$(git -C "$RAIZ" rev-parse origin/main 2> /dev/null); HEAD=$(git -C "$RAIZ" rev-parse HEAD 2> /dev/null)
CURTO=$(printf '%.8s' "$MAIN")
if [ -n "$MAIN" ] && git -C "$RAIZ" diff --quiet origin/main -- ops api coletor src .github 2> /dev/null; then ok "1 ops/, api/, coletor/, src/ e .github/ deste checkout = origin/main ($CURTO)"; else falta "1 este checkout difere da origin/main em ops/api/coletor/src/.github: rode a janela de um worktree em origin/main"; fi
[ -s "$RAIZ/coletor/.env" ] && ok "1 coletor/.env presente (SB e SUPABASE_URL)" || falta "1 coletor/.env ausente (copiar do checkout principal)"

# 2. P1: ensaios da véspera (rodados hoje, na main de agora)
R=$(ls -td "$RAIZ"/ops/migracao/saida/ensaio-vps-*/ 2> /dev/null | head -n 1)
if [ -n "$R" ] && grep -q '^ENSAIO DA VIRADA OK' "$R/relatorio.txt" 2> /dev/null; then
  c=$(sed -n '1s/.*commit //p' "$R/relatorio.txt")
  if case "$MAIN" in "$c"*) true ;; *) false ;; esac; then ok "2/P1 ENSAIO DA VIRADA OK na main de agora ($c)"
  elif mesma_base "$c"; then ok "2/P1 ENSAIO DA VIRADA OK ($c; o que ele exercita não mudou até a main $CURTO)"
  else falta "2/P1 o ENSAIO DA VIRADA OK é do commit $c e a main $CURTO mudou api/coletor/ops: repetir"; fi
else falta "2/P1 sem relatório ENSAIO DA VIRADA OK em ops/migracao/saida/ensaio-vps-*"; fi
L=$RAIZ/ops/migracao/saida/ensaio-local.ok
if [ -s "$L" ]; then
  c=$(awk '{print $NF}' "$L")
  if case "$MAIN" in "$c"*) true ;; *) false ;; esac || mesma_base "$c"; then ok "2/P1 ENSAIO LOCAL OK (commit $(printf '%.8s' "$c"))"; else falta "2/P1 o ENSAIO LOCAL OK é do commit $(printf '%.8s' "$c") e a main $CURTO mudou: repetir"; fi
else falta "2/P1 sem ensaio-local.ok (rode: sh ops/virada/ensaio-local.sh)"; fi

# 3. Supabase (só leitura): P2 e acesso
SB=${SB:-$(sed -n 's/^DATABASE_URL=//p' "${ENV_COLETOR:-$RAIZ/coletor/.env}" 2> /dev/null | head -n 1 | tr -d "'\"" | sed 's#:6543/#:5432/#')}
if [ -n "$SB" ]; then
  r=$(psql "$SB" -XAtc "select count(*) || '|' || count(*) filter (where active) from cron.job" 2>&1 | oculta | tail -n 1)
  case $r in
    [0-9]*"|"[0-9]*) a=${r%|*}; b=${r#*|}; if [ "$a" = "$b" ]; then ok "3/P2 pg_cron: $a jobs, $b ativos$( [ "$a" = 23 ] || echo " (o roteiro dizia 23; o supabase.sh desliga o que houver)")"; else aviso "3/P2 pg_cron: $a jobs, só $b ativos (alguém desligou algum? o desligar-cron só guarda e religa os ativos)"; fi ;;
    *) falta "3/P2 não consegui ler o pg_cron do Supabase: $r" ;;
  esac
  r=$(psql "$SB" -XAtc "select count(*) from cron.job where jobname = 'push-vendas-22h'" 2> /dev/null)
  [ "$r" = 1 ] && ok "3/P2 job push-vendas-22h existe (o T-32 confere a execução das 22h)" || falta "3/P2 job push-vendas-22h não existe (o T-32 não tem o que conferir)"
else falta "3 sem SB (coletor/.env sem DATABASE_URL)"; fi

# 4. VPS: o que a janela chama
$SSH "$VPS" sh -s > "$SAIDA.vps" 2>&1 << 'NO_ALVO' || true
V=/root/virada
ok() { echo "OK $*"; }; falta() { echo "FALTA $*"; }; aviso() { echo "AVISO $*"; }
echo "FRONT $(cat $V/front-sha.txt 2> /dev/null)"
echo "CLONE $(git -C /opt/robos/social-dashboard rev-parse HEAD 2> /dev/null)"
echo "CHATWOOT $(grep -E '^CRM_EVENT_WEBHOOK_URL=' /opt/chatwoot/.env | sed -E 's#^[^=]*=##; s#(://[^/?]+).*#\1#')"
CH=/etc/nginx/snippets/central-chatwoot.conf
if [ ! -e $CH ]; then echo "MODO nenhum"; elif grep -q 127.0.0.1:8099 $CH; then echo "MODO spool"; elif grep -q 127.0.0.1:8080 $CH; then echo "MODO go"; else echo "MODO edge"; fi
( cd $V && sha256sum -c MANIFESTO.sha256 > /dev/null 2>&1 ) && ok "4 MANIFESTO.sha256 do pacote (plano 10) confere" || falta "4 MANIFESTO.sha256 não confere (instalar-pacote.sh de novo, da main)"
[ -s $V/MANIFESTO-front.sha256 ] && ( cd $V && sha256sum -c MANIFESTO-front.sha256 > /dev/null 2>&1 ) && ok "4 MANIFESTO-front.sha256 (plano 09) confere" || falta "4 MANIFESTO-front.sha256 não confere"
for f in t10-nginx.sh t11-front.sh t14-core-go.sh t16-chatwoot-go.sh t17-pdv.sh t17-robos.sh t19-vessel.sh t20-worker.sh t29-vps.sh spool-nginx.sh core-destinos.sh; do [ -s $V/$f ] || falta "4 falta $V/$f"; done
ok "4 scripts da janela presentes em $V"
[ -s /root/virada/troca-hora.txt ] && aviso "4 $V/troca-hora.txt já existe (a janela já passou do T+10 antes?)"
[ ! -e /root/api-db/PRODUCAO ] && ok "4 api-db sem PRODUCAO (o T+1 pode recriar)" || falta "4 /root/api-db/PRODUCAO existe: o T+1 recusa"
systemctl is-active cartoes-ean > /dev/null 2>&1 && ok "4 cartoes-ean ativo (o T-29 para)" || aviso "4 cartoes-ean não está ativo"
[ -e /etc/cron.d/robos-social-dashboard ] && ok "4 cron.d dos robôs presente (o T-29 guarda e tira)" || aviso "4 cron.d dos robôs ausente (Fase A já feita?)"
systemctl is-active virada-spool > /dev/null 2>&1 && aviso "4 virada-spool já está ativo" || ok "4 virada-spool parado (o T-2 liga)"
ls /var/lib/api/arquivos > /dev/null 2>&1 && ok "4 /var/lib/api/arquivos" || falta "4 /var/lib/api/arquivos"
docker image inspect "central-api:$(sed -n 's/^API_VERSAO=//p' /root/api/.env)" > /dev/null 2>&1 && ok "4 imagem central-api do /root/api/.env" || falta "4 imagem central-api ausente"
NO_ALVO
VF=$(sed -n 's/^FRONT //p' "$SAIDA.vps" | sed 's/-api$//'); VC=$(sed -n 's/^CLONE //p' "$SAIDA.vps"); VH=$(sed -n 's/^CHATWOOT //p' "$SAIDA.vps"); VM=$(sed -n 's/^MODO //p' "$SAIDA.vps")
grep -E '^(OK|FALTA|AVISO) ' "$SAIDA.vps" >> "$SAIDA"
if [ -z "$VF" ]; then falta "4 sem /root/virada/front-sha.txt (ssh falhou?)"; else case "$MAIN" in "$VF"*) ok "4 front preparado = origin/main ($VF)" ;; *) falta "4 o front preparado ($VF) não é o da origin/main ($CURTO): na VPS, bash /root/virada/t11-front.sh preparar <sha>" ;; esac; fi
case "$MAIN" in "$VC") ok "4 /opt/robos/social-dashboard (VPS) = origin/main" ;; *) falta "4 /opt/robos/social-dashboard na VPS ($(printf '%.8s' "$VC")) não é a origin/main ($CURTO): git pull --ff-only lá (os robôs e o T+8 usam esse clone)" ;; esac
case "$VH" in *central.rbvcompany.com*) ok "4/P17 Chatwoot já fala com a central (modo das rotas: $VM): o spool do T-2 recebe" ;; *) falta "4/P17 o Chatwoot aponta DIRETO para o Supabase ($VH): sem o P17 (janela.sh p17, com ok da orquestradora) os eventos do Chatwoot de T-30 a T+16 SE PERDEM e o spool não recebe nada" ;; esac

# 5. Actions: conta certa e workflows (sem trocar de conta)
if command -v gh > /dev/null 2>&1; then
  n=$(git -C "$RAIZ" grep -l SUPABASE_SERVICE_KEY origin/main -- .github/workflows 2> /dev/null | wc -l | tr -d ' ')
  gh workflow list -R rbv-co/social-dashboard > /dev/null 2>&1 && ok "5 gh acessa rbv-co/social-dashboard ($n workflows citam SUPABASE_SERVICE_KEY; o T-29 desliga os ativos)" \
    || falta "5 gh não acessa rbv-co/social-dashboard (conta ativa errada? NUNCA gh auth switch: use GH_TOKEN=\$(gh auth token -u brenoov))"
fi

# 6. P14 (DONO) e a hora
dono "P14 aviso da janela: Central e páginas da Vessel fora do ar das 22h40 às 23h40 (loja fechada, PDV parado)"
aviso "hora agora: $(date '+%H:%M') (T = ${T_JANELA:-22:40})"

cat "$SAIDA"
rm -f "$SAIDA.vps"
# o preflight-vps.sh (plano 08): P4 a P13 e o api-db
echo "--- preflight-vps.sh"
PV=$(sh "$RAIZ/ops/virada/preflight-vps.sh" 2>&1); PVRC=$?
printf '%s\n' "$PV" | grep -vE '^OK ' ; printf '%s\n' "$PV" | grep -c '^OK ' | sed 's/^/(OK do preflight-vps: /; s/$/)/'
N=$(grep -c '^FALTA ' "$SAIDA" || true)
[ "$PVRC" = 0 ] || N=$((N + 1))
if [ "$N" = 0 ]; then echo "PREFLIGHT JANELA OK"; else echo "PREFLIGHT JANELA: $N item(ns) faltando"; exit 1; fi
