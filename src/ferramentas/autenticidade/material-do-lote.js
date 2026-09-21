// src/ferramentas/autenticidade/material-do-lote.js
// O MATERIAL DO LOTE NO PAINEL — as frases e as decisões puras, sem DOM e sem rede.
//
// POR QUE ISTO EXISTE (decisão do dono, 18/09/2026). Desde a garantia por
// material, quem manda no prazo da peça é `vessel_lotes.material`
// ('canvas' | 'couro' | nulo). Só que:
//   - lote de SKU que NUNCA teve lote nasce sem material (o gatilho de herança
//     não tem de quem herdar);
//   - peça de lote sem material fica SEM data de garantia.
// Ou seja: havia um campo que decide o certificado da cliente e NENHUMA tela
// para vê-lo ou corrigi-lo. Esta é a conta que a tela de Autenticidade usa.
//
// ⚠️ NADA AQUI CHUTA MATERIAL. A regra que lê a estrutura do Bling
// (`material-do-produto.js`) devolve "ambíguo" quando não dá para ter certeza —
// e ambíguo aqui vira texto na tela, nunca uma opção marcada de véspera. Quem
// decide é a pessoa; o painel só mostra a evidência.

/** Os dois materiais, com o prazo que cada um dá. É a lista da tela e a lista
 *  da trava do banco (`vessel_lotes_material_check`) — as duas iguais de
 *  propósito: opção na tela que o banco recusa é campo que aceita e joga fora. */
export const MATERIAIS = [
  { valor: 'canvas', rotulo: 'Canvas', prazo: '2 anos de garantia' },
  { valor: 'couro', rotulo: 'Couro', prazo: '6 meses de garantia' },
]

/** 'Canvas' | 'Couro' | null (sem material ou material que não conhecemos). */
export function rotuloDoMaterial(material) {
  return MATERIAIS.find((m) => m.valor === material)?.rotulo || null
}

/** O prazo escrito do material, para a linha do cartão. */
export function prazoDoMaterialDoLote(material) {
  return MATERIAIS.find((m) => m.valor === material)?.prazo || null
}

// DE ONDE VEIO O MATERIAL, EM PORTUGUÊS. A coluna `material_fonte` guarda uma
// palavra de máquina ('dono', 'bling_estrutura', 'painel', 'herdado') e a lista
// é fechada no banco. Mostrar a palavra crua na tela faria "bling_estrutura"
// aparecer na frente de quem está decidindo o certificado de uma cliente.
//
// ⚠️ A ORIGEM MUDA O PESO DA INFORMAÇÃO, e é por isso que ela aparece:
// "herdado" quer dizer que NINGUÉM olhou este lote — o material veio do lote
// anterior do mesmo SKU. Se a produção trocou de material sem trocar de SKU,
// é exatamente aí que o erro mora, e sem esta linha ele seria invisível.
const ORIGENS = {
  dono: 'conferido pelo dono',
  bling_estrutura: 'lido da estrutura do produto no Bling',
  painel: 'escolhido aqui no painel',
  herdado: 'herdado do lote anterior do mesmo modelo — ninguém conferiu este',
}

/** A frase de origem, ou null quando a fonte é desconhecida/ausente. */
export function origemDoMaterial(fonte) {
  return ORIGENS[fonte] || null
}

// O QUE ACONTECE COM AS PEÇAS ENQUANTO O LOTE NÃO TEM MATERIAL. Não é recado de
// estilo: sem material o banco grava `garantia_ate` NULO, e a página da cliente
// fica sem data de fim. Quem está olhando o lote precisa saber disso ali, não
// depois que a cliente perguntar.
export const AVISO_SEM_MATERIAL =
  'Este lote ainda não tem material, então as peças dele ficam SEM data de fim da garantia. '
  + 'Escolha canvas ou couro para que a data passe a valer — inclusive nas peças já registradas.'

/**
 * O que a linha do cartão mostra sobre o material do lote.
 * Recebe o lote como ele vem de `vessel_lotes` (`select('*')`).
 */
export function resumoDoMaterialDoLote(lote) {
  const material = lote?.material ?? null
  const rotulo = rotuloDoMaterial(material)
  // Material que o banco tem mas a tela não conhece NÃO vira "sem material":
  // seria a tela mentindo sobre o que está gravado (PADRÃO item 9). Mostra-se o
  // valor cru, e fica evidente que alguém precisa olhar.
  if (material && !rotulo) {
    return {
      temMaterial: true, material, rotulo: String(material),
      prazo: null, origem: origemDoMaterial(lote?.material_fonte), aviso: '',
    }
  }
  if (!rotulo) {
    return {
      temMaterial: false, material: null, rotulo: null,
      prazo: null, origem: null, aviso: AVISO_SEM_MATERIAL,
    }
  }
  return {
    temMaterial: true,
    material,
    rotulo,
    prazo: prazoDoMaterialDoLote(material),
    origem: origemDoMaterial(lote?.material_fonte),
    aviso: '',
  }
}

// ── A SUGESTÃO DA ESTRUTURA DO BLING ───────────────────────────────────────
//
// `classificarMaterial` (material-do-produto.js) devolve
// `{ material, ambiguo, evidencia, motivo }`. Aqui isso vira o que a tela
// desenha — e, principalmente, o que a tela NÃO faz.
//
// ⚠️ `podeUsar` É A TRAVA DO CHUTE. Só quando a regra tem certeza é que a tela
// oferece o botão "Usar esta sugestão", e mesmo aí ele só PREENCHE a escolha:
// gravar continua sendo outro clique, da pessoa. Ambíguo não ganha botão
// nenhum, não marca opção nenhuma — ambíguo é uma pergunta, não uma resposta
// com menos confiança.

/**
 * @param resultado  o que `classificarMaterial` devolveu, ou
 *                   `{ erro: 'texto' }` quando nem deu para chegar na estrutura.
 */
export function sugestaoParaATela(resultado) {
  if (!resultado) return null

  if (resultado.erro) {
    return {
      estado: 'sem_estrutura',
      material: null,
      podeUsar: false,
      evidencia: [],
      frase: `Não deu para ler a estrutura deste produto no Bling: ${resultado.erro}. `
        + 'Escolha o material olhando a bolsa.',
    }
  }

  const evidencia = Array.isArray(resultado.evidencia) ? resultado.evidencia : []

  if (resultado.ambiguo || !resultado.material) {
    return {
      estado: 'ambiguo',
      material: null,
      podeUsar: false,
      evidencia,
      frase: 'A estrutura do Bling não decide este: '
        + (resultado.motivo || 'a regra não reconheceu nenhum componente.')
        + ' Quem escolhe é você, olhando a bolsa.',
    }
  }

  const rotulo = rotuloDoMaterial(resultado.material) || resultado.material
  return {
    estado: 'sugerido',
    material: resultado.material,
    podeUsar: true,
    evidencia,
    frase: `A estrutura do Bling aponta ${rotulo}: ${resultado.motivo || ''}`.trim(),
  }
}

/** O que a tela deve deixar marcado por causa da sugestão. Ambíguo → nada. */
export function materialSugeridoParaMarcar(sugestao) {
  return sugestao?.podeUsar ? sugestao.material : null
}

// ── A RECUSA DO BANCO, EM PORTUGUÊS ────────────────────────────────────────
// Mesma ideia de `fraseDaRecusa` em lotes.js: o banco devolve uma palavra, a
// tela devolve uma frase. Motivo que não está na lista aparece CRU, e não some
// numa frase genérica — recusa que a tela não sabe traduzir é recusa que
// alguém precisa ver.
const RECUSAS = {
  sem_permissao: 'Você não tem permissão para mexer no material deste lote.',
  lote_nao_existe: 'Este lote não existe mais. Recarregue a tela.',
  material_invalido: 'O material tem de ser canvas ou couro.',
}

export function fraseDaRecusaDoMaterial(motivo) {
  return RECUSAS[motivo]
    || `Não consegui gravar o material. O banco recusou assim: ${motivo || 'sem detalhe'}`
}
