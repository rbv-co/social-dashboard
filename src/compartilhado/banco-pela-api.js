// AS TABELAS QUE JÁ MORAM NA API EM GO, e a ponte que leva até elas (Plano 7).
//
// O front fala com o PostgREST de três jeitos: o supabase-js
// (`sbClient.from('t').select().eq()…`), a URL montada à mão
// (`sb('t?col=eq.x&select=a,b')`, `adFetch('t?id=eq.x', {method:'PATCH'})`) e o
// `gravar` do Admin. A API em Go não aceita nada disso: cada tabela virou uma
// ROTA com filtros NOMEADOS e declarados (`/acesso/usuarios?email=...`), sem
// `select` e sem operadores (`API-PRONTA.md`, "Leitura de domínio").
//
// Em vez de reescrever cada um dos ~300 sítios à mão, a tradução mora AQUI:
//   - `ROTAS`: tabela → rota, a área (a chave de `VITE_API_AREAS`), os filtros
//     que a rota aceita e as ordens que ela declara;
//   - `traduzir`: um pedido no formato PostgREST → o pedido da rota;
//   - duas fachadas que falam o idioma de quem chama: `deOnde(sbClient)` (o
//     encadeado do supabase-js) e `fetchPostgrest(caminho, opcoes)` (o `fetch`
//     cru, com um `Response`).
//
// ⚠️ O QUE A ROTA NÃO SABE FAZER, A TRADUÇÃO RECUSA — ALTO. Filtro que a rota
// não declara, operador sem equivalente, `select` com recurso embutido: tudo
// lança `ErroDeTraducao`. Ignorar um filtro em silêncio devolveria MAIS linhas
// do que a tela pediu (e ela mostraria, gravaria ou apagaria a mais). O erro
// aparece no primeiro clique do ensaio, não em produção: a chave da área
// começa desligada.

import { areaNaApi, pedir, fraseDoCorpo } from './api.js'

export class ErroDeTraducao extends Error {}

// Filtro: coluna → { operador do PostgREST → parâmetro da rota }. O parâmetro
// pode vir com uma conversão do valor: `[param, (v) => valor]`.
const eq = (p) => ({ eq: p })
// Data/instante com faixa: `col=eq|gte|lte` → `col`, `col_de`, `col_ate` (5.6).
const faixa = (c) => ({ eq: c, gte: c + '_de', lte: c + '_ate' })
// `lido_em_de` é INSTANTE (RFC 3339). O PostgREST lia `lido_em=gte.2026-10-01`
// como meia-noite UTC; a rota quer o mesmo instante escrito por extenso.
const instante = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(v) ? v + 'T00:00:00Z' : v)
// O teto de linhas da API (o `max_rows` do Supabase). Pedido acima disso é
// recusado na tradução: cortar calado devolveria número menor sem aviso.
export const TETO_DE_LINHAS = 1000
// `col=is.null` / `col=not.is.null` viram um parâmetro booleano da rota; outro
// valor (`is.true`, `not.eq.x`) não tem tradução.
const nulo = (sim) => (v) => { if (v !== 'null') throw new ErroDeTraducao(`is.${v} sem tradução`); return sim }
const naoNulo = (sim) => (v) => { if (v !== 'is.null') throw new ErroDeTraducao(`not.${v} sem tradução`); return sim }
const ROTAS = {
  // ── 5.1 — admin, equipes e acesso ──
  profiles: {
    area: 'admin', rota: '/acesso/usuarios',
    filtros: { id: eq('id'), email: { eq: 'email', ilike: 'email' }, perfil_id: eq('perfil_id') },
    ordens: ['name', 'email', 'created_at'],
  },
  acessos_perfis: {
    area: 'admin', rota: '/acesso/perfis', filtros: { nome: eq('nome') }, ordens: ['nome'],
    autoria: ['criado_por', 'criado_em'],
  },
  access_requests: { area: 'admin', rota: '/acesso/pedidos', filtros: {}, ordens: [] },
  equipes: { area: 'admin', rota: '/equipes/times', filtros: {}, ordens: ['nome', 'ordem'] },
  equipes_membros: {
    area: 'admin', rota: '/equipes/membros',
    filtros: { equipe_id: eq('equipe_id'), profile_id: eq('profile_id'), papel: { eq: 'papel', in: 'papel' } },
    ordens: ['criado_em'], autoria: ['criado_por', 'criado_em'],
  },
  equipes_permissoes: {
    area: 'admin', rota: '/equipes/permissoes',
    filtros: { equipe_id: eq('equipe_id'), profile_id: eq('profile_id') },
    ordens: ['criado_em'], autoria: ['concedido_por', 'criado_em'],
  },
  canais_grupos: { area: 'admin', rota: '/equipes/grupos', filtros: {}, ordens: ['nome'] },
  canais_grupos_membros: {
    area: 'admin', rota: '/equipes/grupos-membros',
    filtros: { grupo_id: eq('grupo_id'), profile_id: eq('profile_id') },
    ordens: ['concedido_em'], autoria: ['concedido_por', 'concedido_em'],
  },
  push_preferencias: {
    area: 'admin', rota: '/avisos/preferencias', filtros: { user_id: eq('user_id') }, ordens: [],
    autoria: ['alterado_por', 'alterado_em'],
    // O lote (upsert) é UMA chamada: POST com o array (Plano 5.1, Task 9).
    upsert: (linhas) => ({ metodo: 'POST', caminho: '/avisos/preferencias', corpo: linhas }),
  },
  push_subs: {
    area: 'admin', rota: null, filtros: {}, ordens: [],
    upsert: (linhas) => {
      const [l] = linhas
      return { metodo: 'POST', caminho: '/eu/push/inscrever', corpo: { endpoint: l.endpoint, p256dh: l.p256dh, auth: l.auth } }
    },
    // Só o próprio aparelho sai, pelo endpoint.
    apagarPor: { endpoint: (v) => ({ metodo: 'POST', caminho: '/eu/push/desinscrever', corpo: { endpoint: v } }) },
  },
  // ── 5.6 — Meta e redes (métricas) ──
  accounts: { area: 'meta', rota: '/redes/contas', filtros: {}, ordens: ['name'] },
  daily_snapshots: {
    area: 'meta', rota: '/redes/seguidores',
    filtros: { account_id: eq('account_id'), captured_at: faixa('captured_at') }, ordens: ['captured_at'],
  },
  followers_leituras: {
    area: 'meta', rota: '/redes/leituras-de-seguidores',
    filtros: { account_id: eq('account_id'), lido_em: { gte: ['lido_em_de', instante] } }, ordens: ['lido_em'],
  },
  engagement_snapshots: {
    area: 'meta', rota: '/redes/engajamento',
    filtros: { account_id: eq('account_id'), period_days: eq('period_days'), captured_at: faixa('captured_at') }, ordens: ['captured_at'],
  },
  content_snapshots: {
    area: 'meta', rota: '/redes/conteudo',
    filtros: { account_id: eq('account_id'), period_days: { eq: 'period_days', lte: 'period_days_ate' }, captured_at: faixa('captured_at') },
    ordens: ['captured_at', 'period_days'],
  },
  campaigns: { area: 'meta', rota: '/redes/campanhas', filtros: { account_id: eq('account_id') }, ordens: [] },
  campaign_adsets: { area: 'meta', rota: '/redes/conjuntos', filtros: { account_id: eq('account_id') }, ordens: [] },
  ads: { area: 'meta', rota: '/redes/anuncios', filtros: { account_id: eq('account_id') }, ordens: [] },
  campaign_insights: {
    area: 'meta', rota: '/redes/insights-de-campanha',
    filtros: { account_id: eq('account_id'), period_days: eq('period_days'), campaign_id: { eq: 'campaign_id', in: 'campaign_id' }, captured_at: faixa('captured_at') },
    ordens: ['captured_at'],
  },
  account_insights: {
    area: 'meta', rota: '/redes/insights-da-conta',
    filtros: { account_id: eq('account_id'), period_days: eq('period_days'), captured_at: faixa('captured_at') }, ordens: ['captured_at'],
  },
  campaign_insights_hora: { area: 'meta', rota: '/redes/campanhas-por-hora', filtros: { account_id: eq('account_id'), dia: { gte: 'dia_de' } }, ordens: [] },
  ad_insights_hora: { area: 'meta', rota: '/redes/anuncios-por-hora', filtros: { account_id: eq('account_id'), dia: { gte: 'dia_de' } }, ordens: [] },
  perfil_visitas_hora: { area: 'meta', rota: '/redes/visitas-por-hora', filtros: { account_id: eq('account_id'), dia: { gte: 'dia_de' } }, ordens: [] },
  social_metas: {
    area: 'meta', rota: '/redes/metas', filtros: { account_id: eq('account_id') }, ordens: [],
    // o lote é UMA transação (Ruling 7 do 5.6)
    upsert: (linhas) => ({ metodo: 'PUT', caminho: '/redes/metas', corpo: { metas: linhas } }),
  },
  campaign_filters: {
    area: 'meta', rota: '/redes/filtros-de-campanha', filtros: { account_id: eq('account_id') }, ordens: [],
    autoria: ['updated_at'], // o servidor carimba
    upsert: (linhas) => {
      if (linhas.length !== 1) throw new ErroDeTraducao('campaign_filters: um filtro por conta por vez')
      const [l] = linhas
      return { metodo: 'PUT', caminho: `/redes/filtros-de-campanha/${encodeURIComponent(l.account_id)}`, corpo: { selected_ids: l.selected_ids } }
    },
  },
  // ── 5.8 — Fábrica de anúncios (leituras; as escritas do painel são as 4 edges e o
  // `escolher`, feitos na tela; as do robô são as rotas `/fabrica/robo/*`) ──
  fabrica_lojas: { area: 'fabrica', rota: '/fabrica/lojas', filtros: { ativo: eq('ativo') }, ordens: [] },
  fabrica_objetivos: { area: 'fabrica', rota: '/fabrica/objetivos', filtros: { ativo: eq('ativo'), chave: eq('chave') }, ordens: [] },
  fabrica_marcas: { area: 'fabrica', rota: '/fabrica/marcas', filtros: { account_id: eq('account_id'), ativo: eq('ativo') }, ordens: [] },
  fabrica_looks: { area: 'fabrica', rota: '/fabrica/looks', filtros: { ativo: eq('ativo') }, ordens: [] },
  fabrica_publicos: { area: 'fabrica', rota: '/fabrica/publicos', filtros: { ativo: eq('ativo') }, ordens: [] },
  fabrica_campanhas: {
    area: 'fabrica', rota: '/fabrica/campanhas',
    filtros: {
      id: eq('id'), status: { eq: 'status', in: 'status' },
      // `fechada_em=is.null` = aberta; `purgado_em=is.null` = não purgada
      fechada_em: { is: ['aberta', nulo('true')], not: ['aberta', naoNulo('false')] },
      purgado_em: { is: ['purgada', nulo('false')], not: ['purgada', naoNulo('true')] },
    },
    ordens: ['created_at', 'fechada_em'],
  },
  fabrica_criativos: {
    area: 'fabrica', rota: '/fabrica/criativos',
    filtros: {
      campanha_id: eq('campanha_id'), escolhido: eq('escolhido'), arquetipo: eq('arquetipo'),
      purgado_em: { is: ['purgado', nulo('false')], not: ['purgado', naoNulo('true')] },
    },
    ordens: [],
  },
  fabrica_jobs: {
    area: 'fabrica', rota: '/fabrica/jobs',
    // `params->>campanhaId` = `campanha_id` na rota
    filtros: { id: eq('id'), tipo: eq('tipo'), status: eq('status'), 'params->>campanhaId': eq('campanha_id') },
    ordens: ['created_at'],
  },
  fabrica_meta_jobs: {
    area: 'fabrica', rota: '/fabrica/meta-jobs',
    filtros: {
      tipo: eq('tipo'), 'payload->>campanhaId': { eq: 'campanha_id', in: 'campanha_id' },
      meta_campaign_id: { not: ['com_campanha_meta', naoNulo('true')] },
    },
    ordens: ['created_at'],
  },
  // ── 5.9 — Conteúdo ── (`da_marca` = "desta marca OU de todas", o `.or(account_id.eq.X,account_id.is.null)`)
  conteudo_pecas: {
    area: 'conteudo', rota: '/conteudo/pecas',
    filtros: { account_id: eq('account_id'), id: eq('id'), status: { eq: 'status', in: 'status' } },
    ordens: ['publicar_em', 'created_at'], autoria: ['criado_por'],
  },
  conteudo_arquivos: { area: 'conteudo', rota: '/conteudo/arquivos', filtros: { peca_id: eq('peca_id'), account_id: eq('account_id') }, ordens: [] },
  conteudo_eventos: {
    area: 'conteudo', rota: '/conteudo/eventos', filtros: { peca_id: eq('peca_id'), account_id: eq('account_id') }, ordens: [],
    autoria: ['quem', 'quando'],
  },
  conteudo_ideias: {
    area: 'conteudo', rota: '/conteudo/ideias',
    filtros: { account_id: eq('account_id'), da_marca: eq('da_marca'), situacao: { eq: 'situacao', in: 'situacao' }, descartada: eq('descartada') },
    ordens: [], autoria: ['criado_por', 'origem'],
  },
  conteudo_blocos: {
    area: 'conteudo', rota: '/conteudo/blocos',
    filtros: { account_id: eq('account_id'), da_marca: eq('da_marca'), ativo: eq('ativo') }, ordens: [], autoria: ['criado_por'],
  },
  conteudo_concorrentes: { area: 'conteudo', rota: '/conteudo/concorrentes', filtros: { account_id: eq('account_id'), ativo: eq('ativo') }, ordens: [] },
  conteudo_jobs: { area: 'conteudo', rota: '/conteudo/jobs', filtros: { id: eq('id'), account_id: eq('account_id'), status: { eq: 'status', in: 'status' } }, ordens: [] },
  // ── 5.7 — Gestão de tráfego ──
  gt_budget_analises: {
    area: 'trafego', rota: '/gestao-trafego/analises-de-orcamento',
    filtros: { account_id: eq('account_id'), veredito: eq('veredito') }, ordens: [],
  },
  gt_ad_analises: {
    area: 'trafego', rota: '/gestao-trafego/analises-de-anuncio',
    filtros: { account_id: eq('account_id'), veredito: eq('veredito'), campaign_id: eq('campaign_id') }, ordens: [],
  },
  gt_fila_decisoes: {
    area: 'trafego', rota: '/gestao-trafego/decisoes',
    filtros: { account_id: eq('account_id'), campaign_id: eq('campaign_id'), escopo: eq('escopo') }, ordens: ['decidido_em'],
    // quem decidiu vem da sessão; o silêncio de 7 dias o servidor calcula (Ruling 5.7-17)
    autoria: ['decidido_por', 'silenciar_ate', 'decidido_em'],
  },
  gt_campanhas_rascunho: {
    area: 'trafego', rota: '/gestao-trafego/rascunhos',
    filtros: { account_id: eq('account_id'), status: eq('status') }, ordens: ['updated_at'],
    autoria: ['criado_por', 'created_at', 'updated_at'],
  },
  gt_config_metricas: {
    area: 'trafego', rota: '/gestao-trafego/config-metricas', filtros: {}, ordens: [], autoria: ['updated_at'],
    upsert: (linhas) => {
      if (linhas.length !== 1) throw new ErroDeTraducao('gt_config_metricas: um balde por vez')
      return { metodo: 'PUT', caminho: `/gestao-trafego/config-metricas/${encodeURIComponent(linhas[0].balde)}`, corpo: { metricas: linhas[0].metricas } }
    },
  },
  gt_objetivo_interacao: {
    area: 'trafego', rota: '/gestao-trafego/objetivos',
    filtros: { alvo_id: eq('alvo_id'), conta_id: eq('conta_id'), nivel: eq('nivel') }, ordens: [],
    autoria: ['updated_by', 'updated_at'],
    upsert: (linhas) => {
      if (linhas.length !== 1) throw new ErroDeTraducao('gt_objetivo_interacao: um alvo por vez')
      const [l] = linhas
      return { metodo: 'PUT', caminho: `/gestao-trafego/objetivos/${encodeURIComponent(l.alvo_id)}`, corpo: { nivel: l.nivel, interacao: l.interacao, conta_id: l.conta_id ?? null } }
    },
    // 204 também sem linha (Ruling 5.7-8)
    apagarPor: { alvo_id: (v) => ({ metodo: 'DELETE', caminho: `/gestao-trafego/objetivos/${encodeURIComponent(v)}` }) },
  },
  // a escrita da régua é UM `PUT /gestao-trafego/regua` com o histórico junto: feita na tela
  gt_ponderada_config: { area: 'trafego', rota: '/gestao-trafego/regua', filtros: {}, ordens: [] },
  interesses_sugeridos: {
    area: 'trafego', rota: '/gestao-trafego/interesses-sugeridos',
    filtros: { account_id: eq('account_id'), marca_id: eq('marca_id'), objetivo: eq('objetivo') }, ordens: [],
  },
  data_integrity_checks: {
    area: 'admin', rota: '/saude/conferencias',
    filtros: { checked_date: eq('checked_date'), status: eq('status') }, ordens: ['checked_date', 'created_at'],
  },
}

/** A tabela já mora na API (a área dela está ligada)? */
export function tabelaNaApi(tabela) {
  const r = ROTAS[tabela]
  return !!r && areaNaApi(r.area)
}

// ── O pedido no formato PostgREST, em partes ─────────────────────────────────

/** `'t?col=eq.x&select=a,b&order=c.desc&limit=1'` → partes. */
export function lerCaminhoPostgrest(caminho) {
  const [tabela, busca = ''] = String(caminho).split('?')
  const partes = { tabela, filtros: [], select: null, ordem: [], limite: null, onConflict: null }
  for (const [k, v] of new URLSearchParams(busca)) {
    if (k === 'select') partes.select = v
    else if (k === 'order') {
      partes.ordem = v.split(',').map((o) => {
        const [col, dir, ...resto] = o.split('.')
        // `nullsfirst`/`nullslast` mudam a ordem dos nulos: sem par na rota, recusa.
        if (resto.length || (dir && dir !== 'asc' && dir !== 'desc')) throw new ErroDeTraducao(`ordem sem tradução: ${o}`)
        return { col, asc: dir !== 'desc' }
      })
    }
    else if (k === 'limit') partes.limite = Number(v)
    else if (k === 'on_conflict') partes.onConflict = v
    else {
      const i = v.indexOf('.')
      if (i < 0) throw new ErroDeTraducao(`filtro sem operador: ${k}=${v}`)
      partes.filtros.push({ col: k, op: v.slice(0, i), val: v.slice(i + 1) })
    }
  }
  return partes
}

// `eq."valor com aspas"` (paraEq) → valor; `ilike.a\_b` (paraIlike) → a_b.
function valorDoEq(v) {
  if (v.startsWith('"') && v.endsWith('"')) return v.slice(1, -1).replace(/\\(.)/g, '$1')
  return v
}
function valorDoIlike(v) {
  // curinga de verdade (sem barra antes) não tem equivalente: a rota compara igual
  if (/(^|[^\\])[%*_]/.test(v)) throw new ErroDeTraducao(`ilike com curinga não tem rota: ${v}`)
  return v.replace(/\\(.)/g, '$1')
}

function parametrosDosFiltros(def, tabela, filtros) {
  const params = {}
  for (const f of filtros) {
    const alvo = def.filtros[f.col]?.[f.op]
    if (!alvo) throw new ErroDeTraducao(`${tabela}: a rota ${def.rota} não filtra por ${f.col}=${f.op}`)
    const [p, converter] = Array.isArray(alvo) ? alvo : [alvo, null]
    let v
    if (f.op === 'eq') v = valorDoEq(f.val)
    else if (f.op === 'ilike') v = valorDoIlike(f.val)
    else if (f.op === 'in') {
      // valor com aspas pode ter vírgula dentro: o split quebraria errado — recusa.
      if (f.val.includes('"')) throw new ErroDeTraducao(`${tabela}: in com aspas não tem tradução: ${f.val}`)
      v = f.val.replace(/^\(|\)$/g, '').split(',').join(',')
    }
    else v = f.val
    if (converter) v = converter(v)
    if (p in params) throw new ErroDeTraducao(`${tabela}: filtro repetido ${p}`)
    params[p] = v
  }
  return params
}

/** As colunas pedidas em `select` (null = todas). Recurso embutido não tem rota. */
function colunasDoSelect(select) {
  if (!select || select.trim() === '*') return null
  if (/[()]/.test(select)) throw new ErroDeTraducao(`select com recurso embutido não tem rota: ${select}`)
  const cols = select.split(',').map((s) => s.trim()).filter(Boolean)
  return cols.includes('*') ? null : cols
}

function projetar(linhas, cols, tabela) {
  if (!cols) return linhas
  // Coluna que a tela pede e a rota não devolve viraria `undefined` calado.
  const falta = linhas.length ? cols.filter((c) => !(c in linhas[0])) : []
  if (falta.length) throw new ErroDeTraducao(`${tabela}: a rota não devolve ${falta.join(', ')}`)
  return linhas.map((l) => Object.fromEntries(cols.map((c) => [c, l[c]])))
}

function ordenarNaTela(linhas, ordem) {
  return [...linhas].sort((a, b) => {
    for (const { col, asc } of ordem) {
      const x = a[col], y = b[col]
      if (x === y) continue
      // nulos como o PostgREST: por último no asc, primeiro no desc
      if (x === null || x === undefined) return asc ? 1 : -1
      if (y === null || y === undefined) return asc ? -1 : 1
      const c = typeof x === 'string' && typeof y === 'string' ? x.localeCompare(y, 'pt-BR') : (x < y ? -1 : 1)
      return c * (asc ? 1 : -1)
    }
    return 0
  })
}

// ── A execução ───────────────────────────────────────────────────────────────

function erroDoSupabase(error, corpo) {
  // o formato que as telas leem do supabase-js/PostgREST: `message`, `code`
  // `details` = a frase do SERVIDOR (quando veio): a tela que traduz "sem permissão"
  // para a frase dela sabe que, aqui, a do servidor diz mais (ex.: "entrar como").
  return { message: fraseDoCorpo(corpo) || error.message, code: error.codigo || String(error.status), status: error.status, details: corpo?.mensagem || null, hint: null }
}

/**
 * Lê uma tabela pela rota. `partes` vem de `lerCaminhoPostgrest` ou do encadeado.
 * Devolve `{ data: [...], error, count }`.
 */
// Teto de páginas de uma leitura sem limite (20 × 1000 linhas). Acima disso a
// tradução recusa: ler a tabela inteira para a tela não é o que a rota promete.
const PAGINAS_NO_MAXIMO = 20

export async function lerPelaApi(partes, { contar = false } = {}) {
  const def = ROTAS[partes.tabela]
  if (!def?.rota) throw new ErroDeTraducao(`${partes.tabela}: sem rota de leitura`)
  // Filtro que a rota não declara: só `eq`/`in`, só sem limite (a leitura vem
  // INTEIRA, paginada abaixo) e numa coluna que a rota devolve — aí a tela filtra
  // as mesmas linhas que o banco filtraria. Qualquer outro caso recusa alto.
  const naTela = partes.filtros.filter((f) => !def.filtros[f.col]?.[f.op])
  if (naTela.length && (partes.limite || naTela.some((f) => f.op !== 'eq' && f.op !== 'in'))) {
    throw new ErroDeTraducao(`${partes.tabela}: a rota ${def.rota} não filtra por ${naTela.map((f) => f.col + '=' + f.op).join(', ')}`)
  }
  const params = parametrosDosFiltros(def, partes.tabela, partes.filtros.filter((f) => !naTela.includes(f)))
  const cols = colunasDoSelect(partes.select)
  // A ordem pedida vai para a rota quando ela a declara (UMA coluna: o `ordem` da
  // API aceita um campo só); senão, a tela ordena — e isso só é certo se NADA foi
  // cortado antes (sem limite).
  const naRota = partes.ordem.length === 1 && def.ordens.includes(partes.ordem[0].col)
  if (partes.ordem.length && naRota) params.ordem = partes.ordem.map((o) => `${o.col}.${o.asc ? 'asc' : 'desc'}`).join(',')
  if (partes.ordem.length && !naRota && partes.limite) {
    throw new ErroDeTraducao(`${partes.tabela}: a rota não ordena por ${partes.ordem.map((o) => o.col)} e o pedido corta em ${partes.limite}`)
  }
  if (partes.limite > TETO_DE_LINHAS) throw new ErroDeTraducao(`${partes.tabela}: limite ${partes.limite} acima do teto de ${TETO_DE_LINHAS} linhas da API`)
  if (partes.limite) params.limite = partes.limite
  // SEM LIMITE, A LEITURA VEM INTEIRA. A API (como o PostgREST, `max_rows`) para
  // em 1000 linhas por pedido; uma tela que não pediu limite queria TUDO, e cortar
  // em 1000 calado é número menor sem aviso. Conta o total e busca as páginas
  // seguintes por `deslocamento` (a ordem das rotas tem desempate: não repete
  // nem pula linha).
  if (contar || !partes.limite) params.contar = 1
  let linhas = []
  let total = null
  for (let pagina = 0; ; pagina++) {
    const r = await pedir('GET', def.rota, { params: pagina ? { ...params, deslocamento: linhas.length } : params })
    if (r.error) return { data: null, error: erroDoSupabase(r.error, r.data), count: null }
    if (!Array.isArray(r.data)) return { data: null, error: { message: 'Resposta inesperada do servidor.', code: '502' }, count: null }
    linhas = linhas.concat(r.data)
    total = r.total
    if (partes.limite || total === null || linhas.length >= total || r.data.length === 0) break
    if (pagina + 1 >= PAGINAS_NO_MAXIMO) throw new ErroDeTraducao(`${partes.tabela}: ${total} linhas — passa de ${PAGINAS_NO_MAXIMO} páginas`)
  }
  if (naTela.length) {
    if (linhas.length && naTela.some((f) => !(f.col in linhas[0]))) throw new ErroDeTraducao(`${partes.tabela}: a rota não devolve ${naTela.map((f) => f.col)}`)
    const aceita = (f, l) => (f.op === 'eq' ? [valorDoEq(f.val)] : f.val.replace(/^\(|\)$/g, '').split(',')).includes(String(l[f.col]))
    linhas = linhas.filter((l) => naTela.every((f) => aceita(f, l)))
  }
  if (partes.ordem.length && !naRota) linhas = ordenarNaTela(linhas, partes.ordem)
  return { data: projetar(linhas, cols, partes.tabela), error: null, count: naTela.length ? linhas.length : total }
}

/**
 * Quantas linhas a tabela tem para quem pede (`X-Total-Count`), sem baixá-las:
 * o `select=id` + `.length` de antes parava no teto de linhas.
 */
export async function contarPelaApi(tabela, filtros = []) {
  const r = await lerPelaApi({ tabela, filtros, select: null, ordem: [], limite: 1 }, { contar: true })
  return r.error ? null : r.count
}

function semAutoria(def, linha) {
  // A autoria vem da SESSÃO na API (Ruling 9 do 5.1: mandar = 400). O PostgREST
  // precisava dela no corpo; aqui ela sai.
  const l = { ...linha }
  for (const c of def.autoria || []) delete l[c]
  return l
}

function idDoFiltro(partes, oQue) {
  if (partes.filtros.length === 1 && partes.filtros[0].col === 'id' && partes.filtros[0].op === 'eq') return valorDoEq(partes.filtros[0].val)
  throw new ErroDeTraducao(`${partes.tabela}: ${oQue} pela API só por id (pediu ${partes.filtros.map((f) => f.col + '=' + f.op).join('&') || 'sem filtro'})`)
}

/**
 * Escreve pela rota. `operacao`: 'inserir' | 'editar' | 'apagar' | 'upsert'.
 * Devolve `{ data: [linhas]|null, error }`, como o supabase-js com `.select()`.
 */
export async function escreverPelaApi(operacao, partes, corpo) {
  const def = ROTAS[partes.tabela]
  if (!def) throw new ErroDeTraducao(`${partes.tabela}: sem rota`)
  const linhas = corpo === undefined ? [] : (Array.isArray(corpo) ? corpo : [corpo]).map((l) => semAutoria(def, l))
  const um = async (metodo, caminho, c) => {
    const r = await pedir(metodo, caminho, { corpo: c })
    if (r.error) return { erro: erroDoSupabase(r.error, r.data) }
    return { linha: r.data }
  }
  let res = []
  if (operacao === 'upsert') {
    if (!def.upsert) throw new ErroDeTraducao(`${partes.tabela}: sem upsert na API`)
    const p = def.upsert(linhas)
    const r = await um(p.metodo, p.caminho, p.corpo)
    if (r.erro) return { data: null, error: r.erro }
    res = Array.isArray(r.linha) ? r.linha : (r.linha ? [r.linha] : [])
  } else if (operacao === 'inserir') {
    for (const l of linhas) {
      const r = await um('POST', def.rota, l)
      if (r.erro) return { data: null, error: r.erro }
      res.push(r.linha)
    }
  } else if (operacao === 'editar') {
    if (linhas.length !== 1) throw new ErroDeTraducao(`${partes.tabela}: editar pede um corpo`)
    const r = await um('PATCH', `${def.rota}/${encodeURIComponent(idDoFiltro(partes, 'editar'))}`, linhas[0])
    if (r.erro) return { data: null, error: r.erro }
    res = [r.linha]
  } else if (operacao === 'apagar') {
    const f = partes.filtros
    const atalho = f.length === 1 && f[0].op === 'eq' && def.apagarPor?.[f[0].col]
    if (atalho) {
      const v = valorDoEq(f[0].val)
      const p = atalho(v)
      const r = await um(p.metodo, p.caminho, p.corpo)
      // A rota responde 204 também quando não havia linha: o que se sabe é que a
      // linha daquela chave NÃO EXISTE mais — e é isso que a tela pergunta.
      return r.erro ? { data: null, error: r.erro } : { data: [{ [f[0].col]: v }], error: null }
    }
    let ids
    if (f.length === 1 && f[0].col === 'id' && f[0].op === 'eq') ids = [valorDoEq(f[0].val)]
    else {
      // Apagar por chave natural (ex.: `equipes_permissoes` por equipe+pessoa+chave):
      // a API apaga por id (Ruling 14 do 5.1). Lê as linhas com os filtros que a rota
      // tem, confere o resto aqui e apaga cada id — as MESMAS linhas que o PostgREST
      // apagaria. Coluna que nem a rota nem a linha conhecem: recusa.
      const naRota = f.filter((x) => def.filtros[x.col]?.[x.op])
      const naTela = f.filter((x) => !def.filtros[x.col]?.[x.op])
      if (!naRota.length || naTela.some((x) => x.op !== 'eq')) throw new ErroDeTraducao(`${partes.tabela}: apagar sem id e sem filtro da rota`)
      const lidas = await lerPelaApi({ ...partes, filtros: naRota, select: null, ordem: [], limite: null })
      if (lidas.error) return { data: null, error: lidas.error }
      if (lidas.data.length && naTela.some((x) => !(x.col in lidas.data[0]))) throw new ErroDeTraducao(`${partes.tabela}: a rota não devolve ${naTela.map((x) => x.col)}`)
      const alvo = lidas.data.filter((l) => naTela.every((x) => String(l[x.col]) === valorDoEq(x.val)))
      ids = alvo.map((l) => l.id)
    }
    for (const id of ids) {
      const r = await um('DELETE', `${def.rota}/${encodeURIComponent(id)}`)
      if (r.erro) return { data: null, error: r.erro }
    }
    // As linhas apagadas, como o PostgREST devolve com `return=representation`:
    // há tela que CONTA o que voltou para saber se apagou (grupo, supervisora).
    // A rota de apagar responde 204 e não lê a linha antes; o id é o que se sabe.
    return { data: ids.map((id) => ({ id })), error: null }
  } else throw new ErroDeTraducao(`operação desconhecida: ${operacao}`)
  return { data: res, error: null }
}

// ── Fachada 1: o encadeado do supabase-js ────────────────────────────────────

class ConsultaPelaApi {
  constructor(tabela) {
    this.p = { tabela, filtros: [], select: null, ordem: [], limite: null }
    this.op = 'ler'; this.corpo = undefined; this.devolver = false; this.unico = null; this.contar = false; this.soContar = false
  }
  select(cols = '*', opcoes = {}) {
    if (this.op === 'ler') this.p.select = cols
    else this.devolver = true
    if (opcoes.count) this.contar = true
    if (opcoes.head) this.soContar = true
    return this
  }
  eq(col, val) { this.p.filtros.push({ col, op: 'eq', val: String(val) }); return this }
  ilike(col, val) { this.p.filtros.push({ col, op: 'ilike', val: String(val) }); return this }
  in(col, vals) { this.p.filtros.push({ col, op: 'in', val: vals.join(',') }); return this }
  gte(col, val) { this.p.filtros.push({ col, op: 'gte', val: String(val) }); return this }
  lte(col, val) { this.p.filtros.push({ col, op: 'lte', val: String(val) }); return this }
  order(col, { ascending = true, nullsFirst } = {}) {
    // a ordem dos nulos não tem par na rota: recusa na execução (o encadeado não lança)
    if (nullsFirst !== undefined) this.recusa = `ordem com nullsFirst não tem tradução: ${col}`
    this.p.ordem.push({ col, asc: ascending }); return this
  }
  limit(n) { this.p.limite = n; return this }
  single() { this.unico = 'single'; return this }
  maybeSingle() { this.unico = 'maybe'; return this }
  insert(corpo) { this.op = 'inserir'; this.corpo = corpo; return this }
  update(corpo) { this.op = 'editar'; this.corpo = corpo; return this }
  upsert(corpo) { this.op = 'upsert'; this.corpo = corpo; return this }
  delete() { this.op = 'apagar'; return this }
  async executar() {
    try {
      if (this.recusa) throw new ErroDeTraducao(this.recusa)
      if (this.op === 'ler') {
        // `head: true` só conta: uma linha basta (o `X-Total-Count` traz o total);
        // sem isto a leitura sem limite baixava a tabela inteira para contar
        const p = this.soContar && this.p.limite == null ? { ...this.p, limite: 1 } : this.p
        const r = await lerPelaApi(p, { contar: this.contar })
        if (r.error) return { data: null, error: r.error, count: null }
        if (this.soContar) return { data: null, error: null, count: r.count }
        if (this.unico) {
          if (r.data.length > 1 || (this.unico === 'single' && r.data.length === 0)) {
            return { data: null, error: { message: 'JSON object requested, multiple (or no) rows returned', code: 'PGRST116' } }
          }
          return { data: r.data[0] ?? null, error: null, count: r.count }
        }
        return { data: r.data, error: null, count: r.count }
      }
      const r = await escreverPelaApi(this.op, this.p, this.corpo)
      if (r.error) return { data: null, error: r.error }
      if (!this.devolver) return { data: null, error: null }
      const linhas = r.data || []
      return { data: this.unico ? (linhas[0] ?? null) : linhas, error: null }
    } catch (e) {
      if (e instanceof ErroDeTraducao) console.error('[banco-pela-api]', e.message)
      return { data: null, error: { message: e.message, code: 'traducao' } }
    }
  }
  // `status` como o supabase-js (há tela que o passa a `classificarErro`).
  then(ok, falha) { return this.executar().then((r) => ({ ...r, status: r.error ? (r.error.status || 500) : 200 })).then(ok, falha) }
}

/**
 * `deOnde(sbClient).from('t')`: a tabela vai pela API quando a área dela está
 * ligada; senão, é o MESMO `sbClient.from('t')` de sempre.
 */
/** A consulta pela API, sem olhar a chave (para os testes e para quem já decidiu). */
export function consultaPelaApi(tabela) { return new ConsultaPelaApi(tabela) }

export function deOnde(sbClient) {
  return { from: (tabela) => (tabelaNaApi(tabela) ? new ConsultaPelaApi(tabela) : sbClient.from(tabela)) }
}

// ── Fachada 2: o `fetch` do PostgREST (adFetch, gravar) ──────────────────────

function respostaDeMentira(status, corpo, { total = null } = {}) {
  const texto = corpo === undefined || corpo === null ? '' : JSON.stringify(corpo)
  const ok = status >= 200 && status < 300
  // `Content-Range` como o PostgREST com `Prefer: count=exact` ("0-0/N").
  const faixaDeLinhas = total === null ? null : `${Array.isArray(corpo) && corpo.length ? `0-${corpo.length - 1}` : '*'}/${total}`
  return {
    ok, status,
    json: async () => (texto ? JSON.parse(texto) : null),
    // Erro: a FRASE (há tela que faz `throw new Error(await r.text())`), não o JSON cru.
    text: async () => (ok ? texto : (corpo?.message || texto)),
    headers: { get: (k) => (String(k).toLowerCase() === 'content-range' ? faixaDeLinhas : null) },
  }
}

/**
 * Para quem faz `fetch(…/rest/v1/<caminho>, opcoes)` e lê o `Response`. Só se
 * chama com `tabelaNaApi(tabela)` verdadeiro. Mantém o que as telas leem:
 * `Prefer: return=representation` devolve o array; sem ele, 201/204 vazio.
 */
export async function fetchPostgrest(caminho, opcoes = {}) {
  const metodo = (opcoes.method || 'GET').toUpperCase()
  const prefer = String(opcoes.headers?.Prefer || opcoes.headers?.prefer || '')
  try {
    const partes = lerCaminhoPostgrest(caminho)
    const corpo = opcoes.body ? JSON.parse(opcoes.body) : undefined
    if (metodo === 'GET') {
      const contar = /count=exact/.test(prefer)
      const r = await lerPelaApi(partes, { contar })
      return r.error ? respostaDeMentira(r.error.status || 500, r.error) : respostaDeMentira(200, r.data, { total: contar ? r.count : null })
    }
    const op = metodo === 'POST' ? (/resolution=merge-duplicates/.test(prefer) || partes.onConflict ? 'upsert' : 'inserir')
      : metodo === 'PATCH' ? 'editar' : metodo === 'DELETE' ? 'apagar' : null
    if (!op) throw new ErroDeTraducao(`método ${metodo} sem tradução`)
    const r = await escreverPelaApi(op, partes, corpo)
    if (r.error) return respostaDeMentira(r.error.status || 500, r.error)
    if (/return=representation/.test(prefer)) return respostaDeMentira(metodo === 'POST' ? 201 : 200, r.data || [])
    if (metodo === 'DELETE') return respostaDeMentira(204, null)
    return respostaDeMentira(metodo === 'POST' ? 201 : 204, null)
  } catch (e) {
    if (e instanceof ErroDeTraducao) console.error('[banco-pela-api]', e.message)
    return respostaDeMentira(500, { message: e.message, code: 'traducao' })
  }
}
