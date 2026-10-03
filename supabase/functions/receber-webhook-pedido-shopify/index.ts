// supabase/functions/receber-webhook-pedido-shopify/index.ts
//
// Webhook NATIVO da Shopify para pedido — mesma família de
// receber-webhook-checkout, mas para o evento de PEDIDO (não checkout
// iniciado). Cadastrar no admin da Shopify (Configurações → Notificações →
// Webhooks) apontando pra esta URL, nos tópicos orders/create, orders/paid e
// orders/updated — os três mandam o MESMO formato de objeto "order", e o
// upsert por id aqui é idempotente, então não importa qual tópico disparou
// nem se a Shopify reentrega o mesmo evento (ela reentrega se não receber 2xx
// a tempo — comportamento documentado).
//
// Mesma autenticação de receber-webhook-checkout: assinatura HMAC no
// cabeçalho X-Shopify-Hmac-Sha256, contra SHOPIFY_WEBHOOK_SECRET.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { assinaturaValida } from '../_shared/verificar-webhook-shopify.js';
import { pedidoDoPayload } from '../_shared/pedido-shopify.js';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const SEGREDO_DO_WEBHOOK = Deno.env.get('SHOPIFY_WEBHOOK_SECRET') ?? '';

const responder = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method !== 'POST') return responder({ ok: false }, 405);

  const corpoCru = await req.text();
  const assinatura = req.headers.get('x-shopify-hmac-sha256');
  if (!(await assinaturaValida(SEGREDO_DO_WEBHOOK, corpoCru, assinatura))) {
    return responder({ error: 'nao_autorizado' }, 401);
  }

  const pedido = pedidoDoPayload(JSON.parse(corpoCru));
  if (!pedido) return responder({ ok: true, ignorado: 'payload sem id' });

  const sb = createClient(SUPABASE_URL, SERVICE_KEY);
  const { error } = await sb.from('shopify_pedidos').upsert({
    id: pedido.id, numero: pedido.numero, loja_id: pedido.loja_id, total: pedido.total,
    moeda: pedido.moeda, status_financeiro: pedido.status_financeiro,
    cliente_nome: pedido.cliente_nome, cliente_email: pedido.cliente_email,
    criado_em_shopify: pedido.criado_em_shopify, bruto: pedido.bruto,
    atualizado_em: new Date().toISOString(),
  });
  // A Shopify tenta de novo se não receber 2xx — erro de banco nunca deve
  // virar tempestade de retentativas por um problema que retry não resolve;
  // loga pro robô (que roda de hora em hora) alcançar depois.
  if (error) console.error('falha ao gravar pedido da Shopify:', error.message);

  return responder({ ok: true });
});
