// LEMBRETE (B13, 25/09/2026): função de UMA tela do Comercial Vessel confere a
// chave DELA no banco — `public.vessel_pode('<chave da tela>', 'ver'|'editar')` —
// e não a trava da família (`is_vessel_atendimentos()` / `_editar()`), que
// aceita qualquer tela. Com a família, quem tinha só o Material Gráfico lia o
// histórico de contato das parceiras chamando o PostgREST por fora da Central.
//
// ⚠️ ISTO É LEMBRETE, NÃO PORTÃO. É uma leitura de TEXTO das migrations: pega o
// descuido honesto (copiar uma função irmã antiga que ainda tinha a família),
// não quem quer burlar. Escapa, por exemplo: a trava escrita por concatenação
// (`execute 'select is_vessel_' || …`), uma função recriada à mão no painel do
// Supabase sem migration, ou uma migration com nome fora do padrão de data.
// O PORTÃO DE VERDADE mora no banco: o `if not public.vessel_pode(...)` que é a
// primeira linha de cada função, provado chamando as 49 como 13 perfis de
// mentira em `coletor/aplicar-vessel-permissao-por-tela-no-banco.mjs`. Se um
// dia esse `if` sumir de uma função, a tela vira a última linha — e a tela
// esconde botões, não fecha a porta.
//
// O QUE É PERMITIDO (enumerado, não proibido): a família numa migration nova só
// passa com o marcador `-- familia: <motivo>` na MESMA linha — para as quatro
// políticas da base comum (vessel_pessoas/atendimentos/pedidos/pedido_itens) e
// o convite público, que são de propósito de qualquer tela. O custo é esse
// alarme falso deliberado: quem precisar da família escreve o porquê ali, e o
// porquê fica no diff para a revisão.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { FERRAMENTAS } from '../src/compartilhado/catalogo-de-ferramentas.js'

const PASTA = new URL('./migrations/', import.meta.url)
const DESDE = '2026-09-25-vessel-permissao-por-tela-no-banco.sql'
const migrations = readdirSync(PASTA).filter((f) => /^\d{4}-\d{2}-\d{2}-.*\.sql$/.test(f)).sort()
const texto = (f) => readFileSync(new URL(f, PASTA), 'utf8')
// Tira comentário de linha, mas guarda o marcador `-- familia:` para conferir.
const semComentario = (linha) => linha.replace(/--.*$/, '')

test('a migration do B13 existe (é dela em diante que o lembrete vale)', () => {
  assert.ok(migrations.includes(DESDE), `falta db/migrations/${DESDE}`)
})

test('migration nova não usa a trava da FAMÍLIA do Comercial Vessel sem dizer por quê', () => {
  const ruins = []
  for (const f of migrations.filter((m) => m > DESDE)) {
    texto(f).split('\n').forEach((linha, i) => {
      if (/is_vessel_atendimentos(_editar)?\s*\(/.test(semComentario(linha)) && !/--\s*familia:\s*\S/.test(linha)) {
        ruins.push(`${f}:${i + 1}: ${linha.trim()}`)
      }
    })
  }
  assert.deepEqual(ruins, [], 'Use public.vessel_pode(\'<chave da tela>\', \'ver\'|\'editar\') — ou, se é base comum de propósito, '
    + 'marque a linha com `-- familia: <motivo>`. Ver PADRAO-DA-CENTRAL.md (9¾) e o cabeçalho deste teste.')
})

test('toda chave pedida a vessel_pode existe no catálogo, com o nível que ela oferece', () => {
  const doCatalogo = new Map(FERRAMENTAS.map((f) => [f.key, f.acoes]))
  const ruins = []
  for (const f of migrations.filter((m) => m >= DESDE)) {
    for (const [, chave, nivel] of texto(f).matchAll(/vessel_pode\(\s*'([^']+)'\s*,\s*'([^']+)'\s*\)/g)) {
      if (!doCatalogo.get(chave)?.includes(nivel)) ruins.push(`${f}: vessel_pode('${chave}', '${nivel}')`)
    }
  }
  assert.deepEqual(ruins, [], 'chave renomeada ou nível que o catálogo não oferece: a função fecharia para todo mundo')
})

test('a lista fechada de vessel_pode conhece todas as chaves do Comercial Vessel que chamam o banco', () => {
  // O Appointment Card é um link para o site: não chama nenhuma função daqui.
  const esperadas = FERRAMENTAS.filter((f) => f.grupo === 'atendimentos' && (f.key === 'atendimentos' || f.key.startsWith('atendimentos.'))
    && f.key !== 'atendimentos.appointment-card').map((f) => f.key).sort()
  // A ÚLTIMA migration que (re)cria vessel_pode é a que vale.
  const ultima = migrations.filter((f) => f >= DESDE && /function public\.vessel_pode\(/.test(texto(f))).pop()
  const m = ultima && texto(ultima).match(/p_ferramenta not in \(([^)]*)\)/)
  assert.ok(m, 'não achei a lista fechada de vessel_pode nas migrations')
  const naLista = [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]).sort()
  assert.deepEqual(naLista, esperadas,
    'tela nova do Comercial Vessel: acrescente a chave na lista de vessel_pode (numa migration nova, recriando a função)')
})
