<template>
  <div class="tela-pe">
    <barra-de-topo :voltar="ROTULO_DO_PAI[paiDaTela('private-edit')]"
                   titulo="Vessel — Private Edit"
                   :subtitulo="subtitulo" @voltar="voltar" />

    <div class="container-app cv-body">
      <faixa-de-erro :erro="erro" @tentar-de-novo="carregar" />

      <!-- ── CRIAR ──────────────────────────────────────────────────────── -->
      <section class="cv-bloco">
        <h2 class="cv-etiqueta">Marcar um encontro</h2>
        <div class="cv-form">
          <label class="cv-campo cv-campo-largo" for="pe-stylist"><span>Anfitriã</span>
            <select id="pe-stylist" v-model="novo.stylist">
              <option value="">Escolha a stylist…</option>
              <option v-for="s in stylists" :key="s.codigo" :value="s.codigo">
                {{ s.codigo }} — {{ s.nome }}<span v-if="s.cidade"> · {{ s.cidade }}</span>
              </option>
            </select></label>
          <label class="cv-campo" for="pe-quando"><span>Dia e hora</span>
            <input id="pe-quando" type="datetime-local" v-model="novo.quando"></label>
          <label class="cv-campo" for="pe-praca"><span>Praça</span>
            <select id="pe-praca" v-model="novo.praca">
              <option value="">Escolha…</option>
              <option v-for="(nome, sigla) in PRACAS" :key="sigla" :value="sigla">{{ nome }}</option>
            </select></label>
          <label class="cv-campo" for="pe-vagas"><span>Vagas</span>
            <input id="pe-vagas" type="number" min="1" max="60" v-model.number="novo.vagas"></label>
          <label class="cv-campo cv-campo-largo" for="pe-local"><span>Lugar</span>
            <input id="pe-local" type="text" maxlength="90" v-model="novo.local"
                   placeholder="Onde o encontro acontece"></label>
        </div>

        <p class="cv-nota">
          <b>Vagas</b> é o denominador da taxa de resposta desta tela — é sobre ele
          que "quantas responderam" é calculado. O plano fala em 5 a 8 convidadas.
        </p>
        <ul v-if="problemas.length" class="cv-problemas">
          <li v-for="p in problemas" :key="p">{{ p }}</li>
        </ul>
        <p v-if="erroAoCriar" class="cv-nota cv-nota-erro">{{ erroAoCriar }}</p>
        <p v-if="criado" class="cv-nota cv-nota-ok">
          Encontro <b>{{ criado.codigo }}</b> criado. O convite está na lista abaixo.
        </p>

        <div class="cv-acoes">
          <button class="btn btn-principal" :disabled="problemas.length > 0 || criando"
                  @click="criar">{{ criando ? 'Criando…' : 'Criar encontro' }}</button>
        </div>
      </section>

      <!-- ── COMO LER ───────────────────────────────────────────────────── -->
      <section v-if="!carregando && !erro && encontros.length" class="cv-bloco cv-bloco-leitura">
        <h2 class="cv-etiqueta">Como ler os números</h2>
        <p class="cv-nota cv-nota-primeira">
          Toda taxa aqui vem com <b>de quantos</b> ela saiu. Um encontro tem 5 a 8
          convidadas: <b>“67%” sobre 3 pessoas é uma pessoa</b>, não uma tendência —
          quando a base é pequena demais para separar um cenário do outro, a tela
          escreve a faixa em que a taxa real pode estar.
        </p>
        <p class="cv-nota">
          <b>Receita</b> é a compra das convidadas na janela declarada ao lado do
          valor. Não existe no dado nenhum campo dizendo “esta compra veio deste
          encontro” — o que existe é a mesma pessoa comprando perto da visita.
        </p>
      </section>

      <div v-if="carregando" class="cv-carregando">Carregando…</div>

      <template v-else-if="!erro">
        <!-- ── O CONJUNTO ───────────────────────────────────────────────── -->
        <section v-if="encontros.length" class="cv-bloco">
          <h2 class="cv-etiqueta">Todos os encontros juntos</h2>
          <div class="cv-numeros">
            <div class="cv-numero">
              <span class="cv-numero-valor">{{ encontros.length }}</span>
              <span class="cv-numero-rotulo">Encontros</span>
            </div>
            <div class="cv-numero">
              <span class="cv-numero-valor">{{ totalVagas }}</span>
              <span class="cv-numero-rotulo">Vagas somadas</span>
            </div>
            <div class="cv-numero">
              <span class="cv-numero-valor">{{ emPorcento(conjuntoResposta.valor) }}</span>
              <span class="cv-numero-rotulo">Responderam</span>
              <span class="cv-numero-base">{{ taxaEscrita(conjuntoResposta) }}</span>
            </div>
            <div class="cv-numero">
              <span class="cv-numero-valor">{{ emPorcento(conjuntoPresenca.valor) }}</span>
              <span class="cv-numero-rotulo">Foram, de quem disse sim</span>
              <span class="cv-numero-base">{{ taxaEscrita(conjuntoPresenca) }}</span>
            </div>
          </div>
          <!-- ⚠️ A taxa do conjunto é a SOMA dos numeradores sobre a SOMA dos
               denominadores, nunca a média das taxas: um encontro de 2 vagas
               pesaria igual a um de 8. -->
          <p class="cv-nota">
            As taxas do conjunto somam numeradores e denominadores — não é a média
            das taxas de cada encontro, que daria a um encontro pequeno o mesmo
            peso de um cheio.
          </p>
        </section>

        <!-- ── CADA ENCONTRO ────────────────────────────────────────────── -->
        <section v-for="e in encontros" :key="e.codigo" class="cv-bloco">
          <div class="cv-cabeca">
            <div class="cv-cabeca-texto">
              <h2 class="cv-titulo">{{ dataHoraLegivel(e.quando) }}</h2>
              <p class="cv-sub">
                <span class="cv-codigo">{{ e.codigo }}</span>
                <span v-if="e.anfitria || e.stylist"> · {{ e.anfitria || e.stylist }}</span>
                <span v-if="e.local"> · {{ e.local }}</span>
              </p>
            </div>
            <span class="cv-selo" :class="e.ativa === false ? 'cv-selo-fim' : 'cv-selo-viva'">
              {{ e.ativa === false ? 'Encerrado' : 'Aceitando' }}</span>
          </div>

          <div class="cv-numeros">
            <div class="cv-numero">
              <span class="cv-numero-valor">{{ e.vagas }}</span>
              <span class="cv-numero-rotulo">Vagas</span>
            </div>
            <div class="cv-numero">
              <span class="cv-numero-valor">{{ e.responderam }}</span>
              <span class="cv-numero-rotulo">Responderam</span>
              <span class="cv-numero-base">{{ taxaEscrita(taxaResposta(e)) }}</span>
              <span v-if="margemEscrita(taxaResposta(e))" class="cv-numero-margem">
                {{ margemEscrita(taxaResposta(e)) }}</span>
            </div>
            <div class="cv-numero">
              <span class="cv-numero-valor">{{ e.disseram_sim }}</span>
              <span class="cv-numero-rotulo">Disseram sim</span>
              <span class="cv-numero-base">{{ taxaEscrita(taxaSim(e)) }} de quem respondeu</span>
            </div>
            <div class="cv-numero">
              <span class="cv-numero-valor">{{ e.compareceram }}</span>
              <span class="cv-numero-rotulo">Foram</span>
              <span class="cv-numero-base">{{ taxaEscrita(taxaPresenca(e)) }} de quem disse sim</span>
              <span v-if="margemEscrita(taxaPresenca(e))" class="cv-numero-margem">
                {{ margemEscrita(taxaPresenca(e)) }}</span>
            </div>
            <div class="cv-numero">
              <span class="cv-numero-valor">{{ emReais(e.receita) }}</span>
              <span class="cv-numero-rotulo">Receita</span>
              <span class="cv-numero-base">{{ janelaEscrita(e.janela_de_venda_em_dias) }}</span>
            </div>
          </div>

          <h3 class="cv-etiqueta cv-etiqueta-interna">O convite</h3>
          <div class="cv-link">
            <div class="cv-link-texto">
              <span class="cv-link-nome">O que a anfitriã manda para as convidadas</span>
              <code class="cv-link-url">{{ enderecoDoConvite(e.chave) || '(sem chave)' }}</code>
            </div>
            <button v-if="enderecoDoConvite(e.chave)" class="btn"
                    @click="copiar(enderecoDoConvite(e.chave), e.codigo)">
              {{ copiado === e.codigo ? 'Copiado' : 'Copiar' }}</button>
          </div>
          <p class="cv-nota">
            O endereço vai pela <b>chave sorteada</b>, e não pelo código do encontro:
            o código é adivinhável, e quem recebesse um convite listaria os outros
            trocando a data.
          </p>

          <div class="cv-acoes">
            <template v-if="e.ativa !== false">
              <button v-if="confirmando !== e.codigo" class="btn"
                      @click="confirmando = e.codigo">Encerrar…</button>
              <template v-else>
                <span class="cv-confirma">Encerrar faz o convite parar de aceitar
                  resposta. Os números ficam.</span>
                <button class="btn" @click="confirmando = null">Deixar como está</button>
                <button class="btn btn-perigo" :disabled="mexendo === e.codigo"
                        @click="encerrar(e, false)">Encerrar</button>
              </template>
            </template>
            <button v-else class="btn" :disabled="mexendo === e.codigo"
                    @click="encerrar(e, true)">Reabrir</button>
          </div>
          <p v-if="erroAoMexer === e.codigo" class="cv-nota cv-nota-erro">
            Não consegui gravar agora. Tente de novo em um instante.
          </p>
        </section>

        <p v-if="!encontros.length" class="cv-vazio">
          Nenhum encontro marcado ainda. Marque o primeiro no bloco de cima.
        </p>
      </template>
    </div>
  </div>
</template>

<script setup>
/* VESSEL — PRIVATE EDIT: marcar o encontro, acompanhar e encerrar.
 *
 * ⚠️ LÊ COM O TOKEN DA SESSÃO, NUNCA COM A CHAVE ANÔNIMA: as funções conferem
 * `is_vessel_atendimentos()` por dentro, e com a chave anônima o PostgREST
 * responde 200 com lista VAZIA — a tela diria "nenhum encontro" para uma agenda
 * cheia (item 9 do PADRAO-DA-CENTRAL).
 *
 * ⚠️ TODA TAXA AQUI SAI COM O DENOMINADOR E, QUANDO A BASE É PEQUENA, COM A
 * FAIXA. Um encontro tem 5 a 8 convidadas: sem isso, "67%" sobre 3 pessoas
 * viraria uma tendência na cabeça de quem lê, e é uma pessoa.
 */
import { ref, reactive, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import BarraDeTopo from '../../compartilhado/barra-de-topo.vue'
import FaixaDeErro from '../../compartilhado/faixa-de-erro.vue'
import { estado } from '../../compartilhado/controle-de-login-e-usuario.js'
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../../compartilhado/conectar-no-banco-de-dados.js'
import { classificarErro } from '../../compartilhado/classificar-erro.js'
import { enderecoDoConvite, dataHoraLegivel, problemasDoEncontro } from './enderecos-publicos.js'
import {
  proporcao, proporcaoDoConjunto, taxaEscrita, margemEscrita, emPorcento,
  emReais, janelaEscrita,
} from './estatistica.js'
import { paiDaTela, ROTULO_DO_PAI } from './navegacao.js'

const router = useRouter()
function voltar() { router.push({ name: paiDaTela('private-edit') }) }

const PRACAS = { CPS: 'Campinas', SAO: 'São Paulo', SBO: 'Santa Bárbara', BSB: 'Brasília' }

const encontros = ref([])
const stylists = ref([])
const carregando = ref(true)
const erro = ref(null)
const criando = ref(false)
const criado = ref(null)
const erroAoCriar = ref('')
const mexendo = ref(null)
const erroAoMexer = ref(null)
const confirmando = ref(null)
const copiado = ref(null)

const novo = reactive({ stylist: '', quando: '', praca: '', loja: '', vagas: 8, local: '' })

const problemas = computed(() => problemasDoEncontro(novo))
const subtitulo = computed(() => {
  if (carregando.value || erro.value) return ''
  return `${encontros.value.length} encontro(s) · ${totalVagas.value} vagas somadas`
})

const totalVagas = computed(() =>
  encontros.value.reduce((s, e) => s + (Number(e.vagas) || 0), 0))

/* ⚠️ AS TAXAS DO CONJUNTO SOMAM NUMERADORES E DENOMINADORES. Média das taxas
 * daria a um encontro de 2 vagas o mesmo peso de um de 8. */
const conjuntoResposta = computed(() =>
  proporcaoDoConjunto(encontros.value, 'responderam', 'vagas'))
const conjuntoPresenca = computed(() =>
  proporcaoDoConjunto(encontros.value, 'compareceram', 'disseram_sim'))

/* Cada uma é uma proporção de verdade: cada convidada responde ou não, diz sim
 * ou não, vai ou não. Por isso o intervalo de Wilson se aplica. */
const taxaResposta = (e) => proporcao(e.responderam, e.vagas)
const taxaSim = (e) => proporcao(e.disseram_sim, e.responderam)
const taxaPresenca = (e) => proporcao(e.compareceram, e.disseram_sim)

function cabecalho() {
  const token = estado.currentSession?.access_token
  return {
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${token || SUPABASE_ANON_KEY}`,
    'Content-Type': 'application/json',
  }
}

async function chamar(funcao, corpo) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${funcao}`, {
    method: 'POST', headers: cabecalho(), body: JSON.stringify(corpo || {}),
  })
  if (!r.ok) throw new Error(`o banco respondeu ${r.status}`)
  return r.json()
}

async function carregar() {
  carregando.value = true
  erro.value = null
  try {
    if (!estado.currentSession?.access_token) {
      erro.value = { tipo: 'sem-sessao', acao: null,
        mensagem: 'Sua sessão expirou. Recarregue a página e entre de novo.' }
      return
    }
    const [lista, quem] = await Promise.all([
      chamar('vessel_conta_das_private_edits', { p_dias: 7 }),
      chamar('vessel_stylists_para_escolher', {}),
    ])
    encontros.value = lista || []
    stylists.value = quem || []
  } catch (e) {
    erro.value = classificarErro(e)
  } finally {
    carregando.value = false
  }
}

async function criar() {
  if (problemas.value.length) return
  criando.value = true
  erroAoCriar.value = ''
  criado.value = null
  try {
    // ⚠️ O campo datetime-local devolve hora LOCAL sem fuso. Mandar a string
    // crua faria o banco ler como UTC e o encontro nasceria 3 horas adiantado.
    const quandoISO = new Date(novo.quando).toISOString()
    const r = await chamar('vessel_criar_private_edit', {
      p_stylist: novo.stylist, p_quando: quandoISO,
      p_local: novo.local || null, p_praca: novo.praca,
      p_loja: novo.loja || null, p_vagas: novo.vagas, p_teste: false,
    })
    // A mensagem do banco vem para a tela: ela já explica em português qual
    // conferência falhou.
    if (!r?.ok) { erroAoCriar.value = r?.erro || 'Não consegui criar agora.'; return }
    criado.value = r
    novo.local = ''
    await carregar()
  } catch {
    erroAoCriar.value = 'Não consegui falar com o banco agora. Tente de novo em um instante.'
  } finally {
    criando.value = false
  }
}

async function encerrar(encontro, ativa) {
  mexendo.value = encontro.codigo
  erroAoMexer.value = null
  try {
    const r = await chamar('vessel_private_edit_encerrar',
      { p_codigo: encontro.codigo, p_ativa: ativa })
    // ⚠️ Se a gravação falha, o selo NÃO muda: tela que parece salva e não
    // salvou é o defeito mais caro de perceber.
    if (!r?.ok) { erroAoMexer.value = encontro.codigo; return }
    encontro.ativa = ativa
    confirmando.value = null
  } catch {
    erroAoMexer.value = encontro.codigo
  } finally {
    mexendo.value = null
  }
}

async function copiar(texto, marca) {
  try {
    await navigator.clipboard.writeText(texto)
    copiado.value = marca
    setTimeout(() => { if (copiado.value === marca) copiado.value = null }, 2000)
  } catch { /* o endereço segue na tela para ser selecionado à mão */ }
}

onMounted(carregar)
</script>

<style scoped>
@import './estilo-comercial.css';
</style>
