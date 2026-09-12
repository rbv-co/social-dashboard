import { test } from 'node:test'
import assert from 'node:assert/strict'
import { criarLeitorDeMesa } from './leitor-de-mesa.js'
import { gravarUmaPeca } from './gravar-uma-peca.js'
import { criarFila, ACOES } from './fila.js'
import { enderecoDaTag } from '../src/ferramentas/autenticidade/lotes.js'
import { enderecoNaEtiqueta } from '../src/ferramentas/autenticidade/gravador-de-mesa/ndef-para-ntag213.js'

// ── O MOTOR INTEIRO, COM UMA NTAG213 DE MENTIRA DO OUTRO LADO DO USB ───────
//
// Os quatro pedaços deste motor passam nos testes deles sozinhos. Isso não
// prova que eles se encaixam: já aconteceu nesta base de dois lados certos
// nunca terem se encontrado (o resultado da gravação saía sem o código da peça,
// e a fila recebia um resultado órfão). Este arquivo liga tudo — ponte de
// mentira → leitor-de-mesa → gravar-uma-peca → fila — e grava um lote inteiro.
//
// A etiqueta de mentira responde AOS BYTES DE VERDADE, os mesmos provados na
// bancada do dono em 01/09/2026: `FF B0` para ler, `FF D6` para escrever,
// `90 00` no fim. Uma de mentira que respondesse a chamadas de função em vez de
// a bytes não provaria nada do que interessa.
//
// Do outro lado da ponte não há mais biblioteca compilada nenhuma: a ponte de
// verdade é um PowerShell vivo, e a de mentira aqui é o mesmo punhado de cinco
// métodos que ela expõe.

const BYTES_POR_PAGINA = 4
const PAGINAS = 45 // 0 a 44: a NTAG213 inteira, para flagrar escrita fora da faixa

function etiquetaNtag213() {
  const paginas = Array.from({ length: PAGINAS }, () => [0, 0, 0, 0])
  paginas[0] = [0x04, 0xa2, 0x3b, 0x7a]
  paginas[1] = [0x11, 0x22, 0x33, 0x44]
  paginas[2] = [0x55, 0x48, 0x00, 0x00]
  paginas[3] = [0xe1, 0x10, 0x12, 0x00]          // Capability Container de fábrica
  paginas[4] = [0x01, 0x03, 0xa0, 0x0c]          // Lock Control TLV...
  paginas[5] = [0x34, 0x03, 0x00, 0xfe]          // ...que atravessa para a página 5
  return paginas
}

function memoriaDoUsuario(paginas) {
  return paginas.slice(4, 40).flat()
}

function ponteComEtiqueta(paginas, { registro = [] } = {}) {
  return {
    registro,
    async iniciar() { return true },
    async listarLeitores() { return ['ACS ACR122U PICC Interface 00 00'] },
    async conectar() { return true },
    async transmitir(comando) {
      const apdu = Array.from(comando)
      registro.push(apdu)
      const [cla, ins, , p2] = apdu
      // ⚠️ O LEITOR DE VERDADE RESPONDE `63 00` A COMANDO DE TAMANHO ERRADO —
      // medido na bancada em 01/09/2026, com `FFB000030400` (um byte a mais).
      // A de mentira faz o mesmo: uma que aceitasse qualquer tamanho deixaria a
      // suíte verde em cima de um comando que a vida real recusa.
      const tamanhos = { 0xb0: 5, 0xd6: 9, 0xca: 5 }
      if (tamanhos[ins] && apdu.length !== tamanhos[ins]) return [0x63, 0x00]
      if (cla === 0xff && ins === 0xb0) {          // ler
        const quantos = apdu[4]
        const tudo = paginas.flat()
        return [...tudo.slice(p2 * BYTES_POR_PAGINA, p2 * BYTES_POR_PAGINA + quantos), 0x90, 0x00]
      }
      if (cla === 0xff && ins === 0xd6) {          // escrever
        paginas[p2] = apdu.slice(5, 9)
        return [0x90, 0x00]
      }
      if (cla === 0xff && ins === 0xca) {          // número de série
        return [...paginas[0], ...paginas[1].slice(0, 3), 0x90, 0x00]
      }
      return [0x6d, 0x00]
    },
    async desconectar() { return true },
    async fechar() { return true },
  }
}

const semEspera = async () => {}
const lote = [
  { codigo: 'AAA111', numero_na_serie: 1, lote_id: 'L1' },
  { codigo: 'BBB222', numero_na_serie: 2, lote_id: 'L1' },
  { codigo: 'CCC333', numero_na_serie: 3, lote_id: 'L1' },
]

test('um lote de 3 peças vai da fila até a etiqueta, e volta marcado', async () => {
  const marcadas = []
  const fila = criarFila({ pecas: lote })

  while (!fila.acabou()) {
    const peca = fila.proxima()
    const paginas = etiquetaNtag213() // uma etiqueta nova para cada peça
    const leitor = criarLeitorDeMesa({
      ponte: ponteComEtiqueta(paginas),
      dormir: semEspera,
    })
    const sessao = await leitor.conectar()
    const resultado = await gravarUmaPeca({
      sessao,
      peca,
      marcar: async (p) => { marcadas.push(p.codigo); return { ok: true } },
    })
    await sessao.desconectar()
    await leitor.fechar()

    assert.equal(resultado.estado, 'gravada', `a peça ${peca.codigo} não gravou: ${resultado.frase}`)
    assert.equal(fila.registrar(resultado).acao, ACOES.SEGUIR)
    // a etiqueta de verdade guardou o endereço de verdade
    assert.equal(enderecoNaEtiqueta(memoriaDoUsuario(paginas)), enderecoDaTag(peca.codigo))
    // e o Lock Control de fábrica continua inteiro
    assert.deepEqual(paginas[4].slice(0, 4), [0x01, 0x03, 0xa0, 0x0c])
  }

  assert.deepEqual(marcadas, ['AAA111', 'BBB222', 'CCC333'])
  assert.equal(fila.progresso().texto, '3 de 3')
  assert.equal(fila.diario().length, 3)
})

test('nenhum byte foi escrito fora das páginas 4 a 39, do começo ao fim', async () => {
  const paginas = etiquetaNtag213()
  const registro = []
  const leitor = criarLeitorDeMesa({
    ponte: ponteComEtiqueta(paginas, { registro }),
    dormir: semEspera,
  })
  const sessao = await leitor.conectar()
  await gravarUmaPeca({ sessao, peca: lote[0], marcar: async () => ({ ok: true }) })
  for (const apdu of registro.filter((a) => a[1] === 0xd6)) {
    assert.ok(apdu[3] >= 4 && apdu[3] <= 39, `escreveu na página ${apdu[3]}`)
  }
  // as páginas de fora não foram tocadas
  assert.deepEqual(paginas[3], [0xe1, 0x10, 0x12, 0x00])
  assert.deepEqual(paginas[40], [0, 0, 0, 0])
})

// ⚠️ A ETIQUETA REAPROVEITADA É O ERRO MAIS FÁCIL DA BANCADA: as etiquetas são
// idênticas por fora, e a que já foi gravada volta para a caixa sem querer.
test('a etiqueta que já tem outra peça é recusada, e a fila NÃO anda', async () => {
  const paginas = etiquetaNtag213()
  const ponte = ponteComEtiqueta(paginas)

  // primeiro grava a peça BBB222 nesta etiqueta
  const leitor = criarLeitorDeMesa({ ponte, dormir: semEspera })
  const sessao = await leitor.conectar()
  await gravarUmaPeca({ sessao, peca: lote[1], marcar: async () => ({ ok: true }) })

  // agora a MESMA etiqueta aparece na vez da AAA111
  const fila = criarFila({ pecas: lote })
  const resultado = await gravarUmaPeca({
    sessao,
    peca: fila.proxima(),
    marcar: async () => { throw new Error('não podia nem ter chegado aqui') },
  })
  assert.equal(resultado.estado, 'recusada')
  assert.match(resultado.frase, /BBB222/)
  assert.equal(fila.registrar(resultado).acao, ACOES.TROCAR_ETIQUETA)
  assert.equal(fila.proxima().codigo, 'AAA111', 'a fila andou por cima de uma recusa')
  // e a etiqueta continua com a peça de antes, byte por byte
  assert.equal(enderecoNaEtiqueta(memoriaDoUsuario(paginas)), enderecoDaTag('BBB222'))
})

// ⚠️ INTERNET CAI NO MEIO DO TURNO. A etiqueta fica gravada e o sistema não sabe.
test('gravou e a internet caiu: a fila para, guarda a pendência, e retoma depois', async () => {
  const paginas = etiquetaNtag213()
  const leitor = criarLeitorDeMesa({ ponte: ponteComEtiqueta(paginas), dormir: semEspera })
  const sessao = await leitor.conectar()
  const fila = criarFila({ pecas: lote })

  const resultado = await gravarUmaPeca({
    sessao,
    peca: fila.proxima(),
    marcar: async () => { throw new Error('fetch failed') },
  })
  assert.equal(resultado.estado, 'gravada-sem-marcar')
  assert.equal(fila.registrar(resultado).acao, ACOES.PARAR)
  assert.equal(fila.proxima(), null)

  // o programa fecha com a pendência salva...
  const salvo = JSON.parse(JSON.stringify(fila.instantaneo()))
  const depois = criarFila({ pecas: lote, retomandoDe: salvo })
  assert.deepEqual(depois.pendentesDeMarcacao().map((p) => p.codigo), ['AAA111'])
  // ...e a peça que já tem etiqueta no mundo NÃO volta para a fila
  assert.equal(depois.proxima().codigo, 'BBB222')

  // quando a internet volta e a marcação passa, a conta fecha
  depois.marcacaoResolvida('AAA111')
  assert.equal(depois.progresso().texto, '1 de 3')
})
