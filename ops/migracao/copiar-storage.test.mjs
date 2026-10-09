import { test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { mkdtempSync, readFileSync, existsSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { symlinkSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { copiarBucket, selecionarBuckets } from './copiar-storage.mjs'

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

test('cópia interrompida não deixa arquivo parcial com nome final e é retomada', async () => {
  const { srv, url } = await servidor({ 'a.txt': 'conteudo' })
  try {
    const destino = mkdtempSync(join(tmpdir(), 'st-'))
    const f = async (u, init) => { const r = await fetch(u, init); return u.includes('/authenticated/') ? { ok: true, arrayBuffer: async () => { throw new Error('queda') } } : r }
    await assert.rejects(() => copiarBucket({ url, chave: 'segredo', bucket: 'b', destino, fetch: f }), /queda/)
    assert.equal(existsSync(join(destino, 'b', 'a.txt')), false)
    const r = await copiarBucket({ url, chave: 'segredo', bucket: 'b', destino })
    assert.deepEqual([r.copiados, r.pulados], [1, 0])
    assert.deepEqual(readdirSync(join(destino, 'b')), ['a.txt'])
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
