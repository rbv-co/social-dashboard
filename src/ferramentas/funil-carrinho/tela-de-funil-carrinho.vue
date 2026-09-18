<!-- src/ferramentas/funil-carrinho/tela-de-funil-carrinho.vue -->
<template>
  <div class="fc-tela">
    <barra-de-topo voltar="Central" titulo="Funil de Carrinho" @voltar="voltar" />

    <div class="fc-body">
      <div class="fc-periodo">
        <span class="fc-periodo-label">Período</span>
        <button
          v-for="p in PERIODOS" :key="p.dias" class="btn"
          :class="{ 'btn-principal': periodoAtivo === p.dias }"
          @click="selecionarPeriodo(p.dias)"
        >{{ p.rotulo }}</button>
      </div>

      <p v-if="erro" class="fc-erro" role="alert">Não consegui carregar os dados: {{ erro }}</p>

      <div class="fc-grade">
        <section class="fc-cartao card-base">
          <h2 class="fc-titulo-secao">Mais adicionados ao carrinho</h2>
          <p v-if="carregando" class="fc-carregando">Carregando…</p>
          <p v-else-if="!maisAdicionados.length" class="fc-vazio">Nenhum produto adicionado ao carrinho neste período.</p>
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
          <h2 class="fc-titulo-secao">Mais removidos do carrinho</h2>
          <p v-if="carregando" class="fc-carregando">Carregando…</p>
          <p v-else-if="!maisRemovidos.length" class="fc-vazio">Nenhum produto removido do carrinho neste período.</p>
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
          <h2 class="fc-titulo-secao">Carrinhos abandonados antes do checkout</h2>
          <p class="fc-explicacao">Teve produto adicionado, nunca chegou a iniciar o checkout, e ficou parado por mais de 30 minutos.</p>
          <p v-if="carregando" class="fc-carregando">Carregando…</p>
          <p v-else-if="!abandonados.length" class="fc-vazio">Nenhum carrinho abandonado neste período.</p>
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
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import BarraDeTopo from '../../compartilhado/barra-de-topo.vue'
import { sbClient } from '../../compartilhado/conectar-no-banco-de-dados.js'
import { diasAtras } from '../../compartilhado/datas.js'
import { rankearProdutos, ordenarAbandonados } from './agregacoes-carrinho.js'

const router = useRouter()
const voltar = () => router.push({ name: 'inicio' })

const PERIODOS = [
  { dias: 7, rotulo: '7D' },
  { dias: 14, rotulo: '14D' },
  { dias: 30, rotulo: '30D' },
]

const periodoAtivo = ref(7)
const carregando = ref(true)
const erro = ref(null)
const maisAdicionados = ref([])
const maisRemovidos = ref([])
const abandonados = ref([])

function formatarData(iso) {
  return new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })
}

async function carregar() {
  carregando.value = true
  erro.value = null
  const desde = `${diasAtras(periodoAtivo.value)}T00:00:00-03:00`

  const [adicionados, removidos, carrinhosAbandonados] = await Promise.all([
    sbClient.from('carrinho_eventos').select('produto_titulo').eq('tipo', 'produto_adicionado').gte('criado_em', desde),
    sbClient.from('carrinho_eventos').select('produto_titulo').eq('tipo', 'produto_removido').gte('criado_em', desde),
    sbClient.from('carrinho_abandonados').select('cart_token,iniciado_em,ultimo_evento').gte('iniciado_em', desde),
  ])

  const primeiroErro = adicionados.error || removidos.error || carrinhosAbandonados.error
  if (primeiroErro) {
    erro.value = primeiroErro.message
    carregando.value = false
    return
  }

  maisAdicionados.value = rankearProdutos(adicionados.data)
  maisRemovidos.value = rankearProdutos(removidos.data)
  abandonados.value = ordenarAbandonados(carrinhosAbandonados.data)
  carregando.value = false
}

function selecionarPeriodo(dias) {
  periodoAtivo.value = dias
  carregar()
}

onMounted(carregar)
</script>

<style scoped>
.fc-tela { min-height: 100vh; background: var(--bg); }
.fc-body { padding: var(--sp-6); display: flex; flex-direction: column; gap: var(--sp-6); }
.fc-periodo { display: flex; align-items: center; gap: var(--sp-2); flex-wrap: wrap; }
.fc-periodo-label { font-size: var(--texto-etiqueta); text-transform: uppercase; letter-spacing: 1.5px; color: var(--muted); margin-right: var(--sp-2); }
.fc-grade { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: var(--sp-6); }
.fc-cartao-largo { grid-column: 1 / -1; }
.fc-titulo-secao { font-size: var(--texto-titulo); margin: 0 0 var(--sp-4); overflow-wrap: anywhere; }
.fc-explicacao { font-size: var(--texto-corpo); color: var(--muted); margin: 0 0 var(--sp-4); }
.fc-carregando, .fc-vazio { font-size: var(--texto-corpo); color: var(--muted); }
.fc-erro { font-size: var(--texto-campo); color: var(--red); }
.fc-tabela { width: 100%; border-collapse: collapse; font-size: var(--texto-corpo); }
.fc-tabela th, .fc-tabela td { text-align: left; padding: var(--sp-2) var(--sp-3); border-bottom: 1px solid var(--border); overflow-wrap: anywhere; }
.fc-tabela th { color: var(--muted); font-size: var(--texto-etiqueta); text-transform: uppercase; letter-spacing: 1.5px; }

@media (max-width: 640px) {
  .fc-body { padding: var(--sp-4); }
}
</style>
