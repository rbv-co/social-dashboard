/* O ATENDENTE: quem, do lado do programa, responde aos pedidos da tela.
 *
 * A tela vem da internet. Este arquivo é a FRONTEIRA: tudo que chega dela é
 * suspeito até ser conferido, e nada que sai daqui é comando cru.
 *
 * O leitor entra por INJEÇÃO, como em toda a pasta: assim o teste produz de
 * propósito a etiqueta que sai no meio, o leitor ausente e a resposta pela
 * metade, sem etiqueta na mão.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { CANAIS, criarAtendente } from './atendente-do-leitor.js'

function leitorDeMentira({ aoConectar = null, aoLer = null, aoEscrever = null, leitores = ['ACR122U'] } = {}) {
  const registro = { conexoes: 0, desconexoes: 0, fechou: 0, criacoes: 0, escritas: [] }
  const sessao = {
    nome: leitores[0],
    async lerPaginas(pagina, quantosBytes) {
      if (aoLer) return aoLer(pagina, quantosBytes)
      return new Array(quantosBytes).fill(0)
    },
    async escreverPagina(pagina, bytes) {
      if (aoEscrever) await aoEscrever(pagina, bytes)
      registro.escritas.push({ pagina, bytes: [...bytes] })
      return true
    },
    async desconectar() { registro.desconexoes += 1 },
  }
  const leitor = {
    async listarLeitores() { return leitores },
    async conectar(opcoes) {
      registro.conexoes += 1
      if (aoConectar) await aoConectar(opcoes)
      return sessao
    },
    async fechar() { registro.fechou += 1 },
  }
  return { leitor, registro, criarLeitor: async () => { registro.criacoes += 1; return leitor } }
}

/* ── A SUPERFÍCIE É ESTREITA ──────────────────────────────────────────────── */

test('NÃO EXISTE canal de APDU cru: quem monta o comando é o motor', () => {
  // Um canal "execute estes bytes" daria à página o poder de mandar qualquer
  // coisa para o chip — inclusive escrever na página 40, que estraga a etiqueta
  // de vez, ou na página de senha. O motor confere faixa e tamanho ANTES do cabo.
  for (const canal of Object.values(CANAIS)) {
    assert.doesNotMatch(canal, /apdu|cru|transmitir|comando|executar/i, `canal proibido: ${canal}`)
  }
  assert.deepEqual(
    Object.values(CANAIS).slice().sort(),
    [
      'gravador-de-mesa:conectar',
      'gravador-de-mesa:desconectar',
      'gravador-de-mesa:escrever-pagina',
      'gravador-de-mesa:ler-paginas',
      'gravador-de-mesa:listar-leitores',
      // Entrou em 07/09/2026. Ele NAO fala com o leitor: pede ao Windows para
      // religar o servico de Cartao Inteligente. Nao carrega bytes nem endereco
      // de pagina, entao nao abre o buraco que este teste guarda.
      'gravador-de-mesa:religar-servico',
    ],
    'a superfície tem de continuar com estes seis pedidos, e nenhum a mais',
  )
})

/* ── FALHA ATRAVESSA COMO FRASE, NUNCA COMO ERRO SOLTO ────────────────────── */

test('toda resposta é {ok, valor} ou {ok:false, frase} — nada de Error pelo cano', async () => {
  // Um `Error` que atravessa o IPC do Electron chega do outro lado sem as
  // propriedades próprias, e às vezes só como texto. A frase de bancada é a
  // única coisa que precisa sobreviver à travessia, então ela viaja como dado.
  const { criarLeitor } = leitorDeMentira()
  const a = criarAtendente({ criarLeitor })
  const boa = await a.atender(CANAIS.LISTAR)
  assert.deepEqual(boa, { ok: true, valor: ['ACR122U'] })

  const ruim = criarAtendente({
    criarLeitor: async () => { throw new Error('Nenhum leitor ligado nesta máquina.') },
  })
  const resposta = await ruim.atender(CANAIS.LISTAR)
  assert.equal(resposta.ok, false)
  assert.equal(resposta.frase, 'Nenhum leitor ligado nesta máquina.')
  assert.ok(!(resposta instanceof Error))
})

test('falha sem recado nenhum não vira resposta muda', async () => {
  const a = criarAtendente({ criarLeitor: async () => { throw new Error('') } })
  const r = await a.atender(CANAIS.LISTAR)
  assert.equal(r.ok, false)
  assert.ok(r.frase.length > 15, 'a bancada precisa de uma frase, não de um silêncio')
})

test('canal desconhecido é recusado, e não estoura o programa', async () => {
  const { criarLeitor } = leitorDeMentira()
  const a = criarAtendente({ criarLeitor })
  const r = await a.atender('gravador-de-mesa:qualquer-outra-coisa')
  assert.equal(r.ok, false)
})

/* ── CONECTAR ─────────────────────────────────────────────────────────────── */

test('conectar devolve o nome do leitor e guarda a sessão', async () => {
  const { criarLeitor, registro } = leitorDeMentira()
  const a = criarAtendente({ criarLeitor })
  const r = await a.atender(CANAIS.CONECTAR, null)
  assert.deepEqual(r, { ok: true, valor: 'ACR122U' })
  assert.equal(registro.conexoes, 1)
})

test('⚠️ o atendente NÃO tem laço de tentativa próprio: quem espera é o motor', async () => {
  // A primeira conexão de todo turno falha com 0x8010001D — o serviço de cartão
  // do Windows sobe sob demanda — e o motor já tenta de novo sozinho. Um
  // segundo laço aqui em cima transformaria "leitor tomado por outro programa"
  // (que falha na hora, de propósito) em travamento calado.
  const { criarLeitor, registro } = leitorDeMentira({
    aoConectar: () => { throw new Error('Nenhuma etiqueta encostada em 15 segundos.') },
  })
  const a = criarAtendente({ criarLeitor })
  const r = await a.atender(CANAIS.CONECTAR, null)
  assert.equal(r.ok, false)
  assert.equal(registro.conexoes, 1, 'chamou o motor mais de uma vez: tirou a espera do lugar dela')
})

test('o leitor é criado UMA vez e reaproveitado: o contexto do Windows vive nele', async () => {
  const { criarLeitor, registro } = leitorDeMentira()
  const a = criarAtendente({ criarLeitor })
  await a.atender(CANAIS.LISTAR)
  await a.atender(CANAIS.CONECTAR, null)
  await a.atender(CANAIS.LISTAR)
  assert.equal(registro.criacoes, 1)
})

test('conectar de novo solta a etiqueta anterior antes de pegar a próxima', async () => {
  // sem isto, a segunda peça do lote encontraria a sessão da primeira ainda
  // aberta, e o leitor responderia sobre uma etiqueta que já saiu da mesa
  const { criarLeitor, registro } = leitorDeMentira()
  const a = criarAtendente({ criarLeitor })
  await a.atender(CANAIS.CONECTAR, null)
  await a.atender(CANAIS.CONECTAR, null)
  assert.equal(registro.desconexoes, 1)
})

/* ── LER E ESCREVER SEM ETIQUETA ──────────────────────────────────────────── */

test('ler sem ter conectado é recusado com frase, não com "undefined"', async () => {
  const { criarLeitor } = leitorDeMentira()
  const a = criarAtendente({ criarLeitor })
  const r = await a.atender(CANAIS.LER, 4, 16)
  assert.equal(r.ok, false)
  assert.match(r.frase, /etiqueta/i)
})

test('escrever sem ter conectado é recusado', async () => {
  const { criarLeitor } = leitorDeMentira()
  const a = criarAtendente({ criarLeitor })
  const r = await a.atender(CANAIS.ESCREVER, 5, [1, 2, 3, 4])
  assert.equal(r.ok, false)
})

/* ── A TELA VEM DA INTERNET: TUDO QUE ELA MANDA É CONFERIDO ───────────────── */

test('página que não é número inteiro é recusada ANTES do cabo', async () => {
  const { criarLeitor, registro } = leitorDeMentira()
  const a = criarAtendente({ criarLeitor })
  await a.atender(CANAIS.CONECTAR, null)
  for (const pagina of ['4', 4.5, -1, NaN, null, undefined, 1e9]) {
    const r = await a.atender(CANAIS.ESCREVER, pagina, [1, 2, 3, 4])
    assert.equal(r.ok, false, `página ${pagina} passou`)
  }
  assert.equal(registro.escritas.length, 0)
})

test('escrita que não tem exatamente 4 bytes é recusada', async () => {
  const { criarLeitor, registro } = leitorDeMentira()
  const a = criarAtendente({ criarLeitor })
  await a.atender(CANAIS.CONECTAR, null)
  for (const bytes of [[1, 2, 3], [1, 2, 3, 4, 5], [], null, 'FFFF', [1, 2, 3, 300], [1, 2, 3, -1], [1, 2, 3, 1.5]]) {
    const r = await a.atender(CANAIS.ESCREVER, 5, bytes)
    assert.equal(r.ok, false, `bytes ${JSON.stringify(bytes)} passaram`)
  }
  assert.equal(registro.escritas.length, 0)
})

test('leitura com tamanho fora do que a etiqueta responde é recusada', async () => {
  const { criarLeitor } = leitorDeMentira()
  const a = criarAtendente({ criarLeitor })
  await a.atender(CANAIS.CONECTAR, null)
  for (const quantos of [0, -4, 17, 4.5, '16', null, 1e6]) {
    const r = await a.atender(CANAIS.LER, 4, quantos)
    assert.equal(r.ok, false, `tamanho ${quantos} passou`)
  }
})

test('leitura boa atravessa e volta em lista de números', async () => {
  // sai daqui para o IPC do Electron: um Buffer ou um Uint8Array atravessa
  // como objeto estranho do outro lado, e a tela recusaria a leitura inteira
  const { criarLeitor } = leitorDeMentira({ aoLer: () => Uint8Array.from([0xe1, 0x10, 0x12, 0x00]) })
  const a = criarAtendente({ criarLeitor })
  await a.atender(CANAIS.CONECTAR, null)
  const r = await a.atender(CANAIS.LER, 3, 4)
  assert.equal(r.ok, true)
  assert.ok(Array.isArray(r.valor), 'tem de ser lista comum de números')
  assert.deepEqual(r.valor, [0xe1, 0x10, 0x12, 0x00])
})

test('escrita boa chega no motor com os bytes que vieram', async () => {
  const { criarLeitor, registro } = leitorDeMentira()
  const a = criarAtendente({ criarLeitor })
  await a.atender(CANAIS.CONECTAR, null)
  const r = await a.atender(CANAIS.ESCREVER, 5, [0x34, 0x03, 0x1a, 0xd1])
  assert.deepEqual(r, { ok: true, valor: true })
  assert.deepEqual(registro.escritas, [{ pagina: 5, bytes: [0x34, 0x03, 0x1a, 0xd1] }])
})

test('etiqueta que sai no meio da escrita volta como frase de bancada', async () => {
  const { criarLeitor } = leitorDeMentira({
    aoEscrever: () => { throw new Error('A etiqueta saiu de cima do leitor.') },
  })
  const a = criarAtendente({ criarLeitor })
  await a.atender(CANAIS.CONECTAR, null)
  const r = await a.atender(CANAIS.ESCREVER, 5, [1, 2, 3, 4])
  assert.deepEqual(r, { ok: false, frase: 'A etiqueta saiu de cima do leitor.' })
})

/* ── SOLTAR ───────────────────────────────────────────────────────────────── */

test('desconectar sem sessão não é erro: soltar o que já saiu é limpeza', async () => {
  const { criarLeitor } = leitorDeMentira()
  const a = criarAtendente({ criarLeitor })
  assert.deepEqual(await a.atender(CANAIS.DESCONECTAR), { ok: true, valor: true })
})

test('fechar solta a etiqueta e fecha o processo do PowerShell', async () => {
  const { criarLeitor, registro } = leitorDeMentira()
  const a = criarAtendente({ criarLeitor })
  await a.atender(CANAIS.CONECTAR, null)
  await a.fechar()
  assert.equal(registro.desconexoes, 1)
  assert.equal(registro.fechou, 1)
})

/* ── O REGISTRO NO ELECTRON ───────────────────────────────────────────────── */

test('registrar pendura UM ouvinte por canal no ipcMain', async () => {
  const { criarLeitor } = leitorDeMentira()
  const a = criarAtendente({ criarLeitor })
  const pendurados = new Map()
  a.registrar({ handle: (canal, fn) => { pendurados.set(canal, fn) } })
  assert.deepEqual([...pendurados.keys()].sort(), Object.values(CANAIS).slice().sort())
  // e o ouvinte descarta o primeiro argumento (o `evento` do Electron)
  const resposta = await pendurados.get(CANAIS.LISTAR)({ remetente: 'electron' })
  assert.deepEqual(resposta, { ok: true, valor: ['ACR122U'] })
})

// ── RELIGAR O LEITOR (07/09/2026) ──────────────────────────────────────────
test('religar SEM a ferramenta injetada nao estoura — responde o que fazer', () => {
  const atendente = criarAtendente({ criarLeitor: () => leitorDeMentira() })
  return atendente.atender(CANAIS.RELIGAR).then((r) => {
    assert.equal(r.ok, false)
    assert.match(r.frase, /Servicos|Serviços/, 'tem de dizer o caminho manual');
  })
})

test('religar CHAMA a ferramenta e devolve a frase dela', async () => {
  let chamou = 0
  const atendente = criarAtendente({
    criarLeitor: leitorDeMentira().criarLeitor,
    consertarOLeitor: async () => { chamou++; return { ok: true, frase: 'Pronto, religado.' } },
  })
  const r = await atendente.atender(CANAIS.RELIGAR)
  assert.equal(chamou, 1)
  assert.deepEqual(r, { ok: true, valor: 'Pronto, religado.' })
})

test('⚠️ religar SOLTA a etiqueta antes — a conexao atual aponta para um servico morto', async () => {
  // `leitorDeMentira()` devolve { leitor, registro, criarLeitor } — o ajudante ja
  // conta as desconexoes, entao nao preciso inventar gancho novo.
  const falso = leitorDeMentira()
  const atendente = criarAtendente({
    criarLeitor: falso.criarLeitor,
    consertarOLeitor: async () => ({ ok: true, frase: 'ok' }),
  })
  await atendente.atender(CANAIS.CONECTAR, null)
  const antes = falso.registro.desconexoes
  await atendente.atender(CANAIS.RELIGAR)
  assert.equal(falso.registro.desconexoes, antes + 1,
    'sem soltar, o programa seguraria um handle morto do Windows')
})

test('recusa da ferramenta chega com a frase dela, e nao como sucesso', async () => {
  const atendente = criarAtendente({
    criarLeitor: leitorDeMentira().criarLeitor,
    consertarOLeitor: async () => ({ ok: false, frase: 'Você cancelou a autorização.' }),
  })
  const r = await atendente.atender(CANAIS.RELIGAR)
  assert.equal(r.ok, false)
  assert.match(r.frase, /cancelou/)
})

test('temEtiquetaEmUso responde se ha etiqueta conectada agora', async () => {
  // E o que impede a atualizacao de interromper alguem no meio de uma gravacao.
  const falso = leitorDeMentira()
  const atendente = criarAtendente({ criarLeitor: falso.criarLeitor })
  assert.equal(atendente.temEtiquetaEmUso(), false, 'sem conectar nao ha etiqueta')
  await atendente.atender(CANAIS.CONECTAR, null)
  assert.equal(atendente.temEtiquetaEmUso(), true)
  await atendente.atender(CANAIS.DESCONECTAR)
  assert.equal(atendente.temEtiquetaEmUso(), false, 'soltou a etiqueta e continua dizendo que usa')
})
