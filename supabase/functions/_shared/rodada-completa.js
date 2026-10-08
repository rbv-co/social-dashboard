// supabase/functions/_shared/rodada-completa.js
//
// A rodada do robô inteira: quatro passadas independentes (inicio do checkout, pedido recebido, abandono, follow-up),
// cada uma com o seu MODO. A edge `enviar-mensagem-abandono` só lê o ambiente e chama isto (com `env`, `sb` e `criarCliente`
// injetados, para testar sem Deno nem rede). Design: docs/superpowers/specs/2026-09-30-fluxo-de-mensagens-design.md
//
// ⚠️ NASCE TUDO DESLIGADO. Modo por tipo: desligado (padrão: não faz nada) | seco (decide e devolve o que enviaria;
// não reserva, não grava, não agenda, não chama o Chatwoot) | lista (só os telefones de ENVIO_SO_PARA) | ligado.
// Nunca ir para `ligado` sem passar por `seco` e `lista`. Um modo desconhecido falha fechado (500) só naquele tipo.
//
//   ENVIO_MODO_INICIO    inicio     (INICIO_MAX_HORAS=1, TEMPLATE_INICIO, TEMPLATE_TEXTO_INICIO) "Nós reservamos seu pedido",
//                                   assim que o checkout aparece com telefone (Aguardando)
//   ENVIO_MODO           abandono   (ENVIO_ATRASO_MINUTOS, ENVIO_MAX_HORAS=24, TEMPLATE_NOME, TEMPLATE_TEXTO)
//   ENVIO_MODO_PEDIDO    pedido     (PEDIDO_MAX_HORAS=2, TEMPLATE_PEDIDO, TEMPLATE_TEXTO_PEDIDO)
//   ENVIO_MODO_FOLLOWUP  follow-up  (FOLLOWUP_APOS_HORAS=48, FOLLOWUP_MAX_HORAS=24, TEMPLATE_FOLLOWUP, TEMPLATE_TEXTO_FOLLOWUP)
//   RESERVAR_AVISO_CHATWOOT=true (padrão desligado = comportamento de sempre): o `pedido` reserva o aviso no Chatwoot
//     (POST custom_api .../avisos/reservar, cabeçalho X-Bot-Secret = env CHATWOOT_BOT_SECRET, o segredo do AgentBot) antes de enviar.
//     ORDEM PARA LIGAR: 1) Chatwoot com CUSTOM_AVISO_UNICO ligado; 2) esta flag na edge; 3) só então CUSTOM_NFE_WHATSAPP no Chatwoot.
//     PARA DESLIGAR: apague a flag (ou ponha false); a próxima rodada já envia como antes. Ver supabase/functions/LEIA-ME.txt.
//   comuns: ABANDONO_TRAVA_CRUZADA=true (nada sai se o telefone recebeu outra automática em 20 h), ENVIO_LIMITE_POR_RODADA=10, ENVIO_SO_PARA, LINK_BASE, TEMPLATE_IDIOMA=pt_BR, CHATWOOT_*
import { processarRodada } from './rodada-de-mensagens.js'
import { processarFila } from './rodada-da-fila.js'
import { travaCruzadaLigada } from './trava-cruzada.js'

const MODOS = ['desligado', 'seco', 'lista', 'ligado']

/** Vazio vira o padrão; texto que não é número vira NaN e a rodada RECUSA (nunca "sem limite"). */
const numero = (valor, padrao) => Number(valor || padrao)

/**
 * @param {{env:(nome:string)=>string, sb:object, criarCliente:(cfg:object)=>object, agora?:Date}} p
 * @returns {Promise<{status:number, corpo:object}>}
 *   corpo: as chaves do abandono NO TOPO (formato de sempre) + `inicio`, `pedido` e `followup`.
 */
export async function rodarTudo({ env, sb, criarCliente, agora = new Date() }) {
  const chatwoot = { url: env('CHATWOOT_URL'), contaId: env('CHATWOOT_CONTA_ID'), caixaId: env('CHATWOOT_CAIXA_ID'), token: env('CHATWOOT_API_TOKEN'), botSecret: env('CHATWOOT_BOT_SECRET') }
  const base = {
    limite: numero(env('ENVIO_LIMITE_POR_RODADA'), 10),
    soPara: env('ENVIO_SO_PARA').split(',').map((n) => n.replace(/\D/g, '')).filter(Boolean),
    linkBase: env('LINK_BASE'),
    idioma: env('TEMPLATE_IDIOMA') || 'pt_BR',
    chatwoot,
    travaCruzada: travaCruzadaLigada(env('ABANDONO_TRAVA_CRUZADA')),
  }

  const passadas = [
    {
      nome: 'inicio', modo: env('ENVIO_MODO_INICIO') || 'desligado',
      rodar: (cliente, modo) => processarFila({
        sb, cliente, agora, tipo: 'inicio',
        config: { ...base, modo, maxHoras: numero(env('INICIO_MAX_HORAS'), 1), templateNome: env('TEMPLATE_INICIO'), templateTexto: env('TEMPLATE_TEXTO_INICIO') },
      }),
    },
    {
      nome: 'pedido', modo: env('ENVIO_MODO_PEDIDO') || 'desligado',
      rodar: (cliente, modo) => processarFila({
        sb, cliente, agora, tipo: 'pedido',
        config: { ...base, modo, reservarAviso: env('RESERVAR_AVISO_CHATWOOT') === 'true', maxHoras: numero(env('PEDIDO_MAX_HORAS'), 2), templateNome: env('TEMPLATE_PEDIDO'), templateTexto: env('TEMPLATE_TEXTO_PEDIDO') },
      }),
    },
    {
      nome: 'abandono', modo: env('ENVIO_MODO') || 'desligado',
      rodar: (cliente, modo) => processarRodada({
        sb, cliente, agora,
        config: {
          ...base, modo, atrasoMin: Number(env('ENVIO_ATRASO_MINUTOS') || 0), maxHoras: numero(env('ENVIO_MAX_HORAS'), 24),
          templateNome: env('TEMPLATE_NOME'), templateTexto: env('TEMPLATE_TEXTO'),
        },
      }),
    },
    {
      nome: 'followup', modo: env('ENVIO_MODO_FOLLOWUP') || 'desligado',
      rodar: async (cliente, modo) => {
        const maxHoras = numero(env('FOLLOWUP_MAX_HORAS'), 24)
        // Agenda quem recebeu a mensagem de abandono há `FOLLOWUP_APOS_HORAS` h. O seco só LÊ: não agenda.
        // Teto inválido: não agenda (a rodada abaixo recusa a configuração).
        if (modo !== 'seco' && Number.isInteger(maxHoras) && maxHoras >= 1) {
          const r = await sb.rpc('agendar_followups', { p_apos_horas: numero(env('FOLLOWUP_APOS_HORAS'), 48), p_teto_horas: maxHoras })
          if (r.error) console.error('falha em agendar_followups:', r.error.message)
        }
        return processarFila({
          sb, cliente, agora, tipo: 'followup',
          config: { ...base, modo, maxHoras, templateNome: env('TEMPLATE_FOLLOWUP'), templateTexto: env('TEMPLATE_TEXTO_FOLLOWUP') },
        })
      },
    },
  ]

  // Só cria o cliente do Chatwoot se alguma passada de fato envia (seco e desligado nunca falam com ele).
  const enviaDeVerdade = passadas.some((p) => p.modo === 'lista' || p.modo === 'ligado')
  const cliente = enviaDeVerdade
    ? criarCliente({ url: chatwoot.url, contaId: chatwoot.contaId, caixaId: Number(chatwoot.caixaId), token: chatwoot.token, botSecret: chatwoot.botSecret })
    : null

  const corpos = {}
  let status = 200
  for (const p of passadas) {
    if (p.modo === 'desligado') { corpos[p.nome] = { ok: true, modo: 'desligado' }; continue }
    if (!MODOS.includes(p.modo)) { corpos[p.nome] = { ok: false, erro: 'modo_invalido', modo: p.modo }; status = Math.max(status, 500); continue }
    try {
      const r = await p.rodar(p.modo === 'seco' ? null : cliente, p.modo)
      corpos[p.nome] = r.corpo
      status = Math.max(status, r.status)
    } catch (e) {
      // Uma passada que quebra não derruba as outras. O texto do erro nunca leva o token (não vem de env).
      console.error(`falha na passada ${p.nome}:`, String(e?.message ?? e).slice(0, 160))
      corpos[p.nome] = { ok: false, erro: 'excecao' }
      status = Math.max(status, 500)
    }
  }
  return { status, corpo: { ...corpos.abandono, ok: status === 200, inicio: corpos.inicio, pedido: corpos.pedido, followup: corpos.followup } }
}
