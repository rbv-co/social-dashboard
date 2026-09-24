/* AS REGRAS DO SCORECARD E DA NOTA DE QUALIFICAÇÃO DA STYLIST (24/09/2026).
 *
 * Três peças, decididas pelo dono:
 *   1. o SCORECARD de cada stylist — os números saem do banco
 *      (`vessel_scorecard_da_stylist`, a MESMA conta do placar) e as taxas de
 *      `taxasDoPlacar` (t11-regras.js). Daqui sai só o que é de uma pessoa:
 *      o Professional Fee estimado e as frases;
 *   2. a NOTA DE QUALIFICAÇÃO 0–100 com faixa A/B/C. Uma pessoa avalia; o
 *      sistema só SUGERE nível em três critérios, e nunca muda nada sozinho —
 *      a mesma regra do "sugerir etapa" do CRM;
 *   3. as METAS do plano, fixas, que pintam o placar e o scorecard.
 *
 * ⚠️ FONTES:
 *   · critérios, pesos e faixas: `materiais/06_Stylist_Circle_Proposta_e_
 *     Onboarding.txt`, "Qualificação do stylist";
 *   · metas: `materiais/07_Private_Edit_Preview_e_Stylist_Day.txt` — "Metas
 *     iniciais de teste: show rate >=70%; acompanhar 1-3 vendas por edição
 *     como faixa de teste, sem tratar como previsão garantida";
 *   · Professional Fee: o mesmo 06, "Fee: 10%" sobre venda líquida.
 *
 * ⚠️ A CONTA DA NOTA E A FAIXA MORAM TAMBÉM NO BANCO
 * (`db/migrations/2026-09-24-vessel-stylist-scorecard-e-qualificacao.sql`,
 * colunas geradas de `vessel_stylist_qualificacoes` e `vessel_faixa_da_nota`).
 * O teste lê a migration: se um lado mudar sozinho, a suíte reprova. A tela
 * mostra a nota AO VIVO com a conta daqui; o que fica gravado é a do banco.
 *
 * ⚠️ E MORAM FORA DO `.vue` PELO MOTIVO DE SEMPRE: `.vue` não roda na suíte.
 */

// ── os cinco critérios ──────────────────────────────────────────────────────

/**
 * A ordem é a do documento. As âncoras 1, 3 e 5 foram aprovadas pelo dono
 * (24/09); a 2 e a 4 são o meio do caminho entre as vizinhas, curtas.
 * ⚠️ NENHUMA ÂNCORA FALA DE ATRIBUTO PESSOAL OU DE RENDA: o documento proíbe
 * pontuar isso, e a tela escreve a proibição em cima dos botões.
 */
export const CRITERIOS = [
  {
    chave: 'carteira', peso: 30, rotulo: 'Carteira com aderência e demanda real',
    ancoras: {
      1: 'Poucas clientes, fora do perfil.',
      2: 'Carteira pequena, pouca gente no perfil.',
      3: 'Carteira média, parte no perfil.',
      4: 'Carteira boa, a maior parte no perfil.',
      5: 'Carteira grande, clientes com perfil VESSEL e que compram.',
    },
  },
  {
    chave: 'portfolio', peso: 25, rotulo: 'Qualidade do trabalho e portfólio',
    ancoras: {
      1: 'Trabalho sem relação com a marca.',
      2: 'Trabalho correto, estética distante.',
      3: 'Bom trabalho, estética próxima.',
      4: 'Trabalho muito bom, estética quase alinhada.',
      5: 'Trabalho de referência, estética alinhada.',
    },
  },
  {
    chave: 'mobilizacao', peso: 20, rotulo: 'Capacidade de mobilização',
    ancoras: {
      1: 'Não sabe se consegue reunir pessoas.',
      2: 'Reúne poucas, com muito esforço.',
      3: 'Reúne algumas, com esforço.',
      4: 'Reúne um bom grupo, sem muito esforço.',
      5: 'Reúne o grupo com facilidade.',
    },
  },
  {
    chave: 'acesso', peso: 15, rotulo: 'Logística e acesso à praça',
    ancoras: {
      1: 'Longe das lojas, difícil deslocar.',
      2: 'Longe, mas consegue vir às vezes.',
      3: 'Acesso razoável.',
      4: 'Perto, vem sem dificuldade.',
      5: 'Na praça de uma loja, fácil de vir.',
    },
  },
  {
    chave: 'confiabilidade', peso: 10, rotulo: 'Organização e confiabilidade',
    ancoras: {
      1: 'Some, não responde.',
      2: 'Responde pouco, costuma atrasar.',
      3: 'Responde, às vezes atrasa.',
      4: 'Responde bem, raramente atrasa.',
      5: 'Cumpre prazos, confirma tudo.',
    },
  },
]

export const NIVEIS = [1, 2, 3, 4, 5]

/** A frase que a tela escreve em cima dos botões — do documento, sem enfeite. */
export const AVISO_DE_PONTUACAO =
  'Não pontue atributos pessoais sensíveis nem renda presumida. Avalie só o trabalho, a carteira e o combinado.'

/** Limite da observação — o mesmo `CHECK` do banco. */
export const OBSERVACAO_MAXIMA = 280

/** Pontos de um critério: peso × nível ÷ 5 (nível fora de 1..5 não pontua). */
export function pontosDoCriterio(peso, nivel) {
  const n = Number(nivel)
  if (!Number.isInteger(n) || n < 1 || n > 5) return null
  return (Number(peso) * n) / 5
}

/** A nota 0–100, ou `null` enquanto faltar algum critério. */
export function notaDaAvaliacao(niveis) {
  let soma = 0
  for (const c of CRITERIOS) {
    const p = pontosDoCriterio(c.peso, niveis?.[c.chave])
    if (p === null) return null
    soma += p
  }
  return soma
}

/** Quantos critérios ainda faltam escolher. */
export function criteriosFaltando(niveis) {
  return CRITERIOS.filter((c) => pontosDoCriterio(c.peso, niveis?.[c.chave]) === null).length
}

/** A ≥ 75 · B 55–74 · C < 55 — `vessel_faixa_da_nota` no banco. */
export function faixaDaNota(nota) {
  if (nota === null || nota === undefined || Number.isNaN(Number(nota))) return null
  const n = Number(nota)
  if (n >= 75) return 'A'
  if (n >= 55) return 'B'
  return 'C'
}

/** "82 · Faixa A" — a nota ao vivo; sem todos os critérios, o que falta. */
export function notaEscrita(niveis) {
  const nota = notaDaAvaliacao(niveis)
  if (nota === null) {
    const f = criteriosFaltando(niveis)
    return f === 1 ? 'Falta 1 critério' : `Faltam ${f} critérios`
  }
  return `${nota} · Faixa ${faixaDaNota(nota)}`
}

/* O TOM DE CADA FAIXA — os tokens `--situacao-*` da casa, e sempre com a
 * palavra junto (a cor ajuda a achar; "Faixa A" é que diz). */
const TOM_DA_FAIXA = { A: 'viva', B: 'andamento', C: 'queda' }

/** O selo do cartão, da lista e da ficha. Sem nota é um selo também. */
export function seloDaFaixa(vigente) {
  const faixa = vigente?.faixa
  if (!faixa) return { texto: 'Sem nota', tom: 'parada', faixa: null }
  const nota = vigente?.nota
  return { texto: nota === null || nota === undefined ? `Faixa ${faixa}` : `Faixa ${faixa} · ${nota}`, tom: TOM_DA_FAIXA[faixa] || 'parada', faixa }
}

/** A ordem de "ordenar por faixa": A, B, C e por último quem não tem nota. */
export const ORDEM_DAS_FAIXAS = { A: 0, B: 1, C: 2 }
export function posicaoDaFaixa(faixa) {
  return faixa in ORDEM_DAS_FAIXAS ? ORDEM_DAS_FAIXAS[faixa] : 3
}

/** Junta a nota vigente (`vessel_qualificacoes_vigentes`) em cada stylist. */
export function comFaixa(stylists, vigentes) {
  const mapa = new Map((Array.isArray(vigentes) ? vigentes : []).map((v) => [v.codigo, v]))
  return (Array.isArray(stylists) ? stylists : []).map((s) => {
    const v = mapa.get(s.codigo)
    return { ...s, faixa: v?.faixa ?? null, nota: v?.nota ?? null, avaliada_em: v?.avaliado_em ?? null }
  })
}

// ── o histórico ─────────────────────────────────────────────────────────────

const ddmm = (iso) => {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`
}

/**
 * "B em 25/09 → A em 20/10", da MAIS ANTIGA para a mais nova — é assim que se
 * lê uma história. A lista do banco vem da mais nova para a mais antiga.
 */
export function historicoEscrito(lista) {
  const l = Array.isArray(lista) ? [...lista].reverse() : []
  return l.map((q) => `${q.faixa} em ${ddmm(q.avaliado_em)}`).join(' → ')
}

/**
 * "Encontro realizado — vale reavaliar": houve encontro realizado com data
 * DEPOIS do dia da última avaliação. ⚠️ No MESMO dia não avisa: quem avaliou
 * à noite já sabia do encontro da tarde. Sem avaliação nenhuma o aviso é
 * outro ("Sem nota"), e este não aparece.
 */
export function valeReavaliar(vigente, ultimoRealizadoEm) {
  if (!vigente?.avaliado_em || !ultimoRealizadoEm) return false
  const d = new Date(vigente.avaliado_em)
  if (Number.isNaN(d.getTime())) return false
  const diaDaAvaliacao = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  return String(ultimoRealizadoEm).slice(0, 10) > diaDaAvaliacao
}

/** Os níveis de uma avaliação do banco, para começar a reavaliação de onde parou. */
export function niveisDe(q) {
  return Object.fromEntries(CRITERIOS.map((c) => [c.chave, q?.[c.chave] ?? null]))
}

export function mensagemDeAvaliar(situacao) {
  switch (situacao) {
    case 'ok': return ''
    case 'sem_permissao': return 'Você não tem a permissão de editar o Stylist Circle para avaliar.'
    case 'nao_achei': return 'Não achei mais esta parceira. Recarregue a página.'
    case 'nivel_invalido': return 'Escolha um nível de 1 a 5 em cada um dos cinco critérios.'
    case 'observacao_longa': return `A observação passou de ${OBSERVACAO_MAXIMA} caracteres.`
    default: return 'Não consegui gravar a avaliação agora. Tente de novo em um instante.'
  }
}

// ── as sugestões com dado ───────────────────────────────────────────────────
//
// ⚠️ SUGESTÃO, NUNCA DECISÃO. A tela mostra "Sugestão: nível N — porque …" e
// um toque aplica; quem salva é a pessoa. Só depois de ≥ 1 encontro realizado,
// e sempre com os números do scorecard DESDE O INÍCIO (não do período que
// estiver escolhido na ficha). Portfólio e Acesso à praça não têm sugestão:
// são olhar de gente.
//
// AS TRÊS RÉGUAS (escritas aqui para o dono ler e mudar de propósito):
//
//   MOBILIZAÇÃO — média de presentes por encontro realizado, contra a
//   capacidade planejada de 7 a 10 (decisão 4 do dono, T11):
//     5: 7 ou mais (enche a capacidade)      4: de 5 a menos de 7
//     3: de 3,5 a menos de 5 (meia casa)     2: de 2 a menos de 3,5
//     1: menos de 2
//
//   CONFIABILIDADE — pontos de falha = 2 por encontro dela cancelado ou não
//   realizado + 1 por contato registrado "sem resposta" DEPOIS de ela ativar
//   (antes disso é prospecção, não compromisso):
//     5: nenhuma falha   4: 1 ponto   3: 2 pontos   2: 3 pontos   1: 4 ou mais
//
//   CARTEIRA — conversão das presentes (compradoras ÷ presentes) e receita
//   por presente:
//     5: conversão de 40% ou mais E R$ 1.000 ou mais por presente
//     4: conversão de 30% ou mais, OU R$ 1.000 ou mais por presente
//     3: conversão de 15% ou mais
//     2: alguém comprou (conversão acima de zero)
//     1: nenhuma presente comprou
//   (Sem nenhuma presente, não há o que medir: sem sugestão.)

export const REGUA_DA_MOBILIZACAO = [[7, 5], [5, 4], [3.5, 3], [2, 2], [0, 1]]
export const REGUA_DA_CONFIABILIDADE = [[0, 5], [1, 4], [2, 3], [3, 2]]
export const REGUA_DA_CARTEIRA = { conversaoDo5: 0.4, receitaDo5: 1000, conversaoDo4: 0.3, receitaDo4: 1000, conversaoDo3: 0.15 }

const umaCasa = (v) => Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
const reais = (v) => Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })
const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`

export function sugestaoDeMobilizacao(sc) {
  const encontros = Number(sc?.encontros_realizados) || 0
  if (encontros < 1) return null
  const presentes = Number(sc?.presentes_em_realizados) || 0
  const media = presentes / encontros
  const nivel = REGUA_DA_MOBILIZACAO.find(([piso]) => media >= piso)[1]
  return {
    nivel,
    porque: `média de ${umaCasa(media)} presentes por encontro (${presentes} em ${plural(encontros, 'realizado', 'realizados')}); a capacidade planejada é de 7 a 10`,
  }
}

export function sugestaoDeConfiabilidade(sc) {
  if ((Number(sc?.encontros_realizados) || 0) < 1) return null
  const quedas = Number(sc?.encontros_cancelados) || 0
  const semResposta = Number(sc?.contatos_sem_resposta_depois_de_ativar) || 0
  const falhas = 2 * quedas + semResposta
  const degrau = REGUA_DA_CONFIABILIDADE.find(([pontos]) => falhas <= pontos)
  const nivel = degrau ? degrau[1] : 1
  const partes = [
    quedas ? plural(quedas, 'encontro cancelado ou não realizado', 'encontros cancelados ou não realizados') : 'nenhum encontro cancelado',
    semResposta ? plural(semResposta, 'contato sem resposta depois de ativar', 'contatos sem resposta depois de ativar') : 'nenhum contato sem resposta depois de ativar',
  ]
  return { nivel, porque: partes.join(' e ') }
}

export function sugestaoDeCarteira(sc) {
  if ((Number(sc?.encontros_realizados) || 0) < 1) return null
  const presentes = Number(sc?.presentes) || 0
  if (presentes < 1) return null
  const compradoras = Number(sc?.compradoras) || 0
  const receita = Number(sc?.receita) || 0
  const conversao = compradoras / presentes
  const porPresente = receita / presentes
  const R = REGUA_DA_CARTEIRA
  let nivel = 1
  if (conversao >= R.conversaoDo5 && porPresente >= R.receitaDo5) nivel = 5
  else if (conversao >= R.conversaoDo4 || porPresente >= R.receitaDo4) nivel = 4
  else if (conversao >= R.conversaoDo3) nivel = 3
  else if (compradoras > 0) nivel = 2
  return {
    nivel,
    porque: `${compradoras} de ${plural(presentes, 'presente comprou', 'presentes compraram')} (${Math.round(conversao * 100)}%) e ${reais(porPresente)} por presente`,
  }
}

/** As três sugestões, por chave do critério. Portfólio e Acesso: sempre nulo. */
export function sugestoesDaAvaliacao(scorecardDesdeOInicio) {
  return {
    carteira: sugestaoDeCarteira(scorecardDesdeOInicio),
    portfolio: null,
    mobilizacao: sugestaoDeMobilizacao(scorecardDesdeOInicio),
    acesso: null,
    confiabilidade: sugestaoDeConfiabilidade(scorecardDesdeOInicio),
  }
}

// ── o Professional Fee ──────────────────────────────────────────────────────

/** 10% da receita atribuída. ⚠️ ESTIMATIVA: o financeiro confirma, descontando
 * devoluções e cancelamentos (o documento: "cancelamentos e devoluções ajustam
 * o fee"). Nunca se escreve sem a palavra "estimado" ao lado. */
export const PROFESSIONAL_FEE = 0.10
export function professionalFeeEstimado(receita) {
  return (Number(receita) || 0) * PROFESSIONAL_FEE
}
export const AVISO_DO_FEE = 'estimativa — o financeiro confirma, descontando devoluções e cancelamentos'

// ── as metas do plano ───────────────────────────────────────────────────────
//
// ⚠️ FIXAS, COMO O PLANO (decisão do dono, 24/09): moram no código com a
// fonte citada no cabeçalho. Mudar a meta é mudar este arquivo, de propósito.
//
// ⚠️ A COR DECIDE PELO NÚMERO QUE A TELA MOSTRA. O comparecimento aparece sem
// casa decimal ("70%") e vendas por encontro com uma ("1,0"): decidir pela
// conta crua pintaria "70%" de âmbar (69,6%) — a tela diria um número e a cor,
// outro.

export const META_DO_COMPARECIMENTO = { verde: 70, ambar: 60, texto: 'meta: 70% ou mais' }
export const FAIXA_DE_VENDAS_POR_ENCONTRO = { de: 1, ate: 3, texto: 'faixa de teste: 1 a 3' }

/** `taxa` é a proporção de `taxasDoPlacar().showRate`; a de vendas é
 * `taxasDoPlacar().vendasPorEncontro` (t11-regras.js). */
export function metaDoComparecimento(taxa) {
  const meta = META_DO_COMPARECIMENTO.texto
  if (!taxa?.temBase) return { estado: 'sem_base', tom: null, texto: 'sem base ainda', meta }
  const pct = Number((taxa.valor * 100).toFixed(0))
  if (pct >= META_DO_COMPARECIMENTO.verde) return { estado: 'dentro', tom: 'viva', texto: 'dentro da meta', meta }
  if (pct >= META_DO_COMPARECIMENTO.ambar) return { estado: 'perto', tom: 'queda', texto: 'um pouco abaixo da meta', meta }
  return { estado: 'abaixo', tom: 'faltou', texto: 'abaixo da meta', meta }
}

export function metaDeVendasPorEncontro(r) {
  const meta = FAIXA_DE_VENDAS_POR_ENCONTRO.texto
  if (!r?.temBase) return { estado: 'sem_base', tom: null, texto: 'sem base ainda', meta }
  // O MESMO arredondamento de `vendasPorEncontroEscrito` (Intl, meia para cima).
  const v = Number(umaCasa(r.valor).replace(/\./g, '').replace(',', '.'))
  if (v < FAIXA_DE_VENDAS_POR_ENCONTRO.de) return { estado: 'abaixo', tom: 'faltou', texto: 'abaixo da faixa de teste', meta }
  if (v > FAIXA_DE_VENDAS_POR_ENCONTRO.ate) return { estado: 'acima', tom: 'queda', texto: 'acima da faixa — só aviso', meta }
  return { estado: 'dentro', tom: 'viva', texto: 'dentro da faixa de teste', meta }
}

/** "1,5" — uma casa, como `razaoEscrita`, sem a base (ela vai embaixo). */
export function vendasPorEncontroEscrito(r) {
  return r?.temBase ? umaCasa(r.valor) : '—'
}
