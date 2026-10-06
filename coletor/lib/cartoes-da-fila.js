// coletor/lib/cartoes-da-fila.js
// Regras puras do robô de cartões EAN (sem rede, sem disco). O robô é coletor/robo-de-cartoes.mjs.

/** Nome do arquivo de um cartão, igual ao que `vessel-brasil/cartao/gerar-lote.mjs` entrega ao Zoho. */
export const rotuloDoCartao = (sku, numero) => `${sku}_cartao_${String(numero).padStart(2, '0')}`

/**
 * "Alba_Areia - SS0004HB.B3" -> "SS0004HB.B3 - Alba Areia". É a MESMA regra de `nomeDaSubpasta` em
 * vessel-brasil/cartao/gerar-lote.mjs: a entrega de hoje tem de cair na pasta que o dono já conhece.
 * ⚠️ Caractere de controle vira "-" na criação: o TrueSync do Zoho renomearia depois e a cópia seguinte falharia.
 */
export function nomeDaSubpasta(pasta, sku) {
  const semSku = String(pasta).replace(/\s*-\s*SS[0-9]+[A-Z]{1,2}\.[A-Z]?[0-9]+\s*$/i, '').trim()
  return `${sku} - ${semSku.replace(/_/g, ' ').replace(/[\u0000-\u001F\u007F]/g, '-')}`
}

/**
 * `codigo` da peça NÃO é o número de série (é um texto sorteado, ex. "5STJHPGYX6"). O cartão precisa do SKU do
 * lote e da posição da peça no lote (`numero_na_serie`).
 *
 * `linhas` = vessel_pecas já com o lote: [{ codigo, numero_na_serie, vessel_lotes: { sku } }].
 * Devolve as peças agrupadas por SKU e os códigos que não se resolvem (sem lote, sem SKU ou sem número):
 * esses NÃO geram cartão — e voltam como falha, nunca em silêncio.
 */
export function agruparPorSku(codigosPedidos, linhas) {
  const porCodigo = new Map((linhas ?? []).map((l) => [l.codigo, l]))
  const porSku = new Map()
  const semDados = []
  for (const codigo of codigosPedidos) {
    const l = porCodigo.get(codigo)
    const sku = String(l?.vessel_lotes?.sku ?? '').trim()
    const numero = Number(l?.numero_na_serie)
    if (!l || !sku || !Number.isInteger(numero) || numero < 1) {
      semDados.push({ codigo, motivo: !l ? 'peça não encontrada' : !sku ? 'o lote não tem SKU' : 'a peça não tem número no lote' })
      continue
    }
    if (!porSku.has(sku)) porSku.set(sku, [])
    porSku.get(sku).push({ codigo, numero })
  }
  for (const pecas of porSku.values()) pecas.sort((a, b) => a.numero - b.numero)
  return { porSku, semDados }
}

/**
 * O que o robô devolve ao banco quando termina.
 *
 * ⚠️ `vessel_cartao_pedido_terminou(p_ok=false)` NÃO marca peça nenhuma, e `p_ok=true` marca as de `p_pecas`.
 * A marca `cartao_gerado_em` é o que PRENDE o número de série, então só vale para cartão que subiu e foi
 * conferido. Resultado parcial vira DUAS chamadas: primeiro marca as boas, depois fecha o pedido como `falhou`
 * com a lista do que faltou. Pedido nunca fica "pronto" com cartão faltando.
 *
 * @param {{ pedidas: string[], confirmadas: string[], falhas: {rotulo:string, motivo:string}[], pasta: string|null }} e
 * @returns {{ ok: boolean, pecas: string[], erro: string|null, pasta: string|null }[]} chamadas, na ordem
 */
export function planoDeDevolucao({ pedidas, confirmadas, falhas, pasta }) {
  const boas = pedidas.filter((c) => confirmadas.includes(c))
  const faltou = pedidas.length - boas.length
  if (!faltou && !falhas.length) return [{ ok: true, pecas: boas, erro: null, pasta }]
  const resumo = falhas.map((f) => `${f.rotulo}: ${f.motivo}`).join(' | ')
  const erro = `${faltou} de ${pedidas.length} cartões não saíram. ${resumo}`.slice(0, 900)
  const chamadas = []
  if (boas.length) chamadas.push({ ok: true, pecas: boas, erro: null, pasta })
  chamadas.push({ ok: false, pecas: [], erro, pasta })
  return chamadas
}

/** Os quatro arquivos de um cartão (frente e verso, PNG e PDF), na ordem de envio. */
export const arquivosDoCartao = (rotulo) =>
  ['frente', 'verso'].flatMap((lado) => ['png', 'pdf'].map((ext) => `${rotulo}_${lado}.${ext}`))
