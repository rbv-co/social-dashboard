import test from 'node:test';
import assert from 'node:assert/strict';
import { skuDaPasta, pastaDoSku, ehDesenhoAMao, fotosDaPasta, corBate, palavrasDaCor, pastaServeParaACor } from './fotos-do-zoho.mjs';

/* A SEGUNDA FONTE DE FOTOS (07/09/2026).
 *
 * O Bling e o padrao. O Zoho so entra quando o produto NAO TEM foto no cadastro
 * do Bling — 18 lotes estavam assim. Regra do dono. */

test('skuDaPasta: tira o SKU do nome, em qualquer posicao', () => {
  assert.equal(skuDaPasta('Ravelle_Pequena_Jeans - SS0001SB.S1'), 'SS0001SB.S1');
  assert.equal(skuDaPasta('SS0002HB.B2 - Cerne'), 'SS0002HB.B2');
  assert.equal(skuDaPasta('ss0001hb.m1 minusculo'), 'SS0001HB.M1');
});

test('skuDaPasta: pasta sem SKU devolve nulo', () => {
  assert.equal(skuDaPasta('Hand_Pequena_Vermelha'), null);
  assert.equal(skuDaPasta(''), null);
  assert.equal(skuDaPasta(null), null);
});

test('⚠️ pastaDoSku NAO adivinha pelo nome parecido', () => {
  /* Adivinhar poria a foto de OUTRA bolsa num certificado de autenticidade — o
   * erro que destroi exatamente a coisa que o selo existe para provar. */
  const pastas = [
    { nome: 'Linear_Caramelo - SS0001HB.M1' },
    { nome: 'Linear_Chocolate' },           // mesmo modelo, SEM sku
    { nome: 'Hand_Pequena_Vermelha' },
  ];
  assert.equal(pastaDoSku(pastas, 'SS0001HB.M1').nome, 'Linear_Caramelo - SS0001HB.M1');
  // "Linear_Chocolate" e o par obvio de SS0001HB.M4 — e mesmo assim: nulo.
  assert.equal(pastaDoSku(pastas, 'SS0001HB.M4'), null);
  assert.equal(pastaDoSku(pastas, 'SS0010HB.S1'), null);
});

test('⚠️ DUAS pastas com o mesmo SKU devolvem nulo — ambiguidade vira foto errada', () => {
  const pastas = [{ nome: 'A - SS0001HB.M1' }, { nome: 'B - SS0001HB.M1' }];
  assert.equal(pastaDoSku(pastas, 'SS0001HB.M1'), null);
});

test('pastaDoSku: SKU malformado nao casa com nada', () => {
  const pastas = [{ nome: 'Linear - SS0001HB.M1' }];
  for (const ruim of ['', null, 'SS0001HB', 'qualquer coisa']) {
    assert.equal(pastaDoSku(pastas, ruim), null, `casou com "${ruim}"`);
  }
});

test('⚠️ o DESENHO A MAO da Raissa fica de fora — pedido explicito do dono', () => {
  /* Medido em cinco pastas: as fotos sao `Modelo_Cor_Angulo.png` e o desenho e
   * sempre o arquivo SOLTO, em maiusculas, sem sublinhado. */
  for (const desenho of ['LINEAR.jpeg', 'CERNE.jpeg', 'SOLENNE.jpeg', 'RAVELLE.jpg']) {
    assert.equal(ehDesenhoAMao(desenho), true, `deixou passar o desenho: ${desenho}`);
  }
});

test('a regra do desenho e por SUBLINHADO, e nao por extensao', () => {
  // `.jpeg` tambem aparece em foto de verdade em outras pastas; trocar a
  // extensao do desenho o traria de volta se a regra fosse essa.
  assert.equal(ehDesenhoAMao('Linear_Caramelo_Frente.jpeg'), false);
  assert.equal(ehDesenhoAMao('LINEAR.png'), true);
});

test('desenho nomeado com sublinhado tambem e barrado, pelo cinto e suspensorio', () => {
  assert.equal(ehDesenhoAMao('Linear_Desenho_Assinado.png'), true);
  assert.equal(ehDesenhoAMao('Croqui_Raissa.png'), true);
});

test('fotosDaPasta: so imagens, sem o desenho, e a FRENTE primeiro', () => {
  const arquivos = [
    { nome: 'LINEAR.jpeg' },
    { nome: 'LINEAR_Caramelo_Costas.png' },
    { nome: 'LINEAR_Caramelo_Frente.png' },
    { nome: 'LINEAR_Caramelo_Lateralizada.png' },
    { nome: 'leiame.txt' },
    { nome: 'subpasta', ehPasta: true },
  ];
  assert.deepEqual(fotosDaPasta(arquivos).map((a) => a.nome), [
    'LINEAR_Caramelo_Frente.png',
    'LINEAR_Caramelo_Lateralizada.png',
    'LINEAR_Caramelo_Costas.png',
  ]);
});

test('⚠️ a ordem e ESTAVEL — a foto 1 nao troca sozinha entre duas rodadas', () => {
  /* A foto 1 e a capa do certificado. Se a ordem dependesse da ordem que o Zoho
   * devolveu, a capa mudaria de uma rodada para outra sem ninguem mexer. */
  const a = [{ nome: 'X_Cor_Detalhe2.png' }, { nome: 'X_Cor_Detalhe1.png' }];
  assert.deepEqual(fotosDaPasta(a).map((f) => f.nome), fotosDaPasta(a.slice().reverse()).map((f) => f.nome));
});

test('pasta vazia ou so com desenho nao devolve foto nenhuma', () => {
  assert.deepEqual(fotosDaPasta([]), []);
  assert.deepEqual(fotosDaPasta([{ nome: 'LINEAR.jpeg' }]), []);
  assert.deepEqual(fotosDaPasta(null), []);
});

/* ⚠️ A TRAVA DE COR — TODOS OS NOMES ABAIXO SAO REAIS, lidos da API do Zoho em
 * 08/09/2026. Inventar nome aqui seria testar a minha imaginacao: a forma de
 * verdade e que o nome do arquivo costuma trazer APELIDO DE ATELIÊ, e nao a cor
 * do catalogo. */

test('⚠️ a LUNEA PINHAO reprova — foi ela que originou esta trava', () => {
  // Pasta com o SKU EXATO e a cor certa no nome... e arquivos `Lunea_Marrom_*`
  // dentro. So o nome da pasta nao pega isto.
  const fotos = ['Lunea_Marrom_Frente.png', 'Lunea_Marrom_Lateralizado.png',
    'Lunea_Marrom_Costas.png'];
  assert.equal(pastaServeParaACor('Lunea_Pinhão - SS0008HB.M4', fotos, 'Pinhão'), false);
  assert.equal(corBate('Lunea_Pinhão - SS0008HB.M4', 'Pinhão'), true,
    'a pasta sozinha passa — e por isso a conferencia nao pode parar nela');
});

test('pasta e arquivos com a cor certa passam', () => {
  const fotos = ['Cerne_Jeans_Frente.png', 'Cerne_Jeans_Alca.png'];
  assert.equal(pastaServeParaACor('Cerne_Jeans - SS0002HB.B1', fotos, 'Jeans'), true);
});

test('cor de duas palavras: os conectores nao contam', () => {
  // `Preto c/ Bordô` vira PRETO + BORDO, e o arquivo e `Lunea_PretoBordo_*`.
  // Sem tirar o "c" nenhuma bolsa com duas cores passaria.
  const fotos = ['Lunea_PretoBordo_Frente.png', 'Lunea_PretoBordo_Alca.png'];
  assert.equal(pastaServeParaACor('Lunea_PretoBordo - SS0008HB.M1', fotos,
    'Preto c/ Bordô'), true);
  assert.deepEqual(palavrasDaCor('Preto c/ Bordô'), ['PRETO', 'BORDO']);
});

test('acento e caixa nao atrapalham', () => {
  assert.equal(corBate('Ravelle_Big_Cafe_Frente.png', 'Café'), true);
  assert.equal(corBate('Elara_Grande_Café_Frente.png', 'Café'), true);
});

test('apelido de ateliê reprova, e isso e o certo', () => {
  // Reprovar aqui NAO e ficar sem foto: significa "vai buscar no Bling".
  assert.equal(corBate('Alba_Gray_Frente.png', 'Areia'), false);
  assert.equal(corBate('Maelle_3_Frente.png', 'Bege'), false);
  assert.equal(corBate('Elara_Grande_Jeans_Frente.png', 'Tweed'), false);
});

test('lote SEM cor nao passa — nada de aceitar por falta de criterio', () => {
  assert.equal(corBate('Lunea_Fendi_Frente.png', null), false);
  assert.equal(corBate('Lunea_Fendi_Frente.png', '  '), false);
  assert.equal(pastaServeParaACor('Lunea_Fendi - SS0008HB.M5', ['Lunea_Fendi_Frente.png'], ''), false);
});

test('pasta sem foto nenhuma nao serve', () => {
  assert.equal(pastaServeParaACor('Cerne_Jeans - SS0002HB.B1', [], 'Jeans'), false);
});
