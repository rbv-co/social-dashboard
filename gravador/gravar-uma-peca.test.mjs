import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  BYTES_DE_USUARIO,
  decidirPelaLeitura,
  lerAEtiqueta,
  gravarUmaPeca,
} from './gravar-uma-peca.js'
import { enderecoDaTag } from '../src/ferramentas/autenticidade/lotes.js'
import {
  planoDeGravacao,
  enderecoNaEtiqueta,
} from '../src/ferramentas/autenticidade/gravador-de-mesa/ndef-para-ntag213.js'

// ── UMA NTAG213 DE MENTIRA ─────────────────────────────────────────────────
// De fábrica ela NÃO vem em branco: as páginas 4 e 5 saem com o Lock Control
// TLV `01 03 A0 0C` + `34 03 00 FE`. É por isso que esta etiqueta de mentira
// nasce com esses bytes: uma de mentira "toda zerada" esconderia justamente a
// armadilha que o tradutor existe para atravessar.
const DE_FABRICA = [0x01, 0x03, 0xa0, 0x0c, 0x34, 0x03, 0x00, 0xfe]

function memoriaDeFabrica() {
  return [...DE_FABRICA, ...new Array(BYTES_DE_USUARIO - DE_FABRICA.length).fill(0)]
}

function memoriaComEndereco(endereco) {
  const memoria = memoriaDeFabrica()
  for (const { pagina, bytes } of planoDeGravacao(endereco, memoria)) {
    for (let i = 0; i < 4; i++) memoria[(pagina - 4) * 4 + i] = bytes[i]
  }
  return memoria
}

function sessaoDeMentira({
  memoria = memoriaDeFabrica(),
  capability = [0xe1, 0x10, 0x12, 0x00],
  falharAoLer = null,      // (pagina) => 'frase' para estourar naquela leitura
  falharAoEscrever = null, // (pagina) => 'frase'
  escritaMuda = false,     // responde ok mas não grava nada (etiqueta ruim)
  registro = [],
} = {}) {
  return {
    nome: 'ACS ACR122U PICC Interface 00 00',
    memoria,
    registro,
    async lerPaginas(pagina, quantos) {
      registro.push({ o_que: 'ler', pagina, quantos })
      const problema = falharAoLer?.(pagina)
      if (problema) throw new Error(problema)
      if (pagina === 3) return capability.slice(0, quantos)
      const inicio = (pagina - 4) * 4
      return memoria.slice(inicio, inicio + quantos)
    },
    async escreverPagina(pagina, bytes) {
      registro.push({ o_que: 'escrever', pagina, bytes: [...bytes] })
      const problema = falharAoEscrever?.(pagina)
      if (problema) throw new Error(problema)
      if (!escritaMuda) {
        for (let i = 0; i < 4; i++) memoria[(pagina - 4) * 4 + i] = bytes[i]
      }
      return true
    },
    desconectar() { registro.push({ o_que: 'desconectar' }) },
  }
}

const PECA = { codigo: 'K7M4X9QP2R', numero_na_serie: 7 }
const marcouSempre = async () => ({ ok: true })

// ── A DECISÃO, EM CONTA PURA ───────────────────────────────────────────────
// ⚠️ ESTA É A PEÇA QUE FECHA O BURACO. `enderecoNaEtiqueta` devolve vazio em
// DOIS casos que não são a mesma coisa: a etiqueta está em branco, e a leitura
// não deu certo. Vazio quer dizer 'vazia' para `conferirLeitura`, e 'vazia'
// quer dizer PODE GRAVAR. Leitura torta virando autorização de gravação é uma
// bolsa perdendo a identidade dentro do forro, onde não se reabre.

test('leitura que não deu certo é "nao-li", NUNCA "vazia"', () => {
  assert.equal(decidirPelaLeitura({ leu: false, memoria: [] }, 'K7M4X9QP2R'), 'nao-li')
  assert.equal(decidirPelaLeitura({ leu: false, memoria: null }, 'K7M4X9QP2R'), 'nao-li')
})

test('memória incompleta é "nao-li" mesmo com leu: true — não existe meia decisão', () => {
  assert.equal(decidirPelaLeitura({ leu: true, memoria: [0x03, 0x00] }, 'K7M4X9QP2R'), 'nao-li')
  assert.equal(decidirPelaLeitura({ leu: true, memoria: [] }, 'K7M4X9QP2R'), 'nao-li')
})

test('etiqueta de fábrica, lida inteira, é "vazia": aí sim pode gravar', () => {
  assert.equal(decidirPelaLeitura({ leu: true, memoria: memoriaDeFabrica() }, 'K7M4X9QP2R'), 'vazia')
})

test('etiqueta com a própria peça é "confere"', () => {
  const memoria = memoriaComEndereco(enderecoDaTag('K7M4X9QP2R'))
  assert.equal(decidirPelaLeitura({ leu: true, memoria }, 'K7M4X9QP2R'), 'confere')
})

test('etiqueta com OUTRA peça do selo é "outra-peca"', () => {
  const memoria = memoriaComEndereco(enderecoDaTag('Z9Z9Z9Z9Z9'))
  assert.equal(decidirPelaLeitura({ leu: true, memoria }, 'K7M4X9QP2R'), 'outra-peca')
})

test('etiqueta com endereço de fora do selo é "nao-e-vessel"', () => {
  const memoria = memoriaComEndereco('https://exemplo.com.br/qualquer-coisa')
  assert.equal(decidirPelaLeitura({ leu: true, memoria }, 'K7M4X9QP2R'), 'nao-e-vessel')
})

// ── LER A ETIQUETA INTEIRA ─────────────────────────────────────────────────

test('ler a etiqueta lê a página 3 e os 144 bytes do usuário', async () => {
  const sessao = sessaoDeMentira()
  const leitura = await lerAEtiqueta(sessao)
  assert.equal(leitura.leu, true)
  assert.equal(leitura.memoria.length, BYTES_DE_USUARIO)
  assert.deepEqual(leitura.memoria.slice(0, 8), DE_FABRICA)
  assert.equal(leitura.capability.formatada, true)
  assert.equal(leitura.capability.podeGravar, true)
  assert.ok(sessao.registro.some((r) => r.o_que === 'ler' && r.pagina === 3))
})

test('leitura que estourou no meio devolve leu:false com a frase, e memória nenhuma', async () => {
  const sessao = sessaoDeMentira({
    falharAoLer: (p) => (p === 20 ? 'A etiqueta saiu de cima do leitor no meio.' : null),
  })
  const leitura = await lerAEtiqueta(sessao)
  assert.equal(leitura.leu, false)
  assert.match(leitura.falha, /saiu de cima/)
  assert.equal(decidirPelaLeitura(leitura, 'K7M4X9QP2R'), 'nao-li')
})

test('etiqueta travada só para leitura é reconhecida pela página 3', async () => {
  const sessao = sessaoDeMentira({ capability: [0xe1, 0x10, 0x12, 0x0f] })
  const leitura = await lerAEtiqueta(sessao)
  assert.equal(leitura.capability.podeGravar, false)
  assert.match(leitura.capability.aviso, /travada/i)
})

// ── A SEQUÊNCIA INTEIRA ────────────────────────────────────────────────────

test('etiqueta em branco: grava, confere lendo de volta e SÓ ENTÃO marca', async () => {
  const sessao = sessaoDeMentira()
  const ordem = []
  const espiao = new Proxy(sessao, {
    get: (alvo, chave) => (chave === 'escreverPagina'
      ? (...a) => { ordem.push('escrever'); return alvo.escreverPagina(...a) }
      : (chave === 'lerPaginas'
        ? (...a) => { ordem.push('ler'); return alvo.lerPaginas(...a) }
        : alvo[chave])),
  })
  const r = await gravarUmaPeca({
    sessao: espiao,
    peca: PECA,
    marcar: async () => { ordem.push('marcar'); return { ok: true } },
  })
  assert.equal(r.estado, 'gravada')
  assert.equal(r.marcada, true)
  assert.equal(enderecoNaEtiqueta(sessao.memoria), enderecoDaTag('K7M4X9QP2R'))

  // a ordem é o contrato: ler ANTES, escrever, ler DE VOLTA, e marcar por último
  const primeiraEscrita = ordem.indexOf('escrever')
  const ultimaEscrita = ordem.lastIndexOf('escrever')
  assert.equal(ordem.indexOf('ler'), 0, 'gravou sem ler antes')
  assert.ok(ordem.indexOf('ler', ultimaEscrita) > ultimaEscrita, 'não leu de volta depois de gravar')
  assert.equal(ordem.lastIndexOf('marcar'), ordem.length - 1, 'marcou antes de conferir')
  assert.ok(primeiraEscrita > 0)
})

// ⚠️ A REGRA QUE PROTEGE A BOLSA: gravar por cima de uma etiqueta que já tem
// outra peça faz DUAS bolsas com a mesma identidade e uma bolsa sem nenhuma.
test('etiqueta com OUTRA peça: PARA, não escreve um único byte, e diz qual peça está lá', async () => {
  const memoria = memoriaComEndereco(enderecoDaTag('Z9Z9Z9Z9Z9'))
  const sessao = sessaoDeMentira({ memoria })
  const r = await gravarUmaPeca({ sessao, peca: PECA, marcar: marcouSempre })
  assert.equal(r.estado, 'recusada')
  assert.equal(r.marcada, false)
  assert.match(r.frase, /Z9Z9Z9Z9Z9/)
  assert.equal(sessao.registro.filter((x) => x.o_que === 'escrever').length, 0)
})

test('etiqueta de fora do selo: PARA também, em vez de apagar o que é de outro', async () => {
  const sessao = sessaoDeMentira({ memoria: memoriaComEndereco('https://exemplo.com.br/x') })
  const r = await gravarUmaPeca({ sessao, peca: PECA, marcar: marcouSempre })
  assert.equal(r.estado, 'recusada')
  assert.equal(sessao.registro.filter((x) => x.o_que === 'escrever').length, 0)
})

// ⚠️ NÃO LI ≠ EM BRANCO. Este teste é o buraco fechado: a leitura falha e a
// etiqueta NÃO pode ser gravada por causa disso.
test('leitura que falhou NÃO autoriza gravar: para e manda encostar de novo', async () => {
  const sessao = sessaoDeMentira({ falharAoLer: (p) => (p === 8 ? 'a etiqueta saiu' : null) })
  const r = await gravarUmaPeca({ sessao, peca: PECA, marcar: marcouSempre })
  assert.equal(r.estado, 'nao-li')
  assert.equal(sessao.registro.filter((x) => x.o_que === 'escrever').length, 0,
    'gravou por cima de uma etiqueta que não conseguiu ler')
})

test('etiqueta que já tem ESTA peça não é regravada — só marcada', async () => {
  const memoria = memoriaComEndereco(enderecoDaTag('K7M4X9QP2R'))
  const sessao = sessaoDeMentira({ memoria })
  const r = await gravarUmaPeca({ sessao, peca: PECA, marcar: marcouSempre })
  assert.equal(r.estado, 'ja-era-dela')
  assert.equal(r.marcada, true)
  assert.equal(sessao.registro.filter((x) => x.o_que === 'escrever').length, 0)
})

test('etiqueta não formatada como NDEF é recusada antes de qualquer escrita', async () => {
  const sessao = sessaoDeMentira({ capability: [0x00, 0x00, 0x00, 0x00] })
  const r = await gravarUmaPeca({ sessao, peca: PECA, marcar: marcouSempre })
  assert.equal(r.estado, 'recusada')
  assert.match(r.frase, /NDEF|formatada/i)
  assert.equal(sessao.registro.filter((x) => x.o_que === 'escrever').length, 0)
})

test('etiqueta travada para gravação é recusada com a frase de trocar etiqueta', async () => {
  const sessao = sessaoDeMentira({ capability: [0xe1, 0x10, 0x12, 0x0f] })
  const r = await gravarUmaPeca({ sessao, peca: PECA, marcar: marcouSempre })
  assert.equal(r.estado, 'recusada')
  assert.match(r.frase, /travada|Use outra/i)
})

// ⚠️ A ESCRITA QUE PARA NO MEIO deixa a etiqueta com meia mensagem: nem em
// branco, nem gravada. Ela NÃO pode ser marcada, e a frase tem de dizer que a
// etiqueta ficou pela metade — para ninguém costurá-la dentro de uma bolsa.
test('etiqueta que sai no meio da escrita: não marca e avisa que ficou pela metade', async () => {
  const sessao = sessaoDeMentira({
    falharAoEscrever: (p) => (p === 6 ? 'A etiqueta saiu de cima do leitor no meio.' : null),
  })
  let marcou = false
  const r = await gravarUmaPeca({ sessao, peca: PECA, marcar: async () => { marcou = true } })
  assert.equal(r.estado, 'falhou-ao-escrever')
  assert.equal(marcou, false)
  assert.match(r.frase, /metade|incompleta|separe/i)
})

// ⚠️ ESCREVER SEM CONFERIR É FÉ. A etiqueta pode responder 90 00 a tudo e não
// guardar nada (etiqueta com defeito, ou cópia ruim). Sem a leitura de volta, a
// peça seria dada como gravada e a bolsa sairia com uma etiqueta muda.
test('etiqueta que responde ok mas não guarda nada NÃO é dada como gravada', async () => {
  const sessao = sessaoDeMentira({ escritaMuda: true })
  let marcou = false
  const r = await gravarUmaPeca({ sessao, peca: PECA, marcar: async () => { marcou = true } })
  assert.equal(r.estado, 'nao-conferiu')
  assert.equal(marcou, false)
  assert.match(r.frase, /confer|não guardou|troque/i)
})

test('leitura de volta que falhou também não vira "gravada"', async () => {
  let vezes = 0
  const sessao = sessaoDeMentira({
    falharAoLer: () => { vezes += 1; return vezes > 12 ? 'a etiqueta saiu' : null },
  })
  const r = await gravarUmaPeca({ sessao, peca: PECA, marcar: marcouSempre })
  assert.notEqual(r.estado, 'gravada')
  assert.equal(r.marcada, false)
})

// ⚠️ O PIOR CASO DA BANCADA: a etiqueta FOI gravada e conferida, e o sistema não
// registrou. A etiqueta está no mundo com a peça dentro, e a fila acha que a
// peça ainda está pendente — se ninguém contar isso, a mesma peça é gravada
// numa SEGUNDA etiqueta.
test('gravou e conferiu, mas o sistema não marcou: estado próprio, nunca "gravada" nem "falhou"', async () => {
  const sessao = sessaoDeMentira()
  const r = await gravarUmaPeca({
    sessao,
    peca: PECA,
    marcar: async () => { throw new Error('sem internet') },
  })
  assert.equal(r.estado, 'gravada-sem-marcar')
  assert.equal(r.marcada, false)
  assert.equal(enderecoNaEtiqueta(sessao.memoria), enderecoDaTag('K7M4X9QP2R'))
  assert.match(r.frase, /etiqueta j[áa] est[áa] gravada|n[ãa]o registr/i)
})

test('o sistema que recusa por permissão vira a frase do painel, não código cru', async () => {
  const sessao = sessaoDeMentira()
  const r = await gravarUmaPeca({
    sessao,
    peca: PECA,
    marcar: async () => ({ ok: false, motivo: 'sem_permissao' }),
  })
  assert.equal(r.estado, 'gravada-sem-marcar')
  assert.match(r.frase, /permiss[ãa]o/i)
})

test('peça sem código é recusada antes de encostar em etiqueta nenhuma', async () => {
  const sessao = sessaoDeMentira()
  const r = await gravarUmaPeca({ sessao, peca: { codigo: '' }, marcar: marcouSempre })
  assert.equal(r.estado, 'recusada')
  assert.equal(sessao.registro.length, 0)
})

// ⚠️ PEÇA BAIXADA SAI DA FILA (regra de `naFila`, em lotes.js). Gravar a
// etiqueta de uma peça dada como refugo põe uma etiqueta dentro de uma bolsa
// que não deveria existir.
test('peça baixada é recusada, mesmo com a etiqueta em branco em cima do leitor', async () => {
  const sessao = sessaoDeMentira()
  const r = await gravarUmaPeca({
    sessao,
    peca: { ...PECA, baixada: true, baixa_motivo: 'defeito' },
    marcar: marcouSempre,
  })
  assert.equal(r.estado, 'recusada')
  assert.match(r.frase, /baixad/i)
  assert.equal(sessao.registro.length, 0)
})

test('peça já marcada como gravada não é gravada de novo numa etiqueta em branco', async () => {
  const sessao = sessaoDeMentira()
  const r = await gravarUmaPeca({
    sessao,
    peca: { ...PECA, gravada_em: '2026-09-01T10:00:00Z' },
    marcar: marcouSempre,
  })
  assert.equal(r.estado, 'recusada')
  assert.match(r.frase, /DUAS bolsas|j[áa] est[áa] gravada/i)
  assert.equal(sessao.registro.filter((x) => x.o_que === 'escrever').length, 0)
})

test('a peça já marcada AINDA PODE ser conferida na própria etiqueta dela', async () => {
  const memoria = memoriaComEndereco(enderecoDaTag('K7M4X9QP2R'))
  const sessao = sessaoDeMentira({ memoria })
  const r = await gravarUmaPeca({
    sessao,
    peca: { ...PECA, gravada_em: '2026-09-01T10:00:00Z' },
    marcar: marcouSempre,
    conferirApenas: true,
  })
  assert.equal(r.estado, 'ja-era-dela')
})

test('o endereço gravado é o de enderecoDaTag, nunca um montado à mão aqui', async () => {
  const sessao = sessaoDeMentira()
  await gravarUmaPeca({ sessao, peca: PECA, marcar: marcouSempre })
  assert.equal(enderecoNaEtiqueta(sessao.memoria), 'https://vesselbrasil.com.br/verify/K7M4X9QP2R')
})

test('nenhuma escrita sai fora das páginas 4 a 39', async () => {
  const sessao = sessaoDeMentira()
  await gravarUmaPeca({ sessao, peca: PECA, marcar: marcouSempre })
  for (const escrita of sessao.registro.filter((r) => r.o_que === 'escrever')) {
    assert.ok(escrita.pagina >= 4 && escrita.pagina <= 39, `escreveu na página ${escrita.pagina}`)
  }
})

// O Lock Control de fábrica ocupa 5 bytes e atravessa a página 4 para dentro da
// 5. A primeira escrita TEM de carregar os bytes que já estavam lá.
test('a primeira escrita preserva o Lock Control que veio de fábrica', async () => {
  const sessao = sessaoDeMentira()
  await gravarUmaPeca({ sessao, peca: PECA, marcar: marcouSempre })
  assert.deepEqual(sessao.memoria.slice(0, 4), [0x01, 0x03, 0xa0, 0x0c])
})

// ⚠️ O RESULTADO TEM DE DIZER DE QUAL PEÇA ELE É. Quem recebe este resultado é
// a fila (fila.js), e ela precisa saber qual peça andou. Sem o código, a fila
// recebe um resultado órfão e para — ou pior, anda com a peça errada.
test('o resultado sempre diz o código da peça, em qualquer estado', async () => {
  const casos = [
    [sessaoDeMentira(), PECA],
    [sessaoDeMentira({ memoria: memoriaComEndereco(enderecoDaTag('Z9Z9Z9Z9Z9')) }), PECA],
    [sessaoDeMentira({ falharAoLer: () => 'saiu' }), PECA],
    [sessaoDeMentira({ escritaMuda: true }), PECA],
    [sessaoDeMentira(), { ...PECA, baixada: true }],
  ]
  for (const [sessao, peca] of casos) {
    const r = await gravarUmaPeca({ sessao, peca, marcar: marcouSempre })
    assert.equal(r.codigo, 'K7M4X9QP2R', `o estado "${r.estado}" saiu sem o código da peça`)
  }
})

// A frase que o próprio marcador escreveu é mais específica do que a genérica de
// `fraseDaRecusa` — e é a única que existe para os motivos que só este programa
// conhece ('nao_confirmou', quando o banco diz ok e a peça não ficou marcada).
test('a frase própria do marcador não é trocada por uma genérica', async () => {
  const sessao = sessaoDeMentira()
  const r = await gravarUmaPeca({
    sessao,
    peca: PECA,
    marcar: async () => ({ ok: false, motivo: 'nao_confirmou', frase: 'a peça não ficou registrada como gravada.' }),
  })
  assert.equal(r.estado, 'gravada-sem-marcar')
  assert.match(r.frase, /não ficou registrada como gravada/)
})
