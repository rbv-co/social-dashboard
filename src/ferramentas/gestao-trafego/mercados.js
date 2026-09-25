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
// `UNDEFINED` (destino nulo/genérico que a Meta devolve pra tráfego de site sem
// pixel de conversão) fica de fora deste mapa DE PROPÓSITO: sozinho ele não
// diz nada, e é exatamente o caso em que a otimização precisa desempatar.
const MERCADO_POR_DESTINO = {
  WHATSAPP: 'conversa',
  INSTAGRAM_PROFILE: 'perfil',
  INSTAGRAM_PROFILE_AND_FACEBOOK_PAGE: 'perfil',
  ON_VIDEO: 'video',
  ON_POST: 'post',
  WEBSITE: 'site_venda',
};

// OTIMIZAÇÃO só é consultada quando o destino não decidiu — é o desempate, não
// um segundo voto. `LANDING_PAGE_VIEWS` é o caso que abre este mapa: é o único
// sinal que diferencia tráfego de site (sem pixel de conversão) de venda de
// site (com `OFFSITE_CONVERSIONS`), porque o destino das duas é `UNDEFINED`
// numa e `WEBSITE` na outra — mas se algum dia a Meta mandar `UNDEFINED` com
// `OFFSITE_CONVERSIONS`, cai aqui como site_venda, coerente com o que ela mede.
const MERCADO_POR_OTIMIZACAO = {
  CONVERSATIONS: 'conversa',
  PROFILE_AND_PAGE_ENGAGEMENT: 'perfil',
  PROFILE_VISIT: 'perfil',
  VISIT_INSTAGRAM_PROFILE: 'perfil',
  THRUPLAY: 'video',
  POST_ENGAGEMENT: 'post',
  OFFSITE_CONVERSIONS: 'site_venda',
  LANDING_PAGE_VIEWS: 'site_trafego',
};

// O mercado de UM conjunto: destino primeiro, otimização como desempate. Sinal
// que não bate em nenhuma das duas tabelas devolve 'desconhecido' — nunca
// chuta por proximidade de nome nem por objetivo declarado.
export function mercadoDoConjunto(conjunto) {
  const destino = String((conjunto && conjunto.destination_type) || '').toUpperCase();
  const porDestino = MERCADO_POR_DESTINO[destino];
  if (porDestino) return porDestino;

  const otimizacao = String((conjunto && conjunto.optimization_goal) || '').toUpperCase();
  return MERCADO_POR_OTIMIZACAO[otimizacao] || 'desconhecido';
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
