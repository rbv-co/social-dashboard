<template>
  <div v-if="erro" class="faixa-erro" role="alert">
    <span class="faixa-erro-icone" aria-hidden="true">⚠</span>
    <span class="faixa-erro-msg">{{ erro.mensagem }}</span>
    <button v-if="erro.acao === 'entrar'" class="faixa-erro-btn" @click="irParaLogin">Entrar de novo</button>
    <button v-else-if="erro.acao === 'tentar'" class="faixa-erro-btn" @click="$emit('tentar-de-novo')">Tentar de novo</button>
  </div>
</template>

<script setup>
// Faixa de aviso: aparece quando uma busca do sb() falhou, no lugar de deixar a
// tela mentir com "0" / "R$ 0" como se o valor real fosse zero.
//
// Limite conhecido: o PostgREST responde 200 + [] quando o RLS nega a linha —
// não 403. Então a faixa cobre sessão expirada, falta de GRANT, servidor e rede;
// negação de RLS continua chegando como lista vazia legítima.
import { useRouter } from 'vue-router'

defineProps({
  // Objeto vindo do .erro do sb(): { tipo, mensagem, acao }. Nulo = não mostra nada.
  erro: { type: Object, default: null },
})
defineEmits(['tentar-de-novo'])

const router = useRouter()
function irParaLogin() {
  router.push({ name: 'login' })
}
</script>

<style scoped>
/* Nomes prefixados com faixa-erro- de proposito: o estilos-globais.css tem classes
   genericas (.card, .chip) e ja houve bug de colisao entre global e tela scoped. */
/* O TEXTO DA FAIXA É `--text`, NUNCA A COR DO AVISO.
   Nasceu com `color:#fbbf24` — âmbar cravado. No tema escuro isso dá 10,91 e
   passa; no CLARO dá 1,33 sobre este mesmo fundo, contra o mínimo de 4,5. Ou
   seja: a faixa que avisa que a leitura falhou era ilegível justamente no tema
   padrão — e ninguém viu porque quem desenvolve fica no escuro. Com --text:
   14,56 no claro e 15,46 no escuro. Medido no navegador, não deduzido.
   É a regra do item 2 do PADRÃO: a cor é o sinal; o texto é para ler. */
.faixa-erro{display:flex;align-items:center;gap:10px;padding:10px 14px;margin:0 0 12px;border:1px solid var(--orange);border-radius:8px;background:rgba(180,83,9,.12);font-family:var(--fonte-principal);font-size:max(9px, calc(13px * var(--escala-texto, 1)));color:var(--text);}
.faixa-erro-icone{font-size:max(9px, calc(15px * var(--escala-texto, 1)));line-height:1;flex-shrink:0;}
.faixa-erro-msg{flex:1;min-width:0;}
.faixa-erro-btn{flex-shrink:0;padding:5px 12px;border:1px solid var(--orange);border-radius:6px;background:transparent;color:var(--text);font-family:inherit;font-size:max(9px, calc(12px * var(--escala-texto, 1)));font-weight:500;cursor:pointer;transition:background .15s;}
.faixa-erro-btn:hover{background:rgba(180,83,9,.25);}
@media (max-width:640px){
  .faixa-erro{flex-wrap:wrap;font-size:max(9px, calc(12px * var(--escala-texto, 1)));}
  .faixa-erro-msg{flex-basis:100%;}
}
</style>
