import test from 'node:test';
import assert from 'node:assert/strict';
import { linhasDeGarantias, pecaParaLote, COLUNAS, ESTADO_LEGIVEL } from './planilha-de-garantias.js';
import { montarXlsx } from './planilha-xlsx.js';
import { abasDoXlsx } from './ler-xlsx.mjs';

/* A ABA DAS GARANTIAS no Zoho WorkDrive (06/09/2026; virou aba de xlsx em
 * 21/09/2026).
 *
 * Até 06/09 a garantia só vivia no banco: nenhum robô a espelhava, e a única
 * saída era o botão "Baixar planilha" da Central, sob demanda.
 *
 * ⚠️ ESTE ARQUIVO CARREGA CPF DE CLIENTE, por escolha do dono. Os testes abaixo
 * existem para que o conteúdo nunca mude por acidente.
 *
 * Os testes de coluna torta e de nome com vírgula que existiam na versão CSV
 * saíram: em xlsx cada célula tem endereço próprio (A2, B2…), então vírgula no
 * nome não desloca coluna nenhuma. O que os substitui é o teste de que a linha
 * tem uma coluna por cabeçalho, que continua aqui. */

const REGISTROS = [
  { codigo: 'PX9FWMYJET', nome: 'Marina Albuquerque', cpf: '123.456.789-00',
    whatsapp: '(19) 99812-4477', onde_comprou: 'Shopping Tivoli Santa Bárbara',
    comprado_em: '2026-03-12', garantia_ate: '2028-03-12',
    registrado_em: '2026-03-12T13:04:00Z', bling_pedido: '10482' },
];
const PEDIDOS = [
  { codigo: 'AB12CD34EF', nome: 'Joana, a Silva', cpf: '987.654.321-00',
    whatsapp: '(19) 99111-2222', onde_comprou: 'Comprei em outro lugar',
    comprado_em: '2026-09-01', estado: 'pendente', criado_em: '2026-09-05T18:00:00Z' },
];
const PECAS = {
  PX9FWMYJET: { modelo: 'Lunea', cor: 'Chocolate' },
  AB12CD34EF: { modelo: 'Linear', cor: 'Marrom' },
};

const coluna = (titulo) => COLUNAS.findIndex((c) => c.titulo === titulo);

test('o cabeçalho é exatamente este, e nesta ordem', async () => {
  assert.deepEqual(COLUNAS.map((c) => c.titulo), [
    'Estado', 'Código', 'Modelo', 'Cor', 'Nome', 'CPF', 'WhatsApp', 'Onde comprou',
    'Comprado em', 'Garantia até', 'Registrado em', 'Pedido no Bling']);
});

test('planilha vazia continua sendo planilha — só o cabeçalho', async () => {
  /* Devolver nada faria o robô subir uma aba em branco, e quem abrisse
   * concluiria que perdeu as colunas. */
  const [aba] = abasDoXlsx(await montarXlsx([{ nome: 'Garantias', colunas: COLUNAS, linhas: linhasDeGarantias([], [], {}) }]));
  assert.deepEqual(aba.colunas[0], 'Estado');
  assert.equal(aba.linhas.length, 0);
});

test('garantia confirmada sai com modelo, cor e prazo', async () => {
  const [l] = linhasDeGarantias(REGISTROS, [], PECAS);
  assert.equal(l[coluna('Estado')], 'confirmada');
  assert.equal(l[coluna('Código')], 'PX9FWMYJET');
  assert.equal(l[coluna('Modelo')], 'Lunea');
  assert.equal(l[coluna('Cor')], 'Chocolate');
  assert.equal(l[coluna('Garantia até')], '2028-03-12', 'falta a data até quando a garantia vale');
  assert.equal(l[coluna('Pedido no Bling')], '10482');
});

test('⚠️ o CPF vai INTEIRO — decisão do dono, não descuido', async () => {
  const [l] = linhasDeGarantias(REGISTROS, [], PECAS);
  assert.equal(l[coluna('CPF')], '123.456.789-00');
});

test('a fila de conferência entra, com o estado em português', async () => {
  const [l] = linhasDeGarantias([], PEDIDOS, PECAS);
  assert.equal(l[coluna('Estado')], 'em conferência');
  assert.equal(l[coluna('Modelo')], 'Linear');
  assert.equal(ESTADO_LEGIVEL.pendente, 'em conferência');
  assert.equal(ESTADO_LEGIVEL.recusado, 'recusada');
});

test('pedido em conferência NÃO inventa data de garantia', async () => {
  // Ele ainda não tem prazo; escrever qualquer coisa ali seria mentira.
  const [l] = linhasDeGarantias([], PEDIDOS, PECAS);
  assert.equal(l[coluna('Garantia até')], '');
  assert.equal(l[coluna('Pedido no Bling')], '');
});

test('toda linha tem o MESMO número de colunas do cabeçalho', async () => {
  // Linha com coluna a mais ou a menos desalinha a leitura de quem usa o índice
  // da coluna — e ninguém recebe erro.
  for (const l of linhasDeGarantias(REGISTROS, PEDIDOS, PECAS)) {
    assert.equal(l.length, COLUNAS.length, `linha torta: ${JSON.stringify(l)}`);
  }
});

test('⚠️ a mesma pessoa NÃO aparece duas vezes', async () => {
  /* Pedido aprovado JÁ tem linha em `vessel_registros`. Sem o corte, quem
   * contasse as garantias contaria dobrado. */
  const aprovado = [{ ...PEDIDOS[0], codigo: 'PX9FWMYJET', estado: 'aprovado' }];
  const linhas = linhasDeGarantias(REGISTROS, aprovado, PECAS);
  assert.equal(linhas.length, 1, 'a linha da fila tinha de ter sido descartada');
  assert.equal(linhas[0][coluna('Código')], 'PX9FWMYJET');
});

test('mais recente primeiro', async () => {
  const linhas = linhasDeGarantias(REGISTROS, PEDIDOS, PECAS);
  assert.equal(linhas[0][coluna('Código')], 'AB12CD34EF', 'o pedido de 05/09 é mais novo que o registro de 12/03');
  assert.equal(linhas[1][coluna('Código')], 'PX9FWMYJET');
});

test('peça sem lote conhecido não quebra — modelo e cor ficam vazios', async () => {
  const [l] = linhasDeGarantias(REGISTROS, [], {});
  assert.equal(l[coluna('Modelo')], '');
  assert.equal(l[coluna('Cor')], '');
});

test('data ruim vira vazio, e não "Invalid Date" na célula', async () => {
  const sujo = [{ ...REGISTROS[0], registrado_em: 'nao-e-data', comprado_em: 'xx' }];
  const [aba] = abasDoXlsx(await montarXlsx([{
    nome: 'Garantias', colunas: COLUNAS, linhas: linhasDeGarantias(sujo, [], PECAS),
  }]));
  const texto = aba.linhas.flat().join('|');
  assert.ok(!/Invalid|NaN/.test(texto), `data inválida vazou: ${texto}`);
  assert.equal(aba.linhas[0][coluna('Comprado em')], '');
  assert.equal(aba.linhas[0][coluna('Registrado em')], '');
});

test('o registro em 13h04 de Londres aparece como 10h04 no Brasil', async () => {
  const [aba] = abasDoXlsx(await montarXlsx([{
    nome: 'Garantias', colunas: COLUNAS, linhas: linhasDeGarantias(REGISTROS, [], PECAS),
  }]));
  assert.equal(aba.linhas[0][coluna('Registrado em')], '12/03/2026 10:04');
});

test('o mapa da peça liga código -> modelo e cor pelas duas tabelas', async () => {
  const mapa = pecaParaLote(
    [{ codigo: 'PX9FWMYJET', lote_id: 7 }, { codigo: 'ORFA', lote_id: 99 }],
    [{ id: 7, modelo: 'Lunea', cor: 'Chocolate' }]);
  assert.deepEqual(mapa.PX9FWMYJET, { modelo: 'Lunea', cor: 'Chocolate' });
  // Peça cujo lote não existe mais não inventa modelo.
  assert.equal(mapa.ORFA, undefined);
});
