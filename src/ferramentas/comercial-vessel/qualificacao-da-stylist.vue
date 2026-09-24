<template>
  <section class="cv-qualificacao">
    <h3 class="cv-etiqueta cv-etiqueta-interna id-titulo"><icone-do-bloco nome="medalha" />Qualificação</h3>
    <p v-if="erro" class="cv-nota cv-nota-erro">{{ erro }}</p>
    <p v-else-if="carregando" class="cv-carregando">Carregando…</p>
    <template v-else>
      <div class="cv-qualificacao-vigente">
        <span class="cv-selo id-selo" :class="`id-tom-${selo.tom}`">{{ selo.texto }}</span>
        <p v-if="vigente" class="cv-sub">
          avaliada em {{ dataLegivel(diaDoInstante(vigente.avaliado_em)) }}<span v-if="vigente.avaliado_por_nome">
          por {{ vigente.avaliado_por_nome }}</span></p>
        <p v-else class="cv-sub"><b>Ninguém avaliou {{ primeiroNome }} ainda.</b> Avalie para ela ganhar a faixa.</p>
      </div>
      <p v-if="reavaliar" class="cv-nota cv-nota-aviso">
        <b>Encontro realizado — vale reavaliar.</b> O último encontro dela foi em
        {{ dataLegivel(ultimoRealizadoEm) }}, depois da avaliação.</p>
      <p class="cv-nota">
        Nota de 0 a 100 (A a partir de 75, B de 55 a 74, C abaixo de 55). Uma
        pessoa avalia; o sistema só sugere. A nota não trava etapa nenhuma.</p>

      <div v-if="podeEditar" class="cv-acoes">
        <!-- ⚠️ DESTAQUE SÓ QUANDO HÁ O QUE FAZER: sem nota (ou encontro depois
             da nota) o botão é o principal; com nota em dia, é um botão comum.
             Nunca olha a etapa do funil. -->
        <button type="button" class="btn cv-botao-avaliar" :class="{ 'btn-principal': !vigente || reavaliar }" @click="abrir = true">
          <icone-do-bloco nome="avaliar" />{{ vigente ? 'Reavaliar' : 'Avaliar' }}</button>
      </div>
      <p v-if="salvo" class="cv-nota cv-nota-ok">Avaliação gravada: {{ salvo.nota }} · Faixa {{ salvo.faixa }}.</p>

      <template v-if="lista.length">
        <h4 class="cv-etiqueta cv-etiqueta-interna id-subtitulo">Histórico de avaliações</h4>
        <p class="cv-sub cv-qualificacao-trilha">{{ historicoEscrito(lista) }}</p>
        <ul class="cv-historico">
          <li v-for="q in lista" :key="q.id" :class="`id-tom-${seloDaFaixa(q).tom}`" class="cv-historico-nota">
            <p class="cv-sub"><b>{{ seloDaFaixa(q).texto }}</b> · {{ dataLegivel(diaDoInstante(q.avaliado_em)) }}<span
              v-if="q.avaliado_por_nome"> · {{ q.avaliado_por_nome }}</span></p>
            <p class="cv-sub">{{ niveisEscritos(q) }}</p>
            <p v-if="q.observacao" class="cv-nota cv-nota-primeira">{{ q.observacao }}</p>
          </li>
        </ul>
      </template>
    </template>

    <avaliar-a-stylist v-if="abrir" :codigo="codigo" :nome="nome" :chamar="chamar"
                       :inicial="niveisDe(vigente)" :sugestoes="sugestoesDaAvaliacao(desdeOInicio)"
                       @fechar="abrir = false" @salvo="aoSalvar" />
  </section>
</template>

<script setup>
/* O BLOCO "QUALIFICAÇÃO" DA FICHA — a nota vigente, o aviso de reavaliar, o
 * botão de avaliar e o histórico (que só acrescenta: reavaliar não apaga).
 *
 * ⚠️ QUEM SÓ VÊ LÊ TUDO, MAS NÃO VÊ O BOTÃO: a trava de mexer é a mesma do CRM
 * (`is_vessel_atendimentos_editar`), e o banco recusa de qualquer jeito. */
import { ref, computed, onMounted } from 'vue'
import IconeDoBloco from '../../compartilhado/icone-do-bloco.vue'
import AvaliarAStylist from './avaliar-a-stylist.vue'
import { dataLegivel } from './enderecos-publicos.js'
import {
  CRITERIOS, seloDaFaixa, historicoEscrito, valeReavaliar, niveisDe, sugestoesDaAvaliacao,
} from './qualificacao-regras.js'

const props = defineProps({
  codigo: { type: String, required: true },
  nome: { type: String, required: true },
  chamar: { type: Function, required: true },
  podeEditar: { type: Boolean, default: false },
  // O scorecard "desde o início" (vem do bloco de cima): sugestões e o aviso.
  desdeOInicio: { type: Object, default: null },
})
const emit = defineEmits(['mudou'])

const lista = ref([])
const carregando = ref(true)
const erro = ref('')
const abrir = ref(false)
const salvo = ref(null)
const primeiroNome = computed(() => String(props.nome || '').split(' ')[0])
const vigente = computed(() => lista.value[0] || null)
const selo = computed(() => seloDaFaixa(vigente.value))
const ultimoRealizadoEm = computed(() => props.desdeOInicio?.ultimo_realizado_em || null)
const reavaliar = computed(() => valeReavaliar(vigente.value, ultimoRealizadoEm.value))

const ROTULO_CURTO = { carteira: 'Carteira', portfolio: 'Portfólio', mobilizacao: 'Mobilização', acesso: 'Acesso', confiabilidade: 'Confiabilidade' }
const niveisEscritos = (q) => CRITERIOS.map((c) => `${ROTULO_CURTO[c.chave]} ${q[c.chave]}`).join(' · ')

async function carregar() {
  carregando.value = true
  erro.value = ''
  try { lista.value = await props.chamar('vessel_stylist_qualificacoes', { p_codigo: props.codigo }) || [] }
  catch { erro.value = 'Não consegui ler as avaliações agora. Tente de novo em um instante.' }
  finally { carregando.value = false }
}

async function aoSalvar(r) {
  abrir.value = false
  salvo.value = r
  await carregar()
  emit('mudou')
}

const doisDigitos = (n) => String(n).padStart(2, '0')
function diaDoInstante(iso) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return `${d.getFullYear()}-${doisDigitos(d.getMonth() + 1)}-${doisDigitos(d.getDate())}`
}

onMounted(carregar)
</script>

<style scoped>
@import './estilo-comercial.css';
@import '../../estilos/identidade-da-ferramenta.css';
</style>
