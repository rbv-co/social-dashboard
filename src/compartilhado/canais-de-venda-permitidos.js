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
