/* O CONVITE DA CONVIDADA — o link só dela, a mensagem e os textos do PNG.
 *
 * ⚠️ AS DUAS MENSAGENS SÃO TEXTO APROVADO PELO DONO (22/09/2026) e têm teste
 * palavra por palavra. Mudar uma vírgula aqui é mudar o texto que vai para a
 * cliente — e o módulo 12 do plano pede a aprovação do Breno antes do uso.
 *
 * ⚠️ DATA E HORA NO FUSO DE SÃO PAULO, sempre com `timeZone`: `new Date()`
 * sozinho lê em UTC e um encontro das 21h30 viraria o dia seguinte. */
const RAIZ = 'https://vesselbrasil.com.br/pe'
const FORMATO_DA_CHAVE = /^[ABCDEFGHJKMNPQRSTVWXYZ23456789]{8}$/
const FUSO = 'America/Sao_Paulo'

export function primeiroNome(nome) {
  return String(nome || '').trim().split(/\s+/)[0] || ''
}

export function linkDaConvidada(chaveEncontro, chaveConvidada) {
  const a = String(chaveEncontro || '').toUpperCase()
  const b = String(chaveConvidada || '').toUpperCase()
  return FORMATO_DA_CHAVE.test(a) && FORMATO_DA_CHAVE.test(b) ? `${RAIZ}/${a}/${b}` : ''
}

export function dataPorExtenso(iso) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const semana = d.toLocaleDateString('pt-BR', { timeZone: FUSO, weekday: 'long' })
  const dia = d.toLocaleDateString('pt-BR', { timeZone: FUSO, day: 'numeric' })
  const mes = d.toLocaleDateString('pt-BR', { timeZone: FUSO, month: 'long' })
  return `${semana}, ${dia} de ${mes}`
}

export function horarioCurto(iso) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const [h, m] = d.toLocaleTimeString('pt-BR', { timeZone: FUSO, hour: '2-digit', minute: '2-digit', hour12: false }).split(':')
  return m === '00' ? `${Number(h)}h` : `${Number(h)}h${m}`
}

function ondeEQuando(quando, local) {
  const partes = [`Será em ${dataPorExtenso(quando)}`, `às ${horarioCurto(quando)}`]
  if (local) partes.push(`em ${local}`)
  return partes.join(', ')
}

export function mensagemDoConvite({ quem, convidada, stylist, quando, local, link }) {
  const nome = primeiroNome(convidada)
  if (quem === 'stylist') {
    return `${nome}, estou preparando uma VESSEL Private Edit para um pequeno grupo de clientes. `
      + 'Vou apresentar uma seleção de bolsas sob o meu olhar, com a equipe da VESSEL à disposição. '
      + `${ondeEQuando(quando, local)}. Gostaria muito de ter você comigo. Confirme sua presença por aqui: ${link}`
  }
  const anfitria = primeiroNome(stylist)
  return `${nome}, a ${anfitria} está preparando uma VESSEL Private Edit para um pequeno grupo de clientes `
    + `e gostaria muito de ter você com ela. ${ondeEQuando(quando, local)}, com uma seleção de bolsas preparada `
    + `pela ${anfitria} e a equipe da VESSEL à disposição. Confirme sua presença por aqui: ${link}`
}

export function linkDoWhatsApp(telefone, texto) {
  const d = String(telefone || '').replace(/\D/g, '')
  if (!/^55\d{10,11}$/.test(d)) return ''
  return `https://wa.me/${d}?text=${encodeURIComponent(texto || '')}`
}

const semAcento = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
export function nomeDoArquivo(convidada, quando) {
  const nome = semAcento(primeiroNome(convidada)).toLowerCase().replace(/[^a-z0-9]+/g, '') || 'convidada'
  const d = new Date(quando)
  const dia = Number.isNaN(d.getTime()) ? 'sem-data'
    : d.toLocaleDateString('en-CA', { timeZone: FUSO })
  return `private-edit_${nome}_${dia}.png`
}

// ── o desenho (1080×1350, a mesma régua do Appointment Card) ──
export const REGULAR = 'VesselVersatile'
export const LEVE = 'VesselVersatileLight'
export const MANUSCRITA = 'VesselAngeletta'
export const LINHAS_DO_CONVITE = [
  { campo: 'titulo',  fonte: REGULAR,    tamanho: 37.8,  base: 137.8, largura: 360 },
  { campo: 'hosted',  fonte: LEVE,       tamanho: 32.4,  base: 190.0, larguraMaxima: 860, tamanhoMinimo: 22 },
  { campo: 'nome',    fonte: MANUSCRITA, tamanho: 118.8, base: 380.0, tracking: 10.9, larguraMaxima: 800, tamanhoMinimo: 56 },
  { campo: 'quando',  fonte: REGULAR,    tamanho: 43.2,  base: 500.0, tracking: 4.0, larguraMaxima: 860, tamanhoMinimo: 28 },
  { campo: 'horario', fonte: REGULAR,    tamanho: 43.2,  base: 560.0, tracking: 4.0 },
  { campo: 'marca',   fonte: REGULAR,    tamanho: 37.8,  base: 690.0, largura: 153 },
  { campo: 'local',   fonte: LEVE,       tamanho: 37.8,  base: 735.0, larguraMaxima: 860, tamanhoMinimo: 22 },
  { campo: 'frase',   fonte: LEVE,       tamanho: 32.4,  base: 860.0 },
]
export const DIVISORIAS_DO_CONVITE = [{ meio: 625, largura: 120, espessura: 2.7 }]

export function textosDoCartao({ convidada, stylist, quando, local }) {
  return {
    titulo: 'PRIVATE EDIT',
    hosted: `Hosted by ${String(stylist || '').trim()}`,
    nome: String(convidada || '').trim().replace(/\s+/g, ' '),
    quando: dataPorExtenso(quando).toUpperCase(),
    horario: horarioCurto(quando).toUpperCase(),
    marca: 'VESSEL',
    local: String(local || '').trim(),
    frase: 'Será um prazer receber você.',
  }
}
