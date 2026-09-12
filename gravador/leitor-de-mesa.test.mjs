import { test } from 'node:test'
import assert from 'node:assert/strict'
import { criarLeitorDeMesa, traduzirFalha } from './leitor-de-mesa.js'
import { traduzirCodigoDoPcsc } from './ponte-do-powershell.js'

// ── A PONTE DE MENTIRA ─────────────────────────────────────────────────────
// O leitor de verdade só existe no Windows da bancada, com uma etiqueta
// encostada. Injetando uma ponte de mentira, o teste consegue produzir de
// propósito o que ninguém consegue produzir de propósito na mesa: a etiqueta
// que sai no meio, o leitor ocupado por outro programa, o serviço do Windows
// parado, e a resposta que voltou pela metade.
//
// A FORMA É A DA PONTE DE VERDADE (ponte-do-powershell.js): os mesmos cinco
// métodos, os mesmos erros com código do PC/SC pendurado. Uma de mentira com
// forma inventada deixaria a suíte verde em cima de uma resposta que a vida real
// nunca devolve.

function erroPcsc(codigo) {
  return Object.assign(
    new Error(`${traduzirCodigoDoPcsc(codigo)} [${codigo}]`),
    { codigo, motivo: 'erro-do-powershell' },
  )
}

function ponteDeMentira({
  leitores = ['ACS ACR122U PICC Interface 00 00'],
  responder = () => [0x90, 0x00],
  aoConectar = null,
  registro = [],
} = {}) {
  let conexoes = 0
  return {
    registro,
    async iniciar() { registro.push({ o_que: 'iniciar' }); return true },
    async listarLeitores() { registro.push({ o_que: 'listar' }); return leitores },
    async conectar(nome) {
      conexoes += 1
      registro.push({ o_que: 'conectar', nome })
      const problema = aoConectar?.(conexoes)
      if (problema) throw problema
      return true
    },
    async transmitir(bytes) {
      const apdu = Array.from(bytes)
      registro.push({ o_que: 'transmitir', apdu })
      const resposta = responder(apdu)
      if (resposta instanceof Error) throw resposta
      return resposta
    },
    async desconectar() { registro.push({ o_que: 'desconectar' }); return true },
    async fechar() { registro.push({ o_que: 'fechar' }); return true },
  }
}

const semEspera = async () => {}

// ── LISTAR E ESCOLHER O LEITOR ─────────────────────────────────────────────

test('lista os leitores que o Windows enxerga, pelo nome', async () => {
  const leitor = criarLeitorDeMesa({ ponte: ponteDeMentira() })
  assert.deepEqual(await leitor.listarLeitores(), ['ACS ACR122U PICC Interface 00 00'])
  await leitor.fechar()
})

test('sem leitor nenhum, a frase manda conferir a USB — não manda trocar etiqueta', async () => {
  const leitor = criarLeitorDeMesa({ ponte: ponteDeMentira({ leitores: [] }), dormir: semEspera })
  await assert.rejects(() => leitor.conectar(), (e) => {
    assert.match(e.message, /USB|leitor/i)
    assert.doesNotMatch(e.message, /troque a etiqueta/i)
    return true
  })
})

test('com dois leitores e nenhum escolhido, prefere o que se chama ACR122', async () => {
  const ponte = ponteDeMentira({ leitores: ['Outro Leitor 00 00', 'ACS ACR122U PICC Interface 00 00'] })
  const sessao = await criarLeitorDeMesa({ ponte, dormir: semEspera }).conectar()
  assert.equal(sessao.nome, 'ACS ACR122U PICC Interface 00 00')
})

test('com dois leitores desconhecidos, PARA e diz os nomes em vez de chutar um', async () => {
  const ponte = ponteDeMentira({ leitores: ['Leitor A', 'Leitor B'] })
  await assert.rejects(
    () => criarLeitorDeMesa({ ponte, dormir: semEspera }).conectar(),
    /Leitor A[\s\S]*Leitor B/,
  )
})

test('o nome pedido que não existe é recusado, com a lista do que existe', async () => {
  const leitor = criarLeitorDeMesa({ ponte: ponteDeMentira(), dormir: semEspera })
  await assert.rejects(() => leitor.conectar({ nome: 'Leitor Que Não Existe' }),
    /ACS ACR122U PICC Interface/)
})

// ── ESPERAR A ETIQUETA ─────────────────────────────────────────────────────

test('sem etiqueta encostada, tenta de novo até o tempo acabar', async () => {
  let esperas = 0
  const ponte = ponteDeMentira({ aoConectar: () => erroPcsc('0x8010000C') })
  const leitor = criarLeitorDeMesa({
    ponte,
    dormir: async () => { esperas += 1 },
    agora: (() => { let t = 0; return () => (t += 1000) })(),
  })
  await assert.rejects(() => leitor.conectar({ segundosDeEspera: 3 }), /etiqueta/i)
  assert.ok(esperas >= 1, 'nem esperou entre as tentativas')
})

test('a etiqueta que chega na terceira tentativa é aceita', async () => {
  const ponte = ponteDeMentira({
    aoConectar: (tentativa) => (tentativa < 3 ? erroPcsc('0x8010000C') : null),
  })
  const sessao = await criarLeitorDeMesa({ ponte, dormir: semEspera }).conectar({ segundosDeEspera: 30 })
  assert.equal(sessao.nome, 'ACS ACR122U PICC Interface 00 00')
})

test('a etiqueta que saiu e voltou também é esperada, não recusada de vez', async () => {
  const ponte = ponteDeMentira({
    aoConectar: (tentativa) => (tentativa < 2 ? erroPcsc('0x80100069') : null),
  })
  const sessao = await criarLeitorDeMesa({ ponte, dormir: semEspera }).conectar()
  assert.ok(sessao.nome)
})

// ⚠️ ESPERAR NÃO CONSERTA TUDO. Leitor ocupado por outro programa não se resolve
// sozinho em 15 segundos: insistir em silêncio deixa quem está na bancada
// olhando para uma tela parada, achando que a etiqueta é que está ruim, e
// trocando etiqueta boa uma atrás da outra.
//
// ESTE TESTE MUDOU EM 01/09/2026, e a mudança é a lição. Ele exigia que o
// serviço parado falhasse SEM UMA ÚNICA nova tentativa — escrito a partir da
// suposição de que serviço parado é sempre defeito. A bancada mediu o contrário:
// o serviço sobe SOB DEMANDA, e a primeira chamada de todo turno pega ele
// levantando. Agora o que se exige é o TETO: umas poucas tentativas curtas, não
// os 60 segundos da espera pela etiqueta.
test('serviço do Windows parado tenta pouquíssimo e para, sem gastar a espera da etiqueta', async () => {
  const pausas = []
  const ponte = ponteDeMentira({ aoConectar: () => erroPcsc('0x8010001D') })
  const leitor = criarLeitorDeMesa({ ponte, dormir: async (ms) => { pausas.push(ms) } })
  await assert.rejects(() => leitor.conectar({ segundosDeEspera: 60 }), /Cart[ãa]o Inteligente/i)
  assert.ok(pausas.length <= 3, `esperou ${pausas.length} vezes por algo que não se conserta esperando`)
  const total = pausas.reduce((a, b) => a + b, 0)
  assert.ok(total <= 2000, `gastou ${total}ms: a espera do arranque virou a espera da etiqueta`)
})

test('leitor ocupado por outro programa para na hora e manda fechar o outro programa', async () => {
  const ponte = ponteDeMentira({ aoConectar: () => erroPcsc('0x8010000B') })
  const leitor = criarLeitorDeMesa({ ponte, dormir: semEspera })
  await assert.rejects(() => leitor.conectar({ segundosDeEspera: 60 }), (e) => {
    assert.match(e.message, /outro programa/i)
    assert.doesNotMatch(e.message, /troque a etiqueta/i)
    return true
  })
})

// O PowerShell morto não se conserta esperando: sem ele não há a quem perguntar.
test('PowerShell morto para na hora, em vez de esperar 15 segundos por nada', async () => {
  let esperas = 0
  const morto = Object.assign(new Error('O PowerShell que fala com o leitor se fechou'),
    { motivo: 'processo-morreu' })
  const ponte = ponteDeMentira({ aoConectar: () => morto })
  const leitor = criarLeitorDeMesa({ ponte, dormir: async () => { esperas += 1 } })
  await assert.rejects(() => leitor.conectar({ segundosDeEspera: 60 }), /PowerShell/i)
  assert.equal(esperas, 0)
})

// ── LER ────────────────────────────────────────────────────────────────────

test('ler páginas manda FF B0 e devolve só os dados, sem o 90 00', async () => {
  const ponte = ponteDeMentira({ responder: () => [0xe1, 0x10, 0x12, 0x00, 0x90, 0x00] })
  const sessao = await criarLeitorDeMesa({ ponte, dormir: semEspera }).conectar()
  assert.deepEqual(await sessao.lerPaginas(3, 4), [0xe1, 0x10, 0x12, 0x00])
  const enviado = ponte.registro.find((r) => r.o_que === 'transmitir')
  assert.deepEqual(enviado.apdu, [0xff, 0xb0, 0x00, 0x03, 0x04])
})

// ⚠️ A CICATRIZ: resposta curta terminada em 90 00 parece sucesso. Se passasse,
// a memória chegaria pela metade ao tradutor, ele não acharia endereço nenhum,
// e a etiqueta de outra bolsa seria dada como EM BRANCO.
test('leitura que voltou pela metade é FALHA, nunca meia memória', async () => {
  const ponte = ponteDeMentira({ responder: () => [0x01, 0x03, 0x90, 0x00] })
  const sessao = await criarLeitorDeMesa({ ponte, dormir: semEspera }).conectar()
  await assert.rejects(() => sessao.lerPaginas(4, 16), /incompleta|2 de 16/i)
})

// A frase do `63 00` mudou em 01/09/2026: ela mandava conferir a etiqueta, e na
// bancada o defeito era um comando com um byte a mais. Agora ela diz o que o
// código significa na prática, e não manda trocar etiqueta boa.
test('leitura recusada pelo leitor vira frase de bancada, não código cru', async () => {
  const ponte = ponteDeMentira({ responder: () => [0x63, 0x00] })
  const sessao = await criarLeitorDeMesa({ ponte, dormir: semEspera }).conectar()
  await assert.rejects(() => sessao.lerPaginas(4, 16), (e) => {
    assert.match(e.message, /não entendeu o comando/i)
    assert.doesNotMatch(e.message, /^63 00$/)
    assert.doesNotMatch(e.message, /troque a etiqueta/i)
    return true
  })
})

test('a etiqueta que sai de cima do leitor no meio da leitura diz isso', async () => {
  const ponte = ponteDeMentira({ responder: () => erroPcsc('0x80100069') })
  const sessao = await criarLeitorDeMesa({ ponte, dormir: semEspera }).conectar()
  await assert.rejects(() => sessao.lerPaginas(4, 16), /saiu|segure parada/i)
})

// ⚠️ FALHA DA PONTE NUNCA VIRA LEITURA VAZIA. Este é o teste que guarda o buraco
// inteiro: qualquer coisa que dê errado do outro lado tem de ESTOURAR aqui, e
// nunca devolver uma lista de bytes vazia — que o tradutor leria como etiqueta
// em branco, e "em branco" autoriza gravar por cima de uma bolsa que já tem dono.
test('QUALQUER falha da ponte estoura na leitura, nunca devolve lista vazia', async () => {
  const falhas = [
    erroPcsc('0x80100069'),
    erroPcsc('0x8010000B'),
    Object.assign(new Error('O leitor não respondeu a tempo (APDU).'), { motivo: 'tempo' }),
    Object.assign(new Error('O PowerShell se fechou.'), { motivo: 'processo-morreu' }),
    Object.assign(new Error('A resposta veio estragada.'), { motivo: 'resposta-estragada' }),
  ]
  for (const falha of falhas) {
    const ponte = ponteDeMentira({ responder: () => falha })
    const sessao = await criarLeitorDeMesa({ ponte, dormir: semEspera }).conectar()
    let devolveu
    await sessao.lerPaginas(4, 16).then((v) => { devolveu = v }, () => {})
    assert.equal(devolveu, undefined, `"${falha.message}" devolveu leitura em vez de estourar`)
  }
})

// ── ESCREVER ───────────────────────────────────────────────────────────────

test('escrever uma página manda FF D6 com os 4 bytes', async () => {
  const ponte = ponteDeMentira()
  const sessao = await criarLeitorDeMesa({ ponte, dormir: semEspera }).conectar()
  await sessao.escreverPagina(4, [0x01, 0x03, 0xa0, 0x0c])
  const enviado = ponte.registro.find((r) => r.o_que === 'transmitir')
  assert.deepEqual(enviado.apdu, [0xff, 0xd6, 0x00, 0x04, 0x04, 0x01, 0x03, 0xa0, 0x0c])
})

test('escrever fora da faixa nem chega a sair pelo cabo', async () => {
  const ponte = ponteDeMentira()
  const sessao = await criarLeitorDeMesa({ ponte, dormir: semEspera }).conectar()
  await assert.rejects(() => sessao.escreverPagina(40, [0, 0, 0, 0]), /página/i)
  assert.equal(ponte.registro.filter((r) => r.o_que === 'transmitir').length, 0,
    'o comando proibido chegou a ser enviado ao leitor')
})

test('escrita que o leitor recusou é falha, não silêncio', async () => {
  const ponte = ponteDeMentira({ responder: () => [0x63, 0x00] })
  const sessao = await criarLeitorDeMesa({ ponte, dormir: semEspera }).conectar()
  await assert.rejects(() => sessao.escreverPagina(4, [1, 2, 3, 4]), /\S/)
})

test('escrita que respondeu com dados no lugar de só 90 00 é falha', async () => {
  const ponte = ponteDeMentira({ responder: () => [0xaa, 0x90, 0x00] })
  const sessao = await criarLeitorDeMesa({ ponte, dormir: semEspera }).conectar()
  await assert.rejects(() => sessao.escreverPagina(4, [1, 2, 3, 4]), /\S/)
})

// ── SÉRIE, VERSÃO E DESLIGAR ───────────────────────────────────────────────

test('o número de série da etiqueta vem dos 7 bytes antes do 90 00', async () => {
  const ponte = ponteDeMentira({
    responder: () => [0x04, 0xa2, 0x3b, 0x7a, 0x11, 0x22, 0x33, 0x90, 0x00],
  })
  const sessao = await criarLeitorDeMesa({ ponte, dormir: semEspera }).conectar()
  assert.equal(await sessao.numeroDeSerie(), '04 A2 3B 7A 11 22 33')
})

// A versão do firmware é a única resposta que NÃO termina em 90 00: o manual da
// ACS diz que ela volta como texto puro. Ler as duas formas é o que impede a
// versão de sumir só porque o firmware acrescentou (ou não) o status.
test('a versão do leitor vem como texto, com ou sem 90 00 no fim', async () => {
  const texto = [...Buffer.from('ACR122U220', 'ascii')]
  for (const resposta of [texto, [...texto, 0x90, 0x00]]) {
    const ponte = ponteDeMentira({ responder: () => resposta })
    const sessao = await criarLeitorDeMesa({ ponte, dormir: semEspera }).conectar()
    assert.equal(await sessao.versaoDoLeitor(), 'ACR122U220')
  }
})

test('desconectar solta a etiqueta e fechar solta o leitor', async () => {
  const ponte = ponteDeMentira()
  const leitor = criarLeitorDeMesa({ ponte, dormir: semEspera })
  const sessao = await leitor.conectar()
  await sessao.desconectar()
  await leitor.fechar()
  assert.ok(ponte.registro.some((r) => r.o_que === 'desconectar'))
  assert.ok(ponte.registro.some((r) => r.o_que === 'fechar'))
})

test('usar a sessão depois de desconectar é recusado, em vez de falhar torto', async () => {
  const sessao = await criarLeitorDeMesa({ ponte: ponteDeMentira(), dormir: semEspera }).conectar()
  await sessao.desconectar()
  await assert.rejects(() => sessao.lerPaginas(4, 16), /desconectad|de novo/i)
})

// ── AS FRASES ──────────────────────────────────────────────────────────────

test('cada falha do PC/SC vira frase de bancada, e nenhuma some', () => {
  for (const codigo of ['0x8010001D', '0x8010002E', '0x8010000B', '0x80100069',
    '0x8010000C', '0x8010000A']) {
    assert.ok(traduzirFalha(erroPcsc(codigo)).length > 30, `${codigo} ficou sem frase`)
  }
})

test('falha desconhecida não some: sai com o código dentro da frase', () => {
  assert.match(traduzirFalha(erroPcsc('0x80100099')), /0x80100099/i)
  assert.ok(traduzirFalha(null).length > 30)
  assert.ok(traduzirFalha({}).length > 30)
})

test('sem ponte, o recado fala do Windows — e não de instalar biblioteca', () => {
  for (const nada of [undefined, {}, { transmitir: 1 }, { listarLeitores: () => {} }]) {
    assert.throws(() => criarLeitorDeMesa({ ponte: nada }), /Windows|PowerShell/i)
  }
})

// ⚠️ NADA DE COMPILAR NA BANCADA. Decisão do dono em 01/09/2026. Se voltar uma
// dependência que precisa de ferramentas de programação, este teste cai aqui e
// não no computador da bancada, com uma caixa de etiquetas em cima da mesa.
test('este programa não depende de nada que precise ser compilado', async () => {
  const { readFileSync } = await import('node:fs')
  const pacote = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))
  const dependencias = Object.keys(pacote.dependencies || {})
  // `electron-updater` entrou em 04/09/2026, para o programa se atualizar
  // sozinho. CONFERIDO ANTES DE ENTRAR, e é esta conferência que a lista acima
  // representa — não é um número que se sobe para o teste passar:
  //   arquivos nativos (.node) na árvore dele ....... 0
  //   binding.gyp (receita de compilação) ........... 0
  //   script `install`/`postinstall` .................. nenhum
  // (O único `.node` de `node_modules` é do `iconv-corefoundation`, que vem do
  //  electron-builder, só roda no Mac na hora de EMPACOTAR, e não vai no
  //  instalador do Windows. Ele já estava aqui antes desta mudança.)
  assert.deepEqual(dependencias, ['@supabase/supabase-js', 'electron-updater'],
    'entrou dependência nova: confira se ela compila antes de deixar')
})

// ── O SERVIÇO DO WINDOWS SOBE SOB DEMANDA ──────────────────────────────────
//
// ⚠️ A CICATRIZ, MEDIDA NA BANCADA EM 01/09/2026, com a etiqueta parada no
// leitor:
//
//     1 CONECTAR ...
//     #1 ERRO SCardConnect 0x8010001D
//     1 CONECTAR ...        (o MESMO comando, de novo)
//     #1 OK
//
// `0x8010001D` é o Windows dizendo que o serviço de cartão ainda não estava de
// pé. Ele sobe SOB DEMANDA: a primeira chamada depois de abrir o processo pega o
// serviço levantando, e a segunda funciona.
//
// Sem tratar isso, A PRIMEIRA ETIQUETA DE TODO TURNO FALHA — e o operador
// aprende a "tentar duas vezes". Superstição nasce de defeito não consertado, e
// depois esconde falha de verdade: no dia em que o leitor estiver mesmo ruim,
// ele vai tentar duas vezes, dar errado, e não contar a ninguém.

test('a primeira conexão do turno, que pega o serviço subindo, se conserta sozinha', async () => {
  const ponte = ponteDeMentira({
    aoConectar: (tentativa) => (tentativa === 1 ? erroPcsc('0x8010001D') : null),
  })
  const sessao = await criarLeitorDeMesa({ ponte, dormir: semEspera }).conectar()
  assert.equal(sessao.nome, 'ACS ACR122U PICC Interface 00 00')
  assert.equal(ponte.registro.filter((r) => r.o_que === 'conectar').length, 2,
    'não tentou de novo, ou tentou demais')
})

test('entre as duas tentativas há uma pausa curta — o serviço precisa de um instante', async () => {
  const pausas = []
  const ponte = ponteDeMentira({
    aoConectar: (tentativa) => (tentativa === 1 ? erroPcsc('0x8010001D') : null),
  })
  await criarLeitorDeMesa({ ponte, dormir: async (ms) => pausas.push(ms) }).conectar()
  assert.equal(pausas.length, 1)
  assert.ok(pausas[0] > 0 && pausas[0] <= 1000, `pausa de ${pausas[0]}ms: curta demais ou longa demais`)
})

// ⚠️ O TETO É PEQUENO, E ISSO IMPORTA. Serviço que não sobe em três tentativas
// não vai subir sozinho: aí a frase tem de mandar a pessoa abrir os Serviços do
// Windows, em vez de o programa ficar tentando calado para sempre.
test('serviço que não sobe nunca acaba com a frase de abrir os Serviços do Windows', async () => {
  const ponte = ponteDeMentira({ aoConectar: () => erroPcsc('0x8010001D') })
  const leitor = criarLeitorDeMesa({ ponte, dormir: semEspera })
  await assert.rejects(() => leitor.conectar({ segundosDeEspera: 60 }), /Cart[ãa]o Inteligente/i)
  const tentativas = ponte.registro.filter((r) => r.o_que === 'conectar').length
  assert.ok(tentativas >= 2 && tentativas <= 4, `tentou ${tentativas} vezes: o teto está errado`)
})

// ⚠️ NÃO SE REPETE CEGAMENTE QUALQUER ERRO. "Não há etiqueta" é recusa legítima
// e já tem o laço de espera dela, que é longo de propósito (o operador está
// pegando a próxima bolsa). Misturar os dois faria uma recusa rápida virar
// travamento — e o leitor tomado por outro programa ficaria escondido atrás de
// tentativas caladas.
test('erro que NÃO é do serviço não ganha nova tentativa: falha na hora', async () => {
  for (const codigo of ['0x8010000B', '0x8010002E', '0x80100009']) {
    const ponte = ponteDeMentira({ aoConectar: () => erroPcsc(codigo) })
    const leitor = criarLeitorDeMesa({ ponte, dormir: semEspera })
    await assert.rejects(() => leitor.conectar({ segundosDeEspera: 60 }))
    assert.equal(ponte.registro.filter((r) => r.o_que === 'conectar').length, 1,
      `${codigo} foi repetido, e não devia`)
  }
})

test('"não há etiqueta" continua no laço de espera longo, não no de arranque', async () => {
  const pausas = []
  const ponte = ponteDeMentira({
    aoConectar: (tentativa) => (tentativa < 5 ? erroPcsc('0x8010000C') : null),
  })
  await criarLeitorDeMesa({ ponte, dormir: async (ms) => pausas.push(ms) }).conectar()
  // as pausas da espera pela etiqueta são as longas (meio segundo), não as do arranque
  assert.equal(pausas.length, 4)
  assert.ok(pausas.every((ms) => ms === 500), `pausas: ${pausas.join(', ')}`)
})

test('o arranque conserta uma vez e a etiqueta ainda pode demorar a chegar', async () => {
  const ponte = ponteDeMentira({
    aoConectar: (tentativa) => {
      if (tentativa === 1) return erroPcsc('0x8010001D')   // serviço subindo
      if (tentativa < 4) return erroPcsc('0x8010000C')     // ninguém encostou ainda
      return null
    },
  })
  const sessao = await criarLeitorDeMesa({ ponte, dormir: semEspera }).conectar()
  assert.ok(sessao.nome)
})

// ── NADA DE COMANDO TORTO NO CABO ──────────────────────────────────────────
// ⚠️ Um byte a mais no comando fez o leitor responder `63 00` na bancada, e duas
// rodadas foram gastas procurando defeito na etiqueta. Tudo que sai por este
// arquivo passa por `conferirApdu` antes.
test('todo comando que chega ao cabo tem o tamanho certo', async () => {
  const { conferirApdu } = await import('./comandos-do-acr122u.js')
  const ponte = ponteDeMentira({
    responder: () => [0x04, 0xa2, 0x3b, 0x7a, 0x11, 0x22, 0x33, 0x90, 0x00],
  })
  const sessao = await criarLeitorDeMesa({ ponte, dormir: semEspera }).conectar()
  await sessao.numeroDeSerie()
  await sessao.versaoDoLeitor()
  const ponte2 = ponteDeMentira()
  const sessao2 = await criarLeitorDeMesa({ ponte: ponte2, dormir: semEspera }).conectar()
  await sessao2.escreverPagina(4, [1, 2, 3, 4])
  const ponte3 = ponteDeMentira({ responder: () => new Array(16).fill(0).concat([0x90, 0x00]) })
  const sessao3 = await criarLeitorDeMesa({ ponte: ponte3, dormir: semEspera }).conectar()
  await sessao3.lerPaginas(4, 16)

  const todos = [ponte, ponte2, ponte3]
    .flatMap((p) => p.registro.filter((r) => r.o_que === 'transmitir').map((r) => r.apdu))
  assert.ok(todos.length >= 4, 'nenhum comando chegou ao cabo')
  for (const apdu of todos) {
    assert.doesNotThrow(() => conferirApdu(apdu),
      `comando torto chegou ao cabo: ${apdu.map((b) => b.toString(16)).join(' ')}`)
  }
})
