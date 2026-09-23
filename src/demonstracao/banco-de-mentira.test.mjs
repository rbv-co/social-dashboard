import { test } from 'node:test'
import assert from 'node:assert/strict'
import { criarBancoDeMentira, telefoneCanonico, sortearChave, situacaoDoConvite } from './banco-de-mentira.js'
import { dadosIniciais } from './dados-iniciais.js'
import { somarDias } from './tempo.js'

/* O BANCO DE MENTIRA TEM AS REGRAS DO DE VERDADE — cada teste aqui é uma regra
 * de `2026-09-22-vessel-t11-bases-do-stylist-circle.sql` que a demonstração não
 * pode afrouxar. O relógio é cravado: "hoje" é 23/09/2026 às 15h em São Paulo. */
const AGORA = new Date('2026-09-23T15:00:00-03:00')
const HOJE = '2026-09-23'
function novoBanco() {
  const avisos = []
  const banco = criarBancoDeMentira({ agora: () => AGORA, aoAvisar: (evento, dados) => avisos.push({ evento, dados }) })
  return { banco, avisos, chamar: banco.chamar }
}
const PARCEIRA = { p_nome: 'Luana Teste (exemplo)', p_whatsapp: '(19) 98888-7777', p_origem_contato: 'indicacao' }
const quandoDaqui = (dias, hora = '19:00') => new Date(`${somarDias(HOJE, dias)}T${hora}:00-03:00`).toISOString()

test('criar stylist sem origem é recusado (na Central a origem é obrigatória)', () => {
  const { chamar, avisos } = novoBanco()
  assert.deepEqual(chamar('vessel_stylist_criar', { ...PARCEIRA, p_origem_contato: null }), { ok: false, situacao: 'origem_invalida' })
  assert.deepEqual(chamar('vessel_stylist_criar', { ...PARCEIRA, p_origem_contato: 'instagram' }), { ok: false, situacao: 'origem_invalida' })
  assert.equal(avisos.length, 0, 'recusa não avisa o roteiro')
})

test('criar stylist: código STY-000N sequencial e telefone 55+DDD', () => {
  const { chamar, banco, avisos } = novoBanco()
  const r = chamar('vessel_stylist_criar', PARCEIRA)
  assert.deepEqual(r, { ok: true, situacao: 'ok', codigo: 'STY-0004' })
  const s = banco.estado.stylists.find((x) => x.codigo === 'STY-0004')
  assert.equal(s.whatsapp, '5519988887777')
  assert.equal(s.estagio, 'prospectado')
  assert.equal(s.prospectado_em, HOJE)
  assert.equal(chamar('vessel_stylist_criar', { ...PARCEIRA, p_whatsapp: '5519988887777' }).situacao, 'whatsapp_repetido')
  assert.equal(chamar('vessel_stylist_criar', { ...PARCEIRA, p_whatsapp: '9999' }).situacao, 'whatsapp_invalido')
  assert.equal(chamar('vessel_stylist_criar', { ...PARCEIRA, p_nome: '  ' }).situacao, 'sem_nome')
  assert.equal(chamar('vessel_stylist_criar', { ...PARCEIRA, p_whatsapp: '19977776666', p_prospectado_em: '2026-09-24' }).situacao, 'prospeccao_no_futuro')
  assert.equal(chamar('vessel_stylist_criar', { ...PARCEIRA, p_whatsapp: '19977776666' }).codigo, 'STY-0005')
  assert.deepEqual(avisos.map((a) => a.evento), ['stylist_criada', 'stylist_criada'])
})

test('telefone canônico: o mesmo de vessel_telefone_canonico', () => {
  assert.equal(telefoneCanonico('(19) 99999-0000'), '5519999990000')
  assert.equal(telefoneCanonico('1933334444'), '551933334444')
  assert.equal(telefoneCanonico('+55 19 99999-0000'), '5519999990000')
  assert.equal(telefoneCanonico('999990000'), null)
  assert.equal(telefoneCanonico('4419999990000'), null)
})

test('estágio automático é recusado; e quem já teve encontro não volta para antes dele', () => {
  const { chamar } = novoBanco()
  chamar('vessel_stylist_criar', PARCEIRA)
  for (const e of ['ativado', 'evento_realizado', 'recorrente']) {
    assert.deepEqual(chamar('vessel_stylist_editar', { p_codigo: 'STY-0004', p_estagio: e }), { ok: false, situacao: 'estagio_automatico' })
  }
  assert.equal(chamar('vessel_stylist_editar', { p_codigo: 'STY-0004', p_estagio: 'qualquer' }).situacao, 'estagio_invalido')
  // A Marina (STY-0001) já foi ativada.
  assert.equal(chamar('vessel_stylist_editar', { p_codigo: 'STY-0001', p_estagio: 'contatado' }).situacao, 'estagio_contradiz_encontro')
  assert.equal(chamar('vessel_stylist_editar', { p_codigo: 'STY-9999', p_estagio: 'contatado' }).situacao, 'nao_achei')
})

test('pausado segura o gatilho; sair de pausado devolve o funil ao fato', () => {
  const { chamar, banco } = novoBanco()
  const marina = () => banco.estado.stylists.find((s) => s.codigo === 'STY-0001')
  assert.equal(chamar('vessel_stylist_editar', { p_codigo: 'STY-0001', p_estagio: 'pausado' }).ok, true)
  assert.equal(marina().estagio, 'pausado')
  // Um encontro novo não passa por cima da decisão de gente.
  chamar('vessel_criar_private_edit', { p_stylist: 'STY-0001', p_quando: quandoDaqui(20), p_praca: 'CPS', p_vagas: 8 })
  assert.equal(marina().estagio, 'pausado')
  // "Reabrir" (sem_retorno) faz o gatilho recalcular pelos encontros: dois realizados.
  chamar('vessel_stylist_editar', { p_codigo: 'STY-0001', p_estagio: 'sem_retorno' })
  assert.equal(marina().estagio, 'recorrente')
})

test('p_sem_proxima_acao apaga a próxima ação; nulo não mexe', () => {
  const { chamar, banco } = novoBanco()
  const paula = () => banco.estado.stylists.find((s) => s.codigo === 'STY-0002')
  chamar('vessel_stylist_editar', { p_codigo: 'STY-0002', p_proxima_acao: null })
  assert.equal(paula().proxima_acao, 'Retornar sobre a proposta do encontro')
  chamar('vessel_stylist_editar', { p_codigo: 'STY-0002', p_sem_proxima_acao: true })
  assert.equal(paula().proxima_acao, null)
  assert.equal(paula().proxima_acao_em, null)
})

test('encontro com 6 vagas (ou 11) é recusado; praça é obrigatória', () => {
  const { chamar } = novoBanco()
  chamar('vessel_stylist_criar', PARCEIRA)
  const base = { p_stylist: 'STY-0004', p_quando: quandoDaqui(3), p_praca: 'CPS', p_vagas: 8 }
  assert.equal(chamar('vessel_criar_private_edit', { ...base, p_vagas: 6 }).situacao, 'vagas_invalidas')
  assert.equal(chamar('vessel_criar_private_edit', { ...base, p_vagas: 11 }).situacao, 'vagas_invalidas')
  assert.equal(chamar('vessel_criar_private_edit', { ...base, p_praca: null }).situacao, 'praca_invalida')
  assert.equal(chamar('vessel_criar_private_edit', { ...base, p_stylist: 'STY-9999' }).situacao, 'stylist_nao_encontrada')
  assert.equal(chamar('vessel_criar_private_edit', { ...base, p_quando: quandoDaqui(-3) }).situacao, 'data_no_passado')
  assert.equal(chamar('vessel_private_edit_editar', { p_codigo: `PE-20260926-CPS-01`, p_vagas: 6 }).situacao, 'nao_achei')
})

test('criar encontro ATIVA a stylist (gatilho), com código PE-AAAAMMDD-PRACA-NN e chave de 8 letras', () => {
  const { chamar, banco, avisos } = novoBanco()
  chamar('vessel_stylist_criar', PARCEIRA)
  const r = chamar('vessel_criar_private_edit', { p_stylist: 'STY-0004', p_quando: quandoDaqui(0, '10:00'), p_praca: 'cps', p_vagas: 8 })
  assert.equal(r.ok, true)
  assert.equal(r.codigo, 'PE-20260923-CPS-01')
  assert.match(r.chave, /^[ABCDEFGHJKMNPQRSTVWXYZ23456789]{8}$/)
  const s = banco.estado.stylists.find((x) => x.codigo === 'STY-0004')
  assert.equal(s.estagio, 'ativado')
  assert.ok(s.ativada_em)
  // Segundo encontro na mesma praça e no mesmo dia: -02.
  const r2 = chamar('vessel_criar_private_edit', { p_stylist: 'STY-0004', p_quando: quandoDaqui(0, '20:00'), p_praca: 'CPS', p_vagas: 8 })
  assert.equal(r2.codigo, 'PE-20260923-CPS-02')
  const aviso = avisos.find((a) => a.evento === 'encontro_criado')
  assert.deepEqual(aviso.dados, { codigo: 'PE-20260923-CPS-01', stylist: 'STY-0004', estagio_antes: 'prospectado', estagio: 'ativado' })
})

test('a ativação congela: cancelar o único encontro não desfaz ativada_em', () => {
  const { chamar, banco } = novoBanco()
  chamar('vessel_stylist_criar', PARCEIRA)
  const { codigo } = chamar('vessel_criar_private_edit', { p_stylist: 'STY-0004', p_quando: quandoDaqui(4), p_praca: 'CPS', p_vagas: 8 })
  const s = banco.estado.stylists.find((x) => x.codigo === 'STY-0004')
  const ativada = s.ativada_em
  assert.equal(chamar('vessel_private_edit_situacao', { p_codigo: codigo, p_status: 'cancelado', p_motivo: 'chuva' }).ok, true)
  assert.equal(s.ativada_em, ativada)
  assert.equal(s.estagio, 'ativado', 'cancelado conta como "chegou a ter data"')
  // Arquivar o encontro tira do funil: sem encontro nenhum, o estágio automático volta a "ativado" (o fato mínimo).
  chamar('vessel_private_edit_arquivar', { p_codigo: codigo, p_arquivada: true })
  assert.equal(s.estagio, 'ativado')
  assert.equal(s.ativada_em, ativada)
})

test('um realizado = evento realizado; dois realizados = recorrente', () => {
  const { chamar, banco } = novoBanco()
  chamar('vessel_stylist_criar', PARCEIRA)
  const a = chamar('vessel_criar_private_edit', { p_stylist: 'STY-0004', p_quando: quandoDaqui(0, '09:00'), p_praca: 'CPS', p_vagas: 8 })
  const b = chamar('vessel_criar_private_edit', { p_stylist: 'STY-0004', p_quando: quandoDaqui(0, '11:00'), p_praca: 'SAO', p_vagas: 8 })
  const s = () => banco.estado.stylists.find((x) => x.codigo === 'STY-0004')
  chamar('vessel_private_edit_situacao', { p_codigo: a.codigo, p_status: 'realizado', p_realizado_em: '2026-09-22' })
  assert.equal(s().estagio, 'evento_realizado')
  chamar('vessel_private_edit_situacao', { p_codigo: b.codigo, p_status: 'realizado', p_realizado_em: HOJE })
  assert.equal(s().estagio, 'recorrente')
  // Voltar um deles para agendado recalcula para baixo.
  chamar('vessel_private_edit_situacao', { p_codigo: b.codigo, p_status: 'agendado' })
  assert.equal(s().estagio, 'evento_realizado')
})

test('situação: cancelar sem motivo recusa; realizado no futuro recusa; fechar para o convite', () => {
  const { chamar, banco, avisos } = novoBanco()
  const futuro = banco.estado.encontros.find((e) => e.status === 'agendado').codigo
  assert.deepEqual(chamar('vessel_private_edit_situacao', { p_codigo: futuro, p_status: 'cancelado', p_motivo: '  ' }), { ok: false, situacao: 'sem_motivo' })
  assert.equal(chamar('vessel_private_edit_situacao', { p_codigo: futuro, p_status: 'nao_realizado' }).situacao, 'sem_motivo')
  assert.equal(avisos.filter((a) => a.evento === 'recusa_sem_motivo').length, 2)
  assert.equal(chamar('vessel_private_edit_situacao', { p_codigo: futuro, p_status: 'realizado' }).situacao, 'realizado_no_futuro')
  assert.equal(chamar('vessel_private_edit_situacao', { p_codigo: futuro, p_status: 'realizado', p_realizado_em: '2026-09-30' }).situacao, 'realizado_no_futuro')
  assert.equal(chamar('vessel_private_edit_situacao', { p_codigo: futuro, p_status: 'bobagem' }).situacao, 'status_invalido')
  const r = chamar('vessel_private_edit_situacao', { p_codigo: futuro, p_status: 'realizado', p_realizado_em: HOJE, p_observacoes: 'ok' })
  assert.deepEqual(r, { ok: true, situacao: 'ok', codigo: futuro, status: 'realizado', antes: 'agendado' })
  const e = banco.estado.encontros.find((x) => x.codigo === futuro)
  assert.equal(e.ativa, false, 'encontro que acabou para de aceitar resposta')
  assert.equal(e.realizado_em, HOJE)
  // Observação: nula não mexe, vazia apaga.
  chamar('vessel_private_edit_situacao', { p_codigo: futuro, p_status: 'realizado', p_observacoes: null })
  assert.equal(e.observacoes, 'ok')
  chamar('vessel_private_edit_situacao', { p_codigo: futuro, p_status: 'realizado', p_observacoes: '' })
  assert.equal(e.observacoes, null)
})

test('convidar duas vezes a mesma pessoa = a mesma cadeira (ja_estava)', () => {
  const { chamar, avisos } = novoBanco()
  chamar('vessel_stylist_criar', PARCEIRA)
  const { codigo } = chamar('vessel_criar_private_edit', { p_stylist: 'STY-0004', p_quando: quandoDaqui(2), p_praca: 'CPS', p_vagas: 8 })
  const a = chamar('vessel_convidar_para_encontro', { p_codigo: codigo, p_nome: 'Nina (exemplo)', p_whatsapp: '(19) 97777-1111' })
  assert.equal(a.ok, true)
  assert.equal(a.situacao, 'ok')
  const b = chamar('vessel_convidar_para_encontro', { p_codigo: codigo, p_nome: 'Nina de novo', p_whatsapp: '5519977771111' })
  assert.deepEqual(b, { ok: true, situacao: 'ja_estava', id: a.id })
  assert.equal(chamar('vessel_convidadas_do_encontro', { p_codigo: codigo }).length, 1)
  assert.equal(avisos.filter((x) => x.evento === 'convidada_incluida').length, 1, '"já estava" não é convidada nova')
  assert.equal(chamar('vessel_convidar_para_encontro', { p_codigo: codigo, p_nome: '', p_whatsapp: '19977772222' }).situacao, 'sem_nome')
  assert.equal(chamar('vessel_convidar_para_encontro', { p_codigo: codigo, p_nome: 'X', p_whatsapp: '123' }).situacao, 'whatsapp_invalido')
  assert.equal(chamar('vessel_convidar_para_encontro', { p_codigo: codigo, p_nome: 'X', p_whatsapp: '19977772222', p_email: 'sem-arroba' }).situacao, 'email_invalido')
  chamar('vessel_private_edit_situacao', { p_codigo: codigo, p_status: 'cancelado', p_motivo: 'loja fechou' })
  assert.equal(chamar('vessel_convidar_para_encontro', { p_codigo: codigo, p_nome: 'Y', p_whatsapp: '19977773333' }).situacao, 'encontro_fechado')
})

test('apagar encontro com gente é recusado (tem_gente); vazio apaga', () => {
  const { chamar, banco } = novoBanco()
  const comGente = banco.estado.encontros[2].codigo
  assert.equal(chamar('vessel_private_edit_apagar', { p_codigo: comGente }).situacao, 'tem_gente')
  chamar('vessel_stylist_criar', PARCEIRA)
  const { codigo } = chamar('vessel_criar_private_edit', { p_stylist: 'STY-0004', p_quando: quandoDaqui(2), p_praca: 'CPS', p_vagas: 8 })
  assert.equal(chamar('vessel_private_edit_apagar', { p_codigo: codigo }).ok, true)
  assert.equal(banco.estado.encontros.some((e) => e.codigo === codigo), false)
})

test('convite e presença: as marcas e a situação calculada', () => {
  const { chamar, banco } = novoBanco()
  const codigo = banco.estado.encontros[2].codigo
  const lista = () => chamar('vessel_convidadas_do_encontro', { p_codigo: codigo })
  assert.deepEqual(lista().map((c) => c.situacao), ['convidada', 'convite_enviado', 'confirmada'])
  const [helena] = lista()
  assert.equal(chamar('vessel_convite_marcar', { p_id: helena.id, p_marca: 'enviado' }).ok, true)
  assert.equal(lista()[0].situacao, 'convite_enviado')
  chamar('vessel_convite_marcar', { p_id: helena.id, p_marca: 'sim' })
  assert.equal(lista()[0].situacao, 'confirmada')
  assert.equal(chamar('vessel_convite_marcar', { p_id: helena.id, p_marca: 'talvez' }).situacao, 'marca_invalida')
  chamar('vessel_situacao_do_atendimento', { p_id: helena.id, p_situacao: 'realizado' })
  assert.equal(lista()[0].situacao, 'presente')
  assert.ok(lista()[0].presenca_em)
  chamar('vessel_situacao_do_atendimento', { p_id: helena.id, p_situacao: 'no_show' })
  assert.equal(lista()[0].situacao, 'nao_compareceu')
  assert.equal(lista()[0].presenca_em, null, 'não veio descarimba a chegada')
  assert.equal(chamar('vessel_situacao_do_atendimento', { p_id: helena.id, p_situacao: 'veio' }).situacao, 'situacao_invalida')
})

test('situação do convite: a ordem é a regra (presença vence tudo)', () => {
  const futuro = '2026-10-01T22:00:00Z'
  assert.equal(situacaoDoConvite('realizado', 'nao', null, futuro, 'agendado', AGORA), 'presente')
  assert.equal(situacaoDoConvite('no_show', 'sim', null, futuro, 'agendado', AGORA), 'nao_compareceu')
  assert.equal(situacaoDoConvite('solicitado', 'nao', null, futuro, 'agendado', AGORA), 'recusou')
  assert.equal(situacaoDoConvite('solicitado', 'sim', null, futuro, 'agendado', AGORA), 'confirmada')
  assert.equal(situacaoDoConvite('solicitado', null, null, '2026-09-01T22:00:00Z', 'agendado', AGORA), 'nao_respondeu')
  assert.equal(situacaoDoConvite('solicitado', null, null, futuro, 'cancelado', AGORA), 'nao_respondeu')
  assert.equal(situacaoDoConvite('solicitado', null, '2026-09-20T10:00:00Z', futuro, 'agendado', AGORA), 'convite_enviado')
  assert.equal(situacaoDoConvite('solicitado', null, null, futuro, 'agendado', AGORA), 'convidada')
})

test('registrar contato devolve a sugestão pela mesma regra (sugestaoDeEtapa)', () => {
  const { chamar, banco } = novoBanco()
  chamar('vessel_stylist_criar', PARCEIRA)
  const r = chamar('vessel_stylist_registrar_contato', { p_codigo: 'STY-0004', p_canal: 'whatsapp', p_resultado: 'conversou' })
  assert.equal(r.ok, true)
  assert.equal(r.sugestao, 'contatado')
  // A sugestão não muda nada sozinha.
  assert.equal(banco.estado.stylists.find((s) => s.codigo === 'STY-0004').estagio, 'prospectado')
  // Paula está em negociação: "interesse" é para trás, sem sugestão.
  assert.equal(chamar('vessel_stylist_registrar_contato', { p_codigo: 'STY-0002', p_canal: 'ligacao', p_resultado: 'interesse' }).sugestao, null)
  // Recusou antes de ter encontro: sugere "não interessado".
  assert.equal(chamar('vessel_stylist_registrar_contato', { p_codigo: 'STY-0003', p_canal: 'email', p_resultado: 'recusou' }).sugestao, 'nao_interessado')
  // Marina já ativou: recusou não sugere nada.
  assert.equal(chamar('vessel_stylist_registrar_contato', { p_codigo: 'STY-0001', p_canal: 'email', p_resultado: 'recusou' }).sugestao, null)
  assert.equal(chamar('vessel_stylist_registrar_contato', { p_codigo: 'STY-0004', p_canal: 'pombo', p_resultado: 'conversou' }).situacao, 'canal_invalido')
  assert.equal(chamar('vessel_stylist_registrar_contato', { p_codigo: 'STY-0004', p_canal: 'email', p_resultado: 'x' }).situacao, 'resultado_invalido')
  assert.equal(chamar('vessel_stylist_registrar_contato', { p_codigo: 'STY-0004', p_canal: 'email', p_resultado: 'conversou', p_nota: 'x'.repeat(501) }).situacao, 'nota_longa')
  // O histórico: mais novo primeiro.
  const h = chamar('vessel_stylist_contatos', { p_codigo: 'STY-0004' })
  assert.equal(h.length, 1)
  assert.equal(h[0].resultado, 'conversou')
  // Nova próxima ação substitui a de hoje.
  chamar('vessel_stylist_registrar_contato', { p_codigo: 'STY-0002', p_canal: 'whatsapp', p_resultado: 'conversou', p_proxima_acao: 'Mandar a proposta', p_proxima_acao_em: '2026-09-30' })
  const paula = banco.estado.stylists.find((s) => s.codigo === 'STY-0002')
  assert.deepEqual([paula.proxima_acao, paula.proxima_acao_em], ['Mandar a proposta', '2026-09-30'])
})

test('a venda vai para o PRIMEIRO encontro, só pedido atendido (9), e só de quem esteve presente', () => {
  const dados = dadosIniciais(AGORA)
  // A Ana (2201) também foi ao encontro de 12 dias atrás, e comprou 3 dias depois
  // dele: a compra está na janela do de -12 e NÃO na do de -40 (que já fechou) —
  // então é do de -12. Para provar o "primeiro", um encontro de -10 com ela também.
  dados.encontros.push({ id: 9, codigo: 'PE-20260913-SAO-01', chave: 'ZZZZZZZZ', stylist_id: 2, quando: '2026-09-13T22:00:00.000Z',
    local: null, praca: 'SAO', loja: null, vagas: 8, ativa: false, arquivada: false, status: 'realizado', realizado_em: '2026-09-13',
    motivo: null, observacoes: null, teste: false })
  dados.atendimentos.push({ id: 500, pessoa_id: 2204, loja: null, quando: '2026-09-13T22:00:00.000Z', status: 'realizado', rsvp: 'sim',
    evento_codigo: 'PE-20260913-SAO-01', convidada_em: null, convite_enviado_em: null, chave_convite: null, convite_aberto_em: null,
    convite_aberturas: 0, presenca_em: null, criado_em: null, teste: false })
  const banco = criarBancoDeMentira({ agora: () => AGORA, dados })
  const conta = banco.chamar('vessel_conta_das_private_edits', { p_dias: 14 })
  const doDe12 = conta.find((e) => e.codigo === 'PE-20260911-CPS-01')
  const doDe10 = conta.find((e) => e.codigo === 'PE-20260913-SAO-01')
  // A Débora (2204) comprou em 14/09: dentro das DUAS janelas; vai para o de 11/09.
  assert.equal(doDe12.receita, 2890)
  assert.equal(doDe12.vendas, 1)
  assert.equal(doDe10.receita, 0, 'a mesma venda não conta duas vezes')
  // O pedido cancelado (12) da Elisa não entra em lugar nenhum.
  assert.equal(conta.reduce((a, e) => a + e.receita, 0), 1850 + 2890)
  const comprou = banco.chamar('vessel_convidadas_do_encontro', { p_codigo: 'PE-20260911-CPS-01' }).filter((c) => c.comprou)
  assert.deepEqual(comprou.map((c) => c.pessoa_id), [2204])
})

test('o placar fecha com o estado — e muda quando o encontro é realizado', () => {
  const { chamar } = novoBanco()
  const tudo = () => chamar('vessel_placar_do_stylist_circle', { p_de: null, p_ate: null, p_dias: 14 })
  const antes = tudo()
  // Conferência contra os dados de exemplo, número por número.
  assert.equal(antes.prospectadas, 3)
  assert.equal(antes.ativadas, 1)
  assert.equal(antes.prospectadas_ja_ativadas, 1)
  assert.equal(antes.encontros_agendados, 3)
  assert.equal(antes.encontros_realizados, 2)
  assert.equal(antes.encontros_cancelados, 0)
  assert.equal(antes.convidadas, 10)
  assert.equal(antes.confirmadas, 8) // 3 + 4 (sim, inclusive quem faltou) + 1 (Júlia, do agendado)
  assert.equal(antes.confirmadas_em_realizados, 7)
  assert.equal(antes.presentes, 5)
  assert.equal(antes.presentes_em_realizados, 5)
  assert.equal(antes.recorrentes_no_periodo, 1)
  assert.equal(antes.recorrentes_ate_o_fim, 1)
  assert.equal(antes.ativadas_ate_o_fim, 1)
  assert.equal(antes.intervalos, 1)
  assert.equal(antes.intervalo_medio_em_dias, 28)
  assert.equal(antes.contatos_ate_ativar, 3)
  assert.equal(antes.stylists_com_contatos_ate_ativar, 1)
  assert.equal(antes.vendas, 2)
  assert.equal(antes.compradoras, 2)
  assert.equal(antes.pecas, 3)
  assert.equal(antes.receita, 4740)
  assert.deepEqual(antes.por_stylist, [{ codigo: 'STY-0001', nome: 'Marina Castro (exemplo)', encontros_realizados: 2, vendas: 2, receita: 4740 }])

  // O roteiro inteiro, pelas funções: parceira nova, encontro hoje, duas convidadas, presença, realizado.
  chamar('vessel_stylist_criar', PARCEIRA)
  const { codigo } = chamar('vessel_criar_private_edit', { p_stylist: 'STY-0004', p_quando: quandoDaqui(0, '10:00'), p_praca: 'CPS', p_vagas: 8 })
  const a = chamar('vessel_convidar_para_encontro', { p_codigo: codigo, p_nome: 'Olga (exemplo)', p_whatsapp: '19966660001' })
  const b = chamar('vessel_convidar_para_encontro', { p_codigo: codigo, p_nome: 'Pietra (exemplo)', p_whatsapp: '19966660002' })
  chamar('vessel_convite_marcar', { p_id: a.id, p_marca: 'sim' })
  chamar('vessel_convite_marcar', { p_id: b.id, p_marca: 'sim' })
  chamar('vessel_situacao_do_atendimento', { p_id: a.id, p_situacao: 'realizado' })
  chamar('vessel_situacao_do_atendimento', { p_id: b.id, p_situacao: 'no_show' })
  chamar('vessel_private_edit_situacao', { p_codigo: codigo, p_status: 'realizado', p_realizado_em: HOJE })
  const depois = tudo()
  assert.equal(depois.prospectadas, 4)
  assert.equal(depois.ativadas, 2)
  assert.equal(depois.encontros_agendados, 4)
  assert.equal(depois.encontros_realizados, 3)
  assert.equal(depois.convidadas, 12)
  assert.equal(depois.confirmadas_em_realizados, 9)
  assert.equal(depois.presentes_em_realizados, 6)
  assert.equal(depois.contatos_ate_ativar, 1.5) // Marina 3, a nova 0
  assert.equal(depois.por_stylist.length, 2)
  // O rastreio concorda: ela está em "Evento realizado", com 1 realizado.
  const nova = chamar('vessel_rastreio_dos_stylists', { p_dias: 14 }).find((s) => s.codigo === 'STY-0004')
  assert.equal(nova.estagio, 'evento_realizado')
  assert.equal(nova.encontros_realizados, 1)
  assert.equal(nova.proxima_data_permitida, '2026-11-07')
})

test('o placar recorta pelo período: cada número pela sua data', () => {
  const { chamar } = novoBanco()
  // Só setembro/2026: o encontro de -40 (14/08) fica de fora.
  const set = chamar('vessel_placar_do_stylist_circle', { p_de: '2026-09-01', p_ate: '2026-09-30' })
  assert.equal(set.prospectadas, 2) // Paula (03/09) e Renata (20/09); Marina é de julho
  assert.equal(set.ativadas, 0) // Marina ativou em julho
  assert.equal(set.encontros_agendados, 2)
  assert.equal(set.encontros_realizados, 1)
  assert.equal(set.receita, 2890)
  assert.equal(set.recorrentes_no_periodo, 1, 'o 2º realizado dela foi em 11/09')
  assert.equal(set.contatos_ate_ativar, null)
})

test('rastreio: desativada some da lista e da escolha, e volta com p_incluir_desativadas', () => {
  const { chamar } = novoBanco()
  assert.equal(chamar('vessel_stylist_desativar', { p_codigo: 'STY-0003', p_ativa: false }).ok, true)
  assert.equal(chamar('vessel_rastreio_dos_stylists', {}).some((s) => s.codigo === 'STY-0003'), false)
  assert.equal(chamar('vessel_stylists_para_escolher', {}).some((s) => s.codigo === 'STY-0003'), false)
  assert.equal(chamar('vessel_rastreio_dos_stylists', { p_incluir_desativadas: true }).some((s) => s.codigo === 'STY-0003'), true)
  const marina = chamar('vessel_rastreio_dos_stylists', { p_dias: 14 }).find((s) => s.codigo === 'STY-0001')
  assert.equal(marina.encontros_realizados, 2)
  assert.equal(marina.receita_dos_encontros, 4740)
  assert.equal(marina.clientes, 10)
  assert.equal(marina.compareceram, 5)
  assert.equal(marina.contatos, 3)
})

test('chave da convidada: sorteia uma vez e guarda; o cartão avisa o roteiro', () => {
  const { chamar, banco, avisos } = novoBanco()
  const helena = banco.estado.atendimentos.find((t) => t.pessoa_id === 2208)
  const a = chamar('vessel_chave_da_convidada', { p_id: helena.id })
  assert.match(a.chave, /^[ABCDEFGHJKMNPQRSTVWXYZ23456789]{8}$/)
  assert.equal(a.chave_encontro, 'R4V8B2NC')
  assert.equal(chamar('vessel_chave_da_convidada', { p_id: helena.id }).chave, a.chave)
  assert.equal(chamar('vessel_chave_da_convidada', { p_id: 1 }).situacao, 'nao_achei')
  assert.equal(avisos.filter((x) => x.evento === 'cartao_gerado').length, 2)
})

test('sortear chave descarta byte ≥ 240 e nunca repete', () => {
  const bytes = [250, 0, 1, 2, 3, 4, 5, 6, 7, 0, 1, 2, 3, 4, 5, 6, 8]
  let i = 0
  const chave = sortearChave((k) => k === 'ABCDEFGH', () => bytes[i++])
  assert.equal(chave, 'ABCDEFGJ')
})

test('as respostas são cópias: mexer no que voltou não mexe no banco', () => {
  const { chamar, banco } = novoBanco()
  const lista = chamar('vessel_rastreio_dos_stylists', {})
  lista[0].nome = 'mexido'
  assert.notEqual(banco.estado.stylists[0].nome, 'mexido')
  assert.equal(banco.conhece('vessel_rastreio_dos_stylists'), true)
  assert.equal(banco.conhece('funcao_que_nao_existe'), false)
  assert.equal(chamar('funcao_que_nao_existe', {}), undefined)
})
