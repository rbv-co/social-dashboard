import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

/* O fundo animado (7 ícones, 3 orbes, 3 anéis) só existe onde alguém OLHA a
 * tela. Em tela de trabalho ele atrapalha, e no celular atrapalha mais — foi a
 * bronca do dono em 12/08/2026: "tá atrapalhando a visualização principalmente
 * no celular".
 *
 * Este teste existe porque a regra ANTIGA era uma lista de exceções: o fundo
 * aparecia em 27 das 29 telas e saía só em duas, então cada tela nova nascia
 * com ele por acidente. Invertida a lista, é este teste que impede a inversão
 * de ser desfeita sem alguém decidir. */

const moldura = readFileSync(new URL('./moldura-do-aplicativo.vue', import.meta.url), 'utf8')
const rotas = readFileSync(new URL('./mapa-de-enderecos.js', import.meta.url), 'utf8')

test('a regra é uma lista de QUEM TEM fundo, não de quem não tem', () => {
  // `SEM_FUNDO` de volta significaria que telas novas voltaram a nascer com o
  // fundo ligado — exatamente o que o dono pediu pra acabar.
  assert.match(moldura, /const COM_FUNDO = \[/)
  assert.doesNotMatch(moldura, /const SEM_FUNDO/)
  assert.match(moldura, /mostrarFundo = computed\(\(\) => COM_FUNDO\.includes/)
})

test('só a tela inicial e a Gestão à Vista têm fundo', () => {
  const lista = moldura.match(/const COM_FUNDO = \[([^\]]*)\]/)[1]
  const nomes = [...lista.matchAll(/'([^']+)'/g)].map((m) => m[1]).sort()
  assert.deepEqual(nomes, ['gestao-vista', 'inicio'])
})

test('os dois nomes existem mesmo no mapa de endereços', () => {
  // Nome errado aqui não quebraria nada visível: o fundo simplesmente nunca
  // apareceria, e ninguém saberia por quê.
  const lista = moldura.match(/const COM_FUNDO = \[([^\]]*)\]/)[1]
  for (const [, nome] of lista.matchAll(/'([^']+)'/g)) {
    assert.match(rotas, new RegExp(`name: '${nome}'`), `rota '${nome}' não existe`)
  }
})

test('a Frota, o Patrimônio e o Admin ficam SEM fundo', () => {
  const lista = moldura.match(/const COM_FUNDO = \[([^\]]*)\]/)[1]
  for (const densa of ['frota', 'patrimonio', 'admin', 'acessos']) {
    assert.doesNotMatch(lista, new RegExp(`'${densa}'`), `${densa} é tela de trabalho`)
  }
})
