// O filete do cartão e o selo moram no mesmo cartão e não podem discordar.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { tomDoSelo, classeDoTom } from './tom-do-selo.js'

test('cada selo da casa vira o tom de situação do mesmo sentido', () => {
  assert.equal(tomDoSelo('selo-ok'), 'viva')
  assert.equal(tomDoSelo('selo-info'), 'andamento')
  assert.equal(tomDoSelo('selo-atencao'), 'queda')
  assert.equal(tomDoSelo('selo-erro'), 'faltou')
  assert.equal(tomDoSelo('selo-neutro'), 'parada')
})

test('selo sem cor (ou nenhum) é cinza, nunca uma cor inventada', () => {
  assert.equal(tomDoSelo(''), 'parada')
  assert.equal(tomDoSelo(undefined), 'parada')
  assert.equal(tomDoSelo('selo-qualquer'), 'parada')
  assert.equal(classeDoTom('selo-ok'), 'id-tom-viva')
})

test('todo tom devolvido existe na folha comum da identidade', () => {
  const folha = readFileSync(new URL('../../estilos/identidade-da-ferramenta.css', import.meta.url), 'utf8')
  for (const s of ['selo-ok', 'selo-info', 'selo-atencao', 'selo-erro', 'selo-neutro']) {
    assert.match(folha, new RegExp(`\\.${classeDoTom(s)}\\s*\\{`), `${classeDoTom(s)} não existe na folha`)
  }
})
