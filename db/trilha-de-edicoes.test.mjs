import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

/* ⚠️ POR QUE ESTE ARQUIVO EXISTE
 *
 * `vessel_edicoes` guarda a trilha de tudo que muda uma peça, e tem uma LISTA
 * FECHADA de ações permitidas. A lista é boa: impede ação escrita errado de
 * entrar na trilha e virar linha que ninguém sabe ler.
 *
 * Mas em 05/09/2026 uma função nova (`vessel_baixar_garantia`) escreveu na
 * trilha uma ação que NÃO estava na lista. O banco recusava, a transação
 * inteira voltava atrás, e a tela dizia só "Não consegui encerrar agora". A
 * função nunca funcionou uma vez sequer, e nenhum teste viu — porque a função
 * e a lista moram em migrations diferentes e ninguém as leu juntas.
 *
 * Este teste as lê juntas. Se alguém criar a próxima ação e esquecer de somar
 * na lista, ele falha AQUI, e não na mão do dono. */

const PASTA = join(dirname(fileURLToPath(import.meta.url)), 'migrations')
const SQLS = readdirSync(PASTA).filter((n) => n.endsWith('.sql')).sort()
const TEXTOS = SQLS.map((n) => ({ nome: n, sql: readFileSync(join(PASTA, n), 'utf8') }))

// A LISTA QUE VALE é a do último arquivo que a redefine — as anteriores foram
// substituídas, e conferir contra uma lista velha daria falso alarme.
function listaPermitida() {
  for (const { sql } of [...TEXTOS].reverse()) {
    const i = sql.lastIndexOf('vessel_edicoes_acao_check')
    if (i === -1) continue
    const check = sql.slice(i)
    if (!/check\s*\(/i.test(check)) continue
    const arr = check.match(/array\s*\[([^\]]+)\]/i)
    if (!arr) continue
    return arr[1].match(/'([a-z_]+)'/g).map((s) => s.replace(/'/g, ''))
  }
  return null
}

// TODA ação que qualquer função do repositório escreve na trilha.
//
// ⚠️ SÃO DUAS FORMAS DE ESCREVER, e por um tempo esta guarda só via UMA. O
// `insert ... values (codigo, 'acao', ...)` era pego; o `insert ... select
// p.codigo, 'acao', ...` (usado quando se escreve uma linha por peça de um
// lote) passava invisível. Descoberto em 07/09/2026, ao somar `lote_excluido`:
// a guarda continuou verde sem enxergar a ação nova — que é exatamente o modo
// de falhar que ela existe para impedir.
function acoesEscritas() {
  const achadas = new Map()
  const formas = [
    /insert\s+into\s+(?:public\.)?vessel_edicoes[\s\S]{0,400}?values\s*\(\s*[^,]+,\s*'([a-z_]+)'/gi,
    /insert\s+into\s+(?:public\.)?vessel_edicoes[\s\S]{0,400}?select\s+[^,]+,\s*'([a-z_]+)'/gi,
  ]
  for (const { nome, sql } of TEXTOS) {
    for (const re of formas) {
      re.lastIndex = 0
      let m
      while ((m = re.exec(sql)) !== null) {
        if (!achadas.has(m[1])) achadas.set(m[1], nome)
      }
    }
  }
  return achadas
}

test('a lista de acoes permitidas da trilha e encontravel no repositorio', () => {
  const lista = listaPermitida()
  assert.ok(lista && lista.length > 0,
    'nao achei o CHECK de vessel_edicoes_acao_check nas migrations')
})

test('⚠️ TODA acao escrita na trilha esta na lista de acoes permitidas', () => {
  const permitidas = new Set(listaPermitida())
  const escritas = acoesEscritas()
  assert.ok(escritas.size > 0, 'nao achei nenhuma escrita na trilha — regex quebrada?')

  const forasDaLei = [...escritas].filter(([acao]) => !permitidas.has(acao))
  assert.deepEqual(forasDaLei, [],
    'estas acoes sao escritas na trilha mas o banco vai RECUSAR (some com a '
    + 'transacao inteira): ' + forasDaLei.map(([a, f]) => `${a} (em ${f})`).join(', '))
})

test('⚠️ a guarda ENXERGA cada acao concreta — senao ela passa por vacuidade', () => {
  /* Duas vezes esta guarda ficou verde sem ver nada: primeiro porque a funcao
   * so morava no banco, depois porque a acao era escrita com `select` e nao com
   * `values`. Listar as acoes uma a uma e o que impede a terceira vez. */
  const vistas = acoesEscritas()
  const permitidas = new Set(listaPermitida())
  for (const acao of ['baixar_garantia', 'lote_excluido', 'peca_excluida',
                      'desmarcar_gravada', 'dono_trocado']) {
    assert.ok(vistas.has(acao), `a guarda NAO ve "${acao}" sendo escrita na trilha`)
    assert.ok(permitidas.has(acao), `"${acao}" nao esta na lista de permitidas`)
  }
})

test('⚠️ a lista so CRESCE — arquivo fora de ordem e pego aqui', () => {
  /* A guarda acima confia em "vale o ultimo arquivo", e isso depende do NOME do
   * arquivo ordenar certo. Em 07/09/2026 duas migrations do mesmo dia
   * inverteram: a mais nova ordenava ANTES, e a lista lida ficou sem a acao
   * recem-criada. Acao so e ACRESCENTADA nesta tabela — nunca removida — entao
   * cada lista tem de conter todas as anteriores. Se um arquivo entrar fora de
   * ordem, isto falha, com nome e tudo. */
  const listas = []
  for (const { nome, sql } of TEXTOS) {
    const i = sql.lastIndexOf('vessel_edicoes_acao_check')
    if (i === -1) continue
    const arr = sql.slice(i).match(/array\s*\[([^\]]+)\]/i)
    if (!arr) continue
    listas.push({ nome, acoes: new Set(arr[1].match(/'([a-z_]+)'/g).map((s) => s.replace(/'/g, ''))) })
  }
  assert.ok(listas.length >= 2, 'preciso de pelo menos duas listas para comparar')
  for (let i = 1; i < listas.length; i++) {
    const antes = listas[i - 1], agora = listas[i]
    const sumiram = [...antes.acoes].filter((a) => !agora.acoes.has(a))
    assert.deepEqual(sumiram, [],
      `${agora.nome} nao tem ${sumiram.join(', ')}, que ${antes.nome} ja tinha — `
      + 'ou a acao foi removida (nao deveria), ou este arquivo esta fora de ordem')
  }
})
