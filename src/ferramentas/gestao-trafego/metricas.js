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
// SÓ para o mercado `perfil` (Instagram) — NÃO reaproveita _GT_VISIT.
//
// O BUG, com número (achado 25/09/2026): _gtActionVal devolve o PRIMEIRO tipo
// que existir na lista, e em campanha de perfil chega `landing_page_view`
// como RESÍDUO (a Meta às vezes grava 1 ou 2 por vazamento de pixel, mesmo
// sem site nenhum no destino). No [SEGUIDORES][REMARKETING] da Raíssa:
// landing_page_view=1, link_click=3.203. Usando _GT_VISIT (que tenta
// landing_page_view primeiro) o custo saía R$ 283,84/1 = R$ 247,45 — 1.455×
// a meta, "reduzir" numa rodada real. O clique é o número de gente de
// verdade levada ao perfil; com ele: R$ 283,84/3.203 = R$ 0,09.
//
// NÃO é falta de dado, é ORDEM DA LISTA — por isso o conserto não é mexer em
// _GT_VISIT (ele continua certo para o mercado `site_trafego`, onde
// landing_page_view primeiro É o comportamento certo): nasce uma lista
// própria, só com o sinal que faz sentido para perfil.
export const _GT_VISIT_PERFIL=['link_click'];
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
  // Mercado `perfil` (25/09/2026) — ver _GT_VISIT_PERFIL acima para o bug que
  // isto conserta. `_gtPerGasto` já devolve null (nunca 0) sem clique na
  // janela, então uma campanha nova sem resultado ainda não vira "de graça".
  visitas_perfil:{label:'Visitas ao perfil',fmt:'int',compute:r=>_gtActionVal(r,_GT_VISIT_PERFIL)},
  custo_visita_perfil:{label:'Custo por visita ao perfil',fmt:'money',compute:r=>_gtPerGasto(r,_GT_VISIT_PERFIL)},
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
  // Rótulo alinhado com ALVOS.mensagens.rotulo (decisão do dono, 24/09/2026:
  // conversa iniciada no WhatsApp/Direct É lead pra ele). Era 'Custo/Conversa'
  // — corrigido na rodada de correção 2 (25/09/2026) porque o texto de ajuda
  // (`custo_conversa` em ajuda.js) afirmava "a tela mostra Custo por lead" e
  // isso era falso enquanto este label dizia outra coisa. Nunca aparece na
  // mesma lista de KPIs que `custo_lead` (ver GT_BALDE_PADRAO logo abaixo:
  // 'engajamento'/'mensagens' usam esta chave, 'leads' usa a outra) — os dois
  // rótulos iguais não colidem no mesmo cartão.
  custo_conversa:{label:'Custo/Lead',fmt:'money',compute:r=>_gtPerGasto(r,_GT_MSG)},
  conexoes_msg:{label:'Conexões de mensagem',fmt:'int',compute:r=>_gtActionVal(r,_GT_MSG_CONN)},
  primeira_resposta:{label:'1ª resposta',fmt:'int',compute:r=>_gtActionVal(r,_GT_MSG_REPLY)},
  // --- Vídeo e engajamento ---
  video_views:{label:'Views de vídeo',fmt:'int',compute:r=>_gtActionVal(r,_GT_VIDEO)},
  // Mercado `video` (25/09/2026, Onda C) — o [FLUXO SHOPPING] da Vessel é
  // ON_VIDEO/THRUPLAY, e antes desta troca caía no balde de engajamento e era
  // julgado por ponto ou por engajamento bruto, nenhum dos dois mede vídeo
  // (11.323 views viravam 44 pontos ponderados — "reduzir" em 24/09 por régua
  // errada). O produto dela é view, então o custo é por view.
  custo_view:{label:'Custo por view',fmt:'money',compute:r=>_gtPerGasto(r,_GT_VIDEO)},
  engaj_pub:{label:'Engajamento da publicação',fmt:'int',compute:r=>_gtActionVal(r,_GT_POSTENG)},
  // O custo do engajamento BRUTO — o que a Meta conta como post_engagement, sem
  // pesar interação por valor. Substituiu o custo por ponto como régua de
  // engajamento em 24/09/2026: medindo campanhas reais, a [FLUXO SHOPPING] da
  // Vessel tinha 11.323 engajamentos e só 44 pontos ponderados, porque quase
  // nada do que a Meta conta ali é curtida/comentário/salvamento/compartilhamento.
  // As duas réguas não medem a mesma coisa em unidades diferentes — medem coisas
  // diferentes. Ver docs/superpowers/specs/2026-09-24-gt-onda-b-design.md.
  custo_engajamento:{label:'Custo por engajamento',fmt:'money',compute:r=>_gtPerGasto(r,_GT_POSTENG)},
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

// O CUSTO POR RESULTADO deste MERCADO (alvos.js diz qual unidade é: custo por
// lead, CAC, custo por visita, custo por visita ao perfil, custo por view,
// custo por engajamento). Recebe a chave de `MERCADOS` (mercados.js) — ou,
// enquanto código antigo não migrou (Onda C, ver alvos.js), um nome de balde
// legado, que simplesmente não bate em `ALVOS` e devolve null (nunca inventa).
//
// REINDEXADO POR MERCADO em 25/09/2026 (Onda C): o parâmetro ainda se chama
// `balde` por compatibilidade com quem chama assim, mas o valor que importa é
// a CHAVE de `ALVOS`, que agora é mercado — o que o conjunto afirma —, não o
// objetivo declarado.
//
// A guarda `alvo.metrica === 'ponderada'` não dispara mais no caminho normal
// — desde a troca de régua de 24/09/2026, o mercado `post` (o mais parecido
// com o antigo balde de engajamento) usa `custo_engajamento` como qualquer
// outro mercado (ver ALVOS.post em alvos.js). Ela continua
// aqui só para NÃO QUEBRAR: `GT_METRIC_CATALOG` nunca teve (e não tem) uma
// entrada `'ponderada'`, então sem a guarda `GT_METRIC_CATALOG[alvo.metrica]`
// daria `undefined` e o `.compute` seguinte estouraria.
// CORREÇÃO (revisão final da Onda B, correção 2, 25/09/2026): isto NÃO é
// "religar pronto". Trocar `metrica` de volta para `'ponderada'` em alvos.js
// faz esta função devolver `null` — a guarda barra o crash, mas não calcula
// coisa nenhuma no lugar. O custo por ponto de verdade mora só em
// `calcularPonderada` (ponderada.js), que este arquivo nunca chamou; um
// revert de verdade precisa desviar para lá AQUI. São DOIS lugares no total
// (contados de verdade, não por arquivo tocado): este `custoDoAlvo` e a
// leitura do cartão em tela-de-gestao-trafego.vue (mesmo problema — lê o
// mesmo catálogo sem entrada 'ponderada' — mais os chips "Custo/ponto" e
// "Qualidade", removidos de lá, que precisariam voltar a ser desenhados).
// `custoAtualDoAlvo` (budget-ia.mjs) NÃO é um terceiro lugar: ele só chama
// esta função (`return custoDoAlvo(balde, ins)` no caminho sem interação
// declarada) — corrigido aqui, ele acompanha sem precisar de nenhuma edição
// própria. O interruptor JÁ EXISTE (Seção 1 da régua,
// `ponderadaLigada` em regua.js) e guarda a escolha; o que falta é ele trocar
// também o CÁLCULO nesses dois lugares — é a T4b, pendente.
//
// Devolve null (e nunca 0) quando não há resultado ou não há gasto na janela:
// um custo de R$ 0,00 escrito no prompt é lido pelo modelo como "de graça" e
// vira recomendação de escalar.
// Um "insight" SINTÉTICO de CONJUNTO, juntando gasto e `actions` dos ANÚNCIOS
// que pertencem a ele — para o KPI de CADA conjunto na campanha MISTA (Onda C,
// Tarefa 5, ver mercados.js seção 2.1). O robô (coletor/budget-ia.mjs) busca
// insight por adset direto na Graph API (`level: 'adset'`); a tela não faz
// essa chamada extra: ela já tem os anúncios do conjunto (vindos de
// montarHierarquia, com `actions`/`spend` de cada anúncio), e somar por dentro
// chega ao MESMO número sem gastar mais uma chamada à Meta por conta, por dia.
// Ausência de anúncio (conjunto sem gasto na janela) devolve spend '0' e
// actions vazio — `_gtActionVal`/`_gtPerGasto` já leem isso como null, nunca
// como zero. PURO.
//
// I4 (rodada de correção 2, 25/09/2026): também soma `impressions`. Faltava —
// só `spend` e `actions` eram somados —, e o mercado `reconhecimento` mede por
// CPM (`GT_METRIC_CATALOG.cpm`, ver alvos.js: `metrica: 'cpm'`), que só existe
// dividindo gasto por IMPRESSÃO, não por nenhuma `action`. Um conjunto de
// alcance dentro de uma campanha MISTA ficava sem KPI nenhum, em silêncio:
// `cpm.compute` lia `r.impressions` como `undefined`, `_gtNum` devolvia `NaN`
// (não passa em `isFinite`), então `null` — a régua ficava muda exatamente
// para o mercado que só tem essa métrica, furando a regra de "cada conjunto
// mostra a própria régua" e divergindo do robô, que usa insight de adset REAL
// (com `impressions` de verdade) e por isso sempre tem o número.
// Os demais mercados usam métrica por `action` (`custo_conversa`,
// `custo_visita`, `custo_lead`, `custo_view`, `custo_engajamento`, `cac`,
// `custo_visita_perfil`) — nenhum precisa de outro campo bruto do anúncio além
// de `spend`/`actions`; `reconhecimento`/`cpm` era o único buraco.
export function insightDoConjunto(anuncios) {
  const lista = Array.isArray(anuncios) ? anuncios : [];
  let spend = 0;
  let impressions = 0;
  const porTipo = new Map();
  for (const a of lista) {
    spend += Number(a && a.spend) || 0;
    impressions += Number(a && a.impressions) || 0;
    for (const ac of ((a && Array.isArray(a.actions)) ? a.actions : [])) {
      const tipo = ac && ac.action_type;
      if (!tipo) continue;
      porTipo.set(tipo, (porTipo.get(tipo) || 0) + (Number(ac.value) || 0));
    }
  }
  const actions = [...porTipo.entries()].map(([action_type, value]) => ({ action_type, value: String(value) }));
  return { spend: String(spend), impressions: String(impressions), actions };
}

export function custoDoAlvo(balde, insight) {
  const alvo = alvoDoBalde(balde);
  if (!alvo || alvo.metrica === 'ponderada') return null;
  const m = GT_METRIC_CATALOG[alvo.metrica];
  if (!m) return null;
  const v = m.compute(insight || {});
  return (v != null && Number.isFinite(v) && v > 0) ? v : null;
}
