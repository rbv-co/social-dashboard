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
  //
  // ⚠️ Rodada de correção 1: a versão anterior media uma JANELA DE
  // CARACTERES (-300/+200) a partir da PRIMEIRA ocorrência de
  // "nomesChegamPerto" no arquivo. Isso é frágil: a própria linha de
  // `import { ..., nomesChegamPerto } from ...` já contém o texto
  // "nomesChegamPerto", e se ela vier ANTES do uso de verdade (o normal, e
  // como o código está escrito), a distância medida é a do import até
  // qualquer coisa perto dele — não prova nada sobre o USO da função. Prova
  // certa: achar a linha que de fato CHAMA `nomesChegamPerto` (descartando a
  // linha de import) e exigir `tem_marca` NELA.
  const linhaDeUso = FONTE.split('\n').find((linha) =>
    linha.includes('nomesChegamPerto(') && !linha.trimStart().startsWith('import'));
  assert.ok(linhaDeUso, 'a edge tem de USAR a regra frouxa, não só importá-la');
  assert.match(linhaDeUso, /tem_marca/,
    'a regra frouxa (nomesChegamPerto) só pode entrar junto da marca PRESENTE');
});

test('a decisão de aprovar é a mesma da regra pura', () => {
  assert.ok(nomesBatem('Ana Souza', 'ANA MARIA DE SOUZA'));
  assert.ok(!nomesChegamPerto('Bia Souza', 'Ana Souza'));
});
