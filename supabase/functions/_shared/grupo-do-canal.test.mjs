import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizarGrupo, mesmoGrupo, gruposExistentes,
  agruparCanais, timePorCanal, contarSemGrupo,
} from './grupo-do-canal.js';

// Canais reais, medidos no banco em 20/08/2026.
const CANAIS = [
  { loja_id: 205451611, nome: 'Atacado Nuvem Shop', grupo: 'Atacado' },
  { loja_id: 205657609, nome: 'Loja Dom Pedro', grupo: 'Varejo' },
  { loja_id: 205834140, nome: "Loja Santa Bárbara d'Oeste", grupo: 'Varejo' },
  { loja_id: 205395333, nome: 'Atacado Fábrica', grupo: null },
  { loja_id: 205513124, nome: 'Varejo Fábrica', grupo: '' },
];

test('normalizar: tira espaço das pontas, junta espaço repetido, vazio vira nulo', () => {
  assert.equal(normalizarGrupo('  Atacado  '), 'Atacado');
  assert.equal(normalizarGrupo('Loja  de   Fábrica'), 'Loja de Fábrica');
  assert.equal(normalizarGrupo(''), null);
  assert.equal(normalizarGrupo('   '), null);
  assert.equal(normalizarGrupo(null), null);
  assert.equal(normalizarGrupo(undefined), null);
});

test('mesmoGrupo ignora maiúscula e espaço — senão nascem dois grupos que parecem um', () => {
  assert.ok(mesmoGrupo('Atacado', 'atacado'));
  assert.ok(mesmoGrupo(' Varejo ', 'VAREJO'));
  assert.ok(mesmoGrupo(null, ''));
  assert.ok(!mesmoGrupo('Atacado', 'Varejo'));
  assert.ok(!mesmoGrupo('Atacado', null));
});

test('gruposExistentes: sem repetir, em ordem, guardando a grafia da primeira vez', () => {
  const canais = [
    { loja_id: 1, nome: 'a', grupo: 'Varejo' },
    { loja_id: 2, nome: 'b', grupo: 'atacado' },
    { loja_id: 3, nome: 'c', grupo: 'VAREJO' },
    { loja_id: 4, nome: 'd', grupo: null },
  ];
  assert.deepEqual(gruposExistentes(canais), ['atacado', 'Varejo']);
});

test('gruposExistentes com lista vazia devolve lista vazia, não quebra', () => {
  assert.deepEqual(gruposExistentes([]), []);
  assert.deepEqual(gruposExistentes(null), []);
});

test('agruparCanais: um balde por grupo, e o SEM GRUPO por último', () => {
  const r = agruparCanais(CANAIS);
  assert.deepEqual(r.map((b) => b.grupo), ['Atacado', 'Varejo', null]);
  assert.deepEqual(r[0].canais.map((c) => c.nome), ['Atacado Nuvem Shop']);
  assert.equal(r[1].canais.length, 2);
  // Canal sem grupo NÃO some: sumir do seletor é o defeito que a Peça 2 evita.
  assert.deepEqual(r[2].canais.map((c) => c.nome), ['Atacado Fábrica', 'Varejo Fábrica']);
});

test('agruparCanais: sem nenhum canal agrupado, existe só o balde sem grupo', () => {
  const r = agruparCanais([{ loja_id: 1, nome: 'x', grupo: null }]);
  assert.equal(r.length, 1);
  assert.equal(r[0].grupo, null);
});

test('agruparCanais: todos agrupados, o balde sem grupo NÃO aparece vazio', () => {
  const r = agruparCanais([{ loja_id: 1, nome: 'x', grupo: 'Atacado' }]);
  assert.deepEqual(r.map((b) => b.grupo), ['Atacado']);
});

test('agruparCanais mantém a ordem dos canais dentro do balde', () => {
  const r = agruparCanais([
    { loja_id: 2, nome: 'B', grupo: 'Atacado' },
    { loja_id: 1, nome: 'A', grupo: 'Atacado' },
  ]);
  assert.deepEqual(r[0].canais.map((c) => c.nome), ['B', 'A']);
});

test('agruparCanais junta grafias diferentes do mesmo grupo num balde só', () => {
  const r = agruparCanais([
    { loja_id: 1, nome: 'A', grupo: 'Atacado' },
    { loja_id: 2, nome: 'B', grupo: 'atacado' },
  ]);
  assert.equal(r.length, 1);
  assert.equal(r[0].canais.length, 2);
});

test('timePorCanal casa o time pelo canal, e canal sem time não aparece', () => {
  const times = [
    { id: 't1', nome: 'Dom Pedro', canal_loja_id: 205657609 },
    { id: 't2', nome: 'Iguatemi Campinas', canal_loja_id: null },
  ];
  const mapa = timePorCanal(times);
  assert.equal(mapa.get('205657609').nome, 'Dom Pedro');
  assert.equal(mapa.get('205451611'), undefined);
  assert.equal(mapa.size, 1, 'time sem canal não entra no mapa');
});

test('timePorCanal acha o time mesmo quando o id vem como texto', () => {
  // O id vem number do banco e string do formulário — casar por texto evita o
  // de-para silencioso que faz a linha dizer "sem time" com o time ali.
  const mapa = timePorCanal([{ id: 't1', nome: 'Dom Pedro', canal_loja_id: '205657609' }]);
  assert.equal(mapa.get(String(205657609)).nome, 'Dom Pedro');
});

test('contarSemGrupo conta o que falta configurar', () => {
  assert.equal(contarSemGrupo(CANAIS), 2);
  assert.equal(contarSemGrupo([]), 0);
  assert.equal(contarSemGrupo(null), 0);
});

// ── MARCAR / DESMARCAR TODOS DE UM GRUPO (Peça 2) ────────────────────────────
import { estadoDoGrupo, alternarGrupo } from './grupo-do-canal.js';

const ATACADO = [{ loja_id: 1, nome: 'A' }, { loja_id: 2, nome: 'B' }];

test('estadoDoGrupo diz se o grupo está todo, em parte, ou nada marcado', () => {
  assert.equal(estadoDoGrupo(ATACADO, new Set([1, 2])), 'todos');
  assert.equal(estadoDoGrupo(ATACADO, new Set([1])), 'alguns');
  assert.equal(estadoDoGrupo(ATACADO, new Set()), 'nenhum');
  assert.equal(estadoDoGrupo(ATACADO, new Set([9])), 'nenhum');
});

test('estadoDoGrupo casa id como TEXTO — number no banco, string no formulário', () => {
  assert.equal(estadoDoGrupo(ATACADO, new Set(['1', '2'])), 'todos');
  assert.equal(estadoDoGrupo([{ loja_id: '1' }], new Set([1])), 'todos');
});

test('estadoDoGrupo com grupo vazio é "nenhum", não quebra e não vira "todos"', () => {
  // "Todos de nada" seria verdade vazia, e o botão diria "desmarcar" sem ter o quê.
  assert.equal(estadoDoGrupo([], new Set([1])), 'nenhum');
  assert.equal(estadoDoGrupo(null, new Set()), 'nenhum');
});

test('alternarGrupo marca o grupo inteiro quando falta alguém', () => {
  assert.deepEqual([...alternarGrupo(ATACADO, new Set())].sort(), [1, 2]);
  assert.deepEqual([...alternarGrupo(ATACADO, new Set([1]))].sort(), [1, 2]);
});

test('alternarGrupo desmarca o grupo inteiro quando já está todo marcado', () => {
  assert.deepEqual([...alternarGrupo(ATACADO, new Set([1, 2]))], []);
});

test('alternarGrupo não mexe em canal de OUTRO grupo', () => {
  const sel = new Set([1, 2, 99]);
  assert.deepEqual([...alternarGrupo(ATACADO, sel)], [99]);
});

test('alternarGrupo devolve um Set NOVO — não mexe no que recebeu', () => {
  const sel = new Set([1]);
  const novo = alternarGrupo(ATACADO, sel);
  assert.deepEqual([...sel], [1], 'o original ficou intacto');
  assert.notEqual(novo, sel);
});

// ── OS TIMES SOB CABEÇALHO DE GRUPO (Peça 4) ─────────────────────────────────
import { agruparTimesPorGrupo } from './grupo-do-canal.js';

// ⚠️ MUDOU EM 27/08/2026: o balde agora é chaveado pelo APONTAMENTO
// (`bling_lojas.grupo_id` -> `canais_grupos`), não pelo texto, e `balde.grupo`
// devolve a LINHA do grupo, não o nome. O card pai precisa do id para pendurar
// as supervisoras e os botões dele. O texto continua existindo e de acordo — quem
// mantém os dois iguais é o gatilho do banco, nos dois sentidos.
const G_ATACADO = { id: 'g-atacado', nome: 'Atacado' };
const G_VAREJO = { id: 'g-varejo', nome: 'Varejo' };
const GRUPOS_P4 = [G_VAREJO, G_ATACADO];
const CANAIS_P4 = [
  { loja_id: 205451611, nome: 'Atacado Nuvem Shop', grupo: 'Atacado', grupo_id: 'g-atacado' },
  { loja_id: 205657609, nome: 'Loja Dom Pedro', grupo: 'Varejo', grupo_id: 'g-varejo' },
  { loja_id: 205834140, nome: "Loja Santa Bárbara d'Oeste", grupo: 'Varejo', grupo_id: 'g-varejo' },
  { loja_id: 205395333, nome: 'Atacado Fábrica', grupo: null, grupo_id: null },
];
const TIMES_P4 = [
  { id: 'a', nome: 'Atacado Nuvem Shop', canal_loja_id: 205451611 },
  { id: 'b', nome: 'Dom Pedro', canal_loja_id: 205657609 },
  { id: 'c', nome: 'Tivoli', canal_loja_id: 205834140 },
  { id: 'd', nome: 'Iguatemi Campinas', canal_loja_id: null },
];

test('agruparTimesPorGrupo: o time herda o grupo do canal dele', () => {
  const r = agruparTimesPorGrupo(TIMES_P4, CANAIS_P4, GRUPOS_P4);
  assert.deepEqual(r.map((b) => (b.grupo ? b.grupo.nome : null)), ['Atacado', 'Varejo', null]);
  assert.deepEqual(r[0].times.map((t) => t.nome), ['Atacado Nuvem Shop']);
  assert.deepEqual(r[1].times.map((t) => t.nome), ['Dom Pedro', 'Tivoli']);
});

test('o balde devolve a LINHA do grupo, com id — é dela que o card pai vive', () => {
  const r = agruparTimesPorGrupo(TIMES_P4, CANAIS_P4, GRUPOS_P4);
  assert.equal(r[0].grupo.id, 'g-atacado');
  assert.equal(r[1].grupo.id, 'g-varejo');
});

test('time SEM canal não some — cai no balde sem grupo', () => {
  // Iguatemi ainda vai abrir e não tem canal do Bling. Sumir da gestão de
  // usuários seria perder o time inteiro de vista.
  const r = agruparTimesPorGrupo(TIMES_P4, CANAIS_P4, GRUPOS_P4);
  assert.deepEqual(r[2].times.map((t) => t.nome), ['Iguatemi Campinas']);
});

test('time cujo canal existe mas está SEM grupo também cai no balde sem grupo', () => {
  const times = [{ id: 'x', nome: 'Fábrica', canal_loja_id: 205395333 }];
  const r = agruparTimesPorGrupo(times, CANAIS_P4, GRUPOS_P4);
  assert.equal(r.length, 1);
  assert.equal(r[0].grupo, null);
  assert.deepEqual(r[0].times.map((t) => t.nome), ['Fábrica']);
});

test('canal apontando para grupo que não existe mais cai como sem grupo, e o time NÃO some', () => {
  const canais = [{ loja_id: 1, nome: 'Órfão', grupo: 'Sumiu', grupo_id: 'g-que-sumiu' }];
  const times = [{ id: 'z', nome: 'Time do órfão', canal_loja_id: 1 }];
  const r = agruparTimesPorGrupo(times, canais, GRUPOS_P4);
  assert.equal(r.length, 1);
  assert.equal(r[0].grupo, null);
  assert.deepEqual(r[0].times.map((t) => t.nome), ['Time do órfão']);
});

test('grupo cadastrado SEM time nenhum não vira cartão vazio', () => {
  // A lista de CANAIS mostra todos os grupos, inclusive os vazios. Esta é a
  // lista de TIMES: grupo sem time aqui seria um cartão em branco.
  const times = [{ id: 'b', nome: 'Dom Pedro', canal_loja_id: 205657609 }];
  const r = agruparTimesPorGrupo(times, CANAIS_P4, GRUPOS_P4);
  assert.deepEqual(r.map((b) => b.grupo.nome), ['Varejo']);
});

test('a ordem dos times DENTRO do balde é a que chegou', () => {
  // A tela já ordena com ordenarTimes antes de passar; reordenar aqui
  // desfaria a ordem que o dono definiu.
  const times = [
    { id: 'c', nome: 'Tivoli', canal_loja_id: 205834140 },
    { id: 'b', nome: 'Dom Pedro', canal_loja_id: 205657609 },
  ];
  const r = agruparTimesPorGrupo(times, CANAIS_P4, GRUPOS_P4);
  assert.deepEqual(r[0].times.map((t) => t.nome), ['Tivoli', 'Dom Pedro']);
});

test('nenhum canal com grupo: um balde só, e a tela fica como sempre foi', () => {
  const semGrupo = CANAIS_P4.map((c) => ({ ...c, grupo: null, grupo_id: null }));
  const r = agruparTimesPorGrupo(TIMES_P4, semGrupo, GRUPOS_P4);
  assert.equal(r.length, 1);
  assert.equal(r[0].grupo, null);
  assert.equal(r[0].times.length, 4);
});

test('sem time nenhum, devolve lista vazia — não um balde vazio', () => {
  assert.deepEqual(agruparTimesPorGrupo([], CANAIS_P4, GRUPOS_P4), []);
  assert.deepEqual(agruparTimesPorGrupo(null, null, null), []);
});

test('grupo que só existe em canal SEM time não vira cabeçalho vazio', () => {
  const canais = [...CANAIS_P4, { loja_id: 999, nome: 'Marketplace X', grupo: 'Marketplace' }];
  const r = agruparTimesPorGrupo(TIMES_P4, canais);
  assert.ok(!r.some((b) => b.grupo === 'Marketplace'), 'cabeçalho sem time embaixo não ajuda ninguém');
});
