// Coletor de Instagram oficial dos concorrentes via Instagram Graph "business_discovery".
// v2 (jun/2026): por marca gera TRÊS galerias de MARKETING — Top Viral (10 + engajados),
// Últimos Posts (10 recentes), Reels (10 vídeos recentes). Conteúdo AMPLO (não só bolsa),
// pra ler comportamento de marketing. Re-hospeda mídia (dedup) e logo no Storage (ig-cache).
import fs from 'fs';

const env = {};
try { for (const l of fs.readFileSync(new URL('./.env', import.meta.url), 'utf8').split('\n')) { const m = l.match(/^([A-Z_]+)=(.*)$/); if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, ''); } } catch (e) {}
const URL_SB = process.env.SUPABASE_URL || env.SUPABASE_URL || 'https://kounqtdoioootxqegkij.supabase.co';
const KEY = process.env.SUPABASE_SERVICE_KEY || env.SUPABASE_SERVICE_KEY;
const G = 'https://graph.facebook.com/v22.0';
const RODADA = process.env.RODADA || new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
const BUCKET = 'ig-cache';
const N = 10;               // itens por galeria
// Teto p/ re-hospedar vídeo. Acima dele o vídeo NÃO é copiado: o cartão fica com
// o pôster e o clique abre o Reels no Instagram (ver o `mediaBlock` em
// tela-de-noticias.vue, que já embrulha o pôster no link quando não há vídeo).
//
// ERA 25 E CAIU PRA 8 EM 19/08/2026, POR CAUSA DO ESPAÇO. O plano grátis do
// Supabase dá 1 GB de arquivos e o projeto estava em 876 MB (86%). Medindo os 60
// vídeos que o balde guardava (319 MB no total, quase 40% de TUDO):
//
//     teto   vídeos que ficam   viram pôster   peso do vídeo   economia
//      25         60 de 60            0           319 MB          --
//      12         54                  6           201 MB        118 MB
//      10         52                  8           180 MB        139 MB
//   ►   8         49                 11           154 MB        165 MB
//       6         46                 14           132 MB        187 MB
//       5         43                 17           115 MB        204 MB
//       4         36                 24            82 MB        237 MB
//
// 8 é o joelho da curva: economiza 165 MB perdendo 11 vídeos dos 60 (18%).
// Descer mais paga cada vez menos e custa cada vez mais Reels. Só QUATRO vídeos
// pesavam 92 MB sozinhos — são eles que este teto corta.
//
// Este número é pra ser mexido: se o balde voltar a apertar, a tabela acima diz
// exatamente o que cada degrau custa. Refazer a conta é uma consulta em
// storage.objects filtrando mimetype video/mp4.
const VID_MAX_MB = 8;

const HANDLES = {
  'Santa Lolla': ['santa_lolla', 'santalolla', 'santalollaoficial'],
  'Arezzo&Co': ['arezzo'],
  'Schutz': ['schutzoficial', 'schutz'],
  'Anacapri': ['anacapri', 'anacaprioficial', 'useanacapri'],
  'Capodarte': ['capodarte'],
  'Luz da Lua': ['luzdalua', 'luzdaluaoficial'],
  'Petite Jolie': ['petitejolie_', 'petitejolie', 'petitejolieoficial'],
  'Jorge Bischoff': ['jorgebischoff', 'jorgebischoffoficial'],
  'Dumond': ['dumondcalcados', 'dumond', 'dumondoficial'],
  'Carmen Steffens': ['carmensteffens'],
  // novas
  'Isla': ['isla_oficial', 'islaoficial', 'isla'],
  'Luiza Barcelos': ['luizabarcelos', 'luizabarcelosoficial'],
  'Victor Hugo': ['victorhugo_oficial', 'victorhugooficial', 'victorhugo'],
  "L'Occitane": ['loccitane_br', 'loccitanebrasil', 'loccitane', 'loccitanebr'],
};

const sbHeaders = { apikey: KEY, Authorization: 'Bearer ' + KEY };
async function rest(method, path, body) {
  const r = await fetch(URL_SB + '/rest/v1/' + path, { method, headers: { ...sbHeaders, 'Content-Type': 'application/json', Prefer: 'return=representation' }, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text(); if (!r.ok) throw new Error(method + ' ' + path + ' → ' + r.status + ' ' + t.slice(0, 200)); return t ? JSON.parse(t) : null;
}
const clean = s => String(s || '').replace(/\p{Cc}/gu, ' ').replace(/\s+/g, ' ').trim();
const cut = (s, n) => Array.from(s).slice(0, n).join('');
const eng = m => (Number(m.like_count) || 0) + (Number(m.comments_count) || 0);

const accs = await (await fetch(URL_SB + '/rest/v1/accounts?select=access_token', { headers: sbHeaders })).json();
const tok = (accs.find(a => a.access_token) || {}).access_token;
if (!tok) throw new Error('sem token Meta');
const graph = async (path, params = {}) => {
  const u = new URL(G + path); u.searchParams.set('access_token', tok);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, typeof v === 'object' ? JSON.stringify(v) : v);
  return (await fetch(u)).json();
};
const pages = await graph('/me/accounts', { fields: 'instagram_business_account{id}' });
const igId = (pages.data || []).map(p => p.instagram_business_account && p.instagram_business_account.id).find(Boolean);
if (!igId) throw new Error('sem IG business account no token');

await fetch(URL_SB + '/storage/v1/bucket', { method: 'POST', headers: { ...sbHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify({ id: BUCKET, name: BUCKET, public: true }) }).catch(() => {});

async function rehost(srcUrl, path, contentType = 'image/jpeg', maxMB = 0) {
  try {
    const r = await fetch(srcUrl, { signal: AbortSignal.timeout(maxMB ? 60000 : 20000) });
    if (!r.ok) return null;
    const len = Number(r.headers.get('content-length') || 0);
    if (maxMB && len && len > maxMB * 1024 * 1024) return null;
    const buf = new Uint8Array(await r.arrayBuffer());
    if (maxMB && buf.length > maxMB * 1024 * 1024) return null;
    const up = await fetch(`${URL_SB}/storage/v1/object/${BUCKET}/${path}`, { method: 'POST', headers: { ...sbHeaders, 'Content-Type': contentType, 'x-upsert': 'true' }, body: buf });
    if (!up.ok) return null;
    return `${URL_SB}/storage/v1/object/public/${BUCKET}/${path}`;
  } catch (e) { return null; }
}

const MEDIA = 'media.limit(50){id,caption,like_count,comments_count,media_type,media_url,thumbnail_url,permalink,timestamp}';
const GAL = [
  { cat: 'Top Viral', titulo: 'O Que Mais Viralizou', pick: ms => ms.slice().sort((a, b) => eng(b) - eng(a)).slice(0, N) },
  { cat: 'Últimos Posts', titulo: 'Últimos Posts', pick: ms => ms.slice().sort((a, b) => String(b.timestamp || '').localeCompare(String(a.timestamp || ''))).slice(0, N) },
  { cat: 'Reels', titulo: 'Reels do Momento', pick: ms => ms.filter(m => m.media_type === 'VIDEO').sort((a, b) => String(b.timestamp || '').localeCompare(String(a.timestamp || ''))).slice(0, N) },
];

const rows = [];
const logos = {};
for (const [marca, handles] of Object.entries(HANDLES)) {
  let bd = null, handle = null, lastErr = '';
  for (const h of handles) {
    const res = await graph('/' + igId, { fields: `business_discovery.username(${h}){username,followers_count,media_count,profile_picture_url,${MEDIA}}` });
    if (res && res.business_discovery) { bd = res.business_discovery; handle = res.business_discovery.username || h; break; }
    lastErr = res && res.error ? (res.error.message || JSON.stringify(res.error)) : 'sem dados';
  }
  if (!bd) { console.log(`${marca}: handle não encontrado (${handles.join('/')}) — ${lastErr.slice(0, 130)}`); continue; }
  const media = (bd.media && bd.media.data) || [];
  const seg = Number(bd.followers_count) || 0;
  const fonte = '@' + handle + ' · ' + seg.toLocaleString('pt-BR') + ' seguidores';

  // logo (profile pic) re-hospedado — usado no NP_LOGOS do front
  if (bd.profile_picture_url) {
    const lg = await rehost(bd.profile_picture_url, `logo/${handle}.jpg`);
    if (lg) logos[marca] = lg;
  }

  // cache de re-hospedagem por id de mídia (dedup entre as 3 galerias)
  const cache = new Map();
  async function media2prod(m) {
    if (cache.has(m.id)) return cache.get(m.id);
    const isVid = m.media_type === 'VIDEO';
    const poster = m.thumbnail_url || (isVid ? null : m.media_url);
    const imgPub = poster ? await rehost(poster, `${handle}/${m.id}.jpg`) : null;
    const vidPub = (isVid && m.media_url) ? await rehost(m.media_url, `${handle}/${m.id}.mp4`, 'video/mp4', VID_MAX_MB) : null;
    const prod = (imgPub || vidPub) ? { nome: cut(clean(m.caption), 1500), img: imgPub, video: vidPub, url: m.permalink, curtidas: m.like_count ?? null, comentarios: m.comments_count ?? null, tipo: isVid ? 'video' : 'imagem' } : null;
    cache.set(m.id, prod);
    return prod;
  }

  let galN = 0;
  for (const g of GAL) {
    const picks = g.pick(media);
    if (!picks.length) continue;
    const produtos = [];
    for (const m of picks) { const p = await media2prod(m); if (p) produtos.push(p); }
    if (!produtos.length) continue;
    rows.push({
      marca, titulo: g.titulo, resumo: null, categoria: g.cat,
      url: 'https://www.instagram.com/' + handle, fonte,
      data_publicacao: RODADA, rodada: RODADA, destaque: false, imagem_url: produtos[0].img, produtos,
    });
    galN++;
  }
  console.log(`${marca} (@${handle}): ${galN} galerias · ${seg.toLocaleString('pt-BR')} seg.${logos[marca] ? ' · logo ok' : ''}`);
}

fs.writeFileSync('/tmp/ig_rows.json', JSON.stringify(rows));
fs.writeFileSync('/tmp/ig_logos.json', JSON.stringify(logos, null, 2));
console.log('\nLOGOS (p/ NP_LOGOS no front):'); console.log(JSON.stringify(logos, null, 2));

// limpa galerias de IG (antigas 'Instagram' + as 3 novas) desta rodada e regrava
const CATS = ['Instagram', 'Top Viral', 'Últimos Posts', 'Reels'];
for (const marca of [...new Set(rows.map(r => r.marca))]) {
  for (const c of CATS) await rest('DELETE', `noticias_concorrentes?marca=eq.${encodeURIComponent(marca)}&rodada=eq.${RODADA}&categoria=eq.${encodeURIComponent(c)}`);
}
let ok = 0;
try { ok = (await rest('POST', 'noticias_concorrentes', rows)).length; }
catch (e) {
  console.log('bulk falhou, inserindo 1 a 1:', String(e).slice(0, 120));
  for (const row of rows) { try { await rest('POST', 'noticias_concorrentes', [row]); ok++; } catch (e2) { console.log('  FALHOU', row.marca, row.categoria, '→', String(e2).slice(0, 140)); } }
}
console.log(`\nInseridas ${ok}/${rows.length} galerias de Instagram (3 por marca).`);
