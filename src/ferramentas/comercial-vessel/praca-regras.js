/* AS REGRAS DA PRAÇA — cidade → praça → loja de destino.
 *
 * ⚠️ POR QUE ISTO NÃO MORA NO `.vue`: a mesma conta é usada pela tela do
 * Stylist Circle, pela do Private Edit e pelo cadastro. Três cópias viram três
 * respostas diferentes no dia em que alguém ajusta uma.
 *
 * ⚠️ CIDADE QUE NÃO CASA DEVOLVE NULO. Chutar a praça "mais provável" manda
 * stylist para a loja errada sem ninguém ver — o dono pediu pendência à vista.
 */
export const achatarCidade = (t) => String(t ?? '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().trim().replace(/\s+/g, ' ')

export function pracaDaCidade(cidade, mapa) {
  const chave = achatarCidade(cidade)
  if (!chave) return null
  const achou = (Array.isArray(mapa) ? mapa : []).find((m) => m.cidade_chave === chave)
  return achou ? { praca_id: achou.praca_id, sigla: achou.sigla, nome: achou.nome, loja_destino: achou.loja_destino ?? null } : null
}

export function pendenciasDePraca(stylists, mapa) {
  const lista = Array.isArray(stylists) ? stylists : []
  const semPraca = lista.filter((s) => !s?.praca_id)
  const cidades = new Set()
  for (const s of semPraca) {
    const nome = String(s?.cidade ?? '').trim()
    if (nome && !pracaDaCidade(nome, mapa)) cidades.add(nome)
  }
  return { semPraca, cidadesSemPraca: [...cidades].sort((a, b) => a.localeCompare(b, 'pt-BR')) }
}

export const rotuloDaPraca = (p) => `${p?.nome ?? ''} · ${p?.loja_destino || 'loja a definir'}`
