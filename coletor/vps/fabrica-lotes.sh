#!/usr/bin/env bash
# RODA UM JOB DA FÁBRICA DE ANÚNCIOS E OS LOTES QUE ELE ENCADEAR (plano 01-C, 22/10/2026).
# Substitui o fabrica.yml do Actions (parado por billing). SOB DEMANDA, SEM CRON: a Fábrica nasce de um
# job enfileirado pela tela (`fabrica_jobs`), não de relógio.
#
# Uso (um job por vez, com lock, limite de tempo e log em /var/log/robos/fabrica.log):
#   ENV_ROBOS=/etc/fabrica.env /opt/robos/social-dashboard/coletor/vps/rodar-robo.sh fabrica 60 -- \
#     bash coletor/vps/fabrica-lotes.sh <job_id>
# /etc/fabrica.env (600, root): CENTRAL_API_URL, CENTRAL_API_TOKEN (srv_ do robo-fabrica), ANTHROPIC_API_KEY,
# OPENAI_API_KEY (Hero-IA) e ZOHO_* (export). SEM SUPABASE_*: o runner recusa rodar sem a API.
#
# O runner imprime `PROXIMO_LOTE=<job_id>` quando o lote parou no teto de gerações; cada lote roda num
# processo novo (memória do BiRefNet/puppeteer volta ao zero). A API recusa (409) acima de 300 lotes.
set -u
job="${1:-}"
[[ "$job" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$ ]] || { echo "uso: $0 <job_id (uuid)>" >&2; exit 64; }
cd "$(dirname "$0")/../../coletor" || exit 70

for lote in $(seq 1 300); do
  saida=$(mktemp)
  echo "== lote $lote: job $job =="
  node fabrica-job-runner.mjs --job "$job" | tee "$saida"
  rc=${PIPESTATUS[0]}
  prox=$(sed -n 's/^PROXIMO_LOTE=//p' "$saida" | tail -1)
  rm -f "$saida"
  [ "$rc" -eq 0 ] || exit "$rc"
  [ -n "$prox" ] || exit 0
  job="$prox"
done
echo "limite de 300 lotes atingido" >&2; exit 1
