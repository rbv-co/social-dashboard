#!/usr/bin/env bash
# Valida a Central de FORA, pelo DNS publico, depois (ou durante) o corte da Vercel para a VPS.
# Uso: deploy/validar-central.sh [central.rbvcompany.com socialdashboard.rbvcompany.com]
VPS=187.127.23.240
nomes=("$@"); [ ${#nomes[@]} -eq 0 ] && nomes=(central.rbvcompany.com socialdashboard.rbvcompany.com)
falhas=0
ok()  { printf "  ok     %s\n" "$1"; }
bad() { printf "  FALHA  %s\n" "$1"; falhas=$((falhas+1)); }
for h in "${nomes[@]}"; do
  echo "== $h"
  ip=$(dig +short "$h" @8.8.8.8 | tail -1)
  if [ "$ip" = "$VPS" ]; then ok "DNS aponta para a VPS"; else echo "  info   DNS ainda aponta para: ${ip:-?} (resolvedor 8.8.8.8)"; fi
  c() { curl -s -o /dev/null -w %{http_code} --max-time 10 "https://$h$1"; }
  [ "$(c /)" = 200 ] && ok "/ 200 com certificado valido" || bad "/ nao respondeu 200 com certificado valido"
  html=$(curl -s --max-time 10 "https://$h/")
  pacote=$(echo "$html" | grep -oE '/assets/index-[A-Za-z0-9_-]+\.js' | head -1)
  [ -n "$pacote" ] && [ "$(c "$pacote")" = 200 ] && ok "pacote $pacote" || bad "pacote principal"
  for p in /sw-push.js /manifest.webmanifest /escritorio-3d/ /rota/funda; do
    [ "$(c $p)" = 200 ] && ok "$p 200" || bad "$p"
  done
  [ "$(c /verify/ABC)" = 307 ] && ok "/verify 307" || bad "/verify"
  curl -sI --max-time 10 "https://$h/" | grep -qiE '^cache-control: (no-cache|public, max-age=0)' && ok "index sem cache" || bad "cache do index"
  curl -sI --max-time 10 "https://$h/" | grep -qi '^strict-transport-security' && ok "HSTS" || bad "HSTS"
  server=$(curl -sI --max-time 10 "https://$h/" | tr -d '\r' | awk -F': ' 'tolower($1)=="server"{print $2}')
  echo "  info   server: ${server:-?} (nginx = VPS; Vercel = Vercel)"
done
[ $falhas -eq 0 ] && echo "TUDO OK" || { echo "$falhas FALHA(S)"; exit 1; }
