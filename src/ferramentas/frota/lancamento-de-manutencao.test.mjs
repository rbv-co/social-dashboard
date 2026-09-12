import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  problemasDoLancamento, diferencaDeValores, linhasParaGravar,
  centavos, VALOR_INVALIDO, mensagemDoLancamento,
} from './lancamento-de-manutencao.js'

const bloqueia = (p) => p.filter((x) => x.bloqueia)

/* Os números são reais, medidos em 12/08/2026: a Bravo Blackmotion tem 188.000
 * km conhecidos (do único checklist), e a frota inteira tem 2 trocas
 * registradas em 10 carros. */

// ── O KM ────────────────────────────────────────────────────────────────────

test('sem KM não grava, e a tela DIZ por que', () => {
  // Não é implicância: revisão sem KM é invisível pro alerta, e o item
  // continuaria "vencido" pra sempre depois de trocado.
  const p = problemasDoLancamento({ km: null, itens: [{ item: 'Troca de óleo' }] })
  const b = bloqueia(p)
  assert.equal(b.length, 1)
  assert.match(b[0].texto, /alerta|avisar/i, 'tem de explicar a consequência, não só pedir o campo')
})

test('KM zero é ACEITO — carro zero km existe', () => {
  const p = problemasDoLancamento({ km: 0, itens: [{ item: 'Troca de óleo' }] })
  assert.equal(bloqueia(p).length, 0)
})

test('KM negativo não existe', () => {
  assert.equal(bloqueia(problemasDoLancamento({ km: -5, itens: [{ item: 'X' }] })).length, 1)
})

test('KM menor que o conhecido AVISA e deixa gravar', () => {
  // Painel trocado na oficina zera odômetro de verdade. Mesmo tratamento do
  // hodometro_justificativa do checklist.
  const p = problemasDoLancamento({ km: 150000, itens: [{ item: 'Troca de óleo' }], kmConhecido: 188000 })
  assert.equal(bloqueia(p).length, 0, 'não bloqueia')
  assert.equal(p.length, 1, 'mas avisa')
  assert.match(p[0].texto, /188\.000/, 'diz o número que ele já conhece')
})

test('KM igual ao conhecido não gera aviso nenhum', () => {
  const p = problemasDoLancamento({ km: 188000, itens: [{ item: 'X' }], kmConhecido: 188000 })
  assert.equal(p.length, 0)
})

test('salto absurdo de KM avisa, sem bloquear', () => {
  const p = problemasDoLancamento({ km: 900000, itens: [{ item: 'X' }], kmConhecido: 188000 })
  assert.equal(bloqueia(p).length, 0)
  assert.ok(p.some((x) => /confir/i.test(x.texto)))
})

// ── Os itens ────────────────────────────────────────────────────────────────

test('nenhum item marcado não grava', () => {
  const b = bloqueia(problemasDoLancamento({ km: 100, itens: [] }))
  assert.equal(b.length, 1)
  assert.match(b[0].texto, /marque|o que foi trocado/i)
})

test('item repetido no mesmo lançamento não grava', () => {
  // Duas linhas do mesmo item no mesmo serviço dariam dois alertas pra mesma
  // troca — o mesmo motivo que problemasDoItem() barra nome repetido no plano.
  const b = bloqueia(problemasDoLancamento({
    km: 100, itens: [{ item: 'Troca de óleo' }, { item: 'Troca de óleo' }],
  }))
  assert.equal(b.length, 1)
  assert.match(b[0].texto, /repetid|duas vezes|mesma/i)
})

// ── Total × unitários ───────────────────────────────────────────────────────

test('unitários que não somam o total: DIZ a diferença, não escolhe um lado', () => {
  const d = diferencaDeValores({
    totalCentavos: 124000,
    itens: [{ item: 'Óleo', valorCentavos: 18000 }, { item: 'Pneus', valorCentavos: 89000 }],
  })
  assert.equal(d.soma, 107000)
  assert.equal(d.diferenca, 17000)
  assert.match(d.texto, /170,00/, 'a diferença em reais, escrita')
  assert.match(d.texto, /mão de obra/i, 'e o que ela provavelmente é')
})

test('unitários que passam do total também são ditos', () => {
  const d = diferencaDeValores({
    totalCentavos: 10000, itens: [{ item: 'Óleo', valorCentavos: 18000 }],
  })
  assert.equal(d.diferenca, -8000)
  assert.match(d.texto, /80,00/)
})

test('soma exata não vira aviso', () => {
  const d = diferencaDeValores({
    totalCentavos: 18000, itens: [{ item: 'Óleo', valorCentavos: 18000 }],
  })
  assert.equal(d, null)
})

test('sem total, ou sem unitário nenhum, não há divergência pra dizer', () => {
  assert.equal(diferencaDeValores({ totalCentavos: null, itens: [{ item: 'X', valorCentavos: 1 }] }), null)
  assert.equal(diferencaDeValores({ totalCentavos: 5000, itens: [{ item: 'X' }] }), null)
})

// ── As linhas gravadas ──────────────────────────────────────────────────────

test('cada item marcado vira uma linha de frota_revisoes, com o elo', () => {
  const l = linhasParaGravar({
    manutencaoId: 'm-1', veiculoId: 'v-1', km: 192400, feitaEm: '2026-08-12',
    oficina: 'JHM Auto Center',
    itens: [{ item: 'Troca de óleo', valorCentavos: 18000 }, { item: 'Pneus' }],
  })
  assert.equal(l.length, 2)
  assert.deepEqual(l[0], {
    manutencao_id: 'm-1', veiculo_id: 'v-1', item: 'Troca de óleo',
    km: 192400, feita_em: '2026-08-12', oficina: 'JHM Auto Center',
    custo_centavos: 18000,
  })
  assert.equal(l[1].custo_centavos, null, 'item sem valor grava nulo, não zero')
})

test('o KM e a oficina do cabeçalho vão em TODAS as linhas', () => {
  // frota_revisoes.km é o que ultimaRevisao() lê pra calcular o alerta: linha
  // sem km não alerta nunca. Repetir aqui não é redundância, é o que faz o
  // alerta funcionar por item.
  const l = linhasParaGravar({
    manutencaoId: 'm-1', veiculoId: 'v-1', km: 500, itens: [{ item: 'A' }, { item: 'B' }, { item: 'C' }],
  })
  for (const x of l) { assert.equal(x.km, 500); assert.equal(x.veiculo_id, 'v-1') }
})

test('data em branco grava nulo, não a data de hoje', () => {
  // Inventar a data de hoje seria a tela mentindo sobre quando o serviço foi.
  const l = linhasParaGravar({ manutencaoId: 'm', veiculoId: 'v', km: 1, feitaEm: '', itens: [{ item: 'A' }] })
  assert.equal(l[0].feita_em, null)
})

/* ── O valor em reais que a pessoa digita ───────────────────────────────────
 *
 * A tabela abaixo é O DEFEITO que estes testes existem pra travar: a conta
 * antiga apagava TODO ponto como separador de milhar antes de olhar a vírgula,
 * então `1240.00` virava R$ 124.000,00 — cem vezes o valor, gravado em
 * silêncio. E não era caso exótico: `inputmode="decimal"` abre o teclado que
 * oferece PONTO em boa parte dos celulares. A mesma conta já alimentava
 * `aluguel_centavos`, `fipe_centavos` e `seguro_valor_centavos` na ficha do
 * veículo — um aluguel digitado `4500.00` virava R$ 450.000,00. */

test('as formas que uma pessoa realmente digita um valor', () => {
  const casos = [
    ['1.240,00', 124000],
    ['1240', 124000],
    ['1240,5', 124050],
    ['0,50', 50],
    ['1240.00', 124000],   // ← o defeito: dava 12400000
    ['1240.5', 124050],    // ← o defeito: dava 1240500
    ['1.240.00', 124000],  // os dois separadores misturados
    ['1.240', 124000],     // três dígitos depois do ponto = MILHAR, não decimal
    ['R$ 1.240,00', 124000],
    ['1 240,00', 124000],
    ['1 240,00', 124000], // espaço que não quebra, de valor copiado de site
  ]
  for (const [txt, esperado] of casos) {
    assert.equal(centavos(txt), esperado, `"${txt}" devia virar ${esperado} centavos`)
  }
})

test('em branco é "não informou" — e isso NÃO é erro', () => {
  // Distinto de inválido: aqui a tela deixa o campo vazio e grava nulo.
  // "R$" sozinho entra aqui de propósito: sobra vazio depois de limpar, e a
  // pessoa claramente não digitou valor nenhum.
  for (const vazio of ['', '   ', null, undefined, 'R$', 'R$ ']) {
    assert.equal(centavos(vazio), null, `"${vazio}" devia ser "não informou"`)
  }
})

test('texto que não dá pra ler devolve INVÁLIDO, não nulo', () => {
  // Devolver nulo faria a tela gravar "sem valor" caladamente sobre o que a
  // pessoa digitou — a tela mentindo sobre o que ela mandou.
  for (const lixo of ['abc', '12abc', '1,2,3', '--50']) {
    assert.equal(centavos(lixo), VALOR_INVALIDO, `"${lixo}" devia ser inválido`)
  }
})

test('valor negativo é inválido — nota de oficina não tem valor negativo', () => {
  assert.equal(centavos('-50'), VALOR_INVALIDO)
  assert.equal(centavos('-1.240,00'), VALOR_INVALIDO)
})

test('vírgula com três casas é AMBÍGUA, e ambiguidade em dinheiro se barra', () => {
  // "12,345" tanto pode ser R$ 12.345,00 quanto R$ 12,34 digitado com uma casa
  // a mais. Adivinhar erra por um fator de mil, então a tela barra e a pessoa
  // digita de novo. Com PONTO não há ambiguidade: "12.345" é o milhar.
  assert.equal(centavos('12,345'), VALOR_INVALIDO)
  assert.equal(centavos('12.345'), 1234500)
})

/* ── A frase depois de tentar gravar ────────────────────────────────────────
 * O que ela decide não é o texto: é se a pessoa pode TENTAR DE NOVO. */

test('deu tudo certo não tem frase nenhuma', () => {
  assert.equal(mensagemDoLancamento({}), '')
})

test('cabeçalho falhou: NADA foi gravado, e pode tentar de novo', () => {
  const m = mensagemDoLancamento({ erroCab: new Error('rede') })
  assert.match(m, /NADA foi salvo/)
  assert.match(m, /tente de novo/i)
})

test('trocas falharam e o desfazer foi CONFIRMADO: pode tentar de novo', () => {
  const m = mensagemDoLancamento({ erroLinhas: new Error('x'), cabecalhoApagado: true })
  assert.match(m, /desfiz o lançamento inteiro/)
  assert.match(m, /tente de novo/i)
})

test('desfazer NÃO confirmado: manda NÃO tentar de novo', () => {
  // O caso que a revisão pegou: um delete recusado pela permissão volta SEM
  // erro e sem apagar nada. Se a tela dissesse "tente de novo", o mesmo serviço
  // entraria duas vezes no histórico.
  const m = mensagemDoLancamento({ erroLinhas: new Error('x'), cabecalhoApagado: false })
  assert.match(m, /NÃO lance de novo/)
  assert.match(m, /avise quem administra/i)
  assert.doesNotMatch(m, /[Tt]ente de novo/, 'não pode convidar a repetir')
})
