// RELIGAR O LEITOR quando o serviço de Cartão Inteligente do Windows caiu.
//
// ⚠️ POR QUE ISTO PRECISA DA PERMISSÃO DO WINDOWS: iniciar um serviço não é
// coisa que programa comum faça sozinho, e ainda bem. A pessoa vai ver a
// janelinha azul do Windows pedindo autorização, e precisa clicar em "sim".
// Não existe fazer isto escondido — e não deveria existir.
//
// ⚠️ E POR QUE O BOTÃO CONSERTA ALÉM DE RELIGAR: religar sozinho resolve hoje e
// deixa acontecer de novo amanhã. As duas linhas extras atacam a CAUSA mais
// comum — o serviço nascer "manual" e o Windows desligar a porta USB para
// economizar energia. Quem aperta o botão está consertando, não remediando, e
// por isso a tela TEM de dizer isso antes (ver `O_QUE_O_BOTAO_FAZ`).

export const O_QUE_O_BOTAO_FAZ = [
  'Ligar o serviço de Cartão Inteligente do Windows, que é o que o leitor usa.',
  'Deixar esse serviço ligando sozinho quando o computador iniciar.',
  'Desligar a economia de energia das portas USB, que é o que costuma derrubar o leitor.',
]

// O COMANDO É FIXO. Nada aqui é montado com texto que venha da tela ou do
// leitor: comando de sistema com pedaço vindo de fora é como se manda o
// computador executar o que um estranho escreveu.
const PASSOS = [
  'Set-Service SCardSvr -StartupType Automatic -ErrorAction SilentlyContinue',
  'Start-Service SCardSvr -ErrorAction SilentlyContinue',
  'powercfg /setacvalueindex SCHEME_CURRENT '
    + '2a737441-1930-4402-8d77-b2bebba308a3 '
    + '48e6b7a6-50f5-4782-a5d4-53bb8f07e226 0',
  'powercfg /setactive SCHEME_CURRENT',
].join('; ')

/** Os argumentos do `powershell.exe`. Separado para o teste poder lê-los. */
export function argumentosDoConserto() {
  return [
    '-NoProfile', '-NonInteractive', '-Command',
    // `-Verb RunAs` é o que faz o Windows pedir a autorização. `-Wait` faz o
    // programa esperar o fim, senão ele diria "pronto" antes de estar.
    `Start-Process powershell -Verb RunAs -Wait -WindowStyle Hidden `
    + `-ArgumentList '-NoProfile','-Command','${PASSOS}'`,
  ]
}

/** A frase que a pessoa lê, a partir do que aconteceu. */
export function fraseDoConserto({ codigo = 0, erro = null } = {}) {
  if (erro) {
    const texto = String(erro?.message ?? erro)
    // Cancelar a janelinha do Windows é uma escolha legítima, não uma falha do
    // programa — e merece uma frase que diga o que fazer, não um erro técnico.
    if (/1223|cancel/i.test(texto)) {
      return { ok: false, frase: 'Você cancelou a autorização do Windows. '
        + 'Sem ela não dá para religar o leitor daqui — clique de novo e escolha "Sim".' }
    }
    return { ok: false, frase: 'Não consegui religar o leitor daqui. '
      + 'Abra "Serviços" no Windows, procure "Cartão Inteligente" e clique em Iniciar. '
      + `(${texto.slice(0, 120)})` }
  }
  if (codigo !== 0) {
    return { ok: false, frase: 'O Windows recusou religar o leitor. '
      + 'Abra "Serviços", procure "Cartão Inteligente" e clique em Iniciar.' }
  }
  return { ok: true, frase: 'Pronto. O leitor foi religado e vai ligar sozinho da próxima vez. '
    + 'Encoste a etiqueta e tente de novo.' }
}
