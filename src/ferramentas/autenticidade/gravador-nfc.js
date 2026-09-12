// A ÚNICA PORTA PARA O NFC DO NAVEGADOR.
//
// Todo o resto do painel é conta pura e se testa com `node --test`. Isto aqui
// não: `NDEFReader` só existe no Chrome do Android. Por isso ele entra por
// INJEÇÃO — o teste passa um de mentira e consegue simular etiqueta pequena
// demais, NFC desligado e etiqueta que saiu de perto no meio.
// Se este arquivo crescer para além de "falar com o chip", ele está errado.

export function temSuporte(janela = globalThis) {
  return typeof janela?.NDEFReader === 'function'
}

// Uma mensagem NFC tem vários registros; o nosso é o de endereço.
export function urlDaMensagem(mensagem) {
  for (const registro of mensagem?.records || []) {
    if (registro.recordType !== 'url' && registro.recordType !== 'absolute-url') continue
    try {
      return new TextDecoder(registro.encoding || 'utf-8').decode(registro.data)
    } catch { return '' }
  }
  return ''
}

// O navegador fala em nome de erro; quem grava está de pé na fábrica.
const FRASES = {
  NotSupportedError: 'Esta etiqueta não tem espaço para o endereço, ou não aceita gravação. Troque a etiqueta.',
  NotReadableError: 'Não consegui falar com a etiqueta. Ligue o NFC nos ajustes do celular e tente de novo.',
  NetworkError: 'A etiqueta saiu de perto no meio. Encoste de novo e segure parado.',
  AbortError: 'Passou do tempo. Encoste de novo e segure parado.',
  NotAllowedError: 'O navegador não deu permissão de NFC. Recarregue a página e aceite quando ele perguntar.',
  // Sai quando um `scan()` anterior ficou pendurado no mesmo leitor. A frase
  // NÃO pode mandar trocar a etiqueta: a etiqueta está boa, quem está ocupado é
  // o leitor — e operador que troca etiqueta boa joga bolsa fora.
  InvalidStateError: 'O leitor de NFC ficou ocupado de uma leitura anterior. A etiqueta está boa — recarregue a página e grave esta MESMA etiqueta de novo.',
}

export function traduzirFalha(erro) {
  const nome = erro?.name || ''
  return FRASES[nome]
    || `Não consegui gravar (${nome || 'motivo desconhecido'}). Encoste de novo; se repetir, troque a etiqueta.`
}

export function criarGravador({ janela = globalThis } = {}) {
  if (!temSuporte(janela)) return null
  const leitor = new janela.NDEFReader()

  return {
    // Lê UMA etiqueta e para. O tempo existe porque, sem ele, a tela ficaria
    // esperando para sempre alguém que já foi embora.
    //
    // O AbortController NÃO é enfeite. A tela lê duas vezes no MESMO leitor —
    // antes de gravar e depois de gravar — e a especificação manda o navegador
    // recusar o segundo `scan()`: "If reader is already in the activated reader
    // objects, then reject p with an InvalidStateError". Sem isto, o passo do
    // LER DEPOIS recusava na hora, a tela mandava trocar a etiqueta, e o
    // operador jogava fora etiqueta boa. Abortando o próprio sinal ao terminar
    // — no sucesso E na falha — o leitor sai da lista de ativos e a leitura
    // seguinte é aceita. O mesmo abort tira do ar os ouvintes desta leitura,
    // que antes ficavam empilhados no leitor.
    async lerUmaVez({ milissegundos = 8000 } = {}) {
      const parada = new AbortController()
      const { signal } = parada
      try {
        return await new Promise((resolver, recusar) => {
          const relogio = setTimeout(() => {
            recusar(Object.assign(new Error('sem etiqueta'), { name: 'AbortError' }))
          }, milissegundos)
          leitor.addEventListener('reading', (evento) => {
            clearTimeout(relogio)
            resolver(urlDaMensagem(evento?.message))
          }, { signal })
          leitor.addEventListener('readingerror', () => {
            clearTimeout(relogio)
            recusar(Object.assign(new Error('leitura falhou'), { name: 'NotReadableError' }))
          }, { signal })
          Promise.resolve(leitor.scan({ signal })).catch((e) => { clearTimeout(relogio); recusar(e) })
        })
      } finally {
        parada.abort()
      }
    },

    // GRAVA UM REGISTRO DE ENDEREÇO, nunca a string crua.
    // `write('https://…')` com uma string vira, pela especificação do Web NFC,
    // um registro `recordType: 'text'`. E aí duas coisas quebram de uma vez:
    //  1. `urlDaMensagem` (aqui em cima) só lê `url` e `absolute-url` — a
    //     leitura de volta devolveria SEMPRE '', `conferirLeitura` diria
    //     'vazia', nunca 'confere', e a peça nunca seria marcada;
    //  2. e uma etiqueta com registro de texto não abre NADA quando a cliente
    //     encosta o celular no forro da bolsa — ela conclui que a bolsa é falsa.
    async gravar(endereco) {
      await leitor.write({ records: [{ recordType: 'url', data: endereco }] })
    },

    // APAGA A ETIQUETA — mensagem NDEF vazia.
    //
    // ⚠️ `records: []` NÃO É "não escreva nada": pela especificação do Web NFC é
    // escrever uma MENSAGEM VAZIA por cima do que estava lá, que é exatamente o
    // estado em que a etiqueta sai de fábrica. É a mesma coisa que o leitor de
    // mesa faz montando as páginas na mão.
    //
    // ⚠️ QUEM CHAMA ISTO PRECISA TER CONFIRMADO ANTES. Aqui não há pergunta,
    // não há desfazer, e a etiqueta pode já estar costurada dentro de uma bolsa.
    async apagar() {
      await leitor.write({ records: [] })
    },

    // ⚠️ PERMANENTE. Etiqueta travada nunca mais se regrava. A tela só chama
    // isto com o interruptor ligado, e o interruptor nasce desligado.
    // O primeiro teste com etiqueta de verdade tem de ser numa descartável.
    async travar() {
      await leitor.makeReadOnly()
    },
  }
}
