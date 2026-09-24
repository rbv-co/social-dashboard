import { test } from 'node:test'
import assert from 'node:assert/strict'
import { criarBancoDeMentira, telefoneCanonico, sortearChave, situacaoDoConvite } from './banco-de-mentira.js'
import { dadosIniciais } from './dados-iniciais.js'
import { somarDias } from './tempo.js'

/* O BANCO DE MENTIRA TEM AS REGRAS DO DE VERDADE — cada teste aqui é uma regra
 * de `2026-09-22-vessel-t11-bases-do-stylist-circle.sql` (e do funil configurável
 * de `2026-09-24-vessel-stylist-funil-configuravel.sql`) que a demonstração não
 * pode afrouxar. O relógio é cravado: "hoje" é 23/09/2026 às 15h em São Paulo. */
const AGORA = new Date('2026-09-23T15:00:00-03:00')
const HOJE = '2026-09-23'
function novoBanco() {
  const avisos = []
  const banco = criarBancoDeMentira({ agora: () => AGORA, aoAvisar: (evento, dados) => avisos.push({ evento, dados }) })
  return { banco, avisos, chamar: banco.chamar }
}
// ⚠️ Os dados de exemplo já têm STY-0001 a STY-0007 (a 7, desclassificada com
// motivo, desde 24/09/2026): a parceira nova de cada teste nasce STY-0008.
const NOVA = 'STY-0008'
const ETAPA = Object.fromEntries(dadosIniciais(AGORA).etapas.map((e) => [e.nome, e.id]))
const PARCEIRA = { p_nome: 'Luana Teste (exemplo)', p_whatsapp: '(19) 98888-7777', p_origem_contato: 'indicacao' }
// ⚠️ 24/09/2026: encontro novo só com parceira numa etapa que libera Private
// Edit — os testes que marcam encontro com a nova passam por aqui antes.
const ativar = (chamar, codigo) => chamar('vessel_stylist_mover_de_etapa', { p_codigo: codigo, p_etapa_id: ETAPA.Ativada })
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
  assert.deepEqual(r, { ok: true, situacao: 'ok', codigo: NOVA })
  const s = banco.estado.stylists.find((x) => x.codigo === NOVA)
  assert.equal(s.whatsapp, '5519988887777')
  // Entra na PRIMEIRA etapa de funil, sem data da prospecção (a data é da etapa marcada).
  assert.equal(s.etapa_id, ETAPA.Identificado)
  assert.equal(s.prospectado_em, null)
  assert.equal(chamar('vessel_stylist_criar', { ...PARCEIRA, p_whatsapp: '5519988887777' }).situacao, 'whatsapp_repetido')
  assert.equal(chamar('vessel_stylist_criar', { ...PARCEIRA, p_whatsapp: '9999' }).situacao, 'whatsapp_invalido')
  assert.equal(chamar('vessel_stylist_criar', { ...PARCEIRA, p_nome: '  ' }).situacao, 'sem_nome')
  // Só com o Instagram também entra; sem nenhum dos dois, não.
  assert.equal(chamar('vessel_stylist_criar', { ...PARCEIRA, p_whatsapp: null }).situacao, 'sem_contato')
  assert.equal(chamar('vessel_stylist_criar', { ...PARCEIRA, p_whatsapp: null, p_instagram: 'Não localizado' }).situacao, 'instagram_invalido')
  assert.equal(chamar('vessel_stylist_criar', { ...PARCEIRA, p_whatsapp: '19977776666' }).codigo, 'STY-0009')
  const soInsta = chamar('vessel_stylist_criar', { ...PARCEIRA, p_nome: 'Só Insta (exemplo)', p_whatsapp: null, p_instagram: '@so.insta' })
  assert.equal(soInsta.codigo, 'STY-0010')
  assert.equal(chamar('vessel_stylist_criar', { ...PARCEIRA, p_whatsapp: null, p_instagram: 'instagram.com/SO.INSTA/' }).situacao, 'instagram_repetido')
  assert.deepEqual(avisos.map((a) => a.evento), ['stylist_criada', 'stylist_criada', 'stylist_criada'])
})

test('telefone canônico: o mesmo de vessel_telefone_canonico', () => {
  assert.equal(telefoneCanonico('(19) 99999-0000'), '5519999990000')
  assert.equal(telefoneCanonico('1933334444'), '551933334444')
  assert.equal(telefoneCanonico('+55 19 99999-0000'), '5519999990000')
  assert.equal(telefoneCanonico('999990000'), null)
  assert.equal(telefoneCanonico('4419999990000'), null)
})

test('a etapa muda só por mover_de_etapa; a data da prospecção nasce na etapa marcada; tudo no histórico', () => {
  const { chamar, banco, avisos } = novoBanco()
  chamar('vessel_stylist_criar', PARCEIRA)
  const s = () => banco.estado.stylists.find((x) => x.codigo === NOVA)
  // A Central antiga ainda manda `p_estagio`: recusado, a etapa agora é pela ficha.
  assert.equal(chamar('vessel_stylist_editar', { p_codigo: NOVA, p_estagio: 'contatado' }).situacao, 'etapa_pela_ficha')
  assert.equal(chamar('vessel_stylist_mover_de_etapa', { p_codigo: NOVA, p_etapa_id: 999 }).situacao, 'etapa_invalida')
  assert.equal(chamar('vessel_stylist_mover_de_etapa', { p_codigo: 'STY-9999', p_etapa_id: ETAPA.Convidado }).situacao, 'nao_achei')
  chamar('vessel_stylist_mover_de_etapa', { p_codigo: NOVA, p_etapa_id: ETAPA['Classificação'] })
  assert.equal(s().prospectado_em, null, 'antes da etapa marcada, sem data')
  const r = chamar('vessel_stylist_mover_de_etapa', { p_codigo: NOVA, p_etapa_id: ETAPA.Convidado })
  assert.deepEqual(r, { ok: true, situacao: 'ok', codigo: NOVA, etapa: 'Convidado', libera_private_edit: false, prospectado_em: HOJE })
  assert.equal(chamar('vessel_stylist_mover_de_etapa', { p_codigo: NOVA, p_etapa_id: ETAPA.Convidado }).situacao, 'sem_mudanca')
  const h = chamar('vessel_stylist_historico_de_etapas', { p_codigo: NOVA })
  assert.deepEqual(h.map((x) => [x.de, x.para, x.motivo]),
    [['Classificação', 'Convidado', 'mudanca'], ['Identificado', 'Classificação', 'mudanca'], [null, 'Identificado', 'cadastro']])
  assert.deepEqual(avisos.filter((a) => a.evento === 'etapa_mudada').map((a) => a.dados.para), ['Classificação', 'Convidado'])
})

test('as etapas: criar, renomear, reordenar, saída, a marca e excluir com destino', () => {
  const { chamar, banco } = novoBanco()
  const nomes = () => chamar('vessel_stylist_etapas').map((e) => e.nome)
  const nova = chamar('vessel_stylist_etapa_criar', { p_nome: ' Qualificada ', p_posicao: 3 })
  assert.equal(nova.ok, true)
  assert.deepEqual(nomes(), ['Identificado', 'Classificação', 'Qualificada', 'Prospectado', 'Convidado', 'Confirmou Ida', 'Esteve Presente', 'Ativada', 'Desclassificado'])
  assert.equal(chamar('vessel_stylist_etapa_criar', { p_nome: 'qualificada' }).situacao, 'nome_repetido')
  assert.equal(chamar('vessel_stylist_etapa_renomear', { p_id: nova.id, p_nome: 'PROSPECTADO' }).situacao, 'nome_repetido')
  assert.equal(chamar('vessel_stylist_etapa_mover', { p_id: ETAPA.Identificado, p_direcao: 'subir' }).situacao, 'no_limite')
  chamar('vessel_stylist_etapa_mover', { p_id: nova.id, p_direcao: 'subir' })
  assert.equal(nomes()[1], 'Qualificada')
  assert.equal(chamar('vessel_stylist_etapa_tipo', { p_id: ETAPA.Prospectado, p_tipo: 'saida' }).situacao, 'etapa_marcada')
  assert.equal(chamar('vessel_stylist_etapa_marcar_prospectada', { p_id: ETAPA.Desclassificado }).situacao, 'saida_nao_conta')
  assert.equal(chamar('vessel_stylist_etapa_excluir', { p_id: ETAPA.Prospectado }).situacao, 'etapa_marcada')
  // A Carol (exemplo) está em Classificação: excluir exige o destino, e move ela.
  assert.deepEqual(chamar('vessel_stylist_etapa_excluir', { p_id: ETAPA['Classificação'] }), { ok: false, situacao: 'precisa_destino', stylists: 1 })
  assert.equal(chamar('vessel_stylist_etapa_excluir', { p_id: ETAPA['Classificação'], p_destino: ETAPA['Classificação'] }).situacao, 'destino_invalido')
  const exc = chamar('vessel_stylist_etapa_excluir', { p_id: ETAPA['Classificação'], p_destino: ETAPA.Identificado })
  assert.deepEqual(exc, { ok: true, situacao: 'ok', id: ETAPA['Classificação'], movidas: 1 })
  assert.equal(banco.estado.stylists.find((x) => x.codigo === 'STY-0006').etapa_id, ETAPA.Identificado)
  assert.equal(chamar('vessel_stylist_historico_de_etapas', { p_codigo: 'STY-0006' })[0].motivo, 'etapa_excluida')
  assert.deepEqual(chamar('vessel_stylist_etapas').map((e) => e.ordem), [1, 2, 3, 4, 5, 6, 7, 8], 'a ordem fecha, sem buraco')
  // A marca muda; as datas gravadas ficam.
  const marinaAntes = banco.estado.stylists.find((x) => x.codigo === 'STY-0001').prospectado_em
  assert.equal(chamar('vessel_stylist_etapa_marcar_prospectada', { p_id: nova.id }).ok, true)
  assert.equal(chamar('vessel_stylist_etapas').filter((e) => e.conta_como_prospectada).length, 1)
  assert.equal(banco.estado.stylists.find((x) => x.codigo === 'STY-0001').prospectado_em, marinaAntes)
})

test('a última etapa de funil não sai (nem excluída)', () => {
  const { chamar } = novoBanco()
  const funis = () => chamar('vessel_stylist_etapas').filter((e) => e.tipo === 'funil')
  for (const e of funis()) {
    if (e.conta_como_prospectada) continue
    chamar('vessel_stylist_etapa_excluir', { p_id: e.id, p_destino: ETAPA.Prospectado })
  }
  assert.deepEqual(funis().map((e) => e.nome), ['Prospectado'])
  assert.equal(chamar('vessel_stylist_etapa_excluir', { p_id: ETAPA.Prospectado, p_destino: ETAPA.Desclassificado }).situacao, 'ultima_do_funil')
})

test('nenhum movimento automático: encontro marcado ou arquivado não muda a etapa', () => {
  const { chamar, banco } = novoBanco()
  const marina = () => banco.estado.stylists.find((s) => s.codigo === 'STY-0001')
  const antes = marina().etapa_id
  const { codigo } = chamar('vessel_criar_private_edit', { p_stylist: 'STY-0001', p_quando: quandoDaqui(20), p_praca: 'CPS', p_vagas: 8 })
  assert.equal(marina().etapa_id, antes)
  chamar('vessel_private_edit_arquivar', { p_codigo: codigo, p_arquivada: true })
  assert.equal(marina().etapa_id, antes)
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
  ativar(chamar, NOVA) // 24/09/2026: só quem está na Ativada recebe encontro
  const base = { p_stylist: NOVA, p_quando: quandoDaqui(3), p_praca: 'CPS', p_vagas: 8 }
  assert.equal(chamar('vessel_criar_private_edit', { ...base, p_vagas: 6 }).situacao, 'vagas_invalidas')
  assert.equal(chamar('vessel_criar_private_edit', { ...base, p_vagas: 11 }).situacao, 'vagas_invalidas')
  assert.equal(chamar('vessel_criar_private_edit', { ...base, p_praca: null }).situacao, 'praca_invalida')
  assert.equal(chamar('vessel_criar_private_edit', { ...base, p_stylist: 'STY-9999' }).situacao, 'stylist_nao_encontrada')
  assert.equal(chamar('vessel_criar_private_edit', { ...base, p_quando: quandoDaqui(-3) }).situacao, 'data_no_passado')
  assert.equal(chamar('vessel_private_edit_editar', { p_codigo: `PE-20260926-CPS-01`, p_vagas: 6 }).situacao, 'nao_achei')
})

test('criar encontro ATIVA a stylist (ativada_em, não a etapa), com código PE-AAAAMMDD-PRACA-NN e chave de 8 letras', () => {
  const { chamar, banco, avisos } = novoBanco()
  chamar('vessel_stylist_criar', PARCEIRA)
  ativar(chamar, NOVA) // 24/09/2026: só quem está na Ativada recebe encontro
  const r = chamar('vessel_criar_private_edit', { p_stylist: NOVA, p_quando: quandoDaqui(0, '10:00'), p_praca: 'cps', p_vagas: 8 })
  assert.equal(r.ok, true)
  assert.equal(r.codigo, 'PE-20260923-CPS-01')
  assert.match(r.chave, /^[ABCDEFGHJKMNPQRSTVWXYZ23456789]{8}$/)
  const s = banco.estado.stylists.find((x) => x.codigo === NOVA)
  assert.equal(s.etapa_id, ETAPA.Ativada, 'a etapa não muda sozinha (continua onde a pessoa pôs)')
  assert.ok(s.ativada_em)
  // Segundo encontro na mesma praça e no mesmo dia: -02.
  const r2 = chamar('vessel_criar_private_edit', { p_stylist: NOVA, p_quando: quandoDaqui(0, '20:00'), p_praca: 'CPS', p_vagas: 8 })
  assert.equal(r2.codigo, 'PE-20260923-CPS-02')
  const aviso = avisos.find((a) => a.evento === 'encontro_criado')
  assert.deepEqual(aviso.dados, { codigo: 'PE-20260923-CPS-01', stylist: NOVA })
})

test('a ativação congela: cancelar o único encontro não desfaz ativada_em', () => {
  const { chamar, banco } = novoBanco()
  chamar('vessel_stylist_criar', PARCEIRA)
  ativar(chamar, NOVA) // 24/09/2026: só quem está na Ativada recebe encontro
  const { codigo } = chamar('vessel_criar_private_edit', { p_stylist: NOVA, p_quando: quandoDaqui(4), p_praca: 'CPS', p_vagas: 8 })
  const s = banco.estado.stylists.find((x) => x.codigo === NOVA)
  const ativada = s.ativada_em
  assert.equal(chamar('vessel_private_edit_situacao', { p_codigo: codigo, p_status: 'cancelado', p_motivo: 'chuva' }).ok, true)
  assert.equal(s.ativada_em, ativada)
  chamar('vessel_private_edit_arquivar', { p_codigo: codigo, p_arquivada: true })
  assert.equal(s.ativada_em, ativada)
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
  ativar(chamar, NOVA) // 24/09/2026: só quem está na Ativada recebe encontro
  const { codigo } = chamar('vessel_criar_private_edit', { p_stylist: NOVA, p_quando: quandoDaqui(2), p_praca: 'CPS', p_vagas: 8 })
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
  ativar(chamar, NOVA) // 24/09/2026: só quem está na Ativada recebe encontro
  const { codigo } = chamar('vessel_criar_private_edit', { p_stylist: NOVA, p_quando: quandoDaqui(2), p_praca: 'CPS', p_vagas: 8 })
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

test('registrar contato grava o histórico e NÃO sugere nem move etapa', () => {
  const { chamar, banco } = novoBanco()
  chamar('vessel_stylist_criar', PARCEIRA)
  const r = chamar('vessel_stylist_registrar_contato', { p_codigo: NOVA, p_canal: 'whatsapp', p_resultado: 'conversou' })
  assert.equal(r.ok, true)
  assert.equal('sugestao' in r, false)
  assert.equal(banco.estado.stylists.find((s) => s.codigo === NOVA).etapa_id, ETAPA.Identificado)
  assert.equal(chamar('vessel_stylist_registrar_contato', { p_codigo: NOVA, p_canal: 'pombo', p_resultado: 'conversou' }).situacao, 'canal_invalido')
  assert.equal(chamar('vessel_stylist_registrar_contato', { p_codigo: NOVA, p_canal: 'email', p_resultado: 'x' }).situacao, 'resultado_invalido')
  assert.equal(chamar('vessel_stylist_registrar_contato', { p_codigo: NOVA, p_canal: 'email', p_resultado: 'conversou', p_nota: 'x'.repeat(501) }).situacao, 'nota_longa')
  // O histórico: mais novo primeiro.
  const h = chamar('vessel_stylist_contatos', { p_codigo: NOVA })
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
  // (+ a compra da Lívia no encontro da Luísa, o bloco do scorecard de 24/09.)
  assert.equal(conta.reduce((a, e) => a + e.receita, 0), 1850 + 2890 + 2400)
  const comprou = banco.chamar('vessel_convidadas_do_encontro', { p_codigo: 'PE-20260911-CPS-01' }).filter((c) => c.comprou)
  assert.deepEqual(comprou.map((c) => c.pessoa_id), [2204])
})

test('o placar fecha com o estado — e muda quando o encontro é realizado', () => {
  const { chamar } = novoBanco()
  const tudo = () => chamar('vessel_placar_do_stylist_circle', { p_de: null, p_ate: null, p_dias: 14 })
  const antes = tudo()
  // Conferência contra os dados de exemplo, número por número. (24/09: com a
  // Luísa — um realizado, um cancelado, 4 convidadas, 2 presentes, 1 venda.)
  assert.equal(antes.prospectadas, 4)
  assert.equal(antes.ativadas, 2)
  assert.equal(antes.prospectadas_ja_ativadas, 2)
  assert.equal(antes.encontros_agendados, 5)
  assert.equal(antes.encontros_realizados, 3)
  assert.equal(antes.encontros_cancelados, 1)
  assert.equal(antes.convidadas, 14)
  assert.equal(antes.confirmadas, 11) // 3 + 4 (sim, inclusive quem faltou) + 1 (Júlia, do agendado) + 3 da Luísa
  assert.equal(antes.confirmadas_em_realizados, 10)
  assert.equal(antes.presentes, 7)
  assert.equal(antes.presentes_em_realizados, 7)
  assert.equal(antes.recorrentes_no_periodo, 1)
  assert.equal(antes.recorrentes_ate_o_fim, 1)
  assert.equal(antes.ativadas_ate_o_fim, 2)
  assert.equal(antes.intervalos, 1)
  assert.equal(antes.intervalo_medio_em_dias, 28)
  assert.equal(antes.contatos_ate_ativar, 2.5) // Marina 3, Luísa 2
  assert.equal(antes.stylists_com_contatos_ate_ativar, 2)
  assert.equal(antes.vendas, 3)
  assert.equal(antes.compradoras, 3)
  assert.equal(antes.pecas, 4)
  assert.equal(antes.receita, 7140)
  assert.deepEqual(antes.por_stylist, [
    { codigo: 'STY-0001', nome: 'Marina Castro (exemplo)', encontros_realizados: 2, vendas: 2, receita: 4740 },
    { codigo: 'STY-0004', nome: 'Luísa Andrade (exemplo)', encontros_realizados: 1, vendas: 1, receita: 2400 },
  ])

  // O roteiro inteiro, pelas funções: parceira nova, avançada até Prospectado,
  // encontro hoje, duas convidadas, presença, realizado.
  chamar('vessel_stylist_criar', PARCEIRA)
  assert.equal(tudo().prospectadas, antes.prospectadas, 'em Identificado ela ainda não conta como prospectada')
  chamar('vessel_stylist_mover_de_etapa', { p_codigo: NOVA, p_etapa_id: ETAPA.Prospectado })
  // 24/09/2026: e só na Ativada ela pode receber o encontro (e é aí que ativa).
  assert.equal(chamar('vessel_criar_private_edit', { p_stylist: NOVA, p_quando: quandoDaqui(0, '10:00'), p_praca: 'CPS', p_vagas: 8 }).situacao,
    'stylist_nao_liberada')
  assert.equal(tudo().ativadas, antes.ativadas, 'em Prospectado ela ainda não ativou')
  ativar(chamar, NOVA)
  assert.equal(tudo().ativadas, antes.ativadas + 1, 'chegou na Ativada: ativou, antes de qualquer encontro')
  const { codigo } = chamar('vessel_criar_private_edit', { p_stylist: NOVA, p_quando: quandoDaqui(0, '10:00'), p_praca: 'CPS', p_vagas: 8 })
  const a = chamar('vessel_convidar_para_encontro', { p_codigo: codigo, p_nome: 'Olga (exemplo)', p_whatsapp: '19966660001' })
  const b = chamar('vessel_convidar_para_encontro', { p_codigo: codigo, p_nome: 'Pietra (exemplo)', p_whatsapp: '19966660002' })
  chamar('vessel_convite_marcar', { p_id: a.id, p_marca: 'sim' })
  chamar('vessel_convite_marcar', { p_id: b.id, p_marca: 'sim' })
  chamar('vessel_situacao_do_atendimento', { p_id: a.id, p_situacao: 'realizado' })
  chamar('vessel_situacao_do_atendimento', { p_id: b.id, p_situacao: 'no_show' })
  chamar('vessel_private_edit_situacao', { p_codigo: codigo, p_status: 'realizado', p_realizado_em: HOJE })
  const depois = tudo()
  assert.equal(depois.prospectadas, 5)
  assert.equal(depois.ativadas, 3)
  assert.equal(depois.encontros_agendados, 6)
  assert.equal(depois.encontros_realizados, 4)
  assert.equal(depois.convidadas, 16)
  assert.equal(depois.confirmadas_em_realizados, 12)
  assert.equal(depois.presentes_em_realizados, 8)
  assert.equal(depois.contatos_ate_ativar, 1.7) // Marina 3, Luísa 2, a nova 0
  assert.equal(depois.por_stylist.length, 3)
  // O rastreio concorda: 1 realizado — e a etapa é a que a pessoa escolheu.
  const nova = chamar('vessel_rastreio_dos_stylists', { p_dias: 14 }).find((s) => s.codigo === NOVA)
  assert.equal(nova.etapa, 'Ativada')
  assert.equal(nova.encontros_realizados, 1)
  assert.equal(nova.proxima_data_permitida, '2026-11-07')
})

test('o placar recorta pelo período: cada número pela sua data', () => {
  const { chamar } = novoBanco()
  // Só setembro/2026: o encontro de -40 (14/08) fica de fora.
  const set = chamar('vessel_placar_do_stylist_circle', { p_de: '2026-09-01', p_ate: '2026-09-30' })
  assert.equal(set.prospectadas, 2) // Paula (03/09) e Renata (20/09); Marina é de julho
  assert.equal(set.ativadas, 0) // Marina ativou em julho
  assert.equal(set.encontros_agendados, 3) // + o cancelado da Luísa (15/09)
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

// ════════════════════════════════════════════════════════════════════════════
// BEAUTY SESSIONS e PRIVATE APPOINTMENT (23/09/2026: "quando fui selecionar
// local lá deu tela branca"). A função de conta não existia no banco de
// mentira; a resposta de "não previsto" era um OBJETO, a tela esperava LISTA,
// e o filtro dela quebrou a Central inteira. Aqui o formato é o do SQL.
// ════════════════════════════════════════════════════════════════════════════
const S1 = 'BS-20260914-CPS-01', S2 = 'BS-20260921-SBO-01', S3 = 'BS-20260929-CPS-02', S4 = 'BS-20260824-BSB-01'

test('conta das Beauty Sessions: LISTA com as chaves do json_build_object do SQL, na ordem', () => {
  const { chamar } = novoBanco()
  const lista = chamar('vessel_conta_das_beauty_sessions', { p_dias: 7, p_incluir_arquivadas: false })
  assert.ok(Array.isArray(lista), 'a tela faz .filter na resposta: tem de ser lista')
  // `2026-09-19-vessel-beauty-sessions-lista-devolve-arquivada.sql`, linha a linha.
  assert.deepEqual(Object.keys(lista[0]), ['codigo', 'quando', 'praca', 'loja', 'parceiro', 'ativa', 'arquivada',
    'leituras_mesa', 'leituras_cartao', 'pessoas', 'pessoas_qr', 'pessoas_equipe', 'pedidos', 'confirmados', 'compareceram', 'receita',
    'janela_de_venda_em_dias'])
  // `order by quando desc`, e a arquivada fica de fora por padrão.
  assert.deepEqual(lista.map((s) => s.codigo), [S3, S2, S1])
  const aurora = lista.find((s) => s.codigo === S1)
  assert.deepEqual(aurora, { codigo: S1, quando: '2026-09-14', praca: 'CPS', loja: 'iguatemi',
    parceiro: 'Salão Aurora (exemplo)', ativa: false, arquivada: false, leituras_mesa: 38, leituras_cartao: 6,
    pessoas: 4, pessoas_qr: 4, pessoas_equipe: 0, pedidos: 4, confirmados: 3, compareceram: 2,
    // 3480 (visita em 17/09, compra no mesmo dia) + 1290 (visita 18/09, compra 21/09)
    receita: 4770, janela_de_venda_em_dias: 7 })
  const comArquivada = chamar('vessel_conta_das_beauty_sessions', { p_incluir_arquivadas: true })
  assert.deepEqual(comArquivada.map((s) => s.codigo), [S3, S2, S1, S4])
  assert.equal(comArquivada.find((s) => s.codigo === S4).arquivada, true)
  // `p_dias` só mexe na janela da venda: com 0 dias, só a compra do próprio dia.
  assert.equal(chamar('vessel_conta_das_beauty_sessions', { p_dias: 0 }).find((s) => s.codigo === S1).receita, 3480)
})

// ── o cadastro pela equipe (`2026-09-24-beauty-session-cadastro-pela-equipe.sql`) ──
test('cadastrar lead: as conferências e as situações da função de verdade, na ordem', () => {
  const { chamar } = novoBanco()
  const ok = { p_codigo: S2, p_nome: 'Helena Prado (exemplo)', p_whatsapp: '5519988776655' }
  assert.equal(chamar('vessel_beauty_session_cadastrar_lead', { ...ok, p_codigo: 'BS-20990101-CPS-XX' }).situacao, 'nao_achei')
  assert.equal(chamar('vessel_beauty_session_cadastrar_lead', { ...ok, p_codigo: S4 }).situacao, 'sessao_arquivada')
  assert.equal(chamar('vessel_beauty_session_cadastrar_lead', { ...ok, p_nome: ' x ' }).situacao, 'sem_nome')
  assert.equal(chamar('vessel_beauty_session_cadastrar_lead', { ...ok, p_whatsapp: '9900' }).situacao, 'whatsapp_invalido')
  assert.equal(chamar('vessel_beauty_session_cadastrar_lead', { ...ok, p_instagram: 'x'.repeat(121) }).situacao, 'instagram_longo')
  assert.equal(chamar('vessel_beauty_session_cadastrar_lead', { ...ok, p_interesse: 'outra' }).situacao, 'interesse_invalido')
  const r = chamar('vessel_beauty_session_cadastrar_lead', { ...ok, p_interesse: 'rever-uma-peca' })
  assert.equal(r.ok, true)
  assert.equal(r.ja_na_base, false)
  const dup = chamar('vessel_beauty_session_cadastrar_lead', { ...ok, p_nome: 'Outra vez' })
  assert.deepEqual([dup.ok, dup.situacao, dup.porta, dup.nome], [false, 'ja_estava', 'equipe', 'Helena Prado (exemplo)'])
  // A Nathalia (2305) leu o QR do Studio Lírio: a equipe recebe o aviso "pelo QR".
  assert.equal(chamar('vessel_beauty_session_cadastrar_lead', { ...ok, p_whatsapp: '5519970000305' }).porta, 'qr')
  // Encerrada aceita (a Aurora, S1), e a pessoa que já estava na base é a mesma ficha.
  const base = chamar('vessel_beauty_session_cadastrar_lead', { ...ok, p_codigo: S1, p_whatsapp: '5519970000307' })
  assert.deepEqual([base.ok, base.ja_na_base, base.nome], [true, true, 'Sofia Almeida (exemplo)'])
  const lirio = chamar('vessel_conta_das_beauty_sessions', {}).find((s) => s.codigo === S2)
  assert.deepEqual([lirio.pessoas, lirio.pessoas_qr, lirio.pessoas_equipe], [3, 1, 2])
})

test('as leads da sessão: porta, quem cadastrou, foi à loja e comprou', () => {
  const { chamar } = novoBanco()
  const aurora = chamar('vessel_leads_da_beauty_session', { p_codigo: S1, p_dias: 7 })
  assert.equal(aurora.length, 4)
  assert.deepEqual(Object.keys(aurora[0]), ['pessoa_id', 'nome', 'telefone', 'instagram', 'porta', 'entrou_em',
    'cadastrado_por_nome', 'foi_a_loja', 'comprou'])
  const laura = aurora.find((l) => l.pessoa_id === 2301)
  assert.deepEqual([laura.porta, laura.foi_a_loja, laura.comprou], ['qr', true, true])
  const lirio = chamar('vessel_leads_da_beauty_session', { p_codigo: S2 })
  const clara = lirio.find((l) => l.pessoa_id === 2306)
  assert.deepEqual([clara.porta, clara.cadastrado_por_nome], ['equipe', 'Ionara (exemplo)'])
})

test('apagar sessão com lead e sem leitura: tem_leads', () => {
  const { chamar, banco } = novoBanco()
  banco.estado.origens.push({ pessoa_id: 2311, evento_id: S3 })
  assert.equal(chamar('vessel_beauty_session_apagar', { p_codigo: S3 }).situacao, 'tem_leads')
})

test('criar Beauty Session: as conferências e as frases de `vessel_beauty_session_criar`, na ordem', () => {
  const { chamar } = novoBanco()
  const ok = { p_codigo: 'bs-20261005-sbo-07', p_quando: '2026-10-05', p_praca: 'sbo', p_loja: 'tivoli', p_parceiro: '  ' }
  assert.equal(chamar('vessel_beauty_session_criar', { ...ok, p_codigo: 'BS-2026-SBO-1' }).erro,
    'O código precisa ter o formato BS-AAAAMMDD-PRACA-NUMERO, como BS-20260925-CPS-01.')
  assert.deepEqual(chamar('vessel_beauty_session_criar', { ...ok, p_quando: null }), { ok: false, erro: 'Escolha a data da sessão.' })
  assert.equal(chamar('vessel_beauty_session_criar', { ...ok, p_quando: '2026-10-06' }).erro,
    'A data do código (20261005) não é a data da sessão (20261006). Uma das duas está errada.')
  assert.equal(chamar('vessel_beauty_session_criar', { ...ok, p_praca: 'CPS' }).erro, 'A praça do código não é a praça escolhida.')
  assert.equal(chamar('vessel_beauty_session_criar', { ...ok, p_loja: 'shopping' }).erro, 'Escolha a loja.')
  assert.deepEqual(chamar('vessel_beauty_session_criar', ok), { ok: true, codigo: 'BS-20261005-SBO-07' })
  assert.match(chamar('vessel_beauty_session_criar', ok).erro, /^Já existe uma sessão com este código/)
  const nova = chamar('vessel_conta_das_beauty_sessions', {}).find((s) => s.codigo === 'BS-20261005-SBO-07')
  assert.equal(nova.parceiro, null, 'parceiro em branco vira nulo')
  assert.equal(nova.ativa, true)
  assert.equal(nova.leituras_mesa, 0)
})

test('encerrar, editar, arquivar e apagar: cada uma no formato da sua função', () => {
  const { chamar } = novoBanco()
  // encerrar devolve `erro`/`ativa`; as outras três devolvem `situacao`.
  assert.deepEqual(chamar('vessel_beauty_session_encerrar', { p_codigo: S2.toLowerCase(), p_ativa: false }), { ok: true, codigo: S2, ativa: false })
  assert.deepEqual(chamar('vessel_beauty_session_encerrar', { p_codigo: 'BS-X' }), { ok: false, erro: 'Não achei esta sessão.' })
  assert.deepEqual(chamar('vessel_beauty_session_editar', { p_codigo: S2, p_quando: null, p_loja: 'iguatemi' }), { ok: true, situacao: 'ok', codigo: S2 })
  const editada = chamar('vessel_conta_das_beauty_sessions', {}).find((s) => s.codigo === S2)
  assert.equal(editada.loja, 'iguatemi')
  assert.equal(editada.quando, '2026-09-21', 'quando nulo não mexe')
  assert.equal(editada.ativa, false)
  assert.deepEqual(chamar('vessel_beauty_session_editar', { p_codigo: 'BS-X' }), { ok: false, situacao: 'nao_achei' })
  // Arquivar não mexe em `ativa` e tira da lista padrão.
  assert.deepEqual(chamar('vessel_beauty_session_arquivar', { p_codigo: S2, p_arquivada: true }), { ok: true, situacao: 'ok', codigo: S2, arquivada: true })
  assert.equal(chamar('vessel_conta_das_beauty_sessions', {}).some((s) => s.codigo === S2), false)
  assert.equal(chamar('vessel_conta_das_beauty_sessions', { p_incluir_arquivadas: true }).find((s) => s.codigo === S2).ativa, false)
  assert.equal(chamar('vessel_beauty_session_arquivar', { p_codigo: S2, p_arquivada: null }).arquivada, true, 'nulo = arquivar')
  // Sessão já LIDA não se apaga (qualquer peça conta); a sem leitura, sim.
  assert.deepEqual(chamar('vessel_beauty_session_apagar', { p_codigo: S1 }), { ok: false, situacao: 'tem_gente' })
  assert.deepEqual(chamar('vessel_beauty_session_apagar', { p_codigo: S3.toLowerCase() }), { ok: true, situacao: 'ok', codigo: S3 })
  assert.deepEqual(chamar('vessel_beauty_session_apagar', { p_codigo: S3 }), { ok: false, situacao: 'nao_achei' })
})

test('Private Appointment: GET vessel_atendimentos com o filtro do período, a pessoa embutida e a ordem do PostgREST', () => {
  const { banco } = novoBanco()
  // A MESMA busca que tela-de-atendimentos.vue monta ("esta semana": 16/09 a 30/09).
  const de = '2026-09-16', ate = '2026-09-30'
  const busca = 'select=id,pessoa_id,loja,client_advisor,quando,status,convite_codigo,presenca_em,teste,criado_em,'
    + 'pessoa:vessel_pessoas(id,nome,telefone)'
    + `&or=(and(quando.gte.${de}T00:00:00,quando.lte.${ate}T23:59:59),and(quando.is.null,criado_em.gte.${de}T00:00:00,criado_em.lte.${ate}T23:59:59))`
    + '&order=quando.desc.nullslast&limit=500'
  const linhas = banco.ler('vessel_atendimentos', `?${busca}`)
  assert.deepEqual(Object.keys(linhas[0]), ['id', 'pessoa_id', 'loja', 'client_advisor', 'quando', 'status',
    'convite_codigo', 'presenca_em', 'teste', 'criado_em', 'pessoa'])
  assert.deepEqual(Object.keys(linhas[0].pessoa), ['id', 'nome', 'telefone'])
  // Dentro da janela: as 12 visitas + as 3 convidadas do encontro de 28/09
  // (o encontro de 11/09 e o de 14/08 ficam de fora).
  assert.equal(linhas.length, 15)
  // `nullslast`: quem ainda não tem dia vem no fim; o resto do mais novo ao mais velho.
  const semDia = linhas.filter((l) => l.quando == null)
  assert.deepEqual(linhas.slice(-semDia.length), semDia)
  const comDia = linhas.filter((l) => l.quando != null).map((l) => l.quando)
  assert.deepEqual(comDia, [...comDia].sort().reverse())
  assert.equal(linhas.find((l) => l.pessoa.nome === 'Laura Bastos (exemplo)').client_advisor, 'Carolina (exemplo)')
  // "Hoje" só traz o que é de hoje.
  const hoje = banco.ler('vessel_atendimentos', `?select=id,quando&or=(and(quando.gte.${HOJE}T00:00:00,quando.lte.${HOJE}T23:59:59),and(quando.is.null,criado_em.gte.${HOJE}T00:00:00,criado_em.lte.${HOJE}T23:59:59))`)
  assert.equal(hoje.length, 1)
  assert.equal(banco.ler('tabela_que_nao_existe', ''), undefined)
})

test('Private Appointment: GET vessel_pedidos só com situação 9, das pessoas pedidas, na janela', () => {
  const { banco } = novoBanco()
  const linhas = banco.ler('vessel_pedidos', '?situacao_id=eq.9&select=pessoa_id,numero,data_da_venda,data_do_pedido,receita_liquida,total_corrigido'
    + '&pessoa_id=in.(2301,2302,2205,2309)&data_do_pedido=gte.2026-09-16&data_do_pedido=lte.2026-10-07&limit=1000')
  assert.deepEqual(linhas.map((p) => p.pessoa_id).sort(), [2301, 2302, 2309], 'o pedido 12 (cancelado) da 2205 não vem')
  assert.deepEqual(Object.keys(linhas[0]), ['pessoa_id', 'numero', 'data_da_venda', 'data_do_pedido', 'receita_liquida', 'total_corrigido'])
})

test('marcar a visita do Private Appointment grava, mas NÃO marca o passo 8 do roteiro', () => {
  const { chamar, banco, avisos } = novoBanco()
  const visita = banco.estado.atendimentos.find((t) => t.pessoa_id === 2307)
  assert.deepEqual(chamar('vessel_situacao_do_atendimento', { p_id: visita.id, p_situacao: 'realizado' }), { ok: true, situacao: 'realizado', antes: 'confirmado' })
  assert.equal(banco.estado.atendimentos.find((t) => t.id === visita.id).status, 'realizado')
  assert.equal(avisos.filter((a) => a.evento === 'presenca_marcada').length, 0)
  const convidada = banco.estado.atendimentos.find((t) => t.pessoa_id === 2210)
  chamar('vessel_situacao_do_atendimento', { p_id: convidada.id, p_situacao: 'realizado' })
  assert.equal(avisos.filter((a) => a.evento === 'presenca_marcada').length, 1, 'a convidada de encontro continua avisando')
})

test('as visitas novas não mexem nas contas do Stylist Circle', () => {
  const { chamar } = novoBanco()
  const marina = chamar('vessel_rastreio_dos_stylists', { p_dias: 14 }).find((s) => s.codigo === 'STY-0001')
  assert.equal(marina.clientes, 10)
  assert.equal(marina.pedidos, 10)
})

// ════════════════════════════════════════════════════════════════════════════
// STYLIST CIRCLE — O SCORECARD E A NOTA DE QUALIFICAÇÃO (24/09/2026).
// `2026-09-24-vessel-stylist-scorecard-e-qualificacao.sql`: a demonstração tem
// de responder no MESMO formato e com as MESMAS recusas.
// ════════════════════════════════════════════════════════════════════════════
import { readFileSync } from 'node:fs'
// ⚠️ A DEFINIÇÃO VIGENTE do miolo e do scorecard mora na migration MAIS NOVA
// que os reescreveu (24/09/2026: a ativação pela etapa — Private Edit só com
// liberada). O teste lê de lá: é contra o banco de hoje que a demonstração bate.
const MIG_SCORECARD = readFileSync(new URL(
  '../../db/migrations/2026-09-24-vessel-private-edit-so-com-stylist-liberada.sql', import.meta.url), 'utf8')
const corpoDe = (nome) => {
  const i = MIG_SCORECARD.indexOf(`function public.${nome}(`)
  return MIG_SCORECARD.slice(i, MIG_SCORECARD.indexOf('$function$;', i))
}
/** As chaves de um `json(b)_build_object(...)` do SQL: `'chave', valor` — e o
 * valor NÃO é outro texto entre aspas (senão é item de `in ('a', 'b')`). A
 * única chave com valor texto, `'situacao', 'ok'`, entra à mão. */
const chavesDoObjeto = (trecho) => [...new Set([...trecho.matchAll(/'([a-z_]+)',\s+(?!')/g)].map((m) => m[1]))]

test('scorecard: as MESMAS chaves que o banco devolve (placar sem por_stylist + as de uma pessoa)', () => {
  const { chamar } = novoBanco()
  const sc = chamar('vessel_scorecard_da_stylist', { p_codigo: 'STY-0001' })
  // O miolo: o objeto de fora (sem as chaves de dentro de `por_stylist`).
  const miolo = corpoDe('vessel_numeros_do_stylist_circle')
  const doMiolo = chavesDoObjeto(miolo.slice(miolo.indexOf('select json_build_object('), miolo.indexOf("'por_stylist'") + 16))
  const doPlacar = Object.keys(chamar('vessel_placar_do_stylist_circle', {}))
  assert.deepEqual(doPlacar, doMiolo, 'o placar da demonstração tem as chaves do miolo, na ordem')
  const pessoa = corpoDe('vessel_scorecard_da_stylist')
  const daPessoa = chavesDoObjeto(pessoa.slice(pessoa.indexOf('jsonb_build_object(')))
  const esperado = [...doMiolo.filter((k) => k !== 'por_stylist'), ...daPessoa, 'situacao']
  assert.deepEqual(Object.keys(sc).sort(), [...new Set(esperado)].sort())
})

test('scorecard: a soma das fichas = o placar, em todos os períodos; cada ficha = a linha dela em por_stylist', () => {
  const { chamar, banco } = novoBanco()
  const SOMA = ['encontros_agendados', 'encontros_realizados', 'encontros_cancelados', 'convidadas', 'confirmadas',
    'confirmadas_em_realizados', 'presentes', 'presentes_em_realizados', 'vendas', 'pecas', 'receita']
  for (const [p_de, p_ate] of [[null, null], ['2026-09-01', '2026-09-30'], ['2026-08-01', '2026-08-31'], ['2026-12-01', null]]) {
    const pl = chamar('vessel_placar_do_stylist_circle', { p_de, p_ate, p_dias: 14 })
    const fichas = banco.estado.stylists.map((s) => chamar('vessel_scorecard_da_stylist', { p_codigo: s.codigo, p_de, p_ate, p_dias: 14 }))
    for (const k of SOMA) assert.equal(fichas.reduce((a, f) => a + f[k], 0), pl[k], `${p_de}..${p_ate}: ${k}`)
    for (const p of pl.por_stylist) {
      const f = fichas.find((x) => x.codigo === p.codigo)
      assert.deepEqual([f.encontros_realizados, f.vendas, f.receita], [p.encontros_realizados, p.vendas, p.receita])
    }
  }
})

test('scorecard: os números de uma pessoa (próximo encontro, recorrente, dias desde o último, contatos)', () => {
  const { chamar } = novoBanco()
  const marina = chamar('vessel_scorecard_da_stylist', { p_codigo: 'sty-0001' })
  assert.equal(marina.ok, true)
  assert.equal(marina.recorrente, true)
  assert.equal(marina.realizados_desde_o_inicio, 2)
  assert.equal(marina.ultimo_realizado_em, '2026-09-11')
  assert.equal(marina.dias_desde_o_ultimo, 12)
  assert.equal(marina.proximo_encontro_codigo, 'PE-20260928-CPS-01')
  assert.equal(marina.contatos_antes_de_ativar, 3)
  const luisa = chamar('vessel_scorecard_da_stylist', { p_codigo: 'STY-0004' })
  assert.equal(luisa.recorrente, false)
  assert.equal(luisa.encontros_cancelados, 1)
  assert.equal(luisa.proximo_encontro_em, null, 'o cancelado não é "próximo encontro"')
  assert.equal(luisa.contatos_sem_resposta_depois_de_ativar, 1)
  assert.equal(luisa.presentes, 2)
  assert.equal(luisa.receita, 2400)
  // Sem encontro nenhum: zeros e nulos, não erro.
  const paula = chamar('vessel_scorecard_da_stylist', { p_codigo: 'STY-0002' })
  assert.equal(paula.ok, true)
  assert.equal(paula.encontros_agendados, 0)
  assert.equal(paula.receita, 0)
  assert.equal(paula.ultimo_realizado_em, null)
  assert.equal(paula.contatos_antes_de_ativar, null)
  assert.deepEqual(chamar('vessel_scorecard_da_stylist', { p_codigo: 'STY-9999' }), { ok: false, situacao: 'nao_achei' })
})

test('avaliar: recusa o que o banco recusa, grava nota e faixa, e reavaliar guarda o histórico', () => {
  const { chamar, avisos } = novoBanco()
  const niveis = (c, p, m, a, r) => ({ p_carteira: c, p_portfolio: p, p_mobilizacao: m, p_acesso: a, p_confiabilidade: r })
  assert.deepEqual(chamar('vessel_stylist_avaliar', { p_codigo: 'STY-0002', ...niveis(0, 3, 3, 3, 3) }), { ok: false, situacao: 'nivel_invalido' })
  assert.equal(chamar('vessel_stylist_avaliar', { p_codigo: 'STY-0002', ...niveis(3, 6, 3, 3, 3) }).situacao, 'nivel_invalido')
  assert.equal(chamar('vessel_stylist_avaliar', { p_codigo: 'STY-0002', ...niveis(3, 3, null, 3, 3) }).situacao, 'nivel_invalido')
  assert.equal(chamar('vessel_stylist_avaliar', { p_codigo: 'STY-0002', ...niveis(3, 3, 3, 3, 3), p_observacao: 'x'.repeat(281) }).situacao, 'observacao_longa')
  assert.equal(chamar('vessel_stylist_avaliar', { p_codigo: 'STY-9999', ...niveis(3, 3, 3, 3, 3) }).situacao, 'nao_achei')
  assert.deepEqual(chamar('vessel_stylist_qualificacoes', { p_codigo: 'STY-0002' }), [], 'nenhuma recusa gravou')
  // As bordas das faixas, as mesmas do aplicador.
  for (const [n, nota, faixa] of [[[1, 1, 5, 5, 4], 54, 'C'], [[1, 2, 4, 5, 4], 55, 'B'], [[1, 5, 5, 5, 4], 74, 'B'], [[2, 4, 5, 5, 4], 75, 'A']]) {
    const r = chamar('vessel_stylist_avaliar', { p_codigo: 'STY-0002', ...niveis(...n) })
    assert.deepEqual([r.ok, r.nota, r.faixa], [true, nota, faixa])
  }
  const hist = chamar('vessel_stylist_qualificacoes', { p_codigo: 'STY-0002' })
  assert.equal(hist.length, 4, 'reavaliar não apaga')
  assert.equal(hist[0].nota, 75, 'a mais recente primeiro')
  assert.deepEqual(Object.keys(hist[0]), ['id', 'carteira', 'portfolio', 'mobilizacao', 'acesso', 'confiabilidade',
    'nota', 'faixa', 'observacao', 'avaliado_em', 'avaliado_por_nome'])
  const vig = chamar('vessel_qualificacoes_vigentes', {})
  assert.deepEqual(vig.find((v) => v.codigo === 'STY-0002').faixa, 'A')
  assert.equal(avisos.filter((a) => a.evento === 'stylist_avaliada').length, 4)
})

test('as avaliações de exemplo: Marina B → A, Luísa C, Renata B, Paula sem nota', () => {
  const { chamar } = novoBanco()
  const vig = Object.fromEntries(chamar('vessel_qualificacoes_vigentes', {}).map((v) => [v.codigo, v.faixa]))
  assert.deepEqual(vig, { 'STY-0001': 'A', 'STY-0003': 'B', 'STY-0004': 'C' })
  const marina = chamar('vessel_stylist_qualificacoes', { p_codigo: 'STY-0001' })
  assert.deepEqual(marina.map((q) => [q.faixa, q.nota]), [['A', 78], ['B', 66]])
})

// ════════════════════════════════════════════════════════════════════════════
// 24/09/2026 — `2026-09-24-vessel-private-edit-so-com-stylist-liberada.sql`:
// Private Edit só com stylist liberada, os motivos das saídas e a ativação
// pela etapa. As mesmas regras da migration, na mesma ordem de recusa.
// ════════════════════════════════════════════════════════════════════════════
const MIG_LIBERADA = readFileSync(new URL(
  '../../db/migrations/2026-09-24-vessel-private-edit-so-com-stylist-liberada.sql', import.meta.url), 'utf8')

test('Private Edit só com liberada: Identificado recusa; na Ativada cria; saindo, o encontro fica e o novo recusa', () => {
  const { chamar, banco } = novoBanco()
  chamar('vessel_stylist_criar', PARCEIRA)
  const base = { p_stylist: NOVA, p_praca: 'CPS', p_vagas: 8 }
  const r = chamar('vessel_criar_private_edit', { ...base, p_quando: quandoDaqui(3) })
  assert.equal(r.situacao, 'stylist_nao_liberada')
  assert.match(r.erro, /Identificado/)
  assert.match(r.erro, /Ativada/)
  assert.equal(chamar('vessel_stylists_para_escolher').find((s) => s.codigo === NOVA).libera_private_edit, false)
  const mv = ativar(chamar, NOVA)
  assert.equal(mv.libera_private_edit, true)
  assert.equal(chamar('vessel_stylists_para_escolher').find((s) => s.codigo === NOVA).libera_private_edit, true)
  const ok = chamar('vessel_criar_private_edit', { ...base, p_quando: quandoDaqui(3) })
  assert.equal(ok.ok, true)
  const antes = JSON.stringify(banco.estado.encontros.find((e) => e.codigo === ok.codigo))
  chamar('vessel_stylist_mover_de_etapa', { p_codigo: NOVA, p_etapa_id: ETAPA.Identificado })
  assert.equal(JSON.stringify(banco.estado.encontros.find((e) => e.codigo === ok.codigo)), antes, 'o encontro que já existe fica intacto')
  assert.equal(chamar('vessel_criar_private_edit', { ...base, p_quando: quandoDaqui(5) }).situacao, 'stylist_nao_liberada')
  assert.equal(chamar('vessel_private_edit_editar', { p_codigo: ok.codigo, p_stylist: NOVA, p_local: 'Outro lugar' }).ok, true, 'manter a anfitriã passa')
  assert.equal(chamar('vessel_private_edit_editar', { p_codigo: 'PE-20260928-CPS-01', p_stylist: NOVA }).situacao, 'stylist_nao_liberada', 'trocar por uma não liberada recusa')
  // A marca na tela "Etapas do funil": nenhuma etapa marcada é permitido.
  assert.equal(chamar('vessel_stylist_etapa_liberar_private_edit', { p_id: ETAPA.Ativada, p_libera: false }).ok, true)
  const nenhuma = chamar('vessel_criar_private_edit', { p_stylist: 'STY-0001', p_praca: 'CPS', p_vagas: 8, p_quando: quandoDaqui(7) })
  assert.equal(nenhuma.situacao, 'stylist_nao_liberada')
  assert.match(nenhuma.erro, /nenhuma etapa libera/)
  assert.equal(chamar('vessel_stylist_etapa_liberar_private_edit', { p_id: ETAPA.Identificado, p_libera: true }).ok, true)
  assert.equal(chamar('vessel_criar_private_edit', { ...base, p_quando: quandoDaqui(9) }).ok, true, 'marcou Identificado: ela já pode')
})

test('motivos: saída com motivos exige o motivo (e a nota no "Outro"); vai para o histórico; desativado some da escolha mas fica', () => {
  const { chamar } = novoBanco()
  chamar('vessel_stylist_criar', PARCEIRA)
  const des = () => chamar('vessel_stylist_etapas').find((e) => e.nome === 'Desclassificado')
  const id = (nome) => des().motivos.find((m) => m.nome === nome).id
  assert.deepEqual(des().motivos.map((m) => m.nome), ['Desinteresse', 'Não conecta com a marca', 'Não retornou os contatos',
    'Carteira fora do perfil', 'Portfólio / estética não alinhados', 'Fora da praça (logística)',
    'Não aceitou as condições (Professional Fee)', 'Exclusividade com outra marca', 'Outro'])
  // Os mesmos nove, na mesma ordem, da migration.
  const i = MIG_LIBERADA.indexOf("from unnest(array[")
  const daMigration = [...MIG_LIBERADA.slice(i, MIG_LIBERADA.indexOf(']', i)).matchAll(/'([^']+)'/g)].map((m) => m[1])
  assert.deepEqual(des().motivos.map((m) => m.nome), daMigration)
  const mover = (corpo) => chamar('vessel_stylist_mover_de_etapa', { p_codigo: NOVA, p_etapa_id: ETAPA.Desclassificado, ...corpo })
  assert.equal(mover({}).situacao, 'motivo_obrigatorio')
  assert.equal(mover({ p_motivo_id: 999 }).situacao, 'motivo_invalido')
  assert.equal(mover({ p_motivo_id: id('Outro'), p_nota: '  ' }).situacao, 'nota_obrigatoria')
  assert.equal(mover({ p_motivo_id: id('Não conecta com a marca'), p_nota: 'x'.repeat(501) }).situacao, 'nota_longa')
  assert.equal(mover({ p_motivo_id: id('Não conecta com a marca'), p_nota: ' Estética diferente. ' }).ok, true)
  const h = chamar('vessel_stylist_historico_de_etapas', { p_codigo: NOVA })[0]
  assert.equal(h.motivo_de_saida, 'Não conecta com a marca')
  assert.equal(h.nota, 'Estética diferente.')
  const linha = () => chamar('vessel_rastreio_dos_stylists', { p_dias: 14 }).find((s) => s.codigo === NOVA)
  assert.equal(linha().saida_motivo, 'Não conecta com a marca')
  assert.equal(des().motivos.find((m) => m.nome === 'Não conecta com a marca').stylists, 2, 'a Bianca (exemplo) e a nova')
  // Desativar: some dos ativos, fica no histórico e na lista.
  assert.equal(chamar('vessel_stylist_motivo_ativar', { p_id: id('Não conecta com a marca'), p_ativo: false }).ok, true)
  assert.equal(des().motivos.at(-1).ativo, false)
  assert.equal(chamar('vessel_stylist_historico_de_etapas', { p_codigo: NOVA })[0].motivo_de_saida, 'Não conecta com a marca')
  assert.equal(linha().saida_motivo, 'Não conecta com a marca')
  // A Ativada não tem motivos: não pede nenhum. E voltar ao funil tira o motivo.
  assert.equal(ativar(chamar, NOVA).ok, true)
  chamar('vessel_stylist_mover_de_etapa', { p_codigo: NOVA, p_etapa_id: ETAPA.Identificado })
  assert.equal(linha().saida_motivo, null)
  // Mexer nos motivos.
  assert.equal(chamar('vessel_stylist_motivo_criar', { p_etapa_id: ETAPA.Identificado, p_nome: 'X' }).situacao, 'so_saida')
  assert.equal(chamar('vessel_stylist_motivo_criar', { p_etapa_id: ETAPA.Desclassificado, p_nome: ' desinteresse ' }).situacao, 'nome_repetido')
  const novo = chamar('vessel_stylist_motivo_criar', { p_etapa_id: ETAPA.Desclassificado, p_nome: 'Mudou de área', p_exige_nota: true })
  assert.equal(novo.ok, true)
  assert.equal(chamar('vessel_stylist_motivo_mover', { p_id: id('Desinteresse'), p_direcao: 'subir' }).situacao, 'no_limite')
  assert.equal(chamar('vessel_stylist_motivo_renomear', { p_id: novo.id, p_nome: 'Mudou de profissão' }).ok, true)
  assert.equal(chamar('vessel_stylist_motivo_exigir_nota', { p_id: novo.id, p_exige: false }).ok, true)
  assert.deepEqual(des().motivos.filter((m) => m.ativo).map((m) => m.ordem), [1, 2, 3, 4, 5, 6, 7, 8, 9])
})

test('excluir etapa com destino numa saída com motivos pede o motivo, e ele vai para o histórico de todas', () => {
  const { chamar } = novoBanco()
  const motivo = chamar('vessel_stylist_etapas').find((e) => e.nome === 'Desclassificado').motivos[0].id
  assert.equal(chamar('vessel_stylist_etapa_excluir', { p_id: ETAPA['Classificação'], p_destino: ETAPA.Desclassificado }).situacao, 'motivo_obrigatorio')
  assert.equal(chamar('vessel_stylist_etapa_excluir', { p_id: ETAPA['Classificação'], p_destino: ETAPA.Desclassificado, p_motivo_id: motivo }).ok, true)
  const h = chamar('vessel_stylist_historico_de_etapas', { p_codigo: 'STY-0006' })[0]
  assert.deepEqual([h.para, h.motivo, h.motivo_de_saida], ['Desclassificado', 'etapa_excluida', 'Desinteresse'])
})

test('ativação pela etapa: a chegada na Ativada; sem ela, o primeiro encontro (a turma antiga); e o número de antes não some', () => {
  const { chamar } = novoBanco()
  const pl = chamar('vessel_placar_do_stylist_circle', {})
  // Marina chegou na Ativada; Luísa teve encontro sem nunca passar por ela.
  assert.equal(pl.ativadas, 2)
  assert.equal(pl.ativadas_por_encontro_antigo, 1)
  assert.equal(pl.com_private_edit_agendado, 2, 'o "ativadas" de antes (primeiro encontro) continua, com o nome dele')
  assert.equal(pl.com_private_edit_realizado, 2)
  const luisa = chamar('vessel_scorecard_da_stylist', { p_codigo: 'STY-0004' })
  assert.equal(luisa.ativada_por_encontro_antigo, true)
  assert.equal(luisa.ativada_em, luisa.private_edit_agendado_em)
  const marina = chamar('vessel_scorecard_da_stylist', { p_codigo: 'STY-0001' })
  assert.equal(marina.ativada_por_encontro_antigo, false)
  // Chegar na Ativada sem encontro já é ativar; desmarcar a etapa depois não reescreve.
  chamar('vessel_stylist_criar', PARCEIRA)
  ativar(chamar, NOVA)
  const ativou = chamar('vessel_scorecard_da_stylist', { p_codigo: NOVA }).ativada_em
  assert.ok(ativou)
  chamar('vessel_stylist_etapa_liberar_private_edit', { p_id: ETAPA.Ativada, p_libera: false })
  assert.equal(chamar('vessel_scorecard_da_stylist', { p_codigo: NOVA }).ativada_em, ativou)
  const depois = chamar('vessel_placar_do_stylist_circle', {})
  assert.equal(depois.ativadas, 3)
  assert.equal(depois.com_private_edit_agendado, 2, 'sem encontro, não conta como agendado')
  // A turma, cada passo dentro do anterior.
  for (const [a, b] of [['prospectadas', 'prospectadas_ja_ativadas'], ['prospectadas_ja_ativadas', 'prospectadas_com_private_edit_agendado'],
    ['prospectadas_com_private_edit_agendado', 'prospectadas_com_private_edit_realizado'],
    ['prospectadas_com_private_edit_realizado', 'prospectadas_recorrentes']]) assert.ok(depois[b] <= depois[a], `${b} ≤ ${a}`)
})

test('código do encontro sem repetir: o que mudou de dia não deixa o próximo repetir o código dele', () => {
  const { chamar } = novoBanco()
  chamar('vessel_stylist_criar', PARCEIRA)
  ativar(chamar, NOVA)
  const um = chamar('vessel_criar_private_edit', { p_stylist: NOVA, p_quando: quandoDaqui(10), p_praca: 'CPS', p_vagas: 8 })
  assert.equal(chamar('vessel_private_edit_editar', { p_codigo: um.codigo, p_quando: quandoDaqui(11) }).ok, true)
  const dois = chamar('vessel_criar_private_edit', { p_stylist: NOVA, p_quando: quandoDaqui(10), p_praca: 'CPS', p_vagas: 8 })
  assert.equal(dois.ok, true)
  assert.equal(dois.codigo, um.codigo.slice(0, -2) + '02')
})
