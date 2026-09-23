// O modal do FUNIL: um bloco por objetivo que a conta roda hoje.
//
// Por que um modal e não uma aba: o funil responde "como está indo o que está no
// ar", uma pergunta que se faz olhando as campanhas — não um lugar onde se
// mora. Sai da frente com Esc e devolve a lista.
//
// PURO no mesmo sentido de painel-fila.js: monta innerHTML e liga listeners no
// elemento recebido, sem ler `window`, sem rede.
import { montarFunis, etapasDoFunil, porUnidade, quebraDeInteracoes } from './funil.js';
import { pastilha } from './pastilha.js';

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = (v) => Number(v || 0).toLocaleString('pt-BR');
const reais = (v) => v == null ? '—' : 'R$ ' + Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const reaisCurto = (v) => 'R$ ' + Number(v || 0).toLocaleString('pt-BR', { maximumFractionDigits: 0 });

// O que as pessoas de fato fizeram, quando o objetivo é engajamento. "212.407
// interações" não diz se foram curtidas de passagem ou salvamentos — e é essa
// diferença que a régua pondera. O peso vai junto para a leitura fechar: 200 mil
// curtidas (peso 1) podem valer menos que 500 salvamentos (peso 30).
function blocoInteracoes(f) {
  const linhas = quebraDeInteracoes(f);
  if (!linhas.length) return '';
  const itens = linhas.map((l) => `
    <li class="gfn-int">
      <span class="gfn-int-rot">${esc(l.rotulo)}</span>
      <span class="gfn-int-barra"><span style="width:${Math.max(2, Math.round(l.fatia * 100))}%"></span></span>
      <span class="gfn-int-qtd">${num(l.quantidade)}</span>
      <span class="gfn-int-pct">${(l.fatia * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%</span>
      ${l.peso != null ? `<span class="gfn-int-peso" title="Peso na régua: cada uma vale ${l.peso}">vale ${l.peso}</span>` : ''}
    </li>`).join('');
  return `<div class="gfn-interacoes"><div class="gfn-int-tit">O que fizeram</div><ul class="gfn-int-lista">${itens}</ul></div>`;
}

function blocoFunil(f) {
  const etapas = etapasDoFunil(f);
  const barras = etapas.map((e) => `
    <div class="gfn-etapa">
      <div class="gfn-et-topo">
        <span class="gfn-et-rot">${esc(e.rotulo)}</span>
        <span class="gfn-et-val">${num(e.valor)}</span>
      </div>
      ${e.largura != null
        ? `<div class="gfn-barra"><div class="gfn-barra-in" style="width:${e.largura}%"></div></div>`
        : '<div class="gfn-sem-barra"></div>'}
      ${e.nota ? `<div class="gfn-et-nota">${esc(e.nota)}</div>` : ''}
    </div>`).join('');

  // O tipo aparece escrito. Sem isso, alguém compara "12% de quem clicou" com
  // "0,44 por pessoa" achando que são a mesma medida em objetivos diferentes.
  const selo = f.tipo === 'funil'
    ? '<span class="gfn-tipo funil">cada etapa vem depois da outra</span>'
    : '<span class="gfn-tipo proporcao">o resultado não vem depois do clique — é uma proporção</span>';

  return `
    <section class="gfn-bloco" data-balde="${esc(f.balde || '')}">
      <header class="gfn-cab">
        <div>
          <h3 class="gfn-tit">${pastilha('funil')}${esc(f.rotulo)}</h3>
          <span class="gfn-sub">${f.campanhas} campanha${f.campanhas > 1 ? 's' : ''} · ${reaisCurto(f.gasto)}${(() => {
          // "R$ 0,00 por interação" mente — abaixo de um centavo a leitura se
          // inverte pra "R$ 1 compra 512 interações" (ver porUnidade).
          const p = porUnidade(f.gasto, f.resultados, f.singular, f.resultadoRotulo, true);
          return p ? ` · ${esc(p.texto)}` : '';
        })()}</span>
        </div>
      </header>
      <p class="gfn-explica">${esc(f.explica)}</p>
      <div class="gfn-etapas">${barras}</div>
      ${blocoInteracoes(f)}
      ${selo}
    </section>`;
}

// opcoes: { campanhas: [{balde, insight}], contaNome, periodoRotulo, aoFechar, ajudaBtn }
export function montarPainelFunil(alvo, opcoes) {
  const o = opcoes || {};
  const funis = montarFunis(o.campanhas || []);
  const ajudaBtn = typeof o.ajudaBtn === 'function' ? o.ajudaBtn : () => '';

  const corpo = funis.length
    ? funis.map(blocoFunil).join('')
    : `<div class="gfn-vazio">
         <b>Nenhuma campanha rodando agora.</b>
         <span>O funil mostra o caminho das campanhas que estão no ar. Assim que uma começar a veicular, ela aparece aqui.</span>
       </div>`;

  alvo.innerHTML = `
    <div class="gfn-fundo" data-gfn-fechar="1"></div>
    <div class="gfn-caixa" role="dialog" aria-label="Funil das campanhas">
      <header class="gfn-topo">
        <div>
          <h2 class="gfn-h2">${pastilha('funil')}Funil das campanhas${ajudaBtn('funil')}</h2>
          <p class="gfn-h2-sub">${esc(o.contaNome || '')}${o.periodoRotulo ? ` · ${esc(o.periodoRotulo)}` : ''} · só o que está no ar agora</p>
        </div>
        <button class="gfn-x" data-gfn-fechar="1" aria-label="Fechar">✕</button>
      </header>
      <div class="gfn-corpo">${corpo}</div>
    </div>`;

  for (const b of alvo.querySelectorAll('[data-gfn-fechar]')) {
    b.addEventListener('click', () => o.aoFechar && o.aoFechar());
  }
}
