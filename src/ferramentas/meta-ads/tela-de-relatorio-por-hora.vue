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
          <span class="rph-resumo rph-resumo-dia">
            <span class="rph-valor rph-valor-dia">{{ formatarReais(d.gastoTotal) }}</span>
            <span class="selo" :class="d.conversasTotal > 0 ? 'selo-ok' : 'selo-neutro'">{{ textoConversas(d.conversasTotal) }}</span>
          </span>
        </button>

        <div v-if="expandido(d.dia)" class="rph-horas">
          <div v-for="h in d.horas" :key="h.hora" class="rph-hora">
            <button class="rph-hora-cabecalho" @click="alternarHora(d.dia, h.hora)">
              <span class="rph-hora-seta" :class="{ aberto: horaExpandida(d.dia, h.hora) }">▸</span>
              <span class="rph-hora-rotulo">{{ String(h.hora).padStart(2, '0') }}h</span>
              <span class="rph-resumo">
                <span class="rph-valor">{{ formatarReais(h.gastoTotal) }}</span>
                <span class="selo" :class="h.conversasTotal > 0 ? 'selo-ok' : 'selo-neutro'">{{ textoConversas(h.conversasTotal) }}</span>
              </span>
            </button>

            <!-- Hora aberta mostra Campanhas e Seguidores direto, sem clique
                 a mais — são o conteúdo principal do relatório. Só "Mensagens
                 do grupo" (texto pronto pra copiar, uso secundário agora que
                 o robô manda sozinho) continua atrás de um toggle, e esse
                 toggle é POR HORA, não global — cada hora abre e fecha a sua,
                 sem mexer nas outras. -->
            <div v-if="horaExpandida(d.dia, h.hora)" class="rph-hora-conteudo">
              <div class="rph-bloco">
                <div class="rph-bloco-topo">
                  <span class="section-label">Campanhas</span>
                  <button class="btn rph-toggle" @click="modoCampanhas = modoCampanhas === 'resultado' ? 'todas' : 'resultado'">
                    {{ modoCampanhas === 'resultado' ? 'Mostrar todas' : 'Só com resultado' }}
                  </button>
                </div>
                <table v-if="campanhasParaExibir(h).length" class="rph-tabela">
                  <thead><tr><th>Campanha</th><th>Investido</th><th>Conversas</th><th>Custo/lead</th></tr></thead>
                  <tbody>
                    <tr v-for="c in campanhasParaExibir(h)" :key="c.campaignId">
                      <td class="rph-campanha">{{ c.nome }}</td>
                      <td class="rph-num">{{ formatarReais(c.gastoHora) }}</td>
                      <td class="rph-num">{{ c.conversasHora }}</td>
                      <td class="rph-num">{{ c.custoPorLead === null ? '—' : formatarReais(c.custoPorLead) }}</td>
                    </tr>
                  </tbody>
                </table>
                <p v-else class="rph-vazio">Nenhuma campanha nessa hora, com esse filtro.</p>
              </div>

              <div
                v-if="seguidoresNaHora(deltasSeguidores, d.dia, h.hora) !== null || visitasPerfilNaHora(visitasPerfil, d.dia, h.hora) !== null"
                class="rph-bloco"
              >
                <span class="section-label">Seguidores</span>
                <!-- Da CONTA inteira, nunca por campanha — a Meta não diz qual
                     anúncio trouxe qual seguidor (nem visita ao perfil). Some
                     quando não há leitura pra essa hora (nunca mostra 0 como
                     se fosse "não mudou"/"não teve"). -->
                <p v-if="seguidoresNaHora(deltasSeguidores, d.dia, h.hora) !== null" class="rph-seguidores-conta">
                  Seguidores da conta nessa hora:
                  <strong class="rph-num">{{ seguidoresNaHora(deltasSeguidores, d.dia, h.hora) > 0 ? '+' : '' }}{{ seguidoresNaHora(deltasSeguidores, d.dia, h.hora) }}</strong>
                </p>
                <p v-if="visitasPerfilNaHora(visitasPerfil, d.dia, h.hora) !== null" class="rph-seguidores-conta">
                  Visitas ao perfil da conta nessa hora:
                  <strong class="rph-num">{{ visitasPerfilNaHora(visitasPerfil, d.dia, h.hora) }}</strong>
                </p>
              </div>

              <div v-if="mensagemWpp(d, h) || mensagemSeguidores(d, h)" class="rph-bloco rph-bloco-mensagens">
                <button class="rph-bloco-topo rph-mensagens-cabecalho" @click="alternarMensagens(d.dia, h.hora)">
                  <span class="section-label">Mensagens do grupo</span>
                  <span class="rph-secao-seta" :class="{ aberto: mensagensAbertas(d.dia, h.hora) }">▸</span>
                </button>
                <template v-if="mensagensAbertas(d.dia, h.hora)">
                  <div v-if="mensagemWpp(d, h)" class="rph-msg-bloco">
                    <span class="rph-msg-rotulo">WPP</span>
                    <pre class="rph-msg-wpp">{{ mensagemWpp(d, h) }}</pre>
                    <button class="btn" @click="copiar(mensagemWpp(d, h))">
                      {{ textoCopiado === mensagemWpp(d, h) ? 'Copiado!' : 'Copiar' }}
                    </button>
                  </div>
                  <div v-if="mensagemSeguidores(d, h)" class="rph-msg-bloco">
                    <span class="rph-msg-rotulo">Seguidores</span>
                    <pre class="rph-msg-wpp">{{ mensagemSeguidores(d, h) }}</pre>
                    <button class="btn" @click="copiar(mensagemSeguidores(d, h))">
                      {{ textoCopiado === mensagemSeguidores(d, h) ? 'Copiado!' : 'Copiar' }}
                    </button>
                  </div>
                </template>
              </div>
            </div>
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
import {
  agruparPorDiaEHora, comResultado, montarMensagemWpp, leadsWppNoDia, gastoWppNoDia, montarMensagemSeguidores, formatarReais,
  deltaDeSeguidoresPorHora, seguidoresNaHora, seguidoresTotalNaHora, seguidoresNoDia, visitasPerfilNaHora,
  gastoSeguidoresNoDia, visitasPerfilNoDia,
} from './relatorio-por-hora.js'

const router = useRouter()
function voltar() {
  router.push({ name: 'meta-ads' })
}

// Últimos 14 dias bastam pra um relatório que só olha "hoje" e "essa
// semana" — sem filtro de período nesta primeira entrega (spec §8, YAGNI).
const JANELA_DIAS = 14

// Pedido do dono (12/09/2026): só a conta "Vessel" (id em public.accounts).
// Cravado porque é a única conta pedida hoje — não "La Vessel Dom Pedro",
// que é loja à parte. Virar seletor de conta é trabalho de outra entrega.
const CONTA_VESSEL = 'b6883e82-07cb-4f21-9fd7-ea7626786174'

const carregando = ref(true)
const erro = ref(null)
const dias = ref([])
const deltasSeguidores = ref([])
const visitasPerfil = ref([])
const expandidos = ref(new Set())
const horasExpandidas = ref(new Set())
const mensagensExpandidas = ref(new Set())

// "Só com resultado / Mostrar todas" é POR TIPO, não por hora isolada —
// pedido do dono (12/09/2026): um clique afeta o filtro em todas as horas de
// uma vez. Diferente do que abre/fecha (hora e mensagens), que é sempre por
// hora — ver alternarHora/alternarMensagens.
const modoCampanhas = ref('resultado')

// "Campanhas" junta Resultados+Outras num recorte só, controlado pelo
// toggle acima — preserva a ordem por gasto que `agruparPorDiaEHora` já traz.
function campanhasParaExibir(h) {
  return modoCampanhas.value === 'resultado' ? comResultado(h.campanhas) : h.campanhas.filter((c) => c.tipo !== 'seguidores')
}
function mensagemWpp(d, h) {
  return montarMensagemWpp(d.dia, h.hora, h.campanhas, leadsWppNoDia(d.horas), gastoWppNoDia(d.horas))
}
// Gasto das campanhas [+ SEGUIDORES] nessa hora — pedido do dono (12/09/2026,
// "faz uma linha de investimento também"): o mesmo gasto que já vem em
// h.campanhas, só somado pro tipo certo. Não precisa de leitura nova.
function gastoSeguidores(h) {
  return h.campanhas.filter((c) => c.tipo === 'seguidores').reduce((s, c) => s + c.gastoHora, 0)
}
function mensagemSeguidores(d, h) {
  return montarMensagemSeguidores(
    d.dia, h.hora,
    seguidoresNaHora(deltasSeguidores.value, d.dia, h.hora),
    visitasPerfilNaHora(visitasPerfil.value, d.dia, h.hora),
    seguidoresTotalNaHora(deltasSeguidores.value, d.dia, h.hora),
    seguidoresNoDia(deltasSeguidores.value, d.dia),
    gastoSeguidores(h),
    gastoSeguidoresNoDia(d.horas),
    visitasPerfilNoDia(visitasPerfil.value, d.dia),
  )
}

// "sem conversa" em vez de "0 conversas" — lê melhor no selo, e o selo
// neutro (cinza) já diz "não converteu" sem precisar do número.
function textoConversas(n) {
  if (n === 0) return 'sem conversa'
  return `${n} conversa${n === 1 ? '' : 's'}`
}

function expandido(dia) {
  return expandidos.value.has(dia)
}
function alternar(dia) {
  const s = new Set(expandidos.value)
  if (s.has(dia)) s.delete(dia)
  else s.add(dia)
  expandidos.value = s
}

// Cada HORA expande/recolhe por si só, dentro do dia — diferente do toggle
// de filtro (que é global, valendo pras horas todas de uma vez).
function chaveHora(dia, hora) {
  return `${dia}|${hora}`
}
function horaExpandida(dia, hora) {
  return horasExpandidas.value.has(chaveHora(dia, hora))
}
function alternarHora(dia, hora) {
  const chave = chaveHora(dia, hora)
  const s = new Set(horasExpandidas.value)
  if (s.has(chave)) s.delete(chave)
  else s.add(chave)
  horasExpandidas.value = s
}

// "Mensagens do grupo" também abre/fecha por hora — mesmo motivo de
// horaExpandida: um clique não pode mudar a hora vizinha sem avisar.
function mensagensAbertas(dia, hora) {
  return mensagensExpandidas.value.has(chaveHora(dia, hora))
}
function alternarMensagens(dia, hora) {
  const chave = chaveHora(dia, hora)
  const s = new Set(mensagensExpandidas.value)
  if (s.has(chave)) s.delete(chave)
  else s.add(chave)
  mensagensExpandidas.value = s
}

function formatarDia(iso) {
  const [ano, mes, dia] = iso.split('-')
  return `${dia}/${mes}/${ano}`
}

// Copiar com plano B: `navigator.clipboard` falha em contexto sem HTTPS e
// quando a permissão é negada — mesmo padrão de tela-de-admin.vue.
const textoCopiado = ref(null)
function copiar(texto) {
  const plano2 = () => {
    try {
      const ta = document.createElement('textarea')
      ta.value = texto; ta.style.position = 'fixed'; ta.style.opacity = '0'
      document.body.appendChild(ta); ta.focus(); ta.select()
      document.execCommand('copy'); ta.remove()
      return true
    } catch (e) { return false }
  }
  const marcarCopiado = () => {
    textoCopiado.value = texto
    setTimeout(() => { if (textoCopiado.value === texto) textoCopiado.value = null }, 2000)
  }
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(texto).then(marcarCopiado).catch(() => { if (plano2()) marcarCopiado() })
  } else if (plano2()) marcarCopiado()
}

async function carregar() {
  carregando.value = true
  erro.value = null

  const desde = new Date()
  desde.setDate(desde.getDate() - JANELA_DIAS)
  const desdeISO = desde.toISOString().slice(0, 10)

  const [linhas, campanhas, leiturasSeguidores, visitas] = await Promise.all([
    sb(`campaign_insights_hora?select=dia,hora,campaign_id,gasto_hora,gasto_acumulado,conversas_hora&dia=gte.${desdeISO}&account_id=eq.${CONTA_VESSEL}&order=dia.desc,hora.asc`),
    sb('campaigns?select=campaign_id,name'),
    sb(`followers_leituras?select=followers_count,lido_em&account_id=eq.${CONTA_VESSEL}&lido_em=gte.${desde.toISOString()}&order=lido_em.asc`),
    sb(`perfil_visitas_hora?select=dia,hora,visitas_hora&dia=gte.${desdeISO}&account_id=eq.${CONTA_VESSEL}&order=dia.desc,hora.asc`),
  ])

  if (linhas.erro) { erro.value = linhas.erro; carregando.value = false; return }
  if (campanhas.erro) { erro.value = campanhas.erro; carregando.value = false; return }
  if (leiturasSeguidores.erro) { erro.value = leiturasSeguidores.erro; carregando.value = false; return }
  if (visitas.erro) { erro.value = visitas.erro; carregando.value = false; return }

  const nomesPorCampanha = Object.fromEntries(campanhas.map((c) => [c.campaign_id, c.name]))
  dias.value = agruparPorDiaEHora(linhas, nomesPorCampanha)
  deltasSeguidores.value = deltaDeSeguidoresPorHora(leiturasSeguidores)
  visitasPerfil.value = visitas

  carregando.value = false
}

onMounted(carregar)
</script>

<style scoped>
.tela-relatorio-hora { min-height: 100vh; display: flex; flex-direction: column; background: var(--bg); }
.rph-body { flex: 1; padding: var(--sp-6) var(--sp-6); display: flex; flex-direction: column; gap: var(--sp-4); }
.rph-vazio { color: var(--muted); font-size: var(--texto-corpo); }

.rph-dia { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-lg); overflow: hidden; }
.rph-dia-cabecalho { width: 100%; min-height: 48px; display: flex; align-items: center; flex-wrap: wrap; gap: var(--sp-1) var(--sp-3); padding: var(--sp-3) var(--sp-4); background: none; border: none; cursor: pointer; text-align: left; font-family: var(--fonte-principal); color: var(--text); }
.rph-dia-seta { color: var(--muted); transition: transform .15s; flex-shrink: 0; }
.rph-dia-seta.aberto { transform: rotate(90deg); }
.rph-dia-data { font-weight: 600; font-size: var(--texto-campo); overflow-wrap: anywhere; }

/* O RESUMO (valor + selo) fica à direita no desktop e quebra pra baixo da
   data no celular — nunca aperta o texto nem estoura a largura da tela. */
.rph-resumo { margin-left: auto; display: flex; align-items: center; gap: var(--sp-2); flex-wrap: wrap; }
.rph-valor { font-family: var(--fonte-dados); font-variant-numeric: tabular-nums; font-weight: 600; font-size: var(--texto-corpo); color: var(--text); white-space: nowrap; }
.rph-valor-dia { font-size: var(--texto-campo); font-weight: 700; }

.rph-horas { border-top: 1px solid var(--border); display: flex; flex-direction: column; }
.rph-hora { padding: var(--sp-3) var(--sp-4); border-bottom: 1px solid var(--border); display: flex; flex-direction: column; gap: var(--sp-3); }
.rph-hora:last-child { border-bottom: none; }
.rph-hora-cabecalho { width: 100%; min-height: 44px; display: flex; align-items: center; flex-wrap: wrap; gap: var(--sp-1) var(--sp-3); background: none; border: none; cursor: pointer; padding: 0; text-align: left; font-family: var(--fonte-principal); color: var(--text); }
.rph-hora-seta { color: var(--muted); transition: transform .15s; flex-shrink: 0; }
.rph-hora-seta.aberto { transform: rotate(90deg); }
.rph-hora-rotulo { font-weight: 700; font-size: var(--texto-corpo); min-width: 34px; }

/* Conteúdo da hora: Campanhas e Seguidores sempre visíveis assim que a hora
   abre (são o principal do relatório); só "Mensagens do grupo" continua
   atrás de um clique, por ser uso secundário (o robô já manda sozinho). */
.rph-hora-conteudo { display: flex; flex-direction: column; gap: var(--sp-4); }
.rph-bloco { display: flex; flex-direction: column; gap: var(--sp-2); }
.rph-bloco-topo { display: flex; align-items: center; justify-content: space-between; gap: var(--sp-2); flex-wrap: wrap; min-height: 40px; }
.rph-toggle { align-self: flex-start; }
.rph-seguidores-conta { margin: 0; font-size: var(--texto-corpo); color: var(--text); }

.rph-tabela { width: 100%; border-collapse: collapse; font-size: var(--texto-corpo); }
.rph-tabela th { text-align: left; color: var(--muted); font-weight: 600; padding: var(--sp-1) var(--sp-2); border-bottom: 1px solid var(--border); }
.rph-tabela td { padding: var(--sp-1) var(--sp-2); border-bottom: 1px solid var(--border); }
.rph-tabela tr:last-child td { border-bottom: none; }
.rph-campanha { overflow-wrap: anywhere; }
.rph-num { font-family: var(--fonte-dados); font-variant-numeric: tabular-nums; }

/* Mensagens: bloco secundário — fundo sutil próprio pra ler como utilitário,
   não como o conteúdo principal da hora. */
.rph-bloco-mensagens { background: var(--surface2); border-radius: var(--radius-md); padding: var(--sp-3); }
.rph-mensagens-cabecalho { width: 100%; background: none; border: none; cursor: pointer; padding: 0; text-align: left; font-family: var(--fonte-principal); }
.rph-secao-seta { color: var(--muted); transition: transform .15s; flex-shrink: 0; }
.rph-secao-seta.aberto { transform: rotate(90deg); }
.rph-msg-bloco { display: flex; flex-direction: column; gap: var(--sp-2); align-items: flex-start; margin-top: var(--sp-3); }
.rph-msg-rotulo { font-family: var(--fonte-principal); font-weight: 600; font-size: var(--texto-etiqueta); letter-spacing: 1px; text-transform: uppercase; color: var(--muted); }
.rph-msg-wpp { width: 100%; margin: 0; padding: var(--sp-3); background: var(--bg); border: 1px solid var(--border); border-radius: var(--radius-md); font-family: var(--fonte-principal); font-size: var(--texto-corpo); color: var(--text); white-space: pre-wrap; overflow-wrap: anywhere; }

@media (max-width: 640px) {
  .rph-body { padding: var(--sp-4) var(--sp-3); }
  .rph-tabela { display: block; overflow-x: auto; }
  .rph-resumo { width: 100%; justify-content: space-between; margin-left: 0; }
}
</style>
