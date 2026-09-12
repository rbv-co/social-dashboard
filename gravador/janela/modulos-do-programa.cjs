// A LISTA DO QUE ENTRA NO PACOTE — em um lugar só.
//
// POR QUE ELA NÃO MORA NO `electron-builder.config.cjs`: aquele arquivo é
// VALIDADO contra um esquema, e o empacotador RECUSA qualquer chave que ele não
// conheça — "configuration has an unknown property 'MODULOS_DO_PROGRAMA'" — e
// não gera nada. Tentei escondê-la como propriedade não-enumerável e não bastou:
// o validador enxerga assim mesmo.
//
// Mas a lista precisa existir fora do empacotador, porque é dela que o teste
// `o-instalador-tem-tudo` parte: ele caminha pelos `import` de verdade desde o
// `principal.cjs` e reprova se algum arquivo do programa não estiver aqui. Sem
// esse teste, um `import` novo faria o instalador sair sem o arquivo, e o
// programa morreria SÓ NA BANCADA, na primeira etiqueta, com "Cannot find
// module" — o pior lugar e o pior momento para descobrir.
//
// ⚠️ POR QUE A RAIZ DO PACOTE É A RAIZ DO PROJETO, e não `gravador/`: o motor
// importa `../src/ferramentas/autenticidade/gravador-de-mesa/ndef-para-ntag213.js`
// — as páginas da etiqueta saem do tradutor, que é do painel, para não existirem
// duas cópias da mesma faixa de páginas. Empacotando `gravador/` como raiz, esse
// `../src` cairia fora. Com a raiz do projeto, o caminho relativo vale lá como
// vale aqui.
const PASTAS_DO_PROGRAMA = require('./pastas-do-programa.cjs')

const MODULOS_DO_PROGRAMA = Object.entries(PASTAS_DO_PROGRAMA)
  .flatMap(([pasta, arquivos]) => arquivos.map((a) => `${pasta}/${a}`))

module.exports = { PASTAS_DO_PROGRAMA, MODULOS_DO_PROGRAMA }
