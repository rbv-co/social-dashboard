// O ATENDENTE: quem, do lado do programa, responde aos pedidos da tela.
//
// A tela vem da internet (`https://central.rbvcompany.com/autenticidade`) e roda
// com `contextIsolation`, sem nada de Node. Este arquivo é a FRONTEIRA entre ela
// e o leitor de mesa: tudo que chega dela é conferido, e nada que sai daqui é
// comando cru.
//
// ⚠️ NÃO EXISTE "EXECUTE ESTE APDU". A superfície é estreita de propósito —
// listar, conectar, ler páginas, escrever uma página, desconectar. Quem monta os
// bytes é o motor (`comandos-do-acr122u.js`), que já recusa página fora da faixa
// 4–39 e escrita que não tenha exatamente 4 bytes ANTES de mandar pelo cabo.
// Um canal de bytes livres daria à página o poder de escrever na página 40 (as
// travas) ou na 43 (a senha) — que é estragar a etiqueta de vez.
//
// O LEITOR ENTRA POR INJEÇÃO, como em toda a pasta: é o que permite ao teste
// produzir a etiqueta que sai no meio e o leitor ausente sem etiqueta na mão.
import { PRIMEIRA_PAGINA, ULTIMA_PAGINA } from '../comandos-do-acr122u.js'

export const CANAIS = {
  LISTAR: 'gravador-de-mesa:listar-leitores',
  CONECTAR: 'gravador-de-mesa:conectar',
  LER: 'gravador-de-mesa:ler-paginas',
  ESCREVER: 'gravador-de-mesa:escrever-pagina',
  DESCONECTAR: 'gravador-de-mesa:desconectar',
  // O conserto do leitor. Fica junto dos outros porque a tela o chama pelo
  // mesmo caminho — mas ele NÃO fala com o leitor: fala com o Windows.
  RELIGAR: 'gravador-de-mesa:religar-servico',
}

const BYTES_POR_PAGINA = 4
// A NTAG213 devolve no máximo 4 páginas (16 bytes) por leitura. Aceitar mais
// seria aceitar um pedido que o chip não atende — e o motor recusaria depois,
// só que com a etiqueta já em cima do leitor.
const MAIOR_LEITURA = 16

const inteiroEntre = (v, minimo, maximo) => Number.isInteger(v) && v >= minimo && v <= maximo

const SEM_RECADO = 'O leitor de mesa falhou sem dizer por quê. '
  + 'Desligue e ligue o cabo USB do leitor e tente de novo.'

// A FRASE ATRAVESSA COMO DADO, NUNCA COMO `Error`. Um `Error` que passa pelo IPC
// do Electron chega do outro lado sem as propriedades próprias — e a frase de
// bancada é a única coisa que precisa sobreviver à travessia.
const recusar = (erro) => ({ ok: false, frase: String(erro?.message ?? erro ?? '').trim() || SEM_RECADO })
const entregar = (valor) => ({ ok: true, valor })

// `consertarOLeitor` vem de fora, como `criarLeitor`: ele executa um comando do
// Windows, e injetar em vez de importar e o que permite testar isto sem chamar
// o sistema de verdade. Ausente, o atendente responde que nao sabe consertar —
// e nao estoura.
export function criarAtendente({ criarLeitor, consertarOLeitor = null }) {
  let leitor = null
  let sessao = null

  // UM leitor por programa, e não um por pedido: o contexto do PC/SC e o
  // processo do PowerShell vivem DENTRO dele. Abrir outro a cada pedido perderia
  // a conexão com a etiqueta entre uma página e a seguinte.
  async function oLeitor() {
    if (!leitor) leitor = await criarLeitor()
    return leitor
  }

  function aEtiqueta() {
    if (!sessao) {
      throw new Error(
        'Nenhuma etiqueta está em cima do leitor agora. '
        + 'Ponha a etiqueta no meio do leitor e comece de novo.',
      )
    }
    return sessao
  }

  async function soltarAEtiqueta() {
    const anterior = sessao
    sessao = null
    if (!anterior) return
    try { await anterior.desconectar() } catch { /* já saiu: não há o que consertar */ }
  }

  const ATENDIMENTOS = {
    async [CANAIS.LISTAR]() {
      return entregar(await (await oLeitor()).listarLeitores())
    },

    // ⚠️ AQUI NÃO HÁ LAÇO DE TENTATIVA. Esperar a etiqueta e tentar de novo
    // quando o serviço de cartão do Windows está subindo (`0x8010001D`, a
    // primeira conexão de todo turno) é trabalho de `conectar`, no motor, que
    // separa quem se resolve esperando de quem não se resolve. Um segundo laço
    // aqui transformaria "leitor tomado por outro programa" — que falha na hora,
    // de propósito — em travamento calado.
    async [CANAIS.CONECTAR](nome = null) {
      if (nome !== null && nome !== undefined && typeof nome !== 'string') {
        throw new Error('O nome do leitor tem de ser texto.')
      }
      await soltarAEtiqueta()
      sessao = await (await oLeitor()).conectar({ nome: nome || null })
      return entregar(sessao?.nome ?? null)
    },

    async [CANAIS.LER](pagina, quantosBytes) {
      if (!inteiroEntre(pagina, 0, ULTIMA_PAGINA)) {
        throw new Error(`Página ${pagina} não existe nesta etiqueta.`)
      }
      if (!inteiroEntre(quantosBytes, 1, MAIOR_LEITURA)) {
        throw new Error(
          `Leitura de ${quantosBytes} bytes não existe: esta etiqueta responde no máximo `
          + `${MAIOR_LEITURA} bytes por vez.`,
        )
      }
      // LISTA COMUM DE NÚMEROS, sempre. Um Buffer ou um Uint8Array atravessa o
      // IPC como objeto estranho, e a tela recusaria a leitura inteira — o que
      // ela lê como "não consegui ler", que é o certo, mas por um motivo falso.
      return entregar(Array.from(await aEtiqueta().lerPaginas(pagina, quantosBytes)))
    },

    async [CANAIS.ESCREVER](pagina, bytes) {
      if (!inteiroEntre(pagina, PRIMEIRA_PAGINA, ULTIMA_PAGINA)) {
        throw new Error(
          `Página ${pagina} fora da faixa: só se grava da ${PRIMEIRA_PAGINA} à ${ULTIMA_PAGINA}. `
          + 'Fora dela ficam as travas, a configuração e a senha da etiqueta.',
        )
      }
      const lista = Array.isArray(bytes) ? bytes : null
      if (!lista || lista.length !== BYTES_POR_PAGINA
        || !lista.every((b) => inteiroEntre(b, 0, 255))) {
        throw new Error(
          'Uma escrita nesta etiqueta são exatamente 4 bytes, e não existe meia página.',
        )
      }
      return entregar(await aEtiqueta().escreverPagina(pagina, lista))
    },

    async [CANAIS.DESCONECTAR]() {
      await soltarAEtiqueta()
      return entregar(true)
    },

    // ⚠️ ESTE NAO FALA COM O LEITOR, fala com o Windows. Ele existe porque o
    // servico de Cartao Inteligente parar e o defeito mais comum da bancada, e
    // o conserto (abrir "Servicos", achar o nome certo, clicar em Iniciar) e
    // longe demais de quem esta com uma bolsa na mao.
    async [CANAIS.RELIGAR]() {
      if (typeof consertarOLeitor !== 'function') {
        return { ok: false, frase: 'Este programa nao sabe religar o leitor sozinho. '
          + 'Abra "Servicos" no Windows, procure "Cartao Inteligente" e clique em Iniciar.' }
      }
      // SOLTA A ETIQUETA ANTES. A conexao atual aponta para um servico que caiu;
      // religar por baixo dela deixaria o programa segurando um handle morto.
      await soltarAEtiqueta()
      const r = await consertarOLeitor()
      return r?.ok ? entregar(r.frase) : { ok: false, frase: r?.frase || SEM_RECADO }
    },
  }

  async function atender(canal, ...argumentos) {
    const atendimento = ATENDIMENTOS[canal]
    if (!atendimento) {
      return { ok: false, frase: `Pedido desconhecido: ${canal}.` }
    }
    try {
      return await atendimento(...argumentos)
    } catch (erro) {
      return recusar(erro)
    }
  }

  return {
    atender,

    // ⚠️ EXISTE PARA A ATUALIZACAO SABER SE PODE INTERROMPER. Com etiqueta
    // conectada, o convite para reiniciar nem aparece: fechar o programa no meio
    // de uma gravacao e o que ele evita desde o comeco.
    temEtiquetaEmUso: () => sessao != null,

    // O ouvinte descarta o primeiro argumento — o `evento` do Electron. Deixá-lo
    // passar faria a página virar o `pagina` do `lerPaginas`.
    registrar(ipcMain) {
      for (const canal of Object.values(CANAIS)) {
        ipcMain.handle(canal, (_evento, ...argumentos) => atender(canal, ...argumentos))
      }
    },

    async fechar() {
      await soltarAEtiqueta()
      try { await leitor?.fechar?.() } catch { /* mesma razão do desconectar */ }
      leitor = null
    },
  }
}
