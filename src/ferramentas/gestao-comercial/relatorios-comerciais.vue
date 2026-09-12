<template>
  <div class="gc-rel">
    <!-- Filtros -->
    <div class="gc-rel-filtros">
      <label>Canal
        <select v-model="canal">
          <option value="0">Consolidado</option>
          <option v-for="c in CANAIS" :key="c.id" :value="c.id">{{ c.nome }}</option>
        </select>
      </label>
      <label>Período
        <select v-model="periodo">
          <option value="mes-atual">Mês atual</option>
          <option value="mes-passado">Mês passado</option>
          <option value="ano">Ano ({{ anoAtual }})</option>
          <option value="custom">Personalizado</option>
        </select>
      </label>
      <template v-if="periodo === 'custom'">
        <label>De <input type="month" v-model="mesIni"></label>
        <label>Até <input type="month" v-model="mesFim"></label>
      </template>
      <label>Tipo de bolsa
        <select v-model="filtroCategoria">
          <option value="todas">Todas</option>
          <option v-for="c in categoriasDisponiveis" :key="c" :value="c">{{ c }}</option>
        </select>
      </label>
      <label v-if="relatorio === 'bcg'">Quadrante
        <select v-model="filtroQuadrante">
          <option value="todos">Todos</option>
          <option v-for="q in QUADRANTES" :key="q.id" :value="q.nome">{{ q.nome }}</option>
        </select>
      </label>
      <label v-if="!['categoria', 'menos', 'ruptura'].includes(relatorio)">Granularidade
        <select v-model="granularidade">
          <option value="sku">Por item (SKU)</option>
          <option value="categoria">Por categoria</option>
        </select>
      </label>
      <div class="gc-rel-sel">
        <button v-for="r in RELATORIOS" :key="r.id" type="button"
                :class="{ on: relatorio === r.id }" @click="selecionarRelatorio(r.id)">{{ r.nome }}</button>
      </div>
    </div>

    <div v-if="carregando" class="gc-rel-msg">Carregando…</div>
    <div v-else-if="erro" class="gc-rel-msg erro">{{ erro }}</div>
    <div v-else-if="semDados" class="gc-rel-msg">Sem dados para os filtros selecionados.</div>

    <template v-else>
      <div class="gc-rel-head">
        <span class="gc-rel-tot">{{ linhas.length }} {{ granularidade === 'sku' ? 'itens' : 'categorias' }}</span>
        <span class="gc-rel-tot">Faturamento: <b>{{ fmtR(totalFat) }}</b></span>
        <button type="button" class="gc-info-btn" :class="{ on: ajuda }" title="Entenda este relatório" @click="ajuda = !ajuda">?</button>
        <span v-if="relatorio !== 'categoria'" class="gc-rel-hint">Clique num cabeçalho pra ordenar</span>
        <button v-if="podeExportar" type="button" class="gc-rel-exp" @click="exportar">↓ Exportar</button>
      </div>

      <div v-if="ajuda" class="gc-rel-ajuda">
        <div class="gc-rel-ajuda-t">{{ ajudaAtual.t }}</div>
        <ul><li v-for="(x, i) in ajudaAtual.p" :key="i" v-html="x"></li></ul>
      </div>

      <!-- Curva ABC -->
      <div v-if="relatorio === 'abc'" class="gc-rel-tbwrap">
        <table class="gc-rel-tb">
          <thead><tr>
            <th class="s" @click="ordenar('classe')">Classe{{ caret('classe') }}</th>
            <th class="l s" @click="ordenar('produto')">{{ rotuloChave }}{{ caret('produto') }}</th>
            <th class="l s" v-if="granularidade === 'sku'" @click="ordenar('categoria')">Categoria{{ caret('categoria') }}</th>
            <th class="s" @click="ordenar('unidades')">Unid.{{ caret('unidades') }}</th>
            <th class="s" @click="ordenar('faturamento')">Faturamento{{ caret('faturamento') }}</th>
            <th class="s" @click="ordenar('pct')">%{{ caret('pct') }}</th>
            <th class="s" @click="ordenar('pctAcum')">% acum.{{ caret('pctAcum') }}</th>
          </tr></thead>
          <tbody>
            <tr v-for="l in abcView" :key="l.chave">
              <td><span class="gc-badge" :class="'abc-' + l.classe">{{ l.classe }}</span></td>
              <td class="l">{{ l.produto }}</td>
              <td class="l" v-if="granularidade === 'sku'">{{ l.categoria }}</td>
              <td class="n">{{ l.unidades }}</td>
              <td class="n">{{ fmtR(l.faturamento) }}</td>
              <td class="n">{{ fmtPct(l.pct) }}</td>
              <td class="n">{{ fmtPct(l.pctAcum) }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Matriz BCG -->
      <div v-else-if="relatorio === 'bcg'" class="gc-rel-bcg">
        <div class="gc-bcg-scatter">
          <svg :viewBox="`0 0 ${SW} ${SH}`" preserveAspectRatio="xMidYMid meet">
            <!-- fundos dos 4 quadrantes -->
            <rect class="gc-bcg-q q-interrogacao" x="0" y="0" :width="sx(medPart)" :height="sy(medCresc)" />
            <rect class="gc-bcg-q q-estrela" :x="sx(medPart)" y="0" :width="SW - sx(medPart)" :height="sy(medCresc)" />
            <rect class="gc-bcg-q q-abacaxi" x="0" :y="sy(medCresc)" :width="sx(medPart)" :height="SH - sy(medCresc)" />
            <rect class="gc-bcg-q q-vaca" :x="sx(medPart)" :y="sy(medCresc)" :width="SW - sx(medPart)" :height="SH - sy(medCresc)" />
            <!-- linhas medianas -->
            <line :x1="sx(medPart)" y1="0" :x2="sx(medPart)" :y2="SH" class="gc-bcg-med" />
            <line x1="0" :y1="sy(medCresc)" :x2="SW" :y2="sy(medCresc)" class="gc-bcg-med" />
            <!-- rótulos dos quadrantes -->
            <text x="8" y="18" class="gc-bcg-qlbl q-interrogacao">Interrogação</text>
            <text :x="SW - 8" y="18" class="gc-bcg-qlbl q-estrela r">Estrela</text>
            <text x="8" :y="SH - 8" class="gc-bcg-qlbl q-abacaxi">Abacaxi</text>
            <text :x="SW - 8" :y="SH - 8" class="gc-bcg-qlbl q-vaca r">Vaca leiteira</text>
            <!-- eixos -->
            <text :x="SW - 8" :y="sy(medCresc) - 6" class="gc-bcg-axl r">participação no faturamento →</text>
            <text x="8" y="32" class="gc-bcg-axl">↑ crescimento vs período anterior</text>
            <!-- pontos -->
            <circle v-for="(p, i) in bcgPontos" :key="i" :cx="p.x" :cy="p.y" r="5" :class="'q-' + p.q"
                    :opacity="p.destaque ? 0.9 : 0.12">
              <title>{{ p.nome }} — {{ p.quadrante }} · Participação {{ fmtPct(p.participacao) }} · {{ p.novo ? (p.tipoNovo === 'dormante' ? ('dormante — 1ª venda ' + (p.primeiraVenda || '?') + ', sem venda no período anterior') : 'novo — 1ª venda no período atual') : 'Crescimento ' + fmtPct(p.crescimento) }}</title>
            </circle>
          </svg>
          <div class="gc-bcg-leg">
            <button v-for="q in QUADRANTES" :key="q.id" type="button" class="gc-bcg-legbtn"
                    :class="{ off: filtroQuadrante !== 'todos' && filtroQuadrante !== q.nome }"
                    @click="filtroQuadrante = filtroQuadrante === q.nome ? 'todos' : q.nome">
              <i :class="'q-' + q.id"></i>{{ q.nome }} ({{ contagem[q.id] || 0 }})
            </button>
          </div>
          <p v-if="bcgNovos || bcgDormantes" class="gc-bcg-nota">
            No topo (sem base no período anterior): <b class="gc-tag novo">{{ bcgNovos }} novo{{ bcgNovos === 1 ? '' : 's' }}</b> (1ª venda no período) e <b class="gc-tag dorm">{{ bcgDormantes }} dormante{{ bcgDormantes === 1 ? '' : 's' }}</b> (já vendeu antes, ficou parado). Não entram no cálculo da mediana de crescimento.
          </p>
        </div>
        <div class="gc-rel-tbwrap">
          <table class="gc-rel-tb">
            <thead><tr>
              <th class="s" @click="ordenar('quadrante')">Quadrante{{ caret('quadrante') }}</th>
              <th class="l s" @click="ordenar('produto')">{{ rotuloChave }}{{ caret('produto') }}</th>
              <th class="s" @click="ordenar('faturamento')">Faturamento{{ caret('faturamento') }}</th>
              <th class="s" @click="ordenar('participacao')">Participação{{ caret('participacao') }}</th>
              <th class="s" @click="ordenar('crescimento')">Crescimento{{ caret('crescimento') }}</th>
            </tr></thead>
            <tbody>
              <tr v-for="l in bcgView" :key="l.chave">
                <td><span class="gc-badge" :class="'q-' + quadKey(l.quadrante)">{{ l.quadrante }}</span></td>
                <td class="l">{{ l.produto }}</td>
                <td class="n">{{ fmtR(l.faturamento) }}</td>
                <td class="n">{{ fmtPct(l.participacao) }}</td>
                <td class="n" :class="l.novo ? '' : (l.crescimento < 0 ? 'neg' : 'pos')">
                  <span v-if="l.novo" class="gc-tag" :class="l.tipoNovo === 'dormante' ? 'dorm' : 'novo'"
                        :title="l.tipoNovo === 'dormante' ? ('Já vendeu antes (1ª venda ' + (l.primeiraVenda || '?') + '); ficou sem venda no período anterior') : 'Primeira venda no período atual'">
                    {{ l.tipoNovo === 'dormante' ? 'dormante' : 'novo' }}
                  </span>
                  <template v-else>{{ l.crescimento >= 0 ? '+' : '' }}{{ fmtPct(l.crescimento) }}</template>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- Mais vendidos -->
      <div v-else-if="relatorio === 'mais'" class="gc-rel-tbwrap">
        <table class="gc-rel-tb">
          <thead><tr>
            <th>#</th>
            <th class="l s" @click="ordenar('produto')">{{ rotuloChave }}{{ caret('produto') }}</th>
            <th class="l s" v-if="granularidade === 'sku'" @click="ordenar('categoria')">Categoria{{ caret('categoria') }}</th>
            <th class="s" @click="ordenar('unidades')">Unid.{{ caret('unidades') }}</th>
            <th class="s" @click="ordenar('faturamento')">Faturamento{{ caret('faturamento') }}</th>
          </tr></thead>
          <tbody>
            <tr v-for="(l, i) in maisView" :key="l.chave">
              <td class="n">{{ i + 1 }}</td>
              <td class="l">{{ l.produto }}</td>
              <td class="l" v-if="granularidade === 'sku'">{{ l.categoria }}</td>
              <td class="n">{{ l.unidades }}</td>
              <td class="n">{{ fmtR(l.faturamento) }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Menos vendidos / encalhados -->
      <div v-else-if="relatorio === 'menos'" class="gc-rel-tbwrap">
        <table class="gc-rel-tb">
          <thead><tr>
            <th class="l s" @click="ordenar('produto')">Item{{ caret('produto') }}</th>
            <th class="l s" @click="ordenar('categoria')">Categoria{{ caret('categoria') }}</th>
            <th class="s" @click="ordenar('unidades')">Unid. vendidas{{ caret('unidades') }}</th>
            <th class="s" @click="ordenar('faturamento')">Faturamento{{ caret('faturamento') }}</th>
            <th class="s" @click="ordenar('saldo')">Estoque{{ caret('saldo') }}</th>
            <th>Situação</th>
          </tr></thead>
          <tbody>
            <tr v-for="l in menosView" :key="l.chave">
              <td class="l">{{ l.produto }}</td>
              <td class="l">{{ l.categoria }}</td>
              <td class="n">{{ l.unidades }}</td>
              <td class="n">{{ fmtR(l.faturamento) }}</td>
              <td class="n">{{ l.saldo }}</td>
              <td><span v-if="l.unidades === 0 && l.saldo > 0" class="gc-badge alerta">Encalhado</span><span v-else class="gc-mut">—</span></td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Faturamento por categoria × canal -->
      <div v-else-if="relatorio === 'categoria'" class="gc-rel-tbwrap">
        <table class="gc-rel-tb">
          <thead><tr>
            <th class="l s" @click="ordenar('categoria')">Categoria{{ caret('categoria') }}</th>
            <th v-for="c in CANAIS" :key="c.id">{{ c.nome }}</th>
            <th class="s" @click="ordenar('total')">Total{{ caret('total') }}</th>
          </tr></thead>
          <tbody>
            <tr v-for="row in pivotView" :key="row.categoria">
              <td class="l">{{ row.categoria }}</td>
              <td class="n" v-for="c in CANAIS" :key="c.id">{{ fmtR(row.por[c.id] || 0) }}</td>
              <td class="n"><b>{{ fmtR(row.total) }}</b></td>
            </tr>
            <tr class="gc-rel-totrow">
              <td class="l"><b>Total</b></td>
              <td class="n" v-for="c in CANAIS" :key="c.id"><b>{{ fmtR(pivotTotais.por[c.id] || 0) }}</b></td>
              <td class="n"><b>{{ fmtR(pivotTotais.total) }}</b></td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Ruptura / cobertura -->
      <div v-else-if="relatorio === 'ruptura'" class="gc-rel-tbwrap">
        <p class="gc-rel-nota">Itens que vendem (≥ {{ MIN_VENDENDO }} un. no período) com cobertura projetada baixa. Dias de cobertura = estoque ÷ (unidades ÷ {{ diasDecorridos }} dias).</p>
        <table class="gc-rel-tb">
          <thead><tr>
            <th class="l s" @click="ordenar('produto')">Item{{ caret('produto') }}</th>
            <th class="l s" @click="ordenar('categoria')">Categoria{{ caret('categoria') }}</th>
            <th class="s" @click="ordenar('unidades')">Unid.{{ caret('unidades') }}</th>
            <th class="s" @click="ordenar('saldo')">Estoque{{ caret('saldo') }}</th>
            <th class="s" @click="ordenar('porDia')">Un./dia{{ caret('porDia') }}</th>
            <th class="s" @click="ordenar('diasCobertura')">Dias cobertura{{ caret('diasCobertura') }}</th>
            <th>Alerta</th>
          </tr></thead>
          <tbody>
            <tr v-for="l in rupturaView" :key="l.chave">
              <td class="l">{{ l.produto }}</td>
              <td class="l">{{ l.categoria }}</td>
              <td class="n">{{ l.unidades }}</td>
              <td class="n">{{ l.saldo }}</td>
              <td class="n">{{ l.porDia.toFixed(2) }}</td>
              <td class="n">{{ l.diasCobertura === Infinity ? '∞' : Math.round(l.diasCobertura) }}</td>
              <td><span v-if="l.alerta" class="gc-badge alerta">Repor</span><span v-else class="gc-mut">ok</span></td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted } from 'vue'
import { sbClient } from '../../compartilhado/conectar-no-banco-de-dados.js'
import { hasPermission } from '../../compartilhado/controle-de-login-e-usuario.js'

const CANAIS = [
  { id: '205834140', nome: 'Tivoli' },
  { id: '205657609', nome: 'Dom Pedro' },
  { id: '205451611', nome: 'Atacado' },
]
const DEPS_POR_CANAL = { '205834140': '14888726315', '205657609': '14888617206', '205451611': '14888248253' }
const RELATORIOS = [
  { id: 'abc', nome: 'Curva ABC' },
  { id: 'bcg', nome: 'Matriz BCG' },
  { id: 'mais', nome: 'Mais vendidos' },
  { id: 'menos', nome: 'Encalhados' },
  { id: 'categoria', nome: 'Categoria × canal' },
  { id: 'ruptura', nome: 'Ruptura' },
]
const QUADRANTES = [
  { id: 'estrela', nome: 'Estrela' }, { id: 'vaca', nome: 'Vaca leiteira' },
  { id: 'interrogacao', nome: 'Interrogação' }, { id: 'abacaxi', nome: 'Abacaxi' },
]
const MIN_VENDENDO = 2

// Textos de ajuda por relatório (o "?" abre; explica termos p/ dono não-técnico)
const GC_AJUDA = {
  abc: { t: 'Curva ABC — o que é', p: [
    'Ordena os itens do <b>maior pro menor faturamento</b> e vai somando o percentual acumulado.',
    '<b>Classe A</b>: os itens que juntos somam até <b>80%</b> do faturamento — os que mais importam, foco de estoque e vitrine.',
    '<b>Classe B</b>: os próximos, até 95%. <b>Classe C</b>: a cauda (últimos 5%), muitos itens de pouco peso.',
    '<b>%</b> = quanto o item pesa no total. <b>% acum.</b> = a soma acumulada até aquele item.',
  ] },
  bcg: { t: 'Matriz BCG — o que é', p: [
    'Cruza <b>participação no faturamento</b> (eixo horizontal → quanto o item pesa) com <b>crescimento</b> vs o período anterior (eixo vertical → se está subindo ou caindo).',
    '<b>Estrela</b>: pesa <i>e</i> cresce — invista.',
    '<b>Vaca leiteira</b>: pesa mas está estável/caindo — gera caixa, mantenha.',
    '<b>Interrogação</b>: ainda leve mas crescendo — aposta a acompanhar.',
    '<b>Abacaxi</b>: leve e caindo — candidato a promoção/saída.',
    'A divisão entre os quadrantes usa a <b>mediana</b> de cada eixo. Clique numa cor da legenda pra filtrar só aquele quadrante.',
    'Itens <b>sem venda no período anterior</b> não viram “+100%”: aparecem como <b>“novo”</b> (a 1ª venda deles foi agora) ou <b>“dormante”</b> (já vendiam antes e ficaram parados), pela 1ª venda no histórico. Não distorcem a mediana.',
    '<b>Dica:</b> o crescimento compara com o período anterior de mesmo tamanho. Se o período atual for o <b>mês corrente (ainda em andamento)</b>, a comparação com um mês cheio tende a parecer menor — pra leitura de tendência, prefira um período fechado (mês passado, ano ou personalizado).',
  ] },
  mais: { t: 'Mais vendidos — o que é', p: [
    'Ranking dos itens que <b>mais venderam</b> no período (por faturamento).',
    'Clique no cabeçalho <b>Unid.</b> pra ordenar por quantidade em vez de valor.',
  ] },
  menos: { t: 'Encalhados — o que é', p: [
    'Itens que <b>menos venderam</b> no período, do pior pro melhor.',
    'O selo <b>Encalhado</b> marca itens com <b>estoque parado e zero venda</b> no período — candidatos a queima/realocação.',
  ] },
  categoria: { t: 'Faturamento por categoria × canal — o que é', p: [
    'Mostra <b>quanto cada tipo de bolsa faturou em cada canal</b> (Tivoli, Dom Pedro, Atacado), com totais por linha e por coluna.',
    'Bom pra ver <b>qual categoria vende mais em qual loja</b>.',
  ] },
  ruptura: { t: 'Ruptura / cobertura — o que é', p: [
    'Itens que estão <b>vendendo bem mas com pouco estoque</b>.',
    '<b>Dias de cobertura</b> = quantos dias o estoque atual ainda dura, no ritmo de venda do período (estoque ÷ venda por dia).',
    'O selo <b>Repor</b> aparece quando a cobertura é <b>≤ 20 dias</b> — hora de comprar/repor antes de faltar.',
  ] },
}

const canal = ref('0')
const periodo = ref('mes-atual')
const granularidade = ref('sku')
const relatorio = ref('abc')
const filtroCategoria = ref('todas')
const filtroQuadrante = ref('todos')
const ajuda = ref(false)
const mesIni = ref('')
const mesFim = ref('')
const carregando = ref(false)
const erro = ref('')
const rowsAtuais = ref([])
const rowsAnteriores = ref([])
const estoqueRaw = ref([])
const primeiraVendaPorSku = ref(new Map())   // sku → 1º mês com venda (histórico todo) — p/ novo × dormante
const sortState = ref({ col: '', dir: 'desc' })

const anoAtual = new Date().getUTCFullYear()
const podeExportar = computed(() => hasPermission('gestor.relatorios', 'exportar'))
const rotuloChave = computed(() => granularidade.value === 'sku' ? 'Item' : 'Categoria')
const ajudaAtual = computed(() => GC_AJUDA[relatorio.value] || { t: '', p: [] })

// ── Ordenação por coluna ──
function ordenar(col) {
  if (sortState.value.col === col) sortState.value = { col, dir: sortState.value.dir === 'asc' ? 'desc' : 'asc' }
  else sortState.value = { col, dir: col === 'produto' || col === 'categoria' || col === 'classe' || col === 'quadrante' ? 'asc' : 'desc' }
}
function caret(col) { return sortState.value.col === col ? (sortState.value.dir === 'asc' ? ' ▲' : ' ▼') : '' }
function ordenarArr(arr, padrao) {
  const { col, dir } = sortState.value
  const key = col || padrao
  if (!key) return arr
  const s = [...arr].sort((a, b) => {
    const va = a[key], vb = b[key]
    if (typeof va === 'number' && typeof vb === 'number') return va - vb
    return String(va ?? '').localeCompare(String(vb ?? ''), 'pt-BR')
  })
  return (col ? dir : 'desc') === 'asc' ? s : s.reverse()
}
function selecionarRelatorio(id) { relatorio.value = id; sortState.value = { col: '', dir: 'desc' }; if (id !== 'bcg') filtroQuadrante.value = 'todos' }

// ── Helpers de mês ──
function ymDe(d) { return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') }
function addMeses(ym, delta) { const [y, m] = ym.split('-').map(Number); return ymDe(new Date(Date.UTC(y, m - 1 + delta, 1))) }
function rangeYM(ini, fim) { const out = []; let cur = ini; for (let g = 0; g < 240 && cur <= fim; g++) { out.push(cur); cur = addMeses(cur, 1) } return out }
const primeiroDia = (ym) => ym + '-01'

function janelas() {
  const hoje = ymDe(new Date())
  let atuais
  if (periodo.value === 'mes-atual') atuais = [hoje]
  else if (periodo.value === 'mes-passado') atuais = [addMeses(hoje, -1)]
  else if (periodo.value === 'ano') atuais = rangeYM(anoAtual + '-01', hoje)
  else {
    if (!mesIni.value || !mesFim.value) return null
    const [a, b] = mesIni.value <= mesFim.value ? [mesIni.value, mesFim.value] : [mesFim.value, mesIni.value]
    atuais = rangeYM(a, b)
  }
  const L = atuais.length
  const anteriores = rangeYM(addMeses(atuais[0], -L), addMeses(atuais[0], -1))
  return { atuais, anteriores }
}

// ── Carga (só quando muda o PERÍODO; canal/categoria/quadrante/ordenação são client-side) ──
async function carregar() {
  const j = janelas()
  if (!j) { rowsAtuais.value = []; rowsAnteriores.value = []; return }
  carregando.value = true; erro.value = ''
  try {
    const setAtual = new Set(j.atuais.map(primeiroDia))
    const meses = [...j.atuais, ...j.anteriores].map(primeiroDia)
    const rows = await fetchVendas(meses)
    rowsAtuais.value = rows.filter(r => setAtual.has(r.mes))
    rowsAnteriores.value = rows.filter(r => !setAtual.has(r.mes))
    estoqueRaw.value = await fetchEstoque()
  } catch (e) {
    erro.value = 'Falha ao carregar: ' + (e?.message || e)
    rowsAtuais.value = []; rowsAnteriores.value = []; estoqueRaw.value = []
  } finally {
    carregando.value = false
  }
}
async function fetchVendas(meses) {
  const size = 1000, rows = []
  for (let from = 0; ; from += size) {
    const { data, error } = await sbClient.from('gc_vendas_item')
      .select('mes,canal_loja_id,sku,produto,categoria,unidades,faturamento')
      .in('mes', meses).range(from, from + size - 1)
    if (error) throw error
    rows.push(...(data || []))
    if (!data || data.length < size) break
  }
  return rows
}
async function fetchEstoque() {
  const size = 1000, rows = []
  for (let from = 0; ; from += size) {
    const { data, error } = await sbClient.from('gc_estoque_item')
      .select('deposito_id,sku,produto,categoria,saldo').range(from, from + size - 1)
    if (error) throw error
    rows.push(...(data || []))
    if (!data || data.length < size) break
  }
  return rows
}
// 1ª venda de cada sku no histórico inteiro (leve: só sku,mes) — proxy de "cadastro"
async function fetchPrimeiraVenda() {
  const size = 1000, m = new Map()
  for (let from = 0; ; from += size) {
    const { data, error } = await sbClient.from('gc_vendas_item').select('sku,mes').range(from, from + size - 1)
    if (error) { primeiraVendaPorSku.value = m; return }
    for (const r of (data || [])) { const mes = String(r.mes).slice(0, 7); const cur = m.get(r.sku); if (!cur || mes < cur) m.set(r.sku, mes) }
    if (!data || data.length < size) break
  }
  primeiraVendaPorSku.value = m
}

// filtro de canal (client-side) + categoria (tipo de bolsa)
const catDe = (r) => r.categoria || 'Outros'
function porCanal(rows) { return canal.value === '0' ? rows : rows.filter(r => String(r.canal_loja_id) === canal.value) }
function porCategoria(rows) { return filtroCategoria.value === 'todas' ? rows : rows.filter(r => catDe(r) === filtroCategoria.value) }
const rowsAtuaisF = computed(() => porCategoria(porCanal(rowsAtuais.value)))
const rowsAnterioresF = computed(() => porCategoria(porCanal(rowsAnteriores.value)))

// lista de categorias disponíveis (respeitando só o canal, p/ não sumir opção ao filtrar)
const categoriasDisponiveis = computed(() => {
  const s = new Set(porCanal(rowsAtuais.value).map(catDe))
  return [...s].sort((a, b) => a.localeCompare(b, 'pt-BR'))
})

function agregar(rows, gran) {
  const m = new Map()
  for (const r of rows) {
    const chave = gran === 'sku' ? r.sku : catDe(r)
    let o = m.get(chave)
    if (!o) { o = { chave, produto: gran === 'sku' ? (r.produto || r.sku) : chave, categoria: catDe(r), unidades: 0, faturamento: 0 }; m.set(chave, o) }
    o.unidades += Number(r.unidades) || 0
    o.faturamento += Number(r.faturamento) || 0
  }
  return m
}

const linhas = computed(() => {
  const cur = agregar(rowsAtuaisF.value, granularidade.value)
  const ant = agregar(rowsAnterioresF.value, granularidade.value)
  return [...cur.values()].map(o => ({ ...o, fatAnterior: ant.get(o.chave)?.faturamento || 0 }))
})
const linhasSku = computed(() => [...agregar(rowsAtuaisF.value, 'sku').values()])
const totalFat = computed(() => linhas.value.reduce((s, l) => s + l.faturamento, 0))
const semDados = computed(() => {
  if (relatorio.value === 'categoria') return !pivot.value.length
  if (relatorio.value === 'menos' || relatorio.value === 'ruptura') return !linhas.value.length && !estoquePorSku.value.size
  return !linhas.value.length
})

const estoquePorSku = computed(() => {
  const m = new Map()
  const depAllow = canal.value === '0' ? null : DEPS_POR_CANAL[canal.value]
  for (const r of estoqueRaw.value) {
    if (depAllow && String(r.deposito_id) !== depAllow) continue
    if (filtroCategoria.value !== 'todas' && catDe(r) !== filtroCategoria.value) continue
    const o = m.get(r.sku) || { sku: r.sku, produto: r.produto, categoria: catDe(r), saldo: 0 }
    o.saldo += Number(r.saldo) || 0
    m.set(r.sku, o)
  }
  return m
})

// ── ABC ──
function curvaABC(linhas) {
  const ord = [...linhas].sort((a, b) => b.faturamento - a.faturamento)
  const total = ord.reduce((s, l) => s + l.faturamento, 0) || 1
  let acum = 0
  return ord.map(l => { acum += l.faturamento; const p = acum / total; return { ...l, pct: l.faturamento / total, pctAcum: p, classe: p <= 0.8 ? 'A' : p <= 0.95 ? 'B' : 'C' } })
}
const abc = computed(() => curvaABC(linhas.value))
const abcView = computed(() => ordenarArr(abc.value, ''))

// ── BCG ──
function mediana(arr) { const s = [...arr].sort((a, b) => a - b); const n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : 0 }
function matrizBCG(linhas) {
  const total = linhas.reduce((s, l) => s + l.faturamento, 0) || 1
  const itens = linhas.map(l => {
    const novo = !(l.fatAnterior > 0)   // sem venda no período anterior → crescimento indefinido
    return { ...l, novo, participacao: l.faturamento / total, crescimento: novo ? Infinity : (l.faturamento - l.fatAnterior) / l.fatAnterior }
  })
  // mediana de crescimento SÓ sobre itens com base real (os "novos" não distorcem o corte)
  const comBase = itens.filter(i => !i.novo)
  const mp = mediana(itens.map(i => i.participacao))
  const mc = comBase.length ? mediana(comBase.map(i => i.crescimento)) : 0
  const q = itens.map(i => {
    const alto = i.novo || i.crescimento >= mc   // novo conta como momentum alto
    return { ...i, quadrante:
      i.participacao >= mp && alto ? 'Estrela'
        : i.participacao >= mp && !alto ? 'Vaca leiteira'
          : i.participacao < mp && alto ? 'Interrogação' : 'Abacaxi' }
  })
  return { itens: q, medPart: mp, medCresc: mc, novos: itens.length - comBase.length }
}
const bcgAll = computed(() => {
  const r = matrizBCG(linhas.value)
  const inicioAtual = janelas()?.atuais?.[0] || ''
  const itens = r.itens.map(i => {
    if (!i.novo) return { ...i, tipoNovo: null, primeiraVenda: null }
    const pv = granularidade.value === 'sku' ? primeiraVendaPorSku.value.get(i.chave) : null
    return { ...i, tipoNovo: (pv && pv < inicioAtual) ? 'dormante' : 'novo', primeiraVenda: pv || null }
  })
  return { ...r, itens }
})
const bcgFiltrado = computed(() => filtroQuadrante.value === 'todos' ? bcgAll.value.itens : bcgAll.value.itens.filter(i => i.quadrante === filtroQuadrante.value))
const bcgView = computed(() => ordenarArr(bcgFiltrado.value, 'faturamento'))
const medPart = computed(() => bcgAll.value.medPart)
const medCresc = computed(() => bcgAll.value.medCresc)
const contagem = computed(() => { const c = {}; for (const i of bcgAll.value.itens) c[quadKey(i.quadrante)] = (c[quadKey(i.quadrante)] || 0) + 1; return c })
const bcgNovos = computed(() => bcgAll.value.itens.filter(i => i.tipoNovo === 'novo').length)
const bcgDormantes = computed(() => bcgAll.value.itens.filter(i => i.tipoNovo === 'dormante').length)
function quadKey(q) { return q === 'Estrela' ? 'estrela' : q === 'Vaca leiteira' ? 'vaca' : q === 'Interrogação' ? 'interrogacao' : 'abacaxi' }

// ── Mais vendidos ──
const mais = computed(() => [...linhas.value].sort((a, b) => b.faturamento - a.faturamento))
const maisView = computed(() => ordenarArr(mais.value, 'faturamento'))

// ── Encalhados ──
const menos = computed(() => {
  const vendidos = new Set(linhasSku.value.map(l => l.chave))
  const out = linhasSku.value.map(l => ({ ...l, saldo: estoquePorSku.value.get(l.chave)?.saldo || 0 }))
  for (const [sku, est] of estoquePorSku.value) {
    if (!vendidos.has(sku) && est.saldo > 0) out.push({ chave: sku, produto: est.produto || sku, categoria: est.categoria || 'Outros', unidades: 0, faturamento: 0, saldo: est.saldo })
  }
  return out
})
const menosView = computed(() => {
  if (sortState.value.col) return ordenarArr(menos.value, '')
  return [...menos.value].sort((a, b) => (a.faturamento - b.faturamento) || (b.saldo - a.saldo))
})

// ── Categoria × canal ──
const pivot = computed(() => {
  const base = porCategoria(rowsAtuais.value)
  const cats = new Map()
  for (const r of base) {
    const cat = catDe(r), canalId = String(r.canal_loja_id)
    const row = cats.get(cat) || { categoria: cat, por: {}, total: 0 }
    row.por[canalId] = (row.por[canalId] || 0) + (Number(r.faturamento) || 0)
    row.total += Number(r.faturamento) || 0
    cats.set(cat, row)
  }
  return [...cats.values()].sort((a, b) => b.total - a.total)
})
const pivotView = computed(() => ordenarArr(pivot.value, 'total'))
const pivotTotais = computed(() => {
  const t = { por: {}, total: 0 }
  for (const row of pivot.value) { t.total += row.total; for (const c of CANAIS) t.por[c.id] = (t.por[c.id] || 0) + (row.por[c.id] || 0) }
  return t
})

// ── Ruptura ──
const diasDecorridos = computed(() => {
  const j = janelas(); if (!j) return 1
  const hoje = new Date(), hojeYM = ymDe(hoje)
  let d = 0
  for (const ym of j.atuais) { const [y, m] = ym.split('-').map(Number); d += ym === hojeYM ? hoje.getUTCDate() : new Date(Date.UTC(y, m, 0)).getUTCDate() }
  return Math.max(1, d)
})
const ruptura = computed(() => {
  const dias = diasDecorridos.value
  return linhasSku.value.filter(l => l.unidades >= MIN_VENDENDO).map(l => {
    const saldo = estoquePorSku.value.get(l.chave)?.saldo || 0
    const porDia = l.unidades / dias
    const diasCobertura = porDia > 0 ? saldo / porDia : Infinity
    return { ...l, saldo, porDia, diasCobertura, alerta: diasCobertura <= 20 }
  })
})
const rupturaView = computed(() => {
  if (sortState.value.col) return ordenarArr(ruptura.value, '')
  return [...ruptura.value].sort((a, b) => a.diasCobertura - b.diasCobertura)
})

// ── Scatter BCG ──
const SW = 640, SH = 300, PAD = 24
const crescFinitos = computed(() => bcgAll.value.itens.map(i => i.crescimento).filter(Number.isFinite))
const maxPart = computed(() => Math.max(0.0001, ...bcgAll.value.itens.map(i => i.participacao)))
const crescMin = computed(() => Math.min(-0.2, ...crescFinitos.value))
const crescMax = computed(() => Math.max(0.5, ...crescFinitos.value))
function sx(part) { return PAD + (part / maxPart.value) * (SW - 2 * PAD) }
function sy(cresc) { if (!Number.isFinite(cresc)) return PAD; const t = (cresc - crescMin.value) / (crescMax.value - crescMin.value || 1); return SH - PAD - t * (SH - 2 * PAD) }
const bcgPontos = computed(() => bcgAll.value.itens.map(i => ({
  x: sx(i.participacao), y: sy(i.crescimento), q: quadKey(i.quadrante), nome: i.produto, quadrante: i.quadrante,
  participacao: i.participacao, crescimento: i.crescimento, novo: i.novo, tipoNovo: i.tipoNovo, primeiraVenda: i.primeiraVenda,
  destaque: filtroQuadrante.value === 'todos' || filtroQuadrante.value === i.quadrante,
})))

// ── Formatação ──
const fmtR = v => 'R$ ' + Math.round(Number(v) || 0).toLocaleString('pt-BR')
const fmtPct = v => ((Number(v) || 0) * 100).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%'

// ── Export ──
function tabelaAtiva() {
  const nomeCanal = canal.value === '0' ? 'consolidado' : (CANAIS.find(c => c.id === canal.value)?.nome || canal.value)
  const base = `relatorio-${relatorio.value}-${nomeCanal}-${periodo.value}`.toLowerCase().replace(/[^a-z0-9-]+/g, '-')
  if (relatorio.value === 'abc') return { nome: base, head: ['Classe', rotuloChave.value, 'Categoria', 'Unidades', 'Faturamento', '%', '% acum.'], rows: abcView.value.map(l => [l.classe, l.produto, l.categoria, l.unidades, l.faturamento, l.pct, l.pctAcum]) }
  if (relatorio.value === 'bcg') return { nome: base, head: ['Quadrante', rotuloChave.value, 'Faturamento', 'Participação', 'Crescimento', '1ª venda'], rows: bcgView.value.map(l => [l.quadrante, l.produto, l.faturamento, l.participacao, l.novo ? (l.tipoNovo || 'novo') : l.crescimento, l.primeiraVenda || '']) }
  if (relatorio.value === 'mais') return { nome: base, head: ['#', rotuloChave.value, 'Categoria', 'Unidades', 'Faturamento'], rows: maisView.value.map((l, i) => [i + 1, l.produto, l.categoria, l.unidades, l.faturamento]) }
  if (relatorio.value === 'menos') return { nome: base, head: ['Item', 'Categoria', 'Unidades', 'Faturamento', 'Estoque', 'Situação'], rows: menosView.value.map(l => [l.produto, l.categoria, l.unidades, l.faturamento, l.saldo, l.unidades === 0 && l.saldo > 0 ? 'Encalhado' : '']) }
  if (relatorio.value === 'categoria') return { nome: base, head: ['Categoria', ...CANAIS.map(c => c.nome), 'Total'], rows: [...pivotView.value.map(r => [r.categoria, ...CANAIS.map(c => r.por[c.id] || 0), r.total]), ['Total', ...CANAIS.map(c => pivotTotais.value.por[c.id] || 0), pivotTotais.value.total]] }
  if (relatorio.value === 'ruptura') return { nome: base, head: ['Item', 'Categoria', 'Unidades', 'Estoque', 'Un./dia', 'Dias cobertura', 'Alerta'], rows: rupturaView.value.map(l => [l.produto, l.categoria, l.unidades, l.saldo, Number(l.porDia.toFixed(2)), l.diasCobertura === Infinity ? '' : Math.round(l.diasCobertura), l.alerta ? 'Repor' : '']) }
  return { nome: base, head: [], rows: [] }
}
function exportar() {
  const { head, rows, nome } = tabelaAtiva()
  if (window.XLSX) {
    const ws = window.XLSX.utils.aoa_to_sheet([head, ...rows])
    const wb = window.XLSX.utils.book_new()
    window.XLSX.utils.book_append_sheet(wb, ws, 'Relatório')
    window.XLSX.writeFile(wb, nome + '.xlsx')
  } else {
    const csv = [head, ...rows].map(r => r.map(c => { const s = String(c ?? ''); return /[",;\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s }).join(';')).join('\n')
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }))
    a.download = nome + '.csv'; a.click(); URL.revokeObjectURL(a.href)
  }
}

// só o PERÍODO exige nova consulta; o resto é client-side
watch([periodo, mesIni, mesFim], carregar)
onMounted(() => {
  const hoje = ymDe(new Date())
  mesFim.value = hoje; mesIni.value = addMeses(hoje, -2)
  fetchPrimeiraVenda()
  carregar()
})
</script>

<style scoped>
.gc-rel{max-width:min(98vw,1860px);margin:0 auto;width:100%;padding:clamp(18px,1.8vw,30px) clamp(20px,2.8vw,46px) 96px;font-family:var(--fonte-principal);}
.gc-rel-filtros{display:flex;flex-wrap:wrap;align-items:flex-end;gap:14px;margin-bottom:22px;}
.gc-rel-filtros label{display:flex;flex-direction:column;gap:4px;font-size:calc(10px*var(--gc-fs,1));text-transform:uppercase;letter-spacing:1px;color:var(--muted);}
.gc-rel-filtros select,.gc-rel-filtros input{font-family:inherit;font-size:calc(13px*var(--gc-fs,1));color:var(--text);border:1px solid var(--border);border-radius:8px;padding:7px 10px;background:var(--surface);cursor:pointer;}
.gc-rel-sel{display:flex;gap:4px;margin-left:auto;flex-wrap:wrap;}
.gc-rel-sel button{appearance:none;background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:8px 14px;font-family:var(--fonte-principal);font-size:calc(12px*var(--gc-fs,1));letter-spacing:.8px;text-transform:uppercase;color:var(--muted);cursor:pointer;transition:all .15s ease;}
.gc-rel-sel button:hover{color:var(--text);border-color:var(--accent-mid);}
.gc-rel-sel button.on{background:var(--accent);border-color:var(--accent);color:var(--sobre-cor);}
.gc-rel-msg{padding:56px 0;text-align:center;color:var(--muted);font-size:calc(14px*var(--gc-fs,1));}
.gc-rel-msg.erro{color:var(--red);}
.gc-rel-head{display:flex;align-items:center;gap:20px;flex-wrap:wrap;margin-bottom:14px;font-size:calc(13px*var(--gc-fs,1));color:var(--muted);}
.gc-rel-head b{color:var(--text);font-variant-numeric:tabular-nums;}
.gc-rel-hint{font-size:calc(11px*var(--gc-fs,1));font-style:italic;opacity:.7;}
.gc-info-btn{width:20px;height:20px;flex-shrink:0;border-radius:50%;border:1px solid var(--border);background:var(--surface);color:var(--muted);font-family:var(--fonte-principal);font-weight:700;font-size:calc(11px*var(--gc-fs,1));line-height:1;cursor:pointer;transition:all .15s ease;}
.gc-info-btn:hover,.gc-info-btn.on{background:var(--accent);border-color:var(--accent);color:var(--sobre-cor);}
.gc-rel-ajuda{background:linear-gradient(135deg,var(--accent-light),transparent 78%);border:1px solid var(--accent-mid);border-radius:var(--radius-xl);padding:16px 20px;margin-bottom:16px;font-size:calc(13px*var(--gc-fs,1));line-height:1.6;color:var(--text);}
.gc-rel-ajuda-t{font-family:var(--fonte-principal);font-size:calc(13px*var(--gc-fs,1));font-weight:600;letter-spacing:.6px;text-transform:uppercase;color:var(--accent);margin-bottom:8px;}
.gc-rel-ajuda ul{margin:0;padding-left:18px;display:flex;flex-direction:column;gap:5px;}
.gc-rel-ajuda :deep(b){color:var(--text);font-weight:700;}
.gc-rel-exp{margin-left:auto;appearance:none;background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:7px 14px;font-family:var(--fonte-principal);font-size:calc(12px*var(--gc-fs,1));letter-spacing:.8px;text-transform:uppercase;color:var(--text);cursor:pointer;}
.gc-rel-exp:hover{border-color:var(--accent);color:var(--accent);}
.gc-rel-nota{font-size:calc(12px*var(--gc-fs,1));color:var(--muted);margin:0 0 12px;line-height:1.5;}
.gc-rel-tbwrap{overflow-x:auto;border:1px solid var(--border);border-radius:var(--radius-xl);background:var(--surface);}
.gc-rel-tb{width:100%;border-collapse:collapse;font-size:calc(13px*var(--gc-fs,1));}
.gc-rel-tb th,.gc-rel-tb td{padding:9px 14px;text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums;}
.gc-rel-tb th.l,.gc-rel-tb td.l{text-align:left;white-space:normal;}
.gc-rel-tb thead th{position:sticky;top:0;background:var(--surface2);color:var(--muted);font-family:var(--fonte-principal);font-weight:500;font-size:calc(11px*var(--gc-fs,1));text-transform:uppercase;letter-spacing:.8px;border-bottom:1px solid var(--border);}
.gc-rel-tb thead th.s{cursor:pointer;user-select:none;}
.gc-rel-tb thead th.s:hover{color:var(--accent);}
.gc-rel-tb tbody tr:nth-child(even){background:var(--surface2);}
.gc-rel-tb tbody tr:hover{background:var(--accent-light);}
.gc-rel-tb tr.gc-rel-totrow{background:var(--surface2);border-top:2px solid var(--border);}
.gc-rel-tb td.n{color:var(--text);}
.gc-rel-tb td.pos{color:var(--green);}
.gc-rel-tb td.neg{color:var(--red);}
.gc-mut{color:var(--muted);}
.gc-badge{display:inline-block;min-width:22px;padding:2px 9px;border-radius:20px;font-size:calc(10px*var(--gc-fs,1));font-weight:700;letter-spacing:.5px;color:#fff;}
.gc-badge.abc-A{background:var(--green);}
.gc-badge.abc-B{background:var(--orange);}
.gc-badge.abc-C{background:#64748b;}
.gc-badge.q-estrela{background:var(--orange);}
.gc-badge.q-vaca{background:var(--accent);}
.gc-badge.q-interrogacao{background:#7c3aed;}
.gc-badge.q-abacaxi{background:#e11d48;}
.gc-badge.alerta{background:#e11d48;}
.gc-bcg-scatter{margin-bottom:18px;border:1px solid var(--border);border-radius:var(--radius-xl);background:var(--surface);padding:14px;}
.gc-bcg-scatter svg{width:100%;height:auto;display:block;}
.gc-bcg-med{stroke:var(--border);stroke-width:1.5;stroke-dasharray:5 4;}
.gc-bcg-q{opacity:.06;}
.gc-bcg-q.q-estrela{fill:var(--orange);}
.gc-bcg-q.q-vaca{fill:var(--accent);}
.gc-bcg-q.q-interrogacao{fill:#7c3aed;}
.gc-bcg-q.q-abacaxi{fill:#e11d48;}
.gc-bcg-qlbl{font-family:var(--fonte-principal);font-size:max(9px, calc(13px * var(--escala-texto, 1)));font-weight:600;letter-spacing:.5px;opacity:.55;text-transform:uppercase;}
.gc-bcg-qlbl.r{text-anchor:end;}
.gc-bcg-qlbl.q-estrela{fill:var(--orange);}
.gc-bcg-qlbl.q-vaca{fill:var(--accent);}
.gc-bcg-qlbl.q-interrogacao{fill:#7c3aed;}
.gc-bcg-qlbl.q-abacaxi{fill:#e11d48;}
.gc-bcg-axl{fill:var(--muted);font-size:max(9px, calc(10px * var(--escala-texto, 1)));font-family:var(--fonte-principal);}
.gc-bcg-axl.r{text-anchor:end;}
.gc-bcg-scatter circle.q-estrela{fill:var(--orange);}
.gc-bcg-scatter circle.q-vaca{fill:var(--accent);}
.gc-bcg-scatter circle.q-interrogacao{fill:#7c3aed;}
.gc-bcg-scatter circle.q-abacaxi{fill:#e11d48;}
.gc-bcg-leg{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px;}
.gc-bcg-legbtn{display:inline-flex;align-items:center;gap:6px;background:var(--surface);border:1px solid var(--border);border-radius:20px;padding:5px 12px;font-size:calc(12px*var(--gc-fs,1));color:var(--text);cursor:pointer;transition:all .15s ease;}
.gc-bcg-legbtn:hover{border-color:var(--accent-mid);}
.gc-bcg-legbtn.off{opacity:.4;}
.gc-bcg-leg i{width:11px;height:11px;border-radius:50%;display:inline-block;}
.gc-bcg-leg i.q-estrela{background:var(--orange);}
.gc-bcg-leg i.q-vaca{background:var(--accent);}
.gc-bcg-leg i.q-interrogacao{background:#7c3aed;}
.gc-bcg-leg i.q-abacaxi{background:#e11d48;}
.gc-bcg-nota{margin:10px 0 0;font-size:calc(11.5px*var(--gc-fs,1));color:var(--muted);line-height:1.7;}
.gc-bcg-nota b{color:var(--text);}
.gc-tag{display:inline-block;padding:1px 8px;border-radius:20px;font-size:calc(10px*var(--gc-fs,1));font-weight:700;letter-spacing:.3px;}
.gc-tag.novo{background:rgba(34,197,94,.15);color:var(--green);}
.gc-tag.dorm{background:rgba(217,119,6,.18);color:var(--orange);}
@media (max-width:640px){
  .gc-rel-filtros{gap:10px;}
  .gc-rel-sel{margin-left:0;width:100%;}
  .gc-rel-tb th,.gc-rel-tb td{padding:7px 9px;font-size:calc(12px*var(--gc-fs,1));}
}
</style>
