import { createClient } from 'jsr:@supabase/supabase-js@2';
import { metaDoCore } from '../_shared/core-meta.js';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const META_GRAPH = 'https://graph.facebook.com/v22.0';
// CORE_META=true: o token (global) e a ida à Graph ficam no `core`; esta função continua sendo a porta autenticada
// (sessão + permissão `meta`) e NÃO lê accounts.access_token. Desligada, tudo igual a antes. Ver _shared/core-meta.js.
const META = metaDoCore(Deno.env.toObject());

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// De onde o `imageFromUrl` pode vir.
//
// Por que existe: o `imageFromUrl` chegava do corpo da requisição e ia direto num
// fetch(), sem nenhuma validação. Isso é SSRF — quem chama escolhe o que ESTE
// servidor vai buscar. Um atacante autenticado apontava para 169.254.169.254
// (metadados da cloud), para 127.0.0.1 ou para qualquer coisa dentro da rede, e o
// conteúdo voltava a ele (o proxy reenvia os bytes pro Meta e devolve a resposta).
//
// Na prática essa URL é SEMPRE um criativo do Storage deste projeto: 116 de 116
// linhas de `fabrica_criativos.url` apontam para o mesmo host. Então a lista é
// exatamente esse host, e nada mais. Fechar por lista de permitidos é melhor que
// tentar bloquear faixas de IP: com allow-list, o que não foi previsto é negado.
//
// Se um dia os criativos passarem a vir de outro lugar (CDN próprio, etc.),
// acrescente o host AQUI — senão o upload devolve 400.
const HOSTS_DE_IMAGEM_PERMITIDOS = [
  new URL(SUPABASE_URL).host, // o Storage deste projeto
];

// Devolve a URL validada, ou null se não for aceitável.
// Vale para IMAGEM e para VÍDEO: a trava é sobre a ORIGEM, não sobre o tipo do
// arquivo. Quando o vídeo entrou (2026-08-03), a tentação foi passar `file_url`
// direto como parâmetro comum — o que faria a Meta buscar qualquer endereço que
// alguém mandasse, reabrindo pela porta dos fundos o que esta lista fechou.
function urlDeMidiaPermitida(bruta: unknown): URL | null {
  if (typeof bruta !== 'string' || !bruta) return null;
  let u: URL;
  try { u = new URL(bruta); } catch { return null; }
  if (u.protocol !== 'https:') return null;                 // sem http:, file:, data:, gopher:
  if (!HOSTS_DE_IMAGEM_PERMITIDOS.includes(u.host)) return null;
  return u;
}

// Com CORE_META ligada: mesmo contrato de entrada e de saída. A Graph volta tal qual ({error:{...}} + status).
// Erro do PRÓPRIO proxy volta como STRING (`{error:'...'}`), porque o gestor classifica por aí (tela-de-gestao-trafego
// `naoChegouNaMeta`): barrado antes da Meta = status < 500; desistiu no meio (rede core->Meta, core fora) = 500.
async function viaCore(svc: any, p: any, json: (b: unknown, s?: number) => Response) {
  const { data: acc } = await svc.from('accounts').select('id').eq('id', p.accountId).single();
  if (!acc) return json({ error: 'conta nao encontrada' }, 400);
  if (p.imageFromUrl && !urlDeMidiaPermitida(p.imageFromUrl)) return json({ error: 'origem da imagem nao permitida' }, 400);
  if (!p.imageFromUrl && p.videoFromUrl && !urlDeMidiaPermitida(p.videoFromUrl)) return json({ error: 'origem do video nao permitida' }, 400);
  const parametros: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(p.params || {})) if (v !== undefined && v !== null) parametros[k] = v;
  const metodo = (p.imageFromUrl || (p.videoFromUrl && !p.imageFromUrl)) ? 'POST'
    : (typeof p.method === 'string' && ['GET', 'POST', 'DELETE'].includes(p.method.toUpperCase())) ? p.method.toUpperCase() : 'GET';
  const corpo: Record<string, unknown> = { caminho: p.path, metodo, parametros };
  if (p.imageFromUrl) {
    corpo.imagem_url = p.imageFromUrl;
    if (typeof p.imageField === 'string' && p.imageField) corpo.imagem_campo = p.imageField;
  } else if (p.videoFromUrl) corpo.video_url = p.videoFromUrl;
  // Sem retry de recuo aqui: o gestor e os robôs já tentam de novo; esperar dentro da edge só seguraria a tela.
  const ms = p.imageFromUrl ? 45000 : p.videoFromUrl ? 75000 : 25000;
  const { status, json: j, retryAfter } = await META.chamar(corpo, { signal: AbortSignal.timeout(ms), tentativas: 1 });
  if (j && typeof j === 'object' && 'erro' in j) {                       // erro do core, não da Graph
    const msg = String(j.erro);
    const barrado = status >= 400 && status < 500 && status !== 401 && status !== 403;
    const r = json({ error: msg }, barrado ? status : 500);
    if (status === 429 && retryAfter) r.headers.set('Retry-After', String(retryAfter));
    return r;
  }
  if (j && typeof j === 'object' && !('error' in j) && status >= 400) return json({ error: `core: ${status}` }, status < 500 && status !== 401 && status !== 403 ? status : 500);
  return json(j, status);
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  try {
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

    const { accountId, path, params, method, imageFromUrl, imageField, videoFromUrl } = await req.json();
    if (!accountId || !path) return json({ error: 'accountId e path obrigatorios' }, 400);

    if (META.ligada) return await viaCore(svc, { accountId, path, params, method, imageFromUrl, imageField, videoFromUrl }, json);

    const { data: acc, error: accErr } = await svc.from('accounts').select('access_token').eq('id', accountId).single();
    if (accErr || !acc?.access_token) return json({ error: 'conta sem token' }, 400);

    // NOVO: upload de imagem por bytes (multipart) a partir de uma URL publica.
    // Usado pra /act_<id>/adimages sem estourar a query string. Retrocompativel:
    // so dispara quando imageFromUrl vem no body.
    if (imageFromUrl) {
      // Só busca de host da lista. Ver HOSTS_DE_IMAGEM_PERMITIDOS lá em cima.
      const urlDaImagem = urlDeMidiaPermitida(imageFromUrl);
      if (!urlDaImagem) return json({ error: 'origem da imagem nao permitida' }, 400);
      // redirect:'error' fecha o desvio óbvio: um host permitido que responda 302
      // apontando pra rede interna reabriria o SSRF que a lista acabou de fechar.
      const imgResp = await fetch(urlDaImagem.toString(), { redirect: 'error' });
      if (!imgResp.ok) return json({ error: 'falha ao baixar imagem: ' + imgResp.status }, 400);
      const blob = await imgResp.blob();
      const field = (typeof imageField === 'string' && imageField) ? imageField : 'img0';
      const form = new FormData();
      for (const [k, v] of Object.entries(params || {})) {
        if (v === undefined || v === null) continue;
        form.append(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
      }
      form.append(field, blob, field + '.png');
      const upUrl = new URL(META_GRAPH + path);
      upUrl.searchParams.set('access_token', acc.access_token);
      const ctrlU = new AbortController();
      const timerU = setTimeout(() => ctrlU.abort(), 30000);
      try {
        const resp = await fetch(upUrl.toString(), { method: 'POST', body: form, signal: ctrlU.signal });
        const text = await resp.text();
        let data; try { data = JSON.parse(text); } catch { data = { raw: text }; }
        return json(data, resp.status);
      } finally { clearTimeout(timerU); }
    }

    // VÍDEO: quem baixa é a META, e não nós.
    //
    // Imagem vai por multipart (nós buscamos os bytes e repassamos). Vídeo não
    // pode ir pelo mesmo caminho: um arquivo de dezenas de MB carregado na
    // memória desta função estouraria o limite dela — e o download somado ao
    // upload estouraria o tempo. `file_url` é o caminho que a própria Meta
    // oferece: mandamos o endereço e ela busca.
    //
    // A MESMA TRAVA DE ORIGEM continua valendo. Sem ela, `file_url` seria um
    // jeito de fazer a Meta buscar qualquer endereço — inclusive interno — que
    // alguém mandasse no corpo. Só o Storage deste projeto entra.
    if (videoFromUrl) {
      const urlDoVideo = urlDeMidiaPermitida(videoFromUrl);
      if (!urlDoVideo) return json({ error: 'origem do video nao permitida' }, 400);
      const upUrl = new URL(META_GRAPH + path);
      upUrl.searchParams.set('access_token', acc.access_token);
      upUrl.searchParams.set('file_url', urlDoVideo.toString());
      for (const [k, v] of Object.entries(params || {})) {
        if (v === undefined || v === null) continue;
        upUrl.searchParams.set(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
      }
      // 60 s, e não 15: a Meta baixa o arquivo ANTES de responder, e vídeo
      // demora. O tempo curto dava erro de rede num upload que ia dar certo.
      const ctrlV = new AbortController();
      const timerV = setTimeout(() => ctrlV.abort(), 60000);
      try {
        const resp = await fetch(upUrl.toString(), { method: 'POST', signal: ctrlV.signal });
        const text = await resp.text();
        let data; try { data = JSON.parse(text); } catch { data = { raw: text }; }
        return json(data, resp.status);
      } finally { clearTimeout(timerV); }
    }

    const url = new URL(META_GRAPH + path);
    url.searchParams.set('access_token', acc.access_token);
    for (const [k, v] of Object.entries(params || {})) {
      if (v === undefined || v === null) continue;
      url.searchParams.set(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
    }
    const httpMethod = (typeof method === 'string' && ['GET','POST','DELETE'].includes(method.toUpperCase())) ? method.toUpperCase() : 'GET';
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15000);
    try {
      const resp = await fetch(url.toString(), { method: httpMethod, signal: ctrl.signal });
      const text = await resp.text();
      let data; try { data = JSON.parse(text); } catch { data = { raw: text }; }
      return json(data, resp.status);
    } finally { clearTimeout(timer); }
  } catch (err) {
    return json({ error: String(err) }, 500);
  }
});
