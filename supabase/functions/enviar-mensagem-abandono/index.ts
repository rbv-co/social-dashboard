// supabase/functions/enviar-mensagem-abandono/index.ts
//
// Robô das mensagens de WhatsApp: pedido recebido, recuperação de checkout abandonado e follow-up. Roda a cada
// minuto (pg_cron -> disparar_robo) e manda cada mensagem com o template aprovado, via Chatwoot.
// Design: docs/superpowers/specs/2026-09-29-mensagem-de-abandono-design.md e
//         docs/superpowers/specs/2026-09-30-fluxo-de-mensagens-design.md
//
// As três rodadas (e os modos ENVIO_MODO, ENVIO_MODO_PEDIDO, ENVIO_MODO_FOLLOWUP) moram em
// _shared/rodada-completa.js, testado com banco e Chatwoot falsos. Aqui só se checa o segredo do cron e
// se montam as dependências. ⚠️ NASCE TUDO DESLIGADO (ver o cabeçalho de rodada-completa.js).
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { exigirSegredoDeCron } from '../_shared/segredo-de-cron.ts';
import { criarClienteChatwoot } from '../_shared/cliente-chatwoot.js';
import { rodarTudo } from '../_shared/rodada-completa.js';

// Lida a CADA chamada: mudar um segredo vale na próxima rodada, sem depender de a instância reiniciar.
const env = (nome: string) => Deno.env.get(nome) ?? '';

const responder = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  const negado = await exigirSegredoDeCron(req, 'enviar-mensagem-abandono');
  if (negado) return negado;

  const sb = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'));
  const { status, corpo } = await rodarTudo({ env, sb, criarCliente: criarClienteChatwoot });
  return responder(corpo, status);
});
