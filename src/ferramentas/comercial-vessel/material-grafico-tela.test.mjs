import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

/* AS GUARDAS DA TELA DO MATERIAL GRÁFICO — leem o `.vue` de verdade e conferem
 * o FIO entre a tela e as regras puras (o `.vue` não roda na suíte).
 *
 * ⚠️ É LEMBRETE, NÃO PORTÃO: guarda por texto prova que a ligação está
 * escrita, não que a tela funciona. O portão de verdade da leitura do QR é
 * `src/compartilhado/qr.test.mjs` (zxing lê cada QR de volta), e o da tela é
 * a foto a 375 e 1440 no laboratório. */

const ler = (c) => readFileSync(new URL(c, import.meta.url), 'utf8')
const TELA = ler('./tela-de-material-grafico.vue')
const QR = ler('./qr-para-baixar.vue')

test('⚠️ SÓ LEITURA: a tela chama as três funções de conta das irmãs, e nenhuma outra', () => {
  const chamadas = [...TELA.matchAll(/'(vessel_[a-z_]+)'/g)].map((m) => m[1]).sort()
  assert.deepEqual(chamadas, [
    'vessel_conta_das_beauty_sessions', 'vessel_conta_das_private_edits', 'vessel_rastreio_dos_stylists',
  ])
  assert.doesNotMatch(TELA, /method: 'PATCH'|method: 'DELETE'|\/rest\/v1\/(?!rpc)/, 'escrita ou tabela direta')
})

test('⚠️ erro de leitura não vira lista vazia: cada ação tem a faixa de erro e a lista só sem erro', () => {
  assert.match(TELA, /<faixa-de-erro :erro="grupos\[a\.chave\]\.erro"/)
  assert.match(TELA, /<ul v-else-if="!grupos\[a\.chave\]\.erro"/)
  // a frase do vazio também só aparece SEM erro
  assert.match(TELA, /v-else-if="!grupos\[a\.chave\]\.erro && !naTela\[a\.chave\]\.length"/)
})

test('a tela filtra pela regra testada, e só o filtro de encerrados volta ao banco', () => {
  assert.match(TELA, /filtrarItens\(grupos\[a\.chave\]\.itens, \{ busca: busca\.value, mostrarEncerrados: mostrarEncerrados\.value \}\)/)
  assert.match(TELA, /watch\(mostrarEncerrados, carregarTudo\)/)
  assert.doesNotMatch(TELA, /watch\(busca/, 'a busca não pode ir ao banco a cada tecla')
  assert.match(TELA, /p_incluir_arquivadas: todos/)
  assert.match(TELA, /p_incluir_desativadas: todos/)
})

test('um bloco por ação, na cor dela, e a raiz com a identidade da ferramenta', () => {
  assert.match(TELA, /<div class="tela-material-grafico id-ferramenta">/)
  assert.match(TELA, /v-for="a in ACOES"/)
  for (const [classe, token] of [['beauty-session', 'beauty-sessions'], ['private-edit', 'private-edit'],
    ['stylist-circle', 'stylist-circle']]) {
    assert.match(TELA, new RegExp(`\\.mg-acao-${classe} \\{ --tom: var\\(--cor-${token}\\); --cor-da-acao: var\\(--cor-${token}\\); \\}`))
  }
})

test('⚠️ o botão baixa o que a prévia mostra: os dois saem do mesmo svgDoQr, sem v-html', () => {
  assert.match(QR, /const svg = computed\(\(\) => \(props\.endereco \? svgDoQr\(props\.endereco\) : ''\)\)/)
  assert.match(QR, /encodeURIComponent\(svg\.value\)/, 'a prévia tem de ser o mesmo SVG do download')
  assert.match(QR, /new Blob\(\[svg\.value\]/, 'o SVG baixado tem de ser o mesmo da prévia')
  assert.match(QR, /pngDoQr\(props\.endereco\)/)
  assert.doesNotMatch(QR, /v-html=/)
  assert.match(QR, /class="btn btn-principal"[^>]*>\s*\{\{ gerandoPng \? 'Gerando…' : 'Baixar PNG' \}\}/)
})

test('⚠️ a prévia fica sobre PAPEL (claro nos dois temas), nunca sobre a superfície do tema', () => {
  assert.match(QR, /background-color: var\(--papel\)/)
  assert.match(QR, /var\(--papel-xadrez\)/)
  const css = ler('../../estilos/estilos-globais.css')
  const escuro = css.slice(css.indexOf('[data-theme="dark"]{'))
  assert.doesNotMatch(escuro.slice(0, escuro.indexOf('}')), /--papel/, 'o papel não pode escurecer no tema escuro')
})
