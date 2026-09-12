<script setup>
/* Avisa quando saiu versão nova, e recarrega quando a pessoa mandar.
 *
 * O problema do dono: o app fica aberto — atalho de tela cheia no celular, aba
 * que ninguém fecha no computador — e nunca mais busca o `index.html`. O deploy
 * sai e quem está com a tela aberta segue no pacote velho por dias.
 *
 * QUANDO ELE CONFERE, em ordem de importância:
 *
 *  1. Ao VOLTAR pra tela (`visibilitychange`). É o momento que resolve o caso
 *     real: a pessoa abre o app do celular de manhã, o app estava dormindo, e
 *     a primeira coisa que ele faz é olhar se mudou alguma coisa.
 *  2. Ao voltar a ter internet (`online`) — deploy que saiu enquanto estava sem.
 *  3. De cinco em cinco minutos, pra quem deixa a tela aberta o dia todo.
 *
 * NÃO RECARREGA SOZINHO. A pessoa pode estar no meio de um cadastro, e
 * recarregar por conta própria apagaria o que ela digitou. O aviso fica lá até
 * ela mandar — ou até ela dispensar. */
import { ref, onMounted, onUnmounted } from 'vue'
import {
  pacoteDoHtml, pacoteEmUso, precisaAtualizar,
  enderecoDaChecagem, INTERVALO_DE_CHECAGEM, AVISO, BOTAO,
} from './versao-do-app.js'

const temNova = ref(false)
const dispensado = ref(false)
let meu = null
let relogio = null

async function conferir() {
  if (temNova.value) return
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return
  if (!meu) meu = pacoteEmUso()
  if (!meu) return                       // não sei o que estou rodando: fico quieto
  try {
    // `cache:'no-store'` E `?v=` juntos: um sozinho não basta em todo navegador,
    // e perguntar pro cache aqui devolveria sempre a mesma resposta — que é o
    // problema que esta tela existe pra resolver.
    const r = await fetch(enderecoDaChecagem(Date.now()), { cache: 'no-store' })
    if (!r.ok) return
    const doServidor = pacoteDoHtml(await r.text())
    if (precisaAtualizar(meu, doServidor)) temNova.value = true
  } catch (e) { /* sem rede, servidor fora: tenta de novo depois */ }
}

function aoVoltar() { if (document.visibilityState === 'visible') conferir() }

function atualizar() {
  // `reload()` pode devolver a cópia do cache em alguns navegadores. Trocar a
  // URL com um carimbo garante uma busca nova de verdade.
  const u = new URL(window.location.href)
  u.searchParams.set('_v', String(Date.now()))
  window.location.replace(u.toString())
}

onMounted(() => {
  meu = pacoteEmUso()
  document.addEventListener('visibilitychange', aoVoltar)
  window.addEventListener('online', conferir)
  relogio = setInterval(conferir, INTERVALO_DE_CHECAGEM)
  // Uma checagem logo ao abrir, com folga pra tela montar primeiro.
  setTimeout(conferir, 4000)
})
onUnmounted(() => {
  document.removeEventListener('visibilitychange', aoVoltar)
  window.removeEventListener('online', conferir)
  if (relogio) clearInterval(relogio)
})
</script>

<template>
  <Teleport to="body">
    <div v-if="temNova && !dispensado" class="atz-faixa" role="status">
      <span class="atz-txt">{{ AVISO }}</span>
      <button type="button" class="atz-btn primario" @click="atualizar">{{ BOTAO }}</button>
      <!-- Dispensar existe porque o aviso aparece por cima do trabalho da
           pessoa. Ela volta a ver na próxima vez que abrir o app. -->
      <button type="button" class="atz-btn" @click="dispensado = true" aria-label="Agora não">Agora não</button>
    </div>
  </Teleport>
</template>

<style scoped>
/* Embaixo, não em cima: em cima ela cobriria a barra de topo e o botão de
   voltar. Aqui ela fica no caminho do polegar e some ao ser resolvida. */
.atz-faixa{position:fixed;left:12px;right:12px;bottom:calc(env(safe-area-inset-bottom,0px) + 12px);z-index:10070;display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:12px 14px;background:var(--surface);border:1px solid var(--border);border-left:3px solid var(--accent);border-radius:12px;box-shadow:0 12px 34px rgba(0,0,0,.22);}
.atz-txt{flex:1 1 auto;min-width:0;font-family:var(--fonte-principal);font-size:max(9px, calc(13.5px * var(--escala-texto, 1)));color:var(--text);}
.atz-btn{min-height:40px;padding:9px 15px;border:1px solid var(--border);border-radius:9px;background:var(--surface);color:var(--text);font-family:var(--fonte-principal);font-size:max(9px, calc(13px * var(--escala-texto, 1)));font-weight:600;cursor:pointer;white-space:nowrap;touch-action:manipulation;}
.atz-btn.primario{background:var(--accent);border-color:var(--accent);color:var(--sobre-cor);}
@media(max-width:520px){
  .atz-txt{flex:1 1 100%;}
  .atz-btn{flex:1 1 auto;}
}
</style>
