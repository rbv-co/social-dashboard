<!-- src/ferramentas/funil-carrinho/tela-de-funil-carrinho.vue -->
<template>
  <div class="fc-tela id-ferramenta">
    <barra-de-topo :voltar="ROTULO_DO_PAI[paiDaTela('funil-carrinho')]"
                   titulo="Funil de Carrinho" @voltar="voltar" />

    <div class="fc-body">
      <div class="fc-periodo">
        <span class="fc-periodo-label">Período</span>
        <button
          v-for="p in PERIODOS" :key="p.dias" class="btn"
          :class="{ 'btn-principal': periodoAtivo === p.dias }"
          @click="selecionarPeriodo(p.dias)"
        >{{ p.rotulo }}</button>
      </div>

      <div class="fc-abas">
        <button class="btn" :class="{ 'btn-principal': aba === 'visao' }" @click="aba = 'visao'">Visão geral</button>
        <button class="btn" :class="{ 'btn-principal': aba === 'registros' }" @click="aba = 'registros'">Registros</button>
      </div>

      <p v-if="erro" class="fc-erro" role="alert">Não consegui carregar os dados: {{ erro }}</p>
      <p v-if="cortado" class="fc-erro" role="alert">Tem mais de {{ LIMITE_CARRINHO }} linhas neste período — a lista pode estar CORTADA e os números incompletos. Diminua o período.</p>

      <div v-show="aba === 'visao'" class="fc-grade">
        <section class="fc-cartao card-base">
          <h2 class="fc-titulo-secao id-titulo"><icone-do-bloco nome="carrinho-mais" />Mais adicionados ao carrinho</h2>
          <p v-if="carregando" class="fc-carregando">Carregando…</p>
          <p v-else-if="!erro && !maisAdicionados.length" class="fc-vazio">Nenhum produto adicionado ao carrinho neste período.</p>
          <table v-else class="fc-tabela">
            <thead><tr><th>Produto</th><th>Vezes adicionado</th></tr></thead>
            <tbody>
              <tr v-for="p in maisAdicionados" :key="p.produto_titulo">
                <td>{{ p.produto_titulo }}</td>
                <td>{{ p.contagem }}</td>
              </tr>
            </tbody>
          </table>
        </section>

        <section class="fc-cartao card-base">
          <h2 class="fc-titulo-secao id-titulo"><icone-do-bloco nome="carrinho-menos" />Mais removidos do carrinho</h2>
          <p v-if="carregando" class="fc-carregando">Carregando…</p>
          <p v-else-if="!erro && !maisRemovidos.length" class="fc-vazio">Nenhum produto removido do carrinho neste período.</p>
          <table v-else class="fc-tabela">
            <thead><tr><th>Produto</th><th>Vezes removido</th></tr></thead>
            <tbody>
              <tr v-for="p in maisRemovidos" :key="p.produto_titulo">
                <td>{{ p.produto_titulo }}</td>
                <td>{{ p.contagem }}</td>
              </tr>
            </tbody>
          </table>
        </section>

        <section class="fc-cartao fc-cartao-largo card-base">
          <h2 class="fc-titulo-secao id-titulo"><icone-do-bloco nome="relogio" />Carrinhos abandonados antes do checkout</h2>
          <p class="fc-explicacao">Teve produto adicionado, nunca chegou a iniciar o checkout, e ficou parado por mais de 30 minutos.</p>
          <p v-if="carregando" class="fc-carregando">Carregando…</p>
          <p v-else-if="!erro && !abandonados.length" class="fc-vazio">Nenhum carrinho abandonado neste período.</p>
          <table v-else class="fc-tabela">
            <thead><tr><th>Carrinho iniciado em</th><th>Última movimentação</th></tr></thead>
            <tbody>
              <tr v-for="c in abandonados" :key="c.cart_token">
                <td>{{ formatarData(c.iniciado_em) }}</td>
                <td>{{ formatarData(c.ultimo_evento) }}</td>
              </tr>
            </tbody>
          </table>
        </section>
      </div>

      <div v-show="aba === 'registros'" class="fc-grade">
        <section class="fc-cartao fc-cartao-largo card-base">
          <h2 class="fc-titulo-secao id-titulo"><icone-do-bloco nome="lista" />Registros</h2>
          <p class="fc-explicacao">Cada evento cru, mais recente primeiro.</p>
          <p v-if="carregando" class="fc-carregando">Carregando…</p>
          <p v-else-if="!erro && !registros.length" class="fc-vazio">Nenhum evento neste período.</p>
          <div v-else class="fc-tabela-scroll"><table class="fc-tabela">
            <thead><tr><th>Data/hora</th><th>Tipo</th><th>Produto</th><th>Qtd.</th><th>Preço</th><th>Carrinho</th><th>Sessão</th></tr></thead>
            <tbody>
              <tr v-for="r in registros" :key="r.id">
                <td>{{ formatarData(r.criado_em) }}</td>
                <td>{{ TIPO_LABEL[r.tipo] || r.tipo }}</td>
                <td>{{ r.produto_titulo || '—' }}</td>
                <td>{{ r.quantidade ?? '—' }}</td>
                <td>{{ formatarPreco(r.preco) }}</td>
                <td>{{ r.cart_token ? r.cart_token.slice(0, 8) + '…' : '—' }}</td>
                <td>{{ r.session_id ? r.session_id.slice(0, 8) + '…' : '—' }}</td>
              </tr>
            </tbody>
          </table></div>
        </section>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import BarraDeTopo from '../../compartilhado/barra-de-topo.vue'
import IconeDoBloco from '../../compartilhado/icone-do-bloco.vue'
import { sbClient } from '../../compartilhado/conectar-no-banco-de-dados.js'
import { diasAtras } from '../../compartilhado/datas.js'
import { rankearProdutos, ordenarAbandonados, foiCortado, LIMITE_CARRINHO } from './agregacoes-carrinho.js'
import { paiDaTela, ROTULO_DO_PAI } from '../comercial-vessel/navegacao.js'

const router = useRouter()
const voltar = () => router.push({ name: paiDaTela('funil-carrinho') })

const PERIODOS = [
  { dias: 7, rotulo: '7D' },
  { dias: 14, rotulo: '14D' },
  { dias: 30, rotulo: '30D' },
]

const TIPO_LABEL = {
  produto_adicionado: 'Adicionado',
  produto_removido: 'Removido',
  checkout_iniciado: 'Checkout iniciado',
}

const aba = ref('visao')
const periodoAtivo = ref(7)
const carregando = ref(true)
const erro = ref(null)
const cortado = ref(false)
const maisAdicionados = ref([])
const maisRemovidos = ref([])
const abandonados = ref([])
const registros = ref([])

function formatarData(iso) {
  return new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })
}

function formatarPreco(preco) {
  return preco == null ? '—' : preco.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

async function carregar() {
  carregando.value = true
  erro.value = null
  cortado.value = false
  // Limpa ANTES de buscar: sem isto, uma troca de período que falha deixava
  // a tabela do período anterior na tela, por baixo da faixa de erro, como
  // se fosse dado do período novo.
  maisAdicionados.value = []
  maisRemovidos.value = []
  abandonados.value = []
  registros.value = []
  const desde = `${diasAtras(periodoAtivo.value)}T00:00:00-03:00`

  const [adicionados, removidos, carrinhosAbandonados, eventosCrus] = await Promise.all([
    sbClient.from('carrinho_eventos').select('produto_titulo').eq('tipo', 'produto_adicionado').gte('criado_em', desde).limit(LIMITE_CARRINHO),
    sbClient.from('carrinho_eventos').select('produto_titulo').eq('tipo', 'produto_removido').gte('criado_em', desde).limit(LIMITE_CARRINHO),
    sbClient.from('carrinho_abandonados').select('cart_token,iniciado_em,ultimo_evento').gte('iniciado_em', desde).limit(LIMITE_CARRINHO),
    // sessao_iniciada excluído: ~25% do volume é bot conhecido (Googlebot,
    // crawler da própria Meta — confirmado por reverse DNS de IP em
    // 21/09/2026), sem user_agent gravado pra filtrar isso de forma
    // confiável. Dado real, mas não em condição de aparecer como registro.
    sbClient.from('carrinho_eventos').select('id,criado_em,tipo,produto_titulo,quantidade,preco,cart_token,session_id').neq('tipo', 'sessao_iniciada').gte('criado_em', desde).order('criado_em', { ascending: false }).limit(LIMITE_CARRINHO),
  ])

  const primeiroErro = adicionados.error || removidos.error || carrinhosAbandonados.error || eventosCrus.error
  if (primeiroErro) {
    erro.value = primeiroErro.message
    carregando.value = false
    return
  }

  cortado.value = foiCortado(adicionados.data) || foiCortado(removidos.data) || foiCortado(carrinhosAbandonados.data) || foiCortado(eventosCrus.data)
  maisAdicionados.value = rankearProdutos(adicionados.data)
  maisRemovidos.value = rankearProdutos(removidos.data)
  abandonados.value = ordenarAbandonados(carrinhosAbandonados.data)
  registros.value = eventosCrus.data
  carregando.value = false
}

function selecionarPeriodo(dias) {
  periodoAtivo.value = dias
  carregar()
}

onMounted(carregar)
</script>

<style scoped>
@import '../../estilos/identidade-da-ferramenta.css';
.fc-tela { min-height: 100vh; background: var(--bg); }
/* respiro lateral que cresce com a tela, igual às outras cinco telas da família — o piso de 16px é o --gutter de hoje, o celular não muda */
.fc-body { padding: clamp(16px, 2.4vw, 40px); display: flex; flex-direction: column; gap: var(--sp-6); }
.fc-periodo { display: flex; align-items: center; gap: var(--sp-2); flex-wrap: wrap; }
.fc-periodo-label { font-size: var(--texto-etiqueta); text-transform: uppercase; letter-spacing: 1.5px; color: var(--muted); margin-right: var(--sp-2); }
.fc-abas { display: flex; gap: var(--sp-2); flex-wrap: wrap; }
/* ⚠️ Esta grade tem uma FORMA CONHECIDA — dois cartões lado a lado mais um
   que ocupa a linha toda — nunca "quantos cartões couberem". `auto-fit` com
   um mínimo de 320px cria ~5 colunas a 1920px: os dois cartões comuns ficam
   presos em ~370px cada, encostados à esquerda, com um vazio de ~1150px à
   direita (achado da foto de 19/09/2026 — exatamente o "não pega a lateral
   toda" que motivou esta entrega). Com 2 colunas fixas, os dois cartões
   comuns dividem a largura inteira entre si; `.fc-cartao-largo` continua
   varrendo as duas. No celular vira 1 coluna (ver @media abaixo). */
.fc-grade { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--sp-6); }
.fc-cartao-largo { grid-column: 1 / -1; }
.fc-titulo-secao { font-size: var(--texto-titulo); margin: 0 0 var(--sp-4); overflow-wrap: anywhere; }
/* A COR DA FERRAMENTA NO TÍTULO (Onda 1, 23/09/2026): aqui o título do bloco
   é grande (--texto-titulo), não a etiqueta pequena do Stylist Circle — pintado
   inteiro de laranja, quatro deles gritavam na foto. A cor fica no ÍCONE, do
   tamanho da letra; o texto continua --text, e a barra do topo e o botão
   principal já dizem de que ferramenta é esta tela. */
.id-ferramenta .fc-titulo-secao.id-titulo { color: var(--text); }
.fc-titulo-secao .id-icone { color: var(--modulo); width: 20px; height: 20px; flex-basis: 20px; }
.fc-explicacao { font-size: var(--texto-corpo); color: var(--muted); margin: 0 0 var(--sp-4); }
.fc-carregando, .fc-vazio { font-size: var(--texto-corpo); color: var(--muted); }
.fc-erro { font-size: var(--texto-campo); color: var(--red); }
.fc-tabela-scroll { overflow-x: auto; }
.fc-tabela-scroll .fc-tabela { min-width: 760px; }
.fc-tabela { width: 100%; border-collapse: collapse; font-size: var(--texto-corpo); }
.fc-tabela th, .fc-tabela td { text-align: left; padding: var(--sp-2) var(--sp-3); border-bottom: 1px solid var(--border); overflow-wrap: anywhere; }
.fc-tabela th { color: var(--muted); font-size: var(--texto-etiqueta); text-transform: uppercase; letter-spacing: 1.5px; }

@media (max-width: 640px) {
  .fc-body { padding: var(--sp-4); }
  .fc-grade { grid-template-columns: 1fr; }
}
</style>
