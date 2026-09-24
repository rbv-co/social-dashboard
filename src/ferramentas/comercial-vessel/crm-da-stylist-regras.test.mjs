import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  CANAIS, RESULTADOS, etapasDoFunil, etapasDeSaida, proximaEtapa, primeiraEtapa, etapasParaFiltrar,
  colunasDoQuadro, problemasDaEtapa, mensagemDasEtapas, motivoDoHistorico, prazoAtrasado, ultimoContatoEscrito,
} from './crm-da-stylist-regras.js'

const MIGRATION = readFileSync(new URL(
  '../../../db/migrations/2026-09-22-vessel-t11-bases-do-stylist-circle.sql', import.meta.url), 'utf8')
const FUNIL = readFileSync(new URL(
  '../../../db/migrations/2026-09-24-vessel-stylist-funil-configuravel.sql', import.meta.url), 'utf8')
const lista = (nome) => {
  const i = MIGRATION.indexOf(`constraint ${nome}`)
  assert.ok(i >= 0, `não achei ${nome}`)
  return [...MIGRATION.slice(i, MIGRATION.indexOf(')', MIGRATION.indexOf('(', MIGRATION.indexOf('in', i))) + 1)
    .matchAll(/'([a-z_]+)'/g)].map((m) => m[1])
}

// As etapas como `vessel_stylist_etapas()` devolve (as sete iniciais da migration).
const ETAPAS = [
  { id: 11, nome: 'Identificado', ordem: 1, tipo: 'funil' },
  { id: 12, nome: 'Classificação', ordem: 2, tipo: 'funil' },
  { id: 13, nome: 'Prospectado', ordem: 3, tipo: 'funil', conta_como_prospectada: true },
  { id: 14, nome: 'Convidado', ordem: 4, tipo: 'funil' },
  { id: 15, nome: 'Confirmado', ordem: 5, tipo: 'funil' },
  { id: 16, nome: 'Presença Confirmada', ordem: 6, tipo: 'funil' },
  { id: 17, nome: 'Desclassificado', ordem: 7, tipo: 'saida' },
]

test('canais e resultados são os CHECK do banco', () => {
  assert.deepEqual(Object.keys(CANAIS).sort(), lista('vessel_stylist_contatos_canal_valido').sort())
  assert.deepEqual(Object.keys(RESULTADOS).sort(), lista('vessel_stylist_contatos_resultado_valido').sort())
})

test('as etapas iniciais do código de exemplo são as que a migration semeia, na ordem', () => {
  const semente = [...FUNIL.matchAll(/\('([^']+)', (\d+), '(funil|saida)', (true|false),/g)]
    .map((m) => ({ nome: m[1], ordem: Number(m[2]), tipo: m[3], marcada: m[4] === 'true' }))
  assert.deepEqual(semente.map((e) => e.nome), ETAPAS.map((e) => e.nome))
  assert.deepEqual(semente.map((e) => e.tipo), ETAPAS.map((e) => e.tipo))
  assert.deepEqual(semente.filter((e) => e.marcada).map((e) => e.nome), ['Prospectado'])
})

test('funil e saídas, cada um na ordem (mesmo embaralhados na entrada)', () => {
  const embaralhadas = [ETAPAS[6], ETAPAS[2], ETAPAS[0], ETAPAS[5], ETAPAS[1], ETAPAS[4], ETAPAS[3]]
  assert.deepEqual(etapasDoFunil(embaralhadas).map((e) => e.nome),
    ['Identificado', 'Classificação', 'Prospectado', 'Convidado', 'Confirmado', 'Presença Confirmada'])
  assert.deepEqual(etapasDeSaida(embaralhadas).map((e) => e.nome), ['Desclassificado'])
  assert.deepEqual(etapasDoFunil(null), [])
  assert.equal(primeiraEtapa(embaralhadas).nome, 'Identificado')
  assert.equal(primeiraEtapa([]), null)
})

test('avançar vai para a próxima etapa de FUNIL; da última e de uma saída, nada', () => {
  assert.equal(proximaEtapa(ETAPAS, 11).nome, 'Classificação')
  assert.equal(proximaEtapa(ETAPAS, 13).nome, 'Convidado')
  assert.equal(proximaEtapa(ETAPAS, 16), null, 'a última do funil não avança para a saída')
  assert.equal(proximaEtapa(ETAPAS, 17), null, 'de uma saída não se avança')
  assert.equal(proximaEtapa(ETAPAS, 999), null)
  // Uma saída no MEIO da ordem é pulada.
  const comSaidaNoMeio = ETAPAS.map((e) => (e.id === 12 ? { ...e, tipo: 'saida' } : e))
  assert.equal(proximaEtapa(comSaidaNoMeio, 11).nome, 'Prospectado')
})

test('o filtro "Etapa": chave em texto, funil primeiro e saídas no fim', () => {
  assert.deepEqual(etapasParaFiltrar(ETAPAS), {
    11: 'Identificado', 12: 'Classificação', 13: 'Prospectado', 14: 'Convidado', 15: 'Confirmado',
    16: 'Presença Confirmada', 17: 'Desclassificado',
  })
  assert.deepEqual(Object.keys(etapasParaFiltrar(ETAPAS)), ['11', '12', '13', '14', '15', '16', '17'])
})

test('colunas: uma por etapa de funil, na ordem, e as saídas juntas no fim; atrasadas primeiro', () => {
  const c = colunasDoQuadro([
    { codigo: 'A', nome: 'Ana', etapa_id: 14, proxima_acao_em: '2026-09-30' },
    { codigo: 'B', nome: 'Bia', etapa_id: 14, proxima_acao_em: '2026-09-10' },
    { codigo: 'C', nome: 'Cris', etapa_id: 17 },
    { codigo: 'D', nome: 'Duda', etapa_id: 16 },
    { codigo: 'E', nome: 'Eva', etapa_id: 999 },
  ], ETAPAS, '2026-09-22')
  assert.deepEqual(c.map((x) => x.titulo),
    ['Identificado', 'Classificação', 'Prospectado', 'Convidado', 'Confirmado', 'Presença Confirmada', 'Saídas'])
  const col = (t) => c.find((x) => x.titulo === t).stylists.map((s) => s.codigo)
  assert.deepEqual(col('Convidado'), ['B', 'A'])
  assert.deepEqual(col('Saídas'), ['C'])
  assert.deepEqual(col('Presença Confirmada'), ['D'])
  assert.deepEqual(col('Identificado'), ['E'], 'etapa desconhecida cai na primeira coluna, nunca some')
  // Uma etapa nova aparece sozinha, no lugar da ordem dela.
  const comNova = [...ETAPAS, { id: 18, nome: 'Qualificada', ordem: 2.5, tipo: 'funil' }]
  assert.equal(colunasDoQuadro([], comNova, '2026-09-22')[2].titulo, 'Qualificada')
})

test('nome de etapa: obrigatório e até 60', () => {
  assert.deepEqual(problemasDaEtapa('Convidado'), [])
  assert.equal(problemasDaEtapa('  ').length, 1)
  assert.equal(problemasDaEtapa(null).length, 1)
  assert.equal(problemasDaEtapa('x'.repeat(61)).length, 1)
})

test('cada recusa das etapas tem a sua frase; ok e sem_mudanca não falam nada', () => {
  // As situações que o banco devolve, lidas do próprio arquivo da migration.
  const doBanco = [...new Set([...FUNIL.matchAll(/'situacao', '([a-z_]+)'/g)].map((m) => m[1]))]
  for (const s of ['sem_nome', 'nome_longo', 'nome_repetido', 'tipo_invalido', 'nao_achei', 'no_limite',
    'ultima_do_funil', 'etapa_marcada', 'saida_nao_conta', 'precisa_destino', 'destino_invalido', 'etapa_invalida']) {
    assert.ok(doBanco.includes(s), `${s} não sai mais do banco`)
    assert.notEqual(mensagemDasEtapas(s), mensagemDasEtapas('algo_novo'), `${s} caiu na frase genérica`)
  }
  assert.equal(mensagemDasEtapas('ok'), '')
  assert.equal(mensagemDasEtapas('sem_mudanca'), '')
  assert.match(mensagemDasEtapas('algo_novo'), /instante/)
})

test('o porquê do histórico de etapas', () => {
  assert.equal(motivoDoHistorico('cadastro'), 'Cadastro')
  assert.equal(motivoDoHistorico('mudanca'), 'Mudou de etapa')
  assert.equal(motivoDoHistorico('etapa_excluida'), 'A etapa foi excluída')
  // Os três motivos são os do CHECK da migration.
  const i = FUNIL.indexOf('vessel_stylist_etapas_historico_motivo_valido')
  const doCheck = [...FUNIL.slice(i, FUNIL.indexOf(')', FUNIL.indexOf('(', i + 60)) + 1).matchAll(/'([a-z_]+)'/g)].map((m) => m[1])
  assert.deepEqual(doCheck.sort(), ['cadastro', 'etapa_excluida', 'mudanca'])
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

// ── FIAÇÃO — o quadro, a ficha e a tela de etapas ───────────────────────────
const ler = (f) => readFileSync(new URL(f, import.meta.url), 'utf8')
test('FIAÇÃO: o quadro monta as colunas das etapas e avança pela próxima etapa', () => {
  const q = ler('./quadro-do-stylist-circle.vue')
  assert.match(q, /colunasDoQuadro\(props\.stylists, props\.etapas/)
  assert.match(q, /v-if="podeEditar && proximaEtapa\(etapas, s\.etapa_id\)"/)
  assert.match(q, /Avançar para \$\{proximaEtapa\(etapas, s\.etapa_id\)\.nome\}/)
  assert.doesNotMatch(q, /estagio/, 'nenhuma lista fechada de estágio no quadro')
})
test('FIAÇÃO: a ficha move pela porta nova, mostra o histórico de etapas e NÃO sugere etapa', () => {
  const f = ler('./ficha-da-stylist.vue')
  assert.match(f, /vessel_stylist_registrar_contato/)
  assert.match(f, /vessel_stylist_contatos/)
  assert.match(f, /vessel_stylist_mover_de_etapa/)
  assert.match(f, /vessel_stylist_historico_de_etapas/)
  assert.match(f, /Avançar para \$\{proxima\.nome\}/)
  assert.match(f, /v-trava-rolagem/)
  assert.doesNotMatch(f, /sugestao/, 'a sugestão de etapa saiu (24/09/2026)')
})
test('FIAÇÃO: a tela abre as etapas pela engrenagem e o quadro recebe a lista FILTRADA e as etapas', () => {
  const t = ler('./tela-de-stylist-circle.vue')
  assert.match(t, /:stylists="stylistsNaTela" :etapas="etapas"/)
  assert.match(t, /vista === 'quadro'/)
  assert.match(t, /nome="engrenagem"/)
  assert.match(t, /<etapas-do-funil v-if="etapasAbertas"/)
  assert.match(t, /chamar\('vessel_stylist_etapas'/)
  assert.match(t, /vessel_stylist_mover_de_etapa/)
  assert.doesNotMatch(t, /p_estagio/, 'a etapa não muda mais por vessel_stylist_editar')
})
test('FIAÇÃO: a tela de etapas chama as sete portas e é um modal da casa', () => {
  const e = ler('./etapas-do-funil.vue')
  for (const f of ['vessel_stylist_etapa_criar', 'vessel_stylist_etapa_renomear', 'vessel_stylist_etapa_mover',
    'vessel_stylist_etapa_tipo', 'vessel_stylist_etapa_marcar_prospectada', 'vessel_stylist_etapa_excluir']) {
    assert.match(e, new RegExp(`'${f}'`), `${f} não está na tela`)
  }
  assert.match(e, /v-trava-rolagem/)
  assert.match(e, /não muda as datas já/)
  // Excluir com gente dentro não passa sem destino.
  assert.match(e, /:disabled="gravando \|\| \(e\.stylists > 0 && !destino\)"/)
})

// ── 24/09/2026: a nota de qualificação só muda a ORDEM dentro da coluna ────
test('quadro com ordem "faixa": A antes de B antes de sem nota, na MESMA coluna', () => {
  const l = [
    { codigo: 'S1', nome: 'Xênia', etapa_id: 13, faixa: null },
    { codigo: 'S2', nome: 'Yara', etapa_id: 13, faixa: 'B' },
    { codigo: 'S3', nome: 'Zélia', etapa_id: 13, faixa: 'A' },
    { codigo: 'S4', nome: 'Wanda', etapa_id: 16, faixa: 'C' },
  ]
  const col = (c, t) => c.find((x) => x.titulo === t).stylists
  const porFaixa = colunasDoQuadro(l, ETAPAS, '2026-09-24', 'faixa')
  assert.deepEqual(col(porFaixa, 'Prospectado').map((s) => s.codigo), ['S3', 'S2', 'S1'])
  assert.deepEqual(col(porFaixa, 'Presença Confirmada').map((s) => s.codigo), ['S4'], 'a nota C não tira ninguém da coluna')
  const semOrdem = colunasDoQuadro(l, ETAPAS, '2026-09-24')
  assert.deepEqual(col(semOrdem, 'Prospectado').map((s) => s.nome), ['Xênia', 'Yara', 'Zélia'], 'a de sempre: pelo nome, sem prazo')
})
