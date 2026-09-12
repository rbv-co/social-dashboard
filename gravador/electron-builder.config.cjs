// COMO SE GERA O INSTALADOR DO WINDOWS.
//
// ⚠️ NADA AQUI PRECISA DE FERRAMENTA DE COMPILAÇÃO. Decisão do dono, em
// 01/09/2026: nada se instala na bancada. O Electron vem pronto, e as nossas
// dependências são JavaScript puro — não há `node-gyp`, não há Visual Studio.
// Há teste que trava isso (`o-instalador-tem-tudo.test.mjs`).
//
// O COMANDO (numa máquina Windows, dentro de `gravador/`):
//     npm install
//     npm run empacotar
//
// ⚠️ A LISTA DE ARQUIVOS NÃO SE ESCREVE À MÃO DUAS VEZES. `PASTAS_DO_PROGRAMA`
// é a única lista, e há teste que caminha pelos `import` de verdade a partir de
// `principal.cjs` e reprova se algum arquivo do programa não estiver aqui. Sem
// isso, um `import` novo faria o instalador sair sem ele — e o programa morreria
// só na bancada, na primeira etiqueta, com "Cannot find module".
//
// ⚠️ POR QUE O PROGRAMA VAI PARA DENTRO DE UMA PASTA `gravador/`: o motor importa
// `../src/ferramentas/autenticidade/gravador-de-mesa/ndef-para-ntag213.js` — as
// páginas da etiqueta saem do tradutor, que é do painel, para não haver duas
// cópias da mesma faixa de páginas. Empacotando `gravador/` como raiz, esse
// `../src` cairia fora do pacote. Então a raiz do pacote é a raiz do projeto, com
// as duas pastas dentro, e o caminho relativo continua valendo lá como aqui.
// A lista mora fora: o empacotador VALIDA este objeto e recusa chave que nao
// conhece. Ver `janela/modulos-do-programa.cjs` para a historia inteira.
const PASTAS_DO_PROGRAMA = require('./janela/pastas-do-programa.cjs')

const configuracao = {

  appId: 'com.rbvcompany.gravador-de-etiquetas',
  productName: 'Gravador de Etiquetas Vessel',
  // A entrada mora dentro de `gravador/` no pacote — ver a explicação acima.
  extraMetadata: { main: 'gravador/janela/principal.cjs' },
  // ⚠️ SEM ASAR, DE PROPÓSITO. O programa é ESM por dentro, e ESM lido de dentro
  // de um arquivo `.asar` é justamente a parte do Electron que muda de versão
  // para versão. Aqui os arquivos ficam abertos na pasta do programa — que, de
  // quebra, é o que permite abrir o script do PowerShell e rodá-lo à mão quando
  // algo der errado na bancada, que é como este caminho foi provado.
  asar: false,
  directories: { output: '../entregas/gravador-de-etiquetas' },
  files: [
    'package.json',
    ...Object.entries(PASTAS_DO_PROGRAMA).map(([pasta, arquivos]) => ({
      from: `../${pasta}`,
      to: pasta,
      filter: arquivos,
    })),
  ],
  // DE ONDE O PROGRAMA BAIXA VERSAO NOVA.
  // Repositorio PUBLICO e so de instaladores: publico porque o atualizador
  // baixa sem senha nenhuma, e um repositorio privado obrigaria a embutir um
  // token na maquina de todo mundo. So de instaladores porque nenhuma linha da
  // Central tem por que morar la. O que vai dentro do pacote e a chave `anon`,
  // a mesma que ja esta publica no JavaScript do painel.
  publish: [{ provider: 'github', owner: 'rbv-co', repo: 'gravador-de-etiquetas-versoes' }],
  win: {
    target: 'nsis',
    // ⚠️ O NOME DO INSTALADOR SEM ESPAÇO, e isto NÃO é gosto.
    //
    // Por padrão o electron-builder monta o arquivo com o `productName` — que
    // tem espaços — mas escreve no `latest.yml` a versão com HÍFENS. Os dois
    // não batem, e o `latest.yml` é o arquivo que o programa instalado lê para
    // se atualizar: ele pediria um arquivo que não existe e a atualização
    // ficaria MUDA, sem erro nenhum na tela de ninguém.
    //
    // Aconteceu nas versões 1.0.0 e 1.0.1, as duas pegas na conferência antes
    // de subir. Fixando o nome aqui, as duas pontas passam a nascer iguais.
    artifactName: 'Gravador-de-Etiquetas-Vessel-Setup-${version}.${ext}',
  },
  nsis: {
    oneClick: false,
    perMachine: false,
    allowToChangeInstallationDirectory: true,
    shortcutName: 'Gravador de Etiquetas',
  },
}

module.exports = configuracao
