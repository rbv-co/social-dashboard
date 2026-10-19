#!/bin/bash
# Verificação antes × depois da virada (plano 11; roteiro §5, V1 a V10). Imprime uma linha por verificação: `V<n> OK`, `V<n> FALHOU`
# ou `V<n> PENDENTE (<o que falta>)` (parte que só o DONO faz). Nunca imprime segredo.
# Uso: bash ops/virada/verifica-virada.sh [V1..V10 ...] | antes | depois | todos      (padrão: todos)
#   antes  = V1 a V7 (o GO técnico do T+10; V7 em 127.0.0.1:8080, antes do nginx)
#   depois = V7 (URL pública), V8, V9, V10 (T+22)
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
D=${D:-$HOME/virada-janela-$(date +%Y%m%d)}
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
  esac
}
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
v8() {
  o=$(vps_b1 v8 2>&1); r=$?
  printf '%s\n' "$o" | sed 's/^/   /'
  if [ $r != 0 ]; then res 8 falhou "$(printf '%s' "$o" | tail -n 1)"; return; fi
  s=$(printf '%s\n' "$o" | grep -ci '^shopify'); c=$(printf '%s\n' "$o" | grep -ci '^chatwoot')
  echo "   spool: $(sh "$V/ops/virada/spool-replay.sh" go 2>&1 | oculta | tail -n 3 | tr '\n' ' ')"
  echo "   Core: $(sh "$V/ops/virada/core-destinos.sh" contar 2>&1 | oculta | tail -n 4 | tr '\n' ' ')"
  if [ "$s" -ge 1 ] && [ "$c" -ge 1 ]; then res 8 ok "uma origem shopify e uma chatwoot depois da troca"
  else res 8 pendente "DONO: carrinho de teste no site e mensagem de teste numa conversa do Chatwoot; depois repita 'verifica-virada.sh V8' (shopify=$s chatwoot=$c)"; fi
}
v9() { o=$(vps_b1 v9 2>&1); r=$?; printf '%s\n' "$o" | sed 's/^/   /'; [ $r = 0 ] && res 9 ok "nenhuma tarefa DESLIGADA, sem falha" || res 9 falhou "ver acima"; }
v10() {
  h=https://central.rbvcompany.com
  s=$(curl -s --max-time 10 "$h/api/saude"); e=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$h/api/auth/eu"); r=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$h/")
  if [ "$s" = ok ] && [ "$e" = 401 ] && [ "$r" = 200 ]; then
    res 10 pendente "automático ok (saude ok, /auth/eu sem sessão 401, raiz 200). DONO: entrar como admin e abrir cada área; 'entrar como' um gestor, uma loja e a frota; nenhuma tela com 401/500 nem 'sua sessão expirou'"
  else res 10 falhou "saude='$s', /auth/eu=$e (esperava 401), raiz=$r (esperava 200)"; fi
}

[ $# -ge 1 ] || set -- todos
alvos=
for a in "$@"; do
  case $a in
    antes) alvos="$alvos V1 V2 V3 V4 V5 V6 V7" ;;
    depois) alvos="$alvos V7p V8 V9 V10" ;;
    todos) alvos="$alvos V1 V2 V3 V4 V5 V6 V7 V8 V9 V10" ;;
    V[0-9]|V10) alvos="$alvos $a" ;;
    *) sed -n '2,9p' "$0" >&2; exit 2 ;;
  esac
done
# V7 sozinho = local (antes do nginx) se o nginx ainda não inclui o Go; senão público
modo7=local
vps "grep -c central-api.conf /etc/nginx/sites-enabled/central.rbvcompany.com" 2> /dev/null | grep -qx '[1-9]' && modo7=publico
for v in $alvos; do
  case $v in
    V1) v1 ;; V2) v2 ;; V3) v3 ;; V4) v4 ;; V5) v5 ;; V6) v6 ;;
    V7) case " $* " in *" antes "*) v7 local ;; *) v7 "$modo7" ;; esac ;;
    V7p) v7 publico ;;
    V8) v8 ;; V9) v9 ;; V10) v10 ;;
  esac
done
[ $FALHAS = 0 ] || { echo "VERIFICAÇÃO: $FALHAS FALHOU"; exit 1; }
[ $PENDENTES = 0 ] && { echo "VERIFICAÇÃO OK"; exit 0; }
echo "VERIFICAÇÃO: nada falhou; $PENDENTES PENDENTE do dono"; exit 4
