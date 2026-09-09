// AS REGRAS DO ROBO QUE ENCHE O CERTIFICADO — puras, sem rede e sem disco.
//
// ── O QUE O DONO PEDIU, E O QUE EU MEDI ────────────────────────────────────
//
// Ele pediu: "se subir sem foto ou qualquer dado, no momento em que tivermos
// esses dados ou fotos no bling, automaticamente ja atualiza no mesmo link que
// foi cadastrado na tag NFC da bolsa". E: "meu medo e bater armazenamento do
// supabase".
//
// A METADE BOA: o link JA e vivo. A tag guarda so o endereco, e a pagina busca
// no banco a cada leitura — corrigir o lote agora muda a bolsa que esta com a
// cliente desde ontem, sem regravar etiqueta nenhuma. O que faltava era o
// automatico a partir do Bling, que e o que este robo faz.
//
// ⚠️ O MEDO DELE ESTA CERTO, E A MEDICAO DIZ ONDE: o Supabase esta no plano
// FREE — 1 GB de storage, 0,56 GB usados (56%). Sobram ~440 MB.
//
// ⚠️ POR ISSO AS FOTOS DO SELO NAO VAO PARA O SUPABASE, E NUNCA FORAM. Elas
// moram no REPOSITORIO DO SITE (`vessel-brasil/fotos/selo/`), 7,5 MB hoje,
// servidas pela Vercel — que nao cobra por arquivo estatico. Custo no 1 GB do
// Supabase: ZERO. Este robo mantem essa escolha de proposito, e este comentario
// existe para que ninguem "melhore" isso mandando as fotos para o storage.
//
// ── O QUE FOI MEDIDO CONTRA A API DO BLING EM 03/09/2026 ───────────────────
//
//  1. `produtos?limite=100` traz `imagemURL` — que e MINIATURA DE 70x70 PIXELS,
//     1,3 KB. Serve para lista de tela, nao para o certificado. O robo antigo
//     (`baixar-fotos-bling.mjs`) pega essa primeiro, e por isso ele NAO serve
//     aqui.
//  2. A imagem grande so vem no DETALHE: `produtos/{id}` →
//     `midia.imagens.internas[].link`, com `linkMiniatura` num campo separado.
//  3. ⚠️ AS URLS SAO ASSINADAS E EXPIRAM. O proprio Bling manda a `validade`, e
//     na medicao ela era de SETE DIAS. Apontar o certificado direto para o
//     Bling deixaria a bolsa da cliente com um quadrado quebrado uma semana
//     depois. COPIAR NAO E OPCIONAL — e a unica forma de a foto continuar la.
//  4. 28 de 100 produtos tem imagem; do catalogo novo (SS), 3 de 9. Ou seja:
//     hoje o robo vai achar POUCA coisa, e isso nao e defeito dele. Conforme o
//     dono for subindo foto no Bling, ele passa a achar.

/** So letras e digitos, maiusculas, sem acento — para comparar codigo. */
export function achatar(s) {
  return String(s ?? '').normalize('NFD').replace(/\p{M}/gu, '')
    .toUpperCase().replace(/[^A-Z0-9]/g, '')
}

// O NOME DA PASTA das fotos de um lote. Ele vira parte da URL que o certificado
// mostra, entao: minusculo, sem acento, sem espaco.
//
// ⚠️ ELE E FEITO DE MODELO + COR, e nao do SKU, porque as pastas que ja existem
// no site sao assim (`handbag-linear-caramelo`, `clutch-maelle-bege`). Trocar o
// criterio agora criaria uma pasta nova ao lado da que ja tem as fotos, e o
// robo baixaria de novo o que ja esta la.
export function pastaDoLote(lote) {
  const l = lote || {}
  const limpo = (s) => String(s ?? '').normalize('NFD').replace(/\p{M}/gu, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  const partes = [limpo(l.modelo), limpo(l.cor)].filter(Boolean)
  return partes.join('-') || null
}

// O ENDERECO PUBLICO de uma foto. Ele entra em `vessel_lotes.fotos` e e o que a
// pagina da cliente carrega.
export const DOMINIO_DAS_FOTOS = 'https://vesselbrasil.com.br'
export function enderecoDaFoto(pasta, indice) {
  if (!pasta || !Number.isInteger(indice) || indice < 1) return null
  return `${DOMINIO_DAS_FOTOS}/fotos/selo/${pasta}/${indice}.jpg`
}

// QUAIS LOTES O ROBO OLHA. Sem SKU nao ha o que procurar no Bling, e lote que
// ja tem foto E cor nao precisa de nada.
//
// ⚠️ ELE NAO REBAIXA O QUE JA ESTA LA. Rebaixar a cada rodada gastaria a cota
// da API do Bling e, pior, sobrescreveria uma foto que alguem tenha trocado a
// mao no site — que e o caminho que o dono ja usa para as bolsas manuais.
export function loteEstaFaltando(lote) {
  const l = lote || {}
  const faltaFoto = !Array.isArray(l.fotos) || l.fotos.length === 0
  const faltaCor = !String(l.cor ?? '').trim()
  return { faltaFoto, faltaCor, precisa: faltaFoto || faltaCor }
}

/**
 * Os lotes que o robo vai olhar.
 *
 * ⚠️ `refazer` EXISTE POR UM MOTIVO CONCRETO (07/09/2026): quando a ORDEM DAS
 * FONTES muda, quem ja tem foto continua com a foto da fonte antiga para sempre
 * — porque "ja tem foto" e a propria condicao de ser ignorado. Sem esta porta,
 * inverter a preferencia so valeria para os lotes futuros, e o dono ficaria com
 * 53 certificados na foto pior sem entender por que.
 *
 * Ele NAO e o padrao: refazer todo dia gastaria a cota do Bling e do Zoho para
 * rebaixar as mesmas fotos.
 */
export function lotesParaOlhar(lotes, { refazer = false } = {}) {
  return (Array.isArray(lotes) ? lotes : [])
    .filter((l) => String(l?.sku ?? '').trim())
    .filter((l) => refazer || loteEstaFaltando(l).precisa)
}

// AS IMAGENS GRANDES DE UM PRODUTO DO BLING, na ordem em que ele as guarda.
//
// ⚠️ `linkMiniatura` FICA DE FORA, e e o ponto inteiro desta funcao: a
// miniatura tem 70 pixels e ficaria borrada ocupando meia tela do certificado.
// A diferenca entre as duas e uma letra na URL (`/t/`), e por isso e facil
// pegar a errada sem perceber.
export function imagensGrandesDoProduto(produto) {
  const imgs = produto?.midia?.imagens
  if (!imgs) return []
  return [...(imgs.internas || []), ...(imgs.externas || [])]
    .map((i) => i?.link)
    .filter((u) => typeof u === 'string' && /^https?:/.test(u))
}

// A COR, quando o lote nao tem. O nome do produto no Bling traz a cor no fim
// ("Bolsa De Mão Média Lódz Memphis Preto"), mas nao ha campo separado — entao
// o robo NAO adivinha: ele so aproveita o que ja existe no proprio Bling.
//
// ⚠️ ADIVINHAR COR A PARTIR DO NOME JA DEU DEFEITO NESTA CASA (a deducao de cor
// do seletor de produtos, em 01/09). Palpite errado escrito no certificado da
// cliente e pior do que campo vazio: vazio a pessoa vê e corrige; errado ela lê
// e acredita.
//
// ⚠️ `descricaoCurta` NAO ENTRA, e a rodada seca de 03/09/2026 mostrou por que:
// no produto real `SS1025-Fly Rum` esse campo e HTML INTEIRO — cinco paragrafos
// com `style="font-family: Montserrat..."` listando largura, altura e
// profundidade da bolsa. Ele teria sido gravado no campo COR e a cliente leria
// um bloco de codigo onde deveria estar "Caramelo". A primeira versao daqui
// usava esse campo, e nenhum teste pegaria: o defeito so aparece contra a forma
// REAL da resposta.
//
// ⚠️ E O CAMPO SO ENTRA SE FOR CURTO. Sem o teto, qualquer campo que o Bling
// resolva encher de texto amanha vira o mesmo defeito com outro nome.
export const MAXIMO_DA_COR = 40

export function corDoProduto(produto) {
  const p = produto || {}
  for (const campo of [p.cor, p.variacao?.nome]) {
    const v = String(campo ?? '').trim()
    // nada de HTML, nada de quebra de linha, nada de texto comprido
    if (v && v.length <= MAXIMO_DA_COR && !/[<>\n\r]/.test(v)) return v
  }
  return null
}

// O PRODUTO CERTO entre os que o Bling devolveu para uma busca por codigo.
// Exige o codigo ACHATADO igual — nada de prefixo aqui. Este casamento decide
// de qual produto a foto vem, e foto do produto errado no certificado da
// cliente e pior do que certificado sem foto nenhuma.
export function produtoQueBate(produtos, sku) {
  const alvo = achatar(sku)
  if (!alvo) return null
  return (Array.isArray(produtos) ? produtos : [])
    .find((p) => achatar(p?.codigo) === alvo) || null
}

// ── DUAS BOLSAS NA MESMA PASTA: NINGUEM LEVA FOTO ──────────────────────────
//
// ⚠️ REGRA DO DONO, 08/09/2026: "se ficar na duvida, deixe sem foto — melhor do
// que com foto errada".
//
// A pasta e feita de MODELO + COR, e nao do SKU. Se dois SKUs diferentes caem no
// mesmo nome, o segundo sobrescreve as fotos do primeiro e os DOIS certificados
// passam a mostrar a mesma bolsa — um deles, a errada. Sem erro nenhum: os
// arquivos existem, o banco aponta para eles, a pagina abre.
//
// Medido em 08/09/2026: 106 lotes, 61 pastas, ZERO colisoes. Ou seja, esta trava
// nao tira nada de ninguem hoje — ela existe para o dia em que um cadastro novo
// repetir modelo e cor, que e justamente o dia em que ninguem estaria olhando.
export function pastasDisputadas(lotes) {
  const donos = new Map()
  for (const lote of Array.isArray(lotes) ? lotes : []) {
    const pasta = pastaDoLote(lote)
    const sku = String(lote?.sku ?? '').trim().toUpperCase()
    if (!pasta || !sku) continue
    if (!donos.has(pasta)) donos.set(pasta, new Set())
    donos.get(pasta).add(sku)
  }
  return new Set([...donos].filter(([, skus]) => skus.size > 1).map(([pasta]) => pasta))
}
