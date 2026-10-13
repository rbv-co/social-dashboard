import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fraseDoProxy } from './frases-dos-proxies.js'

test('código conhecido vira frase; nunca o código cru', () => {
  for (const c of ['sem_conta', 'conta_nao_encontrada', 'muitas_leituras', 'chave_nao_configurada', 'nao_e_pdf', 'muitos_documentos', 'sem_evidencia', 'sem_arquivo', 'sem_texto', 'arquivo_grande_demais', 'corpo_invalido', 'sem_credencial', 'anthropic_inacessivel', 'anthropic_recusou', 'recusado_pela_ia', 'resposta_ilegivel', 'sem_permissao', 'nao_autenticado']) {
    const f = fraseDoProxy({ error: c }, 400)
    assert.doesNotMatch(f, /_/, `${c} vazou cru`)
    assert.ok(f.length > 15)
  }
})

test('mensagem e frase da edge vencem; código desconhecido cai na genérica com o status', () => {
  assert.equal(fraseDoProxy({ error: 'sem_permissao', mensagem: 'Quem entrou como outra pessoa só consulta.' }, 403), 'Quem entrou como outra pessoa só consulta.')
  assert.equal(fraseDoProxy({ ok: false, detalhe: 'rode o robô da chave' }, 500), 'rode o robô da chave')
  assert.match(fraseDoProxy({ error: 'algo_novo' }, 502), /HTTP 502/)
  assert.match(fraseDoProxy(null, 504), /HTTP 504/)
})
