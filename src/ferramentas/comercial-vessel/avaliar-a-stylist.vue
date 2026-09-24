<template>
  <div class="cv-modal-fundo" v-trava-rolagem @click.self="$emit('fechar')">
    <div class="cv-modal cv-modal-avaliar" role="dialog" :aria-label="`Avaliar ${nome}`">
      <div class="cv-modal-topo">
        <h2 class="cv-modal-titulo">Avaliar {{ nome }}</h2>
        <button type="button" class="btn cv-modal-fechar" aria-label="Fechar" @click="$emit('fechar')">✕</button>
      </div>
      <div class="cv-modal-corpo">
        <!-- ⚠️ A PROIBIÇÃO DO DOCUMENTO FICA EM CIMA DOS BOTÕES, não num rodapé. -->
        <p class="cv-nota cv-nota-primeira cv-avaliar-aviso">{{ AVISO_DE_PONTUACAO }}</p>

        <fieldset v-for="c in CRITERIOS" :key="c.chave" class="cv-criterio">
          <legend class="cv-criterio-titulo">{{ c.rotulo }}</legend>
          <p class="cv-sub">peso {{ c.peso }} · <b>{{ pontos(c) === null ? '—' : pontos(c) }}</b> de {{ c.peso }} pontos</p>

          <!-- ⚠️ SUGESTÃO NUNCA MUDA NADA SOZINHA: o toque é que aplica. -->
          <div v-if="sugestoes[c.chave]" class="cv-sugestao">
            <p class="cv-nota cv-nota-primeira">
              <b>Sugestão: nível {{ sugestoes[c.chave].nivel }}</b> — porque {{ sugestoes[c.chave].porque }}.</p>
            <div class="cv-acoes">
              <button type="button" class="btn" :disabled="niveis[c.chave] === sugestoes[c.chave].nivel"
                      @click="niveis[c.chave] = sugestoes[c.chave].nivel">
                <icone-do-bloco nome="aplicar" />
                {{ niveis[c.chave] === sugestoes[c.chave].nivel ? 'Sugestão aplicada' : `Usar nível ${sugestoes[c.chave].nivel}` }}</button>
            </div>
          </div>

          <div class="cv-escolha cv-niveis" role="radiogroup" :aria-label="c.rotulo">
            <button v-for="n in NIVEIS" :key="n" type="button" role="radio" class="btn cv-nivel"
                    :class="{ ativa: niveis[c.chave] === n }" :aria-checked="niveis[c.chave] === n"
                    @click="niveis[c.chave] = n">
              <span class="cv-nivel-numero">{{ n }}</span>
              <span class="cv-nivel-ancora">{{ c.ancoras[n] }}</span>
            </button>
          </div>
        </fieldset>

        <label class="cv-campo cv-campo-largo" for="avaliar-observacao"><span>Observação (opcional)</span>
          <textarea id="avaliar-observacao" :maxlength="OBSERVACAO_MAXIMA" rows="3" v-model="observacao"></textarea>
          <span class="cv-numero-base">{{ observacao.length }} de {{ OBSERVACAO_MAXIMA }} caracteres</span></label>
        <p v-if="erro" class="cv-nota cv-nota-erro">{{ erro }}</p>
      </div>

      <!-- ⚠️ A NOTA AO VIVO MORA NO PÉ, QUE NÃO ROLA: quem mexe no quinto
           critério continua vendo a soma. -->
      <div class="cv-modal-pe">
        <p class="cv-avaliar-nota" aria-live="polite">
          <span v-if="nota !== null" class="cv-selo id-selo cv-avaliar-selo" :class="`id-tom-${seloDaFaixa({ faixa: faixaDaNota(nota) }).tom}`">
            {{ notaEscrita(niveis) }}</span>
          <span v-else class="cv-sub">{{ notaEscrita(niveis) }}</span>
        </p>
        <div class="cv-acoes">
          <button type="button" class="btn" :disabled="gravando" @click="$emit('fechar')">Cancelar</button>
          <button type="button" class="btn btn-principal" :disabled="nota === null || gravando" @click="salvar">
            <icone-do-bloco nome="salvar" />{{ gravando ? 'Salvando…' : 'Salvar avaliação' }}</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
/* A JANELA DE AVALIAR — cinco critérios, cinco níveis cada, a nota ao vivo.
 *
 * ⚠️ QUEM AVALIA É GENTE. As sugestões (`sugestoesDaAvaliacao`, com o
 * scorecard DESDE O INÍCIO) aparecem em três critérios e só se aplicam com o
 * toque. A nota ao vivo é a conta de `qualificacao-regras.js`; a que fica
 * gravada é a do banco (colunas geradas), e as duas são a mesma fórmula — o
 * teste lê a migration.
 *
 * ⚠️ Pendurada DENTRO da ficha, que está dentro da tela: o CSS é `scoped`, e
 * modal no `body` despenca sem estilo (PADRAO, item 4). Montada por `v-if`,
 * trava a página atrás com `v-trava-rolagem` — o contador aguenta ela aberta
 * por cima da ficha. */
import { ref, reactive, computed } from 'vue'
import IconeDoBloco from '../../compartilhado/icone-do-bloco.vue'
import {
  CRITERIOS, NIVEIS, OBSERVACAO_MAXIMA, AVISO_DE_PONTUACAO, pontosDoCriterio, notaDaAvaliacao, notaEscrita,
  faixaDaNota, seloDaFaixa, mensagemDeAvaliar,
} from './qualificacao-regras.js'

const props = defineProps({
  codigo: { type: String, required: true },
  nome: { type: String, required: true },
  chamar: { type: Function, required: true },
  // Os níveis de onde começar (a última avaliação) — ou todos nulos.
  inicial: { type: Object, default: () => ({}) },
  sugestoes: { type: Object, default: () => ({}) },
})
const emit = defineEmits(['fechar', 'salvo'])

const niveis = reactive(Object.fromEntries(CRITERIOS.map((c) => [c.chave, props.inicial?.[c.chave] ?? null])))
const observacao = ref('')
const gravando = ref(false)
const erro = ref('')
const nota = computed(() => notaDaAvaliacao(niveis))
const pontos = (c) => pontosDoCriterio(c.peso, niveis[c.chave])

async function salvar() {
  if (nota.value === null || gravando.value) return
  gravando.value = true
  erro.value = ''
  try {
    const r = await props.chamar('vessel_stylist_avaliar', {
      p_codigo: props.codigo,
      p_carteira: niveis.carteira, p_portfolio: niveis.portfolio, p_mobilizacao: niveis.mobilizacao,
      p_acesso: niveis.acesso, p_confiabilidade: niveis.confiabilidade,
      p_observacao: observacao.value.trim() || null,
    })
    if (!r?.ok) { erro.value = mensagemDeAvaliar(r?.situacao); return }
    emit('salvo', r)
  } catch {
    erro.value = mensagemDeAvaliar('erro_de_rede')
  } finally {
    gravando.value = false
  }
}
</script>

<style scoped>
@import './estilo-comercial.css';
@import '../../estilos/identidade-da-ferramenta.css';
</style>
