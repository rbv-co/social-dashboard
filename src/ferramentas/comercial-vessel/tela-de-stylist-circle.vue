<template>
  <div class="tela-sty">
    <barra-de-topo :voltar="ROTULO_DO_PAI[paiDaTela('stylist-circle')]"
                   titulo="Vessel — Stylist Circle"
                   :subtitulo="subtitulo" @voltar="voltar" />

    <div class="cv-largo cv-body">
      <faixa-de-erro :erro="erro" @tentar-de-novo="carregar" />

      <!-- ── A PORTA DO PROGRAMA ────────────────────────────────────────── -->
      <section class="cv-bloco">
        <h2 class="cv-etiqueta">A porta de entrada</h2>
        <div class="cv-link">
          <div class="cv-link-texto">
            <span class="cv-link-nome">Onde a stylist se inscreve — uma vez, na vida</span>
            <code class="cv-link-url">{{ ENDERECO_DO_CIRCLE }}</code>
          </div>
          <button class="btn" @click="copiar(ENDERECO_DO_CIRCLE, 'circle')">
            {{ copiado === 'circle' ? 'Copiado' : 'Copiar' }}</button>
        </div>
        <p class="cv-nota">
          A stylist entra por aqui e o código dela nasce sozinho — não há nada
          para criar nesta tela, de propósito. O que cada uma faz depois é o que
          está listado abaixo.
        </p>
      </section>

      <!-- ── COMO LER ───────────────────────────────────────────────────── -->
      <section v-if="!carregando && !erro && stylists.length" class="cv-bloco cv-bloco-leitura">
        <h2 class="cv-etiqueta">Como ler os números</h2>
        <p class="cv-nota cv-nota-primeira">
          <b>Aberturas</b> é leitura do link, não pessoa: a mesma cliente abrindo
          duas vezes conta duas. <b>Clientes</b> é gente com nome e WhatsApp.
          A conta entre as duas é aproximada justamente por isso — e por isso ela
          vem sempre com o número de quem a compõe.
        </p>
        <p class="cv-nota">
          <b>Pedidos por cliente</b> não é percentual, e é de propósito: a mesma
          cliente pode pedir visita duas vezes, então o número pode passar de 1.
          Mostrar isso como “taxa de 140%” faria quem lê desconfiar da tela — com
          razão.
        </p>
        <p class="cv-nota">
          <b>Receita</b> é a compra das clientes da stylist na janela declarada ao
          lado do valor. Não existe no dado nenhum campo dizendo “esta compra veio
          desta stylist”: o que existe é a mesma pessoa comprando perto da visita
          que ela trouxe.
        </p>
      </section>

      <div v-if="carregando" class="cv-carregando">Carregando…</div>

      <template v-else-if="!erro">
        <!-- ── O CONJUNTO ───────────────────────────────────────────────── -->
        <section v-if="stylists.length" class="cv-bloco">
          <h2 class="cv-etiqueta">Todas as stylists juntas</h2>
          <div class="cv-numeros">
            <div class="cv-numero">
              <span class="cv-numero-valor">{{ stylists.length }}</span>
              <span class="cv-numero-rotulo">Stylists</span>
            </div>
            <div class="cv-numero">
              <span class="cv-numero-valor">{{ totalAberturas }}</span>
              <span class="cv-numero-rotulo">Aberturas de link</span>
            </div>
            <div class="cv-numero">
              <span class="cv-numero-valor">{{ emPorcento(conjuntoClientes.valor) }}</span>
              <span class="cv-numero-rotulo">Viraram cliente</span>
              <span class="cv-numero-base">{{ taxaEscrita(conjuntoClientes) }}</span>
            </div>
            <div class="cv-numero">
              <span class="cv-numero-valor">{{ emReais(totalReceita) }}</span>
              <span class="cv-numero-rotulo">Receita somada</span>
              <span class="cv-numero-base">{{ janelaEscrita(janela) }}</span>
            </div>
          </div>
          <p class="cv-nota">
            As taxas do conjunto somam numeradores e denominadores — não é a média
            das taxas de cada stylist, que daria a quem teve 2 aberturas o mesmo
            peso de quem teve 200.
          </p>
        </section>

        <!-- ── CADA STYLIST ─────────────────────────────────────────────── -->
        <section v-for="s in stylists" :key="s.codigo" class="cv-bloco">
          <div class="cv-cabeca">
            <div class="cv-cabeca-texto">
              <h2 class="cv-titulo">{{ s.nome || s.codigo }}</h2>
              <p class="cv-sub">
                <span class="cv-codigo">{{ s.codigo }}</span>
                <span v-if="s.cidade"> · {{ s.cidade }}</span>
                <span v-if="s.praca_preview"> · preview em {{ s.praca_preview }}</span>
              </p>
            </div>
            <span class="cv-selo" :class="s.estagio === 'ativa' ? 'cv-selo-viva' : 'cv-selo-fim'">
              {{ ESTAGIOS[s.estagio] || s.estagio || 'sem estágio' }}</span>
          </div>

          <div class="cv-numeros">
            <div class="cv-numero">
              <span class="cv-numero-valor">{{ s.aberturas }}</span>
              <span class="cv-numero-rotulo">Abriram o link</span>
              <span class="cv-numero-base">leituras, não pessoas</span>
            </div>
            <div class="cv-numero">
              <span class="cv-numero-valor">{{ s.clientes }}</span>
              <span class="cv-numero-rotulo">Viraram cliente</span>
              <span class="cv-numero-base">{{ taxaEscrita(taxaCliente(s)) }}</span>
              <span v-if="margemEscrita(taxaCliente(s))" class="cv-numero-margem">
                {{ margemEscrita(taxaCliente(s)) }}</span>
            </div>
            <div class="cv-numero">
              <span class="cv-numero-valor">{{ s.pedidos }}</span>
              <span class="cv-numero-rotulo">Pedidos de visita</span>
              <!-- ⚠️ RAZÃO, não taxa: a mesma cliente pode pedir duas vezes. -->
              <span class="cv-numero-base">{{ razaoEscrita(pedidosPorCliente(s), 'por cliente') }}</span>
            </div>
            <div class="cv-numero">
              <span class="cv-numero-valor">{{ s.compareceram }}</span>
              <span class="cv-numero-rotulo">Foram à loja</span>
              <span class="cv-numero-base">{{ taxaEscrita(taxaPresenca(s)) }} dos pedidos</span>
              <span v-if="margemEscrita(taxaPresenca(s))" class="cv-numero-margem">
                {{ margemEscrita(taxaPresenca(s)) }}</span>
            </div>
            <div class="cv-numero">
              <span class="cv-numero-valor">{{ emReais(s.receita) }}</span>
              <span class="cv-numero-rotulo">Receita</span>
              <span class="cv-numero-base">{{ janelaEscrita(s.janela_de_venda_em_dias) }}</span>
            </div>
          </div>

          <h3 class="cv-etiqueta cv-etiqueta-interna">O link dela</h3>
          <div class="cv-link">
            <div class="cv-link-texto">
              <span class="cv-link-nome">O permanente — story, bio, conversa</span>
              <code class="cv-link-url">{{ enderecoDaStylist(s.codigo) }}</code>
            </div>
            <button class="btn" @click="copiar(enderecoDaStylist(s.codigo), s.codigo)">
              {{ copiado === s.codigo ? 'Copiado' : 'Copiar' }}</button>
          </div>
        </section>

        <p v-if="!stylists.length" class="cv-vazio">
          Nenhuma stylist inscrita ainda. Elas entram pela porta de cima — não há
          o que criar aqui.
        </p>
      </template>
    </div>
  </div>
</template>

<script setup>
/* VESSEL — STYLIST CIRCLE: o que cada stylist trouxe.
 *
 * ⚠️ ESTA TELA NÃO CRIA NADA, de propósito. A stylist se inscreve sozinha em
 * /stylist-circle e o código nasce lá. Um botão "criar stylist" aqui produziria
 * uma parceira sem inscrição, sem aceite e sem os dados que a inscrição coleta.
 *
 * ⚠️ LÊ COM O TOKEN DA SESSÃO, NUNCA COM A CHAVE ANÔNIMA: a função confere
 * `is_vessel_atendimentos()` por dentro, e com a chave anônima o PostgREST
 * responde 200 com lista VAZIA — "nenhuma stylist" para um programa cheio.
 *
 * ⚠️ E "PEDIDOS ÷ CLIENTES" NÃO É TAXA. A mesma cliente pode pedir visita duas
 * vezes, então o número passa de 1 — mostrar "140%" num campo rotulado como
 * taxa faz quem lê desconfiar da tela inteira, com razão. Vai como razão.
 */
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import BarraDeTopo from '../../compartilhado/barra-de-topo.vue'
import FaixaDeErro from '../../compartilhado/faixa-de-erro.vue'
import { estado } from '../../compartilhado/controle-de-login-e-usuario.js'
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../../compartilhado/conectar-no-banco-de-dados.js'
import { classificarErro } from '../../compartilhado/classificar-erro.js'
import { enderecoDaStylist, ENDERECO_DO_CIRCLE, ESTAGIOS } from './enderecos-publicos.js'
import {
  proporcao, proporcaoDoConjunto, razao, razaoEscrita, taxaEscrita, margemEscrita,
  emPorcento, emReais, janelaEscrita,
} from './estatistica.js'
import { paiDaTela, ROTULO_DO_PAI } from './navegacao.js'

const router = useRouter()
function voltar() { router.push({ name: paiDaTela('stylist-circle') }) }

const stylists = ref([])
const carregando = ref(true)
const erro = ref(null)
const copiado = ref(null)

const subtitulo = computed(() => {
  if (carregando.value || erro.value) return ''
  const ativas = stylists.value.filter((s) => s.estagio === 'ativa').length
  return `${stylists.value.length} stylist(s) · ${ativas} ativa(s)`
})

const totalAberturas = computed(() =>
  stylists.value.reduce((s, x) => s + (Number(x.aberturas) || 0), 0))
const totalReceita = computed(() =>
  stylists.value.reduce((s, x) => s + (Number(x.receita) || 0), 0))
/* A régua da venda vem do banco e é a mesma para todas as linhas. */
const janela = computed(() => stylists.value[0]?.janela_de_venda_em_dias ?? null)

const conjuntoClientes = computed(() =>
  proporcaoDoConjunto(stylists.value, 'clientes', 'aberturas'))

/* Proporções de verdade: cada pedido aconteceu ou não. */
const taxaCliente = (s) => proporcao(s.clientes, s.aberturas)
const taxaPresenca = (s) => proporcao(s.compareceram, s.pedidos)
/* ⚠️ RAZÃO, não proporção — pode passar de 1. Ver o cabeçalho. */
const pedidosPorCliente = (s) => razao(s.pedidos, s.clientes)

function cabecalho() {
  const token = estado.currentSession?.access_token
  return {
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${token || SUPABASE_ANON_KEY}`,
    'Content-Type': 'application/json',
  }
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
    const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/vessel_rastreio_dos_stylists`, {
      method: 'POST', headers: cabecalho(), body: JSON.stringify({ p_dias: 7 }),
    })
    if (!r.ok) throw new Error(`o banco respondeu ${r.status}`)
    stylists.value = (await r.json()) || []
  } catch (e) {
    erro.value = classificarErro(e)
  } finally {
    carregando.value = false
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
