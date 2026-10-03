import { test } from 'node:test';
import assert from 'node:assert/strict';
import { linkDaProximaPagina } from './shopify-admin.mjs';

// A Shopify pagina orders.json por cursor no cabeçalho Link (formato RFC 8288),
// não por número de página — isso mudou há anos e `page` nem é mais aceito
// neste endpoint.
const linkComNext = '<https://loja.myshopify.com/admin/api/2024-01/orders.json?page_info=abc123&limit=250>; rel="next"';
const linkComOsDois = '<https://loja.myshopify.com/admin/api/2024-01/orders.json?page_info=zzz&limit=250>; rel="previous", '
  + '<https://loja.myshopify.com/admin/api/2024-01/orders.json?page_info=abc123&limit=250>; rel="next"';
const linkSoAnterior = '<https://loja.myshopify.com/admin/api/2024-01/orders.json?page_info=zzz&limit=250>; rel="previous"';

test('extrai a URL de rel="next" quando é o único link', () => {
  assert.equal(linkDaProximaPagina(linkComNext), 'https://loja.myshopify.com/admin/api/2024-01/orders.json?page_info=abc123&limit=250');
});

test('extrai rel="next" mesmo com rel="previous" também presente', () => {
  assert.equal(linkDaProximaPagina(linkComOsDois), 'https://loja.myshopify.com/admin/api/2024-01/orders.json?page_info=abc123&limit=250');
});

test('só rel="previous" (última página): não tem próxima, devolve null', () => {
  assert.equal(linkDaProximaPagina(linkSoAnterior), null);
});

test('cabeçalho ausente: devolve null, não lança', () => {
  for (const vazio of [null, undefined, '']) {
    assert.equal(linkDaProximaPagina(vazio), null);
  }
});

test('cabeçalho malformado: devolve null em vez de quebrar o robô', () => {
  assert.equal(linkDaProximaPagina('isto não é um Link header de verdade'), null);
});
