<template>
  <div class="cv-barra pe-barra">
    <label class="cv-barra-campo" :for="idPraca"><span>Praça</span>
      <select :id="idPraca" :value="praca ?? ''" @change="mudarPraca($event.target.value)">
        <option value="">Todas as praças</option>
        <option v-for="p in pracas" :key="p.id" :value="String(p.id)">{{ rotuloDaPraca(p) }}</option>
      </select></label>

    <label class="cv-barra-campo" :for="idEdicao"><span>Edição</span>
      <select :id="idEdicao" :value="edicao ?? ''" :disabled="!praca" @change="mudarEdicao($event.target.value)">
        <option value="">{{ praca ? 'Todas as edições desta praça' : 'Escolha uma praça primeiro' }}</option>
        <option v-for="e in edicoes" :key="e.id" :value="String(e.id)">
          {{ rotuloCurtoDaEdicao(e) }} — {{ SITUACOES_DA_EDICAO[e.situacao] || e.situacao }}</option>
      </select></label>

    <!-- ⚠️ SÓ APARECE QUANDO HÁ O QUE DIZER (PADRAO, item 9): sem ninguém sem
         praça, este bloco nem entra no DOM — um aviso sempre visível vira
         paisagem e ninguém mais lê. Abre a tela de Praças, para resolver. -->
    <button v-if="semPraca > 0" type="button" class="selo selo-atencao pe-aviso" @click="irParaPracas">
      {{ semPraca === 1 ? '1 stylist sem praça' : `${semPraca} stylists sem praça` }}
    </button>
  </div>
</template>

<script setup>
/* A BARRA "PRAÇA · EDIÇÃO" do Stylist Circle (25/09/2026, Task 7) — recorta o
 * placar, o quadro e a lista de baixo. Reusada, depois, pela tela do Private
 * Edit (Task 8): por isso ela só recebe listas prontas e emite a escolha —
 * quem busca no banco é sempre a tela que a usa.
 *
 * ⚠️ TROCAR DE PRAÇA LIMPA A EDIÇÃO: a lista de edições que a tela passa
 * (`edicoes`) é da praça ANTERIOR até o pai recarregar — manter a edição
 * escolhida apontaria para uma edição de outra praça, ou para um id que nem
 * está mais entre as opções.
 *
 * ⚠️ O AVISO DE PENDÊNCIA MORA AQUI (e não em cada tela) por ser sobre a
 * PRAÇA, o mesmo assunto da barra — e as duas telas que a usam têm a mesma
 * pendência para mostrar. `semPraca` é a CONTAGEM (a tela calcula com
 * `pendenciasDePraca`, praca-regras.js); esta barra só decide se mostra.
 */
import { useId } from 'vue'
import { useRouter } from 'vue-router'
import { rotuloDaPraca } from './praca-regras.js'
import { rotuloCurtoDaEdicao, SITUACOES_DA_EDICAO } from './edicao-regras.js'

// ⚠️ RODADA 1 DE CONSERTO (IMPORTANTE 3): id FIXO ("pe-praca"/"pe-edicao") num
// componente REUSADO por duas telas é o defeito — a tela do Private Edit já
// tinha o seu PRÓPRIO campo "Praça" com esse mesmo id, e dois elementos com o
// mesmo id na mesma página é HTML inválido: o `<label for="pe-praca">` desta
// barra passava a apontar para o select ERRADO (o de fora), não o de dentro
// dela. `useId()` (Vue 3.5) gera um id único por instância do componente —
// nunca colide, nem entre esta barra e ela mesma se um dia aparecer duas
// vezes na mesma tela.
const idPraca = useId()
const idEdicao = useId()

const props = defineProps({
  praca: { type: [Number, String], default: null },
  edicao: { type: [Number, String], default: null },
  pracas: { type: Array, default: () => [] },
  edicoes: { type: Array, default: () => [] },
  // Quantas stylists estão sem praça — 0 (ou omitido) some com o aviso.
  semPraca: { type: Number, default: 0 },
})
const emit = defineEmits(['update:praca', 'update:edicao'])

const router = useRouter()
function irParaPracas() { router.push({ name: 'pracas' }) }

function mudarPraca(valor) {
  const id = valor ? Number(valor) : null
  emit('update:praca', id)
  // A edição só faz sentido dentro da praça escolhida — nunca sobrevive à troca.
  emit('update:edicao', null)
}
function mudarEdicao(valor) {
  emit('update:edicao', valor ? Number(valor) : null)
}
</script>

<style scoped>
@import './estilo-comercial.css';
@import '../../estilos/identidade-da-ferramenta.css';

/* ⚠️ O `.selo` de aviso vira BOTÃO aqui (abre Praças): reseta a base de botão
   nativo, mas mantém a proporção de cor do `.selo` global (PADRAO, item 2). */
.pe-aviso {
  border: 0; cursor: pointer; font-family: var(--fonte-principal);
  align-self: flex-end; min-height: 40px;
}
</style>
