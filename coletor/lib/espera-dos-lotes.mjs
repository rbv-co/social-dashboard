// coletor/lib/espera-dos-lotes.mjs
//
// ⚠️ O ROBO DAS FOTOS DO SELO REPETIA O MESMO LOTE SEM SAIDA A CADA 5 MINUTOS.
// Medido em 22/10/2026: 5 lotes que dependem de gente (pasta do Zoho sem o SKU,
// cor que o Bling nao diz, duas bolsas na mesma pasta) eram buscados de novo
// 288 vezes por dia — ~2.900 chamadas ao Bling e ~860 buscas no Zoho por dia,
// para responder sempre a mesma coisa.
//
// Agora o lote que terminou SEM MUDANCA e SEM FALHA PASSAGEIRA espera 6 horas.
// A espera vale so para aquele lote COMO ESTA: se alguem mexer nele no banco
// (sku, cor, modelo, fotos), a assinatura muda e a proxima rodada olha na hora.
// Falha passageira (Zoho fora, link do Bling vencido, Bling sem resposta) nao
// espera: a proxima rodada tenta de novo, como sempre.
//
// O estado fica num arquivo em /tmp: perder o arquivo (reboot) so faz o robo
// olhar todos uma vez a mais. Nao e dado que precise sobreviver.

import { readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export const ESPERA_MS = 6 * 3600e3
export const ARQUIVO_PADRAO = join(tmpdir(), 'fotos-do-selo-espera.json')

export const assinatura = (lote) => JSON.stringify([lote.sku ?? null, lote.cor ?? null, lote.modelo ?? null, lote.fotos ?? null])

export function lerEspera(arquivo = ARQUIVO_PADRAO) {
  try { return JSON.parse(readFileSync(arquivo, 'utf8')) } catch { return {} }
}

export function gravarEspera(espera, arquivo = ARQUIVO_PADRAO) {
  try { writeFileSync(arquivo, JSON.stringify(espera)) } catch { /* sem arquivo = olha todos de novo; nao derruba a rodada */ }
}

/** O lote esta esperando (mesma assinatura e prazo ainda nao venceu)? */
export function emEspera(espera, lote, agora = Date.now()) {
  const e = espera[lote.id]
  return Boolean(e && e.assinatura === assinatura(lote) && e.ate > agora)
}

/** Fim do lote nesta rodada: sem saida espera; mudou ou falhou de passagem volta a olhar na proxima. */
export function anotar(espera, lote, { mudou, passageiro }, agora = Date.now()) {
  if (mudou || passageiro) delete espera[lote.id]
  else espera[lote.id] = { assinatura: assinatura(lote), ate: agora + ESPERA_MS }
  return espera
}

/** Tira da espera os lotes que nem existem mais (o arquivo nao cresce para sempre). */
export function limpar(espera, lotes) {
  const vivos = new Set(lotes.map((l) => String(l.id)))
  for (const id of Object.keys(espera)) if (!vivos.has(id)) delete espera[id]
  return espera
}
