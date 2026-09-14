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
// Quando não há dado nenhum pra essa hora (mensagem `null`, ou erro lendo o
// banco), manda um AVISO curto em vez de ficar em silêncio — pedido do dono
// (14/09/2026, depois do gap de 20h-22h do dia 13/09 passar batido até
// alguém notar no grupo). O aviso nunca inventa número: é só "não saiu",
// nunca um valor fabricado (padrão do projeto, PADRAO-DA-CENTRAL.md §9).
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { exigirSegredoDeCron } from '../_shared/segredo-de-cron.ts';
import {
  agruparPorDiaEHora, montarMensagemWpp, leadsWppNoDia, gastoWppNoDia, montarMensagemSeguidores,
  deltaDeSeguidoresPorHora, seguidoresNaHora, seguidoresTotalNaHora, seguidoresNoDia,
  gastoSeguidoresNoDia, visitasPerfilNoDia,
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

// Avisa no grupo quando não dá pra gerar relatório nenhum nessa hora — melhor
// um aviso curto do que silêncio total (pedido do dono, 14/09/2026: "quando
// não tiver dados, mandar uma mensagem avisando pelo menos" — foi assim que o
// gap de 20h-22h do dia 13/09 passou batido até alguém notar no grupo).
// Best-effort: se o próprio aviso falhar (Z-API fora do ar), não derruba a
// resposta da função, só entra em `falhas`.
async function avisarSemDados(dia: string, hora: number, motivo: string): Promise<string | null> {
  const [, mes, d] = dia.split('-');
  const horaStr = String(hora).padStart(2, '0');
  try {
    await mandarWhatsapp(`⚠️ Relatório das ${horaStr}h, ${d}/${mes} não saiu — ${motivo}.`);
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
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
  //
  // campaign_insights_hora vem do DIA INTEIRO, não só desta hora: precisa das
  // horas anteriores pra somar "Total de leads no dia" (pedido de um colega
  // no grupo, repassado pelo dono, 12/09/2026).
  const [linhasRes, campanhasRes, leiturasRes, visitasRes] = await Promise.all([
    sb.from('campaign_insights_hora').select('dia,hora,campaign_id,gasto_hora,gasto_acumulado,conversas_hora')
      .eq('account_id', CONTA_VESSEL).eq('dia', dia),
    sb.from('campaigns').select('campaign_id,name'),
    // 25h de folga: cobre a virada do dia (seguidor é estoque, delta
    // atravessa a meia-noite — ver deltaDeSeguidoresPorHora).
    sb.from('followers_leituras').select('followers_count,lido_em')
      .eq('account_id', CONTA_VESSEL)
      .gte('lido_em', new Date(Date.now() - 25 * 3600 * 1000).toISOString())
      .order('lido_em', { ascending: true }),
    // Dia inteiro também aqui (não só a hora) — pra somar "Total visitantes
    // dia" e "Custo visitantes dia" (pedido do dono, 12/09/2026, "MELHORIA").
    sb.from('perfil_visitas_hora').select('dia,hora,visitas_hora')
      .eq('account_id', CONTA_VESSEL).eq('dia', dia),
  ]);

  if (linhasRes.error) {
    const falhaAviso = await avisarSemDados(dia, hora, 'não consegui ler os dados de campanha');
    return json({ ok: true, enviado: false, motivo: 'campanhas_indisponivel', erro: linhasRes.error.message, falhaAviso });
  }
  if (campanhasRes.error) {
    const falhaAviso = await avisarSemDados(dia, hora, 'não consegui ler os dados de campanha');
    return json({ ok: true, enviado: false, motivo: 'campanhas_indisponivel', erro: campanhasRes.error.message, falhaAviso });
  }
  if (leiturasRes.error) {
    const falhaAviso = await avisarSemDados(dia, hora, 'não consegui ler os dados de seguidores');
    return json({ ok: true, enviado: false, motivo: 'seguidores_indisponivel', erro: leiturasRes.error.message, falhaAviso });
  }
  if (visitasRes.error) {
    const falhaAviso = await avisarSemDados(dia, hora, 'não consegui ler os dados de visita ao perfil');
    return json({ ok: true, enviado: false, motivo: 'visitas_indisponivel', erro: visitasRes.error.message, falhaAviso });
  }

  const nomesPorCampanha = Object.fromEntries((campanhasRes.data ?? []).map((c: any) => [c.campaign_id, c.name]));
  const agrupado = agruparPorDiaEHora(linhasRes.data ?? [], nomesPorCampanha);
  const horasDoDia = agrupado[0]?.horas ?? [];
  const campanhasDaHora = horasDoDia.find((h: any) => h.hora === hora)?.campanhas ?? [];
  const leadsHoje = leadsWppNoDia(horasDoDia);
  const gastoWppHoje = gastoWppNoDia(horasDoDia);

  const deltasSeguidores = deltaDeSeguidoresPorHora(leiturasRes.data ?? []);
  const seguidoresDelta = seguidoresNaHora(deltasSeguidores, dia, hora);
  const seguidoresTotal = seguidoresTotalNaHora(deltasSeguidores, dia, hora);
  const seguidoresHoje = seguidoresNoDia(deltasSeguidores, dia);
  const visitasDoDia = visitasRes.data ?? [];
  const visitasPerfilDelta = visitasDoDia.find((v: any) => v.hora === hora)?.visitas_hora ?? null;
  const visitasPerfilHoje = visitasPerfilNoDia(visitasDoDia, dia);
  // Gasto das campanhas [+ SEGUIDORES] nessa hora — pedido do dono (12/09/2026,
  // "faz uma linha de investimento também").
  const gastoSeguidores = campanhasDaHora
    .filter((c: any) => c.tipo === 'seguidores')
    .reduce((s: number, c: any) => s + c.gastoHora, 0);
  const gastoSeguidoresHoje = gastoSeguidoresNoDia(horasDoDia);

  const mensagens: [string, string | null][] = [
    ['wpp', montarMensagemWpp(dia, hora, campanhasDaHora, leadsHoje, gastoWppHoje)],
    ['seguidores', montarMensagemSeguidores(
      dia, hora, seguidoresDelta, visitasPerfilDelta, seguidoresTotal, seguidoresHoje, gastoSeguidores,
      gastoSeguidoresHoje, visitasPerfilHoje,
    )],
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

  // Nenhuma das duas tinha o que dizer (não é erro de leitura — as queries
  // acima foram bem, só não tinha dado pra essa hora) — avisa mesmo assim,
  // em vez de sumir sem explicação (pedido do dono, 14/09/2026).
  if (!enviadas.length && !falhas.length) {
    const falhaAviso = await avisarSemDados(dia, hora, 'sem dado disponível pra essa hora');
    if (falhaAviso) falhas.push(`aviso: ${falhaAviso}`);
  }

  return json({
    ok: falhas.length === 0, dia, hora, enviadas,
    falhas: falhas.length ? falhas : undefined,
  }, falhas.length && !enviadas.length ? 500 : 200);
});
