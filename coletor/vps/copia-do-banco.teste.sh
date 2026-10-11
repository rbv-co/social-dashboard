#!/usr/bin/env bash
# Autoteste do copia-do-banco.sh: docker e node de mentira, nada de produção.
# Uso: bash coletor/vps/copia-do-banco.teste.sh
set -u
AQUI="$(cd "$(dirname "$0")" && pwd)"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
printf '#!/bin/sh\necho "$IP_FALSO"\n' > "$T/docker"
# O node de mentira anota no ARQUIVO (não na tela) o que recebeu: a URL, a senha do ambiente e os argumentos.
printf '#!/bin/sh\necho "url=${COPIA_DATABASE_URL:-} pgpass=${PGPASSWORD:-} args=$*" >> "%s/node.log"\n' "$T" > "$T/node"
chmod +x "$T/docker" "$T/node"
export PATH="$T:$PATH"
unset SAIU_DO_SUPABASE COPIA_DB_SENHA PGPASSWORD COPIA_DATABASE_URL
falhas=0
confere() { if [ "$2" = "$3" ]; then echo "ok   $1"; else echo "FALHA $1 (esperado '$3', veio '$2')"; falhas=$((falhas + 1)); fi; }
nao_contem() { case "$2" in *"$3"*) echo "FALHA $1 (apareceu '$3')"; falhas=$((falhas + 1)) ;; *) echo "ok   $1" ;; esac; }
C="$AQUI/copia-do-banco.sh"
SENHA=ab12cd34ef56

# Toda saída do script (tela e erro) é capturada: a senha não pode aparecer nela nem com `set -x`.
saida=$(IP_FALSO=172.20.0.5 COPIA_DB_SENHA=$SENHA bash "$C" --ensaio 2>&1); confere "depois do corte roda" $? 0
confere "URL do Postgres novo pelo IP da api_net, SEM a senha" "$(head -1 "$T/node.log" | cut -d' ' -f1)" "url=postgres://copia@172.20.0.5:5432/api"
confere "a senha vai pelo PGPASSWORD do ambiente" "$(head -1 "$T/node.log" | cut -d' ' -f2)" "pgpass=$SENHA"
nao_contem "a senha não está na URL nem nos argumentos" "$(head -1 "$T/node.log" | sed "s/pgpass=$SENHA//")" "$SENHA"
nao_contem "a senha não aparece na saída do script" "$saida" "$SENHA"
grep -q -- "--limpar" "$T/node.log"; confere "ensaio não limpa" $? 1

rm -f "$T/node.log"
saida=$(IP_FALSO=172.20.0.5 bash "$C" --ensaio 2>&1); confere "antes do corte roda" $? 0
confere "sem COPIA_DB_SENHA não monta URL (segue no Supabase)" "$(cut -d' ' -f1 "$T/node.log")" "url="
confere "sem COPIA_DB_SENHA não define PGPASSWORD" "$(cut -d' ' -f2 "$T/node.log")" "pgpass="

rm -f "$T/node.log"
saida=$(IP_FALSO= COPIA_DB_SENHA=$SENHA bash "$C" --ensaio 2>&1); confere "api-db fora do ar falha" $? 1
[ -e "$T/node.log" ]; confere "sem IP nem chama o node" $? 1
nao_contem "api-db fora do ar não imprime a senha" "$saida" "$SENHA"

# A CHAVE DO CORTE: com SAIU_DO_SUPABASE (qualquer valor não vazio) a cópia NÃO cai de volta no Supabase velho
# quando falta a senha: falha alto. Voltar atrás é apagar a variável de /etc/robos.env.
for v in sim 0 false no true 1 x; do
  rm -f "$T/node.log"
  saida=$(IP_FALSO=172.20.0.5 SAIU_DO_SUPABASE=$v bash "$C" --ensaio 2>&1); confere "SAIU_DO_SUPABASE='$v' sem COPIA_DB_SENHA falha" $? 1
  [ -e "$T/node.log" ]; confere "SAIU_DO_SUPABASE='$v' sem senha não chama o node" $? 1
done
case "$saida" in *"COPIA_DB_SENHA"*) echo "ok   a recusa diz o que falta" ;; *) echo "FALHA a recusa não diz o que falta"; falhas=$((falhas + 1)) ;; esac
rm -f "$T/node.log"
IP_FALSO=172.20.0.5 SAIU_DO_SUPABASE= bash "$C" --ensaio >/dev/null 2>&1; confere "SAIU_DO_SUPABASE vazio = antes do corte, segue no Supabase" $? 0
confere "...e sem URL" "$(cut -d' ' -f1 "$T/node.log")" "url="
rm -f "$T/node.log"
saida=$(IP_FALSO=172.20.0.5 SAIU_DO_SUPABASE=sim COPIA_DB_SENHA=$SENHA bash "$C" --ensaio 2>&1); confere "depois do corte com a senha roda" $? 0
confere "...no Postgres novo" "$(cut -d' ' -f1 "$T/node.log")" "url=postgres://copia@172.20.0.5:5432/api"
nao_contem "...sem imprimir a senha" "$saida" "$SENHA"

[ "$falhas" -eq 0 ] && echo "TUDO OK" || { echo "$falhas falha(s)"; exit 1; }
