import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  lerCredenciaisDoTexto,
  credenciaisDoPainel,
  criarEntrada,
  fraseDoLogin,
} from './entrar.js'

const AQUI = dirname(fileURLToPath(import.meta.url))
const ARQUIVO_DO_PAINEL = join(AQUI, '..', 'src', 'compartilhado', 'conectar-no-banco-de-dados.js')

// ── AS CREDENCIAIS SAEM DO PAINEL, NÃO DAQUI ───────────────────────────────
// ⚠️ ESTE ARQUIVO NÃO PODE IMPORTAR o módulo do painel: a última linha dele
// chama `window.supabase.createClient(...)`, e no Node não existe `window` — o
// programa morreria no arranque. Então lê-se o TEXTO do arquivo. Continua sendo
// uma fonte só: chave rotacionada no painel chega aqui sozinha, sem cópia.

test('as credenciais saem do texto do módulo do painel', () => {
  const { url, chave } = lerCredenciaisDoTexto(
    "export const SUPABASE_URL = 'https://exemplo.supabase.co'\n"
    + "export const SUPABASE_ANON_KEY = 'abc.def.ghi'\n",
  )
  assert.equal(url, 'https://exemplo.supabase.co')
  assert.equal(chave, 'abc.def.ghi')
})

test('aspas duplas e espaçamento diferente também são lidos', () => {
  const { url, chave } = lerCredenciaisDoTexto(
    'export const SUPABASE_URL="https://x.supabase.co"\n'
    + 'export  const  SUPABASE_ANON_KEY = "k.k.k"\n',
  )
  assert.equal(url, 'https://x.supabase.co')
  assert.equal(chave, 'k.k.k')
})

test('texto sem as constantes é recusado com recado, não devolve vazio', () => {
  assert.throws(() => lerCredenciaisDoTexto('nada aqui'), /conectar-no-banco-de-dados/)
  assert.throws(() => lerCredenciaisDoTexto(''), /conectar-no-banco-de-dados/)
})

// A prova de que o caminho até o painel está certo DE VERDADE, no arquivo que
// existe. Se alguém mover o módulo, este teste cai aqui e não na bancada.
test('o arquivo de verdade do painel é lido, e é o projeto certo', () => {
  const { url, chave } = credenciaisDoPainel()
  assert.equal(url, 'https://kounqtdoioootxqegkij.supabase.co')
  assert.match(chave, /^ey[\w-]+\.[\w-]+\.[\w-]+$/)
  assert.ok(readFileSync(ARQUIVO_DO_PAINEL, 'utf8').includes(chave))
})

// ⚠️ A CHAVE SECRETA NUNCA VAI DENTRO DE UM PROGRAMA QUE RODA NA BANCADA. Ela
// passa por cima de toda trava do banco. Esta asserção é o que impede alguém de
// "consertar uma permissão" trocando a chave e só descobrir o tamanho do
// estrago depois.
test('a chave usada é a de quem não entrou (anon/publishable), nunca a secreta', () => {
  const { chave } = credenciaisDoPainel()
  const miolo = JSON.parse(Buffer.from(chave.split('.')[1], 'base64url').toString('utf8'))
  assert.equal(miolo.role, 'anon')
  assert.notEqual(miolo.role, 'service_role')
})

// ── ENTRAR COM A CONTA DA PESSOA ───────────────────────────────────────────
// Cada pessoa entra com a conta dela porque é `auth.uid()` que as funções do
// banco carimbam. Uma conta de programa gravaria tudo em nome de ninguém.

function clienteDeMentira({
  aoEntrar = async () => ({ data: { user: { id: 'u1', email: 'quem@rbv.com' } }, error: null }),
  aoChamar = async () => ({ data: { ok: true }, error: null }),
  aoBuscar = async () => ({ data: { codigo: 'PECA01', gravada_em: '2026-09-01T12:00:00Z' }, error: null }),
  registro = [],
} = {}) {
  return {
    registro,
    opcoes: null,
    auth: {
      async signInWithPassword(dados) { registro.push({ o_que: 'entrar', dados }); return aoEntrar(dados) },
      async signOut() { registro.push({ o_que: 'sair' }); return { error: null } },
      async getUser() { return { data: { user: registro.some((r) => r.o_que === 'entrar') ? { id: 'u1', email: 'quem@rbv.com' } : null }, error: null } },
    },
    async rpc(nome, args) { registro.push({ o_que: 'rpc', nome, args }); return aoChamar(nome, args) },
    from(tabela) {
      return {
        select() { return this },
        eq(campo, valor) { registro.push({ o_que: 'buscar', tabela, campo, valor }); return this },
        maybeSingle() { return aoBuscar() },
      }
    },
  }
}

function entradaDeMentira(cliente, extras = {}) {
  return criarEntrada({
    criarCliente: (url, chave, opcoes) => { cliente.opcoes = { url, chave, opcoes }; return cliente },
    ...extras,
  })
}

test('entrar manda e-mail e senha e devolve quem entrou', async () => {
  const cliente = clienteDeMentira()
  const entrada = entradaDeMentira(cliente)
  const quem = await entrada.entrar('quem@rbv.com', 'segredo')
  assert.equal(quem.email, 'quem@rbv.com')
  assert.deepEqual(cliente.registro[0].dados, { email: 'quem@rbv.com', password: 'segredo' })
})

// ⚠️ A SESSÃO NÃO FICA GUARDADA NO COMPUTADOR DA BANCADA, de propósito. O
// computador é de todo mundo: sessão guardada faria a pessoa seguinte gravar
// vinte etiquetas em nome de quem trabalhou antes dela — e o motivo de haver
// login é justamente saber QUEM gravou cada peça.
test('a sessão não é guardada no disco: quem senta na bancada entra com a conta dele', () => {
  const cliente = clienteDeMentira()
  entradaDeMentira(cliente)
  assert.equal(cliente.opcoes.opcoes.auth.persistSession, false)
})

test('e-mail ou senha em branco nem chegam a sair pela rede', async () => {
  const cliente = clienteDeMentira()
  const entrada = entradaDeMentira(cliente)
  await assert.rejects(() => entrada.entrar('', 'x'), /e-?mail/i)
  await assert.rejects(() => entrada.entrar('a@b.com', ''), /senha/i)
  assert.equal(cliente.registro.length, 0)
})

test('senha errada vira frase de gente, não "Invalid login credentials"', async () => {
  const cliente = clienteDeMentira({
    aoEntrar: async () => ({ data: null, error: { message: 'Invalid login credentials', status: 400 } }),
  })
  await assert.rejects(() => entradaDeMentira(cliente).entrar('a@b.com', 'errada'), (e) => {
    assert.match(e.message, /senha|e-?mail/i)
    assert.doesNotMatch(e.message, /Invalid login credentials/)
    return true
  })
})

test('sem internet, a frase fala de internet — e não manda trocar a senha', async () => {
  const cliente = clienteDeMentira({
    aoEntrar: async () => { throw Object.assign(new Error('fetch failed'), { name: 'TypeError' }) },
  })
  await assert.rejects(() => entradaDeMentira(cliente).entrar('a@b.com', 'x'), /internet|conex/i)
})

test('cada falha de login conhecida tem frase própria', () => {
  for (const msg of ['Invalid login credentials', 'Email not confirmed', 'fetch failed',
    'Too many requests', 'coisa nunca vista']) {
    assert.ok(fraseDoLogin({ message: msg }).length > 30, `"${msg}" ficou sem frase`)
  }
  assert.ok(fraseDoLogin(null).length > 30)
})

// ── O PORTÃO É O `if` DE DENTRO DA FUNÇÃO, NÃO O LOGIN ─────────────────────
// ⚠️ Entrar não é ter permissão. As funções do banco conferem `is_vessel_admin()`
// por dentro e devolvem `sem_permissao` sem estourar erro nenhum. Descobrir isso
// só na quinquagésima etiqueta é gravar um lote inteiro que o sistema não
// registrou.
test('logo depois de entrar dá para conferir se a pessoa passa no portão do banco', async () => {
  const cliente = clienteDeMentira({ aoChamar: async () => ({ data: { ok: true }, error: null }) })
  const entrada = entradaDeMentira(cliente)
  await entrada.entrar('a@b.com', 'x')
  assert.deepEqual(await entrada.conferirAcesso(), { ok: true, frase: '' })
})

test('quem entra mas não passa no portão ouve isso ANTES de gastar etiqueta', async () => {
  const cliente = clienteDeMentira({
    aoChamar: async () => ({ data: { ok: false, motivo: 'sem_permissao' }, error: null }),
  })
  const entrada = entradaDeMentira(cliente)
  await entrada.entrar('a@b.com', 'x')
  const r = await entrada.conferirAcesso()
  assert.equal(r.ok, false)
  assert.match(r.frase, /permiss[ãa]o/i)
})

// ── MARCAR NO SISTEMA ──────────────────────────────────────────────────────

test('marcar chama vessel_marcar_gravada com o código em maiúsculas', async () => {
  const cliente = clienteDeMentira()
  const entrada = entradaDeMentira(cliente)
  await entrada.entrar('a@b.com', 'x')
  const r = await entrada.marcarGravada({ codigo: 'peca01' })
  assert.equal(r.ok, true)
  const chamada = cliente.registro.find((x) => x.o_que === 'rpc')
  assert.equal(chamada.nome, 'vessel_marcar_gravada')
  assert.deepEqual(chamada.args, { p_codigo: 'PECA01' })
})

// ⚠️ A CICATRIZ QUE ESTE TESTE GUARDA: `vessel_marcar_gravada` termina com
// `return json_build_object('ok', true)` DEPOIS de um `update ... where codigo =
// ... and gravada_em is null`. Se o update não pegar linha nenhuma — código que
// não existe, RLS no caminho — a função responde `ok: true` do mesmo jeito.
// Acreditar nesse `ok` faria a fila andar com a peça NÃO registrada.
test('não basta o banco dizer ok: confere lendo a peça de volta', async () => {
  const cliente = clienteDeMentira({
    aoBuscar: async () => ({ data: { codigo: 'PECA01', gravada_em: null }, error: null }),
  })
  const entrada = entradaDeMentira(cliente)
  await entrada.entrar('a@b.com', 'x')
  const r = await entrada.marcarGravada({ codigo: 'PECA01' })
  assert.equal(r.ok, false)
  assert.match(r.frase, /n[ãa]o (ficou|foi) registrad/i)
  assert.ok(cliente.registro.some((x) => x.o_que === 'buscar' && x.tabela === 'vessel_pecas'))
})

test('recusa do banco vem com o motivo, para virar a frase do painel', async () => {
  const cliente = clienteDeMentira({
    aoChamar: async () => ({ data: { ok: false, motivo: 'sem_permissao' }, error: null }),
  })
  const entrada = entradaDeMentira(cliente)
  await entrada.entrar('a@b.com', 'x')
  const r = await entrada.marcarGravada({ codigo: 'PECA01' })
  assert.equal(r.ok, false)
  assert.equal(r.motivo, 'sem_permissao')
})

test('erro de rede ao marcar não vira sucesso', async () => {
  const cliente = clienteDeMentira({
    aoChamar: async () => ({ data: null, error: { message: 'fetch failed' } }),
  })
  const entrada = entradaDeMentira(cliente)
  await entrada.entrar('a@b.com', 'x')
  const r = await entrada.marcarGravada({ codigo: 'PECA01' })
  assert.equal(r.ok, false)
})

test('marcar sem ter entrado é recusado, em vez de falhar torto no banco', async () => {
  const entrada = entradaDeMentira(clienteDeMentira())
  const r = await entrada.marcarGravada({ codigo: 'PECA01' })
  assert.equal(r.ok, false)
  assert.match(r.frase, /entre|login|conta/i)
})

test('sair encerra a sessão', async () => {
  const cliente = clienteDeMentira()
  const entrada = entradaDeMentira(cliente)
  await entrada.entrar('a@b.com', 'x')
  await entrada.sair()
  assert.ok(cliente.registro.some((r) => r.o_que === 'sair'))
  assert.equal(entrada.quemEsta(), null)
})
