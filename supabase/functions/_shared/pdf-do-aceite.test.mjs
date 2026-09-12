import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { linhasDoAceite, pastasDoAceite, nomeDoAceite, NIVEIS_TANQUE } from './pdf-do-aceite.js';

const VEICULO = { nome: 'FIAT BRAVO ESSENCE', placa: 'OLW4I46' };
const USO = {
  pessoa_nome: 'Marcus Vinicius',
  saida_em: '2026-08-19T11:30:00Z',
  destino: 'Obra Tivoli',
  finalidade: 'Levar material',
  aceite_em: '2026-08-19T11:35:12Z',
  aceite_nome: 'Marcus Vinicius',
  aceite_checklist_hash: 'abc123def456',
  aceite_rabisco: [[[0, 0], [10, 10]]],
};
const FICHA = {
  feita_em: '2026-08-19', pessoa_nome: 'Thiago Siqueira',
  hodometro: 47000, resultado: 'com_ressalvas',
};
const RESPOSTAS = [
  { estado: 'ok', item_texto: 'Pneus' },
  { estado: 'nao_ok', item_texto: 'Farol baixo direito', observacao: 'queimado' },
  { estado: 'ok', item_texto: 'Freios' },
];
const texto = (L) => L.map((l) => l.texto).join('\n');

test('o papel diz de que documento se trata', () => {
  const t = texto(linhasDoAceite({ uso: USO, veiculo: VEICULO, ficha: FICHA, respostas: RESPOSTAS }));
  assert.match(t, /aceite de retirada/i);
  assert.match(t, /OLW4I46/);
  assert.match(t, /FIAT BRAVO ESSENCE/);
});

test('diz quem pegou o carro e quando assinou', () => {
  const t = texto(linhasDoAceite({ uso: USO, veiculo: VEICULO, ficha: FICHA, respostas: RESPOSTAS }));
  assert.match(t, /Marcus Vinicius/);
  assert.match(t, /Bras[ií]lia/);
});

// DECISÃO DO DONO (18/08): o papel leva o RESUMO da vistoria, não ela inteira.
test('o resumo traz hodômetro, tanque e resultado', () => {
  const t = texto(linhasDoAceite({
    uso: { ...USO, tanque_quartos: 3 }, veiculo: VEICULO, ficha: FICHA, respostas: RESPOSTAS,
  }));
  assert.match(t, /47\.000 km/);
  assert.match(t, /3\/4/);
  assert.match(t, /ressalvas/i);
});

test('o resumo lista SÓ os itens com problema, e diz quantos foram conferidos', () => {
  const t = texto(linhasDoAceite({ uso: USO, veiculo: VEICULO, ficha: FICHA, respostas: RESPOSTAS }));
  assert.match(t, /Farol baixo direito/);
  assert.match(t, /queimado/);
  assert.doesNotMatch(t, /Pneus/);   // item ok não entra: é resumo, não a lista inteira
  assert.doesNotMatch(t, /Freios/);
  assert.match(t, /3/);              // mas o total conferido aparece
});

test('vistoria sem problema nenhum DIZ isso, em vez de deixar seção vazia', () => {
  const t = texto(linhasDoAceite({
    uso: USO, veiculo: VEICULO, ficha: FICHA,
    respostas: [{ estado: 'ok', item_texto: 'Pneus' }],
  }));
  assert.match(t, /nenhum item com problema/i);
});

// O rabisco é opcional. Espaço em branco no lugar de uma assinatura é a
// ambiguidade que este documento existe para não ter.
test('sem rabisco, o papel escreve que não houve desenho', () => {
  const L = linhasDoAceite({ uso: { ...USO, aceite_rabisco: null }, veiculo: VEICULO, ficha: FICHA, respostas: RESPOSTAS });
  assert.match(texto(L), /sem rabisco|não há rabisco/i);
  assert.equal(L.filter((l) => l.estilo === 'rabisco').length, 0);
});

test('com rabisco, ele vai desenhado', () => {
  const L = linhasDoAceite({ uso: USO, veiculo: VEICULO, ficha: FICHA, respostas: RESPOSTAS });
  assert.equal(L.filter((l) => l.estilo === 'rabisco').length, 1);
});

test('leva o código da ficha congelada — é o elo com a vistoria', () => {
  const t = texto(linhasDoAceite({ uso: USO, veiculo: VEICULO, ficha: FICHA, respostas: RESPOSTAS }));
  assert.match(t, /abc123def456/);
});

// Se a ficha congelada não vier, o papel não pode fingir que a vistoria não existiu.
test('sem a ficha, diz que não conseguiu carregar — não omite em silêncio', () => {
  const t = texto(linhasDoAceite({ uso: USO, veiculo: VEICULO, ficha: null, respostas: null }));
  assert.match(t, /não foi possível carregar|não carregou/i);
  assert.match(t, /abc123def456/);  // o código continua lá
});

test('vai para a mesma pasta do checklist daquele carro e mês', () => {
  assert.deepEqual(
    pastasDoAceite({ uso: USO, veiculo: VEICULO }),
    ['Frota', 'FIAT BRAVO ESSENCE (OLW4I46)', '2026-08'],
  );
});

test('o nome do arquivo distingue aceite de checklist', () => {
  const n = nomeDoAceite({ uso: USO, veiculo: VEICULO });
  assert.match(n, /^aceite-2026-08-19-OLW4I46\.pdf$/);
  assert.doesNotMatch(n, /checklist/);
});

test('data faltando não vira pasta errada nem nome quebrado', () => {
  assert.deepEqual(pastasDoAceite({ uso: {}, veiculo: VEICULO })[2], 'sem-data');
  assert.match(nomeDoAceite({ uso: {}, veiculo: {} }), /sem-data.*sem-placa/);
});

// A MESMA RÉGUA DO TANQUE EM DOIS LUGARES. A tela lê de estado-do-veiculo.js e
// a Edge Function não alcança `src/` (roda no Deno). Cópia sem vigia diverge, e
// aí o papel diria "3/4" onde a tela diz "2/4".
test('os rótulos do tanque batem com os da tela', () => {
  const naTela = readFileSync('src/ferramentas/frota/estado-do-veiculo.js', 'utf8');
  const m = /export const NIVEIS_TANQUE = (\[[^\]]*\])/.exec(naTela);
  assert.ok(m, 'não achei NIVEIS_TANQUE na tela');
  assert.deepEqual(NIVEIS_TANQUE, JSON.parse(m[1].replace(/'/g, '"')));
});
