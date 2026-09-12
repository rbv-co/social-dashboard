import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aplicarDataDaVenda, buscarLinhasDaJanela } from './data-da-venda.js';

// A regra pura é testada em supabase/functions/_shared/data-da-venda.test.mjs.
// Aqui ficam só os testes do que é do navegador: buscar as linhas e não deixar
// a tela quebrar quando o banco não responde.

const ped = (id, data, total = 100) => ({ id, data, total, loja: { id: 205451611 } });
const linha = (pedido_id, data_pedido, data_da_venda, total = 100) => ({
  pedido_id, pedido_numero: String(pedido_id), data_pedido, data_da_venda, total, loja_id: 205451611,
});

test('banco fora do ar: a tela fica como está hoje, NUNCA vazia', async () => {
  const sbFalso = { from: () => ({ select: () => ({ or: () => ({ range: async () => ({ data: null, error: { message: 'caiu' } }) }) }) }) };
  const r = await aplicarDataDaVenda(sbFalso, [ped(1, '2026-08-06'), ped(2, '2026-08-06')], '2026-08-06', '2026-08-06');
  assert.equal(r.pedidos.length, 2, 'perder a tela de vendas é pior que mostrar a data antiga');
  assert.equal(r.semBanco, true);
  assert.equal(r.pedidos[0].dataDoPedido, '2026-08-06');
});

test('consulta que estoura exceção também devolve "não sei", sem derrubar', async () => {
  const sbFalso = { from: () => { throw new Error('sem rede'); } };
  assert.equal(await buscarLinhasDaJanela(sbFalso, '2026-08-01', '2026-08-31'), null);
});

test('busca pagina de mil em mil — o PostgREST corta em 1000 sem avisar', async () => {
  const chamadas = [];
  const pagina1 = Array.from({ length: 1000 }, (_, i) => linha(i + 1, '2026-08-01', '2026-08-01'));
  const sbFalso = {
    from: () => ({
      select: () => ({
        or: () => ({
          range: async (ini) => { chamadas.push(ini); return { data: ini === 0 ? pagina1 : [linha(1001, '2026-08-01', '2026-08-01')], error: null }; },
        }),
      }),
    }),
  };
  const linhas = await buscarLinhasDaJanela(sbFalso, '2026-08-01', '2026-08-31');
  assert.deepEqual(chamadas, [0, 1000]);
  assert.equal(linhas.length, 1001, 'sem paginar, a linha 1001 sumiria em silêncio');
});
