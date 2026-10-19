#!/bin/bash
# Verificação antes × depois da virada (plano 11; roteiro §5, V1 a V10). Imprime uma linha por verificação: `V<n> OK`, `V<n> FALHOU`
# ou `V<n> PENDENTE (<o que falta>)` (parte que só o DONO faz; hoje nenhuma: V8 e V10 são automáticos, plano 12). Nunca imprime segredo.
# Uso: bash ops/virada/verifica-virada.sh [--dry] [V1..V10 ...] | antes | depois | todos | V8 espera     (padrão: todos)
#   antes  = V1 a V7 (o GO técnico do T+10; V7 em 127.0.0.1:8080, antes do nginx)
#   depois = V7 (URL pública), V8, V9, V10 (T+22)
#   V8     = webhooks chegando: `V8 OK` (tráfego orgânico shopify e chatwoot depois da troca), `V8 OK (roteamento)` (sem tráfego
#            orgânico: Core com entrega 2xx ao Go depois do T+14 e 2xx do Chatwoot no saude.log depois do T+16), `V8 SEM-TRAFEGO`
#            (sem tráfego e sem prova; NÃO é falha) ou `V8 FALHOU` (entrega com 4xx/5xx ou falhou, sem nenhum 2xx).
#            Nunca envia webhook sintético (abandono de carrinho manda recuperação; pedido grava pedido).
#   V8 espera = repete a checagem a cada INTERVALO8 s (900) por até ESPERA8_MAX s (5400); para no 1º OK, OK (roteamento) ou FALHOU.
#   V10    = telas por papel, automático: ops/virada/janela/v10-telas.mjs (conta de serviço descartável, Chromium, todas as rotas).
#   --dry  = só imprime o que V8 e V10 rodariam (sem ssh, sem navegador).
# Ambiente: D (pasta de trabalho da janela; fotos do Supabase e $D/corte), SB, VPS, V como no janela.sh.
# Saída: 0 = tudo OK; 1 = algum FALHOU; 4 = nada falhou mas há PENDENTE do dono.
set -u
export LC_ALL=C
AQUI=$(cd "$(dirname "$0")" && pwd)
V=${V:-$(cd "$AQUI/../.." && pwd)}
J=$V/ops/virada/janela
. "$V/ops/migracao/oculta.sh"
VPS=${VPS:-op}
SSH=${SSH:-ssh -o BatchMode=yes -o ConnectTimeout=15 -o ServerAliveInterval=30}
if [ -z "${D:-}" ]; then
  if [ -s "$HOME/.virada-janela-atual" ]; then D=$(cat "$HOME/.virada-janela-atual"); else D=$HOME/virada-janela-$(date +%Y%m%d); fi
fi
vps_b1() { $SSH "$VPS" bash -s -- "$@" < "$J/vps-b1.sh"; }
vps() { $SSH "$VPS" "$@"; }
sb() {
  [ -n "${SB:-}" ] && return 0
  SB=$(sed -n 's/^DATABASE_URL=//p' "${ENV_COLETOR:-$V/coletor/.env}" 2> /dev/null | head -n 1 | tr -d "'\"" | sed 's#:6543/#:5432/#')
  [ -n "$SB" ]
}
FALHAS=0; PENDENTES=0
res() { # res N ok|falhou|pendente [texto]
  case $2 in
    ok) echo "V$1 OK${3:+ ($3)}" ;;
    falhou) echo "V$1 FALHOU${3:+ ($3)}"; FALHAS=$((FALHAS + 1)) ;;
    pendente) echo "V$1 PENDENTE${3:+ ($3)}"; PENDENTES=$((PENDENTES + 1)) ;;
    sem) echo "V$1 SEM-TRAFEGO${3:+ ($3)}" ;;
    rot) echo "V$1 OK (roteamento)${3:+: $3}" ;;
  esac
}
# epoch (segundos) em que o passo ficou OK em $D/estado ("<id> OK <epoch>"); vazio se nunca; e esse epoch em UTC "AAAA-MM-DD HH:MM:SS"
estado_epoch() { awk -v i="$1" '$1 == i && $2 == "OK" { e = $3 } END { print e }' "$D/estado" 2> /dev/null; }
epoch_utc() { date -u -r "$1" '+%F %T' 2> /dev/null || date -u -d "@$1" '+%F %T'; }
corte() { ls -td "$D"/corte/ensaio-*/ 2> /dev/null | head -n 1; }

v1() {
  c=$(corte); [ -n "$c" ] && [ -s "$c/contagens.txt" ] || { res 1 falhou "sem contagens.txt do ensaio.sh em $D/corte"; return; }
  d=$(grep -c DIFERE "$c/contagens.txt"); e=$(grep -cE ' ERRO( |$)' "$c/contagens.txt")
  [ "$d" = 0 ] && [ "$e" = 0 ] && res 1 ok "0 DIFERE, 0 ERRO" || res 1 falhou "$d DIFERE, $e ERRO"
}
v2() {
  c=$(corte); [ -n "$c" ] && [ -s "$c/orfaos.txt" ] || { res 2 falhou "sem orfaos.txt"; return; }
  n=$(grep -cv ' 0$' "$c/orfaos.txt"); [ "$n" = 0 ] && res 2 ok "$(wc -l < "$c/orfaos.txt" | tr -d ' ') FKs, todas 0" || res 2 falhou "$n FK(s) com órfãos"
}
v3() {
  c=$(corte); [ -n "$c" ] && [ -f "$c/triggers.diff" ] || { res 3 falhou "sem triggers.diff"; return; }
  [ ! -s "$c/triggers.diff" ] && res 3 ok "triggers idênticos" || res 3 falhou "triggers diferem (ver $c/triggers.diff)"
}
v4() { o=$(vps_b1 v4 2>&1); [ $? = 0 ] && res 4 ok "$o" || res 4 falhou "$(printf '%s' "$o" | tail -n 1)"; }
v5() { o=$(vps_b1 conferir 2>&1); [ $? = 0 ] && res 5 ok "api worker conferir: saída 0" || res 5 falhou "$(printf '%s' "$o" | oculta | tail -n 2 | tr '\n' ' ')"; }
v6() {
  sb || { res 6 falhou "sem SB"; return; }
  o=$(sh "$V/ops/virada/supabase.sh" escritas "$SB" "$D/sb" 2>&1 | oculta)
  case $o in *'nenhuma tabela mudou'*) res 6 ok "nenhuma tabela mudou desde a foto 1" ;; *) res 6 falhou "$(printf '%s' "$o" | tr '\n' ' ' | cut -c1-200)" ;; esac
}
v7() { # v7 local|publico
  o=$(vps_b1 v7 "$1" 2>&1); r=$?
  printf '%s\n' "$o" | sed 's/^/   /'
  [ $r = 0 ] && res 7 ok "5 rotas x 20 e o objeto do Storage ($1)" || res 7 falhou "ver as linhas acima"
}
# v8_avalia: grava em V8_R (ok | rot | sem | falhou) e V8_T (texto). Só leitura.
v8_avalia() {
  o=$(vps_b1 v8 2>&1); r=$?
  printf '%s\n' "$o" | sed 's/^/   /'
  if [ $r != 0 ]; then V8_R=falhou; V8_T=$(printf '%s' "$o" | tail -n 1); return; fi
  s=$(printf '%s\n' "$o" | grep -ci '^shopify'); c=$(printf '%s\n' "$o" | grep -ci '^chatwoot')
  echo "   spool (só leitura): $(vps_b1 spool-estado 2>&1 | tr '\n' ' ')"
  echo "   Core: $(sh "$V/ops/virada/core-destinos.sh" contar 2>&1 | oculta | tail -n 4 | tr '\n' ' ')"
  if [ "$s" -ge 1 ] && [ "$c" -ge 1 ]; then V8_R=ok; V8_T="uma origem shopify e uma chatwoot depois da troca"; return; fi
  # sem tráfego orgânico das duas origens: prova de ROTEAMENTO
  t14=$(estado_epoch t+14); t16=$(estado_epoch t+16)
  core_bom=0; cw_bom=0; ruim=; nota=
  if [ -n "$t14" ]; then
    e=$(sh "$V/ops/virada/core-destinos.sh" entregas-desde "$(epoch_utc "$t14")" 2>&1 | oculta)
    if printf '%s\n' "$e" | grep -q "$(printf '\t')"; then
      echo "   Core desde o T+14 (destino status http quantas): $(printf '%s' "$e" | tr '\t\n' ' ')"
      core_bom=$(printf '%s\n' "$e" | awk -F'\t' '$2 == "entregue" && $3 >= 200 && $3 < 300 { n += $4 } END { print n + 0 }')
      ruim=$(printf '%s\n' "$e" | awk -F'\t' '{ if ($2 == "falhou" || $3 >= 400) mau[$1] += $4; if ($2 == "entregue" && $3 >= 200 && $3 < 300) bom[$1] += $4 }
        END { for (d in mau) if (!bom[d]) printf "Core %s: %d entrega(s) com falha e nenhuma 2xx; ", d, mau[d] }')
    else nota="$nota Core sem leitura (${e:-vazio});"; fi
  else nota="$nota sem t+14 OK no estado da janela;"; fi
  if [ -n "$t16" ]; then
    x=$(vps_b1 v8-chatwoot "$t16" 2>&1 | oculta)
    cw_bom=$(printf '%s\n' "$x" | awk '$1 == "2xx" { print $2 + 0 }' | head -n 1); cw_bom=${cw_bom:-0}
    cw_mau=$(printf '%s\n' "$x" | awk '$1 == "nao-2xx" { print $2 + 0 }' | head -n 1); cw_mau=${cw_mau:-0}
    printf '%s\n' "$x" | sed 's/^/   saude.log desde o T+16: /' | head -n 4
    [ "$cw_mau" -gt 0 ] && [ "$cw_bom" = 0 ] && ruim="${ruim}Chatwoot: $cw_mau POST(s) sem 2xx e nenhum 2xx; "
  else nota="$nota sem t+16 OK no estado da janela;"; fi
  if [ -n "$ruim" ]; then V8_R=falhou; V8_T="$ruim"; return; fi
  if { [ "$s" -ge 1 ] || [ "$core_bom" -gt 0 ]; } && { [ "$c" -ge 1 ] || [ "$cw_bom" -gt 0 ]; }; then
    V8_R=rot; V8_T="shopify: $s orgânico(s) + $core_bom entrega(s) 2xx do Core ao Go depois do T+14; chatwoot: $c orgânico(s) + $cw_bom POST 2xx no saude.log depois do T+16"
  else
    V8_R=sem; V8_T="shopify orgânico=$s, entregas 2xx do Core=$core_bom; chatwoot orgânico=$c, POST 2xx=$cw_bom;$nota registre e siga (não é falha)"
  fi
}
v8_emite() {
  case $V8_R in
    ok) res 8 ok "$V8_T" ;; rot) res 8 rot "$V8_T" ;; sem) res 8 sem "$V8_T" ;; *) res 8 falhou "$V8_T" ;;
  esac
}
v8() { # v8 [espera]
  if [ "$DRY" = 1 ]; then
    echo "+ vps_b1 v8; vps_b1 spool-estado; core-destinos.sh contar"
    echo "+ core-destinos.sh entregas-desde <T+14 em UTC>; vps_b1 v8-chatwoot <epoch do T+16>   (prova de roteamento, só leitura)"
    [ "${1:-}" = espera ] && echo "+ repete a cada ${INTERVALO8:-900}s por até ${ESPERA8_MAX:-5400}s até V8 OK, V8 OK (roteamento) ou V8 FALHOU"
    echo "V8 DRY (nada executado)"; return
  fi
  if [ "${1:-}" = espera ]; then
    max=${ESPERA8_MAX:-5400}; passo=${INTERVALO8:-900}; resta=$(( max / passo ))   # 90 min / 15 = 6 repetições (7 checagens)
    while :; do
      v8_avalia
      case $V8_R in ok|rot|falhou) break ;; esac
      [ "$resta" -gt 0 ] || break
      resta=$((resta - 1))
      echo "   V8: sem tráfego nem prova ainda; nova checagem em $((passo / 60)) min (limite $((max / 60)) min)"; sleep "$passo"
    done
  else v8_avalia; fi
  v8_emite
}
v9() { o=$(vps_b1 v9 2>&1); r=$?; printf '%s\n' "$o" | sed 's/^/   /'; [ $r = 0 ] && res 9 ok "nenhuma tarefa DESLIGADA, sem falha" || res 9 falhou "ver acima"; }
v10() {
  h=https://central.rbvcompany.com
  if [ "$DRY" = 1 ]; then
    echo "+ curl $h/api/saude, $h/api/auth/eu (esperado 401), $h/ (esperado 200)"
    echo "+ node ops/virada/janela/v10-telas.mjs   (cria virada-v10 na VPS com todos os módulos, abre cada rota a 1440 px, revoga a conta)"
    echo "V10 DRY (nada executado)"; return
  fi
  s=$(curl -s --max-time 10 "$h/api/saude"); e=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$h/api/auth/eu"); r=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$h/")
  if ! { [ "$s" = ok ] && [ "$e" = 401 ] && [ "$r" = 200 ]; }; then res 10 falhou "saude='$s', /auth/eu=$e (esperava 401), raiz=$r (esperava 200)"; return; fi
  pw=${PLAYWRIGHT:-$HOME/Projetos/Trabalho/lavessel/REVISAO-TESTES-2026-10/ferramentas/e2e/node_modules/playwright/index.mjs}
  [ -f "$pw" ] || [ -n "${PLAYWRIGHT:-}" ] || { res 10 falhou "sem Playwright em $pw (defina PLAYWRIGHT)"; return; }
  o=$(PLAYWRIGHT=$pw BASE=$h VPS=$VPS SSH="$SSH" node "$J/v10-telas.mjs" 2>&1 | oculta); r=$?
  printf '%s\n' "$o" | grep -v '^V10 ' | sed 's/^/   /' | head -n 40
  u=$(printf '%s\n' "$o" | grep '^V10 ' | tail -n 1 | sed -E 's/^V10 [A-Z]+ \((.*)\)$/\1/')
  [ $r = 0 ] && res 10 ok "$u (automático completo; sem passo do dono)" || res 10 falhou "${u:-sem saída do v10-telas.mjs}"
}

DRY=0; ESPERA=; args=
for a in "$@"; do
  case $a in
    --dry) DRY=1 ;;
    espera) ESPERA=espera ;;
    *) args="$args $a" ;;
  esac
done
# shellcheck disable=SC2086
set -- $args
[ $# -ge 1 ] || set -- todos
alvos=
for a in "$@"; do
  case $a in
    antes) alvos="$alvos V1 V2 V3 V4 V5 V6 V7" ;;
    depois) alvos="$alvos V6 V7p V8 V9 V10" ;;
    todos) alvos="$alvos V1 V2 V3 V4 V5 V6 V7 V8 V9 V10" ;;
    V[0-9]|V10) alvos="$alvos $a" ;;
    *) sed -n '2,9p' "$0" >&2; exit 2 ;;
  esac
done
# V7 sozinho = local (antes do nginx) se o nginx ainda não inclui o Go; senão público
modo7=local
[ "$DRY" = 1 ] || vps "grep -c central-api.conf /etc/nginx/sites-enabled/central.rbvcompany.com" 2> /dev/null | grep -qx '[1-9]' && modo7=publico
for v in $alvos; do
  case $v in
    V1) v1 ;; V2) v2 ;; V3) v3 ;; V4) v4 ;; V5) v5 ;; V6) v6 ;;
    V7) case " $* " in *" antes "*) v7 local ;; *) v7 "$modo7" ;; esac ;;
    V7p) v7 publico ;;
    V8) v8 $ESPERA ;; V9) v9 ;; V10) v10 ;;
  esac
done
[ $FALHAS = 0 ] || { echo "VERIFICAÇÃO: $FALHAS FALHOU"; exit 1; }
[ $PENDENTES = 0 ] && { echo "VERIFICAÇÃO OK"; exit 0; }
echo "VERIFICAÇÃO: nada falhou; $PENDENTES PENDENTE do dono"; exit 4
