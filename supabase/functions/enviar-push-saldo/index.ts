// supabase/functions/enviar-push-saldo/index.ts
// Cron da manhã: olha o saldo das contas de anúncios e manda UM push quando
// alguma está acabando. Nada urgente → não envia nada.
//
// A ARMADILHA DESTE DADO: o campo `balance` da Meta NÃO é saldo, é a FATURA em
// aberto. Conta de cartão tem `balance` alto e nunca fica sem saldo; conta
// pré-paga tem `balance` que não bate com o disponível. O saldo de verdade só
// chega como TEXTO em `funding_source_details.display_string` ("Saldo disponível
// (R$ 1.673,75 BRL)"). Toda essa leitura mora em _shared/saldo-de-conta.js, que
// é puro e testado — aqui só se busca e se envia.
//
// SILÊNCIO É MELHOR QUE NÚMERO ERRADO, mesma regra do push de vendas: se o texto
// do saldo não for reconhecido, a conta cai em 'nao-sei' e NÃO vira aviso. Um
// push sobre dinheiro que erra o valor ensina a ignorar push.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3';
import { lerSaldo, montarAvisoDeSaldo } from '../_shared/saldo-de-conta.js';
import { exigirSegredoDeCron } from '../_shared/segredo-de-cron.ts';
// Quem quer receber ESTE tipo. Sem isto o push ia pra todas as inscrições — e
// saldo de conta de anúncio não é assunto de todo mundo.
import { inscricoesDoTipo } from '../_shared/notificacoes.js';
import { metaDoCore } from '../_shared/core-meta.js';

// CORE_META=true: a Graph passa pelo proxy do `core` (token global; não lê accounts.access_token). Ver _shared/core-meta.js.
const META = metaDoCore(Deno.env.toObject());

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const GRAPH = 'https://graph.facebook.com/v21.0';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });

const limparId = (v: string) => String(v || '').replace(/^act_/, '');

async function graph(caminho: string, params: Record<string, string>, token: string) {
  const u = new URL(`${GRAPH}/${caminho}`);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  u.searchParams.set('access_token', token);
  const r = await META.fetch(u);
  const j = await r.json();
  if (j && j.error) throw new Error(j.error.message || 'erro na Meta');
  return j;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  // O segredo é POR FUNÇÃO (linha 'enviar-push-saldo' em segredos_de_cron), do
  // mesmo jeito que enviar-push-vendas: quem souber o segredo de uma não dispara
  // a outra.
  const negado = await exigirSegredoDeCron(req, 'enviar-push-saldo');
  if (negado) return negado;

  const sb = createClient(SUPABASE_URL, SERVICE_KEY);

  const { data: segr } = await sb.from('segredos_de_cron').select('nome, segredo')
    .in('nome', ['vapid_public_key', 'vapid_private_key', 'vapid_subject']);
  const seg = Object.fromEntries((segr || []).map((r: any) => [r.nome, r.segredo]));
  if (!seg.vapid_public_key || !seg.vapid_private_key) return json({ error: 'vapid_nao_configurado' }, 500);
  webpush.setVapidDetails(seg.vapid_subject || 'mailto:breno@rbvcompany.com', seg.vapid_public_key, seg.vapid_private_key);

  const { data: contas } = await sb.from('accounts').select(META.colunas('id,name,ad_account_id,access_token'));
  const comConta = (contas || []).filter((c: any) => c.ad_account_id && META.token(c));
  if (!comConta.length) return json({ ok: true, enviado: false, motivo: 'sem_contas' });

  // Uma conta que falhe não derruba as outras: o aviso das demais continua
  // valendo, e o motivo de cada falha volta na resposta pra dar pra investigar.
  const leituras: any[] = [];
  const falhas: any[] = [];
  for (const c of comConta) {
    const acc = limparId(c.ad_account_id);
    try {
      const [detalhe, insights] = await Promise.all([
        graph(`act_${acc}`, { fields: 'is_prepay_account,funding_source_details' }, META.token(c)),
        // Ritmo dos últimos 7 dias — é o que transforma "R$ 200" em "dura 2
        // dias". Sem ele o módulo não estima prazo e a conta não vira aviso.
        graph(`act_${acc}/insights`, { date_preset: 'last_7d', fields: 'spend' }, META.token(c)).catch(() => null),
      ]);
      const gasto7 = Number(insights?.data?.[0]?.spend || 0);
      leituras.push({ ...lerSaldo(detalhe, gasto7 / 7), conta: c.name || acc, account_id: c.id });
    } catch (e) {
      falhas.push({ conta: c.name || acc, erro: String(e) });
    }
  }

  const aviso = montarAvisoDeSaldo(leituras);
  if (!aviso) {
    return json({
      ok: true, enviado: false, motivo: 'nada_urgente',
      // O resumo volta mesmo sem envio: é como se confere que a função está
      // lendo certo sem precisar esperar uma conta acabar.
      leituras: leituras.map((l) => ({ conta: l.conta, nivel: l.nivel, reais: l.reais })), falhas,
    });
  }

  const payload = JSON.stringify({
    title: aviso.titulo,
    body: aviso.corpo,
    tag: 'gt-saldo',              // substitui o aviso anterior em vez de empilhar
    url: '/gestao-trafego',
  });

  const [{ data: subs }, { data: prefs }] = await Promise.all([
    sb.from('push_subs').select('*'),
    sb.from('push_preferencias').select('user_id,tipo,ativo'),
  ]);
  const alvos = inscricoesDoTipo(subs, prefs, 'saldo');
  if (!alvos.length) {
    return json({ ok: true, enviado: false, motivo: 'ninguem_quer_este_tipo', titulo: aviso.titulo });
  }
  let enviados = 0, podados = 0;
  for (const s of alvos) {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload);
      enviados++;
    } catch (err: any) {
      // 410/404 = inscrição morta (app desinstalado, permissão revogada).
      if (err?.statusCode === 410 || err?.statusCode === 404) {
        await sb.from('push_subs').delete().eq('endpoint', s.endpoint);
        podados++;
      }
    }
  }

  return json({ ok: true, enviado: true, titulo: aviso.titulo, corpo: aviso.corpo, enviados, podados, falhas });
});
