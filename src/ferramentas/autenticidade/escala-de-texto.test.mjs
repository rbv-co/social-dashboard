/* A ESCALA DE TEXTO DESTA TELA — o teste que impede a volta.
 *
 * POR QUE ELE EXISTE. Até 01/09/2026 esta tela tinha QUINZE tamanhos de texto
 * distintos: 10 · 11 · 12 · 12,5 · 13 · 13,5 · 14 · 15 · 16 · 17 · 19 · 26px,
 * mais os três do modo bancada. Doze deles entre 10 e 26 pixels, VÁRIOS
 * separados por meio pixel. O dono reclamou dela três vezes, com estas
 * palavras: "vários tamanhos de fonte, uma bosta, confuso".
 *
 * Nenhum daqueles números foi escrito de má-fé: cada um "encaixava ali" no dia
 * em que foi escrito. É exatamente por isso que este teste existe — sem ele, o
 * próximo ajuste reintroduz um `13.5px` e ninguém percebe, do mesmo jeito que
 * ninguém percebeu os quinze.
 *
 * O QUE ELE COBRE: os dois arquivos da ferramenta que desenham a tela — a tela
 * grande e o painel de busca das três abas. Nas CINCO abas, no guia e no modo
 * bancada: é tudo o mesmo CSS.
 *
 * O QUE ELE NÃO COBRE: se o desenho ficou bonito. Isso continua sendo olho, e
 * se mede a 375px e a 1440px num navegador de verdade (PADRAO item 10).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const tela = readFileSync(new URL('./tela-de-autenticidade.vue', import.meta.url), 'utf8');
const painel = readFileSync(new URL('./painel-de-busca.vue', import.meta.url), 'utf8');
const globais = readFileSync(
  new URL('../../estilos/estilos-globais.css', import.meta.url), 'utf8');

const estiloDe = (fonte) => fonte.slice(fonte.indexOf('<style'));
/* OS COMENTÁRIOS SAEM ANTES DE PROCURAR REGRA: eles citam `font-size` e os
   números velhos POR ESCRITO — é assim que a explicação fica junto da regra
   nesta casa. Sem tirá-los, o teste acharia defeito dentro da própria
   explicação de por que o defeito acabou. */
const semComentarios = (css) => css.replace(/\/\*[^]*?\*\//g, '');

const ARQUIVOS = [
  ['tela-de-autenticidade.vue', semComentarios(estiloDe(tela))],
  ['painel-de-busca.vue', semComentarios(estiloDe(painel))],
];

/* Os cinco degraus, na ordem em que crescem. Um sexto nome aqui é uma decisão
   de desenho, não um detalhe de teste: ele muda a tela inteira. */
const DEGRAUS = [
  '--texto-etiqueta',
  '--texto-corpo',
  '--texto-campo',
  '--texto-titulo',
  '--texto-numero',
];

/* ── 1. A ESCALA EXISTE, E ESTÁ NOS TOKENS ────────────────────────────────── */

test('os cinco degraus moram em estilos-globais.css, e não na tela', () => {
  // escala que mora dentro de UMA tela é como a Central chegou a quinze
  // tamanhos numa tela só: cada uma inventa a sua e nenhuma combina com a outra
  for (const degrau of DEGRAUS) {
    assert.match(globais, new RegExp(`${degrau}:\\s*max\\(`),
      `${degrau} sumiu dos tokens globais`);
  }
  for (const [nome, css] of ARQUIVOS) {
    for (const degrau of DEGRAUS) {
      assert.doesNotMatch(css, new RegExp(`${degrau}\\s*:`),
        `${nome} redefiniu ${degrau} — a escala é da casa, não da tela`);
    }
  }
});

test('cada degrau respeita o zoom de letra do usuário e tem piso', () => {
  // `--escala-texto` é o ajuste de acessibilidade da moldura. Um degrau em
  // pixel cravado ignora quem aumentou a letra do sistema; um degrau SEM piso
  // some quando a pessoa reduz.
  for (const degrau of DEGRAUS) {
    const m = globais.match(
      new RegExp(`${degrau}:\\s*max\\(\\s*(\\d+)px,\\s*calc\\((\\d+(?:\\.\\d+)?)px \\* var\\(--escala-texto, 1\\)\\)\\)`));
    assert.ok(m, `${degrau} não está no formato max(piso, calc(Npx * var(--escala-texto, 1)))`);
    const [, piso, base] = m;
    assert.ok(Number(piso) >= 9, `o piso de ${degrau} é ${piso}px: abaixo de 9px o texto some`);
    assert.ok(Number(piso) <= Number(base), `o piso de ${degrau} é MAIOR que a base`);
  }
});

test('o degrau de campo nunca desce de 16px — abaixo disso o iOS dá zoom ao focar', () => {
  // 16px no campo não é estética (PADRAO item 6): abaixo disso o iOS dá zoom
  // sozinho ao focar e a tela salta na cara de quem está digitando.
  const m = globais.match(/--texto-campo:\s*max\(\s*(\d+)px,\s*calc\((\d+(?:\.\d+)?)px/);
  assert.ok(m, 'sumiu o degrau do campo');
  assert.equal(Number(m[1]), 16, 'o PISO do degrau de campo tem de ser 16px, não menos');
  assert.ok(Number(m[2]) >= 16, 'a base do degrau de campo tem de ser 16px ou mais');
});

test('os degraus são cinco, e a diferença entre eles é de verdade', () => {
  // meio pixel de diferença o olho não lê como hierarquia: lê como bagunça. Foi
  // isso, e não a quantidade, que o dono chamou de "confuso".
  const bases = DEGRAUS.map((d) => Number(
    globais.match(new RegExp(`${d}:\\s*max\\(\\d+px,\\s*calc\\((\\d+(?:\\.\\d+)?)px`))[1]));
  assert.equal(bases.length, 5);
  for (let i = 1; i < bases.length; i++) {
    assert.ok(bases[i] - bases[i - 1] >= 2,
      `${DEGRAUS[i - 1]} (${bases[i - 1]}px) e ${DEGRAUS[i]} (${bases[i]}px) estão a menos de 2px `
      + 'um do outro — isso não é hierarquia, é bagunça');
  }
});

/* ── 2. A TELA NÃO ESCREVE NÚMERO SOLTO ───────────────────────────────────── */

test('todo font-size dos dois arquivos sai da escala, e nenhum é número solto', () => {
  const soltos = [];
  for (const [nome, css] of ARQUIVOS) {
    for (const m of css.matchAll(/font-size:\s*([^;}]+)/g)) {
      const valor = m[1].trim();
      if (DEGRAUS.some((d) => valor === `var(${d})`)) continue;
      // a linha inteira, para quem for ler o erro saber ONDE está
      const linha = css.slice(0, m.index).split('\n').length;
      soltos.push(`${nome}:${linha} → font-size:${valor}`);
    }
  }
  assert.deepEqual(soltos, [],
    'tamanho de texto escrito à mão. Ele sai da escala de `estilos-globais.css` '
    + `(${DEGRAUS.join(' · ')}), como a cor sai de token. Se o degrau que você precisa `
    + 'não existe, ele entra na escala com o motivo escrito — não aqui:\n'
    + soltos.join('\n'));
});

test('a conta bate: cinco tamanhos distintos na tela, e cinco só', () => {
  // era QUINZE. O número é a prova de que a escala pegou — e se um dia alguém
  // acrescentar um sexto degrau na casa sem precisar dele nesta tela, este
  // teste continua contando só o que a tela usa.
  const usados = new Set();
  for (const [, css] of ARQUIVOS) {
    for (const m of css.matchAll(/font-size:\s*var\((--texto-[\w-]+)\)/g)) usados.add(m[1]);
  }
  assert.ok(usados.size <= 5,
    `a tela usa ${usados.size} tamanhos: ${[...usados].join(', ')}`);
  for (const d of usados) {
    assert.ok(DEGRAUS.includes(d), `${d} não é um degrau da escala`);
  }
});

/* ── 3. O QUE A ESCALA NÃO PODE TER QUEBRADO ──────────────────────────────── */

test('todo campo de formulário desta tela usa o degrau do campo', () => {
  // Campo abaixo de 16px é defeito medido, não gosto: o iOS dá zoom ao focar.
  // Este teste lê as regras que terminam em `input`, `select` ou `textarea`.
  const faltas = [];
  for (const [nome, css] of ARQUIVOS) {
    for (const m of css.matchAll(/([^{}]*(?:input|select|textarea)[^{}]*)\{([^}]*)\}/g)) {
      const [, seletor, corpo] = m;
      if (!/font-size:/.test(corpo)) continue;
      if (!corpo.includes('var(--texto-campo)')) {
        faltas.push(`${nome}: ${seletor.trim()} → ${corpo.match(/font-size:[^;}]+/)[0]}`);
      }
    }
  }
  assert.deepEqual(faltas, [],
    'campo de formulário com tamanho fora de `--texto-campo`:\n' + faltas.join('\n'));
});

test('o modo bancada usa a escala da casa, e não uma escala só dele', () => {
  // Ele tinha três variáveis próprias (`--bancada-peca`, `--bancada-estado`,
  // `--bancada-resto`). Eram honestas e bem escritas — e eram uma escala
  // particular de uma tela, que é como a Central chegou a quinze tamanhos.
  const css = semComentarios(estiloDe(tela));
  for (const velho of ['--bancada-peca', '--bancada-estado', '--bancada-resto']) {
    assert.doesNotMatch(css, new RegExp(velho),
      `${velho} voltou: o modo bancada tem de usar os degraus da casa`);
  }
  // e o painel continua com os três papéis que o dono aprovou: o número grande,
  // o estado, e o resto no corpo
  const bancada = css.slice(css.indexOf('.au-bancada{'));
  assert.match(bancada, /\.au-bancada-peca\{[^}]*font-size:var\(--texto-numero\)/,
    'o número da peça deixou de ser o maior elemento do painel');
  assert.match(bancada, /\.au-bancada-titulo\{[^}]*font-size:var\(--texto-titulo\)/,
    'o estado é o que a pessoa olha o tempo todo');
});
