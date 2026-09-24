// O CATÁLOGO É A ÚNICA LISTA — e estes testes reprovam quem escrever outra.
//
// O defeito que eles travam foi cobrado pelo dono duas vezes: "as permissões
// das ferramentas não estão sendo atualizadas conforme vai nascendo novas
// ferramentas". Ferramenta nova nascia com rota, com cartão no menu e às vezes
// com `hasPermission('x')` — e sem linha no editor de permissões, porque o
// editor lia uma lista e o resto do sistema lia outras.
//
// O que cada teste reprova, em português:
//   · rota do mapa-de-enderecos.js que o catálogo não conhece;
//   · rota que volta a escrever a própria permissão (`recurso:`) à mão;
//   · cartão de menu que não pergunte `podeAbrir('<rota do catálogo>')`, ou
//     que abra uma rota e pergunte por outra;
//   · `hasPermission('x')` com uma chave que o editor não mostra;
//   · chave do catálogo sem linha no editor, ou no cartão errado do editor;
//   · ferramenta sem caminho de clique a partir do Início;
//   · tela do Comercial Vessel com chave que a trava do banco não reconhece.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  FERRAMENTAS, GRUPOS, PORTAS, RECURSOS, PERMISSION_TREE, ROTAS_SEM_CHAVE,
  metaDaRota, ferramentaDaRota, chavesDaPorta, podeAbrirRota,
} from './catalogo-de-ferramentas.js'
import { agruparRecursos, ACOES_MATRIZ } from '../ferramentas/admin/agrupar-permissoes.js'
import { derivarFeatures } from './derivar-features.js'

const aqui = dirname(fileURLToPath(import.meta.url))
const SRC = join(aqui, '..')
const ler = (...p) => readFileSync(join(SRC, ...p), 'utf8')
const MAPA = ler('mapa-de-enderecos.js')

function arquivos(dir, fim) {
  const out = []
  for (const n of readdirSync(dir)) {
    const p = join(dir, n)
    if (statSync(p).isDirectory()) out.push(...arquivos(p, fim))
    else if (n.endsWith(fim)) out.push(p)
  }
  return out
}

// As rotas do mapa: { name, arquivo da tela }.
const ROTAS_DO_MAPA = [...MAPA.matchAll(/name: '([^']+)'(?:, component: \(\) => import\('\.\/([^']+)'\))?/g)]
  .map((m) => ({ nome: m[1], tela: m[2] || null }))
  // `redirect: { name: 'inicio' }` também casa o padrão — não é rota.
  .filter((r, i, todas) => todas.findIndex((x) => x.nome === r.nome) === i)
const NOMES_DAS_ROTAS = new Set(ROTAS_DO_MAPA.map((r) => r.nome))

// ── As rotas ────────────────────────────────────────────────────────────────

test('toda rota do mapa está no catálogo (tem chave, é porta, é de super-admin ou é livre com motivo)', () => {
  assert.ok(ROTAS_DO_MAPA.length >= 30, `achei só ${ROTAS_DO_MAPA.length} rotas — o leitor do mapa quebrou?`)
  const fora = ROTAS_DO_MAPA.filter((r) => metaDaRota(r.nome) === null).map((r) => r.nome)
  assert.deepEqual(fora, [],
    'rota fora do catálogo: ela nasce FECHADA para todo mundo e, pior, a ferramenta não aparece no editor '
    + 'de permissões. Registre em compartilhado/catalogo-de-ferramentas.js.')
})

test('nenhuma rota escreve a própria permissão à mão: o `meta` sai do catálogo', () => {
  assert.doesNotMatch(MAPA, /recurso\s*:/,
    'mapa-de-enderecos.js voltou a declarar `recurso:` numa rota — é a segunda lista que envelhece')
  assert.match(MAPA, /metaDaRota\(r\.name\)/, 'o roteador precisa pendurar o meta de cada rota via metaDaRota()')
})

test('toda rota e todo link que o catálogo cita existem de verdade', () => {
  for (const f of FERRAMENTAS) {
    for (const r of f.rotas || []) assert.ok(NOMES_DAS_ROTAS.has(r), `${f.key} cita a rota "${r}", que não existe no mapa`)
  }
  for (const p of PORTAS) assert.ok(NOMES_DAS_ROTAS.has(p.rota), `a porta "${p.rota}" não existe no mapa`)
  for (const nome of Object.keys(ROTAS_SEM_CHAVE)) assert.ok(NOMES_DAS_ROTAS.has(nome), `rota livre "${nome}" não existe`)
})

test('uma rota tem UM dono no catálogo', () => {
  const visto = new Map()
  for (const f of FERRAMENTAS) {
    for (const r of [...(f.rotas || []), ...(f.links || [])]) {
      assert.ok(!visto.has(r), `a rota "${r}" está em ${visto.get(r)} e em ${f.key}`)
      visto.set(r, f.key)
    }
  }
})

// ── Os cartões de menu ──────────────────────────────────────────────────────

const CLASSES_DE_CARTAO = ['home-card', 'smenu-card', 'cvmenu-card', 'gimenu-card']
const TELAS = arquivos(join(SRC, 'ferramentas'), '.vue')

// Toda tag de abertura de cartão de menu, com o arquivo e os atributos.
function cartoes() {
  const out = []
  for (const arq of TELAS) {
    // Folha de estilo e comentário não são cartão (o CSS do "Em breve" traz
    // um exemplo de <div class="smenu-card …"> dentro de um comentário).
    const fonte = readFileSync(arq, 'utf8').replace(/<style[\s\S]*?<\/style>/g, '').replace(/<!--[\s\S]*?-->/g, '')
    for (const m of fonte.matchAll(/<(div|a)\b([^>]*)>/g)) {
      const attrs = m[2]
      const classe = (attrs.match(/\bclass="([^"]*)"/) || [])[1] || ''
      if (!classe.split(/\s+/).some((c) => CLASSES_DE_CARTAO.includes(c))) continue
      const guarda = (attrs.match(/\bv-(?:if|show)="([^"]*)"/) || [])[1] ?? null
      const abre = (attrs.match(/@click="ir\('([^']+)'\)"/) || [])[1] ?? null
      out.push({ arquivo: arq.slice(SRC.length + 1), attrs: attrs.trim().slice(0, 120), guarda, abre })
    }
  }
  return out
}

test('todo cartão de menu pergunta podeAbrir(<rota do catálogo>) — a mesma regra do roteador', () => {
  const todos = cartoes()
  assert.ok(todos.length >= 25, `achei só ${todos.length} cartões — o leitor de cartões quebrou?`)
  const errados = []
  for (const c of todos) {
    if (c.guarda === 'false') continue // cartão desligado de propósito (Análise de Campanhas)
    const m = /^podeAbrir\('([^']+)'\)$/.exec(c.guarda || '')
    if (!m) { errados.push(`${c.arquivo}: guarda "${c.guarda}" em <${c.attrs}>`); continue }
    const alvo = m[1]
    const meta = metaDaRota(alvo)
    if (!meta) errados.push(`${c.arquivo}: podeAbrir('${alvo}') — "${alvo}" não está no catálogo`)
    else if (!meta.recurso && !meta.qualquerDe && !meta.superadmin) errados.push(`${c.arquivo}: '${alvo}' não pede chave nenhuma`)
    if (c.abre && c.abre !== alvo) errados.push(`${c.arquivo}: o cartão abre '${c.abre}' mas pergunta por '${alvo}'`)
  }
  assert.deepEqual(errados, [], 'cartão de menu com porteiro próprio: é a lista à mão que envelhece')
})

// ── As chaves usadas no código ──────────────────────────────────────────────

test('toda chave de hasPermission(...) no código tem linha no editor', () => {
  const controle = ler('compartilhado', 'controle-de-login-e-usuario.js')
  const blocoLegado = controle.slice(controle.indexOf('const _legado = {'), controle.indexOf('}', controle.indexOf('const _legado = {')))
  const legadas = new Set([...blocoLegado.matchAll(/'([^']+)':/g)].map((m) => m[1]))
  assert.ok(legadas.has('tool:social'), 'não consegui ler a ponte _legado')
  const conhecidas = new Set([...RECURSOS.map((r) => r.key), ...legadas, 'sales', 'meta'])
  const achadas = []
  for (const arq of [...TELAS, ...arquivos(SRC, '.js')]) {
    if (arq.endsWith('.test.mjs')) continue
    const fonte = readFileSync(arq, 'utf8').replace(/^\s*(\/\/|\*).*$/gm, '') // comentários não contam
    for (const m of fonte.matchAll(/hasPermission\(\s*'([^']+)'/g)) {
      if (!conhecidas.has(m[1])) achadas.push(`${arq.slice(SRC.length + 1)}: '${m[1]}'`)
    }
  }
  assert.deepEqual(achadas, [],
    'chave pedida no código e ausente do catálogo: ninguém consegue concedê-la pelo editor (foi o caso do Escritório 3D)')
})

// ── O editor de permissões ──────────────────────────────────────────────────

test('toda ferramenta do catálogo tem UMA linha no editor, no cartão certo', () => {
  const grupos = agruparRecursos(RECURSOS, PERMISSION_TREE)
  const onde = new Map()
  for (const g of grupos) for (const r of g.recursos) {
    assert.ok(!onde.has(r.key), `${r.key} aparece em dois cartões do editor`)
    onde.set(r.key, g.label)
  }
  for (const f of FERRAMENTAS) {
    const esperado = GRUPOS.find((g) => g.key === f.grupo)?.label
    assert.ok(esperado, `${f.key} diz morar no grupo "${f.grupo}", que não existe em GRUPOS`)
    assert.equal(onde.get(f.key), esperado, `${f.key} tinha de estar no cartão "${esperado}" do editor`)
  }
  assert.equal(onde.size, FERRAMENTAS.length)
})

test('todo cartão do editor tem pelo menos uma ferramenta, e toda chave é única', () => {
  for (const g of GRUPOS) assert.ok(FERRAMENTAS.some((f) => f.grupo === g.key), `o cartão "${g.label}" está vazio`)
  const chaves = FERRAMENTAS.map((f) => f.key)
  assert.equal(new Set(chaves).size, chaves.length, 'chave repetida no catálogo')
})

test('toda ação oferecida começa por ver e tem coluna na matriz', () => {
  for (const f of FERRAMENTAS) {
    assert.equal(f.acoes[0], 'ver', `${f.key}: recurso sem 'ver' não existe (é o contrato do editor)`)
    for (const a of f.acoes) assert.ok(ACOES_MATRIZ.includes(a), `${f.key}: ação "${a}" sem coluna`)
  }
})

// ── O caminho de clique ─────────────────────────────────────────────────────

test('toda ferramenta tem caminho de clique a partir do Início', () => {
  const noInicio = new Set([...ler('ferramentas', 'inicio', 'tela-de-inicio.vue').matchAll(/podeAbrir\('([^']+)'\)/g)].map((m) => m[1]))
  const alcancaveis = new Set(noInicio)
  for (const p of PORTAS) {
    if (!noInicio.has(p.rota)) continue
    const tela = ROTAS_DO_MAPA.find((r) => r.nome === p.rota)?.tela
    assert.ok(tela, `não achei a tela da porta "${p.rota}"`)
    for (const m of ler(tela).matchAll(/podeAbrir\('([^']+)'\)/g)) alcancaveis.add(m[1])
  }
  const semCaminho = []
  for (const f of FERRAMENTAS) {
    if (f.dentroDe) {
      const mae = FERRAMENTAS.find((x) => x.key === f.dentroDe)
      assert.ok(mae && (mae.rotas || mae.links), `${f.key}: dentroDe "${f.dentroDe}" não é uma ferramenta com tela`)
      continue
    }
    const portas = [...(f.rotas || []), ...(f.links || [])]
    assert.ok(portas.length, `${f.key} não tem rota, link nem dentroDe — é uma chave que não guarda nada`)
    if (f.semCartao) continue // cartão desligado de propósito, com o motivo escrito no catálogo
    if (!portas.some((r) => alcancaveis.has(r))) semCaminho.push(f.key)
  }
  assert.deepEqual(semCaminho, [],
    'ferramenta concedida sem cartão que leve até ela: a pessoa lê "não tem acesso" com a permissão marcada')
})

test('porta abre para quem tem SÓ uma ferramenta de dentro, e não para quem não tem nenhuma', () => {
  for (const p of PORTAS) {
    for (const k of chavesDaPorta(p.rota)) {
      assert.equal(podeAbrirRota(p.rota, (x) => x === k), true, `quem tem só ${k} precisa ver a porta ${p.rota}`)
    }
    assert.equal(podeAbrirRota(p.rota, () => false), false)
  }
  // O caso que o Início errava: só a Fábrica, ou só um relatório do Meta.
  assert.equal(podeAbrirRota('meta-ads', (x) => x === 'meta.opr'), true)
  assert.equal(podeAbrirRota('meta-ads', (x) => x === 'meta.fabrica'), true)
})

test('rota fora do catálogo não abre para ninguém, nem para super-admin', () => {
  assert.equal(podeAbrirRota('tela-que-ninguem-registrou', () => true, true), false)
})

// ── O banco ────────────────────────────────────────────────────────────────

test('toda tela do Comercial Vessel tem chave que a trava do banco reconhece', () => {
  // `is_vessel_atendimentos()` e `_editar()` aceitam 'atendimentos' ou
  // 'atendimentos.<tela>' (migration de 24/09/2026). Chave com outro nome
  // abriria a tela e o banco recusaria tudo, calado.
  const sql = readFileSync(join(SRC, '..', 'db', 'migrations',
    '2026-09-24-permissoes-das-ferramentas-do-comercial-vessel.sql'), 'utf8')
  assert.match(sql, /function public\.is_vessel_atendimentos\(\)[\s\S]*'atendimentos\.'/)
  assert.match(sql, /function public\.is_vessel_atendimentos_editar\(\)[\s\S]*'atendimentos\.'/)
  const daFamilia = FERRAMENTAS.filter((f) => f.grupo === 'atendimentos' && f.key !== 'carrinho')
  assert.ok(daFamilia.length >= 6)
  for (const f of daFamilia) {
    assert.ok(f.key === 'atendimentos' || f.key.startsWith('atendimentos.'), `${f.key} não tem o prefixo da trava`)
    // O que o editor grava em features[] (lido pela trava de VER) leva o pai.
    assert.ok(derivarFeatures({ [f.key]: ['ver'] }).includes('atendimentos'), `${f.key} não leva 'atendimentos' para features[]`)
  }
  // E a pré-concessão só cita chaves que existem.
  const citadas = [...sql.matchAll(/'(atendimentos\.[a-z-]+)'/g)].map((m) => m[1])
  for (const k of citadas) assert.ok(FERRAMENTAS.some((f) => f.key === k), `a migration concede "${k}", que não existe`)
})

test('cada tela do Comercial Vessel pede a SUA chave para mexer', () => {
  const pares = [
    ['comercial-vessel/tela-de-private-edit.vue', 'atendimentos.private-edit'],
    ['comercial-vessel/tela-de-stylist-circle.vue', 'atendimentos.stylist-circle'],
    ['beauty-sessions/tela-de-beauty-sessions.vue', 'atendimentos.beauty-sessions'],
  ]
  for (const [tela, chave] of pares) {
    assert.match(ler('ferramentas', tela), new RegExp(`hasPermission\\('${chave.replace('.', '\\.')}', 'editar'\\)`), tela)
    assert.equal(ferramentaDaRota(ROTAS_DO_MAPA.find((r) => r.tela && r.tela.endsWith(tela))?.nome)?.key, chave, tela)
  }
})
