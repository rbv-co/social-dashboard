import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { extrair, comoTexto, ARQUIVO_JSON } from './extrair-contrato-front.mjs'

// O JSON versionado é a entrada do teste Go de contrato (api/internal/web/contrato_front_test.go). Chamada
// nova (ou removida) no front muda o JSON; se ele não foi regerado, o Go não veria a chamada.
test('contrato_front.json está em dia com o código do front', async () => {
  const novo = comoTexto(await extrair())
  assert.equal(
    readFileSync(ARQUIVO_JSON, 'utf8'), novo,
    'o front mudou: rode `node src/compartilhado/extrair-contrato-front.mjs` e commite api/internal/web/testdata/contrato_front.json',
  )
})

test('a extração enxerga o que o painel usa (guarda contra regex que para de casar)', async () => {
  const c = await extrair()
  const n = (g) => Object.keys(c.usos[g]).length
  assert.ok(Object.keys(c.tabelas).length >= 100, 'tabelas de ROTAS')
  assert.ok(n('tabelas') >= 100, 'tabelas usadas')
  assert.ok(n('rpcs') >= 90, 'RPCs')
  assert.ok(n('edges') >= 15, 'edges')
  assert.ok(n('caminhos') >= 25, 'caminhos diretos')
  // âncoras: um de cada forma de chamada
  assert.ok(c.usos.tabelas.profiles, '.from()/sb()')
  assert.ok(c.usos.edges['meta-proxy'], 'invocarNaArea/fetchDaApi')
  assert.ok(c.usos.caminhos['POST /auth/entrar'], 'pedir(método, caminho)')
  assert.equal(c.tabelas.patrimonio_config.escritas[0].caminho, '/patrimonio/config/{}')
})
