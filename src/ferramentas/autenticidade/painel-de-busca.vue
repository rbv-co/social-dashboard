<script setup>
/* O PAINEL DE BUSCA DAS ABAS QUE PROCURAM ENTRE MUITOS — Lotes e Etiquetas.
 *
 * POR QUE É UM COMPONENTE, e não o mesmo bloco escrito duas vezes: as duas abas
 * buscam pelas mesmas cinco coisas (data, modelo, referência, código da peça e
 * estado), e busca escrita duas vezes é busca que diverge — a aba que ficasse
 * para trás passaria a esconder dado que a outra acha.
 *
 * O QUE ELE NÃO FAZ: filtrar. As contas moram em `busca-e-arquivamento.js`,
 * testadas sem navegador; daqui sai só o que a pessoa pediu.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * A BUSCA DEIXOU DE SER UMA CAIXA (02/09/2026)
 * ══════════════════════════════════════════════════════════════════════════
 * O dono, olhando a tela do computador: "o card de pesquisa está feio em todas
 * as abas que existem o mesmo".
 *
 * O QUE ELE ERA, MEDIDO NO NAVEGADOR antes desta entrega, a 1440px:
 * uma caixa de 1392 × 235px na aba Lotes e 1392 × 260px na aba Etiquetas — com
 * fundo próprio (`--surface2`), borda em volta e QUATRO andares dentro:
 *   1. o rótulo BUSCAR e o campo;
 *   2. os seis atalhos de data;
 *   3. a gaveta "Período exato" ABERTA, com os dois campos de data;
 *   4. o seletor ESTADO e a contagem.
 * Do lado dela, o cartão de um lote tem 202px. A ferramenta de apoio era mais
 * alta e mais pesada que o conteúdo que ela filtra — e o conteúdo é o assunto.
 *
 * AS TRÊS DECISÕES, e cada uma tem um motivo:
 *
 * 1. SEM CAIXA. Fundo e borda são o que faz um bloco pesar. Tirados os dois, os
 *    controles ficam na própria tela, no MESMO recuo de 24px do resto — e a
 *    busca passa a parecer o que é: a régua em cima da lista, não um cartaz.
 *
 * 2. UMA FAIXA, NÃO QUATRO ANDARES. No computador: campo · atalhos · estado numa
 *    linha, e embaixo uma linha fina com o período exato, a contagem e o
 *    "Limpar". No celular continua empilhado, porque a 375px isso não cabe lado
 *    a lado sem espremer o alvo do dedo.
 *
 * 3. O PERÍODO EXATO FICA FECHADO EM TODA LARGURA. Ele era o andar 3, aberto de
 *    graça no computador — e escrever duas datas à mão é o caso RARO: quem quer
 *    "esta semana" aperta o atalho. A gaveta continua abrindo SOZINHA quando o
 *    recorte É de datas escritas à mão (filtro ligado escondido é filtro que a
 *    pessoa não entende por que corta a lista), e o período escolhido aparece no
 *    próprio rótulo mesmo com ela fechada.
 *
 * O QUE SAIU DA TELA, E ONDE FOI PARAR (PADRÃO item 8 — nada fica sem endereço):
 *   · o rótulo BUSCAR → o `aria-label` do campo, mais a lupa desenhada dentro
 *     dele. A dica do campo já diz por escrito o que dá para procurar ali
 *     ("Modelo, cor, referência ou o código de uma peça"), e um rótulo em cima
 *     dela era a mesma frase duas vezes;
 *   · o rótulo ESTADO → o `aria-label` do seletor. A primeira opção dele é
 *     "Todos os estados", que já diz o que aquele seletor faz;
 *   · os dois campos de data → continuam onde estavam, atrás da gaveta "Período
 *     exato", que agora começa fechada também no computador;
 *   · a contagem e o "Limpar a busca" → a linha fina de baixo, inteiros.
 * Nenhuma função saiu: o que se podia filtrar antes se filtra agora.
 *
 * ESTILO PRÓPRIO, com prefixo próprio (`pb-`): componente com `<style scoped>`
 * não alcança as classes `au-` da tela grande. Só tokens, nunca hex.
 */
import { computed } from 'vue'
import { intervaloDoAtalho, filtroAtivo } from './busca-e-arquivamento.js'

const props = defineProps({
  // { texto, de, ate, atalho, estado } — quem cria e guarda é a tela
  filtro: { type: Object, required: true },
  atalhos: { type: Array, required: true },
  estados: { type: Array, required: true },
  // "Fabricado em" na aba Lotes, "Gravada em" na aba Etiquetas: a data que se
  // filtra é outra em cada aba, e um rótulo genérico faria a pessoa filtrar
  // pela data errada sem perceber
  rotuloDaData: { type: String, required: true },
  dica: { type: String, default: 'Buscar' },
  // "Mostrando 12 de 87 lotes" — vem pronto de `fraseDaContagem`
  contagem: { type: String, default: '' },
  // o estado que a aba abre mostrando; é para ele que o "Limpar" volta
  estadoPadrao: { type: String, default: '' },
})

const emit = defineEmits(['update:filtro'])

// O filtro sai INTEIRO a cada mudança, e não campo a campo: um objeto novo é o
// que o Vue enxerga como mudança, e mexer no de dentro faria a lista não
// redesenhar em parte dos casos.
function mudar(campos) {
  emit('update:filtro', { ...props.filtro, ...campos })
}

// O ATALHO ESCREVE NOS DOIS CAMPOS DE DATA, em vez de virar um terceiro estado
// escondido. Assim o que a pessoa vê nos campos é exatamente o que está
// filtrando — e ela pode ajustar um dia à mão sem o atalho brigar com ela.
function usarAtalho(chave) {
  const { de, ate } = intervaloDoAtalho(chave, new Date())
  mudar({ atalho: chave, de, ate })
}

// Mexer numa data à mão apaga o realce do atalho: o recorte deixou de ser o
// dele, e um chip aceso mentindo sobre o período é pior que chip nenhum.
function mudarData(qual, valor) {
  mudar({ [qual]: valor, atalho: '' })
}

const temFiltro = computed(() => filtroAtivo(props.filtro, props.estadoPadrao))

// ── O PERÍODO EXATO FICA NUMA GAVETA, EM TODA LARGURA ──────────────────────
// Ele já morava atrás dela no celular: medido a 375px, com os dois campos de
// data sempre abertos o painel comia 560px de altura e empurrava a lista — a
// coisa que a pessoa veio ver — para fora da primeira tela.
//
// NO COMPUTADOR ELE NASCIA ABERTO, e isso ACABOU nesta entrega: era um dos
// quatro andares que faziam a busca pesar 235px, e escrever duas datas à mão é
// o caso raro. Caso raro mora atrás de uma gaveta em qualquer largura — foi
// exatamente isso que o dono pediu ("o que é raro fica fora do caminho até ser
// pedido"). Com ela fechada some também o `matchMedia` que lia o ponto de
// quebra do CSS: eram dois números que tinham de andar juntos, e agora não há
// nenhum.
//
// A GAVETA ABRE SOZINHA quando o recorte é de datas escritas à mão: filtro
// ligado escondido é filtro que a pessoa não entende por que está cortando a
// lista. E o resumo no próprio rótulo diz o período mesmo com a gaveta fechada.
const dia = (v) => (v ? String(v).split('-').reverse().join('/') : '')
const periodoEscrito = computed(() => {
  const { de, ate } = props.filtro
  if (de && ate) return de === ate ? dia(de) : `${dia(de)} a ${dia(ate)}`
  if (de) return `a partir de ${dia(de)}`
  if (ate) return `até ${dia(ate)}`
  return ''
})
const gavetaAberta = computed(() => Boolean((props.filtro.de || props.filtro.ate) && !props.filtro.atalho))

// LIMPAR TIRA TUDO, inclusive o recorte com que a aba abriu — é assim que se
// chega ao "e o resto" na aba Etiquetas, que abre nos últimos 30 dias.
function limpar() {
  emit('update:filtro', { texto: '', de: '', ate: '', atalho: 'tudo', estado: props.estadoPadrao })
}
</script>

<template>
  <div class="pb-barra">
    <!-- O CAMPO NÃO TEM MAIS RÓTULO EM CIMA, e não perdeu nada: a lupa diz o que
         ele é para o olho, o `aria-label` diz para o leitor de tela, e a dica
         diz por escrito o que dá para procurar ali. O rótulo BUSCAR era a
         terceira cópia da mesma informação. -->
    <label class="pb-campo pb-busca">
      <svg class="pb-lupa" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"
           fill="none" stroke="currentColor" stroke-width="2.2"
           stroke-linecap="round" stroke-linejoin="round">
        <circle cx="11" cy="11" r="7" /><path d="M20 20l-3.6-3.6" />
      </svg>
      <input type="search" :value="filtro.texto" :placeholder="dica"
             :aria-label="`Buscar — ${dica}`"
             @input="mudar({ texto: $event.target.value })">
    </label>

    <!-- OS ATALHOS SÃO A BUSCA POR DATA DE VERDADE. Ninguém digita duas datas
         para ver o que fez esta semana; os dois campos da gaveta ficam para o
         caso raro. `aria-pressed` porque o realce não pode ser só cor. -->
    <div class="pb-atalhos" role="group" :aria-label="`Período — ${rotuloDaData}`">
      <button v-for="a in atalhos" :key="a.chave" type="button" class="pb-chip"
              :class="{ on: filtro.atalho === a.chave }"
              :aria-pressed="String(filtro.atalho === a.chave)"
              @click="usarAtalho(a.chave)">{{ a.rotulo }}</button>
    </div>

    <!-- O SELETOR TAMBÉM PERDEU O RÓTULO EM CIMA: a primeira opção dele é
         "Todos os estados", que já diz o que ele faz. O `aria-label` fica. -->
    <label class="pb-campo pb-estado">
      <select :value="filtro.estado" aria-label="Filtrar por estado"
              @change="mudar({ estado: $event.target.value })">
        <option v-for="e in estados" :key="e.chave" :value="e.chave">{{ e.rotulo }}</option>
      </select>
    </label>

    <!-- ── A LINHA FINA DE BAIXO ────────────────────────────────────────────
         O que é raro (o período exato) e o que se lê depois de filtrar (a
         contagem e o "Limpar") dividem uma linha só, no tamanho do "resto".
         A CONTAGEM É OBRIGATÓRIA: lista recortada sem número faz a pessoa achar
         que perdeu dado — e aqui o dado é o link que ficou dentro de uma bolsa.
         `role="status"` para quem usa leitor de tela ouvir o número mudar. -->
    <div class="pb-rodape">
      <!-- A seta é desenhada aqui porque `display:flex` no <summary> apaga o
           triângulo que o Chrome desenha sozinho — e o triângulo era a única
           pista de que a gaveta abre. Em SVG, nunca emoji. -->
      <details class="pb-mais" :open="gavetaAberta">
        <summary>
          <svg class="pb-seta" viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"
               fill="none" stroke="currentColor" stroke-width="2.4"
               stroke-linecap="round" stroke-linejoin="round"><polyline points="9 5 16 12 9 19" /></svg>
          <span>Período exato</span>
          <span v-if="periodoEscrito" class="pb-periodo">{{ periodoEscrito }}</span>
        </summary>
        <div class="pb-linha">
          <label class="pb-campo">
            <span class="pb-rot">{{ rotuloDaData }}, de</span>
            <input type="date" :value="filtro.de" @change="mudarData('de', $event.target.value)">
          </label>
          <label class="pb-campo">
            <span class="pb-rot">até</span>
            <input type="date" :value="filtro.ate" @change="mudarData('ate', $event.target.value)">
          </label>
        </div>
      </details>

      <p class="pb-conta">
        <span role="status">{{ contagem }}</span>
      </p>
      <button v-if="temFiltro" class="pb-limpar" type="button" @click="limpar">Limpar a busca</button>
    </div>
  </div>
</template>

<style scoped>
/* Cor só de token, espaço só da escala e TAMANHO DE TEXTO só da escala
   (PADRAO-DA-CENTRAL, itens 2 e 7). Os cinco degraus moram em
   `src/estilos/estilos-globais.css`; aqui o painel usa três deles:
   `--texto-etiqueta` no rótulo da data, `--texto-corpo` no resto e
   `--texto-campo` nos campos, que é o degrau que nunca desce de 16px. Número
   solto reprova no `escala-de-texto.test.mjs`. */

/* ── SEM CAIXA ─────────────────────────────────────────────────────────────
   NÃO HÁ `background`, NÃO HÁ `border` E NÃO HÁ `padding` AQUI, e isso é a
   decisão, não um esquecimento: fundo e moldura são o que faz um bloco pesar,
   e esta é a ferramenta de apoio da tela — ela tem de pesar MENOS que os lotes,
   não mais. O único recuo é o mesmo 24px do resto da tela, para os controles
   nascerem na mesma linha vertical da lista que eles filtram. */
.pb-barra{
  margin:var(--sp-3) 24px 0;
  display:flex; flex-direction:column; gap:var(--sp-3);
}
.pb-campo{display:flex; flex-direction:column; gap:var(--sp-1); min-width:0}
.pb-rot{
  font-family:var(--fonte-principal);
  font-size:var(--texto-etiqueta);
  font-weight:700; letter-spacing:1.5px; text-transform:uppercase; color:var(--muted);
}
/* `--texto-campo` é o degrau que NUNCA desce de 16px, e isso não é estética:
   abaixo disso o iOS dá zoom ao focar e a tela salta na cara de quem está
   digitando. 40px porque dedo não acerta menos. */
.pb-campo input, .pb-campo select{
  width:100%; box-sizing:border-box; min-height:40px; padding:var(--sp-2) var(--sp-3);
  font-family:var(--fonte-principal);
  font-size:var(--texto-campo);
  border:1px solid var(--border); border-radius:var(--radius-md);
  background:var(--surface); color:var(--text);
}
/* A LUPA ENTRA DENTRO DO CAMPO, no lugar do rótulo que saiu. O recuo do texto é
   o dobro da margem dela, para a primeira letra não encostar no desenho. */
.pb-busca{display:block; position:relative}
.pb-lupa{
  position:absolute; left:var(--sp-3); top:50%; transform:translateY(-50%);
  color:var(--muted); pointer-events:none;
}
.pb-busca input{padding-left:var(--sp-8)}
.pb-atalhos{display:flex; flex-wrap:wrap; gap:var(--sp-2)}
/* O chip é um botão comum do PADRÃO: borda e fundo transparente, nunca cinza.
   O aceso usa o par `--accent-light` + `--accent-forte`, que é o que o padrão
   manda para cor sobre o próprio tom aguado e já vem medido. */
.pb-chip{
  min-height:40px; padding:0 var(--sp-3); box-sizing:border-box;
  display:inline-flex; align-items:center; cursor:pointer;
  background:transparent; border:1px solid var(--border); border-radius:var(--radius-md);
  font-family:var(--fonte-principal);
  font-size:var(--texto-corpo);
  font-weight:600; color:var(--muted); white-space:nowrap;
}
.pb-chip:hover{color:var(--text); border-color:var(--accent-mid)}
.pb-chip.on{color:var(--accent-forte); background:var(--accent-light); border-color:var(--accent)}

/* ── A LINHA FINA DE BAIXO ─────────────────────────────────────────────────
   `align-items:flex-start` porque a gaveta CRESCE quando abre: com os itens
   centrados, abrir o período exato faria a contagem descer meia linha junto. */
.pb-rodape{
  display:flex; align-items:flex-start; flex-wrap:wrap;
  gap:var(--sp-2) var(--sp-4);
}
/* A GAVETA DO PERÍODO EXATO. `display:flex` no <summary> apaga o marcador
   nativo nos dois motores, e a seta vira o SVG do template. 40px de alvo. */
.pb-mais summary{
  display:flex; align-items:center; gap:var(--sp-2); min-height:40px; cursor:pointer;
  list-style:none; font-family:var(--fonte-principal);
  font-size:var(--texto-corpo);
  font-weight:600; color:var(--text); flex-wrap:wrap;
}
.pb-mais summary::-webkit-details-marker{display:none}
.pb-seta{flex-shrink:0; color:var(--accent); transition:transform .15s}
.pb-mais[open] > summary .pb-seta{transform:rotate(90deg)}
/* ABERTA, A GAVETA TOMA A LINHA INTEIRA. Fechada ela é um alvo curto do tamanho
   do próprio rótulo; aberta, os dois campos de data precisam de largura, e sem
   isto eles sairiam espremidos ao lado da contagem. */
.pb-mais[open]{flex:1 1 100%}
/* O período escolhido aparece no próprio rótulo, com a gaveta fechada: filtro
   ligado escondido é filtro que a pessoa não entende por que corta a lista. */
.pb-periodo{font-weight:400; color:var(--muted)}
/* Os dois campos de data lado a lado no computador; a 375px eles empilham,
   porque espremer um `input type="date"` corta a data escrita dentro dele. */
.pb-linha{display:flex; gap:var(--sp-3); flex-wrap:wrap; padding-top:var(--sp-2)}
.pb-linha .pb-campo{flex:1 1 180px}
.pb-conta{
  display:flex; align-items:center; min-height:40px; margin:0;
  font-family:var(--fonte-principal);
  font-size:var(--texto-corpo);
  color:var(--muted); overflow-wrap:anywhere;
}
/* Alvo de dedo de 40px sem virar botão: cresce a área, o texto continua link
   (PADRAO item 6). `--accent-forte` porque `--accent` puro sobre a superfície
   reprova por pouco no tema escuro, e "por pouco" continua sendo reprovado. */
.pb-limpar{
  display:inline-flex; align-items:center; min-height:40px; padding:0;
  background:none; border:none; cursor:pointer;
  font-family:var(--fonte-principal);
  font-size:var(--texto-corpo);
  font-weight:600; color:var(--accent-forte);
}

/* ── A TELA GRANDE ────────────────────────────────────────────────────────
   No celular o painel empilha, e está certo: com 375px de largura busca,
   atalhos e estado não cabem lado a lado sem espremer o alvo do dedo.

   No computador o campo e o estado dividem a primeira linha, os atalhos ficam
   na segunda e a linha fina — período exato, contagem, "Limpar" — na terceira.
   A partir de 1240px, onde os seis atalhos cabem inteiros ao lado dos outros
   dois, tudo isso vira DUAS linhas. Eram QUATRO andares dentro de uma caixa.

   AS POSIÇÕES SÃO ESCRITAS À MÃO, e não deixadas para o encaixe automático: os
   atalhos e o rodapé ocupam a linha inteira, e com posição automática o
   primeiro deles empurraria o "Estado" para uma linha própria, deixando um vão
   na primeira. Contado no navegador, não deduzido.

   POR QUE 900px: é o mesmo corte da tela grande de `tela-de-autenticidade.vue`
   e o mesmo que a Frota usa. Telas irmãs que mudam de forma na mesma largura é
   o que faz a Central parecer uma coisa só. */
@media (min-width:900px){
  .pb-barra{
    display:grid;
    grid-template-columns:minmax(240px,1fr) minmax(200px,.42fr);
    align-items:center; column-gap:var(--sp-4); row-gap:var(--sp-2);
  }
  .pb-busca{grid-column:1; grid-row:1}
  .pb-estado{grid-column:2; grid-row:1}
  .pb-atalhos{grid-column:1 / -1; grid-row:2}
  .pb-rodape{grid-column:1 / -1; grid-row:3}
  /* Sem isto cada campo de data esticaria para meia faixa. Uma data escrita não
     fica mais legível com 500px de campo. */
  .pb-linha .pb-campo{flex:0 1 200px}
}

/* OS SEIS ATALHOS DE DATA SÓ SOBEM PARA A PRIMEIRA LINHA QUANDO CABEM INTEIROS.
   Medido a 1024px com os três na mesma linha: os atalhos quebravam em duas
   fileiras e o "Estado" ficava com 180px, cortando "Com garantia de cliente"
   dentro do próprio seletor — texto cortado é defeito (PADRAO item 5).
   A partir de 1240px os três cabem, e aí a busca inteira vira DUAS linhas. */
@media (min-width:1240px){
  .pb-barra{grid-template-columns:minmax(240px,1fr) minmax(0,auto) minmax(200px,.42fr)}
  .pb-atalhos{grid-column:2; grid-row:1}
  .pb-estado{grid-column:3; grid-row:1}
  .pb-rodape{grid-row:2}
}

/* O `@media` do celular é a ÚLTIMA coisa deste arquivo, e tem de continuar
   sendo: duas regras de mesma especificidade, ganha a última — uma regra-base
   escrita depois daqui apagaria o ajuste de celular em silêncio. */
@media (max-width:520px){
  .pb-barra{margin-left:16px; margin-right:16px}
  /* ⚠️ NÃO PONHA `.pb-mais{flex:1 1 100%}` AQUI. Medido a 375px: forçar a
     gaveta a ocupar a linha inteira sobe a busca da aba Lotes de 244px para
     292px, e não tira nenhuma fileira da aba Etiquetas — a contagem e o
     "Limpar" continuam sem caber juntos em 343px. Já foi tentado. */
  /* Empilhado: `input type="date"` espremido corta a data escrita dentro dele,
     e texto que corta é defeito (PADRAO item 5). */
  .pb-linha{flex-direction:column}
  .pb-linha .pb-campo{flex:none}
}
</style>
