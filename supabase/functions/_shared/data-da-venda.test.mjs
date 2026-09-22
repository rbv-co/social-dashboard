import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ajustarPelaDataDaNota } from './data-da-venda.js';

// A REGRA mora aqui (e não em src/) porque a Edge da notificação de vendas roda
// no Deno e não alcança src/. Estes testes são os da regra; os que dependem do
// cliente do navegador ficam em src/compartilhado/data-da-venda.test.mjs.

const ped = (id, data, total = 100, loja = 205451611, numero = id) => ({ id, numero, data, total, loja: { id: loja } });
// ⚠️ `nota_situacao: 5` É O PADRÃO DAQUI porque 5 é "autorizada", e desde
// 22/09/2026 só nota autorizada entra na conta. Teste que quiser o contrário
// passa o estado explicitamente — e é o que os testes novos, lá embaixo, fazem.
const linha = (pedido_id, data_pedido, data_da_venda, total = 100, nota_situacao = 5) => ({
  pedido_id, pedido_numero: String(pedido_id), data_pedido, data_da_venda, total,
  loja_id: 205451611, nota_situacao,
});

test('o caso do dono: pedido na quinta, nota na sexta — sai da quinta e entra na sexta', () => {
  const quinta = ajustarPelaDataDaNota([ped(1, '2026-08-06')], [linha(1, '2026-08-06', '2026-08-07')], '2026-08-06', '2026-08-06');
  assert.equal(quinta.pedidos.length, 0, 'a quinta não conta mais essa venda');
  assert.equal(quinta.removidos, 1);

  const sexta = ajustarPelaDataDaNota([], [linha(1, '2026-08-06', '2026-08-07')], '2026-08-07', '2026-08-07');
  assert.equal(sexta.pedidos.length, 1, 'a sexta passa a contar');
  assert.equal(sexta.trazidos, 1);
  assert.equal(sexta.pedidos[0].data, '2026-08-07');
  assert.equal(sexta.pedidos[0].total, 100);
});

test('venda faturada no mesmo dia não se mexe', () => {
  const r = ajustarPelaDataDaNota([ped(1, '2026-08-06')], [linha(1, '2026-08-06', '2026-08-06')], '2026-08-06', '2026-08-06');
  assert.equal(r.pedidos.length, 1);
  assert.equal(r.trazidos, 0);
  assert.equal(r.removidos, 0);
});

test('pedido sem linha nossa FICA — sumir por falta de informação seria pior', () => {
  const r = ajustarPelaDataDaNota([ped(9, '2026-08-11')], [], '2026-08-11', '2026-08-11');
  assert.equal(r.pedidos.length, 1, 'o robô ainda não passou por ele; a tela não pode perdê-lo');
  assert.equal(r.semResposta, 1);
  assert.equal(r.pedidos[0].data, '2026-08-11');
});

test('a data ORIGINAL do pedido é preservada — o cache grava essa, não a da nota', () => {
  const r = ajustarPelaDataDaNota([ped(1, '2026-08-06')], [linha(1, '2026-08-06', '2026-08-07')], '2026-08-01', '2026-08-31');
  assert.equal(r.pedidos[0].data, '2026-08-07', 'a tela soma pela data da nota');
  assert.equal(r.pedidos[0].dataDoPedido, '2026-08-06', 'e o cache continua sabendo o dia do pedido');
});

test('dentro do mesmo mês, o mês não muda — só o dia', () => {
  const mes = ajustarPelaDataDaNota(
    [ped(1, '2026-08-04', 3644.30), ped(2, '2026-08-04', 2550.74)],
    [linha(1, '2026-08-04', '2026-08-05', 3644.30), linha(2, '2026-08-04', '2026-08-05', 2550.74)],
    '2026-08-01', '2026-08-31');
  assert.equal(mes.pedidos.length, 2, 'os dois seguem dentro do mês');
  assert.equal(mes.pedidos.reduce((s, p) => s + p.total, 0), 6195.04);
  assert.ok(mes.pedidos.every(p => p.data === '2026-08-05'));
});

test('pedido trazido de outro dia vem com número e canal, pra esteira e o ranking', () => {
  const r = ajustarPelaDataDaNota([], [linha(2429, '2026-08-04', '2026-08-05', 3644.30)], '2026-08-05', '2026-08-05');
  const p = r.pedidos[0];
  assert.equal(p.numero, '2429');
  assert.equal(p.loja.id, 205451611);
  assert.equal(p.trazidoDeOutroDia, true);
  assert.equal(p.dataDoPedido, '2026-08-04');
});

test('linha fora da janela não entra de carona', () => {
  const r = ajustarPelaDataDaNota([], [linha(1, '2026-07-01', '2026-07-02')], '2026-08-01', '2026-08-31');
  assert.equal(r.pedidos.length, 0);
});

test('a borda do último dia conta (df é inclusivo)', () => {
  const r = ajustarPelaDataDaNota([], [linha(1, '2026-07-30', '2026-08-31')], '2026-08-01', '2026-08-31');
  assert.equal(r.pedidos.length, 1, 'o dia 31 faz parte de agosto');
});

test('data com hora (o Bling às vezes manda) não quebra a comparação', () => {
  const r = ajustarPelaDataDaNota([ped(1, '2026-08-06 14:22:00')], [linha(1, '2026-08-06', '2026-08-06')], '2026-08-06', '2026-08-06');
  assert.equal(r.pedidos.length, 1);
  assert.equal(r.pedidos[0].dataDoPedido, '2026-08-06');
});



// ── O ESTADO DA NOTA (22/09/2026) ───────────────────────────────────────────
// Pedido do dono: "não pode acontecer de mostrar pedido rejeitado, não
// autorizado, somente os que estiverem autorizado".

test('⚠️ o caso real: pedido CANCELADO no Bling não entra pela tabela', () => {
  // Foi isto que fez a Gestão à Vista mostrar R$ 6.900 em 21/09. O pedido 2680
  // estava cancelado no Bling — por isso o Bling ao vivo NÃO o devolveu — mas a
  // tabela ainda o tinha, e o bloco "os que entram" o inventava de volta.
  // Pedido cancelado não tem nota autorizada: a trava fecha os dois buracos.
  const vivo = ajustarPelaDataDaNota(
    [ped(2682, '2026-09-21', 3450)],
    [linha(2682, '2026-09-21', '2026-09-21', 3450),
     linha(2680, '2026-09-21', '2026-09-21', 3450, 2)],   // nota cancelada
    '2026-09-21', '2026-09-21');
  assert.equal(vivo.pedidos.length, 1, 'o cancelado voltou para a conta');
  assert.equal(vivo.pedidos[0].id, 2682);
  assert.equal(vivo.pedidos.reduce((t, p) => t + p.total, 0), 3450);
});

test('nota REJEITADA não entra pela tabela', () => {
  const r = ajustarPelaDataDaNota([], [linha(1, '2026-08-04', '2026-08-05', 900, 4)],
    '2026-08-05', '2026-08-05');
  assert.equal(r.pedidos.length, 0);
  assert.equal(r.trazidos, 0);
});

test('nota autorizada com DANFE emitida (6) CONTA — é a NF-e do atacado', () => {
  // Tratar 6 como "outra coisa" apagaria R$ 643 mil de NF-e da conta: medido,
  // é o estado em que quase toda NF-e da casa fica.
  const r = ajustarPelaDataDaNota([], [linha(1, '2026-08-04', '2026-08-05', 900, 6)],
    '2026-08-05', '2026-08-05');
  assert.equal(r.trazidos, 1);
  assert.equal(r.pedidos[0].total, 900);
});

test('⚠️ pedido ATENDIDO no Bling com nota rejeitada SAI da conta', () => {
  // O Bling diz que o pedido está atendido, mas a nota foi rejeitada: não é
  // faturamento, é uma venda que não se completou.
  const r = ajustarPelaDataDaNota([ped(1, '2026-08-06', 500)],
    [linha(1, '2026-08-06', '2026-08-06', 500, 4)], '2026-08-06', '2026-08-06');
  assert.equal(r.pedidos.length, 0);
  assert.equal(r.removidos, 1);
});

test('⚠️ mas nota PENDENTE fica — senão o painel amanhece vazio todo dia', () => {
  // Negada (2, 4, 9) é diferente de pendente (1, 3, 8). A nota que ainda não
  // voltou da Sefaz é venda em processamento; tirá-la da tela seria trocar um
  // erro pequeno por um buraco. Vale a mesma regra do pedido sem linha nenhuma.
  const r = ajustarPelaDataDaNota([ped(1, '2026-08-06', 500)],
    [linha(1, '2026-08-06', '2026-08-06', 500, 1)], '2026-08-06', '2026-08-06');
  assert.equal(r.pedidos.length, 1);
  assert.equal(r.pedidos[0].total, 500);
});

test('pedido sem nota nenhuma (situação nula) continua como está', () => {
  const r = ajustarPelaDataDaNota([ped(1, '2026-08-06', 500)],
    [linha(1, '2026-08-06', '2026-08-06', 500, null)], '2026-08-06', '2026-08-06');
  assert.equal(r.pedidos.length, 1);
});
