// supabase/functions/enviar-mensagem-abandono/index.ts
//
// Robô da mensagem de recuperação. Roda a cada minuto (pg_cron -> disparar_robo) e manda UMA
// mensagem de WhatsApp (template aprovado, via Chatwoot) a quem está na Fila de mensagens.
// Design: docs/superpowers/specs/2026-09-29-mensagem-de-abandono-design.md
//
// ⚠️ NASCE DESLIGADO. ENVIO_MODO: desligado (padrão: não faz nada) | seco (decide e devolve o
// que enviaria; não reserva, não chama o Chatwoot) | lista (só os telefones de ENVIO_SO_PARA) |
// ligado. Nunca ir para `ligado` sem passar por `seco` e `lista`.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { exigirSegredoDeCron } from '../_shared/segredo-de-cron.ts';
import { decidirEnvio, montarTemplateParams, primeiroNome } from '../_shared/mensagem-de-abandono.js';
import { criarClienteChatwoot, classificarErro, ErroChatwoot } from '../_shared/cliente-chatwoot.js';

const env = (nome: string) => Deno.env.get(nome) ?? '';
const MODO = Deno.env.get('ENVIO_MODO') || 'desligado';
const LIMITE = Number(env('ENVIO_LIMITE_POR_RODADA') || 10);
const ATRASO_MIN = Number(env('ENVIO_ATRASO_MINUTOS') || 0);
const SO_PARA = env('ENVIO_SO_PARA').split(',').map((n) => n.replace(/\D/g, '')).filter(Boolean);
const LINK_BASE = env('LINK_BASE');
const TEMPLATE = env('TEMPLATE_NOME');
const IDIOMA = env('TEMPLATE_IDIOMA') || 'pt_BR';

const responder = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  const negado = await exigirSegredoDeCron(req, 'enviar-mensagem-abandono');
  if (negado) return negado;

  if (MODO === 'desligado') return responder({ ok: true, modo: MODO });
  if (!['seco', 'lista', 'ligado'].includes(MODO)) return responder({ ok: false, erro: 'modo_invalido', modo: MODO }, 500);
  if (MODO === 'lista' && !SO_PARA.length) return responder({ ok: false, erro: 'lista_vazia' }, 500);

  const sb = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'));
  await sb.rpc('liberar_mensagens_travadas');

  const { data: linhas, error } = await sb.rpc('pegar_para_mensagem', {
    p_limite: LIMITE,
    p_atraso_min: ATRASO_MIN,
    p_reservar: MODO !== 'seco',
    p_ultimos11: MODO === 'lista' ? SO_PARA.map((n) => n.slice(-11)) : null,
  });
  if (error) return responder({ ok: false, erro: 'falha_ao_pegar', detalhe: error.message }, 500);

  const { data: bloq } = await sb.from('contatos_sem_mensagem').select('telefone');
  const bloqueados = new Set<string>((bloq ?? []).map((b: { telefone: string }) => b.telefone));

  const cliente = MODO === 'seco' ? null : criarClienteChatwoot({
    url: env('CHATWOOT_URL'), contaId: env('CHATWOOT_CONTA_ID'), caixaId: Number(env('CHATWOOT_CAIXA_ID')),
    token: env('CHATWOOT_API_TOKEN'),
  });

  const resultado: Array<Record<string, unknown>> = [];
  const pendentes = (linhas ?? []).map((l: { token: string }) => l.token);

  for (const linha of linhas ?? []) {
    const d = decidirEnvio({ linha, bloqueados, baseLink: LINK_BASE });
    const curto = String(linha.token).slice(0, 8);

    if (MODO === 'seco') {
      resultado.push({ token: curto, decisao: d.acao, motivo: 'motivo' in d ? d.motivo : null, telefone_final: 'telefone' in d ? d.telefone.slice(-4) : null });
      continue;
    }
    pendentes.splice(pendentes.indexOf(linha.token), 1);

    if (d.acao === 'ignorar') {
      await sb.rpc('marcar_mensagem', { p_token: linha.token, p_status: 'ignorada', p_motivo: d.motivo });
      resultado.push({ token: curto, resultado: 'ignorada', motivo: d.motivo });
      continue;
    }
    if (d.acao === 'esperar') {
      await sb.rpc('devolver_mensagem', { p_token: linha.token, p_contar: false });
      resultado.push({ token: curto, resultado: 'esperando', motivo: d.motivo });
      continue;
    }

    try {
      const contatoId = await cliente!.acharOuCriarContato({ nome: d.nome, telefone: d.telefone });
      const conversaId = await cliente!.abrirConversa({ contatoId, telefone: d.telefone });
      const texto = (env('TEMPLATE_TEXTO') || `[template ${TEMPLATE}]`).replace('{{1}}', primeiroNome(d.nome));
      await cliente!.enviarTemplate({
        conversaId, texto,
        templateParams: montarTemplateParams({ nomeTemplate: TEMPLATE, idioma: IDIOMA, nome: d.nome, sufixoUrl: d.sufixoUrl }),
      });
      await sb.rpc('marcar_mensagem', { p_token: linha.token, p_status: 'enviada', p_conversa: conversaId });
      resultado.push({ token: curto, resultado: 'enviada' });
    } catch (e) {
      const tipo = classificarErro(e);
      const detalhe = e instanceof ErroChatwoot
        ? `${e.passo}:${e.status} ${JSON.stringify(e.corpo ?? '').slice(0, 160)}`
        : String(e).slice(0, 160);
      if (tipo === 'parar') {
        // Credencial/permissão: o problema não é do lead. Devolve este e os que sobraram, sem contar tentativa.
        for (const t of [linha.token, ...pendentes]) await sb.rpc('devolver_mensagem', { p_token: t, p_contar: false });
        console.error('chatwoot recusou a credencial; rodada interrompida:', detalhe);
        return responder({ ok: false, erro: 'credencial_recusada', detalhe, resultado }, 502);
      }
      if (tipo === 'tentar_de_novo') await sb.rpc('devolver_mensagem', { p_token: linha.token, p_contar: true });
      else await sb.rpc('marcar_mensagem', { p_token: linha.token, p_status: 'falhou', p_motivo: detalhe });
      resultado.push({ token: curto, resultado: tipo === 'falhou' ? 'falhou' : 'tentar_de_novo', detalhe });
    }
  }

  return responder({ ok: true, modo: MODO, quantidade: resultado.length, resultado });
});
