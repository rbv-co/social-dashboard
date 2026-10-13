import { ref } from 'vue'
import { sbClient } from '../../compartilhado/conectar-no-banco-de-dados.js'
// Chave `fabrica` (Plano 7): o job pela API (5.8).
import { deOnde } from '../../compartilhado/banco-pela-api.js'

export function useJobStatus() {
  const job = ref(null)
  let timer = null
  async function tick(id) {
    const { data } = await deOnde(sbClient).from('fabrica_jobs').select('*').eq('id', id).single()
    job.value = data
    if (data && ['concluido', 'erro'].includes(data.status)) stop()
  }
  function start(id) { stop(); tick(id); timer = setInterval(() => tick(id), 3000) }
  function stop() { if (timer) { clearInterval(timer); timer = null } }
  return { job, start, stop }
}
