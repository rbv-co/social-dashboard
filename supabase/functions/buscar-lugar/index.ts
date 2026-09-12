// A RECEPÇÃO DO MAPA — quem liga para o OpenStreetMap em nome da Central.
//
// POR QUE NÃO É O NAVEGADOR QUE LIGA (decisão do dono, 13/08/2026): o Nominatim
// é gratuito e comunitário, e a regra de uso deles pede que quem chama se
// identifique (User-Agent) e não dispare em rajada. Navegador não deixa definir
// User-Agent. Sem isto, no dia em que apertarem a regra a busca de lugar morre
// EM SILÊNCIO — e silêncio virando dado errado já custou 17 horas nesta casa.
//
// Ela faz três coisas e mais nenhuma:
//   1. se identifica;
//   2. guarda o que já perguntou (perguntar duas vezes não custa duas ligações);
//   3. é o ÚNICO lugar a mexer se um dia trocarmos de serviço de mapa.
//
// POR QUE ELA EXISTE E A META NÃO RESOLVE: medido em 13/08/2026, a busca da Meta
// (`adgeolocation` e `adgeolocationmeta`) NÃO devolve coordenada nenhuma, e
// `location_types:["place"]` para "Shopping" devolve lista vazia — ela não tem
// busca de estabelecimento.
import { createClient } from 'jsr:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;

const NOMINATIM = 'https://nominatim.openstreetmap.org';
// A identificação que a regra de uso deles pede. Trocar o e-mail aqui é trocar
// quem eles procuram se algo der errado — não é enfeite.
const QUEM_SOU = 'iamundi-central-inteligencia/1.0 (contato: erick@rbvcompany.com)';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Cache de processo, com validade. Não é banco de propósito: o volume é baixo
// (um punhado de buscas por sessão de edição) e tabela seria peso sem retorno.
// Se um dia o volume crescer, é AQUI que a tabela entra.
const cache = new Map<string, { quando: number; valor: unknown }>();
const VALIDADE_MS = 24 * 60 * 60 * 1000;
const TETO_DO_CACHE = 500;

function doCache(chave: string) {
  const achado = cache.get(chave);
  if (!achado) return null;
  if (Date.now() - achado.quando > VALIDADE_MS) { cache.delete(chave); return null; }
  return achado.valor;
}
function guardar(chave: string, valor: unknown) {
  if (cache.size >= TETO_DO_CACHE) cache.delete(cache.keys().next().value as string);
  cache.set(chave, { quando: Date.now(), valor });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  try {
    // MESMA PORTA DO meta-proxy: quem edita público já precisa passar por ela.
    const authHeader = req.headers.get('Authorization') || '';
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: 'nao autenticado' }, 401);

    const svc = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    const { data: prof } = await svc.from('profiles').select('role, features').eq('id', user.id).single();
    const allowed = !!prof && (prof.role === 'admin' || (Array.isArray(prof.features) && prof.features.includes('meta')));
    if (!allowed) return json({ error: 'sem permissao' }, 403);

    const { acao, termo, lat, lng } = await req.json();

    if (acao === 'buscar') {
      const q = String(termo || '').trim();
      if (q.length < 3) return json({ error: 'digite pelo menos 3 letras' }, 400);
      const chave = 'buscar:' + q.toLowerCase();
      const guardado = doCache(chave);
      if (guardado) return json({ lugares: guardado, doCache: true });

      // `countrycodes=br`: as sete contas anunciam no Brasil. Se um dia
      // anunciarem fora, é este parâmetro que sai — e não a busca inteira.
      const url = `${NOMINATIM}/search?format=jsonv2&addressdetails=1&limit=8`
        + `&countrycodes=br&q=${encodeURIComponent(q)}`;
      const r = await fetch(url, { headers: { 'User-Agent': QUEM_SOU, 'Accept-Language': 'pt-BR' } });
      if (!r.ok) return json({ error: `o servico de mapa respondeu ${r.status}` }, 502);
      const lugares = await r.json();
      guardar(chave, lugares);
      return json({ lugares });
    }

    if (acao === 'ondeCaiu') {
      const la = Number(lat); const ln = Number(lng);
      if (!Number.isFinite(la) || !Number.isFinite(ln)) return json({ error: 'coordenada invalida' }, 400);
      // Arredondar a chave em 5 casas (~1 metro) faz dois cliques no mesmo ponto
      // custarem uma ligação só.
      const chave = `ondeCaiu:${la.toFixed(5)},${ln.toFixed(5)}`;
      const guardado = doCache(chave);
      if (guardado) return json({ ...(guardado as object), doCache: true });

      const url = `${NOMINATIM}/reverse?format=jsonv2&addressdetails=1&lat=${la}&lon=${ln}`;
      const r = await fetch(url, { headers: { 'User-Agent': QUEM_SOU, 'Accept-Language': 'pt-BR' } });
      if (!r.ok) return json({ error: `o servico de mapa respondeu ${r.status}` }, 502);
      const lugar = await r.json();
      guardar(chave, lugar);
      return json(lugar);
    }

    return json({ error: 'acao desconhecida' }, 400);
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});
