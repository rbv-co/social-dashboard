<template>
  <div class="tela-relatorio-opr">
    <barra-de-topo voltar="Meta Ads" titulo="Relatório OPR" @voltar="voltar" />

    <div class="ropr-body">
      <faixa-de-erro :erro="erro" @tentar-de-novo="carregar" />

      <div class="ropr-periodo">
        <div class="ropr-atalhos">
          <button class="btn" :class="{ 'btn-principal': atalho === 'hoje' }" @click="aplicarAtalho('hoje')">Hoje</button>
          <button class="btn" :class="{ 'btn-principal': atalho === 'ontem' }" @click="aplicarAtalho('ontem')">Ontem</button>
          <button class="btn" :class="{ 'btn-principal': atalho === '7dias' }" @click="aplicarAtalho('7dias')">7 dias</button>
          <button class="btn" :class="{ 'btn-principal': atalho === '30dias' }" @click="aplicarAtalho('30dias')">30 dias</button>
          <button class="btn" :class="{ 'btn-principal': atalho === 'mes' }" @click="aplicarAtalho('mes')">Mês atual</button>
        </div>
        <div class="ropr-intervalo">
          <label class="ropr-campo-data">
            <span>De</span>
            <input type="date" v-model="diaInicioInput" :max="hojeISO" />
          </label>
          <label class="ropr-campo-data">
            <span>Até</span>
            <input type="date" v-model="diaFimInput" :max="hojeISO" />
          </label>
          <button class="btn btn-principal" @click="aplicarIntervaloCustom">Aplicar</button>
        </div>
      </div>

      <p v-if="!erro" class="ropr-periodo-label">{{ periodoLabel }}</p>

      <template v-if="!carregando && !erro && dados">
        <div class="ropr-kpis">
          <div class="ropr-kpi">
            <span class="ropr-kpi-label">Investimento Total</span>
            <span class="ropr-kpi-valor">{{ formatarReaisOuTraco(dados.header.investimentoTotal) }}</span>
          </div>
          <div class="ropr-kpi">
            <span class="ropr-kpi-label">Novos Seguidores</span>
            <span class="ropr-kpi-valor">{{ formatarNumOuTraco(dados.header.novosSeguidores) }}</span>
          </div>
          <div class="ropr-kpi">
            <span class="ropr-kpi-label">Engajamentos</span>
            <span class="ropr-kpi-valor">{{ formatarNumOuTraco(dados.header.engajamentos) }}</span>
          </div>
          <div class="ropr-kpi">
            <span class="ropr-kpi-label">Leads Gerados</span>
            <span class="ropr-kpi-valor">{{ formatarNumOuTraco(dados.header.leadsGerados) }}</span>
          </div>
        </div>

        <div class="ropr-secoes">
          <section class="ropr-secao">
            <h2>Growth / Seguidores</h2>
            <div class="ropr-metricas">
              <div class="ropr-metrica"><span>Investimento</span><strong>{{ formatarReaisOuTraco(dados.growth.investimento) }}</strong></div>
              <div class="ropr-metrica"><span>Seguidores</span><strong>{{ formatarNumOuTraco(dados.growth.seguidores) }}</strong></div>
              <div class="ropr-metrica"><span>Visitas ao Perfil</span><strong>{{ formatarNumOuTraco(dados.growth.visitasPerfil) }}</strong></div>
              <div class="ropr-metrica"><span>Custo por Seguidor</span><strong>{{ formatarReaisOuTraco(dados.growth.custoPorSeguidor) }}</strong></div>
              <div class="ropr-metrica"><span>Custo por Visita</span><strong>{{ formatarReaisOuTraco(dados.growth.custoPorVisita) }}</strong></div>
              <div class="ropr-metrica"><span>Conversão Visita → Seguidor</span><strong>{{ formatarPctOuTraco(dados.growth.conversaoVisitaSeguidor) }}</strong></div>
            </div>
          </section>

          <section class="ropr-secao">
            <h2>Engagement</h2>
            <div class="ropr-metricas">
              <div class="ropr-metrica"><span>Investimento</span><strong>{{ formatarReaisOuTraco(dados.engagement.investimento) }}</strong></div>
              <div class="ropr-metrica"><span>Curtidas</span><strong>{{ formatarNumOuTraco(dados.engagement.curtidas) }}</strong></div>
              <div class="ropr-metrica"><span>Comentários</span><strong>{{ formatarNumOuTraco(dados.engagement.comentarios) }}</strong></div>
              <div class="ropr-metrica"><span>Compartilhamentos</span><strong>{{ formatarNumOuTraco(dados.engagement.compartilhamentos) }}</strong></div>
              <div class="ropr-metrica"><span>Salvamentos</span><strong>{{ formatarNumOuTraco(dados.engagement.salvamentos) }}</strong></div>
              <div class="ropr-metrica"><span>Custo por Curtida</span><strong>{{ formatarReaisOuTraco(dados.engagement.custoPorCurtida) }}</strong></div>
              <div class="ropr-metrica"><span>Custo por Comentário</span><strong>{{ formatarReaisOuTraco(dados.engagement.custoPorComentario) }}</strong></div>
              <div class="ropr-metrica"><span>Custo por Compartilhamento</span><strong>{{ formatarReaisOuTraco(dados.engagement.custoPorCompartilhamento) }}</strong></div>
              <div class="ropr-metrica"><span>Custo por Salvamento</span><strong>{{ formatarReaisOuTraco(dados.engagement.custoPorSalvamento) }}</strong></div>
              <div class="ropr-metrica"><span>Total de Interações</span><strong>{{ formatarNumOuTraco(dados.engagement.totalInteracoes) }}</strong></div>
              <div class="ropr-metrica"><span>Custo Médio por Engajamento</span><strong>{{ formatarReaisOuTraco(dados.engagement.custoMedioPorEngajamento) }}</strong></div>
            </div>
          </section>

          <section class="ropr-secao">
            <h2>Leads &amp; Sales</h2>
            <!-- Leads Quentes/Vendas e tudo que depende deles vem `null`
                 (Chatwoot ainda não integrado) — aparece "—", nunca um número
                 inventado. Mesma regra do relatório que vai pro WhatsApp. -->
            <div class="ropr-funil">
              <div class="ropr-funil-etapa"><span>Leads</span><strong>{{ formatarNumOuTraco(dados.sales.leads) }}</strong></div>
              <div class="ropr-funil-etapa"><span>Leads Quentes</span><strong>{{ formatarNumOuTraco(dados.sales.leadsQuentes) }}</strong></div>
              <div class="ropr-funil-etapa"><span>Vendas</span><strong>{{ formatarNumOuTraco(dados.sales.vendas) }}</strong></div>
            </div>
            <div class="ropr-metricas">
              <div class="ropr-metrica"><span>Investimento</span><strong>{{ formatarReaisOuTraco(dados.sales.investimento) }}</strong></div>
              <div class="ropr-metrica"><span>Custo por Lead</span><strong>{{ formatarReaisOuTraco(dados.sales.custoPorLead) }}</strong></div>
              <div class="ropr-metrica"><span>Custo por Lead Quente</span><strong>{{ formatarReaisOuTraco(dados.sales.custoPorLeadQuente) }}</strong></div>
              <div class="ropr-metrica"><span>Custo por Venda</span><strong>{{ formatarReaisOuTraco(dados.sales.custoPorVenda) }}</strong></div>
              <div class="ropr-metrica"><span>Conversão Lead → Quente</span><strong>{{ formatarPctOuTraco(dados.sales.conversaoLeadQuente) }}</strong></div>
              <div class="ropr-metrica"><span>Conversão Quente → Venda</span><strong>{{ formatarPctOuTraco(dados.sales.conversaoQuenteVenda) }}</strong></div>
            </div>
          </section>
        </div>

        <section class="ropr-mix">
          <h2>Media Mix</h2>
          <p class="ropr-mix-sub">Distribuição do investimento por categoria — definição provisória, aguardando confirmação do gerente de marketing.</p>
          <div class="ropr-mix-linha" v-for="item in mixLista" :key="item.label">
            <span class="ropr-mix-rotulo">{{ item.label }}</span>
            <div class="ropr-mix-barra"><span :style="{ width: Math.min(Math.max(item.valor ?? 0, 0), 100) + '%' }"></span></div>
            <strong class="ropr-mix-valor">{{ formatarPctOuTraco(item.valor) }}</strong>
          </div>
        </section>
      </template>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import BarraDeTopo from '../../compartilhado/barra-de-topo.vue'
import FaixaDeErro from '../../compartilhado/faixa-de-erro.vue'
import { sb } from '../../compartilhado/buscar-e-salvar-dados.js'
import { formatarReais, deltaDeSeguidoresPorHora, seguidoresNoPeriodo, visitasPerfilNoPeriodo } from './relatorio-por-hora.js'
import { agruparCampanhasDoDia, montarDadosOpr } from './relatorio-diario-opr.js'

const router = useRouter()
function voltar() {
  router.push({ name: 'meta-ads' })
}

// Mesmo recorte fixo da tela de Relatório por Hora e do robô que manda pro
// WhatsApp (pedido do dono, 12/09/2026) — só a conta "Vessel".
const CONTA_VESSEL = 'b6883e82-07cb-4f21-9fd7-ea7626786174'

function hojeISOSaoPaulo() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })
}
// Soma/subtrai dias numa data 'AAAA-MM-DD', sem depender de fuso (meio-dia
// UTC evita virar de dia por causa de horário de verão/[-3h] em qualquer
// timezone do navegador de quem abrir a tela).
function somarDias(iso, delta) {
  const [ano, mes, dia] = iso.split('-').map(Number)
  const d = new Date(Date.UTC(ano, mes - 1, dia, 12))
  d.setUTCDate(d.getUTCDate() + delta)
  return d.toISOString().slice(0, 10)
}

const hojeISO = hojeISOSaoPaulo()
const ontemISO = somarDias(hojeISO, -1)

const atalho = ref('ontem')
const diaInicio = ref(ontemISO)
const diaFim = ref(ontemISO)
const diaInicioInput = ref(diaInicio.value)
const diaFimInput = ref(diaFim.value)

const carregando = ref(true)
const erro = ref(null)
const dados = ref(null)

function aplicarAtalho(nome) {
  atalho.value = nome
  if (nome === 'hoje') { diaInicio.value = hojeISO; diaFim.value = hojeISO }
  else if (nome === 'ontem') { diaInicio.value = ontemISO; diaFim.value = ontemISO }
  else if (nome === '7dias') { diaInicio.value = somarDias(hojeISO, -6); diaFim.value = hojeISO }
  else if (nome === '30dias') { diaInicio.value = somarDias(hojeISO, -29); diaFim.value = hojeISO }
  else if (nome === 'mes') { diaInicio.value = `${hojeISO.slice(0, 7)}-01`; diaFim.value = hojeISO }
  diaInicioInput.value = diaInicio.value
  diaFimInput.value = diaFim.value
  carregar()
}
function aplicarIntervaloCustom() {
  atalho.value = null
  diaInicio.value = diaInicioInput.value
  diaFim.value = diaFimInput.value
  carregar()
}

function formatarDiaBR(iso) {
  const [ano, mes, dia] = iso.split('-')
  return `${dia}/${mes}/${ano}`
}
const periodoLabel = computed(() => (
  diaInicio.value === diaFim.value
    ? formatarDiaBR(diaInicio.value)
    : `${formatarDiaBR(diaInicio.value)} — ${formatarDiaBR(diaFim.value)}`
))

const mixLista = computed(() => {
  if (!dados.value) return []
  return [
    { label: 'Growth', valor: dados.value.mix.growth },
    { label: 'Engagement', valor: dados.value.mix.engagement },
    { label: 'Leads', valor: dados.value.mix.leads },
  ]
})

function formatarReaisOuTraco(v) { return v == null ? '—' : formatarReais(v) }
function formatarNumOuTraco(v) { return v == null ? '—' : v.toLocaleString('pt-BR') }
function formatarPctOuTraco(v) { return v == null ? '—' : `${v.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%` }

async function carregar() {
  carregando.value = true
  erro.value = null
  dados.value = null

  const inicio = diaInicio.value
  const fim = diaFim.value
  // 48h de folga ANTES do início — garante leitura anterior ao primeiro
  // bucket do período pra deltaDeSeguidoresPorHora ter "anterior" pra
  // comparar (mesma folga usada em coletor/gerar-opr-diario.mjs; aqui o
  // período é escolhido na tela, não fixo em "ontem").
  const desdeSeguidores = new Date(new Date(`${inicio}T00:00:00-03:00`).getTime() - 48 * 3600 * 1000).toISOString()

  const [campanhas, insights, leituras, visitas] = await Promise.all([
    sb('campaigns?select=campaign_id,name'),
    sb(`campaign_insights?select=campaign_id,spend,likes,comments,shares,saves,conversas,post_engagement&account_id=eq.${CONTA_VESSEL}&captured_at=gte.${inicio}&captured_at=lte.${fim}&period_days=eq.0`),
    sb(`followers_leituras?select=followers_count,lido_em&account_id=eq.${CONTA_VESSEL}&lido_em=gte.${desdeSeguidores}&order=lido_em.asc`),
    sb(`perfil_visitas_hora?select=dia,hora,visitas_hora&account_id=eq.${CONTA_VESSEL}&dia=gte.${inicio}&dia=lte.${fim}`),
  ])

  if (campanhas.erro) { erro.value = campanhas.erro; carregando.value = false; return }
  if (insights.erro) { erro.value = insights.erro; carregando.value = false; return }
  if (leituras.erro) { erro.value = leituras.erro; carregando.value = false; return }
  if (visitas.erro) { erro.value = visitas.erro; carregando.value = false; return }

  const nomesPorCampanha = Object.fromEntries(campanhas.map((c) => [c.campaign_id, c.name]))
  const campanhasDoPeriodo = agruparCampanhasDoDia(insights, nomesPorCampanha)
  const deltas = deltaDeSeguidoresPorHora(leituras)
  const seguidoresDoPeriodo = seguidoresNoPeriodo(deltas, inicio, fim)
  const visitasPerfilDoPeriodo = visitasPerfilNoPeriodo(visitas, inicio, fim)

  dados.value = montarDadosOpr(campanhasDoPeriodo, seguidoresDoPeriodo, visitasPerfilDoPeriodo)
  carregando.value = false
}

onMounted(() => carregar())
</script>

<style scoped>
.tela-relatorio-opr { min-height: 100vh; display: flex; flex-direction: column; background: var(--bg); }
.ropr-body { flex: 1; padding: var(--sp-6) var(--sp-6); display: flex; flex-direction: column; gap: var(--sp-5); }

.ropr-periodo { display: flex; flex-wrap: wrap; align-items: center; gap: var(--sp-3); }
.ropr-atalhos { display: flex; flex-wrap: wrap; gap: var(--sp-2); }
.ropr-intervalo { display: flex; flex-wrap: wrap; align-items: center; gap: var(--sp-2); margin-left: auto; }
.ropr-campo-data { display: flex; flex-direction: column; gap: 2px; font-size: var(--texto-etiqueta); color: var(--muted); }
.ropr-campo-data input {
  min-height: 40px; padding: 0 var(--sp-2); border: 1px solid var(--border); border-radius: var(--radius-md);
  background: var(--surface); color: var(--text); font-family: var(--fonte-principal); font-size: 16px;
}
.ropr-periodo-label { color: var(--muted); font-size: var(--texto-corpo); font-weight: 600; }

.ropr-kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: var(--sp-3); }
.ropr-kpi {
  background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-lg);
  padding: var(--sp-4); display: flex; flex-direction: column; gap: var(--sp-1);
}
.ropr-kpi-label { font-size: var(--texto-etiqueta); color: var(--muted); }
.ropr-kpi-valor { font-family: var(--fonte-dados); font-variant-numeric: tabular-nums; font-size: var(--texto-numero); font-weight: 700; color: var(--text); }

.ropr-secoes { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: var(--sp-4); align-items: start; }
.ropr-secao { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-lg); padding: var(--sp-4); display: flex; flex-direction: column; gap: var(--sp-3); }
.ropr-secao h2 { margin: 0; font-size: var(--texto-campo); font-weight: 700; color: var(--text); }

.ropr-metricas { display: flex; flex-direction: column; gap: var(--sp-2); }
.ropr-metrica { display: flex; align-items: baseline; justify-content: space-between; gap: var(--sp-3); padding: var(--sp-1) 0; border-bottom: 1px solid var(--border); }
.ropr-metrica:last-child { border-bottom: none; }
.ropr-metrica span { color: var(--muted); font-size: var(--texto-corpo); overflow-wrap: anywhere; }
.ropr-metrica strong { font-family: var(--fonte-dados); font-variant-numeric: tabular-nums; color: var(--text); white-space: nowrap; }

.ropr-funil { display: flex; gap: var(--sp-2); flex-wrap: wrap; }
.ropr-funil-etapa {
  flex: 1; min-width: 100px; background: var(--surface2); border-radius: var(--radius-md); padding: var(--sp-3);
  display: flex; flex-direction: column; gap: var(--sp-1); text-align: center;
}
.ropr-funil-etapa span { font-size: var(--texto-etiqueta); color: var(--muted); }
.ropr-funil-etapa strong { font-family: var(--fonte-dados); font-variant-numeric: tabular-nums; font-size: var(--texto-campo); color: var(--text); }

.ropr-mix { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-lg); padding: var(--sp-4); display: flex; flex-direction: column; gap: var(--sp-2); }
.ropr-mix h2 { margin: 0; font-size: var(--texto-campo); font-weight: 700; color: var(--text); }
.ropr-mix-sub { margin: 0; color: var(--muted); font-size: var(--texto-etiqueta); }
.ropr-mix-linha { display: grid; grid-template-columns: 100px 1fr 60px; align-items: center; gap: var(--sp-3); }
.ropr-mix-rotulo { color: var(--text); font-size: var(--texto-corpo); overflow-wrap: anywhere; }
.ropr-mix-barra { height: 10px; background: var(--surface2); border-radius: var(--radius-sm); overflow: hidden; }
.ropr-mix-barra span { display: block; height: 100%; background: var(--green); }
.ropr-mix-valor { font-family: var(--fonte-dados); font-variant-numeric: tabular-nums; text-align: right; color: var(--text); }

@media (max-width: 640px) {
  .ropr-body { padding: var(--sp-4) var(--sp-3); }
  .ropr-intervalo { margin-left: 0; width: 100%; }
  .ropr-mix-linha { grid-template-columns: 72px 1fr 50px; gap: var(--sp-2); }
}
</style>
