/* O BANCO DE MENTIRA DA DEMONSTRAÇÃO — as funções do Comercial Vessel,
 * respondidas dentro do navegador, sem rede nenhuma.
 *
 * ⚠️ AS REGRAS SÃO AS DO BANCO DE VERDADE, linha por linha. Cada função aqui é
 * a tradução de uma função de `db/migrations/2026-09-22-vessel-t11-bases-do-
 * stylist-circle.sql` (e das irmãs de 19/09 que ela não reescreveu): a mesma
 * ordem de conferência, a mesma `situacao` na recusa, o mesmo formato de
 * resposta. Uma demonstração que aceitasse o que o banco recusa ensinaria a
 * Ionara um sistema que não existe.
 *
 * ⚠️ E REUSA AS REGRAS JS QUE JÁ ESPELHAM O BANCO: a sugestão de etapa é
 * `sugestaoDeEtapa` (crm-da-stylist-regras.js), que o teste de lá já confere
 * contra o SQL. Uma segunda cópia aqui seria a terceira verdade.
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
import { sugestaoDeEtapa } from '../ferramentas/comercial-vessel/crm-da-stylist-regras.js'

/** ⚠️ A MARCA QUE O BUILD DA CENTRAL NÃO PODE TER: o relatório da entrega
 * procura esta string em `dist/` (o build normal) — achá-la lá quer dizer que
 * o banco de mentira vazou para produção. */
export const MARCA_DO_BANCO_DE_MENTIRA = 'banco-de-mentira'

// ── as listas fechadas do banco (os CHECK da migration) ─────────────────────
const ESTAGIOS = ['prospectado', 'contatado', 'interessado', 'em_negociacao',
  'ativado', 'evento_realizado', 'recorrente', 'sem_retorno', 'nao_interessado', 'pausado', 'inativo']
const ESTAGIOS_AUTOMATICOS = ['ativado', 'evento_realizado', 'recorrente']
const ANTES_DO_ENCONTRO = ['prospectado', 'contatado', 'interessado', 'em_negociacao']
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

  // ── o gatilho do funil: `vessel_stylist_seguir_os_encontros` ──────────────
  function seguirOsEncontros(stylistId) {
    const s = stylistPorId(stylistId)
    if (!s) return
    const dela = b.encontros.filter((e) => e.stylist_id === stylistId && !e.arquivada)
    const realizados = dela.filter((e) => e.status === 'realizado').length
    const marcados = dela.filter((e) => MARCADOS.includes(e.status)).length
    const fase = realizados >= 2 ? 'recorrente' : realizados === 1 ? 'evento_realizado' : marcados >= 1 ? 'ativado' : null
    // A ativação congela na primeira vez.
    if (marcados >= 1 && !s.ativada_em) s.ativada_em = agoraIso()
    // ⚠️ PAUSADO E INATIVO SÃO DECISÃO DE GENTE, e o gatilho não passa por cima.
    if (s.estagio === 'pausado' || s.estagio === 'inativo') return
    s.estagio = fase ?? (ESTAGIOS_AUTOMATICOS.includes(s.estagio) ? 'ativado' : s.estagio)
  }
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
            codigo: s.codigo, nome: s.nome, cidade: s.cidade, estagio: s.estagio, praca_preview: s.praca_preview,
            ativa: s.ativa, whatsapp: s.whatsapp, instagram: s.instagram, atuacao: s.atuacao,
            loja: s.loja, origem_contato: s.origem_contato, responsavel: s.responsavel,
            prospectado_em: s.prospectado_em, proxima_acao: s.proxima_acao, proxima_acao_em: s.proxima_acao_em,
            ativada_em: s.ativada_em,
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

    vessel_stylists_para_escolher() {
      return b.stylists.filter((s) => !s.teste && s.ativa !== false)
        .sort((x, y) => (x.codigo < y.codigo ? -1 : 1))
        .map((s) => ({ codigo: s.codigo, nome: s.nome, cidade: s.cidade, whatsapp: s.whatsapp }))
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

    vessel_placar_do_stylist_circle({ p_de = null, p_ate = null, p_dias = 14 } = {}) {
      const de = p_de || '2000-01-01'
      const ate = p_ate || '9999-12-31' // 'infinity'::date
      const dentro = (d) => !!d && d >= de && d <= ate
      const dias = Math.max(Number(p_dias ?? 14) || 0, 0)
      const sty = b.stylists.filter((s) => !s.teste)
      const idsSty = new Set(sty.map((s) => s.id))
      const diaAtiv = (s) => (s.ativada_em ? diaEmSaoPaulo(s.ativada_em) : null)
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
      const intervalosNoPeriodo = realizados.filter((r) => r.intervalo != null && dentro(r.realizado_em))
      return {
        de: p_de, ate: p_ate, janela_de_venda_em_dias: dias,
        prospectadas: sty.filter((s) => dentro(s.prospectado_em)).length,
        ativadas: ativadasNoPeriodo.length,
        prospectadas_ja_ativadas: sty.filter((s) => dentro(s.prospectado_em) && diaAtiv(s) && diaAtiv(s) <= ate).length,
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
          b.contatos.filter((c) => c.stylist_id === s.id && c.criado_em < s.ativada_em).length)),
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
      const fone = telefoneCanonico(a.p_whatsapp)
      if (!fone) return { ok: false, situacao: 'whatsapp_invalido' }
      const praca = maiusculo(a.p_praca), loja = minusculo(a.p_loja), origem = minusculo(a.p_origem_contato)
      if (praca && !PRACAS.includes(praca)) return { ok: false, situacao: 'praca_invalida' }
      if (loja && !LOJAS.includes(loja)) return { ok: false, situacao: 'loja_invalida' }
      // ⚠️ NA CENTRAL A ORIGEM É OBRIGATÓRIA.
      if (!origem || !ORIGENS.includes(origem)) return { ok: false, situacao: 'origem_invalida' }
      if (a.p_prospectado_em && a.p_prospectado_em > hoje()) return { ok: false, situacao: 'prospeccao_no_futuro' }
      const repetida = b.stylists.find((s) => s.whatsapp === fone)
      if (repetida) return { ok: false, situacao: 'whatsapp_repetido', codigo: repetida.codigo }

      let n = Math.max(0, ...b.stylists.map((s) => /^STY-(\d{4})$/.exec(s.codigo)).filter(Boolean).map((m) => Number(m[1])))
      let codigo = null
      for (let i = 0; i < 10000; i++) {
        n += 1; if (n > 9999) n = 0
        const c = `STY-${String(n).padStart(4, '0')}`
        if (!stylistPorCodigo(c)) { codigo = c; break }
      }
      if (!codigo) return { ok: false, situacao: 'sem_codigo_livre' }
      const s = {
        id: proximo(b.stylists), codigo, nome: String(a.p_nome).trim(), whatsapp: fone,
        cidade: limpo(a.p_cidade), instagram: limpo(a.p_instagram), atuacao: limpo(a.p_atuacao),
        praca_preview: praca, loja, origem_contato: origem, origem_canal: null, responsavel: limpo(a.p_responsavel),
        prospectado_em: a.p_prospectado_em || hoje(), proxima_acao: limpo(a.p_proxima_acao),
        proxima_acao_em: a.p_proxima_acao_em || null, ativada_em: null, estagio: 'prospectado', ativa: true, teste: false,
      }
      b.stylists.push(s)
      avisar('stylist_criada', { codigo, nome: s.nome })
      return { ok: true, situacao: 'ok', codigo }
    },

    vessel_stylist_editar(a = {}) {
      const codigo = maiusculo(a.p_codigo)
      const s = stylistPorCodigo(codigo)
      if (!s) return { ok: false, situacao: 'nao_achei' }
      let fone = null
      if (limpo(a.p_whatsapp)) {
        fone = telefoneCanonico(a.p_whatsapp)
        if (!fone) return { ok: false, situacao: 'whatsapp_invalido' }
        if (b.stylists.some((x) => x.whatsapp === fone && x.codigo !== codigo)) return { ok: false, situacao: 'whatsapp_repetido' }
      }
      const praca = maiusculo(a.p_praca), loja = minusculo(a.p_loja), origem = minusculo(a.p_origem_contato)
      const estagio = minusculo(a.p_estagio)
      if (praca && !PRACAS.includes(praca)) return { ok: false, situacao: 'praca_invalida' }
      if (loja && !LOJAS.includes(loja)) return { ok: false, situacao: 'loja_invalida' }
      if (origem && !ORIGENS.includes(origem)) return { ok: false, situacao: 'origem_invalida' }
      if (a.p_prospectado_em && a.p_prospectado_em > hoje()) return { ok: false, situacao: 'prospeccao_no_futuro' }
      if (estagio) {
        // ⚠️ OS TRÊS DEGRAUS DO MEIO NÃO SE ESCOLHEM: saem dos encontros.
        if (ESTAGIOS_AUTOMATICOS.includes(estagio)) return { ok: false, situacao: 'estagio_automatico' }
        if (!ESTAGIOS.includes(estagio)) return { ok: false, situacao: 'estagio_invalido' }
        // ⚠️ E QUEM JÁ TEVE ENCONTRO NÃO VOLTA PARA ANTES DELE.
        if (s.ativada_em && ANTES_DO_ENCONTRO.includes(estagio)) return { ok: false, situacao: 'estagio_contradiz_encontro' }
      }
      const antes = s.estagio
      Object.assign(s, {
        nome: limpo(a.p_nome) ?? s.nome,
        whatsapp: fone ?? s.whatsapp,
        cidade: limpo(a.p_cidade) ?? s.cidade,
        instagram: limpo(a.p_instagram) ?? s.instagram,
        atuacao: limpo(a.p_atuacao) ?? s.atuacao,
        estagio: estagio ?? s.estagio,
        praca_preview: praca ?? s.praca_preview,
        loja: loja ?? s.loja,
        origem_contato: origem ?? s.origem_contato,
        responsavel: limpo(a.p_responsavel) ?? s.responsavel,
        prospectado_em: a.p_prospectado_em || s.prospectado_em,
        proxima_acao: a.p_sem_proxima_acao ? null : (limpo(a.p_proxima_acao) ?? s.proxima_acao),
        proxima_acao_em: a.p_sem_proxima_acao ? null : (a.p_proxima_acao_em || s.proxima_acao_em),
      })
      // ⚠️ SAIR DE "PAUSADO" DEVOLVE O FUNIL AO FATO.
      seguirOsEncontros(s.id)
      if (s.estagio !== antes) avisar('etapa_mudada', { codigo, de: antes, para: s.estagio })
      else avisar('stylist_editada', { codigo })
      return { ok: true, situacao: 'ok', codigo }
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
      const sugestao = sugestaoDeEtapa(res, s.estagio, s.ativada_em)
      avisar('contato_registrado', { codigo: s.codigo, canal, resultado: res, sugestao })
      return { ok: true, situacao: 'ok', id, sugestao }
    },

    // ── escritas: o encontro ──────────────────────────────────────────────
    vessel_criar_private_edit(a = {}) {
      const s = stylistPorCodigo(maiusculo(a.p_stylist))
      if (!s) return { ok: false, situacao: 'stylist_nao_encontrada', erro: 'Não achei esta stylist. O código é o STY-0000 dela.' }
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
      const estagioAntes = s.estagio
      gatilhoDoEncontro(null, e)
      avisar('encontro_criado', { codigo, stylist: s.codigo, estagio_antes: estagioAntes, estagio: s.estagio })
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
      avisar('encontro_situacao', { codigo, status, antes: antes.status, stylist: s?.codigo, estagio: s?.estagio })
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
            pessoas: gente.size,
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
      b.sessoes = b.sessoes.filter((x) => x.codigo !== codigo)
      return { ok: true, situacao: 'ok', codigo }
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
