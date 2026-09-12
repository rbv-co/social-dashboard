/* Quem usa o carro sem ser do cadastro.
 *
 * O CASO REAL, e ele está no banco: em 11/08/2026 o dono precisou registrar que
 * o Felipe, modelista contratado pra uma consultoria, ia usar a Bravo Essence
 * por duas semanas. Não havia onde escrever o nome dele — os campos de motorista
 * só oferecem a lista de colaboradores. A saída que sobrou foi pôr o PRÓPRIO
 * dono como motorista e escrever a verdade na finalidade:
 *
 *   pessoa_nome: "Erick Martins"
 *   finalidade:  "Veículo está sendo utilizado por Felipe modelista durante o
 *                 período de consultoria a partir de 11/08"
 *
 * Ou seja: a ferramenta registrou o motorista errado, e a informação certa foi
 * parar num campo de texto que nenhuma conta lê. Se chegasse multa dessa
 * quinzena, ela cairia no nome do dono — que é exatamente o problema de
 * R$ 1.301,60 em multas sem condutor que motivou o módulo inteiro.
 *
 * A DECISÃO DO DONO, escolhida entre três: nome escrito NA HORA, sem cadastro
 * nenhum. Nada de tabela de terceiros, nada de virar colaborador. O que ele
 * aceitou perder ao escolher isso, e está dito aqui pra ninguém "consertar"
 * depois: pessoa de fora não tem telefone no sistema, então o quadro de
 * cobrança do checklist não alcança ela, e ela não recebe o aviso das 7h30.
 *
 * O que este módulo faz é a única facilidade que sobra: LEMBRAR os nomes já
 * digitados, pra "Felipe", "felipe modelista" e "Felipe M." não virarem três
 * pessoas diferentes no histórico. É sugestão, não cadastro — a pessoa pode
 * ignorar e escrever outro nome. */

/** Tira acento e caixa, pra "Felipe" e "felipe" contarem como o mesmo. */
function normalizar(s) {
  return String(s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Os nomes de fora já usados, pra oferecer como sugestão.
 *
 * "De fora" é a linha que tem NOME e não tem `pessoa_id` — é assim que este
 * módulo grava, e é como o histórico antigo já guardava quem saiu do cadastro.
 * Ordenados do mais usado pro menos, e o empate pelo alfabeto, pra a lista não
 * dançar entre uma abertura e outra.
 *
 * `limite` existe porque isto vira uma lista de sugestão embaixo de um campo:
 * cinquenta nomes ali não ajudam ninguém.
 */
export function nomesDeFora(linhas, limite = 12) {
  const contagem = new Map();
  for (const l of linhas || []) {
    if (!l || l.pessoa_id) continue;             // do cadastro: não é de fora
    const nome = String(l.pessoa_nome || '').trim();
    if (!nome) continue;
    const chave = normalizar(nome);
    const atual = contagem.get(chave);
    // Guarda a PRIMEIRA grafia vista, não a última: a primeira costuma ser a
    // que a pessoa escreveu com calma, e trocar a sugestão a cada uso faria a
    // lista mudar debaixo da mão de quem está digitando.
    if (atual) atual.vezes += 1;
    else contagem.set(chave, { nome, vezes: 1 });
  }
  return [...contagem.values()]
    .sort((a, b) => b.vezes - a.vezes || a.nome.localeCompare(b.nome, 'pt-BR'))
    .slice(0, limite)
    .map((x) => x.nome);
}

/**
 * O nome de fora está bom pra gravar?
 *
 * Devolve a lista de problemas, no mesmo formato do resto desta ferramenta
 * (`{ bloqueia, texto }`). Vazia significa que pode gravar.
 *
 * Duas travas, e as duas existem porque o nome é a ÚNICA identificação que essa
 * pessoa vai ter no histórico: não há cadastro por trás pra corrigir depois.
 */
export function problemasDoNomeDeFora(nome) {
  const p = [];
  const limpo = String(nome || '').trim();
  if (!limpo) {
    p.push({ bloqueia: true, texto: 'Escreva o nome de quem vai usar o carro.' });
    return p;
  }
  if (limpo.length < 3) {
    p.push({
      bloqueia: true,
      texto: 'O nome está curto demais para alguém reconhecer depois. '
        + 'Escreva ao menos o primeiro nome inteiro.',
    });
  }
  // Uma palavra só não bloqueia — "Felipe" identifica, se é o único Felipe de
  // fora usando carro. Mas vale o empurrão: numa multa daqui a três meses,
  // "Felipe" sozinho pode não bastar.
  if (limpo && !/\s/.test(limpo)) {
    p.push({
      bloqueia: false,
      texto: 'Só um nome. Se puder, acrescente o sobrenome ou o que a pessoa faz '
        + '("Felipe modelista") — é por este nome que ela vai ser reconhecida numa multa.',
    });
  }
  return p;
}

/**
 * A linha de motorista, pro que for gravar — reserva ou registro de uso.
 *
 * Colaborador vira `{ pessoa_id, pessoa_nome }`; pessoa de fora vira
 * `{ pessoa_id: null, pessoa_nome }`. As duas colunas já aceitam nulo, e é
 * assim que o histórico antigo guarda quem saiu do cadastro — ou seja, o
 * formato não é novo, só passou a ter um caminho pela tela.
 */
export function motoristaParaGravar({ pessoaId, nomeDeFora, nomeDaPessoa }) {
  if (pessoaId) {
    const nome = typeof nomeDaPessoa === 'function' ? nomeDaPessoa(pessoaId) : null;
    return { pessoa_id: pessoaId, pessoa_nome: nome || null };
  }
  const limpo = String(nomeDeFora || '').trim();
  return { pessoa_id: null, pessoa_nome: limpo || null };
}

/** O valor que o seletor usa pra dizer "não é do cadastro". */
export const DE_FORA = '__de_fora__';
