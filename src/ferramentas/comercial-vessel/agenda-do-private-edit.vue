<template>
  <section class="cv-bloco ag-bloco">
    <h2 class="cv-etiqueta id-titulo"><icone-do-bloco nome="calendario" />Agenda das lojas</h2>

    <!-- ── O MÊS E OS FILTROS ────────────────────────────────────────────── -->
    <div class="ag-topo">
      <div class="ag-nav">
        <button type="button" class="btn id-btn-apoio" aria-label="Mês anterior" @click="mudarMes(-1)">
          <icone-do-bloco nome="voltar-seta" />Anterior</button>
        <h3 class="ag-mes">{{ nomeDoMes(mes) }}</h3>
        <button type="button" class="btn id-btn-apoio" aria-label="Próximo mês" @click="mudarMes(1)">
          Próximo<icone-do-bloco nome="avancar" /></button>
        <button type="button" class="btn id-btn-editar" :disabled="noMesDeHoje" @click="irParaHoje">
          <icone-do-bloco nome="calendario" />Hoje</button>
      </div>
      <div class="ag-filtros">
        <label class="cv-barra-campo ag-filtro-lugar" for="ag-lugar"><span class="cv-etiqueta ag-rotulo">Loja</span>
          <select id="ag-lugar" v-model="filtro.lugar">
            <option value="">Todas as lojas</option>
            <option v-for="l in opcoesDeLugar" :key="l.chave" :value="l.chave">{{ l.rotulo }}</option>
          </select></label>
        <label class="cv-marcar ag-so-pe" for="ag-so-pe">
          <input id="ag-so-pe" type="checkbox" v-model="filtro.soPrivateEdit">Só Private Edits</label>
      </div>
    </div>

    <!-- A legenda: cada tipo no tom da ferramenta dele; o conflito em vermelho. -->
    <ul class="ag-legenda" aria-label="Legenda">
      <li class="ag-legenda-item ag-pe">Private Edit</li>
      <li v-if="!filtro.soPrivateEdit" class="ag-legenda-item ag-bs">Beauty Session</li>
      <li v-if="!filtro.soPrivateEdit" class="ag-legenda-item ag-pa">Private Appointment</li>
      <li class="ag-legenda-item ag-legenda-conflito"><icone-do-bloco nome="alerta" />sobrepõe outro Private Edit na mesma loja</li>
    </ul>

    <!-- ⚠️ ERRO DE LEITURA NÃO VIRA MÊS VAZIO (PADRAO, item 9). -->
    <div v-if="erro" class="ag-erro">
      <p class="cv-nota cv-nota-erro cv-nota-primeira">Não consegui ler a agenda agora. {{ erro }}</p>
      <button type="button" class="btn id-btn-apoio" @click="carregar">Tentar de novo</button>
    </div>
    <div v-else-if="carregando" class="cv-carregando">Carregando a agenda…</div>

    <template v-else>
      <p v-if="sobrepostosNoMes.length" class="ag-aviso">
        <icone-do-bloco nome="alerta" />
        <span><b>{{ sobrepostosNoMes.length }} Private Edit(s) se sobrepõem</b> neste mês, na mesma loja e no
          mesmo horário (cada encontro ocupa {{ DURACAO_DO_PRIVATE_EDIT_EM_HORAS }} horas a partir do início).
          Os dias estão marcados abaixo.</span>
      </p>

      <!-- ── A GRADE DO MÊS (computador e tablet) ──────────────────────── -->
      <div class="ag-grade" role="table" :aria-label="`Agenda de ${nomeDoMes(mes)}`">
        <div class="ag-semana ag-semana-cabeca" role="row">
          <span v-for="d in DIAS_DA_SEMANA" :key="d" class="ag-cabeca" role="columnheader">{{ d }}</span>
        </div>
        <div v-for="(semana, s) in semanas" :key="s" class="ag-semana" role="row">
          <div v-for="dia in semana" :key="dia" role="cell" class="ag-dia"
               :class="{ fora: !doMes(dia), hoje: dia === hoje, 'ag-dia-sobrepoe': diaTemSobreposicao(doDia(dia)) }">
            <div class="ag-dia-topo">
              <span class="ag-dia-numero">{{ Number(dia.slice(8)) }}</span>
              <span v-if="dia === hoje" class="ag-hoje">hoje</span>
              <span v-if="diaTemSobreposicao(doDia(dia))" class="ag-selo-sobrepoe"><icone-do-bloco nome="alerta" />sobrepõe</span>
            </div>
            <button v-for="i in doDia(dia)" :key="chaveDoItem(i)" type="button"
                    class="ag-chip" :class="[TIPOS[i.tipo]?.classe, { 'ag-chip-sobrepoe': sobrepoe(i) }]"
                    :title="linhaDoItem(i)" @click="abrir(i)">
              <span class="ag-chip-hora">{{ i.hora || 'dia todo' }}</span>
              <span class="ag-chip-texto">{{ quemDoItem(i) }} · {{ nomeDoLugar(i) }}</span>
              <span v-if="sobrepoe(i)" class="ag-chip-alerta"><icone-do-bloco nome="alerta" />sobrepõe</span>
            </button>
          </div>
        </div>
      </div>

      <!-- ── A LISTA DIA A DIA (celular) ─────────────────────────────────
           ⚠️ No celular a grade de 7 colunas não cabe sem rolar de lado nem
           ler: vira uma lista por dia (hoje + 30 dias no mês de hoje). -->
      <div class="ag-lista">
        <p class="cv-nota cv-nota-primeira">{{ rotuloDaJanelaDaLista(mes, hoje) }}</p>
        <section v-for="dia in diasNaLista" :key="dia" class="ag-lista-dia"
                 :class="{ 'ag-dia-sobrepoe': diaTemSobreposicao(doDia(dia)) }">
          <h3 class="ag-lista-titulo">
            <span>{{ diaPorExtenso(dia) }}</span>
            <span v-if="dia === hoje" class="ag-hoje">hoje</span>
            <span v-if="diaTemSobreposicao(doDia(dia))" class="ag-selo-sobrepoe"><icone-do-bloco nome="alerta" />sobrepõe</span>
          </h3>
          <button v-for="i in doDia(dia)" :key="chaveDoItem(i)" type="button"
                  class="ag-chip ag-chip-largo" :class="[TIPOS[i.tipo]?.classe, { 'ag-chip-sobrepoe': sobrepoe(i) }]"
                  @click="abrir(i)">
            <span class="ag-chip-tipo">{{ TIPOS[i.tipo]?.rotulo }} · {{ horarioDoItem(i) }}</span>
            <span class="ag-chip-texto">{{ quemDoItem(i) }} · {{ nomeDoLugar(i) }}</span>
            <span v-if="sobrepoe(i)" class="ag-chip-alerta"><icone-do-bloco nome="alerta" />sobrepõe {{ i.sobrepoe.join(', ') }}</span>
          </button>
        </section>
        <p v-if="!diasNaLista.length" class="cv-vazio">Nada marcado {{ noMesDeHoje ? 'nos próximos 30 dias' : 'neste mês' }}
          {{ filtro.lugar || filtro.soPrivateEdit ? 'com este filtro' : '' }}.</p>
      </div>
      <p v-if="!visiveis.length" class="cv-vazio ag-vazio-grade">Nada marcado neste mês{{ filtro.lugar || filtro.soPrivateEdit ? ' com este filtro' : '' }}.</p>
    </template>

    <!-- ── O QUADRINHO DE LEITURA (Beauty Session e Private Appointment) ──
         Só lê: cada um se mexe na ferramenta dele. Pendurado dentro da tela
         (v-if), nunca no body (PADRAO, item 4). -->
    <div v-if="aberto" class="cv-modal-fundo" v-trava-rolagem @click.self="fechar">
      <div class="cv-modal ag-quadrinho" :class="TIPOS[aberto.tipo]?.classe" role="dialog" :aria-label="TIPOS[aberto.tipo]?.rotulo">
        <div class="cv-modal-topo ag-quadrinho-topo">
          <h2 class="cv-modal-titulo">{{ TIPOS[aberto.tipo]?.rotulo }}</h2>
          <button type="button" class="btn cv-modal-fechar" aria-label="Fechar" @click="fechar">✕</button>
        </div>
        <div class="cv-modal-corpo">
          <dl class="ag-detalhes">
            <template v-for="[k, v] in detalhesDoItem(aberto)" :key="k">
              <dt>{{ k }}</dt><dd>{{ v }}</dd>
            </template>
          </dl>
          <p class="cv-nota">{{ aberto.tipo === 'beauty_session'
            ? 'Só leitura aqui. A sessão acontece no salão parceiro; ela se mexe na ferramenta Beauty Sessions.'
            : 'Só leitura aqui. A visita se mexe no Private Appointment — o nome da cliente fica lá.' }}</p>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup>
/* A AGENDA DO PRIVATE EDIT (pedido do dono, 24/09/2026): o mês das lojas, para
 * bater agenda, cruzar encontros e ver se algum se sobrepõe.
 *
 * O Private Edit vem destacado; as Beauty Sessions (rosé) e os Private
 * Appointments (bronze) da mesma loja vêm num tom mais leve, como contexto do
 * que ocupa a loja — são SÓ LEITURA. Clicar num Private Edit abre o encontro
 * na lista (quem abre é a tela, pelo evento `abrir`).
 *
 * ⚠️ UMA LEITURA SÓ, `vessel_agenda_das_lojas`, com o DIA e a HORA já no fuso
 * de São Paulo — a tela nunca recalcula o dia pelo relógio do navegador (ver
 * `agenda-regras.js`). Erro de leitura aparece como erro, nunca como mês vazio.
 * O filtro (loja, só Private Edits) age sobre o que já veio: não volta ao banco.
 */
import { ref, reactive, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import IconeDoBloco from '../../compartilhado/icone-do-bloco.vue'
import {
  DURACAO_DO_PRIVATE_EDIT_EM_HORAS, TIPOS, DIAS_DA_SEMANA, hojeEmSaoPaulo, mesDoDia, outroMes, nomeDoMes,
  gradeDoMes, periodoParaPedir, ehMesDeHoje, diasDaLista, rotuloDaJanelaDaLista, diaPorExtenso, agruparPorDia,
  lugaresDaAgenda, filtrarAgenda, sobrepoe, diaTemSobreposicao, linhaDoItem, horarioDoItem, detalhesDoItem,
  nomeDoLugar, FILTRO_DA_AGENDA,
} from './agenda-regras.js'

const props = defineProps({
  chamar: { type: Function, required: true },
  // Sobe a cada gravação na tela (criar, editar, arquivar…): a agenda relê.
  versao: { type: Number, default: 0 },
})
const emit = defineEmits(['abrir'])

const hoje = hojeEmSaoPaulo()
const mes = ref(mesDoDia(hoje))
const itens = ref([])
const carregando = ref(true)
const erro = ref('')
const filtro = reactive({ ...FILTRO_DA_AGENDA })
// Os lugares já vistos (de todos os meses lidos): a opção escolhida não some
// do filtro ao trocar para um mês em que ela não tem nada.
const lugaresVistos = reactive(new Map())

const semanas = computed(() => gradeDoMes(mes.value))
const noMesDeHoje = computed(() => ehMesDeHoje(mes.value, hoje))
const visiveis = computed(() => filtrarAgenda(itens.value, filtro))
const porDia = computed(() => agruparPorDia(visiveis.value))
const diasNaLista = computed(() => diasDaLista(porDia.value, mes.value, hoje))
const opcoesDeLugar = computed(() => [...lugaresVistos].map(([chave, rotulo]) => ({ chave, rotulo }))
  .sort((a, b) => a.rotulo.localeCompare(b.rotulo, 'pt-BR')))
const doMes = (dia) => Number(dia.slice(5, 7)) === mes.value.mes
const doDia = (dia) => porDia.value.get(dia) || []
// Os Private Edits do MÊS (sem as bordas da grade) que cruzam outro.
const sobrepostosNoMes = computed(() => visiveis.value.filter((i) => sobrepoe(i) && doMes(i.dia)
  && Number(i.dia.slice(0, 4)) === mes.value.ano))

const chaveDoItem = (i) => `${i.tipo}:${i.codigo || i.id}`
function quemDoItem(i) {
  if (i.tipo === 'private_edit') return i.anfitria || i.stylist || i.codigo
  if (i.tipo === 'beauty_session') return i.parceiro || 'Beauty Session'
  return i.client_advisor ? `visita com ${i.client_advisor}` : 'visita marcada'
}

let pedido = 0
async function carregar() {
  const meu = ++pedido
  carregando.value = true
  erro.value = ''
  try {
    const { de, ate } = periodoParaPedir(mes.value, hoje)
    const r = await props.chamar('vessel_agenda_das_lojas', { p_de: de, p_ate: ate })
    if (meu !== pedido) return // chegou a resposta de um mês que já saiu da tela
    if (!Array.isArray(r)) throw new Error('a resposta não veio no formato esperado')
    itens.value = r
    for (const l of lugaresDaAgenda(r)) lugaresVistos.set(l.chave, l.rotulo)
  } catch (e) {
    if (meu !== pedido) return
    itens.value = []
    erro.value = `(${e?.message || 'erro desconhecido'})`
  } finally {
    if (meu === pedido) carregando.value = false
  }
}

function mudarMes(n) { mes.value = outroMes(mes.value, n) }
function irParaHoje() { mes.value = mesDoDia(hoje) }
watch(mes, carregar)
watch(() => props.versao, carregar)

// ── abrir um item ──────────────────────────────────────────────────────────
const aberto = ref(null)
function abrir(i) {
  if (i.tipo === 'private_edit') { emit('abrir', i.codigo); return }
  aberto.value = i
}
function fechar() { aberto.value = null }
const noTeclado = (e) => { if (e.key === 'Escape' && aberto.value) fechar() }
onMounted(() => { window.addEventListener('keydown', noTeclado); carregar() })
onBeforeUnmount(() => window.removeEventListener('keydown', noTeclado))
</script>

<style scoped>
@import './estilo-comercial.css';
@import '../../estilos/identidade-da-ferramenta.css';

/* ⚠️ SÓ TOKEN (PADRAO, item 2). Cada tipo no tom da ferramenta dele — os
   mesmos do menu do Comercial Vessel: Private Edit ameixa, Beauty Sessions
   rosé, Private Appointment bronze. O texto de ler é sempre `--text`. */
.ag-pe { --tom-item: var(--cor-private-edit); }
.ag-bs { --tom-item: var(--cor-beauty-sessions); }
.ag-pa { --tom-item: var(--cor-private-appointment); }

.ag-topo { display: flex; flex-wrap: wrap; align-items: flex-end; justify-content: space-between; gap: var(--sp-3); }
.ag-nav { display: flex; flex-wrap: wrap; align-items: center; gap: var(--sp-2); }
.ag-nav .btn { display: inline-flex; align-items: center; gap: var(--sp-2); }
.ag-mes {
  font-family: var(--fonte-principal); font-size: var(--texto-titulo); color: var(--text);
  margin: 0 var(--sp-2); min-width: 11em; text-align: center;
}
.ag-filtros { display: flex; flex-wrap: nowrap; align-items: flex-end; gap: var(--sp-4); flex: 0 1 auto; }
.ag-filtro-lugar { flex: 0 0 16rem; }
.ag-rotulo { margin: 0; }
.ag-so-pe { grid-column: auto; }

.ag-legenda { list-style: none; margin: var(--sp-3) 0 0; padding: 0; display: flex; flex-wrap: wrap; gap: var(--sp-2) var(--sp-4); }
.ag-legenda-item {
  display: inline-flex; align-items: center; gap: var(--sp-2);
  font-family: var(--fonte-principal); font-size: var(--texto-corpo); color: var(--text);
}
.ag-legenda-item.ag-pe::before, .ag-legenda-item.ag-bs::before, .ag-legenda-item.ag-pa::before {
  content: ''; width: 14px; height: 14px; border-radius: var(--radius-sm);
  background: color-mix(in srgb, var(--tom-item) 14%, var(--surface)); border-left: 3px solid var(--tom-item);
}
.ag-legenda-conflito { color: color-mix(in srgb, var(--situacao-faltou) 75%, var(--text)); font-weight: 600; }

.ag-aviso {
  display: flex; align-items: flex-start; gap: var(--sp-2); margin: var(--sp-3) 0 0;
  padding: var(--sp-3); border-radius: var(--radius-md);
  background: color-mix(in srgb, var(--situacao-faltou) 8%, var(--surface));
  border: 1px solid color-mix(in srgb, var(--situacao-faltou) 38%, var(--surface));
  font-family: var(--fonte-principal); font-size: var(--texto-corpo); color: var(--text); line-height: 1.5;
}
.ag-aviso .id-icone { color: var(--situacao-faltou); margin-top: 2px; }
.ag-erro { display: flex; flex-wrap: wrap; align-items: center; gap: var(--sp-3); margin-top: var(--sp-3); }

/* ── a grade ── */
.ag-grade { margin-top: var(--sp-3); border: 1px solid var(--border); border-radius: var(--radius-md); overflow: hidden; }
.ag-semana { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); }
.ag-semana + .ag-semana { border-top: 1px solid var(--border); }
.ag-cabeca {
  font-family: var(--fonte-principal); font-size: var(--texto-etiqueta); text-transform: uppercase;
  letter-spacing: 1.5px; color: var(--muted); padding: var(--sp-2); text-align: center; background: var(--surface2);
}
.ag-dia {
  min-width: 0; min-height: 112px; padding: var(--sp-2); display: flex; flex-direction: column; gap: var(--sp-1);
  background: var(--surface);
}
.ag-dia + .ag-dia { border-left: 1px solid var(--border); }
.ag-dia.fora { background: var(--bg); }
.ag-dia.fora .ag-dia-numero { color: var(--muted); }
.ag-dia-topo { display: flex; flex-wrap: wrap; align-items: center; gap: var(--sp-1); min-height: 26px; }
.ag-dia-numero {
  font-family: var(--fonte-principal); font-size: var(--texto-corpo); font-weight: 600; color: var(--text);
  min-width: 26px; height: 26px; display: inline-flex; align-items: center; justify-content: center; border-radius: 999px;
}
.ag-dia.hoje { background: color-mix(in srgb, var(--modulo) 5%, var(--surface)); }
.ag-dia.hoje .ag-dia-numero { background: var(--modulo); color: var(--sobre-cor); }
.ag-hoje {
  font-family: var(--fonte-principal); font-size: var(--texto-etiqueta); text-transform: uppercase; letter-spacing: 1px;
  color: color-mix(in srgb, var(--modulo) 75%, var(--text)); font-weight: 600;
}
/* o dia com conflito: filete e tinta da situação "faltou" (o vermelho da casa) */
.ag-dia.ag-dia-sobrepoe { box-shadow: inset 0 3px 0 var(--situacao-faltou); background: color-mix(in srgb, var(--situacao-faltou) 5%, var(--surface)); }
.ag-selo-sobrepoe, .ag-chip-alerta {
  display: inline-flex; align-items: center; gap: var(--sp-1);
  font-family: var(--fonte-principal); font-size: var(--texto-etiqueta); font-weight: 600;
  color: color-mix(in srgb, var(--situacao-faltou) 75%, var(--text));
}
.ag-selo-sobrepoe {
  padding: 1px var(--sp-2); border-radius: 999px; margin-left: auto;
  background: color-mix(in srgb, var(--situacao-faltou) 12%, var(--surface));
  border: 1px solid color-mix(in srgb, var(--situacao-faltou) 45%, var(--surface));
}
.ag-selo-sobrepoe .id-icone, .ag-chip-alerta .id-icone { width: 12px; height: 12px; flex-basis: 12px; }

/* ── o chip: o Private Edit cheio; os outros dois, leves ── */
.ag-chip {
  display: flex; flex-direction: column; align-items: stretch; gap: 1px; width: 100%; text-align: left; cursor: pointer;
  padding: var(--sp-1) var(--sp-2); border-radius: var(--radius-sm);
  border: 1px solid color-mix(in srgb, var(--tom-item) 22%, var(--surface));
  border-left: 3px solid color-mix(in srgb, var(--tom-item) 55%, var(--surface));
  background: color-mix(in srgb, var(--tom-item) 5%, var(--surface));
  font-family: var(--fonte-principal); font-size: var(--texto-corpo); color: var(--text); line-height: 1.35;
}
.ag-chip.ag-pe {
  border-color: color-mix(in srgb, var(--tom-item) 45%, var(--surface));
  border-left: 4px solid var(--tom-item);
  background: color-mix(in srgb, var(--tom-item) 14%, var(--surface));
  font-weight: 600;
}
.ag-chip:hover { background: color-mix(in srgb, var(--tom-item) 20%, var(--surface)); }
.ag-chip:focus-visible { outline: 2px solid var(--tom-item); outline-offset: 1px; }
.ag-chip.ag-chip-sobrepoe { box-shadow: 0 0 0 2px var(--situacao-faltou); }
.ag-chip-hora { font-weight: 600; font-variant-numeric: tabular-nums; }
.ag-chip-texto, .ag-chip-tipo { overflow-wrap: anywhere; }
.ag-chip:not(.ag-pe) .ag-chip-texto { font-weight: 400; }
.ag-vazio-grade { padding-bottom: 0; }

/* ── a lista do celular ── */
.ag-lista { display: none; margin-top: var(--sp-3); }
.ag-lista-dia { padding: var(--sp-3) 0; border-top: 1px solid var(--border); display: flex; flex-direction: column; gap: var(--sp-2); }
.ag-lista-dia.ag-dia-sobrepoe { background: none; box-shadow: inset 3px 0 0 var(--situacao-faltou); padding-left: var(--sp-3); }
.ag-lista-titulo {
  display: flex; flex-wrap: wrap; align-items: center; gap: var(--sp-2); margin: 0;
  font-family: var(--fonte-principal); font-size: var(--texto-campo); color: var(--text);
}
/* só a primeira letra ("Quinta, 24 de setembro"; o "de" fica minúsculo) */
.ag-lista-titulo > span:first-child { display: inline-block; }
.ag-lista-titulo > span:first-child::first-letter { text-transform: uppercase; }
.ag-lista-titulo .ag-selo-sobrepoe { margin-left: 0; }
.ag-chip-largo { min-height: 40px; padding: var(--sp-2) var(--sp-3); gap: 2px; }
.ag-chip-tipo { font-size: var(--texto-etiqueta); text-transform: uppercase; letter-spacing: 1px; color: var(--muted); font-weight: 600; }

/* ── o quadrinho de leitura ── */
.ag-quadrinho-topo {
  background: color-mix(in srgb, var(--tom-item) 8%, var(--surface));
  border-bottom: 3px solid var(--tom-item);
}
.ag-detalhes { display: grid; grid-template-columns: auto 1fr; gap: var(--sp-2) var(--sp-3); margin: 0; }
.ag-detalhes dt { font-family: var(--fonte-principal); font-size: var(--texto-etiqueta); text-transform: uppercase; letter-spacing: 1px; color: var(--muted); padding-top: 2px; }
.ag-detalhes dd { margin: 0; font-family: var(--fonte-principal); font-size: var(--texto-corpo); color: var(--text); overflow-wrap: anywhere; }

/* ⚠️ O CELULAR: a grade some e entra a lista (nada de rolar de lado a 375). */
@media (max-width: 640px) {
  .ag-grade, .ag-vazio-grade { display: none; }
  .ag-lista { display: block; }
  .ag-nav { width: 100%; }
  .ag-mes { order: -1; width: 100%; margin: 0; text-align: left; min-width: 0; }
  .ag-nav .btn { flex: 1 1 0; justify-content: center; min-height: 40px; }
  .ag-filtros { flex-wrap: wrap; width: 100%; }
  .ag-filtro-lugar { width: 100%; flex-basis: 100%; }
}
</style>
