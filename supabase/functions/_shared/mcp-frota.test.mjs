import { test } from 'node:test'
import assert from 'node:assert/strict'
import { responder, gestorDaFrota, clienteOAuth, FERRAMENTAS } from './mcp-frota.js'

const V = '11111111-1111-4111-8111-111111111111'
const R = '22222222-2222-4222-8222-222222222222'
const EU = '33333333-3333-4333-8333-333333333333'
const AGORA = new Date('2026-10-19T15:00:00Z')

function bancoFalso({ km = 25000, falharTrocas = false, editadas = 1 } = {}) {
  const feito = []
  const db = {
    feito,
    async listar(t, o) { feito.push(['listar', t, o]); return [{ id: V }] },
    async inserir(t, l) {
      feito.push(['inserir', t, l])
      if (t === 'frota_revisoes' && falharTrocas) throw new Error('new row violates check constraint')
      return (Array.isArray(l) ? l : [l]).map((x, i) => ({ id: `novo-${i}`, ...x }))
    },
    async editar(t, id, c) { feito.push(['editar', t, id, c]); return editadas ? [{ id, ...c }] : [] },
    async apagar(t, id) { feito.push(['apagar', t, id]) },
    async maiorKm() { return km },
    async avisar(id) { feito.push(['avisar', id]); return { ok: true, enviados: 1 } },
  }
  return db
}
const chamar = async (db, name, args) => (await responder({ method: 'tools/call', params: { name, arguments: args } }, { db, usuario: EU, agora: AGORA })).result
const texto = (r) => r.content[0].text

test('initialize, tools/list e método desconhecido', async () => {
  const i = await responder({ method: 'initialize', params: { protocolVersion: '2025-03-26' } }, {})
  assert.equal(i.result.protocolVersion, '2025-03-26')
  assert.equal((await responder({ method: 'initialize', params: { protocolVersion: '1999' } }, {})).result.protocolVersion, '2025-06-18')
  const l = (await responder({ method: 'tools/list' }, {})).result.tools
  assert.equal(l.length, 13)
  assert.equal(l.filter((t) => t.annotations.readOnlyHint).length, 6)
  assert.equal((await responder({ method: 'resources/list' }, {})).error.code, -32601)
  assert.equal((await responder({ method: 'tools/call', params: { name: 'apagar_tudo' } }, {})).error.code, -32602)
})

test('listar: filtros, ordem, limite e argumento desconhecido', async () => {
  const db = bancoFalso()
  await chamar(db, 'listar_usos', { veiculo_id: V, aberta: true, limite: 10 })
  const [, tabela, o] = db.feito[0]
  assert.equal(tabela, 'frota_uso')
  assert.deepEqual({ ...o, colunas: undefined }, { colunas: undefined, filtros: [['veiculo_id', 'eq', V], ['volta_em', 'is_null']], ordem: ['saida_em', true], limite: 10 })
  assert.doesNotMatch(o.colunas, /rabisco|\*/) // o desenho da assinatura não vai para o modelo
  assert.match(o.colunas, /veiculo:frota_veiculos\(nome,placa\)/)
  assert.equal((await chamar(db, 'listar_requisicoes', { situacao: 'pendente' })).isError, false)
  for (const [n, a] of [['listar_veiculos', { placa: 'x' }], ['listar_usos', { limite: 500 }], ['listar_requisicoes', { situacao: 'x' }], ['listar_revisoes', { veiculo_id: 'x' }]]) {
    assert.equal((await chamar(db, n, a)).isError, true, n)
  }
  assert.equal(db.feito.length, 2) // as recusas não chegaram ao banco
})

test('listar: padrão de linhas, busca por nome ou placa e campos nulos fora da resposta', async () => {
  const db = bancoFalso()
  db.listar = async (t, o) => { db.feito.push([t, o]); return [{ id: V, nome: 'Gol', observacao: null }] }
  const r = await chamar(db, 'listar_veiculos', { busca: ' abc-1d2(3), ' })
  assert.deepEqual(db.feito[0][1].filtros, [['nome|placa', 'ilike_qualquer', { nome: 'abc-1d2 3', placa: 'ABC1D23' }]])
  assert.equal(db.feito[0][1].limite, 100)
  assert.equal(texto(r), `[{"id":"${V}","nome":"Gol"}]`)
  await chamar(db, 'listar_abastecimentos', {})
  assert.equal(db.feito[1][1].limite, 20)
  await chamar(db, 'listar_usos', { aberta: true, tipo: 'viagem' })
  assert.deepEqual(db.feito[2][1].filtros, [['tipo', 'eq', 'viagem'], ['volta_em', 'is_null']])
  assert.equal((await chamar(db, 'listar_usos', { tipo: 'emprestimo' })).isError, true)
  assert.equal((await chamar(db, 'listar_veiculos', { busca: ' (),* ' })).isError, true)
  assert.equal((await chamar(db, 'listar_veiculos', { situacao: 'quebrado' })).isError, true)
})

test('abastecimento: grava em centavos, com autor; barra km menor e data futura sem gravar', async () => {
  const ok = { veiculo_id: V, km: 25050, litros: 40, total_reais: 250.5, tanque_depois: 4, combustivel: ' gasolina ' }
  let db = bancoFalso()
  const r = await chamar(db, 'registrar_abastecimento', ok)
  assert.equal(r.isError, false)
  const [, tabela, linha] = db.feito.at(-1)
  assert.equal(tabela, 'frota_abastecimentos')
  assert.equal(linha.total_centavos, 25050)
  assert.equal(linha.combustivel, 'gasolina')
  assert.equal(linha.criado_por, EU)
  assert.equal(linha.abastecido_em, AGORA.toISOString())

  db = bancoFalso()
  assert.match(texto(await chamar(db, 'registrar_abastecimento', { ...ok, km: 24000 })), /menor que o último conhecido deste carro \(25000\)/)
  assert.match(texto(await chamar(db, 'registrar_abastecimento', { ...ok, abastecido_em: '2026-10-20T10:00:00-03:00' })), /futuro/)
  assert.match(texto(await chamar(db, 'registrar_abastecimento', { ...ok, abastecido_em: '2026-10-19 10:00' })), /ISO 8601/)
  assert.match(texto(await chamar(db, 'registrar_abastecimento', { ...ok, tanque_depois: 5 })), /0 a 4/)
  assert.equal(db.feito.length, 0)

  db = bancoFalso({ km: null })
  assert.match(texto(await chamar(db, 'registrar_abastecimento', { ...ok, total_reais: 1000 })), /R\$ 25\.00 o litro/)
})

test('editar_veiculo: só os campos permitidos; não achou = erro', async () => {
  const db = bancoFalso()
  assert.match(texto(await chamar(db, 'editar_veiculo', { id: V, placa: 'ABC1D23' })), /não grava: placa/)
  assert.equal((await chamar(db, 'editar_veiculo', { id: V, local_texto: 'Garagem' })).isError, false)
  assert.deepEqual(db.feito, [['editar', 'frota_veiculos', V, { local_texto: 'Garagem' }]])
  assert.match(texto(await chamar(bancoFalso({ editadas: 0 }), 'editar_veiculo', { id: V, cor: 'azul' })), /Não achei/)
  assert.match(texto(await chamar(db, 'editar_veiculo', { id: V })), /nada para gravar/)
})

test('pedir_carro grava quem pediu', async () => {
  const db = bancoFalso()
  await chamar(db, 'pedir_carro', { veiculo_id: V, retirada_prevista: '2026-10-20T08:00:00-03:00' })
  assert.equal(db.feito[0][2].criada_por, EU)
  assert.match(texto(await chamar(db, 'pedir_carro', { veiculo_id: V })), /falta retirada_prevista/)
})

test('decidir_requisicao: motivo obrigatório, aviso só em aprovar/recusar, falha do aviso não desfaz', async () => {
  let db = bancoFalso()
  assert.match(texto(await chamar(db, 'decidir_requisicao', { id: R, decisao: 'recusada' })), /motivo da recusa/)
  assert.match(texto(await chamar(db, 'decidir_requisicao', { id: R, decisao: 'revogada', motivo: ' ' })), /Diga o motivo/)
  assert.equal(db.feito.length, 0)
  await chamar(db, 'decidir_requisicao', { id: R, decisao: 'aprovada' })
  assert.deepEqual(db.feito, [['editar', 'frota_requisicoes', R, { situacao: 'aprovada', motivo_decisao: null }], ['avisar', R]])
  db = bancoFalso()
  await chamar(db, 'decidir_requisicao', { id: R, decisao: 'cancelada', motivo: 'carro quebrou' })
  assert.deepEqual(db.feito, [['editar', 'frota_requisicoes', R, { situacao: 'cancelada', encerrada_motivo: 'carro quebrou' }]])
  db = bancoFalso()
  db.avisar = async () => { throw new Error('push fora') }
  const r = await chamar(db, 'decidir_requisicao', { id: R, decisao: 'recusada', motivo: 'sem motorista' })
  assert.equal(r.isError, false)
  assert.match(texto(r), /gravada, mas o aviso/)
})

test('lancar_manutencao: cabeçalho + trocas em centavos; troca falhou desfaz o cabeçalho', async () => {
  let db = bancoFalso()
  const args = { veiculo_id: V, km: 30000, feita_em: '2026-10-18', oficina: 'Auto X', total_reais: 300, trocas: [{ item: 'Óleo', custo_reais: 120.1 }, { item: 'Filtro' }] }
  assert.equal((await chamar(db, 'lancar_manutencao', args)).isError, false)
  assert.equal(db.feito[0][2].total_centavos, 30000)
  assert.equal(db.feito[0][2].criada_por, EU)
  assert.deepEqual(db.feito[1][2][0], { manutencao_id: 'novo-0', veiculo_id: V, item: 'Óleo', km: 30000, feita_em: '2026-10-18', oficina: 'Auto X', custo_centavos: 12010 })
  assert.equal(db.feito[1][2][1].custo_centavos, null)

  db = bancoFalso({ falharTrocas: true })
  const r = await chamar(db, 'lancar_manutencao', args)
  assert.equal(r.isError, true)
  assert.match(texto(r), /check constraint/)
  assert.deepEqual(db.feito.at(-1), ['apagar', 'frota_manutencoes', 'novo-0'])
  assert.match(texto(await chamar(db, 'lancar_manutencao', { ...args, trocas: [] })), /1 a 30/)
})

test('erro do banco vira isError com a frase do gatilho', async () => {
  const db = bancoFalso()
  db.editar = async () => { throw new Error('Só quem aprova a frota pode decidir.') }
  const r = await chamar(db, 'editar_item_do_plano', { id: R, ativo: false })
  assert.equal(r.isError, true)
  assert.match(texto(r), /Só quem aprova/)
})

test('gestorDaFrota segue a aba Gestão', () => {
  assert.equal(gestorDaFrota({ permissions: { frota: ['ver', 'criar'] } }), true)
  assert.equal(gestorDaFrota({ permissions: { frota: ['excluir'] } }), true)
  assert.equal(gestorDaFrota({ is_superadmin: true }), true)
  assert.equal(gestorDaFrota({ permissions: { frota: ['ver', 'editar'], 'frota.aprovar': ['ver'] } }), false)
  assert.equal(gestorDaFrota(null), false)
})

test('clienteOAuth lê o client_id; sessão da tela não tem', () => {
  const jwt = (p) => 'x.' + Buffer.from(JSON.stringify(p)).toString('base64url') + '.y'
  assert.equal(clienteOAuth(jwt({ sub: EU, client_id: 'abc-123' })), 'abc-123')
  assert.equal(clienteOAuth(jwt({ sub: EU })), '')
  assert.equal(clienteOAuth('lixo'), '')
})

test('todo esquema é objeto fechado e todo obrigatório está nas propriedades', () => {
  for (const f of FERRAMENTAS) {
    assert.equal(f.esquema.type, 'object', f.nome)
    assert.equal(f.esquema.additionalProperties, false, f.nome)
    for (const r of f.esquema.required || []) assert.ok(r in f.esquema.properties, f.nome + ':' + r)
  }
})
