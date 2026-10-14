// O CLIENTE DO SELO VESSEL pela API em Go (5.10, Plano 7).
//
// A tela de Autenticidade fala com o banco por `sbClient.from('vessel_*')` e `sbClient.rpc('vessel_*')` em
// dezenas de sítios, e há guardas de teste que leem o texto deles. Em vez de reescrevê-los, a tela troca o
// `sbClient` por este: com a chave `autenticidade` desligada é o MESMO supabase-js; ligada, `from` vai pela
// ponte (rota do selo) e `rpc` pela lista branca da API.
import { areaNaApi, rpcNaArea } from '../../compartilhado/api.js'
import { deOnde } from '../../compartilhado/banco-pela-api.js'

// `rpcNaArea` entrega o 403 do portão como erro cuja `message` é a frase pedida; sem frase do servidor
// ela é este marcador.
export const SEM_FRASE = 'sem_permissao'

/**
 * No Supabase, 40 das funções do selo recusavam quem não tem a ferramenta com `200 { ok:false,
 * motivo:'sem_permissao' }`, e as telas já tratam isso (`fraseDaRecusa`). A API responde `403
 * {error:'sem_permissao'}`: aqui ele volta a ser o `ok:false` de sempre. O 403 COM frase ("Quem entrou como
 * outra pessoa só consulta.") NÃO vira recusa de permissão: segue erro, e a frase chega à pessoa.
 */
export function recusaDoPortao(r) {
  if (r?.error?.status === 403 && r.error.message === SEM_FRASE) {
    return { data: { ok: false, motivo: 'sem_permissao' }, error: null }
  }
  return r
}

export function clienteDoSelo(sbClient) {
  return new Proxy(sbClient, {
    get(alvo, chave) {
      if (chave === 'from') return (tabela) => deOnde(alvo).from(tabela)
      if (chave === 'rpc') {
        return async (nome, args) => (areaNaApi('autenticidade')
          ? recusaDoPortao(await rpcNaArea('autenticidade', alvo, nome, args, SEM_FRASE))
          : alvo.rpc(nome, args))
      }
      const v = alvo[chave]
      return typeof v === 'function' ? v.bind(alvo) : v
    },
  })
}
