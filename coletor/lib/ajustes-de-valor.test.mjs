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
    // ⚠️ A NOTA AUTORIZADA (5) ENTROU NA FIXTURE em 22/09/2026, quando a regra
    // passou a exigi-la. Não é enfeite de teste: o pedido 2656 é real (Ana
    // Paula, R$ 1.900, Iguatemi) e a nota dele ESTÁ autorizada. Fixture sem o
    // estado descrevia um pedido que não existe.
    nota_situacao: 5,
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
    // ⚠️ A NOTA AUTORIZADA (5) ENTROU NA FIXTURE em 22/09/2026, quando a regra
    // passou a exigi-la. Não é enfeite de teste: o pedido 2656 é real (Ana
    // Paula, R$ 1.900, Iguatemi) e a nota dele ESTÁ autorizada. Fixture sem o
    // estado descrevia um pedido que não existe.
    nota_situacao: 5,
  };
  const ajustes = [{ pedido_id: 26851358889, total_corrigido: 1615 }];

  // Valor primeiro, sobre a lista VAZIA que o Bling devolveu: não há o que ajustar.
  const comValorAntes = aplicarValorCorrigido([], ajustes).pedidos;
  const invertido = ajustarPelaDataDaNota(comValorAntes, [linhaDaNota], '2026-09-12', '2026-09-12').pedidos;
  assert.equal(invertido[0].total, 1900, 'o pedido entra depois do ajuste e sai com o valor errado');
});

// Depois do Supabase o robô de pedidos já lê tudo por `pg`: a correção de valor vem do MESMO banco (antes ia à REST do
// Supabase só por isto, e leria uma tabela congelada, em silêncio, depois da virada).
import { ajustesDeValorPg } from './ajustes-de-valor.mjs';

test('pg: lê as duas colunas da tabela inteira e a regra aplica o valor (numeric e bigint chegam como texto)', async () => {
  const consultas = [];
  const cli = { query: async (sql) => { consultas.push(sql); return { rows: [{ pedido_id: '26851358889', total_corrigido: '1615.00' }] }; } };
  const linhas = await ajustesDeValorPg(cli);
  assert.match(consultas[0], /select pedido_id, total_corrigido from (public\.)?bling_pedido_ajuste_valor/);
  const { pedidos, ajustados } = aplicarValorCorrigido([{ id: 26851358889, total: 1000 }], linhas);
  assert.equal(ajustados, 1);
  assert.equal(pedidos[0].total, 1615);
});

test('pg: se não der para ler, LANÇA (robô que não lê a correção para, não publica o número velho)', async () => {
  const cli = { query: async () => { throw new Error('connection terminated'); } };
  await assert.rejects(ajustesDeValorPg(cli), /não deu para ler bling_pedido_ajuste_valor: connection terminated/);
});

// ── propagarAjustesPg: contra Postgres de verdade (sem TEST_DATABASE_URL, pula) ──
// Cenário do 2656: ajuste cadastrado DEPOIS do pedido, pedido fora da janela do robô,
// e o Core (ou o Bling) reescrevendo o total do pedido por cima.
import { propagarAjustesPg } from './ajustes-de-valor.mjs';
import pg from 'pg';

const URL_TESTE = process.env.TEST_DATABASE_URL;

test('propagarAjustesPg: ajuste vence o total reescrito, é idempotente e só toca quem difere',
  { skip: !URL_TESTE && 'sem TEST_DATABASE_URL' }, async () => {
    const cli = new pg.Client({ connectionString: URL_TESTE });
    await cli.connect();
    try {
      await cli.query('begin');
      await cli.query(`create temp table vessel_pedidos (id int generated always as identity, bling_pedido_id bigint primary key,
        total_do_bling numeric(12,2), total_corrigido numeric(12,2), receita_liquida numeric(12,2), desconto numeric(12,2))`);
      await cli.query(`create temp table vessel_pedido_itens (pedido_id int, total_do_item numeric(12,2))`);
      await cli.query(`create temp table bling_pedido_ajuste_valor (pedido_id bigint primary key,
        total_corrigido numeric(12,2) not null)`);
      await cli.query(`insert into vessel_pedidos (bling_pedido_id, total_do_bling, total_corrigido, receita_liquida, desconto)
        values (26851358889, 1900, null, 1900, 0), (2, 50, null, 50, 0)`);
      await cli.query(`insert into vessel_pedido_itens select id, total_do_bling from vessel_pedidos`);
      await cli.query(`insert into bling_pedido_ajuste_valor values (26851358889, 1615)`);

      assert.equal(await propagarAjustesPg(cli), 1, 'só o pedido com ajuste muda');
      const lido = () => cli.query('select bling_pedido_id::text id, total_corrigido::text c, receita_liquida::text r from vessel_pedidos order by 1');
      assert.deepEqual((await lido()).rows,
        [{ id: '2', c: null, r: '50.00' }, { id: '26851358889', c: '1615.00', r: '1615.00' }]);

      // o espelho reescreve o pedido (total novo, receita recalculada do zero): o ajuste volta a valer
      await cli.query(`update vessel_pedidos set total_do_bling = 1700, receita_liquida = 1700 where bling_pedido_id = 26851358889`);
      assert.equal(await propagarAjustesPg(cli), 1);
      assert.equal((await lido()).rows[1].r, '1615.00');

      assert.equal(await propagarAjustesPg(cli), 0, 'segunda passada não toca nada');

      // ajuste apagado à mão: o pedido volta ao valor do Bling (soma dos itens), mesmo fora de qualquer janela
      await cli.query('delete from bling_pedido_ajuste_valor');
      assert.equal(await propagarAjustesPg(cli), 1);
      assert.deepEqual((await lido()).rows[1], { id: '26851358889', c: null, r: '1900.00' });
      assert.equal(await propagarAjustesPg(cli), 0);
    } finally {
      await cli.query('rollback'); await cli.end();
    }
  });
