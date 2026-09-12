import { test } from 'node:test'
import assert from 'node:assert/strict'
import { linhaDeContato, partesDeContato } from './linha-de-contato.js'

const em = (extra) => ({
  nome: 'Héllen Cristiane Cardoso',
  email: 'hellen.cardoso@rbvcompany.com',
  bruto: { created_at: '2026-08-12T10:00:00Z' },
  ...extra,
})

// ── O defeito que este módulo existe para não deixar voltar ─────────────────

test('quem NAO tem cadastro de colaborador mostra o e-mail do mesmo jeito', () => {
  // Era exatamente este o caso das duas pessoas dos times de venda: nome no
  // perfil, nenhum cadastro ligado. O card delas nao mostrava e-mail nenhum.
  const linha = linhaDeContato(em({ temCadastro: false }))
  assert.match(linha, /hellen\.cardoso@rbvcompany\.com/)
})

test('ter ou nao ter cadastro NAO muda a linha de contato', () => {
  // A regra e sobre eco do nome, e nao sobre vinculo de cadastro. Amarrar as
  // duas coisas foi o erro original.
  assert.equal(
    linhaDeContato(em({ temCadastro: true })),
    linhaDeContato(em({ temCadastro: false })),
  )
})

test('quando o nome exibido JA E o e-mail, nao repete', () => {
  // Perfil sem cadastro e sem `name`: `loadAdminUsers` usa o proprio e-mail
  // como nome. Mostrar de novo gastaria uma linha do card dizendo o mesmo.
  const linha = linhaDeContato(em({ nome: 'hellen.cardoso@rbvcompany.com' }))
  assert.doesNotMatch(linha, /@/)
  assert.match(linha, /^desde /)
})

// ── A data ──────────────────────────────────────────────────────────────────

test('mostra desde quando, em portugues', () => {
  assert.match(linhaDeContato(em()), /desde \d{2}\/\d{2}\/\d{4}/)
})

test('data invalida NAO vira "Invalid Date" na cara do dono', () => {
  const linha = linhaDeContato(em({ bruto: { created_at: 'nao-e-data' } }))
  assert.doesNotMatch(linha, /Invalid/)
  assert.equal(linha, 'hellen.cardoso@rbvcompany.com')
})

test('sem data, sobra so o e-mail', () => {
  assert.equal(linhaDeContato(em({ bruto: {} })), 'hellen.cardoso@rbvcompany.com')
})

// ── Os vazios ───────────────────────────────────────────────────────────────

test('sem e-mail e sem data, devolve string vazia (o card nao desenha a linha)', () => {
  assert.equal(linhaDeContato({ nome: 'X', email: '', bruto: {} }), '')
})

test('nao explode com pessoa incompleta', () => {
  assert.equal(linhaDeContato({}), '')
  assert.equal(linhaDeContato(null), '')
})

// ── As partes separadas (o card B, 13/08/2026) ──────────────────────────────
// O card passou a pôr o e-mail embaixo do nome e o "desde" na linha de
// contexto. Sao lugares diferentes, entao a regra precisa entregar separado.

test('as partes vem separadas, e a juncao continua sendo a linha antiga', () => {
  const p = em()
  const { email, desde } = partesDeContato(p)
  assert.equal(email, 'hellen.cardoso@rbvcompany.com')
  assert.match(desde, /^desde \d{2}\/\d{2}\/\d{4}$/)
  assert.equal(linhaDeContato(p), email + ' · ' + desde)
})

test('o eco do nome zera SO o e-mail, e o desde sobrevive', () => {
  const { email, desde } = partesDeContato(em({ nome: 'hellen.cardoso@rbvcompany.com' }))
  assert.equal(email, '')
  assert.match(desde, /^desde /)
})

test('sem nada, as duas partes sao vazias (o card nao desenha os elementos)', () => {
  assert.deepEqual(partesDeContato({ nome: 'X', email: '', bruto: {} }), { email: '', desde: '' })
  assert.deepEqual(partesDeContato(null), { email: '', desde: '' })
})
