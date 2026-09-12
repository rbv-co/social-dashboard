<template>
  <!-- Porte fiel de #sales-brand-screen (legacy/index.html L11818-11851). Tela
       pequena e quase estática (só tem 1 fetch em onMounted pra buscar as fotos
       das marcas) — mesmo padrão simples de tela-de-menu-vendas.vue: bindings
       @click do Vue, sem necessidade de expor nada em window (o onerror="..."
       das imagens é atributo nativo do DOM, não chama função nossa). Root vira
       .tela-marca-vendas (sem display:none — quem controla a visibilidade
       agora é o vue-router). -->
  <div class="tela-marca-vendas">
    <barra-de-topo voltar="Vendas" titulo="Análise de Vendas" @voltar="voltar" />
    <div class="sbrand-body">
      <div class="sbrand-title">Selecione a marca</div>
      <div class="sbrand-grid">
        <div class="sbrand-card" @click="abrirAnalise">
          <img id="sbrand-vessel-img" class="sbrand-avatar" src="" alt="Vessel" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
          <div class="sbrand-avatar-ph" style="display:none">V</div>
          <div class="sbrand-name">Vessel Brasil</div>
          <span class="sbrand-badge">Ativo</span>
        </div>
        <div class="sbrand-card soon">
          <img id="sbrand-raissa-img" class="sbrand-avatar" src="" alt="Raíssa" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
          <div class="sbrand-avatar-ph" style="display:none">R</div>
          <div class="sbrand-name">Raissa Herculano Milano</div>
          <span class="sbrand-badge soon">Em Breve</span>
        </div>
        <div class="sbrand-card soon">
          <img id="sbrand-mantova-img" class="sbrand-avatar" src="" alt="Mantova" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
          <div class="sbrand-avatar-ph" style="display:none">M</div>
          <div class="sbrand-name">Mantova Planejados</div>
          <span class="sbrand-badge soon">Em Breve</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { onMounted } from 'vue'
import BarraDeTopo from '../../compartilhado/barra-de-topo.vue'
import { useRouter } from 'vue-router'
import { sbClient } from '../../compartilhado/conectar-no-banco-de-dados.js'
import { hasPermission } from '../../compartilhado/controle-de-login-e-usuario.js'
import { adminToast } from '../../compartilhado/avisos.js'

const router = useRouter()

const logoClaroUrl = '/midia/LOGOTIPOBRENOPRETO.png'
const logoEscuroUrl = '/midia/LOGOTIPOBRENOBRANCO.png'

// ==========================================================================
// PORTE VERBATIM do seletor de marca da Análise de Vendas (legacy/index.html
// L5755-5779 — openSalesBrandPicker/closeSalesBrandPicker/loadBrandPickerPhotos),
// menos o toggle de tela por display:none / sessionStorage.setItem('rbv-screen',
// ...) / setHomeBgTheme('sales'), que foram OMITIDOS: são do fundo animado
// global (#bg-shapes) e da troca de "telas" do monólito, que não existem mais
// — quem mostra/esconde a tela agora é o vue-router (mesmo padrão de
// tela-de-menu-vendas.vue / tela-de-gestao-a-vista.vue).
//
// Dependências externas resolvidas:
//   - sbClient        → import (conectar-no-banco-de-dados.js) — usado só em
//     loadBrandPickerPhotos (busca instagram_id/profile_picture_url em accounts).
//   - hasPermission    → import (controle-de-login-e-usuario.js)
//   - adminToast       → import (avisos.js) — usado só na guarda de acesso.
// ==========================================================================

// Equivalente a closeSalesBrandPicker() do legado (display:none + volta pro
// menu de vendas).
function voltar() {
  router.push({ name: 'vendas' })
}
// Equivalente ao onclick="openSalesAnalysis()" do card da Vessel — só a Vessel
// tem rota de verdade; Raíssa/Mantova ficam desabilitadas (.soon, sem @click).
function abrirAnalise() {
  router.push({ name: 'analise-vendas' })
}

/* Porte verbatim de loadBrandPickerPhotos (legacy L6243-6257) — busca as fotos
   de perfil das 3 marcas na tabela accounts (pelo instagram_id) e injeta no
   src das <img> dos cards; se falhar (404/sem foto), o onerror="..." nativo do
   <img> troca pro avatar-placeholder com a inicial da marca. */
async function loadBrandPickerPhotos(){
  try{
    const{data}=await sbClient.from('accounts').select('instagram_id,profile_picture_url')
      .in('instagram_id',['17841462952561833','17841401847160442','17841406451230767']);
    if(!data)return;
    const byId={};data.forEach(a=>byId[a.instagram_id]=a.profile_picture_url);
    function setImg(id,igId){
      const url=byId[igId];if(!url)return;
      const img=document.getElementById(id);if(!img)return;
      img.src=url;
    }
    setImg('sbrand-vessel-img','17841462952561833');
    setImg('sbrand-raissa-img','17841401847160442');
    setImg('sbrand-mantova-img','17841406451230767');
  }catch(e){console.error('brand pics:',e);}
}

// Equivalente ao if(!hasPermission('module:sales:analise-vendas'))return; do
// openSalesBrandPicker original.
onMounted(() => {
  if (!hasPermission('module:sales:analise-vendas')) {
    adminToast('Sem acesso', false)
    router.push({ name: 'vendas' })
    return
  }
  loadBrandPickerPhotos()
})
</script>

<style scoped>
/* Porte das regras .smenu- (duplicadas de tela-de-menu-vendas.vue, mesmo
   padrão de "cada tela traz sua própria cópia" já usado em GV/GT) + .sbrand-
   (legacy L1718-1731). #sales-brand-screen vira .tela-marca-vendas (sem
   display:none — a visibilidade é do router). Tela 100% estática (só o src
   das <img> muda via JS), então nenhum seletor precisa de :deep(). */
/* Fundo TRANSPARENTE: o #bg-shapes (degradê + ícones) fica fixo atrás de tudo
   pra aparecer, e o body já pinta a cor base nos DOIS temas. Pintar cor sólida
   aqui tapava a decoração e ainda deixava uma faixa visível onde a tela
   terminava. */
.tela-marca-vendas{min-height:100vh;display:flex;flex-direction:column;background:transparent;position:relative;z-index:1;}
.tela-marca-vendas .smenu-topbar{display:flex;align-items:center;justify-content:space-between;padding:13px 24px;border-bottom:1px solid var(--border);background:var(--surface);gap:16px;position:sticky;top:0;z-index:10;}
.tela-marca-vendas .smenu-back{font-family:var(--fonte-principal);font-size:max(9px, calc(10px * var(--escala-texto, 1)));font-weight:700;letter-spacing:2px;text-transform:uppercase;color:var(--accent);cursor:pointer;background:none;border:1px solid var(--accent-mid);border-radius:5px;padding:5px 10px;display:flex;align-items:center;gap:5px;transition:background .15s,opacity .15s;white-space:nowrap;}
.tela-marca-vendas .smenu-back:hover{background:var(--accent-light);}
.tela-marca-vendas .smenu-title{font-family:var(--fonte-principal);font-size:max(9px, calc(15px * var(--escala-texto, 1)));font-weight:500;letter-spacing:2.5px;text-transform:uppercase;color:var(--text);}
.tela-marca-vendas .sbrand-body{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:48px 24px;gap:28px;}
.tela-marca-vendas .sbrand-title{font-family:var(--fonte-principal);font-size:max(16px, calc(20px * var(--escala-texto, 1)));font-weight:500;letter-spacing:2.5px;text-transform:uppercase;color:var(--text);text-align:center;}
.tela-marca-vendas .sbrand-grid{display:flex;gap:18px;flex-wrap:wrap;justify-content:center;}
.tela-marca-vendas .sbrand-card{position:relative;width:190px;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-lg);padding:26px 18px;cursor:pointer;transition:all .25s;display:flex;flex-direction:column;align-items:center;gap:12px;overflow:hidden;}
.tela-marca-vendas .sbrand-card::before{content:'';position:absolute;inset:0;background:var(--accent);opacity:0;transition:opacity .2s;}
.tela-marca-vendas .sbrand-card:hover::before{opacity:.06;}
.tela-marca-vendas .sbrand-card:hover{border-color:var(--accent);transform:translateY(-3px);box-shadow:0 6px 24px rgba(0,0,0,.09);}
.tela-marca-vendas .sbrand-card.soon{opacity:.5;cursor:default;pointer-events:none;}
.tela-marca-vendas .sbrand-avatar{width:72px;height:72px;border-radius:50%;object-fit:cover;border:2px solid var(--border);background:var(--surface2);}
.tela-marca-vendas .sbrand-avatar-ph{width:72px;height:72px;border-radius:50%;background:var(--accent);display:flex;align-items:center;justify-content:center;font-family:var(--fonte-principal);font-size:max(16px, calc(24px * var(--escala-texto, 1)));color:var(--sobre-cor);font-weight:600;flex-shrink:0;}
.tela-marca-vendas .sbrand-name{font-family:var(--fonte-principal);font-size:max(9px, calc(12px * var(--escala-texto, 1)));font-weight:500;letter-spacing:1px;text-transform:uppercase;color:var(--text);text-align:center;line-height:1.3;}
.tela-marca-vendas .sbrand-badge{font-family:var(--fonte-principal);font-size:max(9px, calc(8px * var(--escala-texto, 1)));letter-spacing:1.5px;text-transform:uppercase;padding:3px 9px;border-radius:20px;background:var(--accent-light);color:var(--accent-forte);font-weight:600;}
.tela-marca-vendas .sbrand-badge.soon{background:var(--surface2);color:var(--muted);}
@media(max-width:640px){
  .tela-marca-vendas .smenu-topbar{padding:8px 14px;flex-wrap:wrap;}
}
</style>
