// O valor de uma venda que o Bling não deixa mais corrigir.
//
// POR QUE ISTO EXISTE
// Em 11/09/2026 uma venda de R$ 1.900,00 foi fechada com desconto à vista no
// Pix de R$ 285,00 — entrou R$ 1.615,00. O desconto não foi lançado no pedido
// antes de a NFC-e sair, e **nota autorizada congela o pedido**: a tela do Bling
// fica cinza e a API responde 200 com o aviso "Esta venda está bloqueada para
// edição e foi salva parcialmente", sem gravar um campo sequer. Estornar contas
// e estoque (que é o destrave documentado) não abre — provado nos dois. Ou seja:
// o número errado é imutável na origem.
//
// Então a correção mora aqui: uma linha em `bling_pedido_ajuste_valor` diz qual
// é o valor real, e este módulo a aplica por cima do que o Bling devolveu.
//
// POR QUE ELE MORA EM `supabase/functions/_shared/` E NÃO EM `src/`
// Mesmo motivo do vizinho `data-da-venda.js`: a Edge da notificação de vendas
// roda no Deno e não alcança `src/`, e os robôs do coletor também passam por
// aqui. Hoje só as duas telas de venda usam; quando a Edge e os robôs entrarem,
// vão achar a regra pronta em vez de fazer a segunda cópia.
//
// TRÊS REGRAS QUE PARECEM DETALHE E NÃO SÃO:
//
// 1. **Este ajuste nunca TRAZ pedido.** Ao contrário do `data-da-venda`, que
//    puxa para a janela a venda faturada em outro dia, aqui um ajuste órfão
//    (pedido que não está na lista) é simplesmente ignorado. Inventar uma venda
//    a partir de uma linha de correção seria criar faturamento do nada.
//
// 2. **Ajuste torto vale MENOS que o dado do Bling.** Valor vazio, texto que não
//    é número ou negativo não passa: o pedido fica como veio. Um erro de
//    digitação na correção não pode zerar uma venda de verdade na TV da loja.
//
// 3. **O valor do Bling não se perde.** Ele fica em `totalDoBling`, junto com a
//    marca `valorAjustado`. Sem isso, daqui a três meses o número na tela não
//    bate com o ERP e ninguém tem como descobrir por quê.
//
// ⚠️ O QUE ESTE MÓDULO NÃO CONSERTA: o Bling, a nota fiscal, o push de vendas
// das 22h e os relatórios do coletor continuam com o valor original. Está
// escrito em `docs/pendencias.md`.

// `numeric` do Postgres volta como TEXTO no PostgREST — por isso o Number aqui.
// Negativo e não-número caem fora; zero passa (venda pode, de fato, ir a zero).
function valorValido(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

// ── O ajuste, puro e testável ─────────────────────────────────────────────
// pedidos : o que a tela tem na mão (já passado pelo data-da-venda)
// ajustes : linhas de bling_pedido_ajuste_valor [{ pedido_id, total_corrigido }]
// Devolve { pedidos, ajustados }.
export function aplicarValorCorrigido(pedidos, ajustes) {
  const porId = new Map();
  for (const a of ajustes || []) {
    const valor = valorValido(a?.total_corrigido);
    if (valor === null) continue;            // regra 2: ajuste torto não passa
    porId.set(String(a.pedido_id), valor);
  }

  let ajustados = 0;
  const saida = (pedidos || []).map((p) => {
    const valor = porId.get(String(p?.id ?? ''));
    if (valor === undefined) return p;       // regra 1: sem linha, nada muda
    ajustados++;
    return { ...p, total: valor, totalDoBling: p.total, valorAjustado: true };
  });

  return { pedidos: saida, ajustados };
}
