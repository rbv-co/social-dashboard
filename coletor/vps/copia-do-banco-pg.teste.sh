#!/usr/bin/env bash
# Prova o papel `copia`, a fonte Postgres da cópia e a trava do workflow contra um Postgres 17 DESCARTÁVEL
# que o próprio teste cria (nome único, porta 58812+, removido no fim com `docker rm -fv`). Nada de produção.
# Uso (na raiz do repositório; precisa de docker e de `(cd coletor && npm ci)`):
#   bash coletor/vps/copia-do-banco-pg.teste.sh
set -u
AQUI="$(cd "$(dirname "$0")" && pwd)"
RAIZ="$(cd "$AQUI/../.." && pwd)"
SQL="$RAIZ/ops/vps/api-db/papel-copia.sql"
YML="$RAIZ/.github/workflows/copia-do-banco.yml"
NOME="copia-t11-$$-teste"
SENHA=abcdef0123456789      # inventada, só deste teste
T="$(mktemp -d)"
falhas=0
confere() { if [ "$2" = "$3" ]; then echo "ok   $1"; else echo "FALHA $1 (esperado '$3', veio '$2')"; falhas=$((falhas + 1)); fi; }
contem() { case "$2" in *"$3"*) echo "ok   $1" ;; *) echo "FALHA $1 (não achei '$3')"; falhas=$((falhas + 1)) ;; esac; }
nao_contem() { case "$2" in *"$3"*) echo "FALHA $1 (apareceu '$3')"; falhas=$((falhas + 1)) ;; *) echo "ok   $1" ;; esac; }
limpar() { docker rm -fv "$NOME" >/dev/null 2>&1; rm -rf "$T"; }
trap limpar EXIT

PORTA=58812
while lsof -iTCP:"$PORTA" -sTCP:LISTEN >/dev/null 2>&1; do PORTA=$((PORTA + 1)); done
docker run -d --name "$NOME" -e POSTGRES_PASSWORD=x -p "127.0.0.1:$PORTA:5432" postgres:17 >/dev/null || { echo "docker não subiu"; exit 1; }
# a imagem reinicia o servidor uma vez depois do initdb: espera duas respostas seguidas
ok=0
for _ in $(seq 1 60); do
  if docker exec "$NOME" pg_isready -h 127.0.0.1 -U postgres >/dev/null 2>&1; then ok=$((ok + 1)); [ "$ok" -ge 3 ] && break; else ok=0; fi
  sleep 1
done
adm() { docker exec -i "$NOME" psql -U postgres -d t11 -v ON_ERROR_STOP=1 -q "$@"; }
# `-e SENHA_COPIA` sem valor: o docker herda do ambiente, a senha não vai para a linha de comando
admsenha() { docker exec -i -e SENHA_COPIA "$NOME" psql -U postgres -d t11 -v ON_ERROR_STOP=1 -q; }
docker exec "$NOME" psql -U postgres -q -c "create database t11" || exit 1
adm -c "
create table usuarios (id uuid primary key, email text, senha_hash text);
insert into usuarios values ('aaaaaaaa-0000-0000-0000-000000000001', 'a@x', 'hash-de-teste-bcrypt');
create table sessoes (id text, token_hash text);
insert into sessoes values ('s', 'sessao-hash-secreto');
create table accounts (id uuid, name text, access_token text);
insert into accounts values ('aaaaaaaa-0000-0000-0000-000000000002', 'Móveis', 'EAAG-token-de-teste');
create table acessos_conexoes (provedor text, client_id text, client_secret text, refresh_token text, data_center text);
insert into acessos_conexoes values ('zoho', 'cid', 'segredo-do-cliente', 'refresh-de-teste', '.com');
create table webhooks_recebidos (id text); create table envios_feitos (chave text); create table goose_db_version (id int);
create table robos_execucoes (id bigserial primary key, robo text not null, disparado_em timestamptz not null default now(), status_code int, ok boolean, resposta text, conferido_em timestamptz);"
[ $? -eq 0 ] || { echo "esquema de teste falhou"; exit 1; }

# ── o papel ───────────────────────────────────────────────────────────────────
saida=$(adm < "$SQL" 2>&1); confere "papel sem SENHA_COPIA recusa (exit 3)" $? 3
contem "papel sem senha diz o motivo" "$saida" "falta SENHA_COPIA no ambiente"
saida=$(SENHA_COPIA=$SENHA admsenha < "$SQL" 2>&1); confere "papel com senha" $? 0
nao_contem "a senha não aparece na saída do psql" "$saida" "$SENHA"
SENHA_COPIA=$SENHA admsenha < "$SQL" >/dev/null 2>&1; confere "papel reaplicado (idempotente)" $? 0
if grep -q "$SENHA" "$SQL"; then echo "FALHA senha dentro do .sql"; falhas=$((falhas + 1)); else echo "ok   senha fora do .sql (entra por \\getenv)"; fi
# `-e SENHA_COPIA` sem valor: o valor não vai para a linha de comando (ps do host)
contem "senha pelo ambiente, não por argumento" "$(grep -c 'docker exec -i -e SENHA_COPIA' "$AQUI/../../ops/vps/api-db/LEIA-ME.md")" "1"

cop() { docker exec -i -e PGPASSWORD="$SENHA" "$NOME" psql -h 127.0.0.1 -U copia -d t11 -tA -v ON_ERROR_STOP=1 "$@" 2>&1; }
confere "copia lê accounts" "$(cop -c 'select count(*) from accounts')" "1"
confere "copia grava a linha da rodada" "$(cop -c "insert into robos_execucoes (robo, ok, status_code, resposta, conferido_em) values ('guardar-copia-do-banco', true, 200, 'ok', now())")" "INSERT 0 1"
contem "copia NÃO lê sessoes" "$(cop -c 'select * from sessoes')" "permission denied for table sessoes"
contem "copia NÃO lê token_hash" "$(cop -c 'select token_hash from sessoes')" "permission denied"
contem "copia NÃO apaga robos_execucoes" "$(cop -c 'delete from robos_execucoes')" "permission denied for table robos_execucoes"
contem "copia NÃO altera accounts" "$(cop -c "update accounts set name = 'x'")" "permission denied for table accounts"
contem "copia NÃO insere em accounts" "$(cop -c "insert into accounts (name) values ('x')")" "permission denied for table accounts"
contem "copia NÃO cria tabela" "$(cop -c 'create table t (a int)')" "permission denied"
adm -c "create table nova_da_migracao (a int); insert into nova_da_migracao values (1)"
confere "tabela criada depois entra por ALTER DEFAULT PRIVILEGES" "$(cop -c 'select count(*) from nova_da_migracao')" "1"
contem "copia só 2 conexões (connection limit)" "$(adm -tA -c "select rolconnlimit from pg_roles where rolname = 'copia'")" "2"

# ── a fonte Postgres da cópia, com o papel copia ─────────────────────────────
export COLETOR_ENV=/dev/null SUPABASE_URL=http://127.0.0.1:1 SUPABASE_SERVICE_KEY=
URL="postgres://copia:$SENHA@127.0.0.1:$PORTA/t11"
adm -c "drop table nova_da_migracao"
cd "$RAIZ" || exit 1
saida=$(COPIA_DATABASE_URL=$URL node coletor/guardar-copia-do-banco.mjs --ensaio 2>&1); confere "ensaio da cópia pelo papel copia" $? 0
# information_schema só mostra ao papel as tabelas em que ele tem privilégio: sessoes nem aparece (7 em vez de 8)
contem "só as tabelas da cópia (3 de 7 visíveis; a API fica fora)" "$saida" "7 tabelas no banco · 3 nesta cópia · 4 fora de propósito"
contem "lê accounts" "$saida" "accounts"
contem "lê usuarios" "$saida" "usuarios"
contem "credencial tirada de usuarios, accounts e acessos_conexoes" "$saida" "3 tabelas tiveram a credencial removida"
for segredo in "$SENHA" hash-de-teste-bcrypt sessao-hash-secreto EAAG-token-de-teste refresh-de-teste segredo-do-cliente; do
  nao_contem "ensaio não imprime $segredo" "$saida" "$segredo"
done
saida2=$(COPIA_DATABASE_URL=$URL node coletor/guardar-copia-do-banco.mjs --ensaio 2>&1); confere "ensaio repetido dá o mesmo exit" $? 0
confere "ensaio repetido dá a mesma saída (idempotente)" "$(echo "$saida2" | sed 1,2d)" "$(echo "$saida" | sed 1,2d)"

# fonte-pg de verdade: o JSON do usuario sai com a coluna (o robô é quem tira o valor), sessoes é recusada pelo banco
cat > "$T/fonte.mjs" <<EOF
import { abrirFontePg } from '$RAIZ/coletor/lib/fonte-pg.mjs';
const f = await abrirFontePg(process.env.COPIA_DATABASE_URL);
const tabs = await f.tabelas();
console.log('tabelas=' + tabs.join(','));
const u = await f.ler('usuarios');
console.log('usuario_email=' + u[0].email + ' tem_senha_hash=' + ('senha_hash' in u[0]));
await f.registrar(true, 'ensaio do teste');
await f.registrar(false, 'falha de teste');
const z = await f.conexaoZoho();
console.log('zoho_client_id=' + z.client_id);
try { await f.ler('sessoes'); console.log('sessoes=LEU'); } catch (e) { console.log('sessoes=' + e.message); }
await f.fechar();
EOF
saida=$(COPIA_DATABASE_URL=$URL node "$T/fonte.mjs" 2>&1); confere "fonte-pg com o papel copia" $? 0
contem "lista as tabelas do public, sem sessoes (o papel nem a enxerga)" "$saida" "tabelas=accounts,acessos_conexoes,envios_feitos,goose_db_version,robos_execucoes,usuarios,webhooks_recebidos"
contem "lê usuarios como row_to_json" "$saida" "usuario_email=a@x tem_senha_hash=true"
contem "lê a conexão do Zoho" "$saida" "zoho_client_id=cid"
contem "banco recusa sessoes ao papel copia" "$saida" "sessoes=permission denied for table sessoes"
confere "registrar gravou 3 linhas conferidas (1 do teste do papel + 2 da fonte)" "$(adm -tA -c "select count(*) from robos_execucoes where conferido_em is not null and robo = 'guardar-copia-do-banco'")" "3"
confere "falha vira ok=false 500" "$(adm -tA -c "select ok, status_code from robos_execucoes where resposta = 'falha de teste'")" "f|500"

# falhas: senha errada e banco fora do ar têm de sair com 1 e sem vazar a senha
saida=$(COPIA_DATABASE_URL="postgres://copia:errada1234@127.0.0.1:$PORTA/t11" node coletor/guardar-copia-do-banco.mjs --ensaio 2>&1); confere "senha errada sai com 1" $? 1
nao_contem "senha errada não vaza a senha" "$saida" "errada1234"
saida=$(COPIA_DATABASE_URL="postgres://copia:$SENHA@127.0.0.1:1/t11" node coletor/guardar-copia-do-banco.mjs --ensaio 2>&1); confere "banco fora do ar sai com 1" $? 1
nao_contem "banco fora do ar não vaza a senha" "$saida" "$SENHA"

# o copia-do-banco.sh não põe a senha em argumento nenhum (o ps do host mostra argumentos)
printf '#!/bin/sh\necho 127.0.0.1\n' > "$T/docker"
printf '#!/bin/sh\necho "args=$*" > "%s/args.log"\n' "$T" > "$T/node"
chmod +x "$T/docker" "$T/node"
PATH="$T:$PATH" COPIA_DB_SENHA=$SENHA bash "$AQUI/copia-do-banco.sh" --ensaio; confere "copia-do-banco.sh com os fakes" $? 0
nao_contem "senha fora dos argumentos do node" "$(cat "$T/args.log")" "$SENHA"

# ── a trava do workflow do GitHub ────────────────────────────────────────────
python3 - "$YML" "$T/trava.sh" <<'PY'
import sys, yaml
w = yaml.safe_load(open(sys.argv[1]))
passos = w["jobs"]["copiar"]["steps"]
p = passos[0]
print("primeira etapa:", p.get("name"), "| if:", p.get("if"))
assert p.get("if") == "vars.SAIU_DO_SUPABASE == 'sim'", "a trava tem de ser a primeira etapa e testar a variável"
assert "uses" not in passos[0] and passos.index(p) == 0
open(sys.argv[2], "w").write(p["run"])
PY
confere "trava é a 1ª etapa, antes do checkout" $? 0
saida=$(bash "$T/trava.sh" 2>&1); confere "a etapa da trava recusa (exit 1)" $? 1
contem "a recusa diz por quê" "$saida" "::error::Saímos do Supabase"
if grep -n 'copia-do-banco' "$YML" | grep -q 'schedule'; then echo "FALHA workflow voltou a ter agenda"; falhas=$((falhas + 1)); else echo "ok   workflow segue só manual"; fi

limpar
[ "$falhas" -eq 0 ] && echo "TUDO OK" || { echo "$falhas falha(s)"; exit 1; }
