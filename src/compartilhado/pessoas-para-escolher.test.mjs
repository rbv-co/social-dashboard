import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  mesclarPessoas, apenasAtivas, cargosConhecidos, dadosDaPessoaRapida, comSelecionada,
} from './pessoas-para-escolher.js'

// A porta estreita devolve nome/cargo/situação; a leitura direta da tabela
// devolve os contatos, e só chega para quem tem Colaboradores e Acessos. A tela
// precisa das duas metades na mesma lista, sem duplicar ninguém.
test('mesclar junta a lista de nomes com a de contatos pelo id', () => {
  const nomes = [
    { id: 'a', nome: 'Ana', status: 'ativo', cargo: 'RH', profile_id: null },
    { id: 'b', nome: 'Bruno', status: 'ativo', cargo: null, profile_id: 'u1' },
  ]
  const contatos = [{ id: 'b', nome: 'Bruno', numero_pessoal: '19999', email_corporativo: 'b@x' }]
  const junto = mesclarPessoas(nomes, contatos)

  assert.equal(junto.length, 2)
  assert.equal(junto.find((p) => p.id === 'b').numero_pessoal, '19999')
  assert.equal(junto.find((p) => p.id === 'b').profile_id, 'u1')
  assert.equal(junto.find((p) => p.id === 'a').numero_pessoal, undefined)
})

test('mesclar aguenta a lista de contatos vazia — é o caso de quem não tem Acessos', () => {
  const nomes = [{ id: 'a', nome: 'Ana', status: 'ativo' }]
  assert.deepEqual(mesclarPessoas(nomes, []), nomes)
  assert.deepEqual(mesclarPessoas(nomes, null), nomes)
})

// Quem só aparece na lista de contatos e não na de nomes não pode sumir: seria
// dado a menos sem ninguém avisar.
test('mesclar não perde quem só existe na lista de contatos', () => {
  const junto = mesclarPessoas([], [{ id: 'z', nome: 'Zeca' }])
  assert.deepEqual(junto.map((p) => p.id), ['z'])
})

test('mesclar devolve em ordem de nome, ignorando maiúsculas', () => {
  const junto = mesclarPessoas(
    [{ id: '1', nome: 'bruno' }, { id: '2', nome: 'Ana' }, { id: '3', nome: 'Carlos' }], [])
  assert.deepEqual(junto.map((p) => p.nome), ['Ana', 'bruno', 'Carlos'])
})

test('só as ativas — desligado não aparece em campo de escolha', () => {
  const lista = [
    { id: 'a', nome: 'Ana', status: 'ativo' },
    { id: 'b', nome: 'Bruno', status: 'desligado' },
    { id: 'c', nome: 'Célia' },
  ]
  assert.deepEqual(apenasAtivas(lista).map((p) => p.id), ['a', 'c'])
})

test('cargos já usados viram sugestão, sem repetir e sem vazio', () => {
  const lista = [
    { id: 'a', cargo: 'Modelista' }, { id: 'b', cargo: 'modelista' },
    { id: 'c', cargo: '  ' }, { id: 'd', cargo: null }, { id: 'e', cargo: 'Costureira' },
  ]
  assert.deepEqual(cargosConhecidos(lista), ['Costureira', 'Modelista'])
})

test('nome vazio não vira cadastro', () => {
  const r = dadosDaPessoaRapida({ nome: '   ' })
  assert.equal(r.ok, false)
  assert.match(r.mensagem, /nome/i)
})

test('os dados vão aparados, e o que está em branco vai como nada', () => {
  const r = dadosDaPessoaRapida({
    nome: '  Maria Souza ', cargo: '  ', marcaId: '', setorId: 'set-1',
  })
  assert.deepEqual(r, {
    ok: true,
    dados: { p_nome: 'Maria Souza', p_cargo: null, p_marca_id: null, p_setor_id: 'set-1' },
  })
})

// A pessoa que já está apontada num registro (carro, bem) não pode sumir do
// campo só porque ela foi desligada — senão a tela passa a dizer "ninguém" pra
// um registro que TEM dono. `comSelecionada` some do ALCANCE de quem escolhe
// (não some do registro que já a aponta), e avisa que ela saiu, no rótulo.
test('comSelecionada: id vazio devolve a lista de ativas como está', () => {
  const visiveis = [{ id: 'a', nome: 'Ana' }]
  assert.deepEqual(comSelecionada(visiveis, visiveis, ''), visiveis)
  assert.deepEqual(comSelecionada(visiveis, visiveis, null), visiveis)
  assert.deepEqual(comSelecionada(visiveis, visiveis, undefined), visiveis)
})

test('comSelecionada: id que já está entre as ativas não duplica', () => {
  const visiveis = [{ id: 'a', nome: 'Ana' }, { id: 'b', nome: 'Bruno' }]
  const todas = visiveis
  const r = comSelecionada(visiveis, todas, 'b')
  assert.deepEqual(r, visiveis)
  assert.equal(r.length, 2)
})

test('comSelecionada: id só em "todas" (quem saiu) entra no fim com o rótulo', () => {
  const visiveis = [{ id: 'a', nome: 'Ana', status: 'ativo' }]
  const todas = [
    { id: 'a', nome: 'Ana', status: 'ativo' },
    { id: 'b', nome: 'Bruno', status: 'desligado' },
  ]
  const r = comSelecionada(visiveis, todas, 'b')
  assert.deepEqual(r.map((p) => p.id), ['a', 'b'])
  // "(saiu da empresa)" serve pra qualquer pessoa: "Bruno (desligada)" estava
  // no feminino em cima de todo mundo.
  assert.equal(r[1].nome, 'Bruno (saiu da empresa)')
  // O resto da ficha da pessoa (status, cargo…) continua vindo junto.
  assert.equal(r[1].status, 'desligado')
})

test('comSelecionada: id que não existe em lugar nenhum não inventa linha', () => {
  const visiveis = [{ id: 'a', nome: 'Ana' }]
  const todas = visiveis
  const r = comSelecionada(visiveis, todas, 'fantasma')
  assert.deepEqual(r, visiveis)
})
