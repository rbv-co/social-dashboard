// coletor/lib/visitas-perfil-meta.mjs
// Busca "Visitas ao Perfil" (profile_views) do Instagram DIRETO da Meta, pro
// dia já FECHADO — não soma `perfil_visitas_hora` (achado com o dono,
// 17/09/2026, batido em dois dias seguidos, 15 e 16/09: faltavam ~280-290
// visitas por dia). Causa: a leitura de hora em hora pergunta "quantas
// visitas desde a meia-noite até AGORA", e a última do dia roda por volta
// das 23:05 (SP) — não existe mais nenhuma leitura entre 23:05 e a virada,
// então os últimos ~55 minutos do dia (justo o pico de movimento) nunca são
// contados. O fechamento roda de manhã, bem depois da virada — pede o dia
// inteiro já fechado numa chamada só, sem esse buraco.
const GRAPH = 'https://graph.facebook.com/v22.0';

// Brasil não observa horário de verão desde 2019 — -03:00 é fixo o ano
// inteiro, não precisa calcular fuso.
export function epochDoDiaSP(diaISO) {
  const since = Math.floor(new Date(`${diaISO}T00:00:00-03:00`).getTime() / 1000);
  const until = since + 24 * 3600;
  return { since, until };
}

export async function visitasPerfilDoDiaMeta(igId, token, diaISO) {
  const { since, until } = epochDoDiaSP(diaISO);
  const url = new URL(`${GRAPH}/${igId}/insights`);
  url.searchParams.set('metric', 'profile_views');
  url.searchParams.set('metric_type', 'total_value');
  url.searchParams.set('period', 'day');
  url.searchParams.set('since', String(since));
  url.searchParams.set('until', String(until));
  url.searchParams.set('access_token', token);
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Meta API profile_views: ${r.status} ${await r.text()}`);
  const d = await r.json();
  return d.data?.[0]?.total_value?.value ?? 0;
}

// Grava o cache que a tela lê (visitas_perfil_dia) — upsert por
// (account_id, dia), então rodar de novo pro mesmo dia só atualiza.
export async function salvarVisitasPerfilDoDia(restUrl, headers, accountId, diaISO, visitas) {
  const r = await fetch(`${restUrl}/visitas_perfil_dia?on_conflict=account_id,dia`, {
    method: 'POST',
    headers: { ...headers, Prefer: 'resolution=merge-duplicates' },
    body: JSON.stringify({ account_id: accountId, dia: diaISO, visitas }),
  });
  if (!r.ok) throw new Error(`Supabase upsert visitas_perfil_dia: ${r.status} ${await r.text()}`);
}
