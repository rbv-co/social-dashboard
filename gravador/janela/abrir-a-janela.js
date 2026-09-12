// A JANELA — uma casca fina que empresta o leitor para a tela que já existe.
//
// ELA NÃO TEM TELA PRÓPRIA. O que abre aqui dentro é
// `https://central.rbvcompany.com/autenticidade`, a mesma tela do painel, com o
// mesmo desenho de computador e o mesmo login. Duas telas para o mesmo trabalho
// seriam duas telas para manter, e a segunda ficaria para trás.
//
// O QUE ESTE ARQUIVO GARANTE, e não dá para ver olhando a janela aberta:
//  1. a página NÃO tem poder de sistema (sem Node, isolada, em caixa de areia);
//  2. o leitor NÃO viaja com ela para fora (navegação presa à nossa casa);
//  3. nenhuma segunda janela nasce por dentro (`window.open` sempre negado).
//
// O Electron entra por INJEÇÃO, como a ponte entra no leitor: é o que permite
// provar tudo isso com `node --test`, sem abrir janela nenhuma.
import { ENDERECO_DA_CENTRAL, podeNavegar } from './enderecos-permitidos.js'

// Só endereço da web sai para o navegador do computador. `openExternal` de um
// `file:` abre um arquivo da máquina — e de um `.bat`, executa. Um `javascript:`
// ou um `data:` também não são para entregar a ninguém.
const SO_A_WEB = /^https?:$/

function abrirLaFora(shell, endereco) {
  let url
  try { url = new URL(endereco) } catch { return }
  if (!SO_A_WEB.test(url.protocol)) return
  try { shell?.openExternal?.(endereco) } catch { /* sem navegador, sem o que fazer */ }
}

export function abrirAJanela({
  BrowserWindow,
  shell,
  caminhoDoPreload,
  endereco = ENDERECO_DA_CENTRAL,
  aoFechar = null,
} = {}) {
  const janela = new BrowserWindow({
    width: 1280,
    height: 900,
    minWidth: 960,
    title: 'Gravador de etiquetas de mesa — Vessel',
    autoHideMenuBar: true,
    webPreferences: {
      // ⚠️ AS QUATRO LINHAS QUE SUSTENTAM TUDO. A tela vem da internet: ela não
      // recebe poder de sistema nenhum. O que ela ganha é a superfície estreita
      // do preload, e só ela.
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // `<webview>` seria uma janela dentro da janela, e ela nasceria sem estas
      // travas — com o mesmo preload pendurado.
      webviewTag: false,
      preload: caminhoDoPreload,
    },
  })

  // ── A NAVEGAÇÃO FICA PRESA À NOSSA CASA ─────────────────────────────────
  //
  // ⚠️ SÃO DOIS EVENTOS, E NÃO UM. `will-navigate` é o clique num link;
  // `will-redirect` é o desvio que o servidor manda no meio do caminho (um 302).
  // Ouvir só o primeiro deixa aberta exatamente a porta por onde ninguém olha.
  const prender = (evento, endereçoNovo) => {
    if (podeNavegar(endereçoNovo)) return
    evento.preventDefault()
    // O link continua funcionando — só que no navegador do computador, longe do
    // leitor. Negar calado faria a pessoa achar que a janela travou.
    abrirLaFora(shell, endereçoNovo)
  }
  janela.webContents.on('will-navigate', prender)
  janela.webContents.on('will-redirect', prender)

  // ── NENHUMA SEGUNDA JANELA, NEM PARA A NOSSA PRÓPRIA CASA ───────────────
  // Uma janela aberta por `window.open` nasceria com o mesmo preload e sem
  // passar por nada disto aqui: seria a porta dos fundos do leitor.
  janela.webContents.setWindowOpenHandler(({ url }) => {
    abrirLaFora(shell, url)
    return { action: 'deny' }
  })

  if (typeof aoFechar === 'function') janela.once?.('closed', aoFechar)

  janela.loadURL(endereco)
  return janela
}
