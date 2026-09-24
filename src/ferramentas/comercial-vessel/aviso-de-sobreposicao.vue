<template>
  <div class="cv-modal-fundo" v-trava-rolagem @click.self="cancelar">
    <div class="cv-modal ag-aviso-modal" role="alertdialog" aria-labelledby="sobrepoe-titulo" aria-describedby="sobrepoe-texto">
      <div class="cv-modal-topo ag-aviso-topo">
        <h2 id="sobrepoe-titulo" class="cv-modal-titulo"><icone-do-bloco nome="alerta" />Horário já ocupado</h2>
        <button type="button" class="btn cv-modal-fechar" aria-label="Voltar sem gravar" @click="cancelar">✕</button>
      </div>
      <div class="cv-modal-corpo">
        <p id="sobrepoe-texto" class="ag-aviso-frase">
          {{ encontro ? `O encontro de ${encontro}` : 'Este encontro' }} cruza com
          {{ lista.length === 1 ? 'outro Private Edit' : `${lista.length} Private Edits` }} no mesmo lugar
          (cada um ocupa {{ DURACAO_DO_PRIVATE_EDIT_EM_HORAS }} horas a partir do início):
        </p>
        <ul class="ag-aviso-lista">
          <li v-for="o in lista" :key="o.codigo" class="ag-aviso-conflito">{{ linhaDoConflito(o) }}</li>
        </ul>
        <template v-if="contexto.length">
          <h3 class="cv-etiqueta cv-etiqueta-interna id-subtitulo">Também na loja nesse horário (não é conflito)</h3>
          <ul class="ag-aviso-lista ag-aviso-contexto">
            <li v-for="(c, n) in contexto" :key="n" :class="c.tipo === 'beauty_session' ? 'ag-bs' : 'ag-pa'">{{ linhaDoContexto(c) }}</li>
          </ul>
        </template>
        <p class="ag-aviso-pergunta">{{ modo === 'editar' ? 'Salvar mesmo assim?' : 'Marcar mesmo assim?' }}</p>
        <p v-if="erro" class="cv-nota cv-nota-erro">{{ erro }}</p>
      </div>
      <div class="cv-modal-pe">
        <div class="cv-acoes">
          <button type="button" class="btn id-btn-apoio" :disabled="gravando" @click="cancelar">
            <icone-do-bloco nome="voltar-seta" />Voltar e mudar o horário</button>
          <button type="button" class="btn btn-principal id-btn-principal" :disabled="gravando" @click="confirmar">
            <icone-do-bloco nome="salvar" />{{ gravando ? 'Gravando…' : (modo === 'editar' ? 'Salvar mesmo assim' : 'Marcar mesmo assim') }}</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
/* O AVISO DE ENCONTRO SOBREPOSTO (decisão do dono: AVISA E DEIXA CONFIRMAR).
 *
 * Abre quando a pergunta `vessel_private_edit_sobreposicoes` (ou a recusa
 * `sobrepoe` do banco, na corrida) diz que já há Private Edit no mesmo lugar
 * em horário que se cruza. Mostra com quem (código, anfitriã, loja, horário) e,
 * à parte, o que mais ocupa a loja — Beauty Session e Private Appointment são
 * NOTA, não conflito. Confirmar reenvia com `p_confirmar_sobreposicao: true`;
 * voltar não grava nada. Quem grava é a tela, pela porta de sempre.
 * Pendurado DENTRO da tela (um `v-if`), nunca no `body` (PADRAO, item 4). */
import { onMounted, onBeforeUnmount } from 'vue'
import IconeDoBloco from '../../compartilhado/icone-do-bloco.vue'
import { DURACAO_DO_PRIVATE_EDIT_EM_HORAS, linhaDoConflito, linhaDoContexto } from './agenda-regras.js'

const props = defineProps({
  lista: { type: Array, required: true },
  contexto: { type: Array, default: () => [] },
  modo: { type: String, default: 'criar' },       // 'criar' | 'editar'
  encontro: { type: String, default: '' },        // o código, ao editar
  gravando: { type: Boolean, default: false },
  erro: { type: String, default: '' },
})
const emit = defineEmits(['confirmar', 'cancelar'])

function confirmar() { if (!props.gravando) emit('confirmar') }
function cancelar() { if (!props.gravando) emit('cancelar') }
const noTeclado = (e) => { if (e.key === 'Escape') cancelar() }
onMounted(() => window.addEventListener('keydown', noTeclado))
onBeforeUnmount(() => window.removeEventListener('keydown', noTeclado))
</script>

<style scoped>
@import './estilo-comercial.css';
@import '../../estilos/identidade-da-ferramenta.css';

.ag-bs { --tom-item: var(--cor-beauty-sessions); }
.ag-pa { --tom-item: var(--cor-private-appointment); }
/* o topo na cor da situação "faltou" (o vermelho da casa), o texto é --text */
.ag-aviso-topo {
  background: color-mix(in srgb, var(--situacao-faltou) 8%, var(--surface));
  border-bottom: 3px solid var(--situacao-faltou);
}
.ag-aviso-topo .cv-modal-titulo { display: flex; align-items: center; gap: var(--sp-2); }
.ag-aviso-topo .id-icone { color: var(--situacao-faltou); width: 20px; height: 20px; flex-basis: 20px; }
.ag-aviso-frase, .ag-aviso-pergunta {
  font-family: var(--fonte-principal); font-size: var(--texto-campo); color: var(--text); margin: 0; line-height: 1.45;
}
.ag-aviso-pergunta { margin-top: var(--sp-4); font-weight: 600; }
.ag-aviso-lista { list-style: none; margin: var(--sp-3) 0 0; padding: 0; display: flex; flex-direction: column; gap: var(--sp-2); }
.ag-aviso-lista li {
  font-family: var(--fonte-principal); font-size: var(--texto-corpo); color: var(--text); line-height: 1.45;
  padding: var(--sp-2) var(--sp-3); border-radius: var(--radius-sm); overflow-wrap: anywhere;
}
.ag-aviso-conflito {
  background: color-mix(in srgb, var(--situacao-faltou) 8%, var(--surface));
  border-left: 3px solid var(--situacao-faltou);
  font-weight: 600;
}
.ag-aviso-contexto li {
  background: color-mix(in srgb, var(--tom-item) 6%, var(--surface));
  border-left: 3px solid color-mix(in srgb, var(--tom-item) 55%, var(--surface));
}
.cv-modal-pe .cv-acoes { width: 100%; justify-content: flex-end; }
.cv-modal-pe .btn { display: inline-flex; align-items: center; gap: var(--sp-2); }
@media (max-width: 640px) {
  .cv-modal-pe .btn { flex: 1 1 100%; justify-content: center; }
}
</style>
