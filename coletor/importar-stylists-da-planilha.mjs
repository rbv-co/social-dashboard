// SOBE A PLANILHA DE MAPEAMENTO DE STYLISTS PARA O STYLIST CIRCLE, na PRIMEIRA
// etapa do funil ("Identificado", desde o funil configurável de 24/09/2026).
//
//   node coletor/importar-stylists-da-planilha.mjs <planilha.xlsx>                      → ensaio: grava tudo e DESFAZ
//   node coletor/importar-stylists-da-planilha.mjs <planilha.xlsx> --gravar             → grava de verdade
//   … --relatorio <pasta>   → escreve a prévia (CSV) e o resumo (Markdown) nessa pasta
//   … --incluir-sem-contato → também sobe quem não tem WhatsApp NEM Instagram, marcada
//                             "sem contato ainda" (`sem_contato = true`)
//
// Pedido do dono em 24/09/2026: "tem uma planilha de mapeamento de stylist em
// downloads, vc consegue subir todas elas na base, na etapa prospectado (etapa
// inicial)? as que não tem whatsapp vc coloca o instagram". Corrigido por ele
// no mesmo dia: a primeira etapa é "Identificados" — e o funil virou
// configurável, com Identificado na frente de Prospectado.
//
// ⚠️ SEM DATA DA PROSPECÇÃO: ela nasce sozinha (gatilho do banco) no dia em
// que a parceira chegar na etapa marcada "conta como prospectada". A data da
// consolidação da planilha (16/09) vai só para a observação. Assim as 63 não
// entram em "prospectadas" no placar só por estarem numa lista.
//
// ⚠️ ENTRA PELA MESMA PORTA DA CENTRAL: cada linha é uma chamada a
// `vessel_stylist_criar`, com a trava de escrita LIGADA — um perfil de
// operação que só existe dentro desta transação (criado no começo, apagado
// antes do fim) e `request.jwt.claims` com o `sub` dele. Validação, telefone
// canônico e código STY-0000 são os do banco, não uma cópia deles aqui.
// Precisa de `2026-09-24-vessel-stylist-whatsapp-ou-instagram.sql` (a porta
// que aceita só o Instagram e recebe `p_observacoes`).
//
// ⚠️ O SCORE E O TIER DA PLANILHA NÃO SÃO A NOSSA QUALIFICAÇÃO — são de outra
// metodologia (a aba "Metodologia"). Vão só para `observacoes`, como texto,
// com o aviso escrito do lado. Nada disto escreve em tabela de qualificação.
//
// ⚠️ SEM CONTATO AINDA (decisão do dono, 24/09/2026): as linhas sem WhatsApp
// e sem Instagram ficavam de fora. Com `--incluir-sem-contato` elas entram
// pela MESMA porta, com `p_sem_contato => true` (precisa de
// `2026-09-24-vessel-stylist-sem-contato.sql`), para a Ionara completar. O que
// a planilha dizia do contato ("Não localizado publicamente", Facebook, handle
// não confirmado) vai para as observações. Sem a opção, continuam puladas.
//
// ⚠️ IDEMPOTENTE: quem já está na base (mesmo WhatsApp canônico, mesmo perfil
// de Instagram, ou mesmo nome+cidade) é pulada com o motivo. Rodar de novo
// depois do `--gravar` insere ZERO.
//
// ⚠️ COMO ACHAR (E DESFAZER) O QUE ESTE SCRIPT GRAVOU: toda linha nasce com
// `origem_contato = 'pesquisa'` e `observacoes` começando por MARCA (abaixo).
//
// Ler o .xlsx: o repositório não tem biblioteca de planilha, então a leitura
// é do `openpyxl` (python3), que devolve as linhas como JSON.
//
// DATABASE_URL: coletor/.env OU o ambiente (`node --env-file=<.env> …`).
import './lib/carregar-env.mjs'
import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import pg from 'pg'

const args = process.argv.slice(2)
const GRAVAR = args.includes('--gravar')
const iRel = args.indexOf('--relatorio')
const RELATORIO = iRel >= 0 ? args[iRel + 1] : null
const INCLUIR_SEM_CONTATO = args.includes('--incluir-sem-contato')
const PLANILHA = args.find((a, i) => !a.startsWith('--') && (iRel < 0 || i !== iRel + 1))
if (!PLANILHA) { console.error('uso: node coletor/importar-stylists-da-planilha.mjs <planilha.xlsx> [--gravar] [--incluir-sem-contato] [--relatorio <pasta>]'); process.exit(1) }
if (!process.env.DATABASE_URL) { console.error('❌ sem DATABASE_URL'); process.exit(1) }

const HOJE_BR = '24/09/2026'
export const MARCA = 'Importado da planilha de mapeamento de stylists'

// ── ler a planilha ──────────────────────────────────────────────────────────
const PY = `
import json, sys, re, openpyxl
wb = openpyxl.load_workbook(sys.argv[1], data_only=True)
ws = wb['Base Priorizada']
linhas = list(ws.iter_rows(values_only=True))
i = next(i for i, r in enumerate(linhas) if r and r[0] == '#')
cab = linhas[i]
dados = [dict(zip(cab, r)) for r in linhas[i + 1:] if r and r[0] is not None]
data = None
if 'Metodologia' in wb.sheetnames:
    for r in wb['Metodologia'].iter_rows(values_only=True):
        for v in r:
            if isinstance(v, str) and 'Consolidação realizada em' in v:
                data = v
print(json.dumps({'cabecalho': cab, 'linhas': dados, 'consolidacao': data}, default=str, ensure_ascii=False))
`
const lido = spawnSync('python3', ['-c', PY, PLANILHA], { encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 })
if (lido.status !== 0) { console.error('❌ não consegui ler a planilha:', lido.stderr); process.exit(1) }
const { cabecalho, linhas, consolidacao } = JSON.parse(lido.stdout)

// A data da prospecção é a da consolidação da planilha ("16 de setembro de 2026").
const MESES = { janeiro: 1, fevereiro: 2, 'março': 3, abril: 4, maio: 5, junho: 6, julho: 7, agosto: 8, setembro: 9, outubro: 10, novembro: 11, dezembro: 12 }
const mData = /(\d{1,2}) de ([a-zç]+) de (\d{4})/i.exec(consolidacao || '')
const PROSPECTADO_EM = mData && MESES[mData[2].toLowerCase()]
  ? `${mData[3]}-${String(MESES[mData[2].toLowerCase()]).padStart(2, '0')}-${mData[1].padStart(2, '0')}`
  : '2026-09-24'
const PROSPECTADO_BR = PROSPECTADO_EM.split('-').reverse().join('/')

// ── as regras de cada campo ─────────────────────────────────────────────────
const naoLocalizado = (v) => /^\s*n[ãa]o localizado/i.test(String(v ?? ''))
const vazio = (v) => v == null || /^\s*(—|-|n[ãa]o localizado.*|)\s*$/i.test(String(v))
const texto = (v) => (vazio(v) ? null : String(v).trim())

/** Instagram: só quando a célula É um perfil (@fulana ou instagram.com/fulana). Facebook e "handle não confirmado" não são. */
export function instagramDaCelula(v) {
  const t = String(v ?? '').trim()
  const url = /instagram\.com\/([A-Za-z0-9._]{1,30})/i.exec(t)
  if (url) return `@${url[1]}`
  const m = /^@([A-Za-z0-9._]{1,30})\b/.exec(t)
  return m ? `@${m[1]}` : null
}
const perfil = (ig) => (ig ? ig.replace(/^@/, '').toLowerCase() : null)

/**
 * WhatsApp: o PRIMEIRO número da célula, e só se for celular brasileiro
 * completo (DDD + 9 + 8 dígitos). ⚠️ Mais estrito que `vessel_telefone_canonico`
 * de propósito: aquela aceita 10 dígitos (fixo), e o "(19) 7160-5926 — número
 * publicado com 8 dígitos" da planilha passaria como fixo válido — um número
 * quebrado virando o WhatsApp da parceira.
 */
export function whatsappDaCelula(v) {
  const t = String(v ?? '')
  const primeiro = t.split(/\(fixo|;|\s—\s/i)[0]
  let d = primeiro.replace(/\D/g, '')
  if (d.length === 13 && d.startsWith('55')) d = d.slice(2)
  return /^[1-9]{2}9\d{8}$/.test(d) ? `55${d}` : null
}

/** A atuação na lista que a casa já usa (a da landing e a do espelho: stylist | personal-shopper | consultoria | outra). */
export function atuacaoDaLinha(segmento, categoria) {
  const c = String(categoria || '').toLowerCase()
  if (!/stylist\/imagem/i.test(String(segmento || ''))) return 'outra'   // organizer, franquia…
  if (/varejo/.test(c)) return 'outra'
  if (/stylist/.test(c)) return 'stylist'
  if (/personal shopper/.test(c)) return 'personal-shopper'
  if (/consult|imagem|estilo|colora|visagismo/.test(c)) return 'consultoria'
  return 'outra'
}

/** Praça e loja: só Campinas tem as duas na casa (CPS / Iguatemi). Limeira e Piracicaba ficam vazias — não se inventa loja. */
export function pracaELoja(cidade) {
  return /^\s*campinas\s*$/i.test(String(cidade || '')) ? { praca: 'CPS', loja: 'iguatemi' } : { praca: null, loja: null }
}

const normalNome = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

function observacoesDaLinha(l, { whatsapp, instagram }) {
  const partes = [
    `${MARCA} (consolidação de ${PROSPECTADO_BR}) em ${HOJE_BR}.`,
    `Planilha: nº ${l['#']} · Tier ${l.Tier} · Score ${l.Score} (da metodologia da planilha — NÃO é a nossa qualificação).`,
    `Segmento: ${l.Segmento}${texto(l.Categoria) ? ` · ${l.Categoria}` : ''}`,
  ]
  const add = (rotulo, v) => { const t = texto(v); if (t) partes.push(`${rotulo}: ${t}`) }
  // ⚠️ SEM CONTATO AINDA: o "Não localizado publicamente" da planilha é
  // informação (a pesquisa procurou e não achou), não célula vazia.
  if (!whatsapp && !instagram) {
    const campos = [['WhatsApp/Telefone', l['WhatsApp / Telefone']], ['Instagram', l.Instagram],
      ['E-mail', l['E-mail']], ['Site/contato', l['Site / Link de contato']]]
      .filter(([, v]) => naoLocalizado(v)).map(([k]) => k)
    partes.push(`Sem contato ainda — alguém vai completar.${campos.length ? ` Não localizado publicamente: ${campos.join(', ')}.` : ''}`)
  }
  add('Serviços', l['Serviços declarados'])
  add('Público', l['Público declarado'])
  add('Seguidores', l.Seguidores)
  // O que a célula dizia e não coube no campo (fixo, segundo número, número quebrado, Facebook).
  const foneBruto = texto(l['WhatsApp / Telefone'])
  if (foneBruto && (!whatsapp || foneBruto.replace(/\D/g, '').length > 13)) add('Telefone (planilha)', foneBruto)
  const igBruto = texto(l.Instagram)
  if (igBruto && !instagram) add('Instagram (planilha)', igBruto)
  add('E-mail', l['E-mail'])
  add('Site/contato', l['Site / Link de contato'])
  add('Confiança da fonte', l['Confiança da fonte'])
  add('Ação recomendada', l['Ação recomendada'])
  add('Observação comercial', l['Observação comercial'])
  add('Evidência', l['Evidência de aderência à marca'])
  let t = partes.join('\n')
  if (t.length > 2000) t = `${t.slice(0, 1997)}...`
  return t
}

// ── montar cada linha ───────────────────────────────────────────────────────
const plano = linhas.map((l) => {
  const whatsapp = whatsappDaCelula(l['WhatsApp / Telefone'])
  const instagram = instagramDaCelula(l.Instagram)
  const { praca, loja } = pracaELoja(l.Cidade)
  return {
    n: l['#'], tier: l.Tier,
    nome: String(l.Profissional || '').trim(),
    cidade: texto(l.Cidade),
    whatsapp, instagram,
    atuacao: atuacaoDaLinha(l.Segmento, l.Categoria),
    praca, loja,
    observacoes: observacoesDaLinha(l, { whatsapp, instagram }),
    fonteFone: l['WhatsApp / Telefone'], fonteIg: l.Instagram,
  }
})

// ── o banco ─────────────────────────────────────────────────────────────────
const cli = new pg.Client({ connectionString: process.env.DATABASE_URL })
await cli.connect()
const uma = async (s, a = []) => (await cli.query(s, a)).rows[0]

const falhas = []
const conferir = (ok, frase, detalhe) => {
  console.log(`${ok ? '  ✓' : '  ✗'} ${frase}${ok ? '' : `  → ${JSON.stringify(detalhe)}`}`)
  if (!ok) falhas.push(frase)
}

const assinatura = await uma(`select string_agg(p.oid::regprocedure::text, ' | ') as a from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'vessel_stylist_criar'`)
const { funil } = await uma(`select exists (select 1 from public.schema_migrations
  where name = '2026-09-24-vessel-stylist-funil-configuravel.sql') as funil`)
// ⚠️ A porta de "sem contato ainda" (`p_sem_contato`, 2026-09-24-vessel-stylist-sem-contato.sql)
// acrescenta um boolean no fim; sem ela, só a porta antiga.
const PORTA_ANTIGA = 'vessel_stylist_criar(text,text,text,text,text,text,text,text,text,date,text,date,text)'
const PORTA_NOVA = 'vessel_stylist_criar(text,text,text,text,text,text,text,text,text,date,text,date,text,boolean)'
if (![PORTA_ANTIGA, PORTA_NOVA].includes(assinatura.a) || !funil) {
  console.error('❌ o banco ainda não tem o funil configurável (falta 2026-09-24-vessel-stylist-funil-configuravel.sql):', assinatura.a)
  await cli.end(); process.exit(1)
}
if (INCLUIR_SEM_CONTATO && assinatura.a !== PORTA_NOVA) {
  console.error('❌ --incluir-sem-contato precisa de 2026-09-24-vessel-stylist-sem-contato.sql (a porta com p_sem_contato):', assinatura.a)
  await cli.end(); process.exit(1)
}
const { primeira } = await uma(`select nome as primeira from public.vessel_stylist_etapas
  where ativa and tipo = 'funil' order by ordem, id limit 1`)

const existentes = (await cli.query(`select codigo, nome, cidade, whatsapp, instagram from public.vessel_stylists`)).rows
const antes = await uma(`select count(*)::int as n,
  md5(coalesce(string_agg(t::text, '|' order by t.id), '')) as md5 from public.vessel_stylists t`)

// Duplicadas: contra a base e dentro da própria planilha.
const vistos = { fone: new Map(), ig: new Map(), nome: new Map() }
for (const e of existentes) {
  if (e.whatsapp) vistos.fone.set(e.whatsapp, e.codigo)
  const p = perfil(e.instagram?.match(/@?([A-Za-z0-9._]{1,30})\/?$/)?.[0] ? `@${e.instagram.replace(/^.*instagram\.com\//i, '').replace(/[/?#].*$/, '').replace(/^@/, '')}` : null)
  if (p) vistos.ig.set(p, e.codigo)
  vistos.nome.set(`${normalNome(e.nome)}|${normalNome(e.cidade)}`, e.codigo)
}
const pular = []
const entrar = []
for (const p of plano) {
  const chaveNome = `${normalNome(p.nome)}|${normalNome(p.cidade)}`
  let motivo = null
  if (!p.nome) motivo = 'sem nome'
  else if (!p.whatsapp && !p.instagram && !INCLUIR_SEM_CONTATO) motivo = 'sem WhatsApp e sem Instagram'
  else if (p.whatsapp && vistos.fone.has(p.whatsapp)) motivo = `WhatsApp repetido (${vistos.fone.get(p.whatsapp)})`
  else if (p.instagram && vistos.ig.has(perfil(p.instagram))) motivo = `Instagram repetido (${vistos.ig.get(perfil(p.instagram))})`
  else if (vistos.nome.has(chaveNome)) motivo = `mesmo nome e cidade (${vistos.nome.get(chaveNome)})`
  if (motivo) { pular.push({ ...p, motivo }); continue }
  const marca = `planilha nº ${p.n}`
  if (p.whatsapp) vistos.fone.set(p.whatsapp, marca)
  if (p.instagram) vistos.ig.set(perfil(p.instagram), marca)
  vistos.nome.set(chaveNome, marca)
  entrar.push(p)
}

console.log(`\nPlanilha: ${linhas.length} linhas (consolidação de ${PROSPECTADO_BR}) · entram em "${primeira}" · na base antes: ${existentes.length}`)
const semContato = (p) => !p.whatsapp && !p.instagram
console.log(`Entram: ${entrar.length} (com WhatsApp: ${entrar.filter((p) => p.whatsapp).length} · só Instagram: ${entrar.filter((p) => !p.whatsapp && p.instagram).length} · sem contato ainda: ${entrar.filter(semContato).length}) · puladas: ${pular.length}`)

let gravadas = []
await cli.query('begin')
try {
  // ⚠️ O PERFIL DE OPERAÇÃO SÓ EXISTE DENTRO DESTA TRANSAÇÃO: é criado aqui e
  // apagado antes do `commit`. Ninguém de fora chega a vê-lo.
  const operador = randomUUID()
  await cli.query(`insert into auth.users (id, email) values ($1, $2)`, [operador, `importar-planilha-${operador}@teste.invalido`])
  // O nome é o que o histórico de etapas mostra em "quem" (a linha do
  // histórico guarda o nome, e o perfil some no fim desta transação).
  await cli.query(`insert into public.profiles (id, email, name, features, permissions, is_superadmin)
                   values ($1, $2, $3, $4, $5::jsonb, false)`,
    [operador, `importar-planilha-${operador}@teste.invalido`, `Importação da planilha de mapeamento (${HOJE_BR})`,
      ['atendimentos'], JSON.stringify({ atendimentos: ['ver', 'editar'] })])
  await cli.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: operador })])

  for (const p of entrar) {
    const { r } = await uma(
      `select public.vessel_stylist_criar(
         p_nome => $1, p_whatsapp => $2, p_cidade => $3, p_instagram => $4, p_atuacao => $5,
         p_praca => $6, p_loja => $7, p_origem_contato => 'pesquisa', p_responsavel => null,
         p_observacoes => $8${semContato(p) ? ', p_sem_contato => true' : ''}) as r`,
      [p.nome, p.whatsapp, p.cidade, p.instagram, p.atuacao, p.praca, p.loja, p.observacoes])
    if (!r?.ok) { pular.push({ ...p, motivo: `o banco recusou: ${r?.situacao}${r?.codigo ? ` (${r.codigo})` : ''}` }); continue }
    gravadas.push({ ...p, codigo: r.codigo })
  }

  await cli.query(`select set_config('request.jwt.claims', '', true)`)
  await cli.query(`delete from public.profiles where id = $1`, [operador])
  await cli.query(`delete from auth.users where id = $1`, [operador])

  console.log('\n── conferências (dentro da transação)')
  const codigos = gravadas.map((g) => g.codigo)
  const chk = await uma(
    `select count(*)::int as n,
            count(*) filter (where e.nome = $3)::int as na_primeira,
            count(distinct codigo)::int as codigos,
            count(*) filter (where whatsapp is null and nullif(btrim(coalesce(instagram,'')),'') is null)::int as sem_contato,
            count(*) filter (where s.sem_contato)::int as marca_sem_contato,
            count(*) filter (where origem_contato = 'pesquisa' and observacoes like $2 || '%')::int as marcadas,
            count(*) filter (where s.prospectado_em is null)::int as sem_data,
            (select count(*) from public.vessel_stylist_etapas_historico h
              where h.stylist_id in (select id from public.vessel_stylists where codigo = any($1))
                and h.motivo = 'cadastro')::int as historico
       from public.vessel_stylists s join public.vessel_stylist_etapas e on e.id = s.etapa_id
      where s.codigo = any($1)`, [codigos, MARCA, primeira])
  conferir(chk.n === entrar.length && gravadas.length === entrar.length, `gravadas = esperadas (${entrar.length})`, { chk, gravadas: gravadas.length })
  conferir(chk.na_primeira === chk.n, `todas em "${primeira}" (a primeira etapa do funil)`, chk)
  conferir(chk.codigos === chk.n && codigos.every((c) => /^STY-\d{4}$/.test(c)), 'códigos únicos no formato STY-0000', chk)
  const esperadasSem = entrar.filter(semContato).length
  conferir(chk.sem_contato === esperadasSem && chk.marca_sem_contato === esperadasSem,
    INCLUIR_SEM_CONTATO ? `sem contato: exatamente as ${esperadasSem} esperadas, todas com a marca "sem contato ainda"`
      : 'nenhuma sem WhatsApp e sem Instagram', chk)
  conferir(chk.marcadas === chk.n, 'todas marcadas (origem "pesquisa" + observação da planilha)', chk)
  conferir(chk.sem_data === chk.n, 'nenhuma com data da prospecção (não contam como prospectadas no placar)', chk)
  conferir(chk.historico === chk.n, 'cada uma com a entrada no histórico de etapas', chk)
  const { total } = await uma(`select count(*)::int as total from public.vessel_stylists`)
  conferir(total === antes.n + chk.n, 'a base cresceu exatamente o que entrou', { antes: antes.n, total })
  const { md5: md5Antigas } = await uma(`select md5(coalesce(string_agg(t::text, '|' order by t.id), '')) as md5
    from public.vessel_stylists t where not (codigo = any($1))`, [codigos])
  conferir(md5Antigas === antes.md5, 'as parceiras que já existiam não mudaram', { antes: antes.md5, md5Antigas })
  const { sobrou } = await uma(`select count(*)::int as sobrou from public.profiles where email like 'importar-planilha-%@teste.invalido'`)
  conferir(sobrou === 0, 'o perfil de operação não sobrou', sobrou)

  // O placar e a lista da Central, como a Central chama (com uma sessão de quem vê).
  await cli.query('savepoint leitura')
  const leitor = randomUUID()
  await cli.query(`insert into auth.users (id, email) values ($1, $2)`, [leitor, `importar-planilha-leitor-${leitor}@teste.invalido`])
  await cli.query(`insert into public.profiles (id, email, features, permissions, is_superadmin) values ($1, $2, $3, $4::jsonb, false)`,
    [leitor, `importar-planilha-leitor-${leitor}@teste.invalido`, ['atendimentos'], JSON.stringify({ atendimentos: ['ver'] })])
  await cli.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: leitor })])
  const { lista } = await uma(`select public.vessel_rastreio_dos_stylists(7, false) as lista`)
  const naLista = (lista || []).filter((x) => codigos.includes(x.codigo))
  conferir(naLista.length === chk.n && naLista.every((x) => x.observacoes && x.etapa === primeira
      && (x.sem_contato ?? false) === (!x.whatsapp && !x.instagram)),
    `a lista da Central mostra todas, em "${primeira}", com a observação`, naLista.length)
  const { placar } = await uma(`select public.vessel_placar_do_stylist_circle($1::date, current_date, 14) as placar`, [PROSPECTADO_EM])
  conferir(placar && typeof placar === 'object', 'o placar do Stylist Circle continua respondendo', placar)
  console.log(`    placar desde ${PROSPECTADO_BR}: ${JSON.stringify(placar).slice(0, 300)}`)
  await cli.query('rollback to savepoint leitura')

  if (falhas.length) throw new Error(`${falhas.length} conferência(s) falharam`)
  if (GRAVAR) {
    const fim = await cli.query('commit')
    if (fim.command !== 'COMMIT') throw new Error(`o commit voltou ${fim.command}`)
    console.log(`\n✅ gravado: ${gravadas.length} parceiras novas.`)
  } else {
    await cli.query('rollback')
    console.log(`\n✅ ensaio limpo: ${gravadas.length} entrariam, e NADA foi gravado. Rode com --gravar para valer.`)
  }
} catch (e) {
  await cli.query('rollback').catch(() => {})
  console.error(`\n❌ nada foi gravado: ${e.message}`)
  process.exitCode = 1
  gravadas = []
} finally {
  await cli.end()
}

// ── a prévia ────────────────────────────────────────────────────────────────
console.log('\n── entram')
for (const g of gravadas) {
  console.log(`  ${g.codigo ?? '—'} · nº ${g.n} ${g.tier} · ${g.nome} · ${g.cidade} · ${g.whatsapp ?? '(sem WhatsApp)'} · ${g.instagram ?? '(sem Instagram)'} · ${g.atuacao} · ${g.praca ?? '-'}/${g.loja ?? '-'}${semContato(g) ? ' · SEM CONTATO AINDA' : ''}`)
}
console.log('\n── puladas')
for (const p of pular) console.log(`  nº ${p.n} · ${p.nome} · ${p.cidade} → ${p.motivo}  [tel: ${p.fonteFone ?? ''} | ig: ${p.fonteIg ?? ''}]`)

if (RELATORIO) {
  mkdirSync(RELATORIO, { recursive: true })
  const csv = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`
  const linhasCsv = [
    ['situacao', 'codigo', 'n_planilha', 'tier', 'nome', 'cidade', 'whatsapp', 'instagram', 'atuacao', 'praca', 'loja', 'motivo', 'observacoes'].join(','),
    ...gravadas.map((g) => [GRAVAR ? 'gravada' : 'entraria', g.codigo, g.n, g.tier, g.nome, g.cidade, g.whatsapp, g.instagram, g.atuacao, g.praca, g.loja, '', g.observacoes].map(csv).join(',')),
    ...pular.map((p) => ['pulada', '', p.n, p.tier, p.nome, p.cidade, p.whatsapp, p.instagram, p.atuacao, p.praca, p.loja, p.motivo, ''].map(csv).join(',')),
  ]
  const nome = GRAVAR ? 'importacao-gravada' : 'importacao-ensaio'
  writeFileSync(join(RELATORIO, `${nome}.csv`), `﻿${linhasCsv.join('\n')}\n`)
  const md = [
    `# Stylists da planilha — ${GRAVAR ? 'GRAVADO' : 'ensaio'} (${HOJE_BR})`, '',
    `- Linhas na planilha: ${linhas.length}`,
    `- ${GRAVAR ? 'Gravadas' : 'Entrariam'}: ${gravadas.length} (com WhatsApp: ${gravadas.filter((g) => g.whatsapp).length} · só Instagram: ${gravadas.filter((g) => !g.whatsapp).length})`,
    `- Puladas: ${pular.length}`,
    `- Etapa: ${primeira} · origem do contato: Pesquisa · sem data da prospecção (nasce ao chegar na etapa marcada) · consolidação da planilha: ${PROSPECTADO_BR}`,
    '', '## Puladas', '',
    ...pular.map((p) => `- nº ${p.n} ${p.nome} (${p.cidade}) — ${p.motivo}`),
    '', `## ${GRAVAR ? 'Gravadas' : 'Entrariam'}`, '',
    '| Código | nº | Tier | Nome | Cidade | WhatsApp | Instagram | Atuação | Praça/Loja |', '|---|---|---|---|---|---|---|---|---|',
    ...gravadas.map((g) => `| ${g.codigo} | ${g.n} | ${g.tier} | ${g.nome} | ${g.cidade} | ${g.whatsapp ?? '—'} | ${g.instagram ?? '—'} | ${g.atuacao} | ${g.praca ?? '—'}/${g.loja ?? '—'} |`),
  ]
  writeFileSync(join(RELATORIO, `${nome}.md`), `${md.join('\n')}\n`)
  console.log(`\nrelatório em ${RELATORIO}/${nome}.{csv,md}`)
}
