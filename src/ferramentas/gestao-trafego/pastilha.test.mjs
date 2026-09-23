import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pastilha, NOMES_DE_PASTILHA } from './pastilha.js';

test('a pastilha é enfeite: escondida do leitor de tela, com a classe do ícone da casa', () => {
  const h = pastilha('funil');
  assert.match(h, /^<span class="gt-pastilha" aria-hidden="true"><svg class="id-icone" viewBox="0 0 24 24"/);
  assert.match(h, /<\/svg><\/span>$/);
});

test('nome que não existe não vira caixa vazia', () => {
  assert.equal(pastilha('nao-existe'), '');
  assert.equal(pastilha(undefined), '');
});

test('nenhuma cor mora no desenho — quem pinta é a folha da tela', () => {
  for (const n of NOMES_DE_PASTILHA) {
    assert.doesNotMatch(pastilha(n), /#[0-9a-f]{3,8}|fill=|stroke=|style=/i, n);
  }
});

test('o traço é o MESMO do icone-do-bloco.vue (a cópia não pode divergir calada)', () => {
  const vue = readFileSync(new URL('../../compartilhado/icone-do-bloco.vue', import.meta.url), 'utf8');
  const normal = (s) => s.replace(/\s*\/>/g, '/>').replace(/\s+/g, ' ').trim();
  for (const n of NOMES_DE_PASTILHA) {
    const bloco = vue.match(new RegExp(`nome === '${n}'">([\\s\\S]*?)</template>`));
    assert.ok(bloco, `${n} não existe em icone-do-bloco.vue`);
    const miolo = pastilha(n).replace(/^.*?focusable="false">/, '').replace(/<\/svg><\/span>$/, '');
    assert.equal(normal(miolo).replace(/> </g, '><'), normal(bloco[1]).replace(/> </g, '><'), n);
  }
});
