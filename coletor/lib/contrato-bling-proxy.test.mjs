import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MODELOS } from './notas-bling.mjs';

/* O CONTRATO ROBÔ -> `POST /bling-proxy` DA API EM GO. Os robôs do Bling (notas, relatórios, cards, gestor, pedidos da
 * Vessel) mandam `{ endpoint, params }` com o token `srv_` do robô; a API só abre os caminhos de uma lista fechada
 * (`api/internal/comercial/bling.go`, `caminhosPermitidos`) e responde 403 `endpoint nao permitido` ao resto. Endpoint que o
 * robô usa e a lista não tem = robô quebrado na virada, sem aviso.
 *
 * Aqui se LÊ cada endpoint que o código do `coletor/` passa a `blingProxy(...)` e se trava no arquivo
 * `__fixtures__/endpoints-do-bling-proxy.json`; o teste Go `contrato_robos_test.go` lê o MESMO arquivo e exige que a API
 * deixe passar cada um. Endpoint novo no robô reprova aqui até entrar no arquivo, e o Go confere do outro lado. */

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = join(AQUI, '..');
const FIXTURE = join(AQUI, '__fixtures__', 'endpoints-do-bling-proxy.json');

const arquivos = [
  ...readdirSync(RAIZ).filter((f) => f.endsWith('.mjs') && !f.endsWith('.test.mjs')).map((f) => join(RAIZ, f)),
  ...readdirSync(AQUI).filter((f) => f.endsWith('.mjs') && !f.endsWith('.test.mjs')).map((f) => join(AQUI, f)),
];

// 'pedidos/vendas' | 'pedidos/vendas/' + id | `pedidos/vendas/${id}` | modelo | `${modelo}/${notaId}`
function endpointsDe(texto) {
  const achados = new Set();
  for (const m of texto.matchAll(/blingProxy\(\s*\w+\s*,\s*([^,)]+)/g)) {
    let e = m[1].trim();
    if (e === 'endpoint') continue;                                   // a definição da própria função
    if (e === 'modelo') { for (const x of MODELOS) achados.add(x); continue; }
    if (e.startsWith('`${modelo}')) { for (const x of MODELOS) achados.add(`${x}/1`); continue; }
    e = e.replace(/^(['`"])(.*?)\1\s*\+\s*[\w.]+$/, (_, __, base) => base + '1')   // 'a/' + id
      .replace(/^`(.*)`$/, (_, t) => t.replace(/\$\{[^}]+\}/g, '1'))                 // `a/${id}`
      .replace(/^(['"])(.*)\1$/, '$2');                                                // 'a'
    achados.add(e);
  }
  return achados;
}

test('os endpoints que os robôs mandam ao bling-proxy são os do arquivo que a API confere', () => {
  const lidos = new Set();
  for (const f of arquivos) for (const e of endpointsDe(readFileSync(f, 'utf8'))) lidos.add(e);
  const esperado = JSON.parse(readFileSync(FIXTURE, 'utf8'));
  assert.deepEqual([...lidos].sort(), [...esperado].sort(),
    'endpoint novo (ou tirado) nos robôs: atualize __fixtures__/endpoints-do-bling-proxy.json e confira a lista da API');
});
