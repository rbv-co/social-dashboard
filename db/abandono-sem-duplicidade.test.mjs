// Prova de COMPORTAMENTO (não de texto) das regras que evitam mensagem duplicada ou errada ao cliente:
// roda as migrations num Postgres descartável e chama as funções de verdade.
// Pula sozinho se o Postgres local (initdb/pg_ctl/psql) não estiver instalado.
import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const AQUI = dirname(fileURLToPath(import.meta.url))
const BINS = [process.env.PG_BIN, '/opt/homebrew/opt/postgresql@17/bin', '/opt/homebrew/opt/postgresql@16/bin', '/usr/lib/postgresql/16/bin', '/usr/lib/postgresql/17/bin', '']
  .filter((b) => b !== undefined)
const achar = (nome) => BINS.map((b) => (b ? join(b, nome) : nome)).find((p) => spawnSync(p, ['--version']).status === 0)
const INITDB = achar('initdb'), PG_CTL = achar('pg_ctl'), PSQL = achar('psql')
const TEM_PG = Boolean(INITDB && PG_CTL && PSQL)

const MIGRATIONS = [
  '2026-09-29-abandono-de-checkout.sql',
  '2026-09-30-abandono-de-checkout-pagamento-pendente.sql',
  '2026-09-30-zz-abandono-pix-expirado.sql',
  '2026-09-30-zzy-mensagem-de-abandono.sql',
  '2026-09-30-zzzz-abandono-sem-duplicidade.sql',
]
const PORTA = String(54000 + Math.floor(Math.random() * 900))
let dir
const ENV = { ...process.env, LC_ALL: 'C' } // o Postgres recusa subir com locale inválido

const sql = (comando) => execFileSync(PSQL, ['-X', '-h', dir, '-p', PORTA, '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-tA', '-c', comando], { encoding: 'utf8', env: ENV }).trim()
const arquivo = (caminho) => execFileSync(PSQL, ['-X', '-h', dir, '-p', PORTA, '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-q', '-f', caminho], { encoding: 'utf8', env: ENV })

before(() => {
  if (!TEM_PG) return
  dir = mkdtempSync(join(tmpdir(), 'pg-abandono-'))
  execFileSync(INITDB, ['-D', dir, '-A', 'trust', '-U', 'postgres', '--no-sync', '--no-locale', '-E', 'UTF8'], { env: ENV })
  execFileSync(PG_CTL, ['-D', dir, '-o', `-k ${dir} -p ${PORTA} -c listen_addresses=''`, '-l', join(dir, 'log'), '-w', 'start'], { env: ENV })
  sql(`create role service_role; create role anon; create role authenticated;
       create schema cron; create function cron.schedule(text, text, text) returns bigint language sql as 'select 1::bigint';
       create schema auth; create function auth.uid() returns uuid language sql as 'select null::uuid';
       create table public.profiles (id uuid, role text, is_superadmin boolean, features text[]);`)
  for (const m of MIGRATIONS) arquivo(join(AQUI, 'migrations', m))
})
after(() => {
  if (!TEM_PG || !dir) return
  spawnSync(PG_CTL, ['-D', dir, '-m', 'immediate', 'stop'], { stdio: 'ignore', env: ENV })
  rmSync(dir, { recursive: true, force: true })
})

const opcoes = { skip: TEM_PG ? false : 'Postgres local não encontrado' }
const limpar = () => sql('delete from public.checkout_abandono')
/** Cria um checkout. `msg` = { status, diasAtras } dá a ele uma mensagem já registrada. */
const criar = (token, { tel = null, email = null, status = 'fila_envio', minAtras = 15, msg = null } = {}) => sql(`
  insert into public.checkout_abandono (token, telefone, email, status, fila_envio_em, ultimo_evento_em, url_de_recuperacao, mensagem_status, mensagem_enviada_em)
  values ('${token}', ${tel ? `'${tel}'` : 'null'}, ${email ? `'${email}'` : 'null'}, '${status}',
          now() - interval '${minAtras} minutes', now() - interval '${minAtras} minutes', 'https://x/${token}',
          ${msg ? `'${msg.status}'` : 'null'}, ${msg ? `now() - interval '${msg.diasAtras} days'` : 'null'})`)
const pegar = (extra = 'true') => sql(`select coalesce(string_agg(token, ',' order by token), '') from public.pegar_para_mensagem(10, 0, ${extra})`)
const estado = (token) => sql(`select status || '|' || coalesce(mensagem_status, '-') || '|' || coalesce(mensagem_motivo, '-') from public.checkout_abandono where token = '${token}'`)

test('⚠️ dois checkouts do MESMO telefone (formatos diferentes) no mesmo lote: só um é reservado', opcoes, () => {
  limpar()
  criar('a', { tel: '19982621828', minAtras: 20 })
  criar('b', { tel: '+55 (19) 98262-1828', minAtras: 15 })
  criar('c', { tel: '11988887777' })
  assert.equal(pegar(), 'a,c')
})

test('⚠️ telefone que JÁ recebeu (enviada há 2 dias) não recebe de novo, e o motivo fica visível', opcoes, () => {
  limpar()
  criar('velho', { tel: '19982621828', status: 'comprou', minAtras: 3000, msg: { status: 'enviada', diasAtras: 2 } })
  criar('novo', { tel: '5519982621828' })
  assert.equal(pegar(), '')
  assert.equal(estado('novo'), 'fila_envio|ignorada|telefone_ja_recebeu')
})

test('telefone que recebeu há mais de 7 dias volta a poder receber', opcoes, () => {
  limpar()
  criar('velho', { tel: '19982621828', status: 'comprou', minAtras: 3000, msg: { status: 'enviada', diasAtras: 8 } })
  criar('novo', { tel: '19982621828' })
  assert.equal(pegar(), 'novo')
})

test('⚠️ telefone com mensagem em andamento (enviando por outra rodada) não é reservado em paralelo', opcoes, () => {
  limpar()
  criar('em-curso', { tel: '19982621828', msg: { status: 'enviando', diasAtras: 0 } })
  criar('novo', { tel: '19982621828' })
  assert.equal(pegar(), '')
})

test('modo seco (p_reservar = false) mostra a mesma escolha e NÃO grava nada', opcoes, () => {
  limpar()
  criar('a', { tel: '19982621828', minAtras: 20 })
  criar('b', { tel: '19982621828', minAtras: 15 })
  criar('velho', { tel: '11988887777', status: 'comprou', minAtras: 3000, msg: { status: 'enviada', diasAtras: 1 } })
  criar('repetido', { tel: '11988887777' })
  assert.equal(pegar('false'), 'a')
  assert.equal(estado('a'), 'fila_envio|-|-')
  assert.equal(estado('repetido'), 'fila_envio|-|-')
})

test('sem telefone não é agrupado: cada um segue (a rodada os ignora por sem_telefone)', opcoes, () => {
  limpar()
  criar('x', { tel: null, email: 'x@x.com' })
  criar('y', { tel: null, email: 'y@y.com' })
  assert.equal(pegar(), 'x,y')
})

test('⚠️ comprou por OUTRO checkout: o abandonado do mesmo telefone ou e-mail sai da fila', opcoes, () => {
  limpar()
  criar('paga', { tel: '19982621828', email: 'ana@x.com', status: 'aguardando' })
  criar('mesmo-fone', { tel: '+55 19 98262-1828' })
  criar('mesmo-email', { email: 'ANA@x.com', status: 'aguardando' })
  criar('outra-pessoa', { tel: '11988887777', email: 'bia@x.com' })
  sql(`select public.marcar_checkout_comprou('paga', 'ana@x.com', '5519982621828')`)
  assert.match(estado('paga'), /^comprou/)
  assert.match(estado('mesmo-fone'), /^comprou/)
  assert.match(estado('mesmo-email'), /^comprou/)
  assert.equal(estado('outra-pessoa'), 'fila_envio|-|-')
  assert.equal(sql(`select comprou_depois from public.checkout_abandono where token = 'mesmo-fone'`), 't')
})

test('compra achada só pelo contato do PEDIDO (o checkout do pedido nem existe na fila)', opcoes, () => {
  limpar()
  criar('a', { tel: '19982621828' })
  sql(`select public.marcar_checkout_comprou('token-que-nao-existe', null, '19982621828')`)
  assert.match(estado('a'), /^comprou/)
})

test('a chamada antiga, só com o token, continua funcionando (edge publicada antes ou depois da migration)', opcoes, () => {
  limpar()
  criar('a', { tel: '19982621828' })
  sql(`select public.marcar_checkout_comprou('a')`)
  assert.match(estado('a'), /^comprou/)
})

test('quem está em pagamento pendente (outro pedido) e quem já comprou não são mexidos pela compra de outro checkout', opcoes, () => {
  limpar()
  criar('paga', { tel: '19982621828' })
  criar('pendente', { tel: '19982621828', status: 'pagamento_pendente' })
  sql(`select public.marcar_checkout_comprou('paga', null, '19982621828')`)
  assert.match(estado('pendente'), /^pagamento_pendente/)
})

test('função nova segue fechada: só o service_role executa', opcoes, () => {
  const quem = sql(`select string_agg(distinct grantee, ',' order by grantee) from information_schema.routine_privileges
                    where routine_name in ('marcar_checkout_comprou', 'pegar_para_mensagem') and privilege_type = 'EXECUTE'
                      and grantee in ('PUBLIC', 'anon', 'authenticated', 'service_role')`)
  assert.equal(quem, 'service_role')
})
