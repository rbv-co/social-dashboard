// supabase/functions/_shared/rodada-da-fila.js
//
// Uma RODADA das mensagens de INICIO (checkout com telefone), PEDIDO RECEBIDO e FOLLOW-UP do abandono, com `sb`
// (Supabase) e `cliente` (Chatwoot) injetados. Irmã de rodada-de-mensagens.js (o abandono), que NÃO é tocada de
// propósito: está no ar. Design: docs/superpowers/specs/2026-09-30-fluxo-de-mensagens-design.md
//
// • pedido: transacional (orders/create). Não consulta bloqueados nem status de checkout, e não tem link.
// • inicio: "Nós reservamos seu pedido", assim que o checkout aparece com telefone. É marketing (ainda não existe pedido):
//   confere bloqueados e leva o link do checkout no botão. Sem releitura de status (a cliente acabou de chegar).
// • followup: marketing. Confere bloqueados, RELÊ o status do checkout e NÃO envia se a cliente já respondeu.
//   ⚠️ "não consegui ler" NUNCA vira "pode enviar": falha na leitura devolve o item (contando tentativa).
import {
  dentroDaJanela, formatarNomeCompleto, montarTemplateParams, montarTemplateParamsInicio, montarTemplateParamsPedido,
  normalizarTelefone, primeiroNome, sufixoDoLink, validarConfig,
} from './mensagem-de-abandono.js'
import { classificarErro, ErroChatwoot } from './cliente-chatwoot.js'
import { checarTravaCruzada, MOTIVO_TRAVA_CRUZADA } from './trava-cruzada.js'

/** Mostra o sufixo do link sem a chave secreta de recuperação (a resposta do cron fica em log). */
const amostraDoSufixo = (s) => s.replace(/(key=)[^&]*/i, '$1…')

/** Decide o que fazer com UMA linha, antes de qualquer chamada externa. `bloqueados` = Set de telefones normalizados. */
function decidirLinha({ tipo, linha, bloqueados, agora, baseLink }) {
  if (typeof linha.telefone !== 'string' || !linha.telefone.trim()) return { acao: 'ignorar', motivo: 'sem_telefone' }
  const telefone = normalizarTelefone(linha.telefone)
  if (!telefone) return { acao: 'ignorar', motivo: 'telefone_invalido' }
  let sufixoUrl = null
  if (tipo === 'followup' || tipo === 'inicio') {
    if (bloqueados.has(telefone)) return { acao: 'ignorar', motivo: 'pediu_para_nao_receber' }
    // inicio: o link pode chegar num evento seguinte do checkout; espera sem gastar tentativa (o teto de horas encerra).
    if (tipo === 'inicio' && !linha.url_de_recuperacao) return { acao: 'esperar', motivo: 'sem_link_ainda' }
    sufixoUrl = sufixoDoLink(linha.url_de_recuperacao, baseLink)
    if (!sufixoUrl) return { acao: 'ignorar', motivo: 'sem_link' }
  }
  if (!dentroDaJanela(agora)) return { acao: 'esperar', motivo: 'fora_da_janela' }
  return { acao: 'enviar', telefone, sufixoUrl }
}

/**
 * @returns {Promise<{status: number, corpo: object}>}
 * config: { modo, limite, maxHoras, soPara, linkBase, templateNome, idioma, templateTexto, chatwoot }
 */
export async function processarFila({ sb, cliente, config, tipo, agora = new Date() }) {
  const { modo } = config
  const seco = modo === 'seco'
  const followup = tipo === 'followup'

  // 1) Configuração: falha FECHADA (segredo ausente ou inválido não toca em ninguém).
  const problemas = validarConfig({ ...config, exigeLink: followup || tipo === 'inicio' })
  if (!Number.isInteger(config.maxHoras) || config.maxHoras < 1) problemas.push('ENVIO_MAX_HORAS inválido (inteiro a partir de 1)')
  if (problemas.length) return { status: 500, corpo: { ok: false, erro: 'config_invalida', problemas } }

  const rpc = async (nome, args) => {
    const r = await sb.rpc(nome, args)
    if (r.error) console.error(`falha em ${nome}:`, r.error.message)
    return r
  }
  const marcar = (chave, status, motivo) => rpc('marcar_da_fila', { p_tipo: tipo, p_chave: chave, p_status: status, p_motivo: motivo })
  const devolver = (chave, contar) => rpc('devolver_da_fila', { p_tipo: tipo, p_chave: chave, p_contar: contar })

  if (!seco) await rpc('liberar_travadas_da_fila', {})

  const { data: linhas, error } = await sb.rpc('pegar_da_fila', {
    p_tipo: tipo, p_limite: config.limite, p_max_horas: config.maxHoras, p_reservar: !seco,
    p_ultimos11: modo === 'lista' ? config.soPara.map((n) => n.slice(-11)) : null,
  })
  if (error) {
    console.error('falha ao pegar da fila:', error.message)
    return { status: 500, corpo: { ok: false, erro: 'falha_ao_pegar', detalhe: error.message } }
  }
  const lote = linhas ?? []

  // 2) Bloqueados (o pedido é transacional; inicio e follow-up são marketing). ⚠️ Se a leitura FALHAR, não se envia nada.
  let bloqueados = new Set()
  const telefones = [...new Set(lote.map((l) => normalizarTelefone(l.telefone)).filter(Boolean))]
  if ((followup || tipo === 'inicio') && telefones.length) {
    const r = await sb.from('contatos_sem_mensagem').select('telefone').in('telefone', telefones)
    if (r.error) {
      console.error('falha ao ler bloqueados; rodada abortada:', r.error.message)
      if (!seco) await Promise.all(lote.map((l) => devolver(l.chave, false)))
      return { status: 500, corpo: { ok: false, erro: 'falha_bloqueados' } }
    }
    bloqueados = new Set((r.data ?? []).map((b) => b.telefone))
  }

  const resultado = []
  const pendentes = lote.map((l) => l.chave)

  for (const linha of lote) {
    const d = decidirLinha({ tipo, linha, bloqueados, agora, baseLink: config.linkBase })
    const curto = String(linha.chave).slice(0, 8)

    if (seco) {
      resultado.push({
        chave: curto, decisao: d.acao, motivo: 'motivo' in d ? d.motivo : null,
        telefone_final: 'telefone' in d ? d.telefone.slice(-4) : null,
        sufixo_amostra: d.sufixoUrl ? amostraDoSufixo(d.sufixoUrl) : null,
      })
      continue
    }
    pendentes.splice(pendentes.indexOf(linha.chave), 1)

    if (d.acao === 'ignorar') {
      await marcar(linha.chave, 'ignorada', d.motivo)
      resultado.push({ chave: curto, resultado: 'ignorada', motivo: d.motivo })
      continue
    }
    if (d.acao === 'esperar') {
      await devolver(linha.chave, false)
      resultado.push({ chave: curto, resultado: 'esperando', motivo: d.motivo })
      continue
    }

    // Trava cruzada: outra mensagem automática ao mesmo telefone nas últimas 20 h (qualquer tipo) barra esta.
    // O pedido recebido é transacional (confirma uma compra) e nunca é barrado.
    if (config.travaCruzada && tipo !== 'pedido') {
      const t = await checarTravaCruzada(sb, d.telefone)
      if (t === 'erro') {
        await devolver(linha.chave, true)
        resultado.push({ chave: curto, resultado: 'esperando', motivo: 'falha_na_trava_cruzada' })
        continue
      }
      if (t === 'barrar') {
        await marcar(linha.chave, 'ignorada', MOTIVO_TRAVA_CRUZADA)
        resultado.push({ chave: curto, resultado: 'ignorada', motivo: MOTIVO_TRAVA_CRUZADA })
        continue
      }
    }

    if (followup) {
      // ⚠️ RELÊ o status: entre agendar e enviar a cliente pode ter comprado ou gerado um Pix.
      const atual = await sb.from('checkout_abandono').select('status').eq('token', linha.chave).maybeSingle()
      if (atual.error) {
        console.error('falha ao reler o status; item devolvido:', atual.error.message)
        await devolver(linha.chave, true)
        resultado.push({ chave: curto, resultado: 'esperando', motivo: 'falha_ao_reler_status' })
        continue
      }
      if (atual.data?.status !== 'fila_envio') {
        await marcar(linha.chave, 'ignorada', 'nao_esta_mais_na_fila')
        resultado.push({ chave: curto, resultado: 'ignorada', motivo: 'nao_esta_mais_na_fila' })
        continue
      }
      // Sem a conversa da mensagem anterior não há como saber se respondeu: não envia.
      if (!linha.conversa_origem) {
        await marcar(linha.chave, 'ignorada', 'sem_conversa_de_origem')
        resultado.push({ chave: curto, resultado: 'ignorada', motivo: 'sem_conversa_de_origem' })
        continue
      }
    }

    try {
      if (followup && await cliente.respondeu({ conversaId: linha.conversa_origem })) {
        await marcar(linha.chave, 'ignorada', 'respondeu')
        resultado.push({ chave: curto, resultado: 'ignorada', motivo: 'respondeu' })
        continue
      }
      const contatoId = await cliente.acharOuCriarContato({ nome: formatarNomeCompleto(linha.nome), telefone: d.telefone })
      const conversaId = await cliente.abrirConversa({ contatoId, telefone: d.telefone })
      const texto = (config.templateTexto || `[template ${config.templateNome}]`)
        .replace('{{1}}', primeiroNome(linha.nome)).replace('{{2}}', linha.numero ?? '')
      const base = { nomeTemplate: config.templateNome, idioma: config.idioma, nome: linha.nome }
      const templateParams = followup ? montarTemplateParams({ ...base, sufixoUrl: d.sufixoUrl })
        : tipo === 'inicio' ? montarTemplateParamsInicio({ ...base, sufixoUrl: d.sufixoUrl })
          : montarTemplateParamsPedido({ ...base, numero: linha.numero })
      await cliente.enviarTemplate({ conversaId, texto, templateParams })
      // ⚠️ A mensagem JÁ SAIU. Se gravar falhar, não devolve nem reenvia: fica `enviando` e, passados 10 min, vira
      // `falhou/travada_sem_confirmacao` (visível), nunca uma segunda mensagem.
      const gravou = await rpc('marcar_da_fila', { p_tipo: tipo, p_chave: linha.chave, p_status: 'enviada', p_conversa: conversaId })
      resultado.push({ chave: curto, resultado: gravou.error ? 'enviada_sem_gravar' : 'enviada' })
    } catch (e) {
      const como = classificarErro(e)
      const detalhe = e instanceof ErroChatwoot
        ? `${e.passo}:${e.status} ${JSON.stringify(e.corpo ?? '').slice(0, 160)}`
        : String(e).slice(0, 160)
      if (como === 'parar') {
        // Credencial/permissão: o problema não é do item. Devolve este e os que sobraram, sem contar tentativa.
        for (const chave of [linha.chave, ...pendentes]) await devolver(chave, false)
        console.error('chatwoot recusou a credencial; rodada interrompida:', detalhe)
        return { status: 502, corpo: { ok: false, erro: 'credencial_recusada', detalhe, resultado } }
      }
      if (como === 'tentar_de_novo') await devolver(linha.chave, true)
      else await marcar(linha.chave, 'falhou', detalhe)
      resultado.push({ chave: curto, resultado: como === 'falhou' ? 'falhou' : 'tentar_de_novo', detalhe })
    }
  }

  return { status: 200, corpo: { ok: true, modo, tipo, quantidade: resultado.length, resultado } }
}
