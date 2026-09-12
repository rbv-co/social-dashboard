import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  apduDeEscrita,
  apduDeLeitura,
  APDU_NUMERO_DE_SERIE,
  APDU_VERSAO_DO_LEITOR,
  lerResposta,
  emHex,
  conferirApdu,
} from './comandos-do-acr122u.js'

// ── MONTAR O QUE VAI PARA O APARELHO ───────────────────────────────────────
// Os bytes conferidos contra o manual da ACS e provados na bancada do dono em
// 01/09/2026, no ACR122U de firmware ACR122U220.

test('escrever uma página monta FF D6 00 <página> 04 <4 bytes>', () => {
  assert.deepEqual(
    apduDeEscrita(4, [0x01, 0x03, 0xa0, 0x0c]),
    [0xff, 0xd6, 0x00, 0x04, 0x04, 0x01, 0x03, 0xa0, 0x0c],
  )
})

test('escrever aceita Uint8Array, porque o plano de gravação pode vir assim', () => {
  assert.deepEqual(
    apduDeEscrita(39, Uint8Array.from([0, 0, 0, 0xfe])),
    [0xff, 0xd6, 0x00, 0x27, 0x04, 0x00, 0x00, 0x00, 0xfe],
  )
})

test('ler monta FF B0 00 <página> <quantos bytes>', () => {
  assert.deepEqual(apduDeLeitura(3, 4), [0xff, 0xb0, 0x00, 0x03, 0x04])
  assert.deepEqual(apduDeLeitura(4, 16), [0xff, 0xb0, 0x00, 0x04, 0x10])
})

test('o número de série e a versão do leitor são os comandos provados na bancada', () => {
  assert.deepEqual(APDU_NUMERO_DE_SERIE, [0xff, 0xca, 0x00, 0x00, 0x00])
  assert.deepEqual(APDU_VERSAO_DO_LEITOR, [0xff, 0x00, 0x48, 0x00, 0x00])
})

// ── AS RECUSAS, ANTES DE MANDAR PARA O APARELHO ────────────────────────────

test('escrever fora das páginas 4 a 39 é recusado ANTES de sair daqui', () => {
  for (const pagina of [-1, 0, 3, 40, 41, 44, 255]) {
    assert.throws(() => apduDeEscrita(pagina, [0, 0, 0, 0]), /página/i,
      `a página ${pagina} passou, e não podia`)
  }
})

test('a página 3 é recusada na escrita mesmo sendo legítima na leitura', () => {
  assert.throws(() => apduDeEscrita(3, [0xe1, 0x10, 0x12, 0x00]), /Capability Container/i)
  assert.deepEqual(apduDeLeitura(3, 4), [0xff, 0xb0, 0x00, 0x03, 0x04])
})

test('escrever com número de bytes diferente de 4 é recusado', () => {
  assert.throws(() => apduDeEscrita(4, [1, 2, 3]), /4 bytes/i)
  assert.throws(() => apduDeEscrita(4, [1, 2, 3, 4, 5]), /4 bytes/i)
  assert.throws(() => apduDeEscrita(4, []), /4 bytes/i)
  assert.throws(() => apduDeEscrita(4, null), /4 bytes/i)
})

test('escrever byte que não é byte é recusado', () => {
  assert.throws(() => apduDeEscrita(4, [1, 2, 3, 256]), /byte/i)
  assert.throws(() => apduDeEscrita(4, [1, 2, 3, -1]), /byte/i)
  assert.throws(() => apduDeEscrita(4, [1, 2, 3, 1.5]), /byte/i)
  assert.throws(() => apduDeEscrita(4, [1, 2, 3, undefined]), /byte/i)
})

test('página que não é número inteiro é recusada', () => {
  assert.throws(() => apduDeEscrita('4', [0, 0, 0, 0]), /página/i)
  assert.throws(() => apduDeEscrita(4.5, [0, 0, 0, 0]), /página/i)
  assert.throws(() => apduDeLeitura(null, 4), /página/i)
})

test('ler mais de 16 bytes de uma vez é recusado: o comando não vai além disso', () => {
  assert.throws(() => apduDeLeitura(4, 17), /16/)
  assert.throws(() => apduDeLeitura(4, 0), /1 a 16/)
  assert.throws(() => apduDeLeitura(4, -4), /1 a 16/)
})

test('ler além da página 39 é recusado: a leitura atravessa páginas e cairia nas travas', () => {
  // a página 39 é a última do usuário; 16 bytes a partir dela invadem as
  // páginas 40 em diante (travas dinâmicas, configuração e senha)
  assert.throws(() => apduDeLeitura(39, 16), /39/)
  assert.throws(() => apduDeLeitura(38, 16), /39/)
  // 36..39 são exatamente os últimos 16 bytes do usuário: esta TEM de passar
  assert.deepEqual(apduDeLeitura(36, 16), [0xff, 0xb0, 0x00, 0x24, 0x10])
})

// ── LER O QUE O APARELHO RESPONDEU ─────────────────────────────────────────

test('resposta que termina em 90 00 é boa, e os dados vêm sem o 90 00', () => {
  const r = lerResposta([0xe1, 0x10, 0x12, 0x00, 0x90, 0x00])
  assert.equal(r.ok, true)
  assert.deepEqual(r.dados, [0xe1, 0x10, 0x12, 0x00])
  assert.equal(r.aviso, '')
})

test('escrita bem-sucedida responde só 90 00, com zero dados', () => {
  const r = lerResposta([0x90, 0x00])
  assert.equal(r.ok, true)
  assert.deepEqual(r.dados, [])
})

test('resposta aceita Buffer e Uint8Array, que é o que a biblioteca devolve', () => {
  assert.equal(lerResposta(Uint8Array.from([0x90, 0x00])).ok, true)
  assert.deepEqual(lerResposta(Buffer.from([0xaa, 0x90, 0x00])).dados, [0xaa])
})

test('qualquer final que não seja 90 00 é FALHA, nunca sucesso silencioso', () => {
  const r = lerResposta([0x63, 0x00])
  assert.equal(r.ok, false)
  assert.match(r.aviso, /\S/)
  assert.deepEqual(r.dados, [])
})

test('os códigos de recusa mais comuns viram frase de bancada, não hexadecimal cru', () => {
  assert.match(lerResposta([0x63, 0x00]).aviso, /comando/i)
  assert.match(lerResposta([0x6a, 0x81]).aviso, /não aceita|não suporta/i)
  assert.match(lerResposta([0x6b, 0x00]).aviso, /página/i)
})

test('código desconhecido diz o hexadecimal, em vez de inventar um motivo', () => {
  const r = lerResposta([0x6f, 0x42])
  assert.equal(r.ok, false)
  assert.match(r.aviso, /6F 42/)
})

test('resposta com menos de 2 bytes é resposta TRUNCADA, e truncada não é boa', () => {
  for (const curta of [[], [0x90]]) {
    const r = lerResposta(curta)
    assert.equal(r.ok, false, `${JSON.stringify(curta)} passou, e não podia`)
    assert.match(r.aviso, /cortou|truncad|no meio/i)
  }
})

test('resposta nula ou de tipo errado é falha, nunca "leu vazio"', () => {
  for (const lixo of [null, undefined, 'oi', 42, {}]) {
    assert.equal(lerResposta(lixo).ok, false, `${String(lixo)} passou, e não podia`)
  }
})

// ⚠️ A CICATRIZ QUE MAIS IMPORTA DESTE ARQUIVO: uma leitura CURTA que termina em
// 90 00 é uma resposta "boa" que trouxe menos bytes do que se pediu. Sem esta
// conferência, ler 16 bytes e receber 4 devolveria uma memória incompleta, o
// tradutor diria "não achei endereço", e a tela concluiria ETIQUETA EM BRANCO —
// autorizando gravar por cima de uma bolsa que já tem dono.
test('leitura que veio com menos bytes do que se pediu NÃO é sucesso', () => {
  const r = lerResposta([0x01, 0x03, 0x90, 0x00], { bytesEsperados: 16 })
  assert.equal(r.ok, false)
  assert.match(r.aviso, /2 de 16|incompleta|cortou/i)
})

test('leitura com a quantidade exata de bytes pedida passa', () => {
  const r = lerResposta([1, 2, 3, 4, 0x90, 0x00], { bytesEsperados: 4 })
  assert.equal(r.ok, true)
  assert.deepEqual(r.dados, [1, 2, 3, 4])
})

test('leitura que veio com bytes DEMAIS também não passa', () => {
  const r = lerResposta([1, 2, 3, 4, 5, 0x90, 0x00], { bytesEsperados: 4 })
  assert.equal(r.ok, false)
})

test('emHex escreve os bytes do jeito que o manual e o log escrevem', () => {
  assert.equal(emHex([0xff, 0x00, 0x0a]), 'FF 00 0A')
  assert.equal(emHex([]), '')
})

// ── O TAMANHO TOTAL DO COMANDO ─────────────────────────────────────────────
//
// ⚠️ A CICATRIZ, MEDIDA NA BANCADA EM 01/09/2026: foi mandado `FFB000030400` —
// seis bytes, um a mais que os cinco de `FF B0 00 03 04`. O leitor respondeu
// `63 00`, um código que não diz nada a ninguém, e DUAS RODADAS foram gastas
// procurando defeito na etiqueta e no aparelho. O comando estava errado, e o
// erro nasceu deste lado.
//
// Este arquivo já recusava página fora da faixa e escrita sem 4 bytes. Faltava
// o tamanho TOTAL, que é fixo e conhecido em cada um dos quatro comandos.

test('cada comando tem um tamanho fixo, e o certo passa', () => {
  assert.doesNotThrow(() => conferirApdu(apduDeLeitura(3, 4)))
  assert.doesNotThrow(() => conferirApdu(apduDeEscrita(4, [1, 2, 3, 4])))
  assert.doesNotThrow(() => conferirApdu(APDU_NUMERO_DE_SERIE))
  assert.doesNotThrow(() => conferirApdu(APDU_VERSAO_DO_LEITOR))
})

// A conta, byte a byte, para ninguém ter de refazer de cabeça:
//   ler      FF B0 00 <página> <n>                    → 5
//   escrever FF D6 00 <página> 04 <b1 b2 b3 b4>       → 5 + 4 = 9
//   série    FF CA 00 00 00                           → 5
//   versão   FF 00 48 00 00                           → 5
test('os quatro tamanhos são 5, 9, 5 e 5 — e o de escrever é 9, não 10', () => {
  assert.equal(apduDeLeitura(3, 4).length, 5)
  assert.equal(apduDeEscrita(4, [1, 2, 3, 4]).length, 9)
  assert.equal(APDU_NUMERO_DE_SERIE.length, 5)
  assert.equal(APDU_VERSAO_DO_LEITOR.length, 5)
})

test('o comando com um byte a mais é recusado, dizendo quantos vieram e quantos eram', () => {
  // exatamente o comando que foi mandado à mão na bancada e virou `63 00`
  assert.throws(() => conferirApdu([0xff, 0xb0, 0x00, 0x03, 0x04, 0x00]), (erro) => {
    assert.match(erro.message, /vieram 6/, 'não disse quantos bytes vieram')
    assert.match(erro.message, /5 bytes/, 'não disse quantos eram esperados')
    return true
  })
})

test('o comando com um byte a menos também é recusado', () => {
  assert.throws(() => conferirApdu([0xff, 0xb0, 0x00, 0x03]), /4[\s\S]*5|5[\s\S]*4/)
  assert.throws(() => conferirApdu([0xff, 0xd6, 0x00, 0x04, 0x04, 1, 2, 3]), /8[\s\S]*9|9[\s\S]*8/)
})

test('a escrita com 10 bytes é recusada: são 9, e 10 seria um byte pendurado', () => {
  assert.throws(() => conferirApdu([0xff, 0xd6, 0x00, 0x04, 0x04, 1, 2, 3, 4, 5]), /10[\s\S]*9|9[\s\S]*10/)
})

// ⚠️ NÃO SE INVENTA COMANDO DE APARELHO. Os quatro acima são os provados na
// etiqueta; qualquer outro cabeçalho é recusado aqui, e não descoberto pelo
// leitor com um `63 00` que ninguém sabe ler.
test('cabeçalho que não é um dos quatro comandos provados é recusado', () => {
  for (const estranho of [[0xff, 0xd7, 0x00, 0x04, 0x04], [0x00, 0xa4, 0x04, 0x00, 0x00],
    [0xff, 0x82, 0x00, 0x00, 0x06], []]) {
    assert.throws(() => conferirApdu(estranho), /comando/i,
      `${estranho.join(',')} passou, e não podia`)
  }
})

test('conferirApdu recusa o que nem é lista de bytes', () => {
  for (const lixo of [null, undefined, 'FFB0', 42, {}]) {
    assert.throws(() => conferirApdu(lixo), /comando/i)
  }
})

// ⚠️ `63 00` MANDOU DUAS PESSOAS OLHAREM PARA A ETIQUETA quando o defeito era o
// comando. A frase tem de dizer o que ele significa na prática — comando que o
// leitor não entendeu — e NÃO pode mandar trocar a etiqueta.
test('63 00 diz que o leitor não entendeu o comando, e não culpa a etiqueta', () => {
  const aviso = lerResposta([0x63, 0x00]).aviso
  assert.match(aviso, /não entendeu|não executou/i)
  assert.doesNotMatch(aviso, /troque a etiqueta/i)
  assert.doesNotMatch(aviso, /danificada/i)
})
