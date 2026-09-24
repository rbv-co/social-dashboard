<template>
  <!-- ⚠️ NUNCA SÓ COR: embaixo do número vão a meta escrita ("meta: 70% ou
       mais") e a palavra ("dentro da meta"). Sem base, nada de cor. -->
  <span class="cv-numero-meta">
    <span class="cv-numero-base">{{ meta.meta }}</span>
    <span v-if="meta.tom" class="cv-selo id-selo cv-meta-selo" :class="`id-tom-${meta.tom}`">{{ meta.texto }}</span>
    <span v-else class="cv-numero-base cv-meta-sem-base">{{ meta.texto }}</span>
  </span>
</template>

<script setup>
/* A META DE UM NÚMERO do placar ou do scorecard — o desenho só; a régua mora
 * em `qualificacao-regras.js` (`metaDoComparecimento`,
 * `metaDeVendasPorEncontro`), testada. */
defineProps({ meta: { type: Object, required: true } })
</script>

<style scoped>
@import './estilo-comercial.css';
@import '../../estilos/identidade-da-ferramenta.css';
</style>
