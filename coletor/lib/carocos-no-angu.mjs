// O LOG DOS CAROÇOS NO ANGU: o que PARECE errado no sistema.
//
// Pedido do dono em 21/09/2026, com as palavras dele: "um log de possíveis
// erros, o que PARECE ser erro, caroço no angu sabe, pode ser do Bling e de
// outras coisas da nossa empresa".
//
// ⚠️ "PARECE" É A PALAVRA IMPORTANTE, e ela manda no desenho todo. Nada aqui é
// acusação: são perguntas que valem a pena olhar. Venda duplicada pode ser duas
// bolsas iguais no mesmo dia; venda sem vendedor pode ser venda de site. Por
// isso cada linha traz O QUE FAZER, e não um veredito — quem decide é gente.
//
// ⚠️ E O LOG MOSTRA TAMBÉM O QUE ESTÁ LIMPO. A aba Resumo lista TODAS as
// conferências, inclusive as que deram zero. Log que só mostra problema não
// deixa saber se a conferência rodou: zero linhas parece "está tudo bem" e
// parece "o robô quebrou", e são coisas opostas. Ver quinze conferências com o
// número de cada uma é o que separa as duas.
//
// Como acrescentar uma conferência: uma entrada aqui, com a consulta e a frase
// do que fazer. O teste que confere se toda conferência está bem formada pega
// campo faltando antes de o robô rodar.

/** A gravidade decide a ordem no Resumo e a palavra que o dono lê. */
export const GRAVE = 'olhar hoje';
export const OLHAR = 'olhar quando der';
export const SABER = 'bom saber';

// ⚠️ TETO DE LINHAS POR CONFERÊNCIA. Uma conferência que acha 244 coisas não
// deve despejar 244 linhas numa aba que ninguém vai ler até o fim — o Resumo já
// diz o total. O detalhe mostra as primeiras e avisa quantas ficaram de fora.
export const TETO_POR_CONFERENCIA = 100;

export const CONFERENCIAS = [
  // ── VENDAS ────────────────────────────────────────────────────────────────
  {
    chave: 'venda-duplicada',
    aba: 'Vendas',
    titulo: 'Venda que parece emitida duas vezes',
    gravidade: GRAVE,
    oQueFazer: 'Abra os dois no Bling e veja se é a mesma venda. Em 21/09 a venda '
      + 'da Luiza Maria Carvalho tinha TRÊS pedidos, dois cancelados.',
    sql: `select contato_nome as quem,
                 max(data_do_pedido)::text as quando,
                 count(*)::text || ' pedidos iguais: ' || string_agg(numero, ', ' order by numero) as detalhe,
                 sum(receita_liquida) as valor
            from vessel_pedidos
           where situacao_id = 9
           group by contato_nome, data_do_pedido, total_produtos
          having count(*) > 1
           order by sum(receita_liquida) desc`,
  },
  {
    chave: 'venda-sem-vendedor',
    aba: 'Vendas',
    titulo: 'Venda sem vendedor',
    gravidade: OLHAR,
    oQueFazer: 'Sem vendedor a venda não entra na conta de ninguém. Confira no Bling '
      + 'quem atendeu, ou confirme que foi venda de site.',
    sql: `select contato_nome as quem, data_do_pedido::text as quando,
                 'pedido ' || numero as detalhe, receita_liquida as valor
            from vessel_pedidos
           where situacao_id = 9 and vendedor_id is null
           order by data_do_pedido desc`,
  },
  {
    chave: 'venda-sem-item',
    aba: 'Vendas',
    titulo: 'Venda sem nenhuma peça',
    gravidade: GRAVE,
    oQueFazer: 'Venda com valor e sem peça não fecha estoque. Veja no Bling se o '
      + 'pedido está mesmo vazio.',
    sql: `select p.contato_nome as quem, p.data_do_pedido::text as quando,
                 'pedido ' || p.numero as detalhe, p.receita_liquida as valor
            from vessel_pedidos p
           where p.situacao_id = 9
             and not exists (select 1 from vessel_pedido_itens i where i.pedido_id = p.id)
           order by p.data_do_pedido desc`,
  },
  {
    chave: 'venda-valor-zero',
    aba: 'Vendas',
    titulo: 'Venda com valor zero',
    gravidade: GRAVE,
    oQueFazer: 'Pode ser brinde, troca ou erro de digitação. Se for brinde, tudo bem — '
      + 'só não deve entrar na conta de faturamento.',
    sql: `select contato_nome as quem, data_do_pedido::text as quando,
                 'pedido ' || numero as detalhe, 0::numeric as valor
            from vessel_pedidos
           where situacao_id = 9 and coalesce(receita_liquida, 0) = 0
           order by data_do_pedido desc`,
  },
  {
    chave: 'venda-que-parece-teste',
    aba: 'Vendas',
    titulo: 'Venda que parece teste, contada como faturamento',
    gravidade: GRAVE,
    oQueFazer: 'Pedido de teste no Bling entra no faturamento como qualquer outro. '
      + 'Se for teste mesmo, cancele no Bling — na conferência seguinte ele sai daqui '
      + 'sozinho. ⚠️ O aviso por VALOR BAIXO pode pegar venda de verdade (brinde, '
      + 'ajuste); leia a coluna Detalhe antes de mexer.',
    // ⚠️ DUAS RÉGUAS, e a linha diz qual pegou. Pelo NOME é quase certeza
    // ("TESTE INTEGRACAO API - PODE EXCLUIR"); pelo VALOR é só desconfiança, e
    // acusar venda boa de ser teste é pior que deixar o teste passar.
    sql: `select contato_nome as quem, data_do_pedido::text as quando,
                 'pedido ' || numero || ' — ' ||
                 case when contato_nome ilike '%teste%' or contato_nome ilike '%test %'
                      then 'o nome do cliente diz teste'
                      else 'valor abaixo de R$ 5' end as detalhe,
                 receita_liquida as valor
            from vessel_pedidos
           where situacao_id = 9
             and (contato_nome ilike '%teste%' or contato_nome ilike '%test %'
                  or receita_liquida < 5)
           order by receita_liquida desc`,
  },
  {
    chave: 'venda-nunca-conferida',
    aba: 'Vendas',
    titulo: 'Pedido que ninguém confere com o Bling',
    gravidade: SABER,
    oQueFazer: 'A conferência ao vivo olha 30 dias para trás. Pedido mais antigo que '
      + 'isso nunca é revisitado — se tiver sido cancelado depois, ninguém vai saber. '
      + 'Para conferir tudo: rode o robô dos pedidos com uma janela maior.',
    sql: `select contato_nome as quem, data_do_pedido::text as quando,
                 'pedido ' || numero as detalhe, receita_liquida as valor
            from vessel_pedidos
           where situacao_id = 9 and conferido_no_bling_em is null
           order by data_do_pedido desc`,
  },

  // ── CATÁLOGO ──────────────────────────────────────────────────────────────
  {
    chave: 'item-sem-sku',
    aba: 'Catálogo',
    titulo: 'Peça vendida sem código',
    gravidade: OLHAR,
    oQueFazer: 'Sem código não dá para somar quanto cada modelo vendeu. Confira o '
      + 'cadastro do produto no Bling.',
    sql: `select coalesce(i.descricao, '(sem descrição)') as quem,
                 p.data_do_pedido::text as quando,
                 'pedido ' || p.numero as detalhe, i.total_do_item as valor
            from vessel_pedido_itens i
            join vessel_pedidos p on p.id = i.pedido_id
           where i.sku is null or i.sku = ''
           order by p.data_do_pedido desc`,
  },

  // ── CADASTRO ──────────────────────────────────────────────────────────────
  {
    chave: 'cadastro-de-teste',
    aba: 'Cadastro',
    titulo: 'Cadastro de teste vivendo na base de verdade',
    gravidade: OLHAR,
    oQueFazer: 'Cadastro feito para testar não deve contar como lead. Apague na '
      + 'Central, e ele some da planilha na rodada seguinte.',
    sql: `select nome as quem, criado_em::date::text as quando,
                 'origem: ' || origem as detalhe, null::numeric as valor
            from vessel_lista_espera
           where origem ilike '%teste%' or nome ilike '%teste%'
           order by criado_em desc`,
  },
  {
    chave: 'email-repetido',
    aba: 'Cadastro',
    titulo: 'Mesmo e-mail cadastrado mais de uma vez',
    gravidade: OLHAR,
    oQueFazer: 'A mesma pessoa contada duas vezes infla a lista. Veja se são pessoas '
      + 'diferentes ou o mesmo cadastro repetido.',
    sql: `select lower(email) as quem, max(criado_em)::date::text as quando,
                 count(*)::text || ' cadastros: ' || string_agg(nome, ', ') as detalhe,
                 null::numeric as valor
            from vessel_lista_espera
           where email is not null and email <> ''
           group by lower(email) having count(*) > 1`,
  },
  {
    chave: 'whatsapp-torto',
    aba: 'Cadastro',
    titulo: 'WhatsApp que não parece número',
    gravidade: OLHAR,
    oQueFazer: 'Sem WhatsApp certo ninguém consegue falar com ela. Confira o cadastro.',
    sql: `select nome as quem, criado_em::date::text as quando,
                 'guardado como: ' || coalesce(whatsapp, '(vazio)') as detalhe,
                 null::numeric as valor
            from vessel_lista_espera
           where whatsapp is null
              or length(regexp_replace(whatsapp, '\\D', '', 'g')) < 10
           order by criado_em desc`,
  },
  {
    chave: 'sessao-sem-salao',
    aba: 'Cadastro',
    titulo: 'Beauty Session sem o nome do salão',
    gravidade: OLHAR,
    oQueFazer: 'Sem o salão não dá para saber, depois, qual parceiro trouxe mais gente. '
      + 'Preencha na Central.',
    sql: `select codigo as quem, quando::text as quando,
                 'praça ' || coalesce(praca, '—') as detalhe, null::numeric as valor
            from vessel_beauty_sessions
           where (parceiro is null or parceiro = '') and ativa
           order by quando desc`,
  },
  {
    chave: 'evento-ativo-no-passado',
    aba: 'Cadastro',
    titulo: 'Encontro marcado como ativo, mas com data que já passou',
    gravidade: SABER,
    oQueFazer: 'Encontro que já aconteceu e continua ativo ainda aceita gente se '
      + 'inscrevendo. Encerre na Central.',
    sql: `select codigo as quem, quando::date::text as quando,
                 'Private Edit' as detalhe, null::numeric as valor
            from vessel_private_edits where ativa and quando < now()
           union all
          select codigo, quando::text, 'Beauty Session', null::numeric
            from vessel_beauty_sessions where ativa and quando < current_date`,
  },
  {
    chave: 'garantia-sem-peca',
    aba: 'Cadastro',
    titulo: 'Garantia de uma peça que não existe no cadastro',
    gravidade: GRAVE,
    oQueFazer: 'A cliente tem garantia de um selo que o sistema não conhece. Confira '
      + 'o código da peça.',
    sql: `select r.nome as quem, r.registrado_em::date::text as quando,
                 'selo ' || r.codigo as detalhe, null::numeric as valor
            from vessel_registros r
           where not exists (select 1 from vessel_pecas p where p.codigo = r.codigo)
           order by r.registrado_em desc`,
  },

  // ── META ──────────────────────────────────────────────────────────────────
  {
    chave: 'problema-meta',
    aba: 'Meta',
    titulo: 'A própria Meta está reclamando',
    gravidade: OLHAR,
    oQueFazer: 'É a reclamação que a Meta devolve sobre a campanha ou o anúncio. '
      + 'Resolva no Gerenciador de Anúncios.',
    sql: `select coalesce(campanha_nome, conta_nome, '(sem nome)') as quem,
                 primeira_vez::date::text as quando,
                 titulo || coalesce(' — ' || detalhe, '') as detalhe,
                 null::numeric as valor
            from gt_problemas_meta
           where resolvido_em is null
           order by grave desc nulls last, primeira_vez desc`,
  },

  // ── ROBÔS ─────────────────────────────────────────────────────────────────
  {
    chave: 'robo-parado',
    aba: 'Robôs',
    titulo: 'Robô que passou do tempo sem dar certo',
    gravidade: GRAVE,
    oQueFazer: 'Abra a Central em Status. ⚠️ Antes de correr: confira se o teto de '
      + 'horas bate com a frequência do robô — robô que roda 1x por dia com teto de '
      + '4 horas vai parecer parado todo dia, e isso é alarme falso, não defeito.',
    sql: `select robo as quem,
                 coalesce(ultimo_sucesso::date::text, 'nunca') as quando,
                 situacao || coalesce(' — parou em ' || array_to_string(quem_falhou, ', '), '')
                   || ' (teto de ' || horas_sem_sucesso_ate || 'h)' as detalhe,
                 null::numeric as valor
            from robos_saude
           where situacao <> 'ok'
           order by critico desc, robo`,
  },
];

// ── as abas do log ──────────────────────────────────────────────────────────

/** A ordem das abas de detalhe. Resumo vem sempre na frente. */
export const ABAS = ['Vendas', 'Catálogo', 'Cadastro', 'Meta', 'Robôs'];

const COLUNAS_DE_DETALHE = [
  { titulo: 'O que parece errado', largura: 38 },
  { titulo: 'Gravidade', largura: 16 },
  { titulo: 'Quem ou qual', largura: 34 },
  { titulo: 'Quando', largura: 13 },
  { titulo: 'Detalhe', largura: 58 },
  { titulo: 'Valor envolvido', tipo: 'dinheiro', largura: 17 },
  { titulo: 'O que fazer', largura: 70 },
];

/**
 * Monta as abas do log.
 *
 * @param resultados  { chave -> linhas devolvidas pela consulta }
 * @param quando      instante da rodada, em texto, só para o cabeçalho do Resumo
 */
export function montarAbasDoLog(resultados, quando) {
  const achados = (c) => resultados[c.chave] ?? [];

  const resumo = {
    nome: 'Resumo',
    documentacao: true,
    filtro: false,
    zebra: false,
    colunas: [{ titulo: `O QUE FOI CONFERIDO${quando ? ` — ${quando}` : ''}`, largura: 104 }],
    linhas: [],
  };

  // ⚠️ O RESUMO LISTA TUDO, inclusive o que deu ZERO. Log que só mostra
  // problema não deixa saber se a conferência rodou.
  const porGravidade = { [GRAVE]: 0, [OLHAR]: 1, [SABER]: 2 };
  const ordenadas = [...CONFERENCIAS].sort((a, b) => {
    const qa = achados(a).length, qb = achados(b).length;
    if ((qa > 0) !== (qb > 0)) return qb > 0 ? 1 : -1;      // o que achou algo vem antes
    if (porGravidade[a.gravidade] !== porGravidade[b.gravidade]) {
      return porGravidade[a.gravidade] - porGravidade[b.gravidade];
    }
    return qb - qa;
  });

  const comAlgo = ordenadas.filter((c) => achados(c).length > 0);
  const limpas = ordenadas.filter((c) => achados(c).length === 0);

  resumo.linhas.push([{ texto: 'O QUE PRECISA DE OLHO', secao: true }]);
  if (comAlgo.length === 0) {
    resumo.linhas.push(['Nada. As ' + CONFERENCIAS.length + ' conferências passaram limpas.']);
  }
  for (const c of comAlgo) {
    resumo.linhas.push([`${achados(c).length}  ·  ${c.titulo}  ·  ${c.gravidade}  ·  aba ${c.aba}`]);
  }
  resumo.linhas.push(['']);
  resumo.linhas.push([{ texto: 'O QUE ESTÁ LIMPO', secao: true }]);
  resumo.linhas.push(['Estas conferências rodaram e não acharam nada. Aparecem aqui de']);
  resumo.linhas.push(['propósito: zero linhas parece "está tudo bem" e parece "o robô quebrou".']);
  for (const c of limpas) resumo.linhas.push([`0  ·  ${c.titulo}`]);
  resumo.linhas.push(['']);
  resumo.linhas.push([{ texto: 'COMO LER', secao: true }]);
  resumo.linhas.push(['Nada aqui é acusação: é o que PARECE errado e vale um olhar.']);
  resumo.linhas.push(['Venda duplicada pode ser duas bolsas iguais no mesmo dia.']);
  resumo.linhas.push(['Cada linha das outras abas traz o que fazer.']);

  const abas = [resumo];
  for (const nomeDaAba of ABAS) {
    const daAba = CONFERENCIAS.filter((c) => c.aba === nomeDaAba);
    const linhas = [];
    for (const c of daAba) {
      const todas = achados(c);
      for (const r of todas.slice(0, TETO_POR_CONFERENCIA)) {
        linhas.push([c.titulo, c.gravidade, r.quem ?? '', r.quando ?? '',
          r.detalhe ?? '', r.valor ?? '', c.oQueFazer]);
      }
      if (todas.length > TETO_POR_CONFERENCIA) {
        linhas.push([c.titulo, c.gravidade,
          `… e mais ${todas.length - TETO_POR_CONFERENCIA}`, '',
          `só as ${TETO_POR_CONFERENCIA} primeiras cabem aqui; o total está no Resumo`,
          '', c.oQueFazer]);
      }
    }
    abas.push({ nome: nomeDaAba, colunas: COLUNAS_DE_DETALHE, linhas });
  }
  return abas;
}
