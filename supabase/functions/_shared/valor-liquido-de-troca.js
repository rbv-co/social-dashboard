//
// O valor que ENTROU de verdade num pedido, separado do que foi troca.
//
// POR QUE ISTO EXISTE
// Medido em 03/10/2026: pedido #2708 (Kariny) tem total R$1.900,00 no Bling,
// mas R$1.600,00 desse total é a forma de pagamento "Devolução de
// mercadorias" — o valor de uma bolsa trocada, não dinheiro novo. Só
// R$300,00 entraram de verdade. As telas de venda somavam o total inteiro.
//
// POR QUE A CLASSIFICAÇÃO É POR tipoPagamento E NÃO PELO NOME
// O nome de uma forma de pagamento é texto livre, editável pela loja no
// Bling a qualquer momento. `tipoPagamento` é um código fixo do catálogo do
// Bling; medido nas 77 formas desta conta, tipoPagamento=5 é exclusivamente
// "Devolução de mercadorias". Quem decide isso é o robô (que lê o catálogo
// `formas-pagamentos`), e grava pronto em bling_pedido_forma_pagamento.eh_devolucao
// — esta função só soma o que já veio marcado.
//
// POR QUE ISTO MORA EM supabase/functions/_shared/ E NÃO EM src/
// Mesmo motivo dos vizinhos valor-corrigido.js e data-da-venda.js: roda no
// Deno e no robô do coletor, que não alcançam src/.
//
// ENTRA DEPOIS de aplicarValorCorrigido, nunca antes: o valor corrigido pode
// já ter mudado o total (nota fiscal congelada com valor errado), e a
// devolução tem que subtrair do número que vale de verdade, não do bruto do
// Bling — ver o teste "entra DEPOIS de valor-corrigido na cadeia".

function valorValido(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;   // devolução de 0 não existe
  return n;
}

// O código do Bling (não o nome) que marca "devolução de mercadoria / crédito
// loja". Comparação estrita: o Bling manda número no JSON; forçar conversão
// de texto aqui esconderia um bug de quem chama (ver teste do tipo errado).
export function ehDevolucaoDeMercadoria(tipoPagamento) {
  return tipoPagamento === 5;
}

// pedidos          : o que a tela tem na mão, já passado por valor-corrigido
// linhasDeDevolucao: linhas de bling_pedido_forma_pagamento onde eh_devolucao
//                    já veio true — [{ pedido_id, valor }], pode ter mais de
//                    uma por pedido.
// Devolve { pedidos, ajustados }.
export function aplicarValorLiquidoDeTroca(pedidos, linhasDeDevolucao) {
  const porId = new Map();
  for (const l of linhasDeDevolucao || []) {
    const valor = valorValido(l?.valor);
    if (valor === null) continue;
    const chave = String(l.pedido_id);
    porId.set(chave, (porId.get(chave) || 0) + valor);
  }

  let ajustados = 0;
  const saida = (pedidos || []).map((p) => {
    const devolucao = porId.get(String(p?.id ?? ''));
    if (!devolucao) return p;                        // sem devolução, nada muda
    ajustados++;
    return { ...p, total: p.total - devolucao, totalComTroca: p.total, valorDevolucao: devolucao };
  });

  return { pedidos: saida, ajustados };
}
