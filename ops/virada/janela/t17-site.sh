#!/bin/bash
# T+17 da virada, passo do SITE vesselbrasil.com.br (E5): as 9 páginas que falam com a base (`/rest/v1/rpc/<função>`) passam
# do host do Supabase para `https://central.rbvcompany.com` (a Central em Go atende o mesmo dialeto). Roda no MAC da
# orquestradora (precisa de push no vessel-brasil e de `ssh op`), num clone TEMPORÁRIO: não toca em nenhum checkout seu.
#
#   sh t17-site.sh conferir   só lê: páginas no ar, ORIGENS_PERMITIDAS, `deploy-vesselbrasil` da VPS, tema da Shopify
#   sh t17-site.sh ensaio     clone novo do main + `trocar-base-da-central.mjs --aplicar` + `npm test`; mostra o que mudaria. NÃO envia nada.
#   sh t17-site.sh aplicar    (JANELA, depois do T+10 e do T+11) ensaio + commit + push no main + `deploy-vesselbrasil` na VPS
#                             (publica já, sem esperar o cron de 5 min; reverte sozinho se a fumaça falhar) + confere as 9 páginas
#   sh t17-site.sh reverter   `git revert` do commit do aplicar + push + `deploy-vesselbrasil`
#
# POR QUE O PUSH NO MAIN E NÃO SÓ O DEPLOY: o cron `publicar-o-site` (5 em 5 min) publica o `origin/main` quando ele difere do
# release no ar. Release publicada à mão sem o commit no main seria DESFEITA pelo cron em até 5 minutos.
# Reversão manual: `git revert --no-edit <sha do t17-site>` + `git push origin main` + `ssh op /usr/local/sbin/deploy-vesselbrasil`
# (a página volta ao Supabase: só vale enquanto o Supabase está congelado-e-íntegro, rollback até D+1).
set -eu
REPO=${SITE_REPO_URL:-https://github.com/rbv-co/vessel-brasil.git}; HOSTV=${SSH_VPS:-op}
CENTRAL=https://central.rbvcompany.com; SUPA=kounqtdoioootxqegkij.supabase.co
MARCA=${MARCA_T17_SITE:-$HOME/.t17-site-sha}
modo=${1:-conferir}
falha() { echo "FALHOU: $*" >&2; exit 1; }
ok() { echo "ok: $*"; }
PAGINAS="beauty-sessions confirmar-presenca geradorappointmentcard geradorprivateeditcard prevenda private-appointment private-edit sua-visita verify"

clonar() { W=$(mktemp -d); git clone -q --depth 20 "$REPO" "$W/vb"; cd "$W/vb"; }

conferir() {
  o=$(ssh "$HOSTV" "grep '^ORIGENS_PERMITIDAS=' /root/secrets/api.env | cut -d= -f2")
  case "$o" in *https://vesselbrasil.com.br*www.vesselbrasil.com.br*|*www.vesselbrasil.com.br*https://vesselbrasil.com.br*) ok "ORIGENS_PERMITIDAS cobre o apex e o www ($o)" ;; *) falha "ORIGENS_PERMITIDAS sem o apex e o www: '$o'" ;; esac
  ssh "$HOSTV" "test -x /usr/local/sbin/deploy-vesselbrasil" || falha "deploy-vesselbrasil não está instalado na VPS"
  ok "deploy-vesselbrasil instalado; release no ar: $(ssh "$HOSTV" 'basename $(readlink -f /var/www/vesselbrasil/atual)' | cut -c1-8)"
  for p in $PAGINAS; do
    s=$(ssh "$HOSTV" "grep -c '$SUPA' /var/www/vesselbrasil/atual/$p/index.html || true"); c=$(ssh "$HOSTV" "grep -c 'central.rbvcompany.com' /var/www/vesselbrasil/atual/$p/index.html || true")
    echo "  $p: supabase=$s central=$c"
  done
  l=$(curl -sL --max-time 20 https://loja.vesselbrasil.com.br | grep -c 'supabase\.co' || true)
  [ "$l" = 0 ] && ok "tema da Shopify (loja.vesselbrasil.com.br) sem supabase.co" || echo "ATENÇÃO: tema da Shopify cita supabase.co ($l linhas): item do dono/Shopify"
}

ensaio_clone() {
  clonar; git config user.email >/dev/null 2>&1 || git config user.email "virada@rbvcompany.com"; git config user.name >/dev/null 2>&1 || git config user.name "Virada"
  node ferramentas/trocar-base-da-central.mjs >/dev/null 2>&1 || falha "main do vessel-brasil sem ferramentas/trocar-base-da-central.mjs (PR #50 não mergeado)"
  n=$(node ferramentas/trocar-base-da-central.mjs --aplicar | tail -1); echo "$n"
  [ "$(git diff --name-only | wc -l | tr -d ' ')" = 9 ] || falha "esperava 9 páginas trocadas, mudaram $(git diff --name-only | wc -l | tr -d ' ')"
  git diff --name-only | grep -qv '/index.html$' && falha "mudou arquivo que não é página"
  [ "$(grep -rl "$SUPA" --include='*.html' . | wc -l | tr -d ' ')" = 0 ] || falha "sobrou página com $SUPA"
  npm test 2>&1 | grep -E '^# (pass|fail)' | tr '\n' ' '; echo
  npm test >/dev/null 2>&1 || falha "npm test do site falhou com as páginas trocadas"
  ok "9 páginas trocadas, 0 com $SUPA, npm test verde (clone temporário $W)"
}

paginas_no_ar() {   # 0 se as 9 páginas estão trocadas no release no ar
  for p in $PAGINAS; do
    s=$(ssh "$HOSTV" "grep -c '$SUPA' /var/www/vesselbrasil/atual/$p/index.html || true"); c=$(ssh "$HOSTV" "grep -c 'central.rbvcompany.com' /var/www/vesselbrasil/atual/$p/index.html || true")
    [ "$s" = 0 ] && [ "$c" -ge 1 ] || { echo "página $p no ar: supabase=$s central=$c"; return 1; }
  done
}

reverter() {
  [ -s "$MARCA" ] || falha "sem $MARCA (o sha do aplicar): faça o revert à mão (ver o cabeçalho)"
  ( clonar; git config user.email "virada@rbvcompany.com"; git config user.name "Virada"
    git revert --no-edit "$(cat "$MARCA")" >/dev/null; git push -q origin HEAD:main
    echo "revert no main: $(git rev-parse --short HEAD)" )
  ssh "$HOSTV" /usr/local/sbin/deploy-vesselbrasil | tail -3
  echo "REVERTIDO: páginas de volta ao Supabase (confira com: sh t17-site.sh conferir)"
}

case "$modo" in
conferir) conferir; echo "CONFERIR OK" ;;
ensaio) ensaio_clone; echo "ENSAIO OK (nada foi enviado)" ;;
aplicar)
  [ "$(curl -s --max-time 8 "$CENTRAL/api/saude")" = ok ] || falha "$CENTRAL/api/saude não responde ok: o nginx do T+10 não está no ar; o site não pode apontar para lá"
  ensaio_clone
  git add -A && git commit -qm "feat(virada): páginas falam com a Central (API em Go) em vez do Supabase (T+17)"
  git pull -q --rebase origin main; git push -q origin HEAD:main
  printf '%s\n' "$(git rev-parse HEAD)" > "$MARCA"; ok "commit no main: $(git rev-parse --short HEAD) (reversão: sh t17-site.sh reverter)"
  ssh "$HOSTV" /usr/local/sbin/deploy-vesselbrasil | tail -4
  # o deploy sai 0 sem publicar se o cron do site está publicando (flock): espera até ~90 s pelas 9 páginas no ar
  for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18; do paginas_no_ar >/dev/null 2>&1 && break; sleep 5; done
  paginas_no_ar || { echo "páginas não ficaram trocadas no ar: REVERTENDO"; reverter; exit 1; }
  echo "T+17 SITE OK: 9 páginas no ar apontando para $CENTRAL" ;;
reverter) reverter ;;
*) echo "uso: sh t17-site.sh conferir|ensaio|aplicar|reverter" >&2; exit 2 ;;
esac
