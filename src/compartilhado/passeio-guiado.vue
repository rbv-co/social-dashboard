<script setup>
// Passeio guiado: acende um ponto da tela por vez e explica o que ele faz.
//
// Nasceu na Fábrica de Anúncios (ferramentas/meta-ads/tour-coachmark.vue) e foi
// promovido para cá porque o Patrimônio precisou do mesmo, e a Frota vai
// precisar. A diferença desta versão: ela traz o PRÓPRIO estilo. A da Fábrica
// depende de classes do estudio.css (.cmd, .mini) e a Gestão à Vista teve que
// reestilizar por cima — quem usar esta aqui não precisa saber de nada.
//
// As duas cópias convivem de propósito: as telas antigas têm tour funcionando e
// eu não consigo abri-las logado para conferir se a troca manteria a aparência.
// Unificar é follow-up, com o dono olhando.
import { ref, watch, nextTick, onUnmounted, onMounted } from 'vue'
import { posicaoDoBalao } from './posicao-do-balao.js'

const props = defineProps({
  passos: { type: Array, required: true },
  modelValue: Boolean,
})
const emit = defineEmits(['update:modelValue'])

const idx = ref(0)
const rect = ref(null)   // onde está o alvo do passo atual
const passo = ref(null)

function medir() {
  const p = props.passos[idx.value]
  passo.value = p || null
  if (!p) return
  const el = document.querySelector(p.selector)
  // Alvo ausente (botão escondido por permissão, por exemplo): sem realce, e o
  // balão vai pro centro. O texto aparece de qualquer jeito — um passo que some
  // em silêncio deixa o passeio pulando número e parecendo quebrado.
  if (!el) { rect.value = null; return }
  const r = el.getBoundingClientRect()
  rect.value = { top: r.top, left: r.left, width: r.width, height: r.height }
}

async function irPara(i) {
  const n = Math.max(0, Math.min(i, props.passos.length - 1))
  idx.value = n
  await nextTick()
  // O scroll acontece UMA vez, ao trocar de passo — nunca dentro de medir():
  // medir() é chamado pelo listener de 'scroll', e rolar ali dispararia scroll
  // de novo, num laço que trava a tela. (Herdado da versão da Fábrica, que já
  // levou esse tombo.)
  const el = document.querySelector(props.passos[n].selector)
  if (el) el.scrollIntoView({ block: 'center', behavior: 'auto' })
  medir()
  // Mede o balão DEPOIS que o texto do passo já está nele: a altura muda de um
  // passo pro outro e a posição depende dela.
  await medirBalao()
  medir()
}

function proximo() { irPara(idx.value + 1) }
function anterior() { irPara(idx.value - 1) }
function fechar() { emit('update:modelValue', false) }
function onKey(e) {
  if (e.key === 'Escape') fechar()
  else if (e.key === 'ArrowRight') proximo()
  else if (e.key === 'ArrowLeft') anterior()
}
function reMedir() { if (props.modelValue) medir() }

async function abrir() {
  idx.value = 0
  window.addEventListener('keydown', onKey)
  window.addEventListener('resize', reMedir)
  window.addEventListener('scroll', reMedir, true)
  await nextTick()
  irPara(0)
}
function limpar() {
  window.removeEventListener('keydown', onKey)
  window.removeEventListener('resize', reMedir)
  window.removeEventListener('scroll', reMedir, true)
}

watch(() => props.modelValue, (v) => { if (v) abrir(); else limpar() })
onMounted(() => { if (props.modelValue) abrir() })
onUnmounted(limpar)

const estiloRealce = () => (rect.value
  ? {
    top: rect.value.top - 6 + 'px', left: rect.value.left - 6 + 'px',
    width: rect.value.width + 12 + 'px', height: rect.value.height + 12 + 'px',
  }
  : {})

// O tamanho REAL do balão, medido depois de renderizado. Chutar a altura era a
// origem do balão cair em cima do alvo: texto de 3 linhas e de 8 linhas ocupam
// alturas bem diferentes, e a conta usava um número fixo.
const balaoEl = ref(null)
const tamBalao = ref({ largura: 330, altura: 180 })
async function medirBalao() {
  await nextTick()
  const el = balaoEl.value
  if (!el) return
  const r = el.getBoundingClientRect()
  if (r.width && r.height) tamBalao.value = { largura: r.width, altura: r.height }
}

// No celular o balão vira faixa no rodapé (CSS), então aqui não se posiciona
// nada. No desktop, a conta é pura e testada: nunca cobre o alvo.
const estiloBalao = () => {
  if (typeof window !== 'undefined' && window.innerWidth <= 640) return {}
  const p = posicaoDoBalao({
    alvo: rect.value,
    tela: { largura: window.innerWidth, altura: window.innerHeight },
    balao: tamBalao.value,
  })
  return { top: p.top + 'px', left: p.left + 'px', transform: 'none' }
}
</script>

<template>
  <!-- Teleport pro <body>: o passeio é todo position:fixed, e um ancestral com
       `zoom` (o envelope da rota, quando a pessoa aumenta a letra) ou com
       `transform` faz o fixed passar a se medir por ELE, não pela tela. O realce
       e o balão caíam em lugar errado por causa disso. Fora da árvore da tela,
       não há ancestral que possa prendê-los. -->
  <Teleport to="body">
  <div v-if="modelValue" class="passeio-fundo" v-trava-rolagem>
    <div v-if="rect" class="passeio-realce" :style="estiloRealce()"></div>
    <div class="passeio-balao" ref="balaoEl" :style="estiloBalao()" role="dialog" aria-live="polite">
      <div class="passeio-tit">{{ passo?.titulo }}</div>
      <div class="passeio-txt">{{ passo?.texto }}</div>
      <div class="passeio-acoes">
        <span class="passeio-conta">{{ idx + 1 }} de {{ passos.length }}</span>
        <button type="button" class="passeio-btn" @click="fechar">Pular</button>
        <button type="button" class="passeio-btn" :disabled="idx === 0" @click="anterior">Voltar</button>
        <button type="button" class="passeio-btn primario"
                @click="idx >= passos.length - 1 ? fechar() : proximo()">
          {{ idx >= passos.length - 1 ? 'Entendi' : 'Próximo' }}
        </button>
      </div>
    </div>
  </div>
  </Teleport>
</template>

<style scoped>
.passeio-fundo{position:fixed;inset:0;z-index:10050;background:rgba(0,0,0,.55);touch-action:none;overscroll-behavior:contain;}
.passeio-fundo > *{overscroll-behavior:contain;touch-action:pan-y;}
/* O realce é um buraco de luz: a sombra gigante escurece tudo em volta dele. */
.passeio-realce{position:fixed;border-radius:12px;border:2px solid var(--accent);box-shadow:0 0 0 9999px rgba(0,0,0,.55);pointer-events:none;transition:all .18s ease;}
.passeio-balao{position:fixed;max-width:330px;background:var(--surface);border:1px solid var(--border);border-radius:14px;box-shadow:0 12px 40px rgba(0,0,0,.28);padding:16px;font-family:var(--fonte-principal);z-index:10051;}
.passeio-tit{font-size:max(9px, calc(15px * var(--escala-texto, 1)));font-weight:700;color:var(--text);margin-bottom:6px;}
.passeio-txt{font-size:max(9px, calc(13px * var(--escala-texto, 1)));line-height:1.65;color:var(--muted);}
.passeio-acoes{display:flex;align-items:center;gap:8px;margin-top:14px;flex-wrap:wrap;}
.passeio-conta{flex:1;min-width:0;font-size:max(9px, calc(11px * var(--escala-texto, 1)));color:var(--muted);font-variant-numeric:tabular-nums;}
.passeio-btn{font-family:var(--fonte-principal);font-size:max(9px, calc(12px * var(--escala-texto, 1)));font-weight:600;padding:8px 13px;border:1px solid var(--border);border-radius:8px;background:var(--surface);color:var(--text);cursor:pointer;touch-action:manipulation;}
.passeio-btn:disabled{opacity:.45;cursor:not-allowed;}
.passeio-btn.primario{background:var(--accent);border-color:var(--accent);color:var(--sobre-cor);}

@media(max-width:640px){
  /* Balão ancorado no alvo estoura na tela pequena: aqui ele vira uma faixa
     no rodapé, largura cheia, onde o polegar já está. */
  .passeio-balao{left:10px;right:10px;bottom:calc(env(safe-area-inset-bottom,0px) + 10px);top:auto;max-width:none;transform:none;}
}
</style>
