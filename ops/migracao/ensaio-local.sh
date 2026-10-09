#!/bin/sh
# Prova de ponta a ponta das ferramentas, sem tocar em produção: sobe um Postgres que imita o
# Supabase (schema auth, RLS, policies, grants, função que usa auth.uid() e extensions.*) e um
# alvo vazio; roda dump -> limpeza -> restore -> contagens e CONFERE o resultado.
# Uso: sh ops/migracao/ensaio-local.sh
set -eu
AQUI=$(cd "$(dirname "$0")" && pwd)
ORIG=ensaio-origem; ALVO=ensaio-alvo; PO=${ENSAIO_PORTA_ORIGEM:-58441}; PA=${ENSAIO_PORTA_ALVO:-58442}
OUT=$(mktemp -d)
limpa() { docker rm -f "$ORIG" "$ALVO" >/dev/null 2>&1 || true; rm -rf "$OUT"; }
trap limpa EXIT INT TERM
docker rm -f "$ORIG" "$ALVO" >/dev/null 2>&1 || true
for par in "$ORIG:$PO" "$ALVO:$PA"; do
  n=${par%%:*}; p=${par##*:}
  docker run -d --rm --name "$n" -e POSTGRES_PASSWORD=x -p 127.0.0.1:$p:5432 postgres:17 >/dev/null
done
for n in "$ORIG" "$ALVO"; do
  pronto=
  for i in $(seq 60); do docker exec "$n" pg_isready -h 127.0.0.1 -U postgres >/dev/null 2>&1 && { pronto=1; break; }; sleep 1; done
  [ -n "$pronto" ] || { echo "FALHOU: $n não ficou pronto" >&2; exit 1; }
done
# pg_isready responde antes da reinicialização final do entrypoint; espera um psql de verdade
for p in $PO $PA; do for i in $(seq 30); do psql "postgres://postgres:x@127.0.0.1:$p/postgres?sslmode=disable" -X -Atqc 'select 1' >/dev/null 2>&1 && break; sleep 1; done; done
URL_O="postgres://postgres:x@127.0.0.1:$PO/postgres?sslmode=disable"; URL_A="postgres://postgres:x@127.0.0.1:$PA/postgres?sslmode=disable"
T0=$(date +%s)

# 1) "Supabase de mentira"
psql "$URL_O" -X -q -v ON_ERROR_STOP=1 <<'SQL'
create role anon nologin; create role authenticated nologin; create role service_role nologin;
create schema extensions; create extension pgcrypto with schema extensions;
create extension "uuid-ossp" with schema extensions;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create table auth.users (id uuid primary key, email text);
create table public.profiles (id uuid primary key references auth.users(id) on delete cascade, nome text, disabled boolean default false);
create table public.notas (id serial primary key, dono uuid, texto text);
alter table public.notas enable row level security;
create policy "dono le" on public.notas for select to authenticated using (dono = auth.uid());
grant all on public.notas to anon, authenticated, service_role;
create function public.token_curto() returns text language sql as $$ select encode(extensions.gen_random_bytes(4), 'hex') $$;
create function public.quem() returns uuid language sql stable as $$ select auth.uid() $$;
create function public.cria_policy_dinamica() returns void language plpgsql as $f$
begin execute 'create policy x on public.notas using (true)'; end $f$;
insert into auth.users select gen_random_uuid(), 'u' || g || '@x.com' from generate_series(1, 2) g;
insert into public.profiles select id, case when email like 'u1%' then 'Ana' else 'Bia' end, email like 'u2%' from auth.users;
insert into public.notas (dono, texto) select id, 'nota ' || g from public.profiles, generate_series(1, 50) g;
SQL

# 2) dump -> limpeza -> restore -> contagens
t=$(date +%s); sh "$AQUI/dump-supabase.sh" "$URL_O" "$OUT/dump" >/dev/null; echo "dump: $(( $(date +%s) - t ))s"
t=$(date +%s); sh "$AQUI/restaurar.sh" "$URL_A" "$OUT/dump" >/dev/null; echo "restore: $(( $(date +%s) - t ))s"
t=$(date +%s); sh "$AQUI/conferir-contagens.sh" "$URL_O" "$URL_A" > "$OUT/contagens.txt" || true; echo "contagens: $(( $(date +%s) - t ))s"
cat "$OUT/contagens.txt"

# 2b) "importar-usuarios" simulado: copia os ids de auth.users da origem para public.usuarios do alvo
psql "$URL_O" -X -Atc "select id, email from auth.users" -F '|' | while IFS='|' read -r id email; do
  psql "$URL_A" -X -q -c "insert into public.usuarios (id, email) values ('$id', '$email')"
done
sh "$AQUI/conferir-orfaos.sh" "$URL_A" > "$OUT/orfaos.txt" || falha_orfaos=1

# 3) afirmações
falha() { echo "FALHOU: $1" >&2; exit 1; }
[ -z "${falha_orfaos:-}" ] || falha "FK com órfãos: $(grep -v ' 0$' "$OUT/orfaos.txt")"
[ "$(psql "$URL_A" -X -Atc "select count(*) from pg_constraint where contype='f' and confrelid='public.usuarios'::regclass and conrelid='public.profiles'::regclass")" = 1 ] || falha "a FK de profiles não aponta para public.usuarios"
[ "$(psql "$URL_A" -X -Atc "select count(*) from pg_namespace where nspname='auth' and exists (select 1 from pg_class c where c.relnamespace=pg_namespace.oid and c.relname='users')")" = 0 ] || falha "o alvo não deveria ter auth.users"
[ "$(psql "$URL_A" -X -Atc "select count(*) from pg_policies where schemaname='public'")" = 0 ] || falha "restaram policies"
[ "$(psql "$URL_A" -X -Atc "select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relrowsecurity")" = 0 ] || falha "restou RLS ligada"
[ "$(psql "$URL_A" -X -Atc "select length(public.token_curto())")" = 8 ] || falha "extensions.gen_random_bytes não funciona no alvo"
[ "$(psql "$URL_A" -X -Atc "select public.quem() is null")" = t ] || falha "auth.uid() deveria ser null sem app.usuario_id"
[ "$(psql "$URL_A" -X -Atc "select set_config('app.usuario_id','11111111-1111-1111-1111-111111111111',false); select public.quem()::text" | tail -1)" = 11111111-1111-1111-1111-111111111111 ] || falha "auth.uid() não lê app.usuario_id"
[ "$(psql "$URL_A" -X -Atc "select count(*) from pg_proc where proname='cria_policy_dinamica'")" = 1 ] || falha "a função com 'create policy' no corpo foi removida"
[ "$(psql "$URL_A" -X -Atc "select count(*) from public.notas")" = 100 ] || falha "dados não bateram"
[ "$(psql "$URL_A" -X -Atc "select count(*) from pg_trigger t join pg_class c on c.oid=t.tgrelid where c.relnamespace='public'::regnamespace and not t.tgisinternal and t.tgenabled='D'")" = 0 ] || falha "restou trigger desabilitado"
grep -q DIFERE "$OUT/contagens.txt" && falha "contagens diferem: $(grep DIFERE "$OUT/contagens.txt")"
echo "OK: ensaio local passou (dump -> limpeza -> restore -> contagens) em $(( $(date +%s) - T0 ))s"
