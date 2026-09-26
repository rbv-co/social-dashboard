<template>
  <div class="cv-modal-fundo" v-trava-rolagem @click.self="$emit('fechar')">
    <div class="cv-modal" role="dialog" :aria-label="`Cartão de ${convidada.nome}`">
      <div class="cv-modal-topo">
        <h2 class="cv-modal-titulo">Convite de {{ primeiroNome(convidada.nome) }}</h2>
        <button type="button" class="btn cv-modal-fechar" aria-label="Fechar" @click="$emit('fechar')">✕</button>
      </div>
      <div class="cv-modal-corpo">
        <p v-if="erro" class="cv-nota cv-nota-erro">{{ erro }}</p>
        <p v-else-if="!imagem" class="cv-carregando">Desenhando o cartão…</p>
        <img v-else :src="imagem" class="cv-cartao-previa" :alt="`Cartão do convite de ${convidada.nome}`">

        <p class="cv-sub">Quem envia</p>
        <div class="cv-escolha">
          <button type="button" class="btn" :class="{ ativa: quem === 'equipe' }" @click="escolher('equipe')">Equipe Vessel</button>
          <button type="button" class="btn" :class="{ ativa: quem === 'stylist' }" @click="escolher('stylist')">A stylist</button>
        </div>

        <h3 class="cv-etiqueta cv-etiqueta-interna id-titulo">A mensagem</h3>
        <p class="cv-nota cv-nota-primeira cv-mensagem">{{ mensagem || '…' }}</p>

        <div class="cv-acoes">
          <template v-if="!EM_DEMONSTRACAO">
            <a v-if="quem === 'equipe' && whatsDela && mensagem && !erro" class="btn btn-principal" :href="whatsDela" target="_blank"
               rel="noopener noreferrer" @click="marcarEnviado">Enviar no WhatsApp dela</a>
            <a v-if="quem === 'stylist' && whatsDaStylist && mensagem && !erro" class="btn btn-principal" :href="whatsDaStylist" target="_blank"
               rel="noopener noreferrer" @click="marcarEnviado">Mandar para a stylist</a>
          </template>
          <!-- ⚠️ SÓ NA DEMONSTRAÇÃO (build:demonstracao): o WhatsApp não abre e
               nada é marcado como enviado — nada saiu. A mensagem continua
               visível e copiável logo acima. Fora da demonstração este bloco
               nem existe. -->
          <template v-else>
            <button v-if="quem === 'equipe' && whatsDela && mensagem && !erro" type="button" class="btn"
                    @click="avisoDaDemonstracao = AVISO_DA_DEMONSTRACAO">Enviar no WhatsApp dela</button>
            <button v-if="quem === 'stylist' && whatsDaStylist && mensagem && !erro" type="button" class="btn"
                    @click="avisoDaDemonstracao = AVISO_DA_DEMONSTRACAO">Mandar para a stylist</button>
          </template>
          <button v-if="podeCompartilhar" type="button" class="btn" :disabled="!arquivo" @click="compartilhar">Compartilhar cartão</button>
          <!-- ⚠️ SÓ APARECE COM O ARQUIVO PRONTO: sem isso, o clique marcava
               "enviado" com um href vazio ou inexistente (nada baixava). -->
          <a v-else-if="imagem" class="btn" :href="imagem" :download="nomeDoArquivo(convidada.nome, encontro.quando)"
             @click="marcarEnviado">Baixar cartão</a>
          <button type="button" class="btn" :disabled="!mensagem" @click="copiar">{{ copiado ? 'Copiada' : 'Copiar mensagem' }}</button>
          <!-- Conferir o convite como ela vê. NÃO marca "enviado" e, com o
               marcador `?equipe=1`, não conta como abertura dela. -->
          <a v-if="linkDaEquipe && !EM_DEMONSTRACAO && !erro" class="btn" :href="linkDaEquipe" target="_blank"
             rel="noopener noreferrer">Ver o convite dela</a>
        </div>
        <p v-if="quem === 'stylist' && !whatsDaStylist" class="cv-nota cv-nota-aviso">
          Esta stylist não tem WhatsApp válido na Central — copie a mensagem e mande você.</p>
        <p v-else-if="quem === 'stylist'" class="cv-nota">A stylist recebe a mensagem pronta; o cartão, baixe e mande junto.</p>
        <p v-if="avisoDoEnvio" class="cv-nota cv-nota-erro">{{ avisoDoEnvio }}</p>
        <p v-if="avisoDaDemonstracao" class="cv-nota cv-nota-aviso" role="status">{{ avisoDaDemonstracao }}</p>
      </div>
    </div>
  </div>
</template>

<script setup>
/* "CARTÃO E MENSAGEM" — o PNG e a mensagem com o link só da convidada.
 * ⚠️ QUALQUER ENVIO MARCA "CONVITE ENVIADO" (vessel_convite_marcar). Se a
 * marcação falhar, o envio já saiu: a tela avisa em vez de fingir que marcou. */
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import {
  primeiroNome, linkDaConvidada, linkDaConvidadaParaEquipe, mensagemDoConvite, linkDoWhatsApp, nomeDoArquivo,
} from './convite-da-convidada-regras.js'
import { desenharConvite } from './desenhar-convite.js'

const props = defineProps({
  convidada: { type: Object, required: true },
  encontro: { type: Object, required: true },
  telefoneDaStylist: { type: String, default: '' },
  chamar: { type: Function, required: true },
})
const emit = defineEmits(['fechar', 'enviado'])

// ⚠️ A DEMONSTRAÇÃO (src/demonstracao/) liga isto no build dela. Em produção a
// variável não existe e a comparação dá `false`: os links de WhatsApp de sempre.
const EM_DEMONSTRACAO = import.meta.env.VITE_DEMONSTRACAO === '1'
const AVISO_DA_DEMONSTRACAO = 'Na demonstração o WhatsApp não é aberto. A mensagem está aqui em cima — dá para copiar.'
const avisoDaDemonstracao = ref('')

const CHAVE_DA_ESCOLHA = `pe-quem-envia:${props.encontro.codigo}`
const lerEscolha = () => { try { return localStorage.getItem(CHAVE_DA_ESCOLHA) || 'equipe' } catch { return 'equipe' } }
const quem = ref(lerEscolha())
function escolher(q) { quem.value = q; try { localStorage.setItem(CHAVE_DA_ESCOLHA, q) } catch { /* modo privado */ } }

const link = ref('')
// "Ver o convite dela": o mesmo link com o marcador da equipe — abrir para
// conferir não conta como abertura dela. Nunca vai na mensagem.
const linkDaEquipe = ref('')
const imagem = ref('')
const arquivo = ref(null)
const erro = ref('')
const copiado = ref(false)
const avisoDoEnvio = ref('')

const mensagem = computed(() => link.value ? mensagemDoConvite({
  quem: quem.value, convidada: props.convidada.nome, stylist: props.encontro.anfitria,
  quando: props.encontro.quando, local: props.encontro.local, link: link.value,
}) : '')
const whatsDela = computed(() => linkDoWhatsApp(props.convidada.telefone, mensagem.value))
const whatsDaStylist = computed(() => linkDoWhatsApp(props.telefoneDaStylist, mensagem.value))
const podeCompartilhar = computed(() => !!arquivo.value && !!navigator.canShare?.({ files: [arquivo.value] }))

async function marcarEnviado() {
  avisoDoEnvio.value = ''
  try {
    const r = await props.chamar('vessel_convite_marcar', { p_id: props.convidada.id, p_marca: 'enviado' })
    if (!r?.ok) throw new Error()
    emit('enviado')
  } catch { avisoDoEnvio.value = 'O convite saiu, mas não consegui marcar "Convite enviado". Marque no cartão dela.' }
}

async function compartilhar() {
  avisoDoEnvio.value = ''
  try {
    await navigator.share({ files: [arquivo.value] })
    await marcarEnviado()
  } catch (e) {
    // ⚠️ SÓ "desistiu" É SILENCIOSO: qualquer outra falha (sem apps de
    // compartilhamento, erro do sistema) precisa avisar — senão parece que o
    // cartão saiu e não saiu.
    if (e?.name === 'AbortError') return
    avisoDoEnvio.value = 'Não consegui abrir o compartilhamento. Baixe o cartão e mande pelo WhatsApp.'
  }
}

async function copiar() {
  try {
    await navigator.clipboard.writeText(mensagem.value)
    copiado.value = true
    setTimeout(() => { copiado.value = false }, 2000)
    await marcarEnviado()
  } catch { /* o texto continua na tela para ser selecionado à mão */ }
}

onMounted(async () => {
  try {
    const c = await props.chamar('vessel_chave_da_convidada', { p_id: props.convidada.id })
    if (!c?.ok) throw new Error('chave')
    link.value = linkDaConvidada(c.chave_encontro, c.chave)
    if (!link.value) throw new Error('link')
    linkDaEquipe.value = linkDaConvidadaParaEquipe(c.chave_encontro, c.chave)
    const tela = await desenharConvite({
      convidada: props.convidada.nome, stylist: props.encontro.anfitria,
      quando: props.encontro.quando, local: props.encontro.local,
    })
    const blob = await new Promise((ok) => tela.toBlob(ok, 'image/png'))
    if (!blob) throw new Error('png')
    arquivo.value = new File([blob], nomeDoArquivo(props.convidada.nome, props.encontro.quando), { type: 'image/png' })
    imagem.value = URL.createObjectURL(blob)
  } catch {
    erro.value = 'Não consegui preparar o cartão agora. Feche e tente de novo em um instante.'
  }
})
onBeforeUnmount(() => { if (imagem.value) URL.revokeObjectURL(imagem.value) })
</script>

<style scoped>
@import './estilo-comercial.css';
@import '../../estilos/identidade-da-ferramenta.css';
.cv-cartao-previa { width: 100%; height: auto; border: 1px solid var(--border); border-radius: var(--radius-md); display: block; }
.cv-mensagem { white-space: pre-wrap; overflow-wrap: anywhere; }
</style>
