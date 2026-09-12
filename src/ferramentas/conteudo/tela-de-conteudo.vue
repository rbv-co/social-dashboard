<template>
  <!-- CENTRAL DE CONTEÚDO. Casca fina: topbar, seletor de marca, abas e carga
       dos dados. Cada visão é um componente próprio, e a regra de negócio mora
       nos .js puros ao lado (estados.js, formatos.js, agrupar-kanban.js…).
       Classes .ctd- para não colidir com o CSS global. -->
  <div class="ctd-tela">
    <barra-de-topo voltar="Central" titulo="Central de Conteúdo" @voltar="router.push({ name: 'inicio' })">
      <template #acoes>
        <select v-model="contaSel" class="bt-acao" aria-label="Perfil">
          <option v-for="c in contas" :key="c.id" :value="c.id">{{ c.name }}</option>
        </select>
        <button class="bt-acao" :disabled="!contaSel" @click="painelSemana = true"><IconeFaisca /> Montar a semana</button>
        <button class="bt-acao primario" :disabled="!contaSel" @click="abrirNova()">+ Nova peça</button>
      </template>
    </barra-de-topo>

    <div class="ctd-body">
      <p v-if="permissaoPelaMetade" class="ctd-aviso ctd-aviso-atencao">
        <b>Sua permissão está pela metade.</b> A ferramenta aparece para você, mas o banco de dados
        ainda não liberou o acesso — por isso a lista pode vir vazia mesmo tendo peças cadastradas.
        Peça a um administrador para abrir seu usuário em <b>Administração › Usuários</b> e salvar de
        novo; isso acerta os dois lados.
      </p>

      <p v-if="erro" class="ctd-aviso ctd-aviso-erro">{{ erro }}</p>

      <div v-if="carregando" class="ctd-vazio"><p>Carregando…</p></div>

      <template v-else-if="contas.length">
        <!-- O QUE SAI A SEGUIR. É a pergunta que a pessoa tem ao abrir a tela, e
             antes disso ela precisava caçar no calendário. Só aparece quando há
             algo agendado — faixa vazia todo dia vira ruído. -->
        <section v-if="proximas.length" class="ctd-proximas">
          <div class="ctd-proximas-cab">
            <span class="ctd-proximas-t">Sai a seguir</span>
            <span class="ctd-proximas-sub">
              as próximas {{ proximas.length === 1 ? 'peça' : proximas.length + ' peças' }} com data
            </span>
          </div>
          <div class="ctd-proximas-fila">
            <button
              v-for="p in proximas"
              :key="p.id"
              class="ctd-proxima"
              :style="{ '--ctd-cor-status': corDeStatus(p.status) }"
              @click="abrir(p)"
            >
              <img v-if="miniaturas[p.id]" :src="miniaturas[p.id]" alt="" class="ctd-proxima-mini">
              <span v-else class="ctd-proxima-mini ctd-proxima-sem"><IconeFormato :formato="p.formato" :tamanho="18" /></span>
              <span class="ctd-proxima-txt">
                <span class="ctd-proxima-quando">
                  <i v-if="ehIminente(p.publicar_em) && p.status === 'agendada'" class="ctd-pulso"></i>
                  {{ quandoSai(p.publicar_em) }}
                </span>
                <span class="ctd-proxima-titulo">{{ p.titulo || 'Sem título' }}</span>
                <!-- A FAIXA ESTAVA PROMETENDO O QUE O SISTEMA NÃO CUMPRE: ela
                     incluía peças `aprovada` com data, mas o robô da hora H só
                     dispara para `agendada`. A peça aparecia como "sai a
                     seguir" e nada a faria sair — inclusive depois de alguém
                     desagendar, porque desagendar não limpa a data.
                     Em vez de escondê-la (o que faria a peça esquecida sumir),
                     a faixa agora avisa o que falta. -->
                <span v-if="p.status !== 'agendada'" class="ctd-proxima-falta">
                  falta agendar — o aviso não vai sair
                </span>
              </span>
            </button>
          </div>
        </section>

        <div class="ctd-selos">
          <span v-for="s in selos" :key="s.chave" class="ctd-selo">
            <i :style="{ background: s.cor }"></i>{{ s.rotulo }} <b>{{ s.total }}</b>
          </span>
          <span v-if="aguardando" class="ctd-selo ctd-selo-pergunta">
            <i class="ctd-pulso" style="background:var(--orange)"></i>Esperando você confirmar o post <b>{{ aguardando }}</b>
          </span>
        </div>

        <!-- QUATRO ABAS, agrupadas pelo que a pessoa está FAZENDO — não pelo
             tipo de visualização. Eram seis, e três delas (Calendário, Prévia,
             Lista) eram formas de olhar a mesma coisa, o que obrigava a pular
             de aba para montar uma ideia na cabeça.
               Home ......... o mês e como o perfil vai ficar, lado a lado
               Programação .. o trabalho em andamento: quadro ou tabela
               Ideias ....... o que ainda não virou peça
               Voz da marca . o que a IA sabe desta marca -->
        <div class="ctd-tabs">
          <button :class="{ on: aba === 'home' }" @click="aba = 'home'">Home</button>
          <button :class="{ on: aba === 'programacao' }" @click="aba = 'programacao'">
            Programação<span v-if="pecas.length"> ({{ pecas.length }})</span>
          </button>
          <button :class="{ on: aba === 'ideias' }" @click="aba = 'ideias'">
            Ideias<span v-if="ideias.length"> ({{ ideias.length }})</span>
          </button>
          <button :class="{ on: aba === 'voz' }" @click="aba = 'voz'">Voz da marca</button>

          <!-- UMA BUSCA SÓ, valendo para todas as abas.
               Não havia busca em lugar nenhum, e os filtros de cada visão eram
               locais: filtrar na Lista e pular para o Calendário devolvia tudo.
               Aqui o termo atravessa as abas junto com a pessoa. -->
          <div class="ctd-busca">
            <input
              v-model="busca"
              type="search"
              class="ctd-busca-in"
              placeholder="Buscar por título, legenda, hashtag…"
              aria-label="Buscar em todas as visões"
            >
            <button v-if="busca" class="ctd-busca-x" aria-label="Limpar busca" @click="busca = ''">×</button>
          </div>
        </div>

        <!-- Ideias e Voz da marca ficam FORA do "se não tem peça": são
             justamente por onde se começa quando não há nada. -->
        <VisaoIdeias
          v-show="aba === 'ideias'"
          :ideias="ideiasVisiveis"
          :account-id="contaSel"
          @mudou="recarregar"
          @abrir-peca="aoNascerPeca"
        />

        <VozDaMarca
          v-if="aba === 'voz' && contaSel"
          :conta="contaAtual"
          :account-id="contaSel"
          :pecas="pecas"
          @mudou="recarregar"
        />

        <!-- Convite, não bloqueio: com zero peças a ferramenta ANTES sumia e
             sobrava uma caixa de texto. A estrutura vazia é que ensina o que a
             ferramenta faz — o calendário do mês, as colunas do quadro, a grade
             do perfil. Então a faixa aparece POR CIMA das visões, e elas
             continuam lá atrás. -->
        <div v-if="!pecas.length && aba !== 'ideias' && aba !== 'voz'" class="ctd-convite">
          <span class="ctd-convite-txt">
            <b>Nenhuma peça ainda.</b>
            Monte a primeira: ela passa pela aprovação, fica agendada, e na hora marcada
            chega um aviso no celular com tudo pronto para publicar.
          </span>
          <button class="ctd-btn ctd-btn-primario" @click="abrirNova()">Criar a primeira peça</button>
        </div>

        <VisaoHome
          v-show="aba === 'home'"
          :pecas="pecasVisiveis"
          :miniaturas="miniaturas"
          :conta="contaAtual"
          @abrir="abrir"
          @nova="abrirNova"
          @remarcar="remarcar"
        />

        <VisaoProgramacao
          v-show="aba === 'programacao'"
          :pecas="pecasVisiveis"
          :miniaturas="miniaturas"
          :metricas="metricas"
          :pode-aprovar="podeAprovar"
          :trabalhando="emLote"
          @abrir="abrir"
          @mover="mover"
          @mover-lote="moverLote"
        />
      </template>

      <!-- `!erro` é o que separa "não tem perfil" de "não consegui ler".
           Sem ele, uma falha no carregarContas() zerava `contas` e caía aqui: a
           tela afirmava "Você não tem acesso a nenhum perfil" e mandava a pessoa
           procurar um administrador por um problema que NÃO era de permissão —
           enquanto a faixa de erro, logo acima, dizia o contrário. Duas frases
           contradizendo uma à outra na mesma tela. A faixa já conta o que houve;
           aqui o silêncio é mais honesto que a frase errada. (PADRÃO, item 9.) -->
      <div v-else-if="!erro" class="ctd-vazio">
        <h3>Nenhum perfil disponível</h3>
        <p>Você não tem acesso a nenhum perfil de rede social. Fale com um administrador.</p>
      </div>
    </div>

    <PainelPeca
      v-if="painelAberto"
      :peca="pecaEmEdicao"
      :account-id="contaSel"
      :data-sugerida="dataSugerida"
      :pode-aprovar="podeAprovar"
      @fechar="fecharPainel"
      @mudou="recarregar"
      @abrir-peca="p => { recarregar(); abrir(p) }"
    />

    <PainelSemana
      v-if="painelSemana && contaSel"
      :account-id="contaSel"
      :ideias="ideias"
      @fechar="painelSemana = false"
      @mudou="recarregar"
    />
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import BarraDeTopo from '../../compartilhado/barra-de-topo.vue'
import { useRouter } from 'vue-router'
import VisaoHome from './visao-home.vue'
import VisaoProgramacao from './visao-programacao.vue'
import VisaoIdeias from './visao-ideias.vue'
import VozDaMarca from './voz-da-marca.vue'
import IconeFormato from './icone-formato.vue'
import PainelPeca from './painel-peca.vue'
import PainelSemana from './painel-semana.vue'
import { IconeFaisca } from './icones.js'
import { STATUS, corDeStatus } from './estados.js'
import { contarPorStatus } from './agrupar-kanban.js'
import { filtrarPecas, filtrarIdeias } from './buscar.js'
import { diaDaPeca, horaDaPeca, dataHoraBRT, deCampoDeDataHora } from './grade-do-calendario.js'
import { hojeLocal } from '../../compartilhado/datas.js'
import * as dados from './dados-conteudo.js'
import './estilos-conteudo.css'

const router = useRouter()

const contas = ref([])
const contaSel = ref('')
const pecas = ref([])
const ideias = ref([])
const busca = ref('')

// O que cada visão enxerga depois da busca. As peças do painel "A marca" e os
// selos do topo continuam usando `pecas` cru: eles falam da marca inteira, não
// do recorte que a pessoa está olhando agora.
const pecasVisiveis = computed(() => filtrarPecas(pecas.value, busca.value))
const ideiasVisiveis = computed(() => filtrarIdeias(ideias.value, busca.value))
const miniaturas = ref({})
const metricas = ref({})
const aguardando = ref(0)
const aba = ref('home')
const carregando = ref(true)
const erro = ref('')

const painelAberto = ref(false)
const painelSemana = ref(false)
const pecaEmEdicao = ref(null)
const dataSugerida = ref('')

const podeAprovar = dados.podeAprovar()
const permissaoPelaMetade = dados.permissaoIncompleta()

// As próximas a sair, no máximo 4. Quatro cabe numa linha em tela de trabalho e
// responde "o que vem por aí" sem virar uma segunda lista concorrendo com o
// calendário.
// A conta selecionada por inteiro (nome, @, foto) — a prévia do feed usa para
// montar a moldura de perfil.
const contaAtual = computed(() => contas.value.find(c => c.id === contaSel.value) || null)

const proximas = computed(() => {
  const agora = Date.now()
  return pecas.value
    .filter(p => (p.status === 'agendada' || p.status === 'aprovada') && p.publicar_em)
    .filter(p => new Date(p.publicar_em).getTime() > agora - 3600_000)  // tolera 1h de atraso
    .sort((a, b) => String(a.publicar_em).localeCompare(String(b.publicar_em)))
    .slice(0, 4)
})

// O relógio que faz a contagem regressiva andar. Sem ele, "em 2h 15min" ficaria
// congelado no valor de quando a tela abriu — pior que não ter contagem, porque
// parece atual e não é.
const agora = ref(Date.now())
let tique = null
onMounted(() => { tique = setInterval(() => { agora.value = Date.now() }, 30_000) })
onUnmounted(() => clearInterval(tique))

// Falta menos de 2 horas? É o que acende o ponto pulsante — o aviso de que essa
// peça precisa de atenção AGORA, não depois.
function ehIminente(iso) {
  if (!iso) return false
  const falta = new Date(iso).getTime() - agora.value
  return falta > -3600_000 && falta < 2 * 3600_000
}

// "em 12 min", "em 2h 15min", "hoje às 18:00", "amanhã às 09:00", "15/07 às 18:00".
//
// Perto da hora, contagem regressiva; longe, data e hora. Uma peça que sai em 20
// minutos e outra que sai semana que vem não pedem a mesma leitura — a primeira
// é urgência, a segunda é informação.
function quandoSai(iso) {
  const falta = new Date(iso).getTime() - agora.value
  if (falta > 0 && falta < 6 * 3600_000) {
    const min = Math.round(falta / 60000)
    if (min < 60) return `em ${min} min`
    return `em ${Math.floor(min / 60)}h ${String(min % 60).padStart(2, '0')}min`
  }
  if (falta <= 0 && falta > -3600_000) return 'agora'

  const dia = diaDaPeca(iso)
  const hoje = hojeLocal()
  const hora = horaDaPeca(iso)
  if (dia === hoje) return `hoje às ${hora}`
  const amanha = new Date(`${hoje}T12:00:00-03:00`)
  amanha.setDate(amanha.getDate() + 1)
  if (dia === amanha.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })) {
    return `amanhã às ${hora}`
  }
  return dataHoraBRT(iso)
}

// Só os selos que interessam no dia a dia — sete contagens viram ruído.
const DESTACADOS = ['em_aprovacao', 'aprovada', 'agendada']
const selos = computed(() => {
  const c = contarPorStatus(pecas.value)
  return STATUS.filter(s => DESTACADOS.includes(s.chave))
    .map(s => ({ chave: s.chave, rotulo: s.rotulo, cor: corDeStatus(s.chave), total: c[s.chave] }))
})

async function carregarContas() {
  try {
    contas.value = await dados.listarContas()
    if (contas.value.length && !contaSel.value) contaSel.value = contas.value[0].id
  } catch (e) {
    erro.value = e.message
  }
}

async function recarregar() {
  if (!contaSel.value) { pecas.value = []; ideias.value = []; return }
  try {
    erro.value = ''
    pecas.value = await dados.listarPecas(contaSel.value)
    await carregarMiniaturas()
  } catch (e) {
    erro.value = e.message
  }
  // As ideias em separado: uma falha aqui não pode esconder o calendário.
  try {
    ideias.value = await dados.listarIdeias(contaSel.value)
  } catch {
    ideias.value = []
  }
}

// A ideia virou rascunho: abre a peça nova já para edição, senão a pessoa fica
// sem saber para onde ela foi.
function aoNascerPeca(peca) {
  aba.value = 'home'
  abrir(peca)
}

async function carregarMiniaturas() {
  // Miniatura e métrica são enfeite: se falharem, os cartões mostram o ícone do
  // formato e seguem funcionando. Não vale poluir a faixa de erro por isso.
  const ids = pecas.value.map(p => p.id)
  try {
    miniaturas.value = await dados.miniaturasDasPecas(ids)
  } catch {
    miniaturas.value = {}
  }
  try {
    metricas.value = await dados.metricasDasPecas(ids)
    // Quantas peças estão com a pergunta "É este post?" esperando resposta.
    // Vira o selo da topbar — senão a pergunta ficaria escondida dentro de cada
    // peça, e ninguém abre peça publicada para conferir.
    aguardando.value = Object.keys(await dados.sugestoesDeCasamento(ids)).length
  } catch {
    metricas.value = {}
    aguardando.value = 0
  }
}

function abrir(peca) {
  pecaEmEdicao.value = peca
  dataSugerida.value = ''
  painelAberto.value = true
}

function abrirNova(dia = '') {
  pecaEmEdicao.value = null
  dataSugerida.value = dia
  painelAberto.value = true
}

function fecharPainel() {
  painelAberto.value = false
  pecaEmEdicao.value = null
}

// MOVER VÁRIAS DE UMA VEZ.
//
// Uma a uma, em sequência, e não em paralelo: aprovar passa por função do banco
// que valida permissão e registra evento na mesma transação — dez chamadas
// simultâneas disputariam a mesma linha. Dez peças levam segundos; a clareza do
// que falhou vale mais que os segundos economizados.
const emLote = ref(false)
async function moverLote({ pecas: alvo, destino }) {
  if (!alvo?.length) return
  erro.value = ''
  emLote.value = true
  const falhas = []
  try {
    for (const peca of alvo) {
      try {
        if (destino === 'aprovada' || destino === 'reprovada') await dados.decidir(peca.id, destino)
        else await dados.mudarStatus(peca, destino)
      } catch (e) {
        falhas.push(`${peca.titulo || 'sem título'}: ${e.message}`)
      }
    }
    await recarregar()
    // Dizer QUAIS falharam, não quantas: "2 de 8 falharam" não deixa ninguém
    // consertar nada.
    if (falhas.length) erro.value = `Não consegui mover: ${falhas.join(' · ')}`
  } finally {
    emLote.value = false
  }
}

// REMARCAR PELO CALENDÁRIO. Muda o DIA e mantém a hora: quem arrasta quer
// trocar a data, não o horário — que foi escolhido por um motivo.
async function remarcar({ peca, dia }) {
  erro.value = ''
  try {
    // A hora atual da peça, em Brasília. Sem data anterior (peça solta), 09:00,
    // o mesmo padrão do "+" do calendário.
    const horaAtual = peca.publicar_em ? horaDaPeca(peca.publicar_em) : '09:00'
    const quando = deCampoDeDataHora(`${dia}T${horaAtual}`)

    // `avisado_em` PRECISA ser zerado. A peça remarcada continuaria marcada
    // como já avisada e o robô da hora H — que só olha quem tem o campo nulo —
    // nunca mais tocaria nela. Falha silenciosa: nenhum erro, o aviso
    // simplesmente não chega. (Foi exatamente o que aconteceu pelo botão
    // Salvar antes de eu corrigir lá.)
    await dados.atualizarPeca(peca.id, { publicar_em: quando, avisado_em: null })
    await dados.registrarEvento(peca.id, {
      acao: 'remarcou',
      detalhe: `Arrastada no calendário para ${dia} às ${horaAtual}.`,
    })
    await recarregar()
  } catch (e) {
    erro.value = e.message
  }
}

async function mover({ peca, destino, veredito }) {
  if (!veredito.ok) { erro.value = veredito.motivo; return }
  try {
    erro.value = ''
    if (destino === 'aprovada' || destino === 'reprovada') {
      await dados.decidir(peca.id, destino)
    } else {
      await dados.mudarStatus(peca, destino)
    }
    await recarregar()
  } catch (e) {
    erro.value = e.message
  }
}

watch(contaSel, recarregar)

onMounted(async () => {
  await carregarContas()
  await recarregar()
  carregando.value = false
})
</script>
