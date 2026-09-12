// A PONTE ATÉ O WINDOWS — um processo de PowerShell vivo, do outro lado.
//
// POR QUE O POWERSHELL, E NÃO UMA BIBLIOTECA: o `powershell.exe` já vem no
// Windows e fala com o `winscard.dll` sem instalar nada. Foi assim que a
// etiqueta de verdade foi gravada à mão em 01/09/2026 — as 12 escritas
// responderam `90 00` e o celular abriu o certificado. A alternativa era uma
// biblioteca que COMPILA na hora do `npm install`, e compilar exige ferramentas
// de programação num computador que é de bancada, não de programador.
//
// UM PROCESSO SÓ, VIVO O TURNO INTEIRO. O contexto do PC/SC e a conexão com a
// etiqueta moram DENTRO desse processo: abrir um processo por página seria
// lento e perderia a conexão a cada escrita — e a etiqueta teria de ser
// reconhecida de novo entre uma página e a seguinte.
//
// A PONTE É BURRA DE PROPÓSITO. Atravessa uma linha de texto por vez, tudo em
// hexadecimal, com número de sequência na frente. Nada de objeto complexo: quanto
// mais burra a ponte, menos ela quebra — e o que ela não decide, o JavaScript
// decide, onde dá para testar.
//
// ⚠️ ELA FALHA FECHADA. Toda falha aqui estoura; nenhuma devolve lista vazia de
// bytes. Vazio é a resposta que faz o tradutor dizer "etiqueta em branco", e
// "em branco" é a resposta que autoriza gravar por cima de uma bolsa que já tem
// dono — com a etiqueta costurada dentro do forro, onde não se reabre.
import { spawn } from 'node:child_process'
import { writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// ── O PROTOCOLO ────────────────────────────────────────────────────────────
// JS  → PS :  <n> <COMANDO> [argumento em hexadecimal]
// PS  → JS :  #<n> OK <hexadecimal>     ou     #<n> ERRO <hexadecimal do recado>
//
// O NÚMERO DE SEQUÊNCIA NÃO É ENFEITE. Sem ele, a resposta atrasada da leitura
// da página 4 poderia ser aceita como a da página 20, e a memória sairia
// embaralhada — que é exatamente a leitura torta que autoriza gravar por cima.
const RESPOSTA = /^#(\d+) (OK|ERRO) ?(.*)$/

// ── O SCRIPT DO OUTRO LADO ─────────────────────────────────────────────────
//
// ⚠️ AS CINCO ARMADILHAS, TODAS MEDIDAS À MÃO NO WINDOWS DO DONO EM 01/09/2026.
// Cada uma travou o console de verdade. Há teste ao lado que reprova a volta de
// cada uma, porque daqui não dá para prová-las — só dá para provar que o script
// continua escrito do jeito que passou.
//
//  1. BLOCO DE TEXTO LONGO (@" ... "@) TRAVA O CONSOLE esperando o fim. Por isso
//     o `Add-Type` vem numa LINHA SÓ, com aspas simples.
//  2. STRUCT ANINHADA CONFUNDE O `New-Object` (o `+` do tipo aninhado). Por isso
//     `SCardIO` é declarada NO TOPO, fora da classe, e se cria com `::new()`.
//  3. `Add-Type` RODA UMA VEZ SÓ por processo: a segunda morre com "o tipo já
//     existe". Daí o `if (-not ("PcscPonte" -as [type]))`.
//  4. NADA DE `$_`: ele já chegou mutilado como `$` no que se gera
//     dinamicamente. Em `catch` usa-se `$Error[0]`; para bytes,
//     `[BitConverter]::ToString`; para separar, `[char]0` com
//     `RemoveEmptyEntries`.
//  5. NADA DE `switch`: o `break` dele quebra o `switch`, não o laço de fora, e
//     o comando SAIR sairia do lugar errado. Aqui é `if`/`elseif`.
//
// E ELE NÃO DECIDE NADA. Estabelecer contexto, listar, conectar, transmitir,
// desconectar. Regra de peça, de página e de fila mora no JavaScript, que se
// testa; aqui só mora o cabo.
const CSHARP = 'using System; using System.Runtime.InteropServices; '
  + '[StructLayout(LayoutKind.Sequential)] public struct SCardIO { public int Protocol; public int Length; } '
  + 'public class PcscPonte { '
  + '[DllImport("winscard.dll")] public static extern int SCardEstablishContext(int scope, IntPtr r1, IntPtr r2, out IntPtr ctx); '
  + '[DllImport("winscard.dll", CharSet=CharSet.Ansi)] public static extern int SCardListReaders(IntPtr ctx, byte[] groups, byte[] readers, ref int len); '
  + '[DllImport("winscard.dll", CharSet=CharSet.Ansi)] public static extern int SCardConnect(IntPtr ctx, string reader, int share, int protocols, out IntPtr card, out int active); '
  + '[DllImport("winscard.dll")] public static extern int SCardTransmit(IntPtr card, ref SCardIO pioSend, byte[] send, int sendLen, IntPtr pioRecv, byte[] recv, ref int recvLen); '
  + '[DllImport("winscard.dll")] public static extern int SCardDisconnect(IntPtr card, int disposition); '
  + '[DllImport("winscard.dll")] public static extern int SCardReleaseContext(IntPtr ctx); '
  + '}'

export const SCRIPT_DA_PONTE = [
  "$ErrorActionPreference = 'Stop'",
  `if (-not ("PcscPonte" -as [type])) { Add-Type -TypeDefinition '${CSHARP}' }`,
  "function Responder([string]$n, [string]$tipo, [string]$hex) { [Console]::Out.WriteLine('#' + $n + ' ' + $tipo + ' ' + $hex); [Console]::Out.Flush() }",
  "function ParaHex([byte[]]$b, [int]$q) { if ($q -le 0) { return '' }; return [BitConverter]::ToString($b, 0, $q).Replace('-', '') }",
  "function DeHex([string]$h) { $q = [int]($h.Length / 2); $b = New-Object byte[] $q; for ($i = 0; $i -lt $q; $i++) { $b[$i] = [Convert]::ToByte($h.Substring($i * 2, 2), 16) }; return ,$b }",
  "function TextoHex([string]$t) { return [BitConverter]::ToString([Text.Encoding]::UTF8.GetBytes($t)).Replace('-', '') }",
  "function CodigoHex([int]$r) { return '0x' + $r.ToString('X8') }",
  '$ctx = [IntPtr]::Zero',
  '$ctxOk = $false',
  "$ctxErro = ''",
  // ⚠️ ABRIR O CONTEXTO VIROU FUNCAO, para poder ser chamada DE NOVO.
  //
  // Ate 07/09/2026 isto rodava UMA VEZ, quando o programa abria. Se o servico de
  // Cartao Inteligente do Windows parasse no meio do expediente, o contexto
  // morria — e mesmo depois de a pessoa RELIGAR o servico, o programa continuava
  // quebrado ate ser fechado e aberto de novo. Ninguem adivinha isso: a pessoa
  // religa o servico, ve que continua falhando, e conclui que o conserto nao
  // funcionou. Foi assim que virou "erro em cima de erro" em 06/09.
  //
  // Agora, quando o contexto cai, o proximo comando abre outro. O conserto do
  // lado do Windows passa a fazer efeito sozinho, sem reabrir o programa.
  "function AbrirContexto { ",
  "  if ($script:ctx -ne [IntPtr]::Zero) { try { [void][PcscPonte]::SCardReleaseContext($script:ctx) } catch { } ; $script:ctx = [IntPtr]::Zero }",
  "  $script:ctxOk = $false",
  "  try { $novo = [IntPtr]::Zero; $r = [PcscPonte]::SCardEstablishContext(2, [IntPtr]::Zero, [IntPtr]::Zero, [ref]$novo); if ($r -eq 0) { $script:ctx = $novo; $script:ctxOk = $true; $script:ctxErro = '' } else { $script:ctxErro = 'SCardEstablishContext ' + (CodigoHex $r) } } catch { $script:ctxErro = $Error[0].Exception.Message }",
  "}",
  "AbrirContexto",
  '$card = [IntPtr]::Zero',
  '$ativo = 0',
  '$sair = $false',
  'while (-not $sair) {',
  '  $linha = [Console]::In.ReadLine()',
  '  if ($null -eq $linha) { break }',
  '  $linha = $linha.Trim()',
  '  if ($linha.Length -eq 0) { continue }',
  "  $partes = $linha.Split([string[]]@(' '), 3, [StringSplitOptions]::RemoveEmptyEntries)",
  '  $n = $partes[0]',
  "  $cmd = ''",
  '  if ($partes.Length -gt 1) { $cmd = $partes[1].ToUpper() }',
  "  $arg = ''",
  '  if ($partes.Length -gt 2) { $arg = $partes[2] }',
  '  try {',
  // ⚠️ A TENTATIVA DE REABRIR VEM ANTES DA CORRENTE DE DECISAO, e nao dentro
  // dela: assim, quando a reabertura da certo, o comando SEGUE normalmente na
  // mesma rodada, em vez de devolver erro e esperar a pessoa tentar de novo.
  // `PING` fica de fora porque ele existe justamente para responder sem tocar
  // no leitor.
  "    if ((-not $ctxOk) -and ($cmd -ne 'PING') -and ($cmd -ne 'SAIR')) { AbrirContexto }",
  "    if ($cmd -eq 'PING') { Responder $n 'OK' (TextoHex 'pronto') }",
  "    elseif (-not $ctxOk) { Responder $n 'ERRO' (TextoHex $ctxErro) }",
  // ⚠️ O RETORNO DESTA PRIMEIRA CHAMADA NAO PODE SER DESCARTADO, e ja foi.
  // Ate 07/09/2026 esta linha comecava com `[void]`: quando o servico de Cartao
  // Inteligente do Windows PARAVA no meio do expediente, a chamada falhava, o
  // tamanho ficava 0 e a ponte respondia OK COM LISTA VAZIA. O programa entao
  // dizia "nao achei nenhum leitor — confira o cabo USB e tente outra porta",
  // que e o conselho errado: o cabo estava bom e o servico e que estava parado.
  // Quem estava na bancada trocou de porta, trocou de cabo, e so muito depois
  // viu a mensagem certa. Falha nao pode virar lista vazia.
  //
  // Passar o codigo de verdade acerta os DOIS casos: 0x8010002E ja significa
  // "nenhum leitor" e continua dizendo isso; 0x8010001D/1E dizem que o servico
  // parou, com o caminho para religar.
  "    elseif ($cmd -eq 'LEITORES') { $tam = 0; $r0 = [PcscPonte]::SCardListReaders($ctx, $null, $null, [ref]$tam); if ($r0 -ne 0) { if (@(-2146435043, -2146435042, -2146435069) -contains $r0) { $script:ctxOk = $false } ; Responder $n 'ERRO' (TextoHex ('SCardListReaders ' + (CodigoHex $r0))) } elseif ($tam -le 0) { Responder $n 'OK' '' } else { $buf = New-Object byte[] $tam; $r = [PcscPonte]::SCardListReaders($ctx, $null, $buf, [ref]$tam); if ($r -ne 0) { Responder $n 'ERRO' (TextoHex ('SCardListReaders ' + (CodigoHex $r))) } else { $texto = [Text.Encoding]::ASCII.GetString($buf, 0, $tam); $nomes = $texto.Split(@([char]0), [StringSplitOptions]::RemoveEmptyEntries); Responder $n 'OK' (TextoHex ($nomes -join ([char]10))) } } }",
  "    elseif ($cmd -eq 'CONECTAR') { if ($card -ne [IntPtr]::Zero) { [void][PcscPonte]::SCardDisconnect($card, 0); $card = [IntPtr]::Zero }; $nome = [Text.Encoding]::UTF8.GetString((DeHex $arg)); $novo = [IntPtr]::Zero; $proto = 0; $r = [PcscPonte]::SCardConnect($ctx, $nome, 2, 3, [ref]$novo, [ref]$proto); if ($r -ne 0) { Responder $n 'ERRO' (TextoHex ('SCardConnect ' + (CodigoHex $r))) } else { $card = $novo; $ativo = $proto; Responder $n 'OK' '' } }",
  "    elseif ($cmd -eq 'APDU') { if ($card -eq [IntPtr]::Zero) { Responder $n 'ERRO' (TextoHex 'sem etiqueta conectada') } else { $io = [SCardIO]::new(); $io.Protocol = $ativo; $io.Length = 8; $pacote = DeHex $arg; $recv = New-Object byte[] 258; $len = 258; $r = [PcscPonte]::SCardTransmit($card, [ref]$io, $pacote, $pacote.Length, [IntPtr]::Zero, $recv, [ref]$len); if ($r -ne 0) { Responder $n 'ERRO' (TextoHex ('SCardTransmit ' + (CodigoHex $r))) } else { Responder $n 'OK' (ParaHex $recv $len) } } }",
  "    elseif ($cmd -eq 'DESCONECTAR') { if ($card -ne [IntPtr]::Zero) { [void][PcscPonte]::SCardDisconnect($card, 0); $card = [IntPtr]::Zero }; Responder $n 'OK' '' }",
  "    elseif ($cmd -eq 'SAIR') { $sair = $true; Responder $n 'OK' '' }",
  "    else { Responder $n 'ERRO' (TextoHex ('comando desconhecido: ' + $cmd)) }",
  '  } catch {',
  "    Responder $n 'ERRO' (TextoHex $Error[0].Exception.Message)",
  '  }',
  '}',
  'if ($card -ne [IntPtr]::Zero) { [void][PcscPonte]::SCardDisconnect($card, 0) }',
  'if ($ctxOk) { [void][PcscPonte]::SCardReleaseContext($ctx) }',
].join('\n')

// ── OS CÓDIGOS DO PC/SC ────────────────────────────────────────────────────
// Só entram os que estão documentados e que aparecem nesta bancada. Traduzir de
// cabeça um código que nunca vimos seria pôr uma frase confiante em cima de um
// palpite — e a frase manda o operador jogar fora etiqueta boa. O que não está
// aqui sai com o número na cara.
//
// ⚠️ NENHUMA FRASE DE PROBLEMA DO LEITOR MANDA TROCAR A ETIQUETA. Quando quem
// está ocupado é o leitor, a etiqueta está boa — e quem troca etiqueta boa joga
// bolsa fora, uma atrás da outra, sem entender por quê. Há teste que reprova.
const CODIGOS = {
  '0X8010001D': 'O serviço de Cartão Inteligente do Windows não está rodando. '
    + 'Abra "Serviços" no Windows, procure por "Cartão Inteligente" e inicie.',
  '0X8010001E': 'O serviço de Cartão Inteligente do Windows parou. '
    + 'Abra "Serviços" no Windows, procure por "Cartão Inteligente" e inicie de novo.',
  '0X8010002E': 'Não achei nenhum leitor. Confira se o ACR122U está ligado na USB — '
    + 'a luz dele fica acesa — e tente outra porta.',
  '0X80100009': 'O Windows não conhece esse leitor. Desligue e ligue o cabo USB.',
  '0X8010000B': 'O leitor está sendo usado por outro programa. Feche o programa da ACS, '
    + 'o NFC Tools ou outra janela deste gravador e tente de novo. A etiqueta está boa.',
  '0X8010000C': 'Não há etiqueta no leitor. Encoste a etiqueta em cima do leitor, no meio, '
    + 'e segure parada.',
  '0X80100069': 'A etiqueta saiu de cima do leitor no meio. Encoste de novo e segure parada.',
  '0X80100068': 'A etiqueta se mexeu e precisou ser reconhecida de novo. '
    + 'Encoste de novo e segure parada até o programa avisar.',
  '0X80100066': 'A etiqueta não respondeu. Encoste de novo e segure parada; '
    + 'se repetir na mesma etiqueta, ela pode estar danificada.',
  '0X8010000A': 'Passou do tempo esperando o leitor. Encoste a etiqueta de novo e segure parada.',
  '0X8010000F': 'O leitor e a etiqueta não se entenderam. Tire a etiqueta, espere um instante '
    + 'e encoste de novo.',
}

// OS QUE NÃO PASSAM ESPERANDO. Etiqueta que ainda não foi encostada chega em
// segundos e vale insistir. Serviço parado, leitor ausente e leitor tomado por
// outro programa NÃO se resolvem sozinhos: insistir neles em silêncio deixa
// quem está na bancada olhando uma tela parada, trocando etiqueta boa.
export const CODIGOS_QUE_NAO_PASSAM_ESPERANDO = new Set([
  '0X8010001D', '0X8010001E', '0X8010002E', '0X80100009', '0X8010000B',
])

export function codigoDoPcsc(textoOuCodigo) {
  return String(textoOuCodigo ?? '').match(/0x[0-9a-f]{8}/i)?.[0].toUpperCase() || ''
}

export function traduzirCodigoDoPcsc(textoOuCodigo) {
  const codigo = codigoDoPcsc(textoOuCodigo)
  return CODIGOS[codigo]
    || `O leitor respondeu um código que não conheço (${codigo || String(textoOuCodigo ?? '')}). `
      + 'Desligue e ligue o cabo USB e tente de novo.'
}

// ── HEXADECIMAL, SEM ESPAÇO, NOS DOIS SENTIDOS ─────────────────────────────
function paraHex(bytes) {
  return Array.from(bytes ?? []).map((b) => b.toString(16).toUpperCase().padStart(2, '0')).join('')
}

// ⚠️ HEXADECIMAL ESTRAGADO É FALHA, NUNCA MEIA LEITURA. Um pedaço de linha que
// chegou torto não pode virar alguns bytes "aproveitados": bytes a menos são
// meia memória, e meia memória lida como etiqueta em branco.
function deHex(hex) {
  const texto = String(hex ?? '').trim()
  if (!texto) return []
  if (texto.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(texto)) {
    throw Object.assign(
      new Error(`A resposta do leitor veio estragada (não é hexadecimal: "${texto.slice(0, 40)}"). `
        + 'Encoste a etiqueta de novo e segure parada.'),
      { motivo: 'resposta-estragada' },
    )
  }
  const bytes = []
  for (let i = 0; i < texto.length; i += 2) bytes.push(parseInt(texto.slice(i, i + 2), 16))
  return bytes
}

const textoDeHex = (hex) => Buffer.from(deHex(hex)).toString('utf8')
const hexDeTexto = (texto) => Buffer.from(String(texto ?? ''), 'utf8').toString('hex').toUpperCase()

// ── ABRIR O POWERSHELL DE VERDADE ──────────────────────────────────────────
// O script vai num arquivo, e não pelo stdin, por dois motivos: `-Command -` tem
// comportamento discutível quanto a esperar o fim da entrada antes de começar, e
// o stdin precisa ficar livre para os comandos. De quebra, o arquivo pode ser
// aberto e rodado À MÃO na bancada quando algo der errado — que é exatamente
// como este caminho foi provado da primeira vez.
export function abrirPowershellDeVerdade() {
  const pasta = mkdtempSync(join(tmpdir(), 'gravador-vessel-'))
  const arquivo = join(pasta, 'ponte-pcsc.ps1')
  writeFileSync(arquivo, SCRIPT_DA_PONTE, 'utf8')
  const processo = spawn(
    'powershell.exe',
    ['-NoProfile', '-NoLogo', '-ExecutionPolicy', 'Bypass', '-File', arquivo],
    { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true },
  )
  processo.arquivoDoScript = arquivo
  return processo
}

const RELOGIO = { agendar: (fn, ms) => setTimeout(fn, ms), cancelar: (t) => clearTimeout(t) }

export function criarPonteDoPowershell({
  abrirProcesso = abrirPowershellDeVerdade,
  relogio = RELOGIO,
  tempoLimite = 15000,
} = {}) {
  let processo
  try {
    processo = abrirProcesso()
  } catch (erro) {
    throw new Error(
      'Não consegui abrir o PowerShell neste computador. Ele já vem no Windows: se esta '
      + `mensagem aparecer, algo está bloqueando o \`powershell.exe\`. (${erro?.message || erro})`,
    )
  }

  const pendentes = new Map()   // número de sequência → { resolver, recusar, relogioDele }
  const sobras = []             // linhas que não são do protocolo, guardadas para o recado
  let restoDaLinha = ''
  let sequencia = 0
  let morte = null              // a frase da morte, quando o processo já se foi

  // O stdin de um processo morto emite 'error' (EPIPE) de forma assíncrona. Sem
  // ouvinte, o Node derruba o programa INTEIRO — no meio de um turno, isso perde
  // a conta das etiquetas. Aqui a falha vira a morte anunciada da ponte.
  processo.stdin?.on?.('error', (erro) => {
    morrer(`Não consegui mais falar com o PowerShell (${erro?.message || erro}). `
      + 'Feche e abra o programa.')
  })

  processo.stdout?.setEncoding?.('utf8')
  processo.stderr?.setEncoding?.('utf8')

  let reclamacoes = ''
  processo.stderr?.on?.('data', (pedaco) => {
    // O stderr é a única pista quando o `Add-Type` não compila ou o script morre
    // antes de responder. Guardar só o fim evita crescer sem limite num turno
    // inteiro, e é o fim que interessa.
    reclamacoes = (reclamacoes + String(pedaco)).slice(-2000)
  })

  // ⚠️ O STDOUT NÃO RESPEITA LINHA. Uma resposta de 40 bytes pode chegar em três
  // pedaços, e o fim da linha vir no pedaço seguinte. Montar a resposta em cima
  // de um pedaço solto é ler meia memória de etiqueta.
  processo.stdout?.on?.('data', (pedaco) => {
    restoDaLinha += String(pedaco)
    const linhas = restoDaLinha.split('\n')
    restoDaLinha = linhas.pop() ?? ''
    for (const bruta of linhas) atenderLinha(bruta.replace(/\r$/, '').trim())
  })

  function atenderLinha(linha) {
    if (!linha) return
    const achado = linha.match(RESPOSTA)
    if (!achado) {
      // Aviso do PowerShell, prompt, linha em branco. Joga-se fora — mas NUNCA
      // em silêncio: fica guardada para aparecer no recado quando algo der
      // errado, senão o defeito de verdade some atrás de "não respondeu".
      sobras.push(linha)
      if (sobras.length > 20) sobras.shift()
      return
    }
    const [, numero, tipo, carga] = achado
    const espera = pendentes.get(Number(numero))
    // Resposta de um comando que já morreu de tempo, ou de um número que nem
    // existe: joga-se fora. Aceitá-la aqui seria responder a leitura da página 4
    // com o que voltou da página 20.
    if (!espera) { sobras.push(linha); if (sobras.length > 20) sobras.shift(); return }
    pendentes.delete(Number(numero))
    relogio.cancelar(espera.relogioDele)
    if (tipo === 'ERRO') {
      let recado
      try { recado = textoDeHex(carga) } catch { recado = carga }
      const erro = new Error(
        codigoDoPcsc(recado)
          ? `${traduzirCodigoDoPcsc(recado)} [${recado}]`
          : `O leitor recusou: ${recado}`,
      )
      erro.motivo = 'erro-do-powershell'
      erro.codigo = codigoDoPcsc(recado)
      espera.recusar(erro)
      return
    }
    try { espera.resolver(carga) } catch (e) { espera.recusar(e) }
  }

  function morrer(frase) {
    morte = frase
    for (const [numero, espera] of pendentes) {
      relogio.cancelar(espera.relogioDele)
      pendentes.delete(numero)
      espera.recusar(Object.assign(new Error(frase), { motivo: 'processo-morreu' }))
    }
  }

  processo.on?.('exit', (codigo, sinal) => {
    morrer(
      'O PowerShell que fala com o leitor se fechou'
      + `${codigo == null ? '' : ` (código ${codigo})`}${sinal ? ` (${sinal})` : ''}. `
      + 'Feche e abra o programa. '
      + (reclamacoes.trim() ? `O Windows disse: ${reclamacoes.trim().slice(-500)}` : '')
      + (sobras.length ? ` As últimas linhas foram: ${sobras.slice(-3).join(' | ')}` : ''),
    )
  })
  processo.on?.('error', (erro) => {
    morrer(`Não consegui falar com o PowerShell (${erro?.message || erro}). Feche e abra o programa.`)
  })

  // MANDA UMA LINHA E ESPERA A RESPOSTA DELA. Nunca devolve vazio por falha:
  // toda falha estoura.
  function perguntar(comando, argumento = '') {
    if (morte) {
      return Promise.reject(Object.assign(new Error(morte), { motivo: 'processo-morreu' }))
    }
    const numero = ++sequencia
    return new Promise((resolver, recusar) => {
      const relogioDele = relogio.agendar(() => {
        pendentes.delete(numero)
        recusar(Object.assign(
          new Error(
            `O leitor não respondeu a tempo (${comando}). Encoste a etiqueta de novo e segure `
            + 'parada; se repetir, desligue e ligue o cabo USB.'
            + (sobras.length ? ` As últimas linhas foram: ${sobras.slice(-3).join(' | ')}` : ''),
          ),
          { motivo: 'tempo' },
        ))
      }, tempoLimite)
      pendentes.set(numero, { resolver, recusar, relogioDele })
      try {
        processo.stdin.write(`${numero} ${comando}${argumento ? ` ${argumento}` : ''}\n`)
      } catch (erro) {
        pendentes.delete(numero)
        relogio.cancelar(relogioDele)
        recusar(Object.assign(
          new Error(`Não consegui mandar o comando para o leitor (${erro?.message || erro}).`),
          { motivo: 'processo-morreu' },
        ))
      }
    })
  }

  return {
    // PROVA QUE O OUTRO LADO ESTÁ VIVO antes de qualquer etiqueta entrar na
    // história. Sem isto, um `Add-Type` que não compilou só apareceria na
    // primeira gravação — com uma bolsa de couro em cima da mesa.
    async iniciar() {
      try {
        await perguntar('PING')
      } catch (erro) {
        throw new Error(
          `O PowerShell não respondeu quando o programa abriu. ${erro?.message || erro}`,
        )
      }
      return true
    },

    async listarLeitores() {
      const texto = textoDeHex(await perguntar('LEITORES'))
      return texto.split('\n').map((n) => n.trim()).filter(Boolean)
    },

    async conectar(nome) {
      await perguntar('CONECTAR', hexDeTexto(nome))
      return true
    },

    async transmitir(bytes) {
      return deHex(await perguntar('APDU', paraHex(bytes)))
    },

    async desconectar() {
      await perguntar('DESCONECTAR')
      return true
    },

    // FECHAR NÃO ESPERA RESPOSTA. O SAIR é um pedido de gentileza para o script
    // soltar o contexto do PC/SC por conta; o `end()` no stdin faz o laço dele
    // acabar de qualquer jeito. Esperar a resposta aqui travaria o fechamento do
    // programa quando o processo já tivesse morrido.
    async fechar() {
      if (morte) return true
      try { processo.stdin.write(`${++sequencia} SAIR\n`); processo.stdin.end?.() } catch { /* já foi */ }
      morrer('O programa fechou a conversa com o leitor.')
      try { processo.kill?.() } catch { /* já foi */ }
      return true
    },

    // Só para o recado de erro e para o teste: o que veio do outro lado e não
    // era do protocolo.
    sobras: () => sobras.slice(),
  }
}
