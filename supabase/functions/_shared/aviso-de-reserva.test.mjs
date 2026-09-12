import { test } from 'node:test'
import assert from 'node:assert/strict'
import { montarAvisoDeReserva, quandoNoAviso } from './aviso-de-reserva.js'

const CARRO = { nome: 'VW SAVEIRO ROBUST' }
const base = { retirada_prevista: '2026-08-21T11:00:00Z', destino: 'Conchal' }

test('aprovada: o que foi decidido vem primeiro, e o resto embaixo', () => {
  const a = montarAvisoDeReserva({ requisicao: { ...base, situacao: 'aprovada' }, veiculo: CARRO })
  assert.equal(a.titulo, 'Reserva aprovada')
  assert.match(a.corpo, /VW SAVEIRO ROBUST/)
  assert.match(a.corpo, /21\/08 às 08:00/, 'a hora sai em Brasília, não em UTC')
  assert.match(a.corpo, /Conchal/)
  assert.equal(a.url, '/frota')
})

test('recusada: o MOTIVO vai junto — é a razão de o aviso existir', () => {
  // Quem recusa é obrigado pela tela a escrever o motivo. Mandar só "recusada"
  // faria a pessoa pedir de novo igual, e o segundo pedido morreria pelo mesmo
  // motivo do primeiro.
  const a = montarAvisoDeReserva({
    requisicao: { ...base, situacao: 'recusada', motivo_decisao: 'A Strada já está com a equipe de Conchal.' },
    veiculo: CARRO,
  })
  assert.equal(a.titulo, 'Reserva recusada')
  assert.match(a.corpo, /A Strada já está com a equipe de Conchal\./)
})

test('recusada sem motivo escrito não finge que tem um', () => {
  const a = montarAvisoDeReserva({ requisicao: { ...base, situacao: 'recusada' }, veiculo: CARRO })
  assert.match(a.corpo, /sem motivo escrito/)
  assert.match(a.corpo, /Fale com quem administra/)
})

test('motivo comprido é cortado aqui, com reticências, e não pelo celular', () => {
  const enorme = 'porque sim '.repeat(40)
  const a = montarAvisoDeReserva({
    requisicao: { ...base, situacao: 'recusada', motivo_decisao: enorme }, veiculo: CARRO,
  })
  assert.ok(a.corpo.length < 220, 'corpo de push não pode ser um parágrafo')
  assert.match(a.corpo, /…$/)
})

test('revogada e cancelada avisam que o carro deixou de ser da pessoa', () => {
  // As duas são outra pessoa mexendo na reserva alheia, com motivo obrigatório
  // escrito. A primeira versão deixou 'cancelada' de fora por uma suposição
  // errada — quem pediu NÃO cancela o próprio pedido pela tela, porque
  // cancelar exige permissão de aprovar.
  const rev = montarAvisoDeReserva({
    requisicao: { ...base, situacao: 'revogada', encerrada_motivo: 'O carro entrou na oficina.' },
    veiculo: CARRO,
  })
  assert.match(rev.titulo, /encerrada/i)
  assert.match(rev.corpo, /oficina/)

  const can = montarAvisoDeReserva({
    requisicao: { ...base, situacao: 'cancelada', encerrada_motivo: 'A viagem foi adiada.' },
    veiculo: CARRO,
  })
  assert.match(can.titulo, /cancelada/i)
  assert.match(can.corpo, /adiada/)
  assert.notEqual(rev.titulo, can.titulo, 'as duas palavras são diferentes porque as situações são')
})

test('encerrada sem motivo escrito ainda diz o que mudou', () => {
  const a = montarAvisoDeReserva({ requisicao: { ...base, situacao: 'cancelada' }, veiculo: CARRO })
  assert.match(a.corpo, /não está mais reservado/)
})

test('o que NÃO é decisão não vira aviso nenhum', () => {
  // "Sua reserva continua pendente" no celular é o tipo de aviso que ensina a
  // ignorar aviso.
  for (const situacao of ['pendente', 'usada', undefined]) {
    assert.equal(montarAvisoDeReserva({ requisicao: { ...base, situacao }, veiculo: CARRO }), null, String(situacao))
  }
  assert.equal(montarAvisoDeReserva(), null)
})

test('sem veículo e sem data, o aviso ainda diz alguma coisa de pé', () => {
  const a = montarAvisoDeReserva({ requisicao: { situacao: 'aprovada' } })
  assert.equal(a.titulo, 'Reserva aprovada')
  assert.doesNotMatch(a.corpo, /undefined|null|Invalid/)
  assert.equal(quandoNoAviso('data podre'), null)
})
