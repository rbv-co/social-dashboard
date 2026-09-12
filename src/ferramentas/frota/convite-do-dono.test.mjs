import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  pareceEmail, podeConvidar, senhaInicial, recadoDoConvite,
} from './convite-do-dono.js'

/* Medido em 12/08/2026: três donos de carro sem login — Marcus Vinicius (Fiat
 * Punto), Thiago Siqueira (Ford Fiesta Sedan) e Barbara Franco (Honda Fit). Os
 * três já têm cadastro completo; falta só a conta. */

const MARCUS = { id: 'p1', nome: 'Marcus Vinicius', email_corporativo: 'marcus.vinicius@rbvcompany.com' }
const BARBARA = { id: 'p2', nome: 'Barbara Franco', email_corporativo: 'barbara.franco@vesselbrasil.com.br' }

test('dono com cadastro e sem login pode ser convidado', () => {
  const r = podeConvidar({ pessoa: MARCUS, jaTemLogin: false, podeAdministrar: true })
  assert.equal(r.pode, true)
  assert.equal(r.email, 'marcus.vinicius@rbvcompany.com')
})

test('e-mail de OUTRO domínio serve — a Barbara é @vesselbrasil', () => {
  // O domínio dela é diferente do resto da empresa, e isso não pode barrar.
  assert.equal(podeConvidar({ pessoa: BARBARA, jaTemLogin: false, podeAdministrar: true }).pode, true)
})

test('quem já tem login não é convidado de novo, e a tela DIZ por quê', () => {
  const r = podeConvidar({ pessoa: MARCUS, jaTemLogin: true, podeAdministrar: true })
  assert.equal(r.pode, false)
  assert.match(r.motivo, /já tem acesso/i)
  assert.match(r.motivo, /Marcus/, 'com o nome, não uma frase genérica')
})

test('carro sem responsável manda apontar um antes — e explica o porquê', () => {
  const r = podeConvidar({ pessoa: null, jaTemLogin: false, podeAdministrar: true })
  assert.equal(r.pode, false)
  assert.match(r.motivo, /não tem responsável/i)
  assert.match(r.motivo, /a quem dar acesso/i)
})

test('dono sem e-mail no cadastro não vira conta — e a tela diz onde preencher', () => {
  // O e-mail É o login: sem ele não há conta possível.
  const r = podeConvidar({
    pessoa: { id: 'p9', nome: 'Fulano', email_corporativo: '  ' },
    jaTemLogin: false, podeAdministrar: true,
  })
  assert.equal(r.pode, false)
  assert.match(r.motivo, /Colaboradores e Acessos/)
})

test('e-mail malformado é tratado como ausente', () => {
  for (const ruim of ['fulano', 'fulano@', '@rbv.com', 'fulano rbv.com']) {
    const r = podeConvidar({
      pessoa: { nome: 'X', email_corporativo: ruim }, jaTemLogin: false, podeAdministrar: true,
    })
    assert.equal(r.pode, false, `"${ruim}" não devia passar`)
  }
})

test('quem não administra a Frota não cria acesso pra ninguém', () => {
  const r = podeConvidar({ pessoa: MARCUS, jaTemLogin: false, podeAdministrar: false })
  assert.equal(r.pode, false)
  assert.match(r.motivo, /administra/i)
})

test('pareceEmail é frouxo, mas não passa qualquer coisa', () => {
  assert.equal(pareceEmail('a@b.co'), true)
  assert.equal(pareceEmail(''), false)
  assert.equal(pareceEmail(null), false)
  assert.equal(pareceEmail('sem arroba'), false)
})

// ── A senha inicial ─────────────────────────────────────────────────────────

test('a senha não tem caractere que se confunde ao ler ou digitar', () => {
  // Quem recebe vai digitar lendo de um WhatsApp no celular. O e zero, l e 1,
  // I e l — errar três vezes vira chamado pra quem administra.
  const s = senhaInicial(400)
  for (const proibido of ['O', '0', 'l', '1', 'I']) {
    assert.ok(!s.includes(proibido), `a senha não pode ter "${proibido}"`)
  }
})

test('a senha tem o tamanho pedido', () => {
  assert.equal(senhaInicial(12).length, 12)
  assert.equal(senhaInicial(20).length, 20)
})

test('duas senhas seguidas não saem iguais', () => {
  // Senha igual pra duas pessoas significa que uma entra na conta da outra.
  const vistas = new Set(Array.from({ length: 50 }, () => senhaInicial(12)))
  assert.equal(vistas.size, 50)
})

test('o recado traz e-mail, senha e o aviso da troca', () => {
  const t = recadoDoConvite({ nome: 'Marcus', email: 'm@rbv.com', senha: 'AbCdEfGh2345' })
  assert.match(t, /m@rbv\.com/)
  assert.match(t, /AbCdEfGh2345/)
  assert.match(t, /trocar a senha/i)
})

test('o recado NÃO manda pro Reset de Senha — só super-admin alcança aquilo', () => {
  // A revisão pegou: a tela mandava usar o Reset de Senha em Administração, e
  // aquela seção só aparece pra super-admin. Quem administra só a Frota ficaria
  // sem caminho nenhum, seguindo uma instrução que não funciona pra ele.
  const t = recadoDoConvite({ nome: 'Marcus', email: 'm@rbv.com', senha: 'x' })
  assert.doesNotMatch(t, /Reset de Senha/)
})

test('cada motivo tem um CÓDIGO, pra tela não farejar texto', () => {
  // A revisão pegou o template decidindo por `.includes('já tem acesso')`:
  // mudar a frase no módulo passaria a imprimir o aviso errado em todo card.
  const semPessoa = podeConvidar({ pessoa: null, podeAdministrar: true })
  assert.equal(semPessoa.codigo, 'sem-pessoa')
  assert.equal(podeConvidar({ pessoa: MARCUS, jaTemLogin: true, podeAdministrar: true }).codigo, 'ja-tem')
  assert.equal(podeConvidar({ pessoa: MARCUS, podeAdministrar: false }).codigo, 'sem-permissao')
  assert.equal(podeConvidar({
    pessoa: { nome: 'X', email_corporativo: '' }, podeAdministrar: true,
  }).codigo, 'sem-email')
  assert.equal(podeConvidar({ pessoa: MARCUS, jaTemLogin: false, podeAdministrar: true }).codigo, null)
})
