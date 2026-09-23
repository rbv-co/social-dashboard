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

export const PASSOS = [
  { id: 1, quem: 'Ionara', titulo: 'Cadastrar uma parceira nova',
    onde: 'Comercial Vessel → Stylist Circle → bloco "Cadastrar parceira": nome, WhatsApp e "Como ela chegou", depois "Cadastrar parceira".' },
  { id: 2, quem: 'Ionara', titulo: 'Abrir a ficha dela e registrar um contato',
    onde: 'No quadro, toque no nome dela (ou em "Registrar contato"): escolha o canal, o resultado "Conversou" e "Registrar contato".' },
  { id: 3, quem: 'Ionara', titulo: 'Aceitar a sugestão de etapa ou avançar no quadro',
    onde: 'Na ficha, "Mover para Contatado" — ou no quadro, "Avançar para…".' },
  { id: 4, quem: 'Ionara', titulo: 'Marcar um Private Edit com essa parceira',
    onde: 'Comercial Vessel → Private Edit → "Marcar um encontro": escolha ela, o dia de HOJE, a praça, e "Criar encontro". O sistema a ativa sozinho.' },
  { id: 5, quem: 'Ionara', titulo: 'Incluir duas convidadas',
    onde: 'No encontro novo, "Convidadas e presença": nome e WhatsApp, "Incluir convidada" — duas vezes.' },
  { id: 6, quem: 'Ionara', titulo: 'Gerar o cartão e a mensagem de uma convidada',
    onde: 'No cartão da convidada, "Cartão e mensagem".' },
  { id: 7, quem: 'Ionara', titulo: 'Marcar "Convite enviado" e "Confirmou"',
    onde: 'Nos botões do cartão da convidada, na lista do encontro.' },
  { id: 8, quem: 'Gerente', titulo: 'No dia, marcar "Veio" e "Não veio"',
    onde: 'Uma convidada "Veio", a outra "Não veio".' },
  { id: 9, quem: 'Gerente', titulo: 'Fechar o encontro como Realizado',
    onde: 'Em "A situação" do encontro: "Realizado", a data de hoje, e "Gravar situação".' },
  { id: 10, quem: 'Sistema', titulo: 'Ver o placar do Stylist Circle mudar',
    onde: 'Volte ao Stylist Circle: o placar recalcula sozinho — Realizados, Presentes e a parceira em "Evento realizado".' },
  { id: 11, quem: 'Ionara', titulo: 'Tentar cancelar um encontro sem motivo e ver o aviso',
    onde: 'Em qualquer encontro, Situação "Cancelado", deixe o motivo em branco e "Gravar situação".' },
]

export function roteiroVazio() {
  return { feitos: [], convidadas: [], marcas: [], presencas: [] }
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
    case 'etapa_mudada': marcar(3); break
    case 'encontro_criado': marcar(4); break
    case 'convidada_incluida':
      r.convidadas = junta(r.convidadas, dados.id)
      if (r.convidadas.length >= 2) marcar(5)
      break
    case 'cartao_gerado': marcar(6); break
    case 'convite_marcado':
      r.marcas = junta(r.marcas, dados.marca)
      if (r.marcas.includes('enviado') && r.marcas.includes('sim')) marcar(7)
      break
    case 'presenca_marcada':
      r.presencas = junta(r.presencas, dados.situacao)
      if (r.presencas.includes('realizado') && r.presencas.includes('no_show')) marcar(8)
      break
    case 'encontro_situacao': if (dados.status === 'realizado') marcar(9); break
    // ⚠️ SÓ DEPOIS DO PASSO 9: ler o placar antes de fechar o encontro não é
    // "ver o placar mudar".
    case 'placar_lido': if (r.feitos.includes(9)) marcar(10); break
    case 'recusa_sem_motivo': marcar(11); break
    default: return roteiro
  }
  r.feitos.sort((a, b) => a - b)
  return r
}

export function resumoDoRoteiro(roteiro) {
  return `Roteiro · ${roteiro.feitos.length} de ${PASSOS.length} ✓`
}
