<template>
  <!-- O QR DE UM LINK, PRONTO PARA A GRÁFICA: a prévia sobre um papel
       quadriculado (o quadriculado é o que mostra que o arquivo NÃO TEM FUNDO),
       o endereço por extenso, a legenda do plano e os três botões. Usado pelo
       Material Gráfico e pela tela da Beauty Sessions — a mesma rotina, para
       os dois lugares nunca baixarem arquivos diferentes do mesmo link. -->
  <div class="qrb">
    <div class="qrb-previa" :class="{ 'qrb-previa-vazia': !endereco }">
      <img v-if="endereco" class="qrb-img" :src="previa" :alt="`QR Code de ${endereco}`"
           width="176" height="176">
      <span v-else class="qrb-sem">Sem QR</span>
    </div>

    <div class="qrb-texto">
      <template v-if="endereco">
        <span class="qrb-rotulo">Endereço</span>
        <code class="qrb-url">{{ endereco }}</code>
        <span v-if="legenda" class="qrb-rotulo qrb-rotulo-legenda">Legenda do plano</span>
        <span v-if="legenda" class="qrb-legenda">{{ legenda }}</span>
        <span class="qrb-arquivo">{{ nomePng }}</span>
      </template>
      <p v-else class="qrb-nota">{{ motivoSemEndereco }}</p>

      <!-- ⚠️ `apoio` (24/09/2026): no cartão da Beauty Session a ação principal
           é "Cadastrar lead" — um principal por bloco (item 3 do padrão) —, e os
           três do QR viram o grupo de apoio, no tom suave da ferramenta, com
           ícone. Sem `apoio` (o Material Gráfico) nada muda. -->
      <div v-if="endereco" class="qrb-acoes">
        <button class="btn" :class="apoio ? 'id-btn-suave' : 'btn-principal'" :disabled="gerandoPng"
                @click="baixarPng"><icone-do-bloco v-if="apoio" nome="baixar" />
          {{ gerandoPng ? 'Gerando…' : 'Baixar PNG' }}</button>
        <button class="btn" :class="{ 'id-btn-suave': apoio }" @click="baixarSvg"><icone-do-bloco v-if="apoio" nome="baixar" />
          Baixar SVG</button>
        <button class="btn" :class="{ 'id-btn-suave': apoio }" @click="copiar"><icone-do-bloco v-if="apoio" nome="copiar" />
          {{ copiado ? 'Copiado' : 'Copiar endereço' }}</button>
      </div>
      <p v-if="erro" class="qrb-nota qrb-erro" role="alert">{{ erro }}</p>
    </div>
  </div>
</template>

<script setup>
/* ⚠️ O ARQUIVO BAIXADO SAI DE `src/compartilhado/qr.js`, e a leitura dele de
 * volta está provada em `qr.test.mjs` (zxing) — a prévia é o MESMO SVG que o
 * botão baixa, então o que se vê é o que vai para a gráfica.
 *
 * ⚠️ A PRÉVIA É `<img src="data:…">`, NÃO `v-html`: nada de HTML montado à mão
 * entrando na página, nem mesmo o nosso. */
import { computed, ref } from 'vue'
import { svgDoQr, pngDoQr, nomeDoArquivoDoQr } from '../../compartilhado/qr.js'
import IconeDoBloco from '../../compartilhado/icone-do-bloco.vue'

const props = defineProps({
  endereco: { type: String, default: '' },
  legenda: { type: String, default: '' },
  // { programa, praca, data | codigo, sequencia } — ver nomeDoArquivoDoQr
  arquivo: { type: Object, required: true },
  motivoSemEndereco: { type: String, default: 'Sem endereço válido, não há QR para baixar.' },
  // Os três botões como grupo de APOIO (tom suave, com ícone), para quando a
  // ação principal do bloco é outra — ver o comentário no template.
  apoio: { type: Boolean, default: false },
})

const gerandoPng = ref(false)
const erro = ref('')
const copiado = ref(false)

const svg = computed(() => (props.endereco ? svgDoQr(props.endereco) : ''))
const previa = computed(() => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg.value)}`)
const nomePng = computed(() => nomeDoArquivoDoQr({ ...props.arquivo, formato: 'png' }))

function entregar(blob, nome) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = nome
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
  // ⚠️ Revogar DEPOIS do clique ter começado o download — revogar na hora
  // cancela o arquivo em alguns navegadores.
  setTimeout(() => URL.revokeObjectURL(url), 4000)
}

async function baixarPng() {
  erro.value = ''
  gerandoPng.value = true
  try {
    const bytes = await pngDoQr(props.endereco)
    entregar(new Blob([bytes], { type: 'image/png' }), nomePng.value)
  } catch {
    // ⚠️ Nunca calado: sem o PNG, a pessoa precisa saber que o SVG continua ali.
    erro.value = 'Não consegui gerar o PNG neste navegador. O SVG continua disponível no botão ao lado.'
  } finally {
    gerandoPng.value = false
  }
}

function baixarSvg() {
  erro.value = ''
  entregar(new Blob([svg.value], { type: 'image/svg+xml' }),
    nomeDoArquivoDoQr({ ...props.arquivo, formato: 'svg' }))
}

async function copiar() {
  try {
    await navigator.clipboard.writeText(props.endereco)
    copiado.value = true
    setTimeout(() => { copiado.value = false }, 2000)
  } catch {
    // Sem permissão de área de transferência o endereço continua na tela para
    // ser selecionado à mão — nada se perde.
  }
}
</script>

<style scoped>
/* os botões de `apoio` e o ícone vêm da folha de identidade (as classes
   `id-btn-suave` e `id-icone`), que precisa estar DENTRO deste `scoped` */
@import '../../estilos/identidade-da-ferramenta.css';
.qrb {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sp-4);
  align-items: flex-start;
}

/* ⚠️ O PAPEL NÃO MUDA COM O TEMA: `--papel`/`--papel-xadrez` são claros nos
   dois (estilos-globais.css). A tinta do QR é a do material impresso, escura;
   sobre o quadriculado escuro do tema escuro ela sumiria. */
.qrb-previa {
  flex: 0 0 auto;
  width: 192px;
  height: 192px;
  padding: var(--sp-2);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background-color: var(--papel);
  background-image: repeating-conic-gradient(var(--papel-xadrez) 0 25%, var(--papel) 0 50%);
  background-size: 16px 16px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.qrb-previa-vazia { background-image: none; background-color: var(--surface2); }
.qrb-img { display: block; width: 176px; height: 176px; }
.qrb-sem {
  font-family: var(--fonte-principal);
  font-size: var(--texto-corpo);
  color: var(--muted);
}

.qrb-texto {
  flex: 1 1 16rem;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.qrb-rotulo {
  font-family: var(--fonte-principal);
  font-size: var(--texto-etiqueta);
  letter-spacing: .08em;
  text-transform: uppercase;
  color: var(--muted);
}
.qrb-rotulo-legenda { margin-top: var(--sp-2); }
.qrb-url {
  font-family: var(--fonte-dados);
  font-size: var(--texto-corpo);
  color: var(--text);
  /* endereço longo QUEBRA; some é que não pode */
  overflow-wrap: anywhere;
  user-select: all;
}
.qrb-legenda {
  font-family: var(--fonte-principal);
  font-size: var(--texto-campo);
  color: var(--text);
}
.qrb-arquivo {
  margin-top: var(--sp-2);
  font-family: var(--fonte-dados);
  font-size: var(--texto-etiqueta);
  color: var(--muted);
  overflow-wrap: anywhere;
}
/* ⚠️ O BOTÃO PRINCIPAL NA COR DA AÇÃO. `id-ferramenta` só pinta o botão da
   própria tela (o CSS é scoped e não desce para este componente), e ele
   sairia no azul do sistema. `--cor-da-acao` vem do grupo no Material
   Gráfico (Beauty, Private Edit, Stylist); sem ele, a cor da ferramenta onde
   o componente mora (`--modulo`). O texto é `--sobre-cor`: os tokens das
   ações já vêm medidos com ele nos dois temas (estilos-globais.css). */
.qrb .btn.btn-principal {
  background: var(--cor-da-acao, var(--modulo));
  border-color: var(--cor-da-acao, var(--modulo));
  color: var(--sobre-cor);
}
/* o passar do mouse escurece um pouco a mesma cor (o :disabled fica com a
   regra global dos botões) */
.qrb .btn.btn-principal:hover:not(:disabled) {
  background: color-mix(in srgb, var(--cor-da-acao, var(--modulo)) 82%, var(--text));
  border-color: color-mix(in srgb, var(--cor-da-acao, var(--modulo)) 82%, var(--text));
}
.qrb-acoes {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sp-2);
  margin-top: var(--sp-3);
}
.qrb-nota {
  font-family: var(--fonte-principal);
  font-size: var(--texto-corpo);
  color: var(--muted);
  margin: 0;
  line-height: 1.5;
}
.qrb-erro { color: var(--red); margin-top: var(--sp-2); }

/* No celular a prévia fica grande e centrada, e os botões dividem a largura. */
@media (max-width: 640px) {
  .qrb-previa { width: 100%; max-width: 280px; height: auto; aspect-ratio: 1; margin: 0 auto; }
  .qrb-img { width: 100%; height: auto; }
  .qrb-acoes .btn { flex: 1 1 auto; }
}
</style>
