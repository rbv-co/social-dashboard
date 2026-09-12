// OS PRODUTOS DA VESSEL, vindos do Bling, para escolher no formulário de lote.
//
// POR QUE EXISTE: o lote era criado DIGITANDO modelo, cor e SKU à mão. O que a
// pessoa digitasse ali é o que a cliente lê na página do selo — então um erro de
// digitação vira uma bolsa original mostrando o nome errado, e ninguém descobre
// até alguém encostar o celular.
//
// Contas puras: sem rede, sem DOM. Quem fala com o Bling é
// `src/compartilhado/chamada-do-bling.js`, e só ele.

// ── O QUE É "VESSEL" ──────────────────────────────────────────────────────
// Decisão do dono: só o SKU do formato NOVO. Medido em 31/08/2026: de 400
// produtos ativos, 33 são do formato novo e 312 do antigo (LV). A linha antiga
// não recebe etiqueta.
export function ehProdutoVessel(codigo) {
  return /^SS/i.test(String(codigo ?? '').trim())
}

// JUNTAR OS ESPAÇOS REPETIDOS FAZ PARTE DA LIMPEZA: o nome do produto vem do
// ERP DIGITADO à mão, e dedo escorregado põe dois espaços no meio. Sem isto,
// "off white" (um espaço, vindo do código) nunca terminava "off  white" (dois,
// vindo do nome), a cor composta voltava pela METADE — "White" — e o "Off"
// ficava grudado no modelo.
const semAcento = (s) => String(s ?? '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/\s+/g, ' ').trim()

// ── A COR, quando dá para ter certeza ─────────────────────────────────────
// O SKU carrega pedaços separados por hífen, e um deles COSTUMA ser a cor:
//   SS1088-Mostarda              → "Bolsa De Mão Média Bath Mostarda"
//   SS1234-Caramelo-Fly Amendoa  → "Bolsa de Mão Angers Caramelo"
// Mas nem sempre: `SS-00002-1.01.03.01.01` não tem cor nenhuma no código.
//
// A REGRA É CONSERVADORA DE PROPÓSITO, e o motivo é uma cicatriz: no catálogo
// eu escrevi um separador de nomes esperto, e ele leu "Bolsa Tote Grande
// Florença Caramelo" como modelo "Caramelo". Aqui um pedaço só vira cor quando
// ele TERMINA o nome do produto — as duas fontes concordando. Quando não
// concordam, a cor volta vazia e quem cria o lote preenche. Campo vazio a
// pessoa vê; campo errado ela não.
//
// PARECER COR JÁ ELIMINA MUITO CHUTE: pelo menos dois caracteres e pelo menos
// uma letra. NENHUMA COR EM PORTUGUÊS TEM UMA LETRA SÓ — o "G" solto do fim do
// SKU é o tamanho (P/M/G) e o "02" é código interno. Os dois terminavam o nome
// por acaso, e quem encostava o celular na etiqueta lia "Cor: G".
const ehPalavraDeCor = (palavra) => palavra.length >= 2 && /[a-z]/.test(palavra)

// E O MESMO RUÍDO APARECE NO FIM DO NOME, porque o ERP carimba o tamanho nos
// dois lugares: o SKU acaba em "-P" e o nome acaba em " P". Por isso ele sai do
// fim do nome antes da comparação — senão "Bolsa Bath Mostarda P" não termina
// em "Mostarda" e a cor CERTA se perde junto com a errada. Sai só do fim, e só
// enquanto for ruído: palavra de verdade no meio ninguém toca.
const palavrasUteis = (texto) => {
  const p = String(texto).split(' ').filter(Boolean)
  while (p.length && !ehPalavraDeCor(p[p.length - 1])) p.pop()
  return p
}

// TERMINAR O NOME É TERMINAR NUMA PALAVRA INTEIRA. Com `endsWith` puro a
// comparação era de LETRAS, não de palavras, e o estrago saía nos dois campos
// de uma vez:
//   "SS1234-Ouro" + "Bolsa Tote Grande Paris Couro" → cor "Ouro",
//                                     modelo "Tote Grande Paris C"
// Recebe os dois lados já passados pelo `semAcento`.
function terminaEmPalavra(nome, alvo) {
  const palavras = String(alvo).split(' ').filter(Boolean)
  if (!palavras.length || !palavras.every(ehPalavraDeCor)) return false
  const n = palavrasUteis(nome).join(' ')
  return n === alvo || n.endsWith(' ' + alvo)
}

// A COR COMPOSTA CHEGA PARTIDA: o hífen que separa os pedaços do SKU é o mesmo
// que existe DENTRO do nome da cor — "SS1500-Off-White" chega como dois
// pedaços. Testando só os pedaços soltos, "White" terminava o nome, a cor saía
// pela metade e o "Off" ficava grudado no modelo. Por isso as JUNÇÕES de
// pedaços vizinhos vêm antes, da mais longa para a mais curta: entre "Azul
// Marinho" e "Marinho", os dois terminando o nome, quem ganha é a mais longa.
export function corDoProduto(codigo, nome) {
  const n = semAcento(nome)
  const pedacos = String(codigo ?? '').split('-').slice(1).map((p) => p.trim()).filter(Boolean)
  for (let tamanho = pedacos.length; tamanho >= 1; tamanho -= 1) {
    for (let i = 0; i + tamanho <= pedacos.length; i += 1) {
      const junto = pedacos.slice(i, i + tamanho).join(' ')
      const alvo = semAcento(junto)
      if (alvo && terminaEmPalavra(n, alvo)) return junto
    }
  }
  return ''
}

// ── O MODELO ──────────────────────────────────────────────────────────────
// O nome do Bling sem o "Bolsa " da frente e sem a cor do fim. O que sobra é o
// que a cliente lê como modelo. Continua editável na tela: o Bling preenche,
// a pessoa confere.
//
// O CORTE É POR PALAVRAS, NUNCA POR CONTAGEM DE LETRAS. Contar letras já tinha
// transformado "Bolsa Tote Grande Paris Couro" em "Tote Grande Paris C", e o
// mesmo defeito voltou pela porta dos fundos com o ACENTO DECOMPOSTO: o Bling
// manda "ç" como um caractere só (NFC) ou como "c" + cedilha solta (NFD), a
// conta era feita no texto SEM acento e aplicada no texto COM acento, os dois
// com comprimentos diferentes, e "Bolsa Tote Grande Florença" em NFD saía como
// "Tote Grande F". Tirar do fim tantas PALAVRAS quantas a cor tem não depende
// de quantos code points cada uma ocupa.
//
// O ruído do fim (o tamanho do ERP) sai junto: é o mesmo que o
// `terminaEmPalavra` já ignora no nome, e deixá-lo devolveria o modelo com a
// cor dentro. O modelo NUNCA fica vazio — se o corte levasse tudo, fica o nome.
export function modeloDoProduto(nome, cor) {
  let texto = String(nome ?? '').trim()
    .replace(/^bolsa\s+/i, '').replace(/\s+/g, ' ').trim()
  if (cor && terminaEmPalavra(semAcento(texto), semAcento(cor))) {
    const palavras = texto.split(' ')
    while (palavras.length && !ehPalavraDeCor(semAcento(palavras[palavras.length - 1]))) palavras.pop()
    const quantasDaCor = semAcento(cor).split(' ').filter(Boolean).length
    const semCor = palavras.slice(0, palavras.length - quantasDaCor).join(' ').trim()
    if (semCor) texto = semCor
  }
  return texto
}

// ── A LISTA para a tela ───────────────────────────────────────────────────
export function produtosParaEscolher(itens) {
  return (Array.isArray(itens) ? itens : [])
    .filter((x) => ehProdutoVessel(x?.codigo))
    .map((x) => {
      const codigo = String(x.codigo).trim()
      const nome = String(x.nome ?? '').trim()
      const cor = corDoProduto(codigo, nome)
      // ⚠️ `imagemURL` VEM DE GRACA NA LISTA — miniatura de 70px e 1,3 KB, medida
      // em 03/09/2026. Ela estava sendo jogada fora aqui, e a tela ficava sem
      // foto nenhuma tendo a foto na mao. O `id` viaja junto porque a imagem
      // GRANDE so existe no detalhe (`produtos/{id}`), buscada so na lupa.
      //
      // NEM TODO PRODUTO TEM FOTO: 3 de 9 da linha nova. Ausencia e normal, e a
      // tela mostra o quadrinho vazio em vez de um icone de erro.
      return {
        codigo, nome, cor, modelo: modeloDoProduto(nome, cor),
        id: x.id ?? null,
        foto: String(x.imagemURL ?? '').trim() || null,
      }
    })
    .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))
}

// ── A BUSCA ───────────────────────────────────────────────────────────────
// Sem acento e sem caixa, porque ninguém digita "Mônaco" com o chapéu quando
// está com pressa. Busca no nome E no código: quem tem o SKU na mão procura
// por ele.
export function procurarProduto(lista, termo) {
  const t = semAcento(termo)
  if (!t) return Array.isArray(lista) ? lista : []
  return (Array.isArray(lista) ? lista : []).filter((p) =>
    semAcento(p.nome).includes(t) || semAcento(p.codigo).includes(t))
}

// ── A PAGINAÇÃO DA LISTA ───────────────────────────────────────────────────
// A lista mostrava 12 itens e ponto: `.slice(0, 12)` na tela, sem nada dizendo
// que havia mais. Com o catálogo crescendo, isso virou "não aparece nada".
export const PRODUTOS_POR_PAGINA = 30

export function fatiarProdutos(lista, pagina, porPagina = PRODUTOS_POR_PAGINA) {
  const todos = Array.isArray(lista) ? lista : []
  const total = Math.max(1, Math.ceil(todos.length / porPagina))
  // ⚠️ A PÁGINA É PRESA AO INTERVALO VÁLIDO. Digitar uma busca curta depois de
  // estar na página 9 deixaria a pessoa olhando uma lista vazia com resultados
  // existindo — o pior tipo de "não achei", porque parece defeito da busca.
  const atual = Math.min(Math.max(1, Number(pagina) || 1), total)
  return {
    itens: todos.slice((atual - 1) * porPagina, atual * porPagina),
    pagina: atual,
    paginas: total,
    total: todos.length,
  }
}

// OS NÚMEROS QUE APARECEM EMBAIXO, no formato do Google: sempre a primeira, a
// última, e uma janela em volta da atual. O `null` é o "…" — quem desenha
// decide como mostrar, esta conta só diz onde há buraco.
export function numerosDePagina(atual, paginas, janela = 2) {
  const fim = Math.max(1, Number(paginas) || 1)
  const p = Math.min(Math.max(1, Number(atual) || 1), fim)
  const mostrar = new Set([1, fim])
  for (let i = p - janela; i <= p + janela; i++) if (i >= 1 && i <= fim) mostrar.add(i)
  const ordenados = [...mostrar].sort((a, b) => a - b)
  const saida = []
  for (let i = 0; i < ordenados.length; i++) {
    if (i > 0 && ordenados[i] - ordenados[i - 1] > 1) saida.push(null)
    saida.push(ordenados[i])
  }
  return saida
}
