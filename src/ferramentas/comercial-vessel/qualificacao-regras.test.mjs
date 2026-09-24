import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  CRITERIOS, NIVEIS, OBSERVACAO_MAXIMA, AVISO_DE_PONTUACAO, pontosDoCriterio, notaDaAvaliacao, criteriosFaltando,
  faixaDaNota, notaEscrita, seloDaFaixa, posicaoDaFaixa, comFaixa, historicoEscrito, valeReavaliar, niveisDe,
  mensagemDeAvaliar, sugestaoDeMobilizacao, sugestaoDeConfiabilidade, sugestaoDeCarteira, sugestoesDaAvaliacao,
  professionalFeeEstimado, AVISO_DO_FEE, metaDoComparecimento, metaDeVendasPorEncontro, vendasPorEncontroEscrito,
} from './qualificacao-regras.js'
import { taxasDoPlacar } from './t11-regras.js'
import { proporcao, razao } from './estatistica.js'

// ⚠️ A CONTA DA TELA TEM DE SER A CONTA DO BANCO. Lida do próprio arquivo da
// migration: redigitar os pesos aqui seria uma terceira cópia.
const MIGRATION = readFileSync(new URL(
  '../../../db/migrations/2026-09-24-vessel-stylist-scorecard-e-qualificacao.sql', import.meta.url), 'utf8')

/* ⚠️ AS AMOSTRAS TÊM A FORMA DA RESPOSTA DO BANCO (`vessel_scorecard_da_
 * stylist` = as chaves do placar menos `por_stylist`, mais as de uma pessoa),
 * nem um campo a mais — amostra com campo inventado é teste de uma realidade
 * que não existe (memória "teste com a forma real da resposta"). */
const SCORECARD = (o = {}) => ({
  ok: true, situacao: 'ok', codigo: 'STY-0001', nome: 'Marina', ativada_em: '2026-07-15T13:00:00Z',
  de: null, ate: null, janela_de_venda_em_dias: 14, prospectadas: 1, ativadas: 1, prospectadas_ja_ativadas: 1,
  encontros_agendados: 3, encontros_realizados: 2, encontros_cancelados: 0, convidadas: 10, confirmadas: 8,
  confirmadas_em_realizados: 7, presentes: 5, presentes_em_realizados: 5, recorrentes_no_periodo: 1,
  recorrentes_ate_o_fim: 1, ativadas_ate_o_fim: 1, intervalos: 1, intervalo_medio_em_dias: 28,
  contatos_ate_ativar: 3, stylists_com_contatos_ate_ativar: 1, compradoras: 2, vendas: 2, pecas: 3, receita: 4740,
  realizados_desde_o_inicio: 2, recorrente: true, ultimo_realizado_em: '2026-09-11', dias_desde_o_ultimo: 12,
  proximo_encontro_em: '2026-09-28T22:00:00Z', proximo_encontro_codigo: 'PE-20260928-CPS-01', contatos: 3,
  contatos_antes_de_ativar: 3, contatos_sem_resposta_depois_de_ativar: 0,
  ...o,
})

test('os pesos da tela são os do documento e os do banco (6·5·4·3·2 = peso ÷ 5)', () => {
  assert.deepEqual(CRITERIOS.map((c) => [c.chave, c.peso]),
    [['carteira', 30], ['portfolio', 25], ['mobilizacao', 20], ['acesso', 15], ['confiabilidade', 10]])
  assert.equal(CRITERIOS.reduce((a, c) => a + c.peso, 0), 100)
  const formula = CRITERIOS.map((c) => `${c.peso / 5} \\* ${c.chave}`).join(' \\+ ')
  const achadas = MIGRATION.match(new RegExp(formula.replace(/ /g, '\\s*'), 'g')) || []
  // Duas vezes: a coluna `nota` e a entrada de `vessel_faixa_da_nota` na coluna `faixa`.
  assert.equal(achadas.length, 2, 'a fórmula da nota no banco não é 6·carteira + 5·portfólio + 4·mobilização + 3·acesso + 2·confiabilidade')
})

test('a faixa da tela é a régua do banco: A ≥ 75, B ≥ 55, C abaixo', () => {
  const i = MIGRATION.indexOf('function public.vessel_faixa_da_nota')
  const corpo = MIGRATION.slice(i, MIGRATION.indexOf('$$;', i))
  assert.match(corpo, /p_nota >= 75 then 'A'/)
  assert.match(corpo, /p_nota >= 55 then 'B'/)
  assert.match(corpo, /else 'C'/)
  for (const [n, f] of [[20, 'C'], [54, 'C'], [55, 'B'], [74, 'B'], [75, 'A'], [100, 'A']]) assert.equal(faixaDaNota(n), f, n)
  assert.equal(faixaDaNota(null), null)
})

test('o limite da observação e o 1..5 são os CHECK do banco', () => {
  assert.match(MIGRATION, new RegExp(`length\\(observacao\\) <= ${OBSERVACAO_MAXIMA}`))
  assert.match(MIGRATION, /length\(v_obs\) > 280/)
  for (const c of CRITERIOS) assert.match(MIGRATION, new RegExp(`${c.chave} between 1 and 5`), c.chave)
  assert.deepEqual(NIVEIS, [1, 2, 3, 4, 5])
})

test('toda âncora existe (1 a 5), é curta, e nenhuma fala de atributo pessoal ou renda', () => {
  for (const c of CRITERIOS) {
    for (const n of NIVEIS) {
      assert.ok(c.ancoras[n] && c.ancoras[n].length <= 70, `${c.chave} ${n}`)
      assert.doesNotMatch(c.ancoras[n], /\b(renda|idade|religi\w*|casad\w*|filh\w*|dinheiro|rica|pobre)\b/i, `${c.chave} ${n}`)
    }
  }
  // As aprovadas pelo dono, letra por letra (1, 3 e 5).
  const c = Object.fromEntries(CRITERIOS.map((x) => [x.chave, x.ancoras]))
  assert.equal(c.carteira[5], 'Carteira grande, clientes com perfil VESSEL e que compram.')
  assert.equal(c.mobilizacao[1], 'Não sabe se consegue reunir pessoas.')
  assert.equal(c.acesso[5], 'Na praça de uma loja, fácil de vir.')
  assert.equal(c.confiabilidade[3], 'Responde, às vezes atrasa.')
  assert.match(AVISO_DE_PONTUACAO, /atributos pessoais sensíveis nem renda presumida/)
})

test('pontos = peso × nível ÷ 5; a nota só existe com os cinco', () => {
  assert.equal(pontosDoCriterio(30, 4), 24)
  assert.equal(pontosDoCriterio(10, 1), 2)
  assert.equal(pontosDoCriterio(25, 0), null)
  assert.equal(pontosDoCriterio(25, 6), null)
  assert.equal(pontosDoCriterio(25, 2.5), null)
  assert.equal(pontosDoCriterio(25, null), null)
  const tudo = { carteira: 5, portfolio: 4, mobilizacao: 4, acesso: 3, confiabilidade: 5 }
  assert.equal(notaDaAvaliacao(tudo), 85)
  assert.equal(notaEscrita(tudo), '85 · Faixa A')
  assert.equal(notaDaAvaliacao({ ...tudo, acesso: null }), null)
  assert.equal(criteriosFaltando({ ...tudo, acesso: null }), 1)
  assert.equal(notaEscrita({ ...tudo, acesso: null }), 'Falta 1 critério')
  assert.equal(notaEscrita({}), 'Faltam 5 critérios')
  // As bordas que o aplicador prova no banco, com as mesmas combinações.
  const nota = (a) => notaDaAvaliacao(Object.fromEntries(CRITERIOS.map((c, i) => [c.chave, a[i]])))
  assert.equal(nota([1, 1, 5, 5, 4]), 54)
  assert.equal(nota([1, 2, 4, 5, 4]), 55)
  assert.equal(nota([1, 5, 5, 5, 4]), 74)
  assert.equal(nota([2, 4, 5, 5, 4]), 75)
  assert.equal(nota([1, 1, 1, 1, 1]), 20)
})

test('selo da faixa: sempre com a palavra, e "Sem nota" também é selo', () => {
  assert.deepEqual(seloDaFaixa({ faixa: 'A', nota: 82 }), { texto: 'Faixa A · 82', tom: 'viva', faixa: 'A' })
  assert.equal(seloDaFaixa({ faixa: 'B', nota: 60 }).tom, 'andamento')
  assert.equal(seloDaFaixa({ faixa: 'C', nota: 50 }).tom, 'queda')
  assert.deepEqual(seloDaFaixa(null), { texto: 'Sem nota', tom: 'parada', faixa: null })
  assert.deepEqual(seloDaFaixa({ faixa: null }), { texto: 'Sem nota', tom: 'parada', faixa: null })
})

test('ordenar por faixa: A, B, C e por último quem não tem nota', () => {
  const l = ['C', null, 'A', 'B'].map((f) => ({ faixa: f })).sort((a, b) => posicaoDaFaixa(a.faixa) - posicaoDaFaixa(b.faixa))
  assert.deepEqual(l.map((x) => x.faixa), ['A', 'B', 'C', null])
})

test('comFaixa junta a vigente pelo código; quem não está nas vigentes fica sem nota', () => {
  // A forma real de `vessel_qualificacoes_vigentes`: codigo, nota, faixa, avaliado_em.
  const vig = [{ codigo: 'STY-0001', nota: 78, faixa: 'A', avaliado_em: '2026-08-24T12:00:00Z' }]
  const l = comFaixa([{ codigo: 'STY-0001', nome: 'M' }, { codigo: 'STY-0002', nome: 'P' }], vig)
  assert.deepEqual(l.map((s) => [s.codigo, s.faixa, s.nota]), [['STY-0001', 'A', 78], ['STY-0002', null, null]])
  assert.deepEqual(comFaixa(null, vig), [])
})

test('histórico: "B em 25/09 → A em 20/10", da mais antiga para a mais nova', () => {
  // A lista do banco vem da MAIS NOVA para a mais antiga.
  const lista = [{ faixa: 'A', avaliado_em: '2026-10-20T15:00:00' }, { faixa: 'B', avaliado_em: '2026-09-25T15:00:00' }]
  assert.equal(historicoEscrito(lista), 'B em 25/09 → A em 20/10')
  assert.equal(historicoEscrito([]), '')
})

test('vale reavaliar: só com encontro realizado em dia DEPOIS da última avaliação', () => {
  const vig = { avaliado_em: '2026-08-24T15:00:00' }
  assert.equal(valeReavaliar(vig, '2026-09-11'), true)
  assert.equal(valeReavaliar(vig, '2026-08-24'), false, 'no mesmo dia não avisa')
  assert.equal(valeReavaliar(vig, '2026-08-10'), false)
  assert.equal(valeReavaliar(vig, null), false)
  assert.equal(valeReavaliar(null, '2026-09-11'), false, 'sem nota o aviso é outro')
})

test('niveisDe começa a reavaliação de onde a última parou; mensagens de recusa', () => {
  assert.deepEqual(niveisDe({ carteira: 4, portfolio: 4, mobilizacao: 3, acesso: 4, confiabilidade: 5, nota: 78 }),
    { carteira: 4, portfolio: 4, mobilizacao: 3, acesso: 4, confiabilidade: 5 })
  assert.deepEqual(niveisDe(null), { carteira: null, portfolio: null, mobilizacao: null, acesso: null, confiabilidade: null })
  assert.match(mensagemDeAvaliar('sem_permissao'), /permissão/)
  assert.match(mensagemDeAvaliar('nivel_invalido'), /1 a 5/)
  assert.match(mensagemDeAvaliar('observacao_longa'), /280/)
  assert.match(mensagemDeAvaliar('qualquer'), /Tente de novo/)
  // Cada `situacao` que a função do banco devolve tem a sua frase.
  const i = MIGRATION.indexOf('function public.vessel_stylist_avaliar')
  const corpo = MIGRATION.slice(i, MIGRATION.indexOf('$function$;', i))
  const doBanco = [...new Set([...corpo.matchAll(/'situacao', '([a-z_]+)'/g)].map((m) => m[1]))]
  assert.ok(doBanco.length >= 5)
  for (const s of doBanco) if (s !== 'ok') assert.doesNotMatch(mensagemDeAvaliar(s), /Tente de novo/, s)
})

// ── as réguas das sugestões ────────────────────────────────────────────────

test('sugestão: nenhuma antes do primeiro encontro realizado', () => {
  const sc = SCORECARD({ encontros_realizados: 0, presentes: 0, presentes_em_realizados: 0 })
  assert.deepEqual(sugestoesDaAvaliacao(sc),
    { carteira: null, portfolio: null, mobilizacao: null, acesso: null, confiabilidade: null })
  assert.deepEqual(sugestoesDaAvaliacao(null),
    { carteira: null, portfolio: null, mobilizacao: null, acesso: null, confiabilidade: null })
})

test('régua da MOBILIZAÇÃO: média de presentes por encontro realizado contra a capacidade 7–10', () => {
  const m = (presentes, encontros) => sugestaoDeMobilizacao(SCORECARD({ presentes_em_realizados: presentes, encontros_realizados: encontros })).nivel
  assert.equal(m(14, 2), 5) // 7
  assert.equal(m(13, 2), 4) // 6,5
  assert.equal(m(10, 2), 4) // 5
  assert.equal(m(7, 2), 3) // 3,5
  assert.equal(m(6, 2), 2) // 3
  assert.equal(m(4, 2), 2) // 2
  assert.equal(m(3, 2), 1) // 1,5
  assert.equal(m(0, 1), 1)
  assert.equal(sugestaoDeMobilizacao(SCORECARD()).porque,
    'média de 2,5 presentes por encontro (5 em 2 realizados); a capacidade planejada é de 7 a 10')
})

test('régua da CONFIABILIDADE: 2 por encontro que caiu + 1 por sem resposta depois de ativar', () => {
  const c = (quedas, semResp) => sugestaoDeConfiabilidade(SCORECARD({ encontros_cancelados: quedas,
    contatos_sem_resposta_depois_de_ativar: semResp })).nivel
  assert.equal(c(0, 0), 5)
  assert.equal(c(0, 1), 4)
  assert.equal(c(1, 0), 3)
  assert.equal(c(1, 1), 2)
  assert.equal(c(0, 3), 2)
  assert.equal(c(2, 0), 1)
  assert.equal(c(1, 2), 1)
  assert.equal(sugestaoDeConfiabilidade(SCORECARD()).porque,
    'nenhum encontro cancelado e nenhum contato sem resposta depois de ativar')
  assert.equal(sugestaoDeConfiabilidade(SCORECARD({ encontros_cancelados: 1, contatos_sem_resposta_depois_de_ativar: 1 })).porque,
    '1 encontro cancelado ou não realizado e 1 contato sem resposta depois de ativar')
  // Antes de ativar não há o campo (nulo): conta zero, não quebra.
  assert.equal(sugestaoDeConfiabilidade(SCORECARD({ contatos_sem_resposta_depois_de_ativar: null })).nivel, 5)
})

test('régua da CARTEIRA: conversão das presentes e receita por presente', () => {
  const k = (compradoras, presentes, receita) => sugestaoDeCarteira(SCORECARD({ compradoras, presentes, receita })).nivel
  assert.equal(k(2, 5, 5000), 5) // 40% e R$ 1.000
  assert.equal(k(2, 5, 4740), 4) // 40%, R$ 948
  assert.equal(k(3, 10, 2000), 4) // 30%
  assert.equal(k(1, 10, 10000), 4) // 10%, mas R$ 1.000 por presente
  assert.equal(k(2, 10, 2000), 3) // 20%
  assert.equal(k(1, 10, 800), 2) // 10%
  assert.equal(k(0, 6, 0), 1)
  assert.equal(sugestaoDeCarteira(SCORECARD({ presentes: 0, compradoras: 0 })), null, 'sem presente, nada a medir')
  assert.equal(sugestaoDeCarteira(SCORECARD()).porque.replace(/\s/g, ' '), '2 de 5 presentes compraram (40%) e R$ 948 por presente')
})

test('sugestões de uma stylist de verdade (a Marina da demonstração): 4 · 2 · 5', () => {
  const s = sugestoesDaAvaliacao(SCORECARD())
  assert.equal(s.carteira.nivel, 4)
  assert.equal(s.mobilizacao.nivel, 2)
  assert.equal(s.confiabilidade.nivel, 5)
  assert.equal(s.portfolio, null)
  assert.equal(s.acesso, null)
})

// ── o fee e as metas ──────────────────────────────────────────────────────

test('Professional Fee: 10% da receita atribuída, e sempre como estimativa', () => {
  assert.equal(professionalFeeEstimado(4740), 474)
  assert.equal(professionalFeeEstimado(null), 0)
  assert.match(AVISO_DO_FEE, /o financeiro confirma, descontando devoluções e cancelamentos/)
})

test('meta do comparecimento: verde ≥ 70, âmbar 60–69, vermelho < 60, pelo número que a tela mostra', () => {
  const m = (x, n) => metaDoComparecimento(proporcao(x, n))
  assert.equal(m(7, 10).estado, 'dentro')
  assert.equal(m(7, 10).tom, 'viva')
  assert.equal(m(139, 200).estado, 'dentro', '69,5% aparece como 70%: a cor segue o número escrito')
  assert.equal(m(69, 100).estado, 'perto')
  assert.equal(m(6, 10).estado, 'perto')
  assert.equal(m(6, 10).tom, 'queda')
  assert.equal(m(59, 100).estado, 'abaixo')
  assert.equal(m(1, 3).tom, 'faltou')
  assert.deepEqual(m(0, 0), { estado: 'sem_base', tom: null, texto: 'sem base ainda', meta: 'meta: 70% ou mais' })
  // Nunca só cor: o texto diz dentro/abaixo.
  assert.match(m(7, 10).texto, /dentro/)
  assert.match(m(6, 10).texto, /abaixo/)
  assert.match(m(5, 10).texto, /abaixo/)
})

test('faixa de vendas por encontro: verde 1–3, âmbar acima de 3 (só aviso), vermelho abaixo de 1', () => {
  const v = (vendas, encontros) => metaDeVendasPorEncontro(taxasDoPlacar({ vendas, encontros_realizados: encontros }).vendasPorEncontro)
  assert.equal(v(2, 2).estado, 'dentro')
  assert.equal(v(3, 1).estado, 'dentro')
  assert.equal(v(1, 1).estado, 'dentro')
  assert.equal(v(4, 1).estado, 'acima')
  assert.equal(v(4, 1).tom, 'queda')
  assert.match(v(4, 1).texto, /só aviso/)
  assert.equal(v(1, 2).estado, 'abaixo')
  assert.equal(v(0, 3).tom, 'faltou')
  assert.equal(v(19, 20).estado, 'dentro', '0,95 aparece como "1,0": a cor segue o número escrito')
  assert.deepEqual(v(3, 0), { estado: 'sem_base', tom: null, texto: 'sem base ainda', meta: 'faixa de teste: 1 a 3' })
  assert.equal(vendasPorEncontroEscrito(razao(3, 2)), '1,5')
  assert.equal(vendasPorEncontroEscrito(razao(3, 0)), '—')
})

test('taxasDoPlacar ganhou vendas por encontro (vendas ÷ realizados), razão sem teto', () => {
  const t = taxasDoPlacar({ vendas: 5, encontros_realizados: 2 })
  assert.equal(t.vendasPorEncontro.valor, 2.5)
  assert.equal(t.vendasPorEncontro.n, 2)
  assert.equal(taxasDoPlacar({}).vendasPorEncontro.temBase, false)
})
