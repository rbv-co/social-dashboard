import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aplicarDevolucaoDeTroca, buscarDevolucoes } from './valor-liquido-de-troca.js';

// A regra pura é testada em supabase/functions/_shared/valor-liquido-de-troca.test.mjs.
// Aqui ficam só os testes do que é do navegador: buscar as linhas e não deixar
// a tela quebrar quando o banco não responde. Mesmo arranjo de valor-corrigido.test.mjs.

const ped = (id, total = 1900) => ({ id, total, loja: { id: 205834116 } });
const linha = (pedido_id, valor) => ({ pedido_id, valor });

function sbComPaginas(paginas, chamadas = [], chamadasEq = []) {
  return {
    from: () => ({
      select: () => ({
        eq: (campo, valor) => {
          chamadasEq.push([campo, valor]);
          return {
            range: async (de, ate) => {
              chamadas.push([de, ate]);
              return { data: paginas.shift() ?? [], error: null };
            },
          };
        },
      }),
    }),
  };
}

test('banco fora do ar: a tela fica como está hoje, NUNCA vazia', async () => {
  const sbFalso = { from: () => ({ select: () => ({ eq: () => ({ range: async () => ({ data: null, error: { message: 'caiu' } }) }) }) }) };
  const r = await aplicarDevolucaoDeTroca(sbFalso, [ped(1), ped(2)]);
  assert.equal(r.pedidos.length, 2, 'perder a tela de vendas é pior que mostrar o valor bruto');
  assert.equal(r.semBanco, true);
  assert.equal(r.pedidos[0].total, 1900);
  assert.equal(r.ajustados, 0);
});

test('consulta que estoura exceção também devolve "não sei", sem derrubar', async () => {
  const sbFalso = { from: () => { throw new Error('sem rede'); } };
  assert.equal(await buscarDevolucoes(sbFalso), null);
});

test('com banco respondendo, a devolução entra', async () => {
  const r = await aplicarDevolucaoDeTroca(sbComPaginas([[linha(27018529287, '1600.00')]]), [ped(27018529287)]);
  assert.equal(r.pedidos[0].total, 300);
  assert.equal(r.pedidos[0].totalComTroca, 1900);
  assert.equal(r.ajustados, 1);
  assert.equal(r.semBanco, false);
});

test('tabela vazia: ninguém é tocado e nada quebra', async () => {
  const r = await aplicarDevolucaoDeTroca(sbComPaginas([[]]), [ped(1), ped(2)]);
  assert.equal(r.ajustados, 0);
  assert.equal(r.pedidos.length, 2);
  assert.equal(r.semBanco, false);
});

test('busca pagina de mil em mil — o PostgREST corta em 1000 sem avisar', async () => {
  const chamadas = [];
  const pagina1 = Array.from({ length: 1000 }, (_, i) => linha(i + 1, 10));
  const sb = sbComPaginas([pagina1, [linha(1001, 10)]], chamadas);
  const linhas = await buscarDevolucoes(sb);
  assert.equal(linhas.length, 1001);
  assert.deepEqual(chamadas[0], [0, 999]);
  assert.deepEqual(chamadas[1], [1000, 1999]);
});

test('a tabela inteira (filtrada por eh_devolucao) é lida — não se filtra pelos ids da janela', async () => {
  const chamadas = [];
  await buscarDevolucoes(sbComPaginas([[]], chamadas));
  assert.equal(chamadas.length, 1, 'uma consulta só, sem depender de quantos pedidos a janela tem');
});

test('filtra por eh_devolucao=true — nunca pela tabela inteira sem filtro', async () => {
  const chamadasEq = [];
  await buscarDevolucoes(sbComPaginas([[]], [], chamadasEq));
  assert.deepEqual(chamadasEq, [['eh_devolucao', true]]);
});
