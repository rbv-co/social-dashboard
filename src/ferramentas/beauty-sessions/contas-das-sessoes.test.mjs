import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  FORMATO, LOJAS, PRACA_DA_LOJA, codigoSugerido, problemasDaSessao,
  enderecoDaMesa, enderecoDoCartao, resumoDaSessao, taxaEscrita, dataLegivel, jaPassou,
} from './contas-das-sessoes.js'

test('codigoSugerido monta o código a partir do que a pessoa escolheu', () => {
  assert.equal(codigoSugerido('2026-09-25', 'iguatemi', 1), 'BS-20260925-CPS-01')
  assert.equal(codigoSugerido('2026-10-16', 'iguatemi', 'AME'), 'BS-20261016-CPS-AME')
  assert.equal(codigoSugerido('2026-11-05', 'parkshopping', 2), 'BS-20261105-BSB-02')
})

test('codigoSugerido não inventa código sem data ou sem loja', () => {
  assert.equal(codigoSugerido('', 'iguatemi', 1), '')
  assert.equal(codigoSugerido('2026-09-25', '', 1), '')
})

test('⚠️ a data do código tem de bater com a data da sessão', () => {
  /* O código vira `utm_campaign`. Se ele disser 25/09 e a sessão for 26/09, os
   * dois números convivem no painel dizendo coisas diferentes, e ninguém
   * descobre até a conta não fechar. */
  const p = problemasDaSessao({ codigo: 'BS-20260925-CPS-01', quando: '2026-09-26', loja: 'iguatemi' })
  assert.ok(p.some((x) => /data/i.test(x)), `esperava reclamação de data, veio ${JSON.stringify(p)}`)
})

test('⚠️ a praça do código tem de bater com a loja escolhida', () => {
  const p = problemasDaSessao({ codigo: 'BS-20260925-CPS-01', quando: '2026-09-25', loja: 'parkshopping' })
  assert.ok(p.some((x) => /praça/i.test(x)), `esperava reclamação de praça, veio ${JSON.stringify(p)}`)
})

test('sessão bem preenchida não tem problema nenhum', () => {
  assert.deepEqual(
    problemasDaSessao({ codigo: 'BS-20260925-CPS-01', quando: '2026-09-25', loja: 'iguatemi' }), [])
})

test('código torto é recusado antes de sair da tela', () => {
  for (const torto of ['', 'lixo', 'BS-2026-CPS-01', 'BS-20260925-CP-01']) {
    const p = problemasDaSessao({ codigo: torto, quando: '2026-09-25', loja: 'iguatemi' })
    assert.ok(p.length, `deixou passar: "${torto}"`)
  }
})

test('os dois endereços saem do mesmo código, e só de código válido', () => {
  assert.equal(enderecoDaMesa('BS-20260925-CPS-01'),
    'https://vesselbrasil.com.br/bs/BS-20260925-CPS-01')
  assert.match(enderecoDoCartao('BS-20260925-CPS-01'),
    /^https:\/\/vesselbrasil\.com\.br\/private-appointment\/\?canal=beauty_session&event_id=BS-20260925-CPS-01&utm_source=beauty_session&utm_medium=offline_qr&utm_campaign=bs_20260925_cps_01$/)
  assert.equal(enderecoDaMesa('lixo'), '')
  assert.equal(enderecoDoCartao('lixo'), '')
})

test('⚠️ o endereço da MESA é curto — cada letra vira módulo no desenho do QR', () => {
  /* O QR da mesa é lido de longe. O do cartão pode ser maior porque é lido de
   * perto, na mão — foi a decisão do dono em 18/09/2026. */
  assert.ok(enderecoDaMesa('BS-20260925-CPS-01').length <= 50)
})

/* ── A TRAVA CONTRA A MESMA VERDADE EM DOIS LUGARES ────────────────────────
 * Estes endereços também são montados no repositório do site, e a Central não
 * pode importar de lá (repositórios separados; o site não leva credencial).
 * Quando a pasta do site está por perto — que é o caso nesta máquina — o teste
 * lê o arquivo de lá e cobra que os dois montem O MESMO endereço.
 *
 * ⚠️ E ELE NÃO PODE PASSAR CALADO QUANDO A PASTA NÃO ESTÁ: a ausência é dita em
 * voz alta, senão um dia a checagem some sem ninguém perceber e a divergência
 * volta a ser possível. */
const CAMINHO_DO_SITE = fileURLToPath(
  new URL('../../../vessel-brasil/regras-das-beauty-sessions.mjs', import.meta.url))

test('⚠️ o endereço do cartão bate LETRA POR LETRA com o do site', async (t) => {
  if (!existsSync(CAMINHO_DO_SITE)) {
    t.diagnostic('a pasta vessel-brasil não está aqui — não deu para conferir contra o site')
    return
  }
  const site = await import(CAMINHO_DO_SITE)
  for (const codigo of ['BS-20260925-CPS-01', 'BS-20261016-CPS-AME']) {
    assert.equal(enderecoDoCartao(codigo), site.enderecoDaVisita(codigo),
      `a Central e o site montam endereços DIFERENTES para ${codigo} — a mesma `
      + 'cliente cairia em dois baldes de atribuição')
    assert.equal(enderecoDaMesa(codigo), site.enderecoDaSessao(codigo),
      `o endereço da mesa divergiu para ${codigo}`)
  }
})

test('⚠️ "leituras" soma mesa e cartão, mas os dois continuam visíveis', () => {
  /* Somar e esconder apagaria a única pergunta que o cartão existe para
   * responder: ele funciona melhor que o display da mesa? */
  const r = resumoDaSessao({ leituras_mesa: 30, leituras_cartao: 12, pessoas: 7 })
  assert.equal(r.leituras, 42)
  assert.equal(r.mesa, 30)
  assert.equal(r.cartao, 12)
})

test('⚠️ sessão sem leitura nenhuma NÃO vira 0% — vira "sem dado"', () => {
  /* "0%" faz uma sessão que ninguém abriu parecer uma que fracassou. São
   * coisas diferentes, e só a segunda pede decisão. */
  assert.equal(resumoDaSessao({ leituras_mesa: 0, leituras_cartao: 0, pessoas: 0 }).taxa, null)
  assert.equal(taxaEscrita(null), '—')
  assert.equal(taxaEscrita(resumoDaSessao({ leituras_mesa: 10, pessoas: 3 }).taxa), '30%')
})

test('resumoDaSessao aguenta linha vazia sem quebrar a tela', () => {
  const r = resumoDaSessao()
  assert.equal(r.leituras, 0)
  assert.equal(r.taxa, null)
})

test('dataLegivel não passa por Date — fuso não muda o dia', () => {
  assert.equal(dataLegivel('2026-09-25'), '25/09/2026')
  assert.equal(dataLegivel('2026-09-25T03:00:00Z'), '25/09/2026')
  assert.equal(dataLegivel(''), '')
})

test('⚠️ jaPassou compara texto com texto, e HOJE não é passado', () => {
  /* `new Date('2026-09-25')` é meia-noite em UTC: no nosso fuso vira dia 24, e
   * a sessão de hoje apareceria como encerrada. */
  assert.equal(jaPassou('2026-09-24', '2026-09-25'), true)
  assert.equal(jaPassou('2026-09-25', '2026-09-25'), false)
  assert.equal(jaPassou('2026-09-26', '2026-09-25'), false)
})

test('as lojas e as praças andam juntas', () => {
  for (const loja of Object.keys(LOJAS)) {
    assert.ok(PRACA_DA_LOJA[loja], `a loja ${loja} não tem praça`)
    assert.match(PRACA_DA_LOJA[loja], /^[A-Z]{3}$/)
  }
  assert.equal(Object.keys(LOJAS).length, Object.keys(PRACA_DA_LOJA).length)
})

test('FORMATO aceita o que o banco aceita', () => {
  assert.ok(FORMATO.test('BS-20260925-CPS-01'))
  assert.ok(FORMATO.test('BS-20261016-CPS-AME'))
  assert.ok(!FORMATO.test('BS-20260925-CPS-ABCDE'))
})
