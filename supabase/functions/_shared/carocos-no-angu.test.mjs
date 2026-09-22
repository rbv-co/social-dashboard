import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CONFERENCIAS, ABAS, montarAbasDoLog, TETO_POR_CONFERENCIA, GRAVE, OLHAR, SABER,
} from './carocos-no-angu.js';
import { montarXlsx } from './planilha-xlsx.js';
import { abasDoXlsx } from './ler-xlsx.mjs';

const vazio = () => Object.fromEntries(CONFERENCIAS.map((c) => [c.chave, []]));

/** Monta o log e devolve a aba pedida, já lida de volta do arquivo. */
async function aba(nome, resultados) {
  const todas = abasDoXlsx(await montarXlsx(
    montarAbasDoLog({ ...vazio(), ...resultados }, '21/09/2026 22:10')));
  const achada = todas.find((a) => a.nome === nome);
  assert.ok(achada, `não existe aba "${nome}"`);
  return achada;
}

const linhasDo = async (resultados) =>
  (await aba('Resumo', resultados)).linhas.map((l) => l[0] ?? '');

test('toda conferência está bem formada', () => {
  // ⚠️ Conferência com campo faltando só apareceria quando o robô rodasse, de
  // madrugada, e o log sairia torto sem ninguém ver.
  const chaves = new Set();
  for (const c of CONFERENCIAS) {
    assert.ok(c.chave, `conferência sem chave: ${JSON.stringify(c).slice(0, 80)}`);
    assert.ok(!chaves.has(c.chave), `chave repetida: ${c.chave}`);
    chaves.add(c.chave);
    assert.ok(c.titulo, `${c.chave}: sem título`);
    assert.ok(ABAS.includes(c.aba), `${c.chave}: aba "${c.aba}" não existe`);
    assert.ok([GRAVE, OLHAR, SABER].includes(c.gravidade), `${c.chave}: gravidade estranha`);
    assert.ok(c.oQueFazer && c.oQueFazer.length > 20, `${c.chave}: sem o que fazer`);
  }
});

test('⚠️ nenhuma conferência guarda consulta aqui — o SQL mora no banco', () => {
  // Em 22/09/2026 as consultas foram para `public.vessel_carocos()`, porque a
  // edge (Deno) não abre conexão de Postgres. Deixar uma sobrando aqui faria
  // alguém editar a errada e não entender por que o log não mudou.
  for (const c of CONFERENCIAS) {
    assert.equal(c.sql, undefined, `${c.chave} ainda tem SQL no JavaScript`);
  }
});

test('⚠️ o Resumo lista TODAS as conferências, inclusive as que deram zero', async () => {
  // Log que só mostra problema não deixa saber se a conferência rodou: zero
  // linhas parece "está tudo bem" e parece "o robô quebrou".
  const texto = (await linhasDo({})).join('\n');
  for (const c of CONFERENCIAS) {
    assert.ok(texto.includes(c.titulo), `o Resumo não fala de "${c.titulo}"`);
  }
  assert.match(texto, /O QUE ESTÁ LIMPO/);
  assert.match(texto, new RegExp(`As ${CONFERENCIAS.length} conferências passaram limpas`, 'i'));
});

test('o que achou algo vem ANTES do que está limpo, e o grave na frente', async () => {
  const linhas = await linhasDo({
    'venda-sem-vendedor': [{ quem: 'a', quando: '2026-09-20', detalhe: 'x', valor: 1 }],
    'venda-duplicada': [{ quem: 'b', quando: '2026-09-21', detalhe: 'y', valor: 2 }],
  });
  const ondeEsta = (t) => linhas.findIndex((l) => l.includes(t));
  assert.ok(ondeEsta('O QUE PRECISA DE OLHO') < ondeEsta('Venda que parece emitida duas vezes'));
  // duplicada é GRAVE, sem vendedor é OLHAR
  assert.ok(ondeEsta('Venda que parece emitida duas vezes') < ondeEsta('Venda sem vendedor'));
  assert.ok(ondeEsta('Venda sem vendedor') < ondeEsta('O QUE ESTÁ LIMPO'));
});

test('cada linha de detalhe carrega o que fazer, e não só o problema', async () => {
  const a = await aba('Vendas', {
    'venda-duplicada': [{ quem: 'Luiza Maria Carvalho', quando: '2026-09-21',
      detalhe: '3 pedidos iguais: 2680, 2681, 2682', valor: 3450 }],
  });
  const c = (t) => a.linhas[0][a.colunas.indexOf(t)];
  assert.equal(c('O que parece errado'), 'Venda que parece emitida duas vezes');
  assert.equal(c('Gravidade'), GRAVE);
  assert.equal(c('Quem ou qual'), 'Luiza Maria Carvalho');
  assert.equal(c('Valor envolvido'), '3450');
  assert.match(c('O que fazer'), /Bling/);
});

test('⚠️ conferência que acha demais é cortada, e a aba AVISA quantas ficaram', async () => {
  // Despejar 244 linhas numa aba que ninguém lê até o fim é o mesmo que
  // esconder. O total continua no Resumo.
  const muitas = Array.from({ length: TETO_POR_CONFERENCIA + 44 }, (_, i) =>
    ({ quem: `cliente ${i}`, quando: '2026-08-01', detalhe: `pedido ${i}`, valor: 10 }));
  const a = await aba('Vendas', { 'venda-nunca-conferida': muitas });
  assert.equal(a.linhas.length, TETO_POR_CONFERENCIA + 1, 'faltou a linha do aviso');
  const ultima = a.linhas[a.linhas.length - 1];
  assert.match(ultima[a.colunas.indexOf('Quem ou qual')], /e mais 44/);

  const resumo = (await linhasDo({ 'venda-nunca-conferida': muitas })).join('\n');
  assert.ok(resumo.includes(`${TETO_POR_CONFERENCIA + 44}  ·`), 'o Resumo perdeu o total');
});

test('as abas de detalhe existem todas, mesmo vazias', async () => {
  const todas = abasDoXlsx(await montarXlsx(montarAbasDoLog(vazio(), 'x')));
  assert.deepEqual(todas.map((a) => a.nome), ['Resumo', ...ABAS]);
});

test('o Resumo é aba de documento: sem filtro, sem listra', () => {
  const [resumo] = montarAbasDoLog(vazio(), 'x');
  assert.equal(resumo.nome, 'Resumo');
  assert.equal(resumo.filtro, false);
  assert.equal(resumo.zebra, false);
});

test('⚠️ o log avisa que "parece" não é "é"', async () => {
  // A palavra do dono foi "o que PARECE ser erro". Um log que soa como acusação
  // faz a pessoa corrigir dado bom.
  const texto = (await linhasDo({})).join('\n');
  assert.match(texto, /Nada aqui é acusação/);
  assert.match(texto, /PARECE errado/);
});

test('o robô parado avisa para conferir o teto antes de correr', () => {
  // Foi o caso real de 21/09: `meta-hora-retentativa-00h` roda 1x por dia e o
  // teto é de 4 horas — ele vai parecer parado todo dia depois das 4 da manhã.
  const c = CONFERENCIAS.find((x) => x.chave === 'robo-parado');
  assert.match(c.oQueFazer, /alarme falso/);
});
