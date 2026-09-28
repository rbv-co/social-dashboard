/* O BANCO DE MENTIRA DA DEMONSTRAÇÃO — as funções do Comercial Vessel,
 * respondidas dentro do navegador, sem rede nenhuma.
 *
 * ⚠️ AS REGRAS SÃO AS DO BANCO DE VERDADE, linha por linha. Cada função aqui é
 * a tradução de uma função de `db/migrations/2026-09-22-vessel-t11-bases-do-
 * stylist-circle.sql` (e das irmãs de 19/09 que ela não reescreveu), com o
 * funil configurável de `2026-09-24-vessel-stylist-funil-configuravel.sql`
 * por cima (etapas, histórico de etapas, nenhum movimento automático): a mesma
 * ordem de conferência, a mesma `situacao` na recusa, o mesmo formato de
 * resposta. Uma demonstração que aceitasse o que o banco recusa ensinaria a
 * Ionara um sistema que não existe.
 *
 *
 * O que NÃO se traduziu, de propósito:
 *   · as travas de permissão (`is_vessel_atendimentos*`): na demonstração quem
 *     entra tem ver e editar, sempre — é o perfil de mentira;
 *   · `teste`: nenhuma linha de exemplo é de teste, e a Central manda
 *     `p_teste: false`.
 *
 * Estado em memória: recarregar a página volta ao começo. Nada daqui é puro
 * de navegador — o teste roda no Node —, e o aviso ao roteiro sai por
 * `aoAvisar`, que quem instala liga ao `postMessage`.
 */
import { dadosIniciais, USUARIO_DA_DEMONSTRACAO } from './dados-iniciais.js'
import { diaEmSaoPaulo, somarDias, diasEntre, horaEmSaoPaulo } from './tempo.js'
import { DURACAO_DO_PRIVATE_EDIT_EM_HORAS } from '../ferramentas/comercial-vessel/agenda-regras.js'
import { faixaDaNota } from '../ferramentas/comercial-vessel/qualificacao-regras.js'
import { emailCanonico } from '../ferramentas/beauty-sessions/cadastro-de-lead.js'
import { achatarCidade } from '../ferramentas/comercial-vessel/praca-regras.js'
import { eventoDeOrigem, funilDoEvento } from '../ferramentas/comercial-vessel/edicao-regras.js'

/** ⚠️ A MARCA QUE O BUILD DA CENTRAL NÃO PODE TER: o relatório da entrega
 * procura esta string em `dist/` (o build normal) — achá-la lá quer dizer que
 * o banco de mentira vazou para produção. */
export const MARCA_DO_BANCO_DE_MENTIRA = 'banco-de-mentira'

// ── as listas fechadas do banco (os CHECK da migration) ─────────────────────
// ⚠️ 25/09/2026 (praça e edição, Task 9): a praça DEIXOU de ser lista fechada
// — igual o banco de verdade, ela é cadastro (`b.pracas`), consultado por
// `pracaAtivaPorSigla`, logo abaixo do resto dos ajudantes.
const LOJAS = ['iguatemi', 'tivoli', 'parkshopping']
const ORIGENS = ['indicacao', 'pesquisa', 'evento', 'inbound']
const STATUS = ['em_planejamento', 'agendado', 'confirmado', 'realizado', 'reagendado', 'cancelado', 'nao_realizado']
const MARCADOS = ['agendado', 'confirmado', 'reagendado', 'realizado', 'nao_realizado', 'cancelado']
const CANAIS = ['whatsapp', 'ligacao', 'instagram', 'email', 'presencial']
const RESULTADOS = ['sem_resposta', 'conversou', 'interesse', 'proposta', 'marcou_encontro', 'recusou']
const MARCAS = ['enviado', 'sim', 'nao', 'sem_resposta']
const SITUACOES_DO_ATENDIMENTO = ['confirmado', 'realizado', 'no_show', 'remarcado', 'cancelado']
const ALFABETO = 'ABCDEFGHJKMNPQRSTVWXYZ23456789'

// ── os ajudantes do SQL ─────────────────────────────────────────────────────
/** `nullif(trim(coalesce(x, '')), '')` */
const limpo = (x) => { const t = String(x ?? '').trim(); return t === '' ? null : t }
const maiusculo = (x) => limpo(x)?.toUpperCase() ?? null
const minusculo = (x) => limpo(x)?.toLowerCase() ?? null
const copia = (x) => JSON.parse(JSON.stringify(x))

/** `vessel_telefone_canonico` — 55 + DDD + número, ou nulo. */
export function telefoneCanonico(bruto) {
  const d = String(bruto ?? '').replace(/\D/g, '')
  if (d.length === 10 || d.length === 11) return `55${d}`
  if ((d.length === 12 || d.length === 13) && d.startsWith('55')) return d
  return null
}

/** `vessel_instagram_canonico` — o perfil em minúsculas, sem @ nem endereço, ou nulo. */
export function instagramCanonico(bruto) {
  const h = String(bruto ?? '').trim().toLowerCase()
    .replace(/^(https?:\/\/)?(www\.)?instagram\.com\//, '').replace(/[/?#].*$/, '').replace(/^@/, '')
  return /^[a-z0-9._]{1,30}$/.test(h) ? h : null
}

/** O sorteio da chave: 8 letras do alfabeto sem O/0/I/1, byte ≥ 240 descartado. */
export function sortearChave(existe = () => false, aleatorio = byteAleatorio) {
  for (;;) {
    let chave = ''
    while (chave.length < 8) {
      const b = aleatorio()
      if (b >= 240) continue
      chave += ALFABETO[b % 30]
    }
    if (!existe(chave)) return chave
  }
}
function byteAleatorio() {
  const a = new Uint8Array(1)
  globalThis.crypto.getRandomValues(a)
  return a[0]
}

/** `vessel_situacao_do_convite` — A ORDEM É A REGRA. */
export function situacaoDoConvite(status, rsvp, enviadoEm, quandoDoEncontro, statusDoEncontro, agora) {
  if (status === 'realizado') return 'presente'
  if (status === 'no_show') return 'nao_compareceu'
  if (status === 'cancelado' || rsvp === 'nao') return 'recusou'
  if (status === 'confirmado' || rsvp === 'sim') return 'confirmada'
  if (['realizado', 'nao_realizado', 'cancelado'].includes(statusDoEncontro)
    || new Date(quandoDoEncontro).getTime() < agora.getTime()) return 'nao_respondeu'
  if (enviadoEm || rsvp) return 'convite_enviado'
  return 'convidada'
}

const media1 = (lista) => (lista.length
  ? Math.round((lista.reduce((a, b) => a + b, 0) / lista.length) * 10) / 10 : null)

/** O `raise exception ... using errcode` do banco: quem instala responde como o
 * PostgREST (400 com o `code`), em vez de 200 com uma resposta inventada. */
export function erroDoBanco(code, message) {
  const e = new Error(message)
  e.pg = { code, message, details: null, hint: null }
  return e
}

export function criarBancoDeMentira({ agora = () => new Date(), aoAvisar = () => {}, dados } = {}) {
  const b = dados ? copia(dados) : dadosIniciais(agora())
  // 24/09: dados de teste antigos não trazem as avaliações — começam sem nenhuma.
  if (!Array.isArray(b.qualificacoes)) b.qualificacoes = []
  // 24/09 (Private Edit só com liberada): dados antigos não trazem os motivos.
  if (!Array.isArray(b.motivos)) b.motivos = []
  // 25/09/2026 (praça e edição, Task 9): dados antigos não trazem o cadastro.
  if (!Array.isArray(b.pracas)) b.pracas = []
  if (!Array.isArray(b.pracaCidades)) b.pracaCidades = []
  if (!Array.isArray(b.edicoes)) b.edicoes = []
  if (!Array.isArray(b.naEdicao)) b.naEdicao = []
  const hoje = () => diaEmSaoPaulo(agora())
  const agoraIso = () => agora().toISOString()
  const proximo = (lista) => Math.max(0, ...lista.map((x) => x.id)) + 1
  const avisar = (evento, dadosDoEvento) => { try { aoAvisar(evento, copia(dadosDoEvento ?? {})) } catch { /* o roteiro é enfeite */ } }

  const stylistPorCodigo = (c) => b.stylists.find((s) => s.codigo === c) || null
  const stylistPorId = (id) => b.stylists.find((s) => s.id === id) || null
  const encontroPorCodigo = (c) => b.encontros.find((e) => e.codigo === c) || null
  const pessoaPorId = (id) => b.pessoas.find((p) => p.id === id) || null
  const diaDoEncontro = (e) => diaEmSaoPaulo(e.quando)
  const naoArquivado = (e) => !e.arquivada && !e.teste

  // ── praça e edição (25/09/2026, Task 9): o cadastro, não mais lista fechada ──
  const pracaPorId = (id) => (id == null ? null : b.pracas.find((p) => p.id === Number(id)) || null)
  /** `vessel_praca_id_ativa`: sigla existe e está ativa, ou nulo. */
  const pracaAtivaPorSigla = (sigla) => {
    const s = maiusculo(sigla)
    return s ? b.pracas.find((p) => p.sigla === s && p.ativa !== false) || null : null
  }
  /** `vessel_praca_id_da_cidade` (revisão final, IMPORTANTE 4): a praça SAI DA
   * CIDADE quando ninguém escolheu a praça — a MESMA conta achatada do
   * backfill da migration e do front (`achatarCidade`). Cidade que NÃO CASA
   * devolve nulo: pendência à vista, nunca um chute ("Limeira / Piracicaba"
   * é esse caso, de propósito). Praça desativada também não serve. */
  const pracaIdDaCidade = (cidade) => {
    const chave = achatarCidade(cidade)
    if (!chave) return null
    const c = b.pracaCidades.find((x) => x.cidade_chave === chave)
    if (!c) return null
    const p = pracaPorId(c.praca_id)
    return p && p.ativa !== false ? p.id : null
  }
  const edicaoPorId = (id) => (id == null ? null : b.edicoes.find((e) => e.id === Number(id)) || null)
  // ⚠️ TASK 3 (28/09/2026, edição = evento): `vessel_stylist_sincronizar_edicao`
  // virou `return;` no banco de verdade — mudar de praça NÃO mexe mais na
  // turma de evento nenhuma (a turma é de quem foi CONVIDADA, e mudar de
  // praça depois não muda de qual evento ela veio). Por isso NÃO HÁ MAIS
  // `vincularNaEdicaoAbertaDaPraca`/`fecharVinculoDaPracaAntiga` aqui: quem
  // entra na turma é só `vesselEdicaoMarcarMovimento`, chamada pelo MESMO
  // movimento de etapa que a equipe já faz (ver `vessel_stylist_mover_de_etapa`
  // e `vessel_edicao_abrir`, abaixo).
  /** `vessel_etapa_ativa_por_nome`: a etapa ATIVA de um tipo pelo NOME (como o
   * SQL faz com `lower(btrim(nome))`) — se houver mais de uma (não deveria),
   * a de MAIOR ordem, como o `max(...) filter` do banco. */
  function etapaAtivaPorNomeETipo(nomeAlvo, tipo) {
    const alvo = nomeAlvo.trim().toLowerCase()
    const candidatas = etapasAtivas().filter((e) => e.tipo === tipo && e.nome.trim().toLowerCase() === alvo)
    return candidatas.length ? candidatas.reduce((a, x) => (x.ordem > a.ordem ? x : a)) : null
  }
  /** `vessel_evento_de_origem`, para UMA stylist: importa a regra pura de
   * `edicao-regras.js` — NUNCA copiada aqui. */
  function eventoDeOrigemDoStylist(stylistId) {
    return eventoDeOrigem(b.naEdicao.filter((n) => n.stylist_id === stylistId)
      .map((n) => ({ edicao_id: n.edicao_id, presente_em: n.presente_em })))
  }
  /** `vessel_edicao_marcar_movimento` — chamada pelo mover de etapa (o mover
   * e a volta do "indisponível"). Vale só para a edição ABERTA da praça da
   * stylist; sem ela, nada acontece (nem erro) — NENHUMA LINHA CRIADA.
   *   funil, de Convidado em diante → entra na turma (`convidada_em`);
   *   de Confirmado em diante → `confirmou_em`; de Presença em diante →
   *   `presente_em` (as anteriores por "coalesce": quem pula etapa ganha
   *   todas); saída com motivo `volta_na_proxima_edicao` → `indisponivel_em`.
   * ⚠️ NUNCA APAGA MARCA: uma marca já gravada nunca volta a nulo. */
  function vesselEdicaoMarcarMovimento(stylistId, etapa, motivoId) {
    const conv = etapaAtivaPorNomeETipo('convidado', 'funil')
    const conf = etapaAtivaPorNomeETipo('confirmado', 'funil')
    const pres = etapaAtivaPorNomeETipo('presença', 'funil')
    if (!conv || !conf || !pres || !etapa) return
    const s = stylistPorId(stylistId)
    if (!s) return
    const ed = b.edicoes.find((e) => e.praca_id === s.praca_id && e.situacao === 'aberta')
    if (!ed) return
    if (etapa.tipo === 'funil' && etapa.ordem >= conv.ordem) {
      // entra na turma com o MESMO critério de sempre (ativa, não-teste)
      const elegivel = s.ativa !== false && !s.teste
      let linha = b.naEdicao.find((n) => n.stylist_id === stylistId && n.edicao_id === ed.id)
      if (!linha && elegivel) {
        linha = { id: proximo(b.naEdicao), stylist_id: stylistId, edicao_id: ed.id,
          entrou_em: null, saiu_em: null, etapa_ao_sair: null,
          convidada_em: null, confirmou_em: null, presente_em: null, indisponivel_em: null }
        b.naEdicao.push(linha)
      }
      if (linha) {
        linha.convidada_em = linha.convidada_em ?? agoraIso()
        if (etapa.ordem >= conf.ordem) linha.confirmou_em = linha.confirmou_em ?? agoraIso()
        if (etapa.ordem >= pres.ordem) linha.presente_em = linha.presente_em ?? agoraIso()
      }
    } else if (etapa.tipo === 'saida' && motivoId != null) {
      const m = b.motivos.find((x) => x.id === Number(motivoId) && x.etapa_id === etapa.id)
      if (m?.volta_na_proxima_edicao) {
        const linha = b.naEdicao.find((n) => n.stylist_id === stylistId && n.edicao_id === ed.id)
        if (linha) linha.indisponivel_em = linha.indisponivel_em ?? agoraIso()
      }
    }
  }
  /** `vessel_edicao_abrir` (nota da volta): de onde a stylist voltou —
   * 1º a última linha DELA (qualquer edição) com `indisponivel_em` (mais
   * recente); sem isso, a edição ANTERIOR da MESMA praça (a de maior número
   * antes desta). Sem os dois, nulo — a chamadora escreve "indisponível na
   * data" puro. */
  function rotuloDeOndeFicouIndisponivel(s, edicaoNova) {
    const linhas = b.naEdicao.filter((n) => n.stylist_id === s.id && n.indisponivel_em)
      .sort((x, y) => (x.indisponivel_em === y.indisponivel_em ? y.id - x.id : (x.indisponivel_em < y.indisponivel_em ? 1 : -1)))
    if (linhas.length) {
      const ed = edicaoPorId(linhas[0].edicao_id)
      const p = pracaPorId(ed?.praca_id)
      if (ed && p) return `Edição ${ed.numero} · ${p.nome}`
    }
    const anteriores = b.edicoes.filter((x) => x.praca_id === edicaoNova.praca_id && x.id !== edicaoNova.id && x.numero < edicaoNova.numero)
      .sort((x, y) => y.numero - x.numero)
    if (anteriores.length) {
      const p = pracaPorId(edicaoNova.praca_id)
      return `Edição ${anteriores[0].numero} · ${p?.nome ?? ''}`
    }
    return null
  }

  // ── a agenda e o encontro sobreposto (`2026-09-25-vessel-agenda-do-private-
  // edit.sql`): o lugar, quem se cruza com quem, e o que mais ocupa a loja ──
  const DURACAO_MS = DURACAO_DO_PRIVATE_EDIT_EM_HORAS * 3600000
  /** `vessel_lugar_do_encontro`: a loja; sem loja, praça + lugar escrito. */
  const lugarDoEncontro = (loja, praca, local) => limpo(loja)?.toLowerCase()
    || `praca:${String(praca ?? '').trim().toUpperCase()}|${String(local ?? '').trim().replace(/\s+/g, ' ').toLowerCase()}`
  const contaNaAgenda = (e) => !e.teste && !e.arquivada && !['cancelado', 'nao_realizado'].includes(e.status || 'agendado')
  const fimDo = (iso) => new Date(new Date(iso).getTime() + DURACAO_MS).toISOString()
  /** `vessel_encontros_que_sobrepoem` — [a, a+4h) cruza [b, b+4h); encostar não. */
  function sobrepoemCom(quando, lugar, ignorar) {
    if (!quando) return []
    const t = new Date(quando).getTime()
    const fora = maiusculo(ignorar)
    return b.encontros
      .filter((e) => contaNaAgenda(e) && e.codigo !== fora && lugarDoEncontro(e.loja, e.praca, e.local) === lugar
        && new Date(e.quando).getTime() < t + DURACAO_MS && t < new Date(e.quando).getTime() + DURACAO_MS)
      .sort((x, y) => (x.quando === y.quando ? (x.codigo < y.codigo ? -1 : 1) : (x.quando < y.quando ? -1 : 1)))
      .map((e) => {
        const s = stylistPorId(e.stylist_id)
        return { codigo: e.codigo, stylist: s?.codigo ?? null, anfitria: s?.nome ?? null, inicio: e.quando, fim: fimDo(e.quando),
          dia: diaEmSaoPaulo(e.quando), hora: horaEmSaoPaulo(e.quando), hora_fim: horaEmSaoPaulo(fimDo(e.quando)),
          loja: e.loja, praca: e.praca, local: e.local, status: e.status }
      })
  }
  /** `vessel_contexto_da_loja` — a sessão do mesmo dia e a visita dentro da janela. */
  function contextoDaLoja(quando, loja) {
    const l = limpo(loja)?.toLowerCase()
    if (!quando || !l) return []
    const t = new Date(quando).getTime()
    const sessoes = (b.sessoes || []).filter((x) => !x.arquivada && x.loja === l && x.quando === diaEmSaoPaulo(quando))
      .map((x) => ({ tipo: 'beauty_session', codigo: x.codigo, dia: x.quando, hora: null, loja: x.loja, praca: x.praca,
        parceiro: x.parceiro ?? null, client_advisor: null, status: null }))
    const visitas = b.atendimentos.filter((v) => v.quando && !v.teste && !String(v.evento_codigo || '').startsWith('PE-')
      && !['cancelado', 'remarcado'].includes(v.status) && v.loja === l
      && new Date(v.quando).getTime() >= t && new Date(v.quando).getTime() < t + DURACAO_MS)
      .map((v) => ({ tipo: 'private_appointment', codigo: null, dia: diaEmSaoPaulo(v.quando), hora: horaEmSaoPaulo(v.quando),
        loja: v.loja, praca: null, parceiro: null, client_advisor: v.client_advisor ?? null, status: v.status }))
    return [...sessoes, ...visitas].sort((x, y) => (x.dia + (x.hora || '')).localeCompare(y.dia + (y.hora || '')))
  }

  // ── o gatilho dos encontros: `vessel_stylist_seguir_os_encontros` ────────
  // ⚠️ DESDE 24/09/2026 ELE NÃO MEXE NA ETAPA: só congela `ativada_em`.
  function seguirOsEncontros(stylistId) {
    const s = stylistPorId(stylistId)
    if (!s) return
    const marcados = b.encontros.filter((e) => e.stylist_id === stylistId && !e.arquivada && MARCADOS.includes(e.status)).length
    if (marcados >= 1 && !s.ativada_em) s.ativada_em = agoraIso()
  }

  // ── as etapas: `vessel_stylist_etapas` e os gatilhos da etapa ──────────────
  const etapasAtivas = () => b.etapas.filter((e) => e.ativa !== false).sort((x, y) => x.ordem - y.ordem || x.id - y.id)
  const etapaPorId = (id) => b.etapas.find((e) => e.id === id && e.ativa !== false) || null
  const primeiraDoFunil = () => etapasAtivas().find((e) => e.tipo === 'funil') || null
  /** `vessel_etapa_conta_como_prospectada`: a marcada, ou uma de funil depois dela. */
  function contaComoProspectada(etapaId) {
    const e = etapaPorId(etapaId)
    const m = etapasAtivas().find((x) => x.conta_como_prospectada)
    return !!(e && m && e.tipo === 'funil' && e.ordem >= m.ordem)
  }
  /** Os dois gatilhos de `vessel_stylists`: a data da prospecção e o histórico.
   * ⚠️ 24/09/2026: o histórico guarda o motivo da saída, a nota e a FOTO da
   * marca "libera Private Edit" na hora da chegada (é dela que sai a ativação). */
  // ⚠️ TASK 3 (28/09/2026): `notaDaVolta` é a nota da VOLTA do "indisponível na
  // data" (`vessel_edicao_abrir`) — a mesma ideia de `vessel.nota_da_volta` no
  // banco de verdade: só entra no histórico quando a CHEGADA não é numa saída
  // (a saída já tem a nota dela própria, em `saida`).
  function mudarDeEtapa(s, etapaId, motivo, saida = null, notaDaVolta = null) {
    const de = s.etapa_id ?? null
    s.etapa_id = etapaId
    if (!s.prospectado_em && contaComoProspectada(etapaId)) s.prospectado_em = hoje()
    const e = etapaPorId(etapaId)
    const naSaida = e?.tipo === 'saida'
    const m = naSaida && saida?.motivoId != null ? b.motivos.find((x) => x.id === Number(saida.motivoId) && x.etapa_id === etapaId) : null
    b.historicoDeEtapas.push({ id: proximo(b.historicoDeEtapas), stylist_id: s.id, de_etapa_id: de,
      para_etapa_id: etapaId, motivo, por_nome: USUARIO_DA_DEMONSTRACAO, em: agoraIso(),
      motivo_id: m?.id ?? null, nota: naSaida ? limpo(saida?.nota) : limpo(notaDaVolta),
      liberava_private_edit: !!e?.libera_private_edit })
  }
  // ── os motivos das saídas e a ativação (24/09/2026) ─────────────────────
  const motivosDe = (etapaId) => b.motivos.filter((m) => m.etapa_id === etapaId)
  const motivosAtivosDe = (etapaId) => motivosDe(etapaId).filter((m) => m.ativo !== false)
    .sort((x, y) => x.ordem - y.ordem || x.id - y.id)
  /** `vessel_stylist_saida_atual`: a última linha do histórico dela. */
  const saidaAtual = (s) => b.historicoDeEtapas.filter((h) => h.stylist_id === s.id).sort((x, y) => x.id - y.id).at(-1) || null
  /** `vessel_stylist_ativada_em` — A definição, uma só: a primeira chegada numa
   * etapa que liberava Private Edit; sem ela, o primeiro encontro agendado. */
  function ativadaEm(s) {
    const chegadas = b.historicoDeEtapas.filter((h) => h.stylist_id === s.id && h.liberava_private_edit).map((h) => h.em).sort()
    return chegadas[0] || s.ativada_em || null
  }
  const porEncontroAntigo = (s) => !!s.ativada_em && !b.historicoDeEtapas.some((h) => h.stylist_id === s.id && h.liberava_private_edit)
  /** `vessel_stylist_conferir_motivo`: nulo quando está certo, ou a recusa. */
  function conferirMotivo(etapaId, motivoId, nota) {
    const e = etapaPorId(etapaId)
    if (!e) return 'etapa_invalida'
    const n = limpo(nota)
    if (n && n.length > 500) return 'nota_longa'
    if (e.tipo !== 'saida') return null
    const ativos = motivosAtivosDe(e.id)
    if (!ativos.length) return motivoId != null ? 'motivo_invalido' : null
    if (motivoId == null) return 'motivo_obrigatorio'
    const m = ativos.find((x) => x.id === Number(motivoId))
    if (!m) return 'motivo_invalido'
    if (m.exige_nota && !n) return 'nota_obrigatoria'
    return null
  }
  const liberam = () => etapasAtivas().filter((e) => e.libera_private_edit).map((e) => e.nome)
  const liberada = (s) => !!etapaPorId(s?.etapa_id)?.libera_private_edit
  const renumerarMotivos = (etapaId) => motivosAtivosDe(etapaId).forEach((m, i) => { m.ordem = i + 1 })
  function anotarMotivo(m, acao) {
    m.alterado_por_nome = USUARIO_DA_DEMONSTRACAO
    m.alterado_em = agoraIso()
    const e = b.etapas.find((x) => x.id === m.etapa_id)
    if (e) anotar(e, acao)
  }
  const renumerar = () => etapasAtivas().forEach((e, i) => { e.ordem = i + 1 })
  function anotar(etapa, acao) {
    b.trilhaDeEtapas.push({ id: proximo(b.trilhaDeEtapas), etapa_id: etapa.id, acao, por_nome: USUARIO_DA_DEMONSTRACAO, em: agoraIso() })
    etapa.alterado_por_nome = USUARIO_DA_DEMONSTRACAO
    etapa.alterado_em = agoraIso()
  }
  const nomeRepetido = (nome, menos) => etapasAtivas().some((e) => e.id !== menos && e.nome.trim().toLowerCase() === nome.toLowerCase())
  /** O `after insert or update or delete` de `vessel_private_edits`. */
  function gatilhoDoEncontro(antes, depois) {
    if (!antes && depois) return seguirOsEncontros(depois.stylist_id)
    if (antes && !depois) return seguirOsEncontros(antes.stylist_id)
    if (antes.stylist_id !== depois.stylist_id || antes.status !== depois.status
      || !!antes.arquivada !== !!depois.arquivada) {
      seguirOsEncontros(antes.stylist_id)
      if (antes.stylist_id !== depois.stylist_id) seguirOsEncontros(depois.stylist_id)
    }
  }

  // ── `vessel_vendas_dos_encontros`: a venda vai para o PRIMEIRO encontro ──
  function vendasDosEncontros(pDias = 14) {
    const dias = Math.max(Number(pDias ?? 14) || 0, 0)
    const saida = []
    for (const p of [...b.pedidos].sort((x, y) => x.id - y.id)) {
      if (p.situacao_id !== 9) continue
      const candidatos = []
      for (const t of b.atendimentos) {
        if (t.pessoa_id !== p.pessoa_id || !t.evento_codigo || t.status !== 'realizado' || t.teste) continue
        const e = encontroPorCodigo(t.evento_codigo)
        if (!e || e.teste || e.arquivada) continue
        const d0 = diaDoEncontro(e)
        if (p.data_do_pedido >= d0 && p.data_do_pedido <= somarDias(d0, dias)) candidatos.push(e)
      }
      if (!candidatos.length) continue
      candidatos.sort((x, y) => (x.quando === y.quando ? x.id - y.id : (x.quando < y.quando ? -1 : 1)))
      const e = candidatos[0]
      saida.push({ pedido_id: p.id, evento_codigo: e.codigo, stylist_id: e.stylist_id, pessoa_id: p.pessoa_id,
        receita: Number(p.receita_liquida ?? p.total_corrigido ?? 0), pecas: Number(p.pecas || 0), quando_do_encontro: e.quando })
    }
    return saida
  }

  const leiturasDoCardDe = (e) => (b.leiturasDoCard || []).filter((l) => l.private_edit_id === e.id)
  const situacaoDe = (t, e) => situacaoDoConvite(t.status, t.rsvp, t.convite_enviado_em, e.quando, e.status, agora())

  // ── `vessel_numeros_do_stylist_circle`: o corpo do placar, recortável ──
  // ⚠️ `stylistId` nulo = todas (o placar); um id = só ela (o scorecard). A
  // venda continua indo para o PRIMEIRO encontro olhando TODOS os encontros, e
  // só depois o recorte fica com a dela — a soma das fichas dá o placar.
  function numerosDoCircle(p_de, p_ate, p_dias, stylistId) {
    const de = p_de || '2000-01-01'
    const ate = p_ate || '9999-12-31' // 'infinity'::date
    const dentro = (d) => !!d && d >= de && d <= ate
    const dias = Math.max(Number(p_dias ?? 14) || 0, 0)
    const sty = b.stylists.filter((s) => !s.teste && (stylistId == null || s.id === stylistId))
    const idsSty = new Set(sty.map((s) => s.id))
    // ⚠️ 24/09/2026: a ATIVAÇÃO é `ativadaEm` (a etapa que libera Private
    // Edit); o dia do primeiro encontro agendado é `diaAgendou` (o de antes).
    const diaAtiv = (s) => { const a = ativadaEm(s); return a ? diaEmSaoPaulo(a) : null }
    const diaAgendou = (s) => (s.ativada_em ? diaEmSaoPaulo(s.ativada_em) : null)
    const ev = b.encontros.filter((e) => naoArquivado(e) && idsSty.has(e.stylist_id))
      .map((e) => ({ ...e, dia: diaDoEncontro(e) }))
    const evP = ev.filter((e) => dentro(e.dia))
    const codigosP = new Set(evP.map((e) => e.codigo))
    const conv = b.atendimentos.filter((t) => !t.teste && codigosP.has(t.evento_codigo)).map((t) => {
      const e = evP.find((x) => x.codigo === t.evento_codigo)
      return { ...t, status_do_encontro: e.status, situacao: situacaoDe(t, e) }
    })
    const vendas = vendasDosEncontros(dias).filter((v) => codigosP.has(v.evento_codigo))
    // Cada encontro realizado com o número de ordem dele na vida da stylist.
    const realizados = []
    for (const s of sty) {
      const dela = ev.filter((e) => e.stylist_id === s.id && e.status === 'realizado')
        .sort((x, y) => (x.realizado_em === y.realizado_em ? x.id - y.id : (x.realizado_em < y.realizado_em ? -1 : 1)))
      dela.forEach((e, i) => realizados.push({ stylist_id: s.id, realizado_em: e.realizado_em, n: i + 1,
        intervalo: i ? diasEntre(dela[i - 1].realizado_em, e.realizado_em) : null }))
    }
    const confirmada = (c) => ['confirmada', 'presente', 'nao_compareceu'].includes(c.situacao)
    const ativadasNoPeriodo = sty.filter((s) => dentro(diaAtiv(s)))
    // A TURMA da prospecção, passo a passo (cada passo dentro do anterior).
    const ateOFim = (d) => !!d && d <= ate
    const turma = sty.filter((s) => dentro(s.prospectado_em)).map((s) => {
      const ativou = ateOFim(diaAtiv(s)), agendou = ativou && ateOFim(diaAgendou(s))
      const n = (k) => realizados.some((r) => r.stylist_id === s.id && r.n === k && r.realizado_em <= ate)
      return { ativou, agendou, realizou: agendou && n(1), repetiu: agendou && n(2) }
    })
    const intervalosNoPeriodo = realizados.filter((r) => r.intervalo != null && dentro(r.realizado_em))
    return {
      de: p_de, ate: p_ate, janela_de_venda_em_dias: dias,
      prospectadas: sty.filter((s) => dentro(s.prospectado_em)).length,
      ativadas: ativadasNoPeriodo.length,
      prospectadas_ja_ativadas: turma.filter((t) => t.ativou).length,
      com_private_edit_agendado: sty.filter((s) => dentro(diaAgendou(s))).length,
      com_private_edit_realizado: new Set(realizados.filter((r) => r.n === 1 && dentro(r.realizado_em)).map((r) => r.stylist_id)).size,
      prospectadas_com_private_edit_agendado: turma.filter((t) => t.agendou).length,
      prospectadas_com_private_edit_realizado: turma.filter((t) => t.realizou).length,
      prospectadas_recorrentes: turma.filter((t) => t.repetiu).length,
      ativadas_por_encontro_antigo: sty.filter((s) => porEncontroAntigo(s) && dentro(diaAtiv(s))).length,
      encontros_agendados: evP.filter((e) => e.status !== 'em_planejamento').length,
      encontros_realizados: evP.filter((e) => e.status === 'realizado').length,
      encontros_cancelados: evP.filter((e) => ['cancelado', 'nao_realizado'].includes(e.status)).length,
      convidadas: conv.length,
      confirmadas: conv.filter(confirmada).length,
      confirmadas_em_realizados: conv.filter((c) => confirmada(c) && c.status_do_encontro === 'realizado').length,
      presentes: conv.filter((c) => c.status === 'realizado').length,
      presentes_em_realizados: conv.filter((c) => c.status === 'realizado' && c.status_do_encontro === 'realizado').length,
      recorrentes_no_periodo: realizados.filter((r) => r.n === 2 && dentro(r.realizado_em)).length,
      recorrentes_ate_o_fim: new Set(realizados.filter((r) => r.n === 2 && r.realizado_em <= ate).map((r) => r.stylist_id)).size,
      ativadas_ate_o_fim: sty.filter((s) => diaAtiv(s) && diaAtiv(s) <= ate).length,
      intervalos: intervalosNoPeriodo.length,
      intervalo_medio_em_dias: media1(intervalosNoPeriodo.map((r) => r.intervalo)),
      contatos_ate_ativar: media1(ativadasNoPeriodo.map((s) =>
        b.contatos.filter((c) => c.stylist_id === s.id && c.criado_em < ativadaEm(s)).length)),
      stylists_com_contatos_ate_ativar: ativadasNoPeriodo.length,
      compradoras: new Set(vendas.map((v) => v.pessoa_id)).size,
      vendas: vendas.length,
      pecas: vendas.reduce((a, v) => a + v.pecas, 0),
      receita: vendas.reduce((a, v) => a + v.receita, 0),
      por_stylist: sty.filter((s) => evP.some((e) => e.stylist_id === s.id))
        .sort((x, y) => (x.codigo < y.codigo ? -1 : 1))
        .map((s) => ({
          codigo: s.codigo, nome: s.nome,
          encontros_realizados: evP.filter((e) => e.stylist_id === s.id && e.status === 'realizado').length,
          vendas: vendas.filter((v) => v.stylist_id === s.id).length,
          receita: vendas.filter((v) => v.stylist_id === s.id).reduce((a, v) => a + v.receita, 0),
        })),
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  // AS FUNÇÕES — o nome é o do PostgREST (`/rest/v1/rpc/<nome>`).
  // ════════════════════════════════════════════════════════════════════════
  const funcoes = {
    // ── leituras ──────────────────────────────────────────────────────────
    // ⚠️ 25/09/2026 (Task 5): ganhou `p_praca_id`/`p_edicao_id` — os dois com
    // padrão nulo, para a chamada de sempre (só os dois primeiros, por nome —
    // a Central que está no ar e o Material Gráfico) continuar respondendo
    // igual. E ganhou `praca_id`/`praca_sigla`/`praca_nome`/`loja_destino`
    // (a praça de CADASTRO, não mais só o texto de `praca_preview`) e
    // `edicao_atual_id` (a edição em que ela está ATIVA agora — nula se não
    // estiver em nenhuma). ⚠️ TASK 3 (28/09/2026): `saiu_em` deixou de ser
    // gravado (a edição não fecha mais vínculo nenhum) — o critério virou a
    // linha mais RECENTE cuja edição NÃO ESTÁ ENCERRADA.
    vessel_rastreio_dos_stylists({ p_dias = 7, p_incluir_desativadas = false, p_praca_id = null, p_edicao_id = null } = {}) {
      const dias = Math.max(Number(p_dias ?? 7) || 0, 0)
      const vendas = vendasDosEncontros(dias)
      return b.stylists
        .filter((s) => !s.teste && (p_incluir_desativadas || s.ativa !== false))
        .filter((s) => p_praca_id == null || s.praca_id === Number(p_praca_id))
        .filter((s) => p_edicao_id == null
          || b.naEdicao.some((n) => n.stylist_id === s.id && n.edicao_id === Number(p_edicao_id)))
        .map((s) => {
          const pc = pracaPorId(s.praca_id)
          // a linha mais RECENTE (maior id) cuja edição não está encerrada.
          const edicaoAtual = b.naEdicao.filter((n) => n.stylist_id === s.id
              && edicaoPorId(n.edicao_id)?.situacao !== 'encerrada')
            .sort((x, y) => y.id - x.id)[0] || null
          const ev = b.encontros.filter((e) => e.stylist_id === s.id && !e.teste && !e.arquivada && e.status === 'realizado')
          const ultima = ev.map((e) => e.realizado_em).filter(Boolean).sort().pop() || null
          const contatos = b.contatos.filter((c) => c.stylist_id === s.id)
          const trouxe = new Set(b.origens.filter((o) => o.stylist_id === s.codigo).map((o) => o.pessoa_id))
          const atendDela = b.atendimentos.filter((t) => !t.teste && trouxe.has(t.pessoa_id))
          const receitaPeloLink = b.pedidos
            .filter((p) => p.situacao_id === 9 && trouxe.has(p.pessoa_id) && b.atendimentos.some((t) => {
              if (t.pessoa_id !== p.pessoa_id || t.teste || t.status !== 'realizado') return false
              const d0 = diaEmSaoPaulo(t.quando || t.criado_em)
              return p.data_do_pedido >= d0 && p.data_do_pedido <= somarDias(d0, dias)
            }))
            .reduce((a, p) => a + Number(p.receita_liquida ?? p.total_corrigido ?? 0), 0)
          return {
            codigo: s.codigo, nome: s.nome, cidade: s.cidade,
            etapa_id: s.etapa_id, etapa: b.etapas.find((e) => e.id === s.etapa_id)?.nome ?? null,
            etapa_tipo: b.etapas.find((e) => e.id === s.etapa_id)?.tipo ?? null,
            etapa_ordem: b.etapas.find((e) => e.id === s.etapa_id)?.ordem ?? null,
            etapa_libera_private_edit: !!b.etapas.find((e) => e.id === s.etapa_id)?.libera_private_edit,
            ...(() => {
              const naSaida = b.etapas.find((e) => e.id === s.etapa_id)?.tipo === 'saida'
              const h = naSaida ? saidaAtual(s) : null
              return { saida_motivo_id: h?.motivo_id ?? null, saida_motivo: b.motivos.find((m) => m.id === h?.motivo_id)?.nome ?? null,
                saida_nota: h?.nota ?? null }
            })(),
            praca_preview: s.praca_preview,
            praca_id: pc?.id ?? null, praca_sigla: pc?.sigla ?? null, praca_nome: pc?.nome ?? null,
            loja_destino: pc?.loja_destino ?? null, edicao_atual_id: edicaoAtual?.edicao_id ?? null,
            ativa: s.ativa, whatsapp: s.whatsapp, instagram: s.instagram, atuacao: s.atuacao,
            loja: s.loja, origem_contato: s.origem_contato, responsavel: s.responsavel,
            prospectado_em: s.prospectado_em, proxima_acao: s.proxima_acao, proxima_acao_em: s.proxima_acao_em,
            observacoes: s.observacoes ?? null, sem_contato: s.sem_contato === true,
            ativada_em: ativadaEm(s), private_edit_agendado_em: s.ativada_em ?? null,
            encontros_realizados: ev.length,
            ultima_private_edit: ultima,
            proxima_data_permitida: ultima ? somarDias(ultima, 45) : null,
            receita_dos_encontros: vendas.filter((v) => v.stylist_id === s.id).reduce((a, v) => a + v.receita, 0),
            contatos: contatos.length,
            ultimo_contato_em: contatos.map((c) => c.criado_em).sort().pop() || null,
            aberturas: b.aberturas[s.codigo] || 0,
            clientes: trouxe.size,
            pedidos: atendDela.length,
            confirmados: atendDela.filter((t) => ['confirmado', 'realizado', 'no_show'].includes(t.status)).length,
            compareceram: atendDela.filter((t) => t.status === 'realizado').length,
            receita: receitaPeloLink,
            janela_de_venda_em_dias: dias,
          }
        })
        .sort((x, y) => (x.codigo < y.codigo ? -1 : 1))
    },

    vessel_stylist_etapas() {
      return etapasAtivas().map((e) => ({
        id: e.id, nome: e.nome, ordem: e.ordem, tipo: e.tipo, conta_como_prospectada: !!e.conta_como_prospectada,
        libera_private_edit: !!e.libera_private_edit,
        stylists: b.stylists.filter((s) => s.etapa_id === e.id && !s.teste).length,
        motivos: motivosDe(e.id).sort((x, y) => (Number(x.ativo === false) - Number(y.ativo === false)) || x.ordem - y.ordem || x.id - y.id)
          .map((m) => ({ id: m.id, nome: m.nome, ordem: m.ordem, ativo: m.ativo !== false, exige_nota: !!m.exige_nota,
            stylists: b.stylists.filter((s) => s.etapa_id === e.id && !s.teste && saidaAtual(s)?.motivo_id === m.id).length })),
        stylists_sem_motivo: e.tipo === 'saida'
          ? b.stylists.filter((s) => s.etapa_id === e.id && !s.teste && saidaAtual(s)?.motivo_id == null).length : null,
        alterado_em: e.alterado_em ?? null, alterado_por_nome: e.alterado_por_nome ?? null,
      }))
    },

    vessel_stylist_historico_de_etapas({ p_codigo } = {}) {
      const s = stylistPorCodigo(maiusculo(p_codigo))
      if (!s) return []
      const nome = (id) => b.etapas.find((e) => e.id === id)?.nome ?? null
      return b.historicoDeEtapas.filter((h) => h.stylist_id === s.id)
        .sort((x, y) => (x.em === y.em ? y.id - x.id : (x.em < y.em ? 1 : -1)))
        .map((h) => ({ id: h.id, de: nome(h.de_etapa_id), para: nome(h.para_etapa_id), motivo: h.motivo,
          motivo_de_saida_id: h.motivo_id ?? null, motivo_de_saida: b.motivos.find((m) => m.id === h.motivo_id)?.nome ?? null,
          nota: h.nota ?? null, por_nome: h.por_nome, em: h.em }))
    },

    vessel_stylists_para_escolher() {
      return b.stylists.filter((s) => !s.teste && s.ativa !== false)
        .sort((x, y) => (x.codigo < y.codigo ? -1 : 1))
        .map((s) => ({ codigo: s.codigo, nome: s.nome, cidade: s.cidade, whatsapp: s.whatsapp,
          etapa: etapaPorId(s.etapa_id)?.nome ?? null, libera_private_edit: liberada(s) }))
    },

    vessel_conta_das_private_edits({ p_dias = 14, p_incluir_arquivadas = false } = {}) {
      const dias = Math.max(Number(p_dias ?? 14) || 0, 0)
      const vendas = vendasDosEncontros(dias)
      return b.encontros
        .filter((e) => !e.teste && (p_incluir_arquivadas || !e.arquivada))
        .map((e) => {
          const s = stylistPorId(e.stylist_id)
          const conv = b.atendimentos.filter((t) => t.evento_codigo === e.codigo && !t.teste)
            .map((t) => ({ ...t, situacao: situacaoDe(t, e) }))
          const dele = vendas.filter((v) => v.evento_codigo === e.codigo)
          return {
            codigo: e.codigo, chave: e.chave, quando: e.quando, anfitria: s?.nome ?? null, stylist: s?.codigo ?? null,
            local: e.local, praca: e.praca, loja: e.loja, vagas: e.vagas,
            ativa: e.ativa ?? true, arquivada: !!e.arquivada,
            status: e.status, realizado_em: e.realizado_em, motivo: e.motivo, observacoes: e.observacoes,
            convidadas: conv.length,
            responderam: conv.filter((c) => c.rsvp != null || c.status !== 'solicitado').length,
            disseram_sim: conv.filter((c) => c.rsvp === 'sim').length,
            confirmadas: conv.filter((c) => ['confirmada', 'presente', 'nao_compareceu'].includes(c.situacao)).length,
            compareceram: conv.filter((c) => c.status === 'realizado').length,
            receita: dele.reduce((a, v) => a + v.receita, 0),
            vendas: dele.length,
            janela_de_venda_em_dias: dias,
            // 28/09/2026: o QR do Private Edit Card (linhas e origens distintas).
            leituras_do_card: leiturasDoCardDe(e).length,
            leitoras_do_card: new Set(leiturasDoCardDe(e).map((l) => l.ip_hash)).size,
          }
        })
        .sort((x, y) => (x.quando === y.quando ? 0 : (x.quando < y.quando ? 1 : -1)))
    },

    // ── 28/09/2026: o Private Edit Card do site (`2026-09-29-vessel-card-da-stylist.sql`) ──
    // ⚠️ A Central não chama estas duas (quem chama é o gerador do site); estão
    // aqui para a demonstração responder o mesmo contrato. Sem IP no navegador:
    // toda chamada vem da MESMA origem (`p_origem`, só da demo, para o teste).
    vessel_card_da_stylist({ p_quem = null, p_origem = 'demo' } = {}) {
      const quem = String(p_quem ?? '').trim()
      if (!quem) return { ok: false, situacao: 'vazio' }
      const agoraMs = agora().getTime()
      b.consultasDoCard = (b.consultasDoCard || []).filter((c) => new Date(c.momento).getTime() >= agoraMs - 86400000)
      const recentes = b.consultasDoCard.filter((c) => c.ip_hash === p_origem && new Date(c.momento).getTime() > agoraMs - 3600000)
      if (recentes.length >= 30) return { ok: false, situacao: 'devagar' }
      b.consultasDoCard.push({ ip_hash: p_origem, momento: agoraIso() })
      if (quem.length > 200) return { ok: false, situacao: 'nao_achei' }
      const valem = b.stylists.filter((s) => s.ativa !== false && !s.teste)
      const fone = telefoneCanonico(quem)
      let achadas
      if (fone) achadas = valem.filter((s) => telefoneCanonico(s.whatsapp) === fone)
      else if (quem.includes('@')) return { ok: false, situacao: 'nao_achei' } // stylist ainda não tem e-mail
      else achadas = valem.filter((s) => achatarCidade(s.nome) === achatarCidade(quem))
      if (achadas.length > 1) return { ok: false, situacao: 'varias' }
      const s = achadas[0]
      if (!s) return { ok: false, situacao: 'nao_achei' }
      const stylist = { codigo: s.codigo, nome: s.nome }
      const encontros = b.encontros
        .filter((e) => e.stylist_id === s.id && e.ativa !== false && !e.arquivada && !e.teste
          && !['cancelado', 'realizado', 'nao_realizado'].includes(e.status || 'agendado')
          && new Date(e.quando).getTime() >= agoraMs - 12 * 3600000)
        .sort((x, y) => (x.quando === y.quando ? (x.codigo < y.codigo ? -1 : 1) : (x.quando < y.quando ? -1 : 1)))
        .map((e) => ({ chave: e.chave, codigo: e.codigo, quando: e.quando, loja: e.loja ?? null, praca: e.praca ?? null }))
      if (!encontros.length) return { ok: false, situacao: 'sem_encontro', stylist }
      return { ok: true, stylist, encontros }
    },

    vessel_leitura_do_card({ p_chave = null, p_origem = 'demo' } = {}) {
      const chave = String(p_chave ?? '').trim().toUpperCase()
      const e = b.encontros.find((x) => x.chave === chave && !x.arquivada)
      if (!e) return { ok: false, situacao: 'nao_achei' }
      if (!e.teste) {
        b.leiturasDoCard = b.leiturasDoCard || []
        const dezMin = agora().getTime() - 10 * 60000
        if (!b.leiturasDoCard.some((l) => l.private_edit_id === e.id && l.ip_hash === p_origem
          && new Date(l.momento).getTime() > dezMin)) {
          b.leiturasDoCard.push({ private_edit_id: e.id, momento: agoraIso(), ip_hash: p_origem })
        }
      }
      return { ok: true, codigo: e.codigo, anfitria: stylistPorId(e.stylist_id)?.nome ?? null, quando: e.quando,
        loja: e.loja ?? null, praca: e.praca ?? null }
    },

    // ── 25/09/2026: a agenda das lojas e a pergunta de antes de gravar ──────
    // ⚠️ A MESMA FORMA DO BANCO: todo item com as 18 chaves (`CHAVES_DO_ITEM`),
    // o dia e a hora no fuso de São Paulo, e o Private Appointment SEM o nome
    // da cliente.
    vessel_agenda_das_lojas({ p_de = null, p_ate = null, p_loja = null } = {}) {
      const de = p_de || hoje()
      const ate = p_ate || somarDias(p_de || hoje(), 41)
      if (ate < de) throw erroDoBanco('22023', 'o fim vem antes do começo')
      if (diasEntre(de, ate) > 190) throw erroDoBanco('22023', 'periodo longo demais (maximo 190 dias)')
      const loja = limpo(p_loja)?.toLowerCase() ?? null
      const dentro = (d) => d >= de && d <= ate
      const vazio = { id: null, codigo: null, hora: null, hora_fim: null, inicio: null, fim: null, loja: null, praca: null,
        local: null, lugar: null, stylist: null, anfitria: null, parceiro: null, client_advisor: null, status: null, sobrepoe: null }
      const pes = b.encontros.filter((e) => contaNaAgenda(e) && dentro(diaDoEncontro(e)) && (!loja || e.loja === loja))
        .map((e) => {
          const s = stylistPorId(e.stylist_id)
          const lugar = lugarDoEncontro(e.loja, e.praca, e.local)
          return { ...vazio, tipo: 'private_edit', id: e.id, codigo: e.codigo, dia: diaDoEncontro(e), hora: horaEmSaoPaulo(e.quando),
            hora_fim: horaEmSaoPaulo(fimDo(e.quando)), inicio: e.quando, fim: fimDo(e.quando), loja: e.loja, praca: e.praca,
            local: e.local, lugar, stylist: s?.codigo ?? null, anfitria: s?.nome ?? null, status: e.status,
            sobrepoe: sobrepoemCom(e.quando, lugar, e.codigo).map((o) => o.codigo) }
        })
      const bss = (b.sessoes || []).filter((x) => !x.arquivada && dentro(x.quando) && (!loja || x.loja === loja))
        .map((x) => ({ ...vazio, tipo: 'beauty_session', codigo: x.codigo, dia: x.quando, loja: x.loja, praca: x.praca,
          lugar: x.loja, parceiro: x.parceiro ?? null, status: x.ativa === false ? 'encerrada' : 'aberta' }))
      const pas = b.atendimentos.filter((t) => t.quando && !t.teste && !String(t.evento_codigo || '').startsWith('PE-')
        && !['cancelado', 'remarcado'].includes(t.status) && dentro(diaEmSaoPaulo(t.quando)) && (!loja || t.loja === loja))
        .map((t) => ({ ...vazio, tipo: 'private_appointment', id: t.id, dia: diaEmSaoPaulo(t.quando), hora: horaEmSaoPaulo(t.quando),
          inicio: t.quando, loja: t.loja, lugar: t.loja, client_advisor: t.client_advisor ?? null, status: t.status }))
      const chave = (i) => [i.dia, i.hora ?? '', i.tipo, i.codigo ?? '']
      return [...pes, ...bss, ...pas].sort((x, y) => {
        const [a1, a2, a3, a4] = chave(x), [b1, b2, b3, b4] = chave(y)
        return a1.localeCompare(b1) || (x.hora == null ? -1 : 0) - (y.hora == null ? -1 : 0) || a2.localeCompare(b2)
          || a3.localeCompare(b3) || a4.localeCompare(b4)
      })
    },

    vessel_private_edit_sobreposicoes({ p_quando = null, p_loja = null, p_ignorar_codigo = null, p_praca = null, p_local = null } = {}) {
      const quando = p_quando ? new Date(p_quando).toISOString() : null
      return { ok: true, duracao_em_horas: DURACAO_DO_PRIVATE_EDIT_EM_HORAS,
        sobrepoe: sobrepoemCom(quando, lugarDoEncontro(p_loja, p_praca, p_local), p_ignorar_codigo),
        contexto: contextoDaLoja(quando, p_loja) }
    },

    vessel_convidadas_do_encontro({ p_codigo, p_dias = 14 } = {}) {
      const e = encontroPorCodigo(maiusculo(p_codigo))
      if (!e) return []
      const vendas = vendasDosEncontros(Math.max(Number(p_dias ?? 14) || 0, 0))
      return b.atendimentos.filter((t) => t.evento_codigo === e.codigo && !t.teste)
        .sort((x, y) => x.id - y.id)
        .map((t) => {
          const pe = pessoaPorId(t.pessoa_id) || {}
          return {
            id: t.id, pessoa_id: t.pessoa_id, nome: pe.nome ?? null, telefone: pe.telefone ?? null, email: pe.email ?? null,
            rsvp: t.rsvp, status: t.status, convidada_em: t.convidada_em, convite_enviado_em: t.convite_enviado_em,
            chave_convite: t.chave_convite, convite_aberto_em: t.convite_aberto_em, convite_aberturas: t.convite_aberturas,
            respondeu_em: t.rsvp != null ? t.criado_em : null, presenca_em: t.presenca_em,
            situacao: situacaoDe(t, e),
            comprou: vendas.some((v) => v.evento_codigo === e.codigo && v.pessoa_id === t.pessoa_id),
          }
        })
    },

    // ⚠️ 24/09: O PLACAR É PORTÃO + MIOLO, como no banco — o scorecard chama o
    // MESMO `numerosDoCircle` recortado numa stylist (ver o bloco do fim).
    vessel_placar_do_stylist_circle({ p_de = null, p_ate = null, p_dias = 14 } = {}) {
      return numerosDoCircle(p_de, p_ate, p_dias, null)
    },

    vessel_stylist_contatos({ p_codigo } = {}) {
      const s = stylistPorCodigo(maiusculo(p_codigo))
      if (!s) return []
      return b.contatos.filter((c) => c.stylist_id === s.id)
        .sort((x, y) => (x.criado_em === y.criado_em ? y.id - x.id : (x.criado_em < y.criado_em ? 1 : -1)))
        .map((c) => ({ id: c.id, canal: c.canal, resultado: c.resultado, nota: c.nota,
          criado_em: c.criado_em, criado_por_nome: c.criado_por_nome }))
    },

    vessel_chave_da_convidada({ p_id } = {}) {
      const t = b.atendimentos.find((x) => x.id === Number(p_id))
      const e = t && encontroPorCodigo(t.evento_codigo)
      if (!t || !e) return { ok: false, situacao: 'nao_achei' }
      if (!t.chave_convite) t.chave_convite = sortearChave((k) => b.atendimentos.some((x) => x.chave_convite === k))
      return { ok: true, situacao: 'ok', chave: t.chave_convite, chave_encontro: e.chave }
    },

    // ── escritas: a stylist ───────────────────────────────────────────────
    vessel_stylist_criar(a = {}) {
      if (!limpo(a.p_nome)) return { ok: false, situacao: 'sem_nome' }
      // ⚠️ WHATSAPP OU INSTAGRAM: telefone escrito e inválido continua recusado.
      let fone = null
      if (limpo(a.p_whatsapp)) {
        fone = telefoneCanonico(a.p_whatsapp)
        if (!fone) return { ok: false, situacao: 'whatsapp_invalido' }
      }
      const insta = limpo(a.p_instagram), perfil = instagramCanonico(a.p_instagram), obs = limpo(a.p_observacoes)
      if (insta && insta.length > 120) return { ok: false, situacao: 'instagram_longo' }
      // ⚠️ SEM CONTATO AINDA (2026-09-24-vessel-stylist-sem-contato.sql): só com a caixa marcada.
      const semContato = a.p_sem_contato === true && !fone && !insta
      if (!fone && !insta && !semContato) return { ok: false, situacao: 'sem_contato' }
      if (!fone && insta && !perfil) return { ok: false, situacao: 'instagram_invalido' }
      if (obs && obs.length > 2000) return { ok: false, situacao: 'observacoes_longas' }
      const praca = maiusculo(a.p_praca), loja = minusculo(a.p_loja), origem = minusculo(a.p_origem_contato)
      // ⚠️ 25/09/2026 (Task 9): a praça deixou de ser lista fechada — consulta
      // ao cadastro (sigla existe e está ativa), como o banco de verdade.
      let pracaId = null
      if (praca) {
        const p = pracaAtivaPorSigla(praca)
        if (!p) return { ok: false, situacao: 'praca_invalida' }
        pracaId = p.id
      } else {
        // ⚠️ REVISÃO FINAL (IMPORTANTE 4): sem praça escolhida, a praça sai
        // da CIDADE — como no banco de verdade. `praca_preview` NÃO é
        // inventado a partir disso: ele guarda o que a pessoa escreveu.
        pracaId = pracaIdDaCidade(a.p_cidade)
      }
      if (loja && !LOJAS.includes(loja)) return { ok: false, situacao: 'loja_invalida' }
      // ⚠️ NA CENTRAL A ORIGEM É OBRIGATÓRIA.
      if (!origem || !ORIGENS.includes(origem)) return { ok: false, situacao: 'origem_invalida' }
      const repetida = fone && b.stylists.find((s) => s.whatsapp === fone)
      if (repetida) return { ok: false, situacao: 'whatsapp_repetido', codigo: repetida.codigo }
      const mesmoPerfil = perfil && b.stylists.find((s) => instagramCanonico(s.instagram) === perfil)
      if (mesmoPerfil) return { ok: false, situacao: 'instagram_repetido', codigo: mesmoPerfil.codigo }

      let n = Math.max(0, ...b.stylists.map((s) => /^STY-(\d{4})$/.exec(s.codigo)).filter(Boolean).map((m) => Number(m[1])))
      let codigo = null
      for (let i = 0; i < 10000; i++) {
        n += 1; if (n > 9999) n = 0
        const c = `STY-${String(n).padStart(4, '0')}`
        if (!stylistPorCodigo(c)) { codigo = c; break }
      }
      if (!codigo) return { ok: false, situacao: 'sem_codigo_livre' }
      // ⚠️ `p_prospectado_em` é legado e ignorado: a data é da etapa marcada.
      const s = {
        id: proximo(b.stylists), codigo, nome: String(a.p_nome).trim(), whatsapp: fone,
        cidade: limpo(a.p_cidade), instagram: insta, atuacao: limpo(a.p_atuacao),
        praca_preview: praca, praca_id: pracaId, loja, origem_contato: origem, origem_canal: null, responsavel: limpo(a.p_responsavel),
        prospectado_em: null, proxima_acao: limpo(a.p_proxima_acao), observacoes: obs, sem_contato: semContato,
        proxima_acao_em: a.p_proxima_acao_em || null, ativada_em: null, etapa_id: null, ativa: true, teste: false,
      }
      b.stylists.push(s)
      // Cadastro novo entra na PRIMEIRA etapa de funil — nunca entra na turma
      // de evento nenhuma por aqui (Task 3: só o movimento de etapa marca).
      mudarDeEtapa(s, primeiraDoFunil()?.id ?? null, 'cadastro')
      avisar('stylist_criada', { codigo, nome: s.nome })
      return { ok: true, situacao: 'ok', codigo }
    },

    vessel_stylist_editar(a = {}) {
      const codigo = maiusculo(a.p_codigo)
      const s = stylistPorCodigo(codigo)
      if (!s) return { ok: false, situacao: 'nao_achei' }
      // ⚠️ LEGADO: a etapa muda por `vessel_stylist_mover_de_etapa`.
      if (limpo(a.p_estagio)) return { ok: false, situacao: 'etapa_pela_ficha' }
      let fone = null
      if (limpo(a.p_whatsapp)) {
        fone = telefoneCanonico(a.p_whatsapp)
        if (!fone) return { ok: false, situacao: 'whatsapp_invalido' }
        if (b.stylists.some((x) => x.whatsapp === fone && x.codigo !== codigo)) return { ok: false, situacao: 'whatsapp_repetido' }
      }
      const insta = limpo(a.p_instagram), perfil = instagramCanonico(a.p_instagram)
      if (insta) {
        if (insta.length > 120) return { ok: false, situacao: 'instagram_longo' }
        if (!(fone ?? s.whatsapp) && !perfil) return { ok: false, situacao: 'instagram_invalido' }
        if (perfil && b.stylists.some((x) => x.codigo !== codigo && instagramCanonico(x.instagram) === perfil)) {
          return { ok: false, situacao: 'instagram_repetido' }
        }
      }
      // ⚠️ SEM CONTATO AINDA: nulo não mexe; desmarcar sem contato é recusado;
      // ganhar um contato desliga a marca.
      const comContato = !!(fone ?? s.whatsapp) || !!(insta ?? limpo(s.instagram))
      if (a.p_sem_contato === false && !comContato) return { ok: false, situacao: 'sem_contato' }
      if (a.p_observacoes != null && String(a.p_observacoes).trim().length > 2000) return { ok: false, situacao: 'observacoes_longas' }
      const praca = maiusculo(a.p_praca), loja = minusculo(a.p_loja), origem = minusculo(a.p_origem_contato)
      // ⚠️ 25/09/2026 (Task 9): consulta ao cadastro, não lista fechada.
      let pracaId
      if (praca) {
        const p = pracaAtivaPorSigla(praca)
        if (!p) return { ok: false, situacao: 'praca_invalida' }
        pracaId = p.id
      }
      if (loja && !LOJAS.includes(loja)) return { ok: false, situacao: 'loja_invalida' }
      if (origem && !ORIGENS.includes(origem)) return { ok: false, situacao: 'origem_invalida' }
      Object.assign(s, {
        sem_contato: comContato ? false : (a.p_sem_contato ?? s.sem_contato ?? false),
        nome: limpo(a.p_nome) ?? s.nome,
        whatsapp: fone ?? s.whatsapp,
        cidade: limpo(a.p_cidade) ?? s.cidade,
        instagram: insta ?? s.instagram,
        atuacao: limpo(a.p_atuacao) ?? s.atuacao,
        praca_preview: praca ?? s.praca_preview,
        // ⚠️ `praca_id` só muda quando `p_praca` veio — o mesmo NULO-não-mexe
        // de `praca_preview`, acima.
        praca_id: pracaId ?? s.praca_id,
        loja: loja ?? s.loja,
        origem_contato: origem ?? s.origem_contato,
        responsavel: limpo(a.p_responsavel) ?? s.responsavel,
        proxima_acao: a.p_sem_proxima_acao ? null : (limpo(a.p_proxima_acao) ?? s.proxima_acao),
        proxima_acao_em: a.p_sem_proxima_acao ? null : (a.p_proxima_acao_em || s.proxima_acao_em),
        // `observacoes`: nula não mexe, string vazia apaga.
        observacoes: a.p_observacoes == null ? (s.observacoes ?? null) : limpo(a.p_observacoes),
      })
      // ⚠️ TASK 3 (28/09/2026): mudar de praça NÃO mexe mais na turma de
      // evento nenhuma — a turma é de quem foi CONVIDADA, e mudar de praça
      // depois não muda de qual evento ela veio (`vessel_stylist_sincronizar_
      // edicao` virou `return;` no banco de verdade).
      avisar('stylist_editada', { codigo })
      return { ok: true, situacao: 'ok', codigo }
    },

    vessel_stylist_mover_de_etapa({ p_codigo, p_etapa_id, p_motivo_id = null, p_nota = null } = {}) {
      const codigo = maiusculo(p_codigo)
      const s = stylistPorCodigo(codigo)
      if (!s) return { ok: false, situacao: 'nao_achei' }
      const e = etapaPorId(Number(p_etapa_id))
      if (!e) return { ok: false, situacao: 'etapa_invalida' }
      if (s.etapa_id === e.id) return { ok: true, situacao: 'sem_mudanca', codigo }
      // ⚠️ 24/09/2026: saída com motivos exige o motivo (e a nota, se ele pede).
      const recusa = conferirMotivo(e.id, p_motivo_id, p_nota)
      if (recusa) return { ok: false, situacao: recusa, etapa: e.nome }
      const de = b.etapas.find((x) => x.id === s.etapa_id)?.nome ?? null
      mudarDeEtapa(s, e.id, 'mudanca', { motivoId: p_motivo_id, nota: p_nota })
      // 28/09/2026 (Task 3): o MESMO movimento marca a turma do evento.
      vesselEdicaoMarcarMovimento(s.id, e, e.tipo === 'saida' ? p_motivo_id : null)
      avisar('etapa_mudada', { codigo, de, para: e.nome, libera_private_edit: !!e.libera_private_edit })
      return { ok: true, situacao: 'ok', codigo, etapa: e.nome, libera_private_edit: !!e.libera_private_edit,
        prospectado_em: s.prospectado_em }
    },

    /** `vessel_stylist_trocar_motivo` (29/09/2026): troca o motivo da saída
     * ATUAL sem mudar a etapa — 1 linha no histórico com a mesma etapa em
     * de/para e `motivo = 'troca_de_motivo'`; nota vazia = mantém a atual;
     * motivo "volta na próxima edição" marca `indisponivel_em` (nunca apaga). */
    vessel_stylist_trocar_motivo({ p_codigo, p_motivo_id = null, p_nota = null } = {}) {
      const codigo = maiusculo(p_codigo)
      const s = stylistPorCodigo(codigo)
      if (!s) return { ok: false, situacao: 'nao_achei' }
      const e = etapaPorId(s.etapa_id)
      if (!e || e.tipo !== 'saida') return { ok: false, situacao: 'nao_esta_em_saida', codigo, etapa: e?.nome ?? null }
      const atual = saidaAtual(s)
      const nota = limpo(p_nota) ?? atual?.nota ?? null
      let recusa = conferirMotivo(e.id, p_motivo_id, nota)
      if (!recusa && p_motivo_id == null) recusa = 'motivo_obrigatorio'
      if (recusa) return { ok: false, situacao: recusa, codigo, etapa: e.nome }
      const motivoId = Number(p_motivo_id)
      if ((atual?.motivo_id ?? null) === motivoId && (atual?.nota ?? null) === nota) return { ok: true, situacao: 'sem_mudanca', codigo }
      b.historicoDeEtapas.push({ id: proximo(b.historicoDeEtapas), stylist_id: s.id, de_etapa_id: e.id,
        para_etapa_id: e.id, motivo: 'troca_de_motivo', por_nome: USUARIO_DA_DEMONSTRACAO, em: agoraIso(),
        motivo_id: motivoId, nota, liberava_private_edit: false })
      vesselEdicaoMarcarMovimento(s.id, e, motivoId)
      avisar('motivo_trocado', { codigo, motivo_id: motivoId })
      return { ok: true, situacao: 'ok', codigo, etapa: e.nome, motivo_id: motivoId,
        motivo_anterior_id: atual?.motivo_id ?? null, motivo: b.motivos.find((m) => m.id === motivoId)?.nome ?? null }
    },

    // ── escritas: a marca "libera Private Edit" e os motivos (24/09/2026) ──
    vessel_stylist_etapa_liberar_private_edit({ p_id, p_libera } = {}) {
      if (p_libera == null) return { ok: false, situacao: 'sem_escolha' }
      const e = etapaPorId(Number(p_id))
      if (!e) return { ok: false, situacao: 'nao_achei' }
      if (!!e.libera_private_edit === !!p_libera) return { ok: true, situacao: 'sem_mudanca', id: e.id }
      e.libera_private_edit = !!p_libera
      anotar(e, 'libera_private_edit')
      return { ok: true, situacao: 'ok', id: e.id }
    },

    vessel_stylist_motivo_criar({ p_etapa_id, p_nome, p_exige_nota = false } = {}) {
      const nome = String(p_nome ?? '').trim()
      if (!nome) return { ok: false, situacao: 'sem_nome' }
      if (nome.length > 80) return { ok: false, situacao: 'motivo_longo' }
      const e = etapaPorId(Number(p_etapa_id))
      if (!e) return { ok: false, situacao: 'nao_achei' }
      if (e.tipo !== 'saida') return { ok: false, situacao: 'so_saida' }
      if (motivosAtivosDe(e.id).some((m) => m.nome.trim().toLowerCase() === nome.toLowerCase())) return { ok: false, situacao: 'nome_repetido' }
      const m = { id: proximo(b.motivos), etapa_id: e.id, nome, ordem: motivosAtivosDe(e.id).length + 1, exige_nota: !!p_exige_nota, ativo: true }
      b.motivos.push(m)
      anotarMotivo(m, 'motivo_criar')
      return { ok: true, situacao: 'ok', id: m.id }
    },

    vessel_stylist_motivo_renomear({ p_id, p_nome } = {}) {
      const nome = String(p_nome ?? '').trim()
      if (!nome) return { ok: false, situacao: 'sem_nome' }
      if (nome.length > 80) return { ok: false, situacao: 'motivo_longo' }
      const m = b.motivos.find((x) => x.id === Number(p_id))
      if (!m) return { ok: false, situacao: 'nao_achei' }
      if (motivosAtivosDe(m.etapa_id).some((x) => x.id !== m.id && x.nome.trim().toLowerCase() === nome.toLowerCase())) {
        return { ok: false, situacao: 'nome_repetido' }
      }
      m.nome = nome
      anotarMotivo(m, 'motivo_renomear')
      return { ok: true, situacao: 'ok', id: m.id }
    },

    vessel_stylist_motivo_mover({ p_id, p_direcao } = {}) {
      if (!['subir', 'descer'].includes(p_direcao)) return { ok: false, situacao: 'direcao_invalida' }
      const m = b.motivos.find((x) => x.id === Number(p_id) && x.ativo !== false)
      if (!m) return { ok: false, situacao: 'nao_achei' }
      renumerarMotivos(m.etapa_id)
      const viz = motivosAtivosDe(m.etapa_id).find((x) => x.ordem === m.ordem + (p_direcao === 'subir' ? -1 : 1))
      if (!viz) return { ok: false, situacao: 'no_limite' }
      ;[m.ordem, viz.ordem] = [viz.ordem, m.ordem]
      anotarMotivo(m, 'motivo_reordenar')
      return { ok: true, situacao: 'ok', id: m.id }
    },

    vessel_stylist_motivo_ativar({ p_id, p_ativo } = {}) {
      if (p_ativo == null) return { ok: false, situacao: 'sem_escolha' }
      const m = b.motivos.find((x) => x.id === Number(p_id))
      if (!m) return { ok: false, situacao: 'nao_achei' }
      if ((m.ativo !== false) === !!p_ativo) return { ok: true, situacao: 'sem_mudanca', id: m.id }
      if (p_ativo && motivosAtivosDe(m.etapa_id).some((x) => x.nome.trim().toLowerCase() === m.nome.trim().toLowerCase())) {
        return { ok: false, situacao: 'nome_repetido' }
      }
      if (p_ativo) m.ordem = motivosAtivosDe(m.etapa_id).length + 1
      m.ativo = !!p_ativo
      renumerarMotivos(m.etapa_id)
      anotarMotivo(m, 'motivo_ativar')
      return { ok: true, situacao: 'ok', id: m.id }
    },

    vessel_stylist_motivo_exigir_nota({ p_id, p_exige } = {}) {
      if (p_exige == null) return { ok: false, situacao: 'sem_escolha' }
      const m = b.motivos.find((x) => x.id === Number(p_id))
      if (!m) return { ok: false, situacao: 'nao_achei' }
      if (!!m.exige_nota === !!p_exige) return { ok: true, situacao: 'sem_mudanca', id: m.id }
      m.exige_nota = !!p_exige
      anotarMotivo(m, 'motivo_exige_nota')
      return { ok: true, situacao: 'ok', id: m.id }
    },

    // ── escritas: as etapas do funil ──────────────────────────────────────
    vessel_stylist_etapa_criar({ p_nome, p_posicao = null, p_tipo = 'funil' } = {}) {
      const nome = String(p_nome ?? '').trim(), tipo = String(p_tipo ?? 'funil').trim().toLowerCase()
      if (!nome) return { ok: false, situacao: 'sem_nome' }
      if (nome.length > 60) return { ok: false, situacao: 'nome_longo' }
      if (!['funil', 'saida'].includes(tipo)) return { ok: false, situacao: 'tipo_invalido' }
      if (nomeRepetido(nome)) return { ok: false, situacao: 'nome_repetido' }
      const n = etapasAtivas().length
      const pos = Math.min(Math.max(Number(p_posicao ?? n + 1) || n + 1, 1), n + 1)
      for (const e of etapasAtivas()) if (e.ordem >= pos) e.ordem += 1
      const e = { id: proximo(b.etapas), nome, ordem: pos, tipo, conta_como_prospectada: false, ativa: true }
      b.etapas.push(e)
      renumerar()
      anotar(e, 'criar')
      avisar('etapa_criada', { id: e.id, nome })
      return { ok: true, situacao: 'ok', id: e.id }
    },

    vessel_stylist_etapa_renomear({ p_id, p_nome } = {}) {
      const nome = String(p_nome ?? '').trim()
      if (!nome) return { ok: false, situacao: 'sem_nome' }
      if (nome.length > 60) return { ok: false, situacao: 'nome_longo' }
      const e = etapaPorId(Number(p_id))
      if (!e) return { ok: false, situacao: 'nao_achei' }
      if (nomeRepetido(nome, e.id)) return { ok: false, situacao: 'nome_repetido' }
      e.nome = nome
      anotar(e, 'renomear')
      return { ok: true, situacao: 'ok', id: e.id }
    },

    vessel_stylist_etapa_mover({ p_id, p_direcao } = {}) {
      if (!['subir', 'descer'].includes(p_direcao)) return { ok: false, situacao: 'direcao_invalida' }
      renumerar()
      const e = etapaPorId(Number(p_id))
      if (!e) return { ok: false, situacao: 'nao_achei' }
      const viz = etapasAtivas().find((x) => x.ordem === e.ordem + (p_direcao === 'subir' ? -1 : 1))
      if (!viz) return { ok: false, situacao: 'no_limite' }
      ;[e.ordem, viz.ordem] = [viz.ordem, e.ordem]
      anotar(e, 'reordenar')
      return { ok: true, situacao: 'ok', id: e.id }
    },

    vessel_stylist_etapa_tipo({ p_id, p_tipo } = {}) {
      const tipo = String(p_tipo ?? '').trim().toLowerCase()
      if (!['funil', 'saida'].includes(tipo)) return { ok: false, situacao: 'tipo_invalido' }
      const e = etapaPorId(Number(p_id))
      if (!e) return { ok: false, situacao: 'nao_achei' }
      if (e.tipo === tipo) return { ok: true, situacao: 'sem_mudanca', id: e.id }
      if (tipo === 'saida') {
        if (e.conta_como_prospectada) return { ok: false, situacao: 'etapa_marcada' }
        if (etapasAtivas().filter((x) => x.tipo === 'funil').length <= 1) return { ok: false, situacao: 'ultima_do_funil' }
      }
      e.tipo = tipo
      anotar(e, 'tipo')
      return { ok: true, situacao: 'ok', id: e.id }
    },

    vessel_stylist_etapa_marcar_prospectada({ p_id } = {}) {
      const e = etapaPorId(Number(p_id))
      if (!e) return { ok: false, situacao: 'nao_achei' }
      if (e.tipo !== 'funil') return { ok: false, situacao: 'saida_nao_conta' }
      if (e.conta_como_prospectada) return { ok: true, situacao: 'sem_mudanca', id: e.id }
      // ⚠️ AS DATAS JÁ GRAVADAS NÃO MUDAM: a marca só vale para quem chegar depois.
      for (const x of b.etapas) x.conta_como_prospectada = false
      e.conta_como_prospectada = true
      anotar(e, 'marcar_prospectada')
      return { ok: true, situacao: 'ok', id: e.id }
    },

    vessel_stylist_etapa_excluir({ p_id, p_destino = null, p_motivo_id = null, p_nota = null } = {}) {
      const e = etapaPorId(Number(p_id))
      if (!e) return { ok: false, situacao: 'nao_achei' }
      if (e.tipo === 'funil' && etapasAtivas().filter((x) => x.tipo === 'funil').length <= 1) return { ok: false, situacao: 'ultima_do_funil' }
      if (e.conta_como_prospectada) return { ok: false, situacao: 'etapa_marcada' }
      const nela = b.stylists.filter((s) => s.etapa_id === e.id)
      if (nela.length) {
        if (p_destino == null) return { ok: false, situacao: 'precisa_destino', stylists: nela.length }
        const d = etapaPorId(Number(p_destino))
        if (!d || d.id === e.id) return { ok: false, situacao: 'destino_invalido' }
        const recusa = conferirMotivo(d.id, p_motivo_id, p_nota)
        if (recusa) return { ok: false, situacao: recusa, stylists: nela.length }
        for (const s of nela) mudarDeEtapa(s, d.id, 'etapa_excluida', { motivoId: p_motivo_id, nota: p_nota })
      }
      e.ativa = false
      renumerar()
      anotar(e, 'excluir')
      avisar('etapa_excluida', { id: e.id, nome: e.nome, movidas: nela.length })
      return { ok: true, situacao: 'ok', id: e.id, movidas: nela.length }
    },

    vessel_stylist_desativar({ p_codigo, p_ativa = false } = {}) {
      const codigo = maiusculo(p_codigo)
      const s = stylistPorCodigo(codigo)
      if (!s) return { ok: false, situacao: 'nao_achei' }
      s.ativa = !!p_ativa
      avisar('stylist_desativada', { codigo, ativa: s.ativa })
      return { ok: true, situacao: 'ok', codigo, ativa: s.ativa }
    },

    vessel_stylist_registrar_contato(a = {}) {
      const s = stylistPorCodigo(maiusculo(a.p_codigo))
      if (!s) return { ok: false, situacao: 'nao_achei' }
      const canal = minusculo(a.p_canal), res = minusculo(a.p_resultado), nota = limpo(a.p_nota)
      if (!canal || !CANAIS.includes(canal)) return { ok: false, situacao: 'canal_invalido' }
      if (!res || !RESULTADOS.includes(res)) return { ok: false, situacao: 'resultado_invalido' }
      if (nota && nota.length > 500) return { ok: false, situacao: 'nota_longa' }
      const id = proximo(b.contatos)
      b.contatos.push({ id, stylist_id: s.id, canal, resultado: res, nota, criado_em: agoraIso(),
        criado_por_nome: USUARIO_DA_DEMONSTRACAO })
      // A próxima ação escrita aqui SUBSTITUI a de hoje; vazia, a de hoje fica.
      if (limpo(a.p_proxima_acao)) { s.proxima_acao = String(a.p_proxima_acao).trim(); s.proxima_acao_em = a.p_proxima_acao_em || null }
      // ⚠️ SEM SUGESTÃO DE ETAPA (24/09/2026): contato não move ninguém.
      avisar('contato_registrado', { codigo: s.codigo, canal, resultado: res })
      return { ok: true, situacao: 'ok', id }
    },

    // ── escritas: o encontro ──────────────────────────────────────────────
    vessel_criar_private_edit(a = {}) {
      const s = stylistPorCodigo(maiusculo(a.p_stylist))
      if (!s) return { ok: false, situacao: 'stylist_nao_encontrada', erro: 'Não achei esta stylist. O código é o STY-0000 dela.' }
      // ⚠️ 24/09/2026: SÓ QUEM ESTÁ NUMA ETAPA QUE LIBERA PRIVATE EDIT (a Ativada).
      if (!liberada(s)) {
        const nomes = liberam()
        const etapa = etapaPorId(s.etapa_id)?.nome ?? null
        avisar('recusa_nao_liberada', { codigo: s.codigo })
        return { ok: false, situacao: 'stylist_nao_liberada', etapa, etapas_que_liberam: nomes.length ? nomes.join(', ') : null,
          erro: `Esta parceira ainda não pode receber um Private Edit: ela está em "${etapa || 'sem etapa'}". `
            + (nomes.length ? `Mova-a para ${nomes.join(', ')} no Stylist Circle antes de marcar o encontro.`
              : 'Hoje nenhuma etapa libera Private Edit — marque uma em "Etapas do funil".') }
      }
      if (!a.p_quando) return { ok: false, situacao: 'sem_data', erro: 'Escolha o dia e a hora do encontro.' }
      const quando = new Date(a.p_quando)
      if (quando.getTime() < agora().getTime() - 86400000) {
        return { ok: false, situacao: 'data_no_passado', erro: 'Esta data já passou. O convite nasceria vencido.' }
      }
      // ⚠️ 25/09/2026 (Task 9): a lista fechada virou consulta ao cadastro —
      // sigla existe e está ativa, como o banco de verdade.
      const praca = maiusculo(a.p_praca)
      if (!praca) return { ok: false, situacao: 'praca_invalida', erro: 'Escolha uma praça.' }
      const pracaObj = pracaAtivaPorSigla(praca)
      if (!pracaObj) return { ok: false, situacao: 'praca_invalida', erro: 'Esta praça não existe ou está desativada no cadastro.' }
      if (a.p_loja != null && !LOJAS.includes(a.p_loja)) return { ok: false, situacao: 'loja_invalida', erro: 'Escolha uma loja válida.' }
      const vagas = a.p_vagas == null ? null : Number(a.p_vagas)
      if (vagas == null || !Number.isFinite(vagas) || vagas < 7 || vagas > 10) {
        return { ok: false, situacao: 'vagas_invalidas', erro: 'A capacidade planejada é de 7 a 10 convidadas.' }
      }
      // ⚠️ 25/09/2026: o encontro sobreposto, só quando pedido (NULL = a Central
      // de antes, sem conferência).
      let sobrepoe = null
      if (a.p_confirmar_sobreposicao != null) {
        sobrepoe = sobrepoemCom(quando.toISOString(), lugarDoEncontro(a.p_loja, praca, a.p_local), null)
        if (!a.p_confirmar_sobreposicao && sobrepoe.length) {
          avisar('sobreposicao_avisada', { quantos: sobrepoe.length })
          return { ok: false, situacao: 'sobrepoe', sobrepoe, contexto: contextoDaLoja(quando.toISOString(), a.p_loja),
            erro: 'Já há Private Edit neste lugar neste horário. Confira e confirme para marcar mesmo assim.' }
        }
      }
      const dia = diaEmSaoPaulo(quando)
      // ⚠️ 24/09/2026 (`2026-09-24-vessel-codigo-do-encontro-sem-repetir.sql`): a
      // partir do número de sempre, o PRÓXIMO LIVRE — um encontro que mudou de
      // dia não deixa o código dele ser repetido no dia de origem.
      let seq = b.encontros.filter((e) => e.praca === praca && diaDoEncontro(e) === dia).length + 1
      const codigoDo = (n) => `PE-${dia.replace(/-/g, '')}-${praca}-${String(n).padStart(2, '0')}`
      const usado = (c) => b.encontros.some((e) => e.codigo === c) || b.atendimentos.some((t) => t.evento_codigo === c)
        || b.origens.some((o) => o.evento_id === c)
      while (usado(codigoDo(seq))) seq += 1
      const codigo = codigoDo(seq)
      const chave = sortearChave((k) => b.encontros.some((e) => e.chave === k))
      // ⚠️ RODADA 1 DE CONSERTO (praça e edição): `praca_id` grava JUNTO com
      // `praca` (o texto continua para a Central de hoje não quebrar) — é
      // este dado que faltava para o placar da edição enxergar o encontro.
      const e = { id: proximo(b.encontros), codigo, chave, stylist_id: s.id, quando: quando.toISOString(),
        local: limpo(a.p_local), praca, praca_id: pracaObj.id, loja: a.p_loja ?? null, vagas, ativa: true, arquivada: false,
        status: 'agendado', realizado_em: null, motivo: null, observacoes: null, teste: !!a.p_teste }
      b.encontros.push(e)
      gatilhoDoEncontro(null, e)
      avisar('encontro_criado', { codigo, stylist: s.codigo })
      if (a.p_confirmar_sobreposicao && sobrepoe?.length) return { ok: true, codigo, chave, sobrepoe }
      return { ok: true, codigo, chave }
    },

    vessel_private_edit_editar(a = {}) {
      const codigo = maiusculo(a.p_codigo)
      const e = encontroPorCodigo(codigo)
      if (!e) return { ok: false, situacao: 'nao_achei' }
      let stylistId = null
      if (a.p_stylist != null) {
        const s = stylistPorCodigo(a.p_stylist)
        if (!s) return { ok: false, situacao: 'stylist_nao_achei' }
        // ⚠️ 24/09/2026: TROCAR só por uma liberada; manter a de hoje passa.
        if (s.id !== e.stylist_id && !liberada(s)) {
          return { ok: false, situacao: 'stylist_nao_liberada', etapas_que_liberam: liberam().join(', ') || null }
        }
        stylistId = s.id
      }
      if (a.p_vagas != null && (Number(a.p_vagas) < 7 || Number(a.p_vagas) > 10)) return { ok: false, situacao: 'vagas_invalidas' }
      // ⚠️ 25/09/2026: só quando pedido, e só quando a hora ou o lugar mudam.
      let sobrepoe = null
      const novoQuando = a.p_quando ? new Date(a.p_quando).toISOString() : e.quando
      const novoLugar = lugarDoEncontro(a.p_loja ?? e.loja, a.p_praca ?? e.praca, a.p_local ?? e.local)
      if (a.p_confirmar_sobreposicao != null
        && (+new Date(novoQuando) !== +new Date(e.quando) || novoLugar !== lugarDoEncontro(e.loja, e.praca, e.local))) {
        sobrepoe = sobrepoemCom(novoQuando, novoLugar, codigo)
        if (!a.p_confirmar_sobreposicao && sobrepoe.length) {
          avisar('sobreposicao_avisada', { quantos: sobrepoe.length })
          return { ok: false, situacao: 'sobrepoe', codigo, sobrepoe, contexto: contextoDaLoja(novoQuando, a.p_loja ?? e.loja) }
        }
      }
      const antes = { ...e }
      Object.assign(e, {
        quando: a.p_quando ? new Date(a.p_quando).toISOString() : e.quando,
        local: a.p_local ?? e.local, praca: a.p_praca ?? e.praca, loja: a.p_loja ?? e.loja,
        vagas: a.p_vagas != null ? Number(a.p_vagas) : e.vagas, stylist_id: stylistId ?? e.stylist_id,
      })
      gatilhoDoEncontro(antes, e)
      avisar('encontro_editado', { codigo })
      if (a.p_confirmar_sobreposicao && sobrepoe?.length) return { ok: true, situacao: 'ok', codigo, sobrepoe }
      return { ok: true, situacao: 'ok', codigo }
    },

    vessel_private_edit_situacao(a = {}) {
      const codigo = maiusculo(a.p_codigo)
      const status = minusculo(a.p_status)
      const motivo = limpo(a.p_motivo)
      const e = encontroPorCodigo(codigo)
      if (!e) return { ok: false, situacao: 'nao_achei' }
      if (!status || !STATUS.includes(status)) return { ok: false, situacao: 'status_invalido' }
      if ((status === 'cancelado' || status === 'nao_realizado') && !motivo) {
        avisar('recusa_sem_motivo', { codigo, status })
        return { ok: false, situacao: 'sem_motivo' }
      }
      let data = null
      if (status === 'realizado') {
        // Sem data escrita, vale o dia marcado — é o caso comum.
        data = a.p_realizado_em || e.realizado_em || diaDoEncontro(e)
        if (data > hoje()) return { ok: false, situacao: 'realizado_no_futuro' }
      }
      const antes = { ...e }
      Object.assign(e, {
        status,
        realizado_em: status === 'realizado' ? data : null,
        motivo: ['cancelado', 'nao_realizado'].includes(status) ? motivo : null,
        // `observacoes` nula não mexe; string vazia apaga.
        observacoes: a.p_observacoes == null ? e.observacoes : limpo(a.p_observacoes),
        // ⚠️ ENCONTRO QUE ACABOU PARA DE ACEITAR RESPOSTA NO CONVITE.
        ativa: ['realizado', 'cancelado', 'nao_realizado'].includes(status) ? false : e.ativa,
      })
      gatilhoDoEncontro(antes, e)
      const s = stylistPorId(e.stylist_id)
      avisar('encontro_situacao', { codigo, status, antes: antes.status, stylist: s?.codigo })
      return { ok: true, situacao: 'ok', codigo, status, antes: antes.status }
    },

    vessel_private_edit_encerrar({ p_codigo, p_ativa = false } = {}) {
      const codigo = maiusculo(p_codigo)
      const e = encontroPorCodigo(codigo)
      if (!e) return { ok: false, erro: 'Não achei este encontro.' }
      e.ativa = !!p_ativa
      avisar('encontro_encerrado', { codigo, ativa: e.ativa })
      return { ok: true, codigo, ativa: e.ativa }
    },

    vessel_private_edit_arquivar({ p_codigo, p_arquivada = true } = {}) {
      const codigo = maiusculo(p_codigo)
      const e = encontroPorCodigo(codigo)
      if (!e) return { ok: false, situacao: 'nao_achei' }
      const antes = { ...e }
      e.arquivada = p_arquivada ?? true
      gatilhoDoEncontro(antes, e)
      avisar('encontro_arquivado', { codigo, arquivada: e.arquivada })
      return { ok: true, situacao: 'ok', codigo, arquivada: e.arquivada }
    },

    vessel_private_edit_apagar({ p_codigo } = {}) {
      const codigo = maiusculo(p_codigo)
      const e = encontroPorCodigo(codigo)
      if (!e) return { ok: false, situacao: 'nao_achei' }
      if (b.atendimentos.some((t) => t.evento_codigo === codigo)) return { ok: false, situacao: 'tem_gente' }
      b.encontros = b.encontros.filter((x) => x !== e)
      gatilhoDoEncontro(e, null)
      avisar('encontro_apagado', { codigo })
      return { ok: true, situacao: 'ok', codigo }
    },

    // ── escritas: a convidada ─────────────────────────────────────────────
    vessel_convidar_para_encontro(a = {}) {
      const e = encontroPorCodigo(maiusculo(a.p_codigo))
      if (!e || !stylistPorId(e.stylist_id)) return { ok: false, situacao: 'nao_achei' }
      if (e.arquivada || e.status === 'cancelado') return { ok: false, situacao: 'encontro_fechado' }
      if (!limpo(a.p_nome)) return { ok: false, situacao: 'sem_nome' }
      const fone = telefoneCanonico(a.p_whatsapp)
      if (!fone) return { ok: false, situacao: 'whatsapp_invalido' }
      const email = minusculo(a.p_email)
      if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { ok: false, situacao: 'email_invalido' }
      // `vessel_pessoa_por_telefone`: a mesma ficha para o mesmo telefone.
      let pessoa = b.pessoas.find((p) => p.telefone === fone)
      if (pessoa) { if (email) pessoa.email = email }
      else { pessoa = { id: proximo(b.pessoas), nome: String(a.p_nome).trim(), telefone: fone, email }; b.pessoas.push(pessoa) }
      // ⚠️ UMA CONVIDADA, UMA CADEIRA.
      const ja = b.atendimentos.filter((t) => t.pessoa_id === pessoa.id && t.evento_codigo === e.codigo).sort((x, y) => x.id - y.id)[0]
      if (ja) return { ok: true, situacao: 'ja_estava', id: ja.id }
      b.origens.push({ pessoa_id: pessoa.id, canal: 'private_edit', evento_id: e.codigo, stylist_id: stylistPorId(e.stylist_id).codigo })
      const id = proximo(b.atendimentos)
      b.atendimentos.push({ id, pessoa_id: pessoa.id, loja: e.loja, quando: e.quando, status: 'solicitado', rsvp: null,
        evento_codigo: e.codigo, convidada_em: agoraIso(), convite_enviado_em: null,
        chave_convite: sortearChave((k) => b.atendimentos.some((t) => t.chave_convite === k)),
        convite_aberto_em: null, convite_aberturas: 0, presenca_em: null, criado_em: agoraIso(), teste: false })
      avisar('convidada_incluida', { codigo: e.codigo, id, nome: pessoa.nome })
      return { ok: true, situacao: 'ok', id, pessoa_id: pessoa.id }
    },

    vessel_convite_marcar({ p_id, p_marca } = {}) {
      const marca = minusculo(p_marca)
      if (!marca || !MARCAS.includes(marca)) return { ok: false, situacao: 'marca_invalida' }
      const t = b.atendimentos.find((x) => x.id === Number(p_id) && x.evento_codigo)
      if (!t) return { ok: false, situacao: 'nao_achei' }
      if (marca === 'enviado') t.convite_enviado_em = t.convite_enviado_em || agoraIso()
      if (marca === 'sim' || marca === 'nao') t.rsvp = marca
      if (marca === 'sem_resposta') t.rsvp = null
      avisar('convite_marcado', { id: t.id, marca })
      return { ok: true, situacao: 'ok' }
    },

    vessel_situacao_do_atendimento({ p_id, p_situacao } = {}) {
      if (!p_situacao || !SITUACOES_DO_ATENDIMENTO.includes(p_situacao)) return { ok: false, situacao: 'situacao_invalida' }
      const t = b.atendimentos.find((x) => x.id === Number(p_id))
      if (!t) return { ok: false, situacao: 'nao_achei' }
      const antes = t.status
      t.status = p_situacao
      t.presenca_em = p_situacao === 'realizado' ? (t.presenca_em || agoraIso()) : null
      // ⚠️ SÓ A PRESENÇA DE CONVIDADA DE ENCONTRO AVISA O ROTEIRO (passo 8). A
      // mesma função marca a visita do Private Appointment; marcar "Veio" lá
      // não é o gesto do passo, e o roteiro não pode se marcar por ele.
      if (t.evento_codigo) avisar('presenca_marcada', { id: t.id, situacao: p_situacao })
      return { ok: true, situacao: p_situacao, antes }
    },

    // ════════════════════════════════════════════════════════════════════════
    // STYLIST CIRCLE — O SCORECARD E A NOTA DE QUALIFICAÇÃO (24/09/2026):
    // `2026-09-24-vessel-stylist-scorecard-e-qualificacao.sql`. Bloco próprio,
    // para o merge com as outras ondas da demonstração ser limpo.
    // ════════════════════════════════════════════════════════════════════════
    vessel_scorecard_da_stylist({ p_codigo, p_de = null, p_ate = null, p_dias = 14 } = {}) {
      const s = stylistPorCodigo(maiusculo(p_codigo))
      if (!s || s.teste) return { ok: false, situacao: 'nao_achei' }
      const { por_stylist: _fora, ...num } = numerosDoCircle(p_de, p_ate, p_dias, s.id)
      const ate = p_ate || '9999-12-31'
      const dela = b.encontros.filter((e) => e.stylist_id === s.id && !e.teste && !e.arquivada)
      const realizados = dela.filter((e) => e.status === 'realizado' && e.realizado_em && e.realizado_em <= ate)
      const ultimo = realizados.map((e) => e.realizado_em).sort().pop() || null
      const proximo = dela.filter((e) => ['agendado', 'confirmado', 'reagendado'].includes(e.status)
        && new Date(e.quando).getTime() >= agora().getTime())
        .sort((x, y) => (x.quando === y.quando ? x.id - y.id : (x.quando < y.quando ? -1 : 1)))[0] || null
      const contatos = b.contatos.filter((c) => c.stylist_id === s.id)
      // ⚠️ 24/09/2026: a ativação é `ativadaEm` — a mesma do placar.
      const ativou = ativadaEm(s)
      return {
        ...num, ok: true, situacao: 'ok', codigo: s.codigo, nome: s.nome, ativada_em: ativou,
        private_edit_agendado_em: s.ativada_em ?? null, ativada_por_encontro_antigo: porEncontroAntigo(s),
        realizados_desde_o_inicio: realizados.length,
        recorrente: realizados.length >= 2,
        ultimo_realizado_em: ultimo,
        dias_desde_o_ultimo: ultimo ? diasEntre(ultimo, hoje()) : null,
        proximo_encontro_em: proximo?.quando ?? null,
        proximo_encontro_codigo: proximo?.codigo ?? null,
        contatos: contatos.length,
        contatos_antes_de_ativar: ativou ? contatos.filter((c) => c.criado_em < ativou).length : null,
        contatos_sem_resposta_depois_de_ativar: ativou
          ? contatos.filter((c) => c.resultado === 'sem_resposta' && c.criado_em >= ativou).length : null,
      }
    },

    vessel_stylist_avaliar(a = {}) {
      const s = stylistPorCodigo(maiusculo(a.p_codigo))
      if (!s) return { ok: false, situacao: 'nao_achei' }
      const niveis = ['p_carteira', 'p_portfolio', 'p_mobilizacao', 'p_acesso', 'p_confiabilidade'].map((k) => a[k])
      if (niveis.some((n) => n == null || !Number.isInteger(Number(n)) || Number(n) < 1 || Number(n) > 5)) {
        return { ok: false, situacao: 'nivel_invalido' }
      }
      const obs = limpo(a.p_observacao)
      if (obs && obs.length > 280) return { ok: false, situacao: 'observacao_longa' }
      const [carteira, portfolio, mobilizacao, acesso, confiabilidade] = niveis.map(Number)
      // As colunas geradas do banco: 6·5·4·3·2 e a faixa pela mesma régua.
      const nota = 6 * carteira + 5 * portfolio + 4 * mobilizacao + 3 * acesso + 2 * confiabilidade
      const q = { id: proximo(b.qualificacoes), stylist_id: s.id, carteira, portfolio, mobilizacao, acesso, confiabilidade,
        nota, faixa: faixaDaNota(nota), observacao: obs, avaliado_em: agoraIso(), avaliado_por_nome: USUARIO_DA_DEMONSTRACAO }
      b.qualificacoes.push(q)
      avisar('stylist_avaliada', { codigo: s.codigo, nota, faixa: q.faixa })
      return { ok: true, situacao: 'ok', id: q.id, nota, faixa: q.faixa, avaliado_em: q.avaliado_em }
    },

    vessel_stylist_qualificacoes({ p_codigo } = {}) {
      const s = stylistPorCodigo(maiusculo(p_codigo))
      if (!s) return []
      return b.qualificacoes.filter((q) => q.stylist_id === s.id)
        .sort((x, y) => (x.avaliado_em === y.avaliado_em ? y.id - x.id : (x.avaliado_em < y.avaliado_em ? 1 : -1)))
        .map((q) => ({ id: q.id, carteira: q.carteira, portfolio: q.portfolio, mobilizacao: q.mobilizacao,
          acesso: q.acesso, confiabilidade: q.confiabilidade, nota: q.nota, faixa: q.faixa, observacao: q.observacao,
          avaliado_em: q.avaliado_em, avaliado_por_nome: q.avaliado_por_nome }))
    },

    vessel_qualificacoes_vigentes() {
      const saida = []
      for (const s of b.stylists.filter((x) => !x.teste)) {
        const q = b.qualificacoes.filter((x) => x.stylist_id === s.id)
          .sort((x, y) => (x.avaliado_em === y.avaliado_em ? y.id - x.id : (x.avaliado_em < y.avaliado_em ? 1 : -1)))[0]
        if (q) saida.push({ codigo: s.codigo, nota: q.nota, faixa: q.faixa, avaliado_em: q.avaliado_em })
      }
      return saida.sort((x, y) => (x.codigo < y.codigo ? -1 : 1))
    },

    // ════════════════════════════════════════════════════════════════════════
    // PRAÇA E EDIÇÃO (25/09/2026, Task 9) — `2026-09-25-vessel-praca-e-
    // edicao.sql`. A praça vira cadastro de verdade (sigla, nome, loja de
    // destino — que pode ser de OUTRA cidade — e as cidades dela), e o
    // Stylist Circle ganha EDIÇÃO: cada praça roda o programa em rodadas
    // numeradas (planejada → aberta → encerrada), e é a edição que decide
    // quem está "dentro" agora. ⚠️ Escrita NUNCA lança erro cru: devolve
    // sempre `{ok:false, situacao:'...'}` — a mesma regra das outras escritas.
    // ════════════════════════════════════════════════════════════════════════
    vessel_pracas_listar() {
      return [...b.pracas].sort((x, y) => x.ordem - y.ordem || x.id - y.id).map((p) => ({
        id: p.id, sigla: p.sigla, nome: p.nome, loja_destino: p.loja_destino ?? null,
        ativa: p.ativa !== false,
        cidades: b.pracaCidades.filter((c) => c.praca_id === p.id)
          .sort((x, y) => x.cidade.localeCompare(y.cidade, 'pt-BR'))
          .map((c) => ({ id: c.id, cidade: c.cidade })),
        stylists: b.stylists.filter((s) => s.praca_id === p.id && !s.teste).length,
      }))
    },

    vessel_praca_criar({ p_sigla, p_nome, p_loja_destino } = {}) {
      const sigla = maiusculo(p_sigla), nome = limpo(p_nome), loja = limpo(p_loja_destino)
      if (!nome) return { ok: false, situacao: 'sem_nome' }
      if (!sigla || !/^[A-Z]{3}$/.test(sigla)) return { ok: false, situacao: 'sigla_invalida' }
      // ⚠️ É ESTA CONFERÊNCIA QUE PROTEGE A `unique` DA TABELA (a mesma razão
      // do banco de verdade): sem ela o defeito viraria erro cru, não `situacao`.
      if (b.pracas.some((p) => p.sigla === sigla)) return { ok: false, situacao: 'sigla_repetida' }
      const ordem = Math.max(0, ...b.pracas.map((p) => p.ordem)) + 1
      const id = proximo(b.pracas)
      b.pracas.push({ id, sigla, nome, loja_destino: loja, ordem, ativa: true })
      return { ok: true, situacao: 'ok', id }
    },

    // editar nome, loja de destino e ativa — sigla é imutável (não entra aqui)
    vessel_praca_editar({ p_id, p_nome, p_loja_destino, p_ativa } = {}) {
      const p = pracaPorId(p_id)
      if (!p) return { ok: false, situacao: 'nao_achei' }
      const nome = limpo(p_nome)
      if (!nome) return { ok: false, situacao: 'sem_nome' }
      const loja = limpo(p_loja_destino)
      // ⚠️ `loja_destino` e `ativa` usam a MESMA semântica de nulo — PRESERVA
      // o que já estava (um salvamento parcial não pode apagar a loja sem
      // querer). Limpar a loja é outra ação, que ainda não existe.
      p.nome = nome
      p.loja_destino = loja ?? p.loja_destino
      p.ativa = p_ativa ?? p.ativa
      return { ok: true, situacao: 'ok' }
    },

    // vincular uma cidade a uma praça — a chave SEMPRE por achatarCidade
    vessel_praca_cidade_vincular({ p_praca_id, p_cidade } = {}) {
      const p = pracaPorId(p_praca_id)
      if (!p) return { ok: false, situacao: 'praca_invalida' }
      const cidade = limpo(p_cidade)
      if (!cidade) return { ok: false, situacao: 'sem_cidade' }
      const chave = achatarCidade(cidade)
      if (!chave) return { ok: false, situacao: 'sem_cidade' }
      const dono = b.pracaCidades.find((c) => c.cidade_chave === chave)
      if (dono && dono.praca_id !== p.id) {
        const donoPraca = pracaPorId(dono.praca_id)
        return { ok: false, situacao: 'cidade_em_outra_praca', praca_id: dono.praca_id, praca_nome: donoPraca?.nome ?? null }
      }
      let id, situacao
      if (dono) {
        id = dono.id; situacao = 'ja_vinculada'
      } else {
        id = proximo(b.pracaCidades)
        b.pracaCidades.push({ id, praca_id: p.id, cidade, cidade_chave: chave })
        situacao = 'ok'
      }
      // ⚠️ REVISÃO FINAL (IMPORTANTE 6): A ADOÇÃO. Vincular a cidade passa a
      // mover as stylists DAQUELA CIDADE que estão SEM PRAÇA — sem isso a
      // pendência "N stylists sem praça" da barra não se resolvia por tela
      // nenhuma. Ninguém TROCA de praça por aqui; só quem está sem. Rodar de
      // novo com a cidade já vinculada também adota, de propósito.
      // ⚠️ TASK 3: a adoção NÃO vincula mais a nenhuma edição — ganhar praça
      // não é o mesmo que ser convidada a um evento.
      let adotadas = 0
      for (const st of b.stylists) {
        if (st.praca_id != null || st.teste) continue
        if (achatarCidade(st.cidade) !== chave) continue
        st.praca_id = p.id
        adotadas++
      }
      return { ok: true, situacao, id, adotadas }
    },

    vessel_praca_cidade_desvincular({ p_id } = {}) {
      const c = b.pracaCidades.find((x) => x.id === Number(p_id))
      if (!c) return { ok: false, situacao: 'nao_achei' }
      b.pracaCidades = b.pracaCidades.filter((x) => x !== c)
      return { ok: true, situacao: 'ok' }
    },

    // definir (ou tirar, com p_praca_id nulo) a praça de uma stylist na mão
    vessel_stylist_definir_praca({ p_codigo, p_praca_id } = {}) {
      const s = stylistPorCodigo(maiusculo(p_codigo))
      if (!s) return { ok: false, situacao: 'nao_achei' }
      if (p_praca_id != null && !pracaPorId(p_praca_id)) return { ok: false, situacao: 'praca_invalida' }
      // ⚠️ TASK 3: idem vessel_stylist_editar — mudar (ou tirar) a praça não
      // mexe na turma de evento nenhuma.
      s.praca_id = p_praca_id == null ? null : Number(p_praca_id)
      return { ok: true, situacao: 'ok', codigo: s.codigo }
    },

    // as edições de uma praça (ou de todas, com p_praca_id nulo). ⚠️ TASK 3:
    // `stylists` conta TODAS as linhas da turma (sem `teste`, só `ativa` —
    // `saiu_em` não recorta mais nada, ninguém fecha vínculo) e ganha
    // `indisponiveis`. `nao_ativadas` fica (a tela antiga lê), sem uso no
    // encerrar novo — MESMO critério de antes (`saiu_em` nulo, sem filtrar `ativa`).
    vessel_edicoes_listar({ p_praca_id } = {}) {
      return b.edicoes.filter((e) => p_praca_id == null || e.praca_id === Number(p_praca_id))
        .map((e) => {
          const p = pracaPorId(e.praca_id)
          const membros = b.naEdicao.filter((n) => n.edicao_id === e.id)
          const stylistsQtd = membros.filter((n) => {
            const s = stylistPorId(n.stylist_id)
            return !!s && !s.teste && s.ativa !== false
          }).length
          const indisponiveis = membros.filter((n) => {
            if (!n.indisponivel_em) return false
            const s = stylistPorId(n.stylist_id)
            return !!s && !s.teste && s.ativa !== false
          }).length
          const naoAtivadas = membros.filter((n) => {
            if (n.saiu_em) return false
            const s = stylistPorId(n.stylist_id)
            return !!s && !s.teste && !ativadaEm(s)
          }).length
          return { id: e.id, praca_id: e.praca_id, praca_nome: p?.nome ?? null, numero: e.numero,
            nome: e.nome ?? null, comeca_em: e.comeca_em, termina_em: e.termina_em ?? null, situacao: e.situacao,
            stylists: stylistsQtd, indisponiveis, nao_ativadas: naoAtivadas }
        })
        .sort((a, c) => {
          const oa = pracaPorId(a.praca_id)?.ordem ?? 0, oc = pracaPorId(c.praca_id)?.ordem ?? 0
          return oa - oc || c.numero - a.numero
        })
    },

    // criar a próxima edição da praça — numero = maior da praça + 1. A
    // edição é um evento de UM DIA: `p_termina_em` fica na assinatura (a tela
    // antiga ainda manda) e é IGNORADO — grava sempre nulo.
    vessel_edicao_criar({ p_praca_id, p_nome, p_comeca_em } = {}) {
      const p = pracaPorId(p_praca_id)
      if (!p) return { ok: false, situacao: 'praca_invalida' }
      const nome = limpo(p_nome)
      if (!p_comeca_em) return { ok: false, situacao: 'sem_data' }
      const numero = Math.max(0, ...b.edicoes.filter((e) => e.praca_id === p.id).map((e) => e.numero)) + 1
      const id = proximo(b.edicoes)
      b.edicoes.push({ id, praca_id: p.id, numero, nome, comeca_em: p_comeca_em, termina_em: null, situacao: 'planejada' })
      return { ok: true, situacao: 'ok', id, numero }
    },

    // abrir uma edição — só uma aberta por praça, encerrada não reabre. ⚠️
    // TASK 3: NÃO PUXA MAIS A PRAÇA — a turma se forma pelos convites
    // (`vesselEdicaoMarcarMovimento`). Só traz de volta, para Convidado, quem
    // está numa saída cujo motivo é `volta_na_proxima_edicao` (ativa,
    // não-teste, da mesma praça) — a nota do histórico diz de onde ela voltou.
    vessel_edicao_abrir({ p_id } = {}) {
      const e = edicaoPorId(p_id)
      if (!e) return { ok: false, situacao: 'nao_achei' }
      if (e.situacao === 'encerrada') return { ok: false, situacao: 'edicao_encerrada' }
      if (e.situacao === 'aberta') return { ok: true, situacao: 'sem_mudanca', voltaram: 0 }
      if (b.edicoes.some((x) => x.praca_id === e.praca_id && x.situacao === 'aberta' && x.id !== e.id)) {
        return { ok: false, situacao: 'ja_tem_aberta' }
      }
      e.situacao = 'aberta'
      const conv = etapaAtivaPorNomeETipo('convidado', 'funil')
      let voltaram = 0
      if (conv) {
        const candidatas = b.stylists.filter((s) => {
          if (s.praca_id !== e.praca_id || s.teste || s.ativa === false) return false
          const et = etapaPorId(s.etapa_id)
          if (!et || et.tipo !== 'saida') return false
          const h = saidaAtual(s)
          const m = h ? b.motivos.find((x) => x.id === h.motivo_id && x.etapa_id === s.etapa_id) : null
          return !!m?.volta_na_proxima_edicao
        }).sort((x, y) => x.id - y.id)
        for (const s of candidatas) {
          const onde = rotuloDeOndeFicouIndisponivel(s, e)
          mudarDeEtapa(s, conv.id, 'mudanca', null, onde ? `Voltou: indisponível na ${onde}` : 'Voltou: indisponível na data')
          vesselEdicaoMarcarMovimento(s.id, conv, null)
          voltaram++
        }
      }
      return { ok: true, situacao: 'ok', voltaram }
    },

    // encerrar: só para de aceitar convidadas. O placar segue somando para
    // sempre; não há mais "levar para a próxima" (a turma é de quem foi
    // convidada) — `p_levar_para` não nulo é sempre recusado.
    vessel_edicao_encerrar({ p_id, p_levar_para } = {}) {
      if (p_levar_para != null) return { ok: false, situacao: 'levar_para_nao_existe_mais' }
      const e = edicaoPorId(p_id)
      if (!e) return { ok: false, situacao: 'nao_achei' }
      if (e.situacao === 'encerrada') return { ok: false, situacao: 'edicao_encerrada' }
      e.situacao = 'encerrada'
      return { ok: true, situacao: 'ok' }
    },

    // incluir (exceções, botão "Incluir"): igual a antes, e grava `convidada_em`.
    vessel_edicao_incluir_stylist({ p_codigo, p_edicao_id } = {}) {
      const s = stylistPorCodigo(maiusculo(p_codigo))
      if (!s) return { ok: false, situacao: 'nao_achei' }
      const e = edicaoPorId(p_edicao_id)
      if (!e) return { ok: false, situacao: 'edicao_invalida' }
      // ⚠️ edição encerrada não aceita convidada nova.
      if (e.situacao === 'encerrada') return { ok: false, situacao: 'edicao_encerrada' }
      if (b.naEdicao.some((n) => n.stylist_id === s.id && n.edicao_id === e.id && !n.saiu_em)) {
        return { ok: true, situacao: 'sem_mudanca' }
      }
      // uma linha antiga com `saiu_em` é reaberta em vez de duplicar.
      const fechado = b.naEdicao.find((n) => n.stylist_id === s.id && n.edicao_id === e.id)
      if (fechado) {
        fechado.saiu_em = null
        fechado.etapa_ao_sair = null
        fechado.convidada_em = fechado.convidada_em ?? agoraIso()
        return { ok: true, situacao: 'ok' }
      }
      b.naEdicao.push({ id: proximo(b.naEdicao), stylist_id: s.id, edicao_id: e.id, entrou_em: agoraIso(),
        saiu_em: null, etapa_ao_sair: null,
        convidada_em: agoraIso(), confirmou_em: null, presente_em: null, indisponivel_em: null })
      return { ok: true, situacao: 'ok' }
    },

    // tirar (botão "Tirar", engano de inclusão): só enquanto ela não esteve
    // presente — presença é fato do evento e não se desfaz.
    vessel_edicao_tirar_stylist({ p_codigo, p_edicao_id } = {}) {
      const s = stylistPorCodigo(maiusculo(p_codigo))
      if (!s) return { ok: false, situacao: 'nao_achei' }
      if (!edicaoPorId(p_edicao_id)) return { ok: false, situacao: 'edicao_invalida' }
      const linha = b.naEdicao.find((n) => n.stylist_id === s.id && n.edicao_id === Number(p_edicao_id))
      if (!linha) return { ok: true, situacao: 'sem_mudanca' }
      if (linha.presente_em) return { ok: false, situacao: 'ja_esteve_presente' }
      b.naEdicao = b.naEdicao.filter((n) => n !== linha)
      return { ok: true, situacao: 'ok' }
    },

    // a turma do evento, com as marcas e a origem de cada uma (tela de
    // Edições). Mesmo recorte do placar: sem `teste`, só `ativa`.
    vessel_edicao_turma({ p_edicao_id } = {}) {
      return b.naEdicao.filter((n) => n.edicao_id === Number(p_edicao_id))
        .map((n) => {
          const s = stylistPorId(n.stylist_id)
          return s && !s.teste && s.ativa !== false ? { s, n } : null
        })
        .filter(Boolean)
        .map(({ s, n }) => ({
          stylist_id: s.id, codigo: s.codigo, nome: s.nome, etapa_id: s.etapa_id,
          convidada_em: n.convidada_em ?? null, confirmou_em: n.confirmou_em ?? null,
          presente_em: n.presente_em ?? null, indisponivel_em: n.indisponivel_em ?? null,
          origem: eventoDeOrigemDoStylist(s.id),
        }))
        .sort((a, c) => {
          if (a.convidada_em == null || c.convidada_em == null) return (a.convidada_em == null) - (c.convidada_em == null) || (a.nome < c.nome ? -1 : 1)
          return a.convidada_em === c.convidada_em ? (a.nome < c.nome ? -1 : 1) : (a.convidada_em < c.convidada_em ? -1 : 1)
        })
    },

    // o EVENTO DE ORIGEM — a edição da 1ª presença — e a mesma regra para
    // todas as stylists de uma vez. Importa `eventoDeOrigem` de
    // `edicao-regras.js`: NUNCA uma cópia da conta.
    vessel_evento_de_origem({ p_stylist_id } = {}) {
      return eventoDeOrigemDoStylist(Number(p_stylist_id))
    },
    vessel_eventos_de_origem() {
      const ids = [...new Set(b.naEdicao.filter((n) => n.presente_em).map((n) => n.stylist_id))].sort((a, c) => a - c)
      // + `codigo` (Task 4): as telas casam a origem pelo CÓDIGO da stylist.
      return ids.map((id) => ({ stylist_id: id, codigo: stylistPorId(id)?.codigo ?? null, edicao_id: eventoDeOrigemDoStylist(id) }))
    },

    // O PLACAR DO EVENTO. `funil`/`indisponiveis`/`meta` saem de
    // `funilDoEvento` (edicao-regras.js) sobre `vessel_edicao_turma` — a MESMA
    // regra pura do placar de verdade, nunca uma cópia. O resto (convite dos
    // Private Edits) só conta quem tem EVENTO DE ORIGEM aqui — nada conta duas
    // vezes. SEM RECEITA NENHUMA (decisão do dono).
    vessel_placar_da_edicao({ p_edicao_id } = {}) {
      const e = edicaoPorId(p_edicao_id)
      if (!e) throw erroDoBanco('P0002', 'edicao nao encontrada')
      const turma = funcoes.vessel_edicao_turma({ p_edicao_id: e.id })
      const turmaIds = new Set(turma.map((t) => t.stylist_id))
      const daquiIds = new Set(turma.filter((t) => t.presente_em && t.origem === e.id).map((t) => t.stylist_id))
      const sty = turma.map((t) => stylistPorId(t.stylist_id)).filter(Boolean).map((s) => ({ ...s, ativou: ativadaEm(s) }))
      const encontrosDaTurma = b.encontros.filter((x) => !x.teste && !x.arquivada && turmaIds.has(x.stylist_id))
      const doEvento = funilDoEvento(turma, encontrosDaTurma, e.id)

      // ⚠️ DAQUI: os Private Edits (e os convites deles) das stylists cujo
      // EVENTO DE ORIGEM é ESTA edição, em qualquer data e praça.
      const ev = b.encontros.filter((x) => !x.teste && !x.arquivada && daquiIds.has(x.stylist_id))
      const conv = b.atendimentos.filter((t) => !t.teste && ev.some((x) => x.codigo === t.evento_codigo))
        .map((t) => {
          const ev1 = ev.find((x) => x.codigo === t.evento_codigo)
          return { ...t, status_do_encontro: ev1.status, situacao: situacaoDe(t, ev1) }
        })
      const realizados = []
      for (const stylistId of daquiIds) {
        const dela = ev.filter((x) => x.stylist_id === stylistId && x.status === 'realizado')
          .sort((x, y) => (x.realizado_em === y.realizado_em ? x.id - y.id : (x.realizado_em < y.realizado_em ? -1 : 1)))
        dela.forEach((x, i) => realizados.push({ stylist_id: stylistId, realizado_em: x.realizado_em, n: i + 1,
          intervalo: i ? diasEntre(dela[i - 1].realizado_em, x.realizado_em) : null }))
      }
      const turmaCalc = sty.map((s) => ({
        id: s.id, ativou: !!s.ativou,
        agendou: ev.some((x) => x.stylist_id === s.id && x.status !== 'em_planejamento'),
        realizou: realizados.some((r) => r.stylist_id === s.id && r.n === 1),
      }))
      const confirmada = (c) => ['confirmada', 'presente', 'nao_compareceu'].includes(c.situacao)
      const intervalosValidos = realizados.filter((r) => r.intervalo != null)
      const ativadasDaTurma = sty.filter((s) => s.ativou)
      return {
        edicao: { id: e.id, praca_id: e.praca_id, numero: e.numero, nome: e.nome ?? null,
          comeca_em: e.comeca_em, termina_em: e.termina_em ?? null, situacao: e.situacao },
        funil: doEvento.passos,
        indisponiveis: doEvento.indisponiveis,
        meta: doEvento.meta,
        etapas: etapasAtivas().map((et) => ({ id: et.id, nome: et.nome, ordem: et.ordem, tipo: et.tipo,
          stylists: sty.filter((s) => s.etapa_id === et.id).length })),
        prospectadas: sty.length,
        prospectadas_ja_ativadas: turmaCalc.filter((t) => t.ativou).length,
        ativadas: turmaCalc.filter((t) => t.ativou).length,
        com_private_edit_agendado: turmaCalc.filter((t) => t.agendou).length,
        com_private_edit_realizado: turmaCalc.filter((t) => t.realizou).length,
        recorrentes_no_periodo: realizados.filter((r) => r.n === 2).length,
        encontros_agendados: ev.filter((x) => x.status !== 'em_planejamento').length,
        encontros_realizados: ev.filter((x) => x.status === 'realizado').length,
        encontros_cancelados: ev.filter((x) => ['cancelado', 'nao_realizado'].includes(x.status)).length,
        convidadas: conv.length,
        confirmadas: conv.filter(confirmada).length,
        confirmadas_em_realizados: conv.filter((c) => confirmada(c) && c.status_do_encontro === 'realizado').length,
        presentes: conv.filter((c) => c.status === 'realizado').length,
        presentes_em_realizados: conv.filter((c) => c.status === 'realizado' && c.status_do_encontro === 'realizado').length,
        intervalos: intervalosValidos.length,
        intervalo_medio_em_dias: media1(intervalosValidos.map((r) => r.intervalo)),
        contatos_ate_ativar: media1(ativadasDaTurma.map((s) =>
          b.contatos.filter((c) => c.stylist_id === s.id && c.criado_em < s.ativou).length)),
        stylists_com_contatos_ate_ativar: ativadasDaTurma.length,
      }
    },

    // ════════════════════════════════════════════════════════════════════════
    // BEAUTY SESSIONS — `2026-09-19-vessel-beauty-sessions-lista-devolve-
    // arquivada.sql` (a conta), `2026-09-21-vessel-criar-exige-editar.sql`
    // (criar), `2026-09-19-vessel-encerrar-exige-editar.sql` (encerrar) e
    // `2026-09-19-vessel-beauty-session-mexer.sql` (editar, apagar, arquivar).
    // ⚠️ As recusas têm o formato de cada função: criar e encerrar devolvem
    // `erro` (frase pronta); editar, apagar e arquivar devolvem `situacao`.
    // ════════════════════════════════════════════════════════════════════════
    vessel_conta_das_beauty_sessions({ p_dias = 7, p_incluir_arquivadas = false } = {}) {
      const dias = Math.max(Number(p_dias ?? 7) || 0, 0)
      const incluir = p_incluir_arquivadas ?? false
      const valendo = (t) => !t.teste
      return b.sessoes
        .filter((s) => incluir || !s.arquivada)
        .map((s) => {
          const gente = new Set(b.origens.filter((o) => o.evento_id === s.codigo).map((o) => o.pessoa_id))
          // ⚠️ 24/09/2026: `pessoas` sem a ficha de teste, e as duas portas —
          // da equipe é quem tem a linha em `cadastros`, o resto é QR.
          const semTeste = [...gente].filter((id) => !pessoaPorId(id)?.teste)
          const daEquipe = semTeste.filter((id) => (b.cadastros || []).some((c) => c.codigo === s.codigo && c.pessoa_id === id))
          const dela = b.atendimentos.filter((t) => valendo(t) && gente.has(t.pessoa_id))
          const leituras = b.leiturasDasSessoes[s.codigo] || {}
          // ⚠️ COMO O SQL: a receita NÃO filtra `situacao_id` (a de lá também
          // não) — soma o pedido da pessoa da sessão que caiu na janela de uma
          // visita REALIZADA dela.
          const receita = b.pedidos.filter((p) => gente.has(p.pessoa_id) && b.atendimentos.some((t) => {
            if (t.pessoa_id !== p.pessoa_id || t.teste || t.status !== 'realizado') return false
            const d0 = diaEmSaoPaulo(t.quando || t.criado_em)
            return p.data_do_pedido >= d0 && p.data_do_pedido <= somarDias(d0, dias)
          })).reduce((a, p) => a + Number(p.receita_liquida ?? p.total_corrigido ?? 0), 0)
          return {
            codigo: s.codigo, quando: s.quando, praca: s.praca, loja: s.loja, parceiro: s.parceiro,
            ativa: s.ativa, arquivada: !!s.arquivada,
            leituras_mesa: Number(leituras.mesa || 0),
            leituras_cartao: Number(leituras.cartao || 0),
            pessoas: semTeste.length,
            pessoas_qr: semTeste.length - daEquipe.length,
            pessoas_equipe: daEquipe.length,
            pedidos: dela.length,
            confirmados: dela.filter((t) => ['confirmado', 'realizado', 'no_show'].includes(t.status)).length,
            compareceram: dela.filter((t) => t.status === 'realizado').length,
            receita,
            janela_de_venda_em_dias: dias,
          }
        })
        // `order by linha ->> 'quando' desc`: texto, e o nulo vem primeiro.
        .sort((x, y) => {
          if (x.quando === y.quando) return 0
          if (x.quando == null) return -1
          if (y.quando == null) return 1
          return x.quando < y.quando ? 1 : -1
        })
    },

    vessel_beauty_session_criar({ p_codigo, p_quando, p_praca, p_loja, p_parceiro = null } = {}) {
      const codigo = maiusculo(p_codigo)
      const praca = maiusculo(p_praca)
      if (!codigo || !/^BS-\d{8}-[A-Z]{3}-[A-Z0-9]{1,4}$/.test(codigo)) {
        return { ok: false, erro: 'O código precisa ter o formato BS-AAAAMMDD-PRACA-NUMERO, como BS-20260925-CPS-01.' }
      }
      if (!p_quando) return { ok: false, erro: 'Escolha a data da sessão.' }
      const quando = String(p_quando).slice(0, 10)
      const dataDoCodigo = codigo.slice(3, 11)
      if (dataDoCodigo !== quando.replace(/-/g, '')) {
        return { ok: false, erro: `A data do código (${dataDoCodigo}) não é a data da sessão (${quando.replace(/-/g, '')}). Uma das duas está errada.` }
      }
      if (!praca || !/^[A-Z]{3}$/.test(praca)) return { ok: false, erro: 'A praça tem três letras, como CPS.' }
      if (codigo.slice(12, 15) !== praca) return { ok: false, erro: 'A praça do código não é a praça escolhida.' }
      if (!p_loja || !LOJAS.includes(p_loja)) return { ok: false, erro: 'Escolha a loja.' }
      if (b.sessoes.some((s) => s.codigo === codigo)) {
        return { ok: false, erro: 'Já existe uma sessão com este código. Código não se reaproveita: a leitura '
          + 'de dois eventos diferentes cairia na mesma linha do painel.' }
      }
      b.sessoes.push({ codigo, quando, praca, loja: p_loja, parceiro: limpo(p_parceiro), ativa: true, arquivada: false, criado_em: agoraIso() })
      return { ok: true, codigo }
    },

    vessel_beauty_session_encerrar({ p_codigo, p_ativa = false } = {}) {
      const codigo = maiusculo(p_codigo)
      const s = b.sessoes.find((x) => x.codigo === codigo)
      if (!s) return { ok: false, erro: 'Não achei esta sessão.' }
      s.ativa = p_ativa ?? false
      return { ok: true, codigo, ativa: s.ativa }
    },

    vessel_beauty_session_editar({ p_codigo, p_quando = null, p_loja = null } = {}) {
      const codigo = maiusculo(p_codigo)
      const s = b.sessoes.find((x) => x.codigo === codigo)
      if (!s) return { ok: false, situacao: 'nao_achei' }
      // Campo nulo = "não mexe neste". (A coluna `loja` do banco não tem CHECK
      // de lista: o que a tela manda é sempre uma das três do `<select>`.)
      if (p_quando) s.quando = String(p_quando).slice(0, 10)
      if (p_loja) s.loja = p_loja
      return { ok: true, situacao: 'ok', codigo }
    },

    vessel_beauty_session_apagar({ p_codigo } = {}) {
      const codigo = maiusculo(p_codigo)
      if (!b.sessoes.some((x) => x.codigo === codigo)) return { ok: false, situacao: 'nao_achei' }
      // ⚠️ "TER GENTE" É LEITURA DO QR, DE QUALQUER PEÇA.
      const l = b.leiturasDasSessoes[codigo] || {}
      if (Number(l.mesa || 0) + Number(l.cartao || 0) > 0) return { ok: false, situacao: 'tem_gente' }
      // ⚠️ 24/09/2026: e sessão com lead identificada também não (`tem_leads`).
      if (b.origens.some((o) => o.evento_id === codigo)) return { ok: false, situacao: 'tem_leads' }
      b.sessoes = b.sessoes.filter((x) => x.codigo !== codigo)
      return { ok: true, situacao: 'ok', codigo }
    },

    // ── `2026-09-24-beauty-session-cadastro-pela-equipe.sql` ─────────────────
    // A equipe cadastra a lead dentro da sessão, pelo mesmo miolo do QR. A
    // MESMA ordem de conferência e as MESMAS situações da função de verdade.
    vessel_beauty_session_cadastrar_lead({ p_codigo, p_nome, p_whatsapp, p_instagram = null, p_interesse = null, p_email = null } = {}) {
      const s = b.sessoes.find((x) => x.codigo === maiusculo(p_codigo))
      if (!s) return { ok: false, situacao: 'nao_achei' }
      if (s.arquivada) return { ok: false, situacao: 'sessao_arquivada' }
      const nome = String(p_nome ?? '').trim().replace(/\s+/g, ' ')
      if (nome.length < 2) return { ok: false, situacao: 'sem_nome' }
      const fone = telefoneCanonico(p_whatsapp)
      if (!fone) return { ok: false, situacao: 'whatsapp_invalido' }
      // `2026-09-28-zzzz-...-email-obrigatorio-no-banco.sql`: vazio ou inválido
      // recusa — a mesma regra de `vessel_email_canonico`.
      const email = emailCanonico(p_email)
      if (!email) return { ok: false, situacao: 'email_invalido' }
      const insta = limpo(p_instagram)
      if (insta && insta.length > 120) return { ok: false, situacao: 'instagram_longo' }
      const interesse = limpo(p_interesse)
      if (interesse && !['conhecer-a-loja', 'rever-uma-peca', 'personal-atelier'].includes(interesse)) {
        return { ok: false, situacao: 'interesse_invalido' }
      }
      let pessoa = b.pessoas.find((p) => p.telefone === fone)
      const naBase = !!pessoa
      if (pessoa && b.origens.some((o) => o.pessoa_id === pessoa.id && o.evento_id === s.codigo)) {
        // O e-mail novo entra mesmo assim, se a ficha não tinha: é o que a leva ao RD.
        if (email && !limpo(pessoa.email)) pessoa.email = email
        const porta = (b.cadastros || []).some((c) => c.codigo === s.codigo && c.pessoa_id === pessoa.id) ? 'equipe' : 'qr'
        return { ok: false, situacao: 'ja_estava', porta, pessoa_id: pessoa.id, nome: pessoa.nome }
      }
      // `vessel_anotar_interesse`: a ficha (só completa), a origem, o pedido de
      // visita (janela de 30 min), e as permissões — que aqui não se guardam.
      if (!pessoa) { pessoa = { id: proximo(b.pessoas), nome, telefone: fone, email, instagram: insta }; b.pessoas.push(pessoa) }
      else {
        if (insta) pessoa.instagram = insta
        if (email && !limpo(pessoa.email)) pessoa.email = email
      }
      b.origens.push({ pessoa_id: pessoa.id, momento: agoraIso(), canal: 'beauty_session', evento_id: s.codigo,
        stylist_id: null, utm_source: 'beauty_session', utm_medium: 'offline_equipe',
        utm_campaign: s.codigo.toLowerCase().replace(/-/g, '_') })
      const meiaHora = agora().getTime() - 30 * 60000
      let t = b.atendimentos.find((x) => x.pessoa_id === pessoa.id && x.loja === s.loja && x.status === 'solicitado'
        && new Date(x.criado_em).getTime() > meiaHora)
      if (t) { if (interesse) t.interesse = interesse }
      else {
        t = { id: proximo(b.atendimentos), pessoa_id: pessoa.id, loja: s.loja, client_advisor: null, quando: null,
          status: 'solicitado', rsvp: null, evento_codigo: null, convite_codigo: null, convidada_em: null,
          convite_enviado_em: null, chave_convite: null, convite_aberto_em: null, convite_aberturas: 0,
          presenca_em: null, criado_em: agoraIso(), teste: false, interesse, origem_registro: 'beauty-session-equipe' }
        b.atendimentos.push(t)
      }
      if (!b.cadastros) b.cadastros = []
      b.cadastros.push({ codigo: s.codigo, pessoa_id: pessoa.id, atendimento_id: t.id,
        cadastrado_por_nome: USUARIO_DA_DEMONSTRACAO, criado_em: agoraIso() })
      avisar('lead_cadastrada', { codigo: s.codigo, nome: pessoa.nome })
      return { ok: true, situacao: 'ok', pessoa_id: pessoa.id, atendimento_id: t.id, ja_na_base: naBase, nome: pessoa.nome }
    },

    vessel_leads_da_beauty_session({ p_codigo, p_dias = 7 } = {}) {
      const codigo = maiusculo(p_codigo)
      const dias = Math.max(Number(p_dias ?? 7) || 0, 0)
      const primeira = new Map()
      for (const o of b.origens) {
        if (o.evento_id !== codigo) continue
        const m = o.momento ?? null
        if (!primeira.has(o.pessoa_id) || (m && (!primeira.get(o.pessoa_id) || m < primeira.get(o.pessoa_id)))) primeira.set(o.pessoa_id, m)
      }
      const realizadas = (id) => b.atendimentos.filter((t) => t.pessoa_id === id && !t.teste && t.status === 'realizado')
      return [...primeira.entries()]
        .map(([id, entrou]) => ({ pe: pessoaPorId(id), entrou }))
        .filter(({ pe }) => pe && !pe.teste)
        .map(({ pe, entrou }) => {
          const c = (b.cadastros || []).find((x) => x.codigo === codigo && x.pessoa_id === pe.id)
          return {
            pessoa_id: pe.id, nome: pe.nome, telefone: pe.telefone, instagram: pe.instagram ?? null,
            porta: c ? 'equipe' : 'qr', entrou_em: entrou, cadastrado_por_nome: c?.cadastrado_por_nome ?? null,
            foi_a_loja: realizadas(pe.id).length > 0,
            comprou: b.pedidos.some((p) => p.pessoa_id === pe.id && realizadas(pe.id).some((t) => {
              const d0 = diaEmSaoPaulo(t.quando || t.criado_em)
              return p.data_do_pedido >= d0 && p.data_do_pedido <= somarDias(d0, dias)
            })),
          }
        })
        // `order by entrou_em desc, pessoa_id desc`
        .sort((x, y) => (x.entrou_em === y.entrou_em ? y.pessoa_id - x.pessoa_id
          : String(y.entrou_em ?? '') < String(x.entrou_em ?? '') ? -1 : 1))
    },

    vessel_beauty_session_arquivar({ p_codigo, p_arquivada = true } = {}) {
      const codigo = maiusculo(p_codigo)
      const s = b.sessoes.find((x) => x.codigo === codigo)
      if (!s) return { ok: false, situacao: 'nao_achei' }
      // ⚠️ ARQUIVAR NÃO É ENCERRAR: `ativa` não é tocada.
      s.arquivada = p_arquivada ?? true
      return { ok: true, situacao: 'ok', codigo, arquivada: s.arquivada }
    },
  }

  // ════════════════════════════════════════════════════════════════════════
  // AS TABELAS QUE AS TELAS LEEM DIRETO (`GET /rest/v1/<tabela>?…`).
  // ⚠️ SÓ AS DUAS DO PRIVATE APPOINTMENT, e com o filtro do PostgREST de
  // verdade (`lerFiltros`): a lista do período precisa recortar como o banco
  // recorta, senão a demonstração mostra uma agenda que a Central não mostraria.
  // ════════════════════════════════════════════════════════════════════════
  const tabelas = {
    vessel_atendimentos: () => b.atendimentos.map((t) => ({ ...t, client_advisor: t.client_advisor ?? null,
      convite_codigo: t.convite_codigo ?? null })),
    vessel_pedidos: () => b.pedidos.map((p) => ({ numero: null, data_da_venda: null, total_corrigido: null, ...p })),
  }
  const embutidos = {
    vessel_pessoas: (linha) => pessoaPorId(linha.pessoa_id),
  }

  return {
    /** O que o banco tem hoje — só para o teste olhar. */
    get estado() { return b },
    conhece: (nome) => Object.prototype.hasOwnProperty.call(funcoes, nome),
    conheceTabela: (nome) => Object.prototype.hasOwnProperty.call(tabelas, nome),
    /** `GET /rest/v1/<tabela>?<busca>` — filtra, ordena, limita e escolhe as
     * colunas como o PostgREST. Tabela desconhecida devolve `undefined`. */
    ler(tabela, busca) {
      if (!Object.prototype.hasOwnProperty.call(tabelas, tabela)) return undefined
      return copia(consultar(tabelas[tabela](), new URLSearchParams(busca || ''), embutidos))
    },
    /** Chama a função como o PostgREST chamaria; devolve uma CÓPIA (JSON). */
    chamar(nome, corpo) {
      const f = funcoes[nome]
      if (!f) return undefined
      const r = f(corpo || {})
      // Leituras que o roteiro precisa enxergar.
      if (nome === 'vessel_chave_da_convidada' && r?.ok) avisar('cartao_gerado', { id: Number(corpo?.p_id) })
      if (nome === 'vessel_placar_do_stylist_circle') avisar('placar_lido', { realizados: r.encontros_realizados, receita: r.receita })
      return copia(r)
    },
  }
}

// ════════════════════════════════════════════════════════════════════════════
// O PEDAÇO DO POSTGREST QUE AS TELAS USAM — filtro, `or`/`and`, ordem, limite
// e `select` com tabela embutida. Não é o PostgREST inteiro: é o que as
// leituras diretas do Comercial Vessel mandam hoje, lido do jeito dele.
// ════════════════════════════════════════════════════════════════════════════
const RESERVADOS = new Set(['select', 'order', 'limit', 'offset'])

/** Separa por vírgula FORA de parênteses: `a,b(c,d),e` → ['a', 'b(c,d)', 'e']. */
export function separarNoTopo(texto) {
  const partes = []
  let fundo = 0, atual = ''
  for (const c of String(texto)) {
    if (c === '(') fundo++
    if (c === ')') fundo--
    if (c === ',' && fundo === 0) { partes.push(atual); atual = '' } else atual += c
  }
  if (atual !== '') partes.push(atual)
  return partes.map((p) => p.trim()).filter(Boolean)
}

/** Instante ou dia como número, para comparar. Sem fuso escrito, vale UTC —
 * a sessão do banco da Supabase roda em UTC. */
function comoInstante(v) {
  const t = String(v)
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return Date.parse(`${t}T00:00:00Z`)
  if (/^\d{4}-\d{2}-\d{2}T[\d:.]+$/.test(t)) return Date.parse(`${t}Z`)
  if (/^\d{4}-\d{2}-\d{2}T/.test(t)) return Date.parse(t)
  return NaN
}
function comparar(a, b) {
  const x = comoInstante(a), y = comoInstante(b)
  if (!Number.isNaN(x) && !Number.isNaN(y)) return x - y
  const na = Number(a), nb = Number(b)
  if (a !== '' && b !== '' && !Number.isNaN(na) && !Number.isNaN(nb)) return na - nb
  return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0
}

/** Uma condição `operador.valor` sobre o valor da coluna. */
export function passaNaCondicao(valor, operacao) {
  const i = operacao.indexOf('.')
  const op = operacao.slice(0, i), alvo = operacao.slice(i + 1)
  if (op === 'is') {
    if (alvo === 'null') return valor == null
    if (alvo === 'true') return valor === true
    if (alvo === 'false') return valor === false
    return false
  }
  // Em SQL, comparar com nulo não passa em nada.
  if (valor == null) return false
  if (op === 'eq') return comparar(valor, alvo) === 0
  if (op === 'neq') return comparar(valor, alvo) !== 0
  if (op === 'gt') return comparar(valor, alvo) > 0
  if (op === 'gte') return comparar(valor, alvo) >= 0
  if (op === 'lt') return comparar(valor, alvo) < 0
  if (op === 'lte') return comparar(valor, alvo) <= 0
  if (op === 'in') return separarNoTopo(alvo.replace(/^\(|\)$/g, '')).some((v) => comparar(valor, v) === 0)
  throw new Error(`[demonstração] operador do PostgREST não previsto: ${op}`)
}

/** `or=(and(a.gte.1,a.lte.2),b.is.null)` — a árvore de `or`/`and`. */
function passaNoGrupo(linha, tipo, miolo) {
  const itens = separarNoTopo(miolo)
  const passa = (item) => {
    const m = /^(or|and)\((.*)\)$/.exec(item)
    if (m) return passaNoGrupo(linha, m[1], m[2])
    const i = item.indexOf('.')
    return passaNaCondicao(linha[item.slice(0, i)], item.slice(i + 1))
  }
  return tipo === 'or' ? itens.some(passa) : itens.every(passa)
}

export function consultar(linhas, busca, embutidos = {}) {
  let saida = linhas.filter((linha) => {
    for (const [chave, valor] of busca.entries()) {
      if (RESERVADOS.has(chave)) continue
      if (chave === 'or' || chave === 'and') {
        if (!passaNoGrupo(linha, chave, valor.replace(/^\(|\)$/g, ''))) return false
      } else if (!passaNaCondicao(linha[chave], valor)) return false
    }
    return true
  })
  const ordem = busca.get('order')
  if (ordem) {
    const chaves = separarNoTopo(ordem).map((o) => {
      const [coluna, ...mods] = o.split('.')
      const desc = mods.includes('desc')
      // Padrão do Postgres: nulo é o MAIOR — último no asc, primeiro no desc.
      const nulosPrimeiro = mods.includes('nullsfirst') ? true : mods.includes('nullslast') ? false : desc
      return { coluna, desc, nulosPrimeiro }
    })
    saida = [...saida].sort((x, y) => {
      for (const { coluna, desc, nulosPrimeiro } of chaves) {
        const a = x[coluna], b = y[coluna]
        if (a == null && b == null) continue
        if (a == null) return nulosPrimeiro ? -1 : 1
        if (b == null) return nulosPrimeiro ? 1 : -1
        const c = comparar(a, b)
        if (c !== 0) return desc ? -c : c
      }
      return 0
    })
  }
  const inicio = Number(busca.get('offset') || 0)
  const limite = busca.has('limit') ? Number(busca.get('limit')) : Infinity
  saida = saida.slice(inicio, inicio + limite)
  const select = busca.get('select')
  if (!select || select === '*') return saida
  const campos = separarNoTopo(select)
  return saida.map((linha) => {
    const nova = {}
    for (const campo of campos) {
      const m = /^(?:([a-z_]+):)?([a-z_]+)\((.*)\)$/.exec(campo)
      if (m) {
        const [, apelido, tabela, dentro] = m
        const alvo = embutidos[tabela] ? embutidos[tabela](linha) : null
        if (!embutidos[tabela]) throw new Error(`[demonstração] tabela embutida não prevista: ${tabela}`)
        const sub = separarNoTopo(dentro)
        nova[apelido || tabela] = alvo
          ? Object.fromEntries(sub.map((c) => [c, alvo[c] ?? null])) : null
      } else nova[campo] = linha[campo] ?? null
    }
    return nova
  })
}
