// O MCP da Frota (supabase/functions/mcp-frota): o JSON-RPC e as 13 ferramentas, sem rede. Quem fala com o
// banco é o `db` que o index.ts monta com o token DA PESSOA (o RLS e os gatilhos da Frota valem como na tela):
//   listar(tabela, { colunas, filtros: [[coluna, 'eq'|'is_null'|'not_null'|'ilike_qualquer', valor]], ordem: [coluna, desc], limite })
//     ('ilike_qualquer': valor = { coluna: texto já limpo }; casa se QUALQUER coluna contém o texto)
//   inserir(tabela, linha | linhas) -> linhas      editar(tabela, id, campos) -> linhas (vazio = não achou)
//   apagar(tabela, id)      maiorKm(veiculoId) -> número | null      avisar(requisicaoId) -> { ok, ... }
// Erro do banco sobe como Error com a frase do gatilho/RLS; aqui vira isError para o modelo repassar.
// É o mesmo catálogo da versão na API Go (api/internal/mcp/ferramentas.go), que fica no lugar desta na virada.

export const VERSOES = ['2025-06-18', '2025-03-26', '2024-11-05']

export const INSTRUCOES = 'Ferramentas da Frota da RBV (carros da empresa). Valores em reais; datas em ISO 8601 com fuso ' +
  '(ex.: 2026-10-20T14:00:00-03:00). Para agir sobre um carro, ache o id dele com listar_veiculos usando busca ' +
  '(nome ou placa), em vez de listar a frota toda; nas outras listas, filtre por veiculo_id. As listas trazem o ' +
  'carro (nome e placa) em cada linha e omitem campos vazios. Antes de gravar, confirme com a pessoa os números ' +
  'que ela disse. Erro de regra volta com a frase do sistema: repasse-a, não tente contornar.'

// Colunas que cada lista devolve: o que o modelo usa, sem o resto (o rabisco da assinatura em frota_uso, ids
// de cadastro, valores). Cada linha leva o carro junto pelo veiculo_id (chave estrangeira), para não precisar
// de outra rodada só para saber de que carro é. Resposta menor = o ChatGPT lê e responde mais rápido.
const CARRO = 'veiculo:frota_veiculos(nome,placa)'
const COLUNAS = {
  frota_veiculos: 'id,nome,placa,marca,ano,cor,combustivel,situacao,local_texto,contato_nome,contato_telefone,' +
    'seguro_seguradora,seguro_vence_em,oficina_nome,observacao',
  frota_uso: `id,veiculo_id,${CARRO},tipo,pessoa_nome,saida_em,volta_em,km_saida,km_volta,tanque_quartos,destino,finalidade,observacao`,
  frota_requisicoes: `id,veiculo_id,${CARRO},situacao,pessoa_nome,departamento,destino,finalidade,retirada_prevista,` +
    'devolucao_prevista,motivo_decisao,encerrada_motivo,observacao,criada_em,decidida_em',
  frota_abastecimentos: `id,veiculo_id,${CARRO},abastecido_em,km,litros,total_centavos,tanque_depois,combustivel,posto,pessoa_nome,observacao`,
  frota_revisoes: `id,veiculo_id,${CARRO},manutencao_id,item,km,feita_em,oficina,custo_centavos,observacao`,
  frota_plano_revisao: 'id,item,a_cada_km,ativo,ordem,observacao',
}
// PostgREST monta o `or` com vírgula e parêntese: fora do texto da busca
export const limparBusca = (s) => String(s).replace(/[,()*%\\"]/g, ' ').trim().slice(0, 60)

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const SITUACOES_DO_CARRO = ['ativo', 'em_manutencao', 'alienado', 'inativo']
const SITUACOES_DO_PEDIDO = ['pendente', 'aprovada', 'recusada', 'cancelada', 'revogada', 'usada']
const centavos = (reais) => Math.round(reais * 100)

class Recusa extends Error {}
const recusar = (frase) => { throw new Recusa(frase) }

function soConhecidos(args, permitidos) {
  for (const k of Object.keys(args)) if (!permitidos.includes(k)) recusar('argumento desconhecido: ' + k + '. Pode: ' + permitidos.join(', '))
}
function exigirUuid(v, frase) { if (typeof v !== 'string' || !UUID.test(v)) recusar(frase) }

// ---- leitura ----

function listar(tabela, ordem, filtros = {}, padrao = 20) {
  return async (args, { db }) => {
    soConhecidos(args, ['limite', ...Object.keys(filtros)])
    let limite = padrao
    if (args.limite !== undefined) {
      if (!Number.isInteger(args.limite) || args.limite < 1 || args.limite > 200) recusar('limite deve ser um inteiro de 1 a 200')
      limite = args.limite
    }
    const f = []
    for (const [k, montar] of Object.entries(filtros)) if (args[k] !== undefined) f.push(montar(args[k]))
    return db.listar(tabela, { colunas: COLUNAS[tabela], filtros: f, ordem, limite })
  }
}
const porVeiculo = { veiculo_id: (v) => (exigirUuid(v, 'veiculo_id deve ser o uuid do carro (use listar_veiculos)'), ['veiculo_id', 'eq', v]) }

// ---- escrita direta ----

function gravar(tabela, { comId = false, obrigatorios = [], permitidos, autor }) {
  return async (args, { db, usuario }) => {
    const campos = { ...args }
    let id
    if (comId) {
      exigirUuid(campos.id, 'id deve ser o uuid do registro')
      id = campos.id
      delete campos.id
    }
    for (const k of Object.keys(campos)) {
      if (!permitidos.includes(k)) recusar('campo que esta ferramenta não grava: ' + k + '. Pode: ' + permitidos.join(', '))
    }
    for (const k of obrigatorios) if (campos[k] === undefined) recusar('falta ' + k)
    if (!Object.keys(campos).length) recusar('nada para gravar')
    if (campos.veiculo_id !== undefined) exigirUuid(campos.veiculo_id, 'veiculo_id deve ser o uuid do carro (use listar_veiculos)')
    if (comId) {
      const linhas = await db.editar(tabela, id, campos)
      if (!linhas.length) recusar('Não achei esse registro (ou você não pode alterá-lo).')
      return linhas[0]
    }
    if (autor) campos[autor] = usuario
    return (await db.inserir(tabela, campos))[0]
  }
}

// ---- abastecimento: as travas da tela (src/ferramentas/frota/abastecimentos.js) ----

async function registrarAbastecimento(args, { db, usuario, agora }) {
  soConhecidos(args, ['veiculo_id', 'km', 'litros', 'total_reais', 'tanque_depois', 'combustivel', 'abastecido_em', 'posto', 'observacao', 'pessoa_nome'])
  const barra = []
  if (typeof args.veiculo_id !== 'string' || !UUID.test(args.veiculo_id)) barra.push('veiculo_id deve ser o uuid do carro (use listar_veiculos).')
  if (!Number.isInteger(args.km) || args.km <= 0) barra.push('Informe o KM que está no painel.')
  if (!(args.litros > 0)) barra.push('Informe quantos litros foram colocados.')
  if (!(args.total_reais > 0)) barra.push('Informe quanto foi pago.')
  if (!Number.isInteger(args.tanque_depois) || args.tanque_depois < 0 || args.tanque_depois > 4) barra.push('Diga como ficou o tanque depois (0 a 4 quartos; 4 = cheio).')
  if (typeof args.combustivel !== 'string' || !args.combustivel.trim()) barra.push('Informe o combustível.')
  let quando = agora
  if (args.abastecido_em !== undefined) {
    const t = typeof args.abastecido_em === 'string' && /T.*(Z|[+-]\d\d:\d\d)$/.test(args.abastecido_em) ? new Date(args.abastecido_em) : null
    if (!t || isNaN(t)) barra.push('abastecido_em deve ser data e hora ISO 8601 com fuso (ex.: 2026-10-20T14:00:00-03:00).')
    else if (t > new Date(agora.getTime() + 5 * 60e3)) barra.push('A data do abastecimento está no futuro.')
    else quando = t
  }
  if (barra.length) recusar(barra.join(' '))
  // pelo MAIOR km já visto, não pelo mais novo: data errada acontece, o odômetro só anda para frente
  const conhecido = await db.maiorKm(args.veiculo_id)
  if (conhecido != null && args.km < conhecido) {
    recusar(`O KM informado (${args.km}) é menor que o último conhecido deste carro (${conhecido}). Confira o painel.`)
  }
  const linha = {
    veiculo_id: args.veiculo_id, km: args.km, litros: args.litros, total_centavos: centavos(args.total_reais),
    tanque_depois: args.tanque_depois, combustivel: args.combustivel.trim(), abastecido_em: quando.toISOString(), criado_por: usuario,
  }
  for (const k of ['posto', 'observacao', 'pessoa_nome']) if (args[k] !== undefined) linha[k] = args[k]
  const [gravada] = await db.inserir('frota_abastecimentos', linha)
  const preco = args.total_reais / args.litros
  // D39: número que não fecha AVISA, não barra
  const aviso = preco < 1 || preco > 15 ? `Aviso: isso dá R$ ${preco.toFixed(2)} o litro. Confira com a pessoa os dois números.` : ''
  return aviso ? { gravado: gravada, aviso } : gravada
}

// ---- decisão de pedido (as regras de quem pode e de transição ficam nos gatilhos da tabela) ----

async function decidirRequisicao(args, { db }) {
  soConhecidos(args, ['id', 'decisao', 'motivo'])
  exigirUuid(args.id, 'id deve ser o uuid da requisição (use listar_requisicoes)')
  const motivo = typeof args.motivo === 'string' ? args.motivo.trim() : ''
  let campos
  switch (args.decisao) {
    case 'aprovada': campos = { situacao: 'aprovada', motivo_decisao: motivo || null }; break
    case 'recusada':
      if (!motivo) recusar('Diga o motivo da recusa. Quem pediu precisa saber o que fazer diferente.')
      campos = { situacao: 'recusada', motivo_decisao: motivo }; break
    case 'cancelada': case 'revogada':
      if (!motivo) recusar('Diga o motivo. Quem pediu ou está com a reserva precisa saber.')
      campos = { situacao: args.decisao, encerrada_motivo: motivo }; break
    default: recusar('decisao deve ser aprovada, recusada, cancelada ou revogada')
  }
  const linhas = await db.editar('frota_requisicoes', args.id, campos)
  if (!linhas.length) recusar('Não achei esse pedido (ou você não pode decidi-lo).')
  if (args.decisao !== 'aprovada' && args.decisao !== 'recusada') return linhas[0]
  // o mesmo aviso que a tela manda depois de decidir; falhar aqui não desfaz a decisão
  let aviso
  try { aviso = await db.avisar(args.id) } catch { aviso = null }
  return { decidido: linhas[0], aviso: aviso ?? 'A decisão foi gravada, mas o aviso no celular de quem pediu não saiu.' }
}

// ---- manutenção: cabeçalho + trocas, como a tela (tela-de-frota.vue, lancamento-de-manutencao.js) ----

async function lancarManutencao(args, { db, usuario }) {
  soConhecidos(args, ['veiculo_id', 'km', 'feita_em', 'oficina', 'total_reais', 'observacao', 'trocas'])
  exigirUuid(args.veiculo_id, 'veiculo_id deve ser o uuid do carro (use listar_veiculos)')
  if (!Number.isInteger(args.km) || args.km <= 0) recusar('Informe o KM da manutenção.')
  if (args.feita_em !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(String(args.feita_em))) recusar('feita_em deve ser a data AAAA-MM-DD')
  if (!Array.isArray(args.trocas) || args.trocas.length < 1 || args.trocas.length > 30) recusar('trocas deve ter de 1 a 30 itens')
  for (const t of args.trocas) {
    if (!t || typeof t !== 'object') recusar('cada troca é um objeto { item, custo_reais }')
    soConhecidos(t, ['item', 'custo_reais'])
    if (typeof t.item !== 'string' || !t.item.trim()) recusar('cada troca precisa do item')
    if (t.custo_reais !== undefined && !(t.custo_reais >= 0)) recusar('custo_reais não pode ser negativo')
  }
  if (args.total_reais !== undefined && !(args.total_reais >= 0)) recusar('total_reais não pode ser negativo')
  const feita = args.feita_em ?? null
  const oficina = args.oficina ?? null
  const cab = {
    veiculo_id: args.veiculo_id, km: args.km, feita_em: feita, oficina, observacao: args.observacao ?? null,
    total_centavos: args.total_reais === undefined ? null : centavos(args.total_reais), criada_por: usuario,
  }
  const [manut] = await db.inserir('frota_manutencoes', cab)
  const linhas = args.trocas.map((t) => ({
    manutencao_id: manut.id, veiculo_id: args.veiculo_id, item: t.item.trim(), km: args.km, feita_em: feita, oficina,
    custo_centavos: t.custo_reais === undefined ? null : centavos(t.custo_reais),
  }))
  try {
    return { manutencao: manut, trocas: await db.inserir('frota_revisoes', linhas) }
  } catch (e) {
    // o caminho Supabase não tem transação: desfaz o cabeçalho, como a tela faz
    await db.apagar('frota_manutencoes', manut.id).catch(() => {})
    throw e
  }
}

// ---- o catálogo ----

const pLimite = { type: 'integer', minimum: 1, maximum: 200, description: 'Quantas linhas (padrão 50).' }
const pVeiculo = { type: 'string', format: 'uuid', description: 'id do carro (de listar_veiculos).' }
const obj = (properties, required) => ({ type: 'object', ...(required ? { required } : {}), properties, additionalProperties: false })
const texto = { type: 'string' }

const CAMPOS_DO_VEICULO = ['nome', 'marca', 'ano', 'cor', 'combustivel', 'tipo_oleo', 'contrato', 'categoria_comercial',
  'situacao', 'local_texto', 'observacao', 'seguro_seguradora', 'seguro_apolice', 'seguro_vence_em', 'tag_pedagio',
  'rastreador', 'contato_nome', 'contato_telefone', 'contato_papel', 'oficina_nome', 'oficina_telefone']
const esquemaVeiculo = Object.fromEntries(CAMPOS_DO_VEICULO.map((c) => [c, texto]))
Object.assign(esquemaVeiculo, {
  ano: { type: 'integer' }, situacao: { type: 'string', enum: SITUACOES_DO_CARRO },
  local_texto: { type: 'string', description: 'Onde o carro fica.' }, seguro_vence_em: { type: 'string', format: 'date' },
})
const CAMPOS_DO_PLANO = ['item', 'a_cada_km', 'observacao', 'ordem', 'ativo']
const esquemaPlano = { item: texto, a_cada_km: { type: 'integer', minimum: 1 }, observacao: texto, ordem: { type: 'integer' }, ativo: { type: 'boolean' } }

export const FERRAMENTAS = [
  { nome: 'listar_veiculos', titulo: 'Listar veículos', leitura: true,
    descricao: 'Lista os carros da frota com placa, nome, situação (ativo, em_manutencao, alienado, inativo), local, ' +
      'seguro e contatos. Use busca (parte do nome ou da placa) para achar o id de um carro.',
    esquema: obj({
      busca: { type: 'string', description: 'Parte do nome ou da placa (com ou sem hífen).' },
      situacao: { type: 'string', enum: SITUACOES_DO_CARRO }, limite: { ...pLimite, description: 'Quantas linhas (padrão 100).' },
    }),
    rodar: listar('frota_veiculos', ['nome', false], {
      busca: (v) => {
        const t = typeof v === 'string' ? limparBusca(v) : ''
        if (!t) recusar('busca deve ser parte do nome ou da placa')
        return ['nome|placa', 'ilike_qualquer', { nome: t, placa: t.toUpperCase().replace(/[^A-Z0-9]/g, '') || t }]
      },
      situacao: (v) => (!SITUACOES_DO_CARRO.includes(v) && recusar('situacao deve ser ' + SITUACOES_DO_CARRO.join(', ')), ['situacao', 'eq', v]),
    }, 100) },
  { nome: 'listar_usos', titulo: 'Listar retiradas e posses', leitura: true,
    descricao: 'Retiradas e posses dos carros (quem pegou, saída/volta, km), das mais novas para as mais antigas. ' +
      'aberta=true mostra só os carros que estão fora agora.',
    esquema: obj({ veiculo_id: pVeiculo, aberta: { type: 'boolean' }, limite: pLimite }),
    rodar: listar('frota_uso', ['saida_em', true], {
      ...porVeiculo,
      aberta: (v) => (typeof v !== 'boolean' && recusar('aberta deve ser true ou false'), ['volta_em', v ? 'is_null' : 'not_null']),
    }) },
  { nome: 'listar_requisicoes', titulo: 'Listar pedidos de carro', leitura: true,
    descricao: 'Pedidos (reservas) de carro, das retiradas previstas mais novas para as mais antigas.',
    esquema: obj({ veiculo_id: pVeiculo, situacao: { type: 'string', enum: SITUACOES_DO_PEDIDO }, limite: pLimite }),
    rodar: listar('frota_requisicoes', ['retirada_prevista', true], {
      ...porVeiculo,
      situacao: (v) => (!SITUACOES_DO_PEDIDO.includes(v) && recusar('situacao deve ser ' + SITUACOES_DO_PEDIDO.join(', ')), ['situacao', 'eq', v]),
    }) },
  { nome: 'listar_abastecimentos', titulo: 'Listar abastecimentos', leitura: true,
    descricao: 'Abastecimentos, do mais recente ao mais antigo. Valores em centavos (total_centavos).',
    esquema: obj({ veiculo_id: pVeiculo, limite: pLimite }), rodar: listar('frota_abastecimentos', ['abastecido_em', true], porVeiculo) },
  { nome: 'listar_revisoes', titulo: 'Listar revisões feitas', leitura: true,
    descricao: 'Itens trocados nas manutenções (revisões feitas), do mais recente ao mais antigo. Custo em centavos.',
    esquema: obj({ veiculo_id: pVeiculo, limite: pLimite }), rodar: listar('frota_revisoes', ['criada_em', true], porVeiculo) },
  { nome: 'ver_plano_de_revisao', titulo: 'Ver plano de revisão', leitura: true,
    descricao: 'O plano de revisão da frota: cada item e de quantos em quantos km ele se troca.',
    esquema: obj({ limite: pLimite }), rodar: listar('frota_plano_revisao', ['ordem', false]) },

  { nome: 'editar_veiculo', titulo: 'Editar dados do veículo',
    descricao: 'Altera dados de um carro. Não muda placa, Renavam, chassi, patrimônio, responsável nem valores. ' +
      'situacao: ativo, em_manutencao, alienado ou inativo.',
    esquema: obj({ id: { type: 'string', format: 'uuid' }, ...esquemaVeiculo }, ['id']),
    rodar: gravar('frota_veiculos', { comId: true, permitidos: CAMPOS_DO_VEICULO }) },
  { nome: 'registrar_abastecimento', titulo: 'Registrar abastecimento',
    descricao: 'Registra um abastecimento. Recusa KM menor que o último conhecido do carro e data no futuro; avisa ' +
      'quando o preço por litro foge de R$ 1 a R$ 15.',
    esquema: obj({
      veiculo_id: pVeiculo, km: { type: 'integer', minimum: 1, description: 'KM do painel.' }, litros: { type: 'number', exclusiveMinimum: 0 },
      total_reais: { type: 'number', exclusiveMinimum: 0, description: 'Valor pago, em reais.' },
      tanque_depois: { type: 'integer', minimum: 0, maximum: 4, description: 'Quartos de tanque depois (4 = cheio).' },
      combustivel: { type: 'string', description: 'Ex.: gasolina, etanol, diesel.' },
      abastecido_em: { type: 'string', format: 'date-time', description: 'Padrão: agora.' },
      posto: texto, observacao: texto, pessoa_nome: { type: 'string', description: 'Quem abasteceu.' },
    }, ['veiculo_id', 'km', 'litros', 'total_reais', 'tanque_depois', 'combustivel']),
    rodar: registrarAbastecimento },
  { nome: 'pedir_carro', titulo: 'Pedir carro (criar requisição)',
    descricao: 'Cria um pedido de carro, que nasce pendente de aprovação.',
    esquema: obj({
      veiculo_id: pVeiculo, retirada_prevista: { type: 'string', format: 'date-time' }, devolucao_prevista: { type: 'string', format: 'date-time' },
      pessoa_nome: { type: 'string', description: 'Quem vai usar.' }, departamento: texto, destino: texto, finalidade: texto, observacao: texto,
    }, ['veiculo_id', 'retirada_prevista']),
    rodar: gravar('frota_requisicoes', { obrigatorios: ['veiculo_id', 'retirada_prevista'], autor: 'criada_por',
      permitidos: ['veiculo_id', 'retirada_prevista', 'devolucao_prevista', 'pessoa_nome', 'departamento', 'destino', 'finalidade', 'observacao'] }) },
  { nome: 'decidir_requisicao', titulo: 'Decidir pedido de carro',
    descricao: 'Aprova, recusa, cancela ou revoga um pedido de carro. Recusar, cancelar e revogar exigem motivo. ' +
      'Aprovar e recusar avisam no celular de quem pediu.',
    esquema: obj({ id: { type: 'string', format: 'uuid' }, decisao: { type: 'string', enum: ['aprovada', 'recusada', 'cancelada', 'revogada'] }, motivo: texto }, ['id', 'decisao']),
    rodar: decidirRequisicao },
  { nome: 'lancar_manutencao', titulo: 'Lançar manutenção',
    descricao: 'Lança um serviço de manutenção e os itens trocados nele (de 1 a 30). Cada troca entra nas revisões feitas.',
    esquema: obj({
      veiculo_id: pVeiculo, km: { type: 'integer', minimum: 1 }, feita_em: { type: 'string', format: 'date' }, oficina: texto,
      total_reais: { type: 'number', minimum: 0 }, observacao: texto,
      trocas: { type: 'array', minItems: 1, maxItems: 30, items: obj({
        item: { type: 'string', description: 'Use o nome do item do plano de revisão quando houver.' }, custo_reais: { type: 'number', minimum: 0 },
      }, ['item']) },
    }, ['veiculo_id', 'km', 'trocas']),
    rodar: lancarManutencao },
  { nome: 'criar_item_do_plano', titulo: 'Criar item do plano de revisão',
    descricao: 'Acrescenta um item ao plano de revisão (de quantos em quantos km ele se troca).',
    esquema: obj(esquemaPlano, ['item', 'a_cada_km']),
    rodar: gravar('frota_plano_revisao', { obrigatorios: ['item', 'a_cada_km'], permitidos: CAMPOS_DO_PLANO }) },
  { nome: 'editar_item_do_plano', titulo: 'Editar item do plano de revisão',
    descricao: 'Altera um item do plano de revisão. Para tirar um item do plano, use ativo=false.',
    esquema: obj({ id: { type: 'string', format: 'uuid' }, ...esquemaPlano }, ['id']),
    rodar: gravar('frota_plano_revisao', { comId: true, permitidos: CAMPOS_DO_PLANO }) },
]

// responder: uma mensagem JSON-RPC (já decodificada) -> { result } | { error }. ctx = { db, usuario, agora }.
export async function responder(m, ctx) {
  const p = m.params && typeof m.params === 'object' ? m.params : {}
  switch (m.method) {
    case 'initialize':
      return { result: {
        protocolVersion: VERSOES.includes(p.protocolVersion) ? p.protocolVersion : VERSOES[0],
        capabilities: { tools: {} }, serverInfo: { name: 'frota-rbv', title: 'Frota RBV', version: '1' }, instructions: INSTRUCOES,
      } }
    case 'ping': return { result: {} }
    case 'tools/list':
      return { result: { tools: FERRAMENTAS.map((f) => ({
        name: f.nome, title: f.titulo, description: f.descricao, inputSchema: f.esquema,
        annotations: { readOnlyHint: f.leitura, destructiveHint: false, openWorldHint: false },
      })) } }
    case 'tools/call': {
      const f = FERRAMENTAS.find((x) => x.nome === p.name)
      if (!f) return { error: { code: -32602, message: 'ferramenta desconhecida: ' + p.name } }
      const args = p.arguments == null ? {} : p.arguments
      if (typeof args !== 'object' || Array.isArray(args)) return { error: { code: -32602, message: 'arguments deve ser um objeto' } }
      try {
        const saida = await f.rodar(args, ctx)
        // campo nulo não informa nada e custa leitura ao modelo
        const texto = JSON.stringify(saida ?? { ok: true }, (_, v) => (v === null ? undefined : v))
        return { result: { content: [{ type: 'text', text: texto }], isError: false } }
      } catch (e) {
        const frase = e instanceof Recusa ? e.message : 'Não deu certo: ' + (e?.message || 'erro do banco')
        return { result: { content: [{ type: 'text', text: frase }], isError: true } }
      }
    }
  }
  return { error: { code: -32601, message: 'método não suportado: ' + m.method } }
}

// gestorDaFrota: a aba Gestão (src/ferramentas/frota/areas-da-frota.js): frota com criar ou excluir, ou superadmin.
export function gestorDaFrota(perfil) {
  if (perfil?.is_superadmin) return true
  const acoes = perfil?.permissions?.frota || []
  return acoes.includes('criar') || acoes.includes('excluir')
}

// clienteOAuth: o client_id do token (só o servidor OAuth do Supabase Auth o põe). Sem ele, é a sessão da tela,
// que não serve aqui: o token do ChatGPT e o da tela são portas diferentes. Só lê: a assinatura quem confere é
// o auth.getClaims() depois desta triagem.
export function clienteOAuth(token) {
  try {
    const b64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
    const c = JSON.parse(atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4))).client_id
    return typeof c === 'string' && c ? c : ''
  } catch { return '' }
}
