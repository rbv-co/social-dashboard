// O GRUPO DE CANAIS COMO CADASTRO — a regra, sem a tela.
//
// POR QUE EXISTE (pedido do dono, 27/08/2026): *"tirar a questão de selecionar o
// canal pai para cada canal"*. Até aqui, dizer que a Loja Shopify é do Varejo
// era abrir a lista de 14 canais e mexer no seletor da linha dela. Agora é o
// contrário: abre-se o grupo **Varejo** e marca-se quais canais são dele — um
// lugar em vez de catorze.
//
// ─────────────────────────────────────────────────────────────────────────────
// A DIFERENÇA PARA `grupo-do-canal.js`, E POR QUE SÃO DOIS ARQUIVOS
//
// O vizinho agrupa pelo TEXTO (`bling_lojas.grupo`) e é ele que a edge
// `bling-proxy` usa para decidir o alcance da supervisora. Este agrupa pelo
// APONTAMENTO (`bling_lojas.grupo_id` -> `canais_grupos`), e serve ao CADASTRO.
//
// Não juntei os dois de propósito, e a razão é de risco, não de gosto: o vizinho
// está no caminho de uma decisão de PERMISSÃO que já está no ar. Trocar o motor
// dele é a Tarefa 4 do plano de 21/08, tem prova própria a fazer, e misturá-la
// com uma mudança de tela faria uma coisa cair junto com a outra. Enquanto isso,
// o gatilho do banco mantém o texto e o apontamento de acordo nos dois sentidos
// (migration de 27/08), então as duas leituras concordam.
//
// PURO, como os vizinhos desta pasta: aqui não se desenha nada e não se fala com
// banco. A tela pergunta e obedece.

import { normalizarGrupo, mesmoGrupo } from '../../supabase/functions/_shared/grupo-do-canal.js'

// Comparar id sempre como TEXTO. `loja_id` vem `number` do banco e `string` do
// atributo do HTML; `id` de grupo é uuid. Casar por tipo diferente faz a tela
// dizer "sem grupo" com o grupo bem ali — defeito que este repositório já
// catalogou em `timePorCanal`.
const chave = (v) => (v === null || v === undefined || v === '' ? null : String(v))

/**
 * O grupo cadastrado que atende por este nome, ou nulo.
 *
 * É ela que impede o grupo repetido. A comparação é a MESMA de `mesmoGrupo` (e
 * a mesma do índice único `canais_grupos_nome_unico` no banco): quem digita
 * "varejo" está falando do "Varejo" que já existe.
 */
export function acharGrupoPeloNome(nome, grupos) {
  const alvo = normalizarGrupo(nome)
  if (alvo === null) return null
  for (const g of grupos || []) {
    if (g && mesmoGrupo(g.nome, alvo)) return g
  }
  return null
}

/**
 * Os canais em baldes, um por grupo CADASTRADO, e os soltos no fim.
 *
 * ⚠️ DUAS DIFERENÇAS para `agruparCanais` (o do texto), e as duas são de
 * propósito:
 *
 *  1. GRUPO VAZIO APARECE. No texto, o grupo era deduzido dos canais — sem
 *     canal, não existia. Agora ele é uma linha com identidade própria, e
 *     precisa aparecer na tela para alguém conseguir pôr o primeiro canal
 *     dentro. Um grupo recém-criado que some é um grupo que não se usa.
 *
 *  2. CANAL APONTANDO PARA GRUPO QUE NÃO EXISTE cai como solto, em vez de
 *     sumir. A chave estrangeira é `on delete set null`, então isso não
 *     deveria acontecer — mas uma tela que esconde um canal por causa de dado
 *     torto é pior que o dado torto: ninguém procura o que não sabe que falta.
 */
export function agruparCanaisPorCadastro(canais, grupos) {
  const lista = canais || []
  const ordenados = [...(grupos || [])]
    .filter(Boolean)
    .sort((a, b) => String(a.nome || '').localeCompare(String(b.nome || ''), 'pt-BR'))

  const conhecidos = new Set(ordenados.map((g) => chave(g.id)))
  const baldes = ordenados.map((g) => ({
    grupo: g,
    canais: lista.filter((c) => c && chave(c.grupo_id) === chave(g.id)),
  }))

  const soltos = lista.filter((c) => {
    const g = chave(c && c.grupo_id)
    return g === null || !conhecidos.has(g)
  })
  if (soltos.length) baldes.push({ grupo: null, canais: soltos })
  return baldes
}

/**
 * Pode apagar este grupo?
 *
 * A chave estrangeira é `on delete set null`: apagar um grupo que tem canais
 * DESLIGARIA os canais em silêncio, e ninguém ficaria sabendo até a dashboard
 * de alguém mudar sozinha. Então a resposta é não, com o número na mão para a
 * tela poder dizer o que fazer antes.
 */
export function podeApagarGrupo(grupoId, canais) {
  const alvo = chave(grupoId)
  const quantos = (canais || []).filter((c) => c && chave(c.grupo_id) === alvo).length
  if (quantos === 0) return { ok: true, quantos: 0 }
  return {
    ok: false,
    quantos,
    mensagem: quantos === 1
      ? 'Este grupo ainda tem 1 canal dentro. Tire o canal do grupo antes de apagar.'
      : `Este grupo ainda tem ${quantos} canais dentro. Tire os canais do grupo antes de apagar.`,
  }
}

/**
 * O nome serve para criar (ou renomear) um grupo?
 *
 * `idDoProprio` é o que faz o RENOMEAR funcionar: sem ele, corrigir a grafia de
 * "varejo" para "Varejo" seria recusado por "já existe" — contra o próprio
 * grupo que se está editando, que é exatamente para o que o renomear serve.
 *
 * Recusar aqui, e não no banco, é o que troca `duplicate key value violates
 * unique constraint "canais_grupos_nome_unico"` por uma frase que diz o que
 * fazer. O índice continua lá como última palavra — esta é a primeira.
 */
export function nomeDeGrupoAceito(nome, grupos, idDoProprio = null) {
  const limpo = normalizarGrupo(nome)
  if (limpo === null) {
    return { ok: false, mensagem: 'Digite um nome para o grupo.' }
  }
  const achado = acharGrupoPeloNome(limpo, grupos)
  if (achado && chave(achado.id) !== chave(idDoProprio)) {
    return { ok: false, mensagem: `Já existe um grupo chamado "${achado.nome}".` }
  }
  return { ok: true, nome: limpo }
}
