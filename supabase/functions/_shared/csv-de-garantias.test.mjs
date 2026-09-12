import test from 'node:test';
import assert from 'node:assert/strict';
import { montarCsvDeGarantias, CABECALHO, ESTADO_LEGIVEL } from './csv-de-garantias.js';

/* A PLANILHA DAS GARANTIAS no Zoho WorkDrive (06/09/2026).
 *
 * Ate hoje a garantia so vivia no banco: nenhum robo a espelhava, e a unica
 * saida era o botao "Baixar planilha" da Central, sob demanda. O dono pediu o
 * espelho automatico, junto do CSV da lista de espera.
 *
 * ⚠️ ESTE ARQUIVO CARREGA CPF DE CLIENTE, por escolha do dono. Os testes abaixo
 * existem para que o conteudo nunca mude por acidente. */

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

const linhas = (csv) => csv.trim().split('\n');

test('o cabecalho e exatamente este, e nesta ordem', () => {
  assert.equal(linhas(montarCsvDeGarantias([], []))[0], CABECALHO.join(','));
  assert.equal(CABECALHO.length, 12);
});

test('planilha vazia continua sendo planilha — so o cabecalho', () => {
  /* Devolver texto vazio faria o robo subir um arquivo em branco, e quem
   * abrisse concluiria que perdeu as colunas. */
  const csv = montarCsvDeGarantias([], [], {});
  assert.equal(linhas(csv).length, 1);
  assert.match(csv, /^estado,codigo/);
});

test('garantia confirmada sai com modelo, cor e prazo', () => {
  const l = linhas(montarCsvDeGarantias(REGISTROS, [], PECAS))[1];
  assert.match(l, /^confirmada,PX9FWMYJET,Lunea,Chocolate,/);
  assert.match(l, /2028-03-12/, 'falta a data ate quando a garantia vale');
  assert.match(l, /10482/, 'falta o pedido do Bling');
});

test('⚠️ o CPF vai INTEIRO — decisao do dono, nao descuido', () => {
  assert.match(montarCsvDeGarantias(REGISTROS, [], PECAS), /123\.456\.789-00/);
});

test('a fila de conferencia entra, com o estado em portugues', () => {
  const l = linhas(montarCsvDeGarantias([], PEDIDOS, PECAS))[1];
  assert.match(l, /^em conferência,AB12CD34EF,Linear,Marrom,/);
  assert.equal(ESTADO_LEGIVEL.pendente, 'em conferência');
  assert.equal(ESTADO_LEGIVEL.recusado, 'recusada');
});

// Partir a linha por virgula NAO serve: o nome vai entre aspas justamente
// porque tem virgula dentro. Este leitor respeita as aspas — foi escrito depois
// de o teste abaixo falhar por causa disso.
function colunas(linha) {
  const out = []; let campo = ''; let dentroDeAspas = false;
  for (let i = 0; i < linha.length; i++) {
    const c = linha[i];
    if (dentroDeAspas) {
      if (c === '"' && linha[i + 1] === '"') { campo += '"'; i++; }
      else if (c === '"') dentroDeAspas = false;
      else campo += c;
    } else if (c === '"') dentroDeAspas = true;
    else if (c === ',') { out.push(campo); campo = ''; }
    else campo += c;
  }
  out.push(campo);
  return out;
}

test('pedido em conferencia NAO inventa data de garantia', () => {
  // Ele ainda nao tem prazo; escrever qualquer coisa ali seria mentira.
  const campos = colunas(linhas(montarCsvDeGarantias([], PEDIDOS, PECAS))[1]);
  assert.equal(campos[CABECALHO.indexOf('garantia_ate')], '');
  assert.equal(campos[CABECALHO.indexOf('pedido_bling')], '');
  assert.equal(campos.length, CABECALHO.length, 'a linha tem de ter uma coluna por cabecalho');
});

test('toda linha tem o MESMO numero de colunas do cabecalho', () => {
  // Linha com coluna a mais ou a menos desalinha a planilha inteira do ponto
  // em que aparece para baixo — e ninguem recebe erro.
  for (const l of linhas(montarCsvDeGarantias(REGISTROS, PEDIDOS, PECAS)).slice(1)) {
    assert.equal(colunas(l).length, CABECALHO.length, `linha torta: ${l}`);
  }
});

test('⚠️ a mesma pessoa NAO aparece duas vezes', () => {
  /* Pedido aprovado JA tem linha em `vessel_registros`. Sem o corte, quem
   * contasse as garantias contaria dobrado. */
  const aprovado = [{ ...PEDIDOS[0], codigo: 'PX9FWMYJET', estado: 'aprovado' }];
  const csv = montarCsvDeGarantias(REGISTROS, aprovado, PECAS);
  assert.equal(linhas(csv).length, 2, 'a linha da fila tinha de ter sido descartada');
  assert.match(linhas(csv)[1], /^confirmada,PX9FWMYJET/);
});

test('nome com virgula nao quebra a planilha', () => {
  // "Joana, a Silva" partiria a linha em duas colunas sem as aspas.
  const csv = montarCsvDeGarantias([], PEDIDOS, PECAS);
  assert.match(csv, /"Joana, a Silva"/);
});

test('mais recente primeiro', () => {
  const csv = montarCsvDeGarantias(REGISTROS, PEDIDOS, PECAS);
  const [, primeira, segunda] = linhas(csv);
  assert.match(primeira, /AB12CD34EF/, 'o pedido de 05/09 e mais novo que o registro de 12/03');
  assert.match(segunda, /PX9FWMYJET/);
});

test('peca sem lote conhecido nao quebra — modelo e cor ficam vazios', () => {
  const l = linhas(montarCsvDeGarantias(REGISTROS, [], {}))[1];
  assert.match(l, /^confirmada,PX9FWMYJET,,,/);
});

test('data ruim vira vazio, e nao "Invalid Date"', () => {
  const sujo = [{ ...REGISTROS[0], registrado_em: 'nao-e-data', comprado_em: 'xx' }];
  const csv = montarCsvDeGarantias(sujo, [], PECAS);
  assert.ok(!/Invalid|NaN/.test(csv), 'data invalida vazou para a planilha');
});
