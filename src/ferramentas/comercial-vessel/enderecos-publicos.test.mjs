import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  FORMATO_STYLIST, FORMATO_ENCONTRO, FORMATO_DA_CHAVE, ENDERECO_DO_CIRCLE,
  ENDERECO_DO_GERADOR_DE_CARTAO, ENDERECO_DO_GERADOR_DO_PRIVATE_EDIT_CARD, SITE,
  enderecoDaStylist, enderecoDoConvite, dataLegivel, dataHoraLegivel,
  problemasDoEncontro,
} from './enderecos-publicos.js'

test('o link da stylist sai só de código válido', () => {
  assert.equal(enderecoDaStylist('STY-0001'), 'https://vesselbrasil.com.br/s/STY-0001')
  assert.equal(enderecoDaStylist('sty-0001'), 'https://vesselbrasil.com.br/s/STY-0001')
  for (const torto of ['', 'STY-1', 'lixo', 'STY-00011']) {
    assert.equal(enderecoDaStylist(torto), '', `passou: ${torto}`)
  }
})

test('⚠️ o convite vai pela CHAVE sorteada, não pelo código adivinhável', () => {
  /* `PE-20261005-CPS-01` é adivinhável: quem recebesse um convite listaria os
   * outros encontros trocando a data e o número. */
  assert.equal(enderecoDoConvite('AWSNWNXY'), 'https://vesselbrasil.com.br/pe/AWSNWNXY')
  assert.equal(enderecoDoConvite('PE-20261005-CPS-01'), '')
})

test('⚠️ a chave não usa as letras que se confundem em voz alta', () => {
  /* Sem I, L, O, U, 0 e 1 — a chave é ditada por telefone e digitada por gente. */
  for (const ruim of ['IIIIIIII', 'LLLLLLLL', 'OOOOOOOO', 'UUUUUUUU', '00000000', '11111111']) {
    assert.ok(!FORMATO_DA_CHAVE.test(ruim), `a chave aceitou ${ruim[0]}`)
  }
  assert.ok(FORMATO_DA_CHAVE.test('AWSNWNXY'))
})

test('a porta do Circle é uma só', () => {
  assert.equal(ENDERECO_DO_CIRCLE, 'https://vesselbrasil.com.br/stylist-circle/')
})

test('o gerador do Appointment Card mora no site da Vessel', () => {
  assert.equal(ENDERECO_DO_GERADOR_DE_CARTAO, `${SITE}/geradorappointmentcard/`)
})

// ⚠️ O GERADOR ABRE VAZIO. Decisão do dono em 19/09: ele não lê nada da barra de
// endereço hoje, e ensiná-lo a ler exige mexer e publicar o OUTRO repositório.
// Um `?` aqui seria uma promessa de preenchimento que o gerador não sabe
// cumprir — a Client Advisor acharia que preencheu algo quando não preencheu.
test('a porta não promete preenchimento que o gerador não sabe ler', () => {
  assert.ok(!ENDERECO_DO_GERADOR_DE_CARTAO.includes('?'),
    'a porta do cartão não leva parâmetro: o gerador ignora e a pessoa acha que preencheu')
})

// ⚠️ O GÊMEO (28/09/2026): o gerador do Private Edit Card, as mesmas regras.
test('o gerador do Private Edit Card mora no site da Vessel', () => {
  assert.equal(ENDERECO_DO_GERADOR_DO_PRIVATE_EDIT_CARD, `${SITE}/geradorprivateeditcard/`)
})

test('a porta do Private Edit Card também não promete preenchimento', () => {
  assert.ok(!ENDERECO_DO_GERADOR_DO_PRIVATE_EDIT_CARD.includes('?'),
    'a porta do cartão não leva parâmetro: o gerador ignora e a pessoa acha que preencheu')
})

test('⚠️ as duas portas não se confundem: cada cartão abre o SEU gerador', () => {
  assert.notEqual(ENDERECO_DO_GERADOR_DO_PRIVATE_EDIT_CARD, ENDERECO_DO_GERADOR_DE_CARTAO)
  // e o gerador não é a página do convite de um encontro (/pe/<chave>)
  assert.ok(!ENDERECO_DO_GERADOR_DO_PRIVATE_EDIT_CARD.startsWith(`${SITE}/pe/`))
})

/* ── A TRAVA CONTRA A MESMA VERDADE EM DOIS LUGARES ──────────────────────── */
const SITE_PE = fileURLToPath(new URL('../../../vessel-brasil/regras-da-private-edit.mjs', import.meta.url))
const SITE_STY = fileURLToPath(new URL('../../../vessel-brasil/regras-do-rastreio-de-stylist.mjs', import.meta.url))

test('⚠️ os endereços batem LETRA POR LETRA com os do site', async (t) => {
  if (!existsSync(SITE_PE) || !existsSync(SITE_STY)) {
    t.diagnostic('a pasta vessel-brasil não está aqui — não deu para conferir contra o site')
    return
  }
  const pe = await import(SITE_PE)
  const sty = await import(SITE_STY)
  assert.equal(String(FORMATO_DA_CHAVE), String(pe.FORMATO_DA_CHAVE),
    'o formato da chave divergiu do site')
  assert.equal(String(FORMATO_ENCONTRO), String(pe.FORMATO_DO_ENCONTRO),
    'o formato do encontro divergiu do site')
  assert.equal(String(FORMATO_STYLIST), String(sty.FORMATO),
    'o formato do código da stylist divergiu do site')
  assert.equal(enderecoDoConvite('AWSNWNXY'), `${pe.RAIZ_DO_CONVITE}/AWSNWNXY`)
  assert.equal(enderecoDaStylist('STY-0001'), `${sty.RAIZ_DO_LINK}/STY-0001`)
})

/* ── DATA E HORA ────────────────────────────────────────────────────────── */

test('dataLegivel não passa por Date — fuso não muda o dia', () => {
  assert.equal(dataLegivel('2026-10-05'), '05/10/2026')
  assert.equal(dataLegivel(''), '')
})

test('⚠️ a hora do encontro é mostrada no fuso de São Paulo', () => {
  /* O `quando` é timestamptz e chega em UTC. Um encontro às 19h de Campinas
   * chega como 22h UTC: mostrar "22h" mandaria a anfitriã na hora errada. */
  assert.equal(dataHoraLegivel('2026-10-05T22:00:00Z'), '05/10/2026 às 19h00')
  assert.equal(dataHoraLegivel('2026-10-06T01:30:00Z'), '05/10/2026 às 22h30')
  assert.equal(dataHoraLegivel(''), '')
  assert.equal(dataHoraLegivel('lixo'), '')
})

/* ── O QUE BARRA ANTES DE ENVIAR ────────────────────────────────────────── */

test('encontro bem preenchido não tem problema', () => {
  const amanha = new Date(Date.now() + 10 * 86400000).toISOString()
  assert.deepEqual(
    problemasDoEncontro({ stylist: 'STY-0001', quando: amanha, praca: 'CPS', vagas: 8 }), [])
})

test('⚠️ encontro no passado é barrado — o convite nasceria vencido', () => {
  const ontem = new Date(Date.now() - 10 * 86400000).toISOString()
  const p = problemasDoEncontro({ stylist: 'STY-0001', quando: ontem, praca: 'CPS', vagas: 8 })
  assert.ok(p.some((x) => /já passou/i.test(x)), JSON.stringify(p))
})

test('⚠️ vagas é o DENOMINADOR da taxa de comparecimento — zero não passa, e a T11 fecha em 7 a 10', () => {
  const amanha = new Date(Date.now() + 10 * 86400000).toISOString()
  for (const v of [0, -3, 6, 11, 999, 2.5, null]) {
    const p = problemasDoEncontro({ stylist: 'STY-0001', quando: amanha, praca: 'CPS', vagas: v })
    assert.ok(p.some((x) => /vagas/i.test(x)), `passou vagas ${v}`)
  }
})

test('sem stylist e sem praça, a tela reclama das duas', () => {
  const p = problemasDoEncontro({ quando: new Date(Date.now() + 864000000).toISOString(), vagas: 8 })
  assert.ok(p.some((x) => /stylist/i.test(x)))
  assert.ok(p.some((x) => /praça/i.test(x)))
})

// ⚠️ 25/09/2026 (Task 8): a lista cravada `['CPS','SAO','SBO','BSB']` saiu
// daqui — ela barrava Limeira e Piracicaba pela TELA mesmo depois de as duas
// entrarem no cadastro. `siglasValidas` é opcional (a tela sempre manda a
// lista de hoje); sem ele, só confere que ALGUMA praça foi escolhida.
test('⚠️ a praça vem do cadastro (parâmetro), não de lista cravada — sigla nova do cadastro passa, e fora do cadastro é barrada', () => {
  const amanha = new Date(Date.now() + 10 * 86400000).toISOString()
  const siglasDeHoje = ['CPS', 'SAO', 'SBO', 'BSB', 'LIM', 'PIR']
  assert.deepEqual(
    problemasDoEncontro({ stylist: 'STY-0001', quando: amanha, praca: 'LIM', vagas: 8 }, siglasDeHoje), [],
    'Limeira não existia na lista cravada de antes — agora passa por vir do cadastro')
  const p = problemasDoEncontro({ stylist: 'STY-0001', quando: amanha, praca: 'XXX', vagas: 8 }, siglasDeHoje)
  assert.ok(p.some((x) => /praça/i.test(x)), JSON.stringify(p))
  // sem `siglasValidas` (compatibilidade): só confere que uma praça foi escolhida.
  assert.deepEqual(
    problemasDoEncontro({ stylist: 'STY-0001', quando: amanha, praca: 'LIM', vagas: 8 }), [])
})
