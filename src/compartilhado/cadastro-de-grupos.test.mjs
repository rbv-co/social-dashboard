import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  acharGrupoPeloNome,
  agruparCanaisPorCadastro,
  podeApagarGrupo,
  nomeDeGrupoAceito,
} from './cadastro-de-grupos.js'

// Os dois grupos reais da base, medidos em 27/08/2026.
const VAREJO = { id: 'g-varejo', nome: 'Varejo' }
const ATACADO = { id: 'g-atacado', nome: 'Atacado' }
const GRUPOS = [VAREJO, ATACADO]

const canal = (loja_id, nome, grupo_id = null) => ({ loja_id, nome, grupo_id })

// ─────────────────────────────────────────────────────────────────────────────
// acharGrupoPeloNome — é ela que impede o grupo repetido

test('acha ignorando caixa e espaço das pontas', () => {
  assert.equal(acharGrupoPeloNome('  varejo ', GRUPOS), VAREJO)
  assert.equal(acharGrupoPeloNome('VAREJO', GRUPOS), VAREJO)
})

test('nome que não existe devolve nulo', () => {
  assert.equal(acharGrupoPeloNome('Marketplace', GRUPOS), null)
})

test('nome vazio devolve nulo, e não o primeiro da lista', () => {
  // Dois vazios "batendo" fariam qualquer nome casar com qualquer grupo.
  assert.equal(acharGrupoPeloNome('', GRUPOS), null)
  assert.equal(acharGrupoPeloNome('   ', GRUPOS), null)
  assert.equal(acharGrupoPeloNome(null, GRUPOS), null)
})

test('lista vazia ou ausente não quebra', () => {
  assert.equal(acharGrupoPeloNome('Varejo', []), null)
  assert.equal(acharGrupoPeloNome('Varejo', null), null)
})

// ─────────────────────────────────────────────────────────────────────────────
// agruparCanaisPorCadastro — o de hoje agrupa por TEXTO; este por APONTAMENTO

test('cada grupo leva os canais que apontam para ele', () => {
  const canais = [
    canal(1, 'Loja Dom Pedro', 'g-varejo'),
    canal(2, 'Atacado Fábrica', 'g-atacado'),
    canal(3, 'Loja Shopify', 'g-varejo'),
  ]
  const baldes = agruparCanaisPorCadastro(canais, GRUPOS)
  assert.deepEqual(baldes.map((b) => b.grupo && b.grupo.nome), ['Atacado', 'Varejo'])
  assert.deepEqual(baldes[1].canais.map((c) => c.nome), ['Loja Dom Pedro', 'Loja Shopify'])
})

test('GRUPO VAZIO APARECE — é a diferença para o agrupamento por texto', () => {
  // Pelo texto, um grupo sem canal simplesmente não existia: ele era deduzido
  // dos canais. Agora ele é uma linha cadastrada, e precisa aparecer para
  // alguém conseguir pôr canal dentro. Grupo que some é grupo que não se usa.
  const baldes = agruparCanaisPorCadastro([canal(1, 'Loja Dom Pedro', 'g-varejo')], GRUPOS)
  const atacado = baldes.find((b) => b.grupo && b.grupo.id === 'g-atacado')
  assert.ok(atacado, 'o grupo sem canal nenhum tem de aparecer')
  assert.deepEqual(atacado.canais, [])
})

test('os canais fora de todo grupo vão num balde no FIM', () => {
  const canais = [canal(1, 'Loja Dom Pedro', 'g-varejo'), canal(2, 'Institucional')]
  const baldes = agruparCanaisPorCadastro(canais, GRUPOS)
  const ultimo = baldes[baldes.length - 1]
  assert.equal(ultimo.grupo, null)
  assert.deepEqual(ultimo.canais.map((c) => c.nome), ['Institucional'])
})

test('sem nenhum canal solto, o balde do fim não nasce', () => {
  const baldes = agruparCanaisPorCadastro([canal(1, 'X', 'g-varejo')], GRUPOS)
  assert.ok(baldes.every((b) => b.grupo !== null), 'não pode ter balde "fora de todo grupo" vazio')
})

test('canal apontando para grupo que não existe mais conta como solto', () => {
  // FK é `on delete set null`, então isto não deveria acontecer — mas uma tela
  // que some com o canal por causa de dado torto é pior que o dado torto.
  const baldes = agruparCanaisPorCadastro([canal(9, 'Órfão', 'g-que-sumiu')], GRUPOS)
  const ultimo = baldes[baldes.length - 1]
  assert.equal(ultimo.grupo, null)
  assert.deepEqual(ultimo.canais.map((c) => c.nome), ['Órfão'])
})

test('o id casa como TEXTO: o banco manda number e o HTML manda string', () => {
  const baldes = agruparCanaisPorCadastro([{ loja_id: 7, nome: 'Sete', grupo_id: 'g-varejo' }], [{ id: 'g-varejo', nome: 'Varejo' }])
  assert.equal(baldes[0].canais.length, 1)
})

test('ordena os grupos por nome, em português', () => {
  const baldes = agruparCanaisPorCadastro([], [{ id: 'a', nome: 'Órgãos' }, { id: 'b', nome: 'Atacado' }])
  assert.deepEqual(baldes.map((b) => b.grupo.nome), ['Atacado', 'Órgãos'])
})

// ─────────────────────────────────────────────────────────────────────────────
// podeApagarGrupo — o FK é `on delete set null`, então apagar sem olhar
// desligaria os canais em silêncio

test('grupo sem canal nenhum pode ser apagado', () => {
  assert.deepEqual(podeApagarGrupo('g-atacado', [canal(1, 'X', 'g-varejo')]), { ok: true, quantos: 0 })
})

test('grupo COM canal não pode: apagar desligaria os canais sem avisar', () => {
  const r = podeApagarGrupo('g-varejo', [canal(1, 'X', 'g-varejo'), canal(2, 'Y', 'g-varejo')])
  assert.equal(r.ok, false)
  assert.equal(r.quantos, 2)
  assert.match(r.mensagem, /2 canais/)
})

test('a mensagem fala no singular quando é um canal só', () => {
  const r = podeApagarGrupo('g-varejo', [canal(1, 'X', 'g-varejo')])
  assert.match(r.mensagem, /1 canal[^i]/)
})

// ─────────────────────────────────────────────────────────────────────────────
// nomeDeGrupoAceito — vale para criar E para renomear

test('nome vazio é recusado com motivo', () => {
  const r = nomeDeGrupoAceito('   ', GRUPOS)
  assert.equal(r.ok, false)
  assert.match(r.mensagem, /nome/i)
})

test('nome que já existe é recusado, dizendo qual', () => {
  const r = nomeDeGrupoAceito('varejo', GRUPOS)
  assert.equal(r.ok, false)
  assert.match(r.mensagem, /Varejo/)
})

test('nome novo é aceito, e volta normalizado', () => {
  const r = nomeDeGrupoAceito('  Marketplace   Novo ', GRUPOS)
  assert.deepEqual(r, { ok: true, nome: 'Marketplace Novo' })
})

test('RENOMEAR: o próprio grupo não conta como repetido de si mesmo', () => {
  // Sem isto, corrigir "varejo" para "Varejo" seria recusado por já existir —
  // e a correção de grafia é justamente para o que serve o renomear.
  const r = nomeDeGrupoAceito('Varejo', GRUPOS, 'g-varejo')
  assert.deepEqual(r, { ok: true, nome: 'Varejo' })
})

test('RENOMEAR: mas o nome de OUTRO grupo continua recusado', () => {
  const r = nomeDeGrupoAceito('Atacado', GRUPOS, 'g-varejo')
  assert.equal(r.ok, false)
  assert.match(r.mensagem, /Atacado/)
})
