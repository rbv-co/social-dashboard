/* A ABA ATIVA NUNCA FICA FORA DA VISTA.
 *
 * POR QUE ISTO EXISTE. Em 02/09/2026 a barra global `.abas` deixou de quebrar
 * em duas linhas no celular e passou a ROLAR POR DENTRO (o porquê inteiro está
 * escrito na regra, em `src/estilos/estilos-globais.css`). Medido a 375px, com
 * a barra em uma linha só: a última aba nasce fora da vista em TODAS as quatro
 * telas que usam a classe — Frota, Patrimônio, Acessos e Autenticidade.
 *
 * Enquanto a pessoa só ROLA a barra, isso está certo: é ela quem decide o que
 * olhar. O problema é a aba ATIVA ficar escondida — se a tela está mostrando
 * "Relatórios" e a barra mostra as três primeiras, a pessoa não sabe onde está.
 *
 * ⚠️ POR QUE NÃO DEIXAR PARA O NAVEGADOR. O toque num `<button>` dá FOCO a ele,
 * e o navegador rola sozinho o que ganha foco. Isso funciona — foi medido no
 * Chrome, com clique de verdade: a barra rolou 65px e a aba apareceu inteira.
 * Só que é comportamento de navegador, não promessa: no Safari do iPhone o
 * toque num botão nem sempre dá foco, e uma aba escolhida por código (uma volta
 * do histórico, um link que já abre numa aba) não dá foco nenhum. Aqui a
 * garantia é de quem olha o RESULTADO — qual botão tem a classe `on` — e não de
 * como ele chegou lá. É o mesmo caminho de `observar-modais-legados.js`, e pelo
 * mesmo motivo: rastrear cada forma de acontecer é o que deixa uma de fora.
 *
 * FICA NA MOLDURA, LIGADO UMA VEZ. As quatro telas usam a mesma classe global;
 * um observador só vale para as quatro, e para a quinta que vier. Nenhuma delas
 * precisa saber que ele existe — e as abas da Acessos são `onclick="..."` como
 * STRING dentro do template, fora do alcance de qualquer `import`.
 */

const BARRA = '.abas'
const ATIVA = 'button.on'

/* `block:'nearest'` e `inline:'nearest'` de propósito: rolam o MENOS possível
 * para o botão caber, e não fazem NADA quando ele já está inteiro na vista —
 * que é o caso do computador, onde as cinco abas cabem numa linha com sobra.
 * Sem o `block:'nearest'`, o padrão (`start`) rolaria a PÁGINA para pôr a barra
 * no alto toda vez que alguém trocasse de aba. */
function trazerAAtivaParaAVista(barra) {
  const ativa = barra.querySelector(ATIVA)
  if (!ativa) return
  ativa.scrollIntoView({ block: 'nearest', inline: 'nearest' })
}

export function observarAbaAtiva() {
  if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return

  const observador = new MutationObserver((mudancas) => {
    // um Set porque uma troca de aba mexe em DOIS botões (o que perde a classe
    // e o que ganha), e rolar duas vezes para o mesmo lugar é trabalho à toa
    const barras = new Set()
    for (const m of mudancas) {
      if (m.type === 'attributes') {
        const barra = m.target.closest?.(BARRA)
        if (barra) barras.add(barra)
        continue
      }
      // tela nova entrou: a barra dela pode nascer com a ativa fora da vista
      for (const no of m.addedNodes) {
        if (no.nodeType !== 1) continue
        if (no.matches?.(BARRA)) barras.add(no)
        no.querySelectorAll?.(BARRA).forEach((b) => barras.add(b))
      }
    }
    barras.forEach(trazerAAtivaParaAVista)
  })

  observador.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    // SÓ `class`: é ela que diz qual aba está ativa. Sem o filtro, qualquer
    // mudança de estilo da tela inteira (um gráfico redesenhando, por exemplo)
    // dispararia o callback à toa — o mesmo cuidado de `observar-modais-legados`.
    attributeFilter: ['class'],
  })

  // e a primeira barra da sessão, que já pode estar na tela antes daqui
  document.querySelectorAll(BARRA).forEach(trazerAAtivaParaAVista)
  return observador
}
