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

// Filtro: coluna → { operador do PostgREST → parâmetro da rota }. `lista`
// marca o parâmetro que aceita vários valores por vírgula (`texto[]` no Go).
const eq = (p) => ({ eq: p })
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
    else if (k === 'order') partes.ordem = v.split(',').map((o) => { const [col, dir] = o.split('.'); return { col, asc: dir !== 'desc' } })
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
    const p = def.filtros[f.col]?.[f.op]
    if (!p) throw new ErroDeTraducao(`${tabela}: a rota ${def.rota} não filtra por ${f.col}=${f.op}`)
    let v
    if (f.op === 'eq') v = valorDoEq(f.val)
    else if (f.op === 'ilike') v = valorDoIlike(f.val)
    else if (f.op === 'in') v = f.val.replace(/^\(|\)$/g, '').split(',').map(valorDoEq).join(',')
    else v = f.val
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
      if (x === null || x === undefined) return 1
      if (y === null || y === undefined) return -1
      return (x < y ? -1 : 1) * (asc ? 1 : -1)
    }
    return 0
  })
}

// ── A execução ───────────────────────────────────────────────────────────────

function erroDoSupabase(error, corpo) {
  // o formato que as telas leem do supabase-js/PostgREST: `message`, `code`
  return { message: fraseDoCorpo(corpo) || error.message, code: error.codigo || String(error.status), status: error.status, details: null, hint: null }
}

/**
 * Lê uma tabela pela rota. `partes` vem de `lerCaminhoPostgrest` ou do encadeado.
 * Devolve `{ data: [...], error, count }`.
 */
export async function lerPelaApi(partes, { contar = false } = {}) {
  const def = ROTAS[partes.tabela]
  if (!def?.rota) throw new ErroDeTraducao(`${partes.tabela}: sem rota de leitura`)
  const params = parametrosDosFiltros(def, partes.tabela, partes.filtros)
  const cols = colunasDoSelect(partes.select)
  // A ordem pedida vai para a rota quando ela a declara; senão, a tela ordena —
  // e isso só é certo se NADA foi cortado antes (sem limite).
  const naRota = partes.ordem.length > 0 && partes.ordem.every((o) => def.ordens.includes(o.col))
  if (partes.ordem.length && naRota) params.ordem = partes.ordem.map((o) => `${o.col}.${o.asc ? 'asc' : 'desc'}`).join(',')
  if (partes.ordem.length && !naRota && partes.limite) {
    throw new ErroDeTraducao(`${partes.tabela}: a rota não ordena por ${partes.ordem.map((o) => o.col)} e o pedido corta em ${partes.limite}`)
  }
  if (partes.limite) params.limite = partes.limite
  if (contar) params.contar = 1
  const r = await pedir('GET', def.rota, { params })
  if (r.error) return { data: null, error: erroDoSupabase(r.error, r.data), count: null }
  if (!Array.isArray(r.data)) return { data: null, error: { message: 'Resposta inesperada do servidor.', code: '502' }, count: null }
  let linhas = r.data
  if (partes.ordem.length && !naRota) linhas = ordenarNaTela(linhas, partes.ordem)
  return { data: projetar(linhas, cols, partes.tabela), error: null, count: r.total }
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
      const p = atalho(valorDoEq(f[0].val))
      const r = await um(p.metodo, p.caminho, p.corpo)
      return r.erro ? { data: null, error: r.erro } : { data: null, error: null }
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
    return { data: null, error: null }
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
  order(col, { ascending = true } = {}) { this.p.ordem.push({ col, asc: ascending }); return this }
  limit(n) { this.p.limite = n; return this }
  single() { this.unico = 'single'; return this }
  maybeSingle() { this.unico = 'maybe'; return this }
  insert(corpo) { this.op = 'inserir'; this.corpo = corpo; return this }
  update(corpo) { this.op = 'editar'; this.corpo = corpo; return this }
  upsert(corpo) { this.op = 'upsert'; this.corpo = corpo; return this }
  delete() { this.op = 'apagar'; return this }
  async executar() {
    try {
      if (this.op === 'ler') {
        const r = await lerPelaApi(this.p, { contar: this.contar })
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
  then(ok, falha) { return this.executar().then(ok, falha) }
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

function respostaDeMentira(status, corpo) {
  const texto = corpo === undefined || corpo === null ? '' : JSON.stringify(corpo)
  return {
    ok: status >= 200 && status < 300, status,
    json: async () => (texto ? JSON.parse(texto) : null),
    text: async () => texto,
    headers: { get: () => null },
  }
}

/**
 * Para quem faz `fetch(…/rest/v1/<caminho>, opcoes)` e lê o `Response`. Só se
 * chama com `tabelaNaApi(tabela)` verdadeiro. Mantém o que as telas leem:
 * `Prefer: return=representation` devolve o array; sem ele, 201/204 vazio.
 */
export async function fetchPostgrest(caminho, opcoes = {}) {
  const partes = lerCaminhoPostgrest(caminho)
  const metodo = (opcoes.method || 'GET').toUpperCase()
  const prefer = String(opcoes.headers?.Prefer || opcoes.headers?.prefer || '')
  const corpo = opcoes.body ? JSON.parse(opcoes.body) : undefined
  try {
    if (metodo === 'GET') {
      const r = await lerPelaApi(partes)
      return r.error ? respostaDeMentira(r.error.status || 500, r.error) : respostaDeMentira(200, r.data)
    }
    const op = metodo === 'POST' ? (/resolution=merge-duplicates/.test(prefer) || partes.onConflict ? 'upsert' : 'inserir')
      : metodo === 'PATCH' ? 'editar' : metodo === 'DELETE' ? 'apagar' : null
    if (!op) throw new ErroDeTraducao(`método ${metodo} sem tradução`)
    const r = await escreverPelaApi(op, partes, corpo)
    if (r.error) return respostaDeMentira(r.error.status || 500, r.error)
    if (/return=representation/.test(prefer)) return respostaDeMentira(metodo === 'POST' ? 201 : 200, r.data || [])
    return respostaDeMentira(metodo === 'POST' ? 201 : 204, null)
  } catch (e) {
    if (e instanceof ErroDeTraducao) console.error('[banco-pela-api]', e.message)
    return respostaDeMentira(500, { message: e.message, code: 'traducao' })
  }
}
