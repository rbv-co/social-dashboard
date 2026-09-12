import { createClient } from 'jsr:@supabase/supabase-js@2';
import { exigirSegredoDeCron } from '../_shared/segredo-de-cron.ts';
// O guarda da leitura de engajamento mora fora daqui, puro e com teste ao lado
// (leitura-de-engajamento.test.mjs). Antes eram `bdSum`/`bdBroken`/`engOk`
// soltas neste arquivo, onde não havia como testá-las sem Deno e sem a Meta —
// e foi exatamente ali que passou o bug das curtidas zeradas.
import { somaDoDetalhe, leituraParcial, leituraServe } from '../_shared/leitura-de-engajamento.js';
// Mesma ideia, para o bruto de seguidores: separar "a Meta publicou zero" de "a
// Meta não publicou". Vinham iguais para cá e saíam iguais no painel — foi o que
// deixou os 7 perfis com "novos seguidores" zerado por 4 dias sem ninguém saber.
import { lerBrutoDoDia, atrasoDoBruto, recadoDeAtraso } from '../_shared/bruto-de-seguidores.js';
// As quatro contagens (conversa, cadastro, compra, visita) que já vêm no
// `actions` do insight de campanha — sem chamada nova à Meta.
import { contagensDaCampanha } from '../_shared/acoes-de-campanha.js';
// A janela de datas do recorte de N dias. Estava escrita aqui dentro e cobria
// N+1 dias, com o dia de HOJE (incompleto) dentro — ver janela-de-ads.js.
import { janelaDeAds } from '../_shared/janela-de-ads.js';

const GRAPH = 'https://graph.facebook.com/v21.0';
const APP_ID = Deno.env.get('META_APP_ID') ?? '';
const APP_SECRET = Deno.env.get('META_APP_SECRET') ?? '';
const ALERT_WEBHOOK_URL = Deno.env.get('ALERT_WEBHOOK_URL') ?? '';

// A conta de anúncios de cada perfil vem da coluna `accounts.ad_account_id`, NÃO
// de uma lista escrita aqui.
//
// Existia um mapa fixo instagram_id → ad_account_id neste arquivo. Ele saiu de
// sincronia com o banco: o da Mantova Móveis dizia '786453150398609' enquanto a
// coluna dizia '1449585576442706'. A Meta não devolve nada para a conta errada, o
// erro morria num catch vazio, e a Mantova ficou com ZERO linha em
// campaign_insights desde sempre — enquanto os 4 perfis cujos números batiam
// tinham de 805 a 5.280 linhas. As telas sempre leram a coluna; só o coletor não.
//
// Não recrie o mapa. Perfil novo com anúncios = preencher ad_account_id no banco,
// e o coletor pega sozinho. É a regra do projeto: lógica genérica, sem gambiarra
// por perfil.
const PERIODS = [0, 1, 7, 14, 30];
const ENG_KEYS = ['likes', 'comments', 'saves', 'shares', 'reach', 'views', 'total_interactions', 'accounts_engaged', 'profile_views'];

function todayBR(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
}

function localDate(ts: string): string {
  return new Date(ts).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
}

function brDateMinus(daysAgo: number): string {
  const dt = new Date(`${todayBR()}T12:00:00-03:00`);
  dt.setDate(dt.getDate() - daysAgo);
  return dt.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
}

function periodLabel(dias: number): string {
  return dias === 99 ? 'mês' : `${dias}d`;
}

async function apiGet(path: string, params: Record<string, string>): Promise<any> {
  const url = new URL(`${GRAPH}/${path}`);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const r = await fetch(url.toString());
  if (!r.ok) throw new Error(`Meta API ${path}: ${r.status} ${await r.text()}`);
  return r.json();
}

async function apiGetAll(path: string, params: Record<string, string>): Promise<any[]> {
  const all: any[] = [];
  let data = await apiGet(path, { ...params, limit: '500' });
  all.push(...(data.data ?? []));
  while (data.paging?.next) {
    const r = await fetch(data.paging.next);
    if (!r.ok) break;
    data = await r.json();
    all.push(...(data.data ?? []));
  }
  return all;
}

// Extrai a contagem de um tipo de ação do array `actions` do insight, tentando
// aliases (o Meta varia os nomes). Retorna inteiro (0 se ausente).
function actVal(actions: any, types: string[]): number {
  if (!Array.isArray(actions)) return 0;
  for (const t of types) {
    const hit = actions.find((a: any) => a && a.action_type === t);
    if (hit) return parseInt(hit.value ?? '0') || 0;
  }
  return 0;
}

async function renovarToken(token: string): Promise<string> {
  if (!APP_ID || !APP_SECRET) return token;
  try {
    const d = await apiGet('oauth/access_token', {
      grant_type: 'fb_exchange_token',
      client_id: APP_ID,
      client_secret: APP_SECRET,
      fb_exchange_token: token,
    });
    return d.access_token || token;
  } catch { return token; }
}

async function coletarSeguidores(igId: string, token: string): Promise<number> {
  const d = await apiGet(igId, { fields: 'followers_count', access_token: token });
  return d.followers_count ?? 0;
}

const BUCKET_FOTOS = 'profile-pics';

// Atualiza a foto do perfil (avatar) quando ela muda no Instagram.
//
// POR QUE ISTO EXISTE: ninguém atualizava. As fotos de `accounts.picture_url` foram
// postas uma vez e ficaram congeladas — não é que a atualização quebrou, é que nunca
// existiu. (O ig-coletor.mjs re-hospeda fotos, mas das marcas CONCORRENTES, pro
// Portal de Notícias; ele só lê `accounts` pra pegar um token.)
//
// DUAS ARMADILHAS que o desenho resolve:
//
// 1. A URL da Meta EXPIRA. `profile_picture_url` aponta pro fbcdn com assinatura
//    temporária — guardar essa URL dá foto quebrada depois. Por isso re-hospedamos
//    a imagem no nosso Storage e guardamos a NOSSA URL.
//
// 2. O caminho é fixo por conta (`{igId}.jpg`), então sobrescrever o arquivo NÃO
//    muda a URL — e o navegador/CDN continuariam servindo a foto velha do cache.
//    (A URL atual no banco termina com um `?` solto: alguém começou o cache-busting
//    e não terminou.) Por isso a URL leva `?v={hash da imagem}`: conteúdo novo =
//    URL nova = cache furado. E como o hash está NA URL, ele também é o registro de
//    "qual foto está publicada" — não precisa de coluna nova.
//
// Só sobe quando a imagem muda de verdade (o hash é dos BYTES, não da URL — a URL
// do fbcdn muda a cada chamada por causa da assinatura, então comparar URL não
// serviria).
async function atualizarFotoDoPerfil(sb: any, accountId: string, igId: string, token: string, urlAtual: string | null, name: string, degraded: string[]) {
  try {
    const d = await apiGet(igId, { fields: 'profile_picture_url', access_token: token });
    const urlMeta = d?.profile_picture_url;
    if (!urlMeta) { degraded.push(`foto ${name}: a Meta não devolveu profile_picture_url`); return; }

    // TIMEOUT OBRIGATÓRIO. Sem ele, um download pendurado do CDN da Meta trava a
    // coleta INTEIRA — que roda 4x/dia e alimenta o painel todo. A foto é cosmética;
    // ela não tem o direito de derrubar as métricas. (Aprendido na marca: a primeira
    // versão disto, sem timeout, fez a rodada parar de responder.)
    const r = await fetch(urlMeta, { signal: AbortSignal.timeout(12000) });
    if (!r.ok) { degraded.push(`foto ${name}: baixar a imagem deu ${r.status}`); return; }
    const bytes = new Uint8Array(await r.arrayBuffer());
    if (!bytes.length) { degraded.push(`foto ${name}: imagem vazia`); return; }

    const digest = await crypto.subtle.digest('SHA-256', bytes);
    const hash = Array.from(new Uint8Array(digest)).slice(0, 6).map((b) => b.toString(16).padStart(2, '0')).join('');

    // Já é esta foto? Não faz nada (o hash vive na própria URL).
    if (urlAtual && urlAtual.includes('v=' + hash)) return;

    const caminho = `${BUCKET_FOTOS}/${igId}.jpg`;
    const up = await fetch(`${Deno.env.get('SUPABASE_URL')}/storage/v1/object/${caminho}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
        apikey: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
        'Content-Type': r.headers.get('content-type') || 'image/jpeg',
        'x-upsert': 'true',
      },
      body: bytes,
      signal: AbortSignal.timeout(15000), // mesma razão do download: não travar a coleta
    });
    if (!up.ok) { degraded.push(`foto ${name}: upload falhou ${up.status} ${(await up.text()).slice(0, 90)}`); return; }

    const publica = `${Deno.env.get('SUPABASE_URL')}/storage/v1/object/public/${caminho}?v=${hash}`;
    const { error: errUp } = await sb.from('accounts').update({ picture_url: publica, profile_picture_url: urlMeta }).eq('id', accountId);
    if (errUp) { degraded.push(`foto ${name}: update falhou ${errUp.message}`); return; }
    console.log(`  🖼 foto atualizada: ${name}`);
  } catch (e) {
    // A foto é cosmética: se falhar, a coleta de métricas segue. Mas NÃO em silêncio.
    //
    // O motivo de reportar em `degraded` (e não só console.error) é que console.error
    // não aparece em lugar nenhum que alguém olhe: o `degraded` volta na resposta do
    // cron e vira alerta. Foi exatamente o silêncio que deixou as fotos congeladas
    // desde 21/05 sem ninguém perceber.
    degraded.push(`foto ${name}: ${String(e).slice(0, 120)}`);
  }
}

// A leitura do bruto de um dia. O QUE MUDOU: antes devolvia `null` tanto quando a
// Meta dava erro quanto quando ela respondia 200 sem número — e o `catch` vazio
// engolia os dois em silêncio. Agora sempre volta um veredito, e quem chama
// consegue distinguir "não publicado" de "publicou zero".
//
// A leitura em si mora em ../_shared/bruto-de-seguidores.js, pura e com teste ao
// lado usando as respostas REAIS da Meta.
async function coletarFollowsDia(igId: string, dia: string, token: string): Promise<{ publicado: boolean; gained?: number; lost?: number; motivo?: string }> {
  const since = Math.floor(new Date(`${dia}T00:00:00-03:00`).getTime() / 1000);
  const until = Math.floor(new Date(`${dia}T23:59:59-03:00`).getTime() / 1000);
  try {
    const d = await apiGet(`${igId}/insights`, {
      metric: 'follows_and_unfollows', period: 'day',
      metric_type: 'total_value', breakdown: 'follow_type',
      since: String(since), until: String(until), access_token: token,
    });
    return lerBrutoDoDia(d);
  } catch (e) {
    // Erro de rede/HTTP também é "não publicado", mas com o motivo preservado —
    // é a diferença entre "o Instagram está sem o dado" e "o nosso token caiu".
    return { publicado: false, motivo: String(e).slice(0, 120) };
  }
}

async function coletarEngajamentoConta(igId: string, token: string, dias: number): Promise<Record<string, number> | null> {
  const now = Math.floor(Date.now() / 1000);
  const startOf = (dia: string) => Math.floor(new Date(`${dia}T00:00:00-03:00`).getTime() / 1000);
  let since: number, until: number;
  if (dias === 0) { since = startOf(todayBR()); until = now; }
  else if (dias === 1) { since = startOf(brDateMinus(1)); until = startOf(todayBR()); }
  else if (dias === 99) { since = startOf(`${todayBR().slice(0, 7)}-01`); until = now; }
  else { since = startOf(brDateMinus(dias)); until = startOf(todayBR()); } // últimos N dias COMPLETOS (fecha à meia-noite BRT, = "Últimos N dias" do Business Suite)
  try {
    const d = await apiGet(`${igId}/insights`, {
      metric: 'likes,comments,saves,shares,reach,views,total_interactions,accounts_engaged,profile_views', period: 'day', metric_type: 'total_value',
      since: String(since), until: String(until), access_token: token,
    });
    const v: Record<string, number> = {};
    for (const it of d.data ?? []) v[it.name] = it.total_value?.value ?? 0;
    return v;
  } catch { return null; }
}

const bdSum = somaDoDetalhe;
const engOk = leituraServe;
const bdBroken = leituraParcial;

async function coletarEngResiliente(igId: string, token: string, dias: number): Promise<{ eng: Record<string, number> | null; ok: boolean }> {
  let last: Record<string, number> | null = null;
  for (let i = 0; i < 5; i++) {
    last = await coletarEngajamentoConta(igId, token, dias);
    if (engOk(last)) return { eng: last, ok: true };
    if (i < 4) await new Promise((r) => setTimeout(r, 350 * (i + 1)));
  }
  return { eng: last, ok: false };
}

async function carregarUltimoBom(sb: any, accountId: string, dias: number): Promise<Record<string, number> | null> {
  const { data } = await sb.from('engagement_snapshots')
    .select('likes,comments,saves,shares,reach,views,total_interactions,accounts_engaged,profile_views')
    .eq('account_id', accountId).eq('period_days', dias).gt('reach', 0)
    // 30 dias, e não 8: a leitura pela metade durou 4 dias seguidos em agosto de
    // 2026 e chegou a durar mais. Uma janela curta acaba dentro do período doente
    // e não encontra nada são para onde voltar.
    .order('captured_at', { ascending: false }).limit(30);
  for (const row of (data ?? [])) { if (leituraServe(row)) return row; }
  // NENHUMA linha presta: devolve nada, e quem chamou desiste de gravar.
  //
  // Antes esta linha devolvia `data[0]` — a mais recente, mesmo doente. Era o
  // último elo do estrago: quando o período envenenado passava da janela, o
  // conserto ia buscar o valor exatamente na linha que estava errada e o zero
  // se copiava para a frente. Não ter valor é melhor que ter um errado: sem
  // valor o painel mantém o que já mostrava, e o alerta de degradado dispara.
  return null;
}

function engCols(v: Record<string, number> | null): Record<string, number> | null {
  if (!v) return null;
  const out: Record<string, number> = {};
  for (const k of ENG_KEYS) if (k in v) out[k] = v[k] ?? 0;
  return Object.keys(out).length ? out : null;
}

async function gravarEng(sb: any, accountId: string, hoje: string, dias: number, igId: string, token: string, name: string, degraded: string[]) {
  if (dias === 0) {
    let v: Record<string, number> | null = null;
    for (let i = 0; i < 4; i++) {
      v = await coletarEngajamentoConta(igId, token, dias);
      if (!bdBroken(v)) break;
      if (i < 3) await new Promise((r) => setTimeout(r, 300 * (i + 1)));
    }
    // Leitura pela metade não é gravada, nem no período "hoje".
    //
    // Aqui não cabe cair no valor de ontem (é outro dia), mas cabe NÃO
    // sobrescrever: este período é reescrito 4x por dia, e o valor só cresce ao
    // longo do dia. Gravar a leitura quebrada apagaria a leitura boa da rodada
    // anterior e zeraria as curtidas de hoje no painel — que é o sintoma que o
    // dono viu. Sem gravar, fica valendo a última rodada que prestou.
    if (leituraParcial(v)) { degraded.push(`${name} ${periodLabel(dias)}`); return; }
    const engC0 = engCols(v);
    if (engC0) await sb.from('engagement_snapshots').upsert(
      { account_id: accountId, captured_at: hoje, period_days: dias, ...engC0 },
      { onConflict: 'account_id,captured_at,period_days' }
    );
    return;
  }
  const { eng, ok } = await coletarEngResiliente(igId, token, dias);
  let merged: Record<string, number> | null = eng ? { ...eng } : null;
  if (!ok) {
    const prev = await carregarUltimoBom(sb, accountId, dias);
    if (prev) {
      merged = merged || {};
      for (const k of ENG_KEYS) if (!(Number(merged[k]) > 0)) merged[k] = prev[k] ?? 0;
      // Janela 1d não entra no alerta: o painel não mostra mais 1D (agora é 2D) e um dia
      // quieto (reach 0 ontem) é normal — só gerava falso alarme. A coleta 1d segue (stories usam).
      if (dias !== 1) degraded.push(`${name} ${periodLabel(dias)}`);
    } else {
      if (!merged || !(Number(merged.reach) > 0)) { if (dias !== 1) degraded.push(`${name} ${periodLabel(dias)} (sem histórico)`); return; }
      // Sem histórico são para onde voltar, uma leitura PELA METADE não vira
      // linha. Antes ela passava por aqui só por ter alcance, e era gravada com
      // as curtidas zeradas — o mesmo estrago, agora sem nem o disfarce.
      if (leituraParcial(merged)) { if (dias !== 1) degraded.push(`${name} ${periodLabel(dias)} (sem histórico)`); return; }
    }
  }
  const engC = engCols(merged);
  if (engC) await sb.from('engagement_snapshots').upsert(
    { account_id: accountId, captured_at: hoje, period_days: dias, ...engC },
    { onConflict: 'account_id,captured_at,period_days' }
  );
}

async function coletarStoriesHoje(igId: string, token: string): Promise<Record<string, number>> {
  const hoje = todayBR();
  const zero = { count: 0, shares: 0, replies: 0, reach: 0, interactions: 0, navigation: 0, profile_visits: 0, follows: 0, nav_forward: 0, nav_back: 0, nav_exit: 0, nav_next: 0 };
  try {
    const d = await apiGet(`${igId}/stories`, { fields: 'id,timestamp', access_token: token, limit: '100' });
    const stories = (d.data ?? []).filter((s: any) => s.timestamp && localDate(s.timestamp) === hoje);
    const tot = { ...zero, count: stories.length };
    await Promise.all(stories.map(async (s: any) => {
      try {
        const ins = await apiGet(`${s.id}/insights`, { metric: 'reach,replies,shares,total_interactions,navigation,profile_visits,follows', access_token: token });
        for (const item of ins.data ?? []) {
          const v = item.value ?? (item.values?.[0]?.value ?? 0);
          if (item.name === 'shares') tot.shares += v;
          else if (item.name === 'replies') tot.replies += v;
          else if (item.name === 'reach') tot.reach += v;
          else if (item.name === 'total_interactions') tot.interactions += v;
          else if (item.name === 'navigation') tot.navigation += v;
          else if (item.name === 'profile_visits') tot.profile_visits += v;
          else if (item.name === 'follows') tot.follows += v;
        }
      } catch { /* ignora erro por story */ }
      try {
        const nb = await apiGet(`${s.id}/insights`, { metric: 'navigation', breakdown: 'story_navigation_action_type', access_token: token });
        const results = nb.data?.[0]?.total_value?.breakdowns?.[0]?.results ?? [];
        for (const r of results) {
          const k = (r.dimension_values ?? [null])[0];
          const v = r.value ?? 0;
          if (k === 'tap_forward') tot.nav_forward += v;
          else if (k === 'tap_back') tot.nav_back += v;
          else if (k === 'tap_exit') tot.nav_exit += v;
          else if (k === 'swipe_forward') tot.nav_next += v;
        }
      } catch { /* breakdown opcional */ }
    }));
    return tot;
  } catch { return zero; }
}

async function coletarMidias(igId: string, token: string, dias: number) {
  const hoje = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
  const hojeDate = new Date(hoje + 'T12:00:00');
  let fromDate: string, toDate: string | null = null;
  if (dias === 0) { fromDate = hoje; toDate = hoje; }
  else if (dias === 1) {
    const d = new Date(hojeDate); d.setDate(d.getDate() - 1);
    fromDate = d.toLocaleDateString('en-CA'); toDate = fromDate;
  } else {
    const d = new Date(hojeDate); d.setDate(d.getDate() - dias);
    fromDate = d.toLocaleDateString('en-CA');
  }
  let posts = 0, reels = 0;
  try {
    const d = await apiGet(`${igId}/media`, {
      fields: 'id,media_product_type,timestamp,owner',
      access_token: token, limit: '100',
    });
    for (const m of (d.data ?? [])) {
      const ownerId = m.owner?.id ?? igId;
      if (ownerId !== igId) continue;
      const produto = m.media_product_type ?? '';
      if (produto === 'STORY') continue;
      if (m.timestamp) {
        const pubDate = localDate(m.timestamp);
        if (pubDate < fromDate) continue;
        if (toDate && pubDate > toDate) continue;
      }
      if (produto === 'REELS') reels++; else posts++;
    }
  } catch { /* ignora conta sem acesso */ }
  return { posts, reels };
}

async function sincronizarCampanhas(sb: any, accountId: string, adAccountId: string, token: string) {
  try {
    const items = await apiGetAll(`act_${adAccountId}/campaigns`, {
      fields: 'id,name,objective,status', access_token: token,
    });
    const rows = items.map((c: any) => ({
      campaign_id: c.id, account_id: accountId,
      name: c.name ?? '', objective: c.objective ?? '',
      status: c.status ?? '', synced_at: todayBR(),
    }));
    if (rows.length) await sb.from('campaigns').upsert(rows, { onConflict: 'campaign_id' });
  } catch { /* sem ads */ }
}

// O SINAL DO CONJUNTO — destination_type e optimization_goal — é o que decide o
// balde da campanha no painel de Redes Sociais. Uma chamada por perfil por
// rodada; os mesmos campos que a Gestão de Tráfego já lê ao vivo.
// Falhar aqui NÃO pode derrubar o resto da rodada: sem conjunto, a tela
// classifica pelo objetivo e avisa que é provisório.
async function sincronizarConjuntos(sb: any, accountId: string, adAccountId: string, token: string) {
  try {
    const items = await apiGetAll(`act_${adAccountId}/adsets`, {
      fields: 'id,campaign_id,destination_type,optimization_goal', access_token: token,
    });
    const rows = items.map((s: any) => ({
      adset_id: s.id, campaign_id: s.campaign_id ?? '', account_id: accountId,
      destination_type: s.destination_type ?? null,
      optimization_goal: s.optimization_goal ?? null,
      synced_at: todayBR(),
    })).filter((r: any) => r.campaign_id);
    if (rows.length) await sb.from('campaign_adsets').upsert(rows, { onConflict: 'adset_id' });
    console.log(`  conjuntos: ${rows.length}`);
  } catch (e) {
    // A rodada SEGUE (falhar aqui não pode derrubar o resto), mas não em
    // silêncio. Este catch foi deixado calado na premissa de que o sintoma
    // apareceria na tela como "classificação provisória" — e não aparece: aquele
    // aviso só fala quando o perfil não tem NENHUM conjunto, e todos já têm. Sem
    // esta linha, um perfil que parou de sincronizar conjuntos fica classificando
    // campanha pelo objetivo por tempo indeterminado, sem ninguém ficar sabendo.
    console.warn(`  conjuntos FALHOU (conta ${accountId} / ads ${adAccountId}):`, e instanceof Error ? e.message : e);
  }
}

async function coletarAdsPorCampanha(sb: any, adAccountId: string, accountId: string, token: string, dias: number, hoje: string) {
  // A JANELA SAI DO MÓDULO PURO, com teste ao lado. Ela morava aqui e pedia
  // `until = hoje`: como o `time_range` da Meta é inclusive nas duas pontas,
  // "7 dias" virava OITO, com o dia de hoje (incompleto) dentro. O engajamento
  // logo acima neste mesmo arquivo sempre pediu N dias COMPLETOS — agora os dois
  // usam a mesma régua, e o alcance volta a fechar com o painel da Meta.
  const janela = janelaDeAds(hoje, dias);
  if (!janela) return;                       // recorte que ninguém sabe medir não vira pergunta à Meta
  const { since, until } = janela;
  try {
    const items = await apiGetAll(`act_${adAccountId}/insights`, {
      fields: 'campaign_id,spend,impressions,clicks,reach,actions',
      time_range: JSON.stringify({ since, until }),
      level: 'campaign', access_token: token,
    });
    const rows = items.map((r: any) => ({
      campaign_id: r.campaign_id, account_id: accountId,
      captured_at: hoje, period_days: dias,
      spend: parseFloat(r.spend ?? '0'),
      impressions: parseInt(r.impressions ?? '0'),
      clicks: parseInt(r.clicks ?? '0'),
      reach: parseInt(r.reach ?? '0'),
      post_engagement: actVal(r.actions, ['post_engagement']),
      likes: actVal(r.actions, ['post_reaction', 'like']),
      comments: actVal(r.actions, ['comment']),
      shares: actVal(r.actions, ['post', 'share']),
      saves: actVal(r.actions, ['onsite_conversion.post_save', 'post_save']),
      ...contagensDaCampanha(r.actions),
    }));
    if (rows.length) await sb.from('campaign_insights').upsert(rows, { onConflict: 'campaign_id,account_id,captured_at,period_days' });
  } catch { /* sem dados de ads */ }
}

// Re-coleta o gasto de UM dia isolado (time_range [dia,dia]) como period_days=0, por campanha.
// A Meta re-atribui gasto por 1-2 dias e o pd=0 do dia era congelado na coleta das 23h → ficava
// abaixo do final. O relatório usa pd=0, então recuperamos os dias recentes aqui.
async function coletarAdsDia(sb: any, adAccountId: string, accountId: string, token: string, dia: string) {
  try {
    const items = await apiGetAll(`act_${adAccountId}/insights`, {
      fields: 'campaign_id,spend,impressions,clicks,reach,actions',
      time_range: JSON.stringify({ since: dia, until: dia }),
      level: 'campaign', access_token: token,
    });
    const rows = items.map((r: any) => ({
      campaign_id: r.campaign_id, account_id: accountId, captured_at: dia, period_days: 0,
      spend: parseFloat(r.spend ?? '0'), impressions: parseInt(r.impressions ?? '0'),
      clicks: parseInt(r.clicks ?? '0'), reach: parseInt(r.reach ?? '0'),
      post_engagement: actVal(r.actions, ['post_engagement']),
      likes: actVal(r.actions, ['post_reaction', 'like']), comments: actVal(r.actions, ['comment']),
      shares: actVal(r.actions, ['post', 'share']), saves: actVal(r.actions, ['onsite_conversion.post_save', 'post_save']),
      ...contagensDaCampanha(r.actions),
    }));
    if (rows.length) await sb.from('campaign_insights').upsert(rows, { onConflict: 'campaign_id,account_id,captured_at,period_days' });
  } catch { /* sem dados de ads */ }
}

async function processarConta(sb: any, acc: any, degraded: string[], semBruto: string[]) {
  const { id: accountId, instagram_id: igId, name, access_token: token, ad_account_id: adAccountId, picture_url: fotoAtual } = acc;
  if (!token) { console.log(`⚠ Sem token: ${name}`); return null; }
  const hoje = todayBR();
  console.log(`▶ ${name}`);

  const seguidores = await coletarSeguidores(igId, token);
  await sb.from('daily_snapshots').upsert(
    { account_id: accountId, captured_at: hoje, followers_count: seguidores },
    { onConflict: 'account_id,captured_at' }
  );

  // Cada leitura da contagem vira uma linha própria, append-only.
  //
  // O daily_snapshots guarda UMA linha por dia e sobrescreve a cada rodada — então o
  // movimento DENTRO do dia era jogado fora 4x por dia. Sem isso não dá pra dizer "a
  // contagem chegou a 24.351 às 18h e caiu pra 24.349 às 22h": só sobra o último
  // valor. Aqui a leitura é guardada com a hora, e o histórico se acumula.
  //
  // Não substitui o bruto da Meta (seguiram/saíram), que ela só publica no dia
  // seguinte — a contagem só revela o LÍQUIDO. Mas mostra que houve movimento, que
  // é o que hoje se perde.
  await sb.from('followers_leituras').insert({ account_id: accountId, followers_count: seguidores });

  await atualizarFotoDoPerfil(sb, accountId, igId, token, fotoAtual, name, degraded);

  // Re-coleta de follows resiliente + barata: SEMPRE os 3 dias recentes (a Meta consolida com atraso),
  // MAIS qualquer dia dos últimos 14 que ainda esteja 0/0 (buraco de uma queda do coletor — antes, queda
  // > 3 dias deixava buraco PERMANENTE porque saía da janela). Dias antigos já preenchidos não são
  // re-buscados → rodada normal não fica mais lenta. Só atualiza quando a Meta devolve valor (fu != null).
  const { data: recentes } = await sb.from('daily_snapshots')
    .select('captured_at,gained,lost')
    .eq('account_id', accountId).gte('captured_at', brDateMinus(14)).lte('captured_at', hoje);
  const mapaDias: Record<string, any> = {};
  for (const r of (recentes ?? [])) mapaDias[r.captured_at] = r;
  // O que a Meta publicou (ou não) em cada dia desta rodada. É daqui que sai o
  // alerta: sem esta lista, "o Instagram parou de publicar" não tinha como
  // chegar em ninguém — a função devolvia nada e o laço seguia calado.
  const publicacaoPorDia: Array<{ dia: string; publicado: boolean }> = [];
  for (let dd = 0; dd < 14; dd++) {
    const dia = brDateMinus(dd);
    const row = mapaDias[dia];
    const ehRecente = dd < 3;
    const ehBuraco = row && (Number(row.gained) || 0) === 0 && (Number(row.lost) || 0) === 0;
    if (!ehRecente && !ehBuraco) {
      // Dia antigo JÁ preenchido: não re-busca (economia), e conta como publicado
      // — porque o número dele está no banco.
      if (row) publicacaoPorDia.push({ dia, publicado: true });
      continue;
    }
    const fu = await coletarFollowsDia(igId, dia, token);
    publicacaoPorDia.push({ dia, publicado: fu.publicado });
    if (fu.publicado) {
      await sb.from('daily_snapshots').update({ gained: fu.gained, lost: fu.lost })
        .eq('account_id', accountId).eq('captured_at', dia);
    }
  }
  // Dia fechado há 2+ dias e ainda sem número = o Instagram parou de publicar.
  // Fica gravado como fato do dia; quem avisa é o auditar-dados, uma vez só.
  const recado = recadoDeAtraso(name, atrasoDoBruto(publicacaoPorDia, hoje));
  if (recado) { semBruto.push(recado); await registrarBrutoParado(sb, accountId, recado); }

  const stories = await coletarStoriesHoje(igId, token);

  for (const dias of PERIODS) {
    const m = await coletarMidias(igId, token, dias);
    await gravarEng(sb, accountId, hoje, dias, igId, token, name, degraded);
    const row: any = { account_id: accountId, captured_at: hoje, period_days: dias, posts_count: m.posts, reels_count: m.reels };
    if (dias <= 1) {
      row.stories_count = stories.count; row.story_shares = stories.shares; row.story_replies = stories.replies;
      row.story_reach = stories.reach; row.story_interactions = stories.interactions; row.story_navigation = stories.navigation;
      row.story_profile_visits = stories.profile_visits; row.story_follows = stories.follows;
      row.story_nav_forward = stories.nav_forward; row.story_nav_back = stories.nav_back; row.story_nav_exit = stories.nav_exit; row.story_nav_next = stories.nav_next;
    }
    await sb.from('content_snapshots').upsert(row, { onConflict: 'account_id,captured_at,period_days' });
  }

  await gravarEng(sb, accountId, hoje, 99, igId, token, name, degraded);

  // Perfil sem ad_account_id preenchido não tem anúncios — pula, sem erro.
  if (adAccountId) {
    await sincronizarCampanhas(sb, accountId, adAccountId, token);
    await sincronizarConjuntos(sb, accountId, adAccountId, token);
    for (const dias of PERIODS) await coletarAdsPorCampanha(sb, adAccountId, accountId, token, dias, hoje);
    // Re-coleta o gasto pd=0 dos últimos 7 dias (ontem→-7): captura a atribuição tardia da Meta,
    // pra o relatório (que usa pd=0) bater com o valor final. Hoje já foi coletado no loop acima.
    for (let dd = 1; dd <= 7; dd++) await coletarAdsDia(sb, adAccountId, accountId, token, brDateMinus(dd));
  }

  const novoToken = await renovarToken(token);
  if (novoToken !== token) {
    await sb.from('accounts').update({ access_token: novoToken }).eq('id', accountId);
  }
  console.log(`✓ ${name}: ${seguidores} seguidores, ${stories.count} stories`);
  return novoToken;
}

async function avisarSuperAdmin(sb: any, degraded: string[]) {
  if (!degraded.length) return;
  const lista = degraded.join(' · ');
  const msg = `⚠️ Coleta IG: a Meta retornou métricas zeradas/inconsistentes (alcance 0 ou likes/comments/saves/shares zerados com interações>0) mesmo após 5 tentativas em: ${lista}. Mantive o valor mais recente válido (não zerei o painel). Verificar token/permissões da Meta.`;
  try {
    await sb.from('data_integrity_checks').insert({
      checked_date: todayBR(), status: 'fail', check_name: 'coleta_zerada',
      detail: msg.slice(0, 900),
    });
  } catch (e) { console.error('alerta DB:', e); }
  if (ALERT_WEBHOOK_URL) {
    try {
      await fetch(ALERT_WEBHOOK_URL, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: msg, content: msg }),
      });
    } catch (e) { console.error('webhook:', e); }
  }
}

// REGISTRA (não dispara) que o Instagram parou de publicar o bruto de um perfil.
//
// POR QUE NÃO DISPARA O WEBHOOK AQUI: desde 2026-07-31 o cron manda UMA conta por
// chamada, 4 vezes ao dia. Um webhook por conta por rodada daria 7 × 4 = 28
// mensagens por dia enquanto a Meta estivesse fora — exatamente a doença do
// `meta_spotcheck`, que falhava 6 de 7 perfis todo dia e por isso já não avisava
// mais nada. Alarme que toca o tempo todo é ruído, e ruído é pior que silêncio
// porque dá a sensação de que alguém está olhando.
//
// Então aqui só fica o FATO gravado, um por conta por dia. Quem junta os fatos e
// manda UM recado por dia é o auditar-dados, que já roda 1x/dia e já enxerga os
// 7 perfis de uma vez.
//
// Também não entra no `degraded` do avisarSuperAdmin: a mensagem de lá fala de
// métricas zeradas e manda "verificar token/permissões da Meta". Aqui o token
// está bom e não há nada a verificar do nosso lado — o dado não existe ainda.
async function registrarBrutoParado(sb: any, accountId: string, recado: string) {
  const hoje = todayBR();
  try {
    // Regravável: a mesma conta é coletada 4x por dia e o recado muda de "1 dia"
    // para "2 dias" conforme a coisa se arrasta. Fica sempre a leitura mais nova.
    await sb.from('data_integrity_checks').delete()
      .eq('checked_date', hoje).eq('check_name', 'bruto_seguidores_parado').eq('account_id', accountId);
    await sb.from('data_integrity_checks').insert({
      checked_date: hoje, account_id: accountId,
      status: 'fail', check_name: 'bruto_seguidores_parado',
      detail: recado.slice(0, 900),
    });
  } catch (e) { console.error('registro bruto parado:', e); }
}

// `apenasConta` = processa UMA conta só. É o modo normal desde 2026-07-31.
//
// POR QUE MUDOU: varrer as 7 contas numa chamada só estourava o teto de 150s da
// plataforma. Não era teoria — a instrumentação de robos_execucoes pegou duas
// falhas no mesmo dia: 546 WORKER_RESOURCE_LIMIT às 12h e
// 504 IDLE_TIMEOUT ("Request idle timeout limit (150s) reached") às 18h.
// O `timeout_milliseconds := 180000` do cron nunca teve efeito: 180s é MAIOR que
// o limite real da Supabase, então quem cortava era sempre a plataforma.
//
// Aumentar timeout não resolveria: o teto não é nosso. A saída é a chamada fazer
// menos — uma conta por vez, sete execuções curtas em vez de uma longa. É o mesmo
// desenho que a Fábrica de Anúncios já usa.
//
// Sem `apenasConta` o comportamento antigo continua (todas as contas), para
// chamada manual e para não quebrar quem chamar sem o parâmetro.
async function rodarColeta(apenasConta?: string | null) {
  const sb = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );
  // ad_account_id vem daqui — antes o coletor nem selecionava a coluna e usava um
  // mapa fixo no código, que estava errado para a Mantova Móveis.
  let q = sb.from('accounts').select('id,name,instagram_id,access_token,ad_account_id,picture_url');
  if (apenasConta) q = q.eq('id', apenasConta);
  const { data: accounts, error } = await q;
  if (error) throw error;
  if (!accounts?.length) {
    return { contas: 0, degradados: [], aviso: apenasConta ? `conta ${apenasConta} não encontrada` : 'nenhuma conta' };
  }

  const comeco = Date.now();
  console.log(`Coleta — ${accounts.length} conta(s)${apenasConta ? ' (uma só)' : ' (todas)'}`);
  const degraded: string[] = [];
  const semBruto: string[] = [];
  for (const acc of accounts) {
    try { await processarConta(sb, acc, degraded, semBruto); } catch (e) { console.error(`Erro ${acc.name}:`, e); }
  }
  await avisarSuperAdmin(sb, degraded);

  // O tempo volta na resposta e fica gravado em robos_execucoes. É o que permite
  // ver a margem para o teto de 150s sem precisar caçar log — e perceber cedo se
  // uma conta voltar a crescer até encostar nele.
  return {
    contas: accounts.length,
    conta: accounts.length === 1 ? accounts[0].name : null,
    segundos: Math.round((Date.now() - comeco) / 1000),
    degradados: degraded,
    semBrutoDeSeguidores: semBruto,
  };
}

// SÍNCRONO: aguarda a coleta e responde no fim. O invocador segura a conexão
// (background não é confiável aqui: EdgeRuntime.waitUntil foi morto pela
// reciclação da instância).
//
// O TETO É 150s E É DA PLATAFORMA, não do nosso timeout. Por isso o cron manda
// uma conta por chamada — ver o comentário de rodarColeta().
Deno.serve(async (req: Request) => {
  // Só o pg_cron entra. Antes: verify_jwt=true, o que NÃO protegia — a anon key é
  // um JWT válido do projeto e está no bundle público do site. Tanto que o próprio
  // cron mandava a anon key. Sem isto, qualquer visitante dispara a coleta em loop:
  // queima a cota da Graph API das contas e força a rotação do token da Meta
  // (renovarToken → UPDATE em accounts.access_token) a cada rodada.
  const negado = await exigirSegredoDeCron(req, 'coletar-dados');
  if (negado) return negado;

  try {
    // O corpo pode não vir, ou vir sem account_id (chamada manual, modo antigo).
    const corpo = await req.json().catch(() => ({}));
    const r = await rodarColeta(corpo?.account_id ?? null);
    return new Response(JSON.stringify({ ok: true, ts: new Date().toISOString(), ...r }), { headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ ok: false, error: String(e) }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
});
