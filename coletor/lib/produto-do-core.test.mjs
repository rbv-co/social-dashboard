import { test } from 'node:test';
import assert from 'node:assert/strict';
import { produtosDoCorePorSku, doMapa, leituraDoCoreLigada, clienteDoEspelho } from './produto-do-core.mjs';

const AGORA = Date.parse('2026-10-20T12:00:00Z');
const detalhe = (id, validade) => ({ id, midia: { imagens: { internas: validade ? [{ link: 'x', validade }] : [] } } });

// Core de mentira: guarda as chamadas para provar que a leitura é por lista, e não por SKU.
function coreFalso({ produtos, detalhes }) {
  const chamadas = [];
  return {
    chamadas,
    todas: async (tabela, params) => {
      chamadas.push({ tabela, params });
      if (tabela === 'produtos_bling') return { linhas: produtos.filter((p) => params.codigo.includes(p.codigo)) };
      return { linhas: detalhes.filter((d) => params.id_bling.includes(String(d.id_bling))) };
    },
  };
}

test('acha o produto, casa sem caixa/pontuação no mapa, aceita detalhe em texto e lê em 2 chamadas por lista', async () => {
  const core = coreFalso({
    produtos: [{ id_bling: 1, codigo: 'LV1059-Palha' }, { id_bling: 2, codigo: 'LV1060-Preto' }],
    detalhes: [{ id_bling: 1, detalhe: JSON.stringify(detalhe(1, '2026-10-27 01:40:07')) }, { id_bling: 2, detalhe: detalhe(2) }],
  });
  const m = await produtosDoCorePorSku(core, ['LV1059-Palha', 'LV1060-Preto'], AGORA);
  assert.equal(core.chamadas.length, 2, 'uma de produtos, uma de detalhes (não uma por SKU)');
  assert.equal(core.chamadas[0].params.id_situacaocadastro, 1, 'só produto ativo');
  assert.equal(doMapa(m, 'lv1059 palha').id, '1');
  assert.equal(doMapa(m, 'LV1059-Palha').produto.id, 1, 'detalhe em texto JSON também é lido');
  assert.equal(doMapa(m, 'LV1059-Palha').imagensVencidas, false);
});

test('imagem com link vencido (ou a menos de 1 h de vencer) é marcada', async () => {
  const core = coreFalso({
    produtos: [{ id_bling: 1, codigo: 'A' }, { id_bling: 2, codigo: 'B' }],
    detalhes: [{ id_bling: 1, detalhe: detalhe(1, '2026-10-19 01:00:00') }, { id_bling: 2, detalhe: detalhe(2, '2026-10-20 12:30:00') }],
  });
  const m = await produtosDoCorePorSku(core, ['A', 'B'], AGORA);
  assert.equal(doMapa(m, 'A').imagensVencidas, true);
  assert.equal(doMapa(m, 'B').imagensVencidas, true);
});

test('SKU que o Core não tem, ou sem detalhe guardado, fica fora do mapa', async () => {
  const core = coreFalso({ produtos: [{ id_bling: 1, codigo: 'A' }], detalhes: [] });
  const m = await produtosDoCorePorSku(core, ['A', 'ZZ'], AGORA);
  assert.equal(m.size, 0);
});

test('código com dois produtos ativos não adivinha', async () => {
  const core = coreFalso({
    produtos: [{ id_bling: 1, codigo: 'D' }, { id_bling: 2, codigo: 'D' }],
    detalhes: [{ id_bling: 1, detalhe: detalhe(1) }, { id_bling: 2, detalhe: detalhe(2) }],
  });
  assert.equal((await produtosDoCorePorSku(core, ['D'], AGORA)).size, 0);
});

test('falha do Core LANÇA: nunca vira "não achei" nem lista parcial', async () => {
  const core = { todas: async () => { throw new Error('core produtos_bling -> 503'); } };
  await assert.rejects(produtosDoCorePorSku(core, ['A'], AGORA), /503/);
});

test('mais de 50 SKUs viram mais de uma chamada por lote', async () => {
  const skus = Array.from({ length: 120 }, (_, i) => `S${i}`);
  const core = coreFalso({ produtos: skus.map((c, i) => ({ id_bling: i + 1, codigo: c })), detalhes: [] });
  await produtosDoCorePorSku(core, skus, AGORA);
  assert.equal(core.chamadas.filter((c) => c.tabela === 'produtos_bling').length, 3);
});

test('desligada por padrão; consumidor próprio quando houver token dele', async () => {
  assert.equal(leituraDoCoreLigada({}), false);
  assert.equal(leituraDoCoreLigada({ CORE_LEITURA_PRODUTO_DETALHE: 'true' }), true);
  assert.throws(() => clienteDoEspelho({}), /ausente/);
  const tokens = [];
  const fetchImpl = async (u, o) => { tokens.push(o.headers.Authorization); return { ok: true, status: 200, json: async () => ({ data: [] }) }; };
  await clienteDoEspelho({ CORE_API_TOKEN: 'a', CORE_ESPELHO_TOKEN: 'b' }, { fetchImpl }).todas('produtos_bling');
  await clienteDoEspelho({ CORE_API_TOKEN: 'a' }, { fetchImpl }).todas('produtos_bling');
  assert.deepEqual(tokens, ['Bearer b', 'Bearer a'], 'o consumidor próprio vence; sem ele, o token de sempre');
});
