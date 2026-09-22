// LOJA QUE FECHOU SAI DO MENU DAQUI PRA FRENTE — E CONTINUA NO PASSADO.
//
// Pedido do dono, 09/09/2026: "oculte os canais de vendas, dom pedro pq
// fecharam, deixe somente o histórico pra trás". A Loja Dom Pedro fechou; o
// corte combinado com ele é 31/08/2026, guardado em `bling_lojas.fechado_em`.
//
// ⚠️ NÃO É LISTA ESCRITA À MÃO, E ISSO É DE PROPÓSITO. A data mora no cadastro e
// se edita na Config de Admin › Canais de venda. A próxima loja que fechar é
// digitação na tela, não código novo — [[feedback_lista_a_mao_envelhece]].
//
// ── A CONTA É SOBRE A DATA INICIAL DO PERÍODO ──────────────────────────────
//
// Se a janela escolhida COMEÇA depois do fechamento, não há venda possível ali:
// o canal só poluiria o menu com R$ 0,00. Se ela começa antes, houve loja aberta
// dentro da janela — e o número tem de aparecer, com o nome certo, senão o
// histórico deixa de ser comparável mês a mês.
//
// ── ⚠️ POR QUE ISTO NÃO APAGA O NOME ───────────────────────────────────────
//
// As duas telas de venda montam o menu com a UNIÃO de dois conjuntos: os canais
// do cadastro (`bling_lojas`) e os que tiveram pedido no período. Tirar a linha
// do cadastro NÃO esconde o canal — esconde só o NOME dele, e o Dom Pedro
// voltaria à tela como "Canal #7609". Por isso o que se usa daqui é a lista de
// ids a REMOVER DA EXIBIÇÃO, com o mapa de nomes intacto.

/** Só `YYYY-MM-DD` de verdade. Texto digitado à mão não pode esconder loja. */
function ehDataISO(v) {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false
  const d = new Date(v + 'T12:00:00')
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v
}

/**
 * O canal aparece no período que começa em `dataInicial` (`YYYY-MM-DD`)?
 *
 * ⚠️ NA DÚVIDA, APARECE. Sem data de fechamento, sem data inicial, ou com data
 * estragada, a resposta é `true`: esconder por falta de dado sumiria com loja
 * viva e o dono veria o faturamento cair sem explicação. Esconder é a exceção, e
 * exceção precisa de prova.
 *
 * A comparação é de texto porque `YYYY-MM-DD` ordena igual como data e como
 * texto — e assim não entra fuso horário nenhum nesta conta.
 */
export function canalApareceNoPeriodo(canal, dataInicial) {
  const fechado = canal && canal.fechado_em
  if (!ehDataISO(fechado)) return true
  if (!ehDataISO(dataInicial)) return true
  return dataInicial <= fechado
}

/**
 * Os ids de canal que devem sair da exibição neste período, como NÚMERO.
 *
 * ⚠️ NÚMERO, e não texto: as telas convertem o id com `parseInt` ao montar o
 * universo de exibição. Um conjunto de textos faria todo `has()` dar falso, o
 * canal continuaria na tela e ninguém entenderia por quê.
 */
export function ocultosNoPeriodo(canais, dataInicial) {
  const fora = new Set()
  for (const canal of Array.isArray(canais) ? canais : []) {
    if (canalApareceNoPeriodo(canal, dataInicial)) continue
    const id = parseInt(canal && canal.loja_id, 10)
    if (!Number.isNaN(id)) fora.add(id)
  }
  return fora
}

/**
 * Os pedidos SEM os das lojas que já estavam fechadas no período.
 *
 * ⚠️ ESTA É A PARTE QUE FALTAVA, E O BURACO DUROU DE 09/09 A 22/09/2026.
 * `ocultosNoPeriodo` tirava a loja fechada da LISTA e do MENU, e mais nada. O
 * total no alto da tela continuava somando os pedidos dela, porque ele nasce de
 * `pedidos.reduce(...)` e ninguém tinha filtrado `pedidos`.
 *
 * O resultado na tela do dono, em 22/09/2026: as barras do "Venda por canal"
 * somavam R$ 28.056 e o número em cima delas dizia R$ 28.997. A diferença de
 * R$ 941 era a Loja Dom Pedro inteira — inclusive um pedido de teste de R$ 1,01
 * com nota fiscal autorizada de verdade. Ele olhou a lista, não viu a loja e
 * comemorou; o dinheiro estava lá.
 *
 * ⚠️ POR ISSO O FILTRO MORA AQUI E É APLICADO UMA VEZ SÓ, NA LISTA DE PEDIDOS,
 * antes de qualquer conta. Filtrar no desenho de cada bloco é o que produziu o
 * defeito: são oito somas diferentes (total, projeção, ticket, desvio da meta,
 * ranking por canal, ranking por vendedor, gráfico do dia, comparativo), e
 * lembrar de filtrar nas oito é exatamente o tipo de coisa que ninguém lembra.
 *
 * O período ANTERIOR usa a data inicial DELE, não a desta janela: agosto tem de
 * continuar com a Loja Dom Pedro dentro, senão o "vs. mês passado" apagaria o
 * histórico que o dono pediu para manter.
 *
 * @param pedidos lista do Bling; cada item tem `loja.id`
 * @param canais  linhas de `bling_lojas` (precisa de `loja_id` e `fechado_em`)
 * @param dataInicial `YYYY-MM-DD`, o começo do período na tela
 */
export function semAsLojasFechadas(pedidos, canais, dataInicial) {
  const lista = Array.isArray(pedidos) ? pedidos : []
  const fora = ocultosNoPeriodo(canais, dataInicial)
  if (!fora.size) return lista
  // ⚠️ Pedido SEM loja (`loja` ausente, ou id que não vira número) FICA. Sumir
  // com venda por falta de cadastro seria esconder dinheiro de verdade por causa
  // de um dado faltando — o mesmo lado seguro de `canalApareceNoPeriodo`.
  return lista.filter((p) => {
    const id = parseInt(p && p.loja && p.loja.id, 10)
    return Number.isNaN(id) ? true : !fora.has(id)
  })
}

/**
 * A data como o dono digita na Config de Admin → `YYYY-MM-DD`.
 * Aceita `31/08/2026`, `31/8/2026` e `2026-08-31`. Vazio devolve `null`, que é
 * REABRIR a loja — e é explícito de propósito.
 *
 * ⚠️ TEXTO QUE NÃO É DATA É RECUSADO, NUNCA VIRA NULO. Cair no nulo seria
 * reabrir uma loja fechada porque alguém errou a digitação, e a tela diria
 * "salvo" com a cara de quem acertou.
 *
 * ⚠️ E O MÊS É CONFERIDO DE VOLTA: `new Date(2026, 1, 31)` rola para 3 de março
 * sem reclamar. Sem a volta, "31/02/2026" seria guardado como outra data.
 */
export function dataDigitadaParaISO(texto) {
  const t = String(texto ?? '').trim()
  if (!t) return { ok: true, iso: null }
  const recusa = { ok: false, mensagem: 'Não entendi a data. Escreva como 31/08/2026.' }

  let ano, mes, dia
  const br = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  const iso = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)
  if (br) { dia = +br[1]; mes = +br[2]; ano = +br[3] }
  else if (iso) { ano = +iso[1]; mes = +iso[2]; dia = +iso[3] }
  else return recusa

  if (mes < 1 || mes > 12 || dia < 1 || dia > 31) return recusa
  const d = new Date(ano, mes - 1, dia)
  if (d.getFullYear() !== ano || d.getMonth() !== mes - 1 || d.getDate() !== dia) return recusa

  const pad = (n) => String(n).padStart(2, '0')
  return { ok: true, iso: `${ano}-${pad(mes)}-${pad(dia)}` }
}

/** `2026-08-31` → `31/08/2026`. Só data de verdade; o resto vira texto vazio. */
export function dataISOparaBR(iso) {
  if (!ehDataISO(iso)) return ''
  const [a, m, d] = iso.split('-')
  return `${d}/${m}/${a}`
}
