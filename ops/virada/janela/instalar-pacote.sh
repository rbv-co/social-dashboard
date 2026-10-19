#!/bin/sh
# Instala o PACOTE DA JANELA na VPS: copia os arquivos desta pasta (e o robos-troca-env.sh) para /root/virada, com o nome que o roteiro usa, e
# grava o manifesto sha256. Só ADICIONA arquivos em /root/virada e as senhas que faltam em /root/secrets (as mesmas que o T+7 criaria).
# NÃO liga nada, não mexe em cron.d, systemd, robos.env nem em banco. Roda NA VPS como root, de um clone na `main` (git pull antes).
# Uso: sh instalar-pacote.sh [RAIZ=/opt/robos/social-dashboard]
set -eu
RAIZ=${1:-/opt/robos/social-dashboard}; VIRADA=${VIRADA:-/root/virada}; SEG=${SEG:-/root/secrets}
J="$RAIZ/ops/virada/janela"; [ -f "$J/t17-robos.sh" ] || { echo "FALHOU: $J/t17-robos.sh não existe (git pull?)" >&2; exit 1; }
mkdir -p "$VIRADA"; chmod 700 "$VIRADA"
for f in t17-robos.sh t19-vessel.sh t20-worker.sh t29-vps.sh vessel-servico.sh vessel-espelho.service vessel-servicos.cron conferir-papeis.mjs; do
  install -m 755 "$J/$f" "$VIRADA/$f"; done
install -m 644 "$J/robos-social-dashboard.go" "$VIRADA/robos-social-dashboard.go"
install -m 755 "$RAIZ/ops/virada/robos-troca-env.sh" "$VIRADA/robos-troca-env.sh"
# t19-vessel.sh procura vessel-servico.sh e as units ao lado de si (AQUI): o pacote em /root/virada serve
( cd "$VIRADA" && sha256sum t17-robos.sh t19-vessel.sh t20-worker.sh t29-vps.sh vessel-servico.sh vessel-espelho.service vessel-servicos.cron conferir-papeis.mjs robos-social-dashboard.go robos-troca-env.sh > MANIFESTO.sha256 )
# SQL dos papéis que o T+7 aplica (o roteiro manda `scp papel-*.sql`; os de /root/api-db envelhecem: o robô de pedidos ganhou grant em 19/10).
# Só troca arquivo diferente e guarda o antigo em $BACKUP; /root/api-db não é o banco, é a pasta dos .sql.
API_DB=${API_DB:-/root/api-db}; BACKUP=${BACKUP:-/root/backups/virada}
if [ -d "$API_DB" ]; then
  bk="$BACKUP/api-db-sql-$(date -u +%Y%m%dT%H%M%SZ)"; trocados=0
  for f in "$RAIZ"/ops/vps/api-db/papel-*.sql; do
    n=$(basename "$f"); cmp -s "$f" "$API_DB/$n" 2>/dev/null && continue
    mkdir -p "$bk"; [ ! -e "$API_DB/$n" ] || cp -p "$API_DB/$n" "$bk/$n"; install -m 644 "$f" "$API_DB/$n"; trocados=$((trocados+1))
  done
  echo "papel-*.sql em $API_DB: $trocados atualizado(s)$( [ "$trocados" -eq 0 ] || echo "; antigos em $bk")"
fi
# senhas que o T+7 criaria e que o ensaio e o t17 exigem (cria só se faltar; nunca imprime)
for s in robo-cartoes conteudo; do [ -s "$SEG/$s.senha" ] || ( umask 077; openssl rand -hex 24 > "$SEG/$s.senha" ); done
echo "PACOTE OK em $VIRADA ($(wc -l < "$VIRADA/MANIFESTO.sha256") arquivos, MANIFESTO.sha256)"
