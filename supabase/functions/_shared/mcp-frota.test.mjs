import { test } from 'node:test'
import assert from 'node:assert/strict'
import { responder, gestorDaFrota, clienteOAuth, FERRAMENTAS, estadoDoCarro } from './mcp-frota.js'
import { quemEstaComOCarro } from './posse.js'
import { estadoDoVeiculo } from '../../../src/ferramentas/frota/estado-do-veiculo.js'
import { seloDoVeiculo } from '../../../src/ferramentas/frota/cartao-do-veiculo.js'
import { reservaSegurando } from '../../../src/ferramentas/frota/requisicoes.js'

const V = '11111111-1111-4111-8111-111111111111'
const R = '22222222-2222-4222-8222-222222222222'
const EU = '33333333-3333-4333-8333-333333333333'
const AGORA = new Date('2026-10-19T15:00:00Z')
const PESSOAS = [
  { id: 'p-ana', nome: 'Ana Souza', status: 'ativo' }, { id: 'p-ana2', nome: 'Ana Lima', status: 'ativo' },
  { id: 'p-joao', nome: 'João Pereira', status: 'ativo' }, { id: 'p-joao2', nome: 'João Pereira Neto', status: 'ativo' },
  { id: 'p-caio', nome: 'Caio Ramos', status: 'desligado' },
]

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
    async pessoas() { return PESSOAS },
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
  db.listar = async (t, o) => { db.feito.push([t, o]); return t === 'frota_veiculos' ? [{ id: V, nome: 'Gol', observacao: null, situacao: 'ativo', pessoa_id: null }] : [] }
  const r = await chamar(db, 'listar_veiculos', { busca: ' abc-1d2(3), ' })
  assert.deepEqual(db.feito[0][1].filtros, [['nome|placa', 'ilike_qualquer', { nome: 'abc-1d2 3', placa: 'ABC1D23' }]])
  assert.equal(db.feito[0][1].limite, 100)
  assert.match(db.feito[0][1].colunas, /tag_pedagio/) // todo campo que editar_veiculo grava dá para conferir
  assert.equal(texto(r), `[{"id":"${V}","nome":"Gol","situacao":"ativo","estado":"livre"}]`) // pessoa_id não sai
  db.feito.length = 0
  await chamar(db, 'listar_abastecimentos', {})
  assert.equal(db.feito[0][1].limite, 20)
  await chamar(db, 'listar_usos', { aberta: true, tipo: 'viagem' })
  assert.deepEqual(db.feito[1][1].filtros, [['tipo', 'eq', 'viagem'], ['volta_em', 'is_null']])
  assert.equal((await chamar(db, 'listar_usos', { tipo: 'emprestimo' })).isError, true)
  assert.equal((await chamar(db, 'listar_veiculos', { busca: ' (),* ' })).isError, true)
  assert.equal((await chamar(db, 'listar_veiculos', { situacao: 'quebrado' })).isError, true)
  db.feito.length = 0
  assert.equal((await chamar(db, 'listar_veiculos', { estado: 'disponivel' })).isError, true)
  assert.equal((await chamar(db, 'listar_veiculos', { placa: 'x' })).isError, true)
  assert.equal(db.feito.length, 0) // recusa antes de qualquer leitura
})

test('estado do carro = o selo da tela (cartao-do-veiculo + estado-do-veiculo + reservaSegurando)', () => {
  const SELO = { LIVRE: 'livre', FIXO: 'fixo', 'NA RUA': 'na_rua', RESERVADO: 'reservado', OFICINA: 'oficina', PARADO: 'parado', 'FORA DA FROTA': 'fora_da_frota' }
  const agoraIso = AGORA.toISOString()
  const daTela = (v, usos, reqs) => {
    const seg = reservaSegurando({ requisicoes: reqs, veiculoId: v.id, agoraIso })
    const dono = { ...v, pessoa_nome: (PESSOAS.find((p) => p.id === v.pessoa_id) || {}).nome || null, reservada: !!seg, reservada_por: seg ? seg.pessoa_nome : null }
    const quem = quemEstaComOCarro(dono, usos, PESSOAS)
    return SELO[seloDoVeiculo(estadoDoVeiculo({ ...dono, pessoa_nome: quem.pessoaNome }, usos, [], [], [])).texto]
  }
  const carro = (x) => ({ id: V, situacao: 'ativo', pessoa_id: null, ...x })
  const viagem = { veiculo_id: V, tipo: 'viagem', pessoa_nome: 'Ana Souza', volta_em: null }
  const posse = { veiculo_id: V, tipo: 'posse', pessoa_id: 'p-joao', pessoa_nome: null, volta_em: null }
  const reserva = (ini, fim) => ({ veiculo_id: V, situacao: 'aprovada', pessoa_nome: 'Ana Lima', retirada_prevista: ini, devolucao_prevista: fim })
  const casos = [
    ['livre', carro(), [], []],
    ['dono fixo', carro({ pessoa_id: 'p-ana' }), [], []],
    ['posse sem dono fixo', carro(), [posse], []],
    ['posse fechada', carro(), [{ ...posse, volta_em: '2026-10-01T10:00:00Z' }], []],
    ['viagem com dono fixo', carro({ pessoa_id: 'p-ana' }), [viagem], []],
    ['viagem de outro carro', carro(), [{ ...viagem, veiculo_id: R }], []],
    ['reserva valendo agora', carro(), [], [reserva('2026-10-19T12:00:00Z', '2026-10-19T20:00:00Z')]],
    ['reserva sem devolução, no dia', carro(), [], [reserva('2026-10-19T08:00:00Z', null)]],
    ['reserva de amanhã', carro(), [], [reserva('2026-10-20T12:00:00Z', '2026-10-20T20:00:00Z')]],
    ['reserva vencida', carro(), [], [reserva('2026-10-15T12:00:00Z', '2026-10-15T20:00:00Z')]],
    ['oficina com viagem', carro({ situacao: 'em_manutencao' }), [viagem], []],
    ['inativo', carro({ situacao: 'inativo', pessoa_id: 'p-ana' }), [], []],
    ['alienado', carro({ situacao: 'alienado' }), [], []],
  ]
  for (const [nome, v, usos, reqs] of casos) {
    assert.equal(estadoDoCarro(v, usos, reqs, PESSOAS, AGORA).estado, daTela(v, usos, reqs), nome)
  }
  assert.deepEqual(estadoDoCarro(carro({ pessoa_id: 'p-ana' }), [], [], PESSOAS, AGORA), { estado: 'fixo', com_quem: 'Ana Souza' })
  assert.deepEqual(estadoDoCarro(carro(), [posse], [], PESSOAS, AGORA), { estado: 'fixo', com_quem: 'João Pereira', por_posse: true })
})

test('listar_veiculos com estado=livre não traz o carro fixo', async () => {
  const db = bancoFalso()
  db.listar = async (t) => t === 'frota_veiculos'
    ? [{ id: V, nome: 'Kwid', situacao: 'ativo', pessoa_id: 'p-ana' }, { id: R, nome: 'Doblo', situacao: 'ativo', pessoa_id: null }]
    : []
  const r = JSON.parse(texto(await chamar(db, 'listar_veiculos', { estado: 'livre' })))
  assert.deepEqual(r.map((c) => c.nome), ['Doblo'])
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

test('pedir_carro: sempre para alguém do cadastro (ou de fora, com nome), e grava quem pediu', async () => {
  const pedido = { veiculo_id: V, retirada_prevista: '2026-10-20T08:00:00-03:00' }
  let db = bancoFalso()
  await chamar(db, 'pedir_carro', { ...pedido, pessoa_nome: ' joao pereira ' })
  assert.deepEqual([db.feito[0][1], db.feito[0][2].pessoa_id, db.feito[0][2].pessoa_nome, db.feito[0][2].criada_por],
    ['frota_requisicoes', 'p-joao', 'João Pereira', EU]) // exato vence o "Neto"; nome do cadastro
  db = bancoFalso()
  await chamar(db, 'pedir_carro', { ...pedido, pessoa_nome: 'souza' })
  assert.equal(db.feito[0][2].pessoa_id, 'p-ana')
  db = bancoFalso()
  await chamar(db, 'pedir_carro', { ...pedido, pessoa_nome: 'Felipe Modelista', de_fora: true })
  assert.deepEqual([db.feito[0][2].pessoa_id, db.feito[0][2].pessoa_nome], [null, 'Felipe Modelista'])

  db = bancoFalso()
  assert.match(texto(await chamar(db, 'pedir_carro', pedido)), /Falta para quem é o carro/)
  assert.match(texto(await chamar(db, 'pedir_carro', { ...pedido, pessoa_nome: '  ' })), /Falta para quem/)
  assert.match(texto(await chamar(db, 'pedir_carro', { ...pedido, pessoa_nome: 'Ana' })), /Mais de um colaborador.*Ana Lima; Ana Souza|Mais de um colaborador.*Ana Souza; Ana Lima/)
  assert.match(texto(await chamar(db, 'pedir_carro', { ...pedido, pessoa_nome: 'Caio Ramos' })), /Não achei.*de_fora=true/) // desligado não conta
  assert.match(texto(await chamar(db, 'pedir_carro', { ...pedido, pessoa_nome: 'Lu', de_fora: true })), /curto demais/)
  assert.match(texto(await chamar(db, 'pedir_carro', { ...pedido, pessoa_nome: 'Ana Souza', pessoa_id: 'x' })), /argumento desconhecido: pessoa_id/)
  assert.match(texto(await chamar(db, 'pedir_carro', { veiculo_id: V, pessoa_nome: 'Ana Souza' })), /falta retirada_prevista/)
  assert.equal(db.feito.length, 0)
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
