import { test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { mkdtempSync, readFileSync, existsSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { symlinkSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { copiarBucket, selecionarBuckets, esperaDoRetry } from './copiar-storage.mjs'

const cont = (v) => (typeof v === 'string' ? v : v.c)
function servidor(arvore) {
  // arvore: { 'a.txt': 'oi', 'pasta/c.bin': 'xyz', '../fora.txt': 'mau' }
  let baixados = 0
  const srv = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x')
    if (req.headers.authorization !== 'Bearer segredo') { res.writeHead(401).end(); return }
    if (req.method === 'POST' && u.pathname === '/storage/v1/object/list/b') {
      let corpo = ''
      req.on('data', (d) => (corpo += d))
      req.on('end', () => {
        const { prefix = '', limit = 100, offset = 0 } = JSON.parse(corpo)
        const nomes = Object.keys(arvore).filter((k) => k.startsWith(prefix))
        const itens = new Map()
        for (const k of nomes) {
          const resto = k.slice(prefix.length)
          const i = resto.indexOf('/')
          if (i < 0) itens.set(resto, { name: resto, id: 'id-' + k, metadata: { size: Buffer.byteLength(cont(arvore[k])) }, updated_at: typeof arvore[k] === 'object' ? arvore[k].u : undefined })
          else itens.set(resto.slice(0, i), { name: resto.slice(0, i), id: null, metadata: null })
        }
        const lista = [...itens.values()].slice(offset, offset + limit)
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(lista))
      })
      return
    }
    if (req.method === 'GET' && u.pathname.startsWith('/storage/v1/object/authenticated/b/')) {
      const k = decodeURIComponent(u.pathname.slice('/storage/v1/object/authenticated/b/'.length))
      if (k in arvore) { baixados++; res.writeHead(200).end(cont(arvore[k])); return }
    }
    res.writeHead(404).end()
  })
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r({ srv, url: `http://127.0.0.1:${srv.address().port}`, baixados: () => baixados })))
}

test('copia arquivos e pastas, e uma segunda rodada pula o que já está igual', async () => {
  const { srv, url, baixados } = await servidor({ 'a.txt': 'oi', 'pasta/c.bin': 'xyz' })
  try {
    const destino = mkdtempSync(join(tmpdir(), 'st-'))
    const r1 = await copiarBucket({ url, chave: 'segredo', bucket: 'b', destino })
    assert.deepEqual([r1.copiados, r1.pulados, r1.bytes], [2, 0, 5])
    assert.equal(readFileSync(join(destino, 'b', 'a.txt'), 'utf8'), 'oi')
    assert.equal(readFileSync(join(destino, 'b', 'pasta', 'c.bin'), 'utf8'), 'xyz')
    const r2 = await copiarBucket({ url, chave: 'segredo', bucket: 'b', destino })
    assert.deepEqual([r2.copiados, r2.pulados], [0, 2])
    assert.equal(baixados(), 2) // nada baixado de novo
  } finally { srv.close() }
})

test('nome de objeto com .. não escreve fora da pasta de destino', async () => {
  const { srv, url } = await servidor({ '../fora.txt': 'mau', 'ok.txt': 'bom' })
  try {
    const raiz = mkdtempSync(join(tmpdir(), 'st-'))
    const destino = join(raiz, 'dest')
    await assert.rejects(() => copiarBucket({ url, chave: 'segredo', bucket: 'b', destino }), /caminho inseguro/)
    assert.equal(existsSync(join(raiz, 'fora.txt')), false)
    assert.equal(readdirSync(raiz).includes('fora.txt'), false)
  } finally { srv.close() }
})

test('arquivo parcial (tamanho diferente) é baixado de novo', async () => {
  const { srv, url } = await servidor({ 'a.txt': 'conteudo-inteiro' })
  try {
    const destino = mkdtempSync(join(tmpdir(), 'st-'))
    await copiarBucket({ url, chave: 'segredo', bucket: 'b', destino })
    const { writeFileSync } = await import('node:fs')
    writeFileSync(join(destino, 'b', 'a.txt'), 'conte') // simula cópia interrompida
    const r = await copiarBucket({ url, chave: 'segredo', bucket: 'b', destino })
    assert.deepEqual([r.copiados, r.pulados], [1, 0])
    assert.equal(readFileSync(join(destino, 'b', 'a.txt'), 'utf8'), 'conteudo-inteiro')
  } finally { srv.close() }
})

test('chave errada falha com erro claro e sem imprimir a chave', async () => {
  const { srv, url } = await servidor({ 'a.txt': 'x' })
  try {
    const destino = mkdtempSync(join(tmpdir(), 'st-'))
    await assert.rejects(() => copiarBucket({ url, chave: 'errada', bucket: 'b', destino }), (e) => /401/.test(e.message) && !/errada/.test(e.message))
  } finally { srv.close() }
})

test('nomes inseguros (barra inicial, contrabarra, controle) são recusados e nada escapa', async () => {
  for (const nome of ['/abs.txt', 'x\\y.txt', 'ctl\u0001.txt', 'pasta/../../fora.txt', 'a/./b.txt', 'a//b.txt']) {
    const { srv, url } = await servidor({ [nome]: 'mau' })
    try {
      const raiz = mkdtempSync(join(tmpdir(), 'st-'))
      await assert.rejects(() => copiarBucket({ url, chave: 'segredo', bucket: 'b', destino: join(raiz, 'dest') }), /caminho inseguro/)
      assert.deepEqual(readdirSync(raiz), ['dest'])
      assert.deepEqual(readdirSync(join(raiz, 'dest', 'b')), [])
    } finally { srv.close() }
  }
})

test('cópia interrompida no meio do corpo não deixa arquivo parcial (nem .parcial) e é retomada', async () => {
  const { srv, url } = await servidor({ 'a.txt': 'conteudo' })
  try {
    const destino = mkdtempSync(join(tmpdir(), 'st-'))
    const f = async (u, init) => {
      if (!u.includes('/authenticated/')) return fetch(u, init)
      return new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('cont')); c.error(new Error('queda')) } }))
    }
    await assert.rejects(() => copiarBucket({ url, chave: 'segredo', bucket: 'b', destino, fetch: f, espera: 1 }), /queda/)
    assert.deepEqual(readdirSync(join(destino, 'b')), []) // nem a.txt nem a.txt.parcial
    const r = await copiarBucket({ url, chave: 'segredo', bucket: 'b', destino })
    assert.deepEqual([r.copiados, r.pulados], [1, 0])
    assert.deepEqual(readdirSync(join(destino, 'b')), ['a.txt'])
  } finally { srv.close() }
})

// Storage de mentira sem servidor: lista fixa por prefixo e download por Response
const enc = new TextEncoder()
function falso(listas, { baixar = (caminho) => new Response(enc.encode('xx')) } = {}) {
  const chamadas = []
  const f = async (u, init) => {
    const p = new URL(u).pathname
    chamadas.push(p)
    if (init.method === 'POST') return new Response(JSON.stringify(listas[JSON.parse(init.body).prefix] || []))
    return baixar(decodeURIComponent(p.slice('/storage/v1/object/authenticated/b/'.length)), chamadas.length)
  }
  return { f, chamadas }
}
const arq = (name) => ({ name, id: 'i-' + name, metadata: { size: 2 }, updated_at: '2026-01-01T00:00:00.000Z' })

test('503 e 429 são repetidos com backoff e depois dá certo; 401 não é repetido', async () => {
  let n = 0
  const { f } = falso({ '': [arq('a.txt')] }, { baixar: () => (++n < 3 ? new Response('x', { status: n === 1 ? 503 : 429 }) : new Response(enc.encode('xx'))) })
  const r = await copiarBucket({ url: 'http://x', chave: 'k', bucket: 'b', destino: mkdtempSync(join(tmpdir(), 'st-')), fetch: f, espera: 1 })
  assert.deepEqual([r.copiados, n], [1, 3])

  let m = 0
  const g = async () => { m++; return new Response('{}', { status: 401 }) }
  await assert.rejects(() => copiarBucket({ url: 'http://x', chave: 'k', bucket: 'b', destino: mkdtempSync(join(tmpdir(), 'st-')), fetch: g, espera: 1 }), /401/)
  assert.equal(m, 1)
  let h = 0
  const k = async () => { h++; return new Response('{}', { status: 503 }) }
  await assert.rejects(() => copiarBucket({ url: 'http://x', chave: 'k', bucket: 'b', destino: mkdtempSync(join(tmpdir(), 'st-')), fetch: k, espera: 1 }), /503/)
  assert.equal(h, 3) // 3 tentativas e desiste
})

test('objeto listado e apagado antes do download (404) é pulado com aviso e não derruba o bucket', async () => {
  const avisos = []
  const { f } = falso({ '': [arq('a.txt'), arq('b.txt')] }, { baixar: (c) => (c === 'a.txt' ? new Response('{}', { status: 404 }) : new Response(enc.encode('xx'))) })
  const destino = mkdtempSync(join(tmpdir(), 'st-'))
  const r = await copiarBucket({ url: 'http://x', chave: 'k', bucket: 'b', destino, fetch: f, aviso: (m) => avisos.push(m) })
  assert.deepEqual([r.copiados, r.sumiram, r.falhas], [1, 1, 0])
  assert.match(avisos[0], /a\.txt/)
  assert.deepEqual(readdirSync(join(destino, 'b')), ['b.txt'])
})

test('objeto "a" e pasta "a/" no mesmo bucket: erro por objeto, conta em falhas e os demais seguem (nas duas ordens)', async () => {
  const pasta = { name: 'a', id: null, metadata: null }
  for (const ordem of [[arq('a'), pasta, arq('z')], [pasta, arq('a'), arq('z')]]) {
    const avisos = []
    const { f } = falso({ '': ordem, 'a/': [arq('b')] })
    const destino = mkdtempSync(join(tmpdir(), 'st-'))
    const r = await copiarBucket({ url: 'http://x', chave: 'k', bucket: 'b', destino, fetch: f, aviso: (m) => avisos.push(m) })
    assert.equal(r.falhas, 1)
    assert.equal(r.copiados, 2) // z e (a ou a/b)
    assert.ok(existsSync(join(destino, 'b', 'z')))
    assert.match(avisos.join('\n'), /conflito entre arquivo e pasta/)
    assert.equal(readdirSync(join(destino, 'b')).some((n) => n.endsWith('.parcial')), false)
  }
})

test('nome com 250 bytes (+ .parcial passaria de 255) usa temporário curto e copia normalmente', async () => {
  const nome = 'x'.repeat(250)
  const { f } = falso({ '': [arq(nome)] })
  const destino = mkdtempSync(join(tmpdir(), 'st-'))
  const r = await copiarBucket({ url: 'http://x', chave: 'k', bucket: 'b', destino, fetch: f })
  assert.deepEqual([r.copiados, r.falhas], [1, 0])
  assert.deepEqual(readdirSync(join(destino, 'b')), [nome])
})

test('erro de rede mostra o código da causa (e a mensagem dela, sem a chave), nunca o e.message do fetch', async () => {
  let n = 0
  const f = async () => {
    n++
    const causa = Object.assign(new AggregateError([Object.assign(new Error('x'), { code: 'ECONNREFUSED' })], 'recusado com SEGREDOK'), {})
    throw new TypeError('fetch failed SEGREDOK', { cause: causa })
  }
  await assert.rejects(() => copiarBucket({ url: 'http://x', chave: 'SEGREDOK', bucket: 'b', destino: mkdtempSync(join(tmpdir(), 'st-')), fetch: f, espera: 1 }),
    (e) => /ECONNREFUSED/.test(e.message) && /recusado com \*\*\*/.test(e.message) && !/SEGREDOK/.test(e.message))
  assert.equal(n, 3) // erro de rede é repetido
  // de verdade, contra uma porta fechada
  await assert.rejects(() => copiarBucket({ url: 'http://127.0.0.1:58699', chave: 'segredo', bucket: 'b', destino: mkdtempSync(join(tmpdir(), 'st-')), espera: 1 }), /ECONNREFUSED/)
})

test('download em streaming: arquivo grande copiado inteiro, com tamanho conferido', async () => {
  const grande = Buffer.alloc(5 * 1024 * 1024, 7)
  const { f } = falso({ '': [{ ...arq('g.bin'), metadata: { size: grande.length } }] }, { baixar: () => new Response(grande) })
  const destino = mkdtempSync(join(tmpdir(), 'st-'))
  const r = await copiarBucket({ url: 'http://x', chave: 'k', bucket: 'b', destino, fetch: f })
  assert.equal(r.bytes, grande.length)
  assert.equal(readFileSync(join(destino, 'b', 'g.bin')).equals(grande), true)
  // tamanho diferente do listado: falha e não deixa nada
  const { f: f2 } = falso({ '': [{ ...arq('h.bin'), metadata: { size: 3 } }] }, { baixar: () => new Response(grande) })
  await assert.rejects(() => copiarBucket({ url: 'http://x', chave: 'k', bucket: 'b', destino, fetch: f2 }), /tamanho baixado difere/)
  assert.equal(existsSync(join(destino, 'b', 'h.bin')), false)
  assert.equal(readdirSync(join(destino, 'b')).some((n) => n.endsWith('.parcial')), false)
})

// servidor de mentira programável: handler(req, res, n) com n = número da requisição (1, 2, ...)
function simples(handler) {
  let n = 0
  const srv = http.createServer((req, res) => { req.resume(); handler(req, res, ++n) })
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r({ srv, url: `http://127.0.0.1:${srv.address().port}` })))
}
const lista1 = (nome, tam) => JSON.stringify([{ name: nome, id: 'i', metadata: { size: tam }, updated_at: '2026-01-01T00:00:00.000Z' }])
const dest = () => mkdtempSync(join(tmpdir(), 'st-'))

test('esperaDoRetry: backoff 1 s, 3 s, 9 s; Retry-After vale, com teto de 30 s', () => {
  assert.deepEqual([1, 2, 3].map((i) => esperaDoRetry({}, i, 1000)), [1000, 3000, 9000])
  assert.equal(esperaDoRetry({ retryAfterMs: 2000 }, 1, 1000), 2000)
  assert.equal(esperaDoRetry({ retryAfterMs: 999000 }, 1, 1000), 30000)
})

test('Retry-After de um 503 é respeitado (espera o que o servidor mandou)', async () => {
  const { srv, url } = await simples((req, res, n) => {
    if (req.method === 'POST') return res.end(lista1('a.txt', 2))
    if (n === 2) return res.writeHead(503, { 'retry-after': '1' }).end()
    res.end('xx')
  })
  try {
    const t0 = Date.now()
    const r = await copiarBucket({ url, chave: 'k', bucket: 'b', destino: dest(), espera: 1 })
    assert.equal(r.copiados, 1)
    assert.ok(Date.now() - t0 >= 900, `esperou só ${Date.now() - t0} ms`)
  } finally { srv.close() }
})

test('503 sem Retry-After (ou com valor inválido) espera o backoff normal; com data HTTP espera até ela', async () => {
  const medir = async (cabecalho, espera) => {
    const { srv, url } = await simples((req, res, n) => {
      if (req.method === 'POST') return res.end(lista1('a.txt', 2))
      if (n === 2) return res.writeHead(503, cabecalho ? { 'retry-after': cabecalho() } : {}).end()
      res.end('xx')
    })
    try {
      const t0 = Date.now()
      const r = await copiarBucket({ url, chave: 'k', bucket: 'b', destino: dest(), espera })
      assert.equal(r.copiados, 1)
      return Date.now() - t0
    } finally { srv.close() }
  }
  assert.ok(await medir(null, 300) >= 250, 'sem cabeçalho repetiu sem esperar o backoff')
  assert.ok(await medir(() => '-5', 300) >= 250, 'valor negativo deveria cair no backoff')
  assert.ok(await medir(() => 'Infinity', 300) >= 250, 'Infinity deveria cair no backoff')
  assert.ok(await medir(() => '', 300) >= 250, 'vazio deveria cair no backoff')
  const t = await medir(() => new Date(Date.now() + 2500).toUTCString(), 1) // data HTTP ~1,5 a 2,5 s à frente
  assert.ok(t >= 1000, `data HTTP: esperou só ${t} ms`)
})

test('timeout de cabeçalhos: servidor que nunca responde falha com TIMEOUT', async () => {
  const { srv, url } = await simples(() => {})
  try {
    await assert.rejects(() => copiarBucket({ url, chave: 'k', bucket: 'b', destino: dest(), cabecalhosMs: 100, tentativas: 1 }), /TIMEOUT/)
  } finally { srv.closeAllConnections?.(); srv.close() }
})

test('corpo que trava sem progresso falha citando o objeto; corpo lento mas com progresso passa', async () => {
  const { srv, url } = await simples((req, res, n) => {
    if (req.method === 'POST') return res.end(lista1('a.txt', 6))
    res.writeHead(200); res.write('ab')            // 2 de 6 bytes e trava
  })
  try {
    await assert.rejects(() => copiarBucket({ url, chave: 'k', bucket: 'b', destino: dest(), inatividadeMs: 150, tentativas: 1 }),
      (e) => /falha ao baixar "a\.txt"/.test(e.message) && /sem progresso/.test(e.message))
  } finally { srv.closeAllConnections?.(); srv.close() }
  const lento = await simples((req, res) => {
    if (req.method === 'POST') return res.end(lista1('a.txt', 6))
    res.writeHead(200)
    let i = 0; const t = setInterval(() => { res.write('ab'); if (++i === 3) { clearInterval(t); res.end() } }, 100) // 300 ms no total > inatividadeMs
  })
  try {
    const r = await copiarBucket({ url: lento.url, chave: 'k', bucket: 'b', destino: dest(), inatividadeMs: 250, tentativas: 1 })
    assert.equal(r.bytes, 6)
  } finally { lento.srv.close() }
})

test('queda no meio do corpo registra o caminho do objeto', async () => {
  const { srv, url } = await simples((req, res) => {
    if (req.method === 'POST') return res.end(lista1('pasta-x.bin', 10))
    res.writeHead(200, { 'content-length': '10' }); res.write('abc'); setTimeout(() => res.destroy(), 20)
  })
  try {
    await assert.rejects(() => copiarBucket({ url, chave: 'k', bucket: 'b', destino: dest(), espera: 1, tentativas: 2 }), /falha ao baixar "pasta-x\.bin"/)
  } finally { srv.close() }
})

test('corpo da LISTAGEM cortado no meio é repetido e depois dá certo', async () => {
  const { srv, url } = await simples((req, res, n) => {
    if (req.method === 'POST' && n === 1) { res.writeHead(200, { 'content-length': '1000' }); res.write('[{"na'); setTimeout(() => res.destroy(), 20); return }
    if (req.method === 'POST') return res.end(lista1('a.txt', 2))
    res.end('xx')
  })
  try {
    const r = await copiarBucket({ url, chave: 'k', bucket: 'b', destino: dest(), espera: 1 })
    assert.equal(r.copiados, 1)
  } finally { srv.close() }
})

test('seleção de buckets é explícita: incluir, excluir e nenhum filtro', () => {
  const todos = ['a', 'ig-cache', 'fotos-modelo', 'c']
  assert.deepEqual(selecionarBuckets(todos, {}), todos)
  assert.deepEqual(selecionarBuckets(todos, { excluir: ['ig-cache', 'fotos-modelo'] }), ['a', 'c'])
  assert.deepEqual(selecionarBuckets(todos, { incluir: ['c', 'a'] }), ['a', 'c'])
  assert.throws(() => selecionarBuckets(todos, { incluir: ['nao-existe'] }), /nao-existe/)
})

test('bucket com nome malicioso (..) não escreve fora do destino', async () => {
  const raiz = mkdtempSync(join(tmpdir(), 'st-'))
  for (const bucket of ['..', '.', 'a/b', '/x']) {
    await assert.rejects(() => copiarBucket({ url: 'http://127.0.0.1:1', chave: 'segredo', bucket, destino: join(raiz, 'dest') }), /caminho inseguro/)
  }
  assert.deepEqual(readdirSync(raiz).filter((n) => n !== 'dest'), [])
})

test('chave com caractere inválido no cabeçalho não vaza na mensagem', async () => {
  const { srv, url } = await servidor({ 'a.txt': 'x' })
  try {
    const destino = mkdtempSync(join(tmpdir(), 'st-'))
    const chave = 'SEGREDO-ABC\nDEF'
    await assert.rejects(() => copiarBucket({ url, chave, bucket: 'b', destino }), (e) => /falha ao chamar o Storage em \/storage\/v1\/object\/list\/b/.test(e.message) && !/SEGREDO|ABC|DEF/.test(e.message + String(e.cause ?? '')))
  } finally { srv.close() }
})

test('objeto sobrescrito na origem com o mesmo tamanho é recopiado (tamanho + updated_at)', async () => {
  const arv = { 'a.txt': { c: 'aaaa', u: '2026-01-01T00:00:00.000Z' }, 'b.txt': { c: 'bbbb', u: '2026-01-01T00:00:00.000Z' } }
  const { srv, url, baixados } = await servidor(arv)
  try {
    const destino = mkdtempSync(join(tmpdir(), 'st-'))
    await copiarBucket({ url, chave: 'segredo', bucket: 'b', destino })
    assert.equal(baixados(), 2)
    arv['a.txt'] = { c: 'zzzz', u: '2026-02-01T00:00:00.000Z' }
    const r = await copiarBucket({ url, chave: 'segredo', bucket: 'b', destino })
    assert.deepEqual([r.copiados, r.pulados], [1, 1])
    assert.equal(readFileSync(join(destino, 'b', 'a.txt'), 'utf8'), 'zzzz')
  } finally { srv.close() }
})

test('o fetch não segue redirecionamento (a chave não vai para outra origem)', async () => {
  const modos = []
  const f = async (u, init) => { modos.push(init.redirect); return { ok: true, json: async () => [] } }
  await copiarBucket({ url: 'http://x', chave: 'segredo', bucket: 'b', destino: mkdtempSync(join(tmpdir(), 'st-')), fetch: f })
  assert.deepEqual(modos, ['error'])
})

test('seleção valida --excluir desconhecido', () => {
  assert.throws(() => selecionarBuckets(['a'], { excluir: ['zzz'] }), /zzz/)
})

test('CLI roda via symlink (uso e saída 2 sem argumentos)', () => {
  const d = mkdtempSync(join(tmpdir(), 'st-'))
  const ln = join(d, 'ln.mjs')
  symlinkSync(fileURLToPath(new URL('./copiar-storage.mjs', import.meta.url)), ln)
  const r = spawnSync(process.execPath, [ln], { encoding: 'utf8', env: {} })
  assert.equal(r.status, 2)
  assert.match(r.stderr, /uso:/)
})
