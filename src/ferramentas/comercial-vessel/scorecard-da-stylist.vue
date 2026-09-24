<template>
  <section class="cv-scorecard">
    <div class="cv-cabeca">
      <div class="cv-cabeca-texto">
        <h3 class="cv-etiqueta cv-etiqueta-interna id-titulo"><icone-do-bloco nome="placar" />Scorecard</h3>
      </div>
      <label class="cv-campo cv-campo-periodo" :for="`sc-periodo-${codigo}`"><span>Período</span>
        <select :id="`sc-periodo-${codigo}`" v-model="periodo">
          <option v-for="(rotulo, chave) in PERIODOS_DO_PLACAR" :key="chave" :value="chave">{{ rotulo }}</option>
        </select></label>
    </div>

    <!-- ⚠️ ERRO NÃO VIRA ZERO: um scorecard zerado é uma afirmação sobre ela. -->
    <p v-if="erro" class="cv-nota cv-nota-erro">{{ erro }}</p>
    <p v-else-if="carregando && !sc" class="cv-carregando">Carregando o scorecard…</p>
    <template v-else-if="sc">
      <div class="id-grupo cv-grupo-encontros">
        <h4 class="cv-etiqueta cv-etiqueta-interna id-titulo"><icone-do-bloco nome="encontros" />Os encontros dela</h4>
        <div class="cv-numeros cv-numeros-placar">
          <div class="cv-numero">
            <span class="cv-numero-valor">{{ sc.encontros_agendados }}</span>
            <span class="cv-numero-rotulo">Agendados</span>
            <span class="cv-numero-base">inclui os que caíram depois</span>
          </div>
          <div class="cv-numero">
            <span class="cv-numero-valor">{{ sc.encontros_realizados }}</span>
            <span class="cv-numero-rotulo">Realizados</span>
            <span class="cv-numero-base">{{ taxas.realizacao.temBase ? `${taxaEscrita(taxas.realizacao)} dos agendados` : 'nenhum agendado no período' }}</span>
          </div>
          <div class="cv-numero">
            <span class="cv-numero-valor">{{ sc.encontros_cancelados }}</span>
            <span class="cv-numero-rotulo">Cancelados</span>
            <span class="cv-numero-base">ou não realizados</span>
          </div>
          <div class="cv-numero">
            <span class="cv-numero-valor cv-numero-valor-medio">{{ sc.proximo_encontro_em ? dataLegivel(diaDoInstante(sc.proximo_encontro_em)) : '—' }}</span>
            <span class="cv-numero-rotulo">Próximo encontro</span>
            <span class="cv-numero-base">{{ sc.proximo_encontro_codigo || 'nenhum marcado' }}</span>
          </div>
          <div class="cv-numero">
            <span class="cv-numero-valor">{{ sc.dias_desde_o_ultimo ?? '—' }}</span>
            <span class="cv-numero-rotulo">Dias desde o último</span>
            <span class="cv-numero-base">{{ sc.ultimo_realizado_em ? `realizado em ${dataLegivel(sc.ultimo_realizado_em)}` : 'nenhum realizado ainda' }}</span>
          </div>
        </div>
      </div>

      <div class="id-grupo cv-grupo-parceiras">
        <h4 class="cv-etiqueta cv-etiqueta-interna id-titulo"><icone-do-bloco nome="parceiras" />As convidadas dela</h4>
        <div class="cv-numeros cv-numeros-placar">
          <div class="cv-numero">
            <span class="cv-numero-valor">{{ sc.convidadas }}</span>
            <span class="cv-numero-rotulo">Convidadas</span>
          </div>
          <div class="cv-numero">
            <span class="cv-numero-valor">{{ sc.confirmadas }}</span>
            <span class="cv-numero-rotulo">Confirmadas</span>
            <span class="cv-numero-base">inclui quem confirmou e faltou</span>
          </div>
          <div class="cv-numero">
            <span class="cv-numero-valor">{{ sc.presentes }}</span>
            <span class="cv-numero-rotulo">Presentes</span>
          </div>
          <div class="cv-numero">
            <span class="cv-numero-valor">{{ emPorcento(taxas.showRate.valor) }}</span>
            <span class="cv-numero-rotulo">Comparecimento</span>
            <span class="cv-numero-base">{{ legendaDaTaxa('showRate', taxas.showRate) }}</span>
            <span v-if="margemEscrita(taxas.showRate)" class="cv-numero-margem">{{ margemEscrita(taxas.showRate) }}</span>
            <meta-do-numero :meta="metaDoComparecimento(taxas.showRate)" />
          </div>
        </div>
      </div>

      <div class="id-grupo cv-grupo-venda">
        <h4 class="cv-etiqueta cv-etiqueta-interna id-titulo"><icone-do-bloco nome="venda" />A venda que ela trouxe ({{ janelaEscrita(sc.janela_de_venda_em_dias) }})</h4>
        <div class="cv-numeros cv-numeros-placar">
          <div class="cv-numero">
            <span class="cv-numero-valor">{{ emReais(sc.receita) }}</span>
            <span class="cv-numero-rotulo">Receita atribuída</span>
            <span class="cv-numero-base">{{ sc.vendas }} venda(s) · {{ formatarPecas(sc.pecas) }} peça(s)</span>
          </div>
          <div class="cv-numero">
            <span class="cv-numero-valor">{{ sc.compradoras }}</span>
            <span class="cv-numero-rotulo">Compradoras</span>
            <span class="cv-numero-base">{{ taxas.conversao.temBase ? `conversão ${taxaEscrita(taxas.conversao)} das presentes` : 'nenhuma presente no período' }}</span>
            <span v-if="margemEscrita(taxas.conversao)" class="cv-numero-margem">{{ margemEscrita(taxas.conversao) }}</span>
          </div>
          <div class="cv-numero">
            <span class="cv-numero-valor">{{ vendasPorEncontroEscrito(taxas.vendasPorEncontro) }}</span>
            <span class="cv-numero-rotulo">Vendas por encontro</span>
            <span class="cv-numero-base">{{ taxas.vendasPorEncontro.temBase ? `${taxas.vendasPorEncontro.x} em ${taxas.vendasPorEncontro.n} realizado(s)` : 'nenhum encontro realizado' }}</span>
            <meta-do-numero :meta="metaDeVendasPorEncontro(taxas.vendasPorEncontro)" />
          </div>
          <div class="cv-numero">
            <span class="cv-numero-valor">{{ taxas.ticket.temBase ? emReais(taxas.ticket.valor) : '—' }}</span>
            <span class="cv-numero-rotulo">Ticket médio</span>
            <span class="cv-numero-base">{{ taxas.ticket.temBase ? `sobre ${taxas.ticket.n} venda(s)` : 'sem base ainda' }}</span>
          </div>
          <div class="cv-numero">
            <span class="cv-numero-valor">{{ taxas.receitaPorEncontro.temBase ? emReais(taxas.receitaPorEncontro.valor) : '—' }}</span>
            <span class="cv-numero-rotulo">Receita por encontro</span>
            <span class="cv-numero-base">{{ taxas.receitaPorEncontro.temBase ? `sobre ${taxas.receitaPorEncontro.n} realizado(s)` : 'sem base ainda' }}</span>
          </div>
          <div class="cv-numero">
            <span class="cv-numero-valor">{{ taxas.receitaPorConvidada.temBase ? emReais(taxas.receitaPorConvidada.valor) : '—' }}</span>
            <span class="cv-numero-rotulo">Receita por presente</span>
            <span class="cv-numero-base">{{ taxas.receitaPorConvidada.temBase ? `sobre ${taxas.receitaPorConvidada.n} presente(s)` : 'sem base ainda' }}</span>
          </div>
          <div class="cv-numero cv-numero-largo">
            <span class="cv-numero-valor">{{ emReais(professionalFeeEstimado(sc.receita)) }}</span>
            <span class="cv-numero-rotulo">Professional Fee estimado (10%)</span>
            <span class="cv-numero-base">{{ AVISO_DO_FEE }}</span>
          </div>
        </div>
      </div>

      <!-- Três leituras soltas, uma por linha (eram um parágrafo corrido). -->
      <ul class="cv-scorecard-linha">
        <li><b>Recorrente: {{ sc.recorrente ? 'sim' : 'não' }}</b>
          ({{ sc.realizados_desde_o_inicio }} realizado(s) até o fim do período)</li>
        <li><b>Intervalo médio entre os encontros dela:</b>
          {{ sc.intervalos ? `${formatarDias(sc.intervalo_medio_em_dias)} (${sc.intervalos} intervalo(s))` : 'sem base ainda' }}</li>
        <li><b>Contatos até ativar:</b>
          {{ sc.contatos_antes_de_ativar === null || sc.contatos_antes_de_ativar === undefined ? 'ainda não ativou' : sc.contatos_antes_de_ativar }}</li>
      </ul>
      <p class="cv-nota">
        As mesmas regras do placar: a venda é o pedido atendido no Bling de uma
        convidada presente, até 14 dias depois do encontro; quem foi a dois
        encontros tem a compra contada no <b>primeiro</b> — mesmo que ele seja
        de outra stylist. Por isso a soma das fichas dá o placar.
      </p>
    </template>
  </section>
</template>

<script setup>
/* O SCORECARD DE UMA STYLIST — dentro da ficha, entre os dados e o histórico
 * de contatos (decisão do dono, 24/09/2026).
 *
 * ⚠️ OS NÚMEROS SÃO OS DO PLACAR, RECORTADOS NELA: `vessel_scorecard_da_
 * stylist` chama o MESMO miolo que `vessel_placar_do_stylist_circle`
 * (migration 2026-09-24). As taxas saem de `taxasDoPlacar`, as metas de
 * `qualificacao-regras.js` — nada de conta reescrita aqui.
 *
 * ⚠️ O PERÍODO É SÓ DESTE BLOCO, e começa em "Desde o início". Toda vez que a
 * leitura "desde o início" chega, ela sobe pelo `desde-o-inicio`: é com ela
 * (e não com o período escolhido) que a avaliação sugere níveis. */
import { ref, computed, watch, onMounted } from 'vue'
import IconeDoBloco from '../../compartilhado/icone-do-bloco.vue'
import MetaDoNumero from './meta-do-numero.vue'
import { PERIODOS_DO_PLACAR, periodoDoPlacar, taxasDoPlacar, legendaDaTaxa } from './t11-regras.js'
import { taxaEscrita, margemEscrita, emPorcento, emReais, janelaEscrita } from './estatistica.js'
import { dataLegivel } from './enderecos-publicos.js'
import {
  metaDoComparecimento, metaDeVendasPorEncontro, vendasPorEncontroEscrito, professionalFeeEstimado, AVISO_DO_FEE,
} from './qualificacao-regras.js'

const props = defineProps({
  codigo: { type: String, required: true },
  chamar: { type: Function, required: true },
  // Muda quando algo da ficha foi gravado e o scorecard precisa reler.
  versao: { type: Number, default: 0 },
})
const emit = defineEmits(['desde-o-inicio'])

// A mesma janela de atribuição do placar e do rastreio (T11: D0 a D+14).
const P_DIAS = 14

const periodo = ref('tudo')
const sc = ref(null)
const carregando = ref(false)
const erro = ref('')
const taxas = computed(() => taxasDoPlacar(sc.value))

async function carregar() {
  carregando.value = true
  erro.value = ''
  try {
    const { p_de, p_ate } = periodoDoPlacar(periodo.value)
    const r = await props.chamar('vessel_scorecard_da_stylist', { p_codigo: props.codigo, p_de, p_ate, p_dias: P_DIAS })
    if (!r?.ok) {
      sc.value = null
      erro.value = r?.situacao === 'nao_achei'
        ? 'Não achei mais esta parceira. Recarregue a página.'
        : 'Não consegui ler o scorecard agora. Tente de novo em um instante.'
      return
    }
    sc.value = r
    if (periodo.value === 'tudo') emit('desde-o-inicio', r)
  } catch {
    sc.value = null
    erro.value = 'Não consegui ler o scorecard agora. Tente de novo em um instante.'
  } finally {
    carregando.value = false
  }
}

const doisDigitos = (n) => String(n).padStart(2, '0')
function diaDoInstante(iso) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return `${d.getFullYear()}-${doisDigitos(d.getMonth() + 1)}-${doisDigitos(d.getDate())}`
}
const formatarDias = (n) => `${Number(n).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} dias`
const formatarPecas = (n) => Number(n || 0).toLocaleString('pt-BR', { maximumFractionDigits: 0 })

watch(periodo, carregar)
watch(() => props.versao, carregar)
onMounted(carregar)
</script>

<style scoped>
@import './estilo-comercial.css';
@import '../../estilos/identidade-da-ferramenta.css';
</style>
