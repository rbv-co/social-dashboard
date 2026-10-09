// Copia os objetos de um bucket do Supabase Storage para uma pasta local, de forma retomável:
// um arquivo já presente com o MESMO tamanho e a mesma data (mtime = updated_at do objeto, como no rsync)
// é pulado; um parcial ou desatualizado é baixado de novo.
// Uso: SUPABASE_URL=... SUPABASE_SERVICE_KEY=... node copiar-storage.mjs --destino DIR [--incluir a,b | --bucket x] [--excluir a,b]
import { mkdirSync, statSync, writeFileSync, renameSync, existsSync, utimesSync, realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve, sep } from 'node:path'

const PAGINA = 100

// Seleção explícita de buckets: sem filtro = todos. ig-cache e fotos-modelo são caches regeneráveis;
// migrar ou regenerar é decisão do dono, por isso nada vem excluído por padrão.
export function selecionarBuckets(todos, { incluir, excluir = [] } = {}) {
  const falta = [...(incluir || []), ...excluir].filter((b) => !todos.includes(b))
  if (falta.length) throw new Error(`bucket inexistente: ${[...new Set(falta)].join(', ')}`)
  if (incluir?.length) {
    return todos.filter((b) => incluir.includes(b) && !excluir.includes(b))
  }
  return todos.filter((b) => !excluir.includes(b))
}

function seguro(destinoBucket, caminho) {
  const alvo = resolve(destinoBucket, caminho)
  const raiz = resolve(destinoBucket) + sep
  if (/[\u0000-\u001f\\]/.test(caminho) || caminho.split('/').some((s) => s === '' || s === '.' || s === '..') || !alvo.startsWith(raiz)) {
    throw new Error(`caminho inseguro no Storage: ${JSON.stringify(caminho)}`)
  }
  return alvo
}

async function chamar(f, url, chave, init = {}) {
  let r
  try {
    // redirect: 'error' — a chave nunca segue um redirecionamento para outra origem
    r = await f(url, { ...init, redirect: 'error', headers: { authorization: `Bearer ${chave}`, apikey: chave, ...(init.headers || {}) } })
  } catch (e) {
    // nunca e.message: o erro do fetch pode conter o valor do cabeçalho (a chave)
    throw new Error(`falha ao chamar o Storage em ${new URL(url).pathname}: ${e.cause?.code || e.name}`)
  }
  if (!r.ok) throw new Error(`Storage respondeu ${r.status} em ${new URL(url).pathname}`) // sem a chave na mensagem
  return r
}

async function listar(f, url, chave, bucket, prefixo) {
  const itens = []
  for (let offset = 0; ; offset += PAGINA) {
    const r = await chamar(f, `${url}/storage/v1/object/list/${encodeURIComponent(bucket)}`, chave, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prefix: prefixo, limit: PAGINA, offset, sortBy: { column: 'name', order: 'asc' } }),
    })
    const pagina = await r.json()
    itens.push(...pagina)
    if (pagina.length < PAGINA) return itens
  }
}

export async function copiarBucket({ url, chave, bucket, destino, fetch: f = fetch }) {
  const res = { copiados: 0, pulados: 0, bytes: 0 }
  if (bucket.includes('/')) throw new Error(`caminho inseguro no Storage: ${JSON.stringify(bucket)}`) // bucket é um único segmento
  const destinoBucket = seguro(destino, bucket)
  mkdirSync(destinoBucket, { recursive: true })
  async function visitar(prefixo) {
    for (const it of await listar(f, url, chave, bucket, prefixo)) {
      const caminho = prefixo + it.name
      if (it.id === null) { await visitar(caminho + '/'); continue }
      const alvo = seguro(destinoBucket, caminho)
      const tam = it.metadata?.size
      const quando = it.updated_at ? new Date(it.updated_at) : null
      if (tam != null && existsSync(alvo)) {
        const st = statSync(alvo)
        if (st.size === tam && (!quando || Math.abs(st.mtimeMs - quando.getTime()) < 1000)) { res.pulados++; continue }
      }
      const r = await chamar(f, `${url}/storage/v1/object/authenticated/${encodeURIComponent(bucket)}/${caminho.split('/').map(encodeURIComponent).join('/')}`, chave)
      const buf = Buffer.from(await r.arrayBuffer())
      if (tam != null && buf.length !== tam) throw new Error(`tamanho baixado difere do listado em ${JSON.stringify(caminho)}`)
      mkdirSync(dirname(alvo), { recursive: true })
      writeFileSync(alvo + '.parcial', buf); renameSync(alvo + '.parcial', alvo) // nunca deixa meio-arquivo com o nome final
      if (quando) utimesSync(alvo, quando, quando)
      res.copiados++; res.bytes += buf.length
    }
  }
  await visitar('')
  return res
}

async function principal() {
  const arg = (n) => { const i = process.argv.indexOf(n); return i < 0 ? undefined : process.argv[i + 1] }
  const destino = arg('--destino'); const incluir = [arg('--bucket'), ...(arg('--incluir') || '').split(',')].filter(Boolean); const excluir = (arg('--excluir') || '').split(',').filter(Boolean)
  const url = process.env.SUPABASE_URL; const chave = process.env.SUPABASE_SERVICE_KEY
  if (!destino || !url || !chave) { console.error('uso: SUPABASE_URL=... SUPABASE_SERVICE_KEY=... node copiar-storage.mjs --destino DIR [--incluir a,b | --bucket x] [--excluir a,b]'); process.exit(2) }
  const r = await chamar(fetch, `${url}/storage/v1/bucket`, chave)
  const todos = (await r.json()).map((b) => b.name)
  let buckets
  try { buckets = selecionarBuckets(todos, { incluir, excluir }) } catch (e) { console.error(e.message); process.exit(2) }
  console.log(`buckets selecionados: ${buckets.join(', ') || '(nenhum)'}`)
  console.log(`buckets não copiados: ${todos.filter((b) => !buckets.includes(b)).join(', ') || '(nenhum)'}`)
  let total = { copiados: 0, pulados: 0, bytes: 0 }
  for (const b of buckets) {
    const x = await copiarBucket({ url, chave, bucket: b, destino })
    console.log(`${b}: ${x.copiados} copiados, ${x.pulados} pulados, ${(x.bytes / 1e6).toFixed(1)} MB`)
    for (const k of Object.keys(total)) total[k] += x[k]
  }
  console.log(`total: ${total.copiados} copiados, ${total.pulados} pulados, ${(total.bytes / 1e6).toFixed(1)} MB`)
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) principal().catch((e) => { console.error(e.message); process.exit(1) })
