import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  seAtropelam, conflitosDe, problemasDaRequisicao, bloqueios,
  podeDecidir, motivoEmPortugues, ordenarFila, quando, ANTECEDENCIA_IDEAL_DIAS,
  reservaParaPegar, reservaSegurando, meusPedidos,
} from './requisicoes.js'

const AGORA = '2026-08-04T12:00:00Z'
const dias = (n) => new Date(Date.parse(AGORA) + n * 86400000).toISOString()

const req = (extra = {}) => ({
  id: 'r1', veiculo_id: 'v1', pessoa_id: 'p1', situacao: 'pendente',
  retirada_prevista: dias(5), devolucao_prevista: dias(5.2), destino: 'Conchal', ...extra,
})

/* ── Conflito de viagens: a razão de existir da requisição ────────────────── */

test('encostar NÃO é conflito — a chave passa de mão em mão', () => {
  // Quem devolve às 12h e quem pega às 12h se encontram no estacionamento.
  const a = { retirada_prevista: '2026-08-10T08:00Z', devolucao_prevista: '2026-08-10T12:00Z' }
  const b = { retirada_prevista: '2026-08-10T12:00Z', devolucao_prevista: '2026-08-10T18:00Z' }
  assert.equal(seAtropelam(a, b), false)
  assert.equal(seAtropelam(b, a), false)
})

test('cruzar um minuto já é conflito', () => {
  const a = { retirada_prevista: '2026-08-10T08:00Z', devolucao_prevista: '2026-08-10T12:00Z' }
  const b = { retirada_prevista: '2026-08-10T11:59Z', devolucao_prevista: '2026-08-10T18:00Z' }
  assert.equal(seAtropelam(a, b), true)
})

test('reserva sem hora de volta ocupa o dia inteiro', () => {
  // Quem não sabe quando volta está com o carro até o fim do dia, não por um
  // instante. Tratar como instantâneo liberaria o carro que está na estrada.
  const semVolta = { retirada_prevista: '2026-08-10T08:00Z', devolucao_prevista: null }
  const tarde = { retirada_prevista: '2026-08-10T15:00Z', devolucao_prevista: '2026-08-10T18:00Z' }
  assert.equal(seAtropelam(semVolta, tarde), true)
  const outroDia = { retirada_prevista: '2026-08-11T15:00Z', devolucao_prevista: '2026-08-11T18:00Z' }
  assert.equal(seAtropelam(semVolta, outroDia), false)
})

test('data ilegível não vira conflito falso', () => {
  assert.equal(seAtropelam({ retirada_prevista: 'sei lá' }, req()), false)
  assert.equal(seAtropelam(null, req()), false)
})

test('conflito é por VEÍCULO — outro carro no mesmo horário está de boa', () => {
  const minha = req()
  const outras = [
    { id: 'r2', veiculo_id: 'v2', situacao: 'aprovada', retirada_prevista: dias(5), devolucao_prevista: dias(5.2) },
  ]
  assert.deepEqual(conflitosDe(minha, outras), [])
})

test('recusada e cancelada NÃO disputam o carro', () => {
  const minha = req()
  const outras = [
    { id: 'r2', veiculo_id: 'v1', situacao: 'recusada', retirada_prevista: dias(5), devolucao_prevista: dias(5.2) },
    { id: 'r3', veiculo_id: 'v1', situacao: 'cancelada', retirada_prevista: dias(5), devolucao_prevista: dias(5.2) },
    { id: 'r4', veiculo_id: 'v1', situacao: 'aprovada', retirada_prevista: dias(5), devolucao_prevista: dias(5.2) },
  ]
  assert.deepEqual(conflitosDe(minha, outras).map((r) => r.id), ['r4'])
})

test('a requisição não conflita consigo mesma', () => {
  const minha = req()
  assert.deepEqual(conflitosDe(minha, [minha]), [])
})

/* ── O que barra e o que só avisa ─────────────────────────────────────────── */

test('sem veículo, sem motorista e sem data não grava', () => {
  const p = problemasDaRequisicao({ }, [], AGORA)
  const b = bloqueios(p).map((x) => x.texto).join(' | ')
  assert.match(b, /veículo/i)
  assert.match(b, /quem vai dirigir/i)
  assert.match(b, /quando você vai retirar/i)
})

test('devolução antes da retirada é impossível, não é opinião', () => {
  const p = problemasDaRequisicao(req({ retirada_prevista: dias(5), devolucao_prevista: dias(4) }), [], AGORA)
  assert.equal(bloqueios(p).length, 1)
  assert.match(bloqueios(p)[0].texto, /depois da retirada/i)
})

test('pedido em cima da hora AVISA da regra dos 3 dias, mas deixa passar', () => {
  // O manual da planilha pede 3 dias de antecedência. É combinado interno, não
  // lei da física — bloquear impediria a urgência real de acontecer.
  const p = problemasDaRequisicao(req({ retirada_prevista: dias(1) }), [], AGORA)
  assert.equal(bloqueios(p).length, 0)
  const aviso = p.find((x) => /antecedência/i.test(x.texto))
  assert.ok(aviso)
  assert.match(aviso.texto, new RegExp(String(ANTECEDENCIA_IDEAL_DIAS)))
  assert.match(aviso.texto, /assim mesmo/i, 'tem que dizer que dá pra seguir')
})

test('pedido com folga não reclama de nada', () => {
  // Mover só a retirada deixaria a devolução ANTES dela — e o próprio módulo
  // pegou isso quando eu escrevi este teste errado. As duas datas andam juntas.
  assert.deepEqual(
    problemasDaRequisicao(req({ retirada_prevista: dias(10), devolucao_prevista: dias(10.2) }), [], AGORA),
    [])
})

test('data no passado avisa, e não bloqueia', () => {
  // Alguém esqueceu de pedir e registra depois: legítimo. Mas quase sempre é
  // data digitada errada, e vale perguntar.
  const p = problemasDaRequisicao(req({ retirada_prevista: dias(-4), devolucao_prevista: dias(-3.8) }), [], AGORA)
  assert.equal(bloqueios(p).length, 0)
  assert.ok(p.some((x) => /já passou/i.test(x.texto)))
})

test('conflito vira aviso com NOME e destino de quem pediu antes', () => {
  // Dizer só "há conflito" obriga a pessoa a caçar quem foi. Com nome e
  // destino, ela resolve no WhatsApp em trinta segundos.
  const outras = [{
    id: 'r9', veiculo_id: 'v1', situacao: 'aprovada', pessoa_nome: 'Raissa', destino: 'Campinas',
    retirada_prevista: dias(5), devolucao_prevista: dias(5.1),
  }]
  const p = problemasDaRequisicao(req(), outras, AGORA)
  const c = p.find((x) => /reservado/i.test(x.texto))
  assert.ok(c)
  assert.match(c.texto, /Raissa/)
  assert.match(c.texto, /Campinas/)
  assert.equal(c.bloqueia, false, 'combinar entre pessoas resolve; travar não')
})

test('sem destino é só um empurrão, não uma trava', () => {
  const p = problemasDaRequisicao(req({ destino: '   ' }), [], AGORA)
  assert.equal(bloqueios(p).length, 0)
  assert.ok(p.some((x) => /quem aprova não sabe/i.test(x.texto)))
})

/* ── Quem decide ──────────────────────────────────────────────────────────── */

/* Os dois testes que ficavam aqui — "ninguém aprova a própria requisição" e
 * "nem quando pediu para outra pessoa dirigir" — guardavam a regra que o dono
 * derrubou em 12/08/2026. Foram apagados, não adaptados: teste que continua
 * verde por outro caminho depois que a regra muda vira armadilha, porque quem
 * ler acredita que a regra velha ainda vale em algum canto. */

test('quem administra a Frota aprova a própria requisição', () => {
  // Decisão do dono, consultado sobre marcar visualmente: aprova como qualquer
  // outra, sem selo diferente. O caso real: as 2 requisições pendentes de
  // OLW4I46 eram dele, e ficaram travadas desde 11/08 sem saída na tela.
  const r = podeDecidir({
    requisicao: req({ pessoa_id: 'p1', criada_por: 'u1' }),
    minhaPessoaId: 'p1', meuUsuarioId: 'u1', temPermissaoAprovar: true,
  })
  assert.equal(r.pode, true)
  assert.equal(r.motivo, null)
})

test('a frase da regra velha não existe mais — nem sobrando no código', () => {
  // Frase que a tela nunca mostra é frase que alguém lê e acredita.
  assert.equal(motivoEmPortugues('propria'), '')
})

test('o outro aprovador decide normalmente', () => {
  const r = podeDecidir({
    requisicao: req({ pessoa_id: 'p1', criada_por: 'u1' }),
    minhaPessoaId: 'p2', meuUsuarioId: 'u2', temPermissaoAprovar: true,
  })
  assert.equal(r.pode, true)
})

test('sem permissão não decide, e requisição já decidida não reabre', () => {
  assert.equal(podeDecidir({ requisicao: req(), minhaPessoaId: 'p2', temPermissaoAprovar: false }).motivo, 'sem-permissao')
  assert.equal(podeDecidir({ requisicao: req({ situacao: 'aprovada' }), minhaPessoaId: 'p2', temPermissaoAprovar: true }).motivo, 'ja-decidida')
  assert.equal(podeDecidir({ requisicao: null, temPermissaoAprovar: true }).motivo, 'ja-decidida')
})

test('toda recusa tem frase, nenhuma sai muda', () => {
  // 'propria' saiu da lista em 12/08/2026: deixou de ser uma recusa possível
  // quando o dono passou a aprovar a própria requisição.
  for (const m of ['ja-decidida', 'sem-permissao']) {
    assert.ok(motivoEmPortugues(m).length > 15, `motivo ${m} sem frase`)
  }
})

/* ── Fila e datas ─────────────────────────────────────────────────────────── */

test('a fila mostra primeiro quem sai primeiro', () => {
  const fila = ordenarFila([
    { id: 'c', retirada_prevista: dias(9) },
    { id: 'a', retirada_prevista: dias(1) },
    { id: 'b', retirada_prevista: dias(4) },
  ])
  assert.deepEqual(fila.map((r) => r.id), ['a', 'b', 'c'])
})

test('requisição sem data vai pro fim, não some nem quebra a ordem', () => {
  const fila = ordenarFila([{ id: 'sem' }, { id: 'com', retirada_prevista: dias(2) }])
  assert.deepEqual(fila.map((r) => r.id), ['com', 'sem'])
})

test('data ilegível não vira "Invalid Date" na cara da pessoa', () => {
  assert.equal(quando(null), '—')
  assert.equal(quando('banana'), '—')
  assert.match(quando('2026-08-10T14:30:00Z'), /\d{2}\/\d{2} às \d{2}:\d{2}/)
})

/* ── Quem pode PEGAR o carro (o "Vou usar" virou "Peguei o carro") ──────────
 *
 * O dono mandou tirar o "Vou usar" em 12/08/2026: com ele ao lado do
 * "Reservar", quem quisesse evitar o pedido bastava tocar no outro, e a
 * aprovação virava enfeite. O botão volta SÓ pra quem já foi aprovado. */

const APROVADA = {
  veiculo_id: 'v1', pessoa_id: 'p1', situacao: 'aprovada',
  retirada_prevista: '2026-08-12T08:00:00Z', devolucao_prevista: '2026-08-12T18:00:00Z',
}
const pegar = (extra = {}) => reservaParaPegar({
  requisicoes: [APROVADA], veiculoId: 'v1', minhaPessoaId: 'p1',
  agoraIso: '2026-08-12T09:00:00Z', ...extra,
})

test('com reserva aprovada e na hora, dá pra pegar', () => {
  assert.equal(pegar()?.veiculo_id, 'v1')
})

test('reserva PENDENTE não acende o botão — é isso que impede furar a aprovação', () => {
  const r = reservaParaPegar({
    requisicoes: [{ ...APROVADA, situacao: 'pendente' }],
    veiculoId: 'v1', minhaPessoaId: 'p1', agoraIso: '2026-08-12T09:00:00Z',
  })
  assert.equal(r, null)
})

test('reserva de OUTRA pessoa não acende o botão pra mim', () => {
  assert.equal(pegar({ minhaPessoaId: 'p9' }), null)
})

test('reserva de OUTRO carro não acende neste', () => {
  assert.equal(pegar({ veiculoId: 'v9' }), null)
})

test('quem não foi achado no cadastro não pega por reserva nenhuma', () => {
  // `euId` nulo: sem saber quem é a pessoa, não dá pra dizer que a reserva é dela.
  assert.equal(pegar({ minhaPessoaId: null }), null)
})

test('carro JÁ na rua não acende "peguei" — o que falta é devolver', () => {
  assert.equal(pegar({ usoJaAberto: true }), null)
})

test('um pouco antes da hora marcada JÁ dá pra pegar', () => {
  // Reserva não é hora marcada: quem reservou pras 8h pega às 7h50.
  assert.equal(pegar({ agoraIso: '2026-08-12T07:50:00Z' })?.veiculo_id, 'v1')
})

test('cedo DEMAIS não acende — reserva de amanhã não é carro de hoje', () => {
  assert.equal(pegar({ agoraIso: '2026-08-11T10:00:00Z' }), null)
})

test('reserva velha não acende botão hoje', () => {
  // Sem isto, uma reserva de duas semanas atrás viraria autorização permanente.
  assert.equal(pegar({ agoraIso: '2026-08-26T09:00:00Z' }), null)
})

test('depois da devolução prevista ainda dá uma folga, mas não pra sempre', () => {
  assert.ok(pegar({ agoraIso: '2026-08-12T22:00:00Z' }), 'até 12h depois, ainda vale')
  assert.equal(pegar({ agoraIso: '2026-08-13T12:00:00Z' }), null, 'no dia seguinte, não')
})

test('reserva sem hora de volta vale a partir da retirada, com a mesma folga', () => {
  const r = reservaParaPegar({
    requisicoes: [{ ...APROVADA, devolucao_prevista: null }],
    veiculoId: 'v1', minhaPessoaId: 'p1', agoraIso: '2026-08-12T15:00:00Z',
  })
  assert.ok(r)
})

test('sem reserva nenhuma, sem botão', () => {
  assert.equal(reservaParaPegar({ requisicoes: [], veiculoId: 'v1', minhaPessoaId: 'p1' }), null)
  assert.equal(reservaParaPegar({}), null)
})

/* ── A reserva segura o carro (o defeito da Bravo Essence) ──────────────────
 *
 * Medido em 12/08/2026: a Bravo Essence tinha reserva APROVADA e em vigor até
 * 24/08 pro Felipe, e a tela continuava listando ela como livre pra pegar. */

const EMVIGOR = {
  veiculo_id: 'v1', situacao: 'aprovada',
  retirada_prevista: '2026-08-11T20:09:00Z', devolucao_prevista: '2026-08-24T20:09:00Z',
}
const segura = (extra = {}) => reservaSegurando({
  requisicoes: [EMVIGOR], veiculoId: 'v1', agoraIso: '2026-08-12T15:00:00Z', ...extra,
})

test('reserva aprovada e em vigor SEGURA o carro', () => {
  assert.ok(segura())
})

test('reserva PENDENTE não segura — o carro é de todos até alguém decidir', () => {
  // Travar por pedido que pode ser recusado deixaria a frota parada por engano.
  assert.equal(segura({ requisicoes: [{ ...EMVIGOR, situacao: 'pendente' }] }), null)
})

test('reserva RECUSADA não segura nada', () => {
  // O caso real: a Bravo tinha DUAS, uma aprovada e uma recusada.
  assert.equal(segura({ requisicoes: [{ ...EMVIGOR, situacao: 'recusada' }] }), null)
})

test('antes de começar e depois de acabar, o carro está livre', () => {
  assert.equal(segura({ agoraIso: '2026-08-10T10:00:00Z' }), null)
  assert.equal(segura({ agoraIso: '2026-08-25T10:00:00Z' }), null)
})

test('reserva de outro carro não segura este', () => {
  assert.equal(segura({ veiculoId: 'v9' }), null)
})

test('reserva sem hora de volta segura o dia inteiro, e só ele', () => {
  const r = [{ ...EMVIGOR, retirada_prevista: '2026-08-12T08:00:00Z', devolucao_prevista: null }]
  assert.ok(reservaSegurando({ requisicoes: r, veiculoId: 'v1', agoraIso: '2026-08-12T20:00:00Z' }))
  assert.equal(reservaSegurando({ requisicoes: r, veiculoId: 'v1', agoraIso: '2026-08-14T09:00:00Z' }), null)
})

test('reserva para pessoa DE FORA é válida — nome sem cadastro basta', () => {
  // O caso do Felipe: sem isto, o dono tinha de se pôr como motorista e
  // escrever a verdade na finalidade, e a multa cairia no nome errado.
  const p = problemasDaRequisicao(
    req({ pessoa_id: null, pessoa_nome: 'Felipe modelista' }), [], AGORA)
  assert.equal(bloqueios(p).length, 0)
})

test('sem colaborador E sem nome nenhum continua bloqueado', () => {
  const p = problemasDaRequisicao(req({ pessoa_id: null, pessoa_nome: '  ' }), [], AGORA)
  assert.ok(bloqueios(p).some((x) => /quem vai dirigir/i.test(x.texto)))
})

/* ── O que a pessoa vê em "Seus pedidos" ──────────────────────────────────── */

test('a recusa CHEGA em quem pediu, com o motivo escrito por quem recusou', () => {
  // O defeito (medido em 20/08/2026): a lista trazia só pendente e aprovada.
  // Quem recusa é OBRIGADO pela tela a escrever o motivo — "quem pediu precisa
  // saber o que fazer diferente" —, e esse motivo não chegava em ninguém: o
  // pedido simplesmente sumia da tela de quem pediu.
  const lista = meusPedidos({
    requisicoes: [
      { id: 'a', situacao: 'pendente', pessoa_id: 'p-eu', retirada_prevista: '2026-08-22T11:00Z' },
      { id: 'b', situacao: 'aprovada', pessoa_id: 'p-eu', retirada_prevista: '2026-08-21T11:00Z' },
      { id: 'c', situacao: 'recusada', pessoa_id: 'p-eu', retirada_prevista: '2026-08-23T11:00Z',
        decidida_em: '2026-08-20T09:00Z', motivo_decisao: 'A Strada já está com a equipe de Conchal.' },
    ],
    minhaPessoaId: 'p-eu',
    agoraIso: '2026-08-20T12:00Z',
  });
  assert.deepEqual(lista.map((r) => r.id), ['b', 'a', 'c'], 'ordenadas pela retirada, a mais próxima primeiro');
});

test('a reserva REVOGADA também chega — quem ia pegar o carro precisa saber', () => {
  // Revogada é a que já valia e alguém encerrou no meio. Sumir em silêncio faz
  // a pessoa ir até o estacionamento buscar um carro que não é mais dela.
  const lista = meusPedidos({
    requisicoes: [{
      id: 'r', situacao: 'revogada', pessoa_id: 'p-eu', retirada_prevista: '2026-08-21T11:00Z',
      encerrada_em: '2026-08-20T08:00Z', encerrada_motivo: 'O carro entrou na oficina.',
    }],
    minhaPessoaId: 'p-eu',
    agoraIso: '2026-08-20T12:00Z',
  });
  assert.equal(lista.length, 1);
});

test('recusa velha sai da frente sozinha, e a recente fica', () => {
  const recusa = (id, decidida) => ({
    id, situacao: 'recusada', pessoa_id: 'p-eu',
    retirada_prevista: '2026-08-10T11:00Z', decidida_em: decidida,
  });
  const lista = meusPedidos({
    requisicoes: [recusa('ontem', '2026-08-19T09:00Z'), recusa('mes-passado', '2026-07-15T09:00Z')],
    minhaPessoaId: 'p-eu',
    agoraIso: '2026-08-20T12:00Z',
  });
  assert.deepEqual(lista.map((r) => r.id), ['ontem'], 'a lista é um aviso, não um arquivo morto');
});

test('pedido dos outros não entra na minha lista, nem por engano', () => {
  const lista = meusPedidos({
    requisicoes: [
      { id: 'dele', situacao: 'pendente', pessoa_id: 'p-outro', retirada_prevista: '2026-08-22T11:00Z' },
      { id: 'que-eu-abri', situacao: 'pendente', pessoa_id: 'p-outro', criada_por: 'u-eu',
        retirada_prevista: '2026-08-23T11:00Z' },
    ],
    minhaPessoaId: 'p-eu', meuUsuarioId: 'u-eu',
    agoraIso: '2026-08-20T12:00Z',
  });
  // O pedido que EU abri pra outra pessoa continua meu de acompanhar: fui eu
  // que pedi, é a mim que a resposta interessa.
  assert.deepEqual(lista.map((r) => r.id), ['que-eu-abri']);
});

test('sem saber quem eu sou, a lista fica vazia — nunca a de outra pessoa', () => {
  const lista = meusPedidos({
    requisicoes: [{ id: 'x', situacao: 'pendente', pessoa_id: 'p-outro' }],
    agoraIso: '2026-08-20T12:00Z',
  });
  assert.deepEqual(lista, []);
});

test('a reserva CANCELADA por outra pessoa também chega em quem pediu', () => {
  // Cancelar exige permissão de aprovar (acoesDaReserva), então quem pediu
  // nunca cancela o próprio pedido pela tela: é sempre outra pessoa mexendo na
  // reserva alheia, com motivo obrigatório escrito. A primeira versão deixou
  // esta situação de fora por supor o contrário.
  const lista = meusPedidos({
    requisicoes: [{
      id: 'c', situacao: 'cancelada', pessoa_id: 'p-eu', retirada_prevista: '2026-08-23T11:00Z',
      encerrada_em: '2026-08-20T10:00Z', encerrada_motivo: 'A viagem foi adiada.',
    }],
    minhaPessoaId: 'p-eu',
    agoraIso: '2026-08-20T12:00Z',
  });
  assert.equal(lista.length, 1);
  assert.equal(lista[0].encerrada_motivo, 'A viagem foi adiada.');
});
