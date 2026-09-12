import { test } from 'node:test'
import assert from 'node:assert/strict'
import { nomeComparavel, parecidos, fraseDoParecido } from './ja-existe-alguem-parecido.js'

// Os 34 nomes REAIS da base, lidos em 27/08/2026. Estão aqui inteiros de
// propósito: a promessa deste módulo é "não incomoda ninguém à toa", e essa
// promessa só se prova contra os nomes que existem de verdade. Nome inventado
// prova o que o autor imaginou; estes provam o que a empresa tem.
const BASE_REAL = [
  'Ana Vieira', 'Barbara Franco', 'Breno', 'Caio Dias', 'Clara Beduschi',
  'Clara Marques', 'Cristian Leonel', 'Dandara Rodrigues', 'Douglas Pereira',
  'Eliana Guerreiro', 'Enzo Rodrigues', 'Erick Martins', 'Fabricio Mateus',
  'Fainer Roberto', 'Fernanda Moretto', 'Gabriel Alves', 'Gabriel Gertrudes',
  'Guilherme Cardoso', 'Humberto Mendonça', 'Ionara Elias', 'Isabella Bonini',
  'Jeremias Vieira', 'Julia Cruz', 'Landa Souza', 'Larissa Sousa',
  'Marcio Franco', 'Marcus Vinicius', 'Mariá Pessoa Mendes', 'Olivia Santos',
  'Paola Graf', 'Raissa Herculano', 'Silvana Godoi', 'Theo Vieira',
  'Thiago Siqueira',
].map((nome, i) => ({ id: 'p-' + i, nome, cargo: null, status: 'ativo' }))

const so = (r) => r.map((x) => x.pessoa.nome)

// ─── O caso que motivou o módulo ────────────────────────────────────────────

test('o caso REAL do Douglas: a segunda ficha teria sido avisada', () => {
  // 19/08 nasceu "Douglas Pereira" pelo + rápido, sem e-mail. Em 21/08 alguém
  // clicou "Criar cadastro" na lista de logins e nasceu a segunda, porque o
  // casamento por e-mail não tinha e-mail para casar. O nome era idêntico.
  const r = parecidos('Douglas Pereira', BASE_REAL)
  assert.equal(r.length, 1)
  assert.equal(r[0].pessoa.nome, 'Douglas Pereira')
  assert.equal(r[0].motivo, 'igual')
})

// ─── A promessa de não incomodar: medida contra a base inteira ──────────────

test('nenhum dos 34 nomes reais acusa OUTRO dos 34', () => {
  // Esta é a prova que sustenta a escolha de rigor. Sete pares dividem uma
  // palavra do nome (três Vieira, duas Clara, dois Gabriel, dois Franco, dois
  // Rodrigues) e nenhum é a mesma pessoa. Se este teste começar a falhar, a
  // regra ficou frouxa e o aviso virou paisagem.
  const falsos = []
  for (const p of BASE_REAL) {
    for (const achado of parecidos(p.nome, BASE_REAL, { ignorarId: p.id })) {
      falsos.push(`"${p.nome}" acusou "${achado.pessoa.nome}" (${achado.motivo})`)
    }
  }
  assert.deepEqual(falsos, [], 'alarme falso na base real:\n' + falsos.join('\n'))
})

test('os pares que dividem sobrenome NAO disparam, um a um', () => {
  // Escritos individualmente além da varredura acima: se alguém afrouxar a
  // regra, quero que a falha diga QUAL par quebrou, não só que algo quebrou.
  const paresQueNaoSaoAMesmaPessoa = [
    ['Theo Vieira', 'Ana Vieira'],
    ['Jeremias Vieira', 'Theo Vieira'],
    ['Clara Marques', 'Clara Beduschi'],
    ['Gabriel Alves', 'Gabriel Gertrudes'],
    ['Marcio Franco', 'Barbara Franco'],
    ['Enzo Rodrigues', 'Dandara Rodrigues'],
    ['Larissa Sousa', 'Landa Souza'],
  ]
  for (const [digitado, naoDeveAcusar] of paresQueNaoSaoAMesmaPessoa) {
    const r = parecidos(digitado, BASE_REAL.filter((p) => p.nome === naoDeveAcusar))
    assert.deepEqual(so(r), [], `"${digitado}" nao pode acusar "${naoDeveAcusar}"`)
  }
})

// ─── Os três jeitos de ser parecido ─────────────────────────────────────────

test('IGUAL: acento, maiuscula e espaco sobrando nao escapam', () => {
  for (const digitado of ['douglas pereira', 'DOUGLAS PEREIRA', 'Douglas  Pereira', '  Douglas Pereira  ', 'Doúglas Pereira']) {
    const r = parecidos(digitado, BASE_REAL)
    assert.equal(r.length, 1, `"${digitado}" deveria achar o Douglas`)
    assert.equal(r[0].motivo, 'igual')
  }
})

test('ORDEM TROCADA: "Pereira, Douglas" e a mesma pessoa', () => {
  const r = parecidos('Pereira, Douglas', BASE_REAL)
  assert.equal(r.length, 1)
  assert.equal(r[0].pessoa.nome, 'Douglas Pereira')
  assert.equal(r[0].motivo, 'ordem-trocada')
})

test('QUASE IGUAL: uma letra trocada, faltando ou sobrando', () => {
  for (const digitado of ['Douglas Pereyra', 'Douglas Pereia', 'Douglas Pereirra']) {
    const r = parecidos(digitado, BASE_REAL)
    assert.equal(r.length, 1, `"${digitado}" deveria achar o Douglas`)
    assert.equal(r[0].motivo, 'quase-igual')
  }
})

test('DUAS letras de diferenca ja NAO e parecido', () => {
  // O limite tem de estar escrito: sem ele, "quase igual" cresce sozinho na
  // próxima vez que alguém quiser pegar mais um caso.
  assert.deepEqual(so(parecidos('Douglas Pereyrra', BASE_REAL)), [])
})

test('nome CURTO nao usa a regra de uma letra', () => {
  // "Breno" tem 5 letras. Com uma letra de folga, "Brena", "Bruno" e "Breno"
  // seriam a mesma pessoa — e aí o aviso apareceria para gente diferente de
  // verdade. Abaixo de 8 letras só vale nome igual.
  assert.deepEqual(so(parecidos('Brena', BASE_REAL)), [])
  assert.deepEqual(so(parecidos('Bruno', BASE_REAL)), [])
  assert.deepEqual(so(parecidos('Breno', BASE_REAL)), ['Breno'], 'igual continua valendo')
})

// ─── Bordas que a tela vai encostar ─────────────────────────────────────────

test('nome vazio ou so espaco nao acusa ninguem', () => {
  for (const vazio of ['', '   ', null, undefined]) {
    assert.deepEqual(so(parecidos(vazio, BASE_REAL)), [])
  }
})

test('lista ausente ou torta nao quebra', () => {
  assert.deepEqual(so(parecidos('Douglas Pereira', null)), [])
  assert.deepEqual(so(parecidos('Douglas Pereira', [null, undefined, {}, { nome: '' }])), [])
})

test('ignorarId tira a propria pessoa: editar nao pode acusar a si mesmo', () => {
  // Sem isto, abrir a ficha do Douglas e salvar diria "já existe o Douglas".
  const eu = BASE_REAL.find((p) => p.nome === 'Douglas Pereira')
  assert.deepEqual(so(parecidos('Douglas Pereira', BASE_REAL, { ignorarId: eu.id })), [])
})

test('quem esta desligado TAMBEM aparece, e diz que esta', () => {
  // Recontratação existe, e criar ficha nova para quem já teve uma perde o
  // histórico. O aviso mostra; quem decide é quem está cadastrando.
  const lista = [{ id: 'x', nome: 'Marcus Vinicius', status: 'desligado' }]
  const r = parecidos('Marcus Vinicius', lista)
  assert.equal(r.length, 1)
  assert.equal(r[0].pessoa.status, 'desligado')
})

test('mais de um parecido: o igual vem antes do quase-igual', () => {
  const lista = [
    { id: 'a', nome: 'Douglas Pereyra' },
    { id: 'b', nome: 'Douglas Pereira' },
  ]
  assert.deepEqual(so(parecidos('Douglas Pereira', lista)), ['Douglas Pereira', 'Douglas Pereyra'])
})

// ─── A normalização, sozinha ────────────────────────────────────────────────

test('nomeComparavel tira acento, caixa, pontuacao e espaco repetido', () => {
  assert.equal(nomeComparavel('  Mariá   Pessoa, Mendes '), 'maria pessoa mendes')
  assert.equal(nomeComparavel('Humberto Mendonça'), 'humberto mendonca')
  assert.equal(nomeComparavel(null), '')
})

// ─── A frase que as três portas dizem ───────────────────────────────────────

test('fraseDoParecido: "ja existe" para nome igual, "parecido" para palpite', () => {
  const igual = parecidos('Douglas Pereira', [{ id: 'a', nome: 'Douglas Pereira', cargo: 'Assistente de Suprimentos' }])
  assert.equal(fraseDoParecido(igual),
    'Já existe alguém com esse nome — seria Douglas Pereira (Assistente de Suprimentos)?')

  const palpite = parecidos('Douglas Pereyra', [{ id: 'a', nome: 'Douglas Pereira' }])
  assert.equal(fraseDoParecido(palpite),
    'Já existe alguém com o nome parecido — seria Douglas Pereira?')
})

test('fraseDoParecido diz quem esta desligado, e nao fala sozinha do nada', () => {
  const r = parecidos('Marcus Vinicius', [{ id: 'a', nome: 'Marcus Vinicius', status: 'desligado' }])
  assert.equal(fraseDoParecido(r), 'Já existe alguém com esse nome — seria Marcus Vinicius (desligado)?')
  // "Aviso que aparece sempre vira paisagem" (PADRAO-DA-CENTRAL, item 9).
  assert.equal(fraseDoParecido([]), '')
  assert.equal(fraseDoParecido(null), '')
})

test('fraseDoParecido junta dois com "ou"', () => {
  const r = parecidos('Douglas Pereira', [
    { id: 'a', nome: 'Douglas Pereira' },
    { id: 'b', nome: 'Douglas Pereyra' },
  ])
  assert.equal(fraseDoParecido(r),
    'Já existe alguém com esse nome — seria Douglas Pereira ou Douglas Pereyra?')
})
