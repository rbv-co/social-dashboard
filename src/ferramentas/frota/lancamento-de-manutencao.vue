<script setup>
/* A ficha de lançar manutenção: um serviço, várias trocas (D27).
 *
 * O que ela substitui: o formulário de uma troca por vez, onde registrar 3
 * trocas era preencher item/KM/data/oficina/custo três vezes — 15 campos, com
 * KM, data e oficina redigitados a cada rodada. Medido em 12/08/2026: a frota
 * tem 2 trocas registradas em 10 carros. O dono: "difícil por ter que fazer um
 * a um".
 *
 * ELA NÃO FALA COM O BANCO. Emite o que gravar e quem grava é a tela, porque a
 * ordem de gravação tem uma armadilha (cabeçalho e trocas são duas gravações) e
 * essa armadilha precisa de conferência a cada passo — "duas gravações e só a
 * primeira conferida" apareceu 4× nesta ferramenta, sempre com a tela dizendo
 * que tinha dado certo. */
import { ref, reactive, computed } from 'vue'
import {
  problemasDoLancamento, diferencaDeValores, centavos, VALOR_INVALIDO,
} from './lancamento-de-manutencao.js'

const props = defineProps({
  veiculo: { type: Object, required: true },
  // Só os itens ATIVOS do plano: item desligado não deve ser oferecido pra
  // marcar, senão a pessoa registra uma troca que não gera alerta nenhum.
  plano: { type: Array, required: true },
  kmConhecido: { type: Number, default: null },
  gravando: { type: Boolean, default: false },
  // O erro vem de FORA: quem grava é a tela, e é ela que sabe o que falhou.
  erro: { type: String, default: '' },
  // A camada vem de FORA, do balcão em compartilhado/camada-de-modal.js: quem
  // abre por último fica na frente. Número fixo aqui foi o defeito anterior —
  // pus esta ficha abaixo da do veículo pra resolver um caso e quebrei o
  // caminho principal, que é abrir o lançamento DE DENTRO da ficha do veículo.
  camada: { type: Number, default: null },
})
const emit = defineEmits(['gravar', 'fechar', 'novo-item'])

const form = reactive({ km: '', feitaEm: '', oficina: '', total: '', observacao: '' })
// `marcados` guarda o texto do item, não o índice: o plano pode mudar de ordem
// enquanto a ficha está aberta.
const marcados = ref(new Set())
const valores = reactive({})

function alternar(item) {
  const s = new Set(marcados.value)
  if (s.has(item)) { s.delete(item); delete valores[item] } else s.add(item)
  marcados.value = s
}

/** Só os centavos que dá pra gravar; texto ilegível vira nulo aqui e é BARRADO
 *  por `valoresIlegiveis` mais abaixo, em vez de virar "sem valor" calado. */
const centavosOuNulo = (txt) => {
  const c = centavos(txt)
  return c === VALOR_INVALIDO ? null : c
}
const ilegivel = (txt) => centavos(txt) === VALOR_INVALIDO

function inteiro(txt) {
  const so = String(txt ?? '').replace(/\D/g, '')
  return so === '' ? null : parseInt(so, 10)
}

const itensMarcados = computed(() =>
  props.plano
    .filter((p) => marcados.value.has(p.item))
    .map((p) => ({ item: p.item, valorCentavos: centavosOuNulo(valores[p.item]) })))

/* Valor que não dá pra ler BARRA, em vez de gravar nulo calado. Sem isto,
 * quem digitasse "12,345" (ambíguo entre R$ 12.345,00 e R$ 12,34) veria a tela
 * gravar sem valor nenhum e dizer que deu certo — a tela mentindo sobre o que
 * a pessoa mandou. */
const valoresIlegiveis = computed(() => {
  const p = []
  if (ilegivel(form.total)) {
    p.push({
      bloqueia: true,
      texto: 'Não consegui ler o valor total. Escreva como 1.240,00 ou 1240,00 — '
        + 'com vírgula antes dos centavos.',
    })
  }
  for (const it of itensMarcados.value) {
    if (ilegivel(valores[it.item])) {
      p.push({
        bloqueia: true,
        texto: `Não consegui ler o valor de "${it.item}". Escreva como 180,00 — `
          + 'com vírgula antes dos centavos.',
      })
    }
  }
  return p
})

const problemas = computed(() => [
  ...problemasDoLancamento({
    km: inteiro(form.km), itens: itensMarcados.value, kmConhecido: props.kmConhecido,
  }),
  ...valoresIlegiveis.value,
])
const bloqueios = computed(() => problemas.value.filter((p) => p.bloqueia))
const avisos = computed(() => problemas.value.filter((p) => !p.bloqueia))
const divergencia = computed(() => diferencaDeValores({
  totalCentavos: centavosOuNulo(form.total), itens: itensMarcados.value,
}))

const quantas = computed(() => itensMarcados.value.length)
const rotuloGravar = computed(() => {
  if (props.gravando) return 'Gravando…'
  if (!quantas.value) return 'Gravar'
  return quantas.value === 1 ? 'Gravar 1 troca' : `Gravar ${quantas.value} trocas`
})

function gravar() {
  if (bloqueios.value.length || props.gravando) return
  emit('gravar', {
    km: inteiro(form.km),
    feitaEm: form.feitaEm || null,
    oficina: form.oficina.trim() || null,
    totalCentavos: centavosOuNulo(form.total),
    observacao: form.observacao.trim() || null,
    itens: itensMarcados.value,
  })
}
</script>

<template>
  <div class="lm-fundo" v-trava-rolagem :style="{ zIndex: camada }" @click.self="$emit('fechar')">
    <div class="lm-ficha" role="dialog" aria-label="Lançar manutenção">
      <div class="lm-topo">
        <span class="lm-titulo">Lançar manutenção · {{ veiculo.nome }}</span>
        <button type="button" class="lm-fechar" aria-label="Fechar" @click="$emit('fechar')">✕</button>
      </div>

      <div class="lm-corpo">
        <p class="lm-explica">
          Uma nota da oficina, mesmo com várias peças, é <strong>um lançamento só</strong>.
          Preencha o KM uma vez e marque tudo o que foi trocado.
        </p>

        <div class="lm-dupla">
          <label class="lm-campo">
            <span class="lm-lab">Quando foi</span>
            <input v-model="form.feitaEm" type="date">
          </label>
          <label class="lm-campo">
            <span class="lm-lab">KM do painel</span>
            <input v-model="form.km" type="text" inputmode="numeric" autocomplete="off">
            <span class="lm-ajuda" v-if="kmConhecido !== null">
              O maior que conheço deste carro é {{ kmConhecido.toLocaleString('pt-BR') }}.
            </span>
            <span class="lm-ajuda" v-else>
              Ainda não sei a quilometragem deste carro — este número passa a ser a referência dele.
            </span>
          </label>
        </div>

        <div class="lm-dupla">
          <label class="lm-campo">
            <span class="lm-lab">Oficina</span>
            <input v-model="form.oficina" type="text">
            <span class="lm-ajuda">Ex.: JHM Auto Center</span>
          </label>
          <label class="lm-campo">
            <span class="lm-lab">Valor total (R$)</span>
            <input v-model="form.total" type="text" inputmode="decimal">
            <span class="lm-ajuda">O que veio na nota, com mão de obra.</span>
          </label>
        </div>

        <h3 class="lm-grupo">O que foi trocado</h3>
        <ul class="lm-itens">
          <li v-for="p in plano" :key="p.id || p.item" :class="{ marcado: marcados.has(p.item) }">
            <!-- A linha inteira é o alvo: alvo grande é o que quem tem
                 dificuldade acerta, e a caixa sozinha tem 20px. -->
            <label class="lm-item-linha">
              <input type="checkbox" :checked="marcados.has(p.item)" @change="alternar(p.item)">
              <span class="lm-item-nome">{{ p.item }}</span>
              <span class="lm-item-km">a cada {{ (p.a_cada_km || 0).toLocaleString('pt-BR') }} km</span>
            </label>
            <!-- O valor só aparece com o item marcado: campo de valor de item
                 desmarcado é campo que não faz nada. -->
            <label class="lm-item-valor" v-if="marcados.has(p.item)">
              <span class="lm-lab">Valor da peça (R$)</span>
              <input v-model="valores[p.item]" type="text" inputmode="decimal" placeholder="opcional">
            </label>
          </li>
        </ul>

        <button type="button" class="lm-btn lm-novo-item" @click="$emit('novo-item')">
          + Acrescentar item de mecânica
        </button>

        <!-- A divergência NÃO é erro: aparece sem cor de alarme. -->
        <p class="lm-divergencia" v-if="divergencia">{{ divergencia.texto }}</p>

        <label class="lm-campo">
          <span class="lm-lab">Observação</span>
          <input v-model="form.observacao" type="text">
          <span class="lm-ajuda">Serve pro conserto de uma vez só — parachoque, vidro — que não tem item no plano.</span>
        </label>

        <p class="lm-aviso" v-for="(a, i) in avisos" :key="'a' + i">{{ a.texto }}</p>
        <p class="lm-erro" v-for="(b, i) in bloqueios" :key="'b' + i">{{ b.texto }}</p>
        <p class="lm-erro" v-if="erro">{{ erro }}</p>
      </div>

      <div class="lm-pe">
        <button type="button" class="lm-btn" @click="$emit('fechar')">Cancelar</button>
        <button type="button" class="lm-btn primario" :disabled="!!bloqueios.length || gravando"
                @click="gravar">{{ rotuloGravar }}</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* Estilo PRÓPRIO, prefixado: componente com `<style scoped>` não alcança as
   classes `fr-` da tela grande — foi o defeito achado na Fase A, quando a
   sanfona de revisões quase subiu sem estilo nenhum. Só tokens, nunca hex, nem
   como valor de reserva dentro de `var()`. */
/* O `z-index` NÃO mora mais aqui: vem pela propriedade `camada`. O 1150 fixo
   que ficava nesta linha era uma tentativa de resolver o empilhamento por
   número, e ela se mostrou impossível — abaixo da ficha do veículo consertava o
   editor de item aberto daqui, e quebrava o lançamento aberto DE DENTRO da
   ficha. O 1200 abaixo é só o chão, pro caso de a camada não vir. */
.lm-fundo{position:fixed;inset:0;z-index:1200;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;padding:14px;touch-action:none;overscroll-behavior:contain;}
/* 720px, o MESMO de todos os modais da Frota (pedido do dono em 12/08/2026).
   Modal sempre do mesmo tamanho é uma coisa a menos pra estranhar — e esta
   ficha, com a lista de itens do plano, é das que mais aproveitam a largura. */
.lm-ficha{width:100%;max-width:720px;max-height:calc(100dvh - 28px);display:flex;flex-direction:column;background:var(--surface);border:1px solid var(--border);border-radius:16px;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,.35);}
.lm-topo{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:13px 15px;border-bottom:1px solid var(--border);}
.lm-titulo{flex:1;min-width:0;font-family:var(--fonte-principal);font-size:max(9px, calc(12.5px * var(--escala-texto, 1)));font-weight:700;letter-spacing:.6px;color:var(--text);overflow-wrap:anywhere;}
/* 40px de alvo: o PADRÃO manda, e errar o ✕ num modal que trava a rolagem do
   fundo é ficar preso na ficha. */
.lm-fechar{appearance:none;border:1px solid var(--border);background:var(--surface);color:var(--text);border-radius:9px;width:40px;height:40px;font-size:max(9px, calc(15px * var(--escala-texto, 1)));cursor:pointer;flex:0 0 auto;touch-action:manipulation;}
/* `overflow-x:clip` + `touch-action:pan-y`: o corpo rola SÓ na vertical. Um eixo
   em `auto` promove o outro a `auto` pela regra do CSS, e foi assim que os
   modais desta tela ficaram arrastáveis pros lados sem ninguém pedir. */
.lm-corpo{padding:14px 15px;overflow-y:auto;overflow-x:clip;touch-action:pan-y;overscroll-behavior:contain;display:flex;flex-direction:column;gap:13px;}
.lm-explica{margin:0;padding:10px 12px;font-family:var(--fonte-principal);font-size:max(9px, calc(12.5px * var(--escala-texto, 1)));line-height:1.6;color:var(--text);background:color-mix(in srgb,var(--accent) 8%,var(--surface));border:1px solid color-mix(in srgb,var(--accent) 22%,var(--surface));border-radius:10px;}
.lm-dupla{display:grid;grid-template-columns:1fr;gap:12px;}
.lm-dupla > *{min-width:0;}
@media(min-width:560px){ .lm-dupla{grid-template-columns:1fr 1fr;} }
.lm-campo{display:flex;flex-direction:column;gap:5px;}
.lm-lab{font-family:var(--fonte-principal);font-size:max(9px, calc(10.5px * var(--escala-texto, 1)));letter-spacing:.8px;text-transform:uppercase;color:var(--muted);}
/* 16px: abaixo disso o iPhone dá zoom sozinho ao tocar no campo. */
.lm-campo input,.lm-item-valor input{font-family:var(--fonte-principal);font-size:max(16px, calc(16px * var(--escala-texto, 1)));padding:11px 12px;border:1px solid var(--border);border-radius:10px;background:var(--surface);color:var(--text);width:100%;box-sizing:border-box;}
.lm-ajuda{font-family:var(--fonte-principal);font-size:max(9px, calc(11.5px * var(--escala-texto, 1)));color:var(--muted);overflow-wrap:anywhere;}
.lm-grupo{margin:4px 0 0;font-family:var(--fonte-principal);font-size:max(9px, calc(11px * var(--escala-texto, 1)));font-weight:700;letter-spacing:1.2px;text-transform:uppercase;color:var(--muted);}
.lm-itens{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:8px;}
.lm-itens li{padding:9px 11px;border:1px solid var(--border);border-radius:10px;background:var(--surface);}
.lm-itens li.marcado{border-color:var(--accent);background:color-mix(in srgb,var(--accent) 6%,var(--surface));}
/* min-height 40px na linha inteira: o alvo é a linha, não a caixinha de 20px. */
.lm-item-linha{display:flex;align-items:center;gap:10px;min-height:40px;cursor:pointer;touch-action:manipulation;}
.lm-item-linha input[type=checkbox]{width:20px;height:20px;flex:0 0 auto;accent-color:var(--accent);}
.lm-item-nome{flex:1 1 auto;min-width:0;font-family:var(--fonte-principal);font-size:max(9px, calc(13.5px * var(--escala-texto, 1)));color:var(--text);overflow-wrap:anywhere;}
.lm-item-km{font-family:var(--fonte-principal);font-size:max(9px, calc(11px * var(--escala-texto, 1)));color:var(--muted);white-space:nowrap;}
.lm-item-valor{display:flex;flex-direction:column;gap:5px;margin-top:8px;padding-left:30px;}
.lm-divergencia{margin:0;padding:10px 12px;font-family:var(--fonte-principal);font-size:max(9px, calc(12.5px * var(--escala-texto, 1)));line-height:1.55;color:var(--text);background:var(--surface2);border-left:3px solid var(--border);border-radius:8px;overflow-wrap:anywhere;}
.lm-aviso{margin:0;font-family:var(--fonte-principal);font-size:max(9px, calc(12.5px * var(--escala-texto, 1)));line-height:1.55;color:var(--orange);overflow-wrap:anywhere;}
.lm-erro{margin:0;font-family:var(--fonte-principal);font-size:max(9px, calc(12.5px * var(--escala-texto, 1)));line-height:1.55;color:var(--red);overflow-wrap:anywhere;}
.lm-pe{display:flex;gap:9px;justify-content:flex-end;padding:12px 15px;border-top:1px solid var(--border);}
.lm-btn{min-height:44px;padding:11px 16px;border:1px solid var(--border);border-radius:10px;background:var(--surface);color:var(--text);font-family:var(--fonte-principal);font-size:max(9px, calc(13.5px * var(--escala-texto, 1)));font-weight:600;cursor:pointer;touch-action:manipulation;}
.lm-btn.primario{background:var(--accent);border-color:var(--accent);color:var(--sobre-cor);}
.lm-btn:disabled{opacity:.6;cursor:default;}
.lm-novo-item{align-self:flex-start;}
@media(min-width:900px){
  /* Mesma medida do "✕" dos outros modais da Frota no computador. Sem isto esta
     ficha ficava com um ✕ de 40px ao lado de fichas com 34px — a divergência
     que o dono apontou. */
  .lm-fechar{width:34px;height:34px;}
}
</style>
