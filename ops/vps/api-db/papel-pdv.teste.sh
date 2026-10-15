#!/usr/bin/env bash
# Prova o papel `pdv_leitura` (papel-pdv.sql) num banco DESCARTÁVEL de um Postgres de teste que já esteja de pé (o mesmo
# dos testes Go; precisa de `psql` 17). Nada de produção. Cria um banco e o papel, e remove os dois no fim.
# Uso (na raiz do repositório):
#   TEST_DATABASE_URL='postgres://postgres@127.0.0.1:55606/postgres?sslmode=disable' bash ops/vps/api-db/papel-pdv.teste.sh
set -u
AQUI="$(cd "$(dirname "$0")" && pwd)"
SQL="$AQUI/papel-pdv.sql"
[ -n "${TEST_DATABASE_URL:-}" ] || { echo "falta TEST_DATABASE_URL"; exit 2; }
BASE="${TEST_DATABASE_URL%%\?*}"            # postgres://postgres@127.0.0.1:55606/postgres
SERVIDOR="${BASE%/*}"
SERVIDOR_PDV="$(printf %s "$SERVIDOR" | sed 's#//[^@/]*@#//pdv_leitura@#')"   # mesmo servidor, outro usuário
NOME="pdv_t06_$$"
falhas=0
confere() { if [ "$2" = "$3" ]; then echo "ok   $1"; else echo "FALHA $1 (esperado '$3', veio '$2')"; falhas=$((falhas + 1)); fi; }
nega() { # nega <descrição> <comando sql> : tem de falhar com permission denied
  local saida; saida="$(pdv -c "$2" 2>&1)"
  case "$saida" in *"permission denied"*) echo "ok   $1" ;; *) echo "FALHA $1 (veio: $saida)"; falhas=$((falhas + 1)) ;; esac
}
adm() { psql "$SERVIDOR/$NOME" -X -v ON_ERROR_STOP=1 -q -At "$@"; }
pdv() { psql "$SERVIDOR_PDV/$NOME" -X -q -At "$@"; }
limpar() { adm -c "drop owned by pdv_leitura" >/dev/null 2>&1; psql "$BASE" -X -q -c "drop database if exists $NOME" -c "drop role if exists pdv_leitura" >/dev/null 2>&1; }
trap limpar EXIT

psql "$BASE" -X -q -v ON_ERROR_STOP=1 -c "create database $NOME" || exit 1
adm <<'SQLX'
create table vessel_lotes (id uuid primary key, sku text, fornecedor text);
create table vessel_pecas (codigo text primary key, lote_id uuid references vessel_lotes, numero_na_serie int, gravada_em timestamptz, criado_em timestamptz, cartao_gerado_em timestamptz);
create table usuarios (id uuid primary key, email text, senha_hash text);
insert into vessel_lotes values ('aaaaaaaa-0000-0000-0000-000000000001', 'SS1A.01', 'fornecedor-secreto'), ('aaaaaaaa-0000-0000-0000-000000000002', null, 'x');
insert into vessel_pecas values ('ABXCKN5PZA', 'aaaaaaaa-0000-0000-0000-000000000001', 7, now(), now(), now()), ('SEMSKU0000', 'aaaaaaaa-0000-0000-0000-000000000002', 1, now(), now(), now());
insert into usuarios values ('aaaaaaaa-0000-0000-0000-000000000009', 'a@x', 'hash');
create function apaga_tudo() returns void language sql security definer as $$ delete from vessel_pecas $$;
-- a base do LEIA-ME (item 15): o dump vem sem GRANT e o papel-copia.sql tira o EXECUTE de PUBLIC
revoke execute on all functions in schema public from public;
alter default privileges revoke execute on functions from public;
SQLX

export SENHA_PDV=senha-so-deste-teste
for rodada in 1 2; do   # a segunda prova que reaplicar é seguro
  psql "$SERVIDOR/$NOME" -X -v ON_ERROR_STOP=1 -q -f "$SQL" >/dev/null 2>&1; confere "papel-pdv.sql roda (rodada $rodada)" "$?" "0"
done
unset SENHA_PDV
psql "$SERVIDOR/$NOME" -X -q -f "$SQL" >/dev/null 2>&1; confere "sem SENHA_PDV no ambiente o arquivo recusa" "$([ $? -ne 0 ] && echo recusou || echo rodou)" "recusou"

# a consulta EXATA do pecas-origem.service.ts
Q="select p.codigo, l.sku, p.numero_na_serie, p.criado_em is not null from public.vessel_pecas p join public.vessel_lotes l on l.id = p.lote_id where l.sku is not null"
confere "todas(): só a peça com SKU" "$(pdv -c "$Q")" "ABXCKN5PZA|SS1A.01|7|t"
confere "doCodigo(): uma peça" "$(pdv -c "$Q and p.codigo = 'ABXCKN5PZA' limit 1")" "ABXCKN5PZA|SS1A.01|7|t"
confere "papel sem superusuário, sem bypassrls, sem herança" "$(adm -c "select rolsuper, rolbypassrls, rolinherit, rolcanlogin from pg_roles where rolname = 'pdv_leitura'")" "f|f|f|t"

nega "não lê coluna fora da consulta (gravada_em)" "select gravada_em from vessel_pecas"
nega "não lê coluna fora da consulta (fornecedor)" "select fornecedor from vessel_lotes"
nega "não faz select * na tabela" "select * from vessel_pecas"
nega "não lê outra tabela (usuarios)" "select * from usuarios"
nega "não insere" "insert into vessel_pecas (codigo) values ('X')"
nega "não atualiza" "update vessel_pecas set numero_na_serie = 9 where codigo = 'ABXCKN5PZA'"
nega "não apaga" "delete from vessel_pecas"
nega "não executa função do banco" "select apaga_tudo()"
nega "não cria objeto no schema public" "create table public.invasor (x int)"
confere "nada foi apagado" "$(adm -c "select count(*) from vessel_pecas")" "2"

[ "$falhas" -eq 0 ] && echo "TUDO OK" || { echo "$falhas falha(s)"; exit 1; }
