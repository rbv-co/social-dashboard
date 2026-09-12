// Quando a Análise de Vendas mostra "Carregando", e quando ela escreve um
// recado de erro no lugar do conteúdo.
//
// O DEFEITO QUE ISTO CONSERTA (13/08/2026, mesmo dia em que foi criado):
// ao fazer a tela segurar o gráfico anterior quando o Bling não responde, usei
// `window._saRawData` como se significasse "tem conteúdo na tela". Não
// significa. Ele é atribuído na linha 458, e `renderSalesAnalysis` só é chamado
// na 479 — e a PRIMEIRA coisa que o render faz é `body.textContent=''`.
//
// Então, se o render explodisse no meio (dado de um período específico, Chart.js
// engasgando), a sequência era:
//   1. _saRawData recebe valor        → "tem dado"
//   2. render limpa o corpo            → tela vazia
//   3. render lança no meio            → cai no catch
//   4. catch pergunta "tem dado?" SIM  → decide não escrever nada
//   → TELA EM BRANCO, sem nem a mensagem de erro.
// Antes da minha mudança o catch escrevia o erro SEMPRE; eu piorei esse caminho.
// Era o "às vezes a tela não carrega" que o dono viu.
//
// A lição, que vale além desta tela: **"existe dado em memória" não é o mesmo
// que "existe conteúdo na tela"**. Entre uma coisa e outra há um render que pode
// falhar. Quem decide se a tela está vazia é a TELA, não a variável.

// O corpo está vazio AGORA? É a única pergunta que não mente.
export function corpoEstaVazio(el) {
  if (!el) return true
  return (el.childElementCount || 0) === 0
}

// Mostrar "Carregando"?
//
// Na recarga automática (de 5 em 5 minutos) com conteúdo na tela: NÃO. Trocar um
// painel inteiro por um spinner sozinho, sem ninguém ter pedido, é justamente o
// piscar que a correção de hoje veio evitar.
//
// Quando a pessoa PEDE (abriu a tela, trocou de período): SIM. Ela mandou fazer
// algo e precisa ver que está acontecendo — senão a tela parece travada,
// mostrando os números do período anterior como se fossem a resposta.
export function deveMostrarCarregando({ corpoVazio = true, automatica = false } = {}) {
  if (corpoVazio) return true
  return !automatica
}

// Escrever o recado de erro no lugar do conteúdo?
// Só quando não há conteúdo nenhum. Havendo, ele fica — a faixa de aviso no topo
// é que diz de que hora ele é.
export function deveEscreverRecado({ corpoVazio = true } = {}) {
  return corpoVazio
}
