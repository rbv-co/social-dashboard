import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { enderecoDaTag } from '../lotes.js'
import { planoDeGravacao, enderecoNaEtiqueta, conferirCapabilityContainer } from './ndef-para-ntag213.js'

// O codigo de peca de verdade: 10 letras do alfabeto sem O, 0, I e 1 — as
// quatro que a pessoa confunde lendo em cima do couro.
const CODIGO = 'K7M4X9QP2R'
// O endereco NASCE de enderecoDaTag, nunca escrito a mao. Dominio em dois
// lugares e dominio errado esperando acontecer — e este vai gravado dentro de
// um chip costurado numa bolsa, onde nao se corrige.
const ENDERECO = enderecoDaTag(CODIGO)

// A NTAG213 NAO SAI DA FABRICA EM BRANCO. As paginas 4 e 5 vem com isto:
// `01 03 A0 0C 34` e um Lock Control TLV (cinco bytes), `03 00` e uma mensagem
// NDEF vazia e `FE` e o terminador.
const DE_FABRICA = [0x01, 0x03, 0xa0, 0x0c, 0x34, 0x03, 0x00, 0xfe]

// Remonta a memoria do usuario a partir das escritas, como a etiqueta ficaria
// depois de gravada. E assim que se confere sem hardware.
function memoriaDepois(escritas, antes = []) {
  const memoria = Array.from({ length: 144 }, (_, i) => antes[i] ?? 0)
  for (const { pagina, bytes } of escritas) {
    const inicio = (pagina - 4) * 4
    bytes.forEach((b, i) => { memoria[inicio + i] = b })
  }
  return memoria
}

// ── REGRA 1: PRESERVA O LOCK CONTROL TLV ───────────────────────────────────
test('regra 1: com Lock Control na etiqueta, a mensagem comeca DEPOIS dele', () => {
  const escritas = planoDeGravacao(ENDERECO, DE_FABRICA)
  // pagina 4 e Lock Control inteiro (`01 03 A0 0C`): nao se escreve nela
  assert.equal(escritas[0].pagina, 5, 'a pagina 4 e so Lock Control, nao se toca nela')
  // o quinto byte do Lock Control (`34`) mora no comeco da pagina 5 e tem de
  // sobreviver: escrever zero por cima destroi a trava que a etiqueta espera ter
  assert.equal(escritas[0].bytes[0], 0x34, 'o quinto byte do Lock Control foi apagado')
  // e so depois dele comeca o TLV da mensagem NDEF
  assert.equal(escritas[0].bytes[1], 0x03, 'o TLV de mensagem tem de comecar no byte seguinte')
})

test('regra 1: os cinco bytes do Lock Control continuam iguais depois de gravar', () => {
  const memoria = memoriaDepois(planoDeGravacao(ENDERECO, DE_FABRICA), DE_FABRICA)
  assert.deepEqual(memoria.slice(0, 5), [0x01, 0x03, 0xa0, 0x0c, 0x34])
})

// ── REGRA 2: SEM LOCK CONTROL, COMECA NA PAGINA 4 ──────────────────────────
test('regra 2: memoria vazia — a mensagem comeca na pagina 4', () => {
  const escritas = planoDeGravacao(ENDERECO, [])
  assert.equal(escritas[0].pagina, 4)
  assert.equal(escritas[0].bytes[0], 0x03, 'o TLV de mensagem abre a pagina 4')
})

test('regra 2: memoria nula ou nao lida — a mensagem comeca na pagina 4', () => {
  for (const nada of [null, undefined, 'nao e byte nenhum', 42]) {
    const escritas = planoDeGravacao(ENDERECO, nada)
    assert.equal(escritas[0].pagina, 4, `memoria ${String(nada)} deveria comecar na pagina 4`)
  }
})

test('regra 2: memoria que NAO comeca com Lock Control comeca na pagina 4', () => {
  // etiqueta que ja tem so uma mensagem NDEF, sem Lock Control
  const escritas = planoDeGravacao(ENDERECO, [0x03, 0x00, 0xfe, 0x00])
  assert.equal(escritas[0].pagina, 4)
})

// ── REGRA 3: SEMPRE TERMINA COM O TERMINADOR FE ────────────────────────────
test('regra 3: depois da mensagem vem o terminador FE', () => {
  for (const antes of [[], DE_FABRICA]) {
    const escritas = planoDeGravacao(ENDERECO, antes)
    const memoria = memoriaDepois(escritas, antes)
    const inicio = antes.length ? 5 : 0
    const tamanhoDaMensagem = memoria[inicio + 1]
    // TLV: [03][tamanho][mensagem...][FE]
    assert.equal(memoria[inicio], 0x03, 'o TLV de mensagem NDEF abre com 03')
    assert.equal(memoria[inicio + 2 + tamanhoDaMensagem], 0xfe,
      'sem o terminador FE o leitor continua lendo lixo depois da mensagem')
  }
})

// ── REGRA 4: COMPLETA A ULTIMA PAGINA COM ZEROS ────────────────────────────
test('regra 4: toda escrita tem exatamente 4 bytes', () => {
  const escritas = planoDeGravacao(ENDERECO, DE_FABRICA)
  for (const escrita of escritas) {
    assert.equal(escrita.bytes.length, 4,
      `a pagina ${escrita.pagina} nao tem 4 bytes: nao existe meia pagina na NTAG213`)
    for (const b of escrita.bytes) {
      assert.ok(Number.isInteger(b) && b >= 0 && b <= 255, 'byte fora de 0..255')
    }
  }
})

test('regra 4: a sobra da ultima pagina vai com zero', () => {
  const escritas = planoDeGravacao(ENDERECO, DE_FABRICA)
  const memoria = memoriaDepois(escritas, DE_FABRICA)
  // 5 do Lock Control + 45 do TLV (2 + 42 da mensagem + FE) = 50 bytes usados;
  // a ultima pagina vai ate o byte 51, e os dois que sobram sao zero
  const ultima = escritas[escritas.length - 1]
  assert.equal(ultima.bytes[2], 0x00)
  assert.equal(ultima.bytes[3], 0x00)
  assert.equal(memoria[50], 0x00)
})

// ── REGRA 6: NUNCA AS PAGINAS 0, 1, 2 OU 3 ─────────────────────────────────
test('regra 6: nenhuma escrita cai nas paginas 0 a 3', () => {
  // A pagina 3 e o Capability Container e ja vem certo de fabrica; os bits dele
  // so mudam num sentido, com OR, e a mudanca e IRREVERSIVEL. As paginas 0 a 2
  // sao o numero de serie da etiqueta, que nem se escreve.
  for (const antes of [[], DE_FABRICA, [0x03, 0x00, 0xfe, 0x00]]) {
    for (const { pagina } of planoDeGravacao(ENDERECO, antes)) {
      assert.ok(pagina >= 4, `escrita na pagina ${pagina}: fora da memoria do usuario`)
      assert.ok(pagina <= 39, `escrita na pagina ${pagina}: passou da memoria do usuario`)
    }
  }
})

// ── O REGISTRO DE URL ──────────────────────────────────────────────────────
test('o prefixo 04 troca o `https://` por um byte so', () => {
  const memoria = memoriaDepois(planoDeGravacao(ENDERECO, []), [])
  // [03][tamanho do TLV] [D1 01 tamanho 55] [04] texto...
  assert.deepEqual(memoria.slice(0, 6), [0x03, 0x2a, 0xd1, 0x01, 0x26, 0x55])
  assert.equal(memoria[6], 0x04, '04 e o prefixo abreviado de https://')
  const texto = String.fromCharCode(...memoria.slice(7, 7 + 37))
  assert.equal(texto, `vesselbrasil.com.br/verify/${CODIGO}`,
    'so o resto do endereco vai como texto')
})

// ── O DOMINIO NAO MORA AQUI ────────────────────────────────────────────────
test('o tradutor nao escreve o dominio: ele recebe o endereco pronto', () => {
  const fonte = readFileSync(new URL('./ndef-para-ntag213.js', import.meta.url).pathname, 'utf8')
  assert.doesNotMatch(fonte, /vesselbrasil/i,
    'o dominio mora em lotes.js (enderecoDaTag) e em lugar nenhum mais')
})

// ── REGRA 5: NAO COUBE, ENTAO DA ERRO ──────────────────────────────────────
test('regra 5: endereco longo demais da erro, em portugues', () => {
  const gigante = enderecoDaTag('A'.repeat(200))
  assert.throws(
    () => planoDeGravacao(gigante, DE_FABRICA),
    (erro) => {
      assert.ok(erro instanceof Error)
      assert.match(erro.message, /longo demais/i,
        'a frase tem de dizer que o endereco e longo demais para a etiqueta')
      assert.match(erro.message, /etiqueta/i)
      return true
    },
  )
})

test('regra 5: nao couber, NAO devolve pagina fora da faixa nem corta em silencio', () => {
  // Cortar o endereco no meio grava uma etiqueta que abre um endereco que nao
  // existe — a cliente encosta o celular e conclui que a bolsa e falsa. Passar
  // da pagina 39 escreve nas travas dinamicas e na senha, e estraga a etiqueta.
  const gigante = enderecoDaTag('A'.repeat(200))
  for (const antes of [[], DE_FABRICA]) {
    let escritas = null
    try { escritas = planoDeGravacao(gigante, antes) } catch { /* era pra dar erro */ }
    assert.equal(escritas, null, 'devolveu um plano em vez de recusar')
  }
})

test('regra 5: o que cabe exatamente ate a pagina 39 ainda e gravado', () => {
  // Sem Lock Control sobram os 144 bytes: 3 do TLV (03, tamanho, FE) + 4 do
  // cabecalho do registro + 1 do prefixo = 8; sobram 136 bytes de texto.
  const noLimite = enderecoDaTag('A'.repeat(136 - 'vesselbrasil.com.br/verify/'.length))
  const escritas = planoDeGravacao(noLimite, [])
  assert.equal(escritas[escritas.length - 1].pagina, 39)
  // um caractere a mais nao cabe
  assert.throws(() => planoDeGravacao(`${noLimite}A`, []), /longo demais/i)
})

test('regra 5: com Lock Control cabe menos, porque ele come 5 bytes', () => {
  const noLimite = enderecoDaTag('A'.repeat(131 - 'vesselbrasil.com.br/verify/'.length))
  assert.equal(planoDeGravacao(noLimite, DE_FABRICA).pop().pagina, 39)
  assert.throws(() => planoDeGravacao(`${noLimite}A`, DE_FABRICA), /longo demais/i)
})

// ── AS OUTRAS RECUSAS ──────────────────────────────────────────────────────
test('leitura que parou no meio do Lock Control da erro em vez de apagar a trava', () => {
  // Quem leu so a pagina 4 tem `01 03 A0 0C` e nao viu o quinto byte (`34`).
  // Gravar assim poria zero no lugar dele.
  assert.throws(() => planoDeGravacao(ENDERECO, [0x01, 0x03, 0xa0, 0x0c]),
    /pagina inteira|página inteira/i)
  assert.throws(() => planoDeGravacao(ENDERECO, [0x01]), /Lock Control/i)
})

test('endereco vazio ou nulo da erro: etiqueta em branco dentro da bolsa nao serve', () => {
  for (const nada of ['', '   ', null, undefined]) {
    assert.throws(() => planoDeGravacao(nada, DE_FABRICA), /endereço|endereco/i)
  }
})

// ── LER DE VOLTA: O QUE ESTA NA ETIQUETA ───────────────────────────────────
// Conferir e metade do trabalho. E assim que se prova que a gravacao deu certo,
// e e assim que se descobre que a etiqueta JA TEM outra peca antes de escrever
// por cima.
const texto = (t) => [...t].map((c) => c.charCodeAt(0))

test('ida e volta: grava e le o mesmo endereco, com Lock Control', () => {
  const memoria = memoriaDepois(planoDeGravacao(ENDERECO, DE_FABRICA), DE_FABRICA)
  assert.equal(enderecoNaEtiqueta(memoria), ENDERECO)
})

test('ida e volta: grava e le o mesmo endereco, em etiqueta sem Lock Control', () => {
  const memoria = memoriaDepois(planoDeGravacao(ENDERECO, []), [])
  assert.equal(enderecoNaEtiqueta(memoria), ENDERECO)
})

test('ida e volta: vale para um endereco no limite do que cabe', () => {
  const noLimite = enderecoDaTag('A'.repeat(131 - 'vesselbrasil.com.br/verify/'.length))
  const memoria = memoriaDepois(planoDeGravacao(noLimite, DE_FABRICA), DE_FABRICA)
  assert.equal(enderecoNaEtiqueta(memoria), noLimite)
})

test('etiqueta de fabrica nao tem endereco nenhum', () => {
  // `03 00` e uma mensagem NDEF de tamanho ZERO, seguida do terminador
  assert.equal(enderecoNaEtiqueta(DE_FABRICA), '')
})

test('memoria vazia, nula ou que nao e byte nenhum devolve vazio', () => {
  for (const nada of [[], null, undefined, 'nao e byte nenhum', 0, { }]) {
    assert.equal(enderecoNaEtiqueta(nada), '', `${String(nada)} deveria devolver vazio`)
  }
})

test('descobre que a etiqueta JA TEM outra peca gravada', () => {
  const outraPeca = enderecoDaTag('BXQ7T3MHKD')
  const memoria = memoriaDepois(planoDeGravacao(outraPeca, DE_FABRICA), DE_FABRICA)
  const lido = enderecoNaEtiqueta(memoria)
  assert.equal(lido, outraPeca)
  assert.notEqual(lido, ENDERECO, 'gravar por cima apagaria a etiqueta de outra bolsa')
})

test('pula o enchimento 00 antes da mensagem', () => {
  const memoria = [0x00, 0x00, 0x03, 0x0a, 0xd1, 0x01, 0x06, 0x55, 0x04, ...texto('x.com'), 0xfe]
  assert.equal(enderecoNaEtiqueta(memoria), 'https://x.com')
})

test('o prefixo 00 quer dizer que a URL inteira veio como texto', () => {
  const url = 'ftp://x.com/a'
  const memoria = [0x03, 5 + url.length, 0xd1, 0x01, 1 + url.length, 0x55, 0x00, ...texto(url), 0xfe]
  assert.equal(enderecoNaEtiqueta(memoria), url)
})

test('registro que nao e de URL devolve vazio', () => {
  // um registro de TEXTO (tipo 54, 'T'): nao abre nada quando a cliente encosta
  // o celular, e nao e endereco de peca nenhuma
  const memoria = [0x03, 0x08, 0xd1, 0x01, 0x04, 0x54, 0x02, ...texto('enA'), 0xfe]
  assert.equal(enderecoNaEtiqueta(memoria), '')
})

test('prefixo que nao e endereco da web devolve vazio', () => {
  // 05 e `tel:` na tabela oficial. Nao e endereco de peca, e este arquivo nao
  // carrega a tabela inteira de cabeca so para adivinhar.
  const memoria = [0x03, 0x0f, 0xd1, 0x01, 0x0b, 0x55, 0x05, ...texto('1130001234'), 0xfe]
  assert.equal(enderecoNaEtiqueta(memoria), '')
})

test('memoria cortada no meio da mensagem devolve vazio, nao lixo', () => {
  assert.equal(enderecoNaEtiqueta([0x03, 0x2a, 0xd1, 0x01]), '')
  assert.equal(enderecoNaEtiqueta([0x03]), '')
})

// ── A PAGINA 3: A ETIQUETA ESTA FORMATADA? ─────────────────────────────────
test('CC de fabrica: formatada, de fabrica, e cabem 144 bytes', () => {
  const r = conferirCapabilityContainer([0xe1, 0x10, 0x12, 0x00])
  assert.equal(r.formatada, true)
  assert.equal(r.deFabrica, true)
  // o terceiro byte e o tamanho DIVIDIDO por 8: 0x12 = 18, e 18 x 8 = 144
  assert.equal(r.bytesDeMemoria, 144)
  assert.equal(r.podeGravar, true)
  assert.equal(r.aviso, '', 'etiqueta boa nao merece aviso nenhum')
})

test('CC de uma etiqueta maior diz que cabe mais', () => {
  // NTAG216: 0x6D = 109, e 109 x 8 = 872 bytes
  const r = conferirCapabilityContainer([0xe1, 0x10, 0x6d, 0x00])
  assert.equal(r.formatada, true)
  assert.equal(r.deFabrica, false, 'nao e o CC de fabrica de uma NTAG213')
  assert.equal(r.bytesDeMemoria, 872)
})

test('CC que nao comeca com E1: a etiqueta nao esta formatada como NDEF', () => {
  const r = conferirCapabilityContainer([0x00, 0x00, 0x00, 0x00])
  assert.equal(r.formatada, false)
  assert.equal(r.deFabrica, false)
  assert.equal(r.bytesDeMemoria, 0)
  assert.equal(r.podeGravar, false)
  assert.match(r.aviso, /formatada/i, 'a frase tem de dizer o que ha de errado')
})

test('CC de etiqueta travada: da para ler, nao da para gravar', () => {
  // o segundo pedaco do quarto byte manda no gravar: 0 = pode, F = nao pode
  const r = conferirCapabilityContainer([0xe1, 0x10, 0x12, 0x0f])
  assert.equal(r.formatada, true)
  assert.equal(r.podeGravar, false)
  assert.match(r.aviso, /travada|só dá para ler|so da para ler/i)
})

test('pagina 3 nao lida, curta ou nula avisa em vez de fingir', () => {
  for (const nada of [null, undefined, [], [0xe1, 0x10], 'nada']) {
    const r = conferirCapabilityContainer(nada)
    assert.equal(r.formatada, false, `${String(nada)} nao pode passar por formatada`)
    assert.match(r.aviso, /p[aá]gina 3/i)
  }
})

test('aceita Uint8Array, que e o que um leitor devolve', () => {
  const r = conferirCapabilityContainer(Uint8Array.from([0xe1, 0x10, 0x12, 0x00]))
  assert.equal(r.deFabrica, true)
  assert.equal(r.bytesDeMemoria, 144)
  // e o mesmo vale para as outras duas funcoes
  const escritas = planoDeGravacao(ENDERECO, Uint8Array.from(DE_FABRICA))
  assert.equal(escritas[0].pagina, 5)
  assert.equal(enderecoNaEtiqueta(Uint8Array.from(memoriaDepois(escritas, DE_FABRICA))), ENDERECO)
})

// ── A MENSAGEM PODE TER MAIS DE UM REGISTRO ────────────────────────────────
// LER SO O PRIMEIRO REGISTRO E O DEFEITO MAIS PERIGOSO DESTE ARQUIVO.
// `conferirLeitura` (nfc-fila.js) trata endereco vazio como 'vazia' → PODE
// GRAVAR. Entao uma etiqueta que JA TEM outra peca, mas com o endereco no
// segundo registro, seria lida como em branco e gravada por cima: a bolsa que
// estava com aquela etiqueta perde a identidade, e ninguem descobre ate uma
// cliente encostar o celular e ver a bolsa errada.
//
// O caminho do celular sempre fez certo: `urlDaMensagem`, em gravador-nfc.js,
// ja percorre TODOS os `records`. Aqui tinha de ser igual.

// Embrulha uma mensagem NDEF no TLV com terminador, do jeito que fica na etiqueta.
const comTlv = (mensagem) => [0x03, mensagem.length, ...mensagem, 0xfe]

test('endereco no SEGUNDO registro tambem e encontrado', () => {
  // registro de TEXTO primeiro (91 = primeiro registro, forma curta, tipo
  // conhecido), registro de URL depois (51 = ultimo registro)
  const texto1 = [0x91, 0x01, 0x04, 0x54, 0x02, ...texto('enA')]
  const url = [0x51, 0x01, 0x06, 0x55, 0x04, ...texto('x.com')]
  assert.equal(enderecoNaEtiqueta(comTlv([...texto1, ...url])), 'https://x.com')
})

test('endereco depois do registro de aplicativo do Android e encontrado', () => {
  // O caso de verdade: etiqueta gravada pelo NFC Tools na bancada. Ele poe um
  // Android Application Record (tipo externo, TNF 4) ANTES do endereco.
  const nome = 'android.com:pkg'
  const pacote = 'com.wakdev.wdnfc'
  const aar = [0x94, nome.length, pacote.length, ...texto(nome), ...texto(pacote)]
  const resto = `vesselbrasil.com.br/verify/${CODIGO}`
  const url = [0x51, 0x01, 1 + resto.length, 0x55, 0x04, ...texto(resto)]
  assert.equal(enderecoNaEtiqueta(comTlv([...aar, ...url])), ENDERECO,
    'a etiqueta JA TEM esta peca: dizer que esta vazia manda gravar por cima')
})

test('pedaco de registro cortado (bit CF) nao passa por endereco inteiro', () => {
  // B1 tem o bit CF: e so o COMECO de um endereco, continuado no registro
  // seguinte (TNF 6, "continua o de cima"). Meio endereco nao vale por endereco.
  const pedaco1 = [0xb1, 0x01, 0x04, 0x55, 0x04, ...texto('abc')]
  const pedaco2 = [0x16, 0x00, 0x03, ...texto('def')]
  const url = [0x51, 0x01, 0x06, 0x55, 0x04, ...texto('x.com')]
  assert.equal(enderecoNaEtiqueta(comTlv([...pedaco1, ...pedaco2, ...url])), 'https://x.com')
})

test('registro de endereco absoluto (TNF 3) tambem e endereco', () => {
  // O celular le este tipo tambem (`absolute-url`, em urlDaMensagem). Se o
  // tradutor de mesa nao lesse, ele diria "vazia" para uma etiqueta ocupada.
  const url = 'https://x.com/a'
  assert.equal(enderecoNaEtiqueta(comTlv([0xd3, url.length, 0x00, ...texto(url)])), url)
})

test('endereco absoluto que nao e da web nao vale por endereco', () => {
  const urn = 'urn:nfc:ext:x'
  assert.equal(enderecoNaEtiqueta(comTlv([0xd3, urn.length, 0x00, ...texto(urn)])), '')
})

test('varios registros e NENHUM de endereco devolve vazio', () => {
  const texto1 = [0x91, 0x01, 0x04, 0x54, 0x02, ...texto('enA')]
  const texto2 = [0x51, 0x01, 0x04, 0x54, 0x02, ...texto('enB')]
  assert.equal(enderecoNaEtiqueta(comTlv([...texto1, ...texto2])), '')
})
