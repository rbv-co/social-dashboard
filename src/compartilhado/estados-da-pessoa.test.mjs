import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ESTADOS, estadosDe, contarEstados, aplicarEstados } from './estados-da-pessoa.js'

// A forma REAL da linha que a tela monta (`linhas` em loadAdminUsers): campos de
// cima vindos de `profiles`, e `temCadastro` decidido contra `acessos_pessoas`.
const pessoa = (extra = {}) => ({
  id: 'p1', nome: 'Alguém', email: 'alguem@rbvcompany.com',
  papel: 'viewer', temCadastro: true,
  bruto: { role: 'viewer', is_superadmin: false, disabled: false, precisa_trocar_senha: false },
  ...extra,
})

// ─────────────────────────────────────────────────────────────────────────────
// estadosDe

test('pessoa comum e completa não tem estado nenhum', () => {
  assert.deepEqual(estadosDe(pessoa()), [])
})

test('sem cadastro de colaborador', () => {
  assert.deepEqual(estadosDe(pessoa({ temCadastro: false })), ['sem-cadastro'])
})

test('admin é estado; super-admin TAMBÉM conta como admin', () => {
  // O super-admin é admin com mais poder, não uma categoria à parte. Filtrar
  // "admin" e não achar os três super-admins seria a lista mentindo sobre quem
  // manda no sistema.
  assert.deepEqual(estadosDe(pessoa({ bruto: { role: 'admin' } })), ['admin'])
  assert.deepEqual(estadosDe(pessoa({ bruto: { is_superadmin: true } })), ['admin'])
})

test('precisa trocar senha', () => {
  assert.deepEqual(estadosDe(pessoa({ bruto: { precisa_trocar_senha: true } })), ['trocar-senha'])
})

test('desativado', () => {
  assert.deepEqual(estadosDe(pessoa({ bruto: { disabled: true } })), ['desativado'])
})

test('uma pessoa pode ter vários estados ao mesmo tempo', () => {
  const p = pessoa({ temCadastro: false, bruto: { role: 'admin', disabled: true } })
  assert.deepEqual(estadosDe(p).sort(), ['admin', 'desativado', 'sem-cadastro'])
})

test('linha torta não quebra — devolve lista vazia, não explode', () => {
  // A tela chama isto dentro do desenho; uma exceção aqui apagaria a lista
  // inteira, e lista vazia é lida como "não há usuários".
  assert.deepEqual(estadosDe(null), [])
  assert.deepEqual(estadosDe({}), [])
})

// ─────────────────────────────────────────────────────────────────────────────
// contarEstados — é o que decide quais filtros aparecem

test('conta quantas pessoas em cada estado', () => {
  const lista = [
    pessoa({ id: '1', temCadastro: false }),
    pessoa({ id: '2', bruto: { role: 'admin' } }),
    pessoa({ id: '3', bruto: { role: 'admin' } }),
    pessoa({ id: '4' }),
  ]
  const c = contarEstados(lista)
  assert.equal(c['sem-cadastro'], 1)
  assert.equal(c.admin, 2)
  assert.equal(c['trocar-senha'], 0)
  assert.equal(c.desativado, 0)
})

test('todos os estados aparecem na contagem, mesmo zerados', () => {
  // Quem decide ESCONDER o filtro zerado é a tela; a regra devolve o número.
  // Faltar a chave faria a tela ler `undefined` e escrever "NaN".
  const c = contarEstados([])
  for (const e of ESTADOS) assert.equal(typeof c[e.chave], 'number', e.chave)
})

// ─────────────────────────────────────────────────────────────────────────────
// aplicarEstados — o filtro em si

test('sem filtro escolhido, a lista passa inteira', () => {
  const lista = [pessoa({ id: '1' }), pessoa({ id: '2', temCadastro: false })]
  assert.equal(aplicarEstados(lista, []).length, 2)
  assert.equal(aplicarEstados(lista, null).length, 2)
})

test('um filtro deixa passar só quem tem aquele estado', () => {
  const lista = [pessoa({ id: '1' }), pessoa({ id: '2', temCadastro: false })]
  assert.deepEqual(aplicarEstados(lista, ['sem-cadastro']).map((p) => p.id), ['2'])
})

test('DOIS filtros somam (ou), não interceptam (e)', () => {
  // "Sem cadastro" E "admin" ao mesmo tempo quase sempre daria zero nesta base,
  // e filtro que zera a lista ensina a pessoa a não usar filtro. Marcar dois é
  // pedir "me mostre os dois grupos".
  const lista = [
    pessoa({ id: '1', temCadastro: false }),
    pessoa({ id: '2', bruto: { role: 'admin' } }),
    pessoa({ id: '3' }),
  ]
  assert.deepEqual(aplicarEstados(lista, ['sem-cadastro', 'admin']).map((p) => p.id), ['1', '2'])
})

test('filtro desconhecido não deixa passar ninguém por acidente', () => {
  const lista = [pessoa({ id: '1' })]
  assert.deepEqual(aplicarEstados(lista, ['inventado']), [])
})

test('a ordem da lista não muda — quem ordena é quem chamou', () => {
  const lista = [pessoa({ id: 'b', bruto: { role: 'admin' } }), pessoa({ id: 'a', bruto: { role: 'admin' } })]
  assert.deepEqual(aplicarEstados(lista, ['admin']).map((p) => p.id), ['b', 'a'])
})

// ─────────────────────────────────────────────────────────────────────────────
// ESTADOS — o catálogo que a tela desenha

test('todo estado tem chave e rótulo em português', () => {
  for (const e of ESTADOS) {
    assert.ok(e.chave && typeof e.chave === 'string', 'chave')
    assert.ok(e.rotulo && /[a-zà-ú]/i.test(e.rotulo), 'rótulo legível: ' + e.chave)
  }
})

test('as chaves não se repetem', () => {
  const chaves = ESTADOS.map((e) => e.chave)
  assert.equal(new Set(chaves).size, chaves.length)
})
