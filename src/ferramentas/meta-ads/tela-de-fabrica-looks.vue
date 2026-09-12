<script setup>
import { ref, onMounted } from 'vue'
import BarraDeTopo from '../../compartilhado/barra-de-topo.vue'
import { useRouter } from 'vue-router'
import { hasPermission } from '../../compartilhado/controle-de-login-e-usuario.js'
import { sb } from '../../compartilhado/buscar-e-salvar-dados.js'
import { sbClient } from '../../compartilhado/conectar-no-banco-de-dados.js'
// O aviso do canto da tela, o mesmo do resto da central. Não trava a página
// como o `alert()` nativo, que aqui aparecia no meio de um arrasto de ordem.
import { adminToast } from '../../compartilhado/avisos.js'
import './estudio.css'
import AjudaTooltip from './ajuda-tooltip.vue'
const router = useRouter()
const OBJETIVOS = ['engajamento', 'conversao', 'branding', 'trafego']
const looks = ref([])
const gerandoPreview = ref(false)
const mostrarExcluidos = ref(false)
async function carregar() {
  if (!hasPermission('module:meta:fabrica')) { router.push({ name: 'meta-ads' }); return }
  looks.value = await sb('fabrica_looks?select=*&order=ordem')
}
async function salvar(l) {
  const { error } = await sbClient.functions.invoke('fabrica-looks', { body: { acao: 'salvar', look: { chave: l.chave, nome: l.nome, objetivos: l.objetivos, ativo: l.ativo } } })
  if (error) { adminToast('Não consegui salvar o look: ' + error.message, false); carregar() }
}
function toggleObjetivo(l, o) { const i = l.objetivos.indexOf(o); i > -1 ? l.objetivos.splice(i, 1) : l.objetivos.push(o); salvar(l) }
function toggleAtivo(l) { l.ativo = !l.ativo; salvar(l) }
async function mover(l, dir) {
  const i = looks.value.findIndex((x) => x.chave === l.chave); const j = i + dir
  if (j < 0 || j >= looks.value.length) return
  const arr = looks.value; [arr[i], arr[j]] = [arr[j], arr[i]]
  const ordem = arr.map((x, idx) => ({ chave: x.chave, ordem: idx + 1 }))
  arr.forEach((x, idx) => { x.ordem = idx + 1 })
  // A FALHA ERA ENGOLIDA: a lista já tinha trocado de lugar na tela, e se a
  // gravação não fosse aceita a ordem certa só voltava num recarregar inteiro
  // — até lá a tela mostrava uma ordem que não existe no servidor. Desfaz a
  // troca e diz o que houve, do mesmo jeito que `salvar()` aqui do lado.
  const { error } = await sbClient.functions.invoke('fabrica-looks', { body: { acao: 'ordenar', ordem } })
  if (error) {
    adminToast('Não consegui mudar a ordem. A lista voltou para como estava.', false)
    carregar()
  }
}
async function renomear(l) { const nome = prompt('Nome do look:', l.nome); if (nome && nome !== l.nome) { l.nome = nome; salvar(l) } }
async function excluir(l) {
  if (!confirm(`Excluir o look "${l.nome}" da galeria? Ele some daqui e não gera mais criativos. Dá pra restaurar em "Mostrar excluídos".`)) return
  l.excluido = true // otimista
  const { error } = await sbClient.functions.invoke('fabrica-looks', { body: { acao: 'excluir', chave: l.chave, excluido: true } })
  if (error) { l.excluido = false; adminToast('Não consegui excluir o look: ' + error.message, false) }
}
async function restaurar(l) {
  l.excluido = false // otimista
  const { error } = await sbClient.functions.invoke('fabrica-looks', { body: { acao: 'excluir', chave: l.chave, excluido: false } })
  if (error) { l.excluido = true; adminToast('Não consegui restaurar o look: ' + error.message, false) }
}
async function gerarPreviews() {
  gerandoPreview.value = true
  const { error } = await sbClient.functions.invoke('fabrica-trigger', { body: { tipo: 'preview', params: {} } })
  gerandoPreview.value = false
  alert(error ? 'Falha: ' + error.message : 'Gerando previews — recarregue em ~1 min pra ver as imagens.')
}
function voltarFabrica() { router.push({ name: 'fabrica-estudio' }) }
const logoClaroUrl = '/midia/LOGOTIPOBRENOPRETO.png'
const logoEscuroUrl = '/midia/LOGOTIPOBRENOBRANCO.png'
onMounted(carregar)
</script>
<template>
  <div class="fest"><div class="shell">
    <barra-de-topo voltar="Fábrica" titulo="Looks &amp; Templates" subtitulo="Curadoria" @voltar="voltarFabrica">
      <template #acoes>
        <AjudaTooltip chave="looks" />
        <button class="bt-acao primario" :disabled="gerandoPreview" @click="gerarPreviews">Gerar previews</button>
      </template>
    </barra-de-topo>
    <div class="panel">
      <div class="ph">
        <span class="eyebrow">Looks</span>
        <span class="ph-right">
          <label class="loja-chip" :class="{ sel: mostrarExcluidos }"><input type="checkbox" v-model="mostrarExcluidos"> Mostrar excluídos<span v-if="looks.filter(l=>l.excluido).length"> ({{ looks.filter(l=>l.excluido).length }})</span></label>
          <span class="eyebrow muted">{{ looks.filter(l=>!l.excluido).length }} na galeria · {{ looks.filter(l=>l.ativo && !l.excluido).length }} ativos</span>
        </span>
      </div>
      <div class="looks-grid">
        <div v-for="(l, i) in looks" :key="l.chave" v-show="mostrarExcluidos || !l.excluido" class="look-card" :class="{ off: !l.ativo, excluido: l.excluido }">
          <img v-if="l.preview_url" :src="l.preview_url" class="look-prev" loading="lazy">
          <div v-else class="look-prev ph-vazio">sem preview</div>
          <div class="look-nome">{{ l.nome }} <span class="cat">{{ l.arquetipo }}</span></div>
          <div class="look-objs">
            <label v-for="o in OBJETIVOS" :key="o" class="loja-chip" :class="{ sel: l.objetivos.includes(o) }">
              <input type="checkbox" :checked="l.objetivos.includes(o)" @change="toggleObjetivo(l, o)"> {{ o }}
            </label>
          </div>
          <div class="look-acoes">
            <template v-if="!l.excluido">
              <button class="mini" @click="toggleAtivo(l)">{{ l.ativo ? 'Desativar' : 'Ativar' }}</button>
              <button class="mini" @click="renomear(l)">Renomear</button>
              <button class="mini" :disabled="i===0" @click="mover(l, -1)">↑</button>
              <button class="mini" :disabled="i===looks.length-1" @click="mover(l, 1)">↓</button>
              <button class="mini danger" @click="excluir(l)">Excluir</button>
            </template>
            <button v-else class="mini" @click="restaurar(l)">Restaurar</button>
          </div>
        </div>
      </div>
    </div>
  </div></div>
</template>
