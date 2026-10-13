// A FRASE DE CADA RECUSA DOS PROXIES DE IA E DE DOCUMENTO PELA API EM GO (Plano 7).
//
// As edges do Supabase respondiam com frase pronta (`detalhe`, `comoResolver`).
// Os proxies do 5.7 respondem com CÓDIGO (`{"error":"muitas_leituras"}`), e a
// tela mostra o que recebe: sem este mapa a pessoa leria "muitas_leituras".
// Código desconhecido cai na frase que o corpo trouxer, ou na genérica com o
// status — nunca no código cru.
//
// PURO: sem rede, sem tela.

const FRASES = {
  sem_conta: 'Escolha primeiro a conta de anúncios.',
  conta_nao_encontrada: 'Você não tem acesso a esta conta de anúncios.',
  muitas_leituras: 'A IA já foi chamada muitas vezes na última hora. Espere um pouco e tente de novo.',
  chave_nao_configurada: 'A chave da IA não está configurada no servidor. Avise quem administra a Central.',
  nao_e_pdf: 'Esse arquivo não é um PDF.',
  muitos_documentos: 'Você já leu muitos PDFs na última hora. Espere um pouco e tente de novo.',
  // os códigos que as edges já devolviam (e a tela mostrava crus)
  sem_evidencia: 'Faltam os dados da campanha para a IA analisar.',
  sem_arquivo: 'Escolha um PDF para ler.',
  sem_texto: 'O PDF não tem texto que dê para ler — pode ser só imagem.',
  arquivo_grande_demais: 'O PDF é grande demais para ler.',
  corpo_invalido: 'O pedido saiu incompleto. Recarregue a página e tente de novo.',
  sem_credencial: 'A chave da IA não está configurada no servidor. Avise quem administra a Central.',
  anthropic_inacessivel: 'Não consegui falar com a IA agora. Tente de novo em instantes.',
  anthropic_recusou: 'A IA recusou o pedido. Tente de novo; se continuar, avise quem administra a Central.',
  recusado_pela_ia: 'A IA não quis ler este documento.',
  resposta_ilegivel: 'A IA respondeu algo que não deu para ler. Tente de novo.',
  sem_permissao: 'Você não tem permissão para usar isso.',
  nao_autenticado: 'Sua sessão expirou — entre de novo.',
}

/** A frase para a tela a partir do corpo e do status da resposta. */
export function fraseDoProxy(corpo, status) {
  const c = corpo || {}
  if (typeof c.mensagem === 'string' && c.mensagem) return c.mensagem
  if (typeof c.error === 'string' && FRASES[c.error]) return FRASES[c.error]
  const frase = c.comoResolver || c.detalhe
  if (frase) return frase
  if (typeof c.error === 'string' && c.error && !/^[a-z_]+$/.test(c.error)) return c.error
  return `O servidor não respondeu como esperado (HTTP ${status}). Tente de novo.`
}
