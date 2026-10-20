#!/bin/sh
# Prova da rotina de backup do api-db. Roda NA VPS (precisa do contêiner api-db: só LÊ o banco, escreve em pasta
# temporária) — `ssh op sh /root/prova-07/rotina-backup.teste.sh`. Aviso e Drive são trocados por falsos (AVISAR_CMD,
# RCLONE). Nada aqui toca /root/backups-api nem o Drive de verdade.
set -u
AQUI=$(cd "$(dirname "$0")" && pwd)
T=$(mktemp -d /root/.teste-rotina.XXXXXX); trap 'rm -rf "$T"' EXIT
F=0
ok() { echo "ok   $1"; }
nok() { echo "FALHA $1"; F=1; }
assert() { if eval "$2"; then ok "$1"; else nok "$1"; fi; }
cat > "$T/avisar" <<'X'
#!/bin/sh
echo "$1 | $2" >> "$AVISOS"
X
cat > "$T/rclone" <<'X'
#!/bin/sh
# falso: copy = cp para a pasta do "Drive"; check = diff
case "$1" in copy) mkdir -p "$3"; cp "$2"/*.gpg "$3"/ ;; check) for f in "$2"/*.gpg; do cmp -s "$f" "$3/$(basename "$f")" || exit 1; done ;; esac
X
chmod +x "$T/avisar" "$T/rclone"
export AVISOS="$T/avisos"; : > "$AVISOS"
export AVISAR_CMD="$T/avisar" AQUI BACKUP_DIR="$T/bk"

# 1. backup: dump legível + papéis (o que faltava: sem eles o pg_restore falha nos GRANT)
sh "$AQUI/backup-api-db.sh" >/dev/null 2>"$T/err" || nok "backup-api-db.sh saiu com erro: $(tail -1 "$T/err")"
D=$(ls "$T"/bk/api-db-2*.dump 2>/dev/null | head -1)
assert "dump e .sha256 existem" '[ -s "$D" ] && [ -s "$D.sha256" ]'
assert "arquivo de papéis existe, modo 600, com CREATE ROLE" '[ -s "${D%.dump}.globals.sql" ] && [ "$(stat -c %a "${D%.dump}.globals.sql")" = 600 ] && grep -q "^CREATE ROLE " "${D%.dump}.globals.sql"'

# 2. restauração com os papéis passa (sem eles falhava: role "api_app" does not exist)
TESTE_CONTAINER=api-db-prova-teste sh "$AQUI/testar-restauracao.sh" "$D" > "$T/rest" 2>&1
assert "testar-restauracao.sh restaura com GRANTs" 'grep -q "restauração ok" "$T/rest"'

# 3. rotina inteira: sem falha, sem aviso
OFFSITE_CMD=true sh "$AQUI/rotina-backup.sh" >/dev/null 2>&1
assert "rotina ok => exit 0 e nenhum aviso" '[ $? -eq 0 ] && [ ! -s "$AVISOS" ]'
# 4. dump falhando => avisa
API_DB_CONTAINER=nao-existe OFFSITE_CMD=true sh "$AQUI/rotina-backup.sh" >/dev/null 2>&1
assert "backup falhando => exit 1 e aviso" '[ $? -eq 1 ] && grep -q "backup-api-db.sh falhou" "$AVISOS"'
: > "$AVISOS"
# 5. cópia fora falhando => avisa
OFFSITE_CMD=false sh "$AQUI/rotina-backup.sh" >/dev/null 2>&1
assert "cópia fora falhando => exit 1 e aviso" '[ $? -eq 1 ] && grep -q "Drive falhou" "$AVISOS"'
: > "$AVISOS"
# 6. vigia: dump recente passa; pasta vazia ou dump velho avisa
sh "$AQUI/rotina-backup.sh" --conferir; assert "--conferir com dump de agora => exit 0, sem aviso" '[ $? -eq 0 ] && [ ! -s "$AVISOS" ]'
BACKUP_DIR="$T/vazio" sh "$AQUI/rotina-backup.sh" --conferir; assert "--conferir sem dump => exit 1 e aviso" '[ $? -eq 1 ] && grep -q "nenhum dump" "$AVISOS"'
: > "$AVISOS"; D=$(ls -1t "$T"/bk/api-db-2*.dump | head -1)
for o in "$T"/bk/api-db-2*.dump; do [ "$o" = "$D" ] || rm -f "$o"; done   # as rodadas acima podem ter feito outro dump (minuto novo)
touch -d '3 hours ago' "$D"
sh "$AQUI/rotina-backup.sh" --conferir; assert "--conferir com dump de 3 h => exit 1 e aviso" '[ $? -eq 1 ] && [ -s "$AVISOS" ]'
touch "$D"

# 7. cópia cifrada: 3 .gpg no destino, nada em claro, segredo não aparece sem decifrar
mkdir -p "$T/seg" && echo "SEGREDO-DE-PROVA-123" > "$T/seg/robo-x.senha" && : > "$T/seg/api-db.env" && : > "$T/seg/api.env" && : > "$T/seg/worker.env"
echo senha-de-prova > "$T/gpg"; chmod 600 "$T/gpg"
env SENHA="$T/gpg" SEGREDOS="$T/seg" RCLONE="$T/rclone" DESTINO="$T/drive" sh "$AQUI/backup-api-db-offsite.sh" >/dev/null 2>"$T/err" || nok "offsite saiu com erro: $(tail -1 "$T/err")"
assert "offsite: dump, papéis e segredos cifrados no destino" '[ "$(ls "$T"/drive/*/ | grep -c "\.gpg$")" = 3 ] && ! ls "$T"/drive/*/ | grep -vq "\.gpg$"'
assert "offsite: segredo não aparece em claro" '! grep -rq SEGREDO-DE-PROVA-123 "$T/drive"'
assert "offsite: decifra e abre o tar dos segredos" 'gpg --batch -q --pinentry-mode loopback --passphrase-file "$T/gpg" -d "$T"/drive/*/api-db-segredos-*.gpg 2>/dev/null | tar -xzO 2>/dev/null | grep -q SEGREDO-DE-PROVA-123'
touch -d '3 days ago' "$D"
env SENHA="$T/gpg" SEGREDOS="$T/seg" RCLONE="$T/rclone" DESTINO="$T/drive2" sh "$AQUI/backup-api-db-offsite.sh" >/dev/null 2>&1
assert "offsite recusa dump de mais de 24 h" '[ $? -ne 0 ] && [ ! -d "$T/drive2" ]'
touch "$D"; rm -f "${D%.dump}.globals.sql"
env SENHA="$T/gpg" SEGREDOS="$T/seg" RCLONE="$T/rclone" DESTINO="$T/drive3" sh "$AQUI/backup-api-db-offsite.sh" >/dev/null 2>&1
assert "offsite recusa sem o arquivo de papéis" '[ $? -ne 0 ] && [ ! -d "$T/drive3" ]'
[ $F -eq 0 ] && echo "TUDO OK" || { echo "HÁ FALHAS"; exit 1; }
