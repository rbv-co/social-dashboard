<template>
  <div class="tela-consentimento">
    <section class="card-base cs-caixa">
      <h1 class="cs-titulo">Ligar à Frota</h1>

      <p v-if="estado === 'carregando'" class="cs-texto">Conferindo o pedido…</p>

      <template v-else-if="estado === 'pedido'">
        <p class="cs-recado"><strong>{{ cliente }}</strong> quer usar a Frota em seu nome.</p>
        <h2 class="cs-etiqueta">O que ele vai poder fazer</h2>
        <ul class="cs-lista">
          <li>Ver carros, retiradas, pedidos, abastecimentos e revisões.</li>
          <li>Registrar abastecimento e lançar manutenção.</li>
          <li>Pedir carro e aprovar, recusar, cancelar ou revogar pedidos.</li>
          <li>Editar dados do carro e o plano de revisão.</li>
        </ul>
        <p class="cs-texto">Ele não apaga nada, não mexe em checklist nem cadastra carro. Tudo o que fizer fica no seu nome,
          e o ChatGPT pede sua confirmação antes de gravar.</p>
        <p v-if="!pode" class="cs-aviso">{{ mensagem }}</p>
        <div class="cs-acoes">
          <button class="btn" :disabled="enviando" @click="decidir(false)">Negar</button>
          <button class="btn btn-principal" :disabled="enviando || !pode" @click="decidir(true)">Permitir</button>
        </div>
      </template>

      <p v-else class="cs-aviso">{{ mensagem }}</p>
    </section>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { pedir } from '../../compartilhado/api.js'

// O pedido do ChatGPT chega na URL (GET /api/oauth/autorizar redireciona para cá). A API confere tudo de novo
// em /oauth/pedido e em /oauth/decidir: esta tela só mostra e repassa. Desenho:
// docs/superpowers/specs/2026-10-19-mcp-frota-chatgpt-design.md
const CAMPOS = ['client_id', 'redirect_uri', 'code_challenge', 'code_challenge_method', 'state', 'response_type', 'scope', 'resource']

const route = useRoute()
const pedido = Object.fromEntries(CAMPOS.filter((c) => typeof route.query[c] === 'string').map((c) => [c, route.query[c]]))

const estado = ref('carregando') // carregando | pedido | erro
const cliente = ref('')
const pode = ref(false)
const mensagem = ref('')
const enviando = ref(false)

onMounted(async () => {
  const { data, error } = await pedir('GET', '/oauth/pedido', { params: pedido })
  if (error) {
    estado.value = 'erro'
    mensagem.value = error.message
    return
  }
  cliente.value = data.cliente
  pode.value = !!data.pode
  mensagem.value = data.mensagem || ''
  estado.value = 'pedido'
})

async function decidir(permitir) {
  enviando.value = true
  const { data, error } = await pedir('POST', '/oauth/decidir', { corpo: { ...pedido, permitir } })
  if (error) {
    enviando.value = false
    mensagem.value = error.message
    estado.value = 'erro'
    return
  }
  // endereço já conferido pela API (redirect_uri registrada pelo cliente, host permitido)
  window.location.href = data.redirect
}
</script>

<style scoped>
.tela-consentimento{ display:flex; justify-content:center; padding:var(--sp-6) var(--sp-4); }
.cs-caixa{ width:100%; max-width:520px; display:flex; flex-direction:column; gap:var(--sp-3); }
.cs-titulo{ font-size:var(--texto-titulo); color:var(--text); margin:0; overflow-wrap:anywhere; }
.cs-recado{ font-size:var(--texto-campo); color:var(--text); margin:0; overflow-wrap:anywhere; }
.cs-etiqueta{ font-size:var(--texto-etiqueta); text-transform:uppercase; letter-spacing:1.5px; color:var(--muted); margin:var(--sp-2) 0 0; }
.cs-lista{ margin:0; padding-left:var(--sp-5); font-size:var(--texto-corpo); color:var(--text); display:flex; flex-direction:column; gap:var(--sp-1); }
.cs-texto{ font-size:var(--texto-corpo); color:var(--muted); margin:0; }
.cs-aviso{ font-size:var(--texto-corpo); color:var(--text); margin:0; padding:var(--sp-3); border-radius:var(--radius-md);
  background:color-mix(in srgb, var(--orange) 10%, var(--surface)); border:1px solid color-mix(in srgb, var(--orange) 38%, var(--surface)); }
.cs-acoes{ display:flex; justify-content:flex-end; gap:var(--sp-2); margin-top:var(--sp-2); flex-wrap:wrap; }
@media (max-width:640px){
  .tela-consentimento{ padding:var(--sp-4) var(--sp-3); }
  .cs-acoes .btn{ flex:1 1 0; }
}
</style>
