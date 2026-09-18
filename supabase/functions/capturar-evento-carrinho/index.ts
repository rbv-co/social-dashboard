// supabase/functions/capturar-evento-carrinho/index.ts
//
// A RECEPÇÃO DO PIXEL DA LOJA. Primeira função deste repo chamada por
// visitante ANÔNIMO da internet (o Web Pixel Extension da loja Shopify, sem
// login nenhum) — por isso verify_jwt fica DESLIGADO no deploy
// (--no-verify-jwt) e a validação/rate limit moram aqui, não num token.
//
// Grava cru em carrinho_eventos; quem decide "abandonado" é a view
// carrinho_abandonados (db/migrations/2026-09-17-carrinho-eventos.sql), não
// esta função. Ver spec
// docs/superpowers/specs/2026-09-17-funil-carrinho-shopify-design.md.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { validarPayload, passouDoLimite } from '../_shared/validar-evento-de-carrinho.js';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

// Só o domínio da loja pode chamar — '*' deixaria qualquer site externo
// martelar a tabela. Configurar o segredo ORIGEM_DA_LOJA_SHOPIFY no deploy
// (ex.: 'https://minhaloja.myshopify.com').
const ORIGEM_DA_LOJA = Deno.env.get('ORIGEM_DA_LOJA_SHOPIFY') ?? '*';

const CORS = {
  'Access-Control-Allow-Origin': ORIGEM_DA_LOJA,
  'Access-Control-Allow-Headers': 'content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const responder = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return responder({ ok: false }, 405);

  const corpo = await req.json().catch(() => null);
  const validado = validarPayload(corpo);
  if (!validado.ok) return responder({ ok: false }, 400);

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'desconhecido';
  const sb = createClient(SUPABASE_URL, SERVICE_KEY);

  // Rate limit por IP, nunca por cart_token — ver _shared/validar-evento-de-carrinho.js.
  const umMinutoAtras = new Date(Date.now() - 60_000).toISOString();
  const { count } = await sb.from('carrinho_eventos')
    .select('id', { count: 'exact', head: true })
    .eq('ip', ip)
    .gte('criado_em', umMinutoAtras);
  if (passouDoLimite(count ?? 0)) return responder({ ok: false, motivo: 'limite' }, 429);

  const { error } = await sb.from('carrinho_eventos').insert({ ...validado.evento, ip });
  // Erro de banco nunca ecoa pro navegador do visitante — só um genérico.
  if (error) return responder({ ok: false }, 500);

  return responder({ ok: true });
});
