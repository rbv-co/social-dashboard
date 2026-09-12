// A ponte entre as TELAS e a regra do grupo do canal (atacado / varejo).
//
// A REGRA em si mora em `supabase/functions/_shared/grupo-do-canal.js`, porque a
// edge `bling-proxy` também precisa dela — desde a Peça 3 o alcance da
// supervisora depende do grupo, e a edge roda no Deno, que não alcança `src/`.
// Mesmo arranjo de `canais-de-venda-permitidos.js` e de `data-da-venda.js`, pelo
// mesmo motivo: duas cópias da mesma regra acabam discordando.
//
// Aqui não há lógica nenhuma de propósito.
export {
  normalizarGrupo,
  mesmoGrupo,
  gruposExistentes,
  agruparCanais,
  agruparTimesPorGrupo,
  timePorCanal,
  contarSemGrupo,
  estadoDoGrupo,
  alternarGrupo,
} from '../../supabase/functions/_shared/grupo-do-canal.js'
