// O CONTRATO QUE O FRONT ESPERA DA API, EXTRAÍDO DO CÓDIGO (plano 02 da REVISAO-TESTES-2026-10, item A).
//
// Lê `src/` e `coletor/` (fora de testes, de `node_modules` e de `src/demonstracao/`, o banco de mentira)
// e junta, em ordem alfabética (saída estável):
//   - `tabelas`: a tabela `ROTAS` de banco-pela-api.js (tabela → rota, filtros, ordens, escritas);
//   - `usos`: o que o código CHAMA — tabelas (supabase-js, `sb(…)`, `adFetch(…)`, REST cru), RPCs, edges e
//     caminhos diretos da API (`pedir('GET', '/x')`).
// O teste Go (`api/internal/web/contrato_front_test.go`) confronta esse JSON com o roteador de verdade
// (`chi.Walk`), com o registro de RPC e com os filtros/ordens que cada rota declara. O JSON fica
// versionado em `api/internal/web/testdata/contrato_front.json`; o teste `extrair-contrato-front.test.mjs`
// reprova se ele ficar velho, e é assim que uma chamada nova no front chega ao teste Go.
//
// ⚠️ É EXTRAÇÃO POR TEXTO: acha o que está escrito com nome literal. Chamada com nome montado em variável
// ou template (`rpc(nome)`, `sb(\`${t}?…\`)`) NÃO aparece, e o que não aparece não é verificado — as
// ressalvas (`dinamicas`) listam onde isso acontece para ninguém achar que a cobertura é total.
//
//   node src/compartilhado/extrair-contrato-front.mjs            # grava o JSON
//   node src/compartilhado/extrair-contrato-front.mjs --stdout   # só imprime

import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, relative, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
export const ARQUIVO_JSON = join(RAIZ, 'api/internal/web/testdata/contrato_front.json')

// a própria ponte (cita `sb('t?…')` e `/rpc/` em comentário e monta tudo por variável): é o que se confere, não o conferido
const INFRA = new Set(['api.js', 'banco-pela-api.js', 'extrair-contrato-front.mjs'])

function arquivosDoFront() {
  const achados = []
  const anda = (dir) => {
    for (const n of readdirSync(dir)) {
      if (n === 'node_modules' || n === 'demonstracao' || n.startsWith('.')) continue
      const p = join(dir, n)
      if (statSync(p).isDirectory()) anda(p)
      else if (/\.(js|mjs|vue)$/.test(n) && !/\.test\.m?js$/.test(n) && !INFRA.has(n)) achados.push(p)
    }
  }
  anda(join(RAIZ, 'src'))
  anda(join(RAIZ, 'coletor'))
  return achados.sort()
}

const ordenado = (o) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
const unicos = (xs) => [...new Set(xs)].sort()

// o valor que as funções de `ROTAS` recebem no lugar de um id/chave: vira `{}` no caminho
const PARAM = 'PARAM'

/** `/x/${id}/y` → `/x/{}/y` (o roteador também compara só a forma). */
function formaDoCaminho(c) {
  return c.replace(/\$\{[^}]*\}/g, '{}').replace(new RegExp(`/${PARAM}(?=/|$)`, 'g'), '/{}').replace(/[?#].*$/, '')
}

export async function extrair() {
  const { ROTAS, TETO_DE_LINHAS } = await import('./banco-pela-api.js')
  // a tabela ROTAS como dado: as funções (`upsert`, `apagarPor`) rodam com uma linha de mentira, em que
  // toda coluna vale 'PARAM', só para saber QUAL método e caminho elas pedem
  const linha = new Proxy({}, { get: () => PARAM })
  const tabelas = {}
  for (const [tabela, d] of Object.entries(ROTAS)) {
    const escritas = []
    if (d.upsert) {
      for (const c of [].concat(d.upsert([linha]))) escritas.push({ metodo: c.metodo, caminho: formaDoCaminho(c.caminho) })
    }
    for (const f of Object.values(d.apagarPor || {})) {
      const c = f(PARAM)
      escritas.push({ metodo: c.metodo, caminho: formaDoCaminho(c.caminho) })
    }
    const params = new Set()
    for (const ops of Object.values(d.filtros || {})) {
      for (const alvo of Object.values(ops)) params.add(Array.isArray(alvo) ? alvo[0] : alvo)
    }
    // `ou` (o `.or(...)` da tela) traduz para parâmetros próprios da rota
    if (d.ou) {
      try { Object.keys(d.ou('and(data_da_venda.gte.2026-01-01,data_da_venda.lte.2026-01-31),and(data_pedido.gte.2026-01-01,data_pedido.lte.2026-01-31)')).forEach((k) => params.add(k)) } catch { /* sem exemplo */ }
    }
    tabelas[tabela] = {
      area: d.area,
      rota: d.rota,
      params: [...params].sort(),
      ordens: [...(d.ordens || [])].sort(),
      ordemFixa: !!d.ordemFixa,
      linhaUnica: !!d.linhaUnica,
      chave: d.chave || 'id',
      paginaAteOLimite: !!d.paginaAteOLimite,
      escritas,
    }
  }

  const usos = { tabelas: {}, rpcs: {}, edges: {}, caminhos: {}, dinamicas: {} }
  const marca = (grupo, nome, arq, extra) => {
    const g = (usos[grupo][nome] ??= { arquivos: [] })
    g.arquivos = unicos([...g.arquivos, arq])
    if (extra) g.escreve = unicos([...(g.escreve || []), extra])
  }

  for (const caminho of arquivosDoFront()) {
    const arq = relative(RAIZ, caminho)
    const t = readFileSync(caminho, 'utf8')
    const doColetor = arq.startsWith('coletor/')

    // ── tabelas (nome literal) ──
    for (const m of t.matchAll(/(?<!storage)(?<!storageNaArea\([^)]*\))\.from\(\s*(['"`])([a-z][a-z0-9_]*)\1\s*\)/g)) {
      // o encadeado do supabase-js: a escrita é o primeiro `.insert/.update/.upsert/.delete` logo depois
      const resto = t.slice(m.index + m[0].length, m.index + m[0].length + 400)
      const e = /^\s*(?:\/\/[^\n]*\n\s*)*\.(select|insert|update|upsert|delete)\(/.exec(resto)
      marca('tabelas', m[2], arq, e && e[1] !== 'select' ? e[1] : null)
    }
    for (const m of t.matchAll(/\b(?:sb|adFetch|fetchPostgrest)\(\s*(['"`])([a-z][a-z0-9_]*)(?:\?[^'"`]*)?\1/g)) {
      const resto = t.slice(m.index, m.index + 300)
      const e = /method:\s*['"](POST|PATCH|DELETE|PUT)['"]/.exec(resto)
      marca('tabelas', m[2], arq, e ? { POST: 'insert', PATCH: 'update', DELETE: 'delete', PUT: 'upsert' }[e[1]] : null)
    }
    for (const m of t.matchAll(/rest\/v1\/([a-z][a-z0-9_]*)(?=[?'"`\s])/g)) if (m[1] !== 'rpc') marca('tabelas', m[1], arq)
    // ── RPC (nome literal) ──
    for (const m of t.matchAll(/(?:\.rpc|\brpc|\bchamar|\.chamar)\(\s*(['"`])([a-z][a-z0-9_]*)\1/g)) {
      if (/^[a-z]+_[a-z_]+$/.test(m[2])) marca('rpcs', m[2], arq)
    }
    for (const m of t.matchAll(/\brpcNaArea\(\s*['"][a-z-]+['"]\s*,\s*[\w.]+\s*,\s*(['"`])([a-z][a-z0-9_]*)\1/g)) marca('rpcs', m[2], arq)
    for (const m of t.matchAll(/rest\/v1\/rpc\/([a-z][a-z0-9_]*)/g)) marca('rpcs', m[1], arq)
    // ── edges (nome literal) ──
    for (const m of t.matchAll(/functions\.invoke\(\s*(['"`])([a-z][a-z0-9_-]*)\1/g)) marca('edges', m[2], arq)
    for (const m of t.matchAll(/\binvocarNaArea\(\s*['"][a-z-]+['"]\s*,\s*[\w.]+\s*,\s*(['"`])([a-z][a-z0-9_-]*)\1/g)) marca('edges', m[2], arq)
    for (const m of t.matchAll(/\b(?:invocar|corpoDaEdge|edge)\(\s*(['"`])([a-z][a-z0-9_-]*)\1/g)) marca('edges', m[2], arq)
    // `fetchDaApi('/meta-proxy', …)`: o método vem no init; as edges portadas são todas POST, mas o teste só exige a rota
    for (const m of t.matchAll(/\bfetchDaApi\(\s*(['"`])\/([a-z][a-z0-9_/-]*)\1/g)) marca('edges', m[2], arq)
    for (const m of t.matchAll(/functions\/v1\/([a-z][a-z0-9_-]*)/g)) marca('edges', m[1], arq)
    // ── caminhos diretos da API ──
    for (const m of t.matchAll(/\b(pedir|chamar)\(\s*(['"])(GET|POST|PUT|PATCH|DELETE)\2\s*,\s*(['"`])(\/[^'"`]*)\4/g)) {
      marca('caminhos', `${m[3]} ${formaDoCaminho(m[5])}`, arq)
    }
    for (const m of t.matchAll(/\blerDaApi\(\s*(['"`])(\/[^'"`]*)\1/g)) marca('caminhos', `GET ${formaDoCaminho(m[2])}`, arq)
    for (const m of t.matchAll(/\bescreverComposto\(\s*(['"`])(\/[^'"`]*)\1/g)) marca('caminhos', `POST ${formaDoCaminho(m[2])}`, arq)
    // ── o que a extração NÃO enxerga ──
    for (const m of t.matchAll(/\.rpc\(\s*(?!['"`])([^,)\s][^,)]*)/g)) if (!doColetor) marca('dinamicas', `rpc(${m[1].slice(0, 30)})`, arq)
    for (const m of t.matchAll(/\b(?:sb|adFetch)\(\s*`\$\{/g)) marca('dinamicas', 'sb(`${…}`)', arq)
  }

  return {
    tetoDeLinhas: TETO_DE_LINHAS,
    tabelas: ordenado(tabelas),
    usos: Object.fromEntries(Object.entries(usos).map(([k, v]) => [k, ordenado(v)])),
  }
}

export const comoTexto = (obj) => JSON.stringify(obj, null, 1) + '\n'

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const texto = comoTexto(await extrair())
  if (process.argv.includes('--stdout')) process.stdout.write(texto)
  else { writeFileSync(ARQUIVO_JSON, texto); console.log(`gravado: ${relative(RAIZ, ARQUIVO_JSON)} (${texto.length} bytes)`) }
}
