// supabase/functions/_shared/mensagem-de-abandono.js
//
// Regras PURAS do robô de mensagens de recuperação (sem rede, sem banco). Quem executa é
// a edge `enviar-mensagem-abandono`. Ver docs/superpowers/specs/2026-09-29-mensagem-de-abandono-design.md.

const FUSO = 'America/Sao_Paulo'
export const JANELA_INICIO = 8   // 08:00 entra
export const JANELA_FIM = 21     // 21:00 não entra

/** Só o primeiro nome. Nunca devolve vazio: o template exige a variável preenchida. */
export function primeiroNome(nome) {
  if (typeof nome !== 'string') return 'cliente'
  const primeiro = nome.trim().split(/\s+/)[0]
  if (!primeiro) return 'cliente'
  return primeiro.slice(0, 30)
}

/**
 * Celular brasileiro no formato que o Chatwoot/WhatsApp usa como source_id: só dígitos,
 * `55` + DDD (2, sem zero) + `9` + 8 dígitos = 13. Fixo (10 dígitos) e celular sem o 9 NÃO
 * recebem WhatsApp de forma confiável: viram null e o item é ignorado.
 */
export function normalizarTelefone(bruto) {
  if (typeof bruto !== 'string') return null
  let d = bruto.replace(/\D/g, '')
  if (d.startsWith('00')) d = d.slice(2)
  if (d.length === 10 || d.length === 11) d = '55' + d
  return /^55[1-9][1-9]9\d{8}$/.test(d) ? d : null
}

/** 08:00 ≤ hora < 21:00 em Brasília (o Brasil não tem horário de verão desde 2019). */
export function dentroDaJanela(agora = new Date()) {
  const hora = Number(new Intl.DateTimeFormat('en-US', { hour: 'numeric', hourCycle: 'h23', timeZone: FUSO }).format(agora))
  return hora >= JANELA_INICIO && hora < JANELA_FIM
}

/** O link dinâmico do template = parte FIXA + um sufixo variável. Fora da base fixa: null. */
export function sufixoDoLink(url, base) {
  if (typeof url !== 'string' || !url.startsWith(base)) return null
  return url.slice(base.length) || null
}

/**
 * `template_params` no formato que o Chatwoot aceita (app/models/message.rb).
 * ⚠️ O botão de URL precisa ser o PRIMEIRO botão do template: o Chatwoot usa a posição no array.
 */
export function montarTemplateParams({ nomeTemplate, idioma, nome, sufixoUrl }) {
  return {
    name: nomeTemplate,
    category: 'MARKETING',
    language: idioma,
    processed_params: {
      body: { '1': primeiroNome(nome) },
      buttons: [{ type: 'url', parameter: sufixoUrl }],
    },
  }
}

/** Decide o que fazer com UMA linha da fila. `bloqueados` = Set de telefones já normalizados. */
export function decidirEnvio({ linha, bloqueados, agora = new Date(), baseLink }) {
  if (linha.status !== 'fila_envio') return { acao: 'ignorar', motivo: 'nao_esta_mais_na_fila' }
  if (typeof linha.telefone !== 'string' || !linha.telefone.trim()) return { acao: 'ignorar', motivo: 'sem_telefone' }
  const telefone = normalizarTelefone(linha.telefone)
  if (!telefone) return { acao: 'ignorar', motivo: 'telefone_invalido' }
  if (bloqueados.has(telefone)) return { acao: 'ignorar', motivo: 'pediu_para_nao_receber' }
  const sufixoUrl = sufixoDoLink(linha.url_de_recuperacao, baseLink)
  if (!sufixoUrl) return { acao: 'ignorar', motivo: 'sem_link' }
  if (!dentroDaJanela(agora)) return { acao: 'esperar', motivo: 'fora_da_janela' }
  return { acao: 'enviar', telefone, nome: linha.nome, sufixoUrl }
}
