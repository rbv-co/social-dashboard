import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  INTERESSES, INSTAGRAM_MAXIMO, nomeLimpo, whatsappCanonico, telefoneLegivel,
  problemasDaLead, corpoDoCadastro, recadoDoCadastro, portaDaLead, portasEscritas,
} from './cadastro-de-lead.js'

const BOM = { nome: 'Ana da Prova', pais: '55', ddd: '19', numero: '99000-2402', instagram: '', interesse: '' }

test('só nome e WhatsApp são obrigatórios', () => {
  assert.deepEqual(problemasDaLead(BOM), [])
  assert.equal(problemasDaLead({ ...BOM, nome: ' A ' }).length, 1)
  assert.equal(problemasDaLead({ ...BOM, ddd: '', numero: '9900' }).length, 1)
  assert.deepEqual(problemasDaLead({ ...BOM, interesse: 'personal-atelier', instagram: '@ana' }), [])
})

test('número de fora do Brasil é avisado antes (o banco só guarda +55)', () => {
  assert.match(problemasDaLead({ ...BOM, pais: '351', ddd: '', numero: '912345678' })[0], /Brasil/)
})

test('Instagram até 120, e interesse só das três opções', () => {
  assert.deepEqual(problemasDaLead({ ...BOM, instagram: 'x'.repeat(INSTAGRAM_MAXIMO) }), [])
  assert.equal(problemasDaLead({ ...BOM, instagram: 'x'.repeat(INSTAGRAM_MAXIMO + 1) }).length, 1)
  assert.equal(problemasDaLead({ ...BOM, interesse: 'outra-coisa' }).length, 1)
})

test('o corpo vai com o telefone canônico, nome limpo e vazio como nulo', () => {
  assert.deepEqual(corpoDoCadastro('BS-1', { ...BOM, nome: '  Ana   da  Prova ' }), {
    p_codigo: 'BS-1', p_nome: 'Ana da Prova', p_whatsapp: '5519990002402', p_instagram: null, p_interesse: null,
  })
  assert.equal(corpoDoCadastro('BS-1', { ...BOM, ddd: '', numero: '+55 19 99000-2402' }).p_whatsapp, '5519990002402')
})

test('telefone legível', () => {
  assert.equal(telefoneLegivel('5519990002402'), '+55 (19) 99000-2402')
  assert.equal(telefoneLegivel('551933334444'), '+55 (19) 3333-4444')
})

test('o recado: sucesso (nova e da base), duplicata é AVISO, arquivada é erro', () => {
  assert.equal(recadoDoCadastro({ ok: true, nome: 'Ana', ja_na_base: false }).tom, 'ok')
  assert.match(recadoDoCadastro({ ok: true, nome: 'Bia da Base', ja_na_base: true }).texto, /já estava na base como Bia da Base/)
  const dup = recadoDoCadastro({ ok: false, situacao: 'ja_estava', porta: 'qr', nome: 'Rita' })
  assert.equal(dup.tom, 'aviso')
  assert.match(dup.texto, /Rita já se identificou nesta sessão pelo QR\. Nada foi duplicado/)
  assert.match(recadoDoCadastro({ ok: false, situacao: 'ja_estava', porta: 'equipe' }).texto, /pela equipe/)
  assert.equal(recadoDoCadastro({ ok: false, situacao: 'sessao_arquivada' }).tom, 'erro')
  // ⚠️ situação que ninguém previu não vira silêncio: aparece com o nome dela.
  assert.match(recadoDoCadastro({ ok: false, situacao: 'coisa_nova' }).texto, /coisa_nova/)
  assert.equal(recadoDoCadastro(null).tom, 'erro')
})

test('a porta da lead e a linha das duas portas', () => {
  assert.deepEqual(portaDaLead({ porta: 'equipe', cadastrado_por_nome: 'Ionara' }), { texto: 'Equipe · Ionara', tom: 'andamento' })
  assert.deepEqual(portaDaLead({ porta: 'qr' }), { texto: 'QR', tom: 'viva' })
  assert.equal(portasEscritas({ pessoas: 12, pessoas_qr: 8, pessoas_equipe: 4 }), '8 pelo QR · 4 pela equipe')
  // ⚠️ banco sem a migration de 24/09: a tela não inventa "0 pela equipe".
  assert.equal(portasEscritas({ pessoas: 12 }), '')
})

// ── A GÊMEA DO SITE ─────────────────────────────────────────────────────────
// ⚠️ Quando a pasta do site está por perto, as regras de lá e as daqui têm de
// responder IGUAL para as mesmas entradas. Duas pastas possíveis: o checkout
// principal (`iamundi/vessel-brasil`) visto da raiz do repositório, ou visto de
// um worktree em `iamundi/arvores/<nome>`.
const candidatas = (arquivo) => [
  new URL(`../../../vessel-brasil/${arquivo}`, import.meta.url),
  new URL(`../../../../../vessel-brasil/${arquivo}`, import.meta.url),
].map((u) => fileURLToPath(u)).filter((c) => existsSync(c))

test('⚠️ o WhatsApp e o nome saem IGUAIS aos do site', async (t) => {
  const [lista] = candidatas('regras-da-lista.mjs')
  if (!lista) { t.diagnostic('a pasta vessel-brasil não está aqui — não deu para conferir contra o site'); return }
  const site = await import(lista)
  const entradas = ['19996170272', '(19) 99617-0272', '+55 19 99617-0272', '5519996170272', '1155443322',
    '551155443322', '19 9900', '', '123456789012345', '19 3333-4444']
  for (const e of entradas) {
    assert.equal(whatsappCanonico(e, '55'), site.whatsappCanonico(e, '55'), `divergiu em "${e}" (+55)`)
    assert.equal(whatsappCanonico(e, '351'), site.whatsappCanonico(e, '351'), `divergiu em "${e}" (+351)`)
    assert.equal(nomeLimpo(`  ${e}  x `), site.nomeLimpo(`  ${e}  x `))
  }
  for (const c of ['5519996170272', '551933334444']) assert.equal(telefoneLegivel(c), site.whatsappBonito(c))
})

test('⚠️ as três opções de "o que ela gostaria agora" são as do site', async (t) => {
  const [regras] = candidatas('regras-das-beauty-sessions.mjs')
  if (!regras) { t.diagnostic('a pasta vessel-brasil não está aqui — não deu para conferir contra o site'); return }
  const site = await import(regras)
  assert.deepEqual(INTERESSES, site.INTERESSES)
  assert.equal(INSTAGRAM_MAXIMO, site.INSTAGRAM_MAXIMO)
})
