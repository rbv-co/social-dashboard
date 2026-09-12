import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  pedidoDaBusca, lugaresDaRespostaDaMeta, lugaresDaRespostaDoMapa,
  enderecoDeOndeCaiu, criarFilaDeUmPorVez,
} from './busca-de-lugar.js';

test('cada tipo pergunta no lugar certo', () => {
  assert.equal(pedidoDaBusca('cidade', 'uber').onde, 'meta');
  assert.equal(pedidoDaBusca('estado', 'minas').onde, 'meta');
  assert.equal(pedidoDaBusca('pais', 'bra').onde, 'meta');
  // "Local" NÃO existe no catálogo da Meta: medido em 13/08/2026,
  // location_types:["place"] para "Shopping" devolve lista vazia.
  assert.equal(pedidoDaBusca('local', 'shopping').onde, 'mapa');
});

test('a pergunta pra Meta leva o tipo e o termo', () => {
  const p = pedidoDaBusca('cidade', 'uberlandia');
  assert.equal(p.params.type, 'adgeolocation');
  assert.deepEqual(JSON.parse(p.params.location_types), ['city']);
  assert.equal(p.params.q, 'uberlandia');
  assert.deepEqual(JSON.parse(pedidoDaBusca('estado', 'x').params.location_types), ['region']);
  assert.deepEqual(JSON.parse(pedidoDaBusca('pais', 'x').params.location_types), ['country']);
});

// A Meta devolve BAIRRO mesmo pedindo só cidade (medido em 13/08/2026 buscando
// "Uberlandia": vieram Centro e Martins como neighborhood). Se a tela não
// mostrar o tipo de cada linha, a pessoa acrescenta um bairro achando que
// acrescentou uma cidade.
test('o tipo REAL de cada linha da Meta viaja junto', () => {
  const achados = lugaresDaRespostaDaMeta({
    data: [
      { key: '273173', name: 'Uberlândia', type: 'city', region: 'Minas Gerais', country_name: 'Brasil' },
      { key: '2784682', name: 'Centro', type: 'neighborhood', region: 'Minas Gerais' },
      { key: '449', name: 'Minas Gerais', type: 'region', country_name: 'Brasil' },
      { key: 'BR', name: 'Brasil', type: 'country' },
    ],
  });
  assert.deepEqual(achados.map((a) => a.tipo), ['cidade', 'bairro', 'estado', 'pais']);
  assert.equal(achados[0].uf, 'Minas Gerais');
  assert.equal(achados[0].comoMirar, 'area');
  assert.equal(achados[0].lat, null, 'a Meta não devolve coordenada — nunca invente uma');
});

test('a resposta do mapa vira lugar com coordenada e endereco', () => {
  const achados = lugaresDaRespostaDoMapa([
    {
      name: 'Center Shopping Uberlândia', lat: '-18.9101557', lon: '-48.2605331',
      display_name: 'Center Shopping Uberlândia, Rua Argentina, Tibery, Uberlândia, Minas Gerais, 38405-174, Brasil',
      address: { road: 'Rua Argentina', suburb: 'Tibery', city: 'Uberlândia', state: 'Minas Gerais', 'ISO3166-2-lvl4': 'BR-MG' },
    },
  ]);
  assert.equal(achados[0].tipo, 'local');
  assert.equal(achados[0].comoMirar, 'ponto');
  assert.equal(achados[0].nome, 'Center Shopping Uberlândia');
  assert.equal(achados[0].lat, -18.9101557);
  assert.equal(achados[0].lng, -48.2605331);
  assert.equal(achados[0].endereco, 'Rua Argentina · Tibery · Uberlândia · MG');
});

test('a resposta do mapa aceita tanto a lista crua quanto o envelope da recepcao', () => {
  const linha = { name: 'X', lat: '-1', lon: '-2', address: {} };
  assert.equal(lugaresDaRespostaDoMapa([linha]).length, 1);
  assert.equal(lugaresDaRespostaDoMapa({ lugares: [linha] }).length, 1);
  assert.deepEqual(lugaresDaRespostaDoMapa(null), []);
});

test('onde o ponto caiu vira o endereco por extenso', () => {
  const r = enderecoDeOndeCaiu({
    name: 'Pernambucanas',
    address: { road: 'Avenida Afonso Pena', suburb: 'Centro', city: 'Uberlândia', state: 'Minas Gerais', 'ISO3166-2-lvl4': 'BR-MG' },
  });
  assert.equal(r.nome, 'Pernambucanas');
  assert.equal(r.endereco, 'Avenida Afonso Pena · Centro · Uberlândia · MG');
});

test('ponto que cai no meio do nada nao inventa nome', () => {
  assert.deepEqual(enderecoDeOndeCaiu(null), { nome: '', endereco: '' });
  assert.deepEqual(enderecoDeOndeCaiu({}), { nome: '', endereco: '' });
});

// O serviço de mapa é comunitário e pede no máximo uma pergunta por segundo.
// Clicar sete vezes seguidas no mapa tem que ENFILEIRAR sete perguntas, não
// disparar sete de uma vez — que é o jeito mais rápido de ser bloqueado.
test('a fila deixa uma pergunta por vez, com intervalo', async () => {
  const ordem = [];
  const esperas = [];
  const fila = criarFilaDeUmPorVez({ esperar: (ms) => { esperas.push(ms); return Promise.resolve(); }, intervalo: 1100 });
  const a = fila(async () => { ordem.push('comecou a'); return 'a'; });
  const b = fila(async () => { ordem.push('comecou b'); return 'b'; });
  assert.deepEqual(await Promise.all([a, b]), ['a', 'b']);
  assert.deepEqual(ordem, ['comecou a', 'comecou b'], 'b não pode começar antes de a terminar');
  assert.deepEqual(esperas, [1100], 'só espera ENTRE perguntas, não antes da primeira');
});

test('pergunta que falha nao trava a fila', async () => {
  const fila = criarFilaDeUmPorVez({ esperar: () => Promise.resolve(), intervalo: 0 });
  await assert.rejects(fila(async () => { throw new Error('caiu'); }), /caiu/);
  assert.equal(await fila(async () => 'a próxima roda'), 'a próxima roda');
});
