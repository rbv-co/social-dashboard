// Bling no coletor: TODA chamada ao Bling vai pelo PROXY do `core` (POST /api/interno/bling/proxy, Bearer
// CORE_API_TOKEN). O core é o único que fala com o Bling, renova o token (o refresh é rotativo: dois renovadores
// derrubam a produção) e controla a cota (150 req/min). Nenhum robô lê ou renova `bling_tokens`.
// Sem `CORE_BLING_PROXY=true` não há caminho antigo: `token()` e `fetch()` LANÇAM na primeira chamada (plano 05 C).
// Toda a lógica mora em `supabase/functions/_shared/core-bling-proxy.js` (`blingPeloCore`), a mesma das edges.
// Config: CORE_BLING_PROXY, CORE_API_TOKEN, CORE_URL (padrão https://core.rbvcompany.com).
// Os GETs saem com prioridade `sync` (a faixa de menor prioridade do gate do core).
import { blingPeloCore, ligada } from '../../supabase/functions/_shared/core-bling-proxy.js';

export function blingDoColetor(env = process.env, extra) {
  if (ligada(env)) return blingPeloCore(env, extra);
  // Lança só no uso (não no import): os testes importam os robôs sem o ambiente de produção.
  const recusa = async () => { throw new Error('CORE_BLING_PROXY=true é obrigatório: o coletor não tem mais caminho próprio até o Bling nem lê bling_tokens'); };
  return { ligada: false, token: recusa, fetch: recusa };
}
