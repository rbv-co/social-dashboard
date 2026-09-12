import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  diaDaSemana, ehDiaDoMensal, diasEntre,
  semanalAtrasado, mensalAtrasado, cadenciasDoDia,
  itensDaFicha, hodometroAceito, problemasDaFicha,
  quemFaltaHoje, resumoDaCobranca, precisaDeChecklist,
  problemasDoItemDeChecklist,
  telefoneDaCobranca, problemasAbertosHoje, veiculosParaConferir,
  resultadoDoChecklist, porQueDoResultado,
  oQuePedirNaRetirada, porQuePedirOAceite, oQueFaltaNaRetirada, checklistDeHoje,
} from './checklist.js'

/* ── O que pedir a quem está pegando o carro ────────────────────────────────
   O caso que gerou isto é real e está no banco: 07/08/2026, BMW X1 — Erick
   Martins assinou o checklist às 7h30, Breno pegou o carro às 17h49, e como o
   carro "já tinha checklist hoje" a tela não pediu nada a ele. Das 5 retiradas
   reais da Frota, NENHUMA tinha a assinatura de quem pegou o carro. */

const FICHA_ASSINADA = {
  id: 'f1', veiculo_id: 'v1', feita_em: '2026-08-07',
  pessoa_id: 'erick', pessoa_nome: 'Erick Martins', assinada_em: '2026-08-07T10:30:00Z',
}
const pedido = (extra) => oQuePedirNaRetirada({
  veiculoId: 'v1', fichas: [FICHA_ASSINADA], hoje: '2026-08-07', ...extra,
})

test('ninguém conferiu hoje: pede o checklist inteiro, como sempre foi', () => {
  const r = oQuePedirNaRetirada({ veiculoId: 'v1', fichas: [], hoje: '2026-08-07', pessoaId: 'breno' })
  assert.equal(r.pedir, 'checklist')
  assert.equal(r.porque, 'sem-ficha')
})

test('O CASO DE 07/08: conferiu Erick, pega Breno — pede o aceite dele', () => {
  const r = pedido({ pessoaId: 'breno', pessoaNome: 'Breno' })
  assert.equal(r.pedir, 'aceite')
  assert.equal(r.porque, 'assinou-outra')
  assert.equal(r.quemConferiu, 'Erick Martins')
})

test('quem já conferiu e assinou hoje não é perguntado de novo', () => {
  // Ninguém confere o mesmo carro duas vezes no mesmo dia — era esta a parte
  // certa da regra antiga, e ela continua valendo.
  assert.equal(pedido({ pessoaId: 'erick' }).pedir, 'nada')
  assert.equal(pedido({ pessoaId: null, pessoaNome: 'erick martins' }).pedir, 'nada')
})

test('ficha conferida e NÃO assinada: o aceite é o que produz a prova que falta', () => {
  const r = oQuePedirNaRetirada({
    veiculoId: 'v1', fichas: [{ ...FICHA_ASSINADA, assinada_em: null }],
    hoje: '2026-08-07', pessoaId: 'breno',
  })
  assert.equal(r.pedir, 'aceite')
  assert.equal(r.porque, 'ficha-sem-assinatura')
})

test('dois nomes vazios NÃO são a mesma pessoa', () => {
  // Se fossem, quem não tem cadastro sairia sem assinar nada — que é
  // justamente o caso que esta função existe pra cobrir.
  const r = oQuePedirNaRetirada({
    veiculoId: 'v1', fichas: [{ ...FICHA_ASSINADA, pessoa_id: null, pessoa_nome: '' }],
    hoje: '2026-08-07', pessoaId: null, pessoaNome: '   ',
  })
  assert.equal(r.pedir, 'aceite')
})

test('a ficha de OUTRO carro, ou de OUTRO dia, não dispensa ninguém', () => {
  assert.equal(oQuePedirNaRetirada({
    veiculoId: 'v2', fichas: [FICHA_ASSINADA], hoje: '2026-08-07', pessoaId: 'erick',
  }).pedir, 'checklist')
  assert.equal(oQuePedirNaRetirada({
    veiculoId: 'v1', fichas: [FICHA_ASSINADA], hoje: '2026-08-08', pessoaId: 'erick',
  }).pedir, 'checklist')
})

test('o aceite sempre chega com a frase que explica por que ele está sendo pedido', () => {
  assert.match(porQuePedirOAceite('assinou-outra', 'Erick Martins'), /Erick Martins/)
  assert.match(porQuePedirOAceite('assinou-outra', 'Erick Martins'), /não precisa conferir de novo/i)
  assert.match(porQuePedirOAceite('ficha-sem-assinatura', null), /sem assinatura/i)
})

test('a regra velha continua intacta para quem só quer saber do carro', () => {
  // `precisaDeChecklist` segue existindo e segue olhando carro+dia: ela responde
  // "este carro foi conferido hoje?", que é outra pergunta e continua certa.
  assert.equal(precisaDeChecklist({ veiculoId: 'v1', fichas: [FICHA_ASSINADA], hoje: '2026-08-07' }), false)
  assert.equal(precisaDeChecklist({ veiculoId: 'v1', fichas: [], hoje: '2026-08-07' }), true)
})

// Padrão do banco: semanal na sexta, mensal na 1ª quarta-feira.
const CONFIG = { dia_semanal: 5, semana_mensal: 1, dia_mensal: 3 }

test('o dia da semana sai da data em UTC, não do fuso da máquina', () => {
  // 2026-08-05 é uma quarta-feira. Contar no fuso local faria a data virar e a
  // conferência de sexta cair no sábado, quando ninguém trabalha.
  assert.equal(diaDaSemana('2026-08-05'), 3)
  assert.equal(diaDaSemana('2026-08-07'), 5)  // sexta
  assert.equal(diaDaSemana('2026-08-08'), 6)  // sábado
  assert.equal(diaDaSemana('2026-08-09'), 7)  // domingo
})

test('a 1ª quarta-feira do mês é reconhecida, e a 2ª não', () => {
  assert.equal(ehDiaDoMensal('2026-08-05', CONFIG), true)   // 1ª quarta de agosto
  assert.equal(ehDiaDoMensal('2026-08-12', CONFIG), false)  // 2ª quarta
  assert.equal(ehDiaDoMensal('2026-08-07', CONFIG), false)  // sexta, não é quarta
})

test('dias entre duas datas', () => {
  assert.equal(diasEntre('2026-08-01', '2026-08-08'), 7)
  assert.equal(diasEntre('2026-08-08', '2026-08-08'), 0)
})

/* ── O que o dia pede ────────────────────────────────────────────────────── */

test('dia de semana comum pede só o diário', () => {
  // Segunda-feira. O semanal NÃO se empilha aqui — decisão do dono: nenhum dia
  // pesado.
  const c = cadenciasDoDia({ hoje: '2026-08-10', config: CONFIG,
    ultimaSemanal: '2026-08-07', ultimaMensal: '2026-08-05' })
  assert.deepEqual(c, ['diario'])
})

test('sexta pede o diário e o semanal', () => {
  const c = cadenciasDoDia({ hoje: '2026-08-07', config: CONFIG,
    ultimaSemanal: '2026-07-31', ultimaMensal: '2026-08-05' })
  assert.deepEqual(c, ['diario', 'semanal'])
})

test('a 1ª quarta pede o diário e o mensal, e nunca o semanal junto', () => {
  // Primeira quarta nunca é sexta, então os dois pesados jamais colidem.
  const c = cadenciasDoDia({ hoje: '2026-08-05', config: CONFIG,
    ultimaSemanal: '2026-07-31', ultimaMensal: '2026-07-01' })
  assert.deepEqual(c, ['diario', 'mensal'])
})

test('sábado e domingo não pedem nada', () => {
  assert.deepEqual(cadenciasDoDia({ hoje: '2026-08-08', config: CONFIG,
    ultimaSemanal: null, ultimaMensal: null }), [])
  assert.deepEqual(cadenciasDoDia({ hoje: '2026-08-09', config: CONFIG,
    ultimaSemanal: null, ultimaMensal: null }), [])
})

/* ── O atrasado ──────────────────────────────────────────────────────────── */

test('semanal não feito há mais de 7 dias está atrasado e entra no próximo dia útil', () => {
  const c = cadenciasDoDia({ hoje: '2026-08-10', config: CONFIG,
    ultimaSemanal: '2026-07-29', ultimaMensal: '2026-08-05' })
  assert.deepEqual(c, ['diario', 'semanal'])
})

test('atrasado NÃO acumula: uma semana pulada vira uma conferência, não duas', () => {
  // Vinte dias sem semanal continua devolvendo UM 'semanal'.
  const c = cadenciasDoDia({ hoje: '2026-08-10', config: CONFIG,
    ultimaSemanal: '2026-07-21', ultimaMensal: '2026-08-05' })
  assert.equal(c.filter((x) => x === 'semanal').length, 1)
})

test('nunca feito NÃO conta como atrasado — espera o dia próprio', () => {
  // Se contasse, o primeiro dia da funcionalidade jogaria os 21 itens na cara
  // de todo mundo, que é exatamente o dia pesado que o dono não quis.
  const c = cadenciasDoDia({ hoje: '2026-08-10', config: CONFIG,
    ultimaSemanal: null, ultimaMensal: null })
  assert.deepEqual(c, ['diario'])
})

test('semanalAtrasado e mensalAtrasado isolados', () => {
  assert.equal(semanalAtrasado('2026-08-10', null), false)
  assert.equal(semanalAtrasado('2026-08-10', '2026-08-07'), false)
  assert.equal(semanalAtrasado('2026-08-10', '2026-08-01'), true)
  assert.equal(mensalAtrasado('2026-08-10', null), false)
  assert.equal(mensalAtrasado('2026-08-10', '2026-07-20'), false)
  assert.equal(mensalAtrasado('2026-09-20', '2026-08-05'), true)
})

/* ── Os itens que entram na ficha ────────────────────────────────────────── */

const ITENS = [
  { id: 'd1', item: 'Painel — luzes de advertência', cadencia: 'diario',  ordem: 1, ativo: true },
  { id: 'd2', item: 'Vazamentos sob o veículo',      cadencia: 'diario',  ordem: 2, ativo: true },
  { id: 'd9', item: 'Item desligado',                cadencia: 'diario',  ordem: 3, ativo: false },
  { id: 's1', item: 'Faróis',                        cadencia: 'semanal', ordem: 10, ativo: true },
  { id: 'm1', item: 'Nível do óleo do motor',        cadencia: 'mensal',  ordem: 30, ativo: true },
]

test('a ficha traz só os itens das cadências do dia, na ordem', () => {
  const f = itensDaFicha(ITENS, ['diario', 'semanal'])
  assert.deepEqual(f.map((i) => i.id), ['d1', 'd2', 's1'])
})

test('item desligado pelo gestor não entra na ficha', () => {
  assert.equal(itensDaFicha(ITENS, ['diario']).some((i) => i.id === 'd9'), false)
})

test('fim de semana: nenhuma cadência, nenhum item', () => {
  assert.deepEqual(itensDaFicha(ITENS, []), [])
})

/* ── O hodômetro ─────────────────────────────────────────────────────────── */

test('hodômetro em branco ou zero não passa', () => {
  // precisaJustificar tem de ser false aqui: não é um número estranho que
  // pode ter explicação, é a ausência do dado — só se corrige digitando.
  const branco = hodometroAceito(null, 100000)
  assert.equal(branco.ok, false)
  assert.equal(branco.precisaJustificar, false)
  const zero = hodometroAceito(0, 100000)
  assert.equal(zero.ok, false)
  assert.equal(zero.precisaJustificar, false)
})

test('primeiro hodômetro do carro passa: não há com o que comparar', () => {
  const r = hodometroAceito(148320, null)
  assert.equal(r.ok, true)
  assert.equal(r.precisaJustificar, false)
})

test('hodômetro que anda para trás não passa, e diz qual era o último', () => {
  // O caso real: a planilha trazia o Doblo com 136.172 atual contra troca de
  // óleo em 272.257, e a importação recusou o dado de propósito.
  const r = hodometroAceito(136172, 272257)
  assert.equal(r.ok, false)
  assert.equal(r.precisaJustificar, true)
  assert.match(r.motivo, /272\.257/)
})

test('salto grande demais pede confirmação, mas é justificável', () => {
  const r = hodometroAceito(160000, 148000)
  assert.equal(r.ok, false)
  assert.equal(r.precisaJustificar, true)
  assert.match(r.motivo, /12\.000/)
})

test('avanço normal passa liso', () => {
  assert.deepEqual(hodometroAceito(148500, 148320),
    { ok: true, precisaJustificar: false, motivo: '' })
})

/* ── A ficha inteira ─────────────────────────────────────────────────────── */

const DIARIOS = ITENS.filter((i) => i.cadencia === 'diario' && i.ativo)

test('ficha completa e com hodômetro bom não tem problema nenhum', () => {
  assert.deepEqual(problemasDaFicha({
    hodometro: 148500, ultimoKm: 148320, justificativa: '',
    respostas: { d1: 'ok', d2: 'nao_ok' }, itens: DIARIOS,
  }), [])
})

test('item sem resposta é problema, e a mensagem diz qual', () => {
  const p = problemasDaFicha({
    hodometro: 148500, ultimoKm: 148320, justificativa: '',
    respostas: { d1: 'ok' }, itens: DIARIOS,
  })
  assert.equal(p.length, 1)
  assert.match(p[0], /Vazamentos sob o veículo/)
})

test('hodômetro para trás COM justificativa escrita passa', () => {
  // A trava não impede: ela obriga a pessoa a dizer o que aconteceu, pra o
  // número estranho ficar explicado no registro em vez de virar mistério.
  assert.deepEqual(problemasDaFicha({
    hodometro: 136172, ultimoKm: 272257,
    justificativa: 'Painel trocado na oficina semana passada, zerou.',
    respostas: { d1: 'ok', d2: 'ok' }, itens: DIARIOS,
  }), [])
})

test('hodômetro para trás com justificativa curta demais NÃO passa', () => {
  const p = problemasDaFicha({
    hodometro: 136172, ultimoKm: 272257, justificativa: 'sei la',
    respostas: { d1: 'ok', d2: 'ok' }, itens: DIARIOS,
  })
  assert.equal(p.length, 1)
})

test('hodômetro em branco ou zero NÃO passa nem com justificativa longa', () => {
  // O vazamento que isto impede: justificativa nunca perdoa a AUSÊNCIA do
  // número, só perdoa um número estranho. Uma justificativa longa e bem
  // escrita não pode virar atalho pra gravar a ficha sem hodômetro nenhum.
  const semNumero = problemasDaFicha({
    hodometro: null, ultimoKm: 272257,
    justificativa: 'O painel está com defeito, o mostrador não acende de jeito nenhum.',
    respostas: { d1: 'ok', d2: 'ok' }, itens: DIARIOS,
  })
  assert.equal(semNumero.length, 1)

  const zerado = problemasDaFicha({
    hodometro: 0, ultimoKm: 272257,
    justificativa: 'O painel está com defeito, o mostrador não acende de jeito nenhum.',
    respostas: { d1: 'ok', d2: 'ok' }, itens: DIARIOS,
  })
  assert.equal(zerado.length, 1)
})

/* ── A cobrança ──────────────────────────────────────────────────────────── */

const VEICULOS = [
  { id: 'v1', nome: 'VOLVO XC60',  pessoa_id: 'p1', situacao: 'ativo' },
  { id: 'v2', nome: 'FIAT PUNTO',  pessoa_id: 'p2', situacao: 'ativo' },
  { id: 'v3', nome: 'HONDA FIT',   pessoa_id: null, situacao: 'ativo' },
  { id: 'v4', nome: 'FIAT BRAVO',  pessoa_id: 'p3', situacao: 'em_manutencao' },
]
const PESSOAS = [
  { id: 'p1', nome: 'Humberto Mendonça' },
  { id: 'p2', nome: 'Marcus Vinicius' },
  { id: 'p3', nome: 'Erick Martins' },
]

test('carro sem dono fixo não entra na cobrança', () => {
  // O Honda Fit fica no Barracão, não com alguém. Cobrar dele acusaria todo
  // dia um carro que ninguém usou, e o quadro viraria ruído.
  const l = quemFaltaHoje({ veiculos: VEICULOS, fichasDeHoje: [], pessoas: PESSOAS })
  assert.equal(l.some((x) => x.veiculo.id === 'v3'), false)
})

test('carro na oficina não entra na cobrança', () => {
  const l = quemFaltaHoje({ veiculos: VEICULOS, fichasDeHoje: [], pessoas: PESSOAS })
  assert.equal(l.some((x) => x.veiculo.id === 'v4'), false)
})

test('quem não fez aparece primeiro, com o nome do dono', () => {
  const l = quemFaltaHoje({
    veiculos: VEICULOS, pessoas: PESSOAS,
    fichasDeHoje: [{ veiculo_id: 'v1' }],
  })
  assert.equal(l.length, 2)
  assert.equal(l[0].veiculo.id, 'v2')
  assert.equal(l[0].fez, false)
  assert.equal(l[0].dono, 'Marcus Vinicius')
  assert.equal(l[1].fez, true)
})

test('dono que saiu do cadastro não quebra a linha — o carro continua cobrado', () => {
  const l = quemFaltaHoje({
    veiculos: [{ id: 'v9', nome: 'X', pessoa_id: 'sumiu', situacao: 'ativo' }],
    fichasDeHoje: [], pessoas: PESSOAS,
  })
  assert.equal(l[0].dono, null)
  assert.equal(l[0].fez, false)
  // donoId guarda o id original mesmo sem o nome: é ele, não o nome, que
  // outra tela usaria pra ir atrás de quem é o dono.
  assert.equal(l[0].donoId, 'sumiu')
})

/* ── D9b: com `usos`, quem cobra é quem está com o carro, não o dono no papel ── */

test('sem `usos`, o comportamento é idêntico ao de antes — o dono fixo sempre', () => {
  // Chamada como sempre foi chamada, sem o parâmetro novo — é o contrato que
  // o parâmetro opcional promete às chamadas existentes.
  const l = quemFaltaHoje({ veiculos: VEICULOS, fichasDeHoje: [], pessoas: PESSOAS })
  const v1 = l.find((x) => x.veiculo.id === 'v1')
  assert.equal(v1.donoId, 'p1')
  assert.equal(v1.dono, 'Humberto Mendonça')
})

test('com `usos`, o carro emprestado cobra de quem está com ele — não do dono fixo', () => {
  // Marcus emprestou o Volvo (v1, dono Humberto) para a Barbara. Enquanto
  // durar, é a Barbara quem tem que preencher o checklist de hoje, não o
  // Humberto — que nem está com o carro pra conferir o que quer que seja.
  const usos = [{ id: 'u1', veiculo_id: 'v1', tipo: 'posse', pessoa_id: 'p4', pessoa_nome: 'Barbara Souza',
    volta_em: null, saida_em: '2026-08-01T00:00:00Z' }]
  const l = quemFaltaHoje({ veiculos: VEICULOS, fichasDeHoje: [], pessoas: [...PESSOAS, { id: 'p4', nome: 'Barbara Souza' }], usos })
  const v1 = l.find((x) => x.veiculo.id === 'v1')
  assert.equal(v1.donoId, 'p4')
  assert.equal(v1.dono, 'Barbara Souza')
  // O carro sem posse (v2, Marcus) continua cobrando do dono fixo dele.
  const v2 = l.find((x) => x.veiculo.id === 'v2')
  assert.equal(v2.donoId, 'p2')
})

test('dois carros sem checklist saem em ordem alfabética pelo nome, não pela ordem de entrada', () => {
  // Nomes de propósito ao contrário da ordem em que entram no array: se
  // alguém tirar o localeCompare do sort, este é o único teste que denuncia —
  // com só um carro no grupo "não fez" (como nos outros testes daqui), o
  // desempate nunca entra em jogo e a regressão passaria batido.
  const l = quemFaltaHoje({
    veiculos: [
      { id: 'z', nome: 'ZEBRA', pessoa_id: 'p1', situacao: 'ativo' },
      { id: 'a', nome: 'ALFA', pessoa_id: 'p2', situacao: 'ativo' },
    ],
    fichasDeHoje: [], pessoas: PESSOAS,
  })
  assert.equal(l.length, 2)
  assert.equal(l[0].veiculo.id, 'a')
  assert.equal(l[1].veiculo.id, 'z')
})

test('o resumo conta quem falta, e comemora quando não falta ninguém', () => {
  const todos = quemFaltaHoje({ veiculos: VEICULOS, pessoas: PESSOAS,
    fichasDeHoje: [{ veiculo_id: 'v1' }, { veiculo_id: 'v2' }] })
  assert.equal(resumoDaCobranca(todos), 'Todos os carros com dono já foram conferidos hoje.')
  const um = quemFaltaHoje({ veiculos: VEICULOS, pessoas: PESSOAS,
    fichasDeHoje: [{ veiculo_id: 'v1' }] })
  assert.equal(resumoDaCobranca(um), '1 carro ainda sem checklist hoje.')
  const nenhum = quemFaltaHoje({ veiculos: VEICULOS, pessoas: PESSOAS, fichasDeHoje: [] })
  assert.equal(resumoDaCobranca(nenhum), '2 carros ainda sem checklist hoje.')
})

test('sem carro com dono nenhum, o resumo não mente dizendo que está tudo certo', () => {
  assert.equal(resumoDaCobranca([]), 'Nenhum carro com dono fixo cadastrado.')
})

/* ── O calendário: o quadro não cobra em dia que não pede checklist ───────── */

test('no sábado e no domingo o quadro não cobra ninguém', () => {
  // 2026-08-08 é sábado, 2026-08-09 é domingo. Sem a data, o quadro acusava
  // os carros todos num dia em que ninguém deve nada — e um quadro que acusa
  // à toa é um quadro que ninguém olha mais.
  for (const fimDeSemana of ['2026-08-08', '2026-08-09']) {
    const l = quemFaltaHoje({ veiculos: VEICULOS, fichasDeHoje: [], pessoas: PESSOAS, hoje: fimDeSemana })
    assert.deepEqual(l, [])
    // E a frase do topo diz POR QUE está vazio — "nenhum carro cadastrado"
    // seria mentira, os carros estão lá.
    assert.equal(resumoDaCobranca(l, fimDeSemana),
      'Hoje é fim de semana: o checklist é de dia útil, ninguém deve nada.')
  }
})

test('em dia útil o quadro cobra normalmente, com a data passada', () => {
  // 2026-08-05 é uma quarta-feira: a data não pode virar desculpa pra o quadro
  // ficar mudo em dia de trabalho.
  const l = quemFaltaHoje({ veiculos: VEICULOS, fichasDeHoje: [], pessoas: PESSOAS, hoje: '2026-08-05' })
  assert.equal(l.length, 2)
  assert.equal(resumoDaCobranca(l, '2026-08-05'), '2 carros ainda sem checklist hoje.')
})

test('sem a data, tudo continua como era — as chamadas antigas não mudam', () => {
  // O parâmetro é opcional de propósito: quem já chamava sem data continua
  // recebendo a lista inteira, e nenhum chamador existente quebra.
  const l = quemFaltaHoje({ veiculos: VEICULOS, fichasDeHoje: [], pessoas: PESSOAS })
  assert.equal(l.length, 2)
  assert.equal(resumoDaCobranca(l), '2 carros ainda sem checklist hoje.')
})

/* ── Quem precisa preencher, e quando ────────────────────────────────────── */

test('carro sem ficha hoje precisa de checklist ao ser pego', () => {
  assert.equal(precisaDeChecklist({ veiculoId: 'v1', fichas: [], hoje: '2026-08-05' }), true)
})

test('carro que já foi conferido hoje não pede de novo', () => {
  // D12: um carro, um dia, uma ficha. Quem pega depois herda a conferência de
  // quem pegou primeiro.
  const fichas = [{ veiculo_id: 'v1', feita_em: '2026-08-05' }]
  assert.equal(precisaDeChecklist({ veiculoId: 'v1', fichas, hoje: '2026-08-05' }), false)
})

test('ficha de ontem não vale para hoje', () => {
  const fichas = [{ veiculo_id: 'v1', feita_em: '2026-08-04' }]
  assert.equal(precisaDeChecklist({ veiculoId: 'v1', fichas, hoje: '2026-08-05' }), true)
})

test('no fim de semana o rodízio ainda confere o carro antes de sair', () => {
  // O diário é seg-sex, mas quem pega um carro no sábado está prestes a
  // dirigir. O papel manda conferir ANTES DA UTILIZAÇÃO, e isso não tem dia.
  assert.equal(precisaDeChecklist({ veiculoId: 'v1', fichas: [], hoje: '2026-08-08' }), true)
})

/* ── O editor da lista ───────────────────────────────────────────────────── */

const EXISTENTES = [
  { id: 'a', item: 'Faróis', cadencia: 'semanal' },
  { id: 'b', item: 'Buzina', cadencia: 'semanal' },
]

test('item bom não tem problema', () => {
  assert.deepEqual(problemasDoItemDeChecklist({
    item: 'Filtro de ar', cadencia: 'mensal', existentes: EXISTENTES, idAtual: null }), [])
})

test('nome vazio ou curto demais não passa', () => {
  assert.equal(problemasDoItemDeChecklist({
    item: '  ', cadencia: 'diario', existentes: [], idAtual: null }).length, 1)
  assert.equal(problemasDoItemDeChecklist({
    item: 'ab', cadencia: 'diario', existentes: [], idAtual: null }).length, 1)
})

test('cadência inventada não passa', () => {
  const p = problemasDoItemDeChecklist({
    item: 'Filtro de ar', cadencia: 'anual', existentes: [], idAtual: null })
  assert.equal(p.length, 1)
})

test('nome repetido não passa, e a mensagem diz por quê', () => {
  // Dois itens com o mesmo nome dariam duas perguntas iguais na mesma ficha.
  const p = problemasDoItemDeChecklist({
    item: 'faróis', cadencia: 'semanal', existentes: EXISTENTES, idAtual: null })
  assert.equal(p.length, 1)
  assert.match(p[0], /já existe/i)
})

test('editar o próprio item sem trocar o nome passa', () => {
  assert.deepEqual(problemasDoItemDeChecklist({
    item: 'Faróis', cadencia: 'diario', existentes: EXISTENTES, idAtual: 'a' }), [])
})

/* ── O telefone da cobrança (V2 do quadro D16) ───────────────────────────── */

test('telefoneDaCobranca prefere o corporativo, e cai pro pessoal se faltar', () => {
  assert.equal(telefoneDaCobranca({ numero_corporativo: '19999998888', numero_pessoal: '19777776666' }),
    '19999998888')
  assert.equal(telefoneDaCobranca({ numero_corporativo: '', numero_pessoal: '19777776666' }), '19777776666')
})

test('telefoneDaCobranca devolve null — nunca string vazia — quando não há nenhum', () => {
  // null, não '': é o que faz linkDoWhatsapp()/porQueNaoDaLink() tratarem
  // "sem telefone" do jeito que já tratam em qualquer outro lugar do app.
  assert.equal(telefoneDaCobranca({ numero_corporativo: '', numero_pessoal: '' }), null)
  assert.equal(telefoneDaCobranca({}), null)
  assert.equal(telefoneDaCobranca(null), null)
  assert.equal(telefoneDaCobranca(undefined), null)
})

/* ── Os problemas em aberto, juntos (pedido do dono) ─────────────────────── */

const VEICULOS_PROB = [
  { id: 'v1', nome: 'VOLVO XC60' },
  { id: 'v2', nome: 'FIAT PUNTO' },
]
const FICHAS_HOJE = [
  { id: 'f1', veiculo_id: 'v1', feita_em: '2026-08-07' },
  { id: 'f2', veiculo_id: 'v2', feita_em: '2026-08-07' },
]

test('só os itens "Problema" das fichas de HOJE entram, com o nome do carro', () => {
  const respostas = [
    { checklist_id: 'f1', item_texto: 'Faróis', estado: 'nao_ok', observacao: 'Farol direito queimado' },
    { checklist_id: 'f1', item_texto: 'Buzina', estado: 'ok', observacao: null },
    { checklist_id: 'f2', item_texto: 'Pneus', estado: 'nao_ok', observacao: null },
  ]
  const p = problemasAbertosHoje({ fichasDeHoje: FICHAS_HOJE, respostas, veiculos: VEICULOS_PROB })
  assert.equal(p.length, 2)
  assert.equal(p.some((x) => x.item === 'Buzina'), false)
  const volvo = p.find((x) => x.veiculoNome === 'VOLVO XC60')
  assert.equal(volvo.item, 'Faróis')
  assert.equal(volvo.observacao, 'Farol direito queimado')
})

test('problema de uma ficha que não é de hoje não entra', () => {
  // A resposta existe (viria de um `respostas` que trouxesse mais que o dia),
  // mas o checklist_id dela não está em `fichasDeHoje` — não é hoje, não conta.
  const respostas = [
    { checklist_id: 'de-ontem', item_texto: 'Faróis', estado: 'nao_ok', observacao: null },
  ]
  const p = problemasAbertosHoje({ fichasDeHoje: FICHAS_HOJE, respostas, veiculos: VEICULOS_PROB })
  assert.deepEqual(p, [])
})

test('sem observação escrita, o campo vem vazio — nunca null — pra tela não ter que tratar os dois', () => {
  const respostas = [{ checklist_id: 'f1', item_texto: 'Faróis', estado: 'nao_ok', observacao: null }]
  const p = problemasAbertosHoje({ fichasDeHoje: FICHAS_HOJE, respostas, veiculos: VEICULOS_PROB })
  assert.equal(p[0].observacao, '')
})

test('nenhum problema hoje devolve lista vazia, não erro', () => {
  const respostas = [{ checklist_id: 'f1', item_texto: 'Faróis', estado: 'ok', observacao: null }]
  assert.deepEqual(problemasAbertosHoje({ fichasDeHoje: FICHAS_HOJE, respostas, veiculos: VEICULOS_PROB }), [])
})

test('carro sumido do cadastro não quebra a lista de problemas', () => {
  const fichas = [{ id: 'f9', veiculo_id: 'sumiu', feita_em: '2026-08-07' }]
  const respostas = [{ checklist_id: 'f9', item_texto: 'Faróis', estado: 'nao_ok', observacao: null }]
  const p = problemasAbertosHoje({ fichasDeHoje: fichas, respostas, veiculos: VEICULOS_PROB })
  assert.equal(p[0].veiculoNome, 'Veículo removido')
})

test('a ordem é por nome do carro, depois pelo item', () => {
  const respostas = [
    { checklist_id: 'f1', item_texto: 'Z item', estado: 'nao_ok', observacao: null },
    { checklist_id: 'f2', item_texto: 'A item', estado: 'nao_ok', observacao: null },
  ]
  const p = problemasAbertosHoje({ fichasDeHoje: FICHAS_HOJE, respostas, veiculos: VEICULOS_PROB })
  // FIAT PUNTO vem antes de VOLVO XC60 alfabeticamente.
  assert.equal(p[0].veiculoNome, 'FIAT PUNTO')
  assert.equal(p[1].veiculoNome, 'VOLVO XC60')
})

/* ── Por quais carros esta pessoa pode preencher (D21b) ──────────────────── */

const FROTA = [
  { id: 'v1', nome: 'FIAT PUNTO', pessoa_id: 'p1', situacao: 'ativo' },
  { id: 'v2', nome: 'VOLVO XC60', pessoa_id: 'p2', situacao: 'ativo' },
  { id: 'v3', nome: 'HONDA FIT',  pessoa_id: null, situacao: 'ativo' },
  { id: 'v4', nome: 'FIAT DOBLO', pessoa_id: 'p9', situacao: 'em_manutencao' },
]

test('quem só dirige vê apenas o próprio carro', () => {
  const l = veiculosParaConferir({ veiculos: FROTA, euId: 'p1', ehGestor: false, fichas: [], hoje: '2026-08-06' })
  assert.deepEqual(l.map((x) => x.veiculo.id), ['v1'])
  assert.equal(l[0].meu, true)
})

test('quem administra vê todos os ativos, com o próprio na frente', () => {
  // O carro da pessoa vem primeiro: é o que ela provavelmente veio fazer.
  const l = veiculosParaConferir({ veiculos: FROTA, euId: 'p2', ehGestor: true, fichas: [], hoje: '2026-08-06' })
  assert.deepEqual(l.map((x) => x.veiculo.id), ['v2', 'v1', 'v3'])
  assert.equal(l[0].meu, true)
  assert.equal(l[1].meu, false)
})

test('carro fora de operação não entra nem pro gestor', () => {
  const l = veiculosParaConferir({ veiculos: FROTA, euId: 'p1', ehGestor: true, fichas: [], hoje: '2026-08-06' })
  assert.equal(l.some((x) => x.veiculo.id === 'v4'), false)
})

test('carro que já tem ficha hoje sai da lista', () => {
  const fichas = [{ veiculo_id: 'v1', feita_em: '2026-08-06' }]
  const l = veiculosParaConferir({ veiculos: FROTA, euId: 'p1', ehGestor: true, fichas, hoje: '2026-08-06' })
  assert.equal(l.some((x) => x.veiculo.id === 'v1'), false)
})

test('ficha de ontem não conta como feita hoje', () => {
  const fichas = [{ veiculo_id: 'v1', feita_em: '2026-08-05' }]
  const l = veiculosParaConferir({ veiculos: FROTA, euId: 'p1', ehGestor: false, fichas, hoje: '2026-08-06' })
  assert.equal(l.length, 1)
})

test('gestor sem carro próprio vê todos, sem quebrar', () => {
  const l = veiculosParaConferir({ veiculos: FROTA, euId: 'p9', ehGestor: true, fichas: [], hoje: '2026-08-06' })
  assert.deepEqual(l.map((x) => x.veiculo.id), ['v1', 'v3', 'v2'])
  assert.equal(l.every((x) => !x.meu), true)
})

test('o dono do carro vem junto, pro gestor saber por quem está preenchendo', () => {
  const l = veiculosParaConferir({ veiculos: FROTA, euId: 'p2', ehGestor: true, fichas: [], hoje: '2026-08-06' })
  const punto = l.find((x) => x.veiculo.id === 'v1')
  assert.equal(punto.donoId, 'p1')
})

/* Os que o brief não pediu, e que existem porque a tela depende deles ─────── */

test('quem está COM o carro emprestado o vê como seu (D9b)', () => {
  // Marcus emprestou o Punto pra Barbara. Sem isto, ela não veria o cartão de
  // checklist de um carro que está com ela — e o quadro de cobrança, que já
  // olha a posse, cobraria dela uma ficha que a tela não deixava preencher.
  const l = veiculosParaConferir({ veiculos: FROTA, euId: 'barbara', ehGestor: false,
    fichas: [], hoje: '2026-08-06', quemEstaCom: (v) => (v.id === 'v1' ? 'barbara' : v.pessoa_id) })
  assert.deepEqual(l.map((x) => x.veiculo.id), ['v1'])
  assert.equal(l[0].meu, true)
  // E o dono CONTINUA sendo o Marcus: é o cadastro do carro, não quem está com
  // ele hoje. Trocar isso faria a tela dizer que o carro é de quem pegou.
  assert.equal(l[0].donoId, 'p1')
})

test('emprestar o carro tira ele do "meu" de quem emprestou', () => {
  const l = veiculosParaConferir({ veiculos: FROTA, euId: 'p1', ehGestor: true,
    fichas: [], hoje: '2026-08-06', quemEstaCom: (v) => (v.id === 'v1' ? 'barbara' : v.pessoa_id) })
  assert.equal(l.find((x) => x.veiculo.id === 'v1').meu, false)
  // e sem carro "meu" nenhum, nada abre sozinho: o primeiro da lista não é dele
  assert.equal(l[0].meu, false)
})

test('quem não foi achado no cadastro (euId nulo) não vira dono de carro sem dono', () => {
  // `v3` não tem `pessoa_id`. Sem a guarda, `null === null` daria "meu" e o
  // cartão de um carro de rodízio abriria sozinho pra quem não foi
  // identificado.
  const l = veiculosParaConferir({ veiculos: FROTA, euId: null, ehGestor: true, fichas: [], hoje: '2026-08-06' })
  assert.equal(l.every((x) => !x.meu), true)
  const so = veiculosParaConferir({ veiculos: FROTA, euId: null, ehGestor: false, fichas: [], hoje: '2026-08-06' })
  assert.deepEqual(so, [])
})

test('lista vazia e entrada suja não derrubam nada', () => {
  assert.deepEqual(veiculosParaConferir({}), [])
  assert.deepEqual(veiculosParaConferir({ veiculos: [null, undefined], euId: 'p1', ehGestor: true }), [])
})

/* ── O resultado sai dos itens, e não do dedo de quem confere ───────────────
 *
 * Pedido do dono em 12/08/2026, derrubando a D14. A regra antiga permitia o
 * pior desfecho: marcar LIBERADO com vazamento embaixo do carro, e a ficha
 * assinada registrar isso como verdade. */

const ITENS_GRAVIDADE = [
  { item: 'Vazamentos sob o veículo', impede_uso: true },
  { item: 'Estado geral dos pneus', impede_uso: true },
  { item: 'Faróis', impede_uso: false },
  { item: 'Buzina', impede_uso: false },
];

test('tudo certo libera', () => {
  const r = [{ item_texto: 'Faróis', estado: 'ok' }, { item_texto: 'Buzina', estado: 'ok' }];
  assert.equal(resultadoDoChecklist(r, ITENS_GRAVIDADE), 'liberado');
});

test('problema que NÃO impede rodar vira ressalva', () => {
  const r = [{ item_texto: 'Buzina', estado: 'nao_ok' }];
  assert.equal(resultadoDoChecklist(r, ITENS_GRAVIDADE), 'com_ressalvas');
});

test('vazamento NÃO LIBERA o carro — o caso que o dono citou', () => {
  const r = [{ item_texto: 'Vazamentos sob o veículo', estado: 'nao_ok' }];
  assert.equal(resultadoDoChecklist(r, ITENS_GRAVIDADE), 'nao_liberado');
});

test('pneu com problema NÃO LIBERA — o outro caso citado', () => {
  assert.equal(resultadoDoChecklist([{ item_texto: 'Estado geral dos pneus', estado: 'nao_ok' }], ITENS_GRAVIDADE), 'nao_liberado');
});

test('um grave no meio de vários leves manda no resultado', () => {
  // O grave não pode ser diluído: basta um pra o carro não sair.
  const r = [
    { item_texto: 'Buzina', estado: 'nao_ok' },
    { item_texto: 'Faróis', estado: 'nao_ok' },
    { item_texto: 'Vazamentos sob o veículo', estado: 'nao_ok' },
  ];
  assert.equal(resultadoDoChecklist(r, ITENS_GRAVIDADE), 'nao_liberado');
});

test('item que ninguém classificou conta como NÃO impeditivo', () => {
  // Inventar gravidade sobre item que o dono nunca marcou seria pior que a
  // ressalva — e a lista dele muda sem passar por aqui.
  const r = [{ item_texto: 'Item que não está na lista', estado: 'nao_ok' }];
  assert.equal(resultadoDoChecklist(r, ITENS_GRAVIDADE), 'com_ressalvas');
});

test('sem resposta nenhuma, libera — ficha vazia não acusa', () => {
  assert.equal(resultadoDoChecklist([], ITENS_GRAVIDADE), 'liberado');
  assert.equal(resultadoDoChecklist(null, null), 'liberado');
});

test('a tela consegue DIZER por que, separando grave de leve', () => {
  // "Não liberado" sozinho não ajuda; com o nome do item, a pessoa sabe o que
  // resolver.
  const r = [
    { item_texto: 'Vazamentos sob o veículo', estado: 'nao_ok' },
    { item_texto: 'Buzina', estado: 'nao_ok' },
    { item_texto: 'Faróis', estado: 'ok' },
  ];
  const p = porQueDoResultado(r, ITENS_GRAVIDADE);
  assert.deepEqual(p.graves, ['Vazamentos sob o veículo']);
  assert.deepEqual(p.leves, ['Buzina']);
});

test('a frase da reserva não promete checklist quando ele já foi feito', () => {
  // A ficha de retirada mostrava, fixo, "Aqui só falta o checklist e o
  // combustível" — inclusive na tela em que outra pessoa JÁ tinha conferido o
  // carro e o que se pede é só a assinatura de recebimento. A frase dizia à
  // pessoa para procurar um checklist que não estava lá.
  assert.match(oQueFaltaNaRetirada('checklist'), /checklist e o combustível/)
  assert.match(oQueFaltaNaRetirada('aceite'), /assinar/)
  assert.doesNotMatch(oQueFaltaNaRetirada('aceite'), /checklist/)
  assert.match(oQueFaltaNaRetirada('nada'), /combustível/)
  assert.doesNotMatch(oQueFaltaNaRetirada('nada'), /checklist|assinar/)
  // Chave desconhecida não pode devolver vazio: a frase some da tela e a
  // pessoa fica sem saber o que a ficha ainda quer dela.
  assert.ok(oQueFaltaNaRetirada('coisa-nova').length > 0)
})

/* ── O quadro de checklist de hoje, com fixos e retiradas ─────────────────── */

const carro = (id, nome, extra = {}) => ({ id, nome, situacao: 'ativo', pessoa_id: null, ...extra })
const SEXTA = '2026-08-21'
const SABADO = '2026-08-22'

test('o carro retirado hoje entra no quadro, mesmo sem dono fixo', () => {
  // O BURACO MEDIDO EM 21/08/2026: o dono retirou a Bravo Blackmotion, um carro
  // de rodízio, e o quadro não mostrava esse carro pra ninguém — nem pendente,
  // nem feito. Retirada sem checklist não era cobrada de pessoa nenhuma.
  const linhas = checklistDeHoje({
    veiculos: [carro('bravo', 'FIAT BRAVO BLACKMOTION')],
    fichasDeHoje: [],
    usos: [{ veiculo_id: 'bravo', tipo: 'viagem', pessoa_id: 'p-erick', pessoa_nome: 'Erick Martins',
      saida_em: '2026-08-21T12:03:58Z', volta_em: null }],
    pessoas: [{ id: 'p-erick', nome: 'Erick Martins' }],
    hoje: SEXTA,
  })
  assert.equal(linhas.length, 1)
  assert.equal(linhas[0].tag, 'reserva')
  assert.equal(linhas[0].fez, false)
  assert.equal(linhas[0].quem, 'Erick Martins')
})

test('carro de retirada entra no SÁBADO; o carro fixo não', () => {
  // Quem pega carro confere antes de sair, e o papel não conhece fim de semana.
  // Já o checklist do carro fixo é de segunda a sexta.
  const veiculos = [carro('bravo', 'BRAVO'), carro('volvo', 'VOLVO XC60', { pessoa_id: 'p-hum' })]
  const usos = [{ veiculo_id: 'bravo', tipo: 'viagem', pessoa_nome: 'Erick', saida_em: '2026-08-22T13:00:00Z' }]
  const linhas = checklistDeHoje({ veiculos, fichasDeHoje: [], usos, pessoas: [], hoje: SABADO })
  assert.deepEqual(linhas.map((l) => l.veiculo.id), ['bravo'])
  assert.equal(linhas[0].tag, 'reserva')
})

test('o que já foi feito aparece junto, marcado, e vai pro fim da lista', () => {
  const veiculos = [carro('a', 'AAA', { pessoa_id: 'p1' }), carro('b', 'BBB', { pessoa_id: 'p2' })]
  const linhas = checklistDeHoje({
    veiculos,
    fichasDeHoje: [{ veiculo_id: 'a', feita_em: SEXTA, assinada_em: '2026-08-21T10:00:00Z' }],
    usos: [], pessoas: [{ id: 'p1', nome: 'Ana' }, { id: 'p2', nome: 'Bruno' }], hoje: SEXTA,
  })
  assert.deepEqual(linhas.map((l) => l.veiculo.id), ['b', 'a'], 'pendente primeiro')
  assert.equal(linhas[1].fez, true)
  assert.equal(linhas[1].assinada, true)
  assert.equal(linhas[0].tag, 'fixo')
})

test('ficha sem assinatura conta como feita, mas o quadro sabe a diferença', () => {
  const linhas = checklistDeHoje({
    veiculos: [carro('a', 'AAA', { pessoa_id: 'p1' })],
    fichasDeHoje: [{ veiculo_id: 'a', feita_em: SEXTA, assinada_em: null }],
    usos: [], pessoas: [], hoje: SEXTA,
  })
  assert.equal(linhas[0].fez, true)
  assert.equal(linhas[0].assinada, false)
})

test('viagem que começou ONTEM não pede checklist hoje', () => {
  // O checklist de hoje é de quem pega o carro hoje. Uma viagem de três dias
  // não faz o carro aparecer pendente todo dia.
  const linhas = checklistDeHoje({
    veiculos: [carro('bravo', 'BRAVO')],
    fichasDeHoje: [], usos: [{ veiculo_id: 'bravo', tipo: 'viagem', saida_em: '2026-08-20T12:00:00Z', volta_em: null }],
    pessoas: [], hoje: SEXTA,
  })
  assert.deepEqual(linhas, [])
})

test('posse não é retirada: carro emprestado continua sendo fixo', () => {
  const linhas = checklistDeHoje({
    veiculos: [carro('doblo', 'FIAT DOBLO')],
    fichasDeHoje: [],
    usos: [{ veiculo_id: 'doblo', tipo: 'posse', pessoa_id: 'p-jer', saida_em: '2026-08-21T11:00:00Z', volta_em: null }],
    pessoas: [{ id: 'p-jer', nome: 'Jeremias' }], hoje: SEXTA,
  })
  assert.equal(linhas.length, 1)
  assert.equal(linhas[0].tag, 'fixo')
  assert.equal(linhas[0].quem, 'Jeremias', 'quem está com o carro vence o dono no papel (D9b)')
})

test('carro na oficina não entra no quadro', () => {
  assert.deepEqual(checklistDeHoje({
    veiculos: [carro('x', 'XXX', { pessoa_id: 'p1', situacao: 'em_manutencao' })],
    fichasDeHoje: [], usos: [], pessoas: [], hoje: SEXTA,
  }), [])
})

test('o carro que está na sua mão AGORA abre antes do seu carro fixo', () => {
  // 21/08/2026: quem tem carro fixo e pegou um de rodízio via os dois como
  // "meus", e o desempate era alfabético — o cartão abria no FIAT TORO
  // enquanto a pessoa estava de pé ao lado da SAVEIRO que acabou de retirar.
  const veiculos = [
    { id: 'toro', nome: 'FIAT TORO FREEDOM', situacao: 'ativo', pessoa_id: 'p-eu' },
    { id: 'saveiro', nome: 'VW SAVEIRO ROBUST', situacao: 'ativo', pessoa_id: null },
  ]
  const lista = veiculosParaConferir({
    veiculos, euId: 'p-eu', ehGestor: false, fichas: [], hoje: '2026-08-21',
    quemEstaCom: (v) => (v.id === 'saveiro' ? 'p-eu' : v.pessoa_id),
    emViagem: (v) => (v.id === 'saveiro' ? 'p-eu' : null),
  })
  assert.deepEqual(lista.map((x) => x.veiculo.id), ['saveiro', 'toro'])
  assert.equal(lista[0].naMinhaMao, true)
  assert.equal(lista[1].naMinhaMao, false)
})

test('sem `emViagem`, a ordem é a de antes — nada muda para quem não passa isso', () => {
  const veiculos = [
    { id: 'b', nome: 'BBB', situacao: 'ativo', pessoa_id: 'p-eu' },
    { id: 'a', nome: 'AAA', situacao: 'ativo', pessoa_id: 'p-eu' },
  ]
  const lista = veiculosParaConferir({ veiculos, euId: 'p-eu', ehGestor: false, fichas: [], hoje: '2026-08-21' })
  assert.deepEqual(lista.map((x) => x.veiculo.id), ['a', 'b'])
})
