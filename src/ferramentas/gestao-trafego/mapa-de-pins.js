// A MATEMÁTICA DO MAPA — converter coordenada em pixel e de volta.
//
// PEDIDO DO DONO (12/08/2026): "trazer a geolocalização na hora de definir
// local, eu poder colocar o pin em cima de local exato seria ótimo, sem o limite
// de 25 pins do meta (após 25 some o mapa e eu fico sem saber se está correto a
// coordenada)".
//
// MEDIDO NO GRAPH em 12/08/2026, e o problema é real: dos 292 conjuntos com
// localização, 26 JÁ USAM pin (`custom_locations`) — a Mantova segmenta
// condomínio assim. E quatro conjuntos passam dos 25 lugares (três com 26, um
// com 32), que é exatamente onde o mapa da Meta some e ele fica no escuro.
//
// POR QUE SEM BIBLIOTECA DE MAPA: o projeto tem TRÊS dependências. Um mapa de
// quadradinhos ("slippery map") é aritmética de Mercator — projeção, zoom e
// posição —, e aritmética é justamente o que este projeto sabe testar. A tela
// desenha `<img>` com os quadradinhos; a decisão de ONDE cada coisa fica é toda
// daqui.
//
// PURO: sem tela, sem rede.

// Lado do quadradinho do OpenStreetMap. Não é escolha nossa — é o padrão que os
// servidores de mapa servem.
export const LADO_DO_QUADRADINHO = 256;

// Limite da projeção de Mercator. Além disso a conta estoura no infinito (a
// projeção não representa os polos), então o mapa inteiro para aqui.
export const LATITUDE_MAXIMA = 85.05112878;

export const ZOOM_MINIMO = 3;
export const ZOOM_MAXIMO = 18;

const limitar = (v, min, max) => Math.min(max, Math.max(min, v));

// ── coordenada → pixel do mundo ─────────────────────────────────────────────
//
// "Pixel do mundo" é a posição num mapa imaginário que cobre a Terra inteira
// naquele zoom: no zoom 0 ele tem 256×256 pixels, e cada zoom dobra o tamanho.

export function mundoEmPixels(zoom) {
  return LADO_DO_QUADRADINHO * (2 ** zoom);
}

export function paraPixel(lat, lng, zoom) {
  const tamanho = mundoEmPixels(zoom);
  const la = limitar(Number(lat), -LATITUDE_MAXIMA, LATITUDE_MAXIMA) * Math.PI / 180;
  const x = (Number(lng) + 180) / 360 * tamanho;
  // A fórmula de Mercator. `Math.log(Math.tan(la) + 1 / Math.cos(la))` é a
  // mesma coisa que asinh(tan(la)), escrita do jeito que se confere na mão.
  const y = (1 - Math.log(Math.tan(la) + 1 / Math.cos(la)) / Math.PI) / 2 * tamanho;
  return { x, y };
}

export function paraCoordenada(x, y, zoom) {
  const tamanho = mundoEmPixels(zoom);
  const lng = (Number(x) / tamanho) * 360 - 180;
  const n = Math.PI * (1 - 2 * Number(y) / tamanho);
  const lat = Math.atan(Math.sinh(n)) * 180 / Math.PI;
  return { lat, lng };
}

// ── quadradinhos visíveis ───────────────────────────────────────────────────
//
// Devolve a lista de quadradinhos que cobrem a janela, já com a posição em que
// cada um deve ser desenhado DENTRO dela. A tela só faz `<img src=url>` e
// posiciona — nenhuma conta lá.

export function quadradinhosVisiveis({ centro, zoom, largura, altura }) {
  const z = Math.round(limitar(zoom, ZOOM_MINIMO, ZOOM_MAXIMO));
  const meio = paraPixel(centro.lat, centro.lng, z);
  // Canto de cima à esquerda da janela, em pixel do mundo.
  const origemX = meio.x - largura / 2;
  const origemY = meio.y - altura / 2;

  const primeiroX = Math.floor(origemX / LADO_DO_QUADRADINHO);
  const primeiroY = Math.floor(origemY / LADO_DO_QUADRADINHO);
  const ultimoX = Math.floor((origemX + largura) / LADO_DO_QUADRADINHO);
  const ultimoY = Math.floor((origemY + altura) / LADO_DO_QUADRADINHO);

  const total = 2 ** z;
  const saida = [];
  for (let ty = primeiroY; ty <= ultimoY; ty++) {
    // Fora do mundo na vertical não existe (não há mapa acima do polo).
    if (ty < 0 || ty >= total) continue;
    for (let tx = primeiroX; tx <= ultimoX; tx++) {
      // Na horizontal o mundo DÁ A VOLTA: tx -1 é o último quadradinho.
      const x = ((tx % total) + total) % total;
      saida.push({
        x, y: ty, z,
        esquerda: tx * LADO_DO_QUADRADINHO - origemX,
        topo: ty * LADO_DO_QUADRADINHO - origemY,
      });
    }
  }
  return { quadradinhos: saida, origemX, origemY, zoom: z };
}

// Onde um ponto cai DENTRO da janela. Fora dela vem negativo ou maior que a
// largura de propósito — quem desenha decide se esconde ou recorta.
export function posicaoNaJanela({ lat, lng }, { centro, zoom, largura, altura }) {
  const z = Math.round(limitar(zoom, ZOOM_MINIMO, ZOOM_MAXIMO));
  const meio = paraPixel(centro.lat, centro.lng, z);
  const p = paraPixel(lat, lng, z);
  return { esquerda: p.x - meio.x + largura / 2, topo: p.y - meio.y + altura / 2 };
}

// O contrário: um clique na janela vira coordenada. É isto que põe o pin no
// lugar exato que o dono apontou.
export function coordenadaDoClique({ esquerda, topo }, { centro, zoom, largura, altura }) {
  const z = Math.round(limitar(zoom, ZOOM_MINIMO, ZOOM_MAXIMO));
  const meio = paraPixel(centro.lat, centro.lng, z);
  return paraCoordenada(meio.x - largura / 2 + esquerda, meio.y - altura / 2 + topo, z);
}

// ── raio ────────────────────────────────────────────────────────────────────
//
// O raio do pin é em QUILÔMETRO (ou milha) e o círculo na tela é em pixel. A
// conversão depende da latitude: perto do equador um pixel cobre mais chão do
// que perto do polo, porque Mercator estica o mapa conforme sobe.

// Circunferência da Terra dividida por 256 — metros por pixel no zoom 0, no equador.
const METROS_POR_PIXEL_NO_EQUADOR = 156543.03392804097;

export function metrosPorPixel(lat, zoom) {
  const la = limitar(Number(lat), -LATITUDE_MAXIMA, LATITUDE_MAXIMA) * Math.PI / 180;
  return METROS_POR_PIXEL_NO_EQUADOR * Math.cos(la) / (2 ** zoom);
}

export function raioEmPixels(lat, raio, unidade, zoom) {
  const metros = Number(raio) * (unidade === 'mile' ? 1609.344 : 1000);
  if (!Number.isFinite(metros) || metros <= 0) return 0;
  return metros / metrosPorPixel(lat, zoom);
}

// ── enquadrar ───────────────────────────────────────────────────────────────
//
// O ZOOM E O CENTRO QUE MOSTRAM TODOS OS PINS DE UMA VEZ. É o coração do
// pedido: com 32 pins o mapa da Meta some e ele não consegue conferir nenhum.
// Aqui, quantos forem, a tela abre já mostrando todos.
export function enquadrar(pins, largura, altura, folga = 48) {
  const lista = (pins || []).filter((p) => Number.isFinite(Number(p.lat)) && Number.isFinite(Number(p.lng)));
  if (!lista.length) return null;

  if (lista.length === 1) {
    const p = lista[0];
    // Um pin só não tem "área" pra enquadrar: usa o raio dele pra decidir o
    // zoom, senão abriria no mundo inteiro ou colado demais.
    const raioKm = Number(p.raio) > 0 ? Number(p.raio) : 2;
    const metros = raioKm * (p.unidade === 'mile' ? 1609.344 : 1000) * 2.5;
    let z = ZOOM_MAXIMO;
    while (z > ZOOM_MINIMO && metros / metrosPorPixel(Number(p.lat), z) > Math.min(largura, altura) / 2) z--;
    return { centro: { lat: Number(p.lat), lng: Number(p.lng) }, zoom: z };
  }

  const lats = lista.map((p) => Number(p.lat));
  const lngs = lista.map((p) => Number(p.lng));
  const centro = {
    lat: (Math.min(...lats) + Math.max(...lats)) / 2,
    lng: (Math.min(...lngs) + Math.max(...lngs)) / 2,
  };

  // Desce o zoom até tudo caber. Testar de cima pra baixo devolve SEMPRE o maior
  // zoom que serve — o mais perto possível sem cortar ninguém.
  const util = { largura: Math.max(1, largura - folga * 2), altura: Math.max(1, altura - folga * 2) };
  for (let z = ZOOM_MAXIMO; z > ZOOM_MINIMO; z--) {
    const pontos = lista.map((p) => paraPixel(Number(p.lat), Number(p.lng), z));
    const larg = Math.max(...pontos.map((q) => q.x)) - Math.min(...pontos.map((q) => q.x));
    const alt = Math.max(...pontos.map((q) => q.y)) - Math.min(...pontos.map((q) => q.y));
    if (larg <= util.largura && alt <= util.altura) return { centro, zoom: z };
  }
  return { centro, zoom: ZOOM_MINIMO };
}

// ── o pin no formato da Meta ────────────────────────────────────────────────
//
// MEDIDO nos conjuntos reais (12/08/2026): a Meta devolve
// { name?, address_string?, distance_unit, latitude, longitude, radius,
//   primary_city_id?, region_id?, country }.
// `primary_city_id` e `region_id` vêm DELA e viajam de volta como estavam —
// inventar esses números seria apontar o anúncio pra outra cidade.
export function pinParaMeta(pin) {
  const saida = {
    latitude: Number(Number(pin.lat).toFixed(6)),
    longitude: Number(Number(pin.lng).toFixed(6)),
    radius: Number(pin.raio) > 0 ? Number(pin.raio) : 1,
    distance_unit: pin.unidade === 'mile' ? 'mile' : 'kilometer',
    country: pin.pais || 'BR',
  };
  if (pin.nome) { saida.name = pin.nome; saida.address_string = pin.endereco || pin.nome; }
  if (pin.cidadeId != null) saida.primary_city_id = pin.cidadeId;
  if (pin.regiaoId != null) saida.region_id = pin.regiaoId;
  return saida;
}

export function pinDaMeta(bruto) {
  const b = bruto || {};
  return {
    lat: Number(b.latitude), lng: Number(b.longitude),
    raio: Number(b.radius) || 1,
    unidade: b.distance_unit === 'mile' ? 'mile' : 'kilometer',
    nome: b.name || b.address_string || '',
    endereco: b.address_string || '',
    pais: b.country || 'BR',
    cidadeId: b.primary_city_id ?? null,
    regiaoId: b.region_id ?? null,
  };
}
