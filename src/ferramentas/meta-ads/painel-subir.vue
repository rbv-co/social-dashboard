<script setup>
import { ref, reactive, computed, onMounted, watch, nextTick } from 'vue'
import { sbClient } from '../../compartilhado/conectar-no-banco-de-dados.js'
import { sb } from '../../compartilhado/buscar-e-salvar-dados.js'
// O aviso do canto da tela, o mesmo do resto da central. Substituiu o
// `alert()` nativo, que trava a página inteira até alguém clicar em OK.
import { adminToast } from '../../compartilhado/avisos.js'
import { useJobStatus } from './use-job-status.js'
import AjudaTooltip from './ajuda-tooltip.vue'
import TourCoachmark from './tour-coachmark.vue'
import { TOUR_SUBIR } from './tutorial-fabrica.js'
import { orcamentoBase, validarOrcamento, orcamentoParaEnvio } from './orcamento-form.js'
import { resumoDoDestino } from './resumo-do-destino.js'
import { baldeDoObjetivoDaFabrica } from '../gestao-trafego/baldes.js'
// ESCOLHER LUGAR (13/08/2026): o painel e o mapa são os MESMOS do editor de
// público da Gestão de Tráfego. Uma peça só, para o dono escolher lugar do
// mesmo jeito nos dois lugares.
import { montarPainelDeLugares } from '../../compartilhado/painel-de-lugares.js'
import { deListas, paraListas } from '../../compartilhado/lugares-do-anuncio.js'
import { enderecoDeOndeCaiu } from '../../compartilhado/busca-de-lugar.js'
import { montarMapa } from '../gestao-trafego/painel-do-mapa.js'
const tourAberto = ref(false)
const props = defineProps({ campanhaId: String, retomarJobId: String })
const emit = defineEmits(['subido'])
const ACCOUNT_ID = 'b6883e82-07cb-4f21-9fd7-ea7626786174', ACT = 'act_1197997517858139'
const campanhas = ref([]); const destino = reactive({ tipo: 'nova', lojas: ['tivoli'], campaignId: '' })
const LOJAS = [{ slug: 'tivoli', nome: 'Tivoli' }, { slug: 'dp', nome: 'Dom Pedro' }]
const resumo = computed(() => resumoDoDestino(destino, LOJAS))
const { job, start } = useJobStatus()

// ===== Localização + Público POR LOJA (abas; só quando destino.tipo === 'nova') =====
// `publico` = config da loja ATIVA (reactive estável); publicoPorLoja[slug] guarda o snapshot de
// cada loja. Ao trocar de aba, salva a atual e carrega a outra. Default de cada loja = a(s)
// cidade(s) de origem dela (fabrica_lojas.geo_cities).
const presets = ref([])
const lojasCfg = ref([]) // fabrica_lojas: {nome, geo_cities}
const cidadeNomes = reactive({}) // key(string) -> nome real da cidade (resolvido no Meta)
function cidadesDaLoja(slug) {
  const alias = slug === 'dp' ? 'dom pedro' : slug
  const row = lojasCfg.value.find((l) => (l.nome || '').toLowerCase().includes(alias))
  // raio 0 = cidade inteira (montarTargeting omite o raio quando 0). Nome real da cidade quando já
  // resolvido; senão o nome da loja (fallback) — evita mostrar 2 cidades como a loja repetida.
  return (row?.geo_cities || []).map((key) => ({ key: String(key), nome: cidadeNomes[String(key)] || row.nome || 'Cidade da loja', radius: 0, distance_unit: 'kilometer' }))
}
// Resolve chaves de cidade (fabrica_lojas.geo_cities) pros NOMES reais. Sem isso, as cidades default
// saíam todas com o nome da loja — ex.: as 2 cidades do Tivoli (Santa Bárbara d'Oeste + Americana)
// viravam "Tivoli" 2x, parecendo duplicata. Meta: type=adgeolocationmeta & cities=[keys].
async function resolverNomesCidades(keys) {
  const faltam = [...new Set((keys || []).map(String))].filter((k) => k && !cidadeNomes[k])
  if (!faltam.length) return
  const { data } = await sbClient.functions.invoke('meta-proxy', { body: { accountId: ACCOUNT_ID, path: '/search', params: { type: 'adgeolocationmeta', cities: JSON.stringify(faltam) }, method: 'GET' } })
  const cidades = data?.data?.cities || {}
  for (const k of Object.keys(cidades)) cidadeNomes[k] = cidades[k].region ? `${cidades[k].name} · ${cidades[k].region}` : cidades[k].name
}
function publicoBase(slug) {
  // `countries`, `regions` e `pins` entraram em 13/08/2026 junto com o painel de
  // lugares. Preset salvo antes disso não tem essas chaves e continua válido —
  // `fabrica_publicos.geo` é jsonb, e o que falta lê como lista vazia.
  return { presetId: '', nome: '', geo: { cities: cidadesDaLoja(slug), excluded: [], countries: [], regions: [], pins: [] }, idade_min: 18, idade_max: 65, generos: [], interesses: [], custom_audiences: [] }
}
// Preset antigo (ou qualquer geo vindo do banco) pode não ter as chaves novas.
// Completar aqui evita `undefined.push` espalhado por toda a tela.
function geoCompleto(geo) {
  const g = geo || {}
  return { cities: g.cities || [], excluded: g.excluded || [], countries: g.countries || [], regions: g.regions || [], pins: g.pins || [] }
}
const publico = reactive(publicoBase('tivoli'))
const publicoPorLoja = reactive({})   // slug -> snapshot do público daquela loja
const orcamento = reactive(orcamentoBase())          // config da loja ATIVA
const orcamentoPorLoja = reactive({})                // slug -> snapshot do orçamento
const lojaAtiva = ref('tivoli')
const clone = (o) => JSON.parse(JSON.stringify(o))
function salvarAtiva() {
  if (!lojaAtiva.value) return
  publicoPorLoja[lojaAtiva.value] = clone(publico)
  orcamentoPorLoja[lojaAtiva.value] = clone(orcamento)
}
function carregarLoja(slug) {
  Object.assign(publico, clone(publicoPorLoja[slug] || publicoBase(slug)))
  Object.assign(orcamento, clone(orcamentoPorLoja[slug] || orcamentoBase()))
  // TROCAR DE LOJA TROCA O PÚBLICO INTEIRO. Sem remontar aqui, o painel
  // continuaria mexendo na lista da loja anterior — a tela mostraria os lugares
  // de uma loja enquanto grava na outra. Fica em `carregarLoja` (e não só num
  // watch de `lojaAtiva`) porque no primeiro carregamento a loja ativa já é
  // 'tivoli' e o watch não dispararia.
  montarLugares()
}
function trocarAba(slug) { if (slug === lojaAtiva.value) return; salvarAtiva(); lojaAtiva.value = slug; carregarLoja(slug) }
function toggleLoja(slug) {
  const i = destino.lojas.indexOf(slug)
  if (i > -1) {
    destino.lojas.splice(i, 1); delete publicoPorLoja[slug]; delete orcamentoPorLoja[slug]
    if (lojaAtiva.value === slug) { lojaAtiva.value = destino.lojas[0] || ''; if (lojaAtiva.value) carregarLoja(lojaAtiva.value) }
  } else {
    salvarAtiva(); destino.lojas.push(slug)
    if (!publicoPorLoja[slug]) publicoPorLoja[slug] = publicoBase(slug)
    if (!orcamentoPorLoja[slug]) orcamentoPorLoja[slug] = orcamentoBase()
    lojaAtiva.value = slug; carregarLoja(slug)
  }
}
// O PAINEL DE LUGARES, o MESMO da Gestão de Tráfego. As chaves da Fábrica
// (`geo.cities`, `geo.countries`, `geo.regions`, `geo.pins`) são refeitas a cada
// mudança a partir da lista única que o painel e o mapa compartilham.
const caixaLugares = ref(null); const caixaMapaLugares = ref(null)
let painelLugares = null; let mapaLugares = null; let lugares = []
function listasParaGeo() {
  const l = paraListas(lugares)
  publico.geo.cities = l.cidades.map((c) => ({ key: c.key, nome: c.nome, radius: c.raio, distance_unit: c.unidade }))
  publico.geo.countries = l.paises
  publico.geo.regions = l.estados
  publico.geo.pins = l.pins
}
function geoParaListas() {
  const g = geoCompleto(publico.geo)
  return deListas({
    paises: g.countries,
    estados: g.regions,
    // A Fábrica guarda o raio da cidade como `radius`/`distance_unit` (nome da
    // Meta); o painel fala `raio`/`unidade`. A tradução é aqui, e só aqui.
    cidades: g.cities.map((c) => ({ key: c.key, nome: c.nome, raio: c.radius, unidade: c.distance_unit })),
    pins: g.pins,
  })
}
async function buscarNoMapa(termo) {
  const { data, error } = await sbClient.functions.invoke('buscar-lugar', { body: { acao: 'buscar', termo } })
  // O motivo vai pra tela: busca que falha não pode virar "nada encontrado".
  if (error || data?.error) throw new Error(data?.error || error?.message || 'a recepção do mapa não respondeu')
  return data
}
async function montarLugares() {
  // O bloco inteiro vive atrás de `v-if="destino.tipo==='nova'"`: sem o
  // nextTick, a caixa ainda não existe no exato momento em que o destino muda e
  // o painel nunca apareceria.
  await nextTick()
  if (!caixaLugares.value || !caixaMapaLugares.value) return
  lugares = geoParaListas()
  painelLugares = montarPainelDeLugares(caixaLugares.value, {
    lugares,
    buscarNaMeta: async (params) => {
      const { data, error } = await sbClient.functions.invoke('meta-proxy', { body: { accountId: ACCOUNT_ID, path: '/search', params, method: 'GET' } })
      if (error || data?.error) throw new Error(data?.error?.message || error?.message || 'a Meta não respondeu')
      return data
    },
    buscarNoMapa,
    aoMudar: () => { listasParaGeo(); if (mapaLugares) mapaLugares.desenhar() },
  })
  mapaLugares = montarMapa(caixaMapaLugares.value, {
    lugares, editavel: true,
    aoMudar: () => { listasParaGeo(); painelLugares.redesenhar() },
    // O ponto se apresenta: nasce na hora, e o endereço chega em seguida.
    aoPorPonto: async (ponto) => {
      try {
        const { data, error } = await sbClient.functions.invoke('buscar-lugar', { body: { acao: 'ondeCaiu', lat: ponto.lat, lng: ponto.lng } })
        if (error || data?.error) throw new Error(data?.error || error?.message || 'sem resposta')
        const achado = enderecoDeOndeCaiu(data)
        ponto.nome = achado.nome; ponto.endereco = achado.endereco
      } catch (e) {
        painelLugares.dizer('Pus o ponto, mas não consegui o endereço dele: ' + String(e?.message || e).slice(0, 120), true)
      } finally {
        ponto.procurandoNome = false
        listasParaGeo(); painelLugares.redesenhar(); mapaLugares.desenhar()
      }
    },
  })
  listasParaGeo()
}

const buscaCidade = ref(''); const cidadesAchadas = ref([])
const buscaInteresse = ref(''); const interessesAchados = ref([])
async function carregarPresets() { presets.value = await sb('fabrica_publicos?select=*&ativo=eq.true&order=created_at.desc') }
function aplicarPreset() {
  const p = presets.value.find((x) => x.id === publico.presetId)
  if (!p) { Object.assign(publico, { nome: '', geo: geoCompleto(null), idade_min: 18, idade_max: 65, generos: [], interesses: [], custom_audiences: [] }); montarLugares(); return }
  Object.assign(publico, { nome: p.nome, geo: geoCompleto(p.geo), idade_min: p.idade_min, idade_max: p.idade_max, generos: p.generos || [], interesses: p.interesses || [], custom_audiences: p.custom_audiences || [] })
  // O preset troca o público inteiro: sem remontar, o painel continuaria
  // mexendo na lista do público anterior e a tela mostraria o lugar errado.
  montarLugares()
}
const erroCidade = ref('')
async function buscarCidades() {
  if (!buscaCidade.value.trim()) return
  erroCidade.value = ''
  // surfaça o erro (antes engolia só lendo `data` — busca falhava em silêncio = "não inclui nada")
  const { data, error } = await sbClient.functions.invoke('meta-proxy', { body: { accountId: ACCOUNT_ID, path: '/search', params: { type: 'adgeolocation', location_types: JSON.stringify(['city']), q: buscaCidade.value, limit: 15 }, method: 'GET' } })
  if (error || data?.error) { erroCidade.value = (data?.error?.message || error?.message || 'Falha na busca de cidade'); cidadesAchadas.value = []; return }
  cidadesAchadas.value = data?.data || []
  if (!cidadesAchadas.value.length) erroCidade.value = 'Nenhuma cidade encontrada pra essa busca.'
}
function excluirCidade(c) { if (!publico.geo.excluded.some((x) => x.key === c.key)) publico.geo.excluded.push({ key: c.key, nome: c.name, type: 'city' }); cidadesAchadas.value = []; buscaCidade.value = '' }
function rmExcluida(key) { publico.geo.excluded = publico.geo.excluded.filter((x) => x.key !== key) }
async function buscarInteresses() {
  if (!buscaInteresse.value.trim()) return
  const { data } = await sbClient.functions.invoke('meta-proxy', { body: { accountId: ACCOUNT_ID, path: '/search', params: { type: 'adinterest', q: buscaInteresse.value, limit: 10 }, method: 'GET' } })
  interessesAchados.value = data?.data || []
}
// String() na comparação pelo mesmo motivo da faixa de sugestões: o id da busca vem CRU da Meta e
// o da sugestão vem normalizado em texto — 6003 !== '6003' deixaria o mesmo interesse entrar duas vezes.
function addInteresse(i) { if (!publico.interesses.some((x) => String(x.id) === String(i.id))) publico.interesses.push({ id: i.id, name: i.name }); interessesAchados.value = []; buscaInteresse.value = '' }
function rmInteresse(id) { publico.interesses = publico.interesses.filter((x) => x.id !== id) }

// ===== Faixa de sugestões de interesse (robô coletor/sugerir-interesses.mjs) =====
// Cadeia até a linha certa de interesses_sugeridos:
//   fabrica_campanhas.objetivo (chave, ex. 'engajamento') -> a LINHA de fabrica_objetivos ->
//   baldeDoObjetivoDaFabrica (a MESMA regra do Gestor de Tráfego, no módulo compartilhado)
//   -> interesses_sugeridos.marca_id + objetivo(balde).
// Qualquer elo faltando (sem campanha, objetivo sem linha em fabrica_objetivos, marca nova, robô
// que ainda não rodou) simplesmente não preenche `sugestoes` — sem faixa, sem erro pro dono.
//
// A linha inteira vai pra função (destination_type + optimization_goal juntos), NÃO só o
// meta_objective: o objetivo padrão da Fábrica é 'Engajamento (WhatsApp)' — OUTCOME_ENGAGEMENT
// com destino WHATSAPP. Traduzir só pelo meta_objective daria sugestões de ENGAJAMENTO pra uma
// campanha de WhatsApp, que é o erro de classificação que este produto já cometeu duas vezes.
// { itens: [{id, nome, audience_size, path}], rotuloObjetivo, marcaNome, geradoEm } | null
// `path` é a categoria da Meta, gravada pelo robô só pra diagnóstico — a faixa não usa.
const sugestoes = ref(null)
// Id vindo da URL não entra em filtro do PostgREST sem conferir o formato: valor com vírgula ou
// parêntese mudaria a LÓGICA do filtro, não só o valor (mesma guarda do commit 46b55de).
const ehUuid = (v) => /^[0-9a-fA-F-]{36}$/.test(String(v || ''))
async function carregarSugestoesInteresse() {
  try {
    if (!ehUuid(props.campanhaId)) return
    const camp = await sb(`fabrica_campanhas?select=objetivo&id=eq.${props.campanhaId}`)
    const chave = camp[0]?.objetivo
    if (!chave) return
    const objs = await sb(`fabrica_objetivos?select=rotulo,meta_objective,destination_type,optimization_goal&chave=eq.${chave}`)
    if (!objs[0]?.meta_objective) return
    const balde = baldeDoObjetivoDaFabrica(objs[0])
    if (!balde || balde === 'padrao') return
    const marcas = await sb(`fabrica_marcas?select=id,nome&account_id=eq.${ACCOUNT_ID}`)
    const marcaId = marcas[0]?.id
    if (!marcaId) return
    const rows = await sb(`interesses_sugeridos?select=itens,gerado_em&marca_id=eq.${marcaId}&objetivo=eq.${balde}`)
    const row = rows[0]
    if (!row || !Array.isArray(row.itens) || !row.itens.length) return
    sugestoes.value = { itens: row.itens, rotuloObjetivo: objs[0]?.rotulo || chave, marcaNome: marcas[0]?.nome || '', geradoEm: row.gerado_em }
  } catch { /* falha ao carregar não quebra a busca de interesse existente */ }
}
// Tamanho de público em português (1,58 bi / 2,3 mi / 940 mil). audience_size null/malformado -> ''
// (sem número na etiqueta) — nunca "0", porque nulo (desconhecido) e zero são fatos diferentes.
//
// GÊMEA de `tamanhoLegivel` em coletor/lib/interesses.mjs, que o robô usa no log da rodada seca.
// As duas têm de andar juntas: se divergirem, o log e esta etiqueta mostram números diferentes pro
// MESMO interesse, e quem conferir um contra o outro vai achar que o robô gravou errado. Não dá pra
// importar uma da outra (o robô é Node, isto aqui é um .vue) — por isso o aviso fica nas duas.
function formatarPublico(n) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return ''
  // O corte do "mi" é 999.500 e não 1.000.000 porque a faixa de baixo ARREDONDA: com corte em
  // 1 milhão, 999.999 caía no "mil", virava Math.round(999,999) = 1.000 e aparecia como
  // "1.000 mil" — que ninguém escreve. Daqui pra cima, 999.500 já é "1 mi". O "bi" é o mesmo
  // degrau acima: sem ele, 1,58 bilhão apareceria como "1.580 mi".
  if (n >= 999_500_000) return (n / 1_000_000_000).toLocaleString('pt-BR', { maximumFractionDigits: 2 }) + ' bi'
  if (n >= 999_500) return (n / 1_000_000).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + ' mi'
  if (n >= 1_000) return Math.round(n / 1000).toLocaleString('pt-BR') + ' mil'
  return n.toLocaleString('pt-BR')
}
function formatarDataCurta(iso) {
  const d = iso ? new Date(iso) : null
  return (d && !isNaN(d.getTime())) ? d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) : ''
}
// Etiquetas prontas pro template: só linhas com id+nome válidos, sem as já escolhidas em
// publico.interesses (senão vira poluição repetida na faixa).
const chipsSugeridos = computed(() => {
  if (!sugestoes.value) return []
  // String() dos dois lados: o robô normaliza o id pra texto, mas o interesse escolhido na busca
  // guarda o id CRU da Meta. Se a Meta devolver id numérico numa das pontas, 6003 !== '6003' e a
  // etiqueta continuaria na faixa depois de já ter sido adicionada.
  const escolhidos = new Set(publico.interesses.map((x) => String(x.id)))
  return sugestoes.value.itens
    .filter((i) => i != null && typeof i === 'object' && i.id != null && typeof i.nome === 'string' && i.nome.trim() && !escolhidos.has(String(i.id)))
    .map((i) => ({ id: i.id, nome: i.nome, tam: formatarPublico(i.audience_size) }))
})
function toggleGenero(g) { const i = publico.generos.indexOf(g); i > -1 ? publico.generos.splice(i, 1) : publico.generos.push(g) }
function publicoParaEnvio(p = publico) {
  const g = geoCompleto(p.geo)
  return {
    geo: {
      cities: g.cities.map((c) => ({ key: c.key, nome: c.nome, radius: c.radius, distance_unit: c.distance_unit })),
      excluded: g.excluded.map((e) => ({ key: e.key, nome: e.nome, type: e.type })),
      // Os três que entraram em 13/08/2026. `coletor/lib/publico.mjs` é quem os
      // traduz para o targeting da Meta.
      countries: g.countries.map((c) => ({ key: c.key, nome: c.nome })),
      regions: g.regions.map((r) => ({ key: r.key, nome: r.nome })),
      pins: g.pins.map((x) => ({ lat: x.lat, lng: x.lng, raio: x.raio, unidade: x.unidade, nome: x.nome, endereco: x.endereco, pais: x.pais })),
    },
    idade_min: p.idade_min, idade_max: p.idade_max, generos: [...p.generos],
    interesses: p.interesses.map((i) => ({ id: i.id, name: i.name })),
    custom_audiences: p.custom_audiences.map((a) => ({ id: a.id, name: a.name, subtype: a.subtype })),
  }
}
async function salvarPreset() {
  const nome = prompt('Nome do preset:', publico.nome || ''); if (!nome) return
  const preset = { ...publicoParaEnvio(), nome }
  if (publico.presetId) preset.id = publico.presetId
  const { data, error } = await sbClient.functions.invoke('fabrica-publicos', { body: { acao: 'salvar', preset } })
  if (error) { adminToast('Não consegui salvar o preset: ' + error.message, false); return }
  publico.nome = nome; await carregarPresets(); if (data?.id) publico.presetId = data.id
  // Salvar não mudava nada visível: o mesmo público continuava na tela, e a
  // pessoa não tinha como saber se o preset entrou na lista.
  adminToast(`Preset "${nome}" salvo.`)
}
async function apagarPreset() {
  if (!publico.presetId) return; if (!confirm('Apagar este preset?')) return
  const { error } = await sbClient.functions.invoke('fabrica-publicos', { body: { acao: 'apagar', id: publico.presetId } })
  if (error) { adminToast('Não consegui apagar o preset: ' + error.message, false); return }
  publico.presetId = ''; await carregarPresets()
  adminToast('Preset apagado.')
}

// ===== Públicos salvos (audiences do Meta: engajamento/lookalike) =====
const audiences = ref([]); const carregandoAud = ref(false)
const IG_ID = '17841462952561833', PAGE_ID = '324679337390168' // marca única hoje; futuro = da tabela de marcas
const erroAud = ref('')
async function listarAudiences() {
  carregandoAud.value = true; erroAud.value = ''
  // approximate_count foi removido na Graph v22 (dava #100 e a chamada falhava em silêncio) —
  // usa approximate_count_upper_bound. E surfaça erro (Meta ou meta-proxy) em vez de engolir.
  const { data, error } = await sbClient.functions.invoke('meta-proxy', { body: { accountId: ACCOUNT_ID, path: `/${ACT}/customaudiences`, params: { fields: 'id,name,subtype,approximate_count_lower_bound,approximate_count_upper_bound', limit: 100 }, method: 'GET' } })
  carregandoAud.value = false
  if (error || data?.error) { erroAud.value = (data?.error?.message || error?.message || 'Falha ao carregar públicos'); audiences.value = []; return }
  audiences.value = (data?.data || []).map((a) => ({ ...a, aprox: a.approximate_count_upper_bound }))
}
function toggleAudiencia(a) {
  const i = publico.custom_audiences.findIndex((x) => x.id === a.id)
  i > -1 ? publico.custom_audiences.splice(i, 1) : publico.custom_audiences.push({ id: a.id, name: a.name, subtype: a.subtype })
}
// Regra no formato flexible-rule documentado do Meta (v22): inclusions>rules>event_sources +
// retention_seconds + filter{field:'event',operator:'eq',value:'ig_business_profile_all'}. Passa o
// objeto direto (o meta-proxy faz JSON.stringify). OBS (validado ao vivo 2026-07-12): a CRIAÇÃO de
// custom audience via API está bloqueada nesta conta/versão (o Graph recusa o rule mesmo com o valor
// canônico, ex.: 'page_engaged' → code 2654) — provável restrição de elegibilidade da fonte/transporte
// do proxy (params vão por query string). O caminho que FUNCIONA é "Carregar públicos" (selecionar os
// que já existem no Gerenciador). Estas funções ficam no formato certo p/ quando o bloqueio sair.
const ERRO_AUD = 'A criação de público via API está bloqueada nesta conta pelo Meta. Crie o público no Gerenciador de Anúncios e use "Carregar públicos" pra selecioná-lo aqui.'
async function criarEngajamento() {
  const nome = prompt('Nome do público de engajamento:', 'Engajou IG 365d'); if (!nome) return
  const rule = { inclusions: { operator: 'or', rules: [{ event_sources: [{ type: 'ig_business', id: IG_ID }], retention_seconds: 31536000, filter: { operator: 'or', filters: [{ field: 'event', operator: 'eq', value: 'ig_business_profile_all' }] } }] } }
  const { data, error } = await sbClient.functions.invoke('meta-proxy', { body: { accountId: ACCOUNT_ID, path: `/${ACT}/customaudiences`, method: 'POST', params: { name: nome, subtype: 'ENGAGEMENT', rule } } })
  if (error || !data?.id) return alert(ERRO_AUD + '\n\n(' + (error?.message || (data?.error?.message) || JSON.stringify(data)) + ')')
  publico.custom_audiences.push({ id: data.id, name: nome, subtype: 'ENGAGEMENT' }); await listarAudiences()
}
async function criarLookalike(origem) {
  const nome = prompt('Nome do lookalike:', 'Lookalike 1%'); if (!nome) return
  const lookalike_spec = { country: 'BR', ratio: 0.01, type: 'similarity' }
  const { data, error } = await sbClient.functions.invoke('meta-proxy', { body: { accountId: ACCOUNT_ID, path: `/${ACT}/customaudiences`, method: 'POST', params: { name: nome, subtype: 'LOOKALIKE', origin_audience_id: origem, lookalike_spec } } })
  if (error || !data?.id) return alert(ERRO_AUD + '\n\n(' + (error?.message || (data?.error?.message) || JSON.stringify(data)) + ')')
  publico.custom_audiences.push({ id: data.id, name: nome, subtype: 'LOOKALIKE' }); await listarAudiences()
}

onMounted(async () => {
  lojasCfg.value = await sb('fabrica_lojas?select=nome,geo_cities')
  // resolve os nomes reais das cidades default (todas as lojas) ANTES de montar os públicos
  await resolverNomesCidades(lojasCfg.value.flatMap((l) => l.geo_cities || []))
  // (re)inicializa o público de cada loja já selecionada com a(s) cidade(s) de origem dela
  for (const slug of destino.lojas) { publicoPorLoja[slug] = publicoBase(slug); orcamentoPorLoja[slug] = orcamentoBase() }
  lojaAtiva.value = destino.lojas[0] || 'tivoli'
  carregarLoja(lojaAtiva.value)
  const { data } = await sbClient.functions.invoke('meta-proxy', { body: { accountId: ACCOUNT_ID, path: `/${ACT}/campaigns`, params: { fields: 'id,name', limit: 200 }, method: 'GET' } })
  campanhas.value = data?.data || []
  await carregarPresets()
  listarAudiences() // auto-carrega os públicos (audiences) já existentes no Meta — não bloqueia o mount
  carregarSugestoesInteresse() // idem: faixa de sugestões não bloqueia o mount
  // Retoma um subir em andamento (usuário saiu e voltou): reata o banner/polling e trava re-clique.
  if (props.retomarJobId) start(props.retomarJobId)
})
async function subir() {
  if (destino.tipo === 'nova' && !destino.lojas.length) return alert('Selecione ao menos uma loja.')
  salvarAtiva() // persiste a aba atual antes de montar o payload
  if (destino.tipo === 'nova') {
    for (const slug of destino.lojas) {
      const v = validarOrcamento(orcamentoPorLoja[slug] || orcamento)
      if (!v.ok) return alert(`Orçamento da loja ${LOJAS.find(l=>l.slug===slug)?.nome || slug}: ${v.erro}`)
    }
  }
  const params = { campanhaId: props.campanhaId, destino: destino.tipo === 'existente'
    ? { tipo: 'existente', campaignId: destino.campaignId }
    : { tipo: 'nova', lojas: destino.lojas.map((slug) => ({
        slug,
        publico: publicoParaEnvio(publicoPorLoja[slug] || publico),
        orcamento: orcamentoParaEnvio(orcamentoPorLoja[slug] || orcamento),
      })) } }
  const { data, error } = await sbClient.functions.invoke('fabrica-trigger', { body: { tipo: 'subir', params } })
  if (error) return alert('Falha: ' + error.message)
  if (!data?.job_id) return alert('Sem job_id na resposta')
  start(data.job_id)
}
// ao concluir a subida, entrega o resultado (adIds/adsetIds/metaCampaignId/criouCampanha) pro passo Conferir
watch(job, (j) => { if (j?.status === 'concluido' && j.resultado) emit('subido', j.resultado) })
// Trocar o DESTINO faz o bloco inteiro aparecer e sumir (`v-if`), então o painel
// precisa nascer de novo quando ele volta.
watch(() => destino.tipo, () => { montarLugares() })
</script>
<template>
  <section class="stage">
    <TourCoachmark :passos="TOUR_SUBIR" v-model="tourAberto" />
    <div class="stagehead">
      <span class="badge"><i class="led hold"></i>Passo 3 · Subir</span>
      <h2>Publicar na Meta <AjudaTooltip chave="subir" /> <button class="mini" type="button" @click="tourAberto = true">Tutorial ▶</button></h2>
      <p class="lead">Os anúncios sobem <b>pausados</b> — ninguém vê e não gastam nada até você ativar. Escolha onde publicar.</p>
    </div>

    <div class="panel" data-tour="subir-destino">
      <div class="ph"><span class="eyebrow">Destino</span></div>
      <div class="choices">
        <label class="choice" :class="{ sel: destino.tipo==='nova' }">
          <input type="radio" value="nova" v-model="destino.tipo">
          <span class="ch-nm">Nova campanha por loja</span>
          <span v-if="destino.tipo==='nova'" class="lojas" @click.stop>
            <button type="button" v-for="l in LOJAS" :key="l.slug" class="loja-chip" :class="{ sel: destino.lojas.includes(l.slug) }" @click.prevent="toggleLoja(l.slug)">{{ l.nome }}</button>
          </span>
        </label>
        <label class="choice" :class="{ sel: destino.tipo==='existente' }">
          <input type="radio" value="existente" v-model="destino.tipo">
          <span class="ch-nm">Campanha existente</span>
          <select v-if="destino.tipo==='existente'" v-model="destino.campaignId"><option v-for="c in campanhas" :key="c.id" :value="c.id">{{ c.name }}</option></select>
        </label>
      </div>

      <!-- O que vai acontecer, em português, ANTES de clicar. Pendência B4: sem esta frase, subir
           só pra uma loja era indistinguível de subir pras duas — só se descobria no Gerenciador. -->
      <div v-if="resumo" class="resumo-destino" :class="{ atencao: resumo.atencao }">
        <p class="rd-texto">{{ resumo.texto }}</p>
        <p v-if="resumo.fora" class="rd-fora">{{ resumo.fora }}</p>
      </div>

      <div class="cmdrow">
        <button class="cmd amber" data-tour="subir-botao" :disabled="job && ['enfileirado','rodando'].includes(job.status)" @click="subir">
          <span class="ci">▶</span> {{ (job && ['enfileirado','rodando'].includes(job.status)) ? 'Publicando…' : 'Publicar (pausado)' }}
        </button>
      </div>

      <!-- BANNER de progresso do subir (chamativo) -->
      <div v-if="job" class="subir-banner" :class="job.status">
        <div v-if="['enfileirado','rodando'].includes(job.status)" class="sb-body">
          <span class="sb-spin"></span>
          <div>
            <b>Publicando na Meta…</b>
            <div class="sb-sub">Criando as campanhas e anúncios (pausados). Pode levar ~2 min — <b>pode aguardar aqui</b>, não feche a tela. Se sair, ao voltar você retoma no Conferir.</div>
          </div>
        </div>
        <div v-else-if="job.status==='concluido'" class="sb-body">
          <span class="sb-ic">✅</span>
          <div><b>Publicado (pausado)!</b><div class="sb-sub">{{ job.resultado?.adIds?.length || 0 }} anúncios criados. Indo para o Conferir…</div></div>
        </div>
        <div v-else-if="job.status==='erro'" class="sb-body">
          <span class="sb-ic">⚠️</span>
          <div><b>Deu erro ao publicar.</b><div class="sb-sub js-err">{{ job.erro }}</div></div>
        </div>
      </div>
    </div>

    <div class="panel" v-if="destino.tipo==='nova'" data-tour="subir-local">
      <div class="ph">
        <span class="eyebrow">Localização + Público</span>
        <span class="eyebrow muted">por loja</span>
      </div>
      <!-- abas por loja: cada loja tem seu próprio público (default = cidade de origem) -->
      <div v-if="destino.lojas.length > 1" class="lojas" style="margin-bottom:12px">
        <button type="button" v-for="slug in destino.lojas" :key="slug" class="loja-chip" :class="{ sel: lojaAtiva===slug }" @click="trocarAba(slug)">
          {{ LOJAS.find(l=>l.slug===slug)?.nome || slug }}
        </button>
      </div>
      <p v-if="destino.lojas.length > 1" class="eyebrow muted" style="margin:-4px 0 10px">Editando o público de <b>{{ LOJAS.find(l=>l.slug===lojaAtiva)?.nome || lojaAtiva }}</b>.</p>

      <div class="orc-bloco" style="margin:8px 0 18px; padding:14px; border:1px solid var(--linha,#2a2a2a); border-radius:12px">
        <p class="eyebrow" style="margin:0 0 10px"><b>Orçamento</b> desta loja</p>

        <div class="orc-linha" style="display:flex; flex-wrap:wrap; gap:8px; margin-bottom:10px">
          <button type="button" class="loja-chip" :class="{ sel: orcamento.modo==='ABO' }" @click="orcamento.modo='ABO'">ABO — no conjunto</button>
          <button type="button" class="loja-chip" :class="{ sel: orcamento.modo==='CBO' }" @click="orcamento.modo='CBO'">CBO — na campanha</button>
        </div>
        <p class="muted" style="font-size:max(9px, calc(12px * var(--escala-texto, 1))); margin:-4px 0 12px">
          {{ orcamento.modo==='CBO' ? 'CBO: você dá um orçamento único e a Meta divide entre os conjuntos, otimizando sozinha.' : 'ABO: o orçamento fica fixo neste conjunto de anúncios.' }}
        </p>

        <div class="orc-linha" style="display:flex; flex-wrap:wrap; gap:8px; margin-bottom:12px">
          <button type="button" class="loja-chip" :class="{ sel: orcamento.tipo==='diario' }" @click="orcamento.tipo='diario'">Diário</button>
          <button type="button" class="loja-chip" :class="{ sel: orcamento.tipo==='total' }" @click="orcamento.tipo='total'">Total (período)</button>
        </div>

        <label class="campo" style="display:block; margin-bottom:12px">
          <span class="eyebrow muted">Valor {{ orcamento.tipo==='diario' ? 'por dia' : 'total do período' }} (R$)</span>
          <input type="text" inputmode="decimal" v-model="orcamento.valorReais" placeholder="50,00" style="width:100%">
        </label>

        <div v-if="orcamento.tipo==='total'" style="display:flex; flex-wrap:wrap; gap:12px">
          <label class="campo" style="flex:1 1 160px">
            <span class="eyebrow muted">Início</span>
            <input type="date" v-model="orcamento.inicio" style="width:100%">
          </label>
          <label class="campo" style="flex:1 1 160px">
            <span class="eyebrow muted">Fim</span>
            <input type="date" v-model="orcamento.fim" style="width:100%">
          </label>
        </div>
        <p v-if="orcamento.tipo==='total'" class="muted" style="font-size:max(9px, calc(12px * var(--escala-texto, 1))); margin:8px 0 0">
          A campanha sobe pausada; se a data de início já tiver passado quando você ativar, a Meta ajusta pra ativação.
        </p>
      </div>

      <div class="fields">
        <label class="field wide">
          <span class="fl">Usar preset salvo</span>
          <select class="fi" v-model="publico.presetId" @change="aplicarPreset">
            <option value="">— nenhum —</option>
            <option v-for="p in presets" :key="p.id" :value="p.id">{{ p.nome }}</option>
          </select>
        </label>
      </div>

      <!-- ONDE MOSTRAR: Brasil, Estado, Cidade ou Local, com o mapa dos dois
           lados. O painel e o mapa são os MESMOS do editor de público da Gestão
           de Tráfego (13/08/2026). -->
      <p class="fl" style="margin:12px 0 6px">Onde mostrar</p>
      <div ref="caixaLugares"></div>
      <div ref="caixaMapaLugares"></div>

      <!-- EXCLUIR continua pela busca de cidade da Meta: é uma lista à parte
           (`excluded_geo_locations`) e não passa pelo painel. -->
      <div class="fields" style="margin-top:12px">
        <label class="field wide">
          <span class="fl">Buscar cidade para EXCLUIR</span>
          <div class="searchrow">
            <input class="fi" v-model="buscaCidade" placeholder="ex.: São Paulo" @keyup.enter="buscarCidades">
            <button class="marcar-todos" type="button" @click="buscarCidades">Buscar</button>
          </div>
        </label>
      </div>

      <p v-if="erroCidade" style="color:var(--abort);font-size:max(9px, calc(13px * var(--escala-texto, 1)));margin:4px 0">{{ erroCidade }}</p>

      <ul v-if="cidadesAchadas.length" class="resultlist">
        <li v-for="c in cidadesAchadas" :key="c.key">
          <span>{{ c.name }}<span v-if="c.region"> · {{ c.region }}</span><span v-if="c.type && c.type!=='city'" style="color:var(--ink-dim)"> · {{ c.type }}</span></span>
          <span class="resultacoes">
            <button class="marcar-todos" type="button" @click="excluirCidade(c)">Excluir</button>
          </span>
        </li>
      </ul>

      <div class="chips" v-if="publico.geo.excluded.length">
        <span class="chip excluido" v-for="e in publico.geo.excluded" :key="e.key">
          excluir: {{ e.nome }}
          <button class="chip-x" type="button" @click="rmExcluida(e.key)">×</button>
        </span>
      </div>

      <div class="fields" style="margin-top:12px">
        <label class="field">
          <span class="fl">Idade mínima</span>
          <input class="fi num" type="number" min="13" max="65" v-model.number="publico.idade_min">
        </label>
        <label class="field">
          <span class="fl">Idade máxima</span>
          <input class="fi num" type="number" min="13" max="65" v-model.number="publico.idade_max">
        </label>
        <label class="field wide">
          <span class="fl">Gênero</span>
          <div class="lojas">
            <button type="button" class="loja-chip" :class="{ sel: publico.generos.includes(1) }" @click="toggleGenero(1)">Homens</button>
            <button type="button" class="loja-chip" :class="{ sel: publico.generos.includes(2) }" @click="toggleGenero(2)">Mulheres</button>
            <span v-if="!publico.generos.length" class="ch-nm" style="font-weight:400;color:var(--ink-dim)">Todos (vazio = ambos)</span>
          </div>
        </label>
      </div>

      <div class="fields" style="margin-top:12px" v-if="chipsSugeridos.length">
        <div class="field wide">
          <span class="fl">Sugestões para {{ sugestoes.rotuloObjetivo }} · {{ sugestoes.marcaNome }}</span>
          <div class="lojas">
            <button type="button" class="loja-chip" v-for="i in chipsSugeridos" :key="i.id" @click="addInteresse({ id: i.id, name: i.nome })">
              {{ i.nome }}<span v-if="i.tam" style="color:var(--ink-dim)"> · {{ i.tam }}</span>
            </button>
          </div>
          <p v-if="sugestoes.geradoEm" class="eyebrow muted" style="margin:6px 0 0">gerado em {{ formatarDataCurta(sugestoes.geradoEm) }}</p>
        </div>
      </div>

      <div class="fields" style="margin-top:12px">
        <label class="field wide">
          <span class="fl">Buscar interesse</span>
          <div class="searchrow">
            <input class="fi" v-model="buscaInteresse" placeholder="ex.: moda feminina" @keyup.enter="buscarInteresses">
            <button class="marcar-todos" type="button" @click="buscarInteresses">Buscar</button>
          </div>
        </label>
      </div>

      <ul v-if="interessesAchados.length" class="resultlist">
        <li v-for="i in interessesAchados" :key="i.id">
          <span>{{ i.name }}</span>
          <button class="marcar-todos" type="button" @click="addInteresse(i)">Adicionar</button>
        </li>
      </ul>

      <div class="chips" v-if="publico.interesses.length">
        <span class="chip" v-for="i in publico.interesses" :key="i.id">
          {{ i.name }}
          <button class="chip-x" type="button" @click="rmInteresse(i.id)">×</button>
        </span>
      </div>

      <div class="cmdrow">
        <button class="cmd cyan" type="button" @click="salvarPreset">Salvar preset</button>
        <button class="cmd cyan" type="button" :disabled="!publico.presetId" @click="apagarPreset">Apagar preset</button>
      </div>

      <div class="ph" style="margin-top:16px"><span class="eyebrow">Públicos salvos</span></div>

      <div class="cmdrow">
        <button class="cmd cyan" type="button" @click="listarAudiences">{{ carregandoAud ? 'Carregando…' : 'Carregar públicos' }}</button>
        <button class="cmd cyan" type="button" @click="criarEngajamento">Criar engajamento</button>
      </div>
      <p v-if="erroAud" style="color:var(--abort);font-size:max(9px, calc(13px * var(--escala-texto, 1)));margin:4px 0">{{ erroAud }}</p>

      <ul v-if="audiences.length" class="resultlist">
        <li v-for="a in audiences" :key="a.id">
          <label class="ch-nm" style="font-weight:400;display:flex;align-items:center;gap:8px">
            <input type="checkbox" :checked="publico.custom_audiences.some((x) => x.id === a.id)" @change="toggleAudiencia(a)">
            {{ a.name }} <span style="color:var(--ink-dim)">· {{ a.subtype }}<span v-if="a.aprox != null"> · ~{{ a.aprox }}</span></span>
          </label>
          <span class="resultacoes">
            <button class="marcar-todos" type="button" @click="criarLookalike(a.id)">Criar lookalike desta</button>
          </span>
        </li>
      </ul>

      <div class="chips" v-if="publico.custom_audiences.length">
        <span class="chip" v-for="a in publico.custom_audiences" :key="a.id">
          {{ a.name }} <span style="color:var(--ink-dim)">· {{ a.subtype }}</span>
          <button class="chip-x" type="button" @click="toggleAudiencia(a)">×</button>
        </span>
      </div>
    </div>
  </section>
</template>
