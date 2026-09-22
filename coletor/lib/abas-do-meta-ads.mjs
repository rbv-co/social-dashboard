// A PLANILHA DO META ADS: o anúncio de um lado, o lead do outro.
//
// Pedido do dono em 21/09/2026: "um log do meta ads, quando cai lead, lead a
// lead sabe, em abas, lead, venda, em forma de banco de dados igual a planilha
// de base de clientes".
//
// ⚠️ SÓ A CONTA DA VESSEL (`1197997517858139`). O banco guarda SEIS contas de
// anúncio de empresas diferentes — Raíssa Herculano, Motoeasy, Mantova Móveis,
// Breno Vale, La Vessel Dom Pedro e a Vessel. Misturar todas numa planilha que
// mora na pasta da Vessel daria um número que não é de ninguém. A escolha da
// conta é decisão registrada do Growth Plan em 18/09/2026, incluindo deixar a
// La Vessel Dom Pedro de fora.
//
// ⚠️ SÓ `period_days = 1`. A mesma campanha aparece na tabela em vários
// recortes (1, 7, 14, 30, 99 dias) — são a MESMA verba contada de novo em cada
// janela. Somar sem filtrar multiplicaria o gasto por cinco, e o número sairia
// bonito e falso.
//
// ⚠️ E O QUE ESTA PLANILHA **NÃO** CONSEGUE DIZER: quanto cada anúncio vendeu
// no NOSSO Bling. O lead entra em `vessel_lista_espera` e a venda entra em
// `vessel_pedidos`, e não existe hoje o que ligue os dois — a pessoa que se
// cadastra não vira "pessoa" no cadastro. O que existe é a coluna `compras`,
// que é o que a META conta pelo pixel dela. São números diferentes, e a aba
// diz isso no nome.

export const CONTA_DA_VESSEL = '1197997517858139';
export const DIAS_NA_JANELA = 90;

/**
 * As consultas. Cada uma recebe o id interno da conta.
 * ⚠️ O id que aparece aqui é o UUID de `accounts.id`, não o número da Meta — a
 * tradução acontece no robô, uma vez, para nenhuma consulta ter de saber das
 * duas coisas.
 */
export const CONSULTAS = {
  resultados: `
    select c.name as campanha, c.objective as objetivo, c.status as situacao,
           min(i.captured_at)::date as primeiro_dia,
           max(i.captured_at)::date as ultimo_dia,
           sum(i.spend) as gasto,
           sum(i.impressions) as impressoes,
           sum(i.clicks) as cliques,
           sum(i.cadastros) as cadastros,
           sum(i.compras) as compras,
           sum(i.conversas) as conversas
      from campaign_insights i
      join campaigns c on c.campaign_id = i.campaign_id
     where i.account_id = $1 and i.period_days = 1
     group by c.name, c.objective, c.status
     order by sum(i.spend) desc nulls last`,

  dias: `
    select i.captured_at::date as dia, c.name as campanha,
           i.spend as gasto, i.impressions as impressoes, i.clicks as cliques,
           i.reach as alcance, i.cadastros, i.compras, i.conversas, i.visitas
      from campaign_insights i
      join campaigns c on c.campaign_id = i.campaign_id
     where i.account_id = $1 and i.period_days = 1
       and i.captured_at > now() - ($2 || ' days')::interval
     order by i.captured_at desc, i.spend desc nulls last`,

  anuncios: `
    select a.name as anuncio, c.name as campanha, a.status as situacao,
           a.destino_link as para_onde_leva,
           max(h.dia) as ultimo_dia,
           sum(h.gasto_hora) as gasto,
           sum(h.cliques_hora) as cliques
      from ads a
      left join campaigns c on c.campaign_id = a.campaign_id
      left join ad_insights_hora h on h.ad_id = a.ad_id
     where a.account_id = $1
     group by a.name, c.name, a.status, a.destino_link
     order by sum(h.gasto_hora) desc nulls last`,

  // ⚠️ O LEAD SAI DA NOSSA BASE, NÃO DA META. A Meta conta "cadastros" pelo
  // pixel; isto aqui é quem de fato entrou na lista, com nome e WhatsApp.
  // A coluna "A campanha existe?" confere o que a página mandou contra as
  // campanhas de verdade da conta — página não é fonte de verdade sobre
  // atribuição, e campanha que não bate é convite para investigar.
  leads: `
    select l.nome, l.whatsapp, l.email, l.criado_em,
           l.utm_source, l.utm_medium, l.utm_campaign, l.utm_content,
           (l.clique_meta is not null) as veio_de_clique,
           exists (select 1 from campaigns c
                    where c.account_id = $1 and c.name = l.utm_campaign) as campanha_confere,
           l.origem
      from vessel_lista_espera l
     where l.utm_campaign is not null or l.utm_source is not null or l.clique_meta is not null
     order by l.criado_em desc`,

  // ⚠️ AQUI O `$1` É O NÚMERO DA META, e não o UUID interno: `gt_problemas_meta`
  // guarda a conta como a Meta a chama. Parâmetro que aparece só como `$2`, sem
  // `$1`, faz o Postgres recusar a consulta inteira ("could not determine data
  // type of parameter $1") — foi assim que este descuido apareceu.
  problemas: `
    select p.titulo, p.detalhe, p.campanha_nome, p.ad_nome, p.nivel, p.grave,
           p.primeira_vez, p.ultima_vez
      from gt_problemas_meta p
     where p.account_id = $1 and p.resolvido_em is null
     order by p.grave desc nulls last, p.primeira_vez desc`,
};

const INSTRUCOES = (conta) => [
  { texto: 'O QUE É ISTO', secao: true },
  'O Meta Ads da Vessel: o que cada campanha gastou e quem chegou por ela.',
  `Só a conta da Vessel (${conta}). O sistema guarda seis contas de anúncio de`,
  'empresas diferentes; misturar daria um número que não é de ninguém.',
  '',
  { texto: '⚠️ "CADASTROS" E "COMPRAS" SÃO DA META, NÃO DO NOSSO SISTEMA', secao: true },
  'Essas duas colunas são o que o pixel da Meta contou. O nosso Bling conta',
  'diferente, e os dois números não vão bater — não é erro, são réguas',
  'diferentes medindo a mesma coisa.',
  '',
  { texto: 'QUANTO CADA ANÚNCIO VENDEU NO BLING, AINDA NÃO DÁ', secao: true },
  'O lead entra numa tabela e a venda entra em outra, e hoje não existe o que',
  'ligue as duas: quem se cadastra ainda não vira "pessoa" no cadastro.',
  'Quando isso existir, esta planilha ganha a coluna sozinha.',
  '',
  { texto: 'A ABA LEADS COMEÇOU EM 22/09/2026', secao: true },
  'Antes dessa data a página não anotava de qual anúncio a pessoa vinha —',
  'por isso os 153 cadastros antigos não aparecem aqui. Os novos aparecem.',
  '',
  { texto: 'A COLUNA "A CAMPANHA EXISTE?"', secao: true },
  'Ela confere o que veio no endereço contra as campanhas de verdade da conta.',
  '"não" quer dizer que alguém chegou com uma campanha que não é nossa —',
  'pode ser link velho, pode ser alguém mexendo no endereço. Vale olhar.',
  '',
  { texto: 'O QUE TEM EM CADA ABA', secao: true },
  'Resultados por campanha — o total de cada uma: gasto, cadastros, compras',
  'Campanhas dia a dia — a mesma coisa, dia a dia, dos últimos 90 dias',
  'Anúncios — cada anúncio, com gasto, cliques e para onde ele leva',
  'Leads — quem chegou pelo anúncio, lead a lead, da NOSSA base',
  'Problemas — o que a própria Meta reclama da conta',
];

const dinheiro = (t, l = 14) => ({ titulo: t, tipo: 'dinheiro', largura: l });
const numero = (t, l = 13) => ({ titulo: t, tipo: 'numero', largura: l });

/** Divide sem estourar, e devolve vazio em vez de infinito. */
const por = (a, b) => (Number(b) > 0 ? Math.round((Number(a) / Number(b)) * 100) / 100 : '');

export function montarAbasDoMetaAds(d, conta = CONTA_DA_VESSEL) {
  const r = (k) => d[k] ?? [];
  return [
    {
      nome: 'Instruções',
      documentacao: true, filtro: false, zebra: false,
      colunas: [{ titulo: 'COMO USAR ESTA PLANILHA', largura: 104 }],
      linhas: INSTRUCOES(conta).map((l) => [l]),
    },
    {
      nome: 'Resultados por campanha',
      colunas: [
        { titulo: 'Campanha', largura: 46 },
        { titulo: 'Objetivo', largura: 22 },
        { titulo: 'Situação', largura: 12 },
        { titulo: 'Do dia', tipo: 'dia', largura: 12 },
        { titulo: 'Até', tipo: 'dia', largura: 12 },
        dinheiro('Gasto', 15),
        numero('Impressões', 14), numero('Cliques', 11),
        numero('Cadastros (Meta)', 17), numero('Compras (Meta)', 16), numero('Conversas', 12),
        dinheiro('Custo por cadastro', 18), dinheiro('Custo por compra', 17),
      ],
      linhas: r('resultados').map((x) => [
        x.campanha, x.objetivo, x.situacao, x.primeiro_dia, x.ultimo_dia,
        x.gasto, x.impressoes, x.cliques, x.cadastros, x.compras, x.conversas,
        por(x.gasto, x.cadastros), por(x.gasto, x.compras),
      ]),
    },
    {
      nome: 'Campanhas dia a dia',
      colunas: [
        { titulo: 'Dia', tipo: 'dia', largura: 12 },
        { titulo: 'Campanha', largura: 46 },
        dinheiro('Gasto'), numero('Impressões', 14), numero('Cliques', 11),
        numero('Alcance', 12), numero('Cadastros', 12), numero('Compras', 11),
        numero('Conversas', 12), numero('Visitas', 11),
      ],
      linhas: r('dias').map((x) => [
        x.dia, x.campanha, x.gasto, x.impressoes, x.cliques, x.alcance,
        x.cadastros, x.compras, x.conversas, x.visitas,
      ]),
    },
    {
      nome: 'Anúncios',
      colunas: [
        { titulo: 'Anúncio', largura: 46 },
        { titulo: 'Campanha', largura: 40 },
        { titulo: 'Situação', largura: 12 },
        { titulo: 'Último dia', tipo: 'dia', largura: 13 },
        dinheiro('Gasto'), numero('Cliques', 11),
        { titulo: 'Para onde leva', largura: 54 },
      ],
      linhas: r('anuncios').map((x) => [
        x.anuncio, x.campanha, x.situacao, x.ultimo_dia, x.gasto, x.cliques, x.para_onde_leva,
      ]),
    },
    {
      nome: 'Leads',
      colunas: [
        { titulo: 'Nome', largura: 28 },
        { titulo: 'WhatsApp', largura: 18 },
        { titulo: 'E-mail', largura: 30 },
        { titulo: 'Entrou em', tipo: 'instante', largura: 18 },
        { titulo: 'Campanha', largura: 34 },
        { titulo: 'A campanha existe?', largura: 17 },
        { titulo: 'Anúncio (utm_content)', largura: 26 },
        { titulo: 'Origem (utm_source)', largura: 20 },
        { titulo: 'Tipo (utm_medium)', largura: 18 },
        // ⚠️ SIM OU NÃO, NUNCA O IDENTIFICADOR. O `fbclid` é identificador de
        // publicidade ligado a uma pessoa: serve ao retorno para a Meta e não
        // tem uso nenhum numa planilha que circula.
        { titulo: 'Veio de clique de anúncio?', largura: 20 },
        { titulo: 'Por qual página', largura: 20 },
      ],
      linhas: r('leads').map((x) => [
        x.nome, x.whatsapp, x.email, x.criado_em,
        x.utm_campaign, x.utm_campaign ? (x.campanha_confere ? 'sim' : 'não') : '',
        x.utm_content, x.utm_source, x.utm_medium,
        x.veio_de_clique ? 'sim' : 'não', x.origem,
      ]),
    },
    {
      nome: 'Problemas',
      colunas: [
        { titulo: 'O que a Meta diz', largura: 44 },
        { titulo: 'Detalhe', largura: 56 },
        { titulo: 'Campanha', largura: 34 },
        { titulo: 'Anúncio', largura: 30 },
        { titulo: 'Nível', largura: 12 },
        { titulo: 'Grave?', largura: 9 },
        { titulo: 'Desde', tipo: 'dia-de-instante', largura: 12 },
        { titulo: 'Visto pela última vez', tipo: 'dia-de-instante', largura: 18 },
      ],
      linhas: r('problemas').map((x) => [
        x.titulo, x.detalhe, x.campanha_nome, x.ad_nome, x.nivel,
        x.grave ? 'sim' : 'não', x.primeira_vez, x.ultima_vez,
      ]),
    },
  ];
}
