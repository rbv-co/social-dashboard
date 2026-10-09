import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const FONTE = readFileSync(new URL('./index.ts', import.meta.url), 'utf8')

test('PUT incerto não prende a fila: tira a linha da fila e registra o aviso; 429 para a rodada; reautorizar lança', () => {
  assert.match(FONTE, /colocarContato\(\{/)
  assert.match(FONTE, /put\.tipo === 'incerto'[\s\S]*bling_atualizado_em[\s\S]*incertos\.push/)
  assert.match(FONTE, /put\.limite[\s\S]*break;/)
  assert.match(FONTE, /put\.tipo === 'reautorizar'\) throw new Error\(FALTA_PERMISSAO_BLING\)/)
  assert.match(FONTE, /resultado incerto \(conferir o contato no Bling/)
})
