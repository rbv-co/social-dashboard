#!/bin/bash
# Prova (sem VPS, sem docker, sem banco) da lógica do t17-pdv.sh: troca só a linha da URL, reverte sozinho em cada falha, e
# não troca nada se a prova do papel falhar. docker, deploy e conferência são falsos; git e python3 são de verdade.
set -eu
AQUI=$(cd "$(dirname "$0")" && pwd); T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
fail() { echo "FALHOU: $*"; exit 1; }
mkdir -p "$T/bin" "$T/seg" "$T/v" "$T/bk" "$T/origin.git"
cat > "$T/bin/docker" <<'X'
#!/bin/sh
case "$1" in
  network) [ "${FAKE_REDE:-sim}" = nao ] && exit 1; exit 0 ;;
  image) exit 0 ;;
  run) echo pecas_com_sku=5; echo negado_fora_das_colunas=true; exit "${FAKE_RUN_RC:-0}" ;;
  exec) if [ "$2" = api-db ]; then echo 1; else echo "no_conteiner pecas_com_sku=5"; exit "${FAKE_EXEC_RC:-0}"; fi ;;
  inspect) case "$*" in *State.Status*) echo running ;; *Networks*) echo "docker-lavessel api_net " ;; esac ;;
  logs) : ;;
  compose) echo "$*" >> "$FAKE_LOG"; exit 0 ;;
esac
X
cat > "$T/deploy" <<'X'
#!/bin/sh
echo "deploy chamado" >> "$FAKE_LOG"; if [ "${FAKE_DEPLOY:-ok}" = ok ]; then echo "DEPLOY OK"; else echo "FALHOU: REVERTENDO"; exit 1; fi
X
printf '#!/bin/sh\necho 401\n' > "$T/conferir"
chmod +x "$T/bin/docker" "$T/deploy" "$T/conferir"
# origem falsa do pdv-backend com o que o conferir procura
( cd "$T" && git init -q --bare -b master origin.git && git clone -q origin.git pdv 2>/dev/null && cd pdv && git config user.email t@t && git config user.name t \
  && mkdir -p src/catalogo deploy && echo x > src/catalogo/tls-da-origem.ts && echo "api_net: {}" > deploy/docker-compose.prod.yml \
  && printf 'A=1\nSUPABASE_DATABASE_URL=postgresql://velho:segredovelho@pooler:5432/postgres\nB=2' > .env && git add src deploy && git commit -qm i && git push -q origin HEAD:master )
chmod 600 "$T/pdv/.env"; cp -p "$T/pdv/.env" "$T/v/pdv-backend.env"; echo 'senhaNOVA123' > "$T/seg/pdv.senha"
export PATH="$T/bin:$PATH" FAKE_LOG="$T/log" PDV_DIR="$T/pdv" SEG="$T/seg" V="$T/v" BK="$T/bk" DEPLOY_PDV="$T/deploy" CONFERIR_DEPLOY="$T/conferir"
reset_env() { printf 'A=1\nSUPABASE_DATABASE_URL=postgresql://velho:segredovelho@pooler:5432/postgres\nB=2' > "$T/pdv/.env"; chmod 600 "$T/pdv/.env"; rm -f "$T"/bk/* "$T/log"; }
ORIG=$(printf 'A=1\nSUPABASE_DATABASE_URL=postgresql://velho:segredovelho@pooler:5432/postgres\nB=2')
S="sh $AQUI/t17-pdv.sh"
# 1. conferir
$S conferir > "$T/o" 2>&1 || { cat "$T/o"; fail "conferir"; }
# 1b. sem a rede, falha
FAKE_REDE=nao $S conferir > "$T/o" 2>&1 && fail "conferir deveria falhar sem a rede" || grep -q "rede api_net não existe" "$T/o" || fail "mensagem da rede"
# 2. aplicar com sucesso: só a linha da URL muda, modo 600, backup guardado, senha nunca impressa
reset_env; $S aplicar > "$T/o" 2>&1 || { cat "$T/o"; fail "aplicar (sucesso)"; }
grep -q "T+17 PDV OK" "$T/o" || fail "sem a mensagem de sucesso"
grep -q "senhaNOVA123" "$T/o" && fail "a senha apareceu na saída"
[ "$(sed -n 1p "$T/pdv/.env")" = "A=1" ] && [ "$(sed -n 3p "$T/pdv/.env")" = "B=2" ] || fail "mexeu em linha que não era a da URL"
[ "$(sed -n 2p "$T/pdv/.env")" = "SUPABASE_DATABASE_URL=postgres://pdv_leitura:senhaNOVA123@api-db:5432/api?sslmode=disable" ] || fail "URL nova errada"
[ "$(stat -f %Lp "$T/pdv/.env" 2>/dev/null || stat -c %a "$T/pdv/.env")" = 600 ] || fail "modo do .env não é 600"
[ "$(ls "$T"/bk | wc -l | tr -d ' ')" = 1 ] && [ "$(cat "$T"/bk/pdv-backend.env.t17-*)" = "$ORIG" ] || fail "backup do .env"
# 3. deploy falha: o .env volta ao original e o compose recria
reset_env; FAKE_DEPLOY=falha $S aplicar > "$T/o" 2>&1 && fail "aplicar deveria sair 1 se o deploy falha" || true
[ "$(cat "$T/pdv/.env")" = "$ORIG" ] || fail "o .env não voltou depois do deploy falho"
grep -q "force-recreate" "$T/log" || fail "reverter não recriou o contêiner"
# 4. deploy ok mas a conferência dentro do contêiner falha: reverte
reset_env; FAKE_EXEC_RC=2 $S aplicar > "$T/o" 2>&1 && fail "aplicar deveria sair 1" || true
[ "$(cat "$T/pdv/.env")" = "$ORIG" ] || fail "o .env não voltou depois da conferência no contêiner"
# 5. prova do papel falha: nada é trocado, nem backup, nem deploy
reset_env; FAKE_RUN_RC=3 $S aplicar > "$T/o" 2>&1 && fail "aplicar deveria falhar na prova do papel" || true
[ "$(cat "$T/pdv/.env")" = "$ORIG" ] && [ -z "$(ls "$T/bk")" ] && [ ! -e "$T/log" ] || fail "mexeu em algo apesar da prova do papel falhar"
echo "t17-pdv.teste.sh OK"
