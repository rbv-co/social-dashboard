// supabase/functions/_shared/rodada-da-fila.js
//
// Uma RODADA das mensagens de INICIO (checkout com telefone), PEDIDO RECEBIDO e FOLLOW-UP do abandono, com `sb`
// (Supabase) e `cliente` (Chatwoot) injetados. Irmã de rodada-de-mensagens.js (o abandono), que NÃO é tocada de
// propósito: está no ar. Design: docs/superpowers/specs/2026-09-30-fluxo-de-mensagens-design.md
//
// • pedido: transacional (orders/create). Não consulta bloqueados nem status de checkout, e não tem link.
// • inicio: "Nós reservamos seu pedido", assim que o checkout aparece com telefone. É marketing (ainda não existe pedido):
//   confere bloqueados e leva o link do checkout no botão. Sem releitura de status (a cliente acabou de chegar).
// • pedido + RESERVAR_AVISO_CHATWOOT=true: antes de enviar, reserva o aviso no Chatwoot (reservarAviso). `reservado` envia;
//   `duplicado`/`janela` -> ignorada (aviso_chatwoot_*); `adiado` -> devolve sem mudar nada e só conta (`adiados`);
//   rede/5xx/resposta estranha -> devolve sem enviar nem contar tentativa; 401/403 -> 502 `reserva_recusada`.
// • followup: marketing. Confere bloqueados, RELÊ o status do checkout e NÃO envia se a cliente já respondeu.
//   ⚠️ "não consegui ler" NUNCA vira "pode enviar": falha na leitura devolve o item (contando tentativa).
// • RESERVA ÓRFÃ: a reserva do aviso é gravada ANTES do envio. Se o envio falha DEPOIS de `reservado` e a mensagem
//   comprovadamente não foi aceita (falha em acharOuCriarContato/abrirConversa, ou 4xx do enviar_template), a rodada chama
//   `cliente.liberarAviso` (best-effort, sem lançar) ANTES de devolver a linha: sem isso a rodada seguinte receberia
//   `duplicado` e a mensagem nunca sairia. Timeout/5xx NA RESERVA (a resposta pode ter se perdido) também libera e fica
//   'esperando'. Falha AMBÍGUA (timeout ou 5xx no enviar_template: a Meta pode ter aceitado) NÃO libera e NÃO reenvia: a
//   linha vira `falhou` com motivo `envio_incerto…` (conferir no Chatwoot).
// • TRAVA CRUZADA: RPC `avaliar_trava_cruzada` (migration 2026-10-09-trava-cruzada-considera-enviando.sql) devolve
//   barrar | esperar | liberar; `esperar` = outra mensagem ao mesmo telefone está `enviando` e tem prioridade: devolve sem contar.
import {
  dentroDaJanela, formatarNomeCompleto, montarTemplateParams, montarTemplateParamsInicio, montarTemplateParamsPedido,
  normalizarTelefone, primeiroNome, sufixoDoLink, validarConfig,
} from './mensagem-de-abandono.js'
import { classificarErro, ErroChatwoot } from './cliente-chatwoot.js'
import { checarTravaCruzada, MOTIVO_TRAVA_CRUZADA } from './trava-cruzada.js'

/** Mostra o sufixo do link sem a chave secreta de recuperação (a resposta do cron fica em log). */
const amostraDoSufixo = (s) => s.replace(/(key=)[^&]*/i, '$1…')

/** Segundos desde `criado_em` (coluna de mensagem_fila devolvida por pegar_da_fila; no pedido é o created_at da Shopify). Inválido -> undefined (não envia idade_s). */
function idadeEmSegundos(criadoEm, agora) {
  const t = Date.parse(criadoEm)
  return Number.isNaN(t) ? undefined : Math.max(0, Math.floor((agora.getTime() - t) / 1000))
}

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
  // Reserva do aviso no Chatwoot ligada sem o segredo: falha fechada (não envia o pedido sem a trava que se pediu).
  const reservar = tipo === 'pedido' && config.reservarAviso === true
  if (reservar && !config.chatwoot?.botSecret) problemas.push('CHATWOOT_BOT_SECRET ausente (RESERVAR_AVISO_CHATWOOT=true exige)')
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
  let adiados = 0 // reserva respondeu `adiado`: o core manda a NF-e; só se conta, sem uma linha por minuto
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
      const t = await checarTravaCruzada(sb, d.telefone, { tipo, chave: linha.chave })
      if (t === 'erro') {
        await devolver(linha.chave, true)
        resultado.push({ chave: curto, resultado: 'esperando', motivo: 'falha_na_trava_cruzada' })
        continue
      }
      if (t === 'esperar') { // outra rodada está enviando ao mesmo telefone e tem prioridade: volta à fila, sem gastar tentativa
        await devolver(linha.chave, false)
        resultado.push({ chave: curto, resultado: 'esperando', motivo: 'telefone_com_envio_em_andamento' })
        continue
      }
      if (t === 'barrar') {
        await marcar(linha.chave, 'ignorada', MOTIVO_TRAVA_CRUZADA)
        resultado.push({ chave: curto, resultado: 'ignorada', motivo: MOTIVO_TRAVA_CRUZADA })
        continue
      }
    }

    // Reserva do aviso no Chatwoot (trava ADICIONAL ao #313): só `reservado` autoriza. Não roda no modo seco (já saiu acima).
    let avisoReservado = null // {phone, tipo, chave} da reserva que ESTA rodada fez: quem precisa desfazê-la
    const liberarReserva = async () => { // best-effort, nunca lança (cliente sem liberarAviso = não faz nada)
      if (!avisoReservado) return
      const alvo = avisoReservado
      avisoReservado = null
      try { await cliente.liberarAviso?.(alvo) } catch { /* best-effort */ }
    }
    if (reservar) {
      const aviso = { phone: d.telefone, tipo: 'pedido_recebido', chave: String(linha.numero ?? '').replace(/^#/, '') || String(linha.chave) }
      let r
      try {
        r = await cliente.reservarAviso({ ...aviso, idadeS: idadeEmSegundos(linha.criado_em, agora) })
      } catch (e) {
        const status = e instanceof ErroChatwoot ? e.status : 0
        const detalhe = `reservar_aviso:${status}`
        // Timeout/5xx/resposta ilegível: o POST pode ter gravado a reserva e a resposta se perdido. Libera (best-effort)
        // antes de devolver, senão a próxima rodada receberia `duplicado` e a mensagem nunca sairia.
        if (status === 0 || status >= 500 || status === 200) { avisoReservado = aviso; await liberarReserva() }
        await devolver(linha.chave, false) // não envia e não marca: a próxima rodada tenta de novo (o teto de horas encerra)
        if (status === 401 || status === 403) {
          for (const chave of pendentes) await devolver(chave, false)
          console.error('chatwoot recusou o X-Bot-Secret na reserva do aviso; rodada interrompida:', detalhe)
          return { status: 502, corpo: { ok: false, erro: 'reserva_recusada', detalhe, resultado } }
        }
        resultado.push({ chave: curto, resultado: 'esperando', motivo: 'falha_na_reserva_do_aviso', detalhe })
        continue
      }
      if (r === 'adiado') {
        await devolver(linha.chave, false)
        adiados++
        continue
      }
      if (r !== 'reservado') { // duplicado | janela: já foi avisada
        const motivo = `aviso_chatwoot_${r}`
        await marcar(linha.chave, 'ignorada', motivo)
        resultado.push({ chave: curto, resultado: 'ignorada', motivo })
        continue
      }
      avisoReservado = aviso
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

    let chegouNoEnvio = false // true = o enviarTemplate foi chamado: a partir daqui uma falha pode ser ambígua
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
      chegouNoEnvio = true
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
      // ⚠️ Falha AMBÍGUA no envio (timeout/queda/5xx/erro estranho do enviar_template): o Chatwoot/Meta pode ter aceitado.
      // Com reserva: NÃO libera (liberar permitiria um segundo aviso) e NÃO devolve (reenviaria): `falhou`, visível.
      const ambigua = chegouNoEnvio && (!(e instanceof ErroChatwoot) || e.status === 0 || e.status >= 500)
      if (avisoReservado && ambigua) {
        await marcar(linha.chave, 'falhou', `envio_incerto_conferir_no_chatwoot: ${detalhe}`)
        resultado.push({ chave: curto, resultado: 'falhou', motivo: 'envio_incerto', detalhe })
        continue
      }
      await liberarReserva() // falha comprovadamente ANTES de a mensagem ser aceita: a reserva não pode ficar órfã
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

  return { status: 200, corpo: { ok: true, modo, tipo, quantidade: resultado.length, ...(reservar ? { adiados } : {}), resultado } }
}
