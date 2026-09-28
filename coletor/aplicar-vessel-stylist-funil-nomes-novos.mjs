// APLICA e REGISTRA a troca de nomes do funil do Stylist Circle, numa transação só.
//   node coletor/aplicar-vessel-stylist-funil-nomes-novos.mjs           → ensaio (desfaz)
//   node coletor/aplicar-vessel-stylist-funil-nomes-novos.mjs --gravar  → grava
// Prova: as contagens de stylists POR ID de etapa são idênticas antes e depois,
// a ordem não muda, a prospectada continua a mesma linha, e os nomes finais são
// exatamente os do dono.
import './lib/carregar-env.mjs'
import { readFileSync } from 'node:fs'
import pg from 'pg'

const ARQUIVO = '2026-09-28-vessel-stylist-funil-nomes-novos.sql'
const GRAVAR = process.argv.includes('--gravar')
const ESPERADO = ['Stylist levantado', 'Validado', 'Conversa', 'Convidado', 'Confirmado', 'Presença', 'Ativada', 'Desclassificado']
const sql = readFileSync(new URL(`../db/migrations/${ARQUIVO}`, import.meta.url), 'utf8')
const FOTO = `select e.id::int, e.nome, e.ordem, e.tipo, e.conta_como_prospectada p, e.libera_private_edit l,
  (select count(*) from public.vessel_stylists s where s.etapa_id = e.id)::int n
  from public.vessel_stylist_etapas e where e.ativa order by e.ordem`
const falhas = []
const conferir = (ok, frase, d) => { console.log(`${ok ? '  ✓' : '  ✗'} ${frase}${ok ? '' : '  → ' + JSON.stringify(d)}`); if (!ok) falhas.push(frase) }

const cli = new pg.Client({ connectionString: process.env.DATABASE_URL })
await cli.connect()
try {
  await cli.query('begin')
  await cli.query('lock table public.vessel_stylists in share mode')
  const ja = (await cli.query('select 1 from public.schema_migrations where name = $1', [ARQUIVO])).rowCount
  if (ja) throw new Error('já registrada')
  const antes = (await cli.query(FOTO)).rows
  console.table(antes)
  await cli.query(sql)
  await cli.query('insert into public.schema_migrations (name, observacao) values ($1, $2)',
    [ARQUIVO, 'renomeia 5 etapas do funil do Stylist Circle; Convidado fica (opção C do dono)'])
  const depois = (await cli.query(FOTO)).rows
  console.table(depois)
  const chave = (l) => l.map((x) => [x.id, x.ordem, x.tipo, x.p, x.l, x.n].join(':')).join('|')
  conferir(chave(antes) === chave(depois), 'mesmos ids, ordem, tipo, marcas e CONTAGEM por etapa', { antes: chave(antes), depois: chave(depois) })
  conferir(JSON.stringify(depois.map((x) => x.nome)) === JSON.stringify(ESPERADO), 'nomes finais = os do dono, na ordem', depois.map((x) => x.nome))
  conferir(depois.find((x) => x.p)?.nome === 'Conversa', 'a que conta como prospectada é a Conversa', depois.find((x) => x.p))
  const trilha = (await cli.query(`select count(*)::int n from public.vessel_stylist_etapas_trilha where por_nome = 'migration 2026-09-28'`)).rows[0].n
  conferir(trilha === 5, '5 linhas de renomear na trilha', trilha)
  if (falhas.length || !GRAVAR) {
    await cli.query('rollback')
    console.log(falhas.length ? `❌ nada gravado: ${falhas.length} falha(s)` : '✅ ensaio limpo, nada gravado. Rode com --gravar.')
    process.exitCode = falhas.length ? 1 : 0
  } else {
    const r = await cli.query('commit')
    if (r.command !== 'COMMIT') throw new Error('commit virou ' + r.command)
    console.log(`✅ ${ARQUIVO} aplicada e registrada.`)
  }
} catch (e) { await cli.query('rollback').catch(() => {}); console.error('❌', e.message); process.exitCode = 1 } finally { await cli.end() }
