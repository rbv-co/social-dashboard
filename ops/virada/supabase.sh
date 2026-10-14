#!/bin/sh
# Congela e descongela o Supabase na virada, de forma REVERSÍVEL e conferida. Roda como `postgres`, dono de
# todo o schema public no Supabase (181 tabelas, 308 funções; todo GRANT dado por ele: conferido em 14/10/2026).
# Por que REVOKE e não `default_transaction_read_only` nem NOLOGIN: o PostgREST abre a transação de escrita com
# READ WRITE explícito, e o supautils reserva o `authenticator` (ALTER ROLE recusado). Revogar é do dono: garantido.
# Uso: sh ops/virada/supabase.sh <acao> DB_URL DIR   (DIR guarda as fotos de "antes"; nunca as sobrescreve)
#   desligar-cron  grava DIR/cron-antes.tsv (jobid, nome, ativo; SEM o comando, que tem token) e desativa
#                  TODO job ativo (cron.alter_job active=false: o job, o comando e o histórico ficam)
#   em-andamento   imprime "execuções abertas, fila do pg_net, segundos desde o último início"
#   congelar       grava DIR/acl-antes.tsv e DIR/reverter-acl.sql e, numa transação, revoga INSERT/UPDATE/
#                  DELETE/TRUNCATE das tabelas e EXECUTE das funções do public de PUBLIC, anon, authenticated e
#                  service_role: PostgREST, edges com a service key, site e robôs por REST passam a levar 401/403.
#                  NÃO pega quem conecta direto como `postgres` (robôs por pg): esses param antes (roteiro).
#   escritas       grava DIR/escritas-N.tsv (pg_stat_user_tables) e compara com a 1ª: tabela que mudou =
#                  alguém escreveu depois da 1ª foto
#   descongelar    roda DIR/reverter-acl.sql e religa os jobs que estavam ativos; confere ACL e jobs = antes
# Saída: 0 ok e conferido; 1 falhou ou divergiu; 2 uso.
set -eu
ACAO=${1:-}; URL=${2:-}; DIR=${3:-}
[ -n "$ACAO" ] && [ -n "$URL" ] && [ -n "$DIR" ] || { sed -n '6,19p' "$0" >&2; exit 2; }
AQUI=$(cd "$(dirname "$0")" && pwd)
. "$AQUI/../migracao/oculta.sh"
umask 077; mkdir -p "$DIR"; DIR=$(cd "$DIR" && pwd)
URL=$(printf '%s' "$URL" | sed 's#:6543/#:5432/#')   # pooler de sessão, não o de transação
TAB=$(printf '\t')
# psql com o stderr mascarado (a URL e o usuário não vazam), preservando a saída
q() { _q=0; psql "$URL" -X -q -v ON_ERROR_STOP=1 -At -F "$TAB" "$@" 2> "$DIR/.erro" || _q=$?; oculta < "$DIR/.erro" >&2; rm -f "$DIR/.erro"; return $_q; }

GRANTEE="case a.grantee when 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end"
ALVO="(a.grantee = 0 or pg_get_userbyid(a.grantee) in ('anon', 'authenticated', 'service_role'))"
TABELAS="from pg_class c, aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
 where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p', 'v', 'm', 'f')"
ROTINAS="from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
 where p.pronamespace = 'public'::regnamespace"
ROTINA="format('public.%I(%s)', p.proname, pg_get_function_identity_arguments(p.oid))"
foto_acl() {
  q -c "select 'tabela', format('public.%I', c.relname), $GRANTEE, a.privilege_type, a.is_grantable, pg_get_userbyid(a.grantor) $TABELAS
        union all
        select 'rotina', $ROTINA, $GRANTEE, a.privilege_type, a.is_grantable, pg_get_userbyid(a.grantor) $ROTINAS
        order by 1, 2, 3, 4"
}
foto_cron() { q -c "select jobid, jobname, active from cron.job order by jobid"; }
recusa_se_existe() { [ ! -e "$DIR/$1" ] || { echo "já existe $DIR/$1: recuso sobrescrever a foto de antes" >&2; exit 1; }; }

case "$ACAO" in
desligar-cron)
  recusa_se_existe cron-antes.tsv
  foto_cron > "$DIR/cron-antes.tmp" && mv "$DIR/cron-antes.tmp" "$DIR/cron-antes.tsv"
  echo "jobs: $(wc -l < "$DIR/cron-antes.tsv" | tr -d ' '), ativos antes: $(grep -c "${TAB}t\$" "$DIR/cron-antes.tsv" || true)"
  q -c "select count(*) from (select cron.alter_job(jobid, active := false) from cron.job where active) s" > /dev/null
  n=$(q -c "select count(*) from cron.job where active")
  [ "$n" = 0 ] || { echo "ainda há $n job(s) ativo(s)" >&2; exit 1; }
  echo "pg_cron: 0 jobs ativos (rode 'em-andamento' até dar 0 0)";;
em-andamento)
  q -c "select (select count(*) from cron.job_run_details where status in ('starting', 'running', 'sending', 'connecting')
                   and start_time > now() - interval '30 minutes'),
               (select count(*) from net.http_request_queue),
               (select coalesce(extract(epoch from now() - max(start_time))::int, -1) from cron.job_run_details)";;
congelar)
  recusa_se_existe acl-antes.tsv
  foto_acl > "$DIR/acl-antes.tmp"
  q -c "select format('grant %s on table public.%I to %s%s;', a.privilege_type, c.relname,
                      case a.grantee when 0 then 'public' else quote_ident(pg_get_userbyid(a.grantee)) end,
                      case when a.is_grantable then ' with grant option' else '' end)
        $TABELAS and $ALVO and a.privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE')
        union all
        select format('grant execute on routine %s to %s%s;', $ROTINA,
                      case a.grantee when 0 then 'public' else quote_ident(pg_get_userbyid(a.grantee)) end,
                      case when a.is_grantable then ' with grant option' else '' end)
        $ROTINAS and $ALVO and a.privilege_type = 'EXECUTE'" > "$DIR/reverter-acl.tmp"
  mv "$DIR/reverter-acl.tmp" "$DIR/reverter-acl.sql"; mv "$DIR/acl-antes.tmp" "$DIR/acl-antes.tsv"
  echo "foto da ACL: $(wc -l < "$DIR/acl-antes.tsv" | tr -d ' ') linhas; reversão: $(wc -l < "$DIR/reverter-acl.sql" | tr -d ' ') GRANTs"
  q -1 -c "revoke insert, update, delete, truncate on all tables in schema public from public, anon, authenticated, service_role" \
       -c "revoke execute on all routines in schema public from public, anon, authenticated, service_role"
  n=$(q -c "select count(*) from (select 1 $TABELAS and $ALVO and a.privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE')
                                  union all select 1 $ROTINAS and $ALVO and a.privilege_type = 'EXECUTE') s")
  [ "$n" = 0 ] || { echo "sobraram $n privilégios de escrita/execução para os papéis da API" >&2; exit 1; }
  echo "CONGELADO: nenhum privilégio de escrita nem de execução para PUBLIC/anon/authenticated/service_role";;
escritas)
  n=$(( $(ls "$DIR"/escritas-*.tsv 2>/dev/null | wc -l) + 1 ))
  q -c "select relname, n_tup_ins, n_tup_upd, n_tup_del from pg_stat_user_tables where schemaname = 'public' order by relname" > "$DIR/escritas-$n.tsv"
  [ "$n" -gt 1 ] || { echo "foto 1 das escritas gravada ($(wc -l < "$DIR/escritas-1.tsv" | tr -d ' ') tabelas)"; exit 0; }
  if diff "$DIR/escritas-1.tsv" "$DIR/escritas-$n.tsv" > "$DIR/escritas-$n.diff"; then echo "escritas: nenhuma tabela mudou desde a foto 1"
  else echo "ESCREVERAM depois da foto 1 (< antes, > agora):" >&2; cat "$DIR/escritas-$n.diff" >&2; exit 1; fi;;
descongelar)
  s=0
  if [ -e "$DIR/acl-antes.tsv" ]; then
    q -1 -f "$DIR/reverter-acl.sql"
    foto_acl > "$DIR/acl-depois.tsv"
    if diff "$DIR/acl-antes.tsv" "$DIR/acl-depois.tsv" > "$DIR/acl.diff"; then echo "ACL igual à de antes ($(wc -l < "$DIR/acl-antes.tsv" | tr -d ' ') linhas)"
    else echo "ACL DIFERENTE da de antes (ver $DIR/acl.diff)" >&2; s=1; fi
  else echo "sem acl-antes.tsv: nada a descongelar na ACL"; fi
  if [ -e "$DIR/cron-antes.tsv" ]; then
    ids=$(awk -F "$TAB" '$3 == "t" { printf "%s%s", v, $1; v = "," }' "$DIR/cron-antes.tsv")
    [ -z "$ids" ] || q -c "select count(*) from (select cron.alter_job(j, active := true) from unnest('{$ids}'::bigint[]) j) s" > /dev/null
    foto_cron > "$DIR/cron-depois.tsv"
    if diff "$DIR/cron-antes.tsv" "$DIR/cron-depois.tsv" > "$DIR/cron.diff"; then echo "pg_cron igual ao de antes ($(grep -c "${TAB}t\$" "$DIR/cron-depois.tsv" || true) ativos)"
    else echo "pg_cron DIFERENTE do de antes (ver $DIR/cron.diff)" >&2; s=1; fi
  else echo "sem cron-antes.tsv: nada a religar no pg_cron"; fi
  exit $s;;
*) sed -n '6,19p' "$0" >&2; exit 2;;
esac
