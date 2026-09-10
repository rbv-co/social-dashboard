import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

/* ⚠️⚠️ TRAVA: DECIDIR O PERÍODO SÓ PELO NÚMERO QUEBRA O INTERVALO ESCOLHIDO.
 *
 * Ao escolher datas na tela, `period` CONTINUA com o valor antigo (0, 1, 7, 30…).
 * Qualquer decisão tomada só por ele trata o intervalo escolhido como se fosse o
 * período anterior.
 *
 * ISTO QUEBROU TRÊS VEZES NO MESMO DIA (09/09/2026), sempre com o dono achando:
 *   1. `_rolante` — o personalizado ganhava barras de ontem e hoje coladas no fim,
 *      e a barra do dia 8 aparecia DUAS VEZES;
 *   2. `ehGraficoDeContexto` — eu criei a função para o caso 1 e escrevi a 2 sem
 *      as datas: o card do personalizado mostrava o dia em vez do intervalo;
 *   3. `isHoje` — "Hoje" selecionado + datas escolhidas recortava a janela do
 *      card em um dia só.
 *
 * O dono, na terceira: "que bosta em velho, tem que ficar pedindo pra vc corrigir
 * as coisas". Ele está certo. Este teste existe para que a quarta não aconteça.
 */

const TELA = readFileSync(new URL('./tela-de-redes-sociais.vue', import.meta.url), 'utf8')

test('⚠️ `isHoje` e `isOntem` olham as datas escolhidas', () => {
  assert.match(TELA, /const ehCustom = !!\(customStart && customEnd\)/)
  assert.match(TELA, /const isHoje = !ehCustom && period === 0/)
  assert.match(TELA, /const isOntem = !ehCustom && period === 1/)
})

test('⚠️ o recorte do card não usa `period === 1` solto', () => {
  // Era `else if (period === 1) { followStart = followEnd = _ontemBRT }`, que com
  // datas escolhidas jogava a janela inteira em cima de ontem.
  assert.ok(!/else if \(period === 1\) \{ followStart = followEnd/.test(TELA))
  assert.match(TELA, /else if \(isOntem\) \{ followStart = followEnd = _ontemBRT \}/)
})

test('⚠️ o número do card decide por `ehGraficoDeContexto`, COM as datas', () => {
  assert.match(TELA, /ehGraficoDeContexto\(period, currentStartDate, currentEndDate\)/)
  assert.ok(!/ehGraficoDeContexto\(period\)/.test(TELA),
    'chamar sem as datas é o defeito de 09/09/2026')
  assert.match(TELA, /const ehRecenteLive = !!d\.live && _ehContexto/)
  assert.match(TELA, /const _somaBarras = _ehContexto \? null : totalPelasBarras\(d\.chart\)/)
})

test('⚠️ o ramo rolante do gráfico decide por `ehRecorteRolante`, COM as datas', () => {
  assert.match(TELA, /ehRecorteRolante\(currentPeriod, currentStartDate, currentEndDate\)/)
  assert.ok(!/const _rolante = \[0, 1, 3, 7, 14, 30\]\.includes/.test(TELA),
    'voltou a decidir só pelo número')
})

test('⚠️ o mês corrente também olha as datas', () => {
  assert.match(TELA, /const isCalMonth = !ehCustom &&/)
  assert.match(TELA, /const _mesAtual = !_ehCustom &&/)
})

/* ⚠️⚠️ O DEFEITO QUE CUSTOU A NOITE: OS CAMPOS DE DATA MENTIAM.
 *
 * O navegador RESTAURA sozinho o valor de um `<input type="date">` ao recarregar,
 * mas o estado da tela voltava para o período guardado (7 dias). Os campos
 * mostravam "05/09 a 09/09" e a tela calculava SETE DIAS por dentro.
 *
 * A faixa de diagnóstico entregou em uma linha o que horas de dedução não
 * entregaram: `recorte: periodo 7 · janela 2026-09-02→2026-09-08` — com os campos
 * de data preenchidos com 05 e 09 na cara do dono.
 *
 * Tudo o que ele apontou naquela noite vinha daqui: gráfico com 8 barras num
 * intervalo de 5, Meta Ads com uma captura só, cards zerados, números que não
 * mudavam ao trocar de período. Cada número que eu conferia batia — com o período
 * ERRADO. E eu conferia o banco e a API em vez de perguntar o que a TELA estava
 * usando.
 */

test('⚠️ o intervalo é guardado, como o período já era', () => {
  assert.match(TELA, /const CHAVE_INTERVALO = 'dash_custom'/)
  assert.match(TELA, /localStorage\.setItem\(CHAVE_INTERVALO, JSON\.stringify\(\{ s, e \}\)\)/)
  assert.match(TELA, /let currentStartDate = _intervaloGuardado \? _intervaloGuardado\.s : null/)
})

test('⚠️ trocar de período e limpar apagam o intervalo guardado', () => {
  // Sem isto, clicar em "7 dias" deixaria o intervalo guardado para trás e a
  // próxima recarga voltaria a ele sem ninguém pedir.
  const usos = TELA.match(/localStorage\.removeItem\(CHAVE_INTERVALO\)/g) || []
  assert.equal(usos.length, 2, 'um ao trocar de período, outro ao limpar')
})

test('⚠️ no carregamento, os campos são ESPELHO do estado', () => {
  assert.match(TELA, /OS CAMPOS DE DATA SÃO ESPELHO DO ESTADO, NUNCA O CONTRÁRIO/)
  // Sem intervalo guardado, os campos são LIMPOS — é o que derruba a restauração
  // automática do navegador, que foi a origem do defeito.
  assert.match(TELA, /_ci\.value = ''; _cf\.value = ''/)
  assert.match(TELA, /_ci\.value = currentStartDate; _cf\.value = currentEndDate/)
})

test('⚠️ o guardado é conferido antes de virar estado', () => {
  // Texto qualquer no localStorage não pode virar janela: data estragada
  // recortaria o período em silêncio.
  assert.match(TELA, /\/\^\\d\{4\}-\\d\{2\}-\\d\{2\}\$\//)
  assert.match(TELA, /v\.s <= v\.e/, 'início depois do fim não é intervalo')
})

/* ⚠️ O QUE ACENDE O BALDE NÃO PODE VIR RECORTADO PELO FILTRO MANUAL.
 *
 * Defeito circular achado pelo dono em 10/09/2026: "tem campanha de lead rodando
 * porém na dash não está aparecendo o botão aceso, eu preciso filtrar manualmente
 * as campanhas, pq?".
 *
 * `_diaRows` já vinha com `&campaign_id=in.(...)` das campanhas escolhidas à mão.
 * Com uma seleção ativa, todos os OUTROS baldes ficavam sem gasto e apagavam — e
 * para acendê-los era preciso filtrar à mão, que é o que os tinha apagado.
 *
 * O balde responde "tem dinheiro NESTE TIPO no período?" — pergunta sobre a conta
 * inteira, nunca sobre o recorte que já está aplicado.
 */

test('⚠️ o balde é aceso pelo período inteiro, não pelo filtro', () => {
  /* O círculo tinha DOIS lados filtrados: as LINHAS de gasto (recortadas na URL) e
   * a LISTA DE IDS de cada balde (recortada por dentro do `idsParaConsulta`).
   * Consertar um só não bastava — com a lista de ids vazia o balde apagava igual. */
  assert.match(TELA, /const baldesVazios = baldesSemGasto\(_idsPorBaldeSemFiltro, _diaRows\)/)
  assert.ok(!/baldesSemGasto\(_idsPorBalde,/.test(TELA),
    'voltou a acender o balde com a lista já filtrada — o círculo volta junto')
  assert.match(TELA, /_idsPorBaldeSemFiltro\[b\.id\] = idsParaConsulta\(_campanhas, b\.id, null\)/,
    'a lista que acende precisa ser montada SEM a seleção')
})

test('⚠️ a leitura dos dias vem SEM filtro, e o recorte é feito na memória', () => {
  /* A mesma leitura acende os baldes e desenha os gráficos. Recortá-la na URL
   * apagaria os outros baldes de novo; não recortar na memória mostraria a conta
   * inteira sob o rótulo de um tipo só. */
  assert.ok(!/impressions\$\{_filtroManual\}/.test(TELA), 'a consulta voltou a ser recortada na URL')
  assert.match(TELA, /_diaRows\.filter\(r => _idsDoRecorteSet\.has\(String\(r\.campaign_id\)\)\)/)
})

test('⚠️ clicar no balde traz as campanhas dele, e SÓ para quem clicou', () => {
  /* `campaign_filters` é POR CONTA, sem coluna de usuário: gravar ali faria um
   * clique trocar o recorte de todo mundo. A escolha automática mora no navegador. */
  assert.match(TELA, /localStorage\.setItem\(_baldeAutoKey\(currentAccountId\), '1'\)/)
  assert.match(TELA, /idsComGastoNoPeriodo\(_idsDoTipo, _diaRows\)/)
  assert.match(TELA, /localStorage\.removeItem\(_baldeAutoKey\(currentAccountId\)\)/,
    'escolher à mão tem de desligar o automático, senão o filtro "volta sozinho"')
})

test('⚠️ vazio por falta de gasto diz outra coisa que vazio por desmarcar', () => {
  assert.match(TELA, /semGastoNoPeriodo: _semGastoNoPeriodo/)
  assert.match(TELA, /\{ semGastoNoPeriodo: !!semGastoNoPeriodo \}/)
})

/* ⚠️ ESCOLHER A DATA NÃO É APLICAR O PERÍODO.
 *
 * Até 10/09/2026 qualquer mudança num dos campos aplicava na hora. Medido no
 * navegador: mudar SÓ a data inicial (05 → 01, com o fim ainda em 09) disparou a
 * tela inteira — quatro consultas — para um período que ninguém pediu (01→09). E
 * ajustar o fim em seguida recarregava tudo de novo.
 *
 * Quem escolhe intervalo mexe nos DOIS campos; aplicar no meio do caminho é sempre
 * uma volta perdida, e ainda mostra números de um período que a pessoa não pediu.
 * O dono: "acho que falta um botãozinho de pesquisar ok confirmar o período".
 */

test('⚠️ mudar a data não dispara carga — quem aplica é o botão', () => {
  assert.match(TELA, /function aplicarIntervalo\(\) \{/)
  assert.match(TELA, /id="custom-apply-btn"[^>]*onclick="aplicarIntervalo\(\)"/)
  // `onCustomDateChange` só prepara o botão: se ela voltar a mexer no estado ou
  // chamar `refresh`, o defeito volta.
  const corpo = TELA.slice(TELA.indexOf('function onCustomDateChange()'))
  const ateOFim = corpo.slice(0, corpo.indexOf('\n}\n') + 3)
  assert.ok(!/refresh\(\)/.test(ateOFim), 'a troca de data voltou a carregar a tela')
  assert.ok(!/currentStartDate =/.test(ateOFim), 'a troca de data voltou a mexer no estado')
})

test('⚠️ o botão é exposto no window, senão o onclick do HTML não acha', () => {
  // Esquecer isto não quebra build nem teste: o botão só não responde.
  assert.match(TELA, /Object\.assign\(window, \{[\s\S]*?\n  aplicarIntervalo,/)
})

test('⚠️ intervalo invertido não aplica, e o motivo fica no botão', () => {
  // Alerta obriga a fechar antes de corrigir e some sem deixar rastro.
  assert.match(TELA, /if \(!s \|\| !e \|\| s > e\) return/)
  assert.match(TELA, /A data inicial tem de vir antes da final/)
  assert.ok(!/alert\('A data inicial deve ser anterior/.test(TELA), 'voltou o alerta')
})

test('Enter nos campos aplica — quem digita a data não precisa mirar o botão', () => {
  const comEnter = TELA.match(/onkeydown="if\(event\.key==='Enter'\)aplicarIntervalo\(\)"/g) || []
  assert.equal(comEnter.length, 2, 'os dois campos precisam do Enter')
})
