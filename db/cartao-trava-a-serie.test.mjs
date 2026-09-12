import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

/* ⚠️ POR QUE ESTE ARQUIVO EXISTE
 *
 * "Peça presa" é a regra que decide se o número de série de uma peça ainda pode
 * mudar. Ela estava escrita QUATRO vezes, em três funções que moram em
 * migrations diferentes — e somar uma condição em quatro lugares é somar em
 * três e esquecer um. O esquecido não dá erro: ele renumera uma peça que não
 * devia, calado, e o defeito só aparece no papel dentro da bolsa.
 *
 * Já aconteceu: existe no Zoho a pasta "Cartões com EAN - BKP 07-09-2026
 * (numero de serie antigo)" com 620 cartões que deixaram de valer.
 *
 * Desde 11/09/2026 a regra mora em `vessel_peca_presa` e só lá. Este teste
 * falha se alguém redefinir uma das três funções escrevendo a condição de novo
 * à mão — que é como a duplicação volta. */

const PASTA = join(dirname(fileURLToPath(import.meta.url)), 'migrations')
const SQLS = readdirSync(PASTA).filter((n) => n.endsWith('.sql')).sort()

/** O texto da ÚLTIMA migration que define a função — as anteriores foram
 *  substituídas, e conferir contra uma velha daria falso alarme. */
function ultimaDefinicaoDe(nomeDaFuncao) {
  for (const arquivo of [...SQLS].reverse()) {
    const sql = readFileSync(join(PASTA, arquivo), 'utf8')
    const texto = sql.toLowerCase()
    // Procura o `create`, não o nome solto: as migrations terminam com linhas
    // `revoke execute on function public.<nome>(...)`, e um lastIndexOf solto
    // casaria com o REVOKE — devolvendo um pedaço sem corpo nenhum.
    const i = texto.lastIndexOf('create or replace function public.' + nomeDaFuncao)
    if (i === -1) continue
    // Até o `$function$;` ou `$$;` que fecha ESTA função, senão o corpo arrasta
    // as funções seguintes do arquivo e o teste passa pelo motivo errado.
    const resto = sql.slice(i)
    const fim = resto.indexOf('$function$;') !== -1
      ? resto.indexOf('$function$;') + 11
      : (resto.indexOf('$$;', resto.indexOf('as $$') + 5) + 3 || resto.length)
    return { arquivo, corpo: resto.slice(0, fim) }
  }
  return null
}

// As três que decidem se o número pode andar.
const AS_TRES = ['vessel_renumerar_lote', 'vessel_editar_lote', 'vessel_excluir_lote']

test('⚠️ a regra de "peça presa" existe, e devolve o MOTIVO', () => {
  const f = ultimaDefinicaoDe('vessel_peca_presa')
  assert.ok(f, 'nenhuma migration define vessel_peca_presa')
  // Booleano não serve: quem recusa apagar um lote precisa dizer POR QUE,
  // e "3 gravadas" pede um conselho diferente de "2 com cartão impresso".
  assert.match(f.corpo.toLowerCase(), /returns text/,
    'vessel_peca_presa voltou a devolver sim/não — a tela perde o motivo da recusa')
  for (const motivo of ['garantia', 'gravada', 'cartao']) {
    assert.match(f.corpo, new RegExp(`'${motivo}'`),
      `vessel_peca_presa não devolve mais o motivo "${motivo}"`)
  }
})

test('⚠️ as três funções USAM a regra, em vez de reescrevê-la', () => {
  for (const nome of AS_TRES) {
    const f = ultimaDefinicaoDe(nome)
    assert.ok(f, `nenhuma migration define ${nome}`)
    assert.match(f.corpo, /vessel_peca_presa/,
      `${nome} (em ${f.arquivo}) deixou de usar vessel_peca_presa. Se a condição `
      + 'foi reescrita ali dentro, ela vai divergir da das outras duas — e a peça '
      + 'com cartão impresso volta a poder ser renumerada.')
  }
})

test('⚠️ e nenhuma delas escreve a condição à mão de novo', () => {
  for (const nome of AS_TRES) {
    const { arquivo, corpo } = ultimaDefinicaoDe(nome)
    // `gravada_em is not null` dentro destas três é sempre a regra reescrita.
    // (Em `vessel_adotar_etiqueta` a mesma linha é outra coisa: lá ela decide se
    // a etiqueta pode ser adotada, não se o número pode andar.)
    assert.doesNotMatch(corpo.toLowerCase(), /gravada_em is not null/,
      `${nome} (em ${arquivo}) voltou a escrever a condição à mão. `
      + 'Use vessel_peca_presa — ela é o único lugar onde a regra mora.')
  }
})

test('⚠️ a fila de cartões nasce com a trava das irmãs', () => {
  const arquivo = SQLS.filter((n) => readFileSync(join(PASTA, n), 'utf8')
    .includes('create table if not exists public.vessel_cartao_pedidos')).pop()
  assert.ok(arquivo, 'nenhuma migration cria vessel_cartao_pedidos')
  const sql = readFileSync(join(PASTA, arquivo), 'utf8')
  assert.match(sql, /alter table public\.vessel_cartao_pedidos\s+enable row level security/,
    'a tabela subiria sem RLS — já subiu tabela assim nesta casa, e nove revisões passaram batido')
  // ⚠️ `revoke all`, e não uma lista nominal: a lista deixa `references` e
  // `trigger` de pé, e envelhece quando o Postgres inventar a próxima permissão.
  assert.match(sql, /revoke all on table public\.vessel_cartao_pedidos\s+from public, anon, authenticated/,
    'a lista nominal de revoke deixa `references` e `trigger` para anon e authenticated')
})
