<template>
  <section class="cv-bloco">
    <h2 class="cv-etiqueta id-titulo"><icone-do-bloco nome="funil" />O funil</h2>
    <!-- ⚠️ NO CELULAR, UMA ETAPA POR VEZ: as etapas viram botões que quebram
         em linhas — nunca colunas que rolam para o lado (PADRAO, item 6). -->
    <div class="cv-quadro-etapas" role="tablist" aria-label="Etapas do funil">
      <button v-for="c in colunas" :key="c.chave" type="button" role="tab"
              class="btn cv-quadro-etapa" :class="[faseDa(c), { ativa: etapaNoCelular === c.chave }]"
              :aria-selected="etapaNoCelular === c.chave" @click="etapaNoCelular = c.chave">
        {{ c.titulo }} · {{ c.stylists.length }}</button>
    </div>
    <p v-if="podeArrastar" class="cv-nota cv-quadro-dica">
      Arraste o cartão para outra coluna para mudar a etapa — inclusive para as
      saídas, no fim. Os botões de cada cartão fazem o mesmo pelo teclado.
    </p>
    <!-- ⚠️ AS COLUNAS SÃO AS ETAPAS DE FUNIL, NA ORDEM (configuráveis desde
         24/09/2026), e depois UMA POR SAÍDA — cada saída é um alvo próprio do
         arrastar. `--colunas` só diz quantas. -->
    <div class="cv-quadro" :class="{ 'cv-quadro-arrastando': arrastando }" :style="{ '--colunas': colunas.length }">
      <div v-for="c in colunas" :key="c.chave" class="cv-quadro-coluna"
           :class="[faseDa(c), { 'no-celular': etapaNoCelular === c.chave, 'cv-quadro-alvo': alvo === c.chave }]"
           :data-etapa="c.titulo"
           @dragover="sobre($event, c)" @dragenter="sobre($event, c)" @dragleave="sair($event, c)" @drop="soltar($event, c)">
        <h3 class="cv-quadro-titulo">{{ c.titulo }} · {{ c.stylists.length }}<span v-if="c.saida" class="cv-quadro-titulo-tipo"> (saída)</span></h3>
        <p v-if="!c.stylists.length" class="cv-nota">{{ alvo === c.chave ? 'Solte aqui.' : 'Ninguém nesta etapa.' }}</p>
        <article v-for="s in c.stylists" :key="s.codigo" class="cv-quadro-cartao"
                 :class="[c.saida ? `id-tom-${seloDaEtapa(s).tom}` : '',
                          { atrasada: prazoAtrasado(s.proxima_acao_em, hoje), 'cv-quadro-arrastavel': podeArrastar,
                            'cv-quadro-sendo-arrastado': arrastando?.codigo === s.codigo }]"
                 :draggable="podeArrastar && movendoCodigo !== s.codigo ? 'true' : 'false'"
                 :data-codigo="s.codigo"
                 @dragstart="comecar($event, s)" @dragend="terminar">
          <!-- ⚠️ 24/09: BLOCO PRÓPRIO, no topo do cartão (para o merge com as
               etapas configuráveis ser limpo): a faixa da nota — sempre com a palavra.
               Não muda a coluna de ninguém: a nota não trava etapa nenhuma. -->
          <p v-if="mostrarFaixa" class="cv-quadro-faixa">
            <span class="cv-selo id-selo" :class="`id-tom-${seloDaFaixa(s).tom}`">{{ seloDaFaixa(s).texto }}</span></p>
          <button type="button" class="cv-quadro-nome" @click="$emit('abrir', s.codigo)">{{ s.nome }}</button>
          <!-- ⚠️ 24/09/2026: "Sem contato ainda" — sem os botões de contato
               (o contato fácil some sozinho sem WhatsApp e sem Instagram). -->
          <p v-if="seloSemContato(s)" class="cv-quadro-faixa">
            <span class="cv-selo id-selo cv-selo-sem-contato" :class="`id-tom-${seloSemContato(s).tom}`">{{ seloSemContato(s).texto }}</span></p>
          <p class="cv-sub"><span class="cv-codigo">{{ s.codigo }}</span>
            <span v-if="s.cidade"> · {{ s.cidade }}</span><span v-if="s.loja"> · {{ LOJAS[s.loja] || s.loja }}</span></p>
          <!-- 24/09/2026: o motivo da saída, no cartão da coluna dela. -->
          <p v-if="c.saida && s.saida_motivo" class="cv-sub cv-quadro-motivo"><b>Motivo:</b> {{ s.saida_motivo }}</p>
          <p v-if="s.proxima_acao" class="cv-quadro-acao">
            <b>{{ prazoAtrasado(s.proxima_acao_em, hoje) ? 'Atrasada:' : 'Próxima ação:' }}</b>
            {{ s.proxima_acao }}<span v-if="s.proxima_acao_em"> — até {{ dataLegivel(s.proxima_acao_em) }}</span></p>
          <p class="cv-sub">{{ ultimoContatoEscrito(s.ultimo_contato_em) }}</p>
          <div class="cv-acoes">
            <!-- 24/09: o contato fácil, só o ícone; o toque não abre a ficha. -->
            <contato-facil :stylist="s" compacto />
            <button v-if="podeEditar" type="button" class="btn id-btn-editar" @click="$emit('abrir', s.codigo)">
              <icone-do-bloco nome="contato" />Registrar contato</button>
            <!-- ⚠️ TOQUE DUPLO: enquanto ESTA stylist está sendo movida, o
                 botão trava e avisa — a guarda de verdade mora na tela
                 (`movendoCodigo`), aqui é só o desenho do aviso. -->
            <button v-if="podeEditar && proximaEtapa(etapas, s.etapa_id)" type="button" class="btn id-btn-apoio"
                    :disabled="movendoCodigo === s.codigo"
                    @click="$emit('mover', { codigo: s.codigo, etapaId: proximaEtapa(etapas, s.etapa_id).id })">
              <icone-do-bloco nome="avancar" />{{ movendoCodigo === s.codigo ? 'Movendo…'
                : `Avançar para ${proximaEtapa(etapas, s.etapa_id).nome}` }}</button>
            <!-- Reabrir uma saída: volta para a primeira etapa do funil. -->
            <button v-if="podeEditar && c.saida && primeiraEtapa(etapas)" type="button" class="btn id-btn-voltar"
                    :disabled="movendoCodigo === s.codigo"
                    @click="$emit('mover', { codigo: s.codigo, etapaId: primeiraEtapa(etapas).id })">
              <icone-do-bloco nome="reabrir" />{{ movendoCodigo === s.codigo ? 'Movendo…' : 'Reabrir' }}</button>
          </div>
        </article>
      </div>
    </div>
  </section>
</template>

<script setup>
/* O QUADRO DO STYLIST CIRCLE — uma coluna por etapa de funil (computador) ou
 * uma etapa por vez (celular). Não grava nada: emite `abrir` e `mover`, e a
 * tela chama o banco. As regras moram em `crm-da-stylist-regras.js`, testadas.
 * ⚠️ DESDE 24/09/2026 AS COLUNAS VÊM DO BANCO (`vessel_stylist_etapas`).
 *
 * ⚠️ ARRASTAR E SOLTAR (24/09/2026, pedido do dono): SÓ COM MOUSE/TRACKPAD
 * (`pointer: fine`) e só para quem pode editar — a API nativa do navegador, sem
 * biblioteca. No toque não há arrastar: ficam os botões "Avançar para…" e o
 * "Ou mover para" da ficha (que também são o caminho do teclado). Soltar na
 * mesma coluna não faz nada. O quadro NÃO move o cartão sozinho: ele só emite
 * `mover`, igual ao botão, e a tela redesenha depois que o banco disse sim —
 * se a gravação falha, ou o motivo é cancelado, o cartão nunca saiu do lugar. */
import { ref, computed, watch } from 'vue'
import { LOJAS, seloDaEtapa } from './t11-regras.js'
import { seloDaFaixa } from './qualificacao-regras.js'
import { seloSemContato } from './stylist-circle-regras.js'
import IconeDoBloco from '../../compartilhado/icone-do-bloco.vue'
import ContatoFacil from './contato-facil.vue'
import { dataLegivel } from './enderecos-publicos.js'
import {
  colunasDoQuadro, proximaEtapa, primeiraEtapa, prazoAtrasado, ultimoContatoEscrito, destinoDoSoltar,
} from './crm-da-stylist-regras.js'

const props = defineProps({
  stylists: { type: Array, default: () => [] },
  etapas: { type: Array, default: () => [] },
  podeEditar: { type: Boolean, default: false },
  hoje: { type: String, required: true },
  // ⚠️ TOQUE DUPLO (rodada 1 de revisão): o código da stylist com uma
  // gravação em andamento. A guarda de verdade mora na tela — aqui só
  // desabilita o botão certo e troca o texto por "Movendo…".
  movendoCodigo: { type: String, default: null },
  // 24/09: o selo da faixa só aparece se a leitura das notas deu certo, e a
  // ordem "faixa" (a mesma da barra da lista) reordena DENTRO de cada coluna.
  mostrarFaixa: { type: Boolean, default: false },
  ordem: { type: String, default: null },
})
const emit = defineEmits(['abrir', 'mover'])

const colunas = computed(() => colunasDoQuadro(props.stylists, props.etapas, props.hoje, props.ordem))
const faseDa = (c) => (!c.saida ? 'cv-fase-funil' : c.etapa?.libera_private_edit ? 'cv-fase-saidas cv-fase-libera' : 'cv-fase-saidas')
// No celular abre na primeira etapa que tem gente (e segue a lista, se ela mudar).
const primeiraComGente = () => (colunas.value.find((c) => c.stylists.length) || colunas.value[0])?.chave || null
const etapaNoCelular = ref(primeiraComGente())
watch(() => colunas.value.map((c) => c.chave).join('|'), () => {
  if (!colunas.value.some((c) => c.chave === etapaNoCelular.value)) etapaNoCelular.value = primeiraComGente()
})

// ── arrastar ────────────────────────────────────────────────────────────────
const ponteiroFino = typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: fine)').matches
const podeArrastar = computed(() => props.podeEditar && ponteiroFino)
const arrastando = ref(null)   // { codigo, etapaId }
const alvo = ref(null)         // a chave da coluna sob o cartão

function comecar(ev, s) {
  if (!podeArrastar.value) { ev.preventDefault(); return }
  ev.dataTransfer.setData('text/plain', s.codigo)
  ev.dataTransfer.effectAllowed = 'move'
  arrastando.value = { codigo: s.codigo, etapaId: s.etapa_id }
}
function terminar() { arrastando.value = null; alvo.value = null }
function sobre(ev, c) {
  if (!arrastando.value) return
  // Na mesma coluna o navegador mostra "proibido": não há o que fazer ali.
  if (destinoDoSoltar(arrastando.value.etapaId, c) == null) { if (alvo.value === c.chave) alvo.value = null; return }
  ev.preventDefault()
  ev.dataTransfer.dropEffect = 'move'
  alvo.value = c.chave
}
function sair(ev, c) {
  if (alvo.value === c.chave && !ev.currentTarget.contains(ev.relatedTarget)) alvo.value = null
}
function soltar(ev, c) {
  ev.preventDefault()
  const a = arrastando.value
  terminar()
  if (!a) return
  const destino = destinoDoSoltar(a.etapaId, c)
  if (destino != null) emit('mover', { codigo: a.codigo, etapaId: destino })
}
</script>

<style scoped>
@import './estilo-comercial.css';
@import '../../estilos/identidade-da-ferramenta.css';
</style>
