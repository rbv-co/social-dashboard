// A ÚNICA PORTA PARA O LEITOR DE MESA, DO LADO DA TELA.
//
// Este arquivo é o IRMÃO de `gravador-nfc.js`, e tem a mesma forma de propósito:
// lá o mundo de fora é o `NDEFReader` do Chrome do Android, aqui é o
// `window.gravadorDeMesa` que o programa da janela pendura. Nos dois casos o
// mundo de fora entra por INJEÇÃO — é o que permite ao teste produzir de
// propósito o que ninguém produz de propósito na bancada: a etiqueta que sai no
// meio, a resposta que voltou pela metade, a etiqueta que já tem outra peça.
//
// SE ESTE ARQUIVO CRESCER PARA ALÉM DE "FALAR COM A JANELA", ELE ESTÁ ERRADO.
// A sequência (ler, decidir, gravar, conferir, marcar) é da tela, como já é no
// caminho do celular. Aqui mora só a travessia.
//
// O QUE FICA DO OUTRO LADO: um programa Electron que empresta o leitor ACR122U
// para esta tela. Ele NÃO aceita comando cru — a superfície é estreita de
// propósito (`listarLeitores`, `conectar`, `lerPaginas`, `escreverPagina`,
// `desconectar`), e quem monta os bytes do APDU é o motor, do lado do programa,
// que já confere tamanho e faixa de página antes do cabo.
import {
  planoDeGravacao,
  planoDeApagamento,
  enderecoNaEtiqueta,
  conferirCapabilityContainer,
  PRIMEIRA_PAGINA,
  ULTIMA_PAGINA,
  BYTES_DE_USUARIO,
} from './ndef-para-ntag213.js'

const BYTES_POR_PAGINA = 4
export const PAGINA_DO_CAPABILITY_CONTAINER = 3

// A MARCA QUE SEPARA "NÃO ESCREVI NADA" DE "PAREI NO MEIO". Quem lê isto é a
// sequência, e é ela que decide se manda a bancada separar a etiqueta. Etiqueta
// intacta mandada para o lixo é o mesmo estrago de sempre, ao contrário.
export const marcarComoIntacta = (erro) => Object.assign(erro, { nadaFoiEscrito: true })
const intacta = marcarComoIntacta
// A NTAG213 devolve no máximo 4 páginas por leitura. Os 144 bytes do usuário
// custam 9 leituras — meio segundo na bancada, e é o preço de saber com certeza
// se a etiqueta já tem dono.
const BYTES_POR_LEITURA = 16

// A superfície mínima que prova que o programa está do outro lado. Conferir só
// o objeto não basta: `window.gravadorDeMesa = {}` — de uma extensão, de um
// teste esquecido, de qualquer coisa — acenderia o modo na tela e a primeira
// gravação morreria com "não é função", com a bolsa em cima da mesa.
const O_QUE_A_JANELA_PRECISA_TER = ['conectar', 'lerPaginas', 'escreverPagina', 'desconectar']

export function temLeitorDeMesa(janela = globalThis) {
  const ponte = janela?.gravadorDeMesa
  return Boolean(ponte) && O_QUE_A_JANELA_PRECISA_TER.every((n) => typeof ponte[n] === 'function')
}

// ── AS FRASES ──────────────────────────────────────────────────────────────
// A tradução de verdade mora no programa, junto dos códigos do Windows: é lá
// que se sabe a diferença entre "não há leitor", "leitor tomado por outro
// programa" e "o serviço não subiu". O que chega aqui já é frase de bancada, e
// esta função só garante que NADA passe sem frase.
//
// ⚠️ NENHUMA FRASE DE PROBLEMA DO LEITOR PODE MANDAR TROCAR A ETIQUETA. É a
// mesma cicatriz do `InvalidStateError` em `gravador-nfc.js`: quando o problema
// é do leitor, a etiqueta está boa — e quem troca etiqueta boa joga bolsa fora,
// uma atrás da outra, sem entender por quê.
const SEM_RECADO = 'Não consegui falar com o leitor de mesa. '
  + 'Desligue e ligue o cabo USB do leitor e tente de novo.'

// O serviço de cartão do Windows sobe SOB DEMANDA, e a primeira conexão de todo
// turno pega ele levantando. O motor já tenta de novo sozinho — este código não
// deveria chegar até aqui. Se um dia chegar, a pessoa lê uma frase, nunca
// `0x8010001D`, que não diz nada a quem está com uma bolsa na mão.
const CODIGO_CRU = /^\s*0x[0-9a-f]{1,8}\s*$/i

// ── QUANDO OFERECER O BOTAO DE RELIGAR ─────────────────────────────────────
//
// ⚠️ SO NO ERRO, e so no erro CERTO (pedido do dono em 07/09/2026). Um botao de
// "religar o leitor" sempre visivel convida a apertar quando nada esta errado —
// e ele abre a janelinha de autorizacao do Windows, que nao pode virar rotina.
//
// E nao e em QUALQUER erro: "encoste a etiqueta" ou "a etiqueta se mexeu" nao
// tem nada a ver com o servico do Windows, e oferecer o conserto ali ensina a
// pessoa a apertar o botao errado quando o problema e outro.
const FRASES_QUE_PEDEM_RELIGAR = [
  /Cartão Inteligente/i,
  /serviço.*não (está rodando|subiu)/i,
  /serviço.*parou/i,
]

export function pedeParaReligar(frase) {
  const texto = String(frase ?? '')
  if (!texto.trim()) return false
  return FRASES_QUE_PEDEM_RELIGAR.some((r) => r.test(texto))
}

// O programa sabe religar? Versoes antigas do `.exe` nao sabem, e a tela e a
// MESMA para todas — perguntar antes evita oferecer um botao que nao faz nada.
export function sabeReligar(janela = globalThis) {
  return typeof janela?.gravadorDeMesa?.religarOServico === 'function'
}

export async function religarOLeitor(janela = globalThis) {
  if (!sabeReligar(janela)) {
    return { ok: false, frase: 'Esta versão do programa não sabe religar o leitor sozinha. '
      + 'Abra "Serviços" no Windows, procure "Cartão Inteligente" e clique em Iniciar.' }
  }
  try {
    return { ok: true, frase: String(await janela.gravadorDeMesa.religarOServico() || '').trim()
      || 'Pronto. Encoste a etiqueta e tente de novo.' }
  } catch (erro) {
    return { ok: false, frase: traduzirFalha(erro) }
  }
}

export function traduzirFalha(erro) {
  const recado = String(erro?.message ?? erro ?? '').trim()
  if (!recado || CODIGO_CRU.test(recado)) return SEM_RECADO
  return recado
}

// ── A PORTA ────────────────────────────────────────────────────────────────
export function criarGravadorDeMesa({ janela = globalThis } = {}) {
  if (!temLeitorDeMesa(janela)) return null
  const ponte = janela.gravadorDeMesa

  // Toda travessia passa por aqui, para que NENHUMA falha do outro lado chegue
  // à tela como um erro sem frase.
  async function pedir(nome, ...argumentos) {
    try {
      return await ponte[nome](...argumentos)
    } catch (erro) {
      throw new Error(traduzirFalha(erro))
    }
  }

  // ⚠️ ESTOURA, NUNCA DEVOLVE MENOS. Devolver "o que deu para ler" seria
  // devolver meia verdade, e meia verdade aqui vira "etiqueta em branco" —
  // que é a resposta que autoriza gravar por cima de uma bolsa que já tem dono.
  async function lerExatamente(pagina, quantosBytes) {
    const bytes = await pedir('lerPaginas', pagina, quantosBytes)
    if (!Array.isArray(bytes) && !ArrayBuffer.isView(bytes)) {
      throw new Error(
        `A leitura da página ${pagina} não voltou em bytes. `
        + 'Ponha a etiqueta de novo em cima do leitor, no meio, e segure parada.',
      )
    }
    const lidos = Array.from(bytes)
    if (lidos.length !== quantosBytes) {
      throw new Error(
        `A leitura trouxe ${lidos.length} de ${quantosBytes} bytes da página ${pagina}. `
        + 'Ponha a etiqueta de novo em cima do leitor, no meio, e segure parada.',
      )
    }
    return lidos
  }

  return {
    async listarLeitores() {
      const achados = await pedir('listarLeitores')
      return Array.isArray(achados) ? achados : []
    },

    // CONECTAR É ESPERAR A ETIQUETA: sem etiqueta encostada o Windows recusa a
    // conexão, e é assim que o programa sabe que ainda não puseram nenhuma. A
    // espera, e a segunda tentativa do serviço que sobe sob demanda, são de lá.
    async conectar(nome = null) {
      return pedir('conectar', nome)
    },

    // A ETIQUETA INTEIRA, e não só o começo: um endereço nosso cabe nos
    // primeiros 60 bytes, mas uma etiqueta gravada por outro aplicativo põe o
    // registro do Android na frente e empurra o endereço para adiante. Ler pela
    // metade acharia "nada" numa etiqueta ocupada — e nada é a resposta perigosa.
    //
    // Devolve os TRÊS: o endereço (para decidir), a memória (para montar o
    // plano em cima do que está lá) e o Capability Container (para saber se a
    // etiqueta ainda aceita gravação).
    async lerAEtiqueta() {
      const capability = conferirCapabilityContainer(
        await lerExatamente(PAGINA_DO_CAPABILITY_CONTAINER, BYTES_POR_PAGINA),
      )
      const memoria = []
      const paginasPorVez = BYTES_POR_LEITURA / BYTES_POR_PAGINA
      for (let p = PRIMEIRA_PAGINA; p <= ULTIMA_PAGINA; p += paginasPorVez) {
        const quantos = Math.min(BYTES_POR_LEITURA, (ULTIMA_PAGINA - p + 1) * BYTES_POR_PAGINA)
        memoria.push(...await lerExatamente(p, quantos))
      }
      // Cinto e suspensório: cada leitura já veio inteira, mas quem grava por
      // cima de uma bolsa é a soma, não o pedaço.
      if (memoria.length !== BYTES_DE_USUARIO) {
        throw new Error(
          `A leitura trouxe ${memoria.length} de ${BYTES_DE_USUARIO} bytes desta etiqueta. `
          + 'Ponha a etiqueta de novo em cima do leitor e segure parada.',
        )
      }
      return { endereco: enderecoNaEtiqueta(memoria), memoria, capability }
    },

    // GRAVA O PLANO MONTADO EM CIMA DA MEMÓRIA QUE ACABOU DE SER LIDA.
    //
    // ⚠️ A MEMÓRIA É OBRIGATÓRIA, e o motivo foi medido na bancada em
    // 01/09/2026: um plano montado supondo etiqueta de fábrica, gravado numa
    // etiqueta reaproveitada, fez o leitor responder `90 00` DOZE VEZES e a
    // etiqueta ficou com uma mensagem quebrada, ilegível para o celular. A
    // NTAG213 também não vem em branco de fábrica: as páginas 4 e 5 trazem um
    // Lock Control TLV de 5 bytes, que atravessa a página 4 para dentro da 5.
    async gravar(endereco, memoriaAtual) {
      if (!Array.isArray(memoriaAtual) && !ArrayBuffer.isView(memoriaAtual)) {
        throw intacta(new Error(
          'Não dá para gravar sem ter lido a etiqueta antes: o plano de gravação se monta '
          + 'em cima do que já está nela. Leia a etiqueta e tente de novo.',
        ))
      }
      // ⚠️ O PLANO SAI INTEIRO ANTES DA PRIMEIRA ESCRITA, e a falha dele é
      // MARCADA COMO `nadaFoiEscrito`. A diferença custa uma etiqueta boa por
      // vez: quem para NO MEIO deixa a etiqueta pela metade e a bancada tem de
      // separá-la; quem nem chegou a montar o plano deixou a etiqueta INTACTA, e
      // mandar jogá-la fora é jogar fora etiqueta boa.
      let plano
      try {
        plano = planoDeGravacao(endereco, memoriaAtual)
      } catch (erro) {
        throw intacta(erro)
      }
      for (const { pagina, bytes } of plano) {
        await pedir('escreverPagina', pagina, bytes)
      }
      return plano.length
    },

    // APAGAR — a mesma forma do gravar, com o plano da porta separada.
    //
    // ⚠️ A MEMÓRIA TAMBÉM É OBRIGATÓRIA AQUI, e pelo mesmo motivo: o plano se
    // monta em cima do Lock Control que a etiqueta já tem. Apagar às cegas
    // escreveria por cima dele.
    //
    // ⚠️ AQUI NÃO EXISTE `nadaFoiEscrito` DEPOIS DA PRIMEIRA PÁGINA, e não
    // precisa: a primeira escrita já é a mensagem vazia, então parar no meio
    // deixa a etiqueta VÁLIDA e em branco — que é justamente o que se queria.
    // Parar antes da primeira escrita deixa a etiqueta como estava.
    async apagar(memoriaAtual) {
      if (!Array.isArray(memoriaAtual) && !ArrayBuffer.isView(memoriaAtual)) {
        throw intacta(new Error(
          'Não dá para apagar sem ter lido a etiqueta antes: o plano se monta em cima do '
          + 'Lock Control que ela já tem. Leia a etiqueta e tente de novo.',
        ))
      }
      let plano
      try {
        plano = planoDeApagamento(memoriaAtual)
      } catch (erro) {
        throw intacta(erro)
      }
      for (const { pagina, bytes } of plano) {
        await pedir('escreverPagina', pagina, bytes)
      }
      return plano.length
    },

    // Soltar a etiqueta é limpeza. Se falhar, a etiqueta já saiu e não há nada a
    // consertar — e estourar aqui esconderia a falha de verdade, que foi antes.
    async desconectar() {
      try { await ponte.desconectar() } catch { /* nada a consertar */ }
    },
  }
}
