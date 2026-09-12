import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  ACOES_MATRIZ, ferramentaDaChave, agruparRecursos, estadoDaSelecao, marcarTudo,
} from './agrupar-permissoes.js'

// Importar o catálogo real NÃO dá: controle-de-login-e-usuario.js puxa Vue +
// Supabase e explode em Node com "window is not defined". Então a cópia abaixo
// existe só para os casos de teste — e o teste "a cópia deste teste ainda bate
// com o catálogo real" (no fim do arquivo) lê o array direto do fonte e falha
// se os dois divergirem. Sem esse guarda, a cópia seria um segundo catálogo
// silenciosamente desatualizado.

const RECURSOS = [
  { key: 'social', label: 'Redes Sociais — Dashboard', acoes: ['ver'] },
  { key: 'social.relatorio', label: 'Redes Sociais — Relatório Interativo', acoes: ['ver', 'exportar'] },
  { key: 'sales.gestao', label: 'Gestão à Vista', acoes: ['ver'] },
  { key: 'sales.analise', label: 'Análise de Vendas', acoes: ['ver'] },
  { key: 'meta.campanha', label: 'Análise de Campanhas', acoes: ['ver'] },
  { key: 'meta.gestor', label: 'Gestão de Tráfego', acoes: ['ver', 'editar'] },
  { key: 'meta.fabrica', label: 'Fábrica de Anúncios', acoes: ['ver', 'editar'] },
  { key: 'banco', label: 'Banco de Arquivos', acoes: ['ver', 'criar', 'excluir'] },
  { key: 'acessos', label: 'Colaboradores e Acessos', acoes: ['ver', 'criar', 'editar', 'excluir'] },
  { key: 'patrimonio', label: 'Patrimônio', acoes: ['ver', 'criar', 'editar', 'excluir'] },
  { key: 'patrimonio.relatorios', label: 'Patrimônio — Relatórios', acoes: ['ver', 'exportar'] },
  { key: 'frota', label: 'Frota', acoes: ['ver', 'criar', 'editar', 'excluir'] },
  { key: 'frota.relatorios', label: 'Frota — Relatórios', acoes: ['ver', 'exportar'] },
  { key: 'frota.aprovar', label: 'Aprovar requisição de veículo', acoes: ['ver'] },
  { key: 'autenticidade', label: 'Autenticidade e Garantia', acoes: ['ver', 'criar', 'editar'] },
  { key: 'noticias', label: 'Portal de Notícias', acoes: ['ver'] },
  { key: 'gestor', label: 'Gestão Comercial (IA)', acoes: ['ver'] },
  { key: 'gestor.relatorios', label: 'Relatórios Comerciais', acoes: ['ver', 'exportar'] },
  { key: 'claude.status', label: 'Painel de Status da IA', acoes: ['ver'] },
  { key: 'conteudo', label: 'Redes Sociais — Central de Conteúdo', acoes: ['ver', 'criar', 'editar', 'excluir'] },
  { key: 'conteudo.aprovar', label: 'Redes Sociais — Aprovar peças', acoes: ['ver'] },
]

const TREE = [
  { key: 'social', label: 'Redes Sociais', children: [] },
  { key: 'sales', label: 'Dashboard de Vendas', children: [] },
  { key: 'meta', label: 'Meta Ads', children: [] },
  { key: 'banco', label: 'Banco de Arquivos', children: [] },
  { key: 'noticias', label: 'Portal de Notícias', children: [] },
  { key: 'gestor', label: 'Gestão Comercial (IA)', children: [] },
  { key: 'gestao-interna', label: 'Gestão Interna', children: [
    { key: 'acessos', label: 'Colaboradores e Acessos' },
    { key: 'patrimonio', label: 'Patrimônio' },
    { key: 'patrimonio.relatorios', label: 'Patrimônio — Relatórios' },
    { key: 'frota', label: 'Frota' },
    { key: 'frota.relatorios', label: 'Frota — Relatórios' },
    { key: 'frota.aprovar', label: 'Aprovar requisição de veículo' },
    { key: 'autenticidade', label: 'Autenticidade e Garantia' },
  ] },
  { key: 'claude.status', label: 'Painel de Status da IA', children: [] },
  { key: 'conteudo', label: 'Central de Conteúdo', children: [] },
]

test('ferramentaDaChave pega o trecho antes do primeiro ponto', () => {
  assert.equal(ferramentaDaChave('social'), 'social')
  assert.equal(ferramentaDaChave('social.relatorio'), 'social')
  assert.equal(ferramentaDaChave('claude.status'), 'claude')
})

test('agrupa o catálogo por ferramenta, na ordem do catálogo', () => {
  const g = agruparRecursos(RECURSOS, TREE)
  assert.deepEqual(g.map((x) => x.key), ['social', 'sales', 'meta', 'banco', 'gestao-interna', 'noticias', 'gestor', 'claude', 'conteudo'])
  assert.deepEqual(g[0].recursos.map((r) => r.key), ['social', 'social.relatorio'])
  assert.deepEqual(g[1].recursos.map((r) => r.key), ['sales.gestao', 'sales.analise'])
  assert.deepEqual(g[2].recursos.map((r) => r.key), ['meta.campanha', 'meta.gestor', 'meta.fabrica'])
  // Achado pela CHAVE, não pela posição: recurso novo inserido antes de 'gestor'
  // deslocava o índice e quebrava este teste por um motivo que não é o dele.
  assert.deepEqual(g.find((x) => x.key === 'gestor').recursos.map((r) => r.key), ['gestor', 'gestor.relatorios'])
})

test('nenhum recurso do catálogo se perde no agrupamento', () => {
  const g = agruparRecursos(RECURSOS, TREE)
  const chaves = g.flatMap((x) => x.recursos.map((r) => r.key))
  assert.equal(chaves.length, RECURSOS.length)
  assert.deepEqual([...chaves].sort(), RECURSOS.map((r) => r.key).sort())
})

test('rótulo do grupo vem da árvore; ferramenta desconhecida com 1 recurso usa o rótulo do recurso', () => {
  const g = agruparRecursos(RECURSOS, TREE)
  const porKey = Object.fromEntries(g.map((x) => [x.key, x.label]))
  assert.equal(porKey.social, 'Redes Sociais')
  assert.equal(porKey.meta, 'Meta Ads')
  assert.equal(porKey['gestao-interna'], 'Gestão Interna')
  // 'claude' não existe na árvore (lá a chave é 'claude.status')
  assert.equal(porKey.claude, 'Painel de Status da IA')
})

test('rótulo cai na própria chave quando a árvore não conhece e o grupo tem 2+', () => {
  const g = agruparRecursos([
    { key: 'x.a', label: 'A', acoes: ['ver'] },
    { key: 'x.b', label: 'B', acoes: ['ver'] },
  ], [])
  assert.equal(g[0].label, 'x')
})

test('a matriz cobre todas as ações que o catálogo usa', () => {
  const usadas = new Set(RECURSOS.flatMap((r) => r.acoes))
  for (const a of usadas) assert.ok(ACOES_MATRIZ.includes(a), `ação "${a}" não tem coluna na matriz`)
})

test('estado da seleção: vazio / parcial / cheio', () => {
  const grupo = agruparRecursos(RECURSOS, TREE).find((g) => g.key === 'meta')
  assert.equal(estadoDaSelecao(grupo.recursos, {}), 'vazio')
  assert.equal(estadoDaSelecao(grupo.recursos, { 'meta.gestor': ['ver'] }), 'parcial')
  assert.equal(estadoDaSelecao(grupo.recursos, {
    'meta.campanha': ['ver', 'exportar'], 'meta.gestor': ['ver', 'editar'], 'meta.fabrica': ['ver', 'editar'],
  }), 'cheio')
})

test('estado da seleção ignora ação gravada que saiu do catálogo', () => {
  const recursos = [{ key: 'noticias', label: 'Portal de Notícias', acoes: ['ver'] }]
  // 'publicar' não existe no catálogo: não pode impedir o grupo de ficar 'cheio'
  assert.equal(estadoDaSelecao(recursos, { noticias: ['ver', 'publicar'] }), 'cheio')
})

test('estado global: catálogo inteiro cheio quando tudo marcado', () => {
  const tudo = marcarTudo({}, RECURSOS, true)
  assert.equal(estadoDaSelecao(RECURSOS, tudo), 'cheio')
  assert.equal(estadoDaSelecao(RECURSOS, marcarTudo(tudo, RECURSOS, false)), 'vazio')
})

test('marcarTudo liga todas as ações na ordem do catálogo', () => {
  const p = marcarTudo({}, [RECURSOS.find((r) => r.key === 'acessos')], true)
  assert.deepEqual(p.acessos, ['ver', 'criar', 'editar', 'excluir'])
})

test('marcarTudo desligado APAGA a chave (não deixa array vazio)', () => {
  const p = marcarTudo({ acessos: ['ver', 'criar'] }, [RECURSOS.find((r) => r.key === 'acessos')], false)
  assert.equal('acessos' in p, false)
})

test('marcarTudo não muta a entrada e preserva chaves de fora da lista', () => {
  const antes = { banco: ['ver'], noticias: ['ver'] }
  const copia = JSON.parse(JSON.stringify(antes))
  const p = marcarTudo(antes, [RECURSOS.find((r) => r.key === 'banco')], true)
  assert.deepEqual(antes, copia, 'entrada foi mutada')
  assert.deepEqual(p.noticias, ['ver'], 'chave de fora da lista se perdeu')
  assert.deepEqual(p.banco, ['ver', 'criar', 'excluir'])
})

// Lê `export const RECURSOS = [...]` como TEXTO do fonte real e extrai as
// chaves/ações por regex — é o jeito de conferir o catálogo de verdade sem
// carregar a cadeia Vue/Supabase (que explodiria em Node). Sem eval de
// propósito: o fonte é do repo, mas executar arquivo como código dentro do
// teste é hábito ruim de qualquer forma.
function catalogoReal() {
  const fonte = readFileSync(new URL('../../compartilhado/controle-de-login-e-usuario.js', import.meta.url), 'utf8')
  const ini = fonte.indexOf('export const RECURSOS = [')
  assert.notEqual(ini, -1, 'não achei "export const RECURSOS = [" no fonte — renomearam?')
  const fim = fonte.indexOf('\n]', ini)
  assert.notEqual(fim, -1, 'não achei o fim do array RECURSOS')
  const bloco = fonte.slice(ini, fim)
  const itens = [...bloco.matchAll(/key:\s*'([^']+)'[\s\S]*?acoes:\s*\[([^\]]*)\]/g)]
  assert.ok(itens.length > 0, 'não consegui extrair nenhum recurso do catálogo')
  return itens.map((m) => ({
    key: m[1],
    acoes: [...m[2].matchAll(/'([^']+)'/g)].map((a) => a[1]),
  }))
}

test('a cópia deste teste ainda bate com o catálogo real', () => {
  const real = catalogoReal()
  assert.deepEqual(
    real.map((r) => ({ key: r.key, acoes: r.acoes })),
    RECURSOS.map((r) => ({ key: r.key, acoes: r.acoes })),
    'RECURSOS mudou em controle-de-login-e-usuario.js — atualize a cópia deste teste',
  )
})

test('toda ação do catálogo real tem coluna na matriz', () => {
  for (const r of catalogoReal()) {
    for (const a of r.acoes) assert.ok(ACOES_MATRIZ.includes(a), `ação "${a}" (${r.key}) não tem coluna na matriz`)
  }
})

test('marcar tudo de um grupo não vaza para outro grupo', () => {
  const grupos = agruparRecursos(RECURSOS, TREE)
  const meta = grupos.find((g) => g.key === 'meta')
  const p = marcarTudo({}, meta.recursos, true)
  assert.equal(estadoDaSelecao(grupos.find((g) => g.key === 'sales').recursos, p), 'vazio')
  assert.equal(estadoDaSelecao(meta.recursos, p), 'cheio')
})

/* ── Agrupamento explícito pela árvore ────────────────────────────────────────
   Acessos e Patrimônio são submódulos de Gestão Interna, mas as chaves deles NÃO
   têm o prefixo 'gestao-interna.' — renomear quebraria is_acessos_admin() e o
   acessos-proxy, que procuram a string 'acessos' dentro de features. Então a
   árvore declara os filhos e o agrupador honra essa declaração, caindo na
   derivação por prefixo para todo o resto. */

test('filho declarado na árvore cai no grupo do pai, mesmo sem prefixo na chave', () => {
  const g = agruparRecursos(RECURSOS, TREE)
  const gi = g.find((x) => x.key === 'gestao-interna')
  assert.ok(gi, 'esperava um grupo gestao-interna')
  assert.deepEqual(gi.recursos.map((r) => r.key),
    ['acessos', 'patrimonio', 'patrimonio.relatorios', 'frota', 'frota.relatorios', 'frota.aprovar', 'autenticidade'])
  assert.equal(gi.label, 'Gestão Interna')
})

test('quem não está declarado continua agrupando pelo prefixo', () => {
  const g = agruparRecursos(RECURSOS, TREE)
  // sales.gestao não está nos children de 'sales' na árvore (ela tem
  // `children: []`), e mesmo assim cai lá pelo prefixo. O exemplo era
  // sales.metas, que saiu do catálogo em 13/08 — a regra testada é a mesma.
  assert.ok(g.find((x) => x.key === 'sales').recursos.some((r) => r.key === 'sales.gestao'))
  // claude.status é nó próprio, sem filhos: continua virando o grupo 'claude'
  assert.ok(g.find((x) => x.key === 'claude'))
})

test('marcar tudo do grupo pega TODOS os submódulos de uma vez', () => {
  const g = agruparRecursos(RECURSOS, TREE)
  const gi = g.find((x) => x.key === 'gestao-interna')
  const p = marcarTudo({}, gi.recursos, true)
  assert.deepEqual(Object.keys(p).sort(),
    ['acessos', 'autenticidade', 'frota', 'frota.aprovar', 'frota.relatorios', 'patrimonio', 'patrimonio.relatorios'])
  assert.equal(estadoDaSelecao(gi.recursos, p), 'cheio')
  assert.equal(estadoDaSelecao(gi.recursos, {}), 'vazio')
  assert.equal(estadoDaSelecao(gi.recursos, { acessos: ['ver'] }), 'parcial')
})

test('filho declarado que não existe no catálogo não inventa grupo vazio', () => {
  const treeComFantasma = [{ key: 'x', label: 'X', children: [{ key: 'nao-existe' }] }]
  const g = agruparRecursos(RECURSOS, treeComFantasma)
  assert.ok(!g.some((x) => x.key === 'x'))
})
