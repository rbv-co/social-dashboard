// A JANELA DE NOVOS SEGUIDORES DO PERÍODO PERSONALIZADO.
//
// ⚠️ O PAINEL PROFISSIONAL DO INSTAGRAM ROTULA CADA DIA UM DIA À FRENTE DA API.
// Medido contra a API real em 09/09/2026, na conta da Vessel: o painel mostrava
// 951 seguiram e 31 saíram para "5 a 8 de setembro", e a soma dos dias 04+05+06+07
// da API dá exatamente 951 e 31 — os DOIS números. O "5 de setembro" do painel é
// o dia 4 da API.
//
// ⚠️ NÃO É O DIA 8 FALTANDO. Foi a minha primeira hipótese e ela está errada: a
// contagem total foi de 15.877 (dia 7) para 16.320 (dia 8), ou seja o dia 8
// rendeu ~443 líquidos. Se ele fosse os 44/7 que faltam para 951, a contagem
// teria subido 37. O dia 8 simplesmente não está no número do painel.
//
// ⚠️ SÓ O PERSONALIZADO DESLOCA, e isso é decisão do dono (09/09/2026). Os
// rolantes (7D/14D/30D) e o mês corrente já foram conferidos contra o painel e
// batem SEM deslocamento — estão congelados em `_TRAVA_JANELAS`, na tela. O mês
// passado já desloca há mais tempo, pelo mesmo motivo. Mexer nos que funcionam
// para consertar um que não funciona é trocar um defeito conhecido por três.

/** `2026-09-05` e nada mais. Data digitada ou vinda torta não desloca nada. */
function ehDataISO(v) {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false
  const d = new Date(v + 'T12:00:00')
  return !Number.isNaN(d.getTime()) && paraISO(d) === v
}

/** ⚠️ MEIO-DIA, NUNCA MEIA-NOITE: `new Date('2026-09-05')` é 00:00 UTC, que no
 *  Brasil ainda é dia 4 — a conta erraria mais um dia, calada. */
function paraISO(d) {
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

function menosUmDia(iso) {
  const d = new Date(iso + 'T12:00:00')
  d.setDate(d.getDate() - 1)
  return paraISO(d)
}

/**
 * O recorte de dias que faz o card bater com o painel profissional.
 * Devolve `{ inicio, fim }` deslocados um dia para trás, ou `null` quando as
 * datas não são as duas válidas — e aí quem chama mantém o comportamento antigo,
 * em vez de somar uma janela inventada.
 */
export function janelaDoPersonalizado(inicio, fim) {
  if (!ehDataISO(inicio) || !ehDataISO(fim)) return null
  return { inicio: menosUmDia(inicio), fim: menosUmDia(fim) }
}

/**
 * O gráfico deve tratar este recorte como ROLANTE (Hoje/1D/3D/7D/14D/30D)?
 *
 * ⚠️ O RECORTE PERSONALIZADO NUNCA É ROLANTE, mesmo com `period` numérico. Ao
 * escolher datas na tela, `period` CONTINUA com o valor antigo (7, 30…) — e o
 * gráfico decidia o ramo só por ele. O ramo rolante cola "ontem" e "hoje" no fim
 * da série, então um período de 5 a 8 de setembro ganhava barras dos dias 8 e 9.
 *
 * Defeito visto pelo dono em 09/09/2026: filtrando 5 a 8, a barra do dia 8
 * apareceu DUAS VEZES — uma como dia da série, outra como "ontem". Antes disso o
 * mesmo defeito já mostrava um dia 9 que ninguém tinha pedido, e passou batido.
 */
export function ehRecorteRolante(period, inicio, fim) {
  if (inicio && fim) return false
  return [0, 1, 3, 7, 14, 30].includes(period)
}
