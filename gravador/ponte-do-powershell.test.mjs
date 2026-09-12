import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import {
  criarPonteDoPowershell,
  SCRIPT_DA_PONTE,
  traduzirCodigoDoPcsc,
} from './ponte-do-powershell.js'

// ── UM PROCESSO DE MENTIRA ─────────────────────────────────────────────────
// O `powershell.exe` só existe no Windows da bancada. Injetando um processo de
// mentira, o teste consegue produzir de propósito o que ninguém consegue
// produzir de propósito na mesa: a resposta que chega partida em dois pedaços,
// o processo que morre no meio, a resposta que nunca chega, e o lixo que o
// console cospe antes da resposta.
//
// A FORMA É A DO `child_process` DE VERDADE: EventEmitter no processo e no
// stdout, `stdin.write`, evento 'exit' com (código, sinal). Uma de mentira com
// forma inventada deixaria a suíte verde em cima de uma resposta que a vida
// real nunca devolve.
function processoDeMentira() {
  const p = new EventEmitter()
  p.stdout = new EventEmitter()
  p.stderr = new EventEmitter()
  p.stdout.setEncoding = () => {}
  p.stderr.setEncoding = () => {}
  p.escrito = []
  p.vivo = true
  p.stdin = {
    write(texto) { p.escrito.push(texto); return true },
    end() {},
    on() {},
  }
  p.kill = () => { p.morrer(null, 'SIGTERM') }
  p.responder = (texto) => p.stdout.emit('data', texto)
  p.reclamar = (texto) => p.stderr.emit('data', texto)
  p.morrer = (codigo, sinal = null) => { p.vivo = false; p.emit('exit', codigo, sinal) }
  // o que o JS mandou, sem o número de sequência
  p.comandos = () => p.escrito.map((l) => l.trim().split(' ').slice(1).join(' '))
  p.sequencias = () => p.escrito.map((l) => Number(l.trim().split(' ')[0]))
  return p
}

// Relógio de mentira: nada de esperar de verdade, e nada de teste que treme
// numa máquina carregada.
function relogioDeMentira() {
  const marcados = []
  return {
    agendar(fn, ms) { const t = { fn, ms, vivo: true }; marcados.push(t); return t },
    cancelar(t) { if (t) t.vivo = false },
    estourarTudo() { for (const t of marcados) if (t.vivo) { t.vivo = false; t.fn() } },
    quantos: () => marcados.filter((t) => t.vivo).length,
  }
}

function montar({ relogio = relogioDeMentira() } = {}) {
  const processo = processoDeMentira()
  const ponte = criarPonteDoPowershell({
    abrirProcesso: () => processo,
    relogio,
    tempoLimite: 8000,
  })
  return { ponte, processo, relogio }
}

// Responde ao ÚLTIMO comando que o JS mandou, no formato do protocolo.
function responderAoUltimo(processo, tipo, hex = '') {
  const n = processo.sequencias().at(-1)
  processo.responder(`#${n} ${tipo} ${hex}\r\n`)
}

const hexDe = (texto) => Buffer.from(texto, 'utf8').toString('hex').toUpperCase()

// ── O PROTOCOLO ────────────────────────────────────────────────────────────

test('cada comando sai numa linha só, com número de sequência na frente', async () => {
  const { ponte, processo } = montar()
  const promessa = ponte.listarLeitores()
  assert.equal(processo.escrito.length, 1)
  assert.match(processo.escrito[0], /^\d+ LEITORES\s*\n$/)
  responderAoUltimo(processo, 'OK', hexDe('ACS ACR122U PICC Interface 00 00'))
  assert.deepEqual(await promessa, ['ACS ACR122U PICC Interface 00 00'])
})

test('o APDU atravessa a ponte em hexadecimal, sem espaço', async () => {
  const { ponte, processo } = montar()
  const promessa = ponte.transmitir([0xff, 0xb0, 0x00, 0x03, 0x04])
  assert.match(processo.escrito.at(-1), /^\d+ APDU FFB0000304\s*\n$/)
  responderAoUltimo(processo, 'OK', 'E1101200 9000'.replace(' ', ''))
  assert.deepEqual(await promessa, [0xe1, 0x10, 0x12, 0x00, 0x90, 0x00])
})

test('o nome do leitor também vai em hexadecimal: nome com espaço não quebra a linha', async () => {
  const { ponte, processo } = montar()
  const promessa = ponte.conectar('ACS ACR122U PICC Interface 00 00')
  assert.match(processo.escrito.at(-1), new RegExp(`^\\d+ CONECTAR ${hexDe('ACS ACR122U PICC Interface 00 00')}\\s*\\n$`))
  responderAoUltimo(processo, 'OK')
  await promessa
})

test('vários leitores voltam separados por quebra de linha', async () => {
  const { ponte, processo } = montar()
  const promessa = ponte.listarLeitores()
  responderAoUltimo(processo, 'OK', hexDe('Leitor A\nACS ACR122U PICC Interface 00 00'))
  assert.deepEqual(await promessa, ['Leitor A', 'ACS ACR122U PICC Interface 00 00'])
})

test('lista vazia é lista vazia, não erro', async () => {
  const { ponte, processo } = montar()
  const promessa = ponte.listarLeitores()
  responderAoUltimo(processo, 'OK', '')
  assert.deepEqual(await promessa, [])
})

// ⚠️ A RESPOSTA CHEGA PARTIDA. O stdout de um processo não respeita linha: uma
// resposta de 40 bytes pode chegar em três pedaços, e o fim da linha pode vir no
// pedaço seguinte. Montar a resposta em cima de um pedaço solto é ler meia
// memória de etiqueta — e meia memória vira "etiqueta em branco".
test('resposta partida em dois pedaços é remontada antes de ser lida', async () => {
  const { ponte, processo } = montar()
  const promessa = ponte.transmitir([0xff, 0xca, 0x00, 0x00, 0x00])
  const n = processo.sequencias().at(-1)
  processo.responder(`#${n} OK 04A23B`)
  processo.responder('7A1122339')
  processo.responder('000\r\n')
  assert.deepEqual(await promessa, [0x04, 0xa2, 0x3b, 0x7a, 0x11, 0x22, 0x33, 0x90, 0x00])
})

test('resposta partida byte a byte também é remontada', async () => {
  const { ponte, processo } = montar()
  const promessa = ponte.transmitir([0xff, 0x00, 0x48, 0x00, 0x00])
  const n = processo.sequencias().at(-1)
  for (const letra of `#${n} OK 9000\r\n`) processo.responder(letra)
  assert.deepEqual(await promessa, [0x90, 0x00])
})

test('resposta que chega como Buffer, e não como texto, também é lida', async () => {
  const { ponte, processo } = montar()
  const promessa = ponte.transmitir([0xff, 0xca, 0x00, 0x00, 0x00])
  const n = processo.sequencias().at(-1)
  processo.responder(Buffer.from(`#${n} OK 9000\n`, 'utf8'))
  assert.deepEqual(await promessa, [0x90, 0x00])
})

// ⚠️ O CONSOLE COSPE LIXO. Aviso do PowerShell, prompt `PS C:\>`, linha em
// branco. Linha que não é do protocolo se joga fora — mas nunca em silêncio:
// ela fica guardada para aparecer no recado quando algo der errado.
test('lixo antes da resposta é ignorado, e a resposta certa ainda é lida', async () => {
  const { ponte, processo } = montar()
  const promessa = ponte.transmitir([0xff, 0xca, 0x00, 0x00, 0x00])
  const n = processo.sequencias().at(-1)
  processo.responder('PS C:\\Users\\bancada> \r\n')
  processo.responder('AVISO: alguma coisa\r\n')
  processo.responder('\r\n')
  processo.responder(`#${n} OK 049000\r\n`)
  assert.deepEqual(await promessa, [0x04, 0x90, 0x00])
})

// ⚠️ RESPOSTA ATRASADA DE UM COMANDO ANTIGO NÃO PODE SER LIDA COMO A DESTE. É
// por isso que cada comando leva número: sem ele, a resposta da leitura da
// página 4 poderia ser aceita como a da página 20, e a memória sairia
// embaralhada — que é exatamente a leitura torta que autoriza gravar por cima.
test('resposta com número de outro comando é ignorada', async () => {
  const { ponte, processo, relogio } = montar()
  const promessa = ponte.transmitir([0xff, 0xca, 0x00, 0x00, 0x00])
  const n = processo.sequencias().at(-1)
  processo.responder(`#${n - 1} OK AAAA9000\r\n`)  // do comando anterior
  processo.responder(`#${n + 5} OK BBBB9000\r\n`)  // de um que nem existe
  relogio.estourarTudo()
  await assert.rejects(() => promessa, /tempo|resposta/i)
})

test('duas respostas na mesma leva são separadas certo', async () => {
  const { ponte, processo } = montar()
  const a = ponte.transmitir([0x01])
  const b = ponte.transmitir([0x02])
  const [n1, n2] = processo.sequencias()
  processo.responder(`#${n1} OK 119000\r\n#${n2} OK 229000\r\n`)
  assert.deepEqual(await a, [0x11, 0x90, 0x00])
  assert.deepEqual(await b, [0x22, 0x90, 0x00])
})

// ── FALHAR FECHADA ─────────────────────────────────────────────────────────
// ⚠️ NENHUMA FALHA PODE VIRAR "LI E NÃO TINHA NADA". Toda falha desta ponte
// estoura; nenhuma devolve lista vazia de bytes. Vazio é a resposta que
// autoriza gravar por cima de uma bolsa que já tem dono.

test('ERRO do outro lado vira exceção, nunca resposta vazia', async () => {
  const { ponte, processo } = montar()
  const promessa = ponte.transmitir([0xff, 0xca, 0x00, 0x00, 0x00])
  responderAoUltimo(processo, 'ERRO', hexDe('SCardTransmit falhou (0x80100069)'))
  await assert.rejects(() => promessa, /0x80100069|saiu/i)
})

test('resposta que nunca chega estoura por tempo, e não fica pendurada', async () => {
  const { ponte, processo, relogio } = montar()
  const promessa = ponte.transmitir([0xff, 0xca, 0x00, 0x00, 0x00])
  assert.equal(relogio.quantos(), 1, 'não marcou tempo nenhum para a resposta')
  relogio.estourarTudo()
  await assert.rejects(() => promessa, /tempo/i)
  assert.equal(processo.escrito.length, 1)
})

test('o relógio é desmarcado quando a resposta chega — nada de tempo pendurado', async () => {
  const { ponte, processo, relogio } = montar()
  const promessa = ponte.transmitir([0x01])
  responderAoUltimo(processo, 'OK', '9000')
  await promessa
  assert.equal(relogio.quantos(), 0, 'ficou um relógio pendurado')
})

test('processo que morre no meio derruba o comando pendente, com o motivo', async () => {
  const { ponte, processo } = montar()
  const promessa = ponte.transmitir([0xff, 0xca, 0x00, 0x00, 0x00])
  processo.reclamar('Add-Type : erro de compilação\r\n')
  processo.morrer(1)
  await assert.rejects(() => promessa, (e) => {
    assert.match(e.message, /fechou|morreu|encerrou/i)
    assert.match(e.message, /compila/i, 'o recado do stderr sumiu')
    return true
  })
})

test('processo que morre derruba TODOS os comandos pendentes, não só o primeiro', async () => {
  const { ponte, processo } = montar()
  const a = ponte.transmitir([0x01])
  const b = ponte.transmitir([0x02])
  processo.morrer(1)
  await assert.rejects(() => a, /fechou|morreu|encerrou/i)
  await assert.rejects(() => b, /fechou|morreu|encerrou/i)
})

test('depois de o processo morrer, comando novo é recusado na hora', async () => {
  const { ponte, processo } = montar()
  processo.morrer(1)
  await assert.rejects(() => ponte.transmitir([0x01]), /fechou|morreu|encerrou/i)
})

test('resposta com hexadecimal estragado é falha, não meia leitura', async () => {
  for (const ruim of ['ZZZZ', 'ABC', '90 00']) {
    const { ponte, processo } = montar()
    const promessa = ponte.transmitir([0x01])
    responderAoUltimo(processo, 'OK', ruim)
    await assert.rejects(() => promessa, /resposta|hexadecimal/i, `"${ruim}" passou, e não podia`)
  }
})

// ── ABRIR E FECHAR ─────────────────────────────────────────────────────────

test('iniciar prova que o outro lado está vivo antes de qualquer coisa', async () => {
  const { ponte, processo } = montar()
  const promessa = ponte.iniciar()
  assert.match(processo.escrito[0], /^\d+ PING\s*\n$/)
  responderAoUltimo(processo, 'OK', hexDe('pronto'))
  await promessa
})

test('iniciar que não recebe resposta diz que o PowerShell não respondeu', async () => {
  const { ponte, relogio } = montar()
  const promessa = ponte.iniciar()
  relogio.estourarTudo()
  await assert.rejects(() => promessa, /PowerShell/i)
})

test('fechar manda SAIR e não deixa comando pendurado', async () => {
  const { ponte, processo } = montar()
  await ponte.fechar()
  assert.ok(processo.comandos().includes('SAIR'), 'não mandou SAIR')
})

test('fechar duas vezes não estoura', async () => {
  const { ponte } = montar()
  await ponte.fechar()
  await ponte.fechar()
})

test('desconectar manda DESCONECTAR', async () => {
  const { ponte, processo } = montar()
  const promessa = ponte.desconectar()
  assert.match(processo.escrito.at(-1), /^\d+ DESCONECTAR\s*\n$/)
  responderAoUltimo(processo, 'OK')
  await promessa
})

// ── OS CÓDIGOS DO PC/SC ────────────────────────────────────────────────────

test('os códigos que importam na bancada viram frase de gente', () => {
  assert.match(traduzirCodigoDoPcsc('0x8010001D'), /Cart[ãa]o Inteligente/i)
  assert.match(traduzirCodigoDoPcsc('0x8010002E'), /USB|leitor/i)
  assert.match(traduzirCodigoDoPcsc('0x8010000B'), /outro programa/i)
  assert.match(traduzirCodigoDoPcsc('0x80100069'), /saiu/i)
  assert.match(traduzirCodigoDoPcsc('0x8010000C'), /encoste|etiqueta/i)
})

test('código desconhecido não vira frase confiante: sai com o número', () => {
  const frase = traduzirCodigoDoPcsc('0x80100099')
  assert.match(frase, /0x80100099/i)
})

test('nenhuma frase de problema do LEITOR manda trocar a etiqueta', () => {
  for (const codigo of ['0x8010001D', '0x8010002E', '0x8010000B']) {
    assert.doesNotMatch(traduzirCodigoDoPcsc(codigo), /troque a etiqueta/i,
      `${codigo} manda jogar fora etiqueta boa`)
  }
})

// ── O SCRIPT DO POWERSHELL ─────────────────────────────────────────────────
// ⚠️ AS ARMADILHAS MEDIDAS À MÃO NO WINDOWS DO DONO, EM 01/09/2026. Cada uma
// travou o console de verdade. Este teste é o que impede que voltem numa
// edição distraída — não dá para prová-las daqui, mas dá para provar que o
// script continua escrito do jeito que passou.

test('nada de bloco @" "@: ele TRAVA o console esperando o fim', () => {
  assert.doesNotMatch(SCRIPT_DA_PONTE, /@"/, 'voltou o bloco de texto que trava o console')
  assert.doesNotMatch(SCRIPT_DA_PONTE, /"@/)
})

test('o Add-Type vem numa linha só, com aspas simples', () => {
  const linha = SCRIPT_DA_PONTE.split('\n').find((l) => l.includes('Add-Type'))
  assert.ok(linha, 'sumiu o Add-Type')
  assert.match(linha, /Add-Type -TypeDefinition '/)
})

test('o Add-Type é protegido: rodar duas vezes no mesmo processo mata o tipo repetido', () => {
  assert.match(SCRIPT_DA_PONTE, /if \(-not \("[A-Za-z]+" -as \[type\]\)\)/)
})

test('a struct é declarada FORA da classe: aninhada, ela confunde o New-Object', () => {
  const structEm = SCRIPT_DA_PONTE.indexOf('public struct')
  const classeEm = SCRIPT_DA_PONTE.indexOf('public class')
  assert.ok(structEm > 0 && classeEm > 0, 'sumiu a struct ou a classe')
  assert.ok(structEm < classeEm, 'a struct foi parar dentro da classe')
  assert.match(SCRIPT_DA_PONTE, /\[SCardIO\]::new\(\)/)
})

test('nada de $_ : já chegou mutilado como $ no que se gera dinamicamente', () => {
  assert.doesNotMatch(SCRIPT_DA_PONTE, /\$_/, 'voltou o $_ que chega mutilado')
})

test('usa BitConverter e o Split por caractere nulo, como foi provado', () => {
  assert.match(SCRIPT_DA_PONTE, /\[BitConverter\]::ToString/)
  assert.match(SCRIPT_DA_PONTE, /\[char\]0/)
  assert.match(SCRIPT_DA_PONTE, /RemoveEmptyEntries/)
})

test('o script fala winscard.dll e nenhuma outra biblioteca', () => {
  assert.match(SCRIPT_DA_PONTE, /winscard\.dll/)
  const dlls = [...SCRIPT_DA_PONTE.matchAll(/DllImport\("([^"]+)"/g)].map((m) => m[1])
  assert.deepEqual([...new Set(dlls)], ['winscard.dll'])
})

test('o script tem as cinco chamadas do PC/SC e nada além', () => {
  for (const fn of ['SCardEstablishContext', 'SCardListReaders', 'SCardConnect',
    'SCardTransmit', 'SCardDisconnect']) {
    assert.match(SCRIPT_DA_PONTE, new RegExp(fn), `sumiu ${fn}`)
  }
})

test('o script não decide nada: quem decide é o JavaScript', () => {
  // nenhuma palavra de domínio do lado de lá — nem peça, nem página, nem NDEF
  assert.doesNotMatch(SCRIPT_DA_PONTE, /vessel|NDEF|verify|gravada/i)
})

// ── O SCRIPT, CONFERIDO DE LONGE ───────────────────────────────────────────
// ⚠️ NÃO HÁ POWERSHELL NESTE COMPUTADOR (é um Mac): daqui NÃO dá para provar que
// o script roda. O que dá para provar é a FORMA dele — chaves fechadas, aspas
// pares, separador entre instruções — que é onde moram os erros de digitação que
// só apareceriam no Windows da bancada, com uma caixa de etiquetas em cima da
// mesa. É pouco, e está escrito no relatório que é pouco.

test('as chaves do script fecham todas', () => {
  let abertas = 0
  for (const letra of SCRIPT_DA_PONTE) {
    if (letra === '{') abertas += 1
    if (letra === '}') abertas -= 1
    assert.ok(abertas >= 0, 'fechou uma chave que nunca foi aberta')
  }
  assert.equal(abertas, 0, `sobraram ${abertas} chaves abertas`)
})

test('os parênteses do script fecham todos', () => {
  let abertos = 0
  for (const letra of SCRIPT_DA_PONTE) {
    if (letra === '(') abertos += 1
    if (letra === ')') abertos -= 1
    assert.ok(abertos >= 0, 'fechou um parêntese que nunca foi aberto')
  }
  assert.equal(abertos, 0)
})

test('cada linha tem um número par de aspas simples', () => {
  for (const [i, linha] of SCRIPT_DA_PONTE.split('\n').entries()) {
    const aspas = (linha.match(/'/g) || []).length
    assert.equal(aspas % 2, 0, `linha ${i + 1} ficou com aspa simples aberta: ${linha.slice(0, 80)}`)
  }
})

// ⚠️ O C# QUE VAI DENTRO DO Add-Type NÃO PODE TER ASPA SIMPLES: ela fecharia a
// string do PowerShell no meio, e o resto do C# viraria comando solto.
test('o C# de dentro do Add-Type não tem aspa simples nenhuma', () => {
  const linha = SCRIPT_DA_PONTE.split('\n').find((l) => l.includes('Add-Type'))
  const csharp = linha.slice(linha.indexOf("'") + 1, linha.lastIndexOf("'"))
  assert.doesNotMatch(csharp, /'/)
  assert.match(csharp, /using System;/)
  let abertas = 0
  for (const letra of csharp) { if (letra === '{') abertas += 1; if (letra === '}') abertas -= 1 }
  assert.equal(abertas, 0, 'as chaves do C# não fecham')
})

// ⚠️ PowerShell precisa de separador entre `}` e a instrução seguinte NA MESMA
// LINHA. `{ return "" } return $x` quebra com "Unexpected token 'return'" — e
// quebraria só no Windows, na primeira etiqueta.
test('nenhuma instrução começa logo depois de } na mesma linha, sem ponto-e-vírgula', () => {
  const proibido = /\}\s+(?!else|elseif|catch|finally|\)|\}|;|$)[A-Za-z$\[]/
  for (const [i, linha] of SCRIPT_DA_PONTE.split('\n').entries()) {
    // O que está entre aspas simples é TEXTO para o PowerShell — o C# do
    // Add-Type mora lá dentro, com as chaves dele. Conferir a regra do
    // PowerShell dentro de uma string de C# acusaria um inocente.
    const soPowershell = linha.replace(/'[^']*'/g, "''")
    assert.doesNotMatch(soPowershell, proibido,
      `linha ${i + 1} tem instrução colada num } sem ; antes: ${linha.slice(0, 100)}`)
  }
})

// `${...}` é sintaxe de variável do PowerShell E interpolação do JavaScript: num
// template a segunda vence e o script sai mutilado. Igual à cicatriz do `$_`.
test('nada de ${...}: ele seria comido pelo JavaScript antes de virar script', () => {
  assert.doesNotMatch(SCRIPT_DA_PONTE, /\$\{/)
})

test('nada de crase: ela é escape no PowerShell e delimitador no JavaScript', () => {
  assert.doesNotMatch(SCRIPT_DA_PONTE, /`/)
})

test('o laço lê do console e para quando a entrada acaba', () => {
  assert.match(SCRIPT_DA_PONTE, /\[Console\]::In\.ReadLine\(\)/)
  assert.match(SCRIPT_DA_PONTE, /if \(\$null -eq \$linha\) \{ break \}/)
})

// O `break` do `switch` quebra o `switch`, não o laço de fora: o comando SAIR
// sairia do lugar errado e o processo ficaria vivo para sempre.
test('nada de switch: o break dele sairia do lugar errado', () => {
  assert.doesNotMatch(SCRIPT_DA_PONTE, /\bswitch\b/)
})

test('o contexto e a etiqueta são soltos quando o laço acaba', () => {
  // as duas últimas linhas, que rodam DEPOIS do laço acabar
  const fim = SCRIPT_DA_PONTE.split('\n').slice(-2).join('\n')
  assert.match(fim, /SCardDisconnect/)
  assert.match(fim, /SCardReleaseContext/)
  // e elas estão FORA do laço: sem isso, o contexto ficaria preso no Windows
  const laco = SCRIPT_DA_PONTE.indexOf('while (-not $sair)')
  assert.ok(SCRIPT_DA_PONTE.indexOf('SCardReleaseContext($ctx)') > laco)
})

test('o PowerShell de verdade é chamado sem perfil e sem política atrapalhando', async () => {
  const { abrirPowershellDeVerdade } = await import('./ponte-do-powershell.js')
  assert.equal(typeof abrirPowershellDeVerdade, 'function')
  // não dá para rodar num Mac; o que se confere é o texto da chamada
  const fonte = abrirPowershellDeVerdade.toString()
  assert.match(fonte, /powershell\.exe/)
  assert.match(fonte, /'-NoProfile'/)
  assert.match(fonte, /'-ExecutionPolicy', 'Bypass'/)
  assert.match(fonte, /'-File'/)
})
