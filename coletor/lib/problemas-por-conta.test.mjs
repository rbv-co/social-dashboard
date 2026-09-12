import { test } from 'node:test';
import assert from 'node:assert/strict';
import { linhasDaConta } from './problemas-por-conta.mjs';

const CONTA = { id: 'c1', display_name: 'Vessel' };
const problema = (codigo) => ({
  error_code: codigo,
  error_summary: 'Ativos ausentes',
  error_message: 'Ativos ausentes: falta o link do botão.',
  error_type: 'HARD_ERROR',
  level: 'AD',
});

test('anúncio sem reclamação não vira linha', () => {
  const linhas = linhasDaConta(CONTA, [{ id: 'k1', name: 'Campanha A' }], [
    { id: 'a1', name: 'Anúncio 1', campaign_id: 'k1' },
    { id: 'a2', name: 'Anúncio 2', campaign_id: 'k1', issues_info: [] },
  ]);
  assert.deepEqual(linhas, []);
});

test('cada linha carrega o nome da conta e o nome da campanha certa', () => {
  const linhas = linhasDaConta(
    CONTA,
    [{ id: 'k1', name: 'Campanha A' }, { id: 'k2', name: 'Campanha B' }],
    [
      { id: 'a1', name: 'Anúncio 1', campaign_id: 'k1', issues_info: [problema(1443128)] },
      { id: 'a2', name: 'Anúncio 2', campaign_id: 'k2', issues_info: [problema(2643046)] },
    ],
  );
  assert.equal(linhas.length, 2);
  const porAd = Object.fromEntries(linhas.map((l) => [l.ad_id, l]));
  assert.equal(porAd.a1.campanha_nome, 'Campanha A');
  assert.equal(porAd.a1.campaign_id, 'k1');
  assert.equal(porAd.a2.campanha_nome, 'Campanha B');
  assert.equal(porAd.a1.conta_nome, 'Vessel');
  assert.equal(porAd.a2.conta_nome, 'Vessel');
});

test('campanha que a Meta não devolveu: guarda o id e cala sobre o nome', () => {
  const [linha] = linhasDaConta(CONTA, [], [
    { id: 'a1', name: 'Anúncio 1', campaign_id: 'k9', issues_info: [problema(1443128)] },
  ]);
  assert.equal(linha.campaign_id, 'k9');
  assert.equal(linha.campanha_nome, '');
});

// O par (anúncio, código) repetido derruba a gravação da CONTA INTEIRA no
// Postgres ("ON CONFLICT DO UPDATE command cannot affect row a second time").
// A paginação da Meta devolve o mesmo anúncio duas vezes quando algo muda entre
// as páginas — e aí a conta perderia toda a história por causa disso.
test('anúncio repetido pela paginação não duplica linha', () => {
  const ad = { id: 'a1', name: 'Anúncio 1', campaign_id: 'k1', issues_info: [problema(1443128)] };
  const linhas = linhasDaConta(CONTA, [{ id: 'k1', name: 'Campanha A' }], [ad, { ...ad }]);
  assert.equal(linhas.length, 1);
});

test('mesmo anúncio repetido em campanhas diferentes ainda sai uma vez só', () => {
  const linhas = linhasDaConta(
    CONTA,
    [{ id: 'k1', name: 'A' }, { id: 'k2', name: 'B' }],
    [
      { id: 'a1', name: 'Anúncio 1', campaign_id: 'k1', issues_info: [problema(1443128)] },
      { id: 'a1', name: 'Anúncio 1', campaign_id: 'k2', issues_info: [problema(1443128)] },
    ],
  );
  assert.equal(linhas.length, 1);
});

test('conta sem nenhum problema devolve lista vazia — e é ela que fecha o que sumiu', () => {
  assert.deepEqual(linhasDaConta(CONTA, [{ id: 'k1', name: 'A' }], []), []);
});

test('nome da conta cai para `name` quando não há display_name', () => {
  const [linha] = linhasDaConta({ id: 'c1', name: 'Motoeasy' }, [], [
    { id: 'a1', name: 'X', campaign_id: null, issues_info: [problema(1443128)] },
  ]);
  assert.equal(linha.conta_nome, 'Motoeasy');
});
