// supabase/functions/enviar-relatorio-hora/index.ts
// Cron de hora em hora (minuto 10 — 5 min depois de coletar-dados-hora, pra
// dar folga pro dado da hora já estar gravado): manda os dois relatórios da
// hora que acabou de fechar num grupo de WhatsApp, via Z-API. Pedido do dono
// (12/09/2026): "você vai começar a enviar os relatórios horários lá naquele
// grupo toda vez agora... os dois relatórios em mensagens separadas".
//
// MESMA REGRA da tela: ver _shared/relatorio-por-hora.js, cópia comentada de
// src/ferramentas/meta-ads/relatorio-por-hora.js (mesmo texto que a tela
// mostraria em "Mensagem WPP"/"Mensagem Seguidores" pra esta hora).
//
// SÓ A CONTA VESSEL, de propósito — mesmo recorte fixo que a tela usa
// (CONTA_VESSEL em tela-de-relatorio-por-hora.vue).
//
// NÃO MANDA quando a mensagem dá `null` (nada pra dizer nessa hora) — e NÃO
// MANDA quando não dá pra ler o banco com segurança: aviso errado é pior que
// aviso nenhum (padrão do projeto, PADRAO-DA-CENTRAL.md §9).
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { exigirSegredoDeCron } from '../_shared/segredo-de-cron.ts';
import {
  agruparPorDiaEHora, montarMensagemWpp, montarMensagemSeguidores,
  deltaDeSeguidoresPorHora, seguidoresNaHora, seguidoresTotalNaHora, seguidoresNoDia,
} from '../_shared/relatorio-por-hora.js';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const CONTA_VESSEL = 'b6883e82-07cb-4f21-9fd7-ea7626786174';

// ⚠️ "Grupo de teste z-api" — o grupo que o dono entrou em 12/09/2026 pra
// validar o envio (aceito via Z-API `accept-invite-group`). Trocar aqui
// quando for pro grupo de verdade — pega o novo `phone` com
// GET .../group-invitation-metadata?url=<link do grupo>.
const GRUPO_WHATSAPP = '120363431546698175-group';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });

function todayBR(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
}
// Hora de parede em São Paulo (0-23) — mesma regra de coletar-dados-hora: é
// a hora que a pessoa vai ler na mensagem, não a hora UTC.
function horaBR(): number {
  return Number(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo', hour: '2-digit', hour12: false }));
}

// Uma mensagem de texto pro grupo. Lança se a Z-API recusar — quem chama
// decide se aquilo derruba só esta mensagem ou a rodada inteira.
async function mandarWhatsapp(mensagem: string): Promise<void> {
  const instanceId = Deno.env.get('ZAPI_INSTANCE_ID')!;
  const instanceToken = Deno.env.get('ZAPI_INSTANCE_TOKEN')!;
  const clientToken = Deno.env.get('ZAPI_TOKEN')!;
  const r = await fetch(`https://api.z-api.io/instances/${instanceId}/token/${instanceToken}/send-text`, {
    method: 'POST',
    headers: { 'Client-Token': clientToken, 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: GRUPO_WHATSAPP, message: mensagem }),
  });
  if (!r.ok) throw new Error(`Z-API send-text: ${r.status} ${await r.text()}`);
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const negado = await exigirSegredoDeCron(req, 'enviar-relatorio-hora');
  if (negado) return negado;

  const sb = createClient(SUPABASE_URL, SERVICE_KEY);
  const dia = todayBR();
  const hora = horaBR();

  // As quatro leituras não dependem uma da outra — em paralelo (mesmo
  // cuidado do code review de 12/09/2026 em coletar-dados-hora).
  const [linhasRes, campanhasRes, leiturasRes, visitasRes] = await Promise.all([
    sb.from('campaign_insights_hora').select('dia,hora,campaign_id,gasto_hora,conversas_hora')
      .eq('account_id', CONTA_VESSEL).eq('dia', dia).eq('hora', hora),
    sb.from('campaigns').select('campaign_id,name'),
    // 25h de folga: cobre a virada do dia (seguidor é estoque, delta
    // atravessa a meia-noite — ver deltaDeSeguidoresPorHora).
    sb.from('followers_leituras').select('followers_count,lido_em')
      .eq('account_id', CONTA_VESSEL)
      .gte('lido_em', new Date(Date.now() - 25 * 3600 * 1000).toISOString())
      .order('lido_em', { ascending: true }),
    sb.from('perfil_visitas_hora').select('visitas_hora')
      .eq('account_id', CONTA_VESSEL).eq('dia', dia).eq('hora', hora).maybeSingle(),
  ]);

  if (linhasRes.error) return json({ ok: true, enviado: false, motivo: 'campanhas_indisponivel', erro: linhasRes.error.message });
  if (campanhasRes.error) return json({ ok: true, enviado: false, motivo: 'campanhas_indisponivel', erro: campanhasRes.error.message });
  if (leiturasRes.error) return json({ ok: true, enviado: false, motivo: 'seguidores_indisponivel', erro: leiturasRes.error.message });
  if (visitasRes.error) return json({ ok: true, enviado: false, motivo: 'visitas_indisponivel', erro: visitasRes.error.message });

  const nomesPorCampanha = Object.fromEntries((campanhasRes.data ?? []).map((c: any) => [c.campaign_id, c.name]));
  const agrupado = agruparPorDiaEHora(linhasRes.data ?? [], nomesPorCampanha);
  const campanhasDaHora = agrupado[0]?.horas?.[0]?.campanhas ?? [];

  const deltasSeguidores = deltaDeSeguidoresPorHora(leiturasRes.data ?? []);
  const seguidoresDelta = seguidoresNaHora(deltasSeguidores, dia, hora);
  const seguidoresTotal = seguidoresTotalNaHora(deltasSeguidores, dia, hora);
  const seguidoresHoje = seguidoresNoDia(deltasSeguidores, dia);
  const visitasPerfilDelta = visitasRes.data?.visitas_hora ?? null;

  const mensagens: [string, string | null][] = [
    ['wpp', montarMensagemWpp(dia, hora, campanhasDaHora)],
    ['seguidores', montarMensagemSeguidores(dia, hora, seguidoresDelta, visitasPerfilDelta, seguidoresTotal, seguidoresHoje)],
  ];

  // As DUAS em mensagens separadas (pedido do dono, 12/09/2026), na ORDEM
  // acima — uma falhando não impede a outra de tentar.
  const enviadas: string[] = [];
  const falhas: string[] = [];
  for (const [nome, msg] of mensagens) {
    if (!msg) continue;
    try {
      await mandarWhatsapp(msg);
      enviadas.push(nome);
    } catch (e) {
      falhas.push(`${nome}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return json({
    ok: falhas.length === 0, dia, hora, enviadas,
    falhas: falhas.length ? falhas : undefined,
  }, falhas.length && !enviadas.length ? 500 : 200);
});
