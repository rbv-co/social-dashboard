/* O ROTEIRO DA DEMONSTRAÇÃO — os passos, e quando cada um conta como feito.
 *
 * ⚠️ NINGUÉM MARCA PASSO À MÃO. Cada um se marca sozinho pelo aviso que o banco
 * de mentira manda (`postMessage` com `origem: 'demonstracao-vessel'`) quando o
 * gesto de verdade dá certo na tela de verdade. Passo marcado sem o gesto
 * seria o roteiro mentindo — a mesma regra de "a tela nunca mente".
 *
 * Puro de propósito (sem DOM): o teste roda no Node.
 */
export const ORIGEM_DOS_AVISOS = 'demonstracao-vessel'

// ⚠️ 25/09/2026 (Task 12): o roteiro passou a contar SÓ a jornada do Stylist
// Circle — cadastrar → conversar → mover pelo funil → ativar. O Private Edit
// saiu de vista (o dono pediu a demo enxuta na PRIMEIRA das três soluções);
// os passos de marcar encontro, convidar e fechar presença saíram junto.
// Placar por edição e cadastro de Praças/Edições ficaram de fora — o banco de
// mentira ainda não avisa (`aoAvisar`) nenhum gesto de
// vessel_placar_da_edicao/vessel_praca_criar/vessel_edicao_criar/
// vessel_edicao_abrir, e passo sem gesto que o marque não entra aqui.
// ⚠️ 25/09/2026 (Task 13): O FUNIL DA DEMONSTRAÇÃO TROCOU (pedido direto do
// dono). O de hoje (Identificado → Classificação → Prospectado → Convidado →
// Confirmou Ida → Esteve Presente) virou "Stylist levantado → Validado →
// Conversa → Confirmado → Presença" — cinco etapas, as duas saídas de sempre
// (Ativada e Desclassificado). Os passos 3 e 4 abaixo mudaram de alvo: era
// "mover para Classificação" e "mover para Prospectado", agora é "mover para
// Validado" e "mover para Conversa" (a nova marcada como prospectada — ver
// `dados-iniciais.js`). ⚠️ É SÓ NESTA DEMONSTRAÇÃO: o funil de verdade é
// cadastro em `vessel_stylist_etapas`, o dono muda pela tela "Etapas do
// funil", sem código.
export const PASSOS = [
  // ⚠️ O nome "Stylist levantado" é só a etapa; a explicação do dono ("vem da
  // nossa pesquisa ou do cadastro da LP") não cabe no cabeçalho da coluna do
  // quadro (que é tela de verdade, fora do alcance desta demo) — por isso
  // mora aqui, no primeiro passo do roteiro guiado.
  { id: 1, quem: 'Ionara', titulo: 'Cadastrar uma parceira nova',
    onde: 'Comercial Vessel → Stylist Circle → bloco "Cadastrar parceira": nome, WhatsApp e "Como ela chegou", depois "Cadastrar parceira". Ela entra na coluna "Stylist levantado" — vem da nossa pesquisa ou do cadastro da LP.' },
  { id: 2, quem: 'Ionara', titulo: 'Abrir a ficha dela e registrar um contato',
    onde: 'No quadro, toque no nome dela (ou em "Registrar contato"): escolha o canal, o resultado "Conversou" e "Registrar contato".' },
  { id: 3, quem: 'Ionara', titulo: 'Validar a parceira (mover para Validado)',
    onde: 'No quadro, arraste o cartão dela até a coluna "Validado" — ou, na ficha, "Ou mover para" → Validado e "Mover".' },
  { id: 4, quem: 'Ionara', titulo: 'Mover a parceira para Conversa',
    onde: 'No quadro, arraste o cartão dela até a coluna "Conversa" — ou, na ficha, "Ou mover para" → Conversa e "Mover".' },
  // ⚠️ 24/09/2026: SÓ QUEM ESTÁ NA ATIVADA PODE TER PRIVATE EDIT. Este passo
  // conta quando ela chega numa etapa que libera Private Edit — mover para
  // qualquer outra não basta.
  { id: 5, quem: 'Ionara', titulo: 'Ativar a parceira (mover para Ativada)',
    onde: 'No quadro, arraste o cartão dela até a coluna "Ativada" (no computador) — ou, na ficha, "Ou mover para" → Ativada e "Mover". As etapas se configuram na engrenagem "Etapas do funil".' },
]

export function roteiroVazio() {
  return { feitos: [] }
}

const junta = (lista, valor) => (lista.includes(valor) ? lista : [...lista, valor])

/** Devolve o roteiro depois de um aviso do banco de mentira (não muta o de entrada). */
export function aplicarAviso(roteiro, evento, dados = {}) {
  const r = { ...roteiro, feitos: [...roteiro.feitos] }
  const marcar = (id) => { r.feitos = junta(r.feitos, id) }
  switch (evento) {
    case 'pronta': return roteiroVazio() // a Central recarregou: o banco voltou ao começo
    case 'stylist_criada': marcar(1); break
    case 'contato_registrado': marcar(2); break
    case 'etapa_mudada':
      if (dados.para === 'Validado') marcar(3)
      else if (dados.para === 'Conversa') marcar(4)
      else if (dados.libera_private_edit) marcar(5)
      break
    default: return roteiro
  }
  r.feitos.sort((a, b) => a - b)
  return r
}

export function resumoDoRoteiro(roteiro) {
  return `Roteiro · ${roteiro.feitos.length} de ${PASSOS.length} ✓`
}
