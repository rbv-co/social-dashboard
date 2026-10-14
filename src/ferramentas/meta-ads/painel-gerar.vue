<script setup>
// Painel Gerar 2.0 (Task 7) — substitui o antigo formulário fixo (pct/limite/looks) por um
// fluxo loja(s) → fonte → filtros → lista viva (fabrica-candidatos) → curadoria → desconto.
// A F1 (fabrica_candidatos/fabrica_rodadas + tela dedicada) foi aposentada nesta mesma task —
// aqui só existe o modo "lista explícita" (itens=[{sku,deposito,pct}]) já suportado por
// gerar-criativos.mjs (Task 5) e alimentado pela Edge fabrica-candidatos (Task 6).
import { ref, reactive, onMounted, computed, watch } from 'vue'
import { sbClient } from '../../compartilhado/conectar-no-banco-de-dados.js'
// Chave `fabrica` (Plano 7): as edges da Fábrica (5.8) pela API.
import { invocarNaArea } from '../../compartilhado/api.js'
import { sb } from '../../compartilhado/buscar-e-salvar-dados.js'
import { useCandidatos } from './use-candidatos.js'
import AjudaTooltip from './ajuda-tooltip.vue'
import TourCoachmark from './tour-coachmark.vue'
import { TOUR_GERAR } from './tutorial-fabrica.js'

const emit = defineEmits(['gerado'])
const tourAberto = ref(false)

const FONTES = [
  { v: 'oportunidades', l: 'Oportunidades da semana' },
  { v: 'garimpo', l: 'Garimpo' },
  { v: 'bcg', l: 'Grade BCG' },
  { v: 'abc', l: 'Curva ABC' },
  { v: 'manual', l: 'Manual' },
]
const QUADRANTES = ['Estrela', 'Vaca leiteira', 'Interrogação']

const lojas = ref([])                 // fabrica_lojas ativas: [{deposito_id, nome}]
const objetivos = ref([])             // fabrica_objetivos ativos: [{chave, rotulo, descricao, pede_desconto}]
const sel = reactive({ lojas: [], fonte: 'oportunidades', filtros: {}, descontoModo: 'previsto', pctManual: 50, objetivo: 'engajamento' })
const { candidatos, carregando, erro, buscar } = useCandidatos()
const marcados = ref({})              // sku -> bool
const buscou = ref(false)             // já clicou "Ver produtos" ao menos 1x (controla a seção de resultado)

onMounted(async () => {
  lojas.value = await sb('fabrica_lojas?select=deposito_id,nome&ativo=eq.true&order=ordem')
  objetivos.value = await sb('fabrica_objetivos?select=chave,rotulo,descricao,pede_desconto&ativo=eq.true&order=ordem')
  if (objetivos.value.length) sel.objetivo = objetivos.value[0].chave
})

const objetivoAtual = computed(() => objetivos.value.find((o) => o.chave === sel.objetivo))
const pedeDesconto = computed(() => objetivoAtual.value?.pede_desconto !== false)

// desconto previsto do Gestor só existe nos blocos do briefing (oportunidades/garimpo);
// bcg/abc/manual vêm de vendas+estoque puros, sem % sugerido — sempre manual ali.
const previstoDisponivel = computed(() => ['oportunidades', 'garimpo'].includes(sel.fonte))
watch(previstoDisponivel, (disp) => { sel.descontoModo = disp ? 'previsto' : 'manual' })

// zera/reinicia os filtros ao trocar de fonte — evita levar filtro de uma fonte pra outra e evita
// mandar quadrantes:[] pra Edge (ela só aplica o default 'todos' quando o campo vem ausente/undefined).
watch(() => sel.fonte, (f) => {
  sel.filtros = f === 'bcg' ? { quadrantes: [...QUADRANTES] } : f === 'abc' ? { faixa: 'A' } : {}
})

const totalMarcados = computed(() => candidatos.value.filter((c) => marcados.value[c.sku]).length)
const todosMarcados = computed(() => candidatos.value.length > 0 && candidatos.value.every((c) => marcados.value[c.sku]))
function alternarTodos() {
  const novo = !todosMarcados.value
  const m = {}
  for (const c of candidatos.value) m[c.sku] = novo
  marcados.value = m
}
function nomeLoja(dep) { return lojas.value.find((l) => l.deposito_id === dep)?.nome || dep }

async function carregarLista() {
  if (!sel.lojas.length) return
  await buscar({ lojas: sel.lojas, fonte: sel.fonte, filtros: sel.filtros })
  buscou.value = true
  // fontes automáticas já vêm priorizadas pelo Gestor/pela regra — pré-marca tudo;
  // manual é busca livre, então começa em branco pro usuário curar.
  marcados.value = sel.fonte === 'manual' ? {} : Object.fromEntries(candidatos.value.map((c) => [c.sku, true]))
}

function itensEscolhidos() {
  const out = []
  for (const c of candidatos.value) {
    if (!marcados.value[c.sku]) continue
    for (const dep of sel.lojas) {
      const info = c.porLoja[dep]
      if (!info) continue // produto não existe/sem dado nessa loja: não manda item pra ela
      const pct = !pedeDesconto.value
        ? 0
        : (sel.descontoModo === 'previsto' && previstoDisponivel.value && info.pctPrevisto != null)
          ? info.pctPrevisto
          : sel.pctManual
      out.push({ sku: c.sku, deposito: dep, pct })
    }
  }
  return out
}

async function gerar() {
  const itens = itensEscolhidos()
  if (!itens.length) return alert('Marque ao menos um produto (com estoque numa loja selecionada) antes de gerar.')
  const nome = 'Rodada · ' + FONTES.find(f => f.v === sel.fonte)?.l + ' · ' + new Date().toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
  const { data, error } = await invocarNaArea('fabrica', sbClient, 'fabrica-trigger', { body: { tipo: 'gerar', params: { itens, nome, objetivo: sel.objetivo } } })
  if (error) return alert('Falha ao disparar: ' + error.message)
  if (!data?.campanha_id) return alert('Sem campanha na resposta')
  emit('gerado', data.campanha_id)
}
</script>
<template>
  <section class="stage">
    <TourCoachmark :passos="TOUR_GERAR" v-model="tourAberto" />
    <div class="stagehead">
      <span class="badge"><i class="led hold"></i>Passo 1 · Gerar</span>
      <h2>Gerar os criativos <AjudaTooltip chave="gerar" /> <button class="mini" type="button" @click="tourAberto = true">Tutorial ▶</button></h2>
      <p class="lead">Escolha a(s) loja(s), de onde vêm os produtos e o desconto. Você aprova a lista antes de mandar gerar.</p>
    </div>

    <div class="panel" data-tour="gerar-objetivo">
      <div class="ph"><span class="eyebrow">Objetivo</span></div>
      <div class="choices">
        <label v-for="o in objetivos" :key="o.chave" class="choice" :class="{ sel: sel.objetivo === o.chave }">
          <input type="radio" :value="o.chave" v-model="sel.objetivo">
          <span class="ch-nm">{{ o.rotulo }}</span>
          <span v-if="o.descricao" class="ch-nm" style="font-weight:400;color:var(--ink-dim);flex-basis:100%">{{ o.descricao }}</span>
        </label>
        <p v-if="!objetivos.length" class="empty">Nenhum objetivo ativo cadastrado.</p>
      </div>
    </div>

    <div class="panel" data-tour="gerar-lojas">
      <div class="ph"><span class="eyebrow">Lojas</span><span class="eyebrow muted">{{ sel.lojas.length }} selecionada(s)</span></div>
      <div class="lojas">
        <label v-for="l in lojas" :key="l.deposito_id" class="loja-chip" :class="{ sel: sel.lojas.includes(l.deposito_id) }">
          <input type="checkbox" :value="l.deposito_id" v-model="sel.lojas">
          {{ l.nome }}
        </label>
        <p v-if="!lojas.length" class="empty">Nenhuma loja ativa cadastrada.</p>
      </div>
    </div>

    <div class="panel" data-tour="gerar-fonte">
      <div class="ph"><span class="eyebrow">Fonte dos produtos</span></div>
      <div class="fields">
        <label class="field wide">
          <span class="fl">De onde vêm os produtos</span>
          <select class="fi" v-model="sel.fonte">
            <option v-for="f in FONTES" :key="f.v" :value="f.v">{{ f.l }}</option>
          </select>
        </label>

        <template v-if="sel.fonte === 'bcg'">
          <label class="field wide">
            <span class="fl">Quadrantes</span>
            <div class="lojas">
              <label v-for="q in QUADRANTES" :key="q" class="loja-chip" :class="{ sel: (sel.filtros.quadrantes || []).includes(q) }">
                <input type="checkbox" :value="q" v-model="sel.filtros.quadrantes">
                {{ q }}
              </label>
            </div>
          </label>
          <label class="field">
            <span class="fl">Categoria (opcional)</span>
            <input class="fi" v-model="sel.filtros.categoria" placeholder="ex.: vestidos">
          </label>
        </template>

        <label v-else-if="sel.fonte === 'abc'" class="field">
          <span class="fl">Faixa</span>
          <select class="fi" v-model="sel.filtros.faixa">
            <option value="A">Faixa A</option>
            <option value="B">Faixa B</option>
            <option value="C">Faixa C</option>
          </select>
        </label>

        <label v-else-if="sel.fonte === 'manual'" class="field wide">
          <span class="fl">Buscar por nome ou SKU</span>
          <input class="fi" v-model="sel.filtros.termo" placeholder="digite parte do nome ou o SKU (vazio = todos)">
        </label>
      </div>

      <div class="cmdrow">
        <button class="cmd cyan" data-tour="gerar-ver" :disabled="!sel.lojas.length || carregando" @click="carregarLista">
          <span class="ci">🔍</span> {{ carregando ? 'Buscando…' : 'Ver produtos' }}
        </button>
        <span v-if="erro" class="js-err">— {{ erro }}</span>
      </div>
    </div>

    <div class="panel" v-if="buscou" data-tour="gerar-produtos">
      <div class="ph">
        <span class="eyebrow">Produtos</span>
        <span class="ph-right">
          <button v-if="candidatos.length" class="marcar-todos" @click="alternarTodos">{{ todosMarcados ? 'Desmarcar todos' : 'Marcar todos' }}</button>
          <span class="eyebrow muted">{{ totalMarcados }} de {{ candidatos.length }} marcados</span>
        </span>
      </div>

      <p v-if="carregando" class="empty">Carregando…</p>
      <template v-else-if="candidatos.length">
        <div class="choices" v-if="pedeDesconto" data-tour="gerar-desconto">
          <label v-if="previstoDisponivel" class="choice" :class="{ sel: sel.descontoModo === 'previsto' }">
            <input type="radio" value="previsto" v-model="sel.descontoModo">
            <span class="ch-nm">Usar desconto previsto do Gestor</span>
          </label>
          <label class="choice" :class="{ sel: sel.descontoModo === 'manual' }">
            <input type="radio" value="manual" v-model="sel.descontoModo">
            <span class="ch-nm">% manual</span>
            <input class="fi num" type="number" min="1" max="90" v-model.number="sel.pctManual" :disabled="sel.descontoModo !== 'manual'" style="max-width:90px;flex:none">
          </label>
        </div>

        <div class="tbl-wrap">
          <table class="tbl">
            <thead>
              <tr>
                <th></th>
                <th>Produto</th>
                <th v-for="dep in sel.lojas" :key="dep">{{ nomeLoja(dep) }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="c in candidatos" :key="c.sku" :class="{ marcado: marcados[c.sku] }">
                <td><input type="checkbox" v-model="marcados[c.sku]"></td>
                <td>
                  <span class="nm">{{ c.nome }}</span>
                  <span v-if="c.categoria" class="cat">{{ c.categoria }}</span>
                </td>
                <td v-for="dep in sel.lojas" :key="dep">
                  <template v-if="c.porLoja[dep]">
                    {{ c.porLoja[dep].estoque }} un<span v-if="c.porLoja[dep].pctPrevisto != null" class="pct"> · {{ c.porLoja[dep].pctPrevisto }}%</span>
                  </template>
                  <span v-else class="semloja">—</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>
      <p v-else class="empty">Nenhum produto encontrado para essa fonte/filtro. Ajuste e tente de novo.</p>

      <div class="cmdrow">
        <button class="cmd amber" data-tour="gerar-botao" :disabled="!totalMarcados" @click="gerar">
          <span class="ci">▶</span> Gerar criativos
        </button>
      </div>
    </div>
  </section>
</template>
