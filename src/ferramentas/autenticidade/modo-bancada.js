// A BANCADA — a conta pura do que a tela DIZ enquanto se grava.
//
// ⚠️ O NOME DESTE ARQUIVO FALA DE UM "MODO" QUE NÃO EXISTE MAIS, e ele fica: o
// nome é referência em teste, em import e em meia dúzia de comentários, e trocar
// tudo por estética é ruído no histórico. O que mudou em 01/09/2026 é que a aba
// Gravar VIROU a bancada — não há interruptor para ligar, nem para desligar. As
// contas que este arquivo faz continuam as mesmas e continuam sendo as certas:
// qual estado sai de qual fase, qual frase sai de cada estado, e qual é a única
// ação. `podeEntrarNaBancada`, `bancadaLembrada`, `lembrarBancada` e
// `precisaSairDaBancada` gateavam e lembravam AQUELE interruptor, e por isso a
// tela não as chama mais — elas ficam aqui, com os testes delas, para quem
// apagar apagar as duas coisas de propósito e não de passagem.
//
// ── POR QUE ESTE ARQUIVO EXISTE ────────────────────────────────────────────
// O dono usou a aba Gravar de pé, na bancada, e disse: "ta muito ruim o layout
// e visual, n ta funcional, está confuso, texto maiores que outros, espaços
// vazios, não centralizados, uma criança de 5 anos precisa conseguir fazer o
// processo, precisa ser didático, fácil, FUNCIONAL".
//
// A causa não foi um defeito, foi a SOMA: a aba foi ganhando busca,
// arquivamento, tabela de peças, fila, guia e filtros de data — cada um pedido,
// cada um certo sozinho — e ninguém nunca perguntou o que aquela tela NÃO
// deveria mostrar. Medido na tela renderizada a 1440px: 260px de filtro em cima
// (que quem grava nunca usa), a informação mais importante — "PEÇA 5 DE 12" —
// em letra pequena, e o MAIOR elemento da tela sendo o endereço, que a pessoa
// não precisa ler porque quem lê é a máquina.
//
// O modo bancada é essa pergunta respondida. Ele é o desenho de um PAINEL DE
// MÁQUINA, não de um formulário: qual peça é agora, em que estado ela está,
// quanto falta, e UM botão.
//
// ⚠️ ESTE ARQUIVO NÃO SABE O QUE É DOM, E É DE PROPÓSITO. `node --test` não
// compila `.vue`, e o que precisa de prova aqui é justamente o que não se vê
// olhando a tela parada: qual estado sai de qual fase, qual frase sai de cada
// estado, quando o modo pode ser ligado e quando ele TEM de se desligar
// sozinho. A tela chama e desenha; a decisão mora aqui e se prova.
//
// ⚠️ NENHUMA FRASE DAQUI PODE MANDAR TROCAR A ETIQUETA. É a mesma cicatriz do
// `InvalidStateError` em `gravador-nfc.js` e das frases do leitor de mesa:
// quando o problema é do aparelho, a etiqueta está boa — e quem troca etiqueta
// boa joga bolsa fora, uma atrás da outra. Por isso o `detalhe` de 'erro' e de
// 'esperando' é SEMPRE o recado que a sequência produziu, quando existe: é ele
// que sabe a diferença entre "a etiqueta ficou pela metade, separe" e "o leitor
// está ocupado, a etiqueta está boa".

// ── AS FASES ───────────────────────────────────────────────────────────────
// Elas são o que a TELA sabe, e não o que a etiqueta é. A sequência do leitor
// de mesa (`gravar-pelo-leitor-de-mesa.js`) tem nove estados de ETIQUETA; aqui
// são seis de TELA, porque é isso que a pessoa de pé precisa distinguir a um
// metro de distância.
//
//   'parado'    ninguém apertou nada ainda. A tela diz o que fazer.
//   'esperando' a gravação começou e a etiqueta ainda não encostou.
//   'gravando'  está escrevendo. Não tire a etiqueta.
//   'ok'        gravou, conferiu na etiqueta e registrou.
//   'erro'      não deu certo — e o detalhe diz o que fazer com ESTA etiqueta.
//   'fim'       não há mais peça por gravar neste lote.
export const FASES = ['parado', 'esperando', 'gravando', 'ok', 'erro', 'fim']

// ── OS MODOS ───────────────────────────────────────────────────────────────
// Os mesmos três que a aba Gravar já tem, com os nomes que ela já usa:
//   'mesa'    o leitor ACR122U emprestado pelo programa da janela
//   'celular' o Chrome do Android encostando a etiqueta
//   'copiar'  iPhone e computador: copia o endereço e grava pelo aplicativo
export const MODOS = ['mesa', 'celular', 'copiar']

// O NOME DO MODO, ESCRITO. No modo bancada não há botão de trocar de jeito de
// gravar — trocar é decisão de antes, e no meio de cinquenta etiquetas ela só
// atrapalha. Mas a tela não pode esconder POR ONDE está gravando: sem esta
// linha, quem entra na bancada com o leitor fora do ar aperta o botão e não
// entende por que nada acontece.
const NOME_DO_MODO = {
  mesa: 'Leitor de mesa',
  celular: 'Celular encostado',
  copiar: 'Pelo aplicativo',
}

export function nomeDoModo(modo) {
  return NOME_DO_MODO[modo] || NOME_DO_MODO.copiar
}

// ── O ESTADO, E A FRASE DE CADA ESTADO ─────────────────────────────────────
// `tom` é o que a tela pinta, e sai de TOKEN lá no estilo (PADRAO item 2):
// 'neutro' → --border · 'agindo' → --accent · 'ok' → --green · 'erro' → --red.
// A cor NUNCA é o único aviso: o `titulo` diz o estado por escrito, e o
// `detalhe` diz o que fazer. Quem desliga animação, ou não distingue a cor,
// continua lendo a mesma coisa.
const PARADO = {
  mesa: {
    titulo: 'Ponha a etiqueta no leitor',
    detalhe: 'No meio do leitor, parada. O programa lê a etiqueta ANTES de gravar — se ela já '
      + 'tiver outra peça dentro, ele para e pergunta — e lê de volta depois, para conferir.',
  },
  celular: {
    titulo: 'Pegue a etiqueta',
    detalhe: 'Aperte o botão e encoste a etiqueta no celular, segurando parado. A tela lê a '
      + 'etiqueta antes e depois de gravar.',
  },
  copiar: {
    titulo: 'Grave pelo aplicativo',
    detalhe: 'Copie o endereço, grave na etiqueta pelo aplicativo do celular e confirme aqui. '
      + 'É a confirmação que impede de perder a conta no meio de etiquetas iguais.',
  },
}

/**
 * O estado do painel de bancada: uma palavra grande e uma frase.
 *
 * @param {object} entrada
 * @param {string} entrada.fase   uma de `FASES`
 * @param {string} entrada.modo   um de `MODOS`
 * @param {string} entrada.recado o que a sequência de gravação escreveu, se houver
 * @returns {{chave:string, tom:string, titulo:string, detalhe:string}}
 */
export function estadoDaBancada({ fase = 'parado', modo = 'copiar', recado = '' } = {}) {
  const jeito = MODOS.includes(modo) ? modo : 'copiar'
  const chave = FASES.includes(fase) ? fase : 'parado'
  // O recado da sequência VENCE o texto padrão sempre que existe: ele é o único
  // que sabe se a etiqueta ficou pela metade, se o leitor é que está ocupado, ou
  // se a peça foi marcada. Texto genérico por cima dele é a tela mentindo.
  const dito = String(recado ?? '').trim()

  if (chave === 'fim') {
    return {
      chave,
      tom: 'ok',
      titulo: 'Lote pronto',
      // ⚠️ ESTA FRASE MUDOU EM 01/09/2026, e só ela. Ela mandava "sair do modo
      // bancada" — e o modo deixou de existir: a aba Gravar VIROU a bancada.
      // Frase que manda apertar um botão que não está mais na tela é a tela
      // mentindo, e é o tipo de resto que fica anos depois de a tela mudar.
      detalhe: dito || 'Todas as etiquetas deste lote já foram gravadas. Não há mais nada a '
        + 'fazer aqui: escolha outro lote no alto da tela, ou abra a aba 1 Lotes.',
    }
  }
  if (chave === 'esperando') {
    return {
      chave,
      tom: 'agindo',
      titulo: 'Encoste a etiqueta',
      detalhe: dito || (jeito === 'mesa'
        ? 'Ponha a etiqueta em cima do leitor, no meio, e segure parada.'
        : 'Encoste a etiqueta no celular e segure parado.'),
    }
  }
  if (chave === 'gravando') {
    return {
      chave,
      tom: 'agindo',
      titulo: 'Gravando…',
      detalhe: dito || (jeito === 'mesa'
        ? 'Não tire a etiqueta de cima do leitor.'
        : 'Não tire o celular de perto da etiqueta.'),
    }
  }
  if (chave === 'ok') {
    return {
      chave,
      tom: 'ok',
      titulo: 'Pronto',
      detalhe: dito || 'Peça gravada, conferida e registrada. Pegue a próxima etiqueta.',
    }
  }
  if (chave === 'erro') {
    return {
      chave,
      tom: 'erro',
      titulo: 'Deu erro',
      // ⚠️ SEM FALLBACK VAZIO. "Deu erro" sozinho, de pé na bancada, com uma
      // bolsa na mão, não diz o que fazer — e a pessoa ou joga fora uma etiqueta
      // boa ou costura uma etiqueta muda. A frase de baixo é a menos ruim
      // possível quando a sequência não mandou nenhuma, e ela NÃO manda trocar
      // a etiqueta.
      detalhe: dito || 'Não deu certo, e a peça NÃO foi marcada como gravada. A etiqueta não '
        + 'foi jogada fora: tente esta mesma peça de novo.',
    }
  }
  return { chave: 'parado', tom: 'neutro', ...PARADO[jeito] }
}

// ── A ÚNICA AÇÃO PRINCIPAL ─────────────────────────────────────────────────
// Hoje a aba Gravar tem SEIS links do mesmo peso visual. Aqui há um botão, e a
// `chave` diz qual caminho ele chama — a tela não decide isso dentro do
// template, senão a regra se espalha por seis `v-if`.
//
//   'gravar' → o caminho ao vivo (leitor de mesa ou celular)
//   'marcar' → o "✓ Gravei essa" do modo do aplicativo
//   'sair'   → não há mais o que gravar; o botão vira a porta de saída
/**
 * @returns {{chave:string, rotulo:string, ocupado:boolean}}
 */
export function acaoDaBancada({ fase = 'parado', modo = 'copiar' } = {}) {
  const jeito = MODOS.includes(modo) ? modo : 'copiar'
  if (fase === 'fim') {
    // O RÓTULO MUDOU JUNTO COM A FRASE ACIMA, e a `chave` NÃO: quem lê a chave
    // 'sair' continua sabendo que este é o botão de "acabou aqui". O que ele faz
    // é decisão da tela — hoje ela leva para a aba 1 Lotes, que é onde se
    // escolhe lote. Antes ele desligava o modo bancada, que não existe mais.
    return { chave: 'sair', rotulo: 'Escolher outro lote', ocupado: false }
  }
  // OCUPADO É BOTÃO TRAVADO, e não botão sumido: quem está esperando a etiqueta
  // encostar precisa continuar vendo onde o botão está. Botão que some no meio
  // faz a pessoa procurar, e procurar com a etiqueta na mão é tirar a etiqueta
  // de cima do leitor.
  if (fase === 'esperando' || fase === 'gravando') {
    return {
      chave: 'gravar',
      rotulo: jeito === 'mesa' ? 'Segure a etiqueta no leitor…' : 'Encoste a etiqueta…',
      ocupado: true,
    }
  }
  if (jeito === 'copiar') {
    return { chave: 'marcar', rotulo: 'Gravei essa — próxima peça', ocupado: false }
  }
  return {
    chave: 'gravar',
    rotulo: jeito === 'mesa' ? 'Gravar no leitor' : 'Gravar nesta etiqueta',
    ocupado: false,
  }
}

// ── QUANDO O MODO PODE SER LIGADO ──────────────────────────────────────────
// Só gateia ENTRAR. Depois de dentro, o modo NÃO se desliga porque a fila
// acabou — pelo mesmo motivo que o farol do lote mora fora do bloco de
// gravação: ao gravar a última peça, `proxima` vira nulo, e um modo que sumisse
// nesse instante levaria junto o ✓ da etiqueta que a pessoa acabou de encostar.
// Ele mostra 'fim' e espera a pessoa sair.
export function podeEntrarNaBancada({
  podeEditar = false, temLote = false, temPecaPorGravar = false,
} = {}) {
  return Boolean(podeEditar && temLote && temPecaPorGravar)
}

// ── QUANDO O MODO TEM DE SE DESLIGAR SOZINHO ───────────────────────────────
// UMA razão só, e ela é a pergunta mais perigosa da ferramenta: a etiqueta já
// tem OUTRA peça gravada, e alguém vai decidir apagar a identidade de uma
// bolsa. Essa pergunta tem dois seletores, o aviso de garantia de cliente e um
// motivo obrigatório — ela não cabe num painel de máquina, e COPIÁ-LA para
// dentro do modo bancada criaria uma SEGUNDA pergunta de sobrescrever para
// manter. A que ficasse para trás gravaria por cima de uma bolsa que já tem
// dono; este arquivo inteiro existe para não repetir esse erro.
//
// Então a tela sai do modo bancada e mostra a pergunta onde ela já mora, com
// todo o contexto dela.
export function precisaSairDaBancada({ sobrescrita = null } = {}) {
  return Boolean(sobrescrita)
}

// ── A ESCOLHA FICA LEMBRADA ────────────────────────────────────────────────
// Quem grava cinquenta etiquetas por dia abre esta tela várias vezes ao dia, e
// pedir o mesmo clique toda vez é o tipo de atrito que faz a pessoa desistir da
// ferramenta. O "já vi" mora no APARELHO e não no banco: é conveniência de quem
// está usando, não dado da empresa — a mesma regra do guia, em `tutorial.js`.
//
// O depósito entra por parâmetro porque `localStorage` ESTOURA em janela
// anônima e com dados de site bloqueados, e porque é assim que o teste finge.
const CHAVE_DA_BANCADA = 'autenticidade-modo-bancada'

function deposito(dado) {
  return dado || (typeof localStorage !== 'undefined' ? localStorage : null)
}

export function bancadaLembrada(dado) {
  try {
    return deposito(dado)?.getItem(CHAVE_DA_BANCADA) === 'sim'
  } catch { return false }
}

export function lembrarBancada(ligado, dado) {
  try {
    deposito(dado)?.setItem(CHAVE_DA_BANCADA, ligado ? 'sim' : 'nao')
    return true
  } catch { return false }
}
