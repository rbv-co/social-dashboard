/* A BUSCA E O ARQUIVAMENTO — as contas puras.
 *
 * Aqui se prova o que a tela só chama: quando um lote está ENCERRADO, o que cada
 * atalho de data recorta, e cada campo da busca (data, modelo, referência,
 * código da peça e estado).
 *
 * ⚠️ NENHUM TESTE DESTE ARQUIVO CRAVA A DATA DE HOJE. Prova com data cravada
 * envelhece e passa a mentir no dia seguinte — o `hoje` entra por parâmetro, e
 * as amostras são construídas A PARTIR dele.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  semAcentoNemCaixa, diaDeSaoPaulo, ATALHOS_DE_DATA, intervaloDoAtalho, dentroDoIntervalo,
  estadoDoLote, seloDoLote, ESTADOS_DE_LOTE, ESTADOS_DE_ETIQUETA, dataDoLote,
  filtrarLotes, lotesParaGravar, lotesComPecaPorGravar, filtrarEtiquetas,
  fraseDaContagem, filtroAtivo,
} from './busca-e-arquivamento.js'

/* ── TEXTO ────────────────────────────────────────────────────────────────── */

test('semAcentoNemCaixa: tira acento, caixa e hífen', () => {
  assert.equal(semAcentoNemCaixa('Mônaco'), 'monaco')
  assert.equal(semAcentoNemCaixa('  Off-White  '), 'off white')
  assert.equal(semAcentoNemCaixa('SS1088-Mostarda'), 'ss1088 mostarda')
  assert.equal(semAcentoNemCaixa(null), '')
})

test('semAcentoNemCaixa: o acento decomposto (NFD) some igual ao composto', () => {
  // o Bling manda "ç" das duas formas, e a que ficasse de fora nunca casaria
  assert.equal(semAcentoNemCaixa('Florença'), semAcentoNemCaixa('Florença'))
})

/* ── DATA ─────────────────────────────────────────────────────────────────── */

test('diaDeSaoPaulo: a data de dia inteiro NÃO passa por fuso nenhum', () => {
  // passá-la por um fuso a empurraria um dia para trás
  assert.equal(diaDeSaoPaulo('2026-08-30'), '2026-08-30')
})

test('diaDeSaoPaulo: as 22h de São Paulo continuam sendo o dia de São Paulo', () => {
  // 30/08 às 22h em São Paulo é 31/08 às 01h em UTC. Lendo o dia cru, o
  // trabalho da noite sumiria do filtro de "hoje" — que é justamente o que a
  // pessoa está procurando na manhã seguinte.
  assert.equal(diaDeSaoPaulo('2026-08-31T01:00:00Z'), '2026-08-30')
  assert.equal(diaDeSaoPaulo('2026-08-30T12:00:00Z'), '2026-08-30')
})

test('diaDeSaoPaulo: valor vazio ou impossível devolve vazio, não a data de hoje', () => {
  assert.equal(diaDeSaoPaulo(null), '')
  assert.equal(diaDeSaoPaulo(''), '')
  assert.equal(diaDeSaoPaulo('bolacha'), '')
})

test('intervaloDoAtalho: cada atalho recorta o que promete', () => {
  const hoje = '2026-08-30'   // um domingo, no meio do mês e no meio do ano
  assert.deepEqual(intervaloDoAtalho('tudo', hoje), { de: '', ate: '' })
  assert.deepEqual(intervaloDoAtalho('hoje', hoje), { de: '2026-08-30', ate: '2026-08-30' })
  // 7 dias CONTANDO hoje: numa fábrica "últimos 7 dias" é a semana que está
  // acontecendo, e não os 7 anteriores ao de hoje
  assert.deepEqual(intervaloDoAtalho('7d', hoje), { de: '2026-08-24', ate: '2026-08-30' })
  assert.deepEqual(intervaloDoAtalho('30d', hoje), { de: '2026-08-01', ate: '2026-08-30' })
  assert.deepEqual(intervaloDoAtalho('mes', hoje), { de: '2026-08-01', ate: '2026-08-30' })
  assert.deepEqual(intervaloDoAtalho('ano', hoje), { de: '2026-01-01', ate: '2026-08-30' })
})

test('intervaloDoAtalho: atravessar a virada do mês e do ano não quebra a conta', () => {
  assert.deepEqual(intervaloDoAtalho('7d', '2026-03-02'), { de: '2026-02-24', ate: '2026-03-02' })
  assert.deepEqual(intervaloDoAtalho('30d', '2026-01-05'), { de: '2025-12-07', ate: '2026-01-05' })
  assert.deepEqual(intervaloDoAtalho('mes', '2026-01-05'), { de: '2026-01-01', ate: '2026-01-05' })
})

test('intervaloDoAtalho: o horário de verão não come nem inventa um dia', () => {
  // a conta é feita ao meio-dia UTC, longe das duas bordas do dia
  assert.deepEqual(intervaloDoAtalho('hoje', '2026-10-18'), { de: '2026-10-18', ate: '2026-10-18' })
  assert.deepEqual(intervaloDoAtalho('7d', '2026-02-21'), { de: '2026-02-15', ate: '2026-02-21' })
})

test('ATALHOS_DE_DATA: todos os atalhos que a tela oferece têm intervalo', () => {
  const hoje = '2026-08-30'
  for (const a of ATALHOS_DE_DATA) {
    const i = intervaloDoAtalho(a.chave, hoje)
    assert.ok(a.rotulo.length > 3, `o atalho ${a.chave} precisa de rótulo`)
    if (a.chave === 'tudo') continue
    assert.ok(i.de && i.ate, `o atalho ${a.chave} não recorta nada — a tela ofereceria um botão morto`)
    assert.ok(i.de <= i.ate)
  }
})

test('dentroDoIntervalo: as duas bordas entram', () => {
  assert.equal(dentroDoIntervalo('2026-08-01', '2026-08-01', '2026-08-05'), true)
  assert.equal(dentroDoIntervalo('2026-08-05', '2026-08-01', '2026-08-05'), true)
  assert.equal(dentroDoIntervalo('2026-07-31', '2026-08-01', '2026-08-05'), false)
  assert.equal(dentroDoIntervalo('2026-08-06', '2026-08-01', '2026-08-05'), false)
})

test('dentroDoIntervalo: sem filtro nenhum, tudo passa — inclusive o que não tem data', () => {
  assert.equal(dentroDoIntervalo('2026-08-01'), true)
  assert.equal(dentroDoIntervalo(null), true)
  assert.equal(dentroDoIntervalo('', '', ''), true)
})

test('dentroDoIntervalo: com filtro de data, o que não tem data fica de fora', () => {
  // decisão escrita: filtro de data é uma pergunta sobre datas, e o que não tem
  // data não responde a ela. A contagem "N de M" continua dizendo que ele existe.
  assert.equal(dentroDoIntervalo(null, '2026-08-01', ''), false)
  assert.equal(dentroDoIntervalo('', '', '2026-08-05'), false)
})

test('dentroDoIntervalo: só um dos lados também vale', () => {
  assert.equal(dentroDoIntervalo('2026-08-10', '2026-08-01', ''), true)
  assert.equal(dentroDoIntervalo('2026-07-10', '2026-08-01', ''), false)
  assert.equal(dentroDoIntervalo('2026-07-10', '', '2026-08-01'), true)
})

/* ── O ESTADO DE UM LOTE ──────────────────────────────────────────────────── */

const peca = (n, extra = {}) => ({
  codigo: `COD${String(n).padStart(3, '0')}`, numero_na_serie: n, ...extra,
})
const GRAVADA = { gravada_em: '2026-08-20T10:00:00Z' }

test('estadoDoLote: lote com peça por gravar está EM ANDAMENTO', () => {
  const e = estadoDoLote([peca(1, GRAVADA), peca(2)])
  assert.equal(e.encerrado, false)
  assert.equal(e.porGravar, 1)
  assert.equal(e.gravadas, 1)
  assert.equal(e.total, 2)
})

test('estadoDoLote: todas gravadas = ENCERRADO', () => {
  const e = estadoDoLote([peca(1, GRAVADA), peca(2, GRAVADA)])
  assert.equal(e.encerrado, true)
  assert.equal(e.porGravar, 0)
})

test('estadoDoLote: gravadas OU baixadas = ENCERRADO', () => {
  // é a regra que o dono escreveu: "todas as peças foram gravadas ou baixadas"
  const e = estadoDoLote([peca(1, GRAVADA), peca(2, { baixada: true, baixa_motivo: 'defeito' })])
  assert.equal(e.encerrado, true)
  assert.equal(e.baixadas, 1)
  assert.equal(e.total, 1, 'a baixada sai dos dois números, como no progressoDoLote')
})

test('estadoDoLote: lote inteiro baixado também está encerrado', () => {
  const e = estadoDoLote([peca(1, { baixada: true }), peca(2, { baixada: true })])
  assert.equal(e.encerrado, true)
  assert.equal(e.total, 0)
})

test('estadoDoLote: lote SEM PEÇA NENHUMA não é encerrado — é anomalia à vista', () => {
  // pela letra da regra ele seria ("todas as zero peças foram gravadas"), mas
  // mandar uma anomalia para trás do botão de encerrados é escondê-la
  const e = estadoDoLote([])
  assert.equal(e.encerrado, false)
  assert.equal(e.semPecas, true)
})

test('estadoDoLote: desfazer a baixa devolve o lote para "em andamento" sozinho', () => {
  // o arquivamento é LEITURA, não estado gravado: ninguém precisa destravar nada
  const pecas = [peca(1, GRAVADA), peca(2, { baixada: true })]
  assert.equal(estadoDoLote(pecas).encerrado, true)
  pecas[1].baixada = false
  assert.equal(estadoDoLote(pecas).encerrado, false)
})

test('seloDoLote: o estado é ESCRITO, não só colorido', () => {
  assert.equal(seloDoLote(estadoDoLote([peca(1, GRAVADA)])).rotulo, 'Encerrado')
  assert.equal(seloDoLote(estadoDoLote([peca(1), peca(2)])).rotulo, '2 por gravar')
  assert.equal(seloDoLote(estadoDoLote([])).rotulo, 'Sem peça nenhuma')
  for (const s of [estadoDoLote([]), estadoDoLote([peca(1)]), estadoDoLote([peca(1, GRAVADA)])]) {
    // o selo sai das classes prontas do PADRAO-DA-CENTRAL, nunca de cor à mão
    assert.match(seloDoLote(s).selo, /^selo-(ok|info|erro|atencao|neutro)$/)
  }
})

test('dataDoLote: sem data de fabricação, vale a de criação', () => {
  // `fabricado_em` é opcional no formulário; filtrar só por ele jogaria fora
  // todo lote criado com pressa
  assert.equal(dataDoLote({ fabricado_em: '2026-08-01', criado_em: '2026-08-10T09:00:00Z' }), '2026-08-01')
  assert.equal(dataDoLote({ fabricado_em: null, criado_em: '2026-08-10T09:00:00Z' }), '2026-08-10T09:00:00Z')
  assert.equal(dataDoLote(null), '')
})

/* ── A BUSCA DE LOTES ─────────────────────────────────────────────────────── */

const LOTES = [
  { id: 'a', modelo: 'Mônaco', cor: 'Quartz', sku: 'SS1088-Quartz', fabricado_em: '2026-08-28' },
  { id: 'b', modelo: 'Angers', cor: 'Caramelo', sku: 'SS1234-Caramelo', fabricado_em: '2026-08-02' },
  { id: 'c', modelo: 'Florença', cor: 'Off White', sku: 'SS1500-Off-White', fabricado_em: null, criado_em: '2026-07-15T10:00:00Z' },
]
const PECAS = {
  a: [peca(1, GRAVADA), peca(2)],                                   // em andamento
  b: [{ codigo: 'ZZZ999', numero_na_serie: 1, ...GRAVADA }],        // encerrado
  c: [peca(1, GRAVADA), peca(2, { baixada: true })],                // encerrado, com baixa
}
const pecasDoLote = (id) => PECAS[id] || []
const ids = (lista) => lista.map((l) => l.id)

test('filtrarLotes: a aba abre nos EM ANDAMENTO', () => {
  assert.deepEqual(ids(filtrarLotes(LOTES, { pecasDoLote, estado: 'andamento' })), ['a'])
})

test('filtrarLotes: os encerrados continuam alcançáveis — nada some de verdade', () => {
  assert.deepEqual(ids(filtrarLotes(LOTES, { pecasDoLote, estado: 'encerrado' })), ['b', 'c'])
  assert.deepEqual(ids(filtrarLotes(LOTES, { pecasDoLote, estado: 'todos' })), ['a', 'b', 'c'])
})

test('filtrarLotes: dá para pedir só os lotes com peça baixada', () => {
  assert.deepEqual(ids(filtrarLotes(LOTES, { pecasDoLote, estado: 'com_baixa' })), ['c'])
})

test('filtrarLotes: busca por modelo, sem acento e sem caixa', () => {
  const achados = filtrarLotes(LOTES, { pecasDoLote, estado: 'todos', texto: 'florenca' })
  assert.deepEqual(ids(achados), ['c'])
})

test('filtrarLotes: busca por referência, com ou sem o hífen', () => {
  assert.deepEqual(ids(filtrarLotes(LOTES, { pecasDoLote, estado: 'todos', texto: 'SS1234' })), ['b'])
  assert.deepEqual(ids(filtrarLotes(LOTES, { pecasDoLote, estado: 'todos', texto: 'ss1500 off white' })), ['c'])
})

test('filtrarLotes: duas palavras de campos diferentes acham o mesmo lote', () => {
  // "monaco quartz" é o modelo mais a cor; exigir a frase exata devolveria
  // lista vazia com o dado ali na tela
  assert.deepEqual(ids(filtrarLotes(LOTES, { pecasDoLote, estado: 'todos', texto: 'monaco quartz' })), ['a'])
})

test('filtrarLotes: o CÓDIGO DA PEÇA acha o lote dela', () => {
  // quem está com a etiqueta na mão tem o código, não o modelo — este era o
  // caminho que não existia em lugar nenhum da tela
  assert.deepEqual(ids(filtrarLotes(LOTES, { pecasDoLote, estado: 'todos', texto: 'ZZZ999' })), ['b'])
  assert.deepEqual(ids(filtrarLotes(LOTES, { pecasDoLote, estado: 'todos', texto: 'zzz999' })), ['b'])
})

test('filtrarLotes: busca que não acha nada devolve lista vazia, e não a lista toda', () => {
  assert.deepEqual(ids(filtrarLotes(LOTES, { pecasDoLote, estado: 'todos', texto: 'bolacha' })), [])
})

test('filtrarLotes: por data de fabricação, e pela de criação quando não há a de fabricação', () => {
  const so = (de, ate) => ids(filtrarLotes(LOTES, { pecasDoLote, estado: 'todos', de, ate }))
  assert.deepEqual(so('2026-08-01', '2026-08-31'), ['a', 'b'])
  assert.deepEqual(so('2026-07-01', '2026-07-31'), ['c'], 'o lote sem data de fabricação entra pela de criação')
  assert.deepEqual(so('2026-08-28', ''), ['a'])
})

test('filtrarLotes: data e texto se somam, não se substituem', () => {
  const r = filtrarLotes(LOTES, { pecasDoLote, estado: 'todos', texto: 'ss', de: '2026-08-01', ate: '2026-08-31' })
  assert.deepEqual(ids(r), ['a', 'b'])
})

test('filtrarLotes: a ordem que chegou é a ordem que sai', () => {
  // a tela já entrega os lotes do mais novo para o mais velho; reordenar aqui
  // faria a lista trocar de ordem sozinha ao digitar
  assert.deepEqual(ids(filtrarLotes(LOTES, { pecasDoLote, estado: 'todos' })), ['a', 'b', 'c'])
})

test('filtrarLotes: lista vazia ou estranha não estoura', () => {
  assert.deepEqual(filtrarLotes(null, {}), [])
  assert.deepEqual(filtrarLotes([null], { pecasDoLote, estado: 'todos' }), [])
  assert.deepEqual(ids(filtrarLotes(LOTES, { pecasDoLote })), ['a'],
    'sem dizer o estado, o padrão é "em andamento"')
  // sem saber as peças, nenhum lote é encerrado: a tela mostra tudo em vez de
  // esconder por engano
  assert.deepEqual(ids(filtrarLotes(LOTES, {})), ['a', 'b', 'c'])
})

/* ── O SELETOR DA ABA GRAVAR ──────────────────────────────────────────────── */

test('lotesParaGravar: só oferece lote que ainda tem peça por gravar', () => {
  assert.deepEqual(ids(lotesParaGravar(LOTES, { pecasDoLote })), ['a'])
})

test('lotesParaGravar: o lote ESCOLHIDO nunca sai da lista', () => {
  // ao gravar a última peça o lote encerra na hora; se ele sumisse, o seletor
  // ficaria em branco e o ✓ da etiqueta recém-encostada sumiria junto
  assert.deepEqual(ids(lotesParaGravar(LOTES, { pecasDoLote, escolhido: 'b' })), ['a', 'b'])
})

test('lotesParaGravar: o escolhido também não some pela busca', () => {
  assert.deepEqual(
    ids(lotesParaGravar(LOTES, { pecasDoLote, escolhido: 'b', texto: 'monaco' })), ['a', 'b'])
})

test('lotesParaGravar: com incluirEncerrados, os encerrados voltam', () => {
  // é o caminho para DESFAZER uma baixa num lote já encerrado — sem ele, a
  // lista das baixadas ficaria inalcançável
  assert.deepEqual(ids(lotesParaGravar(LOTES, { pecasDoLote, incluirEncerrados: true })), ['a', 'b', 'c'])
})

test('lotesParaGravar: a busca vale no seletor também', () => {
  assert.deepEqual(ids(lotesParaGravar(LOTES, { pecasDoLote, texto: 'monaco' })), ['a'])
  assert.deepEqual(ids(lotesParaGravar(LOTES, { pecasDoLote, texto: 'florenca' })), [])
})

test('lotesParaGravar: a data também recorta o seletor', () => {
  assert.deepEqual(
    ids(lotesParaGravar(LOTES, { pecasDoLote, incluirEncerrados: true, de: '2026-08-01', ate: '2026-08-31' })),
    ['a', 'b'])
  assert.deepEqual(
    ids(lotesParaGravar(LOTES, { pecasDoLote, de: '2026-01-01', ate: '2026-01-31' })), [])
})

test('lotesComPecaPorGravar: é o número da frase de "não há nada a gravar"', () => {
  assert.equal(lotesComPecaPorGravar(LOTES, pecasDoLote), 1)
  assert.equal(lotesComPecaPorGravar([LOTES[1], LOTES[2]], pecasDoLote), 0)
  assert.equal(lotesComPecaPorGravar(null), 0)
})

/* ── A BUSCA DE ETIQUETAS ─────────────────────────────────────────────────── */

const ETIQUETAS = [
  { codigo: 'AAA111', lote_id: 'a', numero_na_serie: 1, gravada_em: '2026-08-28T13:00:00Z' },
  { codigo: 'BBB222', lote_id: 'b', numero_na_serie: 5, gravada_em: '2026-07-02T13:00:00Z' },
  { codigo: 'CCC333', lote_id: 'c', numero_na_serie: 9, gravada_em: '2026-08-29T01:00:00Z', baixada: true },
]
const loteDaPeca = (id) => LOTES.find((l) => l.id === id) || null
const codigos = (lista) => lista.map((p) => p.codigo)

test('filtrarEtiquetas: sem recorte nenhum, sai tudo', () => {
  assert.deepEqual(codigos(filtrarEtiquetas(ETIQUETAS, { loteDaPeca })), ['AAA111', 'BBB222', 'CCC333'])
})

test('filtrarEtiquetas: por data DA GRAVAÇÃO, no fuso de São Paulo', () => {
  // 29/08 às 01h UTC é 28/08 às 22h em São Paulo — o trabalho da noite
  const r = filtrarEtiquetas(ETIQUETAS, { loteDaPeca, de: '2026-08-28', ate: '2026-08-28' })
  assert.deepEqual(codigos(r), ['AAA111', 'CCC333'])
})

test('filtrarEtiquetas: os últimos 30 dias são o que a aba abre mostrando', () => {
  const { de, ate } = intervaloDoAtalho('30d', '2026-08-30')
  assert.deepEqual(codigos(filtrarEtiquetas(ETIQUETAS, { loteDaPeca, de, ate })), ['AAA111', 'CCC333'])
})

test('filtrarEtiquetas: por código da peça', () => {
  assert.deepEqual(codigos(filtrarEtiquetas(ETIQUETAS, { loteDaPeca, texto: 'bbb222' })), ['BBB222'])
})

test('filtrarEtiquetas: por modelo e por referência do lote da peça', () => {
  assert.deepEqual(codigos(filtrarEtiquetas(ETIQUETAS, { loteDaPeca, texto: 'monaco' })), ['AAA111'])
  assert.deepEqual(codigos(filtrarEtiquetas(ETIQUETAS, { loteDaPeca, texto: 'ss1234' })), ['BBB222'])
})

test('filtrarEtiquetas: por número na série, e ele casa EXATO', () => {
  // "9" é como se procura a peça dentro de um lote de 50. O número NÃO entra no
  // palheiro de texto: com `nº 9` lá dentro, o "n" sozinho casava com tudo e
  // digitar um dígito devolvia um terço da lista.
  assert.deepEqual(codigos(filtrarEtiquetas(ETIQUETAS, { loteDaPeca, texto: '9' })), ['CCC333'])
  // o "5" acha a peça nº 5 E o lote cuja referência tem 5 (SS1500) — quem
  // digita um pedaço de código está procurando por ele, e isso continua valendo
  assert.deepEqual(codigos(filtrarEtiquetas(ETIQUETAS, { loteDaPeca, texto: '5' })), ['BBB222', 'CCC333'])
  assert.deepEqual(codigos(filtrarEtiquetas(ETIQUETAS, { loteDaPeca, texto: '77' })), [],
    'número que não existe na série não devolve a lista inteira')
})

/* ── A BUSCA PELO NÚMERO DE SÉRIE ─────────────────────────────────────────
 * Desde 02/09/2026 a peça é NOMEADA pelo número de série (os dígitos da
 * referência colados na sequência: SS1234 na peça 5 é "12345"). A dica do campo
 * já dizia "ou o nº da série" — mas quem digitasse o número que está IMPRESSO na
 * bolsa não achava nada, porque a busca só sabia do número da peça sozinho.
 */

test('filtrarEtiquetas: o número de série INTEIRO acha a peça', () => {
  // ⚠️ FORMATO NOVO desde 07/09/2026: a referência entra INTEIRA, com as letras.
  // "1088001" era SS1088 na peça 1; agora é "SS1088QUARTZ001". O porquê está em
  // `numeroDeSerie` — quatro produtos diferentes davam o mesmo número.
  const so = (texto) => codigos(filtrarEtiquetas(ETIQUETAS, { loteDaPeca, texto }))
  assert.deepEqual(so('SS1088QUARTZ001'), ['AAA111'], 'SS1088-Quartz na peça 1')
  assert.deepEqual(so('SS1234CARAMELO005'), ['BBB222'], 'SS1234-Caramelo na peça 5')
  assert.deepEqual(so('SS1500OFFWHITE009'), ['CCC333'], 'SS1500-Off-White na peça 9')
})

test('filtrarEtiquetas: o número de série casa EXATO, como o número da peça', () => {
  // pedaço de número de série não pode devolver meia lista — é o mesmo motivo
  // pelo qual o número da peça nunca entrou no palheiro de texto
  assert.deepEqual(codigos(filtrarEtiquetas(ETIQUETAS, { loteDaPeca, texto: 'SS1088QUARTZ0011' })), [],
    'número de série que não existe não devolve nada')
  assert.deepEqual(codigos(filtrarEtiquetas(ETIQUETAS, { loteDaPeca, texto: 'SS1088QUARTZ' })), [],
    'a referência sozinha não é número de série de peça nenhuma')
})

test('filtrarEtiquetas: procurar pelo número da peça CONTINUA funcionando', () => {
  // PADRÃO item 8: o caminho antigo não pode sumir por causa do novo. Quem tem
  // a ordem de produção na mesa procura por "9", e a ordem diz "9".
  assert.deepEqual(codigos(filtrarEtiquetas(ETIQUETAS, { loteDaPeca, texto: '9' })), ['CCC333'])
})

test('filtrarEtiquetas: peça de lote sem referência não estoura nem casa com vazio', () => {
  const semLote = [{ codigo: 'DDD444', lote_id: 'z', numero_na_serie: 3 }]
  assert.deepEqual(codigos(filtrarEtiquetas(semLote, { loteDaPeca, texto: '3' })), ['DDD444'])
  assert.deepEqual(codigos(filtrarEtiquetas(semLote, { loteDaPeca, texto: '15009' })), [])
})

test('filtrarLotes: o número de série de uma peça acha o LOTE dela', () => {
  // é o mesmo caminho de "esta bolsa aqui é de qual lote?" que já existia pelo
  // código — só que agora pelo número que está IMPRESSO na bolsa
  assert.deepEqual(ids(filtrarLotes(LOTES, { pecasDoLote, texto: 'SS1088QUARTZ001', estado: 'todos' })), ['a'])
  assert.deepEqual(ids(filtrarLotes(LOTES, { pecasDoLote, texto: 'SS1500OFFWHITE001', estado: 'todos' })), ['c'])
  assert.deepEqual(ids(filtrarLotes(LOTES, { pecasDoLote, texto: '999999', estado: 'todos' })), [])
})

test('lotesParaGravar: o seletor da aba Gravar também acha pelo número de série', () => {
  assert.deepEqual(ids(lotesParaGravar(LOTES, { pecasDoLote, texto: 'ss1088quartz001' })), ['a'])
})

test('filtrarEtiquetas: por estado', () => {
  const so = (estado, comGarantia) => codigos(filtrarEtiquetas(ETIQUETAS, { loteDaPeca, estado, comGarantia }))
  assert.deepEqual(so('baixada'), ['CCC333'])
  assert.deepEqual(so('ativa'), ['AAA111', 'BBB222'])
  assert.deepEqual(so('garantia', new Set(['BBB222'])), ['BBB222'])
  assert.deepEqual(so('garantia', new Set()), [], 'sem garantia nenhuma, o recorte é vazio de verdade')
})

test('filtrarEtiquetas: estado e texto se somam', () => {
  const r = filtrarEtiquetas(ETIQUETAS, { loteDaPeca, estado: 'ativa', texto: 'ss1234' })
  assert.deepEqual(codigos(r), ['BBB222'])
})

test('filtrarEtiquetas: peça de lote que a tela não conhece não estoura', () => {
  const orfa = [{ codigo: 'DDD444', lote_id: 'sumiu', gravada_em: '2026-08-28T13:00:00Z' }]
  assert.deepEqual(codigos(filtrarEtiquetas(orfa, { loteDaPeca })), ['DDD444'])
  assert.deepEqual(codigos(filtrarEtiquetas(orfa, { loteDaPeca, texto: 'ddd444' })), ['DDD444'])
})

test('filtrarEtiquetas: lista vazia ou estranha não estoura', () => {
  assert.deepEqual(filtrarEtiquetas(null, {}), [])
  assert.deepEqual(filtrarEtiquetas([null], {}), [])
})

/* ── AS LISTAS DE ESTADO QUE A TELA OFERECE ───────────────────────────────── */

test('cada estado oferecido pela tela recorta de verdade', () => {
  // opção que não filtra nada é botão morto na cara de quem procura
  for (const e of ESTADOS_DE_LOTE) {
    assert.ok(e.rotulo.length > 3, `o estado de lote ${e.chave} precisa de rótulo`)
    const r = filtrarLotes(LOTES, { pecasDoLote, estado: e.chave })
    assert.ok(r.length <= LOTES.length)
  }
  for (const e of ESTADOS_DE_ETIQUETA) {
    assert.ok(e.rotulo.length > 3, `o estado de etiqueta ${e.chave} precisa de rótulo`)
    const r = filtrarEtiquetas(ETIQUETAS, { loteDaPeca, estado: e.chave, comGarantia: new Set(['BBB222']) })
    assert.ok(r.length <= ETIQUETAS.length)
  }
  assert.equal(ESTADOS_DE_LOTE[0].chave, 'todos', 'o "todos" é o jeito de voltar, e vem primeiro')
  assert.equal(ESTADOS_DE_ETIQUETA[0].chave, 'todas')
})

/* ── A CONTAGEM E O "LIMPAR" ──────────────────────────────────────────────── */

test('fraseDaContagem: diz quantos de quantos, sempre', () => {
  assert.equal(fraseDaContagem(12, 87, { um: 'lote', muitos: 'lotes' }), 'Mostrando 12 de 87 lotes')
  assert.equal(fraseDaContagem(1, 1, { um: 'lote', muitos: 'lotes' }), 'Mostrando 1 de 1 lote')
  assert.equal(fraseDaContagem(0, 0, { um: 'lote', muitos: 'lotes' }), 'Mostrando 0 de 0 lotes')
})

test('filtroAtivo: só é verdadeiro quando há recorte para limpar', () => {
  assert.equal(filtroAtivo({}, 'andamento'), false)
  assert.equal(filtroAtivo({ estado: 'andamento' }, 'andamento'), false)
  assert.equal(filtroAtivo({ texto: '  ' }, 'andamento'), false, 'espaço em branco não é busca')
  assert.equal(filtroAtivo({ texto: 'monaco' }, 'andamento'), true)
  assert.equal(filtroAtivo({ de: '2026-08-01' }, 'andamento'), true)
  assert.equal(filtroAtivo({ ate: '2026-08-01' }, 'andamento'), true)
  assert.equal(filtroAtivo({ estado: 'encerrado' }, 'andamento'), true)
})
