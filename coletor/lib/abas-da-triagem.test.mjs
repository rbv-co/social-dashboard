import { test } from 'node:test';
import assert from 'node:assert/strict';
import { montarXlsx } from '../../supabase/functions/_shared/planilha-xlsx.js';
import { abasDoXlsx } from '../../supabase/functions/_shared/ler-xlsx.mjs';
import {
  montarAbasDaTriagem, triagem, telefoneLegivel, veioPor, nomeDoCurriculo, chegouEm,
} from './abas-da-triagem.mjs';

const ANA = {
  id: '11111111-aaaa-4aaa-8aaa-000000000001', criado_em: '2026-09-25T20:00:00+00:00',
  nome: 'Ana Souza', whatsapp: '5519999998888', cidade: 'Americana', experiencia: 'luxo',
  fim_de_semana: true, curriculo: 'consultor-tivoli/abc.pdf', origem: { utm_source: 'ig' }, na_planilha_em: null,
};
const BIA = {
  id: '22222222-bbbb-4bbb-8bbb-000000000002', criado_em: '2026-09-26T10:00:00+00:00',
  nome: 'Bia', whatsapp: '5519988887777', cidade: 'Santa Bárbara', experiencia: 'nao',
  fim_de_semana: false, curriculo: null, origem: {}, na_planilha_em: null,
};
const CAU = { ...BIA, id: '33333333-cccc-4ccc-8ccc-000000000003', nome: 'Cau', criado_em: '2026-09-27T10:00:00+00:00' };

// Monta, grava em xlsx e relê — como o arquivo volta do Zoho.
const doZoho = async (abas) => abasDoXlsx(await montarXlsx(abas));
const col = (aba, titulo) => aba.colunas.indexOf(titulo);
const entregue = (c) => ({ ...c, na_planilha_em: '2026-09-25T21:00:00+00:00' });

test('triagem: sem fim de semana vence a experiência', () => {
  assert.equal(triagem('luxo', false), '❌ Sem fim de semana');
  assert.equal(triagem('luxo', true), '⭐ Prioridade');
  assert.equal(triagem('varejo', true), '✅ Chamar');
  assert.equal(triagem('nao', true), '🟡 Sem experiência');
});

test('telefone, origem e data legíveis', () => {
  assert.equal(telefoneLegivel('5519999998888'), '(19) 99999-8888');
  assert.equal(veioPor({ utm_source: 'ig' }), 'Instagram');
  assert.equal(veioPor({ clique_meta: 'x' }), 'Anúncio');
  assert.equal(veioPor({}), 'Direto');
  assert.equal(chegouEm('2026-09-25T20:00:00+00:00'), '25/09/2026 17:00');   // UTC → São Paulo
  assert.equal(chegouEm('25/09/2026 17:00'), '25/09/2026 17:00');           // já legível
  assert.equal(chegouEm('46290.708333333336'), '25/09/2026 17:00');         // série do Excel
  assert.equal(chegouEm('ontem à tarde'), 'ontem à tarde');                 // texto do RH fica
});

test('⚠️ duas pessoas de mesmo nome no mesmo dia não dividem o arquivo do currículo', () => {
  assert.notEqual(nomeDoCurriculo(ANA), nomeDoCurriculo({ ...ANA, id: '99999999-0000' }));
  assert.equal(nomeDoCurriculo(ANA), '2026-09-25 - Ana Souza - 11111111.pdf');
  assert.equal(nomeDoCurriculo(BIA), '');
});

test('primeira volta: todo mundo, mais novo em cima', () => {
  const { abas, entregues, novas } = montarAbasDaTriagem([ANA, BIA], null);
  const [c] = abas;
  assert.deepEqual(c.linhas.map((l) => l[col({ colunas: c.colunas.map((x) => x.titulo) }, 'Nome')]), ['Bia', 'Ana Souza']);
  assert.equal(novas, 2);
  assert.deepEqual(entregues.sort(), [ANA.id, BIA.id].sort());
});

test('⚠️ O QUE O RH EDITA FICA: qualquer coluna, a ordem dele, e a nova entra no topo', async () => {
  const lido1 = await doZoho(montarAbasDaTriagem([ANA, BIA], null).abas);
  // O RH corrige o nome da Ana, muda o telefone, anota, e põe a Ana em cima.
  const c = lido1.find((a) => a.nome === 'Candidatos');
  const ana = c.linhas.find((l) => l[col(c, 'ID do cadastro')] === ANA.id);
  ana[col(c, 'Nome')] = 'Ana Souza Lima';
  ana[col(c, 'Telefone')] = '(19) 3333-0000';
  ana[col(c, 'Status (RH)')] = 'Entrevista 30/09';
  c.linhas.sort((a) => (a[col(c, 'ID do cadastro')] === ANA.id ? -1 : 1));
  const salvoPeloRh = await doZoho([
    { nome: 'Candidatos', colunas: c.colunas.map((titulo) => ({ titulo })), linhas: c.linhas },
    { nome: 'Minhas notas', colunas: [{ titulo: 'Anotação' }], linhas: [['ligar sexta']] },
  ]);

  // Volta do robô: Cau é nova. Ana e Bia já foram entregues.
  const { abas, novas } = montarAbasDaTriagem([entregue(ANA), entregue(BIA), CAU], salvoPeloRh);
  const [cand] = await doZoho(abas);
  const nomes = cand.linhas.map((l) => l[col(cand, 'Nome')]);
  assert.deepEqual(nomes, ['Cau', 'Ana Souza Lima', 'Bia'], 'nova em cima, e a ordem do RH mantida');
  assert.equal(novas, 1);
  const anaDepois = cand.linhas[1];
  assert.equal(anaDepois[col(cand, 'Telefone')], '(19) 3333-0000');
  assert.equal(anaDepois[col(cand, 'Status (RH)')], 'Entrevista 30/09');
  assert.equal(anaDepois[col(cand, 'Chegou em')], '25/09/2026 17:00', 'a data da linha antiga não some');
  assert.ok(abas.some((a) => a.nome === 'Minhas notas'), 'a aba que o RH criou vai junto');
});

test('⚠️ linha que o RH apagou NÃO volta — mas quem nunca foi entregue entra', async () => {
  const lido = await doZoho(montarAbasDaTriagem([ANA, BIA], null).abas);
  const c = lido.find((a) => a.nome === 'Candidatos');
  c.linhas = c.linhas.filter((l) => l[col(c, 'ID do cadastro')] !== BIA.id);   // RH apagou a Bia
  const semBia = await doZoho([{ nome: 'Candidatos', colunas: c.colunas.map((titulo) => ({ titulo })), linhas: c.linhas }]);
  const { abas } = montarAbasDaTriagem([entregue(ANA), entregue(BIA), CAU], semBia);
  const [cand] = await doZoho(abas);
  assert.deepEqual(cand.linhas.map((l) => l[col(cand, 'Nome')]), ['Cau', 'Ana Souza']);
});

test('⚠️ sem a coluna do ID ou sem a aba, o robô para em vez de adivinhar', async () => {
  const semId = await doZoho([{ nome: 'Candidatos', colunas: [{ titulo: 'Nome' }], linhas: [['Ana']] }]);
  assert.throws(() => montarAbasDaTriagem([ANA], semId), /ID do cadastro/);
  const renomeada = await doZoho([{ nome: 'Lista', colunas: [{ titulo: 'Nome' }], linhas: [['Ana']] }]);
  assert.throws(() => montarAbasDaTriagem([ANA], renomeada), /Candidatos/);
});

test('sem ninguém ainda: a planilha abre com as duas abas', async () => {
  const abas = await doZoho(montarAbasDaTriagem([], null).abas);
  assert.deepEqual(abas.map((a) => a.nome), ['Candidatos', 'Como usar']);
});
