// O QUE A TELA DIZ QUANDO ATIVAR NOTIFICAÇÕES NÃO DÁ CERTO.
//
// POR QUE EXISTE (relato do dono, 13/08/2026, no app instalado no Windows):
// "toco no botão permitir e não acontece nada, fica travado; aí vou na barra de
// topo do app, clico em autorizar e dá certo".
//
// Lendo o caminho: o botão chamava `inscrever()`, que pergunta a permissão e
// DEPOIS registra o service worker e assina no serviço de push. Enquanto isso a
// tela não mudava nada — mesmo texto, mesmo botão, sem sinal de que estava
// trabalhando. E se qualquer um desses passos demorasse ou falhasse, a tela
// ficava parada para sempre: não havia limite de tempo nem mensagem de erro.
// Todos os finais possíveis — negou, ignorou, deu erro — devolviam `false` e o
// modal simplesmente sumia, sem dizer nada.
//
// A regra aqui é a mesma do resto da Central: a tela nunca mente, e nunca cala.
// Cada final tem uma frase que diz O QUE ACONTECEU e O QUE FAZER.
//
// PURO de propósito: é texto que o dono lê num momento de frustração, e precisa
// poder ser conferido sem navegador.

export const MOTIVOS = [
  'ok',
  'nao-suportado',
  'negado',
  'ignorado',
  'demorou',
  'sem-inscricao',
  'nao-salvou',
];

export function recadoDoPush(motivo) {
  switch (motivo) {
    case 'ok':
      return ''
    case 'nao-suportado':
      return 'Este navegador não entrega notificações. No iPhone, é preciso '
        + 'adicionar a Central à tela de início primeiro.'
    case 'negado':
      // Caminho sem volta pelo botão: só as configurações do navegador reabrem.
      return 'O navegador está bloqueando os avisos deste site. Clique no '
        + 'cadeado (ou no ícone de aviso) ao lado do endereço, no topo da '
        + 'janela, e mude Notificações para "Permitir".'
    case 'ignorado':
      // É o caso do Windows que o dono viu: o navegador não chega a perguntar,
      // ou a janelinha some sem resposta, e a permissão continua "não decidida".
      return 'O navegador não chegou a registrar a sua resposta. Clique no '
        + 'ícone de aviso ao lado do endereço, no topo da janela, e escolha '
        + '"Permitir" — por ali funciona.'
    case 'demorou':
      return 'Demorou demais para ativar e eu parei de esperar, para a tela não '
        + 'ficar travada. Tente de novo; se insistir, ative pelo ícone ao lado '
        + 'do endereço, no topo da janela.'
    case 'sem-inscricao':
      return 'A permissão foi dada, mas este aparelho não conseguiu se '
        + 'inscrever para receber os avisos. Costuma ser rede bloqueando — '
        + 'tente de novo em outra conexão.'
    case 'nao-salvou':
      return 'Este aparelho autorizou, mas não consegui guardar o registro. Os '
        + 'avisos não vão chegar até isso ser feito — tente de novo.'
    default:
      return 'Não consegui ativar os avisos agora. Tente de novo.'
  }
}

// Deu certo mesmo? Serve para a moldura decidir entre fechar o convite calada
// (deu certo) e mostrar o recado (não deu).
export function deuCerto(resultado) {
  return !!(resultado && resultado.ok === true)
}
