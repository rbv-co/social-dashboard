// Bling no coletor. Com `CORE_BLING_PROXY=true` TODA chamada ao Bling vai pelo PROXY do `core`
// (POST /api/interno/bling/proxy, Bearer CORE_API_TOKEN): o core é o único que fala com o Bling e
// controla a cota (150 req/min). Nenhum robô lê ou renova `bling_tokens`.
// Desligada (padrão): `blingDoCore` de sempre (CORE_BLING_TOKEN=true lê o token do core; senão
// `token(senao)` roda o caminho antigo e `fetch` é o `fetch` de sempre).
// Toda a lógica mora em `supabase/functions/_shared/core-bling-proxy.js` (`blingPeloCore`), a mesma das edges.
// Config: CORE_BLING_PROXY, CORE_BLING_TOKEN, CORE_API_TOKEN, CORE_URL (padrão https://core.rbvcompany.com).
// Os GETs saem com prioridade `sync` (a faixa de menor prioridade do gate do core).
import { blingPeloCore } from '../../supabase/functions/_shared/core-bling-proxy.js';

export const blingDoColetor = (env = process.env, extra) => blingPeloCore(env, extra);
