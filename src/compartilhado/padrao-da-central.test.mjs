/* O PADRÃO DA CENTRAL, VERIFICADO SOZINHO
 *
 * `PADRAO-DA-CENTRAL.md` existe porque o dono cansou de pedir a mesma coisa:
 * "não quero mais ter que explicar e pedir isso novamente". Só que documento é
 * um pedido educado — dá pra não ler, dá pra esquecer no meio de uma tela de
 * cinco mil linhas, e o defeito só aparece semanas depois no celular dele.
 *
 * Este teste transforma em CHECAGEM as regras do padrão que dá pra medir no
 * código-fonte. As outras (hierarquia, "um assunto por bloco") continuam sendo
 * olho, e são do dono.
 *
 * Cada regra abaixo já quebrou de verdade — a lista não é preventiva, é
 * histórica. E cada exceção está escrita com o motivo: quando a próxima pessoa
 * precisar de uma, ela adiciona AQUI, com o porquê, em vez de contornar calada.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const RAIZ = new URL('../', import.meta.url).pathname;

function arquivos(dir, exts, saida = []) {
  for (const nome of readdirSync(dir)) {
    if (nome === 'node_modules' || nome === 'dist') continue;
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) arquivos(caminho, exts, saida);
    else if (exts.some((e) => nome.endsWith(e))) saida.push(caminho);
  }
  return saida;
}

const curto = (c) => c.replace(RAIZ, '');
const BLOCO_DE_ESTILO = /^(<style[^>]*>)\n(.*?)\n(<\/style>)/gms;

/** Só o CSS: num `.vue`, `{ }` fora do `<style>` é bloco de JavaScript. */
export function apenasCss(fonte, ehCss) {
  if (ehCss) return fonte;
  return [...fonte.matchAll(BLOCO_DE_ESTILO)].map((m) => m[2]).join('\n');
}

/** Regras `seletor { corpo }` de um CSS. Não entra em regra aninhada. */
export function regras(css) {
  return [...css.matchAll(/([^{}]*)\{([^{}]*)\}/g)].map((m) => ({
    seletor: m[1].trim().split('\n').pop().trim(),
    corpo: m[2],
  }));
}

/* ── 1. Cor de estado sai de token ───────────────────────────────────────── */

/* Hex que PODE ficar, cada um com o motivo. Marca de terceiro é a exceção que
 * o próprio padrão prevê: a cor do Instagram é da Meta, não nossa. */
const COR_PERMITIDA = new Set([
  // marca de terceiro
  '#1877f2', '#0062e0', '#1565c0', '#0d47a1',            // Facebook
  '#f09433', '#e6683c', '#dc2743', '#cc2366', '#bc1888', // degradê do Instagram
  '#833ab4', '#405de6', '#c13584', '#e1306c', '#f56040', '#fcaf45',
  '#25d366', '#128c4a',                                   // WhatsApp
  '#f25022', '#7fba00', '#00a4ef', '#ffb900',             // Microsoft
  '#e1251b',                                              // Zoho
  // identidade de módulo (ver --modulo no PADRAO)
  '#0f766e', '#2dd4bf', '#0d9488',
  // Comercial Vessel: Stylist Circle e Private Edit, as cores do ícone de cada
  // um no menu (pedido do dono, 23/09/2026) — definidas SÓ como token no :root
  '#1e5f74', '#3d9bb5', '#6b4a7a', '#a98bbd',
  // medalha de ranking: ouro/prata/bronze são a coisa, não um estado
  '#b8860b', '#94a3b8', '#b87333', '#d4a017',
  // paleta de dado dos gráficos: cor por métrica, não por estado
  '#7c3aed', '#6d28d9', '#5b21b6', '#4c1d95', '#059669', '#047857',
  '#065f46', '#064e3b', '#022c22', '#0891b2', '#0e7490', '#92400e',
  '#78350f', '#4ade80', '#fca5a5', '#86efac', '#fde68a', '#fcd34d',
  // preto e branco puros: sombra, véu de modal, texto sobre bloco de marca
  '#fff', '#ffffff', '#000', '#000000',
]);

/* Estes SÃO estado e têm token. Cravá-los quebra o tema escuro. */
const COR_DE_ESTADO = {
  '#16a34a': '--green', '#22c55e': '--green', '#15803d': '--green', '#166534': '--green',
  '#dc2626': '--red', '#ef4444': '--red', '#f43f5e': '--red', '#b91c1c': '--red',
  '#d97706': '--orange', '#f59e0b': '--orange', '#f97316': '--orange', '#b45309': '--orange',
  '#eab308': '--yellow', '#ca8a04': '--yellow',
  '#1d4ed8': '--accent', '#2563eb': '--accent', '#3b82f6': '--accent',
  '#8b5cf6': '--roxo', '#a78bfa': '--roxo',
};

test('cor de estado sai de token, nunca de hex cravado', () => {
  const faltas = [];
  for (const caminho of arquivos(RAIZ, ['.vue', '.css'])) {
    const fonte = readFileSync(caminho, 'utf8');
    const semFallback = fonte
      // `var(--x, #hex)` é fallback que nunca entra em ação: não é hex cravado
      .replace(/var\(\s*--[\w-]+\s*,\s*#[0-9a-fA-F]{3,8}\s*\)/g, '')
      // a DEFINIÇÃO do token (`--green:#22c55e`) é onde o hex tem de morar
      .replace(/--[\w-]+\s*:\s*#[0-9a-fA-F]{3,8}/g, '')
      // comentário que EXPLICA a cor não é uso dela
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    for (const [hex, token] of Object.entries(COR_DE_ESTADO)) {
      if (new RegExp(hex + '\\b', 'i').test(semFallback)) {
        faltas.push(`${curto(caminho)}: ${hex} → use var(${token})`);
      }
    }
  }
  assert.deepEqual(faltas, [], 'hex de estado cravado:\n' + faltas.join('\n'));
});

/* ── 2. Texto sobre bloco colorido responde ao tema ──────────────────────── */

test('bloco pintado com token não escreve branco cravado em cima', () => {
  const tokenDeFundo = /(background(-color)?|linear-gradient|radial-gradient)[^;{}]*var\(--(accent|green|red|orange|yellow|roxo|modulo)\)/;
  const faltas = [];
  for (const caminho of arquivos(RAIZ, ['.vue', '.css', '.js'])) {
    for (const linha of readFileSync(caminho, 'utf8').split('\n')) {
      if (tokenDeFundo.test(linha) && /color:\s*(#fff(f{3})?\b|'#fff(f{3})?')/i.test(linha)) {
        faltas.push(`${curto(caminho)}: ${linha.trim().slice(0, 90)}`);
      }
    }
  }
  assert.deepEqual(
    faltas, [],
    'no tema escuro os tokens são CLAROS de propósito — branco em cima não se lê.\n' +
      'Use var(--sobre-cor):\n' + faltas.join('\n'),
  );
});

/* ── 3. Fundo de modal não deixa arrastar ────────────────────────────────── */

/** Cobre a tela inteira E escurece o que está atrás. Sombra não conta. */
export function ehFundoDeModal(corpo) {
  const c = corpo.replace(/\s/g, '');
  if (!c.includes('position:fixed')) return false;
  if (!/(?<!-)\bbackground(-color)?:rgba\(0,0,0/.test(c)) return false;
  return c.includes('inset:0') || ['top', 'left', 'right', 'bottom'].every((l) => c.includes(`${l}:0`));
}

test('todo fundo de modal trava o arrasto para os lados', () => {
  const faltas = [];
  for (const caminho of arquivos(RAIZ, ['.vue', '.css'])) {
    const fonte = readFileSync(caminho, 'utf8');
    const css = apenasCss(fonte, caminho.endsWith('.css'));
    for (const { seletor, corpo } of regras(css)) {
      if (ehFundoDeModal(corpo) && !corpo.includes('touch-action')) {
        faltas.push(`${curto(caminho)}: ${seletor}`);
      }
    }
    // modal montado por JavaScript, com o estilo numa string
    for (const m of fonte.matchAll(/cssText\s*=\s*'([^']*position:fixed[^']*)'/g)) {
      if (ehFundoDeModal(m[1]) && !m[1].includes('touch-action')) {
        faltas.push(`${curto(caminho)}: modal montado por JS`);
      }
    }
  }
  assert.deepEqual(
    faltas, [],
    'sem touch-action:none + overscroll-behavior:contain o dedo arrasta a tela ' +
      'pros lados por dentro do modal:\n' + faltas.join('\n'),
  );
});

/* ── 4. Botão não tem aparência escrita na mão ───────────────────────────── */

const APARENCIA = ['background', 'border-radius', 'font-size', 'font-weight', 'border:'];

test('botão usa as três classes, não style de aparência', () => {
  const faltas = [];
  for (const caminho of arquivos(RAIZ, ['.vue'])) {
    const fonte = readFileSync(caminho, 'utf8');
    for (const m of fonte.matchAll(/<button([^>]*?)\sstyle="([^"]*)"/g)) {
      const [, atributos, estilo] = m;
      if (!APARENCIA.some((p) => estilo.includes(p))) continue;
      // ícone pequeno não é botão de ação: 40px quebraria o alinhamento dele
      const larg = estilo.match(/\bwidth:\s*(\d+)px/);
      if (larg && Number(larg[1]) < 40) continue;
      // classe própria da tela vence .btn por especificidade — somar não muda nada
      if (/class="[^"]*\S/.test(atributos)) continue;
      faltas.push(`${curto(caminho)}: ${estilo.slice(0, 70)}`);
    }
  }
  assert.deepEqual(
    faltas, [],
    'use .btn / .btn.btn-principal / .btn.btn-perigo:\n' + faltas.join('\n'),
  );
});

/* ── 5. Botão comum não tem fundo cinza ──────────────────────────────────── */

test('botão comum é borda e fundo transparente, nunca cinza', () => {
  const cinza = ['background:var(--surface2)', 'background:#f2ede4', 'background:#eee'];
  const faltas = [];
  for (const caminho of arquivos(RAIZ, ['.vue', '.css'])) {
    const css = apenasCss(readFileSync(caminho, 'utf8'), caminho.endsWith('.css'));
    for (const { seletor, corpo } of regras(css)) {
      if (!/(btn|button|\bbt-)/i.test(seletor)) continue;
      if (/:(hover|active|focus|disabled)/.test(seletor)) continue;
      const c = corpo.replace(/\s/g, '');
      if (cinza.some((g) => c.includes(g))) faltas.push(`${curto(caminho)}: ${seletor}`);
    }
  }
  assert.deepEqual(faltas, [], 'fundo cinza em botão:\n' + faltas.join('\n'));
});

/* ── A checagem PEGA o defeito? Sem isto, ela não guarda nada ────────────── */

test('as checagens reprovam o defeito que dizem pegar', () => {
  assert.equal(ehFundoDeModal('position:fixed;inset:0;background:rgba(0,0,0,.5);'), true);
  // sombra também tem rgba(0,0,0,…) e NÃO é fundo de modal — já me enganou uma vez
  assert.equal(ehFundoDeModal('position:fixed;bottom:0;box-shadow:0 -6px 20px rgba(0,0,0,.10);'), false);
  assert.equal(ehFundoDeModal('background:rgba(0,0,0,.5);'), false, 'sem position:fixed não cobre a tela');

  // num .vue, `{ }` fora do <style> é JavaScript: tratá-lo como CSS já corrompeu arquivo
  const vue = '<template>\n<div/>\n</template>\n<script>\nif(x){y=1}\n</script>\n<style>\n.a{color:red}\n</style>';
  assert.equal(apenasCss(vue, false).includes('y=1'), false);
  assert.equal(apenasCss(vue, false).includes('color:red'), true);

  // "<style>" citado num comentário não abre bloco: já engoliu um arquivo inteiro
  const comComentario = '<template>\n<!-- ver <style> abaixo -->\n</template>\n<style>\n.b{color:blue}\n</style>';
  const extraido = apenasCss(comComentario, false);
  assert.equal(extraido.includes('color:blue'), true);
  assert.equal(extraido.includes('ver <style> abaixo'), false);
});
