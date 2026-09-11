<template>
  <div class="tela-relatorio-hora">
    <barra-de-topo voltar="Meta Ads" titulo="Relatório por Hora" @voltar="voltar" />
    <div class="rph-body">
      <faixa-de-erro :erro="erro" @tentar-de-novo="carregar" />

      <p v-if="!erro && !carregando && dias.length === 0" class="rph-vazio">
        Ainda não há leitura por hora. O robô roda de hora em hora — volte daqui a pouco.
      </p>

      <div v-for="d in dias" :key="d.dia" class="rph-dia">
        <button class="rph-dia-cabecalho" @click="alternar(d.dia)">
          <span class="rph-dia-seta" :class="{ aberto: expandido(d.dia) }">▸</span>
          <span class="rph-dia-data">{{ formatarDia(d.dia) }}</span>
          <span class="rph-dia-totais">{{ formatarReais(d.gastoTotal) }} · {{ d.conversasTotal }} conversas</span>
        </button>

        <div v-if="expandido(d.dia)" class="rph-horas">
          <div v-for="h in d.horas" :key="h.hora" class="rph-hora">
            <div class="rph-hora-cabecalho">
              <span class="rph-hora-rotulo">{{ String(h.hora).padStart(2, '0') }}h</span>
              <span class="rph-hora-totais">{{ formatarReais(h.gastoTotal) }} · {{ h.conversasTotal }} conversas</span>
            </div>
            <table class="rph-tabela">
              <thead>
                <tr><th>Campanha</th><th>Investido</th><th>Conversas</th><th>Custo/lead</th></tr>
              </thead>
              <tbody>
                <tr v-for="c in h.campanhas" :key="c.campaignId">
                  <td class="rph-campanha">{{ c.nome }}</td>
                  <td>{{ formatarReais(c.gastoHora) }}</td>
                  <td>{{ c.conversasHora }}</td>
                  <td>{{ c.custoPorLead === null ? '—' : formatarReais(c.custoPorLead) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import BarraDeTopo from '../../compartilhado/barra-de-topo.vue'
import FaixaDeErro from '../../compartilhado/faixa-de-erro.vue'
import { sb } from '../../compartilhado/buscar-e-salvar-dados.js'
import { agruparPorDiaEHora } from './relatorio-por-hora.js'

const router = useRouter()
function voltar() {
  router.push({ name: 'meta-ads' })
}

// Últimos 14 dias bastam pra um relatório que só olha "hoje" e "essa
// semana" — sem filtro de período nesta primeira entrega (spec §8, YAGNI).
const JANELA_DIAS = 14

const carregando = ref(true)
const erro = ref(null)
const dias = ref([])
const expandidos = ref(new Set())

function expandido(dia) {
  return expandidos.value.has(dia)
}
function alternar(dia) {
  const s = new Set(expandidos.value)
  if (s.has(dia)) s.delete(dia)
  else s.add(dia)
  expandidos.value = s
}

function formatarDia(iso) {
  const [ano, mes, dia] = iso.split('-')
  return `${dia}/${mes}/${ano}`
}
function formatarReais(v) {
  return (v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

async function carregar() {
  carregando.value = true
  erro.value = null

  const desde = new Date()
  desde.setDate(desde.getDate() - JANELA_DIAS)
  const desdeISO = desde.toISOString().slice(0, 10)

  const [linhas, campanhas] = await Promise.all([
    sb(`campaign_insights_hora?select=dia,hora,campaign_id,gasto_hora,conversas_hora&dia=gte.${desdeISO}&order=dia.desc,hora.asc`),
    sb('campaigns?select=campaign_id,name'),
  ])

  if (linhas.erro) { erro.value = linhas.erro; carregando.value = false; return }
  if (campanhas.erro) { erro.value = campanhas.erro; carregando.value = false; return }

  const nomesPorCampanha = Object.fromEntries(campanhas.map((c) => [c.campaign_id, c.name]))
  dias.value = agruparPorDiaEHora(linhas, nomesPorCampanha)

  // Hoje nasce expandido; dias passados nascem fechados — "visão simples"
  // pedida: quem abre a tela já vê o dia de hoje sem precisar clicar.
  const hoje = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })
  if (dias.value.some((d) => d.dia === hoje)) expandidos.value = new Set([hoje])

  carregando.value = false
}

onMounted(carregar)
</script>

<style scoped>
.tela-relatorio-hora { min-height: 100vh; display: flex; flex-direction: column; background: var(--bg); }
.rph-body { flex: 1; padding: var(--sp-6) var(--sp-6); display: flex; flex-direction: column; gap: var(--sp-4); }
.rph-vazio { color: var(--muted); font-size: 13px; }

.rph-dia { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-lg); overflow: hidden; }
.rph-dia-cabecalho { width: 100%; min-height: 48px; display: flex; align-items: center; gap: var(--sp-3); padding: var(--sp-3) var(--sp-4); background: none; border: none; cursor: pointer; text-align: left; font-family: var(--fonte-principal); color: var(--text); }
.rph-dia-seta { color: var(--muted); transition: transform .15s; flex-shrink: 0; }
.rph-dia-seta.aberto { transform: rotate(90deg); }
.rph-dia-data { font-weight: 600; font-size: 14px; overflow-wrap: anywhere; }
.rph-dia-totais { margin-left: auto; color: var(--muted); font-size: 12px; white-space: nowrap; }

.rph-horas { border-top: 1px solid var(--border); display: flex; flex-direction: column; }
.rph-hora { padding: var(--sp-3) var(--sp-4); border-bottom: 1px solid var(--border); }
.rph-hora:last-child { border-bottom: none; }
.rph-hora-cabecalho { display: flex; align-items: baseline; gap: var(--sp-3); margin-bottom: var(--sp-2); }
.rph-hora-rotulo { font-weight: 600; font-size: 13px; }
.rph-hora-totais { color: var(--muted); font-size: 12px; }

.rph-tabela { width: 100%; border-collapse: collapse; font-size: 12px; }
.rph-tabela th { text-align: left; color: var(--muted); font-weight: 600; padding: var(--sp-1) var(--sp-2); border-bottom: 1px solid var(--border); }
.rph-tabela td { padding: var(--sp-1) var(--sp-2); border-bottom: 1px solid var(--border); }
.rph-tabela tr:last-child td { border-bottom: none; }
.rph-campanha { overflow-wrap: anywhere; }

@media (max-width: 640px) {
  .rph-body { padding: var(--sp-4) var(--sp-3); }
  .rph-tabela { display: block; overflow-x: auto; }
  .rph-dia-totais { font-size: 11px; }
}
</style>
