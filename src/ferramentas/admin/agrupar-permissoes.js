// Lógica pura do editor de permissões (modal do Admin): agrupa o catálogo
// RECURSOS por ferramenta e calcula o estado de "marcar/desmarcar tudo".
//
// PURA DE PROPÓSITO: não importa NADA (nem Vue, nem Supabase, nem o próprio
// catálogo). Tudo entra por parâmetro. Importar a cadeia do Supabase aqui faria
// o teste em Node quebrar com "window is not defined".
//
// NÃO inventa permissão: só reorganiza o que já existe em RECURSOS. Um
// checkbox que não corresponde a uma ação do catálogo é um checkbox que mente.

// Colunas FIXAS da matriz, sempre nesta ordem. Recurso que não tem a ação
// mostra célula vazia — a coluna NÃO é pulada. É isto que faz o olho conseguir
// varrer uma coluna de cima a baixo.
export const ACOES_MATRIZ = ['ver', 'criar', 'editar', 'excluir', 'exportar']

// Ferramenta = o trecho da chave antes do primeiro ponto ('social.relatorio' →
// 'social'). Derivado da chave, nunca de uma lista escrita em paralelo — este
// projeto já sofre de ter dois catálogos que discordam.
export function ferramentaDaChave(key) {
  const i = String(key).indexOf('.')
  return i === -1 ? String(key) : String(key).slice(0, i)
}

// Agrupa RECURSOS por ferramenta, preservando a ordem do catálogo (tanto dos
// grupos quanto dos recursos dentro de cada grupo).
//
// O rótulo do grupo sai da PERMISSION_TREE quando ela conhece a ferramenta; se
// não conhece e o grupo tem um recurso só, usa o rótulo do próprio recurso
// (caso 'claude.status' → "Painel de Status da IA"). Último recurso: a
// própria chave. Nenhum rótulo novo é inventado aqui.
// Filho declarado na árvore → grupo do pai. Existe porque 'acessos' e
// 'patrimonio' são submódulos de Gestão Interna mas NÃO têm o prefixo na chave:
// renomear para 'gestao-interna.acessos' quebraria is_acessos_admin() e o
// acessos-proxy, que procuram a string 'acessos' dentro de features[].
//
// Só o que a árvore declara explicitamente entra aqui; todo o resto continua
// derivado do prefixo. Não é um catálogo paralelo: a árvore já existia e já era
// a fonte dos rótulos — passou a ser também a do parentesco quando ele é dito.
function grupoDeclarado(tree) {
  const mapa = {}
  for (const n of tree || []) {
    for (const filho of n.children || []) mapa[filho.key] = n.key
  }
  return mapa
}

export function agruparRecursos(recursos, tree) {
  const rotuloDaArvore = {}
  for (const n of tree || []) rotuloDaArvore[n.key] = n.label
  const declarado = grupoDeclarado(tree)

  const porFerramenta = new Map()
  for (const r of recursos || []) {
    const f = declarado[r.key] || ferramentaDaChave(r.key)
    if (!porFerramenta.has(f)) porFerramenta.set(f, [])
    porFerramenta.get(f).push(r)
  }

  const grupos = []
  for (const [key, itens] of porFerramenta) {
    let label = rotuloDaArvore[key]
    if (!label && itens.length === 1) label = itens[0].label
    grupos.push({ key, label: label || key, recursos: itens })
  }
  return grupos
}

// Quantas ações do catálogo existem e quantas estão marcadas, para uma lista de
// recursos. Ignora ação gravada no banco que não está mais no catálogo — ela não
// é editável na matriz, então não pode influenciar o "marcar tudo".
export function contarAcoes(recursos, permissions) {
  let total = 0
  let marcadas = 0
  for (const r of recursos || []) {
    const atuais = (permissions || {})[r.key] || []
    for (const acao of r.acoes) {
      total++
      if (atuais.includes(acao)) marcadas++
    }
  }
  return { total, marcadas }
}

// 'vazio' | 'parcial' | 'cheio' — alimenta o checkbox de marcar/desmarcar tudo
// ('parcial' vira o estado indeterminate). Grupo sem nenhuma ação = 'vazio'.
export function estadoDaSelecao(recursos, permissions) {
  const { total, marcadas } = contarAcoes(recursos, permissions)
  if (total === 0 || marcadas === 0) return 'vazio'
  return marcadas === total ? 'cheio' : 'parcial'
}

// Liga/desliga TODAS as ações de uma lista de recursos. Devolve um objeto NOVO
// (não muta o que recebeu).
//
// Ligar grava as ações na ordem do catálogo. Desligar apaga a chave inteira em
// vez de deixar [] — é o mesmo contrato do _togglePerm: recurso sem 'ver' não
// existe. Chaves de recursos fora da lista passam intactas.
export function marcarTudo(permissions, recursos, ligar) {
  const saida = { ...(permissions || {}) }
  for (const r of recursos || []) {
    if (ligar) saida[r.key] = r.acoes.slice()
    else delete saida[r.key]
  }
  return saida
}
