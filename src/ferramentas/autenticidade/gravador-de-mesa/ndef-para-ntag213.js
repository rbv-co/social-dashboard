// O TRADUTOR DA ETIQUETA NTAG213.
//
// Recebe o endereço da peça e devolve EXATAMENTE o que escrever em cada página
// da etiqueta. Não fala com o leitor, não fala com USB, não tem DOM e não tem
// rede — é conta pura, como o resto do painel, e por isso se testa de verdade
// com `node --test`, sem etiqueta na mão.
//
// O DOMÍNIO NÃO MORA AQUI. O endereço chega pronto, de `enderecoDaTag`
// (lotes.js). Domínio em dois lugares é domínio errado esperando acontecer — e
// este vai gravado dentro de um chip costurado numa bolsa, onde não se corrige.
//
// O QUE ESTE ARQUIVO NÃO FAZ, DE PROPÓSITO:
//  • Não confere a página 3 dentro de `planoDeGravacao`. A ordem — conferir o
//    Capability Container, ler a memória, planejar, gravar, ler de volta e
//    conferir com `enderecoNaEtiqueta` — é de quem chama. O tradutor traduz;
//    quem decide o que fazer com a etiqueta é a tela. Não faltou: é separado.
//  • Não junta escritas. Uma escrita por página está certo: o leitor de mesa
//    escreve 4 bytes por vez numa etiqueta destas. A LEITURA é que pode pegar 4
//    páginas de uma tacada; a escrita, não. Agrupar seria otimizar contra o
//    hardware.
//  • Não trava a etiqueta. Travar mexe na página 40 e no Capability Container,
//    é irreversível, e é outro módulo.

// ── A MEMÓRIA DA ETIQUETA (datasheet NXP) ──────────────────────────────────
// A NTAG213 tem páginas de 4 bytes. A página 3 é o Capability Container. As
// páginas 4 a 39 (0x04–0x27) são os 144 bytes de memória do usuário — o único
// lugar onde este arquivo pode escrever. A página 40 são as travas dinâmicas e
// as 41 a 44 são configuração e senha: escrever lá estraga a etiqueta.
const LETRAS_PARA_BYTES = new TextEncoder()
const BYTES_PARA_LETRAS = new TextDecoder()

const BYTES_POR_PAGINA = 4
export const PRIMEIRA_PAGINA = 4
export const ULTIMA_PAGINA = 39
export const BYTES_DE_USUARIO = (ULTIMA_PAGINA - PRIMEIRA_PAGINA + 1) * BYTES_POR_PAGINA // 144

// ── OS EMBRULHOS TLV (NFC Forum Type 2 Tag) ────────────────────────────────
const TLV_ENCHIMENTO = 0x00 // um byte só, serve de espaço em branco
const TLV_TRAVAS = 0x01 // Lock Control
const TLV_MENSAGEM = 0x03 // a mensagem NDEF
const TLV_FIM = 0xfe // terminador

// O campo de tamanho do TLV tem 1 byte quando o conteúdo tem menos de 255
// bytes. Numa etiqueta de 144 bytes isso nunca acontece, então a forma de 3
// bytes é código morto e NÃO está implementada aqui de propósito: código que
// nunca roda é código que ninguém conferiu. Quem garante isso é a conferência
// de espaço lá embaixo, que recusa muito antes de 255 bytes.

// ── O PREFIXO ABREVIADO DA URL (NFC Forum RTD-URI) ─────────────────────────
// O primeiro byte do conteúdo do registro não é texto: é um número que vale por
// um pedaço do começo da URL. `04` vale `https://`, então de
// `https://<algum-dominio>/verify/ABC` só vai `<algum-dominio>/verify/ABC` como
// texto — 7 bytes de economia numa etiqueta que tem 144.
//
// A tabela oficial tem 36 linhas (`tel:`, `mailto:`, bluetooth, `urn:`...).
// Aqui só entram as de endereço da web, que são as únicas que um endereço de
// peça pode ter. Copiar as outras de cabeça seria copiar uma delas errada.
// A ordem importa na hora de gravar: o `www.` tem de ser testado ANTES do que
// não tem, senão `https://www.x` viraria prefixo `04` com o `www.` no texto.
const PREFIXOS = [
  [0x02, 'https://www.'],
  [0x01, 'http://www.'],
  [0x04, 'https://'],
  [0x03, 'http://'],
  [0x00, ''], // sem abreviação: a URL inteira vai como texto
]

// ── O REGISTRO NDEF DE URL ─────────────────────────────────────────────────
// Cabeçalho `D1 01 <tamanho> 55`:
//   D1 = primeiro e último registro da mensagem, forma curta, tipo conhecido
//   01 = o nome do tipo tem 1 byte
//   55 = 'U', de URI
function registroDeUrl(endereco) {
  const texto = String(endereco ?? '').trim()
  if (!texto) {
    throw new Error('Sem endereço para gravar: a etiqueta ficaria em branco dentro da bolsa.')
  }
  const [codigo, prefixo] = PREFIXOS.find(([, p]) => p && texto.toLowerCase().startsWith(p))
    || [0x00, '']
  const conteudo = [codigo, ...LETRAS_PARA_BYTES.encode(texto.slice(prefixo.length))]
  return [0xd1, 0x01, conteudo.length, 0x55, ...conteudo]
}

// Aceita array comum ou Uint8Array. Qualquer outra coisa — nulo, texto, número,
// "não li nada" — vira memória desconhecida, e memória desconhecida é tratada
// como etiqueta sem Lock Control: a mensagem começa na página 4.
function bytesLidos(memoriaAtual) {
  if (Array.isArray(memoriaAtual)) return memoriaAtual
  if (ArrayBuffer.isView(memoriaAtual)) return Array.from(memoriaAtual)
  return []
}

// ONDE A MENSAGEM PODE COMEÇAR.
//
// ⚠️ A ARMADILHA QUE MAIS IMPORTA: uma NTAG213 de fábrica NÃO vem em branco. As
// páginas 4 e 5 saem da fábrica com `01 03 A0 0C 34 03 00 FE` — os cinco
// primeiros bytes são um Lock Control TLV. Escrever por cima dele às cegas
// destrói uma estrutura que a etiqueta espera ter. Por isso este arquivo NÃO
// decide sozinho onde começar: ele lê o que já está lá.
function ondeComecaAMensagem(memoria) {
  if (memoria[0] !== TLV_TRAVAS) return 0
  const tamanho = memoria[1]
  if (typeof tamanho !== 'number') {
    throw new Error(
      'A leitura da etiqueta parou no meio do Lock Control. '
      + 'Leia as páginas 4 e 5 inteiras antes de gravar.',
    )
  }
  // 1 byte de tipo + 1 de tamanho + o conteúdo. Na NTAG213 é sempre `01 03` e
  // dá 5, mas o tamanho se lê da etiqueta em vez de se supor.
  return 2 + tamanho
}

// Recebe o endereço e o que JÁ ESTÁ gravado na memória do usuário (bytes lidos
// a partir da página 4; pode vir vazio quando não se leu nada).
// Devolve a lista de escritas: [{ pagina: 4, bytes: [.., .., .., ..] }, ...]
export function planoDeGravacao(endereco, memoriaAtual) {
  const memoria = bytesLidos(memoriaAtual)
  const inicio = ondeComecaAMensagem(memoria)

  const mensagem = registroDeUrl(endereco)
  const conteudo = [TLV_MENSAGEM, mensagem.length, ...mensagem, TLV_FIM]
  const fim = inicio + conteudo.length // primeiro byte DEPOIS do conteúdo

  // NÃO COUBE, ENTÃO NÃO GRAVA. Cortar o endereço no meio em silêncio grava uma
  // etiqueta que abre um endereço que não existe — a cliente encosta o celular
  // e conclui que a bolsa é falsa. E passar da página 39 escreve nas travas
  // dinâmicas e na senha da etiqueta, que é estragar a etiqueta de vez.
  if (fim > BYTES_DE_USUARIO) {
    throw new Error(
      `Este endereço é longo demais para a etiqueta: precisa de ${fim} bytes e `
      + `cabem ${BYTES_DE_USUARIO}. Encurte o endereço ou use uma etiqueta maior.`,
    )
  }

  return paginasComOConteudo(conteudo, inicio, memoria)
}

// O MONTADOR DE PÁGINAS — usado pela gravação E pelo apagamento.
//
// Ele mora fora das duas porque a parte delicada é a mesma nos dois casos: a
// escrita é de página INTEIRA, e a página onde a mensagem começa carrega junto
// o rabo do Lock Control da etiqueta. Duas cópias disto seria uma delas
// esquecendo de preservar a trava no dia em que a outra mudasse.
function paginasComOConteudo(conteudo, inicio, memoria) {
  const fim = inicio + conteudo.length
  const primeira = Math.floor(inicio / BYTES_POR_PAGINA)
  const ultima = Math.floor((fim - 1) / BYTES_POR_PAGINA)

  const escritas = []
  for (let pagina = primeira; pagina <= ultima; pagina++) {
    const bytes = []
    for (let i = 0; i < BYTES_POR_PAGINA; i++) {
      const onde = pagina * BYTES_POR_PAGINA + i
      if (onde < inicio) {
        // Byte que já estava na etiqueta — o rabo do Lock Control, que cai no
        // meio de uma página nossa. A escrita é de página inteira: se este byte
        // fosse zero, a trava iria embora junto com a gravação.
        if (typeof memoria[onde] !== 'number') {
          throw new Error(
            'Não dá para gravar sem ter lido a página inteira onde a mensagem começa: '
            + 'metade dela é do Lock Control da etiqueta.',
          )
        }
        bytes.push(memoria[onde])
      } else if (onde < fim) {
        bytes.push(conteudo[onde - inicio])
      } else {
        // A escrita é de 4 em 4 bytes, não existe meia página: o que sobra da
        // última vai com zero.
        bytes.push(TLV_ENCHIMENTO)
      }
    }
    escritas.push({ pagina: PRIMEIRA_PAGINA + pagina, bytes })
  }
  return escritas
}

// ── APAGAR: DEVOLVER A ETIQUETA AO ESTADO DE FÁBRICA ───────────────────────
//
// ⚠️ ESTA É A ÚNICA PORTA QUE PODE DEIXAR UMA ETIQUETA EM BRANCO, e ela é
// separada de propósito. `planoDeGravacao` RECUSA endereço vazio, e essa recusa
// não pode ser afrouxada: se ela aceitasse, qualquer caminho futuro passaria a
// poder apagar uma etiqueta por acidente — bastaria uma variável chegar vazia
// num dia ruim, e a bolsa já estaria costurada. Duas portas para duas
// intenções: quem grava nunca apaga sem querer, e quem apaga sabe o que faz.
//
// "EM BRANCO" NÃO É MEMÓRIA ZERADA. Uma NTAG213 sai de fábrica com
// `01 03 A0 0C 34 03 00 FE`: o Lock Control, que se preserva, seguido de uma
// MENSAGEM NDEF VAZIA (`03 00 FE`). Apagar é devolver exatamente esse estado —
// não é inventar um estado novo, é restaurar o que o fabricante documenta.
//
// ⚠️ A ORDEM DAS ESCRITAS NÃO É DETALHE. A mensagem vazia vai PRIMEIRO: a
// partir da primeira escrita a etiqueta já lê como em branco, e todo o resto é
// só higiene. Se a etiqueta sair do leitor no meio — que é o que mais acontece
// na bancada — ela fica num estado VÁLIDO e vazio, e não num meio-termo.
// Limpando primeiro e escrevendo a mensagem por último, a interrupção deixaria
// a etiqueta com o endereço antigo pela metade: nem apagada, nem legível.
//
// A limpeza do resto existe para o código da bolsa anterior não continuar
// legível na memória: o leitor comum para no terminador, mas os bytes seguem
// lá para quem lê a memória crua.
export function planoDeApagamento(memoriaAtual) {
  const memoria = bytesLidos(memoriaAtual)
  const inicio = ondeComecaAMensagem(memoria)

  const mensagemVazia = [TLV_MENSAGEM, 0x00, TLV_FIM]
  const escritas = paginasComOConteudo(mensagemVazia, inicio, memoria)

  const ultimaEscrita = escritas[escritas.length - 1].pagina
  for (let pagina = ultimaEscrita + 1; pagina <= ULTIMA_PAGINA; pagina++) {
    escritas.push({ pagina, bytes: [0, 0, 0, 0] })
  }
  return escritas
}

// ── O CONTRÁRIO: O QUE ESTÁ NA ETIQUETA ────────────────────────────────────
// Conferir é metade do trabalho. É por aqui que se prova que a gravação deu
// certo, e é por aqui que se descobre que a etiqueta JÁ TEM outra peça antes de
// escrever por cima.
//
// ⚠️ VOLTAR VAZIO AQUI FAZ A TELA DIZER "ETIQUETA EM BRANCO" E GRAVAR POR CIMA
// DE OUTRA BOLSA. Quem decide gravar é `conferirLeitura`, em nfc-fila.js, e ela
// trata endereço vazio como 'vazia' → pode gravar. A bolsa que estava com
// aquela etiqueta perde a identidade, e ninguém descobre até uma cliente
// encostar o celular e ver a bolsa errada — com a etiqueta já costurada dentro
// do forro, onde não se reabre.
//
// A CICATRIZ: a primeira versão deste arquivo lia só o PRIMEIRO registro da
// mensagem. Nosso celular grava um registro só, então na bancada parecia certo.
// Mas uma etiqueta gravada pelo NFC Tools, ou por qualquer app de terceiro, põe
// o registro de aplicativo do Android ANTES do endereço — e essa etiqueta seria
// lida como em branco. O caminho do celular sempre fez certo: `urlDaMensagem`,
// em gravador-nfc.js, percorre TODOS os `records`. Aqui é igual: na dúvida,
// procura-se MAIS, nunca menos.

// Os bits do cabeçalho de cada registro (NFC Forum NDEF):
const REGISTRO_ULTIMO = 0x40 // ME: a mensagem acaba neste registro
const REGISTRO_PEDACO = 0x20 // CF: isto é só um PEDAÇO de um registro maior
const REGISTRO_CURTO = 0x10 // SR: o tamanho do conteúdo cabe em 1 byte
const REGISTRO_TEM_ID = 0x08 // IL: tem um campo de id no meio
const TIPO_CONHECIDO = 0x01 // TNF 1: tipo do catálogo do NFC Forum ('U', 'T'...)
const TIPO_ENDERECO_ABSOLUTO = 0x03 // TNF 3: o NOME do tipo é a própria URL
const NOME_URI = 0x55 // 'U', de URI
// O bit MB (0x80) marca o primeiro registro. Ele NÃO é exigido aqui: recusar a
// mensagem inteira por causa dele devolveria '' — e '' é a resposta perigosa.

// Corta a mensagem na cadeia de registros dela, andando pelos tamanhos que cada
// cabeçalho declara. Para no ME, e para também se os bytes acabarem no meio:
// mensagem cortada não vira registro adivinhado.
function registrosDaMensagem(bytes) {
  const registros = []
  let i = 0
  while (i < bytes.length) {
    const cabecalho = bytes[i]
    if (typeof cabecalho !== 'number') break
    let j = i + 1
    const tamanhoDoNome = bytes[j]
    j += 1

    let tamanhoDoConteudo
    if (cabecalho & REGISTRO_CURTO) {
      tamanhoDoConteudo = bytes[j]
      j += 1
    } else {
      // A forma longa gasta 4 bytes e só existe acima de 255 bytes de conteúdo:
      // não cabe numa etiqueta de 144. Lê-se assim mesmo para conseguir PULAR o
      // registro e chegar no próximo, em vez de desistir da mensagem inteira —
      // desistir devolveria vazio, que é o que manda gravar por cima.
      const quatro = bytes.slice(j, j + 4)
      j += 4
      if (quatro.length < 4) break
      tamanhoDoConteudo = quatro[0] * 0x1000000 + quatro[1] * 0x10000
        + quatro[2] * 0x100 + quatro[3]
    }

    const tamanhoDoId = (cabecalho & REGISTRO_TEM_ID) ? bytes[j++] : 0
    if (![tamanhoDoNome, tamanhoDoConteudo, tamanhoDoId].every((n) => typeof n === 'number')) break

    const nome = bytes.slice(j, j + tamanhoDoNome)
    j += tamanhoDoNome + tamanhoDoId
    const conteudo = bytes.slice(j, j + tamanhoDoConteudo)
    j += tamanhoDoConteudo
    if (nome.length !== tamanhoDoNome || conteudo.length !== tamanhoDoConteudo) break

    registros.push({ cabecalho, nome, conteudo })
    i = j
    if (cabecalho & REGISTRO_ULTIMO) break
  }
  return registros
}

// O endereço de UM registro, ou '' quando aquele registro não é endereço.
// Vazio aqui só quer dizer "não é neste": quem chama continua procurando nos
// outros. Nunca é um endereço adivinhado.
function enderecoDoRegistro({ cabecalho, nome, conteudo }) {
  // Pedaço de registro cortado é MEIO endereço, e meio endereço não vale por
  // endereço: um pedaço com `https://abc` faria a tela dizer que a etiqueta já
  // está gravada com uma peça que não existe.
  if (cabecalho & REGISTRO_PEDACO) return ''
  const tipo = cabecalho & 0x07

  // Endereço absoluto: o NOME do tipo é a própria URL e o conteúdo vem vazio. O
  // celular lê este tipo também (`absolute-url`, em urlDaMensagem) — se aqui
  // não lesse, o gravador de mesa diria "vazia" para uma etiqueta ocupada.
  if (tipo === TIPO_ENDERECO_ABSOLUTO) {
    const url = BYTES_PARA_LETRAS.decode(Uint8Array.from(nome))
    return /^https?:\/\//i.test(url) ? url : ''
  }

  if (tipo !== TIPO_CONHECIDO) return ''
  if (nome.length !== 1 || nome[0] !== NOME_URI) return ''
  if (!conteudo.length) return ''
  const prefixo = PREFIXOS.find(([codigo]) => codigo === conteudo[0])
  if (!prefixo) return '' // `tel:`, `mailto:` e companhia não são endereço de peça
  return prefixo[1] + BYTES_PARA_LETRAS.decode(Uint8Array.from(conteudo.slice(1)))
}

// Recebe os bytes lidos da etiqueta (a partir da página 4) e devolve o endereço
// que está lá — ou '' se não houver mensagem NDEF de URL em registro nenhum.
export function enderecoNaEtiqueta(memoriaAtual) {
  const memoria = bytesLidos(memoriaAtual)
  let i = 0
  while (i < memoria.length) {
    const tipo = memoria[i]
    if (tipo === TLV_FIM) return '' // terminador: daqui para a frente não há nada
    if (tipo === TLV_ENCHIMENTO) { i += 1; continue } // enchimento gasta 1 byte só
    const tamanho = memoria[i + 1]
    if (typeof tamanho !== 'number' || tamanho === 0xff) return ''
    if (tipo === TLV_MENSAGEM) {
      // TODOS os registros, não só o primeiro. O primeiro pode ser o registro
      // de aplicativo do Android, um texto, ou qualquer coisa que outro app pôs
      // na frente.
      for (const registro of registrosDaMensagem(memoria.slice(i + 2, i + 2 + tamanho))) {
        const endereco = enderecoDoRegistro(registro)
        if (endereco) return endereco
      }
      return ''
    }
    // qualquer outro embrulho (Lock Control, memória reservada) se pula inteiro
    i += 2 + tamanho
  }
  return ''
}

// ── A PÁGINA 3: O CAPABILITY CONTAINER ─────────────────────────────────────
// Quatro bytes que dizem se a etiqueta está formatada como NDEF e quanto cabe
// nela. Numa NTAG213 de fábrica são `E1 10 12 00`:
//   E1 = está formatada como NDEF
//   10 = versão 1.0 do formato
//   12 = 18, e o tamanho é ESTE NÚMERO VEZES 8 → 144 bytes
//   00 = pode ler e pode gravar
//
// ⚠️ NUNCA SE ESCREVE NESTA PÁGINA. Ela já vem certa de fábrica, os bits dela só
// mudam num sentido (com OR) e a mudança é IRREVERSÍVEL. Aqui só se lê.
const CC_FORMATADA = 0xe1
const CC_DE_FABRICA_DA_NTAG213 = [0xe1, 0x10, 0x12, 0x00]

export function conferirCapabilityContainer(pagina3) {
  const bytes = bytesLidos(pagina3)
  const nada = { formatada: false, deFabrica: false, bytesDeMemoria: 0, podeGravar: false }
  if (bytes.length < BYTES_POR_PAGINA) {
    return {
      ...nada,
      aviso: 'Não li os 4 bytes da página 3 desta etiqueta. '
        + 'Encoste a etiqueta de novo e segure parada.',
    }
  }

  const [marca, versao, tamanho, acesso] = bytes
  if (marca !== CC_FORMATADA) {
    return {
      ...nada,
      aviso: 'Esta etiqueta não está formatada como NDEF (a página 3 não começa com E1). '
        + 'Use uma etiqueta NTAG213 nova, do jeito que vem de fábrica.',
    }
  }

  // O quarto byte tem duas metades: a primeira manda no ler, a segunda no
  // gravar. Zero é liberado; F é fechado. Etiqueta fechada para gravação não
  // volta atrás — e o operador que insiste nela joga fora etiqueta boa achando
  // que o leitor quebrou.
  const podeGravar = (acesso & 0x0f) === 0x00
  const deFabrica = CC_DE_FABRICA_DA_NTAG213.every((b, i) => b === bytes[i])
  return {
    formatada: true,
    deFabrica,
    versao,
    bytesDeMemoria: tamanho * 8,
    podeGravar,
    aviso: podeGravar
      ? ''
      : 'Esta etiqueta está travada: só dá para ler, nunca mais gravar. Use outra.',
  }
}
