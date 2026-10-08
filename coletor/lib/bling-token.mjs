// Token do Bling no coletor: com `CORE_BLING_TOKEN=true` vem do `core` (cache ≤ 4 min,
// 401 → relê e tenta uma vez) e NENHUM robô renova. Desligada, `token(senao)` roda o
// caminho antigo (bling_tokens + refresh) e `fetch` é o `fetch` de sempre.
// Toda a lógica mora em `supabase/functions/_shared/core-bling-token.js`, a mesma das edges.
// Config: CORE_BLING_TOKEN, CORE_API_TOKEN, CORE_URL (padrão https://core.rbvcompany.com).
import { blingDoCore } from '../../supabase/functions/_shared/core-bling-token.js';

export const blingDoColetor = (env = process.env, extra) => blingDoCore(env, extra);
