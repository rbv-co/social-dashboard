import { alvoDoBalde } from './alvos.js';

// As MÉTRICAS do Meta Ads: como ler o array `actions` e quanto custou cada
// resultado. PURO: sem rede, sem tela.
//
// Vive num módulo próprio pelo MESMO motivo de baldes.js: a tela e o robô
// precisam da mesma resposta. Enquanto este catálogo morava dentro do .vue, o
// robô não tinha como calcular o custo por resultado — e por isso mandava ao
// Opus a META da conta com o custo atual NULO em toda campanha que não fosse
// de engajamento (a única cujo custo já morava num módulo puro, ponderada.js).
// O modelo recebia a régua sem o número que ela mede.

export function _gtNum(x){ const n=Number(x); return isFinite(n)?n:null; }
export function _gtActionVal(row, tipos){
  const arr=row&&row.actions; if(!Array.isArray(arr))return null;
  for(const t of tipos){ const a=arr.find(x=>x.action_type===t); if(a)return _gtNum(a.value); }
  return null;
}
export function _gtActionValue(row, tipos){
  const arr=row&&row.action_values; if(!Array.isArray(arr))return null;
  for(const t of tipos){ const a=arr.find(x=>x.action_type===t); if(a)return _gtNum(a.value); }
  return null;
}
export const _GT_PURCHASE=['purchase','omni_purchase','offsite_conversion.fb_pixel_purchase'];
export const _GT_LEAD=['lead','onsite_conversion.lead_grouped','offsite_conversion.fb_pixel_lead'];
export const _GT_VISIT=['landing_page_view','link_click'];
// Mensagens (WhatsApp/Direct): action_types REAIS conferidos na API (La Vessel I, 2026-07).
// "Conversas iniciadas" é o messaging_conversation_started_7d — o resultado principal das
// campanhas de mensagem (WhatsApp). Os outros são etapas mais fundas da conversa.
export const _GT_MSG=['onsite_conversion.messaging_conversation_started_7d','onsite_conversion.messaging_conversation_started'];
export const _GT_MSG_CONN=['onsite_conversion.total_messaging_connection'];
export const _GT_MSG_REPLY=['onsite_conversion.messaging_first_reply'];
export const _GT_ATC=['add_to_cart','omni_add_to_cart','offsite_conversion.fb_pixel_add_to_cart'];
export const _GT_IC=['initiate_checkout','omni_initiated_checkout','offsite_conversion.fb_pixel_initiate_checkout'];
export const _GT_VIDEO=['video_view'];
export const _GT_POSTENG=['post_engagement'];
export const _GT_LPV=['landing_page_view'];
export const _gtPerGasto=(r,tipos)=>{ const n=_gtActionVal(r,tipos),s=_gtNum(r.spend); return n?s/n:null; };
export const GT_METRIC_CATALOG={
  alcance:{label:'Alcance',fmt:'int',compute:r=>_gtNum(r.reach)},
  impressoes:{label:'Impressões',fmt:'int',compute:r=>_gtNum(r.impressions)},
  frequencia:{label:'Frequência',fmt:'dec',compute:r=>_gtNum(r.frequency)},
  ctr:{label:'CTR',fmt:'pct',compute:r=>_gtNum(r.ctr)},
  cpc:{label:'CPC',fmt:'money',compute:r=>_gtNum(r.cpc)},
  cpm:{label:'CPM',fmt:'money',compute:r=>{const i=_gtNum(r.impressions),s=_gtNum(r.spend);return i?s/i*1000:null;}},
  cliques:{label:'Cliques',fmt:'int',compute:r=>_gtNum(r.clicks)},
  visitas:{label:'Visitas',fmt:'int',compute:r=>_gtActionVal(r,_GT_VISIT)},
  custo_visita:{label:'Custo/Visita',fmt:'money',compute:r=>_gtPerGasto(r,_GT_VISIT)},
  lpv:{label:'Visualizações da página',fmt:'int',compute:r=>_gtActionVal(r,_GT_LPV)},
  compras:{label:'Compras',fmt:'int',compute:r=>_gtActionVal(r,_GT_PURCHASE)},
  valor_conversao:{label:'Valor de conversão',fmt:'money',compute:r=>_gtActionValue(r,_GT_PURCHASE)},
  roas:{label:'ROAS',fmt:'x',compute:r=>{const pr=r.purchase_roas&&r.purchase_roas[0]&&_gtNum(r.purchase_roas[0].value);if(pr!=null)return pr;const v=_gtActionValue(r,_GT_PURCHASE),s=_gtNum(r.spend);return (v!=null&&s)?v/s:null;}},
  cac:{label:'CAC',fmt:'money',compute:r=>{const c=_gtActionVal(r,_GT_PURCHASE),s=_gtNum(r.spend);return c?s/c:null;}},
  add_carrinho:{label:'Add. ao carrinho',fmt:'int',compute:r=>_gtActionVal(r,_GT_ATC)},
  checkout:{label:'Checkout iniciado',fmt:'int',compute:r=>_gtActionVal(r,_GT_IC)},
  gasto:{label:'Gasto',fmt:'money',compute:r=>_gtNum(r.spend)},
  leads:{label:'Leads',fmt:'int',compute:r=>_gtActionVal(r,_GT_LEAD)},
  custo_lead:{label:'Custo/Lead',fmt:'money',compute:r=>{const l=_gtActionVal(r,_GT_LEAD),s=_gtNum(r.spend);return l?s/l:null;}},
  // --- Mensagens (WhatsApp/Direct) ---
  conversas:{label:'Conversas iniciadas',fmt:'int',compute:r=>_gtActionVal(r,_GT_MSG)},
  custo_conversa:{label:'Custo/Conversa',fmt:'money',compute:r=>_gtPerGasto(r,_GT_MSG)},
  conexoes_msg:{label:'Conexões de mensagem',fmt:'int',compute:r=>_gtActionVal(r,_GT_MSG_CONN)},
  primeira_resposta:{label:'1ª resposta',fmt:'int',compute:r=>_gtActionVal(r,_GT_MSG_REPLY)},
  // --- Vídeo e engajamento ---
  video_views:{label:'Views de vídeo',fmt:'int',compute:r=>_gtActionVal(r,_GT_VIDEO)},
  engaj_pub:{label:'Engajamento da publicação',fmt:'int',compute:r=>_gtActionVal(r,_GT_POSTENG)},
};
export const GT_BALDE_PADRAO={
  // custo_visita é a métrica que DECIDE o veredito deste balde (ver alvos.js
  // ALVOS.trafego) — precisa aparecer no cartão, senão o dono vê o selo mudar
  // sem enxergar o número que o explica (I6 do review final, 2026-07-28).
  trafego:['ctr','cpc','visitas','custo_visita','cpm'],
  vendas:['roas','cac','valor_conversao','compras'],
  reconhecimento:['alcance','cpm','frequencia','impressoes'],
  // Conversas iniciadas primeiro: é o resultado principal das campanhas de WhatsApp (La Vessel I).
  // Em campanha de engajamento sem mensagem, "conversas" aparece como "—" (sem ação de mensagem).
  engajamento:['conversas','custo_conversa','ctr','gasto'],
  mensagens:['conversas','custo_conversa','conexoes_msg','gasto'],
  leads:['leads','custo_lead','ctr','gasto'],
  padrao:['ctr','cpc','gasto','alcance'],
};

// O CUSTO POR RESULTADO deste tipo de campanha, na unidade dele (alvos.js diz
// qual é: custo por lead, CAC, custo por visita, custo por conversa, CPM).
//
// Engajamento devolve null de propósito: o resultado dele é o PONTO ponderado,
// e quem calcula isso é ponderada.js. Dois cálculos para o mesmo balde
// acabariam discordando.
//
// Devolve null (e nunca 0) quando não há resultado ou não há gasto na janela:
// um custo de R$ 0,00 escrito no prompt é lido pelo modelo como "de graça" e
// vira recomendação de escalar.
export function custoDoAlvo(balde, insight) {
  const alvo = alvoDoBalde(balde);
  if (!alvo || alvo.metrica === 'ponderada') return null;
  const m = GT_METRIC_CATALOG[alvo.metrica];
  if (!m) return null;
  const v = m.compute(insight || {});
  return (v != null && Number.isFinite(v) && v > 0) ? v : null;
}
