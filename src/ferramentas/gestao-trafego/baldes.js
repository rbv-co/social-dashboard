// De qual TIPO é esta campanha — o "balde" que decide qual meta da régua vale
// para ela (ver alvos.js).
//
// Vive num módulo próprio porque a TELA e o ROBÔ precisam da mesma resposta.
// Enquanto isto era uma constante dentro do .vue, o robô não tinha como saber a
// que balde a campanha pertencia, então julgava por critério próprio (CTR, CPC)
// enquanto a tela julgava pela meta do dono — dois juízes discordando sobre a
// mesma campanha. Duplicar o mapa no robô só teria adiado a divergência.
// PURO: sem rede, sem tela.

export const GT_OBJETIVO_BALDE = {
  OUTCOME_TRAFFIC: 'trafego', LINK_CLICKS: 'trafego',
  OUTCOME_SALES: 'vendas', CONVERSIONS: 'vendas', PRODUCT_CATALOG_SALES: 'vendas',
  OUTCOME_AWARENESS: 'reconhecimento', BRAND_AWARENESS: 'reconhecimento', REACH: 'reconhecimento', VIDEO_VIEWS: 'reconhecimento',
  // Engajamento inclui as campanhas de MENSAGEM modernas (OUTCOME_ENGAGEMENT com
  // destino WhatsApp), por isso o balde de engajamento também tem Conversas
  // iniciadas. MESSAGES (objetivo antigo de mensagem) tem balde próprio.
  OUTCOME_ENGAGEMENT: 'engajamento', POST_ENGAGEMENT: 'engajamento', PAGE_LIKES: 'engajamento',
  MESSAGES: 'mensagens',
  OUTCOME_LEADS: 'leads', LEAD_GENERATION: 'leads',
};

// Objetivo desconhecido cai em 'padrao', que NÃO tem meta em alvos.js — e sem
// meta o cálculo devolve 'sem-dados' em vez de julgar pela régua errada.
export function baldeDoObjetivo(objective) {
  return GT_OBJETIVO_BALDE[String(objective || '').toUpperCase()] || 'padrao';
}

// Campanha de WhatsApp de verdade é a que a META AFIRMA ser, olhando o CONJUNTO:
// `destination_type = WHATSAPP` ou `optimization_goal = CONVERSATIONS`.
//
// O teste antigo era "tem alguma ação de mensagem?", e UMA conversa espontânea
// bastava: a "[TRÁFEGO] VIAGENS | PERFIL" (R$ 5.706, 4.601 curtidas, 18
// conversas de tabela) era medida a R$ 317 por conversa contra meta de R$ 15.
// Corrigir isso mudou 6 campanhas e R$ 15.177 (PR #51).
export function ehDeWhatsapp(conjuntos) {
  return (conjuntos || []).some((s) => String((s && s.destination_type) || '').toUpperCase() === 'WHATSAPP'
    || String((s && s.optimization_goal) || '').toUpperCase() === 'CONVERSATIONS');
}

// O balde EFETIVO: campanha cujo CONJUNTO diz destino WhatsApp é medida por
// conversa, seja qual for o objetivo declarado na campanha.
//
// A regra já valeu só para engajamento, com o argumento de que uma campanha de
// LEAD já teria a meta certa do próprio balde. Os dados desmentiram (2026-07-29,
// decisão do dono): oito campanhas de 'leads'/'trafego'/'vendas' com destino
// WhatsApp somam R$ 33.314 em 90 dias e CINCO delas têm zero ou dois leads. A
// "[Leads] Para WhatsApp" da Motoeasy gastou R$ 9.738 com 2 leads e 1.020
// conversas — medida por lead dava R$ 4.869, um número sem significado; por
// conversa dá R$ 10.
//
// A diferença para o bug de 2026-07-28 (quando UMA conversa espontânea fazia uma
// campanha virar WhatsApp) é o SINAL: lá a inferência vinha do resultado, aqui
// vem do que a Meta AFIRMA no conjunto. Este sinal não deu falso positivo em
// nenhuma das cinco contas.
export function baldeEfetivo(objective, conjuntos) {
  const balde = baldeDoObjetivo(objective);
  if (ehDeWhatsapp(conjuntos)) return 'mensagens';
  return balde;
}

// Campanha DE SEGUIDORES — a Meta não devolve NADA que identifique isso: não
// há ação de "novo seguidor" por campanha (conferido na Graph API real,
// 12/09/2026, ver db/migrations/2026-09-12-meta-ads-hora-cliques.sql e
// .../2026-09-12-meta-ads-hora-visitas-perfil-da-conta.sql — nenhuma campanha
// testada tinha essa ação). O NOME que o gestor de tráfego escreveu na Meta é
// o único sinal que existe. Isto é MULETA até a Onda B (dar a estas campanhas
// um alvo próprio, custo por seguidor estimado — ver
// docs/superpowers/specs/2026-09-24-gt-analise-potente-design.md); aqui só
// serve pra parar o robô de julgar por um custo que não mede seguidor nenhum.
//
// Os nomes reais NÃO seguem um padrão único — já apareceram, nas contas:
//   [+SEGUIDORES] SeguidoresParceiros            (sem espaço)
//   [+ SEGUIDORES] DETALHES | P3                 (com espaço)
//   [SEGUIDORES][REMARKETING]                    (sem o "+")
//   [400]_AXIOM_05_SEGUID_VESSEL-CAMPINAS        (abreviado, no meio do nome)
// Um `startsWith('[+ SEGUIDORES]')` (o que relatorio-por-hora.js:36 faz, pra
// outro fim) pegaria menos da metade destes. Por isso o critério aqui é
// "contém SEGUID em qualquer posição", sem diferenciar maiúsculas/acentos —
// cobre as quatro formas acima sem exigir prefixo fixo.
//
// NÃO confundir com campanha de VISITAS AO PERFIL (ex.:
// "[300]_VESSEL_PERFIL_TOPO_VISITAS_ABO_260922_LOCALIZAÇÃO"): essa mede
// visita mesmo, tem custo por resultado válido, e não deve cair aqui — o
// nome dela não contém "SEGUID".
export function ehDeSeguidores(nome) {
  const normalizado = String(nome || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // tira acento, se algum dia aparecer um
    .toUpperCase();
  return normalizado.includes('SEGUID');
}

// O balde de um objetivo da FÁBRICA — recebe a linha inteira de
// `fabrica_objetivos` (chave, rotulo, meta_objective, destination_type,
// optimization_goal…).
//
// POR QUE MORA AQUI, e não na tela da Fábrica: a linha da Fábrica carrega os
// MESMOS dois sinais que o Gestor lê do conjunto — `destination_type` e
// `optimization_goal`. O objetivo padrão da Fábrica é
// ('engajamento','Engajamento (WhatsApp)', OUTCOME_ENGAGEMENT, CONVERSATIONS,
// WHATSAPP): olhar só o `meta_objective` joga fora exatamente o sinal que a
// correção de 2026-07-29 foi construída em cima, e a campanha de WhatsApp volta
// a ser tratada como engajamento comum. Esse erro de classificação já foi
// cometido duas vezes neste produto; a terceira só é evitada se a regra tiver UM
// lugar. O Gestor vai ganhar a mesma faixa de sugestões — e uma regra que mora
// no componente da Fábrica é uma regra que será rededuzida lá, diferente.
//
// Repare que ele não RECOPIA a regra: passa a própria linha como se fosse um
// conjunto para o `baldeEfetivo`, porque os nomes dos campos são os mesmos. Se a
// regra de WhatsApp mudar, muda uma vez só.
//
// A GUARDA DO `optimization_goal` É SOBRE QUEM CHAMA, NÃO SOBRE O DADO.
// Na migration 022 a coluna é `not null`: linha de verdade SEMPRE tem valor. Então
// chegar aqui sem ele não quer dizer "esta linha não tem" — quer dizer que o
// `select` de quem chamou não pediu a coluna. E aí acontece o pior caso possível:
//
//   baldeDoObjetivoDaFabrica({ chave:'engajamento', meta_objective:'OUTCOME_ENGAGEMENT' })
//
// devolveria 'engajamento' com toda a confiança — o erro de classificação de novo,
// em silêncio, sem exceção e sem teste vermelho. Enquanto só a Fábrica chama, o que
// segura isso é uma STRING de `select` num .vue; quando o Gestor ganhar a mesma
// faixa, um `select` mais curto ressuscita o bug com a suíte inteira verde.
//
// Por isso a falta da coluna cai em 'padrao', que é o balde sem meta: quem chama
// trata como "não sei" e a faixa de sugestões simplesmente não abre. Responder
// errado com confiança é pior que não responder.
//
// `destination_type` NÃO serve de guarda: ele é nulo de verdade no 'branding'
// (a única linha sem messaging), então ausência ali é dado legítimo.
export function baldeDoObjetivoDaFabrica(objetivo) {
  if (!objetivo || typeof objetivo !== 'object') return 'padrao';
  if (typeof objetivo.optimization_goal !== 'string' || !objetivo.optimization_goal.trim()) return 'padrao';
  return baldeEfetivo(objetivo.meta_objective, [objetivo]);
}
