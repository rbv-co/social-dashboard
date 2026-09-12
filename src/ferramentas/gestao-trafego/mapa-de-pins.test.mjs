import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  paraPixel, paraCoordenada, quadradinhosVisiveis, posicaoNaJanela, coordenadaDoClique,
  metrosPorPixel, raioEmPixels, enquadrar, pinParaMeta, pinDaMeta,
  LADO_DO_QUADRADINHO, ZOOM_MINIMO, ZOOM_MAXIMO,
} from './mapa-de-pins.js';

const perto = (a, b, tol, msg) => assert.ok(Math.abs(a - b) < tol, `${msg || ''} — esperava ~${b}, veio ${a}`);

// ── a projeção ──────────────────────────────────────────────────────────────
// Os valores abaixo se conferem na mão: no zoom 0 o mundo inteiro cabe em
// 256x256 pixels, entao o meio (lat 0, lng 0) e exatamente 128,128.

test('no zoom 0 o mundo cabe num quadradinho e o meio e 128,128', () => {
  const p = paraPixel(0, 0, 0);
  perto(p.x, 128, 1e-6, 'x do meridiano de Greenwich');
  perto(p.y, 128, 1e-6, 'y do equador');
});

test('lng -180 e a borda esquerda, +180 e a direita', () => {
  perto(paraPixel(0, -180, 0).x, 0, 1e-6);
  perto(paraPixel(0, 180, 0).x, LADO_DO_QUADRADINHO, 1e-6);
});

test('cada zoom DOBRA o mundo', () => {
  for (const z of [0, 1, 5, 12]) {
    perto(paraPixel(0, 0, z).x, 128 * (2 ** z), 1e-6, `meio no zoom ${z}`);
  }
});

test('ida e volta: pixel -> coordenada -> pixel devolve o mesmo lugar', () => {
  // Campinas, que e onde as campanhas da Mantova de verdade apontam.
  for (const [lat, lng] of [[-22.9099, -47.0626], [-22.53414, -47.3843], [0, 0], [51.5, -0.12]]) {
    for (const z of [3, 10, 16]) {
      const p = paraPixel(lat, lng, z);
      const c = paraCoordenada(p.x, p.y, z);
      perto(c.lat, lat, 1e-9, `lat no zoom ${z}`);
      perto(c.lng, lng, 1e-9, `lng no zoom ${z}`);
    }
  }
});

test('a projecao nao estoura no polo: passa do limite e para, sem NaN', () => {
  for (const lat of [89.9, -89.9, 90, -90]) {
    const p = paraPixel(lat, 0, 5);
    assert.ok(Number.isFinite(p.y), `y virou ${p.y} na latitude ${lat}`);
  }
});

test('hemisferio sul fica ABAIXO do equador na tela (y maior)', () => {
  assert.ok(paraPixel(-22.9, 0, 10).y > paraPixel(0, 0, 10).y);
});

// ── janela e clique ─────────────────────────────────────────────────────────

const janela = { centro: { lat: -22.9099, lng: -47.0626 }, zoom: 12, largura: 640, altura: 400 };

test('o centro do mapa cai no MEIO da janela', () => {
  const p = posicaoNaJanela(janela.centro, janela);
  perto(p.esquerda, 320, 1e-6);
  perto(p.topo, 200, 1e-6);
});

test('clicar no meio da janela devolve o centro (o clique vira coordenada)', () => {
  const c = coordenadaDoClique({ esquerda: 320, topo: 200 }, janela);
  perto(c.lat, janela.centro.lat, 1e-9);
  perto(c.lng, janela.centro.lng, 1e-9);
});

test('clique e posicao sao um o inverso do outro em qualquer ponto', () => {
  for (const [ex, to] of [[0, 0], [100, 37], [639, 399]]) {
    const c = coordenadaDoClique({ esquerda: ex, topo: to }, janela);
    const p = posicaoNaJanela(c, janela);
    perto(p.esquerda, ex, 1e-6, 'esquerda');
    perto(p.topo, to, 1e-6, 'topo');
  }
});

test('clicar a DIREITA do centro da uma longitude MAIOR', () => {
  assert.ok(coordenadaDoClique({ esquerda: 500, topo: 200 }, janela).lng > janela.centro.lng);
});

test('clicar ACIMA do centro da uma latitude MAIOR (mais ao norte)', () => {
  assert.ok(coordenadaDoClique({ esquerda: 320, topo: 50 }, janela).lat > janela.centro.lat);
});

// ── quadradinhos ────────────────────────────────────────────────────────────

test('cobre a janela inteira sem buraco', () => {
  const { quadradinhos } = quadradinhosVisiveis(janela);
  // Nao afirmo UM numero: 640x400 cabe em 6 quadradinhos (3x2) ou mais,
  // dependendo de onde o centro cai. O que vale e a COBERTURA, abaixo.
  assert.ok(quadradinhos.length >= 6, `poucos quadradinhos: ${quadradinhos.length}`);
  // o primeiro comeca em cima/à esquerda do canto (ou nele), nunca depois
  assert.ok(Math.min(...quadradinhos.map((q) => q.esquerda)) <= 0);
  assert.ok(Math.min(...quadradinhos.map((q) => q.topo)) <= 0);
  // e o ultimo termina depois da borda
  assert.ok(Math.max(...quadradinhos.map((q) => q.esquerda)) + LADO_DO_QUADRADINHO >= janela.largura);
  assert.ok(Math.max(...quadradinhos.map((q) => q.topo)) + LADO_DO_QUADRADINHO >= janela.altura);
});

test('o mundo DA A VOLTA na horizontal, mas nao na vertical', () => {
  // Perto da linha de data: o quadradinho a direita da borda e o primeiro do mapa.
  const r = quadradinhosVisiveis({ centro: { lat: 0, lng: 179.9 }, zoom: 3, largura: 640, altura: 400 });
  const total = 2 ** 3;
  assert.ok(r.quadradinhos.every((q) => q.x >= 0 && q.x < total), 'x sempre dentro do mundo');
  // No topo do mundo nao existe quadradinho acima: a lista simplesmente nao os traz.
  const polo = quadradinhosVisiveis({ centro: { lat: 84, lng: 0 }, zoom: 3, largura: 640, altura: 400 });
  assert.ok(polo.quadradinhos.every((q) => q.y >= 0 && q.y < total), 'y nunca sai do mundo');
});

test('o zoom e travado entre o minimo e o maximo', () => {
  assert.equal(quadradinhosVisiveis({ ...janela, zoom: 99 }).zoom, ZOOM_MAXIMO);
  assert.equal(quadradinhosVisiveis({ ...janela, zoom: -5 }).zoom, ZOOM_MINIMO);
});

// ── raio ────────────────────────────────────────────────────────────────────

test('metro por pixel cai pela metade a cada zoom', () => {
  const a = metrosPorPixel(0, 10);
  const b = metrosPorPixel(0, 11);
  perto(a / b, 2, 1e-9);
});

test('o mesmo raio ocupa MAIS pixel quanto mais longe do equador', () => {
  // Mercator estica o mapa conforme sobe; ignorar isso desenharia o circulo
  // menor do que a area que a Meta de fato vai atingir.
  const equador = raioEmPixels(0, 5, 'kilometer', 12);
  const sul = raioEmPixels(-22.9, 5, 'kilometer', 12);
  assert.ok(sul > equador, `${sul} deveria ser maior que ${equador}`);
});

test('milha vira mais pixel que quilometro (medido: a Mantova usa as duas)', () => {
  assert.ok(raioEmPixels(-22.9, 1, 'mile', 12) > raioEmPixels(-22.9, 1, 'kilometer', 12));
});

test('raio zero ou torto nao vira circulo', () => {
  assert.equal(raioEmPixels(-22.9, 0, 'kilometer', 12), 0);
  assert.equal(raioEmPixels(-22.9, null, 'kilometer', 12), 0);
  assert.equal(raioEmPixels(-22.9, -3, 'kilometer', 12), 0);
});

// ── enquadrar: o coracao do pedido ──────────────────────────────────────────

test('sem pin nao ha o que enquadrar', () => {
  assert.equal(enquadrar([], 640, 400), null);
  assert.equal(enquadrar(null, 640, 400), null);
});

test('pin com coordenada torta e ignorado em vez de quebrar o enquadre', () => {
  const r = enquadrar([{ lat: -22.9, lng: -47.06 }, { lat: null, lng: 'x' }], 640, 400);
  perto(r.centro.lat, -22.9, 1e-9);
});

// OS 32 PINS: e o caso que motivou o pedido. Com 32 lugares o mapa da Meta some.
test('32 pins espalhados cabem todos na janela', () => {
  const pins = Array.from({ length: 32 }, (_, i) => ({
    lat: -22.5 - (i % 8) * 0.35, lng: -47.5 + Math.floor(i / 8) * 0.4, raio: 1, unidade: 'kilometer',
  }));
  const { centro, zoom } = enquadrar(pins, 640, 400);
  const j = { centro, zoom, largura: 640, altura: 400 };
  for (const p of pins) {
    const q = posicaoNaJanela(p, j);
    assert.ok(q.esquerda >= 0 && q.esquerda <= 640, `pin fora na horizontal: ${q.esquerda}`);
    assert.ok(q.topo >= 0 && q.topo <= 400, `pin fora na vertical: ${q.topo}`);
  }
});

test('enquadrar devolve o MAIOR zoom que ainda cabe DENTRO DA FOLGA', () => {
  // A folga de 48px e de proposito: pin colado na borda fica meio escondido
  // pelo proprio desenho do alfinete. Entao o teste mede contra a area util,
  // nao contra a janela inteira — medir errado aqui reprovaria o comportamento
  // certo.
  const FOLGA = 48;
  const pins = [{ lat: -22.5, lng: -47.5 }, { lat: -22.6, lng: -47.4 }];
  const { centro, zoom } = enquadrar(pins, 640, 400, FOLGA);
  const cabeNaFolga = (z) => pins.every((p) => {
    const q = posicaoNaJanela(p, { centro, zoom: z, largura: 640, altura: 400 });
    return q.esquerda >= FOLGA && q.esquerda <= 640 - FOLGA && q.topo >= FOLGA && q.topo <= 400 - FOLGA;
  });
  assert.ok(cabeNaFolga(zoom), 'o zoom escolhido tem que caber com folga');
  assert.ok(!cabeNaFolga(zoom + 1) || zoom === ZOOM_MAXIMO, 'um zoom a mais nao deveria caber');
});

test('um pin so abre perto dele, nao no mundo inteiro', () => {
  const r = enquadrar([{ lat: -22.53414, lng: -47.3843, raio: 3, unidade: 'kilometer' }], 640, 400);
  perto(r.centro.lat, -22.53414, 1e-9);
  assert.ok(r.zoom >= 11, `esperava zoom de rua, veio ${r.zoom}`);
});

// ── o formato da Meta ───────────────────────────────────────────────────────
// Estes sao pins REAIS, copiados dos conjuntos da Mantova em 12/08/2026.

test('ida e volta com o pin real da Mantova preserva o que veio da Meta', () => {
  const bruto = {
    name: 'Rua Miguel Guidotti, Limeira, SP, Brasil',
    address_string: 'Rua Miguel Guidotti, Limeira, SP, Brasil',
    distance_unit: 'kilometer', latitude: -22.53414, longitude: -47.3843, radius: 3,
    primary_city_id: 258269, region_id: 460, country: 'BR',
  };
  const volta = pinParaMeta(pinDaMeta(bruto));
  assert.equal(volta.latitude, -22.53414);
  assert.equal(volta.longitude, -47.3843);
  assert.equal(volta.radius, 3);
  assert.equal(volta.distance_unit, 'kilometer');
  // Estes NAO podem ser inventados: sao da Meta, e trocar aponta o anuncio
  // pra outra cidade.
  assert.equal(volta.primary_city_id, 258269);
  assert.equal(volta.region_id, 460);
});

test('pin em MILHA continua em milha (a Mantova tem conjuntos assim)', () => {
  const bruto = { distance_unit: 'mile', latitude: -22.782267, longitude: -47.274106, radius: 1, country: 'BR' };
  assert.equal(pinParaMeta(pinDaMeta(bruto)).distance_unit, 'mile');
});

test('pin novo, sem id de cidade, nao inventa id nenhum', () => {
  const p = pinParaMeta({ lat: -22.9, lng: -47.06, raio: 2, unidade: 'kilometer' });
  assert.ok(!('primary_city_id' in p), 'nao pode inventar cidade');
  assert.ok(!('region_id' in p), 'nao pode inventar regiao');
  assert.equal(p.country, 'BR');
  assert.equal(p.radius, 2);
});

test('coordenada e arredondada em 6 casas — o resto e ruido de ponto flutuante', () => {
  const p = pinParaMeta({ lat: -22.847309123456, lng: -47.062834987654, raio: 1 });
  assert.equal(p.latitude, -22.847309);
  assert.equal(p.longitude, -47.062835);
});
