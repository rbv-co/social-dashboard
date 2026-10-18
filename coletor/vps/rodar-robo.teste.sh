#!/usr/bin/env bash
# Autoteste do rodar-robo.sh (precisa de Linux com flock; roda sem tocar em nada de produção).
# Uso: bash coletor/vps/rodar-robo.teste.sh
set -u
AQUI="$(cd "$(dirname "$0")" && pwd)"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
mkdir -p "$T/raiz/coletor"
git -C "$T/raiz" init -q
export RAIZ="$T/raiz" LOGS="$T/logs" LOCKS="$T" ENV_ROBOS="$T/robos.env" NODE_BIN="$T"
printf '%s\n' '# comentário' 'SEGREDO=valor-que-nao-pode-ir-pro-log' 'ASPAS="com aspas"' "PERIGO=a&b;touch $T/executou \$(touch $T/executou2)" '' > "$T/robos.env"
printf '#!/bin/sh\necho "$1" >> "%s/avisos"\n' "$T" > "$T/avisa.sh"; chmod +x "$T/avisa.sh"
echo "ALERT_COMANDO=$T/avisa.sh" >> "$T/robos.env"
printf '#!/bin/sh\nprintf "%%s\\n" "$*" >> "%s/curl-chamadas"\n' "$T" > "$T/curl"; chmod +x "$T/curl"
printf '%s\n' 'SUPABASE_URL=https://exemplo.supabase.co' 'SUPABASE_SERVICE_KEY=chave-que-nao-pode-ir-pro-log' >> "$T/robos.env"
falhas=0
confere() { if [ "$2" = "$3" ]; then echo "ok   $1"; else echo "FALHA $1 (esperado '$3', veio '$2')"; falhas=$((falhas + 1)); fi; }
R="$AQUI/rodar-robo.sh"

bash "$R" ok 1 -- sh -c 'test -n "$SEGREDO"'; confere "sucesso e env carregado" $? 0
[ -e "$T/logs/ok.falhou" ]; confere "sucesso não deixa marca de falha" $? 1
bash "$R" aspas 1 -- sh -c '[ "$ASPAS" = "com aspas" ]'; confere "aspas externas são removidas" $? 0
bash "$R" perigo 1 -- sh -c 'case "$PERIGO" in a\&b\;touch*) exit 0;; *) exit 1;; esac'; confere "valor com & ; \$() chega literal" $? 0
[ -e "$T/executou" ] || [ -e "$T/executou2" ]; confere "valor do env nunca é executado" $? 1

bash "$R" ruim 1 -- sh -c 'exit 3'; confere "falha devolve o código" $? 3
[ -e "$T/logs/ruim.falhou" ]; confere "falha deixa marca" $? 0
bash "$R" ruim 1 -- sh -c 'exit 3'; bash "$R" ruim 1 -- sh -c 'exit 3'
confere "aviso só na 1ª falha (3 falhas seguidas = 1 aviso)" "$(grep -c 'falhou na VPS' "$T/avisos")" 1
bash "$R" ruim 1 -- true; [ -e "$T/logs/ruim.falhou" ]; confere "sucesso seguinte limpa a marca" $? 1
confere "avisa quando volta ao normal" "$(grep -c 'voltou ao normal' "$T/avisos")" 1
touch -d '7 hours ago' "$T/logs/velha.falhou"; bash "$R" velha 1 -- sh -c 'exit 1'
confere "repete o aviso depois de 6 h de falha" "$(grep -c 'Robô velha falhou' "$T/avisos")" 1
bash "$R" ok 1 -- true
confere "sucesso sem falha anterior não avisa" "$(grep -c 'Robô ok' "$T/avisos")" 0

# painel da central: cada rodada vira uma linha em robos_execucoes (ok e falha), sem a chave na linha de comando do log
: > "$T/curl-chamadas"
bash "$R" painel-ok 1 -- true; bash "$R" painel-ruim 1 -- sh -c 'exit 2'
grep -q '"robo":"painel-ok","status_code":200,"ok":true' "$T/curl-chamadas"; confere "sucesso é gravado no painel" $? 0
grep -q '"robo":"painel-ruim","status_code":500,"ok":false,"resposta":"saiu com código 2' "$T/curl-chamadas"; confere "falha é gravada no painel" $? 0
grep -q "rest/v1/robos_execucoes" "$T/curl-chamadas"; confere "grava na tabela robos_execucoes" $? 0
# papel do robô no banco novo: ROBO_<NOME>_DATABASE_URL vira o DATABASE_URL só dele, e as dos outros somem do ambiente
printf '%s\n' 'DATABASE_URL=postgres://global' 'ROBO_PAPEL_DATABASE_URL=postgres://papel' 'ROBO_OUTRO_DATABASE_URL=postgres://outro' >> "$T/robos.env"
bash "$R" papel 1 -- sh -c '[ "$DATABASE_URL" = postgres://papel ]'; confere "ROBO_<NOME>_DATABASE_URL vira o DATABASE_URL do robô" $? 0
bash "$R" papel 1 -- sh -c 'env | grep -q "^ROBO_.*_DATABASE_URL"'; confere "nenhum robô enxerga a URL de papel de outro (nem a sua)" $? 1
bash "$R" sem-papel 1 -- sh -c '[ "$DATABASE_URL" = postgres://global ]'; confere "sem ROBO_<NOME>_DATABASE_URL o DATABASE_URL não muda" $? 0
# o host não resolve `api-db`: a URL ganha o IP do contêiner (docker falso); sem IP, a URL fica e o robô falha alto na conexão
printf '#!/bin/sh\necho "$IP_FALSO"\n' > "$T/docker"; chmod +x "$T/docker"
printf '%s\n' 'ROBO_NOME_DATABASE_URL=postgres://robo_x:s@api-db:5432/api' 'VIGIA_DATABASE_URL=postgres://robo_v:s@api-db:5432/api' >> "$T/robos.env"
IP_FALSO=172.20.0.9 bash "$R" nome 1 -- sh -c '[ "$DATABASE_URL" = postgres://robo_x:s@172.20.0.9:5432/api ] && [ "$VIGIA_DATABASE_URL" = postgres://robo_v:s@172.20.0.9:5432/api ]'; confere "@api-db: vira o IP da api_net" $? 0
IP_FALSO= bash "$R" nome 1 -- sh -c '[ "$DATABASE_URL" = postgres://robo_x:s@api-db:5432/api ]'; confere "sem IP a URL fica como está" $? 0
grep -q "não achei o IP do api-db" "$T/logs/nome.log"; confere "e o log diz por quê" $? 0
bash "$R" com-hifen-x 1 -- true; : > "$T/curl-chamadas"

# reportar por pg (REPORTAR_DATABASE_URL): precisa de TEST_DATABASE_URL (Postgres descartável) e do `pg` do coletor; sem eles, pula
if [ -n "${TEST_DATABASE_URL:-}" ] && [ -d "$AQUI/../node_modules/pg" ] && command -v psql >/dev/null; then
  BASE="${TEST_DATABASE_URL%%\?*}"; BD="reportar_t02_$$"
  psql "$BASE" -X -q -v ON_ERROR_STOP=1 -c "create database $BD" || exit 1
  trap 'psql "$BASE" -X -q -c "drop database if exists $BD" >/dev/null 2>&1; psql "$BASE" -X -q -c "drop role if exists robo_reporte" >/dev/null 2>&1; rm -rf "$T"' EXIT
  psql "$BASE" -X -q -c "drop role if exists robo_reporte" >/dev/null 2>&1
  psql "${BASE%/*}/$BD" -X -q -v ON_ERROR_STOP=1 -c "create table robos_execucoes (id bigserial primary key, robo text, disparado_em timestamptz default now(), status_code int, ok bool, resposta text, conferido_em timestamptz)" \
    -c "revoke execute on all functions in schema public from public" -c "alter default privileges revoke execute on functions from public"
  SENHA_ROBO_REPORTE=senha-so-deste-teste psql "${BASE%/*}/$BD" -X -q -v ON_ERROR_STOP=1 -f "$AQUI/../../ops/vps/api-db/papel-robo-reporte.sql"; confere "papel robo_reporte aplica" $? 0
  mkdir -p "$T/raiz/coletor/vps"; cp "$AQUI/reportar-rodada.mjs" "$T/raiz/coletor/vps/"; ln -s "$AQUI/../node_modules" "$T/raiz/coletor/node_modules"
  URL_PAPEL="$(printf %s "${BASE%/*}/$BD" | sed 's#//[^@/]*@#//#; s#//#//robo_reporte:senha-so-deste-teste@#')"
  echo "REPORTAR_DATABASE_URL=$URL_PAPEL" >> "$T/robos.env"
  bash "$R" pg-ok 1 -- sh -c 'test -z "$REPORTAR_DATABASE_URL"'; confere "REPORTAR_DATABASE_URL não chega ao comando do robô" $? 0; bash "$R" pg-ok 1 -- true; bash "$R" pg-ruim 1 -- sh -c 'exit 2'; c=$?
  confere "robô falho devolve o código dele mesmo com o painel por pg" $c 2
  n() { psql "${BASE%/*}/$BD" -X -q -At -c "$1"; }
  confere "2 rodadas do mesmo robô = 2 linhas" "$(n "select count(*) from robos_execucoes where robo = 'pg-ok' and ok and status_code = 200")" 2
  confere "falha gravada com 500 e o motivo" "$(n "select status_code::text || ok::text || resposta from robos_execucoes where robo = 'pg-ruim'" | cut -c1-40)" "500falsesaiu com código 2 (0s)"
  confere "por pg não passa pelo REST do Supabase" "$(wc -c < "$T/curl-chamadas" | tr -d ' ')" 0
  grep -rq "senha-so-deste-teste" "$T/logs"; confere "senha do papel não vaza para o log" $? 1
  # banco fora (porta fechada): o robô segue, o código de saída é o dele, e a rodada some do painel sem derrubar nada
  sed -i.bak '/^REPORTAR_DATABASE_URL=/d' "$T/robos.env"; echo 'REPORTAR_DATABASE_URL=postgres://robo_reporte:x@127.0.0.1:1/api' >> "$T/robos.env"
  bash "$R" pg-fora 1 -- true; confere "banco do painel fora NÃO derruba o robô" $? 0
  [ -e "$T/logs/pg-fora.falhou" ]; confere "e não deixa marca de falha" $? 1
  confere "robô com painel fora não grava nada" "$(n "select count(*) from robos_execucoes where robo = 'pg-fora'")" 0
  grep -q "não gravei a rodada de pg-fora" "$T/logs/pg-fora.log"; confere "a falha do painel fica no log" $? 0
  sed -i.bak '/^REPORTAR_DATABASE_URL=/d' "$T/robos.env"
else
  echo "pulado: reportar por pg (sem TEST_DATABASE_URL, psql ou coletor/node_modules)"
fi
bash "$R" 'nome ruim"' 1 -- true 2>/dev/null; confere "nome com aspas/espaço dá 64" $? 64

(bash "$R" lento 1 -- sleep 3 &) ; sleep 1
bash "$R" lento 1 -- true; confere "sobreposição é pulada com 0" $? 0
grep -q "pulada" "$T/logs/lento.log"; confere "sobreposição aparece no log" $? 0
sleep 3

bash "$R" sem-separador 1 true 2>/dev/null; confere "uso errado dá 64" $? 64

grep -rq "valor-que-nao-pode-ir-pro-log" "$T/logs"; confere "segredo não vaza para o log" $? 1

rm "$T/robos.env"; bash "$R" semenv 1 -- true; confere "sem arquivo de segredos dá 78" $? 78

[ "$falhas" -eq 0 ] && echo "TUDO OK" || { echo "$falhas falha(s)"; exit 1; }
