import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  LUGAR_TIPOS, podeVirarPonto, deListas, paraListas, rotuloDoLugar, jaEstaNaLista,
} from './lugares-do-anuncio.js';

test('os quatro tipos, na ordem que a tela mostra', () => {
  assert.deepEqual(LUGAR_TIPOS.map((t) => t.id), ['pais', 'estado', 'cidade', 'local']);
  assert.equal(LUGAR_TIPOS.find((t) => t.id === 'pais').rotulo, 'Brasil');
});

// País não vira ponto: um raio no centro geográfico do Brasil não mira nada que
// alguém queira. Decisão do dono, registrada no desenho.
test('so pais nao pode virar ponto com raio', () => {
  assert.equal(podeVirarPonto('pais'), false);
  assert.equal(podeVirarPonto('estado'), true);
  assert.equal(podeVirarPonto('cidade'), true);
  assert.equal(podeVirarPonto('local'), true);
});

test('as quatro listas do publico viram uma lista so de lugares', () => {
  const lugares = deListas({
    paises: [{ key: 'BR', nome: 'Brasil' }],
    estados: [{ key: '449', nome: 'Minas Gerais' }],
    cidades: [{ key: '273173', nome: 'Uberlândia · MG', raio: 0, unidade: 'kilometer' }],
    pins: [{ lat: -18.91, lng: -48.26, raio: 2, unidade: 'kilometer', nome: 'Center Shopping', endereco: 'Rua Argentina' }],
  });
  assert.deepEqual(lugares.map((l) => l.tipo), ['pais', 'estado', 'cidade', 'local']);
  assert.deepEqual(lugares.map((l) => l.comoMirar), ['area', 'area', 'area', 'ponto']);
  assert.equal(lugares[2].raio, 0, 'raio 0 da cidade é "a cidade inteira" e não pode sumir');
  assert.equal(lugares[3].lat, -18.91);
});

test('a lista de lugares volta pras quatro listas', () => {
  const listas = paraListas([
    { tipo: 'pais', chave: 'BR', nome: 'Brasil', comoMirar: 'area' },
    { tipo: 'estado', chave: '449', nome: 'Minas Gerais', comoMirar: 'area' },
    { tipo: 'cidade', chave: '273173', nome: 'Uberlândia', comoMirar: 'area', raio: 17, unidade: 'kilometer' },
    { tipo: 'local', nome: 'Center Shopping', endereco: 'Rua Argentina', comoMirar: 'ponto', lat: -18.91, lng: -48.26, raio: 2, unidade: 'kilometer' },
  ]);
  assert.deepEqual(listas.paises, [{ key: 'BR', nome: 'Brasil' }]);
  assert.deepEqual(listas.estados, [{ key: '449', nome: 'Minas Gerais' }]);
  assert.equal(listas.cidades[0].raio, 17);
  assert.equal(listas.pins.length, 1);
  assert.equal(listas.pins[0].nome, 'Center Shopping');
});

// A ESCOLHA "ponto com raio" NUMA CIDADE vira custom_location — que é o mesmo
// mecanismo do "Local". Ou seja: depois de salvar e reabrir, a Meta não tem como
// dizer se aquele ponto nasceu de uma cidade ou de um comércio, e ele volta como
// "Local". A assimetria é honesta e está aqui de propósito: fingir o contrário
// exigiria inventar dado que a Meta não guarda.
test('cidade escolhida como ponto volta da Meta como Local — e isso e proposital', () => {
  const listas = paraListas([
    { tipo: 'cidade', chave: '273173', nome: 'Uberlândia', comoMirar: 'ponto', lat: -18.91, lng: -48.27, raio: 5, unidade: 'kilometer' },
  ]);
  assert.deepEqual(listas.cidades, [], 'não pode gravar a cidade TAMBÉM como área — dobraria a segmentação');
  assert.equal(listas.pins.length, 1);
  const devolta = deListas(listas);
  assert.equal(devolta[0].tipo, 'local');
  assert.equal(devolta[0].nome, 'Uberlândia');
});

// Ponto sem coordenada não pode ser gravado: a Meta recusaria, e um lugar que
// some ao salvar sem dizer nada é o pior dos dois mundos.
test('ponto sem coordenada nao vira pin', () => {
  const listas = paraListas([
    { tipo: 'local', nome: 'Sem coordenada', comoMirar: 'ponto', lat: null, lng: undefined, raio: 1 },
  ]);
  assert.deepEqual(listas.pins, []);
});

test('rotulo mostra o estado junto quando existe', () => {
  assert.equal(rotuloDoLugar({ tipo: 'cidade', nome: 'Uberlândia', uf: 'Minas Gerais' }), 'Uberlândia · Minas Gerais');
  assert.equal(rotuloDoLugar({ tipo: 'local', nome: 'Center Shopping', endereco: 'Rua Argentina, Tibery' }), 'Center Shopping · Rua Argentina, Tibery');
  assert.equal(rotuloDoLugar({ tipo: 'local', nome: '', lat: -18.9, lng: -48.2 }), '-18.90000, -48.20000');
});

test('nada quebra com lista faltando ou nula', () => {
  assert.deepEqual(deListas(null), []);
  assert.deepEqual(deListas({}), []);
  assert.deepEqual(paraListas(null), { paises: [], estados: [], cidades: [], pins: [] });
});

// Público duplicado não dá erro nenhum na Meta — só gasta. Por isso a lista
// recusa o repetido, e a identidade é diferente conforme a origem: chave para o
// que vem da Meta, coordenada para o que vem do mapa.
test('a lista recusa o lugar repetido, pela chave OU pela coordenada', () => {
  const lista = [
    { tipo: 'cidade', chave: '273173', nome: 'Uberlândia', comoMirar: 'area' },
    { tipo: 'local', chave: null, nome: 'Shopping', comoMirar: 'ponto', lat: -18.91, lng: -48.26 },
  ];
  assert.equal(jaEstaNaLista(lista, { tipo: 'cidade', chave: '273173' }), true, 'mesma cidade');
  assert.equal(jaEstaNaLista(lista, { tipo: 'estado', chave: '273173' }), false, 'mesma chave, tipo diferente: outro lugar');
  assert.equal(jaEstaNaLista(lista, { tipo: 'cidade', chave: '999' }), false, 'cidade nova entra');
  assert.equal(jaEstaNaLista(lista, { tipo: 'local', chave: null, lat: -18.91, lng: -48.26 }), true, 'mesmo ponto');
  assert.equal(jaEstaNaLista(lista, { tipo: 'local', chave: null, lat: -18.92, lng: -48.26 }), false, 'ponto ao lado é outro ponto');
  assert.equal(jaEstaNaLista(lista, null), false);
  assert.equal(jaEstaNaLista(null, { tipo: 'cidade', chave: '1' }), false);
});
