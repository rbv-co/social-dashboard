<script setup>
/* A câmera lendo a etiqueta de patrimônio.
 *
 * Dois leitores, nesta ordem:
 *
 *  1. O do próprio navegador (`BarcodeDetector`). Existe no Chrome do Android e
 *     é de graça — nada pra baixar, e mais rápido porque roda fora do
 *     JavaScript.
 *  2. A biblioteca ZXing, baixada SOB DEMANDA com `import()`. É o caminho do
 *     iPhone: o Safari não tem leitor nativo (checado: segue desligado por
 *     padrão até as versões mais recentes). São algumas centenas de KB, e por
 *     isso ela não pode entrar no carregamento normal do app — quem só quer
 *     olhar a lista de bens não deve pagar por um leitor que não vai usar.
 *
 * O que este arquivo NÃO decide: o que fazer com o texto lido. Isso é do
 * leitor-de-codigo.js, que é testável sem câmera. Aqui só tem vídeo e ciclo de
 * vida — e o ciclo de vida é o que importa: câmera que não é desligada fica com
 * a luzinha acesa e come bateria mesmo com a janela fechada. */
import { ref, watch, onUnmounted } from 'vue'
import { diagnosticar } from './permissao-de-camera.js'

const props = defineProps({ modelValue: Boolean })
const emit = defineEmits(['update:modelValue', 'leu'])

const video = ref(null)
const preparando = ref(false)
// `aviso` é a tela de recado: ou explicando que o pedido de permissão vem aí,
// ou explicando por que a câmera não abriu e o que fazer. Enquanto ele existe,
// não há vídeo — e é isso que conserta o defeito relatado: antes, quando dava
// errado, a janela abria PRETA E CALADA.
const aviso = ref(null)
const demorando = ref(false)   // 12s tentando: hora de oferecer a saída manual
let relogio = null
let fluxo = null          // o MediaStream da câmera
let parar = false         // corta o laço de leitura

function fechar() { emit('update:modelValue', false) }

async function abrir() {
  parar = false
  preparando.value = false
  // O diagnóstico vem ANTES de encostar na câmera. Se o navegador não tem o
  // recurso, ou a página não está em endereço seguro, ou a permissão já foi
  // negada, não adianta chamar: só dá erro calado.
  aviso.value = diagnosticar({
    temMediaDevices: temMediaDevices(),
    contextoSeguro: contextoSeguro(),
    permissao: await estadoDaPermissao(),
    ua: navigator.userAgent,
  })
  // Já liberada: entra direto, sem tela intermediária. Pedir "toque para
  // permitir" a quem já permitiu é atrito à toa.
  if (aviso.value.estado === 'liberada') return ligarCamera()
}

function temMediaDevices() {
  return !!(typeof navigator !== 'undefined' && navigator.mediaDevices && navigator.mediaDevices.getUserMedia)
}
function contextoSeguro() {
  // `isSecureContext` é o que o próprio navegador usa pra decidir se libera
  // câmera. localhost conta como seguro; IP da rede local, não.
  if (typeof window === 'undefined') return true
  return window.isSecureContext !== false
}
async function estadoDaPermissao() {
  // Safari não responde a essa consulta pra câmera, e navegador antigo nem tem
  // a consulta. Quando não dá pra saber, devolve nulo e o diagnóstico trata
  // como "ainda vai perguntar" — que é o certo.
  try {
    if (!navigator.permissions || !navigator.permissions.query) return null
    const r = await navigator.permissions.query({ name: 'camera' })
    return r && r.state
  } catch (e) { return null }
}

async function ligarCamera() {
  aviso.value = null
  demorando.value = false
  parar = false
  preparando.value = true
  try {
    // `ideal` e não `exact`: em aparelho sem câmera traseira (notebook), exact
    // recusa e não abre nada. Assim ele cai na que existir.
    fluxo = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } },
      audio: false,
    })
  } catch (e) {
    preparando.value = false
    aviso.value = diagnosticar({
      temMediaDevices: temMediaDevices(),
      contextoSeguro: contextoSeguro(),
      erroNome: e && e.name,
      ua: navigator.userAgent,
    })
    return
  }
  // O elemento do vídeo só existe depois que o v-if montou o palco.
  await new Promise((ok) => requestAnimationFrame(ok))
  const el = video.value
  if (!el) { desligar(); return }
  el.srcObject = fluxo
  el.setAttribute('playsinline', '')   // sem isso o iPhone abre em tela cheia própria
  await el.play().catch(() => {})
  preparando.value = false
  // Etiqueta rasgada, suja ou com reflexo teimoso existe. Depois de um tempo
  // parado apontando, a pessoa precisa ouvir que dá pra digitar — senão fica
  // ali achando que é ela que está fazendo errado.
  relogio = setTimeout(() => { demorando.value = true }, 12000)
  procurar(el)
}

async function procurar(el) {
  const Nativo = window.BarcodeDetector
  if (Nativo) {
    try {
      const det = new Nativo({ formats: ['code_128', 'code_39', 'code_93', 'itf', 'ean_13'] })
      return laco(() => det.detect(el).then((r) => (r[0] ? r[0].rawValue : null)))
    } catch (e) { /* formato não suportado neste aparelho: cai pro ZXing */ }
  }
  let zx
  try {
    zx = await import('@zxing/library')
  } catch (e) {
    aviso.value = {
      estado: 'sem-leitor',
      titulo: 'Não consegui carregar o leitor',
      texto: 'O leitor de código de barras não baixou. Confira a conexão e toque em "Tentar de novo".',
      passos: [],
      podeTentar: true,
    }
    desligar()
    return
  }

  /* A leitura pronta do ZXing (`decodeFromStream`, que olha os quadros sozinho)
     NÃO fecha a leitura da nossa etiqueta — testado com a foto de uma etiqueta
     de verdade entrando como se fosse a câmera: 20 segundos sem ler nada.
     O que funciona é tratar cada quadro antes:

       1. recortar o MIOLO — o mesmo pedaço que a mira desenha na tela. O quadro
          inteiro, com a mesa e a sombra em volta, não fecha;
       2. achar o ponto de corte OLHANDO O PRÓPRIO QUADRO (método de Otsu) e
          deixar a imagem em preto e branco puro;
       3. só então entregar pro leitor, com as dicas ligadas.

     Duas coisas que a primeira versão fazia e foram medidas como erradas:

     · Ampliava o recorte 2×. Não adianta nada: com o mesmo quadro, ampliado dá
       2.477k pixels e 47ms, e sem ampliar dá 619k pixels e 5ms — os dois leem
       o mesmo "000019". Era dez vezes mais trabalho por quadro à toa.
     · Testava seis pontos de corte fixos, um por quadro. Isso é o que fazia a
       leitura levar ~5 segundos no aparelho (relatado pelo dono): no pior caso
       eram seis quadros até cair no valor certo. O Otsu acha o valor sozinho
       no primeiro quadro — neste aqui ele escolheu 103, e leu. */
  const dicas = new Map()
  dicas.set(zx.DecodeHintType.TRY_HARDER, true)
  dicas.set(zx.DecodeHintType.POSSIBLE_FORMATS,
    [zx.BarcodeFormat.CODE_128, zx.BarcodeFormat.CODE_39, zx.BarcodeFormat.CODE_93,
      zx.BarcodeFormat.ITF, zx.BarcodeFormat.EAN_13])

  const tela = document.createElement('canvas')
  const pincel = tela.getContext('2d', { willReadFrequently: true })
  const cinza = { dados: null }
  const histograma = new Uint32Array(256)
  // Se o Otsu errar (quadro meio na sombra, meio no sol), os quadros seguintes
  // tentam um pouco mais claro e um pouco mais escuro, e depois sem corte
  // nenhum. Quatro tentativas, não seis — e a primeira já costuma bastar.
  const AJUSTES = [0, -25, +25, null]
  let volta = 0

  laco(() => {
    if (!el.videoWidth) return null
    // Mesmas proporções da mira no <template>: o que a pessoa encaixa é o que o
    // leitor lê. Se um dos dois mudar, o outro tem que mudar junto.
    const RX = 0.08, RY = 0.20, RW = 0.84, RH = 0.60
    const sw = el.videoWidth * RW, sh = el.videoHeight * RH
    // Nunca ampliar; só reduzir se o aparelho der um quadro grande demais.
    // Câmera de celular novo entrega 1920 e às vezes mais, e cada pixel a mais
    // é trabalho por quadro sem ganho de leitura.
    const escala = Math.min(1, 1000 / sw)
    tela.width = Math.round(sw * escala)
    tela.height = Math.round(sh * escala)
    pincel.drawImage(el, el.videoWidth * RX, el.videoHeight * RY, sw, sh, 0, 0, tela.width, tela.height)

    const img = pincel.getImageData(0, 0, tela.width, tela.height)
    const n = tela.width * tela.height
    if (!cinza.dados || cinza.dados.length !== n) cinza.dados = new Uint8Array(n)
    histograma.fill(0)
    for (let k = 0, j = 0; k < img.data.length; k += 4, j++) {
      // Luminância em inteiro: 77/151/28 sobre 256 é o mesmo 0.30/0.59/0.11,
      // sem ponto flutuante — são centenas de milhares de pixels por quadro.
      const luz = (img.data[k] * 77 + img.data[k + 1] * 151 + img.data[k + 2] * 28) >> 8
      cinza.dados[j] = luz
      histograma[luz]++
    }

    const ajuste = AJUSTES[volta++ % AJUSTES.length]
    const corte = ajuste === null ? 0 : Math.max(1, Math.min(254, pontoDeCorte(histograma, n) + ajuste))
    const pontos = new Int32Array(n)
    for (let j = 0; j < n; j++) {
      const t = corte ? (cinza.dados[j] > corte ? 255 : 0) : cinza.dados[j]
      pontos[j] = (t << 16) | (t << 8) | t
    }

    const fonte = new zx.RGBLuminanceSource(pontos, tela.width, tela.height)
    for (const Binarizador of [zx.HybridBinarizer, zx.GlobalHistogramBinarizer]) {
      // Leitor NOVO a cada tentativa: `reset()` zera os leitores internos que
      // `setHints()` montou, e reusar a instância faria a segunda leitura em
      // diante rodar sem as dicas.
      const leitor = new zx.MultiFormatReader()
      leitor.setHints(dicas)
      try {
        return leitor.decode(new zx.BinaryBitmap(new Binarizador(fonte))).getText()
      } catch (e) { /* este corte não fechou; o próximo quadro tenta outro */ }
    }
    return null
  })
}

/* Método de Otsu: dado o histograma de tons do quadro, devolve o ponto que
   melhor separa "papel" de "barra". É preferível a um valor fixo porque a luz
   do corredor, a sombra da mão e o reflexo do plástico mudam a cada foto — um
   número cravado só acerta no ambiente onde foi cravado. */
function pontoDeCorte(histograma, total) {
  let soma = 0
  for (let i = 0; i < 256; i++) soma += i * histograma[i]
  let somaAbaixo = 0, pesoAbaixo = 0, melhor = 0, corte = 128
  for (let i = 0; i < 256; i++) {
    pesoAbaixo += histograma[i]
    if (!pesoAbaixo) continue
    const pesoAcima = total - pesoAbaixo
    if (!pesoAcima) break
    somaAbaixo += i * histograma[i]
    const separacao = pesoAbaixo * pesoAcima
      * Math.pow(somaAbaixo / pesoAbaixo - (soma - somaAbaixo) / pesoAcima, 2)
    if (separacao > melhor) { melhor = separacao; corte = i }
  }
  return corte
}

// Um quadro por vez, sem empilhar: se a leitura de um quadro demora, o próximo
// só começa depois. `requestAnimationFrame` sozinho enfileiraria trabalho em
// cima de trabalho e travaria o vídeo.
function laco(lerUmQuadro) {
  const passo = async () => {
    if (parar) return
    let texto = null
    try { texto = await lerUmQuadro() } catch (e) { /* quadro ruim, segue */ }
    if (texto) return achou(texto)
    setTimeout(passo, 25)
  }
  passo()
}

function achou(texto) {
  if (parar) return
  parar = true
  // Um tremidinho confirma a leitura sem a pessoa precisar olhar a tela — ela
  // está de pé, com a caixa na outra mão.
  try { navigator.vibrate && navigator.vibrate(60) } catch (e) { /* sem vibração, tudo bem */ }
  emit('leu', texto)
  fechar()
}

function desligar() {
  parar = true
  if (relogio) { clearTimeout(relogio); relogio = null }
  demorando.value = false
  // ESTA parte não pode falhar: sem parar as trilhas, a câmera continua ligada
  // com a janela fechada — luz acesa e bateria indo embora.
  if (fluxo) { try { fluxo.getTracks().forEach((t) => t.stop()) } catch (e) { /* já parada */ } }
  fluxo = null
  if (video.value) video.value.srcObject = null
}

watch(() => props.modelValue, (v) => { if (v) abrir(); else desligar() })
onUnmounted(desligar)
</script>

<template>
  <Teleport to="body">
    <div v-if="modelValue" class="let-fundo" v-trava-rolagem @click.self="fechar">
      <div class="let-caixa" role="dialog" aria-label="Ler etiqueta com a câmera">
        <div class="let-topo">
          <span class="let-titulo">{{ aviso ? aviso.titulo : 'Aponte para a etiqueta' }}</span>
          <button type="button" class="let-fechar" @click="fechar" aria-label="Fechar">✕</button>
        </div>

        <!-- TELA DE RECADO. Existe porque a janela abrindo preta e calada era o
             defeito relatado: no Android, com a permissão já negada, o navegador
             recusa SEM PERGUNTAR e não havia nada dizendo isso. Agora a pessoa
             sempre lê o que houve e o que fazer. -->
        <div v-if="aviso" class="let-recado">
          <p class="let-recado-txt">{{ aviso.texto }}</p>
          <ol v-if="aviso.passos.length" class="let-passos">
            <li v-for="(p, i) in aviso.passos" :key="i">{{ p }}</li>
          </ol>
          <div class="let-botoes">
            <!-- O toque NESTE botão é o que dispara o pedido do navegador. Ter um
                 botão explícito, em vez de pedir assim que a janela abre, é o que
                 faz a pessoa entender o que está aceitando — e aceitar. -->
            <button v-if="aviso.podeTentar" type="button" class="let-btn primario" @click="ligarCamera">
              {{ aviso.estado === 'vai-perguntar' ? 'Permitir câmera' : 'Tentar de novo' }}
            </button>
            <button type="button" class="let-btn" @click="fechar">
              {{ aviso.podeTentar ? 'Digitar o número' : 'Fechar' }}
            </button>
          </div>
        </div>

        <template v-else>
          <div class="let-palco">
            <video ref="video" class="let-video" muted playsinline></video>
            <!-- A moldura NÃO é decoração: é exatamente o pedaço do quadro que o
                 leitor analisa (8%/20% de cada lado, veja `procurar`). Ler o
                 quadro inteiro não funciona — testado. Se mexer numa, mexa na
                 outra. -->
            <div class="let-mira" aria-hidden="true"></div>
            <p v-if="preparando" class="let-aviso">Ligando a câmera…</p>
          </div>

          <p v-if="demorando" class="let-erro">
            Essa etiqueta está difícil. Mude o ângulo para tirar o reflexo de cima do código —
            ou feche e digite o número que está impresso embaixo dele.
          </p>
          <p v-else class="let-dica">
            Encaixe o código dentro da moldura, a um palmo de distância. O número também está
            impresso embaixo dele, se preferir digitar.
          </p>
        </template>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.let-fundo{position:fixed;inset:0;z-index:10060;background:rgba(0,0,0,.72);display:flex;align-items:center;justify-content:center;padding:14px;touch-action:none;overscroll-behavior:contain;}
.let-fundo > *{overscroll-behavior:contain;touch-action:pan-y;}
/* Centralizado COM margem, nunca colado nas bordas — é o padrão dos modais
   desta central, pedido do dono. */
.let-caixa{width:100%;max-width:520px;max-height:calc(100dvh - 28px);display:flex;flex-direction:column;background:var(--surface);border:1px solid var(--border);border-radius:16px;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,.4);}
.let-topo{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:12px 14px;border-bottom:1px solid var(--border);}
.let-titulo{font-family:var(--fonte-principal);font-size:max(9px, calc(13px * var(--escala-texto, 1)));font-weight:700;letter-spacing:1.4px;text-transform:uppercase;color:var(--text);}
.let-fechar{appearance:none;border:1px solid var(--border);background:var(--surface);color:var(--text);border-radius:9px;width:34px;height:34px;font-size:max(9px, calc(15px * var(--escala-texto, 1)));cursor:pointer;flex:0 0 auto;}
.let-palco{position:relative;background:#000;aspect-ratio:4/3;overflow:hidden;}
.let-video{width:100%;height:100%;object-fit:cover;display:block;}
.let-mira{position:absolute;left:8%;right:8%;top:20%;bottom:20%;border:2px solid rgba(255,255,255,.85);border-radius:10px;box-shadow:0 0 0 9999px rgba(0,0,0,.28);}
.let-aviso{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;margin:0;color:#fff;font-family:var(--fonte-principal);font-size:max(9px, calc(13px * var(--escala-texto, 1)));}
.let-recado{padding:16px 16px 18px;}
.let-recado-txt{margin:0;font-family:var(--fonte-principal);font-size:max(9px, calc(13.5px * var(--escala-texto, 1)));line-height:1.6;color:var(--text);}
.let-passos{margin:12px 0 0;padding-left:20px;font-family:var(--fonte-principal);font-size:max(9px, calc(13px * var(--escala-texto, 1)));line-height:1.75;color:var(--muted);}
.let-passos li{margin-bottom:3px;}
.let-botoes{display:flex;flex-wrap:wrap;gap:9px;margin-top:16px;}
/* 44px de altura: alvo que o dedo acerta. Largura cheia no celular, porque a
   pessoa está de pé segurando o aparelho com uma mão só. */
.let-btn{flex:1 1 auto;min-width:130px;min-height:44px;font-family:var(--fonte-principal);font-size:max(9px, calc(14px * var(--escala-texto, 1)));font-weight:600;padding:11px 16px;border:1px solid var(--border);border-radius:10px;background:var(--surface);color:var(--text);cursor:pointer;touch-action:manipulation;}
.let-btn.primario{background:var(--accent);border-color:var(--accent);color:var(--sobre-cor);}
.let-dica,.let-erro{margin:0;padding:12px 14px;font-family:var(--fonte-principal);font-size:max(9px, calc(12.5px * var(--escala-texto, 1)));line-height:1.55;color:var(--muted);}
.let-erro{color:var(--red,#c0392b);}
</style>
