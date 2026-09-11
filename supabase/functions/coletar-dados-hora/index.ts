import { createClient } from 'jsr:@supabase/supabase-js@2';
import { exigirSegredoDeCron } from '../_shared/segredo-de-cron.ts';
import { conversasIniciadas, calcularDeltaHora } from '../_shared/delta-de-hora.js';

const GRAPH = 'https://graph.facebook.com/v22.0';

function todayBR(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
}

// Hora de parede em São Paulo (0-23), não UTC — é a hora que a pessoa vai
// ler na tela. Ver "a hora gravada é a hora da rodada" na spec, §4.
function horaBR(): number {
  return Number(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo', hour: '2-digit', hour12: false }));
}

async function apiGetAll(path: string, params: Record<string, string>): Promise<any[]> {
  const url = new URL(`${GRAPH}/${path}`);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const out: any[] = [];
  let next: string | null = url.toString();
  while (next) {
    const r = await fetch(next);
    if (!r.ok) throw new Error(`Meta API ${path}: ${r.status} ${await r.text()}`);
    const d = await r.json();
    out.push(...(d.data ?? []));
    next = d.paging?.next ?? null;
  }
  return out;
}

// Uma conta: busca o insight do dia (acumulado até agora), calcula o delta
// contra a última linha já gravada hoje, e grava. Erro nesta conta (sem
// token, Meta fora do ar) não derruba as outras — mesmo espírito do
// `try/catch` por conta em coletar-dados/index.ts.
async function coletarConta(sb: any, acc: any, dia: string, hora: number): Promise<number> {
  const { id: accountId, ad_account_id: adAccountId, access_token: token, name } = acc;
  if (!adAccountId || !token) return 0;
  try {
    const items = await apiGetAll(`act_${adAccountId}/insights`, {
      fields: 'campaign_id,spend,actions',
      time_range: JSON.stringify({ since: dia, until: dia }),
      level: 'campaign',
      access_token: token,
    });

    for (const r of items) {
      const campaignId = r.campaign_id;
      const gastoAcumulado = parseFloat(r.spend ?? '0');
      const conversasAcumuladas = conversasIniciadas(r.actions);

      const { data: anteriorRows } = await sb
        .from('campaign_insights_hora')
        .select('gasto_acumulado,conversas_acumuladas')
        .eq('campaign_id', campaignId).eq('account_id', accountId).eq('dia', dia)
        .order('hora', { ascending: false }).limit(1);
      const anterior = anteriorRows?.[0] ?? null;

      const { gasto_hora, conversas_hora } = calcularDeltaHora(gastoAcumulado, conversasAcumuladas, anterior);

      await sb.from('campaign_insights_hora').upsert(
        {
          campaign_id: campaignId, account_id: accountId, dia, hora,
          gasto_acumulado: gastoAcumulado, conversas_acumuladas: conversasAcumuladas,
          gasto_hora, conversas_hora,
        },
        { onConflict: 'campaign_id,account_id,dia,hora' },
      );
    }
    console.log(`✓ ${name}: ${items.length} campanhas`);
    return items.length;
  } catch (e) {
    console.error(`✗ ${name}:`, e);
    return 0;
  }
}

Deno.serve(async (req: Request) => {
  const negado = await exigirSegredoDeCron(req, 'coletar-dados-hora');
  if (negado) return negado;

  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const dia = todayBR();
  const hora = horaBR();

  const { data: contas } = await sb
    .from('accounts')
    .select('id,name,ad_account_id,access_token')
    .not('ad_account_id', 'is', null);

  let campanhas = 0;
  for (const acc of contas ?? []) campanhas += await coletarConta(sb, acc, dia, hora);

  return new Response(JSON.stringify({ ok: true, dia, hora, contas: (contas ?? []).length, campanhas }), {
    headers: { 'Content-Type': 'application/json' },
  });
});
