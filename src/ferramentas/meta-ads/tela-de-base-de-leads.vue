<!-- src/ferramentas/meta-ads/tela-de-base-de-leads.vue
     Tela SÓ DE LEITURA: junta três eventos que já existiam cada um no seu
     canto — checkout iniciado (carrinho_eventos), cadastro no pop-up "Entre
     para o Universo Vessel" (vessel_lista_espera) e pedido de atendimento/
     visita (vessel_atendimentos) — numa única linha do tempo. Nenhum captador
     novo: os três já gravam sozinhos, isto só lê. Ver
     db/migrations/2026-09-24-meta-ads-base-de-leads-leitura.sql. -->
<template>
  <div class="bl-tela id-ferramenta">
    <barra-de-topo voltar="Meta Ads" titulo="Base de Leads"
                   subtitulo="Checkout iniciado, pop-up e pedido de atendimento — tudo num só lugar"
                   @voltar="voltar" />

    <div class="bl-body">
      <div class="bl-periodo">
        <span class="bl-periodo-label">Período</span>
        <button
          v-for="p in PERIODOS" :key="p.dias" class="btn"
          :class="{ 'btn-principal': periodoAtivo === p.dias }"
          @click="selecionarPeriodo(p.dias)"
        >{{ p.rotulo }}</button>
      </div>

      <p v-if="erro" class="bl-erro" role="alert">Não consegui carregar os dados: {{ erro }}</p>
      <p v-if="cortado" class="bl-erro" role="alert">Tem mais de {{ LIMITE_LEADS }} linhas neste período — a lista pode estar CORTADA e os números incompletos. Diminua o período.</p>

      <section class="bl-cartao bl-resumo card-base">
        <h2 class="bl-titulo-secao id-titulo"><icone-do-bloco nome="lead-mais" />Resumo do período</h2>
        <p v-if="carregando" class="bl-carregando">Carregando…</p>
        <div v-else class="bl-contadores">
          <div class="bl-contador">
            <span class="bl-contador-numero">{{ contagem.checkout_iniciado }}</span>
            <span class="bl-contador-rotulo">Checkout iniciado</span>
          </div>
          <div class="bl-contador">
            <span class="bl-contador-numero">{{ contagem.pop_up }}</span>
            <span class="bl-contador-rotulo">Pop-up preenchido</span>
          </div>
          <div class="bl-contador">
            <span class="bl-contador-numero">{{ contagem.atendimento_solicitado }}</span>
            <span class="bl-contador-rotulo">Pedido de atendimento</span>
          </div>
          <div class="bl-contador bl-contador-total">
            <span class="bl-contador-numero">{{ contagem.total }}</span>
            <span class="bl-contador-rotulo">Total de leads</span>
          </div>
        </div>
      </section>

      <section class="bl-cartao card-base">
        <h2 class="bl-titulo-secao id-titulo"><icone-do-bloco nome="lista" />Registros</h2>
        <p class="bl-explicacao">Cada evento, mais recente primeiro. O pop-up ainda não sabe de qual anúncio a pessoa veio — só o checkout e o pedido de atendimento têm essa atribuição.</p>
        <p v-if="carregando" class="bl-carregando">Carregando…</p>
        <p v-else-if="!erro && !linhas.length" class="bl-vazio">Nenhum lead neste período.</p>
        <div v-else class="bl-tabela-scroll"><table class="bl-tabela">
          <thead><tr><th>Data/hora</th><th>Tipo</th><th>Quem</th><th>Contato</th><th>Origem</th></tr></thead>
          <tbody>
            <tr v-for="(l, i) in linhas" :key="i">
              <td>{{ formatarData(l.criado_em) }}</td>
              <td>{{ TIPOS[l.tipo] || l.tipo }}</td>
              <td>{{ l.quem }}</td>
              <td>{{ l.contato }}</td>
              <td>{{ l.origem }}</td>
            </tr>
          </tbody>
        </table></div>
      </section>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, computed } from 'vue'
import { useRouter } from 'vue-router'
import BarraDeTopo from '../../compartilhado/barra-de-topo.vue'
import IconeDoBloco from '../../compartilhado/icone-do-bloco.vue'
import { sbClient } from '../../compartilhado/conectar-no-banco-de-dados.js'
import { diasAtras } from '../../compartilhado/datas.js'
import { unificarEventos, contarPorTipo, foiCortado, LIMITE_LEADS, TIPOS } from './base-de-leads.js'

const router = useRouter()
const voltar = () => router.push({ name: 'meta-ads' })

const PERIODOS = [
  { dias: 7, rotulo: '7D' },
  { dias: 14, rotulo: '14D' },
  { dias: 30, rotulo: '30D' },
]

const periodoAtivo = ref(7)
const carregando = ref(true)
const erro = ref(null)
const cortado = ref(false)
const linhas = ref([])
const contagem = computed(() => contarPorTipo(linhas.value))

function formatarData(iso) {
  return new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })
}

async function carregar() {
  carregando.value = true
  erro.value = null
  cortado.value = false
  linhas.value = [] // limpa antes de buscar: sem isto, período que falha deixa o anterior na tela, como se fosse dado novo
  const desde = `${diasAtras(periodoAtivo.value)}T00:00:00-03:00`

  const [checkouts, popups, atendimentos] = await Promise.all([
    sbClient.from('carrinho_eventos')
      .select('criado_em,session_id,utm_source,utm_medium,utm_campaign,gclid,referrer,fbp,fbc')
      .eq('tipo', 'checkout_iniciado').gte('criado_em', desde).limit(LIMITE_LEADS),
    sbClient.from('vessel_lista_espera')
      .select('criado_em,nome,email,whatsapp').gte('criado_em', desde).limit(LIMITE_LEADS),
    sbClient.from('vessel_atendimentos')
      .select('pessoa_id,criado_em').gte('criado_em', desde).limit(LIMITE_LEADS),
  ])

  const primeiroErro = checkouts.error || popups.error || atendimentos.error
  if (primeiroErro) {
    erro.value = primeiroErro.message
    carregando.value = false
    return
  }

  // As pessoas/origens só valem para quem apareceu em vessel_atendimentos —
  // buscar todo mundo seria desperdício, e a tabela é grande.
  const idsDePessoas = [...new Set((atendimentos.data || []).map((a) => a.pessoa_id).filter(Boolean))]
  let pessoas = [], origens = []
  if (idsDePessoas.length) {
    const [pessoasResp, origensResp] = await Promise.all([
      sbClient.from('vessel_pessoas').select('id,nome,telefone,email').in('id', idsDePessoas),
      sbClient.from('vessel_origens').select('pessoa_id,momento,utm_source,utm_medium,utm_campaign,clique_meta').in('pessoa_id', idsDePessoas),
    ])
    if (pessoasResp.error || origensResp.error) {
      erro.value = (pessoasResp.error || origensResp.error).message
      carregando.value = false
      return
    }
    pessoas = pessoasResp.data
    origens = (origensResp.data || []).map((o) => ({ ...o, fbc: o.clique_meta }))
  }

  cortado.value = foiCortado(checkouts.data) || foiCortado(popups.data) || foiCortado(atendimentos.data)
  linhas.value = unificarEventos({ checkouts: checkouts.data, popups: popups.data, atendimentos: atendimentos.data, pessoas, origens })
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
.bl-tela { min-height: 100vh; background: var(--bg); }
.bl-body { padding: clamp(16px, 2.4vw, 40px); display: flex; flex-direction: column; gap: var(--sp-6); }
.bl-periodo { display: flex; align-items: center; gap: var(--sp-2); flex-wrap: wrap; }
.bl-periodo-label { font-size: var(--texto-etiqueta); text-transform: uppercase; letter-spacing: 1.5px; color: var(--muted); margin-right: var(--sp-2); }
.bl-titulo-secao { font-size: var(--texto-titulo); margin: 0 0 var(--sp-4); overflow-wrap: anywhere; }
.id-ferramenta .bl-titulo-secao.id-titulo { color: var(--text); }
.bl-titulo-secao .id-icone { color: var(--modulo); width: 20px; height: 20px; flex-basis: 20px; }
.bl-explicacao { font-size: var(--texto-corpo); color: var(--muted); margin: 0 0 var(--sp-4); }
.bl-carregando, .bl-vazio { font-size: var(--texto-corpo); color: var(--muted); }
.bl-erro { font-size: var(--texto-campo); color: var(--red); }

.bl-contadores { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: var(--sp-4); }
.bl-contador { display: flex; flex-direction: column; gap: var(--sp-1); padding: var(--sp-3); border: 1px solid var(--border); border-radius: var(--radius-md); }
.bl-contador-numero { font-size: var(--texto-numero); font-weight: 700; color: var(--text); }
.bl-contador-rotulo { font-size: var(--texto-etiqueta); text-transform: uppercase; letter-spacing: 1px; color: var(--muted); overflow-wrap: anywhere; }
.bl-contador-total { border-color: var(--modulo); }
.bl-contador-total .bl-contador-numero { color: var(--modulo); }

.bl-tabela-scroll { overflow-x: auto; }
.bl-tabela-scroll .bl-tabela { min-width: 720px; }
.bl-tabela { width: 100%; border-collapse: collapse; font-size: var(--texto-corpo); }
.bl-tabela th, .bl-tabela td { text-align: left; padding: var(--sp-2) var(--sp-3); border-bottom: 1px solid var(--border); overflow-wrap: anywhere; }
.bl-tabela th { color: var(--muted); font-size: var(--texto-etiqueta); text-transform: uppercase; letter-spacing: 1.5px; }

@media (max-width: 640px) {
  .bl-body { padding: var(--sp-4); }
  .bl-contadores { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
</style>
