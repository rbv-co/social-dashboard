// O MAPA DE PINS — desenha, arrasta, dá zoom e põe pin no lugar exato.
//
// Só desenho e evento: TODA conta de onde as coisas ficam mora em
// `mapa-de-pins.js`, que é puro e testado. Aqui não há uma linha de projeção.
//
// POR QUE ELE EXISTE (dono, 12/08/2026): "após 25 pins some o mapa e eu fico sem
// saber se está correto a coordenada". Medido no Graph no mesmo dia: quatro
// conjuntos passam de 25 lugares (três com 26, um com 32). Aqui não há teto —
// quantos pins houver, todos aparecem, e `enquadrar` abre já mostrando todos.
import {
  quadradinhosVisiveis, posicaoNaJanela, coordenadaDoClique, raioEmPixels,
  enquadrar, ZOOM_MINIMO, ZOOM_MAXIMO,
} from './mapa-de-pins.js';

// Servidor de quadradinhos do OpenStreetMap. Sem chave, sem conta e sem
// dependência — só `<img>`. A regra de uso deles pede que a origem apareça na
// tela, e por isso o crédito no rodapé do mapa não é enfeite: é a licença.
const URL_DO_QUADRADINHO = (x, y, z) => `https://tile.openstreetmap.org/${z}/${x}/${y}.png`;
const CREDITO = '© OpenStreetMap';

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// O CSS VIAJA COM O COMPONENTE, e não no <style scoped> da tela.
//
// POR QUÊ: o modal do público é criado com `document.body.appendChild`, ou seja,
// FORA da raiz `.tela-gestao-trafego`. Regra com `:deep()` não alcança ele — é
// por isso que o resto daquele modal usa estilo inline. Injetar uma vez aqui
// mantém a regra perto do desenho e não espalha nada pelo app: todo seletor
// começa com `.gt-mapa`.
const CSS = `
.gt-mapa{margin:6px 0 10px;}
.gt-mapa-tela{position:relative;overflow:hidden;height:320px;border:1px solid var(--border,#2a2a2a);border-radius:10px;background:var(--surface2,#11161c);cursor:crosshair;touch-action:none;user-select:none;}
.gt-mapa-tela:focus-visible{outline:2px solid var(--accent,#4f7cff);outline-offset:2px;}
.gt-mapa-quadradinhos,.gt-mapa-pins{position:absolute;inset:0;}
.gt-mapa-pins{pointer-events:none;}
.gt-mapa-q{position:absolute;width:256px;height:256px;}
.gt-mapa-raio{position:absolute;border-radius:50%;background:rgba(79,124,255,.18);border:1px solid rgba(79,124,255,.55);}
/* o alfinete: 22px de alvo de toque, com a PONTA na coordenada (por isso o
   translate desce só metade da largura e a altura inteira). */
.gt-mapa-pin{position:absolute;width:22px;height:22px;margin:-22px 0 0 -11px;pointer-events:auto;cursor:pointer;
  background:var(--accent,#4f7cff);border:2px solid #fff;border-radius:50% 50% 50% 0;transform:rotate(-45deg);box-shadow:0 1px 4px rgba(0,0,0,.5);}
.gt-mapa-pin:hover{filter:brightness(1.2);}
/* A marca de "a área inteira": quadrada e chapada, DE PROPÓSITO diferente do
   alfinete — e sem círculo em volta, porque área não tem raio. Um círculo aqui
   faria o dono acreditar que o anúncio para na borda dele. */
.gt-mapa-area{position:absolute;width:14px;height:14px;margin:-7px 0 0 -7px;pointer-events:none;
  background:var(--surface,#151a20);border:2px solid var(--accent,#4f7cff);border-radius:3px;box-shadow:0 1px 4px rgba(0,0,0,.5);}
.gt-mapa-credito{position:absolute;right:4px;bottom:3px;font-size:max(9px, calc(10px * var(--escala-texto, 1)));padding:1px 5px;border-radius:4px;background:rgba(0,0,0,.5);color:#fff;pointer-events:none;}
.gt-mapa-controles{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-top:8px;}
.gt-mapa-bt{min-width:40px;min-height:40px;padding:0 12px;border:1px solid var(--border,#2a2a2a);border-radius:8px;background:var(--surface,#151a20);color:var(--text,#e6edf3);font-size:max(9px, calc(15px * var(--escala-texto, 1)));cursor:pointer;}
.gt-mapa-bt--largo{min-width:auto;font-size:max(9px, calc(13px * var(--escala-texto, 1)));}
.gt-mapa-bt:hover{border-color:var(--accent,#4f7cff);}
.gt-mapa-dica{font-size:max(9px, calc(12px * var(--escala-texto, 1)));color:var(--muted,#93a3b3);}
.gt-mapa-lista{margin-top:8px;display:flex;flex-direction:column;gap:6px;}
.gt-mapa-vazio{margin:0;font-size:max(9px, calc(12px * var(--escala-texto, 1)));color:var(--muted,#93a3b3);}
.gt-mapa-linha{display:flex;flex-wrap:wrap;align-items:center;gap:8px;font-size:max(9px, calc(12px * var(--escala-texto, 1)));color:var(--text,#e6edf3);}
.gt-mapa-linha-nome{flex:1 1 180px;overflow-wrap:anywhere;}
.gt-mapa-linha-raio{width:74px;min-height:40px;font-size:max(16px, calc(16px * var(--escala-texto, 1)));padding:0 8px;border:1px solid var(--border,#2a2a2a);border-radius:8px;background:var(--surface2,#11161c);color:var(--text,#e6edf3);}
.gt-mapa-linha-un{color:var(--muted,#93a3b3);}
.gt-mapa-linha-tirar{min-height:40px;padding:0 12px;border:1px solid var(--border,#2a2a2a);border-radius:8px;background:none;color:var(--muted,#93a3b3);font-size:max(9px, calc(12px * var(--escala-texto, 1)));cursor:pointer;}
.gt-mapa-linha-tirar:hover{border-color:var(--red,#dc2626);color:var(--red,#dc2626);}
@media(max-width:640px){.gt-mapa-tela{height:260px;}}
`;

function garantirCss() {
  if (typeof document === 'undefined' || document.getElementById('gt-mapa-css')) return;
  const el = document.createElement('style');
  el.id = 'gt-mapa-css';
  el.textContent = CSS;
  document.head.appendChild(el);
}

// Monta o mapa dentro de `alvo`. `opcoes`:
//   lugares     [{comoMirar,lat,lng,raio,unidade,nome}] — a lista viva; o mapa
//               NÃO a copia, ele mexe nela. É a MESMA lista do painel de lugares.
//   editavel    bool          — sem isto, só olha
//   aoMudar()                 — chamado quando a lista muda
//   aoPorPonto(ponto)         — chamado quando um ponto nasce do clique; quem
//                               chamou busca o endereço e manda desenhar de novo
//
// MUDOU DE `pins` PARA `lugares` em 13/08/2026: o dono passou a escolher entre
// "a área inteira" e "ponto com raio" na mesma linha, e duas listas paralelas
// teriam duas verdades sobre o mesmo lugar.
export function montarMapa(alvo, opcoes) {
  const o = opcoes || {};
  const lugares = o.lugares || [];
  const temCoordenada = (l) => l && Number.isFinite(Number(l.lat)) && Number.isFinite(Number(l.lng));
  const pontos = () => lugares.filter((l) => temCoordenada(l) && l.comoMirar === 'ponto');
  const areas = () => lugares.filter((l) => temCoordenada(l) && l.comoMirar !== 'ponto');
  const editavel = !!o.editavel;
  garantirCss();

  alvo.innerHTML = `
    <div class="gt-mapa">
      <div class="gt-mapa-tela" tabindex="0" role="application" aria-label="Mapa dos pontos">
        <div class="gt-mapa-quadradinhos"></div>
        <div class="gt-mapa-pins"></div>
        <div class="gt-mapa-credito">${CREDITO}</div>
      </div>
      <div class="gt-mapa-controles">
        <button type="button" class="gt-mapa-bt" data-mapa="menos" aria-label="Afastar">−</button>
        <button type="button" class="gt-mapa-bt" data-mapa="mais" aria-label="Aproximar">+</button>
        <button type="button" class="gt-mapa-bt gt-mapa-bt--largo" data-mapa="tudo">Ver todos</button>
        <span class="gt-mapa-dica"></span>
      </div>
    </div>`;

  const tela = alvo.querySelector('.gt-mapa-tela');
  const camadaQ = alvo.querySelector('.gt-mapa-quadradinhos');
  const camadaP = alvo.querySelector('.gt-mapa-pins');
  const dica = alvo.querySelector('.gt-mapa-dica');

  // Estado do mapa. Começa enquadrando os pins que já existem — é o pedido
  // inteiro: ver de uma vez se as coordenadas estão certas.
  const tamanho = () => ({ largura: tela.clientWidth || 640, altura: tela.clientHeight || 320 });
  let vista = enquadrar([...pontos(), ...areas()], tamanho().largura, tamanho().altura)
    // Sem pin, abre no centro do estado de SP, que é onde as contas anunciam.
    || { centro: { lat: -22.9099, lng: -47.0626 }, zoom: 9 };

  function desenhar() {
    const { largura, altura } = tamanho();
    const janela = { centro: vista.centro, zoom: vista.zoom, largura, altura };

    const { quadradinhos } = quadradinhosVisiveis(janela);
    camadaQ.innerHTML = quadradinhos.map((q) => `<img class="gt-mapa-q" alt="" loading="lazy" draggable="false"`
      + ` src="${URL_DO_QUADRADINHO(q.x, q.y, q.z)}"`
      + ` style="left:${q.esquerda}px;top:${q.topo}px">`).join('');

    // ÁREA NÃO LEVA CÍRCULO. Um alfinete com círculo diria uma mentira: "a
    // cidade inteira" não tem raio nenhum, e o círculo faria o dono acreditar
    // que o anúncio para na borda dele.
    const desenhoDasAreas = areas().map((a) => {
      const pos = posicaoNaJanela(a, janela);
      return `<span class="gt-mapa-area" style="left:${pos.esquerda}px;top:${pos.topo}px" title="${esc(a.nome || '')} — a área inteira"></span>`;
    }).join('');

    const desenhoDosPontos = pontos().map((p) => {
      const pos = posicaoNaJanela(p, janela);
      const raio = raioEmPixels(p.lat, p.raio, p.unidade, janela.zoom);
      const circulo = raio > 2
        ? `<span class="gt-mapa-raio" style="left:${pos.esquerda - raio}px;top:${pos.topo - raio}px;width:${raio * 2}px;height:${raio * 2}px"></span>`
        : '';
      const rotulo = p.nome || `${Number(p.lat).toFixed(4)}, ${Number(p.lng).toFixed(4)}`;
      // O índice é o da LISTA INTEIRA, não o da lista filtrada: é ele que o
      // clique usa para tirar o ponto certo.
      const indice = lugares.indexOf(p);
      return circulo + `<span class="gt-mapa-pin" data-pin="${indice}" style="left:${pos.esquerda}px;top:${pos.topo}px" title="${esc(rotulo)}"></span>`;
    }).join('');

    camadaP.innerHTML = desenhoDasAreas + desenhoDosPontos;

    const quantos = pontos().length + areas().length;
    dica.textContent = quantos
      ? `${quantos} lugar${quantos > 1 ? 'es' : ''} no mapa · zoom ${vista.zoom}`
      : (editavel ? 'Nenhum lugar no mapa ainda — clique para pôr um ponto.' : 'Nenhum lugar no mapa.');
  }

  // ── arrastar ──────────────────────────────────────────────────────────────
  // Guarda se ARRASTOU: sem isto, soltar o mouse depois de arrastar contaria
  // como clique e plantaria um pin onde a pessoa só queria mover o mapa.
  let arrastando = null;
  let arrastou = false;

  tela.addEventListener('pointerdown', (ev) => {
    if (ev.target.closest('[data-pin]')) return;
    arrastando = { x: ev.clientX, y: ev.clientY };
    arrastou = false;
    tela.setPointerCapture(ev.pointerId);
  });
  tela.addEventListener('pointermove', (ev) => {
    if (!arrastando) return;
    const dx = ev.clientX - arrastando.x;
    const dy = ev.clientY - arrastando.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) arrastou = true;
    const { largura, altura } = tamanho();
    const janela = { centro: vista.centro, zoom: vista.zoom, largura, altura };
    // Mover o mapa é mover o CENTRO no sentido contrário do dedo.
    vista.centro = coordenadaDoClique({ esquerda: largura / 2 - dx, topo: altura / 2 - dy }, janela);
    arrastando = { x: ev.clientX, y: ev.clientY };
    desenhar();
  });
  const soltar = (ev) => {
    if (!arrastando) return;
    arrastando = null;
    if (ev && ev.pointerId != null && tela.hasPointerCapture && tela.hasPointerCapture(ev.pointerId)) {
      tela.releasePointerCapture(ev.pointerId);
    }
  };
  tela.addEventListener('pointerup', soltar);
  tela.addEventListener('pointercancel', soltar);

  // ── clique põe pin ────────────────────────────────────────────────────────
  tela.addEventListener('click', (ev) => {
    if (!editavel || arrastou) return;
    if (ev.target.closest('[data-pin]')) return;
    const r = tela.getBoundingClientRect();
    const { largura, altura } = tamanho();
    const c = coordenadaDoClique(
      { esquerda: ev.clientX - r.left, topo: ev.clientY - r.top },
      { centro: vista.centro, zoom: vista.zoom, largura, altura },
    );
    // Raio 1 km é o que a Mantova usa nos pins de condomínio (medido). Não é
    // chute nosso: é o valor que os conjuntos reais mais repetem.
    const novo = {
      tipo: 'local', chave: null, nome: '', endereco: '',
      comoMirar: 'ponto', lat: c.lat, lng: c.lng,
      raio: 1, unidade: 'kilometer', pais: 'BR',
      // O NOME AINDA NÃO CHEGOU, e o alfinete não espera por ele: desenhar só
      // depois da resposta faria o mapa parecer travado no clique.
      procurandoNome: true,
    };
    lugares.push(novo);
    desenhar();
    if (o.aoMudar) o.aoMudar();
    if (o.aoPorPonto) o.aoPorPonto(novo);
  });

  // Clicar no pin tira o pin.
  camadaP.addEventListener('click', (ev) => {
    const alvoPin = ev.target.closest('[data-pin]');
    if (!alvoPin || !editavel) return;
    ev.stopPropagation();
    lugares.splice(Number(alvoPin.dataset.pin), 1);
    desenhar();
    if (o.aoMudar) o.aoMudar();
  });

  // ── zoom ──────────────────────────────────────────────────────────────────
  const mudarZoom = (delta) => {
    vista.zoom = Math.max(ZOOM_MINIMO, Math.min(ZOOM_MAXIMO, vista.zoom + delta));
    desenhar();
  };
  for (const bt of alvo.querySelectorAll('[data-mapa]')) {
    bt.addEventListener('click', (ev) => {
      ev.preventDefault(); ev.stopPropagation();
      const q = bt.dataset.mapa;
      if (q === 'mais') mudarZoom(1);
      else if (q === 'menos') mudarZoom(-1);
      else if (q === 'tudo') {
        const { largura, altura } = tamanho();
        vista = enquadrar([...pontos(), ...areas()], largura, altura) || vista;
        desenhar();
      }
    });
  }
  // A roda do mouse dá zoom, mas só com o mapa em foco/hover — senão rolar a
  // página com o cursor por cima do mapa daria zoom sem querer.
  tela.addEventListener('wheel', (ev) => { ev.preventDefault(); mudarZoom(ev.deltaY < 0 ? 1 : -1); }, { passive: false });

  desenhar();
  return { desenhar, enquadrarTudo: () => {
    const { largura, altura } = tamanho();
    vista = enquadrar([...pontos(), ...areas()], largura, altura) || vista;
    desenhar();
  } };
}
