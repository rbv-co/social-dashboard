// src/ferramentas/autenticidade/garantia-pelo-material.test.mjs
//
// A REGRA NOVA DA GARANTIA (decisão do dono, 18/09/2026): 2 anos para peça em
// CANVAS, 6 meses para peça em COURO, contados da DATA DA COMPRA, e vale com a
// nota ou o cupom fiscal. O material mora no LOTE (`vessel_lotes.material`).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  TEXTO_GERAL_DA_GARANTIA,
  prazoDoMaterial,
  materialDoCodigo,
  avisoDaAprovacao,
  avisoDaTroca,
} from './garantia-pelo-material.js'

const TELA = readFileSync(new URL('./tela-de-autenticidade.vue', import.meta.url), 'utf8')
const template = TELA.slice(0, TELA.indexOf('<script'))

test('o texto geral é o da regra nova, palavra por palavra', () => {
  assert.equal(TEXTO_GERAL_DA_GARANTIA,
    'A garantia VESSEL é de 2 anos para peças em canvas e 6 meses para peças em couro, '
    + 'contados da data da compra, e vale com a nota ou o cupom fiscal.')
})

test('o prazo sai do material: canvas 2 anos, couro 6 meses, sem material nada', () => {
  assert.equal(prazoDoMaterial('canvas'), '2 anos (canvas)')
  assert.equal(prazoDoMaterial('couro'), '6 meses (couro)')
  // ⚠️ Sem material NUNCA chuta 2 anos: uma data errada parece certa.
  assert.equal(prazoDoMaterial(null), null)
  assert.equal(prazoDoMaterial(undefined), null)
  assert.equal(prazoDoMaterial(''), null)
  assert.equal(prazoDoMaterial('seda'), null)
})

test('o material do código sai da peça → lote', () => {
  const lotes = [{ id: 'L1', material: 'canvas' }, { id: 'L2', material: 'couro' }, { id: 'L3', material: null }]
  const pecas = [
    { codigo: 'AAA111', lote_id: 'L1' },
    { codigo: 'BBB222', lote_id: 'L2' },
    { codigo: 'CCC333', lote_id: 'L3' },
  ]
  assert.equal(materialDoCodigo('AAA111', pecas, lotes), 'canvas')
  assert.equal(materialDoCodigo('BBB222', pecas, lotes), 'couro')
  assert.equal(materialDoCodigo('CCC333', pecas, lotes), null)
  assert.equal(materialDoCodigo('NAOEXISTE', pecas, lotes), null)
  assert.equal(materialDoCodigo('AAA111', null, null), null)
})

test('o aviso da aprovação diz o prazo CERTO da peça', () => {
  assert.equal(avisoDaAprovacao('canvas'),
    'A garantia passa a valer no nome dela: 2 anos (canvas), contados da data da compra.')
  assert.equal(avisoDaAprovacao('couro'),
    'A garantia passa a valer no nome dela: 6 meses (couro), contados da data da compra.')
})

test('⚠️ sem material, o aviso da aprovação NÃO promete prazo nenhum da peça', () => {
  const t = avisoDaAprovacao(null)
  assert.match(t, /ainda não tem material/)
  assert.ok(t.includes(TEXTO_GERAL_DA_GARANTIA), 'mostra a regra geral')
  assert.doesNotMatch(t, /contando 2 anos/)
})

test('o aviso da troca de dono: com data mostra a data; sem data não mostra "até —"', () => {
  assert.equal(avisoDaTroca('18/09/2028'),
    'continua valendo até 18/09/2028, contando da compra original.')
  const semData = avisoDaTroca(null)
  assert.doesNotMatch(semData, /até —|até null|até undefined/)
  assert.match(semData, /compra original/)
})

test('⚠️ a tela não promete mais "2 anos" cravado', () => {
  assert.doesNotMatch(template, /contando 2 anos/,
    'o aviso da aprovação tem de sair de avisoDaAprovacao(material)')
  assert.doesNotMatch(template, /\b2 anos\b/, 'nenhum "2 anos" solto no template')
  assert.doesNotMatch(template, /24 meses/)
})

test('a tela usa as regras daqui — aprovação, troca e o material na lista de garantias', () => {
  assert.match(template, /avisoDaAprovacao\(materialDoCodigo\(pd\.codigo/)
  assert.match(template, /A garantia <strong>não recomeça<\/strong>: \{\{ avisoDaTroca\(/)
  // A coluna "Garantia até" mostra também o material do lote (só leitura).
  const lista = template.slice(template.indexOf('au-tabela-garantias'))
  const linha = lista.slice(0, lista.indexOf('au-card-linha'))
  assert.match(linha, /prazoDoMaterial\(materialDoCodigo\(r\.codigo/)
})
