// supabase/functions/receber-opt-out-chatwoot/index.ts
//
// Webhook PADRÃO do Chatwoot (evento "Message created") -> quem pediu para não receber vai para
// `contatos_sem_mensagem`. Não confundir com receber-webhook-chatwoot, que é o webhook de CRM
// customizado (só lead_novo/qualified_lead) e não recebe respostas de clientes.
// Autentica pelo segredo na URL (?token=), o mesmo CHATWOOT_WEBHOOK_SEGREDO daquele.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { tokenValido } from '../_shared/verificar-webhook-chatwoot.js';
import { extrairOptOut } from '../_shared/opt-out.js';

const responder = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method !== 'POST') return responder({ ok: false }, 405);
  const url = new URL(req.url);
  if (!tokenValido(Deno.env.get('CHATWOOT_WEBHOOK_SEGREDO') ?? '', url.searchParams.get('token'))) {
    return responder({ error: 'nao_autorizado' }, 401);
  }

  let corpo: unknown;
  try { corpo = await req.json(); } catch { return responder({ error: 'corpo_invalido' }, 400); }

  const pedido = extrairOptOut(corpo);
  if (!pedido) return responder({ ok: true, ignorado: true });

  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const { error } = await sb.from('contatos_sem_mensagem')
    .upsert(pedido, { onConflict: 'telefone', ignoreDuplicates: true });
  // Mesmo raciocínio dos outros receptores: erro de banco não se resolve com retentativa. Loga e responde 200.
  if (error) console.error('falha ao gravar opt-out:', error.message);
  return responder({ ok: true });
});
