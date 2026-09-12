// GRAVAR CINQUENTA, NÃO UMA — conta pura, sem leitor, sem banco, sem arquivo.
//
// Uma etiqueta é uma decisão. Cinquenta é um turno de trabalho, com gente que
// se distrai, etiqueta que sai da caixa errada, internet que cai e programa que
// fecha. Esta é a peça que cuida disso — e nada aqui fala com hardware nem com
// rede, para que cada uma dessas situações se prove com `node --test` em vez de
// esperar acontecer na bancada com bolsa de couro em cima da mesa.
//
// AS ESCOLHAS, e por que cada uma é assim:
//
// 1. A PRÓXIMA SAI DE `proximaPorGravar` (lotes.js), nunca de um contador aqui.
//    Contador é cópia, e cópia envelhece: se alguém gravar uma peça pelo
//    celular enquanto este programa está aberto, o contador mandaria regravar.
//
// 2. FALHOU, A PEÇA CONTINUA SENDO A PRÓXIMA. A fila NUNCA pula sozinha. Pular
//    deixa um buraco na série que só aparece no fim do lote, com as etiquetas
//    já costuradas dentro das bolsas — e aí ninguém consegue mais dizer qual
//    número ficou de fora. Pular é ato deliberado, com motivo escrito.
//
// 3. TENTAR DE NOVO É PARA O QUE PASSA SOZINHO. Etiqueta que saiu de cima do
//    leitor volta a funcionar na segunda tentativa. Etiqueta com outra peça
//    dentro, ou etiqueta que ficou pela metade, NÃO passa sozinha: aí é trocar
//    de etiqueta, e a peça continua na fila.
//
// 4. TRÊS ETIQUETAS RUINS SEGUIDAS PARAM TUDO. Três não é azar: é a caixa de
//    etiquetas errada, o leitor mal encaixado ou uma remessa ruim. Sem esta
//    parada, o operador queima uma caixa inteira, uma etiqueta por vez, achando
//    que é normal.
//
// 5. GRAVOU E O SISTEMA NÃO REGISTROU: PARA. A etiqueta está no mundo com a
//    peça dentro e o sistema não sabe. Seguir em frente com a internet caída
//    empilharia etiquetas gravadas e não registradas — e elas são fisicamente
//    idênticas, ninguém separa depois. A peça fica em `pendentesDeMarcacao` e
//    NÃO volta para a fila: oferecê-la de novo poria o mesmo código em duas
//    bolsas.
//
// 6. RETOMAR VEM DO BANCO, NÃO DO ARQUIVO. `gravada_em` é a verdade. O
//    instantâneo guarda só o que o banco AINDA NÃO SABE: as pendentes de
//    marcação e as puladas. Guardar "a próxima é a nº 7" seria guardar uma cópia
//    que envelhece.
import { naFila, proximaPorGravar, progressoDoLote } from '../src/ferramentas/autenticidade/lotes.js'

export const ACOES = {
  SEGUIR: 'seguir',
  TENTAR_DE_NOVO: 'tentar-de-novo',
  TROCAR_ETIQUETA: 'trocar-etiqueta',
  PARAR: 'parar',
}

// OS ESTADOS DE `gravarUmaPeca`, e o que cada um faz com a fila.
//
// 'recusada' NÃO está aqui porque ele se divide: recusa por causa da ETIQUETA
// (já tem dono, travada, não formatada) manda trocar de etiqueta; recusa por
// causa da PEÇA (baixada, já gravada) tira a peça da fila. Quem sabe qual é a
// própria peça — por isso a decisão do 'recusada' se faz mais abaixo, olhando
// para os dados dela em vez de para o nome do estado.
const FEITOS = new Set(['gravada', 'ja-era-dela'])
const PASSA_SOZINHO = new Set(['nao-li'])
const ETIQUETA_QUEIMADA = new Set(['falhou-ao-escrever', 'nao-conferiu'])

const codigoDe = (v) => String(v ?? '').trim().toUpperCase()

// Um instantâneo estragado não pode derrubar a bancada: um arquivo cortado pela
// metade (o programa fechou no meio da gravação dele) tem de virar "começa do
// zero", nunca uma exceção no arranque.
function listaDoInstantaneo(valor) {
  return Array.isArray(valor) ? valor.filter((x) => x && codigoDe(x.codigo)) : []
}

export function criarFila({
  pecas = [],
  tentativasPorPeca = 3,
  etiquetasRuinsSeguidas = 3,
  retomandoDe = null,
  agora = () => new Date().toISOString(),
} = {}) {
  const originais = Array.isArray(pecas) ? pecas : []
  const porCodigo = new Map(originais.filter((p) => p && p.codigo).map((p) => [codigoDe(p.codigo), p]))

  // O QUE ESTE PROGRAMA SABE E O BANCO AINDA NÃO. Só isto é estado; o resto se
  // recalcula das peças a cada pergunta.
  const gravadasAqui = new Map()   // código → quando (as que este turno gravou)
  const pendentes = new Map()      // código → { codigo, endereco, quando, frase }
  const puladas = new Map()        // código → { codigo, motivo, quando }
  const registrosDoDiario = []
  let tentativasDaPeca = 0
  let etiquetasRuins = 0
  let parada = null

  // RETOMAR. A peça que o banco JÁ marcou não é mais pendente — insistir nela
  // faria a fila continuar parada por uma dívida que já foi paga. Isto acontece
  // de verdade: a marcação chegou no banco e a resposta é que se perdeu no
  // caminho, ou alguém marcou pelo painel enquanto o programa estava fechado.
  for (const p of listaDoInstantaneo(retomandoDe?.pendentesDeMarcacao)) {
    const codigo = codigoDe(p.codigo)
    if (porCodigo.get(codigo)?.gravada_em) continue
    pendentes.set(codigo, { ...p, codigo })
  }
  for (const p of listaDoInstantaneo(retomandoDe?.puladas)) {
    puladas.set(codigoDe(p.codigo), { ...p, codigo: codigoDe(p.codigo) })
  }

  // A LISTA DE TRABALHO, montada na hora e SEM MEXER NA QUE VEIO. A lista que
  // chega é a que a tela de quem chamou está desenhando; ordená-la ou marcá-la
  // no lugar mexeria na tela dele.
  function comOQueSabemos() {
    return originais.map((p) => {
      const codigo = codigoDe(p?.codigo)
      const quando = gravadasAqui.get(codigo)
      return quando ? { ...p, gravada_em: quando } : p
    })
  }

  // A peça pendente de marcação sai da fila mesmo sem `gravada_em`: ela JÁ TEM
  // uma etiqueta no mundo.
  const disponiveis = () => comOQueSabemos()
    .filter((p) => !puladas.has(codigoDe(p?.codigo)) && !pendentes.has(codigoDe(p?.codigo)))

  function proxima() {
    if (parada) return null
    return proximaPorGravar(disponiveis())
  }

  function anotar(resultado, codigo, acao, frase) {
    registrosDoDiario.push({
      quando: agora(),
      codigo,
      estado: resultado?.estado || '(sem estado)',
      acao,
      frase: frase || resultado?.frase || '',
      endereco: resultado?.endereco || '',
    })
    return { acao, frase: frase || resultado?.frase || '', codigo }
  }

  function pararA(motivo, frase) {
    parada = { motivo, frase, quando: agora() }
    return frase
  }

  function registrar(resultado) {
    const estado = resultado?.estado
    const codigo = codigoDe(resultado?.codigo)
    const peca = porCodigo.get(codigo)

    // RESULTADO QUE NÃO CASA COM O LOTE NÃO É REGISTRADO ÀS CEGAS. Marcar um
    // código que não é deste lote é a mesma cicatriz de `codigosNoTextoDoGravador`
    // (nfc-fila.js): normalmente é o lote errado aberto na tela, e marcar em
    // silêncio esconderia isso.
    if (!peca) {
      return anotar(resultado, codigo, ACOES.PARAR, pararA(
        'peca-de-fora',
        `Chegou um resultado da peça ${codigo || '(sem código)'}, que não é deste lote. `
        + 'Pare e confira se o lote aberto é o certo.',
      ))
    }
    if (!estado) {
      return anotar(resultado, codigo, ACOES.PARAR, pararA(
        'sem-estado',
        `Não entendi o que aconteceu com a peça ${codigo}. Nada foi registrado. `
        + 'Tente de novo e, se repetir, avise.',
      ))
    }

    if (FEITOS.has(estado)) {
      gravadasAqui.set(codigo, agora())
      pendentes.delete(codigo)
      tentativasDaPeca = 0
      etiquetasRuins = 0
      return anotar(resultado, codigo, ACOES.SEGUIR)
    }

    if (estado === 'gravada-sem-marcar') {
      pendentes.set(codigo, {
        codigo,
        endereco: resultado?.endereco || '',
        quando: agora(),
        frase: resultado?.frase || '',
      })
      tentativasDaPeca = 0
      return anotar(resultado, codigo, ACOES.PARAR, pararA(
        'gravada-sem-marcar',
        `A etiqueta da peça ${codigo} JÁ ESTÁ GRAVADA e o sistema não registrou. `
        + 'Guarde essa etiqueta separada e NÃO grave esta peça de novo. '
        + 'A fila fica parada até isso ser resolvido — seguir agora empilharia etiquetas '
        + 'gravadas e não registradas, todas iguais por fora.',
      ))
    }

    if (ETIQUETA_QUEIMADA.has(estado)) {
      etiquetasRuins += 1
      tentativasDaPeca = 0
      if (etiquetasRuins >= etiquetasRuinsSeguidas) {
        return anotar(resultado, codigo, ACOES.PARAR, pararA(
          'etiquetas-ruins',
          `${etiquetasRuins} etiquetas seguidas não aceitaram a gravação. Isso não é azar: `
          + 'confira se a caixa de etiquetas é a certa (NTAG213 nova) e se o leitor está bem '
          + 'encaixado na USB. A fila fica parada até alguém olhar.',
        ))
      }
      return anotar(resultado, codigo, ACOES.TROCAR_ETIQUETA)
    }

    if (PASSA_SOZINHO.has(estado)) {
      tentativasDaPeca += 1
      if (tentativasDaPeca < tentativasPorPeca) {
        return anotar(resultado, codigo, ACOES.TENTAR_DE_NOVO,
          `${resultado?.frase || ''} Encoste a MESMA etiqueta de novo `
          + `(tentativa ${tentativasDaPeca + 1} de ${tentativasPorPeca}).`)
      }
      tentativasDaPeca = 0
      etiquetasRuins += 1
      if (etiquetasRuins >= etiquetasRuinsSeguidas) {
        return anotar(resultado, codigo, ACOES.PARAR, pararA(
          'etiquetas-ruins',
          `${etiquetasRuins} etiquetas seguidas não deram certo. Confira a caixa de etiquetas `
          + 'e o encaixe do leitor na USB antes de continuar.',
        ))
      }
      return anotar(resultado, codigo, ACOES.TROCAR_ETIQUETA,
        `Não deu para ler esta etiqueta em ${tentativasPorPeca} tentativas. `
        + `Separe ela e pegue outra — a peça ${codigo} continua sendo a próxima.`)
    }

    // 'recusada' — quem manda aqui são os dados da PEÇA, não o nome do estado.
    // Peça baixada ou já gravada não volta para a fila; etiqueta ruim, sim.
    if (!naFila(peca) || peca.gravada_em) {
      puladas.set(codigo, {
        codigo,
        motivo: resultado?.frase || 'a peça saiu da fila',
        quando: agora(),
      })
      tentativasDaPeca = 0
      return anotar(resultado, codigo, ACOES.SEGUIR)
    }
    etiquetasRuins += 1
    if (etiquetasRuins >= etiquetasRuinsSeguidas) {
      return anotar(resultado, codigo, ACOES.PARAR, pararA(
        'etiquetas-ruins',
        `${etiquetasRuins} etiquetas seguidas foram recusadas. Provavelmente a caixa de `
        + 'etiquetas já foi usada. Pare e confira antes de gastar mais.',
      ))
    }
    return anotar(resultado, codigo, ACOES.TROCAR_ETIQUETA)
  }

  // PULAR EXIGE MOTIVO ESCRITO. Um buraco na série sem explicação vira mistério
  // em três meses, quando alguém for procurar a bolsa de número 7 e não achar.
  function pular(codigo, motivo) {
    const chave = codigoDe(codigo)
    const texto = String(motivo ?? '').trim()
    if (!texto) {
      throw new Error(
        'Escreva o motivo de pular esta peça. Sem ele, ninguém consegue explicar em três meses '
        + 'por que a série tem um buraco.',
      )
    }
    if (!porCodigo.has(chave)) throw new Error(`A peça ${chave} não é deste lote.`)
    puladas.set(chave, { codigo: chave, motivo: texto, quando: agora() })
    registrosDoDiario.push({ quando: agora(), codigo: chave, estado: 'pulada', acao: ACOES.SEGUIR, frase: texto })
  }

  function despular(codigo) {
    puladas.delete(codigoDe(codigo))
  }

  // A MARCAÇÃO ENFIM DEU CERTO. A peça deixa de ser pendente e entra como
  // gravada — a etiqueta dela já estava no mundo desde antes.
  function marcacaoResolvida(codigo) {
    const chave = codigoDe(codigo)
    if (!pendentes.delete(chave)) return false
    gravadasAqui.set(chave, agora())
    return true
  }

  return {
    proxima,
    acabou: () => !parada && proxima() === null,
    progresso: () => progressoDoLote(comOQueSabemos()),
    registrar,
    pular,
    despular,
    puladas: () => [...puladas.values()],
    pendentesDeMarcacao: () => [...pendentes.values()],
    marcacaoResolvida,
    parada: () => parada,
    // DESTRAVAR É DECISÃO DE GENTE. Ele não conserta nada: só diz que alguém
    // olhou. Por isso zera as contagens mas NÃO tira ninguém de `pendentes`.
    destravar: () => { parada = null; etiquetasRuins = 0; tentativasDaPeca = 0 },
    diario: () => registrosDoDiario.slice(),
    // O INSTANTÁNEO É JSON PURO, para caber num arquivo e voltar depois de o
    // programa fechar. Ele guarda só o que o banco não sabe.
    instantaneo: () => ({
      versao: 1,
      salvoEm: agora(),
      pendentesDeMarcacao: [...pendentes.values()],
      puladas: [...puladas.values()],
      diario: registrosDoDiario.slice(),
    }),
  }
}
