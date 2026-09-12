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
export async function ajustesDeValor(supabaseUrl, chave, fetchImpl = fetch) {
  const alvo = `${supabaseUrl}/rest/v1/bling_pedido_ajuste_valor` +
    `?select=pedido_id,total_corrigido` +
    `&limit=10000`;
  let ultimoErro;
  for (let tentativa = 0; tentativa < 3; tentativa++) {
    try {
      const r = await fetchImpl(alvo, { headers: { apikey: chave, Authorization: 'Bearer ' + chave } });
      if (!r.ok) throw new Error(`bling_pedido_ajuste_valor -> ${r.status} ${(await r.text()).slice(0, 120)}`);
      return await r.json();
    } catch (e) {
      ultimoErro = e;
      await new Promise((r) => setTimeout(r, 800 * (tentativa + 1)));
    }
  }
  throw new Error('não deu para ler bling_pedido_ajuste_valor: ' + (ultimoErro?.message || ultimoErro));
}
