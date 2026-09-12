// supabase/functions/enviar-push-vendas/index.ts
// Cron 22h BRT: agrega vendas do dia (hoje vs ontem) por canal e envia UM push
// consolidado a todas as inscrições push_subs.
//
// EXATIDÃO EM PRIMEIRO LUGAR: só envia se conseguir o dado 100% íntegro. Se faltar
// token do Bling, o Bling estiver fora (mesmo após retentativas), ou não der pra
// contar TODOS os itens, a função NÃO envia nada (melhor silêncio do que um número
// errado/zerado). Retenta as chamadas do Bling pra absorver soluços passageiros.
//
// Dados do Bling:
//  - Lista `pedidos/vendas` (situação 9) -> faturamento (R$) e nº de vendas, exatos.
//  - Itens por pedido: não vêm na lista. Lemos do cache `bling_pedido_vendedor`
//    (que a Gestão à Vista popula) e buscamos o detalhe só do que falta. Se algum
//    detalhe falhar ou estourar o tempo, os itens não estariam exatos -> não envia.
//
// Auth do Bling: lemos `bling_tokens` direto (service role), SÓ LEITURA — sem
// refresh (pra não competir com o bling-proxy; refresh token é single-use).
import { createClient } from 'jsr:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3';
import { agregarVendasPorCanal, montarCorpo } from '../_shared/vendas-do-dia.js';
import { ajustarPelaDataDaNota } from '../_shared/data-da-venda.js';
import { exigirSegredoDeCron } from '../_shared/segredo-de-cron.ts';
// Quem quer receber ESTE tipo (ver _shared/notificacoes.js). 'vendas' vem
// ligado por padrão — quem não quiser, o admin desliga na tela de Usuários.
import { inscricoesDoTipo } from '../_shared/notificacoes.js';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const BLING_BASE = 'https://api.bling.com.br/Api/v3';

const ITENS_BUDGET_MS = 90_000;   // teto de tempo pra detalhar itens
const ITENS_CONCORRENCIA = 8;     // chamadas simultâneas ao Bling
const BLING_TENTATIVAS = 3;       // retentativas por chamada (absorve rate-limit)

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });

// Datas em BRT (UTC-3, o Brasil não tem mais horário de verão) como YYYY-MM-DD.
function brtDatas(): { hoje: string; ontem: string; anteontem: string } {
  const nowBrt = new Date(Date.now() - 3 * 3600 * 1000);
  const iso = (x: Date) => x.toISOString().slice(0, 10);
  const ontem = new Date(nowBrt);
  ontem.setUTCDate(ontem.getUTCDate() - 1);
  const anteontem = new Date(nowBrt);
  anteontem.setUTCDate(anteontem.getUTCDate() - 2);
  return { hoje: iso(nowBrt), ontem: iso(ontem), anteontem: iso(anteontem) };
}

async function lerTokenBling(sb: ReturnType<typeof createClient>): Promise<string | null> {
  const { data } = await sb.from('bling_tokens').select('access_token, expires_at')
    .order('id', { ascending: false }).limit(1).single();
  if (!data?.access_token) return null;
  if (new Date(data.expires_at) <= new Date(Date.now() + 60 * 1000)) return null; // vencido/quase
  return data.access_token as string;
}

async function blingGet(token: string, endpoint: string, params: Record<string, unknown> = {}) {
  const url = new URL(`${BLING_BASE}/${endpoint}`);
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    if (Array.isArray(v)) for (const it of v) url.searchParams.append(k, String(it));
    else url.searchParams.set(k, String(v));
  }
  const r = await fetch(url.toString(), { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) throw new Error(`bling ${endpoint} -> ${r.status}`);
  return r.json();
}

// blingGet com retentativas + backoff — absorve rate-limit/soluço passageiro.
async function blingGetRetry(token: string, endpoint: string, params: Record<string, unknown> = {}) {
  let ultimoErro: unknown;
  for (let t = 0; t < BLING_TENTATIVAS; t++) {
    try { return await blingGet(token, endpoint, params); }
    catch (e) { ultimoErro = e; await new Promise((r) => setTimeout(r, 600 * (t + 1))); }
  }
  throw ultimoErro;
}

// Lista pedidos de vendas (situação 9 = atendido/finalizado) num dia, paginando.
// Lança se o Bling falhar (mesmo após retentativas) — quem chama decide não enviar.
async function listarPedidos(token: string, dia: string) {
  const all: any[] = [];
  for (let page = 1; page <= 10; page++) {
    const resp = await blingGetRetry(token, 'pedidos/vendas', {
      dataInicial: dia, dataFinal: dia, 'idsSituacoes[]': 9, pagina: page, limite: 100,
    });
    const d = resp?.data;
    if (!Array.isArray(d) || d.length === 0) break;
    all.push(...d);
    if (d.length < 100) break;
  }
  return all;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const negado = await exigirSegredoDeCron(req, 'enviar-push-vendas');
  if (negado) return negado;

  const sb = createClient(SUPABASE_URL, SERVICE_KEY);

  // VAPID vem de segredos_de_cron (service role) — nada de env/secret manual.
  const { data: segr } = await sb.from('segredos_de_cron').select('nome, segredo')
    .in('nome', ['vapid_public_key', 'vapid_private_key', 'vapid_subject']);
  const seg = Object.fromEntries((segr || []).map((r: any) => [r.nome, r.segredo]));
  if (!seg.vapid_public_key || !seg.vapid_private_key) return json({ error: 'vapid_nao_configurado' }, 500);
  webpush.setVapidDetails(seg.vapid_subject || 'mailto:breno@rbvcompany.com', seg.vapid_public_key, seg.vapid_private_key);

  const { hoje, ontem, anteontem } = brtDatas();

  // Modo do disparo: 22h -> 'hoje' (padrão, fechamento do dia); 07h -> 'ontem'
  // (recap da manhã: mostra o dia que acabou vs anteontem).
  let modo = 'hoje';
  try { const corpo = await req.json(); if (corpo?.modo === 'ontem') modo = 'ontem'; } catch { /* sem corpo -> hoje */ }
  const diaRef = modo === 'ontem' ? ontem : hoje;
  const diaCmp = modo === 'ontem' ? anteontem : ontem;
  const refLabel = modo === 'ontem' ? 'ontem' : 'hoje';
  const cmpLabel = modo === 'ontem' ? 'anteontem' : 'ontem';

  // 1) Token do Bling. Sem token válido -> NÃO envia.
  const token = await lerTokenBling(sb);
  if (!token) return json({ ok: true, enviado: false, motivo: 'sem_token_bling' });

  // 2) Pedidos do dia de referência e de comparação (com retentativas). Se o Bling
  //    falhar -> NÃO envia.
  let pedRef: any[], pedCmp: any[];
  try {
    [pedRef, pedCmp] = await Promise.all([listarPedidos(token, diaRef), listarPedidos(token, diaCmp)]);
  } catch (e) {
    return json({ ok: true, enviado: false, motivo: 'bling_indisponivel', erro: String(e) });
  }

  // 2b) A VENDA CONTA NO DIA DA NOTA, não no dia do pedido. O Bling entrega por
  //     data do pedido; a loja emite NFC-e na hora e o Atacado emite NF-e no dia
  //     seguinte. Sem este ajuste, o push da noite e o telão dariam números
  //     DIFERENTES para o mesmo dia — e dois lugares discordando é pior que um
  //     errado, porque ninguém sabe em qual acreditar.
  //
  //     Regra desta Edge, mais dura que a das telas: aqui não existe "mostra o
  //     que dá". Se não der para saber a data certa, NÃO ENVIA — a mesma regra
  //     que já vale para token, Bling fora do ar e itens incompletos.
  const linhasDoDia = async (dia: string) => {
    const { data, error } = await sb.from('bling_pedido_nota')
      .select('pedido_id,pedido_numero,data_pedido,data_da_venda,total,loja_id')
      .or(`and(data_da_venda.gte.${dia},data_da_venda.lte.${dia}),and(data_pedido.gte.${dia},data_pedido.lte.${dia})`);
    if (error) throw new Error(`bling_pedido_nota: ${error.message}`);
    return data || [];
  };
  try {
    const [lRef, lCmp] = await Promise.all([linhasDoDia(diaRef), linhasDoDia(diaCmp)]);
    pedRef = ajustarPelaDataDaNota(pedRef, lRef, diaRef, diaRef).pedidos;
    pedCmp = ajustarPelaDataDaNota(pedCmp, lCmp, diaCmp, diaCmp).pedidos;
  } catch (e) {
    return json({ ok: true, enviado: false, motivo: 'data_da_venda_indisponivel', erro: String(e) });
  }

  // 3) Itens por pedido: cache + detalhe do que falta. Se não der pra contar TODOS
  //    (falha ou estouro de tempo), os itens não seriam exatos -> NÃO envia.
  //    Roda DEPOIS do ajuste acima, para contar os itens dos pedidos que entraram
  //    de outro dia — senão eles chegariam ao push com zero itens.
  const todos = [...pedRef, ...pedCmp];
  const ids = todos.map((p) => parseInt(p.id)).filter(Boolean);
  const cache = new Map<number, number>();
  for (let i = 0; i < ids.length; i += 500) {
    const bloco = ids.slice(i, i + 500);
    const { data } = await sb.from('bling_pedido_vendedor').select('pedido_id, qtd_itens').in('pedido_id', bloco);
    for (const r of (data || [])) if (r.qtd_itens != null) cache.set(r.pedido_id, r.qtd_itens);
  }

  const faltantes = todos.filter((p) => !cache.has(parseInt(p.id)));
  if (faltantes.length) {
    const inicio = Date.now();
    let i = 0;
    let itensOk = true;
    const worker = async () => {
      while (i < faltantes.length && itensOk) {
        if (Date.now() - inicio > ITENS_BUDGET_MS) { itensOk = false; return; }
        const p = faltantes[i++];
        try {
          const det = await blingGetRetry(token, `pedidos/vendas/${p.id}`);
          cache.set(parseInt(p.id), Array.isArray(det?.data?.itens) ? det.data.itens.length : 0);
        } catch { itensOk = false; return; }
      }
    };
    await Promise.all(Array.from({ length: Math.min(ITENS_CONCORRENCIA, faltantes.length) }, worker));
    if (!itensOk) return json({ ok: true, enviado: false, motivo: 'itens_incompletos' });
  }

  // 4) Agrega (tudo exato agora) e envia.
  const normalizar = (p: any) => ({
    loja_id: p.loja?.id ?? p.loja_id ?? null,
    total: Number(p.total) || 0,
    itens: cache.get(parseInt(p.id)) || 0,
  });

  const { data: lojas } = await sb.from('bling_lojas').select('loja_id,nome');
  const lojasNorm = (lojas || []).map((l: any) => ({ loja_id: l.loja_id, nome: l.nome }));
  const agg = agregarVendasPorCanal({
    pedidosHoje: pedRef.map(normalizar),   // "referência" = diaRef (hoje ou ontem)
    pedidosOntem: pedCmp.map(normalizar),  // "comparação" = diaCmp (ontem ou anteontem)
    lojas: lojasNorm,
  });
  const payload = JSON.stringify(montarCorpo(agg, { refLabel, cmpLabel }));

  const [{ data: subs }, { data: prefs }] = await Promise.all([
    sb.from('push_subs').select('*'),
    sb.from('push_preferencias').select('user_id,tipo,ativo'),
  ]);
  const alvos = inscricoesDoTipo(subs, prefs, 'vendas');
  let enviados = 0, podados = 0;
  for (const s of alvos) {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        payload,
      );
      enviados++;
    } catch (err: any) {
      if (err?.statusCode === 410 || err?.statusCode === 404) {
        await sb.from('push_subs').delete().eq('endpoint', s.endpoint);
        podados++;
      }
    }
  }

  return json({ ok: true, enviado: true, modo, diaRef, diaCmp, pedidos: todos.length, enviados, podados, total: agg.total });
});
