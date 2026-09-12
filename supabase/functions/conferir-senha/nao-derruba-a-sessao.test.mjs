import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const fonte = readFileSync(new URL('./index.ts', import.meta.url), 'utf8')

/* ⚠️ ESTE TESTE EXISTE POR UM DEFEITO DE PRODUÇÃO, em 04/09/2026.
 *
 * O `signOut()` do supabase-js é GLOBAL por padrão: ele não encerra só o
 * cliente que o chamou, ele REVOGA TODOS OS TOKENS daquele usuário. Aqui dentro
 * isso derrubava a sessão de quem tinha ACABADO de conferir a senha — a
 * primeira ação passava, a seguinte dizia "sessão expirou". Pegava o navegador
 * e o programa da bancada juntos, porque os dois logam com a mesma conta.
 *
 * A ironia: a tela evita o `signInWithPassword` justamente para não trocar a
 * sessão, e era traída por esta linha dentro da edge que existe para protegê-la.
 */
test('⚠️ o signOut desta edge e LOCAL, nunca global', () => {
  const chamadas = [...fonte.matchAll(/\.auth\.signOut\(([^)]*)\)/g)].map((m) => m[1].trim())
  assert.ok(chamadas.length > 0, 'sumiu o signOut — se foi de proposito, apague este teste junto')
  for (const arg of chamadas) {
    assert.match(arg, /scope:\s*['"]local['"]/,
      'signOut sem `scope: "local"` revoga TODOS os tokens do usuario e derruba '
      + 'a sessao de quem acabou de conferir a senha')
  }
})

test('a sessao isolada continua sem persistir', () => {
  // Se ela persistisse, o token da conferencia vazaria para fora da funcao.
  assert.match(fonte, /persistSession:\s*false/)
  assert.match(fonte, /autoRefreshToken:\s*false/)
})

test('quem e a pessoa sai do TOKEN, nunca de e-mail vindo do cliente', () => {
  // Aceitar e-mail por parametro transformaria esta edge num oraculo para
  // testar senha dos outros.
  assert.match(fonte, /getUser\(/, 'a identidade tem de vir do token')
  assert.ok(!/body\s*\)?\.\s*email|\.email\s*\|\|\s*['"]/.test(fonte),
    'e-mail vindo do corpo da requisicao: isto vira oraculo de senha')
})
