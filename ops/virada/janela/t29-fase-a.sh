#!/bin/sh
# T-29, Fase A dos robôs e do Actions (roda no Mac do OP). Para os agendadores ANTES do congelamento; nada é apagado.
# Uso: sh t29-fase-a.sh <V=repo social-dashboard> <D=pasta de trabalho da virada> [--ensaio]
#   1. VPS: tira o cron.d dos robôs (guardado em /root/virada) e para o serviço `cartoes-ean` (t29-vps.sh fase-a).
#   2. Actions: `gh workflow disable` só dos workflows com SUPABASE_SERVICE_KEY que estão ATIVOS; as duas listas ficam em
#      $D/workflows.txt (todos) e $D/workflows-ativos-antes.txt (o que estava ativo: é o que o desfazer/enable usa).
# Inverso: t29-desfazer.sh. --ensaio: não muda nada (só confere que cada arquivo da lista é um workflow que o gh conhece).
# Conta do GitHub: a que já está ativa (NUNCA `gh auth switch`).
set -eu
AQUI=$(cd "$(dirname "$0")" && pwd)
V=${1:-}; D=${2:-}; ENSAIO=0; [ "${3:-}" = --ensaio ] && ENSAIO=1
[ -d "$V/.github/workflows" ] && [ -n "$D" ] || { sed -n '3,4p' "$0" >&2; exit 2; }
HOST=${HOST:-op}; GH_REPO=${GH_REPO:-rbv-co/social-dashboard}; GH=${GH:-gh}
mkdir -p "$D"
[ -s "$D/workflows.txt" ] || (cd "$V" && git grep -l SUPABASE_SERVICE_KEY -- .github/workflows) > "$D/workflows.txt"
n=$(wc -l < "$D/workflows.txt"); [ "$n" -ge 20 ] || { echo "FALHOU: $D/workflows.txt tem $n linhas (esperava ~22)" >&2; exit 1; }
[ -s "$D/workflows-ativos-antes.txt" ] || $GH workflow list -R "$GH_REPO" --limit 200 --json path,state -q '.[] | select(.state=="active") | .path' > "$D/workflows-ativos-antes.txt"
[ -s "$D/workflows-ativos-antes.txt" ] || { echo "FALHOU: lista de workflows ativos vazia (gh sem acesso?)" >&2; exit 1; }
alvo=$(grep -Fxf "$D/workflows.txt" "$D/workflows-ativos-antes.txt" || true)
echo "workflows a desligar: $(printf %s "$alvo" | grep -c . || true) de $n (o resto já estava desligado ou não existe)"
if [ "$ENSAIO" = 1 ]; then
  printf '%s\n' "$alvo" | while read -r w; do [ -n "$w" ] || continue; $GH workflow view "$(basename "$w")" -R "$GH_REPO" >/dev/null || { echo "FALHOU: gh não conhece $w" >&2; exit 1; }; done
  echo "ENSAIO OK: nada mudou (VPS: sh t29-vps.sh fase-a não foi chamado)"; exit 0
fi
if [ -n "${LOCAL:-}" ]; then sh -s fase-a < "$AQUI/t29-vps.sh"; else ssh "$HOST" sh -s fase-a < "$AQUI/t29-vps.sh"; fi
printf '%s\n' "$alvo" | while read -r w; do [ -n "$w" ] || continue; $GH workflow disable "$(basename "$w")" -R "$GH_REPO"; done
ativos=$($GH workflow list -R "$GH_REPO" --limit 200 --json path,state -q '.[] | select(.state=="active") | .path' | grep -Fxf "$D/workflows.txt" | grep -c . || true)
[ "$ativos" -eq 0 ] || { echo "FALHOU: $ativos workflow(s) da lista ainda ativo(s)" >&2; exit 1; }
echo "FASE A (robôs + Actions) OK"
