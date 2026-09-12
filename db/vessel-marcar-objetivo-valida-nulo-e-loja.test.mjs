import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

/* ⚠️ POR QUE ESTE ARQUIVO EXISTE
 *
 * `not in ('visita', 'ecommerce')` dá NULL (nem verdadeiro nem falso) quando
 * o valor comparado é NULL — um `if` com isso nunca executa, o guard é
 * pulado. Migration original (2026-09-11) não tinha o `is null` explícito:
 * objetivo nulo passava reto, queimava a senha de uso único e respondia
 * `ok:true`. Mesmo problema faltava pra `loja` (nunca validada contra
 * tivoli|iguatemi). Corrigido em 2026-09-12-vessel-marcar-objetivo-valida-
 * nulo-e-loja.sql — este teste falha se a correção regredir. */

const SQL = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)),
       'migrations/2026-09-12-vessel-marcar-objetivo-valida-nulo-e-loja.sql'), 'utf8')

function corpoDaFuncao(nome) {
  const i = SQL.indexOf('create or replace function public.' + nome)
  assert.notEqual(i, -1, 'a função ' + nome + ' não está na migration')
  const resto = SQL.slice(i)
  const fim = resto.indexOf('$function$;')
  return fim === -1 ? resto : resto.slice(0, fim + 11)
}

test('⚠️ objetivo NULO é recusado, não passa reto pelo guard', () => {
  const corpo = corpoDaFuncao('vessel_marcar_objetivo')
  assert.match(corpo, /p_objetivo is null or p_objetivo not in/i,
    '`not in` sozinho dá NULL (não TRUE) quando p_objetivo é nulo — o guard '
    + 'precisa do `is null` explícito na frente')
})

test('⚠️ loja é validada contra o domínio, mesmo padrão do objetivo', () => {
  const corpo = corpoDaFuncao('vessel_marcar_objetivo')
  assert.match(corpo, /v_loja not in \('tivoli', 'iguatemi'\)/i)
  assert.match(corpo, /'loja_invalida'/i)
})

test('a validação de loja só se aplica quando o objetivo é visita', () => {
  const corpo = corpoDaFuncao('vessel_marcar_objetivo')
  assert.match(corpo, /p_objetivo = 'visita' and v_loja not in/i,
    'ecommerce sempre grava loja nula — validar loja pra ecommerce recusaria '
    + 'um caminho que nunca deveria ter loja')
})
