/* O PRELOAD: a superfície estreita que a tela enxerga.
 *
 * É o único ponto em que a página vinda da internet toca o programa. Ele roda
 * com `contextIsolation: true` e `sandbox: true`, então NÃO pode importar
 * arquivo nenhum da pasta — por isso ele é CommonJS e se basta sozinho, e por
 * isso os nomes dos canais estão escritos nele. A cópia que envelhece é o risco,
 * e o primeiro teste daqui é justamente o que a impede de envelhecer.
 *
 * O Electron entra por injeção: `node --test` não abre janela nenhuma.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import preload from './preload.cjs'
import { CANAIS } from './atendente-do-leitor.js'

const { NOME_NA_JANELA, CANAIS_DO_PRELOAD, montarSuperficie, instalar } = preload

function ipcDeMentira(respostas = {}) {
  const chamadas = []
  return {
    chamadas,
    async invoke(canal, ...argumentos) {
      chamadas.push([canal, ...argumentos])
      const resposta = respostas[canal]
      if (typeof resposta === 'function') return resposta(...argumentos)
      if (resposta !== undefined) return resposta
      return { ok: true, valor: null }
    },
  }
}

/* ── A CÓPIA QUE NÃO PODE ENVELHECER ──────────────────────────────────────── */

test('os canais do preload são exatamente os do atendente', () => {
  // O preload é `sandbox: true` e não importa nada: os nomes estão escritos nele
  // à mão. No dia em que um canal for renomeado só de um lado, a tela para de
  // gravar sem nenhum erro visível — o `invoke` fica pendurado.
  assert.deepEqual(CANAIS_DO_PRELOAD, CANAIS)
})

/* ── O QUE A PÁGINA ENXERGA, E SÓ ISSO ────────────────────────────────────── */

test('a janela ganha `gravadorDeMesa`, com sete funções e nada mais', () => {
  assert.equal(NOME_NA_JANELA, 'gravadorDeMesa')
  const superficie = montarSuperficie(ipcDeMentira())
  // `religarOServico` entrou em 07/09/2026. Ela é a única que NÃO fala com o
  // leitor: fala com o Windows, para religar o serviço de Cartão Inteligente.
  assert.deepEqual(Object.keys(superficie).sort(), [
    'conectar', 'desconectar', 'disponivel', 'escreverPagina', 'lerPaginas', 'listarLeitores',
    'religarOServico',
  ])
  for (const nome of Object.keys(superficie)) {
    assert.equal(typeof superficie[nome], 'function', `${nome} tem de ser função`)
  }
})

test('NADA de APDU cru, de ipcRenderer, de require nem de process na superfície', () => {
  // A página vem da internet. Vazar `ipcRenderer` daria a ela todos os canais do
  // programa; vazar `require` daria o sistema de arquivos do computador.
  const superficie = montarSuperficie(ipcDeMentira())
  for (const nome of Object.keys(superficie)) {
    assert.doesNotMatch(nome, /apdu|ipc|require|process|transmitir|comando|cru/i,
      `a superfície expôs "${nome}"`)
  }
  const fonte = String(montarSuperficie)
  assert.doesNotMatch(fonte, /exposeInMainWorld/, 'montar não expõe: quem expõe é `instalar`')
})

/* ── A TRAVESSIA ──────────────────────────────────────────────────────────── */

test('cada função chama o seu canal, com os argumentos na ordem', async () => {
  const ipc = ipcDeMentira({
    [CANAIS.LISTAR]: { ok: true, valor: ['ACR122U'] },
    [CANAIS.CONECTAR]: { ok: true, valor: 'ACR122U' },
    [CANAIS.LER]: { ok: true, valor: [0xe1, 0x10, 0x12, 0x00] },
    [CANAIS.ESCREVER]: { ok: true, valor: true },
    [CANAIS.DESCONECTAR]: { ok: true, valor: true },
  })
  const s = montarSuperficie(ipc)
  assert.deepEqual(await s.listarLeitores(), ['ACR122U'])
  assert.equal(await s.conectar('ACR122U'), 'ACR122U')
  assert.deepEqual(await s.lerPaginas(3, 4), [0xe1, 0x10, 0x12, 0x00])
  assert.equal(await s.escreverPagina(5, [1, 2, 3, 4]), true)
  assert.equal(await s.desconectar(), true)
  assert.deepEqual(ipc.chamadas, [
    [CANAIS.LISTAR],
    [CANAIS.CONECTAR, 'ACR122U'],
    [CANAIS.LER, 3, 4],
    [CANAIS.ESCREVER, 5, [1, 2, 3, 4]],
    [CANAIS.DESCONECTAR],
  ])
})

test('conectar sem nome manda nulo, e não `undefined`', async () => {
  // `undefined` some na travessia do IPC e chegaria do outro lado como "sem
  // argumento nenhum" — o atendente veria uma chamada torta em vez de "escolha
  // você o leitor"
  const ipc = ipcDeMentira()
  await montarSuperficie(ipc).conectar()
  assert.deepEqual(ipc.chamadas, [[CANAIS.CONECTAR, null]])
})

/* ── ⚠️ FALHA NUNCA VIRA RESPOSTA VAZIA ───────────────────────────────────── */

test('recusa do programa vira erro com a frase de bancada', async () => {
  const ipc = ipcDeMentira({
    [CANAIS.LER]: { ok: false, frase: 'A etiqueta saiu de cima do leitor.' },
  })
  await assert.rejects(() => montarSuperficie(ipc).lerPaginas(4, 16), /saiu de cima/)
})

test('⚠️ IPC que estoura NÃO devolve vazio: estoura com frase', async () => {
  // Vazio é a resposta que autoriza gravar por cima de uma bolsa que já tem
  // dono. Um `invoke` que morre — programa fechando, atendente sem ouvinte —
  // não pode chegar à tela como "etiqueta em branco".
  const ipc = { async invoke() { throw new Error('No handler registered') } }
  const s = montarSuperficie(ipc)
  await assert.rejects(() => s.lerPaginas(4, 16), (e) => e instanceof Error && e.message.length > 10)
})

test('⚠️ resposta torta do outro lado também estoura', async () => {
  for (const torta of [undefined, null, 'ok', 42, {}, { valor: [1, 2, 3, 4] }]) {
    const s = montarSuperficie({ async invoke() { return torta } })
    await assert.rejects(() => s.lerPaginas(4, 16),
      `resposta ${JSON.stringify(torta)} passou como se fosse leitura boa`)
  }
})

test('recusa sem frase nenhuma ainda diz alguma coisa', async () => {
  const s = montarSuperficie({ async invoke() { return { ok: false, frase: '' } } })
  await assert.rejects(() => s.lerPaginas(4, 16), (e) => e.message.length > 15)
})

test('disponivel diz que sim: ela existe justamente para a tela achar o programa', async () => {
  assert.equal(await montarSuperficie(ipcDeMentira()).disponivel(), true)
})

/* ── A INSTALAÇÃO ─────────────────────────────────────────────────────────── */

test('instalar pendura a superfície no nome combinado, e só nele', () => {
  const pendurados = []
  instalar({
    contextBridge: { exposeInMainWorld: (nome, valor) => pendurados.push([nome, valor]) },
    ipcRenderer: ipcDeMentira(),
  })
  assert.equal(pendurados.length, 1)
  assert.equal(pendurados[0][0], NOME_NA_JANELA)
  assert.equal(typeof pendurados[0][1].conectar, 'function')
})

test('carregar o arquivo FORA do Electron não pendura nada e não estoura', () => {
  // é o que acabou de acontecer neste teste: se o arquivo instalasse no topo,
  // `node --test` morreria em "Cannot find module 'electron'"
  assert.equal(typeof montarSuperficie, 'function')
})
