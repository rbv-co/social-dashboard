<template>
  <div class="cv-modal-fundo" v-trava-rolagem @click.self="$emit('fechar')">
    <div class="cv-modal cv-modal-largo" role="dialog" aria-label="Etapas do funil">
      <div class="cv-modal-topo">
        <h2 class="cv-modal-titulo">Etapas do funil</h2>
        <button type="button" class="btn cv-modal-fechar" aria-label="Fechar" @click="$emit('fechar')">✕</button>
      </div>
      <div class="cv-modal-corpo">
        <p class="cv-nota">
          As colunas do quadro são as etapas de <b>funil</b>, nesta ordem, e
          depois as <b>saídas</b>, uma coluna cada. Quem é cadastrada entra na
          primeira etapa de funil. Nenhuma parceira muda de etapa sozinha.
        </p>
        <p class="cv-nota">
          <b>Conta como prospectada:</b> a parceira ganha a data da prospecção no
          dia em que chega pela primeira vez na etapa marcada, ou numa etapa de
          funil depois dela. Trocar a marca de etapa <b>não muda as datas já
          gravadas</b> — vale para quem chegar dali em diante.
        </p>
        <p class="cv-nota">
          <b>Libera Private Edit:</b> só quem está numa etapa com esta marca pode
          ser anfitriã de um encontro novo (hoje, a <b>Ativada</b>). Os encontros
          que já existem não mudam quando ela sai da etapa.
        </p>
        <p class="cv-nota">
          <b>Motivos:</b> cada saída pode ter a sua lista. Quando tem, mover
          alguém para ela pede o motivo. Motivo usado não se apaga: desative, e
          ele some da escolha mas fica no histórico.
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
                  <span v-if="e.libera_private_edit" class="cv-selo id-selo id-tom-viva">libera Private Edit</span>
                </p>
                <p v-if="e.alterado_por_nome" class="cv-sub">mexida por {{ e.alterado_por_nome }} em {{ dataHoraLegivel(e.alterado_em) }}</p>
              </div>
            </div>

            <!-- ⚠️ 24/09/2026: A MARCA "LIBERA PRIVATE EDIT", uma por etapa (várias
                 podem ter; nenhuma é permitido). -->
            <div v-if="podeEditar && renomeando !== e.id && excluindo !== e.id" class="cv-etapa-liberar">
              <button type="button" role="switch" class="btn cv-interruptor" :class="{ ligado: e.libera_private_edit }"
                      :aria-checked="e.libera_private_edit ? 'true' : 'false'" :disabled="gravando"
                      :aria-label="`Libera Private Edit em ${e.nome}`"
                      @click="liberar(e, !e.libera_private_edit)">
                <span class="cv-interruptor-trilho" aria-hidden="true"><span class="cv-interruptor-bolinha"></span></span>
                Libera Private Edit: <b>{{ e.libera_private_edit ? 'sim' : 'não' }}</b></button>
              <span class="cv-sub">{{ e.libera_private_edit ? 'quem está aqui pode ser anfitriã de encontro novo' : 'quem está aqui ainda não pode ter encontro novo' }}</span>
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
              <p v-if="e.stylists && destinoPedeMotivo" class="cv-nota">
                {{ destinoEscolhido.nome }} pede um motivo: ele será perguntado ao excluir, e vale para todas.</p>
              <div class="cv-acoes">
                <button type="button" class="btn" :disabled="gravando" @click="excluindo = null">Cancelar</button>
                <button type="button" class="btn id-btn-perigo btn-perigo" :disabled="gravando || (e.stylists > 0 && !destino)"
                        @click="pedirExcluir(e)"><icone-do-bloco nome="lixeira" />{{ gravando ? 'Excluindo…' : 'Excluir a etapa' }}</button>
              </div>
            </div>

            <!-- ⚠️ 24/09/2026: OS MOTIVOS DESTA SAÍDA. Recolhidos por padrão: a
                 lista do Desclassificado tem nove. -->
            <div v-if="e.tipo === 'saida'" class="cv-motivos-da-saida">
              <button type="button" class="btn id-btn-apoio" :aria-expanded="motivosAbertos === e.id ? 'true' : 'false'"
                      @click="motivosAbertos = motivosAbertos === e.id ? null : e.id">
                <icone-do-bloco nome="lista" />{{ motivosAbertos === e.id ? 'Fechar os motivos' : `Motivos (${motivosAtivos(e).length})` }}</button>
              <template v-if="motivosAbertos === e.id">
                <p v-if="!(e.motivos || []).length" class="cv-sub">Sem motivos: mover para {{ e.nome }} não pede nenhum.</p>
                <ol class="cv-motivos-lista">
                  <li v-for="m in motivosEmOrdem(e)" :key="m.id" class="cv-motivo" :class="{ 'cv-motivo-fora': m.ativo === false }">
                    <template v-if="mexendoMotivo === m.id">
                      <label class="cv-campo" :for="`motivo-nome-${m.id}`"><span>Nome do motivo</span>
                        <input :id="`motivo-nome-${m.id}`" type="text" maxlength="80" v-model="nomeDoMotivo"></label>
                      <div class="cv-acoes">
                        <button type="button" class="btn" :disabled="gravando" @click="mexendoMotivo = null">Fechar</button>
                        <button type="button" class="btn id-btn-editar" :disabled="gravando || problemasDoNomeDoMotivo(nomeDoMotivo).length > 0 || nomeDoMotivo.trim() === m.nome"
                                @click="gravar('vessel_stylist_motivo_renomear', { p_id: m.id, p_nome: nomeDoMotivo })"><icone-do-bloco nome="editar" />Salvar o nome</button>
                        <template v-if="m.ativo !== false">
                          <button type="button" class="btn id-btn-apoio cv-seta" :disabled="gravando" :aria-label="`Subir ${m.nome}`"
                                  @click="gravar('vessel_stylist_motivo_mover', { p_id: m.id, p_direcao: 'subir' })"><icone-do-bloco nome="subir" />Subir</button>
                          <button type="button" class="btn id-btn-apoio cv-seta" :disabled="gravando" :aria-label="`Descer ${m.nome}`"
                                  @click="gravar('vessel_stylist_motivo_mover', { p_id: m.id, p_direcao: 'descer' })"><icone-do-bloco nome="descer" />Descer</button>
                        </template>
                        <button type="button" class="btn" :disabled="gravando"
                                @click="gravar('vessel_stylist_motivo_exigir_nota', { p_id: m.id, p_exige: !m.exige_nota })">
                          {{ m.exige_nota ? 'Não pedir nota' : 'Pedir nota' }}</button>
                        <button type="button" class="btn" :class="m.ativo === false ? 'id-btn-voltar' : 'id-btn-arquivar'" :disabled="gravando"
                                @click="gravar('vessel_stylist_motivo_ativar', { p_id: m.id, p_ativo: m.ativo === false })">
                          <icone-do-bloco :nome="m.ativo === false ? 'reabrir' : 'arquivar'" />{{ m.ativo === false ? 'Reativar' : 'Desativar' }}</button>
                      </div>
                    </template>
                    <template v-else>
                      <p class="cv-motivo-nome">{{ m.nome }}
                        <span v-if="m.exige_nota" class="cv-selo id-selo id-tom-andamento">pede nota</span>
                        <span v-if="m.ativo === false" class="cv-selo id-selo id-tom-parada">fora de uso</span></p>
                      <button v-if="podeEditar" type="button" class="btn id-btn-editar" :disabled="gravando"
                              :aria-label="`Mexer em ${m.nome}`" @click="abrirMotivo(m)"><icone-do-bloco nome="editar" />Mexer</button>
                    </template>
                  </li>
                </ol>
                <div v-if="podeEditar" class="cv-form cv-motivo-novo">
                  <label class="cv-campo" :for="`motivo-novo-${e.id}`"><span>Novo motivo</span>
                    <input :id="`motivo-novo-${e.id}`" type="text" maxlength="80" v-model="motivoNovo.nome"></label>
                  <label class="cv-marcar" :for="`motivo-novo-nota-${e.id}`">
                    <input :id="`motivo-novo-nota-${e.id}`" type="checkbox" v-model="motivoNovo.exigeNota"> Pede nota (como "Outro")</label>
                </div>
                <div v-if="podeEditar" class="cv-acoes">
                  <button type="button" class="btn id-btn-principal btn-principal" :disabled="gravando || problemasDoNomeDoMotivo(motivoNovo.nome).length > 0"
                          @click="gravar('vessel_stylist_motivo_criar', { p_etapa_id: e.id, p_nome: motivoNovo.nome, p_exige_nota: motivoNovo.exigeNota },
                                         () => Object.assign(motivoNovo, { nome: '', exigeNota: false }))">
                    <icone-do-bloco nome="novo" />Adicionar motivo</button>
                </div>
              </template>
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
    <!-- 24/09/2026: excluir mandando gente para uma saída com motivos pede o
         motivo — o mesmo componente do quadro e da ficha. -->
    <escolha-do-motivo v-if="motivoDaExclusao" :etapa="motivoDaExclusao.destino" :quantas="motivoDaExclusao.etapa.stylists"
                       :gravando="gravando" :erro="erro"
                       @cancelar="motivoDaExclusao = null; erro = ''"
                       @confirmar="(m) => excluir(motivoDaExclusao.etapa, m)" />
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
import {
  etapasDoFunil, etapasDeSaida, problemasDaEtapa, mensagemDasEtapas, motivosAtivos, pedeMotivo, problemasDoNomeDoMotivo,
} from './crm-da-stylist-regras.js'
import IconeDoBloco from '../../compartilhado/icone-do-bloco.vue'
import EscolhaDoMotivo from './escolha-do-motivo.vue'

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
// ⚠️ 24/09/2026: destino que pede motivo abre a escolha antes de excluir.
const destinoEscolhido = computed(() => props.etapas.find((x) => String(x.id) === destino.value) || null)
const destinoPedeMotivo = computed(() => pedeMotivo(destinoEscolhido.value))
const motivoDaExclusao = ref(null)
function pedirExcluir(e) {
  if (e.stylists > 0 && destinoPedeMotivo.value) { erro.value = ''; motivoDaExclusao.value = { etapa: e, destino: destinoEscolhido.value }; return }
  excluir(e, null)
}
const excluir = (e, motivo) => gravar('vessel_stylist_etapa_excluir',
  { p_id: e.id, p_destino: destino.value ? Number(destino.value) : null,
    p_motivo_id: motivo?.motivoId ?? null, p_nota: motivo?.nota ?? null },
  () => { excluindo.value = null; motivoDaExclusao.value = null })
const liberar = (e, libera) => gravar('vessel_stylist_etapa_liberar_private_edit', { p_id: e.id, p_libera: libera })

// ── os motivos de cada saída (24/09/2026) ─────────────────────────────────
const motivosAbertos = ref(null)
const mexendoMotivo = ref(null)
const nomeDoMotivo = ref('')
const motivoNovo = reactive({ nome: '', exigeNota: false })
const motivosEmOrdem = (e) => [...motivosAtivos(e), ...(e.motivos || []).filter((m) => m.ativo === false)]
function abrirMotivo(m) { mexendoMotivo.value = m.id; nomeDoMotivo.value = m.nome }
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
/* 24/09/2026: o interruptor "Libera Private Edit" e os motivos de cada saída. */
.cv-etapa-liberar { display: flex; flex-wrap: wrap; align-items: center; gap: var(--sp-2); }
.cv-interruptor { display: inline-flex; align-items: center; gap: var(--sp-2); }
.cv-interruptor-trilho {
  width: 34px; height: 20px; border-radius: 10px; border: 1px solid var(--border); background: var(--surface2);
  position: relative; flex: 0 0 34px; transition: background .15s;
}
.cv-interruptor-bolinha {
  position: absolute; top: 2px; left: 2px; width: 14px; height: 14px; border-radius: 50%; background: var(--muted); transition: left .15s;
}
.cv-interruptor.ligado .cv-interruptor-trilho { background: color-mix(in srgb, var(--situacao-viva) 30%, var(--surface)); border-color: var(--situacao-viva); }
.cv-interruptor.ligado .cv-interruptor-bolinha { left: 16px; background: var(--situacao-viva); }
.cv-motivos-da-saida { display: flex; flex-direction: column; gap: var(--sp-2); }
.cv-motivos-da-saida > .btn { align-self: flex-start; }
.cv-motivos-lista { list-style: decimal; margin: 0; padding-left: var(--sp-5); display: flex; flex-direction: column; gap: var(--sp-2); }
.cv-motivo { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--sp-2); }
.cv-motivo > .cv-campo, .cv-motivo > .cv-acoes { flex: 1 1 100%; }
.cv-motivo-nome { margin: 0; color: var(--text); font-size: var(--texto-corpo); overflow-wrap: anywhere; flex: 1 1 12rem; }
.cv-motivo-fora .cv-motivo-nome { color: var(--muted); }
.cv-marcar { display: flex; align-items: center; gap: var(--sp-2); font-size: var(--texto-corpo); color: var(--text); min-height: 40px; }
.cv-marcar input { width: 20px; height: 20px; }
</style>
