<script setup>
import { ref, watch, computed, onMounted, onUnmounted } from 'vue'
import { sb } from '../../compartilhado/buscar-e-salvar-dados.js'
import { sbClient } from '../../compartilhado/conectar-no-banco-de-dados.js'
// Chave `fabrica` (Plano 7): escolher criativos por `POST /fabrica/criativos/escolher` (5.8).
import { areaNaApi, pedir } from '../../compartilhado/api.js'
import AjudaTooltip from './ajuda-tooltip.vue'
import TourCoachmark from './tour-coachmark.vue'
import { TOUR_CURAR } from './tutorial-fabrica.js'
import { agruparPorLojaEPares } from './curar-agrupar.js'
const props = defineProps({ campanhaId: String })
const tourAberto = ref(false)
const itens = ref([])
const itensCampanha = ref([])
const lojas = ref([])
const visor = ref(null)
const statusCampanha = ref(null)
const motivoErro = ref(null)
let poll = null
async function carregar() {
  if (!props.campanhaId) return
  itens.value = await sb(`fabrica_criativos?select=id,url,sku,variante,arquetipo,formato,escolhido,purgado_em&campanha_id=eq.${props.campanhaId}&order=created_at`)
  if (!lojas.value.length) lojas.value = await sb(`fabrica_lojas?select=deposito_id,nome&order=ordem`)
  if (!itensCampanha.value.length) {
    const camp = await sb(`fabrica_campanhas?select=job_id&id=eq.${props.campanhaId}`)
    const jobId = camp[0]?.job_id
    if (jobId) {
      const jobs = await sb(`fabrica_jobs?select=params&id=eq.${jobId}`)
      itensCampanha.value = jobs[0]?.params?.itens || []
    }
  }
}
async function alternar(it) {
  const novo = !it.escolhido; it.escolhido = novo // otimista
  const { error } = areaNaApi('fabrica')
    ? await pedir('POST', '/fabrica/criativos/escolher', { corpo: { ids: [it.id], escolhido: novo } })
    : await sbClient.from('fabrica_criativos').update({ escolhido: novo }).eq('id', it.id)
  if (error) { it.escolhido = !novo; alert('Falha ao salvar') }
}
const visiveis = computed(() => itens.value.filter((i) => !i.purgado_em))
const todosEscolhidos = computed(() => visiveis.value.length > 0 && visiveis.value.every((i) => i.escolhido))
const secoes = computed(() =>
  agruparPorLojaEPares(itens.value.filter((i) => !i.purgado_em), itensCampanha.value, lojas.value))
const colapsadas = ref({})
function alternarSecao(loja) { colapsadas.value[loja] = !colapsadas.value[loja] }
async function alternarTodos() {
  const alvo = visiveis.value
  if (!alvo.length) return
  const novo = !todosEscolhidos.value
  const antes = alvo.map((i) => [i, i.escolhido])
  alvo.forEach((i) => { i.escolhido = novo })                 // otimista
  // pela API, lotes de até 500 (o teto da rota), cada um numa transação: um negado
  // desfaz o lote dele; a tela volta ao que era só do lote que falhou em diante
  let error = null, salvos = 0
  if (areaNaApi('fabrica')) {
    for (; salvos < alvo.length && !error; salvos += error ? 0 : 500) {
      ({ error } = await pedir('POST', '/fabrica/criativos/escolher', { corpo: { ids: alvo.slice(salvos, salvos + 500).map((i) => i.id), escolhido: novo } }))
    }
  } else {
    ({ error } = await sbClient.from('fabrica_criativos').update({ escolhido: novo }).in('id', alvo.map((i) => i.id)))
  }
  if (error) { antes.slice(salvos).forEach(([i, v]) => { i.escolhido = v }); alert('Falha ao salvar') }
}
function abrirVisor(it) { if (!it.purgado_em) visor.value = it }
function fecharVisor() { visor.value = null }
function onKey(e) { if (e.key === 'Escape') fecharVisor() }
async function lerStatus() {
  if (!props.campanhaId) return
  const r = await sb(`fabrica_campanhas?select=status,job_id&id=eq.${props.campanhaId}`)
  statusCampanha.value = r[0]?.status || null
  if (statusCampanha.value === 'erro' && r[0]?.job_id) {
    const j = await sb(`fabrica_jobs?select=erro&id=eq.${r[0].job_id}`)
    motivoErro.value = j[0]?.erro || null
  }
  if (statusCampanha.value !== 'gerando' && poll) { clearInterval(poll); poll = null }
}
async function tickStreaming() { await carregar(); await lerStatus() }
async function iniciar() {
  await carregar(); await lerStatus()
  if (statusCampanha.value === 'gerando' && !poll) poll = setInterval(tickStreaming, 4000)
}
onMounted(() => window.addEventListener('keydown', onKey))
onUnmounted(() => {
  window.removeEventListener('keydown', onKey)
  if (poll) clearInterval(poll)
})
watch(() => props.campanhaId, iniciar, { immediate: true })
</script>
<template>
  <section class="stage">
    <TourCoachmark :passos="TOUR_CURAR" v-model="tourAberto" />
    <div class="stagehead">
      <span class="badge"><i class="led hold"></i>Passo 2 · Curar</span>
      <h2>Escolha os melhores <AjudaTooltip chave="curar" /> <button class="mini" type="button" @click="tourAberto = true">Tutorial ▶</button></h2>
      <p class="lead">Toque para marcar os criativos que vão virar anúncio. Os escolhidos ficam com a borda âmbar.</p>
    </div>

    <div class="readout">
      <div class="c"><div class="k">Gerados</div><div class="v mono">{{ itens.length }}</div></div>
      <div class="c"><div class="k">Escolhidos</div><div class="v mono amber">{{ itens.filter(i => i.escolhido).length }}</div></div>
    </div>

    <div class="panel">
      <div class="ph">
        <span class="eyebrow">Criativos</span>
        <span class="ph-right">
          <button v-if="visiveis.length" class="marcar-todos" data-tour="curar-todos" @click="alternarTodos">{{ todosEscolhidos ? 'Desmarcar todos' : 'Marcar todos' }}</button>
          <span class="eyebrow muted">toque para escolher</span>
        </span>
      </div>
      <p v-if="statusCampanha === 'gerando'" class="js-run"><i class="led run"></i> Ainda gerando… os criativos vão aparecendo aqui. Pode ir marcando os que gostar.</p>
      <p v-else-if="statusCampanha === 'erro'" class="js-err">{{ motivoErro || 'A geração falhou. Volte à Fábrica e tente uma nova campanha.' }}</p>
      <div v-if="itens.length" class="curagrid" data-tour="curar-grid">
        <section v-for="sec in secoes" :key="sec.loja" class="loja-sec">
          <button class="loja-head" @click="alternarSecao(sec.loja)">
            <span class="chev">{{ colapsadas[sec.loja] ? '▸' : '▾' }}</span>
            🏬 {{ sec.loja }} <span class="loja-n">{{ sec.pares.length }} looks</span>
          </button>
          <div v-show="!colapsadas[sec.loja]" class="cg">
            <template v-for="par in sec.pares" :key="par.sku + par.variante">
              <div v-for="it in par.itens" :key="it.c.id" data-tour="curar-tile"
                   class="tile" :class="{ ok: it.c.escolhido, subido: it.c.purgado_em }">
                <img v-if="!it.c.purgado_em" class="art" :src="it.c.url" loading="lazy" @click="abrirVisor(it.c)">
                <div v-else class="art placeholder">subido — ver no Gerenciador</div>
                <label v-if="!it.c.purgado_em" class="pick" @click.stop>
                  <input type="checkbox" :checked="it.c.escolhido" @change="alternar(it.c)">
                </label>
                <span class="cap">{{ it.label }} · {{ par.variante }}</span>
              </div>
            </template>
          </div>
        </section>
      </div>
      <p v-else class="empty">Nenhum criativo por aqui ainda. Volte ao passo Gerar.</p>
    </div>

    <div v-if="visor" class="lightbox" @click.self="fecharVisor">
      <div class="lb-inner">
        <button class="lb-close" @click="fecharVisor" aria-label="Fechar">✕</button>
        <img :src="visor.url" class="lb-img" :alt="visor.arquetipo + ' ' + visor.formato">
        <div class="lb-bar">
          <span>{{ visor.arquetipo }} · {{ visor.formato }}</span>
          <button class="cmd" :class="visor.escolhido ? 'amber' : 'cyan'" @click="alternar(visor)">
            {{ visor.escolhido ? '✓ Escolhido — desmarcar' : 'Marcar como escolhido' }}
          </button>
        </div>
      </div>
    </div>
  </section>
</template>
