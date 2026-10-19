#!/bin/bash
# Prova (sem VPS, sem Supabase, sem banco) do motor do ops/virada/janela.sh: ordem e requisitos, estado, OK/FALHOU -> rollback, `pular`,
# repetição, --dry, rollback A, e que o segredo (a senha da URL do Supabase) nunca aparece na saída nem no log. ssh, psql e os scripts
# dos planos 01/08-10 são falsos (numa árvore V temporária); janela.sh, oculta.sh e vps-b1.sh são os de verdade.
set -eu
AQUI=$(cd "$(dirname "$0")" && pwd); RAIZ=$(cd "$AQUI/../.." && pwd)
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
fail() { echo "FALHOU: $*"; exit 1; }
SEGREDO=SEGREDOTESTE123

# árvore V falsa: janela.sh e o que ele lê de verdade; o resto são stubs que dizem o que o script real diria
FV=$T/v; mkdir -p "$FV/ops/virada/janela" "$FV/ops/migracao" "$FV/coletor" "$T/bin"
cp "$AQUI/janela.sh" "$AQUI/verifica-virada.sh" "$FV/ops/virada/"; cp "$AQUI/janela/vps-b1.sh" "$FV/ops/virada/janela/"; cp "$RAIZ/ops/migracao/oculta.sh" "$FV/ops/migracao/"
stub() { printf '#!/bin/sh\n%s\n' "$2" > "$FV/ops/virada/$1"; }
stub supabase.sh 'echo "supabase.sh $1 (url $2)" >> "$FAKE_LOG"; case "$1" in
  desligar-cron) mkdir -p "$3"; echo x > "$3/cron-antes.tsv"; echo "jobs: 23, ativos antes: 23"; echo "pg_cron: 0 jobs ativos (rode em-andamento)";;
  em-andamento) printf "0\t0\t900\n";;
  congelar) mkdir -p "$3"; echo x > "$3/acl-antes.tsv"; echo "foto da ACL: 10 linhas; reversão: 4 GRANTs"; echo "CONGELADO: x";;
  escritas) echo "foto 1 das escritas gravada (3 tabelas)";;
  descongelar) echo "ACL igual à de antes (10 linhas)";; esac; exit ${FAKE_RC_SUPABASE:-0}'
stub core-destinos.sh 'echo "core-destinos $*" >> "$FAKE_LOG"; case "$1" in janela) echo "ok: Core segurando os destinos do Supabase desde 2026-10-20 01:30:00 UTC";; entregas-desde) printf "%b" "${FAKE_CORE:-}";; *) echo "ok $1";; esac'
stub spool-liga.sh 'echo spool-liga >> "$FAKE_LOG"; echo "spool no ar: 127.0.0.1:8099"'
stub spool-desliga.sh 'echo "spool-desliga $1" >> "$FAKE_LOG"; echo "ok: spool desligado; rotas do Chatwoot -> $1"'
stub spool-nginx.sh 'echo "spool-nginx $1" >> "$FAKE_LOG"; echo ok'
stub spool-replay.sh 'echo "spool-replay $1" >> "$FAKE_LOG"; echo "pendentes 0"'
stub janela/t29-fase-a.sh 'echo "FASE A (robôs + Actions) OK"'
stub janela/t29-desfazer.sh 'echo "t29-desfazer" >> "$FAKE_LOG"'
cat > "$T/bin/psql" <<'X'
#!/bin/sh
echo "psql $*" >> "$FAKE_LOG"; echo "${FAKE_PSQL:-}"
X
cat > "$T/fakessh" <<'X'
#!/bin/sh
echo "ssh $*" >> "$FAKE_LOG"
case "$*" in
  *"bash -s -- host-chatwoot"*) cat > /dev/null; echo "${FAKE_CHATWOOT:-https://central.rbvcompany.com}";;
  *"bash -s -- modo-chatwoot"*) cat > /dev/null; echo "${FAKE_MODO:-edge}";;
  *"bash -s -- fumaca"*) cat > /dev/null; echo "objeto publico/x.png HTTP 200; fumaça OK";;
  *"bash -s -- v8-chatwoot"*) cat > /dev/null; printf "%b" "${FAKE_CW:-2xx 0\\nnao-2xx 0\\n}";;
  *"bash -s -- v8"*) cat > /dev/null; printf "%b" "${FAKE_V8:-}"; exit ${FAKE_V8_RC:-0};;
  *"bash -s -- parar"*) cat > /dev/null; echo "api e worker parados";;
  *"bash -s --"*) cat > /dev/null; echo "ok-fake";;
  *"grep -c central-api.conf"*) echo "${FAKE_NGINX:-0}";;
  *"grep -c ^SAIU_DO_SUPABASE"*) echo 0;;
  *) echo "fake: $*";;
esac
X
chmod +x "$FV"/ops/virada/*.sh "$FV"/ops/virada/janela/*.sh "$T/bin/psql" "$T/fakessh"
export FAKE_LOG=$T/chamadas.log; : > "$FAKE_LOG"
export PATH="$T/bin:$PATH" SSH="$T/fakessh" V="$FV" D="$T/D" DATA=20261019 SB="postgres://postgres:$SEGREDO@db.exemplo.supabase.co:5432/postgres" HOME="$T"
J="sh $FV/ops/virada/janela.sh"

# 1. lista traz os 35 passos do plano (34 + v8-espera do plano 12)
n=$($J lista | tail -n +2 | wc -l | tr -d ' '); [ "$n" = 35 ] || fail "esperava 35 passos, vieram $n"
for id in t-32 t-30-supabase t-30-core t-29 t-1 t+0 t+0.5 t+1 t+7-papeis t+7-clone t+8-hosts t+8-api t+8-storage t+9-conferir t+9-escritas t+9-fumaca t+9b t+10-nginx t+11 t+14 t+16 t+17-pdv t+17-site t+17-robos t+17-actions t+19 t+20 t+21; do
  $J lista | awk '{print $1}' | grep -qx -- "$id" || fail "lista sem $id"
done

# 2. requisito: t-30-supabase sem t-32 é BLOQUEADO (3) e não executa nada
set +e; $J t-30-supabase > "$T/o" 2>&1; rc=$?; set -e
[ $rc = 3 ] && grep -q 'BLOQUEADO: t-30-supabase precisa de t-32' "$T/o" || fail "requisito não bloqueou ($rc): $(cat "$T/o")"
! grep -q 'supabase.sh' "$FAKE_LOG" || fail "executou apesar do bloqueio"

# 3. t-32: 'velho' = FALHOU -> esperar; 'recente' = OK e grava estado; repetir não executa de novo
set +e; FAKE_PSQL='succeeded|velho' $J t-32 > "$T/o" 2>&1; rc=$?; set -e
[ $rc = 1 ] && tail -n 1 "$T/o" | grep -q '^FALHOU -> esperar e repetir' || fail "t-32 velho: $rc $(tail -n 2 "$T/o")"
FAKE_PSQL='succeeded|recente' $J t-32 > "$T/o" 2>&1 || fail "t-32 recente: $(cat "$T/o")"; [ "$(tail -n 1 "$T/o")" = OK ] || fail "t-32 sem OK"
c1=$(grep -c psql "$FAKE_LOG"); FAKE_PSQL='x' $J t-32 > "$T/o" 2>&1; [ "$(grep -c psql "$FAKE_LOG")" = "$c1" ] && grep -q 'já está OK' "$T/o" || fail "repetiu t-32 sem REPETIR"
[ "$($J status | grep -c '^OK ')" = 1 ] || fail "status não mostra 1 passo OK"

# 4. cadeia até o congelamento, com as conferências de texto
for p in t-30-supabase t-30-core t-29 t-28 t-1; do FAKE_PSQL= $J $p > "$T/o" 2>&1 || fail "$p: $(cat "$T/o")"; done
grep -q 'desligar-cron' "$FAKE_LOG" && grep -q 'core-destinos janela' "$FAKE_LOG" || fail "não chamou supabase.sh/core-destinos"
$J t+0 > "$T/o" 2>&1 || fail "t+0: $(cat "$T/o")"
ATRASO_FOTO=0 $J t+0.5 > "$T/o" 2>&1 || fail "t+0.5: $(cat "$T/o")"

# 5. t+0 falhando = FALHOU -> rollback A (e o estado fica FALHOU); t-2 com o Chatwoot direto no Supabase falha avisando
set +e; REPETIR=1 FAKE_RC_SUPABASE=1 $J t+0 > "$T/o" 2>&1; rc=$?; set -e
[ $rc = 1 ] && tail -n 1 "$T/o" | grep -q '^FALHOU -> rollback A' || fail "t+0 com falha: $rc $(tail -n 2 "$T/o")"
set +e; FAKE_CHATWOOT=https://kounqtdoioootxqegkij.supabase.co $J t-2 > "$T/o" 2>&1; rc=$?; set -e
[ $rc = 1 ] && grep -q 'P17 não feito' "$T/o" || fail "t-2 sem P17 devia falhar avisando"
$J pular t-2 "sem P17 (teste)" > /dev/null; $J t-2 > "$T/o" 2>&1; [ "$(tail -n 1 "$T/o")" = OK ] || fail "pular não satisfez t-2"

# 6. t+9-fumaca com o texto certo é OK; t+8-api sem o texto 'healthy' é FALHOU -> rollback A
FORCAR=1 $J t+9-fumaca > "$T/o" 2>&1 || fail "t+9-fumaca: $(cat "$T/o")"
set +e; FORCAR=1 $J t+8-api > "$T/o" 2>&1; rc=$?; set -e
[ $rc = 1 ] && tail -n 1 "$T/o" | grep -q 'rollback A' || fail "t+8-api sem 'healthy' devia falhar ($rc)"

# 7. t+9b sem spool ligado (modo edge): nada a desligar, OK; com spool: chama spool-desliga go
FAKE_MODO=edge FORCAR=1 $J t+9b > "$T/o" 2>&1 || fail "t+9b edge"; grep -q 'nada a desligar' "$T/o" || fail "t+9b edge sem mensagem"
FAKE_MODO=spool FORCAR=1 REPETIR=1 $J t+9b > "$T/o" 2>&1 || fail "t+9b spool: $(cat "$T/o")"; grep -q 'spool-desliga go' "$FAKE_LOG" || fail "não chamou spool-desliga go"

# 8. rollback A: recusa se o spool já foi ao Go (B) ou se o nginx já inclui o Go; senão faz A1..A5, termina em OK e zera o estado
[ -e "$T/D/spool-foi-ao-go" ] || fail "t+9b com spool não deixou a marca spool-foi-ao-go"
set +e; $J rollback-a > "$T/o" 2>&1; rc=$?; set -e
[ $rc = 1 ] && grep -q 'rollback B' "$T/o" || fail "rollback-a devia recusar depois do spool ir ao Go"
rm -f "$T/D/spool-foi-ao-go"
REPETIR=1 $J t+0 > /dev/null 2>&1 || fail "t+0 de novo"
mv "$T/D/sb/acl-antes.tsv" "$T/acl.bak"
set +e; $J rollback-a > "$T/o" 2>&1; rc=$?; set -e
[ $rc = 1 ] && grep -q 'acl-antes.tsv' "$T/o" || fail "rollback-a sem foto da ACL devia falhar ($rc)"
mv "$T/acl.bak" "$T/D/sb/acl-antes.tsv"
set +e; FAKE_NGINX=1 $J rollback-a > "$T/o" 2>&1; rc=$?; set -e
[ $rc = 1 ] && grep -q 'rollback B' "$T/o" || fail "rollback-a devia recusar com o Go no nginx"
: > "$FAKE_LOG"; FAKE_MODO=spool $J rollback-a > "$T/o" 2>&1 || fail "rollback-a: $(cat "$T/o")"
[ "$(tail -n 1 "$T/o")" = OK ] || fail "rollback-a sem OK"
[ "$($J status | grep -c '^OK ')" = 0 ] && ls "$T"/D/estado.rollback-* > /dev/null || fail "o rollback não zerou o estado"
set +e; $J t+0 > "$T/o" 2>&1; rc=$?; set -e; [ $rc = 3 ] || fail "depois do rollback t+0 não devia passar sem t-1 ($rc)"
for x in 'supabase.sh descongelar' 'core-destinos restaurar' 'spool-desliga edge' 't29-desfazer' 'rm -f /root/api-db/PRODUCAO'; do grep -q -- "$x" "$FAKE_LOG" || fail "rollback-a não fez: $x"; done
a=$(grep -n 'supabase.sh descongelar' "$FAKE_LOG" | head -n1 | cut -d: -f1); b=$(grep -n 'spool-desliga edge' "$FAKE_LOG" | head -n1 | cut -d: -f1)
[ "$a" -lt "$b" ] || fail "o spool tem de devolver à edge DEPOIS de descongelar"

# 9. --dry: todos os passos OK, não grava estado, e todo caminho ops/ que ele cita existe no repositório de verdade
rm -rf "$T/D"
: > "$T/dry.txt"
for id in $(sh "$AQUI/janela.sh" lista | tail -n +2 | awk '{print $1}'); do
  sh "$AQUI/janela.sh" --dry "$id" >> "$T/dry.txt" 2>&1 || fail "--dry $id falhou"
done
[ "$(grep -c '^OK$' "$T/dry.txt")" = 35 ] || fail "--dry: esperava 35 OK"
[ ! -s "$T/D/estado" ] || fail "--dry gravou estado"
sed -E 's#.*(ops/[A-Za-z0-9_./-]+\.(sh|mjs|py|sql)).*#\1#p; d' "$T/dry.txt" | sort -u | while read -r f; do [ -e "$RAIZ/$f" ] || fail "o runbook cita $f que não existe"; done
# os scripts que o runbook chama por ssh (nomes em /root/virada) existem no repositório
for f in t10-nginx.sh t14-core-go.sh t16-chatwoot-go.sh; do [ -e "$RAIZ/ops/virada/vps/$f" ] || fail "falta ops/virada/vps/$f"; done
for f in t11-front.sh t17-pdv.sh t17-robos.sh t19-vessel.sh t20-worker.sh t29-fase-a.sh t17-site.sh t17-actions.sh vps-b1.sh; do [ -e "$RAIZ/ops/virada/janela/$f" ] || fail "falta ops/virada/janela/$f"; done

# 9b. verifica-virada: V1 a V3 leem o relatório do ensaio.sh; V4/V5 passam pela VPS (falsa); V8 (plano 12): OK, OK (roteamento), SEM-TRAFEGO, FALHOU
C=$T/D/corte/ensaio-1; mkdir -p "$C"
printf 'a 10 10 ok\nb 5 5 ok\nvarredura completa: 2 tabelas\n' > "$C/contagens.txt"; printf 'fk1 0\nfk2 0\n' > "$C/orfaos.txt"; : > "$C/triggers.diff"
bash "$FV/ops/virada/verifica-virada.sh" V1 V2 V3 > "$T/o" 2>&1 || fail "V1-V3 deviam passar: $(cat "$T/o")"
grep -q '^V1 OK' "$T/o" && grep -q '^V2 OK' "$T/o" && grep -q '^V3 OK' "$T/o" || fail "V1-V3 sem OK"
printf 'a 10 11 DIFERE\n' > "$C/contagens.txt"; echo 'fk1 3' > "$C/orfaos.txt"; echo '< x' > "$C/triggers.diff"
set +e; bash "$FV/ops/virada/verifica-virada.sh" V1 V2 V3 > "$T/o" 2>&1; rc=$?; set -e
[ $rc = 1 ] && grep -q '^V1 FALHOU' "$T/o" && grep -q '^V2 FALHOU' "$T/o" && grep -q '^V3 FALHOU' "$T/o" || fail "V1-V3 deviam falhar ($rc)"
v8() { set +e; bash "$FV/ops/virada/verifica-virada.sh" "$@" > "$T/o" 2>&1; rc=$?; set -e; }
ORG='shopify|1|2026-10-20\nchatwoot|2|2026-10-20\n'
# V8 (plano 12): tráfego orgânico das duas origens = OK
FAKE_V8=$ORG v8 V8; [ $rc = 0 ] && grep -q '^V8 OK (uma origem shopify' "$T/o" || fail "V8 orgânico devia ser OK/0 ($rc): $(cat "$T/o")"
# sem tráfego e sem t+14/t+16 no estado: SEM-TRAFEGO, que NÃO é falha (exit 0)
FAKE_V8= v8 V8; [ $rc = 0 ] && grep -q '^V8 SEM-TRAFEGO' "$T/o" || fail "V8 sem tráfego devia ser SEM-TRAFEGO/0 ($rc): $(cat "$T/o")"
! grep -q 'PENDENTE' "$T/o" || fail "V8 não pode mais ser PENDENTE"
# a hora do t+14 e do t+16 vêm do estado; prova de roteamento = Core 2xx ao Go + Chatwoot 2xx no saude.log
printf 't+14 OK %s\nt+16 OK %s\n' "$(( $(date +%s) - 600 ))" "$(( $(date +%s) - 300 ))" >> "$T/D/estado"
GOOD='supabase_checkout\tentregue\t200\t3\ncentral_pedidos\tentregue\t200\t1\n'
FAKE_V8= FAKE_CORE=$GOOD FAKE_CW='2xx 2\nnao-2xx 0\n' v8 V8; [ $rc = 0 ] && grep -q '^V8 OK (roteamento): shopify: 0 orgânico(s) + 4 entrega' "$T/o" || fail "V8 roteamento devia ser OK (roteamento)/0 ($rc): $(cat "$T/o")"
grep -q 'chatwoot: 0 orgânico(s) + 2 POST 2xx' "$T/o" || fail "V8 roteamento sem a contagem do Chatwoot"
# só metade da prova (Chatwoot sem POST) continua SEM-TRAFEGO
FAKE_V8= FAKE_CORE=$GOOD v8 V8; [ $rc = 0 ] && grep -q '^V8 SEM-TRAFEGO' "$T/o" || fail "meia prova devia ser SEM-TRAFEGO/0 ($rc): $(cat "$T/o")"
# Core: um destino só com falha (sem nenhum 2xx) = FALHOU/1; destino com falha E 2xx não reprova
FAKE_V8= FAKE_CORE='supabase_checkout\tfalhou\t503\t2\ncentral_pedidos\tentregue\t200\t1\n' FAKE_CW='2xx 2\nnao-2xx 0\n' v8 V8
[ $rc = 1 ] && grep -q '^V8 FALHOU (Core supabase_checkout: 2 entrega' "$T/o" || fail "V8 com destino falhando devia ser FALHOU/1 ($rc): $(cat "$T/o")"
FAKE_V8= FAKE_CORE='supabase_checkout\tfalhou\t503\t1\nsupabase_checkout\tentregue\t200\t4\n' FAKE_CW='2xx 1\nnao-2xx 0\n' v8 V8
[ $rc = 0 ] && grep -q '^V8 OK (roteamento)' "$T/o" || fail "falha intermitente com 2xx não devia reprovar ($rc): $(cat "$T/o")"
# Chatwoot: POST sem 2xx nenhum = FALHOU; troca-hora ausente (v8 da VPS sai 1) = FALHOU
FAKE_V8= FAKE_CORE=$GOOD FAKE_CW='2xx 0\nnao-2xx 2\n' v8 V8; [ $rc = 1 ] && grep -q '^V8 FALHOU (.*Chatwoot: 2 POST' "$T/o" || fail "V8 Chatwoot sem 2xx devia ser FALHOU/1 ($rc): $(cat "$T/o")"
FAKE_V8='FALHOU: sem /root/virada/troca-hora.txt\n' FAKE_V8_RC=1 v8 V8; [ $rc = 1 ] && grep -q '^V8 FALHOU (FALHOU: sem' "$T/o" || fail "V8 sem troca-hora devia ser FALHOU/1 ($rc)"
# espera: sem tráfego, repete até o limite e termina em SEM-TRAFEGO (exit 0); com INTERVALO8=1 e limite 2 s são 2 checagens
rm -f "$T/D/estado"
FAKE_V8= INTERVALO8=1 ESPERA8_MAX=2 v8 V8 espera; [ $rc = 0 ] && grep -q '^V8 SEM-TRAFEGO' "$T/o" && [ "$(grep -c 'nova checagem' "$T/o")" = 2 ] || fail "V8 espera: esperava 2 repetições e SEM-TRAFEGO ($rc): $(cat "$T/o")"
FAKE_V8=$ORG INTERVALO8=1 ESPERA8_MAX=2 v8 V8 espera; [ $rc = 0 ] && grep -q '^V8 OK (uma origem' "$T/o" && ! grep -q 'nova checagem' "$T/o" || fail "V8 espera com tráfego devia parar na 1ª checagem"
# --dry: nada de ssh, V8 e V10 só descrevem
: > "$FAKE_LOG"; v8 --dry V8 espera V10; [ $rc = 0 ] && grep -q '^V8 DRY' "$T/o" && grep -q '^V10 DRY' "$T/o" && ! grep -q '^ssh' "$FAKE_LOG" || fail "--dry devia só descrever ($rc): $(cat "$T/o")"

# 10. segredo: a senha da URL não aparece em nenhuma saída nem no log
! grep -rq "$SEGREDO" "$T/D" "$T/o" "$T/dry.txt" || fail "SEGREDO vazou (log ou saída)"

echo "TUDO OK"
