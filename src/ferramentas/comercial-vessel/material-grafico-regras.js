/* AS REGRAS DO MATERIAL GRÁFICO — os QR de cada ação do Growth Plan.
 *
 * Pedido do dono em 23/09/2026: os QR Codes de todas as ações do plano que
 * pedem QR, sem fundo, baixáveis, organizados por ação, e "bem claro de qual
 * ação é cada QR". São três, e o plano pede cada uma com todas as letras:
 *
 *   Beauty Sessions  um QR por SESSÃO, o da mesa (display do salão)   /bs/<codigo>
 *   Private Edit     um QR por ENCONTRO, o convite geral              /pe/<chave>
 *   Stylist Circle   um QR por PARCEIRA (T07: rastreio por stylist)   /s/<STY-0000>
 *
 * (O Appointment Card NÃO entra: o QR dele nasce dentro do próprio cartão.)
 *
 * ⚠️ O ENDEREÇO NÃO NASCE AQUI. Cada um sai da função que a tela irmã já usa
 * (`enderecoDaMesa`, `enderecoDoConvite`, `enderecoDaStylist`), que por sua vez
 * é conferida LETRA POR LETRA contra o site nos testes dela. Montar o link de
 * novo aqui seria a terceira cópia da mesma verdade — e um QR impresso com o
 * link divergente leva a cliente a lugar nenhum.
 *
 * ⚠️ SÓ LEITURA. Esta ferramenta não escreve nada no banco: lê as três funções
 * de conta que as telas irmãs já leem, e desenha o QR no próprio navegador.
 */
import { enderecoDaMesa, dataLegivel, LOJAS } from '../beauty-sessions/contas-das-sessoes.js'
import { seloDaSessao } from '../beauty-sessions/beauty-sessions-regras.js'
import { enderecoDoConvite, enderecoDaStylist, dataHoraLegivel } from './enderecos-publicos.js'
import { encontroAceitaConvite } from './private-edit-regras.js'
import { seloDoStatus } from './t11-regras.js'

/** As três ações, na ordem do plano. `cor` é o token de identidade de cada uma. */
export const ACOES = [
  { chave: 'beauty-session', titulo: 'Beauty Sessions', cor: '--cor-beauty-sessions', icone: 'conjunto',
    porItem: 'Um QR por sessão — o da mesa, o display do salão',
    legenda: 'Prepare sua visita',
    motivoSemQr: 'Esta sessão não tem código válido, então não há QR. Confira na tela Beauty Sessions.' },
  { chave: 'private-edit', titulo: 'Private Edit', cor: '--cor-private-edit', icone: 'encontros',
    porItem: 'Um QR por encontro — o convite geral, impresso na peça do encontro',
    legenda: 'Confirme sua presença',
    motivoSemQr: 'Este encontro não tem chave de convite válida, então não há QR. Confira na tela Private Edit.' },
  { chave: 'stylist-circle', titulo: 'Stylist Circle', cor: '--cor-stylist-circle', icone: 'parceiras',
    porItem: 'Um QR por parceira — o link permanente dela, que rastreia quem ela traz',
    legenda: '',
    motivoSemQr: 'Esta parceira não tem código STY válido, então não há QR. Confira na tela Stylist Circle.' },
]

const acao = (chave) => ACOES.find((a) => a.chave === chave)

/** A sequência do código (o último pedaço): BS-20260925-CPS-02 → '02'. */
export function sequenciaDoCodigo(codigo) {
  const partes = String(codigo || '').split('-')
  return partes.length >= 4 ? partes[partes.length - 1] : ''
}

/**
 * aaaa-mm-dd do dia em SÃO PAULO de um instante.
 *
 * ⚠️ O `quando` do encontro é timestamptz e chega em UTC: um encontro às 22h
 * de Campinas chega como 01h do DIA SEGUINTE em UTC. Cortar a string nos dez
 * primeiros caracteres poria a data errada no NOME DO ARQUIVO que vai para a
 * gráfica.
 */
export function diaEmSaoPaulo(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(d).map((x) => [x.type, x.value]))
  return `${p.year}-${p.month}-${p.day}`
}

/* O item que a tela desenha, igual para as três ações:
 *   { acao, chave, titulo, linhas: [..], codigo, endereco, legenda,
 *     arquivo: { programa, praca, data | codigo, sequencia },
 *     ativo, situacao: { texto, tom }, ordem, busca } */

export function itemDaBeauty(s = {}) {
  const codigo = String(s.codigo || '').toUpperCase()
  const selo = seloDaSessao(s)
  const quando = String(s.quando || '').slice(0, 10)
  return {
    acao: 'beauty-session',
    chave: `bs-${codigo}`,
    titulo: `${dataLegivel(quando) || 'Sem data'} · ${s.parceiro || 'sem salão informado'}`,
    linhas: [LOJAS[s.loja] || s.loja || 'Sem loja'],
    codigo,
    endereco: enderecoDaMesa(codigo),
    legenda: acao('beauty-session').legenda,
    motivoSemQr: acao('beauty-session').motivoSemQr,
    arquivo: { programa: 'beauty-session', praca: s.praca || codigo.slice(12, 15), data: quando,
      sequencia: sequenciaDoCodigo(codigo) },
    ativo: !s.arquivada && s.ativa !== false,
    situacao: { texto: selo.texto, tom: selo.tom },
    ordem: quando,
    busca: [codigo, s.parceiro, LOJAS[s.loja], s.loja, dataLegivel(quando)],
  }
}

export function itemDoPrivateEdit(e = {}) {
  const codigo = String(e.codigo || '').toUpperCase()
  return {
    acao: 'private-edit',
    chave: `pe-${codigo}`,
    titulo: `${dataHoraLegivel(e.quando) || 'Sem data'} · ${e.anfitria || 'sem anfitriã'}`,
    linhas: [e.local || 'Local ainda não informado'],
    codigo,
    // ⚠️ PELA CHAVE, NUNCA PELO CÓDIGO: o código é adivinhável (ver
    // `enderecoDoConvite`). Sem chave válida, sem QR — e a tela diz o porquê.
    endereco: enderecoDoConvite(e.chave),
    legenda: acao('private-edit').legenda,
    motivoSemQr: acao('private-edit').motivoSemQr,
    arquivo: { programa: 'private-edit', praca: e.praca || codigo.slice(12, 15), data: diaEmSaoPaulo(e.quando),
      sequencia: sequenciaDoCodigo(codigo) },
    // ⚠️ ATIVO É "ACEITA CONVITE", NÃO SÓ `ativa`: o status pode virar
    // cancelado/realizado/não realizado com `ativa` ainda true, e aí o
    // /pe/<chave> RECUSA — um QR desses na gráfica leva a uma porta fechada.
    // A regra e o selo são os MESMOS da tela Private Edit, não uma cópia.
    ativo: encontroAceitaConvite(e),
    situacao: (({ texto, tom }) => ({ texto, tom }))(seloDoStatus(e)),
    ordem: String(e.quando || ''),
    busca: [codigo, e.anfitria, e.stylist, e.local, dataHoraLegivel(e.quando)],
  }
}

export function itemDaStylist(s = {}) {
  const codigo = String(s.codigo || '').toUpperCase()
  const ativa = s.ativa !== false
  return {
    acao: 'stylist-circle',
    chave: `sty-${codigo}`,
    titulo: s.nome || 'Sem nome',
    linhas: [s.cidade || 'Cidade não informada'],
    codigo,
    endereco: enderecoDaStylist(codigo),
    legenda: acao('stylist-circle').legenda,
    motivoSemQr: acao('stylist-circle').motivoSemQr,
    arquivo: { programa: 'stylist-circle', codigo },
    ativo: ativa,
    situacao: ativa ? { texto: 'Ativa', tom: 'viva' } : { texto: 'Desativada', tom: 'parada' },
    ordem: codigo,
    busca: [codigo, s.nome, s.cidade],
  }
}

const MONTAR = { 'beauty-session': itemDaBeauty, 'private-edit': itemDoPrivateEdit, 'stylist-circle': itemDaStylist }

/** Linhas cruas de uma função de conta → itens desenháveis, em ordem. */
export function itensDaAcao(chaveDaAcao, linhas) {
  const montar = MONTAR[chaveDaAcao]
  if (!montar) throw new Error(`ação desconhecida: ${chaveDaAcao}`)
  return (Array.isArray(linhas) ? linhas : []).map(montar)
    .sort((a, b) => String(a.ordem).localeCompare(String(b.ordem)))
}

// Sem acento e sem maiúscula: quem busca "ana" acha "Âna".
const achatar = (t) => String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()

/**
 * O que aparece na tela.
 *
 * ⚠️ POR PADRÃO SÓ O ATIVO. QR de sessão encerrada ou de parceira desativada
 * não devia ir para a gráfica por engano — a página do outro lado já recusa
 * contato novo. `mostrarEncerrados` traz de volta quem precisar reimprimir.
 */
export function filtrarItens(itens, { busca = '', mostrarEncerrados = false } = {}) {
  const b = achatar(busca)
  return (itens || []).filter((i) => {
    if (!mostrarEncerrados && !i.ativo) return false
    if (b && !i.busca.some((campo) => achatar(campo).includes(b))) return false
    return true
  })
}

/** A frase de quando um grupo está vazio — nunca a mesma do erro. */
const VAZIO = {
  'beauty-session': {
    nada: 'Nenhuma Beauty Session criada ainda. Ela nasce na tela Beauty Sessions.',
    busca: 'Nenhuma sessão com',
    inativos: 'Nenhuma sessão aceitando agora. Marque "Mostrar também encerrados e desativadas" para ver as outras.',
  },
  'private-edit': {
    nada: 'Nenhum encontro marcado ainda. Ele nasce na tela Private Edit.',
    busca: 'Nenhum encontro com',
    inativos: 'Nenhum encontro aceitando agora. Marque "Mostrar também encerrados e desativadas" para ver os outros.',
  },
  'stylist-circle': {
    nada: 'Nenhuma parceira cadastrada ainda. Ela nasce na tela Stylist Circle.',
    busca: 'Nenhuma parceira com',
    inativos: 'Nenhuma parceira ativa. Marque "Mostrar também encerrados e desativadas" para ver as outras.',
  },
}

export function fraseDoVazio(chaveDaAcao, { total = 0, busca = '', mostrarEncerrados = false } = {}) {
  const f = VAZIO[chaveDaAcao]
  if (!total) return f.nada
  if (String(busca).trim()) return `${f.busca} "${String(busca).trim()}".`
  if (!mostrarEncerrados) return f.inativos
  return f.nada
}
