// QUAL É O MATERIAL DA BOLSA — couro ou canvas — a partir da estrutura de
// insumos do produto no Bling (`GET /produtos/{id}`, campo `estrutura.componentes`,
// com o nome de cada insumo vindo de `GET /produtos/{idDoComponente}`).
//
// POR QUE ISTO EXISTE: decisão do dono, 18/09/2026 — a garantia passa a ser de
// 2 anos para canvas e 6 meses para couro, contadas da compra. O sistema não
// sabe, hoje, de qual material cada bolsa é feita. Esta conta é a regra pura
// que tenta descobrir; quem varre o banco e aplica é `coletor/classificar-
// material-dos-lotes.mjs`, e ele SÓ LÊ — quem decide de verdade, na dúvida, é
// a pessoa olhando o painel.
//
// O CRITÉRIO É DO DONO, não invenção minha:
//   1. o material DE FORA do corpo da bolsa decide. Alça, acabamento, reforço,
//      forro e ferragem não contam — mesmo que sejam couro ou tecido também.
//   2. camurça conta como couro.
//   3. sintético conta como canvas (napa sintética tipo "Napa Fly", recouro,
//      PU, laminado).
//
// Sem rede, sem banco: recebe os nomes já resolvidos e o NCM já lido.

// ── O QUE NUNCA É O MATERIAL DE FORA ───────────────────────────────────────
// Cada palavra aqui tem um motivo — não é lista de estilo, é o que apareceu de
// verdade na estrutura de produtos reais (medido em 18/09/2026, Bling):
//
//  forro             — "Forro Suede - Vermelho": É FORRO. Tem "suede" no nome
//                       (que bateria no grupo couro) e mora DENTRO da bolsa,
//                       nunca por fora. Se isto não saísse primeiro, uma bolsa
//                       de canvas com forro de camurça virava "ambíguo" à toa.
//  reforço           — "Reforco Nylon 600": tem "nylon" (bateria canvas), mas é
//                       reforço interno, não superfície.
//  ferragem          — corrente, argola, puxador metálico, pé de bolsa: metal,
//                       nunca decide entre couro e canvas.
//  aviamento         — termo genérico de insumo de costura/acabamento.
//  linha, fio        — "Linha Poliamida ...": o fio que costura, não o corpo.
//  cola              — adesivo de montagem.
//  botão, ímã        — "Botão Imã", fecho magnético: fixação, não superfície.
//  rebite, fivela    — fixação metálica.
//  puxador           — de zíper ou de gaveta interna da ferragem.
//  placa             — "Placa Vessel Brasil", "Placa De Eva Impregnado",
//                       "Placa De Papelão": identificação ou reforço estrutural
//                       interno (a "placa de eva"/"placa de papelão" são o
//                       miolo que dá firmeza ao fundo/lateral — nunca a pele).
//  zíper             — fecho.
//  termoplástico     — material de reforço/moldagem interna ("Termoplastico -
//                       Magma"), não a superfície que a cliente vê.
//  insumos de produção — categoria "curinga" do Bling para material de
//                       consumo de linha de produção; não descreve superfície
//                       nenhuma.
//  embalagem         — caixa, saco: nem chega a ser parte da bolsa.
const IGNORAR = [
  'forro', 'reforco', 'ferragem', 'aviamento', 'linha', 'fio', 'cola',
  'botao', 'ima', 'rebite', 'fivela', 'puxador', 'placa', 'ziper',
  'termoplastico', 'embalagem',
]
// Frase, não palavra solta — "insumos de produção" é a categoria inteira que o
// Bling usa, e cortar em palavras ("insumos", "producao") pegaria coisa demais.
const IGNORAR_FRASES = ['insumos de producao']

// ── OS DOIS GRUPOS QUE DECIDEM ─────────────────────────────────────────────
// Regra 2 e 3 do dono: camurça é couro; sintético é canvas.
const PALAVRAS_COURO = ['couro', 'camurca', 'suede', 'vaqueta', 'pelica']
const PALAVRAS_CANVAS = [
  'lona', 'canvas', 'tecido', 'tecidos', 'nylon', 'napa', 'recouro',
  'sintetico', 'laminado',
]
// "PU" sozinho vira falso positivo dentro de qualquer palavra comum — por
// isso ele é conferido à parte, como palavra inteira.
const PALAVRA_PU = /\bpu\b/

// Sem acento, sem caixa, espaço único — para o nome do insumo do Bling não
// depender de como alguém digitou (maiúscula, cedilha, acento).
function normalizar(texto) {
  return String(texto ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/\s+/g, ' ').trim()
}

function bateAlgumaPalavra(normalizado, palavras) {
  return palavras.some((p) => new RegExp(`\\b${p}\\b`).test(normalizado))
}

function ehIgnorado(normalizado) {
  if (bateAlgumaPalavra(normalizado, IGNORAR)) return true
  return IGNORAR_FRASES.some((frase) => normalizado.includes(frase))
}

function grupoDoComponente(normalizado) {
  if (bateAlgumaPalavra(normalizado, PALAVRAS_COURO)) return 'couro'
  if (bateAlgumaPalavra(normalizado, PALAVRAS_CANVAS) || PALAVRA_PU.test(normalizado)) return 'canvas'
  return null
}

// ── O NCM, SÓ COMO DESEMPATE DE ÚLTIMO RECURSO ─────────────────────────────
// 4202.32 = superfície de matéria têxtil ou plástico (canvas/sintético);
// 4202.21 / 4202.31 = superfície de couro. Medido em 18/09/2026: os três
// produtos de exemplo do dono (Cyrène, Astrea, Bath) têm TODOS o mesmo NCM
// 4202.32.00 — inclusive a Cyrène, que por fora é camurça. Isto prova que o
// NCM fiscal não confia sozinho: ele classifica pelo que domina em VALOR/PESO
// fiscal, não necessariamente pela pele visível. Por isso ele só entra quando
// a estrutura não deu candidato NENHUM — nunca para desempatar entre dois
// candidatos que a estrutura já apontou.
function grupoDoNcm(ncm) {
  const limpo = String(ncm ?? '').replace(/[^0-9]/g, '')
  if (limpo.startsWith('420232')) return 'canvas'
  if (limpo.startsWith('420221') || limpo.startsWith('420231')) return 'couro'
  return null
}

/**
 * A regra pura. Recebe os nomes dos componentes JÁ RESOLVIDOS (não os ids) e
 * o NCM fiscal do produto, e devolve o material do CORPO EXTERNO da bolsa.
 *
 * ⚠️ NA DÚVIDA, NÃO CHUTA. Uma bolsa como a Cyrène tem lona, camurça E couro
 * na estrutura ao mesmo tempo — "por fora é camurça" é um fato que só quem
 * viu a peça sabe, e nenhum nome de insumo diz "este aqui é o que fica por
 * fora". Quando sobra candidato dos dois grupos ao mesmo tempo, a resposta
 * honesta é `ambiguo: true` — quem decide, aí, é a pessoa no painel.
 */
export function classificarMaterial({ componentes = [], ncm = '' } = {}) {
  const lista = Array.isArray(componentes) ? componentes : []
  const candidatosCouro = []
  const candidatosCanvas = []

  for (const original of lista) {
    const nome = String(original ?? '').trim()
    if (!nome) continue
    const normalizado = normalizar(nome)
    if (ehIgnorado(normalizado)) continue
    const grupo = grupoDoComponente(normalizado)
    if (grupo === 'couro') candidatosCouro.push(nome)
    else if (grupo === 'canvas') candidatosCanvas.push(nome)
  }

  if (candidatosCouro.length && candidatosCanvas.length) {
    return {
      material: null,
      ambiguo: true,
      evidencia: [...candidatosCouro, ...candidatosCanvas],
      motivo: `a estrutura tem componente(s) de couro (${candidatosCouro.join(', ')}) `
        + `e de canvas/sintético (${candidatosCanvas.join(', ')}) ao mesmo tempo, e o `
        + 'nome de nenhum deles diz qual está por fora do corpo da bolsa.',
    }
  }

  if (candidatosCouro.length) {
    return {
      material: 'couro',
      ambiguo: false,
      evidencia: candidatosCouro,
      motivo: `componente(s) de couro na estrutura, sem nenhum candidato a canvas: ${candidatosCouro.join(', ')}.`,
    }
  }

  if (candidatosCanvas.length) {
    return {
      material: 'canvas',
      ambiguo: false,
      evidencia: candidatosCanvas,
      motivo: `componente(s) de canvas/sintético na estrutura, sem nenhum candidato a couro: ${candidatosCanvas.join(', ')}.`,
    }
  }

  // Nenhum componente bateu em nenhum dos dois grupos pelo nome. Só aqui o
  // NCM entra — não há estrutura para ele contradizer.
  const grupoNcm = grupoDoNcm(ncm)
  if (grupoNcm) {
    return {
      material: grupoNcm,
      ambiguo: false,
      evidencia: [`NCM ${ncm}`],
      motivo: `nenhum componente da estrutura bateu com couro nem com canvas pelo nome; `
        + `o NCM fiscal (${ncm}) aponta para ${grupoNcm}.`,
    }
  }

  return {
    material: null,
    ambiguo: true,
    evidencia: [],
    motivo: 'nenhum componente da estrutura foi reconhecido pelo nome, e não há NCM para desempatar.',
  }
}
