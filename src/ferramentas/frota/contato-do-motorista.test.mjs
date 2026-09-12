import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  nomesBatem, contatoParaCobranca, podeCopiarTelefoneDoCarro,
  podeDigitarTelefone, conferirTelefoneDigitado, porQueOTelefoneNaoServe,
} from './contato-do-motorista.js'

// A base real (acessos_pessoas) tem sobrenome repetido: 3 "Vieira" (Ana,
// Jeremias, Theo) e 2 "Clara" (Beduschi, Marques) — e só UM "Siqueira", UM
// "Marcus", UMA "Bárbara/Barbara", UM "Erick". É essa contagem — quantas
// pessoas da empresa aquele pedaço de nome poderia ser — que decide se o
// contato do carro identifica alguém sem dúvida ou não, não a FORMA do nome
// ("Siqueira" e "Vieira" têm exatamente a mesma forma de match).
const BASE_REAL = [
  { id: 'p-marcus', nome: 'Marcus Vinicius' },
  { id: 'p-thiago', nome: 'Thiago Siqueira' },
  { id: 'p-barbara', nome: 'Barbara Franco' },
  { id: 'p-erick', nome: 'Erick Martins' },
  { id: 'p-ana', nome: 'Ana Vieira' },
  { id: 'p-jeremias', nome: 'Jeremias Vieira' },
  { id: 'p-theo', nome: 'Theo Vieira' },
  { id: 'p-clara-b', nome: 'Clara Beduschi' },
  { id: 'p-clara-m', nome: 'Clara Marques' },
]

test('nomesBatem: casos reais que têm de bater', () => {
  assert.equal(nomesBatem('Marcus', 'Marcus Vinicius'), true)
  assert.equal(nomesBatem('Siqueira', 'Thiago Siqueira'), true)
  assert.equal(nomesBatem('Bárbara', 'Barbara Franco'), true) // com e sem acento
  assert.equal(nomesBatem('Erick', 'Erick Martins'), true)
})

test('nomesBatem: par que não bate', () => {
  assert.equal(nomesBatem('Marcus', 'Bárbara Franco'), false)
})

// Achado da revisão: a base real tem sobrenome repetido — 3 "Vieira" (Ana,
// Jeremias, Theo) e 2 "Clara" (Beduschi, Marques). A versão antiga desta
// função batia qualquer par que compartilhasse UMA palavra, então
// "Ana Vieira" e "Theo Vieira" — duas pessoas diferentes — davam `true`. Isso
// importa porque um `true` aqui vira `origem: 'carro_mesma_pessoa'` em
// contatoParaCobranca(), que APAGA o aviso de "pode não ser quem dirige".
// Com nomes de mais de uma palavra dos dois lados, agora exige-se TODAS as
// palavras batendo, não só o sobrenome em comum.
test('nomesBatem: sobrenome repetido NÃO faz pessoas diferentes baterem (3 Vieira, 2 Clara reais)', () => {
  assert.equal(nomesBatem('Ana Vieira', 'Theo Vieira'), false)
  assert.equal(nomesBatem('Ana Vieira', 'Jeremias Vieira'), false)
  assert.equal(nomesBatem('Jeremias Vieira', 'Theo Vieira'), false)
  assert.equal(nomesBatem('Clara Beduschi', 'Clara Marques'), false)
})

test('nomesBatem: nome completo igual, ou com uma palavra a mais, continua batendo', () => {
  assert.equal(nomesBatem('Ana Vieira', 'Ana Vieira'), true)
  assert.equal(nomesBatem('Ana Vieira', 'Ana Vieira Souza'), true) // nome do meio/sobrenome extra
  assert.equal(nomesBatem('Clara Beduschi', 'Clara Beduschi'), true)
})

test('nomesBatem: nome vazio ou ausente nunca bate, mesmo os dois vazios', () => {
  assert.equal(nomesBatem('', ''), false)
  assert.equal(nomesBatem(null, null), false)
  assert.equal(nomesBatem('Marcus', ''), false)
  assert.equal(nomesBatem('', 'Marcus'), false)
  assert.equal(nomesBatem(undefined, 'Marcus'), false)
})

test('nomesBatem: não confunde por causa de palavra curta em comum ("de", "da")', () => {
  assert.equal(nomesBatem('Ana de Souza', 'Rita da Silva'), false)
})

test('contatoParaCobranca: colaborador com telefone no cadastro é o caso comum', () => {
  const pessoa = { nome: 'Erick Martins', numero_corporativo: '19971613011' }
  const veiculo = { contato_nome: 'Erick', contato_telefone: '19971613011' }
  assert.deepEqual(contatoParaCobranca({ pessoa, veiculo }), {
    telefone: '19971613011', origem: 'colaborador', nomeContato: 'Erick Martins',
  })
})

test('contatoParaCobranca: cadastro vazio, telefone do carro é da mesma pessoa (Marcus)', () => {
  const pessoa = { nome: 'Marcus Vinicius', numero_corporativo: null, numero_pessoal: null }
  const veiculo = { contato_nome: 'Marcus', contato_telefone: '19992575880' }
  assert.deepEqual(contatoParaCobranca({ pessoa, veiculo }), {
    telefone: '19992575880', origem: 'carro_mesma_pessoa', nomeContato: 'Marcus',
  })
})

test('contatoParaCobranca: cadastro vazio, telefone do carro é do Thiago Siqueira', () => {
  const pessoa = { nome: 'Thiago Siqueira', numero_corporativo: null, numero_pessoal: null }
  const veiculo = { contato_nome: 'Siqueira', contato_telefone: '19982180386' }
  assert.deepEqual(contatoParaCobranca({ pessoa, veiculo }), {
    telefone: '19982180386', origem: 'carro_mesma_pessoa', nomeContato: 'Siqueira',
  })
})

test('contatoParaCobranca: carro de rodízio — contato é outra pessoa (Bárbara no Honda Fit)', () => {
  // Não há dono fixo (rodízio): a tela não sabe QUEM cobrar, mas se soubesse
  // (ex.: quem pegou o carro hoje) o contato do carro não seria essa pessoa.
  const pessoa = { nome: 'Qualquer Motorista', numero_corporativo: null, numero_pessoal: null }
  const veiculo = { contato_nome: 'Bárbara', contato_telefone: '19998086930' }
  assert.deepEqual(contatoParaCobranca({ pessoa, veiculo }), {
    telefone: '19998086930', origem: 'carro_outra_pessoa', nomeContato: 'Bárbara',
  })
})

test('contatoParaCobranca: sem pessoa (dono saiu do cadastro), carro com contato vira "outra pessoa"', () => {
  const veiculo = { contato_nome: 'Bárbara', contato_telefone: '19998086930' }
  assert.deepEqual(contatoParaCobranca({ pessoa: null, veiculo }), {
    telefone: '19998086930', origem: 'carro_outra_pessoa', nomeContato: 'Bárbara',
  })
})

test('contatoParaCobranca: contato do carro é o nome completo de OUTRO Vieira — mostra o aviso, não apaga', () => {
  // O caso que a revisão pegou: se a ficha do carro guardar o nome completo
  // de uma pessoa ("Ana Vieira") e o motorista registrado for outra pessoa
  // com o mesmo sobrenome ("Theo Vieira"), o sistema NUNCA pode tratar como
  // se fosse a mesma pessoa — errar aqui pro lado do aviso é o seguro.
  const pessoa = { nome: 'Theo Vieira', numero_corporativo: null, numero_pessoal: null }
  const veiculo = { contato_nome: 'Ana Vieira', contato_telefone: '19999998877' }
  assert.deepEqual(contatoParaCobranca({ pessoa, veiculo }), {
    telefone: '19999998877', origem: 'carro_outra_pessoa', nomeContato: 'Ana Vieira',
  })
})

// ── Com a base inteira (`pessoas`): ambiguidade é propriedade da BASE ──────
// Achado da 2ª rodada de revisão: "Siqueira" e "Vieira" têm a MESMA forma
// (uma palavra, sobrenome), mas só um bate a UMA pessoa — porque só existe
// um Siqueira na empresa e existem três Vieira. Sem a lista, a função não
// tinha como saber a diferença; com ela, sabe.

test('contatoParaCobranca + pessoas: "Vieira" bate com 3 pessoas da base — ambíguo, mostra o aviso', () => {
  const pessoa = BASE_REAL.find((p) => p.id === 'p-ana') // mesmo que o dono SEJA uma das 3, o nome sozinho não prova qual
  const veiculo = { contato_nome: 'Vieira', contato_telefone: '19999990001' }
  assert.deepEqual(contatoParaCobranca({ pessoa, veiculo, pessoas: BASE_REAL }), {
    telefone: '19999990001', origem: 'carro_outra_pessoa', nomeContato: 'Vieira',
  })
})

test('contatoParaCobranca + pessoas: "Clara" bate com as 2 Clara da base — ambíguo', () => {
  const pessoa = BASE_REAL.find((p) => p.id === 'p-clara-b')
  const veiculo = { contato_nome: 'Clara', contato_telefone: '19999990002' }
  assert.deepEqual(contatoParaCobranca({ pessoa, veiculo, pessoas: BASE_REAL }), {
    telefone: '19999990002', origem: 'carro_outra_pessoa', nomeContato: 'Clara',
  })
})

test('contatoParaCobranca + pessoas: "Siqueira" bate com UMA só pessoa da base — é a mesma pessoa', () => {
  const pessoa = BASE_REAL.find((p) => p.id === 'p-thiago')
  const veiculo = { contato_nome: 'Siqueira', contato_telefone: '19982180386' }
  assert.deepEqual(contatoParaCobranca({ pessoa, veiculo, pessoas: BASE_REAL }), {
    telefone: '19982180386', origem: 'carro_mesma_pessoa', nomeContato: 'Siqueira',
  })
})

test('contatoParaCobranca + pessoas: Marcus, Bárbara e Erick continuam batendo (só 1 cada na base)', () => {
  const casos = [
    ['p-marcus', 'Marcus', '19992575880'],
    ['p-barbara', 'Bárbara', '19998086930'], // com acento no contato do carro
    ['p-erick', 'Erick', '19971613011'],
  ]
  for (const [idPessoa, nomeContato, telefone] of casos) {
    const pessoa = BASE_REAL.find((p) => p.id === idPessoa)
    const veiculo = { contato_nome: nomeContato, contato_telefone: telefone }
    assert.equal(
      contatoParaCobranca({ pessoa, veiculo, pessoas: BASE_REAL }).origem,
      'carro_mesma_pessoa',
      `${nomeContato} deveria bater com ${pessoa.nome}`,
    )
  }
})

test('contatoParaCobranca + pessoas: contato que não bate com NINGUÉM da base — é outra pessoa, não ambíguo nem o dono', () => {
  // O caso normal de um contato externo: um mecânico, uma locadora, um
  // terceiro. Não pode virar "ambíguo" (não bateu com ninguém pra confundir)
  // nem "mesma pessoa" (não bateu com o dono) — é simplesmente outra pessoa.
  const pessoa = BASE_REAL.find((p) => p.id === 'p-marcus')
  const veiculo = { contato_nome: 'Roberto Mecânico', contato_telefone: '19933334444' }
  assert.deepEqual(contatoParaCobranca({ pessoa, veiculo, pessoas: BASE_REAL }), {
    telefone: '19933334444', origem: 'carro_outra_pessoa', nomeContato: 'Roberto Mecânico',
  })
})

test('contatoParaCobranca: sem passar `pessoas`, mantém o comportamento antigo (fallback)', () => {
  // Decisão registrada: sem a lista, a função não tem como saber que
  // "Vieira" é ambíguo — continua comparando só os dois nomes, do jeito que
  // já funcionava antes desta rodada. É o que permite a tela ainda não
  // atualizada continuar funcionando sem quebrar.
  const pessoa = { nome: 'Ana Vieira', numero_corporativo: null, numero_pessoal: null }
  const veiculo = { contato_nome: 'Vieira', contato_telefone: '19999990001' }
  assert.equal(contatoParaCobranca({ pessoa, veiculo }).origem, 'carro_mesma_pessoa')
})

test('podeCopiarTelefoneDoCarro + pessoas: não oferece copiar quando o nome é ambíguo na base ("Vieira")', () => {
  const pessoa = BASE_REAL.find((p) => p.id === 'p-theo')
  const veiculo = { contato_nome: 'Vieira', contato_telefone: '19999990001' }
  assert.equal(podeCopiarTelefoneDoCarro({ pessoa, veiculo, pessoas: BASE_REAL }), false)
})

test('podeCopiarTelefoneDoCarro + pessoas: oferece copiar quando o nome bate com UMA só pessoa ("Siqueira")', () => {
  const pessoa = BASE_REAL.find((p) => p.id === 'p-thiago')
  const veiculo = { contato_nome: 'Siqueira', contato_telefone: '19982180386' }
  assert.equal(podeCopiarTelefoneDoCarro({ pessoa, veiculo, pessoas: BASE_REAL }), true)
})

test('contatoParaCobranca: nem cadastro nem carro têm telefone', () => {
  const pessoa = { nome: 'Barbara Franco', numero_corporativo: null, numero_pessoal: null }
  const veiculo = { contato_nome: null, contato_telefone: null }
  assert.deepEqual(contatoParaCobranca({ pessoa, veiculo }), {
    telefone: null, origem: 'nenhum', nomeContato: null,
  })
})

test('contatoParaCobranca: veículo sem os campos de contato não quebra', () => {
  const pessoa = { nome: 'Barbara Franco', numero_corporativo: null, numero_pessoal: null }
  assert.deepEqual(contatoParaCobranca({ pessoa, veiculo: {} }), {
    telefone: null, origem: 'nenhum', nomeContato: null,
  })
})

test('podeCopiarTelefoneDoCarro: sim quando o nome bate e o colaborador está sem telefone', () => {
  const pessoa = { nome: 'Marcus Vinicius', numero_corporativo: null, numero_pessoal: null }
  const veiculo = { contato_nome: 'Marcus', contato_telefone: '19992575880' }
  assert.equal(podeCopiarTelefoneDoCarro({ pessoa, veiculo }), true)
})

test('podeCopiarTelefoneDoCarro: não quando o contato é de outra pessoa (Honda Fit/Bárbara)', () => {
  const pessoa = { nome: 'Qualquer Motorista', numero_corporativo: null, numero_pessoal: null }
  const veiculo = { contato_nome: 'Bárbara', contato_telefone: '19998086930' }
  assert.equal(podeCopiarTelefoneDoCarro({ pessoa, veiculo }), false)
})

test('podeCopiarTelefoneDoCarro: não quando o colaborador já tem telefone (não sobrescreve)', () => {
  const pessoa = { nome: 'Marcus Vinicius', numero_corporativo: '19999999999', numero_pessoal: null }
  const veiculo = { contato_nome: 'Marcus', contato_telefone: '19992575880' }
  assert.equal(podeCopiarTelefoneDoCarro({ pessoa, veiculo }), false)
})

test('podeCopiarTelefoneDoCarro: não quando não há pessoa (dono saiu do cadastro)', () => {
  const veiculo = { contato_nome: 'Marcus', contato_telefone: '19992575880' }
  assert.equal(podeCopiarTelefoneDoCarro({ pessoa: null, veiculo }), false)
})

test('podeCopiarTelefoneDoCarro: não quando o carro não tem telefone', () => {
  const pessoa = { nome: 'Marcus Vinicius', numero_corporativo: null, numero_pessoal: null }
  assert.equal(podeCopiarTelefoneDoCarro({ pessoa, veiculo: { contato_nome: 'Marcus', contato_telefone: null } }), false)
})

// ── D5: DIGITAR O TELEFONE ALI MESMO ───────────────────────────────────────
//
// Pedido do dono (19/08/2026): "caso não tenha telefone cadastrado, permitir
// que eu coloque ali no campo e já salve no cadastro da pessoa da central
// toda".
//
// O QUE JÁ EXISTIA só sabia COPIAR um telefone que estivesse na ficha do carro.
// Medido no banco em 19/08, isso não cobre quem precisa: Breno (BMW X1 e VOLVO
// XC90), Humberto Mendonça (XC60) e Raissa Herculano (CAYENNE) não têm telefone
// em lugar NENHUM — não há o que copiar, e o botão nunca aparecia. Para esses
// quatro carros não existe hoje jeito nenhum de cobrar o checklist.

const semTelefone = { id: 'p-humberto', nome: 'Humberto Mendonça' }
const comTelefone = { id: 'p-erick', nome: 'Erick Martins', numero_corporativo: '19971613011' }

test('D5 · cadastro sem telefone e carro sem telefone: dá pra digitar', () => {
  assert.equal(podeDigitarTelefone({ pessoa: semTelefone, veiculo: {}, pessoas: BASE_REAL }), true)
})

test('D5 · cadastro que JÁ tem telefone não oferece o campo', () => {
  assert.equal(podeDigitarTelefone({ pessoa: comTelefone, veiculo: {}, pessoas: BASE_REAL }), false)
})

test('D5 · quando dá pra COPIAR do carro, não oferece digitar — uma ação por vez', () => {
  // O contato do carro é seguramente a própria pessoa: copiar é um toque só, e
  // dois controles pra mesma coisa fazem a pessoa parar pra escolher.
  const veiculo = { contato_nome: 'Marcus', contato_telefone: '19992575880' }
  const marcus = BASE_REAL.find((p) => p.nome === 'Marcus Vinicius')
  assert.equal(podeCopiarTelefoneDoCarro({ pessoa: marcus, veiculo, pessoas: BASE_REAL }), true)
  assert.equal(podeDigitarTelefone({ pessoa: marcus, veiculo, pessoas: BASE_REAL }), false)
})

test('D5 · O CASO DO FIAT DOBLO: contato do carro é de OUTRA pessoa, então digitar é o caminho', () => {
  // Medido: o DOBLO é do Jeremias Vieira, mas o contato da ficha é "Siqueira",
  // com o telefone do Thiago. Copiar está (com razão) proibido. Sem o campo de
  // digitar, o Jeremias ficaria sem telefone pra sempre.
  const veiculo = { contato_nome: 'Siqueira', contato_telefone: '19982180386' }
  const jeremias = BASE_REAL.find((p) => p.nome === 'Jeremias Vieira')
  assert.equal(podeCopiarTelefoneDoCarro({ pessoa: jeremias, veiculo, pessoas: BASE_REAL }), false)
  assert.equal(podeDigitarTelefone({ pessoa: jeremias, veiculo, pessoas: BASE_REAL }), true)
})

test('D5 · gente de fora não tem cadastro para receber telefone', () => {
  assert.equal(podeDigitarTelefone({ pessoa: null, veiculo: {}, pessoas: BASE_REAL }), false)
  assert.equal(podeDigitarTelefone({ pessoa: { nome: 'Felipe modelista' }, veiculo: {}, pessoas: BASE_REAL }), false)
})

// ── O que se aceita digitar ────────────────────────────────────────────────

test('D5 · celular com DDD entra, escrito do jeito que a pessoa escreve', () => {
  for (const escrito of ['19999071702', '(19) 99907-1702', '19 99907 1702', '19-99907-1702']) {
    const r = conferirTelefoneDigitado(escrito)
    assert.equal(r.ok, true, `recusou "${escrito}"`)
    assert.equal(r.numero, '19999071702', `guardou errado "${escrito}"`)
  }
})

test('D5 · fixo de 10 dígitos também serve', () => {
  assert.deepEqual(conferirTelefoneDigitado('1935220000'), { ok: true, numero: '1935220000' })
})

test('D5 · o +55 da frente é tirado, não contado como número', () => {
  assert.equal(conferirTelefoneDigitado('+55 19 99907-1702').numero, '19999071702')
})

test('D5 · campo vazio não vira telefone vazio no cadastro', () => {
  for (const nada of ['', '   ', null, undefined]) {
    assert.equal(conferirTelefoneDigitado(nada).ok, false)
    assert.equal(conferirTelefoneDigitado(nada).motivo, 'vazio')
  }
})

test('D5 · número curto demais é recusado ANTES de gravar', () => {
  const r = conferirTelefoneDigitado('999071702')
  assert.equal(r.ok, false)
  assert.equal(r.motivo, 'curto')
})

test('D5 · número comprido demais é recusado', () => {
  assert.equal(conferirTelefoneDigitado('199990717021').ok, false)
})

test('D5 · DDD que não existe é recusado — 01 não é DDD de lugar nenhum', () => {
  const r = conferirTelefoneDigitado('0199071702')
  assert.equal(r.ok, false)
  assert.equal(r.motivo, 'ddd')
})

test('D5 · cada recusa tem frase de gente, nunca o código', () => {
  for (const m of ['vazio', 'curto', 'longo', 'ddd']) {
    const frase = porQueOTelefoneNaoServe(m)
    assert.ok(frase.length > 15, `o motivo ${m} ficou sem frase`)
    assert.doesNotMatch(frase, /^[a-z]+$/, `a frase de ${m} está devolvendo o código`)
  }
})
