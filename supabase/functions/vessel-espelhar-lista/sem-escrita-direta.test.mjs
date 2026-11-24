import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// Plano 03 (ESPELHO-BLING-ESCRITAS): a edge só escreve no Bling pelo proxy do core.
// O index.ts é Deno e não importa no Node; a regra é conferida na fonte.
const FONTE = readFileSync(new URL('./index.ts', import.meta.url), 'utf8')
const codigo = FONTE.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n')

test('a edge não renova nem lê token próprio do Bling', () => {
  assert.doesNotMatch(codigo, /oauth\/token\`?[\s\S]{0,40}api\.bling|\$\{BLING\}\/oauth\/token/)
  assert.doesNotMatch(codigo, /renovarSeVencido/)
  assert.doesNotMatch(codigo, /bling_tokens/)
  assert.doesNotMatch(codigo, /blingDoCore|CORE_BLING\b/)
})

test('todo acesso ao Bling é por blingSoPeloProxy, e tokenBling exige o proxy ligado', () => {
  assert.match(codigo, /blingSoPeloProxy\(Deno\.env\.toObject\(\)/)
  assert.match(codigo, /function tokenBling\(\)[\s\S]{0,200}BLING_PROXY\.exigir\(\)/)
  assert.doesNotMatch(codigo, /fetch\(`\$\{BLING\}/)
  assert.doesNotMatch(codigo, /direto:\s*\(/)
})
