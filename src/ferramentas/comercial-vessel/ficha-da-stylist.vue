<template>
  <div class="cv-modal-fundo" v-trava-rolagem @click.self="$emit('fechar')">
    <div class="cv-modal" role="dialog" :aria-label="`Ficha de ${stylist.nome}`">
      <div class="cv-modal-topo">
        <h2 class="cv-modal-titulo">{{ stylist.nome }}</h2>
        <button type="button" class="btn cv-modal-fechar" aria-label="Fechar" @click="$emit('fechar')">✕</button>
      </div>
      <div class="cv-modal-corpo">
        <p class="cv-sub"><span class="cv-codigo">{{ stylist.codigo }}</span> · {{ stylist.etapa || 'Sem etapa' }}
          <span v-if="stylist.cidade"> · {{ stylist.cidade }}</span></p>
        <!-- ⚠️ WHATSAPP OU INSTAGRAM (24/09/2026): pode faltar um dos dois. -->
        <p class="cv-sub">{{ [telefoneLegivel(stylist.whatsapp) || 'sem WhatsApp', stylist.instagram].filter(Boolean).join(' · ') }}</p>
        <p v-if="stylist.observacoes" class="cv-nota cv-observacoes"><b>Observações:</b> {{ stylist.observacoes }}</p>

        <!-- ── 24/09: A ETAPA (funil configurável) — bloco próprio, para o
             merge com o scorecard ser limpo. "Avançar" vai para a próxima
             etapa de funil pela ordem; o seletor vai para QUALQUER uma. Nada
             muda de etapa sozinho. -->
        <div v-if="podeEditar" class="id-caixa-form cv-ficha-etapa">
          <h3 class="cv-etiqueta cv-etiqueta-interna id-titulo"><icone-do-bloco nome="funil" />Etapa</h3>
          <p class="cv-sub">Agora: <b>{{ stylist.etapa || 'Sem etapa' }}</b>
            <span v-if="stylist.prospectado_em"> · prospectada em {{ dataLegivel(stylist.prospectado_em) }}</span></p>
          <div class="cv-acoes">
            <button v-if="proxima" type="button" class="btn id-btn-principal btn-principal" :disabled="movendo"
                    @click="moverPara(proxima.id)"><icone-do-bloco nome="avancar" />{{ movendo ? 'Movendo…' : `Avançar para ${proxima.nome}` }}</button>
          </div>
          <div class="cv-form">
            <label class="cv-campo" for="ficha-etapa"><span>Ou mover para</span>
              <select id="ficha-etapa" v-model="etapaEscolhida">
                <option value="">Escolha a etapa…</option>
                <option v-for="e in etapasEmOrdem" :key="e.id" :value="String(e.id)" :disabled="e.id === stylist.etapa_id">
                  {{ e.nome }}{{ e.tipo === 'saida' ? ' (saída)' : '' }}</option>
              </select></label>
          </div>
          <div class="cv-acoes">
            <button type="button" class="btn id-btn-editar" :disabled="!etapaEscolhida || movendo"
                    @click="moverPara(Number(etapaEscolhida))"><icone-do-bloco nome="funil" />Mover</button>
          </div>
          <p v-if="erroDaEtapa" class="cv-nota cv-nota-erro">{{ erroDaEtapa }}</p>
        </div>
        <p v-if="stylist.proxima_acao" class="cv-nota cv-nota-aviso"><b>Próxima ação:</b> {{ stylist.proxima_acao }}
          <span v-if="stylist.proxima_acao_em"> — até {{ dataLegivel(stylist.proxima_acao_em) }}</span></p>
        <div class="cv-acoes">
          <button v-if="podeEditar" type="button" class="btn" @click="$emit('corrigir', stylist.codigo)">Corrigir dados…</button>
        </div>

        <!-- ── 24/09: o SCORECARD e a QUALIFICAÇÃO, abaixo dos dados e antes
             dos contatos. O scorecard sobe a leitura "desde o início", que é
             a base das sugestões e do aviso de reavaliar. -->
        <scorecard-da-stylist :codigo="stylist.codigo" :chamar="chamar" :versao="versaoDoScorecard"
                              @desde-o-inicio="desdeOInicio = $event" />
        <qualificacao-da-stylist :codigo="stylist.codigo" :nome="stylist.nome" :chamar="chamar"
                                 :pode-editar="podeEditar" :desde-o-inicio="desdeOInicio"
                                 @mudou="$emit('mudou')" />

        <div v-if="podeEditar" class="id-caixa-form">
          <h3 class="cv-etiqueta cv-etiqueta-interna id-titulo"><icone-do-bloco nome="contato" />Registrar contato</h3>
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
          <!-- ⚠️ SEM SUGESTÃO DE ETAPA desde 24/09/2026: contato não move
               ninguém. Quem muda a etapa é o bloco "Etapa", acima. -->
          <p v-if="registrado" class="cv-nota cv-nota-ok">Contato registrado.</p>
        </div>

        <h3 class="cv-etiqueta cv-etiqueta-interna id-titulo">Histórico de contatos</h3>
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

        <!-- ── 24/09: O HISTÓRICO DE ETAPAS — só acrescenta, com quem e quando. -->
        <h3 class="cv-etiqueta cv-etiqueta-interna id-titulo"><icone-do-bloco nome="relogio" />Histórico de etapas</h3>
        <p v-if="erroDasEtapas" class="cv-nota cv-nota-erro">{{ erroDasEtapas }}</p>
        <p v-else-if="carregandoEtapas" class="cv-carregando">Carregando…</p>
        <p v-else-if="!historicoDeEtapas.length" class="cv-vazio">Nenhuma mudança de etapa ainda.</p>
        <ul v-else class="cv-historico">
          <li v-for="h in historicoDeEtapas" :key="h.id">
            <p class="cv-sub"><b>{{ h.de ? `${h.de} → ${h.para}` : `Entrou em ${h.para}` }}</b> · {{ motivoDoHistorico(h.motivo) }}</p>
            <p class="cv-sub">{{ dataHoraLegivel(h.em) }}<span v-if="h.por_nome"> · {{ h.por_nome }}</span></p>
          </li>
        </ul>
      </div>
    </div>
  </div>
</template>

<script setup>
/* A FICHA DA STYLIST — a etapa, o scorecard, a qualificação, registrar contato
 * e ver os dois históricos.
 * ⚠️ Pendurada DENTRO da tela (o `v-if` do pai), nunca no `body`: o CSS é
 * `scoped` e um modal fora da raiz despenca sem estilo (PADRAO, item 4). */
import { ref, reactive, computed, onMounted } from 'vue'
import { telefoneLegivel } from './t11-regras.js'
import { dataLegivel, dataHoraLegivel } from './enderecos-publicos.js'
import {
  CANAIS, RESULTADOS, proximaEtapa, etapasDoFunil, etapasDeSaida, mensagemDasEtapas, motivoDoHistorico,
} from './crm-da-stylist-regras.js'
import IconeDoBloco from '../../compartilhado/icone-do-bloco.vue'
import ScorecardDaStylist from './scorecard-da-stylist.vue'
import QualificacaoDaStylist from './qualificacao-da-stylist.vue'

const props = defineProps({
  stylist: { type: Object, required: true },
  podeEditar: { type: Boolean, default: false },
  chamar: { type: Function, required: true },
  etapas: { type: Array, default: () => [] },
})
const emit = defineEmits(['fechar', 'mudou', 'corrigir'])

const historico = ref([])
const carregando = ref(true)
const erroDoHistorico = ref('')
const novo = reactive({ canal: '', resultado: '', nota: '', proximaAcao: '', proximaAcaoEm: '' })
const gravando = ref(false)
const erro = ref('')
const registrado = ref(false)
// O scorecard "desde o início" (para as sugestões) e o gatilho de reler.
const desdeOInicio = ref(null)
const versaoDoScorecard = ref(0)

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
  registrado.value = false
  try {
    const r = await props.chamar('vessel_stylist_registrar_contato', {
      p_codigo: props.stylist.codigo, p_canal: novo.canal, p_resultado: novo.resultado,
      p_nota: novo.nota || null, p_proxima_acao: novo.proximaAcao || null, p_proxima_acao_em: novo.proximaAcaoEm || null,
    })
    if (!r?.ok) { erro.value = MENSAGENS[r?.situacao] || 'Não consegui registrar agora. Tente de novo em um instante.'; return }
    Object.assign(novo, { canal: '', resultado: '', nota: '', proximaAcao: '', proximaAcaoEm: '' })
    registrado.value = true
    versaoDoScorecard.value++
    await carregarHistorico()
    emit('mudou')
  } catch { erro.value = 'Não consegui falar com o banco agora. Tente de novo em um instante.' }
  finally { gravando.value = false }
}

// ── a etapa (24/09/2026) ─────────────────────────────────────────────────────
const etapasEmOrdem = computed(() => [...etapasDoFunil(props.etapas), ...etapasDeSaida(props.etapas)])
const proxima = computed(() => proximaEtapa(props.etapas, props.stylist.etapa_id))
const etapaEscolhida = ref('')
const movendo = ref(false)
const erroDaEtapa = ref('')
const historicoDeEtapas = ref([])
const carregandoEtapas = ref(true)
const erroDasEtapas = ref('')

async function carregarHistoricoDeEtapas() {
  carregandoEtapas.value = true
  erroDasEtapas.value = ''
  try { historicoDeEtapas.value = await props.chamar('vessel_stylist_historico_de_etapas', { p_codigo: props.stylist.codigo }) || [] }
  catch { erroDasEtapas.value = 'Não consegui ler o histórico de etapas agora. Tente de novo em um instante.' }
  finally { carregandoEtapas.value = false }
}

async function moverPara(etapaId) {
  if (movendo.value || !etapaId) return
  movendo.value = true
  erroDaEtapa.value = ''
  try {
    const r = await props.chamar('vessel_stylist_mover_de_etapa', { p_codigo: props.stylist.codigo, p_etapa_id: etapaId })
    if (!r?.ok) { erroDaEtapa.value = mensagemDasEtapas(r?.situacao); return }
    etapaEscolhida.value = ''
    emit('mudou')
    await carregarHistoricoDeEtapas()
  } catch { erroDaEtapa.value = 'Não consegui falar com o banco agora. Tente de novo em um instante.' }
  finally { movendo.value = false }
}

onMounted(carregarHistoricoDeEtapas)
onMounted(carregarHistorico)
</script>

<style scoped>
@import './estilo-comercial.css';
@import '../../estilos/identidade-da-ferramenta.css';
</style>
