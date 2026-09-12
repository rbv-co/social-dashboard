import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  temAcessoFrota, categoriaVeiculoEntre, bemEhCategoriaVeiculo, veiculoLigadoAoBem,
  veiculosParaLigar, patchVeiculoDoBem,
  exigePlacaNoBem, placaObrigatoria,
} from './ligacao-com-frota.js'

test('categoriaVeiculoEntre: acha "Veículos" com acento e caixa normais', () => {
  const categorias = [{ id: 'c1', nome: 'Computadores' }, { id: 'c2', nome: 'Veículos' }]
  assert.equal(categoriaVeiculoEntre(categorias), 'c2')
})

test('categoriaVeiculoEntre: acha mesmo sem acento e em minúsculas', () => {
  assert.equal(categoriaVeiculoEntre([{ id: 'c1', nome: 'veiculos' }]), 'c1')
})

test('categoriaVeiculoEntre: sem a categoria na lista, devolve null (nunca chuta)', () => {
  assert.equal(categoriaVeiculoEntre([{ id: 'c1', nome: 'Computadores' }]), null)
  assert.equal(categoriaVeiculoEntre([]), null)
  assert.equal(categoriaVeiculoEntre(null), null)
})

test('temAcessoFrota: super-admin sempre tem, mesmo sem a feature na lista', () => {
  assert.equal(temAcessoFrota({ is_superadmin: true, features: [] }), true)
})

test('temAcessoFrota: quem tem a feature "frota" no perfil tem acesso', () => {
  assert.equal(temAcessoFrota({ is_superadmin: false, features: ['patrimonio', 'frota'] }), true)
})

test('temAcessoFrota: sem a feature e sem ser super-admin, não tem', () => {
  assert.equal(temAcessoFrota({ is_superadmin: false, features: ['patrimonio'] }), false)
})

test('temAcessoFrota: estado ausente ou incompleto nunca quebra e nunca libera', () => {
  assert.equal(temAcessoFrota(null), false)
  assert.equal(temAcessoFrota({}), false)
  assert.equal(temAcessoFrota({ is_superadmin: false }), false)
})

test('bemEhCategoriaVeiculo: só quando a categoria bate com a de Veículos', () => {
  const bem = { id: 'b1', categoria_id: 'cat-veiculos' }
  assert.equal(bemEhCategoriaVeiculo(bem, 'cat-veiculos'), true)
  assert.equal(bemEhCategoriaVeiculo(bem, 'cat-outra'), false)
})

test('bemEhCategoriaVeiculo: sem a categoria identificada, nunca é veículo (mesma cautela da Frota)', () => {
  const bem = { id: 'b1', categoria_id: 'cat-veiculos' }
  assert.equal(bemEhCategoriaVeiculo(bem, null), false)
  assert.equal(bemEhCategoriaVeiculo(null, 'cat-veiculos'), false)
})

test('veiculoLigadoAoBem: acha o veículo cujo bem_id aponta pro bem', () => {
  // O caso real: a BMW X1 (bem b1) não está ligada a nada; o Volvo (v2) está
  // ligado ao bem b2.
  const veiculos = [
    { id: 'v1', nome: 'BMW X1', bem_id: null },
    { id: 'v2', nome: 'Volvo XC90', bem_id: 'b2' },
  ]
  assert.equal(veiculoLigadoAoBem(veiculos, 'b2').id, 'v2')
  assert.equal(veiculoLigadoAoBem(veiculos, 'b1'), null)
})

test('veiculoLigadoAoBem: sem bemId, ou listas vazias/nulas, não quebra', () => {
  assert.equal(veiculoLigadoAoBem([{ id: 'v1', bem_id: null }], null), null)
  assert.equal(veiculoLigadoAoBem([], 'b1'), null)
  assert.equal(veiculoLigadoAoBem(null, 'b1'), null)
})

test('veiculosParaLigar: só os veículos que ainda não apontam pra nenhum bem', () => {
  const veiculos = [
    { id: 'v1', nome: 'Punto', bem_id: 'algum-bem' },
    { id: 'v2', nome: 'Fiesta', bem_id: null },
  ]
  assert.deepEqual(veiculosParaLigar(veiculos).map((v) => v.id), ['v2'])
})

test('veiculosParaLigar: lista vazia ou nula não quebra', () => {
  assert.deepEqual(veiculosParaLigar([]), [])
  assert.deepEqual(veiculosParaLigar(null), [])
})

test('patchVeiculoDoBem: sugere nome e marca do bem quando o formulário está vazio', () => {
  const vForm = { nome: '', marca: '' }
  const bem = { nome: 'BMW X1', marca: 'BMW' }
  assert.deepEqual(patchVeiculoDoBem(vForm, bem), { nome: 'BMW X1', marca: 'BMW' })
})

test('patchVeiculoDoBem: não sobrescreve o que a pessoa já digitou', () => {
  const vForm = { nome: 'Nome digitado à mão', marca: '' }
  const bem = { nome: 'BMW X1', marca: 'BMW' }
  assert.deepEqual(patchVeiculoDoBem(vForm, bem), { marca: 'BMW' })
})

test('patchVeiculoDoBem: bem sem marca não gera campo vazio', () => {
  const vForm = { nome: '', marca: '' }
  const bem = { nome: 'BMW X1', marca: null }
  assert.deepEqual(patchVeiculoDoBem(vForm, bem), { nome: 'BMW X1' })
})

test('exigePlacaNoBem: só a categoria Veículos exige placa', () => {
  // Decisão do dono (20/08/2026): item de veículo não salva sem placa. Não é
  // burocracia — é a placa que faz o carro NASCER na Frota. Sem ela o item fica
  // órfão, exatamente como o nº 291 "KWID" ficou naquele mesmo dia.
  assert.equal(exigePlacaNoBem({ categoria_id: 'cat-veic' }, 'cat-veic'), true)
  assert.equal(exigePlacaNoBem({ categoria_id: 'cat-moveis' }, 'cat-veic'), false)
})

test('exigePlacaNoBem: sem a categoria identificada, NÃO exige nada', () => {
  // Mesma cautela de bemEhCategoriaVeiculo: se a busca da categoria falhar
  // (Patrimônio meio carregado, nome da categoria mudou), exigir placa travaria
  // o cadastro de QUALQUER item da empresa — são 362 deles.
  assert.equal(exigePlacaNoBem({ categoria_id: 'cat-veic' }, null), false)
  assert.equal(exigePlacaNoBem(null, 'cat-veic'), false)
})

test('placaObrigatoria: cobra no cadastro novo, avisa sem travar no que já existe', () => {
  const veiculo = { categoria_id: 'cat-veic' }
  // Item NOVO de veículo: sem placa não nasce. É o que impede órfão novo.
  assert.equal(placaObrigatoria(veiculo, 'cat-veic', true), true)
  // Item que JÁ EXISTE: não trava. Decisão do dono em 20/08 — o item nº 291
  // fica sem placa até o carro dele ser levantado, e travar obrigaria a
  // inventar uma placa só pra corrigir um nome.
  assert.equal(placaObrigatoria(veiculo, 'cat-veic', false), false)
})

test('placaObrigatoria: o que não é veículo nunca pede placa', () => {
  assert.equal(placaObrigatoria({ categoria_id: 'cat-moveis' }, 'cat-veic', true), false)
  assert.equal(placaObrigatoria({ categoria_id: 'cat-veic' }, null, true), false)
})
