<script setup>
/* Uma seção que abre e fecha (pedido do dono: "minimizar em gavetas pra
 * otimizar informação e espaço").
 *
 * O que ele NÃO pode virar: esconderijo. Quem usa esta ferramenta tem
 * dificuldade com aplicativos, e pra essa pessoa gaveta fechada é informação
 * que sumiu. Por isso duas coisas neste componente não são enfeite:
 *
 *  - o TÍTULO FECHADO CARREGA O ESTADO ("faltam 8 de 10 hoje"), como os botões
 *    rápidos que o dono aprovou — a resposta chega antes do clique;
 *  - gaveta `travadaAberta` não fecha: é a que tem algo esperando a pessoa, e
 *    deixar fechar devolveria o esconderijo. Ela nem parece clicável.
 *
 * A regra de QUANDO abrir mora em `gavetas.js`, testada; aqui é só o desenho. */
defineProps({
  titulo: { type: String, required: true },
  // O texto pequeno ao lado do título. Nulo = não se sabe, e aí não escreve
  // nada — nunca um "0" sobre dado que não carregou.
  estado: { type: String, default: null },
  aberta: { type: Boolean, required: true },
  travadaAberta: { type: Boolean, default: false },
  // Some o corpo do DOM ao fechar, em vez de escondê-lo por CSS. Quem lê tela
  // não anuncia o que não existe, e listas grandes param de custar renderização.
  id: { type: String, required: true },
})
defineEmits(['alternar'])
</script>

<template>
  <section class="gv" :class="{ aberta, travada: travadaAberta }">
    <!-- Travada: vira um cabeçalho comum, sem botão. Um botão que não faz nada
         é pior que nenhum botão pra quem já tem dificuldade. -->
    <div v-if="travadaAberta" class="gv-topo gv-topo-fixo">
      <span class="gv-titulo">{{ titulo }}</span>
      <span class="gv-estado" v-if="estado">{{ estado }}</span>
    </div>
    <button v-else type="button" class="gv-topo" :aria-expanded="aberta" :aria-controls="id"
            @click="$emit('alternar')">
      <span class="gv-seta" aria-hidden="true">
        <!-- SVG próprio: a casa não usa emoji como ícone. -->
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
          <path d="M4 2.5 L8 6 L4 9.5" stroke="currentColor" stroke-width="1.8"
                stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </span>
      <span class="gv-titulo">{{ titulo }}</span>
      <span class="gv-estado" v-if="estado">{{ estado }}</span>
    </button>

    <div class="gv-corpo" :id="id" v-if="aberta">
      <slot />
    </div>
  </section>
</template>

<style scoped>
/* Estilo próprio, prefixado: componente com `<style scoped>` não alcança as
   classes `fr-` da tela grande. Só tokens, nunca hex — nem como valor de
   reserva dentro de `var()`. */
.gv{border-top:1px solid var(--border);}
/* 44px de alvo: acima dos 40px que o padrão exige, porque a linha inteira é o
   botão e é a primeira coisa que a pessoa toca ao procurar alguma coisa. */
.gv-topo{display:flex;align-items:center;gap:9px;width:100%;min-height:44px;
  padding:11px 14px;background:none;border:none;text-align:left;cursor:pointer;
  font:inherit;color:inherit;touch-action:manipulation;}
.gv-topo-fixo{cursor:default;}
.gv-seta{display:inline-flex;align-items:center;justify-content:center;flex:0 0 auto;
  width:16px;height:16px;color:var(--muted);transition:transform .15s ease;}
.gv.aberta .gv-seta{transform:rotate(90deg);}
/* Mesma tipografia do `fr-secao` que estas seções tinham antes — a gaveta muda
   o comportamento, não a cara da tela. */
.gv-titulo{flex:0 1 auto;min-width:0;font-family:var(--fonte-principal);font-size:max(9px, calc(10px * var(--escala-texto, 1)));
  font-weight:700;letter-spacing:1.6px;text-transform:uppercase;color:var(--muted);
  overflow-wrap:anywhere;}
.gv.aberta .gv-titulo,.gv.travada .gv-titulo{color:var(--text);}
/* O estado à direita, na cor de texto normal: é a informação que a gaveta
   fechada precisa entregar, então não pode ser mais apagada que o título. */
.gv-estado{flex:1 1 auto;min-width:0;text-align:right;font-family:var(--fonte-principal);
  font-size:max(9px, calc(11.5px * var(--escala-texto, 1)));color:var(--text);overflow-wrap:anywhere;}
.gv-corpo{padding-bottom:6px;}
@media(min-width:900px){
  .gv-topo{padding:12px 24px;}
}
</style>
