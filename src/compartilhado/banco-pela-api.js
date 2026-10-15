// AS TABELAS QUE JÁ MORAM NA API EM GO, e a ponte que leva até elas (Plano 7).
//
// O front fala com o PostgREST de três jeitos: o supabase-js
// (`sbClient.from('t').select().eq()…`), a URL montada à mão
// (`sb('t?col=eq.x&select=a,b')`, `adFetch('t?id=eq.x', {method:'PATCH'})`) e o
// `gravar` do Admin. A API em Go não aceita nada disso: cada tabela virou uma
// ROTA com filtros NOMEADOS e declarados (`/acesso/usuarios?email=...`), sem
// `select` e sem operadores (`API-PRONTA.md`, "Leitura de domínio").
//
// Em vez de reescrever cada um dos ~300 sítios à mão, a tradução mora AQUI:
//   - `ROTAS`: tabela → rota, a área (a chave de `VITE_API_AREAS`), os filtros
//     que a rota aceita e as ordens que ela declara;
//   - `traduzir`: um pedido no formato PostgREST → o pedido da rota;
//   - duas fachadas que falam o idioma de quem chama: `deOnde(sbClient)` (o
//     encadeado do supabase-js) e `fetchPostgrest(caminho, opcoes)` (o `fetch`
//     cru, com um `Response`).
//
// ⚠️ O QUE A ROTA NÃO SABE FAZER, A TRADUÇÃO RECUSA — ALTO. Filtro que a rota
// não declara, operador sem equivalente, `select` com recurso embutido: tudo
// lança `ErroDeTraducao`. Ignorar um filtro em silêncio devolveria MAIS linhas
// do que a tela pediu (e ela mostraria, gravaria ou apagaria a mais). O erro
// aparece no primeiro clique do ensaio, não em produção: a chave da área
// começa desligada.

import { areaNaApi, pedir, fraseDoCorpo } from './api.js'

export class ErroDeTraducao extends Error {}

// Filtro: coluna → { operador do PostgREST → parâmetro da rota }. O parâmetro
// pode vir com uma conversão do valor: `[param, (v) => valor]`.
const eq = (p) => ({ eq: p })
// Data/instante com faixa: `col=eq|gte|lte` → `col`, `col_de`, `col_ate` (5.6).
const faixa = (c) => ({ eq: c, gte: c + '_de', lte: c + '_ate' })
// `lido_em_de` é INSTANTE (RFC 3339). O PostgREST lia `lido_em=gte.2026-10-01`
// como meia-noite UTC; a rota quer o mesmo instante escrito por extenso.
const instante = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(v) ? v + 'T00:00:00Z' : v)
// O teto de linhas da API (o `max_rows` do Supabase). Pedido acima disso é
// recusado na tradução: cortar calado devolveria número menor sem aviso.
export const TETO_DE_LINHAS = 1000
// `col=is.null` / `col=not.is.null` viram um parâmetro booleano da rota; outro
// valor (`is.true`, `not.eq.x`) não tem tradução.
const nulo = (sim) => (v) => { if (v !== 'null') throw new ErroDeTraducao(`is.${v} sem tradução`); return sim }
const naoNulo = (sim) => (v) => { if (v !== 'is.null') throw new ErroDeTraducao(`not.${v} sem tradução`); return sim }
// Upsert em lote (`POST …/gravar`, até 1000 linhas por chamada): uma chamada por fatia.
const POR_LOTE = 1000
const lotes = (caminho, linhas) => {
  const chamadas = []
  for (let i = 0; i < linhas.length; i += POR_LOTE) chamadas.push({ metodo: 'POST', caminho, corpo: { linhas: linhas.slice(i, i + POR_LOTE) } })
  return chamadas
}
export const ROTAS = {
  // ── 5.1 — admin, equipes e acesso ──
  profiles: {
    area: 'admin', rota: '/acesso/usuarios',
    filtros: { id: eq('id'), email: { eq: 'email', ilike: 'email' }, perfil_id: eq('perfil_id') },
    ordens: ['name', 'email', 'created_at'],
  },
  acessos_perfis: {
    area: 'admin', rota: '/acesso/perfis', filtros: { nome: eq('nome') }, ordens: ['nome'],
    autoria: ['criado_por', 'criado_em'],
  },
  access_requests: { area: 'admin', rota: '/acesso/pedidos', filtros: {}, ordens: [] },
  equipes: { area: 'admin', rota: '/equipes/times', filtros: {}, ordens: ['nome', 'ordem'] },
  equipes_membros: {
    area: 'admin', rota: '/equipes/membros',
    filtros: { equipe_id: eq('equipe_id'), profile_id: eq('profile_id'), papel: { eq: 'papel', in: 'papel' } },
    ordens: ['criado_em'], autoria: ['criado_por', 'criado_em'],
  },
  equipes_permissoes: {
    area: 'admin', rota: '/equipes/permissoes',
    filtros: { equipe_id: eq('equipe_id'), profile_id: eq('profile_id') },
    ordens: ['criado_em'], autoria: ['concedido_por', 'criado_em'],
  },
  canais_grupos: { area: 'admin', rota: '/equipes/grupos', filtros: {}, ordens: ['nome'] },
  canais_grupos_membros: {
    area: 'admin', rota: '/equipes/grupos-membros',
    filtros: { grupo_id: eq('grupo_id'), profile_id: eq('profile_id') },
    ordens: ['concedido_em'], autoria: ['concedido_por', 'concedido_em'],
  },
  push_preferencias: {
    area: 'admin', rota: '/avisos/preferencias', filtros: { user_id: eq('user_id') }, ordens: [],
    autoria: ['alterado_por', 'alterado_em'],
    // O lote (upsert) é UMA chamada: POST com o array (Plano 5.1, Task 9).
    upsert: (linhas) => ({ metodo: 'POST', caminho: '/avisos/preferencias', corpo: linhas }),
  },
  push_subs: {
    area: 'admin', rota: null, filtros: {}, ordens: [],
    upsert: (linhas) => {
      const [l] = linhas
      return { metodo: 'POST', caminho: '/eu/push/inscrever', corpo: { endpoint: l.endpoint, p256dh: l.p256dh, auth: l.auth } }
    },
    // Só o próprio aparelho sai, pelo endpoint.
    apagarPor: { endpoint: (v) => ({ metodo: 'POST', caminho: '/eu/push/desinscrever', corpo: { endpoint: v } }) },
  },
  // ── 5.6 — Meta e redes (métricas) ──
  accounts: { area: 'meta', rota: '/redes/contas', filtros: {}, ordens: ['name'] },
  daily_snapshots: {
    area: 'meta', rota: '/redes/seguidores',
    filtros: { account_id: eq('account_id'), captured_at: faixa('captured_at') }, ordens: ['captured_at'],
  },
  followers_leituras: {
    area: 'meta', rota: '/redes/leituras-de-seguidores',
    filtros: { account_id: eq('account_id'), lido_em: { gte: ['lido_em_de', instante] } }, ordens: ['lido_em'],
  },
  engagement_snapshots: {
    area: 'meta', rota: '/redes/engajamento',
    filtros: { account_id: eq('account_id'), period_days: eq('period_days'), captured_at: faixa('captured_at') }, ordens: ['captured_at'],
  },
  content_snapshots: {
    area: 'meta', rota: '/redes/conteudo',
    filtros: { account_id: eq('account_id'), period_days: { eq: 'period_days', lte: 'period_days_ate' }, captured_at: faixa('captured_at') },
    ordens: ['captured_at', 'period_days'],
  },
  campaigns: { area: 'meta', rota: '/redes/campanhas', filtros: { account_id: eq('account_id') }, ordens: [] },
  campaign_adsets: { area: 'meta', rota: '/redes/conjuntos', filtros: { account_id: eq('account_id') }, ordens: [] },
  ads: { area: 'meta', rota: '/redes/anuncios', filtros: { account_id: eq('account_id') }, ordens: [] },
  campaign_insights: {
    area: 'meta', rota: '/redes/insights-de-campanha',
    filtros: { account_id: eq('account_id'), period_days: eq('period_days'), campaign_id: { eq: 'campaign_id', in: 'campaign_id' }, captured_at: faixa('captured_at') },
    ordens: ['captured_at'],
  },
  account_insights: {
    area: 'meta', rota: '/redes/insights-da-conta',
    filtros: { account_id: eq('account_id'), period_days: eq('period_days'), captured_at: faixa('captured_at') }, ordens: ['captured_at'],
  },
  campaign_insights_hora: { area: 'meta', rota: '/redes/campanhas-por-hora', filtros: { account_id: eq('account_id'), dia: { gte: 'dia_de' } }, ordens: [] },
  ad_insights_hora: { area: 'meta', rota: '/redes/anuncios-por-hora', filtros: { account_id: eq('account_id'), dia: { gte: 'dia_de' } }, ordens: [] },
  perfil_visitas_hora: { area: 'meta', rota: '/redes/visitas-por-hora', filtros: { account_id: eq('account_id'), dia: { gte: 'dia_de' } }, ordens: [] },
  social_metas: {
    area: 'meta', rota: '/redes/metas', filtros: { account_id: eq('account_id') }, ordens: [],
    // o lote é UMA transação (Ruling 7 do 5.6)
    upsert: (linhas) => ({ metodo: 'PUT', caminho: '/redes/metas', corpo: { metas: linhas } }),
  },
  campaign_filters: {
    area: 'meta', rota: '/redes/filtros-de-campanha', filtros: { account_id: eq('account_id') }, ordens: [],
    autoria: ['updated_at'], // o servidor carimba
    upsert: (linhas) => {
      if (linhas.length !== 1) throw new ErroDeTraducao('campaign_filters: um filtro por conta por vez')
      const [l] = linhas
      return { metodo: 'PUT', caminho: `/redes/filtros-de-campanha/${encodeURIComponent(l.account_id)}`, corpo: { selected_ids: l.selected_ids } }
    },
  },
  // ── 5.2 — Patrimônio e cadastros (`/patrimonio/*`; Frota e Acessos leem as mesmas rotas) ──
  patrimonio_bens: {
    area: 'patrimonio', rota: '/patrimonio/bens', filtros: { pessoa_id: eq('pessoa_id') }, ordens: ['numero', 'nome'],
    // os 3 embutidos `{nome}|null` que a rota devolve fixos (substituem `patrimonio_categorias(nome),…` do select)
    embutidos: ['patrimonio_categorias', 'patrimonio_locais', 'patrimonio_comodos'],
    autoria: ['criado_em'],
  },
  patrimonio_posse: {
    area: 'patrimonio', rota: '/patrimonio/posses',
    // `ate is null` = posse aberta; `de` com faixa em datas
    filtros: { bem_id: eq('bem_id'), ate: { is: ['aberta', nulo('true')] }, de: { gte: 'de_desde', lte: 'de_ate' } },
    ordens: ['de'],
  },
  patrimonio_empresas: { area: 'patrimonio', rota: '/patrimonio/empresas', filtros: {}, ordens: ['nome', 'ordem'], autoria: ['criado_em'] },
  patrimonio_locais: { area: 'patrimonio', rota: '/patrimonio/locais', filtros: {}, ordens: ['nome', 'ordem'], autoria: ['criado_em'] },
  patrimonio_comodos: { area: 'patrimonio', rota: '/patrimonio/comodos', filtros: {}, ordens: ['nome', 'ordem'], autoria: ['criado_em'] },
  patrimonio_categorias: {
    area: 'patrimonio', rota: '/patrimonio/categorias',
    filtros: { nome: { ilike: ['nome_como', null, true] } }, ordens: ['nome', 'ordem'], autoria: ['criado_em'],
  },
  patrimonio_tipos: { area: 'patrimonio', rota: '/patrimonio/tipos', filtros: {}, ordens: ['nome', 'ordem'], autoria: ['criado_em'] },
  patrimonio_config: {
    area: 'patrimonio', rota: '/patrimonio/config', filtros: {}, ordens: ['chave'], autoria: ['atualizado_em'], // o servidor carimba
    upsert: (linhas) => {
      if (linhas.length !== 1) throw new ErroDeTraducao('patrimonio_config: uma chave por vez')
      return { metodo: 'PUT', caminho: `/patrimonio/config/${encodeURIComponent(linhas[0].chave)}`, corpo: { valor: linhas[0].valor } }
    },
  },
  // só escreve (nenhuma tela lê o log); `quem` vem da sessão
  patrimonio_log: { area: 'patrimonio', rota: '/patrimonio/log', filtros: {}, ordens: [], autoria: ['quem'] },
  // ── 5.3 — Frota (`/frota/*`). As gravações compostas (ficha, manutenção, troca de posse) não passam
  // por aqui: são `escreverComposto` (uma transação na API) ──
  frota_veiculos: { area: 'frota', rota: '/frota/veiculos', filtros: { pessoa_id: eq('pessoa_id') }, ordens: ['nome'] },
  frota_uso: {
    area: 'frota', rota: '/frota/usos',
    // `volta_em is null` = aberta; `not.is.null` = fechada
    filtros: {
      volta_em: { is: ['aberta', nulo('true')], not: ['aberta', naoNulo('false')] },
      veiculo_id: eq('veiculo_id'), saida_em: { gte: 'saida_de', lte: 'saida_ate' },
    },
    ordens: ['saida_em'],
  },
  frota_requisicoes: { area: 'frota', rota: '/frota/requisicoes', filtros: {}, ordens: ['retirada_prevista'], autoria: ['criada_por'] },
  frota_checklist: {
    area: 'frota', rota: '/frota/checklists',
    filtros: {
      veiculo_id: eq('veiculo_id'), feita_em: { gte: 'feita_de', lte: 'feita_ate' },
      assinada_em: { is: ['assinada', nulo('false')], not: ['assinada', naoNulo('true')] },
    },
    ordens: ['feita_em'],
  },
  frota_checklist_respostas: { area: 'frota', rota: '/frota/checklists/respostas', filtros: { checklist_id: { eq: 'checklist_id', in: 'checklist_id' } }, ordens: ['ordem'] },
  frota_checklist_pdf: {
    area: 'frota', rota: '/frota/checklists/copias',
    // `situacao <> 'enviado'` = a rota `pendente=true`; outro valor não tem par
    filtros: { situacao: { eq: 'situacao', neq: ['pendente', (v) => { if (v !== 'enviado') throw new ErroDeTraducao(`neq.${v} sem tradução`); return 'true' }] } },
    ordens: ['criado_em'],
  },
  frota_checklist_itens: { area: 'frota', rota: '/frota/checklist-itens', filtros: {}, ordens: ['ordem'] },
  // linha única (`id = true`, fixada pela rota): o PATCH não leva id
  frota_checklist_config: { area: 'frota', rota: '/frota/checklist-config', filtros: {}, ordens: [], linhaUnica: true },
  frota_plano_revisao: { area: 'frota', rota: '/frota/plano-revisao', filtros: {}, ordens: ['ordem'] },
  frota_revisoes: { area: 'frota', rota: '/frota/revisoes', filtros: {}, ordens: [] },
  frota_abastecimentos: { area: 'frota', rota: '/frota/abastecimentos', filtros: {}, ordens: ['abastecido_em'], autoria: ['criado_por'] },
  // ── 5.5 — Comercial: Bling e Shopify (`/comercial/*`) ──
  bling_lojas: {
    area: 'comercial', rota: '/comercial/lojas', filtros: {}, ordens: ['nome', 'loja_id'],
    chave: 'loja_id', // PATCH /comercial/lojas/{loja_id}
  },
  bling_depositos: { area: 'comercial', rota: '/comercial/depositos', filtros: {}, ordens: ['nome'] },
  bling_metas: { area: 'comercial', rota: '/comercial/metas-lojas', filtros: { year: eq('ano'), month: eq('mes') }, ordens: [] },
  bling_vendedor_metas: { area: 'comercial', rota: '/comercial/metas-vendedoras', filtros: { year: eq('ano'), month: eq('mes') }, ordens: [] },
  bling_vendedores: {
    area: 'comercial', rota: '/comercial/vendedoras', filtros: {}, ordens: ['nome'],
    upsert: (linhas) => lotes('/comercial/vendedoras/gravar', linhas),
  },
  bling_pedido_vendedor: {
    area: 'comercial', rota: '/comercial/pedidos-vendedor', filtros: { pedido_id: { in: 'pedido_id', eq: 'pedido_id' } }, ordens: ['pedido_data'],
    paginaAteOLimite: true, // admin: `.limit(5000)` dos últimos pedidos
    upsert: (linhas) => lotes('/comercial/pedidos-vendedor/gravar', linhas),
  },
  bling_pedido_nota: {
    area: 'comercial', rota: '/comercial/notas', filtros: {}, ordens: [],
    // o `.or(and(data_da_venda…),and(data_pedido…))` da tela é a `janela` da rota
    ou: (texto) => {
      const m = /^and\(data_da_venda\.gte\.(\d{4}-\d\d-\d\d),data_da_venda\.lte\.(\d{4}-\d\d-\d\d)\),and\(data_pedido\.gte\.(\d{4}-\d\d-\d\d),data_pedido\.lte\.(\d{4}-\d\d-\d\d)\)$/.exec(texto)
      if (!m || m[1] !== m[3] || m[2] !== m[4]) throw new ErroDeTraducao(`or sem tradução: ${texto}`)
      return { janela: `[${m[1]},${m[2]}]` }
    },
  },
  bling_pedido_ajuste_valor: { area: 'comercial', rota: '/comercial/ajustes-de-valor', filtros: {}, ordens: [] },
  bling_pedido_ajuste_vendedor: { area: 'comercial', rota: '/comercial/ajustes-de-vendedor', filtros: {}, ordens: [] },
  bling_pedido_forma_pagamento: { area: 'comercial', rota: '/comercial/formas-de-pagamento', filtros: { eh_devolucao: eq('eh_devolucao') }, ordens: [] },
  gc_estoque_item: { area: 'comercial', rota: '/comercial/estoque', filtros: { deposito_id: { in: 'deposito_id', eq: 'deposito_id' } }, ordens: [] },
  gc_vendas_item: { area: 'comercial', rota: '/comercial/vendas-por-item', filtros: { mes: { in: 'mes', eq: 'mes' } }, ordens: [] },
  shopify_pedidos: {
    area: 'comercial', rota: '/comercial/pedidos-shopify',
    // `criado_ate` é EXCLUSIVO na rota (`<`), como o `.lt` da tela
    filtros: { criado_em_shopify: { gte: 'criado_de', lt: 'criado_ate' }, status_financeiro: { in: 'status_financeiro', eq: 'status_financeiro' } }, ordens: [],
  },
  gestao_comercial_briefings: { area: 'comercial', rota: '/comercial/briefings', filtros: {}, ordens: ['created_at', 'rodada'] },
  // ── 5.4 — Colaboradores e Acessos (`/acessos/*`). Sem rota: recursos (escrita), vínculos (PATCH/DELETE),
  // termos (escrita) e a foto — o código que os usava saiu da tela ou fica atrás de aviso ──
  acessos_pessoas: {
    area: 'acessos', rota: '/acessos/pessoas', filtros: { status: eq('status') }, ordens: [], // ordem fixa por nome
    embutidos: ['acessos_setores', 'acessos_organizacoes', 'patrimonio_empresas'], // `{nome}|null` fixos
  },
  acessos_organizacoes: { area: 'acessos', rota: '/acessos/organizacoes', filtros: {}, ordens: ['nome'] },
  acessos_setores: { area: 'acessos', rota: '/acessos/setores', filtros: {}, ordens: ['nome'] },
  acessos_recursos: {
    area: 'acessos', rota: '/acessos/recursos',
    // `arquivado_em is null` = `arquivado=false`
    filtros: { tipo: eq('tipo'), arquivado_em: { is: ['arquivado', nulo('false')] } }, ordens: ['nome', 'caminho'],
  },
  acessos_vinculos: {
    area: 'acessos', rota: '/acessos/vinculos', filtros: { recurso_id: eq('recurso_id'), pessoa_id: eq('pessoa_id') }, ordens: [],
    embutidosCols: { acessos_recursos: ['nome', 'tipo', 'arquivado_em'] },
  },
  acessos_termos: { area: 'acessos', rota: '/acessos/termos', filtros: { pessoa_id: eq('pessoa_id'), id: eq('id') }, ordens: [] }, // `id`: baixar/excluir leem o caminho pelo id (Plano 12)
  acessos_log: { area: 'acessos', rota: '/acessos/log', filtros: {}, ordens: [], autoria: ['quem'] }, // só escreve; `quem` é da sessão
  // ── Plano 12 — leituras da Vessel (`/vessel/*`). Sem permissão = 200 [] (a tela decide a frase). Ordem fixa na rota.
  // `paginaAteOLimite`: a Base de Leads pede 2000 e a rota para em 1000 por pedido; o `.limit(2000)` lê em páginas
  // (`contar=1`, `X-Total-Count`) e o aviso de corte da tela segue valendo ──
  vessel_atendimentos: {
    area: 'vessel', rota: '/vessel/atendimentos', filtros: { criado_em: { gte: 'criado_desde' } }, ordens: [], paginaAteOLimite: true,
    ordemFixa: [{ col: 'quando', asc: false }],
  },
  vessel_pedidos: {
    area: 'vessel', rota: '/vessel/pedidos', filtros: { situacao_id: eq('situacao_id'), pessoa_id: { eq: 'pessoa_id', in: 'pessoa_id' } }, ordens: [],
  },
  vessel_pessoas: { area: 'vessel', rota: '/vessel/pessoas', filtros: { id: { eq: 'id', in: 'id' } }, ordens: [] },
  vessel_origens: { area: 'vessel', rota: '/vessel/origens', filtros: { pessoa_id: { eq: 'pessoa_id', in: 'pessoa_id' } }, ordens: [] },
  vessel_lista_espera: {
    area: 'vessel', rota: '/vessel/lista-espera', filtros: { criado_em: { gte: 'criado_desde' } }, ordens: [], paginaAteOLimite: true,
  },
  carrinho_eventos: {
    area: 'vessel', rota: '/vessel/carrinho-eventos', filtros: { tipo: eq('tipo'), criado_em: { gte: 'criado_desde' } }, ordens: [], paginaAteOLimite: true,
  },
  checkout_abandono: {
    area: 'vessel', rota: '/vessel/checkout-abandono', filtros: { iniciado_em: { gte: 'iniciado_desde' } }, ordens: [],
    ordemFixa: [{ col: 'ultimo_evento_em', asc: false }],
  },
  // ── 5.10 — Autenticidade / selo Vessel (`/autenticidade/*`). Ordem fixa na rota (sem `ordem` nem `select`) ──
  vessel_lotes: { area: 'autenticidade', rota: '/autenticidade/lotes', filtros: {}, ordens: [], ordemFixa: [{ col: 'criado_em', asc: false }] },
  vessel_pecas: { area: 'autenticidade', rota: '/autenticidade/pecas', filtros: { codigo: { in: 'codigo', eq: 'codigo' } }, ordens: [] },
  vessel_registros: { area: 'autenticidade', rota: '/autenticidade/registros', filtros: {}, ordens: [], ordemFixa: [{ col: 'registrado_em', asc: false }] },
  // a rota só devolve as baixas ATIVAS: `desfeita_em is null` é implícito
  vessel_baixas: { area: 'autenticidade', rota: '/autenticidade/baixas', filtros: {}, ordens: [], implicitos: { desfeita_em: { is: 'null' } }, ordemFixa: [{ col: 'baixada_em', asc: false }] },
  vessel_cartao_pedidos: { area: 'autenticidade', rota: '/autenticidade/cartao-pedidos', filtros: {}, ordens: [], ordemFixa: [{ col: 'criado_em', asc: false }] },
  vessel_lembretes: { area: 'autenticidade', rota: '/autenticidade/lembretes', filtros: {}, ordens: [], ordemFixa: [{ col: 'criado_em', asc: false }] },
  // ── 5.8 — Fábrica de anúncios (leituras; as escritas do painel são as 4 edges e o
  // `escolher`, feitos na tela; as do robô são as rotas `/fabrica/robo/*`) ──
  fabrica_lojas: { area: 'fabrica', rota: '/fabrica/lojas', filtros: { ativo: eq('ativo') }, ordens: [] },
  fabrica_objetivos: { area: 'fabrica', rota: '/fabrica/objetivos', filtros: { ativo: eq('ativo'), chave: eq('chave') }, ordens: [] },
  fabrica_marcas: { area: 'fabrica', rota: '/fabrica/marcas', filtros: { account_id: eq('account_id'), ativo: eq('ativo') }, ordens: [] },
  fabrica_looks: { area: 'fabrica', rota: '/fabrica/looks', filtros: { ativo: eq('ativo') }, ordens: [] },
  fabrica_publicos: { area: 'fabrica', rota: '/fabrica/publicos', filtros: { ativo: eq('ativo') }, ordens: [] },
  fabrica_campanhas: {
    area: 'fabrica', rota: '/fabrica/campanhas',
    filtros: {
      id: eq('id'), status: { eq: 'status', in: 'status' },
      // `fechada_em=is.null` = aberta; `purgado_em=is.null` = não purgada
      fechada_em: { is: ['aberta', nulo('true')], not: ['aberta', naoNulo('false')] },
      purgado_em: { is: ['purgada', nulo('false')], not: ['purgada', naoNulo('true')] },
    },
    ordens: ['created_at', 'fechada_em'],
  },
  fabrica_criativos: {
    area: 'fabrica', rota: '/fabrica/criativos',
    filtros: {
      campanha_id: eq('campanha_id'), escolhido: eq('escolhido'), arquetipo: eq('arquetipo'),
      purgado_em: { is: ['purgado', nulo('false')], not: ['purgado', naoNulo('true')] },
    },
    ordens: [],
  },
  fabrica_jobs: {
    area: 'fabrica', rota: '/fabrica/jobs',
    // `params->>campanhaId` = `campanha_id` na rota
    filtros: { id: eq('id'), tipo: eq('tipo'), status: eq('status'), 'params->>campanhaId': eq('campanha_id') },
    ordens: ['created_at'],
  },
  fabrica_meta_jobs: {
    area: 'fabrica', rota: '/fabrica/meta-jobs',
    filtros: {
      tipo: eq('tipo'), 'payload->>campanhaId': { eq: 'campanha_id', in: 'campanha_id' },
      meta_campaign_id: { not: ['com_campanha_meta', naoNulo('true')] },
    },
    ordens: ['created_at'],
  },
  // ── 5.9 — Conteúdo ── (`da_marca` = "desta marca OU de todas", o `.or(account_id.eq.X,account_id.is.null)`)
  conteudo_pecas: {
    area: 'conteudo', rota: '/conteudo/pecas',
    filtros: { account_id: eq('account_id'), id: eq('id'), status: { eq: 'status', in: 'status' } },
    ordens: ['publicar_em', 'created_at'], autoria: ['criado_por'],
  },
  conteudo_arquivos: { area: 'conteudo', rota: '/conteudo/arquivos', filtros: { peca_id: eq('peca_id'), account_id: eq('account_id') }, ordens: [] },
  conteudo_eventos: {
    area: 'conteudo', rota: '/conteudo/eventos', filtros: { peca_id: eq('peca_id'), account_id: eq('account_id') }, ordens: [],
    autoria: ['quem', 'quando'],
  },
  conteudo_ideias: {
    area: 'conteudo', rota: '/conteudo/ideias',
    filtros: { account_id: eq('account_id'), da_marca: eq('da_marca'), situacao: { eq: 'situacao', in: 'situacao' }, descartada: eq('descartada') },
    ordens: [], autoria: ['criado_por', 'origem'],
  },
  conteudo_blocos: {
    area: 'conteudo', rota: '/conteudo/blocos',
    filtros: { account_id: eq('account_id'), da_marca: eq('da_marca'), ativo: eq('ativo') }, ordens: [], autoria: ['criado_por'],
  },
  conteudo_concorrentes: { area: 'conteudo', rota: '/conteudo/concorrentes', filtros: { account_id: eq('account_id'), ativo: eq('ativo') }, ordens: [] },
  conteudo_jobs: { area: 'conteudo', rota: '/conteudo/jobs', filtros: { id: eq('id'), account_id: eq('account_id'), status: { eq: 'status', in: 'status' } }, ordens: [] },
  // ── 5.7 — Gestão de tráfego ──
  gt_budget_analises: {
    area: 'trafego', rota: '/gestao-trafego/analises-de-orcamento',
    filtros: { account_id: eq('account_id'), veredito: eq('veredito') }, ordens: [],
  },
  gt_ad_analises: {
    area: 'trafego', rota: '/gestao-trafego/analises-de-anuncio',
    filtros: { account_id: eq('account_id'), veredito: eq('veredito'), campaign_id: eq('campaign_id') }, ordens: [],
  },
  gt_fila_decisoes: {
    area: 'trafego', rota: '/gestao-trafego/decisoes',
    filtros: { account_id: eq('account_id'), campaign_id: eq('campaign_id'), escopo: eq('escopo') }, ordens: ['decidido_em'],
    // quem decidiu vem da sessão; o silêncio de 7 dias o servidor calcula (Ruling 5.7-17)
    autoria: ['decidido_por', 'silenciar_ate', 'decidido_em'],
  },
  gt_campanhas_rascunho: {
    area: 'trafego', rota: '/gestao-trafego/rascunhos',
    filtros: { account_id: eq('account_id'), status: eq('status') }, ordens: ['updated_at'],
    autoria: ['criado_por', 'created_at', 'updated_at'],
  },
  gt_config_metricas: {
    area: 'trafego', rota: '/gestao-trafego/config-metricas', filtros: {}, ordens: [], autoria: ['updated_at'],
    upsert: (linhas) => {
      if (linhas.length !== 1) throw new ErroDeTraducao('gt_config_metricas: um balde por vez')
      return { metodo: 'PUT', caminho: `/gestao-trafego/config-metricas/${encodeURIComponent(linhas[0].balde)}`, corpo: { metricas: linhas[0].metricas } }
    },
  },
  gt_objetivo_interacao: {
    area: 'trafego', rota: '/gestao-trafego/objetivos',
    filtros: { alvo_id: eq('alvo_id'), conta_id: eq('conta_id'), nivel: eq('nivel') }, ordens: [],
    autoria: ['updated_by', 'updated_at'],
    upsert: (linhas) => {
      if (linhas.length !== 1) throw new ErroDeTraducao('gt_objetivo_interacao: um alvo por vez')
      const [l] = linhas
      return { metodo: 'PUT', caminho: `/gestao-trafego/objetivos/${encodeURIComponent(l.alvo_id)}`, corpo: { nivel: l.nivel, interacao: l.interacao, conta_id: l.conta_id ?? null } }
    },
    // 204 também sem linha (Ruling 5.7-8)
    apagarPor: { alvo_id: (v) => ({ metodo: 'DELETE', caminho: `/gestao-trafego/objetivos/${encodeURIComponent(v)}` }) },
  },
  // a escrita da régua é UM `PUT /gestao-trafego/regua` com o histórico junto: feita na tela
  gt_ponderada_config: { area: 'trafego', rota: '/gestao-trafego/regua', filtros: {}, ordens: [] },
  interesses_sugeridos: {
    area: 'trafego', rota: '/gestao-trafego/interesses-sugeridos',
    filtros: { account_id: eq('account_id'), marca_id: eq('marca_id'), objetivo: eq('objetivo') }, ordens: [],
  },
  data_integrity_checks: {
    area: 'admin', rota: '/saude/conferencias',
    filtros: { checked_date: eq('checked_date'), status: eq('status') }, ordens: ['checked_date', 'created_at'],
  },
}

/** A tabela já mora na API (a área dela está ligada)? */
export function tabelaNaApi(tabela) {
  const r = ROTAS[tabela]
  return !!r && areaNaApi(r.area)
}

// ── O pedido no formato PostgREST, em partes ─────────────────────────────────

/** `'t?col=eq.x&select=a,b&order=c.desc&limit=1'` → partes. */
export function lerCaminhoPostgrest(caminho) {
  const [tabela, busca = ''] = String(caminho).split('?')
  const partes = { tabela, filtros: [], select: null, ordem: [], limite: null, onConflict: null }
  for (const [k, v] of new URLSearchParams(busca)) {
    if (k === 'select') partes.select = v
    else if (k === 'order') {
      partes.ordem = v.split(',').map((o) => {
        const [col, dir, ...resto] = o.split('.')
        // `nullsfirst`/`nullslast` mudam a ordem dos nulos: sem par na rota, recusa.
        if (resto.length || (dir && dir !== 'asc' && dir !== 'desc')) throw new ErroDeTraducao(`ordem sem tradução: ${o}`)
        return { col, asc: dir !== 'desc' }
      })
    }
    else if (k === 'limit') partes.limite = Number(v)
    else if (k === 'on_conflict') partes.onConflict = v
    else {
      const i = v.indexOf('.')
      if (i < 0) throw new ErroDeTraducao(`filtro sem operador: ${k}=${v}`)
      partes.filtros.push({ col: k, op: v.slice(0, i), val: v.slice(i + 1) })
    }
  }
  return partes
}

// `eq."valor com aspas"` (paraEq) → valor; `ilike.a\_b` (paraIlike) → a_b.
function valorDoEq(v) {
  if (v.startsWith('"') && v.endsWith('"')) return v.slice(1, -1).replace(/\\(.)/g, '$1')
  return v
}
function valorDoIlike(v) {
  // curinga de verdade (sem barra antes) não tem equivalente: a rota compara igual
  if (/(^|[^\\])[%*_]/.test(v)) throw new ErroDeTraducao(`ilike com curinga não tem rota: ${v}`)
  return v.replace(/\\(.)/g, '$1')
}

function parametrosDosFiltros(def, tabela, filtros) {
  const params = {}
  for (const f of filtros) {
    if (f.op === 'or') {
      if (!def.ou) throw new ErroDeTraducao(`${tabela}: a rota ${def.rota} não tem tradução para or`)
      for (const [k, v] of Object.entries(def.ou(f.val))) { if (k in params) throw new ErroDeTraducao(`${tabela}: filtro repetido ${k}`); params[k] = v }
      continue
    }
    const alvo = def.filtros[f.col]?.[f.op]
    if (!alvo) throw new ErroDeTraducao(`${tabela}: a rota ${def.rota} não filtra por ${f.col}=${f.op}`)
    const [p, converter, padrao] = Array.isArray(alvo) ? alvo : [alvo, null, false]
    let v
    if (f.op === 'eq') v = valorDoEq(f.val)
    // `padrao`: a rota recebe o PADRÃO do ILIKE como valor (`nome_como=%ve%cul%`), curinga e tudo (Ruling 5.2-14)
    else if (f.op === 'ilike') v = padrao ? f.val : valorDoIlike(f.val)
    else if (f.op === 'in') {
      // valor com aspas pode ter vírgula dentro: o split quebraria errado — recusa.
      if (f.val.includes('"')) throw new ErroDeTraducao(`${tabela}: in com aspas não tem tradução: ${f.val}`)
      v = f.val.replace(/^\(|\)$/g, '').split(',').join(',')
    }
    else v = f.val
    if (converter) v = converter(v)
    if (p in params) throw new ErroDeTraducao(`${tabela}: filtro repetido ${p}`)
    params[p] = v
  }
  return params
}

/** As colunas pedidas em `select` (null = todas). Recurso embutido não tem rota. */
function colunasDoSelect(select, def = {}) {
  if (!select || select.trim() === '*') return null
  // `tabela(col)` só passa quando a rota devolve esse embutido FIXO (`def.embutidos`, ex.: os 3 de `/patrimonio/bens`);
  // o `{nome}` do embutido vem pronto da rota, então o que fica é o nome dele. Qualquer outro recurso embutido recusa.
  const cols = []
  let fundo = 0, ini = 0
  for (let i = 0; i <= select.length; i++) {
    const c = select[i]
    if (c === '(') fundo++
    else if (c === ')') fundo--
    else if ((c === ',' && fundo === 0) || i === select.length) { cols.push(select.slice(ini, i).trim()); ini = i + 1 }
  }
  const nomes = cols.filter(Boolean).map((c) => {
    const m = /^([a-z_]+)\(([a-z_,\s]*)\)$/.exec(c)
    if (!m) { if (/[()]/.test(c)) throw new ErroDeTraducao(`select com recurso embutido não tem rota: ${select}`); return c }
    // embutido com colunas declaradas (`/acessos/vinculos` → `acessos_recursos{nome,tipo,arquivado_em}`)
    const decl = def.embutidosCols?.[m[1]]
    if (decl) {
      const pedidas = m[2].split(',').map((x) => x.trim()).filter(Boolean)
      if (pedidas.some((x) => !decl.includes(x))) throw new ErroDeTraducao(`${m[1]}: a rota só devolve ${decl.join(', ')} no embutido`)
      return m[1]
    }
    if (!def.embutidos?.includes(m[1])) throw new ErroDeTraducao(`select com recurso embutido não tem rota: ${select}`)
    if (m[2].trim() !== 'nome') throw new ErroDeTraducao(`${m[1]}: a rota só devolve {nome} no embutido`)
    return m[1]
  })
  return nomes.includes('*') ? null : nomes
}

function projetar(linhas, cols, tabela) {
  if (!cols) return linhas
  // Coluna que a tela pede e a rota não devolve viraria `undefined` calado.
  const falta = linhas.length ? cols.filter((c) => !(c in linhas[0])) : []
  if (falta.length) throw new ErroDeTraducao(`${tabela}: a rota não devolve ${falta.join(', ')}`)
  return linhas.map((l) => Object.fromEntries(cols.map((c) => [c, l[c]])))
}

function ordenarNaTela(linhas, ordem) {
  return [...linhas].sort((a, b) => {
    for (const { col, asc } of ordem) {
      const x = a[col], y = b[col]
      if (x === y) continue
      // nulos como o PostgREST: por último no asc, primeiro no desc
      if (x === null || x === undefined) return asc ? 1 : -1
      if (y === null || y === undefined) return asc ? -1 : 1
      const c = typeof x === 'string' && typeof y === 'string' ? x.localeCompare(y, 'pt-BR') : (x < y ? -1 : 1)
      return c * (asc ? 1 : -1)
    }
    return 0
  })
}

// ── A execução ───────────────────────────────────────────────────────────────

function erroDoSupabase(error, corpo) {
  // o formato que as telas leem do supabase-js/PostgREST: `message`, `code`
  // `details` = a frase do SERVIDOR (quando veio): a tela que traduz "sem permissão"
  // para a frase dela sabe que, aqui, a do servidor diz mais (ex.: "entrar como").
  return { message: fraseDoCorpo(corpo) || error.message, code: error.codigo || String(error.status), status: error.status, details: corpo?.mensagem || null, hint: null }
}

/**
 * Lê uma tabela pela rota. `partes` vem de `lerCaminhoPostgrest` ou do encadeado.
 * Devolve `{ data: [...], error, count }`.
 */
// Teto de páginas de uma leitura sem limite (20 × 1000 linhas). Acima disso a
// tradução recusa: ler a tabela inteira para a tela não é o que a rota promete.
const PAGINAS_NO_MAXIMO = 20

export async function lerPelaApi(partes, { contar = false } = {}) {
  const def = ROTAS[partes.tabela]
  if (!def?.rota) throw new ErroDeTraducao(`${partes.tabela}: sem rota de leitura`)
  // Filtro que a rota não declara: só `eq`/`in`, só sem limite (a leitura vem
  // INTEIRA, paginada abaixo) e numa coluna que a rota devolve — aí a tela filtra
  // as mesmas linhas que o banco filtraria. Qualquer outro caso recusa alto.
  // `implicitos`: o que a rota já faz sempre (ex.: só as baixas ativas) — o filtro some, sem parâmetro e sem filtrar na tela
  const implicito = (f) => def.implicitos?.[f.col]?.[f.op] === f.val
  const naTela = partes.filtros.filter((f) => f.op !== 'or' && !implicito(f) && !def.filtros[f.col]?.[f.op])
  if (naTela.length && (partes.limite || naTela.some((f) => f.op !== 'eq' && f.op !== 'in'))) {
    throw new ErroDeTraducao(`${partes.tabela}: a rota ${def.rota} não filtra por ${naTela.map((f) => f.col + '=' + f.op).join(', ')}`)
  }
  const params = parametrosDosFiltros(def, partes.tabela, partes.filtros.filter((f) => !naTela.includes(f) && !implicito(f)))
  const cols = colunasDoSelect(partes.select, def)
  // A ordem pedida vai para a rota quando ela a declara (UMA coluna: o `ordem` da
  // API aceita um campo só); senão, a tela ordena — e isso só é certo se NADA foi
  // cortado antes (sem limite).
  const naRota = partes.ordem.length === 1 && def.ordens.includes(partes.ordem[0].col)
  if (partes.ordem.length && naRota) params.ordem = partes.ordem.map((o) => `${o.col}.${o.asc ? 'asc' : 'desc'}`).join(',')
  // `ordemFixa`: a rota já devolve nesta ordem (sem parâmetro `ordem`); pedir a MESMA ordem está satisfeito
  const fixa = !!def.ordemFixa && partes.ordem.length === def.ordemFixa.length
    && partes.ordem.every((o, i) => o.col === def.ordemFixa[i].col && o.asc === def.ordemFixa[i].asc)
  if (partes.ordem.length && !naRota && !fixa && partes.limite) {
    throw new ErroDeTraducao(`${partes.tabela}: a rota não ordena por ${partes.ordem.map((o) => o.col)} e o pedido corta em ${partes.limite}`)
  }
  // `.limit(N)` acima do teto de UMA resposta é recusado (cortar calado daria número menor), salvo a rota que
  // declara `paginaAteOLimite`: aí lê em páginas até N (ou até acabar), todas com a mesma ordem da rota.
  const acima = partes.limite > TETO_DE_LINHAS && !!def.paginaAteOLimite && !partes.deslocamento
  if (partes.limite > TETO_DE_LINHAS && !acima) throw new ErroDeTraducao(`${partes.tabela}: limite ${partes.limite} acima do teto de ${TETO_DE_LINHAS} linhas da API`)
  if (acima && Math.ceil(partes.limite / TETO_DE_LINHAS) > PAGINAS_NO_MAXIMO) throw new ErroDeTraducao(`${partes.tabela}: limite ${partes.limite} passa de ${PAGINAS_NO_MAXIMO} páginas`)
  if (partes.limite && !acima) params.limite = partes.limite
  if (partes.deslocamento) params.deslocamento = partes.deslocamento
  // SEM LIMITE, A LEITURA VEM INTEIRA. A API (como o PostgREST, `max_rows`) para
  // em 1000 linhas por pedido; uma tela que não pediu limite queria TUDO, e cortar
  // em 1000 calado é número menor sem aviso. Conta o total e busca as páginas
  // seguintes por `deslocamento` (a ordem das rotas tem desempate: não repete
  // nem pula linha).
  if (contar || !partes.limite || acima) params.contar = 1
  let linhas = []
  let total = null
  for (let pagina = 0; ; pagina++) {
    const r = await pedir('GET', def.rota, { params: pagina ? { ...params, deslocamento: linhas.length } : params })
    if (r.error) return { data: null, error: erroDoSupabase(r.error, r.data), count: null }
    if (!Array.isArray(r.data)) return { data: null, error: { message: 'Resposta inesperada do servidor.', code: '502' }, count: null }
    linhas = linhas.concat(r.data)
    total = r.total
    if ((partes.limite && !acima) || total === null || linhas.length >= total || r.data.length === 0) break
    if (acima && linhas.length >= partes.limite) { linhas = linhas.slice(0, partes.limite); break }
    if (pagina + 1 >= PAGINAS_NO_MAXIMO) throw new ErroDeTraducao(`${partes.tabela}: ${total} linhas — passa de ${PAGINAS_NO_MAXIMO} páginas`)
  }
  if (naTela.length) {
    if (linhas.length && naTela.some((f) => !(f.col in linhas[0]))) throw new ErroDeTraducao(`${partes.tabela}: a rota não devolve ${naTela.map((f) => f.col)}`)
    const aceita = (f, l) => (f.op === 'eq' ? [valorDoEq(f.val)] : f.val.replace(/^\(|\)$/g, '').split(',')).includes(String(l[f.col]))
    linhas = linhas.filter((l) => naTela.every((f) => aceita(f, l)))
  }
  if (partes.ordem.length && !naRota && !fixa) linhas = ordenarNaTela(linhas, partes.ordem)
  return { data: projetar(linhas, cols, partes.tabela), error: null, count: naTela.length ? linhas.length : total }
}

/**
 * Quantas linhas a tabela tem para quem pede (`X-Total-Count`), sem baixá-las:
 * o `select=id` + `.length` de antes parava no teto de linhas.
 */
export async function contarPelaApi(tabela, filtros = []) {
  const r = await lerPelaApi({ tabela, filtros, select: null, ordem: [], limite: 1 }, { contar: true })
  return r.error ? null : r.count
}

function semAutoria(def, linha) {
  // A autoria vem da SESSÃO na API (Ruling 9 do 5.1: mandar = 400). O PostgREST
  // precisava dela no corpo; aqui ela sai.
  const l = { ...linha }
  for (const c of def.autoria || []) delete l[c]
  return l
}

function idDoFiltro(partes, oQue, chave = 'id') {
  if (partes.filtros.length === 1 && partes.filtros[0].col === chave && partes.filtros[0].op === 'eq') return valorDoEq(partes.filtros[0].val)
  throw new ErroDeTraducao(`${partes.tabela}: ${oQue} pela API só por id (pediu ${partes.filtros.map((f) => f.col + '=' + f.op).join('&') || 'sem filtro'})`)
}

/**
 * Escreve pela rota. `operacao`: 'inserir' | 'editar' | 'apagar' | 'upsert'.
 * Devolve `{ data: [linhas]|null, error }`, como o supabase-js com `.select()`.
 */
export async function escreverPelaApi(operacao, partes, corpo) {
  const def = ROTAS[partes.tabela]
  if (!def) throw new ErroDeTraducao(`${partes.tabela}: sem rota`)
  const linhas = corpo === undefined ? [] : (Array.isArray(corpo) ? corpo : [corpo]).map((l) => semAutoria(def, l))
  const um = async (metodo, caminho, c) => {
    const r = await pedir(metodo, caminho, { corpo: c })
    if (r.error) return { erro: erroDoSupabase(r.error, r.data) }
    return { linha: r.data }
  }
  let res = []
  if (operacao === 'upsert') {
    if (!def.upsert) throw new ErroDeTraducao(`${partes.tabela}: sem upsert na API`)
    const chamadas = [].concat(def.upsert(linhas))
    for (const p of chamadas) {
      const r = await um(p.metodo, p.caminho, p.corpo)
      if (r.erro) return { data: null, error: r.erro }
      res = res.concat(Array.isArray(r.linha) ? r.linha : (r.linha ? [r.linha] : []))
    }
  } else if (operacao === 'inserir') {
    for (const l of linhas) {
      const r = await um('POST', def.rota, l)
      if (r.erro) return { data: null, error: r.erro }
      res.push(r.linha)
    }
  } else if (operacao === 'editar') {
    if (linhas.length !== 1) throw new ErroDeTraducao(`${partes.tabela}: editar pede um corpo`)
    // linha única: o filtro da tela é `id=true` e a rota não tem id no caminho
    const caminho = def.linhaUnica ? def.rota : `${def.rota}/${encodeURIComponent(idDoFiltro(partes, 'editar', def.chave))}`
    const r = await um('PATCH', caminho, linhas[0])
    if (r.erro) return { data: null, error: r.erro }
    res = [r.linha]
  } else if (operacao === 'apagar') {
    const f = partes.filtros
    const atalho = f.length === 1 && f[0].op === 'eq' && def.apagarPor?.[f[0].col]
    if (atalho) {
      const v = valorDoEq(f[0].val)
      const p = atalho(v)
      const r = await um(p.metodo, p.caminho, p.corpo)
      // A rota responde 204 também quando não havia linha: o que se sabe é que a
      // linha daquela chave NÃO EXISTE mais — e é isso que a tela pergunta.
      return r.erro ? { data: null, error: r.erro } : { data: [{ [f[0].col]: v }], error: null }
    }
    let ids
    if (f.length === 1 && f[0].col === 'id' && f[0].op === 'eq') ids = [valorDoEq(f[0].val)]
    else {
      // Apagar por chave natural (ex.: `equipes_permissoes` por equipe+pessoa+chave):
      // a API apaga por id (Ruling 14 do 5.1). Lê as linhas com os filtros que a rota
      // tem, confere o resto aqui e apaga cada id — as MESMAS linhas que o PostgREST
      // apagaria. Coluna que nem a rota nem a linha conhecem: recusa.
      const naRota = f.filter((x) => def.filtros[x.col]?.[x.op])
      const naTela = f.filter((x) => !def.filtros[x.col]?.[x.op])
      if (!naRota.length || naTela.some((x) => x.op !== 'eq')) throw new ErroDeTraducao(`${partes.tabela}: apagar sem id e sem filtro da rota`)
      const lidas = await lerPelaApi({ ...partes, filtros: naRota, select: null, ordem: [], limite: null })
      if (lidas.error) return { data: null, error: lidas.error }
      if (lidas.data.length && naTela.some((x) => !(x.col in lidas.data[0]))) throw new ErroDeTraducao(`${partes.tabela}: a rota não devolve ${naTela.map((x) => x.col)}`)
      const alvo = lidas.data.filter((l) => naTela.every((x) => String(l[x.col]) === valorDoEq(x.val)))
      ids = alvo.map((l) => l.id)
    }
    for (const id of ids) {
      const r = await um('DELETE', `${def.rota}/${encodeURIComponent(id)}`)
      if (r.erro) return { data: null, error: r.erro }
    }
    // As linhas apagadas, como o PostgREST devolve com `return=representation`:
    // há tela que CONTA o que voltou para saber se apagou (grupo, supervisora).
    // A rota de apagar responde 204 e não lê a linha antes; o id é o que se sabe.
    return { data: ids.map((id) => ({ id })), error: null }
  } else throw new ErroDeTraducao(`operação desconhecida: ${operacao}`)
  return { data: res, error: null }
}

// ── Fachada 1: o encadeado do supabase-js ────────────────────────────────────

class ConsultaPelaApi {
  constructor(tabela) {
    this.p = { tabela, filtros: [], select: null, ordem: [], limite: null }
    this.op = 'ler'; this.corpo = undefined; this.devolver = false; this.unico = null; this.contar = false; this.soContar = false
  }
  select(cols = '*', opcoes = {}) {
    if (this.op === 'ler') this.p.select = cols
    else this.devolver = true
    if (opcoes.count) this.contar = true
    if (opcoes.head) this.soContar = true
    return this
  }
  eq(col, val) { this.p.filtros.push({ col, op: 'eq', val: String(val) }); return this }
  ilike(col, val) { this.p.filtros.push({ col, op: 'ilike', val: String(val) }); return this }
  is(col, val) { this.p.filtros.push({ col, op: 'is', val: String(val) }); return this }
  neq(col, val) { this.p.filtros.push({ col, op: 'neq', val: String(val) }); return this }
  // `.not('col', 'is', null)` → `col=not.is.null` (o mesmo que a URL à mão)
  not(col, op, val) { this.p.filtros.push({ col, op: 'not', val: `${op}.${val}` }); return this }
  in(col, vals) { this.p.filtros.push({ col, op: 'in', val: vals.join(',') }); return this }
  gte(col, val) { this.p.filtros.push({ col, op: 'gte', val: String(val) }); return this }
  lte(col, val) { this.p.filtros.push({ col, op: 'lte', val: String(val) }); return this }
  lt(col, val) { this.p.filtros.push({ col, op: 'lt', val: String(val) }); return this }
  or(texto) { this.p.filtros.push({ col: '', op: 'or', val: String(texto) }); return this }
  // `.range(de, ate)` (inclusivo, como o supabase-js) = `limite` + `deslocamento` da rota
  range(de, ate) { this.p.limite = ate - de + 1; this.p.deslocamento = de; return this }
  order(col, { ascending = true, nullsFirst } = {}) {
    // a ordem dos nulos não tem par na rota: recusa na execução (o encadeado não lança)
    if (nullsFirst !== undefined) this.recusa = `ordem com nullsFirst não tem tradução: ${col}`
    this.p.ordem.push({ col, asc: ascending }); return this
  }
  limit(n) { this.p.limite = n; return this }
  single() { this.unico = 'single'; return this }
  maybeSingle() { this.unico = 'maybe'; return this }
  insert(corpo) { this.op = 'inserir'; this.corpo = corpo; return this }
  update(corpo) { this.op = 'editar'; this.corpo = corpo; return this }
  upsert(corpo) { this.op = 'upsert'; this.corpo = corpo; return this }
  delete() { this.op = 'apagar'; return this }
  async executar() {
    try {
      if (this.recusa) throw new ErroDeTraducao(this.recusa)
      if (this.op === 'ler') {
        // `head: true` só conta: uma linha basta (o `X-Total-Count` traz o total);
        // sem isto a leitura sem limite baixava a tabela inteira para contar
        const p = this.soContar && this.p.limite == null ? { ...this.p, limite: 1 } : this.p
        const r = await lerPelaApi(p, { contar: this.contar })
        if (r.error) return { data: null, error: r.error, count: null }
        if (this.soContar) return { data: null, error: null, count: r.count }
        if (this.unico) {
          if (r.data.length > 1 || (this.unico === 'single' && r.data.length === 0)) {
            return { data: null, error: { message: 'JSON object requested, multiple (or no) rows returned', code: 'PGRST116' } }
          }
          return { data: r.data[0] ?? null, error: null, count: r.count }
        }
        return { data: r.data, error: null, count: r.count }
      }
      const r = await escreverPelaApi(this.op, this.p, this.corpo)
      if (r.error) return { data: null, error: r.error }
      if (!this.devolver) return { data: null, error: null }
      const linhas = r.data || []
      return { data: this.unico ? (linhas[0] ?? null) : linhas, error: null }
    } catch (e) {
      if (e instanceof ErroDeTraducao) console.error('[banco-pela-api]', e.message)
      return { data: null, error: { message: e.message, code: 'traducao' } }
    }
  }
  // `status` como o supabase-js (há tela que o passa a `classificarErro`).
  then(ok, falha) { return this.executar().then((r) => ({ ...r, status: r.error ? (r.error.status || 500) : 200 })).then(ok, falha) }
}

/**
 * `deOnde(sbClient).from('t')`: a tabela vai pela API quando a área dela está
 * ligada; senão, é o MESMO `sbClient.from('t')` de sempre.
 */
/** A consulta pela API, sem olhar a chave (para os testes e para quem já decidiu). */
/**
 * Gravação composta (UMA transação na API: ficha de checklist, manutenção, troca de
 * posse). Devolve `{ data, error }` como o supabase-js; o erro leva `status` e `message` (a frase).
 */
export async function escreverComposto(caminho, corpo) {
  const r = await pedir('POST', caminho, { corpo })
  return r.error ? { data: null, error: erroDoSupabase(r.error, r.data) } : { data: r.data, error: null }
}

/** Liga a ficha do colaborador a um login (`POST /acessos/pessoas/{id}/ligar`; admin; outro login = 409). */
export function ligarCadastroPelaApi(id, profileId) {
  return escreverComposto(`/acessos/pessoas/${encodeURIComponent(id)}/ligar`, { profile_id: profileId })
}

export function consultaPelaApi(tabela) { return new ConsultaPelaApi(tabela) }

export function deOnde(sbClient) {
  return { from: (tabela) => (tabelaNaApi(tabela) ? new ConsultaPelaApi(tabela) : sbClient.from(tabela)) }
}

// ── Fachada 2: o `fetch` do PostgREST (adFetch, gravar) ──────────────────────

function respostaDeMentira(status, corpo, { total = null } = {}) {
  const texto = corpo === undefined || corpo === null ? '' : JSON.stringify(corpo)
  const ok = status >= 200 && status < 300
  // `Content-Range` como o PostgREST com `Prefer: count=exact` ("0-0/N").
  const faixaDeLinhas = total === null ? null : `${Array.isArray(corpo) && corpo.length ? `0-${corpo.length - 1}` : '*'}/${total}`
  return {
    ok, status,
    json: async () => (texto ? JSON.parse(texto) : null),
    // Erro: a FRASE (há tela que faz `throw new Error(await r.text())`), não o JSON cru.
    text: async () => (ok ? texto : (corpo?.message || texto)),
    headers: { get: (k) => (String(k).toLowerCase() === 'content-range' ? faixaDeLinhas : null) },
  }
}

/**
 * Para quem faz `fetch(…/rest/v1/<caminho>, opcoes)` e lê o `Response`. Só se
 * chama com `tabelaNaApi(tabela)` verdadeiro. Mantém o que as telas leem:
 * `Prefer: return=representation` devolve o array; sem ele, 201/204 vazio.
 */
export async function fetchPostgrest(caminho, opcoes = {}) {
  const metodo = (opcoes.method || 'GET').toUpperCase()
  const prefer = String(opcoes.headers?.Prefer || opcoes.headers?.prefer || '')
  try {
    const partes = lerCaminhoPostgrest(caminho)
    const corpo = opcoes.body ? JSON.parse(opcoes.body) : undefined
    if (metodo === 'GET') {
      const contar = /count=exact/.test(prefer)
      const r = await lerPelaApi(partes, { contar })
      return r.error ? respostaDeMentira(r.error.status || 500, r.error) : respostaDeMentira(200, r.data, { total: contar ? r.count : null })
    }
    const op = metodo === 'POST' ? (/resolution=merge-duplicates/.test(prefer) || partes.onConflict ? 'upsert' : 'inserir')
      : metodo === 'PATCH' ? 'editar' : metodo === 'DELETE' ? 'apagar' : null
    if (!op) throw new ErroDeTraducao(`método ${metodo} sem tradução`)
    const r = await escreverPelaApi(op, partes, corpo)
    if (r.error) return respostaDeMentira(r.error.status || 500, r.error)
    if (/return=representation/.test(prefer)) return respostaDeMentira(metodo === 'POST' ? 201 : 200, r.data || [])
    if (metodo === 'DELETE') return respostaDeMentira(204, null)
    return respostaDeMentira(metodo === 'POST' ? 201 : 204, null)
  } catch (e) {
    if (e instanceof ErroDeTraducao) console.error('[banco-pela-api]', e.message)
    return respostaDeMentira(500, { message: e.message, code: 'traducao' })
  }
}
