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
import { diaEmSaoPaulo, somarDias, diasEntre } from './tempo.js'
import { faixaDaNota } from '../ferramentas/comercial-vessel/qualificacao-regras.js'

/** ⚠️ A MARCA QUE O BUILD DA CENTRAL NÃO PODE TER: o relatório da entrega
 * procura esta string em `dist/` (o build normal) — achá-la lá quer dizer que
 * o banco de mentira vazou para produção. */
export const MARCA_DO_BANCO_DE_MENTIRA = 'banco-de-mentira'

// ── as listas fechadas do banco (os CHECK da migration) ─────────────────────
const PRACAS = ['CPS', 'SAO', 'SBO', 'BSB']
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

export function criarBancoDeMentira({ agora = () => new Date(), aoAvisar = () => {}, dados } = {}) {
  const b = dados ? copia(dados) : dadosIniciais(agora())
  // 24/09: dados de teste antigos não trazem as avaliações — começam sem nenhuma.
  if (!Array.isArray(b.qualificacoes)) b.qualificacoes = []
  // 24/09 (Private Edit só com liberada): dados antigos não trazem os motivos.
  if (!Array.isArray(b.motivos)) b.motivos = []
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
  function mudarDeEtapa(s, etapaId, motivo, saida = null) {
    const de = s.etapa_id ?? null
    s.etapa_id = etapaId
    if (!s.prospectado_em && contaComoProspectada(etapaId)) s.prospectado_em = hoje()
    const e = etapaPorId(etapaId)
    const naSaida = e?.tipo === 'saida'
    const m = naSaida && saida?.motivoId != null ? b.motivos.find((x) => x.id === Number(saida.motivoId) && x.etapa_id === etapaId) : null
    b.historicoDeEtapas.push({ id: proximo(b.historicoDeEtapas), stylist_id: s.id, de_etapa_id: de,
      para_etapa_id: etapaId, motivo, por_nome: USUARIO_DA_DEMONSTRACAO, em: agoraIso(),
      motivo_id: m?.id ?? null, nota: naSaida ? limpo(saida?.nota) : null, liberava_private_edit: !!e?.libera_private_edit })
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
    vessel_rastreio_dos_stylists({ p_dias = 7, p_incluir_desativadas = false } = {}) {
      const dias = Math.max(Number(p_dias ?? 7) || 0, 0)
      const vendas = vendasDosEncontros(dias)
      return b.stylists
        .filter((s) => !s.teste && (p_incluir_desativadas || s.ativa !== false))
        .map((s) => {
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
            ativa: s.ativa, whatsapp: s.whatsapp, instagram: s.instagram, atuacao: s.atuacao,
            loja: s.loja, origem_contato: s.origem_contato, responsavel: s.responsavel,
            prospectado_em: s.prospectado_em, proxima_acao: s.proxima_acao, proxima_acao_em: s.proxima_acao_em,
            observacoes: s.observacoes ?? null, ativada_em: ativadaEm(s), private_edit_agendado_em: s.ativada_em ?? null,
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
          }
        })
        .sort((x, y) => (x.quando === y.quando ? 0 : (x.quando < y.quando ? 1 : -1)))
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
      if (!fone && !insta) return { ok: false, situacao: 'sem_contato' }
      if (!fone && !perfil) return { ok: false, situacao: 'instagram_invalido' }
      if (obs && obs.length > 2000) return { ok: false, situacao: 'observacoes_longas' }
      const praca = maiusculo(a.p_praca), loja = minusculo(a.p_loja), origem = minusculo(a.p_origem_contato)
      if (praca && !PRACAS.includes(praca)) return { ok: false, situacao: 'praca_invalida' }
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
        praca_preview: praca, loja, origem_contato: origem, origem_canal: null, responsavel: limpo(a.p_responsavel),
        prospectado_em: null, proxima_acao: limpo(a.p_proxima_acao), observacoes: obs,
        proxima_acao_em: a.p_proxima_acao_em || null, ativada_em: null, etapa_id: null, ativa: true, teste: false,
      }
      b.stylists.push(s)
      // Cadastro novo entra na PRIMEIRA etapa de funil.
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
      if (a.p_observacoes != null && String(a.p_observacoes).trim().length > 2000) return { ok: false, situacao: 'observacoes_longas' }
      const praca = maiusculo(a.p_praca), loja = minusculo(a.p_loja), origem = minusculo(a.p_origem_contato)
      if (praca && !PRACAS.includes(praca)) return { ok: false, situacao: 'praca_invalida' }
      if (loja && !LOJAS.includes(loja)) return { ok: false, situacao: 'loja_invalida' }
      if (origem && !ORIGENS.includes(origem)) return { ok: false, situacao: 'origem_invalida' }
      Object.assign(s, {
        nome: limpo(a.p_nome) ?? s.nome,
        whatsapp: fone ?? s.whatsapp,
        cidade: limpo(a.p_cidade) ?? s.cidade,
        instagram: insta ?? s.instagram,
        atuacao: limpo(a.p_atuacao) ?? s.atuacao,
        praca_preview: praca ?? s.praca_preview,
        loja: loja ?? s.loja,
        origem_contato: origem ?? s.origem_contato,
        responsavel: limpo(a.p_responsavel) ?? s.responsavel,
        proxima_acao: a.p_sem_proxima_acao ? null : (limpo(a.p_proxima_acao) ?? s.proxima_acao),
        proxima_acao_em: a.p_sem_proxima_acao ? null : (a.p_proxima_acao_em || s.proxima_acao_em),
        // `observacoes`: nula não mexe, string vazia apaga.
        observacoes: a.p_observacoes == null ? (s.observacoes ?? null) : limpo(a.p_observacoes),
      })
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
      avisar('etapa_mudada', { codigo, de, para: e.nome, libera_private_edit: !!e.libera_private_edit })
      return { ok: true, situacao: 'ok', codigo, etapa: e.nome, libera_private_edit: !!e.libera_private_edit,
        prospectado_em: s.prospectado_em }
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
      const praca = maiusculo(a.p_praca)
      if (!praca || !PRACAS.includes(praca)) return { ok: false, situacao: 'praca_invalida', erro: 'A praça precisa ser CPS, SAO, SBO ou BSB.' }
      if (a.p_loja != null && !LOJAS.includes(a.p_loja)) return { ok: false, situacao: 'loja_invalida', erro: 'Escolha uma loja válida.' }
      const vagas = a.p_vagas == null ? null : Number(a.p_vagas)
      if (vagas == null || !Number.isFinite(vagas) || vagas < 7 || vagas > 10) {
        return { ok: false, situacao: 'vagas_invalidas', erro: 'A capacidade planejada é de 7 a 10 convidadas.' }
      }
      const dia = diaEmSaoPaulo(quando)
      const seq = b.encontros.filter((e) => e.praca === praca && diaDoEncontro(e) === dia).length + 1
      const codigo = `PE-${dia.replace(/-/g, '')}-${praca}-${String(seq).padStart(2, '0')}`
      const chave = sortearChave((k) => b.encontros.some((e) => e.chave === k))
      const e = { id: proximo(b.encontros), codigo, chave, stylist_id: s.id, quando: quando.toISOString(),
        local: limpo(a.p_local), praca, loja: a.p_loja ?? null, vagas, ativa: true, arquivada: false,
        status: 'agendado', realizado_em: null, motivo: null, observacoes: null, teste: !!a.p_teste }
      b.encontros.push(e)
      gatilhoDoEncontro(null, e)
      avisar('encontro_criado', { codigo, stylist: s.codigo })
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
      const antes = { ...e }
      Object.assign(e, {
        quando: a.p_quando ? new Date(a.p_quando).toISOString() : e.quando,
        local: a.p_local ?? e.local, praca: a.p_praca ?? e.praca, loja: a.p_loja ?? e.loja,
        vagas: a.p_vagas != null ? Number(a.p_vagas) : e.vagas, stylist_id: stylistId ?? e.stylist_id,
      })
      gatilhoDoEncontro(antes, e)
      avisar('encontro_editado', { codigo })
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
    vessel_beauty_session_cadastrar_lead({ p_codigo, p_nome, p_whatsapp, p_instagram = null, p_interesse = null } = {}) {
      const s = b.sessoes.find((x) => x.codigo === maiusculo(p_codigo))
      if (!s) return { ok: false, situacao: 'nao_achei' }
      if (s.arquivada) return { ok: false, situacao: 'sessao_arquivada' }
      const nome = String(p_nome ?? '').trim().replace(/\s+/g, ' ')
      if (nome.length < 2) return { ok: false, situacao: 'sem_nome' }
      const fone = telefoneCanonico(p_whatsapp)
      if (!fone) return { ok: false, situacao: 'whatsapp_invalido' }
      const insta = limpo(p_instagram)
      if (insta && insta.length > 120) return { ok: false, situacao: 'instagram_longo' }
      const interesse = limpo(p_interesse)
      if (interesse && !['conhecer-a-loja', 'rever-uma-peca', 'personal-atelier'].includes(interesse)) {
        return { ok: false, situacao: 'interesse_invalido' }
      }
      let pessoa = b.pessoas.find((p) => p.telefone === fone)
      const naBase = !!pessoa
      if (pessoa && b.origens.some((o) => o.pessoa_id === pessoa.id && o.evento_id === s.codigo)) {
        const porta = (b.cadastros || []).some((c) => c.codigo === s.codigo && c.pessoa_id === pessoa.id) ? 'equipe' : 'qr'
        return { ok: false, situacao: 'ja_estava', porta, pessoa_id: pessoa.id, nome: pessoa.nome }
      }
      // `vessel_anotar_interesse`: a ficha (só completa), a origem, o pedido de
      // visita (janela de 30 min), e as permissões — que aqui não se guardam.
      if (!pessoa) { pessoa = { id: proximo(b.pessoas), nome, telefone: fone, email: null, instagram: insta }; b.pessoas.push(pessoa) }
      else if (insta) pessoa.instagram = insta
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
