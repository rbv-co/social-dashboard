import test from 'node:test'
import assert from 'node:assert/strict'
import { temSuporte, urlDaMensagem, traduzirFalha, criarGravador } from './gravador-nfc.js'
import { conferirLeitura } from './nfc-fila.js'
import { enderecoDaTag } from './lotes.js'

// ── um NDEFReader de mentira ──────────────────────────────────────
// node --test nao abre navegador e nao tem NDEFReader. E por isso que ele entra
// por injecao: sem isso, nada aqui seria testavel.
//
// O DUBLE TEM DE IMITAR O NAVEGADOR, NUNCA CONCORDAR COM A IMPLEMENTACAO.
// A versao anterior guardava a string crua que o `write` recebia e deixava o
// `scan()` ser chamado quantas vezes quisessem. Por isso os dois defeitos mais
// graves da gravacao passaram verdes: a etiqueta gravada como TEXTO (que nao
// abre nada no celular da cliente) e o segundo `scan()` recusado pelo navegador.
// Agora ele imita as duas regras da especificacao:
//   1. `write(string)` grava um registro `text`; `write({records})` grava os
//      registros como vieram (e `data` em string vira bytes, como no navegador);
//   2. `scan()` recusa com InvalidStateError enquanto houver um scan ativo que
//      nao foi abortado.
// A `etiqueta` do closure e a etiqueta FISICA: o que o write deixa nela e o que
// o scan devolve. E o que permite o teste de ida e volta la embaixo.
function janelaDeMentira({ aoLer, aoGravar, aoTravar, etiqueta = { mensagem: null } } = {}) {
  class NDEFReaderFalso {
    async scan({ signal } = {}) {
      // spec: "If reader is already in the activated reader objects, then
      // reject p with an InvalidStateError."
      if (this.escaneando) {
        throw Object.assign(new Error('scan ja ativo neste leitor'), { name: 'InvalidStateError' })
      }
      this.escaneando = true
      signal?.addEventListener('abort', () => { this.escaneando = false })
      if (typeof aoLer === 'function') return aoLer(this)
      // sem roteiro combinado, a etiqueta de mentira devolve o que ESTA gravado
      // nela — em branco inclusive, que e o caso da etiqueta nova
      setTimeout(() => {
        this.ouvintes?.reading?.({ message: etiqueta.mensagem || { records: [] } })
      }, 0)
      return undefined
    }
    async write(dado) {
      const registros = typeof dado === 'string'
        ? [{ recordType: 'text', data: dado }]   // string vira TEXTO, como manda a spec
        : (dado?.records || [])
      etiqueta.mensagem = {
        records: registros.map((r) => ({
          recordType: r.recordType,
          encoding: r.encoding || 'utf-8',
          data: typeof r.data === 'string' ? new TextEncoder().encode(r.data) : r.data,
        })),
      }
      if (typeof aoGravar === 'function') return aoGravar(dado)
      return undefined
    }
    async makeReadOnly() {
      if (typeof aoTravar === 'function') return aoTravar()
      return undefined
    }
    addEventListener(nome, ouvinte) { (this.ouvintes ||= {})[nome] = ouvinte }
  }
  return { NDEFReader: NDEFReaderFalso }
}

const mensagemComUrl = (url) => ({
  records: [{ recordType: 'url', encoding: 'utf-8', data: new TextEncoder().encode(url) }],
})

test('temSuporte: falso quando o navegador nao tem NDEFReader', () => {
  assert.equal(temSuporte({}), false)
})

test('temSuporte: verdadeiro quando tem', () => {
  assert.equal(temSuporte(janelaDeMentira()), true)
})

test('urlDaMensagem: tira o endereco do registro de url', () => {
  assert.equal(
    urlDaMensagem(mensagemComUrl('https://vesselbrasil.com.br/verify/AAA111')),
    'https://vesselbrasil.com.br/verify/AAA111',
  )
})

test('urlDaMensagem: etiqueta em branco devolve vazio', () => {
  assert.equal(urlDaMensagem({ records: [] }), '')
  assert.equal(urlDaMensagem(null), '')
})

test('urlDaMensagem: ignora registro que nao e endereco', () => {
  const so_texto = { records: [{ recordType: 'text', data: new TextEncoder().encode('oi') }] }
  assert.equal(urlDaMensagem(so_texto), '')
})

test('traduzirFalha: etiqueta pequena demais', () => {
  const e = new Error('x'); e.name = 'NotSupportedError'
  assert.match(traduzirFalha(e), /espaço/i)
})

test('traduzirFalha: NFC desligado', () => {
  const e = new Error('x'); e.name = 'NotReadableError'
  assert.match(traduzirFalha(e), /ligue o nfc/i)
})

test('traduzirFalha: etiqueta saiu de perto', () => {
  const e = new Error('x'); e.name = 'NetworkError'
  assert.match(traduzirFalha(e), /encoste de novo/i)
})

test('traduzirFalha: permissao negada', () => {
  const e = new Error('x'); e.name = 'NotAllowedError'
  assert.match(traduzirFalha(e), /permiss/i)
})

test('traduzirFalha: falha desconhecida nao vira mensagem vazia', () => {
  const e = new Error('coisa estranha'); e.name = 'CoisaEstranha'
  const frase = traduzirFalha(e)
  assert.ok(frase.length > 10, 'a frase precisa dizer alguma coisa')
})

test('criarGravador: devolve nulo quando o navegador nao grava NFC', () => {
  assert.equal(criarGravador({ janela: {} }), null)
})

test('criarGravador: gravar escreve um registro de ENDERECO, nao uma string solta', async () => {
  // string solta viraria registro `text`, e registro de texto nao abre pagina
  // nenhuma quando a cliente encosta o celular na bolsa
  let recebido = null
  const g = criarGravador({ janela: janelaDeMentira({ aoGravar: (d) => { recebido = d } }) })
  await g.gravar('https://vesselbrasil.com.br/verify/AAA111')
  assert.deepEqual(recebido, {
    records: [{ recordType: 'url', data: 'https://vesselbrasil.com.br/verify/AAA111' }],
  })
})

test('criarGravador: travar chama makeReadOnly', async () => {
  let travou = false
  const g = criarGravador({ janela: janelaDeMentira({ aoTravar: () => { travou = true } }) })
  await g.travar()
  assert.equal(travou, true)
})

test('criarGravador: lerUmaVez devolve o endereco que veio na etiqueta', async () => {
  const janela = janelaDeMentira({
    aoLer: (leitor) => { setTimeout(() => leitor.ouvintes.reading({ message: mensagemComUrl('https://vesselbrasil.com.br/verify/AAA111') }), 0) },
  })
  const g = criarGravador({ janela })
  assert.equal(await g.lerUmaVez({ milissegundos: 500 }),
    'https://vesselbrasil.com.br/verify/AAA111')
})

test('criarGravador: lerUmaVez desiste quando ninguem encosta a etiqueta', async () => {
  // A recusa carrega o NOME do erro, nao a frase em portugues: traduzir e
  // trabalho de traduzirFalha, e so dele. Conferir a frase aqui amarraria dois
  // trabalhos no mesmo teste.
  const g = criarGravador({ janela: janelaDeMentira({ aoLer: () => {} }) })
  await assert.rejects(
    () => g.lerUmaVez({ milissegundos: 30 }),
    (erro) => erro.name === 'AbortError',
  )
})

// ── OS TESTES QUE TERIAM PEGO OS DOIS DEFEITOS GRAVES ───────────────────

test('IDA E VOLTA: grava pelo gravador, le pelo MESMO gravador, e confere', async () => {
  // Este e o teste que teria pego os dois Criticos no primeiro `node --test`:
  // com o `write` de string, a volta vinha '' (registro de texto, que
  // `urlDaMensagem` nao le) e a segunda leitura nem acontecia (InvalidStateError).
  const g = criarGravador({ janela: janelaDeMentira() })
  await g.gravar(enderecoDaTag('AAA111'))
  const lido = await g.lerUmaVez({ milissegundos: 500 })
  assert.equal(lido, enderecoDaTag('AAA111'))
  assert.equal(conferirLeitura(lido, 'AAA111'), 'confere',
    'sem "confere" a tela nunca marcaria a peca — o caminho NFC seria inutil')
})

test('ler DUAS vezes no mesmo gravador: a segunda leitura nao e recusada', async () => {
  // e exatamente o que a tela faz: ler antes de gravar e ler depois de gravar,
  // no mesmo objeto. Sem o AbortController a segunda recusa com InvalidStateError.
  const g = criarGravador({ janela: janelaDeMentira() })
  const antes = await g.lerUmaVez({ milissegundos: 500 })
  assert.equal(antes, '', 'etiqueta em branco')
  await g.gravar(enderecoDaTag('BBB222'))
  const depois = await g.lerUmaVez({ milissegundos: 500 })
  assert.equal(conferirLeitura(depois, 'BBB222'), 'confere')
})

test('leitura que esgotou o tempo tambem libera o leitor para a proxima', async () => {
  // o abort tem de sair no `finally`: se so saisse no sucesso, uma etiqueta que
  // demorou deixaria o leitor travado pelo resto da sessao
  let roteiro = () => {}
  const janela = janelaDeMentira({ aoLer: (leitor) => roteiro(leitor) })
  const g = criarGravador({ janela })

  await assert.rejects(() => g.lerUmaVez({ milissegundos: 30 }), (e) => e.name === 'AbortError')

  roteiro = (leitor) => {
    setTimeout(() => leitor.ouvintes.reading({ message: mensagemComUrl(enderecoDaTag('CCC333')) }), 0)
  }
  assert.equal(await g.lerUmaVez({ milissegundos: 500 }), enderecoDaTag('CCC333'))
})

test('traduzirFalha: leitor ocupado nao manda trocar a etiqueta', () => {
  const e = new Error('x'); e.name = 'InvalidStateError'
  const frase = traduzirFalha(e)
  assert.match(frase, /etiqueta est\u00e1 boa/i, 'a etiqueta nao tem defeito nenhum aqui')
  assert.doesNotMatch(frase, /troque a etiqueta/i, 'trocar etiqueta boa e jogar bolsa fora')
})
