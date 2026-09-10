import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  larguraDoGrafico,
  rotulosQueCabem,
  ancoraDoRotulo,
  MINIMO_POR_PONTO,
  FAIXA_QUE_AVISA,
  ESPACO_ANTES_DO_GRAFICO,
  ESPACO_DEPOIS_DO_GRAFICO,
  LARGURA_QUANDO_NAO_DA_PRA_MEDIR,
  caixaDoSelo,
  rotuloCurtoDoSelo,
} from './largura-do-grafico.js';

// A MEDIDA QUE ORIGINOU ESTE MÓDULO (375px, período de 30 dias, /redes-sociais):
// o gráfico tinha 319px de largura útil e 30 dias — ~10px por dia. "R$ 17,34" e
// "R$ 11,35" ficavam sobrepostos em −5px. Não é questão de arrumar melhor: não
// existe arrumação que caiba 30 valores em moeda dentro de 319px.

test('o que cabe continua igual: 30px por ponto exatos NÃO rolam', () => {
  // 10 pontos × 30px = 300px. O contêiner tem exatamente 300px: cabe.
  const r = larguraDoGrafico({ pontos: 10, larguraDisponivel: 300 });
  assert.equal(r.rola, false);
  assert.equal(r.largura, 300);
});

test('um ponto a mais que a conta já não cabe e passa a rolar', () => {
  const r = larguraDoGrafico({ pontos: 11, larguraDisponivel: 300 });
  assert.equal(r.rola, true);
  assert.equal(r.largura, 330); // 11 × 30
});

test('um ponto só nunca rola', () => {
  const r = larguraDoGrafico({ pontos: 1, larguraDisponivel: 300 });
  assert.deepEqual(r, { largura: 300, rola: false, larguraDaTrilha: 300, espacoPorPonto: 300 });
});

test('zero ponto: nada a desenhar, o gráfico fica do tamanho do contêiner', () => {
  const r = larguraDoGrafico({ pontos: 0, larguraDisponivel: 319 });
  assert.equal(r.rola, false);
  assert.equal(r.largura, 319);
  assert.equal(r.espacoPorPonto, 0); // sem ponto não há espaço POR ponto: não é 319/0 = Infinity
});

// O ESTRAGO QUE ESTA REGRA EVITA: se a largura fosse só "pontos × 30", uma semana
// no computador viraria um toco de 210px no meio de 1200px de cartão vazio.
test('contêiner maior que o necessário NUNCA encolhe o gráfico', () => {
  const r = larguraDoGrafico({ pontos: 7, larguraDisponivel: 1200 });
  assert.equal(r.largura, 1200);
  assert.equal(r.rola, false);
});

// ATENÇÃO AO 14: 14 × 30 = 420, e 420 não cabe em 319. Quem lê o desenho pode
// esperar que "14 dias no celular fica como está hoje" — pela régua dos 30px por
// dia, NÃO fica: 14 dias no celular passam a rolar também. Quem manda é a régua.
test('celular de 375px (319px úteis): 7 dias cabem, 14 dias já não', () => {
  const sete = larguraDoGrafico({ pontos: 7, larguraDisponivel: 319 });
  assert.equal(sete.rola, false);
  assert.equal(sete.largura, 319);
  const catorze = larguraDoGrafico({ pontos: 14, larguraDisponivel: 319 });
  assert.equal(catorze.rola, true);
  assert.equal(catorze.largura, 420);
});

test('celular de 375px com 30 dias: 900px de gráfico, 30px por dia', () => {
  const r = larguraDoGrafico({ pontos: 30, larguraDisponivel: 319 });
  assert.equal(r.rola, true);
  assert.equal(r.largura, 900);
  assert.equal(r.espacoPorPonto, 30);
});

test('tela larga: 31 dias cabem e NÃO viram rolagem', () => {
  const r = larguraDoGrafico({ pontos: 31, larguraDisponivel: 1830 });
  assert.equal(r.rola, false);
  assert.equal(r.largura, 1830);
  assert.ok(r.espacoPorPonto > MINIMO_POR_PONTO);
});

// UMA REGRA SÓ, SEM EXCEÇÃO POR TIPO DE TELA. Tela larga não é sinônimo de
// "cabe": a 1920 os dois cartões da seção 02 dividem a linha e ficam com 836px
// cada, e 30 dias pedem 900 — então lá também rola. A conta é a mesma em toda
// tela; quem manda é a largura que o cartão tem, não o aparelho que é.
test('tela larga que mesmo assim não comporta os dias: rola igual', () => {
  const r = larguraDoGrafico({ pontos: 30, larguraDisponivel: 836 });
  assert.equal(r.rola, true);
  assert.equal(r.largura, 900);
});

test('o mínimo por ponto é ajustável, e 30px é o padrão', () => {
  assert.equal(MINIMO_POR_PONTO, 30);
  const r = larguraDoGrafico({ pontos: 10, larguraDisponivel: 300, minimoPorPonto: 40 });
  assert.equal(r.rola, true);
  assert.equal(r.largura, 400);
});

// SEM ESTA GUARDA O DESKTOP QUEBRA: um cartão ainda não medido (aba escondida,
// primeiro desenho antes do layout) devolve clientWidth 0. Zero lido como "não
// tem espaço" mandaria TODO gráfico rolar, inclusive no computador.
test('contêiner que ainda não foi medido cai na largura de projeto, não em zero', () => {
  for (const ruim of [0, -50, NaN, null, undefined, 'abc', Infinity]) {
    const r = larguraDoGrafico({ pontos: 7, larguraDisponivel: ruim });
    assert.equal(r.largura, LARGURA_QUANDO_NAO_DA_PRA_MEDIR, 'largura para ' + String(ruim));
    assert.equal(r.rola, false, 'rola para ' + String(ruim));
  }
});

test('quantidade de pontos estranha não derruba a conta', () => {
  for (const ruim of [null, undefined, NaN, -3, 'abc']) {
    const r = larguraDoGrafico({ pontos: ruim, larguraDisponivel: 319 });
    assert.equal(r.largura, 319, 'largura para ' + String(ruim));
    assert.equal(r.rola, false, 'rola para ' + String(ruim));
  }
});

test('largura é sempre inteira: meio pixel de SVG vira borda tremida', () => {
  const r = larguraDoGrafico({ pontos: 7, larguraDisponivel: 319.53 });
  assert.equal(Number.isInteger(r.largura), true);
  assert.equal(r.largura, 320);
});

// As DUAS beiradas precisam de tira vazia, porque o rótulo é centrado no ponto e
// o primeiro e o último ficam na borda: metade deles sobra para fora do desenho,
// e fora do desenho, dentro de uma caixa que rola, é lugar recortado. Medido a
// 375px antes das tiras: "R$ 17,34" virava "$ 17,34" e "19/7" virava "/7".
test('as tiras vazias dão espaço para o rótulo que sobra da beirada', () => {
  // ~12px é a metade do rótulo mais largo que costuma abrir o gráfico ("R$ 17,34").
  assert.ok(ESPACO_ANTES_DO_GRAFICO >= 12, 'tira da entrada curta demais');
  // A da saída ainda leva a faixa apagada em cima, e não pode apagar o último dia.
  assert.equal(FAIXA_QUE_AVISA, 28);
  assert.ok(ESPACO_DEPOIS_DO_GRAFICO >= FAIXA_QUE_AVISA + 12, 'tira da saída curta demais');
});

test('as tiras vazias só existem quando o gráfico rola', () => {
  const rolando = larguraDoGrafico({ pontos: 30, larguraDisponivel: 319 });
  assert.equal(rolando.larguraDaTrilha, 900 + ESPACO_ANTES_DO_GRAFICO + ESPACO_DEPOIS_DO_GRAFICO);
  const parado = larguraDoGrafico({ pontos: 7, larguraDisponivel: 319 });
  assert.equal(parado.larguraDaTrilha, 319); // cabendo, nada de tira nem de faixa
});

// ───────────────────────────────────────────────────────────────────────────
// ANCORAR O RÓTULO PARA ELE NÃO SAIR DO QUADRO
//
// O DEFEITO MEDIDO (375px, 30 dias, valores reais do Breno Vale): "R$ 92,86",
// que é o rótulo do PRIMEIRO dia, sobrava 12,3px PARA FORA da caixa do próprio
// SVG. O rótulo é centrado no ponto, e o primeiro ponto fica a 10 unidades da
// borda: metade de um rótulo de ~48 unidades não cabe em 10. O mesmo acontece
// espelhado no último dia.
// ───────────────────────────────────────────────────────────────────────────

test('rótulo do meio continua centrado no ponto, como sempre foi', () => {
  assert.deepEqual(ancoraDoRotulo({ centro: 450, largura: 48, quadro: 900 }), { x: 450, ancora: 'middle' });
});

test('rótulo que sairia pela esquerda encosta na borda e cresce para dentro', () => {
  // "R$ 92,86" no primeiro dia: centro 10, largura 48 → começaria em −14.
  assert.deepEqual(ancoraDoRotulo({ centro: 10, largura: 48, quadro: 900 }), { x: 0, ancora: 'start' });
});

test('rótulo que sairia pela direita encosta na borda e cresce para dentro', () => {
  assert.deepEqual(ancoraDoRotulo({ centro: 890, largura: 48, quadro: 900 }), { x: 900, ancora: 'end' });
});

test('encostou por um triz ainda é centrado: não se mexe no que já cabe', () => {
  assert.deepEqual(ancoraDoRotulo({ centro: 24, largura: 48, quadro: 900 }), { x: 24, ancora: 'middle' });
  assert.deepEqual(ancoraDoRotulo({ centro: 876, largura: 48, quadro: 900 }), { x: 876, ancora: 'middle' });
});

test('rótulo maior que o quadro inteiro começa no início, para se ler o começo', () => {
  const r = ancoraDoRotulo({ centro: 100, largura: 400, quadro: 200 });
  assert.deepEqual(r, { x: 0, ancora: 'start' });
});

// ───────────────────────────────────────────────────────────────────────────
// QUAIS RÓTULOS CABEM SEM SE TOCAR
//
// O DEFEITO MEDIDO: "R$ 20,41" × "R$ 26,40" sobrepostos. Nasce de três coisas
// juntas, e só das três: (1) um dia SEM DADO encurta a lista de dias com número,
// e o passo "1 a cada 3" passa a cair no vizinho do último; (2) o último dia é
// SEMPRE rotulado, esteja no passo ou não — então dois rótulos ficam a um dia de
// distância; (3) os dois valores têm altura parecida, porque o dia mais caro do
// mês puxa a escala, e aí os rótulos ficam na mesma faixa de altura.
// Só a distância horizontal não bastava para decidir: dois rótulos vizinhos com
// alturas BEM diferentes não se tocam, e derrubar um deles seria perder número à
// toa. Por isso a conta olha a caixa inteira, nos dois eixos.
// ───────────────────────────────────────────────────────────────────────────

const cx = (chave, x0, x1, y0, y1, obrigatorio = false) => ({ chave, caixa: { x0, x1, y0, y1 }, obrigatorio });

test('rótulos que não se tocam ficam todos', () => {
  const r = rotulosQueCabem([cx('a', 0, 48, 20, 33), cx('b', 90, 138, 20, 33), cx('c', 180, 228, 20, 33)]);
  assert.deepEqual(r, ['a', 'b', 'c']);
});

test('o par medido: vizinho do passo cai para o último sobreviver', () => {
  // 30 unidades de distância, 48 de largura, mesma faixa de altura: se tocam.
  const doPasso = cx('passo', 810, 858, 25, 38);
  const ultimo = cx('ultimo', 840, 888, 28, 41, true);
  const r = rotulosQueCabem([ultimo, doPasso]);
  assert.deepEqual(r, ['ultimo']); // o obrigatório fica, o do passo sai
});

test('vizinhos com alturas BEM diferentes não se tocam e ficam os dois', () => {
  // Mesma distância horizontal do caso acima, mas um bem mais alto que o outro.
  const doPasso = cx('passo', 810, 858, 70, 83);
  const ultimo = cx('ultimo', 840, 888, 25, 38, true);
  assert.deepEqual(rotulosQueCabem([ultimo, doPasso]), ['ultimo', 'passo']);
});

test('obrigatório entra na frente mesmo vindo depois na lista', () => {
  const doPasso = cx('passo', 100, 148, 20, 33);
  const topo = cx('topo', 130, 178, 22, 35, true);
  // Ordem de entrega invertida de propósito: quem manda é ser obrigatório.
  assert.deepEqual(rotulosQueCabem([doPasso, topo]), ['topo']);
});

test('dois obrigatórios colados: o primeiro da lista sobrevive, e sobra UM número', () => {
  // Acontece quando o dia mais alto é vizinho do último dia. Perder um número é
  // ruim; dois números ilegíveis um por cima do outro é pior.
  const ultimo = cx('ultimo', 840, 888, 25, 38, true);
  const topo = cx('topo', 810, 858, 27, 40, true);
  assert.deepEqual(rotulosQueCabem([ultimo, topo]), ['ultimo']);
});

test('a folga entre rótulos é respeitada: encostar não vale', () => {
  const a = cx('a', 0, 48, 20, 33);
  const b = cx('b', 49, 97, 20, 33); // 1 unidade de distância
  assert.deepEqual(rotulosQueCabem([a, b]), ['a']);
  const longe = cx('longe', 60, 108, 20, 33); // 12 unidades
  assert.deepEqual(rotulosQueCabem([a, longe]), ['a', 'longe']);
});

test('lista vazia não quebra', () => {
  assert.deepEqual(rotulosQueCabem([]), []);
  assert.deepEqual(rotulosQueCabem(), []);
});

/* ── O SELO DA META ──────────────────────────────────────────────────────── */

test('⚠️ a caixinha do selo sai da MEDIDA do texto, e sobra dos dois lados', () => {
  // A caixa real de "Meta máxima R$ 2,00", medida no navegador em 10/09/2026.
  const medida = { x0: 14, x1: 104.8, y0: 0.9, y1: 12.5 };
  const c = caixaDoSelo(medida, { texto: 'Meta máxima R$ 2,00' });
  // O texto tem de caber INTEIRO, com respiro dos dois lados.
  assert.ok(c.x < medida.x0, 'a caixinha começa antes do texto');
  assert.ok(c.x + c.largura > medida.x1, 'a caixinha termina depois do texto');
  assert.equal(medida.x0 - c.x, c.x + c.largura - medida.x1, 'o respiro é igual dos dois lados');
  // E não sobra caixa à toa: o pedido do dono foi "pode deixar ele menor também".
  assert.ok(c.largura < (medida.x1 - medida.x0) + 10);
});

test('⚠️ o que a conta antiga fazia: caixa CURTA e texto para fora', () => {
  // `texto.length * 4.4 + 8`, com o texto começando 4px depois da caixa.
  const antiga = { x: 10, largura: 19 * 4.4 + 8 };            // 91,6
  const textoReal = { x0: 14, x1: 104.8 };                     // 90,8px de largura
  assert.ok(textoReal.x1 > antiga.x + antiga.largura, 'era isto que sangrava');
  // A conta nova, pelo plano B (sem medir), já cobre o texto real.
  const planoB = caixaDoSelo(null, { texto: 'Meta máxima R$ 2,00', x: 10 });
  assert.ok(planoB.largura >= (textoReal.x1 - textoReal.x0), 'o plano B não pode nascer curto');
});

test('sem medida e sem texto, o selo ainda devolve uma caixa desenhável', () => {
  const c = caixaDoSelo(null, {});
  assert.ok(c.largura > 0 && c.altura > 0);
  assert.equal(typeof c.x, 'number');
});

test('⚠️ o selo abrevia, mas o rótulo inteiro continua existindo na linha', () => {
  assert.equal(rotuloCurtoDoSelo('Meta máxima'), 'Meta máx.');
  assert.equal(rotuloCurtoDoSelo('Meta mínima'), 'Meta mín.');
  // O que não tem o que abreviar passa intacto — nunca corta pelo tamanho.
  assert.equal(rotuloCurtoDoSelo('Meta'), 'Meta');
  assert.equal(rotuloCurtoDoSelo('Meta 25/dia'), 'Meta 25/dia');
  assert.equal(rotuloCurtoDoSelo(''), '');
  assert.equal(rotuloCurtoDoSelo(null), '');
});

test('⚠️ abreviar deixa o selo MENOR que a caixinha errada de antes', () => {
  const antiga = 19 * 4.4 + 8;                                  // 91,6px
  const agora = rotuloCurtoDoSelo('Meta máxima').length + ' R$ 2,00'.length;
  const planoB = caixaDoSelo(null, { texto: rotuloCurtoDoSelo('Meta máxima') + ' R$ 2,00' });
  assert.equal(agora, 17);
  assert.ok(planoB.largura < antiga, 'o selo tem de caber em menos espaço que o de antes');
});
