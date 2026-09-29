// supabase/functions/enviar-mensagem-abandono/index.ts
//
// Robô da mensagem de recuperação. Roda a cada minuto (pg_cron -> disparar_robo) e manda UMA
// mensagem de WhatsApp (template aprovado, via Chatwoot) a quem está na Fila de mensagens.
// Design: docs/superpowers/specs/2026-09-29-mensagem-de-abandono-design.md
//
// A lógica da rodada mora em _shared/rodada-de-mensagens.js (testada com banco e Chatwoot falsos).
// Aqui só se lê a configuração e se montam as dependências.
//
// ⚠️ NASCE DESLIGADO. ENVIO_MODO: desligado (padrão: não faz nada) | seco (decide e devolve o
// que enviaria; não reserva, não grava, não chama o Chatwoot) | lista (só os telefones de
// ENVIO_SO_PARA) | ligado. Nunca ir para `ligado` sem passar por `seco` e `lista`.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { exigirSegredoDeCron } from '../_shared/segredo-de-cron.ts';
import { criarClienteChatwoot } from '../_shared/cliente-chatwoot.js';
import { processarRodada } from '../_shared/rodada-de-mensagens.js';

const env = (nome: string) => Deno.env.get(nome) ?? '';
const MODO = Deno.env.get('ENVIO_MODO') || 'desligado';

const responder = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  const negado = await exigirSegredoDeCron(req, 'enviar-mensagem-abandono');
  if (negado) return negado;

  if (MODO === 'desligado') return responder({ ok: true, modo: MODO });
  if (!['seco', 'lista', 'ligado'].includes(MODO)) return responder({ ok: false, erro: 'modo_invalido', modo: MODO }, 500);

  const chatwoot = {
    url: env('CHATWOOT_URL'), contaId: env('CHATWOOT_CONTA_ID'),
    caixaId: env('CHATWOOT_CAIXA_ID'), token: env('CHATWOOT_API_TOKEN'),
  };
  const config = {
    modo: MODO,
    limite: Number(env('ENVIO_LIMITE_POR_RODADA') || 10),
    atrasoMin: Number(env('ENVIO_ATRASO_MINUTOS') || 0),
    soPara: env('ENVIO_SO_PARA').split(',').map((n) => n.replace(/\D/g, '')).filter(Boolean),
    linkBase: env('LINK_BASE'),
    templateNome: env('TEMPLATE_NOME'),
    idioma: env('TEMPLATE_IDIOMA') || 'pt_BR',
    templateTexto: env('TEMPLATE_TEXTO'),
    chatwoot,
  };

  const sb = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'));
  const cliente = MODO === 'seco' ? null : criarClienteChatwoot({
    url: chatwoot.url, contaId: chatwoot.contaId, caixaId: Number(chatwoot.caixaId), token: chatwoot.token,
  });

  const { status, corpo } = await processarRodada({ sb, cliente, config });
  return responder(corpo, status);
});
