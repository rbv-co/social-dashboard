// coletor/lib/notas-bling.mjs
// Descobre em que dia a venda foi FATURADA — que não é o dia em que o pedido
// foi gerado.
//
// POR QUE EXISTE: a dashboard lança o dinheiro na data do pedido. Medido em
// 11/08/2026: os pedidos nº2429 (R$ 3.644,30) e nº2427 (R$ 2.550,74) foram
// feitos na terça 04/08 e a nota saiu na quarta 05/08. A loja emite NFC-e no
// mesmo dia; o Atacado emite NF-e no dia seguinte.
//
// ⚠️ ARMADILHA MEDIDA, não deduzida: o filtro `dataEmissaoInicial/Final` da
// LISTA de notas do Bling NÃO é "de tal dia até tal dia". Medido em 11/08/2026:
//
//     pedi 04..04 → 0 notas
//     pedi 05..05 → 0 notas
//     pedi 04..05 → 5 notas, todas do dia 05
//     pedi 03..06 → 6 notas: 5 do dia 05 e 1 do dia 04
//
// Ou seja: a borda de baixo escapa. Por isso este módulo NUNCA lê a data de uma
// nota a partir do período pedido na lista — ele lê a nota PELO ID que o próprio
// pedido informa. A lista serve só para adiantar trabalho (índice); o que ela
// não trouxer é buscado um a um. Janela torta custa chamada extra, nunca data
// errada.

import { ajustarPelaDataDaNota } from '../../supabase/functions/_shared/data-da-venda.js';

// A REGRA de qual dia a venda conta mora em supabase/functions/_shared/ porque
// a Edge da notificação roda no Deno e não alcança nem src/ nem coletor/. Aqui
// só reexportamos, para quem lê este arquivo saber onde ela está.
export { ajustarPelaDataDaNota };

const MODELOS = ['nfe', 'nfce'];

// ── Pura: o id da nota de um pedido, ou null quando não há nota ────────────
//
// ⚠️ MEDIDO, não suposto: o Bling NÃO devolve vazio para pedido sem nota — ele
// devolve `notaFiscal: { id: 0 }`. O pedido nº2372 (27/07, concluído em 11/08)
// é assim. Sem esta função, o zero vira "id de nota" e o robô fica tentando
// abrir a nota 0 para sempre — nenhum pedido sem nota seria gravado.
export function idDaNota(detalheDoPedido) {
  const id = Number(detalheDoPedido?.data?.notaFiscal?.id ?? detalheDoPedido?.notaFiscal?.id);
  return Number.isFinite(id) && id > 0 ? id : null;
}

// ── Pura: monta a linha de bling_pedido_nota ──────────────────────────────
// pedido : { id, data, total, loja:{id} }        (da lista pedidos/vendas)
// nota   : { id, dataEmissao, numero, serie, situacao, modelo } ou null
//
// Sem nota, a venda continua no dia do pedido — é o comportamento de hoje, e é
// o certo: inventar outro dia para um pedido que nunca foi faturado seria trocar
// um erro conhecido por um chute.
export function montarLinha(pedido, nota, agora = new Date()) {
  const soData = (v) => {
    const s = String(v ?? '').slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(s) && s !== '0000-00-00' ? s : null;
  };
  const emissao = nota ? soData(nota.dataEmissao) : null;
  return {
    pedido_id: Number(pedido.id),
    pedido_numero: pedido?.numero != null ? String(pedido.numero) : null,
    loja_id: pedido?.loja?.id != null ? Number(pedido.loja.id) : null,
    data_pedido: soData(pedido.data),
    total: Number(pedido.total) || 0,
    nota_id: nota?.id != null ? Number(nota.id) : null,
    modelo: nota?.modelo && MODELOS.includes(nota.modelo) ? nota.modelo : null,
    nota_numero: nota?.numero != null ? String(nota.numero) : null,
    nota_serie: nota?.serie != null ? Number(nota.serie) : null,
    nota_situacao: nota?.situacao != null ? Number(nota.situacao) : null,
    data_da_nota: emissao,
    emitida_em: nota && nota.dataEmissao && !String(nota.dataEmissao).startsWith('0000')
      ? String(nota.dataEmissao).replace(' ', 'T') + '-03:00'   // Bling responde em horário de Brasília
      : null,
    // NÃO existe campo "sem nota" aqui de propósito: `nota_id` nulo já diz isso,
    // e o banco publica a mesma resposta em `origem_da_data` ('pedido' x 'nota').
    // Guardar o mesmo fato em dois lugares é como duas telas decidirem a mesma
    // regra — foi assim que este projeto já teve número divergente.
    //
    // data_da_venda e origem_da_data são colunas GERADAS pelo banco; não são
    // enviadas daqui (o Postgres recusaria, e com razão).
    //
    // conferido_em vai EXPLÍCITO: o default do banco só vale na primeira
    // gravação, e o upsert regrava só as colunas que a gente manda. Sem isto,
    // uma linha reconferida hoje continuaria exibindo a data da primeira vez —
    // uma coluna que diz "conferido em" e mente sobre isso.
    conferido_em: agora.toISOString(),
  };
}

// ── Pura: quanto cada mês muda se a venda passar a contar pelo dia da nota ──
// linhas: [{ data_pedido, data_da_nota, total, loja_id }]
// Devolve { 'YYYY-MM': { pelo_pedido, pela_nota, diferenca, movidos } }.
export function impactoPorMes(linhas) {
  const mes = (d) => String(d || '').slice(0, 7);
  const out = {};
  const garante = (m) => (out[m] = out[m] || { pelo_pedido: 0, pela_nota: 0, diferenca: 0, movidos: 0 });
  for (const l of linhas || []) {
    const v = Number(l.total) || 0;
    const mPedido = mes(l.data_pedido);
    const mVenda = mes(l.data_da_nota || l.data_pedido);
    if (mPedido) garante(mPedido).pelo_pedido += v;
    if (mVenda) garante(mVenda).pela_nota += v;
    if (l.data_da_nota && l.data_da_nota !== l.data_pedido) {
      if (mPedido) garante(mPedido).movidos += 1;
    }
  }
  for (const m of Object.keys(out)) {
    out[m].diferenca = Math.round((out[m].pela_nota - out[m].pelo_pedido) * 100) / 100;
    out[m].pelo_pedido = Math.round(out[m].pelo_pedido * 100) / 100;
    out[m].pela_nota = Math.round(out[m].pela_nota * 100) / 100;
  }
  return out;
}

// ── Índice de notas por id, varrendo as listas nfe e nfce ─────────────────
// A janela é só para adiantar trabalho; ver a armadilha no topo do arquivo.
// Devolve Map(id → { id, modelo, dataEmissao, numero, serie, situacao }).
export async function indiceDeNotas(blingProxy, token, dataInicial, dataFinal, log = () => {}) {
  const idx = new Map();
  for (const modelo of MODELOS) {
    for (let pagina = 1; pagina <= 60; pagina++) {
      let resp;
      try {
        resp = await blingProxy(token, modelo, {
          dataEmissaoInicial: dataInicial, dataEmissaoFinal: dataFinal, pagina, limite: 100,
        });
      } catch (e) {
        log(`    índice ${modelo} página ${pagina} falhou (segue sem índice): ${e.message.slice(0, 80)}`);
        break;
      }
      const arr = resp?.data || [];
      for (const n of arr) if (n?.id != null) idx.set(Number(n.id), { ...n, modelo });
      if (arr.length < 100) break;
    }
  }
  return idx;
}

// ── A nota de um id, pelo caminho exato (usado quando o índice não tem) ────
export async function notaPorId(blingProxy, token, notaId) {
  for (const modelo of MODELOS) {
    try {
      const r = await blingProxy(token, `${modelo}/${notaId}`, {});
      if (r?.data?.id != null) return { ...r.data, modelo };
    } catch { /* 404/403 nesse modelo: tenta o outro */ }
  }
  return null;
}

// ── As linhas de bling_pedido_nota que tocam uma janela ───────────────────
// Usada pelos robôs (que falam com o Supabase por REST, não pelo supabase-js).
//
// LANÇA quando não consegue ler, de propósito. Robô que não conseguiu saber a
// data certa e segue calado publicaria de novo o número errado — e num relatório
// que ninguém confere isso passa despercebido por meses. Falhar alto é melhor:
// a rodada é diária e o erro aparece no log do GitHub Actions.
export async function linhasDaJanela(supabaseUrl, chave, di, df, fetchImpl = fetch) {
  const alvo = `${supabaseUrl}/rest/v1/bling_pedido_nota` +
    `?select=pedido_id,pedido_numero,data_pedido,data_da_venda,total,loja_id` +
    `&or=(and(data_da_venda.gte.${di},data_da_venda.lte.${df}),and(data_pedido.gte.${di},data_pedido.lte.${df}))` +
    `&limit=10000`;
  let ultimoErro;
  for (let tentativa = 0; tentativa < 3; tentativa++) {
    try {
      const r = await fetchImpl(alvo, { headers: { apikey: chave, Authorization: 'Bearer ' + chave } });
      if (!r.ok) throw new Error(`bling_pedido_nota -> ${r.status} ${(await r.text()).slice(0, 120)}`);
      return await r.json();
    } catch (e) {
      ultimoErro = e;
      await new Promise((r) => setTimeout(r, 800 * (tentativa + 1)));
    }
  }
  throw new Error('não deu para ler bling_pedido_nota: ' + (ultimoErro?.message || ultimoErro));
}
