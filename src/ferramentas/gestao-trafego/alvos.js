// O ALVO de cada MERCADO: quanto o dono aceita pagar por um resultado, na
// unidade que faz sentido para o que aquela campanha COMPRA.
//
// A regra que amarra tudo: TODA meta aqui é "custo por resultado, MENOR É MELHOR".
// É isso que permite um semáforo só para a ferramenta inteira. Por isso venda usa
// CAC (custo por compra) e não ROAS — ROAS é maior-é-melhor e precisaria de uma
// régua invertida, uma segunda régua para manter na cabeça.
//
// `resultado` é a métrica da QUANTIDADE daquele resultado (não do custo): é o
// número que faz sentido mostrar no detalhe do exemplo. Campanha de lead mostra
// LEADS, não curtida e salvamento — mostrar interação numa campanha de lead não
// diz nada sobre o que ela comprou.
//
// REINDEXADO POR MERCADO em 25/09/2026 (Onda C). Até aqui o índice era o BALDE
// (o objetivo declarado: 'engajamento', 'trafego', 'mensagens'...). A medição
// de 25/09 mostrou que o objetivo MENTE sobre o que a campanha compra (ver
// mercados.js): "OUTCOME_ENGAGEMENT" é conversa de WhatsApp na Motoeasy,
// visita ao perfil na Mantova e vídeo na [FLUXO SHOPPING] da Vessel — três
// coisas medidas pela MESMA régua de engajamento antes desta troca, uma delas
// (o vídeo) recebendo "reduzir" por um número que não media o que a campanha
// fazia. Julgar por balde era julgar pelo nome da porta.
//
// Quem decide o índice agora é `mercadoDaCampanha`/`mercadoDoConjunto`
// (mercados.js): as chaves daqui SÃO as de `MERCADOS`, nem uma a mais. Dois
// vereditos que mercados.js devolve de propósito NÃO viram chave aqui:
// 'desconhecido' (nenhum sinal reconhecido) e 'misto' (mais de um mercado na
// mesma campanha) — nenhum dos dois é um mercado, e nenhum dos dois recebe
// veredito de custo (`alvoDoBalde` devolve null pra eles, como pra qualquer
// chave que não exista aqui).
//
// ATUALIZAÇÃO (rodada de correção 3, 25/09/2026): os dois baldes antigos que
// ficaram sem mercado correspondente na primeira versão desta troca GANHARAM
// mercado nesta rodada, quando a medição foi ampliada para campanhas
// pausadas/arquivadas (ver mercados.js):
//   'reconhecimento' (CPM/alcance, objetivo de awareness) — agora é o mercado
//     `reconhecimento` (destino UNDEFINED + otimização REACH). O dono já tem
//     meta calibrada com este nome (`metas.reconhecimento`) do balde antigo, e
//     é o MESMO resultado (CPM de campanha de alcance) — por isso declara
//     `chaveMeta: 'reconhecimento'` mesmo sendo igual ao nome do mercado: é
//     documentar a herança, não deixar ao acaso o nome bater sozinho.
//   'leads' (LEAD_GENERATION / pixel de conversão com objetivo de lead) —
//     agora é o mercado `lead` (singular; otimização OFFSITE_CONVERSIONS +
//     objetivo OUTCOME_LEADS). O dono já tem meta calibrada como `metas.leads`
//     (plural) do balde antigo — mesmo resultado (custo por lead) com nome de
//     chave diferente do mercado novo, por isso `chaveMeta: 'leads'`.
//
// A CHAVE DA META (`chaveMeta`) nem sempre é o nome do mercado — é o mecanismo
// que sobrevive a esta troca de índice, para o dono não perder o que já
// calibrou. Cinco mercados são a MESMA coisa que ele já vinha medindo com
// outro nome, e usam `chaveMeta` para continuar lendo a meta salva:
//   conversa       -> chaveMeta 'mensagens'      (era o balde de WhatsApp/Direct)
//   site_venda     -> chaveMeta 'vendas'         (era o balde de venda)
//   site_trafego   -> chaveMeta 'trafego'        (era o balde de tráfego de site)
//   lead           -> chaveMeta 'leads'          (era o balde de formulário/cadastro)
//   reconhecimento -> chaveMeta 'reconhecimento' (era o balde de CPM/alcance —
//                      mesmo nome, declarado explicitamente mesmo assim, pra
//                      não depender de coincidência de string)
// Os outros três mercados (`perfil`, `video`, `post`) NÃO declaram `chaveMeta`
// — leem a meta pelo próprio nome (`metas.perfil`, `metas.video`,
// `metas.post`), que hoje não existe em nenhuma conta, de propósito:
//   - `perfil` e `video` são mercados NOVOS: não existia veredito de custo
//     nenhum para eles antes desta onda, então não há meta antiga para herdar.
//   - `post` é o mercado mais PARECIDO com o antigo balde 'engajamento', mas
//     não é o mesmo conjunto de campanhas: o antigo 'engajamento' incluía, só
//     por causa do objetivo declarado, campanhas que HOJE saem para 'perfil'
//     e 'video' (foi exatamente essa mistura que produziu o "662× a meta" da
//     [FLUXO SHOPPING] em 24/09). A meta antiga de engajamento bruto
//     (`engajamento_bruto`) foi calibrada nessa mistura — trazê-la para 'post'
//     aplicaria, sem o dono saber, um número calibrado para outra coisa.
// Decisão do dono registrada na spec (2026-09-25, seção 7, risco 3): "toda
// meta nova começa vazia. Até o dono definir, sem cor" — a regra desta
// ferramenta desde a Onda A. Ver alvos.test.mjs para a prova de que as três
// metas antigas continuam sendo encontradas pelas chaves novas.
//
// ATUALIZADO 24/09/2026 (histórico, preservado nesta troca): a meta em
// R$/engajamento bruto que substituiu o ponto ponderado ficava em
// `engajamento_bruto`, ao lado da meta antiga em `engajamento` (R$/ponto, que
// só volta a valer se o interruptor da ponderada — Tarefa 4 desta onda — for
// religado). Nenhuma das duas é herdada por mercado nenhum aqui, pelo motivo
// acima — ambas continuam no banco, só deixam de ser lidas por este módulo.
// PURO: sem rede, sem tela.
import { faixaDoIndice } from './ponderada.js';

export const ALVOS = {
  conversa: {
    // Preserva a meta que o dono já calibrou como 'mensagens': mesma conta,
    // mesmo resultado (conversa de WhatsApp/Direct iniciada) — só o nome do
    // índice mudou de balde (objetivo) para mercado (o que o conjunto afirma).
    metrica: 'custo_conversa', resultado: 'conversas', chaveMeta: 'mensagens',
    rotulo: 'Custo por lead', unidade: 'R$',
    ajuda: 'Cada conversa de WhatsApp ou Direct aberta. É o resultado que este mercado compra, seja qual for o objetivo declarado da campanha (ver mercados.js).',
  },

  // NASCE NESTA ONDA (25/09/2026). Até aqui, campanha de perfil (Instagram)
  // não tinha custo por resultado — "medida indisponível" na tela (a marca
  // sai nesta onda, ver spec seção 4). A Meta não devolve `profile_visit` nem
  // `follow` por campanha (conferido em 12 campanhas, 3 contas, 25/09): o
  // clique (`link_click`) é o único proxy que existe NO NÍVEL DA CAMPANHA.
  // Custo por seguidor continua existindo — só que da CONTA (Onda B), nunca
  // daqui: por isso `unidade`/`rotulo` falam em "visita ao perfil", não em
  // "seguidor".
  perfil: {
    metrica: 'custo_visita_perfil', resultado: 'visitas_perfil',
    rotulo: 'Custo por visita ao perfil', unidade: 'R$',
    ajuda: 'Quanto você aceita pagar por cada clique que levou alguém ao perfil do Instagram. É o único proxy que a Meta dá por campanha — seguidor de verdade só existe medido pela conta, como estimativa.',
  },

  // NASCE NESTA ONDA. Antes, campanha ON_VIDEO/THRUPLAY caía no balde de
  // engajamento (por objetivo declarado OUTCOME_ENGAGEMENT) e era julgada por
  // ponto ou por engajamento bruto — nenhum dos dois mede vídeo. Foi o caso
  // real da [FLUXO SHOPPING] da Vessel: 11.323 views contadas como
  // "engajamento" viraram 44 pontos ponderados, e a campanha levou "reduzir"
  // em 24/09 por régua que não media o que ela comprava. O produto dela é
  // view, então o custo é por view.
  video: {
    metrica: 'custo_view', resultado: 'video_views',
    rotulo: 'Custo por view', unidade: 'R$',
    ajuda: 'Quanto você aceita pagar por cada visualização de vídeo que a Meta conta.',
  },

  // O mercado mais parecido com o antigo balde 'engajamento' — mas NÃO é o
  // mesmo conjunto de campanhas (ver o bloco grande no topo do arquivo): o
  // antigo incluía, sem o dono saber, campanhas que hoje são 'perfil' e
  // 'video'. Por isso a meta antiga (`engajamento_bruto`) não é herdada aqui.
  // ⚠️ RELIGAR A PONDERADA NÃO É "TROCAR DUAS LINHAS" AQUI (correção da revisão
  // final da Onda B, 25/09/2026, mantida na Onda C): trocar `metrica` para
  // 'ponderada' no mercado `post` e apagar a chave de meta NÃO religa nada
  // sozinho. `custoDoAlvo` (metricas.js) tem guarda explícita devolvendo `null`
  // para `metrica === 'ponderada'` — o ramo que chamava `calcularPonderada` foi
  // REMOVIDO de lá, não desviado — e o cartão não sabe ler 'ponderada' no
  // catálogo de métricas. O interruptor da régua (Seção 1, `ponderadaLigada` em
  // regua.js) JÁ EXISTE e guarda a escolha; o que falta é ele trocar também o
  // CÁLCULO e os limiares — é a T4b, pendente.
  post: {
    metrica: 'custo_engajamento', resultado: 'engaj_pub',
    rotulo: 'Custo por engajamento', unidade: 'R$',
    ajuda: 'Quanto você aceita pagar por cada engajamento que a Meta conta na publicação (curtida, comentário, compartilhamento, clique, salvamento e afins, todos valendo o mesmo).',
  },

  site_venda: {
    // Preserva a meta que o dono já calibrou como 'vendas'.
    metrica: 'cac', resultado: 'compras', chaveMeta: 'vendas',
    rotulo: 'Custo por venda', unidade: 'R$',
    ajuda: 'Quanto custa trazer uma venda. Usamos custo por venda (e não ROAS) para toda a ferramenta ter uma régua só.',
  },

  site_trafego: {
    // Preserva a meta que o dono já calibrou como 'trafego'.
    metrica: 'custo_visita', resultado: 'visitas', chaveMeta: 'trafego',
    rotulo: 'Custo por visita', unidade: 'R$',
    ajuda: 'Quanto você aceita pagar por cada pessoa que realmente chegou no destino.',
  },

  // NASCE NESTA RODADA (correção 3, 25/09/2026), junto com o sinal em
  // mercados.js (UNDEFINED + OFFSITE_CONVERSIONS + objective OUTCOME_LEADS).
  // Preserva a meta que o dono já calibrou como 'leads' (balde antigo).
  lead: {
    metrica: 'custo_lead', resultado: 'leads', chaveMeta: 'leads',
    rotulo: 'Custo por lead', unidade: 'R$',
    ajuda: 'Quanto você aceita pagar por cada lead (cadastro/formulário) que a Meta conta via pixel de conversão. É diferente de venda mesmo usando o mesmo tipo de otimização — só o objetivo declarado diferencia (ver mercados.js).',
  },

  // NASCE NESTA RODADA, junto com o sinal em mercados.js (otimização REACH).
  // Mede por CPM porque o que esta campanha COMPRA é impressão/alcance, não
  // uma ação — CAC ou custo por clique não fariam sentido aqui. É a única
  // exceção à regra "toda meta é custo por RESULTADO discreto" (ver topo do
  // arquivo): CPM já é, por definição, custo a cada mil impressões, então
  // continua "menor é melhor" e cabe no mesmo semáforo sem régua invertida.
  // Preserva a meta que o dono já calibrou como 'reconhecimento' (balde antigo).
  reconhecimento: {
    metrica: 'cpm', resultado: 'impressoes', chaveMeta: 'reconhecimento',
    rotulo: 'Custo por mil impressões (CPM)', unidade: 'R$',
    ajuda: 'Quanto você aceita pagar a cada mil impressões. É a régua de campanha de alcance/reconhecimento: o que ela compra é exposição, não uma ação específica.',
  },
};

// Sem alvo definido devolve null — e null faz o veredito cair na leitura de
// saúde daquele mercado (ou em 'sem-dados'), que é melhor do que inventar um
// alvo qualquer. Cobre 'desconhecido' e 'misto' (nunca têm entrada aqui, de
// propósito) e qualquer chave que não exista — inclusive os nomes de balde de
// antes desta troca que NÃO batem com um mercado atual ('engajamento',
// 'mensagens', 'trafego', 'vendas', 'leads' no plural): nenhum deles indexa
// `ALVOS` diretamente. ⚠️ 'reconhecimento' é EXCEÇÃO: o mercado novo tem o
// mesmo nome do balde antigo, então `alvoDoBalde('reconhecimento')` agora
// ACHA alvo — não confundir com os outros nomes de balde desta lista, que
// continuam batendo em null.
export function alvoDoBalde(balde) {
  return (balde && ALVOS[balde]) || null;
}

export function avaliarAlvo(entrada) {
  const e = entrada || {};
  const custo = Number(e.custo);
  const meta = Number(e.meta);
  const temCusto = e.custo != null && Number.isFinite(custo) && custo >= 0;
  const temMeta = Number.isFinite(meta) && meta > 0;
  const indice = (temCusto && temMeta) ? custo / meta : null;
  return { indice, faixa: faixaDoIndice(indice, e.limiares) };
}
