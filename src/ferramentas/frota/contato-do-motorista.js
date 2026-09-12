/* De quem é este telefone, quando o cadastro do colaborador não tem um.
 *
 * O CASO REAL que motivou isto: o quadro "Checklist de hoje" só olhava
 * `acessos_pessoas` pra achar telefone, e dizia "sem telefone" pra Marcus e
 * pro Thiago Siqueira — que TÊM telefone, só que ele mora na ficha do carro
 * (`frota_veiculos.contato_nome`/`contato_telefone`), não no cadastro da
 * pessoa.
 *
 * A ARMADILHA: o contato do carro nem sempre é quem dirige. No Honda Fit (um
 * carro de rodízio, sem dono fixo) o contato é a Bárbara, que é supervisora
 * de lojas — puxar esse telefone cego mandaria "seu checklist está atrasado"
 * pra quem nunca pegou aquele carro. Por isso este módulo não devolve só um
 * telefone: devolve TAMBÉM de quem ele é, pra tela poder avisar quando não é
 * a pessoa que está sendo cobrada.
 */

import { telefoneDaCobranca } from '../../../supabase/functions/_shared/checklist.js';

/** Tira acento e caixa alta — "Bárbara" e "BARBARA" têm de bater. */
function normalizarNome(s) {
  return String(s || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

/** As palavras que contam pra comparação: sem acento/caixa, e sem as curtas
 * demais ("de", "da", "e") pra elas nunca decidirem um "bate" sozinhas. */
function palavrasSignificativas(s) {
  return normalizarNome(s).split(/\s+/).filter((p) => p.length >= 3);
}

/**
 * Compara dois nomes de um jeito tolerante — mas SÓ tolerante de menos pra
 * mais, nunca de mais pra menos. A ficha do carro guarda "Marcus" e o
 * colaborador é "Marcus Vinicius" — comparar a string inteira nunca bateria,
 * então quando um dos dois nomes é UMA palavra só, basta ela aparecer no
 * outro (é como o campo é preenchido de verdade: um pedaço que já identifica
 * a pessoa entre quem mexe naquele carro).
 *
 * Mas quando OS DOIS nomes têm mais de uma palavra, uma palavra em comum não
 * basta — a base real tem 3 "Vieira" (Ana, Jeremias, Theo) e 2 "Clara"
 * (Beduschi, Marques), e a versão antiga desta função dava
 * `nomesBatem('Ana Vieira', 'Theo Vieira') === true`: duas pessoas
 * diferentes, casadas só por dividirem o sobrenome. Pra dois nomes de mais
 * de uma palavra, exige-se que TODAS as palavras do menor apareçam no maior
 * — "Ana Vieira" só bate com um nome que tenha "ana" E "vieira", nunca só
 * um dos dois.
 *
 * Isto também é a resposta pro caso ambíguo (revisão pediu pra decidir): a
 * função não conhece um diretório de pessoas, então não tem como saber que
 * "Vieira" sozinho é ambíguo entre três. O que ela garante é o lado seguro
 * do erro — quando a comparação é mais fraca que "todas as palavras batem",
 * ela devolve `false`, e `false` aqui vira `origem: 'carro_outra_pessoa'`
 * em contatoParaCobranca(): a tela MOSTRA o aviso de "pode não ser quem
 * dirige" em vez de apagá-lo. Nunca o contrário — falso positivo é que
 * apagaria o aviso calado, que é o defeito que esta função existe pra
 * evitar.
 *
 * Nomes vazios nunca batem — sem essa guarda, dois campos em branco
 * (`''` === `''`) passariam como "é a mesma pessoa".
 */
export function nomesBatem(a, b) {
  const palavrasA = palavrasSignificativas(a);
  const palavrasB = palavrasSignificativas(b);
  if (!palavrasA.length || !palavrasB.length) return false;

  const [menor, maior] = palavrasA.length <= palavrasB.length ? [palavrasA, palavrasB] : [palavrasB, palavrasA];
  const maiorSet = new Set(maior);

  // Uma palavra só do lado mais curto: o caso comum (Marcus, Siqueira,
  // Bárbara, Erick) — basta ela estar no outro nome.
  if (menor.length === 1) return maiorSet.has(menor[0]);

  // Duas palavras ou mais dos dois lados: TODAS as palavras do menor têm de
  // estar no maior. Um sobrenome sozinho em comum (só "vieira", só "clara")
  // não é o bastante.
  return menor.every((p) => maiorSet.has(p));
}

/**
 * Quantas pessoas DA BASE aquele nome de contato poderia descrever —
 * `nomesBatem` contra cada uma. É a peça que faltava: comparar só o par
 * (contato do carro, dono) nunca poderia saber que "Vieira" é ambíguo, porque
 * ambiguidade não é propriedade do PAR de nomes, é propriedade da BASE ("tem
 * um Siqueira só" x "tem três Vieira") — a mesma forma de nome ("Siqueira" x
 * "Thiago Siqueira", "Vieira" x "Ana Vieira") tem que dar respostas
 * diferentes dependendo de quantos Siqueira/Vieira existem na empresa.
 */
function pessoasQueBatem(nomeContato, pessoas) {
  return (pessoas || []).filter((p) => p && nomesBatem(nomeContato, p.nome));
}

/**
 * Decide se o contato do carro É o dono passado, agora olhando pra base
 * inteira quando ela é dada:
 *  - nome do contato não bate com NINGUÉM da base → é outra pessoa mesmo
 *    (ex.: um mecânico, um terceiro) — nunca ambíguo, nunca o dono;
 *  - bate com MAIS DE UMA pessoa → ambíguo (o caso dos 3 "Vieira" e das 2
 *    "Clara") — não dá pra afirmar que é o dono, mesmo que o dono seja um
 *    dos que bateram;
 *  - bate com EXATAMENTE UMA → é o dono só se essa uma for o próprio dono
 *    passado.
 * `pessoas` é OPCIONAL: quem ainda não tem a lista à mão continua com o
 * comportamento antigo (compara só os dois nomes) — pra não quebrar nenhuma
 * chamada existente enquanto a tela não é atualizada pra passar a base.
 */
function mesmaPessoaDoContato({ nomeContato, pessoa, pessoas }) {
  if (!pessoas) return nomesBatem(nomeContato, pessoa ? pessoa.nome : null);
  const candidatos = pessoasQueBatem(nomeContato, pessoas);
  if (candidatos.length !== 1) return false;
  return !!(pessoa && candidatos[0].id === pessoa.id);
}

/**
 * Decide QUAL telefone usar pra cobrar o motorista, e de quem ele é —
 * decisão do dono, com três desfechos:
 *  - 'colaborador': o cadastro em Colaboradores e Acessos tem telefone. Caso
 *    comum, botão normal.
 *  - 'carro_mesma_pessoa': o cadastro está vazio, mas a ficha do carro tem
 *    contato e o nome bate com o do motorista — é o telefone dele mesmo,
 *    só que mora no lugar errado. Botão normal.
 *  - 'carro_outra_pessoa': a ficha do carro tem contato, mas o nome NÃO bate
 *    com o motorista — seja porque é claramente outra pessoa (ex.: o Honda
 *    Fit é de rodízio e o contato é a supervisora), seja porque o nome é
 *    AMBÍGUO na base (mais de um "Vieira") e não dá pra afirmar que é o
 *    dono. A tela tem de avisar nos dois casos.
 *  - 'nenhum': não há telefone em lugar nenhum. Continua dizendo que falta,
 *    como já fazia.
 *
 * `pessoas` (opcional): a base inteira de colaboradores, pra resolver
 * ambiguidade de nome (ver mesmaPessoaDoContato). Sem ela, cai no
 * comportamento antigo — compara só o contato do carro contra o dono
 * passado, sem saber se o nome é ambíguo na empresa.
 */
export function contatoParaCobranca({ pessoa, veiculo, pessoas }) {
  const telColaborador = telefoneDaCobranca(pessoa);
  if (telColaborador) {
    return { telefone: telColaborador, origem: 'colaborador', nomeContato: pessoa ? pessoa.nome : null };
  }

  const telCarro = veiculo && veiculo.contato_telefone;
  if (telCarro) {
    const mesmaPessoa = mesmaPessoaDoContato({ nomeContato: veiculo.contato_nome, pessoa, pessoas });
    return {
      telefone: telCarro,
      origem: mesmaPessoa ? 'carro_mesma_pessoa' : 'carro_outra_pessoa',
      nomeContato: veiculo.contato_nome || null,
    };
  }

  return { telefone: null, origem: 'nenhum', nomeContato: null };
}

/**
 * Só oferece "copiar telefone pro cadastro" quando é seguro fazer isso:
 *  - o carro tem telefone E o contato é seguramente o colaborador — nome
 *    bate, e (quando `pessoas` é dado) o nome não é ambíguo na base;
 *  - o colaborador está mesmo sem telefone (senão a cópia sobrescreveria algo
 *    que a pessoa já tinha digitado).
 * Nunca oferece pra 'carro_outra_pessoa' nem pro caso ambíguo: copiar o
 * telefone de um "Vieira" que pode ser um dos três pro cadastro de um deles
 * gravaria um dado que pode estar errado — mesmo raciocínio que zera o botão
 * pro contato da Bárbara no Honda Fit de rodízio.
 */
export function podeCopiarTelefoneDoCarro({ pessoa, veiculo, pessoas }) {
  if (!pessoa || telefoneDaCobranca(pessoa)) return false;
  const telCarro = veiculo && veiculo.contato_telefone;
  if (!telCarro) return false;
  return mesmaPessoaDoContato({ nomeContato: veiculo.contato_nome, pessoa, pessoas });
}

/* ── DIGITAR O TELEFONE ALI MESMO (D5) ──────────────────────────────────────
 *
 * Pedido do dono (19/08/2026). O `podeCopiarTelefoneDoCarro` acima só resolve
 * quando o telefone JÁ existe na ficha do carro. Medido no banco no mesmo dia,
 * isso deixa de fora justamente quem precisa:
 *
 *   Breno (BMW X1 e VOLVO XC90), Humberto Mendonça (XC60) e Raissa Herculano
 *   (PORSCHE CAYENNE) não têm telefone em lugar NENHUM.
 *
 * Para esses quatro carros não existe hoje jeito nenhum de cobrar o checklist:
 * o botão de WhatsApp não aparece, e o de copiar também não, porque não há o
 * que copiar. */

/**
 * Dá pra digitar um telefone pra esta pessoa?
 *
 * Três condições, e a terceira é de desenho, não de segurança:
 *   1. tem de ser um COLABORADOR de verdade (com `id`) — gente de fora não tem
 *      cadastro pra receber telefone;
 *   2. o cadastro dela tem de estar sem telefone; se já tem, digitar por cima
 *      apagaria o que alguém pôs lá;
 *   3. quando dá pra COPIAR do carro, o caminho é copiar. Dois controles pra
 *      mesma coisa fazem a pessoa parar pra escolher — o padrão da casa manda
 *      uma ação por bloco.
 *
 * Repare que 'carro_outra_pessoa' NÃO bloqueia: é o caso do FIAT DOBLO, que é
 * do Jeremias Vieira mas tem "Siqueira" no contato. Copiar está proibido ali,
 * e com razão — mas o Jeremias continua sem telefone, e é exatamente aí que
 * digitar é o único caminho.
 */
export function podeDigitarTelefone({ pessoa, veiculo, pessoas } = {}) {
  if (!pessoa || !pessoa.id) return false;
  if (telefoneDaCobranca(pessoa)) return false;
  return !podeCopiarTelefoneDoCarro({ pessoa, veiculo, pessoas });
}

/**
 * O que a pessoa digitou serve? E, se serve, como se guarda?
 *
 * Guarda-se SÓ DÍGITOS, que é como os três telefones que já existem no banco
 * estão gravados ('19998086930'). Aceitar a máscara junto criaria duas formas
 * do mesmo número, e o link do WhatsApp passaria a depender de qual delas veio.
 *
 * A CONFERÊNCIA ACONTECE ANTES DE GRAVAR, e é para isso que ela existe: um
 * número errado no cadastro não avisa que está errado — ele só faz a cobrança
 * ir para o vazio, e ninguém descobre até alguém perguntar por que fulano
 * nunca respondeu.
 */
export function conferirTelefoneDigitado(bruto) {
  let d = String(bruto ?? '').replace(/\D/g, '');
  if (!d) return { ok: false, motivo: 'vazio' };

  // O 55 da frente é país, não telefone. Quem copia do WhatsApp traz ele junto.
  if ((d.length === 12 || d.length === 13) && d.startsWith('55')) d = d.slice(2);

  if (d.length < 10) return { ok: false, motivo: 'curto' };
  if (d.length > 11) return { ok: false, motivo: 'longo' };

  // DDD brasileiro vai de 11 a 99. "01" costuma ser gente colando o número com
  // o zero da operadora na frente, e ele derrubaria a ligação e o WhatsApp.
  const ddd = Number(d.slice(0, 2));
  if (ddd < 11 || ddd > 99) return { ok: false, motivo: 'ddd' };

  return { ok: true, numero: d };
}

/** A frase da recusa, em português. Código de motivo nunca chega na tela. */
export function porQueOTelefoneNaoServe(motivo) {
  switch (motivo) {
    case 'vazio':
      return 'Escreva o telefone antes de salvar.';
    case 'curto':
      return 'Faltam números. Escreva com o DDD — 11 dígitos no celular, 10 no fixo.';
    case 'longo':
      return 'Sobraram números. Escreva só o DDD e o telefone, sem o código do país.';
    case 'ddd':
      return 'Esse DDD não existe. Confira os dois primeiros números.';
    default:
      return 'Não consegui entender esse telefone. Confira e tente de novo.';
  }
}
