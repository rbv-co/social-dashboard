<!-- src/ferramentas/frota/sanfona-de-revisoes.vue -->
<script setup>
/* A aba Revisões mostrando TUDO, um carro por vez (D30).
 *
 * Sanfona e não lista corrida: são 10 carros × 8 itens = 80 linhas, e 80 linhas
 * de uma vez num celular é rolagem que ninguém termina. Sanfona e não grade
 * carros × itens: grade só cabe arrastando pro lado no celular, que é
 * exatamente a queixa que o B3 conserta. */
import { ref } from 'vue'

// `podeLancar` entrou na Fase C junto com o botão que ele guarda: registrar
// manutenção é trabalho de quem administra, e é a mesma regra que a RLS de
// `frota_manutencoes` aplica no banco (migration 041). Nasce `false` — quem
// esquecer de passar recebe a tela mais fechada, não a mais aberta.
defineProps({
  cartoes: { type: Array, required: true },
  podeLancar: { type: Boolean, default: false },
})
defineEmits(['lancar'])

const aberto = ref(null)
const alternar = (id) => { aberto.value = aberto.value === id ? null : id }
const km = (n) => (n == null ? 'sem quilometragem' : `${n.toLocaleString('pt-BR')} km`)
</script>

<template>
  <div class="sr-lista">
    <div v-for="c in cartoes" :key="c.linha.veiculo.id" class="sr-card"
         :class="{ espera: c.resumo.nivel === 'perto', ruimzao: c.resumo.nivel === 'vencida',
                   desconhecido: c.resumo.nivel === 'sem-km' || c.resumo.nivel === 'sem-registro' }">
      <!-- O cabeçalho inteiro é o botão: alvo grande, que é o que o padrão
           manda e o que quem tem dificuldade acerta. -->
      <button type="button" class="sr-topo" :aria-expanded="aberto === c.linha.veiculo.id"
              :aria-controls="'sr-itens-' + c.linha.veiculo.id"
              @click="alternar(c.linha.veiculo.id)">
        <span class="sr-card-ident">
          <span class="sr-card-nome">{{ c.linha.veiculo.nome }}</span>
          <span class="sr-placa">{{ c.linha.veiculo.placa }} · {{ km(c.linha.km) }}</span>
        </span>
        <span class="sr-selo" :class="{
          ruim: c.resumo.nivel === 'vencida',
          espera: c.resumo.nivel === 'perto',
          boa: c.resumo.nivel === 'em-dia',
          neutra: c.resumo.nivel === 'sem-km' || c.resumo.nivel === 'sem-registro',
        }">{{ c.resumo.texto }}</span>
      </button>

      <ul class="sr-itens" :id="'sr-itens-' + c.linha.veiculo.id" v-if="aberto === c.linha.veiculo.id">
        <li v-for="i in c.itens" :key="i.item" :class="i.situacao">
          <span class="sr-item-nome">{{ i.item }}</span>
          <span class="sr-item-txt">{{ i.texto }}</span>
        </li>
      </ul>

      <!-- O passo seguinte a LER que a troca venceu é REGISTRAR que ela foi
           feita. O botão fica aqui, dentro do carro aberto, pra não obrigar a
           pessoa a fechar isto, ir na aba Gestão e achar a ficha do veículo. -->
      <div class="sr-acoes" v-if="podeLancar && aberto === c.linha.veiculo.id">
        <button type="button" class="sr-btn" @click="$emit('lancar', c.linha.veiculo)">
          Lançar manutenção
        </button>
      </div>
    </div>
    <p class="sr-aviso" v-if="!cartoes.length">
      Nenhum veículo cadastrado ainda.
    </p>
  </div>
</template>

<style scoped>
/* Um componente com <style scoped> NÃO herda o <style scoped> de outro
 * arquivo — cada regra abaixo é a mesma receita visual de `.fr-lista`/
 * `.fr-card`/`.fr-selo`/`.fr-itens` em tela-de-frota.vue, copiada de propósito
 * com o prefixo `sr-`, só com tokens (nunca hex fixo), pra o cartão fechado
 * ficar indistinguível do cartão de "Chegando a hora" que continua logo acima
 * na mesma aba. (Achado e corrigido na execução da T7: a primeira versão deste
 * arquivo reaproveitava as classes `fr-*` do pai — e como o estilo delas mora
 * só no `<style scoped>` de tela-de-frota.vue, a sanfona subiria sem cor
 * nenhuma.) */

.sr-lista{display:flex;flex-direction:column;gap:10px;padding:4px 14px 40px;}

.sr-card{background:var(--surface);border:1px solid var(--border);border-left:3px solid var(--green);border-radius:12px;padding:14px 16px;}
.sr-card.espera{border-left-color:var(--orange);}
.sr-card.ruimzao{border-left-color:var(--red);}
/* "Sem quilometragem"/"sem histórico" não é nem bom nem ruim — é não se saber
   nada. Por isso um quarto tom, cinza, e nunca o verde de "em dia": dizer que
   está tudo bem quando não se sabe nada é exatamente a mentira que o D30
   existe pra corrigir. */
.sr-card.desconhecido{border-left-color:var(--muted);}

/* Cabeçalho-botão: sem cara de botão, com alvo de botão. `width:100%` e
   `text-align:left` porque o padrão da casa não tem botão que ocupe a linha
   inteira, e este não é um dos três tipos — é a superfície de tocar do cartão.
   O layout interno (flex, gap, wrap) é o mesmo de `.fr-card-topo` no pai. */
.sr-topo{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap;
  width:100%;min-height:44px;padding:0;border:none;background:none;text-align:left;
  cursor:pointer;font:inherit;color:inherit;touch-action:manipulation;}

.sr-card-ident{display:flex;flex-direction:column;gap:2px;min-width:0;}
/* `overflow-wrap:anywhere`: `veiculo.nome` é digitado por gente, e diferente
   de `.fr-ficha` (tela-de-frota.vue), `.sr-card` não tem `overflow:hidden` —
   nada aqui corta uma palavra comprida sem espaço. Sem isso ela empurra o
   cartão pra fora da tela e estoura rolagem horizontal no celular, contra a
   regra da casa. Mesmo par de `.fr-item-txt`/`.fr-ajuda` em tela-de-frota.vue. */
.sr-card-nome{font-family:var(--fonte-principal);font-size:max(9px, calc(13.5px * var(--escala-texto, 1)));font-weight:700;color:var(--text);overflow-wrap:anywhere;}
.sr-placa{font-family:var(--fonte-dados);font-size:max(9px, calc(11px * var(--escala-texto, 1)));letter-spacing:1.5px;color:var(--muted);}

.sr-selo{font-family:var(--fonte-principal);font-size:max(9px, calc(10px * var(--escala-texto, 1)));font-weight:700;letter-spacing:.4px;padding:4px 10px;border-radius:999px;background:color-mix(in srgb,var(--muted) 16%,transparent);color:var(--text);white-space:nowrap;}
.sr-selo.espera{background:color-mix(in srgb,var(--orange) 18%,transparent);color:var(--orange);}
.sr-selo.boa{background:color-mix(in srgb,var(--green) 18%,transparent);color:var(--green);}
.sr-selo.ruim{background:color-mix(in srgb,var(--red) 16%,transparent);color:var(--red);}
.sr-selo.neutra{background:color-mix(in srgb,var(--muted) 16%,transparent);color:var(--muted);}

.sr-itens{margin:12px 0 0;padding:0;list-style:none;display:flex;flex-direction:column;gap:6px;}
.sr-itens li{display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;font-family:var(--fonte-principal);font-size:max(9px, calc(12.5px * var(--escala-texto, 1)));color:var(--muted);padding-left:10px;border-left:2px solid var(--border);}
.sr-itens li.vencida{border-left-color:var(--red);}
.sr-itens li.perto{border-left-color:var(--orange);}
.sr-itens li.em-dia{border-left-color:var(--green);}
/* sem-km e sem-registro ficam na borda neutra do estado padrão, acima —
   nem vermelho nem verde, porque não se sabe nada sobre este item. */

/* Mesmo motivo do `.sr-card-nome` acima: `plano.item` também é digitado por
   gente (o mecânico, no editor de limiares), e este `<li>` não tem clip. */
.sr-item-nome{color:var(--text);font-weight:600;overflow-wrap:anywhere;}
.sr-item-txt{font-variant-numeric:tabular-nums;overflow-wrap:anywhere;}

/* Sem padding horizontal próprio: este aviso mora DENTRO de `.sr-lista`, que
   já dá os 14px/24px da margem da página — dobrar o respiro aqui desalinharia
   o texto em relação aos cartões. */
.sr-aviso{margin:0;font-family:var(--fonte-principal);font-size:max(9px, calc(12.5px * var(--escala-texto, 1)));line-height:1.55;color:var(--muted);}
/* Mesma receita do `.fr-btn` da tela grande — copiada por causa do limite do
   `<style scoped>`, não por escolha. 40px de alvo, como o padrão manda. */
.sr-acoes{display:flex;gap:8px;margin-top:10px;}
.sr-btn{min-height:44px;padding:11px 16px;border:1px solid var(--border);border-radius:10px;background:var(--surface);color:var(--text);font-family:var(--fonte-principal);font-size:max(9px, calc(13.5px * var(--escala-texto, 1)));font-weight:600;cursor:pointer;touch-action:manipulation;}
.sr-btn:hover{border-color:var(--accent);}

@media(min-width:900px){
  /* `align-items:start`: sem isso o Grid estica cada item à altura do maior
     da mesma linha (padrão do Grid é `stretch`). "Chegando a hora" logo acima
     é uma lista de cartões estáticos — lá isso nunca aparece. Aqui é uma
     sanfona: abrir UM cartão inflaria os vizinhos fechados da mesma linha com
     espaço vazio embaixo se essa linha não estivesse aqui. */
  .sr-lista{padding:4px 24px 40px;display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:14px;align-items:start;}
}
</style>
