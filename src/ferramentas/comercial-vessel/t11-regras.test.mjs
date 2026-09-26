import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  seloDaEtapa,
  ORIGENS_DE_CONTATO, STATUS_DO_ENCONTRO, precisaDeMotivo, seloDoStatus,
  mensagemDeSituacaoDoEncontro, SITUACOES_DO_CONVITE, seloDoConvite, gestosDaConvidada,
  problemasDaConvidada, mensagemDeConvidar, telefoneLegivel, avisoDos45Dias,
  periodoDoPlacar, taxasDoPlacar, legendaDaTaxa, proximaDataPermitidaDaLista, tomDaStylist,
  sequenciaDoPlacar, taxaDoPasso,
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

// ⚠️ 24/09/2026: O FUNIL É CONFIGURÁVEL. A lista fechada de estágios saiu do
// banco e do código; as etapas são linhas de `vessel_stylist_etapas`. O teste
// que conferia a lista contra o CHECK virou este: o CHECK NÃO pode voltar.
const FUNIL = readFileSync(new URL(
  '../../../db/migrations/2026-09-24-vessel-stylist-funil-configuravel.sql', import.meta.url), 'utf8')
test('o funil não é mais lista fechada: a migration tira a CHECK e a coluna estagio', () => {
  assert.match(FUNIL, /drop constraint if exists vessel_stylists_estagio_valido/)
  assert.match(FUNIL, /drop column estagio/)
  assert.doesNotMatch(FUNIL, /add constraint vessel_stylists_estagio_valido/)
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

test('selo da etapa: o nome dela, e sem etapa não some', () => {
  assert.deepEqual(seloDaEtapa({ etapa: 'Convidado', etapa_tipo: 'funil' }), { texto: 'Convidado', classe: 'cv-selo-fim', tom: 'andamento' })
  assert.equal(seloDaEtapa({ etapa: 'Desclassificado', etapa_tipo: 'saida' }).tom, 'queda')
  assert.equal(seloDaEtapa({}).texto, 'Sem etapa')
  assert.equal(seloDaEtapa(null).tom, 'parada')
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
  const mexe = { podeMarcarPresenca: true }
  const nova = gestosDaConvidada({ status: 'solicitado' }, mexe).map((g) => g.gesto)
  assert.deepEqual(nova, ['enviado', 'sim', 'nao', 'realizado', 'no_show'])
  const enviada = gestosDaConvidada({ status: 'solicitado', convite_enviado_em: 'x' }, mexe).map((g) => g.gesto)
  assert.ok(!enviada.includes('enviado'))
  const veio = gestosDaConvidada({ status: 'realizado', rsvp: 'sim' }, mexe).map((g) => g.gesto)
  // ⚠️ Quem veio ainda pode ser corrigida para "não veio" — engano da gerente.
  assert.deepEqual(veio, ['no_show'])
})

test('gestos da convidada: Veio/Não veio só para quem pode EDITAR (o banco exige editar desde 25/09/2026)', () => {
  const soVe = gestosDaConvidada({ status: 'solicitado' }, { podeMarcarPresenca: false }).map((g) => g.gesto)
  assert.deepEqual(soVe, ['enviado', 'sim', 'nao'])
  // Esquecer o argumento esconde a presença — nunca mostra um botão que o banco recusaria.
  assert.deepEqual(gestosDaConvidada({ status: 'solicitado' }).map((g) => g.gesto), ['enviado', 'sim', 'nao'])
  assert.deepEqual(gestosDaConvidada({ status: 'realizado', rsvp: 'sim' }), [])
})

test('a tela do Private Edit passa a permissão de editar para os gestos da convidada', () => {
  const tela = readFileSync(new URL('./tela-de-private-edit.vue', import.meta.url), 'utf8')
  assert.match(tela, /gestosDaConvidada\(c, \{ podeMarcarPresenca: podeEditar \}\)/)
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

test('FIAÇÃO: a taxa de ativação sai da sequência (taxaDoPasso) e a de show rate de legendaDaTaxa', () => {
  const tela = readFileSync(new URL('./tela-de-stylist-circle.vue', import.meta.url), 'utf8')
  // 24/09/2026: a ativação é o 2º passo da sequência do placar, com a taxa da turma.
  assert.match(tela, /v-for="p in sequencia"/)
  assert.match(tela, /taxaDoPasso\(p\)/)
  assert.match(tela, /sequenciaDoPlacar\(placar\.value\)/)
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

test('FIAÇÃO: a etapa não se digita nem se corrige no formulário — é da ficha e do quadro', () => {
  assert.doesNotMatch(TELA_STY, /list="sty-estagios-sugeridos"/, 'o datalist de texto livre voltou')
  assert.doesNotMatch(TELA_STY, /ed-estagio-/, 'o seletor de estágio voltou para o "Corrigir"')
  assert.match(TELA_STY, /seloDaEtapa\(s\)/)
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

test('cor: todo tipo de etapa, status e convite do banco tem um tom conhecido', () => {
  for (const tipo of ['funil', 'saida', null]) {
    assert.ok(TONS.includes(seloDaEtapa({ etapa: 'X', etapa_tipo: tipo }).tom), `etapa ${tipo} sem tom`)
  }
  for (const k of Object.keys(STATUS_DO_ENCONTRO)) {
    assert.ok(TONS.includes(seloDoStatus({ status: k }).tom), `status ${k} sem tom`)
  }
  for (const k of Object.keys(SITUACOES_DO_CONVITE)) {
    assert.ok(TONS.includes(seloDoConvite(k).tom), `convite ${k} sem tom`)
  }
  assert.equal(seloDoConvite(null).tom, 'parada')
})

test('cor: a stylist pelo tipo da etapa — funil azul, saída laranja; desativada cinza (vence)', () => {
  assert.equal(tomDaStylist({ etapa: 'Convidado', etapa_tipo: 'funil', ativa: true }), 'andamento')
  assert.equal(tomDaStylist({ etapa: 'Desclassificado', etapa_tipo: 'saida', ativa: true }), 'queda')
  // desativada é cinza em qualquer etapa: a parceria parou
  assert.equal(tomDaStylist({ etapa: 'Convidado', etapa_tipo: 'funil', ativa: false }), 'parada')
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
  // Onda 0 (23/09/2026): os tons moraram aqui e mudaram-se para a folha
  // comum da Central, com o nome neutro `id-tom-*`.
  const css = readFileSync(new URL('../../estilos/identidade-da-ferramenta.css', import.meta.url), 'utf8')
  const globais = readFileSync(new URL('../../estilos/estilos-globais.css', import.meta.url), 'utf8')
  for (const tom of TONS) {
    assert.match(css, new RegExp(`\\.id-tom-${tom}\\s*\\{[^}]*--tom:\\s*var\\(--situacao-${tom}\\)`), `falta .id-tom-${tom}`)
    assert.match(globais, new RegExp(`--situacao-${tom}:`), `falta o token --situacao-${tom}`)
  }
})

// ── 24/09/2026: a ativação pela etapa e a sequência do placar ──────────────
test('sequência do placar: os cinco passos, cada taxa sobre o passo de cima, da mesma turma', () => {
  const pl = { prospectadas: 10, ativadas: 4, com_private_edit_agendado: 3, com_private_edit_realizado: 2, recorrentes_no_periodo: 1,
    prospectadas_ja_ativadas: 4, prospectadas_com_private_edit_agendado: 3, prospectadas_com_private_edit_realizado: 2, prospectadas_recorrentes: 1 }
  const seq = sequenciaDoPlacar(pl)
  assert.deepEqual(seq.map((p) => p.rotulo), ['Prospectadas', 'Ativadas', 'Com Private Edit agendado', 'Com Private Edit realizado', 'Recorrentes'])
  assert.deepEqual(seq.map((p) => p.valor), [10, 4, 3, 2, 1])
  assert.equal(seq[0].taxa, null)
  assert.deepEqual(seq.slice(1).map((p) => [p.taxa.x, p.taxa.n]), [[4, 10], [3, 4], [2, 3], [1, 2]])
  assert.equal(taxaDoPasso(seq[1]), '40% (4 de 10) das prospectadas')
  assert.equal(taxaDoPasso(seq[0]), 'pela data da prospecção')
  const vazio = sequenciaDoPlacar({})
  assert.match(taxaDoPasso(vazio[2]), /sem base na turma/)
  assert.match(seq[1].base, /etapa que libera Private Edit/)
  assert.match(seq[2].base, /primeiro encontro agendado/)
})

test('cor: a saída que libera Private Edit (Ativada) é viva; a outra saída continua queda', () => {
  assert.equal(seloDaEtapa({ etapa: 'Ativada', etapa_tipo: 'saida', etapa_libera_private_edit: true }).tom, 'viva')
  assert.equal(seloDaEtapa({ etapa: 'Desclassificado', etapa_tipo: 'saida', etapa_libera_private_edit: false }).tom, 'queda')
})
