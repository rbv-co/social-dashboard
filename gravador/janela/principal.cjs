// O PROGRAMA. É ele que abre a janela e empresta o leitor para a tela.
//
// TUDO O QUE ELE FAZ ESTÁ EM OUTROS ARQUIVOS, de propósito: aqui só se liga o
// Electron de verdade nas peças que já se provam com `node --test`. Este é o
// único arquivo da pasta que NÃO tem teste, e por isso ele não pode ter regra
// nenhuma dentro.
//
// ⚠️ POR QUE ELE É CommonJS E OS OUTROS SÃO ESM: o motor (`../leitor-de-mesa.js`
// e companhia) é ESM, e o `import()` dinâmico atravessa de CommonJS para ESM em
// qualquer Electron moderno. O caminho contrário — entrada em ESM — depende da
// versão e traz junto o sumiço do `__dirname`, que aqui é o que aponta o
// preload. Esta é a forma que menos surpreende na bancada.
const path = require('node:path')
const { app, BrowserWindow, shell, ipcMain, dialog } = require('electron')
// O atualizador e CommonJS; as REGRAS de quando usa-lo estao em
// `atualizacao.js`, que tem teste. Aqui so se entrega o objeto de verdade.
const { autoUpdater } = require('electron-updater')

let atendente = null

// UM PROGRAMA SÓ POR MÁQUINA. O ACR122U é segurado por um processo de cada vez:
// com duas janelas abertas, a segunda encontraria o leitor "tomado por outro
// programa" — e a frase, que está certa, mandaria a pessoa procurar defeito que
// não existe. Abrir de novo traz para a frente a janela que já está aberta.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const [janela] = BrowserWindow.getAllWindows()
    if (!janela) return
    if (janela.isMinimized()) janela.restore()
    janela.focus()
  })

  app.whenReady().then(async () => {
    const [{ abrirAJanela }, { criarAtendente }, { criarLeitorDeVerdade }, { criarAtualizacao }] =
      await Promise.all([
        import('./abrir-a-janela.js'),
        import('./atendente-do-leitor.js'),
        import('../leitor-de-mesa.js'),
        import('./atualizacao.js'),
      ])

    // O LEITOR SÓ NASCE NO PRIMEIRO PEDIDO. Criar aqui abriria o processo do
    // PowerShell antes de alguém querer gravar — e, num computador sem leitor
    // ligado, o programa morreria na abertura em vez de abrir a tela e explicar.
    const { argumentosDoConserto, fraseDoConserto } = await import('./religar-o-servico.js')
    atendente = criarAtendente({
      criarLeitor: () => criarLeitorDeVerdade(),
      // RELIGAR O SERVICO DO WINDOWS. Comando fixo, sem nenhum pedaco vindo da
      // tela — e com `-Verb RunAs` la dentro, que e o que abre a janelinha de
      // autorizacao. Sem o clique da pessoa, nada acontece.
      consertarOLeitor: () => new Promise((resolver) => {
        try {
          const { execFile } = require('node:child_process')
          execFile('powershell.exe', argumentosDoConserto(), { windowsHide: true },
            (erro) => resolver(fraseDoConserto({ erro, codigo: erro ? 1 : 0 })))
        } catch (erro) { resolver(fraseDoConserto({ erro })) }
      }),
    })
    atendente.registrar(ipcMain)

    const janela = abrirAJanela({
      BrowserWindow,
      shell,
      caminhoDoPreload: path.join(__dirname, 'preload.cjs'),
    })

    // A VERSAO VAI NO TITULO e a atualizacao corre por fora. Nada disto pode
    // atrasar a abertura: `procurar()` nao e esperado de proposito — quem chega
    // para gravar ve a janela na hora, com internet ou sem.
    criarAtualizacao({
      autoUpdater,
      versao: app.getVersion(),
      empacotado: app.isPackaged,
      aoMudarTitulo: (titulo) => { if (!janela.isDestroyed?.()) janela.setTitle(titulo) },
      registrar: (recado) => console.log('[atualizacao]', recado),
      // ⚠️ SO PERGUNTA COM A BANCADA PARADA. `temEtiquetaEmUso` responde se ha
      // etiqueta conectada agora; interromper alguem no meio de uma gravacao e
      // exatamente o que este programa evita desde o comeco.
      estaOcupado: () => atendente?.temEtiquetaEmUso?.() === true,
      perguntarSeReinicia: async (versaoNova) => {
        if (janela.isDestroyed?.()) return false
        const r = await dialog.showMessageBox(janela, {
          type: 'info',
          buttons: ['Reiniciar agora', 'Depois'],
          defaultId: 0,
          cancelId: 1,
          title: 'Versão nova do gravador',
          message: `A versão ${versaoNova || 'nova'} está pronta.`,
          detail: 'O programa precisa reiniciar para usá-la. Leva alguns segundos.\n\n'
            + 'Se preferir, escolha "Depois" — ela entra sozinha na próxima vez que '
            + 'você fechar o programa.',
        })
        return r?.response === 0
      },
    }).procurar()
  })

  // Fechar a janela solta a etiqueta e fecha o processo do PowerShell. Sem isto
  // ele ficaria vivo segurando o leitor, e a próxima abertura encontraria o
  // aparelho tomado — por ele mesmo.
  app.on('window-all-closed', async () => {
    try { await atendente?.fechar() } catch { /* fechando de qualquer jeito */ }
    app.quit()
  })
}
