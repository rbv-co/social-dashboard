import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { transformSync } from 'esbuild'

/* TODA EDGE FUNCTION AINDA COMPILA?
 *
 * IRMÃ de `src/compartilhado/todo-vue-compila.test.mjs`, e nasceu pelo MESMO
 * motivo, num estrago que aconteceu de verdade em 20/08/2026.
 *
 * O BURACO: `npm test` roda os `.js` de regra do `_shared`, e `npm run build`
 * compila o `src/`. NENHUM DOS DOIS OLHA os `index.ts` das edges. Elas não
 * sobem com push: vão à mão. Resultado — dá para ter a suíte inteira verde, o
 * build limpo, subir a edge e só descobrir que ela nem ARRANCA quando alguém
 * clica.
 *
 * O ESTRAGO: na Peça 3 do atacado/varejo, o `bling-proxy` ganhou uma variável
 * nova chamada `canais`... e já existia um `const canais` logo abaixo, com o
 * resultado de `canaisDoEscopo`. `Identifier 'canais' has already been
 * declared`. A função ficou em BOOT_ERROR — 503 em toda chamada — e com ela as
 * duas dashboards de venda, porque é ela que busca os pedidos no Bling. Foram
 * alguns minutos fora do ar, e só não foi pior porque era meia-noite.
 *
 * A suíte estava verde o tempo todo. É esse silêncio que este arquivo tira.
 *
 * O que ele faz: manda cada `.ts` e cada `.js` das edges pelo esbuild (que já
 * vem com o Vite) só para PARSEAR. Não executa nada, não chama rede, não
 * precisa do Deno. Pega o que derrubou a bling-proxy: erro de sintaxe e
 * declaração repetida no mesmo escopo.
 *
 * O QUE ELE NÃO PEGA, e é bom estar escrito: import de arquivo que não existe,
 * variável de ambiente faltando, e qualquer coisa que só quebra em execução. A
 * edge continua exigindo o teste no ar depois de subir — uma chamada que
 * devolva o 401 da PRÓPRIA função, e não o 503 da plataforma.
 */

const AQUI = dirname(fileURLToPath(import.meta.url))

function arquivosDeCodigo(dir) {
  const achados = []
  for (const nome of readdirSync(dir)) {
    const caminho = join(dir, nome)
    if (statSync(caminho).isDirectory()) {
      achados.push(...arquivosDeCodigo(caminho))
      continue
    }
    if (nome.endsWith('.test.mjs')) continue
    if (nome.endsWith('.ts') || nome.endsWith('.js')) achados.push(caminho)
  }
  return achados
}

const ARQUIVOS = arquivosDeCodigo(AQUI)

test('as edges e os módulos de _shared existem e foram encontrados', () => {
  // Se a varredura vier vazia ou minguada, o teste passaria por não achar nada
  // — que é o mesmo que não existir. Em 20/08/2026 eram 31 edges e 40 arquivos.
  assert.ok(ARQUIVOS.length >= 30, `achei só ${ARQUIVOS.length} arquivos; a varredura quebrou?`)
  const entradas = ARQUIVOS.filter((c) => c.endsWith('index.ts'))
  assert.ok(entradas.length >= 25, `achei só ${entradas.length} entradas de edge`)
})

test('toda edge function compila (sintaxe e declaração repetida)', () => {
  const quebrados = []
  for (const caminho of ARQUIVOS) {
    const codigo = readFileSync(caminho, 'utf8')
    try {
      transformSync(codigo, {
        loader: caminho.endsWith('.ts') ? 'ts' : 'js',
        format: 'esm',
        sourcefile: caminho,
      })
    } catch (e) {
      const rel = resolve(caminho).slice(resolve(AQUI, '..', '..').length + 1)
      quebrados.push(`${rel}: ${String((e && e.message) || e).split('\n')[0]}`)
    }
  }
  assert.deepEqual(quebrados, [], 'edge que não compila NÃO ARRANCA no ar — 503 em toda chamada')
})
