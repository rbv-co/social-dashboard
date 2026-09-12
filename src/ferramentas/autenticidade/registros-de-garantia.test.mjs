import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  filaDeGarantia, naFilaDeGarantia, fraseDaConferencia, comoConferir,
  fraseDaRecusaDeGarantia, cpfValido, cpfComMascara, podeTrocarDono,
} from './registros-de-garantia.js'

const aqui = dirname(fileURLToPath(import.meta.url))

test('a fila traz SO o que espera decisao', () => {
  const lista = [{ estado: 'pendente' }, { estado: 'aprovado' }, { estado: 'recusado' }]
  assert.equal(filaDeGarantia(lista).length, 1)
  assert.equal(naFilaDeGarantia({ estado: 'aprovado' }), false)
})

test('a fila poe em cima quem espera HA MAIS TEMPO', () => {
  // ao contrario da lista de registros, onde o mais novo em cima responde "o
  // que aconteceu agora". Aqui em cima esta quem esta sem a garantia dela ha
  // mais tempo.
  const f = filaDeGarantia([
    { estado: 'pendente', criado_em: '2026-09-03T10:00:00Z', nome: 'nova' },
    { estado: 'pendente', criado_em: '2026-09-01T10:00:00Z', nome: 'velha' },
  ])
  assert.deepEqual(f.map((p) => p.nome), ['velha', 'nova'])
})

test('a fila aguenta lista vazia, nula e sem data', () => {
  for (const x of [null, undefined, [], 'nada']) assert.deepEqual(filaDeGarantia(x), [])
  assert.equal(filaDeGarantia([{ estado: 'pendente' }, { estado: 'pendente' }]).length, 2)
})

test('conferencia: quando o Bling achou, diz QUAL pedido', () => {
  // sem o numero, "conferido no Bling" e so uma palavra que o sistema deu a si
  // mesmo, e ninguem consegue checar a decisao depois
  assert.match(
    fraseDaConferencia({ estado: 'aprovado', decidido_por_que: 'bling', conferencia: { pedido: '12345' } }),
    /12345/)
})

test('conferencia: pendente NAO acusa a cliente', () => {
  // "nao encontramos sua compra" soa a acusacao, e quem le isso vinte vezes por
  // semana comeca a recusar por reflexo. A maioria dos pendentes e honesta.
  const f = fraseDaConferencia({ estado: 'pendente' })
  assert.match(f, /feira|presente|revenda/i)
  assert.doesNotMatch(f, /não existe|inválid|fraude|falsa/i)
})

test('conferencia: decidido na mao diz se foi aprovado ou recusado', () => {
  assert.match(fraseDaConferencia({ estado: 'aprovado', decidido_por_que: 'na_mao' }), /Aprovado/)
  assert.match(fraseDaConferencia({ estado: 'recusado', decidido_por_que: 'na_mao' }), /Recusado/)
})

test('comoConferir da caminhos de verdade, e pula o que nao se sabe', () => {
  // sem isto, "confira antes de decidir" e um conselho sem lugar para ir
  const passos = comoConferir(
    { whatsapp: '11988887777', onde_comprou: 'Feira de Bauru', comprado_em: '2026-08-01' },
    { modelo: 'Handbag Linear' })
  assert.equal(passos.length, 4)
  assert.ok(passos.some((p) => p.includes('11988887777')))
  assert.ok(passos.some((p) => p.includes('Handbag Linear')))
  assert.deepEqual(comoConferir({}, {}), [], 'sem dado nenhum nao inventa passo')
})

test('TODA recusa do banco tem frase — nenhuma cai no generico', () => {
  // A regressao que este teste pega: motivo novo no SQL sem frase aqui, e a
  // pessoa le "Não foi possível" sem saber o que fazer.
  const raiz = resolve(aqui, '..', '..', '..')
  const sql = readFileSync(
    join(raiz, 'db', 'migrations', '2026-09-03-zz-vessel-garantia-com-dono.sql'), 'utf8')
  const trecho = sql.slice(sql.indexOf('4. ABRIR UM PEDIDO'))
  const motivos = [...trecho.matchAll(/'ok',\s*false,\s*'motivo',\s*'([a-z_]+)'/g)].map((m) => m[1])
  assert.ok(motivos.length >= 8, `esperava 8+ motivos no SQL, achei ${motivos.length}`)
  const generico = fraseDaRecusaDeGarantia('__inexistente__')
  for (const m of [...new Set(motivos)]) {
    // ESTES SAO RESPOSTAS PARA A PAGINA DA CLIENTE, nao para o painel: elas
    // nunca chegam nesta tela, e a frase delas mora em `verify/index.html`.
    // A lista e explicita — e nao um corte por posicao no arquivo — para que
    // motivo novo entre aqui de proposito, e nao por acidente de linha.
    const DA_PAGINA_DA_CLIENTE = [
      'nao_existe',          // codigo que nao existe: so quem le a etiqueta ve
      'pagina_velha',        // pagina antiga aberta no celular de alguem
      'compra_no_futuro',    // validacao do formulario da cliente
      'falha_ao_guardar',    // erro da edge, respondido a cliente
      'muitas_tentativas',   // limite do "É você?" — o painel nao usa
      'nao_confere',         // prova errada no "É você?"
    ]
    if (DA_PAGINA_DA_CLIENTE.includes(m)) continue
    assert.notEqual(fraseDaRecusaDeGarantia(m), generico,
      `o motivo "${m}" existe no SQL mas nao tem frase — a pessoa le o generico`)
  }
})

test('a frase de ja_decidido diz QUAL foi a decisao', () => {
  assert.match(fraseDaRecusaDeGarantia('ja_decidido', { estado: 'recusado' }), /recusado/)
  assert.match(fraseDaRecusaDeGarantia('ja_decidido', { estado: 'aprovado' }), /aprovado/)
})

test('cpfValido: a mesma conta dos outros dois lugares', () => {
  // ⚠️ OS MESMOS CASOS estao em `vessel-brasil/verify/regras.test.mjs` e em
  // `docs/provar-garantia-com-dono.sql`. Divergindo, a tela aceita o que o
  // banco recusa.
  assert.equal(cpfValido('529.982.247-25'), true)
  assert.equal(cpfValido('11144477735'), true)
  assert.equal(cpfValido('529.982.247-24'), false)
  for (const d of '0123456789') assert.equal(cpfValido(d.repeat(11)), false)
  for (const x of ['', null, undefined, '123', 'abcdefghijk']) assert.equal(cpfValido(x), false)
})

test('cpfComMascara vai formatando conforme se digita', () => {
  assert.equal(cpfComMascara('529982'), '529.982')
  assert.equal(cpfComMascara('52998224725'), '529.982.247-25')
  assert.equal(cpfComMascara('52998224725999'), '529.982.247-25')
})

test('trocar dono exige NOME, CPF, WhatsApp, MOTIVO e o codigo digitado', () => {
  const bom = { nome: 'Carla Dias', cpf: '111.444.777-35', whatsapp: '31955554444',
                motivo: 'revendeu', confirmacao: 'K7M4X9QP2R' }
  assert.equal(podeTrocarDono(bom, 'K7M4X9QP2R'), true)
  assert.equal(podeTrocarDono({ ...bom, confirmacao: 'k7m4x9qp2r' }, 'K7M4X9QP2R'), true,
    'digitar em minuscula nao pode reprovar')
  for (const campo of ['nome', 'cpf', 'whatsapp', 'motivo', 'confirmacao']) {
    assert.equal(podeTrocarDono({ ...bom, [campo]: '' }, 'K7M4X9QP2R'), false,
      `faltando "${campo}" ainda deixou trocar`)
  }
  assert.equal(podeTrocarDono({ ...bom, confirmacao: 'OUTROCODIGO' }, 'K7M4X9QP2R'), false,
    'o codigo de OUTRA peca nao pode confirmar esta')
  assert.equal(podeTrocarDono(null, 'K7M4X9QP2R'), false)
})
