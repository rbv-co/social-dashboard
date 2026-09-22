import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  ESTAGIOS_DA_STYLIST, ESTAGIOS_AUTOMATICOS, estagiosDeEscolher, seloDoEstagio,
  ORIGENS_DE_CONTATO, STATUS_DO_ENCONTRO, precisaDeMotivo, seloDoStatus,
  mensagemDeSituacaoDoEncontro, SITUACOES_DO_CONVITE, seloDoConvite, gestosDaConvidada,
  problemasDaConvidada, mensagemDeConvidar, telefoneLegivel, avisoDos45Dias,
  periodoDoPlacar, taxasDoPlacar, proximaDataPermitidaDaLista,
} from './t11-regras.js'

// ⚠️ AS LISTAS DA TELA TÊM DE SER AS LISTAS DO BANCO, letra por letra. Lidas
// do próprio arquivo da migration: redigitar aqui seria uma terceira cópia.
const MIGRATION = readFileSync(new URL(
  '../../../db/migrations/2026-09-22-vessel-t11-bases-do-stylist-circle.sql', import.meta.url), 'utf8')
const listaDoCheck = (nome) => {
  const i = MIGRATION.indexOf(`add constraint ${nome}`)
  assert.ok(i >= 0, `não achei o CHECK ${nome} na migration`)
  const trecho = MIGRATION.slice(i, MIGRATION.indexOf(';', i))
  return [...trecho.matchAll(/'([a-z_]+)'/g)].map((m) => m[1])
}

test('o funil da tela é exatamente o CHECK do banco', () => {
  assert.deepEqual(Object.keys(ESTAGIOS_DA_STYLIST).sort(),
    listaDoCheck('vessel_stylists_estagio_valido').sort())
})

test('a situação do encontro é exatamente o CHECK do banco', () => {
  assert.deepEqual(Object.keys(STATUS_DO_ENCONTRO).sort(),
    listaDoCheck('vessel_private_edits_status_valido').sort())
})

test('a origem do contato é exatamente o CHECK do banco', () => {
  assert.deepEqual(Object.keys(ORIGENS_DE_CONTATO).sort(),
    listaDoCheck('vessel_stylists_origem_contato_valida').sort())
})

test('a situação do convite cobre tudo o que o banco calcula', () => {
  const i = MIGRATION.indexOf('function public.vessel_situacao_do_convite')
  const corpo = MIGRATION.slice(i, MIGRATION.indexOf('$$;', i))
  const doBanco = [...new Set([...corpo.matchAll(/(?:then|else) '([a-z_]+)'/g)].map((m) => m[1]))]
  assert.ok(doBanco.length >= 7)
  for (const s of doBanco) assert.ok(SITUACOES_DO_CONVITE[s], `sem rótulo para ${s}`)
})

test('os três degraus automáticos nunca aparecem para escolher', () => {
  for (const ativada of [null, '2026-09-22T12:00:00Z']) {
    const lista = estagiosDeEscolher(ativada)
    for (const a of ESTAGIOS_AUTOMATICOS) assert.ok(!lista.includes(a), `${a} apareceu`)
  }
})

test('quem já teve encontro não volta para antes dele', () => {
  const lista = estagiosDeEscolher('2026-09-22T12:00:00Z')
  assert.deepEqual(lista, ['sem_retorno', 'nao_interessado', 'pausado', 'inativo'])
  assert.ok(estagiosDeEscolher(null).includes('contatado'))
})

test('selo do estágio: desconhecido não some, vira o próprio texto', () => {
  assert.equal(seloDoEstagio('recorrente').classe, 'cv-selo-viva')
  assert.equal(seloDoEstagio('pausado').classe, 'cv-selo-fim')
  assert.equal(seloDoEstagio('xyz').texto, 'xyz')
  assert.equal(seloDoEstagio(null).texto, 'Sem estágio')
})

test('motivo só é exigido para cancelado e não realizado', () => {
  assert.equal(precisaDeMotivo('cancelado'), true)
  assert.equal(precisaDeMotivo('nao_realizado'), true)
  for (const s of ['agendado', 'realizado', 'reagendado']) assert.equal(precisaDeMotivo(s), false)
})

test('selo do encontro: arquivada vence o status', () => {
  assert.equal(seloDoStatus({ arquivada: true, status: 'realizado' }).texto, 'Arquivada')
  assert.equal(seloDoStatus({ status: 'cancelado' }).classe, 'cv-selo-fim')
  assert.equal(seloDoStatus({}).texto, 'Agendado')
})

test('cada recusa da situação do encontro tem a sua frase', () => {
  for (const s of ['sem_permissao', 'nao_achei', 'status_invalido', 'sem_motivo', 'realizado_no_futuro']) {
    const f = mensagemDeSituacaoDoEncontro(s)
    assert.ok(f && !/tente de novo em um instante/.test(f), `${s} caiu na frase genérica`)
  }
  assert.ok(mensagemDeSituacaoDoEncontro('???'))
})

test('gestos da convidada: nunca oferece o que já está marcado', () => {
  const nova = gestosDaConvidada({ status: 'solicitado' }).map((g) => g.gesto)
  assert.deepEqual(nova, ['enviado', 'sim', 'nao', 'realizado', 'no_show'])
  const enviada = gestosDaConvidada({ status: 'solicitado', convite_enviado_em: 'x' }).map((g) => g.gesto)
  assert.ok(!enviada.includes('enviado'))
  const veio = gestosDaConvidada({ status: 'realizado', rsvp: 'sim' }).map((g) => g.gesto)
  // ⚠️ Quem veio ainda pode ser corrigida para "não veio" — engano da gerente.
  assert.deepEqual(veio, ['no_show'])
})

test('convidada: nome e WhatsApp com DDD obrigatórios; e-mail só se escrito', () => {
  assert.deepEqual(problemasDaConvidada({ nome: 'Ana', whatsapp: '(19) 99999-0000' }), [])
  assert.equal(problemasDaConvidada({ nome: '', whatsapp: '999990000' }).length, 2)
  assert.equal(problemasDaConvidada({ nome: 'Ana', whatsapp: '19999990000', email: 'ana@' }).length, 1)
})

test('convidar: "já estava" não é erro, é a mesma cadeira', () => {
  assert.match(mensagemDeConvidar('ja_estava'), /mesma convidada/)
  assert.match(mensagemDeConvidar('encontro_fechado'), /cancelado ou arquivado/)
})

test('telefone legível não inventa dígito', () => {
  assert.equal(telefoneLegivel('5519999990000'), '(19) 99999-0000')
  assert.equal(telefoneLegivel('551933330000'), '(19) 3333-0000')
  assert.equal(telefoneLegivel('123'), '123')
})

test('45 dias: avisa antes do limite, cala no limite e depois', () => {
  assert.match(avisoDos45Dias('2026-11-05', '2026-10-20T19:00'), /05\/11\/2026/)
  assert.equal(avisoDos45Dias('2026-11-05', '2026-11-05T19:00'), '')
  assert.equal(avisoDos45Dias(null, '2026-10-20T19:00'), '')
  assert.equal(avisoDos45Dias('2026-11-05', ''), '')
})

test('45 dias pela lista: o encontro realizado MAIS RECENTE da stylist, sem arquivado', () => {
  const lista = [
    { stylist: 'STY-0001', status: 'realizado', realizado_em: '2026-09-01' },
    { stylist: 'STY-0001', status: 'realizado', realizado_em: '2026-09-20' },
    { stylist: 'STY-0001', status: 'realizado', realizado_em: '2026-09-30', arquivada: true },
    { stylist: 'STY-0001', status: 'agendado', realizado_em: null },
    { stylist: 'STY-0002', status: 'realizado', realizado_em: '2026-09-25' },
  ]
  assert.equal(proximaDataPermitidaDaLista(lista, 'STY-0001'), '2026-11-04')
  assert.equal(proximaDataPermitidaDaLista(lista, 'STY-0009'), null)
  assert.equal(proximaDataPermitidaDaLista(null, 'STY-0001'), null)
})

test('período: "este mês" vai até o ÚLTIMO dia, não até hoje', () => {
  const hoje = new Date(2026, 8, 22)
  assert.deepEqual(periodoDoPlacar('mes', hoje), { p_de: '2026-09-01', p_ate: '2026-09-30' })
  assert.deepEqual(periodoDoPlacar('30', hoje), { p_de: '2026-08-24', p_ate: '2026-09-22' })
  assert.deepEqual(periodoDoPlacar('tudo', hoje), { p_de: null, p_ate: null })
  // Fevereiro não tem 30.
  assert.equal(periodoDoPlacar('mes', new Date(2027, 1, 10)).p_ate, '2027-02-28')
})

test('placar: taxas carregam de quantos saíram, e sem base não viram 0%', () => {
  const t = taxasDoPlacar({ prospectadas: 10, ativadas: 3, encontros_agendados: 4, encontros_realizados: 3,
    confirmadas: 9, presentes: 7, compradoras: 2, vendas: 3, receita: 4500, pecas: 5,
    recorrentes_ate_o_fim: 1, ativadas_ate_o_fim: 3 })
  assert.equal(t.ativacao.x, 3); assert.equal(t.ativacao.n, 10)
  assert.equal(t.showRate.valor, 7 / 9)
  assert.equal(t.ticket.valor, 1500)
  assert.equal(t.pecasPorCliente.valor, 2.5)
  const vazio = taxasDoPlacar({})
  for (const v of Object.values(vazio)) assert.equal(v.temBase, false)
})

// ── a fiação: o `.vue` usa as regras, não reescreve ─────────────────────────

const TELA_STY = readFileSync(new URL('./tela-de-stylist-circle.vue', import.meta.url), 'utf8')
const TELA_PE = readFileSync(new URL('./tela-de-private-edit.vue', import.meta.url), 'utf8')

test('FIAÇÃO: o estágio é escolhido numa lista, não digitado', () => {
  assert.doesNotMatch(TELA_STY, /list="sty-estagios-sugeridos"/, 'o datalist de texto livre voltou')
  assert.match(TELA_STY, /estagiosDeEscolher\(/)
})

test('FIAÇÃO: o placar vem do banco e as taxas de taxasDoPlacar', () => {
  assert.match(TELA_STY, /vessel_placar_do_stylist_circle/)
  assert.match(TELA_STY, /taxasDoPlacar\(/)
})

test('FIAÇÃO: a situação do encontro e o convite passam pelas funções do banco', () => {
  assert.match(TELA_PE, /vessel_private_edit_situacao/)
  assert.match(TELA_PE, /vessel_convidar_para_encontro/)
  assert.match(TELA_PE, /vessel_convite_marcar/)
  // A presença pela MESMA porta da Central de Atendimentos.
  assert.match(TELA_PE, /vessel_situacao_do_atendimento/)
})

test('FIAÇÃO: as duas telas medem a venda com a MESMA janela de 14 dias', () => {
  assert.match(TELA_STY, /const P_DIAS = 14/)
  assert.match(TELA_PE, /const P_DIAS = 14/)
})
