<template>
  <section class="cv-bloco">
    <div class="cv-cabeca">
      <div class="cv-cabeca-texto">
        <h2 class="cv-etiqueta id-titulo"><icone-do-bloco nome="placar" />O placar da edição</h2>
      </div>
      <span v-if="placar?.edicao" class="selo" :class="corDaSituacao(placar.edicao.situacao)">
        {{ SITUACOES_DA_EDICAO[placar.edicao.situacao] || placar.edicao.situacao }}</span>
    </div>

    <p v-if="erro" class="cv-nota cv-nota-erro">{{ erro }}</p>

    <!-- ── SEM EDIÇÃO ESCOLHIDA (decisão 1): nunca soma edição de praça
         diferente — uma linha por praça, com a edição ABERTA dela e quantas
         stylists. Escolher uma abre o placar inteiro. ─────────────────────── -->
    <template v-else-if="!edicaoId">
      <p class="cv-nota cv-nota-primeira">
        Escolha uma praça na barra acima para ver o placar da edição dela — ou
        escolha direto por aqui, pela praça que já tem edição aberta.
      </p>
      <div v-if="carregandoPracasAbertas" class="cv-carregando">Carregando…</div>
      <p v-else-if="erroPracasAbertas" class="cv-nota cv-nota-erro">{{ erroPracasAbertas }}</p>
      <p v-else-if="!pracasAbertas.length" class="cv-vazio">Nenhuma praça com edição aberta agora.</p>
      <ul v-else class="pd-abertas">
        <li v-for="pa in pracasAbertas" :key="pa.praca.id">
          <button type="button" class="btn pd-abertas-linha" @click="$emit('escolher', { pracaId: pa.praca.id, edicaoId: pa.edicao.id })">
            <span class="pd-abertas-nome">{{ rotuloDaPraca(pa.praca) }}</span>
            <span class="cv-sub">{{ rotuloCurtoDaEdicao(pa.edicao) }} · {{ quantasStylists(pa.edicao.stylists) }}</span>
          </button>
        </li>
      </ul>
    </template>

    <div v-else-if="carregando || !placar" class="cv-carregando">Carregando o placar…</div>

    <template v-else-if="placar">
      <!-- ── ETAPAS DO FUNIL, EM CIMA (decisão 2): uma caixa por etapa,
           TODAS, na ordem cadastrada — inclusive as de zero. O número de
           etapas não é fixo (hoje são 8): nunca cortar a lista. ──────────── -->
      <div class="id-grupo cv-grupo-parceiras">
        <h3 class="cv-etiqueta cv-etiqueta-interna id-titulo"><icone-do-bloco nome="funil" />Etapas do funil, hoje</h3>
        <p v-if="!placar.etapas.length" class="cv-vazio">Nenhuma etapa cadastrada.</p>
        <div v-else class="cv-numeros cv-numeros-placar">
          <div v-for="e in placar.etapas" :key="e.id" class="cv-numero">
            <span class="cv-numero-valor">{{ e.stylists }}</span>
            <span class="cv-numero-rotulo">{{ e.nome }}</span>
            <span class="cv-numero-base">{{ e.tipo === 'saida' ? 'etapa de saída' : 'etapa do funil' }}</span>
          </div>
        </div>
      </div>

      <!-- ── AS TAXAS DA TURMA, EMBAIXO, MENOR (decisão 2) ──────────────────
           ⚠️ SEM RECEITA NENHUMA — a resposta nem traz (decisão 3): nenhuma
           das três razões de dinheiro do placar mensal antigo aparece aqui. -->
      <div class="id-grupo cv-grupo-encontros pd-menor">
        <h3 class="cv-etiqueta cv-etiqueta-interna id-titulo"><icone-do-bloco nome="conjunto" />A turma desta edição</h3>
        <div class="cv-numeros cv-numeros-placar cv-sequencia">
          <div v-for="p in sequencia" :key="p.chave" class="cv-numero" :data-passo="p.chave">
            <span class="cv-numero-valor">{{ p.valor }}</span>
            <span class="cv-numero-rotulo">{{ p.rotulo }}</span>
            <span class="cv-numero-base">{{ p.base }}</span>
            <span v-if="p.taxa" class="cv-numero-base">{{ taxaDoPasso(p) }}</span>
            <span v-if="p.taxa && margemEscrita(p.taxa)" class="cv-numero-margem">{{ margemEscrita(p.taxa) }}</span>
          </div>
        </div>
      </div>

      <!-- ⚠️ RODADA 1 DE CONSERTO (IMPORTANTE 4): voltaram — a edição TEM
           janela, e as duas contas são exatamente as de
           `vessel_numeros_do_stylist_circle` (o placar mensal e o
           scorecard), só sem o corte de período. -->
      <div class="id-grupo cv-grupo-encontros pd-menor">
        <h3 class="cv-etiqueta cv-etiqueta-interna id-titulo"><icone-do-bloco nome="relogio" />Cadência</h3>
        <div class="cv-numeros cv-numeros-placar">
          <div class="cv-numero">
            <span class="cv-numero-valor">{{ placar.intervalos ? `${formatarDias(placar.intervalo_medio_em_dias)}` : '—' }}</span>
            <span class="cv-numero-rotulo">Intervalo entre encontros</span>
            <span class="cv-numero-base">{{ placar.intervalos ? `média de ${placar.intervalos} intervalo(s)` : 'sem base ainda' }}</span>
          </div>
          <div class="cv-numero">
            <span class="cv-numero-valor">{{ placar.contatos_ate_ativar ?? '—' }}</span>
            <span class="cv-numero-rotulo">Contatos até ativar</span>
            <span class="cv-numero-base">{{ placar.stylists_com_contatos_ate_ativar
              ? `média de ${placar.stylists_com_contatos_ate_ativar} stylist(s)` : 'sem base ainda' }}</span>
          </div>
        </div>
      </div>

      <div class="id-grupo cv-grupo-encontros pd-menor">
        <h3 class="cv-etiqueta cv-etiqueta-interna id-titulo"><icone-do-bloco nome="encontros" />Os encontros e as convidadas</h3>
        <div class="cv-numeros cv-numeros-placar">
          <div class="cv-numero">
            <span class="cv-numero-valor">{{ placar.encontros_agendados }}</span>
            <span class="cv-numero-rotulo">Encontros agendados</span>
            <span class="cv-numero-base">{{ placar.encontros_cancelados }} cancelado(s) ou não realizado(s)</span>
          </div>
          <div class="cv-numero">
            <span class="cv-numero-valor">{{ placar.encontros_realizados }}</span>
            <span class="cv-numero-rotulo">Realizados</span>
            <span class="cv-numero-base">{{ taxas.realizacao.temBase ? `${taxaEscrita(taxas.realizacao)} dos agendados` : 'nenhum agendado ainda' }}</span>
          </div>
          <div class="cv-numero">
            <span class="cv-numero-valor">{{ placar.convidadas }}</span>
            <span class="cv-numero-rotulo">Convidadas</span>
          </div>
          <div class="cv-numero">
            <span class="cv-numero-valor">{{ placar.confirmadas }}</span>
            <span class="cv-numero-rotulo">Confirmadas</span>
            <span class="cv-numero-base">inclui quem confirmou e faltou</span>
          </div>
          <div class="cv-numero">
            <span class="cv-numero-valor">{{ placar.presentes }}</span>
            <span class="cv-numero-rotulo">Presentes</span>
            <span class="cv-numero-base">{{ legendaDaTaxa('showRate', taxas.showRate) }}</span>
            <span v-if="margemEscrita(taxas.showRate)" class="cv-numero-margem">{{ margemEscrita(taxas.showRate) }}</span>
          </div>
          <div class="cv-numero">
            <span class="cv-numero-valor">{{ emPorcento(taxas.showRate.valor) }}</span>
            <span class="cv-numero-rotulo">Comparecimento</span>
            <span class="cv-numero-base">{{ taxas.showRate.temBase ? `${taxas.showRate.x} de ${taxas.showRate.n} confirmadas em realizados` : 'nenhum encontro realizado ainda' }}</span>
            <meta-do-numero :meta="metaDoComparecimento(taxas.showRate)" />
          </div>
        </div>
      </div>

      <p class="cv-nota">
        Cada número usa a sua data: <b>prospectadas</b> pela data da
        prospecção; <b>ativadas</b> pelo dia em que a parceira chegou pela
        primeira vez numa etapa que libera Private Edit; <b>com Private Edit
        agendado</b> pelo dia do primeiro encontro agendado; <b>com Private
        Edit realizado</b> pelo dia do primeiro realizado; e <b>encontros e
        convidadas</b> pelo dia do encontro. As taxas de baixo de cada passo
        olham uma turma só: das prospectadas desta edição, quantas chegaram
        àquele passo, sobre as que chegaram ao anterior — por isso elas não
        batem com a divisão dos números grandes, e nunca passam de 100%. A
        taxa de <b>presentes</b> conta só as confirmadas de encontros que
        aconteceram: quem confirmou para um encontro cancelado nunca pôde ir.
        <b>Agendados</b> inclui os que depois caíram — eles chegaram a ter
        data, e tirá-los faria a taxa de realização subir justamente quando a
        operação cancela.
      </p>
      <p class="cv-nota">
        <b>A meta de comparecimento é a do plano, fixa:</b> 70% ou mais
        (verde; de 60% a 69% âmbar; abaixo, vermelho). Sem encontro realizado,
        a meta fica "sem base ainda", sem cor.
      </p>
      <p class="cv-nota">
        <b>Este placar é da edição escolhida</b>, e nunca soma com a de outra
        praça: uma edição encerrada continua contando as mesmas stylists que
        estavam nela quando encerrou — encerrar não move ninguém de etapa.
        <b>Sem receita nenhuma aqui:</b> o panorama de compras está congelado,
        e mostrar zero seria mentir.
      </p>
    </template>
  </section>
</template>

<script setup>
/* O PLACAR DA EDIÇÃO (25/09/2026, Task 7) — extraído de
 * `tela-de-stylist-circle.vue` (que tinha 66 KB). Antes o placar era mensal
 * (período escolhido na própria tela); agora é SEMPRE de uma edição — a
 * barra `barra-de-praca-e-edicao.vue` decide qual.
 *
 * ⚠️ SEM RECEITA NENHUMA: `vessel_placar_da_edicao` não traz `receita`,
 * `vendas`, `compradoras` nem `pecas` — o panorama de compras está
 * congelado (decisão do dono). As três razões de dinheiro de
 * `taxasDoPlacar` (t11-regras.js) já ficam sem base nesse caso — testado em
 * t11-regras.test.mjs — mas este componente nem tenta lê-las, de propósito:
 * uma tela que ficasse "sem base ainda" para sempre em seis campos seria
 * pior do que a tela simplesmente não perguntar.
 *
 * ⚠️ O ÚNICO QUE FICOU PARA TRÁS (rodada 1 de conserto trouxe intervalo e
 * contatos até ativar de volta — ver `Cadência`, abaixo): a taxa de
 * repetição "até o fim do período". Ela não tem mais campo na resposta
 * porque o passo "Recorrentes" da sequência já cobre o assunto, com outro
 * denominador (das que chegaram a "com Private Edit realizado", não das
 * "ativadas até o fim") — decisão registrada no relatório da tarefa.
 *
 * ⚠️ SEM PRAÇA/EDIÇÃO ESCOLHIDA (decisão 1 do dono): o placar NUNCA soma
 * edição de praça diferente. Mostra uma linha por praça com edição aberta —
 * `pracasAbertas`, montada pela tela (que já lê `vessel_edicoes_listar` por
 * praça) — e escolher uma emite `escolher` para a tela mudar a barra.
 */
import { computed } from 'vue'
import IconeDoBloco from '../../compartilhado/icone-do-bloco.vue'
import MetaDoNumero from './meta-do-numero.vue'
import { rotuloDaPraca } from './praca-regras.js'
import { rotuloCurtoDaEdicao, SITUACOES_DA_EDICAO } from './edicao-regras.js'
import { taxasDoPlacar, sequenciaDoPlacar, taxaDoPasso, legendaDaTaxa } from './t11-regras.js'
import { taxaEscrita, margemEscrita, emPorcento } from './estatistica.js'
import { metaDoComparecimento } from './qualificacao-regras.js'

const props = defineProps({
  edicaoId: { type: [Number, String], default: null },
  placar: { type: Object, default: null },
  carregando: { type: Boolean, default: false },
  erro: { type: String, default: '' },
  pracasAbertas: { type: Array, default: () => [] },
  carregandoPracasAbertas: { type: Boolean, default: false },
  erroPracasAbertas: { type: String, default: '' },
})
defineEmits(['escolher'])

const taxas = computed(() => taxasDoPlacar(props.placar))
const sequencia = computed(() => sequenciaDoPlacar(props.placar))

const quantasStylists = (n) => (n === 1 ? '1 stylist' : `${n || 0} stylists`)
// ⚠️ RODADA 1 DE CONSERTO (IMPORTANTE 4): a mesma escrita do placar mensal
// (tela-de-stylist-circle.vue, antes da extração) para o intervalo médio.
const formatarDias = (n) => `${Number(n).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} dias`
function corDaSituacao(s) {
  if (s === 'aberta') return 'selo-ok'
  if (s === 'encerrada') return 'selo-neutro'
  return 'selo-info' // planejada
}
</script>

<style scoped>
@import './estilo-comercial.css';
@import '../../estilos/identidade-da-ferramenta.css';

/* "Num bloco menor" (decisão 2): a taxa da turma não compete com a caixa
   grande de cima — o mesmo `cv-numero`, com o número num degrau abaixo. */
.pd-menor .cv-numero-valor { font-size: var(--texto-titulo); }

.pd-abertas { list-style: none; margin: var(--sp-3) 0 0; padding: 0; display: flex; flex-direction: column; gap: var(--sp-2); }
.pd-abertas-linha {
  width: 100%; display: flex; flex-direction: column; align-items: flex-start; gap: var(--sp-1);
  text-align: left; min-height: 40px; padding: var(--sp-2) var(--sp-3);
}
.pd-abertas-nome { font-family: var(--fonte-principal); font-size: var(--texto-campo); color: var(--text); overflow-wrap: anywhere; }
</style>
