import test from 'node:test'
import assert from 'node:assert/strict'

process.env.ZOHO_REFRESH_TOKEN = 'r'; process.env.ZOHO_CLIENT_ID = 'i'; process.env.ZOHO_CLIENT_SECRET = 's'
const { listarPasta, acharOuCriarPasta, baixarArquivo } = await import('./zoho-workdrive.mjs')

const resposta = (corpo, ok = true, status = 200) => ({ ok, status, json: async () => corpo, text: async () => JSON.stringify(corpo), arrayBuffer: async () => Buffer.from(corpo.bytes ?? '') })
const item = (n, nome, pasta = true) => ({ id: 'id' + n, attributes: { name: nome, is_folder: pasta } })

function falsoZoho(paginas, { aoCriar } = {}) {
  const chamadas = []
  globalThis.fetch = async (url, opts = {}) => {
    chamadas.push(String(url))
    if (String(url).includes('oauth/v2/token')) return resposta({ access_token: 't' })
    if (opts.method === 'POST') { aoCriar?.(); return resposta({ data: { id: 'novo' } }) }
    const offset = Number(new URL(url).searchParams.get('page[offset]') ?? 0)
    return resposta({ data: paginas[offset / 50] ?? [] })
  }
  return chamadas
}

test('lista TODAS as páginas, não só as primeiras 50 (a pasta Vessel Brasil tem dezenas de subpastas)', async () => {
  const p1 = Array.from({ length: 50 }, (_, i) => item(i, 'pasta ' + i))
  const p2 = [item(50, 'Cartões com EAN'), item(51, 'outra')]
  const chamadas = falsoZoho([p1, p2])
  const itens = await listarPasta('raiz')
  assert.equal(itens.length, 52)
  assert.equal(itens.at(-2).name, 'Cartões com EAN')
  assert.equal(chamadas.filter((c) => c.includes('/files/raiz/files')).length, 2)
})

test('acha a pasta que existe na 2ª página, mesmo com acento decomposto, e NÃO cria outra igual', async () => {
  let criou = false
  falsoZoho([Array.from({ length: 50 }, (_, i) => item(i, 'x' + i)), [item(99, 'Cartões com EAN'.normalize('NFD').replace('Cartões', 'Cartões'.normalize('NFD')))]], { aoCriar: () => { criou = true } })
  const id = await acharOuCriarPasta('raiz-nfc', 'Cartões com EAN')
  assert.equal(id, 'id99')
  assert.equal(criou, false)
})

test('download devolve os bytes e o erro de permissão LANÇA, em vez de virar arquivo vazio', async () => {
  globalThis.fetch = async (url) => String(url).includes('oauth/v2/token') ? resposta({ access_token: 't' })
    : String(url).includes('/download/ok') ? resposta({ bytes: 'abc' }) : resposta({}, false, 403)
  assert.equal((await baixarArquivo('ok')).toString(), 'abc')
  await assert.rejects(baixarArquivo('negado'), /403/)
})
