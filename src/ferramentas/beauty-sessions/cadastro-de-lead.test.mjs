import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  INTERESSES, INSTAGRAM_MAXIMO, FORMULARIO_VAZIO, nomeLimpo, whatsappCanonico, telefoneLegivel, emailCanonico,
  problemasDaLead, corpoDoCadastro, recadoDoCadastro, portaDaLead, portasEscritas,
} from './cadastro-de-lead.js'

const BOM = { nome: 'Ana da Prova', pais: '55', ddd: '19', numero: '99000-2402', email: 'ana@prova.com.br', instagram: '', interesse: '' }

test('nome, WhatsApp e e-mail são obrigatórios (e-mail desde 28/09/2026)', () => {
  assert.deepEqual(problemasDaLead(BOM), [])
  assert.equal(problemasDaLead({ ...BOM, nome: ' A ' }).length, 1)
  assert.equal(problemasDaLead({ ...BOM, ddd: '', numero: '9900' }).length, 1)
  assert.deepEqual(problemasDaLead({ ...BOM, interesse: 'personal-atelier', instagram: '@ana' }), [])
  // ⚠️ sem e-mail o RD Station recusa o contato: a tela não deixa passar.
  assert.match(problemasDaLead({ ...BOM, email: '   ' })[0], /e-mail dela/)
  assert.match(problemasDaLead({ ...BOM, email: 'ana.prova.com' })[0], /Confira o e-mail/)
  assert.equal(FORMULARIO_VAZIO.email, '')
  assert.ok(problemasDaLead(FORMULARIO_VAZIO).some((p) => /e-mail/.test(p)))
})

test('o e-mail segue a MESMA regra do banco (`vessel_email_canonico`)', () => {
  assert.equal(emailCanonico('  Ana@Prova.COM.br '), 'ana@prova.com.br')
  assert.equal(emailCanonico('a@b.co'), 'a@b.co')                  // 6 caracteres: o piso
  assert.equal(emailCanonico('a@b.c'), null)                        // 5, e final de 1 letra
  assert.equal(emailCanonico('ana@prova.c'), null)                  // final precisa de 2
  assert.equal(emailCanonico('ana@prova'), null)                    // sem ponto depois do @
  assert.equal(emailCanonico('ana@@prova.com'), null)
  assert.equal(emailCanonico('ana maria@prova.com'), null)          // espaço no meio
  assert.equal(emailCanonico('sem-arroba.com'), null)
  assert.equal(emailCanonico(''), null)
  assert.equal(emailCanonico(null), null)
  const teto = `${'a'.repeat(244)}@prova.com`                       // 254: o teto
  assert.equal(teto.length, 254)
  assert.equal(emailCanonico(teto), teto)
  assert.equal(emailCanonico(`a${teto}`), null)
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
    p_email: 'ana@prova.com.br',
  })
  assert.equal(corpoDoCadastro('BS-1', { ...BOM, email: '  Ana@Prova.COM.br ' }).p_email, 'ana@prova.com.br')
  // escrito e inválido vai como está, para o banco responder `email_invalido`.
  assert.equal(corpoDoCadastro('BS-1', { ...BOM, email: ' sem-arroba ' }).p_email, 'sem-arroba')
  assert.equal(corpoDoCadastro('BS-1', { ...BOM, email: '' }).p_email, null)
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
  const email = recadoDoCadastro({ ok: false, situacao: 'email_invalido' })
  assert.equal(email.tom, 'erro')
  assert.match(email.texto, /e-mail/)
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
