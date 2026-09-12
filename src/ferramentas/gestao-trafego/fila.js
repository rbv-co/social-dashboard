// A FILA DE APROVAÇÃO: o que o robô propôs e ainda espera uma decisão do dono.
//
// POR QUE ELA EXISTE: até aqui a sugestão da IA vinha com um botão no próprio
// cartão da campanha que mexia no orçamento na hora. Com a fila, mexer em
// dinheiro passa a ter UM caminho só, com registro de quem decidiu e quando —
// e o cartão volta a ser só a leitura da campanha.
//
// PURO: sem rede, sem tela, sem relógio próprio (o `agora` entra por parâmetro,
// senão não dá pra testar o silêncio de 7 dias sem esperar 7 dias).

// Quanto tempo uma recusa cala aquela campanha. Decisão do dono (2026-07-29):
// recusar não pode virar "não me mostre nunca mais" — a situação muda —, mas
// também não pode reaparecer no dia seguinte, senão a fila repete todo dia o
// que ele já respondeu.
export const DIAS_DE_SILENCIO = 7;

const ms = (dias) => dias * 24 * 60 * 60 * 1000;
const quando = (v) => { const d = v ? new Date(v) : null; return (d && !isNaN(d)) ? d.getTime() : null; };

// "Manter" não é ação: não há nada pra aprovar num conselho de não mexer. Deixar
// esses itens na fila encheria a lista de decisões que não existem — das 38
// análises guardadas em 29/07, 12 eram 'manter'.
export function pedeAcao(analise) {
  const v = analise && analise.veredito;
  return v === 'escalar' || v === 'reduzir' || v === 'pausar';
}

// Reparte um total novo entre os conjuntos ATIVOS, mantendo a proporção que o
// dono já escolheu entre eles: quem tinha o dobro continua com o dobro.
//
// Os centavos que sobram do arredondamento vão pros MAIORES RESTOS (método do
// maior resto). Sem isso, arredondar cada parte por conta própria faz a soma
// não bater com o total aprovado — no caso real da "MODA & BOLSAS" (R$ 230 →
// R$ 280 em 4 conjuntos) a diferença aparece já na primeira conta. Aprovar
// R$ 280 e aplicar R$ 279,98 é uma promessa quebrada em silêncio.
//
// → [{ ...conjunto, deCentavos, paraCentavos }] — a soma dos `paraCentavos` é
//   EXATAMENTE `totalNovoCentavos`. Devolve [] quando não dá pra repartir.
export function distribuirEntreConjuntos(conjuntos, totalNovoCentavos) {
  const lista = (conjuntos || []).filter((c) => c && Number(c.deCentavos) > 0);
  const total = Number(totalNovoCentavos);
  if (!lista.length || !Number.isFinite(total) || total <= 0) return [];
  const soma = lista.reduce((t, c) => t + Number(c.deCentavos), 0);
  if (soma <= 0) return [];

  const partes = lista.map((c) => {
    const exato = (Number(c.deCentavos) / soma) * total;
    const piso = Math.floor(exato);
    return { ...c, paraCentavos: piso, _resto: exato - piso };
  });
  let sobra = total - partes.reduce((t, p) => t + p.paraCentavos, 0);
  // Maior resto primeiro; empate desempata pelo maior orçamento atual, pra que
  // a mesma entrada devolva sempre a mesma saída (nada de ordem instável).
  const ordem = [...partes].sort((a, b) => (b._resto - a._resto) || (b.deCentavos - a.deCentavos));
  for (let i = 0; sobra > 0; i = (i + 1) % ordem.length) { ordem[i].paraCentavos += 1; sobra -= 1; }
  return partes.map(({ _resto, ...p }) => p);
}

// Esta análise já foi respondida? A decisão vale para a análise que existia
// QUANDO ela foi tomada: se o robô gerou uma análise NOVA depois, é outro
// contexto e a pergunta volta a valer.
function jaRespondida(analise, decisao) {
  if (!decisao) return false;
  const decidido = quando(decisao.decidido_em);
  const gerado = quando(analise.gerado_em);
  if (decidido == null) return false;
  if (gerado == null) return true;   // sem saber quando a análise nasceu, a decisão prevalece
  return decidido >= gerado;
}

// Uma recusa cala a campanha por DIAS_DE_SILENCIO — inclusive contra análises
// novas, que é o ponto: o robô regrava todo dia, e sem isso a recusa duraria
// até a próxima rodada, ou seja, algumas horas.
function estaSilenciada(decisao, agoraMs) {
  if (!decisao || decisao.decisao !== 'recusada') return false;
  const ate = quando(decisao.silenciar_ate);
  if (ate != null) return agoraMs < ate;
  const decidido = quando(decisao.decidido_em);
  return decidido != null && agoraMs < decidido + ms(DIAS_DE_SILENCIO);
}

// Análise vencida: passou do `valida_ate` que o próprio robô gravou. Acontece
// quando ele para de reanalisar uma campanha — em 29/07 havia três de 23 a 26
// dias. Não some da tela: vai pra um grupo à parte, porque campanha que o robô
// abandonou é justamente o que ninguém percebe faltando.
function estaVencida(analise, agoraMs) {
  const ate = quando(analise.valida_ate);
  return ate != null && agoraMs >= ate;
}

// Monta a fila a partir das análises do robô e das decisões já tomadas.
// `decisoes` é uma lista; vale a mais recente de cada campanha.
// → { pendentes, vencidas, silenciadas, respondidas } — as três últimas existem
//   pra tela poder CONTAR o que escondeu, em vez de sumir com tudo em silêncio.
export function montarFila(analises, decisoes, agora) {
  const agoraMs = quando(agora) ?? Date.now();
  const porCampanha = new Map();
  for (const d of decisoes || []) {
    if (!d || d.campaign_id == null) continue;
    // Só decisões de ORÇAMENTO calam a sugestão de orçamento. Pausar os
    // criativos de uma campanha não responde se a verba dela deve subir — são
    // perguntas independentes, e sem este filtro uma calaria a outra.
    if (d.escopo && d.escopo !== 'orcamento') continue;
    const chave = String(d.campaign_id);
    const atual = porCampanha.get(chave);
    if (!atual || (quando(d.decidido_em) ?? 0) > (quando(atual.decidido_em) ?? 0)) porCampanha.set(chave, d);
  }

  const saida = { pendentes: [], vencidas: [], silenciadas: [], respondidas: [] };
  for (const a of analises || []) {
    if (!a || a.campaign_id == null || !pedeAcao(a)) continue;
    const d = porCampanha.get(String(a.campaign_id)) || null;
    const item = { ...a, decisao: d };
    // Ordem importa: o silêncio de uma recusa vale mesmo sobre análise nova, e
    // é por isso que ele é checado ANTES de "já respondida".
    if (estaSilenciada(d, agoraMs)) saida.silenciadas.push(item);
    else if (jaRespondida(a, d)) saida.respondidas.push(item);
    else if (estaVencida(a, agoraMs)) saida.vencidas.push(item);
    else saida.pendentes.push(item);
  }
  // Maior gasto primeiro: é onde a decisão do dono pesa mais dinheiro.
  const porValor = (x, y) => (Number(y.budget_atual_centavos) || 0) - (Number(x.budget_atual_centavos) || 0);
  saida.pendentes.sort(porValor);
  saida.vencidas.sort(porValor);
  return saida;
}

// O QUE O ROBÔ FEZ NESTA CONTA — para a fila vazia poder se explicar.
//
// POR QUE EXISTE (item 1 da lista do dono, 12/08/2026: "sugestões na Mantova
// inexistente na fila da IA"). Medido no banco: a Mantova TEM análise. Na última
// rodada o robô olhou 2 campanhas ativas e disse 'manter' nas duas — e 'manter'
// não entra na fila, porque não há o que aprovar. A fila então ficava vazia, e
// vazia é indistinguível de quebrada: a tela dizia "nada esperando decisão" sem
// dizer se o robô tinha passado por ali. Calar também é mentir (PADRÃO item 9).
//
// Conta sobre as análises CRUAS (antes do filtro de `pedeAcao`), por isso recebe
// a lista original. PURO.
export function resumoDoRobo(analises, contaId) {
  const alvo = contaId == null ? null : String(contaId);
  let analisadas = 0, manter = 0, ultima = null;
  for (const a of analises || []) {
    if (!a || a.campaign_id == null) continue;
    if (alvo != null && String(a.account_id || '') !== alvo) continue;
    analisadas += 1;
    if (a.veredito === 'manter') manter += 1;
    const q = quando(a.gerado_em);
    if (q != null && (ultima == null || q > ultima)) ultima = q;
  }
  return { analisadas, manter, ultima: ultima == null ? null : new Date(ultima).toISOString() };
}

// A FRASE da fila vazia. Devolve '' quando não há o que acrescentar — uma conta
// que o robô nunca analisou não ganha frase inventada.
export function fraseDaFilaVazia(resumo) {
  const r = resumo || {};
  if (!r.analisadas) return '';
  if (r.manter === r.analisadas) {
    return r.analisadas === 1
      ? 'O robô analisou 1 campanha e a recomendação foi manter como está — por isso não há nada para aprovar.'
      : `O robô analisou ${r.analisadas} campanhas e em todas a recomendação foi manter como está — por isso não há nada para aprovar.`;
  }
  // Analisou e propôs algo, mas nada chegou aqui: a sugestão foi respondida,
  // recusada, venceu, ou é de campanha que já parou. A tela não deve chutar qual.
  return `O robô analisou ${r.analisadas} campanha${r.analisadas > 1 ? 's' : ''} nesta conta. O que ele propôs já foi respondido, recusado ou é de campanha que não está mais rodando.`;
}

// Junta a leitura de SAÚDE às sugestões do robô (2026-07-29, pedido do dono:
// "não dá pra linkar também a saúde junto com as análises?").
//
// Faz duas coisas, e as duas importam:
//
// 1. ANEXA a saúde ao item que já existe. O caso que justifica o link é o robô
//    mandar ESCALAR uma campanha com a audiência queimada — aprovar ali é pagar
//    mais para repetir o anúncio para quem já cansou. `contradiz` marca isso.
//
// 2. CRIA item para campanha com alerta que o robô não trouxe. Sem isso o
//    alerta some: o robô disse 'manter', 'manter' não entra na fila, e uma
//    campanha com frequência 4,2× ficava invisível. É exatamente o caso da
//    "[Leads] Para WhatsApp" da Motoeasy medida em 29/07.
//
// `saudes` é uma lista de { campaign_id, account_id, campaign_name, conta_nome,
// saude, budget_atual_centavos }. Só 'alerta' vira item próprio — 'atencao' é
// observação e só aparece grudada numa sugestão que já existia. PURO.
//
// `decisoesSaude` são as decisões de escopo 'saude'. MEDIDO EM 12/08/2026, e é o
// item 2 da lista do dono ("qualquer ação tomada finaliza a sugestão"): sem elas o
// alerta de saúde dispensado VOLTAVA na hora — `mesclarSaude` roda depois de
// `montarFila` e só pulava campanha que já estivesse na fila de orçamento. Uma
// campanha com alerta e sem sugestão de verba não estava em lugar nenhum, então
// ressuscitava a cada carregamento. Dispensar não dispensava nada.
// `agora` entra pelo parâmetro, como em `montarFila`: o silêncio de 7 dias não se
// testa esperando 7 dias, e um `Date.now()` aqui dentro furaria o relógio fixo.
export function mesclarSaude(fila, saudes, decisoesSaude, agora) {
  const f = fila || {};
  const pendentes = [...(f.pendentes || [])];
  const porCampanha = new Map();
  for (const s of saudes || []) if (s && s.campaign_id != null) porCampanha.set(String(s.campaign_id), s);

  // A decisão mais recente de saúde por campanha. Mesma semântica das outras: a
  // dispensa cala até `silenciar_ate`, e alerta MEDIDO depois da decisão volta a
  // perguntar (a situação mudou, e calar aí esconderia piora real).
  const decididas = new Map();
  for (const d of decisoesSaude || []) {
    if (!d || d.campaign_id == null || d.escopo !== 'saude') continue;
    const k = String(d.campaign_id);
    const atual = decididas.get(k);
    if (!atual || (quando(d.decidido_em) ?? 0) > (quando(atual.decidido_em) ?? 0)) decididas.set(k, d);
  }

  const jaNaFila = new Set(pendentes.concat(f.vencidas || [], f.silenciadas || [], f.respondidas || [])
    .map((i) => String(i.campaign_id)));

  for (const item of pendentes) {
    const s = porCampanha.get(String(item.campaign_id));
    if (s && s.saude) item.saude = s.saude;
  }

  const agoraMs = quando(agora) ?? Date.now();
  const novos = [];
  for (const [id, s] of porCampanha) {
    if (jaNaFila.has(id)) continue;
    if (!s.saude || s.saude.nivel !== 'alerta') continue;
    const d = decididas.get(id);
    if (d) {
      const ate = quando(d.silenciar_ate);
      const calada = ate != null && agoraMs < ate;
      // Alerta medido DEPOIS da decisão volta a perguntar mesmo dentro do
      // silêncio? Não: senão a dispensa de 7 dias não valeria nada, já que a
      // saúde é remedida a cada carregamento da tela.
      if (calada) continue;
      // Fora do silêncio, só volta se a medição for mais nova que a decisão.
      if ((quando(s.medido_em) ?? 0) <= (quando(d.decidido_em) ?? 0)) continue;
    }
    novos.push({
      campaign_id: id,
      account_id: s.account_id || null,
      campaign_name: s.campaign_name || '',
      conta_nome: s.conta_nome || '',
      // O veredito vem da SAÚDE, e não há orçamento sugerido: ninguém calculou
      // um número aqui, e inventar um multiplicando o atual seria chutar.
      veredito: s.saude.veredito === 'pausar' ? 'pausar' : 'reduzir',
      justificativa: s.saude.porque,
      budget_atual_centavos: s.budget_atual_centavos ?? null,
      budget_sugerido_centavos: null,
      gerado_em: s.medido_em || null,
      origem: 'saude',
      saude: s.saude,
      conjuntos: s.conjuntos || [],
    });
  }
  const porValor = (x, y) => (Number(y.budget_atual_centavos) || 0) - (Number(x.budget_atual_centavos) || 0);
  return { ...f, pendentes: pendentes.concat(novos).sort(porValor) };
}

// Anexa os CRIATIVOS SEM TRAÇÃO à linha da campanha (2026-07-29, decisão do
// dono). O robô analisa anúncio a anúncio e marca 'pausar' nos que não engatam;
// eram 25 assim, em 6 campanhas — 16 numa só.
//
// Agrupados de propósito: 16 linhas separadas não são 16 decisões, são uma só —
// "esta campanha precisa de criativo novo". Uma linha por anúncio inflaria a
// fila de 11 para 36 itens e a transformaria em lista de tarefas.
//
// `criativos` é uma lista de { campaign_id, ad_id, nome, ctr, gasto, porque }.
// Campanha que só tem criativo fraco (sem sugestão de verba e sem alerta de
// saúde) VIRA item próprio — senão a recomendação sumiria, que é exatamente o
// que se está corrigindo ao tirar o selo do cartão.
export function anexarCriativos(fila, criativos, decisoesCriativos) {
  const f = fila || {};
  const pendentes = [...(f.pendentes || [])];

  // Campanha cujos criativos já foram respondidos não pergunta de novo até o
  // robô reanalisar. Mesma lógica de `jaRespondida`, no escopo 'criativos'.
  const respondidos = new Map();
  for (const d of decisoesCriativos || []) {
    if (!d || d.campaign_id == null || d.escopo !== 'criativos') continue;
    const k = String(d.campaign_id);
    const atual = respondidos.get(k);
    if (!atual || (quando(d.decidido_em) ?? 0) > (quando(atual.decidido_em) ?? 0)) respondidos.set(k, d);
  }

  const porCampanha = new Map();
  for (const c of criativos || []) {
    if (!c || c.campaign_id == null || !c.ad_id) continue;
    const k = String(c.campaign_id);
    const decisao = respondidos.get(k);
    // A decisão vale para os criativos que existiam quando foi tomada; análise
    // nova (criativo novo, ou reavaliação) volta a perguntar.
    if (decisao && (quando(decisao.decidido_em) ?? 0) >= (quando(c.analisado_em) ?? 0)) continue;
    if (!porCampanha.has(k)) porCampanha.set(k, []);
    porCampanha.get(k).push(c);
  }

  const jaNaFila = new Set(pendentes.map((i) => String(i.campaign_id)));
  for (const item of pendentes) {
    const lista = porCampanha.get(String(item.campaign_id));
    if (lista && lista.length) item.criativos = lista;
  }

  const novos = [];
  for (const [id, lista] of porCampanha) {
    if (jaNaFila.has(id) || !lista.length) continue;
    const base = lista[0];
    novos.push({
      campaign_id: id,
      account_id: base.account_id || null,
      campaign_name: base.campaign_name || '',
      conta_nome: base.conta_nome || '',
      // Não é sobre verba: o veredito aqui é sobre o criativo, e por isso não
      // existe valor sugerido nem botão de orçamento.
      veredito: 'criativos',
      justificativa: null,
      budget_atual_centavos: base.budget_atual_centavos ?? null,
      budget_sugerido_centavos: null,
      gerado_em: base.analisado_em || null,
      origem: 'criativos',
      criativos: lista,
    });
  }
  const porValor = (x, y) => (Number(y.budget_atual_centavos) || 0) - (Number(x.budget_atual_centavos) || 0);
  return { ...f, pendentes: pendentes.concat(novos).sort(porValor) };
}

