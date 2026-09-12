import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aplicarAjusteDeValor, buscarAjustesDeValor } from './valor-corrigido.js';

// A regra pura é testada em supabase/functions/_shared/valor-corrigido.test.mjs.
// Aqui ficam só os testes do que é do navegador: buscar as linhas e não deixar
// a tela quebrar quando o banco não responde.

const ped = (id, total = 1900) => ({ id, data: '2026-09-11', total, loja: { id: 205834116 } });
const linha = (pedido_id, total_corrigido) => ({ pedido_id, total_corrigido });

// Cliente falso: devolve as páginas que lhe derem, na ordem, e anota as faixas pedidas.
function sbComPaginas(paginas, chamadas = []) {
  return {
    from: () => ({
      select: () => ({
        range: async (de, ate) => {
          chamadas.push([de, ate]);
          return { data: paginas.shift() ?? [], error: null };
        },
      }),
    }),
  };
}

test('banco fora do ar: a tela fica como está hoje, NUNCA vazia', async () => {
  const sbFalso = { from: () => ({ select: () => ({ range: async () => ({ data: null, error: { message: 'caiu' } }) }) }) };
  const r = await aplicarAjusteDeValor(sbFalso, [ped(1), ped(2)]);
  assert.equal(r.pedidos.length, 2, 'perder a tela de vendas é pior que mostrar o valor do Bling');
  assert.equal(r.semBanco, true);
  assert.equal(r.pedidos[0].total, 1900, 'sem resposta, vale o que o Bling disse');
  assert.equal(r.ajustados, 0);
});

test('consulta que estoura exceção também devolve "não sei", sem derrubar', async () => {
  const sbFalso = { from: () => { throw new Error('sem rede'); } };
  assert.equal(await buscarAjustesDeValor(sbFalso), null);
});

test('com banco respondendo, o valor corrigido entra', async () => {
  const r = await aplicarAjusteDeValor(sbComPaginas([[linha(26851358889, '1615.00')]]), [ped(26851358889)]);
  assert.equal(r.pedidos[0].total, 1615);
  assert.equal(r.pedidos[0].totalDoBling, 1900);
  assert.equal(r.ajustados, 1);
  assert.equal(r.semBanco, false);
});

test('tabela vazia: ninguém é tocado e nada quebra', async () => {
  const r = await aplicarAjusteDeValor(sbComPaginas([[]]), [ped(1), ped(2)]);
  assert.equal(r.ajustados, 0);
  assert.equal(r.pedidos.length, 2);
  assert.equal(r.semBanco, false);
});

test('busca pagina de mil em mil — o PostgREST corta em 1000 sem avisar', async () => {
  const chamadas = [];
  const pagina1 = Array.from({ length: 1000 }, (_, i) => linha(i + 1, 10));
  const sb = sbComPaginas([pagina1, [linha(1001, 10)]], chamadas);
  const linhas = await buscarAjustesDeValor(sb);
  assert.equal(linhas.length, 1001, 'a segunda página não pode ficar para trás');
  assert.deepEqual(chamadas[0], [0, 999]);
  assert.deepEqual(chamadas[1], [1000, 1999]);
});

test('a tabela inteira é lida — não se filtra pelos ids da janela', async () => {
  // A tabela é de exceção: tem punhado de linhas. Filtrar por `in(ids)` traria
  // de volta o corte de 500 ids que já mordeu o cache de vendedores.
  const chamadas = [];
  await buscarAjustesDeValor(sbComPaginas([[]], chamadas));
  assert.equal(chamadas.length, 1, 'uma consulta só, sem depender de quantos pedidos a janela tem');
});
