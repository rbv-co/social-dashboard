import { createClient } from 'jsr:@supabase/supabase-js@2';
import { exigirSegredoDeCron } from '../_shared/segredo-de-cron.ts';
import {
  conversasIniciadas, calcularDeltaHora, visitasNoPerfil, deltaSimples,
} from '../_shared/delta-de-hora.js';

const GRAPH = 'https://graph.facebook.com/v22.0';

function todayBR(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
}

// Hora de parede em São Paulo (0-23), não UTC — é a hora que a pessoa vai
// ler na tela. Ver "a hora gravada é a hora da rodada" na spec, §4.
function horaBR(): number {
  return Number(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo', hour: '2-digit', hour12: false }));
}

// Meia-noite em São Paulo, em epoch — usado pra pedir "quanto teve HOJE até
// agora" pro profile_views (metric_type=total_value exige since/until, não
// tem period=hour). Brasil não observa horário de verão desde 2019, -03:00 é
// fixo o ano inteiro — não precisa calcular fuso.
function epochInicioDoDiaSP(dia: string): number {
  return Math.floor(new Date(`${dia}T00:00:00-03:00`).getTime() / 1000);
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
      .select('campaign_id,gasto_acumulado,conversas_acumuladas,cliques_acumulados,hora')
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
      const visitasAcumuladas = visitasNoPerfil(r.actions);
      const anterior = anteriorPorCampanha.get(campaignId) ?? null;
      const { gasto_hora, conversas_hora } = calcularDeltaHora(gastoAcumulado, conversasAcumuladas, anterior);
      const cliques_hora = deltaSimples(visitasAcumuladas, anterior?.cliques_acumulados);
      return {
        campaign_id: campaignId, account_id: accountId, dia, hora,
        gasto_acumulado: gastoAcumulado, conversas_acumuladas: conversasAcumuladas,
        // Coluna se chama "cliques_*" por herança do schema (db/migrations/
        // 2026-09-12-meta-ads-hora-cliques.sql) — o CONTEÚDO virou visita ao
        // perfil (profile_visits/profile_views), nunca mais link_click. Ver
        // visitasNoPerfil() em _shared/delta-de-hora.js.
        cliques_acumulados: visitasAcumuladas,
        gasto_hora, conversas_hora, cliques_hora,
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

// Visitas ao perfil da CONTA (profile_views) — pedido do dono (12/09/2026,
// "vai atras desse dado"). Só existe agregado da conta inteira (orgânico +
// todo anúncio), nunca por campanha — conferido ao vivo que nenhum anúncio
// [+ SEGUIDORES] tem destino "Instagram Profile" (mesmo motivo do fallback
// em visitasNoPerfil()). E só vem como ACUMULADO DO DIA
// (metric_type=total_value; period=hour não existe — testado na Graph API
// real em 12/09/2026, devolve erro). Por isso o desenho é igual ao gasto:
// pergunta "quanto teve hoje até agora" e calcula o delta contra a hora
// anterior da MESMA conta, MESMO dia — reseta na virada (é atividade, não
// estoque como seguidor).
async function coletarVisitasPerfilDaConta(sb: any, acc: any, dia: string, hora: number, degraded: string[]): Promise<void> {
  const { id: accountId, instagram_id: igId, access_token: token, name } = acc;
  if (!igId || !token) return;
  try {
    const d = await apiGet(`${igId}/insights`, {
      metric: 'profile_views',
      metric_type: 'total_value',
      period: 'day',
      since: String(epochInicioDoDiaSP(dia)),
      until: String(Math.floor(Date.now() / 1000)),
      access_token: token,
    });
    const visitasAcumuladas = d.data?.[0]?.total_value?.value ?? 0;

    // Última linha já gravada HOJE ANTES desta hora (mesmo padrão de
    // coletarConta) — pra não comparar consigo mesma numa segunda rodada.
    const { data: anteriorRows, error: erroAnterior } = await sb
      .from('perfil_visitas_hora')
      .select('visitas_acumuladas')
      .eq('account_id', accountId).eq('dia', dia).lt('hora', hora)
      .order('hora', { ascending: false })
      .limit(1);
    if (erroAnterior) {
      degraded.push(`${name}: falha ao ler visitas ao perfil anteriores (${erroAnterior.message})`);
      return;
    }
    const visitas_hora = deltaSimples(visitasAcumuladas, anteriorRows?.[0]?.visitas_acumuladas);

    const { error } = await sb.from('perfil_visitas_hora').upsert(
      { account_id: accountId, dia, hora, visitas_acumuladas: visitasAcumuladas, visitas_hora },
      { onConflict: 'account_id,dia,hora' },
    );
    if (error) degraded.push(`${name}: falha ao gravar visitas ao perfil (${error.message})`);
  } catch (e) {
    degraded.push(`${name}: visitas ao perfil (${e instanceof Error ? e.message : String(e)})`);
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
    await coletarVisitasPerfilDaConta(sb, acc, dia, hora, degraded);
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
