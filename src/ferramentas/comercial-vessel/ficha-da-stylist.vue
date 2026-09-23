<template>
  <div class="cv-modal-fundo" v-trava-rolagem @click.self="$emit('fechar')">
    <div class="cv-modal" role="dialog" :aria-label="`Ficha de ${stylist.nome}`">
      <div class="cv-modal-topo">
        <h2 class="cv-modal-titulo">{{ stylist.nome }}</h2>
        <button type="button" class="btn cv-modal-fechar" aria-label="Fechar" @click="$emit('fechar')">✕</button>
      </div>
      <div class="cv-modal-corpo">
        <p class="cv-sub"><span class="cv-codigo">{{ stylist.codigo }}</span> · {{ ESTAGIOS_DA_STYLIST[stylist.estagio] }}
          <span v-if="stylist.cidade"> · {{ stylist.cidade }}</span></p>
        <p class="cv-sub">{{ telefoneLegivel(stylist.whatsapp) }}<span v-if="stylist.instagram"> · {{ stylist.instagram }}</span></p>
        <p v-if="stylist.proxima_acao" class="cv-nota cv-nota-aviso"><b>Próxima ação:</b> {{ stylist.proxima_acao }}
          <span v-if="stylist.proxima_acao_em"> — até {{ dataLegivel(stylist.proxima_acao_em) }}</span></p>
        <div class="cv-acoes">
          <button v-if="podeEditar" type="button" class="btn" @click="$emit('corrigir', stylist.codigo)">Corrigir dados…</button>
        </div>

        <div v-if="podeEditar" class="cv-caixa-form">
          <h3 class="cv-etiqueta cv-etiqueta-interna"><icone-do-bloco nome="contato" />Registrar contato</h3>
          <p class="cv-sub">Canal</p>
          <div class="cv-escolha">
            <button v-for="(rotulo, k) in CANAIS" :key="k" type="button" class="btn"
                    :class="{ ativa: novo.canal === k }" @click="novo.canal = k">{{ rotulo }}</button>
          </div>
          <p class="cv-sub">Resultado</p>
          <div class="cv-escolha">
            <button v-for="(rotulo, k) in RESULTADOS" :key="k" type="button" class="btn"
                    :class="{ ativa: novo.resultado === k }" @click="novo.resultado = k">{{ rotulo }}</button>
          </div>
          <div class="cv-form">
            <label class="cv-campo cv-campo-largo" for="ficha-nota"><span>Nota (opcional)</span>
              <input id="ficha-nota" type="text" maxlength="500" v-model="novo.nota"></label>
            <label class="cv-campo cv-campo-largo" for="ficha-proxima"><span>Nova próxima ação (opcional)</span>
              <input id="ficha-proxima" type="text" maxlength="120" v-model="novo.proximaAcao"></label>
            <label class="cv-campo" for="ficha-proxima-em"><span>Até quando</span>
              <input id="ficha-proxima-em" type="date" v-model="novo.proximaAcaoEm"></label>
          </div>
          <p v-if="erro" class="cv-nota cv-nota-erro">{{ erro }}</p>
          <div class="cv-acoes">
            <button type="button" class="btn btn-principal" :disabled="!novo.canal || !novo.resultado || gravando"
                    @click="registrar">{{ gravando ? 'Registrando…' : 'Registrar contato' }}</button>
          </div>
          <!-- ⚠️ A SUGESTÃO SÓ GRAVA COM O TOQUE: nada muda de etapa sozinho. -->
          <div v-if="sugestao" class="cv-nota cv-nota-ok">
            Contato registrado. Mover {{ primeiroNome }} para <b>{{ ESTAGIOS_DA_STYLIST[sugestao] }}</b>?
            <div class="cv-acoes">
              <button type="button" class="btn" @click="sugestao = null">Deixar como está</button>
              <button type="button" class="btn btn-principal" :disabled="movendo" @click="aceitarSugestao">
                Mover para {{ ESTAGIOS_DA_STYLIST[sugestao] }}</button>
            </div>
          </div>
        </div>

        <h3 class="cv-etiqueta cv-etiqueta-interna">Histórico</h3>
        <p v-if="erroDoHistorico" class="cv-nota cv-nota-erro">{{ erroDoHistorico }}</p>
        <p v-else-if="carregando" class="cv-carregando">Carregando…</p>
        <p v-else-if="!historico.length" class="cv-vazio">Nenhum contato registrado ainda.</p>
        <ul v-else class="cv-historico">
          <li v-for="h in historico" :key="h.id">
            <p class="cv-sub"><b>{{ RESULTADOS[h.resultado] }}</b> · {{ CANAIS[h.canal] }}</p>
            <p v-if="h.nota" class="cv-nota cv-nota-primeira">{{ h.nota }}</p>
            <p class="cv-sub">{{ dataHoraLegivel(h.criado_em) }}<span v-if="h.criado_por_nome"> · {{ h.criado_por_nome }}</span></p>
          </li>
        </ul>
      </div>
    </div>
  </div>
</template>

<script setup>
/* A FICHA DA STYLIST — registrar contato e ver o histórico.
 * ⚠️ Pendurada DENTRO da tela (o `v-if` do pai), nunca no `body`: o CSS é
 * `scoped` e um modal fora da raiz despenca sem estilo (PADRAO, item 4). */
import { ref, reactive, computed, onMounted } from 'vue'
import { ESTAGIOS_DA_STYLIST, telefoneLegivel } from './t11-regras.js'
import { dataLegivel, dataHoraLegivel } from './enderecos-publicos.js'
import { CANAIS, RESULTADOS } from './crm-da-stylist-regras.js'
import { mensagemDeEditar } from './stylist-circle-regras.js'
import IconeDoBloco from './icone-do-bloco.vue'

const props = defineProps({
  stylist: { type: Object, required: true },
  podeEditar: { type: Boolean, default: false },
  chamar: { type: Function, required: true },
})
const emit = defineEmits(['fechar', 'mudou', 'corrigir'])

const primeiroNome = computed(() => String(props.stylist.nome || '').split(' ')[0])
const historico = ref([])
const carregando = ref(true)
const erroDoHistorico = ref('')
const novo = reactive({ canal: '', resultado: '', nota: '', proximaAcao: '', proximaAcaoEm: '' })
const gravando = ref(false)
const erro = ref('')
const sugestao = ref(null)
const movendo = ref(false)

const MENSAGENS = {
  sem_permissao: 'Você não tem a permissão de Atendimentos para registrar contato.',
  nao_achei: 'Não achei mais esta parceira. Recarregue a página.',
  canal_invalido: 'Escolha o canal.', resultado_invalido: 'Escolha o resultado.',
  nota_longa: 'A nota passou de 500 caracteres.',
}

async function carregarHistorico() {
  carregando.value = true
  erroDoHistorico.value = ''
  try { historico.value = await props.chamar('vessel_stylist_contatos', { p_codigo: props.stylist.codigo }) || [] }
  catch { erroDoHistorico.value = 'Não consegui ler o histórico agora. Tente de novo em um instante.' }
  finally { carregando.value = false }
}

async function registrar() {
  gravando.value = true
  erro.value = ''
  sugestao.value = null
  try {
    const r = await props.chamar('vessel_stylist_registrar_contato', {
      p_codigo: props.stylist.codigo, p_canal: novo.canal, p_resultado: novo.resultado,
      p_nota: novo.nota || null, p_proxima_acao: novo.proximaAcao || null, p_proxima_acao_em: novo.proximaAcaoEm || null,
    })
    if (!r?.ok) { erro.value = MENSAGENS[r?.situacao] || 'Não consegui registrar agora. Tente de novo em um instante.'; return }
    Object.assign(novo, { canal: '', resultado: '', nota: '', proximaAcao: '', proximaAcaoEm: '' })
    sugestao.value = r.sugestao || null
    await carregarHistorico()
    emit('mudou')
  } catch { erro.value = 'Não consegui falar com o banco agora. Tente de novo em um instante.' }
  finally { gravando.value = false }
}

async function aceitarSugestao() {
  movendo.value = true
  try {
    const r = await props.chamar('vessel_stylist_editar', { p_codigo: props.stylist.codigo, p_estagio: sugestao.value })
    // ⚠️ RODADA 1 DE REVISÃO: frase ESPECÍFICA da recusa (ex.: "ela já tem
    // encontro marcado"), não o genérico "não consegui" — é a mesma função
    // do banco que o "Corrigir" usa, e a Ionara precisa saber POR QUE.
    if (!r?.ok) { erro.value = mensagemDeEditar(r?.situacao || 'erro_de_rede'); return }
    sugestao.value = null
    emit('mudou')
  } catch { erro.value = mensagemDeEditar('erro_de_rede') }
  finally { movendo.value = false }
}

onMounted(carregarHistorico)
</script>

<style scoped>
@import './estilo-comercial.css';
</style>
