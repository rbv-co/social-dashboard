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
// ⚠️ A CONSULTA DE CADA CONFERÊNCIA NÃO MORA MAIS AQUI. Em 22/09/2026 o log
// virou AO VIVO (edge + cron do banco, de 10 em 10 minutos), e a edge é Deno:
// ela não abre conexão de Postgres, ela chama função. As quinze consultas estão
// em `public.vessel_carocos()`, criada por
// `db/migrations/2026-09-22-log-de-carocos-ao-vivo.sql`.
//
// Aqui ficou o que decide TEXTO e FORMA — nome, gravidade, o que fazer, a
// ordem do Resumo — que é o que o teste em node alcança.
//
// ⚠️ A ORDEM DAS ABAS DE DETALHE É SEMPRE DO MAIS RECENTE PARA O MAIS ANTIGO,
// e mora AQUI, não no `order by` de cada consulta. Pedido do dono em
// 23/09/2026: "o log de caroços eu quero ele sempre já traga filtrado do mais
// recente para o mais antigo igual vc fez na base de clientes". Na função do
// banco cada conferência ordena do seu jeito (uma por valor, outra por
// gravidade, uma sem `order by` nenhum) e a aba junta até sete delas — ordenar
// aqui, depois de juntar, é o único lugar onde a aba INTEIRA fica em ordem.
// Consertar consulta por consulta deixaria a próxima nascer torta de novo.
//
// Como acrescentar uma conferência: uma entrada aqui E a consulta na função do
// banco, com a MESMA chave. O teste "toda conferência está bem formada" pega
// campo faltando; a prova do aplicador pega chave que existe de um lado só.

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
  },
  {
    chave: 'venda-sem-vendedor',
    aba: 'Vendas',
    titulo: 'Venda sem vendedor',
    gravidade: OLHAR,
    oQueFazer: 'Sem vendedor a venda não entra na conta de ninguém. Confira no Bling '
      + 'quem atendeu, ou confirme que foi venda de site.',
  },
  {
    chave: 'venda-sem-item',
    aba: 'Vendas',
    titulo: 'Venda sem nenhuma peça',
    gravidade: GRAVE,
    oQueFazer: 'Venda com valor e sem peça não fecha estoque. Veja no Bling se o '
      + 'pedido está mesmo vazio.',
  },
  {
    chave: 'venda-valor-zero',
    aba: 'Vendas',
    titulo: 'Venda com valor zero',
    gravidade: GRAVE,
    oQueFazer: 'Pode ser brinde, troca ou erro de digitação. Se for brinde, tudo bem — '
      + 'só não deve entrar na conta de faturamento.',
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
    // ⚠️ DUAS RÉGUAS, e a linha diz qual pegou (a consulta está em
    // `db/migrations/2026-09-22-log-de-carocos-ao-vivo.sql`). Pelo NOME é quase
    // certeza ("TESTE INTEGRACAO API - PODE EXCLUIR"); pelo VALOR é só
    // desconfiança, e acusar venda boa de ser teste é pior que deixar passar.
  },
  {
    chave: 'venda-nunca-conferida',
    aba: 'Vendas',
    titulo: 'Pedido que ninguém confere com o Bling',
    gravidade: SABER,
    oQueFazer: 'A conferência ao vivo olha 30 dias para trás. Pedido mais antigo que '
      + 'isso nunca é revisitado — se tiver sido cancelado depois, ninguém vai saber. '
      + 'Para conferir tudo: rode o robô dos pedidos com uma janela maior.',
  },
  {
    chave: 'venda-sem-conferencia',
    aba: 'Vendas',
    titulo: 'Venda que aparece na tela e ninguém confere',
    gravidade: SABER,
    // ⚠️ ESTA CONFERÊNCIA É SOBRE O PRÓPRIO LOG, e nasceu em 22/09/2026 de uma
    // medição: as conferências de venda olhavam R$ 160.861 dos R$ 1.061.751 que
    // a Gestão à Vista mostra — 15%. Quatro canais inteiros, o maior deles o
    // Institucional com R$ 74.948, nunca tinham sido conferidos uma vez.
    //
    // O motivo é simples e não é defeito de ninguém: o robô dos pedidos traz o
    // DETALHE (cliente, vendedor, peças) só dos canais da Vessel, e desde
    // 19/06/2026. Da venda dos outros canais a gente tem a nota — valor, canal
    // e dia — e mais nada. Sem cliente não há "venda duplicada"; sem peça não
    // há "venda sem item".
    //
    // ⚠️ POR QUE ISTO É UMA LINHA NO LOG, E NÃO UM SILÊNCIO. Aba de Vendas
    // curta queria dizer "está tudo certo" e queria dizer "eu nem olhei esse
    // canal" — e são coisas opostas. É o mesmo motivo pelo qual o Resumo lista
    // as conferências que deram zero.
    oQueFazer: 'Não é erro: é o alcance do log. Destes pedidos a gente só tem a nota '
      + '(valor, canal e dia), então as conferências que precisam de cliente, vendedor '
      + 'ou peça não chegam neles. Para cobrir um canal, o robô dos pedidos precisa '
      + 'passar a trazer o detalhe dele.',
  },

  // ── CATÁLOGO ──────────────────────────────────────────────────────────────
  {
    chave: 'item-sem-sku',
    aba: 'Catálogo',
    titulo: 'Peça vendida sem código',
    gravidade: OLHAR,
    oQueFazer: 'Sem código não dá para somar quanto cada modelo vendeu. Confira o '
      + 'cadastro do produto no Bling.',
  },

  // ── CADASTRO ──────────────────────────────────────────────────────────────
  {
    chave: 'cadastro-de-teste',
    aba: 'Cadastro',
    titulo: 'Cadastro de teste vivendo na base de verdade',
    gravidade: OLHAR,
    oQueFazer: 'Cadastro feito para testar não deve contar como lead. Apague na '
      + 'Central, e ele some da planilha na rodada seguinte.',
  },
  {
    chave: 'email-repetido',
    aba: 'Cadastro',
    titulo: 'Mesmo e-mail cadastrado mais de uma vez',
    gravidade: OLHAR,
    oQueFazer: 'A mesma pessoa contada duas vezes infla a lista. Veja se são pessoas '
      + 'diferentes ou o mesmo cadastro repetido.',
  },
  {
    chave: 'whatsapp-torto',
    aba: 'Cadastro',
    titulo: 'WhatsApp que não parece número',
    gravidade: OLHAR,
    oQueFazer: 'Sem WhatsApp certo ninguém consegue falar com ela. Confira o cadastro.',
  },
  {
    chave: 'sessao-sem-salao',
    aba: 'Cadastro',
    titulo: 'Beauty Session sem o nome do salão',
    gravidade: OLHAR,
    oQueFazer: 'Sem o salão não dá para saber, depois, qual parceiro trouxe mais gente. '
      + 'Preencha na Central.',
  },
  {
    chave: 'evento-ativo-no-passado',
    aba: 'Cadastro',
    titulo: 'Encontro marcado como ativo, mas com data que já passou',
    gravidade: SABER,
    oQueFazer: 'Encontro que já aconteceu e continua ativo ainda aceita gente se '
      + 'inscrevendo. Encerre na Central.',
  },
  {
    chave: 'garantia-sem-peca',
    aba: 'Cadastro',
    titulo: 'Garantia de uma peça que não existe no cadastro',
    gravidade: GRAVE,
    oQueFazer: 'A cliente tem garantia de um selo que o sistema não conhece. Confira '
      + 'o código da peça.',
  },

  // ── META ──────────────────────────────────────────────────────────────────
  {
    chave: 'problema-meta',
    aba: 'Meta',
    titulo: 'A própria Meta está reclamando',
    gravidade: OLHAR,
    oQueFazer: 'É a reclamação que a Meta devolve sobre a campanha ou o anúncio. '
      + 'Resolva no Gerenciador de Anúncios.',
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

/** Onde mora a data na linha de detalhe — a mesma ordem das colunas acima. */
const COLUNA_QUANDO = 3;

/**
 * Do mais recente para o mais antigo, como nas abas da "Base de clientes".
 *
 * ⚠️ COMPARA TEXTO, e é de propósito: a função do banco devolve `quando` já em
 * texto e quase sempre como `2026-09-23`, que ordena certo em ordem de letra.
 * O que NÃO é data ordena de forma estável e vai para a frente — o `nunca` do
 * robô que jamais deu certo é o caso real, e ele na frente está bom.
 */
const maisNovoPrimeiro = (campo) => (a, b) =>
  String(b[campo] ?? '').localeCompare(String(a[campo] ?? ''));

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
    const avisosDeCorte = [];
    for (const c of daAba) {
      // ⚠️ ORDENA ANTES DE CORTAR. Com o corte antes da ordem, as 100 que o
      // dono vê seriam as que o banco devolveu primeiro — e o caroço de hoje
      // podia ser justamente um dos 144 que ficaram de fora.
      const todas = [...achados(c)].sort(maisNovoPrimeiro('quando'));
      for (const r of todas.slice(0, TETO_POR_CONFERENCIA)) {
        linhas.push([c.titulo, c.gravidade, r.quem ?? '', r.quando ?? '',
          r.detalhe ?? '', r.valor ?? '', c.oQueFazer]);
      }
      if (todas.length > TETO_POR_CONFERENCIA) {
        avisosDeCorte.push([c.titulo, c.gravidade,
          `… e mais ${todas.length - TETO_POR_CONFERENCIA}`, '',
          `cabem as ${TETO_POR_CONFERENCIA} mais recentes; as `
          + `${todas.length - TETO_POR_CONFERENCIA} mais antigas ficaram de fora`
          + ' e o total está no Resumo',
          '', c.oQueFazer]);
      }
    }
    // ⚠️ A ABA INTEIRA DO MAIS RECENTE PARA O MAIS ANTIGO, e não cada
    // conferência no seu bloco. Pedido do dono em 23/09/2026: "igual vc fez na
    // base de clientes". Uma aba junta até sete conferências; ordenada só
    // dentro de cada bloco, o caroço de hoje da sétima nasce embaixo de
    // centenas de linhas velhas das outras seis. Quem quiser ver uma
    // conferência de cada vez usa o filtro da coluna "O que parece errado".
    linhas.sort(maisNovoPrimeiro(COLUNA_QUANDO));
    // Os avisos de corte não têm data e vão para o fim — que é onde o leitor
    // chega ao mais antigo, e é exatamente o que ficou de fora.
    abas.push({
      nome: nomeDaAba, colunas: COLUNAS_DE_DETALHE, linhas: [...linhas, ...avisosDeCorte],
    });
  }
  return abas;
}
