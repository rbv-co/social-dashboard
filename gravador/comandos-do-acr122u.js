// OS BYTES QUE O LEITOR ACR122U ENTENDE — conta pura.
//
// Aqui se MONTA o que vai para o aparelho e se LÊ o que ele respondeu. Nada
// mais: não abre USB, não fala com o Windows, não tem rede. Por isso este
// arquivo se testa inteiro com `node --test`, sem leitor na mesa — que é o que
// permite escrever antes o teste do erro (página fora da faixa, resposta
// truncada, código de recusa) em vez de esperar a etiqueta errada aparecer.
//
// DE ONDE VÊM ESTES COMANDOS: do manual da ACS (API do PICC) e da bancada do
// dono, em 01/09/2026, num ACR122U de firmware `ACR122U220`. As 12 escritas
// responderam `90 00` e o celular abriu o certificado. NÃO se inventa comando
// aqui: o que não foi provado na etiqueta não entra neste arquivo.
//
//   escrever 4 bytes numa página   FF D6 00 <página> 04 <b1 b2 b3 b4>
//   ler                            FF B0 00 <página> <quantos bytes>
//   número de série da etiqueta    FF CA 00 00 00
//   versão do firmware do leitor   FF 00 48 00 00
//
// A ASSIMETRIA QUE PEGA QUEM CHEGA: a LEITURA atravessa páginas (16 bytes = 4
// páginas de uma vez), a ESCRITA não. Escrever é sempre de 4 em 4 bytes, uma
// página por comando. Agrupar escritas seria otimizar contra o hardware.

// AS PÁGINAS SAEM DO TRADUTOR, NÃO DAQUI. `PRIMEIRA_PAGINA` e `ULTIMA_PAGINA`
// já vivem em `ndef-para-ntag213.js`, que é quem monta o plano de gravação.
// Reescrevê-las aqui seria a mesma regra em dois lugares — e o dia em que uma
// mudasse sozinha, este arquivo autorizaria uma escrita na página das travas.
import {
  PRIMEIRA_PAGINA,
  ULTIMA_PAGINA,
} from '../src/ferramentas/autenticidade/gravador-de-mesa/ndef-para-ntag213.js'

const BYTES_POR_PAGINA = 4

// O comando de leitura do PICC leva a quantidade num byte só, e a NTAG213
// devolve no máximo 4 páginas (16 bytes) por READ. Pedir mais é pedir o que o
// aparelho não faz: ele recusa, e a recusa vira "troque a etiqueta" na cara de
// quem está com uma etiqueta boa na mão.
const MAXIMO_POR_LEITURA = 16

export { PRIMEIRA_PAGINA, ULTIMA_PAGINA }

export const APDU_NUMERO_DE_SERIE = [0xff, 0xca, 0x00, 0x00, 0x00]
export const APDU_VERSAO_DO_LEITOR = [0xff, 0x00, 0x48, 0x00, 0x00]

// A PÁGINA 3 É O CAPABILITY CONTAINER. Ler é normal — é assim que se descobre
// se a etiqueta está formatada e se ainda aceita gravação. Escrever nunca:
// os bits dela só mudam num sentido e a mudança é IRREVERSÍVEL.
export const PAGINA_DO_CAPABILITY_CONTAINER = 3

export function emHex(bytes) {
  return listaDeBytes(bytes).map((b) => b.toString(16).toUpperCase().padStart(2, '0')).join(' ')
}

// Aceita array comum, Uint8Array ou Buffer — a biblioteca do PC/SC devolve
// Buffer, o tradutor devolve array, e o teste passa qualquer um dos dois.
// Qualquer outra coisa vira lista vazia, e lista vazia nunca passa nas
// conferências abaixo.
function listaDeBytes(valor) {
  if (Array.isArray(valor)) return valor
  if (ArrayBuffer.isView(valor)) return Array.from(valor)
  return []
}

function ehByte(n) {
  return Number.isInteger(n) && n >= 0 && n <= 255
}

function conferirPagina(pagina, { paraEscrever }) {
  if (!Number.isInteger(pagina)) {
    throw new Error(
      `Página inválida (${JSON.stringify(pagina)}): o número da página tem de ser inteiro.`,
    )
  }
  if (paraEscrever) {
    if (pagina === PAGINA_DO_CAPABILITY_CONTAINER) {
      throw new Error(
        'Não se escreve na página 3: ela é o Capability Container da etiqueta, '
        + 'já vem certa de fábrica e a mudança dela é irreversível.',
      )
    }
    if (pagina < PRIMEIRA_PAGINA || pagina > ULTIMA_PAGINA) {
      throw new Error(
        `Página ${pagina} fora da faixa: só se grava da página ${PRIMEIRA_PAGINA} à `
        + `${ULTIMA_PAGINA}. Fora dela ficam as travas, a configuração e a senha da `
        + 'etiqueta — escrever lá estraga a etiqueta de vez.',
      )
    }
    return
  }
  if (pagina < 0 || pagina > ULTIMA_PAGINA) {
    throw new Error(
      `Página ${pagina} fora da faixa: só se lê da página 0 à ${ULTIMA_PAGINA}.`,
    )
  }
}

// MONTA A ESCRITA DE UMA PÁGINA. A conferência é ANTES de sair daqui, de
// propósito: depois de o comando entrar no leitor não há volta — a NTAG213 não
// tem desfazer, e uma página escrita fora da faixa do usuário estraga a
// etiqueta com a bolsa já costurada em cima.
export function apduDeEscrita(pagina, bytes) {
  conferirPagina(pagina, { paraEscrever: true })
  const conteudo = listaDeBytes(bytes)
  if (conteudo.length !== BYTES_POR_PAGINA) {
    throw new Error(
      `A escrita é sempre de 4 bytes, uma página por vez — vieram ${conteudo.length}. `
      + 'Não existe meia página na NTAG213.',
    )
  }
  const ruim = conteudo.findIndex((b) => !ehByte(b))
  if (ruim >= 0) {
    throw new Error(
      `O ${ruim + 1}º valor (${JSON.stringify(conteudo[ruim])}) não é um byte: `
      + 'só entram inteiros de 0 a 255.',
    )
  }
  // O construtor confere o próprio trabalho. Não é desconfiança de si: é a
  // trava que pega uma edição distraída AQUI, em vez de no leitor da bancada.
  return conferirApdu([0xff, 0xd6, 0x00, pagina, BYTES_POR_PAGINA, ...conteudo])
}

// MONTA A LEITURA. A leitura ATRAVESSA páginas, então a conta de onde ela
// termina é feita aqui: pedir 16 bytes a partir da página 39 traria as páginas
// 40 a 42 — travas dinâmicas, configuração e senha — que não são memória de
// peça nenhuma e só serviriam para confundir o tradutor.
export function apduDeLeitura(pagina, quantosBytes) {
  conferirPagina(pagina, { paraEscrever: false })
  if (!Number.isInteger(quantosBytes) || quantosBytes < 1 || quantosBytes > MAXIMO_POR_LEITURA) {
    throw new Error(
      `Leitura de ${JSON.stringify(quantosBytes)} bytes: o comando lê de 1 a `
      + `${MAXIMO_POR_LEITURA} bytes por vez.`,
    )
  }
  const ultimoByte = pagina * BYTES_POR_PAGINA + quantosBytes - 1
  const fimDoUsuario = (ULTIMA_PAGINA + 1) * BYTES_POR_PAGINA - 1
  if (ultimoByte > fimDoUsuario) {
    throw new Error(
      `Esta leitura passaria da página ${ULTIMA_PAGINA}: a leitura atravessa páginas, e `
      + 'depois da 39 estão as travas e a senha da etiqueta. Leia em pedaços menores.',
    )
  }
  return conferirApdu([0xff, 0xb0, 0x00, pagina, quantosBytes])
}

// ── LER A RESPOSTA ─────────────────────────────────────────────────────────
// Toda resposta termina em dois bytes de status. `90 00` é "deu certo";
// QUALQUER outra coisa é falha. Não existe meio-termo, e principalmente não
// existe "falhou mas os dados servem".

const RESPOSTA_BOA = [0x90, 0x00]

// As recusas que o ACR122U e a NTAG213 devolvem de verdade. Cada uma vira a
// frase que quem está de pé na bancada consegue agir em cima — nome de código
// hexadecimal não diz a ninguém o que fazer com a etiqueta que está na mão.
//
// A LISTA É CURTA DE PROPÓSITO: só entra o que está no manual da ACS e no
// datasheet. Traduzir de cabeça um código que nunca vimos seria pôr uma frase
// confiante em cima de um palpite — e a frase manda o operador jogar fora
// etiqueta boa. O que não está aqui sai com o hexadecimal na cara.
const FRASES = {
  // ⚠️ ESTA FRASE JÁ MANDOU DUAS PESSOAS OLHAREM PARA O LUGAR ERRADO. Em
  // 01/09/2026, na bancada, um comando com UM BYTE A MAIS (`FFB000030400`, seis
  // bytes onde cabem cinco) respondeu `63 00`, e duas rodadas foram gastas
  // procurando defeito na etiqueta e no aparelho. O defeito estava no comando,
  // deste lado. Por isso a frase diz o que ele significa NA PRÁTICA, e não manda
  // trocar a etiqueta: operador que troca etiqueta boa joga bolsa fora.
  '63 00': 'O leitor não entendeu o comando, ou não executou. Na prática isto quase sempre é '
    + 'comando montado errado — não é defeito da etiqueta, e trocar de etiqueta não resolve. '
    + 'Se o programa não mudou, encoste a etiqueta de novo e segure parada; se repetir, avise.',
  '6A 81': 'Esta etiqueta não aceita esse comando — pode não ser uma NTAG213. '
    + 'Use uma etiqueta NTAG213, do jeito que vem de fábrica.',
  '6B 00': 'O leitor recusou a página pedida. Isso é defeito do programa, não da etiqueta: '
    + 'anote o que estava fazendo e avise.',
  '67 00': 'O leitor recusou o tamanho do comando. Isso é defeito do programa, não da etiqueta: '
    + 'anote o que estava fazendo e avise.',
  '6D 00': 'Este leitor não conhece esse comando. Confira se é mesmo um ACR122U — '
    + 'o de fábrica aparece no Windows como "ACS ACR122U PICC Interface".',
  '6E 00': 'Este leitor não conhece essa família de comandos. Confira se é mesmo um ACR122U.',
}

// ── O TAMANHO TOTAL DO COMANDO ─────────────────────────────────────────────
//
// ⚠️ A CICATRIZ, MEDIDA NA BANCADA EM 01/09/2026: foi mandado `FFB000030400` —
// seis bytes, um a mais que os cinco de `FF B0 00 03 04`. O leitor respondeu
// `63 00`, que não diz nada a ninguém, e DUAS RODADAS foram gastas procurando
// defeito na etiqueta e no aparelho. O erro nasceu deste lado, e é aqui que ele
// tinha de ter parado.
//
// Cada um dos quatro comandos tem tamanho FIXO e conhecido. A conta, byte a
// byte, para ninguém ter de refazer de cabeça:
//
//   ler       FF B0 00 <página> <n>                → 5
//   escrever  FF D6 00 <página> 04 <b1 b2 b3 b4>   → 5 + 4 = 9
//   série     FF CA 00 00 00                       → 5
//   versão    FF 00 48 00 00                       → 5
//
// ⚠️ ESCREVER SÃO **NOVE**, NÃO DEZ. Cinco de cabeçalho mais quatro de dados. É
// o comando que a bancada provou — as 12 escritas que responderam `90 00`. Se
// alguém "corrigir" para dez, toda gravação passa a ser recusada aqui e o
// gravador morre na primeira etiqueta.
const COMANDOS_CONHECIDOS = [
  { nome: 'ler uma página', cabecalho: [0xff, 0xb0], tamanho: 5 },
  { nome: 'escrever uma página', cabecalho: [0xff, 0xd6], tamanho: 9 },
  { nome: 'número de série da etiqueta', cabecalho: [0xff, 0xca], tamanho: 5 },
  { nome: 'versão do firmware do leitor', cabecalho: [0xff, 0x00, 0x48], tamanho: 5 },
]

// Recusa ANTES do cabo. Devolve o comando quando ele está certo, para poder ser
// usada em cadeia.
export function conferirApdu(apdu) {
  const bytes = listaDeBytes(apdu)
  if (!bytes.length || bytes.some((b) => !ehByte(b))) {
    throw new Error(
      `Isto não é um comando de leitor: ${JSON.stringify(apdu)?.slice(0, 60)}. `
      + 'Só saem daqui os quatro comandos provados na etiqueta.',
    )
  }
  const conhecido = COMANDOS_CONHECIDOS.find(
    ({ cabecalho }) => cabecalho.every((b, i) => bytes[i] === b),
  )
  // ⚠️ NÃO SE INVENTA COMANDO DE APARELHO. Cabeçalho fora dos quatro provados
  // não vira tentativa no leitor: vira recusa aqui, com nome, em vez de um
  // `63 00` que ninguém sabe ler.
  if (!conhecido) {
    throw new Error(
      `Comando desconhecido (${emHex(bytes.slice(0, 3))}...). Este programa só manda quatro `
      + 'comandos ao leitor: ler página, escrever página, número de série e versão do leitor.',
    )
  }
  if (bytes.length !== conhecido.tamanho) {
    throw new Error(
      `O comando de ${conhecido.nome} tem ${conhecido.tamanho} bytes, e vieram `
      + `${bytes.length}: ${emHex(bytes)}. O leitor responderia "63 00" a isto, que parece `
      + 'defeito de etiqueta e não é — o comando é que está errado.',
    )
  }
  return bytes
}

// `bytesEsperados` é opcional e existe por causa de UMA cicatriz.
//
// ⚠️ LEITURA CURTA QUE TERMINA EM `90 00` PARECE SUCESSO. Se ela passar, o
// tradutor recebe meia memória, não acha registro de endereço nenhum, devolve
// '' — e `conferirLeitura` chama isso de 'vazia', que quer dizer PODE GRAVAR.
// A etiqueta tinha dono, e a bolsa que estava com ela perde a identidade dentro
// do forro, onde não se reabre. Por isso quem pede N bytes confere N bytes:
// leitura incompleta é FALHA, nunca autorização.
export function lerResposta(resposta, { bytesEsperados = null } = {}) {
  const bytes = listaDeBytes(resposta)
  const vazio = { ok: false, dados: [], status: '' }

  if (bytes.length < RESPOSTA_BOA.length) {
    return {
      ...vazio,
      aviso: 'A resposta do leitor cortou no meio '
        + `(${bytes.length} byte(s), e toda resposta tem pelo menos 2). `
        + 'Encoste a etiqueta de novo e segure parada.',
    }
  }

  const status = emHex(bytes.slice(-2))
  const dados = bytes.slice(0, -2)

  if (status !== '90 00') {
    return {
      ...vazio,
      status,
      aviso: FRASES[status]
        || `O leitor recusou (código ${status}). Encoste de novo; se repetir, troque a etiqueta.`,
    }
  }

  if (bytesEsperados != null && dados.length !== bytesEsperados) {
    return {
      ...vazio,
      status,
      aviso: `A leitura veio incompleta: pedi ${bytesEsperados} bytes e voltaram `
        + `${dados.length} de ${bytesEsperados}. Encoste a etiqueta de novo e segure parada — `
        + 'não dá para decidir nada com meia leitura.',
    }
  }

  return { ok: true, dados, status, aviso: '' }
}
