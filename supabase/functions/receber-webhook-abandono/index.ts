// supabase/functions/receber-webhook-abandono/index.ts
//
// Webhook NATIVO da Shopify para a fila de checkouts abandonados. Tópicos:
// checkouts/create, checkouts/update, orders/create. Cadastrar cada um apontando
// para esta função (ver LEIA-ME de src/ferramentas/abandono-carrinho).
//
// Irmã do `receber-webhook-checkout`, mas SEPARADA de propósito: aquela guarda só
// o cart_token (corte de dado pessoal); esta guarda e-mail e telefone, porque o
// WhatsApp de recuperação precisa deles. Não misturar as duas.
//
// Publicar com --no-verify-jwt (quem chama é o servidor da Shopify, sem JWT). A
// autenticação é a assinatura HMAC no corpo CRU.
//
// ⚠️ DOIS segredos possíveis, e o Shopify usa um ou outro conforme QUEM criou o webhook:
//   • webhook criado no ADMIN da loja  → SHOPIFY_WEBHOOK_SECRET (o mostrado em Notificações);
//   • webhook criado por API, pelo app → o segredo do APP, SHOPIFY_CLIENT_SECRET.
// (Conferido em 28/09/2026: os dois são segredos DIFERENTES no Supabase.) Os tópicos
// checkouts/* deste fluxo são criados por API, então sem o segundo daria 401 em tudo.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { assinaturaValida } from '../_shared/verificar-webhook-shopify.js';
import { decidir } from '../_shared/abandono-de-checkout.js';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const SEGREDOS_DO_WEBHOOK = [
  Deno.env.get('SHOPIFY_WEBHOOK_SECRET'),
  Deno.env.get('SHOPIFY_CLIENT_SECRET'),
].filter((s): s is string => !!s);

const responder = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method !== 'POST') return responder({ ok: false }, 405);

  // Corpo CRU: a assinatura é sobre os bytes originais.
  const corpoCru = await req.text();
  const assinatura = req.headers.get('x-shopify-hmac-sha256');
  const confere = await Promise.all(SEGREDOS_DO_WEBHOOK.map((s) => assinaturaValida(s, corpoCru, assinatura)));
  if (!confere.some(Boolean)) return responder({ error: 'nao_autorizado' }, 401);

  let corpo: unknown;
  try { corpo = JSON.parse(corpoCru); } catch { return responder({ ok: true, ignorado: 'json_invalido' }); }

  const decisao = decidir(req.headers.get('x-shopify-topic') ?? '', corpo);
  if (decisao.acao === 'ignorar') return responder({ ok: true, ignorado: decisao.motivo });

  const sb = createClient(SUPABASE_URL, SERVICE_KEY);
  const { error } = decisao.acao === 'registrar'
    ? await sb.rpc('registrar_checkout_abandono', decisao.args)
    : await sb.rpc('marcar_checkout_comprou', { p_token: decisao.token });

  // Mesmo raciocínio do receber-webhook-checkout: a Shopify reenvia se não vir 2xx,
  // e erro de banco não se resolve com retentativa. Loga e responde 200.
  // Reenvio do mesmo evento é inofensivo: as duas funções são idempotentes.
  if (error) console.error('falha ao gravar abandono de checkout:', error.message);

  return responder({ ok: true });
});
