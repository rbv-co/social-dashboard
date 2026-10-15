#!/bin/sh
# Teste do delta.sh em DOIS bancos descartáveis: `go` (o Postgres novo) e `sb` (o Supabase congelado). Prova o rollback
# tardio de ponta a ponta e a colisão de chave: escrita feita no Supabase DEPOIS do corte, com a mesma chave de uma linha
# nova do Go, tem de ser barrada por `delta.sh destino` (sem ele, o replay a sobrescreve em silêncio).
# Uso: DELTA_TEST_ADMIN_URL=postgres://postgres@127.0.0.1:55402/postgres sh ops/virada/delta.test.sh
# Cria e apaga os bancos delta_test_go e delta_test_sb nesse servidor. Nunca aponte para produção.
set -eu
ADMIN=${DELTA_TEST_ADMIN_URL:?uso: DELTA_TEST_ADMIN_URL=postgres://...@servidor-descartável/postgres sh $0}
case "$ADMIN" in *supabase*) echo "recuso: parece o Supabase" >&2; exit 2;; esac
AQUI=$(cd "$(dirname "$0")" && pwd); D="$AQUI/delta.sh"
base=${ADMIN%/*}; GO="$base/delta_test_go"; SB="$base/delta_test_sb"
T=$(mktemp -d); trap 'psql "$ADMIN" -X -q -c "drop database if exists delta_test_go" -c "drop database if exists delta_test_sb" >/dev/null 2>&1; rm -rf "$T"' EXIT
falha() { echo "FALHOU: $*" >&2; exit 1; }
for b in delta_test_go delta_test_sb; do psql "$ADMIN" -X -q -c "drop database if exists $b" -c "create database $b"; done
SEMENTE="create table pedidos (id bigint generated always as identity primary key, nome text);
         create table notas (id uuid primary key, texto text);
         insert into pedidos (nome) values ('a'), ('b'), ('c');
         insert into notas values ('00000000-0000-4000-8000-000000000001', 'x'), ('00000000-0000-4000-8000-000000000002', 'y');"
for u in "$GO" "$SB"; do psql "$u" -X -q -v ON_ERROR_STOP=1 -c "$SEMENTE"; done
printf 'pedidos\nnotas\n' > "$T/tabelas"

# o corte: foto do Go; o Supabase está igual
sh "$D" base "$GO" "$T/d" "$T/tabelas" >/dev/null
sh "$D" destino "$SB" "$T/d" >/dev/null || falha "destino igual ao corte tinha de passar"

# depois do corte, no Go: um pedido novo (id 4), um alterado, um apagado, uma nota nova
psql "$GO" -X -q -v ON_ERROR_STOP=1 -c "insert into pedidos (nome) values ('novo-do-go'); update pedidos set nome = 'a2' where id = 1; delete from pedidos where id = 2;
  insert into notas values ('00000000-0000-4000-8000-000000000003', 'nota-nova')"
# e no Supabase, depois do congelamento, alguém (robô por pg) grava um pedido: o id 4 colide com o do Go
psql "$SB" -X -q -v ON_ERROR_STOP=1 -c "insert into pedidos (id, nome) overriding system value values (4, 'escrito-no-supabase')"

sh "$D" exportar "$GO" "$T/d" >/dev/null || falha "exportar"
if sh "$D" destino "$SB" "$T/d" > "$T/destino.out" 2>&1; then falha "destino mudou e a conferência passou: a colisão do id 4 não foi vista"; fi
grep -q "MUDOU no destino: pedidos (1 chaves)" "$T/destino.out" || { cat "$T/destino.out"; falha "a conferência não apontou pedidos (1 chaves)"; }
# sem a conferência, o replay engole a escrita do Supabase: é o que ela existe para impedir
psql "$SB" -X -q -v ON_ERROR_STOP=1 -f "$T/d/replay.sql" >/dev/null
[ "$(psql "$SB" -X -At -c "select nome from pedidos where id = 4")" = "novo-do-go" ] || falha "esperava o replay sobrescrever o id 4 (premissa do teste)"
# e o replay, sem colisão, deixa o Supabase igual ao Go
sh "$D" comparar "$SB" "$T/d" >/dev/null || falha "depois do replay o Supabase tinha de ficar igual ao Go"
echo "OK: destino intacto passa; escrita posterior ao corte é barrada (pedidos, 1 chave); replay iguala o Supabase ao Go"
