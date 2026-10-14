import { ref } from 'vue'
import { sbClient } from '../../compartilhado/conectar-no-banco-de-dados.js'
// Chave `fabrica` (Plano 7): `fabrica-candidatos` pela API em Go (5.8, Task 7).
import { invocarNaArea } from '../../compartilhado/api.js'
export function useCandidatos() {
  const candidatos = ref([]); const carregando = ref(false); const erro = ref(null)
  async function buscar({ lojas, fonte, filtros }) {
    carregando.value = true; erro.value = null
    const { data, error } = await invocarNaArea('fabrica', sbClient, 'fabrica-candidatos', { body: { lojas, fonte, filtros } })
    carregando.value = false
    if (error) { erro.value = error.message; candidatos.value = []; return }
    candidatos.value = data?.candidatos || []
  }
  return { candidatos, carregando, erro, buscar }
}
