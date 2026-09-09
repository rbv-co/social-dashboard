import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

/* ⚠️ POR QUE ESTE ARQUIVO EXISTE
 *
 * O número de série impresso no certificado e no cartão PVC é montado com
 * `código do produto + a posição da peça`. Até 09/09/2026 a posição vinha do
 * LOTE, e o lote, na prática, virou SESSÃO DE CADASTRO na bancada: 56 dos 84
 * lotes de produto repetido tinham UMA peça, e a Ravelle Small Jeans tinha 4
 * lotes fabricados no mesmo dia. Cada sessão recomeçava do 1.
 *
 * Resultado medido no banco: 43 números repetidos, em 99 peças, 97 já gravadas.
 * A Linear Medium Chocolate tinha CINCO bolsas carregando SS0001HBM4001.
 *
 * O conserto vive em duas funções que moram em migrations diferentes, e é essa
 * distância que o teste cobre: quem redefinir uma delas amanhã e esquecer a
 * regra falha AQUI, e não na mão da cliente que recebe o cartão. */

const PASTA = join(dirname(fileURLToPath(import.meta.url)), 'migrations')
const SQLS = readdirSync(PASTA).filter((n) => n.endsWith('.sql')).sort()

/** O texto da ÚLTIMA migration que define a função — as anteriores foram
 *  substituídas, e conferir contra uma velha daria falso alarme. */
function ultimaDefinicaoDe(nomeDaFuncao) {
  for (const arquivo of [...SQLS].reverse()) {
    const sql = readFileSync(join(PASTA, arquivo), 'utf8')
    // ⚠️ PROCURA O `create`, NÃO "function public.<nome>". As migrations
    // terminam com linhas `revoke execute on function public.<nome>(...)`, e
    // um lastIndexOf solto casava com o REVOKE — devolvendo um pedaço de texto
    // sem corpo nenhum, e o teste passava ou falhava pelo motivo errado.
    const i = sql.toLowerCase().lastIndexOf('create or replace function public.' + nomeDaFuncao)
    if (i === -1) continue
    return { arquivo, corpo: sql.slice(i) }
  }
  return null
}

test('⚠️ lote novo NÃO recomeça a numeração no 1', () => {
  const d = ultimaDefinicaoDe('vessel_gerar_lote')
  assert.ok(d, 'nenhuma migration define vessel_gerar_lote')
  const chamada = d.corpo.match(/vessel_criar_pecas\s*\(([^)]*)\)/i)
  assert.ok(chamada, `${d.arquivo}: vessel_gerar_lote não chama vessel_criar_pecas`)
  const args = chamada[1].split(',').map((s) => s.trim())
  assert.notEqual(args[1], '1',
    `${d.arquivo}: a numeração voltou a começar no 1 fixo. Ela tem de continuar `
    + 'de onde o PRODUTO parou — senão duas bolsas do mesmo modelo saem com o '
    + 'mesmo número impresso no cartão.')
  assert.match(d.corpo, /vessel_maior_da_serie/i,
    `${d.arquivo}: o começo da numeração tem de sair de vessel_maior_da_serie`)
})

test('⚠️ renumerar enxerga os OUTROS lotes do mesmo produto', () => {
  const d = ultimaDefinicaoDe('vessel_renumerar_lote')
  assert.ok(d, 'nenhuma migration define vessel_renumerar_lote')
  // Sem isto, renumerar puxa as peças livres de volta para 1, 2, 3 e desfaz
  // sozinho o conserto do teste acima — foi assim que o defeito nasceu.
  assert.match(d.corpo, /vessel_chave_do_produto/i,
    `${d.arquivo}: a renumeração voltou a olhar só o próprio lote. As peças dos `
    + 'outros lotes do mesmo produto também ocupam número.')
})

test('a chave do produto usa a MESMA normalização do número de série', () => {
  const d = ultimaDefinicaoDe('vessel_chave_do_produto')
  assert.ok(d, 'vessel_chave_do_produto não existe em nenhuma migration')
  // `numeroDeSerie` (verify/regras.js e lotes.js) faz upper + tira tudo que não
  // é letra ou dígito. Comparar diferente deixaria "SS0001HB.B1" e
  // "ss0001hb b1" como produtos distintos — e eles imprimem o MESMO número.
  assert.match(d.corpo, /upper\s*\(/i, 'a chave tem de subir para maiúscula')
  assert.match(d.corpo, /\[\^A-Za-z0-9\]/, 'a chave tem de descartar tudo que não é letra ou dígito')
})
