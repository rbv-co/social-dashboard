/* A SEQUÊNCIA DO LEITOR DE MESA — a ordem, e o que ela impede.
 *
 * A ordem é a mesma do motor (`gravador/gravar-uma-peca.js`) e cada passo custou
 * caro: lê antes, monta o plano A PARTIR DO QUE LEU, escreve, lê de volta e
 * confere, e SÓ ENTÃO marca no banco.
 *
 * Este arquivo prova a ordem de verdade — não pelo texto do `.vue`, que não diz
 * o que acontece quando a etiqueta sai no meio. A porta entra por injeção.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { gravarPeloLeitorDeMesa, escreverEConferir } from './gravar-pelo-leitor-de-mesa.js'
import { planoDeGravacao, BYTES_DE_USUARIO } from './ndef-para-ntag213.js'
import { criarGravadorDeMesa } from './porta-do-gravador-de-mesa.js'
import { enderecoDaTag } from '../lotes.js'

function memoriaDeFabrica() {
  const m = new Array(BYTES_DE_USUARIO).fill(0)
  m[0] = 0x01; m[1] = 0x03; m[2] = 0xa0; m[3] = 0x0c; m[4] = 0x34
  m[5] = 0x03; m[6] = 0x00; m[7] = 0xfe
  return m
}

function comEndereco(endereco) {
  const m = memoriaDeFabrica()
  for (const { pagina, bytes } of planoDeGravacao(endereco, m)) {
    const i = (pagina - 4) * 4
    for (let k = 0; k < 4; k++) m[i + k] = bytes[k]
  }
  return m
}

/* ⚠️ O DUBLÊ IMITA O MUNDO, NUNCA CONCORDA COM A IMPLEMENTAÇÃO.
 *
 * Aqui de mentira é a JANELA (`window.gravadorDeMesa`), e a porta que a
 * sequência usa é a DE VERDADE, montada por cima dela. A primeira versão deste
 * arquivo fingia a porta inteira — e por isso deixou passar um defeito real:
 * endereço que não cabe na etiqueta saía como "a gravação parou na metade,
 * SEPARE ESTA ETIQUETA", com a etiqueta intacta em cima do leitor. Uma etiqueta
 * boa no lixo por peça, e a suíte verde.
 */
function portaDeMentira({
  memoria = memoriaDeFabrica(),
  capability = [0xe1, 0x10, 0x12, 0x00],
  aoConectar = null,
  aoLer = null,
  aoGravar = null,
  guarda = true,          // etiqueta com defeito responde bem e não guarda nada
} = {}) {
  const registro = { conectou: 0, leituras: 0, gravacoes: 0, desconectou: 0 }
  const atual = [...memoria]
  const janela = {
    gravadorDeMesa: {
      async conectar() { registro.conectou += 1; if (aoConectar) await aoConectar(); return 'ACR122U' },
      async lerPaginas(pagina, quantos) {
        // uma leitura da etiqueta são 10 idas ao chip: a conta de leituras é
        // por LEITURA INTEIRA, que é o que a sequência decide em cima
        if (pagina === 3) registro.leituras += 1
        if (aoLer) await aoLer(registro.leituras, pagina)
        if (pagina === 3) return capability.slice(0, quantos)
        const i = (pagina - 4) * 4
        return atual.slice(i, i + quantos)
      },
      async escreverPagina(pagina, bytes) {
        registro.gravacoes += 1
        if (aoGravar) await aoGravar(pagina, bytes)
        if (!guarda) return true // responde `90 00` e não guarda nada
        const i = (pagina - 4) * 4
        for (let k = 0; k < 4; k++) atual[i + k] = bytes[k]
        return true
      },
      async desconectar() { registro.desconectou += 1 },
    },
  }
  return { registro, porta: criarGravadorDeMesa({ janela }) }
}

const PECA = { codigo: 'AAA111', numero_na_serie: 3 }
const marcarSempre = async () => true
const marcarNunca = async () => false

/* ── O CAMINHO FELIZ ──────────────────────────────────────────────────────── */

test('etiqueta em branco: lê, grava, lê de volta, confere, e SÓ ENTÃO marca', async () => {
  const { porta, registro } = portaDeMentira()
  const ordem = []
  const r = await gravarPeloLeitorDeMesa({
    porta,
    peca: PECA,
    endereco: enderecoDaTag('AAA111'),
    marcar: async () => { ordem.push('marcou'); return true },
  })
  assert.equal(r.estado, 'gravada')
  assert.equal(r.lido, enderecoDaTag('AAA111'))
  assert.equal(registro.leituras, 2, 'lê antes E lê de volta: são dois')
  // a escrita é de 4 bytes por vez: um endereço destes gasta várias páginas, e
  // é assim mesmo — não existe escrita agrupada nesta etiqueta
  assert.ok(registro.gravacoes > 0, 'não escreveu nada')
  assert.deepEqual(ordem, ['marcou'])
  assert.equal(registro.desconectou, 1, 'a etiqueta tem de ser solta no fim')
})

test('a etiqueta já tinha ESTA peça: não regrava, só marca', async () => {
  // acontece de verdade quando a gravação deu certo e a MARCAÇÃO é que falhou.
  // Regravar só criaria uma chance a mais de a etiqueta sair no meio.
  const { porta, registro } = portaDeMentira({ memoria: comEndereco(enderecoDaTag('AAA111')) })
  const r = await gravarPeloLeitorDeMesa({
    porta, peca: PECA, endereco: enderecoDaTag('AAA111'), marcar: marcarSempre,
  })
  assert.equal(r.estado, 'ja-era-dela')
  assert.equal(registro.gravacoes, 0)
})

/* ── ⚠️ LER ANTES NÃO É OPCIONAL ──────────────────────────────────────────── */

test('⚠️ etiqueta com OUTRA peça: PARA, e não escreve nada', async () => {
  const { porta, registro } = portaDeMentira({ memoria: comEndereco(enderecoDaTag('ZZZ999')) })
  const r = await gravarPeloLeitorDeMesa({
    porta, peca: PECA, endereco: enderecoDaTag('AAA111'), marcar: marcarSempre,
  })
  assert.equal(r.estado, 'outra-peca')
  assert.equal(r.codigoAntigo, 'ZZZ999', 'a tela precisa do código para nomear a bolsa na pergunta')
  assert.equal(registro.gravacoes, 0, 'nada pode ter sido escrito antes da decisão da pessoa')
})

test('⚠️ LEITURA QUE FALHOU não vira etiqueta em branco: vira "não li", e não grava', async () => {
  // O buraco que sustenta a ferramenta inteira. Vazio é a resposta que autoriza
  // gravar por cima de uma bolsa que já tem dono.
  const { porta, registro } = portaDeMentira({
    aoLer: () => { throw new Error('A etiqueta saiu de cima do leitor.') },
  })
  const r = await gravarPeloLeitorDeMesa({
    porta, peca: PECA, endereco: enderecoDaTag('AAA111'), marcar: marcarSempre,
  })
  assert.equal(r.estado, 'nao-li')
  assert.equal(registro.gravacoes, 0)
  assert.match(r.frase, /saiu de cima/)
  assert.doesNotMatch(r.frase, /em branco/i, 'não li ≠ está em branco')
})

test('etiqueta com coisa que não é do selo é recusada', async () => {
  const { porta, registro } = portaDeMentira({ memoria: comEndereco('https://outracoisa.com/x') })
  const r = await gravarPeloLeitorDeMesa({
    porta, peca: PECA, endereco: enderecoDaTag('AAA111'), marcar: marcarSempre,
  })
  assert.equal(r.estado, 'nao-e-vessel')
  assert.equal(registro.gravacoes, 0)
})

test('etiqueta travada para gravação é recusada ANTES de tentar escrever', async () => {
  // o quarto byte do Capability Container manda no gravar: `0F` é fechado, e
  // não volta atrás. Vem da etiqueta, não de um objeto montado no teste.
  const { porta, registro } = portaDeMentira({ capability: [0xe1, 0x10, 0x12, 0x0f] })
  const r = await gravarPeloLeitorDeMesa({
    porta, peca: PECA, endereco: enderecoDaTag('AAA111'), marcar: marcarSempre,
  })
  assert.equal(r.estado, 'recusada')
  assert.match(r.frase, /travada/i)
  assert.equal(registro.gravacoes, 0)
})

test('sem leitor ou sem etiqueta em cima dele: recusa com a frase do programa', async () => {
  const { porta, registro } = portaDeMentira({
    aoConectar: () => { throw new Error('Nenhuma etiqueta encostada em 15 segundos.') },
  })
  const r = await gravarPeloLeitorDeMesa({
    porta, peca: PECA, endereco: enderecoDaTag('AAA111'), marcar: marcarSempre,
  })
  assert.equal(r.estado, 'recusada')
  assert.match(r.frase, /etiqueta encostada/i)
  assert.equal(registro.leituras, 0)
})

/* ── ESCREVER, E CONFERIR ─────────────────────────────────────────────────── */

test('etiqueta que sai no meio da gravação: manda SEPARAR a etiqueta, e não marca', async () => {
  const { porta } = portaDeMentira({
    aoGravar: () => { throw new Error('A etiqueta saiu de cima do leitor no meio.') },
  })
  let marcou = false
  const r = await gravarPeloLeitorDeMesa({
    porta, peca: PECA, endereco: enderecoDaTag('AAA111'), marcar: async () => { marcou = true; return true },
  })
  assert.equal(r.estado, 'falhou-ao-escrever')
  assert.match(r.frase, /separe esta etiqueta/i)
  assert.equal(marcou, false, 'peça marcada com etiqueta pela metade é bolsa sem identidade')
})

test('⚠️ etiqueta que responde bem e não guarda nada: "não conferiu", e não marca', async () => {
  // etiqueta com defeito responde `90 00` a tudo e não guarda coisa nenhuma.
  // Sem a leitura de volta, a peça sairia dada como pronta com uma etiqueta
  // muda costurada dentro da bolsa.
  // `guarda: false`: a etiqueta responde `90 00` a toda escrita e não guarda
  // nada. É o defeito de etiqueta que só a leitura de volta pega.
  const { porta } = portaDeMentira({ guarda: false })
  let marcou = false
  const r = await gravarPeloLeitorDeMesa({
    porta, peca: PECA, endereco: enderecoDaTag('AAA111'), marcar: async () => { marcou = true; return true },
  })
  assert.equal(r.estado, 'nao-conferiu')
  assert.equal(marcou, false)
})

test('⚠️ não consegui LER DE VOLTA também não marca', async () => {
  const { porta } = portaDeMentira({
    aoLer: (quantas) => { if (quantas === 2) throw new Error('A etiqueta saiu antes de eu conferir.') },
  })
  let marcou = false
  const r = await gravarPeloLeitorDeMesa({
    porta, peca: PECA, endereco: enderecoDaTag('AAA111'), marcar: async () => { marcou = true; return true },
  })
  assert.equal(r.estado, 'nao-conferiu')
  assert.equal(marcou, false)
})

test('gravou e conferiu, mas o sistema não registrou: estado PRÓPRIO', async () => {
  // chamar isto de "falhou" faria a fila oferecer a mesma peça de novo, e a peça
  // sairia em DUAS etiquetas
  const { porta } = portaDeMentira()
  const r = await gravarPeloLeitorDeMesa({
    porta, peca: PECA, endereco: enderecoDaTag('AAA111'), marcar: marcarNunca,
  })
  assert.equal(r.estado, 'gravada-sem-marcar')
  assert.match(r.frase, /NÃO grave esta peça em outra etiqueta/i)
})

/* ── A ETIQUETA É SOLTA EM TODOS OS CAMINHOS ──────────────────────────────── */

test('a etiqueta é solta mesmo quando tudo dá errado', async () => {
  for (const quebrar of [
    { aoLer: () => { throw new Error('x') } },
    { aoGravar: () => { throw new Error('x') } },
  ]) {
    const { porta, registro } = portaDeMentira(quebrar)
    await gravarPeloLeitorDeMesa({
      porta, peca: PECA, endereco: enderecoDaTag('AAA111'), marcar: marcarSempre,
    })
    assert.equal(registro.desconectou, 1, 'leitor preso à etiqueta trava a peça seguinte')
  }
})

/* ── A SOBRESCRITA: O BANCO JÁ MUDOU, FALTA O CHIP ────────────────────────── */

test('escreverEConferir grava em cima e confere de volta', async () => {
  const { porta } = portaDeMentira({ memoria: comEndereco(enderecoDaTag('ZZZ999')) })
  const r = await escreverEConferir({ porta, endereco: enderecoDaTag('AAA111') })
  assert.equal(r.ok, true)
  assert.equal(r.lido, enderecoDaTag('AAA111'))
})

test('escreverEConferir NÃO diz que deu certo quando a etiqueta não guardou', async () => {
  const { porta } = portaDeMentira({ memoria: comEndereco(enderecoDaTag('ZZZ999')), guarda: false })
  const r = await escreverEConferir({ porta, endereco: enderecoDaTag('AAA111') })
  assert.equal(r.ok, false)
  assert.ok(r.frase.length > 20)
})

test('escreverEConferir também lê ANTES: o plano sai do que está na etiqueta', async () => {
  const { porta, registro } = portaDeMentira({ memoria: comEndereco(enderecoDaTag('ZZZ999')) })
  await escreverEConferir({ porta, endereco: enderecoDaTag('AAA111') })
  assert.equal(registro.leituras, 2, 'uma para planejar, outra para conferir')
})

/* ── ⚠️ NÃO ESCREVI NADA ≠ PAREI NO MEIO ──────────────────────────────────── */

test('⚠️ endereço que não cabe é RECUSADO, e NÃO manda separar a etiqueta', async () => {
  // A diferença custa uma etiqueta boa por vez: 'falhou-ao-escrever' manda
  // SEPARAR a etiqueta, porque ela ficou pela metade. Quando o plano nem chegou
  // a ser montado, a etiqueta está intacta — mandar jogá-la fora é jogar fora
  // etiqueta boa, que é a cicatriz mais cara desta ferramenta.
  const { porta, registro } = portaDeMentira()
  const r = await gravarPeloLeitorDeMesa({
    porta,
    peca: PECA,
    endereco: `https://vesselbrasil.com.br/verify/${'A'.repeat(200)}`,
    marcar: marcarSempre,
  })
  assert.equal(registro.gravacoes, 0, 'nada pode ter sido escrito')
  assert.equal(r.estado, 'recusada')
  assert.doesNotMatch(r.frase, /separe esta etiqueta/i,
    'a etiqueta está intacta: mandar separá-la é jogar fora etiqueta boa')
})

test('⚠️ gravar sem a memória lida também é recusa, não meia gravação', async () => {
  const { porta } = portaDeMentira()
  const r = await escreverEConferir({ porta, endereco: enderecoDaTag('AAA111'), memoria: 'nao é memória' })
  assert.equal(r.ok, false)
  assert.equal(r.estado, 'recusada')
  assert.doesNotMatch(r.frase, /separe esta etiqueta/i)
})

test('parar NO MEIO continua mandando separar a etiqueta', () => {
  // o contrário do teste acima: o estado que manda jogar fora tem de continuar
  // existindo, senão a etiqueta pela metade sai costurada dentro de uma bolsa
  assert.ok(true) // provado no teste "etiqueta que sai no meio da gravação", acima
})
