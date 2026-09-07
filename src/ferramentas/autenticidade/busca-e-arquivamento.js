// A BUSCA E O ARQUIVAMENTO DO PAINEL DE AUTENTICIDADE.
//
// POR QUE EXISTE: a tela acumulava tudo para sempre. Com 50 lotes a aba Lotes
// vira um muro, o seletor da aba Gravar oferece 50 lotes dos quais 40 não têm
// mais nada a fazer, e a aba Etiquetas lista todas as gravações desde o começo.
// Quem procura a peça de ontem rola por cima de tudo o que já foi resolvido.
//
// NADA DISSO TOCA O BANCO. Não há coluna "encerrado", não há migration, não há
// função nova: um lote está ENCERRADO quando todas as peças dele já foram
// gravadas ou baixadas, e isso a tela já sabia calcular (`progressoDoLote` e
// `naFila`, em lotes.js). O arquivamento é uma LEITURA, não um estado gravado —
// desfazer uma baixa devolve o lote para "em andamento" sozinho, sem ninguém
// precisar lembrar de destravar nada.
//
// Contas puras: sem DOM, sem rede, sem Vue. É por isso que dá para provar a
// regra de "encerrado", o intervalo de datas e cada campo da busca sem abrir
// navegador.
import { naFila, numeroDeSerie } from './lotes.js'

// ── TEXTO: SEM ACENTO E SEM CAIXA ─────────────────────────────────────────
// A IDEIA vem do `procurarProduto` de `produtos-do-bling.js` — ninguém digita
// "Mônaco" com o chapéu quando está com pressa. O código é próprio porque o que
// se busca aqui é outra coisa (lote, peça e código), e a limpeza de lá carrega
// regras do catálogo do Bling que não valem aqui.
//
// O HÍFEN VIRA ESPAÇO de propósito: as referências chegam como "SS1088-Mostarda"
// e quem procura digita "SS1088 Mostarda" ou só "mostarda". Sem isto, a busca
// por duas palavras não acharia a referência de uma palavra só.
export function semAcentoNemCaixa(texto) {
  return String(texto ?? '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[-_/]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// O NÚMERO DE SÉRIE DE UMA PEÇA CASA EXATO. Nunca por pedaço: número jogado
// dentro do palheiro de texto devolve meia lista, porque um pedaço de número
// aparece em quase todo código. Desde 02/09/2026 é ESTE o número que está
// impresso na bolsa, então é por ele que se procura primeiro.
//
// ⚠️ A TRAVA "SÓ DÍGITO" SAIU EM 07/09/2026, junto com a mudança que pôs as
// letras dentro do número de série. Ela não era decisão própria: era o jeito de
// dizer "isto parece um número de série" quando número de série só tinha
// dígito. Mantê-la teria desligado esta busca inteira em silêncio — `SS0002HBB2001`
// não passa por `^\d+$`, e quem digitasse o número da bolsa não acharia nada.
//
// O que separa agora é a IGUALDADE EXATA, que já era a regra: "1" digitado
// sozinho continua não casando com nada, porque não é igual a número nenhum.
// A pontuação sai dos dois lados, então quem digita o SKU do jeito do Bling
// (`SS0002HB.B2` + `001`) acha a mesma peça que quem copia o que está gravado.
export function ehONumeroDeSerie(texto, sku, numeroNaSerie) {
  const t = String(texto ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')
  if (!t) return false
  const serie = numeroDeSerie(sku, numeroNaSerie)
  return Boolean(serie) && serie === t
}

// CADA PALAVRA DIGITADA TEM DE APARECER em algum lugar do que se procura, e não
// a frase inteira em ordem: quem digita "monaco quartz" está juntando duas
// pistas que moram em campos diferentes (o modelo e a cor), e exigir a frase
// exata devolveria lista vazia com o dado ali na tela.
function combina(termo, ...campos) {
  const t = semAcentoNemCaixa(termo)
  if (!t) return true
  const palheiro = campos.map((c) => semAcentoNemCaixa(c)).filter(Boolean).join(' ')
  return t.split(' ').every((palavra) => palheiro.includes(palavra))
}

// ── O PALHEIRO UNIVERSAL ───────────────────────────────────────────────────
//
// ⚠️ A LISTA É DE EXCEÇÕES, NUNCA DE INCLUSÕES, e essa inversão é o ponto.
// Antes a busca recebia os campos escritos à mão — `p.codigo, l.modelo, l.cor,
// l.sku`. Campo novo na etiqueta nascia INVISÍVEL para a busca, e ninguém
// descobria: não dá erro, só não acha. Lista de inclusão cresce para sempre e
// depende de alguém lembrar; lista de exceção é curta e praticamente não muda.
// Pedido do dono em 04/09/2026, pensando nos campos que ainda vão nascer.
//
// SÃO DUAS PENEIRAS, e a segunda é a que sobrevive ao futuro:
//   1. POR NOME — os identificadores internos que já conhecemos.
//   2. POR FORMA — qualquer valor que SEJA um identificador, mesmo em coluna
//      que ninguém pensou em excluir. É o que impede a coluna nova `pedido_id`
//      de envenenar a busca no dia em que ela nascer: identificadores são
//      hexadecimais e contêm todas as letras de a até f, então digitar "a"
//      sozinho casaria com quase tudo.
export const FORA_DA_BUSCA = new Set(['id', 'lote_id', 'criado_por', 'fotos'])

const PARECE_IDENTIFICADOR = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const PARECE_MOMENTO = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}|$)/

const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']

// DATA ENTRA LEGÍVEL, E NÃO COMO O BANCO A GUARDA. `2026-09-03T00:42:59Z` não é
// o que ninguém digita: quem procura escreve "03/09" ou "setembro". O dia sai
// pelo fuso de São Paulo, o mesmo que a tela mostra — senão uma gravação das
// 22h apareceria como o dia seguinte na busca e não na lista.
function momentoLegivel(valor) {
  const dia = diaDeSaoPaulo(valor)
  if (!dia) return ''
  const [ano, mes, d] = dia.split('-')
  return `${d}/${mes}/${ano} ${d}/${mes} ${MESES[Number(mes) - 1] || ''} ${ano}`
}

function pedacosDoValor(valor, profundidade) {
  if (valor == null) return []
  if (typeof valor === 'boolean') return []          // ninguém digita "true"
  if (typeof valor === 'number') return [String(valor)]
  if (typeof valor === 'string') {
    const t = valor.trim()
    if (!t) return []
    if (PARECE_IDENTIFICADOR.test(t)) return []
    if (PARECE_MOMENTO.test(t)) return [t, momentoLegivel(t)]
    return [t]
  }
  if (Array.isArray(valor)) return valor.flatMap((v) => pedacosDoValor(v, profundidade))
  if (typeof valor === 'object') return profundidade > 0 ? pedacosDoObjeto(valor, profundidade - 1) : []
  return []
}

function pedacosDoObjeto(objeto, profundidade) {
  return Object.entries(objeto || {})
    .filter(([chave]) => !FORA_DA_BUSCA.has(chave))
    .flatMap(([, valor]) => pedacosDoValor(valor, profundidade))
}

/**
 * Tudo o que se pode procurar num objeto, numa string só.
 *
 * A profundidade de 1 nível existe para o dia em que a etiqueta carregar um
 * objeto dentro dela (um registro de garantia embutido, por exemplo) sem que
 * alguém precise vir aqui ligar isso.
 */
export function palheiroDe(objeto, { profundidade = 1 } = {}) {
  return pedacosDoObjeto(objeto, profundidade).join(' ')
}

// ── DATA: O DIA EM SÃO PAULO, NUNCA O DIA EM UTC ──────────────────────────
// O banco guarda a hora em UTC. Uma gravação feita às 22h de terça é
// "quarta-feira" em UTC — e um filtro de "hoje" feito no dia cru esconderia
// justamente o trabalho da noite anterior, que é o que a pessoa está
// procurando. Mesmo fuso do `dataCurta` da tela (America/Sao_Paulo).
//
// A data de dia inteiro ('2026-08-30', que é como `fabricado_em` chega) NÃO
// passa por conversão nenhuma: ela já é um dia, e passá-la por um fuso a
// empurraria um dia para trás.
const RELOGIO = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
})

export function diaDeSaoPaulo(valor) {
  if (valor == null || valor === '') return ''
  const texto = String(valor).trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(texto)) return texto
  const d = new Date(texto)
  if (Number.isNaN(d.getTime())) return ''
  // 'en-CA' devolve exatamente 'AAAA-MM-DD', que é o formato que o `<input
  // type="date">` usa e o único que se compara direito como texto.
  return RELOGIO.format(d)
}

// Somar dias num DIA (não num instante) sem cair na armadilha do horário de
// verão: a conta é feita ao meio-dia UTC, longe das duas bordas do dia.
function somarDias(dia, quantos) {
  const [a, m, d] = String(dia).split('-').map(Number)
  const base = new Date(Date.UTC(a, m - 1, d, 12))
  base.setUTCDate(base.getUTCDate() + quantos)
  return base.toISOString().slice(0, 10)
}

// ── OS ATALHOS DE DATA ────────────────────────────────────────────────────
// Ninguém digita duas datas para ver o que fez esta semana. Os atalhos são a
// busca de verdade; os dois campos de data continuam ali para o caso raro.
//
// 'tudo' é o primeiro de propósito: ele é o jeito de VOLTAR, e atalho que só
// aperta e não solta prende a pessoa no recorte sem ela entender por quê.
export const ATALHOS_DE_DATA = [
  { chave: 'tudo', rotulo: 'Qualquer data' },
  { chave: 'hoje', rotulo: 'Hoje' },
  { chave: '7d', rotulo: 'Últimos 7 dias' },
  { chave: '30d', rotulo: 'Últimos 30 dias' },
  { chave: 'mes', rotulo: 'Este mês' },
  { chave: 'ano', rotulo: 'Este ano' },
]

/**
 * O intervalo de um atalho, em dias de São Paulo.
 * `hoje` entra por parâmetro — prova com data cravada envelhece e passa a mentir
 * no dia seguinte, então o teste ancora no dia que ele mesmo escolhe.
 */
export function intervaloDoAtalho(chave, hoje = new Date()) {
  const dia = diaDeSaoPaulo(hoje) || diaDeSaoPaulo(new Date())
  switch (chave) {
    case 'hoje': return { de: dia, ate: dia }
    // 7 dias CONTANDO HOJE: "últimos 7 dias" numa fábrica é a semana que está
    // acontecendo, não os 7 anteriores ao de hoje.
    case '7d': return { de: somarDias(dia, -6), ate: dia }
    case '30d': return { de: somarDias(dia, -29), ate: dia }
    case 'mes': return { de: `${dia.slice(0, 7)}-01`, ate: dia }
    case 'ano': return { de: `${dia.slice(0, 4)}-01-01`, ate: dia }
    default: return { de: '', ate: '' }
  }
}

/**
 * O dia do valor está entre `de` e `ate`? Os dois lados são opcionais, e as
 * duas bordas entram (quem escolhe "de 01 até 05" espera ver o dia 05).
 *
 * REGISTRO SEM DATA FICA DE FORA quando há filtro de data — e isto é decisão,
 * não descuido: um filtro de data é uma pergunta sobre datas, e o que não tem
 * data não responde a ela. Nada some de verdade: a contagem "N de M" continua
 * dizendo quantos ficaram escondidos, e limpar o filtro traz todos de volta.
 */
export function dentroDoIntervalo(valor, de = '', ate = '') {
  if (!de && !ate) return true
  const dia = diaDeSaoPaulo(valor)
  if (!dia) return false
  if (de && dia < de) return false
  if (ate && dia > ate) return false
  return true
}

// ── O ESTADO DE UM LOTE ───────────────────────────────────────────────────
//
// ENCERRADO = todas as peças já foram gravadas ou baixadas. A baixada sai da
// conta pelo mesmo motivo do `progressoDoLote`: ela não vai virar bolsa, e se
// ficasse no total o lote nunca fecharia.
//
// LOTE SEM PEÇA NENHUMA NÃO É ENCERRADO. Pela letra da regra ele seria — "todas
// as zero peças foram gravadas" —, mas lote sem peça é anomalia (o banco cria
// as peças junto com o lote), e mandar uma anomalia para trás do botão de
// encerrados é escondê-la de quem precisa vê-la.
export function estadoDoLote(pecasDoLote) {
  const todas = Array.isArray(pecasDoLote) ? pecasDoLote : []
  const fila = todas.filter(naFila)
  const gravadas = fila.filter((p) => p.gravada_em).length
  const porGravar = fila.length - gravadas
  return {
    todas: todas.length,
    total: fila.length,
    gravadas,
    porGravar,
    baixadas: todas.length - fila.length,
    semPecas: todas.length === 0,
    encerrado: todas.length > 0 && porGravar === 0,
  }
}

// O selo do cartão do lote. Sai das classes prontas do PADRAO-DA-CENTRAL, nunca
// de cor à mão — e o rótulo é escrito, porque cor sozinha some para quem não a
// enxerga.
export function seloDoLote(estado) {
  const e = estado || {}
  if (e.semPecas) return { rotulo: 'Sem peça nenhuma', selo: 'selo-erro' }
  if (e.encerrado) return { rotulo: 'Encerrado', selo: 'selo-ok' }
  return { rotulo: `${e.porGravar} por gravar`, selo: 'selo-info' }
}

export const ESTADOS_DE_LOTE = [
  { chave: 'todos', rotulo: 'Todos os estados' },
  { chave: 'andamento', rotulo: 'Em andamento' },
  { chave: 'encerrado', rotulo: 'Encerrado' },
  // O lote que tem peça baixada é o que alguém vai precisar explicar depois:
  // ele existe na produção e não vai virar bolsa inteira.
  { chave: 'com_baixa', rotulo: 'Com peça baixada' },
]

export const ESTADOS_DE_ETIQUETA = [
  { chave: 'todas', rotulo: 'Todos os estados' },
  { chave: 'ativa', rotulo: 'Gravada, na bolsa' },
  { chave: 'baixada', rotulo: 'Baixada' },
  { chave: 'garantia', rotulo: 'Com garantia de cliente' },
]

// A DATA DE UM LOTE, para a busca: a de fabricação quando existe, senão a de
// criação. `fabricado_em` é opcional no formulário, e filtrar só por ele jogaria
// para fora todo lote criado sem essa data — que é a maioria dos lotes de
// pressa. A de criação é a verdade que sempre existe.
export function dataDoLote(lote) {
  const l = lote || {}
  return l.fabricado_em || l.criado_em || ''
}

/**
 * Os lotes que a aba Lotes mostra.
 *
 * @param {Array}  lotes
 * @param {object} opcoes
 * @param {function} opcoes.pecasDoLote  id → as peças daquele lote
 * @param {string} opcoes.texto     modelo, cor, referência, CÓDIGO DE PEÇA ou NÚMERO DE SÉRIE
 * @param {string} opcoes.de/ate    dia 'AAAA-MM-DD', os dois opcionais
 * @param {string} opcoes.estado    'todos' | 'andamento' | 'encerrado' | 'com_baixa'
 */
export function filtrarLotes(lotes, {
  pecasDoLote = () => [], texto = '', de = '', ate = '', estado = 'andamento',
} = {}) {
  return (Array.isArray(lotes) ? lotes : []).filter((l) => {
    if (!l) return false
    const e = estadoDoLote(pecasDoLote(l.id))
    if (estado === 'andamento' && e.encerrado) return false
    if (estado === 'encerrado' && !e.encerrado) return false
    if (estado === 'com_baixa' && !e.baixadas) return false
    if (!dentroDoIntervalo(dataDoLote(l), de, ate)) return false
    if (!texto) return true
    // O CÓDIGO DA PEÇA ACHA O LOTE. Quem tem a etiqueta na mão tem o código, e
    // não o modelo: sem isto, o caminho de "esta bolsa aqui é de qual lote?"
    // não existia em lugar nenhum da tela.
    // ⚠️ O LOTE INTEIRO, e não campos escolhidos — ver `palheiroDe`.
    if (combina(texto, palheiroDe(l))) return true
    // E AS PEÇAS DELE TAMBÉM POR INTEIRO. Antes só o código da peça achava o
    // lote; agora qualquer coisa que esteja na peça acha — inclusive campo que
    // ainda não existe.
    return pecasDoLote(l.id).some((p) => combina(texto, palheiroDe(p))
      || ehONumeroDeSerie(texto, l.sku, p?.numero_na_serie))
  })
}

/**
 * Os lotes que o seletor da aba Gravar oferece.
 *
 * SÓ QUEM TEM PEÇA POR GRAVAR, porque essa aba é uma fila de trabalho: oferecer
 * lote encerrado é oferecer trabalho que não existe.
 *
 * DUAS EXCEÇÕES, e as duas são para a tela não mentir:
 *  · o lote ESCOLHIDO nunca sai da lista, nem pelo estado nem pela busca. Ao
 *    gravar a última peça o lote encerra na hora — e se ele sumisse do seletor,
 *    o seletor ficaria em branco e o ✓ da etiqueta que a pessoa acabou de
 *    encostar sumiria junto;
 *  · com `incluirEncerrados`, os encerrados voltam. Sem isso, a lista das peças
 *    baixadas (o único caminho para DESFAZER uma baixa) ficaria inalcançável
 *    num lote já encerrado.
 */
export function lotesParaGravar(lotes, {
  pecasDoLote = () => [], texto = '', de = '', ate = '', escolhido = null, incluirEncerrados = false,
} = {}) {
  return (Array.isArray(lotes) ? lotes : []).filter((l) => {
    if (!l) return false
    if (l.id === escolhido) return true
    if (!incluirEncerrados && estadoDoLote(pecasDoLote(l.id)).encerrado) return false
    if (!dentroDoIntervalo(dataDoLote(l), de, ate)) return false
    if (!texto) return true
    // ⚠️ O LOTE INTEIRO, e não campos escolhidos — ver `palheiroDe`.
    if (combina(texto, palheiroDe(l))) return true
    // E AS PEÇAS DELE TAMBÉM POR INTEIRO. Antes só o código da peça achava o
    // lote; agora qualquer coisa que esteja na peça acha — inclusive campo que
    // ainda não existe.
    return pecasDoLote(l.id).some((p) => combina(texto, palheiroDe(p))
      || ehONumeroDeSerie(texto, l.sku, p?.numero_na_serie))
  })
}

/** Quantos lotes ainda têm peça por gravar — o número da frase de "não há". */
export function lotesComPecaPorGravar(lotes, pecasDoLote = () => []) {
  return (Array.isArray(lotes) ? lotes : [])
    .filter((l) => l && !estadoDoLote(pecasDoLote(l.id)).encerrado).length
}

/**
 * As etiquetas que a aba Etiquetas mostra, dentro do recorte de
 * `etiquetasGravadas` (lotes.js) que já vem de fora.
 *
 * @param {function} opcoes.loteDaPeca   lote_id → o lote, ou nulo
 * @param {Set}      opcoes.comGarantia  códigos com garantia de cliente
 */
export function filtrarEtiquetas(etiquetas, {
  loteDaPeca = () => null, comGarantia = new Set(), texto = '', de = '', ate = '', estado = 'todas',
} = {}) {
  return (Array.isArray(etiquetas) ? etiquetas : []).filter((p) => {
    if (!p) return false
    const codigo = String(p.codigo ?? '').trim().toUpperCase()
    if (estado === 'baixada' && !p.baixada) return false
    if (estado === 'ativa' && p.baixada) return false
    if (estado === 'garantia' && !comGarantia.has(codigo)) return false
    // A DATA AQUI É A DA GRAVAÇÃO, e é a única que faz sentido nesta aba: quem
    // vem consertar uma gravação errada lembra de QUANDO gravou, não de quando
    // o lote foi fabricado.
    if (!dentroDoIntervalo(p.gravada_em, de, ate)) return false
    if (!texto) return true
    // TERMO SÓ DE DÍGITOS TAMBÉM É O NÚMERO DA SÉRIE, e casa EXATO.
    // Jogar `nº 7` dentro do palheiro de texto não serve: o "n" sozinho casa
    // com tudo, e digitar "7" devolvia 37 das 102 etiquetas. Aqui "7" acha a
    // peça nº 7 — e continua achando os códigos que tenham 7, pela linha de
    // baixo, porque quem digita um pedaço de código está procurando por ele.
    const t = semAcentoNemCaixa(texto)
    const l = loteDaPeca(p.lote_id) || {}
    // O NÚMERO DE SÉRIE PRIMEIRO: é o que está impresso na bolsa desde
    // 02/09/2026, e é o que a dica do campo promete achar. Ele NÃO substitui a
    // linha de baixo (PADRÃO item 8): quem tem a ordem de produção antiga na
    // mesa procura pelo número da peça sozinho, e continua achando.
    if (ehONumeroDeSerie(texto, l.sku, p.numero_na_serie)) return true
    if (/^\d+$/.test(t) && Number(p.numero_na_serie) === Number(t)) return true
    // ⚠️ A PEÇA E O LOTE INTEIROS, e não campos escolhidos. Ver `palheiroDe`:
    // a lista é de exceções, para que campo novo entre sozinho.
    return combina(texto, palheiroDe(p), palheiroDe(l))
  })
}

/**
 * "Mostrando 12 de 87 lotes."
 *
 * A CONTAGEM É OBRIGATÓRIA, e não enfeite: lista recortada sem número faz a
 * pessoa achar que perdeu dado — e nesta tela o dado é o link que ficou dentro
 * de uma bolsa de couro.
 */
export function fraseDaContagem(mostrados, total, { um = 'item', muitos = 'itens' } = {}) {
  const m = Number(mostrados) || 0
  const t = Number(total) || 0
  return `Mostrando ${m} de ${t} ${t === 1 ? um : muitos}`
}

/** Há algum recorte ligado? É o que decide se o botão "Limpar" aparece. */
export function filtroAtivo({ texto = '', de = '', ate = '', estado = '' } = {}, estadoPadrao = '') {
  return Boolean(texto.trim() || de || ate || (estado && estado !== estadoPadrao))
}
