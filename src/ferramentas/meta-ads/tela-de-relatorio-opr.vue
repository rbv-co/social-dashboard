<template>
  <div class="tela-relatorio-opr">
    <barra-de-topo voltar="Meta Ads" titulo="Relatório OPR" @voltar="voltar" />

    <div class="ropr-body">
      <faixa-de-erro :erro="erro" @tentar-de-novo="carregar" />

      <div class="ropr-periodo">
        <div class="ropr-atalhos">
          <button :class="{ ativo: atalho === 'hoje' }" @click="aplicarAtalho('hoje')">Hoje</button>
          <button :class="{ ativo: atalho === 'ontem' }" @click="aplicarAtalho('ontem')">Ontem</button>
          <button :class="{ ativo: atalho === '7dias' }" @click="aplicarAtalho('7dias')">7 dias</button>
          <button :class="{ ativo: atalho === '30dias' }" @click="aplicarAtalho('30dias')">30 dias</button>
          <button :class="{ ativo: atalho === 'mes' }" @click="aplicarAtalho('mes')">Mês atual</button>
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
          <button class="ropr-aplicar" @click="aplicarIntervaloCustom">Aplicar</button>
        </div>
      </div>

      <main v-if="!carregando && !erro && dados" class="report">
        <header class="header">
          <div>
            <div class="eyebrow-line"></div>
            <h1 class="title">PAID MEDIA PERFORMANCE</h1>
            <div class="subtitle">Dashboard Executivo · Tráfego Pago</div>
          </div>
          <div class="meta">
            <div class="meta-item"><div class="meta-label">Conta / Perfil:</div><div class="meta-value">{{ CONTA_LABEL }}</div></div>
            <div class="meta-item"><div class="meta-label">Período:</div><div class="meta-value">{{ periodoLabel }}</div></div>
            <div class="meta-item accent"><div class="meta-label">Estratégia<br>Dados<br>Crescimento</div></div>
          </div>
        </header>

        <section class="kpis">
          <div class="kpi-card">
            <div class="icon-circle"><svg viewBox="0 0 48 48"><ellipse cx="17" cy="13" rx="9" ry="4"/><path d="M8 13v7c0 2.2 4 4 9 4s9-1.8 9-4v-7"/><ellipse cx="28" cy="20" rx="9" ry="4"/><path d="M19 20v7c0 2.2 4 4 9 4s9-1.8 9-4v-7"/><ellipse cx="18" cy="29" rx="9" ry="4"/><path d="M9 29v7c0 2.2 4 4 9 4s9-1.8 9-4v-7"/></svg></div>
            <div><div class="kpi-label">Investimento Total</div><div class="kpi-value">{{ fmtValor(dados.header.investimentoTotal, 'moeda') }}</div><div class="kpi-caption">Em tráfego pago</div></div>
          </div>
          <div class="kpi-card">
            <div class="icon-circle"><svg viewBox="0 0 48 48"><circle cx="18" cy="17" r="5"/><circle cx="31" cy="18" r="4"/><path d="M8 36c0-7 4-11 10-11s10 4 10 11"/><path d="M27 27c1.4-.8 2.8-1 4-1 5 0 8 3.4 8 9"/></svg></div>
            <div><div class="kpi-label">Novos Seguidores</div><div class="kpi-value">{{ fmtValor(dados.header.novosSeguidores) }}</div><div class="kpi-caption">+ audiência qualificada</div></div>
          </div>
          <div class="kpi-card">
            <div class="icon-circle"><svg viewBox="0 0 48 48"><path d="M24 39S9 30 9 18c0-5 3.4-8 8-8 3.4 0 5.6 1.7 7 4 1.4-2.3 3.6-4 7-4 4.6 0 8 3 8 8 0 12-15 21-15 21Z"/></svg></div>
            <div><div class="kpi-label">Engajamentos</div><div class="kpi-value">{{ fmtValor(dados.header.engajamentos) }}</div><div class="kpi-caption">Interações totais</div></div>
          </div>
          <div class="kpi-card">
            <div class="icon-circle"><svg viewBox="0 0 48 48"><path d="M8 10h32L28 25v11l-8 4V25L8 10Z"/></svg></div>
            <div><div class="kpi-label">Leads Gerados</div><div class="kpi-value">{{ fmtValor(dados.header.leadsGerados) }}</div><div class="kpi-caption">Oportunidades de negócio</div></div>
          </div>
          <div class="kpi-card kpi-card--grupo">
            <div class="icon-circle"><svg viewBox="0 0 48 48"><path d="M12 37V27M24 37V18M36 37V10"/></svg></div>
            <div>
              <div class="kpi-label">Saúde de Mídia</div>
              <div class="kpi-group">
                <div class="kpi-group-item"><div class="kpi-group-value">{{ fmtValor(dados.header.ctr, 'percentual') }}</div><div class="kpi-group-label">CTR</div></div>
                <div class="kpi-group-item"><div class="kpi-group-value">{{ fmtValor(dados.header.cpm, 'moeda') }}</div><div class="kpi-group-label">CPM</div></div>
                <div class="kpi-group-item"><div class="kpi-group-value">{{ fmtValor(dados.header.frequencia) }}</div><div class="kpi-group-label">Frequência</div></div>
              </div>
            </div>
          </div>
        </section>

        <!-- Grade 2×2 — reforma de 21/09/2026 (objective da Meta em vez de
             nome) ajustada em 22/09/2026: Seguidores volta a ser painel
             próprio, Leads junta com Vendas. Mesmo layout de
             coletor/lib/template-opr.mjs (imagem do WhatsApp) — qualquer
             ajuste aqui precisa espelhar lá também. -->
        <section class="sections">
          <article class="panel">
            <div class="panel-head">
              <div class="panel-num">01</div>
              <div><div class="panel-title">Seguidores</div><div class="panel-sub">Aquisição de audiência</div></div>
            </div>
            <div class="metric-grid panel-top">
              <div class="metric"><div class="metric-label">Investimento</div><div class="metric-value">{{ fmtValor(dados.seguidores.investimento, 'moeda') }}</div></div>
              <div class="metric"><div class="metric-label">Novos Seguidores</div><div class="metric-value">{{ fmtValor(dados.seguidores.novos) }}</div></div>
              <div class="metric"><div class="metric-label">Curtidas</div><div class="metric-value">{{ fmtValor(dados.seguidores.curtidas) }}</div></div>
              <div class="metric"><div class="metric-label">Comentários</div><div class="metric-value">{{ fmtValor(dados.seguidores.comentarios) }}</div></div>
              <div class="metric"><div class="metric-label">Compart.</div><div class="metric-value">{{ fmtValor(dados.seguidores.compartilhamentos) }}</div></div>
              <div class="metric"><div class="metric-label">Salvamentos</div><div class="metric-value">{{ fmtValor(dados.seguidores.salvamentos) }}</div></div>
            </div>
            <div class="metric-grid panel-bottom">
              <div class="metric"><div class="metric-label">Custo por Seguidor</div><div class="metric-value">{{ fmtValor(dados.seguidores.custoPorSeguidor, 'moeda') }}</div></div>
            </div>
            <div class="panel-note">
              <div class="icon-circle"><svg viewBox="0 0 48 48"><circle cx="18" cy="17" r="5"/><circle cx="31" cy="18" r="4"/><path d="M8 36c0-7 4-11 10-11s10 4 10 11"/><path d="M27 27c1.4-.8 2.8-1 4-1 5 0 8 3.4 8 9"/></svg></div>
              <div class="note-text">Mais pessoas. Mais relevância.</div>
            </div>
          </article>

          <article class="panel">
            <div class="panel-head">
              <div class="panel-num">02</div>
              <div><div class="panel-title">Tráfego</div><div class="panel-sub">Visitas geradas pela mídia paga</div></div>
            </div>
            <div class="metric-grid panel-top">
              <div class="metric"><div class="metric-label">Investimento</div><div class="metric-value">{{ fmtValor(dados.trafego.investimento, 'moeda') }}</div></div>
              <div class="metric"><div class="metric-label">Visitas</div><div class="metric-value">{{ fmtValor(dados.trafego.visitas) }}</div></div>
            </div>
            <div class="metric-grid panel-bottom">
              <div class="metric"><div class="metric-label">Custo por Visita</div><div class="metric-value">{{ fmtValor(dados.trafego.custoPorVisita, 'moeda') }}</div></div>
            </div>
            <div class="panel-note">
              <div class="icon-circle"><svg viewBox="0 0 48 48"><circle cx="24" cy="24" r="17"/><path d="M30 18l-4 10-10 4 4-10 10-4Z"/></svg></div>
              <div class="note-text">Mais visitas. Mais chance de conversão.</div>
            </div>
          </article>

          <article class="panel">
            <div class="panel-head">
              <div class="panel-num">03</div>
              <div><div class="panel-title">Engajamento</div><div class="panel-sub">Interações que fortalecem a marca</div></div>
            </div>
            <div class="metric-grid panel-top">
              <div class="metric"><div class="metric-label">Investimento</div><div class="metric-value">{{ fmtValor(dados.engajamento.investimento, 'moeda') }}</div></div>
              <div class="metric"><div class="metric-label">Curtidas</div><div class="metric-value">{{ fmtValor(dados.engajamento.curtidas) }}</div></div>
              <div class="metric"><div class="metric-label">Comentários</div><div class="metric-value">{{ fmtValor(dados.engajamento.comentarios) }}</div></div>
              <div class="metric"><div class="metric-label">Compart.</div><div class="metric-value">{{ fmtValor(dados.engajamento.compartilhamentos) }}</div></div>
              <div class="metric"><div class="metric-label">Salvamentos</div><div class="metric-value">{{ fmtValor(dados.engajamento.salvamentos) }}</div></div>
            </div>
            <div class="metric-grid panel-bottom">
              <div class="metric center"><div class="metric-label">Total de Interações</div><div class="metric-value">{{ fmtValor(dados.engajamento.totalInteracoes) }}</div></div>
              <div class="metric center"><div class="metric-label">Custo Médio por Engajamento</div><div class="metric-value">{{ fmtValor(dados.engajamento.custoMedioPorEngajamento, 'moeda') }}</div></div>
            </div>
            <div class="panel-note">
              <div class="icon-circle"><svg viewBox="0 0 48 48"><path d="M24 39S9 30 9 18c0-5 3.4-8 8-8 3.4 0 5.6 1.7 7 4 1.4-2.3 3.6-4 7-4 4.6 0 8 3 8 8 0 12-15 21-15 21Z"/></svg></div>
              <div class="note-text">Conteúdo que conecta. Resultados que constroem valor.</div>
            </div>
          </article>

          <article class="panel">
            <div class="panel-head">
              <div class="panel-num">04</div>
              <div><div class="panel-title">Leads & Vendas</div><div class="panel-sub">Do interesse ao faturamento</div></div>
            </div>
            <div class="metric-grid panel-top">
              <div class="metric"><div class="metric-label">Investimento</div><div class="metric-value">{{ fmtValor(dados.leadsEVendas.investimento, 'moeda') }}</div></div>
              <div class="metric"><div class="metric-label">Leads</div><div class="metric-value">{{ fmtValor(dados.leadsEVendas.leads) }}</div></div>
              <div class="metric"><div class="metric-label">Leads Quentes</div><div class="metric-value">{{ fmtValor(dados.leadsEVendas.leadsQuentes) }}</div></div>
              <div class="metric"><div class="metric-label">Vendas</div><div class="metric-value">{{ fmtValor(dados.leadsEVendas.vendas) }}</div></div>
            </div>
            <div class="metric-grid panel-bottom">
              <div class="metric"><div class="metric-label">Custo por Lead</div><div class="metric-value">{{ fmtValor(dados.leadsEVendas.custoPorLead, 'moeda') }}</div></div>
              <div class="metric"><div class="metric-label">Custo por Venda</div><div class="metric-value">{{ fmtValor(dados.leadsEVendas.custoPorVenda, 'moeda') }}</div></div>
            </div>
            <div class="panel-note">
              <div class="icon-circle"><svg viewBox="0 0 48 48"><path d="M8 10h32L28 25v11l-8 4V25L8 10Z"/></svg></div>
              <div class="note-text">Mais oportunidades. Mais receita para o negócio.</div>
            </div>
          </article>
        </section>

        <footer class="footer">
          <div class="footer-left">Tráfego que gera pessoas. Pessoas que geram resultados.</div>
          <div class="mix-card">
            <div>
              <div class="mix-title">Media Mix</div>
              <div class="mix-sub">Distribuição do investimento</div>
              <div class="mix-row" v-for="item in mixLista" :key="item.label">
                <div>{{ item.label }}</div>
                <div class="bar"><span :style="{ width: Math.min(Math.max(item.valor ?? 0, 0), 100) + '%' }"></span></div>
                <strong>{{ fmtValor(item.valor, 'percentual') }}</strong>
              </div>
            </div>
            <div class="mix-side">Equilíbrio<br>para um crescimento<br>sustentável.
              <small>Dados hoje.<br>Mais amanhã.</small>
            </div>
          </div>
        </footer>
      </main>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import BarraDeTopo from '../../compartilhado/barra-de-topo.vue'
import FaixaDeErro from '../../compartilhado/faixa-de-erro.vue'
import { sb } from '../../compartilhado/buscar-e-salvar-dados.js'
import { deltaDeSeguidoresPorHora, seguidoresNoPeriodo } from './relatorio-por-hora.js'
import { agruparCampanhasDoDia, calcularDadosOpr } from './relatorio-diario-opr.js'

const router = useRouter()
function voltar() {
  router.push({ name: 'meta-ads' })
}

// Mesmo recorte fixo da tela de Relatório por Hora e do robô que manda pro
// WhatsApp (pedido do dono, 12/09/2026) — só a conta "Vessel".
const CONTA_VESSEL = 'b6883e82-07cb-4f21-9fd7-ea7626786174'
const CONTA_LABEL = 'Vessel Brasil'

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

// Mesmas 4 fatias que a imagem mostra no rodapé (Media Mix), batendo 1-pra-1
// com os 4 painéis de cima — ajuste de 22/09/2026: Seguidores virou fatia
// própria, e Leads/Vendas foram somados numa fatia só (mesmo painel).
const mixLista = computed(() => {
  if (!dados.value) return []
  return [
    { label: 'Seguidores', valor: dados.value.mix.seguidores },
    { label: 'Tráfego', valor: dados.value.mix.trafego },
    { label: 'Engajamento', valor: dados.value.mix.engajamento },
    { label: 'Leads & Vendas', valor: dados.value.mix.leadsEVendas },
  ]
})

// Mesma lógica de coletor/lib/template-opr.mjs (PNG do WhatsApp) — layout
// aprovado pelo dono em 17/09/2026, reformado em 21/09/2026. As duas cópias
// existem porque uma roda no navegador e a outra no robô do WhatsApp;
// qualquer ajuste aqui (regra de abreviação, formato) precisa espelhar lá
// também.
function abreviar(n) {
  const abs = Math.abs(n)
  if (abs >= 1_000_000) return `${(n / 1_000_000).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} M`
  if (abs >= 1_000) return `${(n / 1_000).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} mil`
  return null
}
function fmtValor(n, tipo) {
  if (n == null) return '—'
  if (tipo === 'percentual') return `${n.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`
  const abreviado = abreviar(n)
  if (tipo === 'moeda') return `R$ ${abreviado ?? n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  return abreviado ?? n.toLocaleString('pt-BR')
}

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

  const [campanhas, insights, leituras, eventosChatwoot] = await Promise.all([
    sb('campaigns?select=campaign_id,name,objective'),
    sb(`campaign_insights?select=campaign_id,spend,likes,comments,shares,saves,conversas,cadastros,compras,visitas,post_engagement,impressions,clicks,reach&account_id=eq.${CONTA_VESSEL}&captured_at=gte.${inicio}&captured_at=lte.${fim}&period_days=eq.0`),
    sb(`followers_leituras?select=followers_count,lido_em,origem&account_id=eq.${CONTA_VESSEL}&lido_em=gte.${desdeSeguidores}&order=lido_em.asc`),
    // Leads/Leads Quentes de verdade (24/09/2026) — ver
    // docs/superpowers/specs/2026-09-24-chatwoot-leads-design.md.
    sb(`chatwoot_eventos?select=tipo&dia_br=gte.${inicio}&dia_br=lte.${fim}`),
  ])

  if (campanhas.erro) { erro.value = campanhas.erro; carregando.value = false; return }
  if (insights.erro) { erro.value = insights.erro; carregando.value = false; return }
  if (leituras.erro) { erro.value = leituras.erro; carregando.value = false; return }
  if (eventosChatwoot.erro) { erro.value = eventosChatwoot.erro; carregando.value = false; return }

  const nomesPorCampanha = Object.fromEntries(campanhas.map((c) => [c.campaign_id, c.name]))
  const objectivesPorCampanha = Object.fromEntries(campanhas.map((c) => [c.campaign_id, c.objective]))
  const campanhasDoPeriodo = agruparCampanhasDoDia(insights, nomesPorCampanha, objectivesPorCampanha)
  const deltas = deltaDeSeguidoresPorHora(leituras)
  const seguidoresDoPeriodo = seguidoresNoPeriodo(deltas, inicio, fim)
  const leadsChatwoot = {
    novo: eventosChatwoot.filter((e) => e.tipo === 'lead_novo').length,
    quente: eventosChatwoot.filter((e) => e.tipo === 'lead_quente').length,
  }

  dados.value = calcularDadosOpr(campanhasDoPeriodo, seguidoresDoPeriodo, leadsChatwoot)
  carregando.value = false
}

onMounted(() => carregar())
</script>

<style scoped>
.tela-relatorio-opr { min-height: 100vh; display: flex; flex-direction: column; background: var(--bg); }
.ropr-body { flex: 1; padding: var(--sp-6) var(--sp-6); display: flex; flex-direction: column; gap: var(--sp-5); }

/* Seletor de período — reskin pra combinar com o visual do relatório
   abaixo (papel/dourado). Deliberadamente fora dos tokens do
   PADRAO-DA-CENTRAL: pedido explícito do dono, esta tela é uma exceção. */
.ropr-periodo { display: flex; flex-wrap: wrap; align-items: center; gap: 14px; padding: 14px 18px; background: #fffefa; border: 1px solid #e7e4dc; border-radius: 8px; }
.ropr-atalhos { display: flex; flex-wrap: wrap; gap: 8px; }
.ropr-atalhos button { font: 400 13px/1 Georgia, "Times New Roman", serif; letter-spacing: .08em; text-transform: uppercase; padding: 9px 16px; border: 1px solid #d9d5cc; border-radius: 20px; background: #fff; color: #123b39; cursor: pointer; }
.ropr-atalhos button.ativo { background: #123b39; border-color: #123b39; color: #f4efe3; }
.ropr-intervalo { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; margin-left: auto; }
.ropr-campo-data { display: flex; flex-direction: column; gap: 2px; font: 400 10px/1 Inter, sans-serif; letter-spacing: .18em; text-transform: uppercase; color: #7b7b73; }
.ropr-campo-data input { min-height: 36px; padding: 0 10px; border: 1px solid #d9d5cc; border-radius: 5px; background: #fff; color: #123b39; font: 400 14px Georgia, serif; }
.ropr-aplicar { font: 400 13px/1 Georgia, serif; letter-spacing: .08em; text-transform: uppercase; padding: 9px 18px; border: none; border-radius: 20px; background: #b59a67; color: #173b39; cursor: pointer; }

/* A partir daqui: mesmo CSS de coletor/lib/template-opr.mjs (visual
   aprovado pelo dono em 17/09/2026, reformado em 21/09/2026 — grade 2×2),
   adaptado de imagem fixa 1600×900 pra página que rola — sem
   aspect-ratio/overflow:hidden, com quebra em telas estreitas. Qualquer
   ajuste de cor/fonte/ícone deve espelhar lá. */
.report, .report * { min-width: 0; }
.report {
  --ink:#123b39; --gold:#b59a67; --gold-soft:#f4efe3; --paper:#fffefa;
  --line:#e7e4dc; --line-2:#d9d5cc; --soft:#f8f6f0; --verde-relatorio:#195c52;
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  color: var(--ink);
  width: 100%;
  max-width: 1600px;
  margin: 0 auto;
  background: var(--paper);
  padding: 34px 34px 24px;
  display: grid;
  gap: 14px;
  box-shadow: 0 12px 60px rgba(0,0,0,.16);
  border-radius: 8px;
}
.header { display: grid; grid-template-columns: 1.8fr 1fr; gap: 26px; align-items: start; }
.eyebrow-line { width: 56px; height: 4px; background: var(--gold); margin: 2px 0 10px; }
.title { font: 700 clamp(28px,3vw,58px)/.96 Georgia, "Times New Roman", serif; letter-spacing: .02em; margin: 0; color: #123432; }
.subtitle { margin-top: 6px; font-size: clamp(14px,1.25vw,25px); letter-spacing: .13em; color: #686b68; }
.meta { display: grid; grid-template-columns: 1fr .9fr .7fr; min-height: 88px; border-left: 1px solid var(--line-2); }
.meta-item { padding: 10px 22px; border-right: 1px solid var(--line-2); }
.meta-label { font-size: 10px; letter-spacing: .32em; text-transform: uppercase; color: #7b7b73; margin-bottom: 8px; }
.meta-value { font: 400 18px Georgia, serif; color: #173b39; overflow-wrap: anywhere; }
.meta .accent::after { content: ""; display: block; width: 28px; height: 3px; background: var(--gold); margin-top: 15px; }
.kpis { display: grid; grid-template-columns: repeat(5,1fr); gap: 14px; }
.kpi-card { border: 1px solid var(--line); border-radius: 7px; padding: 16px 16px; display: grid; grid-template-columns: 54px 1fr; align-items: center; min-height: 124px; box-shadow: 0 1px 0 rgba(0,0,0,.025); }
.icon-circle { width: 54px; height: 54px; border-radius: 50%; background: var(--gold-soft); display: grid; place-items: center; color: var(--ink); }
.icon-circle svg { width: 30px; height: 30px; stroke: currentColor; fill: none; stroke-width: 2.2; stroke-linecap: round; stroke-linejoin: round; }
.kpi-label { font: 400 14px Georgia, serif; margin-bottom: 3px; overflow-wrap: anywhere; }
.kpi-value { font: 700 clamp(18px,1.6vw,32px)/1.05 Georgia, serif; letter-spacing: .02em; white-space: nowrap; }
.kpi-caption { margin-top: 9px; font-size: 9px; letter-spacing: .2em; text-transform: uppercase; color: #797b77; }
.kpi-card--grupo { grid-template-columns: 40px 1fr; column-gap: 14px; padding: 16px 14px; min-height: 108px; align-items: center; }
.kpi-card--grupo .icon-circle { width: 40px; height: 40px; }
.kpi-card--grupo .icon-circle svg { width: 22px; height: 22px; }
.kpi-group { display: flex; flex-direction: column; gap: 7px; margin-top: 9px; }
.kpi-group-item { display: flex; align-items: baseline; gap: 7px; min-width: 0; }
.kpi-group-value { font: 700 15px Georgia, serif; line-height: 1.3; white-space: nowrap; }
.kpi-group-label { font-size: 9px; letter-spacing: .14em; text-transform: uppercase; color: #797b77; white-space: nowrap; }
/* Grade 2×2 — cada painel com a mesma largura que os 3-em-linha tinham
   antes (metade da tela, não um quarto), pra caber Tráfego + Engajamento +
   Vendas + Leads sem espremer número/rótulo. `align-items: stretch`
   (padrão do grid, mas explícito aqui) — de propósito, e não `start`
   (23/09/2026): desde que Seguidores ganhou curtida/comentário/compart./
   salv., ele ficou mais alto que Tráfego na mesma linha, e com `start` os
   dois painéis da linha ficavam de tamanho diferente. Esticando, o `.panel`
   (flex column) e o `margin-top: auto` do `.panel-note` cuidam de empurrar
   a nota pro rodapé sozinhos, sem sobrar buraco nem esconder nada. */
.sections { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; align-items: stretch; }
.panel { border: 1px solid var(--line); border-radius: 7px; padding: 12px 14px 10px; display: flex; flex-direction: column; min-width: 0; }
.panel-head { display: grid; grid-template-columns: 76px 1fr; gap: 14px; align-items: center; padding: 2px 4px 14px; border-bottom: 1px solid var(--line); }
.panel-num { font: 400 40px Georgia, serif; color: var(--gold); padding-right: 12px; border-right: 1px solid #8e8d86; }
.panel-title { font: 700 28px Georgia, serif; line-height: 1.05; }
.panel-sub { font-size: 10px; letter-spacing: .24em; text-transform: uppercase; color: #747975; margin-top: 5px; }
.metric-grid { display: grid; gap: 0; margin-top: 11px; grid-template-columns: repeat(auto-fit, minmax(120px,1fr)); }
.panel-bottom { border-top: 1px solid var(--line); margin-top: 10px; padding-top: 8px; }
.metric { padding: 6px 8px; min-width: 0; }
.metric:not(:first-child) { border-left: 1px solid var(--line); }
.metric-label { font-size: 12px; color: #58635f; line-height: 1.25; overflow-wrap: anywhere; height: 30px; display: flex; align-items: flex-end; }
.metric-value { font: 700 18px Georgia, serif; line-height: 1.15; margin-top: 9px; overflow-wrap: anywhere; }
.metric.center { text-align: center; }
.panel-note { margin-top: auto; min-height: 74px; background: var(--soft); display: grid; grid-template-columns: 74px 1fr; align-items: center; padding: 10px 14px; gap: 0 0; }
.panel-note .icon-circle { width: 56px; height: 56px; }
.panel-note .icon-circle svg { width: 28px; height: 28px; }
.note-text { font: italic 17px/1.15 Georgia, serif; color: #48615d; }
.footer { display: grid; grid-template-columns: 1.35fr .9fr; gap: 20px; align-items: end; }
.footer-left { border-top: 2px solid #aaa9a3; padding: 18px 22px 0; font-size: 11px; letter-spacing: .29em; text-transform: uppercase; color: #9a9690; min-height: 84px; }
.mix-card { border: 1px solid var(--line); border-radius: 6px; padding: 8px 12px; display: grid; grid-template-columns: 1fr 190px; gap: 16px; align-items: center; }
.mix-title { font: 700 17px Georgia, serif; }
.mix-sub { font-size: 9px; letter-spacing: .26em; color: #8c8d87; text-transform: uppercase; margin-top: 1px; }
.mix-row { display: grid; grid-template-columns: 72px 1fr minmax(45px,auto); gap: 10px; align-items: center; margin-top: 9px; font-size: 11px; }
.mix-row strong { white-space: nowrap; }
.bar { height: 10px; background: #e9e9e6; border-radius: 4px; overflow: hidden; }
.bar span { display: block; height: 100%; background: var(--verde-relatorio); }
.mix-side { border-left: 1px solid var(--line-2); padding-left: 18px; font: italic 15px/1.25 Georgia, serif; color: #52645f; }
.mix-side small { display: block; font: 9px/1.5 Inter, sans-serif; letter-spacing: .25em; text-transform: uppercase; color: #aaa59c; margin-top: 10px; }
.mix-side small::after { content: ""; display: block; width: 28px; height: 2px; background: var(--gold); margin-top: 8px; }

@media (max-width: 900px) {
  .header { grid-template-columns: 1fr; }
  .meta { grid-template-columns: 1fr; border-left: none; min-height: 0; }
  .meta-item { border-right: none; border-bottom: 1px solid var(--line-2); }
  .kpis { grid-template-columns: repeat(2,1fr); }
  .sections { grid-template-columns: 1fr; }
  .footer { grid-template-columns: 1fr; }
  .mix-card { grid-template-columns: 1fr; }
  .mix-side { border-left: none; border-top: 1px solid var(--line-2); padding-left: 0; padding-top: 12px; margin-top: 4px; }
}
@media (max-width: 640px) {
  .ropr-body { padding: var(--sp-4) var(--sp-3); }
  .ropr-intervalo { margin-left: 0; width: 100%; }
  .report { padding: 20px 16px 16px; }
  .kpis { grid-template-columns: 1fr; }
  .metric-grid { grid-template-columns: repeat(auto-fit, minmax(110px,1fr)); }
}
</style>
