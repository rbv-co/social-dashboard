#!/usr/bin/env bash
# Coletor de Notícias (Observatório Vessel), 7 passos (era .github/workflows/coletor-noticias.yml). Chamado por rodar-robo.sh.
#
# Semântica do workflow, preservada:
#  - cada passo tem limite próprio de tempo;
#  - a falha de um passo NÃO aborta os seguintes (os passos 4 a 6 rodavam com `!cancelled()`), mas a rodada inteira sai
#    com erro se algum falhou;
#  - o passo 7 (guarda de completude: audita e alerta) roda SEMPRE, no fim.
# Gasta IA (Sonnet e Opus) e faz web search: nunca duas rodadas juntas (o lock do nome, no rodar-robo.sh, garante).
# DRY=1 faz os passos que sabem simular (lojas, faxina) só simularem; os demais continuam gravando.
set -u
export RODADA="${RODADA:-$(TZ=America/Sao_Paulo date +%F)}"
export MODEL_SONNET="${MODEL_SONNET:-claude-sonnet-4-6}" MODEL_OPUS="${MODEL_OPUS:-claude-opus-4-8}" COLETOR_MODEL="${COLETOR_MODEL:-claude-sonnet-4-6}"

pior=0
passo() {  # passo <minutos> <script>
  local min="$1" script="$2"
  echo "── $script (limite ${min} min) ──"
  timeout --kill-after=30 "$((min * 60))" node "coletor/$script"
  local c=$?
  [ "$c" -ne 0 ] && { echo "⛔ $script saiu com código $c"; pior=$c; }
  return 0
}

passo 20 passo-lojas.mjs        # 1/7 lojas (best-sellers + novidades)
# Com REST_VIA_PG=1 (o banco é o novo) o ig-coletor fica de fora: ele grava mídia no Storage do Supabase e lê accounts.access_token,
# e nenhum dos dois tem papel/contrato no api-db antes da fase 2. O passo-verifica (7/7) vai acusar a falta do Instagram.
if [ "${REST_VIA_PG:-}" = 1 ]; then echo "── ig-coletor.mjs PULADO (Storage/token: fase 2) ──"
else passo 20 ig-coletor.mjs; fi  # 2/7 Instagram (Top Viral + Últimos Posts + Reels)
passo 40 agente-noticias.mjs    # 3/7 editorial (manchetes via web search, Sonnet)
passo 35 passo-enriquece.mjs    # 4/7 enriquecimento (análises Sonnet, resumos Opus)
passo 20 panorama-mercado.mjs   # 5/7 panorama do mercado (Opus)
passo 10 passo-faxina.mjs       # 6/7 faxina do storage (GC de mídia órfã)
node coletor/passo-verifica.mjs || { c=$?; echo "⛔ passo-verifica saiu com código $c"; pior=$c; }   # 7/7 guarda de completude
exit "$pior"
