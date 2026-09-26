import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// TRAVA — PADRAO-DA-CENTRAL item 5 ("texto nunca corta"), rodada de correção 1
// (Onda C, Tarefa 5b, 25/09/2026).
//
// O DEFEITO: `.gt-ad-nm` (nome do anúncio) ganhou um override SÓ dentro de
// `@media(max-width:640px)` tirando o `text-overflow:ellipsis` — a regra BASE
// (fora da media query) continuou com `overflow:hidden;text-overflow:ellipsis;
// white-space:nowrap`. Resultado: entre 641px e o próximo breakpoint (notebook
// com janela estreita, split-screen, tablet deitado) o nome CORTAVA de novo. A
// revisão também achou o MESMO defeito, mais antigo, em `.gt-name` (nome da
// campanha) e `.gt-set-nm` (nome do conjunto) — corrigidos aqui junto, pela
// raiz, em vez de ganhar um quarto seletor com o mesmo problema.
//
// Este teste lê o CSS da tela e prova que a regra BASE de cada um dos três
// seletores (a que vale em QUALQUER largura, sem media query) nunca tem
// `text-overflow:ellipsis` nem `white-space:nowrap` — só a exceção documentada
// vale, e ela não existe aqui.

const AQUI = fileURLToPath(new URL('.', import.meta.url));
const VUE = readFileSync(AQUI + 'tela-de-gestao-trafego.vue', 'utf8');

// Extrai o `<style>` inteiro e joga fora tudo que estiver dentro de um
// `@media(...)` — o que sobra é só a regra BASE (a que vale sem media query
// nenhuma), que é exatamente o que este teste precisa examinar. Um `@media`
// pode ter chaves aninhadas (uma por seletor lá dentro), então conta
// profundidade em vez de cortar no primeiro `}`.
function cssBaseSemMedia(vue) {
  const styleMatch = vue.match(/<style\b[^>]*>([\s\S]*?)<\/style>/g) || [];
  const styleTexto = styleMatch.map((s) => s.replace(/^<style\b[^>]*>/, '').replace(/<\/style>$/, '')).join('\n');
  let out = '';
  let i = 0;
  while (i < styleTexto.length) {
    if (styleTexto.startsWith('@media', i)) {
      let j = styleTexto.indexOf('{', i);
      let profundidade = 1;
      j++;
      while (j < styleTexto.length && profundidade > 0) {
        if (styleTexto[j] === '{') profundidade++;
        else if (styleTexto[j] === '}') profundidade--;
        j++;
      }
      i = j;
    } else {
      out += styleTexto[i];
      i++;
    }
  }
  return out;
}

const CSS_BASE = cssBaseSemMedia(VUE);

// Acha a regra BASE de um seletor `.tela-gestao-trafego :deep(<seletor>){...}`
// (fora de qualquer @media, já filtrado acima). Pode haver mais de uma
// declaração pro mesmo seletor (ex.: `.gt-camp-top:hover .gt-name` é outro
// seletor, não conta) — pega a primeira que bate exatamente.
function regraBase(seletor) {
  const re = new RegExp(
    `\\.tela-gestao-trafego :deep\\(${seletor.replace(/[.[\]]/g, '\\$&')}\\)\\{([^}]*)\\}`,
  );
  const m = CSS_BASE.match(re);
  assert.ok(m, `não achei a regra base de ${seletor} (fora de @media)`);
  return m[1];
}

for (const seletor of ['.gt-ad-nm', '.gt-name', '.gt-set-nm']) {
  test(`regra BASE de ${seletor} nunca corta texto: sem ellipsis, sem nowrap`, () => {
    const corpo = regraBase(seletor);
    assert.ok(!corpo.includes('text-overflow:ellipsis') && !corpo.includes('text-overflow: ellipsis'),
      `${seletor} (base, fora de @media) não pode ter text-overflow:ellipsis — PADRAO-DA-CENTRAL item 5`);
    assert.ok(!corpo.includes('white-space:nowrap') && !corpo.includes('white-space: nowrap'),
      `${seletor} (base, fora de @media) não pode ter white-space:nowrap — sem quebra, o ellipsis nem precisa existir pra cortar`);
  });
}
