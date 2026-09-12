// OS ESTADOS DE UMA PESSOA NA LISTA DE USUÁRIOS — a regra, sem a tela.
//
// POR QUE EXISTE (medido na produção em 27/08/2026): a lista "Sem time de venda"
// tem 19 pessoas, e já sabia responder "onde está fulano" — a busca por nome e
// e-mail existe desde antes, e a gaveta por Marca agrupa bem hoje (RBV Company
// 10, Vessel 5, sem marca 4).
//
// O que ela NÃO sabia responder era a pergunta do outro lado: "quem está em tal
// SITUAÇÃO?". Os avisos existem, mas um por cartão — descobrir que 4 pessoas
// estão sem cadastro de colaborador exigia varrer os 19 com o olho, e é
// justamente o tipo de conta que ninguém refaz depois da primeira vez.
//
// Medido no dia: 4 sem cadastro · 9 admin (3 deles super) · 1 precisa trocar
// senha · 0 desativado.
//
// ⚠️ ESTE MÓDULO NÃO DECIDE O QUE APARECE. Ele devolve os estados e as
// contagens; esconder o filtro zerado é decisão da tela, e por isso a contagem
// devolve TODAS as chaves mesmo em zero — faltar a chave faria a tela escrever
// "NaN" em vez de sumir com o filtro.
//
// PURO, como os vizinhos desta pasta: sem DOM e sem banco.

// O catálogo, na ordem em que a tela desenha. A ordem é a da urgência: o que
// está incompleto vem antes do que é só informação.
export const ESTADOS = [
  {
    chave: 'sem-cadastro',
    rotulo: 'Sem cadastro',
    // Este é o que mais custa quando passa batido: sem o elo com
    // `acessos_pessoas`, aviso no celular pode não chegar na pessoa, e sem dar
    // erro. Foi o defeito da Raíssa, e foi o do Márcio.
    ajuda: 'Login que não está ligado a nenhum colaborador',
  },
  { chave: 'admin', rotulo: 'Admin', ajuda: 'Enxerga e muda o que os outros não podem' },
  { chave: 'trocar-senha', rotulo: 'Trocar senha', ajuda: 'Vai ser obrigada a trocar no próximo acesso' },
  { chave: 'desativado', rotulo: 'Desativado', ajuda: 'A conta existe mas não entra' },
]

const CHAVES = new Set(ESTADOS.map((e) => e.chave))

/** Os estados desta pessoa. Lista vazia é resposta legítima: quer dizer
 *  "completa e comum", que é a maioria. */
export function estadosDe(pessoa) {
  if (!pessoa || typeof pessoa !== 'object') return []
  const u = pessoa.bruto || {}
  const fora = []

  if (pessoa.temCadastro === false) fora.push('sem-cadastro')

  // SUPER-ADMIN CONTA COMO ADMIN. Ele é admin com mais poder, não uma categoria
  // à parte: filtrar "admin" e não achar os três super-admins seria a lista
  // mentindo justamente sobre quem manda no sistema.
  if (u.role === 'admin' || u.is_superadmin === true) fora.push('admin')

  if (u.precisa_trocar_senha === true) fora.push('trocar-senha')
  if (u.disabled === true) fora.push('desativado')

  return fora
}

/** Quantas pessoas em cada estado. Devolve TODAS as chaves, inclusive em zero. */
export function contarEstados(pessoas) {
  const conta = {}
  for (const e of ESTADOS) conta[e.chave] = 0
  for (const p of pessoas || []) {
    for (const chave of estadosDe(p)) {
      if (chave in conta) conta[chave] += 1
    }
  }
  return conta
}

/**
 * Deixa passar quem tem QUALQUER um dos estados escolhidos.
 *
 * ⚠️ É "ou", e não "e", de propósito. "Sem cadastro" E "admin" ao mesmo tempo
 * daria zero quase sempre nesta base, e filtro que zera a lista ensina a pessoa
 * a não usar filtro nenhum. Marcar dois é pedir "me mostre os dois grupos".
 *
 * Nada escolhido = lista inteira. A ordem que entrou é a que sai: quem ordena é
 * quem chamou.
 */
export function aplicarEstados(pessoas, escolhidos) {
  const lista = pessoas || []
  const alvo = (escolhidos || []).filter((c) => CHAVES.has(c))
  // Só chave desconhecida escolhida: ninguém passa. Deixar passar todo mundo
  // faria um filtro quebrado parecer um filtro desligado.
  if (!alvo.length) return (escolhidos || []).length ? [] : lista
  return lista.filter((p) => estadosDe(p).some((c) => alvo.includes(c)))
}
