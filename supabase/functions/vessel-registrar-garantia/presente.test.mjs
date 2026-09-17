// supabase/functions/vessel-registrar-garantia/presente.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { nomesBatem, nomesChegamPerto } from '../_shared/nome-de-quem-deu.js';

const FONTE = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'index.ts'), 'utf8');

test('⚠️ o caminho do presente exige UM candidato só', () => {
  assert.match(FONTE, /length === 1|length !== 1/,
    'dois pedidos possíveis têm de cair na fila, nunca aprovar no chute');
});

test('⚠️ a regra frouxa só vale com a marca PRESENTE', () => {
  // Sem a marca, "Ana Sousa" não pode virar "Ana Souza" sozinho.
  const i = FONTE.indexOf('nomesChegamPerto');
  assert.ok(i > 0, 'a edge tem de usar a regra frouxa');
  assert.match(FONTE.slice(Math.max(0, i - 300), i + 200), /tem_marca/);
});

test('a decisão de aprovar é a mesma da regra pura', () => {
  assert.ok(nomesBatem('Ana Souza', 'ANA MARIA DE SOUZA'));
  assert.ok(!nomesChegamPerto('Bia Souza', 'Ana Souza'));
});
