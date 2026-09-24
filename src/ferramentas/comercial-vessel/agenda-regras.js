/* AS REGRAS DA AGENDA DO PRIVATE EDIT — o calendário das lojas e o aviso de
 * encontro sobreposto (pedido do dono, 24/09/2026: "uma visão de
 * agenda/calendário, para bater agenda, cruzar edits, e ver se não tem nenhum
 * sobrepondo").
 *
 * ⚠️ O DIA VEM DO BANCO, NUNCA DO RELÓGIO DO NAVEGADOR. Cada item de
 * `vessel_agenda_das_lojas` já chega com `dia` ('AAAA-MM-DD') e `hora`
 * ('HH:MM') no fuso de São Paulo. Aqui ninguém tira o dia do `inicio` pelo
 * relógio (o "get Date" do navegador): um encontro às 22h de Campinas é 01h UTC do dia seguinte, e a
 * conta pelo relógio de quem abre (ou pelo UTC) jogaria o encontro no dia
 * errado da grade — o erro que já custou caro na tela das redes (ver a memória
 * "o painel desloca um dia"). As contas de calendário daqui são de CALENDÁRIO
 * (`Date.UTC` só para somar dias), e o "hoje" é o de São Paulo.
 *
 * ⚠️ A FORMA DA RESPOSTA: todo item, de qualquer tipo, tem as MESMAS chaves
 * (`CHAVES_DO_ITEM`), nulas quando não se aplicam — o aplicador da migration
 * confere isso no banco de verdade, e o banco de mentira devolve a mesma.
 */

/** ⚠️ A DURAÇÃO DO ENCONTRO — o único lugar da tela. O do banco é
 * `vessel_private_edit_duracao()`; um teste confere que os dois dizem 4. */
export const DURACAO_DO_PRIVATE_EDIT_EM_HORAS = 4

export const TIPOS = {
  private_edit: { rotulo: 'Private Edit', classe: 'ag-pe' },
  beauty_session: { rotulo: 'Beauty Session', classe: 'ag-bs' },
  private_appointment: { rotulo: 'Private Appointment', classe: 'ag-pa' },
}

export const CHAVES_DO_ITEM = ['tipo', 'id', 'codigo', 'dia', 'hora', 'hora_fim', 'inicio', 'fim', 'loja', 'praca', 'local',
  'lugar', 'stylist', 'anfitria', 'parceiro', 'client_advisor', 'status', 'sobrepoe']

export const LOJAS = { iguatemi: 'Iguatemi', tivoli: 'Tivoli', parkshopping: 'ParkShopping' }
export const PRACAS = { CPS: 'Campinas', SAO: 'São Paulo', SBO: 'Santa Bárbara', BSB: 'Brasília' }
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro',
  'outubro', 'novembro', 'dezembro']
export const DIAS_DA_SEMANA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']
const DIAS_POR_EXTENSO = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado']

const DIA_EM_SP = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' })

// ── o calendário (contas de calendário, sem fuso) ────────────────────────────
const partes = (dia) => String(dia).slice(0, 10).split('-').map(Number)
const doUTC = (d) => d.toISOString().slice(0, 10)

/** 'AAAA-MM-DD' de hoje em São Paulo (ou do instante dado). */
export function hojeEmSaoPaulo(agora = new Date()) {
  return DIA_EM_SP.format(agora instanceof Date ? agora : new Date(agora))
}

export function somarDias(dia, n) {
  const [a, m, d] = partes(dia)
  return doUTC(new Date(Date.UTC(a, m - 1, d + n)))
}

/** 0 = domingo … 6 = sábado, de um 'AAAA-MM-DD' (dia do calendário, sem fuso). */
export function diaDaSemana(dia) {
  const [a, m, d] = partes(dia)
  return new Date(Date.UTC(a, m - 1, d)).getUTCDay()
}

/** { ano, mes } (mes de 1 a 12) do dia dado. */
export function mesDoDia(dia) {
  const [ano, mes] = partes(dia)
  return { ano, mes }
}

export function outroMes({ ano, mes }, n) {
  const d = new Date(Date.UTC(ano, mes - 1 + n, 1))
  return { ano: d.getUTCFullYear(), mes: d.getUTCMonth() + 1 }
}

/** "Setembro de 2026" — só a primeira letra maiúscula (o "de" fica minúsculo). */
export function nomeDoMes({ ano, mes }) {
  const m = MESES[mes - 1]
  return `${m[0].toUpperCase()}${m.slice(1)} de ${ano}`
}

/** "sexta, 25 de setembro" — para o cabeçalho de cada dia na lista do celular. */
export function diaPorExtenso(dia) {
  const [, m, d] = partes(dia)
  return `${DIAS_POR_EXTENSO[diaDaSemana(dia)]}, ${d} de ${MESES[m - 1]}`
}

/**
 * As semanas da grade do mês: cada semana é uma lista de 7 dias (domingo a
 * sábado), com os dias de fora do mês nas bordas. Sempre semanas inteiras.
 */
export function gradeDoMes({ ano, mes }) {
  const primeiro = `${ano}-${String(mes).padStart(2, '0')}-01`
  const inicio = somarDias(primeiro, -diaDaSemana(primeiro))
  const ultimo = somarDias(doUTC(new Date(Date.UTC(ano, mes, 1))), -1)
  const fim = somarDias(ultimo, 6 - diaDaSemana(ultimo))
  const semanas = []
  for (let d = inicio; d <= fim; d = somarDias(d, 7)) {
    semanas.push(Array.from({ length: 7 }, (_, i) => somarDias(d, i)))
  }
  return semanas
}

/** O primeiro e o último dia do mês. */
export function limitesDoMes({ ano, mes }) {
  const de = `${ano}-${String(mes).padStart(2, '0')}-01`
  return { de, ate: somarDias(doUTC(new Date(Date.UTC(ano, mes, 1))), -1) }
}

/**
 * O que a tela pede ao banco: a grade inteira do mês (com as bordas) e, no mês
 * de HOJE, também os próximos 30 dias — a lista do celular começa hoje e vai
 * 30 dias à frente, mesmo quando isso passa do fim da grade.
 */
export function periodoParaPedir(mes, hoje) {
  const semanas = gradeDoMes(mes)
  let de = semanas[0][0], ate = semanas.at(-1)[6]
  if (ehMesDeHoje(mes, hoje)) {
    if (hoje < de) de = hoje
    const mais30 = somarDias(hoje, 30)
    if (mais30 > ate) ate = mais30
  }
  return { de, ate }
}

export function ehMesDeHoje(mes, hoje) {
  const h = mesDoDia(hoje)
  return h.ano === mes.ano && h.mes === mes.mes
}

/**
 * Os dias que a LISTA do celular mostra: no mês de hoje, de hoje a 30 dias à
 * frente; nos outros meses, o mês inteiro. Só os dias que têm alguma coisa.
 */
export function diasDaLista(itensPorDia, mes, hoje) {
  const { de, ate } = ehMesDeHoje(mes, hoje) ? { de: hoje, ate: somarDias(hoje, 30) } : limitesDoMes(mes)
  return [...itensPorDia.keys()].filter((d) => d >= de && d <= ate).sort()
}

export function rotuloDaJanelaDaLista(mes, hoje) {
  if (ehMesDeHoje(mes, hoje)) return `De hoje a ${diaPorExtenso(somarDias(hoje, 30)).split(', ')[1]}`
  return `Todo o mês de ${nomeDoMes(mes).toLowerCase()}`
}

// ── os itens ─────────────────────────────────────────────────────────────────
const ORDEM_DO_TIPO = { beauty_session: 0, private_edit: 1, private_appointment: 2 }

/** Dia → itens daquele dia, em ordem: o dia inteiro primeiro, depois pela hora. */
export function agruparPorDia(itens) {
  const mapa = new Map()
  for (const i of Array.isArray(itens) ? itens : []) {
    if (!i?.dia) continue
    if (!mapa.has(i.dia)) mapa.set(i.dia, [])
    mapa.get(i.dia).push(i)
  }
  for (const lista of mapa.values()) {
    lista.sort((a, b) => (a.hora || '').localeCompare(b.hora || '')
      || (ORDEM_DO_TIPO[a.tipo] ?? 9) - (ORDEM_DO_TIPO[b.tipo] ?? 9)
      || String(a.codigo || a.id).localeCompare(String(b.codigo || b.id)))
  }
  return mapa
}

/** A chave do filtro "Loja" de um item: a loja; sem loja, o lugar do banco. */
export const chaveDoLugar = (i) => i?.loja || i?.lugar || ''

/** O nome do lugar para gente ler. */
export function nomeDoLugar(i) {
  if (!i) return ''
  if (i.loja) return LOJAS[i.loja] || i.loja
  const praca = PRACAS[i.praca] || i.praca || ''
  return [praca, i.local].filter(Boolean).join(' · ') || 'Sem lugar'
}

/** As opções do filtro "Loja", tiradas do que veio (nenhuma lista cravada). */
export function lugaresDaAgenda(itens) {
  const vistos = new Map()
  for (const i of Array.isArray(itens) ? itens : []) {
    const chave = chaveDoLugar(i)
    if (chave && !vistos.has(chave)) vistos.set(chave, nomeDoLugar(i))
  }
  return [...vistos].map(([chave, rotulo]) => ({ chave, rotulo }))
    .sort((a, b) => a.rotulo.localeCompare(b.rotulo, 'pt-BR'))
}

export const FILTRO_DA_AGENDA = Object.freeze({ lugar: '', soPrivateEdit: false })

export function filtrarAgenda(itens, filtro = FILTRO_DA_AGENDA) {
  return (Array.isArray(itens) ? itens : []).filter((i) =>
    (!filtro.soPrivateEdit || i.tipo === 'private_edit')
    && (!filtro.lugar || chaveDoLugar(i) === filtro.lugar))
}

export const sobrepoe = (i) => i?.tipo === 'private_edit' && Array.isArray(i.sobrepoe) && i.sobrepoe.length > 0

export function diaTemSobreposicao(lista) {
  return (lista || []).some(sobrepoe)
}

/** A linha do chip: "19:00 · Marina Castro · Iguatemi". */
export function linhaDoItem(i) {
  if (!i) return ''
  const quem = i.tipo === 'private_edit' ? (i.anfitria || i.stylist || i.codigo)
    : i.tipo === 'beauty_session' ? `Beauty Session${i.parceiro ? ` — ${i.parceiro}` : ''}`
      : `Private Appointment${i.client_advisor ? ` — ${i.client_advisor}` : ''}`
  return [i.hora || 'o dia todo', quem, nomeDoLugar(i)].filter(Boolean).join(' · ')
}

/** "19:00–23:00" do encontro; a visita só tem o começo; a sessão é o dia todo. */
export function horarioDoItem(i) {
  if (!i) return ''
  if (i.tipo === 'beauty_session' || !i.hora) return 'O dia todo'
  return i.hora_fim ? `${i.hora}–${i.hora_fim}` : i.hora
}

const STATUS_LEGIVEL = {
  em_planejamento: 'Em planejamento', agendado: 'Agendado', confirmado: 'Confirmado', realizado: 'Realizado',
  reagendado: 'Reagendado', solicitado: 'Solicitado', no_show: 'Não veio', aberta: 'Aberta', encerrada: 'Encerrada',
}
export const statusLegivel = (s) => STATUS_LEGIVEL[s] || s || ''

/** As linhas do quadrinho de leitura (Beauty Session e Private Appointment). */
export function detalhesDoItem(i) {
  if (!i) return []
  const l = [['Quando', `${dataCurta(i.dia)} · ${horarioDoItem(i)}`], ['Loja', nomeDoLugar(i)]]
  if (i.tipo === 'beauty_session') {
    l.push(['Parceiro', i.parceiro || 'Ainda sem o nome confirmado'])
    if (i.codigo) l.push(['Código', i.codigo])
  }
  if (i.tipo === 'private_appointment') {
    l.push(['Client Advisor', i.client_advisor || 'Ainda sem Client Advisor'])
  }
  if (i.status) l.push(['Situação', statusLegivel(i.status)])
  return l
}

export function dataCurta(dia) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(dia || ''))
  return m ? `${m[3]}/${m[2]}/${m[1]}` : ''
}

// ── o aviso antes de gravar ──────────────────────────────────────────────────
/** A linha de cada encontro que cruza: código, anfitriã, loja e o horário. */
export function linhaDoConflito(o) {
  if (!o) return ''
  const quem = o.anfitria || o.stylist || ''
  return [o.codigo, quem, nomeDoLugar(o), `${dataCurta(o.dia)} ${o.hora}–${o.hora_fim}`].filter(Boolean).join(' · ')
}

/** A nota do que mais ocupa a loja (NÃO é conflito). */
export function linhaDoContexto(c) {
  if (!c) return ''
  if (c.tipo === 'beauty_session') {
    return `Beauty Session${c.parceiro ? ` — ${c.parceiro}` : ''} no mesmo dia (${nomeDoLugar(c)})`
  }
  return `Private Appointment às ${c.hora}${c.client_advisor ? ` com ${c.client_advisor}` : ''} (${nomeDoLugar(c)})`
}

/**
 * O que a tela manda à pergunta `vessel_private_edit_sobreposicoes` ao EDITAR:
 * o que vai ficar gravado. ⚠️ A MESMA REGRA do banco: campo vazio no rascunho
 * é "não mexe" (`coalesce(p_x, x)`), então o valor que vale é o de hoje.
 */
export function valoresQueFicam(encontro, rascunho, quandoISO) {
  return {
    quando: quandoISO || encontro?.quando || null,
    loja: rascunho?.loja || encontro?.loja || null,
    praca: rascunho?.praca || encontro?.praca || null,
    local: rascunho?.local || encontro?.local || null,
  }
}

const lugarDe = ({ loja, praca, local }) => (loja ? String(loja).toLowerCase()
  : `praca:${String(praca || '').toUpperCase()}|${String(local || '').trim().replace(/\s+/g, ' ').toLowerCase()}`)

/** Mudou o dia/hora ou o lugar? Só então a edição confere (igual ao banco). */
export function mudouHoraOuLugar(encontro, ficam) {
  if (!encontro) return true
  if (+new Date(ficam.quando) !== +new Date(encontro.quando)) return true
  return lugarDe(ficam) !== lugarDe(encontro)
}

/** O que mostrar quando o banco devolve `sobrepoe` sem a pergunta antes (a corrida). */
export const MENSAGEM_DE_SOBREPOE = 'Já há Private Edit neste lugar neste horário. Confira e confirme para marcar mesmo assim.'
