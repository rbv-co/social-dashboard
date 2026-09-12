// A ÚNICA PORTA PARA O LEITOR DE MESA.
//
// Todo o resto deste programa é conta pura e se testa com `node --test`. Isto
// aqui não: falar com o ACR122U depende do serviço de Cartão Inteligente do
// Windows. Por isso a PONTE entra por INJEÇÃO — do mesmo jeito que
// `gravador-nfc.js` recebe a `janela` — e o teste passa uma de mentira para
// conseguir produzir de propósito o que ninguém consegue produzir de propósito
// na bancada: a etiqueta que sai no meio, o leitor ocupado por outro programa,
// o serviço do Windows parado e a resposta que voltou pela metade.
//
// SE ESTE ARQUIVO CRESCER PARA ALÉM DE "FALAR COM O CHIP", ELE ESTÁ ERRADO.
// Aqui não mora regra de peça, nem fila, nem banco: mora o cabo.
//
// ⚠️ O QUE MUDOU EM 01/09/2026, E POR QUÊ: do outro lado havia uma biblioteca
// que COMPILA na hora do `npm install`, e compilar exige ferramentas de
// programação num computador que é de bancada. Decisão do dono: nada de
// instalar na bancada. No lugar dela entrou `ponte-do-powershell.js` — o
// `powershell.exe` já vem no Windows e fala com o `winscard.dll` sem instalar
// nada. Foi assim que a etiqueta de verdade foi gravada à mão.
// A INTERFACE DESTE ARQUIVO NÃO MUDOU: quem chama (gravar-uma-peca.js) não sabe
// e não precisa saber o que há do outro lado. Só `listarLeitores` virou
// assíncrono, porque agora a resposta atravessa um processo.
import {
  apduDeEscrita,
  apduDeLeitura,
  APDU_NUMERO_DE_SERIE,
  APDU_VERSAO_DO_LEITOR,
  lerResposta,
  emHex,
  conferirApdu,
} from './comandos-do-acr122u.js'
import {
  criarPonteDoPowershell,
  traduzirCodigoDoPcsc,
  codigoDoPcsc,
  CODIGOS_QUE_NAO_PASSAM_ESPERANDO,
} from './ponte-do-powershell.js'

// ── AS FRASES ──────────────────────────────────────────────────────────────
// O Windows fala em código hexadecimal; quem grava está de pé na bancada com
// uma etiqueta na mão e precisa saber O QUE FAZER com ela. A tradução mora na
// ponte, junto dos códigos; aqui só se garante que NADA passe sem frase.
//
// ⚠️ NENHUMA FRASE DE PROBLEMA DO LEITOR PODE MANDAR TROCAR A ETIQUETA. É a
// mesma cicatriz do `InvalidStateError` em `gravador-nfc.js`: quando o leitor é
// que está ocupado, a etiqueta está boa — e o operador que troca etiqueta boa
// joga bolsa fora, uma atrás da outra, sem entender por quê.
export function traduzirFalha(erro) {
  if (codigoDoPcsc(erro?.codigo || erro?.message)) {
    return traduzirCodigoDoPcsc(erro?.codigo || erro?.message)
  }
  const msg = String(erro?.message ?? '').trim()
  if (msg) return msg
  return 'Não consegui falar com o leitor (motivo desconhecido). '
    + 'Desligue e ligue o cabo USB e tente de novo.'
}

// ── O SERVIÇO DO WINDOWS SOBE SOB DEMANDA ──────────────────────────────────
//
// ⚠️ MEDIDO NA BANCADA EM 01/09/2026, com a etiqueta parada em cima do leitor:
//
//     1 CONECTAR ...
//     #1 ERRO SCardConnect 0x8010001D
//     1 CONECTAR ...        (o MESMO comando, de novo)
//     #1 OK
//
// `0x8010001D` é o Windows dizendo que o serviço de cartão ainda não estava de
// pé. Ele NÃO fica parado por defeito: ele sobe SOB DEMANDA, e a primeira
// chamada depois de abrir o processo paga por isso.
//
// Sem tentar de novo sozinho, A PRIMEIRA ETIQUETA DE TODO TURNO FALHA — e o
// operador aprende a "tentar duas vezes". Superstição nasce de defeito não
// consertado, e depois esconde falha de verdade: no dia em que o leitor estiver
// mesmo ruim, ele vai tentar duas vezes, dar errado, e não contar a ninguém.
const CODIGOS_DO_ARRANQUE = new Set(['0X8010001D', '0X8010001E'])

// ⚠️ O TETO É PEQUENO E A PAUSA É CURTA, DE PROPÓSITO. Serviço que não sobe em
// três tentativas não vai subir sozinho — aí a frase manda a pessoa abrir os
// Serviços do Windows, em vez de o programa ficar tentando calado para sempre.
// E o arranque é OUTRA COISA da espera pela etiqueta: aquela é longa porque o
// operador está pegando a próxima bolsa; esta é de instantes, porque é o Windows
// levantando um serviço. Misturar as duas faria uma recusa rápida virar
// travamento, e esconderia o leitor tomado por outro programa atrás de
// tentativas caladas.
const TENTATIVAS_DE_ARRANQUE = 3
const PAUSA_DO_ARRANQUE = 300

const dormirDeVerdade = (ms) => new Promise((r) => { setTimeout(r, ms) })

export function criarLeitorDeMesa({
  ponte,
  dormir = dormirDeVerdade,
  agora = () => Date.now(),
} = {}) {
  if (typeof ponte?.transmitir !== 'function' || typeof ponte?.listarLeitores !== 'function') {
    throw new Error(
      'Sem a ponte com o PowerShell não dá para falar com o ACR122U. '
      + 'Este programa só grava no Windows, onde o `powershell.exe` fala com o leitor.',
    )
  }

  async function listarLeitores() {
    return ponte.listarLeitores()
  }

  // ESCOLHER O LEITOR. Com um só, é ele. Com vários, o que se chama ACR122 — é o
  // aparelho desta bancada. Com vários desconhecidos, PARA e diz os nomes:
  // chutar um leitor no escuro é mandar comando de gravação para um aparelho que
  // ninguém sabe qual é.
  async function escolher(nome) {
    const achados = await listarLeitores()
    if (!achados.length) {
      throw new Error(traduzirCodigoDoPcsc('0x8010002E'))
    }
    if (nome) {
      if (achados.includes(nome)) return nome
      throw new Error(
        `Não achei o leitor "${nome}". Os que o Windows enxerga agora são:\n`
        + achados.map((r) => `  · ${r}`).join('\n'),
      )
    }
    if (achados.length === 1) return achados[0]
    const acr = achados.find((r) => /ACR ?122/i.test(r))
    if (acr) return acr
    throw new Error(
      'Há mais de um leitor ligado e nenhum deles se chama ACR122U. '
      + 'Diga qual usar, entre estes:\n'
      + achados.map((r) => `  · ${r}`).join('\n'),
    )
  }

  // CONECTAR É ESPERAR A ETIQUETA. Sem etiqueta encostada o PC/SC recusa a
  // conexão, e é exatamente assim que se sabe que ainda não encostaram:
  // tenta-se de novo, meio segundo por vez, como o teste de bancada em
  // PowerShell fez em 01/09/2026.
  async function conectar({ nome = null, segundosDeEspera = 15, intervalo = 500 } = {}) {
    const escolhido = await escolher(nome)
    const prazo = agora() + segundosDeEspera * 1000
    let arranques = 0
    let ultima = null

    for (;;) {
      try {
        await ponte.conectar(escolhido)
        return criarSessao(escolhido)
      } catch (erro) {
        ultima = erro
        const codigo = codigoDoPcsc(erro?.codigo || erro?.message)

        // O SERVIÇO SUBINDO: tenta de novo, pouquíssimas vezes, com pausa curta.
        // Estas tentativas NÃO contam contra o prazo da etiqueta — quem esperou
        // aqui foi o Windows, não a pessoa.
        if (CODIGOS_DO_ARRANQUE.has(codigo) && arranques < TENTATIVAS_DE_ARRANQUE - 1) {
          arranques += 1
          await dormir(PAUSA_DO_ARRANQUE)
          continue
        }

        // ESPERAR NÃO CONSERTA TUDO. Leitor ausente e leitor tomado por outro
        // programa não se resolvem sozinhos em 15 segundos; e o serviço que não
        // subiu em três tentativas também não vai subir.
        if (CODIGOS_QUE_NAO_PASSAM_ESPERANDO.has(codigo)) {
          throw new Error(traduzirFalha(erro))
        }
        // Processo morto também não se conserta esperando: sem o PowerShell não
        // há a quem perguntar.
        if (erro?.motivo === 'processo-morreu') throw new Error(traduzirFalha(erro))
        if (agora() >= prazo) break
        await dormir(intervalo)
      }
    }
    throw new Error(
      `Nenhuma etiqueta encostada em ${segundosDeEspera} segundos. `
      + 'Ponha a etiqueta em cima do leitor, no meio, e segure parada. '
      + `(${ultima?.message || 'sem detalhe'})`,
    )
  }

  function criarSessao(nome) {
    let ligada = true

    // TODA conversa com a etiqueta passa por aqui: monta, manda, lê o status.
    // O `bytesEsperados` é o que separa "li tudo" de "li metade" — e meia
    // leitura NUNCA pode virar autorização para gravar por cima.
    async function conversar(apdu, { bytesEsperados = null } = {}) {
      if (!ligada) {
        throw new Error(
          'Esta etiqueta já foi desconectada. Encoste-a de novo para falar com ela de novo.',
        )
      }
      // ⚠️ NADA DE COMANDO TORTO NO CABO. Um byte a mais fez o leitor responder
      // `63 00` na bancada, e duas rodadas foram gastas procurando defeito na
      // etiqueta. A conferência é aqui, na saída, porque é aqui que passa TUDO.
      conferirApdu(apdu)
      let bruto
      try {
        bruto = await ponte.transmitir(apdu)
      } catch (erro) {
        // ⚠️ FALHA ESTOURA, NUNCA VIRA RESPOSTA VAZIA. Devolver `[]` aqui faria o
        // tradutor não achar endereço nenhum, a decisão virar 'vazia', e a
        // gravação passar por cima de uma bolsa que já tem dono.
        throw new Error(traduzirFalha(erro))
      }
      const r = lerResposta(bruto, { bytesEsperados })
      if (!r.ok) throw new Error(r.aviso)
      return r.dados
    }

    return {
      nome,

      // Devolve EXATAMENTE `quantosBytes` bytes, ou levanta erro. Nunca menos,
      // nunca "o que deu".
      async lerPaginas(pagina, quantosBytes) {
        return conversar(apduDeLeitura(pagina, quantosBytes), { bytesEsperados: quantosBytes })
      },

      // A etiqueta responde só `90 00` a uma escrita boa. Se vier dado junto,
      // não foi a escrita que respondeu — e dar isso por gravado é o começo de
      // uma bolsa com a identidade errada.
      async escreverPagina(pagina, bytes) {
        await conversar(apduDeEscrita(pagina, bytes), { bytesEsperados: 0 })
        return true
      },

      async numeroDeSerie() {
        return emHex(await conversar(APDU_NUMERO_DE_SERIE))
      },

      // A ÚNICA RESPOSTA QUE NÃO TERMINA EM `90 00`. O manual da ACS diz que a
      // versão do firmware volta como texto puro, sem status. Como firmware
      // varia, aqui se aceitam as duas formas em vez de escolher uma e a versão
      // sumir da tela justamente no aparelho que a gente precisava identificar
      // (o ACR122U original responde `ACR122U220`; a cópia se chama RFCARD).
      async versaoDoLeitor() {
        if (!ligada) throw new Error('O leitor já foi desconectado.')
        let bytes
        try {
          bytes = await ponte.transmitir(conferirApdu(APDU_VERSAO_DO_LEITOR))
        } catch (erro) {
          throw new Error(traduzirFalha(erro))
        }
        const semStatus = (bytes.length > 2 && bytes.at(-2) === 0x90 && bytes.at(-1) === 0x00)
          ? bytes.slice(0, -2)
          : bytes
        return Buffer.from(semStatus).toString('ascii').trim()
      },

      async desconectar() {
        if (!ligada) return
        ligada = false
        try {
          await ponte.desconectar()
        } catch {
          // Soltar a etiqueta é limpeza; se falhar, a etiqueta já saiu e não há
          // nada a consertar. Levantar erro aqui esconderia a falha de verdade,
          // que aconteceu antes.
        }
      },
    }
  }

  async function fechar() {
    try { await ponte.fechar?.() } catch { /* mesma razão do desconectar */ }
  }

  return { listarLeitores, conectar, fechar }
}

// O LEITOR DE VERDADE, com o PowerShell do outro lado. Ele prova que o outro
// lado está vivo (`iniciar`) ANTES de qualquer etiqueta entrar na história: sem
// isto, um PowerShell bloqueado só apareceria na primeira gravação, com uma
// bolsa de couro em cima da mesa.
export async function criarLeitorDeVerdade(opcoes = {}) {
  const ponte = criarPonteDoPowershell(opcoes)
  await ponte.iniciar()
  return criarLeitorDeMesa({ ponte, ...opcoes })
}
