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
                <p class="cv-sub">{{ janelaEscrita(e) }} · {{ quantasStylists(e.stylists) }}</p>
              </div>
              <span class="selo" :class="corDaSituacao(e.situacao)">{{ SITUACOES_DA_EDICAO[e.situacao] || e.situacao }}</span>
            </div>

            <p v-if="erroDaEdicao(e.id)" class="cv-nota cv-nota-erro">{{ erroDaEdicao(e.id) }}</p>

            <div v-if="podeEditar && e.situacao === 'planejada' && encerrando !== e.id" class="cv-acoes">
              <button type="button" class="btn id-btn-editar" :disabled="gravando" @click="abrir(e)">
                <icone-do-bloco nome="reabrir" />{{ gravando ? 'Abrindo…' : 'Abrir edição' }}</button>
            </div>

            <div v-if="podeEditar && e.situacao === 'aberta' && encerrando !== e.id" class="cv-acoes">
              <button type="button" class="btn id-btn-parar" :disabled="gravando" @click="abrirEncerrar(e)">
                <icone-do-bloco nome="parar" />Encerrar…</button>
            </div>

            <!-- ⚠️ ANTES DE CONFIRMAR: pergunta o destino de quem não ativou e
                 diz QUANTAS serão levadas — o número REAL (`nao_ativadas`,
                 vessel_edicoes_listar seção 14), não um teto: o critério é o
                 MESMO de `vessel_edicao_encerrar` (quem ainda não ativou). -->
            <div v-if="encerrando === e.id" class="id-caixa-form">
              <p class="cv-nota cv-nota-aviso cv-nota-primeira">
                {{ fraseDeQuantasVao(e) }} Quem já ativou fica com o vínculo fechado aqui, e não vai.
              </p>
              <label class="cv-campo" :for="`ed-destino-${e.id}`"><span>Levar quem não ativou para</span>
                <select :id="`ed-destino-${e.id}`" v-model="destino">
                  <option value="">Não levar (sem destino)</option>
                  <option v-for="d in destinosPossiveis(e)" :key="d.id" :value="String(d.id)">{{ rotuloDaEdicao(d) }}</option>
                </select></label>
              <div class="cv-acoes">
                <button type="button" class="btn" :disabled="gravando" @click="encerrando = null">Cancelar</button>
                <button type="button" class="btn id-btn-perigo btn-perigo" :disabled="gravando" @click="encerrar(e)">
                  <icone-do-bloco nome="parar" />{{ gravando ? 'Encerrando…' : 'Encerrar a edição' }}</button>
              </div>
            </div>

            <!-- ⚠️ RODADA 1 DE CONSERTO (MENOR 3): a frase depende de ter
                 havido destino escolhido — "N foram levadas PARA X" não pode
                 aparecer quando ninguém escolheu X. -->
            <p v-if="resultadoDoEncerramento[e.id]" class="cv-nota cv-nota-ok">{{ fraseDoResultado(resultadoDoEncerramento[e.id]) }}</p>
          </li>
        </ul>

        <!-- ── criar edição nova ─────────────────────────────────────────── -->
        <div v-if="podeEditar" class="id-caixa-form">
          <h3 class="cv-etiqueta cv-etiqueta-interna id-titulo"><icone-do-bloco nome="novo" />Nova edição</h3>
          <div class="cv-form">
            <label class="cv-campo" for="ed-nova-nome"><span>Nome (opcional)</span>
              <input id="ed-nova-nome" type="text" maxlength="80" v-model="novaEdicao.nome"></label>
            <label class="cv-campo" for="ed-nova-comeca"><span>Começa em</span>
              <input id="ed-nova-comeca" type="date" v-model="novaEdicao.comecaEm"></label>
            <label class="cv-campo" for="ed-nova-termina"><span>Termina em (opcional)</span>
              <input id="ed-nova-termina" type="date" v-model="novaEdicao.terminaEm"></label>
          </div>
          <p v-if="erroNova" class="cv-nota cv-nota-erro">{{ erroNova }}</p>
          <div class="cv-acoes">
            <button type="button" class="btn id-btn-principal btn-principal"
                    :disabled="gravando || !novaEdicao.comecaEm" @click="criarEdicao">
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
 * ⚠️ SÓ EDIÇÕES DA MESMA PRAÇA aparecem como destino ao encerrar: a lista já
 * vem recortada por `pracaSelecionadaId` (o banco recusaria outra praça com
 * `destino_de_outra_praca`, mas a tela nem oferece a escolha errada).
 *
 * ⚠️ `ok:true` com `situacao` `sem_mudanca` é SUCESSO (abrir uma edição que já
 * está aberta) — nunca vira mensagem de erro.
 *
 * ⚠️ `sbClient`, NUNCA `sb()` — ver o mesmo aviso em tela-de-pracas.vue.
 */
import { ref, reactive, computed, watch, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import BarraDeTopo from '../../compartilhado/barra-de-topo.vue'
import FaixaDeErro from '../../compartilhado/faixa-de-erro.vue'
import IconeDoBloco from '../../compartilhado/icone-do-bloco.vue'
import { sbClient } from '../../compartilhado/conectar-no-banco-de-dados.js'
import { classificarErro } from '../../compartilhado/classificar-erro.js'
import { hasPermission, podeAbrir } from '../../compartilhado/controle-de-login-e-usuario.js'
import { paiDaTela, ROTULO_DO_PAI } from './navegacao.js'
import { rotuloDaPraca } from './praca-regras.js'
import { rotuloDaEdicao, SITUACOES_DA_EDICAO } from './edicao-regras.js'

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

async function carregarEdicoes() {
  // ⚠️ RODADA 1 DE CONSERTO (MENOR 6): sem isto, `carregandoEdicoes` ficava
  // travado em `true` (o valor inicial do ref) quando não havia praça
  // escolhida — a tela mostrava "Carregando…" para sempre.
  if (!pracaSelecionadaId.value) { edicoes.value = []; carregandoEdicoes.value = false; return }
  carregandoEdicoes.value = true
  erroEdicoes.value = null
  try {
    const { data, error } = await sbClient.rpc('vessel_edicoes_listar', { p_praca_id: pracaSelecionadaId.value })
    if (error) throw error
    edicoes.value = data || []
  } catch (e) {
    edicoes.value = []
    erroEdicoes.value = classificarErro(e?.status, e)
  } finally {
    carregandoEdicoes.value = false
  }
}
watch(pracaSelecionadaId, carregarEdicoes, { immediate: true })

const quantasStylists = (n) => (n === 1 ? '1 stylist' : `${n || 0} stylists`)
// ⚠️ RODADA 1 DE CONSERTO (IMPORTANTE 3): `nao_ativadas` é o número REAL de
// quem seria levada — não um teto. `e.stylists` (o total) é outra coisa
// (quantas estão na edição, ativadas ou não).
function fraseDeQuantasVao(e) {
  const n = e.nao_ativadas || 0
  if (n === 0) return 'Ninguém nesta edição precisa ser levada — todas já ativaram.'
  return n === 1
    ? '1 parceira ainda não ativou e será levada para a edição escolhida abaixo.'
    : `${n} parceiras ainda não ativaram e serão levadas para a edição escolhida abaixo.`
}
const dia = (d) => (d ? new Date(`${d}T00:00:00`).toLocaleDateString('pt-BR') : '')
function janelaEscrita(e) {
  if (!e.comeca_em) return 'sem data'
  return e.termina_em ? `${dia(e.comeca_em)} a ${dia(e.termina_em)}` : `a partir de ${dia(e.comeca_em)}`
}
function corDaSituacao(s) {
  if (s === 'aberta') return 'selo-ok'
  if (s === 'encerrada') return 'selo-neutro'
  return 'selo-info' // planejada
}
// só edições da MESMA praça, ainda não encerradas, e nunca ela mesma
function destinosPossiveis(e) { return edicoes.value.filter((d) => d.id !== e.id && d.situacao !== 'encerrada') }

function mensagemEdicao(r) {
  const s = r?.situacao
  if (s === 'sem_permissao') return 'Você não tem permissão para mexer nas Edições.'
  if (s === 'praca_invalida') return 'Praça inválida.'
  if (s === 'sem_data') return 'Escolha a data de início.'
  if (s === 'data_invalida') return 'A data de término não pode ser antes da de início.'
  if (s === 'nao_achei') return 'Não achei essa edição — pode ter sido removida por outra pessoa.'
  if (s === 'edicao_encerrada') return 'Essa edição já está encerrada.'
  if (s === 'ja_tem_aberta') return 'Esta praça já tem uma edição aberta — encerre-a antes de abrir outra.'
  if (s === 'destino_invalido') return 'Escolha uma edição de destino válida.'
  if (s === 'destino_de_outra_praca') return 'A edição de destino precisa ser da mesma praça.'
  if (s === 'edicao_invalida') return 'Edição inválida.'
  return 'Não consegui gravar agora. Tente de novo em um instante.'
}

// erro por edição, para o defeito de uma não atrapalhar as outras
const errosPorEdicao = reactive({})
const erroDaEdicao = (id) => errosPorEdicao[id] || ''
// o resultado do encerramento, por edição — { levadas, destinoNome } — para
// escrever a frase certa nos três casos (ninguém escolhido, escolhido mas
// ninguém precisava ir, escolhido e foi gente de verdade).
const resultadoDoEncerramento = reactive({})
function fraseDoResultado({ levadas, destinoNome }) {
  if (!destinoNome) return 'Edição encerrada. Nenhuma edição de destino foi escolhida — ninguém foi levada.'
  if (levadas === 0) return `Edição encerrada. Ninguém precisou ser levada para ${destinoNome} — todas já tinham ativado.`
  return levadas === 1
    ? `Edição encerrada. 1 parceira foi levada para ${destinoNome}.`
    : `Edição encerrada. ${levadas} parceiras foram levadas para ${destinoNome}.`
}

async function abrir(e) {
  if (gravando.value) return
  gravando.value = true
  errosPorEdicao[e.id] = ''
  try {
    const r = await chamar('vessel_edicao_abrir', { p_id: e.id })
    if (!r?.ok) { errosPorEdicao[e.id] = mensagemEdicao(r); return }
    await carregarEdicoes()
  } catch {
    errosPorEdicao[e.id] = 'Não consegui falar com o banco agora. Tente de novo em um instante.'
  } finally {
    gravando.value = false
  }
}

const encerrando = ref(null)
const destino = ref('')
function abrirEncerrar(e) { encerrando.value = e.id; destino.value = ''; errosPorEdicao[e.id] = '' }
async function encerrar(e) {
  if (gravando.value) return
  gravando.value = true
  errosPorEdicao[e.id] = ''
  try {
    // ⚠️ O nome do destino é lido ANTES de gravar (para a frase) — depois de
    // `carregarEdicoes()` a lista pode ter mudado de ordem/situação.
    const destinoEscolhido = destino.value ? edicoes.value.find((d) => String(d.id) === destino.value) : null
    const r = await chamar('vessel_edicao_encerrar', { p_id: e.id, p_levar_para: destino.value ? Number(destino.value) : null })
    if (!r?.ok) { errosPorEdicao[e.id] = mensagemEdicao(r); return }
    resultadoDoEncerramento[e.id] = { levadas: r.levadas ?? 0, destinoNome: destinoEscolhido ? rotuloDaEdicao(destinoEscolhido) : null }
    encerrando.value = null
    await carregarEdicoes()
  } catch {
    errosPorEdicao[e.id] = 'Não consegui falar com o banco agora. Tente de novo em um instante.'
  } finally {
    gravando.value = false
  }
}

// ── criar edição ─────────────────────────────────────────────────────────
const novaEdicao = reactive({ nome: '', comecaEm: '', terminaEm: '' })
const erroNova = ref('')
async function criarEdicao() {
  if (gravando.value || !novaEdicao.comecaEm) return
  gravando.value = true
  erroNova.value = ''
  try {
    const r = await chamar('vessel_edicao_criar', {
      p_praca_id: pracaSelecionadaId.value, p_nome: novaEdicao.nome || null,
      p_comeca_em: novaEdicao.comecaEm, p_termina_em: novaEdicao.terminaEm || null,
    })
    if (!r?.ok) { erroNova.value = mensagemEdicao(r); return }
    Object.assign(novaEdicao, { nome: '', comecaEm: '', terminaEm: '' })
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
.ed-titulo {
  font-family: var(--fonte-principal); font-size: var(--texto-campo); color: var(--text);
  margin: 0; overflow-wrap: anywhere;
}
</style>
