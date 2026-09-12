import { test } from 'node:test'
import assert from 'node:assert/strict'
import { areasVisiveis, areaInicial, painelDoMotorista, resumoDoMotorista } from './areas-da-frota.js'
import { estadoDoVeiculo } from './estado-do-veiculo.js'

// Como as permissões chegam na prática: um `pode(acao)` fechado sobre o perfil.
const perfil = (...acoes) => (a) => acoes.includes(a)
const MOTORISTA = perfil('ver', 'editar')
const ADMIN = perfil('ver', 'criar', 'editar', 'excluir')

test('quem só dirige não vê a aba de Gestão', () => {
  assert.deepEqual(areasVisiveis(MOTORISTA), ['motorista'])
  assert.equal(areaInicial(MOTORISTA), 'motorista')
})

test('quem administra vê as duas, e abre na Gestão', () => {
  assert.deepEqual(areasVisiveis(ADMIN), ['motorista', 'gestao', 'revisoes', 'plano'])
  assert.equal(areaInicial(ADMIN), 'gestao')
})

test('Revisões anda junto com Gestão — quem cadastra veículo define os limiares', () => {
  assert.ok(areasVisiveis(ADMIN).includes('revisoes'))
  assert.ok(!areasVisiveis(MOTORISTA).includes('revisoes'), 'quem só dirige não vê o que está vencendo na frota')
  assert.ok(areasVisiveis(ADMIN).includes('plano'))
  assert.ok(!areasVisiveis(MOTORISTA).includes('plano'), 'quem só dirige não mexe nos limiares')
})

// Relatórios tem CHAVE DE PERMISSÃO PRÓPRIA (frota.relatorios), que não é a
// mesma que abre a Frota: quem cadastra veículo não é necessariamente quem pode
// tirar a frota inteira em planilha. Por isso vem num parâmetro separado, e não
// é deduzida de `pode`.
test('Relatórios não aparece só por ser admin da frota', () => {
  assert.ok(!areasVisiveis(ADMIN).includes('relatorios'))
})

test('Relatórios aparece quando a permissão própria está liberada', () => {
  assert.ok(areasVisiveis(ADMIN, true).includes('relatorios'))
})

test('Relatórios NÃO aparece para quem só dirige, mesmo com a permissão', () => {
  // A aba mostra a frota inteira, com contrato e valor — é área de quem
  // administra. A permissão de relatório não pode virar atalho para isso.
  assert.ok(!areasVisiveis(MOTORISTA, true).includes('relatorios'))
})

test('Relatórios entra por último, depois de Plano', () => {
  assert.deepEqual(areasVisiveis(ADMIN, true),
    ['motorista', 'gestao', 'revisoes', 'plano', 'relatorios'])
})

test('poder criar já basta pra Gestão, mesmo sem poder excluir', () => {
  // Cadastrar veículo é trabalho de gestão. Excluir é mais raro e mais grave;
  // exigir os dois esconderia a aba de quem cadastra e não apaga.
  assert.ok(areasVisiveis(perfil('ver', 'criar')).includes('gestao'))
  assert.ok(areasVisiveis(perfil('ver', 'excluir')).includes('gestao'))
})

test('sem permissão nenhuma ainda sobra a área Motorista', () => {
  // Quem chegou aqui já passou pelo guarda da rota. Devolver lista vazia
  // deixaria a tela em branco sem explicação.
  assert.deepEqual(areasVisiveis(perfil()), ['motorista'])
  assert.deepEqual(areasVisiveis(null), ['motorista'])
  assert.deepEqual(areasVisiveis(undefined), ['motorista'])
})

/* ── O painel de quem dirige ──────────────────────────────────────────────── */

const EU = 'p-eu'
const OUTRO = 'p-outro'
const carro = (id, nome, extra = {}) => ({ id, nome, placa: 'AAA0A00', situacao: 'ativo', ...extra })

function cenario() {
  const usos = [
    { veiculo_id: 'meu', pessoa_id: EU, pessoa_nome: 'Erick', saida_em: '2026-08-04T07:00Z', km_saida: 1000 },
    { veiculo_id: 'dele', pessoa_id: OUTRO, pessoa_nome: 'Raissa', saida_em: '2026-08-04T08:00Z', km_saida: 2000 },
  ]
  return [
    estadoDoVeiculo(carro('meu', 'Fiat Doblo'), usos),
    estadoDoVeiculo(carro('dele', 'Volvo XC60'), usos),
    estadoDoVeiculo(carro('livre', 'Fiat Punto'), usos),
    estadoDoVeiculo(carro('oficina', 'Porsche', { situacao: 'em_manutencao' }), usos),
    estadoDoVeiculo(carro('fora', 'Fiesta Hatch', { situacao: 'alienado' }), usos),
  ]
}

test('o carro que está COMIGO vem primeiro — é o que vim devolver', () => {
  const p = painelDoMotorista(cenario(), EU)
  assert.deepEqual(p.comigo.map((e) => e.veiculo.nome), ['Fiat Doblo'])
})

test('o carro de outra pessoa não vira "meu"', () => {
  const p = painelDoMotorista(cenario(), EU)
  assert.deepEqual(p.comOutros.map((e) => e.veiculo.nome), ['Volvo XC60'])
  assert.ok(!p.comigo.some((e) => e.veiculo.id === 'dele'))
})

test('oficina e fora da frota NÃO aparecem pro motorista', () => {
  // Não há nada que ele possa fazer com eles, e ocupam a tela de quem está de
  // pé no estacionamento.
  const p = painelDoMotorista(cenario(), EU)
  const tudo = [...p.comigo, ...p.livres, ...p.comOutros].map((e) => e.veiculo.id)
  assert.ok(!tudo.includes('oficina'))
  assert.ok(!tudo.includes('fora'))
})

test('livres são só os que ele pode pegar agora', () => {
  const p = painelDoMotorista(cenario(), EU)
  assert.deepEqual(p.livres.map((e) => e.veiculo.nome), ['Fiat Punto'])
})

test('pessoa não identificada não herda o carro de ninguém', () => {
  // Sem `pessoaId`, tudo que está na rua é "de outra pessoa" — nunca "meu".
  // Chutar aqui ofereceria a devolução de um carro que não é dela.
  const p = painelDoMotorista(cenario(), null)
  assert.equal(p.comigo.length, 0)
  assert.equal(p.comOutros.length, 2)
})

test('uso aberto sem pessoa registrada também não vira meu', () => {
  const usos = [{ veiculo_id: 'x', pessoa_id: null, saida_em: '2026-08-04T07:00Z' }]
  const p = painelDoMotorista([estadoDoVeiculo(carro('x', 'Sem dono'), usos)], EU)
  assert.equal(p.comigo.length, 0)
  assert.equal(p.comOutros.length, 1)
})

test('o resumo responde o que a pessoa veio perguntar', () => {
  assert.match(resumoDoMotorista(painelDoMotorista(cenario(), EU)), /Fiat Doblo/)
  // Quem NÃO está com carro nenhum ouve quantos pode pegar. (OUTRO não serve
  // aqui: no cenário ele está com o Volvo.)
  assert.equal(resumoDoMotorista(painelDoMotorista(cenario(), 'p-ninguem')), '1 carro livre.')

  const semNada = painelDoMotorista([], null)
  assert.equal(resumoDoMotorista(semNada), 'Nenhum carro livre agora.')
  assert.equal(resumoDoMotorista(null), 'Nenhum carro livre agora.')
})

test('quem está com dois carros vê a contagem, não uma lista atropelada', () => {
  const usos = [
    { veiculo_id: 'a', pessoa_id: EU, saida_em: 'x' },
    { veiculo_id: 'b', pessoa_id: EU, saida_em: 'y' },
  ]
  const p = painelDoMotorista([
    estadoDoVeiculo(carro('a', 'Um'), usos),
    estadoDoVeiculo(carro('b', 'Dois'), usos),
  ], EU)
  assert.equal(resumoDoMotorista(p), 'Você está com 2 veículos.')
})

test('o carro que EU reservei fica na minha lista de pegar, e some da dos outros', () => {
  // A cena real: reservei pras 8h, chego às 8h05 no estacionamento e abro o
  // app pra tocar em "Peguei o carro". Antes de 20/08/2026 o carro tinha
  // sumido da tela — a própria reserva o escondia de mim.
  const meuPedido = carro('reservado', 'Saveiro Robust', { reservada: true, reservada_para_mim: true })
  const doOutro = carro('reservado-dele', 'Strada', { reservada: true })

  const eu = painelDoMotorista([estadoDoVeiculo(meuPedido, []), estadoDoVeiculo(doOutro, [])], EU)
  assert.deepEqual(eu.livres.map((e) => e.veiculo.nome), ['Saveiro Robust'])

  // Pra quem não reservou, os dois continuam travados: é o conflito de viagens
  // que a reserva existe pra impedir.
  const outraPessoa = painelDoMotorista(
    [estadoDoVeiculo(carro('reservado', 'Saveiro Robust', { reservada: true }), []),
     estadoDoVeiculo(doOutro, [])], OUTRO)
  assert.deepEqual(outraPessoa.livres, [])
})
