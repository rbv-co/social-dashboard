import { test } from 'node:test'
import assert from 'node:assert/strict'
import { criarFila, ACOES } from './fila.js'

function lote(quantas = 3, extras = {}) {
  return Array.from({ length: quantas }, (_, i) => ({
    codigo: `PECA${String(i + 1).padStart(2, '0')}`,
    numero_na_serie: i + 1,
    lote_id: 'L1',
    ...extras,
  }))
}

const OK = (codigo) => ({ estado: 'gravada', frase: 'gravada', marcada: true, codigo })

// ── QUAL É A PRÓXIMA ───────────────────────────────────────────────────────

test('a próxima é a primeira sem gravação, na ordem da série', () => {
  const fila = criarFila({ pecas: lote(3) })
  assert.equal(fila.proxima().codigo, 'PECA01')
})

test('a ordem sai da série, mesmo com o banco devolvendo embaralhado', () => {
  const bagunca = [
    { codigo: 'C', numero_na_serie: 3 },
    { codigo: 'A', numero_na_serie: 1 },
    { codigo: 'B', numero_na_serie: 2 },
  ]
  assert.equal(criarFila({ pecas: bagunca }).proxima().codigo, 'A')
})

test('peça já gravada e peça baixada não entram na fila', () => {
  const pecas = [
    { codigo: 'A', numero_na_serie: 1, gravada_em: '2026-09-01T10:00:00Z' },
    { codigo: 'B', numero_na_serie: 2, baixada: true, baixa_motivo: 'defeito' },
    { codigo: 'C', numero_na_serie: 3 },
  ]
  const fila = criarFila({ pecas })
  assert.equal(fila.proxima().codigo, 'C')
  assert.deepEqual(fila.progresso(), { gravadas: 1, total: 2, texto: '1 de 2' })
})

test('fila acabada devolve próxima nula, sem estourar', () => {
  const fila = criarFila({ pecas: [] })
  assert.equal(fila.proxima(), null)
  assert.equal(fila.acabou(), true)
})

// ── ANDAR ──────────────────────────────────────────────────────────────────

test('peça gravada tira a peça da fila e a próxima é a seguinte', () => {
  const fila = criarFila({ pecas: lote(3) })
  const r = fila.registrar(OK('PECA01'))
  assert.equal(r.acao, ACOES.SEGUIR)
  assert.equal(fila.proxima().codigo, 'PECA02')
  assert.equal(fila.progresso().texto, '1 de 3')
})

test('etiqueta que já era da peça também conta como feita', () => {
  const fila = criarFila({ pecas: lote(2) })
  assert.equal(fila.registrar({ estado: 'ja-era-dela', marcada: true, codigo: 'PECA01' }).acao, ACOES.SEGUIR)
  assert.equal(fila.proxima().codigo, 'PECA02')
})

test('a fila NÃO mexe na lista que recebeu — ela é da tela de quem chamou', () => {
  const pecas = lote(2)
  const copia = JSON.parse(JSON.stringify(pecas))
  const fila = criarFila({ pecas })
  fila.registrar(OK('PECA01'))
  assert.deepEqual(pecas, copia)
})

// ── QUANDO FALHA ───────────────────────────────────────────────────────────
// ⚠️ NUNCA PULAR SOZINHA. Pular a peça que falhou deixa um buraco na série que
// só aparece no fim do lote, com as etiquetas já costuradas: ninguém consegue
// mais dizer qual número ficou de fora. Falhou, a peça CONTINUA sendo a próxima.

test('leitura que falhou: tenta de novo a MESMA peça, e ela continua sendo a próxima', () => {
  const fila = criarFila({ pecas: lote(3) })
  const r = fila.registrar({ estado: 'nao-li', frase: 'a etiqueta saiu', codigo: 'PECA01' })
  assert.equal(r.acao, ACOES.TENTAR_DE_NOVO)
  assert.equal(fila.proxima().codigo, 'PECA01')
})

test('depois de esgotar as tentativas, manda trocar a etiqueta — não pula a peça', () => {
  const fila = criarFila({ pecas: lote(3), tentativasPorPeca: 2 })
  assert.equal(fila.registrar({ estado: 'nao-li', codigo: 'PECA01' }).acao, ACOES.TENTAR_DE_NOVO)
  const r = fila.registrar({ estado: 'nao-li', codigo: 'PECA01' })
  assert.equal(r.acao, ACOES.TROCAR_ETIQUETA)
  assert.equal(fila.proxima().codigo, 'PECA01')
})

test('a conta de tentativas zera quando a peça vai bem', () => {
  const fila = criarFila({ pecas: lote(3), tentativasPorPeca: 2 })
  fila.registrar({ estado: 'nao-li', codigo: 'PECA01' })
  fila.registrar(OK('PECA01'))
  assert.equal(fila.registrar({ estado: 'nao-li', codigo: 'PECA02' }).acao, ACOES.TENTAR_DE_NOVO)
})

test('etiqueta com outra peça manda trocar de etiqueta, e a peça segue sendo a próxima', () => {
  const fila = criarFila({ pecas: lote(3) })
  const r = fila.registrar({ estado: 'recusada', frase: 'ESTA ETIQUETA JÁ TEM DONO', codigo: 'PECA01' })
  assert.equal(r.acao, ACOES.TROCAR_ETIQUETA)
  assert.equal(fila.proxima().codigo, 'PECA01')
})

test('etiqueta que ficou pela metade manda trocar a etiqueta, sempre', () => {
  const fila = criarFila({ pecas: lote(3) })
  assert.equal(fila.registrar({ estado: 'falhou-ao-escrever', codigo: 'PECA01' }).acao, ACOES.TROCAR_ETIQUETA)
  assert.equal(fila.registrar({ estado: 'nao-conferiu', codigo: 'PECA01' }).acao, ACOES.TROCAR_ETIQUETA)
})

// ⚠️ TRÊS ETIQUETAS RUINS SEGUIDAS NÃO É AZAR: é a caixa de etiquetas errada, o
// leitor mal encaixado, ou uma remessa ruim. Sem esta parada, o operador queima
// uma caixa inteira de etiquetas uma a uma.
test('três etiquetas recusadas seguidas param a fila e chamam gente', () => {
  const fila = criarFila({ pecas: lote(3), etiquetasRuinsSeguidas: 3 })
  fila.registrar({ estado: 'nao-conferiu', codigo: 'PECA01' })
  fila.registrar({ estado: 'nao-conferiu', codigo: 'PECA01' })
  const r = fila.registrar({ estado: 'nao-conferiu', codigo: 'PECA01' })
  assert.equal(r.acao, ACOES.PARAR)
  assert.match(r.frase, /3|tr[êe]s/i)
  assert.ok(fila.parada())
})

test('uma etiqueta boa no meio zera a contagem de etiquetas ruins', () => {
  const fila = criarFila({ pecas: lote(4), etiquetasRuinsSeguidas: 3 })
  fila.registrar({ estado: 'nao-conferiu', codigo: 'PECA01' })
  fila.registrar({ estado: 'nao-conferiu', codigo: 'PECA01' })
  fila.registrar(OK('PECA01'))
  fila.registrar({ estado: 'nao-conferiu', codigo: 'PECA02' })
  assert.equal(fila.parada(), null)
})

test('a fila parada não entrega próxima nenhuma até alguém destravar', () => {
  const fila = criarFila({ pecas: lote(3), etiquetasRuinsSeguidas: 1 })
  fila.registrar({ estado: 'nao-conferiu', codigo: 'PECA01' })
  assert.equal(fila.proxima(), null)
  fila.destravar()
  assert.equal(fila.proxima().codigo, 'PECA01')
})

// ⚠️ O PIOR CASO: a etiqueta está gravada no mundo e o sistema não sabe. A fila
// PARA, porque seguir em frente com a internet caída empilha etiquetas gravadas
// e não registradas — e elas são fisicamente idênticas, ninguém separa depois.
test('gravou e o sistema não marcou: a fila PARA e guarda a peça como pendente', () => {
  const fila = criarFila({ pecas: lote(3) })
  const r = fila.registrar({
    estado: 'gravada-sem-marcar', codigo: 'PECA01', endereco: 'https://x/verify/PECA01',
  })
  assert.equal(r.acao, ACOES.PARAR)
  assert.deepEqual(fila.pendentesDeMarcacao().map((p) => p.codigo), ['PECA01'])
  assert.equal(fila.proxima(), null)
})

// ⚠️ A PEÇA PENDENTE NÃO PODE VOLTAR PARA A FILA: ela JÁ TEM uma etiqueta no
// mundo. Oferecê-la de novo poria o mesmo código em DUAS bolsas.
test('a peça pendente de marcação sai da fila mesmo depois de destravar', () => {
  const fila = criarFila({ pecas: lote(3) })
  fila.registrar({ estado: 'gravada-sem-marcar', codigo: 'PECA01' })
  fila.destravar()
  assert.equal(fila.proxima().codigo, 'PECA02')
})

test('quando a marcação enfim dá certo, a pendência some', () => {
  const fila = criarFila({ pecas: lote(3) })
  fila.registrar({ estado: 'gravada-sem-marcar', codigo: 'PECA01' })
  fila.marcacaoResolvida('PECA01')
  assert.deepEqual(fila.pendentesDeMarcacao(), [])
  fila.destravar()
  assert.equal(fila.proxima().codigo, 'PECA02')
  assert.equal(fila.progresso().texto, '1 de 3')
})

// ── PULAR É ATO DELIBERADO ─────────────────────────────────────────────────

test('pular exige motivo escrito e tira a peça da fila', () => {
  const fila = criarFila({ pecas: lote(3) })
  fila.pular('PECA01', 'a peça sumiu da bancada')
  assert.equal(fila.proxima().codigo, 'PECA02')
  assert.deepEqual(fila.puladas().map((p) => p.codigo), ['PECA01'])
  assert.match(fila.puladas()[0].motivo, /sumiu/)
})

test('pular sem motivo é recusado: buraco na série sem explicação é mistério em três meses', () => {
  const fila = criarFila({ pecas: lote(3) })
  assert.throws(() => fila.pular('PECA01', ''), /motivo/i)
  assert.throws(() => fila.pular('PECA01'), /motivo/i)
  assert.equal(fila.proxima().codigo, 'PECA01')
})

test('a peça pulada volta para a fila quando alguém desfaz', () => {
  const fila = criarFila({ pecas: lote(3) })
  fila.pular('PECA01', 'sumiu')
  fila.despular('PECA01')
  assert.equal(fila.proxima().codigo, 'PECA01')
})

// ── RETOMAR DE ONDE PAROU ──────────────────────────────────────────────────
// ⚠️ O QUE VALE É O BANCO. `gravada_em` é a verdade; o instantâneo guarda só o
// que o banco AINDA NÃO SABE — as pendentes de marcação e as puladas. Guardar
// "a próxima é a nº 7" seria guardar uma cópia que envelhece: se alguém gravar
// pelo celular enquanto o programa está fechado, a cópia mandaria regravar.

test('o instantâneo é JSON puro, para caber num arquivo', () => {
  const fila = criarFila({ pecas: lote(3) })
  fila.registrar({ estado: 'gravada-sem-marcar', codigo: 'PECA01' })
  fila.pular('PECA02', 'sumiu')
  const salvo = fila.instantaneo()
  assert.doesNotThrow(() => JSON.parse(JSON.stringify(salvo)))
  assert.ok(salvo.pendentesDeMarcacao.length === 1)
  assert.ok(salvo.puladas.length === 1)
})

test('o programa fecha e abre: retoma as pendentes e as puladas, e a fila continua certa', () => {
  const primeira = criarFila({ pecas: lote(4) })
  primeira.registrar({ estado: 'gravada-sem-marcar', codigo: 'PECA01' })
  primeira.pular('PECA02', 'sumiu')
  const salvo = JSON.parse(JSON.stringify(primeira.instantaneo()))

  const depois = criarFila({ pecas: lote(4), retomandoDe: salvo })
  assert.equal(depois.proxima().codigo, 'PECA03')
  assert.deepEqual(depois.pendentesDeMarcacao().map((p) => p.codigo), ['PECA01'])
  assert.deepEqual(depois.puladas().map((p) => p.codigo), ['PECA02'])
})

test('retomar com a peça JÁ marcada no banco não a deixa pendurada como pendente', () => {
  const salvo = { pendentesDeMarcacao: [{ codigo: 'PECA01' }], puladas: [] }
  const pecas = lote(3)
  pecas[0].gravada_em = '2026-09-01T10:00:00Z'
  const fila = criarFila({ pecas, retomandoDe: salvo })
  assert.deepEqual(fila.pendentesDeMarcacao(), [],
    'a pendência sobreviveu ao banco já ter registrado a peça')
  assert.equal(fila.proxima().codigo, 'PECA02')
})

test('retomar com instantâneo estragado não derruba a fila', () => {
  for (const lixo of [null, 'oi', 42, {}, { pendentesDeMarcacao: 'x', puladas: 7 }]) {
    const fila = criarFila({ pecas: lote(2), retomandoDe: lixo })
    assert.equal(fila.proxima().codigo, 'PECA01', `o instantâneo ${JSON.stringify(lixo)} derrubou a fila`)
  }
})

// ── O DIÁRIO ───────────────────────────────────────────────────────────────
// Depois de costurar, ninguém responde "o que aconteceu com a peça nº 7". O
// diário responde: uma linha por tentativa, na ordem em que aconteceram.

test('cada tentativa entra no diário, inclusive as que deram errado', () => {
  const fila = criarFila({ pecas: lote(2), agora: () => '2026-09-01T12:00:00.000Z' })
  fila.registrar({ estado: 'nao-li', codigo: 'PECA01', frase: 'a etiqueta saiu' })
  fila.registrar(OK('PECA01'))
  const diario = fila.diario()
  assert.equal(diario.length, 2)
  assert.equal(diario[0].estado, 'nao-li')
  assert.equal(diario[1].estado, 'gravada')
  assert.equal(diario[0].quando, '2026-09-01T12:00:00.000Z')
})

test('resultado sem código conhecido não é registrado às cegas', () => {
  const fila = criarFila({ pecas: lote(2) })
  const r = fila.registrar({ estado: 'gravada', codigo: 'NAO_EXISTE' })
  assert.equal(r.acao, ACOES.PARAR)
  assert.match(r.frase, /NAO_EXISTE/)
  assert.equal(fila.progresso().texto, '0 de 2')
})

test('resultado sem estado nenhum para a fila em vez de fingir sucesso', () => {
  const fila = criarFila({ pecas: lote(2) })
  assert.equal(fila.registrar({ codigo: 'PECA01' }).acao, ACOES.PARAR)
  assert.equal(fila.registrar(null).acao, ACOES.PARAR)
})
