#!/bin/sh
# T+17 (GitHub Actions), no Mac do OP, DEPOIS de t17-robos.sh e da API no ar. Liga só o que já tem destino no api-db:
#   secrets CENTRAL_API_URL e CENTRAL_API_TOKEN (token `srv_` do usuário de serviço `robo-fabrica`, criado AQUI na VPS e entregue ao
#   `gh secret set` por stdin: nunca aparece na tela, no log nem em arquivo), variáveis FABRICA_EXIGE_API=1 e SAIU_DO_SUPABASE=sim,
#   e `gh workflow enable` de fabrica.yml e copia-do-banco.yml (trava SAIU_DO_SUPABASE). Os OUTROS ~20 workflows ficam DESLIGADOS (fase A):
#   são manuais, leem o Supabase congelado e não têm destino; cartoes-ean.yml (gerar a fila) também fica desligado (o robô de Cartões
#   roda na VPS). Não apaga o secret SUPABASE_SERVICE_KEY (o rollback precisa dele; some em D+1).
# Uso: sh t17-actions.sh <D=pasta de trabalho> [--ensaio]   (--ensaio: não muda nada, só confere acesso e nomes)
# Reverter (rollback B5): sh t17-actions.sh <D> --reverter   (variáveis voltam: SAIU_DO_SUPABASE=nao, FABRICA_EXIGE_API apagada; workflows
#   reabilitados são desligados de novo; o token fica revogado com `api servico revogar robo-fabrica`)
# Conta do GitHub: a que já está ativa (NUNCA `gh auth switch`).
set -eu
D=${1:-}; MODO=${2:-}; [ -n "$D" ] || { sed -n '9,10p' "$0" >&2; exit 2; }
HOST=${HOST:-op}; GH_REPO=${GH_REPO:-rbv-co/social-dashboard}; GH=${GH:-gh}
URL_API=${URL_API:-https://central.rbvcompany.com/api}
ENABLE="fabrica.yml copia-do-banco.yml"
SERVICO='cd /root/api && docker compose exec -T api api servico'
mkdir -p "$D"
for w in $ENABLE; do $GH workflow view "$w" -R "$GH_REPO" >/dev/null || { echo "FALHOU: gh não conhece $w" >&2; exit 1; }; done
$GH secret list -R "$GH_REPO" >/dev/null || { echo "FALHOU: gh sem acesso aos secrets de $GH_REPO" >&2; exit 1; }
case "$MODO" in
--ensaio) echo "ENSAIO OK: gh acessa o repositório e conhece $ENABLE; nada mudou"; exit 0 ;;
--reverter)
  $GH variable set SAIU_DO_SUPABASE --body nao -R "$GH_REPO"; $GH variable delete FABRICA_EXIGE_API -R "$GH_REPO" || true
  for w in $ENABLE; do $GH workflow disable "$w" -R "$GH_REPO" || true; done
  ssh "$HOST" "$SERVICO revogar robo-fabrica" || echo "aviso: revogue o token à mão: $SERVICO revogar robo-fabrica" >&2
  echo "REVERTIDO (Actions)"; exit 0 ;;
"") ;;
*) sed -n '9,10p' "$0" >&2; exit 2 ;;
esac
tok=$(ssh "$HOST" "$SERVICO criar robo-fabrica robo-fabrica@robos.invalid --modulos meta" 2>/dev/null | tail -n 1)
case "$tok" in srv_*) ;; *) echo "FALHOU: não recebi um token srv_ (a conta já existe? rode: ssh $HOST '$SERVICO revogar robo-fabrica' e repita)" >&2; exit 1 ;; esac
printf %s "$tok" | $GH secret set CENTRAL_API_TOKEN -R "$GH_REPO"; tok=
$GH secret set CENTRAL_API_URL --body "$URL_API" -R "$GH_REPO"
$GH variable set FABRICA_EXIGE_API --body 1 -R "$GH_REPO"
$GH variable set SAIU_DO_SUPABASE --body sim -R "$GH_REPO"
for w in $ENABLE; do $GH workflow enable "$w" -R "$GH_REPO"; echo "$w" >> "$D/workflows-reabilitados.txt"; done
$GH secret list -R "$GH_REPO" | grep -c '^CENTRAL_API_' | grep -qx 2 || { echo "FALHOU: secrets CENTRAL_API_* não aparecem" >&2; exit 1; }
[ "$($GH variable get SAIU_DO_SUPABASE -R "$GH_REPO")" = sim ] && [ "$($GH variable get FABRICA_EXIGE_API -R "$GH_REPO")" = 1 ] || { echo "FALHOU: variáveis" >&2; exit 1; }
echo "ACTIONS OK: 2 secrets, 2 variáveis, $ENABLE habilitados (os demais seguem desligados)"
