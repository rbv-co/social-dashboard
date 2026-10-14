// A ponte entre as TELAS e a regra de quais canais de venda a pessoa vê.
//
// A REGRA em si mora em `supabase/functions/_shared/canais-de-venda-permitidos.js`,
// porque a edge `bling-proxy` roda no Deno e não alcança `src/`. Desde 13/08/2026
// ela vale nos dois lados: a edge recorta a resposta do Bling antes de mandar, e
// a tela recorta o que desenha. Mesmo arranjo de `data-da-venda.js`, pelo mesmo
// motivo — duas cópias da mesma regra acabam discordando.
//
// Aqui não há lógica nenhuma de propósito: se um dia precisar de algo só do
// navegador, é aqui que entra, e não lá.
export {
  canaisDoEscopo,
  estaLimitada,
  filtrarPedidos,
  filtrarMapaDeCanais,
  fraseDoRecorte,
  recortarRespostaDoBling,
} from '../../supabase/functions/_shared/canais-de-venda-permitidos.js'

/* O RECORTE PELA API EM GO (Plano 7, chave `comercial`).
 *
 * `GET /eu/canais` devolve `{canais: null}` (vê todos) ou `{canais: [ids]}`: é a
 * MESMA regra de `canaisDoEscopo`, rodada no servidor (que já lê times, membros,
 * grupos e a conta de serviço). Aqui só se lê a resposta.
 *
 * FALHA CAI NO MESMO LADO SEGURO DA LEITURA ANTIGA: lá, times/membros vazios
 * faziam super-admin e quem não é limitado verem tudo (`null`) e quem é de time
 * ficar com `[]` — tela vazia com o motivo escrito, nunca o faturamento da
 * empresa inteira para quem não pode ver. Resposta fora do formato é falha. */
export function canaisDaApi({ data, error } = {}, { isSuperadmin, escopoPorEquipe } = {}) {
  const c = data && data.canais
  if (!error && data && (c === null || Array.isArray(c))) return c === null ? null : c.map(Number)
  return isSuperadmin || escopoPorEquipe !== true ? null : []
}
