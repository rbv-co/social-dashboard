// supabase/functions/receber-webhook-chatwoot/index.ts
//
// Recebe o evento de CRM que o Chatwoot manda (Custom::CrmEventWebhookService,
// do lado de lá) quando uma conversa vira lead novo ou lead quente — grava
// em `chatwoot_eventos`, que o OPR (Leads Gerados / Leads Quentes) vai
// passar a ler numa entrega futura (ver
// docs/superpowers/specs/2026-09-24-chatwoot-leads-design.md; por enquanto
// o relatório continua lendo da Meta, sem depender deste dado ainda).
//
// Chatwoot não assina o corpo (sem HMAC nativo, diferente do webhook
// receber-webhook-checkout da Shopify) — autentica por um segredo fixo na
// própria URL (?token=<segredo>), configurado do lado de lá como
// CRM_EVENT_WEBHOOK_URL.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { tokenValido, extrairEventoDoChatwoot } from '../_shared/verificar-webhook-chatwoot.js';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const SEGREDO_DO_WEBHOOK = Deno.env.get('CHATWOOT_WEBHOOK_SEGREDO') ?? '';

const responder = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method !== 'POST') return responder({ ok: false }, 405);

  const url = new URL(req.url);
  if (!tokenValido(SEGREDO_DO_WEBHOOK, url.searchParams.get('token'))) {
    return responder({ error: 'nao_autorizado' }, 401);
  }

  let corpo: unknown;
  try {
    corpo = await req.json();
  } catch {
    return responder({ error: 'corpo_invalido' }, 400);
  }

  const evento = extrairEventoDoChatwoot(corpo);
  if (!evento) return responder({ error: 'payload_incompleto' }, 400);

  const sb = createClient(SUPABASE_URL, SERVICE_KEY);
  // upsert ignorando conflito: o Chatwoot pode reenviar o mesmo evento
  // (timeout, retry) ou a etiqueta pode ser removida/reaplicada — cada
  // conversa conta só UMA vez como lead_novo e UMA vez como lead_quente
  // (índice único em conversation_id+tipo, ver a migration da tabela).
  const { error } = await sb
    .from('chatwoot_eventos')
    .upsert(evento, { onConflict: 'conversation_id,tipo', ignoreDuplicates: true });
  // O Chatwoot pode tentar de novo se não receber 2xx — erro de banco nunca
  // deve virar tempestade de retentativas por um problema que retry nenhum
  // resolve; loga pro robô investigar depois, mas responde 200 assim mesmo
  // (mesma prática de receber-webhook-checkout).
  if (error) console.error('falha ao gravar evento do chatwoot:', error.message);

  return responder({ ok: true });
});
