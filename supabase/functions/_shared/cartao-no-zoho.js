// Regras puras para ACHAR, no Zoho, o arquivo de um cartão EAN que o robô já entregou. Sem rede, sem banco.
// Quem usa: a edge `vessel-baixar-cartao`. As regras de NOME são as do robô (coletor/lib/cartoes-da-fila.js,
// `rotuloDoCartao` e `nomeDaSubpasta`) — se um dia mudarem lá, mudam aqui, e o teste desta pasta confere os exemplos reais.
//
// Onde o robô guarda:  Cartões com EAN/<AAAA-MM-DD>/<SKU - Nome do modelo>/<SKU>_cartao_<NN>_<frente|verso>.<png|pdf>

export const FACES = ['frente', 'verso']
export const FORMATOS = ['png', 'pdf']

/** `NN` é a posição da peça no lote (`numero_na_serie`), com dois dígitos — igual ao robô. */
export const rotuloDoCartao = (sku, numero) => `${sku}_cartao_${String(numero).padStart(2, '0')}`

/** Valida o que a tela pediu. Devolve o nome do arquivo, ou `null` se face/formato/peça não fazem sentido. */
export function nomeDoArquivo(sku, numero, face, formato) {
  if (!sku || !Number.isInteger(Number(numero)) || Number(numero) < 1) return null
  if (!FACES.includes(face) || !FORMATOS.includes(formato)) return null
  return `${rotuloDoCartao(sku, numero)}_${face}.${formato}`
}

/** Só pasta de dia de verdade (2026-10-06), da mais nova para a mais velha. "… - BKP …" e afins ficam de fora. */
export function diasEmOrdem(pastas) {
  return (pastas || [])
    .filter((p) => /^\d{4}-\d{2}-\d{2}$/.test(String(p.name || '').trim()))
    .sort((a, b) => String(b.name).trim().localeCompare(String(a.name).trim()))
}

/** O dia ("2026-10-06") de uma `pasta` de pedido do robô ("Cartões com EAN/2026-10-06"); `null` se não for isso. Serve de dica, nunca de verdade. */
export function diaDaPasta(pasta) {
  const dia = String(pasta ?? '').split('/').pop().trim()
  return /^\d{4}-\d{2}-\d{2}$/.test(dia) ? dia : null
}

/** A mesma lista de dias com o dia-dica na frente (os outros seguem na ordem de antes). Sem dica, a lista como veio. */
export function diasComDicaPrimeiro(dias, dica) {
  if (!dica) return dias
  const nome = (d) => String(d.name || '').trim()
  return [...dias.filter((d) => nome(d) === dica), ...dias.filter((d) => nome(d) !== dica)]
}

/**
 * A subpasta do SKU dentro de um dia: "SS0001HB.S1 - Linear Caramelo Pequena" começa com "SKU - ".
 * ⚠️ NFC dos dois lados: "Cartões"/"Média" podem vir com acento solto, conforme quem criou a pasta.
 */
export function pastaDoSku(subpastas, sku) {
  const prefixo = `${sku} - `.normalize('NFC')
  return (subpastas || []).find((p) => String(p.name || '').normalize('NFC').startsWith(prefixo)) || null
}

/** "Cartões com EAN" — a pasta-mãe, comparada sem depender de como o acento foi gravado. */
export const ehPastaDosCartoes = (nome) => String(nome || '').normalize('NFC').trim() === 'Cartões com EAN'

export const TIPO_DO_ARQUIVO = { png: 'image/png', pdf: 'application/pdf' }
