#!/bin/sh
# Prova local de supabase.sh (congelar/descongelar/pg_cron/escritas) e de delta.sh (foto, replay, comparação),
# num Postgres 17 que imita o Supabase no que importa: o dono do schema public SEM superusuário (`postgres` lá,
# `dono` aqui) com ADMIN nos papéis da API; anon/authenticated/service_role/authenticator; pg_cron de verdade com
# jobs do dono; grant por tabela e por coluna; função SECURITY DEFINER que escreve; função com EXECUTE fechado
# ao anon; gatilho, FK, coluna gerada, sequência; session_replication_role liberado ao dono (o supautils faz isso).
# Uso: sh ops/virada/ensaio-local.sh     Saída: 0 = tudo conferido; 1 = alguma prova falhou.
set -u
AQUI=$(cd "$(dirname "$0")" && pwd)
CONT=ensaio-virada-local; PORTA=${ENSAIO_PORTA:-58460}
OUT=$(mktemp -d)
limpa() { docker rm -fv "$CONT" > /dev/null 2>&1; rm -rf "$OUT"; }
trap limpa EXIT; trap 'exit 130' INT TERM
SU="postgres://postgres:x@127.0.0.1:$PORTA/postgres?sslmode=disable"
DONO="postgres://dono:x@127.0.0.1:$PORTA/postgres?sslmode=disable"
APP="postgres://dono:x@127.0.0.1:$PORTA/app?sslmode=disable"
BASE="postgres://dono:x@127.0.0.1:$PORTA/app_base?sslmode=disable"
FALHAS=0
ok() { echo "ok    $*"; }
falha() { echo "FALHA $*"; FALHAS=$((FALHAS + 1)); }
s() { psql "$1" -X -q -v ON_ERROR_STOP=1 -At -c "$2"; }
# espera o psql de verdade (o pg_isready responde antes da reinicialização final do entrypoint)
pronto() { for i in $(seq 60); do s "$SU" 'select 1' > /dev/null 2>&1 && return 0; sleep 1; done; echo "Postgres não subiu" >&2; exit 1; }
# deve_falhar URL PAPEL SQL: o comando, como PAPEL, tem de ser recusado por permissão (42501)
deve_falhar() { e=$(psql "$1" -X -q -At -c "set role $2" -c "$3" 2>&1); case "$e" in *"permission denied"*) ok "$2 recusado: $3";; *) falha "$2 NÃO foi recusado: $3 ($e)";; esac; }
deve_passar() { e=$(psql "$1" -X -q -At -v ON_ERROR_STOP=1 -c "set role $2" -c "$3" 2>&1) && ok "$2 pode: $3" || falha "$2 não pôde: $3 ($e)"; }

docker rm -fv "$CONT" > /dev/null 2>&1
docker run -d --name "$CONT" -e POSTGRES_PASSWORD=x -p "127.0.0.1:$PORTA:5432" postgres:17 > /dev/null || exit 1
pronto
docker exec "$CONT" sh -c 'apt-get update -qq > /dev/null 2>&1 && apt-get install -y -qq postgresql-17-cron > /dev/null 2>&1' || { echo "não instalou o pg_cron" >&2; exit 1; }
s "$SU" "alter system set shared_preload_libraries = 'pg_cron'" > /dev/null
s "$SU" "alter system set cron.database_name = 'postgres'" > /dev/null
docker restart "$CONT" > /dev/null; pronto

psql "$SU" -X -q -v ON_ERROR_STOP=1 > /dev/null <<'SQL' || { echo "preparo (superusuário) falhou" >&2; exit 1; }
create extension pg_cron;
create role dono login password 'x' nosuperuser createrole;
create role anon nologin; create role authenticated nologin; create role service_role nologin;
create role authenticator login password 'x' noinherit;
grant anon, authenticated, service_role to authenticator;
grant anon, authenticated, service_role to dono with admin option;
grant create, usage on schema public to dono;
grant usage on schema cron to dono;
grant execute on all functions in schema cron to dono;   -- como no Supabase (has_function_privilege = t)
grant set on parameter session_replication_role to dono;
create schema net; create table net.http_request_queue (id bigint);
grant usage on schema net to dono; grant select on net.http_request_queue to dono;
create database app owner dono;
SQL

# o "Supabase": objetos do dono, grants como os do Supabase (por tabela, por coluna, função fechada ao anon)
ESQUEMA="
create table public.pedidos (id bigserial primary key, cliente text not null, valor numeric, criado timestamptz default now());
create table public.itens (pedido_id bigint references public.pedidos (id), n int, sku text, primary key (pedido_id, n));
create table public.auditoria (id bigserial primary key, msg text);
create table public.contas (id uuid primary key default gen_random_uuid(), nome text, segredo text, foto text, dados jsonb, dobro numeric generated always as (length(nome) * 2) stored);
create table public.log_sem_pk (msg text);
create table public.eventos (id bigint generated always as identity primary key, tipo text);
create table public.so_da_api (id int primary key);
create function public.trg() returns trigger language plpgsql as \$\$ begin insert into public.auditoria (msg) values ('pedido ' || new.id); return new; end \$\$;
create trigger t_pedidos after insert on public.pedidos for each row execute function public.trg();
create function public.registrar(p text) returns void language sql security definer as \$\$ insert into public.log_sem_pk values (p) \$\$;
create function public.so_servico() returns int language sql as \$\$ select 1 \$\$;
revoke execute on function public.so_servico() from public, anon, authenticated;
grant execute on function public.so_servico() to service_role;
grant select, insert, update, delete on all tables in schema public to anon, authenticated, service_role;
grant usage on all sequences in schema public to anon, authenticated, service_role;
revoke all on public.contas from anon; grant select (id, nome) on public.contas to anon; grant update (nome) on public.contas to anon;
insert into public.pedidos (cliente, valor) values ('ana', 10), ('bia', 20), ('caio', 30);
insert into public.itens values (1, 1, 'A'), (1, 2, 'B'), (2, 1, 'C');
insert into public.contas (nome, segredo, foto, dados) values ('loja', 's1', 'https://ref.supabase.co/storage/v1/object/public/b/loja.png', '{\"img\": \"https://ref.supabase.co/storage/v1/object/public/b/l2.png\"}'), ('site', 's2', 'https://ref.supabase.co/storage/v1/object/public/b/site.png', null);
insert into public.log_sem_pk values ('um');
insert into public.eventos (tipo) values ('a'), ('b');"
for u in "$DONO" "$APP"; do psql "$u" -X -q -v ON_ERROR_STOP=1 -c "$ESQUEMA" > /dev/null || { echo "esquema falhou" >&2; exit 1; }; done
s "$DONO" "select cron.schedule('job-a', '* * * * *', 'select 1'), cron.schedule('job-b', '0 3 * * *', 'select 2'), cron.schedule('job-c', '0 4 * * *', 'select 3')" > /dev/null
s "$DONO" "select cron.alter_job(jobid, active := false) from cron.job where jobname = 'job-c'" > /dev/null

echo "== congelar e descongelar (supabase.sh)"
SB="$OUT/sb"
sh "$AQUI/supabase.sh" desligar-cron "$DONO" "$SB" && [ "$(s "$DONO" 'select count(*) from cron.job where active')" = 0 ] && ok "desligar-cron: 0 ativos" || falha "desligar-cron"
sh "$AQUI/supabase.sh" desligar-cron "$DONO" "$SB" > /dev/null 2>&1 && falha "desligar-cron repetido sobrescreveu a foto" || ok "desligar-cron repetido recusa"
[ "$(sh "$AQUI/supabase.sh" em-andamento "$DONO" "$SB" | awk -F '\t' '{ print NF }')" = 3 ] && ok "em-andamento: 3 números" || falha "em-andamento"
sh "$AQUI/supabase.sh" escritas "$DONO" "$SB" > /dev/null && ok "escritas: foto 1" || falha "escritas foto 1"
sh "$AQUI/supabase.sh" congelar "$DONO" "$SB" && ok "congelar" || falha "congelar"
sh "$AQUI/supabase.sh" congelar "$DONO" "$SB" > /dev/null 2>&1 && falha "congelar repetido sobrescreveu a foto" || ok "congelar repetido recusa"
deve_falhar "$DONO" authenticated "insert into public.pedidos (cliente) values ('x')"
deve_falhar "$DONO" service_role "update public.pedidos set valor = 1"
deve_falhar "$DONO" service_role "delete from public.itens"
deve_falhar "$DONO" anon "select public.registrar('x')"
deve_falhar "$DONO" service_role "select public.so_servico()"
deve_passar "$DONO" authenticated "select count(*) from public.pedidos"
deve_passar "$DONO" anon "select id, nome from public.contas"
deve_falhar "$DONO" anon "update public.contas set nome = nome"
s "$DONO" "insert into public.log_sem_pk values ('escritor direto')" > /dev/null   # o dono escreve: o REVOKE não pega
sleep 2
sh "$AQUI/supabase.sh" escritas "$DONO" "$SB" > /dev/null 2>&1 && falha "escritas não viu o escritor direto" || ok "escritas acusa o escritor direto (log_sem_pk)"
s "$DONO" "delete from public.log_sem_pk where msg = 'escritor direto'" > /dev/null
sh "$AQUI/supabase.sh" descongelar "$DONO" "$SB" && ok "descongelar: ACL e pg_cron iguais aos de antes" || falha "descongelar"
[ "$(s "$DONO" "select string_agg(jobname || '=' || active, ',' order by jobname) from cron.job")" = "job-a=true,job-b=true,job-c=false" ] && ok "pg_cron: a e b ativos, c inativo (como antes)" || falha "pg_cron depois de religar"
deve_passar "$DONO" authenticated "insert into public.pedidos (cliente) values ('depois')"
deve_passar "$DONO" anon "select public.registrar('depois')"
deve_falhar "$DONO" anon "select public.so_servico()"
deve_passar "$DONO" anon "update public.contas set nome = nome"
deve_passar "$DONO" service_role "select public.so_servico()"

echo "== delta e replay (delta.sh)"
D="$OUT/delta"; printf 'pedidos\nitens\nauditoria\ncontas\neventos\nlog_sem_pk\n' > "$OUT/tabelas.txt"
sh "$AQUI/delta.sh" base "$APP" "$D" "$OUT/tabelas.txt" && ok "foto do corte" || falha "foto do corte"
sh "$AQUI/delta.sh" base "$APP" "$D" "$OUT/tabelas.txt" > /dev/null 2>&1 && falha "base repetida sobrescreveu" || ok "base repetida recusa"
s "$SU" "create database app_base template app owner dono" > /dev/null || falha "clonar app_base (o Supabase congelado)"
# a troca de host do Storage no banco novo (trocar-host-das-urls-de-storage.mjs), depois do clone: não pode virar delta
s "$APP" "update public.contas set foto = replace(foto, 'https://ref.supabase.co/', 'https://central.exemplo.com/'), dados = replace(dados::text, 'https://ref.supabase.co/', 'https://central.exemplo.com/')::jsonb" > /dev/null
export DELTA_HOST_GO=https://central.exemplo.com DELTA_HOST_SUPABASE=https://ref.supabase.co
# o que a API faria depois da abertura: pedido novo (o gatilho grava auditoria), item novo com FK, conta alterada,
# item apagado e uma tabela só da API (fica fora do replay)
s "$APP" "insert into public.pedidos (cliente, valor) values ('davi', 40); insert into public.itens values (4, 1, 'D'); update public.contas set nome = 'loja nova' where nome = 'loja'; delete from public.itens where pedido_id = 2; insert into public.so_da_api values (1); insert into public.eventos (tipo) values ('c')" > /dev/null
sh "$AQUI/delta.sh" exportar "$APP" "$D" > "$OUT/exportar.txt" && ok "exportar" || falha "exportar"
[ "$(cat "$D/resumo.tsv")" = "$(printf 'auditoria\t1\t0\t0\ncontas\t0\t1\t0\neventos\t1\t0\t0\nitens\t1\t0\t1\npedidos\t1\t0\t0')" ] \
  && ok "resumo exato: auditoria 1 nova, contas 1 alterada, eventos (identity always) 1 nova, itens 1 nova e 1 apagada, pedidos 1 nova" || { falha "resumo do delta"; cat "$D/resumo.tsv"; }
psql "$BASE" -X -q -v ON_ERROR_STOP=1 -f "$D/replay.sql" > /dev/null && ok "replay no 'Supabase' (dono sem superusuário)" || falha "replay"
sh "$AQUI/delta.sh" comparar "$BASE" "$D" && ok "depois do replay, o 'Supabase' = Postgres novo, linha a linha (o gatilho não disparou de novo)" || falha "comparar depois do replay"
psql "$BASE" -X -q -v ON_ERROR_STOP=1 -f "$D/replay.sql" > /dev/null && sh "$AQUI/delta.sh" comparar "$BASE" "$D" > /dev/null && ok "replay repetido: continua igual (idempotente)" || falha "replay repetido"
[ "$(s "$BASE" "select count(*) from public.contas where foto like '%central.exemplo%' or dados::text like '%central.exemplo%'")" = 0 ] && ok "o replay devolve o host do Supabase (a conta alterada volta com a URL antiga)" || falha "host da central chegou ao 'Supabase'"
[ "$(s "$BASE" "select nextval('public.pedidos_id_seq') > (select max(id) from public.pedidos)")" = t ] && ok "sequência acertada: o próximo id não colide" || falha "sequência no replay"
s "$BASE" "insert into public.eventos (tipo) values ('depois do replay')" > /dev/null && ok "identity always: o próximo insert no 'Supabase' não colide" || falha "identity always depois do replay"
s "$APP" "insert into public.log_sem_pk values ('sem chave')" > /dev/null
sh "$AQUI/delta.sh" exportar "$APP" "$D" > /dev/null 2> "$OUT/err.txt" && falha "tabela sem PK mudou e o exportar saiu 0" || { grep -q 'log_sem_pk: SEM CHAVE' "$OUT/err.txt" && ok "tabela sem chave primária que mudou é acusada" || falha "aviso da tabela sem PK"; }

echo "== janela.sh (o runbook) contra o mesmo Postgres que imita o Supabase: só os passos que falam com o Supabase"
JD=$OUT/janela; s "$DONO" "select cron.schedule('push-vendas-22h', '0 1 * * *', 'select 1')" > /dev/null   # do dono: o pg_cron só mostra a cada papel os jobs dele
s "$SU" "delete from cron.job_run_details; insert into cron.job_run_details (jobid, database, username, command, status, start_time, end_time) select jobid, 'postgres', 'dono', 'select 1', 'succeeded', now() - interval '20 minutes', now() - interval '19 minutes' from cron.job where jobname = 'push-vendas-22h'"
jan() { FORCAR=1 D="$JD" SB="$DONO" ESPERA_MAX=0 INTERVALO=1 ATRASO_FOTO=1 sh "$AQUI/janela.sh" "$@" 2>&1; }
# t-32: o push das 22h saiu há 20 min; os jobs (a, b e o push) ainda estão ativos
r=$(jan t-32); [ "$(echo "$r" | tail -n 1)" = OK ] && ok "janela t-32: push-vendas-22h saiu" || { falha "janela t-32"; echo "$r" | tail -n 4; }
r=$(jan t-30-supabase); [ "$(echo "$r" | tail -n 1)" = OK ] && [ "$(s "$DONO" 'select count(*) from cron.job where active')" = 0 ] && ok "janela t-30-supabase: 0 jobs ativos" || { falha "janela t-30-supabase"; echo "$r" | tail -n 4; }
r=$(jan t-28); [ "$(echo "$r" | tail -n 1)" = OK ] && ok "janela t-28: nada em andamento" || { falha "janela t-28"; echo "$r" | tail -n 4; }
r=$(jan t-1); [ "$(echo "$r" | tail -n 1)" = OK ] && ok "janela t-1: nenhuma sessão ativa" || { falha "janela t-1"; echo "$r" | tail -n 4; }
r=$(jan t+0); [ "$(echo "$r" | tail -n 1)" = OK ] && ok "janela t+0: congelado" || { falha "janela t+0"; echo "$r" | tail -n 4; }
r=$(jan t+0.5); [ "$(echo "$r" | tail -n 1)" = OK ] && ok "janela t+0.5: foto 1 das escritas" || { falha "janela t+0.5"; echo "$r" | tail -n 4; }
sleep 2; r=$(jan t+9-escritas); [ "$(echo "$r" | tail -n 1)" = OK ] && ok "janela t+9-escritas: nada mudou" || { falha "janela t+9-escritas"; echo "$r" | tail -n 4; }
deve_falhar "$DONO" authenticated "insert into public.pedidos (cliente) values ('x')"
s "$DONO" "insert into public.log_sem_pk values ('escritor direto depois da foto')" > /dev/null; sleep 2
r=$(REPETIR=1 jan t+9-escritas); [ "$(echo "$r" | tail -n 1)" = "FALHOU -> rollback A (janela.sh rollback-a)" ] && ok "janela t+9-escritas acusa o escritor direto e manda para o rollback A" || { falha "janela t+9-escritas não acusou"; echo "$r" | tail -n 4; }
s "$DONO" "delete from public.log_sem_pk where msg = 'escritor direto depois da foto'" > /dev/null
sh "$AQUI/supabase.sh" descongelar "$DONO" "$JD/sb" > /dev/null && ok "descongelar (a reversão do rollback A, A2) devolve o que a janela tirou" || falha "descongelar da janela"
! grep -q 'postgres://' "$JD"/janela-*.log && ok "o log da janela não tem URL de banco" || falha "URL no log da janela"

echo "----"
[ "$FALHAS" = 0 ] && { mkdir -p "$AQUI/../migracao/saida" && echo "$(date '+%F %T') $(git -C "$AQUI" rev-parse HEAD)" > "$AQUI/../migracao/saida/ensaio-local.ok"; echo "ENSAIO LOCAL OK"; exit 0; } || { echo "ENSAIO LOCAL: $FALHAS falha(s)"; exit 1; }
