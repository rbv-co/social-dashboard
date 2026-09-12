<script setup>
/* A BARRA DE TOPO PADRÃO DA CENTRAL — SEGUNDA TENTATIVA.
 *
 * A primeira foi revertida pelo dono: "no celular fica informação escondida".
 * Ele estava certo, e o erro era de desenho, não de acabamento:
 *
 *   · eu fazia o título CORTAR com reticências pra caber numa linha. No
 *     Patrimônio o título é o caminho onde a pessoa está — cortar apaga
 *     justamente o que mais importa;
 *   · nas dashboards eu trocava as DUAS LINHAS de marca (o que a tela mede +
 *     de quem) por um título único. Era conteúdo, não enfeite.
 *
 * Consistência que custa informação é pior que inconsistência. As regras desta
 * versão, nesta ordem de prioridade:
 *
 *   1. O TÍTULO NUNCA CORTA. Não cabe? Quebra em duas linhas.
 *   2. NADA É REMOVIDO. Subtítulo, marca e ações continuam existindo — o que se
 *      padroniza é ONDE ficam e QUANTO respiram.
 *   3. No celular, quem não cabe DESCE. Nunca some.
 *
 * Layout:
 *
 *     ← Voltar  [logo]   Título                    [ações…]
 *                        subtítulo (quando houver)
 */
defineProps({
  voltar: { type: String, default: '' },
  titulo: { type: String, default: '' },
  // A segunda linha: o que a tela mede, de quem é, o contexto. NÃO é enfeite —
  // foi tirar isso das dashboards que fez a primeira versão ser revertida.
  subtitulo: { type: String, default: '' },
  semLogo: Boolean,
})
defineEmits(['voltar'])

const logoClaroUrl = '/midia/LOGOTIPOBRENOPRETO.png'
const logoEscuroUrl = '/midia/LOGOTIPOBRENOBRANCO.png'
</script>

<template>
  <div class="bt-barra">
    <div class="bt-esq">
      <button v-if="voltar" class="bt-voltar" type="button" @click="$emit('voltar')">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>{{ voltar }}
      </button>
      <template v-if="!semLogo">
        <img class="rbv-logo rbv-logo-light bt-logo" :src="logoClaroUrl" alt="RBV">
        <img class="rbv-logo rbv-logo-dark bt-logo" :src="logoEscuroUrl" alt="RBV">
      </template>
    </div>

    <div class="bt-meio" v-if="titulo || subtitulo || $slots.titulo">
      <span class="bt-titulo" v-if="titulo">{{ titulo }}</span>
      <span class="bt-sub" v-if="subtitulo">{{ subtitulo }}</span>
      <slot name="titulo" />
    </div>

    <div class="bt-dir"><slot name="acoes" /></div>
  </div>
</template>

<style scoped>
.bt-barra{display:flex;align-items:center;gap:14px;padding:10px 14px;border-bottom:1px solid var(--border);background:var(--surface);position:sticky;top:0;z-index:20;}
.bt-esq{display:flex;align-items:center;gap:10px;flex:0 0 auto;}

/* O MIOLO. `flex:1 1 auto` com `min-width:0` deixa ele encolher até o ponto em
   que o texto precisa quebrar — e aí ele QUEBRA, não corta. */
.bt-meio{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:1px;}
/* Sem `white-space:nowrap`, sem `text-overflow:ellipsis`. Foi essa dupla que
   apagou o caminho do Patrimônio na primeira versão. `word-break` cuida do
   nome comprido sem espaço, que senão vazaria a barra. */
.bt-titulo{font-family:var(--fonte-principal);font-size:max(9px, calc(13px * var(--escala-texto, 1)));font-weight:600;letter-spacing:1.6px;text-transform:uppercase;color:var(--text);line-height:1.25;overflow-wrap:anywhere;}
.bt-sub{font-family:var(--fonte-principal);font-size:max(9px, calc(11px * var(--escala-texto, 1)));color:var(--muted);line-height:1.3;overflow-wrap:anywhere;}

/* O LADO DAS AÇÕES ENCOLHE (20/08/2026). Era `flex:0 0 auto`: reservava sempre
   o CONTEÚDO MÁXIMO, e o `.bt-meio` ficava com as sobras. Nas telas de faixa
   larga isso destruía o título — medido a 768px, antes desta mudança:

     Análise de Campanhas .... barra de 685px de altura, título em 0px / 18 linhas
     Gestão à Vista .......... barra de 732px, título em 0px / 19 linhas
     Análise de Vendas ....... barra de 513px, título em 0px / 15 linhas
     Gestão de Tráfego ....... barra de 632px, título em 0px / 15 linhas

   Com `0 1 auto` + `min-width:0` as mesmas telas ficam com barra de 93 a 107px
   e título em 2 linhas legíveis. A conta foi conferida nas 25 telas que usam a
   barra, em 7 larguras: 4 melhoraram muito, 19 ficaram idênticas, e o único
   custo são 26-27px a mais de barra a 1024px na Análise de Campanhas e na
   Gestão de Tráfego, onde a faixa de controles passa a quebrar em duas fileiras
   em vez de esmagar o título — que é o comportamento que esta barra promete.

   ⚠️ Quem puser uma faixa larga aqui dentro precisa deixá-la encolher também
   (`min-width:0` e, se for uma régua de botões, `overflow-x:auto`). Sem isso o
   conteúdo não encolhe: ele VAZA para fora da barra. Foi o que aconteceu com a
   régua da Análise de Campanhas, corrigida junto. */
.bt-dir{display:flex;align-items:center;gap:8px;flex:0 1 auto;min-width:0;}
.bt-voltar{display:inline-flex;align-items:center;gap:6px;background:none;border:none;color:var(--muted);font-family:var(--fonte-principal);font-size:max(9px, calc(11px * var(--escala-texto, 1)));font-weight:600;cursor:pointer;text-transform:uppercase;letter-spacing:1.2px;white-space:nowrap;padding:6px 2px;touch-action:manipulation;}
.bt-voltar:hover{color:var(--text);}
/* A regra global manda .rbv-logo com 52px, que é o tamanho da HOME. */
.bt-barra .bt-logo{height:22px;width:auto;flex:0 0 auto;}

@media(min-width:768px){
  .bt-barra{padding:12px 24px;}
  .bt-barra .bt-logo{height:26px;}
  .bt-titulo{font-size:max(9px, calc(14px * var(--escala-texto, 1)));}
  .bt-sub{font-size:max(9px, calc(11.5px * var(--escala-texto, 1)));}
}

@media(max-width:640px){
  /* As ações ficam na primeira linha se couberem; se não couberem, descem e
     ocupam a largura toda — onde o polegar alcança. Nunca somem. */
  .bt-barra{flex-wrap:wrap;row-gap:8px;gap:10px;}
  /* No celular o título sai da CAIXA ALTA. Maiúscula com espaçamento ocupa uns
     20% mais largura que o mesmo texto normal — e num caminho como
     "Vessel Conchal > Fábrica > Escritório Administrativo" isso era uma linha
     inteira a mais. É economia de espaço que NÃO custa informação, que é
     exatamente o tipo que vale fazer. */
  .bt-titulo{font-size:max(9px, calc(12.5px * var(--escala-texto, 1)));letter-spacing:.2px;text-transform:none;font-weight:700;}
  .bt-sub{font-size:max(9px, calc(10.5px * var(--escala-texto, 1)));}
  /* A própria linha de ações também quebra: com três botões numa tela de
     320px eles não cabem lado a lado, e como cada rótulo é `nowrap` (pra não
     partir "Nova peça" no meio) o que sobrava vazava a tela. Quebrar é a
     mesma regra do título — desce, não some. */
  /* MEDIDO: forçar o título pra uma linha própria melhora o caso extremo (o
     caminho fundo do Patrimônio, 139 -> 104px) e PIORA todo o resto — tela
     simples ia de 46 pra 72px, e a de três botões de 103 pra 138. Ele fica
     inline e quebra só quando precisa. */
  .bt-dir{flex:1 1 auto;min-width:0;flex-wrap:wrap;row-gap:8px;}
  .bt-dir:empty{display:none;}
}
</style>
