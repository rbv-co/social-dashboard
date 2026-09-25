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
//
// 'lead' e 'reconhecimento' entraram na rodada de correção 3 (25/09/2026),
// quando a medição foi ampliada para campanhas pausadas/arquivadas e apareceram
// sinais reais que a fixture original (só campanhas ativas) não cobria.
export const MERCADOS = ['conversa', 'perfil', 'video', 'post', 'site_venda', 'site_trafego', 'lead', 'reconhecimento'];

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
//
// REACH (rodada de correção 3, 25/09/2026): a Meta manda isso para campanha de
// alcance/reconhecimento — o produto comprado é impressão, medido por CPM, não
// por resultado de ação nenhuma. Só apareceu com `objective=OUTCOME_AWARENESS`
// na medição, mas quem decide aqui é a otimização (como todo o resto desta
// tabela) — não precisa do objetivo para significar "compra alcance".
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
  REACH: 'reconhecimento',
};

// OBJETIVO como TERCEIRO critério — a ordem agora é DESTINO -> OTIMIZAÇÃO ->
// OBJETIVO, e o objetivo só fala quando os dois primeiros não bastam sozinhos.
// Hoje o único caso medido é `OFFSITE_CONVERSIONS`: é o MESMO pixel de
// conversão tanto numa campanha de VENDA quanto numa de LEAD (formulário,
// cadastro) — a otimização não desambigua, só o objetivo declarado diz qual
// dos dois é.
//
// ⚠️ Isto NÃO contradiz a trava "o objetivo declarado não decide o mercado"
// (ver mercados.test.mjs, bloco com WHATSAPP+CONVERSATIONS e três objetivos
// diferentes convergindo em 'conversa'). Aquele teste prova que, QUANDO
// destino e otimização já bastam para decidir, o objetivo não muda nada — e
// continua não mudando: `mercadoDoConjunto` só chega a consultar objetivo
// para as chaves listadas aqui, e mesmo assim depois de destino e otimização
// já terem sido tentados. Este mapa é a exceção documentada, não a regra geral
// — se o objetivo passasse a decidir cedo (antes do destino/otimização, ou
// para uma otimização que já é inequívoca sozinha), a trava antiga quebraria,
// e ISSO é o sinal de que a ordem foi implementada errado.
const MERCADO_POR_OTIMIZACAO_E_OBJETIVO = {
  OFFSITE_CONVERSIONS: {
    OUTCOME_LEADS: 'lead',
    OUTCOME_SALES: 'site_venda',
  },
};

// HERDA O OBJETIVO DA CAMPANHA para cada conjunto que ainda não tiver o seu
// próprio (rodada de correção 1 da Onda C, Tarefa 5 — achado C1 da revisão,
// 25/09/2026). A Graph API só devolve `objective` no nível da CAMPANHA — o
// conjunto não tem esse campo —, mas `mercadoDoConjunto` o usa como ÚLTIMO
// desempate (`OFFSITE_CONVERSIONS`: lead x venda, ver
// MERCADO_POR_OTIMIZACAO_E_OBJETIVO acima). Sem herdar, esse desempate nunca
// dispara vindo de um conjunto puro do Graph, e a tela e o robô podem julgar
// a MESMA campanha por mercados diferentes — a classe de defeito que esta
// onda inteira existe pra matar.
//
// NASCEU no robô (`coletor/budget-ia.mjs`, função `comObjetivoHerdado`) e foi
// MOVIDA pra cá nesta rodada de correção: robô e tela importam a MESMA
// função agora, em vez de duas cópias que podiam divergir entre si (foi
// exatamente essa divergência — a tela nunca herdava nada — que a revisão
// encontrou). Se o conjunto já vier com `objective` próprio (a Graph não faz
// isso hoje, mas não custa não sobrescrever), ele é respeitado como está.
// PURO: sem rede, sem tela.
export function comObjetivoHerdado(campanha, conjuntos) {
  const objetivo = campanha && campanha.objective;
  return (conjuntos || []).map((cj) => ((cj && cj.objective) ? cj : { ...(cj || {}), objective: objetivo }));
}

// O mercado de UM conjunto: destino primeiro, otimização como desempate,
// objetivo como último recurso só para as poucas otimizações ambíguas por
// natureza (ver `MERCADO_POR_OTIMIZACAO_E_OBJETIVO` acima). Sinal que não bate
// em nenhuma das tabelas devolve 'desconhecido' — nunca chuta por proximidade
// de nome. Isso vale também para `WEBSITE` com uma otimização que este módulo
// não reconhece: melhor dizer "não sei medir esta" do que julgar pela régua
// errada.
//
// ⚠️ Quem chama esta função (ou `mercadoDaCampanha`) com conjuntos crus do
// Graph precisa passar por `comObjetivoHerdado` ANTES — senão o desempate por
// objetivo (acima) nunca dispara. Ver o achado C1 da revisão da Tarefa 5.
export function mercadoDoConjunto(conjunto) {
  const destino = String((conjunto && conjunto.destination_type) || '').toUpperCase();
  if (destino in MERCADO_POR_DESTINO) return MERCADO_POR_DESTINO[destino];

  const otimizacao = String((conjunto && conjunto.optimization_goal) || '').toUpperCase();

  // AUTOMATIC_OBJECTIVE (Advantage+): a própria Meta escolhe o que otimizar —
  // EXPLICITAMENTE 'desconhecido', e não por omissão do mapa acima. Não é
  // falha de cobertura: é a ferramenta reconhecendo que não dá para saber o
  // mercado quando quem decide o que perseguir é o algoritmo da Meta, não o
  // gestor. Medido em 4 conjuntos reais (rodada de correção 3, 25/09/2026).
  //
  // ⚠️ GUARDA PREVENTIVA, não código morto: hoje `AUTOMATIC_OBJECTIVE` também
  // não está em `MERCADO_POR_OTIMIZACAO`, então o `if` de baixo (linha
  // seguinte) já devolveria 'desconhecido' sozinho — provado por mutação
  // (revisão da rodada de correção 1): apagar esta linha não derruba teste
  // nenhum HOJE. Ela fica mesmo assim para travar o dia em que alguém
  // acrescentar `AUTOMATIC_OBJECTIVE` ao mapa de otimização (por exemplo, por
  // engano ao copiar uma linha vizinha, ou achando que "documenta melhor" lá)
  // — SEM esta linha, aquele acréscimo futuro faria a Meta decidindo sozinha
  // virar silenciosamente um mercado de verdade, o exato bug que esta
  // rodada existe pra evitar.
  if (otimizacao === 'AUTOMATIC_OBJECTIVE') return 'desconhecido';

  if (!(otimizacao in MERCADO_POR_OTIMIZACAO)) return 'desconhecido';

  // Objetivo como desempate FINAL — só entra em jogo para as otimizações
  // cadastradas em MERCADO_POR_OTIMIZACAO_E_OBJETIVO. Para qualquer outra,
  // este bloco nem roda, e o objetivo (mesmo que venha no conjunto) é
  // ignorado — é exatamente isso que a trava de consistência antiga cobra.
  const desempatePorObjetivo = MERCADO_POR_OTIMIZACAO_E_OBJETIVO[otimizacao];
  if (desempatePorObjetivo) {
    const objetivo = String((conjunto && conjunto.objective) || '').toUpperCase();
    if (objetivo in desempatePorObjetivo) return desempatePorObjetivo[objetivo];
  }

  return MERCADO_POR_OTIMIZACAO[otimizacao];
}

// O mercado de uma CAMPANHA: o conjunto dos mercados dos seus conjuntos, MENOS
// os sinais irreconhecíveis (que não votam nem a favor nem contra). Zero
// conjuntos reconhecidos vira 'desconhecido'; um mercado só, esse mercado;
// mais de um, 'misto' — porque somar gasto e resultado de mercados diferentes
// produz um custo por unidade que não representa nada (o caso real é a
// [LEADS LOJA][mixconversão] da Vessel: um conjunto de WhatsApp e um de site
// na mesma campanha, ao mesmo tempo).
// GASTO POR MERCADO dentro de UMA campanha — para o CABEÇALHO da campanha
// MISTA (Onda C, Tarefa 5): "mostra quais mercados ela mistura e o gasto de
// cada um", sem um custo único (decisão do dono, 25/09/2026 — o caso real é a
// [LEADS LOJA][mixconversão] da Vessel). Recebe os GRUPOS já montados por
// `montarHierarquia` (orcamento-hierarquia.js): cada grupo é um conjunto de
// anúncios, com `.conjunto` (o adset cru, com destination_type/
// optimization_goal) e `.gasto` (soma do gasto dos anúncios do grupo — a MESMA
// fonte que o cartão já usa para o gasto de cada conjunto, não um cálculo
// novo). Um grupo sem `.conjunto` (o `_sem_conjunto` que `montarHierarquia`
// inventa para não perder anúncio órfão) cai em 'desconhecido' — mesma regra
// de `mercadoDoConjunto` para um sinal ausente, nunca apaga os outros grupos.
// PURO: sem rede, sem tela.
export function gastoPorMercado(grupos) {
  const porMercado = new Map();
  for (const g of grupos || []) {
    const mercado = mercadoDoConjunto((g && g.conjunto) || {});
    const gasto = Number(g && g.gasto) || 0;
    porMercado.set(mercado, (porMercado.get(mercado) || 0) + gasto);
  }
  return [...porMercado.entries()]
    .map(([mercado, gasto]) => ({ mercado, gasto }))
    .sort((a, b) => b.gasto - a.gasto);
}

// O MERCADO de um GRUPO DE ANÚNCIOS (um conjunto, com os anúncios dele) DENTRO
// de uma campanha — Onda C, Tarefa 5, Passo 3 (25/09/2026): o card do ANÚNCIO
// ganha o KPI do mercado, pedido do dono ("eu não vejo as kpis no card dos
// anúncios também, sinto falta disso").
//
// Regra igual à do robô (`coletor/budget-ia.mjs`, commit 2b420ab): o mercado
// do anúncio é o da CAMPANHA, descido pronto — NUNCA recalculado por anúncio
// (a Meta OMITE o action_type inteiro quando a contagem é zero, então um
// anúncio de campanha de WhatsApp sem conversa na janela ficaria idêntico a
// um de engajamento puro). EXCEÇÃO — campanha MISTA: cada anúncio segue o
// mercado do CONJUNTO dele, mesma condição (`mercadoDaCampanha === 'misto'`)
// que a tela já usa pra decidir a quebra por conjunto (ver `gastoPorMercado`
// e o KPI por conjunto em tela-de-gestao-trafego.vue).
//
// `idDoGrupo === '_sem_conjunto'` é o grupo INVENTADO por montarHierarquia
// pra não sumir com anúncio cujo adset_id não veio na lista — não existe
// conjunto de verdade pra consultar, então NUNCA INVENTA mercado: devolve
// null, mesmo comportamento do robô quando o adset_id não é reconhecível.
// PURO: sem rede, sem tela.
export function mercadoDoGrupoDeAnuncios(mercadoCampanha, conjunto, idDoGrupo) {
  if (mercadoCampanha !== 'misto') return mercadoCampanha;
  if (!conjunto || idDoGrupo === '_sem_conjunto') return null;
  return mercadoDoConjunto(conjunto);
}

export function mercadoDaCampanha(conjuntos) {
  // Campanha SEM conjunto (`conjuntos` vazio ou ausente) cai em 'desconhecido'
  // — e isso está CERTO, não é bug nem lacuna de coleta. São 186 campanhas nas
  // 6 contas, todas INATIVAS, e já foi conferido que não é truncamento da
  // busca: nenhuma conta bate no limite de paginação da coleta. Registrado
  // aqui para o próximo que ver esse número não sair investigando de novo.
  if (!Array.isArray(conjuntos) || conjuntos.length === 0) return 'desconhecido';

  const mercadosReconhecidos = new Set(
    conjuntos.map(mercadoDoConjunto).filter((mercado) => mercado !== 'desconhecido'),
  );

  if (mercadosReconhecidos.size === 0) return 'desconhecido';
  if (mercadosReconhecidos.size > 1) return 'misto';
  return [...mercadosReconhecidos][0];
}
