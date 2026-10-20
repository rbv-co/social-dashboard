// coletor/lib/ajustes-de-valor.mjs
// Lê `bling_pedido_ajuste_valor` — o valor real de vendas que o Bling congelou
// erradas, porque nota fiscal autorizada tranca o pedido e nem a tela nem a API
// conseguem corrigir o total depois.
//
// A REGRA que usa estas linhas mora em
// `supabase/functions/_shared/valor-corrigido.js` e é a MESMA das duas telas de
// venda. Aqui fica só a busca, espelhando a `linhasDaJanela` de notas-bling.mjs:
// mesma chave, mesmas 3 tentativas, mesma postura no erro.
//
// ⚠️ SE NÃO DER PARA LER, ESTA FUNÇÃO LANÇA. É de propósito, e é a mesma regra
// da vizinha: robô que não consegue ler a correção tem que parar, não publicar o
// número velho. O telão já mostra o valor corrigido — uma mensagem noturna
// dizendo outro número é pior que mensagem nenhuma, porque ninguém sabe em qual
// acreditar.
//
// A tabela é lida INTEIRA (é de exceção: uma linha por venda congelada errada),
// sem filtrar pelos pedidos da janela.
//
// ⚠️ PAGINADO por `Range` (code review, 12/09/2026): o `limit=10000` sozinho
// não bastava — a PostgREST corta em 1000 linhas por resposta (`db-max-rows`)
// não importa o que `limit` peça, sem avisar. A tabela é pequena hoje, mas o
// corte seria silencioso: robô aplicaria a correção só nas 1000 primeiras
// linhas. Mesmo `Range` que a ponte do navegador já usa
// (`src/compartilhado/valor-corrigido.js`).
const PAGINA = 1000;

export async function ajustesDeValor(supabaseUrl, chave, fetchImpl = fetch) {
  const alvo = `${supabaseUrl}/rest/v1/bling_pedido_ajuste_valor?select=pedido_id,total_corrigido`;
  const linhas = [];
  for (let inicio = 0; ; inicio += PAGINA) {
    let pagina;
    let ultimoErro;
    for (let tentativa = 0; tentativa < 3; tentativa++) {
      try {
        const r = await fetchImpl(alvo, {
          headers: {
            apikey: chave, Authorization: 'Bearer ' + chave,
            Range: `${inicio}-${inicio + PAGINA - 1}`,
          },
        });
        if (!r.ok) throw new Error(`bling_pedido_ajuste_valor -> ${r.status} ${(await r.text()).slice(0, 120)}`);
        pagina = await r.json();
        ultimoErro = null;
        break;
      } catch (e) {
        ultimoErro = e;
        // Sem dormir depois da ÚLTIMA tentativa — dormir ali só atrasa o
        // throw, ninguém tenta de novo depois dele (achado de code review).
        if (tentativa < 2) await new Promise((r) => setTimeout(r, 800 * (tentativa + 1)));
      }
    }
    if (ultimoErro) {
      throw new Error('não deu para ler bling_pedido_ajuste_valor: ' + (ultimoErro?.message || ultimoErro));
    }
    linhas.push(...pagina);
    if (pagina.length < PAGINA) break;
  }
  return linhas;
}

/**
 * O mesmo que `ajustesDeValor`, pelo `pg` que o robô já usa (`DATABASE_URL`). A mesma postura: se não der para ler, LANÇA.
 * `numeric` e `bigint` chegam como texto; a regra (`valorValido`, `String(pedido_id)`) já trata os dois.
 */
export async function ajustesDeValorPg(cli) {
  try {
    const { rows } = await cli.query('select pedido_id, total_corrigido from public.bling_pedido_ajuste_valor');
    return rows;
  } catch (e) {
    throw new Error('não deu para ler bling_pedido_ajuste_valor: ' + (e?.message || e));
  }
}

/**
 * Leva o ajuste para `vessel_pedidos` (total_corrigido e receita_liquida) em TODO pedido que tenha linha em
 * `bling_pedido_ajuste_valor`, e não só nos da janela do robô.
 *
 * ⚠️ Sem isto, ajuste cadastrado (ou reaplicado) para pedido com mais de `--dias` dias nunca chega em
 * `vessel_pedidos`: o robô só regrava o pedido que a janela do Bling devolve, e a receita fica no valor
 * congelado. Foi o que deixou o 2656 em R$ 1.900 mesmo depois de existir a tabela. Idempotente: só toca
 * a linha que está diferente. A tabela é de exceção (poucas linhas), então o update é barato.
 * Devolve quantos pedidos mudou.
 */
export async function propagarAjustesPg(cli) {
  const { rowCount } = await cli.query(
    `update vessel_pedidos p
        set total_corrigido = a.total_corrigido,
            receita_liquida = round(greatest(a.total_corrigido, 0), 2)
       from bling_pedido_ajuste_valor a
      where a.pedido_id = p.bling_pedido_id
        and (p.total_corrigido is distinct from a.total_corrigido
             or p.receita_liquida is distinct from round(greatest(a.total_corrigido, 0), 2))`);
  return rowCount;
}
