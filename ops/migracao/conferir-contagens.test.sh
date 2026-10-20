#!/bin/sh
# Teste do conferir-contagens.sh + V1 em DOIS bancos descartáveis (`cc_origem` = o Supabase, `cc_alvo` = o api-db restaurado).
# Prova o desvio 1 da virada (20/10): o alvo leva as fichas de robos_esperados que as migrations Go semeiam e apagam; V1 aceita
# EXATAMENTE esse conjunto (lido das migrations, não de número fixo) e reprova 1 ficha a menos ou a mais.
# Uso: CONTAGENS_TEST_ADMIN_URL=postgres://postgres@127.0.0.1:55402/postgres sh ops/migracao/conferir-contagens.test.sh
# Cria e apaga os bancos cc_origem e cc_alvo nesse servidor. Nunca aponte para produção.
set -eu
ADMIN=${CONTAGENS_TEST_ADMIN_URL:?uso: CONTAGENS_TEST_ADMIN_URL=postgres://...@servidor-descartável/postgres sh $0}
case "$ADMIN" in *supabase*) echo "recuso: parece o Supabase" >&2; exit 2;; esac
AQUI=$(cd "$(dirname "$0")" && pwd); RAIZ=$AQUI/../..
base=${ADMIN%/*}; O="$base/cc_origem"; A="$base/cc_alvo"
T=$(mktemp -d); trap 'psql "$ADMIN" -X -q -c "drop database if exists cc_origem" -c "drop database if exists cc_alvo" >/dev/null 2>&1; rm -rf "$T"' EXIT
falha() { echo "FALHOU: $*" >&2; exit 1; }
for b in cc_origem cc_alvo; do psql "$ADMIN" -X -q -c "drop database if exists $b" -c "create database $b"; done
DDL="create table robos_esperados (robo text primary key, horas_sem_sucesso_ate int not null, critico boolean not null default false, porque text);
     create table notas (id int primary key);
     insert into robos_esperados values ('estoque-do-site', 2, true, 'x'), ('vessel-rd-station', 2, false, 'x'), ('coleta', 2, true, 'x'), ('enviar-push-frota', 80, false, 'x');
     insert into notas values (1), (2);"
for u in "$O" "$A"; do psql "$u" -X -q -v ON_ERROR_STOP=1 -c "$DDL"; done
# o alvo depois do restaurar.sh: as migrations Go reaplicadas (só o Up, como o restaurar.sh)
for m in "$RAIZ"/api/internal/banco/migracoes/*.sql; do sed '/^-- +goose Down/,$d' "$m" | psql "$A" -X -q -v ON_ERROR_STOP=1 -f - > /dev/null 2>&1 || true; done
N=$(psql "$A" -X -Atc "select count(*) from robos_esperados")
[ "$N" != 4 ] || falha "as migrations não mexeram em robos_esperados do alvo (nada a provar)"

v1() { # roda o V1 sobre o contagens.txt produzido por conferir-contagens.sh
  sh "$AQUI/conferir-contagens.sh" "$O" "$A" > "$T/ensaio-x.txt" 2> /dev/null || true
  mkdir -p "$T/d/corte/ensaio-x"; cp "$T/ensaio-x.txt" "$T/d/corte/ensaio-x/contagens.txt"
  D="$T/d" bash "$RAIZ/ops/virada/verifica-virada.sh" V1 2>&1 | head -n 1
}
echo "1) alvo = origem + sementes - apagadas ($N fichas): V1 passa"
r=$(v1); case $r in "V1 OK"*) ;; *) falha "esperava V1 OK, veio: $r";; esac
grep -q "^robos_esperados 4 $N " "$T/ensaio-x.txt" || falha "linha de robos_esperados inesperada: $(grep ^robos_esperados "$T/ensaio-x.txt")"
echo "2) repetir: igual"
[ "$(v1)" = "$r" ] || falha "2ª rodada diferiu"
echo "3) uma ficha a menos ($((N - 1))): V1 falha"
psql "$A" -X -q -c "delete from robos_esperados where robo = 'fabrica-purga'"
case $(v1) in "V1 FALHOU"*) ;; *) falha "$((N - 1)) fichas deviam reprovar";; esac
echo "4) uma ficha a mais ($((N + 1))): V1 falha"
psql "$A" -X -q -c "insert into robos_esperados values ('fabrica-purga', 30, false, 'x'), ('intrusa', 1, false, 'x')"
case $(v1) in "V1 FALHOU"*) ;; *) falha "$((N + 1)) fichas deviam reprovar";; esac
echo "5) mesma contagem, nome trocado (nunca por número só): V1 falha"
psql "$A" -X -q -c "delete from robos_esperados where robo = 'intrusa'" -c "delete from robos_esperados where robo = 'conferir-robos'" -c "insert into robos_esperados values ('intrusa', 1, false, 'x')"
case $(v1) in "V1 FALHOU"*) ;; *) falha "nome trocado devia reprovar";; esac
echo "6) outra tabela divergente continua reprovando"
psql "$A" -X -q -c "delete from robos_esperados where robo = 'intrusa'" -c "insert into robos_esperados values ('conferir-robos', 1, false, 'x')"
[ "$(v1 | cut -c1-5)" = "V1 OK" ] || falha "restabelecido devia passar"
psql "$A" -X -q -c "insert into notas values (3)"
case $(v1) in "V1 FALHOU"*) ;; *) falha "notas divergente devia reprovar";; esac
echo "OK: V1 compara com a semente das migrations (passa, falha com 1 a menos, 1 a mais e nome trocado)"
