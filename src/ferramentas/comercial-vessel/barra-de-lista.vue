<template>
  <div class="cv-barra">
    <label v-if="mostrar.includes('busca')" class="cv-barra-campo">
      <span class="cv-etiqueta id-subtitulo">Buscar</span>
      <input type="search" :value="modelValue.busca" :placeholder="placeholderBusca"
             @input="mudar('busca', $event.target.value)" />
    </label>

    <label v-if="mostrar.includes('periodo')" class="cv-barra-campo">
      <span class="cv-etiqueta id-subtitulo">Período</span>
      <select :value="String(modelValue.dias)" @change="mudarPeriodo($event.target.value)">
        <option v-for="p in PERIODOS" :key="String(p.dias)" :value="String(p.dias)">{{ p.rotulo }}</option>
      </select>
    </label>

    <label v-if="mostrar.includes('situacao')" class="cv-barra-campo">
      <span class="cv-etiqueta id-subtitulo">Situação</span>
      <select :value="modelValue.situacao" @change="mudar('situacao', $event.target.value)">
        <option v-for="s in situacoes" :key="s.valor" :value="s.valor">{{ s.rotulo }}</option>
      </select>
    </label>

    <label v-if="mostrar.includes('loja')" class="cv-barra-campo">
      <span class="cv-etiqueta id-subtitulo">Loja</span>
      <select :value="modelValue.loja" @change="mudar('loja', $event.target.value)">
        <option value="">Todas</option>
        <option v-for="(rotulo, chave) in lojas" :key="chave" :value="chave">{{ rotulo }}</option>
      </select>
    </label>

    <label v-if="mostrar.includes('estagio')" class="cv-barra-campo">
      <span class="cv-etiqueta id-subtitulo">Estágio</span>
      <select :value="modelValue.estagio" @change="mudar('estagio', $event.target.value)">
        <option value="">Todos</option>
        <option v-for="(rotulo, chave) in estagios" :key="chave" :value="chave">{{ rotulo }}</option>
      </select>
    </label>

    <label v-if="mostrar.includes('ordem')" class="cv-barra-campo">
      <span class="cv-etiqueta id-subtitulo">Ordem</span>
      <select :value="modelValue.ordem" @change="mudar('ordem', $event.target.value)">
        <option v-for="o in ordens" :key="o.valor" :value="o.valor">{{ o.rotulo }}</option>
      </select>
    </label>
  </div>
</template>

<script setup>
/* A BARRA DE LISTA do Comercial Vessel — uma só, usada pelas três telas.
 *
 * ⚠️ MONTA SÓ O QUE FAZ SENTIDO EM CADA TELA, pela prop `mostrar`: não existe
 * filtro de loja numa lista de parceiras, nem período numa lista de gente.
 *
 * ⚠️ "Período" AQUI RECORTA A LISTA (ver `filtros.js`) — não é o `p_dias` das
 * funções de conta do banco, que só marca a janela de atribuição de venda.
 * Quando a pessoa escolhe "Só arquivadas" ou "Todas, inclusive arquivadas",
 * a tela que usa esta barra precisa voltar ao banco com
 * `p_incluir_arquivadas: true` — a lista que chegou sem elas não passa a tê-las
 * só porque o filtro mudou (ver `precisaDoBanco` em `filtros.js`).
 */
import { PERIODOS } from './filtros.js'

const props = defineProps({
  modelValue: { type: Object, required: true },
  mostrar: { type: Array, default: () => ['busca', 'situacao', 'ordem'] },
  lojas: { type: Object, default: () => ({}) },
  estagios: { type: Object, default: () => ({}) },
  placeholderBusca: { type: String, default: 'nome ou código' },
  situacoes: { type: Array, default: () => ([
    { valor: 'abertas_e_encerradas', rotulo: 'Abertas e encerradas' },
    { valor: 'abertas', rotulo: 'Só abertas' },
    { valor: 'encerradas', rotulo: 'Só encerradas' },
    { valor: 'arquivadas', rotulo: 'Só arquivadas' },
    { valor: 'todas', rotulo: 'Todas, inclusive arquivadas' },
  ]) },
  ordens: { type: Array, default: () => ([
    { valor: 'data-nova', rotulo: 'Mais nova primeiro' },
    { valor: 'data-antiga', rotulo: 'Mais antiga primeiro' },
  ]) },
})
const emit = defineEmits(['update:modelValue'])

function mudar(campo, valor) {
  emit('update:modelValue', { ...props.modelValue, [campo]: valor })
}
function mudarPeriodo(valor) {
  // "null" vem como texto do <select>; o filtro espera número ou nulo.
  mudar('dias', valor === 'null' ? null : Number(valor))
}
</script>

<style scoped>
@import './estilo-comercial.css';
@import '../../estilos/identidade-da-ferramenta.css';
</style>
