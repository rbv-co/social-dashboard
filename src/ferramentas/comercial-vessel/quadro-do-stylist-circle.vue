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
    <!-- ⚠️ AS COLUNAS SÃO AS ETAPAS DE FUNIL, NA ORDEM (configuráveis desde
         24/09/2026), e as saídas juntas no fim. `--colunas` só diz quantas. -->
    <div class="cv-quadro" :style="{ '--colunas': colunas.length }">
      <div v-for="c in colunas" :key="c.chave" class="cv-quadro-coluna"
           :class="[faseDa(c), { 'no-celular': etapaNoCelular === c.chave, recolhida: c.chave === 'saidas' && !saidasAbertas }]">
        <button v-if="c.chave === 'saidas'" type="button" class="cv-quadro-titulo cv-quadro-titulo-botao"
                @click="saidasAbertas = !saidasAbertas">{{ c.titulo }} · {{ c.stylists.length }}</button>
        <h3 v-else class="cv-quadro-titulo">{{ c.titulo }} · {{ c.stylists.length }}</h3>
        <p v-if="!c.stylists.length" class="cv-nota">Ninguém nesta etapa.</p>
        <article v-for="s in c.stylists" :key="s.codigo" class="cv-quadro-cartao"
                 :class="[c.chave === 'saidas' ? `id-tom-${seloDaEtapa(s).tom}` : '',
                          { atrasada: prazoAtrasado(s.proxima_acao_em, hoje) }]">
          <!-- ⚠️ 24/09: BLOCO PRÓPRIO, no topo do cartão (para o merge com as
               etapas configuráveis ser limpo): a faixa da nota — sempre com a palavra.
               Não muda a coluna de ninguém: a nota não trava etapa nenhuma. -->
          <p v-if="mostrarFaixa" class="cv-quadro-faixa">
            <span class="cv-selo id-selo" :class="`id-tom-${seloDaFaixa(s).tom}`">{{ seloDaFaixa(s).texto }}</span></p>
          <button type="button" class="cv-quadro-nome" @click="$emit('abrir', s.codigo)">{{ s.nome }}</button>
          <p class="cv-sub"><span class="cv-codigo">{{ s.codigo }}</span>
            <span v-if="s.cidade"> · {{ s.cidade }}</span><span v-if="s.loja"> · {{ LOJAS[s.loja] || s.loja }}</span></p>
          <p v-if="c.chave === 'saidas'" class="cv-sub">{{ s.etapa }}</p>
          <p v-if="s.proxima_acao" class="cv-quadro-acao">
            <b>{{ prazoAtrasado(s.proxima_acao_em, hoje) ? 'Atrasada:' : 'Próxima ação:' }}</b>
            {{ s.proxima_acao }}<span v-if="s.proxima_acao_em"> — até {{ dataLegivel(s.proxima_acao_em) }}</span></p>
          <p class="cv-sub">{{ ultimoContatoEscrito(s.ultimo_contato_em) }}</p>
          <div class="cv-acoes">
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
            <button v-if="podeEditar && c.chave === 'saidas' && primeiraEtapa(etapas)" type="button" class="btn id-btn-voltar"
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
 * ⚠️ DESDE 24/09/2026 AS COLUNAS VÊM DO BANCO (`vessel_stylist_etapas`). */
import { ref, computed, watch } from 'vue'
import { LOJAS, seloDaEtapa } from './t11-regras.js'
import { seloDaFaixa } from './qualificacao-regras.js'
import IconeDoBloco from '../../compartilhado/icone-do-bloco.vue'
import { dataLegivel } from './enderecos-publicos.js'
import {
  colunasDoQuadro, proximaEtapa, primeiraEtapa, prazoAtrasado, ultimoContatoEscrito,
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
defineEmits(['abrir', 'mover'])

const colunas = computed(() => colunasDoQuadro(props.stylists, props.etapas, props.hoje, props.ordem))
const faseDa = (c) => (c.chave === 'saidas' ? 'cv-fase-saidas' : 'cv-fase-funil')
// No celular abre na primeira etapa que tem gente (e segue a lista, se ela mudar).
const primeiraComGente = () => (colunas.value.find((c) => c.stylists.length) || colunas.value[0])?.chave || null
const etapaNoCelular = ref(primeiraComGente())
watch(() => colunas.value.map((c) => c.chave).join('|'), () => {
  if (!colunas.value.some((c) => c.chave === etapaNoCelular.value)) etapaNoCelular.value = primeiraComGente()
})
const saidasAbertas = ref(false)
</script>

<style scoped>
@import './estilo-comercial.css';
@import '../../estilos/identidade-da-ferramenta.css';
</style>
