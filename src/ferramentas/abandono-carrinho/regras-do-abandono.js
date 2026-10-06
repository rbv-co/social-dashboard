// Regras puras da tela de Checkouts Abandonados (sem Vue, sem banco).

// Os mesmos 10 minutos do Shopify. ⚠️ Quem MOVE o checkout para a fila é o banco
// (pg_cron -> mover_abandonados_para_fila(10), db/migrations/2026-09-29-abandono-de-checkout.sql).
// Aqui é só a contagem regressiva desenhada na tela — se mudar lá, mude aqui.
export const MINUTOS_ATE_ABANDONO = 10
export const LIMITE_ABANDONO = 500

/** Segundos que faltam para o checkout ir para a fila (nunca negativo). */
export function segundosRestantes(ultimoEventoEm, agora = Date.now()) {
  const passou = (agora - new Date(ultimoEventoEm).getTime()) / 1000
  return Math.max(0, Math.ceil(MINUTOS_ATE_ABANDONO * 60 - passou))
}

/** 0–100: quanto do prazo já correu (para a barra). */
export function percentualDoPrazo(ultimoEventoEm, agora = Date.now()) {
  const total = MINUTOS_ATE_ABANDONO * 60
  return Math.round(((total - segundosRestantes(ultimoEventoEm, agora)) / total) * 100)
}

export function formatarContagem(segundos) {
  const m = Math.floor(segundos / 60)
  const s = segundos % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

/** Separa a lista do banco nas quatro colunas, cada uma na ordem que faz sentido. */
export function separarPorStatus(linhas) {
  const porData = (campo, sentido) => (a, b) =>
    sentido * (new Date(a[campo]).getTime() - new Date(b[campo]).getTime())
  const de = (status) => linhas.filter((l) => l.status === status)
  return {
    // quem vai vencer primeiro fica em cima
    aguardando: de('aguardando').sort(porData('ultimo_evento_em', 1)),
    // Pix/boleto: pedido criado e ainda não pago. NÃO está na fila de envio (o cliente ainda pode pagar).
    pagamentoPendente: de('pagamento_pendente').sort(porData('pedido_criado_em', -1)),
    filaEnvio: de('fila_envio').sort(porData('fila_envio_em', -1)),
    compraram: de('comprou').sort(porData('comprou_em', -1)),
  }
}

/** A consulta bateu no limite? Então a lista pode estar cortada e a tela avisa. */
export const foiCortado = (linhas) => linhas.length >= LIMITE_ABANDONO

const MOTIVOS_IGNORADA = {
  sem_telefone: 'sem telefone: não recebe WhatsApp',
  telefone_invalido: 'telefone inválido',
  pediu_para_nao_receber: 'pediu para não receber',
  sem_link: 'sem link de recuperação',
  nao_esta_mais_na_fila: 'já não estava na fila',
}

/** Selo do estado da mensagem de WhatsApp para os itens da Fila de mensagens. */
export function seloDaMensagem(linha) {
  switch (linha.mensagem_status) {
    case 'enviando': return { texto: 'enviando…', tipo: 'info' }
    // "enviada" = aceita pelo Chatwoot. Ele responde 200 e só depois a Meta pode recusar o template,
    // então o rótulo não promete "entregue".
    case 'enviada': return { texto: 'enviada ao Chatwoot', tipo: 'ok' }
    case 'falhou':
      return linha.mensagem_motivo === 'travada_sem_confirmacao'
        ? { texto: 'sem confirmação: confira no Chatwoot', tipo: 'erro' }
        : { texto: 'falhou', tipo: 'erro' }
    case 'ignorada': return { texto: MOTIVOS_IGNORADA[linha.mensagem_motivo] ?? 'não enviada', tipo: 'neutro' }
    default: return null
  }
}

// ── MENSAGENS QUE NÃO SAÍRAM (faixa de aviso) ────────────────────────────
// Vem de `mensagens_que_falharam` (db/migrations/2026-10-06-mensagens-que-falharam.sql).
// Existe porque a falha de 04/10/2026 (Camila Altran, 422 do Chatwoot) ficou só no banco, que a tela não lia.
export const HORAS_DO_AVISO_DE_FALHA = 48

const ROTULO_DO_TIPO = { inicio: 'início do checkout', followup: 'follow-up', pedido: 'pedido recebido', abandono: 'abandono (24 h)' }

/** Texto humano do motivo gravado pelo robô; o bruto vai junto em `tecnico` para quem for investigar. */
export function explicarFalha(motivo) {
  const m = String(motivo ?? '')
  if (/fluxo automatico/i.test(m)) return 'o Chatwoot barrou o template (trava do Chatwoot, não é problema da cliente)'
  if (/travada_sem_confirmacao/.test(m)) return 'o envio ficou sem confirmação: confira no Chatwoot se a mensagem saiu'
  if (/:(401|403)\b/.test(m)) return 'o Chatwoot recusou a credencial do robô'
  if (/:4\d\d\b/.test(m)) return 'o Chatwoot recusou o envio'
  return 'o envio falhou'
}

/** Linhas de `mensagens_que_falharam` -> o que a faixa mostra. Vazio = nada a dizer (a faixa nem aparece). */
export function falhasParaAviso(linhas) {
  return (linhas ?? []).map((l) => ({
    chave: `${l.tipo}:${l.chave}`,
    nome: l.nome || 'Sem nome',
    tipo: ROTULO_DO_TIPO[l.tipo] ?? l.tipo,
    quando: l.quando,
    explicacao: explicarFalha(l.motivo),
    tecnico: String(l.motivo ?? '').slice(0, 140),
  }))
}
