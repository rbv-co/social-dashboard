<template>
  <!-- O CONTATO FÁCIL (pedido do dono, 24/09/2026): WhatsApp e/ou Instagram da
       parceira, abrindo numa aba nova, SEM mensagem pronta.
       ⚠️ TOCAR AQUI NÃO REGISTRA CONTATO: o registro continua manual, pelo
       "Registrar contato" da ficha.
       ⚠️ `@click.stop`: no cartão do quadro o toque não pode abrir a ficha junto. -->
  <span v-if="c.principal" class="cv-contato" :class="{ compacto }">
    <a :href="c.principal.href" target="_blank" rel="noopener noreferrer"
       class="btn cv-contato-btn" :class="classeDo(c.principal, true)"
       :aria-label="compacto ? c.principal.aria : null" :title="compacto ? c.principal.aria : null"
       @click.stop><icone-do-bloco :nome="c.principal.canal" /><span v-if="!compacto">{{ c.principal.rotulo }}</span></a>
    <a v-if="c.secundario" :href="c.secundario.href" target="_blank" rel="noopener noreferrer"
       class="btn cv-contato-btn cv-contato-secundario" :class="classeDo(c.secundario, false)"
       :aria-label="compacto ? c.secundario.aria : null" :title="compacto ? c.secundario.aria : null"
       @click.stop><icone-do-bloco :nome="c.secundario.canal" /><span v-if="!compacto">{{ c.secundario.rotulo }}</span></a>
  </span>
</template>

<script setup>
import { computed } from 'vue'
import { contatoFacil } from './crm-da-stylist-regras.js'
import IconeDoBloco from '../../compartilhado/icone-do-bloco.vue'

const props = defineProps({
  stylist: { type: Object, required: true },
  // No cartão do quadro: só o ícone (o nome do gesto vai no aria-label).
  compacto: { type: Boolean, default: false },
})
const c = computed(() => contatoFacil(props.stylist))
// WhatsApp é o principal, no verde de situação da casa; o Instagram, apoio.
const classeDo = (x, principal) => (x.canal === 'whatsapp'
  ? ['id-btn-principal', 'btn-principal', 'cv-contato-whatsapp']
  : [principal ? 'id-btn-editar' : 'id-btn-apoio', 'cv-contato-instagram'])
</script>

<style scoped>
@import './estilo-comercial.css';
@import '../../estilos/identidade-da-ferramenta.css';

.cv-contato { display: inline-flex; flex-wrap: wrap; gap: var(--sp-2); align-items: center; }
.cv-contato-btn { display: inline-flex; align-items: center; gap: 6px; min-height: 40px; text-decoration: none; }
/* o verde de situação da casa (token), no botão cheio do sentido "principal" */
.cv-contato-whatsapp { --tom-acao: var(--situacao-viva); }
.cv-contato-secundario { font-size: var(--texto-etiqueta); }
.cv-contato.compacto .cv-contato-btn { min-width: 40px; justify-content: center; padding-left: 8px; padding-right: 8px; }
</style>
