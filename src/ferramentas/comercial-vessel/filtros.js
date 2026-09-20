/* AS REGRAS DA BARRA DE LISTA — buscar, filtrar, o período e ordenar.
 *
 * Escritas uma vez e usadas pelas três telas. Duas cópias do mesmo controle
 * viram dois controles diferentes no dia em que alguém ajusta um.
 *
 * ⚠️ O PERÍODO É DAQUI, NÃO DO BANCO. As duas funções de conta do Comercial
 * Vessel recebem `p_dias`, mas ele NUNCA filtra linha nenhuma: ele só decide a
 * janela de atribuição de venda (`janela_de_venda_em_dias` na resposta) — "essa
 * compra caiu perto o bastante da visita para contar". As duas devolvem TODAS
 * as linhas não-teste, sempre, não importa `p_dias`. Se a barra ligasse
 * "Período" no `p_dias`, escolher "90 dias" mudaria as receitas mostradas na
 * tela sem tirar nem pôr uma linha na lista — o oposto do que a pessoa pediu.
 * Por isso o período recorta a LISTA aqui, depois que ela já voltou do banco.
 *
 * ⚠️ QUEM CHAMA RECALCULA O TOTAL sobre o que voltou daqui, com
 * `proporcaoDoConjunto`. Reaproveitar o total que veio do banco depois de
 * filtrar é a tela mentindo com número certo.
 */
export const PERIODOS = [
  { dias: 7,    rotulo: '7 dias' },
  { dias: 30,   rotulo: '30 dias' },
  { dias: 90,   rotulo: '90 dias' },
  { dias: null, rotulo: 'Tudo' },
]

export const FILTRO_VAZIO = {
  // ⚠️ "30 dias" quer dizer ESCONDER O QUE É MAIS VELHO que 30 dias — nunca
  // esconder um evento futuro, e "Tudo" (dias: null) não esconde nada. Um
  // corte feito do jeito óbvio (entre hoje-30 e hoje) some com o que ainda vai
  // acontecer: é assim que uma tela de agenda cheia de encontros futuros abre
  // vazia no primeiro olhar do dono. Ver `dentroDoPeriodo` abaixo.
  dias: 30,
  busca: '',
  situacao: 'abertas_e_encerradas',
  loja: '',
  estagio: '',
  ordem: 'data-nova',
}

// Sem acento e sem maiúscula: quem busca "ana" tem de achar "Ana" e "Âna".
const achatar = (t) => String(t ?? '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()

function passaNaSituacao(linha, situacao) {
  const arquivada = !!linha.arquivada
  // `ativa` pode não existir (Stylist Circle usa a mesma coluna com outro nome
  // de tela); nesse caso a linha conta como aberta.
  const aberta = linha.ativa !== false
  switch (situacao) {
    case 'arquivadas': return arquivada
    case 'abertas':    return !arquivada && aberta
    case 'encerradas': return !arquivada && !aberta
    case 'todas':      return true
    // ⚠️ O PADRÃO ESCONDE A ARQUIVADA, e só ela. Encerrada continua à vista:
    // ela aconteceu e continua contando.
    default:           return !arquivada
  }
}

/**
 * As duas situações em que a arquivada precisa aparecer, e por isso a tela
 * TEM DE VOLTAR AO BANCO com `p_incluir_arquivadas: true` antes de filtrar.
 *
 * ⚠️ AS FUNÇÕES DE CONTA JÁ CHEGAM SEM A ARQUIVADA (`p_incluir_arquivadas
 * boolean default false`) — quem nunca pediu por ela nunca a recebeu. Filtrar
 * o array na tela para "Só arquivadas" ou "Todas, inclusive arquivadas" filtra
 * um array que nunca teve arquivada dentro: o resultado é sempre vazio (ou
 * sempre incompleto), e nenhum teste de `filtrar()` sozinho pega esse buraco,
 * porque `filtrar()` recebe a lista já pronta — o problema mora ANTES dela.
 */
export function precisaDoBanco(situacao) {
  return situacao === 'arquivadas' || situacao === 'todas'
}

/**
 * O dia (sem hora, sem fuso) que um valor de data representa, em hora LOCAL.
 *
 * ⚠️ NUNCA `new Date(string)` NUM VALOR SÓ-DATA. `vessel_beauty_sessions.quando`
 * é `date` no banco e chega como o texto `"2026-09-25"`; `new Date('2026-09-25')`
 * é meia-noite EM UTC, que no Brasil (UTC−3) é dia 24 às 21h — o evento do dia
 * 25 vira, silenciosamente, dia 24, e pode cair do lado errado do corte.
 * Lendo só os três primeiros números (ano-mês-dia) e montando a data com
 * `new Date(ano, mes, dia)` — que o motor sempre lê em hora local — esse
 * desvio nunca acontece, com data-só ou com timestamp completo na frente.
 */
function diaLocal(valor) {
  const m = String(valor ?? '').match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!m) return null
  const [, ano, mes, dia] = m
  return new Date(Number(ano), Number(mes) - 1, Number(dia))
}

function hojeLocal() {
  const agora = new Date()
  return new Date(agora.getFullYear(), agora.getMonth(), agora.getDate())
}

/**
 * A linha passa no período escolhido?
 *
 * "Tudo" (dias null/undefined) não esconde nada. Fora isso, o corte tem UM
 * lado só: esconde o que é mais velho que `dias`, e não tem teto — um evento
 * no futuro nunca cai fora, não importa a distância. Pôr um teto (só até hoje)
 * é o erro que parece óbvio e que, nesta base, apaga a tela inteira: as três
 * Beauty Sessions reais estão marcadas para depois de hoje.
 */
function dentroDoPeriodo(linha, dias, campoData) {
  if (dias === null || dias === undefined) return true
  const dia = diaLocal(linha[campoData])
  // Sem data para comparar, não há como decidir por ela — a linha fica.
  if (!dia) return true
  const corte = hojeLocal()
  corte.setDate(corte.getDate() - Number(dias))
  return dia.getTime() >= corte.getTime()
}

export function filtrar(lista, filtro, campos = {}) {
  const f = { ...FILTRO_VAZIO, ...(filtro || {}) }
  const busca = achatar(f.busca)
  const camposDeBusca = campos.busca || ['codigo']
  const campoData = campos.data || 'quando'

  const recortada = (lista || []).filter((linha) => {
    if (!passaNaSituacao(linha, f.situacao)) return false
    if (f.loja && linha[campos.loja || 'loja'] !== f.loja) return false
    if (f.estagio && linha[campos.estagio || 'estagio'] !== f.estagio) return false
    if (!dentroDoPeriodo(linha, f.dias, campoData)) return false
    if (busca && !camposDeBusca.some((c) => achatar(linha[c]).includes(busca))) return false
    return true
  })

  const dataOrdenar = (l) => new Date(l.quando || l.criado_em || 0).getTime()
  const ordens = {
    'data-nova':   (a, b) => dataOrdenar(b) - dataOrdenar(a),
    'data-antiga': (a, b) => dataOrdenar(a) - dataOrdenar(b),
    'nome':        (a, b) => achatar(a.nome).localeCompare(achatar(b.nome)),
    'aberturas':   (a, b) => (b.aberturas || 0) - (a.aberturas || 0),
  }
  return recortada.sort(ordens[f.ordem] || ordens['data-nova'])
}
