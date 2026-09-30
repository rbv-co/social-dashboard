// supabase/functions/_shared/mensagem-de-abandono.js
//
// Regras PURAS do robô de mensagens de recuperação (sem rede, sem banco). Quem executa é
// a edge `enviar-mensagem-abandono`. Ver docs/superpowers/specs/2026-09-29-mensagem-de-abandono-design.md.

const FUSO = 'America/Sao_Paulo'
export const JANELA_INICIO = 8   // 08:00 entra
export const JANELA_FIM = 21     // 21:00 não entra

/**
 * "maria", "MARIA" -> "Maria"; "ana-clara" -> "Ana-Clara"; "d'avila" -> "D'Avila".
 * Maiúsculas e minúsculas MISTURADAS foram digitadas de propósito ("DeAndre", "McKenzie"): ficam como vieram.
 */
function capitalizarNome(palavra) {
  const minusculo = palavra.toLocaleLowerCase('pt-BR')
  if (palavra !== minusculo && palavra !== palavra.toLocaleUpperCase('pt-BR')) return palavra
  return minusculo.replace(/(^|[-'’])(\p{L})/gu, (_, separador, letra) => separador + letra.toLocaleUpperCase('pt-BR'))
}

/** Só o primeiro nome, já formatado. Nunca devolve vazio: o template exige a variável preenchida. */
export function primeiroNome(nome) {
  if (typeof nome !== 'string') return 'cliente'
  const primeiro = nome.trim().split(/\s+/)[0]
  if (!primeiro) return 'cliente'
  return capitalizarNome(primeiro.slice(0, 30))
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
  // ⚠️ Base vazia: `startsWith('')` é sempre true e o "sufixo" seria a URL inteira (botão quebrado).
  if (typeof base !== 'string' || !base || typeof url !== 'string' || !url.startsWith(base)) return null
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

const LIMITE_MAXIMO_POR_RODADA = 100

/**
 * Configuração que o robô exige ANTES de tocar em qualquer lead. Devolve a lista de problemas
 * (vazia = ok). O objetivo é falhar FECHADO: segredo ausente ou inválido nunca pode virar
 * "sem limite" nem "link quebrado para todos".
 * `modo` seco não fala com o Chatwoot, então não exige Chatwoot nem template.
 */
export function validarConfig({ modo, limite, linkBase, templateNome, chatwoot = {}, soPara = [] }) {
  const problemas = []
  if (!Number.isInteger(limite) || limite < 1 || limite > LIMITE_MAXIMO_POR_RODADA) {
    problemas.push(`ENVIO_LIMITE_POR_RODADA inválido (inteiro de 1 a ${LIMITE_MAXIMO_POR_RODADA})`)
  }
  if (!linkBase || !linkBase.endsWith('/')) problemas.push('LINK_BASE vazio ou sem a barra final')
  if (modo === 'seco') return problemas
  if (!templateNome) problemas.push('TEMPLATE_NOME vazio')
  if (!/^https?:\/\//.test(chatwoot.url ?? '')) problemas.push('CHATWOOT_URL vazio ou sem http(s)')
  if (!chatwoot.contaId) problemas.push('CHATWOOT_CONTA_ID vazio')
  if (!Number.isInteger(Number(chatwoot.caixaId)) || Number(chatwoot.caixaId) < 1) problemas.push('CHATWOOT_CAIXA_ID vazio ou inválido')
  if (!chatwoot.token) problemas.push('CHATWOOT_API_TOKEN vazio')
  if (modo === 'lista' && !soPara.length) problemas.push('ENVIO_SO_PARA vazio')
  return problemas
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
