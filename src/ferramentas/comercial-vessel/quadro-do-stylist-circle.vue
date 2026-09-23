<template>
  <section class="cv-bloco">
    <h2 class="cv-etiqueta">O funil</h2>
    <!-- ⚠️ NO CELULAR, UMA ETAPA POR VEZ: as etapas viram botões que quebram
         em linhas — nunca colunas que rolam para o lado (PADRAO, item 6). -->
    <div class="cv-quadro-etapas" role="tablist" aria-label="Etapas do funil">
      <button v-for="k in COLUNAS" :key="k" type="button" role="tab"
              class="btn cv-quadro-etapa" :class="{ ativa: etapaNoCelular === k }"
              :aria-selected="etapaNoCelular === k" @click="etapaNoCelular = k">
        {{ rotuloDaColuna(k) }} · {{ colunas[k].length }}</button>
    </div>
    <div class="cv-quadro">
      <div v-for="k in COLUNAS" :key="k" class="cv-quadro-coluna"
           :class="{ 'no-celular': etapaNoCelular === k, recolhida: k === 'saidas' && !saidasAbertas }">
        <button v-if="k === 'saidas'" type="button" class="cv-quadro-titulo cv-quadro-titulo-botao"
                @click="saidasAbertas = !saidasAbertas">{{ rotuloDaColuna(k) }} · {{ colunas[k].length }}</button>
        <h3 v-else class="cv-quadro-titulo">{{ rotuloDaColuna(k) }} · {{ colunas[k].length }}</h3>
        <p v-if="!colunas[k].length" class="cv-nota">Ninguém nesta etapa.</p>
        <article v-for="s in colunas[k]" :key="s.codigo" class="cv-quadro-cartao"
                 :class="{ atrasada: prazoAtrasado(s.proxima_acao_em, hoje) }">
          <button type="button" class="cv-quadro-nome" @click="$emit('abrir', s.codigo)">{{ s.nome }}</button>
          <p class="cv-sub"><span class="cv-codigo">{{ s.codigo }}</span>
            <span v-if="s.cidade"> · {{ s.cidade }}</span><span v-if="s.loja"> · {{ LOJAS[s.loja] || s.loja }}</span></p>
          <p v-if="k === 'saidas'" class="cv-sub">{{ ESTAGIOS_DA_STYLIST[s.estagio] }}</p>
          <p v-if="s.proxima_acao" class="cv-quadro-acao">
            <b>{{ prazoAtrasado(s.proxima_acao_em, hoje) ? 'Atrasada:' : 'Próxima ação:' }}</b>
            {{ s.proxima_acao }}<span v-if="s.proxima_acao_em"> — até {{ dataLegivel(s.proxima_acao_em) }}</span></p>
          <p class="cv-sub">{{ ultimoContatoEscrito(s.ultimo_contato_em) }}</p>
          <div class="cv-acoes">
            <button v-if="podeEditar" type="button" class="btn" @click="$emit('abrir', s.codigo)">Registrar contato</button>
            <button v-if="podeEditar && proximaEtapaManual(s.estagio)" type="button" class="btn"
                    @click="$emit('mover', { codigo: s.codigo, estagio: proximaEtapaManual(s.estagio) })">
              Avançar para {{ ESTAGIOS_DA_STYLIST[proximaEtapaManual(s.estagio)] }}</button>
            <button v-if="podeEditar && k === 'saidas'" type="button" class="btn"
                    @click="$emit('mover', { codigo: s.codigo, estagio: reabrirPara(s.ativada_em) })">Reabrir</button>
          </div>
        </article>
      </div>
    </div>
  </section>
</template>

<script setup>
/* O QUADRO DO STYLIST CIRCLE — uma coluna por etapa (computador) ou uma etapa
 * por vez (celular). Não grava nada: emite `abrir` e `mover`, e a tela chama o
 * banco. As regras moram em `crm-da-stylist-regras.js`, testadas. */
import { ref, computed } from 'vue'
import { ESTAGIOS_DA_STYLIST, LOJAS } from './t11-regras.js'
import { dataLegivel } from './enderecos-publicos.js'
import {
  FLUXO_PRINCIPAL, colunasDoQuadro, proximaEtapaManual, reabrirPara, prazoAtrasado, ultimoContatoEscrito,
} from './crm-da-stylist-regras.js'

const props = defineProps({
  stylists: { type: Array, default: () => [] },
  podeEditar: { type: Boolean, default: false },
  hoje: { type: String, required: true },
})
defineEmits(['abrir', 'mover'])

const COLUNAS = [...FLUXO_PRINCIPAL, 'saidas']
const colunas = computed(() => colunasDoQuadro(props.stylists, props.hoje))
const rotuloDaColuna = (k) => (k === 'saidas' ? 'Saídas' : ESTAGIOS_DA_STYLIST[k])
// No celular abre na primeira etapa que tem gente.
const etapaNoCelular = ref(COLUNAS.find((k) => colunasDoQuadro(props.stylists, props.hoje)[k].length) || 'prospectado')
const saidasAbertas = ref(false)
</script>

<style scoped>
@import './estilo-comercial.css';
</style>
