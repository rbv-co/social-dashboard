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
// ⚠️ DOIS BALDES ANTIGOS FICAM SEM MERCADO CORRESPONDENTE nesta troca, e é
// preciso que quem ler saiba disso ANTES de estranhar campanha sem veredito:
//   'reconhecimento' (CPM/alcance, objetivo de awareness) — a tabela de
//     mercados da spec (seção 2) não prevê um mercado para isto; nenhuma
//     combinação destino/otimização de awareness está em `mercados.js`. Uma
//     campanha de reconhecimento vira `mercadoDaCampanha` = 'desconhecido' e
//     fica sem cor até uma onda futura lhe dar mercado.
//   'leads' (LEAD_GENERATION, cadastro fora do WhatsApp) — a spec PREVÊ um
//     mercado `lead_form` (seção 2 da tabela), mas `mercados.js` (Onda C,
//     Tarefa 1) não implementa esse sinal — não está em `MERCADO_POR_DESTINO`
//     nem em `MERCADO_POR_OTIMIZACAO`, nem em `MERCADOS`. Enquanto isso não
//     for acrescentado lá, campanha de formulário de lead também cai em
//     'desconhecido'. A meta que o dono já calibrou (`metas.leads`) continua
//     salva no banco — só fica INALCANÇÁVEL por este caminho até o sinal
//     nascer em mercados.js. Ver task-2-report.md desta onda.
//
// A CHAVE DA META (`chaveMeta`) nem sempre é o nome do mercado — é o mecanismo
// que sobrevive a esta troca de índice, para o dono não perder o que já
// calibrou. Três mercados são a MESMA coisa que ele já vinha medindo com outro
// nome, e usam `chaveMeta` para continuar lendo a meta salva:
//   conversa      -> chaveMeta 'mensagens'  (era o balde de WhatsApp/Direct)
//   site_venda    -> chaveMeta 'vendas'     (era o balde de venda)
//   site_trafego  -> chaveMeta 'trafego'    (era o balde de tráfego de site)
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
};

// Sem alvo definido devolve null — e null faz o veredito cair na leitura de
// saúde daquele mercado (ou em 'sem-dados'), que é melhor do que inventar um
// alvo qualquer. Cobre 'desconhecido' e 'misto' (nunca têm entrada aqui, de
// propósito) e qualquer chave que não exista — inclusive os nomes de balde de
// antes desta troca ('engajamento', 'leads', 'reconhecimento', 'mensagens',
// 'trafego', 'vendas'): nenhum deles indexa mais `ALVOS` diretamente.
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
