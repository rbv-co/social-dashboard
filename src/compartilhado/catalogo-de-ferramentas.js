// O CATÁLOGO DAS FERRAMENTAS — A ÚNICA LISTA.
//
// POR QUE ESTE ARQUIVO EXISTE (24/09/2026). O dono cobrou pela segunda vez:
// "as permissões das ferramentas não estão sendo atualizadas conforme vai
// nascendo novas ferramentas". A causa era sempre a mesma — a mesma verdade
// escrita à mão em SETE lugares, e cada ferramenta nova lembrava de uns e
// esquecia de outros:
//
//   1. `RECURSOS`           — as linhas do editor de permissões
//   2. `PERMISSION_TREE`    — os cartões (grupos) do editor
//   3. `meta: { recurso }`  — em cada rota de mapa-de-enderecos.js
//   4. o `v-if` de cada cartão de menu (Início, Comercial Vessel, …)
//   5. `semNenhumaFerramenta` da tela de Início
//   6. os filhos de 'sales'/'meta' dentro de `permissaoDoPerfil`
//   7. `APROVACOES` da tela de Administração
//
// O que escapou por isso, medido neste dia: Beauty Sessions, Private Edit,
// Stylist Circle, Material Gráfico e o Appointment Card nasceram SEM chave
// própria (todos pegavam carona em 'atendimentos' e não apareciam no editor);
// o Escritório 3D tinha chave na árvore e não em RECURSOS — ninguém conseguia
// concedê-lo; o cartão do Meta Ads no Início ignorava a Fábrica e os dois
// relatórios; e o cartão do Relatório Interativo obedecia ao `role`, não à
// chave que o editor mostra.
//
// AGORA: ferramenta nova entra AQUI, uma vez, e o editor, a guarda das rotas e
// os cartões de menu leem daqui. O teste ao lado (catalogo-de-ferramentas.
// test.mjs) reprova rota, cartão de menu ou `hasPermission('x')` que não esteja
// neste catálogo — e reprova chave do catálogo que não tenha linha no editor.
//
// PURO DE PROPÓSITO: não importa nada (nem Vue, nem Supabase). Assim roda no
// teste em Node e pode ser importado por qualquer tela.
//
// ⚠️ NUNCA RENOMEIE UMA `key` EXISTENTE. Ela é gravada em `profiles.
// permissions`/`features` e procurada, pela string, dentro de funções do banco
// (`is_vessel_atendimentos()`, `is_acessos_admin()`, `is_frota_admin()`,
// `is_vessel_admin()` …). Renomear aqui tira o acesso de quem usa, calado.
//
// ⚠️ CHAVE NOVA NASCE CONCEDIDA A NINGUÉM (super-admin passa sempre). Quando
// ela é um PEDAÇO de uma ferramenta que já existia (caso das cinco do Comercial
// Vessel), quem já usava perde o acesso no dia da entrega — por isso vem junto
// um pré-concessão ADITIVA para quem já tem a chave-mãe (ver
// db/migrations/2026-09-24-permissoes-das-ferramentas-do-comercial-vessel.sql).

// ── Os cartões do editor, na ordem em que aparecem ─────────────────────────
// `key` do grupo é só um nome para agrupar; não é permissão (exceto quando uma
// ferramenta tem a mesma key, como 'social' e 'atendimentos').
export const GRUPOS = [
  { key: 'social', label: 'Redes Sociais' },
  { key: 'sales', label: 'Dashboard de Vendas' },
  { key: 'meta', label: 'Meta Ads' },
  { key: 'banco', label: 'Banco de Arquivos' },
  // Gestão Interna é uma PORTA (menu), não uma ferramenta: não tem permissão
  // própria. As chaves dos filhos seguem 'acessos', 'patrimonio' … — sem
  // prefixo — porque is_acessos_admin() e o acessos-proxy procuram essas
  // strings dentro de features[].
  { key: 'gestao-interna', label: 'Gestão Interna' },
  { key: 'noticias', label: 'Portal de Notícias' },
  { key: 'gestor', label: 'Gestão Comercial (IA)' },
  { key: 'claude.status', label: 'Painel de Status da IA' },
  { key: 'escritorio3d', label: 'Escritório 3D dos Agentes' },
  { key: 'conteudo', label: 'Central de Conteúdo' },
  // O grupo tem a key 'atendimentos' porque as ferramentas novas da família
  // são 'atendimentos.<tela>' — o prefixo é o que a trava do banco
  // (`is_vessel_atendimentos*`) reconhece. O cartão chama-se como o menu.
  { key: 'atendimentos', label: 'Comercial Vessel' },
]

// ── As ferramentas ─────────────────────────────────────────────────────────
// key     — a chave gravada em profiles.permissions (NUNCA renomear)
// label   — o nome da linha no editor
// acoes   — o que o editor oferece (ver sempre primeiro)
// grupo   — em qual cartão do editor ela mora (uma key de GRUPOS)
// rotas   — os nomes de rota (mapa-de-enderecos.js) que ela guarda
// links   — portas para FORA da Central (cartão <a>) que ela guarda
// dentroDe— para chave que não tem tela própria: a ferramenta em cuja tela
//           ela vive (uma aba, um botão)
// caixinha— chave de "pode ou não pode": o editor mostra UMA caixinha com
//           este texto em vez da escada de níveis
// semCartao— a tela existe mas nenhum cartão leva a ela, de propósito (o
//           motivo vai escrito aqui; o teste de caminho de clique a pula)
export const FERRAMENTAS = [
  { key: 'social', label: 'Redes Sociais — Dashboard', acoes: ['ver'], grupo: 'social', rotas: ['redes-sociais'] },
  { key: 'social.relatorio', label: 'Redes Sociais — Relatório Interativo', acoes: ['ver', 'exportar'], grupo: 'social', rotas: ['redes-relatorio'] },
  { key: 'sales.gestao', label: 'Gestão à Vista', acoes: ['ver'], grupo: 'sales', rotas: ['gestao-vista'] },
  { key: 'sales.analise', label: 'Análise de Vendas', acoes: ['ver'], grupo: 'sales', rotas: ['analise-vendas-marca', 'analise-vendas'] },
  // ⚠️ O CARTÃO DESTA ESTÁ DESLIGADO de propósito (v-if="false" em
  // tela-de-menu-meta-ads.vue): o conteúdo mudou para a Gestão de Tráfego. A
  // rota segue de pé para link salvo, e a chave segue concedida — por isso
  // continua no editor.
  { key: 'meta.campanha', label: 'Análise de Campanhas', acoes: ['ver'], grupo: 'meta', rotas: ['meta-campanhas'],
    semCartao: 'aposentada: o conteúdo mora na Gestão de Tráfego; só o link salvo abre' },
  { key: 'meta.gestor', label: 'Gestão de Tráfego', acoes: ['ver', 'editar'], grupo: 'meta', rotas: ['gestao-trafego'] },
  { key: 'meta.fabrica', label: 'Fábrica de Anúncios', acoes: ['ver', 'editar'], grupo: 'meta', rotas: ['fabrica-estudio', 'fabrica-nova', 'fabrica-looks', 'fabrica-campanha'] },
  { key: 'meta.hora', label: 'Relatório por Hora', acoes: ['ver'], grupo: 'meta', rotas: ['meta-relatorio-hora'] },
  { key: 'meta.opr', label: 'Relatório OPR', acoes: ['ver'], grupo: 'meta', rotas: ['meta-relatorio-opr'] },
  { key: 'banco', label: 'Banco de Arquivos', acoes: ['ver', 'criar', 'excluir'], grupo: 'banco', rotas: ['banco'] },
  { key: 'acessos', label: 'Colaboradores e Acessos', acoes: ['ver', 'criar', 'editar', 'excluir'], grupo: 'gestao-interna', rotas: ['acessos'] },
  { key: 'patrimonio', label: 'Patrimônio', acoes: ['ver', 'criar', 'editar', 'excluir'], grupo: 'gestao-interna', rotas: ['patrimonio'] },
  // Chave própria, e não uma 5ª ação em 'patrimonio': ACOES_MATRIZ é fixa em
  // 5 colunas. Mesmo formato de social.relatorio e gestor.relatorios.
  { key: 'patrimonio.relatorios', label: 'Patrimônio — Relatórios', acoes: ['ver', 'exportar'], grupo: 'gestao-interna', dentroDe: 'patrimonio' },
  { key: 'frota', label: 'Frota', acoes: ['ver', 'criar', 'editar', 'excluir'], grupo: 'gestao-interna', rotas: ['frota'] },
  { key: 'frota.relatorios', label: 'Frota — Relatórios', acoes: ['ver', 'exportar'], grupo: 'gestao-interna', dentroDe: 'frota' },
  { key: 'frota.aprovar', label: 'Aprovar requisição de veículo', acoes: ['ver'], grupo: 'gestao-interna', dentroDe: 'frota',
    caixinha: 'Pode aprovar requisição de veículo' },
  // Selo Vessel: as etiquetas NFC. A chave é a MESMA string que o
  // is_vessel_admin() procura dentro de features[].
  { key: 'autenticidade', label: 'Autenticidade e Garantia', acoes: ['ver', 'criar', 'editar'], grupo: 'gestao-interna', rotas: ['autenticidade'] },
  { key: 'noticias', label: 'Portal de Notícias', acoes: ['ver'], grupo: 'noticias', rotas: ['noticias'] },
  { key: 'gestor', label: 'Gestão Comercial (IA)', acoes: ['ver'], grupo: 'gestor', rotas: ['gestao-comercial'] },
  { key: 'gestor.relatorios', label: 'Relatórios Comerciais', acoes: ['ver', 'exportar'], grupo: 'gestor', dentroDe: 'gestor' },
  { key: 'claude.status', label: 'Painel de Status da IA', acoes: ['ver'], grupo: 'claude.status', rotas: ['claude-status'] },
  // ESCRITÓRIO 3D. Estava na árvore desde 04/08/2026 e FORA de RECURSOS — a
  // tela de Início pedia a chave, e o editor não tinha linha para concedê-la.
  // Página estática (public/escritorio-3d), aberta em outra aba.
  { key: 'escritorio3d', label: 'Escritório 3D dos Agentes', acoes: ['ver'], grupo: 'escritorio3d', links: ['escritorio-3d'] },
  { key: 'conteudo', label: 'Redes Sociais — Central de Conteúdo', acoes: ['ver', 'criar', 'editar', 'excluir'], grupo: 'conteudo', rotas: ['conteudo', 'conteudo-peca'] },
  // Chave separada em vez de uma 6ª coluna 'aprovar' (ACOES_MATRIZ é fixa).
  { key: 'conteudo.aprovar', label: 'Redes Sociais — Aprovar peças', acoes: ['ver'], grupo: 'conteudo', dentroDe: 'conteudo',
    caixinha: 'Pode aprovar peças para publicar' },
  // ── COMERCIAL VESSEL ─────────────────────────────────────────────────────
  // ⚠️ 'atendimentos' É A MESMA STRING no banco: `is_vessel_atendimentos()`
  // procura ela (ou 'atendimentos.<algo>') dentro de `profiles.features[]`, e
  // `is_vessel_atendimentos_editar()` procura 'editar' em
  // `permissions['atendimentos' ou 'atendimentos.<algo>']`. Quem leva a chave
  // de permissions para features é `derivar-features.js` — e ele põe junto o
  // pai 'atendimentos' de toda 'atendimentos.<algo>'.
  // 'editar' é marcar que a cliente veio, não veio ou remarcou.
  { key: 'atendimentos', label: 'Private Appointment', acoes: ['ver', 'editar'], grupo: 'atendimentos', rotas: ['atendimentos'] },
  // As quatro telas e a porta abaixo nasceram entre 18 e 24/09/2026 pegando
  // carona em 'atendimentos' — e por isso NÃO apareciam no editor: dar Private
  // Appointment dava as cinco, e não havia como dar uma sem as outras.
  { key: 'atendimentos.beauty-sessions', label: 'Beauty Sessions', acoes: ['ver', 'editar'], grupo: 'atendimentos', rotas: ['beauty-sessions'] },
  { key: 'atendimentos.private-edit', label: 'Private Edit', acoes: ['ver', 'editar'], grupo: 'atendimentos', rotas: ['private-edit'] },
  { key: 'atendimentos.stylist-circle', label: 'Stylist Circle', acoes: ['ver', 'editar'], grupo: 'atendimentos', rotas: ['stylist-circle'] },
  { key: 'atendimentos.material-grafico', label: 'Material Gráfico', acoes: ['ver'], grupo: 'atendimentos', rotas: ['material-grafico'] },
  { key: 'atendimentos.appointment-card', label: 'Appointment Card', acoes: ['ver'], grupo: 'atendimentos', links: ['appointment-card'] },
  // O Funil de Carrinho mora no menu do Comercial Vessel: o editor o mostra
  // no mesmo cartão. A chave continua 'carrinho' (nunca renomear).
  { key: 'carrinho', label: 'Funil de Carrinho', acoes: ['ver'], grupo: 'atendimentos', rotas: ['funil-carrinho'] },
]

// ── As portas (menus) ──────────────────────────────────────────────────────
// Uma porta abre para quem puder ver QUALQUER ferramenta de dentro — esconder
// a porta de quem tem um submódulo é o defeito que a Frota (19/08) e a
// Autenticidade (01/09) já pagaram. `grupo` = todas as ferramentas do grupo;
// `chaves` = lista explícita quando o menu não coincide com um grupo.
export const PORTAS = [
  { rota: 'vendas', grupo: 'sales' },
  { rota: 'meta-ads', grupo: 'meta' },
  { rota: 'gestao-interna', grupo: 'gestao-interna' },
  { rota: 'comercial-vessel', grupo: 'atendimentos' },
  // O menu de Redes junta dois grupos do editor: o painel/relatório e a
  // Central de Conteúdo.
  { rota: 'redes', chaves: ['social', 'social.relatorio', 'conteudo'] },
]

// Rotas que não pedem chave nenhuma — cada uma com o porquê.
export const ROTAS_SEM_CHAVE = {
  inicio: 'a tela de Início: cada cartão se esconde sozinho',
  login: 'antes de entrar não há permissão para conferir',
  'nao-encontrada': 'só redireciona para o Início',
}

// Rotas só de super-admin (não são permissão concedível: é a coluna
// profiles.is_superadmin).
export const ROTAS_DE_SUPERADMIN = ['admin']

// ── Derivados (nunca escrever estas listas à mão em outro arquivo) ─────────

// As linhas do editor. Mesmo formato de sempre: { key, label, acoes }.
export const RECURSOS = FERRAMENTAS.map(({ key, label, acoes }) => ({ key, label, acoes: acoes.slice() }))

// Os cartões do editor, no formato que `agruparRecursos` já lê.
export const PERMISSION_TREE = GRUPOS.map((g) => ({
  key: g.key,
  label: g.label,
  children: FERRAMENTAS.filter((f) => f.grupo === g.key && f.key !== g.key).map(({ key, label }) => ({ key, label })),
}))

// As chaves de "pode ou não pode" (uma caixinha no editor).
export const APROVACOES = Object.fromEntries(FERRAMENTAS.filter((f) => f.caixinha).map((f) => [f.key, f.caixinha]))

export function chavesDoGrupo(grupo) {
  return FERRAMENTAS.filter((f) => f.grupo === grupo).map((f) => f.key)
}

// Quem abre uma porta: quem vê QUALQUER ferramenta de dentro que tenha tela
// (ou link) própria. Chave que vive DENTRO de outra tela (`dentroDe`: uma aba,
// um botão de aprovar) não abre porta sozinha — a tela-mãe a mandaria embora.
export function chavesDaPorta(rota) {
  const p = PORTAS.find((x) => x.rota === rota)
  if (!p) return null
  if (p.chaves) return p.chaves.slice()
  return FERRAMENTAS.filter((f) => f.grupo === p.grupo && !f.dentroDe).map((f) => f.key)
}

// A ferramenta que guarda uma rota (ou um link para fora).
export function ferramentaDaRota(nome) {
  return FERRAMENTAS.find((f) => (f.rotas || []).includes(nome) || (f.links || []).includes(nome)) || null
}

// O `meta` que o roteador pendura em cada rota. Toda rota do mapa tem de cair
// num destes casos — o teste reprova a que não cair.
export function metaDaRota(nome) {
  const f = ferramentaDaRota(nome)
  if (f) return { recurso: f.key }
  const porta = chavesDaPorta(nome)
  if (porta) return { qualquerDe: porta }
  if (ROTAS_DE_SUPERADMIN.includes(nome)) return { superadmin: true }
  if (Object.prototype.hasOwnProperty.call(ROTAS_SEM_CHAVE, nome)) return {}
  return null // rota fora do catálogo — o teste acusa
}

// Quem pode ver o cartão/abrir a rota `nome`. Mesma regra do roteador, usada
// pelos cartões de menu — assim cartão e guarda nunca discordam.
//   temPermissao(recurso, acao) → boolean   ehSuperadmin → boolean
export function podeAbrirRota(nome, temPermissao, ehSuperadmin = false) {
  const meta = metaDaRota(nome)
  if (!meta) return false // fora do catálogo: fechado, nunca aberto por omissão
  if (meta.superadmin) return !!ehSuperadmin
  if (meta.recurso) return !!temPermissao(meta.recurso, 'ver')
  if (meta.qualquerDe) return meta.qualquerDe.some((k) => temPermissao(k, 'ver'))
  return true
}
