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

  return { stylists, encontros, pessoas, atendimentos, origens, pedidos, contatos, aberturas }
}
