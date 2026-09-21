import { test } from 'node:test';
import assert from 'node:assert/strict';
import { montarXlsx, letraDaColuna, nomeDeAba, bytesIguais } from './planilha-xlsx.js';
import { arquivosDoXlsx, abasDoXlsx } from './ler-xlsx.mjs';

// ⚠️ ESTE TESTE ABRE O ARQUIVO DE VOLTA. "Gerou sem erro" não prova planilha:
// arquivo com as colunas trocadas gera sem erro, e data em UTC gera sem erro.
// Aqui cada célula é lida como o Excel a mostraria.

const UMA_ABA = [{
  nome: 'Lista de espera',
  colunas: [
    { titulo: 'Nome' },
    { titulo: 'Entrou em', tipo: 'instante' },
    { titulo: 'Dia da visita', tipo: 'dia' },
    { titulo: 'Valor', tipo: 'dinheiro' },
  ],
  linhas: [
    ['Marisa Carvalho', '2026-09-21T02:11:23.050085+00:00', '2026-10-05', 1615],
  ],
}];

test('a hora vai na hora do Brasil, e o dia acompanha', async () => {
  const [aba] = abasDoXlsx(await montarXlsx(UMA_ABA));
  // No banco é 21/09 02:11 em UTC. Na planilha tem de aparecer 20/09 23:11.
  assert.equal(aba.linhas[0][1], '20/09/2026 23:11');
});

test('coluna de DATA PURA não é convertida — senão a visita perde um dia', async () => {
  const [aba] = abasDoXlsx(await montarXlsx(UMA_ABA));
  assert.equal(aba.linhas[0][2], '05/10/2026');
});

test('data pura e instante no MESMO dia não saem no mesmo dia por acaso', async () => {
  // A armadilha: se alguém marcar a coluna `date` como `instante`, a meia-noite
  // é lida como UTC e volta o dia anterior. Este teste morre se isso acontecer.
  const bytes = await montarXlsx([{
    nome: 'x',
    colunas: [{ titulo: 'dia', tipo: 'dia' }, { titulo: 'errado', tipo: 'instante' }],
    linhas: [['2026-10-05', '2026-10-05']],
  }]);
  const [aba] = abasDoXlsx(bytes);
  assert.equal(aba.linhas[0][0], '05/10/2026');
  assert.equal(aba.linhas[0][1], '04/10/2026 21:00');   // é isto que NÃO se quer
});

test('"Entrou em" só com o dia ainda usa o dia do BRASIL', async () => {
  // Antes esta coluna era `slice(0, 10)` do instante em UTC: quem entrou depois
  // das 21h caía no dia seguinte. Eram 24 dos 150 cadastros.
  const [aba] = abasDoXlsx(await montarXlsx([{
    nome: 'x',
    colunas: [{ titulo: 'Entrou em', tipo: 'dia-de-instante' }],
    linhas: [['2026-09-21T02:11:23.050085+00:00']],
  }]));
  assert.equal(aba.linhas[0][0], '20/09/2026');
});

test('o cabeçalho sai com os títulos, na ordem declarada', async () => {
  const [aba] = abasDoXlsx(await montarXlsx(UMA_ABA));
  assert.deepEqual(aba.colunas, ['Nome', 'Entrou em', 'Dia da visita', 'Valor']);
});

test('dinheiro sai como NÚMERO, para o dono conseguir somar a coluna', async () => {
  const [aba] = abasDoXlsx(await montarXlsx(UMA_ABA));
  assert.equal(aba.linhas[0][3], '1615');
  // e o formato é o de reais
  const estilos = arquivosDoXlsx(await montarXlsx(UMA_ABA)).get('xl/styles.xml');
  assert.match(estilos, /R\$/);
});

test('bytes iguais para conteúdo igual — senão o robô sobe versão nova toda hora', async () => {
  const a = await montarXlsx(UMA_ABA);
  const b = await montarXlsx(UMA_ABA);
  assert.ok(bytesIguais(a, b), 'duas montagens do mesmo conteúdo deram bytes diferentes');
});

test('bytes DIFERENTES quando o conteúdo muda — senão apagar do banco não limpa a planilha', async () => {
  const outra = [{ ...UMA_ABA[0], linhas: [] }];
  assert.ok(!bytesIguais(await montarXlsx(UMA_ABA), await montarXlsx(outra)));
});

test('nome com vírgula, aspas, & e acento sobrevive', async () => {
  const [aba] = abasDoXlsx(await montarXlsx([{
    nome: 'x',
    colunas: [{ titulo: 'Nome' }],
    linhas: [['Ana & "Bia", Ltda — açaí <ok>']],
  }]));
  assert.equal(aba.linhas[0][0], 'Ana & "Bia", Ltda — açaí <ok>');
});

test('célula vazia fica vazia, e não "Invalid Date" nem "null"', async () => {
  const [aba] = abasDoXlsx(await montarXlsx([{
    nome: 'x',
    colunas: [{ titulo: 'a' }, { titulo: 'b', tipo: 'instante' },
              { titulo: 'c', tipo: 'dia' }, { titulo: 'd', tipo: 'dinheiro' }],
    linhas: [[null, null, '', undefined]],
  }]));
  assert.deepEqual(aba.linhas[0] ?? [], []);
});

test('aba sem linha nenhuma continua abrindo, com o cabeçalho', async () => {
  // Cinco das onze abas estão vazias hoje (pessoas, atendimentos, origens,
  // stylists, private edits: zero linhas no banco em 21/09/2026).
  const [aba] = abasDoXlsx(await montarXlsx([{
    nome: 'Pessoas', colunas: [{ titulo: 'Nome' }, { titulo: 'WhatsApp' }], linhas: [],
  }]));
  assert.deepEqual(aba.colunas, ['Nome', 'WhatsApp']);
  assert.equal(aba.linhas.length, 0);
});

test('as onze abas entram, cada uma com o seu nome', async () => {
  const nomes = ['Lista de espera', 'Garantias', 'Vendas', 'Atribuição', 'Origens',
    'Pessoas', 'Atendimentos', 'Convites abertos', 'Stylists', 'Private Edits',
    'Beauty Sessions'];
  const abas = abasDoXlsx(await montarXlsx(nomes.map((n) => ({
    nome: n, colunas: [{ titulo: 'a' }], linhas: [['1']],
  }))));
  assert.deepEqual(abas.map((a) => a.nome), nomes);
});

test('o arquivo tem as peças que o Excel exige', async () => {
  const dentro = arquivosDoXlsx(await montarXlsx(UMA_ABA));
  for (const p of ['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml',
    'xl/_rels/workbook.xml.rels', 'xl/styles.xml', 'xl/worksheets/sheet1.xml']) {
    assert.ok(dentro.has(p), `falta ${p}`);
  }
});

test('o cabeçalho fica congelado e o filtro ligado', async () => {
  const folha = arquivosDoXlsx(await montarXlsx(UMA_ABA)).get('xl/worksheets/sheet1.xml');
  assert.match(folha, /state="frozen"/);
  assert.match(folha, /<autoFilter ref="A1:D2"\/>/);
});

test('nome de aba obedece à regra do Excel — 31 letras e sem : \\ / ? * [ ]', async () => {
  assert.equal(nomeDeAba('Base/de:clientes*[2026]'), 'Base-de-clientes--2026-');
  assert.equal(nomeDeAba('a'.repeat(40)).length, 31);
  const usados = new Set();
  assert.equal(nomeDeAba('Vendas', usados), 'Vendas');
  assert.equal(nomeDeAba('Vendas', usados), 'Vendas 2');
});

test('a letra da coluna vai além de Z', async () => {
  assert.equal(letraDaColuna(1), 'A');
  assert.equal(letraDaColuna(14), 'N');
  assert.equal(letraDaColuna(26), 'Z');
  assert.equal(letraDaColuna(27), 'AA');
});

test('planilha sem aba nenhuma é recusada na hora', async () => {
  await assert.rejects(() => montarXlsx([]), /sem aba/);
});

test('sem compressor o arquivo AINDA abre — é o caminho que roda no Deno sem node:zlib', async () => {
  // O gerador tenta `node:zlib` e, se não houver, grava o zip "guardado". Sem
  // este teste, esse caminho nunca seria exercitado: no node o módulo sempre
  // existe, então o defeito só apareceria em produção, na edge.
  const guardado = await montarXlsx(UMA_ABA, { comprimir: false });
  const [aba] = abasDoXlsx(guardado);
  assert.equal(aba.linhas[0][1], '20/09/2026 23:11');
  assert.deepEqual(aba.colunas, ['Nome', 'Entrou em', 'Dia da visita', 'Valor']);

  // E ele é maior que o comprimido — é o preço de não depender do módulo.
  const comprimido = await montarXlsx(UMA_ABA);
  assert.ok(guardado.length > comprimido.length,
    `guardado ${guardado.length} não é maior que comprimido ${comprimido.length}`);
});

test('as duas saídas do zip são determinísticas, cada uma na sua', async () => {
  assert.ok(bytesIguais(await montarXlsx(UMA_ABA, { comprimir: false }),
    await montarXlsx(UMA_ABA, { comprimir: false })));
});
