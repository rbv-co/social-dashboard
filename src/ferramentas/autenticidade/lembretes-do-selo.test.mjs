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
 * Três coisas aqui são mais graves do que parecem:
 *
 * 1. A TABELA `vessel_lembretes` JÁ ESTÁ NO AR (migration registrada em
 *    21/09/2026), mas a leitura continua defensiva: se um dia a tabela sumir
 *    de algum ambiente, a tela tem de aguentar isso — lista vazia e um aviso
 *    curto, e NUNCA o erro cru, nem uma tela quebrada.
 * 2. FALHA DE LEITURA NÃO PODE VIRAR "não há lembretes" (PADRAO-DA-CENTRAL,
 *    item 9: a tela nunca mente). Tabela que não existe e banco fora do ar
 *    são coisas diferentes, e a tela diz qual das duas é.
 * 3. ⚠️ NULO NÃO É FALSO: `cancelado_em` nulo com `cancelado_por` preenchido
 *    não existe hoje, mas se existir a tela não pode chamar isso de "aberto"
 *    em silêncio — ganhou o quarto estado, "incoerente".
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

test('os três estados são os do desenho, mais o quarto que não é do desenho: o incoerente', () => {
  assert.deepEqual(Object.keys(ESTADOS_DO_LEMBRETE).sort(),
    ['aberto', 'cancelado_cliente', 'encerrado_registro', 'incoerente'])
  assert.equal(ESTADOS_DO_LEMBRETE.aberto, 'Aberto')
  assert.equal(ESTADOS_DO_LEMBRETE.cancelado_cliente, 'Cancelado pela cliente')
  assert.equal(ESTADOS_DO_LEMBRETE.encerrado_registro, 'Encerrado pelo registro')
  assert.equal(ESTADOS_DO_LEMBRETE.incoerente, 'Estado incoerente')
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

// ⚠️ NULO NÃO É FALSO. `cancelado_em` nulo com `cancelado_por` preenchido não
// existe hoje, mas se existir a tela não pode chamar isso de "aberto" em
// silêncio — é o próprio pedido do dono, quase palavra por palavra.
test('⚠️ estado incoerente (cancelado_por preenchido sem cancelado_em) não vira "aberto" calado', () => {
  const r = estadoDoLembrete({ cancelado_em: null, cancelado_por: 'cliente' })
  assert.notEqual(r, 'aberto')
  assert.equal(r, 'incoerente')
  assert.equal(rotuloDoEstadoDoLembrete({ cancelado_em: null, cancelado_por: 'registro' }),
    'Estado incoerente')
})

test('⚠️ nenhum dos TRÊS estados do desenho é pintado de ERRO ou de ALARME', () => {
  // "Encerrado pelo registro" é o final feliz — a cliente registrou a peça e o
  // lembrete morreu sozinho. "Cancelado pela cliente" é ela exercendo o direito
  // dela. Vermelho ou laranja em qualquer um dos dois faria a lista parecer
  // cheia de problema. O QUARTO estado ("incoerente") é a exceção de propósito
  // — ver o teste seguinte — por isso fica de fora deste laço.
  assert.equal(seloDoEstadoDoLembrete('aberto'), 'selo-info')
  assert.equal(seloDoEstadoDoLembrete('cancelado_cliente'), 'selo-neutro')
  assert.equal(seloDoEstadoDoLembrete('encerrado_registro'), 'selo-ok')
  for (const estado of Object.keys(ESTADOS_DO_LEMBRETE).filter((e) => e !== 'incoerente')) {
    assert.ok(!/erro|atencao/.test(seloDoEstadoDoLembrete(estado)), estado)
  }
})

test('⚠️ o estado incoerente É a exceção: leva a cor de alarme, de propósito', () => {
  // Dar cor neutra ou de sucesso a uma linha incoerente esconderia exatamente
  // o que a tela precisa mostrar: que aquele dado não bate com o desenho.
  assert.equal(seloDoEstadoDoLembrete('incoerente'), 'selo-atencao')
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

// ⚠️ A TABELA ESTÁ NO AR DESDE 21/09/2026. Se este ramo disparar hoje, é
// porque algo QUEBROU — não porque a tabela está "a caminho". O texto
// mudou de "assim que a parte do banco subir" (fazia sentido antes) para
// "isso não é esperado" (a verdade de hoje) — este teste prova a mensagem
// NOVA, e reprova qualquer redação que volte a soar como "logo chega".
test('⚠️ tabela ausente: o aviso diz que é INESPERADO, não que "está a caminho"', () => {
  const a = avisoDaListaDeLembretes({ code: '42P01' })
  assert.equal(a.tipo, 'aguardando')
  assert.ok(a.texto.length > 20 && a.texto.length < 200, 'o aviso é curto: ' + a.texto)
  assert.match(a.texto, /não é esperado|não deveria|quebrou|avise/i,
    'o texto precisa soar como "algo quebrou", não como "funcionalidade pendente"')
  assert.ok(!/ainda não existem|assim que a parte do banco subir|logo (aparece|chega)/i.test(a.texto),
    'o texto NÃO pode mais soar como "coming soon" — a tabela já está no ar')
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

// ⚠️ ESTRUTURAL, NÃO POR PALAVRA. A primeira versão desta guarda procurava só
// `<button` e `@click` — e um `<Button @dblclick="cancelarLembrete(lb.id)">`
// PASSOU direto por ela (confirmado por mutação real: 29/29 verdes com o botão
// disfarçado lá dentro). Duas fugas cabiam nela: (1) qualquer evento que não
// se chame "click" — `@dblclick`, `@keyup.enter`, `v-on:submit`, `onclick=`
// cru — e (2) um COMPONENTE Vue (`<Button>`, tag em PascalCase pela convenção
// deste projeto) escondendo um `<button>` de verdade dentro dele. A prova
// fica embaixo, no teste de mutação real.
test('⚠️ a lista de lembretes NÃO tem botão nem ação de mexer — só leitura nesta entrega', () => {
  const bloco = blocoDaAbaDeLembretes()
  // Nenhum jeito de amarrar evento do Vue: `@algumacoisa`, `v-on:algumacoisa`,
  // ou o `onclick=`/`onsubmit=`/... cru do DOM.
  assert.ok(!/@[a-z]/i.test(bloco), 'apareceu um binding de evento (@...) numa lista que é só leitura: ' + bloco)
  assert.ok(!/v-on:/i.test(bloco), 'apareceu v-on: numa lista que é só leitura: ' + bloco)
  assert.ok(!/\bon[a-z]+\s*=/i.test(bloco), 'apareceu um "on..." (evento cru do DOM) numa lista que é só leitura: ' + bloco)
  // Nenhuma tag pode ser <button>, em qualquer combinação de maiúscula/minúscula.
  assert.ok(!/<\/?button/i.test(bloco), 'apareceu <button> (ou variação de caixa) numa lista só leitura')
  // Nenhum COMPONENTE (tag em PascalCase — a convenção deste projeto para
  // componente Vue, como <BarraDeTopo> e <PainelDeBusca>) pode aparecer dentro
  // da linha: só elementos nativos (div, span, p, template). Um componente
  // escondido passaria pelas checagens de cima sem ser pego.
  const tagsDeAbertura = bloco.match(/<([A-Za-z][A-Za-z0-9-]*)[\s/>]/g) || []
  for (const tag of tagsDeAbertura) {
    const nome = tag.slice(1).replace(/[\s/>]$/, '')
    assert.ok(/^[a-z]/.test(nome),
      `apareceu a tag <${nome}> (nome em maiúscula = componente Vue) dentro da lista de lembretes — ` +
      'só leitura não monta componente nenhum')
  }
})

// ⚠️ ESTRUTURAL, NÃO POR PALAVRA. A primeira versão procurava a palavra
// "vessel_lembretes" dentro do Promise.all — e um
// `const TABELA_LEMB = 'vessel_' + 'lembretes'; sbClient.from(TABELA_LEMB)`
// dentro do Promise.all PASSOU direto por ela (confirmado por mutação real:
// 29/29 verdes com a leitura fatal disfarçada lá dentro). Uma variável, um
// alias ou uma concatenação escapam de uma busca por texto. A prova certa é
// o INVERSO: a LISTA FECHADA de leituras que têm permissão de estar aqui —
// nada além dela, seja qual for o nome usado para chegar lá.
test('⚠️ a leitura dos lembretes NÃO entra no Promise.all que derruba a tela', () => {
  // As outras leituras estouram de propósito: sem elas a tela mente. Esta não
  // pode estourar, junto com elas, porque uma falha nos lembretes não pode
  // derrubar lotes, gravação, etiquetas e cartões.
  const carregar = TELA.match(/async function carregar\(\)[\s\S]*?\n}/)[0]
  const dentroDoPromiseAll = carregar.match(/await Promise\.all\(\[[\s\S]*?\]\)/)[0]

  const FROM_PERMITIDOS = ["'vessel_lotes'", "'vessel_pecas'", "'vessel_registros'", "'vessel_baixas'"]
  const RPC_PERMITIDOS = ["'vessel_alertas'", "'vessel_fila_de_registros'"]

  const chamadasDeFrom = [...dentroDoPromiseAll.matchAll(/\.from\(([^)]*)\)/g)].map((m) => m[1].trim())
  const chamadasDeRpc = [...dentroDoPromiseAll.matchAll(/\.rpc\(([^,)]*)/g)].map((m) => m[1].trim())

  assert.equal(chamadasDeFrom.length, 4, 'o Promise.all precisa ter exatamente as quatro leituras de tabela conhecidas')
  assert.equal(chamadasDeRpc.length, 2, 'o Promise.all precisa ter exatamente as duas chamadas de função conhecidas')
  for (const chamada of chamadasDeFrom) {
    assert.ok(FROM_PERMITIDOS.includes(chamada),
      `achei ".from(${chamada})" dentro do Promise.all, fora da lista fechada dos quatro permitidos — ` +
      'se for vessel_lembretes disfarçado (variável, alias, concatenação), ele NÃO pode estar aqui: ' +
      'falha aqui derruba a tela inteira')
  }
  for (const chamada of chamadasDeRpc) {
    assert.ok(RPC_PERMITIDOS.includes(chamada),
      `achei ".rpc(${chamada}" dentro do Promise.all, fora da lista fechada das duas permitidas`)
  }
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

// ── A GUARDA SOBRE O ARQUIVO INTEIRO ────────────────────────────────────────
//
// ⚠️ AS DUAS GUARDAS DE CIMA SÓ ENXERGAM UM PEDAÇO DO ARQUIVO — o bloco da aba
// (`blocoDaAbaDeLembretes`) e o array de dentro do `Promise.all`. Uma escrita
// IMPERATIVA fora dos dois — em `onMounted`, num `watch`, atrás de uma
// `ref` de template — é invisível para as duas. Confirmado por mutação real,
// no estilo idiomático que o próprio arquivo já usa para
// `window.addEventListener('message', ouvirAPrevia)`:
//
//   document.querySelector('.au-tabela-lembretes')
//     ?.addEventListener('click', () => { sbClient.from('vessel_lembretes').delete().eq('id', '1') })
//
// As duas guardas de cima continuaram 29/29 verdes com isso dentro do
// `onMounted`. Uma guarda que só olha metade do arquivo não guarda o arquivo.
//
// A resposta não é enumerar mais um ataque (a lista já tem cinco: portão
// aninhado errado, campo renomeado, `<Button @dblclick>`, nome de tabela por
// concatenação, e agora um ouvinte imperativo — enumerar perde por definição).
// A resposta é NEGAR POR PADRÃO sobre o ARQUIVO INTEIRO:
//
// 1. `.from(...)` e `.rpc(...)`, em QUALQUER lugar do arquivo, só podem
//    receber uma STRING LITERAL como argumento — nunca uma variável, nunca uma
//    expressão. Isso fecha de vez a fuga por indireção (a variável
//    `TABELA_LEMB = 'vessel_' + 'lembretes'` do ataque anterior), sem precisar
//    avaliar concatenação: uma variável não é mais aceita, ponto, veio de onde
//    vier o valor dela.
// 2. De todo `.from('vessel_lembretes')` do arquivo, a única continuação
//    aceita é `.select(` — nunca `.delete(`, `.update(` ou `.insert(`.
// 3. Nenhuma chamada `.rpc(...)` pode nomear algo que comece com
//    `vessel_lembrete` — nenhuma das funções de escrita do desenho
//    (`vessel_lembrete_criar`, `vessel_lembrete_cancelar_por_token`,
//    `vessel_lembrete_marcar_enviado`) tem por que ser chamada por este painel;
//    elas são `service_role`, chamadas pela edge, nunca daqui.
// 4. `addEventListener` só pode existir numa forma: `window.addEventListener`
//    para o evento `'message'` — a única entrada imperativa que o arquivo já
//    usa, e por um motivo documentado (a prévia do cartão). Qualquer outro
//    receptor (um `querySelector`, uma `ref` de template, um elemento
//    guardado em variável) ou qualquer outro evento reprova. Isto pega o
//    ataque de cima e qualquer variação dele (outro evento, outro elemento),
//    sem precisar saber o nome da classe CSS visada.
// 5. Nenhuma atribuição de `.onclick =` cru em lugar nenhum do arquivo — o
//    código de hoje não usa essa forma nenhuma vez; se aparecer, é um jeito a
//    mais de amarrar clique sem passar pelas guardas de template.
test('⚠️⚠️ NEGAR POR PADRÃO: nenhuma escrita imperativa alcança vessel_lembretes, em NENHUM lugar do arquivo — não só no bloco da aba', () => {
  // 1 e 2 — .from(...) só com string literal, e só .select( depois de
  // .from('vessel_lembretes').
  const chamadasDeFrom = [...TELA.matchAll(/\.from\(\s*([^)]*)\)([\s\S]{0,40})/g)]
  assert.ok(chamadasDeFrom.length > 0, 'não achei nenhum .from( no arquivo — a extração quebrou')
  for (const [trecho, argumentoCru, depois] of chamadasDeFrom) {
    const argumento = argumentoCru.trim()
    assert.match(argumento, /^(['"])[^'"]*\1$/,
      `achei ".from(${argumento})" com argumento que NÃO é uma string literal — nenhuma indireção é ` +
      `permitida em .from(...) neste arquivo, seja qual for o nome da variável: ${trecho}`)
    if (argumento.replace(/['"]/g, '') === 'vessel_lembretes') {
      const proximaChamada = depois.match(/^\s*\.([a-zA-Z]+)\(/)
      assert.ok(proximaChamada, `.from('vessel_lembretes') sem nenhuma chamada encadeada logo depois: ${depois}`)
      assert.equal(proximaChamada[1], 'select',
        `.from('vessel_lembretes') encadeado com ".${proximaChamada[1]}(", e a única continuação ` +
        'permitida é ".select(" — qualquer escrita nesta tabela, deste painel, é proibida')
    }
  }

  // 3 — nenhuma .rpc(...) de escrita dos lembretes, em lugar nenhum.
  const chamadasDeRpcNoArquivo = [...TELA.matchAll(/\.rpc\(\s*([^,)]*)/g)]
  for (const [, argumentoCru] of chamadasDeRpcNoArquivo) {
    const argumento = argumentoCru.trim()
    assert.match(argumento, /^(['"])[^'"]*\1$/,
      `achei ".rpc(${argumento}" com argumento que NÃO é uma string literal — mesma regra do .from(...)`)
    const nome = argumento.replace(/['"]/g, '')
    assert.ok(!nome.startsWith('vessel_lembrete'),
      `achei uma chamada a ".rpc('${nome}')" — nenhuma função de "vessel_lembrete*" pode ser chamada ` +
      'deste painel: as três de escrita do desenho são service_role, só a edge chama')
  }

  // 4 — addEventListener só na forma exata já documentada no arquivo.
  const chamadasDeEvento = [...TELA.matchAll(/([\s\S]{0,80}?)\??\.addEventListener\(\s*(['"][^'"]+['"])/g)]
  assert.ok(chamadasDeEvento.length > 0, 'não achei nenhum addEventListener — a extração quebrou')
  for (const [, receptorCru, eventoCru] of chamadasDeEvento) {
    const receptor = receptorCru.replace(/\s+$/, '')
    const evento = eventoCru.replace(/['"]/g, '')
    assert.match(receptor, /\bwindow$/,
      `achei um addEventListener cujo receptor NÃO é "window" (é "...${receptor.slice(-40)}") — a única ` +
      'entrada imperativa permitida neste arquivo é window.addEventListener; qualquer outro receptor ' +
      '(querySelector, ref de template, elemento em variável) é uma porta que os dois testes de cima não veem'
    )
    assert.equal(evento, 'message',
      `achei window.addEventListener para o evento "${evento}", e o único documentado é "message"`)
  }

  // 5 — nenhum onclick cru.
  assert.ok(!/\.onclick\s*=/.test(TELA), 'achei uma atribuição de ".onclick =" — este arquivo não usa essa forma')

  // 6 — nenhum acesso por COLCHETE a sbClient, e nenhum dos primitivos de
  // ofuscação de string mais comuns. ⚠️ ISTO NÃO FECHA A CLASSE — é uma
  // mitigação PARCIAL, e está escrita assim de propósito no relatório: um
  // ataque real por mutação (`sbClient['from'](...)['delete'](...)` com o
  // nome do evento montado por `String.fromCharCode`) driblou as regras 1-5
  // (elas procuram `.from(`, `.rpc(`, `.addEventListener(` — texto com PONTO
  // antes do nome; colchete não bate com nenhuma). Bloquear estes quatro
  // primitivos (nenhum tem uso legítimo hoje neste arquivo) fecha ESTE
  // disfarce específico, não a classe inteira: um parser de texto não prova
  // ausência de código dinâmico em JavaScript — só um parser de AST prova.
  assert.ok(!/sbClient\s*\[/.test(TELA),
    'achei "sbClient[" — acesso por colchete ao cliente do banco não tem uso legítimo aqui; ' +
    'é a forma mais simples de escapar de ".from(" e ".rpc(" no texto')
  assert.ok(!/String\.fromCharCode\(|\batob\(|\bunescape\(|\beval\(|new Function\(/.test(TELA),
    'achei um primitivo de ofuscação de string/código (fromCharCode/atob/unescape/eval/Function) — ' +
    'nenhum tem uso legítimo neste arquivo')
})
