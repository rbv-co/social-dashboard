import { test } from 'node:test';
import assert from 'node:assert/strict';
import { montarXlsx } from '../../supabase/functions/_shared/planilha-xlsx.js';
import { abasDoXlsx } from '../../supabase/functions/_shared/ler-xlsx.mjs';
import {
  montarAbasDaTriagem, anotacoesDoRh, triagem, telefoneLegivel, telefoneComPais,
} from './abas-da-triagem.mjs';

const lead = (id, t, campos, platform = 'ig') => ({
  id, created_time: t, platform,
  field_data: Object.entries(campos).map(([name, v]) => ({ name, values: [v] })),
});

const A = lead('111', '2026-09-25T20:00:00+0000',
  { full_name: 'Ana', phone_number: '+5519999998888', city: 'Americana', experiencia: 'luxo', disponibilidade: 'sim' });
const B = lead('222', '2026-09-26T10:00:00+0000',
  { full_name: 'Bia', phone_number: '19988887777', city: 'Santa Bárbara', experiencia: 'Ainda não', disponibilidade: 'Não' }, 'fb');

test('triagem: sem fim de semana vence a experiência', () => {
  assert.equal(triagem('luxo', 'nao'), '❌ Sem fim de semana');
  assert.equal(triagem('Sim, em moda ou varejo de luxo', 'Sim'), '⭐ Prioridade');
  assert.equal(triagem('varejo', 'sim'), '✅ Chamar');
  assert.equal(triagem('nao', 'sim'), '🟡 Sem experiência');
});

test('telefone com e sem 55', () => {
  assert.equal(telefoneComPais('+55 19 99999-8888'), '5519999998888');
  assert.equal(telefoneComPais('19988887777'), '5519988887777');
  assert.equal(telefoneLegivel('+5519999998888'), '(19) 99999-8888');
});

test('mais novo em cima, rótulos traduzidos', () => {
  const [cand] = montarAbasDaTriagem([A, B]);
  assert.deepEqual(cand.linhas.map((l) => l[1]), ['Bia', 'Ana']);
  assert.equal(cand.linhas[1][5], 'Sim, em moda ou varejo de luxo');
  assert.equal(cand.linhas[0][6], 'Não');
  assert.equal(cand.linhas[0][8], 'Facebook');
});

test('a anotação do RH sobrevive à volta do robô, casada por ID e não por linha', async () => {
  // 1ª volta: só a Ana. O RH anota na linha dela.
  const [c1, u1] = montarAbasDaTriagem([A]);
  c1.linhas[0][9] = 'Entrevista 30/09';
  c1.linhas[0][10] = 'Trabalhou na Arezzo';
  const noZoho = abasDoXlsx(await montarXlsx([c1, u1]));
  // 2ª volta: chega a Bia, que passa a ocupar a 1ª linha.
  const [c2] = montarAbasDaTriagem([A, B], anotacoesDoRh(noZoho));
  const ana = c2.linhas.find((l) => l[11] === '111');
  const bia = c2.linhas.find((l) => l[11] === '222');
  assert.equal(ana[9], 'Entrevista 30/09');
  assert.equal(ana[10], 'Trabalhou na Arezzo');
  assert.equal(bia[9], '');
});

test('sem ninguém ainda: a planilha abre com as duas abas', async () => {
  const abas = abasDoXlsx(await montarXlsx(montarAbasDaTriagem([])));
  assert.deepEqual(abas.map((a) => a.nome), ['Candidatos', 'Como usar']);
});
