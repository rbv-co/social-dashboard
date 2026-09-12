import { test } from 'node:test'
import assert from 'node:assert/strict'
import { temAcessoPatrimonio, pilulaDaSituacaoDoBem, agruparPorPessoa, decidirEstadoDaSecao } from './bens-e-veiculos-da-pessoa.js'

test('temAcessoPatrimonio: super-admin sempre tem, mesmo sem a feature na lista', () => {
  assert.equal(temAcessoPatrimonio({ is_superadmin: true, features: [] }), true)
})

test('temAcessoPatrimonio: quem tem a feature "patrimonio" no perfil tem acesso', () => {
  assert.equal(temAcessoPatrimonio({ is_superadmin: false, features: ['frota', 'patrimonio'] }), true)
})

test('temAcessoPatrimonio: sem a feature e sem ser super-admin, não tem', () => {
  assert.equal(temAcessoPatrimonio({ is_superadmin: false, features: ['frota'] }), false)
})

test('temAcessoPatrimonio: estado ausente ou incompleto nunca quebra e nunca libera', () => {
  assert.equal(temAcessoPatrimonio(null), false)
  assert.equal(temAcessoPatrimonio({}), false)
  assert.equal(temAcessoPatrimonio({ is_superadmin: false }), false)
})

test('pilulaDaSituacaoDoBem: mapeia cada situação real de patrimonio_bens pra uma cor', () => {
  assert.equal(pilulaDaSituacaoDoBem('em_uso'), 'ok')
  assert.equal(pilulaDaSituacaoDoBem('em_estoque'), 'neutral')
  assert.equal(pilulaDaSituacaoDoBem('em_manutencao'), 'warn')
  assert.equal(pilulaDaSituacaoDoBem('baixado'), 'bad')
})

test('pilulaDaSituacaoDoBem: situação desconhecida ou ausente cai em neutral, nunca quebra', () => {
  assert.equal(pilulaDaSituacaoDoBem('valor-novo-que-ainda-nao-existe'), 'neutral')
  assert.equal(pilulaDaSituacaoDoBem(null), 'neutral')
  assert.equal(pilulaDaSituacaoDoBem(undefined), 'neutral')
})

test('agruparPorPessoa: agrupa uma lista (bens ou veículos) pelo pessoa_id de cada item', () => {
  const bens = [
    { id: 'b1', pessoa_id: 'p1' },
    { id: 'b2', pessoa_id: 'p2' },
    { id: 'b3', pessoa_id: 'p1' },
  ]
  const mapa = agruparPorPessoa(bens)
  assert.deepEqual(mapa.p1.map((b) => b.id), ['b1', 'b3'])
  assert.deepEqual(mapa.p2.map((b) => b.id), ['b2'])
})

test('agruparPorPessoa: item sem pessoa_id não entra em mapa nenhum (bem sem dono não é bem de "ninguém")', () => {
  const bens = [{ id: 'b1', pessoa_id: null }, { id: 'b2', pessoa_id: 'p1' }]
  const mapa = agruparPorPessoa(bens)
  assert.deepEqual(Object.keys(mapa), ['p1'])
})

test('agruparPorPessoa: lista vazia ou nula não quebra, devolve mapa vazio', () => {
  assert.deepEqual(agruparPorPessoa([]), {})
  assert.deepEqual(agruparPorPessoa(null), {})
})

// Fix round 1 / CRITICAL 1: a RLS de patrimonio_bens (pode_ver_bem) é mais
// generosa que temAcessoPatrimonio — ela libera quem não é escopo_por_equipe
// mesmo sem a feature "patrimonio". Medido em produção: 10 dos 20 perfis
// recebem linha de verdade com temAcessoPatrimonio()===false, entre eles
// ti@rbvcompany.com (o caso que o brief mediu). Dado na mão nunca é mentira:
// se a consulta trouxe linha, a linha aparece — a flag de acesso só explica
// o vazio, nunca descarta prova em contrário.
test('decidirEstadoDaSecao: erro sempre vence, mesmo com dado na mão', () => {
  const r = decidirEstadoDaSecao({ lista: [{ id: 'b1' }], erro: { message: 'falhou' }, temAcesso: true })
  assert.equal(r, 'erro')
})

test('decidirEstadoDaSecao: dado na mão vence mesmo sem a flag de acesso — o caso do ti@', () => {
  const r = decidirEstadoDaSecao({ lista: [{ id: 'b1' }], erro: null, temAcesso: false })
  assert.equal(r, 'com-dados')
})

test('decidirEstadoDaSecao: sem dado e sem acesso vira "sem-acesso"', () => {
  const r = decidirEstadoDaSecao({ lista: [], erro: null, temAcesso: false })
  assert.equal(r, 'sem-acesso')
})

test('decidirEstadoDaSecao: sem dado e com acesso vira "vazio" (o caso de verdade)', () => {
  const r = decidirEstadoDaSecao({ lista: [], erro: null, temAcesso: true })
  assert.equal(r, 'vazio')
})

test('decidirEstadoDaSecao: lista nula/ausente não quebra, trata como vazia', () => {
  assert.equal(decidirEstadoDaSecao({ lista: null, erro: null, temAcesso: true }), 'vazio')
  assert.equal(decidirEstadoDaSecao({ erro: null, temAcesso: false }), 'sem-acesso')
})
