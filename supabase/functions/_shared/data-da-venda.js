// A venda conta no dia em que a NOTA saiu, não no dia em que o pedido foi feito.
//
// POR QUE ISTO EXISTE
// O Bling devolve os pedidos por data do PEDIDO. Só que a loja emite NFC-e no
// mesmo dia e o Atacado emite NF-e no dia seguinte — então a venda de sexta
// aparecia na quinta. Medido em 11/08/2026 sobre 12 meses: **197 dos 325 dias
// com venda mostravam valor errado**, erro médio de R$ 2.487,58 por dia. A
// Black Friday de 2025 aparecia com R$ 14.717,76 quando foram R$ 3.167,83.
//
// A data certa é coletada pelo robô coletor/notas-dos-pedidos.mjs e mora em
// `bling_pedido_nota`. Este módulo é a ponte: pega o que o Bling devolveu e
// devolve o que a janela realmente contém.
//
// POR QUE ELE MORA EM `supabase/functions/_shared/` E NÃO EM `src/`
// Três lugares precisam desta MESMA regra: as telas (Gestão à Vista e Análise
// de Vendas), a Edge da notificação de vendas e os robôs do coletor. A Edge
// roda no Deno e NÃO alcança `src/`. Então a regra mora aqui, onde os três
// chegam — mesmo arranjo de `checklist.js` e `rabisco.js`, pelo mesmo motivo.
// Duas cópias da mesma regra é como duas telas decidindo o mesmo: mais cedo ou
// mais tarde elas discordam, e ninguém sabe qual está certa.
//
// DUAS REGRAS QUE PARECEM DETALHE E NÃO SÃO:
//
// 1. **Pedido sem resposta nossa fica como está.** Se a tabela ainda não tem a
//    linha (o robô roda de hora em hora; um pedido feito agora não passou por
//    ele), o pedido mantém a data do pedido. É o comportamento de hoje, e é o
//    certo: para um pedido de hoje, a nota de hoje dá no mesmo. Sumir com ele
//    da tela por falta de informação seria trocar um erro pequeno por um buraco.
//
// 2. **A data original é preservada em `dataDoPedido`.** A Gestão à Vista grava
//    `pedido_data` no cache `bling_pedido_vendedor`; se ela gravasse a data da
//    nota numa coluna chamada "data do pedido", a mentira ficaria no banco e
//    ninguém desconfiaria depois.

const soDia = (v) => String(v ?? '').slice(0, 10);
const dentro = (dia, di, df) => !!dia && dia >= soDia(di) && dia <= soDia(df);

// ── O ajuste, puro e testável ─────────────────────────────────────────────
// pedidos : o que o Bling devolveu para a janela (por data do pedido)
// linhas  : linhas de bling_pedido_nota que tocam a janela
//           [{ pedido_id, pedido_numero, data_pedido, data_da_venda, total, loja_id }]
// Devolve { pedidos, trazidos, removidos, semResposta }.
export function ajustarPelaDataDaNota(pedidos, linhas, di, df) {
  const porId = new Map();
  for (const l of linhas || []) porId.set(String(l.pedido_id), l);

  const saida = [];
  const vistos = new Set();
  let removidos = 0, semResposta = 0;

  for (const p of pedidos || []) {
    const id = String(p?.id ?? '');
    vistos.add(id);
    const linha = porId.get(id);
    const dataDoPedido = soDia(p?.data);
    if (!linha) {
      // Regra 1: sem resposta nossa, fica como está.
      semResposta++;
      saida.push({ ...p, dataDoPedido });
      continue;
    }
    const dataDaVenda = soDia(linha.data_da_venda) || dataDoPedido;
    if (!dentro(dataDaVenda, di, df)) { removidos++; continue; }
    saida.push({ ...p, data: dataDaVenda, dataDoPedido });
  }

  // Os que ENTRAM: a nota caiu nesta janela, mas o pedido é de antes — o Bling
  // não os devolveu, e são justamente as vendas que hoje somem do dia certo.
  let trazidos = 0;
  for (const l of linhas || []) {
    const id = String(l.pedido_id);
    if (vistos.has(id)) continue;
    const dataDaVenda = soDia(l.data_da_venda);
    if (!dentro(dataDaVenda, di, df)) continue;
    trazidos++;
    saida.push({
      id: l.pedido_id,
      numero: l.pedido_numero ?? undefined,
      data: dataDaVenda,
      dataDoPedido: soDia(l.data_pedido),
      total: Number(l.total) || 0,
      loja: l.loja_id != null ? { id: l.loja_id } : undefined,
      trazidoDeOutroDia: true,
    });
  }

  return { pedidos: saida, trazidos, removidos, semResposta };
}

