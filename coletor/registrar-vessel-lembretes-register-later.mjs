// REGISTRA no schema_migrations uma DDL que já está no banco (B9 de docs/pendencias.md).
//
// ⚠️ POR QUE ISTO EXISTE. `2026-09-19-zzz-vessel-lembretes-register-later.sql`
// foi aplicada em produção por outra frente, mas nenhuma linha foi gravada em
// `public.schema_migrations`. O efeito está no banco; o registro é que falta.
// Isso importa porque as travas `DEPOIS_DESTE` espalhadas pelo projeto (ver
// `coletor/aplicar-vessel-private-edit-pela-tela.mjs` e as irmãs) perguntam a
// `schema_migrations` "essa mudança mais nova já está instalada?" — uma linha
// que falta faz a trava responder "pode seguir" sobre algo que JÁ ESTÁ no
// banco. Este programa não instala nada: só confere, byte a byte, que o que
// está no banco é EXATAMENTE o que o arquivo descreve, e só então grava a
// linha que faltou.
//
// ⚠️ NUNCA RETYPAR O CORPO ESPERADO. Ele é lido do PRÓPRIO ARQUIVO da
// migration em tempo de execução (`readFileSync`) — uma string copiada à mão
// aqui dentro envelheceria sozinha se o arquivo mudasse, e o programa
// passaria a comparar contra um espelho errado sem avisar.
//
// ⚠️ SE ALGO NÃO BATER, O PROGRAMA PARA E CONTA O QUE DIFERE — nunca registra
// mesmo assim. Registrar um descompasso faria o projeto acreditar em algo que
// não é verdade: que o banco tem exatamente o que o arquivo descreve.
import './lib/carregar-env.mjs'
import { readFileSync } from 'node:fs'
import pg from 'pg'

const ARQUIVO = '2026-09-19-zzz-vessel-lembretes-register-later.sql'
const sql = readFileSync(new URL(`../db/migrations/${ARQUIVO}`, import.meta.url), 'utf8')

// As cinco funções que o arquivo cria, com a assinatura exata (para
// `::regprocedure`) e o nome puro (para achar o corpo dentro do arquivo).
const FUNCOES = [
  ['vessel_lembrete_criar', 'vessel_lembrete_criar(text, text, text, boolean)'],
  ['vessel_lembrete_cancelar_por_token', 'vessel_lembrete_cancelar_por_token(text)'],
  ['vessel_lembretes_a_enviar', 'vessel_lembretes_a_enviar()'],
  ['vessel_lembrete_marcar_enviado', 'vessel_lembrete_marcar_enviado(uuid, integer)'],
  ['vessel_lembretes_morre_com_o_registro', 'vessel_lembretes_morre_com_o_registro()'],
]

// Extrai o corpo (o texto ENTRE o primeiro e o segundo `$$`) de
// `create or replace function public.NOME(...)` de dentro do arquivo — a
// mesma delimitação que o Postgres usa para gravar `pg_proc.prosrc`.
function corpoNoArquivo(nome) {
  const marca = `create or replace function public.${nome}(`
  const inicio = sql.indexOf(marca)
  if (inicio === -1) return null
  const primeiro = sql.indexOf('$$', inicio)
  const segundo = sql.indexOf('$$', primeiro + 2)
  if (primeiro === -1 || segundo === -1) return null
  return sql.slice(primeiro + 2, segundo)
}

const cli = new pg.Client({ connectionString: process.env.DATABASE_URL })
await cli.connect()

const divergencias = []

// 1. a tabela existe?
const { rows: [{ t }] } = await cli.query(`select to_regclass('public.vessel_lembretes') as t`)
if (!t) divergencias.push('a tabela public.vessel_lembretes NÃO existe no banco')

// 2. as cinco funções: corpo byte a byte, security definer, search_path=public.
for (const [nome, assinatura] of FUNCOES) {
  const doArquivo = corpoNoArquivo(nome)
  if (doArquivo === null) {
    divergencias.push(`${nome}: não achei a definição dentro do próprio arquivo da migration (bug deste script, não do banco)`)
    continue
  }

  let linha
  try {
    ;({ rows: [linha] } = await cli.query(
      `select p.prosrc, p.prosecdef, p.proconfig
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.oid = $1::regprocedure`,
      [`public.${assinatura}`]))
  } catch (e) {
    divergencias.push(`${nome}: não existe no banco com a assinatura esperada (${assinatura}) — ${e.message}`)
    continue
  }

  if (!linha) {
    divergencias.push(`${nome}: não existe no banco com a assinatura esperada (${assinatura})`)
    continue
  }
  if (linha.prosrc !== doArquivo) {
    divergencias.push(`${nome}: o corpo no banco NÃO é byte-idêntico ao do arquivo (banco tem ${linha.prosrc.length} caracteres, arquivo tem ${doArquivo.length})`)
  }
  if (linha.prosecdef !== true) {
    divergencias.push(`${nome}: não está \`security definer\` no banco`)
  }
  const config = linha.proconfig || []
  if (!config.includes('search_path=public')) {
    divergencias.push(`${nome}: \`search_path=public\` não está no proconfig do banco (achei: ${JSON.stringify(config)})`)
  }
}

if (divergencias.length > 0) {
  console.error(
    `❌ NÃO REGISTRADA: ${ARQUIVO} não bate com o que está no banco. Registrar isto faria o\n` +
    `projeto acreditar em algo que não é verdade. O que diverge:\n\n` +
    divergencias.map((d) => `  · ${d}`).join('\n') + '\n')
  await cli.end()
  process.exit(1)
}

// Tudo bateu — grava só o registro, sem tocar em nenhuma DDL.
try {
  const hoje = new Date().toISOString().slice(0, 10)
  await cli.query(
    `insert into public.schema_migrations (name, observacao) values ($1, $2)
     on conflict (name) do nothing`,
    [ARQUIVO,
     `A DDL desta migration já tinha sido aplicada em produção por outra frente antes de ` +
     `${hoje}; este programa (coletor/registrar-vessel-lembretes-register-later.mjs) só ` +
     `confere, byte a byte contra o arquivo, e REGISTRA — não instala nada. Conferido em ` +
     `${hoje}: tabela vessel_lembretes e as cinco funções (vessel_lembrete_criar, ` +
     `vessel_lembrete_cancelar_por_token, vessel_lembretes_a_enviar, ` +
     `vessel_lembrete_marcar_enviado, vessel_lembretes_morre_com_o_registro) batem ` +
     `com o arquivo, security definer, search_path=public.`])

  const { rows: [conferida] } = await cli.query(
    `select observacao from public.schema_migrations where name = $1`, [ARQUIVO])
  console.log('✅ registrada (ou já estava):', ARQUIVO)
  console.log('   observacao:', conferida.observacao)
} finally {
  await cli.end()
}
