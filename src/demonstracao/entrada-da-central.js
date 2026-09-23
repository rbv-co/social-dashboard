/* A ENTRADA DA CENTRAL NA DEMONSTRAÇÃO (`demonstracao/central.html`).
 *
 * ⚠️ A ORDEM: primeiro o banco de mentira (troca `window.fetch`, põe a sessão
 * de mentira), DEPOIS a Central — por `import()` dinâmico, que só roda quando
 * esta linha chega. Um `import` estático da Central aqui em cima seria içado
 * para antes da troca, e o supabase-js guardaria o `fetch` de verdade.
 *
 * ⚠️ NADA DAQUI MORA NA CENTRAL. `index.html` e `ponto-de-partida.js` não
 * importam esta pasta — o teste `isolamento.test.mjs` confere.
 */
import '../estilos/estilos-globais.css'
import './faixa-da-demonstracao.css'
import { instalarBancoDeMentira, podeInstalar } from './instalar-banco-de-mentira.js'
import { ORIGEM_DOS_AVISOS } from './roteiro.js'
import { mensagemDeSituacaoDoEncontro } from '../ferramentas/comercial-vessel/t11-regras.js'

const FRASE_DA_FAIXA = 'Modo demonstração — nada é salvo. Recarregar volta ao começo.'

function mostrarFaixa() {
  document.documentElement.classList.add('modo-demonstracao')
  const faixa = document.createElement('div')
  faixa.className = 'faixa-demonstracao'
  faixa.setAttribute('role', 'status')
  faixa.textContent = FRASE_DA_FAIXA
  document.body.prepend(faixa)
  // A altura da faixa muda quando a frase quebra em duas linhas (celular
  // estreito, letra maior): quem desce a Central para caber embaixo dela lê a
  // altura MEDIDA, nunca um número escolhido.
  const medir = () => document.documentElement.style.setProperty('--faixa-demo', `${faixa.offsetHeight}px`)
  medir()
  try { new ResizeObserver(medir).observe(faixa) } catch { window.addEventListener('resize', medir) }
}

/* ⚠️ "CANCELAR SEM MOTIVO" NÃO CHEGA AO BANCO. A tela do Private Edit confere
 * o motivo ANTES de chamar (`gravarSituacao`) e mostra a frase de
 * `mensagemDeSituacaoDoEncontro('sem_motivo')` sem ida ao banco — então o banco
 * de mentira nunca vê a recusa. Quem avisa o roteiro é esta vigia: a mesma
 * frase aparecendo numa nota de erro. (Se um dia a tela deixar a recusa para o
 * banco, o banco de mentira avisa também — os dois caminhos marcam o passo.) */
function vigiarRecusaSemMotivo() {
  const frase = mensagemDeSituacaoDoEncontro('sem_motivo')
  const vistas = new WeakSet()
  const conferir = () => {
    for (const el of document.querySelectorAll('.cv-nota-erro')) {
      if (vistas.has(el) || el.textContent.trim() !== frase) continue
      vistas.add(el)
      try { window.parent.postMessage({ origem: ORIGEM_DOS_AVISOS, evento: 'recusa_sem_motivo', dados: {} }, '*') } catch { /* sem roteiro */ }
    }
  }
  new MutationObserver(conferir).observe(document.body, { childList: true, subtree: true, characterData: true })
}

/* O tema da Central de dentro acompanha o do aparelho — o mesmo que a página
 * do roteiro usa em volta. Quem troca pelo painel da Central continua podendo. */
function seguirOTemaDoAparelho() {
  const escuro = window.matchMedia?.('(prefers-color-scheme: dark)')
  escuro?.addEventListener?.('change', () => {
    const tema = escuro.matches ? 'dark' : 'light'
    document.documentElement.dataset.theme = tema
    try { localStorage.setItem('tema', tema) } catch { /* modo privado */ }
  })
}

function recusar() {
  document.body.replaceChildren()
  const p = document.createElement('p')
  p.className = 'faixa-demonstracao-recusa'
  p.textContent = 'Este navegador já tem uma sessão de verdade da Central neste endereço. '
    + 'A demonstração não abre aqui para não apagá-la: abra-a no endereço próprio dela.'
  document.body.append(p)
}

async function iniciar() {
  if (!podeInstalar(localStorage)) { recusar(); return }
  instalarBancoDeMentira()
  mostrarFaixa()
  vigiarRecusaSemMotivo()
  seguirOTemaDoAparelho()
  // A demonstração abre direto no Comercial Vessel.
  if (!location.hash || location.hash === '#' || location.hash === '#/') {
    history.replaceState(null, '', `${location.pathname}${location.search}#/comercial-vessel`)
  }
  await import('../ponto-de-partida.js')
}

iniciar()
