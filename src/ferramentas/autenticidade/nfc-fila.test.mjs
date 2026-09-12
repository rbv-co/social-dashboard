import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { codigoDoEndereco, conferirLeitura, listaParaGravadorDeMesa, codigosNoTextoDoGravador } from './nfc-fila.js'

test('codigoDoEndereco: tira o codigo de um endereco do selo', () => {
  assert.equal(
    codigoDoEndereco('https://vesselbrasil.com.br/verify/K7M4X9QP2R'),
    'K7M4X9QP2R',
  )
})

test('codigoDoEndereco: aceita minusculo e devolve MAIUSCULO', () => {
  // o app de NFC de terceiros pode devolver o endereco em caixa baixa
  assert.equal(
    codigoDoEndereco('https://vesselbrasil.com.br/verify/k7m4x9qp2r'),
    'K7M4X9QP2R',
  )
})

test('codigoDoEndereco: ignora barra, interrogacao e cerquilha no fim', () => {
  const esperado = 'K7M4X9QP2R'
  assert.equal(codigoDoEndereco('https://vesselbrasil.com.br/verify/K7M4X9QP2R/'), esperado)
  assert.equal(codigoDoEndereco('https://vesselbrasil.com.br/verify/K7M4X9QP2R?x=1'), esperado)
  assert.equal(codigoDoEndereco('https://vesselbrasil.com.br/verify/K7M4X9QP2R#a'), esperado)
})

test('codigoDoEndereco: endereco de OUTRO site nao vale', () => {
  assert.equal(codigoDoEndereco('https://exemplo.com/verify/K7M4X9QP2R'), null)
})

test('codigoDoEndereco: vazio, nulo e lixo devolvem nulo', () => {
  assert.equal(codigoDoEndereco(''), null)
  assert.equal(codigoDoEndereco(null), null)
  assert.equal(codigoDoEndereco('qualquer coisa'), null)
})

test('conferirLeitura: a etiqueta devolveu exatamente esta peca', () => {
  assert.equal(
    conferirLeitura('https://vesselbrasil.com.br/verify/K7M4X9QP2R', 'K7M4X9QP2R'),
    'confere',
  )
})

test('conferirLeitura: etiqueta em branco', () => {
  assert.equal(conferirLeitura('', 'K7M4X9QP2R'), 'vazia')
  assert.equal(conferirLeitura(null, 'K7M4X9QP2R'), 'vazia')
})

test('conferirLeitura: etiqueta com OUTRA peca — e o caso que salva duas bolsas', () => {
  assert.equal(
    conferirLeitura('https://vesselbrasil.com.br/verify/T3H8ZC5WVN', 'K7M4X9QP2R'),
    'outra-peca',
  )
})

test('conferirLeitura: etiqueta com coisa que nao e do selo', () => {
  assert.equal(conferirLeitura('https://google.com', 'K7M4X9QP2R'), 'nao-e-vessel')
})

test('listaParaGravadorDeMesa: uma URL por linha, so as que faltam, em ordem', () => {
  const pecas = [
    { codigo: 'CCC111', numero_na_serie: 3, gravada_em: null },
    { codigo: 'AAA111', numero_na_serie: 1, gravada_em: '2026-08-05T10:00:00Z' },
    { codigo: 'BBB111', numero_na_serie: 2, gravada_em: null },
  ]
  assert.equal(
    listaParaGravadorDeMesa(pecas),
    'https://vesselbrasil.com.br/verify/BBB111\nhttps://vesselbrasil.com.br/verify/CCC111',
  )
})

test('listaParaGravadorDeMesa: lote todo gravado devolve vazio', () => {
  assert.equal(listaParaGravadorDeMesa([{ codigo: 'A', gravada_em: 'x' }]), '')
})

test('codigosNoTextoDoGravador: acha os codigos em QUALQUER formato', () => {
  // o gravador de mesa ainda nao foi comprado; o retorno dele pode vir em
  // CSV com virgula, com ponto-e-virgula, ou num log solto. Por isso o
  // reconhecimento e por padrao, nao por formato.
  const pecas = [{ codigo: 'AAA111' }, { codigo: 'BBB111' }, { codigo: 'CCC111' }]
  const texto = `linha;status
https://vesselbrasil.com.br/verify/AAA111;ok
BBB111,gravada
"algum log solto" CCC111 -> OK`
  const r = codigosNoTextoDoGravador(texto, pecas)
  assert.deepEqual(r.reconhecidos.sort(), ['AAA111', 'BBB111', 'CCC111'])
  assert.deepEqual(r.ignorados, [])
})

test('codigosNoTextoDoGravador: codigo do selo que NAO e deste lote vira aviso', () => {
  const r = codigosNoTextoDoGravador(
    'https://vesselbrasil.com.br/verify/ZZZ999', [{ codigo: 'AAA111' }])
  assert.deepEqual(r.reconhecidos, [])
  assert.deepEqual(r.ignorados, ['ZZZ999'])
})

test('codigosNoTextoDoGravador: texto sem nada devolve as duas listas vazias', () => {
  const r = codigosNoTextoDoGravador('nada aqui', [{ codigo: 'AAA111' }])
  assert.deepEqual(r, { reconhecidos: [], ignorados: [] })
})

test('codigosNoTextoDoGravador: nao repete codigo que aparece duas vezes', () => {
  const r = codigosNoTextoDoGravador('AAA111 e de novo AAA111', [{ codigo: 'AAA111' }])
  assert.deepEqual(r.reconhecidos, ['AAA111'])
})

test('listaParaGravadorDeMesa: peca baixada nao vai para o gravador', () => {
  const pecas = [
    { codigo: 'AAA111', numero_na_serie: 1, gravada_em: null },
    { codigo: 'BBB111', numero_na_serie: 2, gravada_em: null, baixada: true },
  ]
  assert.equal(listaParaGravadorDeMesa(pecas),
    'https://vesselbrasil.com.br/verify/AAA111')
})

test('codigosNoTextoDoGravador: o aviso de outro lote sobrevive a MAIUSCULA', () => {
  // Leitor de NFC de terceiros devolve o endereco em caixa variada — a Tarefa 1
  // ja documentou isso. Um aviso que some por causa de maiuscula e pior que
  // nenhum aviso: da a impressao de que esta tudo certo.
  const r = codigosNoTextoDoGravador(
    'HTTPS://VESSELBRASIL.COM.BR/VERIFY/ZZZ999', [{ codigo: 'AAA111' }])
  assert.deepEqual(r.reconhecidos, [])
  assert.deepEqual(r.ignorados, ['ZZZ999'])
})

/* A REGRA "BAIXADA SAI DA FILA" MORA NUM LUGAR SO.
 *
 * Ela estava escrita duas vezes: `naFila` em lotes.js, e uma copia a mao aqui
 * (`!p.gravada_em && !p.baixada`). Duas copias da mesma regra divergem no dia
 * em que a regra muda, e a que ficar para tras manda gravar a etiqueta de uma
 * peca baixada — que iria costurada dentro de uma bolsa que nao deveria
 * existir. O comportamento sozinho nao pega isso: as duas copias concordam
 * HOJE. Por isso o teste le a fonte. */
test('listaParaGravadorDeMesa reusa `naFila`, em vez de reescrever a regra', () => {
  const fonte = readFileSync(new URL('./nfc-fila.js', import.meta.url).pathname, 'utf8')
  assert.match(fonte, /import \{[^}]*\bnaFila\b[^}]*\} from '\.\/lotes\.js'/,
    'sem importar naFila, a regra volta a existir em duas copias')
  assert.match(fonte, /\.filter\(\(p\) => naFila\(p\) && !p\.gravada_em\)/,
    'a fila do gravador de mesa tem de sair de naFila')
  assert.doesNotMatch(fonte, /!p\.baixada/,
    'a regra de "baixada sai da fila" nao se reescreve aqui: ela mora em lotes.js')
})
