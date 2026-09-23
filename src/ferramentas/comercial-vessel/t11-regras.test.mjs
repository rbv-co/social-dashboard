import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  ESTAGIOS_DA_STYLIST, ESTAGIOS_AUTOMATICOS, estagiosDeEscolher, seloDoEstagio,
  ORIGENS_DE_CONTATO, STATUS_DO_ENCONTRO, precisaDeMotivo, seloDoStatus,
  mensagemDeSituacaoDoEncontro, SITUACOES_DO_CONVITE, seloDoConvite, gestosDaConvidada,
  problemasDaConvidada, mensagemDeConvidar, telefoneLegivel, avisoDos45Dias,
  periodoDoPlacar, taxasDoPlacar, legendaDaTaxa, proximaDataPermitidaDaLista, tomDaStylist,
} from './t11-regras.js'

// ⚠️ AS LISTAS DA TELA TÊM DE SER AS LISTAS DO BANCO, letra por letra. Lidas
// do próprio arquivo da migration: redigitar aqui seria uma terceira cópia.
const MIGRATION = readFileSync(new URL(
  '../../../db/migrations/2026-09-22-vessel-t11-bases-do-stylist-circle.sql', import.meta.url), 'utf8')
const listaDoCheck = (nome) => {
  const i = MIGRATION.indexOf(`add constraint ${nome}`)
  assert.ok(i >= 0, `não achei o CHECK ${nome} na migration`)
  const trecho = MIGRATION.slice(i, MIGRATION.indexOf(';', i))
  return [...trecho.matchAll(/'([a-z_]+)'/g)].map((m) => m[1])
}

test('o funil da tela é exatamente o CHECK do banco', () => {
  assert.deepEqual(Object.keys(ESTAGIOS_DA_STYLIST).sort(),
    listaDoCheck('vessel_stylists_estagio_valido').sort())
})

test('a situação do encontro é exatamente o CHECK do banco', () => {
  assert.deepEqual(Object.keys(STATUS_DO_ENCONTRO).sort(),
    listaDoCheck('vessel_private_edits_status_valido').sort())
})

test('a origem do contato é exatamente o CHECK do banco', () => {
  assert.deepEqual(Object.keys(ORIGENS_DE_CONTATO).sort(),
    listaDoCheck('vessel_stylists_origem_contato_valida').sort())
})

test('a situação do convite cobre tudo o que o banco calcula', () => {
  const i = MIGRATION.indexOf('function public.vessel_situacao_do_convite')
  const corpo = MIGRATION.slice(i, MIGRATION.indexOf('$$;', i))
  const doBanco = [...new Set([...corpo.matchAll(/(?:then|else) '([a-z_]+)'/g)].map((m) => m[1]))]
  assert.ok(doBanco.length >= 7)
  for (const s of doBanco) assert.ok(SITUACOES_DO_CONVITE[s], `sem rótulo para ${s}`)
})

test('os três degraus automáticos nunca aparecem para escolher', () => {
  for (const ativada of [null, '2026-09-22T12:00:00Z']) {
    const lista = estagiosDeEscolher(ativada)
    for (const a of ESTAGIOS_AUTOMATICOS) assert.ok(!lista.includes(a), `${a} apareceu`)
  }
})

test('quem já teve encontro não volta para antes dele, e só pausa ou inativa', () => {
  // "Sem retorno"/"Não interessado" o gatilho do banco desfaz calado para
  // quem já ativou — oferecer seria um botão que não fica.
  const lista = estagiosDeEscolher('2026-09-22T12:00:00Z')
  assert.deepEqual(lista, ['pausado', 'inativo'])
  assert.ok(estagiosDeEscolher(null).includes('contatado'))
})

test('selo do estágio: desconhecido não some, vira o próprio texto', () => {
  assert.equal(seloDoEstagio('recorrente').classe, 'cv-selo-viva')
  assert.equal(seloDoEstagio('pausado').classe, 'cv-selo-fim')
  assert.equal(seloDoEstagio('xyz').texto, 'xyz')
  assert.equal(seloDoEstagio(null).texto, 'Sem estágio')
})

test('motivo só é exigido para cancelado e não realizado', () => {
  assert.equal(precisaDeMotivo('cancelado'), true)
  assert.equal(precisaDeMotivo('nao_realizado'), true)
  for (const s of ['agendado', 'realizado', 'reagendado']) assert.equal(precisaDeMotivo(s), false)
})

test('selo do encontro: arquivada vence o status', () => {
  assert.equal(seloDoStatus({ arquivada: true, status: 'realizado' }).texto, 'Arquivada')
  assert.equal(seloDoStatus({ status: 'cancelado' }).classe, 'cv-selo-fim')
  assert.equal(seloDoStatus({}).texto, 'Agendado')
})

test('cada recusa da situação do encontro tem a sua frase', () => {
  for (const s of ['sem_permissao', 'nao_achei', 'status_invalido', 'sem_motivo', 'realizado_no_futuro']) {
    const f = mensagemDeSituacaoDoEncontro(s)
    assert.ok(f && !/tente de novo em um instante/.test(f), `${s} caiu na frase genérica`)
  }
  assert.ok(mensagemDeSituacaoDoEncontro('???'))
})

test('gestos da convidada: nunca oferece o que já está marcado', () => {
  const nova = gestosDaConvidada({ status: 'solicitado' }).map((g) => g.gesto)
  assert.deepEqual(nova, ['enviado', 'sim', 'nao', 'realizado', 'no_show'])
  const enviada = gestosDaConvidada({ status: 'solicitado', convite_enviado_em: 'x' }).map((g) => g.gesto)
  assert.ok(!enviada.includes('enviado'))
  const veio = gestosDaConvidada({ status: 'realizado', rsvp: 'sim' }).map((g) => g.gesto)
  // ⚠️ Quem veio ainda pode ser corrigida para "não veio" — engano da gerente.
  assert.deepEqual(veio, ['no_show'])
})

test('convidada: nome e WhatsApp com DDD obrigatórios; e-mail só se escrito', () => {
  assert.deepEqual(problemasDaConvidada({ nome: 'Ana', whatsapp: '(19) 99999-0000' }), [])
  assert.equal(problemasDaConvidada({ nome: '', whatsapp: '999990000' }).length, 2)
  assert.equal(problemasDaConvidada({ nome: 'Ana', whatsapp: '19999990000', email: 'ana@' }).length, 1)
})

test('convidar: "já estava" não é erro, é a mesma cadeira', () => {
  assert.match(mensagemDeConvidar('ja_estava'), /mesma convidada/)
  assert.match(mensagemDeConvidar('encontro_fechado'), /cancelado ou arquivado/)
})

test('telefone legível não inventa dígito', () => {
  assert.equal(telefoneLegivel('5519999990000'), '(19) 99999-0000')
  assert.equal(telefoneLegivel('551933330000'), '(19) 3333-0000')
  assert.equal(telefoneLegivel('123'), '123')
})

test('45 dias: avisa antes do limite, cala no limite e depois', () => {
  assert.match(avisoDos45Dias('2026-11-05', '2026-10-20T19:00'), /05\/11\/2026/)
  assert.equal(avisoDos45Dias('2026-11-05', '2026-11-05T19:00'), '')
  assert.equal(avisoDos45Dias(null, '2026-10-20T19:00'), '')
  assert.equal(avisoDos45Dias('2026-11-05', ''), '')
})

test('45 dias pela lista: o encontro realizado MAIS RECENTE da stylist, sem arquivado', () => {
  const lista = [
    { stylist: 'STY-0001', status: 'realizado', realizado_em: '2026-09-01' },
    { stylist: 'STY-0001', status: 'realizado', realizado_em: '2026-09-20' },
    { stylist: 'STY-0001', status: 'realizado', realizado_em: '2026-09-30', arquivada: true },
    { stylist: 'STY-0001', status: 'agendado', realizado_em: null },
    { stylist: 'STY-0002', status: 'realizado', realizado_em: '2026-09-25' },
  ]
  assert.equal(proximaDataPermitidaDaLista(lista, 'STY-0001'), '2026-11-04')
  assert.equal(proximaDataPermitidaDaLista(lista, 'STY-0009'), null)
  assert.equal(proximaDataPermitidaDaLista(null, 'STY-0001'), null)
})

test('período: "este mês" vai até o ÚLTIMO dia, não até hoje', () => {
  const hoje = new Date(2026, 8, 22)
  assert.deepEqual(periodoDoPlacar('mes', hoje), { p_de: '2026-09-01', p_ate: '2026-09-30' })
  assert.deepEqual(periodoDoPlacar('30', hoje), { p_de: '2026-08-24', p_ate: '2026-09-22' })
  assert.deepEqual(periodoDoPlacar('tudo', hoje), { p_de: null, p_ate: null })
  // Fevereiro não tem 30.
  assert.equal(periodoDoPlacar('mes', new Date(2027, 1, 10)).p_ate, '2027-02-28')
})

test('placar: taxas carregam de quantos saíram, e sem base não viram 0%', () => {
  const t = taxasDoPlacar({ prospectadas: 10, ativadas: 5, prospectadas_ja_ativadas: 3,
    encontros_agendados: 4, encontros_realizados: 3,
    confirmadas: 12, confirmadas_em_realizados: 9, presentes: 8, presentes_em_realizados: 7, compradoras: 2, vendas: 3, receita: 4500, pecas: 5,
    recorrentes_ate_o_fim: 1, ativadas_ate_o_fim: 3 })
  assert.equal(t.ativacao.x, 3); assert.equal(t.ativacao.n, 10)
  assert.equal(t.showRate.valor, 7 / 9)
  assert.equal(t.ticket.valor, 1500)
  assert.equal(t.pecasPorCliente.valor, 2.5)
  const vazio = taxasDoPlacar({})
  for (const v of Object.values(vazio)) assert.equal(v.temBase, false)
})

test('placar: a ativação é da MESMA turma — 2 ativadas antigas sobre 1 prospectada não viram 200%', () => {
  const t = taxasDoPlacar({ prospectadas: 1, ativadas: 2, prospectadas_ja_ativadas: 0 })
  assert.equal(t.ativacao.x, 0); assert.equal(t.ativacao.n, 1)
  assert.ok(t.ativacao.valor <= 1)
  const u = taxasDoPlacar({ prospectadas: 1, ativadas: 2, prospectadas_ja_ativadas: 1 })
  assert.equal(u.ativacao.valor, 1)
})

test('placar: confirmada de encontro cancelado não puxa o show rate para baixo', () => {
  // 10 confirmadas, 4 delas num encontro que caiu; das 6 que podiam ir, 6 foram.
  const t = taxasDoPlacar({ confirmadas: 10, confirmadas_em_realizados: 6, presentes: 6, presentes_em_realizados: 6 })
  assert.equal(t.showRate.valor, 1); assert.equal(t.showRate.n, 6)
})

test('placar: presença marcada em encontro AINDA AGENDADO não sobe o show rate (nem passa de 100%)', () => {
  // 4 confirmadas em encontros realizados, 3 vieram. Num encontro ainda
  // agendado a equipe já marcou 2 "Veio": `presentes` vira 5, a taxa não muda.
  const antes = taxasDoPlacar({ confirmadas_em_realizados: 4, presentes: 3, presentes_em_realizados: 3 })
  const depois = taxasDoPlacar({ confirmadas_em_realizados: 4, presentes: 5, presentes_em_realizados: 3 })
  assert.equal(antes.showRate.valor, 3 / 4)
  assert.equal(depois.showRate.valor, 3 / 4)
  assert.equal(depois.showRate.x, 3)
  // …mas a conversão e a receita por convidada seguem sobre TODAS as presentes.
  const c = taxasDoPlacar({ confirmadas_em_realizados: 0, presentes: 2, presentes_em_realizados: 0, compradoras: 1, receita: 800 })
  assert.equal(c.showRate.temBase, false)
  assert.equal(c.conversao.n, 2)
  assert.equal(c.receitaPorConvidada.n, 2)
})

test('placar: a legenda da taxa sem base diz o que falta, e não "sem base ainda das…"', () => {
  const vazio = taxasDoPlacar({})
  assert.equal(legendaDaTaxa('ativacao', vazio.ativacao), 'nenhuma prospectada no período')
  assert.equal(legendaDaTaxa('showRate', vazio.showRate), 'nenhum encontro realizado no período')
  const t = taxasDoPlacar({ prospectadas: 4, prospectadas_ja_ativadas: 1,
    confirmadas_em_realizados: 5, presentes_em_realizados: 4 })
  assert.equal(legendaDaTaxa('ativacao', t.ativacao), '25% (1 de 4) das prospectadas no período já ativaram')
  assert.equal(legendaDaTaxa('showRate', t.showRate), '80% (4 de 5) das confirmadas em encontros realizados')
  for (const qual of ['ativacao', 'showRate']) {
    assert.doesNotMatch(legendaDaTaxa(qual, vazio[qual]), /sem base ainda/)
  }
})

test('FIAÇÃO: as legendas de ativação e show rate saem de legendaDaTaxa', () => {
  const tela = readFileSync(new URL('./tela-de-stylist-circle.vue', import.meta.url), 'utf8')
  assert.match(tela, /legendaDaTaxa\('ativacao', taxas\.ativacao\)/)
  assert.match(tela, /legendaDaTaxa\('showRate', taxas\.showRate\)/)
  assert.doesNotMatch(tela, /das confirmadas em encontros que aconteceram/)
})

test('placar: os dois campos novos existem na função do banco', () => {
  const i = MIGRATION.indexOf('function public.vessel_placar_do_stylist_circle')
  const corpo = MIGRATION.slice(i, MIGRATION.indexOf('$function$;', i))
  assert.match(corpo, /'prospectadas_ja_ativadas'/)
  assert.match(corpo, /'confirmadas_em_realizados'/)
  assert.match(corpo, /'presentes_em_realizados', \(select count\(\*\)::int from conv\s+where status = 'realizado' and status_do_encontro = 'realizado'\)/)
})

// ── a fiação: o `.vue` usa as regras, não reescreve ─────────────────────────

const TELA_STY = readFileSync(new URL('./tela-de-stylist-circle.vue', import.meta.url), 'utf8')
const TELA_PE = readFileSync(new URL('./tela-de-private-edit.vue', import.meta.url), 'utf8')

test('FIAÇÃO: o estágio é escolhido numa lista, não digitado', () => {
  assert.doesNotMatch(TELA_STY, /list="sty-estagios-sugeridos"/, 'o datalist de texto livre voltou')
  assert.match(TELA_STY, /estagiosDeEscolher\(/)
})

test('FIAÇÃO: o placar vem do banco e as taxas de taxasDoPlacar', () => {
  assert.match(TELA_STY, /vessel_placar_do_stylist_circle/)
  assert.match(TELA_STY, /taxasDoPlacar\(/)
})

test('FIAÇÃO: a situação do encontro e o convite passam pelas funções do banco', () => {
  assert.match(TELA_PE, /vessel_private_edit_situacao/)
  assert.match(TELA_PE, /vessel_convidar_para_encontro/)
  assert.match(TELA_PE, /vessel_convite_marcar/)
  // A presença pela MESMA porta da Central de Atendimentos.
  assert.match(TELA_PE, /vessel_situacao_do_atendimento/)
})

test('FIAÇÃO: as duas telas medem a venda com a MESMA janela de 14 dias', () => {
  assert.match(TELA_STY, /const P_DIAS = 14/)
  assert.match(TELA_PE, /const P_DIAS = 14/)
})

// ── A COR DA SITUAÇÃO (23/09/2026) ─────────────────────────────────────────
const TONS = ['andamento', 'viva', 'confirmada', 'queda', 'faltou', 'parada']

test('cor: todo estágio, status e convite do banco tem um tom conhecido', () => {
  for (const k of listaDoCheck('vessel_stylists_estagio_valido')) {
    assert.ok(TONS.includes(seloDoEstagio(k).tom), `estágio ${k} sem tom`)
  }
  for (const k of Object.keys(STATUS_DO_ENCONTRO)) {
    assert.ok(TONS.includes(seloDoStatus({ status: k }).tom), `status ${k} sem tom`)
  }
  for (const k of Object.keys(SITUACOES_DO_CONVITE)) {
    assert.ok(TONS.includes(seloDoConvite(k).tom), `convite ${k} sem tom`)
  }
  assert.equal(seloDoEstagio('xyz').tom, 'parada')
  assert.equal(seloDoConvite(null).tom, 'parada')
})

test('cor: a stylist pela fase — antes do encontro azul, com encontro verde, saída laranja, parada cinza', () => {
  assert.equal(seloDoEstagio('prospectado').tom, 'andamento')
  assert.equal(seloDoEstagio('em_negociacao').tom, 'andamento')
  assert.equal(seloDoEstagio('ativado').tom, 'viva')
  assert.equal(seloDoEstagio('recorrente').tom, 'viva')
  assert.equal(seloDoEstagio('sem_retorno').tom, 'queda')
  assert.equal(seloDoEstagio('nao_interessado').tom, 'queda')
  assert.equal(seloDoEstagio('pausado').tom, 'parada')
  assert.equal(seloDoEstagio('inativo').tom, 'parada')
  // desativada é cinza mesmo recorrente: a parceria parou
  assert.equal(tomDaStylist({ estagio: 'recorrente', ativa: false }), 'parada')
  assert.equal(tomDaStylist({ estagio: 'recorrente', ativa: true }), 'viva')
})

test('cor: o encontro — realizado verde, marcado azul, caiu laranja, arquivada cinza (vence)', () => {
  assert.equal(seloDoStatus({ status: 'realizado' }).tom, 'viva')
  assert.equal(seloDoStatus({ status: 'agendado' }).tom, 'andamento')
  assert.equal(seloDoStatus({ status: 'confirmado' }).tom, 'andamento')
  assert.equal(seloDoStatus({ status: 'cancelado' }).tom, 'queda')
  assert.equal(seloDoStatus({ status: 'nao_realizado' }).tom, 'queda')
  assert.equal(seloDoStatus({ status: 'realizado', arquivada: true }).tom, 'parada')
})

test('cor: a convidada — cada situação com a cor do pedido do dono', () => {
  const esperado = { convidada: 'parada', convite_enviado: 'andamento', confirmada: 'confirmada',
    presente: 'viva', nao_respondeu: 'parada', recusou: 'queda', nao_compareceu: 'faltou' }
  for (const [k, tom] of Object.entries(esperado)) assert.equal(seloDoConvite(k).tom, tom, k)
})

test('FIAÇÃO: cada tom tem a classe no CSS e o token no tema — senão o filete some calado', () => {
  const css = readFileSync(new URL('./estilo-comercial.css', import.meta.url), 'utf8')
  const globais = readFileSync(new URL('../../estilos/estilos-globais.css', import.meta.url), 'utf8')
  for (const tom of TONS) {
    assert.match(css, new RegExp(`\\.cv-tom-${tom}\\s*\\{[^}]*--tom:\\s*var\\(--situacao-${tom}\\)`), `falta .cv-tom-${tom}`)
    assert.match(globais, new RegExp(`--situacao-${tom}:`), `falta o token --situacao-${tom}`)
  }
})
