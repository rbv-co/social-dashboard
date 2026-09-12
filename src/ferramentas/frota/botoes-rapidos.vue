<script setup>
/* Os botões grandes do topo de cada aba (D33).
 *
 * De onde veio: quem usa esta ferramenta é um policial aposentado com
 * dificuldade de uso, e ele foi procurar na tela um lugar óbvio pra começar em
 * vez de rolar atrás do que queria. O estado embaixo do nome é o que separa um
 * menu de uma orientação — "Preciso usar um carro" é menu; "Preciso usar um
 * carro / 3 carros livres" já respondeu antes de a pessoa clicar.
 *
 * Grade de dois, não lista: dois por linha cabem no celular com alvo grande.
 * O estado aparece SÓ quando existe: `estado` nulo não vira linha vazia nem
 * travessão — quem decide isso é botoes-rapidos.js, e a regra é que "não sei"
 * não vira número. */
defineProps({
  botoes: { type: Array, required: true },
})
defineEmits(['escolher'])
</script>

<template>
  <div class="brp-grade">
    <button v-for="b in botoes" :key="b.chave" type="button" class="brp-btn"
            @click="$emit('escolher', b.acao)">
      <span class="brp-nome">{{ b.rotulo }}</span>
      <span class="brp-estado" v-if="b.estado">{{ b.estado }}</span>
    </button>
  </div>
</template>

<style scoped>
/* Estilo PRÓPRIO, com prefixo próprio: componente com `<style scoped>` não
   alcança as classes `fr-` que moram na tela grande — foi o defeito achado na
   Fase A, quando a sanfona de revisões quase subiu sem estilo nenhum. Só
   tokens, nunca hex, nem como valor de reserva dentro de `var()`. */
.brp-grade{display:grid;grid-template-columns:1fr 1fr;gap:10px;padding:12px 14px 4px;}
/* 64px de altura: o PADRÃO exige 40px de alvo, e estes são os botões que a
   pessoa procura primeiro ao abrir a aba — com duas linhas de texto dentro,
   40px espremeria o estado contra o nome. */
.brp-btn{display:flex;flex-direction:column;align-items:flex-start;justify-content:center;gap:3px;
  min-height:64px;padding:11px 13px;text-align:left;cursor:pointer;touch-action:manipulation;
  background:var(--surface);border:1px solid var(--border);border-left:3px solid var(--accent);
  border-radius:12px;font-family:var(--fonte-principal);}
.brp-btn:hover{border-color:var(--accent);}
/* `overflow-wrap:anywhere` nos dois: o nome do carro vem do banco e pode ser
   comprido, e o padrão da casa é que texto nunca corta. */
.brp-nome{font-size:max(9px, calc(13.5px * var(--escala-texto, 1)));font-weight:700;color:var(--text);line-height:1.25;overflow-wrap:anywhere;}
.brp-estado{font-size:max(9px, calc(11.5px * var(--escala-texto, 1)));color:var(--muted);line-height:1.3;overflow-wrap:anywhere;}
@media(min-width:900px){
  /* Quatro por linha no computador, e TODOS DA MESMA ALTURA.
     Aqui havia `align-items:start`, copiado da sanfona de revisões. Lá aquilo
     é necessário: a sanfona ABRE, e um cartão aberto inflaria os vizinhos
     fechados da mesma linha. Estes botões não abrem nada — são estáticos, um
     ao lado do outro. O que o `start` produzia era o defeito que o dono
     apontou em 13/08/2026: botão com rótulo de duas linhas ficava mais alto
     que o vizinho, e a fila inteira saía desalinhada no computador.
     Deixando a grade esticar (o padrão dela), a linha fica reta. */
  /* TETO DE LARGURA, e o motivo é o caso de DOIS botões, que é o da aba
     Motorista: `auto-fit` distribui a linha inteira entre quem existe, então
     numa tela de 1440 cada um dos dois ficava com 690px pra dizer três
     palavras — o mesmo defeito de botão esticado que a Gestão já tinha
     corrigido no cartão de veículo. Com o teto, quatro botões continuam
     enchendo a linha e dois param no tamanho do que dizem. */
  .brp-grade{grid-template-columns:repeat(auto-fit,minmax(200px,360px));padding:14px 24px 6px;
    justify-content:start;}
}
</style>
