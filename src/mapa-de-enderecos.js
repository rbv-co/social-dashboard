import { createRouter, createWebHistory, createWebHashHistory } from 'vue-router'
import { estado, hasPermission } from './compartilhado/controle-de-login-e-usuario.js'
import { podeEntrar } from './guarda-de-rotas.js'
import { metaDaRota } from './compartilhado/catalogo-de-ferramentas.js'

// ⚠️ NENHUMA ROTA DECLARA A PRÓPRIA PERMISSÃO AQUI. O `meta` de cada uma vem do
// catálogo (compartilhado/catalogo-de-ferramentas.js) — é o MESMO lugar de onde
// o editor de permissões e os cartões de menu leem. Rota nova que não estiver
// no catálogo reprova o teste catalogo-de-ferramentas.test.mjs.
const rotasSemMeta = [
  { path: '/', name: 'inicio', component: () => import('./ferramentas/inicio/tela-de-inicio.vue') },
  { path: '/noticias', name: 'noticias', component: () => import('./ferramentas/noticias/tela-de-noticias.vue') },
  { path: '/acessos', name: 'acessos', component: () => import('./ferramentas/acessos/tela-de-acessos.vue') },
  { path: '/gestao-interna', name: 'gestao-interna', component: () => import('./ferramentas/gestao-interna/tela-de-menu-gestao-interna.vue') },
  { path: '/patrimonio', name: 'patrimonio', component: () => import('./ferramentas/patrimonio/tela-de-patrimonio.vue') },
  { path: '/frota', name: 'frota', component: () => import('./ferramentas/frota/tela-de-frota.vue') },
  { path: '/autenticidade', name: 'autenticidade', component: () => import('./ferramentas/autenticidade/tela-de-autenticidade.vue') },
  // A porta única do Comercial Vessel. ⚠️ Os endereços diretos de cada módulo
  // continuam valendo: agrupar na Central não pode quebrar link salvo.
  { path: '/comercial-vessel', name: 'comercial-vessel', component: () => import('./ferramentas/comercial-vessel/tela-de-menu-comercial-vessel.vue') },
  { path: '/atendimentos', name: 'atendimentos', component: () => import('./ferramentas/atendimentos/tela-de-atendimentos.vue') },
  // Cada tela do Comercial Vessel tem a SUA chave ('atendimentos.<tela>') desde
  // 24/09/2026 — antes pegavam carona em 'atendimentos' e não apareciam no
  // editor. A trava do banco (`is_vessel_atendimentos*`) aceita o prefixo.
  { path: '/private-edit', name: 'private-edit', component: () => import('./ferramentas/comercial-vessel/tela-de-private-edit.vue') },
  { path: '/stylist-circle', name: 'stylist-circle', component: () => import('./ferramentas/comercial-vessel/tela-de-stylist-circle.vue') },
  { path: '/beauty-sessions', name: 'beauty-sessions', component: () => import('./ferramentas/beauty-sessions/tela-de-beauty-sessions.vue') },
  // Os QR de cada ação do Growth Plan (23/09/2026).
  { path: '/material-grafico', name: 'material-grafico', component: () => import('./ferramentas/comercial-vessel/tela-de-material-grafico.vue') },
  { path: '/banco', name: 'banco', component: () => import('./ferramentas/banco/tela-de-banco.vue') },
  { path: '/vendas', name: 'vendas', component: () => import('./ferramentas/vendas/tela-de-menu-vendas.vue') },
  { path: '/gestao-vista', name: 'gestao-vista', component: () => import('./ferramentas/gestao-a-vista/tela-de-gestao-a-vista.vue') },
  { path: '/analise-vendas-marca', name: 'analise-vendas-marca', component: () => import('./ferramentas/analise-vendas/tela-de-marca-vendas.vue') },
  { path: '/analise-vendas', name: 'analise-vendas', component: () => import('./ferramentas/analise-vendas/tela-de-analise-vendas.vue') },
  { path: '/meta-ads', name: 'meta-ads', component: () => import('./ferramentas/meta-ads/tela-de-menu-meta-ads.vue') },
  { path: '/meta-campanhas', name: 'meta-campanhas', component: () => import('./ferramentas/analise-campanhas/tela-de-analise-campanhas.vue') },
  { path: '/gestao-trafego', name: 'gestao-trafego', component: () => import('./ferramentas/gestao-trafego/tela-de-gestao-trafego.vue') },
  { path: '/meta-relatorio-hora', name: 'meta-relatorio-hora', component: () => import('./ferramentas/meta-ads/tela-de-relatorio-por-hora.vue') },
  { path: '/meta-relatorio-opr', name: 'meta-relatorio-opr', component: () => import('./ferramentas/meta-ads/tela-de-relatorio-opr.vue') },
  { path: '/meta-base-de-leads', name: 'meta-base-de-leads', component: () => import('./ferramentas/meta-ads/tela-de-base-de-leads.vue') },
  { path: '/fabrica-estudio', name: 'fabrica-estudio', component: () => import('./ferramentas/meta-ads/tela-de-fabrica-home.vue') },
  { path: '/fabrica-estudio/nova', name: 'fabrica-nova', component: () => import('./ferramentas/meta-ads/tela-de-fabrica-estudio.vue') },
  { path: '/fabrica-estudio/looks', name: 'fabrica-looks', component: () => import('./ferramentas/meta-ads/tela-de-fabrica-looks.vue') },
  { path: '/fabrica-estudio/:id', name: 'fabrica-campanha', component: () => import('./ferramentas/meta-ads/tela-de-fabrica-estudio.vue'), props: true },
  { path: '/gestao-comercial', name: 'gestao-comercial', component: () => import('./ferramentas/gestao-comercial/tela-de-gestao-comercial.vue') },
  { path: '/login', name: 'login', component: () => import('./ferramentas/login/tela-de-login.vue') },
  { path: '/redes', name: 'redes', component: () => import('./ferramentas/redes-sociais/tela-de-menu-redes.vue') },
  { path: '/redes-sociais', name: 'redes-sociais', component: () => import('./ferramentas/redes-sociais/tela-de-redes-sociais.vue') },
  { path: '/redes-relatorio', name: 'redes-relatorio', component: () => import('./ferramentas/redes-sociais/tela-de-relatorio-redes.vue') },
  { path: '/admin', name: 'admin', component: () => import('./ferramentas/admin/tela-de-admin.vue') },
  { path: '/claude-status', name: 'claude-status', component: () => import('./ferramentas/claude-status/tela-de-status-claude.vue') },
  { path: '/conteudo', name: 'conteudo', component: () => import('./ferramentas/conteudo/tela-de-conteudo.vue') },
  // Tela de uma peça só. É o destino do push da hora H, então precisa abrir
  // direto pelo link da notificação, sem passar pela lista.
  { path: '/conteudo/peca/:id', name: 'conteudo-peca', component: () => import('./ferramentas/conteudo/tela-de-peca.vue'), props: true },
  { path: '/funil-carrinho', name: 'funil-carrinho', component: () => import('./ferramentas/funil-carrinho/tela-de-funil-carrinho.vue') },
  // Catch-all — precisa ser a ÚLTIMA rota. Sem ela, uma URL/bookmark que não
  // existe mais dá tela branca (o vercel.json reescreve tudo pra index.html,
  // mas o vue-router não acha rota nenhuma pra montar).
  { path: '/:pathMatch(.*)*', name: 'nao-encontrada', redirect: { name: 'inicio' } },
]

// A permissão de cada rota, pendurada a partir do catálogo. Rota fora do
// catálogo ganha `{ foraDoCatalogo: true }` e a guarda a trata como fechada
// (ver podeEntrar) — nunca aberta por esquecimento.
const rotas = rotasSemMeta.map((r) => ({ ...r, meta: { ...(r.meta || {}), ...(metaDaRota(r.name) || { foraDoCatalogo: true }) } }))

// ⚠️ A DEMONSTRAÇÃO (src/demonstracao/, build próprio) guarda a tela depois do
// "#": ela mora numa página só (`demonstracao/central.html`, dentro de um
// iframe), e com o endereço comum um F5 em /stylist-circle pediria ao servidor
// uma página que a demonstração não tem. Em produção `VITE_DEMONSTRACAO` não
// existe e BASE_URL é '/': o mesmo `createWebHistory()` de sempre.
export const roteador = createRouter({
  history: import.meta.env.VITE_DEMONSTRACAO === '1'
    ? createWebHashHistory()
    : createWebHistory(import.meta.env.BASE_URL),
  routes: rotas,
})

export { podeEntrar }

// Guarda global. A permissão por rota mora no meta.recurso — assim o gate não
// depende de cada tela lembrar de checar (foi o que deixou /claude-status e
// /noticias abertas para qualquer usuário logado, mesmo sem a permissão certa).
//
// Isto NÃO é segurança: o front é público. É só aparência — quem manda de
// verdade é o RLS do banco e as Edge Functions.
roteador.beforeEach((to) => {
  const r = podeEntrar(to, !!estado.currentSession, (recurso) => hasPermission(recurso, 'ver'), !!estado.is_superadmin)
  return r === true ? true : r
})
