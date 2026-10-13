<script setup>
import { computed, ref } from 'vue'
import { sbClient } from '../../compartilhado/conectar-no-banco-de-dados.js'
// Chave `fabrica` (Plano 7): as edges da Fábrica (5.8) pela API.
import { invocarNaArea } from '../../compartilhado/api.js'
import { useJobStatus } from './use-job-status.js'
import AjudaTooltip from './ajuda-tooltip.vue'
import TourCoachmark from './tour-coachmark.vue'
import { TOUR_CONFERIR } from './tutorial-fabrica.js'
const tourAberto = ref(false)
const props = defineProps({ subirResultado: Object })
const n = computed(() => props.subirResultado?.adIds?.length || 0)
const { job, start } = useJobStatus()
const { job: jobExc, start: startExc } = useJobStatus() // job separado da exclusão
const gerenciador = 'https://adsmanager.facebook.com/adsmanager/'
// quantas campanhas esta remessa criou (só relevante quando criou campanha nova)
const nCampanhas = computed(() => {
  const r = props.subirResultado || {}
  if (!r.criouCampanha) return 0
  return (r.metaCampaignIds?.length) || (r.metaCampaignId ? 1 : 0)
})
const excluido = computed(() => jobExc.value?.status === 'concluido')
const ocupado = computed(() => [job.value, jobExc.value].some((j) => j && ['enfileirado', 'rodando'].includes(j.status)))
async function ativarTudo() {
  if (!confirm(`Ativar ${n.value} anúncios? Isso COMEÇA A GASTAR verba imediatamente.`)) return
  const { adIds, adsetIds, metaCampaignId, metaCampaignIds, criouCampanha } = props.subirResultado
  const { data, error } = await invocarNaArea('fabrica', sbClient, 'fabrica-trigger', { body: { tipo: 'ativar', params: { adIds, adsetIds, metaCampaignId, metaCampaignIds, criouCampanha } } })
  if (error) return alert('Falha: ' + error.message)
  if (!data?.job_id) return alert('Sem job_id na resposta')
  start(data.job_id)
}
// Excluir SÓ o que esta remessa criou: campanha nova → apaga a(s) campanha(s) (cascateia conjuntos/
// anúncios); campanha existente → apaga só os anúncios adicionados. Não toca em nada de fora.
async function excluirRemessa() {
  const r = props.subirResultado || {}
  const alvo = r.criouCampanha
    ? `${nCampanhas.value} campanha(s) desta remessa (com todos os conjuntos e anúncios dela)`
    : `os ${n.value} anúncios que esta remessa adicionou à campanha`
  if (!confirm(`Excluir ${alvo} na Meta?\n\nIsso APAGA DE VEZ — não dá pra desfazer. Campanhas e anúncios de FORA desta remessa não são tocados.`)) return
  const { adIds, adsetIds, metaCampaignId, metaCampaignIds, criouCampanha } = r
  const { data, error } = await invocarNaArea('fabrica', sbClient, 'fabrica-trigger', { body: { tipo: 'excluir', params: { adIds, adsetIds, metaCampaignId, metaCampaignIds, criouCampanha } } })
  if (error) return alert('Falha: ' + error.message)
  if (!data?.job_id) return alert('Sem job_id na resposta')
  startExc(data.job_id)
}
</script>
<template>
  <section class="stage">
    <TourCoachmark :passos="TOUR_CONFERIR" v-model="tourAberto" />
    <div class="stagehead">
      <span class="badge"><i class="led hold"></i>Passo 4 · Conferir</span>
      <h2>Confira antes de publicar <AjudaTooltip chave="conferir" /> <button class="mini" type="button" @click="tourAberto = true">Tutorial ▶</button></h2>
      <p class="lead"><b>{{ n }} anúncios</b> foram criados e estão <b>pausados</b>. Enquanto ficarem pausados, ninguém vê e <b>não gastam nada</b>. Você decide como publicar.</p>
    </div>

    <div class="readout" data-tour="conferir-resumo">
      <div class="c"><div class="k">Anúncios criados</div><div class="v mono amber">{{ n }}</div></div>
      <div class="c"><div class="k">Situação</div><div class="v hold">Pausado</div></div>
    </div>

    <section class="launch" v-if="!excluido">
      <h3>Como você quer publicar?</h3>
      <p class="sh">Escolha uma opção:</p>
      <div class="opts">
        <a :href="gerenciador" target="_blank" class="opt manter">
          <span class="oh"><span class="oi">⏸</span> Manter pausados <span class="rec">recomendado</span></span>
          <span class="od">Deixa tudo como está. Você liga cada anúncio na hora que quiser, direto no Gerenciador da Meta. Nada gasta até você ligar.</span>
        </a>
        <button class="opt ativar" data-tour="conferir-ativar" :disabled="job && ['enfileirado','rodando'].includes(job.status)" @click="ativarTudo">
          <span class="oh"><span class="oi">▶</span> Ativar todos agora</span>
          <span class="od">Liga os {{ n }} anúncios de uma vez. Eles começam a aparecer para as pessoas — e a gastar verba — na hora.</span>
        </button>
      </div>
      <div class="aviso">
        <span>⚠️</span>
        <span><b>Ativar todos</b> começa a gastar dinheiro imediatamente. Antes de executar, o sistema pergunta “tem certeza?” pra evitar clique sem querer.</span>
      </div>

      <div v-if="job" class="jobstat launchstat">
        <i class="led" :class="job.status==='concluido' ? 'go' : job.status==='erro' ? 'abort' : ['enfileirado','rodando'].includes(job.status) ? 'run' : 'idle'"></i>
        <span>{{ ({ enfileirado:'Na fila…', rodando:'Ativando anúncios…', concluido:'Anúncios ativados.', erro:'Deu erro ao ativar.' })[job.status] || job.status }}</span>
        <span v-if="job.erro" class="js-err">— {{ job.erro }}</span>
      </div>
      <p v-if="job?.status==='concluido'" class="okline">✅ Ativado. {{ job.resultado?.ativados }} anúncios agora estão no ar.</p>

      <!-- Zona de perigo: apaga SÓ o que esta remessa criou (nada de fora é tocado) -->
      <div class="perigo">
        <div class="perigo-txt">
          <b>Não era isso?</b>
          <template v-if="subirResultado?.criouCampanha"> Você pode apagar {{ nCampanhas }} campanha(s) desta remessa (com todos os conjuntos e anúncios delas).</template>
          <template v-else> Você pode apagar os {{ n }} anúncios que esta remessa adicionou.</template>
          Só o que subiu agora — nada mais.
        </div>
        <button class="cmd danger" type="button" :disabled="ocupado" @click="excluirRemessa">🗑 Excluir esta remessa</button>
      </div>
      <div v-if="jobExc && ['enfileirado','rodando','erro'].includes(jobExc.status)" class="jobstat launchstat">
        <i class="led" :class="jobExc.status==='erro' ? 'abort' : 'run'"></i>
        <span>{{ ({ enfileirado:'Na fila…', rodando:'Excluindo na Meta…', erro:'Deu erro ao excluir.' })[jobExc.status] || jobExc.status }}</span>
        <span v-if="jobExc.erro" class="js-err">— {{ jobExc.erro }}</span>
      </div>
    </section>

    <section class="launch" v-else>
      <div class="subir-banner concluido"><div class="sb-body">
        <span class="sb-ic">🗑</span>
        <div><b>Remessa excluída na Meta.</b><div class="sb-sub">{{ jobExc.resultado?.excluidos }} item(ns) removido(s). Nada de fora desta remessa foi tocado — pode gerar/subir uma nova quando quiser.</div></div>
      </div></div>
    </section>
  </section>
</template>
