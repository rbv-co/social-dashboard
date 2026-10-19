#!/bin/bash
# T+17 da virada, passo do PDV (E4): o PDV passa a ler o número de série do `api-db` da Central (papel `pdv_leitura`,
# sem TLS, rede `api_net`) em vez do pooler do Supabase. O PDV novo está NO AR NA LOJA: erro aqui derruba a leitura de
# número de série, então cada passo se prova antes de seguir e TUDO volta sozinho se algo falhar. Roda na VPS, como root.
#
#   sh t17-pdv.sh conferir   só lê (pode rodar a qualquer hora): rede, senha, papel, backup, código no master
#   sh t17-pdv.sh ensaio     conferir + prova o papel e o código novo contra o ALVO_DB (padrão `api_corte`), com um
#                            contêiner descartável da imagem pdv2-api:virada. NÃO toca o PDV no ar.
#   sh t17-pdv.sh aplicar    (JANELA, só a orquestradora) backup do .env, prova contra o `api`, troca a URL, redeploy
#                            pelo deploy-com-reversao.sh, confere dentro do contêiner; falhou => reverter
#   sh t17-pdv.sh reverter   devolve o .env salvo no passo 1 do aplicar e recria o contêiner
#
# Reversão manual (o que `reverter` faz): cp -p $BK/pdv-backend.env.t17-<hora> /root/pdv-backend/.env &&
#   cd /root/pdv-backend/deploy && docker compose -f docker-compose.prod.yml up -d --force-recreate --no-build api
# O .env de ANTES da virada também está em /root/virada/pdv-backend.env (P12).
set -eu
PDV=${PDV_DIR:-/root/pdv-backend}; ENV_PDV=$PDV/.env; SEG=${SEG:-/root/secrets}; V=${V:-/root/virada}
BK=${BK:-/root/backups/virada}; REDE=${REDE:-api_net}; CONT=${CONT:-pdv2-api-api-1}
DEPLOY=${DEPLOY_PDV:-/root/deploy-pdv-com-reversao.sh}; IMG=${IMG_VIRADA:-pdv2-api:virada}
ALVO_DB=${ALVO_DB:-api_corte}; CONFERIR_DEPLOY=${CONFERIR_DEPLOY:-/root/monitor/conferir-deploy.sh}
modo=${1:-conferir}
falha() { echo "FALHOU: $*" >&2; exit 1; }
ok() { echo "ok: $*"; }

# lê a senha sem nunca imprimir; a URL só existe em variável de ambiente
url_para() { printf 'postgres://pdv_leitura:%s@api-db:5432/%s?sslmode=disable' "$(cat "$SEG/pdv.senha")" "$1"; }

conferir() {
  docker network inspect "$REDE" >/dev/null 2>&1 || falha "rede $REDE não existe (o compose do PDV a declara external)"
  ok "rede $REDE existe"
  [ -s "$SEG/pdv.senha" ] || falha "$SEG/pdv.senha não existe (openssl rand -hex 24, umask 077)"
  ok "senha do pdv_leitura presente"
  [ -f "$ENV_PDV" ] || falha "$ENV_PDV não existe"
  [ -f "$V/pdv-backend.env" ] || falha "backup P12 $V/pdv-backend.env não existe"
  ok ".env e backup P12 presentes"
  grep -q '^SUPABASE_DATABASE_URL=' "$ENV_PDV" || falha "SUPABASE_DATABASE_URL não está no .env do PDV"
  git -C "$PDV" fetch -q origin
  git -C "$PDV" show origin/master:src/catalogo/tls-da-origem.ts >/dev/null 2>&1 || falha "origin/master do pdv-backend sem tls-da-origem.ts (PR #70 não mergeado)"
  git -C "$PDV" show origin/master:deploy/docker-compose.prod.yml | grep -q 'api_net' || falha "compose do master sem api_net"
  ok "pdv-backend origin/master tem o PR #70 ($(git -C "$PDV" log --oneline origin/master -1 | cut -c1-60))"
  docker exec api-db psql -U api -d "$ALVO_DB" -Atc "select 1 from pg_roles where rolname='pdv_leitura' and rolcanlogin" | grep -q 1 \
    || falha "papel pdv_leitura não existe no $ALVO_DB (papel-pdv.sql do T+7)"
  ok "papel pdv_leitura existe no $ALVO_DB"
}

# PROVA do papel e do código novo contra o banco $1, de um contêiner na rede api_net. Sai 0 só se: lê o que o PDV
# lê, e é NEGADO no resto (mínimo privilégio).
prova_papel() {
  export SUPABASE_DATABASE_URL; SUPABASE_DATABASE_URL=$(url_para "$1")
  docker run --rm --network "$REDE" -e SUPABASE_DATABASE_URL "$IMG" node -e '
const { conexaoDaOrigem } = require("/app/dist/catalogo/tls-da-origem.js"); const { Pool } = require("pg");
(async () => {
  const p = new Pool({ ...conexaoDaOrigem(process.env.SUPABASE_DATABASE_URL), max: 1, connectionTimeoutMillis: 8000 });
  try {
    const r = await p.query("select count(*)::int n from vessel_pecas p join vessel_lotes l on l.id = p.lote_id where l.sku is not null");
    console.log("pecas_com_sku=" + r.rows[0].n);
    let negado = false;
    try { await p.query("select * from vessel_pecas limit 1"); } catch (e) { negado = /permission denied/.test(e.message); }
    console.log("negado_fora_das_colunas=" + negado);
    process.exit(negado ? 0 : 3);
  } catch (e) { console.log("ERRO: " + e.message); process.exit(2); } finally { await p.end(); }
})();'
}

conferir_no_conteiner() {
  [ "$(docker inspect -f '{{.State.Status}}' "$CONT" 2>/dev/null)" = running ] || return 1
  docker inspect -f '{{range $k,$v := .NetworkSettings.Networks}}{{$k}} {{end}}' "$CONT" | grep -qw "$REDE" || { echo "contêiner fora da rede $REDE"; return 1; }
  # a URL que o contêiner TEM de verdade (não a que eu montei): mesmo código, mesma env
  docker exec "$CONT" node -e '
const { conexaoDaOrigem } = require("/app/dist/catalogo/tls-da-origem.js"); const { Pool } = require("pg");
(async () => {
  const p = new Pool({ ...conexaoDaOrigem(process.env.SUPABASE_DATABASE_URL), max: 1, connectionTimeoutMillis: 8000 });
  try { const r = await p.query("select count(*)::int n from vessel_pecas p join vessel_lotes l on l.id = p.lote_id where l.sku is not null");
        console.log("no_conteiner pecas_com_sku=" + r.rows[0].n); process.exit(0); }
  catch (e) { console.log("ERRO no contêiner: " + e.message); process.exit(2); } finally { await p.end(); }
})();' || return 1
  [ "$(docker logs --since 3m "$CONT" 2>&1 | grep -c 'SUPABASE_DATABASE_URL invalida\|Sem SUPABASE_DATABASE_URL')" = 0 ] || { echo "log do PDV acusa origem desligada"; return 1; }
}

reverter() {
  ultimo=$(ls -1t "$BK"/pdv-backend.env.t17-* 2>/dev/null | head -1) || true
  [ -n "${ultimo:-}" ] || falha "sem $BK/pdv-backend.env.t17-* (use o backup P12: cp -p $V/pdv-backend.env $ENV_PDV)"
  cp -p "$ultimo" "$ENV_PDV"; chmod 600 "$ENV_PDV"
  ( cd "$PDV/deploy" && docker compose -f docker-compose.prod.yml up -d --force-recreate --no-build api </dev/null 2>&1 | tail -1 )
  r=$("$CONFERIR_DEPLOY" https://pdv.rbvcompany.com/api/auth/eu 401 60 | tail -1 || true)
  echo "REVERTIDO para $ultimo; conferência do PDV: ${r:-sem resposta}"
}

case "$modo" in
conferir) conferir; echo "CONFERIR OK" ;;
ensaio)
  conferir
  docker image inspect "$IMG" >/dev/null 2>&1 || falha "imagem $IMG não existe (docker build -t $IMG /root/pdv-virada-build)"
  prova_papel "$ALVO_DB" || falha "prova do papel contra $ALVO_DB"
  echo "ENSAIO OK contra $ALVO_DB (o PDV no ar não foi tocado)" ;;
aplicar)
  ALVO_DB=api; conferir
  docker image inspect "$IMG" >/dev/null 2>&1 || falha "imagem $IMG não existe"
  prova_papel api || falha "prova do papel contra o api (nada foi trocado)"
  mkdir -p "$BK"; ts=$(date -u +%Y%m%dT%H%M%SZ); cp -p "$ENV_PDV" "$BK/pdv-backend.env.t17-$ts"; chmod 600 "$BK/pdv-backend.env.t17-$ts"
  ok "backup do .env em $BK/pdv-backend.env.t17-$ts"
  NOVA=$(url_para api) python3 -I - "$ENV_PDV" << 'PY'
import os, sys, tempfile
caminho = sys.argv[1]; nova = os.environ["NOVA"]
linhas = open(caminho).read().split("\n")
achou = [i for i, l in enumerate(linhas) if l.startswith("SUPABASE_DATABASE_URL=")]
assert len(achou) == 1, "SUPABASE_DATABASE_URL tem que aparecer uma vez"
linhas[achou[0]] = "SUPABASE_DATABASE_URL=" + nova
fd, tmp = tempfile.mkstemp(dir=os.path.dirname(caminho)); os.fchmod(fd, 0o600)
with os.fdopen(fd, "w") as f: f.write("\n".join(linhas))
os.replace(tmp, caminho)
PY
  ok ".env trocado (só a SUPABASE_DATABASE_URL)"
  saida=$("$DEPLOY" 2>&1) || true
  echo "$saida" | tail -3
  if echo "$saida" | grep -q "DEPLOY OK" && conferir_no_conteiner; then
    echo "T+17 PDV OK: PDV lendo o número de série do api-db (reversão: sh t17-pdv.sh reverter)"
  else
    echo "FALHOU na conferência: REVERTENDO o .env"; reverter; exit 1
  fi ;;
reverter) reverter ;;
*) echo "uso: sh t17-pdv.sh conferir|ensaio|aplicar|reverter" >&2; exit 2 ;;
esac
