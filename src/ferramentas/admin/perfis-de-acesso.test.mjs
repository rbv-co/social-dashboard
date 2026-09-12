import { test } from 'node:test'
import assert from 'node:assert/strict'
import { acessoEfetivo, excecaoAoSalvar, excecaoDe, impactoDaMudanca } from './perfis-de-acesso.js'

const PERFIL = { social: ['ver', 'exportar'], 'meta.gestor': ['ver', 'editar'] }

test('sem excecao, o acesso e o do perfil', () => {
  assert.deepEqual(acessoEfetivo(PERFIL, {}), PERFIL)
})

test('a excecao SOBREVIVE — e o D9', () => {
  // A Raissa esta no perfil "Anuncios" e ganhou a Frota so pra ela. Mexer no
  // perfil nao pode apagar a Frota dela.
  const efetivo = acessoEfetivo(PERFIL, { frota: ['ver', 'editar'] })
  assert.deepEqual(efetivo.frota, ['ver', 'editar'])
  assert.deepEqual(efetivo.social, ['ver', 'exportar'])
})

test('excecao na MESMA chave do perfil ganha do perfil', () => {
  // Alguem deu explicitamente um nivel diferente naquela ferramenta: e uma
  // decisao sobre aquela pessoa, e o perfil nao pode desfaze-la calado.
  const efetivo = acessoEfetivo(PERFIL, { 'meta.gestor': ['ver'] })
  assert.deepEqual(efetivo['meta.gestor'], ['ver'])
})

test('chave que saiu do perfil some de quem nao a tinha por excecao', () => {
  // O perfil encolheu: quem estava nele perde o que o perfil deixou de dar.
  // E o proposito do perfil vivo (D8) — e por isso D11 mostra quem perde.
  const menor = { social: ['ver', 'exportar'] }
  assert.equal(acessoEfetivo(menor, {})['meta.gestor'], undefined)
})

test('excecao vazia nao inventa chave', () => {
  const efetivo = acessoEfetivo(PERFIL, { frota: [] })
  assert.equal(efetivo.frota, undefined, 'lista vazia e "sem acesso", nao uma chave concedida')
})

test('nao estoura com nulo', () => {
  assert.deepEqual(acessoEfetivo(null, null), {})
  assert.deepEqual(acessoEfetivo(PERFIL, null), PERFIL)
})

// --- descobrir a excecao a partir do que a pessoa ja tem ---

test('o que a pessoa tem alem do perfil vira excecao', () => {
  const atual = { ...PERFIL, frota: ['ver', 'editar'] }
  assert.deepEqual(excecaoDe(PERFIL, atual), { frota: ['ver', 'editar'] })
})

test('nivel diferente na mesma chave tambem e excecao', () => {
  const atual = { ...PERFIL, 'meta.gestor': ['ver'] }
  assert.deepEqual(excecaoDe(PERFIL, atual), { 'meta.gestor': ['ver'] })
})

test('quem e identico ao perfil nao tem excecao nenhuma', () => {
  assert.deepEqual(excecaoDe(PERFIL, { ...PERFIL }), {})
})

test('ordem das acoes nao inventa excecao', () => {
  // ['editar','ver'] e ['ver','editar'] sao o MESMO acesso. Comparar sem
  // ordenar criaria excecao fantasma pra metade das pessoas.
  const atual = { social: ['exportar', 'ver'], 'meta.gestor': ['editar', 'ver'] }
  assert.deepEqual(excecaoDe(PERFIL, atual), {})
})

test('ida e volta: aplicar a excecao de volta devolve o acesso original', () => {
  const atual = { ...PERFIL, frota: ['ver', 'editar'], 'meta.gestor': ['ver'] }
  const exc = excecaoDe(PERFIL, atual)
  assert.deepEqual(acessoEfetivo(PERFIL, exc), atual)
})

// --- D11: quem sera afetado por uma mudanca de perfil ---

const MEMBROS = [
  // `permissions` da Raissa JÁ inclui a Frota: neste sistema `permissions` é
  // sempre perfil+exceção mesclados (é o que `acessoEfetivo` grava e o que a
  // Task 6 lê de volta). Um fixture sem a Frota aqui descreveria um estado que
  // não existe no banco.
  { nome: 'Raissa', permissions: { social: ['ver'], frota: ['ver', 'editar'] }, permissions_excecao: { frota: ['ver', 'editar'] } },
  { nome: 'Gabriel', permissions: { social: ['ver'] }, permissions_excecao: {} },
]

test('diz quem GANHA o que foi acrescentado ao perfil', () => {
  const r = impactoDaMudanca({ social: ['ver'], patrimonio: ['ver', 'editar'] }, MEMBROS)
  assert.equal(r.total, 2)
  assert.deepEqual(r.afetados.map((a) => a.nome).sort(), ['Gabriel', 'Raissa'])
  assert.deepEqual(r.afetados.find((a) => a.nome === 'Raissa').ganha, ['patrimonio'])
})

test('diz quem PERDE o que saiu do perfil', () => {
  const r = impactoDaMudanca({}, MEMBROS)
  assert.deepEqual(r.afetados.find((a) => a.nome === 'Gabriel').perde, ['social'])
})

test('a excecao NAO aparece como perda — ela sobrevive', () => {
  // A Frota da Raissa e excecao. Esvaziar o perfil nao tira a Frota dela, entao
  // ela nao pode aparecer na lista de quem perde a Frota.
  const r = impactoDaMudanca({}, MEMBROS)
  const raissa = r.afetados.find((a) => a.nome === 'Raissa')
  assert.ok(!raissa.perde.includes('frota'))
})

test('quem nao muda nao entra na lista', () => {
  // Mostrar gente que nao muda faz a tela de confirmacao virar ruido, e quem
  // le ruido aprova sem ler.
  const r = impactoDaMudanca({ social: ['ver'] }, MEMBROS)
  assert.equal(r.total, 0)
  assert.deepEqual(r.afetados, [])
})

test('mudar o NIVEL conta como MUDA, nao como ganha', () => {
  // Raissa ja tinha 'social' (via perfil); o perfil novo muda o nivel dela.
  // Isso e mudanca de nivel, nao ganho de chave nova.
  const r = impactoDaMudanca({ social: ['ver', 'exportar'] }, MEMBROS)
  assert.equal(r.total, 2)
  assert.deepEqual(r.afetados[0].ganha, [])
  assert.deepEqual(r.afetados[0].muda, [{ chave: 'social', de: ['ver'], para: ['ver', 'exportar'] }])
})

test('rebaixamento NAO aparece como ganho', () => {
  // Quem perde acoes nao pode ser descrito como quem ganha: e o texto que o
  // dono le antes de aprovar a mudanca.
  const membros = [{ nome: 'Ana', permissions: { social: ['ver', 'exportar'] }, permissions_excecao: {} }]
  const r = impactoDaMudanca({ social: ['ver'] }, membros)
  const ana = r.afetados[0]
  assert.deepEqual(ana.ganha, [])
  assert.deepEqual(ana.perde, [])
  assert.equal(ana.muda[0].chave, 'social')
  assert.deepEqual(ana.muda[0].de, ['ver', 'exportar'])
  assert.deepEqual(ana.muda[0].para, ['ver'])
})

test('subir de nivel tambem e mudanca, nao ganho', () => {
  const membros = [{ nome: 'Ana', permissions: { social: ['ver'] }, permissions_excecao: {} }]
  const r = impactoDaMudanca({ social: ['ver', 'exportar'] }, membros)
  assert.deepEqual(r.afetados[0].ganha, [])
  assert.equal(r.afetados[0].muda[0].para.length, 2)
})

test('duas chaves ganhas ficam em ordem alfabetica', () => {
  // O .sort() de `ganha`/`perde` nao tinha nenhum caso com 2+ chaves — esse
  // caso trava a ordem, em vez de depender da ordem de insercao do objeto.
  const membros = [{ nome: 'Bia', permissions: {}, permissions_excecao: {} }]
  const r = impactoDaMudanca({ social: ['ver'], frota: ['ver'] }, membros)
  assert.deepEqual(r.afetados[0].ganha, ['frota', 'social'])
})

test('duas chaves perdidas ficam em ordem alfabetica', () => {
  const membros = [{ nome: 'Bia', permissions: { social: ['ver'], frota: ['ver'] }, permissions_excecao: {} }]
  const r = impactoDaMudanca({}, membros)
  assert.deepEqual(r.afetados[0].perde, ['frota', 'social'])
})

test('perfil sem membro nenhum da impacto zero', () => {
  assert.deepEqual(impactoDaMudanca({ social: ['ver'] }, []), { afetados: [], total: 0 })
})

test('nao estoura com nulo', () => {
  assert.deepEqual(impactoDaMudanca(null, null), { afetados: [], total: 0 })
})

test('ferramenta NOVA no catalogo nao entra em perfil nenhum (D10)', () => {
  // A regra do projeto e que ferramenta nova nasce sem acesso pra ninguem. Com
  // perfil vivo, o risco e ela entrar num perfil sozinha e alcancar 5 pessoas
  // sem ninguem abrir a ficha de ninguem.
  //
  // A garantia e estrutural: o perfil guarda um MAPA EXPLICITO de chaves, e
  // acessoEfetivo so devolve o que esta nele. Nada le RECURSOS aqui.
  const perfil = { social: ['ver'] }
  const efetivo = acessoEfetivo(perfil, {})
  assert.equal(efetivo['ferramenta.novissima'], undefined)
  assert.deepEqual(Object.keys(efetivo), ['social'])
})

/* ── excecaoAoSalvar — o caminho REAL do D9 (revisao final 12/08/2026) ──
   Este bloco existe porque `excecaoDe` estava verde e MORTA: nenhuma linha da
   aplicacao chamava. Os testes abaixo cobrem a decisao que a tela toma de
   verdade quando alguem clica "Salvar" na ficha de uma pessoa. */

test('D9 CAMINHO REAL: ferramenta dada a mao vira excecao gravavel', () => {
  // A Ana esta no perfil "Vendedora" (so social). Alguem abriu a ficha dela e
  // marcou Frota. Sem isto, regravar o perfil apagaria a Frota da Ana.
  const perfis = [{ id: 'p1', nome: 'Vendedora', permissions: { social: ['ver'] } }]
  const r = excecaoAoSalvar({
    perfilId: 'p1',
    perfis,
    permissions: { social: ['ver'], frota: ['ver', 'editar'] },
  })
  assert.equal(r.gravar, true)
  assert.equal(r.aviso, null)
  assert.deepEqual(r.excecao, { frota: ['ver', 'editar'] })
  // E a prova de que a excecao SOBREVIVE a regravacao do perfil:
  assert.deepEqual(acessoEfetivo({ social: ['ver', 'exportar'] }, r.excecao).frota, ['ver', 'editar'])
})

test('o que veio do perfil NAO vira excecao', () => {
  const perfis = [{ id: 'p1', permissions: { social: ['ver'] } }]
  const r = excecaoAoSalvar({ perfilId: 'p1', perfis, permissions: { social: ['ver'] } })
  assert.equal(r.gravar, true)
  assert.deepEqual(r.excecao, {})
})

test('nivel trocado a mao na MESMA chave do perfil vira excecao', () => {
  const perfis = [{ id: 'p1', permissions: { social: ['ver'] } }]
  const r = excecaoAoSalvar({ perfilId: 'p1', perfis, permissions: { social: ['ver', 'exportar'] } })
  assert.deepEqual(r.excecao, { social: ['ver', 'exportar'] })
})

test('pessoa sem perfil nao grava excecao e nao avisa nada', () => {
  const r = excecaoAoSalvar({ perfilId: null, perfis: [], permissions: { frota: ['ver'] } })
  assert.equal(r.gravar, false)
  assert.equal(r.aviso, null)
})

test('perfil desconhecido NAO grava e AVISA — chute aqui vira acesso perdido depois', () => {
  const r = excecaoAoSalvar({ perfilId: 'p9', perfis: [], permissions: { frota: ['ver'] } })
  assert.equal(r.gravar, false)
  assert.equal(typeof r.aviso, 'string')
  assert.ok(r.aviso.length > 0)
})

test('cache vazio por falha de leitura tambem AVISA, nao fica calado', () => {
  const r = excecaoAoSalvar({ perfilId: 'p1', perfis: null, permissions: {} })
  assert.equal(r.gravar, false)
  assert.ok(r.aviso)
})

test('id numero x id texto sao a mesma pessoa no mesmo perfil', () => {
  const r = excecaoAoSalvar({ perfilId: 7, perfis: [{ id: '7', permissions: {} }], permissions: { frota: ['ver'] } })
  assert.equal(r.gravar, true)
  assert.deepEqual(r.excecao, { frota: ['ver'] })
})

test('nao estoura sem argumento nenhum', () => {
  assert.deepEqual(excecaoAoSalvar(), { gravar: false, aviso: null })
})
