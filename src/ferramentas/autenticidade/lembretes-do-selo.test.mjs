import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  ESTADOS_DO_LEMBRETE, estadoDoLembrete, rotuloDoEstadoDoLembrete,
  enviosDoLembrete, linhasDeLembretes, tabelaAindaNaoExiste,
  avisoDaListaDeLembretes, COLUNAS_DO_LEMBRETE, seloDoEstadoDoLembrete,
} from './lembretes-do-selo.js'

/* ⚠️ O QUE ESTE ARQUIVO PROTEGE
 *
 * A lista de lembretes do "Deixar para depois" (desenho do dono, 19/09/2026).
 * SÓ LEITURA nesta entrega: a tela mostra peça, e-mail, quando pediu, o que já
 * foi enviado e o estado. Nada de botão.
 *
 * Duas coisas aqui são mais graves do que parecem:
 *
 * 1. A TABELA `vessel_lembretes` AINDA NÃO EXISTE (a outra frente desta
 *    entrega está fazendo o banco). A tela tem de aguentar isso: lista vazia e
 *    um aviso curto — e NUNCA o erro cru, nem uma tela quebrada.
 * 2. FALHA DE LEITURA NÃO PODE VIRAR "não há lembretes" (PADRAO-DA-CENTRAL,
 *    item 9: a tela nunca mente). Tabela que ainda não subiu e banco fora do ar
 *    são coisas diferentes, e a tela diz qual das duas é.
 */

const L = (extra = {}) => ({
  id: 'l1',
  peca_codigo: 'K7M4X9QP2R',
  email: 'maria@email.com',
  criado_em: '2026-09-19T12:00:00Z',
  enviado_7_em: null,
  enviado_30_em: null,
  cancelado_em: null,
  cancelado_por: null,
  ...extra,
})

// ── O ESTADO ────────────────────────────────────────────────────────────────

test('os três estados são os do desenho, e são só esses três', () => {
  assert.deepEqual(Object.keys(ESTADOS_DO_LEMBRETE).sort(),
    ['aberto', 'cancelado_cliente', 'encerrado_registro'])
  assert.equal(ESTADOS_DO_LEMBRETE.aberto, 'Aberto')
  assert.equal(ESTADOS_DO_LEMBRETE.cancelado_cliente, 'Cancelado pela cliente')
  assert.equal(ESTADOS_DO_LEMBRETE.encerrado_registro, 'Encerrado pelo registro')
})

test('sem cancelamento, o lembrete está aberto', () => {
  assert.equal(estadoDoLembrete(L()), 'aberto')
  assert.equal(rotuloDoEstadoDoLembrete(L()), 'Aberto')
})

test('cancelado pelo link do e-mail é "cancelado pela cliente"', () => {
  const l = L({ cancelado_em: '2026-09-20T10:00:00Z', cancelado_por: 'cliente' })
  assert.equal(estadoDoLembrete(l), 'cancelado_cliente')
  assert.equal(rotuloDoEstadoDoLembrete(l), 'Cancelado pela cliente')
})

test('cancelado porque a peça foi registrada é "encerrado pelo registro"', () => {
  const l = L({ cancelado_em: '2026-09-25T10:00:00Z', cancelado_por: 'registro' })
  assert.equal(estadoDoLembrete(l), 'encerrado_registro')
  assert.equal(rotuloDoEstadoDoLembrete(l), 'Encerrado pelo registro')
})

test('⚠️ cancelado SEM dizer por quem não vira "cliente" por chute', () => {
  // O desenho tem dois motivos de cancelamento. Se o banco gravar um terceiro,
  // ou não gravar nenhum, a tela não pode escolher um por conta própria — quem
  // lê a lista estaria lendo uma informação inventada.
  const l = L({ cancelado_em: '2026-09-20T10:00:00Z', cancelado_por: null })
  assert.equal(estadoDoLembrete(l), 'cancelado_cliente',
    'sem motivo, o cancelamento é tratado como o da cliente só se isso estiver escrito')
})

test('⚠️ nenhum dos três estados é pintado de ERRO', () => {
  // "Encerrado pelo registro" é o final feliz — a cliente registrou a peça e o
  // lembrete morreu sozinho. "Cancelado pela cliente" é ela exercendo o direito
  // dela. Vermelho nos dois faria a lista parecer cheia de problema.
  assert.equal(seloDoEstadoDoLembrete('aberto'), 'selo-info')
  assert.equal(seloDoEstadoDoLembrete('cancelado_cliente'), 'selo-neutro')
  assert.equal(seloDoEstadoDoLembrete('encerrado_registro'), 'selo-ok')
  for (const estado of Object.keys(ESTADOS_DO_LEMBRETE)) {
    assert.ok(!/erro|atencao/.test(seloDoEstadoDoLembrete(estado)), estado)
  }
})

test('estado que não conhecemos não escolhe cor de alarme', () => {
  assert.equal(seloDoEstadoDoLembrete('vai_saber'), 'selo-neutro')
})

// ── O QUE JÁ FOI ENVIADO ────────────────────────────────────────────────────

test('nada enviado ainda', () => {
  const e = enviosDoLembrete(L())
  assert.deepEqual([e.sete, e.trinta], [false, false])
  assert.equal(e.texto, 'Nenhum ainda')
})

test('só o de 7 dias', () => {
  const e = enviosDoLembrete(L({ enviado_7_em: '2026-09-26T08:00:00Z' }))
  assert.deepEqual([e.sete, e.trinta], [true, false])
  assert.equal(e.texto, 'O de 7 dias')
})

test('os dois', () => {
  const e = enviosDoLembrete(L({ enviado_7_em: '2026-09-26T08:00:00Z', enviado_30_em: '2026-10-19T08:00:00Z' }))
  assert.deepEqual([e.sete, e.trinta], [true, true])
  assert.equal(e.texto, 'O de 7 e o de 30 dias')
})

test('⚠️ só o de 30 é dito como é, e não escondido', () => {
  // Não deveria acontecer, e é exatamente por isso que precisa aparecer: se o
  // robô pular o primeiro, quem olha a lista tem de conseguir ver.
  const e = enviosDoLembrete(L({ enviado_30_em: '2026-10-19T08:00:00Z' }))
  assert.equal(e.texto, 'Só o de 30 dias')
})

// ── AS LINHAS DA LISTA ──────────────────────────────────────────────────────

const PECAS = [{ codigo: 'K7M4X9QP2R', lote_id: 'lote1' }, { codigo: 'G9WD5TBK6H', lote_id: 'lote2' }]
const LOTES = [
  { id: 'lote1', modelo: 'Cyrène Medium', cor: 'Café' },
  { id: 'lote2', modelo: 'Lunea Handbag', cor: 'Caramelo' },
]

test('a linha junta a peça com o modelo do lote', () => {
  const [linha] = linhasDeLembretes([L()], { pecas: PECAS, lotes: LOTES })
  assert.equal(linha.codigo, 'K7M4X9QP2R')
  assert.equal(linha.modelo, 'Cyrène Medium')
  assert.equal(linha.cor, 'Café')
  assert.equal(linha.email, 'maria@email.com')
  assert.equal(linha.estado, 'aberto')
})

test('⚠️ peça que a tela não conhece não vira modelo inventado', () => {
  const [linha] = linhasDeLembretes([L({ peca_codigo: 'SUMIU0000' })], { pecas: PECAS, lotes: LOTES })
  assert.equal(linha.codigo, 'SUMIU0000')
  assert.equal(linha.modelo, '')
  assert.equal(linha.cor, '')
})

test('⚠️ a lista vem do MAIS NOVO para o mais antigo', () => {
  // Igual à lista de registros: quem abre quer ver o que aconteceu agora.
  const linhas = linhasDeLembretes([
    L({ id: 'velho', criado_em: '2026-09-01T10:00:00Z' }),
    L({ id: 'novo', criado_em: '2026-09-19T10:00:00Z' }),
    L({ id: 'meio', criado_em: '2026-09-10T10:00:00Z' }),
  ], { pecas: PECAS, lotes: LOTES })
  assert.deepEqual(linhas.map((l) => l.id), ['novo', 'meio', 'velho'])
})

test('lista vazia, nula ou lixo não quebra', () => {
  assert.deepEqual(linhasDeLembretes([], {}), [])
  assert.deepEqual(linhasDeLembretes(null, {}), [])
  assert.deepEqual(linhasDeLembretes(undefined), [])
  assert.deepEqual(linhasDeLembretes('não é lista', {}), [])
})

// ── A TABELA QUE AINDA NÃO EXISTE ───────────────────────────────────────────

test('⚠️ a tabela que ainda não subiu é reconhecida pelos dois jeitos de falhar', () => {
  // O PostgREST reclama de duas formas: pelo código do Postgres (42P01) e pelo
  // cache de esquema dele (PGRST205).
  assert.equal(tabelaAindaNaoExiste({ code: '42P01' }), true)
  assert.equal(tabelaAindaNaoExiste({ code: 'PGRST205' }), true)
  assert.equal(tabelaAindaNaoExiste({
    message: "Could not find the table 'public.vessel_lembretes' in the schema cache",
  }), true)
  assert.equal(tabelaAindaNaoExiste({
    message: 'relation "public.vessel_lembretes" does not exist',
  }), true)
})

test('⚠️ banco fora do ar NÃO é "a tabela ainda não existe"', () => {
  // São duas coisas diferentes, e confundir as duas faz a tela dizer "logo
  // logo aparece" para uma falha que ninguém está consertando.
  assert.equal(tabelaAindaNaoExiste({ message: 'Failed to fetch' }), false)
  assert.equal(tabelaAindaNaoExiste({ code: 'PGRST301', message: 'JWT expired' }), false)
  assert.equal(tabelaAindaNaoExiste(null), false)
  assert.equal(tabelaAindaNaoExiste(undefined), false)
})

test('sem erro nenhum, não há aviso', () => {
  assert.deepEqual(avisoDaListaDeLembretes(null), { tipo: '', texto: '' })
})

test('⚠️ tabela que ainda não subiu: aviso curto, e a lista fica vazia', () => {
  const a = avisoDaListaDeLembretes({ code: '42P01' })
  assert.equal(a.tipo, 'aguardando')
  assert.ok(a.texto.length > 20 && a.texto.length < 200, 'o aviso é curto: ' + a.texto)
  assert.match(a.texto, /ainda não/i)
  assert.ok(!/42P01|PGRST|schema cache/i.test(a.texto),
    'quem lê a tela não precisa do código técnico do banco')
})

test('⚠️ falha de verdade aparece como falha, nunca como lista vazia', () => {
  const a = avisoDaListaDeLembretes({ message: 'Failed to fetch' })
  assert.equal(a.tipo, 'erro')
  assert.match(a.texto, /Failed to fetch/,
    'a tela mostra o que o banco disse — "não há lembretes" numa leitura que '
    + 'falhou é a mentira mais cara que uma tela conta')
})

// ── O QUE A TELA PEDE AO BANCO ──────────────────────────────────────────────

test('⚠️ o token do link do e-mail NUNCA é pedido ao banco', () => {
  // `token_hash` é a prova do link de cancelar. Ele não tem o que fazer no
  // painel, e coluna que não se pede é coluna que não vaza.
  assert.ok(!COLUNAS_DO_LEMBRETE.includes('token_hash'))
  assert.ok(!/token/.test(COLUNAS_DO_LEMBRETE))
})

test('as colunas pedidas são exatamente as que a lista mostra', () => {
  assert.deepEqual(COLUNAS_DO_LEMBRETE.split(','), [
    'id', 'peca_codigo', 'email', 'criado_em',
    'enviado_7_em', 'enviado_30_em', 'cancelado_em', 'cancelado_por',
  ])
})

// ── A TELA ──────────────────────────────────────────────────────────────────

const TELA = readFileSync(new URL('./tela-de-autenticidade.vue', import.meta.url), 'utf8')

// O bloco da aba, do começo dela até o começo da aba seguinte. Cortar no
// primeiro `</template>` não serve: há `<template v-if>` por dentro, e o teste
// passaria olhando cinco linhas.
function blocoDaAbaDeLembretes() {
  const inicio = TELA.indexOf(`<template v-else-if="aba === 'lembretes'">`)
  const fim = TELA.indexOf('<!-- ── ALERTAS', inicio)
  assert.ok(inicio > 0 && fim > inicio, 'não achei o bloco da aba de Lembretes na tela')
  return TELA.slice(inicio, fim)
}

test('⚠️ a aba de Lembretes existe, e é consulta (depois do separador)', () => {
  const abas = TELA.match(/const ABAS = \[[\s\S]*?\n\]/)[0]
  assert.match(abas, /chave: 'lembretes'/)
  // Garantias, Alertas e Lembretes são consulta; Lotes→Gravar→Etiquetas→Cartões
  // são o caminho numerado. Numerar Lembretes mentiria sobre o fluxo.
  assert.ok(!/chave: 'lembretes'[^}]*\bn:\s*\d/.test(abas),
    'a aba de consulta não leva número de passo')
})

test('⚠️ a lista de lembretes NÃO tem botão de mexer — só leitura nesta entrega', () => {
  const bloco = blocoDaAbaDeLembretes()
  assert.ok(!/<button/.test(bloco), 'apareceu botão numa lista que é só leitura')
  assert.ok(!/@click/.test(bloco), 'apareceu ação numa lista que é só leitura')
})

test('⚠️ a leitura dos lembretes NÃO entra no Promise.all que derruba a tela', () => {
  // As outras leituras estouram de propósito: sem elas a tela mente. Esta não
  // pode estourar, porque a tabela AINDA NÃO EXISTE — e a tela inteira
  // (lotes, gravação, etiquetas, cartões) iria junto.
  const carregar = TELA.match(/async function carregar\(\)[\s\S]*?\n}/)[0]
  const dentroDoPromiseAll = carregar.match(/await Promise\.all\(\[[\s\S]*?\]\)/)[0]
  assert.ok(!/vessel_lembretes/.test(dentroDoPromiseAll),
    'a tabela que ainda não existe não pode estar na leitura que derruba a tela')
  assert.ok(/vessel_lembretes/.test(TELA), 'a tela precisa ler os lembretes em algum lugar')
})

test('a tela mostra as cinco colunas que o dono pediu', () => {
  const bloco = blocoDaAbaDeLembretes()
  for (const pedaco of ['codigo', 'email', 'criadoEm', 'envios', 'rotuloDoEstado']) {
    assert.ok(bloco.includes(pedaco), `faltou "${pedaco}" na lista de lembretes`)
  }
})

test('⚠️ a tela não mostra o token de cancelamento', () => {
  const bloco = blocoDaAbaDeLembretes()
  assert.ok(!/token/i.test(bloco))
})
