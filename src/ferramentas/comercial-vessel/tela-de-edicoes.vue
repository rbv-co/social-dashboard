<template>
  <div class="tela-edicoes id-ferramenta">
    <barra-de-topo :voltar="ROTULO_DO_PAI[paiDaTela('edicoes')]"
                   titulo="Vessel — Edições"
                   :subtitulo="subtitulo" @voltar="voltar" />

    <div class="cv-largo cv-body">
      <faixa-de-erro :erro="erroPracas" @tentar-de-novo="carregarPracas" />

      <!-- ── ESCOLHER A PRAÇA ────────────────────────────────────────────── -->
      <section class="cv-bloco">
        <h2 class="cv-etiqueta id-titulo"><icone-do-bloco nome="etiqueta" />A praça</h2>
        <div v-if="carregandoPracas" class="cv-carregando">Carregando…</div>
        <template v-else-if="!erroPracas">
          <p v-if="!pracas.length" class="cv-vazio">
            Nenhuma praça cadastrada ainda.
            <button v-if="podeAbrir('pracas')" type="button" class="btn id-btn-editar" @click="irParaPracas">
              <icone-do-bloco nome="etiqueta" />Ir para Praças</button>
          </p>
          <label v-else class="cv-campo" for="edicoes-praca"><span>Praça</span>
            <select id="edicoes-praca" v-model="pracaSelecionadaId">
              <option v-for="p in pracas" :key="p.id" :value="p.id">{{ rotuloDaPraca(p) }}</option>
            </select></label>
        </template>
      </section>

      <!-- ── AS EDIÇÕES DA PRAÇA ESCOLHIDA ───────────────────────────────── -->
      <section v-if="pracaSelecionadaId" class="cv-bloco">
        <h2 class="cv-etiqueta id-titulo"><icone-do-bloco nome="calendario" />Edições</h2>
        <p v-if="!podeEditar" class="cv-nota cv-nota-primeira">Você pode ver as edições. Para mexer, precisa da permissão de editar.</p>
        <faixa-de-erro :erro="erroEdicoes" @tentar-de-novo="carregarEdicoes" />

        <div v-if="carregandoEdicoes" class="cv-carregando">Carregando…</div>
        <p v-else-if="!erroEdicoes && !edicoes.length" class="cv-vazio">Esta praça ainda não tem edição.</p>

        <ul v-else-if="!erroEdicoes" class="ed-lista">
          <li v-for="e in edicoes" :key="e.id" class="cv-bloco ed-edicao">
            <div class="cv-cabeca">
              <div class="cv-cabeca-texto">
                <h3 class="ed-titulo">{{ rotuloDaEdicao(e) }}<span v-if="e.nome"> — {{ e.nome }}</span></h3>
                <p class="cv-sub">{{ dataDoEvento(e) }} · {{ quantasConvidadas(e.stylists) }}<span
                   v-if="e.indisponiveis"> · Indisponíveis na data: {{ e.indisponiveis }}</span></p>
              </div>
              <span class="selo" :class="corDaSituacao(e.situacao)">{{ SITUACOES_DA_EDICAO[e.situacao] || e.situacao }}</span>
            </div>

            <p v-if="erroDaEdicao(e.id)" class="cv-nota cv-nota-erro">{{ erroDaEdicao(e.id) }}</p>

            <div v-if="encerrando !== e.id" class="cv-acoes">
              <button v-if="escolhidaId !== e.id" type="button" class="btn" @click="escolher(e)">
                <icone-do-bloco nome="placar" />Ver o evento</button>
              <button v-if="podeEditar && e.situacao === 'planejada'" type="button" class="btn id-btn-editar"
                      :disabled="gravando" @click="abrir(e)">
                <icone-do-bloco nome="reabrir" />{{ gravando ? 'Abrindo…' : 'Abrir' }}</button>
              <button v-if="podeEditar && e.situacao === 'aberta'" type="button" class="btn id-btn-parar"
                      :disabled="gravando" @click="abrirEncerrar(e)">
                <icone-do-bloco nome="parar" />Encerrar…</button>
            </div>

            <!-- ⚠️ ENCERRAR SÓ PARA DE ACEITAR CONVIDADA (28/09/2026): ninguém é
                 levado para outra edição, ninguém muda de etapa, e o placar
                 continua somando os Private Edits de quem veio por este
                 evento. O aviso diz isso ANTES de confirmar. -->
            <div v-if="encerrando === e.id" class="id-caixa-form">
              <p class="cv-nota cv-nota-aviso cv-nota-primeira">
                Para de aceitar convidadas. A turma fica como está, ninguém muda de etapa, e o placar
                continua somando os Private Edits de quem veio por este evento.
              </p>
              <div class="cv-acoes">
                <button type="button" class="btn" :disabled="gravando" @click="encerrando = null">Cancelar</button>
                <button type="button" class="btn id-btn-perigo btn-perigo" :disabled="gravando" @click="encerrar(e)">
                  <icone-do-bloco nome="parar" />{{ gravando ? 'Encerrando…' : 'Encerrar' }}</button>
              </div>
            </div>

            <p v-if="resultadoPorEdicao[e.id]" class="cv-nota cv-nota-ok" role="status">{{ resultadoPorEdicao[e.id] }}</p>

            <!-- ── O EVENTO ESCOLHIDO: o placar em cima (responde "o evento deu
                 certo?"), a turma embaixo. Um evento aberto por vez — cada um
                 custa duas leituras ao banco. ───────────────────────────────── -->
            <template v-if="escolhidaId === e.id">
              <div class="id-grupo cv-grupo-parceiras">
                <h4 class="cv-etiqueta cv-etiqueta-interna id-titulo"><icone-do-bloco nome="placar" />O evento deu certo?</h4>
                <p v-if="erroDoPlacar" class="cv-nota cv-nota-erro">{{ erroDoPlacar }}</p>
                <div v-else-if="carregandoPlacar || !placar" class="cv-carregando">Carregando o placar…</div>
                <template v-else>
                  <div class="cv-numeros cv-numeros-placar">
                    <div v-for="p in placar.funil || []" :key="p.chave" class="cv-numero" :data-passo="p.chave">
                      <span class="cv-numero-valor">{{ p.n }}</span>
                      <span class="cv-numero-rotulo">{{ p.rotulo }}</span>
                      <span v-if="baseDoPasso(p)" class="cv-numero-base">{{ baseDoPasso(p) }}</span>
                    </div>
                    <div class="cv-numero" data-passo="meta">
                      <span class="cv-numero-valor">{{ meta.valor }}</span>
                      <span class="cv-numero-rotulo">Meta do Growth Plan</span>
                      <span class="cv-numero-base">presentes que agendaram Private Edit</span>
                      <meta-do-numero :meta="meta" />
                    </div>
                  </div>
                  <p class="cv-nota">
                    <b>Indisponíveis na data: {{ placar.indisponiveis || 0 }}</b> — seguem contadas em
                    convidadas, ficam fora de presentes e não pesam na meta. Voltam como convidadas quando a
                    próxima edição desta praça abrir.
                  </p>
                  <p class="cv-nota">
                    Cada passo mostra a % sobre o passo anterior. <b>Agendaram, fizeram e repetiram</b> contam
                    só quem esteve presente e tem ESTE evento como origem (a 1ª presença dela) — em qualquer
                    data, mesmo depois de encerrar: o placar nunca fecha, e nada conta em dois eventos.
                  </p>
                </template>
              </div>

              <div class="id-grupo cv-grupo-parceiras">
                <h4 class="cv-etiqueta cv-etiqueta-interna id-titulo"><icone-do-bloco nome="parceiras" />A turma</h4>
                <p v-if="erroDaTurma" class="cv-nota cv-nota-erro">{{ erroDaTurma }}</p>
                <div v-else-if="carregandoTurma" class="cv-carregando">Carregando a turma…</div>
                <p v-else-if="!turma.length" class="cv-vazio">
                  Ninguém na turma ainda. Quem for movida para Convidado no quadro do Stylist Circle, com esta
                  edição aberta, entra sozinha.
                </p>
                <ul v-else class="cv-historico ed-turma">
                  <li v-for="l in turma" :key="l.stylist_id">
                    <p class="ed-nome">{{ l.nome }}</p>
                    <p class="cv-sub"><span class="cv-codigo">{{ l.codigo }}</span></p>
                    <div class="ed-marcas">
                      <span v-for="m in marcasDaLinha(l)" :key="m.chave" class="cv-selo id-selo ed-marca"
                            :class="m.feita ? 'id-tom-viva' : 'id-tom-parada'">{{ m.texto }}</span>
                      <span v-if="l.indisponivel_em" class="cv-selo id-selo ed-marca id-tom-queda">Indisponível na data</span>
                    </div>
                    <p v-if="l.presente_em && l.origem != null && l.origem !== e.id" class="cv-sub">
                      Os Private Edits dela contam no evento em que esteve presente primeiro, não neste.</p>
                    <template v-if="podeEditar && !l.presente_em">
                      <div v-if="tirando !== l.codigo" class="cv-acoes">
                        <button type="button" class="btn" :disabled="gravando" @click="tirando = l.codigo">Tirar…</button>
                      </div>
                      <div v-else class="id-caixa-form">
                        <p class="cv-nota cv-nota-aviso cv-nota-primeira">
                          Tirar {{ l.nome }} da turma? É para engano de inclusão — a etapa dela não muda.</p>
                        <div class="cv-acoes">
                          <button type="button" class="btn" :disabled="gravando" @click="tirando = null">Cancelar</button>
                          <button type="button" class="btn id-btn-perigo btn-perigo" :disabled="gravando"
                                  @click="tirar(e, l)">{{ gravando ? 'Tirando…' : 'Tirar' }}</button>
                        </div>
                      </div>
                    </template>
                  </li>
                </ul>
                <p v-if="erroDaTurmaAcao" class="cv-nota cv-nota-erro">{{ erroDaTurmaAcao }}</p>
                <p v-if="avisoDaTurma" class="cv-nota cv-nota-ok" role="status">{{ avisoDaTurma }}</p>

                <!-- ── INCLUIR (exceções): quem entra fora do quadro — outra
                     praça, contato manual. Só com a edição ABERTA: planejada
                     ainda não aceita convidada, encerrada já parou. ──────────── -->
                <template v-if="podeEditar">
                  <div v-if="e.situacao === 'aberta'" class="id-caixa-form">
                    <h5 class="cv-etiqueta cv-etiqueta-interna id-titulo"><icone-do-bloco nome="novo" />Incluir na turma</h5>
                    <div class="cv-form">
                      <label class="cv-campo cv-campo-largo" :for="`ed-incluir-${e.id}`"><span>Código da stylist</span>
                        <input :id="`ed-incluir-${e.id}`" type="text" maxlength="20" autocomplete="off"
                               :list="`ed-incluir-lista-${e.id}`" placeholder="STY-0000" v-model="codigoParaIncluir"></label>
                      <datalist :id="`ed-incluir-lista-${e.id}`">
                        <option v-for="s in paraIncluir" :key="s.codigo" :value="s.codigo">{{ s.nome }}{{ s.cidade ? ` · ${s.cidade}` : '' }}</option>
                      </datalist>
                    </div>
                    <p v-if="erroDasStylists" class="cv-nota">{{ erroDasStylists }}</p>
                    <div class="cv-acoes">
                      <button type="button" class="btn id-btn-principal btn-principal"
                              :disabled="gravando || !codigoParaIncluir.trim()" @click="incluir(e)">
                        <icone-do-bloco nome="novo" />{{ gravando ? 'Incluindo…' : 'Incluir' }}</button>
                    </div>
                  </div>
                  <p v-else-if="e.situacao === 'planejada'" class="cv-nota">Abra a edição para incluir convidadas.</p>
                  <p v-else class="cv-nota">Edição encerrada: não aceita convidada nova.</p>
                </template>
              </div>
            </template>
          </li>
        </ul>

        <!-- ── criar edição nova ─────────────────────────────────────────── -->
        <div v-if="podeEditar" class="id-caixa-form">
          <h3 class="cv-etiqueta cv-etiqueta-interna id-titulo"><icone-do-bloco nome="novo" />Nova edição</h3>
          <p class="cv-nota cv-nota-primeira">Um evento desta praça ({{ subtitulo }}). Ela nasce planejada: só aceita convidada depois de aberta.</p>
          <div class="cv-form">
            <label class="cv-campo" for="ed-nova-nome"><span>Nome (opcional)</span>
              <input id="ed-nova-nome" type="text" maxlength="80" v-model="novaEdicao.nome"></label>
            <label class="cv-campo" for="ed-nova-data"><span>Data do evento</span>
              <input id="ed-nova-data" type="date" v-model="novaEdicao.dataDoEvento"></label>
          </div>
          <!-- ⚠️ REVISÃO FINAL (MENOR 5): o motivo ESCRITO, nunca só o botão
               cinza (mesma classe e lugar da tela de Praças). -->
          <ul v-if="problemasNovaEdicao.length" class="cv-problemas">
            <li v-for="p in problemasNovaEdicao" :key="p">{{ p }}</li>
          </ul>
          <p v-if="erroNova" class="cv-nota cv-nota-erro">{{ erroNova }}</p>
          <div class="cv-acoes">
            <button type="button" class="btn id-btn-principal btn-principal"
                    :disabled="gravando || problemasNovaEdicao.length > 0" @click="criarEdicao">
              <icone-do-bloco nome="novo" />{{ gravando ? 'Gravando…' : 'Criar edição' }}</button>
          </div>
        </div>
      </section>
    </div>
  </div>
</template>

<script setup>
/* VESSEL — EDIÇÕES: escolhe a praça, lista as edições dela (planejada → aberta
 * → encerrada), cria, abre e encerra (25/09/2026, Task 6).
 *
 * ⚠️ 28/09/2026 — A EDIÇÃO É O EVENTO (Task 4 do plano "edição e evento"):
 *   · criar pede só a DATA DO EVENTO (um dia; a data de fim saiu);
 *   · abrir NÃO puxa mais a praça inteira — só volta quem estava
 *     "Indisponível na data" (`voltaram`);
 *   · encerrar só para de aceitar convidadas (ninguém é levado a outra
 *     edição: `p_levar_para` vai sempre nulo);
 *   · o evento escolhido mostra o PLACAR (o funil, a meta) e a TURMA com as
 *     3 marcas (convidada, confirmou, presente), mais Incluir e Tirar.
 *
 * ⚠️ `ok:true` com `situacao` `sem_mudanca` é SUCESSO (abrir uma edição que já
 * está aberta, incluir quem já está) — nunca vira mensagem de erro.
 *
 * ⚠️ `sbClient`, NUNCA `sb()` — ver o mesmo aviso em tela-de-pracas.vue.
 */
import { ref, reactive, computed, watch, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import BarraDeTopo from '../../compartilhado/barra-de-topo.vue'
import FaixaDeErro from '../../compartilhado/faixa-de-erro.vue'
import IconeDoBloco from '../../compartilhado/icone-do-bloco.vue'
import MetaDoNumero from './meta-do-numero.vue'
import { sbClient } from '../../compartilhado/conectar-no-banco-de-dados.js'
import { classificarErro } from '../../compartilhado/classificar-erro.js'
import { hasPermission, podeAbrir } from '../../compartilhado/controle-de-login-e-usuario.js'
import { paiDaTela, ROTULO_DO_PAI } from './navegacao.js'
import { rotuloDaPraca } from './praca-regras.js'
import { rotuloDaEdicao, SITUACOES_DA_EDICAO, marcasDaLinha, metaDoEvento } from './edicao-regras.js'
import { dataLegivel } from './enderecos-publicos.js'

const router = useRouter()
function voltar() { router.push({ name: paiDaTela('edicoes') }) }
function irParaPracas() { router.push({ name: 'pracas' }) }

const podeEditar = computed(() => hasPermission('atendimentos.edicoes', 'editar'))

async function chamar(funcao, corpo) {
  const { data, error } = await sbClient.rpc(funcao, corpo || {})
  if (error) throw error
  return data
}

// ── as praças (para o seletor) ──────────────────────────────────────────
const pracas = ref([])
const carregandoPracas = ref(true)
const erroPracas = ref(null)
const pracaSelecionadaId = ref(null)

async function carregarPracas() {
  carregandoPracas.value = true
  erroPracas.value = null
  try {
    const { data, error } = await sbClient.rpc('vessel_pracas_listar')
    if (error) throw error
    pracas.value = data || []
    if (!pracaSelecionadaId.value && pracas.value.length) pracaSelecionadaId.value = pracas.value[0].id
  } catch (e) {
    pracas.value = []
    erroPracas.value = classificarErro(e?.status, e)
  } finally {
    carregandoPracas.value = false
  }
}
onMounted(carregarPracas)

const subtitulo = computed(() => {
  if (carregandoPracas.value || erroPracas.value) return ''
  const p = pracas.value.find((x) => x.id === pracaSelecionadaId.value)
  return p ? rotuloDaPraca(p) : ''
})

// ── as edições da praça escolhida ───────────────────────────────────────
const edicoes = ref([])
const carregandoEdicoes = ref(true)
const erroEdicoes = ref(null)
const gravando = ref(false)

// ⚠️ Declarados AQUI (antes do `watch(..., {immediate:true})` mais abaixo,
// que já chama `carregarEdicoes` de forma síncrona) — de propósito:
// `limparResultadosPorEdicao` os referencia, e uma `const` declarada só depois
// estouraria "Cannot access before initialization" ainda durante o `setup()`.
// erro por edição, para o defeito de uma não atrapalhar as outras
const errosPorEdicao = reactive({})
// a frase do que acabou de acontecer (abrir/encerrar), por edição
const resultadoPorEdicao = reactive({})
// o evento aberto na tela (placar + turma): um por vez
const escolhidaId = ref(null)

// ⚠️ RODADA 1 DE CONSERTO (MENOR c): trocar de praça (ou recarregar) limpa as
// frases por edição — as chaves são por `id`, e a de uma edição de OUTRA
// praça ficaria pendurada.
function limparResultadosPorEdicao() {
  for (const k of Object.keys(errosPorEdicao)) delete errosPorEdicao[k]
  for (const k of Object.keys(resultadoPorEdicao)) delete resultadoPorEdicao[k]
}

async function carregarEdicoes({ manterResultados = false } = {}) {
  if (!manterResultados) limparResultadosPorEdicao()
  // ⚠️ RODADA 1 DE CONSERTO (MENOR 6): sem praça escolhida, "Carregando…"
  // ficava para sempre (o valor inicial do ref).
  if (!pracaSelecionadaId.value) { edicoes.value = []; carregandoEdicoes.value = false; return }
  carregandoEdicoes.value = true
  erroEdicoes.value = null
  try {
    const { data, error } = await sbClient.rpc('vessel_edicoes_listar', { p_praca_id: pracaSelecionadaId.value })
    if (error) throw error
    edicoes.value = data || []
    // O evento que abre sozinho: o que estava aberto na tela (se ainda é
    // desta praça), senão a edição ABERTA, senão a mais recente.
    if (!edicoes.value.some((e) => e.id === escolhidaId.value)) {
      const padrao = edicoes.value.find((e) => e.situacao === 'aberta') || edicoes.value[0] || null
      escolhidaId.value = padrao ? padrao.id : null
    }
  } catch (e) {
    edicoes.value = []
    escolhidaId.value = null
    erroEdicoes.value = classificarErro(e?.status, e)
  } finally {
    carregandoEdicoes.value = false
  }
}
watch(pracaSelecionadaId, () => carregarEdicoes(), { immediate: true })

const quantasConvidadas = (n) => (n === 1 ? '1 convidada' : `${n || 0} convidadas`)
const dataDoEvento = (e) => (e.comeca_em ? `Data do evento: ${dataLegivel(e.comeca_em)}` : 'Sem data do evento')
function corDaSituacao(s) {
  if (s === 'aberta') return 'selo-ok'
  if (s === 'encerrada') return 'selo-neutro'
  return 'selo-info' // planejada
}

function mensagemEdicao(r) {
  const s = r?.situacao
  if (s === 'sem_permissao') return 'Você não tem permissão para mexer nas Edições.'
  if (s === 'praca_invalida') return 'Praça inválida.'
  if (s === 'sem_data') return 'Escolha a data do evento.'
  if (s === 'nao_achei') return 'Não achei — pode ter sido removida por outra pessoa. Confira o código.'
  if (s === 'edicao_encerrada') return 'Essa edição já está encerrada: não aceita convidada nova.'
  if (s === 'ja_tem_aberta') return 'Esta praça já tem uma edição aberta — encerre-a antes de abrir outra.'
  if (s === 'edicao_invalida') return 'Edição inválida.'
  if (s === 'ja_esteve_presente') return 'Ela já esteve presente neste evento — presença não se desfaz, e ela fica na turma.'
  return 'Não consegui gravar agora. Tente de novo em um instante.'
}

const erroDaEdicao = (id) => errosPorEdicao[id] || ''

// ⚠️ ABRIR SÓ MUDA A SITUAÇÃO — e traz de volta, como Convidado, quem estava
// "Indisponível na data" nesta praça (o número REAL que o banco devolve).
function fraseDaAbertura(voltaram) {
  if (!voltaram) return 'Edição aberta: aceita convidadas. Quem for movida para Convidado entra na turma.'
  return voltaram === 1
    ? 'Edição aberta. 1 parceira que estava indisponível na data voltou como convidada.'
    : `Edição aberta. ${voltaram} parceiras que estavam indisponíveis na data voltaram como convidadas.`
}

async function abrir(e) {
  if (gravando.value) return
  gravando.value = true
  errosPorEdicao[e.id] = ''
  try {
    const r = await chamar('vessel_edicao_abrir', { p_id: e.id })
    if (!r?.ok) { errosPorEdicao[e.id] = mensagemEdicao(r); return }
    await carregarEdicoes()
    // ⚠️ só na transição REAL ('ok') — 'sem_mudanca' (já estava aberta) não trouxe ninguém.
    if (r.situacao === 'ok') resultadoPorEdicao[e.id] = fraseDaAbertura(r.voltaram ?? 0)
    mostrarEvento(e.id)
  } catch {
    errosPorEdicao[e.id] = 'Não consegui falar com o banco agora. Tente de novo em um instante.'
  } finally {
    gravando.value = false
  }
}

const encerrando = ref(null)
function abrirEncerrar(e) { encerrando.value = e.id; errosPorEdicao[e.id] = '' }
async function encerrar(e) {
  if (gravando.value) return
  gravando.value = true
  errosPorEdicao[e.id] = ''
  try {
    const r = await chamar('vessel_edicao_encerrar', { p_id: e.id, p_levar_para: null })
    if (!r?.ok) { errosPorEdicao[e.id] = mensagemEdicao(r); return }
    encerrando.value = null
    await carregarEdicoes()
    resultadoPorEdicao[e.id] = 'Edição encerrada: parou de aceitar convidadas. O placar continua somando.'
    mostrarEvento(e.id)
  } catch {
    errosPorEdicao[e.id] = 'Não consegui falar com o banco agora. Tente de novo em um instante.'
  } finally {
    gravando.value = false
  }
}

// ── o evento escolhido: placar + turma ──────────────────────────────────
const placar = ref(null)
const carregandoPlacar = ref(false)
const erroDoPlacar = ref('')
const turma = ref([])
const carregandoTurma = ref(false)
const erroDaTurma = ref('')
const erroDaTurmaAcao = ref('')
const avisoDaTurma = ref('')
const tirando = ref(null)
const codigoParaIncluir = ref('')

const meta = computed(() => metaDoEvento(placar.value?.meta))
// "Cada passo sobre o anterior" escrito por extenso: "75% das convidadas".
function baseDoPasso(p) {
  const passos = placar.value?.funil || []
  const i = passos.findIndex((x) => x.chave === p.chave)
  if (i <= 0) return ''
  if (p.pct == null) return 'sem base ainda'
  return `${p.pct}% das que ${ANTERIOR[passos[i - 1].chave] || passos[i - 1].rotulo.toLowerCase()}`
}
const ANTERIOR = { convidadas: 'foram convidadas', confirmaram: 'confirmaram', presentes: 'estiveram presentes',
  agendaram: 'agendaram', fizeram: 'fizeram' }

// ⚠️ A TELA NUNCA MENTE (PADRAO, item 9): leitura que falhou escreve o
// motivo — nunca vira turma vazia nem placar zerado. O placar é do Stylist
// Circle (`vessel_placar_da_edicao` pede a permissão de ver o Stylist
// Circle): quem só tem Edições lê a turma e vê o motivo no lugar do placar.
function mensagemDeLeitura(e, oQue) {
  if (e?.code === '42501') return `Para ver ${oQue}, falta a permissão de ver o Stylist Circle.`
  return `Não consegui ler ${oQue} agora. Tente de novo em um instante.`
}

let pedidoDoEvento = 0
async function carregarEvento() {
  const id = escolhidaId.value
  const meu = ++pedidoDoEvento
  tirando.value = null
  erroDaTurmaAcao.value = ''
  if (!id) { placar.value = null; turma.value = []; return }
  carregandoPlacar.value = true
  carregandoTurma.value = true
  erroDoPlacar.value = ''
  erroDaTurma.value = ''
  const [p, t] = await Promise.allSettled([
    chamar('vessel_placar_da_edicao', { p_edicao_id: id }),
    chamar('vessel_edicao_turma', { p_edicao_id: id }),
  ])
  // ⚠️ Trocou de evento no meio da leitura: a resposta velha não pinta o novo.
  if (meu !== pedidoDoEvento) return
  if (p.status === 'fulfilled') placar.value = p.value
  else { placar.value = null; erroDoPlacar.value = mensagemDeLeitura(p.reason, 'o placar') }
  if (t.status === 'fulfilled') turma.value = t.value || []
  else { turma.value = []; erroDaTurma.value = mensagemDeLeitura(t.reason, 'a turma') }
  carregandoPlacar.value = false
  carregandoTurma.value = false
}
watch(escolhidaId, () => { avisoDaTurma.value = ''; codigoParaIncluir.value = ''; carregarEvento() })

function escolher(e) { escolhidaId.value = e.id }
// Depois de abrir/encerrar: mostra ESTE evento, relido (a situação e a turma
// mudaram). Trocar o escolhido já relê pelo `watch`; o mesmo, relê aqui.
function mostrarEvento(id) {
  if (escolhidaId.value === id) carregarEvento()
  else escolhidaId.value = id
}

// A lista para o "Incluir" (quem ainda não está na turma), de TODAS as
// praças — a exceção costuma ser justamente de outra praça. É só ajuda: sem
// ela, digitar o código funciona igual.
const stylistsParaIncluir = ref([])
const erroDasStylists = ref('')
let stylistsLidas = false
async function carregarStylistsParaIncluir() {
  if (stylistsLidas || !podeEditar.value) return
  stylistsLidas = true
  try {
    stylistsParaIncluir.value = await chamar('vessel_rastreio_dos_stylists', { p_dias: 7 }) || []
  } catch {
    stylistsLidas = false
    erroDasStylists.value = 'Não consegui ler a lista de stylists — digite o código dela (STY-…).'
  }
}
watch(escolhidaId, carregarStylistsParaIncluir, { immediate: true })
const paraIncluir = computed(() => {
  const dentro = new Set(turma.value.map((l) => l.codigo))
  return stylistsParaIncluir.value.filter((s) => !dentro.has(s.codigo))
})

async function incluir(e) {
  const codigo = codigoParaIncluir.value.trim().toUpperCase()
  if (gravando.value || !codigo) return
  gravando.value = true
  erroDaTurmaAcao.value = ''
  avisoDaTurma.value = ''
  try {
    const r = await chamar('vessel_edicao_incluir_stylist', { p_codigo: codigo, p_edicao_id: e.id })
    if (!r?.ok) { erroDaTurmaAcao.value = mensagemEdicao(r); return }
    codigoParaIncluir.value = ''
    avisoDaTurma.value = r.situacao === 'sem_mudanca' ? `${codigo} já estava na turma.` : `${codigo} entrou na turma como convidada.`
    await Promise.all([carregarEvento(), carregarEdicoes({ manterResultados: true })])
  } catch {
    erroDaTurmaAcao.value = 'Não consegui falar com o banco agora. Tente de novo em um instante.'
  } finally {
    gravando.value = false
  }
}

async function tirar(e, l) {
  if (gravando.value) return
  gravando.value = true
  erroDaTurmaAcao.value = ''
  avisoDaTurma.value = ''
  try {
    const r = await chamar('vessel_edicao_tirar_stylist', { p_codigo: l.codigo, p_edicao_id: e.id })
    if (!r?.ok) { erroDaTurmaAcao.value = mensagemEdicao(r); return }
    tirando.value = null
    avisoDaTurma.value = `${l.nome} saiu da turma.`
    await Promise.all([carregarEvento(), carregarEdicoes({ manterResultados: true })])
  } catch {
    erroDaTurmaAcao.value = 'Não consegui falar com o banco agora. Tente de novo em um instante.'
  } finally {
    gravando.value = false
  }
}

// ── criar edição ─────────────────────────────────────────────────────────
const novaEdicao = reactive({ nome: '', dataDoEvento: '' })
const erroNova = ref('')
// ⚠️ REVISÃO FINAL (MENOR 5): o motivo ESCRITO, nunca só o botão cinza.
const problemasNovaEdicao = computed(() => (novaEdicao.dataDoEvento ? [] : ['Escolha a data do evento.']))
async function criarEdicao() {
  if (gravando.value || problemasNovaEdicao.value.length) return
  gravando.value = true
  erroNova.value = ''
  try {
    // ⚠️ A edição é um evento de UM dia: o fim vai sempre nulo (o banco ignora).
    const r = await chamar('vessel_edicao_criar', {
      p_praca_id: pracaSelecionadaId.value, p_nome: novaEdicao.nome || null,
      p_comeca_em: novaEdicao.dataDoEvento, p_termina_em: null,
    })
    if (!r?.ok) { erroNova.value = mensagemEdicao(r); return }
    Object.assign(novaEdicao, { nome: '', dataDoEvento: '' })
    await carregarEdicoes()
  } catch {
    erroNova.value = 'Não consegui falar com o banco agora. Tente de novo em um instante.'
  } finally {
    gravando.value = false
  }
}
</script>

<style scoped>
@import './estilo-comercial.css';
@import '../../estilos/identidade-da-ferramenta.css';

.ed-lista { list-style: none; margin: var(--sp-3) 0 0; padding: 0; display: flex; flex-direction: column; gap: var(--sp-3); }
.ed-edicao { margin-top: 0; }
.ed-titulo, .ed-nome {
  font-family: var(--fonte-principal); font-size: var(--texto-campo); color: var(--text);
  margin: 0; overflow-wrap: anywhere;
}
.ed-turma { margin-top: var(--sp-3); gap: var(--sp-3); }
.ed-marcas { display: flex; flex-wrap: wrap; gap: var(--sp-1); margin-top: var(--sp-1); }
/* ⚠️ `.cv-selo` tem `nowrap`: "Indisponível na data" numa coluna de 375px passaria da borda. */
.ed-marca { white-space: normal; overflow-wrap: anywhere; max-width: 100%; }
</style>
