//
// Lógica pura da tela "Meta Ads › Base de Leads": junta três eventos que já
// existem cada um no seu canto — checkout iniciado (carrinho_eventos),
// cadastro no pop-up "Entre para o Universo Vessel" (vessel_lista_espera) e
// pedido de atendimento/visita (vessel_atendimentos + vessel_pessoas +
// vessel_origens) — numa única linha do tempo. Sem rede aqui — a tela busca,
// isto agrega. Ver db/migrations/2026-09-24-meta-ads-base-de-leads-leitura.sql.
//
// ⚠️ ATRIBUIÇÃO DO POP-UP (25/09/2026): até aqui o pop-up "Entre para o
// Universo Vessel" não mandava utm/fbc — v1 mostrava a origem dele sempre como
// "—", decisão do dono. Corrigido no mesmo dia (o script colado no tema da
// Shopify passou a mandar `p_rastreio`, gravado em
// vessel_lista_espera.clique_meta/utm_*) — agora os três tipos têm atribuição.

// Sem `.limit()` explícito, o PostgREST corta em 1000 linhas por padrão, sem
// erro — mesmo cuidado de agregacoes-carrinho.js (LIMITE_CARRINHO).
export const LIMITE_LEADS = 2000

export function foiCortado(linhas) {
  return Array.isArray(linhas) && linhas.length === LIMITE_LEADS
}

export const TIPOS = {
  checkout_iniciado: 'Checkout iniciado',
  pop_up: 'Pop-up (Universo Vessel)',
  atendimento_solicitado: 'Pedido de atendimento',
}

/**
 * Resume de onde veio o evento, numa frase curta. `fbc` (clique no anúncio do
 * Meta) manda primeiro — é o sinal mais específico que existe; `gclid`
 * (Google Ads) em seguida; depois utm; depois de onde a pessoa veio
 * (referrer); sem nenhum dos quatro, é acesso direto/orgânico.
 * @param {{utm_source?, utm_medium?, utm_campaign?, fbc?, gclid?, referrer?}|null} o
 */
export function resumoDeOrigem(o) {
  if (!o) return '—'
  if (o.fbc) return 'Meta Ads' + (o.utm_campaign ? ` · ${o.utm_campaign}` : '')
  if (o.gclid) return 'Google Ads' + (o.utm_campaign ? ` · ${o.utm_campaign}` : '')
  if (o.utm_source) {
    const par = o.utm_medium ? `${o.utm_source}/${o.utm_medium}` : o.utm_source
    return o.utm_campaign ? `${par} · ${o.utm_campaign}` : par
  }
  if (o.referrer) {
    try { return new URL(o.referrer).hostname } catch { return o.referrer }
  }
  return 'Direto/orgânico'
}

/** Checkout iniciado (carrinho_eventos) → linha unificada. */
function linhaDeCheckout(e) {
  return {
    tipo: 'checkout_iniciado',
    criado_em: e.criado_em,
    quem: '—', // anônimo: a Shopify não manda nome/e-mail no webhook de checkout iniciado
    contato: e.session_id ? `sessão ${e.session_id.slice(0, 8)}…` : '—',
    origem: resumoDeOrigem(e),
  }
}

/** Cadastro no pop-up (vessel_lista_espera) → linha unificada. */
function linhaDePopUp(c) {
  return {
    tipo: 'pop_up',
    criado_em: c.criado_em,
    quem: c.nome || '—',
    contato: c.email || c.whatsapp || '—',
    origem: resumoDeOrigem({
      utm_source: c.utm_source, utm_medium: c.utm_medium, utm_campaign: c.utm_campaign,
      fbc: c.clique_meta,
    }),
  }
}

/**
 * Pedido de atendimento/visita → linha unificada.
 * @param {object} a linha de vessel_atendimentos
 * @param {Map<number,object>} pessoasPorId vessel_pessoas indexado por id
 * @param {object[]} origens vessel_origens da MESMA pessoa (pode ter mais de um toque)
 */
function linhaDeAtendimento(a, pessoasPorId, origens) {
  const pessoa = pessoasPorId.get(a.pessoa_id)
  const origem = origemMaisProximaDoMomento(origens, a.pessoa_id, a.criado_em)
  return {
    tipo: 'atendimento_solicitado',
    criado_em: a.criado_em,
    quem: pessoa?.nome || '—',
    contato: pessoa?.telefone || pessoa?.email || '—',
    origem: resumoDeOrigem(origem && {
      utm_source: origem.utm_source, utm_medium: origem.utm_medium, utm_campaign: origem.utm_campaign,
      fbc: origem.clique_meta,
    }),
  }
}

/**
 * De todas as origens de uma pessoa, a que aconteceu mais perto (e não
 * depois) do momento do atendimento — `vessel_pedir_atendimento` grava as
 * duas linhas na mesma chamada, então "mais perto" já é, na prática, "a
 * origem daquele pedido".
 */
export function origemMaisProximaDoMomento(origens, pessoaId, momentoAlvo) {
  const alvo = new Date(momentoAlvo).getTime()
  const daPessoa = (origens || []).filter((o) => String(o.pessoa_id) === String(pessoaId))
  if (!daPessoa.length) return null
  return daPessoa.reduce((maisPerto, atual) => {
    const diffAtual = Math.abs(new Date(atual.momento).getTime() - alvo)
    const diffMaisPerto = Math.abs(new Date(maisPerto.momento).getTime() - alvo)
    return diffAtual < diffMaisPerto ? atual : maisPerto
  })
}

/**
 * Junta os três eventos numa única linha do tempo, mais recente primeiro.
 * @param {{checkouts?, popups?, atendimentos?, pessoas?, origens?}} fontes
 */
export function unificarEventos({ checkouts = [], popups = [], atendimentos = [], pessoas = [], origens = [] }) {
  const pessoasPorId = new Map((pessoas || []).map((p) => [p.id, p]))
  const linhas = [
    ...checkouts.map(linhaDeCheckout),
    ...popups.map(linhaDePopUp),
    ...atendimentos.map((a) => linhaDeAtendimento(a, pessoasPorId, origens)),
  ]
  return linhas.sort((a, b) => new Date(b.criado_em) - new Date(a.criado_em))
}

/** Contagem por tipo, para os cartões de resumo do topo. */
export function contarPorTipo(linhas) {
  const base = { checkout_iniciado: 0, pop_up: 0, atendimento_solicitado: 0 }
  for (const l of linhas || []) {
    if (l.tipo in base) base[l.tipo] += 1
  }
  return { ...base, total: (linhas || []).length }
}
