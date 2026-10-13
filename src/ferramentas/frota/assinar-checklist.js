/* AS FRASES DA ASSINATURA — o que a tela diz quando a senha não passa, e o que
 * ela diz quando parte da gravação passou e parte não.
 *
 * Desenho: docs/superpowers/specs/2026-08-06-frota-checklist-assinatura-design.md
 * (D19, D19a, D21, D22)
 *
 * POR QUE ISTO É UM ARQUIVO À PARTE, E TESTADO: gravar um checklist assinado
 * são TRÊS escritas — a ficha, as respostas e a assinatura. Este módulo já viu
 * quatro vezes o mesmo defeito: duas gravações, só a primeira conferida, e a
 * tela dizendo "salvo" em cima da que falhou. A frase que a pessoa lê no meio
 * disso é a única coisa que a impede de achar que está tudo certo, e frase
 * escondida dentro de um .vue não tem teste.
 *
 * A REGRA DAS FRASES: dizer o que ficou gravado, o que NÃO ficou, e o que
 * fazer agora. Nunca "deu erro". */

/* ── A senha ──────────────────────────────────────────────────────────────── */

/**
 * A frase pra cada recusa da Edge `conferir-senha`.
 *
 * `codigo` é o campo `erro` que a Edge devolve. Ele pode chegar NULO, e isso
 * não é detalhe: quando a resposta não é 2xx (429 bloqueado, 401 sem sessão),
 * o supabase-js zera o `data` e o motivo só existe dentro do corpo do erro —
 * se a tela não for buscar lá, o código chega indefinido. Por isso o caso
 * desconhecido NÃO devolve "senha incorreta": acusar a pessoa de errar a senha
 * quando o que caiu foi a internet a faz digitar de novo, e de novo, até a
 * Edge bloquear por dez minutos de verdade.
 *
 * NENHUMA destas situações impede o registro de existir mais tarde — nada foi
 * gravado ainda quando elas acontecem, e as frases dizem isso.
 */
export function recusaDaSenha(codigo) {
  switch (codigo) {
    case 'senha_incorreta':
      return 'Senha incorreta. Confira e tente de novo — é a mesma senha com que você entra no aplicativo.'
    case 'bloqueado':
      return 'Muitas tentativas com senha errada. Espere dez minutos e tente de novo.'
    case 'sem_senha':
      return 'Digite sua senha para assinar. É a mesma senha com que você entra no aplicativo.'
    case 'sem_sessao':
      return 'Seu acesso expirou enquanto você preenchia. Saia e entre de novo no aplicativo — '
        + 'o checklist ainda não foi gravado, você vai precisar preencher outra vez.'
    case 'entrou_como_outra_pessoa':
      // API em Go (Plano 7): a aba de "entrar como" não assina por ninguém.
      return 'Nesta aba você entrou como outra pessoa, e a assinatura é só dela. '
        + 'Nada foi gravado — o checklist continua por preencher.'
    default:
      // 'falha_interna', erro de rede, resposta que não deu pra ler: tudo cai
      // aqui, e todos têm a mesma orientação honesta — não sabemos, nada foi
      // gravado, tente de novo.
      return 'Não consegui conferir sua senha agora. Confira a conexão e tente de novo. '
        + 'Nada foi gravado — o checklist continua por preencher.'
  }
}

/* ── O que ficou gravado ──────────────────────────────────────────────────── */

/**
 * A frase do que sobrou gravado quando a sequência para no meio.
 *
 * Recebe os três passos como "deu certo?" e devolve '' quando não há nada a
 * avisar. `queriaAssinar` importa: uma ficha de quem NÃO tem login termina sem
 * assinatura de propósito (D22), e isso não é falha nenhuma.
 *
 * O PASSO DA ASSINATURA MERECE FRASE PRÓPRIA porque o estado que ele deixa é
 * diferente dos outros dois: a ficha e as respostas estão inteiras e corretas,
 * só falta a prova de quem conferiu. O checklist VALE — dizer "não foi gravado"
 * faria a pessoa preencher de novo e bater no índice "um carro, um dia, uma
 * ficha".
 */
export function avisoDoQueGravou({ fichaGravada, respostasGravadas, assinaturaGravada, queriaAssinar }) {
  if (!fichaGravada) return ''
  if (!respostasGravadas) {
    return 'A ficha do checklist foi registrada, mas as respostas dos itens não foram salvas. '
      + 'Avise quem administra a Frota antes de tentar de novo — tentar de novo vai recusar '
      + 'dizendo que o checklist de hoje já existe.'
  }
  if (queriaAssinar && !assinaturaGravada) {
    return 'O checklist foi gravado com todas as respostas, mas a SUA ASSINATURA não entrou. '
      + 'A conferência vale e não precisa refazer — tentar de novo vai recusar dizendo que o '
      + 'checklist de hoje já existe. Avise quem administra a Frota para registrarem que esta '
      + 'ficha ficou sem assinatura.'
  }
  return ''
}

/**
 * O que a tela diz DEPOIS de gravar com sucesso, sobre a assinatura.
 *
 * Ficha sem assinatura parecendo assinada seria a mentira mais cara desta fase
 * (D22), então o caminho de sucesso também tem de dizer qual dos dois foi.
 */
export function selo({ queriaAssinar, assinaturaGravada }) {
  return queriaAssinar && assinaturaGravada
    ? 'Checklist gravado e assinado por você.'
    : 'Checklist gravado, sem assinatura.'
}
