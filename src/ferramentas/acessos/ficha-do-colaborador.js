// Lógica PURA da Ficha do Colaborador (Tarefa 4 do redesign de Acessos).
//
// Igual aos outros .js desta pasta: aqui NÃO se importa nada, NÃO se fala com o
// banco e NÃO se mexe no DOM. A tela passa o que já recebeu do proxy/banco e a
// gente só DECIDE texto honesto e conta. Assim dá pra testar com `node --test`
// sem precisar subir a tela (que nem abre em localhost por causa de CORS).

// Normaliza e-mail pra comparar: minúsculo e sem espaço nas pontas. E-mail
// vazio/nulo vira '' — e '' nunca casa com nada (é o jeito de dizer "sem e-mail").
export function normalizarEmail(email) {
  return String(email == null ? '' : email).trim().toLowerCase()
}

// Tira a numeração de ordenação do começo do nome da pasta ("01. Financeiro" ->
// "Financeiro", "03.1. Mídia" -> "Mídia") só pra EXIBIR bonito no resumo. Se
// sobrar vazio (nome era só o número), devolve o nome original — nunca some com
// a pasta. Não altera o dado; é cosmético.
export function limparNomePasta(nome) {
  const bruto = String(nome == null ? '' : nome).trim()
  const limpo = bruto.replace(/^\s*\d+(\.\d+)*\.?\s*/, '').trim()
  return limpo || bruto
}

/**
 * Conta as pastas do OneDrive de UMA pessoa cruzando o email_outlook dela com o
 * que o proxy `microsoft.allShares` devolveu ({items:[{email,pasta,...}], falhas}).
 *
 * HONESTIDADE (a regra desta tarefa):
 *   - Se a consulta ao proxy FALHOU (resp nulo ou sem `items`), devolve
 *     `indisponivel:true` e total 0 — quem exibe TEM que dizer "não deu pra
 *     consultar", nunca mostrar 0 como se fosse fato.
 *   - Se o proxy leu só PARTE das pastas (`resp.falhas` tem itens), devolve
 *     `parcial:true`: o número é um piso ("pelo menos N"), não o total.
 *   - Se a pessoa não tem email_outlook, `semEmail:true` e total 0 — aqui 0 É
 *     fato: sem e-mail Outlook nenhuma pasta pode ter sido compartilhada com ela.
 *
 * @param {{email_outlook?:string, nome?:string}} pessoa
 * @param {{items?:Array, falhas?:Array}|null} resp  retorno de microsoft.allShares (ou null se falhou)
 * @returns {{indisponivel:boolean, semEmail:boolean, parcial:boolean, total:number, pastas:string[]}}
 */
export function contarAcessosOneDrive(pessoa, resp) {
  const email = normalizarEmail(pessoa && pessoa.email_outlook)
  const temItems = !!(resp && Array.isArray(resp.items))
  if (!temItems) {
    return { indisponivel: true, semEmail: !email, parcial: false, total: 0, pastas: [] }
  }
  const parcial = Array.isArray(resp.falhas) && resp.falhas.length > 0
  if (!email) {
    return { indisponivel: false, semEmail: true, parcial, total: 0, pastas: [] }
  }
  const pastas = resp.items
    .filter(it => normalizarEmail(it && it.email) === email)
    .map(it => (it && it.pasta) || '')
    .filter(Boolean)
  return { indisponivel: false, semEmail: false, parcial, total: pastas.length, pastas }
}

/**
 * Texto curto e honesto pra linha do OneDrive na ficha ("Acessos desta pessoa").
 * Lista as primeiras `limite` pastas (nome limpo) + "e mais X", e SEMPRE reflete
 * o estado incerto (indisponível / parcial / sem e-mail) em vez de fingir número.
 *
 * @returns {{detalhe:string, valor:string, incerto:boolean}}
 */
export function resumoAcessosOneDrive(resultado, limite = 3) {
  const r = resultado || {}
  if (r.indisponivel) {
    return { detalhe: 'não foi possível consultar o OneDrive agora', valor: '?', incerto: true }
  }
  if (r.semEmail) {
    return { detalhe: 'sem e-mail Outlook cadastrado — nenhuma pasta pode ser compartilhada', valor: '0', incerto: false }
  }
  if (!r.total) {
    return { detalhe: 'nenhuma pasta compartilhada no OneDrive', valor: '0', incerto: !!r.parcial }
  }
  const nomes = r.pastas.slice(0, limite).map(limparNomePasta)
  const resto = r.total - nomes.length
  let detalhe = nomes.join(', ')
  if (resto > 0) detalhe += '… e mais ' + resto
  if (r.parcial) detalhe += ' · leitura parcial'
  // `≥` avisa que, com falhas de leitura, o número é um piso e não o total exato.
  return { detalhe, valor: (r.parcial ? '≥' : '') + r.total, incerto: !!r.parcial }
}

/**
 * Estado do WorkDrive (Zoho) pra pessoa. A migração pro WorkDrive é por TIME
 * (workspace), não por pasta individual, então a heurística honesta é: quem já
 * tem caixa corporativa (email_corporativo) participa do time; quem não tem
 * ainda não foi migrado.
 *
 * @returns {{migrada:boolean, texto:string}}
 */
export function statusWorkdrive(pessoa) {
  const temCorp = !!normalizarEmail(pessoa && pessoa.email_corporativo)
  if (temCorp) return { migrada: true, texto: 'via time (workspace)' }
  return { migrada: false, texto: 'ainda não migrada para o WorkDrive' }
}

/**
 * Decide se um campo da ficha está PREENCHIDO (mostra o valor) ou VAZIO (vira o
 * botão "+ adicionar", pra não deixar espaço em branco morto e convidar a
 * preencher).
 */
export function campoPreenchido(valor) {
  return String(valor == null ? '' : valor).trim().length > 0
}

/**
 * Números do resumo da ficha (topo da identidade: nº pastas · nº equipamentos ·
 * nº termos). Centraliza o "incerto": se o OneDrive não pôde ser lido, `pastas`
 * vem `null` (quem exibe mostra "?"), NUNCA 0. `equipamentos`/`termos` aceitam
 * tanto um array quanto um número já contado.
 *
 * @returns {{pastas:number|null, equipamentos:number, termos:number}}
 */
export function resumoDaFicha(acessosOneDrive, equipamentos, termos) {
  const a = acessosOneDrive || {}
  const conta = (x) => Array.isArray(x) ? x.length : (Number(x) || 0)
  return {
    pastas: a.indisponivel ? null : (Number(a.total) || 0),
    equipamentos: conta(equipamentos),
    termos: conta(termos),
  }
}

// ── OS CAMPOS DA FICHA ───────────────────────────────────────────────────────
//
// Coluna do banco -> rótulo e tipo do input. É a fonte única: o desenho da
// ficha, o editor de um campo só e a ORDEM em que eles aparecem saem todos
// daqui.
//
// POR QUE ISTO SAIU DA TELA (11/08/2026): lá havia duas listas que precisavam
// concordar — a das colunas que aparecem e a da configuração de cada uma. Elas
// divergiram (`email_outlook` estava numa e não na outra) e NENHUMA ficha
// abria: o desenho lia `cfg.label` de um `undefined`, dava TypeError e a função
// morria antes de escrever a tela.
//
// Aqui isso não tem como acontecer: a lista É derivada da configuração, então
// coluna listada sem configuração deixou de ser um estado possível.
export const CAMPOS_DA_FICHA = {
  email_corporativo: { label: 'E-mail corporativo', tipo: 'email' },
  email_outlook: { label: 'E-mail Outlook', tipo: 'email' },
  conta_apple: { label: 'Conta Apple (iCloud)', tipo: 'email' },
  numero_corporativo: { label: 'Telefone corporativo', tipo: 'tel' },
  numero_pessoal: { label: 'Telefone pessoal', tipo: 'tel' },
  data_inicio_contrato: { label: 'Início de contrato', tipo: 'date' },
  data_fim_contrato: { label: 'Fim de contrato', tipo: 'date' },
  motivo_saida: { label: 'Motivo da saída', tipo: 'text' },
};

// Os campos do contato, na ordem da tela. Os dois de saída só aparecem para
// quem foi desligado, e no fim: perguntar "motivo da saída" de quem está
// trabalhando é ruído na ficha de todo mundo.
const CONTATO = ['email_corporativo', 'email_outlook', 'conta_apple',
  'numero_corporativo', 'numero_pessoal', 'data_inicio_contrato'];
const SAIDA = ['data_fim_contrato', 'motivo_saida'];

/**
 * Os campos que a ficha mostra, já com rótulo e tipo juntos.
 * @param ativo  a pessoa ainda trabalha aqui?
 */
export function camposDaFicha(ativo) {
  return [...CONTATO, ...(ativo ? [] : SAIDA)]
    .map((col) => ({ col, ...CAMPOS_DA_FICHA[col] }));
}
