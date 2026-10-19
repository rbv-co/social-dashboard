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
import { sbClient, emModoEntrarComo } from '../../compartilhado/conectar-no-banco-de-dados.js'
import { hasPermission } from '../../compartilhado/controle-de-login-e-usuario.js'
import { avaliarPedido } from './pedido-do-supabase.js'

// O servidor OAuth do Supabase Auth (supabase/functions/mcp-frota, até a virada) manda a pessoa para cá com
// ?authorization_id=: os detalhes e a decisão saem do sbClient.auth.oauth, e quem trava é pedido-do-supabase.js
// (a edge confere o gestor de novo a cada chamada). Na API Go (PR #418) o pedido chega inteiro na URL.
const route = useRoute()
const idDoSupabase = typeof route.query.authorization_id === 'string' ? route.query.authorization_id : ''

const estado = ref('carregando') // carregando | pedido | erro
const cliente = ref('')
const pode = ref(false)
const mensagem = ref('')
const enviando = ref(false)

async function carregarDoSupabase() {
  const { data, error } = await sbClient.auth.oauth.getAuthorizationDetails(idDoSupabase)
  if (error) {
    estado.value = 'erro'
    mensagem.value = 'Não deu para abrir este pedido. Comece de novo pelo ChatGPT.'
    return
  }
  // já autorizado antes: o Supabase devolve direto o endereço de volta
  if (!data.authorization_id && data.redirect_url) {
    window.location.href = data.redirect_url
    return
  }
  const r = avaliarPedido({ pode: (acao) => hasPermission('frota', acao), entrarComo: emModoEntrarComo, redirectUri: data.redirect_uri })
  cliente.value = data.client?.name || 'Um aplicativo'
  pode.value = r.pode
  mensagem.value = r.mensagem
  estado.value = 'pedido'
}

async function decidirNoSupabase(permitir) {
  const oauth = sbClient.auth.oauth
  const op = { skipBrowserRedirect: true } // a saída é daqui, uma vez só, e só com resposta boa
  const { data, error } = permitir ? await oauth.approveAuthorization(idDoSupabase, op) : await oauth.denyAuthorization(idDoSupabase, op)
  if (error || !data?.redirect_url) {
    enviando.value = false
    mensagem.value = 'Não deu para registrar a resposta. Comece de novo pelo ChatGPT.'
    estado.value = 'erro'
    return
  }
  window.location.href = data.redirect_url
}

onMounted(() => {
  if (idDoSupabase) return carregarDoSupabase()
  estado.value = 'erro'
  mensagem.value = 'Pedido incompleto. Comece de novo pelo ChatGPT.'
})

function decidir(permitir) {
  enviando.value = true
  return decidirNoSupabase(permitir && pode.value)
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
