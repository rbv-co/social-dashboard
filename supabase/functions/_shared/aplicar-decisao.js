// supabase/functions/_shared/aplicar-decisao.js
//
// Grava no banco o que `decidir` mandou fazer e devolve a resposta HTTP do webhook. Com `sb` injetado,
// para testar sem a edge. Quem chama: receber-webhook-abandono/index.ts.
//
// ⚠️ Erro de banco devolve 500, NÃO 200: a Shopify reenvia quando não vê 2xx, e as funções são idempotentes
// (reenviar o mesmo evento é inofensivo). Com 200, um soluço do banco perdia o evento "comprou" e a cliente
// que pagou recebia a mensagem de recuperação.

const FUNCAO_DO_PEDIDO = {
  pagamento_pendente: 'marcar_checkout_pagamento_pendente',
  reabrir: 'reabrir_checkout_abandono',
}

/** @returns {Promise<{status: number, corpo: object}>} */
export async function aplicarDecisao(sb, decisao) {
  if (decisao.acao === 'ignorar') return { status: 200, corpo: { ok: true, ignorado: decisao.motivo } }

  const { error } = decisao.acao === 'registrar'
    ? await sb.rpc('registrar_checkout_abandono', decisao.args)
    : decisao.acao === 'comprou'
      ? await sb.rpc('marcar_checkout_comprou', { p_token: decisao.token, p_email: decisao.email, p_telefone: decisao.telefone })
      : await sb.rpc(FUNCAO_DO_PEDIDO[decisao.acao], { p_token: decisao.token })

  if (error) {
    console.error(`falha ao gravar abandono de checkout (${decisao.acao}):`, error.message)
    return { status: 500, corpo: { ok: false, erro: 'falha_ao_gravar' } }
  }
  return { status: 200, corpo: { ok: true } }
}
