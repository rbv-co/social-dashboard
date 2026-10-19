#!/bin/bash
# ENSAIO dos scripts da janela dos robôs, NA VPS, contra o clone `api_corte` do api-db. Não toca produção: cron.d, systemd, robos.env,
# cartoes-ean.env, /root/virada e /usr/local/sbin REAIS ficam intactos (tudo vai para o sandbox $E, com systemctl falso e SEM ALERT_*:
# nenhum WhatsApp). O que ele escreve de verdade: papéis do cluster (senhas dos papéis robo_* = as de /root/secrets, as mesmas que o T+7
# aplicaria), linhas no clone api_corte, e as senhas robo-cartoes/conteudo que faltavam em /root/secrets.
# Uso (na VPS, como root, de um clone com ops/ na main ou da pasta copiada): bash ensaio-vps.sh [RAIZ_DO_REPO_COM_ops=/opt/robos/social-dashboard]
# Saída: blocos "== ..." e, no fim, a tabela robô -> código de saída -> tabelas escritas na 1ª e na 2ª rodada (a 2ª não pode inserir em tabela de dado).
set -u; export LC_ALL=C
OPS=${1:-/opt/robos/social-dashboard}; REPO=${REPO:-/opt/robos/social-dashboard}; E=${E:-/root/ensaio-t10}; BANCO=api_corte
NODE_BIN=/opt/cartoes-ean/node/bin
J="$OPS/ops/virada/janela"; [ -f "$J/t17-robos.sh" ] || { echo "sem $J/t17-robos.sh" >&2; exit 1; }
sec() { echo; echo "== $*"; }
psqlc() { docker exec -i api-db psql -U api -d "$BANCO" -XAt -v ON_ERROR_STOP=1 "$@"; }
rm -rf "$E"; mkdir -p "$E"/{virada,logs,locks,backup,seg,sbin,units,crond,estado}; chmod 700 "$E"

sec "0. pacote no sandbox (instalar-pacote.sh com VIRADA do sandbox)"
VIRADA="$E/virada" sh "$J/instalar-pacote.sh" "$OPS" || exit 1

sec "1. papéis no clone $BANCO (as senhas reais; mesmo loop do LEIA-ME)"
S=/root/secrets; SQL="$OPS/ops/vps/api-db"
# o copia-do-banco.sh lê SEMPRE o banco `api` (URL fixa): o papel `copia` precisa estar nos dois bancos de ensaio
for b in $BANCO api; do
  SENHA_COPIA="$(cat $S/copia.senha)" docker exec -i -e SENHA_COPIA api-db psql -U api -d $b -Xq -v ON_ERROR_STOP=1 < "$SQL/papel-copia.sql" > /dev/null || { echo "FALHOU papel-copia em $b"; exit 1; }
done
SENHA_CONTEUDO="$(cat $S/conteudo.senha)" docker exec -i -e SENHA_CONTEUDO api-db psql -U api -d $BANCO -Xq -v ON_ERROR_STOP=1 < "$SQL/papel-conteudo.sql" > /dev/null || { echo "FALHOU papel-conteudo"; exit 1; }
for r in reporte selo pedidos-vessel shopify metaads-zoho vigia-meta notas relatorios cards gestor interesses opr budget noticias faxina cartoes; do
  V=SENHA_ROBO_$(echo $r | tr 'a-z-' 'A-Z_')
  ( export "$V=$(cat $S/robo-$r.senha)"; docker exec -i -e "$V" api-db psql -U api -d $BANCO -Xq -v ON_ERROR_STOP=1 < "$SQL/papel-robo-$r.sql" > /dev/null ) || { echo "FALHOU papel-robo-$r"; exit 1; }
done; echo "papéis aplicados (17 + copia + conteudo)"

sec "2. sandbox de env (sem ALERT_*: nenhum WhatsApp), cron e systemctl falsos"
cp -p /etc/robos.env "$E/robos.env"; grep -Ev '^(export[[:space:]]+)?(ALERT_COMANDO|ALERT_WEBHOOK_URL)=' /etc/robos.env > "$E/robos.env"; chmod 600 "$E/robos.env"
cp -p /etc/cartoes-ean.env "$E/cartoes-ean.env"; cp -p /etc/cron.d/robos-social-dashboard "$E/cron-velho"
cp -p $S/api-app.senha $S/api.env "$E/seg/"; cp "$E/robos.env" "$E/robos.env.original"
cat > "$E/systemctl" <<'X'
#!/bin/sh
d=$(dirname "$0")/estado
case "$1" in stop) echo inactive > "$d/$2";; start) echo active > "$d/$2";; enable) shift; [ "$1" = --now ] && shift; for u in "$@"; do echo active > "$d/$u"; done;; disable) shift; [ "$1" = --now ] && shift; for u in "$@"; do echo inactive > "$d/$u"; done;; is-active) cat "$d/$2" 2>/dev/null || echo inactive;; esac
echo "systemctl $*" >> "$d/chamadas.log"
X
chmod +x "$E/systemctl"; echo active > "$E/estado/cartoes-ean"
export SYSTEMCTL="$E/systemctl" VIRADA="$E/virada" CRON="$E/crond/robos-social-dashboard"; cp -p "$E/cron-velho" "$CRON"

sec "3. Fase A (t29-vps) e t17-robos aplicar no clone"
sh "$J/t29-vps.sh" fase-a || exit 1
cp "$E/virada/robos-social-dashboard" "$E/virada/robos-social-dashboard.velho"   # t29 guardou o cron velho com o mesmo nome do destino: o novo é o .go
ENSAIO=1 BANCO=$BANCO ENV_ROBOS="$E/robos.env" CART_ENV="$E/cartoes-ean.env" BACKUP="$E/backup" REPO="$REPO" \
  bash "$J/t17-robos.sh" aplicar; RC17=$?; echo "t17 aplicar saiu $RC17"
[ "$RC17" = 0 ] || exit 1
echo "-- env (só os NOMES das chaves que a virada mexe):"; grep -oE '^(SAIU_DO_SUPABASE|STORAGE_SUPABASE_SERVICE_KEY|SUPABASE_SERVICE_KEY|COPIA_DB_SENHA|CONTEUDO_DB_SENHA|REPORTAR_DATABASE_URL|VIGIA_DATABASE_URL|ROBO_[A-Z0-9_]+_DATABASE_URL)=' "$E/robos.env" | tr '\n' ' '; echo
echo "-- cartoes-ean.env: $(grep -oE '^[A-Z_]+=' "$E/cartoes-ean.env" | tr '\n' ' ')"
echo "-- cron novo: $(grep -vc '^#\|^$\|^SHELL\|^PATH' "$CRON") linhas ativas; faxina-storage ativa? $(grep -v '^#' "$CRON" | grep -c faxina-storage)"
cp "$E/robos.env" "$E/robos.env.go"; chmod 600 "$E/robos.env.go"

sec "4. t19-vessel aplicar (só provas: espelho --ensaio, carocos --ensaio, lembretes sem token) contra o clone"
SEG="$E/seg" SBIN="$E/sbin" DESTINO_UNITS="$E/units" DESTINO_CRON="$E/crond" ENV_ROBOS="$E/robos.env" BANCO=$BANCO UMA_VEZ=--ensaio SO_PROVAS=1 REPO="$REPO" \
  bash "$J/t19-vessel.sh" aplicar; echo "t19 aplicar (provas) saiu $?"
ls "$E/units" "$E/crond" | tr '\n' ' '; echo
SEG="$E/seg" SBIN="$E/sbin" DESTINO_UNITS="$E/units" DESTINO_CRON="$E/crond" BANCO=$BANCO bash "$J/t19-vessel.sh" reverter
[ ! -e "$E/units/vessel-espelho.service" ] && [ ! -e "$E/crond/vessel-servicos" ] && echo "reverter t19: unit e cron removidos" || echo "FALHOU reverter t19"

sec "5. t20-worker conferir (leitura do worker.env real)"
bash "$J/t20-worker.sh" conferir

sec "6. robôs pelo rodar-robo.sh real, env do sandbox (banco $BANCO), 2 rodadas cada"
export LOGS="$E/logs" LOCKS="$E/locks" ENV_ROBOS="$E/robos.env" RAIZ="$REPO"
touch "$LOGS/.pull"; ( cd "$REPO" && cat coletor/package-lock.json | sha256sum ) > "$LOGS/.deps"   # sem pull, sem npm ci no checkout real
snap() { psqlc -c "select relname, n_tup_ins, n_tup_upd, n_tup_del from pg_stat_user_tables" | sort; }
delta() { join -t'|' <(sort "$1") <(sort "$2") | awk -F'|' '{i=$5-$2; u=$6-$3; d=$7-$4; if (i||u||d) printf "%s(+%d ins/%d upd/%d del) ", $1, i, u, d}'; }
ROBOS=(
"notas-dos-pedidos|node coletor/notas-dos-pedidos.mjs --dias=7"
"pedidos-da-vessel|bash -c 'set -e; node coletor/trazer-vendedores-do-bling.mjs; node coletor/trazer-pedidos-do-bling.mjs --dias=3'"
"pedidos-da-shopify|node coletor/trazer-pedidos-da-shopify.mjs --dias=3"
"fotos-do-selo|node coletor/fotos-do-selo-do-bling.mjs --dry --sem-push"
"vigia-problemas-meta|node coletor/vigia-problemas-meta.mjs"
"cards-comercial-diario|node coletor/atualizar-cards-comercial.mjs"
"meta-ads-no-zoho|node coletor/meta-ads-no-zoho.mjs --ensaio"
"sugerir-interesses|node coletor/sugerir-interesses.mjs --dry"
"budget-ia|node coletor/budget-ia.mjs --dry"
"opr-diario|node coletor/gerar-opr-diario.mjs --dry"
"copia-do-banco|bash coletor/vps/copia-do-banco.sh --ensaio"
)
RES="$E/resultado.txt"; : > "$RES"
for linha in "${ROBOS[@]}"; do
  nome=${linha%%|*}; cmd=${linha#*|}
  linhas=""
  for rodada in 1 2; do
    snap > "$E/a.snap"
    PATH="$NODE_BIN:$PATH" eval "timeout 900 \"$REPO/coletor/vps/rodar-robo.sh\" $nome 15 -- $cmd" > /dev/null 2>&1; rc=$?
    sleep 3; snap > "$E/b.snap"
    linhas="$linhas | rodada $rodada: rc=$rc $(delta "$E/a.snap" "$E/b.snap" | cut -c1-240)"
  done
  echo "$nome $linhas" | tee -a "$RES"
done
echo "-- robos_execucoes (clone): $(psqlc -c "select robo||'='||count(*) filter (where ok)||'/'||count(*) from robos_execucoes where conferido_em > now() - interval '2 hours' group by robo order by robo" | tr '\n' ' ')"

sec "7. t17-robos reverter: robos.env volta idêntico"
ENSAIO=1 BANCO=$BANCO ENV_ROBOS="$E/robos.env" CART_ENV="$E/cartoes-ean.env" BACKUP="$E/backup" REPO="$REPO" bash "$J/t17-robos.sh" reverter
cmp -s "$E/robos.env" "$E/robos.env.original" && echo "robos.env idêntico ao de antes" || echo "FALHOU: robos.env difere"
[ ! -e "$CRON" ] && [ "$(cat "$E/estado/cartoes-ean")" = inactive ] && echo "cron novo removido e cartoes-ean parado (estado da Fase A)" || echo "FALHOU: estado pós-reverter"
sec "FIM (sandbox em $E; apague com rm -rf $E quando acabar)"
