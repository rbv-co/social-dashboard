// O MERCADO de uma campanha: o que ela COMPRA, segundo o que a META AFIRMA no
// conjunto — não o objetivo declarado.
//
// Medido em 25/09/2026 nas 6 contas: "OUTCOME_ENGAGEMENT" é conversa de WhatsApp
// na Motoeasy, visita ao perfil na Mantova e vídeo na [FLUXO SHOPPING] da Vessel.
// Três mercados, um rótulo só. Julgar pelo objetivo é julgar pelo nome da porta.
//
// A ordem é: DESTINO primeiro, OTIMIZAÇÃO como desempate. É a generalização da
// regra de 2026-07-29 (ver baldes.js), que já dizia que o conjunto manda — agora
// vale para todos, não só para WhatsApp. PURO: sem rede, sem tela.

// Os mercados que este módulo reconhece. 'misto' e 'desconhecido' NÃO entram
// aqui de propósito: não são mercados, são vereditos sobre a AUSÊNCIA ou a
// MULTIPLICIDADE de mercado — e quem consome (alvos.js) não tem alvo pra eles.
export const MERCADOS = ['conversa', 'perfil', 'video', 'post', 'site_venda', 'site_trafego'];

// DESTINO decide sozinho quando ele já é inequívoco. As três formas de destino
// de perfil (INSTAGRAM_PROFILE, INSTAGRAM_PROFILE_AND_FACEBOOK_PAGE) e as três
// otimizações de perfil observadas (PROFILE_AND_PAGE_ENGAGEMENT, PROFILE_VISIT,
// VISIT_INSTAGRAM_PROFILE) são o mesmo mercado, então basta o destino: não
// precisa saber QUAL otimização o gestor escolheu pra saber que é perfil.
//
// `WEBSITE` e `UNDEFINED` NÃO entram aqui — ver `DESTINOS_QUE_EXIGEM_DESEMPATE`
// logo abaixo. Já apareceram nesta lista e voltaram (rodada de correção
// 25/09/2026): `WEBSITE` estava cravado como `site_venda`, e uma campanha
// `WEBSITE` + `LANDING_PAGE_VIEWS` — tráfego para site, caso comuníssimo —
// virava `site_venda` e era julgada por CAC. É a mesma classe de defeito que
// esta onda existe pra matar: o `[FLUXO SHOPPING]` levou "reduzir" e o
// `[SEGUIDORES][REMARKETING]` saiu a 1455× da meta, os dois por régua de
// mercado errado.
//
// Exportado (além da API pública do brief) só para a trava de consistência
// abaixo viver como TESTE, e não como `throw` na carga do módulo — um `throw`
// aqui dentro derrubaria a IMPORTAÇÃO inteira quando a invariante quebrasse, e
// com ela qualquer tela que importe isto transitivamente, em vez de falhar só
// na suíte (rodada de correção 2, 25/09/2026). A checagem em si mora em
// mercados.test.mjs ("trava de consistência").
export const MERCADO_POR_DESTINO = {
  WHATSAPP: 'conversa',
  INSTAGRAM_PROFILE: 'perfil',
  INSTAGRAM_PROFILE_AND_FACEBOOK_PAGE: 'perfil',
  ON_VIDEO: 'video',
  ON_POST: 'post',
};

// Destinos que O NOME NÃO BASTA — a família é "site", mas só a otimização diz
// se é venda ou tráfego. Fica como DADO, ao lado do mapa acima, pra quem
// acrescentar um destino novo ver os dois casos que existem (decide sozinho
// vs. exige desempate) em vez de descobrir isso lendo a função.
//
//   WEBSITE   — pode vir com OFFSITE_CONVERSIONS (venda) ou LANDING_PAGE_VIEWS
//               /LINK_CLICKS (tráfego). O destino é o mesmo nos dois casos.
//   UNDEFINED — a Meta manda isso pra tráfego de site sem pixel de conversão;
//               não é ausência de destino, é o próprio destino dizendo "não
//               especifiquei" — mesma ambiguidade do WEBSITE.
export const DESTINOS_QUE_EXIGEM_DESEMPATE = new Set(['WEBSITE', 'UNDEFINED']);

// OTIMIZAÇÃO só é consultada quando o destino não decidiu sozinho — é o
// desempate dos `DESTINOS_QUE_EXIGEM_DESEMPATE`, e também a última tentativa
// pra um destino que este módulo ainda não conhece. Sinal que não bate aqui
// também é 'desconhecido' — nunca cai de volta no mapa de destino nem chuta
// por proximidade de nome.
const MERCADO_POR_OTIMIZACAO = {
  CONVERSATIONS: 'conversa',
  PROFILE_AND_PAGE_ENGAGEMENT: 'perfil',
  PROFILE_VISIT: 'perfil',
  VISIT_INSTAGRAM_PROFILE: 'perfil',
  THRUPLAY: 'video',
  POST_ENGAGEMENT: 'post',
  OFFSITE_CONVERSIONS: 'site_venda',
  LANDING_PAGE_VIEWS: 'site_trafego',
  LINK_CLICKS: 'site_trafego',
};

// O mercado de UM conjunto: destino primeiro, otimização como desempate. Sinal
// que não bate em nenhuma das duas tabelas devolve 'desconhecido' — nunca
// chuta por proximidade de nome nem por objetivo declarado. Isso vale também
// para `WEBSITE` com uma otimização que este módulo não reconhece: melhor
// dizer "não sei medir esta" do que julgar pela régua errada.
export function mercadoDoConjunto(conjunto) {
  const destino = String((conjunto && conjunto.destination_type) || '').toUpperCase();
  if (destino in MERCADO_POR_DESTINO) return MERCADO_POR_DESTINO[destino];

  const otimizacao = String((conjunto && conjunto.optimization_goal) || '').toUpperCase();
  return otimizacao in MERCADO_POR_OTIMIZACAO ? MERCADO_POR_OTIMIZACAO[otimizacao] : 'desconhecido';
}

// O mercado de uma CAMPANHA: o conjunto dos mercados dos seus conjuntos, MENOS
// os sinais irreconhecíveis (que não votam nem a favor nem contra). Zero
// conjuntos reconhecidos vira 'desconhecido'; um mercado só, esse mercado;
// mais de um, 'misto' — porque somar gasto e resultado de mercados diferentes
// produz um custo por unidade que não representa nada (o caso real é a
// [LEADS LOJA][mixconversão] da Vessel: um conjunto de WhatsApp e um de site
// na mesma campanha, ao mesmo tempo).
export function mercadoDaCampanha(conjuntos) {
  if (!Array.isArray(conjuntos) || conjuntos.length === 0) return 'desconhecido';

  const mercadosReconhecidos = new Set(
    conjuntos.map(mercadoDoConjunto).filter((mercado) => mercado !== 'desconhecido'),
  );

  if (mercadosReconhecidos.size === 0) return 'desconhecido';
  if (mercadosReconhecidos.size > 1) return 'misto';
  return [...mercadosReconhecidos][0];
}
