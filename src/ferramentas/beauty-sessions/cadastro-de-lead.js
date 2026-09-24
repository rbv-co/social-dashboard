/* O CADASTRO DA LEAD PELA EQUIPE, DENTRO DA BEAUTY SESSION — lógica pura.
 *
 * Pedido do dono (23–24/09/2026): a equipe cadastra a lead ali mesmo, "para não
 * ter só a possibilidade de depender da lead ler o QR code", e o cadastro
 * "segue a mesma dinâmica": base de clientes, planilha, e o rastreio da sessão.
 *
 * ⚠️ AS REGRAS DOS CAMPOS SÃO GÊMEAS DAS DO SITE, e não uma versão nossa. A
 * página do QR (`vessel-brasil/beauty-sessions/index.html`) pede o WhatsApp em
 * três pedaços (+país, DDD, número), limpa o nome com `nomeLimpo`, monta o
 * número com `whatsappCanonico` (`vessel-brasil/regras-da-lista.mjs`) e confere
 * com `problemasDoInteresse` (`regras-das-beauty-sessions.mjs`). Os dois
 * repositórios são separados — a Central não importa arquivo do site —, então o
 * teste ao lado LÊ os de lá quando a pasta está por perto e cobra que os dois
 * digam a mesma coisa para as mesmas entradas.
 *
 * ⚠️ QUEM BARRA DE VERDADE É O BANCO (`vessel_beauty_session_cadastrar_lead`).
 * Isto aqui existe para a equipe ver o erro ANTES de apertar, em pé no salão —
 * tela não é tranca.
 */

/** As mesmas três opções da página do QR (LP03), na mesma ordem. */
export const INTERESSES = [
  { valor: 'conhecer-a-loja', rotulo: 'Conhecer a loja' },
  { valor: 'rever-uma-peca', rotulo: 'Rever uma peça' },
  { valor: 'personal-atelier', rotulo: 'Personal Atelier' },
]

/** O mesmo teto do site e do Stylist Circle. */
export const INSTAGRAM_MAXIMO = 120

const soDigitos = (t) => String(t ?? '').replace(/\D/g, '')

/** `nomeLimpo` do site: espaço a mais some. */
export function nomeLimpo(texto) {
  return String(texto ?? '').trim().replace(/\s+/g, ' ')
}

/**
 * `whatsappCanonico` do site: `55` + DDD + número, SÓ DÍGITOS, ou `null`.
 * ⚠️ Mesma conta, linha a linha — ver o teste que compara com o de lá.
 */
export function whatsappCanonico(texto, pais = '55') {
  const cod = soDigitos(pais) || '55'
  const so = soDigitos(texto)
  if (cod === '55') {
    const sem = so.startsWith('55') && (so.length === 12 || so.length === 13) ? so.slice(2) : so
    if (sem.length !== 10 && sem.length !== 11) return null
    return `55${sem}`
  }
  const semPais = so.startsWith(cod) ? so.slice(cod.length) : so
  if (semPais.length < 6 || (cod + semPais).length > 15) return null
  return cod + semPais
}

/** Como o número aparece para uma pessoa ler (`whatsappBonito` do site). */
export function telefoneLegivel(canonico) {
  const so = soDigitos(canonico)
  if (so.startsWith('55') && (so.length === 12 || so.length === 13)) {
    const sem = so.slice(2)
    const resto = sem.slice(2)
    const meio = resto.length === 9 ? 5 : 4
    return `+55 (${sem.slice(0, 2)}) ${resto.slice(0, meio)}-${resto.slice(meio)}`
  }
  return so ? `+${so}` : String(canonico ?? '')
}

export const FORMULARIO_VAZIO = Object.freeze({
  nome: '', pais: '55', ddd: '', numero: '', instagram: '', interesse: '',
})

/**
 * O que está errado, em frases que a equipe entende. Lista vazia = pode enviar.
 *
 * ⚠️ SÓ NOME E WHATSAPP SÃO OBRIGATÓRIOS, como na página do QR.
 *
 * ⚠️ NÚMERO DE FORA DO BRASIL É AVISADO AQUI, e não só recusado lá dentro: o
 * banco guarda só `55` + DDD + número (`vessel_telefone_canonico`), e a página
 * do QR, que aceita escrever outro país, recebe a mesma recusa do banco sem
 * explicar. Aqui a equipe fica sabendo antes, com a frase certa.
 */
export function problemasDaLead(f = {}) {
  const problemas = []
  if (nomeLimpo(f.nome).length < 2) problemas.push('Escreva o nome dela.')
  const pais = soDigitos(f.pais) || '55'
  if (pais !== '55') {
    problemas.push('Por enquanto só dá para cadastrar WhatsApp do Brasil (+55).')
  } else if (!whatsappCanonico(`${f.ddd ?? ''}${f.numero ?? ''}`, pais)) {
    problemas.push('Confira o WhatsApp: DDD com 2 números e o número com 8 ou 9.')
  }
  if (String(f.instagram ?? '').trim().length > INSTAGRAM_MAXIMO) {
    problemas.push('O Instagram ficou longo demais. Use só o @ ou o endereço.')
  }
  if (f.interesse && !INTERESSES.some((i) => i.valor === f.interesse)) {
    problemas.push('Escolha o que ela gostaria agora numa das opções.')
  }
  return problemas
}

/** O corpo da chamada ao banco, já no formato dos parâmetros da função. */
export function corpoDoCadastro(codigo, f = {}) {
  const digitado = `${f.ddd ?? ''}${f.numero ?? ''}`
  return {
    p_codigo: codigo,
    p_nome: nomeLimpo(f.nome),
    p_whatsapp: whatsappCanonico(digitado, f.pais) || digitado,
    p_instagram: String(f.instagram ?? '').trim() || null,
    p_interesse: f.interesse || null,
  }
}

/**
 * A resposta do banco, virada no recado que aparece embaixo do formulário.
 * `tom`: 'ok' (verde), 'aviso' (âmbar — não é erro: nada se perdeu) ou 'erro'.
 *
 * ⚠️ A DUPLICATA É AVISO, NÃO ERRO: ela já está na sessão, pelo QR ou pela
 * equipe, e nada foi duplicado. Vermelho ali faria a equipe tentar de novo.
 */
export function recadoDoCadastro(r) {
  if (r?.ok) {
    return r.ja_na_base
      ? { tom: 'ok', texto: `Cadastrada. Ela já estava na base como ${r.nome} — a ficha é a mesma, `
          + 'e agora ela conta nesta sessão.' }
      : { tom: 'ok', texto: `Cadastrada: ${r.nome}. Ela já entra na lista desta sessão, na base de `
          + 'clientes e no Private Appointment da loja.' }
  }
  switch (r?.situacao) {
    case 'ja_estava':
      return { tom: 'aviso', texto: `${r.nome || 'Ela'} já se identificou nesta sessão `
        + `${r.porta === 'equipe' ? 'pela equipe' : 'pelo QR'}. Nada foi duplicado.` }
    case 'sessao_arquivada':
      return { tom: 'erro', texto: 'Esta sessão está arquivada e não recebe lead nova. Desarquive para cadastrar.' }
    case 'nao_achei':
      return { tom: 'erro', texto: 'Não achei mais esta sessão — ela pode ter sido apagada. Recarregue a página.' }
    case 'sem_permissao':
      return { tom: 'erro', texto: 'Você não tem a permissão de Atendimentos para cadastrar leads.' }
    case 'sem_nome':
      return { tom: 'erro', texto: 'Escreva o nome dela.' }
    case 'whatsapp_invalido':
      return { tom: 'erro', texto: 'O banco não aceitou este WhatsApp. Confira o DDD e o número.' }
    case 'instagram_longo':
      return { tom: 'erro', texto: 'O Instagram ficou longo demais. Use só o @ ou o endereço.' }
    case 'interesse_invalido':
      return { tom: 'erro', texto: 'Escolha o que ela gostaria agora numa das opções.' }
    case 'erro_de_rede':
      return { tom: 'erro', texto: 'Não consegui falar com o banco agora. Os campos continuam aí — tente de novo.' }
    default:
      return { tom: 'erro', texto: `Não consegui cadastrar agora${r?.situacao ? ` (${r.situacao})` : ''}. `
        + 'Os campos continuam aí — tente de novo.' }
  }
}

/** O selo "por onde entrou" de cada lead da lista. */
export function portaDaLead(lead = {}) {
  if (lead.porta === 'equipe') {
    return { texto: lead.cadastrado_por_nome ? `Equipe · ${lead.cadastrado_por_nome}` : 'Equipe', tom: 'andamento' }
  }
  return { texto: 'QR', tom: 'viva' }
}

/**
 * "12 · 8 pelo QR · 4 pela equipe" — a linha embaixo de "Se identificaram".
 *
 * ⚠️ VAZIO QUANDO O BANCO AINDA NÃO MANDA AS DUAS PORTAS (a migration de
 * 24/09 ainda não aplicada): inventar "0 pela equipe" seria a tela afirmando
 * uma coisa que ela não sabe.
 */
export function portasEscritas(linha = {}) {
  if (linha.pessoas_qr === undefined || linha.pessoas_equipe === undefined) return ''
  return `${Number(linha.pessoas_qr) || 0} pelo QR · ${Number(linha.pessoas_equipe) || 0} pela equipe`
}
