<template>
  <!-- Porte fiel de #meta-ads-hub-screen (legacy/index.html L11982-12028). Tela
       pequena e estática (sem innerHTML/createElement) — mesmo padrão simples de
       tela-menu-vendas.vue: bindings @click do Vue, sem precisar expor nada em
       window. Root vira .tela-menu-meta-ads (sem display:none — quem controla a
       visibilidade agora é o vue-router). -->
  <div class="tela-menu-meta-ads">
    <barra-de-topo voltar="Central" titulo="Meta Ads" @voltar="voltar">
      <template #acoes>
        <button class="bt-acao so-icone" :class="{ primario: visualizacao === 'grid' }" @click="definirVisualizacao('grid')" title="Cards">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>
        </button>
        <button class="bt-acao so-icone" :class="{ primario: visualizacao === 'list' }" @click="definirVisualizacao('list')" title="Lista">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
        </button>
      </template>
    </barra-de-topo>
    <div class="smenu-body">
      <div class="smenu-headline">
        <h2>Escolha o módulo</h2>
        <p>Ferramentas de tráfego pago para suas contas</p>
      </div>
      <div class="smenu-cards" :class="{ 'view-list': visualizacao === 'list' }">
        <!-- ANÁLISE DE CAMPANHAS OCULTA (decisão do dono, 2026-07-29). Tudo que
             ela mostrava — KPIs por objetivo, funil de conversão, CTR/CPC/CPM —
             vive hoje na Gestão de Tráfego: os KPIs no cartão da campanha, o
             funil no botão "Funil" da aba Campanhas, e agora com filtro por
             objetivo. Duas telas respondendo a mesma pergunta com números
             calculados por caminhos diferentes é convite pra divergirem.
             A ROTA /meta-campanhas continua de pé: quem tiver o link salvo
             ainda abre, e nada foi apagado — se fizer falta, é só devolver o
             card. -->
        <div class="smenu-card" v-if="false" @click="ir('meta-campanhas')">
          <div class="smenu-card-icon" style="background:linear-gradient(135deg,#1877F2,#0062E0)">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>
          </div>
          <div class="smenu-card-title">Análise de Campanhas</div>
          <div class="smenu-card-desc">KPIs de performance, funil de conversão, CTR, CPC, CPM e breakdown completo por campanha e objetivo.</div>
          <span class="smenu-card-enter">→</span>
        </div>
        <div class="smenu-card" v-if="hasPermission('module:meta:gestor')" @click="ir('gestao-trafego')">
          <div class="smenu-card-icon" style="background:linear-gradient(135deg,#7c3aed,#4f46e5)">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83"/></svg>
          </div>
          <div class="smenu-card-title">Gestão de Tráfego</div>
          <div class="smenu-card-desc">Agente IA analisa campanhas e sugere ações: pausar, escalar, ajustar budget e testar criativos.</div>
          <span class="smenu-card-enter">→</span>
        </div>
        <div class="smenu-card" v-if="hasPermission('module:meta:fabrica')" @click="ir('fabrica-estudio')">
          <div class="smenu-card-icon" style="background:linear-gradient(135deg,#0891b2,#4338ca)">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l2.4 7.2H22l-6 4.4 2.3 7.1L12 16.3 5.7 20.7 8 13.6l-6-4.4h7.6z"/></svg>
          </div>
          <div class="smenu-card-title">Estúdio de Criativos</div>
          <div class="smenu-card-desc">Fluxo guiado em 4 passos: gerar, curar, subir e conferir os criativos de uma campanha.</div>
          <span class="smenu-card-enter">→</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import BarraDeTopo from '../../compartilhado/barra-de-topo.vue'
import { useRouter } from 'vue-router'
import { hasPermission } from '../../compartilhado/controle-de-login-e-usuario.js'
import { adminToast } from '../../compartilhado/avisos.js'

const router = useRouter()

const logoClaroUrl = '/midia/LOGOTIPOBRENOPRETO.png'
const logoEscuroUrl = '/midia/LOGOTIPOBRENOBRANCO.png'

// Equivalente a closeMetaAds() do legado (display:none + showHome()).
function voltar() {
  router.push({ name: 'inicio' })
}

// Os dois módulos (Análise de Campanhas e Gestão de Tráfego) já têm rota de
// verdade (equivalente a openMetaCampanha()/openGestaoTrafego() do legado).
function ir(nome) {
  router.push({ name: nome })
}

// Porte de setMaHubView (legacy/index.html L8626-8633). Ao contrário do
// smenu-view da tela de vendas, este toggle NÃO persiste em localStorage no
// legado (setMaHubView nunca grava nada) — reproduzido aqui fielmente: começa
// sempre em 'grid' e não é salvo.
const visualizacao = ref('grid')
function definirVisualizacao(v) {
  visualizacao.value = v
}

// Guarda de acesso (equivalente ao if(!hasPermission('tool:meta'))return; do
// openMetaAds original).
onMounted(() => {
  if (!hasPermission('tool:meta')) {
    adminToast('Sem acesso', false)
    router.push({ name: 'inicio' })
    return
  }
})
</script>

<style scoped>
/* Porte das regras .smenu- (compartilhadas com tela-menu-vendas.vue — cada
   tela traz sua própria cópia, seguindo o padrão já estabelecido para essas
   classes reutilizadas pelo monólito legado: legacy L902-921, L1708-1715,
   L581-586). #meta-ads-hub-screen vira .tela-menu-meta-ads (sem display:none —
   a visibilidade é do router). Tela 100% estática (sem innerHTML/createElement),
   então nenhum seletor precisa de :deep(). */
/* Fundo TRANSPARENTE de propósito: o #bg-shapes (degradê + ícones) fica fixo
   atrás de tudo justamente pra aparecer. Pintando uma cor sólida por cima, a
   camada terminava onde o conteúdo terminava e o fundo reaparecia embaixo —
   era a faixa escura que se via no fim da tela. */
.tela-menu-meta-ads{min-height:100vh;display:flex;flex-direction:column;background:transparent;position:relative;z-index:1;}
.tela-menu-meta-ads .smenu-topbar{display:flex;align-items:center;justify-content:space-between;padding:13px 24px;border-bottom:1px solid var(--border);background:var(--surface);gap:16px;position:sticky;top:0;z-index:10;}
.tela-menu-meta-ads .smenu-back{font-family:var(--fonte-principal);font-size:max(9px, calc(10px * var(--escala-texto, 1)));font-weight:700;letter-spacing:2px;text-transform:uppercase;color:var(--accent);cursor:pointer;background:none;border:1px solid var(--accent-mid);border-radius:5px;padding:5px 10px;display:flex;align-items:center;gap:5px;transition:background .15s,opacity .15s;white-space:nowrap;}
.tela-menu-meta-ads .smenu-back:hover{background:var(--accent-light);}
.tela-menu-meta-ads .smenu-title{font-family:var(--fonte-principal);font-size:max(9px, calc(15px * var(--escala-texto, 1)));font-weight:500;letter-spacing:2.5px;text-transform:uppercase;color:var(--text);}
.tela-menu-meta-ads .smenu-body{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:48px 24px;gap:40px;}
.tela-menu-meta-ads .smenu-headline{text-align:center;}
.tela-menu-meta-ads .smenu-headline h2{font-family:var(--fonte-principal);font-size:max(16px, calc(26px * var(--escala-texto, 1)));font-weight:500;letter-spacing:3px;text-transform:uppercase;color:var(--text);margin-bottom:6px;}
.tela-menu-meta-ads .smenu-headline p{font-family:var(--fonte-principal);font-size:max(9px, calc(12px * var(--escala-texto, 1)));color:var(--muted);}
.tela-menu-meta-ads .smenu-cards{display:flex;gap:22px;flex-wrap:wrap;justify-content:center;}
.tela-menu-meta-ads .smenu-card{position:relative;width:270px;min-height:210px;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-xl);padding:30px 24px 48px;cursor:pointer;transition:all .25s;display:flex;flex-direction:column;gap:14px;overflow:hidden;}
.tela-menu-meta-ads .smenu-card::before{content:'';position:absolute;inset:0;background:var(--accent);opacity:0;transition:opacity .2s;border-radius:18px;}
.tela-menu-meta-ads .smenu-card:hover::before{opacity:.05;}
.tela-menu-meta-ads .smenu-card:hover{border-color:var(--accent);transform:translateY(-3px);box-shadow:0 8px 32px rgba(0,0,0,.1);}
.tela-menu-meta-ads .smenu-card-num{font-family:var(--fonte-principal);font-size:max(9px, calc(10px * var(--escala-texto, 1)));letter-spacing:3px;color:var(--muted);text-transform:uppercase;font-weight:600;}
.tela-menu-meta-ads .smenu-card-icon{width:48px;height:48px;background:var(--accent);border-radius:12px;display:flex;align-items:center;justify-content:center;}
.tela-menu-meta-ads .smenu-card-title{font-family:var(--fonte-principal);font-size:max(16px, calc(18px * var(--escala-texto, 1)));font-weight:500;letter-spacing:1.5px;text-transform:uppercase;color:var(--text);line-height:1.2;}
.tela-menu-meta-ads .smenu-card-desc{font-family:var(--fonte-principal);font-size:max(9px, calc(11px * var(--escala-texto, 1)));color:var(--muted);line-height:1.7;}
.tela-menu-meta-ads .smenu-card-enter{position:absolute;bottom:16px;right:18px;font-size:max(16px, calc(18px * var(--escala-texto, 1)));color:var(--muted);transition:all .2s;}
.tela-menu-meta-ads .smenu-card:hover .smenu-card-enter{transform:translateX(4px);color:var(--accent);}
.tela-menu-meta-ads .smenu-cards.view-list{flex-direction:column;align-items:stretch;gap:8px;width:100%;max-width:640px;}
.tela-menu-meta-ads .smenu-cards.view-list .smenu-card{width:100%;min-height:unset;flex-direction:row;padding:14px 18px 14px 20px;gap:16px;align-items:center;}
.tela-menu-meta-ads .smenu-cards.view-list .smenu-card-num{display:none;}
.tela-menu-meta-ads .smenu-cards.view-list .smenu-card-icon{width:42px;height:42px;border-radius:9px;flex-shrink:0;}
.tela-menu-meta-ads .smenu-cards.view-list .smenu-card-title{font-size:max(9px, calc(14px * var(--escala-texto, 1)));letter-spacing:1px;}
.tela-menu-meta-ads .smenu-cards.view-list .smenu-card-desc{font-size:max(9px, calc(11px * var(--escala-texto, 1)));margin:0;}
.tela-menu-meta-ads .smenu-cards.view-list .smenu-card-enter{position:static;margin-left:auto;}
@media(max-width:640px){
  .tela-menu-meta-ads .smenu-topbar{padding:8px 14px;flex-wrap:wrap;}
  .tela-menu-meta-ads .smenu-card{width:calc(50% - 11px);min-width:130px;min-height:auto;padding:20px 14px 34px;}
}
@media(max-width:380px){
  .tela-menu-meta-ads .smenu-card{width:100%;}
}

/* ── Card "Em breve" ────────────────────────────────────────────────────────
   Item que já está no mapa mas ainda não existe: aparece apagado, sem clique,
   com selo. Mostra pra onde a ferramenta está indo sem prometer um botão que
   não funciona. Nasceu na Gestão Interna (a Frota) e o dono pediu nos demais.
   Para usar: <div class="smenu-card smenu-card-embreve"> … e no lugar da seta
   <span class="smenu-card-embreve-selo">Em breve</span> */
.tela-menu-meta-ads .smenu-card-embreve{cursor:default;opacity:.55;}
.tela-menu-meta-ads .smenu-card-embreve:hover{border-color:var(--border);transform:none;box-shadow:none;}
.tela-menu-meta-ads .smenu-card-embreve:hover::before{opacity:0;}
.tela-menu-meta-ads .smenu-card-embreve-selo{position:absolute;bottom:16px;right:18px;font-family:var(--fonte-principal);font-size:max(9px, calc(9px * var(--escala-texto, 1)));font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:var(--muted);border:1px solid var(--border);border-radius:4px;padding:3px 7px;}
.tela-menu-meta-ads .smenu-cards.view-list .smenu-card-embreve-selo{position:static;margin-left:auto;}



/* ── COMO OS CARDS SE DISTRIBUEM — bloco único, por último de propósito ──────
   Esta é a ÚNICA regra que decide a distribuição. Antes havia três empilhadas
   (a original com 2 lado a lado no celular, uma minha com largura cheia, e uma
   terceira limitando a 300px) e o resultado dependia de qual ganhava a disputa.
   Aqui está tudo explícito, inclusive os `none`, para nada de antes vazar.

   CELULAR (até 767): um card sob o outro, largura cheia.
   TABLET PRA CIMA (768+): quadrados lado a lado, numa fileira só. */
@media(max-width:767px){
  .tela-menu-meta-ads .smenu-cards{display:flex;flex-direction:column;align-items:stretch;flex-wrap:nowrap;gap:12px;width:100%;max-width:none;margin-inline:0;}
  .tela-menu-meta-ads .smenu-card{width:100%;max-width:none;min-width:0;min-height:auto;flex:none;}
}
@media(min-width:768px){
  .tela-menu-meta-ads .smenu-cards{display:flex;flex-direction:row;flex-wrap:nowrap;justify-content:center;gap:18px;width:100%;max-width:1160px;margin-inline:auto;}
  .tela-menu-meta-ads .smenu-card{flex:1 1 0;width:auto;min-width:0;max-width:320px;}
}
</style>
