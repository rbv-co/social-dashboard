// supabase/functions/receber-webhook-checkout/index.ts
//
// Webhook NATIVO da Shopify (checkouts/create) — diferente do
// capturar-evento-carrinho (que recebe do interceptador colado no tema).
// O checkout da Shopify roda numa aplicação separada do tema; nenhum
// script nosso chega a carregar lá (confirmado ao vivo, 18/09/2026: o HTML
// da página de checkout não inclui o interceptador). Por isso o
// checkout_iniciado do MVP nunca disparou de verdade — este webhook é quem
// resolve isso, sem depender de tema nenhum: a própria Shopify chama a
// gente quando um checkout começa.
//
// Quem chama aqui é o SERVIDOR da Shopify, não um navegador — não tem
// Origin de página pra conferir feito no capturar-evento-carrinho. Quem
// autentica é a assinatura HMAC no cabeçalho X-Shopify-Hmac-Sha256, contra
// o segredo mostrado quando o webhook é cadastrado em Configurações >
// Notificações > Webhooks no admin da loja (SHOPIFY_WEBHOOK_SECRET).
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { assinaturaValida, extrairEventoDeCheckout } from '../_shared/verificar-webhook-shopify.js';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const SEGREDO_DO_WEBHOOK = Deno.env.get('SHOPIFY_WEBHOOK_SECRET') ?? '';

const responder = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method !== 'POST') return responder({ ok: false }, 405);

  // Precisa ser o corpo CRU, exatamente como a Shopify mandou — a
  // assinatura é sobre os bytes originais; reserializar o JSON (mesmo que
  // pareça igual) já quebraria a comparação.
  const corpoCru = await req.text();
  const assinatura = req.headers.get('x-shopify-hmac-sha256');
  if (!(await assinaturaValida(SEGREDO_DO_WEBHOOK, corpoCru, assinatura))) {
    return responder({ error: 'nao_autorizado' }, 401);
  }

  const corpo = JSON.parse(corpoCru);
  const evento = extrairEventoDeCheckout(corpo);

  const sb = createClient(SUPABASE_URL, SERVICE_KEY);
  const { error } = await sb.from('carrinho_eventos').insert(evento);
  // A Shopify tenta de novo se não receber 2xx — erro de banco nunca deve
  // virar uma tempestade de retentativas por um problema que retry nenhum
  // resolve; loga pro robô investigar depois, mas responde 200 assim mesmo.
  if (error) console.error('falha ao gravar checkout_iniciado:', error.message);

  return responder({ ok: true });
});
