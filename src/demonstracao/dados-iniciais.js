/* OS DADOS DE EXEMPLO DA DEMONSTRAÇÃO — tudo inventado, e dito que é.
 *
 * ⚠️ NENHUM NOME AQUI É DE GENTE DE VERDADE: cada pessoa leva "(exemplo)" no
 * nome, os telefones são de faixa inventada e os e-mails são `.invalido`.
 * Quem abre a demonstração nunca pode achar que está vendo cliente real.
 *
 * ⚠️ AS DATAS SÃO RELATIVAS A HOJE. A demonstração tem de funcionar em
 * qualquer dia: "o encontro de daqui a 5 dias" é daqui a 5 dias sempre.
 *
 * ⚠️ TRÊS ENCONTROS, NÃO DOIS. O pedido fala numa stylist Recorrente (dois
 * encontros REALIZADOS) e em "um realizado + um agendado". Com só dois
 * encontros a conta não fecha: o gatilho do funil — que o banco de mentira
 * roda igual ao real — rebaixaria a Recorrente para "Evento realizado" no
 * primeiro gesto. Então ela tem dois realizados (um de 40 dias atrás e um de
 * 12, este com as convidadas e a venda) e mais o agendado de daqui a 5 dias.
 *
 * O formato de cada linha é o das TABELAS do banco (`vessel_stylists`,
 * `vessel_private_edits`, `vessel_atendimentos`…), e não o das respostas: as
 * respostas o banco de mentira monta a partir daqui, como o SQL monta.
 */
import { diaEmSaoPaulo, somarDias, instanteEmSaoPaulo } from './tempo.js'

export const USUARIO_DA_DEMONSTRACAO = 'Ionara (exemplo)'

export function dadosIniciais(agora = new Date()) {
  const hoje = diaEmSaoPaulo(agora)
  const dia = (n) => somarDias(hoje, n)
  const em = (n, hora) => instanteEmSaoPaulo(dia(n), hora)
  const compacto = (n) => dia(n).replace(/-/g, '')

  const stylists = [
    {
      id: 1, codigo: 'STY-0001', nome: 'Marina Castro (exemplo)', whatsapp: '5519990000001',
      cidade: 'Campinas', instagram: '@marina.exemplo', atuacao: 'stylist', praca_preview: 'CPS',
      loja: 'iguatemi', origem_contato: 'indicacao', origem_canal: null, responsavel: 'Ionara',
      prospectado_em: dia(-75), proxima_acao: 'Combinar a data do terceiro encontro', proxima_acao_em: dia(6),
      ativada_em: em(-70, '10:00'), estagio: 'recorrente', ativa: true, teste: false,
    },
    {
      id: 2, codigo: 'STY-0002', nome: 'Paula Reis (exemplo)', whatsapp: '5511990000002',
      cidade: 'São Paulo', instagram: '@paula.exemplo', atuacao: 'personal shopper', praca_preview: 'SAO',
      loja: null, origem_contato: 'pesquisa', origem_canal: null, responsavel: 'Ionara',
      prospectado_em: dia(-20), proxima_acao: 'Retornar sobre a proposta do encontro', proxima_acao_em: dia(-2),
      ativada_em: null, estagio: 'em_negociacao', ativa: true, teste: false,
    },
    {
      // Veio pela landing page do Circle: é a porta pública que carimba o canal.
      id: 3, codigo: 'STY-0003', nome: 'Renata Lima (exemplo)', whatsapp: '5519990000003',
      cidade: 'Campinas', instagram: '@renata.exemplo', atuacao: 'consultora de imagem', praca_preview: 'CPS',
      loja: 'tivoli', origem_contato: 'inbound', origem_canal: 'lp', responsavel: null,
      prospectado_em: dia(-3), proxima_acao: null, proxima_acao_em: null,
      ativada_em: null, estagio: 'prospectado', ativa: true, teste: false,
    },
  ]

  const encontros = [
    {
      id: 1, codigo: `PE-${compacto(-40)}-CPS-01`, chave: 'H3N8P4WZ', stylist_id: 1, quando: em(-40, '19:00'),
      local: 'Casa da Marina (exemplo)', praca: 'CPS', loja: 'iguatemi', vagas: 8, ativa: false,
      arquivada: false, status: 'realizado', realizado_em: dia(-40), motivo: null,
      observacoes: 'Primeiro encontro dela.', teste: false,
    },
    {
      id: 2, codigo: `PE-${compacto(-12)}-CPS-01`, chave: 'K7Q2M9TX', stylist_id: 1, quando: em(-12, '19:30'),
      local: 'Loja do Iguatemi Campinas', praca: 'CPS', loja: 'iguatemi', vagas: 10, ativa: false,
      arquivada: false, status: 'realizado', realizado_em: dia(-12), motivo: null,
      observacoes: 'Espumante e a coleção nova.', teste: false,
    },
    {
      id: 3, codigo: `PE-${compacto(5)}-CPS-01`, chave: 'R4V8B2NC', stylist_id: 1, quando: em(5, '19:00'),
      local: 'Loja do Iguatemi Campinas', praca: 'CPS', loja: 'iguatemi', vagas: 9, ativa: true,
      arquivada: false, status: 'agendado', realizado_em: null, motivo: null, observacoes: null, teste: false,
    },
  ]
  const [E1, E2, E3] = encontros.map((e) => e.codigo)

  const pessoas = [
    ['Ana Souza (exemplo)', '5519980000101'], ['Beatriz Nogueira (exemplo)', '5519980000102'],
    ['Carla Mendes (exemplo)', '5519980000103'], ['Débora Faria (exemplo)', '5519980000104'],
    ['Elisa Prado (exemplo)', '5519980000105'], ['Fernanda Costa (exemplo)', '5519980000106'],
    ['Gabriela Rocha (exemplo)', '5519980000107'], ['Helena Martins (exemplo)', '5519980000108'],
    ['Isabela Duarte (exemplo)', '5519980000109'], ['Júlia Ramos (exemplo)', '5519980000110'],
  ].map(([nome, telefone], i) => ({ id: 2201 + i, nome, telefone, email: null }))

  // [pessoa, encontro, status, rsvp, enviado?, dias da inclusão relativos ao encontro]
  let proximoId = 101
  const atendimento = (pessoaId, evento, quandoDoEvento, o) => ({
    id: proximoId++, pessoa_id: pessoaId, loja: 'iguatemi', quando: quandoDoEvento, status: 'solicitado',
    rsvp: null, evento_codigo: evento, convidada_em: null, convite_enviado_em: null, chave_convite: null,
    convite_aberto_em: null, convite_aberturas: 0, presenca_em: null, criado_em: null, teste: false, ...o,
  })
  const q1 = encontros[0].quando, q2 = encontros[1].quando, q3 = encontros[2].quando
  const atendimentos = [
    atendimento(2201, E1, q1, { status: 'realizado', rsvp: 'sim', convidada_em: em(-47, '10:00'), convite_enviado_em: em(-47, '10:05'), presenca_em: q1, criado_em: em(-47, '10:00'), chave_convite: 'AB3CD4EF' }),
    atendimento(2202, E1, q1, { status: 'realizado', rsvp: 'sim', convidada_em: em(-47, '10:00'), convite_enviado_em: em(-47, '10:06'), presenca_em: q1, criado_em: em(-47, '10:00'), chave_convite: 'GH5JK6MN' }),
    atendimento(2203, E1, q1, { status: 'no_show', rsvp: 'sim', convidada_em: em(-47, '10:00'), convite_enviado_em: em(-47, '10:07'), criado_em: em(-47, '10:00'), chave_convite: 'PQ7RS8TV' }),
    atendimento(2204, E2, q2, { status: 'realizado', rsvp: 'sim', convidada_em: em(-20, '11:00'), convite_enviado_em: em(-20, '11:05'), presenca_em: q2, criado_em: em(-20, '11:00'), chave_convite: 'WX9YZ2AB', convite_aberto_em: em(-19, '09:00'), convite_aberturas: 2 }),
    atendimento(2205, E2, q2, { status: 'realizado', rsvp: 'sim', convidada_em: em(-20, '11:00'), convite_enviado_em: em(-20, '11:06'), presenca_em: q2, criado_em: em(-20, '11:00'), chave_convite: 'CD3EF4GH' }),
    atendimento(2206, E2, q2, { status: 'realizado', rsvp: 'sim', convidada_em: em(-20, '11:00'), convite_enviado_em: em(-20, '11:07'), presenca_em: q2, criado_em: em(-20, '11:00'), chave_convite: 'JK5MN6PQ' }),
    atendimento(2207, E2, q2, { status: 'no_show', rsvp: 'sim', convidada_em: em(-20, '11:00'), convite_enviado_em: em(-20, '11:08'), criado_em: em(-20, '11:00'), chave_convite: 'RS7TV8WX' }),
    // O encontro de daqui a 5 dias: três convidadas em três estados diferentes.
    atendimento(2208, E3, q3, { convidada_em: em(-1, '15:00'), criado_em: em(-1, '15:00') }),
    atendimento(2209, E3, q3, { convidada_em: em(-1, '15:00'), convite_enviado_em: em(-1, '15:10'), criado_em: em(-1, '15:00'), chave_convite: 'YZ2AB3CD', convite_aberto_em: em(0, '08:30'), convite_aberturas: 1 }),
    atendimento(2210, E3, q3, { rsvp: 'sim', convidada_em: em(-1, '15:00'), convite_enviado_em: em(-1, '15:11'), criado_em: em(-1, '15:00'), chave_convite: 'EF4GH5JK', convite_aberto_em: em(-1, '18:00'), convite_aberturas: 3 }),
  ]

  // Toda convidada entra com a origem do convite — é por ela que o rastreio da
  // stylist sabe quem ela trouxe (`vessel_origens.stylist_id` = código).
  const origens = atendimentos.map((t) => ({
    pessoa_id: t.pessoa_id, canal: 'private_edit', evento_id: t.evento_codigo, stylist_id: 'STY-0001',
  }))

  // ⚠️ SÓ `situacao_id = 9` (atendido no Bling) CONTA — o 12 (cancelado) está
  // aqui de propósito, para a receita provar que ignora.
  const pedidos = [
    { id: 9001, pessoa_id: 2201, situacao_id: 9, data_do_pedido: dia(-36), receita_liquida: 1850, pecas: 1 },
    { id: 9002, pessoa_id: 2204, situacao_id: 9, data_do_pedido: dia(-9), receita_liquida: 2890, pecas: 2 },
    { id: 9003, pessoa_id: 2205, situacao_id: 12, data_do_pedido: dia(-8), receita_liquida: 990, pecas: 1 },
  ]

  const contatos = [
    { id: 1, stylist_id: 1, canal: 'instagram', resultado: 'sem_resposta', nota: 'Mandei direct apresentando o Circle.', criado_em: em(-74, '09:00'), criado_por_nome: 'Ionara' },
    { id: 2, stylist_id: 1, canal: 'whatsapp', resultado: 'interesse', nota: 'Gostou da ideia, pediu o material.', criado_em: em(-72, '14:00'), criado_por_nome: 'Ionara' },
    { id: 3, stylist_id: 1, canal: 'ligacao', resultado: 'marcou_encontro', nota: null, criado_em: em(-71, '11:00'), criado_por_nome: 'Ionara' },
    { id: 4, stylist_id: 2, canal: 'whatsapp', resultado: 'conversou', nota: 'Atende clientes nos Jardins.', criado_em: em(-18, '10:30'), criado_por_nome: 'Ionara' },
    { id: 5, stylist_id: 2, canal: 'presencial', resultado: 'proposta', nota: 'Pediu a proposta por escrito.', criado_em: em(-9, '16:00'), criado_por_nome: 'Ionara' },
  ]

  // Leituras do link de cada stylist (`vessel_stylist_aberturas`), só a conta.
  const aberturas = { 'STY-0001': 57, 'STY-0002': 4, 'STY-0003': 12 }

  // ── BEAUTY SESSIONS (`vessel_beauty_sessions`) ────────────────────────────
  // Quatro, uma de cada jeito: a que já aconteceu e foi ENCERRADA (com leituras,
  // gente identificada, visita e venda), a de anteontem ainda ABERTA, a que
  // ainda vai acontecer (sem leitura nenhuma — é a única que dá para APAGAR) e
  // uma ARQUIVADA (duplicata), que só aparece no filtro "Situação".
  const S1 = `BS-${compacto(-9)}-CPS-01`, S2 = `BS-${compacto(-2)}-SBO-01`
  const S3 = `BS-${compacto(6)}-CPS-02`, S4 = `BS-${compacto(-30)}-BSB-01`
  const sessoes = [
    { codigo: S1, quando: dia(-9), praca: 'CPS', loja: 'iguatemi', parceiro: 'Salão Aurora (exemplo)', ativa: false, arquivada: false, criado_em: em(-20, '10:00') },
    { codigo: S2, quando: dia(-2), praca: 'SBO', loja: 'tivoli', parceiro: 'Studio Lírio (exemplo)', ativa: true, arquivada: false, criado_em: em(-12, '10:00') },
    { codigo: S3, quando: dia(6), praca: 'CPS', loja: 'iguatemi', parceiro: null, ativa: true, arquivada: false, criado_em: em(-1, '17:00') },
    { codigo: S4, quando: dia(-30), praca: 'BSB', loja: 'parkshopping', parceiro: 'Espaço Nuance (exemplo)', ativa: false, arquivada: true, criado_em: em(-40, '10:00') },
  ]
  // As leituras do QR (`vessel_sessao_aberturas`), só a conta por peça. O
  // "cartão" é o QR antigo, que saiu em 23/09/2026 — o que ele já leu continua.
  const leiturasDasSessoes = { [S1]: { mesa: 38, cartao: 6 }, [S2]: { mesa: 17, cartao: 0 } }

  // ── PRIVATE APPOINTMENT (`vessel_atendimentos` sem encontro) ──────────────
  // Quem veio das Beauty Sessions pedindo visita, e quem ganhou o Appointment
  // Card na loja. Cada situação da agenda aparece pelo menos uma vez.
  const maisPessoas = [
    ['Laura Bastos (exemplo)', '5519970000301'], ['Mariana Teles (exemplo)', '5519970000302'],
    ['Nathalia Vieira (exemplo)', '5519970000303'], ['Olívia Campos (exemplo)', '5519970000304'],
    ['Priscila Antunes (exemplo)', '5519970000305'], ['Raquel Siqueira (exemplo)', '5519970000306'],
    ['Sofia Almeida (exemplo)', '5519970000307'], ['Tatiana Moura (exemplo)', '5519970000308'],
    ['Vanessa Pires (exemplo)', '5561970000309'], ['Yasmin Leal (exemplo)', '5519970000310'],
    ['Clara Bento (exemplo)', '5519970000311'],
  ].map(([nome, telefone], i) => ({ id: 2301 + i, nome, telefone, email: null }))

  let idDaVisita = 301
  const visita = (pessoaId, loja, quando, status, criadoEm, o = {}) => ({
    id: idDaVisita++, pessoa_id: pessoaId, loja, client_advisor: null, quando, status, rsvp: null,
    evento_codigo: null, convite_codigo: null, convidada_em: null, convite_enviado_em: null, chave_convite: null,
    convite_aberto_em: null, convite_aberturas: 0, presenca_em: status === 'realizado' ? quando : null,
    criado_em: criadoEm, teste: false, ...o,
  })
  const CAROLINA = { client_advisor: 'Carolina (exemplo)' }
  const visitas = [
    visita(2301, 'iguatemi', em(-6, '15:00'), 'realizado', em(-9, '16:00'), CAROLINA),
    visita(2302, 'iguatemi', em(-5, '11:00'), 'realizado', em(-9, '16:20'), CAROLINA),
    visita(2303, 'iguatemi', em(-4, '17:30'), 'no_show', em(-9, '17:05'), CAROLINA),
    visita(2304, 'iguatemi', null, 'solicitado', em(-5, '10:00')),
    visita(2305, 'tivoli', em(1, '14:00'), 'confirmado', em(-2, '18:00'), { client_advisor: 'Beatriz (exemplo)' }),
    visita(2306, 'tivoli', null, 'solicitado', em(-1, '09:00')),
    visita(2307, 'iguatemi', em(0, '16:00'), 'confirmado', em(-3, '12:00'), CAROLINA),
    visita(2308, 'iguatemi', em(-1, '10:30'), 'realizado', em(-4, '12:00'), CAROLINA),
    visita(2309, 'parkshopping', em(-2, '15:00'), 'realizado', em(-6, '11:00'), { client_advisor: 'Juliana (exemplo)' }),
    visita(2310, 'iguatemi', em(-3, '19:00'), 'remarcado', em(-7, '15:00'), CAROLINA),
    visita(2310, 'iguatemi', em(3, '19:00'), 'confirmado', em(-3, '19:30'), CAROLINA),
    visita(2311, 'tivoli', em(2, '11:00'), 'cancelado', em(-2, '09:30'), { client_advisor: 'Beatriz (exemplo)' }),
  ]
  // ⚠️ A RAQUEL SIQUEIRA (2306) FOI CADASTRADA PELA EQUIPE no Studio Lírio
  // (24/09/2026): a origem dela leva `offline_equipe`, e a linha de
  // `vessel_beauty_session_cadastros` (em `cadastros`, abaixo) diz quem foi.
  // As outras leram o QR. É o que faz as duas portas aparecerem na demonstração.
  const quandoEntrou = (id) => visitas.find((v) => v.pessoa_id === id)?.criado_em ?? em(-9, '16:00')
  const origensDasVisitas = maisPessoas.map((p) => ({
    pessoa_id: p.id,
    momento: quandoEntrou(p.id),
    canal: p.id <= 2306 ? 'beauty_session' : 'private_appointment',
    evento_id: p.id <= 2304 ? S1 : p.id <= 2306 ? S2 : null,
    stylist_id: null,
    utm_medium: p.id === 2306 ? 'offline_equipe' : p.id <= 2305 ? 'offline_qr' : null,
  }))
  const cadastros = [
    { codigo: S2, pessoa_id: 2306, cadastrado_por_nome: USUARIO_DA_DEMONSTRACAO, criado_em: quandoEntrou(2306) },
  ]
  const pedidosDasVisitas = [
    { id: 9101, numero: 48210, pessoa_id: 2301, situacao_id: 9, data_do_pedido: dia(-6), data_da_venda: dia(-6), receita_liquida: 3480, pecas: 2 },
    { id: 9102, numero: 48266, pessoa_id: 2302, situacao_id: 9, data_do_pedido: dia(-2), data_da_venda: dia(-2), receita_liquida: 1290, pecas: 1 },
    { id: 9103, numero: 48301, pessoa_id: 2309, situacao_id: 9, data_do_pedido: dia(-1), data_da_venda: dia(-1), receita_liquida: 2150, pecas: 1 },
  ]

  return {
    stylists, encontros,
    pessoas: [...pessoas, ...maisPessoas],
    atendimentos: [...atendimentos, ...visitas],
    origens: [...origens, ...origensDasVisitas],
    pedidos: [...pedidos, ...pedidosDasVisitas],
    contatos, aberturas, sessoes, leiturasDasSessoes, cadastros,
  }
}
