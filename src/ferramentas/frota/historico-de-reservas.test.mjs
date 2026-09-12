import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  SITUACOES_DO_HISTORICO, rotuloDaSituacao, corDaSituacao, resumoCurtoDaLinha, diaEmBrasilia,
  acoesDaReserva, porQueNaoDaEmPortugues, provaDaRetirada, copiaNoZoho,
  retiradaDaReserva, linhaDoTempo, filtrar, resumoDoHistorico, FILTROS, fraseDaPosse,
} from './historico-de-reservas.js'

const AGORA = '2026-08-13T15:00:00-03:00'
const daqui = (horas) => new Date(Date.parse(AGORA) + horas * 3600000).toISOString()

// ── As situações ───────────────────────────────────────────────────────────

test('revogada entra na lista de situações sem derrubar as antigas', () => {
  assert.equal(SITUACOES_DO_HISTORICO.revogada.rotulo, 'Revogada')
  assert.equal(SITUACOES_DO_HISTORICO.aprovada.rotulo, 'Aprovada')
  assert.equal(rotuloDaSituacao('cancelada'), 'Cancelada')
})

test('situação desconhecida não vira vazio na tela', () => {
  // Uma palavra nova no banco não pode virar um espaço em branco no card.
  assert.equal(rotuloDaSituacao('coisa-nova'), 'coisa-nova')
  assert.equal(rotuloDaSituacao(null), 'sem situação')
})

// ── O dia em Brasília ──────────────────────────────────────────────────────

test('retirada das 22h continua sendo do dia de hoje, não de amanhã', () => {
  // `toISOString()` puro daria 2026-08-14: às 22h em Brasília já é dia 14 em
  // UTC. A ficha de hoje nunca seria encontrada.
  assert.equal(diaEmBrasilia('2026-08-13T22:30:00-03:00'), '2026-08-13')
  assert.equal(diaEmBrasilia('2026-08-13T09:00:00-03:00'), '2026-08-13')
})

test('instante inválido não vira uma data plausível', () => {
  assert.equal(diaEmBrasilia('sei lá'), null)
  assert.equal(diaEmBrasilia(null), null)
})

// ── O que dá pra fazer ─────────────────────────────────────────────────────

const reserva = (extra = {}) => ({
  id: 'r1', veiculo_id: 'v1', pessoa_id: 'p1', pessoa_nome: 'Felipe',
  situacao: 'aprovada', retirada_prevista: daqui(24), devolucao_prevista: daqui(30),
  ...extra,
})

test('reserva futura se cancela, e não se revoga', () => {
  const a = acoesDaReserva({ requisicao: reserva(), temPermissaoAprovar: true, agoraIso: AGORA })
  assert.equal(a.cancelar.pode, true)
  assert.equal(a.revogar.pode, false)
  assert.equal(a.revogar.motivo, 'ainda-nao-comecou')
  assert.equal(a.editar.pode, true)
})

test('reserva que já começou se revoga, e não se cancela', () => {
  const a = acoesDaReserva({
    requisicao: reserva({ retirada_prevista: daqui(-2) }),
    temPermissaoAprovar: true, agoraIso: AGORA,
  })
  assert.equal(a.revogar.pode, true)
  assert.equal(a.cancelar.pode, false)
  assert.equal(a.cancelar.motivo, 'ja-comecou')
})

test('as duas nunca aparecem juntas', () => {
  // Uma ação principal por bloco: dois botões quase iguais lado a lado fazem a
  // pessoa escolher no chute.
  for (const h of [-48, -1, 0.5, 24, 240]) {
    const a = acoesDaReserva({
      requisicao: reserva({ retirada_prevista: daqui(h) }),
      temPermissaoAprovar: true, agoraIso: AGORA,
    })
    assert.notEqual(a.cancelar.pode, a.revogar.pode, `com retirada em ${h}h as duas coincidiram`)
  }
})

test('reserva que já virou viagem não se edita nem se cancela — só se revoga', () => {
  const a = acoesDaReserva({
    requisicao: reserva({ uso_id: 'u1', retirada_prevista: daqui(24) }),
    temPermissaoAprovar: true, agoraIso: AGORA,
  })
  assert.equal(a.editar.pode, false)
  assert.equal(a.editar.motivo, 'ja-virou-viagem')
  assert.equal(a.cancelar.pode, false)
  assert.equal(a.revogar.pode, true)
})

test('reserva encerrada não aceita nenhuma das três', () => {
  for (const s of ['recusada', 'cancelada', 'revogada', 'usada']) {
    const a = acoesDaReserva({
      requisicao: reserva({ situacao: s }), temPermissaoAprovar: true, agoraIso: AGORA,
    })
    for (const acao of ['editar', 'cancelar', 'revogar']) {
      assert.equal(a[acao].pode, false, `${acao} continuou liberada com situação ${s}`)
      assert.equal(a[acao].motivo, 'ja-encerrada')
    }
  }
})

test('sem a permissão de aprovar, nenhuma das três aparece', () => {
  const a = acoesDaReserva({ requisicao: reserva(), temPermissaoAprovar: false, agoraIso: AGORA })
  for (const acao of ['editar', 'cancelar', 'revogar']) {
    assert.equal(a[acao].pode, false)
    assert.equal(a[acao].motivo, 'sem-permissao')
  }
})

test('reserva sem hora de retirada cai no lado reversível', () => {
  // Na dúvida a tela oferece a ação menos grave. Revogar libera o carro na
  // hora; cancelar só desmarca o que ainda não começou.
  const a = acoesDaReserva({
    requisicao: reserva({ retirada_prevista: null }), temPermissaoAprovar: true, agoraIso: AGORA,
  })
  assert.equal(a.cancelar.pode, true)
  assert.equal(a.revogar.pode, false)
})

test('todo motivo tem frase escrita — nenhum botão some calado', () => {
  for (const m of ['sem-permissao', 'ja-encerrada', 'ja-virou-viagem', 'ja-comecou', 'ainda-nao-comecou']) {
    const frase = porQueNaoDaEmPortugues(m, 'cancelada')
    assert.ok(frase.length > 20, `o motivo ${m} saiu sem frase`)
  }
})

// ── A prova ────────────────────────────────────────────────────────────────

const uso = (extra = {}) => ({
  id: 'u1', veiculo_id: 'v1', pessoa_id: 'p1', pessoa_nome: 'Breno',
  saida_em: '2026-08-07T17:49:00-03:00', ...extra,
})
const ficha = (extra = {}) => ({
  id: 'f1', veiculo_id: 'v1', feita_em: '2026-08-07',
  pessoa_id: 'p9', pessoa_nome: 'Erick Martins', assinada_em: '2026-08-07T07:30:00-03:00', ...extra,
})

test('O CASO REAL DE 07/08: assinou Erick, pegou Breno — a tela não pode dizer "assinado"', () => {
  // Este é o achado que motivou a entrega inteira. Um "✔ assinado" aqui seria
  // uma mentira: a assinatura existe, mas não é de quem pegou o carro.
  const p = provaDaRetirada({ uso: uso(), fichas: [ficha()] })
  assert.equal(p.estado, 'assinada-por-outra')
  assert.match(p.frase, /Erick Martins/)
  assert.match(p.frase, /Breno/)
  assert.match(p.frase, /Não ficou assinatura de quem pegou/i)
})

test('mesma pessoa conferindo e pegando: uma assinatura basta', () => {
  const p = provaDaRetirada({ uso: uso({ pessoa_id: 'p9' }), fichas: [ficha()] })
  assert.equal(p.estado, 'assinada-por-quem-pegou')
})

test('sem id nos dois lados, o nome decide', () => {
  const p = provaDaRetirada({
    uso: uso({ pessoa_id: null, pessoa_nome: 'erick martins' }),
    fichas: [ficha({ pessoa_id: null })],
  })
  assert.equal(p.estado, 'assinada-por-quem-pegou')
})

test('nome vazio dos dois lados NÃO faz duas pessoas virarem a mesma', () => {
  const p = provaDaRetirada({
    uso: uso({ pessoa_id: null, pessoa_nome: '' }),
    fichas: [ficha({ pessoa_id: null, pessoa_nome: '  ' })],
  })
  assert.equal(p.estado, 'assinada-por-outra')
})

test('o aceite de retirada vence tudo: é a assinatura de quem pegou', () => {
  const p = provaDaRetirada({
    uso: uso({ aceite_em: '2026-08-07T17:49:30-03:00', aceite_nome: 'Breno' }),
    fichas: [ficha()],
  })
  assert.equal(p.estado, 'aceite')
  assert.match(p.frase, /Breno assinou o aceite/)
})

test('dia sem checklist nenhum: a tela diz que não ficou prova', () => {
  const p = provaDaRetirada({ uso: uso(), fichas: [] })
  assert.equal(p.estado, 'sem-ficha')
  assert.match(p.frase, /prova nenhuma/)
})

test('ficha preenchida e não assinada não conta como assinada', () => {
  const p = provaDaRetirada({ uso: uso(), fichas: [ficha({ assinada_em: null })] })
  assert.equal(p.estado, 'ficha-sem-assinatura')
})

test('a ficha do OUTRO carro no mesmo dia não serve de prova', () => {
  const p = provaDaRetirada({ uso: uso(), fichas: [ficha({ veiculo_id: 'v2' })] })
  assert.equal(p.estado, 'sem-ficha')
})

test('a ficha do MESMO carro em outro dia não serve de prova', () => {
  const p = provaDaRetirada({ uso: uso(), fichas: [ficha({ feita_em: '2026-08-06' })] })
  assert.equal(p.estado, 'sem-ficha')
})

// ── A cópia no Zoho ────────────────────────────────────────────────────────

test('cópia enviada: a tela diz que chegou', () => {
  const z = copiaNoZoho({ checklistId: 'f1', copias: [{ checklist_id: 'f1', situacao: 'enviado' }] })
  assert.equal(z.estado, 'chegou')
})

test('espera não é problema', () => {
  const z = copiaNoZoho({ checklistId: 'f1', copias: [{ checklist_id: 'f1', situacao: 'na_fila' }] })
  assert.equal(z.estado, 'esperando')
})

test('tropeçou é diferente de desistiu — o robô ainda está tentando', () => {
  const tropecou = copiaNoZoho({
    checklistId: 'f1',
    copias: [{ checklist_id: 'f1', situacao: 'na_fila', ultimo_erro: 'Abra Acessos e reconecte o Zoho.' }],
  })
  assert.equal(tropecou.estado, 'tropecou')
  assert.match(tropecou.frase, /Abra Acessos e reconecte o Zoho\./)

  const desistiu = copiaNoZoho({
    checklistId: 'f1',
    copias: [{ checklist_id: 'f1', situacao: 'falhou', ultimo_erro: 'Abra Acessos e reconecte o Zoho.' }],
  })
  assert.equal(desistiu.estado, 'desistiu')
  // A frase do robô sai como ele escreveu: ela já diz o que fazer.
  assert.match(desistiu.frase, /Abra Acessos e reconecte o Zoho\./)
})

// ── O elo entre reserva e retirada ─────────────────────────────────────────

test('uso_id manda, quando existe', () => {
  const u = uso({ id: 'u7' })
  assert.equal(retiradaDaReserva({ requisicao: reserva({ uso_id: 'u7' }), usos: [u] }), u)
})

test('sem uso_id, casa pela mesma janela que autoriza a retirada', () => {
  const r = reserva({ retirada_prevista: '2026-08-07T17:00:00-03:00', devolucao_prevista: null })
  const u = uso({ pessoa_id: 'p1' })
  assert.equal(retiradaDaReserva({ requisicao: r, usos: [u] }), u)
})

test('NÃO casa a reserva de um com a saída de outro', () => {
  // Casar por engano seria pior que não casar: o histórico afirmaria que
  // alguém pegou o carro com uma autorização que nunca usou.
  const r = reserva({ retirada_prevista: '2026-08-07T17:00:00-03:00' })
  const u = uso({ pessoa_id: 'p2', pessoa_nome: 'Barbara' })
  assert.equal(retiradaDaReserva({ requisicao: r, usos: [u] }), null)
})

test('NÃO casa saída fora da janela', () => {
  const r = reserva({ retirada_prevista: '2026-08-01T09:00:00-03:00', devolucao_prevista: null })
  const u = uso({ pessoa_id: 'p1' })   // saiu em 07/08, seis dias depois
  assert.equal(retiradaDaReserva({ requisicao: r, usos: [u] }), null)
})

test('reserva não aprovada não casa com saída nenhuma', () => {
  const r = reserva({ situacao: 'recusada', retirada_prevista: '2026-08-07T17:00:00-03:00' })
  assert.equal(retiradaDaReserva({ requisicao: r, usos: [uso({ pessoa_id: 'p1' })] }), null)
})

test('duas saídas cabendo na janela: fica a mais perto da hora marcada', () => {
  const r = reserva({ retirada_prevista: '2026-08-07T17:00:00-03:00', devolucao_prevista: null })
  const longe = uso({ id: 'longe', pessoa_id: 'p1', saida_em: '2026-08-07T09:00:00-03:00' })
  const perto = uso({ id: 'perto', pessoa_id: 'p1', saida_em: '2026-08-07T17:49:00-03:00' })
  assert.equal(retiradaDaReserva({ requisicao: r, usos: [longe, perto] }).id, 'perto')
})

// ── A linha do tempo ───────────────────────────────────────────────────────

const cenarioReal = () => ({
  veiculos: [{ id: 'v1', nome: 'BMW X1', placa: 'ABC-1234' }],
  requisicoes: [reserva({ id: 'r1', situacao: 'aprovada', retirada_prevista: '2026-08-11T17:09:00-03:00' })],
  usos: [uso({ id: 'u1', saida_em: '2026-08-07T17:49:00-03:00' })],
  fichas: [ficha()],
  copias: [{ checklist_id: 'f1', situacao: 'enviado' }],
  temPermissaoAprovar: true,
  agoraIso: AGORA,
})

test('a retirada sem reserva aparece — senão a tela mostraria menos do que aconteceu', () => {
  const linhas = linhaDoTempo(cenarioReal())
  assert.equal(linhas.length, 2)
  const avulsa = linhas.find((l) => l.tipo === 'retirada')
  assert.ok(avulsa, 'a retirada sem reserva sumiu da lista')
  assert.equal(avulsa.situacao, 'sem-reserva')
  assert.equal(avulsa.veiculoNome, 'BMW X1')
})

test('a retirada que JÁ está numa reserva não aparece duas vezes', () => {
  const c = cenarioReal()
  c.requisicoes = [reserva({ uso_id: 'u1' })]
  const linhas = linhaDoTempo(c)
  assert.equal(linhas.length, 1)
  assert.equal(linhas[0].tipo, 'reserva')
  assert.equal(linhas[0].uso.id, 'u1')
})

test('carro apagado do cadastro não deixa a linha sem nome', () => {
  const c = cenarioReal()
  c.veiculos = []
  assert.match(linhaDoTempo(c)[0].veiculoNome, /saiu do cadastro/)
})

test('a linha traz a prova e o estado da cópia no Zoho juntos', () => {
  const c = cenarioReal()
  c.requisicoes = [reserva({ uso_id: 'u1' })]
  const l = linhaDoTempo(c)[0]
  assert.equal(l.prova.estado, 'assinada-por-outra')
  assert.equal(l.zoho.estado, 'chegou')
})

test('mais novo primeiro', () => {
  const c = cenarioReal()
  c.usos = [
    uso({ id: 'velho', saida_em: '2026-08-01T10:00:00-03:00' }),
    uso({ id: 'novo', saida_em: '2026-08-12T10:00:00-03:00' }),
  ]
  c.requisicoes = []
  assert.deepEqual(linhaDoTempo(c).map((l) => l.uso.id), ['novo', 'velho'])
})

// ── O filtro e o resumo ────────────────────────────────────────────────────

test('o filtro "sem assinatura" é o que responde a pergunta do dono', () => {
  const linhas = linhaDoTempo(cenarioReal())
  const semAssinatura = filtrar(linhas, 'sem-assinatura')
  // As duas: a reserva não casou com retirada nenhuma (então não tem prova) e
  // a retirada avulsa foi assinada por outra pessoa.
  assert.equal(semAssinatura.length, 1)
  assert.equal(semAssinatura[0].prova.estado, 'assinada-por-outra')
})

test('todo filtro da barra devolve uma lista, nunca undefined', () => {
  const linhas = linhaDoTempo(cenarioReal())
  for (const f of FILTROS) {
    assert.ok(Array.isArray(filtrar(linhas, f.chave)), `o filtro ${f.chave} não devolveu lista`)
  }
  assert.ok(Array.isArray(filtrar(linhas, 'palavra-que-nao-existe')))
})

test('o filtro não muda a lista original', () => {
  const linhas = linhaDoTempo(cenarioReal())
  filtrar(linhas, 'tudo').pop()
  assert.equal(linhas.length, 2)
})

test('o resumo conta o que importa: retirada sem assinatura de quem pegou', () => {
  const linhas = linhaDoTempo(cenarioReal())
  assert.match(resumoDoHistorico(linhas), /1 retirada ficou sem assinatura/)
})

test('lista vazia não vira número nem frase de erro', () => {
  assert.match(resumoDoHistorico([]), /Nenhuma reserva e nenhuma retirada/)
})

test('tudo assinado por quem pegou: o resumo diz isso, e não fica calado', () => {
  const c = cenarioReal()
  c.requisicoes = []
  c.usos = [uso({ aceite_em: '2026-08-07T17:49:30-03:00', aceite_nome: 'Breno' })]
  assert.match(resumoDoHistorico(linhaDoTempo(c)), /Todas as retiradas têm assinatura/)
})

// ── D1: POSSE NÃO É RETIRADA ───────────────────────────────────────────────
//
// O defeito que estes testes travam, medido em 19/08/2026 na tela no ar:
// `frota_uso` tinha 12 linhas, 11 delas `tipo='posse'` (carro fixo com o dono),
// e a linha do tempo percorria TODAS sem olhar o tipo. Resultado: 11 dos 13
// cartões eram carro parado se passando por viagem, 8 diziam "ainda não
// voltou", 7 diziam "motorista não informado", e o título da gaveta acusava
// "12 retiradas ficaram sem assinatura" quando houve UMA viagem.
//
// É a família de defeito que esta central já pagou caro: falha virando número.

const posse = (extra = {}) => ({
  id: 'po1', veiculo_id: 'v1', pessoa_id: 'p7', pessoa_nome: null,
  saida_em: '2026-08-06T12:56:00-03:00', volta_em: null, tipo: 'posse', ...extra,
})
const cenarioComPosse = (extra = {}) => ({
  ...cenarioReal(),
  requisicoes: [],
  usos: [posse()],
  nomeDaPessoa: (id) => (id === 'p7' ? 'Humberto Mendonça' : null),
  ...extra,
})

test('D1 · carro fixo vira linha de POSSE, não de retirada', () => {
  const linhas = linhaDoTempo(cenarioComPosse())
  assert.equal(linhas.length, 1)
  assert.equal(linhas[0].tipo, 'posse')
  assert.notEqual(linhas[0].situacao, 'sem-reserva')
})

test('D1 · posse aberta diz COM QUEM e DESDE QUANDO — nunca "ainda não voltou"', () => {
  const l = linhaDoTempo(cenarioComPosse())[0]
  assert.equal(l.situacao, 'posse-aberta')
  assert.equal(l.posse.quem, 'Humberto Mendonça')
  assert.equal(l.posse.ate, null)
  assert.ok(l.posse.desde, 'a posse aberta tem que dizer desde quando')
})

test('D1 · posse encerrada diz de quando até quando', () => {
  const c = cenarioComPosse({ usos: [posse({ volta_em: '2026-08-11T12:37:00-03:00' })] })
  const l = linhaDoTempo(c)[0]
  assert.equal(l.situacao, 'posse-encerrada')
  assert.ok(l.posse.ate, 'a posse encerrada tem que dizer até quando')
})

test('D1 · posse sem nome no uso pega o nome do DONO do veículo', () => {
  // 7 das 11 posses reais tinham `pessoa_nome` nulo (foram importadas antes do
  // campo existir) e a tela escrevia "motorista não informado" pra todas.
  const c = cenarioComPosse({ veiculos: [{ id: 'v1', nome: 'VOLVO XC60', placa: 'BDN3A67', pessoa_id: 'p7' }] })
  assert.equal(linhaDoTempo(c)[0].posse.quem, 'Humberto Mendonça')
})

test('D1 · veículo sem dono fixo NÃO ganha um nome inventado', () => {
  // O FIAT BRAVO ESSENCE é de propósito sem dono fixo (decisão do dono).
  const c = cenarioComPosse({
    veiculos: [{ id: 'v1', nome: 'FIAT BRAVO ESSENCE', placa: 'OLW4I46', pessoa_id: null }],
    nomeDaPessoa: () => null,
  })
  assert.equal(linhaDoTempo(c)[0].posse.quem, null)
})

test('D1 · posse não tem prova de retirada — não há retirada para assinar', () => {
  assert.equal(linhaDoTempo(cenarioComPosse())[0].prova, null)
})

test('D1 · posse NÃO conta como "sem assinatura"', () => {
  // Era daqui que saía o "12 sem assinatura" do título da gaveta.
  const linhas = linhaDoTempo(cenarioComPosse())
  assert.equal(filtrar(linhas, 'sem-assinatura').length, 0)
})

test('D1 · a frase do topo não acusa posse de retirada sem assinatura', () => {
  const frase = resumoDoHistorico(linhaDoTempo(cenarioComPosse()))
  assert.doesNotMatch(frase, /retiradas? fic(ou|aram) sem assinatura/)
})

test('D1 · "Tudo" mostra reserva e retirada, e deixa o carro fixo fora', () => {
  const c = cenarioComPosse({ requisicoes: [reserva({ id: 'r1' })], usos: [posse(), uso({ id: 'u1' })] })
  const linhas = linhaDoTempo(c)
  const tudo = filtrar(linhas, 'tudo')
  assert.equal(tudo.some((l) => l.tipo === 'posse'), false, 'posse não entra no Tudo')
  assert.equal(tudo.length, 2)
})

test('D1 · o filtro "carro-fixo" traz só as posses', () => {
  const c = cenarioComPosse({ usos: [posse(), uso({ id: 'u1' })] })
  const fixos = filtrar(linhaDoTempo(c), 'carro-fixo')
  assert.equal(fixos.length, 1)
  assert.equal(fixos[0].tipo, 'posse')
})

test('D1 · a barra de filtros ganha "Carro fixo", e "Sem reserva" vira frase de gente', () => {
  const chaves = FILTROS.map((f) => f.chave)
  assert.ok(chaves.includes('carro-fixo'), 'falta o filtro de carro fixo')
  assert.equal(FILTROS.find((f) => f.chave === 'sem-reserva').rotulo, 'Pegou sem reservar')
})

test('D1 · uso SEM tipo continua sendo retirada, não vira posse por engano', () => {
  // Guarda contra o erro oposto: uma linha sem `tipo` (ou com tipo novo que
  // ninguém previu) não pode sumir do "Tudo" achando que é carro parado.
  const c = cenarioComPosse({ usos: [uso({ id: 'u1', tipo: undefined })] })
  assert.equal(linhaDoTempo(c)[0].tipo, 'retirada')
})

test('D1 · a frase da posse aberta diz com quem e desde quando', () => {
  const l = linhaDoTempo(cenarioComPosse())[0]
  assert.equal(fraseDaPosse(l), 'Fixo com Humberto Mendonça desde 06/08.')
})

test('D1 · a frase da posse encerrada diz de quando até quando', () => {
  const c = cenarioComPosse({ usos: [posse({ pessoa_nome: 'Gabriel Alves', volta_em: '2026-08-11T12:37:00-03:00' })] })
  assert.equal(fraseDaPosse(linhaDoTempo(c)[0]), 'Esteve fixo com Gabriel Alves de 06/08 a 11/08.')
})

test('D1 · sem dono fixo, a frase DIZ isso — não deixa um buraco nem inventa nome', () => {
  const c = cenarioComPosse({
    veiculos: [{ id: 'v1', nome: 'FIAT BRAVO ESSENCE', placa: 'OLW4I46', pessoa_id: null }],
    nomeDaPessoa: () => null,
  })
  assert.equal(fraseDaPosse(linhaDoTempo(c)[0]), 'Sem dono fixo registrado, desde 06/08.')
})

test('D1 · a frase da posse nunca contém "ainda não voltou"', () => {
  // O pedido do dono, em uma linha. Posse não volta — é isso que ela é.
  for (const c of [cenarioComPosse(), cenarioComPosse({ usos: [posse({ volta_em: '2026-08-11T12:37:00-03:00' })] })]) {
    assert.doesNotMatch(fraseDaPosse(linhaDoTempo(c)[0]), /não voltou/)
  }
})

// ── D4: ARQUIVAR SAI DA TELA, NÃO SAI DO BANCO ─────────────────────────────
//
// Pedido do dono (19/08/2026): "solicitações recusadas eu quero poder excluir
// para limpar espaço". Escolha dele, depois de ver o que se perderia: ARQUIVAR.
// Uma recusada guarda quem pediu, quem recusou e por quê — apagar limparia a
// tela e destruiria a única resposta pra "por que negaram o carro pra mim?".
//
// A trava de verdade mora no banco (migration 047, provada com rollback). Isto
// aqui é a metade da tela: o que ela OFERECE, e o que ela esconde.

const encerrada = (extra = {}) => reserva({ situacao: 'recusada', motivo_decisao: 'Duplicado', ...extra })

test('D4 · recusada pode ser arquivada', () => {
  const a = acoesDaReserva({ requisicao: encerrada(), temPermissaoAprovar: true, agoraIso: AGORA })
  assert.equal(a.arquivar.pode, true)
})

test('D4 · cancelada e revogada também — as três são o que já acabou', () => {
  for (const s of ['cancelada', 'revogada']) {
    const a = acoesDaReserva({ requisicao: encerrada({ situacao: s }), temPermissaoAprovar: true, agoraIso: AGORA })
    assert.equal(a.arquivar.pode, true, `${s} devia poder arquivar`)
  }
})

test('D4 · PENDENTE nunca se arquiva — sumiria da fila sem ter sido decidida', () => {
  const a = acoesDaReserva({ requisicao: reserva({ situacao: 'pendente' }), temPermissaoAprovar: true, agoraIso: AGORA })
  assert.equal(a.arquivar.pode, false)
  assert.equal(a.arquivar.motivo, 'ainda-em-aberto')
})

test('D4 · aprovada também não — o carro ainda pode sair com ela', () => {
  const a = acoesDaReserva({ requisicao: reserva({ situacao: 'aprovada' }), temPermissaoAprovar: true, agoraIso: AGORA })
  assert.equal(a.arquivar.pode, false)
  assert.equal(a.arquivar.motivo, 'ainda-em-aberto')
})

test('D4 · quem não aprova não arquiva', () => {
  const a = acoesDaReserva({ requisicao: encerrada(), temPermissaoAprovar: false, agoraIso: AGORA })
  assert.equal(a.arquivar.pode, false)
  assert.equal(a.arquivar.motivo, 'sem-permissao')
})

test('D4 · já arquivada não se arquiva de novo — oferece desarquivar', () => {
  const r = encerrada({ arquivada_em: '2026-08-19T12:00:00-03:00' })
  const a = acoesDaReserva({ requisicao: r, temPermissaoAprovar: true, agoraIso: AGORA })
  assert.equal(a.arquivar.pode, false)
  assert.equal(a.arquivar.motivo, 'ja-arquivada')
  assert.equal(a.desarquivar.pode, true)
})

test('D4 · o que não está arquivado não oferece desarquivar', () => {
  const a = acoesDaReserva({ requisicao: encerrada(), temPermissaoAprovar: true, agoraIso: AGORA })
  assert.equal(a.desarquivar.pode, false)
})

test('D4 · os dois motivos novos têm frase de gente, não código', () => {
  for (const m of ['ainda-em-aberto', 'ja-arquivada']) {
    const frase = porQueNaoDaEmPortugues(m, 'pendente')
    assert.ok(frase.length > 20, `o motivo ${m} ficou sem frase`)
    assert.doesNotMatch(frase, /-/, `a frase de ${m} está devolvendo o código`)
  }
})

test('D4 · a linha diz se está arquivada', () => {
  const c = { ...cenarioReal(), usos: [], requisicoes: [encerrada({ arquivada_em: '2026-08-19T12:00:00-03:00' })] }
  assert.equal(linhaDoTempo(c)[0].arquivada, true)
})

test('D4 · arquivada SOME do "Tudo" — é isso que limpa o espaço', () => {
  const c = { ...cenarioReal(), usos: [],
    requisicoes: [encerrada({ id: 'r1', arquivada_em: '2026-08-19T12:00:00-03:00' }), reserva({ id: 'r2' })] }
  const tudo = filtrar(linhaDoTempo(c), 'tudo')
  assert.equal(tudo.length, 1)
  assert.equal(tudo[0].reserva.id, 'r2')
})

test('D4 · o filtro "arquivadas" traz só o que foi arquivado', () => {
  const c = { ...cenarioReal(), usos: [],
    requisicoes: [encerrada({ id: 'r1', arquivada_em: '2026-08-19T12:00:00-03:00' }), reserva({ id: 'r2' })] }
  const arq = filtrar(linhaDoTempo(c), 'arquivadas')
  assert.equal(arq.length, 1)
  assert.equal(arq[0].reserva.id, 'r1')
})

test('D4 · arquivada não some do filtro da própria situação — ela não deixou de ser recusada', () => {
  // "Sumiu do Tudo" é limpeza de tela. "Sumiu do banco" seria outra coisa, e
  // quem for conferir as recusadas tem de continuar achando esta.
  const c = { ...cenarioReal(), usos: [], requisicoes: [encerrada({ arquivada_em: '2026-08-19T12:00:00-03:00' })] }
  assert.equal(filtrar(linhaDoTempo(c), 'encerrada').length, 1)
})

test('D4 · a barra de filtros ganha "Arquivadas"', () => {
  assert.ok(FILTROS.map((f) => f.chave).includes('arquivadas'))
})

test('D4 · arquivada não entra na conta da frase do topo', () => {
  const c = { ...cenarioReal(), usos: [], requisicoes: [encerrada({ arquivada_em: '2026-08-19T12:00:00-03:00' })] }
  assert.match(resumoDoHistorico(linhaDoTempo(c)), /Nenhuma reserva e nenhuma retirada/)
})

test('a cor do selo é sempre uma que existe no CSS', () => {
  // `SITUACOES['revogada']` é undefined — ler `.cor` dele na tela derruba o
  // bloco inteiro. E 'info'/'neutro' (os estados de posse) não têm classe
  // nenhuma no CSS: chegariam como selo sem cor.
  assert.equal(corDaSituacao('pendente'), 'espera')
  assert.equal(corDaSituacao('aprovada'), 'boa')
  assert.equal(corDaSituacao('recusada'), 'ruim')
  assert.equal(corDaSituacao('revogada'), 'ruim')
  assert.equal(corDaSituacao('posse-aberta'), 'neutra', "'info' não existe no CSS")
  assert.equal(corDaSituacao('coisa-que-nao-existe'), 'neutra')
  assert.equal(corDaSituacao(null), 'neutra')
})

test('a linha fechada diz quem, quando e para onde — numa frase só', () => {
  // O card passou a abrir sob demanda; fechado, ele precisa continuar
  // respondendo o básico. Linha que some e não diz nada obriga a abrir uma por
  // uma pra achar a que interessa.
  const frase = resumoCurtoDaLinha({
    tipo: 'reserva', situacao: 'usada', quando: Date.parse('2026-08-21T12:03:00Z'),
    reserva: { pessoa_nome: 'Erick Martins', destino: 'Conchal' },
  }, () => '21/08 às 09:03')
  assert.equal(frase, 'Erick Martins · 21/08 às 09:03 · Conchal')
})

test('sem destino, a frase não inventa nem deixa separador solto', () => {
  const frase = resumoCurtoDaLinha({
    tipo: 'retirada', situacao: 'usada', quando: Date.parse('2026-08-21T12:03:00Z'),
    uso: { pessoa_nome: 'Thiago Siqueira' },
  }, () => '21/08 às 09:03')
  assert.equal(frase, 'Thiago Siqueira · 21/08 às 09:03')
})

test('sem nada, a frase ainda diz o que a linha é', () => {
  // Vazio parece defeito de carregamento.
  assert.equal(resumoCurtoDaLinha({ situacao: 'revogada' }), 'Revogada')
  assert.equal(resumoCurtoDaLinha({}), 'sem situação')
  assert.equal(resumoCurtoDaLinha(null), 'sem situação')
})
