// coletor/budget-ia.mjs
// Robô diário: analisa campanhas com Opus 4.8 e grava sugestões de budget em
// gt_budget_analises. Roda via .github/workflows/budget-ia.yml.
//
// Escopo por dia (ver decidirEscopo):
//   - todo dia    → modo 'ativas': só as campanhas em veiculação AGORA;
//   - segunda-feira → modo 'amplo': as de cima MAIS as que veicularam em algum
//     momento nos últimos 7 dias (inclusive as que já estão pausadas hoje).

const VEREDITOS = new Set(['escalar', 'reduzir', 'manter', 'pausar']);
const VEREDITOS_AD = new Set(['manter', 'pausar']);

// Campanha "em veiculação real": ACTIVE e (sem stop_time OU stop_time no futuro).
// A regra mora em veiculacao.js — a MESMA que a fila usa. Ficou duplicada por um
// tempo e o resultado foi a tela mostrando campanha encerrada que o robô já
// ignorava corretamente. Reexportada porque os testes deste arquivo a usam pelo
// nome antigo.
export const campanhaEmVeiculacao = (camp, agoraMs) => emVeiculacao(camp, agoraMs);

// ---------- escopo da rodada ----------

const TZ = 'America/Sao_Paulo';
const ESCOPOS = new Set(['ativas', 'amplo']);

// Dia da semana (0=domingo, 1=segunda ... 6=sábado) no fuso de BRASÍLIA.
// Nunca use new Date().getDay(): isso devolve o dia do fuso da máquina, e o
// runner do GitHub Actions roda em UTC — das 21h à meia-noite BRT já é o dia
// seguinte lá. Ancoramos ao meio-dia BRT, longe das duas bordas do dia.
export function diaDaSemanaBR(agoraMs) {
  const diaISO = new Date(agoraMs).toLocaleDateString('en-CA', { timeZone: TZ });
  return new Date(`${diaISO}T12:00:00-03:00`).getUTCDay();
}

// Decide o escopo da rodada: 'amplo' na segunda, 'ativas' nos outros dias.
// `override` (env BUDGET_ESCOPO, ou o input do workflow) força o modo, pra dar
// pra testar sem esperar a segunda-feira chegar. Valor inválido é ignorado —
// nunca queremos que um typo no input mude o escopo sem querer.
export function decidirEscopo(agoraMs, override) {
  const forcado = String(override || '').trim().toLowerCase();
  if (ESCOPOS.has(forcado)) return { modo: forcado, motivo: 'forçado por BUDGET_ESCOPO=' + forcado };
  const dia = diaDaSemanaBR(agoraMs);
  return dia === 1
    ? { modo: 'amplo', motivo: 'segunda-feira (BRT): inclui quem veiculou nos últimos 7 dias' }
    : { modo: 'ativas', motivo: 'dia comum (BRT): só as campanhas em veiculação agora' };
}

// "Esteve ativa nos últimos 7 dias" não existe como filtro na API do Meta.
// A tradução prática é: TEVE VEICULAÇÃO na janela — ou seja, gastou ou entregou
// impressões. Os insights de 7 dias já são buscados, então a resposta sai de graça.
export function veiculouNaJanela(ins) {
  if (!ins) return false;
  return num(ins.spend) > 0 || num(ins.impressions) > 0;
}

// Seleciona as campanhas que serão analisadas na rodada.
// 'amplo' é SUPERCONJUNTO de 'ativas': quem veicula agora entra sempre (mesmo
// sem gasto na janela — campanha que acabou de subir), e no modo amplo entra
// também quem veiculou na janela, ainda que esteja pausada/encerrada hoje.
export function selecionarCampanhas(camps, insByCamp, modo, agoraMs) {
  const lista = Array.isArray(camps) ? camps : [];
  const ins = insByCamp || {};
  return lista.filter((c) => campanhaEmVeiculacao(c, agoraMs)
    || (modo === 'amplo' && veiculouNaJanela(ins[c.id])));
}

// `comObjetivoHerdado` MUDOU DE CASA na rodada de correção 1 da Onda C,
// Tarefa 5 (achado C1 da revisão, 25/09/2026): vivia só aqui, como cópia
// própria do robô, e a TELA nunca herdava objetivo nenhum — o desempate de
// OFFSITE_CONVERSIONS (lead x venda) simplesmente não disparava vindo do
// `.vue`, e a mesma campanha podia sair `site_venda` na tela e `lead` no
// robô. Agora mora em mercados.js (PURA, testada), importada pelos dois
// lados — nunca mais duas cópias que podem divergir. Ver o comentário
// completo lá.

// Monta as mensagens (system + user) pro Opus: analisa a campanha E os anúncios dela.
// `extra` é opcional (Tarefa 5, tendência e tempo no ar) — { insAnterior?, diasNoAr?, diasJanela? }.
// Parâmetro no FIM para não quebrar as chamadas de 5 argumentos já existentes.
export function montarMensagens(camp, ins, ads, conjuntos, regua, extra) {
  const ex = extra || {};
  // OBJETIVO DECLARADO (Tarefa 5): o dono pode dizer, campanha a campanha, qual
  // interação ela está comprando — e essa declaração VENCE a régua do balde:
  // quem disse o que a campanha compra sabe mais que o padrão do objetivo. A
  // TELA já julga assim (ver tela-de-gestao-trafego.vue); o robô ficava para
  // trás e escrevia, na mesma campanha, uma justificativa que discordava do
  // que a tela mostrava. `interacaoValida` é a MESMA guarda que a tela usa: o
  // `CHECK` da tabela `gt_objetivo_interacao` é a única coisa que impede hoje
  // um valor fora das quatro interações de chegar aqui, e linha antiga ou
  // edição direta no banco pode escapar dele — inválida cai no comportamento
  // de sempre, nunca derruba a análise desta campanha.
  const interacaoDeclarada = interacaoValida(ex.interacaoDeclarada) ? ex.interacaoDeclarada : null;
  const diasNoAr = Number.isFinite(ex.diasNoAr) ? ex.diasNoAr : null;
  // `diasJanela` é calculado no laço de main() (uma vez por conta, não por
  // campanha) e chega aqui por `extra` porque `montarMensagens` é a função
  // pura testada sem rede — não tem como ela recalcular `since`/`until` sozinha.
  const diasJanela = Number.isFinite(ex.diasJanela) ? ex.diasJanela : null;
  // O orçamento REAL desta campanha. Em ABO ele mora nos conjuntos: ler só
  // `camp.daily_budget` devolvia nulo e o modelo calculava a sugestão em cima do
  // zero — foi assim que a "MODA & BOLSAS" (R$ 230/dia no ar) recebeu sugestão
  // de R$ 200 rotulada "escalar", um corte vestido de aumento.
  const orc = orcamentoEfetivoDaCampanha(camp, conjuntos || []);
  // O MERCADO da campanha (Onda C, Tarefa 3): o que ela COMPRA de verdade,
  // segundo os CONJUNTOS — `baldeEfetivo` (objetivo declarado) SAIU do
  // caminho do veredito. É a correção do "[FLUXO SHOPPING]" (ON_VIDEO,
  // objetivo OUTCOME_ENGAGEMENT) que levou "reduzir" medido como engajamento
  // quando o que ele compra é view — ver mercados.js.
  //
  // `mercadoDoConjunto` usa `conjunto.objective` como ÚLTIMO desempate
  // (OFFSITE_CONVERSIONS: lead x venda — ver MERCADO_POR_OTIMIZACAO_E_OBJETIVO
  // em mercados.js), mas a Graph API só devolve `objective` no nível da
  // CAMPANHA, nunca no conjunto. `comObjetivoHerdado` cobre isso (ver acima).
  const conjuntosPuros = comObjetivoHerdado(camp, conjuntos);
  const mercado = mercadoDaCampanha(conjuntosPuros);
  const alvo = alvoDoBalde(mercado);
  // Havendo declaração válida, a META também troca de mercado: a meta DAQUELA
  // interação (regua.metas[interacao], lida por metaDoBalde — que não exige
  // que a chave exista em ALVOS, ver regua.js:109), não a meta do mercado.
  const meta = !regua ? 0 : metaDoBalde(regua, interacaoDeclarada || mercado);
  // O CUSTO ATUAL de qualquer campanha, não só das de engajamento — calculado
  // por custoAtualDoAlvo (fonte única compartilhada com o --dry, ver o
  // comentário lá). Antes disto o robô mandava `meta_reais` preenchida e
  // `custo_atual_reais: null` em lead, venda, mensagem e tráfego — e o system
  // prompt mandava citar o número. Agora passa também a interação declarada
  // (Tarefa 5): sem ela, comportamento de sempre.
  const custoAtual = custoAtualDoAlvo(mercado, ins, regua, interacaoDeclarada);
  // O RÓTULO que o modelo lê muda junto: "Custo por salvamento" em vez de
  // "Custo por engajamento" quando há declaração — senão o número muda de
  // mercado mas o nome ao lado dele continua mentindo qual é esse mercado.
  const rotuloAlvo = interacaoDeclarada ? INTERACOES[interacaoDeclarada].rotuloCusto : (alvo ? alvo.rotulo : null);
  // MULETA DE SEGUIDORES — APOSENTADA PARA O MERCADO `perfil` (25/09/2026,
  // Onda C, rodada de correção 1). Nasceu na Onda A por um motivo real:
  // campanha de seguidores caía no balde de tráfego/engajamento e era medida
  // por custo por VISITA usando `_GT_VISIT` (que tentava `landing_page_view`
  // antes de `link_click`) — no `[SEGUIDORES][REMARKETING]` da Raíssa isso deu
  // `landing_page_view=1` (resíduo) contra `link_click=3203`, e o "custo"
  // saiu R$ 247,45 (1455× a meta), com o modelo recomendando pausar com
  // convicção em cima de uma medida que não existia.
  //
  // A CAUSA foi corrigida na Tarefa 2 (`_GT_VISIT_PERFIL = ['link_click']`,
  // sem fallback pro resíduo — ver metricas.js): a mesma campanha, medida
  // pelo mercado `perfil`, dá ~R$ 0,09 — um número real, que é exatamente o
  // KPI que o dono pediu em 25/09 pra aparecer no card ("custo por visita ao
  // perfil é a KPI principal dessas campanhas"). Continuar escondendo esse
  // número atrás de "medida indisponível" estaria escondendo do dono
  // justamente o que ele pediu pra ver — por isso a muleta NÃO dispara mais
  // quando `mercado === 'perfil'` (ver `semMedidaDeSeguidor` abaixo).
  //
  // `ehDeSeguidores` continua viva: ainda decide QUAIS campanhas entram na
  // soma de gasto do custo por seguidor DA CONTA (ver `custoSeguidorConta`
  // logo abaixo e o laço de `main()`) — o que muda é só ela deixar de
  // SUPRIMIR o custo por visita ao perfil da campanha.
  const deSeguidores = ehDeSeguidores(camp.name);
  // Só dispara a muleta (sem meta, sem custo, "medida_indisponivel") quando o
  // mercado NÃO é `perfil` — awareness/tráfego/etc. sem sinal nenhum de
  // conjunto continuam sem medida nenhuma pra esta campanha nomeada de
  // seguidores, porque aí não existe KPI de verdade pra mostrar.
  const semMedidaDeSeguidor = deSeguidores && mercado !== 'perfil';
  // CUSTO POR SEGUIDOR DA CONTA (Tarefa 6, Onda B): só existe pra campanha de
  // seguidores, e é sempre da CONTA INTEIRA — nunca desta campanha (a Meta não
  // atribui seguidor a campanha nenhuma, ver seguidores.js). `extra` traz o
  // objeto já calculado por main() (gasto das campanhas de seguidores ÷ ganho
  // de seguidores da conta na mesma janela) porque montarMensagens é pura e
  // não tem como buscar followers_leituras sozinha. Sem dado, ou com amostra
  // pequena (`confiavel:false`), NÃO entra no prompt — mesma regra da tela:
  // number pouco confiável na mão do modelo é pior que nenhum.
  const custoSeguidorConta = deSeguidores && ex.custoPorSeguidorConta
    && ex.custoPorSeguidorConta.confiavel && ex.custoPorSeguidorConta.valor != null
    ? ex.custoPorSeguidorConta.valor : null;
  const system =
    'Você é um gestor de tráfego pago sênior. Analise UMA campanha do Meta Ads E os anúncios dela, e recomende: ' +
    '(1) o orçamento diário ideal da CAMPANHA; (2) por ANÚNCIO, manter ou pausar o criativo. ' +
    'Respeite o OBJETIVO da campanha (Vendas: ROAS/CAC; Tráfego: CPC/CTR; Reconhecimento: alcance/CPM; Leads: custo por lead; Engajamento: engajamento/CTR). ' +
    'CONCEITOS (obrigatórios): performance RUIM nunca vira "escalar" — CTR muito abaixo do aceitável pro objetivo, CPC/CPL alto, ROAS baixo, ou frequência alta (fadiga) → "reduzir" ou "pausar", NUNCA "escalar". ' +
    '"escalar" só com EVIDÊNCIA de eficiência (bom resultado a custo baixo) E volume/dado suficiente. Seja conservador quando faltar dado. ' +
    'Por anúncio: "pausar" criativo com performance ruim ou fadiga; "manter" os que vão bem. ' +
    'ORÇAMENTO: `orcamento` traz o valor diário que a campanha REALMENTE tem no ar e ONDE ele mora — ' +
    'em CBO na própria campanha, em ABO somado nos conjuntos ativos (conjunto pausado não entra: não gasta). ' +
    'Sugira SEMPRE o total diário da campanha, comparando com `orcamento.reais`: se o seu número for MENOR que ele, ' +
    'o veredito é "reduzir", nunca "escalar" — mesmo que pareça um valor alto isolado. ' +
    'Com `orcamento.reais` nulo você NÃO sabe o gasto atual: use "manter" e diga na justificativa que o orçamento não pôde ser lido. ' +
    'A META manda: `regua.meta_reais` é quanto se aceita pagar por resultado NESTA conta (na unidade de `regua.rotulo`) ' +
    'e `regua.custo_atual_reais` é quanto a campanha paga de fato. Cada conta pratica um preço muito diferente, então compare com a meta DESTA conta, ' +
    'nunca com uma noção geral de caro ou barato. Pagando ABAIXO da meta há espaço para escalar; ACIMA, é "reduzir" ou "otimizar". ' +
    'Cite esse número na justificativa, em reais e contra a meta. ' +
    // Quem LÊ a justificativa é o próprio dono da conta. Escrever "a meta do
    // dono" faz o texto falar dele em terceira pessoa, como se fosse sobre
    // outra pessoa (correção pedida por ele, 2026-07-29).
    'ESCREVA SEMPRE "a meta" ou "a meta desta conta" — NUNCA "a meta do dono", "o dono definiu" ou qualquer menção a "dono", "cliente" ou "gestor": quem lê o texto é a própria pessoa que definiu a meta. ' +
    'Quando `regua.meta_reais` for nulo, essa conta ainda não tem meta para este tipo de campanha: aí sim julgue pelos indicadores do objetivo, e diga que a meta não está definida. ' +
    // MERCADO DESCONHECIDO (Onda C, Tarefa 3): diferente de "meta não
    // definida" (regua.meta_reais nulo com mercado conhecido) — aqui a
    // ferramenta não conseguiu identificar NENHUM mercado a partir dos
    // conjuntos (sinal que mercados.js não reconhece, ou conjunto ausente).
    // Sem esta distinção o modelo confundia as duas frases e podia inventar
    // "meta não definida" para uma campanha que não tem nem mercado julgado.
    'Quando `regua.mercado` vier "desconhecido", não foi possível identificar o que esta campanha compra a partir dos conjuntos dela: não existe meta nem custo por resultado nenhum aqui — julgue SOMENTE pelos indicadores (CTR, CPC, frequência, alcance, volume de anúncios) e diga na justificativa que não havia medida de mercado disponível para esta campanha, nunca invente um custo por resultado. ' +
    // CAMPANHA MISTA (Onda C, Tarefa 3): o caso real é a [LEADS LOJA]
    // [mixconversão] da Vessel, com um conjunto de WhatsApp e um de site ao
    // mesmo tempo — somar gasto e resultado de mercados diferentes produz um
    // número sem significado (curtida contra venda não tem razão nenhuma),
    // então esta campanha NUNCA leva `custo_atual_reais` de campanha.
    'Quando `regua.mercado` vier "misto", esta campanha tem CONJUNTOS que compram mercados diferentes ao mesmo tempo (ex.: um de conversa por WhatsApp e um de venda por site) — por isso não há `custo_atual_reais` de campanha. Julgue cada conjunto separadamente usando `regua.por_conjunto` (mercado, gasto, resultado e custo_atual_reais de cada um, contra a meta daquele mercado quando houver) e escreva a justificativa mercado a mercado — NUNCA some gasto ou resultado entre mercados diferentes, e NUNCA invente uma média única para a campanha inteira. ' +
    // MULETA de campanha de seguidores (ver comentário de `deSeguidores`
    // acima) — hoje só dispara quando o mercado NÃO é `perfil` (awareness,
    // tráfego etc. sem sinal de conjunto nenhum). Sem esta instrução o modelo
    // recebia `regua.meta_reais` e `regua.custo_atual_reais` nulos e podia
    // inventar "sem meta definida" — a frase certa para OUTRA situação (conta
    // que simplesmente não configurou meta), não para esta, onde a medida não
    // existe mesmo.
    'Quando `regua.medida_indisponivel` vier preenchido, esta campanha é de SEGUIDORES sem mercado reconhecido: a Meta não atribui "novo seguidor" a uma campanha, então não existe custo por resultado confiável aqui — julgue SOMENTE pelos indicadores disponíveis (CTR, CPC, frequência, alcance, volume de anúncios), NUNCA recomende "pausar" ou "reduzir" alegando custo por resultado ou comparação com meta, e diga isso na justificativa (que a medida não existe para este tipo de campanha) em vez de fingir que mediu. ' +
    // APOSENTADORIA DA MULETA PARA "perfil" (25/09/2026, Onda C, rodada de
    // correção 1): campanha de seguidores cujo mercado É `perfil` (destino/
    // otimização do conjunto apontam pra lá) agora chega aqui com
    // `regua.custo_atual_reais` preenchido de verdade (custo por visita ao
    // perfil, via `link_click` — ver metricas.js) — é a KPI que o dono pediu
    // pra ver no card. JULGUE por ela normalmente, como em qualquer outro
    // mercado.
    'Quando esta campanha for de SEGUIDORES mas `regua.mercado` vier "perfil", `regua.custo_atual_reais` É o custo por visita ao perfil de verdade desta campanha — julgue por ele contra `regua.meta_reais` como em qualquer outro mercado, NUNCA diga que a medida está indisponível. ' +
    // TAREFA 6 (Onda B): quando vier preenchido, `regua.custo_por_seguidor_da_conta_reais`
    // é só CONTEXTO — nunca o custo desta campanha, porque é da conta inteira
    // (soma de TODAS as campanhas de seguidores, dividida pelo ganho de
    // seguidores DA CONTA, orgânico incluso, sem como separar). Vale tanto
    // quando a medida da campanha está indisponível quanto quando ela é
    // `perfil` com custo real: o número da conta NUNCA substitui nem se soma
    // ao custo desta campanha específica.
    'Se `regua.custo_por_seguidor_da_conta_reais` vier preenchido, use-o SÓ como contexto da conta ao comentar esta campanha de seguidores — NUNCA como custo desta campanha específica, mesmo quando `regua.custo_atual_reais` (custo por visita ao perfil) também vier preenchido — e diga na justificativa que é uma estimativa da conta inteira (inclui seguidor orgânico), nunca desta campanha isolada. Se vier nulo, não mencione custo por seguidor nenhum: significa que a conta não tem dado confiável para essa estimativa agora. ' +
    // TENDÊNCIA e APRENDIZADO (Tarefa 5): antes o robô mandava uma janela só —
    // o modelo não tinha como dizer se a campanha estava melhorando ou piorando,
    // e "o que mudou desde ontem" é exatamente o que se olha às 8h da manhã.
    'TENDÊNCIA: quando `janela_anterior` existir, compare com ela e diga o SENTIDO do movimento na justificativa, citando ' +
    // O exemplo cravava "7 dias", mas a janela é since=hoje-7d até until=hoje —
    // 8 dias INCLUSIVE. Um número fixo errado no prompt vira número errado na
    // justificativa que o dono lê. `dias_da_janela` traz o valor real calculado
    // pelo robô; o exemplo não crava mais dia nenhum.
    'a quantidade de dias de `dias_da_janela` (ex.: "o custo por lead subiu de R$ 12 para R$ 25 em `dias_da_janela` dias"). ' +
    'Custo piorando é argumento contra escalar, mesmo abaixo da meta. ' +
    'APRENDIZADO: com `em_aprendizado` true a campanha tem menos de 3 dias e a Meta ainda está aprendendo — ' +
    'o veredito deve ser "manter", a menos que ela esteja gastando muito acima da meta OU gastando sem nenhum resultado. ' +
    // A válvula de escape original só citava "acima da meta" — mas campanha nova
    // sem NENHUM resultado tem `custo_atual_reais` nulo, e com nulo não dá pra
    // comparar com meta nenhuma. Sobrava a ordem seca de manter, bem na campanha
    // que mais precisa de intervenção: gasto relevante sem um resultado sequer é
    // queima de dinheiro, não "esperar o aprendizado terminar".
    'Gasto relevante sem UM resultado sequer é motivo para agir mesmo dentro do aprendizado, mesmo sem meta pra comparar. ' +
    'Mexer agora reinicia o aprendizado. ' +
    'ANÚNCIOS: julgue cada criativo pelo `resultado` e `custo_por_resultado` dele, não só por CTR — ' +
    // ATUALIZADO 24/09/2026: engajamento tinha `resultado` null POR DEFINIÇÃO
    // (era o único balde sem métrica de quantidade). Não é mais verdade — a
    // troca de régua deu a ele `resultado: 'engaj_pub'`, um número real na
    // maioria dos anúncios (ver ALVOS.engajamento em alvos.js). Quem continua
    // caindo sem `resultado` (e sem `custo_por_resultado`) é o balde 'padrao'
    // — campanha cujo `objective`/`optimization_goal` a ferramenta não
    // reconhece (ver baldes.js) e que por isso não tem alvo nenhum em
    // alvos.js. Sem esta ressalva o modelo lia esse null como "o criativo não
    // produziu nada" e mandava pausar bons criativos só por não terem
    // `resultado` numérico.
    '`resultado` nulo pode significar apenas que esse TIPO de campanha (objetivo não reconhecido pela ferramenta, balde "padrao") não conta resultado por unidade — ' +
    'não leia isso como "o criativo não produziu nada": quando `resultado` vier nulo, julgue o anúncio pelo `custo_por_resultado`; se os dois vierem nulos, julgue pelos indicadores do anúncio e diga na justificativa que não havia resultado medido. ' +
    'Fora desses casos, criativo com CTR alto e nenhum resultado é candidato a pausar, e CTR baixo com resultado barato NÃO é. ' +
    'Quando `custo_atual_reais` vier nulo e houver meta, diga que esta campanha não registrou resultado na janela — nunca invente o número. ' +
    'Responda SOMENTE com um JSON válido, sem texto antes ou depois, no formato: ' +
    '{"budget_sugerido_centavos": <inteiro, centavos de R$/dia>, ' +
    '"veredito": "escalar"|"reduzir"|"manter"|"pausar", ' +
    '"justificativa": "<1-2 frases PT-BR>", ' +
    '"impacto_estimado": "<estimativa curta PT-BR>", ' +
    // OS TRÊS IMPACTOS (pedido do dono, 2026-08-03). A fila passou a oferecer
    // subir/baixar/manter em toda linha, e ele foi direto ao ponto: "não é pra
    // falar só de orçamento, quero um detalhamento de impacto real, o que
    // acontecerá com as métricas — senão conta de porcentagem eu mesmo fazia".
    //
    // Conta de porcentagem a TELA faz. O que só você sabe é o que acontece com
    // o custo por resultado desta campanha contra a meta desta conta, com a
    // frequência, com o alcance e com o aprendizado. É isso que tem de estar
    // escrito — com os números que você olhou, não com adjetivos.
    '"impactos": {"subir": "<...>", "baixar": "<...>", "manter": "<...>"}, ' +
    'CADA IMPACTO: 1 ou 2 frases, e fale do EFEITO NAS MÉTRICAS desta campanha — custo por resultado contra a meta desta conta, ' +
    'frequência (fadiga), alcance, volume de resultado e reinício do aprendizado da Meta quando a mudança for grande. ' +
    'Use os NÚMEROS que você recebeu (custo atual, meta, frequência, CTR), não adjetivos soltos. ' +
    'NÃO repita a porcentagem nem o valor em reais: a tela já mostra os dois, e repetir rouba o espaço do que só você sabe dizer. ' +
    'Escreva os três mesmo quando um deles for uma má ideia — dizer POR QUE é má ideia é justamente o que ajuda a decidir. ' +
    'Em "manter", diga o que acontece se nada for feito, não "nada muda". ' +
    '"anuncios": [ {"ad_id": "<id>", "veredito": "manter"|"pausar", "justificativa": "<1 frase PT-BR>"} ]}';
  const dados = {
    nome: camp.name || '',
    objetivo: camp.objective || '',
    // Número REAL de dias da janela que gerou `gasto`/`ctr_pct`/etc. abaixo —
    // o system prompt cita este campo em vez de cravar "7 dias" (a janela é
    // since=hoje-7d até until=hoje, ou seja, 8 dias INCLUSIVE).
    dias_da_janela: diasJanela,
    regua: semMedidaDeSeguidor ? {
      // Campanha de seguidores SEM mercado `perfil` (a muleta continua viva
      // só pra este caso, ver `semMedidaDeSeguidor` acima): os TRÊS campos de
      // custo vão nulos de propósito (não só custo_atual_reais) — deixar
      // `meta_reais` pendurada sem um custo pra comparar convida o modelo a
      // inventar a comparação mesmo assim. O texto de `medida_indisponivel` é
      // o que diz o PORQUÊ (ver system acima).
      mercado,
      rotulo: alvo ? alvo.rotulo : null,
      meta_reais: null,
      custo_atual_reais: null,
      indice_contra_meta: null,
      pesos: regua ? regua.pesos : null,
      medida_indisponivel: 'A Meta não atribui "novo seguidor" a uma campanha, então não há custo por resultado confiável para esta campanha — julgue pelos demais indicadores (CTR, CPC, frequência, alcance, volume).',
      // Estimativa DA CONTA INTEIRA (Tarefa 6), nunca desta campanha — null
      // quando não há dado ou a amostra de seguidores ganhos é pequena demais
      // (ver AMOSTRA_MINIMA_DE_SEGUIDORES em seguidores.js). `dias_da_janela`
      // acima já diz a janela a que esse número se refere.
      custo_por_seguidor_da_conta_reais: custoSeguidorConta,
    // CAMPANHA MISTA (Onda C, Tarefa 3): dois (ou mais) mercados VIVOS na
    // mesma campanha ao mesmo tempo — ver mercadoDaCampanha em mercados.js.
    // Uma declaração manual do dono (interacaoDeclarada) VENCE a mistura: se
    // ele já disse qual interação esta campanha compra, julgar por ela é mais
    // confiável do que quebrar por conjunto (mesma precedência que já valia
    // para o mercado simples).
    } : (mercado === 'misto' && !interacaoDeclarada) ? {
      mercado: 'misto',
      rotulo: null,
      // Somar gasto e resultado de mercados diferentes produz um custo por
      // unidade que não representa nada (curtida contra venda não tem razão
      // de ser) — por isso esta campanha NUNCA leva meta/custo DE CAMPANHA,
      // só a quebra por conjunto abaixo.
      meta_reais: null,
      custo_atual_reais: null,
      indice_contra_meta: null,
      pesos: regua ? regua.pesos : null,
      por_conjunto: conjuntosPuros.map((cj) => {
        const mercadoCj = mercadoDoConjunto(cj);
        const alvoCj = alvoDoBalde(mercadoCj);
        const metaCj = regua ? metaDoBalde(regua, mercadoCj) : 0;
        return {
          mercado: mercadoCj,
          rotulo: alvoCj ? alvoCj.rotulo : null,
          gasto: num(cj.spend),
          resultado: (alvoCj && alvoCj.resultado && GT_METRIC_CATALOG[alvoCj.resultado])
            ? GT_METRIC_CATALOG[alvoCj.resultado].compute(cj) : null,
          // MESMA custoDoAlvo do resto (nunca inventa 0 — ver restrição no
          // topo do arquivo: quantidade zero devolve null).
          custo_atual_reais: custoDoAlvo(mercadoCj, cj),
          meta_reais: metaCj > 0 ? metaCj : null,
        };
      }),
    } : {
      mercado,
      rotulo: rotuloAlvo,          // ex.: "Custo por ponto", "Custo por conversa iniciada", ou "Custo por salvamento" se declarado
      meta_reais: meta > 0 ? meta : null,          // nulo = conta sem meta para este tipo (ou para a interação declarada)
      custo_atual_reais: custoAtual,
      indice_contra_meta: (custoAtual != null && meta > 0) ? custoAtual / meta : null,
      pesos: regua ? regua.pesos : null,
      // CONTEXTO DA CONTA (Onda C, rodada de correção 1, 25/09/2026): só entra
      // quando a campanha É de seguidores (`deSeguidores`) — o que, por
      // construção deste `else`, só acontece quando o mercado é `perfil` (ver
      // `semMedidaDeSeguidor` acima). É a outra metade da decisão do dono de
      // 25/09: "custo por visita ao perfil (o julgamento) + seguidor da conta
      // (o contexto) lado a lado" — nunca um substituindo o outro. Fora deste
      // caso a chave nem aparece (ver teste "campanha que NÃO é de seguidores
      // nunca leva custo_por_seguidor_da_conta_reais").
      ...(deSeguidores ? { custo_por_seguidor_da_conta_reais: custoSeguidorConta } : {}),
    },
    orcamento: {
      reais: orc.reais,
      centavos: orc.centavos,
      tipo: orc.tipo,                       // 'diario' | 'total' | 'misto' | null
      onde: orc.sigla,                      // 'CBO' | 'ABO' | null
      conjuntos_somados: orc.conjuntosSomados,
      conjuntos_pausados_ignorados: orc.conjuntosIgnorados,
      configurado_centavos: orc.configuradoCentavos,
    },
    gasto: num(ins.spend),
    impressoes: num(ins.impressions),
    cliques: num(ins.clicks),
    ctr_pct: num(ins.ctr),
    cpc: num(ins.cpc),
    alcance: num(ins.reach),
    frequencia: num(ins.frequency),
    roas: Array.isArray(ins.purchase_roas) && ins.purchase_roas[0] ? num(ins.purchase_roas[0].value) : null,
    acoes: ins.actions || null,
    valores_acao: ins.action_values || null,
    anuncios: (ads || []).map((a) => ({
      ad_id: a.ad_id || a.id || '',
      nome: a.ad_name || a.adset_name || '',
      gasto: num(a.spend),
      ctr_pct: num(a.ctr),
      cpc: num(a.cpc),
      impressoes: num(a.impressions),
      alcance: num(a.reach),
      frequencia: num(a.frequency),
      // O RESULTADO deste criativo, no MERCADO DA CAMPANHA (descido pronto,
      // nunca recalculado por anúncio — ver H1 do review de 2026-07-28, e o
      // cuidado equivalente desta onda em mercados.js: a Meta OMITE um action
      // type inteiro quando a contagem é zero, então recalcular por anúncio
      // classificaria errado). Sem isto o robô mandava pausar criativo de
      // conversão olhando só CTR e frequência.
      resultado: (alvo && alvo.resultado && GT_METRIC_CATALOG[alvo.resultado])
        ? GT_METRIC_CATALOG[alvo.resultado].compute(a) : null,
      // Usamos `custoAtualDoAlvo` (e não `custoDoAlvo` direto) para todo
      // mercado, inclusive engajamento, sempre concordar com o valor usado no
      // --dry e deixar a porta aberta para a Tarefa 5 (override de objetivo
      // declarado) sem precisar trocar chamada por chamada depois.
      custo_por_resultado: custoAtualDoAlvo(mercado, a, regua),
    })),
    dias_no_ar: diasNoAr,
    // Menos de 3 dias: a Meta ainda está na fase de aprendizado, e mexer no
    // orçamento reinicia essa fase. O prompt manda não mexer em quem está
    // aprendendo, a menos que esteja queimando dinheiro.
    em_aprendizado: diasNoAr != null ? diasNoAr < 3 : false,
    janela_anterior: ex.insAnterior ? {
      gasto: num(ex.insAnterior.spend),
      // MESMO NOME de `regua.custo_atual_reais` acima, de propósito: é a mesma
      // grandeza (calculada pela mesma `custoAtualDoAlvo`), só que na janela
      // anterior — e é exatamente o par que o modelo precisa comparar pra dizer
      // a tendência. Passa a MESMA interação declarada de cima: comparar
      // "hoje por salvamento" com "ontem por engajamento" não é tendência, é
      // dois números de mercados diferentes fingindo ser o mesmo par.
      custo_atual_reais: custoAtualDoAlvo(mercado, ex.insAnterior, regua, interacaoDeclarada),
      frequencia: num(ex.insAnterior.frequency),
      ctr_pct: num(ex.insAnterior.ctr),
    } : null,
  };
  const user =
    'Dados da campanha e dos anúncios (janela recente):\n' + JSON.stringify(dados) +
    '\nResponda apenas o JSON pedido.';
  return { system, user };
}

// Extrai e valida o JSON da resposta. Retorna o objeto validado (com anuncios) ou null.
export function parsearSaida(text) {
  if (!text || typeof text !== 'string') return null;
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  let o;
  try { o = JSON.parse(m[0]); } catch { return null; }
  if (!o || typeof o !== 'object') return null;
  const b = o.budget_sugerido_centavos;
  if (!Number.isFinite(b) || b < 0) return null;
  if (!VEREDITOS.has(o.veredito)) return null;
  if (typeof o.justificativa !== 'string' || !o.justificativa.trim()) return null;
  if (typeof o.impacto_estimado !== 'string' || !o.impacto_estimado.trim()) return null;
  const anuncios = Array.isArray(o.anuncios)
    ? o.anuncios
        .filter((a) => a && typeof a.ad_id === 'string' && a.ad_id.trim()
          && VEREDITOS_AD.has(a.veredito)
          && typeof a.justificativa === 'string' && a.justificativa.trim())
        .map((a) => ({ ad_id: a.ad_id.trim(), veredito: a.veredito, justificativa: a.justificativa.trim() }))
    : [];
  // OS TRÊS IMPACTOS SÃO OPCIONAIS na validação, e isso é decisão, não descuido:
  // se o modelo esquecer um deles, é melhor gravar a análise sem os textos (a
  // tela cai na conta simples) do que jogar fora uma recomendação de orçamento
  // inteira por causa de uma frase. Só entra o que veio como texto de verdade.
  const impactos = {};
  for (const k of ['subir', 'baixar', 'manter']) {
    const v = o.impactos && o.impactos[k];
    if (typeof v === 'string' && v.trim()) impactos[k] = v.trim();
  }

  return {
    budget_sugerido_centavos: Math.round(b),
    veredito: o.veredito,
    justificativa: o.justificativa.trim(),
    impacto_estimado: o.impacto_estimado.trim(),
    impactos: Object.keys(impactos).length ? impactos : null,
    anuncios,
  };
}

function num(v) { const n = parseFloat(v); return Number.isFinite(n) ? n : null; }

// A FONTE ÚNICA do custo atual de um ALVO — o nome é genérico de propósito:
// este arquivo chama a mesma função com uma campanha, com um anúncio e com a
// janela anterior, e as três leituras precisam vir da mesma conta. Usada tanto
// no prompt que vai pro Opus (montarMensagens) quanto na linha de diagnóstico
// do --dry: os dois têm de concordar por CONSTRUÇÃO, não por disciplina. Esta
// onda inteira nasceu de um cálculo preso num lugar só (só engajamento tinha
// custo atual) — copiar esta mesma conta em dois pontos do arquivo, mesmo que
// só entre `montarMensagens` e o `--dry`, seria repetir o erro numa escala
// menor. Se a fórmula mudar, muda aqui e os dois lugares acompanham.
// Fica ACIMA da tarja de infra (rede) abaixo porque é pura e é alcançada
// pelos testes via `montarMensagens` — só as chamadas de rede é que só
// rodam dentro de main().
export function custoAtualDoAlvo(balde, ins, regua, interacaoDeclarada) {
  // Engajamento não é mais caso especial: desde 24/09/2026 ele tem métrica no
  // catálogo (custo_engajamento) como qualquer outro balde. O ramo que chamava
  // calcularPonderada saiu daqui — a ponderada está em PAUSA, não apagada.
  // CORRIGIDO na Rodada 1 de revisão da Tarefa 4/Onda C (25/09/2026): esta
  // linha dizia "religar é trocar duas linhas em alvos.js", e isso é falso —
  // a mesma promessa vazia que o interruptor da Seção 1 (painel-regua.js)
  // teve no texto antes desta correção. Religar de verdade exige TROCAR O
  // RAMO REMOVIDO AQUI de volta (não só duas linhas em alvos.js), além da
  // tela (usaLimiaresDeEngajamento em tela-de-gestao-trafego.vue) voltar a
  // usar os limiares da Seção 1 para 'post' — nenhuma das duas mudou nesta
  // tarefa. Ver o comentário de `ligada`/`AVISO_LIGADA_INCOMPLETA` em
  // painel-regua.js para o que falta.
  // OBJETIVO DECLARADO (Tarefa 5): a declaração do dono VENCE a régua do
  // balde — quando ele disse, campanha a campanha, qual interação ela compra,
  // é essa interação que decide o custo, não o padrão do objetivo.
  // `interacaoValida` é a MESMA guarda que a tela usa (interacoes.js): o
  // `CHECK` da tabela é a única coisa que impede hoje um valor fora das
  // quatro interações de chegar aqui, e linha antiga ou edição direta no
  // banco pode escapar — inválida cai no `custoDoAlvo` de sempre, nunca
  // derruba a análise. `custoDaInteracao` já nunca inventa R$ 0,00 (quantidade
  // zero devolve null — R$ 0,00 no prompt é lido como "de graça" e vira
  // "escalar"), então não há nada a "estragar" repassando pra ela.
  // `regua` continua sem uso NESTA função — a meta (regua.metas) é assunto de
  // `montarMensagens`/`metaDoBalde`, não do custo atual em si; mantido no
  // parâmetro pelos chamadores existentes (montarMensagens passa a régua
  // inteira pros três usos: meta, custo atual e a interação, e trocar a
  // ordem/assinatura por causa de um parâmetro não usado aqui quebraria as
  // outras chamadas sem necessidade).
  if (interacaoValida(interacaoDeclarada)) {
    return custoDaInteracao(quantidadesDoInsight(ins), interacaoDeclarada);
  }
  return custoDoAlvo(balde, ins);
}

// ---------- infra (rede) — só roda no main(), não é importado nos testes ----------
import { registrarExecucao } from './registrar-execucao.mjs';
// Onde mora o orçamento (CBO na campanha x ABO nos conjuntos) e quanto ele soma
// de fato. Módulo puro, o MESMO que a tela usa — a conta não pode divergir entre
// o que o robô sugere e o que a tela mostra.
import { orcamentoEfetivoDaCampanha } from '../src/ferramentas/gestao-trafego/orcamento-hierarquia.js';
// A RÉGUA. Sem isto o robô julgava por critério próprio (CTR, CPC,
// frequência) enquanto a tela julgava pela meta que o dono definiu — dois juízes
// discordando sobre a mesma campanha. Agora ele responde contra a MESMA régua.
// `baldeEfetivo` SAIU do caminho do veredito nesta onda (Onda C, Tarefa 3) —
// quem decide o mercado agora é `mercadoDaCampanha`, logo abaixo. `ehDeSeguidores`
// continua aqui: é a muleta de seguidores, ortogonal ao mercado.
import { ehDeSeguidores } from '../src/ferramentas/gestao-trafego/baldes.js';
import { normalizarRegua, reguaDaConta, metaDoBalde } from '../src/ferramentas/gestao-trafego/regua.js';
import { alvoDoBalde } from '../src/ferramentas/gestao-trafego/alvos.js';
import { emVeiculacao } from '../src/ferramentas/gestao-trafego/veiculacao.js';
// O MERCADO da campanha (Onda C): o que ela COMPRA de verdade, segundo os
// CONJUNTOS — não mais o objetivo declarado. Ver mercados.js para o porquê:
// Motoeasy, Mantova e o [FLUXO SHOPPING] da Vessel tinham o MESMO objetivo
// declarado (OUTCOME_ENGAGEMENT) e compravam três coisas diferentes (conversa
// de WhatsApp, visita ao perfil, view de vídeo).
import { mercadoDaCampanha, mercadoDoConjunto, comObjetivoHerdado } from '../src/ferramentas/gestao-trafego/mercados.js';
// O custo atual de TODO balde, engajamento incluído desde a troca de régua de
// 24/09/2026 (ver custoAtualDoAlvo acima e ALVOS.engajamento em alvos.js).
// GT_METRIC_CATALOG: o compute() de cada métrica (leads, conversas, compras...) —
// usado abaixo pra dar a cada ANÚNCIO o resultado no mercado da campanha dele.
import { custoDoAlvo, GT_METRIC_CATALOG } from '../src/ferramentas/gestao-trafego/metricas.js';
// OBJETIVO DECLARADO por interação (Tarefa 5): a mesma dupla que a tela usa
// para julgar campanha declarada pelo mercado da interação, não do balde.
import { interacaoValida, custoDaInteracao, INTERACOES } from '../src/ferramentas/gestao-trafego/interacoes.js';
// Converte o insight bruto do Meta nas quatro quantidades (curtida, comentário,
// salvamento, compartilhamento) que `custoDaInteracao` divide — a MESMA leitura
// que a ponderada usa, então uma campanha declarada não pode discordar de como
// a tela conta a mesma interação.
import { quantidadesDoInsight } from '../src/ferramentas/gestao-trafego/ponderada.js';
// TAREFA 6 (Onda B): custo por seguidor da CONTA (nunca de campanha) — módulo
// puro, mesmo critério (`ehDeSeguidores`) e mesma régua de amostra mínima que
// a tela usa, pra não haver dois números diferentes pro mesmo dado.
import { custoPorSeguidorDaConta } from '../src/ferramentas/gestao-trafego/seguidores.js';
// Mesmo par que o relatório por hora/OPR usa pra transformar leituras cruas de
// `followers_leituras` num delta por bucket, e depois somar um período —
// reaproveitado aqui em vez de reescrever a conta de seguidor pela terceira vez.
import { deltaDeSeguidoresPorHora, seguidoresNoPeriodo } from '../src/ferramentas/meta-ads/relatorio-por-hora.js';

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY_TRAFEGO || process.env.ANTHROPIC_API_KEY_BUDGET || process.env.ANTHROPIC_API_KEY;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://kounqtdoioootxqegkij.supabase.co';
const MODEL = process.env.BUDGET_MODEL || 'claude-opus-4-8';
const GRAPH = 'https://graph.facebook.com/v21.0';
const REST = SUPABASE_URL + '/rest/v1';
const DRY = process.argv.includes('--dry');

const sbHeaders = { apikey: SERVICE_KEY, Authorization: 'Bearer ' + SERVICE_KEY, 'Content-Type': 'application/json' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function sbGet(path) {
  const r = await fetch(REST + path, { headers: sbHeaders });
  if (!r.ok) throw new Error('REST GET ' + path + ' -> ' + r.status + ' ' + (await r.text()).slice(0, 200));
  return r.json();
}
async function sbUpsert(path, body) {
  const r = await fetch(REST + path, {
    method: 'POST',
    headers: { ...sbHeaders, Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify(body),
  });
  if (!r.ok && ![200, 201, 204].includes(r.status)) {
    throw new Error('REST POST ' + path + ' -> ' + r.status + ' ' + (await r.text()).slice(0, 200));
  }
  return r;
}
function cleanAcc(id) { return String(id || '').replace(/^act_/, ''); }
async function graphGet(path, params, token) {
  const url = new URL(GRAPH + path);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, typeof v === 'object' ? JSON.stringify(v) : String(v)));
  url.searchParams.set('access_token', token);
  const r = await fetch(url.toString());
  if (!r.ok) throw new Error('Graph ' + path + ' -> ' + r.status + ' ' + (await r.text()).slice(0, 200));
  return r.json();
}

async function anthropic(body, tentativas = 6) {
  for (let t = 0; t < tentativas; t++) {
    let r;
    try {
      r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch { await sleep(Math.min(60, 8 * (t + 1)) * 1000); continue; }
    if (r.ok) return r.json();
    if (r.status === 429 || r.status >= 500) {
      const ra = parseInt(r.headers.get('retry-after') || '0', 10);
      await sleep((ra > 0 ? ra : Math.min(60, 8 * (t + 1))) * 1000);
      continue;
    }
    throw new Error('Anthropic ' + r.status + ' ' + (await r.text()).slice(0, 300));
  }
  throw new Error('Anthropic: tentativas esgotadas');
}

// Extrai o texto (fora dos blocos de thinking) e detecta refusal.
function textoDaResposta(resp) {
  if (resp && resp.stop_reason === 'refusal') return null;
  const blocks = (resp && resp.content) || [];
  return blocks.filter((b) => b && b.type === 'text').map((b) => b.text).join('').trim();
}

async function main() {
  // Em --dry nada é enviado ao modelo (o laço dá `continue` antes da chamada),
  // então exigir a chave da API só impedia a conferência de rodar na máquina de
  // quem não tem o segredo — que é justamente quando conferir é mais útil.
  if ((!ANTHROPIC_API_KEY && !DRY) || !SERVICE_KEY) {
    console.error('✗ Faltam segredos: ' + (!ANTHROPIC_API_KEY && !DRY ? 'ANTHROPIC_API_KEY_TRAFEGO ' : '') + (!SERVICE_KEY ? 'SUPABASE_SERVICE_KEY' : ''));
    process.exit(1);
  }
  const agoraMs = Date.now();
  let _totIn = 0, _totOut = 0, _chamadas = 0; // uso da API p/ calcular o custo da rodada
  const { modo, motivo } = decidirEscopo(agoraMs, process.env.BUDGET_ESCOPO);
  console.log(`Escopo da rodada: ${modo} — ${motivo}`);
  // A análise é refeita todo dia, então ela vale até a próxima rodada + folga
  // (48h cobrem uma rodada que falhe). Antes era +7 dias, quando o robô era semanal.
  const validaAte = new Date(agoraMs + 2 * 86400000).toISOString();
  const iso = (d) => d.toISOString().slice(0, 10);
  const since = iso(new Date(agoraMs - 7 * 86400000));
  const until = iso(new Date(agoraMs));

  // accounts guarda contas IG/página com access_token; a coluna ad_account_id é vazia.
  // A(s) conta(s) de anúncio são descobertas em runtime via Graph /me/adaccounts (igual ao meta-proxy).
  const contas = await sbGet('/accounts?select=id,name,ad_account_id,access_token');
  // ATENÇÃO: `accounts` tem DOIS tipos de registro. Cinco são as contas do painel
  // (com ad_account_id) e duas são só portadoras de token ("Gustavo Guerra",
  // "Humberto Mendonca") que enxergam TODAS as contas de anúncios. O robô varre
  // /me/adaccounts a partir de cada registro com token, então quem tem token
  // amplo analisa campanha de todo mundo — e era por isso que ele gravava sempre
  // o MESMO account_id em tudo, deixando a fila sem saber de qual cliente era
  // cada sugestão. Este mapa devolve a conta do painel a partir da conta de
  // anúncios onde a campanha realmente vive.
  const contaPorAdAccount = new Map();
  for (const c of contas) if (c.ad_account_id) contaPorAdAccount.set(cleanAcc(c.ad_account_id), c);

  // A régua: pesos e limiares são gerais, as metas são POR CONTA.
  let reguaBruta = null;
  try {
    const linhas = await sbGet('/gt_ponderada_config?select=pesos,metas,limiares,limiares_resultado,metas_por_conta&id=eq.1');
    reguaBruta = normalizarRegua((linhas && linhas[0]) || null);
  } catch (e) {
    // Sem a régua o robô ainda funciona, só volta a julgar pelos indicadores do
    // objetivo — e o prompt manda dizer que a meta não está definida. Melhor que
    // abortar a rodada inteira.
    console.log('  ⚠ não consegui ler a régua, seguindo sem as metas: ' + e.message);
    reguaBruta = normalizarRegua(null);
  }
  let total = 0, gravadas = 0, puladas = 0;

  const seenAdAcc = new Set();
  // OBJETIVO DECLARADO por interação (Tarefa 5): cache por conta do PAINEL —
  // "uma vez por conta", não uma vez por conta de anúncios, para o caso (raro,
  // mas possível) de mais de uma ad account cair na mesma conta do painel.
  const objetivoPorContaCache = new Map();
  // CUSTO POR SEGUIDOR DA CONTA (Tarefa 6): cache por conta do PAINEL, mesmo
  // espírito do cache de objetivo acima — o ganho de seguidores é da conta
  // inteira, não muda entre campanhas nem entre ad accounts do mesmo cliente.
  const seguidoresGanhosPorContaCache = new Map();
  // Buffer ANTES de `since`: `deltaDeSeguidoresPorHora` marca a PRIMEIRA
  // leitura da série com delta nulo (não tem "anterior" pra comparar) — sem
  // pedir alguns dias a mais antes da janela, o primeiro dia de `since..until`
  // ficaria com delta nulo mesmo tendo leitura, e a soma do período sairia
  // menor do que o ganho de verdade. 3 dias de folga cobre até uma falha do
  // coletor por 2 dias seguidos.
  const sinceComBuffer = new Date(new Date(since) - 3 * 86400000).toISOString().slice(0, 10);
  // effective_status pedido ao Graph em cada modo. No campo `campaigns` os valores
  // possíveis são ACTIVE/PAUSED/DELETED/ARCHIVED/IN_PROCESS/WITH_ISSUES.
  const STATUS_ATIVAS = ['ACTIVE'];
  const STATUS_AMPLO = ['ACTIVE', 'PAUSED', 'IN_PROCESS', 'WITH_ISSUES'];
  // `created_time` entrou pro TEMPO NO AR (Tarefa 5) — conferido com --dry antes
  // de escrever o código que depende dele: a Meta devolve mesmo (ex.:
  // "2026-08-12T12:43:46-0300"), não precisou de campo alternativo.
  const campFields ='id,name,effective_status,objective,daily_budget,lifetime_budget,start_time,stop_time,created_time';
  const insFields = 'campaign_id,impressions,clicks,spend,ctr,cpc,reach,frequency,actions,action_values,purchase_roas,objective';
  for (const acc of contas) {
    if (!acc.access_token) continue;
    let adAccounts;
    try {
      adAccounts = (await graphGet('/me/adaccounts', { fields: 'account_id', limit: 200 }, acc.access_token)).data || [];
    } catch (e) { console.log('  conta ' + acc.id + ' falhou /me/adaccounts: ' + e.message); continue; }
    for (const aa of adAccounts) {
      const adAcc = cleanAcc(aa.account_id || aa.id);
      if (!adAcc || seenAdAcc.has(adAcc)) continue;
      seenAdAcc.add(adAcc);
      // De QUEM é esta conta de anúncios — é isso que diz qual meta da régua vale.
      const contaDoPainel = contaPorAdAccount.get(adAcc) || null;
      const reguaDaContaAtual = reguaDaConta(reguaBruta, contaDoPainel && contaDoPainel.id);
      // MAPA campaign_id → interação declarada, lido de `gt_objetivo_interacao`
      // (mesma tabela e mesmas colunas que a TELA lê — ver _gtCarregarObjetivos
      // em tela-de-gestao-trafego.vue). A tabela TEM linhas reais desde julho de
      // 2026: sem este mapa, a tela julga a campanha pela interação declarada e
      // o robô continua julgando pela régua do balde — os dois discordando na
      // mesma campanha, e é o robô quem escreve a justificativa que o dono lê.
      // Uma falha aqui NUNCA derruba a rodada (mesmo padrão dos catches
      // vizinhos — régua, adsets, janela anterior): sem a tabela, toda campanha
      // cai no comportamento de sempre. Mas o catch AVISA: calado, a declaração
      // do dono some da análise sem ninguém perceber.
      let objetivoPorCampanha = {};
      if (contaDoPainel && contaDoPainel.id) {
        if (objetivoPorContaCache.has(contaDoPainel.id)) {
          objetivoPorCampanha = objetivoPorContaCache.get(contaDoPainel.id);
        } else {
          try {
            const linhas = await sbGet(
              `/gt_objetivo_interacao?select=alvo_id,interacao&conta_id=eq.${contaDoPainel.id}&nivel=eq.campanha`);
            (linhas || []).forEach((l) => { objetivoPorCampanha[String(l.alvo_id)] = l.interacao; });
            // Visível na prova seca (--dry) e na rodada real: sem este log não
            // dava pra confirmar, olhando a saída, que a leitura achou as
            // declarações de verdade — só que "não deu erro".
            if (Object.keys(objetivoPorCampanha).length) {
              console.log(`  conta ${contaDoPainel.name}: ${Object.keys(objetivoPorCampanha).length} campanha(s) com objetivo declarado por interação.`);
            }
          } catch (e) {
            console.log('  conta ' + contaDoPainel.id + ' falhou ao ler objetivo por interação, seguindo pela régua do balde: ' + e.message);
            objetivoPorCampanha = {};
          }
          objetivoPorContaCache.set(contaDoPainel.id, objetivoPorCampanha);
        }
      }
      let camps, insights;
      try {
        // No modo amplo pedimos também as pausadas/com-problema — a peneira do que
        // realmente veiculou nos últimos 7 dias é feita depois, com os insights.
        // ARCHIVED/DELETED ficam de fora nos dois modos (campanha morta não recebe sugestão).
        const statusPedidos = modo === 'amplo' ? STATUS_AMPLO : STATUS_ATIVAS;
        camps = (await graphGet(`/act_${adAcc}/campaigns`, { fields: campFields, effective_status: statusPedidos, limit: 500 }, acc.access_token)).data || [];
        insights = (await graphGet(`/act_${adAcc}/insights`, { level: 'campaign', fields: insFields, time_range: { since, until }, limit: 500 }, acc.access_token)).data || [];
      } catch (e) { console.log('  act_' + adAcc + ' falhou no Graph: ' + e.message); continue; }
      const insByCamp = {};
      insights.forEach((i) => { insByCamp[i.campaign_id] = i; });
      // CUSTO POR SEGUIDOR DA CONTA (Tarefa 6) — calculado uma vez por ad
      // account (o gasto é SÓ das campanhas de seguidores DESTA ad account,
      // mesmo critério `ehDeSeguidores` que a tela usa) contra o ganho de
      // seguidores da CONTA DO PAINEL (cacheado, não muda por ad account).
      // Vale null quando não há campanha de seguidores nesta ad account —
      // sem gasto de seguidor, não há o que estimar.
      let custoPorSeguidorContaAtual = null;
      const nomePorCampanhaId = {};
      camps.forEach((c) => { nomePorCampanhaId[c.id] = c.name || ''; });
      const gastoDeSeguidoresContaAtual = insights
        .filter((i) => ehDeSeguidores(nomePorCampanhaId[i.campaign_id] || ''))
        .reduce((s, i) => s + (parseFloat(i.spend) || 0), 0);
      if (gastoDeSeguidoresContaAtual > 0 && contaDoPainel && contaDoPainel.id) {
        let seguidoresGanhosContaAtual;
        if (seguidoresGanhosPorContaCache.has(contaDoPainel.id)) {
          seguidoresGanhosContaAtual = seguidoresGanhosPorContaCache.get(contaDoPainel.id);
        } else {
          try {
            const leituras = await sbGet(
              `/followers_leituras?select=followers_count,lido_em,origem&account_id=eq.${contaDoPainel.id}&lido_em=gte.${sinceComBuffer}&order=lido_em.asc`);
            const deltas = deltaDeSeguidoresPorHora(leituras || []);
            seguidoresGanhosContaAtual = seguidoresNoPeriodo(deltas, since, until);
          } catch (e) {
            // Mesmo padrão dos catches vizinhos (régua, adsets, objetivo): uma
            // falha aqui NUNCA derruba a rodada — a campanha de seguidores só
            // fica sem o número de contexto, e o prompt já trata isso como
            // "não mencione custo por seguidor".
            console.log('  conta ' + contaDoPainel.id + ' falhou ao ler seguidores da conta: ' + e.message);
            seguidoresGanhosContaAtual = null;
          }
          seguidoresGanhosPorContaCache.set(contaDoPainel.id, seguidoresGanhosContaAtual);
        }
        custoPorSeguidorContaAtual = custoPorSeguidorDaConta({
          gastoDeSeguidores: gastoDeSeguidoresContaAtual,
          seguidoresGanhos: seguidoresGanhosContaAtual,
        });
      }
      // A janela ANTERIOR, de mesma duração, para o modelo dizer o SENTIDO do
      // movimento ("o custo por lead subiu de R$ 12 para R$ 25 em 7 dias").
      // Mesmos campos, mesma conta: uma chamada a mais por conta, na rodada das 8h.
      const diasJanela = Math.max(1, Math.round((new Date(until) - new Date(since)) / 86400000) + 1);
      const fimAnt = new Date(new Date(since) - 86400000).toISOString().slice(0, 10);
      const iniAnt = new Date(new Date(fimAnt) - (diasJanela - 1) * 86400000).toISOString().slice(0, 10);
      let insAnt = [];
      try {
        insAnt = (await graphGet(`/act_${adAcc}/insights`,
          { level: 'campaign', fields: insFields, time_range: { since: iniAnt, until: fimAnt }, limit: 500 },
          acc.access_token)).data || [];
      } catch (e) {
        // Tolerado de propósito — perder a tendência é pior que derrubar a
        // rodada inteira — mas NUNCA em silêncio: sem este log, a conta fica
        // indistinguível de "não havia janela anterior mesmo", o modelo some
        // com a tendência e ninguém descobre por quê (correção pedida na
        // rodada 1, 24/09/2026).
        console.log('  act_' + adAcc + ' falhou janela anterior no Graph: ' + e.message);
        insAnt = [];
      }
      const insAntByCamp = {};
      insAnt.forEach((i) => { insAntByCamp[i.campaign_id] = i; });
      // CONJUNTOS: em campanha ABO o orçamento mora aqui, não na campanha. Sem
      // esta busca o robô lia R$ 0,00 e sugeria em cima do zero (ver
      // orcamentoEfetivoDaCampanha). Uma falha aqui não derruba a rodada: a
      // campanha ABO fica com orçamento 'indefinido' e o prompt manda o modelo
      // responder "manter" — melhor calar do que sugerir em cima de nada.
      let adsets = [];
      try {
        // destination_type/optimization_goal são o que a Meta AFIRMA sobre a campanha
        // ser de WhatsApp (ver ehDeWhatsapp em baldes.js). Sem eles, campanha de
        // WhatsApp de verdade era julgada pela meta de engajamento — a "[IA] Dom
        // Pedro · WhatsApp" caía em R$ 0,012 por ponto em vez de R$ 7,70 por conversa.
        adsets = (await graphGet(`/act_${adAcc}/adsets`, { fields: 'id,campaign_id,daily_budget,lifetime_budget,effective_status,destination_type,optimization_goal', limit: 500 }, acc.access_token)).data || [];
      } catch (e) { console.log('  act_' + adAcc + ' falhou adsets no Graph: ' + e.message); }
      // INSIGHTS POR CONJUNTO (Onda C, Tarefa 3): só usados quando a campanha
      // sai MISTA (dois mercados vivos ao mesmo tempo, ver mercadoDaCampanha
      // em mercados.js) — é o gasto e o KPI de CADA conjunto que o modelo
      // recebe pra julgar mercado a mercado, em vez de somar mercados
      // diferentes numa média sem significado (caso real: [LEADS LOJA]
      // [mixconversão] da Vessel, WhatsApp + site na mesma campanha). Uma
      // falha aqui NUNCA derruba a rodada — mesmo padrão dos catches vizinhos
      // (régua, ads, janela anterior): a campanha mista só fica sem a quebra
      // por conjunto, e cai em "sem-dados" nela, nunca inventa custo.
      const adsetFields = 'adset_id,campaign_id,spend,impressions,clicks,ctr,cpc,reach,frequency,actions,action_values';
      let adsetIns = [];
      try {
        adsetIns = (await graphGet(`/act_${adAcc}/insights`, { level: 'adset', fields: adsetFields, time_range: { since, until }, limit: 500 }, acc.access_token)).data || [];
      } catch (e) { console.log('  act_' + adAcc + ' falhou insights por conjunto no Graph: ' + e.message); }
      const insPorAdset = {};
      adsetIns.forEach((i) => { insPorAdset[i.adset_id] = i; });
      // O conjunto ganha os campos de INSIGHT (spend/actions/action_values) por
      // cima da CONFIGURAÇÃO já lida acima (destination_type/optimization_goal)
      // — mesmo objeto, sem sobrescrever o que já tinha. Sem insight nesta
      // janela (conjunto pausado, ou zero gasto), os campos ficam ausentes:
      // `custoDoAlvo`/`_gtPerGasto` já leem ausência como null, nunca como zero.
      adsets.forEach((cj) => {
        const ins = insPorAdset[cj.id];
        if (ins) { cj.spend = ins.spend; cj.actions = ins.actions; cj.action_values = ins.action_values; }
      });
      const conjuntosPorCamp = {};
      adsets.forEach((cj) => { (conjuntosPorCamp[cj.campaign_id] = conjuntosPorCamp[cj.campaign_id] || []).push(cj); });
      // actions/action_values entraram pra dar o RESULTADO de cada anúncio (leads,
      // conversas, compras...) — mesmo GET de sempre, nenhuma chamada nova à API.
      const adFields = 'ad_id,ad_name,adset_name,campaign_id,spend,impressions,clicks,ctr,cpc,reach,frequency,actions,action_values';
      let adIns = [], adObjs = [];
      try {
        adIns = (await graphGet(`/act_${adAcc}/insights`, { level: 'ad', fields: adFields, time_range: { since, until }, limit: 500 }, acc.access_token)).data || [];
        adObjs = (await graphGet(`/act_${adAcc}/ads`, { fields: 'id,effective_status', limit: 500 }, acc.access_token)).data || [];
      } catch (e) { console.log('  act_' + adAcc + ' falhou ads no Graph: ' + e.message); }
      const adStatus = {};
      adObjs.forEach((a) => { adStatus[a.id] = a.effective_status || ''; });
      const adsAtivosPorCamp = {};
      adIns.forEach((a) => {
        if (adStatus[a.ad_id] !== 'ACTIVE') return; // só anúncios ativos
        (adsAtivosPorCamp[a.campaign_id] = adsAtivosPorCamp[a.campaign_id] || []).push(a);
      });
      const selecionadas = selecionarCampanhas(camps, insByCamp, modo, agoraMs);
      console.log(`Conta ${acc.id} / act_${adAcc}: ${selecionadas.length} campanhas a analisar (modo ${modo}).`);

    for (const camp of selecionadas) {
      total++;
      const ins = insByCamp[camp.id] || {};
      const conjuntosDaCamp = conjuntosPorCamp[camp.id] || [];
      // TEMPO NO AR: quantos dias inteiros desde created_time. Sem o campo (a
      // Meta não deu por algum motivo) fica null — o prompt já trata isso como
      // "não presuma aprendizado" (ver em_aprendizado em montarMensagens).
      const criadoEm = camp.created_time ? new Date(camp.created_time).getTime() : null;
      const diasNoAr = criadoEm ? Math.floor((agoraMs - criadoEm) / 86400000) : null;
      // Objetivo declarado DESTA campanha (Tarefa 5) — `undefined` quando o
      // dono não declarou nada, e `montarMensagens`/`custoAtualDoAlvo` tratam
      // isso (e qualquer valor inválido) como "sem declaração".
      const interacaoDeclarada = objetivoPorCampanha[String(camp.id)];
      // `diasJanela` já foi calculado uma vez por conta (mesmo since/until pra
      // toda campanha dela) — passa por `extra` pro prompt citar o número real
      // em vez do "7 dias" cravado que a janela (8 dias inclusive) desmentia.
      const { system, user } = montarMensagens(camp, ins, adsAtivosPorCamp[camp.id] || [], conjuntosDaCamp, reguaDaContaAtual,
        { insAnterior: insAntByCamp[camp.id], diasNoAr, diasJanela, interacaoDeclarada, custoPorSeguidorConta: custoPorSeguidorContaAtual });
      if (DRY) {
        // Mostra o orçamento que o modelo VAI ver. É a forma barata de conferir,
        // sem gastar uma chamada, se a leitura de CBO/ABO está certa — foi
        // exatamente o que passou despercebido enquanto o dry só imprimia o nome.
        const o = orcamentoEfetivoDaCampanha(camp, conjuntosDaCamp);
        const valor = o.centavos != null ? 'R$ ' + (o.centavos / 100).toFixed(2) : 'NÃO LIDO';
        const extra = o.conjuntosIgnorados ? ` (+${o.conjuntosIgnorados} conj. pausado ignorado)` : '';
        // MESMO mercado que montarMensagens calcula por dentro, não uma cópia
        // da fórmula (Onda C, Tarefa 3) — uma divergência aqui seria o
        // diagnóstico mentindo sobre o que o robô realmente vai julgar.
        const mercadoDry = mercadoDaCampanha(comObjetivoHerdado(camp, conjuntosDaCamp));
        // OBJETIVO DECLARADO (Tarefa 5): valida de novo aqui (mesma guarda que
        // custoAtualDoAlvo aplica por dentro) só para poder MOSTRAR no --dry
        // qual mercado está julgando esta campanha — sem isto a prova seca não
        // teria como confirmar visualmente que a declaração pegou.
        const interDry = interacaoValida(interacaoDeclarada) ? interacaoDeclarada : null;
        const mt = metaDoBalde(reguaDaContaAtual, interDry || mercadoDry);
        const quem = contaDoPainel ? contaDoPainel.name : '??';
        // A MESMA função que montarMensagens usa por dentro, não uma cópia da
        // fórmula. O --dry é a ferramenta que a gente usa pra conferir se o
        // robô está enxergando certo — uma divergência aqui seria o
        // diagnóstico mentindo sobre o próprio robô (ver custoAtualDoAlvo).
        // Campanha de seguidores SEM mercado `perfil`: NÃO imprime custo
        // nenhum — imprimir "custo R$ X" aqui seria a mesma mentira que este
        // trabalho existe pra tirar do que vai pro modelo (ver
        // ehDeSeguidores/deSeguidores em montarMensagens). APOSENTADO pra
        // mercado `perfil` (25/09/2026, rodada de correção 1): a campanha
        // agora entra no `custoAtualDoAlvo` normal, igual qualquer outro
        // mercado — só o CONTEXTO da conta (`txtSeguidorConta` abaixo)
        // continua ligado ao nome, não ao mercado.
        const ehSeguidoresDry = ehDeSeguidores(camp.name);
        const semMedidaDeSeguidorDry = ehSeguidoresDry && mercadoDry !== 'perfil';
        // MISTA (Onda C): sem interação declarada, campanha mista não tem
        // custo ÚNICO de campanha — mesma regra que montarMensagens aplica no
        // ramo `por_conjunto` (ver dados.regua ali).
        const ehMistaDry = mercadoDry === 'misto' && !interDry;
        const ca = (semMedidaDeSeguidorDry || ehMistaDry) ? null : custoAtualDoAlvo(mercadoDry, ins, reguaDaContaAtual, interDry);
        const txtCusto = semMedidaDeSeguidorDry ? 'medida indisponível (seguidores)'
          : ehMistaDry ? `misto (${conjuntosDaCamp.length} conj. — julgado por conjunto, sem custo de campanha)`
          : (ca == null ? 'custo SEM DADO' : `custo R$ ${ca.toFixed(2)}`);
        // TAREFA 6 (Onda B): o número de CONTEXTO da conta, só pra conferir no
        // --dry que a conta certa está sendo lida — nunca aparece como custo
        // DESTA campanha (por isso separado de txtCusto, nunca somado a ele).
        // Continua ligado a `ehSeguidoresDry` (o NOME), não a `semMedidaDeSeguidorDry`:
        // o contexto da conta vale tanto quando a medida da campanha está
        // indisponível quanto quando ela é `perfil` com custo real — as duas
        // metades da decisão do dono de 25/09 (custo por visita + seguidor da
        // conta, lado a lado).
        const txtSeguidorConta = ehSeguidoresDry
          ? (custoPorSeguidorContaAtual && custoPorSeguidorContaAtual.confiavel && custoPorSeguidorContaAtual.valor != null
            ? ` · conta: R$ ${custoPorSeguidorContaAtual.valor.toFixed(2)}/seguidor em ${diasJanela}d (estimativa da conta, orgânico incluso)`
            : ` · conta: sem estimativa confiável de custo por seguidor${custoPorSeguidorContaAtual ? ' (' + custoPorSeguidorContaAtual.porque + ')' : ''}`)
          : '';
        const txtIdx = (!semMedidaDeSeguidorDry && !ehMistaDry && ca != null && mt > 0) ? ` (${(ca / mt).toFixed(2)}× a meta)` : '';
        // Rótulo do mercado impresso na linha: "conversa" de sempre, ou
        // "conversa → salvamentos" quando declarado — é o que a prova seca
        // (Passo 5 da Tarefa 3/5) confere a olho nu.
        const balTxt = interDry ? `${mercadoDry} → ${interDry}` : mercadoDry;
        // TENDÊNCIA no --dry (rodada de correção 1, 24/09/2026): sem isto não
        // havia como conferir que a janela anterior está chegando de verdade
        // sem rodar o modelo — e a rodada real gasta Opus e grava no banco.
        // MESMA custoAtualDoAlvo do resto (não recalcular por fora foi
        // justamente o defeito corrigido na tarefa anterior). Sem janela
        // anterior OU sem custo anterior, não imprime nada a mais — "antes —"
        // só poluiria a linha sem dizer nada de novo.
        const insAnterior = insAntByCamp[camp.id];
        const caAnt = (insAnterior && !ehMistaDry && !semMedidaDeSeguidorDry) ? custoAtualDoAlvo(mercadoDry, insAnterior, reguaDaContaAtual, interDry) : null;
        const txtTend = (ca != null && caAnt != null)
          ? ` · antes R$ ${caAnt.toFixed(2)} ${ca > caAnt ? '▲' : (ca < caAnt ? '▼' : '=')}`
          : '';
        console.log(`  [dry] ${camp.name || camp.id} — ${quem} · ${o.sigla || 'sem nível'} ${valor}${o.conjuntosSomados ? ` em ${o.conjuntosSomados} conj.` : ''}${extra} · ${balTxt} meta ${mt > 0 ? 'R$ ' + mt : 'NÃO DEFINIDA'} · ${txtCusto}${txtIdx}${txtTend}${txtSeguidorConta}`);
        continue;
      }
      let saida;
      try {
        const resp = await anthropic({ model: MODEL, max_tokens: 8192, thinking: { type: 'adaptive' }, system, messages: [{ role: 'user', content: user }] });
        _chamadas++; _totIn += (resp && resp.usage && resp.usage.input_tokens) || 0; _totOut += (resp && resp.usage && resp.usage.output_tokens) || 0;
        saida = parsearSaida(textoDaResposta(resp));
      } catch (e) { console.log('  ✗ ' + (camp.name || camp.id) + ': ' + e.message); puladas++; continue; }
      if (!saida) { console.log('  ⚠ ' + (camp.name || camp.id) + ': sem sugestão válida'); puladas++; continue; }
      try {
        await sbUpsert('/gt_budget_analises', [{
          campaign_id: camp.id,
          // A conta do PAINEL (de quem é a campanha), não o registro que carregava
          // o token. Sem isto a fila não conseguia filtrar por cliente: todas as
          // análises vinham com o mesmo account_id.
          account_id: (contaDoPainel && contaDoPainel.id) || acc.id,
          objetivo: camp.objective || null,
          effective_status: camp.effective_status || null,
          // O que a campanha tem NO AR — em ABO isso vem da soma dos conjuntos
          // ativos. Antes gravava o campo da campanha, nulo em ABO, e a tela
          // mostrava "R$ 0,00 → R$ 200,00" numa campanha que já rodava R$ 230.
          budget_atual_centavos: orcamentoEfetivoDaCampanha(camp, conjuntosDaCamp).centavos,
          budget_sugerido_centavos: saida.budget_sugerido_centavos,
          veredito: saida.veredito,
          justificativa: saida.justificativa,
          impacto_estimado: saida.impacto_estimado,
          impactos: saida.impactos,
          modelo: MODEL,
          gerado_em: new Date().toISOString(),
          valida_ate: validaAte,
        }]);
        gravadas++;
      } catch (e) {
        console.log('  ✗ gravar ' + (camp.name || camp.id) + ': ' + e.message);
        puladas++;
        continue;
      }
      if (saida.anuncios && saida.anuncios.length) {
        const adRows = saida.anuncios.map((a) => ({
          ad_id: a.ad_id,
          campaign_id: camp.id,
          account_id: acc.id,
          veredito: a.veredito,
          justificativa: a.justificativa,
          modelo: MODEL,
          gerado_em: new Date().toISOString(),
          valida_ate: validaAte,
        }));
        try {
          await sbUpsert('/gt_ad_analises', adRows);
        } catch (e) { console.log('  ✗ gravar anúncios ' + (camp.name || camp.id) + ': ' + e.message); }
      }
    }
    }
  }
  console.log(`Concluído: ${total} analisadas, ${gravadas} gravadas, ${puladas} puladas.`);
  const _usd = _totIn / 1e6 * 5 + _totOut / 1e6 * 25; // Opus 4.8: US$5/1M entrada, US$25/1M saída
  console.log(`💰 Custo da rodada: ~US$ ${_usd.toFixed(2)} (~R$ ${(_usd * 5.5).toFixed(2)}) · ${_chamadas} chamadas · ${_totIn} tokens entrada + ${_totOut} saída (câmbio aprox. 5,5)`);
  await registrarExecucao({
    robo: 'budget-ia', acao: 'análise de budget', modelo: MODEL,
    inputTokens: _totIn, outputTokens: _totOut, chamadas: _chamadas,
    duracaoMs: Date.now() - agoraMs, itens: total, unidade: 'campanhas',
    status: 'ok', detalhe: `${total} analisadas, ${gravadas} com sugestão, ${puladas} puladas`,
  });
}

// Só roda main() quando executado como script (não quando importado nos testes).
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(async (e) => {
    console.error(e);
    await registrarExecucao({ robo: 'budget-ia', acao: 'análise de budget', modelo: MODEL, status: 'erro', detalhe: String(e && e.message || e).slice(0, 500) });
    process.exit(1);
  });
}
