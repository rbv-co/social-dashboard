import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { canaisDeFoco, canaisNovosNosPedidos } from './relatorios-comerciais.mjs';
import { lojasEPulmao } from './gestor-comercial.mjs';

/* ⚠️ CANAL E DEPOSITO DEIXARAM DE SER CODIGO (05/09/2026)
 *
 * Ate hoje havia QUATRO listas cravadas — os depositos em `estoque-gv.js`, em
 * `lib/bling-comercial.mjs` e em `gestor-comercial.mjs`, e os canais aqui. Pior
 * que a repeticao: os dois robos DESCARTAVAM em silencio o que nao estava na
 * lista. O Bling mandava o saldo dos 7 depositos e o codigo guardava 3; mandava
 * pedidos de 14 canais e o codigo detalhava 3. Loja nova simplesmente nao
 * existia, sem erro nenhum, ate alguem editar codigo. */

test('canaisDeFoco: usa o que a tabela devolve', async () => {
  const falso = async () => ([
    { loja_id: 1, nome: 'Um', foco: true },
    { loja_id: 2, nome: 'Dois', foco: true },
  ]);
  assert.deepEqual(await canaisDeFoco(falso), [
    { nome: 'Um', loja_id: '1' }, { nome: 'Dois', loja_id: '2' },
  ]);
});

test('canaisDeFoco: pede so os de foco ao banco', async () => {
  let pedido = '';
  await canaisDeFoco(async (c) => { pedido = c; return [{ loja_id: 9, nome: 'X' }]; });
  assert.match(pedido, /foco=is\.true/,
    'sem este recorte o robo detalharia os 14 canais e bateria no limite do Bling');
});

test('⚠️ canaisDeFoco: banco fora do ar NAO zera a coleta', async () => {
  /* Devolver lista vazia aqui faria o robo coletar NADA e, pior, a limpeza de
   * sobras poderia apagar o mes. Cair na semente e o comportamento antigo. */
  const quebrado = async () => { throw new Error('rede'); };
  const r = await canaisDeFoco(quebrado);
  assert.equal(r.length, 3, 'tem de cair na lista-semente de tres canais');
  assert.ok(r.every((c) => c.loja_id && c.nome));
});

test('canaisDeFoco: tabela vazia tambem cai na semente', async () => {
  assert.equal((await canaisDeFoco(async () => [])).length, 3);
});

test('canaisNovosNosPedidos: acha o canal que ainda nao existe', () => {
  const pedidos = [
    { loja: { id: 205657609 } },   // ja cadastrado
    { loja: { id: 999888777 } },   // novo
    { loja: { id: 999888777 } },   // repetido: nao pode duplicar
  ];
  const novos = canaisNovosNosPedidos(pedidos, ['205657609']);
  assert.equal(novos.length, 1);
  assert.equal(novos[0].loja_id, 999888777);
  assert.equal(novos[0].foco, true, 'canal novo nasce em foco');
  assert.match(novos[0].nome, /Canal #/, 'nome provisorio ate alguem renomear');
});

test('canaisNovosNosPedidos: nada de novo devolve lista vazia', () => {
  assert.deepEqual(canaisNovosNosPedidos([{ loja: { id: 1 } }], ['1']), []);
  assert.deepEqual(canaisNovosNosPedidos([], ['1']), []);
  assert.deepEqual(canaisNovosNosPedidos(null, []), []);
});

test('canaisNovosNosPedidos: pedido sem loja nao vira canal', () => {
  // Pedido sem canal existe no Bling, e virava um canal "" no cadastro.
  assert.deepEqual(canaisNovosNosPedidos([{ loja: {} }, {}, { loja: null }], []), []);
});

// ── AS LISTAS CRAVADAS VIRARAM SEMENTE, E NAO PODEM VOLTAR A MANDAR ────────
const ROBO = readFileSync(new URL('./relatorios-comerciais.mjs', import.meta.url), 'utf8');
const LIB  = readFileSync(new URL('./lib/bling-comercial.mjs', import.meta.url), 'utf8');

test('⚠️ o robo NAO descarta mais o saldo de deposito desconhecido', () => {
  assert.ok(!/if \(did in saldoPorDep\)/.test(LIB),
    'voltou o descarte: deposito novo some sem erro nenhum');
});

test('o robo percorre os depositos que VIERAM do Bling', () => {
  assert.match(ROBO, /for \(const \{ deposito_id, canal \} of depositosParaColetar\)/,
    'voltou a percorrer a lista cravada em vez do que o Bling mandou');
});

test('⚠️ a data de conferencia do estoque e ESCRITA a cada coleta', () => {
  /* `atualizado_em` tem `default now()` e nao ha gatilho: sem esta linha ela
   * guarda quando o SKU apareceu pela primeira vez, e nao quando foi conferido.
   * Uma linha marcava 30/07 com o robo rodando todo dia. */
  assert.match(ROBO, /atualizado_em: new Date\(\)\.toISOString\(\)/,
    'sem isto a coluna "atualizado_em" mente');
});

// ── O ROBO DO GESTOR COMERCIAL ─────────────────────────────────────────────
const DO_BLING = [
  { deposito_id: 14889124779, nome: 'Estoque Almoxarifado',     ativo: true, padrao: false },
  { deposito_id: 14888617206, nome: 'Estoque Loja Dom Pedro',   ativo: true, padrao: false },
  { deposito_id: 14888726315, nome: 'Estoque Loja Sbo. Tivoli', ativo: true, padrao: false },
  { deposito_id: 14888248253, nome: 'Estoque P.A Pulmão',       ativo: true, padrao: true  },
];

test('lojasEPulmao: le do Bling e tira o "Estoque Loja" do nome', () => {
  const { lojas, pulmao } = lojasEPulmao(DO_BLING);
  assert.deepEqual(lojas.map((l) => l.loja), ['Dom Pedro', 'Sbo. Tivoli']);
  assert.equal(pulmao, '14888248253', 'o pulmao e o `padrao` do Bling');
});

test('lojasEPulmao: LOJA NOVA entra sozinha na vitrine', () => {
  const { lojas } = lojasEPulmao([...DO_BLING,
    { deposito_id: 999, nome: 'Estoque Loja Iguatemi', ativo: true, padrao: false }]);
  assert.ok(lojas.some((l) => l.loja === 'Iguatemi'),
    'loja criada no Bling tem de aparecer sem ninguem mexer em codigo');
});

test('lojasEPulmao: retaguarda NAO vira vitrine', () => {
  const { lojas } = lojasEPulmao(DO_BLING);
  assert.ok(!lojas.some((l) => /almoxarifado|pulm/i.test(l.loja)),
    'almoxarifado e pulmao nao sao loja de varejo');
});

test('⚠️ lojasEPulmao: sem deposito nenhum cai na SEMENTE, e nao em nada', () => {
  // Devolver [] faria o robo publicar uma vitrine vazia — pior que a de ontem.
  const { lojas, pulmao } = lojasEPulmao([]);
  assert.equal(lojas.length, 2);
  assert.equal(pulmao, '14888248253');
});

test('⚠️ importar o robo do gestor NAO dispara o robo', () => {
  /* Ate 05/09/2026 o `main()` estava solto no fim do arquivo: qualquer import
   * disparava login, chamadas ao Bling, chamadas a IA e escrita no log — contra
   * producao. Foi o que aconteceu comigo ao tentar testar uma funcao pura.
   * O proprio fato de este arquivo de teste importar `gestor-comercial.mjs` e
   * terminar ja e a prova; a asserção abaixo trava a trava. */
  const fonte = readFileSync(new URL('./gestor-comercial.mjs', import.meta.url), 'utf8');
  assert.match(fonte, /if \(import\.meta\.url === pathToFileURL\(process\.argv\[1\] \|\| ''\)\.href\) \{/,
    'o main() voltou a rodar em qualquer import');
});
