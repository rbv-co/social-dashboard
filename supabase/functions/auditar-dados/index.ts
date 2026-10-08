import { createClient } from 'jsr:@supabase/supabase-js@2';
import { exigirSegredoDeCron } from '../_shared/segredo-de-cron.ts';
import { metaDoCore } from '../_shared/core-meta.js'

// CORE_META=true: a Graph passa pelo proxy do `core` (token global; não lê accounts.access_token). Ver _shared/core-meta.js.
const META = metaDoCore(Deno.env.toObject())

const GRAPH = 'https://graph.facebook.com/v21.0';

// Veredito do spot-check: compara o valor do painel (stored) com a Meta ao vivo.
function verdict(stored: number | null | undefined, meta: number | null): [string, string] {
  if (meta == null || stored == null) return ['warn', 'sem dado p/ comparar'];
  const div = Math.abs(stored - meta) / Math.max(meta, 1);
  if ((stored === 0 && meta > 50) || div > 0.30) return ['fail', `painel=${stored} vs Meta=${meta}`];
  if (div > 0.15) return ['warn', `painel=${stored} vs Meta=${meta} (${Math.round(div * 100)}%)`];
  return ['ok', `painel=${stored} vs Meta=${meta}`];
}

Deno.serve(async (req: Request) => {
  // Só o pg_cron entra. Antes: verify_jwt=false E nenhuma checagem aqui dentro =
  // endpoint aberto na internet. Qualquer um apagava a trilha de auditoria do dia
  // (o DELETE logo abaixo), gastava a cota da Graph API das contas e disparava o
  // ALERT_WEBHOOK_URL com "🚨 Saúde dos dados" falso.
  const negado = await exigirSegredoDeCron(req, 'auditar-dados');
  if (negado) return negado;

  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  // 1) Checks internos + sanidade (função SQL)
  try { await sb.rpc('run_integrity_checks'); } catch (e) { console.error('rpc:', e); }

  const { data: lastSnap } = await sb.from('daily_snapshots').select('captured_at').order('captured_at', { ascending: false }).limit(1);
  const hoje = lastSnap?.[0]?.captured_at;
  if (!hoje) return new Response(JSON.stringify({ ok: false, error: 'sem snapshots' }), { status: 500 });

  // 2) Spot-check contra a Meta ao vivo (curtidas + alcance, 7 dias)
  const { data: accounts } = await sb.from('accounts').select(META.colunas('id,name,instagram_id,access_token'));
  const now = Math.floor(Date.now() / 1000), since = now - 7 * 86400;
  await sb.from('data_integrity_checks').delete().eq('checked_date', hoje).eq('check_name', 'meta_spotcheck');

  for (const a of accounts ?? []) {
    const tok = String(META.token(a) || '').replace(/\s/g, '');
    if (!tok) continue;
    let metaLikes: number | null = null, metaReach: number | null = null;
    try {
      const url = new URL(`${GRAPH}/${a.instagram_id}/insights`);
      url.searchParams.set('metric', 'likes,reach');
      url.searchParams.set('period', 'day');
      url.searchParams.set('metric_type', 'total_value');
      url.searchParams.set('since', String(since));
      url.searchParams.set('until', String(now));
      url.searchParams.set('access_token', tok);
      const j = await (await META.fetch(url.toString())).json();
      for (const it of j.data ?? []) {
        if (it.name === 'likes') metaLikes = it.total_value?.value ?? null;
        if (it.name === 'reach') metaReach = it.total_value?.value ?? null;
      }
    } catch (e) { console.error('meta', a.name, e); }

    const { data: stored } = await sb.from('engagement_snapshots').select('likes,reach').eq('account_id', a.id).eq('captured_at', hoje).eq('period_days', 7).limit(1);
    const sLikes = stored?.[0]?.likes, sReach = stored?.[0]?.reach;
    const [vl, dl] = verdict(sLikes, metaLikes);
    const [vr, dr] = verdict(sReach, metaReach);
    const worst = (vl === 'fail' || vr === 'fail') ? 'fail' : (vl === 'warn' || vr === 'warn') ? 'warn' : 'ok';
    await sb.from('data_integrity_checks').insert({ checked_date: hoje, account_id: a.id, check_name: 'meta_spotcheck', status: worst, detail: `curtidas ${dl} · alcance ${dr}` });
  }

  // 3) Alerta ativo: FAIL **e WARN** de hoje viram UM recado (se ALERT_WEBHOOK_URL estiver setado).
  //
  // POR QUE O WARN ENTROU (2026-08-06): o check `bruto_seguidores` marcou os 7
  // perfis em `warn` no dia 05/08, dizendo com todas as letras `ultimo=2026-08-02`
  // — ou seja, ele PEGOU que o Instagram tinha parado de publicar "seguiram/
  // deixaram de seguir". Só que warn não disparava nada: ficava gravado numa
  // tabela que ninguém abre. O sistema sabia e não contou. Quem descobriu foi o
  // dono, no olho, três dias depois.
  //
  // Os dois níveis vão no MESMO recado, separados, e não em dois disparos: o
  // objetivo é continuar sendo uma mensagem por dia. Alarme que toca demais vira
  // ruído — e ruído é pior que silêncio, porque parece que alguém está olhando.
  const { data: achados } = await sb.from('data_integrity_checks')
    .select('account_id,check_name,detail,status').eq('checked_date', hoje).in('status', ['fail', 'warn']);
  const fails = (achados ?? []).filter((f: any) => f.status === 'fail');
  const warns = (achados ?? []).filter((f: any) => f.status === 'warn');
  const hook = Deno.env.get('ALERT_WEBHOOK_URL');
  if (hook && (fails.length || warns.length)) {
    const accMap: Record<string, string> = {};
    (accounts ?? []).forEach((a: any) => accMap[a.id] = a.name || a.instagram_id);
    const linha = (f: any) => `• ${accMap[f.account_id] || '?'} · ${f.check_name}${f.detail ? ' (' + f.detail + ')' : ''}`;
    const partes: string[] = [];
    if (fails.length) partes.push(`🚨 ${fails.length} falha(s):\n` + fails.map(linha).join('\n'));
    if (warns.length) partes.push(`⚠️ ${warns.length} aviso(s):\n` + warns.map(linha).join('\n'));
    const msg = `Saúde dos dados (${hoje})\n\n` + partes.join('\n\n');
    try { await fetch(hook, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: msg, content: msg }) }); } catch (e) { console.error('hook', e); }
  }

  return new Response(JSON.stringify({ ok: true, date: hoje, fails: fails.length, warns: warns.length }), { headers: { 'Content-Type': 'application/json' } });
});
