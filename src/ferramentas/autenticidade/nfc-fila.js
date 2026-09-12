// A fila de gravação das etiquetas NFC. Contas puras — sem DOM, sem rede, sem
// NDEFReader — porque é aqui que mora a decisão de marcar ou não uma peça como
// gravada, e essa decisão precisa ser testável sem abrir navegador.
import { enderecoDaTag, naFila } from './lotes.js'

// O prefixo NASCE de enderecoDaTag, nunca escrito de novo. Domínio em dois
// lugares é domínio errado esperando acontecer — e este aqui vai gravado dentro
// de um chip costurado numa bolsa, onde não se corrige.
const PREFIXO = enderecoDaTag('')

export function codigoDoEndereco(url) {
  const texto = String(url ?? '').trim()
  if (!texto.toLowerCase().startsWith(PREFIXO.toLowerCase())) return null
  // corta em barra, interrogação ou cerquilha: app de NFC de terceiros costuma
  // devolver o endereço com sobras
  const resto = texto.slice(PREFIXO.length).split(/[?#/]/)[0].toUpperCase()
  return /^[A-Z0-9]{6,32}$/.test(resto) ? resto : null
}

// É ESTA FUNÇÃO QUE DECIDE SE MARCA OU NÃO.
// 'confere'      → a etiqueta devolveu esta peça; pode marcar
// 'vazia'        → etiqueta em branco; pode gravar
// 'outra-peca'   → etiqueta JÁ TEM outra peça do selo; PARAR, não sobrescrever
// 'nao-e-vessel' → tem alguma coisa que não é do selo
export function conferirLeitura(lidoDaTag, codigoEsperado) {
  const texto = String(lidoDaTag ?? '').trim()
  if (!texto) return 'vazia'
  const codigo = codigoDoEndereco(texto)
  if (!codigo) return 'nao-e-vessel'
  return codigo === String(codigoEsperado ?? '').trim().toUpperCase()
    ? 'confere'
    : 'outra-peca'
}

// ── O GRAVADOR DE MESA ─────────────────────────────────────────────────────
// Celular e gravador de mesa gravam a MESMA fila. O que impede gravar duas
// vezes a mesma peça é os dois beberem daqui.

// UMA URL POR LINHA, coluna única, sem separador. O gravador ainda não foi
// comprado — apostar num formato de CSV agora é apostar às cegas. Lista simples
// qualquer programa lê.
export function listaParaGravadorDeMesa(pecas) {
  return (Array.isArray(pecas) ? pecas : [])
    // peça baixada (extraviada, defeito, devolvida, etiqueta perdida) sai da
    // fila: não faz sentido gravar uma etiqueta nova para uma peça que não vai
    // virar bolsa. A regra vem de `naFila`, em lotes.js, e NÃO é reescrita
    // aqui: esta linha já foi uma cópia à mão da mesma regra, e cópia é o que
    // fica para trás no dia em que a regra muda.
    .filter((p) => naFila(p) && !p.gravada_em)
    .sort((a, b) => (a.numero_na_serie || 0) - (b.numero_na_serie || 0))
    .map((p) => enderecoDaTag(p.codigo))
    .join('\n')
}

// O RETORNO DO GRAVADOR VEM EM QUALQUER FORMATO, pela mesma razão: pode ser CSV
// com vírgula, com ponto-e-vírgula, ou um log solto. Então não se lê o formato:
// procura-se por padrão e confere-se contra o lote. Só entra o que É do lote,
// então lixo no texto não vira marcação errada.
export function codigosNoTextoDoGravador(texto, pecasDoLote) {
  const bruto = String(texto ?? '')
  const doLote = new Set(
    (Array.isArray(pecasDoLote) ? pecasDoLote : [])
      .map((p) => String(p.codigo ?? '').trim().toUpperCase())
      .filter(Boolean),
  )
  const reconhecidos = new Set()
  for (const achado of bruto.toUpperCase().matchAll(/[A-Z0-9]{6,32}/g)) {
    if (doLote.has(achado[0])) reconhecidos.add(achado[0])
  }
  // Código com cara de selo que NÃO é deste lote merece aviso: normalmente é o
  // arquivo do lote errado, e marcar em silêncio esconderia isso. A flag `i`
  // está aqui porque sem ela um endereço em MAIÚSCULAS fazia o aviso sumir, e
  // aviso que some é pior que aviso que não existe.
  const ignorados = new Set()
  for (const achado of bruto.matchAll(/\/verify\/([A-Za-z0-9]{6,32})/gi)) {
    const codigo = achado[1].toUpperCase()
    if (!doLote.has(codigo)) ignorados.add(codigo)
  }
  return { reconhecidos: [...reconhecidos], ignorados: [...ignorados] }
}
