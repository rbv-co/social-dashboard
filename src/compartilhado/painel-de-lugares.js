// ESCOLHER ONDE O ANÚNCIO APARECE — Brasil, Estado, Cidade ou Local.
//
// PEDIDO DO DONO (13/08/2026): "eu preciso selecionar entre Brasil, Estado,
// Cidade e Local (estabelecimento, comércio, negócio) e aparece o pin automático
// no mapa e vice versa".
//
// IMPERATIVO E MONTADO NUM ELEMENTO, igual ao `painel-do-mapa.js`, e pela mesma
// razão: ele precisa servir DUAS telas de naturezas diferentes — a Gestão de
// Tráfego, cujo modal é montado com `document.body.appendChild` (fora da raiz do
// componente, onde `:deep()` não alcança), e a Fábrica, que é Vue de verdade.
// Uma peça só, desenhada uma vez.
import { LUGAR_TIPOS, podeVirarPonto, rotuloDoLugar, jaEstaNaLista } from './lugares-do-anuncio.js';
import {
  pedidoDaBusca, lugaresDaRespostaDaMeta, lugaresDaRespostaDoMapa, criarFilaDeUmPorVez,
} from './busca-de-lugar.js';

// Nome de lugar vem de FORA (Meta e OpenStreetMap). Escapar não é zelo teórico:
// é texto de terceiro entrando em innerHTML.
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Mesma razão do CSS viajar com o mapa: o modal do público vive FORA da raiz do
// componente, onde `<style scoped>` não alcança. Todo seletor começa em `.pl-`.
const CSS = `
.pl-tipos{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px;}
.pl-linha{display:flex;flex-wrap:wrap;gap:8px;align-items:center;}
.pl-campo{flex:1 1 200px;min-height:40px;padding:0 10px;border:1px solid var(--border,#2a2a2a);border-radius:8px;
  background:var(--surface2,#11161c);color:var(--text,#e6edf3);font-size:max(16px, calc(16px * var(--escala-texto, 1)));}
.pl-achados{display:flex;flex-direction:column;gap:4px;margin-top:8px;}
.pl-achado{min-height:40px;text-align:left;padding:8px 10px;border:1px solid var(--border,#2a2a2a);border-radius:8px;
  background:none;color:var(--text,#e6edf3);font-size:max(9px, calc(13px * var(--escala-texto, 1)));cursor:pointer;overflow-wrap:anywhere;}
.pl-achado:hover{border-color:var(--accent,#4f7cff);}
.pl-achado-tipo{color:var(--muted,#93a3b3);}
.pl-recado{margin:8px 0 0;font-size:max(9px, calc(12px * var(--escala-texto, 1)));color:var(--muted,#93a3b3);overflow-wrap:anywhere;}
.pl-recado--erro{color:var(--red,#dc2626);}
.pl-lista{margin-top:10px;display:flex;flex-direction:column;gap:8px;}
.pl-item{display:flex;flex-wrap:wrap;gap:8px;align-items:center;font-size:max(9px, calc(13px * var(--escala-texto, 1)));color:var(--text,#e6edf3);}
.pl-item-nome{flex:1 1 180px;overflow-wrap:anywhere;}
.pl-item-raio{width:74px;min-height:40px;padding:0 8px;border:1px solid var(--border,#2a2a2a);border-radius:8px;
  background:var(--surface2,#11161c);color:var(--text,#e6edf3);font-size:max(16px, calc(16px * var(--escala-texto, 1)));}
.pl-item-un{color:var(--muted,#93a3b3);}
.pl-vazio{margin:0;font-size:max(9px, calc(12px * var(--escala-texto, 1)));color:var(--muted,#93a3b3);}
@media(max-width:640px){.pl-item-nome{flex:1 1 100%;}}
`;

function garantirCss() {
  if (typeof document === 'undefined' || document.getElementById('pl-css')) return;
  const el = document.createElement('style');
  el.id = 'pl-css';
  el.textContent = CSS;
  document.head.appendChild(el);
}

const NOME_DO_TIPO = { pais: 'país', estado: 'estado', cidade: 'cidade', bairro: 'bairro', local: 'local' };

// Monta o painel dentro de `alvo`. `opcoes`:
//   lugares         a lista viva (a MESMA que o mapa usa)
//   buscarNaMeta(params) -> Promise      quem chama decide o caminho até a Meta
//   buscarNoMapa(termo)  -> Promise      a recepção (`buscar-lugar`)
//   aoMudar()                            chamado a cada mudança na lista
export function montarPainelDeLugares(alvo, opcoes) {
  const o = opcoes || {};
  const lugares = o.lugares || [];
  const fila = criarFilaDeUmPorVez({});
  garantirCss();

  let tipoAtivo = 'cidade';
  let achados = [];
  let recado = '';
  let recadoEhErro = false;
  let buscando = false;

  alvo.innerHTML = `
    <div class="pl">
      <div class="pl-tipos" role="group" aria-label="Tipo de lugar"></div>
      <div class="pl-linha">
        <input class="pl-campo" type="text" aria-label="Nome do lugar">
        <button type="button" class="btn" data-pl="buscar">Buscar</button>
      </div>
      <div class="pl-achados"></div>
      <p class="pl-recado"></p>
      <div class="pl-lista"></div>
    </div>`;

  const caixaTipos = alvo.querySelector('.pl-tipos');
  const campo = alvo.querySelector('.pl-campo');
  const btBuscar = alvo.querySelector('[data-pl="buscar"]');
  const caixaAchados = alvo.querySelector('.pl-achados');
  const caixaRecado = alvo.querySelector('.pl-recado');
  const caixaLista = alvo.querySelector('.pl-lista');

  function dizer(texto, ehErro) { recado = texto || ''; recadoEhErro = !!ehErro; pintar(); }

  async function buscar() {
    const termo = campo.value.trim();
    if (!termo) return;
    achados = []; buscando = true; dizer('Procurando…', false);
    try {
      const pedido = pedidoDaBusca(tipoAtivo, termo);
      if (pedido.onde === 'meta') {
        achados = lugaresDaRespostaDaMeta(await fila(() => o.buscarNaMeta(pedido.params)));
      } else {
        achados = lugaresDaRespostaDoMapa(await fila(() => o.buscarNoMapa(pedido.params.termo)));
      }
      // "Nada encontrado" é RESULTADO; "não consegui perguntar" é ERRO. A tela
      // nunca pode confundir os dois — lista vazia fingindo de resposta é a
      // mentira mais cara que uma tela conta.
      dizer(achados.length ? '' : 'Nada encontrado para essa busca.', false);
    } catch (e) {
      achados = [];
      dizer('Não consegui buscar agora: ' + String((e && e.message) || e).slice(0, 140), true);
    } finally {
      buscando = false; pintar();
    }
  }

  function acrescentar(achado) {
    if (!achado) return;
    const igual = jaEstaNaLista(lugares, achado);
    const novo = { ...achado };
    if (!igual) lugares.push(novo);
    achados = []; campo.value = ''; dizer('', false);
    if (o.aoMudar) o.aoMudar();
    // "APARECE O PIN AUTOMÁTICO NO MAPA" — a metade do pedido que a Meta não
    // consegue cumprir sozinha: ela não devolve coordenada NENHUMA (medido em
    // 13/08/2026). Quem escolheu "a área inteira" ainda assim precisa VER onde
    // aquilo fica, então a coordenada é procurada no mapa só para desenhar. Ela
    // NÃO muda o que vai para a Meta: área continua indo pela chave.
    if (!igual && novo.lat == null) procurarOndeFica(novo);
  }

  // Descobre a coordenada de um lugar que veio do catálogo da Meta (que não tem
  // coordenada). Falhar aqui não é erro vermelho: o lugar CONTINUA valendo pela
  // chave, e o que se perde é só a marca no mapa — e a linha diz isso.
  async function procurarOndeFica(lugar) {
    lugar.procurandoNome = true; pintar();
    try {
      const r = await fila(() => o.buscarNoMapa([lugar.nome, lugar.uf].filter(Boolean).join(', ')));
      const achado = lugaresDaRespostaDoMapa(r)[0];
      if (achado) { lugar.lat = achado.lat; lugar.lng = achado.lng; lugar.semMarcaNoMapa = false; }
      else lugar.semMarcaNoMapa = true;
    } catch { lugar.semMarcaNoMapa = true; } finally {
      lugar.procurandoNome = false;
      pintar();
      if (o.aoMudar) o.aoMudar();
    }
  }

  // TROCAR "ÁREA INTEIRA" POR "PONTO COM RAIO" PRECISA DE COORDENADA, e a Meta
  // não devolve nenhuma. Se o mapa não souber onde fica, o botão NÃO troca e diz
  // por quê: gravar um ponto sem coordenada seria pôr o anúncio em lugar nenhum,
  // em silêncio.
  async function virarPonto(lugar) {
    if (lugar.lat != null && lugar.lng != null) {
      lugar.comoMirar = 'ponto';
      // 5 km em volta do centro: um ponto de cidade com 1 km pegaria só o
      // quarteirão da prefeitura. Para o Local, o 1 km da busca é que vale.
      if (!(Number(lugar.raio) > 0)) lugar.raio = 5;
      pintar(); if (o.aoMudar) o.aoMudar(); return;
    }
    dizer('Procurando onde fica ' + rotuloDoLugar(lugar) + '…', false);
    await procurarOndeFica(lugar);
    if (lugar.lat == null) {
      dizer('Não achei a coordenada de ' + rotuloDoLugar(lugar) + ' — ele continua valendo como a área inteira.', true);
      return;
    }
    lugar.comoMirar = 'ponto';
    if (!(Number(lugar.raio) > 0)) lugar.raio = 5;
    dizer('', false);
    if (o.aoMudar) o.aoMudar();
  }

  function pintar() {
    caixaTipos.innerHTML = LUGAR_TIPOS.map((t) => (
      `<button type="button" class="btn${t.id === tipoAtivo ? ' btn-principal' : ''}" data-tipo="${esc(t.id)}"`
      + ` aria-pressed="${t.id === tipoAtivo}">${esc(t.rotulo)}</button>`
    )).join('');

    campo.placeholder = tipoAtivo === 'local'
      ? 'nome do comércio, ou o endereço…'
      : 'nome do ' + (NOME_DO_TIPO[tipoAtivo] || 'lugar') + '…';
    btBuscar.disabled = buscando;
    btBuscar.textContent = buscando ? 'Procurando…' : 'Buscar';

    caixaAchados.innerHTML = achados.map((a, i) => (
      `<button type="button" class="pl-achado" data-achado="${i}">${esc(rotuloDoLugar(a))}`
      + ` <span class="pl-achado-tipo">(${esc(NOME_DO_TIPO[a.tipo] || a.tipo)})</span></button>`
    )).join('');

    caixaRecado.textContent = recado;
    caixaRecado.className = 'pl-recado' + (recadoEhErro ? ' pl-recado--erro' : '');

    caixaLista.innerHTML = '';
    if (!lugares.length) {
      const p = document.createElement('p');
      p.className = 'pl-vazio';
      p.textContent = 'Nenhum lugar escolhido ainda. A Meta não aceita anúncio sem lugar.';
      caixaLista.appendChild(p);
    }
    lugares.forEach((l, i) => {
      const linha = document.createElement('div');
      linha.className = 'pl-item';

      const nome = document.createElement('span');
      nome.className = 'pl-item-nome';
      // A tela nunca mente: se a marca não pôde ser desenhada, ela DIZ — e diz
      // também que o lugar continua valendo.
      nome.textContent = rotuloDoLugar(l)
        + (l.procurandoNome ? ' · procurando no mapa…' : '')
        + (l.semMarcaNoMapa && !l.procurandoNome && l.comoMirar !== 'ponto' ? ' · não achei no mapa (continua valendo)' : '');
      linha.appendChild(nome);

      if (podeVirarPonto(l.tipo)) {
        const alterna = document.createElement('button');
        alterna.type = 'button';
        alterna.className = 'btn';
        alterna.textContent = l.comoMirar === 'ponto' ? 'ponto com raio' : 'a área inteira';
        alterna.title = l.comoMirar === 'ponto'
          ? 'Clique para voltar a mirar a área inteira'
          : 'Clique para mirar um ponto com raio em vez da área inteira';
        alterna.setAttribute('aria-label', 'Como mirar ' + rotuloDoLugar(l));
        alterna.onclick = () => {
          if (l.comoMirar === 'ponto') { l.comoMirar = 'area'; pintar(); if (o.aoMudar) o.aoMudar(); }
          else virarPonto(l);
        };
        linha.appendChild(alterna);
      }

      // O RAIO aparece nos dois casos, com significados diferentes — e é por isso
      // que o título de cada um diz qual é. País não tem raio nenhum.
      if (l.tipo !== 'pais') {
        const raio = document.createElement('input');
        raio.type = 'number'; raio.min = '0'; raio.className = 'pl-item-raio';
        raio.value = String(l.raio == null ? 0 : l.raio);
        raio.title = l.comoMirar === 'ponto'
          ? 'Raio do ponto, em km'
          : 'Raio em volta da cidade, em km (0 = a cidade inteira; a Meta não aceita menos de 17)';
        raio.setAttribute('aria-label', 'Raio de ' + rotuloDoLugar(l));
        // Não repinta no `onchange`: repintar tiraria o cursor do campo no meio
        // da digitação (a mesma razão do raio das cidades no editor antigo).
        raio.onchange = () => { l.raio = Number(raio.value) || 0; if (o.aoMudar) o.aoMudar(); };
        linha.appendChild(raio);

        const un = document.createElement('span');
        un.className = 'pl-item-un';
        un.textContent = l.unidade === 'mile' ? 'mi' : 'km';
        linha.appendChild(un);
      }

      const tirar = document.createElement('button');
      tirar.type = 'button';
      tirar.className = 'btn';
      tirar.textContent = 'remover';
      tirar.setAttribute('aria-label', 'Remover ' + rotuloDoLugar(l));
      tirar.onclick = () => { lugares.splice(i, 1); pintar(); if (o.aoMudar) o.aoMudar(); };
      linha.appendChild(tirar);

      caixaLista.appendChild(linha);
    });
  }

  caixaTipos.addEventListener('click', (ev) => {
    const bt = ev.target.closest('[data-tipo]');
    if (!bt) return;
    ev.preventDefault(); ev.stopPropagation();
    tipoAtivo = bt.dataset.tipo; achados = []; dizer('', false);
  });
  caixaAchados.addEventListener('click', (ev) => {
    const bt = ev.target.closest('[data-achado]');
    if (!bt) return;
    ev.preventDefault(); ev.stopPropagation();
    acrescentar(achados[Number(bt.dataset.achado)]);
  });
  btBuscar.addEventListener('click', (ev) => { ev.preventDefault(); ev.stopPropagation(); buscar(); });
  campo.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); buscar(); } });

  pintar();

  // OS LUGARES QUE JÁ VIERAM DO CONJUNTO também precisam aparecer no mapa.
  //
  // ACHADO NA PROVA (13/08/2026): o lugar recém-escolhido ganhava a marca
  // sozinho, mas a cidade que já estava no conjunto ficava fora do mapa — o mapa
  // abria vazio para quem só queria CONFERIR o que já existe, que é metade do
  // pedido. Vão pela mesma fila de uma por vez, no fundo, sem travar a tela.
  for (const l of lugares) {
    if (l && l.comoMirar !== 'ponto' && l.lat == null && l.nome) procurarOndeFica(l);
  }

  return { redesenhar: pintar, dizer };
}
