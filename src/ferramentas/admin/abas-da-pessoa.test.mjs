import { test } from 'node:test'
import assert from 'node:assert/strict'
import { abasDaPessoa } from './abas-da-pessoa.js'

test('tres abas, nesta ordem', () => {
  const a = abasDaPessoa({ temVinculo: true })
  assert.deepEqual(a.map((x) => x.chave), ['ferramentas', 'avisos', 'cadastro'])
})

test('login sem cadastro ligado ACUSA na aba', () => {
  // Foi essa lacuna que fez o aviso do checklist nao chegar em quem tinha
  // login: a tela achava a pessoa pelo e-mail e o robo exigia o elo.
  const cadastro = abasDaPessoa({ temVinculo: false }).find((x) => x.chave === 'cadastro')
  assert.ok(cadastro.aviso, 'sem vinculo tem que avisar')
  assert.match(cadastro.aviso, /aviso|notifica|celular/i)
})

test('com vinculo nao acusa nada', () => {
  const cadastro = abasDaPessoa({ temVinculo: true }).find((x) => x.chave === 'cadastro')
  assert.equal(cadastro.aviso, null)
})

test('editando as PROPRIAS notificacoes so aparece a aba de avisos', () => {
  // A trava de autopromocao esconde o botao de permissoes na propria linha;
  // sem isto, a tela ofereceria abas que nao se pode usar em si mesmo.
  const a = abasDaPessoa({ soNotificacoes: true, temVinculo: true })
  assert.deepEqual(a.map((x) => x.chave), ['avisos'])
})

test('sem argumento nenhum nao inventa aviso', () => {
  // A tela chama sempre com os dois campos; o default existe pra quem chamar
  // errado nao ver uma faixa vermelha acusando um problema que ninguem mediu.
  const cadastro = abasDaPessoa().find((x) => x.chave === 'cadastro')
  assert.equal(cadastro.aviso, null)
})

test('toda aba tem rotulo e a chave do aviso, mesmo quando nao ha aviso', () => {
  // A tela le `aba.aviso` sem checar se a chave existe: `undefined` passaria
  // no `if`, mas viraria a string "undefined" na faixa no dia em que alguem
  // trocasse o teste de verdade por uma comparacao.
  for (const a of abasDaPessoa({ temVinculo: true })) {
    assert.ok(a.rotulo, `aba ${a.chave} sem rotulo`)
    assert.ok('aviso' in a, `aba ${a.chave} sem a chave aviso`)
  }
})
