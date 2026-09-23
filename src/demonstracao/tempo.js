/* O RELÓGIO DA DEMONSTRAÇÃO — dias e instantes no fuso de São Paulo.
 *
 * ⚠️ O BANCO DE VERDADE CONTA "O DIA" EM `America/Sao_Paulo` (`at time zone
 * 'America/Sao_Paulo'` em toda migration da Vessel). O banco de mentira faz a
 * mesma conta, senão um encontro das 21h30 cairia no dia seguinte e o código
 * PE-AAAAMMDD sairia diferente do real. São Paulo não tem horário de verão
 * desde 2019: -03:00 fixo. */
const FUSO = 'America/Sao_Paulo'
const DIA = new Intl.DateTimeFormat('en-CA', { timeZone: FUSO, year: 'numeric', month: '2-digit', day: '2-digit' })

/** 'AAAA-MM-DD' do dia em São Paulo de um instante (Date ou ISO). */
export function diaEmSaoPaulo(instante) {
  const d = instante instanceof Date ? instante : new Date(instante)
  if (Number.isNaN(d.getTime())) return null
  return DIA.format(d)
}

/** Soma dias a um 'AAAA-MM-DD' (conta de calendário, sem fuso). */
export function somarDias(dia, n) {
  const [a, m, d] = String(dia).slice(0, 10).split('-').map(Number)
  return new Date(Date.UTC(a, m - 1, d + n)).toISOString().slice(0, 10)
}

/** Diferença em dias entre dois 'AAAA-MM-DD' (b - a). */
export function diasEntre(a, b) {
  const ms = (x) => { const [y, m, d] = String(x).slice(0, 10).split('-').map(Number); return Date.UTC(y, m - 1, d) }
  return Math.round((ms(b) - ms(a)) / 86400000)
}

/** O instante ISO de um dia 'AAAA-MM-DD' às 'HH:MM' de São Paulo. */
export function instanteEmSaoPaulo(dia, hora = '12:00') {
  return new Date(`${dia}T${hora}:00-03:00`).toISOString()
}
