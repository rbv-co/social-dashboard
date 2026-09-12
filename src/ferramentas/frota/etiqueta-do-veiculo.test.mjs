import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  normalizarPlaca, validarEtiqueta, etiquetaDoCodigo, COMO_FICA, comoFicaParaDados,
  validarCadastro, fraseDaSincronia, avisoDaEtiqueta,
} from './etiqueta-do-veiculo.js'

test('normalizarPlaca: mesma regra que a tela já usa ao gravar', () => {
  // Sem isto, "RVU-6B06" e "rvu6b06" viram DOIS carros — e placa é UNIQUE, então
  // o segundo cadastro morreria com erro de banco na cara da pessoa.
  assert.equal(normalizarPlaca('rvu-6b06'), 'RVU6B06')
  assert.equal(normalizarPlaca(' FFK 9E60 '), 'FFK9E60')
  assert.equal(normalizarPlaca(''), '')
  assert.equal(normalizarPlaca(null), '')
})

test('validarEtiqueta: só número, e o erro é pra leigo', () => {
  assert.deepEqual(validarEtiqueta('298'), { ok: true, numero: 298, erro: null })
  assert.deepEqual(validarEtiqueta(' 5 '), { ok: true, numero: 5, erro: null })

  const r = validarEtiqueta('RBB-005')
  assert.equal(r.ok, false)
  assert.equal(r.numero, null)
  assert.equal(r.erro, 'O nº de patrimônio é só número. Ex.: 298')
})

test('validarEtiqueta: vazia BARRA por padrão — é obrigatória no cadastro', () => {
  // Decisão do dono em 20/08: sem o número o item não nasce no Patrimônio, e o
  // carro fica órfão como os três KWIDs ficaram.
  const r = validarEtiqueta('')
  assert.equal(r.ok, false)
  assert.equal(r.erro, 'Informe o nº de patrimônio — é ele que cria o item no Patrimônio.')

  assert.deepEqual(validarEtiqueta('', { obrigatoria: false }),
    { ok: true, numero: null, erro: null })
})

test('validarEtiqueta: zero e negativo não são etiqueta', () => {
  assert.equal(validarEtiqueta('0').ok, false)
  assert.equal(validarEtiqueta('-3').ok, false)
})

test('etiquetaDoCodigo: aproveita o número que já está na ficha, e SÓ ele', () => {
  // Medido em 20/08: o campo `codigo_patrimonial` tem duas espécies de conteúdo.
  // Os 3 KWIDs novos têm a etiqueta de verdade; os 9 antigos têm o código
  // interno da Frota, que não é etiqueta nenhuma.
  assert.equal(etiquetaDoCodigo('298'), 298)
  assert.equal(etiquetaDoCodigo(' 300 '), 300)

  // "RBB-004" NÃO pode virar 4: o 4 é um Macbook Air. Sugerir dali ligaria o
  // carro no computador de alguém.
  assert.equal(etiquetaDoCodigo('RBB-004'), null)
  assert.equal(etiquetaDoCodigo(''), null)
  assert.equal(etiquetaDoCodigo(null), null)
  assert.equal(etiquetaDoCodigo('0'), null)
})

test('comoFicaParaDados: as quatro respostas viram as duas colunas que já existem', () => {
  assert.deepEqual(comoFicaParaDados('livre', 'p1'), { situacao: 'ativo', pessoa_id: null })
  assert.deepEqual(comoFicaParaDados('responsavel', 'p1'), { situacao: 'ativo', pessoa_id: 'p1' })
  assert.deepEqual(comoFicaParaDados('parado', 'p1'), { situacao: 'inativo', pessoa_id: null })
  assert.deepEqual(comoFicaParaDados('manutencao', 'p1'), { situacao: 'em_manutencao', pessoa_id: null })
})

test('comoFicaParaDados: "livre" APAGA o responsável que tenha sobrado na tela', () => {
  // Quem escolhe "livre" depois de ter escolhido uma pessoa não pode gravar a
  // pessoa mesmo assim — o carro apareceria como fixo de alguém que não o tem.
  assert.equal(comoFicaParaDados('livre', 'p1').pessoa_id, null)
})

test('comoFicaParaDados: escolha desconhecida NÃO vira "ativo" por descuido', () => {
  // Chutar 'ativo' faria um carro parado nascer disponível pra qualquer um
  // pegar. Nulo obriga quem chama a tratar como "não respondeu".
  assert.equal(comoFicaParaDados('', 'p1'), null)
  assert.equal(comoFicaParaDados('coisa_nova', null), null)
})

test('COMO_FICA: as quatro opções, na ordem em que o dono as falou', () => {
  assert.deepEqual(COMO_FICA.map((o) => o.chave),
    ['livre', 'responsavel', 'parado', 'manutencao'])
  assert.equal(COMO_FICA.filter((o) => o.pedePessoa).length, 1)
})

test('validarCadastro: aceita o cadastro completo', () => {
  assert.deepEqual(validarCadastro({
    nome: 'KWID', placa: 'RVU6B06', etiqueta: '298', comoFica: 'livre',
  }), [])
})

test('validarCadastro: cobra os quatro obrigatórios de uma vez', () => {
  // Uma volta só: a pessoa vê tudo que falta, em vez de descobrir um erro por
  // tentativa de salvar.
  const erros = validarCadastro({ nome: '', placa: '', etiqueta: '', comoFica: '' })
  assert.equal(erros.length, 4)
  assert.ok(erros.some((e) => e.includes('nome')))
  assert.ok(erros.some((e) => e.includes('placa')))
  assert.ok(erros.some((e) => e.includes('nº de patrimônio')))
  assert.ok(erros.some((e) => e.includes('como o carro fica')))
})

test('validarCadastro: "fixo com uma pessoa" sem a pessoa é resposta pela metade', () => {
  const erros = validarCadastro({
    nome: 'KWID', placa: 'RVU6B06', etiqueta: '298', comoFica: 'responsavel', pessoa_id: null,
  })
  assert.deepEqual(erros, ['Escolha a pessoa que fica com o carro.'])
})

test('fraseDaSincronia: cada caso diz o que REALMENTE aconteceu', () => {
  const base = { placa: 'RVU6B06', etiqueta: 298 }
  assert.equal(fraseDaSincronia({ ...base, fez: 'criou_os_dois' }),
    'Criei o veículo RVU6B06 e o item nº 298 no Patrimônio, já ligados.')
  assert.equal(fraseDaSincronia({ ...base, fez: 'criou_bem' }),
    'Criei o item nº 298 no Patrimônio e liguei ao veículo RVU6B06.')
  assert.equal(fraseDaSincronia({ ...base, fez: 'criou_carro' }),
    'Criei o veículo RVU6B06 na Frota e liguei ao item nº 298 do Patrimônio.')
  assert.equal(fraseDaSincronia({ ...base, fez: 'ligou' }),
    'Liguei o veículo RVU6B06 ao item nº 298 do Patrimônio.')
  assert.equal(fraseDaSincronia({ ...base, fez: 'ja_ligados' }),
    'O veículo RVU6B06 e o item nº 298 já estavam ligados.')
})

test('fraseDaSincronia: resposta estranha não vira frase inventada', () => {
  assert.equal(fraseDaSincronia(null), null)
  assert.equal(fraseDaSincronia({ fez: 'coisa_nova', placa: 'X', etiqueta: 1 }), null)
  assert.equal(fraseDaSincronia({ fez: 'ligou' }), null)
})

test('avisoDaEtiqueta: número livre confirma que o item vai nascer', () => {
  assert.deepEqual(avisoDaEtiqueta({ existe: false }, 'RVU6B06'),
    { tom: 'boa', texto: 'Número livre. O item vai ser criado no Patrimônio.' })
})

test('avisoDaEtiqueta: número que não é veículo BARRA, dizendo o que ele é', () => {
  // O caso real: 47 é o Microfone Yealink. Digitar 47 no lugar de 147 ligaria
  // o carro no microfone. A tela precisa dizer o nome, não "número inválido".
  const a = avisoDaEtiqueta({
    existe: true, nome: 'Microfone de Mesa Yealink CP960',
    categoria: 'Computadores e Periféricos', eh_veiculo: false, placa_ligada: null,
  }, 'RUL1A35')
  assert.equal(a.tom, 'ruim')
  assert.ok(a.texto.includes('Microfone de Mesa Yealink CP960'))
  assert.ok(a.texto.includes('Computadores e Periféricos'))
})

test('avisoDaEtiqueta: número de OUTRO veículo barra', () => {
  const a = avisoDaEtiqueta({
    existe: true, nome: 'Fiat Punto 2008', categoria: 'Veículos',
    eh_veiculo: true, placa_ligada: 'EDC6H82',
  }, 'RUL1A35')
  assert.equal(a.tom, 'ruim')
  assert.ok(a.texto.includes('EDC6H82'))
})

test('avisoDaEtiqueta: número DESTE mesmo veículo é confirmação, não erro', () => {
  // Reabrir a ficha de um carro já ligado não pode acusar conflito consigo
  // mesmo. E a comparação passa pela normalização: "edc-6h82" é a mesma placa.
  const a = avisoDaEtiqueta({
    existe: true, nome: 'Fiat Punto 2008', categoria: 'Veículos',
    eh_veiculo: true, placa_ligada: 'EDC6H82',
  }, 'edc-6h82')
  assert.equal(a.tom, 'boa')
})

test('avisoDaEtiqueta: veículo que existe e está livre avisa que vai LIGAR, não criar', () => {
  // O caso do bem 291 "KWID": existe no Patrimônio, é veículo, sem carro.
  const a = avisoDaEtiqueta({
    existe: true, nome: 'KWID', categoria: 'Veículos',
    eh_veiculo: true, placa_ligada: null,
  }, 'RVU6B06')
  assert.equal(a.tom, 'atencao')
  assert.ok(a.texto.includes('já existe'))
})

test('avisoDaEtiqueta: resposta ilegível não vira aviso inventado', () => {
  assert.equal(avisoDaEtiqueta(null, 'X'), null)
  assert.equal(avisoDaEtiqueta({ existe: true }, 'X'), null)
})
