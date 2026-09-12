// O PRELOAD: a superfície estreita que a tela enxerga.
//
// É o ÚNICO ponto em que a página vinda da internet toca o programa. A janela
// roda com `contextIsolation: true`, `nodeIntegration: false` e `sandbox: true`
// — a tela vem de fora, e não se dá poder de sistema a ela. O que ela ganha é
// isto e nada mais:
//
//     window.gravadorDeMesa.disponivel()
//     window.gravadorDeMesa.listarLeitores()
//     window.gravadorDeMesa.conectar(nome)
//     window.gravadorDeMesa.lerPaginas(pagina, quantosBytes)
//     window.gravadorDeMesa.escreverPagina(pagina, bytes)
//     window.gravadorDeMesa.desconectar()
//
// ⚠️ NÃO EXISTE "EXECUTE ESTE APDU". Quem monta os bytes do comando é o motor,
// do lado do programa, que já confere faixa de página e tamanho antes do cabo.
//
// ⚠️ POR QUE ESTE ARQUIVO É CommonJS E NÃO IMPORTA NADA: um preload em
// `sandbox: true` não consegue `require` de arquivo da pasta — só de `electron`.
// Então os nomes dos canais estão escritos aqui à mão. Essa cópia é o risco, e
// há teste (`preload.test.mjs`) que a compara byte a byte com a do atendente: no
// dia em que um canal for renomeado só de um lado, a tela pararia de gravar sem
// nenhum erro visível, com o `invoke` pendurado para sempre.
const CANAIS_DO_PRELOAD = {
  LISTAR: 'gravador-de-mesa:listar-leitores',
  CONECTAR: 'gravador-de-mesa:conectar',
  LER: 'gravador-de-mesa:ler-paginas',
  ESCREVER: 'gravador-de-mesa:escrever-pagina',
  DESCONECTAR: 'gravador-de-mesa:desconectar',
  RELIGAR: 'gravador-de-mesa:religar-servico',
}

const NOME_NA_JANELA = 'gravadorDeMesa'

const SEM_RECADO = 'O programa do gravador não respondeu. '
  + 'Feche e abra o programa; se repetir, desligue e ligue o cabo USB do leitor.'

// ⚠️ FALHA ESTOURA, NUNCA VIRA RESPOSTA VAZIA. É a regra que sustenta a
// ferramenta inteira: vazio é o que a tela lê como "etiqueta em branco", e
// "etiqueta em branco" é a resposta que autoriza gravar por cima de uma bolsa
// que já tem dono — com a etiqueta costurada dentro do forro, onde não se
// reabre. Por isso: resposta torta, `invoke` que morre e recusa sem frase todos
// terminam em erro, e nenhum deles em `undefined`.
function montarSuperficie(ipcRenderer) {
  async function pedir(canal, ...argumentos) {
    let resposta
    try {
      resposta = await ipcRenderer.invoke(canal, ...argumentos)
    } catch (erro) {
      throw new Error(String(erro?.message ?? erro ?? '').trim() || SEM_RECADO)
    }
    if (!resposta || typeof resposta !== 'object' || typeof resposta.ok !== 'boolean') {
      throw new Error(
        'O programa do gravador respondeu uma coisa que eu não entendi. '
        + 'Feche e abra o programa e tente de novo.',
      )
    }
    if (!resposta.ok) throw new Error(String(resposta.frase || '').trim() || SEM_RECADO)
    return resposta.valor
  }

  return {
    // Existe para a tela achar o programa. Fica junto das outras porque é a
    // primeira coisa que a tela pergunta, e uma resposta é mais honesta do que
    // "o objeto existe".
    async disponivel() { return true },
    async listarLeitores() { return pedir(CANAIS_DO_PRELOAD.LISTAR) },
    // `null` e não `undefined`: `undefined` some na travessia do IPC e chegaria
    // do outro lado como "sem argumento nenhum".
    async conectar(nome) { return pedir(CANAIS_DO_PRELOAD.CONECTAR, nome ?? null) },
    async lerPaginas(pagina, quantosBytes) {
      return pedir(CANAIS_DO_PRELOAD.LER, pagina, quantosBytes)
    },
    async escreverPagina(pagina, bytes) {
      return pedir(CANAIS_DO_PRELOAD.ESCREVER, pagina, bytes)
    },
    async desconectar() { return pedir(CANAIS_DO_PRELOAD.DESCONECTAR) },
    // ⚠️ ESTE NÃO FALA COM O LEITOR, fala com o Windows: pede para religar o
    // serviço de Cartão Inteligente. Abre a janelinha de autorização, e a
    // pessoa precisa clicar em "Sim" — por isso pode demorar.
    async religarOServico() { return pedir(CANAIS_DO_PRELOAD.RELIGAR) },
  }
}

function instalar({ contextBridge, ipcRenderer }) {
  contextBridge.exposeInMainWorld(NOME_NA_JANELA, montarSuperficie(ipcRenderer))
}

module.exports = { NOME_NA_JANELA, CANAIS_DO_PRELOAD, montarSuperficie, instalar }

// A INSTALAÇÃO SÓ ACONTECE DENTRO DO ELECTRON. Fora dele — que é onde o teste
// roda — `require('electron')` não existe, e instalar no topo faria
// `node --test` morrer antes da primeira asserção. Nada aqui é opcional em
// produção: dentro da janela o `contextBridge` existe sempre.
let electron = null
try { electron = require('electron') } catch { /* não é o Electron: é o teste */ }
if (electron && typeof electron === 'object' && electron.contextBridge && electron.ipcRenderer) {
  instalar(electron)
}
