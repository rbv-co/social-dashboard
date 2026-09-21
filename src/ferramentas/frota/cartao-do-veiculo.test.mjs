import { test } from 'node:test'
import assert from 'node:assert/strict'
import { seloDoVeiculo, acaoPrincipalDoVeiculo, cartaoCompacto } from './cartao-do-veiculo.js'
import { estadoDoVeiculo, ordenarEstados } from './estado-do-veiculo.js'

const carro = (extra = {}) => ({ id: 'v1', nome: 'KWID', placa: 'RUL1A35', situacao: 'ativo', ...extra })
const estado = (v, usos = []) => estadoDoVeiculo(v, usos, [])
const naRua = (v) => estado(v, [{
  veiculo_id: v.id, pessoa_id: 'p-cristian', pessoa_nome: 'Cristian Leonel', tipo: 'viagem',
  saida_em: '2026-09-10T16:03Z',
}])

test('o selo é UMA palavra, não a frase inteira', () => {
  // O estrago que ele conserta: a etiqueta estreita carregava "Na rua com
  // Cristian Leonel". Quem bate o olho quer a situação.
  const s = seloDoVeiculo(naRua(carro()))
  assert.equal(s.texto, 'NA RUA')
  assert.ok(!/Cristian/.test(s.texto), 'nome de pessoa não entra no selo')
})

test('cada situação tem sua palavra e seu tom, e o tom sai da casa', () => {
  const casos = [
    [carro({ situacao: 'alienado' }), 'FORA DA FROTA', 'neutro'],
    [carro({ situacao: 'em_manutencao' }), 'OFICINA', 'atencao'],
    [carro({ situacao: 'inativo' }), 'PARADO', 'neutro'],
    [carro(), 'LIVRE', 'ok'],
    [carro({ pessoa_id: 'p1', pessoa_nome: 'Héllen' }), 'FIXO', 'info'],
    [carro({ reservada: true, reservada_por: 'Mariá' }), 'RESERVADO', 'info'],
  ]
  const tonsDaCasa = ['ok', 'atencao', 'erro', 'info', 'neutro', 'robo']
  for (const [v, texto, tom] of casos) {
    const s = seloDoVeiculo(estado(v))
    assert.equal(s.texto, texto, `${v.situacao}/${v.pessoa_nome || ''} devia dizer ${texto}`)
    assert.equal(s.tom, tom)
    assert.ok(tonsDaCasa.includes(s.tom), `${s.tom} não é tom da casa`)
  }
})

test('carro com responsável fixo NUNCA diz LIVRE', () => {
  // A mesma contradição que já tinha sido corrigida na frase da linha:
  // "Livre, com Humberto" fazia a pessoa achar que podia pegar.
  assert.equal(seloDoVeiculo(estado(carro({ pessoa_id: 'p1', pessoa_nome: 'Humberto' }))).texto, 'FIXO')
})

test('a ação principal segue o estado do carro', () => {
  assert.deepEqual(acaoPrincipalDoVeiculo(naRua(carro()), { podeEditar: true }),
    { chave: 'devolver', rotulo: 'Devolver' })
  assert.deepEqual(acaoPrincipalDoVeiculo(estado(carro()), { podeEditar: true }),
    { chave: 'retirada', rotulo: 'Registrar retirada' })
})

test('carro que JÁ ESTÁ com alguém não convida a retirar', () => {
  // Achado na primeira foto: o Bravo, fixo com o Humberto, ganhou um botão
  // largo "Registrar retirada" — convidando a retirar um carro que está na mão
  // dele. O botão não some da tela; some do lugar que empurra.
  const fixo = estado(carro({ pessoa_id: 'p-humberto', pessoa_nome: 'Humberto Mendonça' }))
  assert.deepEqual(acaoPrincipalDoVeiculo(fixo, { podeEditar: true }),
    { chave: 'passe', rotulo: 'Passar ou recolher' })
})

test('carro na oficina ou fora da frota não tem ação principal', () => {
  // Botão largo apagado é pior que botão nenhum: promete e não cumpre.
  for (const s of ['em_manutencao', 'alienado', 'inativo']) {
    assert.equal(acaoPrincipalDoVeiculo(estado(carro({ situacao: s })), { podeEditar: true }), null,
      `${s} não devia oferecer ação principal`)
  }
})

test('quem não pode editar não vê ação principal nenhuma', () => {
  assert.equal(acaoPrincipalDoVeiculo(naRua(carro()), { podeEditar: false }), null)
  assert.equal(acaoPrincipalDoVeiculo(naRua(carro()), {}), null, 'sem opção nenhuma, assume que NÃO pode')
})

test('só oficina e fora da frota viram cartão pequeno — PARADO continua grande', () => {
  // Decisão do dono em 21/09: "menores no fim". Ele citou os dois; parado não
  // foi citado, e é carro que volta a circular.
  assert.equal(cartaoCompacto(estado(carro({ situacao: 'em_manutencao' }))), true)
  assert.equal(cartaoCompacto(estado(carro({ situacao: 'alienado' }))), true)
  assert.equal(cartaoCompacto(estado(carro({ situacao: 'inativo' }))), false)
  assert.equal(cartaoCompacto(estado(carro())), false)
  assert.equal(cartaoCompacto(naRua(carro())), false)
})

test('os cartões pequenos ficam NO FIM da lista, que é onde o dono os quer', () => {
  // A ordem já existia em ordenarEstados(); este teste prende as duas regras
  // juntas — encolher sem descer deixaria o carro pequeno no meio da lista.
  const lista = ordenarEstados([
    estado(carro({ id: 'a', nome: 'VOLVO XC90', situacao: 'em_manutencao' })),
    estado(carro({ id: 'b', nome: 'KWID' })),
    estado(carro({ id: 'c', nome: 'FIAT FIESTA', situacao: 'alienado' })),
    naRua(carro({ id: 'd', nome: 'BMW X1' })),
  ])
  const compactos = lista.map(cartaoCompacto)
  assert.deepEqual(compactos, [false, false, true, true],
    'os compactos têm de ser os dois últimos')
})

test('nada quebra com entrada vazia', () => {
  assert.deepEqual(seloDoVeiculo(null), { texto: '', tom: 'neutro' })
  assert.equal(acaoPrincipalDoVeiculo(null, { podeEditar: true }), null)
  assert.equal(cartaoCompacto(null), false)
})
