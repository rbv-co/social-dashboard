import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const tela = readFileSync(new URL('./tela-de-autenticidade.vue', import.meta.url), 'utf8')
const script = tela.slice(tela.indexOf('<script'))

test('a O.S. e um campo OPCIONAL nos dois formularios', () => {
  const rotulos = [...tela.matchAll(/au-rot">O\.S\.[^<]*</g)].map((m) => m[0])
  assert.equal(rotulos.length, 2, 'a O.S. tem de estar em criar E em editar')
  for (const r of rotulos) assert.match(r, /opcional/i, 'o campo precisa DIZER que e opcional')
})

test('⚠️ ABRIR A EDICAO CARREGA A O.S. QUE JA EXISTE', () => {
  // Sem isto o campo nasce vazio, e vazio quer dizer "limpe" para a funcao do
  // banco: abrir um lote e salvar qualquer outra coisa APAGARIA a O.S. dele,
  // sem ninguem tocar naquele campo.
  assert.match(script, /edicao\.os\s*=\s*l\.os\s*\|\|\s*''/,
    'a edicao nao carrega a O.S.: abrir e salvar apagaria o numero')
})

test('⚠️ EDITAR MANDA STRING, NUNCA `|| null`', () => {
  // Para `vessel_editar_lote`, NULO quer dizer "nao mexa". Com `edicao.os || null`,
  // limpar o campo mandaria nulo e o valor ANTIGO voltaria — apagar uma O.S.
  // errada viraria impossivel, e a tela mentiria dizendo que salvou.
  const chamada = script.slice(script.indexOf("rpc('vessel_editar_lote'"))
  const ate = chamada.slice(0, chamada.indexOf('})'))
  assert.match(ate, /p_os:\s*String\(/, 'p_os tem de ir como string')
  assert.doesNotMatch(ate, /p_os:[^,]*\|\|\s*null/,
    'com `|| null` o campo limpo faz o valor antigo voltar')
})

test('criar tambem manda a O.S.', () => {
  const chamada = script.slice(script.indexOf("rpc('vessel_gerar_lote'"))
  assert.match(chamada.slice(0, chamada.indexOf('})')), /p_os:/)
})

test('a data que se preenche chama "Finalizado em", nos dois formularios', () => {
  // O dono esclareceu em 04/09/2026: e o dia em que a peca foi FINALIZADA. O
  // rotulo antigo, "Fabricado em", se confundia com a data de criacao do lote —
  // que agora aparece ao lado, no cabecalho.
  assert.equal((tela.match(/au-rot">Finalizado em</g) || []).length, 2)
  assert.doesNotMatch(tela, /au-rot">(Fabricado em|Data de fabricação)</)
})

test('o card FECHADO do lote mostra a O.S. e a data de criacao', () => {
  const summary = tela.slice(tela.indexOf('au-lote-nome'), tela.indexOf('au-lote-conta'))
  assert.match(summary, /g\.lote\.os/, 'a O.S. nao aparece no cabecalho do lote')
  assert.match(summary, /dataCurta\(g\.lote\.criado_em\)/,
    'a data de criacao tem de sair de `criado_em`, que o banco guarda sozinho')
})

test('a data do cabecalho NAO e um campo para preencher', () => {
  // Campo automatico nao tem como ser esquecido nem digitado errado. Se alguem
  // criar um `novo.criado_em`, e porque virou campo de formulario.
  assert.doesNotMatch(script, /novo\.criado_em|edicao\.criado_em/)
})
