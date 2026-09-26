// LEMBRETE (25/09/2026): aplicador que cria CONTA DE PROVA (`insert into
// auth.users`) garante que ela não chega ao COMMIT. Em 24–25/09, quatro
// aplicadores criaram as contas fora do savepoint e o `--gravar` deixou 8 em
// produção, com chaves do Comercial Vessel. Regra: PADRAO-DA-CENTRAL.md,
// "Aplicador de migration".
//
// ⚠️ É LEMBRETE DE TEXTO, NÃO PORTÃO: confere que o aplicador novo usa
// `contasDeProva(cli)` + `apagarEConferir()` antes do commit, ou declara
// `// contas-de-prova: <onde nascem e morrem>` (conta criada DENTRO do savepoint
// da prova). Não prova que a declaração é verdadeira. Quem prova é a impressão
// do próprio aplicador (número de contas antes = depois) e, em produção,
// `select count(*) from public.profiles where email like '%@teste.invalido'`.
//
// LEGADO: os aplicadores abaixo já foram gravados e param logo no começo
// ("já está registrada") — não rodam de novo. A lista é FECHADA: aplicador novo
// não entra nela, cumpre a regra.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'

const LEGADO = new Set([
  'aplicar-permissoes-das-ferramentas-do-comercial-vessel.mjs',
  'aplicar-vessel-beauty-session-mexer.mjs',
  'aplicar-vessel-beauty-cadastro-pela-equipe.mjs',
  'aplicar-vessel-beauty-sessions-lista-devolve-arquivada.mjs',
  'aplicar-vessel-codigos-sty-e-ca-sem-repetir.mjs',
  'aplicar-vessel-encerrar-exige-editar.mjs',
  'aplicar-vessel-convidadas-do-encontro.mjs',
  'aplicar-vessel-criar-exige-editar.mjs',
  'aplicar-vessel-private-edit-mexer.mjs',
  'aplicar-vessel-private-edit-lista-ativa-arquivada.mjs',
  'aplicar-vessel-stylist-funil-configuravel.mjs',
  'aplicar-vessel-rastreio-devolve-ativa-e-contato.mjs',
  'aplicar-vessel-stylist-whatsapp-ou-instagram.mjs',
  'aplicar-vessel-stylist-etapa-identificada.mjs',
  'aplicar-vessel-stylist-mexer.mjs',
  'aplicar-vessel-stylist-sem-contato.mjs',
  'aplicar-vessel-stylist-scorecard.mjs',
  'aplicar-vessel-t11-bases-do-stylist-circle.mjs',
  'aplicar-vessel-trava-de-editar.mjs',
])
const PASTA = new URL('./', import.meta.url)

test('aplicador novo que cria conta de prova não a deixa chegar ao COMMIT', () => {
  const ruins = readdirSync(PASTA).filter((f) => /^aplicar-.*\.mjs$/.test(f) && !LEGADO.has(f)).filter((f) => {
    const s = readFileSync(new URL(f, PASTA), 'utf8')
    if (!/insert into auth\.users/.test(s)) return false
    const pelaLib = /contasDeProva\(cli\)/.test(s) && /apagarEConferir\(\)[\s\S]*query\('commit'\)/.test(s)
    return !pelaLib && !/\/\/ contas-de-prova: \S/.test(s)
  })
  assert.deepEqual(ruins, [], 'use coletor/lib/contas-de-prova.mjs (apagarEConferir antes do commit) ou crie a conta dentro do savepoint e declare // contas-de-prova: …')
})

test('os quatro aplicadores que deixaram contas usam a lib e apagam antes do commit', () => {
  for (const f of ['aplicar-vessel-agenda-do-private-edit.mjs', 'aplicar-vessel-private-edit-so-com-stylist-liberada.mjs',
    'aplicar-vessel-codigo-do-encontro-sem-repetir.mjs', 'aplicar-vessel-convite-da-convidada-teto-e-abertura-da-equipe.mjs']) {
    const s = readFileSync(new URL(f, PASTA), 'utf8')
    assert.ok(!/insert into auth\.users/.test(s), `${f}: ainda cria conta à mão`)
    assert.match(s, /await provas\.apagarEConferir\(\)\s*\n\s*const fim = await cli\.query\('commit'\)/, `${f}: apagarEConferir tem de vir logo antes do commit`)
  }
})
