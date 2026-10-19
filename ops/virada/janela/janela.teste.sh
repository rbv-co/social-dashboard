#!/bin/bash
# Prova (sem VPS, sem GitHub, sem banco) da lógica de t29-vps/t29-fase-a/t29-desfazer, t20 (conferir/reverter) e do cron novo, com falsos.
set -eu
AQUI=$(cd "$(dirname "$0")" && pwd); T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
fail() { echo "FALHOU: $*"; exit 1; }
# --- falsos: systemctl guarda o estado numa pasta; gh registra as chamadas e responde às listas
mkdir -p "$T/estado" "$T/virada" "$T/locks"
cat > "$T/systemctl" <<'X'
#!/bin/sh
d=$(dirname "$0")/estado
case "$1" in stop) echo inactive > "$d/$2";; start) echo active > "$d/$2";; is-active) cat "$d/$2" 2>/dev/null || echo inactive;; esac
X
cat > "$T/gh" <<'X'
#!/bin/sh
d=$(dirname "$0")
echo "$*" >> "$d/gh.log"
case "$1 $2" in
  "workflow list") cat "$d/ativos" ;;
  "workflow disable") grep -v "/$3\$" "$d/ativos" > "$d/ativos.n" || true; mv "$d/ativos.n" "$d/ativos" ;;
esac
X
chmod +x "$T/systemctl" "$T/gh"; echo active > "$T/estado/cartoes-ean"
# --- repositório falso com 22 workflows que citam a chave
mkdir -p "$T/repo/.github/workflows"; ( cd "$T/repo" && git init -q && for i in $(seq 1 22); do echo "x: SUPABASE_SERVICE_KEY" > ".github/workflows/w$i.yml"; done; git add -A; git -c user.email=a@b -c user.name=t commit -qm x )
printf '*/5 * * * * root /x/rodar-robo.sh a 1 -- true\n' > "$T/cron"
printf '.github/workflows/w1.yml\n.github/workflows/w2.yml\n.github/workflows/outro.yml\n' > "$T/ativos"
export CRON="$T/cron.d/robos-social-dashboard" VIRADA="$T/virada" SYSTEMCTL="$T/systemctl" LOCKS="$T/locks" GH="$T/gh" LOCAL=1 HOST=x
mkdir -p "$T/cron.d"; cp "$T/cron" "$CRON"
# 1. fase A: cron guardado e removido, serviço parado; roda de novo sem estrago
sh "$AQUI/t29-vps.sh" fase-a > "$T/o1"; [ ! -e "$CRON" ] && cmp -s "$T/cron" "$VIRADA/robos-social-dashboard" && [ "$(cat "$T/estado/cartoes-ean")" = inactive ] || fail "fase-a"
sh "$AQUI/t29-vps.sh" fase-a > /dev/null || fail "fase-a não é idempotente"
# 2. desfazer: cron de volta idêntico, serviço ativo
sh "$AQUI/t29-vps.sh" desfazer > /dev/null; cmp -s "$T/cron" "$CRON" && [ "$(cat "$T/estado/cartoes-ean")" = active ] || fail "desfazer"
# 3. já havia uma cópia DIFERENTE em /root/virada (P12 de antes): a Fase A guarda o cron de AGORA e deixa a velha como .anterior
echo '# velho' >> "$VIRADA/robos-social-dashboard"
sh "$AQUI/t29-vps.sh" fase-a >/dev/null || fail "fase-a com cópia diferente"
cmp -s "$T/cron" "$VIRADA/robos-social-dashboard" && [ -e "$VIRADA/robos-social-dashboard.anterior" ] && [ ! -e "$CRON" ] || fail "cópia diferente não foi tratada"
cp "$T/cron" "$CRON"
# 4. t29-fase-a.sh (Mac): só desliga o que estava ativo e está na lista; ensaio não muda nada
D="$T/D"; : > "$T/gh.log"
sh "$AQUI/t29-fase-a.sh" "$T/repo" "$D" --ensaio >/dev/null; grep -q 'workflow disable' "$T/gh.log" && fail "ensaio mudou algo"
cp "$T/gh.log" /dev/null; rm -f "$D/workflows-ativos-antes.txt"
sh "$AQUI/t29-fase-a.sh" "$T/repo" "$D" > "$T/o4" 2>&1 || { cat "$T/o4"; fail "fase-a Mac"; }
[ "$(grep -c 'workflow disable' "$T/gh.log")" = 2 ] || fail "esperava 2 disables (w1, w2), não o 'outro'"
! grep -q outro.yml "$T/gh.log" || fail "mexeu em workflow fora da lista"
# 5. desfazer reabilita só os dois
: > "$T/gh.log"; sh "$AQUI/t29-desfazer.sh" "$D" > /dev/null; [ "$(grep -c 'workflow enable' "$T/gh.log")" = 2 ] || fail "enable"
# 6. t20 conferir/reverter (compose falso)
W="$T/worker.env"; printf 'X=1\nWORKER_TAREFAS_DESLIGADAS=*\n' > "$W"; chmod 600 "$W"
WORKER_ENV="$W" API_DIR="$T" bash "$AQUI/t20-worker.sh" conferir > /dev/null || fail "t20 conferir"
sed -i.bak 's/=\*/=a,b/' "$W"; rm -f "$W.bak"; WORKER_ENV="$W" API_DIR="$T" bash "$AQUI/t20-worker.sh" conferir >/dev/null 2>&1 && fail "t20 aceitou worker.env sem '*'"
# 7. cron novo = cron de hoje menos a faxina do Storage (nenhuma outra linha mudou)
diff <(grep -v faxina-storage "$AQUI/../../../coletor/vps/robos.cron") <(grep -v faxina-storage "$AQUI/robos-social-dashboard.go" | grep -v '^# DESLIGADO NA VIRADA') > /dev/null || fail "cron novo difere do robos.cron além da faxina"
! grep -v '^#' "$AQUI/robos-social-dashboard.go" | grep -q faxina-storage || fail "faxina-storage continua ligada no cron novo"
echo "TUDO OK"
