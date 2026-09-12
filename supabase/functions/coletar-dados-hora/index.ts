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

async function apiGet(path: string, params: Record<string, string>): Promise<any> {
  const url = new URL(`${GRAPH}/${path}`);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const r = await fetch(url.toString());
  if (!r.ok) throw new Error(`Meta API ${path}: ${r.status} ${await r.text()}`);
  return r.json();
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
// contra a última linha já gravada hoje ANTES desta hora, e grava tudo de uma
// vez. Erro nesta conta (sem token, Meta fora do ar, erro do banco) não
// derruba as outras contas — mas fica registrado em `degraded`, porque
// `console.error` não aparece em lugar nenhum que alguém olhe (mesmo motivo
// documentado em coletar-dados/index.ts).
async function coletarConta(sb: any, acc: any, dia: string, hora: number, degraded: string[]): Promise<number> {
  const { id: accountId, ad_account_id: adAccountId, access_token: token, name } = acc;
  if (!adAccountId || !token) return 0;
  try {
    const items = await apiGetAll(`act_${adAccountId}/insights`, {
      fields: 'campaign_id,spend,actions',
      time_range: JSON.stringify({ since: dia, until: dia }),
      level: 'campaign',
      access_token: token,
    });
    if (!items.length) return 0;

    // Uma consulta só para a conta inteira: todas as linhas já gravadas HOJE
    // ANTES desta hora (não incluindo a própria hora — uma segunda rodada na
    // mesma hora não pode se comparar consigo mesma). Ordenado por hora
    // decrescente, a PRIMEIRA ocorrência de cada campaign_id é a mais recente.
    const { data: anterioresRows, error: erroAnteriores } = await sb
      .from('campaign_insights_hora')
      .select('campaign_id,gasto_acumulado,conversas_acumuladas,hora')
      .eq('account_id', accountId).eq('dia', dia).lt('hora', hora)
      .order('hora', { ascending: false });
    if (erroAnteriores) {
      degraded.push(`${name}: falha ao ler leitura anterior (${erroAnteriores.message})`);
      return 0;
    }
    const anteriorPorCampanha = new Map<string, any>();
    for (const row of anterioresRows ?? []) {
      if (!anteriorPorCampanha.has(row.campaign_id)) anteriorPorCampanha.set(row.campaign_id, row);
    }

    const linhas = items.map((r: any) => {
      const campaignId = r.campaign_id;
      const gastoAcumulado = parseFloat(r.spend ?? '0');
      const conversasAcumuladas = conversasIniciadas(r.actions);
      const anterior = anteriorPorCampanha.get(campaignId) ?? null;
      const { gasto_hora, conversas_hora } = calcularDeltaHora(gastoAcumulado, conversasAcumuladas, anterior);
      return {
        campaign_id: campaignId, account_id: accountId, dia, hora,
        gasto_acumulado: gastoAcumulado, conversas_acumuladas: conversasAcumuladas,
        gasto_hora, conversas_hora,
      };
    });

    const { error: erroUpsert } = await sb
      .from('campaign_insights_hora')
      .upsert(linhas, { onConflict: 'campaign_id,account_id,dia,hora' });
    if (erroUpsert) {
      degraded.push(`${name}: falha ao gravar (${erroUpsert.message})`);
      return 0;
    }

    console.log(`✓ ${name}: ${linhas.length} campanhas`);
    return linhas.length;
  } catch (e) {
    degraded.push(`${name}: ${e instanceof Error ? e.message : String(e)}`);
    return 0;
  }
}

// Seguidores da conta (não por campanha — a Meta não atribui "novo
// seguidor" a uma campanha específica pra esse tipo de anúncio, conferido
// na hora com a Graph API real: nenhuma das campanhas [+ SEGUIDORES] de
// 11/09 tinha ação de "follow"). Uma leitura por conta por rodada, em
// `followers_leituras` — tabela que já existia pra isso (usada 4x/dia pelo
// coletar-dados; aqui vira ~24x/dia). Quem calcula o delta hora a hora é a
// tela, comparando leituras consecutivas — aqui só grava o bruto.
async function coletarSeguidoresDaConta(sb: any, acc: any, degraded: string[]): Promise<void> {
  const { id: accountId, instagram_id: igId, access_token: token, name } = acc;
  if (!igId || !token) return;
  try {
    const d = await apiGet(igId, { fields: 'followers_count', access_token: token });
    const seguidores = d.followers_count ?? 0;
    const { error } = await sb.from('followers_leituras').insert({ account_id: accountId, followers_count: seguidores });
    if (error) degraded.push(`${name}: falha ao gravar seguidores (${error.message})`);
  } catch (e) {
    degraded.push(`${name}: seguidores (${e instanceof Error ? e.message : String(e)})`);
  }
}

Deno.serve(async (req: Request) => {
  const negado = await exigirSegredoDeCron(req, 'coletar-dados-hora');
  if (negado) return negado;

  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const dia = todayBR();
  const hora = horaBR();

  const { data: contas, error: erroContas } = await sb
    .from('accounts')
    .select('id,name,ad_account_id,access_token,instagram_id')
    .not('ad_account_id', 'is', null);

  if (erroContas) {
    return new Response(JSON.stringify({ ok: false, erro: erroContas.message }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }

  const degraded: string[] = [];
  let campanhas = 0;
  for (const acc of contas ?? []) {
    campanhas += await coletarConta(sb, acc, dia, hora, degraded);
    await coletarSeguidoresDaConta(sb, acc, degraded);
  }

  // 500 quando havia conta pra processar e NADA foi coletado — sinal pro
  // robos_saude enxergar, em vez de sempre devolver 200 mesmo tudo falhando.
  const semNadaColetado = campanhas === 0 && (contas ?? []).length > 0;

  return new Response(JSON.stringify({
    ok: !semNadaColetado, dia, hora, contas: (contas ?? []).length, campanhas,
    degraded: degraded.length ? degraded : undefined,
  }), {
    status: semNadaColetado ? 500 : 200,
    headers: { 'Content-Type': 'application/json' },
  });
});
