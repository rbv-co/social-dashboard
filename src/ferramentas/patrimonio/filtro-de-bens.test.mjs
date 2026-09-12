import { test } from 'node:test'
import assert from 'node:assert/strict'
import { FILTRO_VAZIO, filtrarBens, resumoDaLista, normalizar } from './filtro-de-bens.js'

const BENS = [
  { id: 'a', numero: 3, nome: 'Macbook Air M4', valor_centavos: 800000, empresa_id: 'e1', local_id: 'l1', categoria_id: 'c1', situacao: 'em_uso', pessoa_id: 'p1', marca: 'Macbook' },
  { id: 'b', numero: 47, nome: 'Xiaomi Redmi', valor_centavos: 120000, empresa_id: 'e2', local_id: 'l2', categoria_id: 'c2', situacao: 'em_estoque', pessoa_id: null, marca: 'Xiaomi' },
  { id: 'c', numero: 99, nome: 'Cadeira Presidente', valor_centavos: null, empresa_id: 'e1', local_id: 'l1', categoria_id: 'c3', situacao: 'em_uso', pessoa_id: null, dono_texto: 'Raíssa' },
]

test('filtro vazio devolve tudo', () => {
  assert.equal(filtrarBens(BENS, FILTRO_VAZIO).length, 3)
  assert.equal(filtrarBens(BENS, {}).length, 3)
  assert.equal(filtrarBens(BENS, null).length, 3)
})

test('busca por parte do nome, sem ligar pra maiúscula', () => {
  assert.deepEqual(filtrarBens(BENS, { busca: 'macbook' }).map(b => b.id), ['a'])
  assert.deepEqual(filtrarBens(BENS, { busca: 'MAC' }).map(b => b.id), ['a'])
})

test('busca ignora acento nos dois lados', () => {
  assert.deepEqual(filtrarBens(BENS, { busca: 'cadeira' }).map(b => b.id), ['c'])
  assert.deepEqual(filtrarBens([{ id: 'x', nome: 'Televisão LG' }], { busca: 'televisao' }).map(b => b.id), ['x'])
})

test('busca pelo número da etiqueta (é assim que se procura com o bem na mão)', () => {
  assert.deepEqual(filtrarBens(BENS, { busca: '47' }).map(b => b.id), ['b'])
})

test('busca acha pelo nome solto de quem está com o bem', () => {
  assert.deepEqual(filtrarBens(BENS, { busca: 'raissa' }).map(b => b.id), ['c'])
})

test('filtros de lista casam exato e se somam', () => {
  assert.deepEqual(filtrarBens(BENS, { empresaId: 'e1' }).map(b => b.id), ['a', 'c'])
  assert.deepEqual(filtrarBens(BENS, { situacao: 'em_uso' }).map(b => b.id), ['a', 'c'])
  assert.deepEqual(filtrarBens(BENS, { empresaId: 'e1', categoriaId: 'c3' }).map(b => b.id), ['c'])
  assert.deepEqual(filtrarBens(BENS, { localId: 'l2' }).map(b => b.id), ['b'])
})

test('filtro "sem dono" pega quem não tem colaborador ligado', () => {
  assert.deepEqual(filtrarBens(BENS, { semDono: true }).map(b => b.id), ['b', 'c'])
})

test('filtro por pessoa pega só o dela', () => {
  assert.deepEqual(filtrarBens(BENS, { pessoaId: 'p1' }).map(b => b.id), ['a'])
})

test('nada casa devolve lista vazia, não erro', () => {
  assert.deepEqual(filtrarBens(BENS, { busca: 'jacaré' }), [])
})

test('resumo conta os itens e soma só quem tem valor', () => {
  assert.deepEqual(resumoDaLista(BENS), { quantidade: 3, totalCentavos: 920000 })
  assert.deepEqual(resumoDaLista([]), { quantidade: 0, totalCentavos: 0 })
  assert.deepEqual(resumoDaLista(null), { quantidade: 0, totalCentavos: 0 })
})

test('normalizar tira acento e caixa', () => {
  assert.equal(normalizar('Televisão LG'), 'televisao lg')
  assert.equal(normalizar(null), '')
})

/* ── A busca precisa achar pelo NOME de quem está com o bem ──────────────────
   No banco o bem guarda o identificador da pessoa, não o nome dela. Procurar
   por "erick" não achava nada, porque o nome do Erick não está no bem — está na
   tabela de pessoas. Quem chama resolve e passa em `textoExtra`. */

const PESSOAS = { p1: 'Erick Martins', p2: 'Larissa Sousa' }
const nomeDoDono = (b) => PESSOAS[b.pessoa_id] || ''

test('acha pelo nome do colaborador que está com o bem', () => {
  assert.deepEqual(filtrarBens(BENS, { busca: 'erick' }, nomeDoDono).map(b => b.id), ['a'])
  assert.deepEqual(filtrarBens(BENS, { busca: 'martins' }, nomeDoDono).map(b => b.id), ['a'])
})

test('sem o texto de fora, o nome do colaborador NÃO é achado', () => {
  // Guarda contra alguém remover o parâmetro achando que é supérfluo.
  assert.deepEqual(filtrarBens(BENS, { busca: 'erick' }).map(b => b.id), [])
})

test('o texto de fora também serve para local, ambiente e categoria', () => {
  const contexto = (b) => (b.id === 'b' ? 'Fábrica Conchal Produção Celulares' : '')
  assert.deepEqual(filtrarBens(BENS, { busca: 'conchal' }, contexto).map(b => b.id), ['b'])
  assert.deepEqual(filtrarBens(BENS, { busca: 'producao' }, contexto).map(b => b.id), ['b'])
})

test('a busca continua achando pela observação do bem', () => {
  const com = [{ id: 'z', nome: 'Notebook', observacao: 'tela trincada' }]
  assert.deepEqual(filtrarBens(com, { busca: 'trincada' }).map(b => b.id), ['z'])
})

test('busca acha o bem pelo IMEI / número de série', () => {
  const bens = [
    { id: '1', nome: 'Macbook Air', numero: 47, numero_serie: 'C02XK1ABJGH5' },
    { id: '2', nome: 'Cadeira', numero: 48, numero_serie: null },
  ]
  const achados = filtrarBens(bens, { ...FILTRO_VAZIO, busca: 'c02xk1' })
  assert.deepEqual(achados.map((b) => b.id), ['1'], 'digitar parte do serial tem que achar o aparelho')
})

test('texto de fora vazio ou quebrado não derruba a busca', () => {
  assert.equal(filtrarBens(BENS, { busca: 'macbook' }, () => null).length, 1)
  assert.equal(filtrarBens(BENS, { busca: 'macbook' }, null).length, 1)
})
