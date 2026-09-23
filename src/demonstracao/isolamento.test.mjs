import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

/* ⚠️ A CENTRAL DE VERDADE NÃO SABE QUE A DEMONSTRAÇÃO EXISTE.
 *
 * O banco de mentira troca `window.fetch` e põe uma sessão falsa — se um dia
 * uma linha da Central importasse esta pasta, a produção passaria a responder
 * de mentira, calada. Então: nenhum arquivo fora de `src/demonstracao/` importa
 * nada daqui, e o `index.html` da Central não fala da demonstração. As únicas
 * linhas da Central que conhecem o modo são as que leem `VITE_DEMONSTRACAO`
 * (roteador e cartão da convidada), e elas não importam nada desta pasta. */
const RAIZ = new URL('../../', import.meta.url).pathname
const SRC = join(RAIZ, 'src')
const DEMO = join(SRC, 'demonstracao')

function arquivos(dir, saida = []) {
  for (const nome of readdirSync(dir)) {
    if (nome === 'node_modules' || nome === 'dist') continue
    const caminho = join(dir, nome)
    if (statSync(caminho).isDirectory()) arquivos(caminho, saida)
    else if (/\.(js|mjs|vue|css|html)$/.test(nome)) saida.push(caminho)
  }
  return saida
}

test('nenhum arquivo da Central importa src/demonstracao/', () => {
  const faltas = []
  for (const caminho of arquivos(SRC)) {
    if (caminho.startsWith(DEMO + '/')) continue
    const fonte = readFileSync(caminho, 'utf8')
    if (/demonstracao\//.test(fonte.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/<!--[\s\S]*?-->/g, ''))) {
      faltas.push(relative(RAIZ, caminho))
    }
  }
  assert.deepEqual(faltas, [], 'a Central passou a falar da demonstração:\n' + faltas.join('\n'))
})

test('o index.html da Central não referencia a demonstração, e continua abrindo ponto-de-partida.js', () => {
  const html = readFileSync(join(RAIZ, 'index.html'), 'utf8')
  assert.doesNotMatch(html, /demonstra/i)
  assert.match(html, /<script type="module" src="\/src\/ponto-de-partida\.js"><\/script>/)
})

test('ponto-de-partida.js não sabe da demonstração', () => {
  assert.doesNotMatch(readFileSync(join(SRC, 'ponto-de-partida.js'), 'utf8'), /demonstra/i)
})

test('a entrada da demonstração instala o banco ANTES de importar a Central', () => {
  const entrada = readFileSync(join(DEMO, 'entrada-da-central.js'), 'utf8')
  // Import ESTÁTICO da Central seria içado para antes da troca do fetch.
  assert.doesNotMatch(entrada, /^import\s[^\n]*ponto-de-partida/m)
  const instala = entrada.indexOf('instalarBancoDeMentira()')
  const importa = entrada.indexOf("await import('../ponto-de-partida.js')")
  assert.ok(instala > 0 && importa > instala, 'instalarBancoDeMentira() tem de vir antes do import() da Central')
  // E nada que a entrada importa estaticamente puxa a cadeia do Supabase.
  for (const m of entrada.matchAll(/^import\s.*from\s+'([^']+)'/gm)) {
    assert.doesNotMatch(m[1], /conectar-no-banco|controle-de-login|ponto-de-partida|moldura/, m[1])
  }
  const central = readFileSync(join(RAIZ, 'demonstracao', 'central.html'), 'utf8')
  assert.match(central, /supabase-js@2\/dist\/umd\/supabase\.min\.js/)
  assert.match(central, /src="\/src\/demonstracao\/entrada-da-central\.js"/)
  assert.doesNotMatch(central.replace(/<!--[\s\S]*?-->/g, ''), /ponto-de-partida/, 'a Central entra pela entrada da demonstração, nunca direto')
})

test('só dois arquivos da Central leem VITE_DEMONSTRACAO', () => {
  const quem = arquivos(SRC).filter((c) => !c.startsWith(DEMO + '/') && !c.endsWith('.test.mjs'))
    .filter((c) => readFileSync(c, 'utf8').includes('VITE_DEMONSTRACAO'))
    .map((c) => relative(SRC, c)).sort()
  assert.deepEqual(quem, ['ferramentas/comercial-vessel/cartao-da-convidada.vue', 'mapa-de-enderecos.js'])
})

test('o build da Central não enxerga a configuração da demonstração', () => {
  const normal = readFileSync(join(RAIZ, 'vite.config.js'), 'utf8')
  assert.doesNotMatch(normal, /demonstra/i)
  const demo = readFileSync(join(RAIZ, 'vite.demonstracao.config.js'), 'utf8')
  assert.match(demo, /outDir: 'dist-demonstracao'/)
  assert.match(demo, /demonstracao\/index\.html/)
  assert.match(demo, /demonstracao\/central\.html/)
  const vercel = JSON.parse(readFileSync(join(RAIZ, 'demonstracao', 'vercel.json'), 'utf8'))
  const cabecalhos = vercel.headers.flatMap((h) => h.headers)
  assert.ok(cabecalhos.some((h) => h.key === 'X-Robots-Tag' && /noindex/.test(h.value)))
})
