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
// Circle — identificar → conversar/classificar → prospectar → ativar. O
// Private Edit saiu de vista (o dono pediu a demo enxuta na PRIMEIRA das três
// soluções); os passos de marcar encontro, convidar e fechar presença saíram
// junto. Placar por edição e cadastro de Praças/Edições ficaram de fora — o
// banco de mentira ainda não avisa (`aoAvisar`) nenhum gesto de
// vessel_placar_da_edicao/vessel_praca_criar/vessel_edicao_criar/
// vessel_edicao_abrir, e passo sem gesto que o marque não entra aqui.
export const PASSOS = [
  { id: 1, quem: 'Ionara', titulo: 'Cadastrar uma parceira nova',
    onde: 'Comercial Vessel → Stylist Circle → bloco "Cadastrar parceira": nome, WhatsApp e "Como ela chegou", depois "Cadastrar parceira".' },
  { id: 2, quem: 'Ionara', titulo: 'Abrir a ficha dela e registrar um contato',
    onde: 'No quadro, toque no nome dela (ou em "Registrar contato"): escolha o canal, o resultado "Conversou" e "Registrar contato".' },
  { id: 3, quem: 'Ionara', titulo: 'Classificar a parceira (mover para Classificação)',
    onde: 'No quadro, arraste o cartão dela até a coluna "Classificação" — ou, na ficha, "Ou mover para" → Classificação e "Mover".' },
  { id: 4, quem: 'Ionara', titulo: 'Prospectar a parceira (mover para Prospectado)',
    onde: 'No quadro, arraste o cartão dela até a coluna "Prospectado" — ou, na ficha, "Ou mover para" → Prospectado e "Mover".' },
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
      if (dados.para === 'Classificação') marcar(3)
      else if (dados.para === 'Prospectado') marcar(4)
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
