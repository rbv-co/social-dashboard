import { test } from 'node:test';
import assert from 'node:assert/strict';
import { montarLinha, impactoPorMes, indiceDeNotas, notaPorId, idDaNota, linhasDaJanela } from './notas-bling.mjs';

test('nota id 0 do Bling significa SEM NOTA, não nota número zero', () => {
  assert.equal(idDaNota({ data: { notaFiscal: { id: 0 } } }), null, 'foi o caso real do pedido nº2372');
  assert.equal(idDaNota({ data: {} }), null);
  assert.equal(idDaNota({ data: { notaFiscal: { id: 26576164738 } } }), 26576164738);
  assert.equal(idDaNota(null), null);
});

const pedido = (extra = {}) => ({ id: 26576164334, numero: 2429, data: '2026-08-04', total: 3644.30, loja: { id: 205451611 }, ...extra });

test('o numero do pedido vai junto — a tela precisa dele p/ mostrar um pedido trazido de outro dia', () => {
  assert.equal(montarLinha(pedido(), null).pedido_numero, '2429');
  assert.equal(montarLinha({ id: 1, data: '2026-08-04', total: 1 }, null).pedido_numero, null);
});

test('a venda fica no dia da NOTA, não no dia do pedido', () => {
  const l = montarLinha(pedido(), { id: 99, dataEmissao: '2026-08-05 09:12:00', numero: '000946', serie: 1, situacao: 6, modelo: 'nfe' });
  assert.equal(l.data_pedido, '2026-08-04');
  assert.equal(l.data_da_nota, '2026-08-05', 'é este o dia que passa a valer');
  assert.equal(l.nota_id, 99, 'nota_id preenchido = tem nota');
  assert.equal(l.modelo, 'nfe');
});

test('pedido sem nota continua no dia do pedido — não inventamos data', () => {
  const l = montarLinha(pedido(), null);
  assert.equal(l.data_da_nota, null);
  assert.equal(l.nota_id, null, 'nota_id nulo E o jeito de dizer "sem nota"');
  assert.equal(l.data_pedido, '2026-08-04');
});

test('NFC-e da loja, emitida no mesmo dia, não move nada', () => {
  const l = montarLinha(pedido({ data: '2026-08-06', total: 170 }), { id: 7, dataEmissao: '2026-08-06 18:40:00', modelo: 'nfce' });
  assert.equal(l.data_da_nota, l.data_pedido);
  assert.equal(l.modelo, 'nfce');
});

test('data zerada do Bling ("0000-00-00") vale como ausente, não como dia 0', () => {
  const l = montarLinha(pedido(), { id: 7, dataEmissao: '0000-00-00 00:00:00', modelo: 'nfe' });
  assert.equal(l.data_da_nota, null);
  assert.equal(l.emitida_em, null);
});

test('modelo desconhecido não entra (a coluna tem trava no banco)', () => {
  const l = montarLinha(pedido(), { id: 7, dataEmissao: '2026-08-05 10:00:00', modelo: 'nfse' });
  assert.equal(l.modelo, null, 'gravar "nfse" quebraria o check do banco no meio do backfill');
});

test('pedido sem loja não quebra — vira nulo', () => {
  const l = montarLinha({ id: 1, data: '2026-08-04', total: 10 }, null);
  assert.equal(l.loja_id, null);
});

test('impacto por mês: o que sai de um mês entra no outro', () => {
  const r = impactoPorMes([
    { data_pedido: '2026-07-31', data_da_nota: '2026-08-01', total: 1000 },
    { data_pedido: '2026-07-15', data_da_nota: '2026-07-15', total: 500 },
  ]);
  assert.equal(r['2026-07'].pelo_pedido, 1500);
  assert.equal(r['2026-07'].pela_nota, 500);
  assert.equal(r['2026-07'].diferenca, -1000, 'julho perde os mil');
  assert.equal(r['2026-08'].pela_nota, 1000, 'agosto ganha os mil');
  assert.equal(r['2026-07'].movidos, 1);
});

test('impacto por mês: sem nota, o valor não se mexe', () => {
  const r = impactoPorMes([{ data_pedido: '2026-07-15', data_da_nota: null, total: 500 }]);
  assert.equal(r['2026-07'].diferenca, 0);
  assert.equal(r['2026-07'].movidos, 0);
});

test('o índice varre nfe E nfce e junta por id', async () => {
  const chamadas = [];
  const proxyFalso = async (_t, endpoint, params) => {
    chamadas.push(endpoint);
    if (params.pagina > 1) return { data: [] };
    return endpoint === 'nfe'
      ? { data: [{ id: 1, dataEmissao: '2026-08-05 09:00:00' }] }
      : { data: [{ id: 2, dataEmissao: '2026-08-06 09:00:00' }] };
  };
  const idx = await indiceDeNotas(proxyFalso, 'tk', '2026-08-01', '2026-08-31');
  assert.deepEqual(chamadas, ['nfe', 'nfce']);
  assert.equal(idx.get(1).modelo, 'nfe');
  assert.equal(idx.get(2).modelo, 'nfce');
});

test('índice que falha não derruba a coleta — devolve o que deu', async () => {
  const proxyFalso = async () => { throw new Error('bling fora do ar'); };
  const idx = await indiceDeNotas(proxyFalso, 'tk', '2026-08-01', '2026-08-31');
  assert.equal(idx.size, 0);
});

test('nota por id tenta nfce quando não é nfe', async () => {
  const proxyFalso = async (_t, endpoint) => {
    if (endpoint.startsWith('nfe/')) throw new Error('404');
    return { data: { id: 55, dataEmissao: '2026-08-06 10:00:00' } };
  };
  const n = await notaPorId(proxyFalso, 'tk', 55);
  assert.equal(n.modelo, 'nfce');
});

test('nota que não existe em modelo nenhum devolve nulo, sem estourar', async () => {
  const proxyFalso = async () => { throw new Error('404'); };
  assert.equal(await notaPorId(proxyFalso, 'tk', 1), null);
});

test('conferido_em vai em toda gravação — o default do banco só valeria na primeira', () => {
  const l = montarLinha(pedido(), null, new Date('2026-08-11T21:30:00Z'));
  assert.equal(l.conferido_em, '2026-08-11T21:30:00.000Z',
    'sem isto, uma linha reconferida hoje exibiria a data da primeira vez');
});

test('linhasDaJanela pede as que ENTRAM e as que SAEM da janela', async () => {
  let url = '';
  const fetchFalso = async (u) => { url = u; return { ok: true, json: async () => [{ pedido_id: 1 }] }; };
  const r = await linhasDaJanela('https://x.supabase.co', 'chave', '2026-08-01', '2026-08-31', fetchFalso);
  assert.equal(r.length, 1);
  assert.ok(url.includes('data_da_venda.gte.2026-08-01'), 'as que entram');
  assert.ok(url.includes('data_pedido.gte.2026-08-01'), 'as que saem');
});

test('linhasDaJanela LANÇA se não conseguir ler — robô calado publicaria número errado', async () => {
  const fetchFalso = async () => ({ ok: false, status: 500, text: async () => 'caiu' });
  await assert.rejects(
    () => linhasDaJanela('https://x.supabase.co', 'chave', '2026-08-01', '2026-08-31', fetchFalso),
    /não deu para ler bling_pedido_nota/,
  );
});

test('linhasDaJanela tenta de novo antes de desistir', async () => {
  let tentativas = 0;
  const fetchFalso = async () => {
    tentativas++;
    if (tentativas < 3) throw new Error('rede');
    return { ok: true, json: async () => [] };
  };
  await linhasDaJanela('https://x.supabase.co', 'chave', '2026-08-01', '2026-08-31', fetchFalso);
  assert.equal(tentativas, 3, 'soluço de rede não pode derrubar a rodada');
});
