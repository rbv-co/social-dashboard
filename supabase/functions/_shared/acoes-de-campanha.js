// As QUATRO contagens que vêm de graça no `actions` que o coletor já pede à Meta.
//
// Não é chamada nova: `coletarAdsPorCampanha` já manda `fields=...,actions` e
// jogava fora tudo o que não fosse curtida/comentário/compartilhamento/salvamento.
// Conversa, cadastro, compra e visita estavam na mesma resposta.
//
// Cada contagem tenta uma LISTA de nomes, na ordem, e PARA na primeira que
// existir. A Meta manda a mesma conversa com mais de um action_type; somar
// contaria duas vezes a mesma pessoa.
// PURO: sem rede.

export const TIPOS = {
  conversas: ['onsite_conversion.total_messaging_connection', 'onsite_conversion.messaging_conversation_started_7d'],
  cadastros: ['lead', 'onsite_conversion.lead_grouped'],
  compras: ['purchase', 'omni_purchase'],
  // VISITA é landing_page_view, e não link_click: clique não é visita — parte das
  // pessoas sai antes de a página abrir. O rótulo errado inflaria o denominador.
  visitas: ['landing_page_view'],
};

export function contagensDaCampanha(actions) {
  const lista = Array.isArray(actions) ? actions : [];
  const saida = {};
  for (const chave of Object.keys(TIPOS)) {
    saida[chave] = 0;
    for (const tipo of TIPOS[chave]) {
      const achou = lista.find(a => a && a.action_type === tipo);
      if (achou) { const n = parseInt(achou.value, 10); saida[chave] = isFinite(n) ? n : 0; break; }
    }
  }
  return saida;
}
