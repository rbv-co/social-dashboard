import { test } from 'node:test'
import assert from 'node:assert/strict'
import { montarArvore } from '../../compartilhado/arvore-de-locais.js'
import { ondeOCarroFica } from './onde-o-carro-fica.js'

/* Os dados são os reais medidos em 12/08/2026: 9 dos 10 carros têm `local_id`
 * apontado, e em 4 deles (BDN3A67, ERO3G55, EDC6H82, OLW4I46) o `local_texto`
 * está vazio — são justamente os que a tela mostrava em branco. */

const EMPRESAS = [{ id: 'e-rb', nome: 'RB Builders' }, { id: 'e-vs', nome: 'Vessel' }]
const LOCAIS = [
  { id: 'l-casa', nome: 'Casa RB', empresa_id: 'e-rb' },
  { id: 'l-fab', nome: 'Fábrica Conchal', empresa_id: 'e-vs' },
]
const COMODOS = [{ id: 'c-gar', nome: 'Garagem', local_id: 'l-casa' }]
const arvore = montarArvore({ empresas: EMPRESAS, locais: LOCAIS, comodos: COMODOS })

test('o local apontado na árvore aparece, mesmo sem texto escrito à mão', () => {
  // O caso do Volvo XC60: local apontado em 11/08, local_texto nulo, tela vazia.
  const r = ondeOCarroFica({ arvore, veiculo: { local_id: 'l-casa', local_texto: null } })
  assert.equal(r.tipo, 'arvore')
  assert.equal(r.curto, 'Casa RB')
  assert.equal(r.completo, 'RB Builders › Casa RB')
})

test('o ambiente entra no curto, e a marca só no completo', () => {
  const r = ondeOCarroFica({
    arvore, veiculo: { local_id: 'l-casa', comodo_id: 'c-gar', local_texto: null },
  })
  assert.equal(r.curto, 'Casa RB › Garagem')
  assert.equal(r.completo, 'RB Builders › Casa RB › Garagem')
})

test('a árvore VENCE o texto antigo — é o defeito que este módulo existe pra consertar', () => {
  // O caso da BMW/Porsche/XC90: apontaram a árvore e a tela continuou mostrando
  // "Casa RB" do texto velho, fazendo parecer que a gravação não pegou.
  const r = ondeOCarroFica({
    arvore, veiculo: { local_id: 'l-fab', local_texto: 'Casa RB' },
  })
  assert.equal(r.tipo, 'arvore')
  assert.equal(r.curto, 'Fábrica Conchal', 'mostrar o texto velho é dizer que não salvou')
})

test('sem árvore apontada, o texto escrito à mão continua valendo', () => {
  const r = ondeOCarroFica({ arvore, veiculo: { local_id: null, local_texto: 'Barracão' } })
  assert.equal(r.tipo, 'texto')
  assert.equal(r.curto, 'Barracão')
  assert.equal(r.completo, 'Barracão')
})

test('local que não está na árvore NÃO vira vazio', () => {
  // Campo que esvazia sozinho é a mentira mais cara: o local pode ter sido
  // apagado, ou quem está olhando pode não enxergá-lo.
  const r = ondeOCarroFica({ arvore, veiculo: { local_id: 'l-que-sumiu', local_texto: 'Conchal' } })
  assert.equal(r.tipo, 'local-sumiu')
  assert.equal(r.curto, 'Conchal', 'a única pista que sobrou tem de aparecer')
})

test('sem local nenhum e sem texto, devolve vazio — e não uma string qualquer', () => {
  const r = ondeOCarroFica({ arvore, veiculo: { local_id: null, local_texto: null } })
  assert.equal(r.tipo, 'vazio')
  assert.equal(r.curto, null)
  assert.equal(r.completo, null)
})

test('árvore ainda não carregada não inventa nada, e não quebra', () => {
  // falhaArvore: quem lê o Patrimônio pode falhar sem derrubar a Frota.
  const r = ondeOCarroFica({ arvore: [], veiculo: { local_id: 'l-casa', local_texto: 'Casa RB' } })
  assert.equal(r.tipo, 'local-sumiu')
  assert.equal(r.curto, 'Casa RB')
})
