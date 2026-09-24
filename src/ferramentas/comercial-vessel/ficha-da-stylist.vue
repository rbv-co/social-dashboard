<template>
  <div class="cv-modal-fundo cv-ficha-fundo" v-trava-rolagem @click.self="$emit('fechar')">
    <!-- ⚠️ A FICHA É LARGA DE PROPÓSITO (pedido do dono, 24/09/2026: "mal
         organizada, centralizada"). É a exceção ao modal de 420px do PADRAO
         (item 4): do computador (≥900px) ela abre em duas colunas —
         RELACIONAMENTO à esquerda (etapa, próxima ação, contatos, históricos) e
         DESEMPENHO à direita (scorecard e qualificação). Duas colunas e não
         abas: nada fica escondido atrás de um toque, e a etapa continua à vista
         enquanto se registra o contato. No celular, uma coluna só, na ordem de
         prioridade (a ordem vem do CSS: `order` em cada cartão). -->
    <div class="cv-modal cv-ficha" role="dialog" :aria-label="`Ficha de ${stylist.nome}`">
      <div class="cv-modal-topo cv-ficha-topo">
        <h2 class="cv-modal-titulo">{{ stylist.nome }}</h2>
        <button type="button" class="btn cv-modal-fechar" aria-label="Fechar" @click="$emit('fechar')">✕</button>
      </div>
      <!-- A FAIXA DE CIMA: quem é, em que etapa e faixa está, e os atalhos. -->
      <div class="cv-ficha-faixa">
        <div class="cv-ficha-quem">
          <div class="cv-ficha-selos">
            <span class="cv-selo id-selo cv-selo-etapa" :class="`id-tom-${seloDaEtapa(stylist).tom}`">{{ etapaComMotivo(stylist) }}</span>
            <span v-if="faixa" class="cv-selo id-selo" :class="`id-tom-${faixa.tom}`">{{ faixa.texto }}</span>
            <span v-if="seloSemContato(stylist)" class="cv-selo id-selo cv-selo-sem-contato" :class="`id-tom-${seloSemContato(stylist).tom}`">{{ seloSemContato(stylist).texto }}</span>
          </div>
          <p class="cv-sub"><span class="cv-codigo">{{ stylist.codigo }}</span><span v-if="stylist.cidade"> · {{ stylist.cidade }}</span></p>
          <!-- ⚠️ WHATSAPP OU INSTAGRAM (24/09/2026): pode faltar um dos dois. -->
          <p v-if="!seloSemContato(stylist)" class="cv-sub">{{ [telefoneLegivel(stylist.whatsapp) || 'sem WhatsApp', stylist.instagram].filter(Boolean).join(' · ') }}</p>
          <p v-else class="cv-sub">Sem WhatsApp e sem Instagram por enquanto — alguém vai completar.</p>
        </div>
        <!-- 24/09: o contato fácil (abre o WhatsApp/Instagram; NÃO registra contato). -->
        <div class="cv-acoes cv-ficha-atalhos">
          <contato-facil :stylist="stylist" />
          <button v-if="podeEditar" type="button" class="btn id-btn-editar" @click="$emit('corrigir', stylist.codigo)"><icone-do-bloco nome="editar" />Corrigir dados…</button>
        </div>
      </div>

      <div class="cv-modal-corpo cv-ficha-corpo">
        <p v-if="stylist.observacoes" class="cv-nota cv-observacoes cv-ficha-observacoes"><b>Observações:</b> {{ stylist.observacoes }}</p>

        <div class="cv-ficha-colunas">
          <!-- ══ RELACIONAMENTO ══ -->
          <div class="cv-ficha-coluna">
            <!-- ── 24/09: A ETAPA (funil configurável). "Avançar" vai para a
                 próxima etapa de funil pela ordem; o seletor vai para QUALQUER
                 uma. Nada muda de etapa sozinho. A próxima ação mora junto:
                 é o "o que fazer agora" da mesma pessoa. -->
            <section class="cv-ficha-cartao cv-ficha-etapa cv-ficha-tom-etapa">
              <h3 class="cv-etiqueta cv-etiqueta-interna id-titulo"><icone-do-bloco nome="funil" />Etapa</h3>
              <p class="cv-sub cv-ficha-agora">Agora: <b>{{ etapaComMotivo(stylist) }}</b>
                <span v-if="stylist.prospectado_em"> · prospectada em {{ dataLegivel(stylist.prospectado_em) }}</span></p>
              <p v-if="stylist.etapa_tipo === 'saida' && stylist.saida_nota" class="cv-sub">Nota da saída: {{ stylist.saida_nota }}</p>
              <!-- ⚠️ 24/09/2026: SÓ QUEM ESTÁ NUMA ETAPA QUE LIBERA PRIVATE EDIT
                   (hoje, a Ativada) pode ser anfitriã de um encontro novo. -->
              <p class="cv-ficha-pe" :class="privateEdit.pode ? 'cv-ficha-pe-sim' : 'cv-ficha-pe-nao'">
                <span class="cv-selo id-selo" :class="privateEdit.pode ? 'id-tom-viva' : 'id-tom-parada'">Private Edit</span>
                {{ privateEdit.texto }}</p>
              <p v-if="avisoDaEtapa" class="cv-nota cv-nota-ok" role="status">{{ avisoDaEtapa }}</p>
              <p v-if="stylist.proxima_acao" class="cv-nota cv-ficha-proxima"><b>Próxima ação:</b> {{ stylist.proxima_acao }}
                <span v-if="stylist.proxima_acao_em"> — até {{ dataLegivel(stylist.proxima_acao_em) }}</span></p>
              <template v-if="podeEditar">
                <div v-if="proxima" class="cv-acoes">
                  <button type="button" class="btn id-btn-principal btn-principal" :disabled="movendo"
                          @click="moverPara(proxima.id)"><icone-do-bloco nome="avancar" />{{ movendo ? 'Movendo…' : `Avançar para ${proxima.nome}` }}</button>
                </div>
                <div class="cv-ficha-mover">
                  <label class="cv-campo" for="ficha-etapa"><span>Ou mover para</span>
                    <select id="ficha-etapa" v-model="etapaEscolhida">
                      <option value="">Escolha a etapa…</option>
                      <option v-for="e in etapasEmOrdem" :key="e.id" :value="String(e.id)" :disabled="e.id === stylist.etapa_id">
                        {{ e.nome }}{{ e.tipo === 'saida' ? ' (saída)' : '' }}</option>
                    </select></label>
                  <button type="button" class="btn id-btn-editar" :disabled="!etapaEscolhida || movendo"
                          @click="moverPara(Number(etapaEscolhida))"><icone-do-bloco nome="funil" />Mover</button>
                </div>
                <p v-if="erroDaEtapa && !pedindoMotivo" class="cv-nota cv-nota-erro">{{ erroDaEtapa }}</p>
              </template>
            </section>

            <section v-if="podeEditar" class="cv-ficha-cartao cv-ficha-registrar cv-ficha-tom-contato id-caixa-form">
              <h3 class="cv-etiqueta cv-etiqueta-interna id-titulo"><icone-do-bloco nome="contato" />Registrar contato</h3>
              <p class="cv-sub cv-ficha-rotulo">Canal</p>
              <div class="cv-escolha">
                <button v-for="(rotulo, k) in CANAIS" :key="k" type="button" class="btn"
                        :class="{ ativa: novo.canal === k }" @click="novo.canal = k">{{ rotulo }}</button>
              </div>
              <p class="cv-sub cv-ficha-rotulo">Resultado</p>
              <div class="cv-escolha">
                <button v-for="(rotulo, k) in RESULTADOS" :key="k" type="button" class="btn"
                        :class="{ ativa: novo.resultado === k }" @click="novo.resultado = k">{{ rotulo }}</button>
              </div>
              <div class="cv-form cv-ficha-form">
                <label class="cv-campo cv-campo-largo" for="ficha-nota"><span>Nota (opcional)</span>
                  <input id="ficha-nota" type="text" maxlength="500" v-model="novo.nota"></label>
                <label class="cv-campo cv-ficha-campo-acao" for="ficha-proxima"><span>Nova próxima ação (opcional)</span>
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
            </section>

            <section class="cv-ficha-cartao cv-ficha-contatos cv-ficha-tom-contato">
              <h3 class="cv-etiqueta cv-etiqueta-interna id-titulo"><icone-do-bloco nome="lista" />Histórico de contatos</h3>
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
            </section>

            <!-- ── 24/09: O HISTÓRICO DE ETAPAS — só acrescenta, com quem e quando. -->
            <section class="cv-ficha-cartao cv-ficha-etapas cv-ficha-tom-etapa">
              <h3 class="cv-etiqueta cv-etiqueta-interna id-titulo"><icone-do-bloco nome="relogio" />Histórico de etapas</h3>
              <p v-if="erroDasEtapas" class="cv-nota cv-nota-erro">{{ erroDasEtapas }}</p>
              <p v-else-if="carregandoEtapas" class="cv-carregando">Carregando…</p>
              <p v-else-if="!historicoDeEtapas.length" class="cv-vazio">Nenhuma mudança de etapa ainda.</p>
              <ul v-else class="cv-historico">
                <li v-for="h in historicoDeEtapas" :key="h.id">
                  <p class="cv-sub"><b>{{ h.de ? `${h.de} → ${h.para}` : `Entrou em ${h.para}` }}</b><span
                     v-if="h.motivo_de_saida"> · <b>{{ h.motivo_de_saida }}</b></span> · {{ motivoDoHistorico(h.motivo) }}</p>
                  <p v-if="h.nota" class="cv-nota cv-nota-primeira">{{ h.nota }}</p>
                  <p class="cv-sub">{{ dataHoraLegivel(h.em) }}<span v-if="h.por_nome"> · {{ h.por_nome }}</span></p>
                </li>
              </ul>
            </section>
          </div>

          <!-- ══ DESEMPENHO ══ o scorecard sobe a leitura "desde o início", que é
               a base das sugestões e do aviso de reavaliar. -->
          <div class="cv-ficha-coluna">
            <scorecard-da-stylist class="cv-ficha-cartao cv-ficha-scorecard cv-ficha-tom-placar"
                                  :codigo="stylist.codigo" :chamar="chamar" :versao="versaoDoScorecard"
                                  @desde-o-inicio="desdeOInicio = $event" />
            <qualificacao-da-stylist class="cv-ficha-cartao cv-ficha-qualificacao cv-ficha-tom-nota"
                                     :codigo="stylist.codigo" :nome="stylist.nome" :chamar="chamar"
                                     :pode-editar="podeEditar" :desde-o-inicio="desdeOInicio"
                                     @mudou="$emit('mudou')" @faixa="faixa = $event" />
          </div>
        </div>
      </div>
    </div>
    <!-- 24/09/2026: o motivo da saída — o MESMO componente do arrastar no quadro. -->
    <escolha-do-motivo v-if="pedindoMotivo" :etapa="pedindoMotivo" :nome="stylist.nome"
                       :gravando="movendo" :erro="erroDaEtapa"
                       @cancelar="pedindoMotivo = null; erroDaEtapa = ''"
                       @confirmar="(m) => gravarMovimento(pedindoMotivo.id, m)" />
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
  etapaComMotivo, privateEditDaStylist, pedeMotivo, avisoDeLiberada,
} from './crm-da-stylist-regras.js'
import { seloDaEtapa } from './t11-regras.js'
import { seloSemContato } from './stylist-circle-regras.js'
import EscolhaDoMotivo from './escolha-do-motivo.vue'
import IconeDoBloco from '../../compartilhado/icone-do-bloco.vue'
import ContatoFacil from './contato-facil.vue'
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
// O selo da faixa vigente, para a faixa de cima (vem do bloco Qualificação).
const faixa = ref(null)

const MENSAGENS = {
  sem_permissao: 'Você não tem a permissão de mexer no Stylist Circle para registrar contato.',
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

// ⚠️ 24/09/2026: SAÍDA COM MOTIVOS abre a escolha do motivo antes de gravar
// (o banco recusa sem ele); o resto grava direto, como antes.
const pedindoMotivo = ref(null)
const avisoDaEtapa = ref('')
const privateEdit = computed(() => privateEditDaStylist(props.stylist, props.etapas))

function moverPara(etapaId) {
  if (movendo.value || !etapaId) return
  const destino = props.etapas.find((e) => e.id === etapaId)
  erroDaEtapa.value = ''
  avisoDaEtapa.value = ''
  if (pedeMotivo(destino)) { pedindoMotivo.value = destino; return }
  gravarMovimento(etapaId, null)
}

async function gravarMovimento(etapaId, motivo) {
  if (movendo.value) return
  movendo.value = true
  erroDaEtapa.value = ''
  try {
    const r = await props.chamar('vessel_stylist_mover_de_etapa', {
      p_codigo: props.stylist.codigo, p_etapa_id: etapaId,
      p_motivo_id: motivo?.motivoId ?? null, p_nota: motivo?.nota ?? null,
    })
    if (!r?.ok) { erroDaEtapa.value = mensagemDasEtapas(r?.situacao); return }
    etapaEscolhida.value = ''
    pedindoMotivo.value = null
    if (r.libera_private_edit) avisoDaEtapa.value = avisoDeLiberada(props.stylist.nome, props.etapas.find((e) => e.id === etapaId))
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
