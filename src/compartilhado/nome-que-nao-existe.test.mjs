import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative } from 'node:path'
import { scriptDoVue, chamadasSemDono } from './guarda-de-imports.mjs'

/* ⚠️⚠️ NOME CHAMADO QUE NÃO EXISTE EM LUGAR NENHUM.
 *
 * 09/09/2026: a tela de redes sociais chamou `escHtml(...)`, que não é exportado
 * por módulo nenhum — mora dentro do `tela-de-admin.vue`. `ReferenceError` no meio
 * do desenho: a tela parava ali e da seção Meta Ads para baixo TUDO ficava zerado.
 *
 * O build passou. Os 4592 testes passaram. O `guarda-de-imports` não pegou, porque
 * ele parte dos nomes EXPORTADOS por vizinhos e cobra o import — `escHtml` não é
 * exportado por ninguém. Quem descobriu foi o dono abrindo a tela, pela TERCEIRA
 * vez naquele dia. Este teste existe para que não haja quarta.
 *
 * ⚠️ BASE CONGELADA, DE PROPÓSITO. A leitura é por expressão regular, não por
 * analisador de verdade: texto em português dentro de crase e aspas desbalanceadas
 * fazem o recorte engolir código, e alguns nomes legítimos aparecem aqui
 * (`_acProvisionar` ESTÁ declarado, na linha 1885 do arquivo dele). Acusá-los seria
 * ensinar todo mundo a ignorar o guarda — o defeito que esta casa chama de alarme
 * falso. Então a base de hoje é aceita e o guarda falha em QUALQUER NOME NOVO.
 *
 * ⚠️ AO TROCAR ISTO POR UM ANALISADOR DE VERDADE, a base sai junto.
 *
 * MEXEU numa tela e o teste acusou um nome? Confira se ele existe. Se existir e for
 * limitação da leitura, acrescente à base COM MOTIVO escrito — nunca calado.
 */

const AQUI = dirname(fileURLToPath(import.meta.url))
const SRC = dirname(AQUI)

// A base medida em 09/09/2026, tela a tela. Tudo aqui é limitação do leitor por
// expressão regular, e não defeito — conferido um a um.
const BASE = {
  'ferramentas/acessos/tela-de-acessos.vue':
    ['_acProvisionar', '_acRenderAuditoria', '_acRenderGeral', '_acTermoRow', 'badgeMuitas', 'ela', 'item', 'setText'],
  'ferramentas/admin/tela-de-admin.vue': ['B', 'Option', '_setGubAvatar', 'dia_'],
  'ferramentas/analise-campanhas/tela-de-analise-campanhas.vue': ['_gtConfirm'],
  'ferramentas/analise-vendas/tela-de-analise-vendas.vue': ['B', 'Chart', 'afterDatasetsDraw'],
  'ferramentas/gestao-a-vista/tela-de-gestao-a-vista.vue': ['B'],
  'ferramentas/noticias/tela-de-noticias.vue': ['_gcMarkdown'],
  'ferramentas/redes-sociais/tela-de-redes-sociais.vue': ['B'],
}

function todasAsTelas(pasta, achadas = []) {
  for (const f of readdirSync(pasta)) {
    const caminho = join(pasta, f)
    if (statSync(caminho).isDirectory()) todasAsTelas(caminho, achadas)
    else if (f.endsWith('.vue')) achadas.push(caminho)
  }
  return achadas
}

const TELAS = todasAsTelas(SRC)

test('há tela para guardar — o guarda não pode passar por estar vazio', () => {
  assert.ok(TELAS.length >= 60, `esperava ao menos 60 telas, achei ${TELAS.length}`)
})

for (const caminho of TELAS) {
  const rel = relative(SRC, caminho)
  test(`${rel} não chama nome que não existe`, () => {
    const achados = chamadasSemDono(scriptDoVue(readFileSync(caminho, 'utf8')))
    const conhecidos = new Set(BASE[rel] || [])
    const novos = achados.filter((n) => !conhecidos.has(n))
    assert.deepEqual(
      novos, [],
      `${rel} chama estes nomes e eles não existem em lugar nenhum — a tela lança `
      + 'ReferenceError e para de desenhar no meio, e NEM O BUILD NEM OS TESTES pegam. '
      + 'Se o nome existir e for limitação da leitura, acrescente à BASE com motivo.',
    )
  })
}

test('⚠️ o detector pega mesmo — provado com o caso real de 09/09/2026', () => {
  /* Guarda que ninguém prova é guarda que se descobre quebrado no dia em que
   * precisava funcionar. Aqui a chamada quebrada é injetada e cobrada. */
  const tela = readFileSync(join(SRC, 'ferramentas/redes-sociais/tela-de-redes-sociais.vue'), 'utf8')
  const quebrada = tela.replace('<script setup>', '<script setup>\nconst _x = escHtml("oi")')
  assert.ok(chamadasSemDono(scriptDoVue(quebrada)).includes('escHtml'),
    'o detector deixou passar o `escHtml` — foi ele que zerou a tela')
})

test('⚠️ a base não vira depósito: toda tela citada existe', () => {
  /* Base com arquivo que já foi apagado esconde nome que ninguém mais confere. */
  const existentes = new Set(TELAS.map((c) => relative(SRC, c)))
  for (const rel of Object.keys(BASE)) {
    assert.ok(existentes.has(rel), `a base cita ${rel}, que não existe mais — tire de lá`)
  }
})
