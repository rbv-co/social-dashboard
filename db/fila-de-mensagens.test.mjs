// Prova de COMPORTAMENTO da fila de pedido e follow-up (e do teto configurável do abandono), num Postgres descartável.
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
])
const { sql } = banco
before(() => banco.iniciar())
after(() => banco.parar())
const opcoes = { skip: temPg ? false : 'Postgres local não encontrado' }

const limpar = () => sql('delete from public.mensagem_fila; delete from public.checkout_abandono')

// ── pedido ────────────────────────────────────────────────────────────────────
const pedido = (id, { tel = '19982621828', horasAtras = 1, numero = '#1001', nome = 'Ana' } = {}) =>
  sql(`select public.registrar_pedido_para_mensagem(${id}, '${numero}', '${nome}', '${tel}', now() - interval '${horasAtras} hours')`)
const pegarFila = (tipo, { max = 14, reservar = 'true', ultimos11 = 'null' } = {}) =>
  sql(`select coalesce(string_agg(chave, ',' order by chave), '') from public.pegar_da_fila('${tipo}', 10, ${max}, ${reservar}, ${ultimos11})`)
const estadoFila = (tipo, chave) =>
  sql(`select coalesce(mensagem_status, '-') || '|' || coalesce(mensagem_motivo, '-') || '|' || mensagem_tentativas from public.mensagem_fila where tipo = '${tipo}' and chave = '${chave}'`)

test('⚠️ pedido: o mesmo pedido registrado duas vezes (reenvio do webhook) é UMA linha; dois pedidos do mesmo telefone são dois', opcoes, () => {
  limpar()
  pedido(1); pedido(1); pedido(2)
  assert.equal(sql(`select count(*) from public.mensagem_fila where tipo = 'pedido'`), '2')
  assert.equal(pegarFila('pedido'), '1,2')
})

test('pedido: guarda número, nome e telefone do pedido', opcoes, () => {
  limpar()
  pedido(7, { numero: '#1234', nome: 'Maria da Silva', tel: '+55 19 98262-1828' })
  assert.equal(sql(`select numero || '|' || nome || '|' || telefone from public.mensagem_fila where chave = '7'`), '#1234|Maria da Silva|+55 19 98262-1828')
})

test('⚠️ pedido antigo (além do teto de horas) nunca é entregue', opcoes, () => {
  limpar()
  pedido(3, { horasAtras: 15 }); pedido(4, { horasAtras: 13 })
  assert.equal(pegarFila('pedido', { max: 14 }), '4')
})

test('⚠️ pedido cancelado ANTES do envio vira ignorada/pedido_cancelado; depois de reservado não muda', opcoes, () => {
  limpar()
  pedido(5); pedido(6)
  sql(`select public.cancelar_mensagem_pedido(5)`)
  assert.equal(estadoFila('pedido', '5'), 'ignorada|pedido_cancelado|0')
  assert.equal(pegarFila('pedido'), '6') // reservou o 6
  sql(`select public.cancelar_mensagem_pedido(6)`)
  assert.equal(estadoFila('pedido', '6'), 'enviando|-|0')
})

test('modo seco (p_reservar = false) devolve a mesma escolha e NÃO grava nada; filtro de lista funciona', opcoes, () => {
  limpar()
  pedido(1, { tel: '19982621828' }); pedido(2, { tel: '11988887777' })
  assert.equal(pegarFila('pedido', { reservar: 'false' }), '1,2')
  assert.equal(estadoFila('pedido', '1'), '-|-|0')
  assert.equal(pegarFila('pedido', { reservar: 'false', ultimos11: `array['11988887777']` }), '2')
})

// ── resultado, devolução, travadas ────────────────────────────────────────────
test('marcar_da_fila só finaliza quem está enviando; devolver conta tentativa e esgota em 3', opcoes, () => {
  limpar()
  pedido(1)
  sql(`select public.marcar_da_fila('pedido', '1', 'enviada', null, 55)`) // ainda null: não finaliza
  assert.equal(estadoFila('pedido', '1'), '-|-|0')
  pegarFila('pedido') // reserva: enviando
  sql(`select public.devolver_da_fila('pedido', '1', true)`)
  assert.equal(estadoFila('pedido', '1'), '-|-|1')
  for (let i = 0; i < 2; i++) { pegarFila('pedido'); sql(`select public.devolver_da_fila('pedido', '1', true)`) }
  assert.equal(estadoFila('pedido', '1'), 'falhou|tentativas_esgotadas|3')
})

test('devolver sem contar volta à fila sem gastar tentativa; marcar enviada grava a conversa', opcoes, () => {
  limpar()
  pedido(1)
  pegarFila('pedido')
  sql(`select public.devolver_da_fila('pedido', '1', false)`)
  assert.equal(estadoFila('pedido', '1'), '-|-|0')
  pegarFila('pedido')
  sql(`select public.marcar_da_fila('pedido', '1', 'enviada', null, 55)`)
  assert.equal(estadoFila('pedido', '1'), 'enviada|-|0')
  assert.equal(sql(`select chatwoot_conversation_id from public.mensagem_fila where chave = '1'`), '55')
})

test('⚠️ travadas: enviando há mais de 10 min vira falhou (nunca volta à fila: o template pode já ter saído)', opcoes, () => {
  limpar()
  pedido(1); pedido(2)
  pegarFila('pedido')
  sql(`update public.mensagem_fila set mensagem_reservada_em = now() - interval '11 minutes' where chave = '1'`)
  assert.equal(sql(`select public.liberar_travadas_da_fila()`), '1')
  assert.equal(estadoFila('pedido', '1'), 'falhou|travada_sem_confirmacao|0')
  assert.equal(estadoFila('pedido', '2'), 'enviando|-|0')
})

// ── follow-up ─────────────────────────────────────────────────────────────────
/** Checkout que já recebeu a mensagem de abandono `horasMsg` horas atrás (null = nunca recebeu). */
const checkout = (token, { tel = null, status = 'fila_envio', horasMsg = 50, conversa = 900, nome = 'Ana' } = {}) => sql(`
  insert into public.checkout_abandono (token, telefone, nome, status, fila_envio_em, ultimo_evento_em, url_de_recuperacao,
                                        mensagem_status, mensagem_enviada_em, chatwoot_conversation_id)
  values ('${token}', ${tel ? `'${tel}'` : 'null'}, '${nome}', '${status}', now() - interval '80 hours', now() - interval '80 hours',
          'https://loja/${token}', ${horasMsg === null ? 'null' : `'enviada'`}, ${horasMsg === null ? 'null' : `now() - interval '${horasMsg} hours'`}, ${conversa})`)

test('⚠️ agendar follow-up: só checkout na fila com mensagem enviada entre 48 h e 72 h atrás; nunca duplica', opcoes, () => {
  limpar()
  checkout('ok', { tel: '19982621828', horasMsg: 50 })
  checkout('cedo', { tel: '11988887777', horasMsg: 10 })
  checkout('tarde', { tel: '21977776666', horasMsg: 80 })
  checkout('comprou', { tel: '31955554444', status: 'comprou' })
  checkout('pendente', { tel: '41944443333', status: 'pagamento_pendente' })
  checkout('nunca-recebeu', { tel: '51933332222', horasMsg: null })
  assert.equal(sql(`select public.agendar_followups(48, 24)`), '1')
  assert.equal(sql(`select public.agendar_followups(48, 24)`), '0')
  assert.equal(sql(`select string_agg(chave, ',') from public.mensagem_fila where tipo = 'followup'`), 'ok')
  assert.equal(sql(`select telefone || '|' || nome || '|' || url_de_recuperacao || '|' || conversa_origem from public.mensagem_fila where chave = 'ok'`),
    '19982621828|Ana|https://loja/ok|900')
})

test('⚠️ follow-up: dois checkouts do MESMO telefone no lote entregam um só; telefone com follow-up em andamento bloqueia', opcoes, () => {
  limpar()
  checkout('a', { tel: '19982621828', horasMsg: 50 })
  checkout('b', { tel: '+55 19 98262-1828', horasMsg: 49 })
  checkout('c', { tel: '11988887777', horasMsg: 50 })
  sql(`select public.agendar_followups(48, 24)`)
  assert.equal(pegarFila('followup', { max: 24 }), 'a,c')
  // 'b' segue sem mensagem e é barrado enquanto 'a' está enviando
  assert.equal(pegarFila('followup', { max: 24 }), '')
})

test('follow-up: o que foi agendado e não saiu em `p_max_horas` horas deixa de ser entregue', opcoes, () => {
  limpar()
  checkout('a', { tel: '19982621828', horasMsg: 50 })
  sql(`select public.agendar_followups(48, 24)`)
  sql(`update public.mensagem_fila set criado_em = now() - interval '25 hours'`)
  assert.equal(pegarFila('followup', { max: 24 }), '')
})

// ── abandono: teto configurável ───────────────────────────────────────────────
const criar = (token, horasNaFila, tel = null) => sql(`
  insert into public.checkout_abandono (token, telefone, status, fila_envio_em, ultimo_evento_em, url_de_recuperacao)
  values ('${token}', ${tel ? `'${tel}'` : 'null'}, 'fila_envio', now() - interval '${horasNaFila} hours', now() - interval '${horasNaFila} hours', 'https://x/${token}')`)
const pegarAbandono = (args) => sql(`select coalesce(string_agg(token, ',' order by token), '') from public.pegar_para_mensagem(${args})`)

test('⚠️ abandono: sem o teto, o comportamento de hoje (só as últimas 24 h) não muda', opcoes, () => {
  limpar()
  criar('novo', 1); criar('velho', 30)
  assert.equal(pegarAbandono('10, 0, false'), 'novo')
})

test('⚠️ abandono às 24 h: com atraso de 1440 min e teto de 48 h, só entra quem está na fila entre 24 h e 48 h', opcoes, () => {
  limpar()
  criar('recente', 1); criar('vinte-e-cinco-h', 25); criar('trinta-h', 30); criar('cinquenta-h', 50)
  assert.equal(pegarAbandono('10, 1440, false, null, 48'), 'trinta-h,vinte-e-cinco-h')
})

// ── segurança ─────────────────────────────────────────────────────────────────
test('funções novas fechadas: só o service_role executa; tabela sem acesso para anon/authenticated', opcoes, () => {
  const quem = sql(`select string_agg(distinct grantee, ',' order by grantee) from information_schema.routine_privileges
                    where routine_name in ('registrar_pedido_para_mensagem', 'cancelar_mensagem_pedido', 'agendar_followups', 'pegar_da_fila',
                                           'marcar_da_fila', 'devolver_da_fila', 'liberar_travadas_da_fila', 'pegar_para_mensagem', 'candidatos_para_mensagem')
                      and privilege_type = 'EXECUTE' and grantee in ('PUBLIC', 'anon', 'authenticated', 'service_role')`)
  assert.equal(quem, 'service_role')
  assert.equal(sql(`select count(*) from information_schema.role_table_grants where table_name = 'mensagem_fila' and grantee in ('anon', 'authenticated')`), '0')
  assert.equal(sql(`select relrowsecurity from pg_class where relname = 'mensagem_fila'`), 't')
})
