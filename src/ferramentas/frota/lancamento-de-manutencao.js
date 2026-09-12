/* Um lançamento, várias trocas.
 *
 * Hoje, registrar 3 trocas no mesmo carro é preencher o formulário 3 vezes:
 * item, KM, data, oficina e custo — 15 campos pra 3 trocas, com KM, data e
 * oficina redigitados a cada rodada. O resultado medido em 12/08/2026: a
 * frota inteira tem 2 trocas registradas em 10 carros. O dono chamou isso de
 * "difícil por ter que fazer um a um" e pediu urgência. Este módulo é a conta
 * por trás de UM lançamento com N itens — km, data e oficina digitados uma vez
 * só, virando N linhas de `frota_revisoes`.
 *
 * Não toca banco nem DOM: só a aritmética e a validação, pra decisão dar pra
 * testar sem abrir navegador.
 *
 * Um jeito de a frota rodar sem quase nenhuma revisão registrada é um
 * lançamento sem KM: `ultimaRevisao()` (revisoes.js) só considera linha com
 * `Number.isInteger(km)`, então uma troca gravada sem KM fica invisível pro
 * alerta — o item continua "vencido" pra sempre, mesmo já trocado. Por isso o
 * KM aqui é obrigatório, e a mensagem tem que dizer essa consequência, não só
 * pedir o campo. */

// Acima disso, um salto de KM entre duas revisões é quase certamente número
// digitado errado (ex.: dígito extra) — nenhum carro da frota anda 200.000 km
// entre duas idas à oficina. Não bloqueia: só pede confirmação, do mesmo jeito
// que revisoes.js trata o `aCadaKm` fora da faixa (problemasDoItem).
export const SALTO_ABSURDO_KM = 200000;

const kmFmt = (n) => Math.abs(n).toLocaleString('pt-BR');
const reaisFmt = (centavos) =>
  (Math.abs(centavos) / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** O que `centavos()` devolve quando o texto não é um valor que dê pra ler. */
export const VALOR_INVALIDO = Symbol('valor-invalido');

/**
 * Reais digitados por uma pessoa viram centavos (inteiro).
 *
 * O DEFEITO QUE ISTO CONSERTA, e ele já estava no ar: a conta antiga apagava
 * TODO ponto como separador de milhar antes de olhar a vírgula, então
 * `1240.00` virava 12.400.000 centavos — R$ 124.000,00, cem vezes o valor, e
 * gravado em silêncio. Não é caso exótico: `inputmode="decimal"` abre o teclado
 * que oferece PONTO em boa parte dos celulares, e a pessoa digita o que o
 * teclado sugere. A mesma conta alimentava `aluguel_centavos`, `fipe_centavos`
 * e `seguro_valor_centavos` na ficha do veículo — um aluguel digitado
 * `4500.00` já virava R$ 450.000,00 hoje.
 *
 * A REGRA: **o ÚLTIMO separador presente é a vírgula decimal**, qualquer que
 * seja ele. É o que faz `1.240,00`, `1240.00` e `1.240.00` lerem igual, e
 * `1.240` (sem casas) ler como mil duzentos e quarenta.
 *
 * Texto que sobra sujo devolve VALOR_INVALIDO, não `null`: os dois são
 * respostas diferentes — `null` é "não informou", e a tela deixa em branco;
 * inválido é "digitou algo que não dá pra ler", e a tela precisa BARRAR em vez
 * de gravar nada calada. Negativo também é inválido: nota de oficina não tem
 * valor negativo, e o sinal quase sempre é dedo errado.
 */
export function centavos(txt) {
  if (txt === null || txt === undefined) return null;
  const limpo = String(txt)
    .replace(/R\$/gi, '')
    //   é o espaço que não quebra — vem colado em valor copiado de site.
    .replace(/[\s ]/g, '')
    .trim();
  if (!limpo) return null;

  const ultimoSep = Math.max(limpo.lastIndexOf(','), limpo.lastIndexOf('.'));
  let inteiro = limpo;
  let decimais = '';
  if (ultimoSep !== -1) {
    inteiro = limpo.slice(0, ultimoSep);
    decimais = limpo.slice(ultimoSep + 1);
    // Três dígitos depois do último separador é separador de MILHAR, não
    // decimal: "1.240" é mil duzentos e quarenta, não um real e vinte e quatro.
    //
    // MAS só quando é PONTO. Com VÍRGULA a forma é ambígua — "12,345" tanto
    // pode ser doze mil trezentos e quarenta e cinco (separador estranho) como
    // três casas decimais digitadas por engano. Vírgula com 3 dígitos cai fora
    // e vira VALOR_INVÁLIDO logo abaixo, porque em dinheiro adivinhar entre
    // R$ 12.345,00 e R$ 12,34 é errar por um fator de mil. A tela BARRA e a
    // pessoa desfaz a ambiguidade digitando de novo.
    if (/^\d{3}$/.test(decimais) && limpo[ultimoSep] === '.') { inteiro = limpo; decimais = ''; }
  }
  // Os separadores restantes são de milhar por definição (o último já foi
  // tratado acima) — mas só valem se estiverem AGRUPANDO DE 3 EM 3. "1.240.000"
  // é milhão; "1,2,3" não é forma nenhuma, e em dinheiro forma torta vira
  // VALOR_INVALIDO em vez de palpite: lido como "12,3" daria R$ 12,30 sobre o
  // que a pessoa quis dizer com outra coisa.
  if (/[.,]/.test(inteiro) && !/^\d{1,3}([.,]\d{3})*$/.test(inteiro)) return VALOR_INVALIDO;
  inteiro = inteiro.replace(/[.,]/g, '');

  if (!/^\d*$/.test(inteiro) || !/^\d*$/.test(decimais)) return VALOR_INVALIDO;
  if (!inteiro && !decimais) return VALOR_INVALIDO;
  if (decimais.length > 2) return VALOR_INVALIDO;

  const cents = parseInt(inteiro || '0', 10) * 100 + parseInt(decimais.padEnd(2, '0') || '0', 10);
  return Number.isSafeInteger(cents) ? cents : VALOR_INVALIDO;
}

/**
 * A frase depois de tentar gravar um lançamento — e ela decide se a pessoa
 * pode TENTAR DE NOVO ou não, que é a parte que estas mensagens costumam errar.
 *
 * Cabeçalho e trocas são duas gravações. "Duas gravações com só a primeira
 * conferida" apareceu 4× nesta ferramenta, sempre com a tela dizendo que tinha
 * dado certo. Aqui cada desfecho tem sua frase:
 *
 *  - deu tudo certo → sem frase.
 *  - cabeçalho falhou → NADA foi gravado. Pode tentar de novo à vontade.
 *  - trocas falharam e o cabeçalho foi apagado (CONFIRMADO, uma linha apagada)
 *    → nada ficou pela metade. Pode tentar de novo.
 *  - trocas falharam e o desfazer NÃO se confirmou → o lançamento pode ter
 *    ficado no histórico sem troca nenhuma. **NÃO tentar de novo**: repetir
 *    criaria um segundo serviço, e o histórico passaria a ter um lançamento
 *    dizendo que nada foi feito e outro dizendo o que foi.
 *
 * `cabecalhoApagado` tem de vir da CONTAGEM DE LINHAS apagadas, não da ausência
 * de erro: um delete recusado pela permissão volta sem erro e sem apagar nada.
 */
export function mensagemDoLancamento({ erroCab, erroLinhas, cabecalhoApagado }) {
  if (erroCab) {
    return 'Não consegui gravar este lançamento, e NADA foi salvo — nenhuma troca foi '
      + 'registrada. Confira a conexão e tente de novo.';
  }
  if (!erroLinhas) return '';
  if (cabecalhoApagado) {
    return 'Não consegui gravar as trocas, então desfiz o lançamento inteiro — nada ficou '
      + 'pela metade. Tente de novo.';
  }
  return 'Gravei o lançamento mas não consegui gravar as trocas, e também não consegui '
    + 'desfazê-lo. Ele pode ter ficado no histórico deste carro SEM as trocas. '
    + 'NÃO lance de novo: avise quem administra a Frota, senão o mesmo serviço entra duas vezes.';
}

/**
 * Problemas de um lançamento de manutenção ANTES de gravar. Devolve avisos em
 * português; cada um traz `bloqueia`: true impede gravar, false é só um alerta.
 */
export function problemasDoLancamento({ km, itens, kmConhecido }) {
  const p = [];

  if (km === null || km === undefined || km === '') {
    p.push({
      bloqueia: true,
      texto: 'Informe o KM. Sem ele, esta troca não entra no alerta de revisão — '
        + 'o item continuaria aparecendo como vencido pra sempre, mesmo já trocado. '
        + 'Avisar sobre a próxima troca depende deste número.',
    });
  } else if (!Number.isInteger(km) || km < 0) {
    p.push({ bloqueia: true, texto: 'KM inválido — não pode ser negativo. Confira o número.' });
  } else if (Number.isInteger(kmConhecido)) {
    if (km < kmConhecido) {
      // Painel trocado na oficina zera o odômetro de verdade — mesmo
      // tratamento que o checklist já dá em hodometro_justificativa.
      p.push({
        bloqueia: false,
        texto: `O KM informado (${km.toLocaleString('pt-BR')}) é menor que o maior já conhecido `
          + `deste carro (${kmConhecido.toLocaleString('pt-BR')}). Isso é normal quando o painel foi `
          + 'trocado na oficina — confirme antes de gravar.',
      });
    } else if (km - kmConhecido > SALTO_ABSURDO_KM) {
      p.push({
        bloqueia: false,
        texto: `São ${kmFmt(km - kmConhecido)} km de salto desde o último KM conhecido `
          + `(${kmConhecido.toLocaleString('pt-BR')}). Confirme se o número está certo antes de gravar.`,
      });
    }
  }

  const lista = itens || [];
  if (!lista.length) {
    p.push({ bloqueia: true, texto: 'Marque pelo menos um item — o que foi trocado nesta visita à oficina?' });
  } else {
    // Duas linhas do mesmo item no mesmo serviço dariam dois alertas pra
    // mesma troca — o mesmo motivo que problemasDoItem() (revisoes.js) barra
    // nome repetido no plano.
    const vistos = new Set();
    for (const it of lista) {
      const nome = String((it && it.item) || '').trim().toLowerCase();
      if (nome && vistos.has(nome)) {
        p.push({
          bloqueia: true,
          texto: `"${it.item}" aparece duas vezes neste lançamento — junte numa linha só. `
            + 'Duas entradas do mesmo item dariam dois alertas para a mesma troca.',
        });
      }
      vistos.add(nome);
    }
  }

  return p;
}

/**
 * O total da nota raramente bate com a soma dos itens digitados — falta a
 * mão de obra, ou uma peça não entrou na lista. A decisão do dono: não
 * rateia o total pelos itens (inventaria um preço de peça que não existe) e
 * não repete o total em cada linha (somaria o total N vezes). A tela só
 * DIZ a diferença, em reais, e deixa gravar assim mesmo.
 *
 * Devolve `{ soma, diferenca, texto }`, ou `null` quando não há divergência
 * pra dizer: sem total, sem nenhum item com valor, ou soma exata.
 */
export function diferencaDeValores({ totalCentavos, itens }) {
  if (!Number.isInteger(totalCentavos)) return null;
  const comValor = (itens || []).filter((i) => i && Number.isInteger(i.valorCentavos));
  if (!comValor.length) return null;

  const soma = comValor.reduce((acc, i) => acc + i.valorCentavos, 0);
  const diferenca = totalCentavos - soma;
  if (diferenca === 0) return null;

  const texto = diferenca > 0
    ? `Os itens somam R$ ${reaisFmt(soma)}, mas o total informado é R$ ${reaisFmt(totalCentavos)} `
      + `— R$ ${reaisFmt(diferenca)} de diferença, provavelmente mão de obra ou uma peça que não `
      + 'entrou na lista. Isso não impede gravar.'
    : `Os itens somam R$ ${reaisFmt(soma)}, R$ ${reaisFmt(diferenca)} mais que o total informado `
      + `(R$ ${reaisFmt(totalCentavos)}). Confira os valores — mas isso não impede gravar.`;

  return { soma, diferenca, texto };
}

/**
 * As linhas de `frota_revisoes` que este lançamento grava — uma por item
 * marcado. KM, data e oficina do cabeçalho são digitados uma vez só, aqui e
 * repetidos em cada linha: é o que faz o alerta (`ultimaRevisao()`) funcionar
 * por item, e não redundância.
 */
export function linhasParaGravar({ manutencaoId, veiculoId, km, feitaEm, oficina, itens }) {
  return (itens || []).map((it) => ({
    manutencao_id: manutencaoId,
    veiculo_id: veiculoId,
    item: String((it && it.item) || '').trim(),
    km,
    // Data em branco grava nulo. Inventar a data de hoje seria a tela
    // mentindo sobre quando o serviço foi feito.
    feita_em: feitaEm ? feitaEm : null,
    oficina: oficina ? oficina : null,
    // Item sem valor grava nulo, não zero — zero diria "de graça".
    custo_centavos: Number.isInteger(it && it.valorCentavos) ? it.valorCentavos : null,
  }));
}
