// Prova de COMPORTAMENTO da mensagem "Nós reservamos seu pedido", enviada quando o checkout aparece com telefone
// (status Aguardando), num Postgres descartável. Pula se não houver Postgres local.
import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { bancoDescartavel, temPg } from './banco-descartavel.mjs'

const banco = bancoDescartavel([
  '2026-09-29-abandono-de-checkout.sql',
  '2026-09-30-abandono-de-checkout-pagamento-pendente.sql',
  '2026-09-30-zz-abandono-pix-expirado.sql',
  '2026-09-30-zzy-mensagem-de-abandono.sql',
  '2026-09-30-zzzz-abandono-sem-duplicidade.sql',
  '2026-09-30-zzzzz-fila-de-mensagens.sql',
  '2026-09-30-zzzzzz-checkout-iniciado.sql',
])
const { sql } = banco
before(() => banco.iniciar())
after(() => banco.parar())
const opcoes = { skip: temPg ? false : 'Postgres local não encontrado' }

const limpar = () => sql('delete from public.mensagem_fila; delete from public.checkout_abandono')
const lit = (v) => (v === null ? 'null' : `'${v}'`)
const registrar = (token, { tel = null, email = 'a@x.com', nome = 'ana silva' } = {}) =>
  sql(`select public.registrar_checkout_abandono('${token}', ${lit(email)}, ${lit(tel)}, ${lit(nome)}, 100, 'BRL', 'https://loja/${token}')`)
const inicios = () => sql(`select coalesce(string_agg(chave, ',' order by chave), '') from public.mensagem_fila where tipo = 'inicio'`)
const pegar = (extra = {}) => {
  const { max = 1, reservar = 'true' } = extra
  return sql(`select coalesce(string_agg(chave, ',' order by chave), '') from public.pegar_da_fila('inicio', 10, ${max}, ${reservar})`)
}
const estado = (chave) => sql(`select coalesce(mensagem_status, '-') || '|' || coalesce(mensagem_motivo, '-') from public.mensagem_fila where tipo = 'inicio' and chave = '${chave}'`)

test('⚠️ checkout que chega com telefone entra na fila de "inicio" UMA vez, com nome e telefone; updates seguintes não duplicam', opcoes, () => {
  limpar()
  registrar('t1', { tel: '19982621828', nome: 'maysa priscila' })
  registrar('t1', { tel: '19982621828', nome: 'maysa priscila' })
  registrar('t1', { tel: '19982621828', email: 'outro@x.com' })
  assert.equal(sql(`select count(*) from public.mensagem_fila where tipo = 'inicio'`), '1')
  assert.equal(sql(`select nome || '|' || telefone from public.mensagem_fila where chave = 't1'`), 'maysa priscila|19982621828')
})

test('⚠️ só e-mail não entra; quando o telefone aparece num update, entra nessa hora', opcoes, () => {
  limpar()
  registrar('t2', { tel: null })
  assert.equal(inicios(), '')
  registrar('t2', { tel: '19982621828' })
  assert.equal(inicios(), 't2')
})

test('telefone curto (menos de 10 dígitos) não identifica ninguém e não entra', opcoes, () => {
  limpar()
  registrar('t3', { tel: '12345' })
  assert.equal(inicios(), '')
})

test('⚠️ checkout que já saiu de Aguardando (fila de abandono) e ganha telefone depois NÃO gera a mensagem', opcoes, () => {
  limpar()
  registrar('t4', { tel: null })
  sql(`update public.checkout_abandono set status = 'fila_envio', fila_envio_em = now() where token = 't4'`)
  registrar('t4', { tel: '19982621828' })
  assert.equal(inicios(), '')
})

test('o upsert do checkout segue igual: campo vazio não apaga o que já se sabia, e só atualiza quem está Aguardando', opcoes, () => {
  limpar()
  registrar('t5', { tel: '19982621828', email: 'a@x.com', nome: 'ana' })
  sql(`select public.registrar_checkout_abandono('t5', null, null, null, null, null, null)`)
  assert.equal(sql(`select email || '|' || telefone || '|' || nome from public.checkout_abandono where token = 't5'`), 'a@x.com|19982621828|ana')
  sql(`update public.checkout_abandono set status = 'comprou' where token = 't5'`)
  registrar('t5', { tel: '11988887777', nome: 'outra' })
  assert.equal(sql(`select telefone from public.checkout_abandono where token = 't5'`), '19982621828')
})

test('entrega o pedido de "inicio" e respeita o teto de horas (passou de 1 h, nunca mais sai)', opcoes, () => {
  limpar()
  registrar('novo', { tel: '19982621828' })
  registrar('velho', { tel: '11988887777' })
  sql(`update public.mensagem_fila set criado_em = now() - interval '2 hours' where chave = 'velho'`)
  assert.equal(pegar({ reservar: 'false' }), 'novo')
  assert.equal(pegar(), 'novo')
  assert.equal(estado('novo'), 'enviando|-')
})

test('⚠️ dois checkouts do MESMO telefone ao mesmo tempo: só um recebe', opcoes, () => {
  limpar()
  registrar('a', { tel: '19982621828' })
  registrar('b', { tel: '+55 (19) 98262-1828' })
  registrar('c', { tel: '11988887777' })
  assert.equal(pegar(), 'a,c')
  assert.equal(pegar(), '') // 'b' é barrado enquanto 'a' está enviando
})

test('⚠️ quem recebeu há menos de 12 h não recebe de novo (abre e fecha o checkout); depois de 12 h, sim', opcoes, () => {
  limpar()
  registrar('velho', { tel: '19982621828' })
  sql(`update public.mensagem_fila set mensagem_status = 'enviada', mensagem_enviada_em = now() - interval '2 hours' where chave = 'velho'`)
  registrar('novo', { tel: '19982621828' })
  assert.equal(pegar(), '')
  sql(`update public.mensagem_fila set mensagem_enviada_em = now() - interval '13 hours' where chave = 'velho'`)
  assert.equal(pegar(), 'novo')
})

test('o follow-up e o pedido seguem iguais: follow-up agrupa por telefone, pedido não', opcoes, () => {
  limpar()
  sql(`insert into public.mensagem_fila (tipo, chave, telefone) values ('followup', 'f1', '19982621828'), ('followup', 'f2', '19982621828'),
                                                                     ('pedido', '1', '11988887777'), ('pedido', '2', '11988887777')`)
  assert.equal(sql(`select string_agg(chave, ',' order by chave) from public.pegar_da_fila('followup', 10, 24, false)`), 'f1')
  assert.equal(sql(`select string_agg(chave, ',' order by chave) from public.pegar_da_fila('pedido', 10, 24, false)`), '1,2')
})

test('funções continuam fechadas: só o service_role executa registrar_checkout_abandono e candidatos_da_fila', opcoes, () => {
  const quem = sql(`select string_agg(distinct grantee, ',' order by grantee) from information_schema.routine_privileges
                    where routine_name in ('registrar_checkout_abandono', 'candidatos_da_fila') and privilege_type = 'EXECUTE'
                      and grantee in ('PUBLIC', 'anon', 'authenticated', 'service_role')`)
  assert.equal(quem, 'service_role')
})
