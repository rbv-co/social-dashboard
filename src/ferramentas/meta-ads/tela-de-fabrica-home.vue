<script setup>
import { ref, reactive, computed, onMounted, onUnmounted } from 'vue'
import BarraDeTopo from '../../compartilhado/barra-de-topo.vue'
import { useRouter } from 'vue-router'
import { hasPermission } from '../../compartilhado/controle-de-login-e-usuario.js'
import { sb } from '../../compartilhado/buscar-e-salvar-dados.js'
import { sbClient, SUPABASE_URL, SUPABASE_ANON_KEY } from '../../compartilhado/conectar-no-banco-de-dados.js'
// Chave `edges-core` (Plano 7): meta-proxy pela API em Go.
import { areaNaApi, fetchDaApi, invocarNaArea } from '../../compartilhado/api.js'
// Chave `fabrica` (Plano 7): leituras e edges da Fábrica (5.8) pela API.
import { deOnde } from '../../compartilhado/banco-pela-api.js'
import TourCoachmark from './tour-coachmark.vue'
import { CHECKLIST, COACH } from './tutorial-fabrica.js'
import './estudio.css'
const router = useRouter()
const CHK_KEY = 'fabrica_checklist_v1', TOUR_KEY = 'fabrica_tour_v1'
const tourAberto = ref(false)
const feitos = ref((localStorage.getItem(CHK_KEY) || '').split(',').filter(Boolean))
const mostrarChecklist = ref(localStorage.getItem('fabrica_checklist_hide_v1') !== '1')
function feito(id) { return feitos.value.includes(id) || (id === 'publicar' && publicadas.value.length > 0) }
function irChecklist(item) {
  if (!feitos.value.includes(item.id)) { feitos.value.push(item.id); localStorage.setItem(CHK_KEY, feitos.value.join(',')) }
  router.push({ name: item.rota })
}
function ocultarChecklist() { mostrarChecklist.value = false; localStorage.setItem('fabrica_checklist_hide_v1', '1') }
function mostrarChecklistDeNovo() { mostrarChecklist.value = true; localStorage.removeItem('fabrica_checklist_hide_v1') }
function reverTour() { tourAberto.value = true }
const emCriacao = ref([])       // fabrica_campanhas em criação (com contagem de criativos)
const publicadas = ref([])
const nums = ref({ criando: 0, criativos: 0, publicadas: 0 })
let timer = null

async function carregar() {
  if (!hasPermission('module:meta:fabrica')) { router.push({ name: 'meta-ads' }); return }
  // em criação
  // Pela API (chave `fabrica`) a contagem de criativos vem na própria rodada
  // (`qtd_criativos`, 5.8): some o laço de uma consulta por campanha.
  const naApi = areaNaApi('fabrica')
  const camp = await sb(`fabrica_campanhas?select=id,nome,status,created_at${naApi ? ',qtd_criativos' : ''}&fechada_em=is.null&purgado_em=is.null&status=in.(gerando,pronta,erro)&order=created_at.desc`)
  if (naApi) for (const c of camp) c.qtd = c.qtd_criativos || 0
  // contagem de criativos por campanha (uma consulta por campanha; volume pequeno)
  else for (const c of camp) {
    const { count } = await sbClient.from('fabrica_criativos').select('id', { count: 'exact', head: true }).eq('campanha_id', c.id)
    c.qtd = count || 0
  }
  emCriacao.value = camp
  // remove da seleção o que não está mais em criação
  if (selecionadas.value.size) selecionadas.value = new Set(camp.filter((c) => selecionadas.value.has(c.id)).map((c) => c.id))
  publicadas.value = await sb("fabrica_campanhas?select=id,nome,fechada_em&fechada_em=not.is.null&order=fechada_em.desc&limit=8")
  const { count: totCri } = await deOnde(sbClient).from('fabrica_criativos').select('id', { count: 'exact', head: true })
  nums.value = { criando: camp.length, criativos: totCri || 0, publicadas: publicadas.value.length }
  carregarStatusPublicadas()   // em 2º plano: pinta os badges quando o Meta responde
}
const temGerando = computed(() => emCriacao.value.some((c) => c.status === 'gerando'))
function statusLabel(c) { return c.status === 'gerando' ? `Gerando… ${c.qtd} criativos` : c.status === 'pronta' ? 'Pronta pra curar' : 'Deu erro ao gerar' }
function abrir(c) { router.push({ name: 'fabrica-campanha', params: { id: c.id } }) }
function nova() { router.push({ name: 'fabrica-nova' }) }
function abrirLooks() { router.push({ name: 'fabrica-looks' }) }
function voltarCentral() { router.push({ name: 'inicio' }) }
const logoClaroUrl = '/midia/LOGOTIPOBRENOPRETO.png'
const logoEscuroUrl = '/midia/LOGOTIPOBRENOBRANCO.png'
const GERENCIADOR = 'https://adsmanager.facebook.com/adsmanager/'
const ACCOUNT_ID = 'b6883e82-07cb-4f21-9fd7-ea7626786174'
// Status real de cada campanha publicada no Meta -> badge (Ativa/Pausada/Arquivada/Excluída).
const statusPub = reactive({})   // campanhaId -> { estado, metaId }
const RANK = { ativa: 4, pausada: 3, arquivada: 2, excluida: 1 }
const BADGE = {
  ativa: { txt: 'Ativa', cls: 'ok' }, pausada: { txt: 'Pausada', cls: 'warn' },
  arquivada: { txt: 'Arquivada', cls: 'mute' }, excluida: { txt: 'Excluída', cls: 'bad' },
}
function badgeDe(id) { return BADGE[statusPub[id]?.estado] || null }
function linkGerenciador(id) { const mid = statusPub[id]?.metaId; return mid ? `${GERENCIADOR}manage/campaigns?selected_campaign_ids=${mid}` : GERENCIADOR }
function estadoDoStatus(eff) {
  const s = String(eff || '').toUpperCase()
  if (s === 'ACTIVE' || s === 'WITH_ISSUES') return 'ativa'
  if (s.includes('PAUSED')) return 'pausada'
  if (s === 'ARCHIVED') return 'arquivada'
  if (s === 'DELETED') return 'excluida'
  return 'pausada'
}
// Excluída = o Graph nega o GET (code 100 / "does not exist"). Erro transitório -> '?' (não afirma excluída).
async function statusCampanhaMeta(metaId) {
  try {
    const corpo = JSON.stringify({ accountId: ACCOUNT_ID, path: '/' + metaId, params: { fields: 'effective_status' }, method: 'GET' })
    const r = areaNaApi('edges-core')
      ? await fetchDaApi('/meta-proxy', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: corpo })
      : await fetch(SUPABASE_URL + '/functions/v1/meta-proxy', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + ((await sbClient.auth.getSession()).data.session?.access_token || SUPABASE_ANON_KEY), apikey: SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
        body: corpo,
      })
    const d = await r.json().catch(() => null)
    if (d && d.effective_status) return estadoDoStatus(d.effective_status)
    const msg = String((d && d.error && (d.error.message || d.error)) || '')
    if ((d && d.error && d.error.code === 100) || /does not exist|Unsupported get|nonexisting/i.test(msg)) return 'excluida'
    return '?'
  } catch { return '?' }
}
async function carregarStatusPublicadas() {
  const ids = publicadas.value.map((c) => c.id)
  if (!ids.length) return
  let jobs = []
  try { jobs = await sb(`fabrica_meta_jobs?select=meta_campaign_id,payload&meta_campaign_id=not.is.null&payload->>campanhaId=in.(${ids.join(',')})`) } catch { jobs = [] }
  const porCamp = {}
  for (const j of (jobs || [])) { const cid = j.payload?.campanhaId; if (!cid || !j.meta_campaign_id) continue; (porCamp[cid] ||= new Set()).add(j.meta_campaign_id) }
  await Promise.all(publicadas.value.map(async (c) => {
    const metaIds = [...(porCamp[c.id] || [])]
    if (!metaIds.length) { statusPub[c.id] = { estado: '?', metaId: null }; return }
    const estados = (await Promise.all(metaIds.map(statusCampanhaMeta))).filter((e) => e !== '?')
    const estado = estados.length ? estados.sort((a, b) => RANK[b] - RANK[a])[0] : '?'
    statusPub[c.id] = { estado, metaId: metaIds[0] }
  }))
}
async function apagar(c) {
  if (!confirm(`Apagar a campanha "${c.nome}"? ${c.status === 'gerando' ? 'A geração em andamento será cancelada. ' : ''}Isso remove os criativos e não dá pra desfazer.`)) return
  const { error } = await invocarNaArea('fabrica', sbClient, 'fabrica-apagar', { body: { campanhaId: c.id } })
  if (error) return alert('Falha ao apagar: ' + error.message)
  carregar()
}

/* ── seleção múltipla (apagar em massa das em criação) ── */
const selecionadas = ref(new Set())
const apagandoMassa = ref(false)
function selecionada(id) { return selecionadas.value.has(id) }
function alternarSel(id) { const s = new Set(selecionadas.value); s.has(id) ? s.delete(id) : s.add(id); selecionadas.value = s }
const todasSel = computed(() => emCriacao.value.length > 0 && emCriacao.value.every((c) => selecionadas.value.has(c.id)))
function alternarTodas() {
  selecionadas.value = todasSel.value ? new Set() : new Set(emCriacao.value.map((c) => c.id))
}
async function apagarSelecionadas() {
  const alvos = emCriacao.value.filter((c) => selecionadas.value.has(c.id))
  if (!alvos.length) return
  const temGerando = alvos.some((c) => c.status === 'gerando')
  if (!confirm(`Apagar ${alvos.length} campanha${alvos.length > 1 ? 's' : ''}? ${temGerando ? 'As gerações em andamento serão canceladas. ' : ''}Isso remove os criativos e não dá pra desfazer.`)) return
  apagandoMassa.value = true
  const falhas = []
  for (const c of alvos) {
    const { error } = await invocarNaArea('fabrica', sbClient, 'fabrica-apagar', { body: { campanhaId: c.id } })
    if (error) falhas.push(c.nome)
  }
  apagandoMassa.value = false
  selecionadas.value = new Set()
  if (falhas.length) alert(`Não deu pra apagar ${falhas.length} de ${alvos.length}: ${falhas.join(', ')}`)
  carregar()
}
onMounted(() => {
  carregar()
  timer = setInterval(() => { if (temGerando.value) carregar() }, 4000)
  if (localStorage.getItem(TOUR_KEY) !== '1') { localStorage.setItem(TOUR_KEY, '1'); setTimeout(() => { tourAberto.value = true }, 600) }
})
onUnmounted(() => { if (timer) clearInterval(timer) })
</script>
<template>
  <div class="fest">
    <div class="shell">
      <barra-de-topo voltar="Central" titulo="Fábrica de Anúncios" subtitulo="Painel" @voltar="voltarCentral">
        <template #acoes>
          <button class="bt-acao" @click="reverTour">Rever tour</button>
          <button class="bt-acao primario" data-tour="nova-campanha" @click="nova">+ Nova campanha</button>
        </template>
      </barra-de-topo>

      <!-- números -->
      <div class="readout" data-tour="numeros">
        <div class="c"><div class="k">Em criação</div><div class="v mono">{{ nums.criando }}</div></div>
        <div class="c"><div class="k">Criativos gerados</div><div class="v mono">{{ nums.criativos }}</div></div>
        <div class="c"><div class="k">Publicadas</div><div class="v mono">{{ nums.publicadas }}</div></div>
      </div>

      <!-- primeiros passos -->
      <div v-if="mostrarChecklist" class="panel">
        <div class="ph"><span class="eyebrow">Primeiros passos</span>
          <button class="mini" @click="ocultarChecklist">Ocultar</button></div>
        <div class="chk-list">
          <div v-for="item in CHECKLIST" :key="item.id" class="chk-item" :class="{ ok: feito(item.id) }">
            <span class="chk-mark">{{ feito(item.id) ? '✓' : '' }}</span>
            <div class="chk-body"><div class="chk-tit">{{ item.titulo }}</div><div class="chk-txt">{{ item.texto }}</div></div>
            <button class="mini" @click="irChecklist(item)">ir</button>
          </div>
        </div>
      </div>
      <p v-else class="empty"><a href="#" @click.prevent="mostrarChecklistDeNovo">mostrar primeiros passos</a></p>

      <!-- em criação -->
      <div class="panel" data-tour="em-criacao">
        <div class="ph"><span class="eyebrow">Campanhas em criação</span>
          <div v-if="emCriacao.length" class="ph-right">
            <label class="fab-selall"><input type="checkbox" :checked="todasSel" @change="alternarTodas"> Selecionar todas</label>
            <button class="cmd danger" :disabled="!selecionadas.size || apagandoMassa" @click="apagarSelecionadas">
              {{ apagandoMassa ? 'Apagando…' : (selecionadas.size ? `Apagar selecionadas (${selecionadas.size})` : 'Apagar selecionadas') }}
            </button>
          </div>
        </div>
        <div v-if="emCriacao.length" class="home-list">
          <div v-for="c in emCriacao" :key="c.id" class="fab-card" :class="[c.status, { sel: selecionada(c.id) }]">
            <label class="fab-check"><input type="checkbox" :checked="selecionada(c.id)" @change="alternarSel(c.id)" :aria-label="`Selecionar ${c.nome}`"></label>
            <div class="hc-main">
              <div class="hc-nome">{{ c.nome }}</div>
              <div class="hc-status"><i class="led" :class="c.status==='pronta' ? 'go' : c.status==='erro' ? 'abort' : 'run'"></i>{{ statusLabel(c) }}</div>
            </div>
            <div class="hc-acoes">
              <button class="cmd cyan" @click="abrir(c)">Abrir</button>
              <button class="hc-apagar" @click="apagar(c)" aria-label="Apagar">🗑</button>
            </div>
          </div>
        </div>
        <p v-else class="empty">Nenhuma campanha em criação. Clique "Nova campanha" pra começar.</p>
      </div>

      <!-- publicadas -->
      <div class="panel" data-tour="publicadas">
        <div class="ph"><span class="eyebrow">Publicadas recentes</span></div>
        <div v-if="publicadas.length" class="home-list">
          <div v-for="c in publicadas" :key="c.id" class="fab-card">
            <div class="hc-main"><div class="hc-nome">{{ c.nome }}<span v-if="badgeDe(c.id)" class="pub-badge" :class="badgeDe(c.id).cls">{{ badgeDe(c.id).txt }}</span><span v-else class="pub-badge mute">…</span></div></div>
            <a class="cmd" :href="linkGerenciador(c.id)" target="_blank">Ver no Gerenciador ↗</a>
          </div>
        </div>
        <p v-else class="empty">Nada publicado ainda.</p>
      </div>

      <!-- atalho templates (SP-5A) -->
      <div class="panel" data-tour="looks-card">
        <div class="ph"><span class="eyebrow">Looks & Templates</span></div>
        <div class="home-list">
          <div class="fab-card">
            <div class="hc-main">
              <div class="hc-nome">Galeria de looks</div>
              <div class="hc-status">Gerencie, ative/desative e reordene os looks usados na geração</div>
            </div>
            <button class="cmd cyan" @click="abrirLooks">Abrir</button>
          </div>
        </div>
      </div>
      <TourCoachmark :passos="COACH" v-model="tourAberto" />
    </div>
  </div>
</template>
