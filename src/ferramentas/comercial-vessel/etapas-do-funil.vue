<template>
  <div class="cv-modal-fundo" v-trava-rolagem @click.self="$emit('fechar')">
    <div class="cv-modal cv-modal-largo" role="dialog" aria-label="Etapas do funil">
      <div class="cv-modal-topo">
        <h2 class="cv-modal-titulo">Etapas do funil</h2>
        <button type="button" class="btn cv-modal-fechar" aria-label="Fechar" @click="$emit('fechar')">✕</button>
      </div>
      <div class="cv-modal-corpo">
        <p class="cv-nota">
          As colunas do quadro são as etapas de <b>funil</b>, nesta ordem. As
          <b>saídas</b> ficam juntas no fim. Quem é cadastrada entra na primeira
          etapa de funil. Nenhuma parceira muda de etapa sozinha.
        </p>
        <p class="cv-nota">
          <b>Conta como prospectada:</b> a parceira ganha a data da prospecção no
          dia em que chega pela primeira vez na etapa marcada, ou numa etapa de
          funil depois dela. Trocar a marca de etapa <b>não muda as datas já
          gravadas</b> — vale para quem chegar dali em diante.
        </p>
        <p v-if="erro" class="cv-nota cv-nota-erro">{{ erro }}</p>
        <p v-if="!podeEditar" class="cv-nota">Você pode ver as etapas. Para mexer, precisa da permissão de editar do Stylist Circle.</p>

        <ol class="cv-etapas">
          <li v-for="(e, i) in lista" :key="e.id" class="cv-etapa" :class="e.tipo === 'saida' ? 'cv-fase-saidas' : 'cv-fase-funil'">
            <div class="cv-etapa-cabeca">
              <span class="cv-etapa-posicao">{{ i + 1 }}</span>
              <div class="cv-etapa-texto">
                <template v-if="renomeando === e.id">
                  <label class="cv-campo" :for="`etapa-nome-${e.id}`"><span>Novo nome</span>
                    <input :id="`etapa-nome-${e.id}`" type="text" maxlength="60" v-model="novoNome"></label>
                </template>
                <p v-else class="cv-etapa-nome">{{ e.nome }}</p>
                <p class="cv-sub">
                  {{ e.tipo === 'saida' ? 'Saída' : 'Funil' }} · {{ quantas(e.stylists) }}
                  <span v-if="e.conta_como_prospectada" class="cv-selo id-selo id-tom-viva">conta como prospectada</span>
                </p>
                <p v-if="e.alterado_por_nome" class="cv-sub">mexida por {{ e.alterado_por_nome }} em {{ dataHoraLegivel(e.alterado_em) }}</p>
              </div>
            </div>

            <div v-if="podeEditar && renomeando === e.id" class="cv-acoes">
              <button type="button" class="btn" :disabled="gravando" @click="renomeando = null">Cancelar</button>
              <button type="button" class="btn id-btn-principal btn-principal" :disabled="gravando || problemasDaEtapa(novoNome).length > 0"
                      @click="renomear(e)"><icone-do-bloco nome="editar" />Salvar o nome</button>
            </div>
            <div v-else-if="podeEditar && excluindo !== e.id" class="cv-acoes">
              <button type="button" class="btn id-btn-apoio cv-seta" :disabled="gravando || i === 0"
                      :aria-label="`Subir ${e.nome}`" @click="mover(e, 'subir')"><icone-do-bloco nome="subir" />Subir</button>
              <button type="button" class="btn id-btn-apoio cv-seta" :disabled="gravando || i === lista.length - 1"
                      :aria-label="`Descer ${e.nome}`" @click="mover(e, 'descer')"><icone-do-bloco nome="descer" />Descer</button>
              <button type="button" class="btn id-btn-editar" :disabled="gravando" @click="abrirRenomear(e)">
                <icone-do-bloco nome="editar" />Renomear</button>
              <button type="button" class="btn id-btn-arquivar" :disabled="gravando" @click="trocarTipo(e)">
                <icone-do-bloco :nome="e.tipo === 'saida' ? 'reabrir' : 'arquivar'" />{{ e.tipo === 'saida' ? 'Voltar ao funil' : 'Marcar como saída' }}</button>
              <button v-if="e.tipo === 'funil' && !e.conta_como_prospectada" type="button" class="btn id-btn-voltar"
                      :disabled="gravando" @click="marcarProspectada(e)"><icone-do-bloco nome="placar" />Contar daqui como prospectada</button>
              <button type="button" class="btn id-btn-perigo btn-perigo" :disabled="gravando" @click="abrirExcluir(e)">
                <icone-do-bloco nome="lixeira" />Excluir…</button>
            </div>

            <!-- ⚠️ EXCLUIR COM GENTE DENTRO EXIGE O DESTINO: todas vão para ele
                 numa transação só, e o histórico de cada uma diz por quê. -->
            <div v-if="podeEditar && excluindo === e.id" class="id-caixa-form">
              <p class="cv-nota cv-nota-aviso">
                Excluir <b>{{ e.nome }}</b>?
                <span v-if="e.stylists"> Há {{ quantas(e.stylists) }} nesta etapa: escolha para onde elas vão.</span>
                <span v-else> Não há parceiras nela.</span>
              </p>
              <div v-if="e.stylists" class="cv-form">
                <label class="cv-campo" :for="`etapa-destino-${e.id}`"><span>Mover as parceiras para</span>
                  <select :id="`etapa-destino-${e.id}`" v-model="destino">
                    <option value="">Escolha a etapa…</option>
                    <option v-for="d in lista.filter((x) => x.id !== e.id)" :key="d.id" :value="String(d.id)">
                      {{ d.nome }}{{ d.tipo === 'saida' ? ' (saída)' : '' }}</option>
                  </select></label>
              </div>
              <div class="cv-acoes">
                <button type="button" class="btn" :disabled="gravando" @click="excluindo = null">Cancelar</button>
                <button type="button" class="btn id-btn-perigo btn-perigo" :disabled="gravando || (e.stylists > 0 && !destino)"
                        @click="excluir(e)"><icone-do-bloco nome="lixeira" />{{ gravando ? 'Excluindo…' : 'Excluir a etapa' }}</button>
              </div>
            </div>
          </li>
        </ol>

        <div v-if="podeEditar" class="id-caixa-form">
          <h3 class="cv-etiqueta cv-etiqueta-interna id-titulo"><icone-do-bloco nome="novo" />Adicionar etapa</h3>
          <div class="cv-form">
            <label class="cv-campo" for="etapa-nova-nome"><span>Nome</span>
              <input id="etapa-nova-nome" type="text" maxlength="60" v-model="nova.nome"></label>
            <label class="cv-campo" for="etapa-nova-posicao"><span>Posição</span>
              <select id="etapa-nova-posicao" v-model="nova.posicao">
                <option value="">No fim</option>
                <option v-for="(e, i) in lista" :key="e.id" :value="String(i + 1)">Antes de {{ e.nome }}</option>
              </select></label>
            <label class="cv-campo" for="etapa-nova-tipo"><span>Tipo</span>
              <select id="etapa-nova-tipo" v-model="nova.tipo">
                <option value="funil">Funil</option>
                <option value="saida">Saída</option>
              </select></label>
          </div>
          <ul v-if="nova.nome && problemasDaEtapa(nova.nome).length" class="cv-problemas">
            <li v-for="p in problemasDaEtapa(nova.nome)" :key="p">{{ p }}</li>
          </ul>
          <div class="cv-acoes">
            <button type="button" class="btn id-btn-principal btn-principal"
                    :disabled="gravando || problemasDaEtapa(nova.nome).length > 0" @click="adicionar">
              <icone-do-bloco nome="novo" />{{ gravando ? 'Gravando…' : 'Adicionar etapa' }}</button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
/* A TELA "ETAPAS DO FUNIL" — adicionar, renomear, reordenar, marcar saída,
 * escolher a que conta como prospectada e excluir movendo quem está nela
 * (24/09/2026, decisão do dono). Cada gesto é uma função do banco
 * (`vessel_stylist_etapa_*`), com a permissão de editar conferida LÁ DENTRO e
 * a trilha de quem mexeu. A tela só pergunta e mostra.
 * ⚠️ Pendurada DENTRO da tela (o `v-if` do pai), nunca no `body`: o CSS é
 * `scoped` e um modal fora da raiz despenca sem estilo (PADRAO, item 4). */
import { ref, reactive, computed } from 'vue'
import { dataHoraLegivel } from './enderecos-publicos.js'
import { etapasDoFunil, etapasDeSaida, problemasDaEtapa, mensagemDasEtapas } from './crm-da-stylist-regras.js'
import IconeDoBloco from '../../compartilhado/icone-do-bloco.vue'

const props = defineProps({
  etapas: { type: Array, default: () => [] },
  podeEditar: { type: Boolean, default: false },
  chamar: { type: Function, required: true },
})
const emit = defineEmits(['fechar', 'mudou'])

// ⚠️ A ORDEM DA TELA É A DO BANCO (uma ordem só para funil e saídas).
const lista = computed(() => [...etapasDoFunil(props.etapas), ...etapasDeSaida(props.etapas)]
  .sort((a, b) => a.ordem - b.ordem || a.id - b.id))
const quantas = (n) => (n === 1 ? '1 parceira' : `${n || 0} parceiras`)

const gravando = ref(false)
const erro = ref('')
const renomeando = ref(null)
const novoNome = ref('')
const excluindo = ref(null)
const destino = ref('')
const nova = reactive({ nome: '', posicao: '', tipo: 'funil' })

async function gravar(funcao, corpo, depois) {
  if (gravando.value) return
  gravando.value = true
  erro.value = ''
  try {
    const r = await props.chamar(funcao, corpo)
    if (!r?.ok) { erro.value = mensagemDasEtapas(r?.situacao); return }
    if (depois) depois(r)
    emit('mudou')
  } catch {
    erro.value = 'Não consegui falar com o banco agora. Tente de novo em um instante.'
  } finally {
    gravando.value = false
  }
}

function abrirRenomear(e) { renomeando.value = e.id; novoNome.value = e.nome; excluindo.value = null }
function abrirExcluir(e) { excluindo.value = e.id; destino.value = ''; renomeando.value = null }

const renomear = (e) => gravar('vessel_stylist_etapa_renomear', { p_id: e.id, p_nome: novoNome.value },
  () => { renomeando.value = null })
const mover = (e, direcao) => gravar('vessel_stylist_etapa_mover', { p_id: e.id, p_direcao: direcao })
const trocarTipo = (e) => gravar('vessel_stylist_etapa_tipo', { p_id: e.id, p_tipo: e.tipo === 'saida' ? 'funil' : 'saida' })
const marcarProspectada = (e) => gravar('vessel_stylist_etapa_marcar_prospectada', { p_id: e.id })
const excluir = (e) => gravar('vessel_stylist_etapa_excluir',
  { p_id: e.id, p_destino: destino.value ? Number(destino.value) : null }, () => { excluindo.value = null })
const adicionar = () => gravar('vessel_stylist_etapa_criar',
  { p_nome: nova.nome, p_posicao: nova.posicao ? Number(nova.posicao) : null, p_tipo: nova.tipo },
  () => Object.assign(nova, { nome: '', posicao: '', tipo: 'funil' }))
</script>

<style scoped>
@import './estilo-comercial.css';
@import '../../estilos/identidade-da-ferramenta.css';

.cv-modal-largo { max-width: 640px; }
/* ⚠️ O MODAL É ESTREITO MESMO NO COMPUTADOR: a grade de três colunas do
   formulário (que segue a largura da JANELA) cortava "Antes de Prospectado". */
.cv-modal-largo .cv-form { grid-template-columns: 1fr; }
.cv-etapas { list-style: none; margin: var(--sp-3) 0; padding: 0; display: flex; flex-direction: column; gap: var(--sp-3); }
.cv-etapa {
  border: 1px solid var(--border); border-left: 3px solid var(--fase, var(--border));
  border-radius: var(--radius-sm); padding: var(--sp-3); display: flex; flex-direction: column; gap: var(--sp-2);
}
.cv-etapa-cabeca { display: flex; gap: var(--sp-3); align-items: flex-start; }
.cv-etapa-posicao {
  flex: 0 0 auto; min-width: 28px; height: 28px; border-radius: 50%; display: inline-flex; align-items: center;
  justify-content: center; font-size: var(--texto-etiqueta); font-weight: 600; color: var(--text);
  background: color-mix(in srgb, var(--fase, var(--border)) 16%, var(--surface));
}
.cv-etapa-texto { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
.cv-etapa-nome { margin: 0; font-weight: 600; color: var(--text); overflow-wrap: anywhere; font-size: var(--texto-corpo); }
.cv-etapa .cv-selo { margin-left: var(--sp-1); white-space: normal; }
</style>
