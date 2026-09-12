import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ajustesDeValor } from './ajustes-de-valor.mjs';
import { ajustarPelaDataDaNota } from './notas-bling.mjs';
import { aplicarValorCorrigido } from '../../supabase/functions/_shared/valor-corrigido.js';

// A REGRA que usa estas linhas é a mesma das telas
// (supabase/functions/_shared/valor-corrigido.js). Aqui se testa só a busca: o
// robô consegue ler, e o que ele faz quando NÃO consegue.

const respostaOk = (linhas) => async () => ({ ok: true, json: async () => linhas });

test('devolve as linhas da tabela', async () => {
  const linhas = await ajustesDeValor('https://x.supabase.co', 'chave',
    respostaOk([{ pedido_id: 26851358889, total_corrigido: '1615.00' }]));
  assert.equal(linhas.length, 1);
  assert.equal(linhas[0].total_corrigido, '1615.00');
});

test('pede só as duas colunas que a regra usa, na tabela certa', async () => {
  let alvo, cabecalhos;
  await ajustesDeValor('https://x.supabase.co', 'chave', async (u, o) => {
    alvo = u; cabecalhos = o.headers;
    return { ok: true, json: async () => [] };
  });
  assert.match(alvo, /\/rest\/v1\/bling_pedido_ajuste_valor/);
  assert.match(alvo, /select=pedido_id,total_corrigido/);
  assert.equal(cabecalhos.apikey, 'chave', 'a chave de serviço passa por cima do RLS de propósito');
});

test('TABELA ILEGÍVEL FAZ O ROBÔ GRITAR, não publicar número velho', async () => {
  // Mesma postura de linhasDaJanela: robô que não consegue ler a correção tem
  // que parar. Publicar 1.900 quando o telão diz 1.615 é pior que não publicar.
  await assert.rejects(
    () => ajustesDeValor('https://x.supabase.co', 'chave', async () => ({ ok: false, status: 500, text: async () => 'caiu' })),
    /bling_pedido_ajuste_valor/,
  );
});

test('tenta de novo antes de desistir — 3 vezes, como a vizinha', async () => {
  let chamadas = 0;
  const linhas = await ajustesDeValor('https://x.supabase.co', 'chave', async () => {
    chamadas++;
    if (chamadas < 3) throw new Error('rede oscilando');
    return { ok: true, json: async () => [{ pedido_id: 1, total_corrigido: 10 }] };
  });
  assert.equal(chamadas, 3);
  assert.equal(linhas.length, 1, 'a terceira tentativa salvou a rodada');
});

test('tabela vazia é resposta válida, não erro', async () => {
  assert.deepEqual(await ajustesDeValor('https://x.supabase.co', 'chave', respostaOk([])), []);
});

test('⚠️ pagina por Range — uma página cheia não é o fim, busca a próxima', async () => {
  // PostgREST corta em 1000 linhas por resposta mesmo com limit maior — sem
  // paginar, uma tabela com mais de 1000 correções perderia o resto calado.
  const pagina1 = Array.from({ length: 1000 }, (_, i) => ({ pedido_id: i, total_corrigido: 1 }));
  const pagina2 = [{ pedido_id: 1000, total_corrigido: 2 }];
  const ranges = [];
  const linhas = await ajustesDeValor('https://x.supabase.co', 'chave', async (u, o) => {
    ranges.push(o.headers.Range);
    return { ok: true, json: async () => (ranges.length === 1 ? pagina1 : pagina2) };
  });
  assert.equal(linhas.length, 1001, 'as duas páginas juntas, nenhuma linha perdida');
  assert.deepEqual(ranges, ['0-999', '1000-1999'], 'pediu a segunda página depois de uma primeira cheia');
});

// ── A COMPOSIÇÃO QUE O ROBÔ FAZ, na ordem que ele faz ─────────────────────
// `blingPedidos` fala com a rede por variável global e por isso nunca teve
// teste. O que dá para travar aqui é o que de fato pode quebrar: a ORDEM das
// duas regras. Invertida, o pedido trazido de outro dia escapa do ajuste — e
// ele é justamente o que não vem do Bling.

test('data PRIMEIRO, valor DEPOIS: o pedido trazido de outro dia também é corrigido', () => {
  // O Bling não devolve este pedido na janela (foi feito no dia 11, faturado no 12).
  // Quem o traz é a linha de bling_pedido_nota — com o total DELA, 1900.
  const linhaDaNota = {
    pedido_id: 26851358889, pedido_numero: '2656',
    data_pedido: '2026-09-11', data_da_venda: '2026-09-12',
    total: 1900, loja_id: 205834116,
  };
  const ajustes = [{ pedido_id: 26851358889, total_corrigido: 1615 }];

  const comData = ajustarPelaDataDaNota([], [linhaDaNota], '2026-09-12', '2026-09-12').pedidos;
  assert.equal(comData.length, 1, 'a nota o trouxe para esta janela');
  assert.equal(comData[0].total, 1900, 'e ele entrou valendo o total da linha da nota');

  const final = aplicarValorCorrigido(comData, ajustes).pedidos;
  assert.equal(final[0].total, 1615, 'só a ordem certa alcança este pedido');
  assert.equal(final[0].trazidoDeOutroDia, true);
});

test('na ordem INVERTIDA o pedido trazido escaparia — é isto que a ordem protege', () => {
  const linhaDaNota = {
    pedido_id: 26851358889, pedido_numero: '2656',
    data_pedido: '2026-09-11', data_da_venda: '2026-09-12',
    total: 1900, loja_id: 205834116,
  };
  const ajustes = [{ pedido_id: 26851358889, total_corrigido: 1615 }];

  // Valor primeiro, sobre a lista VAZIA que o Bling devolveu: não há o que ajustar.
  const comValorAntes = aplicarValorCorrigido([], ajustes).pedidos;
  const invertido = ajustarPelaDataDaNota(comValorAntes, [linhaDaNota], '2026-09-12', '2026-09-12').pedidos;
  assert.equal(invertido[0].total, 1900, 'o pedido entra depois do ajuste e sai com o valor errado');
});
