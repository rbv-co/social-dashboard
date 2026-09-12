// NENHUM `const` DENTRO DE UMA FUNÇÃO PODE SOMBREAR UM AJUDANTE DO MÓDULO.
//
// POR QUE ESTA GUARDA EXISTE (13/08/2026): a aba "A régua" do Gestor de Tráfego
// ficou COMPLETAMENTE morta por um dia e ninguém percebeu. Clicar nela dava
//
//     ReferenceError: Cannot access 'campo' before initialization
//
// e a aba não pintava nada. O motivo, em `painel-regua.js`: a função de topo
// `campo(...)` desenhava os campos de peso lá na linha 188, e a parte da persona
// — 336 linhas ABAIXO, na mesma função — declarava `const campo =
// document.getElementById('pnd-persona')`.
//
// Em JavaScript, um `const` vale para a função INTEIRA, inclusive nas linhas
// ANTES dele (a "zona morta temporal"). Então o uso da linha 188 parou de
// enxergar a função do módulo e passou a apontar para o `const` de baixo, que
// ainda não existia. Estourou.
//
// O QUE TORNA ISTO PERIGOSO: nada acusa. O `npm test` ficava verde, o
// `npm run build` ficava verde, o `.vue` compilava. Só o navegador, no clique,
// contava a verdade — e só para quem abrisse justamente aquela aba.
//
// A REGRA: se uma função usa um nome e MAIS PARA BAIXO, dentro dela mesma,
// declara um `const`/`let` com esse nome, está errado. Renomeie a variável de
// dentro (foi o que se fez: `campo` → `campoPersona`).
//
// Falso positivo? Renomeie mesmo assim. Duas coisas diferentes com o mesmo nome
// no mesmo escopo é confusão barata de resolver e cara de descobrir.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const RAIZ = 'src';

function arquivosDeCodigo(dir, saida = []) {
  for (const nome of readdirSync(dir)) {
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) arquivosDeCodigo(caminho, saida);
    else if (/\.(js|vue|mjs)$/.test(nome) && !/\.test\./.test(nome)) saida.push(caminho);
  }
  return saida;
}

// "Começo de função de topo" = declarada na coluna 0. É onde moram os ajudantes
// do módulo; é esse escopo que o `const` de dentro sequestra.
const comecaFuncaoDeTopo = (linha) =>
  /^(?:export\s+)?(?:async\s+)?function\s+[A-Za-z_$][\w$]*/.test(linha) ||
  /^(?:export\s+)?(?:const|let)\s+[A-Za-z_$][\w$]*\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/.test(linha);

function sombrasMortais(caminho) {
  const linhas = readFileSync(caminho, 'utf8').split('\n');

  const nomesDeTopo = new Map();
  linhas.forEach((linha, i) => {
    const m = linha.match(/^(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/)
           || linha.match(/^(?:export\s+)?(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=/);
    if (m && !nomesDeTopo.has(m[1])) nomesDeTopo.set(m[1], i + 1);
  });

  const achados = [];
  linhas.forEach((linha, i) => {
    const m = linha.match(/^\s+(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=/);
    if (!m || !nomesDeTopo.has(m[1])) return;
    const nome = m[1];

    let inicio = -1;
    for (let j = i - 1; j >= 0; j--) if (comecaFuncaoDeTopo(linhas[j])) { inicio = j; break; }
    if (inicio < 0) return;

    const usa = new RegExp(`\\b${nome}\\b`);
    for (let j = inicio; j < i; j++) {
      if (usa.test(linhas[j]) && !/^\s*(?:\/\/|\*)/.test(linhas[j])) {
        achados.push(
          `${caminho}: "${nome}" é usado na linha ${j + 1} e só vira const na linha ${i + 1} ` +
          `(mesma função) — renomeie o de dentro.`
        );
        return;
      }
    }
  });
  return achados;
}

test('nenhum const de dentro sombreia um ajudante do módulo', () => {
  const problemas = arquivosDeCodigo(RAIZ).flatMap(sombrasMortais);
  assert.deepEqual(problemas, [], '\n' + problemas.join('\n') + '\n');
});

test('a guarda realmente pega o defeito que a motivou', () => {
  // Sem esta prova, um detector quebrado passaria por "está tudo limpo" —
  // que é exatamente o tipo de mentira que esta guarda existe para impedir.
  const pasta = mkdtempSync(join(tmpdir(), 'sombra-'));
  const arquivo = join(pasta, 'exemplo.js');
  writeFileSync(arquivo, [
    'function campo(id) { return `<input id="${id}">`; }',
    '',
    'export function montar(o) {',
    '  const linhas = campo("peso-curtidas");',
    '  const campo = document.getElementById("persona");',
    '  return linhas + campo;',
    '}',
    '',
  ].join('\n'));

  const achados = sombrasMortais(arquivo);
  assert.equal(achados.length, 1, 'a guarda tem que enxergar a sombra do exemplo');
  assert.match(achados[0], /"campo"/);
});
