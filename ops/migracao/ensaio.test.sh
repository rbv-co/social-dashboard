#!/bin/sh
# Teste de ponta a ponta do ensaio.sh SEM produção: sobe um "Supabase de mentira" local, aponta
# ORIGEM_DATABASE_URL para ele e roda o ensaio de verdade (com --sem-storage, exceto na prova de
# falha do Storage). Cobre: guarda do alvo, caminho feliz, repetição idêntica, limpeza dos dumps,
# órfão, tabela quente (DIFERE), falha do Storage, porta ocupada e interrupção (TERM).
# Uso: sh ops/migracao/ensaio.test.sh   (precisa de Docker, psql, go e node; usa as portas 58490/58491)
set -u
AQUI=$(cd "$(dirname "$0")" && pwd)
ORIG=ensaio-teste-origem; ALVO=ensaio-teste-alvo; PO=${ENSAIO_TESTE_PORTA_ORIGEM:-58490}; PA=${ENSAIO_TESTE_PORTA_ALVO:-58491}
SENHA=segredo-ensaio-7; CHAVE=chave-de-servico-secreta
URL_O="postgres://postgres:$SENHA@127.0.0.1:$PO/postgres?sslmode=disable"
TMP=$(mktemp -d)
limpa() { docker rm -f "$ORIG" "$ALVO" >/dev/null 2>&1; rm -rf "$TMP"; }
trap limpa EXIT
trap 'exit 130' INT TERM
falha() { echo "FALHOU: $1" >&2; exit 1; }
passou() { echo "  ok: $1"; }

docker rm -f "$ORIG" "$ALVO" >/dev/null 2>&1
docker run -d --rm --name "$ORIG" -e POSTGRES_PASSWORD="$SENHA" -p "127.0.0.1:$PO:5432" postgres:17 >/dev/null || falha "não subiu a origem de teste (porta $PO ocupada?)"
for i in $(seq 60); do psql "$URL_O" -X -Atqc 'select 1' >/dev/null 2>&1 && break; sleep 1; done
psql "$URL_O" -X -q -v ON_ERROR_STOP=1 <<'SQL' || falha "não montei a origem de teste"
create role anon nologin; create role authenticated nologin; create role service_role nologin;
create schema extensions; create extension pgcrypto with schema extensions;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create table auth.users (id uuid primary key, email text, encrypted_password text, email_confirmed_at timestamptz,
  created_at timestamptz default now(), banned_until timestamptz, deleted_at timestamptz);
create table public.profiles (id uuid primary key references auth.users(id) on delete cascade, nome text);
create table public.notas (id serial primary key, dono uuid, texto text);
insert into auth.users (id, email, encrypted_password, email_confirmed_at) select gen_random_uuid(), 'u' || g || '@x.com', 'hash', now() from generate_series(1, 2) g;
insert into public.profiles select id, 'nome' from auth.users;
insert into public.notas (dono, texto) select id, 'nota ' || g from public.profiles, generate_series(1, 20) g;
SQL

# roda o ensaio com a saída em $TMP/rodada-N.txt; ST = status; OUT = pasta da rodada
N=0
rodar() {
  N=$((N + 1)); R="$TMP/rodada-$N.txt"; ST=0
  ORIGEM_DATABASE_URL="$URL_O" ALVO_PORTA=$PA ALVO_CONTAINER=$ALVO ENSAIO_SAIDA="$TMP/saida" sh "$AQUI/ensaio.sh" "$@" > "$R" 2>&1 || ST=$?
  OUT=$(ls -td "$TMP"/saida/ensaio-* | head -1)
}
contem() { grep -q -- "$1" "$2" || { cat "$2" >&2; falha "esperava '$1' em $2"; }; }
sem_dump() { [ ! -e "$OUT/dump" ] && [ ! -e "$OUT/storage" ] || falha "o dump/Storage ficou no disco: $(ls "$OUT")"; }
vazou() { ! grep -rq -e "$SENHA" -e "$CHAVE" "$TMP/rodada-$N.txt" "$OUT" || falha "senha ou chave apareceu na saída/relatório"; }
estados() { grep -oE 'OK$|FALHOU \(saída [0-9]+\)$|PULADA' "$1" | tr '\n' ' '; }

echo "1) guarda do alvo (remoto recusado antes de qualquer docker)"
mkdir "$TMP/shim"; printf '#!/bin/sh\ntouch "%s/docker-chamado"\nexit 1\n' "$TMP" > "$TMP/shim/docker"; chmod +x "$TMP/shim/docker"
for u in 'postgres://u:p@db.exemplo.com/x' 'postgres://u:p@evil.com/db@localhost/x' 'postgres://u:p@localhost/x?host=evil.com'; do
  s=0; PATH="$TMP/shim:$PATH" ORIGEM_DATABASE_URL="$URL_O" ALVO_DATABASE_URL="$u" sh "$AQUI/ensaio.sh" --sem-storage > "$TMP/g.txt" 2>&1 || s=$?
  [ "$s" = 1 ] && grep -q 'não é local.*recuso' "$TMP/g.txt" || falha "alvo remoto $u não foi recusado (saída $s): $(cat "$TMP/g.txt")"
done
[ ! -e "$TMP/docker-chamado" ] || falha "o docker foi chamado antes da guarda"
passou "3 URLs remotas recusadas com saída 1 e sem tocar no docker"
s=0; ORIGEM_DATABASE_URL="$URL_O" sh "$AQUI/ensaio.sh" > "$TMP/g.txt" 2>&1 || s=$?
[ "$s" = 1 ] && grep -q 'SUPABASE_SERVICE_KEY' "$TMP/g.txt" || falha "sem Storage configurado e sem --sem-storage deveria recusar"
passou "Storage sem credenciais e sem --sem-storage é recusado"

echo "2) caminho feliz + dumps apagados + nada vaza"
rodar --sem-storage
[ "$ST" = 0 ] || { cat "$R" >&2; falha "rodada 1 saiu com $ST"; }
for e in "1. subir" "2. dump" "3. restaurar" "4. importar" "5. conferir contagens" "5b. conferir" "6. copiar Storage" "volume: dump" "janela de manutenção" "ENSAIO OK" '//\*\*\*@'; do contem "$e" "$OUT/relatorio.txt"; done
sem_dump; vazou
[ "$(stat -f %Lp "$OUT" 2>/dev/null || stat -c %a "$OUT")" = 700 ] || falha "pasta da rodada não é 700"
passou "exit 0, relatório completo, dump apagado, pasta 700, sem segredos"
sed 's/^/    /' "$OUT/relatorio.txt"; E1=$(estados "$OUT/relatorio.txt"); C1=$(cat "$OUT/contagens.txt")

echo "3) segunda rodada idêntica (recria o alvo do zero)"
rodar --sem-storage
[ "$ST" = 0 ] || { cat "$R" >&2; falha "rodada 2 saiu com $ST"; }
[ "$(estados "$OUT/relatorio.txt")" = "$E1" ] && [ "$(cat "$OUT/contagens.txt")" = "$C1" ] || falha "rodadas diferem"
sem_dump
passou "mesmos estados e contagens"

echo "4) órfão (usuário apagado no Auth ainda referenciado) => falha"
psql "$URL_O" -X -q -c "insert into auth.users (id, email, deleted_at) values ('99999999-9999-9999-9999-999999999999', 'morto@x.com', now()); insert into public.profiles values ('99999999-9999-9999-9999-999999999999', 'fantasma')" || falha "preparo do órfão"
rodar --sem-storage
[ "$ST" = 1 ] || falha "órfão deveria dar saída 1 (deu $ST)"
contem "órfãos: 1" "$OUT/relatorio.txt"; contem "5b. conferir órfãos (FKs) *[0-9]*s  FALHOU" "$OUT/relatorio.txt"; contem "ENSAIO FALHOU" "$OUT/relatorio.txt"
contem "6. copiar Storage" "$OUT/relatorio.txt"; contem "janela de manutenção" "$OUT/relatorio.txt"; sem_dump
passou "saída 1, órfão contado e relatório completo mesmo com a falha"
psql "$URL_O" -X -q -c "delete from public.profiles where nome='fantasma'; delete from auth.users where email='morto@x.com'"

echo "5) tabela quente (origem cresce depois do dump) => DIFERE, saída 1"
mkdir "$TMP/shim2"
printf '#!/bin/sh\ncase "$*" in *importar-usuarios*) psql "%s" -X -q -c "insert into public.notas (texto) values (%squente%s)" >/dev/null;; esac\nexec "%s" "$@"\n' "$URL_O" "'" "'" "$(command -v go)" > "$TMP/shim2/go"; chmod +x "$TMP/shim2/go"
PATH="$TMP/shim2:$PATH" rodar --sem-storage
[ "$ST" = 1 ] || { cat "$R" >&2; falha "DIFERE deveria dar saída 1 (deu $ST)"; }
contem "(DIFERE): 1" "$OUT/relatorio.txt"; contem "5. conferir contagens *[0-9]*s  FALHOU" "$OUT/relatorio.txt"; contem "^notas .*DIFERE" "$OUT/contagens.txt"; sem_dump
passou "saída 1 com a tabela quente apontada"
psql "$URL_O" -X -q -c "delete from public.notas where texto='quente'"

echo "6) Storage falhando => ensaio falha, resto do relatório sai"
s=0; ORIGEM_DATABASE_URL="$URL_O" ALVO_PORTA=$PA ALVO_CONTAINER=$ALVO ENSAIO_SAIDA="$TMP/saida" SUPABASE_URL=http://127.0.0.1:9 SUPABASE_SERVICE_KEY=$CHAVE sh "$AQUI/ensaio.sh" > "$TMP/rodada-st.txt" 2>&1 || s=$?
OUT=$(ls -td "$TMP"/saida/ensaio-* | head -1); N=st
[ "$s" = 1 ] || { cat "$TMP/rodada-st.txt" >&2; falha "Storage com erro deveria dar saída 1 (deu $s)"; }
contem "6. copiar Storage *[0-9]*s  FALHOU" "$OUT/relatorio.txt"; contem "3. restaurar *[0-9]*s  OK" "$OUT/relatorio.txt"; sem_dump; vazou
passou "saída 1, etapa 6 FALHOU, chave não vazou"

echo "7) porta do alvo ocupada => falha clara, dependentes PULADAS, sem dump"
s=0; ORIGEM_DATABASE_URL="$URL_O" ALVO_PORTA=$PO ALVO_CONTAINER=$ALVO ENSAIO_SAIDA="$TMP/saida" sh "$AQUI/ensaio.sh" --sem-storage > "$TMP/rodada-porta.txt" 2>&1 || s=$?
OUT=$(ls -td "$TMP"/saida/ensaio-* | head -1)
[ "$s" = 1 ] || falha "porta ocupada deveria dar saída 1 (deu $s)"
contem "já está ocupada" "$TMP/rodada-porta.txt"; contem "2. dump.*PULADA" "$OUT/relatorio.txt"; contem "5b.*PULADA" "$OUT/relatorio.txt"; [ ! -e "$OUT/dump" ] || falha "houve dump com o alvo parado"
passou "mensagem clara e etapas dependentes puladas"

echo "8) interrupção (TERM) no meio => saída 130 e dump apagado"
ORIGEM_DATABASE_URL="$URL_O" ALVO_PORTA=$PA ALVO_CONTAINER=$ALVO ENSAIO_SAIDA="$TMP/saida2" sh "$AQUI/ensaio.sh" --sem-storage > "$TMP/rodada-int.txt" 2>&1 &
PID=$!
for i in $(seq 120); do ls "$TMP"/saida2/ensaio-*/dump/completo.dump >/dev/null 2>&1 && break; sleep 0.5; done
ls "$TMP"/saida2/ensaio-*/dump/completo.dump >/dev/null 2>&1 || falha "o dump não apareceu a tempo para interromper"
kill -TERM $PID; s=0; wait $PID || s=$?
[ "$s" = 130 ] || falha "interrupção deveria sair com 130 (saiu $s)"
OUT=$(ls -td "$TMP"/saida2/ensaio-* | head -1); sem_dump
[ -z "$(docker ps -q -f name=$ALVO)" ] || falha "o contêiner do alvo ficou de pé"
passou "saída 130, dump apagado, contêiner removido"

echo "OK: ensaio.sh passou nos 8 cenários"
