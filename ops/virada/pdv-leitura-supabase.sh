#!/bin/sh
# Tira do papel `pdv_leitura` do Supabase o SELECT nas 181 tabelas do public (e a regra de default privileges que dá
# SELECT em toda tabela nova) e deixa só as 6 colunas que o PDV lê (pdv-backend, src/catalogo/pecas-origem.service.ts):
#   select p.codigo, l.sku, p.numero_na_serie, p.criado_em from public.vessel_pecas p
#   join public.vessel_lotes l on l.id = p.lote_id where l.sku is not null
# O `bypassrls` FICA: vessel_pecas e vessel_lotes têm RLS e só policy para `authenticated`; sem ele o PDV lê 0 linhas,
# sem erro. Com SELECT só nessas colunas, ele não abre mais nada. O papel morre na virada (no api-db, papel-pdv.sql).
# Roda como `postgres` (dono do public e quem deu todo GRANT ao papel). No Supabase o `postgres` NÃO pode `SET ROLE
# pdv_leitura` (membro sem SET): por isso a prova antes do COMMIT usa has_column_privilege, a mesma checagem de ACL do
# executor, e a prova com o papel de verdade é o `ler`, logado com a URL do próprio PDV.
# Uso: sh ops/virada/pdv-leitura-supabase.sh <acao> DB_URL DIR   (DIR guarda a foto de "antes"; nunca a sobrescreve)
#   foto      grava DIR/pdv_leitura-acl-antes.tsv e DIR/pdv_leitura-grants-antes.sql (a reversão, em 1 transação)
#   aplicar   exige a foto; numa transação revoga tudo, dá as 6 colunas e confere antes do COMMIT: o papel lê
#             exatamente essas 6 colunas do public, nenhum privilégio de tabela nem default, bypassrls ligado e a
#             consulta do PDV com linhas. Qualquer falha desfaz tudo. Rodar 2× dá o mesmo resultado.
#   ler       DB_URL = a URL do PDV (papel pdv_leitura): imprime "linhas=N shopify_pedidos=… vessel_pecas_tudo=…
#             profiles=…" (negado | lido | erro); sai 1 se N = 0
#   reverter  roda DIR/pdv_leitura-grants-antes.sql e confere com a foto (tabela que sumiu: pula, avisa e sai 1)
# Saída: 0 ok e conferido; 1 falhou ou divergiu; 2 uso.
set -eu
ACAO=${1:-}; URL=${2:-}; DIR=${3:-}
[ -n "$ACAO" ] && [ -n "$URL" ] && [ -n "$DIR" ] || { sed -n '11,19p' "$0" >&2; exit 2; }
AQUI=$(cd "$(dirname "$0")" && pwd)
. "$AQUI/../migracao/oculta.sh"
umask 077; mkdir -p "$DIR"; DIR=$(cd "$DIR" && pwd)
URL=$(printf '%s' "$URL" | sed 's#:6543/#:5432/#')   # pooler de sessão, não o de transação
TAB=$(printf '\t')
FOTO="$DIR/pdv_leitura-acl-antes.tsv"; REVERTER="$DIR/pdv_leitura-grants-antes.sql"
q() { _q=0; psql "$URL" -X -q -v ON_ERROR_STOP=1 -At -F "$TAB" "$@" 2> "$DIR/.erro" || _q=$?; oculta < "$DIR/.erro" >&2; rm -f "$DIR/.erro"; return $((_q > 0)); }

CONSULTA_PDV="select p.codigo, l.sku, p.numero_na_serie, p.criado_em from public.vessel_pecas p
 join public.vessel_lotes l on l.id = p.lote_id where l.sku is not null"
PDV="a.grantee = 'pdv_leitura'::regrole"
TABELAS="from pg_class c, aclexplode(c.relacl) a where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p', 'v', 'm', 'f')"
COLUNAS="from pg_attribute t join pg_class c on c.oid = t.attrelid, aclexplode(t.attacl) a
 where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p', 'v', 'm', 'f') and t.attacl is not null"
PADRAO="from pg_default_acl d, aclexplode(d.defaclacl) a"
DONO_PADRAO="format('for role %I%s', pg_get_userbyid(d.defaclrole),
                    case when d.defaclnamespace = 0 then '' else format(' in schema %I', d.defaclnamespace::regnamespace) end)"
TIPO_PADRAO="case d.defaclobjtype when 'r' then 'tables' when 'S' then 'sequences' when 'f' then 'functions'
                                   when 'T' then 'types' when 'n' then 'schemas' end"
OPCAO="case when a.is_grantable then ' with grant option' else '' end"
foto_acl() {
  q -c "select 'papel', 'pdv_leitura', format('login=%s bypassrls=%s inherit=%s connlimit=%s', rolcanlogin, rolbypassrls, rolinherit, rolconnlimit), '', '', ''
          from pg_roles where rolname = 'pdv_leitura'
        union all
        select 'tabela', format('public.%I', c.relname), 'pdv_leitura', a.privilege_type, a.is_grantable::text, pg_get_userbyid(a.grantor) $TABELAS and $PDV
        union all
        select 'coluna', format('public.%I.%I', c.relname, t.attname), 'pdv_leitura', a.privilege_type, a.is_grantable::text, pg_get_userbyid(a.grantor) $COLUNAS and $PDV
        union all
        select 'padrao', $DONO_PADRAO || ' ' || $TIPO_PADRAO, 'pdv_leitura', a.privilege_type, a.is_grantable::text, pg_get_userbyid(a.grantor) $PADRAO where $PDV
        order by 1, 2, 4"
}
# grant que o REVOKE/reversão daqui não cobrem (sequência, outro schema, rotina explícita): foto incompleta, recusa
fora_do_alcance() {
  q -c "select (select count(*) from pg_class c, aclexplode(c.relacl) a where $PDV
                 and not (c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p', 'v', 'm', 'f')))
             + (select count(*) from pg_attribute t join pg_class c on c.oid = t.attrelid, aclexplode(t.attacl) a
                 where t.attacl is not null and $PDV and c.relnamespace <> 'public'::regnamespace)
             + (select count(*) from pg_proc p, aclexplode(p.proacl) a where $PDV)"
}
# o `aplicar` falhou: diz se a ACL é mesmo a da foto (uma queda durante o COMMIT pode ter gravado)
nao_aplicou() {
  if foto_acl 2> /dev/null | grep -v '^papel' > "$DIR/.agora" && grep -v '^papel' "$FOTO" | diff -q - "$DIR/.agora" > /dev/null
  then echo "NÃO APLICADO: a transação foi desfeita, a ACL é a da foto" >&2
  else echo "FALHOU e a ACL NÃO é a da foto (ou não deu para lê-la): rode 'ler' e decida entre 'reverter' e 'aplicar'" >&2; fi
  rm -f "$DIR/.agora"; exit 1
}

case "$ACAO" in
foto)
  [ ! -e "$FOTO" ] && [ ! -e "$REVERTER" ] || { echo "já existe a foto em $DIR: recuso sobrescrever a de antes" >&2; exit 1; }
  n=$(fora_do_alcance)
  [ "$n" = 0 ] || { echo "pdv_leitura tem $n grant(s) fora das tabelas do public: a reversão não os cobriria" >&2; exit 1; }
  foto_acl > "$DIR/foto.tmp"
  grep -q '^papel' "$DIR/foto.tmp" || { rm -f "$DIR/foto.tmp"; echo "não existe o papel pdv_leitura" >&2; exit 1; }
  { echo "-- reversão do pdv-leitura-supabase.sh aplicar: devolve os grants de pdv_leitura como estavam na foto"
    echo "begin;"
    echo "revoke all on all tables in schema public from pdv_leitura;"
    # cada grant protegido: tabela/coluna apagada ou renomeada depois da foto não desfaz a reversão inteira (o diff acusa)
    q -c "select format('do \$r\$ begin %s exception when undefined_table or undefined_column then raise warning %L, sqlerrm; end \$r\$;',
                        g, 'reversão pulou (sumiu depois da foto): %')
            from (select format('grant %s on table public.%I to pdv_leitura%s;', a.privilege_type, c.relname, $OPCAO) $TABELAS and $PDV
                  union all
                  select format('grant %s (%I) on table public.%I to pdv_leitura%s;', a.privilege_type, t.attname, c.relname, $OPCAO) $COLUNAS and $PDV
                  union all
                  select format('alter default privileges %s grant %s on %s to pdv_leitura%s;', $DONO_PADRAO, a.privilege_type, $TIPO_PADRAO, $OPCAO)
                  $PADRAO where $PDV) s(g)
           order by g"
    echo "commit;"; } > "$DIR/reverter.tmp"
  mv "$DIR/reverter.tmp" "$REVERTER"; mv "$DIR/foto.tmp" "$FOTO"
  echo "foto: $(wc -l < "$FOTO" | tr -d ' ') linhas ($(grep -c "^tabela" "$FOTO" || true) de tabela, $(grep -c "^coluna" "$FOTO" || true) de coluna, $(grep -c "^padrao" "$FOTO" || true) default); reversão: $REVERTER";;
aplicar)
  [ -e "$FOTO" ] && [ -e "$REVERTER" ] || { echo "sem a foto em $DIR: rode 'foto' antes (é ela que reverte)" >&2; exit 1; }
  q -1 -f - <<SQL || nao_aplicou
revoke all on all tables in schema public from pdv_leitura;
alter default privileges for role postgres in schema public revoke all on tables from pdv_leitura;
grant select (codigo, lote_id, numero_na_serie, criado_em) on public.vessel_pecas to pdv_leitura;
grant select (id, sku) on public.vessel_lotes to pdv_leitura;
do \$\$
declare lidas text; n bigint;
begin
  select string_agg(format('%s.%s', c.relname, t.attname), ',' order by c.relname, t.attname) into lidas
    from pg_class c join pg_attribute t on t.attrelid = c.oid
   where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p', 'v', 'm', 'f') and t.attnum > 0
     and not t.attisdropped and has_column_privilege('pdv_leitura', c.oid, t.attnum, 'SELECT');
  if lidas is distinct from 'vessel_lotes.id,vessel_lotes.sku,vessel_pecas.codigo,vessel_pecas.criado_em,vessel_pecas.lote_id,vessel_pecas.numero_na_serie' then
    raise exception 'pdv_leitura leria estas colunas do public: %', coalesce(lidas, '(nenhuma)');
  end if;
  select count(*) into n from (select 1 $TABELAS and $PDV union all select 1 $PADRAO where $PDV) s;
  if n > 0 then raise exception 'sobraram % privilégio(s) de tabela ou default para pdv_leitura', n; end if;
  if not (select rolbypassrls from pg_roles where rolname = 'pdv_leitura') then
    raise exception 'pdv_leitura sem bypassrls: o RLS de vessel_* daria 0 linhas ao PDV';
  end if;
  select count(*) into n from ($CONSULTA_PDV) s;
  if n = 0 then raise exception 'a consulta do PDV dá 0 linhas'; end if;
  raise notice 'pdv_leitura: só as 6 colunas; a consulta do PDV dá % linhas', n;
end \$\$;
SQL
  echo "APLICADO: pdv_leitura lê só vessel_pecas(codigo, lote_id, numero_na_serie, criado_em) e vessel_lotes(id, sku)";;
ler)
  n=$(q -c "select count(*) from ($CONSULTA_PDV) s")
  sonda() { if psql "$URL" -X -q -At -c "$1" > /dev/null 2> "$DIR/.erro"; then echo lido
            elif grep -q 'permission denied' "$DIR/.erro"; then echo negado; else echo erro; fi; rm -f "$DIR/.erro"; }
  echo "linhas=$n shopify_pedidos=$(sonda 'select cliente_email from public.shopify_pedidos limit 1')" \
       "vessel_pecas_tudo=$(sonda 'select * from public.vessel_pecas limit 1')" \
       "profiles=$(sonda 'select 1 from public.profiles limit 1')"
  [ "$n" != 0 ] || { echo "o PDV lê 0 linhas" >&2; exit 1; };;
reverter)
  [ -e "$REVERTER" ] || { echo "sem $REVERTER: nada a reverter" >&2; exit 1; }
  q -f "$REVERTER" > /dev/null
  foto_acl > "$DIR/pdv_leitura-acl-depois.tsv"
  if diff "$FOTO" "$DIR/pdv_leitura-acl-depois.tsv" > "$DIR/pdv_leitura-acl.diff"; then echo "REVERTIDO: ACL igual à de antes ($(wc -l < "$FOTO" | tr -d ' ') linhas)"
  else echo "ACL DIFERENTE da de antes (ver $DIR/pdv_leitura-acl.diff)" >&2; exit 1; fi;;
*) sed -n '11,19p' "$0" >&2; exit 2;;
esac
