<template>
  <!-- Porta da família "Gestão Interna". Tela pequena e estática: bindings @click
       do Vue, sem innerHTML e sem expor nada em window. Mesmo padrão de
       tela-de-menu-vendas.vue. -->
  <div class="tela-menu-gestao-interna">
    <barra-de-topo voltar="Central" titulo="Gestão Interna" @voltar="voltar" />

    <div class="gimenu-body">
      <div class="gimenu-headline">
        <h2>Escolha o módulo</h2>
        <p>Pessoas, bens e veículos da empresa</p>
      </div>

      <div class="gimenu-cards">
        <div class="gimenu-card" v-if="podeAcessos" @click="ir('acessos')">
          <div class="gimenu-card-icon" style="background:linear-gradient(135deg,#0f766e 0%,#0d9488 100%)">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
          </div>
          <div class="gimenu-card-title">Colaboradores e Acessos</div>
          <div class="gimenu-card-desc">Quem é quem na empresa e quem tem acesso a quais pastas e contas.</div>
          <span class="gimenu-card-enter">→</span>
        </div>

        <div class="gimenu-card" v-if="podePatrimonio" @click="ir('patrimonio')">
          <div class="gimenu-card-icon" style="background:linear-gradient(135deg,color-mix(in srgb,var(--orange) 78%,var(--text)) 0%,var(--orange) 100%)">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>
          </div>
          <div class="gimenu-card-title">Patrimônio</div>
          <div class="gimenu-card-desc">Tudo que a empresa tem: onde está, quanto vale e com quem está.</div>
          <span class="gimenu-card-enter">→</span>
        </div>

        <div class="gimenu-card" v-if="podeFrota" @click="ir('frota')">
          <div class="gimenu-card-icon" style="background:linear-gradient(135deg,#475569 0%,#64748b 100%)">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 17h14M5 17a2 2 0 1 1-4 0 2 2 0 0 1 4 0zm14 0a2 2 0 1 0 4 0 2 2 0 0 0-4 0z"/><path d="M3 17V9l3-4h9l4 5v7"/></svg>
          </div>
          <div class="gimenu-card-title">Frota</div>
          <div class="gimenu-card-desc">Onde está cada carro, com quem, e quanto já rodou.</div>
          <span class="gimenu-card-enter">→</span>
        </div>

        <div class="gimenu-card" v-if="podeAutenticidade" @click="ir('autenticidade')">
          <div class="gimenu-card-icon" style="background:linear-gradient(135deg,#3f6212 0%,#65a30d 100%)">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M9 12l2 2 4-4"/></svg>
          </div>
          <div class="gimenu-card-title">Autenticidade e Garantia</div>
          <div class="gimenu-card-desc">As etiquetas das bolsas, as garantias registradas e os sinais de cópia.</div>
          <span class="gimenu-card-enter">→</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted } from 'vue'
import BarraDeTopo from '../../compartilhado/barra-de-topo.vue'
import { useRouter } from 'vue-router'
import { hasPermission } from '../../compartilhado/controle-de-login-e-usuario.js'
import { adminToast } from '../../compartilhado/avisos.js'

const router = useRouter()

const podeAcessos = computed(() => hasPermission('acessos', 'ver'))
const podePatrimonio = computed(() => hasPermission('patrimonio', 'ver'))
const podeFrota = computed(() => hasPermission('frota', 'ver'))
const podeAutenticidade = computed(() => hasPermission('autenticidade', 'ver'))

function voltar() {
  router.push({ name: 'inicio' })
}

function ir(nome) {
  router.push({ name: nome })
}

// O menu não tem permissão própria: quem não tem NENHUM submódulo não tem o que
// fazer aqui e volta pra Central com aviso, em vez de encarar um menu vazio.
onMounted(() => {
  // Frota e Autenticidade também contam. Sem elas na conta, quem tivesse SÓ um
  // desses dois era mandado de volta pra Central com "Sem acesso" — mesmo com o
  // card dele visível bem ali. Era um defeito silencioso da Frota, herdado aqui.
  if (!podeAcessos.value && !podePatrimonio.value && !podeFrota.value && !podeAutenticidade.value) {
    adminToast('Sem acesso', false)
    router.push({ name: 'inicio' })
  }
})

const logoClaroUrl = '/midia/LOGOTIPOBRENOPRETO.png'
const logoEscuroUrl = '/midia/LOGOTIPOBRENOBRANCO.png'
</script>

<style scoped>
/* Fundo TRANSPARENTE de propósito: o #bg-shapes (degradê + ícones) fica fixo
   atrás de tudo justamente pra aparecer. Pintando uma cor sólida por cima, a
   camada terminava onde o conteúdo terminava e o fundo reaparecia embaixo —
   era a faixa escura que se via no fim da tela. */
.tela-menu-gestao-interna{min-height:100vh;display:flex;flex-direction:column;background:transparent;position:relative;z-index:1;}
.tela-menu-gestao-interna .gimenu-topbar .rbv-logo{height:24px;width:auto;}
.tela-menu-gestao-interna .gimenu-topbar{display:flex;align-items:center;justify-content:space-between;padding:13px 24px;border-bottom:1px solid var(--border);background:var(--surface);gap:16px;position:sticky;top:0;z-index:10;}
.tela-menu-gestao-interna .gimenu-back{font-family:var(--fonte-principal);font-size:max(9px, calc(10px * var(--escala-texto, 1)));font-weight:700;letter-spacing:2px;text-transform:uppercase;color:var(--accent);cursor:pointer;background:none;border:1px solid var(--accent-mid);border-radius:5px;padding:5px 10px;display:flex;align-items:center;gap:5px;transition:background .15s;white-space:nowrap;}
.tela-menu-gestao-interna .gimenu-back:hover{background:var(--accent-light);}
.tela-menu-gestao-interna .gimenu-title{font-family:var(--fonte-principal);font-size:max(9px, calc(15px * var(--escala-texto, 1)));font-weight:500;letter-spacing:2.5px;text-transform:uppercase;color:var(--text);}
.tela-menu-gestao-interna .gimenu-body{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:48px 24px;gap:40px;}
.tela-menu-gestao-interna .gimenu-headline{text-align:center;}
.tela-menu-gestao-interna .gimenu-headline h2{font-family:var(--fonte-principal);font-size:max(16px, calc(26px * var(--escala-texto, 1)));font-weight:500;letter-spacing:3px;text-transform:uppercase;color:var(--text);margin-bottom:6px;}
.tela-menu-gestao-interna .gimenu-headline p{font-family:var(--fonte-principal);font-size:max(9px, calc(12px * var(--escala-texto, 1)));color:var(--muted);}
/* Celular: um sob o outro. Tablet pra cima: quadrados lado a lado, todos na
   mesma fileira (o max-width cabe 4). */
.tela-menu-gestao-interna .gimenu-cards{display:flex;gap:22px;flex-wrap:wrap;justify-content:center;width:100%;max-width:1160px;margin-inline:auto;}
.tela-menu-gestao-interna .gimenu-card{position:relative;width:270px;min-height:210px;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-xl);padding:30px 24px 48px;cursor:pointer;transition:all .25s;display:flex;flex-direction:column;gap:14px;overflow:hidden;}
.tela-menu-gestao-interna .gimenu-card:hover{border-color:var(--accent);transform:translateY(-3px);box-shadow:0 8px 32px rgba(0,0,0,.1);}
.tela-menu-gestao-interna .gimenu-card-icon{width:48px;height:48px;border-radius:12px;display:flex;align-items:center;justify-content:center;}
.tela-menu-gestao-interna .gimenu-card-title{font-family:var(--fonte-principal);font-size:max(16px, calc(18px * var(--escala-texto, 1)));font-weight:500;letter-spacing:1.5px;text-transform:uppercase;color:var(--text);line-height:1.2;}
.tela-menu-gestao-interna .gimenu-card-desc{font-family:var(--fonte-principal);font-size:max(9px, calc(11px * var(--escala-texto, 1)));color:var(--muted);line-height:1.7;}
.tela-menu-gestao-interna .gimenu-card-enter{position:absolute;bottom:16px;right:18px;font-size:max(16px, calc(18px * var(--escala-texto, 1)));color:var(--muted);transition:all .2s;}
.tela-menu-gestao-interna .gimenu-card:hover .gimenu-card-enter{transform:translateX(4px);color:var(--accent);}
.tela-menu-gestao-interna .gimenu-card-embreve{cursor:default;opacity:.55;}
.tela-menu-gestao-interna .gimenu-card-embreve:hover{border-color:var(--border);transform:none;box-shadow:none;}
.tela-menu-gestao-interna .gimenu-card-embreve-selo{position:absolute;bottom:16px;right:18px;font-family:var(--fonte-principal);font-size:max(9px, calc(9px * var(--escala-texto, 1)));font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:var(--muted);border:1px solid var(--border);border-radius:4px;padding:3px 7px;}
@media(max-width:640px){
  .tela-menu-gestao-interna .gimenu-topbar{padding:8px 14px;}
  .tela-menu-gestao-interna .gimenu-body{padding:28px 14px;gap:26px;}
  .tela-menu-gestao-interna .gimenu-cards{width:100%;gap:12px;}
  .tela-menu-gestao-interna .gimenu-card{width:100%;min-height:auto;padding:18px 16px 40px;}
}


/* ── COMO OS CARDS SE DISTRIBUEM — bloco único, por último de propósito ──────
   Esta é a ÚNICA regra que decide a distribuição. Antes havia três empilhadas
   (a original com 2 lado a lado no celular, uma minha com largura cheia, e uma
   terceira limitando a 300px) e o resultado dependia de qual ganhava a disputa.
   Aqui está tudo explícito, inclusive os `none`, para nada de antes vazar.

   CELULAR (até 767): um card sob o outro, largura cheia.
   TABLET PRA CIMA (768+): quadrados lado a lado, numa fileira só. */
@media(max-width:767px){
  .tela-menu-gestao-interna .gimenu-cards{display:flex;flex-direction:column;align-items:stretch;flex-wrap:nowrap;gap:12px;width:100%;max-width:none;margin-inline:0;}
  .tela-menu-gestao-interna .gimenu-card{width:100%;max-width:none;min-width:0;min-height:auto;flex:none;}
}
@media(min-width:768px){
  .tela-menu-gestao-interna .gimenu-cards{display:flex;flex-direction:row;flex-wrap:nowrap;justify-content:center;gap:18px;width:100%;max-width:1160px;margin-inline:auto;}
  .tela-menu-gestao-interna .gimenu-card{flex:1 1 0;width:auto;min-width:0;max-width:320px;}
}
</style>
