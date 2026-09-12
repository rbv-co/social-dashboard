<template>
  <!-- Relatório interativo (só leitura, só admin) do histórico coletado por dia e por perfil.
       Fonte: banco (daily_snapshots + engagement/content/account snapshots period_days=1).
       Para curadoria e conferência. Vue declarativo (estado reativo + v-for). -->
  <div class="tela-relatorio">
    <barra-de-topo voltar="Redes" titulo="Relatório Interativo" @voltar="voltar" />

    <div class="rel-controles">
      <div class="rel-grupo-controle">
        <label class="rel-lbl">Perfil</label>
        <select class="rel-select" v-model="contaId" @change="carregar">
          <option v-for="c in contas" :key="c.id" :value="c.id">{{ c.name }}</option>
        </select>
      </div>
      <div class="rel-grupo-controle">
        <label class="rel-lbl">Período</label>
        <div class="rel-seg">
          <button v-for="p in PERIODOS" :key="p.v" class="rel-seg-btn" :class="{ ativo: periodo === p.v }" @click="setPeriodo(p.v)">{{ p.label }}</button>
        </div>
      </div>
      <div class="rel-grupo-controle rel-grupo-toggles">
        <label class="rel-lbl">Colunas</label>
        <div class="rel-chips">
          <button v-for="g in GRUPOS" :key="g.key" class="rel-chip" :class="{ ativo: grupos[g.key] }" @click="grupos[g.key] = !grupos[g.key]">{{ g.label }}</button>
        </div>
      </div>
      <div class="rel-grupo-controle rel-grupo-export" v-if="podeExportar">
        <label class="rel-lbl">Exportar</label>
        <div class="rel-export-btns">
          <button class="rel-export" @click="exportar('xls')">Excel</button>
          <button class="rel-export" @click="exportar('csv')">CSV</button>
        </div>
      </div>
    </div>

    <div class="rel-info">
      <span v-if="carregando">Carregando…</span>
      <span v-else>{{ linhasFiltradas.length }} dias · {{ contaNome }}</span>
    </div>

    <div class="rel-nota" v-if="temHoje && !carregando">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
      <span>O dia de <b>hoje</b> ainda está em andamento — a linha só fecha com a leitura das <b>23h59</b>. Até lá os números são parciais.</span>
    </div>

    <div class="rel-tabela-scroll">
      <table class="rel-tabela">
        <thead>
          <tr>
            <th v-for="col in colunasVisiveis" :key="col.key"
                :class="{ 'col-forte': col.forte, ativo: ordCol === col.key }"
                @click="ordenar(col.key)">
              {{ col.label }}<span class="rel-ord" v-if="ordCol === col.key">{{ ordDir === 'asc' ? '▲' : '▼' }}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(r, i) in linhasFiltradas" :key="r.dia">
            <td v-for="col in colunasVisiveis" :key="col.key"
                :title="col.tipo === 'net' && r.liquidoContagem ? 'Líquido pela variação da contagem (a Meta ainda não fechou seguiu/saiu deste dia)' : null"
                :class="[col.tipo, { 'col-forte': col.forte, 'net-up': col.tipo === 'net' && r.liquido > 0, 'net-down': col.tipo === 'net' && r.liquido < 0, 'net-contagem': col.tipo === 'net' && r.liquidoContagem }]">
              {{ fmt(col, col.key === 'dia' ? r.dia : r[col.key]) }}
            </td>
          </tr>
          <tr v-if="!carregando && !linhasFiltradas.length"><td :colspan="colunasVisiveis.length" class="rel-vazio">Sem dados no período.</td></tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import BarraDeTopo from '../../compartilhado/barra-de-topo.vue'
import { useRouter } from 'vue-router'
import { estado, hasPermission, contasPermitidas } from '../../compartilhado/controle-de-login-e-usuario.js'
import { sbClient } from '../../compartilhado/conectar-no-banco-de-dados.js'
import { adminToast } from '../../compartilhado/avisos.js'

const router = useRouter()

const PERIODOS = [{ v: '30', label: '30 dias' }, { v: '90', label: '90 dias' }, { v: 'tudo', label: 'Tudo' }]
const GRUPOS = [
  { key: 'seguidores', label: 'Seguidores' }, { key: 'engajamento', label: 'Engajamento' },
  { key: 'conteudo', label: 'Conteúdo' }, { key: 'ads', label: 'Ads' },
]
// tipo: data | int | net | money. forte = destaque (Total). grupo 'base' sempre visível.
const COLS = [
  { key: 'dia', label: 'Dia', grupo: 'base', tipo: 'data' },
  { key: 'gained', label: 'Seguiram', grupo: 'seguidores', tipo: 'int' },
  { key: 'lost', label: 'Saíram', grupo: 'seguidores', tipo: 'int' },
  { key: 'liquido', label: 'Líquido', grupo: 'seguidores', tipo: 'net' },
  { key: 'followers_count', label: 'Total', grupo: 'seguidores', tipo: 'int', forte: true },
  { key: 'reach', label: 'Alcance', grupo: 'engajamento', tipo: 'int' },
  { key: 'views', label: 'Views', grupo: 'engajamento', tipo: 'int' },
  { key: 'total_interactions', label: 'Interações', grupo: 'engajamento', tipo: 'int' },
  { key: 'likes', label: 'Curtidas', grupo: 'engajamento', tipo: 'int' },
  { key: 'comments', label: 'Coment.', grupo: 'engajamento', tipo: 'int' },
  { key: 'saves', label: 'Salvam.', grupo: 'engajamento', tipo: 'int' },
  { key: 'shares', label: 'Compart.', grupo: 'engajamento', tipo: 'int' },
  { key: 'profile_views', label: 'Visitas', grupo: 'engajamento', tipo: 'int' },
  { key: 'posts_count', label: 'Posts', grupo: 'conteudo', tipo: 'int' },
  { key: 'reels_count', label: 'Reels', grupo: 'conteudo', tipo: 'int' },
  { key: 'stories_count', label: 'Stories', grupo: 'conteudo', tipo: 'int' },
  { key: 'spend', label: 'Gasto', grupo: 'ads', tipo: 'money' },
  { key: 'impressions', label: 'Impressões', grupo: 'ads', tipo: 'int' },
]

const contas = ref([])
const contaId = ref(null)
const periodo = ref('30')
const grupos = reactive({ seguidores: true, engajamento: true, conteudo: true, ads: true })
const linhas = ref([])
const carregando = ref(false)
const ordCol = ref('dia')
const ordDir = ref('desc')

const contaNome = computed(() => contas.value.find(c => c.id === contaId.value)?.name || '')
const podeExportar = computed(() => hasPermission('social.relatorio', 'exportar'))
const colunasVisiveis = computed(() => COLS.filter(c => c.grupo === 'base' || grupos[c.grupo]))
const linhasFiltradas = computed(() => {
  const arr = [...linhas.value]
  const col = ordCol.value, dir = ordDir.value === 'asc' ? 1 : -1
  arr.sort((a, b) => {
    if (col === 'dia') { return (a.dia < b.dia ? -1 : a.dia > b.dia ? 1 : 0) * dir }
    return ((Number(a[col]) || 0) - (Number(b[col]) || 0)) * dir
  })
  return arr
})

// A linha do dia corrente é sempre parcial: o coletor só grava o fechamento na rodada das 23h59 BRT
// (o upsert sobrescreve, então a última rodada do dia = valor final). Avisa quando "hoje" está na tabela.
const hojeBR = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })
const temHoje = computed(() => linhas.value.some(r => r.dia === hojeBR))

function dataMenos(dias) {
  const hoje = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })
  const dt = new Date(`${hoje}T12:00:00-03:00`); dt.setDate(dt.getDate() - dias)
  return dt.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })
}

async function carregar() {
  if (!contaId.value) return
  carregando.value = true
  const desde = periodo.value === 'tudo' ? null : dataMenos(periodo.value === '30' ? 30 : 90)
  const q = (tabela, cols, diario) => {
    let s = sbClient.from(tabela).select(cols).eq('account_id', contaId.value)
    if (diario) s = s.eq('period_days', 1)
    if (desde) s = s.gte('captured_at', desde)
    return s
  }
  // Ads por DIA = campaign_insights com period_days=0 (o dia único), SOMADO por campanha. NÃO usar
  // account_insights nem pd=1: o pd=1 coleta a janela [ontem, hoje] = 2 dias (time_range inclusivo) → infla.
  let adsQ = sbClient.from('campaign_insights').select('captured_at,spend,impressions').eq('account_id', contaId.value).eq('period_days', 0)
  if (desde) adsQ = adsQ.gte('captured_at', desde)
  const [ds, eng, cont, ads, hist] = await Promise.all([
    q('daily_snapshots', 'captured_at,followers_count,gained,lost', false),
    q('engagement_snapshots', 'captured_at,reach,views,total_interactions,likes,comments,saves,shares,profile_views', true),
    q('content_snapshots', 'captured_at,posts_count,reels_count,stories_count', true),
    adsQ,
    // histórico COMPLETO da contagem (sem filtro de período) p/ o líquido pela variação da contagem
    // nos dias que a Meta ainda não fechou o bruto (gained/lost = 0/0) — mesma lógica da dashboard.
    sbClient.from('daily_snapshots').select('captured_at,followers_count').eq('account_id', contaId.value).order('captured_at'),
  ])
  // soma o gasto/impressões das campanhas por dia (o dia recente ainda acumula → prévia; dias fechados batem).
  const adsPorDia = {}
  for (const r of (ads.data || [])) {
    const d = adsPorDia[r.captured_at] || { spend: 0, impressions: 0 }
    d.spend += Number(r.spend) || 0; d.impressions += Number(r.impressions) || 0
    adsPorDia[r.captured_at] = d
  }
  // delta de contagem por dia = total do dia − total do dia anterior (a contagem é sempre exata).
  const deltaContagem = {}
  let ant = null
  for (const r of (hist.data || [])) { if (ant) deltaContagem[r.captured_at] = (Number(r.followers_count) || 0) - (Number(ant.followers_count) || 0); ant = r }
  const mapa = {}
  const juntar = (rows) => { for (const r of (rows || [])) mapa[r.captured_at] = { ...(mapa[r.captured_at] || {}), ...r } }
  juntar(ds.data); juntar(eng.data); juntar(cont.data)
  linhas.value = Object.values(mapa).map(r => {
    const temBruto = (Number(r.gained) || 0) !== 0 || (Number(r.lost) || 0) !== 0
    // dia consolidado → gained−lost (bate com Seguiram/Saíram); dia ainda 0/0 → variação da contagem (como a dashboard).
    const liquido = temBruto ? ((Number(r.gained) || 0) - (Number(r.lost) || 0)) : (deltaContagem[r.captured_at] ?? null)
    const ad = adsPorDia[r.captured_at]
    return {
      ...r, dia: r.captured_at, liquido, liquidoContagem: !temBruto && liquido != null,
      spend: ad ? ad.spend : undefined, impressions: ad ? ad.impressions : undefined,
    }
  })
  carregando.value = false
}

function setPeriodo(v) { periodo.value = v; carregar() }
function ordenar(col) {
  if (ordCol.value === col) ordDir.value = ordDir.value === 'asc' ? 'desc' : 'asc'
  else { ordCol.value = col; ordDir.value = 'desc' }
}

function fmt(col, v) {
  if (v === null || v === undefined) return '—'
  if (col.tipo === 'data') { const dt = new Date(v + 'T12:00:00'); return dt.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' }) }
  if (col.tipo === 'money') return 'R$ ' + Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  if (col.tipo === 'net') return (v > 0 ? '+' : '') + Number(v).toLocaleString('pt-BR')
  return Number(v).toLocaleString('pt-BR')
}

function exportar(tipo) {
  const cols = colunasVisiveis.value
  const header = cols.map(c => c.label)
  const linhasExp = linhasFiltradas.value.map(r => cols.map(c => {
    const v = c.key === 'dia' ? r.dia : r[c.key]
    if (c.key === 'dia') { const dt = new Date(v + 'T12:00:00'); return dt.toLocaleDateString('pt-BR') }
    return v == null ? '' : v
  }))
  const nome = 'relatorio-redes-' + (contaNome.value || 'perfil').toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-' + periodo.value
  if (tipo === 'xls' && window.XLSX) {
    const ws = window.XLSX.utils.aoa_to_sheet([header, ...linhasExp])
    const wb = window.XLSX.utils.book_new()
    window.XLSX.utils.book_append_sheet(wb, ws, 'Relatório')
    window.XLSX.writeFile(wb, nome + '.xlsx')
  } else {
    const csv = [header, ...linhasExp].map(l => l.map(c => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\n')
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = nome + '.csv'
    document.body.appendChild(a); a.click(); a.remove()
  }
}

onMounted(async () => {
  if (!hasPermission('social.relatorio', 'ver')) { adminToast('Sem acesso', false); router.push({ name: 'inicio' }); return }
  const { data } = await sbClient.from('accounts').select('id,name').order('name')
  const permitidas = contasPermitidas() // null = todos
  contas.value = (data || []).filter(c => !permitidas || permitidas.includes(c.id))
  if (contas.value.length) { contaId.value = contas.value[0].id; await carregar() }
})

function voltar() { router.push({ name: 'redes' }) }

const logoClaroUrl = '/midia/LOGOTIPOBRENOPRETO.png'
const logoEscuroUrl = '/midia/LOGOTIPOBRENOBRANCO.png'
</script>

<style scoped>
/* Fundo TRANSPARENTE: o #bg-shapes (degradê + ícones) fica fixo atrás de tudo
   pra aparecer, e o body já pinta a cor base nos DOIS temas. Pintar cor sólida
   aqui tapava a decoração e ainda deixava uma faixa visível onde a tela
   terminava. */
.tela-relatorio{min-height:100vh;display:flex;flex-direction:column;background:transparent;position:relative;z-index:1;}
.rel-topbar .rbv-logo{height:24px;width:auto;}
.rel-topbar{display:flex;align-items:center;justify-content:space-between;padding:13px 24px;border-bottom:1px solid var(--border);background:var(--surface);gap:16px;position:sticky;top:0;z-index:20;}
.rel-back{font-family:'IBM Plex Sans',sans-serif;font-size:max(9px, calc(10px * var(--escala-texto, 1)));font-weight:700;letter-spacing:2px;text-transform:uppercase;color:var(--accent);cursor:pointer;background:none;border:1px solid var(--accent-mid);border-radius:5px;padding:5px 10px;display:flex;align-items:center;gap:5px;transition:background .15s;}
.rel-back:hover{background:var(--accent-light);}
.rel-title{font-family:'Oswald',sans-serif;font-size:max(9px, calc(15px * var(--escala-texto, 1)));font-weight:500;letter-spacing:2.5px;text-transform:uppercase;color:var(--text);}

.rel-controles{display:flex;flex-wrap:wrap;align-items:flex-end;gap:22px;padding:18px 28px;border-bottom:1px solid var(--border);background:var(--surface);}
.rel-grupo-controle{display:flex;flex-direction:column;gap:6px;}
.rel-lbl{font-family:'IBM Plex Sans',sans-serif;font-size:max(9px, calc(9px * var(--escala-texto, 1)));font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:var(--muted);}
.rel-select{font-family:'IBM Plex Sans',sans-serif;font-size:max(9px, calc(12px * var(--escala-texto, 1)));padding:7px 12px;border-radius:6px;border:1.5px solid var(--border);background:var(--bg);color:var(--text);cursor:pointer;outline:none;min-width:190px;}
.rel-select:focus{border-color:var(--accent);}
.rel-seg{display:flex;gap:4px;}
.rel-seg-btn{font-family:'IBM Plex Sans',sans-serif;font-size:max(9px, calc(11px * var(--escala-texto, 1)));font-weight:600;padding:7px 13px;border-radius:6px;border:1px solid var(--border);background:var(--bg);color:var(--muted);cursor:pointer;transition:all .15s;}
.rel-seg-btn.ativo{background:var(--accent);color:var(--sobre-cor);border-color:var(--accent);}
.rel-chips{display:flex;gap:6px;flex-wrap:wrap;}
.rel-chip{font-family:'IBM Plex Sans',sans-serif;font-size:max(9px, calc(11px * var(--escala-texto, 1)));font-weight:600;padding:6px 12px;border-radius:20px;border:1px solid var(--border);background:var(--bg);color:var(--muted);cursor:pointer;transition:all .15s;}
.rel-chip.ativo{background:var(--accent-light);color:var(--accent-forte);border-color:var(--accent-mid);}
.rel-export-btns{display:flex;gap:6px;}
.rel-export{font-family:'IBM Plex Sans',sans-serif;font-size:max(9px, calc(11px * var(--escala-texto, 1)));font-weight:700;letter-spacing:.5px;padding:7px 14px;border-radius:6px;border:1px solid var(--accent-mid);background:var(--bg);color:var(--accent);cursor:pointer;transition:all .15s;}
.rel-export:hover{background:var(--accent);color:var(--sobre-cor);}

.rel-info{font-family:'IBM Plex Sans',sans-serif;font-size:max(9px, calc(11px * var(--escala-texto, 1)));color:var(--muted);padding:10px 28px 0;}
.rel-nota{display:flex;align-items:center;gap:8px;margin:8px 28px 0;padding:8px 12px;border-radius:8px;background:rgba(59,130,246,.08);border:1px solid rgba(59,130,246,.22);color:var(--muted);font-family:'IBM Plex Sans',sans-serif;font-size:max(9px, calc(11.5px * var(--escala-texto, 1)));line-height:1.35;}
.rel-nota svg{flex-shrink:0;color:var(--accent);}
.rel-nota b{color:var(--fg,#e5e7eb);font-weight:600;}

.rel-tabela-scroll{flex:1;overflow:auto;padding:14px 28px 40px;}
.rel-tabela{border-collapse:separate;border-spacing:0;width:100%;font-family:'IBM Plex Sans',sans-serif;font-variant-numeric:tabular-nums;}
.rel-tabela th{position:sticky;top:0;background:var(--surface);z-index:2;font-size:max(9px, calc(10px * var(--escala-texto, 1)));font-weight:700;letter-spacing:.5px;text-transform:uppercase;color:var(--muted);padding:9px 12px;text-align:right;white-space:nowrap;cursor:pointer;border-bottom:2px solid var(--border);user-select:none;transition:color .15s;}
.rel-tabela th:first-child{text-align:left;}
.rel-tabela th:hover{color:var(--accent);}
.rel-tabela th.ativo{color:var(--accent);}
.rel-tabela th.col-forte{color:var(--text);}
.rel-ord{margin-left:3px;font-size:max(9px, calc(8px * var(--escala-texto, 1)));}
.rel-tabela td{font-size:max(9px, calc(12px * var(--escala-texto, 1)));color:var(--text);padding:8px 12px;text-align:right;white-space:nowrap;border-bottom:1px solid var(--border);}
.rel-tabela td.data{text-align:left;font-weight:600;color:var(--muted);}
.rel-tabela td.col-forte{font-weight:700;color:var(--accent);}
.rel-tabela td.net-up{color:var(--green);font-weight:600;}
.rel-tabela td.net-down{color:var(--red);font-weight:600;}
.rel-tabela td.net-contagem{text-decoration:underline dotted;text-underline-offset:3px;cursor:help;}
.rel-tabela tbody tr:nth-child(even) td{background:color-mix(in srgb, var(--surface) 45%, transparent);}
.rel-tabela tbody tr:hover td{background:var(--accent-light);}
.rel-vazio{text-align:center!important;color:var(--muted);padding:40px!important;font-style:italic;}

@media(max-width:640px){
  /* Topbar mais baixa no celular: menos padding e título menor */
  .rel-topbar{padding:8px 14px;}
  .rel-title{font-size:max(9px, calc(12px * var(--escala-texto, 1)));letter-spacing:1.5px;}
  .rel-controles{padding:14px 16px;gap:14px;}
  .rel-tabela-scroll{padding:10px 12px 30px;}
  .rel-select{min-width:150px;}
}
</style>
