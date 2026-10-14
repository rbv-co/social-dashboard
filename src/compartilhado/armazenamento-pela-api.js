// O STORAGE QUE JÁ MORA NA API EM GO (Plano 7; API-PRONTA, "Vessel pública, Storage e o espelho (Plano 6)").
//
// As telas falam com o Storage do Supabase por `sbClient.storage.from(bucket).list/upload/remove/copy/
// createSignedUrl(s)/getPublicUrl`. A API em Go guarda os objetos em disco, com as mesmas regras de bucket
// (`/arquivos/{bucket}`). Em vez de reescrever cada sítio, `storageNaArea(area, sbClient)` devolve o próprio
// `sbClient.storage` (chave da área desligada) ou um objeto com os MESMOS métodos e o MESMO `{ data, error }`.
//
// Só os métodos que alguma tela usa existem aqui; chamar outro lança (ALTO, como a ponte do PostgREST):
// cair calado no Storage do Supabase com a sessão da API ligada daria "sua sessão expirou" sem explicação.

import { areaNaApi, fetchDaApi, fraseDoCorpo, BASE_DA_API } from './api.js'

const enc = (caminho) => String(caminho).split('/').map(encodeURIComponent).join('/')

// A URL relativa que a API devolve (`/storage/v1/object/...`) ganha a base da API (`/api` ou um host).
function comBase(relativa) {
  const base = String(BASE_DA_API).replace(/\/+$/, '')
  const abs = /^https?:\/\//i.test(base) ? base : (typeof location !== 'undefined' ? location.origin : '') + base
  return abs + relativa
}

async function resposta(r) {
  const corpo = await r.json().catch(() => null)
  if (r.ok) return { data: corpo, error: null }
  const frase = fraseDoCorpo(corpo) || `O servidor respondeu ${r.status}.`
  return { data: null, error: { message: frase, status: r.status, statusCode: String(r.status) } }
}

async function chamar(caminho, init) {
  try {
    return await resposta(await fetchDaApi(caminho, init))
  } catch (e) {
    return { data: null, error: { message: 'Failed to fetch', status: 0, statusCode: '0' } }
  }
}

const json = (corpo) => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) })

function bucketNaApi(bucket) {
  const base = `/arquivos/${encodeURIComponent(bucket)}`
  return {
    // `list(pasta, { limit, sortBy: { order } })`: a API ordena por nome (`ordem=desc|asc`).
    async list(prefixo = '', opcoes = {}) {
      const p = new URLSearchParams()
      if (prefixo) p.set('prefixo', prefixo)
      if (opcoes.limit) p.set('limite', String(opcoes.limit))
      if (opcoes.sortBy && opcoes.sortBy.column && opcoes.sortBy.column !== 'name') throw new Error(`storage.list: a API só ordena por nome (pediu ${opcoes.sortBy.column})`)
      if (opcoes.sortBy?.order) p.set('ordem', opcoes.sortBy.order)
      return chamar(base + (p.size ? `?${p}` : ''))
    },
    // O corpo vai cru; `x-upsert` troca o que já existe (sem ele, 409).
    async upload(caminho, arquivo, opcoes = {}) {
      const tipo = opcoes.contentType || arquivo?.type || 'application/octet-stream'
      const headers = { 'Content-Type': tipo }
      if (opcoes.upsert) headers['x-upsert'] = 'true'
      const r = await chamar(`${base}/${enc(caminho)}`, { method: 'PUT', headers, body: arquivo })
      return r.error ? r : { data: { path: caminho, fullPath: r.data?.Key || `${bucket}/${caminho}` }, error: null }
    },
    async remove(caminhos) {
      return chamar(base, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ caminhos }) })
    },
    async copy(de, para) {
      const r = await chamar(`${base}/copiar`, json({ de, para }))
      return r.error ? r : { data: { path: para }, error: null }
    },
    // `download: 'nome.pdf'` (ou `true`) = a URL baixa em vez de abrir.
    async createSignedUrl(caminho, segundos, opcoes = {}) {
      const r = await this.createSignedUrls([caminho], segundos, opcoes)
      if (r.error) return r
      const par = r.data[0]
      return par?.error ? { data: null, error: { message: par.error, status: 404, statusCode: '404' } } : { data: { signedUrl: par.signedUrl }, error: null }
    },
    async createSignedUrls(caminhos, segundos, opcoes = {}) {
      const baixar = opcoes.download === true ? String(caminhos[0]).split('/').pop() : (opcoes.download || '')
      const r = await chamar(`${base}/assinar`, json({ caminhos, segundos, ...(baixar ? { baixar } : {}) }))
      if (r.error) return r
      return { data: (r.data || []).map((p) => ({ path: p.caminho, signedUrl: p.url ? comBase(p.url) : null, error: p.erro || null })), error: null }
    },
    // Síncrono como o do supabase-js: a URL pública é do caminho, não precisa de ida ao servidor.
    getPublicUrl(caminho) {
      return { data: { publicUrl: comBase(`/storage/v1/object/public/${encodeURIComponent(bucket)}/${enc(caminho)}`) } }
    },
  }
}

/** `sbClient.storage` quando a área não está na API; senão o mesmo desenho, pelas rotas `/arquivos`. */
export function storageNaArea(area, sbClient) {
  return areaNaApi(area) ? { from: (bucket) => bucketNaApi(bucket) } : sbClient.storage
}

/** Para os testes e para quem já decidiu (sem olhar a chave). */
export function storagePelaApi() {
  return { from: (bucket) => bucketNaApi(bucket) }
}
