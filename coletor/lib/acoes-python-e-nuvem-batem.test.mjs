// A REGRA DE "QUAIS NOMES DA META VALEM" MORA EM DOIS LUGARES. Este teste existe
// para que os dois nunca divirjam em silêncio.
//
// Quem escreve as quatro colunas (conversas, cadastros, compras, visitas) são DOIS
// robôs diferentes, em duas linguagens:
//   1. o coletor da nuvem  → supabase/functions/_shared/acoes-de-campanha.js
//   2. o coletor deste Mac → projetos/.../redes-sociais/coletor/acoes_de_campanha.py
//
// Python não importa JavaScript, então a segunda é uma CÓPIA. Cópia sem vigia
// diverge: alguém acrescenta um nome de ação novo num lado, esquece o outro, e a
// mesma campanha passa a contar diferente conforme o recorte que a tela pediu —
// sem erro nenhum aparecer. Este teste lê os dois arquivos e exige que as listas
// sejam IDÊNTICAS, na mesma ordem (a ordem importa: cada contagem para na primeira
// que existir, então trocar a ordem troca o número).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { TIPOS as TIPOS_DA_NUVEM } from '../../supabase/functions/_shared/acoes-de-campanha.js';

const AQUI = dirname(fileURLToPath(import.meta.url));
const CAMINHO_PY = resolve(
  AQUI,
  '../../projetos/central-inteligencia/redes-sociais/coletor/acoes_de_campanha.py',
);

// Lê o `TIPOS = {...}` do arquivo Python. O bloco é escrito de propósito com aspas
// duplas e sem vírgula sobrando, então ele é JSON válido — nada de interpretar
// Python de mentira aqui.
function tiposDoPython() {
  const texto = readFileSync(CAMINHO_PY, 'utf8');
  const inicio = texto.indexOf('TIPOS = {');
  assert.notEqual(inicio, -1, 'não achei `TIPOS = {` no arquivo Python');
  const abre = texto.indexOf('{', inicio);
  let profundidade = 0;
  let fim = -1;
  for (let i = abre; i < texto.length; i++) {
    if (texto[i] === '{') profundidade++;
    else if (texto[i] === '}') {
      profundidade--;
      if (profundidade === 0) { fim = i; break; }
    }
  }
  assert.notEqual(fim, -1, 'o `TIPOS = {` do Python não fecha');
  return JSON.parse(texto.slice(abre, fim + 1));
}

test('as quatro contagens têm as mesmas chaves nos dois coletores', () => {
  assert.deepEqual(Object.keys(tiposDoPython()).sort(), Object.keys(TIPOS_DA_NUVEM).sort());
});

test('cada contagem tem a mesma lista de nomes, na mesma ordem', () => {
  const py = tiposDoPython();
  for (const chave of Object.keys(TIPOS_DA_NUVEM)) {
    assert.deepEqual(
      py[chave],
      TIPOS_DA_NUVEM[chave],
      `a lista de "${chave}" difere entre o coletor da nuvem e o do Mac`,
    );
  }
});
