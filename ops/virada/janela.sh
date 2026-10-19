#!/bin/bash
# Runbook EXECUTÁVEL da janela da virada Supabase -> API Go (plano 11, VIRADA-2026-10; roteiro MIGRACAO-GO/ROTEIRO-DA-VIRADA.md §4 e §6).
# SÓ A ORQUESTRADORA RODA os passos, no Mac, na hora certa (T = 22h40). Quem prepara a virada NÃO executa nenhum passo daqui (README §10);
# o que se pode rodar antes é `lista`, `status`, `preflight`, `ensaio` e `--dry` (nada disso escreve em produção).
#
# Uso: bash ops/virada/janela.sh [--dry] <passo> | lista | status | preflight | ensaio | pular <passo> <motivo> | p17 |
#                              rollback-a | rollback-b | rollback-b-replay | verifica [V1..V10|antes|depois|todos]
#   <passo>  um dos ids de `janela.sh lista` (t-32, t-30-supabase, t-30-core, t-29, t-28, t-2, t-1, t+0, t+0.5, t+1, t+1-ensaio, t+7-papeis,
#            t+7-clone, t+8-hosts, t+8-api, t+8-storage, t+9-conferir, t+9-escritas, t+9-fumaca, t+10-go, t+9b, t+10-nginx, t+11, t+14, t+16,
#            t+17-pdv, t+17-site, t+17-robos, t+17-actions, t+19, t+20, t+21, t+22, t+25-fim). Cada um confere a pré-condição (os passos
#            anteriores em $D/estado), executa, confere a saída esperada, grava em $D/janela-<data>.log e imprime, na última linha,
#            `OK` ou `FALHOU -> rollback A|B` (ou `FALHOU -> esperar...`). Saída: 0 = OK; 1 = FALHOU; 2 = uso; 3 = bloqueado (falta passo anterior).
#   --dry    imprime cada comando que rodaria (sem executar, sem ssh, sem gravar estado) e termina em `OK`.
#   status   em que passo está (ids, hora nominal T+n, OK/FALHOU/PULADO, e "agora = T±n min").
#   pular    marca um passo como PULADO (satisfaz o requisito dos seguintes); o motivo vai ao log. Ex.: t-2 sem P17.
#   p17      PRÉ-VOO (não é da janela; só com ok da orquestradora): Chatwoot passa a falar com a central, que faz proxy à edge. Sem isso o
#            spool do T-2 não recebe nada e os eventos do Chatwoot entre T-30 e T+16 se PERDEM (decisão do dono: perda não é aceita).
#   rollback-a  A1 a A5 (antes do nginx do T+10). rollback-b = B1 e B2 (para tudo, delta); o DONO lê o resumo; rollback-b-replay = B3 a B6.
# Ambiente: D (pasta de trabalho; padrão ~/virada-janela-<data>), SB (URL do Supabase, sessão :5432; padrão: DATABASE_URL de coletor/.env),
#   VPS (padrão op), V (checkout do social-dashboard na origin/main; padrão: este), T_JANELA (padrão 22:40), REPETIR=1, FORCAR=1 (ignora
#   requisitos), INTERVALO/ESPERA_MAX (t-28). NUNCA imprime segredo: toda saída passa por `oculta`; senha e token só em variável/arquivo 600.
set -u
export LC_ALL=C
AQUI=$(cd "$(dirname "$0")" && pwd)
V=${V:-$(cd "$AQUI/../.." && pwd)}
J=$V/ops/virada/janela
. "$V/ops/migracao/oculta.sh"
# além da URL e do host: sequência de 40+ hex (senha/token gerados com openssl rand -hex 24) nunca vai à tela nem ao log
oculta() { sed -E -e 's#postgres(ql)?://[^ "]*#<URL>#g' -e 's#(server at|host name|host|user|role) "[^"]*"( \([^)]*\))?#\1 "<oculto>"#g' -e 's/[0-9a-f]{40,}/<oculto>/g'; }
VPS=${VPS:-op}
SSH=${SSH:-ssh -o BatchMode=yes -o ConnectTimeout=15 -o ServerAliveInterval=30}
export NA_VPS=${NA_VPS:-$SSH $VPS}      # os scripts do plano 01 (spool, core-destinos) rodam o sh no alvo por aqui
DRY=${DRY:-0}
[ "${1:-}" = --dry ] && { DRY=1; shift; }
DATA=${DATA:-$(date +%Y%m%d)}
# D tem de ser o MESMO do T-30 ao rollback (a janela cruza a meia-noite): ponteiro em ~/.virada-janela-atual
if [ -z "${D:-}" ]; then
  if [ -s "$HOME/.virada-janela-atual" ]; then D=$(cat "$HOME/.virada-janela-atual"); else
    D=$HOME/virada-janela-$DATA; [ "$DRY" = 1 ] || { mkdir -p "$D"; echo "$D" > "$HOME/.virada-janela-atual"; }
  fi
fi
T_JANELA=${T_JANELA:-22:40}
umask 077; mkdir -p "$D"
LOG=$D/janela-$DATA.log; EST=$D/estado; ULT=$D/.ultima-saida
: >> "$EST"; : > "$ULT"

log() { printf '%s %s\n' "$(date '+%F %T')" "$*" | oculta >> "$LOG"; }
say() { printf '%s\n' "$*" | oculta | tee -a "$LOG"; }
# exe CMD...: roda (ou, em --dry, só imprime), mostra e loga a saída sem segredo, guarda em $ULT e devolve o código do comando
exe() {
  if [ "$DRY" = 1 ]; then printf '+ %s\n' "$*" | oculta | tee -a "$LOG"; : > "$ULT"; return 0; fi
  log "+ $*"
  "$@" 2>&1 < /dev/null | oculta | tee "$ULT" | tee -a "$LOG"
  return "${PIPESTATUS[0]}"
}
# confere "o quê" REGEX: a última saída tem de casar (em --dry passa)
confere() {
  [ "$DRY" = 1 ] && return 0
  grep -Eq "$2" "$ULT" && return 0
  say "FALHOU a conferência: $1 (esperava /$2/)"; return 1
}
# o lado da VPS dos passos de banco/API (janela/vps-b1.sh), uma função por vez
vps_b1() { $SSH "$VPS" bash -s -- "$@" < "$J/vps-b1.sh"; }
vps() { $SSH "$VPS" "$@"; }

sb() { # SB do ambiente ou do coletor/.env (nunca impresso); em --dry um marcador
  [ -n "${SB:-}" ] && return 0
  if [ "$DRY" = 1 ]; then SB="<SB>"; return 0; fi
  SB=$(sed -n 's/^DATABASE_URL=//p' "${ENV_COLETOR:-$V/coletor/.env}" 2> /dev/null | head -n 1 | tr -d "'\"" | sed 's#:6543/#:5432/#')
  [ -n "$SB" ] || { say "FALHOU: sem SB (defina SB ou ENV_COLETOR com DATABASE_URL)"; return 1; }
}
sbs() { psql "$SB" -XAtq -v ON_ERROR_STOP=1 "$@"; }
coletor_var() { sed -n "s/^$1=//p" "${ENV_COLETOR:-$V/coletor/.env}" 2> /dev/null | head -n 1 | tr -d "'\""; }

# túnel do Mac até o api-db (LEIA-ME do api-db, "Como o Mac chega"); $ALVO = URL do banco `api` com a senha do `api` (nunca impressa)
TUN_SOCK=$D/tunel.sock; TUN_PORTA=${TUN_PORTA:-55470}
tunel_abre() {
  if [ "$DRY" = 1 ]; then echo "+ túnel ssh -L 127.0.0.1:$TUN_PORTA:<IP do api-db>:5432 $VPS"; ALVO="postgres://api:<senha>@127.0.0.1:$TUN_PORTA/api?sslmode=disable"; return 0; fi
  if ! $SSH -S "$TUN_SOCK" -O check "$VPS" > /dev/null 2>&1; then
    ip=$(vps "docker inspect -f '{{(index .NetworkSettings.Networks \"api_net\").IPAddress}}' api-db") && [ -n "$ip" ] || { say "FALHOU: IP do api-db"; return 1; }
    $SSH -M -S "$TUN_SOCK" -f -N -o ExitOnForwardFailure=yes -L "127.0.0.1:$TUN_PORTA:$ip:5432" "$VPS" || { say "FALHOU: túnel"; return 1; }
  fi
  senha=$(vps "sed -n 's/^POSTGRES_PASSWORD=//p' /root/secrets/api-db.env") && [ -n "$senha" ] || { say "FALHOU: senha do api-db"; return 1; }
  ALVO="postgres://api:$senha@127.0.0.1:$TUN_PORTA/api?sslmode=disable"
  for _ in $(seq 1 20); do psql "$ALVO" -XAtqc 'select 1' > /dev/null 2>&1 && return 0; sleep 1; done
  say "FALHOU: o túnel abriu mas o api-db não responde"; return 1
}
tunel_fecha() { [ "$DRY" = 1 ] || $SSH -S "$TUN_SOCK" -O exit "$VPS" > /dev/null 2>&1 || true; }
url_de() { printf '%s' "$ALVO" | sed "s#/api?#/$1?#"; }   # a mesma URL, outro banco (api_corte)

# ---------------------------------------------------------------------------------------------------------------------------------------
# Passos. Cada função devolve 0 (ok) ou 1. Campos da tabela: id|minuto relativo a T|requisitos|rollback|descrição
PASSOS=$(cat << 'TABELA'
t-32|-32||esperar|push-vendas-22h já saiu (o push das 22h)
t-30-supabase|-30|t-32|A|pg_cron do Supabase desligado
t-30-core|-30|t-32|A|Core segura os destinos do Supabase (entrega fica pendente)
t-29|-29|t-30-supabase,t-30-core|A|robôs da VPS e Actions parados (Fase A)
t-28|-28|t-29|A|esperar nada em andamento no Supabase (a cada 2 min)
t-2|-2|t-28|-|spool do Chatwoot ligado (só com o P17 feito)
t-1|-1|t-28|A|nenhuma sessão ativa no Supabase
t+0|0|t-1|A|Supabase CONGELADO
t+0.5|0.5|t+0|-|foto 1 das escritas do Supabase
t+1|1|t+0.5|A|api-db recriado vazio
t+1-ensaio|1|t+1|A|corte: dump, restore, usuários, contagens (V1 a V4)
t+7-papeis|7|t+1-ensaio|A|papéis no api-db
t+7-clone|7|t+7-papeis|A|clone api_corte, dump, marca PRODUCAO
t+8-hosts|8|t+7-clone|A|host do Storage trocado no banco
t+8-api|8|t+8-hosts|A|api migrar; API e worker no ar
t+8-storage|8|t+7-clone|A|Storage incremental no disco
t+9-conferir|9|t+8-api|A|api worker conferir (V5)
t+9-escritas|9|t+0.5|A|ninguém escreveu no Supabase depois da foto (V6)
t+9-fumaca|9|t+8-storage,t+9-conferir|A|fumaça no 127.0.0.1:8080 (5 rotas + objeto)
t+10-go|10|t+9-escritas,t+9-fumaca|A|GO técnico: V1 a V7 na tela
t+9b|10|t+10-go|B|spool desligado: replay ao Go (só depois do GO técnico; antes do nginx)
t+10-nginx|10|t+9b|B|nginx -> API Go
t+11|11|t+10-nginx|B|front com VITE_API_AREAS='*'
t+14|14|t+10-nginx|B|Core entrega ao Go e solta o retido
t+16|16|t+14|B|Chatwoot -> API Go
t+17-pdv|17|t+10-nginx,t+7-papeis|B|PDV lê o api-db (pdv_leitura)
t+17-site|17|t+10-nginx,t+11|B|site vessel-brasil na base nova
t+17-robos|17|t+7-clone,t+8-api,t+10-nginx|B|robôs da VPS no api-db (cron novo, cartoes-ean)
t+17-actions|17|t+17-robos|B|Actions: secrets, variáveis, 2 workflows
t+19|19|t+17-robos|B|robôs da Vessel (espelho, lembretes, carocos, conteudo-vigia)
t+20|20|t+19|B|worker liberado
t+21|21|t+20|-|intervalo recuperado (--forcar só das 5 permitidas)
t+22|22|t+11,t+14,t+16,t+17-robos,t+20|B|V7 público, V8, V9, V10
t+25-fim|25|t+22|-|revoga a fumaça, fecha túnel, guarda evidência
TABELA
)
info_passo() { printf '%s\n' "$PASSOS" | awk -F'|' -v i="$1" '$1 == i { print; found = 1 } END { exit !found }'; }
estado_de() { awk -v i="$1" '$1 == i { s = $2 } END { print s }' "$EST"; }
fn_de() { printf 'p_%s' "$(printf '%s' "$1" | sed 's/+/mais/g; s/[-.]/_/g')"; }
hora_nominal() { # hora_nominal MINUTOS -> HH:MM
  h=${T_JANELA%:*}; m=${T_JANELA#*:}; t=$(( 10#$h * 60 + 10#$m + $(printf '%.0f' "$1") ))
  printf '%02d:%02d' $(( (t / 60) % 24 )) $(( t % 60 ))
}
objeto_fumaca() { vps "cat /root/virada/objeto-fumaca.txt"; }

p_t_32() {
  sb || return 1
  exe psql "$SB" -XAtc "select d.status || '|' || case when d.start_time > now() - interval '40 minutes' then 'recente' else 'velho' end
    from cron.job_run_details d join cron.job j using (jobid) where j.jobname = 'push-vendas-22h' order by d.start_time desc limit 1" || return 1
  confere "o push das 22h saiu (succeeded e recente)" '^succeeded\|recente$'
}
p_t_30_supabase() {
  sb || return 1
  exe sh "$V/ops/virada/supabase.sh" desligar-cron "$SB" "$D/sb" || return 1
  confere "jobs desligados" 'pg_cron: 0 jobs ativos' || return 1
  [ "$DRY" = 1 ] || grep -q 'ativos antes: 23' "$ULT" || say "AVISO: o roteiro esperava 23 jobs ativos (P2); o supabase.sh desligou o que havia"
  return 0
}
p_t_30_core() {
  exe sh "$V/ops/virada/core-destinos.sh" janela || return 1
  confere "Core segurando" 'ok: Core segurando'
  exe sh "$V/ops/virada/core-destinos.sh" contar
  return 0
}
p_t_29() {
  exe sh "$J/t29-fase-a.sh" "$V" "$D" || return 1
  confere "Fase A" 'FASE A \(robôs \+ Actions\) OK'
}
p_t_28() {
  sb || return 1
  ini=$(date +%s)
  while :; do
    exe sh "$V/ops/virada/supabase.sh" em-andamento "$SB" "$D/sb" || return 1
    [ "$DRY" = 1 ] && return 0
    IFS=$'\t' read -r a b c < "$ULT"
    if [ "${a:-x}" = 0 ] && [ "${b:-x}" = 0 ] && { [ "${c:-0}" -ge 600 ] || [ "${c:-0}" = -1 ]; }; then say "nada em andamento (0 0 ${c})"; return 0; fi
    [ $(( $(date +%s) - ini )) -lt "${ESPERA_MAX:-2400}" ] || { say "FALHOU: ainda em andamento depois de ${ESPERA_MAX:-2400}s"; return 1; }
    sleep "${INTERVALO:-120}"
  done
}
p_t_2() {
  exe vps_b1 host-chatwoot || return 1
  if [ "$DRY" != 1 ] && ! grep -q 'central.rbvcompany.com' "$ULT"; then
    say "AVISO: o Chatwoot ainda aponta DIRETO para o Supabase (P17 não feito). O spool não ligou: eventos do Chatwoot entre T-30 e T+16 SE PERDEM."
    say "        Decida agora: 'janela.sh p17' (reinicia rails e sidekiq por segundos) e repita este passo, ou 'janela.sh pular t-2 <motivo>'."
    return 1
  fi
  exe sh "$V/ops/virada/spool-liga.sh" || return 1
  confere "spool no ar" 'spool no ar'
}
p_t_1() {
  sb || return 1
  exe psql "$SB" -XAtc "select usename, application_name, state, count(*) from pg_stat_activity where datname = current_database() and state <> 'idle' and pid <> pg_backend_pid() and usename not in ('supabase_admin', 'pgbouncer', 'authenticator') group by 1, 2, 3" || return 1
  [ "$DRY" = 1 ] || ! grep -q . "$ULT" || { say "FALHOU: há sessão ativa no Supabase (achar e parar o escritor direto)"; return 1; }
}
p_tmais0() {
  sb || return 1
  exe sh "$V/ops/virada/supabase.sh" congelar "$SB" "$D/sb" || return 1
  confere "foto da ACL" 'foto da ACL: [0-9]+ linhas; reversão: [0-9]+ GRANTs' || return 1
  confere "congelado" 'CONGELADO'
}
p_tmais0_5() {
  sb || return 1
  [ "$DRY" = 1 ] || sleep "${ATRASO_FOTO:-15}"
  exe sh "$V/ops/virada/supabase.sh" escritas "$SB" "$D/sb" || return 1
  confere "foto 1" 'foto 1 das escritas gravada'
}
p_tmais1() {
  exe vps_b1 recriar || return 1
  confere "api-db recriado" 'api-db recriado: healthy'
}
p_tmais1_ensaio() {
  sb || return 1
  tunel_abre || return 1
  mkdir -p "$D/corte"
  exe env ALVO_DATABASE_URL="$ALVO" ORIGEM_DATABASE_URL="$SB" ENSAIO_SAIDA="$D/corte" \
    sh "$V/ops/migracao/ensaio.sh" --permitir-alvo-remoto --sem-storage --manter || return 1
  confere "ensaio.sh" 'ENSAIO OK'
}
# $V/ops/vps/api-db/papel-*.sql e ops/virada/papel-da-api.sql da main têm de ser os da VPS (o robô de pedidos ganhou grant em 19/10)
sincroniza_sql() {
  [ "$DRY" = 1 ] && { echo "+ sincronizar papel-*.sql da main (sha256) com $VPS:/root/api-db e papel-da-api.sql com $VPS:/root/virada"; return 0; }
  loc=$(cd "$V/ops/vps/api-db" && shasum -a 256 papel-*.sql | sort -k2)
  rem=$(vps "cd /root/api-db && sha256sum papel-*.sql | sort -k2") || return 1
  if [ "$loc" != "$rem" ]; then
    say "papel-*.sql da VPS diferem da main: copiando os da main para /root/api-db (aditivo; os de antes ficam em /root/backups/virada/)"
    vps "mkdir -p /root/backups/virada/api-db-sql-janela-$DATA && cp -p /root/api-db/papel-*.sql /root/backups/virada/api-db-sql-janela-$DATA/" || return 1
    ( cd "$V/ops/vps/api-db" && tar --no-xattrs -cf - papel-*.sql ) | vps "tar -xf - -C /root/api-db --no-same-owner" || return 1
  fi
  ( cd "$V/ops/virada" && tar --no-xattrs -cf - papel-da-api.sql ) | vps "tar -xf - -C /root/virada --no-same-owner" || return 1
}
p_tmais7_papeis() {
  sincroniza_sql || return 1
  exe vps_b1 papeis || return 1
  confere "papéis" 'papéis aplicados: [0-9]+'
}
p_tmais7_clone() {
  sb || return 1
  exe vps_b1 clone || return 1
  confere "clone" 'clone api_corte criado' || return 1
  # a lista de tabelas do Supabase (base do delta do rollback B); só leitura
  if [ "$DRY" = 1 ]; then echo "+ psql \$SB -> $D/corte/tabelas.txt"; else
    mkdir -p "$D/corte"; sbs -c "select tablename from pg_tables where schemaname = 'public' order by 1" > "$D/corte/tabelas.txt" && [ -s "$D/corte/tabelas.txt" ] \
      || { say "FALHOU: lista de tabelas do Supabase"; return 1; }
  fi
}
p_tmais8_hosts() {
  if [ "$DRY" = 1 ]; then echo "+ scp coletor/trocar-host-das-urls-de-storage.mjs $VPS:/root/virada/trocar/"; else
    vps "mkdir -p /root/virada/trocar" && ( cd "$V/coletor" && tar --no-xattrs -cf - trocar-host-das-urls-de-storage.mjs ) | vps "tar -xf - -C /root/virada/trocar --no-same-owner" || return 1
  fi
  exe vps_b1 hosts || return 1
  confere "host trocado" 'sobraram 0 coluna'
}
p_tmais8_api() {
  exe vps_b1 subir || return 1
  confere "healthy" 'api e worker healthy'
}
p_tmais8_storage() {
  exe vps_b1 storage
}
p_tmais9_conferir() {
  exe vps_b1 conferir || return 1
  confere "api worker conferir" 'saída 0$'
}
p_tmais9_escritas() {
  sb || return 1
  exe sh "$V/ops/virada/supabase.sh" escritas "$SB" "$D/sb" || return 1
  confere "ninguém escreveu" 'nenhuma tabela mudou'
}
p_tmais9_fumaca() {
  exe vps_b1 fumaca || return 1
  confere "fumaça" 'fumaça OK'
}
p_tmais9b() {
  exe vps_b1 modo-chatwoot || return 1
  if [ "$DRY" != 1 ] && ! grep -q '^spool$' "$ULT"; then say "spool não estava ligado (modo $(head -n 1 "$ULT")): nada a desligar"; return 0; fi
  exe sh "$V/ops/virada/spool-desliga.sh" go || { [ "$DRY" = 1 ] || : > "$D/spool-foi-ao-go"; return 1; }   # replay parcial também conta: o caminho passa a ser o B
  [ "$DRY" = 1 ] || : > "$D/spool-foi-ao-go"
  confere "spool desligado" 'ok: spool desligado; rotas do Chatwoot -> go' || return 1
  exe sh "$V/ops/virada/spool-replay.sh" go
}
p_tmais10_go() {
  say "GO técnico: V1 a V7 (o DONO decide em seguida; NO-GO = rollback A)"
  exe bash "$V/ops/virada/verifica-virada.sh" antes || return 1
  confere "V1 a V7" 'V7 OK'
}
p_tmais10_nginx() {
  exe objeto_fumaca || return 1
  obj=$(head -n 1 "$ULT"); [ "$DRY" = 1 ] && obj="<bucket/objeto>"
  [ -n "$obj" ] || { say "FALHOU: sem objeto do Storage (rode t+9-fumaca)"; return 1; }
  exe vps "sh /root/virada/t10-nginx.sh '$obj'" || return 1
  # o rollback B volta ESTE backup (o do t10 desta execução), não "o mais recente" (os ensaios TESTE=1 gravam na mesma pasta)
  if [ "$DRY" != 1 ]; then
    ts=$(sed -n 's/^backup: .*\*\.//p' "$ULT" | head -n 1)
    [ -n "$ts" ] || { say "FALHOU: não li o backup do t10-nginx.sh na saída (o rollback B não saberia o que voltar)"; return 1; }
    vps "printf '%s\n' '$ts' > /root/virada/nginx-ts-t10.txt" || return 1
  fi
  [ "$DRY" = 1 ] || vps "date -u +%Y-%m-%dT%H:%M:%SZ > /root/virada/troca-hora.txt" || return 1   # base do V8: só vale o que chegar depois
  say "TROCA FEITA: daqui em diante o Go recebe escrita (volta = rollback B)"
}
p_tmais11() {
  exe vps "cat /root/virada/front-sha.txt" || return 1
  sha=$(head -n 1 "$ULT" | sed 's/-api$//'); [ "$DRY" = 1 ] && sha="<sha>"   # o front-sha.txt grava <curto>-api
  if [ "$DRY" != 1 ]; then
    git -C "$V" fetch -q origin 2> /dev/null
    main=$(git -C "$V" rev-parse origin/main) || return 1
    case "$main" in "$sha"*) ;; *) say "FALHOU: o front preparado ($sha) não é o da origin/main ($(printf '%.8s' "$main")): rode, na VPS, t11-front.sh preparar <sha da main>"; return 1 ;; esac
  fi
  exe vps "bash /root/virada/t11-front.sh aplicar '$sha'" || return 1
  confere "front" 'T\+11 FRONT OK'
}
p_tmais14() {
  exe vps "sh /root/virada/t14-core-go.sh" || return 1
  exe sh "$V/ops/virada/core-destinos.sh" contar
  say "Confira em ~2 min: 'core-destinos.sh contar' sem 'pendente' (o retido da janela vai ao Go)"
  return 0
}
p_tmais16() {
  exe vps "sh /root/virada/t16-chatwoot-go.sh" || return 1
  if [ "$DRY" != 1 ]; then
    r=$(curl -sk --max-time 10 -w ' %{http_code}' https://central.rbvcompany.com/api/receber-webhook-chatwoot < /dev/null) || r="sem resposta"
    case "$r" in *'"ok"'*|*'"spool"'*|"sem resposta") say "FALHOU: a rota do Chatwoot na central não é a do Go: $r"; return 1 ;; *' 405') say "rota do Chatwoot: Go (405)" ;; *) say "FALHOU: esperava 405 do Go: $r"; return 1 ;; esac
  fi
}
p_tmais17_pdv() {
  exe vps "bash /root/virada/t17-pdv.sh aplicar" || return 1
  confere "PDV" 'T\+17 PDV OK'
}
p_tmais17_site() {
  exe sh "$J/t17-site.sh" aplicar || return 1
  confere "site" 'T\+17 SITE OK'
}
p_tmais17_robos() {
  exe vps "bash /root/virada/t17-robos.sh aplicar"
}
p_tmais17_actions() {
  exe sh "$J/t17-actions.sh" "$D" || return 1
  confere "Actions" 'ACTIONS OK'
}
p_tmais19() {
  exe vps "bash /root/virada/t19-vessel.sh aplicar" || return 1
  [ "$DRY" = 1 ] || ! grep -q 'LEMBRETE NÃO INSTALADO' "$ULT" || say "AVISO: lembretes da Vessel NÃO instalados (falta ZEPTOMAIL_TOKEN no api.env); o resto subiu"
  return 0
}
p_tmais20() {
  exe vps "bash /root/virada/t20-worker.sh liberar"
}
p_tmais21() {
  exe vps "bash /root/virada/t20-worker.sh recuperar" || { say "anote e siga: a recuperação do intervalo é por tarefa (NUNCA as de push, WhatsApp e RD)"; return 1; }
}
p_tmais22() {
  say "V7 (URL pública), V8, V9 e V10 (V8 e V10 pedem o DONO: carrinho de teste no site, mensagem de teste no Chatwoot, telas por papel)"
  exe bash "$V/ops/virada/verifica-virada.sh" depois
  rc=$?
  [ $rc = 0 ] || [ $rc = 4 ]   # 4 = nada falhou, só há PENDENTE do dono (V8 e V10)
}
p_tmais25_fim() {
  exe vps_b1 revogar-fumaca
  tunel_fecha
  say "Evidência em $D (log, fotos do Supabase, corte/). O dump em $D/corte/*/dump tem dado pessoal: apagar quando o rollback B deixar de valer (D+1)."
  return 0
}

# ---------------------------------------------------------------------------------------------------------------------------------------
rotulo_rollback() {
  case "$1" in
    A) echo "rollback A (janela.sh rollback-a)" ;;
    B) echo "rollback B (janela.sh rollback-b)" ;;
    esperar) echo "esperar e repetir este passo (sem rollback)" ;;
    *) echo "anotar e seguir (sem rollback)" ;;
  esac
}

roda_passo() {
  id=$1
  linha=$(info_passo "$id") || { echo "passo desconhecido: $id (veja: sh ops/virada/janela.sh lista)" >&2; exit 2; }
  IFS='|' read -r _ min req rb desc <<< "$linha"
  fn=$(fn_de "$id")
  type "$fn" > /dev/null 2>&1 || { echo "sem função $fn" >&2; exit 2; }
  if [ "$DRY" != 1 ]; then
    atual=$(estado_de "$id")
    if { [ "$atual" = OK ] || [ "$atual" = PULADO ]; } && [ "${REPETIR:-0}" != 1 ]; then
      echo "$id já está $atual (REPETIR=1 para repetir)"; echo "OK"; exit 0
    fi
    if [ "${FORCAR:-0}" != 1 ] && [ -n "$req" ]; then
      for r in $(printf '%s' "$req" | tr ',' ' '); do
        s=$(estado_de "$r")
        case "$s" in OK|PULADO) ;; *) echo "BLOQUEADO: $id precisa de $r (estado: ${s:-nunca rodou}); FORCAR=1 ignora"; exit 3 ;; esac
      done
    fi
  fi
  ini=$(date +%s)
  say "=== $id (T$( [ "${min#-}" = "$min" ] && echo "+$min" || echo "$min" ), $(hora_nominal "$min")): $desc"
  log "INÍCIO $id"
  "$fn"; rc=$?
  dur=$(( $(date +%s) - ini ))
  if [ "$rc" = 0 ]; then
    [ "$DRY" = 1 ] || printf '%s OK %s\n' "$id" "$(date +%s)" >> "$EST"
    log "FIM $id OK (${dur}s)"
    say "$id: ${dur}s"
    echo "OK"; exit 0
  fi
  [ "$DRY" = 1 ] || printf '%s FALHOU %s\n' "$id" "$(date +%s)" >> "$EST"
  log "FIM $id FALHOU (${dur}s)"
  say "$id: ${dur}s"
  echo "FALHOU -> $(rotulo_rollback "$rb")"
  exit 1
}

cmd_lista() {
  printf "%-14s %-5s %-6s %s\n" passo T hora descrição
  printf '%s\n' "$PASSOS" | while IFS='|' read -r id min req rb desc; do
    printf '%-14s %-5s %-6s %s [%s]\n' "$id" "$min" "$(hora_nominal "$min")" "$desc" "$rb"
  done
}
proximo() {
  printf '%s\n' "$PASSOS" | while IFS='|' read -r id _; do
    s=$(estado_de "$id")
    if [ "$s" != OK ] && [ "$s" != PULADO ]; then echo "$id"; break; fi
  done
}
cmd_status() {
  agora=$(( ( $(date +%s) - $(date -j -f '%Y-%m-%d %H:%M:%S' "$(date +%F) $T_JANELA:00" +%s 2> /dev/null || date -d "$(date +%F) $T_JANELA:00" +%s) ) / 60 ))
  echo "agora = T$( [ "$agora" -ge 0 ] && echo "+$agora" || echo "$agora" ) min (T = $T_JANELA); pasta $D"
  printf '%s\n' "$PASSOS" | while IFS='|' read -r id min req rb desc; do
    s=$(estado_de "$id"); printf '%-7s %-14s %-6s %s\n' "${s:--}" "$id" "$(hora_nominal "$min")" "$desc"
  done
  prox=$(proximo)
  [ -z "$prox" ] && echo "próximo: nenhum (tudo feito)" || echo "próximo: $prox"
}
cmd_pular() {
  [ $# -ge 2 ] || { echo "uso: janela.sh pular <passo> <motivo>" >&2; exit 2; }
  info_passo "$1" > /dev/null || { echo "passo desconhecido: $1" >&2; exit 2; }
  printf '%s PULADO %s\n' "$1" "$(date +%s)" >> "$EST"; log "PULADO $1: ${*:2}"; echo "$1 PULADO ($(echo "${*:2}" | oculta))"
}

# P17 (pré-voo; não faz parte da janela): o Chatwoot passa a falar com a central, que faz proxy à edge. A reversão está nos scripts.
cmd_p17() {
  say "P17: nginx da central com as rotas do Chatwoot em modo edge, depois CRM_EVENT_WEBHOOK_URL -> central (rails e sidekiq recriados)"
  exe sh "$V/ops/virada/preparar-vps.sh" arquivos || { echo "FALHOU -> nada mudou no Chatwoot"; exit 1; }
  exe sh "$V/ops/virada/spool-nginx.sh" edge || { echo "FALHOU -> nginx voltou ao anterior"; exit 1; }
  exe vps "CONFERE_EDGE=1 sh /root/virada/t16-chatwoot-go.sh" || { echo "FALHOU -> o script voltou o .env do Chatwoot (confira: janela.sh preflight)"; exit 1; }
  say "P17 OK. Mensagem de teste numa conversa do Chatwoot e conferir 200 na rota em /var/log/nginx/saude.log. Reverter: cp /root/virada/chatwoot/env.<hora> /opt/chatwoot/.env e recriar rails e sidekiq."
  echo "OK"
}

# ---------------------------------------------------------------------------------------------------------------------------------------
# --- rollbacks (roteiro §6). Só desfazem o que a janela fez (estado em $D/estado); FORCAR=1 desfaz tudo.
feito() { [ "$DRY" = 1 ] && return 0; s=$(estado_de "$1"); [ "$s" = OK ] || [ "$s" = FALHOU ] || [ "${FORCAR:-0}" = 1 ]; }
fotos_ok() { # as fotos do Supabase que os passos feitos deviam ter deixado em $D/sb: sem elas o descongelar "passa" sem fazer nada
  if feito t-30-supabase && [ "$DRY" != 1 ] && [ ! -s "$D/sb/cron-antes.tsv" ]; then say "FALHOU: sem $D/sb/cron-antes.tsv: este D não é o da janela (ponteiro ~/.virada-janela-atual?) e o pg_cron não seria religado"; return 1; fi
  if feito t+0 && [ "$DRY" != 1 ] && [ ! -s "$D/sb/acl-antes.tsv" ]; then say "FALHOU: sem $D/sb/acl-antes.tsv: este D não é o da janela e o Supabase continuaria congelado"; return 1; fi
  return 0
}
# depois de um rollback os passos de ida deixam de valer: guarda o estado e recomeça vazio (senão t+10-nginx passaria como se nada tivesse voltado)
encerra_estado() { [ "$DRY" = 1 ] || { mv "$EST" "$D/estado.rollback-$(date +%H%M%S)"; : > "$EST"; }; }
# Chatwoot: se as rotas estão no spool, o spool devolve à edge; se estão no Go, voltam para a edge (já descongelada)
chatwoot_para_edge() {
  exe vps_b1 modo-chatwoot || return 1
  case "$(head -n 1 "$ULT")" in
    spool) exe sh "$V/ops/virada/spool-desliga.sh" edge ;;
    go) exe sh "$V/ops/virada/spool-nginx.sh" edge ;;
    *) say "rotas do Chatwoot: $(head -n 1 "$ULT"): nada a fazer" ;;
  esac
}

# Rollback A: antes do nginx do T+10 e antes do spool ir ao Go; nada escreveu no Go. Meta <= 5 min.
cmd_rollback_a() {
  say "=== ROLLBACK A (meta <= 5 min)"
  sb || exit 1
  fotos_ok || exit 1
  if [ "$DRY" != 1 ]; then
    [ ! -e "$D/spool-foi-ao-go" ] || { echo "FALHOU: o spool já levou eventos do Chatwoot ao Go (t+9b): o caminho é o rollback B (traz o delta de volta)"; exit 1; }
    vps "grep -c central-api.conf /etc/nginx/sites-enabled/central.rbvcompany.com" > "$ULT" 2>&1
    [ "$(head -n 1 "$ULT")" = 0 ] || { echo "FALHOU: o nginx já inclui o Go (T+10 feito): o caminho é o rollback B (janela.sh rollback-b)"; exit 1; }
  fi
  rc=0
  say "A1 parar API e worker";                  exe vps_b1 parar || rc=1
  if feito t-30-supabase || feito t+0; then say "A2 descongelar o Supabase"; exe sh "$V/ops/virada/supabase.sh" descongelar "$SB" "$D/sb" || rc=1; fi
  if feito t-30-core; then say "A3 Core: env de antes da janela"; exe sh "$V/ops/virada/core-destinos.sh" restaurar || rc=1; fi
  say "A3b Chatwoot: o replay devolve à edge (já descongelada)"; chatwoot_para_edge || rc=1
  if feito t-29; then say "A4 robôs e Actions de volta (cron.d, cartoes-ean, workflows que estavam ativos)"; exe sh "$J/t29-desfazer.sh" "$D" || rc=1; fi
  [ "$DRY" = 1 ] || { vps "grep -c '^SAIU_DO_SUPABASE=' /etc/robos.env" > "$ULT" 2>&1; [ "$(head -n 1 "$ULT")" = 0 ] || say "ATENÇÃO: /etc/robos.env já tem SAIU_DO_SUPABASE (o T+17 rodou?): rode 'bash /root/virada/t17-robos.sh reverter' na VPS"; }
  say "A5 api-db volta a ser de ensaio (nada no Go a guardar)"
  exe vps "rm -f /root/api-db/PRODUCAO" || rc=1
  tunel_fecha
  [ $rc = 0 ] && { encerra_estado; say "ROLLBACK A CONCLUÍDO. Confira: Supabase descongelado (ACL e pg_cron iguais), /up do Core 200, cartoes-ean ativo."; echo "OK"; exit 0; }
  say "ROLLBACK A COM FALHA: veja acima qual passo (cada um é independente; repita o que falhou à mão; o estado foi mantido)"; echo "FALHOU -> rollback A incompleto"; exit 1
}

# Rollback B, parte 1 (B1 e B2): nada mais escreve no Go; delta do que o Go ganhou. Meta B1+B2 ~ 8 min.
cmd_rollback_b() {
  say "=== ROLLBACK B parte 1: parar de escrever no Go e tirar o delta"
  sb || exit 1
  fotos_ok || exit 1
  supa=$(coletor_var SUPABASE_URL); [ "$DRY" = 1 ] && supa=https://REF.supabase.co
  [ -n "$supa" ] || { echo "FALHOU: sem SUPABASE_URL em coletor/.env (o delta devolve o host do Storage ao do Supabase)"; exit 1; }
  rc=0
  if feito t+11; then say "B1a front para a release anterior"; exe vps "bash /root/virada/t11-front.sh reverter" || rc=1; fi
  if feito t+10-nginx; then say "B1b nginx como era antes do T+10"; exe vps_b1 nginx-reverter || rc=1; fi
  # Chatwoot: segura os eventos no spool até o Supabase voltar (falhar aqui = evento perdido: é falha do B1)
  exe vps_b1 host-chatwoot || rc=1
  if [ "$DRY" = 1 ] || grep -q 'central.rbvcompany.com' "$ULT"; then say "B1c spool segura o Chatwoot durante o rollback"; exe sh "$V/ops/virada/spool-liga.sh" || { say "FALHOU: o spool não ligou: o Chatwoot bate num Go parado e os eventos se perdem"; rc=1; }; fi
  if feito t+14; then say "B1d Core retém de novo (os webhooks da loja voltam a ficar pendentes, sem se perder)"; exe sh "$V/ops/virada/core-destinos.sh" instalar /root/virada/core/core.env.janela || rc=1; fi
  say "B1e revogar a fumaça e parar API e worker"; exe vps_b1 revogar-fumaca; exe vps_b1 parar || rc=1
  [ $rc = 0 ] || { say "B1 COM FALHA: nada mais deve escrever no Go; resolva antes do delta"; echo "FALHOU -> rollback B parte 1"; exit 1; }
  say "B2 pg_dump do api e delta (foto do corte vs agora)"
  tunel_abre || exit 1
  mkdir -p "$D/delta"
  exe vps "umask 077; mkdir -p /root/backups-api && docker exec api-db pg_dump -U api -Fc api > /root/backups-api/rollback-\$(date +%Y%m%d-%H%M).dump && ls -t /root/backups-api/rollback-* | head -n 1" || exit 1
  export DELTA_HOST_GO=https://central.rbvcompany.com DELTA_HOST_SUPABASE="${supa%/}"
  [ -s "$D/corte/tabelas.txt" ] || { [ "$DRY" = 1 ] || sbs -c "select tablename from pg_tables where schemaname = 'public' order by 1" > "$D/corte/tabelas.txt"; }
  exe sh "$V/ops/virada/delta.sh" base "$(url_de api_corte)" "$D/delta" "$D/corte/tabelas.txt" || exit 1
  exe sh "$V/ops/virada/delta.sh" exportar "$ALVO" "$D/delta" || { say "delta.sh exportar falhou (tabela sem chave primária que mudou? está listada acima: replay à mão)"; exit 1; }
  say "resumo do delta (tabela, novas, alteradas, apagadas):"
  [ "$DRY" = 1 ] || sed 's/^/  /' "$D/delta/resumo.tsv"
  say "O DONO lê o resumo. Seguindo: bash ops/virada/janela.sh rollback-b-replay"
  echo "OK"
}

# Rollback B, parte 2 (B3 a B6): replay no Supabase ainda congelado, comparação, lista do que não volta, descongelar e serviços.
cmd_rollback_b_replay() {
  say "=== ROLLBACK B parte 2: replay no Supabase, comparar, descongelar"
  sb || exit 1
  fotos_ok || exit 1
  [ "$DRY" = 1 ] || [ -s "$D/delta/replay.sql" ] || { echo "FALHOU: sem $D/delta/replay.sql (rode rollback-b antes)"; exit 1; }
  if [ -e "$D/delta/replay-feito" ] && [ "$DRY" != 1 ]; then say "B3 replay já feito e conferido neste D: seguindo para o B5"; else
    say "B3a o Supabase não pode ter mudado depois do corte"
    exe sh "$V/ops/virada/delta.sh" destino "$SB" "$D/delta" || { echo "FALHOU: MUDOU no destino: alguém escreveu no Supabase depois do congelamento; descubra quem antes do replay"; exit 1; }
    confere "destino intacto" 'destino intacto' || { echo "FALHOU: o destino não está intacto"; exit 1; }
    say "B3b replay (uma transação)";   exe psql "$SB" -X -v ON_ERROR_STOP=1 -f "$D/delta/replay.sql" || { echo "FALHOU: replay (a transação desfez tudo; o Supabase segue congelado)"; exit 1; }
    say "B3c comparar linha a linha";   exe sh "$V/ops/virada/delta.sh" comparar "$SB" "$D/delta" || { echo "FALHOU: o Supabase não ficou igual ao Go"; exit 1; }
    confere "igual" 'IGUAL: [0-9]+ tabelas' || { echo "FALHOU: sem IGUAL"; exit 1; }
    [ "$DRY" = 1 ] || : > "$D/delta/replay-feito"
  fi
  say "B4 o que NÃO volta: logins/senhas/convites feitos no Go (usuarios não volta ao auth.users) e arquivos enviados ao disco depois da troca"
  [ "$DRY" = 1 ] || { vps "find /var/lib/api/arquivos -newer /root/virada/troca-hora.txt -type f 2>/dev/null || find /var/lib/api/arquivos -newer /root/api-db/PRODUCAO -type f" > "$D/nao-volta.txt" 2>&1; say "arquivos novos no disco: $(wc -l < "$D/nao-volta.txt" | tr -d ' ') (lista em $D/nao-volta.txt; subir ao Storage à mão)"; }
  rc=0
  say "B5a descongelar o Supabase";    exe sh "$V/ops/virada/supabase.sh" descongelar "$SB" "$D/sb" || rc=1
  if feito t-30-core; then say "B5b Core com o env de antes"; exe sh "$V/ops/virada/core-destinos.sh" restaurar || rc=1; fi
  say "B5c Chatwoot na edge: o spool devolve o que segurou"; chatwoot_para_edge || rc=1
  say "B5d robôs, Actions, PDV, site, Vessel e worker (só o que a janela fez)"
  feito t+17-robos && { exe vps "bash /root/virada/t17-robos.sh reverter" || rc=1; }
  feito t+17-actions && { exe sh "$J/t17-actions.sh" "$D" --reverter || rc=1; }
  feito t-29 && { exe sh "$J/t29-desfazer.sh" "$D" || rc=1; }
  feito t+17-pdv && { exe vps "bash /root/virada/t17-pdv.sh reverter" || rc=1; }
  feito t+17-site && { exe sh "$J/t17-site.sh" reverter || rc=1; }
  feito t+19 && { exe vps "bash /root/virada/t19-vessel.sh reverter" || rc=1; }
  feito t+20 && { exe vps "bash /root/virada/t20-worker.sh reverter" || rc=1; }
  say "B6 /root/api-db/PRODUCAO FICA (o api-db guarda o que foi escrito depois do corte); só sai com ok do dono, depois de D+14"
  tunel_fecha
  say "A CONFERIR À MÃO: fumaça do deploy do Chatwoot/PDV/site; o webhook de pedidos da Shopify não mudou (todos já apontam ao Core)."
  [ $rc = 0 ] && { encerra_estado; say "ROLLBACK B CONCLUÍDO"; echo "OK"; exit 0; }
  say "ROLLBACK B COM FALHA em algum passo acima (cada um é independente; repita à mão; o estado foi mantido)"; echo "FALHOU -> rollback B incompleto"; exit 1
}

# Ensaio a seco: só os modos seguros dos scripts (nada muda em produção). Imprime `ok`/`FALHOU` por item e o total.
cmd_ensaio() {
  falhas=0
  tenta() { # tenta "nome" cmd...
    n=$1; shift
    if "$@" > "$D/.ensaio.out" 2>&1; then echo "ok     $n"; else echo "FALHOU $n"; oculta < "$D/.ensaio.out" | tail -n 5 | sed 's/^/         /'; falhas=$((falhas + 1)); fi
  }
  tenta "t-30-core   core-destinos.sh janela --imprimir" sh "$V/ops/virada/core-destinos.sh" janela --imprimir
  tenta "t-29        t29-fase-a.sh --ensaio" sh "$J/t29-fase-a.sh" "$V" "$D" --ensaio
  tenta "t+10-nginx  t10-nginx.sh na cópia (TESTE=1)" $SSH "$VPS" "TESTE=1 NGINX_DIR=/root/virada/nginx-teste sh /root/virada/t10-nginx.sh"
  tenta "t+14        t14-core-go.sh --imprimir" $SSH "$VPS" "sh /root/virada/t14-core-go.sh --imprimir"
  tenta "t+16        t16-chatwoot-go.sh --imprimir" $SSH "$VPS" "sh /root/virada/t16-chatwoot-go.sh --imprimir"
  tenta "t+17-pdv    t17-pdv.sh conferir" $SSH "$VPS" "bash /root/virada/t17-pdv.sh conferir"
  tenta "t+17-site   t17-site.sh conferir" sh "$J/t17-site.sh" conferir
  tenta "t+17-actions t17-actions.sh --ensaio" sh "$J/t17-actions.sh" "$D" --ensaio
  tenta "t+20        t20-worker.sh conferir" $SSH "$VPS" "bash /root/virada/t20-worker.sh conferir"
  rm -f "$D/.ensaio.out"
  [ $falhas = 0 ] && { echo "ENSAIO A SECO OK"; exit 0; }
  echo "ENSAIO A SECO: $falhas item(ns) falharam"; exit 1
}

cmd=${1:-}
[ -n "$cmd" ] || { sed -n '2,24p' "$0" >&2; exit 2; }
shift
case "$cmd" in
  lista) cmd_lista ;;
  status) cmd_status ;;
  pular) cmd_pular "$@" ;;
  p17) cmd_p17 ;;
  preflight) exec sh "$V/ops/virada/preflight-janela.sh" "$@" ;;
  ensaio) cmd_ensaio ;;
  verifica) exec bash "$V/ops/virada/verifica-virada.sh" "${@:-todos}" ;;
  rollback-a) cmd_rollback_a ;;
  rollback-b) cmd_rollback_b ;;
  rollback-b-replay) cmd_rollback_b_replay ;;
  -h|--help|ajuda) sed -n '2,24p' "$0" ;;
  *) roda_passo "$cmd" ;;
esac
