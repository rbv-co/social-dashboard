import { createRouter, createWebHistory } from 'vue-router'
import { estado, hasPermission } from './compartilhado/controle-de-login-e-usuario.js'
import { podeEntrar } from './guarda-de-rotas.js'

const rotas = [
  { path: '/', name: 'inicio', component: () => import('./ferramentas/inicio/tela-de-inicio.vue') },
  { path: '/noticias', name: 'noticias', component: () => import('./ferramentas/noticias/tela-de-noticias.vue'), meta: { recurso: 'noticias' } },
  { path: '/acessos', name: 'acessos', component: () => import('./ferramentas/acessos/tela-de-acessos.vue') },
  { path: '/gestao-interna', name: 'gestao-interna', component: () => import('./ferramentas/gestao-interna/tela-de-menu-gestao-interna.vue') },
  { path: '/patrimonio', name: 'patrimonio', component: () => import('./ferramentas/patrimonio/tela-de-patrimonio.vue'), meta: { recurso: 'patrimonio' } },
  { path: '/frota', name: 'frota', component: () => import('./ferramentas/frota/tela-de-frota.vue'), meta: { recurso: 'frota' } },
  { path: '/autenticidade', name: 'autenticidade', component: () => import('./ferramentas/autenticidade/tela-de-autenticidade.vue'), meta: { recurso: 'autenticidade' } },
  { path: '/banco', name: 'banco', component: () => import('./ferramentas/banco/tela-de-banco.vue') },
  { path: '/vendas', name: 'vendas', component: () => import('./ferramentas/vendas/tela-de-menu-vendas.vue') },
  { path: '/gestao-vista', name: 'gestao-vista', component: () => import('./ferramentas/gestao-a-vista/tela-de-gestao-a-vista.vue') },
  { path: '/analise-vendas-marca', name: 'analise-vendas-marca', component: () => import('./ferramentas/analise-vendas/tela-de-marca-vendas.vue') },
  { path: '/analise-vendas', name: 'analise-vendas', component: () => import('./ferramentas/analise-vendas/tela-de-analise-vendas.vue') },
  { path: '/meta-ads', name: 'meta-ads', component: () => import('./ferramentas/meta-ads/tela-de-menu-meta-ads.vue') },
  { path: '/meta-campanhas', name: 'meta-campanhas', component: () => import('./ferramentas/analise-campanhas/tela-de-analise-campanhas.vue') },
  { path: '/gestao-trafego', name: 'gestao-trafego', component: () => import('./ferramentas/gestao-trafego/tela-de-gestao-trafego.vue') },
  { path: '/meta-relatorio-hora', name: 'meta-relatorio-hora', component: () => import('./ferramentas/meta-ads/tela-de-relatorio-por-hora.vue'), meta: { recurso: 'meta.hora' } },
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
  { path: '/claude-status', name: 'claude-status', component: () => import('./ferramentas/claude-status/tela-de-status-claude.vue'), meta: { recurso: 'claude.status' } },
  { path: '/conteudo', name: 'conteudo', component: () => import('./ferramentas/conteudo/tela-de-conteudo.vue'), meta: { recurso: 'conteudo' } },
  // Tela de uma peça só. É o destino do push da hora H, então precisa abrir
  // direto pelo link da notificação, sem passar pela lista.
  { path: '/conteudo/peca/:id', name: 'conteudo-peca', component: () => import('./ferramentas/conteudo/tela-de-peca.vue'), meta: { recurso: 'conteudo' }, props: true },
  // Catch-all — precisa ser a ÚLTIMA rota. Sem ela, uma URL/bookmark que não
  // existe mais dá tela branca (o vercel.json reescreve tudo pra index.html,
  // mas o vue-router não acha rota nenhuma pra montar).
  { path: '/:pathMatch(.*)*', name: 'nao-encontrada', redirect: { name: 'inicio' } },
]

export const roteador = createRouter({
  history: createWebHistory(),
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
  const r = podeEntrar(to, !!estado.currentSession, (recurso) => hasPermission(recurso, 'ver'))
  return r === true ? true : r
})
