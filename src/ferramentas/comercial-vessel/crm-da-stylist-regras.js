/* AS REGRAS DO CRM DA STYLIST — o quadro por etapas, a tela "Etapas do funil"
 * e o histórico de contatos.
 *
 * ⚠️ DESDE 24/09/2026 O FUNIL É CONFIGURÁVEL (decisão do dono): as etapas são
 * linhas de `vessel_stylist_etapas`, lidas por `vessel_stylist_etapas()`, cada
 * uma com { id, nome, ordem, tipo: 'funil' | 'saida', conta_como_prospectada,
 * libera_private_edit, stylists, motivos: [{ id, nome, ordem, ativo, exige_nota,
 * stylists }], stylists_sem_motivo } (os dois últimos desde 24/09/2026). NADA MUDA DE ETAPA SOZINHO: nem encontro, nem contato. Quem muda
 * é a pessoa, na ficha ou no quadro (`vessel_stylist_mover_de_etapa`).
 *
 * ⚠️ AS LISTAS DE CANAL E RESULTADO SÃO ESPELHO DOS CHECK DE
 * `vessel_stylist_contatos`. O teste lê a migration: se um lado mudar sozinho,
 * a suíte reprova.
 */
import { posicaoDaFaixa } from './qualificacao-regras.js'

export const CANAIS = {
  whatsapp: 'WhatsApp', ligacao: 'Ligação', instagram: 'Instagram', email: 'E-mail', presencial: 'Presencial',
}
export const RESULTADOS = {
  sem_resposta: 'Sem resposta', conversou: 'Conversou', interesse: 'Demonstrou interesse',
  proposta: 'Pediu proposta', marcou_encontro: 'Marcou encontro', recusou: 'Recusou',
}

// ── as etapas ───────────────────────────────────────────────────────────────
const porOrdem = (a, b) => (a.ordem - b.ordem) || (a.id - b.id)

/** As etapas de funil, na ordem. */
export function etapasDoFunil(etapas) {
  return (Array.isArray(etapas) ? etapas : []).filter((e) => e?.tipo === 'funil').sort(porOrdem)
}

/** As saídas, na ordem. */
export function etapasDeSaida(etapas) {
  return (Array.isArray(etapas) ? etapas : []).filter((e) => e?.tipo === 'saida').sort(porOrdem)
}

/** A próxima etapa de FUNIL depois da atual, pela ordem — ou nula (última, ou
 * a atual é uma saída: de saída não se "avança", se escolhe). */
export function proximaEtapa(etapas, etapaId) {
  const todas = (Array.isArray(etapas) ? etapas : []).slice().sort(porOrdem)
  const atual = todas.find((e) => e.id === etapaId)
  if (!atual || atual.tipo !== 'funil') return null
  return todas.find((e) => e.tipo === 'funil' && porOrdem(e, atual) > 0) || null
}

/** A primeira etapa de funil: onde entra quem é cadastrada. */
export function primeiraEtapa(etapas) {
  return etapasDoFunil(etapas)[0] || null
}

/** O mapa { "id": nome } que o filtro "Etapa" da barra usa (o valor do
 * `<select>` é texto, por isso a chave também). Funil primeiro, saídas depois. */
export function etapasParaFiltrar(etapas) {
  return Object.fromEntries([...etapasDoFunil(etapas), ...etapasDeSaida(etapas)].map((e) => [String(e.id), e.nome]))
}

export function prazoAtrasado(prazo, hoje) {
  return !!prazo && String(prazo).slice(0, 10) < String(hoje).slice(0, 10)
}

/**
 * O quadro: uma coluna por etapa de FUNIL, na ordem, e depois UMA COLUNA POR
 * SAÍDA, no fim (24/09/2026: o dono arrasta a parceira para a Ativada ou para
 * o Desclassificado — cada saída precisa ser um alvo próprio). Devolve
 * [{ chave, titulo, etapa, saida, stylists }].
 * ⚠️ Uma stylist com etapa que a lista de etapas não conhece (a lista mudou
 * entre as duas leituras) cai na PRIMEIRA coluna, nunca some do quadro.
 * ⚠️ `ordem: 'faixa'` (scorecard, 24/09): dentro de cada coluna, A, B, C e sem
 * nota primeiro — e só depois o prazo. Sem ela, a ordem de sempre (atrasada,
 * prazo, nome). A nota NÃO muda a coluna de ninguém: só a ordem dentro dela.
 */
export function colunasDoQuadro(lista, etapas, hoje, ordem = null) {
  const colunas = [
    ...etapasDoFunil(etapas).map((e) => ({ chave: String(e.id), titulo: e.nome, etapa: e, saida: false, stylists: [] })),
    ...etapasDeSaida(etapas).map((e) => ({ chave: String(e.id), titulo: e.nome, etapa: e, saida: true, stylists: [] })),
  ]
  for (const s of Array.isArray(lista) ? lista : []) {
    const destino = colunas.find((c) => c.etapa.id === s?.etapa_id) || colunas[0]
    if (destino) destino.stylists.push(s)
  }
  const porPrazo = (a, b) => {
    const aa = prazoAtrasado(a.proxima_acao_em, hoje), bb = prazoAtrasado(b.proxima_acao_em, hoje)
    if (aa !== bb) return aa ? -1 : 1
    const pa = a.proxima_acao_em || '9999', pb = b.proxima_acao_em || '9999'
    if (pa !== pb) return pa < pb ? -1 : 1
    return String(a.nome || '').localeCompare(String(b.nome || ''), 'pt-BR')
  }
  const porFaixa = (a, b) => (posicaoDaFaixa(a.faixa) - posicaoDaFaixa(b.faixa)) || porPrazo(a, b)
  for (const c of colunas) c.stylists.sort(ordem === 'faixa' ? porFaixa : porPrazo)
  return colunas
}

/** Soltar um cartão numa coluna: a etapa de destino, ou nulo quando é a mesma
 * em que ela já está (soltar no mesmo lugar não faz nada). */
export function destinoDoSoltar(etapaAtualId, coluna) {
  const id = coluna?.etapa?.id
  if (id == null || id === etapaAtualId) return null
  return id
}

// ── Private Edit só com stylist liberada (24/09/2026) ─────────────────────
/** As etapas que liberam Private Edit, na ordem (os nomes de hoje). */
export function etapasQueLiberam(etapas) {
  return [...etapasDoFunil(etapas), ...etapasDeSaida(etapas)].filter((e) => e.libera_private_edit)
}

/** "Ativada", "Ativada e Recorrente", "Ativada, Recorrente e VIP". */
export function nomesEmLista(nomes) {
  const l = (nomes || []).filter(Boolean)
  if (l.length <= 1) return l[0] || ''
  return `${l.slice(0, -1).join(', ')} e ${l.at(-1)}`
}

/** A linha da ficha: ela pode ser anfitriã de um Private Edit novo? */
export function privateEditDaStylist(stylist, etapas) {
  const liberam = etapasQueLiberam(etapas)
  const aqui = liberam.some((e) => e.id === stylist?.etapa_id) || stylist?.etapa_libera_private_edit === true
  if (aqui) return { pode: true, texto: 'Pode marcar Private Edit' }
  if (!liberam.length) {
    return { pode: false, texto: 'Nenhuma etapa libera Private Edit hoje — marque uma em "Etapas do funil".' }
  }
  return { pode: false, texto: `Private Edit liberado ao chegar em: ${nomesEmLista(liberam.map((e) => e.nome))}` }
}

/** O aviso curto depois de mover para uma etapa que libera Private Edit. */
export function avisoDeLiberada(nome, etapa) {
  const quem = String(nome || '').trim() || 'A parceira'
  const onde = /^ativad/i.test(String(etapa?.nome || '')) ? `${quem} ativada` : `${quem} em ${etapa?.nome || 'uma etapa que libera'}`
  return `${onde} — já aparece em Marcar um encontro do Private Edit.`
}

// ── os motivos das saídas (24/09/2026) ─────────────────────────────────────
/** Os motivos ATIVOS de uma etapa, na ordem. */
export function motivosAtivos(etapa) {
  return (Array.isArray(etapa?.motivos) ? etapa.motivos : []).filter((m) => m.ativo !== false)
    .sort((a, b) => (a.ordem - b.ordem) || (a.id - b.id))
}

/** Chegar nesta etapa pede um motivo? Só saída com motivo ativo. */
export function pedeMotivo(etapa) {
  return etapa?.tipo === 'saida' && motivosAtivos(etapa).length > 0
}

/** O que falta na escolha do motivo, antes de ir ao banco (ele confere de novo). */
export function problemasDoMotivo(escolha, etapa) {
  if (!pedeMotivo(etapa)) return []
  const m = motivosAtivos(etapa).find((x) => String(x.id) === String(escolha?.motivoId ?? ''))
  if (!m) return ['Escolha o motivo.']
  const nota = String(escolha?.nota ?? '').trim()
  if (nota.length > 500) return ['A nota passou de 500 letras. Encurte um pouco.']
  if (m.exige_nota && !nota) return [`"${m.nome}" pede uma nota: escreva o motivo em poucas palavras.`]
  return []
}

/** O botão que confirma a saída: "Desclassificar" no Desclassificado. */
export function rotuloDeConfirmarSaida(etapa) {
  return /^desclassificad/i.test(String(etapa?.nome || '')) ? 'Desclassificar' : `Mover para ${etapa?.nome || 'a saída'}`
}

/** "Desclassificado · Não conecta com a marca" (sem motivo, só a etapa). */
export function etapaComMotivo(s) {
  const etapa = s?.etapa || 'Sem etapa'
  return s?.etapa_tipo === 'saida' && s?.saida_motivo ? `${etapa} · ${s.saida_motivo}` : etapa
}

/**
 * O bloco "Saídas por motivo" do placar: quem está HOJE em cada saída, por
 * motivo, com os zeros escondidos. Saída vazia não aparece; nenhuma saída
 * com gente, lista vazia (e o bloco some).
 */
export function saidasPorMotivo(etapas) {
  return etapasDeSaida(etapas)
    .filter((e) => Number(e.stylists) > 0)
    .map((e) => {
      const linhas = (Array.isArray(e.motivos) ? e.motivos : [])
        .filter((m) => Number(m.stylists) > 0)
        .sort((a, b) => (Number(b.stylists) - Number(a.stylists)) || (a.ordem - b.ordem))
        .map((m) => ({ nome: m.ativo === false ? `${m.nome} (fora de uso)` : m.nome, n: Number(m.stylists) }))
      const semMotivo = Number(e.stylists_sem_motivo) || 0
      // Saída sem lista de motivos (a Ativada) não tem "sem motivo": só o total.
      if (semMotivo > 0 && (e.motivos || []).length) linhas.push({ nome: 'Sem motivo registrado', n: semMotivo })
      return { etapa: e.nome, total: Number(e.stylists), linhas }
    })
}

/** O que está errado no nome de um motivo, antes de ir ao banco. */
export function problemasDoNomeDoMotivo(nome) {
  const t = String(nome ?? '').trim()
  if (!t) return ['Escreva o motivo.']
  if (t.length > 80) return ['O motivo passa de 80 letras. Encurte um pouco.']
  return []
}

/** O que está errado no nome de uma etapa, antes de ir ao banco (o banco
 * confere de novo: nome repetido é dele). */
export function problemasDaEtapa(nome) {
  const t = String(nome ?? '').trim()
  if (!t) return ['Escreva o nome da etapa.']
  if (t.length > 60) return ['O nome da etapa passa de 60 letras. Encurte um pouco.']
  return []
}

/** A frase de cada recusa das funções das etapas e de mover a stylist. */
export function mensagemDasEtapas(situacao) {
  switch (situacao) {
    case 'ok': case 'sem_mudanca': return ''
    case 'sem_permissao': return 'Você não tem a permissão de editar o Stylist Circle para mexer nas etapas.'
    case 'sem_nome': return 'Escreva o nome da etapa.'
    case 'nome_longo': return 'O nome da etapa passa de 60 letras. Encurte um pouco.'
    case 'nome_repetido': return 'Já existe uma etapa com este nome.'
    case 'tipo_invalido': return 'Escolha se a etapa é do funil ou uma saída.'
    case 'nao_achei': return 'Não achei mais esta etapa — a lista pode ter mudado. Recarregue e tente de novo.'
    case 'no_limite': return 'Ela já está na ponta da lista.'
    case 'ultima_do_funil': return 'O funil precisa de pelo menos uma etapa. Esta é a última.'
    case 'etapa_marcada':
      return 'Esta é a etapa que conta como prospectada. Marque outra antes de excluí-la ou de torná-la saída.'
    case 'saida_nao_conta': return 'Uma saída não pode contar como prospectada. Escolha uma etapa do funil.'
    case 'precisa_destino': return 'Há parceiras nesta etapa. Escolha para onde elas vão antes de excluir.'
    case 'destino_invalido': return 'Escolha outra etapa como destino.'
    case 'etapa_invalida': return 'Esta etapa não existe mais. Recarregue e escolha de novo.'
    case 'direcao_invalida': return 'Não consegui mover agora. Tente de novo em um instante.'
    // 24/09/2026: os motivos das saídas e a marca de Private Edit.
    case 'motivo_obrigatorio': return 'Esta saída pede um motivo. Escolha o motivo antes de mover.'
    case 'motivo_invalido': return 'Este motivo não vale mais para esta saída — a lista pode ter mudado. Recarregue e escolha de novo.'
    case 'nota_obrigatoria': return 'Este motivo pede uma nota: escreva em poucas palavras.'
    case 'nota_longa': return 'A nota passou de 500 letras. Encurte um pouco.'
    case 'motivo_longo': return 'O motivo passa de 80 letras. Encurte um pouco.'
    case 'so_saida': return 'Motivo só existe em etapa de saída.'
    case 'sem_escolha': return 'Não consegui gravar agora. Tente de novo em um instante.'
    default: return 'Não consegui gravar agora. Tente de novo em um instante.'
  }
}

/** O porquê de uma linha do histórico de etapas, em palavras. */
export function motivoDoHistorico(motivo) {
  return { cadastro: 'Cadastro', mudanca: 'Mudou de etapa', etapa_excluida: 'A etapa foi excluída' }[motivo] || motivo || ''
}

// ── o contato fácil (pedido do dono, 24/09/2026) ───────────────────────────
/**
 * O link de WhatsApp da parceira: `https://wa.me/<55 + DDD + número>`, SEM
 * mensagem pronta. Aceita o canônico do banco ou o número digitado (10/11
 * dígitos ganham o 55, como `vessel_telefone_canonico`). Número que não dá
 * para usar → nulo, e a tela não mostra botão (um link quebrado é pior que
 * nenhum).
 */
export function linkDoWhatsAppDaStylist(whatsapp) {
  let d = String(whatsapp ?? '').replace(/\D/g, '')
  if (d.length === 10 || d.length === 11) d = `55${d}`
  return /^55\d{10,11}$/.test(d) ? `https://wa.me/${d}` : null
}

/** O perfil do Instagram, limpo: sem @, sem endereço, sem barra final. Nulo
 * quando o texto não é um perfil (ex.: "Não localizado"). */
export function perfilDoInstagram(instagram) {
  const h = String(instagram ?? '').trim()
    .replace(/^(https?:\/\/)?(www\.)?instagram\.com\//i, '').replace(/[/?#].*$/, '').replace(/^@/, '')
  return /^[A-Za-z0-9._]{1,30}$/.test(h) ? h : null
}

/**
 * O que o botão de contato fácil oferece: `principal` (WhatsApp se houver,
 * senão Instagram) e `secundario` (o Instagram, quando há os dois). Nenhum
 * dos dois → os dois nulos, e não aparece botão.
 * ⚠️ TOCAR NO BOTÃO NÃO REGISTRA CONTATO: o registro continua manual.
 */
export function contatoFacil(s) {
  const nome = String(s?.nome || '').trim() || 'a parceira'
  const zap = linkDoWhatsAppDaStylist(s?.whatsapp)
  const perfil = perfilDoInstagram(s?.instagram)
  const insta = perfil ? { canal: 'instagram', rotulo: 'Instagram', href: `https://instagram.com/${perfil}`,
    aria: `Abrir o Instagram de ${nome}` } : null
  const whats = zap ? { canal: 'whatsapp', rotulo: 'WhatsApp', href: zap, aria: `Chamar ${nome} no WhatsApp` } : null
  return { principal: whats || insta, secundario: whats ? insta : null }
}

const diaLocal = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate())
export function ultimoContatoEscrito(iso, agora = new Date()) {
  if (!iso) return 'nenhum contato registrado'
  const dias = Math.round((diaLocal(agora) - diaLocal(new Date(iso))) / 86400000)
  if (dias <= 0) return 'último contato hoje'
  if (dias === 1) return 'último contato ontem'
  return `último contato há ${dias} dias`
}
