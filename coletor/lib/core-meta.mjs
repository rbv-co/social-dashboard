// Graph da Meta no coletor: com `CORE_META=true` tudo passa pelo proxy do `core` (token global,
// sem `accounts.access_token`, sem renovar token Meta). Desligada, `fetch` é o `fetch` de sempre.
// Toda a lógica mora em `supabase/functions/_shared/core-meta.js`, a mesma das edges.
// Config: CORE_META, CORE_API_TOKEN, CORE_URL (padrão https://core.rbvcompany.com).
import { metaDoCore } from '../../supabase/functions/_shared/core-meta.js';

export const metaDoColetor = (env = process.env, extra) => metaDoCore(env, extra);
