#!/bin/sh
# Teste de ponta a ponta do ensaio.sh SEM produção: sobe um "Supabase de mentira" local e um Storage
# de mentira (node), aponta ORIGEM_DATABASE_URL/SUPABASE_URL para eles e roda o ensaio de verdade.
# Cobre: guarda do alvo (URLs hostis, PGHOSTADDR no ambiente, porta divergente), caminho feliz,
# repetição idêntica, limpeza (dump, Storage, volumes), órfão, falha do importar, tabela quente
# (CONFIRA, saída 3), ERRO de contagem (saída 1), Storage real (--manter, --excluir-buckets),
# Storage falhando, porta ocupada e interrupção (TERM/HUP).
# Uso: sh ops/migracao/ensaio.test.sh   (Docker, psql, go e node; portas 58490, 58491, 58492)
set -u
# isolamento: credenciais reais exportadas no shell nunca podem iniciar um ensaio de verdade
unset SUPABASE_URL SUPABASE_SERVICE_KEY SUPABASE_ACCESS_TOKEN ALVO_DATABASE_URL ORIGEM_DATABASE_URL DATABASE_URL \
  ALVO_PORTA ALVO_CONTAINER ENSAIO_SAIDA PGHOST PGHOSTADDR PGPORT PGSERVICE PGSERVICEFILE PGUSER PGPASSWORD PGDATABASE
AQUI=$(cd "$(dirname "$0")" && pwd)
ORIG=ensaio-teste-origem; ALVO=ensaio-teste-alvo
PO=${ENSAIO_TESTE_PORTA_ORIGEM:-58490}; PA=${ENSAIO_TESTE_PORTA_ALVO:-58491}; PS=${ENSAIO_TESTE_PORTA_STORAGE:-58492}
SENHA=segredo-ensaio-7; CHAVE=chave-de-servico-secreta
URL_O="postgres://postgres:$SENHA@127.0.0.1:$PO/postgres?sslmode=disable"
TMP=$(mktemp -d); SPID=
limpa() {
  s=$?; trap - EXIT
  [ -z "$SPID" ] || kill "$SPID" 2>/dev/null
  docker rm -fv "$ORIG" "$ALVO" >/dev/null 2>&1; rm -rf "$TMP"; exit $s
}
trap limpa EXIT
trap 'exit 130' INT TERM HUP
falha() { echo "FALHOU: $1" >&2; exit 1; }
passou() { echo "  ok: $1"; }

docker rm -fv "$ORIG" "$ALVO" >/dev/null 2>&1
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
create function public.nada() returns trigger language plpgsql as $f$ begin return new; end $f$;
create trigger t_nada after insert on public.notas for each row execute function public.nada();
create trigger t_off after insert on public.profiles for each row execute function public.nada();
create trigger "T_up" after insert on public.notas for each row execute function public.nada();  -- maiúscula: a ordem C difere da do locale
alter table public.profiles disable trigger t_off;   -- estado D que o alvo tem de reproduzir
SQL

# Storage de mentira (lista + download); cada requisição vai para $TMP/storage.log
cat > "$TMP/storage-fake.mjs" <<'JS'
import http from 'node:http'; import { appendFileSync } from 'node:fs'
const log = process.argv[3]
http.createServer((req, res) => {
  let corpo = ''; req.on('data', (c) => (corpo += c)); req.on('end', () => {
    appendFileSync(log, `${req.method} ${req.url} ${req.headers.authorization ? 'auth' : 'sem-auth'}\n`)
    const lista = req.url.match(/^\/storage\/v1\/object\/list\/([^/]+)$/)
    if (req.url === '/storage/v1/bucket') return res.end(JSON.stringify([{ name: 'b1' }, { name: 'b2' }]))
    if (lista) return res.end(JSON.stringify(JSON.parse(corpo).prefix === '' ? [{ name: 'a.txt', id: 'i1', metadata: { size: 5 }, updated_at: '2026-01-01T00:00:00Z' }] : []))
    if (req.url.startsWith('/storage/v1/object/authenticated/')) return res.end('hello')
    res.statusCode = 404; res.end('{}')
  })
}).listen(Number(process.argv[2]), '127.0.0.1')
JS
: > "$TMP/storage.log"; node "$TMP/storage-fake.mjs" "$PS" "$TMP/storage.log" & SPID=$!
for i in $(seq 30); do nc -z 127.0.0.1 "$PS" 2>/dev/null && break; sleep 0.2; done
URL_S="http://127.0.0.1:$PS"
# Volume anônimo do contêiner do alvo: o nome é capturado (docker inspect) ENQUANTO o contêiner roda, e no fim
# se confere que ESSE volume sumiu. (Comparar a contagem global de volumes dangling dá falso alarme quando
# outra sessão usa o Docker ao mesmo tempo.)
espreita_volume() { # espreita_volume ARQUIVO: grava o nome do volume do $ALVO assim que ele aparecer
  for i in $(seq 600); do
    v=$(docker inspect -f '{{range .Mounts}}{{.Name}} {{end}}' "$ALVO" 2>/dev/null | tr -d ' \n')
    [ -z "$v" ] || { printf '%s' "$v" > "$1"; return 0; }
    sleep 0.2
  done
}

# roda o ensaio com a saída em $TMP/rodada-N.txt; ST = status; OUT = pasta da rodada.
# ENV_EXTRA: variáveis extras ("A=1 B=2") só para esta rodada.
N=0; ENV_EXTRA=
rodar() {
  N=$((N + 1)); R="$TMP/rodada-$N.txt"; ST=0
  espreita_volume "$TMP/vol-$N" & EP=$!
  env ORIGEM_DATABASE_URL="$URL_O" ALVO_PORTA=$PA ALVO_CONTAINER=$ALVO ENSAIO_SAIDA="$TMP/saida" $ENV_EXTRA sh "$AQUI/ensaio.sh" "$@" > "$R" 2>&1 < /dev/null || ST=$?
  ENV_EXTRA=
  kill "$EP" 2>/dev/null; wait "$EP" 2>/dev/null
  OUT=$(ls -td "$TMP"/saida/ensaio-* | head -1)
}
contem() { grep -q -- "$1" "$2" || { cat "$2" >&2; falha "esperava '$1' em $2"; }; }
nao_contem() { ! grep -q -- "$1" "$2" || { cat "$2" >&2; falha "NÃO esperava '$1' em $2"; }; }
sem_dump() { [ ! -e "$OUT/dump" ] && [ ! -e "$OUT/storage" ] || falha "o dump/Storage ficou no disco: $(ls "$OUT")"; }
vazou() { ! grep -rq -e "$SENHA" -e "$CHAVE" "$TMP/rodada-$N.txt" "$OUT" || falha "senha ou chave apareceu na saída/relatório"; }
estados() { grep -oE 'OK$|FALHOU \(saída [0-9]+\)$|PULADA' "$1" | tr '\n' ' '; }
volumes() { # nenhum dos volumes capturados pode ter sobrado, e ao menos um tem de ter sido capturado
  achou=0
  for f in "$TMP"/vol-*; do
    [ -s "$f" ] || continue; achou=1
    ! docker volume inspect "$(cat "$f")" >/dev/null 2>&1 || falha "sobrou o volume anônimo $(cat "$f") do contêiner do alvo: $1"
  done
  [ "$achou" = 1 ] || falha "não capturei o volume do contêiner (o teste não provaria nada): $1"
}
shim() { mkdir -p "$TMP/$1"; printf '#!/bin/sh\ncase "$*" in *importar-usuarios*) %s;; esac\nexec "%s" "$@"\n' "$2" "$(command -v go)" > "$TMP/$1/go"; chmod +x "$TMP/$1/go"; }

echo "0) oculta (ensaio.sh) mascara URL e host/usuário/papel do texto de erro do libpq"
eval "$(grep '^oculta()' "$AQUI/ensaio.sh")"
o=$(printf '%s\n' 'connection to server at "db.exemplo.com" (10.1.2.3), port 5432 failed: FATAL:  password authentication failed for user "admin"' 'psql: error: connection to server on host "x.y" failed; role "r1" does not exist' 'falhou postgres://u:senha@h:5432/d?sslmode=disable fim' | oculta)
case "$o" in *exemplo*|*10.1.2.3*|*admin*|*x.y*|*r1*|*senha*) falha "oculta deixou vazar: $o";; esac
case "$o" in *'server at "<oculto>", port 5432'*'user "<oculto>"'*'host "<oculto>"'*'role "<oculto>"'*'<URL> fim'*) ;; *) falha "oculta mascarou errado: $o";; esac
passou "oculta"

echo "1) guarda do alvo (hostil recusado antes de qualquer docker)"
mkdir "$TMP/shim"; printf '#!/bin/sh\ntouch "%s/docker-chamado"\nexit 1\n' "$TMP" > "$TMP/shim/docker"; chmod +x "$TMP/shim/docker"
while IFS= read -r u; do
  s=0; PATH="$TMP/shim:$PATH" ENSAIO_SAIDA="$TMP/saida-g" ORIGEM_DATABASE_URL="$URL_O" ALVO_PORTA=$PA ALVO_DATABASE_URL="$u" sh "$AQUI/ensaio.sh" --sem-storage > "$TMP/g.txt" 2>&1 || s=$?
  [ "$s" = 1 ] && grep -q 'não é local.*recuso' "$TMP/g.txt" || falha "alvo hostil '$u' não foi recusado (saída $s): $(cat "$TMP/g.txt")"
done <<URLS
postgres://u:p@db.exemplo.com/x
postgres://u:p@evil.com/db@localhost/x
postgres://u:p@localhost:$PA/x
postgres://u:p@localhost:$PA/x?host=evil.com
postgres://u:p@localhost:58509,evil.invalid:5432/x
postgres://u@evil.invalid:5432,x@localhost/x
postgres://u:p@[::1]:$PA/x
postgres://u:p@localhost:$PA/x?%68ost=evil.invalid
postgres://u:p@localhost:$PA/x?hostaddr=192.0.2.1
postgres://u:p@localhost:$PA/x?service=foo
postgres://u:p@localhost:$PA/x?sslmode=disable&host=evil.invalid
postgres://u@a@localhost:$PA/x
postgres://u:p@local%68ost:$PA/x
dbname=x user=u@localhost
host=evil.invalid dbname=x
URLS
[ ! -e "$TMP/docker-chamado" ] || falha "o docker foi chamado antes da guarda"
passou "15 URLs hostis (inclui localhost e [::1], só 127.0.0.1 é aceito) recusadas com saída 1 e sem tocar no docker"
s=0; ENSAIO_SAIDA="$TMP/saida-g" ORIGEM_DATABASE_URL="$URL_O" ALVO_PORTA=$PA ALVO_DATABASE_URL="postgres://postgres:x@127.0.0.1:58499/postgres" sh "$AQUI/ensaio.sh" --sem-storage > "$TMP/g.txt" 2>&1 || s=$?
[ "$s" = 1 ] && grep -q 'ALVO_PORTA' "$TMP/g.txt" || falha "porta da URL diferente de ALVO_PORTA deveria ser recusada (saída $s)"
passou "porta da URL diferente de ALVO_PORTA recusada"
s=0; ENSAIO_SAIDA="$TMP/saida-g" ORIGEM_DATABASE_URL="$URL_O" sh "$AQUI/ensaio.sh" > "$TMP/g.txt" 2>&1 || s=$?
[ "$s" = 1 ] && grep -q 'SUPABASE_SERVICE_KEY' "$TMP/g.txt" || falha "sem Storage configurado e sem --sem-storage deveria recusar"
passou "Storage sem credenciais e sem --sem-storage é recusado"

echo "1b) ALVO_CONTAINER fora de ensaio-* recusado antes de qualquer docker"
for c in postgres 'ensaio' 'ensaio-' 'meu-banco' 'ensaio-x;rm'; do
  s=0; PATH="$TMP/shim:$PATH" ENSAIO_SAIDA="$TMP/saida-g" ORIGEM_DATABASE_URL="$URL_O" ALVO_CONTAINER="$c" sh "$AQUI/ensaio.sh" --sem-storage > "$TMP/g.txt" 2>&1 || s=$?
  [ "$s" = 1 ] && grep -q 'ALVO_CONTAINER' "$TMP/g.txt" || falha "ALVO_CONTAINER '$c' não foi recusado (saída $s)"
done
[ ! -e "$TMP/docker-chamado" ] || falha "docker chamado com ALVO_CONTAINER inválido"
passou "5 nomes recusados sem tocar no docker (inclui 'ensaio-' sozinho)"

echo "2) caminho feliz + dumps apagados + nada vaza"
rodar --sem-storage
[ "$ST" = 0 ] || { cat "$R" >&2; falha "rodada 1 saiu com $ST"; }
for e in "1. subir" "2. dump" "3. restaurar" "4. importar" "5. conferir contagens" "5b. conferir" "6. copiar Storage .*PULADA (--sem-storage)" "volume: dump" "JANELA de manutenção" "5c. policies/RLS/triggers.*OK" "limpeza do schema (contagens): {" "importar-usuarios: .*importados=[0-9]" "FKs para usuarios conferidas: [0-9]" "SEM Storage" "ENSAIO OK" '//\*\*\*@'; do contem "$e" "$OUT/relatorio.txt"; done
sem_dump; vazou
[ "$(stat -f %Lp "$OUT" 2>/dev/null || stat -c %a "$OUT")" = 700 ] || falha "pasta da rodada não é 700"
passou "exit 0, relatório completo, stage 6 PULADA (--sem-storage), dump apagado, pasta 700, sem segredos"
sed 's/^/    /' "$OUT/relatorio.txt"; E1=$(estados "$OUT/relatorio.txt"); C1=$(cat "$OUT/contagens.txt")

echo "3) segunda rodada idêntica (recria o alvo do zero), com PGHOSTADDR hostil no ambiente e URL explícita"
ENV_EXTRA="PGHOSTADDR=192.0.2.1 PGHOST=192.0.2.1 ALVO_DATABASE_URL=postgres://postgres:x@127.0.0.1:$PA/postgres?sslmode=disable"
rodar --sem-storage
[ "$ST" = 0 ] || { cat "$R" >&2; falha "rodada 2 saiu com $ST (PGHOSTADDR redirecionou?)"; }
[ "$(estados "$OUT/relatorio.txt")" = "$E1" ] && [ "$(cat "$OUT/contagens.txt")" = "$C1" ] || falha "rodadas diferem"
sem_dump
volumes "depois de 2 rodadas"
passou "mesmos estados e contagens; PGHOSTADDR/PGHOST ignorados; volumes do Docker inalterados"

echo "4) órfão (usuário apagado no Auth ainda referenciado) => falha"
psql "$URL_O" -X -q -c "insert into auth.users (id, email, deleted_at) values ('99999999-9999-9999-9999-999999999999', 'morto@x.com', now()); insert into public.profiles values ('99999999-9999-9999-9999-999999999999', 'fantasma')" || falha "preparo do órfão"
rodar --sem-storage
[ "$ST" = 1 ] || falha "órfão deveria dar saída 1 (deu $ST)"
contem "órfãos: 1" "$OUT/relatorio.txt"; contem "5b. conferir.*FALHOU" "$OUT/relatorio.txt"; contem "ENSAIO FALHOU" "$OUT/relatorio.txt"
contem "JANELA de manutenção" "$OUT/relatorio.txt"; sem_dump
passou "saída 1, órfão contado e relatório completo mesmo com a falha"
psql "$URL_O" -X -q -c "delete from public.profiles where nome='fantasma'; delete from auth.users where email='morto@x.com'"

echo "4b) importar usuários falha => 5b PULADA"
shim shim3 'exit 1'
ENV_EXTRA="PATH=$TMP/shim3:$PATH"; rodar --sem-storage
[ "$ST" = 1 ] || { cat "$R" >&2; falha "importar falho deveria dar saída 1 (deu $ST)"; }
contem "4. importar.*FALHOU" "$OUT/relatorio.txt"; contem "5b. conferir.*PULADA" "$OUT/relatorio.txt"; contem "5. conferir contagens.*[0-9]s  " "$OUT/relatorio.txt"
passou "saída 1, 5b PULADA"

echo "5) tabela quente (origem cresce depois do dump) => CONFIRA, saída 3 (nunca OK)"
shim shim2 "psql '$URL_O' -X -q -c \"insert into public.notas (texto) values ('quente')\" >/dev/null"
ENV_EXTRA="PATH=$TMP/shim2:$PATH"; rodar --sem-storage
[ "$ST" = 3 ] || { cat "$R" >&2; falha "divergência numérica deveria dar saída 3 (deu $ST)"; }
contem "(DIFERE): 1" "$OUT/relatorio.txt"; contem "5. conferir contagens.*CONFIRA (1 tabelas)" "$OUT/relatorio.txt"; contem "^notas .*DIFERE" "$OUT/contagens.txt"
contem "ENSAIO CONCLUÍDO COM DIVERGÊNCIAS A CONFERIR" "$OUT/relatorio.txt"; nao_contem "ENSAIO OK" "$OUT/relatorio.txt"; nao_contem "saiu com 1" "$R"; sem_dump
passou "saída 3, status CONFIRA, mensagem final de divergências"
psql "$URL_O" -X -q -c "delete from public.notas where texto='quente'"

echo "5b) linha ERRO em contagens (tabela some no alvo) => FALHOU, saída 1 (vence o 3)"
shim shim4 "psql \"\$DATABASE_URL\" -X -q -c 'alter table public.notas rename to notas_x'"
ENV_EXTRA="PATH=$TMP/shim4:$PATH"; rodar --sem-storage
[ "$ST" = 1 ] || { cat "$R" >&2; falha "ERRO de contagem deveria dar saída 1 (deu $ST)"; }
contem "5. conferir contagens.*FALHOU" "$OUT/relatorio.txt"; contem "ERRO" "$OUT/contagens.txt"; contem "ENSAIO FALHOU" "$OUT/relatorio.txt"; nao_contem "ENSAIO OK" "$OUT/relatorio.txt"
passou "saída 1"

echo "5d) origem inalcançável em conferir-contagens (listagem, depois só as contagens) => FALHOU, nunca CONFIRA/OK"
# psql falso: só para a ORIGEM, e só quando o script lido do stdin casa com $2, simula conexão recusada
mkdir "$TMP/shim7"; cat > "$TMP/shim7/psql" <<SH
#!/bin/sh
real=\$(PATH="\${PATH#$TMP/shim7:}" command -v psql)
# só as chamadas à ORIGEM são interceptadas; todas as outras (-c, -f do restaurar.sh, ...) vão direto ao psql
# real, ANTES de ler o stdin (que, para elas, pode nunca fechar)
case "\$*" in
  *:$PO/*) in=\$(cat)
    if printf '%s' "\$in" | grep -Eq "\$PADRAO_FALHA"; then echo 'psql: error: connection to server at "origem.exemplo.com" failed: Connection refused' >&2; exit 2; fi
    printf '%s\n' "\$in" | exec "\$real" "\$@";;
  *) exec "\$real" "\$@";;
esac
SH
chmod +x "$TMP/shim7/psql"
ENV_EXTRA="PATH=$TMP/shim7:$PATH PADRAO_FALHA=information_schema.tables"; rodar --sem-storage
[ "$ST" = 1 ] || { cat "$R" >&2; falha "origem fora do ar na listagem deveria dar saída 1 (deu $ST)"; }
contem "5. conferir contagens.*FALHOU (saída 2)" "$OUT/relatorio.txt"; contem "ENSAIO FALHOU" "$OUT/relatorio.txt"; nao_contem "CONFIRA" "$OUT/relatorio.txt"; nao_contem "ENSAIO OK" "$OUT/relatorio.txt"
ENV_EXTRA="PATH=$TMP/shim7:$PATH PADRAO_FALHA=count"; rodar --sem-storage
[ "$ST" = 1 ] || { cat "$R" >&2; falha "origem fora do ar nas contagens deveria dar saída 1 (deu $ST)"; }
contem "5. conferir contagens.*FALHOU (saída 1)" "$OUT/relatorio.txt"; contem "ERRO" "$OUT/contagens.txt"; nao_contem "CONFIRA" "$OUT/relatorio.txt"; nao_contem "ENSAIO OK" "$OUT/relatorio.txt"
passou "saída 1 nos dois casos; nunca CONFIRA nem OK"

echo "5e) um 3 de etapa POSTERIOR (Storage) depois de um CONFIRA das contagens não vira CONFIRA"
shim shim8 "psql '$URL_O' -X -q -c \"insert into public.notas (texto) values ('quente')\" >/dev/null"
printf '#!/bin/sh\ncase "$*" in *copiar-storage*) echo "falha simulada" >&2; exit 3;; esac\nexec "%s" "$@"\n' "$(command -v node)" > "$TMP/shim8/node"; chmod +x "$TMP/shim8/node"
ENV_EXTRA="PATH=$TMP/shim8:$PATH SUPABASE_URL=$URL_S SUPABASE_SERVICE_KEY=$CHAVE"; rodar
[ "$ST" = 1 ] || { cat "$R" >&2; falha "3 do Storage depois de CONFIRA deveria dar saída 1 (deu $ST)"; }
contem "5. conferir contagens.*CONFIRA" "$OUT/relatorio.txt"; contem "6. copiar Storage.*FALHOU (saída 3)" "$OUT/relatorio.txt"; contem "ENSAIO FALHOU" "$OUT/relatorio.txt"; nao_contem "ENSAIO OK" "$OUT/relatorio.txt"; nao_contem "6. copiar Storage.*CONFIRA" "$OUT/relatorio.txt"
psql "$URL_O" -X -q -c "delete from public.notas where texto='quente'"
passou "6 = FALHOU (saída 3), 5 = CONFIRA, final = ENSAIO FALHOU, saída 1"

echo "5c) policy no alvo e trigger com estado diferente da origem => FALHOU, saída 1"
shim shim5 "psql \"\$DATABASE_URL\" -X -q -c 'create policy p on public.notas using (true)'"
ENV_EXTRA="PATH=$TMP/shim5:$PATH"; rodar --sem-storage
[ "$ST" = 1 ] || { cat "$R" >&2; falha "policy no alvo deveria dar saída 1 (deu $ST)"; }
contem "5c. policies/RLS/triggers.*FALHOU" "$OUT/relatorio.txt"; contem "o alvo tem 1 policies" "$R"; nao_contem "ENSAIO OK" "$OUT/relatorio.txt"
shim shim6 "psql \"\$DATABASE_URL\" -X -q -c 'alter table public.notas disable trigger t_nada'"
ENV_EXTRA="PATH=$TMP/shim6:$PATH"; rodar --sem-storage
[ "$ST" = 1 ] || { cat "$R" >&2; falha "trigger com estado diferente deveria dar saída 1 (deu $ST)"; }
contem "5c. policies/RLS/triggers.*FALHOU" "$OUT/relatorio.txt"; contem "notas.t_nada=O" "$OUT/triggers.diff"; contem "notas.t_nada=D" "$OUT/triggers.diff"
contem "t_off=D" "$OUT/triggers-alvo.txt"
LC_ALL=C sort -c "$OUT/triggers-origem.txt" && LC_ALL=C sort -c "$OUT/triggers-alvo.txt" || falha "a lista de triggers não está em ordem C (falso diff em collations diferentes)"
passou "policy e trigger divergente reprovam; estado D da origem reproduzido no alvo"

echo "6) Storage de mentira: caminho feliz (--manter), --excluir-buckets, bucket inexistente e servidor fora"
ENV_EXTRA="SUPABASE_URL=$URL_S SUPABASE_SERVICE_KEY=$CHAVE"; rodar --manter
[ "$ST" = 0 ] || { cat "$R" >&2; falha "Storage feliz saiu com $ST"; }
contem "6. copiar Storage .*[0-9]s  OK" "$OUT/relatorio.txt"; contem "volume: dump .*total: 2 copiados" "$OUT/relatorio.txt"; contem "JANELA COM Storage" "$OUT/relatorio.txt"; contem "ENSAIO OK" "$OUT/relatorio.txt"; vazou
[ "$(cat "$OUT/storage/b1/a.txt")" = hello ] && [ "$(cat "$OUT/storage/b2/a.txt")" = hello ] || falha "objetos do Storage não foram copiados"
[ -s "$OUT/dump/completo.dump" ] && [ "$(stat -f %Lp "$OUT/dump/completo.dump" 2>/dev/null || stat -c %a "$OUT/dump/completo.dump")" = 600 ] || falha "--manter: dump ausente ou não 600"
rm -rf "$OUT/dump" "$OUT/storage"
ENV_EXTRA="SUPABASE_URL=$URL_S SUPABASE_SERVICE_KEY=$CHAVE"; : > "$TMP/storage.log"; rodar --excluir-buckets b2
[ "$ST" = 0 ] || { cat "$R" >&2; falha "--excluir-buckets saiu com $ST"; }
contem "buckets não copiados: b2" "$R"; contem "total: 1 copiados" "$OUT/relatorio.txt"; contem "excluindo b2" "$OUT/relatorio.txt"
nao_contem "list/b2" "$TMP/storage.log"; sem_dump
ENV_EXTRA="SUPABASE_URL=$URL_S SUPABASE_SERVICE_KEY=$CHAVE"; rodar --excluir-buckets b9
[ "$ST" = 1 ] || { cat "$R" >&2; falha "bucket inexistente deveria dar saída 1 (deu $ST)"; }
contem "6. copiar Storage.*FALHOU (saída 2)" "$OUT/relatorio.txt"; contem "bucket inexistente: b9" "$R"; contem "3. restaurar *[0-9]*s  OK" "$OUT/relatorio.txt"; sem_dump
ENV_EXTRA="SUPABASE_URL=http://127.0.0.1:9 SUPABASE_SERVICE_KEY=$CHAVE"; rodar
[ "$ST" = 1 ] || { cat "$R" >&2; falha "Storage fora do ar deveria dar saída 1 (deu $ST)"; }
contem "6. copiar Storage *[0-9]*s  FALHOU" "$OUT/relatorio.txt"; sem_dump; vazou
passou "cópia real verificada, --manter, --excluir pass-through, limpeza, total: no relatório, falhas viram saída 1"

echo "7) porta do alvo ocupada => falha clara, dependentes PULADAS, sem dump"
s=0; env ORIGEM_DATABASE_URL="$URL_O" ALVO_PORTA=$PO ALVO_CONTAINER=$ALVO ENSAIO_SAIDA="$TMP/saida" sh "$AQUI/ensaio.sh" --sem-storage > "$TMP/rodada-porta.txt" 2>&1 || s=$?
OUT=$(ls -td "$TMP"/saida/ensaio-* | head -1)
[ "$s" = 1 ] || falha "porta ocupada deveria dar saída 1 (deu $s)"
contem "já está ocupada" "$TMP/rodada-porta.txt"; contem "2. dump.*PULADA" "$OUT/relatorio.txt"; contem "5b.*PULADA" "$OUT/relatorio.txt"; [ ! -e "$OUT/dump" ] || falha "houve dump com o alvo parado"
passou "mensagem clara e etapas dependentes puladas"

echo "8) interrupção (TERM e HUP) no meio => saída 130 e dump apagado"
for sig in TERM HUP; do
  rm -rf "$TMP/saida2"
  espreita_volume "$TMP/vol-int-$sig" & EP=$!
  env ORIGEM_DATABASE_URL="$URL_O" ALVO_PORTA=$PA ALVO_CONTAINER=$ALVO ENSAIO_SAIDA="$TMP/saida2" sh "$AQUI/ensaio.sh" --sem-storage > "$TMP/rodada-int.txt" 2>&1 &
  PID=$!
  for i in $(seq 120); do ls "$TMP"/saida2/ensaio-*/dump/completo.dump >/dev/null 2>&1 && break; sleep 0.5; done
  ls "$TMP"/saida2/ensaio-*/dump/completo.dump >/dev/null 2>&1 || falha "o dump não apareceu a tempo para interromper"
  kill -$sig $PID; s=0; wait $PID || s=$?
  [ "$s" = 130 ] || falha "$sig deveria sair com 130 (saiu $s)"
  kill "$EP" 2>/dev/null; wait "$EP" 2>/dev/null
  OUT=$(ls -td "$TMP"/saida2/ensaio-* | head -1); sem_dump
  [ -z "$(docker ps -q -f name=$ALVO)" ] || falha "o contêiner do alvo ficou de pé depois de $sig"
done
volumes "no fim de todas as rodadas"
passou "130 com TERM e HUP, dump apagado, contêiner removido, volumes inalterados"

echo "OK: ensaio.sh passou em todos os cenários"
