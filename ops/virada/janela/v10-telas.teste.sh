#!/bin/bash
# Prova do v10-telas.mjs (plano 12) sem VPS e sem produção: o front de verdade (vite dev, VITE_API_AREAS='*') fala com uma API FALSA
# (node, porta local) e o ssh é falso (v10-criar devolve um token fixo; v10-revogar grava uma marca). Cobre: V10 OK; 500 numa rota = FALHOU
# com a rota e a causa; 401 idem; 403 em /admin = só AVISO; a conta é revogada nos três casos; o token nunca aparece na saída.
# Precisa de node_modules (npm ci) e do Playwright do esforço (PLAYWRIGHT=.../playwright/index.mjs). Uso: bash ops/virada/janela/v10-telas.teste.sh
set -eu
AQUI=$(cd "$(dirname "$0")" && pwd); RAIZ=$(cd "$AQUI/../../.." && pwd)
PW=${PLAYWRIGHT:-$HOME/Projetos/Trabalho/lavessel/REVISAO-TESTES-2026-10/ferramentas/e2e/node_modules/playwright/index.mjs}
[ -f "$PW" ] || { echo "PULADO: sem Playwright em $PW (defina PLAYWRIGHT)"; exit 0; }
T=$(mktemp -d); PIDS=
trap 'kill $PIDS 2> /dev/null || true; rm -rf "$T"' EXIT
fail() { echo "FALHOU: $*"; exit 1; }
API=5391; FRONT=5390; TOKEN=tok-do-teste-v10-0123456789

cat > "$T/api.mjs" << 'JS'
import http from 'node:http'
import fs from 'node:fs'
const modo = () => { try { return fs.readFileSync(process.env.MODO_FILE, 'utf8').trim() } catch { return '' } }
http.createServer((q, r) => {
  const m = modo()
  const j = (st, o) => { r.writeHead(st, { 'content-type': 'application/json' }); r.end(JSON.stringify(o)) }
  if (q.headers.authorization !== `Bearer ${process.env.TOKEN}`) return j(401, { error: 'nao_autenticado' })
  const p = q.url.split('?')[0]
  const tela = new URL(q.headers.referer || 'http://x/').pathname   // a tela que fez o pedido: o navegador manda o Referer
  if (m === '500' && tela === '/redes' && p === '/eu/perfil') return j(500, { error: 'interno' })
  if (m === '401' && tela === '/frota' && p === '/auth/eu') return j(401, { error: 'nao_autenticado' })
  if (m === '403' && ['/acessos', '/banco'].includes(tela) && p === '/eu/perfil') return j(403, { error: 'sem_permissao' })
  if (p === '/auth/eu') return j(200, { id: 'u1', email: 'virada-v10@robos.invalid', nome: 'robô' })
  if (p === '/eu/perfil') return j(200, [{ id: 'u1', role: 'viewer', is_superadmin: false, permissions: {}, features: ['redes', 'frota', 'banco', 'acessos'], allowed_accounts: [], name: 'robô', email: 'virada-v10@robos.invalid' }])
  j(200, [])
}).listen(Number(process.env.PORTA), '127.0.0.1')
JS
echo > "$T/modo"
TOKEN=$TOKEN PORTA=$API MODO_FILE="$T/modo" node "$T/api.mjs" & PIDS="$PIDS $!"
( cd "$RAIZ" && VITE_API_AREAS='*' VITE_API_ALVO="http://127.0.0.1:$API" npm run dev -- --port $FRONT --strictPort > "$T/vite.log" 2>&1 ) & PIDS="$PIDS $!"
for _ in $(seq 1 40); do curl -s -o /dev/null "http://localhost:$FRONT/" && break; sleep 1; done
curl -s -o /dev/null "http://localhost:$FRONT/" || fail "o vite não subiu: $(tail -n 3 "$T/vite.log")"

cat > "$T/fakessh" << X
#!/bin/sh
# o v10-telas.mjs chama: <ssh> <host> bash -s -- <função> [args]  (o vps-b1.sh vem pelo stdin)
cat > /dev/null
case "\$*" in
  *v10-criar*) echo "\$*" | grep -q 'abandono-carrinho' && echo "$TOKEN" || { echo "sem a lista de módulos: \$*" >&2; exit 1; } ;;
  *v10-revogar*) echo revogado >> "$T/revogado"; echo "virada-v10: 1 conta(s) revogada(s)" ;;
esac
X
chmod +x "$T/fakessh"
roda() { # roda <modo da API falsa> [ROTAS]; saída em $T/o, código em $rc
  echo "$1" > "$T/modo"; : > "$T/revogado"
  set +e; BASE="http://localhost:$FRONT" PLAYWRIGHT="$PW" SSH="$T/fakessh" VPS=x ROTAS="${2:-/,/redes,/frota,/banco,/acessos,/admin}" node "$AQUI/v10-telas.mjs" > "$T/o" 2>&1; rc=$?; set -e
}
conta_revogada() { [ "$(wc -l < "$T/revogado" | tr -d ' ')" = 1 ] || fail "a conta virada-v10 não foi revogada ($1)"; }

roda ''
[ $rc = 0 ] && grep -q '^V10 OK (6 rotas' "$T/o" || fail "caso OK: rc $rc: $(cat "$T/o")"; conta_revogada ok
roda 500
[ $rc = 1 ] && grep -q '^V10 FALHOU' "$T/o" && grep -q '/redes: 500 GET /api/eu/perfil' "$T/o" || fail "500 devia reprovar com rota e causa: rc $rc: $(cat "$T/o")"; conta_revogada 500
roda 401
[ $rc = 1 ] && grep -q '/frota: 401' "$T/o" || fail "401 devia reprovar: rc $rc: $(cat "$T/o")"; conta_revogada 401
roda 403
[ $rc = 1 ] && grep -q '/banco: 403' "$T/o" && ! grep -q '^   /acessos' "$T/o" && grep -q 'AVISO /acessos: 403' "$T/o" || fail "403: /banco reprova, /acessos só avisa: rc $rc: $(cat "$T/o")"; conta_revogada 403
! grep -rq "$TOKEN" "$T/o" || fail "o token apareceu na saída"
echo "ok: v10-telas.mjs (OK, 500, 401, 403 em tela de admin = aviso; conta revogada nos 4; token fora da saída)"
