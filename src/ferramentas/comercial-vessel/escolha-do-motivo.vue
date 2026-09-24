<template>
  <div class="cv-modal-fundo" v-trava-rolagem @click.self="cancelar">
    <div class="cv-modal cv-modal-motivo" role="dialog" :aria-label="`Motivo: ${etapa.nome}`">
      <div class="cv-modal-topo">
        <h2 class="cv-modal-titulo">{{ titulo }}</h2>
        <button type="button" class="btn cv-modal-fechar" aria-label="Cancelar" @click="cancelar">✕</button>
      </div>
      <div class="cv-modal-corpo">
        <p class="cv-nota cv-nota-primeira">
          <b>{{ etapa.nome }}</b> pede um motivo. Ele fica no histórico de etapas
          <span v-if="quantas > 1">de cada uma das {{ quantas }} parceiras</span><span v-else>dela</span>
          e entra na contagem "Saídas por motivo" do placar.
        </p>
        <div class="cv-escolha cv-motivos" role="radiogroup" aria-label="Motivo">
          <button v-for="m in motivos" :key="m.id" type="button" role="radio" class="btn"
                  :class="{ ativa: String(m.id) === escolha.motivoId }" :aria-checked="String(m.id) === escolha.motivoId"
                  @click="escolha.motivoId = String(m.id)">{{ m.nome }}</button>
        </div>
        <label class="cv-campo cv-campo-largo" for="motivo-nota">
          <span>{{ escolhido?.exige_nota ? 'Nota (obrigatória neste motivo)' : 'Nota (opcional)' }}</span>
          <textarea id="motivo-nota" rows="3" maxlength="500" v-model="escolha.nota"></textarea></label>
        <ul v-if="tocado && problemas.length" class="cv-problemas">
          <li v-for="p in problemas" :key="p">{{ p }}</li>
        </ul>
        <p v-if="erro" class="cv-nota cv-nota-erro">{{ erro }}</p>
      </div>
      <div class="cv-modal-pe">
        <div class="cv-acoes">
          <button type="button" class="btn" :disabled="gravando" @click="cancelar">Cancelar</button>
          <button type="button" class="btn btn-principal" :disabled="gravando" @click="confirmar">
            {{ gravando ? 'Gravando…' : rotuloDeConfirmarSaida(etapa) }}</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
/* A ESCOLHA DO MOTIVO DE SAÍDA (24/09/2026, pedido do dono: "quando arrasto ela
 * para Desclassificado mostra um pop-up para seleção do motivo").
 *
 * É O MESMO COMPONENTE para os três caminhos: soltar o cartão numa saída do
 * quadro, o "Ou mover para" da ficha, e a exclusão de etapa que manda gente
 * para uma saída com motivos. Ele só pergunta: quem grava é quem abriu, pela
 * mesma porta de sempre (`vessel_stylist_mover_de_etapa` ou
 * `vessel_stylist_etapa_excluir`), e o banco confere de novo.
 * ⚠️ CANCELAR NÃO MOVE NADA: o cartão nunca saiu do lugar (a tela só redesenha
 * depois que o banco disse sim).
 * Pendurado DENTRO de quem abre (um `v-if`), nunca no `body` (PADRAO, item 4). */
import { reactive, ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { motivosAtivos, problemasDoMotivo, rotuloDeConfirmarSaida } from './crm-da-stylist-regras.js'

const props = defineProps({
  etapa: { type: Object, required: true },
  nome: { type: String, default: '' },
  quantas: { type: Number, default: 1 },
  gravando: { type: Boolean, default: false },
  erro: { type: String, default: '' },
})
const emit = defineEmits(['confirmar', 'cancelar'])

const motivos = computed(() => motivosAtivos(props.etapa))
const escolha = reactive({ motivoId: '', nota: '' })
const escolhido = computed(() => motivos.value.find((m) => String(m.id) === escolha.motivoId) || null)
const problemas = computed(() => problemasDoMotivo(escolha, props.etapa))
const tocado = ref(false)
const titulo = computed(() => (props.quantas > 1
  ? `${props.quantas} parceiras para ${props.etapa.nome}`
  : `${props.nome || 'A parceira'} para ${props.etapa.nome}`))

function confirmar() {
  tocado.value = true
  if (problemas.value.length || props.gravando) return
  emit('confirmar', { motivoId: Number(escolha.motivoId), nota: escolha.nota.trim() || null })
}
function cancelar() { if (!props.gravando) emit('cancelar') }
const noTeclado = (e) => { if (e.key === 'Escape') cancelar() }
onMounted(() => window.addEventListener('keydown', noTeclado))
onBeforeUnmount(() => window.removeEventListener('keydown', noTeclado))
</script>

<style scoped>
@import './estilo-comercial.css';
@import '../../estilos/identidade-da-ferramenta.css';

.cv-motivos { margin: var(--sp-3) 0; }
.cv-motivos .btn { white-space: normal; height: auto; text-align: left; }
</style>
