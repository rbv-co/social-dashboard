<template>
  <!-- Porte fiel de #sales-menu-screen (legacy/index.html L11772-11815). Tela pequena
       e estática (sem innerHTML/createElement) — por isso segue o padrão simples de
       tela-de-banco.vue: bindings @click do Vue, sem necessidade de expor nada em
       window. Root vira .tela-menu-vendas (sem display:none — quem controla a
       visibilidade agora é o vue-router). -->
  <div class="tela-menu-vendas">
    <barra-de-topo voltar="Central" titulo="Dashboard de Vendas" @voltar="voltar">
      <template #acoes>
        <button class="bt-acao so-icone" :class="{ primario: visualizacao === 'grid' }" @click="definirVisualizacao('grid')" title="Cards">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>
        </button>
        <button class="bt-acao so-icone" :class="{ primario: visualizacao === 'list' }" @click="definirVisualizacao('list')" title="Lista">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
        </button>
      </template>
    </barra-de-topo>
    <div class="smenu-body" :style="visualizacao === 'list' ? { justifyContent: 'flex-start', paddingTop: '28px' } : {}">
      <div class="smenu-headline" v-show="visualizacao !== 'list'">
        <h2>Escolha seu modo</h2>
        <p>Visualizações disponíveis para dados de vendas</p>
      </div>
      <div class="smenu-cards" :class="{ 'view-list': visualizacao === 'list' }">
        <div class="smenu-card" v-if="hasPermission('module:sales:gestao-vista')" @click="ir('gestao-vista')">
          <div class="smenu-card-icon" style="background:linear-gradient(135deg,#0f4c81 0%,var(--accent) 100%)">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
          </div>
          <div class="smenu-card-title">Gestão à Vista</div>
          <div class="smenu-card-desc">Painel dinâmico para TVs — ranking em tempo real, metas e evolução do mês para manter o time focado em vendas.</div>
          <span class="smenu-card-enter">→</span>
        </div>
        <div class="smenu-card" v-if="hasPermission('module:sales:analise-vendas')" @click="ir('analise-vendas-marca')">
          <div class="smenu-card-icon" style="background:linear-gradient(135deg,#0f766e 0%,#0d9488 100%)">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>
          </div>
          <div class="smenu-card-title">Análise de Vendas</div>
          <div class="smenu-card-desc">KPIs detalhados, histórico e breakdown completo por canal, loja e vendedor — por marca.</div>
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

// Equivalente a closeSalesDashboard() do legado (display:none + showHome()).
function voltar() {
  router.push({ name: 'inicio' })
}

// Equivalente a openSalesBrandPicker()/router.push do legado — os dois cards
// (Gestão à Vista e Análise de Vendas) já têm rota de verdade.
function ir(nome) {
  router.push({ name: nome })
}

// Porte de setSMenuView (legacy/index.html L5727-5738), com persistência idêntica
// em localStorage. Aqui vira estado reativo (mesmo padrão de tela-inicial.vue),
// já que o toggle grid/lista é sempre parte do template estático desta tela.
const visualizacao = ref(localStorage.getItem('smenu-view') || 'grid')
function definirVisualizacao(v) {
  visualizacao.value = v
  localStorage.setItem('smenu-view', v)
}

onMounted(() => {
  if (!hasPermission('tool:sales')) {
    adminToast('Sem acesso', false)
    router.push({ name: 'inicio' })
    return
  }
})
</script>

<style scoped>
/* Porte das regras .smenu- e #sales-menu-screen (legacy L902-921, L1708-1715,
   L581-586). #sales-menu-screen vira .tela-menu-vendas (sem display:none — a
   visibilidade é do router). Tela 100% estática (sem innerHTML/createElement),
   então nenhum seletor precisa de :deep(). */
/* Fundo TRANSPARENTE de propósito: o #bg-shapes (degradê + ícones) fica fixo
   atrás de tudo justamente pra aparecer. Pintando uma cor sólida por cima, a
   camada terminava onde o conteúdo terminava e o fundo reaparecia embaixo —
   era a faixa escura que se via no fim da tela. */
.tela-menu-vendas{min-height:100vh;display:flex;flex-direction:column;background:transparent;position:relative;z-index:1;}
.tela-menu-vendas .smenu-topbar{display:flex;align-items:center;justify-content:space-between;padding:13px 24px;border-bottom:1px solid var(--border);background:var(--surface);gap:16px;position:sticky;top:0;z-index:10;}
.tela-menu-vendas .smenu-back{font-family:var(--fonte-principal);font-size:max(9px, calc(10px * var(--escala-texto, 1)));font-weight:700;letter-spacing:2px;text-transform:uppercase;color:var(--accent);cursor:pointer;background:none;border:1px solid var(--accent-mid);border-radius:5px;padding:5px 10px;display:flex;align-items:center;gap:5px;transition:background .15s,opacity .15s;white-space:nowrap;}
.tela-menu-vendas .smenu-back:hover{background:var(--accent-light);}
.tela-menu-vendas .smenu-title{font-family:var(--fonte-principal);font-size:max(9px, calc(15px * var(--escala-texto, 1)));font-weight:500;letter-spacing:2.5px;text-transform:uppercase;color:var(--text);}
.tela-menu-vendas .smenu-body{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:48px 24px;gap:40px;}
.tela-menu-vendas .smenu-headline{text-align:center;}
.tela-menu-vendas .smenu-headline h2{font-family:var(--fonte-principal);font-size:max(16px, calc(26px * var(--escala-texto, 1)));font-weight:500;letter-spacing:3px;text-transform:uppercase;color:var(--text);margin-bottom:6px;}
.tela-menu-vendas .smenu-headline p{font-family:var(--fonte-principal);font-size:max(9px, calc(12px * var(--escala-texto, 1)));color:var(--muted);}
.tela-menu-vendas .smenu-cards{display:flex;gap:22px;flex-wrap:wrap;justify-content:center;}
.tela-menu-vendas .smenu-card{position:relative;width:270px;min-height:210px;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-xl);padding:30px 24px 48px;cursor:pointer;transition:all .25s;display:flex;flex-direction:column;gap:14px;overflow:hidden;}
.tela-menu-vendas .smenu-card::before{content:'';position:absolute;inset:0;background:var(--accent);opacity:0;transition:opacity .2s;border-radius:18px;}
.tela-menu-vendas .smenu-card:hover::before{opacity:.05;}
.tela-menu-vendas .smenu-card:hover{border-color:var(--accent);transform:translateY(-3px);box-shadow:0 8px 32px rgba(0,0,0,.1);}
.tela-menu-vendas .smenu-card-num{font-family:var(--fonte-principal);font-size:max(9px, calc(10px * var(--escala-texto, 1)));letter-spacing:3px;color:var(--muted);text-transform:uppercase;font-weight:600;}
.tela-menu-vendas .smenu-card-icon{width:48px;height:48px;background:var(--accent);border-radius:12px;display:flex;align-items:center;justify-content:center;}
.tela-menu-vendas .smenu-card-title{font-family:var(--fonte-principal);font-size:max(16px, calc(18px * var(--escala-texto, 1)));font-weight:500;letter-spacing:1.5px;text-transform:uppercase;color:var(--text);line-height:1.2;}
.tela-menu-vendas .smenu-card-desc{font-family:var(--fonte-principal);font-size:max(9px, calc(11px * var(--escala-texto, 1)));color:var(--muted);line-height:1.7;}
.tela-menu-vendas .smenu-card-enter{position:absolute;bottom:16px;right:18px;font-size:max(16px, calc(18px * var(--escala-texto, 1)));color:var(--muted);transition:all .2s;}
.tela-menu-vendas .smenu-card:hover .smenu-card-enter{transform:translateX(4px);color:var(--accent);}
.tela-menu-vendas .smenu-cards.view-list{flex-direction:column;align-items:stretch;gap:8px;width:100%;max-width:640px;}
.tela-menu-vendas .smenu-cards.view-list .smenu-card{width:100%;min-height:unset;flex-direction:row;padding:14px 18px 14px 20px;gap:16px;align-items:center;}
.tela-menu-vendas .smenu-cards.view-list .smenu-card-num{display:none;}
.tela-menu-vendas .smenu-cards.view-list .smenu-card-icon{width:42px;height:42px;border-radius:9px;flex-shrink:0;}
.tela-menu-vendas .smenu-cards.view-list .smenu-card-title{font-size:max(9px, calc(14px * var(--escala-texto, 1)));letter-spacing:1px;}
.tela-menu-vendas .smenu-cards.view-list .smenu-card-desc{font-size:max(9px, calc(11px * var(--escala-texto, 1)));margin:0;}
.tela-menu-vendas .smenu-cards.view-list .smenu-card-enter{position:static;margin-left:auto;}
@media(max-width:640px){
  .tela-menu-vendas .smenu-topbar{padding:8px 14px;flex-wrap:wrap;}
  .tela-menu-vendas .smenu-card{width:calc(50% - 11px);min-width:130px;min-height:auto;padding:20px 14px 34px;}
}
@media(max-width:380px){
  .tela-menu-vendas .smenu-card{width:100%;}
}

/* ── Card "Em breve" ────────────────────────────────────────────────────────
   Item que já está no mapa mas ainda não existe: aparece apagado, sem clique,
   com selo. Mostra pra onde a ferramenta está indo sem prometer um botão que
   não funciona. Nasceu na Gestão Interna (a Frota) e o dono pediu nos demais.
   Para usar: <div class="smenu-card smenu-card-embreve"> … e no lugar da seta
   <span class="smenu-card-embreve-selo">Em breve</span> */
.tela-menu-vendas .smenu-card-embreve{cursor:default;opacity:.55;}
.tela-menu-vendas .smenu-card-embreve:hover{border-color:var(--border);transform:none;box-shadow:none;}
.tela-menu-vendas .smenu-card-embreve:hover::before{opacity:0;}
.tela-menu-vendas .smenu-card-embreve-selo{position:absolute;bottom:16px;right:18px;font-family:var(--fonte-principal);font-size:max(9px, calc(9px * var(--escala-texto, 1)));font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:var(--muted);border:1px solid var(--border);border-radius:4px;padding:3px 7px;}
.tela-menu-vendas .smenu-cards.view-list .smenu-card-embreve-selo{position:static;margin-left:auto;}



/* ── COMO OS CARDS SE DISTRIBUEM — bloco único, por último de propósito ──────
   Esta é a ÚNICA regra que decide a distribuição. Antes havia três empilhadas
   (a original com 2 lado a lado no celular, uma minha com largura cheia, e uma
   terceira limitando a 300px) e o resultado dependia de qual ganhava a disputa.
   Aqui está tudo explícito, inclusive os `none`, para nada de antes vazar.

   CELULAR (até 767): um card sob o outro, largura cheia.
   TABLET PRA CIMA (768+): quadrados lado a lado, numa fileira só. */
@media(max-width:767px){
  .tela-menu-vendas .smenu-cards{display:flex;flex-direction:column;align-items:stretch;flex-wrap:nowrap;gap:12px;width:100%;max-width:none;margin-inline:0;}
  .tela-menu-vendas .smenu-card{width:100%;max-width:none;min-width:0;min-height:auto;flex:none;}
}
@media(min-width:768px){
  .tela-menu-vendas .smenu-cards{display:flex;flex-direction:row;flex-wrap:nowrap;justify-content:center;gap:18px;width:100%;max-width:1160px;margin-inline:auto;}
  .tela-menu-vendas .smenu-card{flex:1 1 0;width:auto;min-width:0;max-width:320px;}
}
</style>
