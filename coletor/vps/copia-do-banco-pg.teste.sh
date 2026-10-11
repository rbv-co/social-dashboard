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
# a imagem reinicia o servidor uma vez depois do initdb: espera três respostas seguidas
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
create table robos_execucoes (id bigserial primary key, robo text not null, disparado_em timestamptz not null default now(), status_code int, ok boolean, resposta text, conferido_em timestamptz);
-- como em produção: função SECURITY DEFINER do dono (superusuário) que ESCREVE, com o EXECUTE padrão para PUBLIC...
create table alvo_da_funcao (id int); insert into alvo_da_funcao values (1);
create function public.apagar_alvo() returns void language sql security definer as 'delete from alvo_da_funcao';
create function public.ola() returns text language sql security definer as 'select ''ola''';
-- ...e um gatilho em robos_execucoes (gatilho não depende de EXECUTE: o insert do papel copia tem de seguir valendo)
create function public.carimbar() returns trigger language plpgsql as 'begin new.status_code := coalesce(new.status_code, 200); return new; end';
create trigger carimbar before insert on robos_execucoes for each row execute function public.carimbar();"
[ $? -eq 0 ] || { echo "esquema de teste falhou"; exit 1; }

# ── o papel ───────────────────────────────────────────────────────────────────
saida=$(adm < "$SQL" 2>&1); confere "papel sem SENHA_COPIA recusa (exit 3)" $? 3
contem "papel sem senha diz o motivo" "$saida" "falta SENHA_COPIA no ambiente"
saida=$(SENHA_COPIA=$SENHA admsenha < "$SQL" 2>&1); confere "papel com senha" $? 0
nao_contem "a senha não aparece na saída do psql" "$saida" "$SENHA"
SENHA_COPIA=$SENHA admsenha < "$SQL" >/dev/null 2>&1; confere "papel reaplicado (idempotente)" $? 0
if grep -q "$SENHA" "$SQL"; then echo "FALHA senha dentro do .sql"; falhas=$((falhas + 1)); else echo "ok   senha fora do .sql (entra por \\getenv)"; fi
# `-e SENHA_COPIA` sem valor: o valor não vai para a linha de comando (ps do host)
grep -q 'docker exec -i -e SENHA_COPIA' "$RAIZ/ops/vps/api-db/LEIA-ME.md"; confere "LEIA-ME passa a senha pelo ambiente, não por argumento" $? 0

cop() { docker exec -i -e PGPASSWORD="$SENHA" "$NOME" psql -h 127.0.0.1 -U copia -d t11 -tA -v ON_ERROR_STOP=1 "$@" 2>&1; }
confere "copia lê accounts" "$(cop -c 'select count(*) from accounts')" "1"
confere "copia grava a linha da rodada" "$(cop -c "insert into robos_execucoes (robo, ok, status_code, resposta, conferido_em) values ('guardar-copia-do-banco', true, 200, 'ok', now())")" "INSERT 0 1"
confere "o gatilho da tabela segue disparando para o papel (sem EXECUTE)" "$(cop -c "insert into robos_execucoes (robo, ok, resposta, conferido_em) values ('guardar-copia-do-banco', true, 'gatilho', now()) returning status_code")" "200
INSERT 0 1"
adm -c "delete from robos_execucoes where resposta = 'gatilho'"
# ── funções: o limpar-dump tira GRANT/REVOKE, então toda função do public nasce com EXECUTE para PUBLIC ──
contem "copia NÃO executa função SECURITY DEFINER que escreve" "$(cop -c 'select public.apagar_alvo()')" "permission denied for function apagar_alvo"
confere "...e a linha do alvo continua lá" "$(adm -tA -c 'select count(*) from alvo_da_funcao')" "1"
contem "copia NÃO executa nem função inofensiva do public" "$(cop -c 'select public.ola()')" "permission denied for function ola"
adm -c "create function public.depois() returns void language sql security definer as 'delete from alvo_da_funcao'"
contem "função criada depois também nasce sem EXECUTE para o papel" "$(cop -c 'select public.depois()')" "permission denied for function depois"
confere "a consulta do checklist da VPS dá 0 (SECURITY DEFINER executável pelo copia)" "$(adm -tA -c "select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.prosecdef and has_function_privilege('copia', p.oid, 'execute')")" "0"
confere "o dono (superusuário: API e worker) segue executando" "$(adm -tA -c 'select public.ola()')" "ola"
contem "copia NÃO lê sessoes" "$(cop -c 'select * from sessoes')" "permission denied for table sessoes"
contem "copia NÃO lê token_hash" "$(cop -c 'select token_hash from sessoes')" "permission denied"
contem "copia NÃO apaga robos_execucoes" "$(cop -c 'delete from robos_execucoes')" "permission denied for table robos_execucoes"
contem "copia NÃO altera accounts" "$(cop -c "update accounts set name = 'x'")" "permission denied for table accounts"
contem "copia NÃO insere em accounts" "$(cop -c "insert into accounts (name) values ('x')")" "permission denied for table accounts"
contem "copia NÃO cria tabela" "$(cop -c 'create table t (a int)')" "permission denied"
adm -c "create table nova_da_migracao (a int); insert into nova_da_migracao values (1)"
confere "tabela criada depois entra por ALTER DEFAULT PRIVILEGES" "$(cop -c 'select count(*) from nova_da_migracao')" "1"
confere "copia só 2 conexões (connection limit)" "$(adm -tA -c "select rolconnlimit from pg_roles where rolname = 'copia'")" "2"

# ── a fonte Postgres da cópia, com o papel copia ─────────────────────────────
export COLETOR_ENV=/dev/null SUPABASE_URL=http://127.0.0.1:1 SUPABASE_SERVICE_KEY=
# a URL não leva a senha: o `pg` lê o PGPASSWORD do ambiente (é assim que o copia-do-banco.sh a entrega)
URL="postgres://copia@127.0.0.1:$PORTA/t11"
export COPIA_DATABASE_URL=$URL
adm -c "drop table nova_da_migracao"
cd "$RAIZ" || exit 1
saida=$(PGPASSWORD=$SENHA node coletor/guardar-copia-do-banco.mjs --ensaio 2>&1); confere "ensaio da cópia pelo papel copia (senha pelo PGPASSWORD)" $? 0
# a lista vem de pg_tables: sessoes APARECE (8 tabelas), mas fica fora da cópia por SEM_COPIA, sem ser lida
contem "todas as tabelas listadas (inclusive sessoes); a API fica fora da cópia" "$saida" "9 tabelas no banco · 4 nesta cópia · 5 fora de propósito"
contem "lê accounts" "$saida" "accounts"
contem "lê usuarios" "$saida" "usuarios"
contem "credencial tirada de usuarios, accounts e acessos_conexoes" "$saida" "3 tabelas tiveram a credencial removida"
for segredo in "$SENHA" hash-de-teste-bcrypt sessao-hash-secreto EAAG-token-de-teste refresh-de-teste segredo-do-cliente; do
  nao_contem "ensaio não imprime $segredo" "$saida" "$segredo"
done
saida2=$(PGPASSWORD=$SENHA node coletor/guardar-copia-do-banco.mjs --ensaio 2>&1); confere "ensaio repetido dá o mesmo exit" $? 0
confere "ensaio repetido dá a mesma saída (idempotente)" "$(echo "$saida2" | sed 1,2d)" "$(echo "$saida" | sed 1,2d)"

# tabela que o papel não pode ler NÃO some da cópia calada: a leitura falha alto (era o defeito do information_schema)
adm -c "create table sem_grant (a int); insert into sem_grant values (1); revoke select on sem_grant from copia"
saida=$(PGPASSWORD=$SENHA node coletor/guardar-copia-do-banco.mjs --ensaio 2>&1); confere "tabela sem SELECT derruba a cópia (exit 1)" $? 1
contem "...com o nome da tabela na frase" "$saida" "permission denied for table sem_grant"
nao_contem "...e sem segredo na saída" "$saida" "hash-de-teste-bcrypt"
adm -c "drop table sem_grant"

# coluna de credencial renomeada: o valor sairia em texto puro; a cópia tem de parar
adm -c "alter table usuarios rename column senha_hash to senha_hash_nova"
saida=$(PGPASSWORD=$SENHA node coletor/guardar-copia-do-banco.mjs --ensaio 2>&1); confere "coluna de credencial renomeada derruba a cópia (exit 1)" $? 1
contem "...dizendo qual coluna sumiu" "$saida" "usuarios.senha_hash"
nao_contem "...sem imprimir o valor" "$saida" "hash-de-teste-bcrypt"
adm -c "alter table usuarios rename column senha_hash_nova to senha_hash"

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
saida=$(PGPASSWORD=$SENHA node "$T/fonte.mjs" 2>&1); confere "fonte-pg com o papel copia" $? 0
contem "lista TODAS as tabelas do public, inclusive sessoes" "$saida" "tabelas=accounts,acessos_conexoes,alvo_da_funcao,envios_feitos,goose_db_version,robos_execucoes,sessoes,usuarios,webhooks_recebidos"
contem "lê usuarios como row_to_json" "$saida" "usuario_email=a@x tem_senha_hash=true"
contem "lê a conexão do Zoho" "$saida" "zoho_client_id=cid"
contem "banco recusa sessoes ao papel copia" "$saida" "sessoes=permission denied for table sessoes"
confere "registrar gravou 4 linhas conferidas (1 do teste do papel, 1 da falha da tabela sem SELECT e 2 da fonte)" "$(adm -tA -c "select count(*) from robos_execucoes where conferido_em is not null and robo = 'guardar-copia-do-banco'")" "4"
confere "a falha da tabela sem SELECT ficou no painel (ok=false, com a causa)" "$(adm -tA -c "select ok, resposta like '%sem_grant%' from robos_execucoes where resposta like '%permission denied%'")" "f|t"
confere "falha vira ok=false 500" "$(adm -tA -c "select ok, status_code from robos_execucoes where resposta = 'falha de teste'")" "f|500"

# falhas: senha errada e banco fora do ar têm de sair com 1 e sem vazar a senha
saida=$(PGPASSWORD=errada1234 node coletor/guardar-copia-do-banco.mjs --ensaio 2>&1); confere "senha errada sai com 1" $? 1
nao_contem "senha errada não vaza a senha" "$saida" "errada1234"
saida=$(PGPASSWORD=$SENHA COPIA_DATABASE_URL="postgres://copia@127.0.0.1:1/t11" node coletor/guardar-copia-do-banco.mjs --ensaio 2>&1); confere "banco fora do ar sai com 1" $? 1
nao_contem "banco fora do ar não vaza a senha" "$saida" "$SENHA"

# o copia-do-banco.sh não põe a senha em argumento nenhum (o ps do host mostra argumentos)
printf '#!/bin/sh\necho 127.0.0.1\n' > "$T/docker"
printf '#!/bin/sh\necho "args=$*" > "%s/args.log"\necho "node falou"\n' "$T" > "$T/node"
chmod +x "$T/docker" "$T/node"
unset COPIA_DATABASE_URL
saida=$(PATH="$T:$PATH" COPIA_DB_SENHA=$SENHA bash "$AQUI/copia-do-banco.sh" --ensaio 2>&1); confere "copia-do-banco.sh com os fakes" $? 0
nao_contem "senha fora dos argumentos do node" "$(cat "$T/args.log")" "$SENHA"
nao_contem "senha fora da saída (tela e erro) do copia-do-banco.sh" "$saida" "$SENHA"

# ── a trava do workflow do GitHub ────────────────────────────────────────────
python3 - "$YML" "$T/trava.sh" <<'PY'
import sys, re, yaml
w = yaml.safe_load(open(sys.argv[1]))
passos = w["jobs"]["copiar"]["steps"]
p = passos[0]
print("primeira etapa:", p.get("name"), "| if:", p.get("if"))
assert "uses" not in p, "a trava tem de ser a primeira etapa, antes do checkout"
# Qualquer valor NÃO VAZIO recusa (a trava antiga só aceitava 'sim': 0, false, no, true... passavam). Variável
# indefinida é null no Actions e null != '' é falso (null vira '' na comparação): roda.
assert p.get("if") == "vars.SAIU_DO_SUPABASE != ''", "a trava tem de testar `!= ''`"
def recusa(valor):
    return valor not in (None, "")
for v in ["sim", "0", "false", "no", "true", "1", "x", "nao", "Sim", " "]:
    assert recusa(v), f"valor {v!r} tinha de recusar"
for v in ["", None]:
    assert not recusa(v), f"valor {v!r} (vazio/indefinido) tinha de rodar"
open(sys.argv[2], "w").write(p["run"])
PY
confere "trava é a 1ª etapa e recusa qualquer valor não vazio (0, false, no, true, 1, x, sim); vazio roda" $? 0
saida=$(bash "$T/trava.sh" 2>&1); confere "a etapa da trava recusa (exit 1)" $? 1
contem "a recusa diz por quê" "$saida" "::error::Saímos do Supabase"
if grep -n 'copia-do-banco' "$YML" | grep -q 'schedule'; then echo "FALHA workflow voltou a ter agenda"; falhas=$((falhas + 1)); else echo "ok   workflow segue só manual"; fi

limpar
[ "$falhas" -eq 0 ] && echo "TUDO OK" || { echo "$falhas falha(s)"; exit 1; }
