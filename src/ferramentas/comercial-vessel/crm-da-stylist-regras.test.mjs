import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  CANAIS, RESULTADOS, FLUXO_PRINCIPAL, SAIDAS, sugestaoDeEtapa, proximaEtapaManual,
  reabrirPara, colunasDoQuadro, prazoAtrasado, ultimoContatoEscrito,
} from './crm-da-stylist-regras.js'
import { ESTAGIOS_DA_STYLIST } from './t11-regras.js'

const MIGRATION = readFileSync(new URL(
  '../../../db/migrations/2026-09-22-vessel-t11-bases-do-stylist-circle.sql', import.meta.url), 'utf8')
const lista = (nome) => {
  const i = MIGRATION.indexOf(`constraint ${nome}`)
  assert.ok(i >= 0, `não achei ${nome}`)
  return [...MIGRATION.slice(i, MIGRATION.indexOf(')', MIGRATION.indexOf('(', MIGRATION.indexOf('in', i))) + 1)
    .matchAll(/'([a-z_]+)'/g)].map((m) => m[1])
}

test('canais e resultados são os CHECK do banco', () => {
  assert.deepEqual(Object.keys(CANAIS).sort(), lista('vessel_stylist_contatos_canal_valido').sort())
  assert.deepEqual(Object.keys(RESULTADOS).sort(), lista('vessel_stylist_contatos_resultado_valido').sort())
})

test('fluxo + saídas = os onze estágios', () => {
  assert.deepEqual([...FLUXO_PRINCIPAL, ...SAIDAS].sort(), Object.keys(ESTAGIOS_DA_STYLIST).sort())
})

test('sugestão: só para a frente', () => {
  assert.equal(sugestaoDeEtapa('conversou', 'prospectado', null), 'contatado')
  assert.equal(sugestaoDeEtapa('interesse', 'contatado', null), 'interessado')
  assert.equal(sugestaoDeEtapa('proposta', 'prospectado', null), 'em_negociacao')
  assert.equal(sugestaoDeEtapa('conversou', 'interessado', null), null)
  assert.equal(sugestaoDeEtapa('sem_resposta', 'prospectado', null), null)
  assert.equal(sugestaoDeEtapa('marcou_encontro', 'em_negociacao', null), null)
})

test('sugestão: nunca em pausado/inativo nem depois do encontro', () => {
  for (const e of ['pausado', 'inativo']) assert.equal(sugestaoDeEtapa('conversou', e, null), null)
  assert.equal(sugestaoDeEtapa('conversou', 'ativado', 'x'), null)
  assert.equal(sugestaoDeEtapa('recusou', 'recorrente', 'x'), null)
})

test('sugestão: recusou vai para Não interessado só antes do encontro', () => {
  assert.equal(sugestaoDeEtapa('recusou', 'contatado', null), 'nao_interessado')
  assert.equal(sugestaoDeEtapa('recusou', 'nao_interessado', null), null)
})

test('sugestão: quem estava em Sem retorno e voltou a conversar é sugerida de volta', () => {
  assert.equal(sugestaoDeEtapa('conversou', 'sem_retorno', null), 'contatado')
  assert.equal(sugestaoDeEtapa('conversou', 'sem_retorno', 'x'), null)
})

test('a sugestão do banco é a mesma tabela', () => {
  const i = MIGRATION.indexOf('function public.vessel_stylist_sugestao_de_etapa')
  const corpo = MIGRATION.slice(i, MIGRATION.indexOf('$$;', i))
  for (const [r, e] of [['conversou', 'contatado'], ['interesse', 'interessado'],
    ['proposta', 'em_negociacao'], ['recusou', 'nao_interessado']]) {
    assert.match(corpo, new RegExp(`'${r}'[^\\n]*'${e}'`), `${r} → ${e} não está no banco`)
  }
})

test('avançar só existe nas etapas manuais', () => {
  assert.equal(proximaEtapaManual('prospectado'), 'contatado')
  assert.equal(proximaEtapaManual('contatado'), 'interessado')
  assert.equal(proximaEtapaManual('interessado'), 'em_negociacao')
  for (const e of ['em_negociacao', 'ativado', 'recorrente', 'pausado']) assert.equal(proximaEtapaManual(e), null)
})

test('reabrir: volta ao começo, ou ao fato se já teve encontro', () => {
  assert.equal(reabrirPara(null), 'prospectado')
  assert.equal(reabrirPara('2026-09-01T00:00:00Z'), 'sem_retorno')
})

test('colunas: cada stylist numa coluna, atrasadas primeiro', () => {
  const c = colunasDoQuadro([
    { codigo: 'A', nome: 'Ana', estagio: 'contatado', proxima_acao_em: '2026-09-30' },
    { codigo: 'B', nome: 'Bia', estagio: 'contatado', proxima_acao_em: '2026-09-10' },
    { codigo: 'C', nome: 'Cris', estagio: 'pausado' },
    { codigo: 'D', nome: 'Duda', estagio: 'recorrente' },
  ], '2026-09-22')
  assert.deepEqual(c.contatado.map((s) => s.codigo), ['B', 'A'])
  assert.deepEqual(c.saidas.map((s) => s.codigo), ['C'])
  assert.deepEqual(c.recorrente.map((s) => s.codigo), ['D'])
  assert.deepEqual(c.prospectado, [])
})

test('prazo atrasado é antes de hoje, não hoje', () => {
  assert.equal(prazoAtrasado('2026-09-21', '2026-09-22'), true)
  assert.equal(prazoAtrasado('2026-09-22', '2026-09-22'), false)
  assert.equal(prazoAtrasado(null, '2026-09-22'), false)
})

test('último contato escrito', () => {
  const agora = new Date('2026-09-22T15:00:00-03:00')
  assert.equal(ultimoContatoEscrito(null, agora), 'nenhum contato registrado')
  assert.equal(ultimoContatoEscrito('2026-09-22T09:00:00-03:00', agora), 'último contato hoje')
  assert.equal(ultimoContatoEscrito('2026-09-21T20:00:00-03:00', agora), 'último contato ontem')
  assert.equal(ultimoContatoEscrito('2026-09-19T10:00:00-03:00', agora), 'último contato há 3 dias')
})

// ── FIAÇÃO — o quadro e a ficha (Task 3) ────────────────────────────────────
const ler = (f) => readFileSync(new URL(f, import.meta.url), 'utf8')
test('FIAÇÃO: o quadro usa colunasDoQuadro e só oferece avançar nas etapas manuais', () => {
  const q = ler('./quadro-do-stylist-circle.vue')
  assert.match(q, /colunasDoQuadro\(/)
  assert.match(q, /proximaEtapaManual\(/)
  assert.match(q, /v-if="podeEditar && proximaEtapaManual\(s\.estagio\)"/)
})
test('FIAÇÃO: a ficha registra pelo banco e só SUGERE a etapa', () => {
  const f = ler('./ficha-da-stylist.vue')
  assert.match(f, /vessel_stylist_registrar_contato/)
  assert.match(f, /vessel_stylist_contatos/)
  assert.match(f, /v-trava-rolagem/)
  assert.doesNotMatch(f, /p_estagio:\s*r\.sugestao/, 'a sugestão não pode ser gravada sem o toque da Ionara')
})
test('FIAÇÃO: a tela tem as duas vistas e o quadro recebe a lista FILTRADA', () => {
  const t = ler('./tela-de-stylist-circle.vue')
  assert.match(t, /:stylists="stylistsNaTela"/)
  assert.match(t, /vista === 'quadro'/)
})

// ── 24/09/2026: a nota de qualificação só muda a ORDEM dentro da coluna ────
test('quadro com ordem "faixa": A antes de B antes de sem nota, na MESMA coluna', () => {
  const l = [
    { codigo: 'S1', nome: 'Xênia', estagio: 'prospectado', faixa: null },
    { codigo: 'S2', nome: 'Yara', estagio: 'prospectado', faixa: 'B' },
    { codigo: 'S3', nome: 'Zélia', estagio: 'prospectado', faixa: 'A' },
    { codigo: 'S4', nome: 'Wanda', estagio: 'recorrente', faixa: 'C' },
  ]
  const porFaixa = colunasDoQuadro(l, '2026-09-24', 'faixa')
  assert.deepEqual(porFaixa.prospectado.map((s) => s.codigo), ['S3', 'S2', 'S1'])
  assert.deepEqual(porFaixa.recorrente.map((s) => s.codigo), ['S4'], 'a nota C não tira ninguém da coluna')
  const semOrdem = colunasDoQuadro(l, '2026-09-24')
  assert.deepEqual(semOrdem.prospectado.map((s) => s.nome), ['Xênia', 'Yara', 'Zélia'], 'a de sempre: pelo nome, sem prazo')
})
