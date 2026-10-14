<template>
  <!-- VOZ DA MARCA. Era um modal chamado "A marca", aberto por um botão solto
       na ponta da fita de abas — e por isso quase invisível: quem não soubesse
       que existia, não achava.
       Como ABA, ela entra no caminho natural de quem está montando conteúdo, e
       o nome diz o que de fato importa ali: o tom que a IA vai imitar. Os
       concorrentes e o Portal continuam aqui porque calibram esse mesmo tom. -->
  <section class="ctd-voz">
  <div class="ctd-voz-corpo">
    <p class="ctd-ajuda">
      O que você preenche aqui vai junto toda vez que pedir ideias para a IA. É o que
      separa uma pauta genérica de uma pauta desta marca.
    </p>

    <p v-if="erro" class="ctd-aviso ctd-aviso-erro">{{ erro }}</p>

    <!-- ── Como a marca fala ── -->
    <section class="ctd-rot-bloco">
      <h3 class="ctd-rot-h">Como esta marca fala</h3>
      <p class="ctd-ajuda">
        Cole legendas, frases e assinaturas que a marca já usa. A IA imita o tom que
        enxerga aqui — sem nada, ela inventa um tom.
      </p>

      <ul v-if="blocos.length" class="ctd-mini-lista">
        <li v-for="b in blocos" :key="b.id">
          <div>
            <b>{{ b.nome || TIPOS[b.tipo] || b.tipo }}</b>
            <span>{{ b.texto }}</span>
          </div>
          <button class="ctd-mini-btn perigo" title="Remover" @click="removerBloco(b)">×</button>
        </li>
      </ul>

      <div class="ctd-campo">
        <div class="ctd-linha-dupla">
          <select v-model="novoBloco.tipo" class="ctd-sel" aria-label="Tipo do texto">
            <option v-for="(rot, chave) in TIPOS" :key="chave" :value="chave">{{ rot }}</option>
          </select>
          <!-- O apelido é obrigatório: o banco recusa bloco sem nome (achado 7 do 5.9). -->
          <input v-model="novoBloco.nome" class="ctd-in" placeholder="Apelido (ex.: Assinatura)" aria-label="Apelido do texto" required>
        </div>
        <textarea
          v-model="novoBloco.texto"
          class="ctd-ta"
          rows="3"
          placeholder="Ex.: Feito à mão, do jeito que a gente sempre fez. Sem pressa e sem atalho."
        ></textarea>
        <button
          class="ctd-btn ctd-btn-primario"
          :disabled="!novoBloco.nome.trim() || !novoBloco.texto.trim() || salvando"
          @click="adicionarBloco"
        >Adicionar texto</button>
      </div>
    </section>

    <!-- ── Concorrentes ── -->
    <section class="ctd-rot-bloco">
      <h3 class="ctd-rot-h">Contra quem esta marca disputa</h3>
      <p class="ctd-ajuda">
        Quem briga pela mesma audiência. A IA usa isso para calibrar o assunto e o nível
        da conversa — e tem ordem expressa de <b>nunca citar o nome deles</b> em nada que
        vá ao ar.
      </p>

      <ul v-if="concorrentes.length" class="ctd-mini-lista">
        <li v-for="c in concorrentes" :key="c.id">
          <div>
            <b>{{ c.nome || '@' + c.handle }}</b>
            <span>@{{ c.handle }}{{ c.observacao ? ` — ${c.observacao}` : '' }}</span>
          </div>
          <button class="ctd-mini-btn perigo" title="Remover" @click="removerConcorrente(c)">×</button>
        </li>
      </ul>
      <p v-else class="ctd-ajuda ctd-vazio-linha">
        Nenhum concorrente cadastrado — a IA vai sugerir sem noção do nicho.
      </p>

      <div class="ctd-campo">
        <div class="ctd-linha-dupla">
          <input v-model="novoConc.nome" class="ctd-in" placeholder="Nome (ex.: Lasaro do Carmo Jr)">
          <input v-model="novoConc.handle" class="ctd-in" placeholder="@ do perfil">
        </div>
        <input
          v-model="novoConc.observacao"
          class="ctd-in"
          placeholder="Por que é concorrente / o que observar nele"
        >
        <button
          class="ctd-btn ctd-btn-primario"
          :disabled="!novoConc.handle.trim() || salvando"
          @click="adicionarConcorrente"
        >Adicionar concorrente</button>
      </div>

      <!-- O Portal só serve a quem é do nicho dele. Deixar isso escondido foi
           exatamente o que produziu a pauta errada. -->
      <label class="ctd-check">
        <input type="checkbox" :checked="usaPortal" :disabled="salvando" @change="alternarPortal">
        <span>
          <b>Usar o Portal de Notícias no briefing</b>
          <small>
            O Portal acompanha marcas de moda e calçado. Marque só se esta marca for
            desse nicho — senão a IA sugere pauta de sapato para quem não vende sapato.
          </small>
        </span>
      </label>
    </section>

    <!-- ── O que o sistema já sabe sozinho ── -->
    <section class="ctd-rot-bloco">
      <h3 class="ctd-rot-h">O que o sistema junta sozinho</h3>
      <ul class="ctd-sabe">
        <li :class="{ tem: resumo.publicadas > 0 }">
          <b>O que rendeu mais e menos</b>
          <span v-if="resumo.publicadas">{{ resumo.publicadas }} publicadas, com métrica</span>
          <span v-else>ainda não há post publicado — enche conforme você usar</span>
        </li>
        <li :class="{ tem: resumo.naFila > 0 }">
          <b>O que já está na agenda</b>
          <span v-if="resumo.naFila">{{ resumo.naFila }} na fila — a IA não repete estes temas</span>
          <span v-else>nada agendado ainda</span>
        </li>
        <li class="tem">
          <b>O mês e as datas comerciais</b>
          <span>{{ mesEDatas }}</span>
        </li>
      </ul>
    </section>
  </div>

  </section>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import * as dados from './dados-conteudo.js'
import { descricaoDoMes } from './datas-comerciais.js'

const props = defineProps({
  conta: { type: Object, default: null },
  accountId: { type: String, required: true },
  pecas: { type: Array, default: () => [] },
})

const emit = defineEmits(['mudou'])

const TIPOS = {
  legenda: 'Legenda',
  hashtags: 'Hashtags',
  cta: 'Chamada',
  assinatura: 'Assinatura',
}

const blocos = ref([])
const concorrentes = ref([])
const usaPortal = ref(false)
const erro = ref('')
const salvando = ref(false)

const novoBloco = ref({ tipo: 'legenda', nome: '', texto: '' })
const novoConc = ref({ nome: '', handle: '', observacao: '' })

const NA_FILA = new Set(['rascunho', 'em_aprovacao', 'aprovada', 'agendada'])
const resumo = computed(() => ({
  publicadas: props.pecas.filter(p => p.status === 'publicada').length,
  naFila: props.pecas.filter(p => NA_FILA.has(p.status)).length,
}))

const mesEDatas = computed(() => descricaoDoMes(new Date()))

onMounted(carregar)

async function carregar() {
  usaPortal.value = !!props.conta?.conteudo_usa_portal
  const [b, c] = await Promise.all([
    dados.listarBlocos(props.accountId),
    dados.listarConcorrentes(props.accountId),
  ])
  blocos.value = b
  concorrentes.value = c
}

async function comGuarda(fn) {
  erro.value = ''
  salvando.value = true
  try {
    await fn()
    emit('mudou')
  } catch (e) {
    erro.value = e.message
  } finally {
    salvando.value = false
  }
}

const adicionarBloco = () => comGuarda(async () => {
  await dados.salvarBloco({
    account_id: props.accountId,
    tipo: novoBloco.value.tipo,
    nome: novoBloco.value.nome.trim(),
    texto: novoBloco.value.texto.trim(),
  })
  novoBloco.value = { tipo: 'legenda', nome: '', texto: '' }
  await carregar()
})

const removerBloco = b => comGuarda(async () => {
  await dados.apagarBloco(b.id)
  await carregar()
})

const adicionarConcorrente = () => comGuarda(async () => {
  await dados.salvarConcorrente({
    account_id: props.accountId,
    // O @ é enfeite de digitação, não faz parte do identificador. Guardar com e
    // sem arroba criaria dois cadastros do mesmo perfil.
    handle: novoConc.value.handle.trim().replace(/^@+/, ''),
    nome: novoConc.value.nome.trim() || null,
    observacao: novoConc.value.observacao.trim() || null,
  })
  novoConc.value = { nome: '', handle: '', observacao: '' }
  await carregar()
})

const removerConcorrente = c => comGuarda(async () => {
  await dados.apagarConcorrente(c.id)
  await carregar()
})

const alternarPortal = e => {
  const marcado = e.target.checked
  return comGuarda(async () => {
    await dados.mudarUsoDoPortal(props.accountId, marcado)
    usaPortal.value = marcado
  })
}
</script>
