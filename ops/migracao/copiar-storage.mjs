// Copia os objetos de um bucket do Supabase Storage para uma pasta local, de forma retomável:
// um arquivo já presente com o MESMO tamanho e a mesma data (mtime = updated_at do objeto, como no rsync)
// é pulado; um parcial ou desatualizado é baixado de novo.
//
// Limites conhecidos (documentados, não corrigidos):
//  - A listagem pagina por OFFSET: objeto criado/apagado no bucket durante a cópia pode ser pulado ou
//    repetido. No corte a origem está congelada; fora dele, rode de novo e confira os totais.
//  - NÃO apaga nada no destino: objeto removido na origem continua na pasta de destino. Se a pasta for
//    REUTILIZADA, dado pessoal já apagado na origem (LGPD) permanece nela; use uma pasta nova a cada
//    rodada (o ensaio.sh já faz isso) ou apague a pasta antiga.
// Falhas por objeto (conflito arquivo × pasta, nome longo demais) são contadas em "falhas" e a cópia
// continua; qualquer falha faz o comando sair com 1. Objeto listado e apagado antes do download
// (404) é pulado com aviso e contado em "sumiram" (não é falha). 401/403 nunca são repetidos.
// Uso: SUPABASE_URL=... SUPABASE_SERVICE_KEY=... node copiar-storage.mjs --destino DIR [--incluir a,b | --bucket x] [--excluir a,b]
import { mkdirSync, statSync, renameSync, existsSync, utimesSync, realpathSync, createWriteStream, rmSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
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

const CODIGOS_DE_CONFLITO = ['EEXIST', 'ENOTDIR', 'EISDIR', 'ENOTEMPTY', 'ENAMETOOLONG']
const esperar = (ms) => new Promise((r) => setTimeout(r, ms))
const TETO_RETRY_AFTER_MS = 30000

// Quanto esperar antes da tentativa seguinte (i = tentativa que acabou de falhar): backoff espera, 3×espera,
// 9×espera (1 s, 3 s, 9 s com o padrão); se o servidor mandou Retry-After (em segundos), vale ele, com teto de 30 s.
export function esperaDoRetry(e, i, espera) {
  if (e.retryAfterMs != null) return Math.min(e.retryAfterMs, TETO_RETRY_AFTER_MS)
  return espera * 3 ** (i - 1)
}

// Até `tentativas` execuções enquanto o erro for `retentavel`.
async function comRetry(fn, { tentativas = 3, espera = 1000 } = {}) {
  for (let i = 1; ; i++) {
    try { return await fn() } catch (e) {
      if (!e.retentavel || i >= tentativas) throw e
      await esperar(esperaDoRetry(e, i, espera))
    }
  }
}

// Timeouts: `cabecalhosMs` até chegarem os cabeçalhos da resposta; depois disso o corpo só cai se ficar
// `inatividadeMs` SEM nenhum progresso (objeto grande em link lento não falha enquanto os bytes fluem).
async function chamar(f, url, chave, init = {}, { cabecalhosMs = 60000 } = {}) {
  const ctl = new AbortController()
  let estourou = false
  const t = setTimeout(() => { estourou = true; ctl.abort() }, cabecalhosMs)
  let r
  try {
    // redirect: 'error' — a chave nunca segue um redirecionamento para outra origem
    r = await f(url, { ...init, redirect: 'error', signal: ctl.signal, headers: { authorization: `Bearer ${chave}`, apikey: chave, ...(init.headers || {}) } })
  } catch (e) {
    // nunca e.message do fetch (pode conter o valor do cabeçalho, a chave): só o código e a mensagem da CAUSA
    // (erro de rede do undici), com a chave mascarada por garantia
    const codigo = estourou ? 'TIMEOUT' : e.cause?.errors?.[0]?.code || e.cause?.code || e.name
    const msg = estourou ? ` (sem cabeçalhos em ${cabecalhosMs} ms)` : e.cause?.message ? ` (${String(e.cause.message).split(chave).join('***')})` : ''
    const err = new Error(`falha ao chamar o Storage em ${new URL(url).pathname}: ${codigo}${msg}`)
    err.retentavel = !(e instanceof TypeError && !e.cause) // TypeError sem causa = argumento inválido, não rede
    throw err
  } finally { clearTimeout(t) }
  r.ctl = ctl
  if (!r.ok) {
    const err = new Error(`Storage respondeu ${r.status} em ${new URL(url).pathname}`) // sem a chave na mensagem
    err.status = r.status
    err.retentavel = r.status === 429 || r.status >= 500
    const ra = Number(r.headers?.get?.('retry-after'))
    if ((r.status === 429 || r.status === 503) && Number.isFinite(ra) && ra >= 0) err.retryAfterMs = ra * 1000
    await r.body?.cancel?.().catch(() => {})
    throw err
  }
  return r
}

// Vigia de inatividade do corpo: aborta a requisição se passar `ms` sem progresso. tocar() reinicia o relógio.
function vigia(ctl, ms) {
  let t, estourou = false
  const tocar = () => { clearTimeout(t); t = setTimeout(() => { estourou = true; ctl.abort() }, ms) }
  return { tocar, parar: () => clearTimeout(t), estourou: () => estourou }
}

// Lê o corpo JSON com vigia de inatividade; queda no meio do corpo é repetível (retentavel).
async function lerJson(r, inatividadeMs) {
  if (!r.body) return r.json()
  const v = vigia(r.ctl, inatividadeMs); v.tocar()
  try {
    const partes = []
    for await (const c of Readable.fromWeb(r.body)) { v.tocar(); partes.push(c) }
    return JSON.parse(Buffer.concat(partes).toString('utf8'))
  } catch (e) {
    const err = new Error(v.estourou() ? `corpo da resposta sem progresso por ${inatividadeMs} ms` : `corpo da resposta interrompido: ${e.cause?.code || e.name}`)
    err.retentavel = true
    throw err
  } finally { v.parar() }
}

async function listar(f, url, chave, bucket, prefixo, opc) {
  const itens = []
  for (let offset = 0; ; offset += PAGINA) {
    const pagina = await comRetry(async () => {
      const r = await chamar(f, `${url}/storage/v1/object/list/${encodeURIComponent(bucket)}`, chave, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prefix: prefixo, limit: PAGINA, offset, sortBy: { column: 'name', order: 'asc' } }),
      }, opc)
      return lerJson(r, opc.inatividadeMs)
    }, opc)
    itens.push(...pagina)
    if (pagina.length < PAGINA) return itens
  }
}

// Nome do arquivo temporário: "<nome>.parcial", ou um nome curto derivado de hash quando o nome do objeto
// já ocupa tanto que o ".parcial" estouraria o limite de 255 bytes do sistema de arquivos.
function nomeTemporario(alvo) {
  const base = alvo.slice(alvo.lastIndexOf('/') + 1)
  if (Buffer.byteLength(base) < 248) return alvo + '.parcial'
  return join(dirname(alvo), '.' + createHash('sha256').update(alvo).digest('hex').slice(0, 24) + '.parcial')
}

export async function copiarBucket({ url, chave, bucket, destino, fetch: f = fetch, tentativas = 3, espera = 1000, cabecalhosMs = 60000, inatividadeMs = 60000, aviso = console.error }) {
  const res = { copiados: 0, pulados: 0, bytes: 0, sumiram: 0, falhas: 0 }
  const opc = { tentativas, espera, cabecalhosMs, inatividadeMs }
  if (bucket.includes('/')) throw new Error(`caminho inseguro no Storage: ${JSON.stringify(bucket)}`) // bucket é um único segmento
  const destinoBucket = seguro(destino, bucket)
  mkdirSync(destinoBucket, { recursive: true })

  // baixa para o temporário em streaming (sem o objeto inteiro na memória), confere o tamanho e renomeia
  async function baixar(caminho, alvo, tam) {
    const tmp = nomeTemporario(alvo)
    try {
      return await comRetry(async () => {
        const r = await chamar(f, `${url}/storage/v1/object/authenticated/${encodeURIComponent(bucket)}/${caminho.split('/').map(encodeURIComponent).join('/')}`, chave, {}, opc)
        mkdirSync(dirname(alvo), { recursive: true })
        const v = vigia(r.ctl, inatividadeMs); v.tocar()
        const toque = new Transform({ transform(c, _e, cb) { v.tocar(); cb(null, c) } })
        try { await pipeline(Readable.fromWeb(r.body), toque, createWriteStream(tmp)) } catch (e) {
          if (!e.syscall) e.retentavel = true // queda no meio do corpo; erro do disco (syscall) não se repete
          // registra QUAL objeto caiu (o erro do undici é só "terminated"); sem a chave
          // (erro novo: o message de alguns erros, como o AbortError, é só leitura)
          const novo = new Error(`falha ao baixar ${JSON.stringify(caminho)}: ${v.estourou() ? `sem progresso por ${inatividadeMs} ms` : String(e.message).split(chave).join('***')}${e.cause?.code ? ` (${e.cause.code})` : ''}`)
          Object.assign(novo, { retentavel: e.retentavel, code: e.code, syscall: e.syscall })
          throw novo
        } finally { v.parar() }
        const bytes = statSync(tmp).size
        if (tam != null && bytes !== tam) throw new Error(`tamanho baixado difere do listado em ${JSON.stringify(caminho)}`)
        renameSync(tmp, alvo) // nunca deixa meio-arquivo com o nome final
        return bytes
      }, opc)
    } finally { rmSync(tmp, { force: true }) } // some se a rename já o moveu; limpa o resto em caso de falha
  }

  async function visitar(prefixo) {
    for (const it of await listar(f, url, chave, bucket, prefixo, opc)) {
      const caminho = prefixo + it.name
      if (it.id === null) { await visitar(caminho + '/'); continue }
      const alvo = seguro(destinoBucket, caminho)
      const tam = it.metadata?.size
      const quando = it.updated_at ? new Date(it.updated_at) : null
      if (tam != null && existsSync(alvo)) {
        const st = statSync(alvo)
        if (st.isFile() && st.size === tam && (!quando || Math.abs(st.mtimeMs - quando.getTime()) < 1000)) { res.pulados++; continue }
      }
      let bytes
      try { bytes = await baixar(caminho, alvo, tam) } catch (e) {
        if (e.status === 404) { aviso(`aviso: objeto listado e depois apagado, pulado: ${JSON.stringify(caminho)}`); res.sumiram++; continue }
        if (CODIGOS_DE_CONFLITO.includes(e.code)) {
          aviso(`ERRO: não foi possível gravar ${JSON.stringify(caminho)} (${e.code}: ${e.code === 'ENAMETOOLONG' ? 'nome longo demais' : 'conflito entre arquivo e pasta de mesmo nome'}); a cópia segue`)
          res.falhas++; continue
        }
        throw e
      }
      if (quando) utimesSync(alvo, quando, quando)
      res.copiados++; res.bytes += bytes
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
  const todos = (await comRetry(async () => lerJson(await chamar(fetch, `${url}/storage/v1/bucket`, chave), 60000))).map((b) => b.name)
  let buckets
  try { buckets = selecionarBuckets(todos, { incluir, excluir }) } catch (e) { console.error(e.message); process.exit(2) }
  console.log(`buckets selecionados: ${buckets.join(', ') || '(nenhum)'}`)
  console.log(`buckets não copiados: ${todos.filter((b) => !buckets.includes(b)).join(', ') || '(nenhum)'}`)
  let total = { copiados: 0, pulados: 0, bytes: 0, sumiram: 0, falhas: 0 }
  for (const b of buckets) {
    const x = await copiarBucket({ url, chave, bucket: b, destino })
    console.log(`${b}: ${x.copiados} copiados, ${x.pulados} pulados, ${(x.bytes / 1e6).toFixed(1)} MB, ${x.sumiram} sumiram, ${x.falhas} falhas`)
    for (const k of Object.keys(total)) total[k] += x[k]
  }
  console.log(`total: ${total.copiados} copiados, ${total.pulados} pulados, ${(total.bytes / 1e6).toFixed(1)} MB, ${total.sumiram} sumiram, ${total.falhas} falhas`)
  if (total.falhas) { console.error(`${total.falhas} objeto(s) NÃO copiados (ver ERRO acima)`); process.exit(1) }
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) principal().catch((e) => { console.error(e.message); process.exit(1) })
